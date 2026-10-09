// ── 40-baeume.js — Bäume im Projekt und Verschattung der PV-Dächer ──────────
//
// Bäume gehören zum Projekt (gespeichert unter project.baeume), damit ein
// Verschattungsergebnis nachvollziehbar bleibt — es darf sich nicht ändern,
// weil jemand OpenStreetMap bearbeitet. Quellen: Übernahme aus OSM (einmalig,
// lib/baeume-3d.js) und von Hand gesetzte/korrigierte Bäume. Wer eine Höhe
// einträgt, überschreibt die Vorgabe; bearbeitete OSM-Bäume überstehen eine
// erneute Übernahme.
//
// Verschattung (lib/verschattung.js): je Dach eine Stichprobe von Modulen auf
// der Dachhaut (Geometrie der 3D-Ansicht, 32 d3dGebaeudeModell) gegen Baum-
// kronen und Nachbargebäude. Das Ergebnis liegt am Gebäude unter
// g.pvVerschattung.ergebnisse[<Belegungssignatur>] — so passt es immer zur
// gerade gültigen Belegung (auch je Variante), und ein Wechsel zurück braucht
// keine neue Rechnung. Eingeschaltet multipliziert calcGebKwpKorr (03c) den
// Faktor auf; dadurch wirkt er auf PV-Asset, Analysen und Gutachten.
//
// Kartenebene: eigene Pane mit Canvas über den Gebäuden. Außerhalb des
// Bearbeitens nimmt sie keine Klicks an (pointer-events: none).

import { beginInteraction, cancelInteraction } from './lib/interaction-state.js';
import { map } from './02b-gebaeude.js';
import {
  _hasBelegung, calcGebKwpKorr, getGebPvModules, _gebPvSig, _syncPvAssetIfInSync, escHtml, flyTo, showHint,
  _clipPolyHalfPlane, _firstMitteLL, attachGebPvLayer, redrawGebPvModules,
} from './03c-gebaeude-io.js';
import { polygonAreaM2 } from './02c-karte-werkzeuge.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { d3dGebaeudeModell } from './32-3d-ansicht.js';
import { baumOverpassLaden, baeumeAusOverpass, baumKrone, BAUM_FARBEN } from './lib/baeume-3d.js';
import { vsHindernisse, vsFaktoren, vsStichprobe } from './lib/verschattung.js';

const PANEL_ID = 'baum-panel';
const INTERAKTION = 'baeume';
const PANE = 'baumPane';
const GRUEN = '#81c784';
const GELB = '#ffd54f';
const ROT = '#e53935';
const M_PRO_GRAD = 111320;
const RAND_M = 150;              // OSM-Übernahme: Umkreis um die Gebäude
const MAX_BAEUME = 6000;
const PROBEN_JE_FLAECHE = 12;    // Module je Dachfläche, die gerechnet werden
const ERGEBNISSE_JE_GEB = 4;     // gemerkte Belegungsstände je Gebäude
const ARTEN = { laub: 'Laubbaum', nadel: 'Nadelbaum', obst: 'Obstbaum' };

/** @type {any[]} Bäume des Projekts — wird nur in place verändert (window.baumListe() bleibt gültig) */
const _baeume = [];
let _nr = 1;
let _sigCache = null;
let _an = false;              // Verschattung im Ertrag berücksichtigen
let _sichtbar = true;         // Bäume auf der Arbeitskarte
let _bearbeiten = false;
let _offen = false;
let _laedt = false;
let _ladeInfo = '';
/** Empfehlungsschwellen: Verlust durch Verschattung in % */
const _schwellen = { pruefen: 10, nicht: 25 };
let _offenGeb = null;         // aufgeklappte Zeile in der Liste
/** @type {null | {fertig:number, gesamt:number}} */
let _rechnet = null;
let _layer = null;
let _renderer = null;
const _neu = { art: 'laub', hoehe: 12, krone: 8 };
const _autoVersucht = new Set();

const _klemmen = (v, a, b) => Math.max(a, Math.min(b, v));
const _fmt = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const _pct = f => {
  const v = (1 - f) * 100;
  return v < 0.05 ? '±0 %' : `−${_fmt(v, v < 9.95 ? 1 : 0)} %`;
};

/* ══════════════════════════════════════════════════════════════════════════
   DATEN
   ══════════════════════════════════════════════════════════════════════════ */

export function baumListe() { return _baeume; }

/** Kurzsignatur des Baumbestands — ein Verschattungsergebnis mit anderer Signatur ist veraltet. */
export function baumSig() {
  if (_sigCache) return _sigCache;
  let h = 2166136261;
  for (const b of _baeume) {
    const s = `${b.lat.toFixed(6)},${b.lng.toFixed(6)},${b.hoehe.toFixed(1)},${b.krone.toFixed(1)},${b.art};`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  _sigCache = `${_baeume.length}-${(h >>> 0).toString(36)}`;
  return _sigCache;
}

function _normal(b) {
  const lat = +b.lat, lng = +b.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const art = ARTEN[b.art] ? b.art : 'laub';
  const hoehe = _klemmen(+b.hoehe || 12, 1, 60);
  const krone = _klemmen(+b.krone || hoehe * 0.6, 0.5, 30);
  return {
    id: Number.isInteger(b.id) ? b.id : _nr++, lat, lng, hoehe, krone,
    stamm: _klemmen(+b.stamm || krone * 0.04, 0.05, 1.5), art,
    quelle: b.quelle === 'osm' ? 'osm' : 'manuell',
    osmTyp: b.osmTyp || null, osmId: b.osmId ?? null,
    hoeheQuelle: ['osm', 'vorgabe', 'manuell'].includes(b.hoeheQuelle) ? b.hoeheQuelle : 'manuell',
    bearbeitet: !!b.bearbeitet,
    drehung: Number.isFinite(+b.drehung) ? +b.drehung : 0,
    ton: Number.isFinite(+b.ton) ? +b.ton : 1,
  };
}

export function baumCapture() {
  const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    liste: _baeume.map(b => ({
      id: b.id, lat: r(b.lat, 7), lng: r(b.lng, 7), hoehe: r(b.hoehe, 1), krone: r(b.krone, 1), stamm: r(b.stamm, 2),
      art: b.art, quelle: b.quelle, osmTyp: b.osmTyp, osmId: b.osmId, hoeheQuelle: b.hoeheQuelle,
      ...(b.bearbeitet ? { bearbeitet: true } : {}), drehung: r(b.drehung, 3), ton: r(b.ton, 3),
    })),
    verschattungAn: _an,
    sichtbar: _sichtbar,
    schwellen: { ..._schwellen },
  };
}

export function baumRestore(s) {
  if (_bearbeiten) cancelInteraction(INTERAKTION);
  _baeume.length = 0;
  _nr = 1;
  for (const b of s?.liste || []) { const n = _normal(b); if (n) _baeume.push(n); }
  _nr = _baeume.reduce((m, b) => Math.max(m, b.id + 1), 1);
  _an = !!s?.verschattungAn;
  _sichtbar = s?.sichtbar !== false;
  if (s?.schwellen) { _schwellen.pruefen = +s.schwellen.pruefen || 10; _schwellen.nicht = +s.schwellen.nicht || 25; }
  _sigCache = null;
  _autoVersucht.clear();
  _zeichnen();
  window.d3dBaeumeNeu?.();
  baumPanelRender();
}

function _geaendert() {
  _sigCache = null;
  _autoVersucht.clear();
  _zeichnen();
  window.d3dBaeumeNeu?.();
  baumPanelRender();
  window.pvModusRender?.();
}

/* ══════════════════════════════════════════════════════════════════════════
   KARTE
   ══════════════════════════════════════════════════════════════════════════ */

function _pane() {
  let p = map.getPane(PANE);
  if (!p) {
    p = map.createPane(PANE);
    p.style.zIndex = '405';            // über den Gebäuden (overlayPane 400), unter Markern
  }
  p.style.pointerEvents = _bearbeiten ? 'auto' : 'none';
  return p;
}

