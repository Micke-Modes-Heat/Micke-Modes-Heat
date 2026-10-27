// ── 25-pv-modus.js — PV-Modus: Dachflächen direkt auf der Karte planen ──────
//
// Der Weg zu einer Dachfläche führte bisher über fünf Ebenen: Gebäudeliste →
// Karte aufklappen → Elektro-Assets → Dach & PV → „Flächen zeichnen" →
// „+ Belegungsfläche" (03c-gebaeude-io.js). Nach jeder Fläche endete der
// Zeichenmodus und man begann von vorn — bei 50 Gebäuden der Zeitfresser.
//
// Der PV-Modus dreht das um: ein Werkzeug, das anbleibt. Klick auf ein Dach =
// erste Ecke der Fläche, Startpunkt erneut klicken = fertig, nächstes Dach.
// Die fertige Fläche gehört dem Gebäude, auf dem sie LIEGT (pvModusZuordnen),
// nicht dem, das vorher ausgewählt war.
//
// Für die Masse gibt es zwei Abkürzungen, die das Zeichnen ganz ersetzen:
//   • „Grundriss übernehmen" — bei Schrägdächern ist die Dachfläche der
//     Grundriss (das Tool projiziert ihn mit 1/cos(Neigung) und teilt ihn am
//     First). Einzeln oder als Stapel für die in der Gebäudeliste ausgewählten
//     Gebäude; die Auswahl ist bewusst die Grenze, sonst bekämen Garagen und
//     Schuppen ungefragt eine Anlage.
//   • Rechteck-Werkzeug — zwei Klicks, am First ausgerichtet. Freihändige
//     Vierecke sind nie rechtwinklig, darin geht das Modulraster schlechter auf.
//
// Der Modus rechnet nichts selbst. Modulplatzierung, kWp, Profile und Assets
// bleiben in 03c-gebaeude-io.js; hier stehen Bedienung und Zuordnung. Was das
// Panel anfasst, ruft dieselben Handler wie die Gebäudekarte.

import { beginInteraction, cancelInteraction, getActiveInteraction } from './lib/interaction-state.js';
import { ensureSatellite, map } from './02b-gebaeude.js';
import { polygonCenter, polygonAreaM2, forwardClickToMap, updateViz } from './02c-karte-werkzeuge.js';
import {
  _hasBelegung, calcGebKwp, calcGebKwpKorr, getGebPvModules, pvNettoFlaeche,
  getDachDefaultNeigung, detectRoofAzimutFromPolygon, setPvVisible, escHtml, flyTo,
  attachGebPvLayer, redrawGebPvModules, _clipPolyHalfPlane, FLACH_BIS_GRAD, pvFlaecheDachZuordnen,
  pvFirstPunkt, pvNordHaelfteVorne, pvEffektiveBelegungText, PV_BELEGUNGSGRAD_TITEL,
  pvAbschlagBlockHtml, calcGebKwpTechnisch, pvAbschlagGeb, pvGcrStandard,
  _syncPvAssetIfInSync, getPvKorrFaktor, _polyCentroidLL, _karteAufgeklappt, pvModulMassKorrigieren,
} from './03c-gebaeude-io.js';
import { getAssetsForBuilding, deleteAsset, ASSETS } from './13a-assets-core.js';
import { pvnaAbrissGeplant } from './28-pv-netzaufnahme.js';
import { pvErtragsfaktor, pvUnterSchwelle, pvNordSektorBei } from './lib/pv-ertrag.js';
import { pvAbschlagRegeln, pvPotenzialStufen, PV_KENNZEICHEN } from './lib/pv-abschlaege.js';

const PANEL_ID    = 'pv-modus-panel';
const WL_ID       = 'pvm-werkzeugleiste';   // Werkzeugleiste auf der Karte (nur im Reiter)
const INTERAKTION = 'pv-modus';
const DACHFORMEN  = { flach: 'Flachdach', sattel: 'Satteldach', walm: 'Walmdach', pult: 'Pultdach' };
const GELB = '#ffd54f';
const ROT  = '#e53935';

let _stoppt = false;
/** Stapelbelegung läuft: Stromnetz erst am Ende einmal nachrechnen (pvuNachlauf). */
let _stapelLaeuft = false;
/** @type {((e:KeyboardEvent)=>void)|null} */
let _tastenHandler = null;
/** Rückgängig-Stapel: je Eintrag die in einem Schritt entstandenen Flächen. */
let _verlauf = [];
/**
 * kWp der PV-Assets VOR dem laufenden Schritt (null = es gab keins). Muss vor
 * dem Zeichnen erfasst werden: `finishGebPvDraw` legt über
 * `_autoCreatePvAssetFromDraw` selbst ein Asset an, danach ist nicht mehr
 * erkennbar, ob es zum Schritt gehört — und Strg+Z ließe es stehen.
 * @type {Map<number, number|null>}
 */
let _assetStand = new Map();

function _assetStandErfassen() {
  _assetStand = new Map();
  const pvJeGeb = new Map();
  for (const a of ASSETS.items) if (a.type === 'PV' && a.buildingId != null && !pvJeGeb.has(a.buildingId)) pvJeGeb.set(a.buildingId, a);
  for (const g of (window.gebaeude || [])) {
    const pv = pvJeGeb.get(g.id);
    _assetStand.set(g.id, pv ? (parseFloat(pv.props?.leistungKWp) || 0) : null);
  }
}

/** @returns {number|null|undefined} undefined = unbekannt (Asset unangetastet lassen) */
const _assetVorher = gId => (_assetStand.has(gId) ? _assetStand.get(gId) : undefined);

const _name = g => g?.name || ('Gebäude ' + g?.id);
const _geb  = gId => (window.gebaeude || []).find(x => x.id === gId) || null;
// Abgerissene Gebäude und solche mit geplantem Abriss (jedes Abrissjahr) sind
// für den Modus nicht da: kein Klickziel, keine Zuordnung, nicht in Listen und
// Stapeln. Ihr Grundriss liegt oft unter dem Neubau und schluckte sonst Klicks
// und Flächen.
const _mitPolygon = () => (window.gebaeude || [])
  .filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3 && !pvnaAbrissGeplant(g));

function _vorgabe() {
  if (!window.pvModusVorgabe) {
    window.pvModusVorgabe = {
      dachform: 'sattel', belegung: 90, neigung: null,
      // Nordseiten belegt man nicht: Dachflächen, deren Ertragsfaktor (Ausrichtung
      // UND Neigung, lib/pv-ertrag) unter ertragMin % liegt, bleiben frei — bei 35°
      // etwa ±70° um Nord, flache Norddächer (15°) dagegen nicht. Beim Satteldach
      // wird die betroffene Hälfte automatisch als Sperrfläche ausgespart.
      nordSperr: true, ertragMin: 75,
      // Flachdach: Aufständerung und Flächenausnutzung (GCR, Anteil Modulfläche an der
      // Fläche); gcr null = Standard der Aufständerung (Süd nach flachNeigung: 15° → 55 %, Ost-West 85 %).
      // Ost-West als Standard: mehr Module je m², flachere Einspeisespitze.
      ausrichtung: 'ostwest', gcr: null, flachNeigung: 15,
      // Gelten für ALLE Dächer sofort (03c pvRegelnGlobal): Randabstand zur Kante der
      // Belegungsfläche (m) auf Schräg- bzw. Flachdächern, Modullage auf Schrägdächern,
      // Mindestmodule je Dachfläche/-seite (8 ≈ 3,6 kWp: kleinere Reste wie Walmdach-
      // Dreiecke lohnen keinen eigenen Strang), Wartungsgänge und Feldgrenzen auf Flachdächern.
      // Abschläge (lib/pv-abschlaege): fehlende Werte = Standard (Hindernis 20/10 %, …)
      randabstand: 0.4, randFlach: 1.0, modulLage: 'hoch', mindestModule: 8,
      gangAlle: 12, gangBreite: 1.0, feldMax: 40,
    };
  }
  const v = window.pvModusVorgabe;
  if (!v.ausrichtung) v.ausrichtung = 'sued';           // ältere Projekte ohne Flachdachvorgabe
  if (v.gcr === undefined) v.gcr = null;
  if (v.randabstand == null) v.randabstand = 0.3;      // ältere Projekte ohne Belegungsregeln
  if (v.randFlach == null) v.randFlach = 1.0;          // bis 10/2026 ein Rand für alle Dächer
  if (v.ertragMin == null) v.ertragMin = 75;           // bis 10/2026 fester Sektor ±nordSektor° um Nord
  if (v.gangAlle == null) v.gangAlle = 12;             // bis 10/2026 ohne Wartungsgänge/Feldgrenzen
  if (v.gangBreite == null) v.gangBreite = 1.0;
  if (v.feldMax == null) v.feldMax = 40;
  if (v.flachNeigung == null) v.flachNeigung = 30;     // bis 10/2026: Süd-Aufständerung 30° (GCR 40 %, Faktor 1,0)
  delete v.nordSektor;
  if (!v.modulLage) v.modulLage = 'hoch';
  if (v.mindestModule == null) v.mindestModule = 0;
  return v;
}

/** Globale Modulmaße (Eingabefelder im Gebäude-PV-Panel, 03c liest sie dort). */
function _modulMasse() {
  const wert = (id, feld) => pvModulMassKorrigieren(feld, document.getElementById(id)?.value);
  return { breite: wert('pv-modul-breite', 'breite'), laenge: wert('pv-modul-laenge', 'laenge'), wp: wert('pv-modul-wp', 'wp') };
}

/** Kurzform der Regeln, die für alle Dächer gelten (leer = Standard). */
function _regelnText() {
  const v = _vorgabe(), m = _modulMasse();
  const teile = [`Modul ${_zahl(m.breite)}×${_zahl(m.laenge)} m · ${m.wp} Wp`];
  if (v.modulLage === 'quer') teile.push('quer');
  teile.push(`Rand ${_zahl(v.randabstand)} m, flach ${_zahl(v.randFlach)} m`);
  if (v.gangAlle > 0 && v.gangBreite > 0) teile.push(`Gang ${_zahl(v.gangBreite)} m alle ${_zahl(v.gangAlle)} m`);
  if (v.feldMax > 0 && v.gangBreite > 0) teile.push(`Felder ≤ ${_zahl(v.feldMax)} m`);
  if (v.mindestModule > 0) teile.push(`mind. ${v.mindestModule} Module je Fläche`);
  return teile.join(' · ');
}

const _zahl = x => String(Math.round(x * 100) / 100).replace('.', ',');

/** Flächenausnutzung eines Flachdachs nach den Vorgaben (%). */
const _vorgabeGcr = v => (v.gcr != null ? v.gcr : pvGcrStandard(v.ausrichtung));

/** Flachdachvorgaben auf ein Gebäude bzw. eine Rechenkopie — eine von Hand gesetzte Ausnutzung bleibt. */
function _flachVorgabe(g, v) {
  if (g._pvFlGcrManual) return;
  g.pvFlAusrichtung = v.ausrichtung || 'sued';
  g.pvFlGcr = _vorgabeGcr(v);
}

/** Die Vorgaben in einem Satz — für die Vorschau der automatischen Belegung (36). */
export function pvmVorgabeText() {
  const v = _vorgabe();
  return `${DACHFORMEN[v.dachform] || v.dachform}${v.neigung != null ? ` ${v.neigung}°` : ''} · Belegungsgrad ${v.belegung} %`
    + ` · Flachdach ${v.ausrichtung === 'ostwest' ? 'Ost-West' : 'Süd'}, Ausnutzung ${_vorgabeGcr(v)} %${v.gcr == null ? ' (Standard)' : ''}`
    + (v.nordSperr ? ` · Dachseiten unter ${v.ertragMin} % Ertrag frei` : ' · beide Dachseiten')
    + ` · ${_regelnText()}`;
}

/**
 * Belegungsregeln als Momentaufnahme — ein Belegungsstand (38) merkt sich, mit
 * welchen Regeln er entstand. `global` = was die Modulzahl JEDES Dachs bestimmt
 * (Vergleich mit pvmRegelnAbweichung); `vorgaben` nur zur Dokumentation.
 */
export function pvmRegelnSnapshot() {
  const v = _vorgabe(), m = _modulMasse();
  return {
    global: { modulBreite: m.breite, modulLaenge: m.laenge, modulWp: m.wp,
      modulLage: v.modulLage, randabstand: v.randabstand, randFlach: v.randFlach, mindestModule: v.mindestModule,
      gangAlle: v.gangAlle, gangBreite: v.gangBreite, feldMax: v.feldMax,
      hindernisFlach: pvAbschlagRegeln(v).hindernisFlach, hindernisSchraeg: pvAbschlagRegeln(v).hindernisSchraeg,
      flachNeigung: v.flachNeigung },
    vorgaben: { dachform: v.dachform, neigung: v.neigung, belegung: v.belegung, nordSperr: v.nordSperr,
      ertragMin: v.ertragMin, ausrichtung: v.ausrichtung, gcr: v.gcr },
  };
}

const _REGEL_NAMEN = { modulBreite: 'Modulbreite', modulLaenge: 'Modullänge', modulWp: 'Modulleistung',
  modulLage: 'Modullage', randabstand: 'Randabstand Schrägdach', randFlach: 'Randabstand Flachdach',
  mindestModule: 'Mindestmodule', gangAlle: 'Wartungsgang alle', gangBreite: 'Gangbreite', feldMax: 'Feldlänge max.',
  hindernisFlach: 'Hindernisabschlag flach (%)', hindernisSchraeg: 'Hindernisabschlag schräg (%)',
  flachNeigung: 'Süd-Aufständerung' };

/**
 * Unterschiede der globalen Regeln eines Snapshots zu den aktuellen.
 * @returns {string[]} lesbare Zeilen, leer = gleich (oder kein Snapshot)
 */
export function pvmRegelnAbweichung(snap) {
  const alt = snap?.global;
  if (!alt) return [];
  const neu = pvmRegelnSnapshot().global;
  const fmt = (k, x) => k === 'modulLage' ? (x === 'quer' ? 'quer' : 'hochkant')
    : k === 'modulWp' ? `${x} Wp` : k === 'mindestModule' ? String(x)
    : k.startsWith('hindernis') ? `${_zahl(+x)} %` : k === 'flachNeigung' ? `${_zahl(+x)}°` : `${_zahl(+x)} m`;
  return Object.keys(_REGEL_NAMEN).filter(k => alt[k] != null && String(alt[k]) !== String(neu[k]))
    .map(k => `${_REGEL_NAMEN[k]}: ${fmt(k, alt[k])} (jetzt ${fmt(k, neu[k])})`);
}

/** Globale Regeln eines Snapshots wieder einsetzen (38: Stand mit seinen Regeln öffnen). */
export function pvmRegelnSetzen(snap) {
  const alt = snap?.global;
  if (!alt) return;
  _regelAufAlle(() => {
    const v = _vorgabe();
    if (alt.modulLage) v.modulLage = alt.modulLage === 'quer' ? 'quer' : 'hoch';
    if (alt.randabstand != null) v.randabstand = +alt.randabstand;
    // Stände von vor 10/2026 kannten nur einen Rand für alle Dächer
    if (alt.randFlach != null || alt.randabstand != null) v.randFlach = +(alt.randFlach ?? alt.randabstand);
    // … und keine Wartungsgänge/Feldgrenzen
    if (alt.randabstand != null) {
      v.gangAlle = +(alt.gangAlle ?? 0);
      v.feldMax = +(alt.feldMax ?? 0);
      if (alt.gangBreite != null) v.gangBreite = +alt.gangBreite;
      // … und keine pauschalen Hindernisabschläge
      v.hindernisFlach = +(alt.hindernisFlach ?? 0);
      v.hindernisSchraeg = +(alt.hindernisSchraeg ?? 0);
      v.flachNeigung = +(alt.flachNeigung ?? 30);
    }
    if (alt.mindestModule != null) v.mindestModule = +alt.mindestModule;
    const feld = (id, art, x) => { const el = document.getElementById(id); if (el && x != null) el.value = pvModulMassKorrigieren(art, x); };
    feld('pv-modul-breite', 'breite', alt.modulBreite);
    feld('pv-modul-laenge', 'laenge', alt.modulLaenge);
    feld('pv-modul-wp', 'wp', alt.modulWp);
    window.onPvModulChange?.();
  });
}

/**
 * Eine Regel ändern, die für ALLE Dächer gilt: Module neu platzieren, kWp in die
 * PV-Assets nachziehen (nur wo Asset und Dach bisher übereinstimmten — von Hand
 * abweichende Assets bleiben, wie überall), Stromnetz einmal am Ende nachrechnen.
 */
// Getestet mit ~2.400 belegten Dächern: Platzieren + kWp ≈ 0,6 s. Teuer sind das
// Neuzeichnen der Modul-Overlays (~2,6 s), der Neuaufbau jeder Gebäudekarte (~8 s),
// die Asset-Suche je Gebäude (linear, ~2 s) und Netz + Strompanel (~14 s). Deshalb:
// höchstens _SOFORT Dächer nahe der Kartenmitte sofort, übrige im Hintergrund; nur
// aufgeklappte Karten neu; PV-Assets über ein Verzeichnis; Netz nach der Rückmeldung.
const _SOFORT = 150;
function _regelAufAlle(aendern) {
  const belegt = (window.gebaeude || []).filter(_hasBelegung);
  const vorher = new Map(belegt.map(g => [g.id, calcGebKwpKorr(g) || 0]));
  aendern();
  const pvJeGeb = new Map();
  for (const a of ASSETS.items) if (a.type === 'PV' && a.buildingId != null && !pvJeGeb.has(a.buildingId)) pvJeGeb.set(a.buildingId, a);
  let summeAlt = 0, summeNeu = 0;
  for (const g of belegt) {
    g._pvModCache = null; g._pvModSig = null;
    _syncPvAssetIfInSync(g, vorher.get(g.id), { ohneKarte: true, pv: pvJeGeb.get(g.id) || null });
    if (_karteAufgeklappt(g.id)) window._rerenderCard?.(g.id);
    window._updateGebLabelPv?.(g.id);
    summeAlt += vorher.get(g.id);
    summeNeu += calcGebKwpKorr(g) || 0;
  }
  _zeichneVerteilt(belegt);
  window.renderGebPvPanel?.();
  window.d3dNachViz?.();
  pvModusRender();
  const text = belegt.length && Math.abs(summeNeu - summeAlt) > 0.05
    ? `${belegt.length} belegte Dächer neu platziert: Σ ${summeAlt.toFixed(0)} → ${summeNeu.toFixed(0)} kWp.` : '';
  if (!belegt.length) { window.calcStromPanel?.(); return; }
  // Erst die Rückmeldung zeigen, dann Stromnetz und Strompanel nachrechnen (blockiert einige Sekunden)
  window.showHint?.(`${text} ⏳ Stromnetz wird nachgerechnet …`.trim(), 0);
  setTimeout(() => {
    window.pvuNachlauf?.();
    window.calcStromPanel?.();
    window.hideHint?.();
    if (text) window.showHint?.(text, 5000);
  }, 60);
}

