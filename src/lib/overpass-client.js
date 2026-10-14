// ── lib/overpass-client.js — schonender Zugriff auf die öffentlichen Overpass-Server (OpenStreetMap) ──
// Die öffentlichen Server vergeben je IP-Adresse nur wenige Rechenplätze und sperren bei zu vielen Anfragen
// (HTTP 429). Deshalb:
//   • eine Anfrage zur Zeit (Warteschlange) statt mehrerer parallel,
//   • die Server nacheinander statt alle gleichzeitig (jede gleichzeitige Anfrage belegt dort einen Platz),
//   • der Browser wartet länger als der Server rechnen darf ([timeout:N] + Puffer) — ein vorzeitiger Abbruch
//     würde den Platz auf dem Server trotzdem bis zum Ende belegen,
//   • nach 429/504 bzw. Zeitüberschreitung pausiert der betroffene Server (Retry-After, sonst 60 s bzw. 20 s),
//   • Antworten werden im Browser zwischengespeichert (IndexedDB, 30 Tage) — dasselbe Gebiet wird nicht erneut
//     angefragt (Neu laden mit { frisch: true } bzw. osmZwischenspeicherLeeren()).
//   • overpass-api.de verlangt seit 2026 bei Anfragen aus dem Browser eine Herkunftsangabe (HTTP-Referer) und lehnt
//     sonst mit 406 ab. Eine lokal geöffnete Datei (file://) sendet keine — dann wird dieser Server übersprungen.

export const OVERPASS_SERVER = Object.freeze([
  { name: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', brauchtHerkunft: true },
  { name: 'private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
  { name: 'kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter' },
  { name: 'maps.mail.ru', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
]);

const SPEICHER_TAGE = 30;
const pauseBis = new Map();        // Server-URL → Zeitpunkt (ms), ab dem er wieder angefragt wird
let warteschlange = Promise.resolve();
const speicher = new Map();        // Zwischenspeicher dieser Sitzung (Schlüssel → Antwort)

/** Rechenzeit, die die Abfrage dem Server erlaubt ([timeout:N], sonst 180 s Server-Vorgabe → hier 25 s angenommen). */
export function serverTimeoutS(abfrage) {
  const m = /\[timeout:(\d+)\]/.exec(String(abfrage || ''));
  return m ? Number(m[1]) : 25;
}

/** Kurzer, stabiler Schlüssel einer Abfrage (FNV-1a über den Text). */
export function abfrageSchluessel(abfrage) {
  let h = 0x811c9dc5;
  const s = String(abfrage || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'op1:' + h.toString(36) + ':' + s.length;
}

/** Pause eines Servers nach einer Antwort (ms) oder 0: Retry-After, sonst 60 s bei 429, 20 s bei 503/504/Zeitüberschreitung. */
export function pauseNachAntwort(status, retryAfter) {
  const ra = Number(retryAfter);
  if (status === 429) return Number.isFinite(ra) && ra > 0 ? Math.min(600, ra) * 1000 : 60000;
  if (status === 503 || status === 504 || status === 'timeout') return 20000;
  return 0;
}

// ── IndexedDB (fehlertolerant: ohne IndexedDB bleibt nur der Sitzungsspeicher) ──
function db() {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open('mmh-osm', 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('antworten'); } catch (e) { void e; } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { void e; resolve(null); }
  });
}
async function lesen(schluessel) {
  if (speicher.has(schluessel)) return speicher.get(schluessel);
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    try {
      const r = d.transaction('antworten').objectStore('antworten').get(schluessel);
      r.onsuccess = () => {
        const e = r.result;
        if (e && Date.now() - e.zeit < SPEICHER_TAGE * 864e5) { speicher.set(schluessel, e.daten); resolve(e.daten); } else resolve(null);
      };
      r.onerror = () => resolve(null);
    } catch (e) { void e; resolve(null); }
  });
}
async function schreiben(schluessel, daten) {
  speicher.set(schluessel, daten);
  const d = await db();
  if (!d) return;
  try { d.transaction('antworten', 'readwrite').objectStore('antworten').put({ zeit: Date.now(), daten }, schluessel); } catch (e) { void e; }
}

/** Zwischenspeicher leeren (Sitzung und Browser). */
export async function osmZwischenspeicherLeeren() {
  speicher.clear();
  const d = await db();
  if (!d) return;
  try { d.transaction('antworten', 'readwrite').objectStore('antworten').clear(); } catch (e) { void e; }
}

/** true, wenn die Seite als lokale Datei geöffnet ist (keine Herkunftsangabe, Origin „null“). */
export function seiteLokal(ort = typeof location !== 'undefined' ? location : null) {
  return !!ort && (ort.protocol === 'file:' || ort.origin === 'null');
}

