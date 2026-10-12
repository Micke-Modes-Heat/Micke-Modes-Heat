// ── 42-lade-status.js — Übersicht „Plangebiet & Laden" ─────────────────────
//
// Eine Liste für den ganzen Ablauf Plangebiet zeichnen → Bereich laden
// (03b-netz.js loadOsmBuildings und die Zusätze Dachformen/Dachflächen/
// Straßen/Bäume): was geladen ist, was gerade lädt (mit Laufzeit und — bei
// Overpass — dem Stand je Server) und was noch aussteht. Das Modell liegt in
// lib/lade-status.js; hier nur Zustand des aktuellen Laufs und das Panel.
//
// Die Lader melden über lsSchritt / lsMeldung / lsUnter. Ohne Laufnummer
// wirken diese nur auf einen gerade laufenden Schritt — so stören Aufrufe
// außerhalb eines Imports (z. B. der Knopf „Dachformen aus OSM") nicht.
//
// Bewusst ohne Importe aus App-Modulen: 02c und 03b importieren dieses Modul.

import { lsPlan, lsSetze, lsAktiv, lsGebietStand, lsRestUeberspringen, lsZusammenfassung, lsDauerText } from './lib/lade-status.js';

const PANEL_ID = 'lade-status-panel';
const FARBE = '#ce93d8';

/** @type {import('./lib/lade-status.js').LsSchritt[]|null} */
let _schritte = null;
let _lauf = 0;            // Nummer des laufenden/letzten Imports, 0 = nur Vorschau
let _laufAktiv = false;
let _laufStart = null;
let _laufEnde = null;
let _offen = false;
let _klein = false;       // eingeklappt: nur Kopfzeile (beim Zeichnen, damit die Karte frei bleibt)
let _ticker = null;

const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ZUSTAND = {
  offen:         { ico: '○', text: 'ausstehend' },
  laeuft:        { ico: '',  text: 'lädt …' },
  fertig:        { ico: '✓', text: 'geladen' },
  leer:          { ico: '∅', text: 'keine Daten' },
  uebersprungen: { ico: '–', text: 'übersprungen' },
  fehler:        { ico: '⚠', text: 'Fehler' },
};

/* ── Gebiet und Vorschau ──────────────────────────────────────────────────── */

function _gebiet() {
  return {
    zeichnet: !!window.areaDrawing,
    punkte: (window.areaPoints || []).length,
    ring: window.areaLatLngs && window.areaLatLngs.length >= 3 ? window.areaLatLngs : null,
  };
}

function _quelle(gebiet) {
  let lat, lng;
  const pts = gebiet.ring || (gebiet.punkte ? window.areaPoints : null);
  if (pts && pts.length) {
    lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  } else if (window.map?.getCenter) {
    ({ lat, lng } = window.map.getCenter());
  }
  return window.ladeQuelle?.(lat, lng) || { bl: null, kataster: false };
}

/**
 * Plan aus dem aktuellen Stand (Zeichnung, Haken im Importdialog) neu
 * aufstellen — nicht, solange ein Import läuft.
 * @param {{oeffnen?: boolean, klein?: boolean}} [opts]
 */
export function ladeStatusVorschau(opts = {}) {
  if (opts.klein != null) _klein = opts.klein;
  if (_laufAktiv) {
    // Während des Imports ändert sich höchstens die Gebietsanzeige nicht mehr.
    if (opts.oeffnen) { _offen = true; _render(); }
    return;
  }
  const gebiet = _gebiet();
  const q = _quelle(gebiet);
  _schritte = lsPlan({ gebiet, bl: q.bl, kataster: q.kataster, optionen: window.osmImportOptionen?.() || {} });
  // Ohne Zeichnung heißt der erste Schritt in der Vorschau noch „offen"
  if (!gebiet.zeichnet && !gebiet.ring) lsSetze(_schritte, 'gebiet', 'offen', lsGebietStand(gebiet).info);
  _lauf = 0; _laufStart = null; _laufEnde = null;
  if (opts.oeffnen) _offen = true;
  _render();
  window.updateLpGebietStatus?.();
}

