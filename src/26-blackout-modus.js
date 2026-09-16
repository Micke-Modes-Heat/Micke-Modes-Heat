// ── 26-blackout-modus.js — Blackout-Modus: Notstromklassen auf der Karte ─────
//
// Erster Baustein der Resilienz-Betrachtung außerhalb der Analyse: Gebäude
// werden direkt auf der Karte einer Notstromklasse zugeordnet (A kritisch,
// B eingeschränkt, C einspeisefähig). Das Panel zeigt die daraus folgende
// Lastbilanz — Grundlage für die spätere Platzierung der Aggregate am
// Bestandsnetz und für die Liegenschafts-Insel.
//
// Bedienung wie im PV-Modus (25-pv-modus.js): ein Werkzeug, das anbleibt.
// Klasse als „Pinsel" wählen (Tasten 1/2/3, 0 = entfernen), Gebäude
// anklicken. Klick auf ein Gebäude, das die Klasse schon hat, nimmt sie weg.
//
// Die Klasse liegt am Gebäude (g.notstrom), die Last kommt aus den
// Verbraucher-Assets des Gebäudes. Gerechnet wird in lib/resilienz-core.js.
// Das Modul ist ein Blatt im Importgraph; 02b/02c rufen es über window.

import { beginInteraction, cancelInteraction } from './lib/interaction-state.js';
import {
  NOTSTROM_KLASSEN, NOTSTROM_KLASSEN_KEYS, NOTSTROM_B_VORGABE_PCT,
  normalisiereNotstrom, anschlussKwJeGebaeude, notstromBilanz,
  NEA_KOSTEN, NEA_STRATEGIEN, notstromPlatzierung, notstromPlatzierungVergleich,
  INSEL_PARAMETER, INSEL_STATUS, liegenschaftsInsel,
  WAERME_SZENARIEN, WAERME_PARAMETER, WAERME_ENERGIETRAEGER, waermeBlackout,
} from './lib/resilienz-core.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { globalYear, thermSpeicherAktiv } from './01-globals-varianten.js';
import { map } from './02b-gebaeude.js';
import { updateViz, polygonCenter } from './02c-karte-werkzeuge.js';
import { flyTo, escHtml } from './03c-gebaeude-io.js';
import { getStromEdgeStatus, addStromEdge, recalcStromNetz } from './05b-stromnetz.js';
import { ASSETS, getAssetStatus, getAssetPropsForYear, createAsset } from './13a-assets-core.js';
import { redrawAllAssets } from './13b-assets-render.js';
import { getNodeProfile8760 } from './13r-knotenpunkt-analyse.js';
import { getThermSpeicherParams } from './06b-gl-berechnen.js';
import { isErzeugerAktiv, autoGkResult } from './06c-dispatch-core.js';

const PANEL_ID    = 'blackout-modus-panel';
const INTERAKTION = 'blackout-modus';
const GRAU        = 'rgba(255,255,255,.45)';
const AKZENT      = '#ef5350';

let _stoppt = false;
/** @type {((e:KeyboardEvent)=>void)|null} */
let _tastenHandler = null;

const _alle = () => window.gebaeude || [];
const _geb  = gId => _alle().find(g => g.id === gId) || null;
const _fmtKw = kw => `${Math.round(kw).toLocaleString('de-DE')} kW`;

/** Projektweite Einstellungen des Modus (werden mit dem Projekt gespeichert). */
export function blackoutEinstellungen() {
  if (!window.blackoutVorgabe || typeof window.blackoutVorgabe !== 'object') {
    window.blackoutVorgabe = { bLastPct: NOTSTROM_B_VORGABE_PCT };
  }
  window.blackoutVorgabe.insel = _inselNormalisieren(window.blackoutVorgabe.insel);
  window.blackoutVorgabe.waerme = _waermeNormalisieren(window.blackoutVorgabe.waerme);
  return window.blackoutVorgabe;
}

const INSEL_DAUERN = [[24, '24 h'], [72, '3 Tage'], [168, '7 Tage'], [336, '14 Tage']];

function _waermeNormalisieren(d) {
  const zahl = (v, def, min, max) => {
    if (v == null || v === '') return def;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    szenario: WAERME_SZENARIEN[d?.szenario] ? d.szenario : 'total',
    dauerH: zahl(d?.dauerH, 72, 1, 720),
    mitNea: d?.mitNea !== false,
    zweistoffKw: zahl(d?.zweistoffKw, null, 0, 1e6),   // null = Gaskessel-Leistung übernehmen
    tankL: zahl(d?.tankL, 0, 0, 1e7),
    hilfsPct: zahl(d?.hilfsPct, WAERME_PARAMETER.hilfsPctVorgabe, 0, 20),
    hilfsKw: zahl(d?.hilfsKw, 0, 0, 1e5),               // 0 = Prozentansatz
  };
}

function _inselNormalisieren(d) {
  const zahl = (v, def, min, max) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const bewertung = {};
  for (const [k, v] of Object.entries(d?.bewertung || {})) if (INSEL_STATUS[v]) bewertung[k] = v;
  return {
    anteilPct: zahl(d?.anteilPct, 50, 5, 100),
    dauerH: zahl(d?.dauerH, 72, 1, 720),
    redundanz: !!d?.redundanz,
    bewertung,
  };
}

/** Projektdatei: Einstellungen sichern (die Klassen selbst liegen an den Gebäuden). */
export function blackoutCaptureState() {
  const e = blackoutEinstellungen();
  return { bLastPct: e.bLastPct, insel: { ...e.insel, bewertung: { ...e.insel.bewertung } }, waerme: { ...e.waerme } };
}

export function blackoutRestoreState(d) {
  const v = parseInt(d?.bLastPct, 10);
  window.blackoutVorgabe = {
    bLastPct: Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : NOTSTROM_B_VORGABE_PCT,
    insel: _inselNormalisieren(d?.insel),
    waerme: _waermeNormalisieren(d?.waerme),
  };
  window.blackoutPlatz = null;
  window.blackoutInsel = null;
  if (window.blackoutModusAktiv) { blackoutModusMarkiereKarte(); blackoutModusRender(); }
}

// ══════════════════════════════════════════════════════════════════════════
// BILANZ — für Panel und spätere Schritte (Platzierung, Gutachten)
// ══════════════════════════════════════════════════════════════════════════

/** Aktive Assets des betrachteten Jahres mit den bis dahin umgesetzten Maßnahmen. */
function _aktiveVerbraucher(jahr) {
  return ASSETS.items
    .filter(a => a.type === 'Verbraucher' && a.buildingId != null && getAssetStatus(a, jahr) === 'active')
    .map(a => ({ type: a.type, buildingId: a.buildingId, props: getAssetPropsForYear(a, jahr) }));
}

/** Lastbilanz der eingestuften Gebäude im aktuellen Betrachtungsjahr. */
export function blackoutBilanz() {
  const jahr = globalYear;
  const kw = anschlussKwJeGebaeude(_aktiveVerbraucher(jahr));
  const bilanz = notstromBilanz(_alle(), kw, { bVorgabePct: blackoutEinstellungen().bLastPct });
  return { ...bilanz, jahr };
}

// ══════════════════════════════════════════════════════════════════════════
// MODUS AN/AUS
// ══════════════════════════════════════════════════════════════════════════

export function blackoutModusToggle() {
  if (window.blackoutModusAktiv) blackoutModusStop(); else blackoutModusStart();
}

export function blackoutModusStart() {
  if (window.blackoutModusAktiv) return;
  beginInteraction({
    id: INTERAKTION,
    label: '🛡 Blackout-Modus',
    hint: 'Gebäude anklicken = Klasse zuweisen · 1/2/3 = Kritisch/Eingeschränkt/Einspeisefähig · 0 = entfernen',
    cancel: () => blackoutModusStop(),
  });
  window.blackoutModusAktiv = true;
  if (!window.blackoutPinsel) window.blackoutPinsel = 'A';
  blackoutEinstellungen();
  _tastenHandler = _taste;
  document.addEventListener('keydown', _tastenHandler, true);
  _knopfAktiv(true);
  blackoutModusRender();
  blackoutModusMarkiereKarte();
  _platzZeichnen();
  _inselZeichnen();
  _waermeZeichnen();
}

export function blackoutModusStop() {
  if (!window.blackoutModusAktiv || _stoppt) return;
  _stoppt = true;
  try {
    window.blackoutModusAktiv = false;
    if (_tastenHandler) { document.removeEventListener('keydown', _tastenHandler, true); _tastenHandler = null; }
    document.getElementById(PANEL_ID)?.remove();
    _platzLayerEntfernen();
    _inselLayerEntfernen();
    _waermeLayerEntfernen();
    _knopfAktiv(false);
    cancelInteraction(INTERAKTION);            // no-op, wenn der Stopp von dort kam
    updateViz();                               // Gebäudestile zurück auf die normale Darstellung
  } finally { _stoppt = false; }
}

function _knopfAktiv(an) {
  document.getElementById('btn-blackout-modus-toggle')?.classList.toggle('active', an);
}

function _taste(event) {
  const ziel = event.target;
  const tippt = !!ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA' ||
                           ziel.tagName === 'SELECT' || ziel.isContentEditable);
  if (event.key === 'Escape') {
    if (tippt) { ziel.blur(); return; }
    event.preventDefault();
    event.stopPropagation();
    blackoutModusStop();
    return;
  }
  if (tippt || event.ctrlKey || event.metaKey || event.altKey) return;
  const pinsel = { 1: 'A', 2: 'B', 3: 'C', 0: 'weg' }[event.key];
  if (pinsel) { blackoutSetPinsel(pinsel); event.preventDefault(); }
}

// ══════════════════════════════════════════════════════════════════════════
// ZUORDNUNG
// ══════════════════════════════════════════════════════════════════════════

