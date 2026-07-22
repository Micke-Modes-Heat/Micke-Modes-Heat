// ── 14g-cluster-map.js — Cluster-Overlay auf der Karte + Zeichnen + Verwaltungspanel ──
// Rendert die in 14f verwalteten Cluster als farbige Polygone mit Badge (Kürzel + Stufe/
// Jahr), stellt ein Zeichenwerkzeug für neue Cluster bereit (Muster wie Windgebiet in
// 02c-karte-werkzeuge.js) und ein Float-Panel zum Umbenennen/Färben/Stufe-setzen/Löschen.
//
// Leaflet (`map`, `L`) und Helfer (`showHint`, `hideHint`, `_hideForDraw`,
// `_restoreAfterDraw`) kommen als Globals aus 02b/02c.

import {
  clusters, clusterErstellen, clusterFindeById, clusterAktualisieren,
  clusterLoeschen, clusterMitgliedIds, ringCentroidLL,
  CLUSTER_MASSN_TYPEN, clusterGeneriereMassnahmen, clusterEntferneMassnahmen,
  clusterMassnahmenAnzahl, massnahmeEffektivesJahr,
  fahrplanMeilensteine, fahrplanZustandBeiJahr,
} from './14f-cluster-core.js';
import { runPlanningTransaction } from './lib/planning-transaction.js';
import { beginInteraction, cancelInteraction, commitInteraction } from './lib/interaction-state.js';

function _clusterChange(label, mutate) {
  try { return runPlanningTransaction(label, mutate); }
  catch (error) { console.error(error); alert(error.message); return null; }
}

// Anzeigenamen/Icons der generierbaren Maßnahmen-Typen (Gewerk-Keys aus MASSN_VORLAGEN).
const MASSN_LABEL = { Sanierung: '🔧 Sanierung', Abriss: '🏚 Stilllegung/Abriss', Bau: '🏗 Neubau' };

// ── Modul-State ───────────────────────────────────────────────────────────────────────
let _layers      = [];      // { polygon, badge } je Cluster — für sauberes Neuzeichnen
let _sichtbar    = true;    // Overlay-Layer ein/aus
let _panelOpen   = false;

// Zeichen-State (ein neues Cluster-Polygon)
let _drawing     = false;
let _drawPoints  = [];
let _drawPolyline = null;
let _drawStart   = null;

// Vertex-Edit-State (bestehendes Cluster-Polygon bearbeiten)
let _editId      = null;
let _editMarkers = [];

// Zeitreise-State (Schritt 3): Durchschalten der Ausbaustufen/Jahre
let _zeitAktiv   = false;
let _zeitJahr    = null;
let _zeitMarker  = [];     // Maßnahmen-Marker an Mitgliedsgebäuden
let _zeitTimer   = null;   // Play-Intervall

