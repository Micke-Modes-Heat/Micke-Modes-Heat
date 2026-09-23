// ── 29-pvna-schema.js — Einlinienschema der Variante „Bestandsnetz" ──────────
//
// Ansicht „Einlinienschema (Bestandsnetz)" in der PV-Analyse: das radiale Modell
// aus 28-pv-netzaufnahme.js als abstraktes Einlinienschema (Trafo → Sammelschiene
// → Kabel → Knoten → Dächer), rechts neben jedem Dach ein Schieber.
//
// Startbelegung = berechnete Variante (Befüllung ohne Ertüchtigung). Mit dem
// Gesamtschieber (gleicher Anteil am Flächenpotenzial für alle Dächer) und den
// Einzelschiebern lässt sich die Belegung frei verändern; Kabel-/Trafo-Auslastung
// und Spannungsanhebung werden sofort mit pvnaLastfluss nachgerechnet.
// Auf jedem Schieber: ▼ = Wert der Variante, grünes Band = Spielraum des Dachs
// bei der aktuellen Belegung der übrigen Dächer (pvnaSpielraum).
//
// Die Variante „Bestandsnetz" bleibt unverändert. „Als Variante übernehmen" legt
// die Belegung in window._pvAnalyse.eigeneBelegung ab (→ Projektdatei) und rechnet
// die Varianten neu; daraus entsteht die Variante „Bestandsnetz, eigene Belegung"
// (09d, id 'netz-eigen'), geprüft über window.pvnaBelegungPruefen (28).
//
// Ausbaufahrplan: die Ertüchtigungen der Ausbautreppe (größerer Trafo, stärkeres
// Kabel) sind anklickbar — einzeln (⚒ im Schema bzw. Chip in der Liste) oder als
// Stufe „bis hier". Aktive Maßnahmen ändern Kapazität/ΔU der Elemente für alle
// Rechnungen des Schemas; „Bis zur Netzgrenze füllen" belegt danach neu. Beim
// Übernehmen gehen die aktiven Maßnahmen samt Invest mit in die Variante.
//
// Aussage: über dem Schema steht die Kernaussage in Worten (aufgenommene kWp,
// was begrenzt und wie viel Fläche dahinter frei bleibt, Trafo-Reserve, Einfluss
// der Verteilung, Datenlücken, Lastfall) — kopierbar fürs Gutachten. Elemente an
// ihrer Grenze sind im Schema rot umrandet (_engpaesse), das Element, das das
// gewählte Dach begrenzt, ist hervorgehoben. Der Fahrplan ist standardmäßig zu
// einer Zeile eingeklappt, damit das Schema oben bleibt; ⚒-Marken erscheinen nur
// bei aufgeklapptem Fahrplan. kWp lassen sich per Klick auf den Wert eintippen;
// liegt ein Dach über seinem Spielraum, nennt _abregelText die Alternative
// „am EZA-Regler begrenzen" (pvnaAbregelungDach, 28). Kabel ohne Querschnitt
// lassen sich mit einer Annahme rechnen (pvnaErsatzQsSetzen, 28).
// Gutachten: pvnaSchemaDruck liefert eine Zeichenliste, 17 zeichnet daraus die
// Abbildungen „Einlinienschema Bestandsnetz" (3.4.2).

import { pvnaAbregelungDach, pvnaErsatzOptionen, pvnaErsatzQsSetzen, pvnaFuerVariante, pvnaLetztesErgebnis,
  pvnaMassnahmenAnwenden, pvnaRechnen } from './28-pv-netzaufnahme.js';
import { pvnaFuellen, pvnaLastfluss, pvnaSpielraum } from './lib/pv-netzaufnahme-core.js';
import { escHtml } from './03c-gebaeude-io.js';

const ROW = 26;                  // Zeilenhöhe — SVG und Schieberliste teilen sie
const COL = 92;                  // Spaltenabstand je Netzebene
const X_TRAFO = 22, X_SCHIENE = 46;
const LIVE_MAX_DAECHER = 150;    // darüber Spielraum erst beim Loslassen rechnen

let _quelle = null;              // Ergebnisobjekt, zu dem die Belegung gehört
let _bel = new Map();            // dachId → kWp
let _spiel = new Map();          // dachId → { kwp, begrenzer }
let _auswahl = null;             // dachId
let _layout = null;
let _raf = 0;
let _meldung = '';               // Rückmeldung nach Übernehmen/Entfernen
let _nurPv = true;               // Abgänge ohne PV und ohne Einspeisung einklappen
let _leerAuf = new Set();        // Knoten, deren Abgänge ohne PV trotzdem aufgeklappt sind
let _vollbild = false;           // Ganzseitenansicht (fixiert über der App)
let _einpassen = true;           // in der Ganzseitenansicht alles auf den Bildschirm skalieren
let _zu = new Set();             // eingeklappte Knoten (Element-IDs: Trafo oder Verteiler)
let _mass = new Set();           // aktive Ertüchtigungen (Element-IDs mit massnahme)
let _eingCache = null;           // { erg, key, eingabe, grenzeKwp } — Eingabe mit aktiven Maßnahmen
let _ausgeklappt = false;        // in der PV-Analyse: volle Breite (Navigation weg) und volle Höhe
let _fahrplanAuf = false;        // Ausbaufahrplan aufgeklappt (sonst eine Zusammenfassungszeile)
let _beschr = 'auslastung';      // Kabelbeschriftung: 'auslastung' | 'du' | 'kabel'

// Ab diesem Anteil der Grenze gilt ein Element als Engpass der aktuellen Belegung
const ENGPASS_ANTEIL = 0.995;

const _fmt = (x, d = 0) => (x == null || !Number.isFinite(x)) ? '—'
  : x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const _auslFarbe = a => a > 100 + 1e-6 ? '#e53935' : a >= 70 ? '#ffb300' : '#66bb6a';
const _duFarbe = (u, g) => u > g + 1e-6 ? '#e53935' : u >= 0.7 * g ? '#ffb300' : '#66bb6a';
const _ART = { strom: 'Kabel-Strombelastbarkeit', trafo: 'Trafo-Nennleistung', spannung: 'Spannungsanhebung',
  'nicht-angebunden': 'nicht am Netz angebunden' };

// ══════════════════════════════════════════════════════════════════════════════
// LAYOUT — ein Baum je Trafo, jede Zeile trägt entweder einen Knoten ohne Dach
// oder genau ein Dach. Erstes Kind liegt auf der Zeile des Elternknotens (der
// Hauptstrang bleibt gerade), Dächer eines Knotens folgen nach seinen Abgängen.
// ══════════════════════════════════════════════════════════════════════════════

function _layoutBilden(modell, nurPv, zuSet = _zu, leerAufSet = _leerAuf) {
  const { elemente, daecher } = modell.eingabe;
  const { elInfo, dachInfo } = modell.info;
  // Relevant sind Elemente, über die PV oder vorhandene Einspeisung fließt. Ein
  // Abgang ohne beides trägt keinen Fluss; sein ΔU gleicht dem des Elternknotens.
  const byId = new Map(elemente.map(e => [e.id, e]));
  const relevant = new Set();
  const hoch = id => { while (id != null && byId.has(id) && !relevant.has(id)) { relevant.add(id); id = byId.get(id).parentId; } };
  for (const d of daecher) hoch(d.elementId);
  for (const e of elemente) if (+e.vorlastKw > 0) hoch(e.id);
  // Abgänge ohne PV werden je Elternknoten zu einer Zeile „⊕ n Abgänge ohne PV"
  // eingeklappt, bis man sie dort aufklappt (_leerAuf).
  const alleKinder = new Map();
  for (const e of elemente) {
    if (e.parentId == null) continue;
    if (!alleKinder.has(e.parentId)) alleKinder.set(e.parentId, []);
    alleKinder.get(e.parentId).push(e.id);
  }
  const groesse = id => 1 + (alleKinder.get(id) || []).reduce((t, k) => t + groesse(k), 0);
  // Eingeklappt wird nur am Übergang vom PV-Strang (oder Trafo) in einen Zweig ohne PV;
  // innerhalb eines aufgeklappten Zweigs bleibt alles offen.
  const ursprung = id => relevant.has(id) || byId.get(id)?.typ === 'trafo';
  const kinder = new Map(), leer = new Map();
  let ausgeblendet = 0;
  for (const [pid, ks] of alleKinder) {
    for (const id of ks) {
      const zu = nurPv && !relevant.has(id) && ursprung(pid) && !leerAufSet.has(pid);
      if (zu) ausgeblendet += groesse(id);
      const m = zu ? leer : kinder;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid).push(id);
    }
  }
  // Knoten, an denen es überhaupt Abgänge ohne PV gibt (für „⊖ einklappen")
  const mitLeer = new Set([...alleKinder].filter(([pid, ks]) => ursprung(pid) && ks.some(id => !relevant.has(id))).map(([pid]) => pid));
  const dachAn = new Map();
  const frei = [];
  for (const d of daecher) {
    if (d.elementId == null || !elInfo.has(d.elementId)) { frei.push(d.id); continue; }
    if (!dachAn.has(d.elementId)) dachAn.set(d.elementId, []);
    dachAn.get(d.elementId).push(d.id);
  }
  const dname = id => dachInfo.get(id)?.name || id;
  for (const l of dachAn.values()) l.sort((a, b) => dname(a).localeCompare(dname(b), 'de'));
  // Tiefster Abgang zuerst → Hauptstrang gerade
  const tiefe = new Map();
  const tiefeVon = id => {
    if (tiefe.has(id)) return tiefe.get(id);
    tiefe.set(id, 0);
    const t = 1 + Math.max(0, ...(kinder.get(id) || []).map(tiefeVon));
    tiefe.set(id, t);
    return t;
  };
  for (const l of kinder.values()) l.sort((a, b) => tiefeVon(b) - tiefeVon(a));
  // Alle Dächer unterhalb eines Knotens (für eingeklappte Knoten: Summe + Gruppenschieber)
  const unter = new Map();
  const unterVon = id => {
    if (unter.has(id)) return unter.get(id);
    unter.set(id, []);
    const l = [...(dachAn.get(id) || []), ...(kinder.get(id) || []).flatMap(unterVon)];
    unter.set(id, l);
    return l;
  };

  const rows = [];
  const pos = new Map();            // elementId → { depth, row, lastRow }
  let maxDepth = 1;
  const place = (eid, depth) => {
    const start = rows.length;
    maxDepth = Math.max(maxDepth, depth);
    const ks = kinder.get(eid) || [];
    const ds = dachAn.get(eid) || [];
    if (zuSet.has(eid) && (ks.length || ds.length)) {
      rows.push({ typ: 'zu', eid, daecher: unterVon(eid) });
      pos.set(eid, { depth, row: start, lastRow: start, zu: true });
      return;
    }
    const lz = leer.get(eid) || [];
    if (!ks.length && !ds.length && !lz.length) rows.push({ typ: 'knoten', eid });
    for (const k of ks) place(k, depth + 1);
    for (const id of ds) rows.push({ typ: 'dach', dachId: id, eid });
    if (lz.length) rows.push({ typ: 'leer', eid, anzahl: lz.length, elemente: lz.reduce((t, k) => t + groesse(k), 0) });
    else if (nurPv && leerAufSet.has(eid) && mitLeer.has(eid)) rows.push({ typ: 'leerAuf', eid });
    pos.set(eid, { depth, row: start, lastRow: rows.length - 1 });
  };
  for (const t of elemente.filter(e => e.typ === 'trafo')) {
    if (rows.length) rows.push({ typ: 'luecke' });
    rows.push({ typ: 'trafo', eid: t.id });
    place(t.id, 0);
  }
  if (frei.length) {
    rows.push({ typ: 'luecke' });
    rows.push({ typ: 'frei' });
    for (const id of frei) rows.push({ typ: 'dach', dachId: id, eid: null });
  }
  const xRoof = X_SCHIENE + maxDepth * COL + 34;
  // Einklappbar = Knoten mit Abgängen oder mehreren Dächern
  const klappbar = new Set([...byId.keys()].filter(id => byId.get(id).typ === 'trafo'
    || (kinder.get(id) || []).length || (dachAn.get(id) || []).length > 1));
  return { rows, pos, kinder, xRoof, breite: xRoof + 16, hoehe: rows.length * ROW, ausgeblendet, klappbar, mitLeer };
}

/** Eingabe mit den aktiven Maßnahmen (gecacht je Ergebnis und Auswahl) + Netzgrenze der Befüllung. */
function _eing(erg = _quelle) {
  const key = [..._mass].sort().join('|');
  if (_eingCache?.erg !== erg || _eingCache.key !== key) {
    const eingabe = pvnaMassnahmenAnwenden(erg.modell.eingabe, _mass);
    _eingCache = { erg, key, eingabe, fuellung: pvnaFuellen(eingabe) };
  }
  return _eingCache.eingabe;
}
const _fuellung = (erg = _quelle) => { _eing(erg); return _eingCache.fuellung; };

/** Alle Elemente mit angebotener Ertüchtigung, Reihenfolge wie in der Ausbautreppe. */
function _massnahmenListe(erg) {
  const els = erg.modell.eingabe.elemente.filter(e => e.massnahme);
  const stufe = new Map();
  erg.treppe.schritte.forEach((st, i) => st.massnahmen.forEach(m => stufe.set(m.elementId, i + 1)));
  return els.map(e => ({ id: e.id, label: e.massnahme.label, investEUR: +e.massnahme.investEUR || 0,
    kapAlt: e.kapKw, kapNeu: e.massnahme.kapKw, typ: e.typ, stufe: stufe.get(e.id) || null }));
}

/**
 * Engpässe der aktuellen Belegung: Elemente an (oder über) ihrer Stromgrenze und
 * Knoten an der Spannungsgrenze. Die Spannung steigt zum Strangende hin monoton —
 * von einer Kette gleich hoher Knoten zählt nur der oberste (dahinter fließt nichts zu).
 */
function _engpaesse(eingabe, lf) {
  const grenze = eingabe.duGrenzePct;
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  const strom = eingabe.elemente
    .filter(e => Number.isFinite(e.kapKw) && e.kapKw > 0 && (lf.auslastungPct.get(e.id) || 0) >= 100 * ENGPASS_ANTEIL)
    .map(e => e.id);
  const anGrenze = new Set(eingabe.elemente
    .filter(e => e.typ !== 'trafo' && (lf.duPct.get(e.id) || 0) >= grenze * ENGPASS_ANTEIL).map(e => e.id));
  const spannung = [...anGrenze].filter(id => !anGrenze.has(byId.get(id)?.parentId));
  return { strom, spannung, alle: new Set([...strom, ...spannung]) };
}

/** Kabel mit dem größten Beitrag zur Spannungsanhebung auf dem Weg vom Knoten zum Trafo. */
function _hauptanteil(eingabe, lf, knotenId) {
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  let cur = knotenId, best = null, bestDu = -1;
  const ges = new Set();
  while (cur != null && byId.has(cur) && !ges.has(cur)) {
    ges.add(cur);
    const e = byId.get(cur);
    const du = (+e.duProKwPct || 0) * (lf.flussKw.get(cur) || 0);
    if (du > bestDu) { bestDu = du; best = cur; }
    cur = e.parentId;
  }
  return best;
}

/** Zusatz an der Knotenbeschriftung für vorhandene Einspeisung (Wind, KWK, Bestands-PV). */
const _vorlastText = e => +e?.vorlastKw > 0 ? ` · speist ${_fmt(e.vorlastKw)} kW (Bestand)` : '';

/** Dächer, deren Weg zum Trafo über das Element führt. */
function _daecherHinter(eingabe, elementId) {
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  return eingabe.daecher.filter(d => {
    let cur = d.elementId;
    const ges = new Set();
    while (cur != null && byId.has(cur) && !ges.has(cur)) { if (cur === elementId) return true; ges.add(cur); cur = byId.get(cur).parentId; }
    return false;
  });
}