/** @param {'A'|'B'|'C'|'weg'} p */
export function blackoutSetPinsel(p) {
  window.blackoutPinsel = (p === 'weg' || NOTSTROM_KLASSEN[p]) ? p : 'A';
  if (_tab() !== 'klassen') { blackoutSetTab('klassen'); return; }
  blackoutModusRender();
}

// Einstellungen (B-Lastanteil, NEA am Gebäude) überleben einen Klassenwechsel
// im laufenden Modus: _notstromMerk wird nicht gespeichert.
function _setKlasse(g, klasse) {
  const alt = normalisiereNotstrom(g.notstrom);
  if (alt) g._notstromMerk = {
    lastPct:   alt.klasse === 'B' ? alt.lastPct   : (g._notstromMerk?.lastPct ?? null),
    eigeneNea: alt.klasse === 'A' ? alt.eigeneNea : !!g._notstromMerk?.eigeneNea,
  };
  if (!klasse || klasse === 'weg') { delete g.notstrom; return; }
  g.notstrom = normalisiereNotstrom({ klasse, ...g._notstromMerk });
}

function _nachAenderung() {
  blackoutModusMarkiereKarte();
  blackoutModusRender();
}

/**
 * Klick auf ein Gebäudepolygon im Blackout-Modus (aus attachPolygonLayer).
 * @returns {boolean} true = Klick verbraucht (keine Gebäudeauswahl)
 */
export function blackoutModusBuildingClick(gId) {
  if (!window.blackoutModusAktiv) return false;
  const g = _geb(gId);
  if (!g) return false;
  const pinsel = window.blackoutPinsel || 'A';
  const ist = normalisiereNotstrom(g.notstrom)?.klasse;
  _setKlasse(g, pinsel === 'weg' || ist === pinsel ? 'weg' : pinsel);
  window.blackoutGeb = gId;
  _nachAenderung();
  return true;
}

/** Aktuellen Pinsel auf alle in der Gebäudeliste/-tabelle angekreuzten Gebäude anwenden. */
export function blackoutAufAuswahl() {
  const ziele = _alle().filter(g => g.selected);
  if (!ziele.length) {
    alert('Keine Gebäude ausgewählt.\n\nGebäude in der Gebäudeliste oder in der Gebäudetabelle ankreuzen (dort lässt sich filtern und „alle sichtbaren" auswählen).');
    return;
  }
  const p = window.blackoutPinsel || 'A';
  const text = p === 'weg' ? 'die Notstromklasse entfernen' : `Klasse ${p} „${NOTSTROM_KLASSEN[p].label}" zuweisen`;
  if (!confirm(`${ziele.length} ausgewählten Gebäuden ${text}?`)) return;
  ziele.forEach(g => _setKlasse(g, p));
  window.showHint?.(`${ziele.length} Gebäude: ${p === 'weg' ? 'Klasse entfernt' : 'Klasse ' + p}`, 4000);
  _nachAenderung();
}

export function blackoutSetLastPct(gId, wert) {
  const g = _geb(gId);
  const n = normalisiereNotstrom(g?.notstrom);
  if (!n || n.klasse !== 'B') return;
  g.notstrom = normalisiereNotstrom({ ...n, lastPct: wert === '' ? null : wert });
  _nachAenderung();
}

export function blackoutSetEigeneNea(gId, an) {
  const g = _geb(gId);
  const n = normalisiereNotstrom(g?.notstrom);
  if (!n || n.klasse !== 'A') return;
  g.notstrom = normalisiereNotstrom({ ...n, eigeneNea: !!an });
  _nachAenderung();
}

export function blackoutSetBVorgabe(wert) {
  const v = parseInt(wert, 10);
  blackoutEinstellungen().bLastPct = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : NOTSTROM_B_VORGABE_PCT;
  _nachAenderung();
}

export function blackoutEntfernen(gId) {
  const g = _geb(gId);
  if (!g) return;
  _setKlasse(g, 'weg');
  _nachAenderung();
}

export function blackoutZeige(gId) {
  window.blackoutGeb = gId;
  flyTo(gId);
  blackoutModusMarkiereKarte();
  blackoutModusRender();
}

export function blackoutAlleEntfernen() {
  const n = _alle().filter(g => g.notstrom).length;
  if (!n || !confirm(`Notstromklasse bei allen ${n} Gebäuden entfernen?`)) return;
  _alle().forEach(g => { delete g.notstrom; delete g._notstromMerk; });
  _nachAenderung();
}

// ══════════════════════════════════════════════════════════════════════════
// KARTENDARSTELLUNG
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// PLATZIERUNG AM NETZ (Schritt 2)
// ══════════════════════════════════════════════════════════════════════════
// Ergebnis liegt in window.blackoutPlatz (Vergleich aller Strategien), die
// gewählte Strategie in window.blackoutStrategie. Gerechnet wird auf Knopfdruck:
// Lastgänge aller Gebäude zu summieren ist bei großen Liegenschaften spürbar.

const KNOTEN_FARBE = '#ff7043';
/** @type {any} */
let _platzLayer = null;

const _num = v => parseFloat(String(v ?? '').replace(',', '.')) || 0;

/** Last eines Assets ohne Gebäude (Ladepark, Wärmepumpe …) — nur für den Abschaltvermerk. */
function _lastKw(a, p) {
  switch (a.type) {
    case 'Verbraucher': case 'Stromkessel': return _num(p.leistungKW);
    case 'WP':  return _num(p.leistungElKW) || _num(p.leistungKW);
    case 'Geo': case 'FG': return _num(p.leistungElKW);
    case 'Lade': {
      const gzf = Math.min(1, Math.max(0, _num(p.gleichzeitigFaktor) || 0.3));
      return (parseInt(p.anzahlPunkte) || 8) * (_num(p.leistungProPunktKW) || 11) * gzf
           + (parseInt(p.anzahlSchnell) || 0) * (_num(p.leistungSchnellKW) || 150);
    }
    default: return 0;
  }
}

/** Summenlastgang der Verbraucher-Assets eines Gebäudes (13r), null ohne Asset. */
function _gebProfil(gId, jahr) {
  let summe = null;
  for (const a of ASSETS.items) {
    if (a.type !== 'Verbraucher' || a.buildingId !== gId || getAssetStatus(a, jahr) !== 'active') continue;
    const p = getNodeProfile8760(a);
    if (!p?.length) continue;
    if (!summe) summe = new Float32Array(p.length);
    for (let t = 0; t < Math.min(p.length, summe.length); t++) summe[t] += p[t];
  }
  return summe;
}

/** Stand der Eingaben — ändert er sich, gilt das Ergebnis als veraltet. */
function _platzSig() {
  const klassen = _alle().filter(g => g.notstrom)
    .map(g => `${g.id}:${g.notstrom.klasse}:${g.notstrom.lastPct ?? ''}:${g.notstrom.eigeneNea ? 1 : 0}`).join(',');
  return [globalYear, blackoutEinstellungen().bLastPct, ASSETS.items.length,
          (window.stromEdges || []).length, klassen].join('|');
}

function _aktuelleVariante() {
  const pl = window.blackoutPlatz;
  if (!pl) return null;
  if (!pl.varianten[window.blackoutStrategie]) window.blackoutStrategie = pl.empfohlen;
  return pl.varianten[window.blackoutStrategie];
}

/** Eingaben der Netz-Platzierung (auch Grundlage der Liegenschafts-Insel). */
function _platzEingaben(jahr) {
  const assets = ASSETS.items
    .filter(a => (a.domain === 'strom' || a.domain === 'hybrid') && getAssetStatus(a, jahr) === 'active')
    .map(a => ({ id: a.id, type: a.type, name: a.name, lat: a.lat, lng: a.lng, buildingId: a.buildingId,
                 lastKw: _lastKw(a, getAssetPropsForYear(a, jahr)) }));
  const kanten = (window.stromEdges || [])
    .filter(e => getStromEdgeStatus(e, jahr) === 'active')
    .map(e => ({ id: e.id, u: e.u, v: e.v }));
  const gebaeude = _alle()
    .filter(g => getAssetStatus(g, jahr) === 'active')
    .map(g => {
      const c = g.polygon?.length >= 3 ? polygonCenter(g.polygon) : null;
      return { id: g.id, name: g.name || `Gebäude ${g.id}`, lat: c?.lat, lng: c?.lng, notstrom: g.notstrom };
    });
  return {
    assets, kanten, gebaeude,
    kwJeGebaeude: anschlussKwJeGebaeude(_aktiveVerbraucher(jahr)),
    profil: gId => _gebProfil(gId, jahr),
    bVorgabePct: blackoutEinstellungen().bLastPct,
  };
}

export function blackoutPlatzierungRechnen() {
  const jahr = globalYear;
  const vergleich = notstromPlatzierungVergleich(_platzEingaben(jahr));
  const bestand = ASSETS.items.filter(a => a.type === 'Nsa' && getAssetStatus(a, jahr) === 'active');
  window.blackoutPlatz = {
    ...vergleich, jahr, sig: _platzSig(), ts: Date.now(),
    hatNetz: vergleich.varianten.optimal.wurzeln.length > 0,
    bestand: { anzahl: bestand.length, kw: bestand.reduce((s, a) => s + _num(a.props?.leistungKW), 0) },
  };
  window.blackoutStrategie = vergleich.empfohlen;
  _platzZeichnen();
  blackoutModusRender();
}

export function blackoutSetStrategie(s) {
  if (!NEA_STRATEGIEN[s]) return;
  window.blackoutStrategie = s;
  _platzZeichnen();
  blackoutModusRender();
}

export function blackoutPlatzierungVerwerfen() {
  window.blackoutPlatz = null;
  _platzLayerEntfernen();
  blackoutModusRender();
}

export function blackoutZeigeOrt(lat, lng) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) map.flyTo([lat, lng], Math.max(map.getZoom(), 18));
}

