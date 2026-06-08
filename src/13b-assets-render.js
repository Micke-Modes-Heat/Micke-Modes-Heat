// ── 13b-assets-render.js — Leaflet-Marker für Assets ────────────────────────
// Eine Marker-Gruppe pro Gebäude (am Polygon-Schwerpunkt), Klick öffnet Liste.
// Assets ohne Gebäude → Einzel-Marker.

import { map } from './02b-gebaeude.js';
import { globalYear } from './01-globals-varianten.js';
import { ASSETS, ASSET_CFG, ASSET_PROPS_SCHEMA, getAssetStatus, getAssetsForBuilding, deleteAsset } from './13a-assets-core.js';

let assetLayer = null;       // Gebäude-gruppierte Assets (zoom-abhängig)
let standaloneLayer = null; // Frei platzierte Assets (immer sichtbar)
let layerVisible = false; // erst sichtbar wenn Elektro-Tab geöffnet wird

// ── Asset-Tooltip-Hilfsfunktionen ────────────────────────────────────────────
function _contrast(hex) {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#000' : '#fff';
}
function _attKv(label, value, col) {
  const val = col ? `<span style="color:${col};font-weight:500;">${value}</span>` : value;
  return `<div style="display:flex;justify-content:space-between;gap:14px;padding:1px 0;">` +
    `<span style="color:#78909c;font-size:11px;white-space:nowrap;">${label}</span>` +
    `<span style="font-size:11px;">${val}</span></div>`;
}
const _attHr = '<div style="border-top:1px solid #1e2540;margin:4px 0;"></div>';
function _attHead(icon, badge, sub, bg) {
  const fg = _contrast(bg);
  const subHtml = sub
    ? `<span style="color:#546e7a;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;" title="${sub}">${sub}</span>`
    : '';
  return `<div style="display:flex;align-items:center;gap:6px;padding-bottom:5px;margin-bottom:4px;border-bottom:1px solid #2a3050;">` +
    `<span style="background:${bg};color:${fg};border-radius:3px;padding:1px 6px 2px;font-size:10px;font-weight:700;white-space:nowrap;">${icon} ${badge}</span>` +
    subHtml + '</div>';
}
function _attUnit(label) {
  const m = label.match(/\(([^)]+)\)$/);
  return m ? ' ' + m[1] : '';
}
function _assetKosten(asset) {
  const p = asset.props || {};
  const g = (id, def) => parseFloat(document.getElementById(id)?.value) || def;
  switch (asset.type) {
    case 'NAP':          return g('ak-nap', 8000);
    case 'Schaltanlage': return (parseFloat(p.felder) || 4) * 1500 + 3000;
    case 'Trafo':        return (parseFloat(p.leistungKVA) || 630) * g('ak-trafo-kva', 80);
    case 'NSHV':         return (parseFloat(p.abgaenge) || 6) * g('ak-nshv-abg', 500) + 3000;
    case 'UV':           return (parseFloat(p.abgaenge) || 4) * g('ak-uv-abg', 200) + 800;
    case 'KVS':          return (parseFloat(p.abgaenge) || 4) * g('ak-kvs-abg', 150) + 500;
    case 'Verbraucher':  return 2000;
    case 'PV':           return (parseFloat(p.leistungKWp) || 10) * g('ak-pv-kwp', 1200);
    case 'Batterie':     return (parseFloat(p.kapazitaetKWh) || 10) * g('ak-bat-kwh', 600);
    case 'Lade':         return (parseFloat(p.anzahlPunkte) || 1) * g('ak-lade-pkt', 1500) + (parseFloat(p.leistungProPunktKW) || 22) * 200;
    case 'WP':           return (parseFloat(p.leistungThKW) || parseFloat(p.leistungKW) || 10) * g('ak-wp-kw', 700);
    case 'Nsa':          return (parseFloat(p.leistungKW) || 20) * 300;
    case 'Wind':         return (parseFloat(p.leistungKW) || 100) * g('ak-wind-kw', 1500);
    case 'KWK':          return (parseFloat(p.leistungElKW) || 20) * g('ak-kwk-kwel', 3500);
    default:             return null;
  }
}
function _buildAssetTooltip(asset) {
  const cfg    = ASSET_CFG[asset.type];
  if (!cfg) return asset.name;
  const status = getAssetStatus(asset, globalYear);
  const props  = asset.props || {};
  const schema = ASSET_PROPS_SCHEMA[asset.type] || [];
  const statusCol = { active: '#4caf50', planned: '#f9a825', demolished: '#ef5350' };
  const statusLbl = { active: 'aktiv', planned: 'geplant', demolished: 'abgerissen' };
  const _duCol   = p => p < 1 ? '#4caf50' : p < 2 ? '#8bc34a' : p < 3 ? '#f9a825' : '#e53935';
  const _auslCol = p => p < 80 ? '#4caf50' : p < 100 ? '#f9a825' : '#e53935';

  let h = `<div style="min-width:195px;">`;
  h += _attHead(cfg.icon, cfg.label, asset.name, cfg.color);
  h += _attKv('Status', statusLbl[status] || status, statusCol[status]);

  for (const p of schema.slice(0, 3)) {
    if (props[p.key] != null && props[p.key] !== '') {
      const lbl = p.label.replace(/\s*\([^)]+\)$/, '');
      h += _attKv(lbl, String(props[p.key]) + _attUnit(p.label));
    }
  }
  // PV: berechneten Jahresertrag direkt anzeigen
  if (asset.type === 'PV' && parseFloat(props.leistungKWp) > 0) {
    const kwp  = parseFloat(props.leistungKWp);
    const spez = parseFloat(props.pvSpez) || (props.ausrichtung === 'ostwest' ? 950 : 1050);
    const lbl  = props.ausrichtung === 'ostwest' ? 'Ost-West' : 'Süd';
    h += _attKv('Jahresertrag', (kwp * spez / 1000).toFixed(1) + ' MWh/a · ' + lbl, '#ffd54f');
  }
  if (asset.baujahr) h += _attKv('Baujahr', asset.baujahr);

  const sn = (window.stromNodes || []).find(n => n.id === asset.id);
  if (sn) {
    h += _attHr;
    if (sn.isProducer && sn.peakLoadKw)
      h += _attKv('↓ Einspeisung (WC)', Math.abs(sn.peakLoadKw).toFixed(1) + ' kW', '#ef9a9a');
    else if (sn.peakLoadKw)
      h += _attKv('↑ Bezug (WC)', sn.peakLoadKw.toFixed(1) + ' kW', '#90caf9');
    if (sn.annualMwh)
      h += _attKv('Jahresenergie', Math.abs(sn.annualMwh).toFixed(1) + ' MWh/a');
    if (sn._auslastungPct != null)
      h += _attKv('Auslastung', sn._auslastungPct.toFixed(0) + ' %', _auslCol(sn._auslastungPct));
    if (sn._deltaUKumPct != null) {
      const dP = sn._deltaUKumPct;
      h += _attKv('Spannungsfall', `ΔU ${dP.toFixed(2)} %`, _duCol(dP));
    }
  }

  const kosten = _assetKosten(asset);
  if (kosten != null) {
    h += _attHr;
    h += _attKv('Kostenschätzung', '~ ' + kosten.toLocaleString('de-DE') + ' €');
  }

  h += '</div>';
  return h;
}
function _buildGroupTooltip(assets) {
  const rows = assets.slice(0, 6).map(a => {
    const cfg = ASSET_CFG[a.type];
    const fg  = _contrast(cfg.color);
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">` +
      `<span style="background:${cfg.color};color:${fg};border-radius:3px;padding:0 5px;font-size:11px;">${cfg.icon}</span>` +
      `<span style="font-size:11px;">${a.name}</span>` +
    `</div>`;
  }).join('');
  const more = assets.length > 6
    ? `<div style="color:#78909c;font-size:10px;margin-top:2px;">+ ${assets.length - 6} weitere</div>`
    : '';
  return `<div style="min-width:145px;">${rows}${more}</div>`;
}