const _nodeX = depth => depth === 0 ? X_SCHIENE : X_SCHIENE + depth * COL;
const _y = row => row * ROW + ROW / 2;

// ══════════════════════════════════════════════════════════════════════════════
// SVG
// ══════════════════════════════════════════════════════════════════════════════

function _pfadSet(eingabe, dachId) {
  const d = eingabe.daecher.find(x => x.id === dachId);
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  const s = new Set();
  let cur = d?.elementId;
  while (cur != null && byId.has(cur) && !s.has(cur)) { s.add(cur); cur = byId.get(cur).parentId; }
  return s;
}

/** ⚒-Marken nur bei aufgeklapptem Fahrplan — sonst nur die umgesetzten (die Bestandsansicht bleibt ruhig). */
const _massZeigen = id => _fahrplanAuf || _mass.has(id);

/** ⚒-Marke einer Ertüchtigung — Klick schaltet sie um. */
function _massMarke(e, x, y) {
  const an = _mass.has(e.id);
  const m = e.massnahme;
  const tip = `${m.label}\nInvest ${_fmt(m.investEUR)} €`
    + (Number.isFinite(m.kapKw) ? ` · danach ${_fmt(m.kapKw)} kW` : '')
    + `\nKlicken: ${an ? 'zurücknehmen' : 'umsetzen'}`;
  return `<g data-pvna-mass="${escHtml(e.id)}" style="cursor:pointer;"><title>${escHtml(tip)}</title>
    <circle cx="${x}" cy="${y}" r="6.5" fill="${an ? '#4fc3f7' : 'var(--surface2,#222)'}" stroke="#4fc3f7" stroke-width="1.2"/>
    <text x="${x}" y="${y + 3}" font-size="8" text-anchor="middle" fill="${an ? '#0b1a24' : '#4fc3f7'}" pointer-events="none">⚒</text></g>`;
}

function _svg(erg, lf) {
  const { modell } = erg;
  const { info } = modell;
  const eingabe = _eing(erg);
  const { rows, pos, kinder, xRoof, breite, hoehe } = _layout;
  const grenze = eingabe.duGrenzePct;
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  const dachById = new Map(eingabe.daecher.map(d => [d.id, d]));
  const markiert = _auswahl ? _pfadSet(eingabe, _auswahl) : new Set();
  const eng = _engpaesse(eingabe, lf);
  // Gewähltes Dach: das Element, das seinen Spielraum begrenzt
  const begrenzt = _auswahl ? _spiel.get(_auswahl)?.begrenzer?.elementId : null;
  const out = [];

  // 1 · Stränge (Sammelschiene bzw. Knoten-Spine), neutral
  for (const [eid, p] of pos) {
    const ks = kinder.get(eid) || [];
    const istTrafo = byId.get(eid).typ === 'trafo';
    if ((p.lastRow <= p.row || p.zu) && !istTrafo) continue;
    const x = _nodeX(p.depth);
    const bis = p.zu ? p.row : Math.max(p.lastRow, ...ks.map(k => pos.get(k).row));
    out.push(istTrafo
      ? `<line x1="${x}" x2="${x}" y1="${_y(p.row) - 8}" y2="${_y(bis) + 8}" stroke="var(--text)" stroke-width="4" stroke-linecap="round"/>`
      : `<line x1="${x}" x2="${x}" y1="${_y(p.row)}" y2="${_y(bis)}" stroke="var(--muted)" stroke-width="1.2"/>`);
  }

  // 2 · Kabel (waagrecht vom Strang des Elternknotens zum Knoten)
  for (const e of eingabe.elemente) {
    if (e.typ === 'trafo') continue;
    const p = pos.get(e.id), pp = pos.get(e.parentId);
    if (!p || !pp) continue;
    const i = info.elInfo.get(e.id) || {};
    const x1 = _nodeX(pp.depth), x2 = _nodeX(p.depth), y = _y(p.row);
    const a = lf.auslastungPct.get(e.id) || 0;
    const fl = lf.flussKw.get(e.id) || 0;
    const du = lf.duPct.get(e.id) || 0;
    const mk = markiert.has(e.id);
    const unbekannt = i.kab?.unbekannt, intern = i.kab?.stationsintern, ersatz = i.kab?.ersatz;
    const mMarke = !!e.massnahme && _massZeigen(e.id);
    const farbe = unbekannt || intern ? 'var(--muted)' : _auslFarbe(a);
    const tip = `${i.label || e.id}\n${i.kabelText || ''}\nFluss ${_fmt(fl)} kW`
      + (Number.isFinite(e.kapKw) ? ` von ${_fmt(e.kapKw)} kW (${_fmt(a)} %)` : ' — keine Stromgrenze')
      + `\nΔU am Knoten ${_fmt(du, 2)} %`;
    const ert = _mass.has(e.id) && e.massnahme;
    const engpass = eng.strom.includes(e.id);
    // Beschriftung je nach Modus: Auslastung, Spannungsanhebung am Knoten oder Kabeldaten
    let lbl = unbekannt ? '? mm²' : _fmt(a) + ' %', lblFarbe = farbe;
    if (_beschr === 'du') { lbl = _fmt(du, 2) + ' %'; lblFarbe = _duFarbe(du, grenze); }
    else if (_beschr === 'kabel' && !unbekannt) {
      const ist = i.kab?.ist || {};
      lbl = `${ersatz ? '~' : ''}${ist.nParallel > 1 ? ist.nParallel + '×' : ''}${ist.crossSection ?? '?'}² ${_fmt(ist.lengthM)}m`;
      lblFarbe = 'var(--muted)';
    }
    out.push(`<g><title>${escHtml(tip + (ert ? `\nErtüchtigt: ${e.massnahme.label}` : '')
      + (engpass ? '\nEngpass: Stromgrenze erreicht' : '') + (begrenzt === e.id ? '\nBegrenzt das gewählte Dach' : ''))}</title>
      ${engpass ? `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="#e53935" stroke-width="11" opacity="0.28" stroke-linecap="round"/>` : ''}
      ${begrenzt === e.id ? `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="var(--accent)" stroke-width="9" opacity="0.5" stroke-linecap="round"/>` : ''}
      ${ert ? `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="#4fc3f7" stroke-width="${mk ? 10 : 8}" opacity="0.35"/>` : ''}
      <line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${farbe}" stroke-width="${intern ? 1.5 : mk ? 5 : 3}"
        ${unbekannt || ersatz ? 'stroke-dasharray="4,3"' : ''}/>
      <line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="transparent" stroke-width="12"/>
      ${intern ? '' : `<text x="${(x1 + x2) / 2 - (mMarke ? 6 : 0)}" y="${y - 5}" font-size="${_beschr === 'kabel' ? 8 : 9}" text-anchor="middle"
        fill="${lblFarbe}" font-family="DM Mono,monospace" font-weight="${engpass ? 700 : 400}">${escHtml(lbl)}</text>`}</g>`);
    if (mMarke) out.push(_massMarke(e, x2 - 14, y));
  }

  // 3 · Knoten (Farbe = Spannungsanhebung)
  for (const e of eingabe.elemente) {
    if (e.typ === 'trafo') continue;
    const p = pos.get(e.id);
    if (!p) continue;
    const i = info.elInfo.get(e.id) || {};
    const du = lf.duPct.get(e.id) || 0;
    const klappbar = _layout.klappbar.has(e.id);
    if (eng.spannung.includes(e.id)) {
      out.push(`<circle cx="${_nodeX(p.depth)}" cy="${_y(p.row)}" r="9.5" fill="#e53935" fill-opacity="0.18" stroke="#e53935" stroke-width="1.3">
        <title>${escHtml(`Engpass: Spannungsgrenze erreicht (${_fmt(du, 2)} % von ${_fmt(grenze, 1)} %)`)}</title></circle>`);
    }
    out.push(`<circle cx="${_nodeX(p.depth)}" cy="${_y(p.row)}" r="${p.zu ? 6 : klappbar ? 5 : 4}" fill="${_duFarbe(du, grenze)}"
      stroke="${p.zu ? 'var(--text)' : 'var(--bg, #111)'}" stroke-width="${p.zu ? 1.5 : 1}"
      ${klappbar ? `data-pvna-klapp="${escHtml(e.id)}" style="cursor:pointer;"` : ''}>
      <title>${escHtml(`${i.knotenName || ''}${i.knotenTyp ? ' (' + i.knotenTyp + ')' : ''}\nΔU ${_fmt(du, 2)} % (Grenze ${_fmt(grenze, 1)} %)`
        + (klappbar ? `\nKlicken: ${p.zu ? 'ausklappen' : 'einklappen'}` : ''))}</title></circle>`);
    if (p.zu) out.push(`<text x="${_nodeX(p.depth)}" y="${_y(p.row) + 3}" font-size="9" font-weight="700" text-anchor="middle"
      fill="var(--bg,#111)" pointer-events="none">+</text>`);
    // Verteiler mit Abgängen beschriften (Blattknoten stehen als eigene Zeile bzw. rechts in der Liste)
    if (((kinder.get(e.id) || []).length || p.zu) && i.knotenName) {
      out.push(`<text x="${_nodeX(p.depth) + 5}" y="${_y(p.row) + 12}" font-size="8.5" fill="var(--muted)">${escHtml(i.knotenName + _vorlastText(e))}</text>`);
    }
  }

  // 4 · Trafos
  for (const e of eingabe.elemente.filter(x => x.typ === 'trafo')) {
    const p = pos.get(e.id);
    if (!p) continue;                                    // ausgeblendeter Trafo ohne PV
    const i = info.elInfo.get(e.id) || {};
    const a = lf.auslastungPct.get(e.id) || 0;
    const y = _y(p.row), f = _auslFarbe(a), mk = markiert.has(e.id);
    if (eng.strom.includes(e.id) || begrenzt === e.id) {
      const c = begrenzt === e.id ? 'var(--accent)' : '#e53935';
      out.push(`<rect x="${X_TRAFO - 16}" y="${y - 11}" width="32" height="22" rx="11" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="1.2"/>`);
    }
    out.push(`<g data-pvna-klapp="${escHtml(e.id)}" style="cursor:pointer;"><title>${escHtml(`${i.label}\nEinspeisung ${_fmt(lf.flussKw.get(e.id))} kW von ${_fmt(e.kapKw)} kW (${_fmt(a)} %)\nKlicken: ${p.zu ? 'ausklappen' : 'einklappen'}`)}</title>
      <line x1="${X_TRAFO + 12}" x2="${X_SCHIENE}" y1="${y}" y2="${y}" stroke="var(--text)" stroke-width="2"/>
      <circle cx="${X_TRAFO - 5}" cy="${y}" r="8" fill="none" stroke="${f}" stroke-width="${mk ? 3 : 2}"/>
      <circle cx="${X_TRAFO + 5}" cy="${y}" r="8" fill="none" stroke="${f}" stroke-width="${mk ? 3 : 2}"/></g>`);
    if (e.massnahme && _massZeigen(e.id)) out.push(_massMarke(e, X_TRAFO, y + 16));
    // Kopfzeile: Name über dem Symbol
    out.push(`<text x="6" y="${_y(p.row - 1) + 4}" font-size="10.5" font-weight="600" fill="var(--text)">${escHtml(i.label || e.id)}</text>`);
  }

  // 5 · Dächer: Anbindung + PV-Symbol mit Füllstand
  rows.forEach((r, row) => {
    if (r.typ === 'frei') {
      out.push(`<text x="6" y="${_y(row) + 4}" font-size="10.5" font-weight="600" fill="#e53935">nicht an einen Trafo angebunden</text>`);
      return;
    }
    if (r.typ === 'leer' || r.typ === 'leerAuf') {
      // Eingeklappte Abgänge ohne PV bzw. Knopf zum Wiedereinklappen
      const p = pos.get(r.eid);
      const x = _nodeX(p.depth), y = _y(row);
      const zu = r.typ === 'leer';
      const txt = zu ? `⊕ ${r.anzahl} Abg${r.anzahl === 1 ? 'ang' : 'änge'} ohne PV${r.elemente > r.anzahl ? ` (${r.elemente} Elemente)` : ''}`
        : '⊖ Abgänge ohne PV einklappen';
      out.push(`<g data-pvna-leer="${escHtml(r.eid)}" style="cursor:pointer;">
        <title>${zu ? 'Klicken: aufklappen — über diese Abgänge fließt keine PV-Einspeisung' : 'Klicken: wieder einklappen'}</title>
        <line x1="${x}" x2="${x + 18}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2,2"/>
        <rect x="${x + 18}" y="${y - 8}" width="${txt.length * 5.2 + 10}" height="16" rx="8" fill="var(--surface2,#222)" stroke="var(--border)"/>
        <text x="${x + 23}" y="${y + 3.5}" font-size="9" fill="var(--muted)">${escHtml(txt)}</text></g>`);
      return;
    }
    if (r.typ === 'knoten') {
      const i = info.elInfo.get(r.eid) || {};
      const p = pos.get(r.eid);
      if (i.knotenName) out.push(`<text x="${_nodeX(p.depth) + 8}" y="${_y(row) + 3}" font-size="9" fill="var(--muted)">${escHtml(i.knotenName + _vorlastText(byId.get(r.eid)))}</text>`);
      return;
    }
    if (r.typ === 'zu') {
      // Eingeklappt: gestapeltes PV-Symbol mit Füllstand der ganzen Gruppe
      const p = pos.get(r.eid);
      const y = _y(row);
      const kwp = r.daecher.reduce((t, id) => t + (_bel.get(id) || 0), 0);
      const max = r.daecher.reduce((t, id) => t + (dachById.get(id)?.kwpMax || 0), 0);
      const ueber = r.daecher.some(id => (_bel.get(id) || 0) > (_spiel.get(id)?.kwp ?? Infinity) + 0.05);
      const w = 18, h = 12, x0 = xRoof - 9;
      out.push(`<line x1="${_nodeX(p.depth) + 6}" x2="${x0}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2,3"/>
        <g data-pvna-klapp="${escHtml(r.eid)}" style="cursor:pointer;"><title>${escHtml(`${r.daecher.length} Dächer · ${_fmt(kwp, 1)} von ${_fmt(max, 1)} kWp\nKlicken: ausklappen`)}</title>
        <rect x="${x0 + 3}" y="${y - h / 2 - 3}" width="${w}" height="${h}" fill="none" stroke="var(--muted)" stroke-width="0.8"/>
        <rect x="${x0}" y="${y - h / 2}" width="${w}" height="${h}" fill="var(--bg,#111)" stroke="var(--muted)" stroke-width="1"/>
        <rect x="${x0}" y="${y - h / 2}" width="${w * (max > 0 ? Math.min(1, kwp / max) : 0)}" height="${h}" fill="${ueber ? '#e53935' : '#66bb6a'}" opacity="0.75"/></g>`);
      return;
    }
    if (r.typ !== 'dach') return;
    const d = dachById.get(r.dachId);
    const y = _y(row);
    const kwp = _bel.get(r.dachId) || 0;
    const anteil = d.kwpMax > 0 ? Math.min(1, kwp / d.kwpMax) : 0;
    const p = r.eid ? pos.get(r.eid) : null;
    const ueber = kwp > (_spiel.get(r.dachId)?.kwp ?? Infinity) + 0.05;
    const farbe = ueber ? '#e53935' : '#66bb6a';
    const mk = _auswahl === r.dachId;
    if (p) {
      const xs = _nodeX(p.depth);
      out.push(`<line x1="${xs}" x2="${xRoof - 9}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="${mk ? 2 : 1}" stroke-dasharray="${mk ? '' : '2,3'}"/>`);
    }
    const w = 18, h = 12, x0 = xRoof - 9;
    out.push(`<g data-pvna-dach="${escHtml(r.dachId)}" style="cursor:pointer;">
      <title>${escHtml(`${modell.info.dachInfo.get(r.dachId)?.name || r.dachId}\n${_fmt(kwp, 1)} von ${_fmt(d.kwpMax, 1)} kWp`)}</title>
      <rect x="${x0}" y="${y - h / 2}" width="${w}" height="${h}" fill="none" stroke="${mk ? 'var(--accent)' : 'var(--muted)'}" stroke-width="${mk ? 2 : 1}"/>
      <rect x="${x0}" y="${y - h / 2}" width="${w * anteil}" height="${h}" fill="${farbe}" opacity="0.75"/>
      <line x1="${x0}" x2="${x0 + w}" y1="${y + h / 2}" y2="${y - h / 2}" stroke="var(--muted)" stroke-width="0.6"/></g>`);
  });

  return `<svg width="${breite}" height="${hoehe}" viewBox="0 0 ${breite} ${hoehe}" style="display:block;flex:none;">${out.join('')}</svg>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// HTML
// ══════════════════════════════════════════════════════════════════════════════

const CSS_ID = 'pvna-schema-css';
function _cssEinmal() {
  if (document.getElementById(CSS_ID)) return;
  const st = document.createElement('style');
  st.id = CSS_ID;
  st.textContent = `
  .pvna-sl{-webkit-appearance:none;appearance:none;width:100%;height:18px;margin:0;background:transparent;display:block;cursor:pointer;}
  .pvna-sl::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:rgba(140,140,140,.28);}
  .pvna-sl::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;margin-top:-4px;border-radius:50%;border:none;background:var(--th,var(--accent));}
  .pvna-sl::-moz-range-track{height:4px;border-radius:2px;background:rgba(140,140,140,.28);}
  .pvna-sl::-moz-range-thumb{width:12px;height:12px;border-radius:50%;border:none;background:var(--th,var(--accent));}
  .pvna-zeile{display:flex;align-items:center;gap:8px;height:${ROW}px;padding:0 6px;font-size:10.5px;box-sizing:border-box;}
  .pvna-zeile.an{background:rgba(212,168,85,.12);}
  .pvna-knopf{font-size:10px;padding:1px 6px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;}`;
  document.head.appendChild(st);
}

/** Schieber mit Spielraum-Band und Varianten-Marke; der Daumen ist 12 px breit → 6 px Einzug. */
function _schieber(id, max, wert, varWert) {
  const vp = max > 0 ? varWert / max * 100 : 0;
  return `<div style="position:relative;flex:1 1 140px;min-width:110px;">
    <input type="range" class="pvna-sl" data-pvna-sl="${escHtml(id)}" min="0" max="${max}" step="${max > 200 ? 1 : 0.1}" value="${wert}">
    <div style="position:absolute;left:6px;right:6px;top:0;bottom:0;pointer-events:none;">
      <div data-pvna-band="${escHtml(id)}" style="position:absolute;left:0;top:7px;height:4px;width:0;background:rgba(102,187,106,.75);border-radius:2px;"></div>
      <div title="Variante" style="position:absolute;left:${vp}%;top:-1px;width:0;height:0;transform:translateX(-4px);
        border-left:4px solid transparent;border-right:4px solid transparent;border-top:6px solid #4fc3f7;"></div>
    </div></div>`;
}

function _zeilenHtml(erg) {
  const { modell } = erg;
  const { eingabe, info } = modell;
  const basis = new Map(erg.treppe.basis.daecher.map(d => [d.id, d.kwp]));
  const dachById = new Map(eingabe.daecher.map(d => [d.id, d]));
  return _layout.rows.map(r => {
    if (r.typ === 'dach') {
      const d = dachById.get(r.dachId);
      const di = info.dachInfo.get(r.dachId) || {};
      return `<div class="pvna-zeile" data-pvna-zeile="${escHtml(r.dachId)}">
        <span data-pvna-wahl="${escHtml(r.dachId)}" title="${escHtml((di.name || r.dachId) + ' · ' + (di.art || ''))}"
          style="flex:0 0 130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;">${escHtml(di.name || r.dachId)}</span>
        ${_schieber(r.dachId, +d.kwpMax.toFixed(1), +(_bel.get(r.dachId) || 0).toFixed(1), basis.get(r.dachId) || 0)}
        <span data-pvna-wert="${escHtml(r.dachId)}" title="Klicken: kWp eingeben" style="flex:0 0 92px;text-align:right;font-family:'DM Mono',monospace;cursor:text;"></span>
        <span data-pvna-du="${escHtml(r.dachId)}" style="flex:0 0 58px;text-align:right;font-family:'DM Mono',monospace;"></span>
        <button class="pvna-knopf" data-pvna-max="${escHtml(r.dachId)}" title="Auf den Spielraum setzen: so viel, wie das Netz bei der übrigen Belegung noch aufnimmt">⤒</button>
      </div>`;
    }
    if (r.typ === 'zu') {
      const i = info.elInfo.get(r.eid) || {};
      const name = i.knotenName || i.label || r.eid;
      return `<div class="pvna-zeile" data-pvna-gruppe-zeile="${escHtml(r.eid)}" style="background:rgba(128,128,128,.07);">
        <span data-pvna-klapp="${escHtml(r.eid)}" title="Ausklappen" style="flex:0 0 130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;">
          ▸ ${escHtml(name)} <span style="color:var(--muted);">(${r.daecher.length})</span></span>
        <div style="position:relative;flex:1 1 140px;min-width:110px;">
          <input type="range" class="pvna-sl" data-pvna-gruppe="${escHtml(r.eid)}" min="0" max="100" step="0.5" value="0"
            title="Alle ${r.daecher.length} Dächer dahinter auf denselben Anteil ihrer Fläche setzen"></div>
        <span data-pvna-gruppe-wert style="flex:0 0 92px;text-align:right;font-family:'DM Mono',monospace;"></span>
        <span data-pvna-gruppe-du style="flex:0 0 58px;text-align:right;font-family:'DM Mono',monospace;"></span>
        <span style="flex:0 0 22px;color:var(--muted);text-align:center;" title="Summe der Gruppe · höchstes ΔU">Σ</span>
      </div>`;
    }
    if (r.typ === 'trafo') {
      const zu = _zu.has(r.eid);
      return `<div class="pvna-zeile" style="color:var(--muted);">
        <button class="pvna-knopf" data-pvna-klapp="${escHtml(r.eid)}" title="${zu ? 'Trafo ausklappen' : 'Trafo einklappen'}">${zu ? '▸' : '▾'}</button>
        <span style="flex:1;"></span><span data-pvna-trafo="${escHtml(r.eid)}" style="font-family:'DM Mono',monospace;"></span></div>`;
    }
    return `<div class="pvna-zeile"></div>`;
  }).join('');
}

function _kachel(id, label) {
  return `<div style="flex:1 1 100px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:8px 10px;">
    <div data-pvna-k="${id}" style="font-size:16px;font-family:'DM Mono',monospace;">—</div>
    <div style="font-size:10px;color:var(--muted);margin-top:2px;">${label}</div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ZUSTAND + AKTUALISIERUNG