function _platzLayerEntfernen() {
  if (_platzLayer) { _platzLayer.remove(); _platzLayer = null; }
}

function _posVon(id) {
  const a = ASSETS.items.find(x => x.id === id);
  if (a && Number.isFinite(a.lat)) return [a.lat, a.lng];
  const g = _geb(id);
  if (g?.polygon?.length >= 3) { const c = polygonCenter(g.polygon); return [c.lat, c.lng]; }
  return null;
}

function _divIcon(html, farbe, groesse = 26) {
  return L.divIcon({
    className: '', iconSize: [groesse, groesse], iconAnchor: [groesse / 2, groesse / 2],
    html: `<div style="background:${farbe};border:2px solid #fff;border-radius:50%;width:${groesse}px;height:${groesse}px;
           display:flex;align-items:center;justify-content:center;font-size:${Math.round(groesse / 2)}px;color:#fff;
           box-shadow:0 2px 6px rgba(0,0,0,.45);">${html}</div>`,
  });
}

/** Aggregate und abzuschaltende Abgänge der gewählten Strategie auf die Karte. */
function _platzZeichnen() {
  _platzLayerEntfernen();
  const r = _aktuelleVariante();
  if (!r || !window.blackoutModusAktiv || _tab() !== 'netz') return;
  _platzLayer = L.layerGroup().addTo(map);
  for (const x of r.abgaenge) {
    const e = x.kanteId ? (window.stromEdges || []).find(k => k.id === x.kanteId) : null;
    const pts = e?.layer?.getLatLngs?.() || [];
    const text = `<b>✕ Abschalten</b><br>${escHtml(x.lokal ? `an ${x.vonName}` : `${x.vonName} → ${x.zuName}`)}<br>`
      + `${x.anzahl} Last${x.anzahl === 1 ? '' : 'en'} · ${_fmtKw(x.lastKw)}<br>`
      + `<span style="color:#90a4ae">${escHtml(x.namen.slice(0, 6).join(', '))}${x.namen.length > 6 ? ' …' : ''}</span>`;
    let mitte = null;
    if (pts.length >= 2) {
      L.polyline(pts, { color: '#ff1744', weight: 7, opacity: 0.8, dashArray: '3 7', interactive: false }).addTo(_platzLayer);
      const a = pts[Math.floor((pts.length - 1) / 2)], b = pts[Math.ceil((pts.length - 1) / 2)];
      mitte = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
    } else {
      mitte = _posVon(x.lokal ? x.vonId : x.zuId);
    }
    if (mitte) L.marker(mitte, { icon: _divIcon('✕', '#ff1744', 18), zIndexOffset: 650 })
      .bindTooltip(text, { className: 'geb-tooltip' }).addTo(_platzLayer);
  }
  for (const a of r.aggregate) {
    if (!Number.isFinite(a.lat) || !(a.empfKw > 0)) continue;
    const farbe = a.ort === 'knoten' ? KNOTEN_FARBE : a.fest ? '#90a4ae' : NOTSTROM_KLASSEN.A.farbe;
    const text = `<b>⚙ NEA ${escHtml(a.name)}</b> (${a.ort === 'knoten' ? escHtml(a.typ) : 'am Gebäude'})<br>`
      + `Empfehlung <b>${_fmtKw(a.empfKw)}</b> · gleichz. Spitze ${_fmtKw(a.peakKw)}<br>`
      + `versorgt ${a.gebaeude.length} Gebäude · ${_fmtEur(a.kosten)}`
      + (a.abgaenge.length ? `<br>${a.abgaenge.length} Abgänge abschalten` : '')
      + (a.fest ? '<br><i>eigenes Aggregat (Vorgabe)</i>' : '')
      + (a.nichtAmNetz ? '<br><i>Gebäude hängt nicht am Netz</i>' : '');
    L.marker([a.lat, a.lng], { icon: _divIcon('⚙', farbe, a.ort === 'knoten' ? 30 : 24), zIndexOffset: 700 })
      .bindTooltip(text, { className: 'geb-tooltip' }).addTo(_platzLayer);
  }
}

const _fmtEur = v => v >= 10000 ? `${Math.round(v / 1000).toLocaleString('de-DE')} T€` : `${Math.round(v).toLocaleString('de-DE')} €`;

/** Aggregate der gewählten Strategie als Nsa-Assets anlegen; Knoten-Aggregate mit Kabel. */
export function blackoutPlatzierungUebernehmen() {
  const r = _aktuelleVariante();
  if (!r) return;
  const liste = r.aggregate.filter(a => a.empfKw > 0 && Number.isFinite(a.lat));
  // Schon übernommene Aggregate nicht doppelt anlegen — nur die Leistung angleichen
  const vorhanden = a => ASSETS.items.find(x => x.type === 'Nsa' && x.props?.blackoutZiel === `${a.ort}:${a.id}`);
  const neu = liste.filter(a => !vorhanden(a));
  const anpassen = liste.filter(a => {
    const x = vorhanden(a);
    return x && _num(x.props.leistungKW) !== a.empfKw;
  });
  if (!neu.length && !anpassen.length) {
    window.showHint?.('Alle Aggregate dieser Strategie sind schon als Assets angelegt.', 4000);
    return;
  }
  const frage = [
    neu.length && `${neu.length} Notstromaggregat(e) als Assets anlegen.`,
    anpassen.length && `${anpassen.length} bereits angelegte(s) Aggregat(e) auf die neue Leistung setzen `
      + `(${anpassen.map(a => `${a.name}: ${_num(vorhanden(a).props.leistungKW)} → ${a.empfKw} kW`).join(', ')}).`,
  ].filter(Boolean).join('\n');
  if (!confirm(`${frage}\n\nAggregate an Knoten werden per Kabel an den Knoten angeschlossen, Aggregate am Gebäude `
    + 'dem Gebäude zugeordnet. Die abzuschaltenden Abgänge bleiben ein Vermerk.')) return;
  for (const a of anpassen) vorhanden(a).props.leistungKW = String(a.empfKw);
  const autonomieH = window._pvResReco?.durH || 72;
  const angelegt = [];
  for (const a of neu) {
    const knoten = a.ort === 'knoten' ? ASSETS.items.find(x => x.id === a.id) : null;
    const nsa = createAsset('Nsa', a.lat + 0.00006, a.lng + 0.00006, {
      name: `NEA ${a.name}`,
      buildingId: a.ort === 'gebaeude' ? a.id : (knoten?.buildingId ?? null),
      props: { leistungKW: String(a.empfKw), autonomieH: String(autonomieH), kraftstoff: 'Diesel',
               blackoutZiel: `${a.ort}:${a.id}` },
    });
    if (!nsa) continue;
    angelegt.push({ nsa, knoten });
  }
  redrawAllAssets();
  for (const { nsa, knoten } of angelegt) if (knoten) addStromEdge(nsa.id, knoten.id);
  recalcStromNetz();
  window.showHint?.([
    angelegt.length && `${angelegt.length} Notstromaggregat(e) angelegt · Autonomie ${autonomieH} h`,
    anpassen.length && `${anpassen.length} angepasst`,
  ].filter(Boolean).join(' · '), 5000);
  blackoutModusRender();
}