// Modul-Overlays vieler Dächer zeichnen: die _SOFORT nächsten zur Kartenmitte gleich,
// den Rest in Portionen im Hintergrund (eine gemeinsame Warteschlange — ein neuer
// Auftrag verdrängt keinen alten). Kein rAF: pausiert im verdeckten Tab.
const _zeichnenOffen = new Set();
let _zeichnerLaeuft = false;
function _zeichneVerteilt(gs) {
  const mitte = map.getCenter();
  const abstand = g => (Array.isArray(g.polygon) && g.polygon.length >= 3 ? _meter(mitte, polygonCenter(g.polygon)) : Infinity);
  const reihe = gs.map(g => [abstand(g), g]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  reihe.forEach((g, i) => {
    if (i < _SOFORT) { _zeichnenOffen.delete(g); redrawGebPvModules(g); }
    else _zeichnenOffen.add(g);
  });
  if (_zeichnenOffen.size && !_zeichnerLaeuft) { _zeichnerLaeuft = true; setTimeout(_zeichnePortion, 120); }
}

function _zeichnePortion() {
  let n = 0;
  for (const g of _zeichnenOffen) {
    _zeichnenOffen.delete(g);
    redrawGebPvModules(g);
    if (++n >= 120) break;
  }
  if (_zeichnenOffen.size) setTimeout(_zeichnePortion, 0);
  else _zeichnerLaeuft = false;
}

/** Während eines Stapels (pvmStapelBelegen) nur vormerken — gezeichnet wird am Ende einmal. */
let _stapelZeichnen = null;
function _zeichne(g) {
  if (_stapelZeichnen) _stapelZeichnen.add(g);
  else redrawGebPvModules(g);
}

// ══════════════════════════════════════════════════════════════════════════
// MODUS AN/AUS
// ══════════════════════════════════════════════════════════════════════════

export function pvModusToggle() {
  if (window.pvModusAktiv) pvModusStop(); else pvModusStart();
}

export function pvModusStart() {
  if (window.pvModusAktiv) return;
  // Über die Interaktionsregistrierung, damit ein anderes Kartenwerkzeug den
  // Modus sauber beendet (und umgekehrt) statt zwei Werkzeuge gleichzeitig
  // auf denselben Kartenklick hören zu lassen.
  beginInteraction({
    id: INTERAKTION,
    label: 'PV-Modus',
    hint: 'A = Dach auswählen · B/S = Belegungs-/Sperrfläche zeichnen · R = Polygon/Rechteck · N = nächstes offenes Dach',
    // Beendet ein anderes Kartenwerkzeug den Modus (z. B. Freifläche zeichnen),
    // macht der Reiter danach von selbst weiter (_weiterNachWerkzeug).
    cancel: () => { if (!_stoppt && _reiterHost()) _autoWeiter = true; pvModusStop(); },
  });
  window.pvModusAktiv = true;
  if (!window.pvModusTyp)   window.pvModusTyp   = 'belegung';
  // Im Reiter beginnt man mit „Auswählen": ein Klick aufs Dach soll nicht ungefragt zeichnen
  if (!window.pvModusForm)  window.pvModusForm  = 'auswahl';
  if (!window.pvModusZeichenForm) window.pvModusZeichenForm = 'polygon';
  if (!window.pvModusListe) window.pvModusListe = 'mit';
  if (window.pvModusHilfe === undefined) window.pvModusHilfe = true;
  _vorgabe();
  _verlauf = [];
  _assetStandErfassen();
  ensureSatellite();
  setPvVisible(true);
  const cb = document.getElementById('el-pv-visible');
  if (cb) cb.checked = true;
  window.updateSperrVisibility?.();            // im Modus: Sperrflächen aller Gebäude
  _tastenHandler = _taste;
  document.addEventListener('keydown', _tastenHandler, true);
  map.on('click', _rechteckKartenklick);
  document.getElementById('btn-pv-modus-toggle')?.classList.add('active');
  _reiterZeigen();
  pvModusRender();
  pvModusMarkiereKarte();
}

/**
 * Der PV-Modus ist der Reiter Planung › Strom › Photovoltaik. Wer ihn von
 * woanders startet (Gebäudekarte, Befehlssuche), landet dort. elTab('pv') ruft
 * pvModusStart erneut auf — das kehrt sofort zurück, weil der Modus schon läuft.
 */
function _reiterZeigen() {
  if (_reiterHost()) return;
  if (!document.getElementById('lp-elektro') || typeof window.elTab !== 'function') return;
  // Reiter zuerst setzen: baut uiSchritt das Elektro-Panel erst auf, öffnet es
  // sonst den zuletzt gemerkten Reiter — und der würde den Modus wieder beenden.
  window.elTab('pv');
  window.uiSchritt?.('planung', { sparte: 'strom' });
}

/** Container im Reiter, wenn der Reiter gerade sichtbar ist (sonst null → schwebendes Fenster). */
function _reiterHost() {
  const sec = document.getElementById('el-sec-pv');
  if (!sec || sec.hidden || !document.getElementById('lp-elektro')?.classList.contains('active')) return null;
  // In Auswertung/Gutachten bleibt der Elektro-Bereich „aktiv", ist aber ausgeblendet
  if (sec.offsetParent === null) return null;
  return document.getElementById('el-pv-host');
}

/**
 * Einstieg aus der „Dach & PV"-Sektion eines Gebäudes: Modus starten und
 * dieses Dach ins Panel holen. Von dort geht es ohne Rückweg in die Liste
 * mit den übrigen Dächern weiter.
 */
export function pvModusStartFuer(gId) {
  window.pvModusGeb = gId;
  _stufenOffen()[3] = true;
  if (!window.pvModusAktiv) pvModusStart(); else _reiterZeigen();
  flyTo(gId);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvModusStop() {
  if (!window.pvModusAktiv || _stoppt) return;
  _stoppt = true;
  try {
    window.cancelGebPvDraw?.();
    window.cancelGebFirstDraw?.();
    _rechteckAbbruch();
    window.pvModusAktiv = false;
    window.pvabBeenden?.();                    // automatische Belegung (36): Vorschau/Bereich weg
    if (_tastenHandler) { document.removeEventListener('keydown', _tastenHandler, true); _tastenHandler = null; }
    map.off('click', _rechteckKartenklick);
    _verlauf = [];
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(WL_ID)?.remove();
    document.getElementById('btn-pv-modus-toggle')?.classList.remove('active');
    cancelInteraction(INTERAKTION);            // no-op, wenn der Stopp von dort kam
    window.updateSperrVisibility?.();
    updateViz();                               // Gebäudestile zurück auf die normale Darstellung
    _reiterPausiert();
  } finally { _stoppt = false; }
}

/**
 * Reiter offen, Modus aber aus — ein anderes Kartenwerkzeug hat ihn beendet
 * (Interaktionsregistrierung). Dann bietet der Reiter das Weitermachen an.
 */
let _autoWeiter = false;
// Das Ende jedes Kartenwerkzeugs meldet die Registrierung mit detail:null — auch
// mitten in beginInteraction des nächsten Werkzeugs. Darum erst im nächsten Takt
// prüfen, ob wirklich keins mehr läuft.
if (typeof window !== 'undefined') window.addEventListener?.('mapinteractionchange', e => {
  if (e.detail || !_autoWeiter) return;
  setTimeout(() => {
    if (!_autoWeiter || getActiveInteraction() || window.pvModusAktiv) return;
    _autoWeiter = false;
    if (_reiterHost()) pvModusStart();
  }, 0);
});

function _reiterPausiert() {
  const host = _reiterHost();
  if (!host) return;
  _ffParken();
  host.innerHTML = `<div class="el-naechster-in" data-stufe="leer">
      <div><b>Kartenbearbeitung pausiert</b><small>Ein anderes Kartenwerkzeug ist aktiv, zum Beispiel Freifläche zeichnen. Ist es fertig, geht es hier von selbst weiter.</small></div>
      <div class="el-naechster-knoepfe"><button class="btn-confirm" data-click="pvModusStart()">PV-Planung fortsetzen</button></div>
    </div>`;
}

/** Belegung/Sperrfläche umschalten — wirkt auch mitten in einer laufenden Zeichnung. */
export function pvModusSetTyp(typ) {
  window.pvModusTyp = typ === 'sperr' ? 'sperr' : 'belegung';
  const st = window.gebPvDraw;
  if (st) {
    st.typ = window.pvModusTyp;
    st.polyline?.setStyle({ color: st.typ === 'sperr' ? ROT : GELB });
  }
  if (window.pvRechteck) {
    window.pvRechteck.typ = window.pvModusTyp;
    window.pvRechteck.layer?.setStyle({ color: window.pvModusTyp === 'sperr' ? ROT : GELB });
  }
  pvModusRender();
}

/** Zeichenart: freies Polygon oder Rechteck aus zwei Klicks. */
export function pvmSetForm(form) {
  window.pvModusForm = form === 'rechteck' ? 'rechteck' : form === 'auswahl' ? 'auswahl' : 'polygon';
  if (window.pvModusForm !== 'auswahl') window.pvModusZeichenForm = window.pvModusForm;
  window.cancelGebPvDraw?.();
  _rechteckAbbruch();
  pvModusRender();
}

/**
 * Werkzeug der Kartenleiste: „auswahl" (Klick wählt das Dach), „belegung" oder
 * „sperr" (Klick zeichnet in der zuletzt benutzten Form Polygon/Rechteck).
 */
export function pvmWerkzeug(w) {
  if (w === 'auswahl') { pvmSetForm('auswahl'); return; }
  if (window.pvModusForm === 'auswahl') {
    window.pvModusForm = window.pvModusZeichenForm || 'polygon';
    _rechteckAbbruch();
  }
  pvModusSetTyp(w);
}

/** 3D-Ansicht öffnen und dort gleich „Dachflächen bearbeiten" einschalten. */
export function pvm3d() {
  if (!window.d3dIstOffen?.()) window.d3dUmschalten?.();
  let n = 0;
  const haken = () => {
    const cb = document.querySelector('input[data-d3d="bearbeiten"]');
    if (cb) { if (!cb.checked) cb.click(); return; }
    if (++n < 20) setTimeout(haken, 150);
  };
  setTimeout(haken, 150);
}

function _taste(event) {
  const ziel = event.target;
  const tippt = !!ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA' ||
                           ziel.tagName === 'SELECT' || ziel.isContentEditable);
  if (window.pvabZiehtBereich) return;           // Bereich aufziehen (36) hat eigenes Esc
  if (event.key === 'Escape') {
    if (tippt) { ziel.blur(); return; }
    // Esc beendet erst die laufende Zeichnung, erst beim zweiten Mal den Modus.
    // Ohne stopPropagation würden zusätzlich der Esc-Handler in 02c und der der
    // Interaktionsregistrierung feuern — der Modus fiele mit der Fläche zusammen.
    event.preventDefault();
    event.stopPropagation();
    if (window.gebPvDraw || window.gebFirstDraw || window.pvRechteck) {
      window.cancelGebPvDraw?.();
      window.cancelGebFirstDraw?.();
      _rechteckAbbruch();
      pvModusRender();
      return;
    }
    // Im Reiter beendet Esc den Modus nicht (das tut der Reiterwechsel), sondern
    // legt das Zeichenwerkzeug weg.
    if (_reiterHost()) { if (window.pvModusForm !== 'auswahl') pvmSetForm('auswahl'); return; }
    pvModusStop();
    return;
  }
  if (tippt) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.stopPropagation();
    pvmUndo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const k = event.key.toLowerCase();
  if (k === 'b' || k === 's') { pvmWerkzeug(k === 'b' ? 'belegung' : 'sperr'); event.preventDefault(); }
  else if (k === 'a')         { pvmWerkzeug('auswahl'); event.preventDefault(); }
  else if (k === 'n')         { pvmNaechstesOffenes(); event.preventDefault(); }
  else if (k === 'r')         {
    const jetzt = window.pvModusForm === 'auswahl' ? window.pvModusZeichenForm : window.pvModusForm;
    pvmSetForm(jetzt === 'rechteck' ? 'polygon' : 'rechteck');
    event.preventDefault();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// KARTENKLICK — aus attachPolygonLayer (02b-gebaeude.js)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Klick auf ein Gebäudepolygon im PV-Modus. Der Klick ist zugleich die erste
 * Ecke der neuen Fläche: das Polygon schluckt den Kartenklick
 * (bubblingMouseEvents:false), deshalb wird er über forwardClickToMap an die
 * Karte weitergereicht, wo der normale Zeichenpfad ihn aufnimmt.
 * @returns {boolean} true = Klick verbraucht (keine Gebäudeauswahl)
 */
export function pvModusBuildingClick(gId, event) {
  if (!window.pvModusAktiv) return false;
  // Läuft bereits eine Polygonzeichnung, ist der Klick eine weitere Ecke — der
  // reguläre Weg (selectFromMap → forwardClickToMap) erledigt das.
  if (window.gebPvDraw || window.gebFirstDraw) return false;
  let g = _geb(gId);
  if (!g) return false;
  const latlng = _klickLatLng(event);
  // Abgerissenes Gebäude getroffen: steht dort ein Neubau, gilt der Klick ihm
  if (pvnaAbrissGeplant(g)) {
    const neu = latlng && _gebaeudeUnter(latlng);
    if (!neu) {
      window.showHint?.(`„${_name(g)}" hat ein Abrissjahr (${g.abrissjahr}) — keine PV-Fläche.`, 4000);
      return true;
    }
    g = neu; gId = neu.id;
  }
  if (window.pvModusForm === 'auswahl') {
    window.pvModusGeb = gId;
    _stufenOffen()[3] = true;
    pvModusRender();
    pvModusMarkiereKarte();
    return true;
  }
  if (window.pvModusForm === 'rechteck') {
    if (latlng) _rechteckKlick(latlng, gId);
    return true;
  }
  window.pvModusGeb = gId;
  _assetStandErfassen();
  window.startGebPvDraw?.(gId, window.pvModusTyp || 'belegung', { keepView: true });
  forwardClickToMap(event);
  pvModusRender();
  pvModusMarkiereKarte();
  return true;
}

/**
 * Klick auf eine bereits gezeichnete Fläche (aus attachGebPvLayer). Die
 * PV-Flächen liegen in einer eigenen Pane über den Gebäuden und fangen den
 * Klick ab, bevor er das Dach erreicht — seit „Grundriss als Fläche" deckt die
 * Belegung meist das ganze Dach, dieser Fall ist also der Normalfall:
 *   • Sperrflächen-Modus → hier beginnt die neue Fläche (Kamine, Gauben und
 *     Verschattung liegen naturgemäß INNERHALB der Belegung),
 *   • sonst → Dach nur ins Panel holen.
 * Der Klick blubbert anschließend zur Karte weiter und setzt dort die erste
 * Ecke; deshalb wird er hier NICHT zusätzlich weitergereicht.
 * @returns {boolean} true = Klick verbraucht (keine Gebäudeauswahl)
 */
export function pvModusFlaecheClick(gId) {
  if (!window.pvModusAktiv) return false;
  if (window.gebPvDraw || window.gebFirstDraw || window.pvRechteck) return false;  // Zeichnung läuft
  if (window.pvModusForm === 'rechteck') return false;                             // macht der Kartenklick
  const g = _geb(gId);
  if (!g) return false;
  window.pvModusGeb = gId;
  if (window.pvModusForm === 'auswahl') _stufenOffen()[3] = true;
  else if (window.pvModusTyp === 'sperr') {
    _assetStandErfassen();
    window.startGebPvDraw?.(gId, 'sperr', { keepView: true });
  }
  pvModusRender();
  pvModusMarkiereKarte();
  return true;
}

function _klickLatLng(event) {
  const domEv = event?.originalEvent;
  if (domEv && typeof map.mouseEventToLatLng === 'function') {
    try { return map.mouseEventToLatLng(domEv); } catch { /* Fallback unten */ }
  }
  return event?.latlng || null;
}

// ══════════════════════════════════════════════════════════════════════════
// RECHTECK — zwei Klicks, am First ausgerichtet
// ══════════════════════════════════════════════════════════════════════════

// Ecken eines Rechtecks von p1 nach p2 in einem um `winkelDeg` gedrehten
// Raster (0° = Nord). Für Schrägdächer ist das die Firstrichtung, damit die
// Fläche parallel zu First und Traufe liegt.
function _rechteckPunkte(p1, p2, winkelDeg) {
  const cosL = Math.cos(p1.lat * Math.PI / 180);
  const th = winkelDeg * Math.PI / 180;
  const e1 = { n: Math.cos(th),  e: Math.sin(th) };      // entlang First
  const e2 = { n: -Math.sin(th), e: Math.cos(th) };      // senkrecht dazu
  const dn = (p2.lat - p1.lat) * 111320;
  const de = (p2.lng - p1.lng) * 111320 * cosL;
  const a = dn * e1.n + de * e1.e;
  const b = dn * e2.n + de * e2.e;
  const punkt = (x, y) => ({
    lat: p1.lat + (x * e1.n + y * e2.n) / 111320,
    lng: p1.lng + (x * e1.e + y * e2.e) / (111320 * cosL),
  });
  return [punkt(0, 0), punkt(a, 0), punkt(a, b), punkt(0, b)];
}

function _rechteckWinkel(g) {
  if (!g || g.dachform === 'flach') return (g?.dachAzimut ?? 180) + 90;
  return (g.dachAzimut ?? 180) + 90;                     // First steht senkrecht zur Falllinie
}

function _rechteckKartenklick(e) {
  if (!window.pvModusAktiv || window.pvModusForm !== 'rechteck') return;
  if (window.gebPvDraw) return;
  _rechteckKlick(e.latlng, null);
}

function _rechteckKlick(latlng, gId) {
  const st = window.pvRechteck;
  if (!st) {
    const g = gId != null ? _geb(gId) : _gebaeudeUnter(latlng);
    if (!g) { window.showHint?.('Rechteck: mit dem ersten Klick auf ein Dach beginnen.', 4000); return; }
    window.pvModusGeb = g.id;
    _assetStandErfassen();
    window.pvRechteck = {
      gId: g.id, typ: window.pvModusTyp || 'belegung',
      p1: { lat: latlng.lat, lng: latlng.lng },
      winkel: _rechteckWinkel(g), layer: null,
    };
    map.on('mousemove', _rechteckBewegung);
    map.getContainer().style.cursor = 'crosshair';
    window.showHint?.('▭ Rechteck: zweite Ecke anklicken · Esc = abbrechen', 6000);
    pvModusRender();
    return;
  }
  const punkte = _rechteckPunkte(st.p1, latlng, st.winkel);
  const typ = st.typ;
  _rechteckAbbruch();
  _flaecheAnlegen(punkte, typ);
}

function _rechteckBewegung(e) {
  const st = window.pvRechteck;
  if (!st) return;
  const punkte = _rechteckPunkte(st.p1, e.latlng, st.winkel);
  const col = st.typ === 'sperr' ? ROT : GELB;
  if (st.layer) st.layer.setLatLngs(punkte);
  else st.layer = L.polygon(punkte, { color: col, weight: 2, dashArray: '6 4', fillOpacity: 0.15 }).addTo(map);
}

function _rechteckAbbruch() {
  const st = window.pvRechteck;
  if (!st) return;
  if (st.layer) map.removeLayer(st.layer);
  map.off('mousemove', _rechteckBewegung);
  window.pvRechteck = null;
  if (typeof map !== 'undefined') map.getContainer().style.cursor = '';
  window.hideHint?.();
}

function _gebaeudeUnter(latlng) {
  const treffer = _mitPolygon().filter(g => _pip(latlng, g.polygon));
  return treffer.length ? _kleinstes(treffer) : null;
}

// ══════════════════════════════════════════════════════════════════════════
// ZUORDNUNG — die Geometrie entscheidet, nicht die Vorauswahl
// ══════════════════════════════════════════════════════════════════════════

function _pip(pt, poly) {
  const x = pt.lng, y = pt.lat;
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const xi = a.lng ?? a[1], yi = a.lat ?? a[0];
    const xj = b.lng ?? b[1], yj = b.lat ?? b[0];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi)) innen = !innen;
  }
  return innen;
}