// ══════════════════════════════════════════════════════════════════════════════

function _potenzial(erg) { return erg.modell.eingabe.daecher.reduce((s, d) => s + d.kwpMax, 0); }

function _gleicheDaecher(a, b) {
  const da = a.modell.eingabe.daecher, db = b.modell.eingabe.daecher;
  if (da.length !== db.length) return false;
  const ids = new Set(da.map(d => d.id));
  return db.every(d => ids.has(d.id));
}

function _setzeVariante(erg) {
  _bel = new Map(erg.treppe.basis.daecher.map(d => [d.id, d.kwp]));
}

function _spielraumRechnen(erg) {
  const eingabe = _eing(erg);
  _spiel = new Map(eingabe.daecher.map(d => [d.id, pvnaSpielraum(eingabe, _bel, d.id)]));
}

function _ertragMwh(erg) {
  let s = 0;
  for (const d of erg.modell.eingabe.daecher) {
    const spez = erg.optionen?.get(d.id)?.spez ?? 950 * (d.ertragFaktor || 1);
    s += (_bel.get(d.id) || 0) * spez / 1000;
  }
  return s;
}

/** Größter gemeinsamer Anteil aller Dächer (gecacht je Maßnahmen-Auswahl). */
function _gleichAnteil(erg) {
  _eing(erg);
  if (_eingCache.gleich == null) _eingCache.gleich = _gleichmaessigMax(erg);
  return _eingCache.gleich;
}

/** Steht die Belegung (noch) auf der berechneten Variante? */
function _istVariante(erg) {
  if (_mass.size) return false;
  return erg.treppe.basis.daecher.every(d => Math.abs((_bel.get(d.id) || 0) - d.kwp) < 0.05);
}

/**
 * Kernaussage in Worten: was das Netz aufnimmt, was begrenzt, wie belastbar die
 * Zahl ist. Wird bei jeder Änderung der Belegung neu formuliert.
 */
