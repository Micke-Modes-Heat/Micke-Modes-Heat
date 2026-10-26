// @ts-check
// ── 57-karten-bezug.js — Auswertung und Karte verknüpft ──────────────────────
//
// Gedacht für zwei Bildschirme (Karte im Hauptfenster, Auswertung im Auswertungsfenster src/55),
// wirkt aber genauso in einem Fenster. Zeilen der Auswertung, die ein Objekt auf der Karte meinen,
// tragen data-karte="geb:<id>", "asset:<id>" oder "kabel:<id>". Dann gilt:
//   - Überfahren: das Objekt leuchtet auf der Karte auf — die Karte bleibt, wo sie ist.
//   - Klick: die Karte fliegt hin, das Objekt leuchtet auf und wird ausgewählt (Gebäude-Karte bzw.
//     Inspektor). Hat die Zeile einen eigenen Klick (z. B. ebSpringeZu im Ergebnisblatt, Auswahl
//     in der Knotenpunkt-Analyse), läuft der wie bisher; dann nur hinfliegen und aufleuchten.
//   - Umgekehrt: wird auf der Karte ein Gebäude oder eine Anlage gewählt, bekommen passende Zeilen
//     die Klasse kb-auswahl, und die erste rückt in den sichtbaren Bereich.
// Neue Listen machen mit, indem sie das Attribut setzen — sonst ist nichts zu tun.

import { gebaeude, selectedId, stromEdges } from './01-globals-varianten.js';
import { ASSETS } from './13a-assets-core.js';

const DAUER_KLICK_MS = 2600;
const TAKT_MS = 500;

/** @type {any} */
let _ebene = null;
let _timer = 0;
/** @type {Element|null} */
let _ueber = null;
let _auswahlSchluessel = '';

// Bewusst über window: die Karte liegt in 02b als window._appLeafletMap (ein Import zöge den Kern-Zyklus mit)
const _karte = () => /** @type {any} */ (window)._appLeafletMap || null;

/** Objekt zu einem Bezug „art:id“ finden: Geometrie für die Karte + wie man es auswählt. */
function _objekt(/** @type {string} */ bezug) {
  const i = bezug.indexOf(':');
  const art = bezug.slice(0, i), id = bezug.slice(i + 1);
  if (art === 'geb') {
    const g = gebaeude.find(x => String(x.id) === id);
    const layer = g?.polygonLayer;
    return layer ? { art, ding: g, latlngs: layer.getLatLngs(), bounds: layer.getBounds() } : null;
  }
  if (art === 'asset') {
    const a = /** @type {any[]} */ (ASSETS.items || []).find(x => String(x.id) === id);
    return a && a.lat != null && a.lng != null ? { art, ding: a, punkt: [a.lat, a.lng] } : null;
  }
  if (art === 'kabel') {
    const e = (stromEdges || []).find(x => String(x.id) === id);
    const layer = e?.layer;
    return layer?.getLatLngs ? { art, ding: e, linie: layer.getLatLngs(), bounds: layer.getBounds() } : null;
  }
  return null;
}

function _weg() {
  clearTimeout(_timer);
  _timer = 0;
  if (_ebene) { _ebene.remove(); _ebene = null; }
}

/**
 * Objekt auf der Karte aufleuchten lassen.
 * @param {string} bezug  „geb:12“, „asset:a7“, „kabel:e3“
 * @param {{ fliegen?: boolean, dauer?: number }} [opt]
 */
export function kbZeigen(bezug, opt = {}) {
  const m = _karte(), L = /** @type {any} */ (window).L;
  const o = _objekt(bezug);
  if (!m || !L || !o) return false;
  _weg();
  const stil = { color: '#ff6d00', weight: 4, opacity: 0.95, fill: false, className: 'kb-puls', interactive: false };
  if (o.latlngs) _ebene = L.polygon(o.latlngs, stil);
  else if (o.linie) _ebene = L.polyline(o.linie, { ...stil, weight: 7 });
  else _ebene = L.circleMarker(o.punkt, { ...stil, radius: 18 });
  _ebene.addTo(m);
  if (opt.fliegen) {
    if (o.bounds) m.flyToBounds(o.bounds, { padding: [60, 60], maxZoom: 19, duration: 0.8 });
    else m.flyTo(o.punkt, Math.max(m.getZoom(), 18), { duration: 0.8 });
  }
  if (opt.dauer) _timer = /** @type {any} */ (setTimeout(_weg, opt.dauer));
  return true;
}

