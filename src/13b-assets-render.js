// ── 13b-assets-render.js — Leaflet-Marker für Assets ────────────────────────
// Eine Marker-Gruppe pro Gebäude (am Polygon-Schwerpunkt), Klick öffnet Liste.
// Assets ohne Gebäude → Einzel-Marker.

import { map } from './02b-gebaeude.js';
import { globalYear } from './01-globals-varianten.js';
import { ASSETS, ASSET_CFG, ASSET_PROPS_SCHEMA, TYPE_RANK, getAssetStatus, getAssetsForBuilding, deleteAsset } from './13a-assets-core.js';
import { selectFromMap, lwWpSchallRadiusM } from './02c-karte-werkzeuge.js';
import { calcWindLwaAuto } from './13q-wind-ertrag.js';
import { computeSuitabilityGrid } from './13s-wind-flaeche.js';

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

// Zwei Zoom-Stufen:
//   z < COLLAPSED → komplett aus
//   z ≥ COLLAPSED → 1 Typ-Chip-Container pro Gebäude
const ASSET_COLLAPSED_ZOOM = 16;

// Max. Anzahl Typ-Chips im Container, bevor "+N" greift
const MAX_TYPE_CHIPS = 4;

// Chip-Kantenlänge (px) — an die Karten-Auflösung gekoppelt (wie die Lade-
// Polygone), damit die Chips mit der Karte mitskalieren: beim Rauszoomen
// schrumpfen die Gebäude UND die Chips. Ein Chip entspricht einer festen
// Bodenbreite (Meter); umgerechnet über Meter-pro-Pixel der aktuellen Zoomstufe.
// Geklammert auf [CHIP_MIN_PX, CHIP_MAX_PX], damit sie weder verschwinden noch
// (bei extremem Reinzoomen) die Karte fluten.
const CHIP_GROUND_M = 3.6;   // Ziel-Bodenbreite eines Chips in Metern
const CHIP_MIN_PX   = 6;
const CHIP_MAX_PX   = 24;
function chipSizeAtZoom(z) {
  const lat = map.getCenter().lat;
  // Meter pro Pixel (Web-Mercator) bei Zoom z und Breitengrad lat
  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  const px = CHIP_GROUND_M / mPerPx;
  return Math.round(Math.max(CHIP_MIN_PX, Math.min(CHIP_MAX_PX, px)));
}

// Prüft ob ein Asset geplante (noch offene) Maßnahmen hat → Badge anzeigen
function hasPendingMassnahmen(asset) {
  return (asset.massnahmen || []).some(m => m.status === 'geplant');
}

// Einzel-Marker (Assets ohne Gebäude) skalieren wie die Gebäude-Chips mit dem Zoom —
// sonst wirken sie bei manchen Zoomstufen deutlich größer/kleiner als die Chips
// derselben Assets innerhalb eines Gebäudes.
function sizeAtZoom(z) { return chipSizeAtZoom(z); }

// Assets eines Gebäudes nach Typ gruppieren, sortiert nach Versorgungs-Rang.
// Liefert [{ type, cfg, count, assets }] für die Chip-Darstellung.
function _groupByType(assets) {
  const byType = new Map();
  for (const a of assets) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
  }
  return [...byType.entries()]
    .map(([type, list]) => ({ type, cfg: ASSET_CFG[type], count: list.length, assets: list }))
    .sort((x, y) => (TYPE_RANK[x.type] ?? 9) - (TYPE_RANK[y.type] ?? 9));
}

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

