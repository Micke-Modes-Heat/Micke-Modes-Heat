// ── lib/varianten-regeln.js — Was gilt in welcher Variante? ─────────────────
//
// Eine Regel für das ganze Projekt: Was da ist oder ohnehin kommt, gilt in
// allen Varianten (gemeinsamer Stamm). Was entschieden wird, gilt nur in der
// Variante, in der es entschieden wurde (Paket der Variante).
//
// Hier liegen die reinen Funktionen dazu — importfrei bis auf die Schicht-
// Konstanten, DOM-frei, direkt testbar. Den Zustand (welche Variante aktiv ist,
// was in welchem Paket liegt) hält weiterhin 01-globals-varianten.js.

import { SCHICHT, normSchicht } from './schichten.js';

/** Schlüssel einer Variante; der Hauptplan hat intern die id null. */
export const HAUPTPLAN_KEY = 'base';
export const HAUPTPLAN_NAME = 'Hauptplan';
export function variantKey(id) { return id == null ? HAUPTPLAN_KEY : String(id); }

// ── Schicht neuer Objekte ableiten ───────────────────────────────────────────

/**
 * Bedarfsseite (kommt ohnehin) gegen Entscheidungsseite (wird geplant).
 * Gebäude und Verbraucher beschreiben, was die Liegenschaft braucht; Erzeuger,
 * Netz und Speicher, wie man es deckt. Diese Trennung braucht auch die
 * Bedarfsprognose im Gutachten.
 */
export function kategorieFuerAsset(assetKategorie) {
  return assetKategorie === 'verbraucher' ? 'bedarf' : 'entscheidung';
}

/**
 * Schicht für ein NEUES Objekt.
 *   modus      'auto' oder eine feste Schicht (Nutzer hat überschrieben)
 *   kategorie  'bedarf' | 'entscheidung'
 *   jahr       Betrachtungsjahr (Jahres-Slider)
 *   basisjahr  erstes Jahr des Sliders = „heute"
 * Steht der Slider auf heute, wird Bestand erfasst. In der Zukunft kommt
 * Bedarf ohnehin (Entwicklung), alles andere ist eine Planungsentscheidung.
 */
export function schichtFuerNeu({ modus = 'auto', kategorie = 'entscheidung', jahr, basisjahr } = {}) {
  if (modus && modus !== 'auto') return normSchicht(modus);
  const j = Number(jahr), b = Number(basisjahr);
  if (!Number.isFinite(j) || !Number.isFinite(b) || j <= b) return SCHICHT.BESTAND;
  return kategorie === 'bedarf' ? SCHICHT.ENTWICKLUNG : SCHICHT.ENTSCHEIDUNG;
}

/** Baujahr für ein neues Objekt: das Slider-Jahr, sobald es in der Zukunft liegt. */
export function baujahrFuerNeu({ jahr, basisjahr } = {}) {
  const j = Number(jahr), b = Number(basisjahr);
  return (Number.isFinite(j) && Number.isFinite(b) && j > b) ? j : null;
}

/**
 * Wirkungsbereich einer Schicht: 'alle' (gemeinsamer Stamm) oder 'variante'.
 */
export function wirkungAusSchicht(schicht) {
  return normSchicht(schicht) === SCHICHT.ENTSCHEIDUNG ? 'variante' : 'alle';
}

// ── Maßnahmen mit Geltungsbereich ────────────────────────────────────────────
//
// Maßnahme.variante: null = gilt in allen Varianten; sonst der variantKey.
// Fehlt das Feld ganz, ist die Maßnahme neu und bekommt beim Abschluss der
// Planungstransaktion ihre Vorgabe (massnahmeStandardVariante).

/** Typen, die ohnehin anfallen und deshalb für alle Varianten gelten
 *  (Ersatz am Ende der Lebensdauer, Instandhaltung). */
const OHNEHIN_TYPEN = new Set(['ersatz', 'erneuerung', 'instandhaltung', 'lebensdauer']);

export function massnahmeStandardVariante({ objektSchicht, typ, aktivKey } = {}) {
  // An Objekten, die selbst nur in einer Variante existieren, ist die
  // Zuordnung schon durch das Objekt gegeben.
  if (normSchicht(objektSchicht) === SCHICHT.ENTSCHEIDUNG) return null;
  if (OHNEHIN_TYPEN.has(String(typ || '').toLowerCase())) return null;
  return aktivKey ?? HAUPTPLAN_KEY;
}

/** Gilt die Maßnahme in der Variante `key`? */
export function massnahmeGiltIn(m, key) {
  return m?.variante == null || m.variante === key;
}

