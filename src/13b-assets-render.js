// ── 13b-assets-render.js — Leaflet-Marker für Assets ────────────────────────
// Eine Marker-Gruppe pro Gebäude (am Polygon-Schwerpunkt), Klick öffnet Liste.
// Assets ohne Gebäude → Einzel-Marker.

import { map } from './02b-gebaeude.js';
import { globalYear } from './01-globals-varianten.js';
import { ASSETS, ASSET_CFG, getAssetStatus, getAssetsForBuilding, deleteAsset } from './13a-assets-core.js';

let assetLayer = null;
// Default aus — Anlagen-Icons werden nur im Strom-Sub-Tab eingeblendet.
// Auto-Steuerung: setLeftTab (04a-ui-panels.js) und setNetzSubTab (05b-stromnetz.js).
let layerVisible = false;

// Drei Zoom-Stufen:
//   z < COLLAPSED        → komplett aus
//   COLLAPSED ≤ z < DETAIL → 1 Sammel-Icon pro Gebäude
//   z ≥ DETAIL           → alle Einzel-Icons nebeneinander
const ASSET_COLLAPSED_ZOOM = 16;
const ASSET_DETAIL_ZOOM    = 18;

// Sammel-Icon bei mittlerem Zoom
const COLLAPSED_ICON = '⚙';

// Zoom-abhängige Marker-Größe (14–20 px)
function sizeAtZoom(z) {
  const size = Math.round(14 + (z - ASSET_DETAIL_ZOOM) * 3);
  return Math.max(14, Math.min(20, size));
}

function ensureLayer() {
  if (!assetLayer) {
    assetLayer = L.layerGroup();
    applyLayerVisibility();
  }
  return assetLayer;
}

function applyLayerVisibility() {
  if (!assetLayer) return;
  const effective = layerVisible && map.getZoom() >= ASSET_COLLAPSED_ZOOM;
  if (effective) assetLayer.addTo(map);
  else           assetLayer.remove();
}

// Polygon-Schwerpunkt (einfacher Mittelwert)
function polygonCentroid(polygon) {
  if (!polygon || polygon.length < 1) return null;
  let lat = 0, lng = 0, n = 0;
  for (const p of polygon) {
    lat += (p.lat ?? p[0]);
    lng += (p.lng ?? p[1]);
    n++;
  }
  return n > 0 ? { lat: lat / n, lng: lng / n } : null;
}

