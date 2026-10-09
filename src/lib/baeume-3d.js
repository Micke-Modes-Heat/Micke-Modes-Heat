// ── lib/baeume-3d.js — Bäume aus OpenStreetMap als 3D-Objekte ───────────────
// Reiner Daten- und Geometrieteil der 3D-Ansicht (32-3d-ansicht.js), ohne
// DOM/WebGL/Netz. Nur Ansicht — nichts davon landet im Projekt.
//
// Quellen (OSM, Overpass `out tags geom;`):
//   natural=tree                    Einzelbaum (Punkt)
//   natural=tree_row                Baumreihe (Linie) → Bäume im festen Abstand
//   natural=wood / landuse=forest   Wald (Fläche, auch Multipolygon) → Raster
//   landuse=orchard                 Streuobst (Fläche) → weiteres Raster, kleine Bäume
// Gelesene Tags: height / est_height, diameter_crown, circumference (Stamm),
// leaf_type, genus / species. Fehlt etwas, gelten die Vorgaben unten.
//
// Flächen werden auf einem globalen Raster gefüllt (leicht verwackelt), der
// Zufall hängt nur von OSM-ID bzw. Rasterzelle ab — das Bild ist bei jedem
// Öffnen gleich. Gebäudegrundrisse bleiben frei. Wird es zu viel, wird das
// Flächenraster gleichmäßig weiter (statt Wälder halb abzuschneiden).

import { splitOsmBbox, subdivideOsmBbox, mergeOsmElements } from './osm-bbox-tiles.js';

const M_PRO_GRAD = 111320;

export const BAUM_VORGABEN = {
  einzel: { hoehe: 12 },
  reihe: { hoehe: 11, abstand: 8 },
  wald: { hoehe: 20, abstand: 7 },
  obst: { hoehe: 6, abstand: 10, krone: 6 },
};

export const BAUM_FARBEN = { laub: '#4f8a3a', nadel: '#2e5e3e', obst: '#6f9e3e', stamm: '#6b4a2f' };

// Gattungen, die als Nadelbaum (Kegel) gezeichnet werden
const NADEL_GATTUNGEN = new Set(['abies', 'picea', 'pinus', 'larix', 'pseudotsuga', 'taxus', 'thuja',
  'juniperus', 'cedrus', 'sequoia', 'sequoiadendron', 'tsuga', 'chamaecyparis', 'cupressus',
  'metasequoia', 'taxodium', 'cryptomeria', 'araucaria']);

/* ── Kleinkram ───────────────────────────────────────────────────────────── */

/** Zahl aus einem OSM-Wert: „12", „12 m", „12,5m", „230 cm" → Meter; sonst NaN. */
export function baumZahl(raw) {
  if (raw == null) return NaN;
  const m = String(raw).trim().match(/^(\d+(?:[.,]\d+)?)\s*(cm|m)?\s*$/i);
  if (!m) return NaN;
  const v = parseFloat(m[1].replace(',', '.'));
  return m[2] && m[2].toLowerCase() === 'cm' ? v / 100 : v;
}

/** Kleiner deterministischer Zufallsgenerator (mulberry32) → Werte in [0, 1). */
export function baumZufall(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(...teile) {
  let h = 2166136261;
  for (const t of teile) {
    const s = String(t);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x2c; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const klemmen = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Laub, Nadel oder gemischt aus den Tags (Baum- oder Flächentags).
 * @returns {'laub'|'nadel'|'gemischt'|null}
 */
export function baumBlattart(tags) {
  const t = tags || {};
  const lt = String(t.leaf_type || '').toLowerCase();
  if (lt === 'needleleaved') return 'nadel';
  if (lt === 'broadleaved' || lt === 'leafless') return 'laub';
  if (lt === 'mixed') return 'gemischt';
  const gattung = String(t.genus || t.species || t['species:la'] || '').trim().split(/\s+/)[0].toLowerCase();
  if (gattung) return NADEL_GATTUNGEN.has(gattung) ? 'nadel' : 'laub';
  return null;
}

/* ── Geometriehelfer (lokal, Meter) ──────────────────────────────────────── */

function rahmen(lng0, lat0) {
  const k = M_PRO_GRAD * Math.cos(lat0 * Math.PI / 180);
  return {
    nachXY: (lng, lat) => [(lng - lng0) * k, (lat - lat0) * M_PRO_GRAD],
    nachLL: (x, y) => [lng0 + x / k, lat0 + y / M_PRO_GRAD],
  };
}

function ringBox(ring) {
  let w = Infinity, s = Infinity, o = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x; if (x > o) o = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return { w, s, o, n };
}

/** Gerade-Ungerade-Regel über alle Ringe (äußere + Löcher) */
function inRingen(x, y, ringe) {
  let innen = false;
  for (const r of ringe) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) innen = !innen;
    }
  }
  return innen;
}

