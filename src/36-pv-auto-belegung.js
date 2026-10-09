// ── 36-pv-auto-belegung.js — „Dächer automatisch belegen" im PV-Modus ────────
//
// Massenbelegung statt Dach für Dach. Drei Fragen, unten immer eine Vorschau:
//   ① Welche Dächer?  Umfang (alle · Neubauten · PV-Pflicht-Fälle · Auswahl ·
//      Bereich auf der Karte · Netzgebiet eines Trafos) und Eignung
//      (Mindestgröße, Nutzungstypen; belegte/abgerissene/ausgeschlossene raus).
//   ② Wie belegen?    Wie „Grundriss als Fläche" mit den Vorgaben des PV-Modus
//      (Dachform, Neigung, Belegungsgrad, Nordseite aussparen) — 25 pvmProbe
//      rechnet das auf einer Kopie, 25 pvmStapelBelegen schreibt es.
//   ③ Wie viel?       Maximal (jedes Dach voll) oder netzverträglich: dieselbe
//      Netzrechnung wie die Netzaufnahme (28 pvnaModell + Core pvnaFuellen),
//      beste Erträge zuerst, jedes Dach nur GANZ oder gar nicht
//      (Nutzerentscheidung 06.10.2026). Schon geplante PV hat Vorrang (Vorlast).
//      Grenze wahlweise „nur Trafo": NS-Kabel begrenzen dann weder Strom noch
//      Spannung (Querschnitte oft unbekannt bzw. im Projekt leicht vergrößerbar);
//      Gebäude ganz ohne Kabelanbindung hängen dann am nächstgelegenen Trafo.
//      Gestuft: eine Gruppe (Neubauten · PV-Pflicht · Auswahl) wird immer voll
//      belegt und zählt als Vorlast, der Rest des Umfangs nur, soweit das Netz
//      es danach noch verträgt.
//
// Die Vorschau ändert nichts am Projekt; „Übernehmen" ist ein Strg+Z-Schritt.
// Alternativ wird die Vorschau als Belegungsstand gespeichert (38), ohne das
// Projekt anzufassen — ansehen, aktivieren, Potenzial bzw. Auslegung der PV-Analyse.
//
// Daneben „Belegungen entfernen": dieselben Umfänge, alle Flächen der Dächer
// samt PV-Asset weg, als Planungstransaktion (Strg+Z im PV-Modus).
// pvBelegungEntfernen ist auch der Weg, auf dem ein gelöschtes Dach-PV-Asset
// seine Flächen mitnimmt (13a deleteAsset, opts.nutzer).
// Nichts importiert dieses Modul — Panel und Karte rufen es über window.*
// (pvabBlockHtml / pvabMarkiereKarte), damit 25 kein Rückimport braucht.

import { map } from './02b-gebaeude.js';
import { polygonAreaM2 } from './02c-karte-werkzeuge.js';
import { _hasBelegung, calcGebKwp, calcGebKwpKorr, escHtml, getGebPvModules } from './03c-gebaeude-io.js';
import { ASSETS, TYPE_RANK, deleteAsset } from './13a-assets-core.js';
import { pvmPlanungsSchrittMerken, pvmProbe, pvmStapelBelegen, pvModusMarkiereKarte, pvModusRender } from './25-pv-modus.js';
import { normSchicht, SCHICHT } from './lib/schichten.js';
import { pvnaAbrissGeplant, pvnaEinstellungen, pvnaIstNeubau, pvnaJahre, pvnaMassnahmenErmitteln, pvnaModell } from './28-pv-netzaufnahme.js';
import { pvnaFuellen, pvnaTreppe, pvnaVollausbau } from './lib/pv-netzaufnahme-core.js';

const CYAN  = '#4dd0e1';
const GRUEN = '#66bb6a';
const ROT   = '#ef5350';
const GRAU  = '#9e9e9e';
const GELB  = '#ffd54f';
const HELLGRUEN = '#c5e1a5';
const ORANGE = '#ffa726';
const BRAUN = '#a1887f';

const UMFAENGE = [
  ['alle',    'Alle Dächer'],
  ['neubau',  'Nur Neubauten'],
  ['pflicht', 'PV-Pflicht-Fälle'],
  ['auswahl', 'Ausgewählte Gebäude'],
  ['bereich', 'Bereich auf der Karte'],
  ['trafo',   'Netzgebiet eines Trafos'],
];

/** Gruppen, die gestuft immer voll belegt werden. */
const VORRANG = [
  ['neubau',  'Neubauten'],
  ['pflicht', 'PV-Pflicht-Fälle'],
  ['auswahl', 'Ausgewählte Gebäude'],
];

const _ab = {
  /** @type {null | 'belegen' | 'entfernen'} offener Block */
  modus: null,
  umfang: 'alle',
  trafoId: null,
  /** @type {any} L.LatLngBounds */
  bereich: null,
  minM2: 50,
  /** ausgeschlossene Nutzungstyp-IDs ('' = ohne Typ) */
  ohneNutzung: new Set(),
  nutzungOffen: false,
  menge: 'max',               // 'max' | 'netz' | 'gestuft'
  vorrang: 'neubau',          // bei 'gestuft': diese Gruppe immer voll
  grenze: 'kabel',            // 'kabel' = Trafo + NS-Kabel · 'trafo' = nur der Trafo begrenzt
  ohneNetzBelegen: false,
  /** Verschattung prüfen (40-baeume.js): stark verschattete Flächen auslassen, Erträge mit Verschattung reihen */
  schatten: true,
  /** verwinkelte Grundrisse ohne Dachflächen in Flügel zerlegen (lib/dach-grundriss) */
  fluegel: true,
  /** Netzstand: Jahr, bis zu dem geplante Netzänderungen zählen (null = Rechenjahr der Netzaufnahme) */
  netzJahr: null,
  /** Ertüchtigung: 'keiner' (Bestandsnetz) | 'budget' (bis budgetT T€) | 'alle' */
  ausbau: 'keiner',
  budgetT: 100,
  /** @type {null | {zeilen:any[], sig:string, netz:any}} */
  vorschau: null,
};
let _bereichLayer = null;
/** Trafo-Zuordnung (Gebäude-ID → Trafo-Asset-ID) für den Umfang „Netzgebiet". */
let _trafoCache = null;