// ── Gruppen-Marker pro Gebäude ──────────────────────────────────────────────
function drawBuildingGroup(buildingId) {
  ensureLayer();
  const buildings = window.gebaeude || [];
  const g = buildings.find(x => x.id === buildingId);
  if (!g || !g.polygon) return;
  const c = polygonCentroid(g.polygon);
  if (!c) return;

  const assets = getAssetsForBuilding(buildingId);
  if (assets.length === 0) return;

  const zoom = map.getZoom();
  const collapsed = zoom < ASSET_DETAIL_ZOOM;
  const size = sizeAtZoom(zoom);

  let html, width, height;

  if (collapsed) {
    // Sammel-Marker: ein generisches Icon + Zahl-Badge
    const fontSize = Math.round(size * 0.65);
    const badge = assets.length > 1
      ? `<span class="asset-group-count">${assets.length}</span>`
      : '';
    html = `<div class="asset-group asset-group-collapsed" style="width:${size}px;height:${size}px;font-size:${fontSize}px;">${COLLAPSED_ICON}${badge}</div>`;
    width  = size + 8;
    height = size + 8;
  } else {
    // Alle Einzel-Icons nebeneinander — direkt klickbar via data-asset-id
    const fontSize = Math.round(size * 0.6);
    const iconsHtml = assets.slice(0, 6).map(a => {
      const cfg    = ASSET_CFG[a.type];
      const status = getAssetStatus(a, globalYear);
      const opacity = status === 'active' ? 1 : 0.4;
      return `<span class="asset-group-icon" data-asset-id="${a.id}" style="background:${cfg.color};opacity:${opacity};width:${size}px;height:${size}px;font-size:${fontSize}px;" title="${a.name}">${cfg.icon}</span>`;
    }).join('');
    html = `<div class="asset-group">${iconsHtml}</div>`;
    width  = size * Math.min(assets.length, 6) + 4;
    height = size + 4;
  }

  const icon = L.divIcon({
    className: '',
    html,
    iconSize:   [width, height],
    iconAnchor: [width / 2, height / 2],
  });

  const m = L.marker([c.lat, c.lng], { icon, zIndexOffset: 200 });

  m.on('click', e => {
    L.DomEvent.stopPropagation(e);
    const inLeitungMode = window.STROMNETZ?.mode === 'leitung';
    // Detail-Modus: getroffenes Icon direkt verarbeiten (data-asset-id)
    if (!collapsed) {
      const el = e.originalEvent?.target?.closest?.('[data-asset-id]');
      const id = el?.dataset?.assetId;
      const a  = id ? ASSETS.items.find(x => x.id === id) : null;
      if (a) {
        if (inLeitungMode) {
          if (typeof window.leitungAssetClick === 'function') window.leitungAssetClick(a.id);
          return;
        }
        ASSETS.selectedId = a.id;
        if (typeof window.openAssetInspector === 'function') window.openAssetInspector(a);
        return;
      }
    }
    // Collapsed-Modus ODER Klick auf Rand:
    // Im Leitung-Modus mit Single-Asset: direkt verwenden
    if (inLeitungMode && assets.length === 1) {
      if (typeof window.leitungAssetClick === 'function') window.leitungAssetClick(assets[0].id);
      return;
    }
    // Sonst: Liste öffnen
    openBuildingAssetList(buildingId, m, inLeitungMode);
  });

  m.addTo(assetLayer);
  // Alle Assets der Gruppe teilen den Marker-Ref (für deleteAsset)
  for (const a of assets) {
    a._marker = m;
    a.lat = c.lat;
    a.lng = c.lng;
  }
}

// Liste aller Assets des Gebäudes — Auswahl öffnet Inspector ODER (im Leitung-Modus) ruft leitungAssetClick
function openBuildingAssetList(buildingId, marker, inLeitungMode) {
  const assets = getAssetsForBuilding(buildingId);
  if (assets.length === 0) return;
  if (assets.length === 1) {
    if (inLeitungMode && typeof window.leitungAssetClick === 'function') {
      window.leitungAssetClick(assets[0].id);
      return;
    }
    ASSETS.selectedId = assets[0].id;
    if (typeof window.openAssetInspector === 'function') window.openAssetInspector(assets[0]);
    return;
  }

  const rows = assets.map(a => {
    const cfg    = ASSET_CFG[a.type];
    const status = getAssetStatus(a, globalYear);
    return `<div class="asset-list-row" data-asset-id="${a.id}">
      <span class="asset-list-icon" style="background:${cfg.color};">${cfg.icon}</span>
      <span class="asset-list-name">${a.name}</span>
      <span class="asset-list-status asset-list-status-${status}">${status}</span>
    </div>`;
  }).join('');

  const popup = L.popup({ className: 'asset-list-popup', offset: [0, -8], maxWidth: 260 })
    .setLatLng(marker.getLatLng())
    .setContent(`<div class="asset-list">${rows}</div>`)
    .openOn(map);

  setTimeout(() => {
    document.querySelectorAll('.asset-list-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.assetId;
        const a = ASSETS.items.find(x => x.id === id);
        if (a) {
          if (inLeitungMode && typeof window.leitungAssetClick === 'function') {
            window.leitungAssetClick(a.id);
          } else {
            ASSETS.selectedId = a.id;
            if (typeof window.openAssetInspector === 'function') window.openAssetInspector(a);
          }
        }
        map.closePopup(popup);
      });
    });
  }, 0);
}