/**
 * Nimmt aus den Objekten alle Maßnahmen der Variante `key` heraus und gibt sie
 * als Ablage zurück: [{ ziel, id, m }]. `objekte` = [{ ziel, id, obj }].
 * Die Objekte werden in-place verändert.
 */
export function massnahmenHerausnehmen(objekte, key) {
  const ablage = [];
  for (const { ziel, id, obj } of (objekte || [])) {
    const liste = obj?.massnahmen;
    if (!Array.isArray(liste) || !liste.length) continue;
    const bleiben = [];
    for (const m of liste) {
      if (m && m.variante != null && m.variante === key) ablage.push({ ziel, id, m });
      else bleiben.push(m);
    }
    if (bleiben.length !== liste.length) liste.splice(0, liste.length, ...bleiben);
  }
  return ablage;
}

/**
 * Legt abgelegte Maßnahmen wieder an ihre Objekte. Gibt die Einträge zurück,
 * deren Objekt nicht mehr existiert (z. B. gelöschtes Asset).
 */
export function massnahmenEinsetzen(objekte, ablage) {
  const nachZiel = new Map((objekte || []).map(o => [`${o.ziel}|${o.id}`, o.obj]));
  const verwaist = [];
  for (const e of (ablage || [])) {
    const obj = nachZiel.get(`${e.ziel}|${e.id}`);
    if (!obj) { verwaist.push(e); continue; }
    if (!Array.isArray(obj.massnahmen)) obj.massnahmen = [];
    if (!obj.massnahmen.some(m => m?.id === e.m?.id)) obj.massnahmen.push(e.m);
  }
  return verwaist;
}

// ── Wärmenetz: Geometrie gemeinsam, Parameter je Variante ────────────────────

const GEOMETRIE_FELDER = ['trasse', 'trasseSegments', 'graph'];

export function waermeGeometrie(netzState) {
  if (!netzState) return null;
  const out = {};
  for (const k of GEOMETRIE_FELDER) if (k in netzState) out[k] = netzState[k];
  return out;
}

export function geometrieGleich(a, b) {
  return JSON.stringify(waermeGeometrie(a) || {}) === JSON.stringify(waermeGeometrie(b) || {});
}

/** Setzt Parameter einer Variante mit der gemeinsamen Geometrie zusammen. */
export function netzMitGeometrie(netzState, geometrie) {
  if (!geometrie) return netzState;
  return { ...(netzState || {}), ...geometrie };
}

// ── Dach-PV: Dachdaten gemeinsam, Belegung je Variante ───────────────────────

export const PV_BELEGUNG_FELDER = [
  'pvAktiv', 'pvDachanteil', 'pvModus', 'pvFlaechen', 'pvFlGcr',
  'pvFlAusrichtung', 'pvFlBelegung', 'pvBaujahr',
];

// Kartenlayer hängen direkt an den Flächen — sie gehören nicht zum Datenstand.
const _LAUFZEIT = new Set(['layer', 'svgLayer', '_layer', 'marker']);
function _klon(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(_klon);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (_LAUFZEIT.has(k) || typeof x === 'function') continue;
    out[k] = _klon(x);
  }
  return out;
}

/** { [gebId]: { pvAktiv, … } } aus der Gebäudeliste. */
export function pvBelegungErfassen(gebaeude) {
  const out = {};
  for (const g of (gebaeude || [])) {
    const e = {};
    for (const k of PV_BELEGUNG_FELDER) e[k] = _klon(g[k]);
    out[g.id] = e;
  }
  return out;
}

/** Unterscheiden sich zwei Belegungen eines Gebäudes? */
export function pvBelegungGleich(a, b) {
  return JSON.stringify(_klon(a || {})) === JSON.stringify(_klon(b || {}));
}

/**
 * Spielt eine erfasste Belegung auf die Gebäude. Gebäude ohne Eintrag
 * (seit der Erfassung neu angelegt) behalten ihren Stand. Gibt die Zahl der
 * geänderten Gebäude zurück.
 */
export function pvBelegungAnwenden(gebaeude, belegung, vorher) {
  if (!belegung) return [];
  const geaendert = [];
  for (const g of (gebaeude || [])) {
    const e = belegung[g.id];
    if (!e) continue;
    const alt = {};
    for (const k of PV_BELEGUNG_FELDER) alt[k] = g[k];
    let anders = false;
    for (const k of PV_BELEGUNG_FELDER) {
      if (!(k in e)) continue;
      if (JSON.stringify(_klon(g[k])) !== JSON.stringify(e[k])) { g[k] = _klon(e[k]); anders = true; }
    }
    if (anders) { geaendert.push(g); if (vorher) vorher.set(g.id, alt); }
  }
  return geaendert;
}