const gleich = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Wegstücke eines Multipolygons zu geschlossenen Ringen verbinden (Endpunkte
 * müssen exakt übereinstimmen, wie in OSM). Offene Reste werden verworfen.
 * @param {number[][][]} wege Linien [[lng,lat],…]
 * @returns {number[][][]} Ringe (erster Punkt = letzter Punkt)
 */
export function baumRingeVerbinden(wege) {
  const rest = wege.filter(w => w && w.length >= 2).map(w => w.slice());
  const ringe = [];
  while (rest.length) {
    const ring = rest.shift();
    let weiter = true;
    while (!gleich(ring[0], ring[ring.length - 1]) && weiter) {
      weiter = false;
      const ende = ring[ring.length - 1];
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        if (gleich(w[0], ende)) { ring.push(...w.slice(1)); }
        else if (gleich(w[w.length - 1], ende)) { ring.push(...w.slice(0, -1).reverse()); }
        else continue;
        rest.splice(i, 1);
        weiter = true;
        break;
      }
    }
    if (ring.length >= 4 && gleich(ring[0], ring[ring.length - 1])) ringe.push(ring);
  }
  return ringe;
}

/* ── Overpass → Baumliste ────────────────────────────────────────────────── */

/** Overpass-Abfrage für einen Ausschnitt {s, w, n, e} (Grad). */
export function baumOverpassAbfrage(bbox) {
  const b = [bbox.s, bbox.w, bbox.n, bbox.e].map(v => v.toFixed(6)).join(',');
  return `[out:json][timeout:30];(`
    + `node["natural"="tree"](${b});way["natural"="tree_row"](${b});`
    + `way["natural"="wood"](${b});way["landuse"="forest"](${b});way["landuse"="orchard"](${b});`
    + `relation["natural"="wood"](${b});relation["landuse"="forest"](${b});relation["landuse"="orchard"](${b});`
    + `);out tags geom;`;
}

// Wie OVERPASS_ENDPOINTS in 03b-netz.js — hier dupliziert, damit die 3D-Ansicht
// (Blatt-Modul) und das Baum-Modul ohne App-Kern auskommen.
export const BAUM_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Eine Abfrage an alle Server gleichzeitig; die erste brauchbare Antwort gewinnt (leer ist brauchbar). */
async function overpassEinmal(bbox, abrufen, timeoutMs) {
  const abfrage = baumOverpassAbfrage(bbox);
  const ctrls = BAUM_OVERPASS.map(() => new AbortController());
  const versuch = (url, ctrl) => {
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return Promise.resolve()
      .then(() => abrufen(url, { method: 'POST', body: 'data=' + encodeURIComponent(abfrage), signal: ctrl.signal }))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        if (!d || !Array.isArray(d.elements)) throw new Error('Antwort unbrauchbar');
        if (/runtime error/i.test(d.remark || '')) throw new Error(/timed out|timeout/i.test(d.remark) ? 'Zeitüberschreitung' : 'Serverfehler');
        return d;
      })
      .catch(e => { throw new Error(e?.name === 'AbortError' ? 'Zeitüberschreitung' : (e?.message || String(e))); })
      .finally(() => clearTimeout(t));
  };
  try {
    return await Promise.any(BAUM_OVERPASS.map((u, i) => versuch(u, ctrls[i])));
  } catch (e) {
    const gruende = [...new Set((e?.errors || [e]).map(x => x?.message || String(x)))];
    throw new Error(gruende.join(', '));
  } finally {
    ctrls.forEach(c => { try { c.abort(); } catch (e) { void e; } });
  }
}