// ── Init: Float-Panel einhängen ─────────────────────────────────────────────────────────
export function clusterInit() {
  if (document.getElementById('cluster-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'cluster-panel';
  panel.className = 'float-panel';
  panel.style.cssText = 'display:none;top:80px;min-width:340px;max-width:420px;max-height:82vh;padding:15px 18px 12px;overflow-y:auto;border:1px solid #90a4ae;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'cluster-panel')">
      <span style="color:#b0bec5;font-size:12px;font-weight:600;">🗺 Cluster / Ausbaustufen</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            onclick="clusterTogglePanel()">✕</span>
    </div>
    <div id="cluster-content"></div>`;
  document.body.appendChild(panel);
}

// ── Panel Show/Hide ─────────────────────────────────────────────────────────────────────
export function clusterTogglePanel() {
  clusterInit();
  _panelOpen = !_panelOpen;
  const panel = document.getElementById('cluster-panel');
  const btn   = document.getElementById('btn-cluster-toggle');
  if (!panel) return;
  panel.style.display = _panelOpen ? 'block' : 'none';
  btn?.classList.toggle('active', _panelOpen);
  if (_panelOpen) { clusterRenderPanel(); clusterRenderLayers(); }
}

// ── Panel-Inhalt ────────────────────────────────────────────────────────────────────────
function _esc(s) { return String(s ?? '').replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }

export function clusterRenderPanel() {
  const el = document.getElementById('cluster-content');
  if (!el) return;
  const geb = window.gebaeude || [];

  const kopf = `
    <div style="display:flex;gap:6px;align-items:center;margin:10px 0 8px;flex-wrap:wrap;">
      <button class="ins-link-btn" onclick="toggleDrawCluster()" style="margin:0;">
        ${_drawing ? '✎ Zeichnen läuft … (ESC zum Abbrechen)' : '＋ Cluster zeichnen'}
      </button>
      <label style="font-size:11px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" ${_sichtbar ? 'checked' : ''} onchange="clusterShowLayers(this.checked)"> Overlay
      </label>
      <button class="ins-link-btn" style="margin:0;" onclick="clusterZeitreiseToggle()">${_zeitAktiv ? '■ Zeitreise aus' : '▶ Zeitreise'}</button>
    </div>`;

  if (!clusters.length) {
    el.innerHTML = kopf + `<div style="font-size:11px;color:var(--muted);padding:8px 0;line-height:1.5;">
      Noch keine Cluster. Klicke <b>＋ Cluster zeichnen</b> und umfahre einen Bereich der Liegenschaft
      (Startpunkt erneut anklicken zum Schließen). Danach kannst du Stufe und Jahr hinterlegen.</div>`;
    return;
  }

  const karten = [...clusters]
    .sort((a, b) => (a.stufe ?? 99) - (b.stufe ?? 99) || String(a.name).localeCompare(String(b.name)))
    .map(c => {
      const n   = clusterMitgliedIds(c, geb).length;
      const nM  = clusterMassnahmenAnzahl(c, geb);
      const typChecks = CLUSTER_MASSN_TYPEN.map(t => `
        <label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--fg);cursor:pointer;">
          <input type="checkbox" data-cl-typ="${c.id}" value="${t}"> ${MASSN_LABEL[t] || t}
        </label>`).join('');
      return `
      <div style="border:1px solid var(--border);border-left:4px solid ${c.farbe};border-radius:6px;padding:8px 10px;margin:6px 0;background:var(--surface2);">
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="color" value="${c.farbe}" title="Farbe"
                 onchange="clusterEditFeld('${c.id}','farbe',this.value)"
                 style="width:22px;height:22px;padding:0;border:none;background:none;cursor:pointer;flex-shrink:0;">
          <input type="text" value="${_esc(c.name)}" title="Name"
                 onchange="clusterEditFeld('${c.id}','name',this.value)"
                 style="flex:1;min-width:0;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--fg);padding:2px 6px;font-size:12px;font-weight:600;">
          <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${n} Geb.</span>
          <span onclick="clusterLoeschenUI('${c.id}')" title="Cluster löschen"
                style="cursor:pointer;color:#ef9a9a;font-size:13px;">✕</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;font-size:11px;color:var(--muted);flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:4px;">Stufe
            <input type="number" min="0" max="9" value="${c.stufe ?? ''}" placeholder="–"
                   onchange="clusterEditFeld('${c.id}','stufe',this.value)"
                   style="width:46px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--fg);padding:2px 4px;"></label>
          <label style="display:inline-flex;align-items:center;gap:4px;">Jahr
            <input type="number" min="2020" max="2060" value="${c.jahr ?? ''}" placeholder="–"
                   onchange="clusterEditFeld('${c.id}','jahr',this.value)"
                   style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--fg);padding:2px 4px;"></label>
          <button class="ins-link-btn" style="margin:0;padding:2px 6px;"
                  onclick="clusterEditPolygon('${c.id}')">${_editId === c.id ? '✓ fertig' : '✎ Umriss'}</button>
        </div>
        <div style="border-top:1px dashed var(--border);margin-top:7px;padding-top:6px;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Maßnahmenpaket auf ${n} Mitglied(er)${nM ? ` · <b style="color:var(--fg);">${nM} Maßnahme(n) aktiv</b>` : ''}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:5px;">${typChecks}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <button class="ins-link-btn" style="margin:0;padding:2px 8px;" onclick="clusterPaketAnwenden('${c.id}')">→ auf Mitglieder anwenden</button>
            ${nM ? `<button class="ins-link-btn" style="margin:0;padding:2px 6px;color:#ef9a9a;" onclick="clusterPaketEntfernen('${c.id}')">✕ Paket</button>` : ''}
            ${nM ? `<button class="ins-link-btn" style="margin:0;padding:2px 6px;" onclick="clusterFahrplanOeffnen()">📅 Fahrplan</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

  el.innerHTML = kopf + karten;
  // Checkbox-Status je Cluster aus den aktuell vorhandenen Maßnahmen vorbelegen
  for (const c of clusters) {
    const aktiveTypen = new Set();
    for (const g of geb) for (const m of (g.massnahmen || [])) if (m.clusterId === c.id) aktiveTypen.add(m.typ);
    el.querySelectorAll(`input[data-cl-typ="${c.id}"]`).forEach(cb => {
      cb.checked = aktiveTypen.size ? aktiveTypen.has(cb.value) : cb.value === 'Sanierung';
    });
  }
}

// ── Overlay-Layer zeichnen ───────────────────────────────────────────────────────────────
export function clusterRenderLayers() {
  const map = window.map;
  if (!map || typeof L === 'undefined') return;
  // Alte Layer entfernen
  for (const l of _layers) { if (l.polygon) map.removeLayer(l.polygon); if (l.badge) map.removeLayer(l.badge); }
  for (const m of _zeitMarker) map.removeLayer(m);
  _layers = [];
  _zeitMarker = [];
  if (!_sichtbar) return;

  // Zeitreise-Zustand (falls aktiv): welche Cluster sind zum Stichjahr umgesetzt?
  const zustand = (_zeitAktiv && _zeitJahr != null)
    ? fahrplanZustandBeiJahr(_zeitJahr, clusters, window.gebaeude || [], window.phasen || [])
    : null;

  for (const c of clusters) {
    if (!c.polygon || c.polygon.length < 3) continue;
    const latlngs = c.polygon.map(p => [p.lat, p.lng]);
    const status = zustand ? zustand.clusterStatus[c.id] : null;   // 'umgesetzt' | 'geplant' | null
    const umgesetzt = status === 'umgesetzt';
    const geplant   = status === 'geplant';

    const polygon = L.polygon(latlngs, {
      color:       c.farbe,
      weight:      geplant ? 1.5 : 2,
      dashArray:   geplant ? '6 5' : null,
      fillColor:   c.farbe,
      fillOpacity: umgesetzt ? 0.28 : (geplant ? 0.04 : 0.10),
      opacity:     geplant ? 0.6 : 1,
    }).addTo(map);
    polygon.on('click', () => { if (!_panelOpen) clusterTogglePanel(); });

    const center = _ringCenter(c.polygon);
    const sub = (c.stufe != null || c.jahr != null)
      ? `<span style="display:block;font-size:9px;font-weight:500;opacity:.95;">${c.stufe != null ? 'Stufe ' + c.stufe : ''}${c.stufe != null && c.jahr != null ? ' · ' : ''}${c.jahr != null ? c.jahr : ''}</span>`
      : '';
    const check = umgesetzt ? '✓ ' : '';
    const badge = L.marker(center, {
      interactive: false,
      icon: L.divIcon({
        className: 'cluster-badge',
        html: `<div style="background:${c.farbe};color:#fff;border-radius:14px;padding:2px 9px;font-weight:700;font-size:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4);white-space:nowrap;line-height:1.15;opacity:${geplant ? 0.55 : 1};">${check}${_esc(c.name)}${sub}</div>`,
        iconSize: [0, 0],
      }),
      zIndexOffset: 1500,
    }).addTo(map);

    _layers.push({ polygon, badge });
  }

  // Maßnahmen-Marker: an jedem Mitgliedsgebäude mit erledigter Maßnahme zum Stichjahr
  if (zustand) _renderZeitMarker(map, zustand);
}

function _ringCenter(ring) {
  let sLat = 0, sLng = 0;
  for (const p of ring) { sLat += p.lat; sLng += p.lng; }
  return [sLat / ring.length, sLng / ring.length];
}

// Kleiner Häkchen-Marker (in Clusterfarbe) auf jedem Gebäude, dessen Maßnahme bis zum
// Stichjahr erledigt ist — visualisiert das „Aufblühen" der Liegenschaft über die Zeit.
function _renderZeitMarker(map, zustand) {
  // Cluster-Zuordnung je Gebäude (für die Markerfarbe)
  const clFarbe = {};
  for (const c of clusters) clFarbe[c.id] = c.farbe;
  for (const g of (window.gebaeude || [])) {
    if (!zustand.gebaeudeDone.has(g.id) || !g.polygon || g.polygon.length < 3) continue;
    // erste erledigte Maßnahme → Farbe des zugehörigen Clusters
    const m = (g.massnahmen || []).find(x => {
      const j = massnahmeEffektivesJahr(x, window.phasen || []);
      return j != null && j <= _zeitJahr;
    });
    const farbe = (m && clFarbe[m.clusterId]) || '#78909c';
    const c = ringCentroidLL(g.polygon);
    const marker = L.marker([c.lat, c.lng], {
      interactive: false,
      icon: L.divIcon({
        className: 'cluster-massn-marker',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${farbe};color:#fff;font-size:9px;line-height:14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5);border:1px solid #fff;">✓</div>`,
        iconSize: [14, 14], iconAnchor: [7, 7],
      }),
      zIndexOffset: 1400,
    }).addTo(map);
    _zeitMarker.push(marker);
  }
}