// ── Ergebnis-Stempel ─────────────────────────────────────────────────────────

/** Stempel für ein gerade berechnetes Ergebnis. */
export function ergebnisStempel(aktivId, name, jetzt = new Date()) {
  return { variantKey: variantKey(aktivId), name: name || HAUPTPLAN_NAME, zeit: jetzt.toISOString() };
}

/**
 * Passt das Ergebnis zur aktiven Variante? Gibt null zurück, wenn ja (oder
 * kein Stempel da ist), sonst { name, zeit } der Variante, für die gerechnet wurde.
 */
export function stempelAbweichung(stempel, aktivId) {
  if (!stempel?.variantKey) return null;
  return stempel.variantKey === variantKey(aktivId) ? null : { name: stempel.name, zeit: stempel.zeit };
}

export function datumKurz(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

// ── Zeitstrahl ───────────────────────────────────────────────────────────────

/**
 * Sammelt alle datierten Ereignisse für den Zeitstrahl.
 * eingabe: {
 *   basisjahr,
 *   gebaeude:  [{ id, name, baujahr, abrissjahr, schicht }],
 *   assets:    [{ id, name, baujahr, abrissjahr, schicht, massnahmen }]   — Live-Stand (aktive Variante)
 *   pakete:    [{ key, name, items: [{ id, name, baujahr, … }] }]       — Entscheidungen je Variante
 *   massnahmenAblage: { [key]: [{ id, m }] }                             — Maßnahmen nicht aktiver Varianten
 *   aktivKey, jahrVon(m)
 * }
 * Rückgabe: [{ spur, jahr, titel, art, ziel, id }]
 *   spur  'stamm' oder ein variantKey
 *   art   'bestand' | 'entwicklung' | 'entscheidung' | 'massnahme' | 'abriss'
 */
export function zeitstrahlEintraege({ basisjahr, gebaeude = [], assets = [], pakete = [], massnahmenAblage = {}, aktivKey = HAUPTPLAN_KEY, jahrVon } = {}) {
  const out = [];
  const zahl = v => { const n = parseInt(v); return Number.isFinite(n) ? n : null; };
  const mj = m => (jahrVon ? jahrVon(m) : zahl(m?.jahr));
  const b = zahl(basisjahr) ?? new Date().getFullYear();

  const objekt = (o, ziel, spur) => {
    const bj = zahl(o.baujahr), aj = zahl(o.abrissjahr);
    const s = normSchicht(o.schicht);
    if (bj && bj > b) out.push({ spur, jahr: bj, titel: o.name || o.id, art: s === SCHICHT.ENTSCHEIDUNG ? 'entscheidung' : 'entwicklung', ziel, id: o.id });
    if (aj && aj > b) out.push({ spur: s === SCHICHT.ENTSCHEIDUNG ? spur : 'stamm', jahr: aj, titel: `Abriss ${o.name || o.id}`, art: 'abriss', ziel, id: o.id });
  };

  for (const g of gebaeude) objekt(g, 'gebaeude', 'stamm');

  const massnahme = (m, o, ziel, spurFallback) => {
    const j = mj(m);
    if (!j) return;
    const spur = m.variante == null ? spurFallback : m.variante;
    out.push({ spur, jahr: j, titel: `${o?.name || ''}: ${m.titel || 'Maßnahme'}`.replace(/^: /, ''), art: 'massnahme', ziel, id: o?.id });
  };

  for (const a of assets) {
    const entsch = normSchicht(a.schicht) === SCHICHT.ENTSCHEIDUNG;
    if (!entsch) objekt(a, 'asset', 'stamm');
    for (const m of (a.massnahmen || [])) massnahme(m, a, 'asset', entsch ? aktivKey : 'stamm');
  }

  for (const p of pakete) {
    const quelle = p.key === aktivKey ? assets.filter(a => normSchicht(a.schicht) === SCHICHT.ENTSCHEIDUNG) : (p.items || []);
    for (const a of quelle) {
      objekt({ ...a, schicht: SCHICHT.ENTSCHEIDUNG }, 'asset', p.key);
      if (p.key !== aktivKey) for (const m of (a.massnahmen || [])) massnahme(m, a, 'asset', p.key);
    }
  }

  const namen = new Map(assets.map(a => [a.id, a]));
  for (const [key, liste] of Object.entries(massnahmenAblage || {})) {
    if (key === aktivKey) continue;
    for (const e of (liste || [])) massnahme({ ...e.m, variante: key }, namen.get(e.id) || { id: e.id, name: e.id }, e.ziel || 'asset', key);
  }

  return out.sort((x, y) => x.jahr - y.jahr || String(x.titel).localeCompare(String(y.titel)));
}
