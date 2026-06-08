// ── 13c-assets-ui.js — Asset-Palette (Buttons) + Karten-Platzierung ────────

import { map } from './02b-gebaeude.js';
import { ASSETS, ASSET_CFG, createAsset } from './13a-assets-core.js';
import { drawAssetMarker, setAssetLayerVisible, isAssetLayerVisible } from './13b-assets-render.js';

// State: welcher Asset-Typ wird gerade platziert?
let pendingType = null;

// Palette-Panel aufbauen (einmalig)
export function buildPalette() {
  const panel = document.getElementById('asset-palette');
  if (!panel) return;
  if (panel.dataset.built === '1') return;

  const GROUPS = [
    { label: 'Netzinfrastruktur', types: ['NAP', 'Schaltanlage', 'Trafo', 'NSHV', 'UV', 'KVS'] },
    { label: 'Verbraucher',       types: ['Verbraucher', 'Lade'] },
    { label: 'Erzeugung',         types: ['PV', 'Wind', 'WP', 'KWK'] },
    { label: 'Speicher & Backup', types: ['Batterie', 'Nsa'] },
    { label: 'Sonstiges',         types: ['Reserve'], fullWidth: true },
  ];

  for (const group of GROUPS) {
    const header = document.createElement('div');
    header.className = 'asset-palette-group-header';
    header.textContent = group.label;
    panel.appendChild(header);

    for (const type of group.types) {
      const cfg = ASSET_CFG[type];
      if (!cfg) continue;
      const btn = document.createElement('button');
      btn.className = 'asset-palette-btn' + (group.fullWidth ? ' full-width' : '');
      btn.dataset.type = type;
      if (cfg.beschreibung) btn.title = cfg.beschreibung;
      btn.innerHTML = `<span class="asset-palette-btn-icon" style="color:${cfg.color}">${cfg.icon}</span><span>${cfg.label}</span>`;
      btn.addEventListener('click', () => setPendingType(type));
      panel.appendChild(btn);
    }
  }

  panel.dataset.built = '1';
}

export function setPendingType(type) {
  // Erneuter Klick auf aktiven Typ → abwählen
  if (pendingType === type) {
    pendingType = null;
    window._pendingAssetType = null;
    document.querySelectorAll('.asset-palette-btn').forEach(b => b.classList.remove('active'));
    map.getContainer().style.cursor = '';
    return;
  }
  // Andere Modi beenden
  if (window.isDrawingTrasse && typeof window.toggleDrawTrasse === 'function') window.toggleDrawTrasse();
  if (window.isDrawingStromEdge && typeof window.cancelDrawStromEdge === 'function') window.cancelDrawStromEdge();
  pendingType = type;
  window._pendingAssetType = type;
  document.querySelectorAll('.asset-palette-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.asset-palette-btn[data-type="${type}"]`);
  if (btn) btn.classList.add('active');
  map.getContainer().style.cursor = 'crosshair';
}

export function togglePalette() {
  // Palette ist jetzt im Elektro-Tab eingebettet — zum Tab navigieren
  if (typeof window.setLeftTab === 'function') window.setLeftTab('elektro');
}

// Karten-Klick: Asset platzieren, wenn pendingType gesetzt
function onMapClickForAsset(e) {
  if (!pendingType) return;
  // Gebäude-Zuordnung: welches Gebäude liegt an der Klick-Position?
  const buildingId = findBuildingAt(e.latlng);
  const asset = createAsset(pendingType, e.latlng.lat, e.latlng.lng, { buildingId });
  if (asset) drawAssetMarker(asset);
  // Cursor bleibt — User kann mehrere gleichen Typs platzieren
}

// Gebäude-Zuordnung per Punkt-in-Polygon (nutzt globales gebaeude[] + Leaflet-bounds als Fallback)
function findBuildingAt(latlng) {
  const list = window.gebaeude || [];
  for (const g of list) {
    if (!g.polygon || g.polygon.length < 3) continue;
    if (pointInPolygon(latlng, g.polygon)) return g.id;
  }
  return null;
}

function pointInPolygon(pt, poly) {
  const x = pt.lng, y = pt.lat;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    const xi = pi.lng ?? pi[1], yi = pi.lat ?? pi[0];
    const xj = pj.lng ?? pj[1], yj = pj.lat ?? pj[0];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Escape bricht die Platzierung ab
function onKeydownForAsset(e) {
  if (e.key === 'Escape' && pendingType) setPendingType(null);
}

// Init — läuft nach Modul-Ladung (deferred wegen Dev-TDZ)
setTimeout(() => {
  map.on('click', onMapClickForAsset);
  document.addEventListener('keydown', onKeydownForAsset);
}, 0);