function _aussageAktualisieren(root, erg, eingabe, lf) {
  const box = root.querySelector('[data-pvna-aussage]');
  if (!box) return;
  const { info } = erg.modell;
  const grenze = eingabe.duGrenzePct;
  const pot = _potenzial(erg);
  const pct = pot > 0 ? lf.summeKwp / pot * 100 : 0;
  const variante = _istVariante(erg);
  const b = t => `<b style="color:var(--text);">${t}</b>`;
  const rot = t => `<span style="color:#e57373;">${t}</span>`;
  const lbl = id => escHtml(info.elInfo.get(id)?.label || id);

  // 1 · Kopfsatz
  let kopf;
  if (variante) {
    kopf = `Ohne Ertüchtigung von Kabeln oder Trafos nimmt das Bestandsnetz ${b(_fmt(lf.summeKwp) + ' kWp')} PV auf — `
      + `${b(_fmt(pct) + ' %')} des Flächenpotenzials von ${_fmt(pot)} kWp (≈ ${_fmt(_ertragMwh(erg))} MWh/a).`;
  } else {
    const aktiv = _massnahmenListe(erg).filter(m => _mass.has(m.id));
    const inv = aktiv.reduce((t, m) => t + m.investEUR, 0);
    const nU = lf.ueberlastet.length, nS = lf.spannungsverletzt.length;
    kopf = `${b('Eigene Belegung')}${aktiv.length ? ` mit ${aktiv.length} Ertüchtigung${aktiv.length > 1 ? 'en' : ''} (${_fmt(inv / 1000, 1)} T€)` : ''}: `
      + `${b(_fmt(lf.summeKwp) + ' kWp')} (${_fmt(pct)} % des Flächenpotenzials) — `
      + (lf.zulaessig ? '<span style="color:#66bb6a;">das Netz hält.</span>'
        : rot(`das Netz hält nicht: ${[nU ? `${nU} Element${nU > 1 ? 'e' : ''} überlastet` : '', nS ? `${nS} Knoten über der ΔU-Grenze` : ''].filter(Boolean).join(', ')}.`))
      + ` <span style="color:var(--muted);">Variante „Bestandsnetz": ${_fmt(erg.treppe.basis.summeKwp)} kWp.</span>`;
  }

  const punkte = [];
  // 2 · Engpässe und was dahinter noch frei wäre
  const eng = _engpaesse(eingabe, lf);
  const restHinter = elId => _daecherHinter(eingabe, elId)
    .reduce((t, d) => t + Math.max(0, d.kwpMax - (_bel.get(d.id) || 0)), 0);
  const posten = [
    ...eng.strom.map(id => {
      const e = eingabe.elemente.find(x => x.id === id);
      const a = lf.auslastungPct.get(id) || 0;
      const kt = info.elInfo.get(id)?.kabelText;
      const was = e.typ === 'trafo' ? 'der Nennleistung' : 'der Strombelastbarkeit';
      return { rest: restHinter(id), schwere: a / 100, html: `${b(lbl(id))}${kt ? ` (${escHtml(kt)})` : ''} — ${a > 100.05 ? rot(_fmt(a) + ' %') : _fmt(a) + ' %'} ${was}` };
    }),
    ...eng.spannung.map(id => {
      const du = lf.duPct.get(id) || 0;
      const haupt = _hauptanteil(eingabe, lf, id);
      const knoten = info.elInfo.get(id)?.knotenName || id;
      return { rest: restHinter(haupt ?? id), schwere: du / grenze, html: `Spannung am Knoten ${b(escHtml(knoten))} — ${du > grenze + 0.005 ? rot(_fmt(du, 2) + ' %') : _fmt(du, 2) + ' %'} von ${_fmt(grenze, 1)} %`
        + (haupt ? `, größter Anteil ${escHtml(info.elInfo.get(haupt)?.label || haupt)}` : '') };
    }),
  // Hält das Netz: wichtigster Engpass = der mit der meisten freien Fläche dahinter.
  // Hält es nicht: die schwersten Überschreitungen zuerst.
  ].sort((x, y) => lf.zulaessig ? y.rest - x.rest : y.schwere - x.schwere);
  const alleVoll = eingabe.daecher.every(d => (_bel.get(d.id) || 0) >= d.kwpMax - 0.05);
  if (posten.length) {
    const zeig = posten.length <= 5 ? posten : posten.slice(0, 4);
    punkte.push(`${b(lf.zulaessig ? 'Begrenzt durch' : 'Grenzen erreicht oder überschritten')}${posten.length > 1 ? ` (${posten.length} Stellen)` : ''}:<ul style="margin:2px 0 0 16px;padding:0;">`
      + zeig.map(p => `<li>${p.html}${p.rest > 0.5 ? ` <span style="color:var(--muted);">· dahinter noch ${_fmt(p.rest)} kWp Fläche frei</span>` : ''}</li>`).join('')
      + (posten.length > zeig.length ? `<li style="color:var(--muted);">und ${posten.length - zeig.length} weitere (im Schema rot umrandet)</li>` : '') + '</ul>');
  } else {
    punkte.push(alleVoll ? 'Alle Flächen sind voll belegt, ohne dass eine Netzgrenze erreicht wird.'
      : 'Kein Element steht an seiner Grenze — die Belegung lässt noch Reserve (grünes Band an den Schiebern).');
  }

  // 3 · Trafos
  const trafos = eingabe.elemente.filter(e => e.typ === 'trafo');
  if (trafos.length) {
    const tl = trafos.map(t => ({ id: t.id, a: lf.auslastungPct.get(t.id) || 0 })).sort((x, y) => y.a - x.a);
    const trafoEng = trafos.some(t => eng.strom.includes(t.id));
    punkte.push(`Trafos: ${tl.slice(0, 5).map(t => `${lbl(t.id)} <span style="color:${_auslFarbe(t.a)};">${_fmt(t.a)} %</span>`).join(' · ')}`
      + (tl.length > 5 ? ` · ${tl.length - 5} weitere` : '')
      + (!trafoEng && posten.length ? ' — die Trafos sind nicht der Engpass, es begrenzen Kabel bzw. die Spannung in den Strängen.' : ''));
  }

  // 4 · Verteilung: die Summe hängt davon ab, WO gebaut wird
  if (!alleVoll) {
    const f = _gleichAnteil(erg);
    const gleichKwp = pot * f;
    const belegt = eingabe.daecher.filter(d => (_bel.get(d.id) || 0) > 0.05).length;
    punkte.push(`Verteilung: ${belegt} von ${eingabe.daecher.length} Dächern belegt${variante ? ', ertragsstärkste zuerst' : ''}. `
      + `Gleichmäßig auf alle Dächer verteilt trägt das Netz ${b(_fmt(f * 100) + ' %')} je Dach (${_fmt(gleichKwp)} kWp)`
      + (Math.abs(gleichKwp - lf.summeKwp) > Math.max(5, 0.05 * lf.summeKwp)
        ? ` — die aufnehmbare Leistung hängt also deutlich davon ab, ${gleichKwp < lf.summeKwp ? 'wo gebaut wird' : 'wie verteilt wird'}.` : '.'));
  }

  // 4b · Weniger bauen oder abregeln (Weg B aus der Netzaufnahme, gilt für die Variante)
  const ab = variante ? window._pvNetzaufnahme?.abregelung : null;
  if (ab && ab.vollKwp > lf.summeKwp + 0.5) {
    punkte.push(`Alternative zum Weniger-Bauen: alle Dächer mit Netzanschluss voll belegen (${b(_fmt(ab.vollKwp) + ' kWp')}) und die Einspeisung `
      + `je Dach am EZA-Regler auf die Netzgrenze begrenzen — ${_fmt(ab.vollNutzbarMwh)} statt ${_fmt(ab.wenigerMwh)} MWh/a nutzbar, `
      + `${_fmt(ab.vollVerlustPct, 1)} % der Erzeugung werden abgeregelt (ohne Eigenverbrauch gerechnet, obere Abschätzung).`);
  }

  // 5 · Datenlage
  const warn = [];
  const unbek = eingabe.elemente.filter(e => { const k = info.elInfo.get(e.id)?.kab; return k?.unbekannt || k?.ersatz; });
  if (unbek.length) {
    const hinter = new Set(unbek.flatMap(e => _daecherHinter(eingabe, e.id).map(d => d.id)));
    const kwp = [...hinter].reduce((t, id) => t + (_bel.get(id) || 0), 0);
    const qs = +info.ersatzQs || 0;
    const wahl = `<select data-pvna-ersatz style="font-size:10.5px;padding:1px 4px;margin-left:4px;" title="Annahme für Kabel ohne erfassten Querschnitt — rechnet die Netzaufnahme neu">${pvnaErsatzOptionen(qs)}</select>`;
    // Steht die Variante im Vergleich noch auf einer anderen Annahme?
    const bn = (window._pvAnalyse?.ergebnisse || []).find(v => v.id === 'bestandsnetz')?.netzaufnahme;
    const veraltet = bn && (+bn.eingaben?.ersatzQs || 0) !== qs
      ? ' <span style="color:#ffb74d;">Die Variante im Varianten-Vergleich steht noch auf der vorigen Annahme — „Varianten berechnen".</span>' : '';
    const wo = `${unbek.length} Kabel ohne erfassten Querschnitt (${unbek.slice(0, 3).map(e => escHtml(info.elInfo.get(e.id)?.knotenName || e.id)).join(', ')}${unbek.length > 3 ? ' …' : ''})`;
    if (qs > 0) punkte.push(`${wo} — gerechnet mit ${wahl}.${veraltet}`);
    else {
      warn.push(`${wo} — dort ist keine Stromgrenze gerechnet${kwp > 0.5 ? `; ${_fmt(kwp)} kWp der Belegung hängen dahinter, die Aussage ist dort optimistisch` : ''}. `
        + `Vorsichtiger rechnen mit ${wahl}${veraltet}`);
    }
  }
  const geschaetzt = eingabe.elemente.filter(e => info.elInfo.get(e.id)?.kante?.autoSized && !info.elInfo.get(e.id)?.kab?.unbekannt).length;
  if (geschaetzt) warn.push(`${geschaetzt} Querschnitt${geschaetzt > 1 ? 'e' : ''} nur geschätzt (automatisch ausgelegt) — vor Ort prüfen.`);
  const frei = eingabe.daecher.filter(d => d.elementId == null || !info.elInfo.has(d.elementId));
  if (frei.length) warn.push(`${frei.length} Dach/Dächer (${_fmt(frei.reduce((t, d) => t + d.kwpMax, 0))} kWp) an keinen Trafo angebunden — nicht belegbar.`);
  const vorlast = eingabe.elemente.filter(e => +e.vorlastKw > 0);
  if (vorlast.length) {
    punkte.push(`Vorhandene Einspeisung ${b(_fmt(vorlast.reduce((t, e) => t + +e.vorlastKw, 0)) + ' kW')} `
      + `(${vorlast.slice(0, 4).map(e => escHtml(info.elInfo.get(e.id)?.knotenName || info.elInfo.get(e.id)?.label || e.id)).join(', ')}) ist vorab eingerechnet.`);
  }

  const einsp = eingabe.daecher[0]?.einspFaktor;
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div data-pvna-aussage-text style="font-size:12px;line-height:1.55;color:var(--text);">${kopf}</div>
      <button class="pvna-knopf" data-pvna-aktion="kopieren" style="flex:none;" title="Aussage als Text in die Zwischenablage (z. B. für das Gutachten)">📋 Text kopieren</button>
    </div>
    <div data-pvna-aussage-punkte style="margin-top:5px;font-size:11px;line-height:1.55;color:var(--muted);">
      ${punkte.map(p => `<div style="margin-top:3px;">${p}</div>`).join('')}
      ${warn.map(w => `<div style="margin-top:3px;color:#ffb74d;">⚠ ${w}</div>`).join('')}
      <div style="margin-top:5px;font-size:10px;">Lastfall: volle Einspeisung ${_fmt(einsp, 2)} kW/kWp ohne gleichzeitige Last, Spannungsanhebung ≤ ${_fmt(grenze, 1)} %, Rechenjahr ${erg.jahr}
        — konservativ: Eigenverbrauch hinter dem Zähler würde die Aufnahme erhöhen.</div>
    </div>`;
}

function _aussageKopieren(root, knopf) {
  // Auswahllisten stehen im Text sonst mit allen Optionen — nur die gewählte übernehmen
  const text = sel => {
    const el = root.querySelector(sel);
    if (!el) return '';
    const kopie = el.cloneNode(true);
    kopie.querySelectorAll('select').forEach((s, i) => {
      const orig = el.querySelectorAll('select')[i];
      s.replaceWith(document.createTextNode(orig?.selectedOptions?.[0]?.textContent || ''));
    });
    // innerText braucht ein gerendertes Element — kurz unsichtbar einhängen
    kopie.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(kopie);
    const t = kopie.innerText;
    kopie.remove();
    return t;
  };
  const kopf = text('[data-pvna-aussage-text]');
  const punkte = text('[data-pvna-aussage-punkte]');
  const txt = (kopf + '\n' + punkte).replace(/\n{3,}/g, '\n\n').trim();
  const zurueck = ok => { knopf.textContent = ok ? '✓ kopiert' : 'Kopieren nicht möglich'; setTimeout(() => { knopf.textContent = '📋 Text kopieren'; }, 1800); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(() => zurueck(true), () => zurueck(false));
  else zurueck(false);
}

function _aktualisieren({ spielraum = true } = {}) {
  const erg = _quelle;
  const root = document.getElementById('pva-pvna-schema');
  if (!erg || !root) return;
  const { info } = erg.modell;
  const eingabe = _eing(erg);
  if (spielraum) _spielraumRechnen(erg);
  const lf = pvnaLastfluss(eingabe, _bel);
  const grenze = eingabe.duGrenzePct;

  const svgBox = root.querySelector('[data-pvna-svg]');
  if (svgBox) svgBox.innerHTML = _svg(erg, lf);

  const dachById = new Map(eingabe.daecher.map(d => [d.id, d]));
  root.querySelectorAll('[data-pvna-zeile]').forEach(z => {
    const id = z.dataset.pvnaZeile;
    const d = dachById.get(id);
    const kwp = _bel.get(id) || 0;
    const sp = _spiel.get(id);
    const ueber = sp && kwp > sp.kwp + 0.05;
    const du = d.elementId ? lf.duPct.get(d.elementId) || 0 : 0;
    z.classList.toggle('an', _auswahl === id);
    const sl = z.querySelector('[data-pvna-sl]');
    if (sl && Math.abs(+sl.value - kwp) > 1e-6 && document.activeElement !== sl) sl.value = kwp;
    sl?.style.setProperty('--th', ueber ? '#e53935' : 'var(--accent)');
    const band = z.querySelector('[data-pvna-band]');
    if (band) band.style.width = (d.kwpMax > 0 && sp ? Math.min(1, sp.kwp / d.kwpMax) * 100 : 0) + '%';
    const wertEl = z.querySelector('[data-pvna-wert]');
    if (!wertEl.contains(document.activeElement)) {        // nicht während der Zahleneingabe überschreiben
      wertEl.innerHTML = `<span style="color:${ueber ? '#e53935' : 'var(--text)'};">${_fmt(kwp, 1)}</span><span style="color:var(--muted);"> / ${_fmt(d.kwpMax)}</span>`;
      wertEl.title = ueber ? _abregelText(id, d, kwp, sp, false) + ' · Klicken: kWp eingeben' : 'Klicken: kWp eingeben';
    }
    const duEl = z.querySelector('[data-pvna-du]');
    duEl.textContent = d.elementId ? _fmt(du, 2) + ' %' : '—';
    duEl.style.color = _duFarbe(du, grenze);
  });
  const zuRows = new Map(_layout.rows.filter(r => r.typ === 'zu').map(r => [r.eid, r.daecher]));
  root.querySelectorAll('[data-pvna-gruppe-zeile]').forEach(z => {
    const ids = zuRows.get(z.dataset.pvnaGruppeZeile) || [];
    const kwp = ids.reduce((t, id) => t + (_bel.get(id) || 0), 0);
    const max = ids.reduce((t, id) => t + (dachById.get(id)?.kwpMax || 0), 0);
    const ueber = ids.some(id => (_bel.get(id) || 0) > (_spiel.get(id)?.kwp ?? Infinity) + 0.05);
    const duMax = ids.reduce((m, id) => {
      const el = dachById.get(id)?.elementId;
      return Math.max(m, el ? lf.duPct.get(el) || 0 : 0);
    }, 0);
    const sl = z.querySelector('[data-pvna-gruppe]');
    if (sl && document.activeElement !== sl) sl.value = max > 0 ? kwp / max * 100 : 0;
    sl?.style.setProperty('--th', ueber ? '#e53935' : 'var(--accent)');
    z.querySelector('[data-pvna-gruppe-wert]').innerHTML =
      `<span style="color:${ueber ? '#e53935' : 'var(--text)'};">${_fmt(kwp, 1)}</span><span style="color:var(--muted);"> / ${_fmt(max)}</span>`;
    const duEl = z.querySelector('[data-pvna-gruppe-du]');
    duEl.textContent = _fmt(duMax, 2) + ' %';
    duEl.style.color = _duFarbe(duMax, grenze);
  });
  root.querySelectorAll('[data-pvna-trafo]').forEach(s => {
    const id = s.dataset.pvnaTrafo;
    const a = lf.auslastungPct.get(id) || 0;
    s.innerHTML = `Einspeisung ${_fmt(lf.flussKw.get(id))} kW · <span style="color:${_auslFarbe(a)};">${_fmt(a)} %</span> der Trafoleistung`;
  });

  // Kennzahlen
  const pot = _potenzial(erg);
  const kabel = eingabe.elemente.filter(e => e.typ === 'kabel' && Number.isFinite(e.kapKw));
  const trafos = eingabe.elemente.filter(e => e.typ === 'trafo');
  const maxA = l => l.reduce((m, e) => Math.max(m, lf.auslastungPct.get(e.id) || 0), 0);
  const setK = (k, html, farbe) => {
    const el = root.querySelector(`[data-pvna-k="${k}"]`);
    if (el) { el.innerHTML = html; el.style.color = farbe || 'var(--text)'; }
  };
  const einh = t => `<span style="font-size:10.5px;color:var(--muted);margin-left:3px;">${t}</span>`;
  setK('summe', _fmt(lf.summeKwp) + einh(`kWp · ${_fmt(pot > 0 ? lf.summeKwp / pot * 100 : 0)} %`));
  setK('ertrag', _fmt(_ertragMwh(erg)) + einh('MWh/a'));
  setK('trafo', _fmt(maxA(trafos)) + einh('%'), _auslFarbe(maxA(trafos)));
  setK('kabel', _fmt(maxA(kabel)) + einh('%'), _auslFarbe(maxA(kabel)));
  setK('du', _fmt(lf.maxDuPct, 2) + einh('%'), _duFarbe(lf.maxDuPct, grenze));
  const nU = lf.ueberlastet.length, nS = lf.spannungsverletzt.length;
  const aktiv = _massnahmenListe(erg).filter(m => _mass.has(m.id));
  const inv = aktiv.reduce((t, m) => t + m.investEUR, 0);
  setK('invest', aktiv.length ? _fmt(inv / 1000) + einh(`T€ · ${aktiv.length} Maßn.`) : '—' + einh('Bestand'),
    aktiv.length ? '#4fc3f7' : 'var(--muted)');
  _fahrplanAktualisieren(root, erg);
  setK('status', lf.zulaessig ? '✓ hält' : `✗ ${nU ? nU + ' überlastet' : ''}${nU && nS ? ' · ' : ''}${nS ? nS + ' ΔU' : ''}`,
    lf.zulaessig ? '#66bb6a' : '#e53935');

  const gs = root.querySelector('[data-pvna-gesamt]');
  const gv = root.querySelector('[data-pvna-gesamt-wert]');
  const gpct = pot > 0 ? lf.summeKwp / pot * 100 : 0;
  if (gs && document.activeElement !== gs) gs.value = gpct;
  if (gv) gv.textContent = _fmt(gpct) + ' %';

  _varianteZeile(root, lf);
  _aussageAktualisieren(root, erg, eingabe, lf);

  // Auswahl-Zeile: warum ist hier Schluss?
  const aw = root.querySelector('[data-pvna-auswahl]');
  if (aw) {
    if (!_auswahl || !dachById.has(_auswahl)) {
      aw.innerHTML = 'Dach im Schema oder in der Liste anklicken, um seinen Weg zum Trafo und die begrenzende Stelle zu sehen.';
    } else {
      const d = dachById.get(_auswahl);
      const sp = _spiel.get(_auswahl);
      const beg = sp?.begrenzer;
      const begEl = beg?.elementId ? info.elInfo.get(beg.elementId) : null;
      aw.innerHTML = `<b style="color:var(--text);">${escHtml(info.dachInfo.get(_auswahl)?.name || _auswahl)}</b>:
        ${_fmt(_bel.get(_auswahl) || 0, 1)} von ${_fmt(d.kwpMax, 1)} kWp belegt · Spielraum bei der übrigen Belegung
        <b style="color:#66bb6a;">${_fmt(sp?.kwp, 1)} kWp</b>`
        + (beg && sp.kwp < d.kwpMax - 0.05
          ? ` — begrenzt durch ${_ART[beg.art] || beg.art}${begEl ? ': ' + escHtml(begEl.label) + (begEl.kabelText ? ` (${escHtml(begEl.kabelText)})` : '') : ''}`
          : ' — volle Fläche möglich')
        + (sp && d.kwpMax > sp.kwp + 0.5 ? `<br>${_abregelText(_auswahl, d, _bel.get(_auswahl) || 0, sp, true)}` : '');
    }
  }
}

/**
 * Weniger bauen oder abregeln — für EIN Dach bei der übrigen Belegung: die Netzgrenze
 * dieses Dachs ist sein Spielraum × Einspeisefaktor. Liegt die Belegung darüber, wird
 * die Abregelung dieser Belegung genannt, sonst die des Vollausbaus.
 */
function _abregelText(id, d, kwp, sp, html) {
  const f = d.einspFaktor > 0 ? d.einspFaktor : 0.8;
  const pZul = sp.kwp * f;
  if (sp.kwp < 0.05) return 'Bei der übrigen Belegung nimmt das Netz hier nichts mehr auf — Abregeln hilft nicht, nur Umverteilen oder Ertüchtigen.';
  const ueber = kwp > sp.kwp + 0.05;
  const ziel = ueber ? kwp : d.kwpMax;
  const r = pvnaAbregelungDach(id, ziel, pZul);
  const basis = pvnaAbregelungDach(id, sp.kwp, pZul);
  if (!r || !basis) return '';
  const b = t => html ? `<b style="color:var(--text);">${t}</b>` : t;
  const kopf = ueber ? `${_fmt(kwp - sp.kwp, 1)} kWp über dem Spielraum: statt das Netz zu ertüchtigen,`
    : `Voll belegen (${_fmt(d.kwpMax, 1)} kWp) und`;
  return `${html ? '<span style="color:#ffb74d;">⚡</span> ' : ''}${kopf} die Einspeisung am EZA-Regler auf ${b(_fmt(pZul) + ' kW')} begrenzen → `
    + `${b(_fmt(r.verlustPct, 1) + ' %')} der Erzeugung abgeregelt, ${_fmt(r.nutzbarMwh, 1)} statt ${_fmt(basis.nutzbarMwh, 1)} MWh/a nutzbar `
    + `(${_fmt(ziel > sp.kwp + 0.05 ? (r.nutzbarMwh - basis.nutzbarMwh) * 1000 / (ziel - sp.kwp) : 0)} kWh je zusätzlichem kWp; ohne Eigenverbrauch).`;
}

/** Nächsten Frame aktualisieren; der Timer fängt ab, dass rAF in verdeckten Fenstern pausiert. */
let _timer = 0;
function _planen(opts) {
  cancelAnimationFrame(_raf);
  clearTimeout(_timer);
  const los = () => { cancelAnimationFrame(_raf); clearTimeout(_timer); _aktualisieren(opts); };
  _raf = requestAnimationFrame(los);
  _timer = setTimeout(los, 60);
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER + EREIGNISSE
// ══════════════════════════════════════════════════════════════════════════════

export function pvnaSchemaRender() {
  const root = document.getElementById('pva-pvna-schema');
  if (!root) return;
  const erg = pvnaLetztesErgebnis();
  // Ohne Ergebnis (z. B. nach dem Laden eines Projekts) gibt es keine Ganzseitenansicht
  if (!erg || !erg.modell.eingabe.daecher.length) _vollbild = false;
  document.body.style.overflow = _vollbild ? 'hidden' : '';
  // Sichtbarkeit gehört der Ansichtsumschaltung (09d) — beim Umstellen erhalten
  const anzeige = root.style.display;
  root.style.cssText = _vollbild
    ? 'position:fixed;inset:0;z-index:9000;background:var(--bg,#101216);overflow:auto;padding:10px 16px;box-sizing:border-box;'
    : '';
  root.style.display = anzeige;
  if (!erg || !erg.modell.eingabe.daecher.length) {
    root.innerHTML = `<div style="color:var(--muted);font-size:11px;text-align:center;padding:40px 0;line-height:1.6;">
      ${erg ? 'Keine PV-Flächen im Netzmodell — Gebäuden PV zuweisen oder in „Netzaufnahme (Bestand)" auf „Alle Dächer" stellen.'
        : 'Das Einlinienschema zeigt die Variante „Bestandsnetz" — dafür muss die Netzaufnahme einmal gerechnet sein.'}<br>
      <button class="btn-confirm" style="margin-top:10px;padding:7px 16px;font-size:11.5px;" data-click="pvnaSchemaBerechnen()">Aufnahme berechnen</button></div>`;
    return;
  }
  _cssEinmal();
  if (_quelle !== erg) {
    // Neu gerechnet (z. B. durch „Varianten berechnen"): bei gleichem Dachbestand
    // die eingestellte Belegung behalten, sonst mit der Variante beginnen.
    // Stand die Belegung auf der Variante, folgt sie der neuen Variante (z. B. nach
    // geänderter Querschnitt-Annahme) statt als „eigene Belegung" stehen zu bleiben.
    const gleich = _quelle && _gleicheDaecher(_quelle, erg);
    const alt = gleich && !_istVariante(_quelle) ? _bel : null;
    _quelle = erg;
    _setzeVariante(erg);
    if (alt) for (const d of erg.modell.eingabe.daecher) _bel.set(d.id, Math.min(alt.get(d.id) || 0, d.kwpMax));
    if (!gleich) { _auswahl = null; _meldung = ''; }
    const angeboten = new Set(erg.modell.eingabe.elemente.filter(e => e.massnahme).map(e => e.id));
    _mass = alt ? new Set([..._mass].filter(id => angeboten.has(id))) : new Set();
  }
  _layout = _layoutBilden(erg.modell, _nurPv);
  const knopf = (akt, txt, tip) => `<button class="pvna-knopf" style="padding:4px 10px;font-size:10.5px;" data-pvna-aktion="${akt}" title="${tip}">${txt}</button>`;

  root.innerHTML = `
  <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
    <div style="font-size:12px;font-weight:600;">Einlinienschema — Variante „Bestandsnetz"</div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
      <label style="font-size:10.5px;color:var(--muted);display:flex;gap:5px;align-items:center;cursor:pointer;"
        title="Abgänge, über die weder PV noch vorhandene Einspeisung fließt (reine Verbraucher), je Knoten zu einer Zeile einklappen — dort einzeln aufklappbar">
        <input type="checkbox" data-pvna-nurpv ${_nurPv ? 'checked' : ''}> Stränge ohne PV einklappen${_layout.ausgeblendet ? ` (${_layout.ausgeblendet} Elemente)` : ''}</label>
      ${_vollbild ? `<label style="font-size:10.5px;color:var(--muted);display:flex;gap:5px;align-items:center;cursor:pointer;"
        title="Schema und Schieber so verkleinern, dass alles ohne Scrollen sichtbar ist">
        <input type="checkbox" data-pvna-einpassen ${_einpassen ? 'checked' : ''}> auf Bildschirm einpassen</label>` : ''}
      ${knopf('allezu', '⊟ Alles einklappen', 'Jeden Trafo auf eine Summenzeile mit Gruppenschieber einklappen')}
      ${knopf('alleauf', '⊞ Alles ausklappen', 'Die ganze Netzstruktur wieder zeigen')}
      ${_vollbild ? '' : knopf('ausklappen', _ausgeklappt ? '⤡ Einklappen' : '⤢ Ausklappen',
        _ausgeklappt ? 'Ergebnis-Navigation wieder einblenden, Schema im Scrollbereich'
          : 'Schema über die ganze Seitenbreite und in voller Höhe — die Seite scrollt')}
      ${knopf('vollbild', _vollbild ? '✕ Ganze Seite schließen (Esc)' : '⛶ Ganze Seite', _vollbild ? 'Zurück zur Ansicht in der PV-Analyse' : 'Schema bildschirmfüllend, alles auf einen Blick')}
    </div>
  </div>
  <div data-pvna-aussage style="margin-bottom:8px;padding:9px 12px;background:var(--surface);border:1px solid var(--border);
    border-left:3px solid var(--accent);border-radius:7px;"></div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
    ${_kachel('summe', 'PV belegt')}${_kachel('ertrag', 'Erzeugung (ohne Abregelung)')}
    ${_kachel('trafo', 'höchste Trafo-Auslastung')}${_kachel('kabel', 'höchste Kabel-Auslastung')}
    ${_kachel('du', 'höchste Spannungsanhebung')}${_kachel('status', 'Netz')}${_kachel('invest', 'Netzertüchtigung')}
  </div>
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:6px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:7px;">
    <span style="font-size:11px;font-weight:600;">Ausbau gesamt</span>
    <input type="range" class="pvna-sl" data-pvna-gesamt min="0" max="100" step="0.5" value="0" style="flex:1 1 200px;width:auto;"
      title="Setzt jedes Dach auf denselben Anteil seiner Fläche">
    <span data-pvna-gesamt-wert style="font-family:'DM Mono',monospace;font-size:11px;width:44px;text-align:right;"></span>
    <span style="font-size:10px;color:var(--muted);">des Flächenpotenzials</span>
    <span style="flex-basis:100%;height:0;"></span>
    ${knopf('fuellen', '▲ Bis zur Netzgrenze füllen', 'Ertragsstärkste Dächer zuerst belegen, bis mit den aktiven Maßnahmen die erste Grenze erreicht ist')}
    ${knopf('variante', '▼ Variante Bestandsnetz', 'Belegung der berechneten Variante (ertragsstärkste Dächer zuerst, bis zum ersten Engpass)')}
    ${knopf('gleich', '⇥ Gleichmäßig bis zur Netzgrenze', 'Größter gemeinsamer Anteil aller Dächer, bei dem das Netz noch hält')}
    ${knopf('voll', 'Vollausbau', 'Alle Dächer voll belegt')}
    ${knopf('null', 'Alle auf 0', 'Alle Dächer leer')}
  </div>
  <div data-pvna-variante style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px;padding:7px 10px;
    background:var(--surface);border:1px solid var(--border);border-left:3px solid #80cbc4;border-radius:7px;font-size:10.5px;"></div>
  <div data-pvna-fahrplan style="margin-bottom:6px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);
    border-left:3px solid #4fc3f7;border-radius:7px;font-size:10.5px;"></div>
  <div data-pvna-auswahl style="font-size:10.5px;color:var(--muted);margin:6px 0 8px;min-height:15px;line-height:1.5;"></div>
  <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 14px;margin-bottom:6px;">
    <div style="font-size:10px;color:var(--muted);line-height:1.6;flex:1 1 420px;">
      Kabel: <span style="color:#66bb6a;">■</span> &lt; 70 % · <span style="color:#ffb300;">■</span> 70–100 % · <span style="color:#e53935;">■</span> überlastet ·
      <span style="color:var(--muted);">- -</span> Querschnitt nicht erfasst bzw. angenommen · <span style="color:#4fc3f7;">⚒</span> Ertüchtigung (bei aufgeklapptem Fahrplan) ·
      Knoten: Spannungsanhebung · <span style="color:#e53935;">◉</span> Engpass (Grenze erreicht) ·
      <span style="color:var(--accent);">▬</span> begrenzt das gewählte Dach · Schieber: <span style="color:#4fc3f7;">▼</span> Variante,
      <span style="color:#66bb6a;">▬</span> Spielraum bei der übrigen Belegung, roter Knopf = mehr als der Spielraum.
      Rechts: kWp belegt / Fläche (anklicken zum Eintippen) · ΔU am Anschlussknoten.</div>
    <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);" title="Was an den Kabeln steht">
      Beschriftung:
      ${[['auslastung', 'Auslastung'], ['du', 'ΔU am Knoten'], ['kabel', 'Kabel']].map(([k, t]) =>
        `<button class="pvna-knopf" data-pvna-beschr="${k}" style="${_beschr === k ? 'background:var(--accent);color:#111;border-color:var(--accent);' : ''}">${t}</button>`).join('')}
    </div>
  </div>
  <div data-pvna-rahmen style="${_vollbild || _ausgeklappt ? '' : 'max-height:72vh;'}overflow:auto;border:1px solid var(--border);border-radius:7px;">
    <div data-pvna-inhalt style="display:flex;align-items:flex-start;min-width:max-content;">
      <div data-pvna-svg style="flex:none;"></div>
      <div style="flex:1 1 auto;min-width:430px;border-left:1px solid var(--border);">${_zeilenHtml(erg)}</div>
    </div>
  </div>`;

  if (!root.dataset.pvnaEreignisse) { root.dataset.pvnaEreignisse = '1'; _ereignisse(root); }
  _aktualisieren();
  _groesseAnpassen();
  _navigationAnpassen();
}

/** Ausgeklappt: die Ergebnis-Navigation der PV-Analyse (erste Spalte von #pva-ergebnisse) ausblenden.
 *  Beim Wechsel in eine andere Ansicht setzt 09d (_pvaRenderView) das Raster zurück. */
function _navigationAnpassen() {
  const raster = document.getElementById('pva-ergebnisse');
  const nav = raster?.firstElementChild;
  if (!raster || !nav) return;
  const breit = _ausgeklappt && !_vollbild;
  raster.style.gridTemplateColumns = breit ? 'minmax(0,1fr)' : '224px minmax(0,1fr)';
  nav.style.display = breit ? 'none' : 'flex';
}

/**
 * Ganzseitenansicht: Rahmen bis zum unteren Bildrand strecken und — wenn
 * „einpassen" an ist — Schema + Schieber per CSS-zoom so verkleinern, dass sie
 * ganz hineinpassen. zoom statt transform, damit Zeilenausrichtung, Scrollmaß
 * und Schieber-Mausposition stimmen.
 */
function _groesseAnpassen() {
  const root = document.getElementById('pva-pvna-schema');
  const rahmen = root?.querySelector('[data-pvna-rahmen]');
  const inhalt = root?.querySelector('[data-pvna-inhalt]');
  if (!rahmen || !inhalt) return;
  inhalt.style.zoom = '';
  if (!_vollbild) { rahmen.style.height = ''; return; }
  // Mindestens 60 % der Bildhöhe — sonst quetscht ein aufgeklappter Fahrplan das
  // Schema auf einen Streifen (die Ganzseitenansicht scrollt dann als Ganzes).
  const oben = rahmen.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  const hoehe = Math.max(200, 0.6 * window.innerHeight, window.innerHeight - oben - 12);
  rahmen.style.height = hoehe + 'px';
  if (!_einpassen) return;
  const f = Math.min(1, (hoehe - 4) / inhalt.scrollHeight, (rahmen.clientWidth - 4) / inhalt.scrollWidth);
  if (f < 1) inhalt.style.zoom = String(Math.max(0.3, f));
}

function _vollbildUmschalten(an) {
  _vollbild = an;
  pvnaSchemaRender();
}

window.addEventListener('resize', () => { if (_vollbild) _groesseAnpassen(); });
document.addEventListener('keydown', ev => { if (_vollbild && ev.key === 'Escape') _vollbildUmschalten(false); });

/** Einmal je Container — die Handler lesen das aktuelle Ergebnis aus _quelle. */
function _ereignisse(root) {
  const live = () => _quelle.modell.eingabe.daecher.length <= LIVE_MAX_DAECHER;
  const daecher = () => _quelle.modell.eingabe.daecher;

  root.addEventListener('input', ev => {
    if (!_quelle) return;
    const t = ev.target;
    if (t.dataset.pvnaSl != null) {
      _bel.set(t.dataset.pvnaSl, +t.value);
      _auswahl = t.dataset.pvnaSl;
      _planen({ spielraum: live() });
    } else if (t.dataset.pvnaGruppe != null) {
      const f = +t.value / 100;
      const ids = _layout.rows.find(r => r.typ === 'zu' && r.eid === t.dataset.pvnaGruppe)?.daecher || [];
      const byId = new Map(daecher().map(d => [d.id, d]));
      for (const id of ids) _bel.set(id, (byId.get(id)?.kwpMax || 0) * f);
      _planen({ spielraum: live() });
    } else if (t.dataset.pvnaGesamt != null) {
      const f = +t.value / 100;
      for (const d of daecher()) _bel.set(d.id, d.kwpMax * f);
      root.querySelector('[data-pvna-gesamt-wert]').textContent = _fmt(+t.value) + ' %';
      _planen({ spielraum: live() });
    }
  });
  root.addEventListener('change', ev => {
    if (ev.target.dataset.pvnaNurpv != null) { _nurPv = ev.target.checked; pvnaSchemaRender(); return; }
    if (ev.target.dataset.pvnaFvar != null) {
      _fahrplanWahl(+ev.target.dataset.pvnaFvar, ev.target.checked);
      _aktualisieren({ spielraum: false });
      return;
    }
    if (ev.target.dataset.pvnaEinpassen != null) { _einpassen = ev.target.checked; _groesseAnpassen(); return; }
    if (ev.target.dataset.pvnaErsatz != null) {
      // Neue Annahme → Netzaufnahme neu rechnen; die eingestellte Belegung bleibt (gleicher Dachbestand)
      pvnaErsatzQsSetzen(+ev.target.value);
      pvnaSchemaRender();
      return;
    }
    if (ev.target.dataset.pvnaEingabe != null) return;       // Zahleneingabe: Übernahme beim Verlassen
    if (_quelle && ev.target.matches('.pvna-sl')) _planen({ spielraum: true });
  });
  // Zahleneingabe je Dach: Enter/Verlassen übernimmt, Esc verwirft
  root.addEventListener('keydown', ev => {
    const t = ev.target;
    if (t.dataset?.pvnaEingabe == null) return;
    if (ev.key === 'Enter') t.blur();
    else if (ev.key === 'Escape') { ev.stopPropagation(); t.dataset.abbruch = '1'; t.blur(); }
  });
  root.addEventListener('focusout', ev => {
    const t = ev.target;
    if (t.dataset?.pvnaEingabe == null || !_quelle) return;
    const id = t.dataset.pvnaEingabe;
    const d = daecher().find(x => x.id === id);
    if (d && !t.dataset.abbruch) {
      const v = parseFloat(String(t.value).replace(',', '.'));
      if (Number.isFinite(v)) _bel.set(id, Math.min(Math.max(0, v), d.kwpMax));
    }
    _auswahl = id;
    t.remove();
    _planen({ spielraum: true });
  });

  root.addEventListener('click', ev => {
    const t = ev.target.closest('[data-pvna-aktion],[data-pvna-max],[data-pvna-wahl],[data-pvna-dach],[data-pvna-klapp],[data-pvna-mass],[data-pvna-stufe],[data-pvna-leer],[data-pvna-beschr],[data-pvna-wert]');
    if (!t || !_quelle) return;
    const erg = _quelle;
    if (t.dataset.pvnaWert != null) {
      if (t.querySelector('input')) return;
      const id = t.dataset.pvnaWert;
      const d = daecher().find(x => x.id === id);
      if (!d) return;
      t.innerHTML = `<input type="number" data-pvna-eingabe="${escHtml(id)}" min="0" max="${d.kwpMax}" step="0.1"
        value="${(_bel.get(id) || 0).toFixed(1)}" style="width:66px;font-size:10.5px;padding:0 3px;text-align:right;">`;
      const inp = t.querySelector('input');
      inp.focus();
      inp.select();
      return;
    }
    if (t.dataset.pvnaBeschr) {
      _beschr = t.dataset.pvnaBeschr;
      pvnaSchemaRender();
      return;
    }
    if (t.dataset.pvnaAktion === 'kopieren') { _aussageKopieren(root, t); return; }
    if (t.dataset.pvnaAktion === 'fahrplan') {
      _fahrplanAuf = !_fahrplanAuf;
      _aktualisieren({ spielraum: false });
      _groesseAnpassen();
      return;
    }
    if (t.dataset.pvnaMass) {
      const id = t.dataset.pvnaMass;
      if (_mass.has(id)) _mass.delete(id); else _mass.add(id);
      _aktualisieren();
      return;
    }
    if (t.dataset.pvnaStufe != null) {
      // Fahrplan „bis hier": Stufen 1…k umsetzen und bis zur neuen Netzgrenze füllen
      const k = +t.dataset.pvnaStufe;
      _mass = new Set(erg.treppe.schritte.slice(0, k).flatMap(st => st.massnahmen.map(m => m.elementId)));
      _fuellen(erg);
      _aktualisieren();
      return;
    }
    if (t.dataset.pvnaLeer) {
      const id = t.dataset.pvnaLeer;
      if (_leerAuf.has(id)) _leerAuf.delete(id); else _leerAuf.add(id);
      pvnaSchemaRender();
      return;
    }
    if (t.dataset.pvnaKlapp) {
      const id = t.dataset.pvnaKlapp;
      if (_zu.has(id)) _zu.delete(id); else _zu.add(id);
      pvnaSchemaRender();
      return;
    }
    if (t.dataset.pvnaAktion) {
      const a = t.dataset.pvnaAktion;
      if (a === 'vollbild') { _vollbildUmschalten(!_vollbild); return; }
      if (a === 'allezu' || a === 'alleauf') {
        // Alles einklappen = jeder Trafo wird zu einer Summenzeile. Unterknoten bleiben
        // offen, damit ein wieder aufgeklappter Trafo den ganzen Strang zeigt.
        _zu = a === 'allezu' ? new Set(erg.modell.eingabe.elemente.filter(e => e.typ === 'trafo').map(e => e.id)) : new Set();
        // „Alles ausklappen" zeigt auch die Abgänge ohne PV, „Alles einklappen" faltet sie wieder
        _leerAuf = a === 'alleauf' ? new Set(_layout?.mitLeer || []) : new Set();
        pvnaSchemaRender();
        return;
      }
      if (a === 'ausklappen') {
        _ausgeklappt = !_ausgeklappt;
        pvnaSchemaRender();
        document.getElementById('pva-pvna-schema')?.scrollIntoView({ block: 'start' });
        return;
      }
      if (a === 'uebernehmen' || a === 'entfernen') { _varianteAendern(a); return; }
      if (a === 'fvar-alle' || a === 'fvar-keine') {
        window._pvAnalyse.fahrplanVarianten = a === 'fvar-alle' ? { alle: true, stufen: [] } : null;
        _aktualisieren({ spielraum: false });
        return;
      }
      if (a === 'fvar-rechnen') {
        const n = _fahrplanGewaehlt(erg.treppe.schritte.length).length;
        _neuRechnen(n ? `${n} Fahrplanstufe${n > 1 ? 'n' : ''} als Varianten übernommen` : 'Fahrplan-Varianten entfernt',
          n ? ' — sie stehen im Varianten-Vergleich als „Fahrplan Stufe k".' : '.');
        return;
      }
      if (a === 'laden') _eigeneLaden(erg);
      else if (a === 'fuellen') _fuellen(erg);
      else if (a === 'variante') { _mass = new Set(); _setzeVariante(erg); }
      else if (a === 'voll') for (const d of daecher()) _bel.set(d.id, d.kwpMax);
      else if (a === 'null') for (const d of daecher()) _bel.set(d.id, 0);
      else if (a === 'gleich') {
        const f = _gleichmaessigMax(erg);
        for (const d of daecher()) _bel.set(d.id, d.kwpMax * f);
      }
    } else if (t.dataset.pvnaMax) {
      const id = t.dataset.pvnaMax;
      const sp = pvnaSpielraum(_eing(erg), _bel, id);
      _bel.set(id, Math.floor(sp.kwp * 10) / 10);
      _auswahl = id;
    } else {
      const id = t.dataset.pvnaWahl ?? t.dataset.pvnaDach;
      _auswahl = _auswahl === id ? null : id;
      if (t.dataset.pvnaDach) root.querySelector(`[data-pvna-zeile="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    _aktualisieren();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUSBAUFAHRPLAN
// ══════════════════════════════════════════════════════════════════════════════

/** Belegung = Befüllung mit den aktiven Maßnahmen (ertragsstärkste Dächer zuerst). */
function _fuellen(erg) {
  _bel = new Map(_fuellung(erg).daecher.map(d => [d.id, d.kwp]));
}

/** Restlücke bis zum Flächenpotenzial nach Ursache (Begrenzer nach allen Stufen). */
function _restGruppen(erg) {
  const { info } = erg.modell;
  const g = new Map();
  for (const d of erg.treppe.ende.daecher) {
    const rest = d.kwpMax - d.kwp;
    if (rest < 0.05) continue;
    const b = d.begrenzer;
    const key = (b?.elementId || '—') + '|' + (b?.art || '?');
    if (!g.has(key)) {
      const el = b?.elementId ? info.elInfo.get(b.elementId) : null;
      const art = { strom: 'Belastbarkeit', trafo: 'Trafoleistung', spannung: 'Spannung', vorbelastet: 'vorbelastet',
        'nicht-angebunden': 'nicht angebunden' }[b?.art] || 'ohne Angabe';
      const wer = el ? (el.knotenName ? `Kabel → ${el.knotenName}` : el.label) : '';   // Trafos haben keinen knotenName
      g.set(key, {
        kwp: 0, art,
        label: wer ? `${wer} (${art})` : art,
        voll: el ? `${el.label}${el.kabelText ? ' · ' + el.kabelText : ''} — ${art}` : art,
        sackgasse: !!el?.ungeloest && !el.teil, ausgeschoepft: !!el?.teil,
      });
    }
    g.get(key).kwp += rest;
  }
  const liste = [...g.values()].sort((a, b) => b.kwp - a.kwp);
  if (liste.length <= 5) return liste;
  const rest = liste.slice(4);
  return [...liste.slice(0, 4), { kwp: rest.reduce((t, x) => t + x.kwp, 0), label: `übrige (${rest.length} Engpässe)`,
    voll: rest.map(x => `${x.voll}: ${_fmt(x.kwp)} kWp`).join('\n'), sackgasse: false }];
}

/**
 * Wasserfall: Bestand → je Fahrplanstufe der Zuwachs → mit Ertüchtigung → Restlücke
 * nach Ursache → Flächenpotenzial. Stufenbalken sind anklickbar („bis Stufe k"),
 * die gestrichelte Linie ist die aktuelle Belegung.
 */
function _wasserfallSvg(erg) {
  const t = erg.treppe;
  const pot = t.basis.potenzialKwp || 1;
  const rest = _restGruppen(erg);
  const aktuell = [..._bel.values()].reduce((a, b) => a + b, 0);
  const alleAn = st => st.massnahmen.every(m => _mass.has(m.elementId));
  const balken = [
    { typ: 'basis', von: 0, bis: t.basis.summeKwp, label: 'Bestand', unter: 'ohne Ertüchtigung', stufe: 0, an: !_mass.size },
    ...t.schritte.map((st, i) => ({
      typ: 'stufe', von: st.summeKwp - st.zuwachsKwp, bis: st.summeKwp, stufe: i + 1, an: alleAn(st),
      label: `${st.sammel ? 'Sammelstufe' : 'Stufe'} ${i + 1}`,
      unter: `${_fmt(st.investEUR / 1000)} T€ · ${_fmt(st.eurProKwp)} €/kWp`,
      tip: `${st.sammel ? 'Sammelstufe — diese Maßnahmen wirken nur gemeinsam\n' : ''}${st.massnahmen.map(m => m.label).join('\n')}\n`
        + `+${_fmt(st.zuwachsKwp)} kWp für ${_fmt(st.investEUR)} € (${_fmt(st.eurProKwp)} €/kWp)\nKlicken: bis hier umsetzen`,
    })),
  ];
  if (t.schritte.length) balken.push({ typ: 'summe', von: 0, bis: t.ende.summeKwp, label: 'mit Ertüchtigung',
    unter: `${_fmt((t.schritte.at(-1)?.kumInvestEUR || 0) / 1000)} T€ gesamt` });
  let h = t.ende.summeKwp;
  for (const r of rest) {
    balken.push({ typ: 'rest', von: h, bis: h + r.kwp, label: r.label, unter: r.sackgasse ? 'keine Standardmaßnahme' : r.ausgeschoepft ? 'Standard ausgeschöpft' : 'nicht erschlossen',
      tip: `${r.voll}\n${_fmt(r.kwp)} kWp bleiben offen`, sackgasse: r.sackgasse });
    h += r.kwp;
  }
  balken.push({ typ: 'pot', von: 0, bis: pot, label: 'Flächenpotenzial', unter: '' });

  const n = balken.length;
  const PL = 54, PR = 12, PT = 18, PB = 50;
  const W = Math.max(640, n * 96 + PL + PR), H = 250;
  const bw = (W - PL - PR) / n;
  const y = v => PT + (1 - v / pot) * (H - PT - PB);
  const kurz = (txt, max) => txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
  const farbe = { basis: '#66bb6a', stufe: '#4fc3f7', summe: '#29b6f6', rest: '#ef9a9a', pot: 'none' };
  const out = [];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(pot * f)}" y2="${y(pot * f)}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${PL - 6}" y="${y(pot * f) + 3}" font-size="9" fill="var(--muted)" text-anchor="end">${_fmt(pot * f)}</text>`);
  }
  balken.forEach((b, i) => {
    const x = PL + i * bw + bw * 0.14, w = bw * 0.72;
    const y1 = y(b.bis), y0 = y(b.von);
    const klick = b.stufe != null ? `data-pvna-stufe="${b.stufe}" style="cursor:pointer;"` : '';
    // Verbindungslinie zum nächsten Balken (Wasserfall-Treppe)
    if (i < n - 1 && b.typ !== 'pot') {
      const naechst = balken[i + 1];
      const yl = y(b.bis);
      if (naechst.typ !== 'summe' && naechst.typ !== 'pot') {
        out.push(`<line x1="${x + w}" x2="${PL + (i + 1) * bw + bw * 0.14}" y1="${yl}" y2="${yl}" stroke="var(--muted)" stroke-width="0.8" stroke-dasharray="2,2"/>`);
      }
    }
    const hoehe = Math.max(1.5, y0 - y1);
    out.push(`<g ${klick}><title>${escHtml(b.tip || `${b.label}: ${_fmt(b.bis)} kWp`)}</title>
      <rect x="${x}" y="${y1}" width="${w}" height="${hoehe}" rx="2"
        fill="${farbe[b.typ]}" ${b.typ === 'pot' ? 'stroke="var(--text)" stroke-dasharray="4,3" stroke-width="1.2"' : ''}
        ${b.typ === 'rest' ? `opacity="${b.sackgasse ? 0.9 : 0.55}"` : ''}
        ${b.an ? 'stroke="var(--accent)" stroke-width="2.5"' : ''}/>
      <text x="${x + w / 2}" y="${y1 - 4}" font-size="9.5" text-anchor="middle" font-family="DM Mono,monospace"
        fill="${b.typ === 'rest' ? '#e57373' : 'var(--text)'}">${b.typ === 'stufe' || b.typ === 'rest' ? '+' : ''}${_fmt(b.bis - b.von)}</text>
      <text x="${x + w / 2}" y="${H - PB + 13}" font-size="9" text-anchor="middle" fill="var(--text)">${escHtml(kurz(b.label, 18))}</text>
      <text x="${x + w / 2}" y="${H - PB + 25}" font-size="8.5" text-anchor="middle" fill="var(--muted)">${escHtml(kurz(b.unter, 22))}</text></g>`);
  });
  // aktuelle Belegung
  out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(aktuell)}" y2="${y(aktuell)}" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="5,3"/>
    <text x="${W - PR}" y="${y(aktuell) - 4}" font-size="9" text-anchor="end" fill="var(--accent)">aktuelle Belegung ${_fmt(aktuell)} kWp</text>`);
  out.push(`<text x="12" y="${(PT + H - PB) / 2}" font-size="9" fill="var(--muted)" text-anchor="middle" transform="rotate(-90 12 ${(PT + H - PB) / 2})">kWp</text>`);
  return `<div style="overflow-x:auto;margin:4px 0 8px;"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${Math.min(W, 640)}px;max-width:${W}px;display:block;">${out.join('')}</svg></div>`;
}

