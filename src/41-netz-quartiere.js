// ── 41-netz-quartiere.js — Versorgungsquartiere mit eigenem Hauptstrang ──
// Im Netz-Schritt ② Quartiere festlegen (Bereich umfahren oder angehakte Gebäude), die jeweils über einen eigenen
// Strang direkt ab der Heizzentrale versorgt werden. Die Netzerstellung (03b) baut je Quartier einen eigenen Baum.

import { map } from './02b-gebaeude.js';
import { showHint } from './03c-gebaeude-io.js';
import { beginInteraction, cancelInteraction, commitInteraction } from './lib/interaction-state.js';
import { gebaeudeImBereich, bereichUmGebaeude } from './lib/quartier-herausloesen.js';
import { QUARTIER_FARBEN } from './lib/netz-quartiere.js';

const ID = 'netz-quartier-bereich';
let _punkte = [];
let _zeichenEbene = null;
let _deckel = null;
let _anzeige = null;
let _sichtbar = false;

const _quartiere = () => (Array.isArray(window.netzQuartiere) ? window.netzQuartiere : (window.netzQuartiere = []));
const _zentraleId = () => parseInt(document.getElementById('netz-zentrale')?.value, 10);
const _esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Quartier festlegen: mit angehakten Gebäuden direkt, sonst Bereich auf der Karte umfahren. */
export function netzQuartierHinzufuegen() {
  const auswahl = (window.gebaeude || []).filter(g => g.selected).map(g => g.id);
  if (auswahl.length) return _anlegen(auswahl, null);
  _zeichnenStarten();
  return true;
}

function _anlegen(ids, bereich) {
  const z = _zentraleId();
  const gebIds = ids.filter(id => id !== z);
  if (!gebIds.length) { showHint('Im Bereich liegt kein zu versorgendes Gebäude.', 4000); return false; }
  const liste = _quartiere();
  // Ein Gebäude gehört nur einem Quartier: aus bisherigen Quartieren herausnehmen
  const neu = new Set(gebIds);
  liste.forEach(q => { q.gebIds = (q.gebIds || []).filter(id => !neu.has(id)); });
  const benutzt = new Set(liste.map(q => q.farbe));
  const nr = Math.max(0, ...liste.map(q => Number(String(q.id).replace(/\D/g, '')) || 0)) + 1;
  liste.push({
    id: 'q' + nr, name: 'Quartier ' + nr, gebIds,
    farbe: QUARTIER_FARBEN.find(f => !benutzt.has(f)) || QUARTIER_FARBEN[nr % QUARTIER_FARBEN.length],
    bereich: bereich || null,
  });
  window.netzQuartiere = liste.filter(q => q.gebIds.length);
  _geaendert();
  showHint(`✓ ${gebIds.length} Gebäude als eigener Hauptstrang festgelegt — „Netz berechnen“ wendet es an.`, 5000);
  return true;
}

export function netzQuartierEntfernen(id) {
  window.netzQuartiere = _quartiere().filter(q => q.id !== id);
  _geaendert();
}

export function netzQuartierUmbenennen(id, name) {
  const q = _quartiere().find(x => x.id === id);
  if (q) { q.name = String(name || '').trim() || q.name; _geaendert(); }
}

function _geaendert() {
  netzQuartiereListe();
  netzQuartiereAnzeigen(true);
  window.netzWorkspaceAktualisieren?.();
}

// ── Bereich umfahren ──
function _zeichnenStarten() {
  _punkte = [];
  beginInteraction({
    id: ID, label: 'Quartier mit eigenem Strang',
    hint: 'Quartier umfahren: Eckpunkte klicken, Doppelklick oder Klick auf den ersten Punkt schließt',
    cancel: _zeichnenBeenden,
  });
  _zeichenEbene = L.layerGroup().addTo(map);
  map.doubleClickZoom.disable();
  _deckel = document.createElement('div');
  _deckel.className = 'qh-deckel';
  map.getContainer().appendChild(_deckel);
  map.on('click', _klick);
  map.on('dblclick', _doppelklick);
  map.on('mousemove', _bewegen);
}

function _zeichnenBeenden() {
  map.off('click', _klick);
  map.off('dblclick', _doppelklick);
  map.off('mousemove', _bewegen);
  map.doubleClickZoom.enable();
  _deckel?.remove(); _deckel = null;
  if (_zeichenEbene) { map.removeLayer(_zeichenEbene); _zeichenEbene = null; }
}