/**
 * Bäume im Ausschnitt bei Overpass abfragen — robust gegen überlastete Server:
 *   • größere Gebiete in Kacheln (je ≤ 1,2 km), nacheinander
 *   • je Kachel bis zu `versuche` Runden mit wachsender Wartezeit (504/429 sind
 *     bei Overpass meist nach Sekunden vorbei)
 *   • scheitert eine Kachel ganz, wird sie einmal geviertelt (kleinere Abfragen
 *     laufen nicht in die Zeitgrenze)
 * Elemente mehrerer Kacheln werden über type+id zusammengeführt.
 * @param {{s:number,w:number,n:number,e:number}} bbox
 * @param {{abrufen?:Function, timeoutMs?:number, versuche?:number, wartenMs?:number[],
 *   warten?:(ms:number)=>Promise<void>, fortschritt?:(info:any)=>void, kachelM?:number}} [opt]
 * @returns {Promise<{elements:any[]}>}
 */
export async function baumOverpassLaden(bbox, opt = {}) {
  const {
    abrufen = (...a) => fetch(...a), timeoutMs = 40000, versuche = 3, wartenMs = [0, 3000, 8000],
    warten = ms => new Promise(r => setTimeout(r, ms)), fortschritt = null, kachelM = 1200,
  } = opt;
  const alsObj = ([s, w, n, e]) => ({ s, w, n, e });
  const warteschlange = splitOsmBbox([bbox.s, bbox.w, bbox.n, bbox.e], { targetMeters: kachelM, maxTilesPerAxis: 4 })
    .map(k => ({ k, tiefe: 0 }));
  if (!warteschlange.length) warteschlange.push({ k: [bbox.s, bbox.w, bbox.n, bbox.e], tiefe: 0 });
  const ergebnisse = [];
  let fertig = 0;
  while (warteschlange.length) {
    const { k, tiefe } = warteschlange.shift();
    let daten = null, fehler = null;
    for (let v = 0; v < versuche && !daten; v++) {
      if (v) await warten(wartenMs[v] ?? wartenMs[wartenMs.length - 1]);
      fortschritt?.({ kachel: fertig + 1, kacheln: fertig + 1 + warteschlange.length, versuch: v + 1, versuche, fehler: fehler?.message || null });
      try { daten = await overpassEinmal(alsObj(k), abrufen, timeoutMs); } catch (e) { fehler = e; }
    }
    if (daten) { ergebnisse.push(daten); fertig++; continue; }
    if (tiefe === 0) { warteschlange.unshift(...subdivideOsmBbox(k).map(t => ({ k: t, tiefe: 1 }))); continue; }
    throw new Error(`OpenStreetMap antwortet nicht (${fehler?.message || 'unbekannt'}) — ${versuche} Versuche je Teilgebiet`);
  }
  return mergeOsmElements(ergebnisse);
}

function geomLL(geometry) {
  return (geometry || []).filter(p => p && isFinite(p.lat) && isFinite(p.lon)).map(p => [p.lon, p.lat]);
}

/**
 * Einen Baum mit Maßen versehen.
 * @param {'einzel'|'reihe'|'wald'|'obst'} quelle
 */
function baumMasse(quelle, tags, flaechenTags, zufall) {
  const v = BAUM_VORGABEN[quelle];
  let art = quelle === 'obst' ? 'obst' : (baumBlattart(tags) || baumBlattart(flaechenTags) || 'laub');
  if (art === 'gemischt') art = zufall() < 0.4 ? 'nadel' : 'laub';
  const hTag = baumZahl(tags?.height ?? tags?.est_height);
  // Ohne Angabe: Vorgabe ± 15–20 %, damit Reihen und Wälder nicht wie gestanzt aussehen
  const streu = quelle === 'wald' ? 0.4 : 0.3;
  const hoehe = klemmen(Number.isFinite(hTag) && hTag > 0 ? hTag : v.hoehe * (1 - streu / 2 + streu * zufall()), 2, 45);
  const kTag = baumZahl(tags?.diameter_crown);
  const kVorgabe = v.krone ? v.krone * (0.85 + 0.3 * zufall())
    : art === 'nadel' ? hoehe * 0.35 : hoehe * 0.6;
  const krone = klemmen(Number.isFinite(kTag) && kTag > 0 ? kTag : kVorgabe,
    1, art === 'nadel' ? 12 : 25);
  const uTag = baumZahl(tags?.circumference);
  const stamm = klemmen(Number.isFinite(uTag) && uTag > 0 ? uTag / (2 * Math.PI) : krone * 0.04, 0.08, 1.2);
  return { hoehe, krone, stamm, art, drehung: zufall() * Math.PI * 2, ton: 0.9 + 0.2 * zufall(),
    hoeheQuelle: Number.isFinite(hTag) && hTag > 0 ? 'osm' : 'vorgabe' };
}