// Strom-Domain-Assets als Strom-Knoten registrieren, damit Kabel angeschlossen werden können.
// isAsset:true → setStromNetzVisible soll diese Marker NICHT direkt auf die Karte legen,
// da sie vom Asset-Layer-System verwaltet werden.
function _registerStromNode(asset, marker, lat, lng, buildingId) {
  const cfg = ASSET_CFG[asset.type];
  if (cfg.domain !== 'strom') return;
  window.stromNodes = window.stromNodes || [];
  const existing = window.stromNodes.find(n => n.id === asset.id);
  if (!existing) {
    window.stromNodes.push({
      id: asset.id, type: asset.type.toLowerCase(),
      lat, lng,
      marker, label: cfg.label || asset.type,
      buildingId: buildingId || null,
      peakLoadKw: 0, annualMwh: 0, isProducer: false,
      isAsset: true,
    });
  } else {
    existing.marker = marker;
    existing.isAsset = true;
    existing.buildingId = buildingId || null;
    existing.lat = lat;
    existing.lng = lng;
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

  // ── Typ-Chip-Container: pro Asset-Typ ein farbiges Icon-Chip ──
  const chip   = chipSizeAtZoom(map.getZoom());
  const fs     = Math.round(chip * 0.6);
  const groups = _groupByType(assets);
  const shown  = groups.slice(0, MAX_TYPE_CHIPS);
  const rest   = groups.length - shown.length;

  const chipsHtml = shown.map(grp => {
    const status  = grp.assets.some(a => getAssetStatus(a, globalYear) === 'active') ? 'active' : 'planned';
    const opacity = status === 'active' ? 1 : 0.45;
    const cntSub  = grp.count > 1 ? `<span class="asset-chip-n">${grp.count}</span>` : '';
    return `<span class="asset-chip" style="background:${grp.cfg.color};opacity:${opacity};width:${chip}px;height:${chip}px;font-size:${fs}px;">${grp.cfg.icon}${cntSub}</span>`;
  }).join('');
  const moreChip = rest > 0 ? `<span class="asset-chip-more" style="font-size:${fs}px;">+${rest}</span>` : '';
  const pendingBadge = assets.some(hasPendingMassnahmen) ? `<span class="asset-massn-badge"></span>` : '';

  const html = `<div class="asset-chips">${chipsHtml}${moreChip}${pendingBadge}</div>`;

  // iconSize abschätzen (Chips + Gaps + Padding) für korrekte Zentrierung
  const nSlots = shown.length + (rest > 0 ? 1 : 0);
  const width  = nSlots * (chip + 2) + 8;
  const height = chip + 8;

  // Bulk-Modus: Gruppe ausgegraut, solange KEIN Asset darauf selektiert ist —
  // direkt beim Zeichnen setzen, damit Neuzeichnen das Dimming nicht verliert.
  const anySelected = assets.some(a => window.assetSelection?.has(a.id));
  const dimClass = (window.isBulkModeActive?.() && !anySelected) ? ' asset-bulk-dimmed' : '';
  const icon = L.divIcon({
    className: 'asset-divicon' + dimClass,
    html,
    iconSize:   [width, height],
    iconAnchor: [width / 2, height / 2],
  });

  const m = L.marker([c.lat, c.lng], { icon, draggable: true, zIndexOffset: 200 });
  m.bindTooltip(_buildGroupTooltip(assets), { sticky: true, className: 'geb-tooltip', offset: [8, 0] });

  m.on('dragend', () => {
    const ll = m.getLatLng();
    for (const a of assets) {
      a.lat = ll.lat;
      a.lng = ll.lng;
      a._movedByUser = true;
      const sn = (window.stromNodes || []).find(n => n.id === a.id);
      if (sn) {
        sn.lat = ll.lat; sn.lng = ll.lng;
        if (typeof window.updateStromEdgeGeometry === 'function') window.updateStromEdgeGeometry();
      }
      if (a.type === 'Lade') _drawLadeParkingRects(a);
      if (a.type === 'Wind') { _drawWindRings(a); _drawWindEignungsflaeche(a); }
    }
  });

  m.on('click', e => {
    L.DomEvent.stopPropagation(e);
    // Kabelmodus: Container auffächern, damit ein einzelnes Asset als
    // Leitungs-Endpunkt gewählt werden kann.
    if (window.isDrawingStromEdge) {
      spiderfyBuilding(buildingId, m.getLatLng());
      return;
    }
    selectFromMap(buildingId);
    openBuildingAssetList(buildingId, m);
  });
  m.on('contextmenu', e => {
    L.DomEvent.stopPropagation(e);
    _showAssetDeletePopup(buildingId, m.getLatLng());
  });

  m.addTo(assetLayer);
  // Alle Assets der Gruppe teilen den Marker-Ref (für deleteAsset) und werden
  // am Container-Standort als Strom-Knoten registriert (für Kabelanschluss).
  for (const a of assets) {
    if (a._marker && a._marker !== m) a._marker.remove();
    if (a._ladeLayer) { a._ladeLayer.remove(); a._ladeLayer = null; }
    a._marker = m;
    a.lat = c.lat;
    a.lng = c.lng;
    _registerStromNode(a, m, c.lat, c.lng, buildingId);
    if (a.type === 'Lade') _drawLadeParkingRects(a);
    if (a.type === 'Wind') { _drawWindRings(a); _drawWindEignungsflaeche(a); }
  }
}

// Liste aller Assets des Gebäudes — Auswahl öffnet Inspector
function _showAssetDeletePopup(buildingId, latlng) {
  const assets = getAssetsForBuilding(buildingId);
  if (assets.length === 0) return;
  if (assets.length === 1) {
    deleteAsset(assets[0].id);
    redrawAllAssets();
    return;
  }
  const rows = assets.map(a => {
    const cfg = ASSET_CFG[a.type];
    return `<div class="asset-del-row" data-id="${a.id}" style="display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:4px;">` +
      `<span style="background:${cfg.color};width:18px;height:18px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">${cfg.icon}</span>` +
      `<span style="flex:1;font-size:11px;">${a.name}</span>` +
      `<span style="color:#ef5350;font-size:12px;font-weight:700;">✕</span>` +
      `</div>`;
  }).join('');
  const popup = L.popup({ className: 'asset-list-popup', offset: [0, -8], maxWidth: 240 })
    .setLatLng(latlng)
    .setContent(`<div style="font-size:10px;color:var(--muted);padding:4px 6px 2px;border-bottom:1px solid var(--border);margin-bottom:4px;">Löschen</div><div>${rows}</div>`)
    .openOn(map);
  setTimeout(() => {
    document.querySelectorAll('.asset-del-row').forEach(row => {
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(239,83,80,0.12)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => {
        deleteAsset(row.dataset.id);
        map.closePopup(popup);
        redrawAllAssets();
      });
    });
  }, 0);
}

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