/** Gesperrte Server mit Restpause (s) — für Hinweise in der Oberfläche. */
export function overpassPausen() {
  const jetzt = Date.now();
  return OVERPASS_SERVER.map(s => ({ name: s.name, restS: Math.max(0, Math.ceil(((pauseBis.get(s.url) || 0) - jetzt) / 1000)) }));
}

/**
 * Overpass-Abfrage. Ergebnis: Antwort-JSON oder null (alle Server gescheitert / abgebrochen).
 * opt: { frisch (Zwischenspeicher übergehen), status(serverName, text) (Fortschritt), abgebrochen() → true bricht ab,
 *        abrufen (fetch-Ersatz für Tests), runden (Durchgänge über alle Server, Vorgabe 2), maxWartenS (Vorgabe 45) }
 */
export function overpassAbfrage(abfrage, opt = {}) {
  const { frisch = false, status = () => {}, abgebrochen = () => false, abrufen = (...a) => fetch(...a),
    runden = 2, maxWartenS = 45, warten = ms => new Promise(r => setTimeout(r, ms)), lokal = seiteLokal() } = opt;
  const server = OVERPASS_SERVER.filter(s => !(lokal && s.brauchtHerkunft));
  const schluessel = abfrageSchluessel(abfrage);
  const lauf = async () => {
    if (!frisch) {
      const alt = await lesen(schluessel);
      if (alt) { status('Zwischenspeicher', '✓ ' + (alt.elements?.length ?? 0) + ' Elemente (gespeichert)'); return alt; }
    }
    const clientMs = (serverTimeoutS(abfrage) + 15) * 1000;
    for (const s of OVERPASS_SERVER) if (lokal && s.brauchtHerkunft) status(s.name, '⏭ nur bei Aufruf über eine Webadresse (Datei lokal geöffnet)');
    for (let runde = 0; runde < runden; runde++) {
      for (const s of server) {
        if (abgebrochen()) return null;
        const rest = (pauseBis.get(s.url) || 0) - Date.now();
        if (rest > 0) { status(s.name, '⏸ Pause ' + Math.ceil(rest / 1000) + ' s'); continue; }
        status(s.name, '🔄');
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => ctrl?.abort(), clientMs);
        try {
          // Formular-Kodierung wie vom Overpass-Server erwartet (CORS-einfache Anfrage, keine Vorabprüfung)
          const resp = await abrufen(s.url, { method: 'POST', body: 'data=' + encodeURIComponent(abfrage), signal: ctrl?.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
          if (!resp.ok) {
            const p = pauseNachAntwort(resp.status, resp.headers?.get?.('Retry-After'));
            if (p) pauseBis.set(s.url, Date.now() + p);
            status(s.name, '⚠ HTTP ' + resp.status + (resp.status === 429 ? ' (zu viele Anfragen)' : ''));
            continue;
          }
          let daten;
          try { daten = await resp.json(); } catch (e) { void e; status(s.name, '⚠ keine gültige Antwort'); continue; }
          if (/runtime error|timed out/i.test(daten?.remark || '')) {
            pauseBis.set(s.url, Date.now() + pauseNachAntwort('timeout'));
            status(s.name, '⚠ Server überlastet');
            continue;
          }
          status(s.name, '✓ ' + (daten?.elements?.length ?? 0) + ' Elemente');
          await schreiben(schluessel, daten);
          return daten;
        } catch (e) {
          const zeit = e?.name === 'AbortError';
          if (zeit) pauseBis.set(s.url, Date.now() + pauseNachAntwort('timeout'));
          // „Failed to fetch“: vom Browser blockiert (CORS, Netzwerk, Proxy) — Hinweis auf lokal geöffnete Datei
          status(s.name, '✗ ' + (zeit ? 'Zeitüberschreitung' : 'vom Browser blockiert' + (lokal ? ' (Datei lokal geöffnet)' : '') + (e?.message ? ': ' + e.message : '')));
        } finally {
          clearTimeout(timer);
        }
      }
      // Alle Server pausiert oder gescheitert: auf den ersten freien warten (begrenzt), dann zweiter Durchgang
      if (runde < runden - 1) {
        const naechste = Math.min(...server.map(s => (pauseBis.get(s.url) || 0) - Date.now()));
        const ms = Math.min(maxWartenS * 1000, Math.max(3000, naechste));
        status('Warten', '⏳ neuer Versuch in ' + Math.ceil(ms / 1000) + ' s');
        await warten(ms);
      }
    }
    return null;
  };
  // Warteschlange: eine Anfrage zur Zeit
  const ergebnis = warteschlange.then(lauf, lauf);
  warteschlange = ergebnis.catch(() => null);
  return ergebnis;
}