/** Plangebiet gelöscht: Vorschau zurücknehmen und Panel schließen (nicht während eines Imports). */
export function ladeStatusZuruecksetzen() {
  if (_laufAktiv) return;
  _schritte = null; _lauf = 0;
  _offen = false;
  _render();
}

/* ── Lauf ─────────────────────────────────────────────────────────────────── */

/**
 * Import beginnt.
 * @param {{gebiet:any, bl:string|null, kataster:boolean, optionen:any}} o
 * @returns {number} Laufnummer
 */
export function ladeStatusStart(o) {
  _schritte = lsPlan(o);
  _lauf++;
  _laufAktiv = true;
  _laufStart = Date.now();
  _laufEnde = null;
  _offen = true;
  _klein = false;
  _tickerAn();
  _render();
  window.updateLpGebietStatus?.();
  return _lauf;
}

/**
 * Zustand eines Schritts setzen.
 * @param {string} id
 * @param {import('./lib/lade-status.js').LsZustand} zustand
 * @param {string} [info]
 * @param {number} [lauf]  ohne: nur, wenn der Schritt gerade läuft
 */
export function lsSchritt(id, zustand, info, lauf) {
  if (!_schritte || !_lauf) return;
  if (lauf != null) { if (lauf !== _lauf) return; }
  else if (_schritte.find(s => s.id === id)?.zustand !== 'laeuft') return;
  lsSetze(_schritte, id, zustand, info);
  _nachAenderung();
}

/** Text des gerade laufenden Schritts ersetzen. */
export function lsMeldung(text) {
  const s = _laufAktiv && _schritte ? lsAktiv(_schritte) : null;
  if (!s) return;
  s.info = String(text || '');
  _render();
}

/** Unterzeilen (z. B. Stand je Overpass-Server) am laufenden Schritt. */
export function lsUnter(zeilen) {
  const s = _laufAktiv && _schritte ? lsAktiv(_schritte) : null;
  if (!s) return;
  s.unter = (zeilen || []).map(String);
  _render();
}

/** Offene Schritte des Laufs als übersprungen abschließen (Abbruch, keine Gebäude). */
export function lsRest(info, lauf) {
  if (!_schritte || lauf !== _lauf) return;
  lsRestUeberspringen(_schritte, info);
  _nachAenderung();
}

/** Laufnummer des aktuellen Imports (für Schritte, die später im Hintergrund laufen). */
export function lsLauf() { return _lauf; }

function _nachAenderung() {
  const z = lsZusammenfassung(_schritte);
  if (_laufAktiv && z.phase !== 'laeuft' && z.phase !== 'bereit') {
    _laufAktiv = false;
    _laufEnde = Date.now();
    _tickerAus();
  } else if (_laufAktiv) _tickerAn();
  _render();
  window.updateLpGebietStatus?.();
}

function _tickerAn() {
  if (_ticker) return;
  _ticker = setInterval(() => { if (_offen) _render(); }, 1000);
}
function _tickerAus() { clearInterval(_ticker); _ticker = null; }

/* ── Panel ────────────────────────────────────────────────────────────────── */

export function ladeStatusToggle() {
  _offen = !_offen;
  if (_offen && !_schritte) { ladeStatusVorschau({ oeffnen: true }); return; }
  _render();
}

export function ladeStatusSchliessen() { _offen = false; _render(); }

export function ladeStatusKlein() { _klein = !_klein; _render(); }

/** Kurzzeile für den Gebiet-Reiter (04a updateLpGebietStatus); '' ohne Lauf. */
export function ladeStatusKurz() {
  const link = t => `<span role="button" tabindex="0" data-click="ladeStatusToggle()" title="Ladeübersicht ein-/ausblenden" style="color:${FARBE};text-decoration:underline;cursor:pointer;">${t}</span>`;
  if (!_schritte || !_lauf) return _schritte || window.areaLatLngs ? link('Ladeübersicht') : '';
  const z = lsZusammenfassung(_schritte);
  if (_laufAktiv) return link(`⟳ Laden läuft${z.aktiv ? `: ${_esc(z.aktiv.titel)}` : ''} (${z.erledigt}/${z.gesamt})`);
  if (z.phase === 'fehler') return link(`⚠ Laden mit ${z.fehler} Fehler${z.fehler === 1 ? '' : 'n'}`);
  if (z.phase === 'fertig') return link('✓ Laden abgeschlossen');
  return '';
}