// Drei Zoom-Stufen:
//   z < COLLAPSED        → komplett aus
//   COLLAPSED ≤ z < DETAIL → 1 Sammel-Icon pro Gebäude
//   z ≥ DETAIL           → alle Einzel-Icons nebeneinander
const ASSET_COLLAPSED_ZOOM = 16;
const ASSET_DETAIL_ZOOM    = 18;

// Sammel-Icon bei mittlerem Zoom
const COLLAPSED_ICON = '⚙';

// Prüft ob ein Asset geplante (noch offene) Maßnahmen hat → Badge anzeigen
function hasPendingMassnahmen(asset) {
  return (asset.massnahmen || []).some(m => m.status === 'geplant');
}

const ASSET_MARKER_SIZE = 20;
function sizeAtZoom(_z) { return ASSET_MARKER_SIZE; }

function ensureLayer() {
  if (!assetLayer) {
    assetLayer = L.layerGroup();
    applyLayerVisibility();
  }
  if (!standaloneLayer) {
    standaloneLayer = L.layerGroup();
    applyLayerVisibility();
  }
  return assetLayer;
}

function applyLayerVisibility() {
  // Gebäude-Assets: nur ab ASSET_COLLAPSED_ZOOM sichtbar
  if (assetLayer) {
    const effective = layerVisible && map.getZoom() >= ASSET_COLLAPSED_ZOOM;
    if (effective) assetLayer.addTo(map);
    else           assetLayer.remove();
  }
  // Standalone-Assets: immer sichtbar (kein Zoom-Threshold)
  if (standaloneLayer) {
    if (layerVisible) standaloneLayer.addTo(map);
    else              standaloneLayer.remove();
  }
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
  const polygonC = polygonCentroid(g.polygon);
  if (!polygonC) return;

  const assets = getAssetsForBuilding(buildingId);
  if (assets.length === 0) return;

  // Position: verschobene Position beibehalten, sonst Polygon-Schwerpunkt
  const firstMoved = assets.find(a => a._movedByUser);
  const c = firstMoved ? { lat: firstMoved.lat, lng: firstMoved.lng } : polygonC;

  const zoom = map.getZoom();
  const collapsed = zoom < ASSET_DETAIL_ZOOM;
  const size = sizeAtZoom(zoom);

  let html, width, height;

  if (collapsed) {
    // Sammel-Marker: ein generisches Icon + Zahl-Badge
    const fontSize = Math.round(size * 0.65);
    const countBadge = assets.length > 1
      ? `<span class="asset-group-count">${assets.length}</span>`
      : '';
    const hasAnyPending = assets.some(hasPendingMassnahmen);
    const pendingBadge = hasAnyPending
      ? `<span class="asset-massn-badge"></span>`
      : '';
    html = `<div class="asset-group asset-group-collapsed" style="width:${size}px;height:${size}px;font-size:${fontSize}px;">${COLLAPSED_ICON}${countBadge}${pendingBadge}</div>`;
    width  = size + 8;
    height = size + 8;
  } else {
    // Alle Einzel-Icons nebeneinander — direkt klickbar via data-asset-id
    const fontSize = Math.round(size * 0.6);
    const iconsHtml = assets.slice(0, 6).map(a => {
      const cfg    = ASSET_CFG[a.type];
      const status = getAssetStatus(a, globalYear);
      const opacity = status === 'active' ? 1 : 0.4;
      const pendingBadge = hasPendingMassnahmen(a)
        ? `<span class="asset-massn-badge asset-massn-badge-sm"></span>`
        : '';
      return `<span class="asset-group-icon" data-asset-id="${a.id}" style="background:${cfg.color};opacity:${opacity};width:${size}px;height:${size}px;font-size:${fontSize}px;">${cfg.icon}${pendingBadge}</span>`;
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

  const m = L.marker([c.lat, c.lng], { icon, draggable: true, zIndexOffset: 200 });

  // Tooltip: im Detail-Modus asset-spezifisch per Hover-Delegation, sonst Gruppen-Liste
  m.bindTooltip(_buildGroupTooltip(assets), { sticky: true, className: 'geb-tooltip', offset: [8, 0] });
  if (!collapsed) {
    m.on('mouseover', function(ev) {
      const el = ev.originalEvent?.target?.closest?.('[data-asset-id]');
      const id = el?.dataset?.assetId;
      const a  = id ? ASSETS.items.find(x => x.id === id) : null;
      m.setTooltipContent(a ? _buildAssetTooltip(a) : _buildGroupTooltip(assets));
    });
  }

  m.on('dragend', () => {
    const ll = m.getLatLng();
    for (const a of assets) {
      a.lat = ll.lat;
      a.lng = ll.lng;
      a._movedByUser = true;
    }
  });

  m.on('click', e => {
    if (window.isDrawingStromEdge) return;
    L.DomEvent.stopPropagation(e);
    // Detail-Modus: getroffenes Icon direkt öffnen (data-asset-id)
    if (!collapsed) {
      const el = e.originalEvent?.target?.closest?.('[data-asset-id]');
      const id = el?.dataset?.assetId;
      const a  = id ? ASSETS.items.find(x => x.id === id) : null;
      if (a) {
        ASSETS.selectedId = a.id;
        if (typeof window.openAssetInspector === 'function') window.openAssetInspector(a);
        return;
      }
    }
    // Collapsed-Modus ODER Klick auf Rand → Liste
    openBuildingAssetList(buildingId, m);
  });

  m.addTo(assetLayer);
  // Alle Assets der Gruppe teilen den Marker-Ref (für deleteAsset)
  for (const a of assets) {
    a._marker = m;
    a.lat = c.lat;
    a.lng = c.lng;
  }
}

// Liste aller Assets des Gebäudes — Auswahl öffnet Inspector
function openBuildingAssetList(buildingId, marker) {
  const assets = getAssetsForBuilding(buildingId);
  if (assets.length === 0) return;
  if (assets.length === 1) {
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
          ASSETS.selectedId = a.id;
          if (typeof window.openAssetInspector === 'function') window.openAssetInspector(a);
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
    standaloneLayer.removeLayer(asset._marker);
    asset._marker = null;
  }

  const status  = getAssetStatus(asset, globalYear);
  const opacity = status === 'active' ? 1 : 0.35;
  const border  = status === 'planned' ? 'dashed' : 'solid';
  const size    = sizeAtZoom(map.getZoom());
  const fontSize = Math.max(8, Math.round(size * 0.6));
  const borderW  = 1;

  const markerLat = asset.lat, markerLng = asset.lng;

  const pendingBadge = hasPendingMassnahmen(asset)
    ? `<span class="asset-massn-badge"></span>`
    : '';
  const icon = L.divIcon({
    className: '',
    html: `<div class="asset-marker asset-marker-${status}"
              style="background:${cfg.color};border-style:${border};border-width:${borderW}px;opacity:${opacity};width:${size}px;height:${size}px;">
             <span class="asset-marker-icon" style="font-size:${fontSize}px;">${cfg.icon}</span>
             ${pendingBadge}
           </div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  const m = L.marker([markerLat, markerLng], { icon, draggable: true, zIndexOffset: 3000 });
  m.bindTooltip(() => _buildAssetTooltip(asset), { sticky: true, className: 'geb-tooltip', offset: [8, 0] });

  // Strom-Domain-Assets als Strom-Knoten registrieren, damit Kabel angeschlossen werden können
  // isAsset:true → setStromNetzVisible soll diese Marker NICHT direkt auf die Karte legen,
  // da sie vom Asset-Layer-System (standaloneLayer) verwaltet werden.
  if (cfg.domain === 'strom') {
    window.stromNodes = window.stromNodes || [];
    const existing = window.stromNodes.find(n => n.id === asset.id);
    if (!existing) {
      window.stromNodes.push({
        id: asset.id, type: asset.type.toLowerCase(),
        lat: markerLat, lng: markerLng,
        marker: m, label: cfg.label || asset.type,
        buildingId: asset.buildingId || null,
        peakLoadKw: 0, annualMwh: 0, isProducer: false,
        isAsset: true,
      });
    } else {
      existing.marker = m;
      existing.isAsset = true;
      existing.buildingId = asset.buildingId || null;
      existing.lat = markerLat;
      existing.lng = markerLng;
    }
  }

  m.on('click', e => {
    if (window.isDrawingStromEdge) {
      if (cfg.domain === 'strom' && typeof window.stromNodeClick === 'function') {
        window.stromNodeClick(asset.id);
      }
      return;
    }
    L.DomEvent.stopPropagation(e);
    ASSETS.selectedId = asset.id;
    if (typeof window.openAssetInspector === 'function') window.openAssetInspector(asset);
  });

  m.on('dragend', () => {
    const ll = m.getLatLng();
    asset.lat = ll.lat;
    asset.lng = ll.lng;
    // Strom-Knoten-Position synchron halten
    const sn = (window.stromNodes || []).find(n => n.id === asset.id);
    if (sn) {
      sn.lat = ll.lat; sn.lng = ll.lng;
      if (typeof window.updateStromEdgeGeometry === 'function') window.updateStromEdgeGeometry();
    }
  });

  m.on('contextmenu', e => {
    L.DomEvent.stopPropagation(e);
    // Strom-Knoten und angeschlossene Kabel mitentfernen
    if (typeof window.removeStromNode === 'function') window.removeStromNode(asset.id);
    else if (window.stromNodes) {
      const idx = window.stromNodes.findIndex(n => n.id === asset.id);
      if (idx >= 0) window.stromNodes.splice(idx, 1);
    }
    deleteAsset(asset.id);
    redrawAllAssets();
  });

  m.addTo(standaloneLayer);
  asset._marker = m;
}

// ── Öffentliche API ─────────────────────────────────────────────────────────
export function drawAssetMarker(asset) {
  drawSingleMarker(asset);
}

export function redrawAllAssets() {
  ensureLayer();
  assetLayer.clearLayers();
  standaloneLayer.clearLayers();
  for (const a of ASSETS.items) a._marker = null;

  for (const a of ASSETS.items) drawSingleMarker(a);

  // Sidebar-Liste synchron halten (window-Bridge, kein zirkulärer Import)
  if (typeof window.renderSidebarAssetList === 'function') {
    window.renderSidebarAssetList();
  }
}

export function setAssetLayerVisible(visible) {
  const wasHidden = !layerVisible;
  layerVisible = !!visible;
  ensureLayer();
  // Beim Einblenden neu zeichnen, damit blind erstellte Assets erscheinen
  if (visible && wasHidden) redrawAllAssets();
  // applyLayerVisibility IMMER aufrufen — sonst wird standaloneLayer nie auf die Karte gelegt
  applyLayerVisibility();
}


export function isAssetLayerVisible() {
  return layerVisible;
}

// Zoom-Listener: nur Sichtbarkeit (Icons haben feste Größe/Position)
setTimeout(() => {
  map.on('zoomend', () => {
    applyLayerVisibility();
  });
}, 0);