function _vorschau(maus) {
  if (!_zeichenEbene) return;
  _zeichenEbene.clearLayers();
  const pts = maus ? [..._punkte, maus] : _punkte;
  const farbe = '#8e24aa';
  if (pts.length >= 2) L.polygon(pts, { color: farbe, weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(_zeichenEbene);
  _punkte.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 6 : 4, color: farbe, fillColor: i === 0 ? farbe : '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(_zeichenEbene));
  if (pts.length >= 3) {
    const ids = new Set(gebaeudeImBereich(window.gebaeude, pts));
    for (const g of window.gebaeude || []) if (ids.has(g.id) && Array.isArray(g.polygon)) L.polygon(g.polygon, { color: farbe, weight: 2, fillOpacity: 0.35, interactive: false }).addTo(_zeichenEbene);
  }
}

function _klick(e) {
  if (_punkte.length >= 3) {
    const erster = map.latLngToContainerPoint(_punkte[0]);
    if (erster.distanceTo(map.latLngToContainerPoint(e.latlng)) < 12) return _abschliessen();
  }
  _punkte.push(e.latlng);
  _vorschau();
}
function _doppelklick() { if (_punkte.length >= 3) _abschliessen(); }
function _bewegen(e) { if (_punkte.length) _vorschau(e.latlng); }

function _abschliessen() {
  const bereich = _punkte.filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 0.5).map(p => ({ lat: p.lat, lng: p.lng }));
  commitInteraction(ID);
  _zeichnenBeenden();
  if (bereich.length < 3) return;
  _anlegen(gebaeudeImBereich(window.gebaeude, bereich), bereich);
}

export function netzQuartierZeichnenAbbrechen() { cancelInteraction(ID); }

// ── Anzeige ──
/** Quartiere auf der Karte zeigen (im Netz-Schritt ②) oder ausblenden. */
export function netzQuartiereAnzeigen(an = _sichtbar) {
  _sichtbar = !!an;
  if (!_anzeige) _anzeige = L.layerGroup();
  _anzeige.clearLayers();
  const liste = _quartiere();
  if (!_sichtbar || !liste.length) { if (map.hasLayer(_anzeige)) map.removeLayer(_anzeige); return; }
  const gebNachId = new Map((window.gebaeude || []).map(g => [g.id, g]));
  for (const q of liste) {
    const geb = (q.gebIds || []).map(id => gebNachId.get(id)).filter(g => Array.isArray(g?.polygon));
    if (!geb.length) continue;
    const umriss = q.bereich?.length >= 3 ? q.bereich : bereichUmGebaeude(geb, 12);
    if (umriss) {
      L.polygon(umriss, { color: q.farbe, weight: 2, dashArray: '6 5', fillColor: q.farbe, fillOpacity: 0.06, interactive: false, className: 'netz-quartier-flaeche' })
        .bindTooltip(_esc(q.name), { permanent: true, direction: 'center', className: 'netz-quartier-label', opacity: 0.95 })
        .addTo(_anzeige);
    }
    for (const g of geb) L.polygon(g.polygon, { color: q.farbe, weight: 2.5, fill: false, interactive: false }).addTo(_anzeige);
  }
  // Hauptstränge in Quartiersfarbe nachzeichnen, leicht versetzt, damit nebeneinanderliegende Stränge zu sehen sind
  const status = window.netzQuartierStatus?.() || new Map();
  liste.forEach((q, i) => {
    const versatz = (i - (liste.length - 1) / 2) * 2.5;
    for (const linie of status.get(q.id)?.linien || []) {
      L.polyline(_versetzt(linie, versatz), { color: q.farbe, weight: 3, opacity: 0.9, interactive: false, className: 'netz-quartier-strang' }).addTo(_anzeige);
    }
  });
  if (!map.hasLayer(_anzeige)) _anzeige.addTo(map);
}

/** Linie um m Meter seitlich versetzen (nach rechts in Laufrichtung); Knicke über gemittelte Normalen. */
function _versetzt(linie, m) {
  if (!m || linie.length < 2) return linie;
  const k = 111320, cos = Math.cos(linie[0].lat * Math.PI / 180);
  const xy = linie.map(p => [p.lng * k * cos, p.lat * k]);
  const normale = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  return xy.map((p, i) => {
    const n1 = i > 0 ? normale(xy[i - 1], p) : null, n2 = i < xy.length - 1 ? normale(p, xy[i + 1]) : null;
    const n = n1 && n2 ? [(n1[0] + n2[0]) / 2, (n1[1] + n2[1]) / 2] : (n1 || n2);
    return L.latLng((p[1] + n[1] * m) / k, (p[0] + n[0] * m) / (k * cos));
  });
}

/** Liste im Netz-Schritt ② mit Status, ob das aktuelle Netz die Hauptstränge einhält. */
export function netzQuartiereListe() {
  const el = document.getElementById('na-quartier-liste');
  const anzahl = document.getElementById('na-quartiere-anzahl');
  const liste = _quartiere();
  if (anzahl) anzahl.textContent = liste.length ? String(liste.length) : '';
  if (!el) return;
  const status = window.netzQuartierStatus?.() || new Map();
  el.innerHTML = liste.map(q => {
    const s = status.get(q.id);
    const info = !s || !s.angeschlossen ? '<span class="nq-status">noch nicht berechnet</span>'
      : s.eigener ? `<span class="nq-status ok">✓ eigener Strang${s.abgaenge > 1 ? ` (${s.abgaenge} Abgänge)` : ''}</span>`
        : '<span class="nq-status warn">teilt Strang — Netz neu berechnen</span>';
    return `<div class="nq-zeile" data-quartier="${_esc(q.id)}">
      <span class="nq-farbe" style="background:${_esc(q.farbe)}"></span>
      <input class="nq-name" value="${_esc(q.name)}" aria-label="Name des Quartiers" data-change="netzQuartierUmbenennen('${_esc(q.id)}', this.value)">
      <span class="nq-anzahl">${(q.gebIds || []).length} Geb.</span>${info}
      <button type="button" class="nq-weg" title="Quartier entfernen" aria-label="Quartier entfernen" data-click="netzQuartierEntfernen('${_esc(q.id)}')">×</button>
    </div>`;
  }).join('');
  const details = document.getElementById('na-quartiere');
  if (details && liste.length) details.open = true;
}