function _zeitText(s) {
  if (s.start == null) return '';
  return lsDauerText((s.ende ?? Date.now()) - s.start);
}

function _kopfText(z) {
  const zahl = `${z.erledigt} von ${z.gesamt} Schritten`;
  if (!_lauf) {
    const g = _schritte.find(s => s.id === 'gebiet');
    if (g?.zustand === 'laeuft') return `Plangebiet zeichnen — ${g.info}`;
    return z.offen ? `Bereit — ${z.offen} Schritt${z.offen === 1 ? '' : 'e'} beim Laden` : 'Bereit';
  }
  const dauer = _laufStart ? lsDauerText((_laufEnde ?? Date.now()) - _laufStart) : '';
  if (z.phase === 'laeuft' || _laufAktiv) return `Lädt · ${zahl} · ${dauer}`;
  if (z.phase === 'fehler') return `Abgeschlossen mit ${z.fehler} Fehler${z.fehler === 1 ? '' : 'n'} · ${dauer}`;
  return `Fertig · ${dauer}`;
}

function _chips(z) {
  const c = (n, cls, t) => n ? `<span class="ls-chip ls-${cls}">${t} ${n}</span>` : '';
  return c(z.fertig + z.leer, 'fertig', '✓ geladen')
    + c(_lauf ? z.laeuft : 0, 'laeuft', '⟳ lädt')
    + c(z.offen, 'offen', '○ ausstehend')
    + c(z.fehler, 'fehler', '⚠ Fehler')
    + c(z.uebersprungen, 'uebersprungen', '– übersprungen');
}

function _zeile(s) {
  const zs = s.id === 'gebiet' && s.zustand === 'laeuft' ? { text: 'zeichnen …' } : ZUSTAND[s.zustand] || ZUSTAND.offen;
  const ico = s.zustand === 'laeuft' ? '<span class="ls-spin" aria-hidden="true"></span>' : _esc(zs.ico);
  const unter = s.unter?.length
    ? `<div class="ls-unter">${s.unter.map(u => `<div>${_esc(u)}</div>`).join('')}</div>` : '';
  return `<div class="ls-row ls-${s.zustand}">
    <span class="ls-ico">${ico}</span>
    <div class="ls-main">
      <div class="ls-t">${_esc(s.titel)}</div>
      ${s.info ? `<div class="ls-i">${_esc(s.info)}</div>` : ''}
      ${unter}
    </div>
    <div class="ls-st"><span>${zs.text}</span><span class="ls-zeit">${_zeitText(s)}</span></div>
  </div>`;
}

function _render() {
  let el = document.getElementById(PANEL_ID);
  if (!_offen || !_schritte) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Plangebiet und Laden — Status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  // links neben der Seitenleiste, unten über der Karte
  const lp = document.getElementById('left-panel')?.getBoundingClientRect();
  el.style.left = `${Math.round((lp && lp.width ? lp.right : 0) + 12)}px`;
  const z = lsZusammenfassung(_schritte);
  el.className = `ls-phase-${_laufAktiv ? 'laeuft' : _lauf ? z.phase : 'bereit'}${_klein ? ' ls-klein' : ''}`;
  const aktiv = _klein && _lauf && z.aktiv ? `<div class="ls-akt">${_esc(z.aktiv.titel)}${z.aktiv.info ? ` · ${_esc(z.aktiv.info)}` : ''}</div>` : '';
  el.innerHTML = `
    <div class="ls-head">
      <span class="ls-head-title">⬡ Plangebiet &amp; Laden</span>
      <button class="btn-xs" data-click="ladeStatusKlein()" title="${_klein ? 'Alle Schritte zeigen' : 'Einklappen'}">${_klein ? '▴ Schritte' : '▾'}</button>
      <button class="btn-xs" data-click="ladeStatusSchliessen()" title="Übersicht ausblenden — Laden läuft weiter">✕</button>
    </div>
    <div class="ls-kopf">${_esc(_kopfText(z))}</div>
    ${aktiv}
    ${_klein ? '' : `<div class="ls-chips">${_chips(z)}</div>
    <div class="ls-body">${_schritte.map(_zeile).join('')}</div>`}`;
}