// ── Spiderfy: Gebäude-Container auffächern ──────────────────────────────────
// Im Kabelmodus klappt der Container in seine Einzel-Assets auf, damit der
// Nutzer ein konkretes Asset als Leitungs-Endpunkt wählen kann. Die Fächer-
// Marker sind temporär (kein Daten-Marker) und sitzen pixelgenau um den Mittelpunkt.
let _spiderLayer = null;

export function collapseAssetSpider() {
  if (_spiderLayer) { _spiderLayer.remove(); _spiderLayer = null; }
}

function spiderfyBuilding(buildingId, centerLatLng) {
  collapseAssetSpider();
  const assets = getAssetsForBuilding(buildingId);
  if (assets.length === 0) return;

  // Einzelnes Asset → direkt als Endpunkt wählen, kein Fächer nötig
  if (assets.length === 1) {
    if (typeof window.stromNodeClick === 'function') window.stromNodeClick(assets[0].id);
    return;
  }

  _spiderLayer = L.layerGroup().addTo(map);
  const cPt = map.latLngToLayerPoint(centerLatLng);
  const R   = 22 + assets.length * 6;   // px Fächer-Radius
  const sz  = 26;

  assets.forEach((a, i) => {
    const ang = (2 * Math.PI * i / assets.length) - Math.PI / 2;
    const ll  = map.layerPointToLatLng(L.point(cPt.x + R * Math.cos(ang), cPt.y + R * Math.sin(ang)));
    const cfg = ASSET_CFG[a.type];

    L.polyline([centerLatLng, ll], { color: '#fdd835', weight: 1.5, opacity: 0.7, dashArray: '3 3', interactive: false }).addTo(_spiderLayer);

    const icon = L.divIcon({
      className: 'asset-divicon',
      html: `<div class="asset-spider-icon" style="background:${cfg.color};width:${sz}px;height:${sz}px;font-size:${Math.round(sz * 0.55)}px;">${cfg.icon}</div>`,
      iconSize:   [sz, sz],
      iconAnchor: [sz / 2, sz / 2],
    });
    const sm = L.marker(ll, { icon, zIndexOffset: 5000 }).addTo(_spiderLayer);
    sm.bindTooltip(a.name, { direction: 'top', className: 'geb-tooltip', offset: [0, -6] });
    sm.on('click', ev => {
      L.DomEvent.stopPropagation(ev);
      if (window.isDrawingStromEdge && typeof window.stromNodeClick === 'function') {
        window.stromNodeClick(a.id);
      } else {
        ASSETS.selectedId = a.id;
        if (typeof window.openAssetInspector === 'function') window.openAssetInspector(a);
      }
      collapseAssetSpider();
    });
    sm.on('contextmenu', ev => {
      L.DomEvent.stopPropagation(ev);
      collapseAssetSpider();
      deleteAsset(a.id);
      redrawAllAssets();
    });
  });

  // Klick auf die leere Karte schließt den Fächer wieder
  map.once('click', collapseAssetSpider);
}