function _meter(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Liegt der Schwerpunkt in mehreren Polygonen (Innenhof, verschachtelte
// Grundrisse), gewinnt das kleinste — es ist das speziellere.
function _kleinstes(liste) {
  return liste.reduce((a, b) => ((+a.flaeche || Infinity) <= (+b.flaeche || Infinity) ? a : b));
}

// Flächenanteil per Rasterstichprobe: ohne Polygonverschnitt ist das die
// ehrlichste billige Näherung — Punkte innerhalb der gezeichneten Fläche
// werden gegen jedes Gebäude gezählt.
function _groessteUeberlappung(punkte, kandidaten) {
  const lats = punkte.map(p => p.lat), lngs = punkte.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const N = 12;
  const proben = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const pt = {
        lat: minLat + (maxLat - minLat) * (i + 0.5) / N,
        lng: minLng + (maxLng - minLng) * (j + 0.5) / N,
      };
      if (_pip(pt, punkte)) proben.push(pt);
    }
  }
  if (!proben.length) return null;
  let bester = null, meiste = 0;
  for (const g of kandidaten) {
    let n = 0;
    for (const pt of proben) if (_pip(pt, g.polygon)) n++;
    if (n > meiste) { meiste = n; bester = g; }
  }
  return meiste >= proben.length * 0.2 ? bester : null;
}

/**
 * Gebäude zu einer fertig gezeichneten Fläche bestimmen.
 * 1. Schwerpunkt im Gebäude · 2. größte Überlappung · 3. Rückfrage.
 * @returns {any|null} null = Fläche verwerfen
 */
export function pvModusZuordnen(punkte) {
  const kandidaten = _mitPolygon();
  if (!kandidaten.length) {
    alert('Es gibt kein Gebäude, dem die Fläche zugeordnet werden könnte.\nDie Fläche wurde verworfen.');
    return null;
  }
  const c = polygonCenter(punkte);
  const treffer = kandidaten.filter(g => _pip(c, g.polygon));
  if (treffer.length) return _kleinstes(treffer);

  const ueberlappt = _groessteUeberlappung(punkte, kandidaten);
  if (ueberlappt) {
    window.showHint?.(`Fläche „${_name(ueberlappt)}" zugeordnet (Schwerpunkt lag außerhalb des Grundrisses).`, 5000);
    return ueberlappt;
  }

  let nah = null, dist = Infinity;
  for (const g of kandidaten) {
    const d = _meter(c, polygonCenter(g.polygon));
    if (d < dist) { dist = d; nah = g; }
  }
  const ok = confirm(
    `Die Fläche liegt auf keinem Gebäude.\n\n` +
    `Stattdessen „${_name(nah)}" zuordnen? (${Math.round(dist)} m entfernt)\n\n` +
    `Abbrechen verwirft die Fläche.`);
  return ok ? nah : null;
}

// ══════════════════════════════════════════════════════════════════════════
// FLÄCHEN ANLEGEN (Rechteck, Grundriss) + Nachlauf des Zeichnens
// ══════════════════════════════════════════════════════════════════════════

// Fläche aus fertigen Punkten anlegen — gemeinsamer Weg für Rechteck und
// Grundrissübernahme. Das freie Polygon geht weiter über finishGebPvDraw.
function _flaecheAnhaengen(g, punkte, typ, zeichnen = true) {
  if (!g.pvFlaechen) g.pvFlaechen = [];
  window._gebPvFlCounter = (window._gebPvFlCounter || 0) + 1;
  const fl = {
    id: window._gebPvFlCounter, typ,
    polygon: punkte.map(p => ({ lat: p.lat, lng: p.lng })),
    flaeche: polygonAreaM2(punkte) || 0, layer: null, svgLayer: null,
  };
  pvFlaecheDachZuordnen(g, fl);            // auf LoD2-Dächern: Ausrichtung der Dachfläche darunter
  g.pvFlaechen.push(fl);
  g.pvModus = 'flaechen';
  if (typ !== 'sperr') g.pvAktiv = true;
  attachGebPvLayer(g, fl);
  if (zeichnen) _zeichne(g);
  return fl;
}

function _flaecheAnlegen(punkte, typ) {
  const g = pvModusZuordnen(punkte);
  if (!g) return null;
  const fl = _flaecheAnhaengen(g, punkte, typ);
  const vorher = _assetVorher(g.id);
  const nordIds = _erstbelegung(g);
  _verlaufMerken(_schritt(g.id, fl.id, nordIds, vorher));
  window.pvModusGeb = g.id;
  window._rerenderCard?.(g.id);
  window._updateGebLabelPv?.(g.id);
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.pvModusHilfe = false;
  pvModusMarkiereKarte();
  pvModusRender();
  return fl;
}

/**
 * Nachlauf einer im Modus fertig gezeichneten Fläche (aus finishGebPvDraw):
 * Vorgaben und Azimut setzen, kWp sofort ins PV-Asset. Ohne diese Übernahme
 * entstünde der Zustand „abweichend", den die PV-Übersicht hinterher repariert.
 */