function _platzBlock() {
  const pl = window.blackoutPlatz;
  const titel = `<div style="display:flex;align-items:center;gap:4px;">
      <span style="flex:1;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Platzierung am Netz</span>
      <button class="btn-xs" style="border-color:${KNOTEN_FARBE};color:${KNOTEN_FARBE};" data-click="blackoutPlatzierungRechnen()"
        title="Aggregat-Standorte am Bestandsnetz vergleichen">${pl ? '↻ Neu' : '⚙ Berechnen'}</button>
      ${pl ? '<button class="btn-xs" style="padding:0 5px;" data-click="blackoutPlatzierungVerwerfen()" title="Ergebnis verwerfen">✕</button>' : ''}
    </div>`;
  if (!pl) {
    return titel + `<div style="font-size:9.5px;color:var(--muted);margin-top:4px;line-height:1.45;">
      Vergleicht Aggregate am Gebäude mit Aggregaten an Trafo, NSHV, UV und KVS. Dabei wird vermerkt,
      welche Abgänge im Blackout abgeschaltet werden müssen.</div>`;
  }
  const r = _aktuelleVariante();
  const veraltet = pl.sig !== _platzSig();
  const strategieZeilen = Object.entries(NEA_STRATEGIEN).map(([key, s]) => {
    const v = pl.varianten[key].summe;
    const aktiv = key === window.blackoutStrategie;
    return `<tr data-click="blackoutSetStrategie('${key}')" title="${s.kurz}"
        style="cursor:pointer;${aktiv ? `background:${KNOTEN_FARBE}26;` : ''}">
        <td style="padding:2px 4px;${aktiv ? `color:${KNOTEN_FARBE};font-weight:600;` : ''}">${aktiv ? '●' : '○'} ${s.label}${key === pl.empfohlen ? ' ★' : ''}</td>
        <td style="padding:2px 4px;text-align:right;">${v.anzahl}</td>
        <td style="padding:2px 4px;text-align:right;">${_fmtKw(v.kw)}</td>
        <td style="padding:2px 4px;text-align:right;">${v.abgaenge}</td>
        <td style="padding:2px 4px;text-align:right;">${_fmtEur(v.kosten)}</td></tr>`;
  }).join('');

  const aggZeilen = r.aggregate.map(a => {
    const farbe = a.ort === 'knoten' ? KNOTEN_FARBE : a.fest ? '#90a4ae' : NOTSTROM_KLASSEN.A.farbe;
    const art = a.ort === 'knoten' ? a.typ : a.fest ? 'eigene NEA' : a.nichtAmNetz ? 'ohne Netz' : 'Gebäude';
    return `<div style="display:flex;align-items:center;gap:4px;padding:2px;border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="color:${farbe};">⚙</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;"
          data-click="blackoutZeigeOrt(${a.lat},${a.lng})" title="${escHtml(a.gebaeude.length + ' Gebäude versorgt')}">${escHtml(a.name)}
          <span style="color:var(--muted);font-size:9px;">${escHtml(art)}</span></span>
        <span style="font-size:9.5px;white-space:nowrap;${a.empfKw > 0 ? '' : 'color:#ffa726;'}"
          title="Gleichzeitige Spitze ${_fmtKw(a.peakKw)} + ${Math.round((NEA_KOSTEN.reserve - 1) * 100)} % Reserve">${a.empfKw > 0 ? _fmtKw(a.empfKw) : '⚠ 0 kW'}</span>
      </div>`;
  }).join('');

  const abgZeilen = r.abgaenge.map(x => `
      <div style="display:flex;gap:4px;padding:2px;font-size:9.5px;border-bottom:1px solid rgba(255,255,255,.05);"
        title="${escHtml(x.namen.join(', '))}">
        <span style="color:#ff1744;">✕</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(x.lokal ? `an ${x.vonName} trennen` : `${x.vonName} → ${x.zuName}`)}
          <span style="color:var(--muted);">${x.anzahl > 1 ? `(${x.anzahl} Lasten)` : ''}${x.einspeisepunkte ? ' · Einspeisepunkt C' : ''}</span></span>
        <span style="white-space:nowrap;color:var(--muted);">${_fmtKw(x.lastKw)}</span>
      </div>`).join('');

  const hinweise = [
    !pl.hatNetz && 'Kein NAP, keine Schaltanlage, kein Trafo und keine NSHV gefunden — ohne Netz bleiben nur Aggregate an den Gebäuden.',
    veraltet && 'Klassen, Netz oder Jahr haben sich geändert — Ergebnis neu berechnen.',
    r.nichtAmNetz.length && `${r.nichtAmNetz.length} A/B-Gebäude hängen nicht am Netz und bekommen ein eigenes Aggregat.`,
    r.summe.ohneLast && `${r.summe.ohneLast} Aggregat(e) ohne Last — Gebäude ohne Verbraucher-Asset.`,
    pl.bestand.anzahl && `Bestand: ${pl.bestand.anzahl} Notstromaggregat(e) mit ${_fmtKw(pl.bestand.kw)} — in der Platzierung noch nicht angerechnet.`,
  ].filter(Boolean).map(t => `<div style="font-size:9px;color:#ffa726;margin-top:4px;line-height:1.4;">⚠ ${t}</div>`).join('');

  return titel + `
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px;">
      <thead><tr style="color:var(--muted);font-size:9px;">
        <th style="text-align:left;padding:2px 4px;font-weight:400;">Strategie</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Anzahl Aggregate">NEA</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Summe der empfohlenen Aggregatleistungen">Leistung</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Abzuschaltende Abgänge">Abg.</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Richtwert Investition">Kosten</th>
      </tr></thead><tbody>${strategieZeilen}</tbody></table>
    ${hinweise}
    <div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">Aggregate · ${escHtml(NEA_STRATEGIEN[r.strategie].label)}</div>
    ${aggZeilen || '<div style="font-size:9.5px;color:var(--muted);">Keine — noch keine Gebäude der Klassen A/B.</div>'}
    <div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">Im Blackout abschalten (${r.abgaenge.length})</div>
    ${abgZeilen || '<div style="font-size:9.5px;color:var(--muted);">Nichts abzuschalten.</div>'}
    <button class="btn-xs" style="width:100%;margin-top:8px;border-color:${KNOTEN_FARBE};color:${KNOTEN_FARBE};"
      data-click="blackoutPlatzierungUebernehmen()" ${veraltet ? 'disabled' : ''}
      title="Aggregate dieser Strategie als Notstromaggregat-Assets anlegen">⬆ Als Assets übernehmen</button>
    <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.45;">
      Bemessung: gleichzeitige Spitze der Gebäudelastgänge × Lastanteil + ${Math.round((NEA_KOSTEN.reserve - 1) * 100)} % Reserve.
      Kosten (Richtwerte): ${_fmtEur(NEA_KOSTEN.fixEur)} je Aggregat + ${NEA_KOSTEN.eurProKw} €/kW,
      Einspeisung am Knoten ${_fmtEur(NEA_KOSTEN.einspeisungKnotenEur)}, am Gebäude ${_fmtEur(NEA_KOSTEN.einspeisungGebaeudeEur)},
      ${_fmtEur(NEA_KOSTEN.abgangEur)} je abzuschaltendem Abgang. Anlaufströme großer Motoren und die Abschaltbedingung
      bei kleinem Kurzschlussstrom des Aggregats sind gesondert zu prüfen.
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// LIEGENSCHAFTS-INSEL AM NAP (Schritt 3)
// ══════════════════════════════════════════════════════════════════════════
// Ergebnis in window.blackoutInsel. Die A/B-Last je Trafo und die NS-Abgänge
// kommen aus der Platzierung mit der Strategie „Je Trafostation".

const INSEL_FARBE = '#ab47bc';
/** @type {any} */
let _inselLayer = null;

const REITER = ['klassen', 'netz', 'insel', 'waerme'];
const _tab = () => (REITER.includes(window.blackoutTab) ? window.blackoutTab : 'klassen');

export function blackoutSetTab(t) {
  window.blackoutTab = REITER.includes(t) ? t : 'klassen';
  _platzZeichnen();
  _inselZeichnen();
  _waermeZeichnen();
  blackoutModusRender();
}

const _profilSpitze = p => {
  let m = 0;
  for (let t = 0; t < (p?.length || 0); t++) if (p[t] > m) m = p[t];
  return m;
};

function _inselSig() {
  const e = blackoutEinstellungen().insel;
  return _platzSig() + '|' + JSON.stringify(e);
}

/** Liegenschafts-Lastgang: Messdaten des Referenzjahres, sonst Netzmodell am NAP. */
function _liegenschaftsProfil(nap) {
  const q = window.elQuartierH;
  if (q?.length >= 8760 && _profilSpitze(q) > 0) {
    return { profil: Array.from(q), quelle: 'Messdaten (Referenzjahr)' };
  }
  if (nap) {
    const p = getNodeProfile8760(nap);
    if (_profilSpitze(p) > 0) return { profil: Array.from(p, v => Math.max(0, v)), quelle: 'Netzmodell am NAP' };
  }
  return { profil: null, quelle: 'Summe der Trafo-Spitzen' };
}

export function blackoutInselRechnen() {
  const jahr = globalYear;
  const e = blackoutEinstellungen().insel;
  const eingaben = _platzEingaben(jahr);
  const platz = notstromPlatzierung({ ...eingaben, strategie: 'trafo' });
  const aktiv = t => ASSETS.items.filter(a => a.type === t && getAssetStatus(a, jahr) === 'active');
  const nap = aktiv('NAP')[0] || null;

  const trafos = aktiv('Trafo').map(t => {
    const agg = platz.aggregate.find(a => a.ort === 'knoten' && a.id === t.id);
    const props = getAssetPropsForYear(t, jahr);
    return {
      id: t.id, name: t.name, lat: t.lat, lng: t.lng, baujahr: t.baujahr,
      kva: _num(props.leistungKVA),
      spitzeKw: _profilSpitze(getNodeProfile8760(t)),
      abKw: agg?.peakKw || 0,
      nsAbgaenge: agg?.abgaenge || [],
    };
  });
  const { profil, quelle } = _liegenschaftsProfil(nap);
  const msKabelM = (window.stromEdges || [])
    .filter(k => k.msLevel && getStromEdgeStatus(k, jahr) === 'active')
    .reduce((s, k) => s + (k.lengthM || 0), 0);
  const napProps = nap ? getAssetPropsForYear(nap, jahr) : {};
  // Gebäude mit eigenem Aggregat versorgen sich selbst und zählen nicht zur Insel
  const abSpitzeKw = platz.aggregate.filter(a => !a.fest).reduce((s, a) => s + a.peakKw, 0);

  const ergebnis = liegenschaftsInsel({
    profil, spitzeKw: trafos.reduce((s, t) => s + t.spitzeKw, 0),
    anteilPct: e.anteilPct, dauerH: e.dauerH, redundanz: e.redundanz,
    abSpitzeKw, trafos, jahr, bewertung: e.bewertung,
    netz: {
      spannungKV: _num(napProps.spannungKV) || 20, msKabelM,
      schaltanlagen: [...aktiv('NAP'), ...aktiv('Schaltanlage')]
        .map(a => ({ id: a.id, name: a.name, type: a.type, baujahr: a.baujahr })),
    },
  });
  window.blackoutInsel = {
    ergebnis, quelle, jahr, sig: _inselSig(), ts: Date.now(),
    nap: nap ? { lat: nap.lat, lng: nap.lng, name: nap.name } : null,
    ohneNap: !nap, ohneTrafo: !trafos.length, msKabelM,
  };
  _inselZeichnen();
  blackoutModusRender();
}

export function blackoutInselSet(feld, wert) {
  const e = blackoutEinstellungen().insel;
  if (feld === 'redundanz') e.redundanz = !!wert;
  else e[feld] = wert;
  blackoutEinstellungen();                       // normalisieren
  if (window.blackoutInsel) blackoutInselRechnen(); else blackoutModusRender();
}

/** Status eines Checklistenpunkts von Hand setzen ('' = automatisch). */
export function blackoutInselBewertung(id, status) {
  const b = blackoutEinstellungen().insel.bewertung;
  if (INSEL_STATUS[status]) b[id] = status; else delete b[id];
  if (window.blackoutInsel) blackoutInselRechnen();
}

export function blackoutInselVerwerfen() {
  window.blackoutInsel = null;
  _inselLayerEntfernen();
  blackoutModusRender();
}

function _inselLayerEntfernen() {
  if (_inselLayer) { _inselLayer.remove(); _inselLayer = null; }
}

/** NAP mit Insel-Einspeisung, Trafos als versorgt (Stufe) oder abgeschaltet. */
function _inselZeichnen() {
  _inselLayerEntfernen();
  const ins = window.blackoutInsel;
  if (!ins || !window.blackoutModusAktiv || _tab() !== 'insel') return;
  const r = ins.ergebnis;
  _inselLayer = L.layerGroup().addTo(map);
  if (ins.nap) {
    L.marker([ins.nap.lat, ins.nap.lng], { icon: _divIcon('⚙', INSEL_FARBE, 32), zIndexOffset: 720 })
      .bindTooltip(`<b>Liegenschafts-Insel</b><br>${r.aggregate.anzahl} × ${r.aggregate.kvaJe} kVA · Maschinentrafo ${r.maschinentrafoKva} kVA<br>`
        + `Ziel ${_fmtKw(r.zielKw)} (${Math.round(r.anteilPct)} % von ${_fmtKw(r.spitzeKw)})`, { className: 'geb-tooltip' })
      .addTo(_inselLayer);
  }
  r.zuschaltung.stufen.forEach((st, i) => {
    for (const t of st.trafos) {
      if (!Number.isFinite(t.lat)) continue;
      L.marker([t.lat, t.lng], { icon: _divIcon(String(i + 1), '#43a047', 22), zIndexOffset: 710 })
        .bindTooltip(`<b>${escHtml(t.name)}</b> — versorgt, Zuschaltstufe ${i + 1}<br>${_fmtKw(t.lastKw)} im Inselbetrieb (Spitze ${_fmtKw(t.spitzeKw)}) · ${t.kva || '?'} kVA`
          + (t.abKw > 0 ? `<br>A/B-Last ${_fmtKw(t.abKw)}` : ''), { className: 'geb-tooltip' })
        .addTo(_inselLayer);
    }
  });
  for (const t of r.lastabwurf.abschalten) {
    if (!Number.isFinite(t.lat)) continue;
    L.marker([t.lat, t.lng], { icon: _divIcon('✕', '#ff1744', 22), zIndexOffset: 710 })
      .bindTooltip(`<b>${escHtml(t.name)}</b> — im Inselbetrieb MS-seitig abschalten<br>${_fmtKw(t.spitzeKw)}`, { className: 'geb-tooltip' })
      .addTo(_inselLayer);
  }
}

function _inselBlock() {
  const e = blackoutEinstellungen().insel;
  const ins = window.blackoutInsel;
  const dauerKnoepfe = INSEL_DAUERN.map(([h, t]) =>
    `<button class="btn-xs" style="flex:1;${h === e.dauerH ? `border-color:${INSEL_FARBE};color:${INSEL_FARBE};background:${INSEL_FARBE}26;` : ''}"
      data-click="blackoutInselSet('dauerH',${h})">${t}</button>`).join('');
  const steuerung = `
    <div style="display:flex;align-items:center;gap:4px;">
      <span style="flex:1;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Insel am NAP</span>
      <button class="btn-xs" style="border-color:${INSEL_FARBE};color:${INSEL_FARBE};" data-click="blackoutInselRechnen()"
        title="Liegenschafts-Insel bemessen und Checkliste erstellen">${ins ? '↻ Neu' : '⚙ Berechnen'}</button>
      ${ins ? '<button class="btn-xs" style="padding:0 5px;" data-click="blackoutInselVerwerfen()" title="Ergebnis verwerfen">✕</button>' : ''}
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:6px;" title="Abzusichernder Anteil der Liegenschafts-Spitzenlast">
      <span style="font-size:9.5px;color:var(--muted);white-space:nowrap;">Abgesichert</span>
      <input type="range" min="5" max="100" step="5" value="${e.anteilPct}" style="flex:1;accent-color:${INSEL_FARBE};height:4px;"
        oninput="this.nextElementSibling.textContent=this.value+' %'" data-change="blackoutInselSet('anteilPct',this.value)"/>
      <span style="min-width:34px;text-align:right;font-size:10.5px;color:${INSEL_FARBE};font-weight:600;">${e.anteilPct} %</span>
    </div>
    <div style="display:flex;gap:3px;margin-top:4px;">${dauerKnoepfe}</div>
    <label style="display:flex;align-items:center;gap:4px;margin-top:4px;font-size:9.5px;cursor:pointer;"
      title="Eine zusätzliche Einheit, damit der Ausfall eines Aggregats die Versorgung nicht unterbricht">
      <input type="checkbox" ${e.redundanz ? 'checked' : ''} data-change="blackoutInselSet('redundanz',this.checked)"/> Redundanz N+1</label>`;
  if (!ins) {
    return steuerung + `<div style="font-size:9.5px;color:var(--muted);margin-top:6px;line-height:1.45;">
      Ein zentrales Aggregat speist über einen Maschinentrafo am NAP ins MS-Netz. Das Ergebnis zeigt, welche Stationen
      versorgt oder abgeschaltet werden, und prüft Erdung, Netztrennung, Schutztechnik und Zuschaltung.</div>`;
  }
  const r = ins.ergebnis;
  const fmt = v => Math.round(v).toLocaleString('de-DE');
  const karte = (label, wert, farbe, titel = '') =>
    `<div title="${titel}" style="background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 6px;min-width:0;">
       <div style="font-size:8.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
       <div style="font-size:11.5px;font-weight:700;color:${farbe};white-space:nowrap;">${wert}</div></div>`;
  const kacheln = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:8px;">
      ${karte('Ziel', _fmtKw(r.zielKw), INSEL_FARBE, `${Math.round(r.anteilPct)} % der Spitze ${_fmtKw(r.spitzeKw)}`)}
      ${karte('Aggregate', `${r.aggregate.anzahl} × ${fmt(r.aggregate.kvaJe)} kVA`, INSEL_FARBE, `Bemessung ${_fmtKw(r.bemessungKw)}`)}
      ${karte('Maschinentrafo', `${fmt(r.maschinentrafoKva)} kVA`, INSEL_FARBE)}
      ${karte('Tank', `${fmt(r.liter)} l`, INSEL_FARBE, `${(r.energieKwh / 1000).toFixed(1)} MWh im ungünstigsten Fenster`)}
      ${karte('Stationen', `${r.lastabwurf.versorgt.length} an · ${r.lastabwurf.abschalten.length} aus`, '#43a047')}
      ${karte('Kosten', _fmtEur(r.kosten), INSEL_FARBE, 'Summe der Checklisten-Richtwerte')}
    </div>`;

  const veraltet = ins.sig !== _inselSig();
  const hinweise = [
    veraltet && 'Klassen, Netz oder Jahr haben sich geändert — neu berechnen.',
    ins.ohneNap && 'Kein NAP erfasst — Spannung 20 kV angenommen, Standort der NEA ohne Kartenbezug.',
    ins.ohneTrafo && 'Keine Trafos erfasst — Lastabwurf und Zuschaltstufen entfallen.',
    r.abReichtNicht && `Die A/B-Gebäude brauchen gleichzeitig mehr als das Ziel — bemessen wird auf ${_fmtKw(r.bemessungKw)}.`,
    !ins.msKabelM && 'Keine MS-Kabel erfasst — Erdschlussstrom und Ladeleistung sind 0 gesetzt.',
  ].filter(Boolean).map(t => `<div style="font-size:9px;color:#ffa726;margin-top:4px;line-height:1.4;">⚠ ${t}</div>`).join('');

  const stufen = r.zuschaltung.stufen.map((st, i) => `
      <div style="display:flex;gap:4px;padding:2px;font-size:9.5px;border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="color:#43a047;font-weight:700;width:14px;">${i + 1}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(st.trafos.map(t => t.name).join(', '))}</span>
        <span style="white-space:nowrap;color:var(--muted);">${fmt(st.kva)} kVA · ${_fmtKw(st.lastKw)}</span>
      </div>`).join('');
  const aus = r.lastabwurf.abschalten.map(t => `
      <div style="display:flex;gap:4px;padding:2px;font-size:9.5px;border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="color:#ff1744;width:14px;">✕</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(t.name)}</span>
        <span style="white-space:nowrap;color:var(--muted);">${_fmtKw(t.spitzeKw)}</span>
      </div>`).join('');

  const gruppen = [...new Set(r.checkliste.map(c => c.gruppe))];
  const optionen = aktuell => ['', ...Object.keys(INSEL_STATUS)].map(s =>
    `<option value="${s}" ${s === aktuell ? 'selected' : ''}>${s ? INSEL_STATUS[s].label : 'auto'}</option>`).join('');
  const liste = gruppen.map(gr => `
      <div style="font-size:9px;color:var(--muted);margin:6px 0 2px;">${escHtml(gr)}</div>
      ${r.checkliste.filter(c => c.gruppe === gr).map(c => {
        const st = INSEL_STATUS[c.status];
        const hand = e.bewertung[c.id] || '';
        return `<details style="border-bottom:1px solid rgba(255,255,255,.05);padding:2px 0;">
          <summary style="display:flex;align-items:center;gap:4px;cursor:pointer;list-style:none;font-size:10px;">
            <span style="flex-shrink:0;font-size:8.5px;padding:0 4px;border-radius:3px;border:1px solid ${st.farbe};color:${st.farbe};${hand ? 'font-weight:700;' : ''}"
              title="${hand ? 'von Hand gesetzt' : 'automatisch'}">${st.label}</span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(c.titel)}</span>
            <span style="white-space:nowrap;color:var(--muted);font-size:9px;">${c.kosten ? _fmtEur(c.kosten) : ''}</span>
          </summary>
          <div style="font-size:9.5px;color:var(--muted);line-height:1.45;margin:3px 0 3px 4px;">${escHtml(c.text)}</div>
          <label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--muted);margin:0 0 3px 4px;">Status
            <select data-change="blackoutInselBewertung('${c.id}',this.value)"
              style="font-size:9px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;">
              ${optionen(hand)}</select>
            ${hand ? `<span>(automatisch: ${INSEL_STATUS[c.auto].label})</span>` : ''}</label>
        </details>`;
      }).join('')}`).join('');

  return steuerung + kacheln + hinweise + `
    <div style="font-size:9px;color:var(--muted);margin-top:4px;">Lastgang: ${escHtml(ins.quelle)}</div>
    <div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">Zuschaltstufen</div>
    ${stufen || '<div style="font-size:9.5px;color:var(--muted);">Keine Stationen erfasst.</div>'}
    ${aus ? `<div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">MS-seitig abschalten</div>${aus}` : ''}
    ${r.lastabwurf.nsAbwurf.length ? `<div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">NS-seitig abwerfen</div>
      ${r.lastabwurf.nsAbwurf.map(a => `<div style="font-size:9.5px;padding:1px 2px;">✕ ${escHtml(a.trafo)}: ${escHtml(a.lokal ? `an ${a.vonName}` : `${a.vonName} → ${a.zuName}`)}
        <span style="color:var(--muted);">${_fmtKw(a.lastKw)}</span></div>`).join('')}` : ''}
    <div style="font-size:9px;color:var(--muted);margin:8px 0 0;text-transform:uppercase;letter-spacing:.05em;">Checkliste</div>
    ${liste}
    <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.45;">
      Abschätzungen für die Planung, keine Netzberechnung nach VDE 0102: x<sub>d</sub>'' ${INSEL_PARAMETER.xdSubtransient},
      Dauerkurzschlussstrom ${INSEL_PARAMETER.ikDauerFaktor} × I<sub>n</sub>, Kabelkapazität ${INSEL_PARAMETER.kabelCapUfProKm} µF/km,
      Zuschaltstufe ≤ ${Math.round(INSEL_PARAMETER.zuschaltAnteilKva * 100)} % der Aggregat-kVA und
      ≤ ${Math.round(INSEL_PARAMETER.lastsprungAnteil * 100)} % Lastsprung. Kosten sind grobe Richtwerte.
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// WÄRME (Schritt 4)
// ══════════════════════════════════════════════════════════════════════════
// Pauschal über die Netzlast der Heizzentrale (Wärme-Lastgang aus „Grundlagen
// berechnen") und die Leistungen der Erzeuger-Panels. Rechnet bei jedem
// Zeichnen neu — ein Jahr stündlich ist schnell.