// ── Lade-Asset: Geo-Koordinaten-Polygone (wie Geothermie) ────────────────────
// Stellplätze als L.polygon mit echten Meterdimensionen — skaliert automatisch
// mit dem Zoom, kein SVG-Pixelproblem.

// Berechnet alle Eckpunkte für n Stellplätze + Sammelschiene
function _ladeParkingCoords(lat0, lng0, rotR, n) {
  const SW_m = 2.5, SH_m = 5.0, SG_m = 0.1;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(lat0 * Math.PI / 180);
  const totalW  = n * SW_m + (n - 1) * SG_m;

  function toLL(x_m, y_m) {
    const rx =  x_m * Math.cos(rotR) + y_m * Math.sin(rotR);
    const ry = -x_m * Math.sin(rotR) + y_m * Math.cos(rotR);
    return [lat0 + ry / mPerLat, lng0 + rx / mPerLng];
  }

  const spots = [];
  for (let i = 0; i < n; i++) {
    const x0 = -totalW / 2 + i * (SW_m + SG_m);
    spots.push([toLL(x0, 0), toLL(x0 + SW_m, 0), toLL(x0 + SW_m, SH_m), toLL(x0, SH_m)]);
  }
  const bus = [toLL(-totalW / 2, 0), toLL(totalW / 2, 0)];
  return { spots, bus };
}

function _drawLadeParkingRects(asset) {
  if (asset._ladeLayer) { asset._ladeLayer.remove(); asset._ladeLayer = null; }

  const p      = asset.props || {};
  const n      = Math.max(1, parseInt(p.anzahlPunkte) || 4);
  const rotR   = ((parseFloat(p.rotation) || 0) * Math.PI) / 180;
  const status = getAssetStatus(asset, globalYear);
  const opacity = status === 'active' ? 1 : 0.5;
  const dash    = status === 'planned' ? '4 3' : null;
  const { spots, bus } = _ladeParkingCoords(asset.lat, asset.lng, rotR, n);

  const group = L.layerGroup();
  asset._ladePolygons = spots.map(corners =>
    L.polygon(corners, { color:'#4dd0e1', weight:1.5, fillColor:'#4dd0e1',
      fillOpacity:0.12 * opacity, opacity, dashArray:dash }).addTo(group)
  );
  asset._ladeBusLine = L.polyline(bus,
    { color:'#4dd0e1', weight:2.5, opacity:0.9 * opacity }).addTo(group);

  group.addTo(standaloneLayer);
  asset._ladeLayer = group;
}

// Live-Update nur der Koordinaten (kein Layer-Neubau) — für drag und Rotation
function _updateLadeParkingCoords(asset, lat, lng) {
  if (!asset._ladePolygons || !asset._ladeBusLine) return;
  const p    = asset.props || {};
  const n    = Math.max(1, parseInt(p.anzahlPunkte) || 4);
  const rotR = ((parseFloat(p.rotation) || 0) * Math.PI) / 180;
  const { spots, bus } = _ladeParkingCoords(lat, lng, rotR, n);
  spots.forEach((corners, i) => asset._ladePolygons[i]?.setLatLngs(corners));
  asset._ladeBusLine.setLatLngs(bus);
}

