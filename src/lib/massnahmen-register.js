// ── lib/massnahmen-register.js — Maßnahmenliste des Projekts (Ebene 1) ──────────
// DOM- und importfrei. Konzept: https://claude.ai/artifact/CjEyqSi1gxsxw8b4GuByLW
//
// Zwei Ebenen: Ein Eintrag der Liste ist die Maßnahme, wie sie im Gutachten steht
// (Nummer, Gewerk, Stand, Anlass, Kosten). Die Wirkungen sind die bisherigen
// Objekt-Maßnahmen an Assets, Kabeln und Gebäuden (`obj.massnahmen[]` mit
// Ziel-Parametern ab einem Jahr); sie verweisen über `m.massnahmeRef` auf ihren
// Eintrag. Die Rechnung liest weiter nur die Wirkungen — deshalb hält der
// Abgleich deren gemeinsame Felder (Titel, Jahr, Phase, Status, Geltung, Kosten)
// mit dem Eintrag in Deckung.
//
// Eintrag = { id, nr, titel, gewerk, art, stand, dringlichkeit, jahr, phaseId,
//   variante?, anlass: { quelle, ref?, text? }, kosten: { investEur, herkunft },
//   begruendung, mehrfach, ohneObjekt, _sync, _wirkung }
//   mehrfach   — darf mehrere Objekte betreffen (Cluster-Paket, „an Maßnahme hängen“);
//                sonst wird eine kopierte Wirkung zu einer eigenen Maßnahme.
//   ohneObjekt — bewusst ohne Wirkung angelegt (Fachplanung, Bestandsaufnahme …);
//                sonst verschwindet ein Eintrag mit seiner letzten Wirkung.
//   _sync      — Stand der gemeinsamen Felder beim letzten Abgleich; weicht eine
//                Wirkung davon ab, wurde sie bearbeitet und gibt die Werte vor.
//   _wirkung   — Schlüssel der Wirkungen beim letzten Abgleich (Wiedererkennung ohne Verweis).

export const MR_STAENDE = Object.freeze(['vorschlag', 'empfohlen', 'beschlossen', 'umgesetzt', 'verworfen']);

export const MR_GEWERKE = Object.freeze({
  elektro: 'Elektro', waerme: 'Wärme', pv: 'PV', resilienz: 'Resilienz', hochbau: 'Hochbau', ga: 'GA', allgemein: 'Allgemein',
});

const ELEKTRO = new Set(['NAP', 'Schaltanlage', 'Trafo', 'NSHV', 'UV', 'KVS', 'Verbraucher', 'Lade', 'Reserve']);
const ERZEUGUNG_STROM = new Set(['PV', 'Batterie', 'Wind', 'H2']);
const WAERME = new Set(['WP', 'Geo', 'FG', 'Stromkessel', 'TWW', 'KWK']);

/** Gewerk aus dem Objekt, an dem die Wirkung hängt. */
export function mrGewerk(ziel, objTyp) {
  if (ziel === 'kante') return 'elektro';
  if (ziel === 'gebaeude') return 'hochbau';
  if (objTyp === 'Nsa') return 'resilienz';
  if (ELEKTRO.has(objTyp)) return 'elektro';
  if (ERZEUGUNG_STROM.has(objTyp)) return 'pv';
  if (WAERME.has(objTyp)) return 'waerme';
  return 'allgemein';
}

/** „M07“ — zweistellig, ab 100 dreistellig. */
export function mrNummer(nr) {
  return Number.isFinite(nr) ? `M${String(nr).padStart(2, '0')}` : 'M–';
}

/** Status der Wirkung (für die Rechnung) aus dem Stand der Maßnahme. */
export function mrStatusAusStand(stand) {
  if (stand === 'umgesetzt') return 'umgesetzt';
  if (stand === 'verworfen') return 'abgelehnt';
  return 'geplant';
}

/**
 * Stand aus dem Status einer Wirkung. Ein „geplant“ lässt einen feineren Stand stehen (empfohlen/beschlossen);
 * eine automatisch erzeugte Maßnahme ist ein Vorschlag, bis jemand sie bearbeitet.
 */
export function mrStandAusStatus(m, bisher = null, autoTag = null) {
  if (m?.status === 'umgesetzt') return 'umgesetzt';
  if (m?.status === 'abgelehnt') return 'verworfen';
  if (autoTag && m?.[autoTag]) return 'vorschlag';
  if (bisher === 'empfohlen' || bisher === 'beschlossen') return bisher;
  return 'empfohlen';
}

