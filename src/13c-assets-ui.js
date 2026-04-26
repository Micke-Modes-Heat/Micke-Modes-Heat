// ── 13c-assets-ui.js — Asset-Palette (Buttons) + Karten-Platzierung ────────

import { map } from './02b-gebaeude.js';
import { pointInPolygon } from './03b-netz.js';
import { ASSETS, ASSET_CFG, createAsset } from './13a-assets-core.js';
import { drawAssetMarker, setAssetLayerVisible, isAssetLayerVisible } from './13b-assets-render.js';

// State: welcher Asset-Typ wird gerade platziert?
let pendingType = null;

// Palette-Panel aufbauen (einmalig)
function buildPalette() {
  const panel = document.getElementById('asset-palette');
  if (!panel) return;
  if (panel.dataset.built === '1') return;

  // Titel mit Drag-Handle
  const title = document.createElement('div');
  title.className = 'asset-palette-title asset-palette-drag-handle';
  title.innerHTML = '<span style="opacity:.7;margin-right:6px;">⠿</span>Asset platzieren';
  title.title = 'Ziehen zum Verschieben';
  panel.appendChild(title);
  attachPaletteDrag(panel, title);

  // Ein Button pro Asset-Typ (gruppiert nach Kategorie)
  const kategorien = ['infrastruktur', 'verbraucher', 'erzeuger', 'speicher', 'sonstiges'];
  for (const kat of kategorien) {
    for (const [type, cfg] of Object.entries(ASSET_CFG)) {
      if (cfg.kategorie !== kat) continue;
      const btn = document.createElement('button');
      btn.className = 'asset-palette-btn';
      btn.dataset.type = type;
      btn.innerHTML = `<span class="asset-palette-btn-icon" style="color:${cfg.color}">${cfg.icon}</span><span>${cfg.label}</span>`;
      btn.addEventListener('click', () => setPendingType(type));
      panel.appendChild(btn);
    }
  }

  panel.dataset.built = '1';
}

// Drag-Handle für die Palette: per Mausziehen am Titel verschiebbar.
// Beim ersten Drag wechseln wir von right→left/top, damit die Position
// stabil ist (sonst würde das Panel beim Resize-Wechsel "springen").
function attachPaletteDrag(panel, handle) {
  let dragging = false, startX, startY, startLeft, startTop;
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    // Position fixieren in left/top relativ zum Viewport
    panel.style.left  = rect.left + 'px';
    panel.style.top   = rect.top  + 'px';
    panel.style.right = 'auto';
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    // Innerhalb des Viewports halten (mit kleinem Padding)
    const maxLeft = window.innerWidth  - panel.offsetWidth  - 4;
    const maxTop  = window.innerHeight - panel.offsetHeight - 4;
    panel.style.left = Math.max(4, Math.min(maxLeft, startLeft + dx)) + 'px';
    panel.style.top  = Math.max(4, Math.min(maxTop,  startTop  + dy)) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
  });
}

export function setPendingType(type) {
  pendingType = type;
  // Alle Buttons auf inaktiv
  document.querySelectorAll('.asset-palette-btn').forEach(b => b.classList.remove('active'));
  // Aktiven markieren
  const btn = document.querySelector(`.asset-palette-btn[data-type="${type}"]`);
  if (btn) btn.classList.add('active');
  // Cursor ändern
  map.getContainer().style.cursor = type ? 'crosshair' : '';
}

export function togglePalette() {
  buildPalette();
  const panel = document.getElementById('asset-palette');
  if (!panel) return;
  const nowVisible = !panel.classList.contains('visible');
  panel.classList.toggle('visible', nowVisible);
  setAssetLayerVisible(nowVisible);
  // Toggle-Button-Status
  const tgl = document.getElementById('btn-assets-toggle');
  if (tgl) tgl.classList.toggle('active', nowVisible);
  if (!nowVisible) setPendingType(null);
}

// Karten-Klick: Asset platzieren, wenn pendingType gesetzt
function onMapClickForAsset(e) {
  if (!pendingType) return;
  // Stromnetz-Modus (Trasse/Leitung) hat Vorrang
  if (window.STROMNETZ && window.STROMNETZ.mode) return;
  // Nur reagieren wenn Palette sichtbar
  const panel = document.getElementById('asset-palette');
  if (!panel || !panel.classList.contains('visible')) return;
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

// pointInPolygon ist jetzt zentral aus 03b-netz.js importiert (siehe Zeile 3).

// Escape bricht die Platzierung ab
function onKeydownForAsset(e) {
  if (e.key === 'Escape' && pendingType) setPendingType(null);
}

// Init — läuft nach Modul-Ladung (deferred wegen Dev-TDZ)
setTimeout(() => {
  map.on('click', onMapClickForAsset);
  document.addEventListener('keydown', onKeydownForAsset);
}, 0);