// ── Wind-Asset: Abstands- und Lärmringe (analog zu den LW-WP-Schallringen) ──
function _drawWindRings(asset) {
  if (asset._windLayer) { asset._windLayer.remove(); asset._windLayer = null; }
  const p = asset.props || {};
  const showAbstand = p.abstandVisible !== false;
  const showLaerm   = p.laermVisible === true;
  if (!showAbstand && !showLaerm) return;

  const pt    = L.latLng(asset.lat, asset.lng);
  const group = L.layerGroup();

  if (showAbstand) {
    const rotorD = parseFloat(p.rotordurchmesserM)   || 60;
    const mult   = parseFloat(p.abstandMultiplikator) || 5;
    const r = mult * rotorD;
    if (r > 0) {
      L.circle(pt, { radius: r, color: '#ab47bc', weight: 1.5, dashArray: '6 4', fillColor: '#ab47bc', fillOpacity: 0.06 })
        .bindTooltip(`Planungsabstand (Faustregel): ${mult}× Rotordurchmesser = ${r.toFixed(0)} m`, { sticky: true })
        .addTo(group);
    }
  }

  if (showLaerm) {
    const ratedKw = parseFloat(p.leistungKW) || 500;
    const lwa = parseFloat(p.windLwa) || calcWindLwaAuto(ratedKw);
    const schallStufen = [55, 50, 45, 40, 35];
    const schallFarben = ['#b71c1c', '#e65100', '#f9a825', '#8bc34a', '#2e7d32'];
    for (let i = schallStufen.length - 1; i >= 0; i--) {
      const r = lwWpSchallRadiusM(lwa, schallStufen[i]);
      if (r > 0.5 && r < 3000) {
        const circle = L.circle(pt, { radius: r, color: schallFarben[i], weight: 1.5, fillColor: schallFarben[i], fillOpacity: 0.06 }).addTo(group);
        circle.bindTooltip('', { sticky: true, direction: 'top', opacity: 0.9 });
        circle.on('mousemove', ev => {
          const d = pt.distanceTo(ev.latlng);
          if (d <= 0) return;
          const lpAtD = lwa - 11 - 20 * Math.log10(d);
          const tt = circle.getTooltip();
          if (!tt) return;
          tt.setContent(`<div class="lwwp-tooltip">Abstand: ${d.toFixed(1)} m<br>Pegel ≈ ${lpAtD.toFixed(1)} dB(A)</div>`);
          tt.setLatLng(ev.latlng);
          if (!map.hasLayer(tt)) circle.openTooltip(ev.latlng);
        });
      }
    }
  }

  group.addTo(standaloneLayer);
  asset._windLayer = group;
}

// Live-Update nur der Ring-Position (kein Layer-Neubau) — für drag
function _updateWindRingsPosition(asset, lat, lng) {
  if (!asset._windLayer) return;
  const pt = L.latLng(lat, lng);
  asset._windLayer.eachLayer(layer => { if (layer.setLatLng) layer.setLatLng(pt); });
}

// ── Wind-Eignungsfläche: Rasterüberlagerung des Plangebiets ─────────────────
// Nur eine Instanz gleichzeitig sichtbar (zuletzt aktivierte Anlagenkonfiguration) —
// mehrere überlagerte Raster wären auf der Karte kaum unterscheidbar.
let _windEignungsLayer = null;

function _buildingRingsForEignung() {
  const buildings = window.gebaeude || [];
  return buildings
    .filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3)
    .map(g => g.polygon.map(pt => ({ lat: pt.lat ?? pt[0], lng: pt.lng ?? pt[1] })));
}

function _drawWindEignungsflaeche(asset) {
  if (_windEignungsLayer) { _windEignungsLayer.remove(); _windEignungsLayer = null; }
  asset._eignungsStats = null;
  const p = asset.props || {};
  if (p.eignungsflaecheVisible !== true) return;

  // Eigenes Windgebiet geht vor dem allgemeinen Plangebiet (siehe 02c-karte-werkzeuge.js
  // toggleDrawWindGebiet / _distanceToPlangebietM in 13e-assets-inspector.js).
  const poly = window.windGebietPolygon || window.areaPolygon;
  if (!poly || typeof poly.getLatLngs !== 'function') { asset._eignungsStats = { error: 'no-plangebiet' }; return; }
  const rings = poly.getLatLngs();
  const ring  = (Array.isArray(rings[0]) ? rings[0] : rings).map(ll => ({ lat: ll.lat, lng: ll.lng }));

  const rotorD  = parseFloat(p.rotordurchmesserM)    || 60;
  const mult    = parseFloat(p.abstandMultiplikator) || 5;
  const nabenhoehe = parseFloat(p.nabenhoheM)        || 100;
  const radiusM = rotorD * mult;
  // Zur Gebietsgrenze reicht die Kipphöhe (≈ Gesamthöhe); der volle Planungsabstand
  // gilt nur zu Gebäuden — gleiche Logik wie die Platzierungsvorschläge (13t/13s).
  const boundaryM = nabenhoehe + rotorD / 2;

  const result = computeSuitabilityGrid({
    polygonRing: ring,
    buildingRings: _buildingRingsForEignung(),
    exclusionRings: (window.getWindRestriktRings && window.getWindRestriktRings()) || [],
    radiusM,
    boundaryM,
    gridStepM: Math.max(10, Math.round(radiusM / 10)),
  });
  asset._eignungsStats = { ...result, radiusM };
  if (!result.cells.length) return;

  const group = L.featureGroup(); // featureGroup statt layerGroup — liefert .getBounds() für Zoom-Funktion
  const mPerLat = 111320;
  const half = result.gridStepM / 2;
  for (const c of result.cells) {
    const mPerLng = 111320 * Math.cos((c.lat * Math.PI) / 180);
    const dLat = half / mPerLat, dLng = half / mPerLng;
    L.rectangle([[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]], {
      color: '#00e676', weight: 1, opacity: 0.9, fillColor: '#00e676', fillOpacity: 0.55, interactive: false,
    }).addTo(group);
  }
  group.addTo(standaloneLayer);
  _windEignungsLayer = group;
}