function _fahrplanAktualisieren(root, erg) {
  const box = root.querySelector('[data-pvna-fahrplan]');
  if (!box) return;
  const liste = _massnahmenListe(erg);
  const t = erg.treppe;
  const umschalter = `<span data-pvna-aktion="fahrplan" style="cursor:pointer;" title="${_fahrplanAuf ? 'Fahrplan einklappen' : 'Wasserfall, Stufen und Maßnahmen zeigen'}">`
    + `${_fahrplanAuf ? '▾' : '▸'} <b>Ausbaufahrplan</b></span>`;
  if (!_fahrplanAuf) {
    // Eingeklappt: eine Zeile mit dem Wesentlichen — das Schema bleibt oben
    const aktiv = liste.filter(m => _mass.has(m.id));
    const n = t.schritte.length;
    const minEur = n ? Math.min(...t.schritte.map(st => st.eurProKwp)) : 0;
    const inhalt = !n
      ? (t.restKwp > 0.5 ? 'keine Standard-Ertüchtigung erschließt weitere Flächen.' : 'alle Flächen passen ohne Ertüchtigung ins Netz.')
      : `${n} Stufe${n > 1 ? 'n' : ''} erschließen <b style="color:var(--text);">+${_fmt(t.ende.summeKwp - t.basis.summeKwp)} kWp</b>
        (bis ${_fmt(t.ende.summeKwp)} kWp) für ${_fmt((t.schritte.at(-1)?.kumInvestEUR || 0) / 1000)} T€ · ab ${_fmt(minEur)} €/kWp`
        + (t.restKwp > 0.5 ? ` · ${_fmt(t.restKwp)} kWp ohne Standardlösung` : '');
    box.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;">
      ${umschalter}<span style="color:var(--muted);">— ${inhalt}</span>
      ${aktiv.length ? `<span style="color:#4fc3f7;">· aktiv: ${aktiv.length} Maßnahme${aktiv.length > 1 ? 'n' : ''} (${_fmt(aktiv.reduce((s2, m) => s2 + m.investEUR, 0) / 1000, 1)} T€)</span>` : ''}
      ${n || t.restKwp > 0.5 ? `<button class="pvna-knopf" data-pvna-aktion="fahrplan" style="margin-left:auto;">Fahrplan zeigen</button>` : ''}</div>`;
    return;
  }
  if (!liste.length) {
    box.innerHTML = `${umschalter} <span style="color:var(--muted);">— ${t.restKwp > 0.5
      ? 'keine Standard-Ertüchtigung erschließt weitere Flächen (Hinweise in „Netzaufnahme (Bestand)").'
      : 'alle Flächen passen ohne Ertüchtigung ins Netz.'}</span>${t.restKwp > 0.5 ? _wasserfallSvg(erg) : ''}`;
    return;
  }
  const chip = (m, warum = '') => {
    const an = _mass.has(m.id);
    return `<span data-pvna-mass="${escHtml(m.id)}" title="${escHtml(`${m.label} · ${_fmt(m.investEUR)} € · Klicken: ${an ? 'zurücknehmen' : 'umsetzen'}${warum ? '\n\n' + warum : ''}`)}"
      style="display:inline-flex;gap:4px;align-items:center;padding:1px 7px;margin:1px 4px 1px 0;border-radius:10px;cursor:pointer;
      border:1px solid #4fc3f7;${an ? 'background:#4fc3f7;color:#0b1a24;' : 'color:#4fc3f7;'}">${an ? '✓' : '⚒'} ${escHtml(m.label)}</span>`;
  };
  const alleAn = ids => ids.length && ids.every(id => _mass.has(id));
  const fv = window._pvAnalyse?.fahrplanVarianten;
  const gewaehlt = k => !!fv && (fv.alle || fv.stufen?.includes(k));
  const zeile = (k, inhalt, zuwachs, invest, eurKwp, summe, kum, an) => `
    <tr style="${an ? 'background:rgba(79,195,247,.10);' : ''}">
      <td style="padding:3px 6px;text-align:center;">${k ? `<input type="checkbox" data-pvna-fvar="${k}" ${gewaehlt(k) ? 'checked' : ''}
        title="Stufe ${k} als Variante „Fahrplan Stufe ${k}" in die PV-Analyse übernehmen">` : ''}</td>
      <td style="padding:3px 6px;white-space:nowrap;"><button class="pvna-knopf" data-pvna-stufe="${k}"
        title="${k ? `Stufen 1–${k} umsetzen und bis zur neuen Netzgrenze füllen` : 'Alle Maßnahmen zurücknehmen, Bestandsnetz füllen'}">▶ ${k ? 'bis Stufe ' + k : 'Bestand'}</button></td>
      <td style="padding:3px 6px;">${inhalt}</td>
      <td style="padding:3px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap;">${zuwachs}</td>
      <td style="padding:3px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap;">${invest}</td>
      <td style="padding:3px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap;">${eurKwp}</td>
      <td style="padding:3px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap;">${summe}</td>
      <td style="padding:3px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap;">${kum}</td></tr>`;
  const byId = new Map(liste.map(m => [m.id, m]));
  const zeilen = [zeile(0, '<span style="color:var(--muted);">Bestandsnetz ohne Ertüchtigung</span>', '—', '—', '—',
    _fmt(t.basis.summeKwp), '0', !_mass.size)];
  t.schritte.forEach((st, i) => {
    const ids = st.massnahmen.map(m => m.elementId);
    zeilen.push(zeile(i + 1, (st.sammel ? '<span style="color:var(--muted);" title="Diese Maßnahmen wirken nur gemeinsam">Sammelstufe: </span>' : '')
      + ids.map(id => chip(byId.get(id))).join(''), '+' + _fmt(st.zuwachsKwp), _fmt(st.investEUR / 1000, 1),
      _fmt(st.eurProKwp), _fmt(st.summeKwp), _fmt(st.kumInvestEUR / 1000, 1), alleAn(ids)));
  });
  const ohneStufe = liste.filter(m => !m.stufe);
  const ungeloest = [...erg.modell.info.elInfo.values()].filter(i => i.ungeloest && !i.teil && i.ungeloestGrund === 'strom').map(i => i.label);
  // Nur echte Stromgrenzen der Standardlösung nennen (Spannungsfälle löst oft ein vorgelagertes Kabel)
  const teilweise = [...erg.modell.info.elInfo.values()].filter(i => i.teil && i.teilText === 'größte Standardlösung').map(i => i.label);
  const f = _fuellung(erg);
  const aktivInv = liste.filter(m => _mass.has(m.id)).reduce((s2, m) => s2 + m.investEUR, 0);
  const th = (x, r) => `<th style="padding:3px 6px;font-weight:500;color:var(--muted);text-align:${r ? 'right' : 'left'};border-bottom:1px solid var(--border);">${x}</th>`;
  box.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px;">
      <span>${umschalter} <b>— Netzertüchtigungen in Reihenfolge der Wirksamkeit (€ je zusätzlichem kWp)</b></span>
      <span style="color:var(--muted);">Aktiv: ${_mass.size ? `<b style="color:#4fc3f7;">${_mass.size} Maßnahme${_mass.size > 1 ? 'n' : ''} · ${_fmt(aktivInv / 1000, 1)} T€</b>` : 'keine'}
        · Netzgrenze damit <b style="color:var(--text);">${_fmt(f.summeKwp)} kWp</b> von ${_fmt(f.potenzialKwp)} kWp</span>
    </div>
    ${_wasserfallSvg(erg)}
    ${_fahrplanVariantenLeiste(t.schritte.length)}
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
      <thead><tr>${th('als Variante')}${th('')}${th('Maßnahmen — anklicken zum Umsetzen/Zurücknehmen')}${th('Zuwachs kWp', 1)}${th('Invest T€', 1)}${th('€/kWp', 1)}${th('Σ kWp', 1)}${th('Σ T€', 1)}</tr></thead>
      <tbody>${zeilen.join('')}</tbody></table></div>
    ${ohneStufe.length ? `<div style="margin-top:5px;color:var(--muted);">Weitere Maßnahmen ohne Zuwachs im Fahrplan (vorher begrenzt ein anderes Element — frei schaltbar zum Ausprobieren):
      ${ohneStufe.map(m => chip(m, _warumOhneZuwachs(erg, m.id))).join('')}
      <span style="color:var(--muted);">(Maus darüber: was dahinter begrenzt)</span></div>` : ''}
    <div style="margin-top:4px;color:var(--muted);line-height:1.5;">„▶ bis Stufe k" setzt die Stufen 1…k um und füllt die Dächer bis zur neuen Netzgrenze.
      Einzelne Maßnahmen lassen sich auch über ⚒ im Schema schalten; danach „▲ Bis zur Netzgrenze füllen" oder die Schieber nutzen.
      ${t.restKwp > 0.5 ? `Auch nach allen Stufen bleiben ${_fmt(t.restKwp)} kWp ohne Anschluss.` : ''}</div>
    ${ungeloest.length ? `<div style="margin-top:4px;color:#ffb74d;line-height:1.5;">Kein Standardkabel reicht für:
      ${ungeloest.map(escHtml).join(', ')} — hier endet der Fahrplan; weiter geht es nur mit einer Strukturänderung
      (zusätzlicher Abgang, eigene Anbindung).</div>` : ''}
    ${teilweise.length ? `<div style="margin-top:4px;color:#ffb74d;line-height:1.5;">Größte Standardlösung (8 Parallelstränge) reicht nicht für alle Flächen:
      ${teilweise.slice(0, 6).map(escHtml).join(', ')}${teilweise.length > 6 ? ` und ${teilweise.length - 6} weitere` : ''} — als Teil-Ertüchtigung im Fahrplan; der Rest dahinter braucht eine Strukturänderung
      (zusätzlicher Abgang, eigene Anbindung, weiterer Trafo).</div>` : ''}`;
}