const WAERME_FARBE = '#ff8a65';
/** @type {any} */
let _waermeLayer = null;

/** Aktive Wärmeerzeuger mit Leistung; der automatische Spitzenlastkessel läuft mit Gas. */
function _waermeErzeuger() {
  const liste = [];
  for (const [key, cfg] of Object.entries(ERZEUGER_CFG)) {
    if (!isErzeugerAktiv(key)) continue;
    const kw = _num(document.getElementById(cfg.leistungId)?.value);
    liste.push({ key, label: cfg.label, kw });
  }
  if (autoGkResult && autoGkResult.leistungKw > 0) {
    liste.push({ key: 'autogk', label: 'Spitzenlastkessel (automatisch)', kw: autoGkResult.leistungKw });
  }
  return liste;
}

function _heizzentrale() {
  const id = Number.parseInt(document.getElementById('netz-zentrale')?.value, 10);
  return Number.isFinite(id) ? _geb(id) : null;
}

/** Wärme-Ergebnis mit und ohne Maßnahme; null ohne Wärme-Lastgang. */
export function blackoutWaermeRechnen() {
  const ss = window.systemState;
  if (!ss?.lastgangKw?.length) return null;
  const e = blackoutEinstellungen().waerme;
  const erzeuger = _waermeErzeuger();
  const gasKw = erzeuger.filter(x => WAERME_ENERGIETRAEGER[x.key] === 'gas').reduce((s, x) => s + x.kw, 0);
  const zweistoffKw = e.zweistoffKw ?? gasKw;
  const sp = thermSpeicherAktiv ? getThermSpeicherParams() : null;
  const puffer = sp?.kapKwh > 0 ? { kapKwh: sp.kapKwh, entladeKw: sp.entladeKw } : null;
  const gemeinsam = {
    last: ss.lastgangKw, erzeuger, szenario: e.szenario, dauerH: e.dauerH, tankL: e.tankL,
    puffer, hilfsPct: e.hilfsPct, hilfsKw: e.hilfsKw,
  };
  const mit = waermeBlackout({ ...gemeinsam, mitNea: e.mitNea, zweistoffKw });
  const ohne = waermeBlackout({ ...gemeinsam, mitNea: false, zweistoffKw: 0 });
  return { mit, ohne, gasKw, zweistoffKw, zweistoffAuto: e.zweistoffKw == null, puffer, heizzentrale: _heizzentrale() };
}