const _name = g => g?.name || ('Gebäude ' + g?.id);
const _fmt = (x, d = 0) => (Number.isFinite(x) ? x : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const _int = v => { const n = parseInt(v); return Number.isFinite(n) ? n : null; };
const _flaeche = g => parseFloat(g.flaeche) || polygonAreaM2(g.polygon) || 0;
/** Vorgaben + Auswahl, mit denen eine Vorschau gerechnet wurde. */
const _sig = () => JSON.stringify([window.pvModusVorgabe || null, _ab.umfang, _ab.trafoId, _ab.minM2,
  [..._ab.ohneNutzung].sort(), _ab.menge, _ab.menge === 'gestuft' ? _ab.vorrang : null,
  _ab.menge !== 'max' ? _ab.grenze : null,
  _ab.menge !== 'max' ? [_ab.netzJahr, _ab.ausbau, _ab.ausbau === 'budget' ? _ab.budgetT : null] : null,
  _ab.bereich ? _ab.bereich.toBBoxString() : null, _ab.schatten, _ab.fluegel]);
const _vorrangLabel = (w, stich) => w === 'neubau' ? `Neubauten (nach ${stich})` : (VORRANG.find(v => v[0] === w)?.[1] || w);

const _nordSektor = () => window.pvModusVorgabe?.nordSektor ?? 45;

function _nutzungsLabel(id) {
  if (!id) return 'ohne Typ';
  return window.getNutzungstypById?.(id)?.label || String(id);
}

function _trafos() {
  return ASSETS.items.filter(a => a.type === 'Trafo')
    .map(a => ({ id: a.id, name: a.name || ('Trafo ' + a.id), kva: a.props?.leistungKVA }));
}

/**
 * Wert eines Gebäudes in einer Knoten-Map (knotenEl/knotenTrafo aus pvnaModell).
 * Gebäude hängen meist über ihre eigenen Assets im Netz (NSHV, Verbraucher, PV)
 * — gesucht wird erst das Gebäude selbst, dann seine Assets, das tiefste
 * (PV vor Verbraucher vor NSHV) zuerst: dort speist die neue Anlage ein.
 */
function _gebKnoten(gId, karte) {
  if (karte.has(gId)) return karte.get(gId);
  const eigene = ASSETS.items.filter(a => a.buildingId === gId)
    .sort((a, b) => (TYPE_RANK[b.type] ?? 6) - (TYPE_RANK[a.type] ?? 6));
  for (const a of eigene) if (karte.has(a.id)) return karte.get(a.id);
  return null;
}

/** Grenze „nur Trafo" aktiv (nur beim Belegen mit Netzprüfung)? */
const _nurTrafo = () => _ab.modus === 'belegen' && _ab.menge !== 'max' && _ab.grenze === 'trafo';

function _gebMitte(g) {
  if (!Array.isArray(g?.polygon) || !g.polygon.length) return null;
  let la = 0, ln = 0;
  for (const p of g.polygon) { la += +p.lat; ln += +p.lng; }
  return { lat: la / g.polygon.length, lng: ln / g.polygon.length };
}

/** Nächstgelegener Trafo (Luftlinie) aus trafos = [{ pos, … }] → { …, m } | null */
function _naechsterTrafo(pos, trafos) {
  if (!pos) return null;
  let best = null;
  for (const t of trafos) {
    const m = map.distance(pos, t.pos);
    if (!best || m < best.m) best = { ...t, m };
  }
  return best;
}

function _trafoZuordnung() {
  if (_trafoCache) return _trafoCache;
  const ein = pvnaEinstellungen();
  const m = pvnaModell({ ...ein, quelle: 'alle', flaechen: 'alle' });
  _trafoCache = m.info.knotenTrafo || new Map();
  _trafoLeiter = m.info.trafoLeiter || new Map();
  return _trafoCache;
}
/** Trafos einer Gruppe (gemeinsame NSHV) teilen sich ein Netzgebiet — vertreten durch den ersten. */
let _trafoLeiter = new Map();

function _pflichtIds() {
  const liste = window.pvPflichtGebaeudeliste?.() || [];
  return new Set(liste.filter(f => f.pflichtFall === 'neubau' || f.pflichtFall === 'dachsanierung'
    || (f.pflichtFall !== 'keine' && (f.neubau || f.dachsanierung))).map(f => f.id));
}

/** Prüffunktion „gehört das Gebäude zum Umfang?" — gemeinsam für Belegen und Entfernen. */
function _umfangFilter(umfang, stich) {
  if (umfang === 'neubau') return g => pvnaIstNeubau(g, stich);
  if (umfang === 'pflicht') { const ids = _pflichtIds(); return g => ids.has(g.id); }
  if (umfang === 'auswahl') return g => !!g.selected;
  if (umfang === 'bereich') {
    const b = _ab.bereich;
    // Gebäude zählt, wenn seine Mitte im Rahmen liegt — angeschnittene Randgebäude nicht
    return g => { const c = _gebMitte(g); return !!b && !!c && b.contains(c); };
  }
  if (umfang === 'trafo') {
    const zu = _ab.trafoId != null ? _trafoZuordnung() : null;
    // „nur Trafo": Gebäude ohne Kabelanbindung gehören zum nächstgelegenen Trafo
    const trafos = _nurTrafo() ? ASSETS.items.filter(a => a.type === 'Trafo'
      && Number.isFinite(+a.lat) && Number.isFinite(+a.lng)).map(a => ({ id: a.id, pos: { lat: +a.lat, lng: +a.lng } })) : [];
    return g => {
      if (!zu) return false;
      const t = _gebKnoten(g.id, zu) ?? _naechsterTrafo(_gebMitte(g), trafos)?.id;
      return t === (_trafoLeiter.get(_ab.trafoId) ?? _ab.trafoId);
    };
  }
  return () => true;
}

/**
 * Kandidaten nach Umfang und Eignung. `vorNutzung` = alle, die nur noch am
 * Nutzungstyp scheitern könnten (für die Auswahlliste der Typen).
 */
function _kandidaten() {
  const { stich } = pvnaJahre(pvnaEinstellungen());
  const raus = { belegt: 0, klein: 0, nutzung: 0, weg: 0 };
  const umfangOk = _umfangFilter(_ab.umfang, stich);

  const vorNutzung = [], liste = [];
  for (const g of (window.gebaeude || [])) {
    if (!Array.isArray(g.polygon) || g.polygon.length < 3 || !umfangOk(g)) continue;
    // abgerissen oder Abriss geplant: generell keine PV, egal in welchem Jahr
    if (window.isExcluded?.(g.id) || pvnaAbrissGeplant(g)) { raus.weg++; continue; }
    if (_hasBelegung(g)) { raus.belegt++; continue; }
    if (_flaeche(g) < _ab.minM2) { raus.klein++; continue; }
    vorNutzung.push(g);
    if (_ab.ohneNutzung.has(g.nutzungstyp || '')) { raus.nutzung++; continue; }
    liste.push(g);
  }
  return { liste, vorNutzung, raus, stich };
}

// ══════════════════════════════════════════════════════════════════════════
// VORSCHAU
// ══════════════════════════════════════════════════════════════════════════

// Hinweis „⏳ …" erst zeichnen lassen; Timer statt rAF (pausiert in verdeckten Tabs)
const _naechsterFrame = () => new Promise(r => setTimeout(r, 30));

export async function pvabVorschau() {
  const { liste, stich } = _kandidaten();
  if (!liste.length) { alert('Keine passenden Dächer — Umfang oder Mindestgröße anpassen.'); return; }
  window.showHint?.(`⏳ Probebelegung von ${liste.length} Dächern …`, 0);
  await _naechsterFrame();
  try {
    const vorrangOk = _ab.menge === 'gestuft' ? _umfangFilter(_ab.vorrang, stich) : null;
    // Verschattung: Hindernisse (Bäume, Gebäude) einmal je Lauf
    const vsK = _ab.schatten && typeof window.verschattungKontext === 'function' ? window.verschattungKontext() : null;
    const vsAn = !!window.pvVerschattungAn?.();
    const zeilen = [];
    for (const g of liste) {
      // Verwinkelter Grundriss ohne Dachflächen → Flügel (Kopie; ins Projekt erst beim Übernehmen)
      const fg = _ab.fluegel ? window.d3dFluegelGebaeude?.(g) || null : null;
      const p = pvmProbe(fg || g, { mitKopie: true });   // Kopie: Grundlage eines Belegungsstands (38)
      const vorrang = !!vorrangOk?.(g);
      if (!p || !(p.kwp > 0)) { zeilen.push({ g, vorrang, kwp: 0, kwpKorr: 0, status: 'leer', grund: 'kein Modul passt' }); continue; }
      const z = { g, vorrang, kwp: p.kwp, kwpKorr: p.kwpKorr, module: p.module, kopie: p.kopie, status: 'voll', grund: '',
        fluegel: fg ? { dachFlaechen: fg.dachFlaechen, dachLod2: fg.dachLod2 } : null };
      if (vsK) {
        const vs = window.verschattungProbe(p.kopie, vsK);
        if (vs?.ganz) { z.status = 'schatten'; z.grund = `Verschattung −${_fmt(vs.verlustPct)} %`; }
        else if (vs) {
          z.vs = vs;
          if (vs.ausgelassen.length) {             // Kopie gekürzt → Leistung neu
            z.kwp = calcGebKwp(p.kopie) || 0; z.kwpKorr = calcGebKwpKorr(p.kopie) || 0; z.module = getGebPvModules(p.kopie).count || 0;
          }
          // Reihenfolge „beste Erträge zuerst“: Verschattung zählt mit (bei eingeschaltetem
          // Schalter steckt sie schon in kwpKorr)
          z.vsRang = vsAn ? 1 : vs.faktor;
        }
      }
      zeilen.push(z);
    }
    const netz = _ab.menge !== 'max' ? _netzPruefen(zeilen) : null;
    _ab.vorschau = { zeilen, sig: _sig(), netz, annahmen: window.pvmVorgabeText?.() || '' };
    window.hideHint?.();
  } catch (err) {
    console.error(err);
    window.showHint?.('Vorschau fehlgeschlagen: ' + err.message, 6000);
  }
  pvModusRender();
  pvModusMarkiereKarte();
}

function _begrenzerText(b, info) {
  if (!b) return '';
  const label = b.elementId ? (info.elInfo.get(b.elementId)?.label || b.elementId) : '';
  if (b.art === 'trafo') return 'Trafo voll: ' + label;
  if (b.art === 'strom') return 'Kabel voll: ' + label;
  if (b.art === 'spannung') return 'Spannungsanhebung > Grenze (' + label + ')';
  if (b.art === 'vorbelastet') return 'schon ausgelastet: ' + label;
  return label;
}

/**
 * Gruppe, die voll gebaut werden MUSS (Neubauten · PV-Pflicht · Auswahl) — gestuft
 * die Vorrang-Gruppe, netzverträglich der Umfang selbst. Für sie listet die
 * Vorschau die Engstellen. null = keine solche Gruppe.
 */
function _pflichtGruppe() {
  if (_ab.menge === 'gestuft') return _ab.vorrang;
  if (_ab.menge === 'netz' && VORRANG.some(v => v[0] === _ab.umfang)) return _ab.umfang;
  return null;
}

/**
 * Engstellen der Pflichtgruppe (Nutzerwunsch 07.10.2026): Was verhindert, dass ALLE
 * Dächer der Gruppe voll gebaut werden? Gerechnet wird der Vollausbau der Gruppe im
 * gewählten Netz (Netzjahr, schon geplante PV als Vorlast, gewählte Ertüchtigung) —
 * anders als der Begrenzer je Dach (gierige Füllung, nur das ERSTE volle Element)
 * zeigt das alle Elemente, die überlastet wären, auch hintereinanderliegende.
 *   Strom:    Fluss > Kapazität (Trafo bzw. NS-Kabel)
 *   Spannung: ΔU an einem Dach > Grenze → dem Kabel mit dem größten Beitrag auf
 *             seinem Pfad zugeschrieben
 * Abhilfe: Maßnahme wie in der Ausbautreppe, bemessen auf genau diese Gruppe.
 */
function _engstellen(els, gruppe, m, nurTrafo, nachId) {
  const eing = { elemente: els.map(e => ({ ...e })), daecher: gruppe,
    pruefpunkte: m.eingabe.pruefpunkte, duGrenzePct: m.eingabe.duGrenzePct };
  const voll = pvnaVollausbau(eing);
  const nurVorlast = pvnaVollausbau({ ...eing, daecher: [] }).flussKw;
  const elById = new Map(eing.elemente.map(e => [e.id, e]));
  const pfad = id => {
    const p = [], ges = new Set();
    for (let c = id; c != null && elById.has(c) && !ges.has(c); c = elById.get(c).parentId) { ges.add(c); p.push(c); }
    return p;
  };
  const grenze = eing.duGrenzePct;
  const treffer = new Map();          // elementId → Engstelle
  const eintrag = id => {
    if (!treffer.has(id)) {
      const e = elById.get(id), inf = m.info.elInfo.get(id);
      treffer.set(id, { id, typ: e.typ, label: inf?.label || id, kapKw: e.kapKw == null ? Infinity : +e.kapKw,flussKw: voll.flussKw.get(id) || 0,
        vorlastKw: nurVorlast.get(id) || 0, strom: false, duMaxPct: 0, gebIds: new Set(),
        unbekannt: !!(inf?.kab?.unbekannt || inf?.kab?.ersatz) });
    }
    return treffer.get(id);
  };
  for (const e of eing.elemente) {
    const kap = e.kapKw == null ? Infinity : +e.kapKw;
    if (Number.isFinite(kap) && (voll.flussKw.get(e.id) || 0) > kap + 0.01) eintrag(e.id).strom = true;
  }
  const pfadJeDach = new Map(gruppe.map(d => [d.id, pfad(d.elementId)]));
  for (const d of gruppe) {
    const du = voll.duPct.get('dach:' + d.id);
    if (!(du > grenze + 1e-6)) continue;
    let knapp = null, beitrag = -1;
    for (const eid of pfadJeDach.get(d.id)) {
      const b = (+elById.get(eid).duProKwPct || 0) * (voll.flussKw.get(eid) || 0);
      if (b > beitrag) { beitrag = b; knapp = eid; }
    }
    if (knapp == null) continue;
    const t = eintrag(knapp);
    t.duMaxPct = Math.max(t.duMaxPct, du);
  }
  if (!treffer.size) return [];
  // Dächer der Gruppe hinter jeder Engstelle
  for (const d of gruppe) for (const eid of pfadJeDach.get(d.id)) treffer.get(eid)?.gebIds.add(d.id);

  // Abhilfe: Maßnahmen auf genau diese Gruppe bemessen (mutiert nur die Kopie)
  const mEing = { ...eing, elemente: eing.elemente.map(e => ({ ...e })), ganzOderGar: true };
  pvnaMassnahmenErmitteln(mEing, m.info, { ohneKabel: nurTrafo });
  const massnahme = new Map(mEing.elemente.filter(e => e.massnahme).map(e => [e.id, e.massnahme]));

  const liste = [...treffer.values()].map(t => {
    const pos = m.info.elPos.get(t.id);
    const vorPos = m.info.elPos.get(elById.get(t.id)?.parentId);
    const mm = massnahme.get(t.id);
    return { ...t,
      gebIds: [...t.gebIds],
      kwpKorr: [...t.gebIds].reduce((s, id) => s + (nachId.get(id)?.kwpKorr || 0), 0),
      ueberKw: Math.max(0, t.flussKw - t.kapKw),
      // Kabel: Mitte zwischen Anfangs- und Endknoten, Trafo: sein Standort
      pos: pos && vorPos && t.typ === 'kabel' ? { lat: (pos.lat + vorPos.lat) / 2, lng: (pos.lng + vorPos.lng) / 2 } : pos || null,
      abhilfe: mm ? { label: mm.label, investEUR: +mm.investEUR || 0, teil: !!mm.teil } : null };
  });
  // Trafos zuerst, dann nach Überlast bzw. Spannung
  return liste.sort((a, b) => (a.typ === 'trafo' ? 0 : 1) - (b.typ === 'trafo' ? 0 : 1)
    || b.ueberKw - a.ueberKw || b.duMaxPct - a.duMaxPct);
}

/**
 * Netzprüfung wie die Netzaufnahme: radiales Modell im Netzjahr, alle schon
 * geplanten PV-Anlagen/-Dächer als Vorlast, die Kandidaten gierig nach Ertrag
 * — jedes nur ganz. Setzt status 'netz' bzw. 'ohneNetz' an den Zeilen.
 * Gestuft: Vorrang-Zeilen werden immer belegt ('vorrang'); erst wird geprüft,
 * ob sie selbst noch ins Netz passen ('vorrangUeber' wenn nicht), dann gehen
 * sie als Vorlast in die Füllung der übrigen.
 *
 * Netzentwicklung (Nutzerwunsch 07.10.2026):
 *   Netzjahr  — das Modell zählt alles, was im Projekt bis dahin geplant ist
 *               (neue Trafos/Kabel, Maßnahmen wie Trafo-Tausch). Leer = Rechenjahr
 *               der Netzaufnahme; nie vor dem letzten Neubau unter den Kandidaten.
 *   Ausbau    — rechnerische Ertüchtigung wie die Ausbautreppe der Netzaufnahme,
 *               aber bemessen auf GENAU diese Dächer (28 pvnaMassnahmenErmitteln):
 *               keine · bis Budget (kumuliert, Stufe für Stufe nach kWp je €) · alle.
 */
function _netzPruefen(zeilen) {
  const ein = pvnaEinstellungen();
  const { ziel } = pvnaJahre(ein);
  const basisJahr = _ab.netzJahr ?? ziel;
  // Rechenjahr: spätestens, wenn der letzte Neubau unter den Kandidaten steht
  const jahr = Math.max(basisJahr, ...zeilen.map(z => _int(z.g.baujahr) || 0));
  // Netzjahr gesetzt = „Netz wie geplant": auch geplante Maßnahmen (Trafo-Tausch, Kabel) zählen
  const m = pvnaModell({ ...ein, quelle: 'alle', flaechen: 'alle', jahr, inklGeplant: _ab.netzJahr != null });
  const { knotenEl, dachInfo, einspFaktor } = m.info;
  _trafoCache = m.info.knotenTrafo || null;
  _trafoLeiter = m.info.trafoLeiter || new Map();
  const kandIds = new Set(zeilen.map(z => z.g.id));
  const gebById = new Map((window.gebaeude || []).map(g => [g.id, g]));
  // „nur Trafo": alle Kabel unter dem Trafo sind NS — ohne Strom- und Spannungsgrenze
  const nurTrafo = _ab.grenze === 'trafo';
  const elemente = m.eingabe.elemente.map(e => (nurTrafo && e.typ === 'kabel'
    ? { ...e, kapKw: Infinity, duProKwPct: 0 } : { ...e }));
  const elById = new Map(elemente.map(e => [e.id, e]));
  // Ersatzanbindung „nur Trafo": ohne Kabel → nächstgelegener Trafo des Rechenjahres
  const trafos = nurTrafo ? elemente.filter(e => e.typ === 'trafo' && m.info.elPos.get(e.id))
    .map(e => ({ elementId: e.id, label: m.info.elInfo.get(e.id)?.label || e.id, pos: m.info.elPos.get(e.id) })) : [];
  const ersatz = pos => _naechsterTrafo(pos, trafos);
  const zugeordnet = [];

  // Bereits Geplantes hat Vorrang: PV-Assets und Gebäude mit aktiver PV → Vorlast
  let vorlastKwp = 0;
  for (const d of m.eingabe.daecher) {
    const inf = dachInfo.get(d.id);
    if (inf?.gebId != null && kandIds.has(inf.gebId)) continue;
    if (String(d.id).startsWith('G:') && !gebById.get(inf?.gebId)?.pvAktiv) continue;   // nur Dachpotenzial
    // Neu angelegte PV-Assets haben oft kein eigenes Kabel → über ihr Gebäude
    const el = elById.get(d.elementId) || (inf?.gebId != null ? elById.get(_gebKnoten(inf.gebId, knotenEl)) : null)
      || elById.get(ersatz(inf?.pos)?.elementId);
    if (!el) continue;
    el.vorlastKw = (+el.vorlastKw || 0) + d.kwpMax * (d.einspFaktor || einspFaktor);
    vorlastKwp += d.kwpMax;
  }

  const daecher = [], vorrang = [];
  const nachId = new Map();
  for (const z of zeilen) {
    if (z.status !== 'voll') continue;
    let elementId = _gebKnoten(z.g.id, knotenEl);
    let angebunden = elementId != null && elById.has(elementId);
    if (!angebunden && nurTrafo) {
      const t = ersatz(_gebMitte(z.g));
      if (t) {
        elementId = t.elementId; angebunden = true;
        z.ersatzTrafo = `${t.label}, ${_fmt(t.m)} m`;
        zugeordnet.push(t.m);
      }
    }
    if (z.vorrang) {
      z.status = 'vorrang';
      if (!angebunden) { z.grund = 'nicht ans Stromnetz angebunden — Netzgrenze unbekannt'; continue; }
    } else if (!angebunden) { z.status = 'ohneNetz'; z.grund = 'nicht ans Stromnetz angebunden'; continue; }
    (z.vorrang ? vorrang : daecher).push({ id: z.g.id, elementId, kwpMax: z.kwp, ertragFaktor: z.kwpKorr / z.kwp * (z.vsRang ?? 1), einspFaktor });
    nachId.set(z.g.id, z);
  }

  // Vorrang-Gruppe als zusätzliche Vorlast für die Füllung der übrigen
  const mitVorrang = elemente.map(e => ({ ...e }));
  const mvById = new Map(mitVorrang.map(e => [e.id, e]));
  let vorrangKwp = 0;
  for (const d of vorrang) {
    const el = mvById.get(d.elementId);
    el.vorlastKw = (+el.vorlastKw || 0) + d.kwpMax * einspFaktor;
    vorrangKwp += d.kwpMax;
  }

  // ── Ertüchtigung: Maßnahmen für genau diese Belegung, Ausbautreppe, Auswahl nach Budget ──
  let ausbau = null;
  const umgesetzt = new Map();                 // elementId → massnahme
  const hatTrafo = elemente.some(e => e.typ === 'trafo');
  if (_ab.ausbau !== 'keiner' && hatTrafo) {
    const eing = { elemente: mitVorrang, daecher, pruefpunkte: m.eingabe.pruefpunkte,
      duGrenzePct: m.eingabe.duGrenzePct, ganzOderGar: true };
    pvnaMassnahmenErmitteln(eing, m.info, { ohneKabel: nurTrafo });
    // Steht nur die Vorrang-Gruppe auf der Liste, trägt die Treppe nichts bei — ihre
    // Engpässe dann direkt ertüchtigen (sie wird ohnehin belegt).
    const treppe = pvnaTreppe(eing);
    const budget = _ab.ausbau === 'budget' ? Math.max(0, +_ab.budgetT || 0) * 1000 : Infinity;
    const gewaehlt = [];
    for (const st of treppe.schritte) {
      if (st.kumInvestEUR > budget + 0.5) break;
      gewaehlt.push(st);
    }
    for (const st of gewaehlt) for (const mm of st.massnahmen) umgesetzt.set(mm.elementId, mvById.get(mm.elementId)?.massnahme);
    // Engpässe, die schon die Vorrang-Gruppe allein verursacht (gehören zu ihr, nicht zur Treppe)
    if (vorrang.length && _ab.ausbau === 'alle') {
      for (const e of mitVorrang) if (e.massnahme && !umgesetzt.has(e.id) && (+e.vorlastKw || 0) > (+e.kapKw || Infinity)) umgesetzt.set(e.id, e.massnahme);
    }
    const naechste = treppe.schritte[gewaehlt.length] || null;
    // Anzeige in ertragskorrigierten kWp wie die übrige Vorschau (gerechnet wird mit Modulleistung)
    const nenn = daecher.reduce((t, d) => t + d.kwpMax, 0);
    const korr = daecher.reduce((t, d) => t + (nachId.get(d.id)?.kwpKorr || 0), 0);
    const fk = nenn > 0 ? korr / nenn : 1;
    const korrVon = res => res.daecher.reduce((t, d) => t + (d.kwp > 0 ? (nachId.get(d.id)?.kwpKorr || 0) * d.kwp / (d.kwpMax || 1) : 0), 0);
    ausbau = {
      art: _ab.ausbau, budgetEUR: Number.isFinite(budget) ? budget : null,
      massnahmen: [...umgesetzt.entries()].filter(([, mm]) => mm).map(([id, mm]) => ({ elementId: id, label: mm.label, investEUR: +mm.investEUR || 0, teil: !!mm.teil })),
      investEUR: [...umgesetzt.values()].reduce((t, mm) => t + (+mm?.investEUR || 0), 0),
      ohneKwp: korrVon(treppe.basis),
      stufen: gewaehlt.length, stufenGesamt: treppe.schritte.length,
      naechste: naechste ? { zuwachsKwp: naechste.zuwachsKwp * fk, investEUR: naechste.investEUR,
        label: naechste.massnahmen.map(x => x.label).join(' + ') } : null,
      alleInvestEUR: treppe.schritte.at(-1)?.kumInvestEUR || 0,
      alleKwp: korrVon(treppe.ende),
    };
  }
  const anwenden = els => els.map(e => (umgesetzt.get(e.id)
    ? { ...e, kapKw: umgesetzt.get(e.id).kapKw ?? e.kapKw, duProKwPct: umgesetzt.get(e.id).duProKwPct ?? e.duProKwPct } : e));

  const fuellen = (els, ds) => pvnaFuellen({ elemente: els, daecher: ds, pruefpunkte: m.eingabe.pruefpunkte,
    duGrenzePct: m.eingabe.duGrenzePct, ganzOderGar: true });
  if (vorrang.length) {
    // Passt die Vorrang-Gruppe selbst noch ins Netz (ggf. ertüchtigt)? Belegt wird sie so oder so.
    const rv = fuellen(anwenden(elemente.map(e => ({ ...e }))), vorrang);
    for (const d of rv.daecher) {
      const z = nachId.get(d.id);
      if (z && !(d.kwp > 0)) { z.status = 'vorrangUeber'; z.grund = _begrenzerText(d.begrenzer, m.info); }
    }
  }
  let mitKwp = 0;
  if (daecher.length) {
    const r = fuellen(anwenden(mitVorrang), daecher);
    mitKwp = r.daecher.reduce((t, d) => t + (d.kwp > 0 ? (nachId.get(d.id)?.kwpKorr || 0) : 0), 0);
    for (const d of r.daecher) {
      const z = nachId.get(d.id);
      if (z && !(d.kwp > 0)) { z.status = 'netz'; z.grund = _begrenzerText(d.begrenzer, m.info); }
      if (z?.ersatzTrafo && z.status === 'netz') z.grund += ' (ohne Kabel zugeordnet)';
    }
  }
  if (ausbau) ausbau.mitKwp = mitKwp;

  // Engstellen der Pflichtgruppe: gestuft die Vorrang-Gruppe, sonst der ganze Umfang
  let engstellen = null;
  const pg = _pflichtGruppe();
  if (pg && hatTrafo) {
    const gruppe = vorrang.length ? vorrang : daecher;
    const gZeilen = zeilen.filter(z => z.status !== 'leer' && z.status !== 'schatten' && (_ab.menge !== 'gestuft' || z.vorrang));
    engstellen = {
      gruppe: pg,
      liste: gruppe.length ? _engstellen(anwenden(elemente.map(e => ({ ...e }))), gruppe, m, nurTrafo, nachId) : [],
      noetigKwp: gZeilen.reduce((s, z) => s + (z.kwpKorr || 0), 0),
      noetigN: gZeilen.length,
      passtKwp: gZeilen.filter(z => z.status === 'voll' || (z.status === 'vorrang' && !z.grund)).reduce((s, z) => s + (z.kwpKorr || 0), 0),
      ohneNetz: gZeilen.filter(z => z.status === 'ohneNetz' || (z.status === 'vorrang' && z.grund)).length,
    };
  }
  return { jahr, basisJahr, engstellen, netzJahrGesetzt: _ab.netzJahr != null, vorlastKwp, vorrangKwp, einspFaktor,
    duGrenzePct: m.eingabe.duGrenzePct, nurTrafo, ausbau,
    zugeordnet: zugeordnet.length, zugeordnetMaxM: zugeordnet.length ? Math.max(...zugeordnet) : 0,
    unbekannteQs: m.info.unbekannteQs.length, ersatzQs: m.info.ersatzQs,
    ohneTrafo: !hatTrafo };
}

export async function pvabUebernehmen() {
  const v = _ab.vorschau;
  if (!v) return;
  const ziele = v.zeilen.filter(_wirdBelegt).map(z => z.g);
  if (!ziele.length) { alert('Kein Dach zum Belegen.'); return; }
  window.showHint?.(`⏳ ${ziele.length} Dächer werden belegt …`, 0);
  await _naechsterFrame();
  _ab.vorschau = null;
  _trafoCache = null;
  // Flügel-Dachflächen der Vorschau ins Projekt (abgeleitete Dachdaten, wie „Dachflächen aus Grundriss“)
  for (const z of v.zeilen.filter(_wirdBelegt)) {
    if (z.fluegel && !z.g.dachFlaechen?.length) { z.g.dachFlaechen = z.fluegel.dachFlaechen; z.g.dachLod2 = z.fluegel.dachLod2; z.g._pvModSig = null; }
  }
  const vsK = _ab.schatten && typeof window.verschattungKontext === 'function' ? window.verschattungKontext() : null;
  const { anzahl, summe } = pvmStapelBelegen(ziele, vsK ? { nachBelegen: g => window.verschattungNachBelegen(g, vsK) } : {});
  window.d3dNachViz?.();
  window.showHint?.(`✓ ${anzahl} Dächer belegt · Σ ${_fmt(summe)} kWp${vsK ? ' · stark verschattete Flächen ausgelassen' : ''}. Strg+Z nimmt den ganzen Schritt zurück.`, 8000);
}

// ══════════════════════════════════════════════════════════════════════════
// ALS AUSLEGUNG IN DIE PV-ANALYSE (09d pvaBelegungAnlegen)
// ══════════════════════════════════════════════════════════════════════════

function _umfangKurz(stich) {
  if (_ab.umfang === 'trafo') {
    const t = _trafos().find(x => String(x.id) === String(_ab.trafoId));
    return t ? `Netzgebiet ${t.name}` : 'Netzgebiet';
  }
  return { alle: 'alle Dächer', neubau: `Neubauten nach ${stich}`, pflicht: 'PV-Pflicht-Fälle',
    auswahl: 'Auswahl', bereich: 'Kartenbereich' }[_ab.umfang] || _ab.umfang;
}

function _mengeKurz(stich) {
  if (_ab.menge === 'max') return 'Maximal';
  const g = (_ab.grenze === 'trafo' ? ', nur Trafo' : '')
    + (_ab.netzJahr != null ? `, Netz ${_ab.netzJahr}` : '')
    + (_ab.ausbau === 'alle' ? ', ertüchtigt' : _ab.ausbau === 'budget' ? `, ertüchtigt bis ${_fmt(_ab.budgetT)} T€` : '');
  if (_ab.menge === 'netz') return 'Netzverträglich' + g;
  return `Gestuft (${_vorrangLabel(_ab.vorrang, stich)} voll${g})`;
}

/** Vorschlag für den Namen der Auslegung, z. B. „Netzverträglich · alle Dächer". */
function _auslegungName(stich) {
  return `${_mengeKurz(stich)} · ${_umfangKurz(stich)}`;
}

/** Ausführliche Beschreibung (Herleitung in der PV-Analyse). */
function _auslegungBeschreibung(stich, n) {
  const teile = [`${_umfangKurz(stich)} ab ${_ab.minM2} m²`];
  const aus = _ab.ohneNutzung.size;
  if (aus) teile.push(`${aus} Nutzungstyp${aus > 1 ? 'en' : ''} ausgenommen`);
  teile.push(window.pvModusVorgabe?.nordSperr !== false ? 'Nordseiten ausgespart' : 'beide Dachseiten');
  if (_ab.fluegel) teile.push('verwinkelte Grundrisse in Flügel zerlegt');
  if (_ab.schatten) teile.push(`stark verschattete Flächen ausgelassen (Verlust ≥ ${window.verschattungSchwellen?.().nicht ?? 25} %)`);
  if (_ab.menge === 'max') teile.push('jedes Dach voll, Netz nicht geprüft');
  else {
    teile.push((_ab.menge === 'gestuft' ? `${_vorrangLabel(_ab.vorrang, stich)} immer voll, Rest ` : '')
      + `netzverträglich im ${n?.ausbau?.massnahmen?.length ? `ertüchtigten Netz (${n.ausbau.massnahmen.length} Maßnahme${n.ausbau.massnahmen.length > 1 ? 'n' : ''})` : 'Netz'}${n ? ` des Jahres ${n.jahr}` : ''} (${n?.nurTrafo ? 'nur Trafogrenze' : `Trafo + NS-Kabel, ΔU ≤ ${_fmt(n?.duGrenzePct, 1)} %`}), `
      + 'beste Erträge zuerst, jedes Dach ganz oder gar nicht');
  }
  return teile.join('; ');
}

/**
 * Die aktuelle Vorschau als Belegungsstand speichern (38 pvbsAusVorschau) —
 * NUR die Dächer, die „Übernehmen" belegen würde; schon belegte Dächer kommen
 * nicht mit (38: Stände überschneiden sich nicht mit der Projektbelegung).
 * Ausnahme „Alle Dächer · Maximal" (Gesamtpotenzial): enthält auch die schon
 * belegten Dächer, sonst wäre es nicht das ganze Potenzial; wird beim ersten Mal
 * Anlagenpotenzial der PV-Analyse. Ändert nichts am Projekt.
 */
export function pvabAlsStand() {
  const v = _ab.vorschau;
  if (!v || v.sig !== _sig()) return;
  const zeilen = v.zeilen.filter(_wirdBelegt);
  if (!zeilen.length) { alert('Kein Dach zum Belegen.'); return; }
  if (typeof window.pvbsAusVorschau !== 'function') { alert('Belegungsstände sind nicht verfügbar.'); return; }
  const { stich } = pvnaJahre(pvnaEinstellungen());
  const gesamt = _ab.umfang === 'alle' && _ab.menge === 'max';
  const vorschlag = gesamt ? 'Gesamtpotenzial' : _auslegungName(stich);
  // Schon belegte Dächer überspringt die Vorschau — sie gehören nicht in den Stand,
  // außer ins Gesamtpotenzial
  const schonBelegt = _kandidaten().raus.belegt;
  const name = prompt('Name des Belegungsstands:'
    + (!schonBelegt ? '' : gesamt
      ? `\n\nGesamtpotenzial: die ${schonBelegt} schon belegten Dächer werden mit ihrer Belegung aus dem Projekt aufgenommen.`
      : `\n\n${schonBelegt} schon belegte Dächer sind nicht enthalten — nur die ${zeilen.length} Dächer der Vorschau.`), vorschlag);
  if (name == null) return;

  const n = v.netz;
  let netz = null;
  if (n) {
    const ueber = v.zeilen.filter(z => z.status === 'vorrangUeber').length;
    const ohne = _ab.ohneNetzBelegen ? v.zeilen.filter(z => z.status === 'ohneNetz').length : 0;
    const vertraeglich = !ueber && !ohne && !n.ohneTrafo;
    const a = n.ausbau?.massnahmen?.length ? n.ausbau : null;
    netz = { geprueft: true, vertraeglich, nurTrafo: !!n.nurTrafo, jahr: n.jahr,
      // Ertüchtigung: Kosten gehen in der PV-Analyse statt der Netzbau-Pauschalen ein (09d netzausbauEUR)
      ausbau: a ? { investEUR: a.investEUR, massnahmen: a.massnahmen.map(m => ({ label: m.label, investEUR: m.investEUR })) } : null,
      text: vertraeglich
        ? `Passt ins Netz ${n.jahr}${a ? ` mit ${a.massnahmen.length} Ertüchtigung${a.massnahmen.length > 1 ? 'en' : ''} (${_fmt(a.investEUR / 1000)} T€)` : ''}${n.nurTrafo ? ' (nur Trafogrenze geprüft)' : ''} — ohne Netzbau-Pauschalen.`
        : [ueber ? `${ueber} Dächer über der Netzgrenze` : '', ohne ? `${ohne} Dächer ohne Netzanbindung` : '',
           n.ohneTrafo ? 'kein Trafo im Netzjahr' : ''].filter(Boolean).join(', ') + ' — Netzbau-Pauschalen sind enthalten.' };
  }
  const potenzial = gesamt && !window._pvAnalyse?.potenzialStandId;
  const st = window.pvbsAusVorschau(zeilen, { name: name.trim() || vorschlag, beschreibung: _auslegungBeschreibung(stich, n), netz, potenzial, mitProjekt: gesamt });
  const sum = zeilen.reduce((t, z) => t + (z.kwpKorr || 0), 0);
  window.showHint?.(`💾 Belegungsstand „${st.name}" gespeichert (${zeilen.length} Dächer · ${_fmt(sum)} kWp${!schonBelegt ? '' : gesamt ? ` + ${schonBelegt} schon belegte` : `, ohne ${schonBelegt} schon belegte`})`
    + (potenzial ? ' — ist jetzt Grundlage der PV-Analyse.' : '.') + ' Das Projekt ist unverändert — unter „📚 Belegungsstände“ anzeigen (👁) oder zum Bearbeiten öffnen (✎).', 9000);
  _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

/** Wird diese Vorschauzeile beim Übernehmen belegt? */
function _wirdBelegt(z) {
  return z.status === 'voll' || z.status === 'vorrang' || z.status === 'vorrangUeber'
    || (z.status === 'ohneNetz' && _ab.ohneNetzBelegen);
}

export function pvabVerwerfen() {
  _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

// ══════════════════════════════════════════════════════════════════════════
// BEREICH AUF DER KARTE
// ══════════════════════════════════════════════════════════════════════════

function _bereichZeigen() {
  const soll = _ab.modus && _ab.umfang === 'bereich' && _ab.bereich && window.pvModusAktiv;
  if (!soll) { if (_bereichLayer) { map.removeLayer(_bereichLayer); _bereichLayer = null; } return; }
  if (!_bereichLayer) {
    _bereichLayer = L.rectangle(_ab.bereich, { color: CYAN, weight: 2, dashArray: '6 4', fillOpacity: 0.05, interactive: false }).addTo(map);
  } else _bereichLayer.setBounds(_ab.bereich);
}

/**
 * Rechteck mit gedrückter Maustaste aufziehen. Läuft über Capture-Listener am
 * Kartencontainer: Gebäudepolygone schlucken ihre Mausereignisse
 * (bubblingMouseEvents:false), und ein Klick auf ein Dach würde im PV-Modus
 * sonst eine neue Fläche beginnen.
 */
export function pvabBereichZiehen() {
  if (window.pvabZiehtBereich) return;
  const cont = map.getContainer();
  window.pvabZiehtBereich = true;
  window.showHint?.('Bereich aufziehen: Maustaste gedrückt halten und ziehen · Esc bricht ab', 6000);
  const cursorVorher = cont.style.cursor;
  cont.style.cursor = 'crosshair';
  map.dragging.disable();
  let start = null, rahmen = null;
  const ll = ev => map.mouseEventToLatLng(ev);
  const schlucken = ev => { ev.stopPropagation(); ev.preventDefault(); };
  const down = ev => {
    if (ev.button !== 0) return;
    schlucken(ev);
    start = ll(ev);
    rahmen = L.rectangle(L.latLngBounds(start, start), { color: CYAN, weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(map);
  };
  const move = ev => { if (!start) return; schlucken(ev); rahmen.setBounds(L.latLngBounds(start, ll(ev))); };
  const up = ev => { if (!start) return; schlucken(ev); ende(L.latLngBounds(start, ll(ev))); };
  const taste = ev => { if (ev.key === 'Escape') { schlucken(ev); ende(null); } };
  function ende(bounds) {
    cont.removeEventListener('mousedown', down, true);
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', up, true);
    document.removeEventListener('keydown', taste, true);
    // Der Klick, den der Browser nach mouseup erzeugt, darf kein Dach treffen
    setTimeout(() => cont.removeEventListener('click', schlucken, true), 0);
    cont.style.cursor = cursorVorher;
    map.dragging.enable();
    if (rahmen) map.removeLayer(rahmen);
    window.pvabZiehtBereich = false;
    const sw = bounds?.getSouthWest(), ne = bounds?.getNorthEast();
    if (bounds && sw && ne && map.distance(sw, ne) > 2) {
      _ab.bereich = bounds;
      _ab.vorschau = null;
      window.hideHint?.();
    }
    _bereichZeigen();
    pvModusRender();
    pvModusMarkiereKarte();
  }
  cont.addEventListener('mousedown', down, true);
  document.addEventListener('mousemove', move, true);
  document.addEventListener('mouseup', up, true);
  cont.addEventListener('click', schlucken, true);
  document.addEventListener('keydown', taste, true);
}

// ══════════════════════════════════════════════════════════════════════════
// BELEGUNGEN ENTFERNEN
// ══════════════════════════════════════════════════════════════════════════

/** Dächer im Umfang, die überhaupt Flächen haben (Belegung oder Sperrfläche). */
function _entfernKandidaten() {
  const { stich } = pvnaJahre(pvnaEinstellungen());
  const ok = _umfangFilter(_ab.umfang, stich);
  const liste = (window.gebaeude || []).filter(g => g.pvFlaechen?.length && ok(g));
  return { liste, stich };
}

/**
 * Alle PV-Flächen (Belegung + Sperrflächen) der Gebäude entfernen und neu
 * zeichnen. Die PV-Assets fasst diese Funktion nicht an — das macht der
 * Aufrufer (Sammel-Entfernen hier, Einzel-Löschen in 13a deleteAsset).
 * @param {any[]} gIds
 * @returns {number} Zahl der geräumten Dächer
 */
export function pvBelegungEntfernen(gIds) {
  const ids = new Set(gIds);
  const geaendert = [], vorher = new Map();
  for (const g of (window.gebaeude || [])) {
    if (!ids.has(g.id) || !g.pvFlaechen?.length) continue;
    vorher.set(g.id, { pvFlaechen: g.pvFlaechen });
    g.pvFlaechen = [];
    g.pvAktiv = false;
    geaendert.push(g);
  }
  if (!geaendert.length) return 0;
  // Gleicher Weg wie beim Variantenwechsel: alte Layer weg, Module neu
  window.variantenPvNeuZeichnen?.(geaendert, vorher);
  for (const g of geaendert) window._rerenderCard?.(g.id);
  if (window.pvModusAktiv) pvModusMarkiereKarte();
  return geaendert.length;
}

export function pvabEntfernen() {
  const { liste } = _entfernKandidaten();
  if (!liste.length) return;
  const ids = new Set(liste.map(g => g.id));
  const pv = ASSETS.items.filter(a => a.type === 'PV' && ids.has(a.buildingId));
  const geteilt = pv.filter(a => normSchicht(a.schicht) !== SCHICHT.ENTSCHEIDUNG).length;
  const kwp = liste.reduce((s, g) => s + (calcGebKwpKorr(g) || 0), 0);
  if (!confirm(`Auf ${liste.length} Dächern alle Belegungs- und Sperrflächen entfernen (Σ ${_fmt(kwp)} kWp)?\n\n`
    + (pv.length ? `${pv.length} PV-Asset(s) werden mit gelöscht.` : 'Es hängen keine PV-Assets daran.')
    + (geteilt ? `\n${geteilt} davon gehören zu Bestand/Entwicklung — sie verschwinden in allen Varianten.` : '')
    + `\n\nStrg+Z im PV-Modus nimmt den ganzen Schritt zurück.`)) return;
  const lauf = () => {
    for (const a of pv) deleteAsset(a.id, true);
    pvBelegungEntfernen([...ids]);
  };
  try {
    if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction('PV-Belegung entfernen', lauf);
    else lauf();
  } catch (err) {
    console.error(err);
    alert('Entfernen fehlgeschlagen: ' + err.message);
    return;
  }
  pvmPlanungsSchrittMerken();
  _trafoCache = null;
  window.recalcStromNetz?.();
  window.redrawAllAssets?.();
  window.calcStromPanel?.();
  window.renderList?.();
  window.showHint?.(`🗑 ${liste.length} Dächer geräumt · ${_fmt(kwp)} kWp. Strg+Z nimmt den Schritt zurück.`, 7000);
  pvModusRender();
  pvModusMarkiereKarte();
}

// ══════════════════════════════════════════════════════════════════════════
// KARTE
// ══════════════════════════════════════════════════════════════════════════

function _stilNeutral(g) {
  if (_hasBelegung(g)) g.polygonLayer.setStyle({ color: '#ffb300', weight: 1.5, dashArray: '', fillColor: GELB, fillOpacity: 0.08 });
  else g.polygonLayer.setStyle({ color: 'rgba(255,255,255,.35)', weight: 1, dashArray: '3 4', fillColor: '#ffffff', fillOpacity: 0.02 });
}

/**
 * Färbt die Dächer, solange ein Block offen ist. Belegen: Kandidaten cyan, in
 * der Vorschau grün (wird belegt) / hellgrün (Vorrang) / orange (Vorrang über
 * der Netzgrenze) / rot (Netz zu knapp) / grau (ohne Netz, kein Modul).
 * Entfernen: betroffene Dächer rot. Übrige Dächer wie im PV-Modus.
 * @returns {boolean} true = Karte ist gefärbt (PV-Modus färbt dann nicht selbst)
 */
export function pvabMarkiereKarte() {
  _bereichZeigen();
  if (!_ab.modus || !window.pvModusAktiv) return false;
  if (_ab.modus === 'entfernen') {
    const weg = new Set(_entfernKandidaten().liste.map(g => g.id));
    for (const g of (window.gebaeude || [])) {
      if (!g.polygonLayer) continue;
      if (weg.has(g.id)) g.polygonLayer.setStyle({ color: ROT, weight: 2, dashArray: '', fillColor: ROT, fillOpacity: 0.3 });
      else _stilNeutral(g);
    }
    return true;
  }
  const status = new Map();
  if (_ab.vorschau) for (const z of _ab.vorschau.zeilen) status.set(z.g.id, z.status);
  else for (const g of _kandidaten().liste) status.set(g.id, 'kandidat');
  const farbe = { kandidat: CYAN, voll: GRUEN, vorrang: HELLGRUEN, vorrangUeber: ORANGE, netz: ROT,
    ohneNetz: _ab.ohneNetzBelegen ? GRUEN : GRAU, leer: GRAU, schatten: BRAUN };
  for (const g of (window.gebaeude || [])) {
    if (!g.polygonLayer) continue;
    const st = status.get(g.id);
    if (!st) { _stilNeutral(g); continue; }
    const f = farbe[st];
    g.polygonLayer.setStyle({ color: f, weight: 2, dashArray: st === 'ohneNetz' || st === 'leer' || st === 'schatten' ? '4 4' : '',
      fillColor: f, fillOpacity: st === 'kandidat' ? 0.12 : 0.28 });
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL-BLOCK (in 25 _html über window.pvabBlockHtml)
// ══════════════════════════════════════════════════════════════════════════

const _opt = (w, l, an) => `<option value="${w}"${an ? ' selected' : ''}>${escHtml(l)}</option>`;

function _kopfHtml(farbe, titel, modus) {
  return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
      <span style="flex:1;color:${farbe};font-weight:600;font-size:11px;">${titel}</span>
      <button class="btn-xs" data-click="pvabToggle('${modus}')" title="Schließen">✕</button>
    </div>`;
}

/** Umfang-Auswahl samt Bereich-/Trafo-Zusatz — gemeinsam für Belegen und Entfernen. */
function _umfangHtml(stich, alleLabel) {
  const label = w => w === 'alle' ? alleLabel : w === 'neubau' ? `Nur Neubauten (nach ${stich})` : UMFAENGE.find(u => u[0] === w)[1];
  let zusatz = '';
  if (_ab.umfang === 'bereich') {
    zusatz = `<div style="display:flex;gap:4px;margin-top:4px;">
        <button class="btn-xs" style="flex:1;${_ab.bereich ? '' : `border-color:${CYAN};color:${CYAN};`}" data-click="pvabBereichZiehen()"
          title="Mit gedrückter Maustaste ein Rechteck auf der Karte aufziehen">▭ ${_ab.bereich ? 'Neu aufziehen' : 'Bereich aufziehen'}</button>
        ${_ab.bereich ? `<button class="btn-xs" data-click="pvabSet('bereich','')" title="Bereich entfernen">✕</button>` : ''}
      </div>`;
  } else if (_ab.umfang === 'trafo') {
    const tr = _trafos();
    zusatz = tr.length
      ? `<select class="inp-field" style="margin-top:4px;" data-change="pvabSet('trafoId',this.value)">
          ${_opt('', '— Trafo wählen —', _ab.trafoId == null)}
          ${tr.map(t => _opt(String(t.id), `${t.name}${t.kva ? ` (${t.kva} kVA)` : ''}`, String(_ab.trafoId) === String(t.id))).join('')}
        </select>`
      : `<div style="font-size:9px;color:var(--muted);margin-top:3px;">Im Projekt gibt es noch keinen Trafo.</div>`;
  }
  return `<div class="inp-group">
      <div class="inp-label">① Welche Dächer?</div>
      <select class="inp-field" data-change="pvabSet('umfang',this.value)">
        ${UMFAENGE.map(([w]) => _opt(w, label(w), _ab.umfang === w)).join('')}
      </select>
      ${zusatz}
    </div>`;
}

export function pvabBlockHtml() {
  if (!_ab.modus) {
    return `<div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn-xs" style="flex:1;border-color:${CYAN};color:${CYAN};"
          data-click="pvabToggle('belegen')" title="Viele Dächer auf einmal belegen — alle, Neubauten, PV-Pflicht, ein Bereich oder ein Trafo-Netzgebiet, wahlweise netzverträglich oder gestuft">
          ⚡ Dächer automatisch belegen …</button>
        <button class="btn-xs" style="border-color:${ROT}99;color:${ROT};"
          data-click="pvabToggle('entfernen')" title="Belegungen vieler Dächer auf einmal entfernen — samt Sperrflächen und PV-Assets">
          🗑 Entfernen …</button>
      </div>`;
  }
  return _ab.modus === 'entfernen' ? _entfernHtml() : _belegenHtml();
}

function _entfernHtml() {
  const { liste, stich } = _entfernKandidaten();
  const ids = new Set(liste.map(g => g.id));
  const nPv = ASSETS.items.filter(a => a.type === 'PV' && ids.has(a.buildingId)).length;
  const kwp = liste.reduce((s, g) => s + (calcGebKwpKorr(g) || 0), 0);
  return `
    <div style="margin-top:6px;border:1px solid ${ROT}66;border-radius:5px;padding:6px 7px;background:${ROT}0d;">
      ${_kopfHtml(ROT, '🗑 Belegungen entfernen', 'entfernen')}
      ${_umfangHtml(stich, 'Alle belegten Dächer')}
      <div style="font-size:10px;margin-top:6px;padding-top:5px;border-top:1px solid var(--border);">
        <b style="color:${ROT};">${liste.length}</b> Dächer mit Flächen${liste.length ? ` · <span style="font-family:'DM Mono',monospace;">${_fmt(kwp)} kWp</span>` : ''}
        <div style="font-size:9px;color:var(--muted);line-height:1.4;">Belegungs- und Sperrflächen samt ${nPv} PV-Asset(s). Strg+Z nimmt den Schritt zurück.</div>
      </div>
      <button class="btn-xs" style="width:100%;margin-top:5px;border-color:${ROT};color:${ROT};" ${liste.length ? '' : 'disabled'}
        data-click="pvabEntfernen()" title="Fragt vorher noch einmal nach">🗑 ${liste.length} Belegungen entfernen</button>
    </div>`;
}

function _belegenHtml() {
  const { liste, vorNutzung, raus, stich } = _kandidaten();

  // Nutzungstypen, die unter den Kandidaten vorkommen
  const typen = new Map();
  for (const g of vorNutzung) { const k = g.nutzungstyp || ''; typen.set(k, (typen.get(k) || 0) + 1); }
  const nAus = [..._ab.ohneNutzung].filter(k => typen.has(k)).length;
  const typZeilen = [...typen.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `
      <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;padding:1px 0;">
        <input type="checkbox" ${_ab.ohneNutzung.has(k) ? '' : 'checked'} style="accent-color:${CYAN};cursor:pointer;"
          data-change="pvabNutzung('${escHtml(k)}',this.checked)"/>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(_nutzungsLabel(k))}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--muted);">${n}</span>
      </label>`).join('');

  const ausgelassen = [raus.belegt && `${raus.belegt} schon belegt`, raus.klein && `${raus.klein} < ${_ab.minM2} m²`,
    raus.nutzung && `${raus.nutzung} Nutzung`, raus.weg && `${raus.weg} ausgeschl./abgerissen`].filter(Boolean).join(' · ');

  const radio = (w, l, titel) => `<label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;" title="${titel}">
      <input type="radio" name="pvab-menge" ${_ab.menge === w ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
        data-change="pvabSet('menge','${w}')"/>${l}</label>`;

  return `
    <div style="margin-top:6px;border:1px solid ${CYAN}66;border-radius:5px;padding:6px 7px;background:${CYAN}0d;">
      ${_kopfHtml(CYAN, '⚡ Dächer automatisch belegen', 'belegen')}
      ${_umfangHtml(stich, 'Alle Dächer')}
      <div style="display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px;">
        <span style="flex:1;color:var(--muted);" title="Kleinere Gebäude (Garagen, Schuppen) bleiben frei">Mindestgröße</span>
        <input class="inp-field" type="number" min="0" step="10" value="${_ab.minM2}" style="width:58px;padding:2px 4px;"
          data-change="pvabSet('minM2',this.value)"/>
        <span style="color:var(--muted);">m²</span>
      </div>
      ${typen.size ? `
      <div style="font-size:9px;color:var(--muted);margin-top:5px;cursor:pointer;display:flex;gap:4px;" data-click="pvabSet('nutzungOffen','')">
        <span style="flex:1;text-transform:uppercase;letter-spacing:.06em;">Nutzungstypen${nAus ? ` (${nAus} ausgenommen)` : ''}</span>
        <span>${_ab.nutzungOffen ? '▾' : '▸'}</span>
      </div>
      ${_ab.nutzungOffen ? `<div style="max-height:110px;overflow-y:auto;margin-top:2px;">${typZeilen}</div>` : ''}` : ''}
      <div class="inp-group" style="margin-top:6px;">
        <div class="inp-label">② Belegung</div>
        <div style="font-size:9px;color:var(--muted);line-height:1.4;">Grundriss als Fläche mit diesen Annahmen — bei LoD2- oder Flügel-Dachflächen je Dachfläche mit echter Neigung und Ausrichtung. Sie gelten auch für einzeln belegte Dächer („Vorgaben für neue Dächer"). Echte Dachangaben (OSM, LoD2, von Hand) haben Vorrang vor Dachform und Neigung.</div>
        <div style="margin-top:4px;padding:4px 6px;background:var(--bg);border-radius:4px;border:1px solid var(--border);">
          ${window.pvmVorgabeFelderHtml?.() || ''}
        </div>
        <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;margin-top:2px;"
          title="Gebäude mit L-, T-, U- oder Kammform ohne Dachflächen: jeder Flügel bekommt ein eigenes Dach (Dachform und Neigung der Vorgaben) und wird je Dachfläche belegt — statt eines Satteldachs über den ganzen Grundriss. Die berechneten Dachflächen gehen beim Übernehmen ins Projekt.">
          <input type="checkbox" ${_ab.fluegel ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
            data-change="pvabSet('fluegel',this.checked)"/>Verwinkelte Grundrisse in Flügel zerlegen
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;margin-top:2px;"
          title="Je Dach die Verschattung durch Bäume und Nachbargebäude rechnen (PV-Modus › Bäume &amp; Verschattung): Dachflächen bzw. Satteldachseiten mit einem Verlust ab der Schwelle „nicht belegen“ bleiben frei, ganz verschattete Dächer entfallen. Netzverträglich reiht die Erträge nach Verschattung.">
          <input type="checkbox" ${_ab.schatten ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
            data-change="pvabSet('schatten',this.checked)"/>Stark verschattete Flächen auslassen
          <span style="color:var(--muted);">(≥ ${window.verschattungSchwellen?.().nicht ?? 25} %)</span>
        </label>
      </div>
      <div class="inp-group" style="margin-top:6px;">
        <div class="inp-label">③ Wie viel?</div>
        <div style="display:flex;flex-direction:column;gap:2px;">
          ${radio('max', 'Maximal — jedes Dach voll', 'Netzgrenzen werden nicht geprüft')}
          ${radio('netz', 'Netzverträglich', 'Wie die PV-Netzaufnahme: so viel, wie das Netz aufnimmt — im gewählten Netzjahr und mit der gewählten Ertüchtigung (Standard: Bestandsnetz ohne Ertüchtigung). Beste Erträge zuerst, jedes Dach ganz oder gar nicht; bereits geplante PV hat Vorrang.')}
          ${radio('gestuft', 'Gestuft — Gruppe voll, Rest netzverträglich', 'Erst eine Gruppe aus ① immer voll belegen (z. B. alle Neubauten oder die PV-Pflicht-Fälle), danach die übrigen Dächer nur, soweit das Netz es noch verträgt.')}
        </div>
        ${_ab.menge === 'gestuft' ? `
        <div style="display:flex;align-items:center;gap:5px;margin-top:4px;font-size:10px;">
          <span style="color:var(--muted);white-space:nowrap;">Immer voll:</span>
          <select class="inp-field" style="flex:1;" data-change="pvabSet('vorrang',this.value)">
            ${VORRANG.map(([w]) => _opt(w, _vorrangLabel(w, stich), _ab.vorrang === w)).join('')}
          </select>
        </div>
        <div style="font-size:9px;color:var(--muted);line-height:1.4;margin-top:2px;">Der Rest aus ① nur, soweit das Netz danach noch reicht.</div>` : ''}
        ${_ab.menge !== 'max' ? `
        <div style="display:flex;align-items:center;gap:5px;margin-top:4px;font-size:10px;">
          <span style="color:var(--muted);white-space:nowrap;">Grenze:</span>
          <select class="inp-field" style="flex:1;" data-change="pvabSet('grenze',this.value)"
            title="„Nur Trafo“: Niederspannungskabel begrenzen weder Strom noch Spannung — für unbekannte Querschnitte oder Kabel, die im Projekt ohnehin vergrößert werden können.">
            ${_opt('kabel', 'Trafo + NS-Kabel', _ab.grenze !== 'trafo')}
            ${_opt('trafo', 'Nur Trafo (NS-Kabel ausgeblendet)', _ab.grenze === 'trafo')}
          </select>
        </div>
        ${_netzentwicklungHtml()}
        <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;margin-top:3px;"
          title="Gebäude ohne Verbindung zum erfassten Stromnetz — ihre Netzgrenze ist unbekannt">
          <input type="checkbox" ${_ab.ohneNetzBelegen ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
            data-change="pvabSet('ohneNetzBelegen',this.checked)"/>Dächer ohne Netzanbindung trotzdem belegen
        </label>` : ''}
      </div>
      <div style="font-size:10px;margin-top:6px;padding-top:5px;border-top:1px solid var(--border);">
        <b style="color:${CYAN};">${liste.length}</b> Dächer kommen in Frage${ausgelassen ? `<div style="font-size:9px;color:var(--muted);">ausgelassen: ${ausgelassen}</div>` : ''}
      </div>
      ${_vorschauHtml(liste.length, stich)}
    </div>`;
}

/** ③ Netzstand (Jahr) und Ertüchtigung — nur bei netzverträglich/gestuft. */
function _netzentwicklungHtml() {
  const { ziel } = pvnaJahre(pvnaEinstellungen());
  const zeile = 'display:flex;align-items:center;gap:5px;margin-top:4px;font-size:10px;';
  return `
        <div style="${zeile}" title="Geplante Netzänderungen bis zu diesem Jahr zählen mit: neue Trafos und Kabel (Baujahr) sowie Maßnahmen wie Trafo-Tausch oder Kabelverstärkung — auch solche mit Status „geplant“. Leer = Rechenjahr der PV-Netzaufnahme (${ziel}). Nie vor dem Baujahr des letzten Neubaus unter den Dächern.">
          <span style="color:var(--muted);white-space:nowrap;">Netzstand im Jahr:</span>
          <input class="inp-field" type="number" min="1990" max="2100" step="1" value="${_ab.netzJahr ?? ''}" placeholder="${ziel}"
            style="width:64px;padding:2px 4px;" data-change="pvabSet('netzJahr',this.value)"/>
          <span style="color:var(--muted);font-size:9px;">${_ab.netzJahr == null ? 'wie Netzaufnahme' : 'mit geplanten Änderungen'}</span>
        </div>
        <div style="${zeile}" title="Rechnerische Ertüchtigung wie die Ausbautreppe der Netzaufnahme, aber bemessen auf genau diese Dächer: größerer Trafo, Kabel verstärken/parallel. Stufe für Stufe nach dem größten kWp-Zuwachs je Euro.">
          <span style="color:var(--muted);white-space:nowrap;">Ertüchtigung:</span>
          <select class="inp-field" style="flex:1;" data-change="pvabSet('ausbau',this.value)">
            ${_opt('keiner', 'keine — Netz wie geplant', _ab.ausbau === 'keiner')}
            ${_opt('budget', 'bis zu einem Budget', _ab.ausbau === 'budget')}
            ${_opt('alle', 'alle nötigen', _ab.ausbau === 'alle')}
          </select>
          ${_ab.ausbau === 'budget' ? `<input class="inp-field" type="number" min="0" step="10" value="${_ab.budgetT}"
            style="width:56px;padding:2px 4px;" data-change="pvabSet('budgetT',this.value)"/><span style="color:var(--muted);">T€</span>` : ''}
        </div>`;
}

/** Vorschau: was die Ertüchtigung bringt — Maßnahmen, Kosten, Zuwachs, nächste Stufe. */
function _ausbauHtml(a) {
  if (!a) return '';
  const T = x => _fmt((x || 0) / 1000);
  if (!a.stufenGesamt) {
    return `<div style="margin-top:4px;padding:3px 5px;border-left:2px solid ${GRUEN};font-size:9px;line-height:1.4;">
      Ertüchtigung: keine nötig bzw. keine bringt mehr kWp — das Netz begrenzt hier nicht oder nur durch Kabel ohne Ausbauvorschlag.</div>`;
  }
  const liste = a.massnahmen.slice(0, 5).map(m => `<div style="display:flex;gap:4px;"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(m.label)}">⚒ ${escHtml(m.label)}</span><span style="font-family:'DM Mono',monospace;">${T(m.investEUR)} T€</span></div>`).join('');
  return `<div style="margin-top:4px;padding:3px 5px;border-left:2px solid ${GRUEN};font-size:9px;line-height:1.45;">
      <div style="color:var(--text);"><b>Ertüchtigung:</b> ${a.massnahmen.length ? `${a.massnahmen.length} Maßnahme${a.massnahmen.length > 1 ? 'n' : ''} · ${T(a.investEUR)} T€ → ${_fmt(a.mitKwp)} kWp statt ${_fmt(a.ohneKwp)} kWp ohne` : `keine umgesetzt (${a.art === 'budget' ? 'Budget reicht für keine Stufe' : '—'}) · ${_fmt(a.ohneKwp)} kWp`}</div>
      ${liste}${a.massnahmen.length > 5 ? `<div>… und ${a.massnahmen.length - 5} weitere</div>` : ''}
      ${a.naechste ? `<div style="color:var(--muted);margin-top:2px;">Nächste Stufe: +${_fmt(a.naechste.zuwachsKwp)} kWp für ${T(a.naechste.investEUR)} T€ (${escHtml(a.naechste.label)}) · alle ${a.stufenGesamt} Stufen: ${_fmt(a.alleKwp)} kWp für ${T(a.alleInvestEUR)} T€</div>` : ''}
      ${a.massnahmen.some(m => m.teil) ? '<div style="color:#ffb74d;">⚠ Teil-Ertüchtigung: größte Standardlösung löst den Engpass nicht ganz.</div>' : ''}
    </div>`;
}

/** Vorschau: Engstellen, an denen die Pflichtgruppe (Neubau/PV-Pflicht/Auswahl) scheitert. */
function _engstellenHtml(n, stich) {
  const es = n?.engstellen;
  if (!es || !es.noetigN) return '';
  const T = x => _fmt((x || 0) / 1000);
  const name = escHtml(_vorrangLabel(es.gruppe, stich));
  const fehlt = Math.max(0, es.noetigKwp - es.passtKwp);
  const kopf = `<div style="color:var(--text);"><b>🚧 Engstellen für ${name}</b></div>
      <div style="color:var(--muted);">${es.noetigN} Dächer · ${_fmt(es.noetigKwp)} kWp nötig — ${_fmt(es.passtKwp)} kWp passen ins Netz${fehlt > 0.5 ? `, <span style="color:${ROT};">${_fmt(fehlt)} kWp nicht</span>` : ''}${n.ausbau?.massnahmen?.length ? ' (nach der gewählten Ertüchtigung)' : ''}</div>`;
  const ohne = es.ohneNetz ? `<div style="color:var(--muted);">${es.ohneNetz} ${es.ohneNetz === 1 ? 'Dach' : 'Dächer'} ohne Netzanbindung — dort ist die Grenze unbekannt.</div>` : '';
  if (!es.liste.length) {
    return `<div style="margin-top:5px;padding:3px 5px;border-left:2px solid ${GRUEN};font-size:9px;line-height:1.45;">
        ${kopf}<div style="color:${GRUEN};">✓ Keine Engstelle — die ganze Gruppe passt ${n.nurTrafo ? 'unter die Trafogrenze' : 'ins Netz'}.</div>${ohne}</div>`;
  }
  const zeilen = es.liste.map((e, i) => {
    const wert = e.ueberKw > 0.5 ? `+${_fmt(e.ueberKw)} kW` : `ΔU ${_fmt(e.duMaxPct, 1)} %`;
    const was = [
      e.ueberKw > 0.5 ? `Kap. ${_fmt(e.kapKw)} kW · nötig ${_fmt(e.flussKw)} kW${e.vorlastKw > 0.5 ? ` (davon ${_fmt(e.vorlastKw)} kW schon geplante PV)` : ''}` : '',
      e.duMaxPct > 0 ? `Spannungsanhebung bis ${_fmt(e.duMaxPct, 1)} % > ${_fmt(n.duGrenzePct, 1)} %` : '',
      `${e.gebIds.length} ${e.gebIds.length === 1 ? 'Dach' : 'Dächer'} dahinter · ${_fmt(e.kwpKorr)} kWp`,
    ].filter(Boolean).join(' · ');
    const abhilfe = e.abhilfe
      ? `<span style="color:${GRUEN};">⚒ ${escHtml(e.abhilfe.label)} · ${T(e.abhilfe.investEUR)} T€${e.abhilfe.teil ? ' (reicht nicht ganz)' : ''}</span>`
      : `<span style="color:#ffb74d;">${e.unbekannt ? 'Querschnitt unbekannt bzw. Ersatzwert — erst Kabeldaten prüfen' : 'keine Standardlösung — Netzplanung nötig'}</span>`;
    return `<div style="padding:2px 0;border-top:1px solid var(--border);cursor:pointer;" data-click="pvabEngstelleZeigen(${i})" title="Auf der Karte zeigen">
        <div style="display:flex;gap:4px;color:var(--text);">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(e.label)}">${e.typ === 'trafo' ? '🔌' : '〰'} ${escHtml(e.label)}</span>
          <span style="font-family:'DM Mono',monospace;color:${ROT};">${wert}</span>
        </div>
        <div style="color:var(--muted);">${was}</div>
        <div>${abhilfe}</div>
      </div>`;
  }).join('');
  const mitAbhilfe = es.liste.filter(e => e.abhilfe);
  const summe = mitAbhilfe.length
    ? `<div style="color:var(--muted);margin-top:2px;">Abhilfe zusammen ≈ ${T(mitAbhilfe.reduce((s, e) => s + e.abhilfe.investEUR, 0))} T€ (${mitAbhilfe.length} von ${es.liste.length} Engstellen)${mitAbhilfe.length < es.liste.length ? ' — der Rest braucht eine eigene Netzplanung' : ''}.</div>` : '';
  return `<div style="margin-top:5px;padding:3px 5px;border-left:2px solid ${ROT};font-size:9px;line-height:1.45;">
      ${kopf}${ohne}
      <div style="max-height:180px;overflow-y:auto;margin-top:3px;">${zeilen}</div>
      ${summe}
    </div>`;
}

let _engstelleMarker = null;
/** Engstelle aus der Vorschau auf der Karte zeigen (Trafo-Standort bzw. Kabelmitte). */
export function pvabEngstelleZeigen(i) {
  const e = _ab.vorschau?.netz?.engstellen?.liste?.[i];
  if (!e) return;
  if (!e.pos) { window.showHint?.(`Keine Lage bekannt: ${e.label}`, 4000); return; }
  map.flyTo([e.pos.lat, e.pos.lng], Math.max(map.getZoom(), 18));
  if (_engstelleMarker) map.removeLayer(_engstelleMarker);
  _engstelleMarker = L.circleMarker([e.pos.lat, e.pos.lng], { radius: 16, color: ROT, weight: 3, fillColor: ROT, fillOpacity: 0.15, interactive: false }).addTo(map);
  const mk = _engstelleMarker;
  setTimeout(() => { if (_engstelleMarker === mk) { map.removeLayer(mk); _engstelleMarker = null; } }, 5000);
  window.showHint?.(`🚧 ${e.label}${e.ueberKw > 0.5 ? ` — ${_fmt(e.ueberKw)} kW über der Kapazität` : ''}`, 5000);
}

function _vorschauHtml(nKand, stich) {
  const v = _ab.vorschau;
  if (!v) {
    return `<button class="btn-xs" style="width:100%;margin-top:5px;border-color:${CYAN};color:${CYAN};"
        ${nKand ? '' : 'disabled'} data-click="pvabVorschau()"
        title="Probebelegung rechnen und auf der Karte zeigen — ändert noch nichts">🔍 Vorschau berechnen</button>`;
  }
  const veraltet = v.sig !== _sig();
  const gruppe = (...st) => v.zeilen.filter(z => st.includes(z.status));
  const sum = zs => zs.reduce((s, z) => s + z.kwpKorr, 0);
  const vorrang = gruppe('vorrang', 'vorrangUeber'), ueber = gruppe('vorrangUeber');
  const voll = gruppe('voll'), netz = gruppe('netz'), ohne = gruppe('ohneNetz'), leer = gruppe('leer'), schatten = gruppe('schatten');
  const teilweise = v.zeilen.filter(z => _wirdBelegt(z) && z.vs?.ausgelassen?.length);
  const fluegelN = v.zeilen.filter(z => _wirdBelegt(z) && z.fluegel).length;
  const belegen = v.zeilen.filter(_wirdBelegt);
  const gestuft = vorrang.length > 0;
  const zusatz = voll.concat(_ab.ohneNetzBelegen ? ohne : []);
  const zeile = (farbe, n, text, kwp, einzug) => n ? `<div style="display:flex;align-items:center;gap:5px;font-size:10px;${einzug ? 'padding-left:12px;' : ''}">
      <span style="width:9px;height:9px;border-radius:2px;background:${farbe};flex:none;"></span>
      <span style="flex:1;">${n} ${text}</span>
      ${kwp != null ? `<span style="font-family:'DM Mono',monospace;">${_fmt(kwp)} kWp</span>` : ''}</div>` : '';
  const mitGrund = v.zeilen.filter(z => z.status === 'vorrangUeber' || z.status === 'netz' || z.status === 'schatten'
    || (z.status === 'vorrang' && z.grund) || (z.status === 'ohneNetz' && !_ab.ohneNetzBelegen));
  const gruende = mitGrund.slice(0, 10).map(z => `
      <div style="font-size:9px;color:var(--muted);display:flex;gap:4px;cursor:pointer;" data-click="pvmWaehle(${z.g.id})" title="${escHtml(z.grund)}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(_name(z.g))}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;">${escHtml(z.grund)}</span>
      </div>`).join('');
  const vorrangName = escHtml(_vorrangLabel(_ab.vorrang, stich));
  const n = v.netz;
  const netzInfo = n ? `<div style="font-size:9px;color:var(--muted);line-height:1.4;margin-top:4px;">
      Netzstand ${n.jahr}${n.netzJahrGesetzt || n.jahr !== n.basisJahr ? '' : ' (Rechenjahr der Netzaufnahme)'} · ${n.ausbau ? 'mit Ertüchtigung' : 'ohne Ertüchtigung'} · ${_fmt(n.einspFaktor, 1)} kW/kWp · ${n.nurTrafo ? 'nur Trafogrenze — NS-Kabel und ΔU ungeprüft' : `ΔU ≤ ${_fmt(n.duGrenzePct, 1)} %`}${n.vorlastKwp > 0 ? ` · ${_fmt(n.vorlastKwp)} kWp schon geplant (Vorrang)` : ''}
      ${n.ohneTrafo ? `<br><span style="color:${ROT};">Kein Trafo im Netzjahr — es gibt kein Netz zum Anschließen.</span>` : ''}
      ${ueber.length ? `<br><span style="color:${ORANGE};">${ueber.length} Dächer der Gruppe „${vorrangName}“ passen nicht mehr ${n.nurTrafo ? 'unter die Trafogrenze' : 'ins Netz'}${n.ausbau ? ' (auch nach der Ertüchtigung)' : ''} — sie werden trotzdem belegt, dort ist Netzausbau nötig.</span>` : ''}
      ${n.zugeordnet ? `<br>${n.zugeordnet} Gebäude ohne Kabelanbindung dem nächstgelegenen Trafo zugeordnet (Luftlinie, bis ${_fmt(n.zugeordnetMaxM)} m).` : ''}
      ${n.unbekannteQs && !n.ersatzQs && !n.nurTrafo ? `<br>⚠ ${n.unbekannteQs} Kabel ohne Querschnitt begrenzen nicht (Ersatzquerschnitt in der PV-Netzaufnahme).` : ''}
      ${_engstellenHtml(n, stich)}
      ${_ausbauHtml(n.ausbau)}
    </div>` : '';
  return `
    <div style="margin-top:6px;padding:5px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;">
      ${veraltet ? `<div style="font-size:9px;color:${GELB};margin-bottom:3px;">Auswahl oder Vorgaben geändert — Vorschau neu berechnen.</div>` : ''}
      ${v.annahmen ? `<div style="font-size:9px;color:var(--muted);line-height:1.35;margin-bottom:4px;" title="Mit diesen Vorgaben wurde die Vorschau gerechnet">Gerechnet mit: ${escHtml(v.annahmen)}</div>` : ''}
      ${zeile(HELLGRUEN, vorrang.length, `${vorrangName} — immer voll`, sum(vorrang))}
      ${zeile(ORANGE, ueber.length, 'davon über der Netzgrenze', sum(ueber), true)}
      ${gestuft ? zeile(GRUEN, zusatz.length, 'zusätzlich, netzverträglich', sum(zusatz))
                : zeile(GRUEN, belegen.length, 'werden belegt', sum(belegen))}
      ${zeile(ROT, netz.length, 'Netz zu knapp', sum(netz))}
      ${_ab.ohneNetzBelegen ? '' : zeile(GRAU, ohne.length, 'ohne Netzanbindung', sum(ohne))}
      ${zeile(GRAU, leer.length, 'kein Modul passt', null)}
      ${zeile(BRAUN, schatten.length, 'zu stark verschattet — bleiben frei', null)}
      ${teilweise.length ? `<div style="font-size:9px;color:var(--muted);padding-left:14px;">davon ${teilweise.length} Dächer nur teilweise (verschattete Flächen bzw. Dachseiten frei)</div>` : ''}
      ${fluegelN ? `<div style="font-size:9px;color:var(--muted);padding-left:14px;">${fluegelN} verwinkelte Dächer in Flügel zerlegt</div>` : ''}
      ${gruende ? `<div style="margin-top:4px;max-height:96px;overflow-y:auto;">${gruende}</div>` : ''}
      ${netzInfo}
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn-xs" style="flex:1;border-color:${GRUEN};color:${GRUEN};" ${belegen.length && !veraltet ? '' : 'disabled'}
          data-click="pvabUebernehmen()" title="Belegungsflächen anlegen, kWp in die PV-Assets — ein Strg+Z-Schritt">✓ ${belegen.length} Dächer belegen · ${_fmt(sum(belegen))} kWp</button>
        <button class="btn-xs" data-click="${veraltet ? 'pvabVorschau()' : 'pvabVerwerfen()'}" title="${veraltet ? 'Neu berechnen' : 'Vorschau verwerfen'}">${veraltet ? '↻' : '✕'}</button>
      </div>
      ${_auslegungHtml(belegen.length && !veraltet)}
    </div>`;
}

/** „Als Belegungsstand speichern" — unter den Belegen-Knöpfen. */
function _auslegungHtml(aktiv) {
  const gesamt = _ab.umfang === 'alle' && _ab.menge === 'max';
  return `
      <button class="btn-xs" style="width:100%;margin-top:4px;border-color:#b39ddb;color:#b39ddb;" ${aktiv ? '' : 'disabled'}
        data-click="pvabAlsStand()"
        title="Diese Belegung als benannten Stand sichern, OHNE die Dächer zu belegen — ansehen, vergleichen, später aktivieren oder als Auslegung in die PV-Analyse geben.${gesamt ? ' „Alle Dächer · Maximal“ wird beim ersten Mal Anlagenpotenzial der PV-Analyse.' : ''}">
        💾 Als Belegungsstand speichern${gesamt ? ' (Gesamtpotenzial)' : ''}</button>`;
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════════════════

/** Block öffnen/schließen — 'belegen' oder 'entfernen'; der andere schließt dabei. */
export function pvabToggle(modus = 'belegen') {
  _ab.modus = _ab.modus === modus ? null : (modus === 'entfernen' ? 'entfernen' : 'belegen');
  _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvabSet(feld, wert) {
  if (feld === 'umfang') _ab.umfang = UMFAENGE.some(u => u[0] === wert) ? wert : 'alle';
  else if (feld === 'trafoId') {
    const t = _trafos().find(x => String(x.id) === String(wert));
    _ab.trafoId = t ? t.id : null;
    _trafoCache = null;
  }
  else if (feld === 'bereich') _ab.bereich = null;
  else if (feld === 'minM2') _ab.minM2 = Math.max(0, parseFloat(wert) || 0);
  else if (feld === 'menge') _ab.menge = ['netz', 'gestuft'].includes(wert) ? wert : 'max';
  else if (feld === 'grenze') _ab.grenze = wert === 'trafo' ? 'trafo' : 'kabel';
  else if (feld === 'netzJahr') _ab.netzJahr = _int(wert);
  else if (feld === 'ausbau') _ab.ausbau = ['budget', 'alle'].includes(wert) ? wert : 'keiner';
  else if (feld === 'budgetT') _ab.budgetT = Math.max(0, parseFloat(wert) || 0);
  else if (feld === 'vorrang') _ab.vorrang = VORRANG.some(v => v[0] === wert) ? wert : 'neubau';
  else if (feld === 'ohneNetzBelegen') { _ab.ohneNetzBelegen = !!wert; pvModusRender(); pvModusMarkiereKarte(); return; }
  else if (feld === 'schatten') _ab.schatten = !!wert;
  else if (feld === 'fluegel') _ab.fluegel = !!wert;
  else if (feld === 'nutzungOffen') { _ab.nutzungOffen = !_ab.nutzungOffen; pvModusRender(); return; }
  _ab.vorschau = null;                     // andere Auswahl → Karte zeigt gleich die neuen Kandidaten
  if (feld === 'umfang' && wert === 'bereich' && !_ab.bereich) setTimeout(pvabBereichZiehen, 0);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvabNutzung(id, an) {
  if (an) _ab.ohneNutzung.delete(id); else _ab.ohneNutzung.add(id);
  _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

/** PV-Modus endet (25 pvModusStop): Vorschau und Bereichsrahmen weg. */
export function pvabBeenden() {
  _ab.vorschau = null;
  _ab.modus = null;
  _trafoCache = null;
  if (_engstelleMarker) { map.removeLayer(_engstelleMarker); _engstelleMarker = null; }
  _bereichZeigen();
}