/** Stufen, die gerade als Variante im Ergebnis stehen (Stand der letzten Variantenrechnung). */
function _fahrplanImErgebnis() {
  return new Set((window._pvAnalyse?.ergebnisse || [])
    .map(e => /^fahrplan-(\d+)$/.exec(e.id)?.[1]).filter(Boolean).map(Number));
}

/** Gewählte Stufen als Liste (aus { alle } oder { stufen }). */
function _fahrplanGewaehlt(n) {
  const fv = window._pvAnalyse?.fahrplanVarianten;
  if (!fv) return [];
  return fv.alle ? Array.from({ length: n }, (_, i) => i + 1) : (fv.stufen || []).filter(k => k <= n);
}

function _fahrplanVariantenLeiste(n) {
  if (!n) return '';
  const gew = _fahrplanGewaehlt(n);
  const ist = _fahrplanImErgebnis();
  const aktuell = gew.length === ist.size && gew.every(k => ist.has(k));
  const knopf = (akt, txt, tip, betont) => `<button class="${betont ? 'btn-confirm' : 'pvna-knopf'}" style="padding:3px 9px;font-size:10.5px;"
    data-pvna-aktion="${akt}" title="${tip}">${txt}</button>`;
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 6px;">
    <span style="font-weight:600;">Stufen als Varianten:</span>
    ${knopf('fvar-alle', '☑ alle Stufen', `Alle ${n} Stufen als Varianten „Fahrplan Stufe 1…${n}" übernehmen`)}
    ${knopf('fvar-keine', '☐ keine', 'Keine Fahrplanstufe als Variante')}
    ${knopf('fvar-rechnen', '↻ Varianten neu rechnen', 'Die Auswahl in die PV-Analyse übernehmen und alle Varianten neu rechnen', !aktuell)}
    <span style="color:var(--muted);">${gew.length ? `${gew.length} von ${n} gewählt` : 'keine gewählt'}
      ${aktuell ? (ist.size ? ' · stehen im Varianten-Vergleich' : '') : ' · <span style="color:#ffb74d;">Auswahl geändert — neu rechnen</span>'}
      · erscheinen im Varianten-Vergleich, nicht in Abbildungen und Gutachten</span>
  </div>`;
}

/** Auswahl der Fahrplan-Varianten ändern (ohne zu rechnen). */
function _fahrplanWahl(stufe, an) {
  const s = window._pvAnalyse;
  if (!s || !_quelle) return;
  const n = _quelle.treppe.schritte.length;
  const set = new Set(_fahrplanGewaehlt(n));
  if (an) set.add(stufe); else set.delete(stufe);
  s.fahrplanVarianten = set.size ? (set.size === n ? { alle: true, stufen: [] } : { alle: false, stufen: [...set].sort((a, b) => a - b) }) : null;
}

/**
 * Warum bringt eine Maßnahme im Fahrplan keinen Zuwachs? Mit allen Fahrplanstufen
 * plus dieser Maßnahme befüllen und für die Dächer HINTER dem Element sammeln,
 * was sie begrenzt (oder dass sie schon voll sind).
 */
function _warumOhneZuwachs(erg, elementId) {
  const { info } = erg.modell;
  const ids = new Set([...erg.treppe.schritte.flatMap(st => st.massnahmen.map(m => m.elementId)), elementId]);
  const eingabe = pvnaMassnahmenAnwenden(erg.modell.eingabe, ids);
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  const hinter = d => {
    let cur = d.elementId;
    const ges = new Set();
    while (cur != null && byId.has(cur) && !ges.has(cur)) { if (cur === elementId) return true; ges.add(cur); cur = byId.get(cur).parentId; }
    return false;
  };
  const betroffen = eingabe.daecher.filter(hinter);
  if (!betroffen.length) return 'Hinter diesem Element hängen keine Dächer.';
  const f = pvnaFuellen(eingabe);
  const res = new Map(f.daecher.map(d => [d.id, d]));
  const gruende = new Map();
  let voll = 0;
  for (const d of betroffen) {
    const r = res.get(d.id);
    if (!r || r.kwp >= r.kwpMax - 0.05) { voll++; continue; }
    const b = r.begrenzer;
    const el = b?.elementId ? info.elInfo.get(b.elementId) : null;
    const art = { strom: 'Belastbarkeit', trafo: 'Trafoleistung', spannung: 'Spannung', vorbelastet: 'vorbelastet' }[b?.art] || b?.art || '?';
    const txt = `${el?.label || 'unbekannt'} (${art}${el?.ungeloest && !el.teil ? ', keine Standardmaßnahme' : el?.teil ? ', ' + el.teilText : ''})`;
    gruende.set(txt, (gruende.get(txt) || 0) + (r.kwpMax - r.kwp));
  }
  if (!gruende.size) return `Alle ${betroffen.length} Dächer dahinter sind schon voll angeschlossen.`;
  return `${betroffen.length === 1 ? 'Das Dach' : `Die ${betroffen.length} Dächer`} dahinter begrenzt vorher:\n`
    + [...gruende].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, k]) => `• ${t}: ${_fmt(k)} kWp offen`).join('\n')
    + (voll ? `\n(${voll} Dächer sind schon voll)` : '');
}

/** Größter gemeinsamer Anteil (0…1) aller Dächer, bei dem das Netz noch hält — Bisektion. */
function _gleichmaessigMax(erg) {
  const eingabe = _eing(erg);
  const bel = f => new Map(eingabe.daecher.map(d => [d.id, d.kwpMax * f]));
  if (pvnaLastfluss(eingabe, bel(1)).zulaessig) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (pvnaLastfluss(eingabe, bel(m)).zulaessig) lo = m; else hi = m;
  }
  return lo;
}

// ══════════════════════════════════════════════════════════════════════════════
// ALS VARIANTE ÜBERNEHMEN
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// GUTACHTEN-ABBILDUNG — Zeichenliste für 17-gutachten-grafik.js
// ══════════════════════════════════════════════════════════════════════════════
// 17 importiert dieses Modul nicht (App-Kern-Zyklen) und holt die Daten über
// window.pvnaSchemaDruck. Die Liste ist serialisierbar (steht in der Figuren-
// Konfiguration) und nennt Farben nur als Rolle — 17 löst sie im Gutachten-Stil
// auf: ok | warn | over | text | muted | faint | akzent | papier.

const DRUCK = { kwpX: 196, duX: 256, rest: 270, nameMax: 26 };

/**
 * Einlinienschema als Zeichenliste. quelle: 'variante' (Belegung der Variante
 * „Bestandsnetz", ohne Ertüchtigung) oder 'eigene' (übernommene eigene Belegung
 * samt Ertüchtigungen). null, wenn es kein Netz mit Trafo oder keine Flächen gibt.
 */
export function pvnaSchemaDruck({ quelle = 'variante' } = {}) {
  let erg = pvnaLetztesErgebnis();
  if (!erg) {
    try { pvnaFuerVariante(); } catch (err) { console.warn('[Einlinienschema] Netzaufnahme nicht berechenbar:', err); }
    erg = pvnaLetztesErgebnis();
  }
  if (!erg || !erg.modell.eingabe.daecher.length || !erg.modell.eingabe.elemente.some(e => e.typ === 'trafo')) return null;
  const { info } = erg.modell;
  const roh = erg.modell.eingabe;
  let bel, mass = new Set(), belegungLabel = 'Variante „Bestandsnetz" (ohne Ertüchtigung)';
  const eig = window._pvAnalyse?.eigeneBelegung;
  if (quelle === 'eigene' && eig?.belegung) {
    bel = new Map(roh.daecher.map(d => [d.id, Math.min(+eig.belegung[d.id] || 0, d.kwpMax)]));
    const angeboten = new Set(roh.elemente.filter(e => e.massnahme).map(e => e.id));
    mass = new Set((eig.massnahmen || []).map(m => m.elementId).filter(id => angeboten.has(id)));
    belegungLabel = `Bestandsnetz, eigene Belegung${mass.size ? ` mit ${mass.size} Ertüchtigung${mass.size > 1 ? 'en' : ''}` : ''}`;
  } else {
    bel = new Map(erg.treppe.basis.daecher.map(d => [d.id, d.kwp]));
  }
  const eingabe = pvnaMassnahmenAnwenden(roh, mass);
  const lf = pvnaLastfluss(eingabe, bel);
  const eng = _engpaesse(eingabe, lf);
  const grenze = eingabe.duGrenzePct;
  const { rows, pos, kinder, xRoof } = _layoutBilden(erg.modell, true, new Set(), new Set());
  const byId = new Map(eingabe.elemente.map(e => [e.id, e]));
  const dachById = new Map(eingabe.daecher.map(d => [d.id, d]));

  const KOPF = ROW;                                   // Zeile für die Spaltenköpfe
  const y = row => KOPF + _y(row);
  const xT = xRoof + 16;
  const out = [];
  const ausl = a => a > 100 + 1e-6 ? 'over' : a >= 70 ? 'warn' : 'ok';
  const duR = u => u > grenze + 1e-6 ? 'over' : u >= 0.7 * grenze ? 'warn' : 'ok';
  const lin = (x1, y1, x2, y2, f, w, o = {}) => out.push({ t: 'l', x1, y1, x2, y2, f, w, ...o });
  const txt = (x, yy, s, o = {}) => out.push({ t: 't', x, y: yy, s: String(s), ...o });
  const kurz = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

  txt(xT, KOPF - 8, 'Dachfläche', { f: 'muted', size: 8.5, weight: 600 });
  txt(xT + DRUCK.kwpX, KOPF - 8, 'kWp belegt / Fläche', { f: 'muted', size: 8.5, weight: 600, anchor: 'end' });
  txt(xT + DRUCK.duX, KOPF - 8, 'ΔU', { f: 'muted', size: 8.5, weight: 600, anchor: 'end' });
  lin(0, KOPF - 3, xT + DRUCK.rest, KOPF - 3, 'faint', 0.6);

  // Stränge
  for (const [eid, p] of pos) {
    const ks = kinder.get(eid) || [];
    const istTrafo = byId.get(eid).typ === 'trafo';
    if (p.lastRow <= p.row && !istTrafo) continue;
    const x = _nodeX(p.depth);
    const bis = Math.max(p.lastRow, ...ks.map(k => pos.get(k).row));
    if (istTrafo) lin(x, y(p.row) - 8, x, y(bis) + 8, 'text', 4);
    else lin(x, y(p.row), x, y(bis), 'muted', 1.2);
  }
  // Kabel
  for (const e of eingabe.elemente) {
    if (e.typ === 'trafo') continue;
    const p = pos.get(e.id), pp = pos.get(e.parentId);
    if (!p || !pp) continue;
    const i = info.elInfo.get(e.id) || {};
    const x1 = _nodeX(pp.depth), x2 = _nodeX(p.depth), yy = y(p.row);
    const a = lf.auslastungPct.get(e.id) || 0;
    const unbekannt = i.kab?.unbekannt, intern = i.kab?.stationsintern, ersatz = i.kab?.ersatz;
    const f = unbekannt || intern ? 'faint' : ausl(a);
    if (eng.strom.includes(e.id)) lin(x1, yy, x2, yy, 'over', 11, { o: 0.22, cap: 'round' });
    if (mass.has(e.id)) lin(x1, yy, x2, yy, 'akzent', 8, { o: 0.3 });
    lin(x1, yy, x2, yy, f, intern ? 1.5 : 3, unbekannt || ersatz ? { dash: '4 3' } : {});
    if (!intern) txt((x1 + x2) / 2, yy - 5, unbekannt ? '? mm²' : _fmt(a) + ' %', { f, size: 8.5, mono: true, anchor: 'middle',
      weight: eng.strom.includes(e.id) ? 700 : 500 });
  }
  // Knoten
  for (const e of eingabe.elemente) {
    if (e.typ === 'trafo') continue;
    const p = pos.get(e.id);
    if (!p) continue;
    const i = info.elInfo.get(e.id) || {};
    const du = lf.duPct.get(e.id) || 0;
    const x = _nodeX(p.depth), yy = y(p.row);
    if (eng.spannung.includes(e.id)) out.push({ t: 'c', cx: x, cy: yy, r: 8.5, fill: 'over', fo: 0.15, stroke: 'over', sw: 1.2 });
    out.push({ t: 'c', cx: x, cy: yy, r: 4, fill: duR(du), stroke: 'papier', sw: 1 });
    if ((kinder.get(e.id) || []).length && i.knotenName) txt(x + 5, yy + 12, kurz(i.knotenName + _vorlastText(e), 34), { f: 'muted', size: 8 });
  }
  // Trafos
  for (const e of eingabe.elemente.filter(x => x.typ === 'trafo')) {
    const p = pos.get(e.id);
    if (!p) continue;
    const i = info.elInfo.get(e.id) || {};
    const a = lf.auslastungPct.get(e.id) || 0;
    const yy = y(p.row), f = ausl(a);
    if (eng.strom.includes(e.id)) out.push({ t: 'r', x: X_TRAFO - 16, y: yy - 11, w: 32, h: 22, rx: 11, fill: 'over', fo: 0.18, stroke: 'over', sw: 1.2 });
    lin(X_TRAFO + 12, yy, X_SCHIENE, yy, 'text', 2);
    out.push({ t: 'c', cx: X_TRAFO - 5, cy: yy, r: 8, fill: 'none', stroke: f, sw: 2 });
    out.push({ t: 'c', cx: X_TRAFO + 5, cy: yy, r: 8, fill: 'none', stroke: f, sw: 2 });
    txt(4, y(p.row - 1) + 4, `${i.label || e.id} — Einspeisung ${_fmt(lf.flussKw.get(e.id))} kW (${_fmt(a)} % der Trafoleistung)`,
      { size: 10, weight: 700 });
  }
  // Zeilen
  rows.forEach((r, row) => {
    const yy = y(row);
    if (r.typ === 'frei') { txt(4, yy + 4, 'nicht an einen Trafo angebunden', { f: 'over', size: 10, weight: 700 }); return; }
    if (r.typ === 'leer') {
      const x = _nodeX(pos.get(r.eid).depth);
      lin(x, yy, x + 14, yy, 'faint', 1, { dash: '2 2' });
      txt(x + 18, yy + 3.5, `${r.anzahl} Abg${r.anzahl === 1 ? 'ang' : 'änge'} ohne PV (nicht dargestellt)`, { f: 'faint', size: 8.5 });
      return;
    }
    if (r.typ === 'knoten') {
      const i = info.elInfo.get(r.eid) || {};
      if (i.knotenName) txt(_nodeX(pos.get(r.eid).depth) + 8, yy + 3, kurz(i.knotenName + _vorlastText(byId.get(r.eid)), 34), { f: 'muted', size: 8.5 });
      return;
    }
    if (r.typ !== 'dach') return;
    const d = dachById.get(r.dachId);
    const kwp = bel.get(r.dachId) || 0;
    const p = r.eid ? pos.get(r.eid) : null;
    if (p) lin(_nodeX(p.depth), yy, xRoof - 9, yy, 'faint', 1, { dash: '2 3' });
    out.push({ t: 'r', x: xRoof - 9, y: yy - 6, w: 18, h: 12, fill: 'papier', stroke: 'muted', sw: 1 });
    if (kwp > 0 && d.kwpMax > 0) out.push({ t: 'r', x: xRoof - 9, y: yy - 6, w: 18 * Math.min(1, kwp / d.kwpMax), h: 12, fill: 'ok', fo: 0.8 });
    const du = d.elementId ? lf.duPct.get(d.elementId) || 0 : 0;
    txt(xT, yy + 3.5, kurz(info.dachInfo.get(r.dachId)?.name || r.dachId, DRUCK.nameMax), { size: 9.5 });
    txt(xT + DRUCK.kwpX, yy + 3.5, `${_fmt(kwp, 1)} / ${_fmt(d.kwpMax)}`, { size: 9.5, mono: true, anchor: 'end', f: kwp > 0.05 ? 'text' : 'faint' });
    txt(xT + DRUCK.duX, yy + 3.5, d.elementId ? _fmt(du, 2) + ' %' : '—', { size: 9.5, mono: true, anchor: 'end', f: duR(du) });
  });

  const pot = eingabe.daecher.reduce((t, d) => t + d.kwpMax, 0);
  const kabel = eingabe.elemente.filter(e => e.typ === 'kabel' && Number.isFinite(e.kapKw));
  const trafos = eingabe.elemente.filter(e => e.typ === 'trafo');
  const maxA = l => l.reduce((m, e) => Math.max(m, lf.auslastungPct.get(e.id) || 0), 0);
  const unbek = eingabe.elemente.filter(e => { const k = info.elInfo.get(e.id)?.kab; return k?.unbekannt || k?.ersatz; }).length;
  return {
    breite: xT + DRUCK.rest, hoehe: KOPF + rows.length * ROW + 4, zeichnung: out, belegungLabel, quelle,
    kennzahlen: {
      summeKwp: lf.summeKwp, potenzialKwp: pot, anteilPct: pot > 0 ? lf.summeKwp / pot * 100 : 0,
      maxTrafoPct: maxA(trafos), maxKabelPct: maxA(kabel), maxDuPct: lf.maxDuPct, duGrenzePct: grenze,
      zulaessig: lf.zulaessig, engpaesse: eng.strom.length + eng.spannung.length,
      einspFaktor: eingabe.daecher[0]?.einspFaktor, jahr: erg.jahr, unbekannteQs: unbek, ersatzQs: +info.ersatzQs || 0,
      massnahmen: mass.size,
      investEUR: roh.elemente.filter(e => mass.has(e.id)).reduce((t, e) => t + (+e.massnahme?.investEUR || 0), 0),
    },
  };
}

function _varianteZeile(root, lf) {
  const box = root.querySelector('[data-pvna-variante]');
  if (!box) return;
  const eig = window._pvAnalyse?.eigeneBelegung;
  const knopf = (akt, txt, tip, betont) => `<button class="${betont ? 'btn-confirm' : 'pvna-knopf'}"
    style="padding:4px 10px;font-size:10.5px;" data-pvna-aktion="${akt}" title="${tip}">${txt}</button>`;
  box.innerHTML = `
    ${knopf('uebernehmen', eig ? '✚ Aktuelle Belegung übernehmen (ersetzt)' : '✚ Als Variante übernehmen',
      'Legt diese Belegung als Variante „Bestandsnetz, eigene Belegung" an und rechnet die Varianten neu', true)}
    <span style="color:var(--muted);">${_fmt(lf.summeKwp)} kWp${_mass.size ? ` + ${_mass.size} Ertüchtigung${_mass.size > 1 ? 'en' : ''}` : ''}${lf.zulaessig ? '' : ' · <span style="color:#e53935;">Netz hält nicht — wird mit Warnhinweis übernommen</span>'}</span>
    ${eig ? `<span style="flex-basis:100%;height:0;"></span>
      <span>Übernommen: <b>${_fmt(eig.summeKwp)} kWp</b>${eig.massnahmen?.length
        ? ` + ${eig.massnahmen.length} Ertüchtigung${eig.massnahmen.length > 1 ? 'en' : ''} (${_fmt(eig.massnahmen.reduce((t, m) => t + m.investEUR, 0) / 1000)} T€)` : ''} <span style="color:var(--muted);">(Stand ${escHtml(eig.stand || '—')})</span></span>
      ${knopf('laden', '↺ Übernommene Belegung laden', 'Die gespeicherte Belegung in die Schieber laden')}
      ${knopf('entfernen', '✕ Variante entfernen', 'Variante „Bestandsnetz, eigene Belegung" löschen und neu rechnen')}` : ''}
    ${_meldung ? `<span style="flex-basis:100%;color:#80cbc4;">${_meldung}</span>` : ''}`;
}

function _eigeneLaden(erg) {
  const eig = window._pvAnalyse?.eigeneBelegung;
  if (!eig?.belegung) return;
  for (const d of erg.modell.eingabe.daecher) _bel.set(d.id, Math.min(+eig.belegung[d.id] || 0, d.kwpMax));
  const angeboten = new Set(erg.modell.eingabe.elemente.filter(e => e.massnahme).map(e => e.id));
  _mass = new Set((eig.massnahmen || []).map(m => m.elementId).filter(id => angeboten.has(id)));
  const fehlend = Object.keys(eig.belegung).filter(id => !erg.modell.eingabe.daecher.some(d => d.id === id)).length;
  _meldung = 'Übernommene Belegung geladen.' + (fehlend ? ` ${fehlend} Dach/Dächer daraus gibt es nicht mehr.` : '');
}

/** Übernehmen oder Entfernen, danach die Varianten neu rechnen (sofern ein Lastgang vorliegt). */
function _varianteAendern(aktion) {
  const s = window._pvAnalyse;
  if (!s || !_quelle) return;
  if (aktion === 'uebernehmen') {
    const belegung = {};
    let summe = 0;
    for (const [id, kwp] of _bel) {
      if (!(kwp > 0)) continue;
      belegung[id] = Math.round(kwp * 10) / 10;
      summe += belegung[id];
    }
    s.eigeneBelegung = {
      belegung, summeKwp: summe,
      massnahmen: _massnahmenListe(_quelle).filter(m => _mass.has(m.id))
        .map(m => ({ elementId: m.id, label: m.label, investEUR: m.investEUR })),
      stand: new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    };
  } else {
    s.eigeneBelegung = null;
  }
  _neuRechnen(aktion === 'uebernehmen' ? 'Übernommen' : 'Variante entfernt',
    aktion === 'uebernehmen' ? ' — die Variante „Bestandsnetz, eigene Belegung" steht im Varianten-Vergleich.' : '.');
}

/** Varianten neu rechnen (sofern ein Lastgang vorliegt) und das Ergebnis melden. */
function _neuRechnen(was, zusatz) {
  const lastgang = !!(window.elQuartierH15 || window.elQuartierH);
  if (!lastgang) {
    _meldung = `${was}. Ohne Stromlastgang lässt sich noch nicht rechnen — die Varianten entstehen beim nächsten „Varianten berechnen".`;
    _aktualisieren({ spielraum: false });
    return;
  }
  _meldung = 'Berechne Varianten …';
  _aktualisieren({ spielraum: false });
  // Einen Frame warten, damit die Meldung sichtbar ist — die Variantenrechnung blockiert.
  setTimeout(() => {
    try {
      window.pvBerechneAlle?.();
      _meldung = `${was} und Varianten neu berechnet${zusatz}`;
    } catch (err) {
      console.warn('[Einlinienschema] Variantenrechnung fehlgeschlagen:', err);
      _meldung = `${was}, aber die Variantenrechnung ist fehlgeschlagen — bitte „Varianten berechnen" von Hand starten.`;
    }
    pvnaSchemaRender();
  }, 30);
}

export function pvnaSchemaBerechnen() {
  pvnaRechnen();
  pvnaSchemaRender();
}

window.pvnaSchemaRender = pvnaSchemaRender;
window.pvnaSchemaBerechnen = pvnaSchemaBerechnen;
window.pvnaSchemaDruck = pvnaSchemaDruck;