export function clusterShowLayers(on) {
  _sichtbar = !!on;
  clusterRenderLayers();
  if (_panelOpen) clusterRenderPanel();
}

// ── Panel-Aktionen (an window gebunden über main.js) ────────────────────────────────────
export function clusterEditFeld(id, feld, wert) {
  _clusterChange('Cluster bearbeiten', () => clusterAktualisieren(id, { [feld]: wert }));
  clusterRenderLayers();
  clusterRenderPanel();
  if (_zeitAktiv) _zeitBarRender();
}

export function clusterLoeschenUI(id) {
  if (_editId === id) _stopVertexEdit();
  const c = clusterFindeById(id);
  _clusterChange('Cluster löschen', () => {
    if (c) clusterEntferneMassnahmen(c, window.gebaeude || []);
    clusterLoeschen(id);
  });
  clusterRenderLayers();
  clusterRenderPanel();
  _refreshFahrplan();
}

// ── Maßnahmenpakete ──────────────────────────────────────────────────────────────────
export function clusterPaketAnwenden(id) {
  const c = clusterFindeById(id);
  if (!c) return;
  const panel = document.getElementById('cluster-content');
  const typen = [...(panel?.querySelectorAll(`input[data-cl-typ="${id}"]:checked`) || [])].map(cb => cb.value);
  if (!typen.length) { if (typeof window.showHint === 'function') window.showHint('Bitte mindestens einen Maßnahmen-Typ ankreuzen.'); return; }
  const res = _clusterChange('Cluster-Maßnahmen erzeugen', () => clusterGeneriereMassnahmen(c, window.gebaeude || [], { typen, jahr: c.jahr }));
  if (!res) return;
  if (typeof window.showHint === 'function') {
    window.showHint(res.gebaeude ? `Cluster ${c.name}: ${res.massnahmen} Maßnahme(n) auf ${res.gebaeude} Gebäude erzeugt.` : `Cluster ${c.name} hat keine Mitgliedsgebäude.`);
    setTimeout(() => { if (typeof window.hideHint === 'function') window.hideHint(); }, 3500);
  }
  clusterRenderPanel();
  _refreshFahrplan();
  if (_zeitAktiv) { _zeitBarRender(); clusterRenderLayers(); }
}