function _zeichnen() {
  if (!map) return;
  if (_layer) { map.removeLayer(_layer); _layer = null; }
  if (!_sichtbar || !_baeume.length) return;
  _pane();
  if (!_renderer) _renderer = L.canvas({ pane: PANE, padding: 0.3 });
  _layer = L.layerGroup();
  for (const b of _baeume) {
    const farbe = BAUM_FARBEN[b.art] || BAUM_FARBEN.laub;
    const c = L.circle([b.lat, b.lng], {
      radius: b.krone / 2, renderer: _renderer, pane: PANE,
      // Heller Rand: hebt sich auf Satellitenbild (Grün auf Grün) und Karte ab
      color: '#e8f5e9', weight: 1.5, opacity: 0.9,
      // Gestrichelt = Höhe ist nur eine Vorgabe
      dashArray: b.hoeheQuelle === 'vorgabe' ? '3 3' : null,
      fillColor: farbe, fillOpacity: 0.5, interactive: _bearbeiten, bubblingMouseEvents: false,
    });
    if (_bearbeiten) c.on('click', e => { L.DomEvent.stop(e); _baumPopup(b.id); });
    _layer.addLayer(c);
  }
  _layer.addTo(map);
}

export function baumSichtbar(an) {
  _sichtbar = !!an;
  _zeichnen();
  baumPanelRender();
}

/* ── Bearbeiten ──────────────────────────────────────────────────────────── */

export function baumBearbeitenToggle() {
  if (_bearbeiten) { cancelInteraction(INTERAKTION); return; }
  beginInteraction({
    id: INTERAKTION,
    label: '🌳 Bäume',
    hint: 'Karte anklicken = Baum setzen · Baum anklicken = Höhe, Krone, Art ändern oder löschen',
    cancel: () => _bearbeitenAus(),
  });
  _bearbeiten = true;
  _sichtbar = true;
  map.on('click', _kartenKlick);
  _zeichnen();
  _pane();
  baumPanelRender();
}

function _bearbeitenAus() {
  if (!_bearbeiten) return;
  _bearbeiten = false;
  map.off('click', _kartenKlick);
  map.closePopup();
  _zeichnen();
  _pane();
  baumPanelRender();
}

function _kartenKlick(e) {
  if (!_bearbeiten || !e?.latlng) return;
  const krone = _neu.krone;
  const b = _normal({
    lat: e.latlng.lat, lng: e.latlng.lng, hoehe: _neu.hoehe, krone, art: _neu.art,
    quelle: 'manuell', hoeheQuelle: 'manuell', drehung: Math.random() * Math.PI * 2, ton: 1,
  });
  _baeume.push(b);
  _geaendert();
  _baumPopup(b.id);
}

function _baumPopup(id) {
  const b = _baeume.find(x => x.id === id);
  if (!b) return;
  const herkunft = b.quelle === 'osm'
    ? `OpenStreetMap${b.osmTyp && b.osmTyp !== 'einzel' ? ` (${{ reihe: 'Baumreihe', wald: 'Wald', obst: 'Streuobst' }[b.osmTyp] || b.osmTyp})` : ''}`
    : 'von Hand gesetzt';
  const hq = { osm: 'Höhe aus OSM', vorgabe: 'Höhe geschätzt (Vorgabe)', manuell: 'Höhe eingetragen' }[b.hoeheQuelle];
  const el = document.createElement('div');
  el.style.cssText = 'font-size:11px;min-width:190px;';
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:3px;">🌳 Baum</div>
    <div style="font-size:9.5px;color:var(--muted);margin-bottom:6px;">${herkunft} · ${hq}</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center;">
      <span>Art</span>
      <select class="inp-field" data-f="art">${Object.entries(ARTEN).map(([k, l]) =>
        `<option value="${k}"${b.art === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span title="Gesamthöhe bis zur Kronenspitze">Höhe (m)</span>
      <input class="inp-field" type="number" min="1" max="60" step="0.5" value="${b.hoehe}" data-f="hoehe"/>
      <span title="Kronendurchmesser">Krone (m)</span>
      <input class="inp-field" type="number" min="0.5" max="30" step="0.5" value="${b.krone}" data-f="krone"/>
    </div>
    <button class="btn-xs red" style="width:100%;margin-top:7px;" data-a="loeschen">🗑 Baum löschen</button>`;
  el.addEventListener('change', ev => {
    const f = ev.target?.dataset?.f;
    if (f) baumAendern(id, f, ev.target.value);
  });
  el.querySelector('[data-a="loeschen"]').addEventListener('click', () => { map.closePopup(); baumLoeschen(id); });
  L.DomEvent.disableClickPropagation(el);
  L.popup({ offset: [0, -2], maxWidth: 240, className: 'baum-popup' })
    .setLatLng([b.lat, b.lng]).setContent(el).openOn(map);
}

export function baumAendern(id, feld, wert) {
  const b = _baeume.find(x => x.id === id);
  if (!b) return;
  if (feld === 'art' && ARTEN[wert]) b.art = wert;
  if (feld === 'hoehe') { const v = parseFloat(wert); if (Number.isFinite(v)) { b.hoehe = _klemmen(v, 1, 60); b.hoeheQuelle = 'manuell'; } }
  if (feld === 'krone') { const v = parseFloat(wert); if (Number.isFinite(v)) b.krone = _klemmen(v, 0.5, 30); }
  b.bearbeitet = true;
  _geaendert();
}

export function baumLoeschen(id) {
  const i = _baeume.findIndex(x => x.id === id);
  if (i < 0) return;
  _baeume.splice(i, 1);
  _geaendert();
}

export function baumAlleLoeschen(nurOsm) {
  const weg = _baeume.filter(b => !nurOsm || (b.quelle === 'osm' && !b.bearbeitet));
  if (!weg.length) return;
  if (!confirm(nurOsm
    ? `${_fmt(weg.length)} unveränderte OSM-Bäume entfernen? Eigene und bearbeitete Bäume bleiben.`
    : `Alle ${_fmt(weg.length)} Bäume aus dem Projekt entfernen?`)) return;
  const raus = new Set(weg);
  const rest = _baeume.filter(b => !raus.has(b));
  _baeume.length = 0;
  _baeume.push(...rest);
  _geaendert();
}

export function baumVorgabe(feld, wert) {
  if (feld === 'art' && ARTEN[wert]) _neu.art = wert;
  if (feld === 'hoehe') _neu.hoehe = _klemmen(parseFloat(wert) || 12, 1, 60);
  if (feld === 'krone') _neu.krone = _klemmen(parseFloat(wert) || 8, 0.5, 30);
}

/* ── Übernahme aus OpenStreetMap ─────────────────────────────────────────── */

function _gebaeudeMitPolygon() {
  return (window.gebaeude || []).filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3);
}

/** Äußerer Ring [lng, lat] (g.polygon: Liste von {lat,lng} oder [lat,lng], ggf. mit Löchern). */
function _ringLL(g) {
  const p = g.polygon;
  const istPunkt = q => Array.isArray(q) ? typeof q[0] === 'number' : (q && typeof q.lat === 'number');
  const ring = istPunkt(p[0]) ? p : p[0];
  return (ring || []).map(q => Array.isArray(q) ? [+q[1], +q[0]] : [+q.lng, +q.lat])
    .filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
}

function _bbox() {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const g of _gebaeudeMitPolygon()) {
    for (const [lng, lat] of _ringLL(g)) { w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat); }
  }
  if (!Number.isFinite(w)) return null;
  const kx = M_PRO_GRAD * Math.cos((s + n) / 2 * Math.PI / 180);
  return { w: w - RAND_M / kx, e: e + RAND_M / kx, s: s - RAND_M / M_PRO_GRAD, n: n + RAND_M / M_PRO_GRAD };
}