/** Objekt im Hauptfenster auswählen — wie ein Klick auf der Karte, aber ohne die Auswahl umzuschalten. */
function _auswaehlen(/** @type {string} */ bezug) {
  const o = _objekt(bezug);
  const w = /** @type {any} */ (window);
  if (!o) return;
  if (o.art === 'geb' && selectedId !== o.ding.id) w.selectFromMap?.(o.ding.id);
  else if (o.art === 'asset') w.openAssetInspector?.(o.ding);
  else if (o.art === 'kabel') w.openCableInspector?.(o.ding);
}

// ── Ereignisse (je Dokument: Hauptfenster und Auswertungsfenster) ──────────
const _STEUER = 'button,a,input,select,textarea,label,summary';

function _klick(/** @type {MouseEvent} */ e) {
  const t = /** @type {any} */ (e.target);
  const el = t?.closest?.('[data-karte]');
  if (!el) return;
  // Knöpfe IN der Zeile (z. B. „Rechnung ↓“) meinen etwas anderes — außer die Zeile ist selbst der Knopf
  const ctl = t.closest(_STEUER);
  if (ctl && ctl !== el && el.contains(ctl)) return;
  const bezug = el.getAttribute('data-karte');
  if (!bezug || !kbZeigen(bezug, { fliegen: true, dauer: DAUER_KLICK_MS })) return;
  const eigen = el.hasAttribute('data-click') || el.hasAttribute('onclick');
  if (!eigen) _auswaehlen(bezug);
}

function _ueberfahren(/** @type {MouseEvent} */ e) {
  const el = /** @type {any} */ (e.target)?.closest?.('[data-karte]') || null;
  if (el === _ueber) return;
  _ueber = el;
  if (el) kbZeigen(el.getAttribute('data-karte') || '');
  else if (!_timer) _weg();   // ein Klick-Aufleuchten läuft zu Ende
}

function _verlassen(/** @type {MouseEvent} */ e) {
  if (!_ueber) return;
  const nach = /** @type {any} */ (e.relatedTarget);
  if (nach && _ueber.contains(nach)) return;
  _ueber = null;
  if (!_timer) _weg();
}

/** Ereignisse an ein Dokument hängen (Hauptfenster beim Laden, Auswertungsfenster aus src/55). */
export function kbAnbinden(/** @type {Document} */ doc) {
  const d = /** @type {any} */ (doc);
  if (d._kbAn) return;
  d._kbAn = true;
  doc.addEventListener('click', _klick);
  doc.addEventListener('mouseover', _ueberfahren);
  doc.addEventListener('mouseout', _verlassen);
}

// ── Karte → Auswertung: gewählte Objekte in den Listen markieren ───────────
function _abgleich() {
  const w = /** @type {any} */ (window);
  const av = document.getElementById('center-analyse-view');   // bei offenem Auswertungsfenster dort (55 leitet um)
  const sichtbar = w.afAktiv?.() || (av && av.style.display !== 'none');
  if (!sichtbar) return;
  const gewaehlt = [];
  if (selectedId != null) gewaehlt.push('geb:' + selectedId);
  if (ASSETS.selectedId != null) gewaehlt.push('asset:' + ASSETS.selectedId);
  const schluessel = gewaehlt.join('|');
  const neu = schluessel !== _auswahlSchluessel;
  _auswahlSchluessel = schluessel;
  const soll = new Set(gewaehlt);
  /** @type {Element|null} */
  let erstes = null;
  for (const el of document.querySelectorAll('[data-karte]')) {
    const an = soll.has(el.getAttribute('data-karte') || '');
    if (el.classList.contains('kb-auswahl') !== an) el.classList.toggle('kb-auswahl', an);
    if (an && !erstes) erstes = el;
  }
  // Nur beim Wechsel der Auswahl hinrollen — nicht bei jedem Neuzeichnen der Liste
  if (neu && erstes) erstes.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

kbAnbinden(document);
setInterval(_abgleich, TAKT_MS);