const jahrNorm = j => { const n = parseInt(j, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const zahl = x => Number(x) || 0;

/** Gemeinsame Felder einer Wirkung, so wie der Abgleich sie vergleicht. */
function signatur(m, mitKosten, autoTag) {
  return {
    titel: String(m?.titel ?? ''),
    jahr: jahrNorm(m?.jahr),
    phaseId: m?.phaseId ?? null,
    status: m?.status || 'geplant',
    variante: m && 'variante' in m ? (m.variante ?? null) : undefined,
    kosten: mitKosten ? zahl(m?.kosten) : undefined,
    auto: !!(autoTag && m?.[autoTag]),
  };
}
function gleich(a, b) {
  if (!a || !b) return false;
  return a.titel === b.titel && a.jahr === b.jahr && a.phaseId === b.phaseId && a.status === b.status
    && (a.variante === undefined || b.variante === undefined || a.variante === b.variante)
    && (a.kosten === undefined || b.kosten === undefined || a.kosten === b.kosten)
    && a.auto === b.auto;
}

function anlassAus(m, autoTag) {
  if ((autoTag && m?.[autoTag]) || String(m?.id ?? '').startsWith('auto_')) return { quelle: 'engpass' };
  if (m?.clusterId != null) return { quelle: 'cluster', ref: m.clusterId, text: m.clusterName || '' };
  return { quelle: 'manuell' };
}

/** Neuer Eintrag aus einer Wirkung (Übernahme der Altdaten, neu angelegte Objekt-Maßnahme). */
export function mrEintragAusWirkung(id, w, autoTag = null) {
  const m = w.m;
  const anlass = anlassAus(m, autoTag);
  const e = {
    id, nr: null,
    titel: String(m?.titel ?? ''),
    gewerk: mrGewerk(w.ziel, w.objTyp),
    art: m?.typ || 'Sonstiges',
    stand: mrStandAusStatus(m, null, autoTag),
    dringlichkeit: null,
    jahr: jahrNorm(m?.jahr),
    phaseId: m?.phaseId ?? null,
    anlass,
    kosten: { investEur: zahl(m?.kosten), herkunft: anlass.quelle === 'engpass' ? 'kennwert' : null },
    begruendung: '',
    mehrfach: false,
    ohneObjekt: false,
    _sync: null,
  };
  if (m && 'variante' in m) e.variante = m.variante ?? null;
  return e;
}

/**
 * Liste und Wirkungen abgleichen. Verändert die Wirkungen (massnahmeRef und gemeinsame Felder) und die
 * Einträge an Ort und Stelle.
 *
 * register:  bisherige Einträge (wird nicht ersetzt, sondern in-place fortgeschrieben)
 * wirkungen: [{ ziel: 'asset'|'kante'|'gebaeude', objId, objLabel, objTyp, m }] — dieselbe Objekt-Maßnahme darf
 *            mehrfach vorkommen (Kopien in Varianten-Snapshots); sie zählt einmal und alle Kopien werden geschrieben.
 * opts:      { neueId: () => string, autoTag }
 *
 * Rückgabe: { register, neu, entfernt, getrennt, wirkungenJe: Map(eintragId → [{ ziel, objId, objLabel, objTyp, kopien }]) }
 */
export function mrAbgleich(register, wirkungen, opts = {}) {
  const autoTag = opts.autoTag || null;
  let seq = 0;
  const erzeuge = opts.neueId || (() => `mr_${Date.now().toString(36)}_${(seq++).toString(36)}`);
  const liste = Array.isArray(register) ? register : [];
  const byId = new Map(liste.map(e => [e.id, e]));
  const neueId = () => { let id; do id = erzeuge(); while (byId.has(id)); return id; };
  // Wo stand eine Wirkung beim letzten Abgleich? Fängt Objekt-Maßnahmen auf, die neu erzeugt wurden und dabei
  // ihren Verweis verloren haben (Cluster-Paket neu anwenden, Fahrplan zurückschreiben) — Nummer bleibt erhalten.
  const altKey = new Map();
  for (const e of liste) for (const k of e._wirkung || []) altKey.set(k, e);

  // Wirkungen je Objekt-Maßnahme bündeln (Kopien aus Snapshots zusammen)
  const gruppen = new Map();
  for (const w of wirkungen || []) {
    if (!w?.m || w.m.id == null) continue;
    const key = `${w.ziel}|${w.objId}|${w.m.id}`;
    if (!gruppen.has(key)) gruppen.set(key, { ziel: w.ziel, objId: w.objId, objLabel: w.objLabel, objTyp: w.objTyp, kopien: [] });
    const g = gruppen.get(key);
    if (!g.kopien.includes(w.m)) g.kopien.push(w.m);
  }

  // Jede Wirkung einem Eintrag zuordnen
  const wirkungenJe = new Map();
  const neue = [];
  let getrennt = 0;
  const frei = e => e && (e.mehrfach || !wirkungenJe.get(e.id)?.length);
  // Wirkungen, die schon beim letzten Abgleich an ihrem Eintrag hingen, zuerst — so behält bei einer Kopie
  // (Objekt dupliziert, Variante aus einer anderen angelegt) das Original seinen Eintrag und seine Nummer.
  const bekannt = ([key, g]) => {
    const ref = g.kopien.map(m => m.massnahmeRef).find(r => r != null);
    return ref != null && (byId.get(ref)?._wirkung || []).includes(key);
  };
  const reihenfolge = [...gruppen].sort((x, y) => Number(bekannt(y)) - Number(bekannt(x)));
  for (const [key, g] of reihenfolge) {
    const ref = g.kopien.map(m => m.massnahmeRef).find(r => r != null) ?? null;
    let e = ref != null ? byId.get(ref) : null;
    if (e && !frei(e)) { e = null; getrennt++; }   // kopiertes Objekt
    if (!e && (ref == null || !byId.has(ref)) && frei(altKey.get(key))) e = altKey.get(key);
    if (!e) {
      const id = ref != null && !byId.has(ref) ? ref : neueId();
      e = mrEintragAusWirkung(id, { ...g, m: g.kopien[0] }, autoTag);
      byId.set(id, e);
      liste.push(e);
      neue.push(e);
    }
    if (!wirkungenJe.has(e.id)) wirkungenJe.set(e.id, []);
    wirkungenJe.get(e.id).push(g);
    for (const m of g.kopien) m.massnahmeRef = e.id;
  }

  // Einträge, deren letzte Wirkung gelöscht wurde, fallen weg (außer bewusst objektlose)
  let entfernt = 0;
  for (let i = liste.length - 1; i >= 0; i--) {
    const e = liste[i];
    if (!wirkungenJe.has(e.id) && !e.ohneObjekt) { liste.splice(i, 1); entfernt++; }
  }

  // Gemeinsame Felder abgleichen: bearbeitete Wirkung gibt vor, dann alle Wirkungen schreiben
  for (const e of liste) {
    const gs = wirkungenJe.get(e.id);
    if (!gs?.length) continue;
    const einzeln = gs.length === 1;
    const alle = gs.flatMap(g => g.kopien);
    const bearbeitet = alle.find(m => !gleich(signatur(m, einzeln, autoTag), e._sync));
    if (bearbeitet) {
      e.titel = String(bearbeitet.titel ?? '');
      e.jahr = jahrNorm(bearbeitet.jahr);
      e.phaseId = bearbeitet.phaseId ?? null;
      e.stand = mrStandAusStatus(bearbeitet, e.stand, autoTag);
      if ('variante' in bearbeitet) e.variante = bearbeitet.variante ?? null;
      if (einzeln) e.kosten = { ...(e.kosten || {}), investEur: zahl(bearbeitet.kosten) };
    }
    const status = mrStatusAusStand(e.stand);
    for (const m of alle) {
      m.titel = e.titel;
      m.jahr = e.jahr;
      m.phaseId = e.phaseId;
      // Ein Vorschlag bleibt in der Rechnung „geplant“ — der feinere Stand lebt nur am Eintrag
      m.status = status;
      if ('variante' in e && 'variante' in m) m.variante = e.variante;
      if (einzeln) m.kosten = zahl(e.kosten?.investEur);
    }
    e._sync = signatur(alle[0], einzeln, autoTag);
    e._wirkung = gs.map(g => `${g.ziel}|${g.objId}|${g.kopien[0].id}`);
  }

  // Nummern für neue Einträge, chronologisch
  let max = liste.reduce((x, e) => (Number.isFinite(e.nr) && e.nr > x ? e.nr : x), 0);
  neue.filter(e => liste.includes(e))
    .sort((a, b) => (a.jahr ?? 9999) - (b.jahr ?? 9999) || a.titel.localeCompare(b.titel, 'de'))
    .forEach(e => { e.nr = ++max; });

  return { register: liste, neu: neue.filter(e => liste.includes(e)).length, entfernt, getrennt, wirkungenJe };
}