export function blackoutWaermeSet(feld, wert) {
  const e = blackoutEinstellungen().waerme;
  if (feld === 'mitNea') e.mitNea = !!wert;
  else if (feld === 'zweistoffKw') e.zweistoffKw = wert === '' ? null : wert;
  else e[feld] = wert;
  blackoutEinstellungen();                       // normalisieren
  _waermeZeichnen();
  blackoutModusRender();
}

/** Heizzentrale als kritisch mit eigenem Aggregat einstufen — dann zählt sie in der Strom-Bilanz. */
export function blackoutHeizzentraleEinstufen() {
  const g = _heizzentrale();
  if (!g) return;
  g.notstrom = normalisiereNotstrom({ klasse: 'A', eigeneNea: true });
  blackoutModusMarkiereKarte();
  blackoutModusRender();
  window.showHint?.(`„${g.name || 'Heizzentrale'}" ist jetzt Klasse A mit eigenem Aggregat.`, 4000);
}

function _waermeLayerEntfernen() {
  if (_waermeLayer) { _waermeLayer.remove(); _waermeLayer = null; }
}

function _waermeZeichnen() {
  _waermeLayerEntfernen();
  if (!window.blackoutModusAktiv || _tab() !== 'waerme') return;
  const g = _heizzentrale();
  if (!g?.polygon?.length) return;
  const w = blackoutWaermeRechnen();
  const c = polygonCenter(g.polygon);
  _waermeLayer = L.layerGroup().addTo(map);
  const text = w
    ? `<b>🔥 Heizzentrale ${escHtml(g.name || '')}</b><br>Deckung im Ausfall: <b>${Math.round(w.mit.deckungEnergiePct)} %</b>`
      + ` (ohne Maßnahme ${Math.round(w.ohne.deckungEnergiePct)} %)`
      + (w.mit.neaKw ? `<br>Notstrom Hilfsenergie ${_fmtKw(w.mit.neaKw)}` : '')
    : `<b>🔥 Heizzentrale ${escHtml(g.name || '')}</b><br>Wärme-Lastgang fehlt`;
  L.marker([c.lat, c.lng], { icon: _divIcon('🔥', WAERME_FARBE, 30), zIndexOffset: 720 })
    .bindTooltip(text, { className: 'geb-tooltip' }).addTo(_waermeLayer);
}