// Eignungsflächen aller Anlagen mit aktiver Anzeige neu berechnen — z.B. wenn sich die
// OSM-Restriktions-Ausschlüsse (13u) geändert haben. Über window-Bridge aufrufbar.
export function refreshWindEignung() {
  for (const a of (ASSETS.items || [])) {
    if (a.type === 'Wind' && a.props?.eignungsflaecheVisible === true) _drawWindEignungsflaeche(a);
  }
  if (typeof window.windaRenderPanel === 'function') window.windaRenderPanel();
}

// Kartenausschnitt auf die zuletzt berechnete Eignungsfläche zoomen (Fläche kann bei
// großen Plangebieten weit vom aktuell sichtbaren Kartenausschnitt entfernt liegen).
export function zoomToWindEignungsflaeche() {
  if (!_windEignungsLayer) return false;
  const bounds = _windEignungsLayer.getBounds?.();
  if (!bounds || !bounds.isValid || !bounds.isValid()) return false;
  map.fitBounds(bounds, { padding: [40, 40] });
  return true;
}

// ── Einzel-Marker (Assets ohne Gebäude) ─────────────────────────────────────
function drawSingleMarker(asset) {
  ensureLayer();
  const cfg = ASSET_CFG[asset.type];
  if (!cfg) return;

  if (asset._marker) {
    asset._marker.remove();
    asset._marker = null;
  }
  if (asset._ladeLayer) {
    asset._ladeLayer.remove();
    asset._ladeLayer = null;
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
  const selClass = window.assetSelection?.has(asset.id) ? ' asset-selected' : '';
  // Bulk-Modus: nicht-selektierte Marker ausgegraut — direkt beim Zeichnen setzen,
  // damit ein Neuzeichnen (Auswahl/Inspector) das Dimming nicht verliert.
  const dimClass = (window.isBulkModeActive?.() && !window.assetSelection?.has(asset.id)) ? ' asset-bulk-dimmed' : '';
  const icon = L.divIcon({
    className: 'asset-divicon' + dimClass,
    html: `<div class="asset-marker asset-marker-${status}${selClass}"
              style="background:${cfg.color};border-style:${border};border-width:${borderW}px;opacity:${opacity};width:${size}px;height:${size}px;">
             <span class="asset-marker-icon" style="font-size:${fontSize}px;">${cfg.icon}</span>
             ${pendingBadge}
           </div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  const m = L.marker([markerLat, markerLng], { icon, draggable: true, zIndexOffset: 3000 });
  m.bindTooltip(() => _buildAssetTooltip(asset), { sticky: true, className: 'geb-tooltip', offset: [8, 0] });

  _registerStromNode(asset, m, markerLat, markerLng, asset.buildingId);

  m.on('click', e => {
    if (window.isDrawingStromEdge) {
      if (cfg.domain === 'strom' && typeof window.stromNodeClick === 'function') {
        window.stromNodeClick(asset.id);
      }
      return;
    }
    L.DomEvent.stopPropagation(e);
    // Shift+Click → Selektion umschalten statt Inspector öffnen
    if (e.originalEvent?.shiftKey && typeof window.selToggle === 'function') {
      window.selToggle(asset.id);
      return;
    }
    ASSETS.selectedId = asset.id;
    if (typeof window.openAssetInspector === 'function') window.openAssetInspector(asset);
  });
  m.on('contextmenu', e => {
    L.DomEvent.stopPropagation(e);
    deleteAsset(asset.id);
    redrawAllAssets();
  });

  if (asset.type === 'Lade') {
    m.on('drag', () => {
      const ll = m.getLatLng();
      _updateLadeParkingCoords(asset, ll.lat, ll.lng);
    });
  }
  if (asset.type === 'Wind') {
    m.on('drag', () => {
      const ll = m.getLatLng();
      _updateWindRingsPosition(asset, ll.lat, ll.lng);
    });
  }

  m.on('dragend', () => {
    const ll = m.getLatLng();
    asset.lat = ll.lat;
    asset.lng = ll.lng;
    if (asset.type === 'Lade') _drawLadeParkingRects(asset);
    if (asset.type === 'Wind') { _drawWindRings(asset); _drawWindEignungsflaeche(asset); }
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

  // Lade: Parkplatz-Polygone in Geo-Koordinaten (skaliert automatisch mit Zoom)
  if (asset.type === 'Lade') _drawLadeParkingRects(asset);
  // Wind: Abstands-/Lärmringe und Eignungsfläche
  if (asset.type === 'Wind') { _drawWindRings(asset); _drawWindEignungsflaeche(asset); }
}

// ── Öffentliche API ─────────────────────────────────────────────────────────
export function drawAssetMarker(asset) {
  if (asset.buildingId) drawBuildingGroup(asset.buildingId);
  else drawSingleMarker(asset);
}

// Nur Parkplatz-Polygone neu zeichnen (ohne Anker-Marker anzufassen) — für Live-Rotation
export function updateLadeParking(asset) {
  if (asset._ladePolygons && asset._ladeBusLine) {
    _updateLadeParkingCoords(asset, asset.lat, asset.lng);
  } else {
    _drawLadeParkingRects(asset);
  }
}

// Nur die Gebäude-Container neu zeichnen (für Zoom-Rescale) — Lade-Polygone
// bleiben unangetastet.
function redrawBuildingGroups() {
  if (!assetLayer) return;
  assetLayer.clearLayers();
  const buildingIds = new Set();
  for (const a of ASSETS.items) if (a.buildingId) buildingIds.add(a.buildingId);
  for (const buildingId of buildingIds) drawBuildingGroup(buildingId);
}

// Einzel-Marker (Assets ohne Gebäude) neu zeichnen (für Zoom-Rescale) — sie
// skalieren wie die Gebäude-Chips über chipSizeAtZoom() und müssen deshalb
// bei jedem Zoomwechsel mit-aktualisiert werden, sonst bleiben sie auf der
// Größe der letzten Zoomstufe stehen und wirken kleiner/größer als die Chips.
function redrawStandaloneMarkers() {
  if (!standaloneLayer) return;
  for (const a of ASSETS.items) {
    if (!a.buildingId) drawSingleMarker(a);
  }
}

export function redrawAllAssets() {
  ensureLayer();
  assetLayer.clearLayers();
  standaloneLayer.clearLayers();
  _windEignungsLayer = null;
  for (const a of ASSETS.items) { a._marker = null; a._ladeLayer = null; a._windLayer = null; a._eignungsStats = null; }

  // Assets mit Gebäude-Zuordnung → ein Typ-Chip-Container pro Gebäude,
  // alle übrigen Assets als Einzel-Marker.
  const buildingIds = new Set();
  for (const a of ASSETS.items) {
    if (a.buildingId) buildingIds.add(a.buildingId);
    else drawSingleMarker(a);
  }
  for (const buildingId of buildingIds) drawBuildingGroup(buildingId);

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

setTimeout(() => {
  window.refreshWindEignungAll = refreshWindEignung;
  map.on('zoomend', () => {
    applyLayerVisibility();
    // Chip-/Marker-Größe an neue Zoomstufe anpassen (nur wenn Layer sichtbar)
    if (layerVisible && map.getZoom() >= ASSET_COLLAPSED_ZOOM) redrawBuildingGroups();
    if (layerVisible) redrawStandaloneMarkers();
  });
}, 0);