// ── Einzel-Marker (Assets ohne Gebäude) ─────────────────────────────────────
function drawSingleMarker(asset) {
  ensureLayer();
  const cfg = ASSET_CFG[asset.type];
  if (!cfg) return;

  if (asset._marker) {
    assetLayer.removeLayer(asset._marker);
    asset._marker = null;
  }

  const status  = getAssetStatus(asset, globalYear);
  const opacity = status === 'active' ? 1 : 0.35;
  const border  = status === 'planned' ? 'dashed' : 'solid';
  const size    = sizeAtZoom(map.getZoom());
  const showIcon = true;
  const fontSize = Math.max(8, Math.round(size * 0.6));
  const borderW  = 1;

  const icon = L.divIcon({
    className: '',
    html: `<div class="asset-marker asset-marker-${status}"
              data-asset-id="${asset.id}"
              style="background:${cfg.color};border-style:${border};border-width:${borderW}px;opacity:${opacity};width:${size}px;height:${size}px;"
              title="${asset.name}">
             ${showIcon ? `<span class="asset-marker-icon" style="font-size:${fontSize}px;">${cfg.icon}</span>` : ''}
           </div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  const m = L.marker([asset.lat, asset.lng], { icon, draggable: true, zIndexOffset: 200 });

  m.on('click', e => {
    L.DomEvent.stopPropagation(e);
    // Im Leitung-Zeichnen-Modus: Asset als Start/Ziel auswählen, NICHT Inspector öffnen.
    if (window.STROMNETZ?.mode === 'leitung') {
      if (typeof window.leitungAssetClick === 'function') window.leitungAssetClick(asset.id);
      return;
    }
    ASSETS.selectedId = asset.id;
    if (typeof window.openAssetInspector === 'function') window.openAssetInspector(asset);
  });

  m.on('dragend', () => {
    const ll = m.getLatLng();
    asset.lat = ll.lat;
    asset.lng = ll.lng;
  });

  m.on('contextmenu', e => {
    L.DomEvent.stopPropagation(e);
    if (confirm(`Asset "${asset.name}" löschen?`)) {
      deleteAsset(asset.id);
      redrawAllAssets();
    }
  });

  m.addTo(assetLayer);
  asset._marker = m;
}

// ── Öffentliche API ─────────────────────────────────────────────────────────
export function drawAssetMarker(asset) {
  // Bei Gebäude-Zugehörigkeit: ganze Gruppe neu zeichnen (Icons/Status aktualisieren)
  if (asset.buildingId) {
    redrawAllAssets();
  } else {
    drawSingleMarker(asset);
  }
}

export function redrawAllAssets() {
  ensureLayer();
  assetLayer.clearLayers();
  for (const a of ASSETS.items) a._marker = null;

  const byBuilding = new Map();
  const standalone = [];
  for (const a of ASSETS.items) {
    if (a.buildingId) {
      if (!byBuilding.has(a.buildingId)) byBuilding.set(a.buildingId, []);
      byBuilding.get(a.buildingId).push(a);
    } else {
      standalone.push(a);
    }
  }

  for (const bid of byBuilding.keys()) drawBuildingGroup(bid);
  for (const a of standalone) drawSingleMarker(a);
}

export function setAssetLayerVisible(visible) {
  layerVisible = !!visible;
  ensureLayer();
  // Beim Aktivieren: fehlende Assets für bestehende Gebäude nachziehen (nach Autosave-Restore)
  if (layerVisible && typeof window.ensureAssetsForAllBuildings === 'function') {
    window.ensureAssetsForAllBuildings();
  }
  applyLayerVisibility();
  // Checkbox in Gebäude-Tab synchron halten
  const cb = document.getElementById('assets-visible');
  if (cb) cb.checked = layerVisible;
}

export function isAssetLayerVisible() {
  return layerVisible;
}

// Zoom-Listener: Sichtbarkeit + Größe neu
setTimeout(() => {
  map.on('zoomend', () => {
    applyLayerVisibility();
    if (map.getZoom() < ASSET_COLLAPSED_ZOOM) return;
    redrawAllAssets();
  });
}, 0);