function _waermeBlock() {
  const e = blackoutEinstellungen().waerme;
  const w = blackoutWaermeRechnen();
  const fmt = v => Math.round(v).toLocaleString('de-DE');
  const knopf = (aktiv, handler, text, titel = '') =>
    `<button class="btn-xs" style="flex:1;${aktiv ? `border-color:${WAERME_FARBE};color:${WAERME_FARBE};background:${WAERME_FARBE}26;` : ''}"
      data-click="${handler}" title="${titel}">${text}</button>`;
  const feld = (label, feldName, wert, einheit, titel, platzhalter = '') => `
    <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:9.5px;" title="${titel}">
      <span style="flex:1;color:var(--muted);">${label}</span>
      <input type="number" min="0" step="any" value="${wert ?? ''}" placeholder="${platzhalter}"
        style="width:74px;font-size:10px;padding:1px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;text-align:right;"
        data-change="blackoutWaermeSet('${feldName}',this.value)"/>
      <span style="width:18px;color:var(--muted);">${einheit}</span>
    </label>`;

  const szenarien = Object.entries(WAERME_SZENARIEN)
    .map(([k, sz]) => knopf(k === e.szenario, `blackoutWaermeSet('szenario','${k}')`, sz.label, sz.kurz)).join('');
  const dauern = INSEL_DAUERN
    .map(([h, t]) => knopf(h === e.dauerH, `blackoutWaermeSet('dauerH',${h})`, t)).join('');

  const eingaben = `
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Ausfall</div>
    <div style="display:flex;gap:3px;margin-top:3px;">${szenarien}</div>
    <div style="display:flex;gap:3px;margin-top:3px;">${dauern}</div>
    <label style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:9.5px;cursor:pointer;"
      title="Kleines Notstromaggregat für Pumpen, Brenner und Regelung der Heizzentrale">
      <input type="checkbox" ${e.mitNea ? 'checked' : ''} data-change="blackoutWaermeSet('mitNea',this.checked)"/> Notstromaggregat an der Heizzentrale</label>
    ${feld('Zweistoffbrenner (Heizöl)', 'zweistoffKw', e.zweistoffKw,
      'kW', 'Heizölleistung der Zweistoffbrenner — leer = Leistung der Gaskessel', w ? fmt(w.gasKw) : '')}
    ${feld('Heizöllager', 'tankL', e.tankL || '', 'l', 'Vorhandenes Lager für Zweistoffbrenner und Heizölkessel — leer = nicht erfasst', 'nicht erfasst')}
    ${feld('Hilfsenergie', 'hilfsPct', e.hilfsPct, '%', 'Pumpen, Brenner, Regelung in % der laufenden Kesselleistung')}
    ${feld('… oder fest', 'hilfsKw', e.hilfsKw || '', 'kW', 'Fester Wert statt Prozentansatz — leer = Prozentansatz', '—')}`;

  if (!w) {
    return eingaben + `<div style="font-size:9.5px;color:#ffa726;margin-top:8px;line-height:1.45;">
      ⚠ Kein Wärme-Lastgang — erst „Grundlagen berechnen" (Wärmenetz), dann erscheint hier die Deckung im Ausfall.</div>`;
  }
  const { mit, ohne } = w;
  const karte = (label, wert, farbe, titel = '') =>
    `<div title="${titel}" style="background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 6px;min-width:0;">
       <div style="font-size:8.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
       <div style="font-size:11.5px;font-weight:700;color:${farbe};white-space:nowrap;">${wert}</div></div>`;
  const ampel = pct => (pct >= 99.5 ? '#66bb6a' : pct >= 60 ? '#ffa726' : '#ef5350');
  const reichweite = mit.reichweiteH == null ? (e.tankL ? '—' : 'Lager fehlt')
    : mit.reichweiteH === Infinity ? '> 30 Tage'
    : mit.reichweiteH >= 48 ? `${(mit.reichweiteH / 24).toFixed(1)} Tage` : `${mit.reichweiteH} h`;
  const kacheln = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:8px;">
      ${karte('Deckung Energie', `${Math.round(mit.deckungEnergiePct)} %`, ampel(mit.deckungEnergiePct),
        `Im ungünstigsten ${mit.dauerH}-h-Fenster · ohne Maßnahme ${Math.round(ohne.deckungEnergiePct)} %`)}
      ${karte('Deckung Leistung', `${Math.round(mit.deckungLeistungPct)} %`, ampel(mit.deckungLeistungPct),
        `${_fmtKw(mit.kapazitaetKw)} verfügbar gegen ${_fmtKw(mit.spitzeKw)} Spitze`)}
      ${karte('Ungedeckt', mit.stundenUngedeckt ? `${mit.stundenUngedeckt} h` : 'keine', mit.stundenUngedeckt ? '#ef5350' : '#66bb6a',
        `${fmt(mit.ungedecktKwh)} kWh fehlen im Fenster`)}
      ${karte('Heizöl im Fenster', `${fmt(mit.oelLiterFenster)} l`, WAERME_FARBE, `Lagerempfehlung ${fmt(mit.tankEmpfehlungL)} l inkl. Zuschlag`)}
      ${karte('Lager reicht', reichweite, mit.reichweiteH != null && mit.reichweiteH < mit.dauerH ? '#ef5350' : WAERME_FARBE,
        'Ab dem ungünstigsten Zeitpunkt, bis das erfasste Lager leer ist')}
      ${karte('Notstrom HZ', mit.neaKw ? _fmtKw(mit.neaKw) : '—', WAERME_FARBE,
        `Hilfsenergie ${mit.hilfsKw.toFixed(1)} kW + Reserve`)}
    </div>`;

  const erzeugerZeilen = mit.erzeuger.map(x => `
      <div style="display:flex;gap:4px;padding:2px;font-size:9.5px;border-bottom:1px solid rgba(255,255,255,.05);"
        title="${escHtml(x.grund || 'läuft im Ausfall')}">
        <span style="width:12px;color:${x.verfuegbar ? '#66bb6a' : '#ef5350'};">${x.verfuegbar ? '✓' : '✕'}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(x.label)}
          ${x.grund ? `<span style="color:var(--muted);">— ${escHtml(x.grund)}</span>` : ''}</span>
        <span style="white-space:nowrap;color:var(--muted);">${_fmtKw(x.kw)}</span>
      </div>`).join('');

  const hz = w.heizzentrale;
  const hzKlasse = normalisiereNotstrom(hz?.notstrom);
  const hzOhneAsset = !!hz && !(anschlussKwJeGebaeude(_aktiveVerbraucher(globalYear)).get(hz.id) > 0);
  const hzZeile = !hz
    ? `<div style="font-size:9px;color:#ffa726;margin-top:6px;">⚠ Keine Heizzentrale im Wärmenetz gewählt — sie wird in der Strom-Bilanz nicht berücksichtigt.</div>`
    : hzKlasse?.klasse === 'A' && hzKlasse.eigeneNea
      ? `<div style="font-size:9.5px;color:#66bb6a;margin-top:6px;">✓ Heizzentrale „${escHtml(hz.name || '')}" ist Klasse A mit eigenem Aggregat.</div>`
        + (hzOhneAsset && mit.neaKw
          ? `<div style="font-size:9px;color:#ffa726;margin-top:3px;line-height:1.4;">⚠ Die Heizzentrale hat kein Verbraucher-Asset — im Strom-Teil zählt ihr Aggregat mit 0 kW statt ${_fmtKw(mit.neaKw)}.</div>`
          : '')
      : `<button class="btn-xs" style="width:100%;margin-top:6px;border-color:${WAERME_FARBE};color:${WAERME_FARBE};"
          data-click="blackoutHeizzentraleEinstufen()"
          title="Setzt die Notstromklasse der Heizzentrale auf A mit eigenem Aggregat">Heizzentrale „${escHtml(hz.name || '')}" als Klasse A mit eigener NEA einstufen</button>`;

  const hinweise = [
    !e.mitNea && 'Ohne Notstrom laufen weder Pumpen noch Brenner — die Gebäude kühlen ab Ausfallbeginn aus (Auskühlzeiten: PV-Analyse › Abb. 10 › Wärme).',
    mit.kwJeTraeger.oel > 0 && !e.tankL && 'Heizöllager nicht erfasst — die Reichweite ist unbekannt, die Deckung rechnet mit unbegrenztem Öl.',
    mit.reichweiteH != null && mit.reichweiteH < mit.dauerH && `Das Lager ist nach ${mit.reichweiteH} h leer — für ${mit.dauerH} h fehlen ${fmt(mit.tankFehltL)} l.`,
    mit.awsv && `Heizöllager über ${fmt(WAERME_PARAMETER.awsvSchwelleL)} l: AwSV-Anzeige und Auflagen beachten.`,
    w.zweistoffAuto && w.gasKw > 0 && WAERME_SZENARIEN[e.szenario].gas === false && 'Zweistoffbrenner-Leistung = Leistung der Gaskessel (Vorgabe).',
    mit.erzeuger.some(x => x.key === 'zweistoff') && w.zweistoffKw > w.gasKw + 0.5 && 'Zweistoffleistung größer als die Gaskessel — setzt zusätzliche Kessel voraus.',
  ].filter(Boolean).map(t => `<div style="font-size:9px;color:#ffa726;margin-top:4px;line-height:1.4;">⚠ ${t}</div>`).join('');

  const kosten = [
    mit.kosten.nea && ['Notstromaggregat Heizzentrale', mit.kosten.nea],
    mit.kosten.zweistoff && ['Zweistoffbrenner', mit.kosten.zweistoff],
    mit.kosten.tank && [`Heizöllager +${fmt(mit.tankFehltL)} l`, mit.kosten.tank],
  ].filter(Boolean);
  const kostenBlock = kosten.length ? `
    <div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">Maßnahmen (Richtwerte)</div>
    ${kosten.map(([t, v]) => `<div style="display:flex;font-size:9.5px;padding:1px 2px;"><span style="flex:1;">${t}</span><span>${_fmtEur(v)}</span></div>`).join('')}
    <div style="display:flex;font-size:10px;padding:2px;border-top:1px solid var(--border);margin-top:2px;font-weight:600;">
      <span style="flex:1;">Summe</span><span style="color:${WAERME_FARBE};">${_fmtEur(mit.kostenSumme)}</span></div>` : '';

  return eingaben + kacheln + hinweise + `
    <div style="font-size:9px;color:var(--muted);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.05em;">Erzeuger im Ausfall</div>
    ${erzeugerZeilen || '<div style="font-size:9.5px;color:var(--muted);">Keine Wärmeerzeuger aktiv.</div>'}
    ${w.puffer ? `<div style="font-size:9.5px;padding:2px;color:var(--muted);">Pufferspeicher ${fmt(w.puffer.kapKwh)} kWh ${e.mitNea ? 'überbrückt Spitzen' : '— ohne Pumpen nicht nutzbar'}</div>` : ''}
    ${hzZeile}
    ${kostenBlock}
    <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.45;">
      Pauschale Betrachtung über die Netzlast der Heizzentrale. Heizöl ${WAERME_PARAMETER.heizwertKwhProL} kWh/l, Kesselwirkungsgrad
      ${Math.round(WAERME_PARAMETER.kesselEta * 100)} %, Lagerzuschlag ${Math.round((WAERME_PARAMETER.tankZuschlag - 1) * 100)} %.
      Festbrennstoffe gelten als ausreichend bevorratet. Wärmepumpen und Stromkessel laufen nicht, weil das Aggregat nur die Hilfsenergie deckt.
    </div>`;
}