export function clusterPaketEntfernen(id) {
  const c = clusterFindeById(id);
  if (!c) return;
  _clusterChange('Cluster-Maßnahmen entfernen', () => clusterEntferneMassnahmen(c, window.gebaeude || []));
  clusterRenderPanel();
  _refreshFahrplan();
  if (_zeitAktiv) { _zeitBarRender(); clusterRenderLayers(); }
}

export function clusterFahrplanOeffnen() {
  if (typeof window.ausbauShow === 'function') window.ausbauShow(true);
}

// Board neu zeichnen, falls es gerade offen ist (Maßnahmen haben sich geändert).
function _refreshFahrplan() {
  if (typeof window.ausbauRender === 'function' && document.getElementById('ausbauplaner-wrap')?.style.display !== 'none') {
    window.ausbauRender();
  }
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
}

// ── Polygon zeichnen (neues Cluster) ─────────────────────────────────────────────────────
export function toggleDrawCluster() {
  const map = window.map;
  if (!map) return;
  if (_drawing) { _cancelDraw(); return; }

  _stopVertexEdit();
  beginInteraction({id:'draw-cluster',label:'Cluster zeichnen',hint:'Eckpunkte setzen, Startpunkt schließt das Cluster.',cancel:_cancelDraw});

  _drawing = true;
  _drawPoints = [];
  if (typeof window.showHint === 'function') window.showHint('Cluster zeichnen: Klicke Eckpunkte auf die Karte. Startpunkt (rot) erneut anklicken zum Schließen. Rechtsklick widerruft, ESC bricht ab.');
  if (typeof window._hideForDraw === 'function') window._hideForDraw();
  map.doubleClickZoom.disable();
  map.dragging.disable();
  map.getContainer().style.cursor = 'crosshair';
  map.off('click', onDrawClusterClick);
  map.off('contextmenu', onDrawClusterCancel);
  map.on('click', onDrawClusterClick);
  map.on('contextmenu', onDrawClusterCancel);
  clusterRenderPanel();
}