/**
 * Overpass-Ergebnis → Bäume im Ausschnitt.
 * @param {{elements?: any[]}} data
 * @param {{bbox:{s:number,w:number,n:number,e:number}, ausschluss?: number[][][], max?: number}} opt
 *   ausschluss: Gebäudegrundrisse als Ringe [[lng,lat],…] — dort wird kein Flächen-/Reihenbaum gesetzt
 * @returns {{baeume: {lng:number,lat:number,hoehe:number,krone:number,stamm:number,art:string,
 *   quelle:string,drehung:number,ton:number}[], zahl:{einzel:number,reihe:number,wald:number,obst:number},
 *   ausgeduennt:boolean, abstandFaktor:number}}
 */
export function baeumeAusOverpass(data, opt) {
  const { bbox, ausschluss = [], max = 4000 } = opt;
  const R = rahmen((bbox.w + bbox.e) / 2, (bbox.s + bbox.n) / 2);
  const [bx0, by0] = R.nachXY(bbox.w, bbox.s);
  const [bx1, by1] = R.nachXY(bbox.e, bbox.n);
  const imAusschnitt = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;

  const gebaeude = ausschluss.filter(r => r && r.length >= 3).map(r => {
    const ring = r.map(([lng, lat]) => R.nachXY(lng, lat));
    return { ring, box: ringBox(ring) };
  });
  const imGebaeude = (x, y) => gebaeude.some(g => x >= g.box.w && x <= g.box.o && y >= g.box.s && y <= g.box.n
    && inRingen(x, y, [g.ring]));

  const baeume = [];
  const zahl = { einzel: 0, reihe: 0, wald: 0, obst: 0 };
  const setzen = (x, y, quelle, masse, osmId = null) => {
    const [lng, lat] = R.nachLL(x, y);
    baeume.push({ lng, lat, quelle, osmId, ...masse });
    zahl[quelle]++;
  };

  const els = data?.elements || [];
  // 1) Einzelbäume
  const einzelRaster = new Set();             // 3-m-Zellen, um Reihenbäume nicht doppelt zu setzen
  const zelle3 = (x, y) => `${Math.round(x / 3)}|${Math.round(y / 3)}`;
  for (const el of els) {
    if (el.type !== 'node' || el.tags?.natural !== 'tree' || !isFinite(el.lat) || !isFinite(el.lon)) continue;
    const [x, y] = R.nachXY(el.lon, el.lat);
    if (!imAusschnitt(x, y)) continue;
    setzen(x, y, 'einzel', baumMasse('einzel', el.tags, null, baumZufall(hash('n', el.id))), el.id);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) einzelRaster.add(`${Math.round(x / 3) + dx}|${Math.round(y / 3) + dy}`);
  }

  // 2) Baumreihen (Einzelbäume auf der Reihe sind oft schon als Punkte erfasst)
  for (const el of els) {
    if (el.type !== 'way' || el.tags?.natural !== 'tree_row') continue;
    const pts = geomLL(el.geometry).map(([lng, lat]) => R.nachXY(lng, lat));
    const abstand = BAUM_VORGABEN.reihe.abstand;
    const zufall = baumZufall(hash('r', el.id));
    let rest = 0;                              // Weg seit dem letzten Baum
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      let d = i === 0 ? 0 : abstand - rest;
      for (; d <= len + 1e-6; d += abstand) {
        const x = x0 + (x1 - x0) * d / len, y = y0 + (y1 - y0) * d / len;
        const masse = baumMasse('reihe', el.tags, null, zufall);
        if (imAusschnitt(x, y) && !einzelRaster.has(zelle3(x, y)) && !imGebaeude(x, y)) setzen(x, y, 'reihe', masse);
      }
      rest = len > 0 ? (rest + len) % abstand : rest;
    }
  }

  // 3) Flächen: Wald und Streuobst
  const flaechen = [];
  for (const el of els) {
    const t = el.tags || {};
    const quelle = t.landuse === 'orchard' ? 'obst'
      : (t.natural === 'wood' || t.landuse === 'forest') ? 'wald' : null;
    if (!quelle) continue;
    let ringe = [];
    if (el.type === 'way') {
      const r = geomLL(el.geometry);
      if (r.length >= 4 && gleich(r[0], r[r.length - 1])) ringe = [r];
    } else if (el.type === 'relation') {
      const wege = (el.members || []).filter(m => m.type === 'way' && m.role !== 'subarea').map(m => geomLL(m.geometry));
      ringe = baumRingeVerbinden(wege);
    }
    if (!ringe.length) continue;
    const xy = ringe.map(r => r.map(([lng, lat]) => R.nachXY(lng, lat)));
    const box = xy.reduce((b, r) => {
      const rb = ringBox(r);
      return { w: Math.min(b.w, rb.w), s: Math.min(b.s, rb.s), o: Math.max(b.o, rb.o), n: Math.max(b.n, rb.n) };
    }, { w: Infinity, s: Infinity, o: -Infinity, n: -Infinity });
    flaechen.push({ el, quelle, ringe: xy, box });
  }

  const flaechenPunkte = faktor => {
    const out = [];
    const belegt = new Set();                  // überlappende Flächen (Wald im Wald) nicht doppelt
    for (const f of flaechen) {
      const a = BAUM_VORGABEN[f.quelle].abstand * faktor;
      const i0 = Math.ceil((Math.max(f.box.w, bx0)) / a - 0.5), i1 = Math.floor((Math.min(f.box.o, bx1)) / a - 0.5);
      const j0 = Math.ceil((Math.max(f.box.s, by0)) / a - 0.5), j1 = Math.floor((Math.min(f.box.n, by1)) / a - 0.5);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const key = `${f.quelle}|${i}|${j}`;
          if (belegt.has(key)) continue;
          const z = baumZufall(hash(f.quelle, i, j, faktor));
          // Rasterzelle + Verwacklung (±30 % des Abstands)
          const x = (i + 0.5) * a + (z() - 0.5) * a * 0.6;
          const y = (j + 0.5) * a + (z() - 0.5) * a * 0.6;
          if (!imAusschnitt(x, y) || !inRingen(x, y, f.ringe)) continue;
          belegt.add(key);
          out.push({ x, y, f, z });
        }
      }
    }
    return out;
  };

  const budget = Math.max(0, max - baeume.length);
  let faktor = 1;
  let punkte = flaechen.length ? flaechenPunkte(1) : [];
  let ausgeduennt = false;
  // Zu viele → Raster gleichmäßig weiter (höchstens zweimal nachschärfen)
  for (let k = 0; k < 3 && punkte.length > budget; k++) {
    faktor *= Math.sqrt(punkte.length / Math.max(1, budget)) * 1.03;
    punkte = flaechenPunkte(faktor);
    ausgeduennt = true;
  }
  if (punkte.length > budget) punkte = punkte.slice(0, budget);
  for (const p of punkte) {
    if (imGebaeude(p.x, p.y)) continue;
    setzen(p.x, p.y, p.f.quelle, baumMasse(p.f.quelle, null, p.f.el.tags, p.z));
  }
  return { baeume, zahl, ausgeduennt, abstandFaktor: faktor };
}