export async function baumOsmUebernehmen() {
  if (_laedt) return;
  const bbox = _bbox();
  if (!bbox) { showHint('Erst Gebäude anlegen — Bäume werden im Umkreis von 150 m um die Gebäude geholt.', 5000); return; }
  _laedt = true;
  _ladeInfo = 'verbinde …';
  baumPanelRender();
  let data;
  try {
    data = await baumOverpassLaden(bbox, {
      fortschritt: m => {
        _ladeInfo = `${m.kacheln > 1 ? `Teil ${m.kachel}/${m.kacheln} · ` : ''}Versuch ${m.versuch}/${m.versuche}`
          + (m.fehler ? ` — zuletzt: ${m.fehler}` : '');
        const el = document.getElementById('baum-ladeinfo');
        if (el) el.textContent = _ladeInfo;
      },
    });
  } catch (e) {
    console.warn('Bäume aus OSM', e);
    showHint(`⚠ ${e?.message || 'OpenStreetMap nicht erreichbar'}. Die Overpass-Server sind zeitweise überlastet — in ein paar Minuten erneut versuchen.`, 8000);
    return;
  } finally {
    _laedt = false;
    _ladeInfo = '';
    baumPanelRender();
  }
  const ausschluss = _gebaeudeMitPolygon().map(_ringLL).filter(r => r.length >= 3);
  const erg = baeumeAusOverpass(data, { bbox, ausschluss, max: MAX_BAEUME });

  // Eigene und bearbeitete Bäume bleiben; neue OSM-Bäume, die näher als 2 m an
  // einem davon stehen, entfallen (die bearbeitete Fassung gewinnt).
  const bleiben = _baeume.filter(b => b.quelle !== 'osm' || b.bearbeitet);
  const altOsm = _baeume.length - bleiben.length;
  const nah = (a, b) => Math.hypot((a.lng - b.lng) * M_PRO_GRAD * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * M_PRO_GRAD) < 2;
  const neu = erg.baeume
    .filter(t => !bleiben.some(b => nah(b, t)))
    .map(t => _normal({ ...t, id: undefined, quelle: 'osm', osmTyp: t.quelle }));
  if (altOsm && !confirm(`${_fmt(altOsm)} bisher übernommene OSM-Bäume durch ${_fmt(neu.length)} aktuelle ersetzen?`
    + (bleiben.length ? `\n${_fmt(bleiben.length)} eigene oder bearbeitete Bäume bleiben.` : ''))) return;
  _baeume.length = 0;
  _baeume.push(...bleiben, ...neu);
  _sichtbar = true;
  _geaendert();
  const z = erg.zahl;
  const ohneHoehe = neu.filter(b => b.hoeheQuelle === 'vorgabe').length;
  showHint(`🌳 ${_fmt(neu.length)} Bäume übernommen (${z.einzel} einzeln, ${z.reihe} in Reihen, ${_fmt(z.wald)} Wald, ${z.obst} Streuobst)`
    + (erg.ausgeduennt ? ' — Flächen ausgedünnt' : '')
    + (ohneHoehe ? `. ${_fmt(ohneHoehe)} ohne Höhenangabe (gestrichelt) — für die Verschattung lohnt es, die Bäume vor den PV-Dächern nachzumessen.` : '.'), 9000);
}

/* ══════════════════════════════════════════════════════════════════════════
   VERSCHATTUNG
   ══════════════════════════════════════════════════════════════════════════ */

function _mitPv() {
  return _gebaeudeMitPolygon().filter(g => g.pvModus === 'flaechen' && _hasBelegung(g));
}

function _eintrag(g) {
  return g?.pvVerschattung?.ergebnisse?.[_gebPvSig(g)] || null;
}

/** 'aktuell' | 'veraltet' (Bäume geändert) | 'fehlt' (für diese Belegung nicht gerechnet) */
function _status(g) {
  const e = _eintrag(g);
  if (!e) return 'fehlt';
  return e.baumSig === baumSig() ? 'aktuell' : 'veraltet';
}

/** Für calcGebKwpKorr (03c): Faktor der aktuellen Belegung oder null. */
export function pvVerschattungFaktor(g) {
  if (!_an || !g?.pvVerschattung || g.pvModus !== 'flaechen') return null;
  const e = _eintrag(g);
  return e && Number.isFinite(e.faktor) ? e.faktor : null;
}

export function pvVerschattungAn() { return _an; }

/** Gruppenschlüssel je Modul (Dachfläche bzw. Satteldachseite). */
function _gruppen(res) {
  return (res?.modules || []).map((m, i) => m.flId != null ? 'fl' + m.flId
    : res.frontCount != null ? (i < res.frontCount ? 'vorne' : 'hinten') : 'dach');
}

/** Für die 3D-Ansicht: Faktor je Modul (Index wie getGebPvModules(g).modules) oder null. */
export function pvVerschattungModulFaktoren(g) {
  const e = _eintrag(g);
  if (!e) return null;
  return _gruppen(getGebPvModules(g)).map(k => e.gruppen?.[k]?.faktor ?? e.faktor);
}

function _gruppenLabel(g, key, res) {
  if (key === 'vorne' || key === 'hinten') {
    const A = res.splitAzimut ?? g.dachAzimut ?? 180;
    const az = key === 'vorne' ? A : (A + 180) % 360;
    return `${key === 'vorne' ? 'Vorderseite' : 'Rückseite'} (${_himmel(az)})`;
  }
  if (key.startsWith('fl')) {
    const id = +key.slice(2);
    const gr = (res.gruppen || []).find(x => x.flId === id);
    return gr ? (gr.flach ? `Fläche ${id} (flach)` : `Fläche ${id} (${_himmel(gr.azimut)}, ${Math.round(gr.neigung)}°)`) : `Fläche ${id}`;
  }
  return 'Dach';
}