export function onDrawClusterClick(e) {
  if (!_drawing) return;
  const map = window.map;
  if (_drawStart && _drawPoints.length >= 3) {
    const d = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(_drawStart.getLatLng()));
    if (d < 20) { _finishDraw(); return; }
  }
  if (_drawPoints.length === 0) {
    _drawStart = L.marker(e.latlng, { icon: L.divIcon({ className: 'area-start-handle', html: '', iconSize: [14, 14] }), zIndexOffset: 2000 }).addTo(map);
    _drawStart.on('click', ev => { L.DomEvent.stopPropagation(ev); _finishDraw(); });
  }
  _drawPoints.push(e.latlng);
  if (_drawPolyline) map.removeLayer(_drawPolyline);
  _drawPolyline = L.polyline([..._drawPoints], { color: '#b0bec5', weight: 2, dashArray: '8 4' }).addTo(map);
}

export function onDrawClusterCancel(e) {
  if (!_drawing) return;
  const map = window.map;
  if (_drawPoints.length > 0) {
    _drawPoints.pop();
    if (_drawPolyline) map.removeLayer(_drawPolyline);
    if (_drawPoints.length > 0) {
      _drawPolyline = L.polyline([..._drawPoints], { color: '#b0bec5', weight: 2, dashArray: '8 4' }).addTo(map);
    } else if (_drawStart) { map.removeLayer(_drawStart); _drawStart = null; }
  }
}

function _cleanupDrawEvents() {
  const map = window.map;
  map.off('click', onDrawClusterClick);
  map.off('contextmenu', onDrawClusterCancel);
  _drawing = false;
  map.dragging.enable();
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  if (typeof window.hideHint === 'function') window.hideHint();
  if (typeof window._restoreAfterDraw === 'function') window._restoreAfterDraw();
}

function _cancelDraw() {
  const map = window.map;
  if (_drawPolyline) { map.removeLayer(_drawPolyline); _drawPolyline = null; }
  if (_drawStart) { map.removeLayer(_drawStart); _drawStart = null; }
  _drawPoints = [];
  _cleanupDrawEvents();
  cancelInteraction('draw-cluster');
  clusterRenderPanel();
}

function _finishDraw() {
  const map = window.map;
  if (_drawPoints.length < 3) return;
  commitInteraction('draw-cluster');
  const polygon = _drawPoints.map(ll => ({ lat: ll.lat, lng: ll.lng }));
  if (_drawPolyline) { map.removeLayer(_drawPolyline); _drawPolyline = null; }
  if (_drawStart) { map.removeLayer(_drawStart); _drawStart = null; }
  _drawPoints = [];
  _cleanupDrawEvents();
  _clusterChange('Cluster anlegen', () => clusterErstellen({ polygon }));
  clusterRenderLayers();
  clusterRenderPanel();
}

// ── Vertex-Editieren eines bestehenden Cluster-Polygons ──────────────────────────────────
export function clusterEditPolygon(id) {
  if (_editId === id) { _stopVertexEdit(); clusterRenderPanel(); return; }
  _stopVertexEdit();
  const map = window.map;
  const c = clusterFindeById(id);
  if (!map || !c || !c.polygon.length) return;
  _editId = id;
  const editIcon = L.divIcon({ className: 'area-edit-handle', html: '', iconSize: [12, 12] });
  c.polygon.forEach((p, index) => {
    const marker = L.marker([p.lat, p.lng], { draggable: true, icon: editIcon, zIndexOffset: 2000 }).addTo(map);
    marker.on('drag', ev => {
      const ll = ev.target.getLatLng();
      c.polygon[index] = { lat: ll.lat, lng: ll.lng };
      clusterRenderLayers();
    });
    marker.on('dragend', () => clusterRenderPanel());
    _editMarkers.push(marker);
  });
  clusterRenderPanel();
}

function _stopVertexEdit() {
  const map = window.map;
  if (map) for (const m of _editMarkers) map.removeLayer(m);
  _editMarkers = [];
  _editId = null;
}

// ── Zeitreise: Ausbaustufen/Jahre durchschalten (Schritt 3) ────────────────────────────
function _meilensteine() {
  return fahrplanMeilensteine(clusters, window.gebaeude || [], window.phasen || []);
}