/** Gebäude nach Klasse einfärben; nicht eingestufte blass und gestrichelt. */
export function blackoutModusMarkiereKarte() {
  if (!window.blackoutModusAktiv) return;
  const aktiv = window.blackoutGeb;
  for (const g of _alle()) {
    if (!g.polygonLayer) continue;
    const k = NOTSTROM_KLASSEN[normalisiereNotstrom(g.notstrom)?.klasse];
    const ist = g.id === aktiv;
    g.polygonLayer.setStyle({
      color: k ? k.farbe : GRAU,
      weight: ist ? 3.5 : k ? 2 : 1.2,
      dashArray: k?.key === 'C' ? '6 4' : k ? '' : '4 4',
      fillColor: k ? k.farbe : '#ffffff',
      fillOpacity: k ? (k.key === 'C' ? 0.15 : 0.35) : 0.03,
    });
    if (ist) g.polygonLayer.bringToFront();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL
// ══════════════════════════════════════════════════════════════════════════

export function blackoutModusRender() {
  if (!window.blackoutModusAktiv) return;
  let el = document.getElementById(PANEL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Blackout-Modus');
    document.body.appendChild(el);
  }
  el.innerHTML = _html();
}

function _pinselKnopf(key, aktiv) {
  const k = NOTSTROM_KLASSEN[key];
  const farbe = k ? k.farbe : '#90a4ae';
  const taste = k ? { A: 1, B: 2, C: 3 }[key] : 0;
  const text  = k ? `${key} · ${k.label}` : '✕ Entfernen';
  const titel = k ? `${k.label}: ${k.kurz} (Taste ${taste})` : 'Klasse entfernen (Taste 0)';
  return `<button class="btn-xs" style="${aktiv ? `border-color:${farbe};color:${farbe};background:${farbe}26;font-weight:600;` : ''}"
    data-click="blackoutSetPinsel('${key}')" title="${titel}">${text}</button>`;
}

function _bilanzTabelle(b) {
  const zeile = (label, farbe, d, notstrom) => `<tr>
      <td style="padding:2px 4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${farbe};margin-right:4px;"></span>${label}</td>
      <td style="padding:2px 4px;text-align:right;">${d.anzahl}</td>
      <td style="padding:2px 4px;text-align:right;">${_fmtKw(d.anschlussKw)}</td>
      <td style="padding:2px 4px;text-align:right;font-weight:600;">${notstrom}</td></tr>`;
  const rows = NOTSTROM_KLASSEN_KEYS.map(key => {
    const k = NOTSTROM_KLASSEN[key], d = b.klassen[key];
    return zeile(`${key} ${k.label}`, k.farbe, d, key === 'C' ? '—' : _fmtKw(d.notstromKw));
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px;">
      <thead><tr style="color:var(--muted);font-size:9px;">
        <th style="text-align:left;padding:2px 4px;font-weight:400;">Klasse</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;">Geb.</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Summe der Verbraucher-Assets (ohne Gleichzeitigkeit)">Anschluss</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Im Blackout zu versorgende Leistung">Notstrom</th>
      </tr></thead>
      <tbody>${rows}
        <tr style="border-top:1px solid var(--border);">
          <td style="padding:3px 4px;font-weight:600;">Summe</td>
          <td style="padding:3px 4px;text-align:right;">${b.summe.anzahl}</td>
          <td style="padding:3px 4px;text-align:right;">${_fmtKw(b.summe.anschlussKw)}</td>
          <td style="padding:3px 4px;text-align:right;font-weight:700;color:${AKZENT};">${_fmtKw(b.summe.notstromKw)}</td>
        </tr></tbody></table>`;
}

function _kennzahlen(b) {
  const karte = (label, wert, farbe, titel = '') =>
    `<div title="${titel}" style="flex:1;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 6px;">
       <div style="font-size:8.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
       <div style="font-size:12px;font-weight:700;color:${farbe};">${wert}</div></div>`;
  return `<div style="display:flex;gap:4px;margin-top:6px;">
      ${karte('Zentral zu tragen', _fmtKw(b.zentralKw), AKZENT, 'Notstromlast ohne die Gebäude mit eigenem Aggregat — trägt später ein Aggregat am Knoten oder NAP')}
      ${karte('Aggregate am Gebäude', b.neaAmGebaeude.anzahl ? `${b.neaAmGebaeude.anzahl} · ${_fmtKw(b.neaAmGebaeude.kw)}` : '—', NOTSTROM_KLASSEN.A.farbe, 'Klasse-A-Gebäude mit eigenem Aggregat')}
      ${karte('Einspeisepunkte', b.einspeisepunkte || '—', NOTSTROM_KLASSEN.C.farbe, 'Klasse C: Anschlusspunkt für ein mobiles Aggregat')}
    </div>`;
}

function _liste(b) {
  if (!b.zeilen.length) {
    return `<div style="font-size:9.5px;color:var(--muted);margin-top:8px;line-height:1.45;">
      Noch keine Gebäude eingestuft. Klasse oben wählen und Gebäude auf der Karte anklicken.</div>`;
  }
  const aktiv = window.blackoutGeb;
  const zeilen = b.zeilen.map(z => {
    const k = NOTSTROM_KLASSEN[z.klasse];
    const einstellung = z.klasse === 'B'
      ? `<input type="number" min="0" max="100" step="5" value="${z.lastPctVorgabe ? '' : z.lastPct}"
           placeholder="${z.lastPctWirksam}" title="Lastanteil im Notbetrieb in % (leer = Vorgabe)"
           style="width:42px;font-size:9.5px;padding:1px 3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;"
           data-change="blackoutSetLastPct(${z.id},this.value)"/> %`
      : z.klasse === 'A'
        ? `<label title="Eigenes Notstromaggregat direkt am Gebäude" style="display:inline-flex;align-items:center;gap:2px;cursor:pointer;">
             <input type="checkbox" ${z.eigeneNea ? 'checked' : ''} data-change="blackoutSetEigeneNea(${z.id},this.checked)"/> NEA</label>`
        : '';
    return `<div style="display:flex;align-items:center;gap:4px;padding:3px 2px;border-bottom:1px solid rgba(255,255,255,.05);${z.id === aktiv ? 'background:rgba(255,255,255,.05);' : ''}">
        <span style="width:14px;text-align:center;font-weight:700;color:${k.farbe};">${z.klasse}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;"
          data-click="blackoutZeige(${z.id})" title="Auf der Karte zeigen">${escHtml(z.name)}</span>
        <span style="font-size:9.5px;color:${z.anschlussKw > 0 ? 'var(--muted)' : '#ffa726'};white-space:nowrap;"
          title="${z.anschlussKw > 0 ? 'Anschlussleistung aus den Verbraucher-Assets' : 'Kein Verbraucher-Asset mit Leistung am Gebäude'}">${z.anschlussKw > 0 ? _fmtKw(z.anschlussKw) : '⚠ 0 kW'}</span>
        <span style="white-space:nowrap;font-size:9.5px;">${einstellung}</span>
        <button class="btn-xs" style="padding:0 5px;" data-click="blackoutEntfernen(${z.id})" title="Klasse entfernen">✕</button>
      </div>`;
  }).join('');
  return `<div style="margin-top:8px;">
      <div style="display:flex;align-items:center;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">
        <span style="flex:1;">Eingestufte Gebäude</span>
        <button class="btn-xs" style="padding:0 5px;" data-click="blackoutAlleEntfernen()" title="Alle Einstufungen entfernen">alle ✕</button>
      </div>${zeilen}</div>`;
}

function _html() {
  const pinsel = window.blackoutPinsel || 'A';
  const b = blackoutBilanz();
  const vorgabe = blackoutEinstellungen().bLastPct;
  const auswahl = _alle().filter(g => g.selected).length;
  const tab = _tab();
  const reiter = [['klassen', 'Klassen'], ['netz', 'Am Netz'], ['insel', 'Liegenschaft'], ['waerme', 'Wärme']].map(([k, t]) =>
    `<button class="bom-tab${k === tab ? ' aktiv' : ''}" data-click="blackoutSetTab('${k}')">${t}</button>`).join('');
  const kopf = `
    <div class="bom-head">
      <span class="bom-head-title">🛡 Blackout-Modus</span>
      <span style="font-size:9px;color:var(--muted);">Jahr ${b.jahr}</span>
      <button class="btn-xs" data-click="blackoutModusStop()" title="Modus beenden (Esc)">✓ Fertig</button>
    </div>
    <div class="bom-tabs">${reiter}</div>`;
  if (tab === 'netz') return kopf + `<div class="bom-body">${_platzBlock()}</div>`;
  if (tab === 'insel') return kopf + `<div class="bom-body">${_inselBlock()}</div>`;
  if (tab === 'waerme') return kopf + `<div class="bom-body">${_waermeBlock()}</div>`;
  return kopf + `
    <div class="bom-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
        ${_pinselKnopf('A', pinsel === 'A')}${_pinselKnopf('B', pinsel === 'B')}
        ${_pinselKnopf('C', pinsel === 'C')}${_pinselKnopf('weg', pinsel === 'weg')}
      </div>
      ${auswahl ? `<button class="btn-xs" style="width:100%;margin-top:4px;" data-click="blackoutAufAuswahl()"
          title="Aktuelle Klasse allen in Gebäudeliste/-tabelle angekreuzten Gebäuden zuweisen">⊞ Auf ${auswahl} ausgewählte Gebäude anwenden</button>` : ''}
      <div style="display:flex;align-items:center;gap:6px;margin-top:8px;" title="Lastanteil der Klasse B, solange am Gebäude kein eigener Wert steht">
        <span style="font-size:9.5px;color:var(--muted);white-space:nowrap;">Vorgabe B</span>
        <input type="range" min="0" max="100" step="5" value="${vorgabe}" style="flex:1;accent-color:${NOTSTROM_KLASSEN.B.farbe};height:4px;"
          oninput="this.nextElementSibling.textContent=this.value+' %'" data-change="blackoutSetBVorgabe(this.value)"/>
        <span style="min-width:34px;text-align:right;font-size:10.5px;color:${NOTSTROM_KLASSEN.B.farbe};font-weight:600;">${vorgabe} %</span>
      </div>
      ${_bilanzTabelle(b)}
      ${_kennzahlen(b)}
      ${b.summe.ohneLast ? `<div style="font-size:9px;color:#ffa726;margin-top:5px;line-height:1.4;">
        ⚠ ${b.summe.ohneLast} eingestufte${b.summe.ohneLast === 1 ? 's Gebäude hat' : ' Gebäude haben'} kein Verbraucher-Asset mit Leistung — sie zählen mit 0 kW.</div>` : ''}
      ${_liste(b)}
      <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.45;">
        Anschlussleistung = Summe der Verbraucher-Assets je Gebäude, ohne Gleichzeitigkeit.
      </div>
    </div>`;
}