/* ── Kronenform (gemeinsam für Darstellung und Verschattung) ─────────────── */

/**
 * Hülle der Krone in Metern über dem Fußpunkt.
 *   Laub/Obst: Ellipsoid (Mitte zc, Halbachsen r waagrecht, rz senkrecht)
 *   Nadel:     Kegel von z0 (Radius r) bis zur Spitze z1
 * @param {{hoehe:number,krone:number,art:string}} b
 * @returns {{form:'ellipsoid', zc:number, rz:number, r:number} | {form:'kegel', z0:number, z1:number, r:number}}
 */
export function baumKrone(b) {
  const H = b.hoehe, R = b.krone / 2;
  if (b.art === 'nadel') return { form: 'kegel', z0: Math.min(Math.max(0.8, H * 0.12), H * 0.4), z1: H, r: R };
  const zb = Math.min(Math.max(1.5, H * (b.art === 'obst' ? 0.3 : 0.35)), H - 1);   // Kronenansatz
  const rz = (H - zb) / 2;
  return { form: 'ellipsoid', zc: zb + rz, rz, r: R };
}

/* ── Baum → Dreiecke ─────────────────────────────────────────────────────── */

const KRONE_SEG = 7, KRONE_RINGE = 4, KEGEL_SEG = 8, STAMM_SEG = 6;