export function clusterZeitreiseToggle() {
  _zeitAktiv = !_zeitAktiv;
  _zeitStopPlay();
  if (_zeitAktiv) {
    const ms = _meilensteine();
    _zeitJahr = ms.length ? ms[ms.length - 1] : null;   // Start: Endausbau (alles sichtbar)
  } else {
    _zeitJahr = null;
  }
  _zeitBarRender();
  clusterRenderLayers();
  clusterRenderPanel();
}

function _zeitBar() {
  let bar = document.getElementById('cluster-zeitreise');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'cluster-zeitreise';
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:3200;background:var(--surface);border:1px solid #90a4ae;border-radius:10px;padding:10px 16px;box-shadow:0 8px 32px rgba(0,0,0,.6);min-width:420px;max-width:min(680px,92vw);display:none;';
    document.body.appendChild(bar);
  }
  return bar;
}

function _zeitBarRender() {
  const bar = _zeitBar();
  if (!_zeitAktiv) { bar.style.display = 'none'; return; }
  const ms = _meilensteine();
  if (!ms.length) {
    bar.style.display = 'block';
    bar.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <span style="font-size:12px;color:var(--muted);">Noch keine Termine — Cluster-Jahre setzen oder Maßnahmenpakete anwenden.</span>
      <span style="cursor:pointer;color:var(--muted);" onclick="clusterZeitreiseToggle()">✕</span></div>`;
    return;
  }
  if (_zeitJahr == null || !ms.includes(_zeitJahr)) _zeitJahr = ms[ms.length - 1];
  const idx = ms.indexOf(_zeitJahr);
  const z = fahrplanZustandBeiJahr(_zeitJahr, clusters, window.gebaeude || [], window.phasen || []);
  const stufeTxt = z.stufeJahr != null ? `Stufe ${z.stufeJahr}` : '';
  const investTxt = z.investDone ? `${(z.investDone / 1000).toFixed(0)} k€` : '0 k€';
  const playing = !!_zeitTimer;

  bar.style.display = 'block';
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:7px;">
      <span style="font-size:15px;font-weight:700;color:var(--accent);white-space:nowrap;">${_zeitJahr}${stufeTxt ? ` · ${stufeTxt}` : ''}</span>
      <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${z.massnahmenDone}/${z.massnahmenTotal} Maßnahmen · Invest kumuliert ${investTxt}</span>
      <span style="margin-left:auto;cursor:pointer;color:var(--muted);font-size:14px;" title="Zeitreise beenden" onclick="clusterZeitreiseToggle()">✕</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <button class="ins-link-btn" style="margin:0;padding:2px 8px;" title="${playing ? 'Pause' : 'Abspielen'}" onclick="clusterZeitPlay()">${playing ? '⏸' : '▶'}</button>
      <input type="range" min="0" max="${ms.length - 1}" value="${idx}" step="1"
             oninput="clusterZeitSet(this.value)"
             style="flex:1;accent-color:var(--accent);cursor:pointer;">
      <span style="font-size:10px;color:var(--muted);white-space:nowrap;">${ms[0]}–${ms[ms.length - 1]}</span>
    </div>`;
}

export function clusterZeitSet(idx) {
  const ms = _meilensteine();
  const i = Math.max(0, Math.min(ms.length - 1, parseInt(idx) || 0));
  _zeitJahr = ms[i];
  _zeitBarRender();
  clusterRenderLayers();
}

export function clusterZeitPlay() {
  if (_zeitTimer) { _zeitStopPlay(); _zeitBarRender(); return; }
  const ms = _meilensteine();
  if (!ms.length) return;
  // Wenn am Ende, von vorn beginnen
  if (_zeitJahr == null || _zeitJahr >= ms[ms.length - 1]) _zeitJahr = ms[0];
  _zeitTimer = setInterval(() => {
    const arr = _meilensteine();
    const i = arr.indexOf(_zeitJahr);
    if (i < 0 || i >= arr.length - 1) { _zeitStopPlay(); _zeitBarRender(); return; }
    _zeitJahr = arr[i + 1];
    _zeitBarRender();
    clusterRenderLayers();
  }, 1100);
  _zeitBarRender(); clusterRenderLayers();   // nach Timer-Start → Button zeigt sofort ⏸
}

function _zeitStopPlay() {
  if (_zeitTimer) { clearInterval(_zeitTimer); _zeitTimer = null; }
}