export function pvModusNachFlaeche(g) {
  if (!g) return;
  window.pvModusGeb = g.id;
  const vorher = _assetVorher(g.id);
  // Vor _erstbelegung merken: danach kann die letzte Fläche die automatisch
  // angelegte Nord-Sperrfläche sein, nicht mehr die gerade gezeichnete.
  const gezeichnet = (g.pvFlaechen || []).at(-1);
  const nordIds = _erstbelegung(g);
  if (gezeichnet) _verlaufMerken(_schritt(g.id, gezeichnet.id, nordIds, vorher));
  window.calcStromPanel?.();
  window.pvModusHilfe = false;
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// NORDSEITE AUSSPAREN
// ══════════════════════════════════════════════════════════════════════════

/**
 * Welche Satteldachhälfte liegt unter der Ertragsschwelle (Vorgabe ertragMin,
 * Ausrichtung UND Neigung)? Ausgespart wird höchstens die schlechtere, also die
 * nördlichere Hälfte (wie 03c pvNordHaelfteVorne) — bei Ost-West-First sind
 * beide gleich gut und bleiben belegt.
 * @returns {boolean|null} true = Vorderseite (Azimut A) · false = Rückseite
 *   (A+180) · null = keine Hälfte unter der Schwelle
 */
function _nordSeite(g) {
  if (!g || g.dachform !== 'sattel') return null;   // nur hier gibt es zwei Seiten
  if (g.dachFlaechen?.length) return null;           // LoD2: Nordflächen werden gar nicht erst belegt
  const A = g.dachAzimut ?? 180;
  const nei = g.dachNeigung ?? getDachDefaultNeigung('sattel');
  const fV = pvErtragsfaktor(A, nei), fR = pvErtragsfaktor(A + 180, nei);
  if (Math.abs(fV - fR) < 1e-9) return null;
  const vorne = fV < fR;
  return pvUnterSchwelle(vorne ? A : A + 180, nei, _vorgabe().ertragMin) ? vorne : null;
}

/** „bei 35° etwa ±70° um Nord" — Lesehilfe zur Ertragsschwelle. */
function _schwelleText(nei) {
  const s = pvNordSektorBei(nei, _vorgabe().ertragMin);
  return s == null ? `bei ${nei}° keine Dachseite darunter`
    : s >= 180 ? `bei ${nei}° jede Dachseite darunter` : `bei ${nei}° etwa ±${Math.round(s / 5) * 5}° um Nord`;
}

function _autoNordFlaechen(g) {
  return (g.pvFlaechen || []).filter(f => f.typ === 'sperr' && f.auto === 'nord');
}

function _autoNordEntfernen(g) {
  const weg = _autoNordFlaechen(g);
  for (const fl of weg) {
    if (fl.layer) map.removeLayer(fl.layer);
    if (fl.svgLayer) map.removeLayer(fl.svgLayer);
  }
  if (weg.length) g.pvFlaechen = g.pvFlaechen.filter(f => !(f.typ === 'sperr' && f.auto === 'nord'));
  return weg.length;
}

/**
 * Nordhälfte der Belegung als Sperrfläche anlegen — exakt an derselben
 * Firstlinie, an der die Berechnung das Dach teilt (_clipPolyHalfPlane mit
 * pvRidgeOverride bzw. Schwerpunkt). Nur so bleibt auf der Südseite kein
 * Modul-Streifen der Nordseite stehen.
 * @returns {number[]} ids der angelegten Sperrflächen
 */
function _nordAnwenden(g) {
  _autoNordEntfernen(g);
  const nordVorne = _nordSeite(g);
  if (nordVorne === null) return [];
  const bel = (g.pvFlaechen || []).filter(f => f.typ !== 'sperr' && f.polygon && f.polygon.length >= 3);
  if (!bel.length) return [];
  const alle   = bel.flatMap(f => f.polygon);
  const maxLat = Math.max(...alle.map(p => p.lat)), minLat = Math.min(...alle.map(p => p.lat));
  const cosL   = Math.cos((maxLat + minLat) / 2 * Math.PI / 180);
  const A      = g.dachAzimut ?? 180;
  const C      = pvFirstPunkt(g, A, alle);
  const ids = [];
  for (const f of bel) {
    const haelfte = _clipPolyHalfPlane(f.polygon, C, A, cosL, nordVorne);
    if (haelfte.length < 3) continue;
    const fl = _flaecheAnhaengen(g, haelfte, 'sperr');
    fl.auto = 'nord';
    ids.push(fl.id);
  }
  _zeichne(g);
  return ids;
}

/**
 * Nach einer Dachform-/Azimutänderung von außen (z. B. Dachformen aus OSM,
 * 03b dachformenAusOsmErgaenzen): die automatisch ausgesparte Nordseite so neu
 * ableiten wie bei einer Eingabe im Modus (pvmDach) — sonst bliebe nach dem
 * Wechsel auf Flachdach die halbe Fläche gesperrt.
 */
export function pvmNordNachziehen(g) {
  if (!g || !_hasBelegung(g)) return;
  if (_autoNordFlaechen(g).length > 0 || (_vorgabe().nordSperr && !g._pvNordFrei)) _nordAnwenden(g);
}

/** Nordseite aussparen bzw. die automatische Sperrfläche wieder freigeben. */
export function pvmNordAussparen(gId) {
  const g = _geb(gId);
  if (!g) return;
  if (_autoNordFlaechen(g).length) {
    _autoNordEntfernen(g);
    g._pvNordFrei = true;                  // bewusste Entscheidung — beim Drehen nicht zurückholen
    redrawGebPvModules(g);
  } else {
    delete g._pvNordFrei;
    if (_nordSeite(g) === null) {
      alert(`Keine Dachhälfte von „${_name(g)}" liegt unter der Ertragsschwelle (${_vorgabe().ertragMin} %, ${_schwelleText(g.dachNeigung ?? getDachDefaultNeigung('sattel'))}).\n\nDie Schwelle lässt sich unter „Vorgaben für neue Dächer" ändern.`);
      return;
    }
    const ids = _nordAnwenden(g);
    if (ids.length) _verlaufMerken(ids.map(flId => ({ gId: g.id, flId })));
  }
  _uebernehmen(g);
  window._rerenderCard?.(gId);
  window._updateGebLabelPv?.(gId);
  window.calcStromPanel?.();
  pvModusRender();
  pvModusMarkiereKarte();
}

// Erstbelegung eines Dachs: Vorgabewerte und Azimut aus dem Grundriss setzen,
// Nordseite aussparen, danach kWp ins Asset.
// @returns {number[]} ids automatisch angelegter Sperrflächen (für Strg+Z)
function _erstbelegung(g, neu = 1) {
  if (!g || !_hasBelegung(g)) return [];
  const v = _vorgabe();
  const erste = (g.pvFlaechen || []).filter(f => f.typ !== 'sperr').length <= neu;
  let nordIds = [];
  if (erste) {
    // Echte Dachangaben (aus OSM oder von Hand, g.dachQuelle) haben Vorrang vor den Vorgaben
    if (v.dachform && !g._pvDachformManuell && !g.dachQuelle) g.dachform = v.dachform;
    if (v.belegung != null) g.pvFlBelegung = v.belegung;
    if (v.neigung  != null && !(g.dachQuelle && g.dachNeigung != null)) g.dachNeigung = v.neigung;
    _flachVorgabe(g, v);
    if (g.dachAzimut == null && Array.isArray(g.polygon) && g.polygon.length >= 3) {
      const az = detectRoofAzimutFromPolygon(g.polygon);
      if (az !== null) { g.dachAzimut = az; g.dachAutoAzimut = true; }
    }
    _zeichne(g);
    if (v.nordSperr) nordIds = _nordAnwenden(g);
  }
  _uebernehmen(g);
  // Im Stapel nur aufgeklappte Karten neu aufbauen (die Zeile zeigt kein kWp) — bei
  // ~2.400 Dächern sonst Sekunden
  if (!_stapelLaeuft || _karteAufgeklappt(g.id)) window._rerenderCard?.(g.id);
  window._updateGebLabelPv?.(g.id);
  return nordIds;
}

// Verlaufseintrag für eine neue Belegung samt automatischer Nord-Sperrfläche.
// Die Sperrflächen stehen vorn: Strg+Z arbeitet die Liste der Reihe nach ab und
// die Assetfrage hängt daran, dass die Belegung zuletzt verschwindet.
function _schritt(gId, belId, nordIds, assetVorher) {
  const bel = Array.isArray(belId) ? belId : [belId];
  return [...nordIds.map(flId => ({ gId, flId })),
    ...bel.slice(0, -1).map(flId => ({ gId, flId })),
    { gId, flId: bel[bel.length - 1], assetVorher }];
}

// kWp ins PV-Asset schreiben; legt es an, wenn es noch keins gibt (pvuFixOne
// aus 03c macht beides und rechnet das Stromnetz nach).
function _uebernehmen(g) {
  if (!g || !_hasBelegung(g)) return;
  window.pvuFixOne?.(g.id, { ohneNachlauf: _stapelLaeuft, ohneKarte: _stapelLaeuft && !_karteAufgeklappt(g.id) });
}

function _verlaufMerken(eintraege) {
  _verlauf.push(eintraege);
  if (_verlauf.length > 50) _verlauf.shift();
}

/**
 * Einen Schritt merken, der als Planungstransaktion lief (36 „Belegungen
 * entfernen"): Strg+Z nimmt ihn über die Transaktionshistorie zurück — die
 * stellt Flächen, PV-Assets und Kabel gemeinsam wieder her.
 */
export function pvmPlanungsSchrittMerken() {
  const at = window._lastPlanningTransaction?.at;
  if (at) _verlaufMerken({ planung: at });
}

function _planungsSchrittZurueck(at) {
  const letzte = window.getPlanningTransactionHistory?.().at(-1);
  if (letzte?.at !== at) {
    window.showHint?.('Zwischendurch wurde anderes geändert — das Entfernen lässt sich nicht mehr zurücknehmen.', 5000);
    return;
  }
  try { window.undoLastPlanningTransaction?.(); }
  catch (err) { console.error(err); window.showHint?.('Zurücknehmen fehlgeschlagen: ' + err.message, 6000); return; }
  if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  window.calcStromPanel?.();
  window.renderList?.();
  window.showHint?.(`↶ „${letzte.label}" zurückgenommen.`, 3000);
  pvModusMarkiereKarte();
  pvModusRender();
  window.d3dNachViz?.();   // 3D-Ansicht (Dachflächen bearbeiten) zeigt sonst den alten Stand
}

/** Letzten Schritt zurücknehmen (Strg+Z) — auch einen ganzen Grundriss-Stapel. */
export function pvmUndo() {
  const schritt = _verlauf.pop();
  if (!schritt) { window.showHint?.('Nichts mehr zurückzunehmen.', 3000); return; }
  if (!Array.isArray(schritt) && schritt.felder) { _felderZurueck(schritt.felder); return; }
  if (!Array.isArray(schritt)) { _planungsSchrittZurueck(schritt.planung); return; }
  // Erst alle Flächen des Schritts entfernen, dann je Dach EINMAL Asset/Zeichnen —
  // ein Stapel über ~2.400 Dächer rechnete sonst je Fläche das Stromnetz nach
  // (_uebernehmen ohne Stapelmodus) und brauchte Dutzende Minuten.
  const daecher = new Map();   // gId → assetVorher (letzter Eintrag des Dachs trägt ihn)
  for (const { gId, flId, assetVorher } of schritt) {
    const g = _geb(gId);
    if (!g) continue;
    const fl = (g.pvFlaechen || []).find(f => f.id === flId);
    if (fl) {
      if (fl.layer) map.removeLayer(fl.layer);
      if (fl.svgLayer) map.removeLayer(fl.svgLayer);
      g.pvFlaechen = g.pvFlaechen.filter(f => f.id !== flId);
    }
    if (!daecher.has(gId) || assetVorher !== undefined) daecher.set(gId, assetVorher);
  }
  const zuZeichnen = [];
  // Asset löschen rechnet je Aufruf das Netz neu (05b removeStromNode/-Edge) — gesammelt einmal
  const aufschieben = window.stromRecalcAufschieben || (fn => fn());
  _stapelLaeuft = true;
  try { aufschieben(() => {
    for (const [gId, assetVorher] of daecher) {
      const g = _geb(gId);
      zuZeichnen.push(g);
      if (!_hasBelegung(g)) {
        g.pvAktiv = false;
        // Ein in diesem Schritt entstandenes PV-Asset gehört zur Fläche und geht
        // mit ihr — sonst bliebe eine Anlage ohne Dachfläche im Projekt zurück.
        // Ein vorher vorhandenes Asset bekommt sein altes kWp zurück.
        const pv = getAssetsForBuilding(g.id).find(a => a.type === 'PV');
        if (pv && assetVorher === null) deleteAsset(pv.id, true);
        else if (pv && typeof assetVorher === 'number') {
          if (!pv.props) pv.props = {};
          pv.props.leistungKWp = assetVorher;
        }
      } else {
        _uebernehmen(g);
      }
      if (daecher.size < 50 || _karteAufgeklappt(gId)) window._rerenderCard?.(gId);
      window._updateGebLabelPv?.(gId);
    }
    if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();   // läuft beim Verlassen genau einmal
  }); } finally { _stapelLaeuft = false; }
  _zeichneVerteilt(zuZeichnen);
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.showHint?.(`↶ ${schritt.length} Fläche(n) zurückgenommen.`, 3000);
  pvModusMarkiereKarte();
  pvModusRender();
  window.d3dNachViz?.();
}

// ══════════════════════════════════════════════════════════════════════════
// GRUNDRISS ÜBERNEHMEN
// ══════════════════════════════════════════════════════════════════════════

/**
 * Nach neu berechneten Dachflächen (37 dachGrundrissNeu): Belegungen, die aus
 * Dachflächen entstanden sind, durch die neuen Flächen ersetzen; kWp ins Asset.
 * Andere Belegungen (frei gezeichnet ohne Dachfläche) bleiben.
 */
export function pvmDachflaechenNeuBelegen(g) {
  const weg = (g?.pvFlaechen || []).filter(fl => fl.typ === 'belegung' && fl.dachFlaecheId != null);
  if (!weg.length) return;
  for (const fl of weg) {
    if (fl.layer) map.removeLayer(fl.layer);
    if (fl.svgLayer) map.removeLayer(fl.svgLayer);
  }
  g.pvFlaechen = g.pvFlaechen.filter(fl => !weg.includes(fl));
  if (g.dachFlaechen?.length) _grundriss(g);
  if (!_hasBelegung(g)) g.pvAktiv = false;
  _uebernehmen(g);
  window._rerenderCard?.(g.id);
  window._updateGebLabelPv?.(g.id);
  pvModusRender();
}

/**
 * Belegbare LoD2-Dachflächen eines Gebäudes: nicht senkrecht, groß genug für
 * ein paar Module und — wenn „Nordseiten aussparen" an ist — nicht unter der
 * Ertragsschwelle (flache Flächen werden aufgeständert und zählen immer).
 */
function _dachflaechenZumBelegen(g) {
  const v = _vorgabe();
  return (g.dachFlaechen || []).filter(f => Array.isArray(f.punkte) && f.punkte.length >= 3
    && f.neigung <= 75 && (f.grundM2 ?? 0) >= 4
    && !(v.nordSperr && f.neigung >= FLACH_BIS_GRAD && pvUnterSchwelle(f.azimut, f.neigung, v.ertragMin)));
}

/**
 * Grundriss als Belegungsfläche übernehmen — bzw. bei LoD2-Dachdaten jede
 * belegbare Dachfläche einzeln (mit eigener Neigung und Ausrichtung).
 * @returns {any[]} angelegte Flächen (leer, wenn nichts belegbar ist)
 */
function _grundriss(g) {
  if (!g || !Array.isArray(g.polygon) || g.polygon.length < 3) return [];
  if (g.dachFlaechen?.length) {
    const fls = _dachflaechenZumBelegen(g).map(f => {
      const fl = _flaecheAnhaengen(g, f.punkte.map(q => ({ lat: q[0], lng: q[1] })), 'belegung', false);
      fl.azimut = f.azimut; fl.neigung = f.neigung; fl.dachFlaecheId = f.id;
      return fl;
    });
    if (fls.length) _zeichne(g);
    return fls;
  }
  return [_flaecheAnhaengen(g, g.polygon, 'belegung')];
}

/** Grundriss eines Gebäudes als Belegungsfläche übernehmen. */
export function pvmGrundriss(gId) {
  const g = _geb(gId);
  if (!g) return;
  if (pvnaAbrissGeplant(g)) { alert(`„${_name(g)}" hat ein Abrissjahr (${g.abrissjahr}) — keine PV.`); return; }
  if (_hasBelegung(g) &&
      !confirm(`„${_name(g)}" hat bereits eine Belegungsfläche.\nGrundriss zusätzlich übernehmen?`)) return;
  _assetStandErfassen();
  const vorher = _assetVorher(g.id);
  const fls = _grundriss(g);
  if (!fls.length) {
    alert(g.dachFlaechen?.length ? 'Keine belegbare Dachfläche (alle zu klein, zu steil oder nach Norden).' : 'Dieses Gebäude hat keinen Grundriss.');
    return;
  }
  const nordIds = _erstbelegung(g, fls.length);
  _verlaufMerken(_schritt(g.id, fls.map(f => f.id), nordIds, vorher));
  window.pvModusGeb = g.id;
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.showHint?.(`Grundriss übernommen: ${calcGebKwpKorr(g).toFixed(1)} kWp.`, 4000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// Gebäude, die die Stapelaktion trifft: ausgewählt (Haken in Gebäudeliste oder
// -tabelle), mit Grundriss, noch ohne Belegungsfläche.
function _stapelZiele() {
  return _mitPolygon().filter(g => g.selected && !_hasBelegung(g));
}

/**
 * Grundriss für alle ausgewählten Gebäude übernehmen. Die Auswahl ist bewusst
 * die Grenze — „alle offenen Dächer" würde Garagen und Schuppen mitbelegen.
 */
export function pvmGrundrissAuswahl() {
  const ziele = _stapelZiele();
  if (!ziele.length) {
    alert('Keine passenden Gebäude ausgewählt.\n\nGebäude in der Gebäudeliste oder in der Gebäudetabelle ankreuzen (dort lässt sich filtern und „alle sichtbaren" auswählen). Gebäude, die schon eine Belegungsfläche haben, bleiben unberührt.');
    return;
  }
  if (!confirm(`${ziele.length} ausgewählte Dächer mit ihrem Grundriss belegen?\n\n` +
               `Für jedes Dach entsteht eine Belegungsfläche in Grundrissgröße, die kWp gehen direkt ins PV-Asset. ` +
               `Mit Strg+Z lässt sich der ganze Schritt zurücknehmen.`)) return;
  const { anzahl, summe } = pvmStapelBelegen(ziele);
  window.showHint?.(`${anzahl} Dächer belegt · Σ ${summe.toFixed(0)} kWp. Strg+Z nimmt den Schritt zurück.`, 7000);
}

/**
 * Grundriss für eine Liste von Gebäuden als Belegungsfläche übernehmen — mit
 * den Vorgaben, wie beim einzelnen Dach, aber als EIN Strg+Z-Schritt und mit
 * nur einer Stromnetz-Nachrechnung am Ende. Bereits belegte Dächer bleiben unberührt.
 * Gemeinsamer Weg für die Auswahl und die automatische Belegung (36).
 * @param {any[]} ziele Gebäude
 * @param {{nachBelegen?: (g:any) => number[]}} [opts] nachBelegen: je Dach nach dem Belegen
 *   (z. B. verschattete Flächen auslassen, 40-baeume.js); liefert ids zusätzlich angelegter
 *   Flächen, die Strg+Z mit zurücknimmt
 * @returns {{anzahl:number, summe:number}}
 */
export function pvmStapelBelegen(ziele, opts = {}) {
  _assetStandErfassen();
  const schritt = [];
  let summe = 0, anzahl = 0;
  _stapelLaeuft = true;
  _stapelZeichnen = new Set();
  try {
    for (const g of ziele) {
      if (!g || _hasBelegung(g) || pvnaAbrissGeplant(g)) continue;   // Abriss: keine PV
      const vorher = _assetVorher(g.id);
      const fls = _grundriss(g);
      if (!fls.length) continue;
      const nordIds = _erstbelegung(g, fls.length);
      const extra = opts.nachBelegen ? (opts.nachBelegen(g) || []) : [];
      schritt.push(..._schritt(g.id, fls.map(f => f.id), [...nordIds, ...extra], vorher));
      if (!_hasBelegung(g)) continue;            // nachBelegen hat alles entfernt
      summe += calcGebKwpKorr(g) || 0;
      anzahl++;
    }
  } finally {
    _stapelLaeuft = false;
    const zuZeichnen = [..._stapelZeichnen];
    _stapelZeichnen = null;
    _zeichneVerteilt(zuZeichnen);
  }
  if (schritt.length) _verlaufMerken(schritt);
  window.pvuNachlauf?.();
  window.pvModusHilfe = false;
  window.calcStromPanel?.();
  window.updateTotals?.();        // die Gebäudezeilen zeigen kein kWp — kein renderList (Sekunden)
  window.renderGebPvPanel?.();
  pvModusMarkiereKarte();
  pvModusRender();
  return { anzahl, summe };
}

/**
 * Probebelegung ohne jede Änderung am Gebäude: was „Grundriss als Fläche" mit
 * den aktuellen Vorgaben ergäbe (Dachform/Neigung/Belegungsgrad, Azimut aus dem
 * Grundriss, Nordseite ausgespart — wie _erstbelegung + _nordAnwenden), auf
 * einer flachen Kopie gerechnet. Grundlage der Vorschau in 36.
 * Mit opts.mitKopie liegt die Rechenkopie bei (kopie) — 38 speichert daraus
 * einen Belegungsstand, ohne das Dach zu belegen.
 * @returns {{kwp:number, kwpKorr:number, module:number, kopie?:any}|null}
 */
export function pvmProbe(g, opts = {}) {
  const erg = t => ({ kwp: calcGebKwp(t) || 0, kwpKorr: calcGebKwpKorr(t) || 0, module: getGebPvModules(t).count || 0,
    ...(opts.mitKopie ? { kopie: t } : {}) });
  if (!g || !Array.isArray(g.polygon) || g.polygon.length < 3) return null;
  const v = _vorgabe();
  if (g.dachFlaechen?.length) {
    const t = { ...g, pvModus: 'flaechen', _pvModCache: null, _pvModSig: null,
      pvFlaechen: _dachflaechenZumBelegen(g).map((f, i) => {
        const poly = f.punkte.map(q => ({ lat: q[0], lng: q[1] }));
        return { id: -1 - i, typ: 'belegung', polygon: poly, flaeche: polygonAreaM2(poly) || 0, azimut: f.azimut, neigung: f.neigung };
      }) };
    if (v.belegung != null) t.pvFlBelegung = v.belegung;
    _flachVorgabe(t, v);
    if (!t.pvFlaechen.length) return { kwp: 0, kwpKorr: 0, module: 0 };
    return erg(t);
  }
  const poly = g.polygon.map(p => ({ lat: p.lat, lng: p.lng }));
  const t = { ...g, pvModus: 'flaechen', _pvModCache: null, _pvModSig: null,
    pvFlaechen: [{ id: -1, typ: 'belegung', polygon: poly, flaeche: polygonAreaM2(poly) || 0 }] };
  if (v.dachform && !g._pvDachformManuell && !g.dachQuelle) t.dachform = v.dachform;
  if (v.belegung != null) t.pvFlBelegung = v.belegung;
  if (v.neigung  != null && !(g.dachQuelle && g.dachNeigung != null)) t.dachNeigung = v.neigung;
  _flachVorgabe(t, v);
  if (t.dachAzimut == null) {
    const az = detectRoofAzimutFromPolygon(poly);
    if (az !== null) t.dachAzimut = az;
  }
  const nordVorne = v.nordSperr ? _nordSeite(t) : null;
  if (nordVorne !== null) {
    const maxLat = Math.max(...poly.map(p => p.lat)), minLat = Math.min(...poly.map(p => p.lat));
    const cosL = Math.cos((maxLat + minLat) / 2 * Math.PI / 180);
    const C = pvFirstPunkt(t, t.dachAzimut ?? 180, poly);
    const haelfte = _clipPolyHalfPlane(poly, C, t.dachAzimut ?? 180, cosL, nordVorne);
    if (haelfte.length >= 3) t.pvFlaechen.push({ id: -2, typ: 'sperr', auto: 'nord', polygon: haelfte, flaeche: polygonAreaM2(haelfte) || 0 });
  }
  return erg(t);
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION: NÄCHSTES OFFENES DACH
// ══════════════════════════════════════════════════════════════════════════

function _offeneDaecher() {
  return _mitPolygon().filter(g => !_hasBelegung(g));
}

/** Zum nächstgelegenen Dach ohne Belegungsfläche springen (Taste N). */
export function pvmNaechstesOffenes() {
  const offen = _offeneDaecher();
  if (!offen.length) { window.showHint?.('✓ Alle Dächer haben eine Fläche.', 4000); return; }
  const aktiv = _geb(window.pvModusGeb);
  const von = aktiv?.polygon ? polygonCenter(aktiv.polygon) : map.getCenter();
  let ziel = null, dist = Infinity;
  for (const g of offen) {
    if (aktiv && g.id === aktiv.id) continue;
    const d = _meter(von, polygonCenter(g.polygon));
    if (d < dist) { dist = d; ziel = g; }
  }
  if (!ziel) ziel = offen[0];
  window.pvModusGeb = ziel.id;
  flyTo(ziel.id);
  window.showHint?.(`→ „${_name(ziel)}" · noch ${offen.length} offen`, 4000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// KARTENDARSTELLUNG
// ══════════════════════════════════════════════════════════════════════════

/** Dächer mit Fläche warm, Dächer ohne Fläche gestrichelt — offene Arbeit sichtbar. */
export function pvModusMarkiereKarte() {
  if (!window.pvModusAktiv) return;
  if (window.pvabMarkiereKarte?.()) return;      // Vorschau „Dächer automatisch belegen" (36)
  if (window.pvbsMarkiereKarte?.()) return;      // angezeigter Belegungsstand (38): Dächer nach dem Stand färben
  const aktiv = window.pvModusGeb;
  (window.gebaeude || []).forEach(g => {
    if (!g.polygonLayer) return;
    if (pvnaAbrissGeplant(g)) {   // kein PV-Dach: grau, nicht als „offenes Dach"
      g.polygonLayer.setStyle({ color: '#555', weight: 1, dashArray: '4 4', fillColor: '#555', fillOpacity: 0.1 });
      g.polygonLayer.bringToBack();
      return;
    }
    const hat = _hasBelegung(g);
    const ist = g.id === aktiv;
    g.polygonLayer.setStyle({
      color: ist ? GELB : hat ? '#ffb300' : 'rgba(255,255,255,.55)',
      weight: ist ? 3 : hat ? 2 : 1.4,
      dashArray: hat ? '' : '4 4',
      fillColor: hat ? GELB : '#ffffff',
      fillOpacity: hat ? 0.10 : 0.04,
    });
    if (ist) g.polygonLayer.bringToFront();
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL
// ══════════════════════════════════════════════════════════════════════════

export function pvModusRender() {
  if (!window.pvModusAktiv) return;
  // Im Reiter Planung › Strom › Photovoltaik: fünf Stufen + Kartenleiste statt Fenster
  const host = _reiterHost();
  if (host) {
    document.getElementById(PANEL_ID)?.remove();
    _ffParken();
    host.innerHTML = (window.pvBelegungWirkungHtml?.('pvm') || '') + _reiterHtml();
    const slot = document.getElementById('pvr-ff-slot');
    const ff = document.getElementById('el-pv-ff');
    if (slot && ff) { slot.appendChild(ff); ff.hidden = false; }
    _werkzeugleisteRendern();
    return;
  }
  document.getElementById(WL_ID)?.remove();
  let el = document.getElementById(PANEL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'PV-Modus');
    document.body.appendChild(el);
  }
  // Wo die Belegung gilt: Dachdaten gemeinsam, Belegung nur in der aktiven Variante
  el.innerHTML = (window.pvBelegungWirkungHtml?.('pvm') || '') + _html();
}

// ══════════════════════════════════════════════════════════════════════════
// REITER „PHOTOVOLTAIK" — fünf Stufen in Arbeitsreihenfolge
// ══════════════════════════════════════════════════════════════════════════
//
// Dieselben Bausteine wie im Fenster, nur geordnet: 1 Dachdaten · 2 Regeln ·
// 3 Belegen · 4 Stände · 5 Prüfen. Die Zeichenwerkzeuge stehen auf der Karte
// (_werkzeugleisteRendern). Zugeklappte Stufen zeigen nur ihre Kurzzeile.

const _ic = id => `<svg class="ui-i"><use href="#ui-i-${id}"/></svg>`;

/** Aufgeklappte Stufen (Sitzung). Stufe 3 ist anfangs offen. */
function _stufenOffen() {
  if (!window.pvModusStufen) window.pvModusStufen = { 3: true };
  return window.pvModusStufen;
}

export function pvmStufe(n) {
  const of = _stufenOffen();
  of[n] = !of[n];
  pvModusRender();
}

/** Die Freiflächen-Gruppe (13n, #el-pv-ff) vor dem Neuzeichnen in Sicherheit bringen. */
function _ffParken() {
  const ff = document.getElementById('el-pv-ff');
  const sec = document.getElementById('el-sec-pv');
  if (ff && sec && ff.parentElement !== sec) { ff.hidden = true; sec.appendChild(ff); }
}

const _aufg = (titel, text, click, { icon = 'chev', id = '' } = {}) =>
  `<button class="ui-aufgabe"${id ? ` id="${id}"` : ''} data-click="${click}">${_ic(icon)}<span><b>${titel}</b><small>${text}</small></span><svg class="ui-i ui-i-sm"><use href="#ui-i-chev"/></svg></button>`;

function _stufeHtml(n, titel, kurz, zustand, inhalt) {
  const offen = !!_stufenOffen()[n];
  return `
    <div class="pvr-stufe${offen ? ' offen' : ''}">
      <button type="button" class="pvr-kopf" data-click="pvmStufe(${n})" aria-expanded="${offen}">
        <span class="pvr-nr" data-z="${zustand}">${zustand === 'ok' ? _ic('check') : n}</span>
        <span class="pvr-txt"><b>${titel}</b><small>${kurz}</small></span>
        <svg class="ui-i ui-i-sm pvr-chev"><use href="#ui-i-chev"/></svg>
      </button>
      ${offen ? `<div class="pvr-in">${inhalt}</div>` : ''}
    </div>`;
}

function _naechsterPv(alle, mitPv, offen) {
  const karte = (stufe, titel, text, knoepfe) => `<div class="el-naechster-in" data-stufe="${stufe}">
      <div><b>${titel}</b><small>${text}</small></div>
      <div class="el-naechster-knoepfe">${knoepfe.map(([l, c, p]) =>
        `<button class="${p ? 'btn-confirm' : 'btn-secondary'}" data-click="${c}">${l}</button>`).join('')}</div>
    </div>`;
  if (!alle.length) return karte('leer', 'Noch keine Gebäude', 'Dächer gibt es erst, wenn im Schritt Bestand Gebäude geladen sind.',
    [['Zum Bestand', "uiSchritt('bestand')", true]]);
  if (!mitPv.length) return karte('leer', 'Noch kein Dach belegt',
    'Am schnellsten: alle Dächer automatisch nach den Regeln belegen und dann einzeln nacharbeiten.',
    [['Dächer automatisch belegen', "pvabToggle('belegen')", true], ['Regeln ansehen', 'pvmStufe(2)']]);
  if (offen.length) return karte('offen', `${offen.length} ${offen.length === 1 ? 'Dach' : 'Dächer'} noch ohne Fläche`,
    'Offene Dächer sind auf der Karte gestrichelt. Automatisch belegen oder einzeln durchgehen (Taste N).',
    [['Offene automatisch belegen', "pvabToggle('belegen')", true], ['Nächstes offenes', 'pvmNaechstesOffenes()']]);
  return karte('ok', 'Alle Dächer haben eine Fläche',
    'Jetzt Anlagen abgleichen und die PV-Analyse rechnen.',
    [['PV-Analyse öffnen', "uiSchritt('auswertung'); setAnalyseSection('pva')", true], ['Prüfen', 'pvmStufe(5)']]);
}

function _reiterHtml() {
  const g     = _geb(window.pvModusGeb);
  const alle  = _mitPolygon();
  const mitPv = alle.filter(_hasBelegung);
  const offen = alle.filter(x => !_hasBelegung(x));
  const summe = mitPv.reduce((s, x) => s + (calcGebKwpKorr(x) || 0), 0);
  const ziele = _stapelZiele().length;
  const fmt = x => Math.round(x).toLocaleString('de-DE');

  // 1 · Dachdaten
  const lod2  = alle.filter(x => x.dachFlaechen?.length && x.dachLod2?.quelle !== 'grundriss').length;
  const grund = alle.filter(x => x.dachFlaechen?.length && x.dachLod2?.quelle === 'grundriss').length;
  const osm   = alle.filter(x => !x.dachFlaechen?.length && x.dachQuelle === 'osm').length;
  const ohne  = alle.length - lod2 - grund - osm;
  const pauschal = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
  const s1 = _stufeHtml(1, 'Dachdaten',
    alle.length ? `${fmt(alle.length)} Gebäude · ${fmt(lod2)} LoD2 · ${fmt(grund)} aus Grundriss` : 'keine Gebäude',
    !alle.length ? 'leer' : (lod2 + grund) ? 'ok' : 'offen', `
      <dl class="pvr-kv">
        <dt>LoD2 (amtlich)</dt><dd>${fmt(lod2)}</dd>
        <dt>Dach aus Grundriss</dt><dd>${fmt(grund)}</dd>
        <dt>nur Dachform aus OSM</dt><dd>${fmt(osm)}</dd>
        <dt>ohne Dachdaten</dt><dd>${fmt(ohne)}</dd>
      </dl>
      <p class="el-hinweis">Ohne Dachflächen rechnet die Belegung mit Dachform und Neigung aus den Regeln (Stufe 2).</p>
      <div class="pvr-knoepfe">
        <button class="btn-secondary" data-click="lod2Laden()" title="Amtliches 3D-Gebäudemodell laden (NRW, NI, BW direkt, sonst Datei)">LoD2 laden</button>
        <button class="btn-secondary" data-click="dachGrundrissBerechnen()" title="Dachflächen aus dem Grundriss berechnen (auch für geplante Neubauten)">Dach aus Grundriss</button>
      </div>
      ${window.verschattungBlockHtml?.() || ''}
      <div class="pvr-unter">Schnellabschätzung ohne Dächer</div>
      <p class="el-hinweis">Pauschale PV-Anlage (kWp × spezifischer Ertrag oder PVGIS-Lastgang) für frühe Abschätzungen, bevor Dächer belegt sind.</p>
      ${pauschal > 0 && mitPv.length ? `<p class="pvr-warn">Die pauschale Anlage (${fmt(pauschal)} kWp) zählt zusätzlich zu den belegten Dächern. Sobald Dächer belegt sind, auf 0 setzen.</p>` : ''}
      <button class="btn-secondary" data-click="togglePvPanel()">${pauschal > 0 ? `Pauschale Anlage · ${fmt(pauschal)} kWp` : 'Pauschale Anlage öffnen'}</button>`);

  // 2 · Regeln
  const v = _vorgabe();
  const s2 = _stufeHtml(2, 'Regeln',
    `${_regelnText()}${v.nordSperr ? ` · unter ${v.ertragMin} % Ertrag aus` : ''}`, 'ok', _vorgabeInhalt());

  // 3 · Belegen
  const s3 = _stufeHtml(3, 'Belegen',
    alle.length ? `${fmt(mitPv.length)} von ${fmt(alle.length)} Dächern · ${fmt(summe)} kWp` : '—',
    !mitPv.length ? 'leer' : offen.length ? 'offen' : 'ok', `
      <div class="pvr-unter">Automatisch</div>
      ${window.pvabBlockHtml?.() || ''}
      <div class="pvr-unter">Einzeln auf der Karte</div>
      <p class="el-hinweis">Dach anklicken wählt es aus. Zum Zeichnen oben auf der Karte „Belegungsfläche" oder „Sperrfläche" nehmen (B / S, Esc legt das Werkzeug weg).</p>
      ${ziele ? `<button class="btn-secondary" style="width:100%;" data-click="pvmGrundrissAuswahl()"
          title="Für jedes ausgewählte Dach ohne Fläche den Grundriss als Belegungsfläche übernehmen">Grundriss für ${ziele} ausgewählte Dächer</button>` : ''}
      <div class="pvr-dach">${_aktivBlock(g)}</div>
      ${_potenzialHtml()}
      ${_listenBlock()}
      <div class="pvr-unter">Freiflächen</div>
      <div id="pvr-ff-slot"></div>`);

  // 4 · Stände
  const staende = window.pvbsListe?.() || [];
  const entwurf = window.pvbsEntwurfInfo?.();
  const s4 = _stufeHtml(4, 'Stände',
    `${staende.length ? `${staende.length} ${staende.length === 1 ? 'Stand' : 'Stände'}` : 'noch keiner gespeichert'}${entwurf ? ' · Entwurf offen' : ''}`,
    entwurf ? 'offen' : staende.length ? 'ok' : 'leer', window.pvbsBlockHtml?.() || '');

  // 5 · Prüfen
  const s5 = _stufeHtml(5, 'Prüfen', 'Anlagen abgleichen · PV-Pflicht · PV-Analyse', 'leer', `
      ${window.pvAnschlussHinweisHtml?.() || ''}
      ${_aufg('Anlagen abgleichen', 'Gezeichnete kWp gegen die PV-Anlagen im Stromnetz', 'pvuTogglePanel()', { icon: 'list', id: 'btn-pv-uebersicht-toggle' })}
      ${_aufg('PV-Pflicht', 'Landesrechtliche Pflicht je Gebäude und Stand der Erfüllung', 'pvPflichtUebersichtOeffnen()', { icon: 'check' })}
      ${_aufg('PV-Analyse', 'Auslegungen, Energiefluss, Netz, Wirtschaftlichkeit', "uiSchritt('auswertung'); setAnalyseSection('pva')", { icon: 'arrow' })}
      ${_aufg('Netzstrategie-Editor', 'Anschlusswege je Flächengruppe vergleichen', "uiSchritt('auswertung'); setAnalyseSection('pva'); pvaSetView('netzstrategie')", { icon: 'arrow' })}
      ${_aufg('Autarkieziel', 'Batterie und H₂/BHKW für eine Mindestdeckung auslegen', "uiSchritt('auswertung'); setAnalyseSection('pva'); pvaSetView('autarkieziel')", { icon: 'arrow' })}`);

  return `
    <div class="pvr">
      ${_naechsterPv(alle, mitPv, offen)}
      ${s1}${s2}${s3}${s4}${s5}
    </div>`;
}

/** Werkzeugleiste oben auf der Karte (nur solange der Reiter offen ist). */
function _werkzeugleisteRendern() {
  let el = document.getElementById(WL_ID);
  if (!window.pvModusAktiv || !_reiterHost()) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = WL_ID;
    el.className = 'pvm-wl';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'PV-Werkzeuge');
    map.getContainer().appendChild(el);
    // Klicks dürfen nicht als Kartenklick (= Ecke) ankommen — daher eigener Handler
    // statt data-click (die Weitergabe an document ist hier gesperrt).
    window.L?.DomEvent?.disableClickPropagation(el);
    window.L?.DomEvent?.disableScrollPropagation(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-pvm]');
      if (!b) return;
      const w = b.dataset.pvm;
      if (w === 'auswahl' || w === 'belegung' || w === 'sperr') pvmWerkzeug(w);
      else if (w === 'polygon' || w === 'rechteck') pvmSetForm(w);   // nimmt den Flächentyp von zuvor
      else if (w === 'naechstes') pvmNaechstesOffenes();
      else if (w === 'undo') pvmUndo();
      else if (w === '3d') pvm3d();
    });
  }
  const form = window.pvModusForm || 'auswahl';
  const zeichnet = form !== 'auswahl';
  const typ = window.pvModusTyp || 'belegung';
  const zf = zeichnet ? form : (window.pvModusZeichenForm || 'polygon');
  const offen = _offeneDaecher().length;
  const k = (w, text, an, titel, extra = '') =>
    `<button type="button" data-pvm="${w}" aria-pressed="${an}" title="${titel}"${extra}>${text}</button>`;
  el.innerHTML =
    k('auswahl', 'Auswählen', !zeichnet, 'Dach anklicken wählt es aus (Taste A)') +
    k('belegung', 'Belegungsfläche', zeichnet && typ === 'belegung', 'Belegungsfläche zeichnen (Taste B)') +
    k('sperr', 'Sperrfläche', zeichnet && typ === 'sperr', 'Sperrfläche zeichnen: Kamine, Gauben, Verschattung (Taste S)', ' data-sperr') +
    '<span class="pvm-wl-tr"></span>' +
    k('polygon', 'Polygon', zf === 'polygon', 'Ecken einzeln klicken, Startpunkt schließt (Taste R wechselt)', zeichnet ? '' : ' data-blass') +
    k('rechteck', 'Rechteck', zf === 'rechteck', 'Zwei Klicks, am First ausgerichtet (Taste R wechselt)', zeichnet ? '' : ' data-blass') +
    '<span class="pvm-wl-tr"></span>' +
    k('naechstes', `Nächstes offenes${offen ? ` (${offen})` : ''}`, false, 'Zum nächstgelegenen Dach ohne Fläche (Taste N)') +
    k('undo', 'Rückgängig', false, 'Letzten Schritt zurücknehmen (Strg+Z)') +
    k('3d', '3D', false, '3D-Ansicht mit „Dachflächen bearbeiten" öffnen');
}

function _regler({ label, titel, min, max, step, wert, farbe, einheit, handler }) {
  return `<div class="inp-group">
      <div class="inp-label" title="${titel}">${label}</div>
      <div style="display:flex;align-items:center;gap:5px;padding:2px 0;">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${wert}"
          style="flex:1;cursor:pointer;accent-color:${farbe};height:4px;"
          oninput="this.nextElementSibling.textContent=this.value+'${einheit}'"
          data-change="${handler}"/>
        <span style="min-width:32px;text-align:right;font-size:12.5px;color:${farbe};font-weight:600;">${wert}${einheit}</span>
      </div>
    </div>`;
}

// Steuerelemente je Dachform — dieselbe Aufteilung wie in buildDachSection:
// Schrägdach über Belegungsgrad/Neigung/Azimut, Flachdach über GCR/Aufständerung.
function _dachRegler(g) {
  const schraeg = !!(g.dachform && g.dachform !== 'flach');
  const eff = _hasBelegung(g) ? pvEffektiveBelegungText(g) : '';
  const effZeile = (eff ? `<div style="font-size:11px;color:var(--muted);margin:-2px 0 3px;">${eff}</div>` : '')
    + (_hasBelegung(g) ? `<div style="margin:-2px 0 4px;">${pvAbschlagBlockHtml(g)}</div>` : '');
  if (schraeg) {
    const nei = g.dachNeigung != null ? g.dachNeigung : getDachDefaultNeigung(g.dachform);
    return _regler({ label:'Belegungsgrad (%)', titel: PV_BELEGUNGSGRAD_TITEL, min:40, max:100, step:5,
                     wert: g.pvFlBelegung != null ? g.pvFlBelegung : 90, farbe:GELB, einheit:'%', handler:`pvmFl(${g.id},'belegung',this.value)` })
      + effZeile
      + _regler({ label:'Neigung (°)', titel:'Neigung der Dachfläche', min:5, max:75, step:5,
                  wert: nei, farbe:'#80deea', einheit:'°', handler:`pvmDach(${g.id},'dachNeigung',this.value)` })
      + _regler({ label:'Azimut (°)', titel:'0=Nord · 90=Ost · 180=Süd · 270=West', min:0, max:355, step:5,
                  wert: g.dachAzimut ?? 180, farbe:'#ef9a9a', einheit:'°', handler:`pvmDach(${g.id},'dachAzimut',this.value)` })
      + (g.dachform === 'sattel' ? `
        <div style="display:flex;gap:4px;margin-top:2px;">
          <button class="btn-xs" style="flex:1;" data-click="pvmFirst(${g.id})"
            title="Firstlinie auf dem Satellitenbild nachzeichnen (2 Klicks)">First zeichnen</button>
          ${g.pvRidgeOverride ? `<button class="btn-xs" data-click="pvmFirstReset(${g.id})" title="First zurück auf automatische Mitte">↺</button>` : ''}
        </div>` : '');
  }
  const gcr = g.pvFlGcr != null ? g.pvFlGcr : pvGcrStandard(g.pvFlAusrichtung);
  return _regler({ label:'GCR (% Belegung)', titel:'Anteil Modulfläche an der gezeichneten Fläche', min:5, max:95, step:5,
                   wert: gcr, farbe:GELB, einheit:'%', handler:`pvmFl(${g.id},'gcr',this.value)` })
    + effZeile
    + `<div class="inp-group">
        <div class="inp-label">Aufständerung</div>
        <select class="inp-field" data-change="pvmFl(${g.id},'ausrichtung',this.value)">
          <option value="sued"${g.pvFlAusrichtung !== 'ostwest' ? ' selected' : ''}>Süd</option>
          <option value="ostwest"${g.pvFlAusrichtung === 'ostwest' ? ' selected' : ''}>Ost-West</option>
        </select>
      </div>`;
}

function _aktivBlock(g) {
  if (!g) {
    return `<div style="padding:8px 2px;font-size:12px;color:var(--muted);line-height:1.5;text-align:center;">
      Noch kein Dach gewählt — eines anklicken oder „→ nächstes offenes".
    </div>`;
  }
  const kwp     = calcGebKwpKorr(g);
  const basis   = calcGebKwp(g);
  const faktor  = basis > 0 ? kwp / basis : 1;
  const modRes  = _hasBelegung(g) ? getGebPvModules(g) : null;
  const mod     = modRes ? modRes.count : 0;
  const split   = (g.dachform === 'sattel' && modRes && modRes.frontCount != null)
    ? ` · 2-seitig ${modRes.frontCount}/${modRes.backCount}` : '';
  const netto   = pvNettoFlaeche(g);
  const fakFarbe = faktor >= 0.9 ? '#4caf50' : faktor >= 0.75 ? '#f9a825' : ROT;
  const schraeg = !!(g.dachform && g.dachform !== 'flach');
  const nordDa  = _autoNordFlaechen(g).length > 0;

  const flaechen = (g.pvFlaechen || []).map(fl => {
    const bel = fl.typ !== 'sperr';
    const beschriftung = bel ? 'Belegung' : (fl.auto === 'nord' ? 'Sperr · Nordseite' : 'Sperrfläche');
    return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:1px 0;">
      <span style="color:${bel ? GELB : ROT};">${bel ? '☀' : '⛔'}</span>
      <span style="flex:1;">${beschriftung}</span>
      <span style="font-family:'DM Mono',monospace;color:var(--muted);">${(fl.flaeche || 0).toFixed(0)} m²</span>
      <button class="btn-xs red" data-click="pvmFlaecheWeg(${g.id},${fl.id})" title="Fläche entfernen">✕</button>
    </div>`;
  }).join('');

  return `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <span style="color:${GELB};">☀</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${escHtml(_name(g))}</span>
      <span style="font-family:'DM Mono',monospace;color:${GELB};font-size:12.5px;">${kwp.toFixed(1)} kWp</span>
    </div>
    ${g.dachFlaechen?.length ? `
    <div style="font-size:11px;color:var(--muted);margin-bottom:4px;line-height:1.4;"
      title="${g.dachLod2?.quelle === 'grundriss' ? 'Aus dem Grundriss berechnet (Flügel mit Sattel-/Walmdach, Kehlen an den Anschlüssen) — folgt Dachform und Neigung des Gebäudes' : 'Amtliches 3D-Gebäudemodell: jede Dachfläche mit eigener Neigung und Ausrichtung'}">
      ${g.dachLod2?.quelle === 'grundriss' ? 'Aus Grundriss' : 'LoD2'}: ${g.dachFlaechen.length} Dachflächen${g.dachLod2 ? ` · Traufe ${g.dachLod2.traufeM.toFixed(1)} m · First ${g.dachLod2.firstM.toFixed(1)} m` : ''}
    </div>
    <button class="btn-xs" style="width:100%;border-color:${GELB};color:${GELB};"
      data-click="pvmGrundriss(${g.id})"
      title="Jede belegbare Dachfläche als eigene Belegungsfläche übernehmen (mit ihrer Neigung und Ausrichtung; Nordflächen nach den Vorgaben ausgelassen)">Dachflächen übernehmen</button>` : `
    <button class="btn-xs" style="width:100%;border-color:${GELB};color:${GELB};"
      data-click="pvmGrundriss(${g.id})"
      title="Den Gebäudegrundriss als Belegungsfläche übernehmen — bei Schrägdächern ist er die Dachfläche (Projektion und Firstteilung macht die Berechnung)">Grundriss als Fläche</button>`}
    ${g.dachform === 'sattel' && !g.dachFlaechen?.length ? `
    <button class="btn-xs" style="width:100%;margin-top:4px;${nordDa ? `border-color:${ROT};color:${ROT};` : ''}"
      data-click="pvmNordAussparen(${g.id})"
      title="${nordDa
        ? 'Die automatische Sperrfläche auf der Nordseite wieder entfernen'
        : `Die nach Norden zeigende Dachhälfte als Sperrfläche aussparen, wenn ihr Ertrag unter ${_vorgabe().ertragMin} % liegt (${_schwelleText(g.dachNeigung ?? getDachDefaultNeigung('sattel'))})`}">
      ${nordDa ? '↺ Nordseite wieder freigeben' : 'Nordseite aussparen'}</button>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px;">
      <div class="inp-group">
        <div class="inp-label">Dachform</div>
        <select class="inp-field" data-change="pvmDach(${g.id},'dachform',this.value)">
          ${Object.entries(DACHFORMEN).map(([v, l]) =>
            `<option value="${v}"${(g.dachform || 'sattel') === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="inp-group">
        <div class="inp-label" title="0=Nord · 90=Ost · 180=Süd · 270=West">Ausrichtung (°)</div>
        <div style="display:flex;gap:4px;">
          <input class="inp-field" type="number" min="0" max="359" style="flex:1;"
            value="${g.dachAzimut ?? ''}" placeholder="${g.dachAutoAzimut ? 'auto' : '180'}"
            data-change="pvmDach(${g.id},'dachAzimut',this.value)"/>
          <button class="btn-xs" title="Aus der Polygon-Längsachse ermitteln" data-click="pvmAzimutAuto(${g.id})">🔄</button>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;">${_dachRegler(g)}</div>
    ${flaechen
      ? `<div style="margin-top:6px;padding:4px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);">${flaechen}</div>`
      : '<div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center;">Noch keine Fläche an diesem Gebäude.</div>'}
    ${netto > 0 ? `
    <div class="geb-dach-kwp-row" style="margin-top:6px;">
      <span>${mod} Mod.${split}</span><span>${netto.toFixed(0)} m²</span>
      ${schraeg
        ? `<span>Faktor</span><span style="color:${fakFarbe};font-weight:600;">${(faktor * 100).toFixed(0)} %</span>`
        : `<span>Fläche</span><span style="font-weight:600;">${basis.toFixed(1)} kWp</span>`}
      <span style="font-weight:600;">= PV</span><span style="color:${GELB};font-weight:600;">${kwp.toFixed(1)} kWp</span>
    </div>` : ''}
    ${/* Verschattung durch Bäume und Nachbargebäude (40-baeume.js) */ window.baumVerschattungZeileHtml?.(g) || ''}
    ${/* Landesrechtliche PV-Pflicht dieses Dachs (09e, über window — siehe dort). */ ''}
    ${window.pvPflichtBadgeHtml?.(g.id) || ''}`;
}

function _vorgabeBlock() {
  const v = _vorgabe();
  if (!window.pvModusVorgabeOffen) {
    return `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);margin-top:8px;cursor:pointer;"
        data-click="pvmVorgabeToggle()" title="Regeln für alle Dächer und Vorgaben, die jedes neu belegte Dach erbt">
      <span style="text-transform:uppercase;letter-spacing:.06em;flex:1;">Belegungsregeln</span>
      <span style="text-align:right;">${DACHFORMEN[v.dachform] || v.dachform} · ${v.belegung} %${v.neigung != null ? ' · ' + v.neigung + '°' : ''}${v.nordSperr ? ` · < ${v.ertragMin} % Ertrag aus` : ''} · Flach ${v.ausrichtung === 'ostwest' ? 'OW' : 'S'} ${_vorgabeGcr(v)} % · Rand ${_zahl(v.randabstand)}/${_zahl(v.randFlach)} m${v.modulLage === 'quer' ? ' · quer' : ''}${v.mindestModule > 0 ? ` · ≥ ${v.mindestModule} Mod.` : ''}</span>
      <span>▸</span>
    </div>`;
  }
  return `
    <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);margin-top:8px;cursor:pointer;text-transform:uppercase;letter-spacing:.06em;"
      data-click="pvmVorgabeToggle()">
      <span style="flex:1;">Belegungsregeln</span><span>▾</span>
    </div>
    <div style="padding:5px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);margin-top:3px;">
      ${_vorgabeInhalt()}
    </div>`;
}

/** Inhalt der Belegungsregeln — im Fenster aufgeklappt, im Reiter als Stufe 2. */
/**
 * Potenzialstufen über alle belegten Dächer (lib/pv-abschlaege): technisch →
 * nach Hindernissen → realisierbar → wirtschaftlich. Auch für das Gutachten (17).
 */
export function pvmPotenzialStufen() {
  const geb = _mitPolygon().filter(_hasBelegung);
  const r = pvAbschlagRegeln(window.pvModusVorgabe || {});
  const s = pvPotenzialStufen(geb.map(g => {
    const ab = pvAbschlagGeb(g);
    return { kwpTech: calcGebKwpTechnisch(g), faktor: ab.faktor, hindernis: ab.hindernis, kennzeichen: ab.kennzeichenListe };
  }), r);
  const erfasst = geb.filter(g => g.pvHindernisseErfasst).length;
  return { ...s, regeln: r, hindernisseErfasst: erfasst };
}

function _potenzialHtml() {
  const s = pvmPotenzialStufen();
  if (!s.daecher) return '';
  const fmt = x => Math.round(x).toLocaleString('de-DE');
  const kz = PV_KENNZEICHEN.filter(k => s.jeKennzeichen[k.key])
    .map(k => `${k.kurz} ${s.jeKennzeichen[k.key].n}`).join(' · ');
  return `
      <div class="pvr-unter">Potenzial</div>
      <dl class="pvr-kv" title="Technisch = platzierte Module. Realisierbar = nach pauschalem Hindernisabschlag und Kennzeichen der Gebäude — damit rechnen Assets, Netz und Gutachten. Wirtschaftlich = davon nur Anlagen ab der Mindestgröße.">
        <dt>technisch</dt><dd>${fmt(s.technisch)} kWp</dd>
        <dt>nach Hindernissen</dt><dd>${fmt(s.ohneHindernis)} kWp</dd>
        <dt>realisierbar${kz ? ` (${kz})` : ''}</dt><dd>${fmt(s.realisierbar)} kWp</dd>
        <dt>wirtschaftlich (≥ ${_zahl(s.regeln.minAnlageKwp)} kWp)</dt><dd>${fmt(s.wirtschaftlich)} kWp</dd>
      </dl>
      <p class="el-hinweis">${s.daecher} Dächer${s.hindernisseErfasst ? `, davon ${s.hindernisseErfasst} mit erfassten Hindernissen` : ''}${s.ausgeschlossen ? ` · ${s.ausgeschlossen} ${s.ausgeschlossen === 1 ? 'fällt' : 'fallen'} durch Kennzeichen heraus` : ''}${s.zuKlein ? ` · ${s.zuKlein} ${s.zuKlein === 1 ? 'liegt' : 'liegen'} unter der Mindestgröße` : ''}.</p>`;
}

function _vorgabeInhalt() {
  const ue = _uebertrag();
  const ausgewaehlt = _mitPolygon().filter(g => g.selected && _hasBelegung(g)).length;
  const zwischen = text => `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:7px 0 3px;">${text}</div>`;
  return `
      ${zwischen('Gelten sofort für alle Dächer')}
      ${pvmRegelnGlobalHtml()}
      ${zwischen('Vorgaben beim Belegen')}
      ${pvmVorgabeFelderHtml()}
      <div style="display:flex;gap:4px;align-items:center;margin-top:6px;">
        <select class="inp-field" style="flex:1;padding:2px 4px;font-size:12px;" data-change="pvmUebertrag('umfang',this.value)"
          title="Auf welche belegten Dächer die Vorgaben übertragen werden">
          <option value="alle"${ue.umfang !== 'auswahl' ? ' selected' : ''}>alle belegten Dächer</option>
          <option value="auswahl"${ue.umfang === 'auswahl' ? ' selected' : ''}${ausgewaehlt ? '' : ' disabled'}>nur ausgewählte (${ausgewaehlt})</option>
        </select>
      </div>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;margin-top:3px;"
        title="Ohne Haken bleiben Dächer unberührt, an denen jemand Dachform/Neigung bzw. Belegungsgrad/Ausnutzung von Hand eingestellt hat. Dachdaten aus LoD2 oder OpenStreetMap werden nie überschrieben.">
        <input type="checkbox" ${ue.auchEigene ? 'checked' : ''} style="cursor:pointer;" data-change="pvmUebertrag('auchEigene',this.checked)"/>
        auch Dächer mit eigenen Angaben
      </label>
      <button class="btn-xs" style="width:100%;margin-top:4px;" data-click="pvmVorgabeAufAlle()"
        title="Dachform, Neigung, Belegungsgrad und Flachdachvorgaben auf die belegten Dächer übertragen (Strg+Z nimmt es zurück)">↧ Vorgaben auf Dächer übertragen</button>`;
}

/** Einstellungen des Übertragens (Sitzung). */
function _uebertrag() {
  if (!window.pvModusUebertrag) window.pvModusUebertrag = { umfang: 'alle', auchEigene: false };
  return window.pvModusUebertrag;
}

export function pvmUebertrag(feld, wert) {
  const ue = _uebertrag();
  if (feld === 'umfang') ue.umfang = wert === 'auswahl' ? 'auswahl' : 'alle';
  if (feld === 'auchEigene') ue.auchEigene = !!wert;
  pvModusRender();
}

/** Eingabefelder der Regeln, die sofort für alle Dächer gelten. */
export function pvmRegelnGlobalHtml() {
  const v = _vorgabe(), m = _modulMasse(), ab = pvAbschlagRegeln(v);
  const zahlFeld = (feld, wert, min, max, step, titel) => `<input class="inp-field" type="number" min="${min}" max="${max}" step="${step}"
      value="${wert}" style="padding:2px 4px;" title="${titel}" data-change="pvmRegel('${feld}',this.value)"/>`;
  return `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
        <div class="inp-group"><div class="inp-label" title="Standardmodul (global) — dasselbe Feld wie im Gebäude-PV-Panel">Modul B (m)</div>
          ${zahlFeld('modulBreite', m.breite, 0.5, 2.5, 0.05, 'Modulbreite')}</div>
        <div class="inp-group"><div class="inp-label">Modul L (m)</div>
          ${zahlFeld('modulLaenge', m.laenge, 0.5, 3, 0.05, 'Modullänge')}</div>
        <div class="inp-group"><div class="inp-label">Wp</div>
          ${zahlFeld('modulWp', m.wp, 100, 800, 5, 'Modulleistung')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
        <div class="inp-group"><div class="inp-label" title="Abstand der Module zu Traufe, First und Ortgang (Windsog-Randzone, Montagerand), gemessen im Grundriss. Üblich 0,4–0,5 m.">Rand Schrägdach (m)</div>
          ${zahlFeld('randabstand', v.randabstand, 0, 2, 0.05, 'Randabstand auf Schrägdächern')}</div>
        <div class="inp-group"><div class="inp-label" title="Abstand der aufgeständerten Module zur Dachkante bzw. Attika (Windsog-Randzone, Absturzsicherung). Üblich 1,0 m, ohne feste Absturzsicherung eher 1,5–2 m.">Rand Flachdach (m)</div>
          ${zahlFeld('randFlach', v.randFlach, 0, 3, 0.1, 'Randabstand auf Flachdächern und flachen Dachflächen')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
        <div class="inp-group"><div class="inp-label" title="Modullage auf Schrägdächern. Flachdächer: Module quer auf der Aufständerung.">Lage</div>
          <select class="inp-field" style="padding:2px 4px;" data-change="pvmRegel('modulLage',this.value)">
            <option value="hoch"${v.modulLage !== 'quer' ? ' selected' : ''}>hoch</option>
            <option value="quer"${v.modulLage === 'quer' ? ' selected' : ''}>quer</option>
          </select></div>
        <div class="inp-group"><div class="inp-label" title="Dachflächen bzw. Satteldachseiten mit weniger Modulen bleiben leer (lohnt nicht). 0 = aus.">Min. Mod.</div>
          ${zahlFeld('mindestModule', v.mindestModule, 0, 100, 1, 'Mindestzahl Module je Dachfläche bzw. Satteldachseite')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:4px;">
        <div class="inp-group"><div class="inp-label" title="Flachdach: nach so vielen Metern Modulreihen folgt ein Wartungsgang quer zu den Reihen (bei Ost-West zwischen zwei Doppelreihen). Üblich 10–15 m. 0 = keine Gänge.">Gang alle (m)</div>
          ${zahlFeld('gangAlle', v.gangAlle, 0, 100, 1, 'Abstand der Wartungsgänge auf Flachdächern')}</div>
        <div class="inp-group"><div class="inp-label" title="Breite der Wartungsgänge und der Gassen zwischen den Feldern. Üblich 0,6–1,0 m, als Feuerwehrgasse 1 m.">Gangbreite (m)</div>
          ${zahlFeld('gangBreite', v.gangBreite, 0, 3, 0.1, 'Breite von Wartungsgang und Feldgasse')}</div>
        <div class="inp-group"><div class="inp-label" title="Flachdach: Modulfelder entlang der Reihen höchstens so lang, dazwischen eine Gasse in Gangbreite (Brandschutz-Empfehlung ca. 40 m). 0 = keine Feldgrenzen.">Feld max. (m)</div>
          ${zahlFeld('feldMax', v.feldMax, 0, 200, 5, 'Größte Feldlänge auf Flachdächern')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:4px;">
        <div class="inp-group"><div class="inp-label" title="Neigung der Süd-Aufständerung auf Flachdächern: bestimmt Ertragsfaktor (15° ≈ 96 %, 30° = 100 %) und Standard-Ausnutzung (15° → 55 %, 30° → 40 %). Heute üblich 10–15°. Ost-West rechnet mit 10°.">Süd-Aufst. (°)</div>
          ${zahlFeld('flachNeigung', v.flachNeigung, 5, 45, 5, 'Neigung der Süd-Aufständerung')}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;">Abschläge vom technischen Potenzial (%)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:2px;">
        <div class="inp-group"><div class="inp-label" title="Pauschal für Lichtkuppeln, RWA, Lüfter, Technikaufbauten auf Flachdächern — entfällt an Gebäuden mit Haken „Hindernisse erfasst“. Üblich 15–25 %.">Hindernis flach</div>
          ${zahlFeld('hindernisFlach', ab.hindernisFlach, 0, 100, 5, 'Pauschaler Hindernisabschlag auf Flachdächern')}</div>
        <div class="inp-group"><div class="inp-label" title="Pauschal für Gauben, Dachfenster, Schornsteine (mit Weg für den Schornsteinfeger) auf Schrägdächern. Üblich 10–15 %.">Hindernis schräg</div>
          ${zahlFeld('hindernisSchraeg', ab.hindernisSchraeg, 0, 100, 5, 'Pauschaler Hindernisabschlag auf Schrägdächern')}</div>
        <div class="inp-group"><div class="inp-label" title="Wirtschaftliches Potenzial: nur Anlagen ab dieser Größe (realisierbar je Gebäude).">Mindestanlage (kWp)</div>
          ${zahlFeld('minAnlageKwp', ab.minAnlageKwp, 0, 1000, 1, 'Kleinste Anlage im wirtschaftlichen Potenzial')}</div>
        ${PV_KENNZEICHEN.map(k => `<div class="inp-group"><div class="inp-label" title="Abschlag für Gebäude mit dem Kennzeichen „${k.label}“: ${k.titel} 100 % = Dach fällt heraus.">${k.kurz}</div>
          ${zahlFeld('kz:' + k.key, ab.kennzeichen[k.key], 0, 100, 5, `Abschlag bei ${k.label}`)}</div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35;">Ändert sofort die Module aller belegten Dächer; das kWp der PV-Assets wird nachgezogen.</div>`;
}

/** Regel ändern, die für alle Dächer gilt. */
export function pvmRegel(feld, wert) {
  const v = _vorgabe();
  const zahl = parseFloat(String(wert).replace(',', '.'));
  _regelAufAlle(() => {
    if (feld === 'modulLage') v.modulLage = wert === 'quer' ? 'quer' : 'hoch';
    else if (feld === 'randabstand') v.randabstand = Number.isFinite(zahl) ? Math.max(0, Math.min(2, zahl)) : 0.4;
    else if (feld === 'randFlach')   v.randFlach   = Number.isFinite(zahl) ? Math.max(0, Math.min(3, zahl)) : 1.0;
    else if (feld === 'gangAlle')    v.gangAlle    = Number.isFinite(zahl) ? Math.max(0, Math.min(100, zahl)) : 12;
    else if (feld === 'gangBreite')  v.gangBreite  = Number.isFinite(zahl) ? Math.max(0, Math.min(3, zahl)) : 1.0;
    else if (feld === 'feldMax')     v.feldMax     = Number.isFinite(zahl) ? Math.max(0, Math.min(200, zahl)) : 40;
    else if (feld === 'flachNeigung') {
      // Süd-Dächer mit der bisherigen Standard-Ausnutzung ziehen auf die neue nach
      const altStd = pvGcrStandard('sued');
      v.flachNeigung = Number.isFinite(zahl) ? Math.max(5, Math.min(45, zahl)) : 15;
      const neuStd = pvGcrStandard('sued');
      for (const g of window.gebaeude || []) {
        if (g.pvFlAusrichtung !== 'ostwest' && !g._pvFlGcrManual && g.pvFlGcr === altStd) g.pvFlGcr = neuStd;
      }
    }
    else if (feld === 'hindernisFlach' || feld === 'hindernisSchraeg') v[feld] = Number.isFinite(zahl) ? Math.max(0, Math.min(100, zahl)) : null;
    else if (feld === 'minAnlageKwp') v.minAnlageKwp = Number.isFinite(zahl) ? Math.max(0, zahl) : null;
    else if (feld.startsWith('kz:')) v.kennzeichen = { ...(v.kennzeichen || {}), [feld.slice(3)]: Number.isFinite(zahl) ? Math.max(0, Math.min(100, zahl)) : null };
    else if (feld === 'mindestModule') v.mindestModule = Number.isFinite(zahl) ? Math.max(0, Math.min(100, Math.round(zahl))) : 0;
    else {
      const id = { modulBreite: 'pv-modul-breite', modulLaenge: 'pv-modul-laenge', modulWp: 'pv-modul-wp' }[feld];
      const el = id && document.getElementById(id);
      if (!el || !Number.isFinite(zahl) || zahl <= 0) return;
      const art = { modulBreite: 'breite', modulLaenge: 'laenge', modulWp: 'wp' }[feld];
      el.value = pvModulMassKorrigieren(art, zahl);   // „1050" → 1,05 m; Grenzen des Feldes
      window.onPvModulChange?.();          // Freiflächen, Modul-Info im Gebäude-PV-Panel
    }
  });
}

/**
 * Eingabefelder der Vorgaben — im PV-Modus-Panel und in „Dächer automatisch belegen" (36),
 * dieselben Werte (window.pvModusVorgabe), dieselben Handler.
 */
export function pvmVorgabeFelderHtml() {
  const v = _vorgabe();
  const flachAuto = _vorgabeGcr({ ...v, gcr: null });
  return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <div class="inp-group">
          <div class="inp-label">Dachform</div>
          <select class="inp-field" data-change="pvmVorgabe('dachform',this.value)">
            ${Object.entries(DACHFORMEN).map(([w, l]) =>
              `<option value="${w}"${v.dachform === w ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="inp-group">
          <div class="inp-label" title="Leer = Standard der Dachform">Neigung (°)</div>
          <input class="inp-field" type="number" min="0" max="75" step="5" value="${v.neigung ?? ''}"
            placeholder="${getDachDefaultNeigung(v.dachform)}" data-change="pvmVorgabe('neigung',this.value)"/>
        </div>
      </div>
      ${_regler({ label:'Belegungsgrad (%)', titel:'Vorgabe für neu belegte Dächer. ' + PV_BELEGUNGSGRAD_TITEL, min:40, max:100, step:5,
                  wert: v.belegung, farbe:GELB, einheit:'%', handler:`pvmVorgabe('belegung',this.value)` })}
      <div style="display:flex;align-items:center;gap:5px;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:4px;flex:1;font-size:12px;cursor:pointer;"
          title="Dachseiten mit zu geringem Ertrag frei lassen: beim Satteldach wird die nördliche Hälfte als Sperrfläche ausgespart, LoD2-Dachflächen werden gar nicht erst belegt">
          <input type="checkbox" ${v.nordSperr ? 'checked' : ''} style="accent-color:${ROT};cursor:pointer;"
            data-change="pvmVorgabe('nordSperr',this.checked)"/>Nordseiten aussparen unter
        </label>
        <input class="inp-field" type="number" min="40" max="95" step="5" value="${v.ertragMin}"
          title="Ertragsschwelle: Anteil am bestmöglichen Ertrag (Süd, ~30°). Ausrichtung UND Neigung zählen — ein flaches Norddach erreicht mehr als ein steiles."
          style="width:52px;padding:2px 4px;" data-change="pvmVorgabe('ertragMin',this.value)"/>
        <span style="font-size:11px;color:var(--muted);">% Ertrag</span>
      </div>
      ${v.nordSperr ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.35;">${_schwelleText(15)} · ${_schwelleText(35)} · ${_schwelleText(45)}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;">
        <div class="inp-group">
          <div class="inp-label" title="Aufständerung auf Flachdächern (und flachen LoD2-Dachflächen)">Flachdach</div>
          <select class="inp-field" data-change="pvmVorgabe('ausrichtung',this.value)">
            <option value="sued"${v.ausrichtung !== 'ostwest' ? ' selected' : ''}>Süd aufgeständert</option>
            <option value="ostwest"${v.ausrichtung === 'ostwest' ? ' selected' : ''}>Ost-West</option>
          </select>
        </div>
        <div class="inp-group">
          <div class="inp-label" title="Anteil der Modulfläche an der Flachdachfläche (GCR). Leer = Standard der Aufständerung: Süd nach Neigung (15° → 55 %, Reihenabstand gegen Eigenverschattung), Ost-West 85 %.">Ausnutzung (%)</div>
          <input class="inp-field" type="number" min="5" max="95" step="5" value="${v.gcr ?? ''}" placeholder="${flachAuto}"
            data-change="pvmVorgabe('gcr',this.value)"/>
        </div>
      </div>`;
}

function _listenBlock() {
  const alle  = _mitPolygon();
  const mitPv = alle.filter(_hasBelegung);
  const offen = alle.filter(g => !_hasBelegung(g));
  const summe = mitPv.reduce((s, g) => s + (calcGebKwpKorr(g) || 0), 0);
  const aktiv = window.pvModusGeb;
  const zeigeOffen = window.pvModusListe === 'offen';
  const liste = zeigeOffen ? offen : mitPv;

  const zeilen = liste.map(g => `
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;cursor:pointer;
         ${g.id === aktiv ? 'color:' + GELB + ';' : 'color:var(--text);'}"
         data-click="pvmWaehle(${g.id})" title="Auf der Karte zeigen und hier bearbeiten">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(_name(g))}</span>
      ${zeigeOffen
        ? `<span style="font-family:'DM Mono',monospace;color:var(--muted);">${(+g.flaeche || 0).toFixed(0)} m²</span>`
        : `<span style="font-family:'DM Mono',monospace;">${(calcGebKwpKorr(g) || 0).toFixed(1)}</span>`}
    </div>`).join('');

  const tab = (wert, text, an) => `<button class="btn-xs" style="flex:1;${an ? `border-color:${GELB};color:${GELB};` : ''}"
      data-click="pvmListe('${wert}')">${text}</button>`;

  return `
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px;">
      <div style="display:flex;gap:4px;margin-bottom:4px;">
        ${tab('mit',   `mit Fläche (${mitPv.length})`, !zeigeOffen)}
        ${tab('offen', `offen (${offen.length})`,      zeigeOffen)}
      </div>
      <div style="max-height:150px;overflow-y:auto;">
        ${zeilen || `<div style="font-size:12px;color:var(--muted);padding:2px 0;">${zeigeOffen ? '✓ Kein Dach mehr offen.' : 'Noch nichts gezeichnet.'}</div>`}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:5px;padding-top:4px;border-top:1px solid var(--border);">
        <span style="color:var(--muted);">Σ ${mitPv.length} Dächer${offen.length ? ` · ${offen.length} offen` : ''}</span>
        <span style="color:${GELB};font-weight:600;font-family:'DM Mono',monospace;">${summe.toFixed(0)} kWp</span>
      </div>
    </div>`;
}

function _html() {
  const g     = _geb(window.pvModusGeb);
  const typ   = window.pvModusTyp || 'belegung';
  const form  = window.pvModusForm || 'polygon';
  const sperr = typ === 'sperr';
  const ziele = _stapelZiele().length;
  const offen = _offeneDaecher().length;

  const knopf = (aktiv, farbe, handler, text, titel) =>
    `<button class="btn-xs" style="flex:1;${aktiv ? `border-color:${farbe};color:${farbe};background:${farbe}1f;` : ''}"
      data-click="${handler}" title="${titel}">${text}</button>`;

  return `
    <div class="pvm-head"${sperr ? ` style="border-bottom-color:${ROT};"` : ''}>
      <span class="pvm-head-title"${sperr ? ` style="color:${ROT};"` : ''}>${sperr ? 'Sperrflächen' : 'PV-Modus'}</span>
      <button class="btn-xs" data-click="pvmHilfeToggle()" title="Kurzanleitung ein-/ausblenden">?</button>
      <button class="btn-xs" data-click="pvModusStop()" title="Modus beenden (Esc)">✓ Fertig</button>
    </div>
    <div class="pvm-body">
      <div style="display:flex;gap:4px;">
        ${knopf(!sperr, GELB, "pvModusSetTyp('belegung')", 'Belegung', 'Taste B')}
        ${knopf(sperr,  ROT,  "pvModusSetTyp('sperr')",    'Sperrfläche', 'Taste S')}
      </div>
      <div style="display:flex;gap:4px;margin-top:4px;">
        ${knopf(form === 'polygon',  '#80deea', "pvmSetForm('polygon')",  '✎ Polygon',  'Ecken einzeln klicken · Taste R wechselt')}
        ${knopf(form === 'rechteck', '#80deea', "pvmSetForm('rechteck')", '▭ Rechteck', 'Zwei Klicks, am First ausgerichtet · Taste R wechselt')}
      </div>
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn-xs" style="flex:1;" data-click="pvmNaechstesOffenes()"
          title="Zum nächstgelegenen Dach ohne Fläche springen (Taste N)">→ Nächstes offenes${offen ? ` (${offen})` : ''}</button>
        <button class="btn-xs" data-click="pvmUndo()" title="Letzten Schritt zurücknehmen (Strg+Z)">↶</button>
      </div>
      ${ziele
        ? `<button class="btn-xs" style="width:100%;margin-top:4px;border-color:${GELB};color:${GELB};"
             data-click="pvmGrundrissAuswahl()"
             title="Für jedes ausgewählte Dach ohne Fläche den Grundriss als Belegungsfläche übernehmen">Grundriss für ${ziele} ausgewählte Dächer</button>`
        : `<div style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.4;">
             Stapelweise: Gebäude in der Liste oder Gebäudetabelle ankreuzen (dort filtern) — dann erscheint hier „Grundriss für die Auswahl".
           </div>`}
      ${window.pvabBlockHtml?.() || ''}
      ${window.pvbsBlockHtml?.() || ''}
      ${window.verschattungBlockHtml?.() || ''}
      ${window.pvAnschlussHinweisHtml?.() || ''}
      <div style="margin-top:8px;">${_aktivBlock(g)}</div>
      ${_vorgabeBlock()}
      ${_listenBlock()}
      ${window.pvModusHilfe ? `
      <div style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.45;">
        Dach anklicken = erste Ecke · roter Startpunkt = abschließen · Rechtsklick = Ecke zurück ·
        Esc = Zeichnung abbrechen, nochmal = Modus beenden · Strg+Z = Schritt zurück.
        Die Fläche gehört dem Dach, auf dem sie liegt; das kWp geht sofort ins PV-Asset.
      </div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL-HANDLER — rufen die bestehenden Handler und rendern danach neu
// ══════════════════════════════════════════════════════════════════════════

export function pvmDach(gId, feld, wert) {
  const g = _geb(gId);
  if (feld === 'dachform' && g) g._pvDachformManuell = true;
  const hatteNord = !!g && _autoNordFlaechen(g).length > 0;
  window.updateGebDach?.(gId, feld, wert);
  // Dreht sich der First (Azimut) oder wechselt die Dachform, liegt eine
  // automatisch ausgesparte Nordseite nicht mehr an der Firstlinie — neu
  // ableiten statt eine schiefe Sperrfläche stehen zu lassen. Das gilt auch,
  // wenn sie zwischendurch nur deshalb verschwunden war, weil keine Seite im
  // Nordsektor lag; nur ein bewusstes „freigeben" schaltet sie für das Dach ab.
  const nachziehen = hatteNord || (_vorgabe().nordSperr && !g?._pvNordFrei);
  // Die Ertragsschwelle hängt auch an der Neigung (ein flaches Norddach bleibt belegt)
  if (g && nachziehen && _hasBelegung(g) && (feld === 'dachAzimut' || feld === 'dachform' || feld === 'dachNeigung')) {
    _nordAnwenden(g);
    _uebernehmen(g);
    window._rerenderCard?.(gId);
    window._updateGebLabelPv?.(gId);
    window.calcStromPanel?.();
  }
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvmFl(gId, feld, wert) {
  window.updateGebPvFl?.(gId, feld, wert);
  pvModusRender();
}

export function pvmAzimutAuto(gId) {
  window.ermittleAzimut?.(gId);
  pvModusRender();
}

export function pvmFirst(gId) {
  window.startGebFirstDraw?.(gId);
}

export function pvmFirstReset(gId) {
  window.resetGebFirst?.(gId);
  pvModusRender();
}

export function pvmFlaecheWeg(gId, flId) {
  const g = _geb(gId);
  // Wer die automatische Nord-Sperrfläche löscht, will die Nordseite belegen.
  if (g && (g.pvFlaechen || []).some(f => f.id === flId && f.auto === 'nord')) g._pvNordFrei = true;
  window.removeGebPvFlaeche?.(gId, flId);
  if (g && _hasBelegung(g)) _uebernehmen(g);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvmWaehle(gId) {
  window.pvModusGeb = gId;
  flyTo(gId);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvmListe(wert) {
  window.pvModusListe = wert === 'offen' ? 'offen' : 'mit';
  pvModusRender();
}

export function pvmHilfeToggle() {
  window.pvModusHilfe = !window.pvModusHilfe;
  pvModusRender();
}

export function pvmVorgabeToggle() {
  window.pvModusVorgabeOffen = !window.pvModusVorgabeOffen;
  pvModusRender();
}

export function pvmVorgabe(feld, wert) {
  const v = _vorgabe();
  if (feld === 'dachform')        v.dachform = wert;
  else if (feld === 'belegung')   v.belegung = Math.min(100, parseFloat(wert) || 90);
  else if (feld === 'neigung')    v.neigung  = wert === '' ? null : parseFloat(wert);
  else if (feld === 'nordSperr')  v.nordSperr = !!wert;
  else if (feld === 'ertragMin')  v.ertragMin = Math.max(40, Math.min(95, parseFloat(wert) || 75));
  else if (feld === 'ausrichtung') v.ausrichtung = wert === 'ostwest' ? 'ostwest' : 'sued';
  else if (feld === 'gcr')        v.gcr = wert === '' || wert == null ? null : Math.max(5, Math.min(95, parseFloat(wert) || 40));
  pvModusRender();
}

// Felder, die „Vorgaben übertragen" ändert — Momentaufnahme für Strg+Z
const _UEBERTRAG_FELDER = ['dachform', 'dachNeigung', 'pvFlBelegung', 'pvFlGcr', 'pvFlAusrichtung', '_pvFlGcrManual', 'pvFlManuell'];
const _flKlon = fls => (fls || []).map(f => {
  const k = {};
  for (const [s, x] of Object.entries(f)) if (s !== 'layer' && s !== 'svgLayer') k[s] = x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x;
  return { ...k, layer: null, svgLayer: null };
});

/**
 * Vorgaben auf die belegten Dächer übertragen (Sammelkorrektur). Geschützt sind
 * echte Dachdaten (LoD2, OSM, berechnete Dachflächen) und — ohne den Haken „auch
 * Dächer mit eigenen Angaben" — von Hand eingestellte Werte: Dachform/Neigung
 * (dachQuelle 'manuell') bzw. Belegungsgrad/Ausnutzung (pvFlManuell).
 * Ein Strg+Z-Schritt im PV-Modus.
 */
export function pvmVorgabeAufAlle() {
  const v = _vorgabe();
  const ue = _uebertrag();
  const ziele = _mitPolygon().filter(g => _hasBelegung(g) && (ue.umfang !== 'auswahl' || g.selected));
  if (!ziele.length) { alert(ue.umfang === 'auswahl' ? 'Keines der ausgewählten Gebäude hat eine Belegungsfläche.' : 'Es gibt noch kein Dach mit Belegungsfläche.'); return; }
  const dachDarf = g => !g.dachFlaechen?.length && (!g.dachQuelle || (ue.auchEigene && g.dachQuelle === 'manuell'));
  const flDarf = g => ue.auchEigene || !g.pvFlManuell;
  const nDach = ziele.filter(dachDarf).length, nFl = ziele.filter(flDarf).length;
  const echteDaten = ziele.filter(g => g.dachFlaechen?.length || (g.dachQuelle && g.dachQuelle !== 'manuell')).length;
  if (!nDach && !nFl) {
    alert(`Alle ${ziele.length} Dächer haben eigene Angaben — es gibt nichts zu übertragen.\n\nMit dem Haken „auch Dächer mit eigenen Angaben" werden von Hand eingestellte Werte überschrieben.`);
    return;
  }
  if (!confirm(`Vorgaben auf ${ziele.length} belegte Dächer übertragen?\n\n`
      + `• Dachform „${DACHFORMEN[v.dachform]}"${v.neigung != null ? `, Neigung ${v.neigung}°` : ''}: ${nDach} Dächer`
      + (ziele.length - nDach ? ` (${ziele.length - nDach} behalten ihr Dach${echteDaten ? `, davon ${echteDaten} mit LoD2-/OSM-/berechneten Dachdaten` : ''})` : '') + '\n'
      + `• Belegungsgrad ${v.belegung} %, Flachdach ${v.ausrichtung === 'ostwest' ? 'Ost-West' : 'Süd'} mit ${_vorgabeGcr(v)} % Ausnutzung: ${nFl} Dächer`
      + (ziele.length - nFl ? ` (${ziele.length - nFl} mit eigenen Werten bleiben)` : '') + '\n'
      + (v.nordSperr ? `• Satteldächer: Nordseite nach der Ertragsschwelle (${v.ertragMin} %) neu abgeleitet\n` : '') + '\n'
      + 'Azimut und gezeichnete Flächen bleiben unverändert. Strg+Z nimmt den Schritt zurück.')) return;

  const schritt = [];
  _stapelLaeuft = true;
  try {
    for (const g of ziele) {
      const dach = dachDarf(g), fl = flDarf(g);
      if (!dach && !fl) continue;
      const alt = {};
      for (const k of _UEBERTRAG_FELDER) alt[k] = g[k];
      schritt.push({ gId: g.id, alt, pvFlaechen: _flKlon(g.pvFlaechen) });
      const formVorher = g.dachform;
      if (dach) {
        g.dachform = v.dachform;
        if (v.neigung != null) g.dachNeigung = v.neigung;
      }
      if (fl) {
        g.pvFlBelegung = v.belegung;
        g._pvFlGcrManual = false;
        g.pvFlManuell = false;
        _flachVorgabe(g, v);
      }
      // Nordseite nach der aktuellen Ertragsschwelle neu ableiten (auch ohne neue
      // Dachform — so kommt eine geänderte Schwelle auf schon belegte Dächer)
      if (g.dachform !== formVorher || g.dachform === 'sattel') pvmNordNachziehen(g);
      redrawGebPvModules(g);
      _uebernehmen(g);
      window._rerenderCard?.(g.id);
      window._updateGebLabelPv?.(g.id);
    }
  } finally { _stapelLaeuft = false; }
  if (schritt.length) _verlaufMerken({ felder: schritt });
  window.pvuNachlauf?.();
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.d3dNachViz?.();
  window.showHint?.(`${schritt.length} Dächer angeglichen. Strg+Z nimmt den Schritt zurück.`, 5000);
  pvModusMarkiereKarte();
  pvModusRender();
}

/** Strg+Z für „Vorgaben übertragen": Felder und Flächen der Dächer zurück. */
function _felderZurueck(schritt) {
  const geaendert = [], vorher = new Map();
  for (const { gId, alt, pvFlaechen } of schritt) {
    const g = _geb(gId);
    if (!g) continue;
    vorher.set(g.id, { pvFlaechen: g.pvFlaechen });
    for (const k of _UEBERTRAG_FELDER) { if (alt[k] === undefined) delete g[k]; else g[k] = alt[k]; }
    g.pvFlaechen = _flKlon(pvFlaechen);
    g._pvModCache = null; g._pvModSig = null;
    geaendert.push(g);
  }
  window.variantenPvNeuZeichnen?.(geaendert, vorher);
  for (const g of geaendert) {
    if (_hasBelegung(g)) window.pvuFixOne?.(g.id, { ohneNachlauf: true });
    window._rerenderCard?.(g.id);
  }
  window.pvuNachlauf?.();
  window.calcStromPanel?.();
  window.d3dNachViz?.();
  window.showHint?.(`↶ Vorgaben auf ${geaendert.length} Dächern zurückgenommen.`, 3000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// DACHFLÄCHEN EINZELN — für die 3D-Ansicht (32): anklicken, belegen, freilassen
// ══════════════════════════════════════════════════════════════════════════
// Die 3D-Ansicht kennt die Dachflächen nur als Geometrie; was eine Fläche im
// Datenmodell ist, entscheidet dieser Abschnitt. Schlüssel einer Fläche:
//   'df:<id>'    Dachfläche aus g.dachFlaechen (LoD2 oder aus dem Grundriss berechnet)
//   'fg:<id>'    Flügel-Dachfläche, die nur die Ansicht zeigt (32 d3dFluegelGebaeude) —
//                beim Belegen werden die Flügel-Dachflächen ins Gebäude übernommen
//   'seite:<az>' Satteldachhälfte ohne Dachflächen (Azimut der Fläche in Grad)
//   'dach'       das ganze Dach (Flach-, Pult-, Walmdach ohne Dachflächen)
// Belegen/Freilassen läuft als Planungsschritt (Strg+Z im PV-Modus holt Flächen,
// PV-Assets und Kabel zurück).

// Sperrflächen, die eine ganze Satteldachhälfte freihalten (Nordseite, von Hand, Verschattung)
const _SEITEN_AUTO = new Set(['nord', 'seite', 'schatten']);
const _winkelAbstand = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };

/** Firstlinie wie in der Modulplatzierung (03c): Azimut A, Punkt C, cos(Breite). */
function _first(g) {
  const bel = (g.pvFlaechen || []).filter(f => f.typ !== 'sperr' && f.polygon?.length >= 3);
  const alle = bel.length ? bel.flatMap(f => f.polygon) : (g.polygon || []);
  if (alle.length < 3) return null;
  const maxLat = Math.max(...alle.map(p => p.lat)), minLat = Math.min(...alle.map(p => p.lat));
  const A = g.dachAzimut ?? 180;
  return { A, C: pvFirstPunkt(g, A, alle), cosL: Math.cos((maxLat + minLat) / 2 * Math.PI / 180) };
}

/** Liegt der Punkt auf der Vorderseite (Azimut A) des Firsts? */
function _vorne(f, p) {
  const Ar = f.A * Math.PI / 180;
  return Math.sin(Ar) * (p.lng - f.C.lng) * f.cosL + Math.cos(Ar) * (p.lat - f.C.lat) > 0;
}

/** Seitensperren des Dachs, je mit Seite. */
function _seitenSperren(g) {
  const f = _first(g);
  if (!f) return [];
  // Nord-Sperre: die nördlichere Hälfte (wie 03c), die übrigen nach ihrer Lage
  const nordVorne = pvNordHaelfteVorne(f.A);
  return (g.pvFlaechen || []).filter(fl => fl.typ === 'sperr' && _SEITEN_AUTO.has(fl.auto) && fl.polygon?.length >= 3)
    .map(fl => ({ fl, vorne: fl.auto === 'nord' && nordVorne !== null ? nordVorne : _vorne(f, _polyCentroidLL(fl.polygon)) }));
}

function _flaecheEntfernen(g, fl) {
  if (fl.layer) map.removeLayer(fl.layer);
  if (fl.svgLayer) map.removeLayer(fl.svgLayer);
  g.pvFlaechen = (g.pvFlaechen || []).filter(f => f !== fl);
}

/** Alle Flächen und das PV-Asset des Dachs entfernen (innerhalb einer Planungstransaktion). */
function _dachLeeren(g) {
  for (const fl of [...(g.pvFlaechen || [])]) _flaecheEntfernen(g, fl);
  g.pvAktiv = false;
  redrawGebPvModules(g);
  const weg = () => { for (const a of getAssetsForBuilding(g.id).filter(x => x.type === 'PV')) deleteAsset(a.id, true); };
  (window.stromRecalcAufschieben || (fn => fn()))(weg);   // Netz einmal statt je Kabel und Knoten
}

/** Satteldachhälfte als Sperrfläche (auto 'seite'), an derselben Firstlinie wie die Platzierung. */
function _seiteSperren(g, vorne) {
  const f = _first(g);
  if (!f) return;
  for (const bel of (g.pvFlaechen || []).filter(x => x.typ !== 'sperr' && x.polygon?.length >= 3)) {
    const h = _clipPolyHalfPlane(bel.polygon, f.C, f.A, f.cosL, vorne);
    if (h.length < 3) continue;
    const fl = _flaecheAnhaengen(g, h, 'sperr', false);
    fl.auto = 'seite';
  }
}

function _seiteFreigeben(g, vorne) {
  for (const { fl, vorne: v } of _seitenSperren(g)) {
    if (v !== vorne) continue;
    if (fl.auto === 'nord') g._pvNordFrei = true;      // bewusst belegt — beim Drehen nicht zurückholen
    _flaecheEntfernen(g, fl);
  }
}

/** Dachfläche (LoD2/berechnet bzw. Flügel der Ansicht) zum Schlüssel. */
function _dachflaecheZu(g, key) {
  const [art, id] = [key.slice(0, 2), +key.slice(3)];
  if (art === 'df') return (g.dachFlaechen || []).find(f => f.id === id) || null;
  if (art === 'fg') return (window.d3dFluegelGebaeude?.(g)?.dachFlaechen || []).find(f => f.id === id) || null;
  return null;
}

function _himmelsrichtung(az) {
  if (az == null) return '';
  return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

/**
 * Was die 3D-Ansicht zu einer angeklickten Dachfläche zeigt.
 * @returns {null | {gId:number, key:string, name:string, art:string, azimut:number|null, neigung:number,
 *   flaecheM2:number, grundM2:number, belegt:boolean, module:number, kwp:number, ertragPct:number,
 *   schattenPct:number|null, dachBelegt:boolean, zerlegbar:boolean, hinweis:string}}
 */
export function pvmDachflaecheInfo(gId, key) {
  const g = _geb(gId);
  if (!g || !key) return null;
  const wp = _modulMasse().wp;
  const dachBelegt = _hasBelegung(g);
  const res = dachBelegt ? getGebPvModules(g) : null;
  const schatten = k => {
    const s = window.pvVerschattungGruppe?.(g, k);
    return s && Number.isFinite(s.faktor) ? Math.round((1 - s.faktor) * 1000) / 10 : null;
  };
  const ertrag = (azimut, neigung) => Math.round(100 * (neigung < FLACH_BIS_GRAD || azimut == null
    ? getPvKorrFaktor({ dachform: 'flach', pvFlAusrichtung: g.pvFlAusrichtung || _vorgabe().ausrichtung })
    : getPvKorrFaktor({ dachform: 'sattel', dachAzimut: ((azimut % 360) + 360) % 360, dachNeigung: neigung })));
  const basis = { gId: g.id, key, name: _name(g), dachBelegt, hinweis: '',
    zerlegbar: !g.dachFlaechen?.length && ['sattel', 'walm'].includes(g.dachform || 'sattel') && g.dachQuelle !== 'lod2' };
  const abriss = pvnaAbrissGeplant(g) ? `Abrissjahr ${g.abrissjahr} — keine PV.` : '';

  if (key.startsWith('bf:')) {
    const fl = (g.pvFlaechen || []).find(f => f.id === +key.slice(3) && f.typ === 'belegung');
    if (!fl) return null;
    const module = res ? res.modules.filter(m => m.flId === fl.id).length : 0;
    return { ...basis, art: fl.dachFlaecheId != null ? 'Belegungsfläche (auf einer Dachfläche)' : 'Belegungsfläche', belegId: fl.id,
      azimut: fl.azimut ?? null, neigung: fl.neigung ?? 0, flaecheM2: fl.flaeche || polygonAreaM2(fl.polygon) || 0, grundM2: fl.flaeche || 0,
      belegt: true, module, kwp: module * wp / 1000, ertragPct: 0, schattenPct: null, zerlegbar: false,
      hinweis: 'Ecken ziehen ändert die Fläche; Module und kWp folgen. Strg+Z bzw. ↶ nimmt es zurück.' };
  }
  if (key.startsWith('sp:')) {
    const fl = (g.pvFlaechen || []).find(f => f.id === +key.slice(3) && f.typ === 'sperr');
    if (!fl) return null;
    return { ...basis, art: 'Sperrfläche (von Hand)', sperrId: fl.id, azimut: null, neigung: 0,
      flaecheM2: fl.flaeche || polygonAreaM2(fl.polygon) || 0, grundM2: fl.flaeche || 0, belegt: false,
      module: 0, kwp: 0, ertragPct: 0, schattenPct: null, zerlegbar: false,
      hinweis: 'Hält Module fern (Kamin, Gaube, Dachfenster …). Fläche im Grundriss gemessen.' };
  }
  if (key.startsWith('df:') || key.startsWith('fg:')) {
    const f = _dachflaecheZu(g, key);
    if (!f) return null;
    const fls = (g.pvFlaechen || []).filter(fl => fl.typ === 'belegung' && key.startsWith('df:') && fl.dachFlaecheId === f.id);
    const ids = new Set(fls.map(fl => fl.id));
    const module = res ? res.modules.filter(m => ids.has(m.flId)).length : 0;
    const steil = f.neigung > 75;
    const ausGrundriss = key.startsWith('fg:') || g.dachLod2?.quelle === 'grundriss';
    return { ...basis, art: ausGrundriss ? 'Dachfläche (aus dem Grundriss)' : 'Dachfläche (LoD2)',
      azimut: f.neigung < FLACH_BIS_GRAD ? null : f.azimut, neigung: f.neigung, flaecheM2: f.flaecheM2 ?? f.grundM2 ?? 0, grundM2: f.grundM2 ?? 0,
      belegt: fls.length > 0, module, kwp: module * wp / 1000, ertragPct: ertrag(f.azimut, f.neigung),
      schattenPct: fls.length ? schatten('fl' + fls[0].id) : null, zerlegbar: false,
      hinweis: abriss || (steil ? 'Sehr steil (über 75°) — eher Wand als Dach.' : '') };
  }
  const grundM2 = polygonAreaM2(g.polygon || []) || 0;
  const neigung = g.dachNeigung ?? getDachDefaultNeigung(g.dachform || 'sattel');
  if (key.startsWith('seite:')) {
    const az = +key.slice(6);
    const fi = _first(g);
    const vorne = dachBelegt && fi ? _winkelAbstand(az, fi.A) < 90 : true;
    const gesperrt = _seitenSperren(g).some(s => s.vorne === vorne);
    const module = res && res.frontCount != null ? (vorne ? res.frontCount : res.backCount) : 0;
    const azimut = dachBelegt && fi ? (vorne ? fi.A : (fi.A + 180) % 360) : az;
    return { ...basis, art: 'Satteldachseite', azimut, neigung,
      flaecheM2: grundM2 / 2 / Math.cos(neigung * Math.PI / 180), grundM2: grundM2 / 2,
      belegt: dachBelegt && !gesperrt, module, kwp: module * wp / 1000, ertragPct: ertrag(azimut, neigung),
      schattenPct: dachBelegt ? schatten(vorne ? 'vorne' : 'hinten') : null, hinweis: abriss };
  }
  const flach = !g.dachform || g.dachform === 'flach';
  const module = res ? res.count : 0;
  return { ...basis, art: flach ? 'Flachdach' : `${DACHFORMEN[g.dachform] || 'Dach'} (ganzes Dach)`,
    azimut: flach ? null : (g.dachAzimut ?? 180), neigung: flach ? 0 : neigung,
    flaecheM2: flach ? grundM2 : grundM2 / Math.cos(neigung * Math.PI / 180), grundM2,
    belegt: dachBelegt, module, kwp: module * wp / 1000, ertragPct: ertrag(flach ? null : (g.dachAzimut ?? 180), flach ? 0 : neigung),
    schattenPct: dachBelegt ? schatten('dach') : null,
    hinweis: abriss || (g.dachform === 'walm' && !g.dachFlaechen?.length
      ? 'Walmdach ohne Dachflächen wird als Ganzes belegt — „In Dachflächen zerlegen" erlaubt jede Fläche einzeln.' : '') };
}

/** Kurztext für die 3D-Ansicht: „S 180° · 35° · 42 m²". */
export function pvmDachflaecheKurz(i) {
  if (!i) return '';
  return `${i.azimut == null ? 'flach' : `${_himmelsrichtung(i.azimut)} ${Math.round(i.azimut)}°`} · ${Math.round(i.neigung)}° · ${Math.round(i.flaecheM2)} m²`;
}

/**
 * Nach einer Änderung aus der 3D-Ansicht: Dach, Karte, Panels und 3D sofort; Stromnetz,
 * Asset-Marker und Strompanel kurz danach und für mehrere schnelle Klicks nur einmal —
 * bei ~2.400 Gebäuden kosten sie zusammen ~7 s, die Gebäudeliste (zeigt kein kWp) weitere 2,4 s.
 */
function _nachDachflaeche(g) {
  window._rerenderCard?.(g.id);
  window._updateGebLabelPv?.(g.id);
  window.renderGebPvPanel?.();
  pvModusMarkiereKarte();
  pvModusRender();
  window.d3dNachViz?.();
  _netzSpaeter();
}

let _netzTimer = 0;
function _netzSpaeter() {
  clearTimeout(_netzTimer);
  window.showHint?.('Stromnetz wird nachgerechnet …', 0);
  _netzTimer = setTimeout(() => {
    _netzTimer = 0;
    if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();
    if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
    window.calcStromPanel?.();
    window.hideHint?.();
  }, 500);
}

function _alsPlanungsschritt(label, lauf) {
  try {
    if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction(label, lauf);
    else lauf();
  } catch (err) {
    console.error(err);
    alert(label + ' fehlgeschlagen: ' + err.message);
    return false;
  }
  pvmPlanungsSchrittMerken();
  return true;
}

/**
 * Eine Dachfläche belegen (an = true) oder freilassen. Belegen gilt nur für diese
 * Fläche — die übrigen Flächen eines leeren Dachs bleiben leer; „ganzes Dach nach
 * Regeln" ist pvmDachNachRegeln.
 * @returns {string|null} Schlüssel der Fläche danach (Flügel → Dachfläche) bzw. null bei Fehler
 */
export function pvmDachflaecheSetzen(gId, key, an) {
  const g = _geb(gId);
  if (!g || !key) return null;
  if (an && pvnaAbrissGeplant(g)) { alert(`„${_name(g)}" hat ein Abrissjahr (${g.abrissjahr}) — keine PV.`); return null; }
  let neuerKey = key;
  const ok = _alsPlanungsschritt(an ? 'PV-Dachfläche belegen' : 'PV-Dachfläche freilassen', () => {
    _stapelLaeuft = true;
    try {
      if (key.startsWith('fg:')) {
        // Flügel der Ansicht ins Gebäude übernehmen, dann wie eine Dachfläche
        if (!an) return;
        const d = window.dachAusGrundrissFuer?.(g);
        if (!d) throw new Error('Dachflächen aus dem Grundriss ließen sich nicht berechnen.');
        g.dachFlaechen = d.dachFlaechen; g.dachLod2 = d.lod2; g._pvModSig = null;
        neuerKey = 'df:' + key.slice(3);
      }
      if (neuerKey.startsWith('df:')) {
        const f = _dachflaecheZu(g, neuerKey);
        if (!f) throw new Error('Dachfläche nicht gefunden.');
        const fls = (g.pvFlaechen || []).filter(fl => fl.typ === 'belegung' && fl.dachFlaecheId === f.id);
        if (an) {
          if (fls.length) return;
          const leer = !_hasBelegung(g);
          const fl = _flaecheAnhaengen(g, f.punkte.map(q => ({ lat: q[0], lng: q[1] })), 'belegung', false);
          fl.azimut = f.azimut; fl.neigung = f.neigung; fl.dachFlaecheId = f.id;
          redrawGebPvModules(g);
          if (leer) _erstbelegung(g, 1);
        } else {
          for (const fl of fls) _flaecheEntfernen(g, fl);
          if (!_hasBelegung(g)) { _dachLeeren(g); return; }
          redrawGebPvModules(g);
        }
      } else if (key.startsWith('seite:')) {
        const az = +key.slice(6);
        if (an) {
          if (!_hasBelegung(g)) {
            // Ansicht und Platzierung sollen das Dach gleich teilen: ohne festen Azimut den der angeklickten Fläche
            if (g.dachAzimut == null || g.dachAutoAzimut) { g.dachAzimut = Math.round(az) % 360; g.dachAutoAzimut = true; }
            const fls = _grundriss(g);
            if (!fls.length) throw new Error('Dieses Gebäude hat keinen Grundriss.');
            _erstbelegung(g, fls.length);
            const vorne = _winkelAbstand(az, _first(g).A) < 90;
            _seiteFreigeben(g, vorne);
            if (!_seitenSperren(g).some(s => s.vorne === !vorne)) _seiteSperren(g, !vorne);
          } else {
            _seiteFreigeben(g, _winkelAbstand(az, _first(g).A) < 90);
          }
          redrawGebPvModules(g);
        } else {
          if (!_hasBelegung(g)) return;
          const vorne = _winkelAbstand(az, _first(g).A) < 90;
          if (!_seitenSperren(g).some(s => s.vorne === vorne)) _seiteSperren(g, vorne);
          const seiten = new Set(_seitenSperren(g).map(s => s.vorne));
          if (seiten.has(true) && seiten.has(false)) { _dachLeeren(g); return; }
          redrawGebPvModules(g);
        }
      } else if (an) {
        if (_hasBelegung(g)) return;
        const fls = _grundriss(g);
        if (!fls.length) throw new Error(g.dachFlaechen?.length ? 'Keine belegbare Dachfläche.' : 'Dieses Gebäude hat keinen Grundriss.');
        _erstbelegung(g, fls.length);
      } else {
        _dachLeeren(g);
        return;
      }
      if (_hasBelegung(g)) _uebernehmen(g);
    } finally { _stapelLaeuft = false; }
  });
  if (!ok) return null;
  _nachDachflaeche(g);
  return neuerKey;
}

/** Ganzes Dach nach den Belegungsregeln belegen (wie „Grundriss als Fläche"). */
export function pvmDachNachRegeln(gId) {
  const g = _geb(gId);
  if (!g) return;
  if (pvnaAbrissGeplant(g)) { alert(`„${_name(g)}" hat ein Abrissjahr (${g.abrissjahr}) — keine PV.`); return; }
  if (_hasBelegung(g) && !confirm(`„${_name(g)}" neu nach den Belegungsregeln belegen?\n\nDie bisherigen Flächen dieses Dachs werden ersetzt.`)) return;
  const ok = _alsPlanungsschritt('Dach nach Regeln belegen', () => {
    _stapelLaeuft = true;
    try {
      for (const fl of [...(g.pvFlaechen || [])]) _flaecheEntfernen(g, fl);
      delete g._pvNordFrei;
      const fls = _grundriss(g);
      if (!fls.length) throw new Error(g.dachFlaechen?.length ? 'Keine belegbare Dachfläche (zu klein, zu steil oder nach Norden).' : 'Dieses Gebäude hat keinen Grundriss.');
      _erstbelegung(g, fls.length);
      if (_hasBelegung(g)) _uebernehmen(g);
    } finally { _stapelLaeuft = false; }
  });
  if (ok) _nachDachflaeche(g);
}

/** Alle Flächen des Dachs entfernen (samt PV-Asset). */
export function pvmDachLeeren(gId) {
  const g = _geb(gId);
  if (!g || !(g.pvFlaechen || []).length) return;
  if (_alsPlanungsschritt('Dach leeren', () => _dachLeeren(g))) _nachDachflaeche(g);
}

/** Sattel-/Walmdach ohne Dachflächen in Dachflächen zerlegen (Flügel-Modell, 37). */
export function pvmDachZerlegen(gId) {
  const g = _geb(gId);
  if (!g || typeof window.dachGrundrissFuerGebaeude !== 'function') return;
  if (!confirm(`„${_name(g)}" in einzelne Dachflächen zerlegen?\n\nDas Dach wird aus dem Grundriss berechnet (Flügel mit ${DACHFORMEN[g.dachform] || 'Satteldach'}, Kehlen an den Anschlüssen). `
      + (_hasBelegung(g) ? 'Die Belegung wird auf die Dachflächen umgestellt (Nordflächen nach den Regeln ausgelassen) — das kWp ändert sich dabei. ' : '')
      + 'Strg+Z im PV-Modus nimmt die Belegung zurück.')) return;
  const r = window.dachGrundrissFuerGebaeude([g.id]);
  if (!r?.gebaeude) { alert('Der Grundriss ist nicht rechtwinklig genug (schräge Kanten oder Rundungen) — das Dach bleibt, wie es ist.'); return; }
  _nachDachflaeche(g);
}

/**
 * In der 3D-Ansicht gezeichnete Fläche übernehmen (32, Stufe 2): Sperr- oder
 * Belegungsfläche im Grundriss, wie aus dem PV-Modus. Der First liegt dabei in der
 * Gebäudemitte (03c pvFirstPunkt), auch wenn nur ein kleines Rechteck belegt ist.
 * @param {{lat:number,lng:number}[]} punkte
 * @returns {boolean}
 */
export function pvmFlaecheAus3d(gId, key, punkte, typ) {
  const g = _geb(gId);
  if (!g || !Array.isArray(punkte) || punkte.length < 3) return false;
  const sperr = typ === 'sperr';
  if (!sperr && pvnaAbrissGeplant(g)) { alert(`„${_name(g)}" hat ein Abrissjahr (${g.abrissjahr}) — keine PV.`); return false; }
  if ((polygonAreaM2(punkte) || 0) < 0.25) { window.showHint?.('Fläche zu klein — zweiten Punkt weiter weg setzen.', 3000); return false; }
  const ok = _alsPlanungsschritt(sperr ? 'Sperrfläche in 3D' : 'Belegungsfläche in 3D', () => {
    _stapelLaeuft = true;
    try {
      if (!sperr && key?.startsWith('fg:')) {
        const d = window.dachAusGrundrissFuer?.(g);
        if (d) { g.dachFlaechen = d.dachFlaechen; g.dachLod2 = d.lod2; g._pvModSig = null; }
      }
      const leer = !_hasBelegung(g);
      const sattelOhneFl = !g.dachFlaechen?.length && (g.dachform || 'sattel') === 'sattel';
      if (!sperr && sattelOhneFl && leer && (g.dachAzimut == null || g.dachAutoAzimut) && key?.startsWith('seite:')) {
        // wie beim Belegen einer Seite: Azimut der angeklickten Fläche, damit Ansicht und Rechnung gleich teilen
        g.dachAzimut = Math.round(+key.slice(6)) % 360; g.dachAutoAzimut = true;
      }
      const fl = _flaecheAnhaengen(g, punkte, sperr ? 'sperr' : 'belegung', false);
      if (!sperr) {
        if (leer) _erstbelegung(g, 1);
        // Auf einer ausgesparten Satteldachseite gezeichnet → dort gilt jetzt NUR das Rechteck:
        // Aussparung weg, übrige Belegungen auf die andere Seite zuschneiden (sonst wäre die
        // ganze Seite belegt, weil die Grundriss-Belegung das ganze Dach abdeckt)
        const f = sattelOhneFl ? _first(g) : null;
        if (f) {
          const seite = _vorne(f, _polyCentroidLL(fl.polygon));
          if (_seitenSperren(g).some(s => s.vorne === seite)) {
            _seiteFreigeben(g, seite);
            for (const b of (g.pvFlaechen || []).filter(x => x.typ === 'belegung' && x !== fl)) {
              const rest = _clipPolyHalfPlane(b.polygon, f.C, f.A, f.cosL, !seite);
              _flaecheEntfernen(g, b);
              if (rest.length >= 3) _flaecheAnhaengen(g, rest.map(p => ({ lat: p.lat, lng: p.lng })), 'belegung', false);
            }
          }
        }
      }
      redrawGebPvModules(g);
      if (_hasBelegung(g)) _uebernehmen(g);
    } finally { _stapelLaeuft = false; }
  });
  if (ok) _nachDachflaeche(g);
  return ok;
}

/** Eine Fläche aus der 3D-Ansicht entfernen (Sperrfläche); ohne Belegung danach samt PV-Asset. */
export function pvmFlaeche3dEntfernen(gId, flId) {
  const g = _geb(gId);
  const fl = (g?.pvFlaechen || []).find(f => f.id === flId);
  if (!fl) return;
  const ok = _alsPlanungsschritt('Fläche entfernen', () => {
    _stapelLaeuft = true;
    try {
      const hatteBelegung = _hasBelegung(g);
      _flaecheEntfernen(g, fl);
      if (hatteBelegung && !_hasBelegung(g)) { _dachLeeren(g); return; }
      redrawGebPvModules(g);
      if (_hasBelegung(g)) _uebernehmen(g);
    } finally { _stapelLaeuft = false; }
  });
  if (ok) _nachDachflaeche(g);
}

/**
 * Flächen eines Dachs für die 3D-Ansicht (Liste „Flächen auf diesem Dach", Ecken
 * verschieben): Belegungs- und von Hand gesetzte Sperrflächen; die automatischen
 * Seitensperren (Nordseite, Seite, Verschattung) nicht — die folgen der Firstlinie.
 * @returns {{key:string, typ:string, m2:number, text:string}[]}
 */
export function pvmFlaechenAmDach(gId) {
  const g = _geb(gId);
  return (g?.pvFlaechen || []).filter(f => f.polygon?.length >= 3 && (f.typ === 'belegung' || !_SEITEN_AUTO.has(f.auto)))
    .map(f => ({ key: (f.typ === 'belegung' ? 'bf:' : 'sp:') + f.id, typ: f.typ, m2: f.flaeche || polygonAreaM2(f.polygon) || 0,
      text: f.typ === 'belegung' ? (f.dachFlaecheId != null ? 'Belegung (Dachfläche)' : 'Belegung') : 'Sperrfläche' }));
}

/**
 * Neue Eckpunkte einer Fläche aus der 3D-Ansicht (Ecken verschieben) — ein Planungsschritt.
 * Belegungsflächen auf LoD2-/berechneten Dächern bekommen die Ausrichtung der Dachfläche
 * unter ihrem (neuen) Schwerpunkt.
 * @param {{lat:number,lng:number}[]} punkte
 * @param {string} [label] Name des Planungsschritts (Strg+Z-Meldung)
 * @returns {boolean}
 */
export function pvmFlaecheEckenSetzen(gId, flId, punkte, label = 'Ecken verschoben') {
  const g = _geb(gId);
  const fl = (g?.pvFlaechen || []).find(f => f.id === flId);
  if (!fl || !Array.isArray(punkte) || punkte.length < 3) return false;
  const m2 = polygonAreaM2(punkte) || 0;
  if (m2 < 0.25) { window.showHint?.('Fläche wäre zu klein — Ecke zurückgesetzt.', 3000); return false; }
  const ok = _alsPlanungsschritt(label, () => {
    _stapelLaeuft = true;
    try {
      fl.polygon = punkte.map(p => ({ lat: p.lat, lng: p.lng }));
      fl.flaeche = m2;
      if (fl.typ === 'belegung' && fl.dachFlaecheId != null) {
        delete fl.dachFlaecheId; delete fl.azimut; delete fl.neigung;
        pvFlaecheDachZuordnen(g, fl);
      }
      attachGebPvLayer(g, fl);
      redrawGebPvModules(g);
      if (_hasBelegung(g)) _uebernehmen(g);
    } finally { _stapelLaeuft = false; }
  });
  if (ok) _nachDachflaeche(g);
  return ok;
}