function prisma(r, z0, z1, seg, dreh) {
  const out = [];
  for (let k = 0; k < seg; k++) {
    const a0 = dreh + k * 2 * Math.PI / seg, a1 = dreh + (k + 1) * 2 * Math.PI / seg;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)], p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    out.push([[p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1]]);
    out.push([[p0[0], p0[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1]]);
  }
  return out;
}

function kegel(r, z0, z1, seg, dreh) {
  const out = [];
  for (let k = 0; k < seg; k++) {
    const a0 = dreh + k * 2 * Math.PI / seg, a1 = dreh + (k + 1) * 2 * Math.PI / seg;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0), z0], p1 = [r * Math.cos(a1), r * Math.sin(a1), z0];
    out.push([p0, p1, [0, 0, z1]]);
    out.push([p1, p0, [0, 0, z0]]);          // Boden, damit man von unten nicht hineinsieht
  }
  return out;
}

function ellipsoid(rxy, rz, zc, dreh) {
  const out = [];
  const punkt = (i, k) => {
    const phi = Math.PI * i / KRONE_RINGE;               // 0 = oben
    const th = dreh + 2 * Math.PI * k / KRONE_SEG + (i % 2) * Math.PI / KRONE_SEG;
    const s = Math.sin(phi);
    return [rxy * s * Math.cos(th), rxy * s * Math.sin(th), zc + rz * Math.cos(phi)];
  };
  const oben = [0, 0, zc + rz], unten = [0, 0, zc - rz];
  for (let k = 0; k < KRONE_SEG; k++) {
    out.push([oben, punkt(1, k), punkt(1, k + 1)]);
    out.push([unten, punkt(KRONE_RINGE - 1, k + 1), punkt(KRONE_RINGE - 1, k)]);
  }
  for (let i = 1; i < KRONE_RINGE - 1; i++) {
    for (let k = 0; k < KRONE_SEG; k++) {
      out.push([punkt(i, k), punkt(i + 1, k), punkt(i, k + 1)]);
      out.push([punkt(i, k + 1), punkt(i + 1, k), punkt(i + 1, k + 1)]);
    }
  }
  return out;
}

/**
 * Dreiecke eines Baums in Metern um seinen Fußpunkt (x Ost, y Nord, z oben).
 * Laub-/Obstbaum: Stamm + Ellipsoid-Krone; Nadelbaum: Stamm + zwei Kegel.
 * @param {{hoehe:number,krone:number,stamm:number,art:string,drehung?:number}} b
 * @returns {{krone:number[][][], stamm:number[][][]}}
 */
export function baumDreiecke(b) {
  const H = b.hoehe, R = b.krone / 2, dreh = b.drehung || 0;
  const k = baumKrone(b);
  if (k.form === 'kegel') {
    const z0 = k.z0;
    const krone = [
      ...kegel(R, z0, z0 + (H - z0) * 0.72, KEGEL_SEG, dreh),
      ...kegel(R * 0.72, z0 + (H - z0) * 0.4, H, KEGEL_SEG, dreh + Math.PI / KEGEL_SEG),
    ];
    return { krone, stamm: prisma(b.stamm, 0, z0 + 0.2, STAMM_SEG, dreh) };
  }
  const zb = k.zc - k.rz;
  return {
    krone: ellipsoid(R, k.rz, k.zc, dreh),
    stamm: prisma(b.stamm, 0, zb + Math.min(k.rz, 0.6), STAMM_SEG, dreh),
  };
}