function _himmel(az) {
  const r = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return r[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

/** Gemeinsamer lokaler Rahmen + Hindernisse (Bäume, Gebäude) für einen Rechenlauf. */
function _kontext() {
  const geb = _gebaeudeMitPolygon();
  let sx = 0, sy = 0, n = 0;
  for (const g of geb) for (const [lng, lat] of _ringLL(g)) { sx += lng; sy += lat; n++; }
  const lng0 = n ? sx / n : 10, lat0 = n ? sy / n : 51;
  const kx = M_PRO_GRAD * Math.cos(lat0 * Math.PI / 180);
  const xy = (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * M_PRO_GRAD];
  const jahr = window.globalYear;
  const hindernisGeb = [];
  for (const g of geb) {
    let st = '';
    try { st = window.getComputedStats?.(g, jahr)?.status || ''; } catch (e) { void e; }
    if (st === 'geplant' || st === 'abgerissen' || window.isExcluded?.(g.id)) continue;
    const m = d3dGebaeudeModell(g);
    if (m) hindernisGeb.push({ id: g.id, ring: m.ring.map(([lng, lat]) => xy(lng, lat)), hoehe: m.hoehe });
  }
  const hind = vsHindernisse({
    baeume: _baeume.map(b => { const [x, y] = xy(b.lng, b.lat); return { id: b.id, x, y, art: b.art, krone: baumKrone(b) }; }),
    gebaeude: hindernisGeb,
  });
  return { xy, hind, lat0 };
}

function _berechnen(g, k) {
  const res = getGebPvModules(g);
  if (!res?.modules?.length) return null;
  const keys = _gruppen(res);
  const nachGruppe = new Map();
  keys.forEach((key, i) => { if (!nachGruppe.has(key)) nachGruppe.set(key, []); nachGruppe.get(key).push(i); });
  const idx = [], gewicht = new Map();
  for (const liste of nachGruppe.values()) {
    const s = vsStichprobe(liste.length, PROBEN_JE_FLAECHE);
    for (const j of s) { idx.push(liste[j]); gewicht.set(liste[j], liste.length / s.length); }
  }
  const modell = d3dGebaeudeModell(g, idx);
  if (!modell?.module.length) return null;
  const punkte = [];
  for (const { idx: i, ecken } of modell.module) {
    const q = ecken.map(([lng, lat, z]) => [...k.xy(lng, lat), z]);
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const v = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    n = n.map(c => c / l);
    if (n[2] < 0) n = n.map(c => -c);
    const p = [0, 1, 2].map(c => q.reduce((s, e) => s + e[c], 0) / q.length + n[c] * 0.05);
    punkte.push({ p, n, gruppe: keys[i], gewicht: gewicht.get(i) || 1 });
  }
  const hind = { baeume: k.hind.baeume, gebaeude: k.hind.gebaeude.filter(o => o.id !== g.id) };
  const lat = _ringLL(g)[0]?.[1] ?? k.lat0;
  const r = vsFaktoren(punkte, hind, lat);
  const gruppen = {};
  for (const [key, gr] of Object.entries(r.gruppen)) gruppen[key] = { ...gr, label: _gruppenLabel(g, key, res) };
  return {
    faktor: r.faktor, faktorBaeume: r.faktorBaeume, faktorGebaeude: r.faktorGebaeude, gruppen,
    verursacher: r.verursacher.map(v => ({ key: v.key, anteil: Math.round(v.anteil * 10000) / 10000 })),
    ueberlappungen: r.ueberlappungen,
    baumSig: baumSig(), proben: punkte.length, datum: new Date().toISOString(),
  };
}

function _speichern(g, e) {
  const sig = _gebPvSig(g);
  const alt = g.pvVerschattung?.ergebnisse || {};
  const liste = Object.entries({ ...alt, [sig]: e })
    .sort((a, b) => (a[0] === sig ? -1 : b[0] === sig ? 1 : String(b[1].datum).localeCompare(String(a[1].datum))))
    .slice(0, ERGEBNISSE_JE_GEB);
  g.pvVerschattung = { ergebnisse: Object.fromEntries(liste) };
}

function _nachKwpAenderung() {
  try { calcStromPanel(); } catch (e) { void e; }
  window.pvuNachlauf?.();
  window.renderGebPvPanel?.();
  window.pvModusRender?.();
  window.d3dNachViz?.();
  baumPanelRender();
}

/**
 * Verschattung für die PV-Dächer rechnen (in Häppchen, die Oberfläche bleibt bedienbar).
 * @param {boolean} [nurOffene] nur Dächer ohne aktuelles Ergebnis
 */
export async function verschattungBerechnen(nurOffene = true) {
  if (_rechnet) return;
  const ziele = _mitPv().filter(g => !nurOffene || _status(g) !== 'aktuell');
  if (!ziele.length) { showHint('Alle PV-Dächer sind bereits aktuell gerechnet.', 3000); return; }
  const k = _kontext();
  _rechnet = { fertig: 0, gesamt: ziele.length };
  baumPanelRender();
  const t0 = performance.now();
  for (const g of ziele) {
    const vorher = calcGebKwpKorr(g);
    try {
      const e = _berechnen(g, k);
      if (e) _speichern(g, e);
    } catch (err) { console.warn('Verschattung', g.id, err); }
    if (_an) _syncPvAssetIfInSync(g, vorher);
    _rechnet.fertig++;
    const el = document.getElementById('baum-fortschritt');
    if (el) el.textContent = `${_rechnet.fertig} / ${_rechnet.gesamt}`;
    await new Promise(r => setTimeout(r, 0));
  }
  _rechnet = null;
  _nachKwpAenderung();
  showHint(`🌳 Verschattung für ${ziele.length} Dächer gerechnet (${_fmt((performance.now() - t0) / 1000, 1)} s).`, 4000);
}

/** Ein einzelnes Dach nachrechnen (PV-Modus: das aktive Dach, sobald sich die Belegung ändert). */
function _nachrechnenEinzeln(g) {
  const key = g.id + '|' + _gebPvSig(g) + '|' + baumSig();
  if (_rechnet || _autoVersucht.has(key)) return;
  _autoVersucht.add(key);
  setTimeout(() => {
    if (_rechnet || !_an) return;
    const vorher = calcGebKwpKorr(g);
    try {
      const e = _berechnen(g, _kontext());
      if (e) _speichern(g, e);
    } catch (err) { console.warn('Verschattung', g.id, err); return; }
    _syncPvAssetIfInSync(g, vorher);
    _nachKwpAenderung();
  }, 250);
}

export function verschattungUmschalten(an) {
  const neu = !!an;
  if (neu === _an) return;
  const ziele = _mitPv();
  const vorher = new Map(ziele.map(g => [g.id, calcGebKwpKorr(g)]));
  _an = neu;
  for (const g of ziele) _syncPvAssetIfInSync(g, vorher.get(g.id));
  _nachKwpAenderung();
  const offen = ziele.filter(g => _status(g) === 'fehlt').length;
  if (_an && offen) showHint(`${offen} PV-Dächer sind noch nicht gerechnet — „Verschattung berechnen" holt das nach.`, 5000);
}

/* ══════════════════════════════════════════════════════════════════════════
   OBERFLÄCHE
   ══════════════════════════════════════════════════════════════════════════ */

/** Zeile im PV-Modus für das aktive Dach. */
export function baumVerschattungZeileHtml(g) {
  if (!g || !_hasBelegung(g)) return '';
  const e = _eintrag(g), st = _status(g);
  if (_an && st !== 'aktuell') _nachrechnenEinzeln(g);
  if (!e) {
    return `<div style="font-size:9.5px;color:var(--muted);margin-top:5px;">🌳 Verschattung: ${_an ? 'wird gerechnet …' : 'nicht gerechnet'}</div>`;
  }
  const flaechen = Object.values(e.gruppen || {});
  const b = BEWERTUNG[_bewertung(e.faktor)];
  const fl = flaechen.length > 1 ? flaechen.map(f => {
    const bf = BEWERTUNG[_bewertung(f.faktor)];
    return `<div>· ${escHtml(f.label)}: <span style="color:${bf.farbe};">${_pct(f.faktor)} ${bf.sym} ${bf.text}</span></div>`;
  }).join('') : '';
  const urs = (e.verursacher || []).slice(0, 2).map(v => `<span style="cursor:pointer;text-decoration:underline dotted;" data-click="baumVerursacherZeigen('${v.key}')">${_verursacherName(v.key)} −${_fmt(v.anteil * 100, 1)} %</span>`).join(', ');
  return `<div style="font-size:9.5px;margin-top:5px;line-height:1.45;">
      🌳 Verschattung <b style="color:${b.farbe};">${_pct(e.faktor)}</b> <span style="color:${b.farbe};">${b.sym} ${b.text}</span>
      <span style="color:var(--muted);">(Bäume ${_pct(e.faktorBaeume)}, Gebäude ${_pct(e.faktorGebaeude)})</span>
      ${st === 'veraltet' ? `<span style="color:${GELB};" title="Bäume wurden seitdem geändert"> ⚠ veraltet</span>` : ''}
      ${_an ? '' : `<span style="color:var(--muted);"> · nicht im Ertrag</span>`}
      ${fl}
      ${urs ? `<div style="color:var(--muted);">durch ${urs}</div>` : ''}
      ${e.ueberlappungen?.length ? `<div style="color:${ROT};">⧉ Grundriss überlappt mit Nachbargebäude — dort nicht gezählt</div>` : ''}
    </div>`;
}

/** Einstieg im PV-Modus-Panel. */
export function baumBlockHtml() {
  const mitPv = _mitPv();
  const aktuell = mitPv.filter(g => _status(g) === 'aktuell').length;
  return `<button class="btn-xs" style="width:100%;margin-top:6px;border-color:${GRUEN};color:${GRUEN};${_an ? `background:${GRUEN}1a;` : ''}"
      data-click="baumPanelToggle()" title="Bäume im Projekt und ihre Verschattung der PV-Dächer">
      🌳 Bäume & Verschattung · ${_fmt(_baeume.length)} Bäume${mitPv.length ? ` · ${aktuell}/${mitPv.length} gerechnet` : ''}${_an ? ' · im Ertrag' : ''}</button>`;
}

export function baumPanelToggle() {
  _offen = !_offen;
  if (!_offen) {
    if (_bearbeiten) cancelInteraction(INTERAKTION);
    document.getElementById(PANEL_ID)?.remove();
  }
  baumPanelRender();
}

export function baumPanelRender() {
  if (!_offen) return;
  let el = document.getElementById(PANEL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Bäume und Verschattung');
    document.body.appendChild(el);
  }
  el.innerHTML = _html();
}

/* ── Auswertung: Empfehlung je Dachfläche ─────────────────────────────────── */

const BEWERTUNG = {
  ok:      { sym: '✓', farbe: '#4caf50', text: 'belegen' },
  pruefen: { sym: '⚠', farbe: '#f9a825', text: 'prüfen' },
  nicht:   { sym: '✗', farbe: ROT, text: 'nicht belegen' },
};

function _bewertung(f) {
  const v = (1 - f) * 100;
  return v >= _schwellen.nicht ? 'nicht' : v >= _schwellen.pruefen ? 'pruefen' : 'ok';
}

/** Spezifischer Jahresertrag (kWh/kWp) für die Verlustschätzung. */
function _spez() {
  let s = NaN;
  try { s = parseFloat(window.pvGetEffectiveSpez?.()); } catch (e) { void e; }
  return Number.isFinite(s) && s > 0 ? s : 1000;
}

/**
 * Alle gerechneten Dachflächen mit Bewertung, kWp-Anteil und Ertragsverlust.
 * kWp je Fläche anteilig nach Modulzahl aus der unverschatteten wirksamen Leistung.
 */
function _auswertung() {
  const spez = _spez();
  const out = [];
  for (const g of _mitPv()) {
    const e = _eintrag(g);
    if (!e) continue;
    const vs = pvVerschattungFaktor(g);
    const kwpOhne = (calcGebKwpKorr(g) || 0) / (vs || 1);
    const gruppen = Object.entries(e.gruppen || {});
    const module = gruppen.reduce((s, [, gr]) => s + (gr.module || 0), 0) || 1;
    for (const [key, gr] of gruppen) {
      const kwp = kwpOhne * (gr.module || 0) / module;
      out.push({ g, e, key, gr, bew: _bewertung(gr.faktor), kwp, verlustKwh: kwp * spez * (1 - gr.faktor), alleGruppen: gruppen.length });
    }
  }
  return out;
}

function _verursacherName(key) {
  const id = key.slice(1);
  if (key[0] === 'g') {
    const g = (window.gebaeude || []).find(x => String(x.id) === id);
    return g ? '🏢 ' + escHtml(g.name || 'Gebäude ' + g.id) : '🏢 Gebäude (gelöscht)';
  }
  const b = _baeume.find(x => String(x.id) === id);
  return b ? `🌳 ${ARTEN[b.art]} ${_fmt(b.hoehe, b.hoehe < 10 ? 1 : 0)} m${b.hoeheQuelle === 'vorgabe' ? ' <span style="color:' + GELB + ';">(geschätzt)</span>' : ''}`
    : '🌳 Baum (gelöscht)';
}

/** Verursacher als reiner Text (Gutachten). */
function _verursacherText(key) {
  const id = key.slice(1);
  if (key[0] === 'g') {
    const g = (window.gebaeude || []).find(x => String(x.id) === id);
    return g ? (g.name || 'Gebäude ' + g.id) : 'Nachbargebäude';
  }
  const b = _baeume.find(x => String(x.id) === id);
  return b ? `${ARTEN[b.art]} (${_fmt(b.hoehe, b.hoehe < 10 ? 1 : 0)} m${b.hoeheQuelle === 'vorgabe' ? ', geschätzt' : ''})` : 'Baum';
}

/**
 * Zusammenfassung für das Gutachten (17-gutachten-grafik.js, Kapitel 5.4.2).
 * Alle Energien in MWh/a aus wirksamer Leistung × spezifischem Ertrag — dieselbe
 * Schätzung wie die Empfehlung im Panel. null, wenn kein Dach gerechnet ist.
 */
export function verschattungGutachten() {
  const mitPv = _mitPv();
  const st = { aktuell: 0, veraltet: 0, fehlt: 0 };
  for (const g of mitPv) st[_status(g)]++;
  if (!st.aktuell && !st.veraltet) return null;
  const spez = _spez();
  let ertrag = 0, verlust = 0, sB = 0, sG = 0;
  for (const g of mitPv) {
    const e = _eintrag(g);
    if (!e) continue;
    const ertragG = (calcGebKwpKorr(g) || 0) / (pvVerschattungFaktor(g) || 1) * spez / 1000;
    const verlustG = ertragG * (1 - e.faktor);
    ertrag += ertragG; verlust += verlustG;
    // Aufteilung nach Verursachern (additiv) auf den Verlust des Dachs hochrechnen
    let b = 0, gg = 0;
    for (const v of e.verursacher || []) { if (v.key[0] === 'b') b += v.anteil; else gg += v.anteil; }
    if (b + gg > 0) { sB += verlustG * b / (b + gg); sG += verlustG * gg / (b + gg); }
  }
  const flaechen = _auswertung().map(a => ({
    gebaeude: a.g.name || 'Gebäude ' + a.g.id, flaeche: a.gr.label, module: a.gr.module, kwp: a.kwp,
    faktor: a.gr.faktor, bewertung: a.bew,
    ursache: a.e.verursacher?.[0] ? _verursacherText(a.e.verursacher[0].key) : '',
    ursacheTyp: a.e.verursacher?.[0]?.key?.[0] === 'b' ? 'baum' : a.e.verursacher?.[0] ? 'gebaeude' : '',
  })).sort((x, y) => x.faktor - y.faktor);
  const n = { ok: 0, pruefen: 0, nicht: 0 };
  for (const f of flaechen) n[f.bewertung]++;
  return {
    an: _an,
    daecher: mitPv.length, status: st,
    baeume: {
      gesamt: _baeume.length,
      osm: _baeume.filter(b => b.quelle === 'osm').length,
      eigen: _baeume.filter(b => b.quelle !== 'osm').length,
      geschaetzt: _baeume.filter(b => b.hoeheQuelle === 'vorgabe').length,
      geschaetztVerursacher: _geschaetzteVerursacher().length,
    },
    ertragMwh: ertrag, verlustMwh: verlust, verlustBaeumeMwh: sB, verlustGebaeudeMwh: sG,
    spez, schwellen: { ..._schwellen }, bewertung: n, flaechen,
    ueberlappungen: mitPv.filter(g => _eintrag(g)?.ueberlappungen?.length).length,
    proben: PROBEN_JE_FLAECHE,
  };
}

/** Verursacher anklicken: Gebäude bzw. Baum auf der Karte zeigen (Baum: im Bearbeiten-Modus mit Popup). */
export function baumVerursacherZeigen(key) {
  const id = key.slice(1);
  if (key[0] === 'g') { const g = (window.gebaeude || []).find(x => String(x.id) === id); if (g) flyTo(g.id); return; }
  const b = _baeume.find(x => String(x.id) === id);
  if (!b) return;
  map.flyTo([b.lat, b.lng], Math.max(map.getZoom(), 19));
  if (_bearbeiten) setTimeout(() => _baumPopup(b.id), 400);
}

/** Verschattende Bäume mit nur geschätzter Höhe (aus den Verursacher-Listen). */
function _geschaetzteVerursacher() {
  const anteil = new Map();
  for (const g of _mitPv()) {
    for (const v of _eintrag(g)?.verursacher || []) {
      if (v.key[0] !== 'b') continue;
      const b = _baeume.find(x => String(x.id) === v.key.slice(1));
      if (b && b.hoeheQuelle === 'vorgabe') anteil.set(b, Math.max(anteil.get(b) || 0, v.anteil));
    }
  }
  return [...anteil.entries()].filter(([, a]) => a >= 0.01).sort((a, b) => b[1] - a[1]).map(([b]) => b);
}

/** Die verschattenden Bäume mit geschätzter Höhe ansehen und bearbeiten. */
export function baumGeschaetzteZeigen() {
  const liste = _geschaetzteVerursacher();
  if (!liste.length) return;
  if (!_bearbeiten) baumBearbeitenToggle();
  const b = L.latLngBounds(liste.map(x => [x.lat, x.lng]));
  map.fitBounds(b.pad(0.3), { maxZoom: 19 });
  showHint(`${liste.length} Bäume mit geschätzter Höhe verschatten PV-Dächer merklich — anklicken und Höhe eintragen.`, 6000);
}

/** Empfehlungsschwellen (36: Option „stark verschattete Flächen auslassen“). */
export function verschattungSchwellen() { return { ..._schwellen }; }

export function baumSchwelle(feld, wert) {
  const v = _klemmen(parseFloat(wert) || 0, 1, 90);
  if (feld === 'pruefen') _schwellen.pruefen = Math.min(v, _schwellen.nicht);
  if (feld === 'nicht') _schwellen.nicht = Math.max(v, _schwellen.pruefen);
  window.pvModusRender?.();
  baumPanelRender();
}

export function baumZeileToggle(gId) {
  _offenGeb = _offenGeb === gId ? null : gId;
  flyTo(gId);
  baumPanelRender();
}

/** Polygone der Satteldachhälfte (an derselben Firstlinie wie die Modulplatzierung). */
function _haelftePolygone(g, vorne) {
  const bel = (g.pvFlaechen || []).filter(f => f.typ !== 'sperr' && f.polygon && f.polygon.length >= 3);
  if (!bel.length) return [];
  const alle = bel.flatMap(f => f.polygon);
  const maxLat = Math.max(...alle.map(p => p.lat)), minLat = Math.min(...alle.map(p => p.lat));
  const cosL = Math.cos((maxLat + minLat) / 2 * Math.PI / 180);
  const A = getGebPvModules(g).splitAzimut ?? g.dachAzimut ?? 180;
  const C = g.pvRidgeOverride || _firstMitteLL(alle, A);
  return bel.map(f => _clipPolyHalfPlane(f.polygon, C, A, cosL, vorne)).filter(h => h.length >= 3)
    .map(h => h.map(p => ({ lat: p.lat, lng: p.lng })));
}

/** Satteldachhälfte als Sperrfläche anlegen. @returns {number[]} ids der Sperrflächen */
function _haelfteSperren(g, vorne) {
  const ids = [];
  for (const poly of _haelftePolygone(g, vorne)) {
    window._gebPvFlCounter = (window._gebPvFlCounter || 0) + 1;
    const fl = { id: window._gebPvFlCounter, typ: 'sperr', auto: 'schatten',
      polygon: poly, flaeche: polygonAreaM2(poly) || 0, layer: null, svgLayer: null };
    g.pvFlaechen.push(fl);
    attachGebPvLayer(g, fl);
    ids.push(fl.id);
  }
  if (ids.length) redrawGebPvModules(g);
  return ids;
}

/** Dachflächen eines Ergebnisses mit „nicht belegen". */
function _schlechteGruppen(e) {
  return Object.entries(e?.gruppen || {}).filter(([, gr]) => _bewertung(gr.faktor) === 'nicht').map(([k]) => k);
}

/* ── Für die automatische Belegung (36) ─────────────────────────────────────
 * Vorschau: Verschattung auf der Rechenkopie aus 25 pvmProbe, stark verschattete
 * Dachflächen bzw. Satteldachseiten aus der Kopie nehmen (die Kopie ist auch
 * Grundlage eines Belegungsstands). Übernehmen: dasselbe auf dem echten Dach,
 * im selben Strg+Z-Schritt wie die Belegung (25 pvmStapelBelegen nachBelegen). */

/** Hindernisse einmal je Lauf. */
export function verschattungKontext() { return _kontext(); }

/**
 * Probebelegung prüfen und kürzen.
 * @returns {null | {faktor:number, ganz:boolean, ausgelassen:string[], verlustPct:number}}
 *   ganz = das ganze Dach ist zu stark verschattet; faktor = nach dem Kürzen
 */
export function verschattungProbe(t, k) {
  const e = _berechnen(t, k);
  if (!e) return null;
  _speichern(t, e);
  const schlecht = _schlechteGruppen(e);
  const verlustPct = (1 - e.faktor) * 100;
  if (!schlecht.length) return { faktor: e.faktor, ganz: false, ausgelassen: [], verlustPct };
  if (schlecht.length >= Object.keys(e.gruppen || {}).length) return { faktor: e.faktor, ganz: true, ausgelassen: schlecht, verlustPct };
  for (const key of schlecht) {
    if (key.startsWith('fl')) { const id = +key.slice(2); t.pvFlaechen = t.pvFlaechen.filter(f => f.id !== id); }
    else if (key === 'vorne' || key === 'hinten') {
      for (const poly of _haelftePolygone(t, key === 'vorne')) {
        t.pvFlaechen = [...t.pvFlaechen, { id: -100 - t.pvFlaechen.length, typ: 'sperr', auto: 'schatten', polygon: poly, flaeche: polygonAreaM2(poly) || 0 }];
      }
    }
  }
  t._pvModCache = null; t._pvModSig = null;
  const e2 = _berechnen(t, k);
  if (e2) _speichern(t, e2);
  return { faktor: e2?.faktor ?? e.faktor, ganz: false, ausgelassen: schlecht, verlustPct };
}

/**
 * Nach dem Belegen eines echten Dachs: stark verschattete Flächen entfernen bzw.
 * Satteldachseiten sperren, Ergebnis speichern.
 * @returns {number[]} ids neu angelegter Sperrflächen (für den Strg+Z-Schritt)
 */
export function verschattungNachBelegen(g, k) {
  const e = _berechnen(g, k);
  if (!e) return [];
  _speichern(g, e);
  const schlecht = _schlechteGruppen(e);
  if (!schlecht.length) return [];
  const ganz = schlecht.length >= Object.keys(e.gruppen || {}).length;
  const ids = [];
  for (const key of ganz ? [] : schlecht) {
    if (key.startsWith('fl')) window.removeGebPvFlaeche?.(g.id, +key.slice(2));
    else if (key === 'vorne' || key === 'hinten') ids.push(..._haelfteSperren(g, key === 'vorne'));
  }
  if (ganz) for (const fl of (g.pvFlaechen || []).filter(f => f.typ === 'belegung')) window.removeGebPvFlaeche?.(g.id, fl.id);
  if (_hasBelegung(g)) { const e2 = _berechnen(g, k); if (e2) _speichern(g, e2); }
  return ids;
}

/** Hinweis im Panel: belegte, verwinkelte Dächer mit nur einem Satteldach. */
export function baumFluegelUmstellen() {
  const liste = window.dachGrundrissKandidatenBelegt?.() || [];
  if (!liste.length) return;
  if (!confirm(`${liste.length} belegte Gebäude mit verwinkeltem Grundriss in Flügel zerlegen und neu belegen?\n\n`
    + 'Jeder Flügel bekommt ein eigenes Dach (Dachform und Neigung wie eingestellt); die Belegung wird je Dachfläche neu angelegt, '
    + 'eigene Sperrflächen bleiben. Strg+Z im PV-Modus holt die alte Belegung zurück.')) return;
  const r = window.dachGrundrissFuerGebaeude?.(liste.map(g => g.id));
  if (!r) return;
  showHint(`📐 ${r.gebaeude} Gebäude in Flügel zerlegt · ${r.anzahl} Dächer neu belegt (Σ ${_fmt(r.summe)} kWp) — Verschattung wird nachgerechnet.`, 7000);
  verschattungBerechnen(true);
}

/** Alle als „nicht belegen" bewerteten Dachflächen aus der Belegung nehmen (ein Planungsschritt). */
export function verschattetEntfernen() {
  const ziele = _auswertung().filter(a => a.bew === 'nicht');
  if (!ziele.length) return;
  const jeGeb = new Map();
  for (const a of ziele) { if (!jeGeb.has(a.g)) jeGeb.set(a.g, []); jeGeb.get(a.g).push(a); }
  const kwp = ziele.reduce((s, a) => s + a.kwp * a.gr.faktor, 0);
  const mwh = ziele.reduce((s, a) => s + a.kwp * _spez() * a.gr.faktor, 0) / 1000;
  const ganz = [...jeGeb.entries()].filter(([, l]) => l.length >= l[0].alleGruppen);
  if (!confirm(`${ziele.length} stark verschattete Dachflächen (Verlust ≥ ${_schwellen.nicht} %) aus der Belegung nehmen?\n\n`
    + `Das sind ≈ ${_fmt(kwp, 1)} kWp wirksame Leistung bzw. ≈ ${_fmt(mwh, 1)} MWh/a Ertrag.\n`
    + `${ganz.length} Dächer werden ganz geräumt (samt PV-Asset), bei den übrigen nur die betroffene Fläche.\n\n`
    + 'Strg+Z im PV-Modus nimmt den Schritt zurück; die Belegungsstände halten ihn bis zum Speichern als Entwurf.')) return;
  const lauf = () => {
    for (const [g, liste] of jeGeb) {
      if (liste.length >= liste[0].alleGruppen) {
        for (const a of (window.ASSETS?.items || []).filter(x => x.type === 'PV' && x.buildingId === g.id)) window.deleteAsset?.(a.id, true);
        window.pvBelegungEntfernen?.([g.id]);
        continue;
      }
      const vorher = calcGebKwpKorr(g);
      for (const a of liste) {
        if (a.key.startsWith('fl')) window.removeGebPvFlaeche?.(g.id, +a.key.slice(2));
        else if (a.key === 'vorne' || a.key === 'hinten') _haelfteSperren(g, a.key === 'vorne');
      }
      _syncPvAssetIfInSync(g, vorher);
    }
  };
  try {
    if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction('Verschattete PV-Flächen entfernen', lauf);
    else lauf();
  } catch (err) {
    console.error(err);
    alert('Entfernen fehlgeschlagen: ' + err.message);
    return;
  }
  window.pvmPlanungsSchrittMerken?.();
  window.recalcStromNetz?.();
  window.redrawAllAssets?.();
  window.renderList?.();
  window.pvModusMarkiereKarte?.();
  _nachKwpAenderung();
  showHint(`✗ ${ziele.length} verschattete Flächen aus der Belegung genommen (≈ ${_fmt(kwp, 1)} kWp).`, 6000);
  // Teilweise geräumte Dächer haben jetzt eine neue Belegung → nachrechnen
  verschattungBerechnen(true);
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

function _empfehlungHtml(auswertung) {
  if (!auswertung.length) return '';
  const n = { ok: 0, pruefen: 0, nicht: 0 }, kwp = { ok: 0, pruefen: 0, nicht: 0 };
  for (const a of auswertung) { n[a.bew]++; kwp[a.bew] += a.kwp; }
  const verlust = auswertung.reduce((s, a) => s + a.verlustKwh, 0) / 1000;
  const ertrag = auswertung.reduce((s, a) => s + a.kwp, 0) * _spez() / 1000;
  const zahl = k => `<div style="flex:1;text-align:center;padding:3px 2px;border:1px solid ${BEWERTUNG[k].farbe}55;border-radius:4px;background:${BEWERTUNG[k].farbe}12;"
      title="${_fmt(kwp[k], 0)} kWp wirksame Leistung (ohne Verschattung)">
      <div style="color:${BEWERTUNG[k].farbe};font-weight:700;font-size:12px;">${BEWERTUNG[k].sym} ${n[k]}</div>
      <div style="font-size:8.5px;color:var(--muted);">${BEWERTUNG[k].text}</div></div>`;
  const geschaetzt = _geschaetzteVerursacher();
  const ueber = _mitPv().filter(g => _eintrag(g)?.ueberlappungen?.length);
  return `
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:9px 0 4px;">Empfehlung je Dachfläche</div>
    <div style="display:flex;gap:4px;">${zahl('ok')}${zahl('pruefen')}${zahl('nicht')}</div>
    <div style="display:flex;align-items:center;gap:4px;font-size:9.5px;color:var(--muted);margin-top:4px;" title="Verlust durch Verschattung, ab dem eine Fläche geprüft bzw. nicht belegt werden sollte">
      prüfen ab <input class="inp-field" type="number" min="1" max="90" value="${_schwellen.pruefen}" style="width:40px;padding:1px 3px;" data-change="baumSchwelle('pruefen',this.value)"/> %
      · nicht ab <input class="inp-field" type="number" min="1" max="90" value="${_schwellen.nicht}" style="width:40px;padding:1px 3px;" data-change="baumSchwelle('nicht',this.value)"/> %
    </div>
    <div style="font-size:10px;margin-top:4px;" title="Wirksame Leistung × ${_fmt(_spez(), 0)} kWh/kWp × Verlustanteil, über alle gerechneten Dachflächen">
      Ertragsverlust durch Verschattung: <b>≈ ${_fmt(verlust, verlust < 10 ? 1 : 0)} MWh/a</b>
      <span style="color:var(--muted);">(${_fmt(ertrag > 0 ? verlust / ertrag * 100 : 0, 1)} % des Dachertrags)</span></div>
    ${n.nicht ? `<button class="btn-xs red" style="width:100%;margin-top:5px;" data-click="verschattetEntfernen()"
        title="Flächen mit ≥ ${_schwellen.nicht} % Verlust aus der Belegung nehmen (Dachflächen, Satteldachseiten oder ganze Dächer) — fragt vorher nach">
        ✗ ${n.nicht} verschattete ${n.nicht === 1 ? 'Fläche' : 'Flächen'} aus der Belegung nehmen …</button>` : ''}
    ${geschaetzt.length ? `<div style="margin-top:5px;padding:4px 6px;border:1px solid ${GELB}55;border-radius:4px;font-size:9.5px;line-height:1.4;">
        ⚠ <b>${geschaetzt.length}</b> verschattende Bäume haben nur eine <b>geschätzte Höhe</b> — sie bestimmen das Ergebnis mit.
        <a style="color:${GELB};cursor:pointer;text-decoration:underline;" data-click="baumGeschaetzteZeigen()">zeigen &amp; nachtragen</a></div>` : ''}
    ${ueber.length ? `<div style="margin-top:5px;padding:4px 6px;border:1px solid ${ROT}55;border-radius:4px;font-size:9.5px;line-height:1.4;"
        title="${escHtml(ueber.map(g => g.name || 'Gebäude ' + g.id).join(', '))}">
        ⚠ Bei <b>${ueber.length}</b> Dächern überlappt der Grundriss mit einem Nachbargebäude (Gebäudeteile oder Doppelerfassung).
        Das Nachbargebäude zählt dort nicht als Schatten — <a style="color:${ROT};cursor:pointer;text-decoration:underline;" data-click="grundrissPanelToggle()">⧉ Grundrisse prüfen</a>.</div>` : ''}`;
}

/** Belegte, verwinkelte Dächer, die noch mit einem Satteldach über den ganzen Grundriss rechnen. */
function _fluegelHinweisHtml() {
  const liste = window.dachGrundrissKandidatenBelegt?.() || [];
  if (!liste.length) return '';
  return `<div style="margin-top:6px;padding:4px 6px;border:1px solid ${GELB}55;border-radius:4px;font-size:9.5px;line-height:1.4;"
      title="${escHtml(liste.map(g => g.name || 'Gebäude ' + g.id).join(', '))}">
      ⚠ <b>${liste.length}</b> belegte Dächer mit verwinkeltem Grundriss rechnen mit <b>einem</b> Satteldach über den ganzen Grundriss —
      Ausrichtung, Modulhöhe und Verschattung sind dort ungenau.
      <button class="btn-xs" style="width:100%;margin-top:4px;border-color:${GELB};color:${GELB};" data-click="baumFluegelUmstellen()"
        title="Jeder Flügel bekommt ein eigenes Dach; die Belegung wird je Dachfläche neu angelegt (Strg+Z im PV-Modus holt die alte zurück)">📐 In Flügel zerlegen und neu belegen</button></div>`;
}

function _zeileHtml(g, e, s) {
  const offen = _offenGeb === g.id;
  const bew = e ? _bewertung(Math.min(...Object.values(e.gruppen || {}).map(x => x.faktor), e.faktor)) : null;
  const kopf = `
    <div style="display:flex;align-items:center;gap:5px;font-size:10px;padding:1px 0;cursor:pointer;" data-click="baumZeileToggle(${g.id})"
      title="Aufklappen: Dachflächen und Ursachen">
      <span style="width:10px;color:var(--muted);">${e ? (offen ? '▾' : '▸') : ''}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(g.name || 'Gebäude ' + g.id)}</span>
      ${e?.ueberlappungen?.length ? `<span style="color:${ROT};" title="Grundriss überlappt mit Nachbargebäude">⧉</span>` : ''}
      ${e ? `<span style="font-family:'DM Mono',monospace;color:${BEWERTUNG[_bewertung(e.faktor)].farbe};">${_pct(e.faktor)}</span>
             <span style="width:11px;text-align:center;color:${BEWERTUNG[bew].farbe};" title="schlechteste Dachfläche: ${BEWERTUNG[bew].text}">${BEWERTUNG[bew].sym}</span>` : ''}
      <span style="width:11px;text-align:center;color:var(--muted);" title="${{ aktuell: 'aktuell', veraltet: 'Bäume seitdem geändert', fehlt: 'für diese Belegung nicht gerechnet' }[s]}">${{ aktuell: '', veraltet: '⟳', fehlt: '·' }[s]}</span>
    </div>`;
  if (!offen || !e) return kopf;
  const flaechen = Object.values(e.gruppen || {}).map(gr => {
    const b = BEWERTUNG[_bewertung(gr.faktor)];
    return `<div style="display:flex;gap:5px;"><span style="flex:1;">${escHtml(gr.label)} · ${gr.module} Mod.</span>
      <span style="color:${b.farbe};">${_pct(gr.faktor)} ${b.sym} ${b.text}</span></div>`;
  }).join('');
  const urs = (e.verursacher || []).map(v => `
      <div style="display:flex;gap:5px;cursor:pointer;" data-click="baumVerursacherZeigen('${v.key}')" title="Auf der Karte zeigen">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_verursacherName(v.key)}</span>
        <span style="font-family:'DM Mono',monospace;">−${_fmt(v.anteil * 100, 1)} %</span></div>`).join('');
  const ueber = (e.ueberlappungen || []).map(id => (window.gebaeude || []).find(x => x.id === id)).filter(Boolean);
  return kopf + `
    <div style="margin:2px 0 5px 15px;padding:4px 6px;border-left:2px solid var(--border);font-size:9.5px;line-height:1.5;">
      ${flaechen}
      ${urs ? `<div style="color:var(--muted);margin-top:3px;">Verursacht durch</div>${urs}` : '<div style="color:var(--muted);margin-top:3px;">Keine nennenswerten Hindernisse.</div>'}
      ${ueber.length ? `<div style="color:${ROT};margin-top:3px;">⧉ Grundriss überlappt mit ${ueber.map(o => escHtml(o.name || 'Gebäude ' + o.id)).join(', ')} — dort nicht als Schatten gezählt.</div>` : ''}
    </div>`;
}

function _html() {
  const anzahl = _baeume.length;
  const osm = _baeume.filter(b => b.quelle === 'osm').length;
  const vorgabe = _baeume.filter(b => b.hoeheQuelle === 'vorgabe').length;
  const mitPv = _mitPv();
  const st = { aktuell: 0, veraltet: 0, fehlt: 0 };
  for (const g of mitPv) st[_status(g)]++;
  const offen = st.veraltet + st.fehlt;
  const auswertung = _auswertung();

  const zeilen = mitPv
    .map(g => ({ g, e: _eintrag(g), s: _status(g) }))
    .sort((a, b) => (a.e?.faktor ?? 2) - (b.e?.faktor ?? 2))
    .map(({ g, e, s }) => _zeileHtml(g, e, s)).join('');

  const feld = (f, wert, min, max, step) => `<input class="inp-field" type="number" min="${min}" max="${max}" step="${step}" value="${wert}"
      style="width:100%;padding:2px 4px;" data-change="baumVorgabe('${f}',this.value)"/>`;

  return `
    <div class="pvm-head">
      <span class="pvm-head-title">🌳 Bäume & Verschattung</span>
      <button class="btn-xs" data-click="baumPanelToggle()" title="Schließen">✕</button>
    </div>
    <div class="pvm-body">
      <div style="font-size:10px;line-height:1.5;">
        <b>${_fmt(anzahl)}</b> Bäume im Projekt${anzahl ? ` · ${_fmt(osm)} aus OSM · ${_fmt(anzahl - osm)} eigene` : ''}
        ${vorgabe ? `<div style="color:${GELB};font-size:9.5px;" title="Ohne Höhenangabe gilt eine Vorgabe (Einzelbaum 12 m, Wald 20 m, Obstbaum 6 m). Auf der Karte gestrichelt.">⚠ ${_fmt(vorgabe)} mit geschätzter Höhe (gestrichelt)</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn-xs" style="flex:1;border-color:${GRUEN};color:${GRUEN};" data-click="baumOsmUebernehmen()" ${_laedt ? 'disabled' : ''}
          title="Einzelbäume, Baumreihen, Wald und Streuobst im Umkreis von 150 m um die Gebäude aus OpenStreetMap ins Projekt holen. Eigene und bearbeitete Bäume bleiben erhalten.">
          ${_laedt ? '⏳ lädt …' : '🌐 Aus OSM übernehmen'}</button>
        <button class="btn-xs" style="flex:1;${_bearbeiten ? `border-color:${GRUEN};color:${GRUEN};background:${GRUEN}1f;` : ''}" data-click="baumBearbeitenToggle()"
          title="Karte anklicken = Baum setzen · Baum anklicken = bearbeiten · Esc = fertig">✎ ${_bearbeiten ? 'Bearbeiten beenden' : 'Setzen & bearbeiten'}</button>
      </div>
      ${_laedt ? `<div id="baum-ladeinfo" style="font-size:9.5px;color:var(--muted);margin-top:3px;">${escHtml(_ladeInfo)}</div>` : ''}
      ${_bearbeiten ? `
      <div style="margin-top:5px;padding:5px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Neuer Baum</div>
        <div style="display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:4px;font-size:9.5px;color:var(--muted);">
          <span>Art</span><span>Höhe m</span><span>Krone m</span>
          <select class="inp-field" style="padding:2px;" data-change="baumVorgabe('art',this.value)">${Object.entries(ARTEN).map(([k, l]) =>
            `<option value="${k}"${_neu.art === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
          ${feld('hoehe', _neu.hoehe, 1, 60, 0.5)}${feld('krone', _neu.krone, 0.5, 30, 0.5)}
        </div>
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
        <label style="display:flex;align-items:center;gap:4px;flex:1;font-size:10px;cursor:pointer;">
          <input type="checkbox" ${_sichtbar ? 'checked' : ''} style="accent-color:${GRUEN};" data-change="baumSichtbar(this.checked)"/>auf der Karte zeigen</label>
        ${anzahl ? `<button class="btn-xs" data-click="baumAlleLoeschen(true)" title="Unveränderte OSM-Bäume entfernen">🗑 OSM</button>
        <button class="btn-xs red" data-click="baumAlleLoeschen(false)" title="Alle Bäume entfernen">🗑 alle</button>` : ''}
      </div>

      <div style="margin-top:9px;border-top:1px solid var(--border);padding-top:7px;">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Verschattung der PV-Dächer</div>
        <label style="display:flex;align-items:center;gap:5px;font-size:10.5px;cursor:pointer;"
          title="Der Faktor je Dach mindert die wirksame Leistung (kWp × Ertragsfaktor) — und damit PV-Asset, Stromnetz, PV-Analyse und Gutachten">
          <input type="checkbox" ${_an ? 'checked' : ''} style="accent-color:${GRUEN};" data-change="verschattungUmschalten(this.checked)"/>
          <b>im Ertrag berücksichtigen</b></label>
        <button class="btn-xs" style="width:100%;margin-top:5px;border-color:${GRUEN};color:${GRUEN};" ${_rechnet || !mitPv.length ? 'disabled' : ''}
          data-click="verschattungBerechnen(${offen ? 'true' : 'false'})"
          title="Je Dach eine Stichprobe von Modulen gegen Baumkronen und Nachbargebäude rechnen">
          ${_rechnet ? `⏳ rechnet … <span id="baum-fortschritt">${_rechnet.fertig} / ${_rechnet.gesamt}</span>`
            : offen ? `▶ Verschattung berechnen (${offen} ${offen === 1 ? 'Dach' : 'Dächer'})` : '↻ Alle neu berechnen'}</button>
        ${mitPv.length ? `<div style="font-size:9.5px;color:var(--muted);margin-top:3px;">
          ${st.aktuell} aktuell${st.veraltet ? ` · <span style="color:${GELB};">${st.veraltet} veraltet</span>` : ''}${st.fehlt ? ` · ${st.fehlt} nicht gerechnet` : ''}</div>`
          : '<div style="font-size:9.5px;color:var(--muted);margin-top:3px;">Noch keine PV-Dächer belegt.</div>'}
        ${_fluegelHinweisHtml()}
        ${_empfehlungHtml(auswertung)}
        ${zeilen ? `<div style="max-height:220px;overflow-y:auto;margin-top:6px;padding:3px 6px;background:var(--bg);border-radius:4px;border:1px solid var(--border);">${zeilen}</div>` : ''}
        <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.45;">
          Jahresfaktor aus Sonnenbahn und Himmel (Richtwerte Mitte Deutschland), je Dachfläche bis zu ${PROBEN_JE_FLAECHE} Module.
          Kronen lassen Licht durch — Laubbäume belaubt ≈ 20 %, kahl ≈ 60 %, Nadelbäume ≈ 15 %.
          Nachbargebäude zählen bis Traufe + halbe Dachhöhe (ohne LoD2 höchstens 8 m Dach). Nach Änderungen an Nachbargebäuden „Alle neu berechnen".
        </div>
      </div>
    </div>`;
}

// Für data-click im Panel (main.js spiegelt die Exporte ebenfalls auf window)
window.baumListe = baumListe;
window.pvVerschattungFaktor = pvVerschattungFaktor;
