// ── 13h-netzanalyse.js — Lastdichte-Heatmap + Trafo-Platzierungsoptimierung ──
// Portiert aus Energiekarte1.1(6).html (Zeilen 13185–14900)
//
// Leistungsumfang:
//   • Heatmap (Relief-Canvas + Höhenlinien, Legacy-Kreise)
//   • MST-Kabeltrassen (Minimaler Spannbaum je Zone)
//   • k-Means-Clustering + Voronoi-Zonen
//   • Trafo-Platzierungsoptimierung (manuell k / Auto max. kVA)
//   • Bestehende Trafos analysieren (Auslastung + Erschöpfungsjahr)

import { map, addGebaeude } from './02b-gebaeude.js';
import { ASSETS, ASSET_CFG, getAssetStatus, getAsset, TYPE_RANK } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';
import { getInfraNodeResidual, isInfraNode, invalidateKnotenProfileCache } from './13r-knotenpunkt-analyse.js';

// ── Farben ───────────────────────────────────────────────────────────────────
const NA_CLUSTER_COLORS = [
  '#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc',
  '#26c6da','#d4e157','#ec407a','#8d6e63','#78909c',
];

// Farben für Erzeugungsnetz (Teal/Cyan-Palette, klar von Verbrauch unterscheidbar)
const NA_ERZEUG_COLORS = [
  '#00acc1','#0097a7','#26c6da','#00bcd4','#4dd0e1',
  '#006064','#80deea','#00838f','#b2ebf2','#4fc3f7',
];

// ── Modulzustand ─────────────────────────────────────────────────────────────
const NA = {
  // Panel-Tabs
  activeTab:     'last',     // 'last' | 'trafo' | 'ms'

  // Heatmap
  heatmapActive:   false,
  heatmapMode:     'relief',  // 'relief' | 'legacy'
  heatmapLayers:   { load: true, gen: true },
  heatmapContours: true,
  heatmapCfg: { kernelRadiusM: 90, gridPx: 10, minAlpha: 0.04, maxAlpha: 0.78 },
  heatmapPending:  false,

  // Kabeltrassen
  kabelActive:   false,
  naKabelEdges:  [],
  naKabelInfo:   null,
  naKabelEurM:   200,

  // Trafo-Optimierung
  mode:          'manual',   // 'manual' | 'auto'
  k:             3,
  maxKVA:        630,
  cosPhi:        0.9,
  gzf:           0.7,
  minUtilPct:    25,
  proxRadius:    0,
  useExisting:   false,
  naResult:      null,
  naMaxKW:       null,
  naAutoInfo:    null,
  naExistingResults: null,
  naKCompare:    null,      // Alternativen-Vergleich (Stationen vs. Kabellänge) im Auto-Modus

  // Erzeugungsnetz
  erzeugungsnetz:     false,
  naErzeugResult:     null,
  naErzeugMaxKW:      null,

  // Speicher-/Notstrom-Platzierung
  batMethod:   'netz',      // 'netz' (Merit-Order über Netzknoten) | 'geo' (Lastschwerpunkte)
  batMode:     'zentral',   // 'zentral' | 'verteilt'
  batK:        3,
  batShavePct: 40,          // Batterieleistung = % der Zonenlast / Knotenspitze
  batHours:    2,           // Kapazität = Leistung × Stunden (Energie-Budget)
  batSizeMode: 'auto',      // 'auto' (Shave-basiert) | 'pv' (feste Größe aus PV-Variante)
  batPvVariantId: null,     // gewählte PV-Variante (id), null = erste mit Batterie
  batGuideOpen: false,      // Anleitung zentral/dezentral aufgeklappt
  batResult:   null,
  nsaMode:     'zentral',
  nsaK:        3,
  nsaSource:   'resilienz', // 'resilienz' | 'spitzenlast'
  nsaResult:   null,
};

// Leaflet-Layer-Gruppen (lazy init)
let grpHeatmapLoad    = null;
let grpHeatmapGen     = null;
let grpHeatmapLegacy  = null;
let grpKabeltrassen   = null;
let grpKMeans         = null;
let grpExistingTrafos = null;
let grpErzeugungKMeans = null;
let grpBatPlace       = null;
let grpNsaPlace       = null;

function _ensureGroups() {
  if (!grpHeatmapLoad)    grpHeatmapLoad    = L.layerGroup();
  if (!grpHeatmapGen)     grpHeatmapGen     = L.layerGroup();
  if (!grpHeatmapLegacy)  grpHeatmapLegacy  = L.layerGroup();
  if (!grpKabeltrassen)   grpKabeltrassen   = L.layerGroup();
  if (!grpKMeans)         grpKMeans         = L.layerGroup();
  if (!grpExistingTrafos) grpExistingTrafos = L.layerGroup();
  if (!grpErzeugungKMeans) grpErzeugungKMeans = L.layerGroup();
  if (!grpBatPlace)       grpBatPlace       = L.layerGroup();
  if (!grpNsaPlace)       grpNsaPlace       = L.layerGroup();
}

// ── Adapter: Lastpunkte aus aktiven Assets ───────────────────────────────────
export function naGetLoadPoints(year) {
  const yr = year || globalYear || new Date().getFullYear();
  const result = [];
  for (const a of ASSETS.items) {
    if (getAssetStatus(a, yr) !== 'active') continue;
    if (a.lat == null || a.lng == null) continue;
    const props = a.props || {};
    let loadKW = 0, genKW = 0;
    switch (a.type) {
      case 'Verbraucher': loadKW = parseFloat(props.leistungKW)  || 0; break;
      case 'Lade':        loadKW = (parseInt(props.anzahlPunkte)||1) * (parseFloat(props.leistungProPunktKW)||11); break;
      case 'WP':          loadKW = parseFloat(props.leistungKW)  || 0; break;
      case 'NSHV':        loadKW = parseFloat(props.leistungKW)  || 0; break;
      case 'PV':          genKW  = (parseFloat(props.leistungKWp) || 0) * 0.8; break;
      case 'Wind':        genKW  = parseFloat(props.leistungKW)  || 0; break;
      case 'Batterie':    genKW  = parseFloat(props.leistungKW)  || 0; break;
    }
    const peakKW = Math.max(loadKW, genKW);
    if (peakKW > 0 && isFinite(a.lat) && isFinite(a.lng))
      result.push({ lat: a.lat, lng: a.lng, loadKW, genKW, peakKW,
                    netKW: loadKW - genKW, name: a.name, id: a.id, type: a.type });
  }
  return result;
}

// ── Heatmap-Helfer ───────────────────────────────────────────────────────────
function _metersToPixels(meters, lat) {
  const zoom = map.getZoom();
  const mpp  = 156543.03392 * Math.cos((lat || map.getCenter().lat) * Math.PI / 180) / Math.pow(2, zoom);
  return meters / Math.max(mpp, 0.001);
}

function _reliefColor(t, kind) {
  const v = Math.max(0, Math.min(1, t));
  const stops = kind === 'gen'
    ? [[0,[20,30,55]],[0.4,[33,150,243]],[0.7,[100,181,246]],[1,[187,222,251]]]
    : [[0,[35,25,25]],[0.35,[102,187,106]],[0.65,[255,167,38]],[1,[239,83,80]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]; const [t1, c1] = stops[i + 1];
    if (v >= t0 && v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return kind === 'gen' ? [187, 222, 251] : [239, 83, 80];
}

function _buildReliefCanvas(points, kind) {
  const size = map.getSize();
  const w = Math.max(32, size.x);
  const h = Math.max(32, size.y);
  const cfg = NA.heatmapCfg;
  const cellPx = Math.max(6, parseInt(cfg.gridPx || 10));
  const gw = Math.max(2, Math.ceil(w / cellPx));
  const gh = Math.max(2, Math.ceil(h / cellPx));
  const field = new Float32Array(gw * gh);
  let maxV = 0;

  for (const p of points) {
    const kw = kind === 'gen' ? p.genKW : p.loadKW;
    if (!(kw > 0)) continue;
    const cp = map.latLngToContainerPoint([p.lat, p.lng]);
    if (!isFinite(cp.x) || !isFinite(cp.y)) continue;
    const sigmaPx = Math.max(14, _metersToPixels(cfg.kernelRadiusM || 90, p.lat) * 0.6);
    const reachPx = sigmaPx * 3;
    const minX = Math.max(0, Math.floor((cp.x - reachPx) / cellPx));
    const maxX = Math.min(gw - 1, Math.ceil((cp.x + reachPx) / cellPx));
    const minY = Math.max(0, Math.floor((cp.y - reachPx) / cellPx));
    const maxY = Math.min(gh - 1, Math.ceil((cp.y + reachPx) / cellPx));
    const inv2s2 = 1 / (2 * sigmaPx * sigmaPx);
    for (let gy = minY; gy <= maxY; gy++) {
      const py = (gy + 0.5) * cellPx;
      const dy = py - cp.y;
      for (let gx = minX; gx <= maxX; gx++) {
        const px = (gx + 0.5) * cellPx;
        const dx = px - cp.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > reachPx * reachPx) continue;
        const idx = gy * gw + gx;
        const nv = field[idx] + kw * Math.exp(-d2 * inv2s2);
        field[idx] = nv;
        if (nv > maxV) maxV = nv;
      }
    }
  }

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gw; gridCanvas.height = gh;
  const gctx = gridCanvas.getContext('2d');
  const img = gctx.createImageData(gw, gh);
  const minA = cfg.minAlpha ?? 0.04;
  const maxA = cfg.maxAlpha ?? 0.78;

  for (let i = 0; i < field.length; i++) {
    const base = i * 4;
    if (maxV <= 0 || field[i] <= 0) { img.data[base + 3] = 0; continue; }
    const t   = Math.pow(field[i] / maxV, 0.72);
    const rgb = _reliefColor(t, kind);
    const a   = Math.max(minA, Math.min(maxA, t * maxA));
    img.data[base] = rgb[0]; img.data[base+1] = rgb[1];
    img.data[base+2] = rgb[2]; img.data[base+3] = Math.round(a * 255);
  }
  gctx.putImageData(img, 0, 0);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(gridCanvas, 0, 0, w, h);
  return { canvas: out, maxValue: maxV, field, gw, gh, cellPx };
}

function _drawContoursOnCanvas(ctx, field, gw, gh, cellPx, maxV, color) {
  if (!(maxV > 0)) return;
  const levels = [0.22, 0.4, 0.58, 0.74, 0.9];
  const edgePt = (edge, x, y) => {
    const px = (x + 0.5) * cellPx, py = (y + 0.5) * cellPx;
    if (edge === 0) return [px + cellPx * 0.5, py];
    if (edge === 1) return [px + cellPx, py + cellPx * 0.5];
    if (edge === 2) return [px + cellPx * 0.5, py + cellPx];
    return [px, py + cellPx * 0.5];
  };
  const lookup = {
    0:[], 1:[[3,0]], 2:[[0,1]], 3:[[3,1]], 4:[[1,2]], 5:[[3,2],[0,1]],
    6:[[0,2]], 7:[[3,2]], 8:[[2,3]], 9:[[0,2]], 10:[[0,3],[1,2]],
    11:[[1,2]], 12:[[1,3]], 13:[[0,1]], 14:[[3,0]], 15:[],
  };
  ctx.save(); ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let li = 0; li < levels.length; li++) {
    const thr = levels[li] * maxV;
    ctx.globalAlpha = 0.17 + li * 0.07;
    ctx.lineWidth   = 0.8  + li * 0.15;
    ctx.beginPath();
    for (let y = 0; y < gh - 1; y++) {
      const row = y * gw, rowN = (y + 1) * gw;
      for (let x = 0; x < gw - 1; x++) {
        const c = (field[row+x]  >= thr ? 1 : 0) | (field[row+x+1] >= thr ? 2 : 0) |
                  (field[rowN+x+1] >= thr ? 4 : 0) | (field[rowN+x] >= thr ? 8 : 0);
        const segs = lookup[c] || [];
        for (const seg of segs) {
          const a = edgePt(seg[0], x, y); const b = edgePt(seg[1], x, y);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function _refreshRelief() {
  _ensureGroups();
  grpHeatmapLoad.clearLayers(); grpHeatmapGen.clearLayers(); grpHeatmapLegacy.clearLayers();
  if (!NA.heatmapActive) return;
  if (!map.hasLayer(grpHeatmapLoad))   grpHeatmapLoad.addTo(map);
  if (!map.hasLayer(grpHeatmapGen))    grpHeatmapGen.addTo(map);
  const pts    = naGetLoadPoints();
  if (!pts.length) return;
  const bounds = map.getBounds();

  if (NA.heatmapLayers?.load !== false) {
    const lr = _buildReliefCanvas(pts, 'load');
    if (lr.maxValue > 0) {
      if (NA.heatmapContours) {
        const lctx = lr.canvas.getContext('2d');
        _drawContoursOnCanvas(lctx, lr.field, lr.gw, lr.gh, lr.cellPx, lr.maxValue, '#ef5350');
      }
      L.imageOverlay(lr.canvas.toDataURL(), bounds, { opacity: 1, interactive: false })
        .addTo(grpHeatmapLoad);
    }
  }
  if (NA.heatmapLayers?.gen !== false) {
    const gr = _buildReliefCanvas(pts, 'gen');
    if (gr.maxValue > 0) {
      if (NA.heatmapContours) {
        const gctx = gr.canvas.getContext('2d');
        _drawContoursOnCanvas(gctx, gr.field, gr.gw, gr.gh, gr.cellPx, gr.maxValue, '#42a5f5');
      }
      L.imageOverlay(gr.canvas.toDataURL(), bounds, { opacity: 1, interactive: false })
        .addTo(grpHeatmapGen);
    }
  }
}

function _refreshLegacy() {
  _ensureGroups();
  grpHeatmapLoad.clearLayers(); grpHeatmapGen.clearLayers(); grpHeatmapLegacy.clearLayers();
  if (!NA.heatmapActive) return;
  if (!map.hasLayer(grpHeatmapLegacy)) grpHeatmapLegacy.addTo(map);
  const pts = naGetLoadPoints();
  const maxPeak = Math.max(...pts.map(p => p.peakKW), 1);
  for (const p of pts) {
    const r = Math.max(6, Math.round((p.peakKW / maxPeak) * 40));
    const col = p.genKW > p.loadKW ? '#42a5f5' : '#ef5350';
    L.circleMarker([p.lat, p.lng], {
      radius: r, color: col, fillColor: col, fillOpacity: 0.35, weight: 1.5, interactive: false,
    }).bindTooltip(`${p.name}: ${p.peakKW.toFixed(0)} kW`, { sticky: true })
      .addTo(grpHeatmapLegacy);
  }
}

function _refreshHeatmap() {
  if (NA.heatmapMode === 'legacy') _refreshLegacy();
  else _refreshRelief();
}

function _requestHeatmapRefresh() {
  if (!NA.heatmapActive || NA.heatmapPending) return;
  NA.heatmapPending = true;
  requestAnimationFrame(() => { NA.heatmapPending = false; _refreshHeatmap(); });
}

// ── Öffentliche Heatmap-API ──────────────────────────────────────────────────
export function naHeatmapToggle(show) {
  _ensureGroups();
  NA.heatmapActive = !!show;
  if (!NA.heatmapActive) {
    grpHeatmapLoad.clearLayers(); grpHeatmapGen.clearLayers(); grpHeatmapLegacy.clearLayers();
  } else {
    _requestHeatmapRefresh();
  }
  naRenderPanel();
}

export function naSetHeatmapMode(mode) {
  NA.heatmapMode = mode === 'legacy' ? 'legacy' : 'relief';
  if (NA.heatmapActive) _refreshHeatmap();
  naRenderPanel();
}

export function naHeatmapSetLayerVisibility(kind, show) {
  if (!NA.heatmapLayers) NA.heatmapLayers = { load: true, gen: true };
  NA.heatmapLayers[kind] = !!show;
  if (NA.heatmapActive) _requestHeatmapRefresh();
  naRenderPanel();
}

// ── MST-Kabeltrassen ─────────────────────────────────────────────────────────
function _distM(a, b) {
  const dlat = (b.lat - a.lat) * 111320;
  const dlng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function _computeMST(root, points) {
  if (!points || points.length === 0) return [];
  const nodes  = [root, ...points];
  const inTree = new Set([0]);
  const edges  = [];
  while (inTree.size < nodes.length) {
    let bestDist = Infinity, bestFrom = -1, bestTo = -1;
    for (const fi of inTree) {
      for (let ti = 0; ti < nodes.length; ti++) {
        if (inTree.has(ti)) continue;
        const d = _distM(nodes[fi], nodes[ti]);
        if (d < bestDist) { bestDist = d; bestFrom = fi; bestTo = ti; }
      }
    }
    if (bestTo === -1) break;
    inTree.add(bestTo);
    edges.push({ from: nodes[bestFrom], to: nodes[bestTo], lengthM: bestDist });
  }
  return edges;
}

function _naKabelUpdateStyle(ke) {
  const col  = ke.selected ? '#ffb300' : ke.col;
  const w    = ke.selected ? 4 : 2.5;
  ke.poly.setStyle({ color: col, weight: w, opacity: ke.selected ? 1 : 0.85 });
  const len  = ke.edge.routedLengthM || ke.edge.lengthM;
  ke.poly.setTooltipContent(
    `${ke.zoneName} · ${len.toFixed(0)} m` +
    (ke.routed   ? ' 🛣'   : '') +
    (ke.selected ? ' ✓ ausgewählt' : '')
  );
}

export function naDrawKabeltrassen() {
  _ensureGroups();
  grpKabeltrassen.clearLayers();
  NA.naKabelInfo  = { totalM: 0, zones: [] };
  NA.naKabelEdges = [];
  if (!NA.kabelActive) return;

  const exRes = NA.naExistingResults;
  if (exRes?.trafos?.length > 0) {
    for (const t of exRes.trafos) {
      const z = exRes.assignMap.get(t.id);
      if (!z || z.pts.length === 0) continue;
      const edges = _computeMST(t, z.pts);
      let zoneM = 0;
      for (const e of edges) {
        zoneM += e.lengthM;
        const rootPt   = { lat: t.lat, lng: t.lng };
        const fromIsRoot = _distM(e.from, rootPt) < 10;
        const poly = L.polyline([[e.from.lat, e.from.lng], [e.to.lat, e.to.lng]], {
          color: '#4fc3f7', weight: 2.5, opacity: 0.85,
        }).bindTooltip(`${t.name} · ${e.lengthM.toFixed(0)} m`, { sticky: true })
          .addTo(grpKabeltrassen);
        NA.naKabelEdges.push({ edge: e, poly, zoneName: t.name, col: '#4fc3f7',
          routed: false, selected: false, rootPt, isExistingTrafo: true,
          trafoAssetId: t.id, fromIsRoot });
      }
      NA.naKabelInfo.totalM += zoneM;
      NA.naKabelInfo.zones.push({ name: t.name, lengthM: zoneM, isExisting: true });
    }
  }

  const clusters = NA.naResult;
  if (clusters?.length > 0) {
    clusters.forEach((cl, i) => {
      if (!cl.points?.length) return;
      const col   = NA_CLUSTER_COLORS[i % NA_CLUSTER_COLORS.length];
      const edges = _computeMST(cl.centroid, cl.points);
      let zoneM   = 0;
      for (const e of edges) {
        zoneM += e.lengthM;
        const rootPt     = cl.centroid;
        const fromIsRoot = _distM(e.from, rootPt) < 10;
        const poly = L.polyline([[e.from.lat, e.from.lng], [e.to.lat, e.to.lng]], {
          color: col, weight: 2.5, opacity: 0.85, dashArray: cl.isWhale ? '6 4' : null,
        }).bindTooltip(`Zone ${i + 1} · ${e.lengthM.toFixed(0)} m`, { sticky: true })
          .addTo(grpKabeltrassen);
        NA.naKabelEdges.push({ edge: e, poly, zoneName: `Zone ${i + 1}`, col,
          routed: false, selected: false, rootPt, isExistingTrafo: false,
          trafoAssetId: null, fromIsRoot });
      }
      NA.naKabelInfo.totalM += zoneM;
      NA.naKabelInfo.zones.push({ name: `Zone ${i + 1}`, lengthM: zoneM, isExisting: false });
    });
  }

  // Erzeugungsnetz-Kabeltrassen
  const erzClusters = NA.naErzeugResult;
  if (erzClusters?.length > 0) {
    erzClusters.forEach((cl, i) => {
      if (!cl.points?.length) return;
      const col   = NA_ERZEUG_COLORS[i % NA_ERZEUG_COLORS.length];
      const edges = _computeMST(cl.centroid, cl.points);
      let zoneM   = 0;
      for (const e of edges) {
        zoneM += e.lengthM;
        const rootPt     = cl.centroid;
        const fromIsRoot = _distM(e.from, rootPt) < 10;
        const poly = L.polyline([[e.from.lat, e.from.lng], [e.to.lat, e.to.lng]], {
          color: col, weight: 2.5, opacity: 0.85, dashArray: '4 3',
        }).bindTooltip(`EZ ${i + 1} · ${e.lengthM.toFixed(0)} m`, { sticky: true })
          .addTo(grpKabeltrassen);
        NA.naKabelEdges.push({ edge: e, poly, zoneName: `EZ ${i + 1}`, col,
          routed: false, selected: false, rootPt, isExistingTrafo: false,
          trafoAssetId: null, fromIsRoot, isErzeugung: true });
      }
      NA.naKabelInfo.totalM += zoneM;
      NA.naKabelInfo.zones.push({ name: `EZ ${i + 1}`, lengthM: zoneM, isErzeugung: true });
    });
  }

  for (const ke of NA.naKabelEdges) {
    ke.poly.on('click', () => { ke.selected = !ke.selected; _naKabelUpdateStyle(ke); naRenderPanel(); });
  }
  if (NA.naKabelInfo.totalM > 0 && !map.hasLayer(grpKabeltrassen))
    grpKabeltrassen.addTo(map);
}

export function naKabelToggle(on) {
  NA.kabelActive = !!on;
  if (!on && grpKabeltrassen) grpKabeltrassen.clearLayers();
  naDrawKabeltrassen();
  naRenderPanel();
}

export function naKabelSelectAll()  {
  (NA.naKabelEdges || []).forEach(k => { k.selected = true;  _naKabelUpdateStyle(k); });
  naRenderPanel();
}
export function naKabelSelectNone() {
  (NA.naKabelEdges || []).forEach(k => { k.selected = false; _naKabelUpdateStyle(k); });
  naRenderPanel();
}

export function naImportSelectedKabel() {
  const selected = (NA.naKabelEdges || []).filter(ke => ke.selected);
  if (!selected.length) { alert('Keine Kanten ausgewählt. Kanten auf der Karte anklicken.'); return; }

  const { createAsset } = window; // aus 13a-assets-core via window
  if (!createAsset) { alert('createAsset nicht verfügbar'); return; }

  const zones = new Map();
  for (const ke of selected) {
    if (!zones.has(ke.zoneName))
      zones.set(ke.zoneName, { rootPt: ke.rootPt, isExistingTrafo: ke.isExistingTrafo,
        trafoAssetId: ke.trafoAssetId, edges: [] });
    zones.get(ke.zoneName).edges.push(ke);
  }

  let importedEdges = 0, importedAssets = 0;

  for (const [, zone] of zones) {
    const { rootPt, isExistingTrafo, trafoAssetId } = zone;
    let trafoId;
    if (isExistingTrafo && trafoAssetId) {
      trafoId = trafoAssetId;
    } else {
      const trafo = createAsset('Trafo', rootPt.lat, rootPt.lng, {});
      if (!trafo) continue;
      trafoId = trafo.id;
      importedAssets++;
    }

    const OFFSET_M = 12;
    let sumLat = 0, sumLng = 0, n = 0;
    for (const ke of zone.edges) {
      const pt = ke.fromIsRoot ? ke.edge.to : ke.edge.from;
      sumLat += pt.lat; sumLng += pt.lng; n++;
    }
    let nshvLat, nshvLng;
    if (n > 0) {
      const dLat = sumLat / n - rootPt.lat, dLng = sumLng / n - rootPt.lng;
      const lenDeg = Math.sqrt(dLat * dLat + dLng * dLng);
      const offDeg = OFFSET_M / 111320;
      nshvLat = rootPt.lat + (lenDeg > 0 ? dLat / lenDeg : 1) * offDeg;
      nshvLng = rootPt.lng + (lenDeg > 0 ? dLng / lenDeg : 0) * offDeg;
    } else {
      nshvLat = rootPt.lat + OFFSET_M / 111320; nshvLng = rootPt.lng;
    }

    const nshv = createAsset('NSHV', nshvLat, nshvLng, {});
    if (!nshv) continue;
    importedAssets++;

    // Kanten via addStromEdge (falls verfügbar)
    const addEdge = window.addStromEdge;
    if (!addEdge) continue;

    // Trafo → NSHV
    addEdge({ u: trafoId, v: nshv.id, crossSection: 50,
      route: [[rootPt.lat, rootPt.lng], [nshvLat, nshvLng]] });
    importedEdges++;

    for (const ke of zone.edges) {
      const coords = ke.edge.routedCoords ||
        [[ke.edge.from.lat, ke.edge.from.lng], [ke.edge.to.lat, ke.edge.to.lng]];
      const _nearest = (pt) => {
        let best = null, bestD = Infinity;
        for (const a of ASSETS.items) {
          if (getAssetStatus(a, globalYear) !== 'active') continue;
          const d = _distM(pt, a);
          if (d < bestD) { bestD = d; best = a.id; }
        }
        return bestD < 200 ? best : null;
      };
      let aId, bId, route;
      if (ke.fromIsRoot) {
        aId   = nshv.id;
        bId   = _nearest(ke.edge.to);
        route = [[nshvLat, nshvLng], ...coords.slice(1)];
      } else {
        aId   = _nearest(ke.edge.from);
        bId   = _nearest(ke.edge.to);
        route = coords;
      }
      if (!aId || !bId || aId === bId) continue;
      addEdge({ u: aId, v: bId, crossSection: 50, route });
      importedEdges++;
    }
  }

  alert(`Import: ${importedEdges} Kabel${importedEdges !== 1 ? ' Kanten' : ''}` +
    (importedAssets > 0 ? ` + ${importedAssets} Assets (Trafo/NSHV)` : '') +
    ' ins Modell übernommen.');
  for (const ke of selected) { ke.selected = false; _naKabelUpdateStyle(ke); }
  naRenderPanel();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
}

// ── Voronoi ──────────────────────────────────────────────────────────────────
function _voronoiBBox(pts, padFactor = 0.5, minPad = 0.005) {
  if (!pts.length) return { minLat: -1, maxLat: 1, minLng: -1, maxLng: 1 };
  let minLat = pts[0].lat, maxLat = pts[0].lat;
  let minLng = pts[0].lng, maxLng = pts[0].lng;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
  }
  const pLat = Math.max((maxLat - minLat) * padFactor, minPad);
  const pLng = Math.max((maxLng - minLng) * padFactor, minPad);
  return { minLat: minLat - pLat, maxLat: maxLat + pLat,
           minLng: minLng - pLng, maxLng: maxLng + pLng };
}

function _voronoiClip(poly, a, b) {
  const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2;
  const nx = b.lat - a.lat, ny = b.lng - a.lng;
  const inside   = p => (p.lat - mx) * nx + (p.lng - my) * ny <= 0;
  const intersect = (p1, p2) => {
    const d1 = (p1.lat - mx) * nx + (p1.lng - my) * ny;
    const d2 = (p2.lat - mx) * nx + (p2.lng - my) * ny;
    const t  = d1 / (d1 - d2);
    return { lat: p1.lat + t * (p2.lat - p1.lat), lng: p1.lng + t * (p2.lng - p1.lng) };
  };
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const curr = poly[k], next = poly[(k + 1) % poly.length];
    const ci = inside(curr), ni = inside(next);
    if (ci) out.push(curr);
    if (ci !== ni) out.push(intersect(curr, next));
  }
  return out;
}

function _computeVoronoi(seeds, bbox) {
  const bboxPoly = [
    { lat: bbox.minLat, lng: bbox.minLng }, { lat: bbox.minLat, lng: bbox.maxLng },
    { lat: bbox.maxLat, lng: bbox.maxLng }, { lat: bbox.maxLat, lng: bbox.minLng },
  ];
  return seeds.map((seed, i) => {
    let poly = [...bboxPoly];
    for (let j = 0; j < seeds.length; j++) {
      if (i === j || poly.length < 3) continue;
      poly = _voronoiClip(poly, seed, seeds[j]);
    }
    return { seed, polygon: poly };
  });
}

// ── Geometrischer Median (Weiszfeld) ─────────────────────────────────────────
// k-Means-Schwerpunkte minimieren die Summe der QUADRIERTEN Abstände — das
// entspricht nicht der tatsächlichen Zielgröße (kurze Kabeltrassen ≈ Summe der
// Abstände). Der geometrische Median minimiert die Summe der gewichteten
// Abstände direkt und liefert damit i. d. R. einen kabelgünstigeren Standort
// als der arithmetische Schwerpunkt — bei gleicher Cluster-Zuordnung.
function _geometricMedian(points, initial, maxIter = 60, tol = 1e-9) {
  if (!points || points.length === 0) return initial;
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng };
  let x = { lat: initial.lat, lng: initial.lng };
  for (let iter = 0; iter < maxIter; iter++) {
    let sumW = 0, sumLat = 0, sumLng = 0, hit = null;
    for (const p of points) {
      const dlat = x.lat - p.lat, dlng = x.lng - p.lng;
      const d = Math.sqrt(dlat * dlat + dlng * dlng);
      if (d < 1e-12) { hit = p; break; }
      const w = (p.weight || 1) / d;
      sumW += w; sumLat += p.lat * w; sumLng += p.lng * w;
    }
    if (hit) return { lat: hit.lat, lng: hit.lng };
    if (sumW === 0) break;
    const next = { lat: sumLat / sumW, lng: sumLng / sumW };
    const shift = Math.hypot(next.lat - x.lat, next.lng - x.lng);
    x = next;
    if (shift < tol) break;
  }
  return x;
}

// Verschiebt die Cluster-Standorte vom Schwerpunkt zum geometrischen Median —
// reine Nachbearbeitung der Position, ändert NICHT die Punktzuordnung/Lasten.
function _refineCentroids(clusters) {
  for (const cl of clusters) {
    if (cl.points && cl.points.length > 1) cl.centroid = _geometricMedian(cl.points, cl.centroid);
  }
  return clusters;
}

// Gesamtlänge des minimalen Spannbaums über alle Cluster (für Kosten-Vergleich)
function _totalMstM(clusters) {
  let total = 0;
  for (const cl of clusters) {
    if (!cl.points?.length) continue;
    for (const e of _computeMST(cl.centroid, cl.points)) total += e.lengthM;
  }
  return total;
}

// ── k-Means (k-Means++ Init, gewichtet) ─────────────────────────────────────
function _kMeansCluster(points, k, maxIter = 150, runs = 1, gzf = 1.0) {
  if (points.length === 0) return [];
  k = Math.min(k, points.length);
  function sqDist(a, b) {
    const dlat = a.lat - b.lat, dlng = a.lng - b.lng;
    return dlat * dlat + dlng * dlng;
  }
  function singleRun(useRandom) {
    const centroids = [];
    if (!useRandom) {
      const totalW = points.reduce((s, p) => s + p.weight, 0) || 1;
      centroids.push({
        lat: points.reduce((s, p) => s + p.lat * p.weight, 0) / totalW,
        lng: points.reduce((s, p) => s + p.lng * p.weight, 0) / totalW,
      });
      while (centroids.length < k) {
        let best = null, bestD = -1;
        for (const p of points) {
          const minD = Math.min(...centroids.map(c => sqDist(p, c)));
          if (minD > bestD) { bestD = minD; best = p; }
        }
        centroids.push({ lat: best.lat, lng: best.lng });
      }
    } else {
      const first = points[Math.floor(Math.random() * points.length)];
      centroids.push({ lat: first.lat, lng: first.lng });
      while (centroids.length < k) {
        const dists = points.map(p => Math.min(...centroids.map(c => sqDist(p, c))));
        const total = dists.reduce((s, d) => s + d, 0) || 1;
        let r = Math.random() * total, idx = 0;
        for (; idx < dists.length - 1; idx++) { r -= dists[idx]; if (r <= 0) break; }
        centroids.push({ lat: points[idx].lat, lng: points[idx].lng });
      }
    }
    for (let iter = 0; iter < maxIter; iter++) {
      const buckets = Array.from({ length: k }, () => []);
      for (const p of points) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < k; i++) {
          const d = sqDist(p, centroids[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
        buckets[best].push(p);
      }
      let changed = false;
      for (let i = 0; i < k; i++) {
        const pts = buckets[i];
        if (pts.length === 0) continue;
        const sw = pts.reduce((s, p) => s + p.weight, 0) || 1;
        const newLat = pts.reduce((s, p) => s + p.lat * p.weight, 0) / sw;
        const newLng = pts.reduce((s, p) => s + p.lng * p.weight, 0) / sw;
        if (Math.abs(newLat - centroids[i].lat) > 1e-10 || Math.abs(newLng - centroids[i].lng) > 1e-10)
          changed = true;
        centroids[i] = { lat: newLat, lng: newLng };
      }
      if (!changed) break;
    }
    const clusters = Array.from({ length: k }, (_, i) => ({
      centroid: centroids[i], points: [],
      totalKW: 0, bezugKW: 0, einspeisungKW: 0, peakKW: 0, nettoKW: 0,
    }));
    for (const p of points) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < k; i++) {
        const d = sqDist(p, centroids[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      clusters[best].points.push(p);
      clusters[best].bezugKW       += p.loadKW || 0;
      clusters[best].einspeisungKW += p.genKW  || 0;
    }
    for (const cl of clusters) {
      cl.totalKW    = cl.bezugKW;
      cl.peakKW_raw = Math.max(cl.bezugKW, cl.einspeisungKW);
      cl.peakKW     = cl.peakKW_raw * gzf;
      cl.nettoKW    = cl.bezugKW - cl.einspeisungKW;
    }
    return clusters;
  }
  let best = null, bestMaxLoad = Infinity;
  for (let r = 0; r < runs; r++) {
    const cls = singleRun(r > 0);
    const filled = cls.filter(cl => cl.points.length > 0);
    const maxLoad = filled.length > 0 ? Math.max(...filled.map(cl => cl.peakKW)) : 0;
    if (maxLoad < bestMaxLoad) { bestMaxLoad = maxLoad; best = cls; }
  }
  best.sort((a, b) => b.peakKW - a.peakKW);
  return best;
}

function _kvaEmpfStr(peakKW, cosP) {
  const s = peakKW / (cosP || NA.cosPhi || 0.9);
  if (s <= 250)  return '250 kVA';
  if (s <= 400)  return '400 kVA';
  if (s <= 630)  return '630 kVA';
  if (s <= 1000) return '1000 kVA';
  return `${Math.ceil(s / 1000)}× 1000 kVA`;
}

function _mergeUnderloaded(clusters, maxKW, minUtilFrac, gzf) {
  let result = clusters.filter(cl => cl.points.length > 0);
  if (minUtilFrac <= 0) return result;
  let changed = true;
  while (changed) {
    changed = false;
    result.sort((a, b) => a.peakKW - b.peakKW);
    for (let i = 0; i < result.length; i++) {
      if (result[i].peakKW / maxKW >= minUtilFrac) break;
      let bestJ = -1, bestDist = Infinity;
      for (let j = i + 1; j < result.length; j++) {
        const mergedRaw = (result[i].peakKW_raw || result[i].peakKW) +
                          (result[j].peakKW_raw || result[j].peakKW);
        if (mergedRaw * gzf <= maxKW) {
          const dlat = result[i].centroid.lat - result[j].centroid.lat;
          const dlng = result[i].centroid.lng - result[j].centroid.lng;
          if (dlat * dlat + dlng * dlng < bestDist) { bestDist = dlat * dlat + dlng * dlng; bestJ = j; }
        }
      }
      if (bestJ < 0) continue;
      const a = result[i], b = result[bestJ];
      const mergedPts = [...a.points, ...b.points];
      const totalW    = mergedPts.reduce((s, p) => s + (p.peakKW || 1), 0) || 1;
      const merged = {
        points:        mergedPts,
        bezugKW:       a.bezugKW + b.bezugKW,
        einspeisungKW: a.einspeisungKW + b.einspeisungKW,
        peakKW_raw:    (a.peakKW_raw || a.peakKW) + (b.peakKW_raw || b.peakKW),
        centroid: {
          lat: mergedPts.reduce((s, p) => s + p.lat * (p.peakKW || 1), 0) / totalW,
          lng: mergedPts.reduce((s, p) => s + p.lng * (p.peakKW || 1), 0) / totalW,
        },
      };
      merged.peakKW  = merged.peakKW_raw * gzf;
      merged.nettoKW = merged.bezugKW - merged.einspeisungKW;
      merged.totalKW = merged.bezugKW;
      result[bestJ] = merged;
      result.splice(i, 1);
      changed = true;
      break;
    }
  }
  return result;
}

function _findAutoK(allPts, maxKVA, cosPhi, gzf = 1.0, minUtilPct = 0) {
  const maxKW   = maxKVA * cosPhi;
  const whales  = allPts.filter(p => p.peakKW > maxKW);
  const normals = allPts.filter(p => p.peakKW <= maxKW);
  const whaleClusters = whales.map(p => ({
    centroid: { lat: p.lat, lng: p.lng }, points: [p],
    bezugKW: p.loadKW, einspeisungKW: p.genKW,
    peakKW_raw: p.peakKW, peakKW: p.peakKW * gzf, nettoKW: p.netKW,
    totalKW: p.loadKW, isWhale: true,
  }));
  if (normals.length === 0) {
    const merged = _mergeUnderloaded(whaleClusters, maxKW, minUtilPct / 100, gzf);
    return { clusters: merged, k: merged.length, maxKW, whaleCount: whales.length, normalK: 0 };
  }
  const RUNS = 5, maxK = Math.min(normals.length, 20);
  for (let k = 1; k <= maxK; k++) {
    const cls      = _kMeansCluster(normals, k, 150, RUNS, gzf);
    const nonEmpty = cls.filter(cl => cl.points.length > 0);
    if (nonEmpty.every(cl => cl.peakKW <= maxKW)) {
      const merged = _mergeUnderloaded([...whaleClusters, ...nonEmpty], maxKW, minUtilPct / 100, gzf);
      return { clusters: merged, k: merged.length, maxKW,
               whaleCount: whales.length, normalK: merged.length - whaleClusters.length };
    }
  }
  const cls      = _kMeansCluster(normals, maxK, 150, RUNS, gzf);
  const nonEmpty = cls.filter(cl => cl.points.length > 0);
  const merged   = _mergeUnderloaded([...whaleClusters, ...nonEmpty], maxKW, minUtilPct / 100, gzf);
  return { clusters: merged, k: merged.length, maxKW,
           whaleCount: whales.length, normalK: merged.length - whaleClusters.length,
           capacityExceeded: true };
}

function _groupByProximity(points, radiusM) {
  if (!radiusM || radiusM <= 0) return points;
  function distM(a, b) {
    const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const sL = Math.sin(dLat / 2), sg = Math.sin(dLng / 2);
    const x = sL * sL + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sg * sg;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  const used = new Array(points.length).fill(false);
  const result = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const group = [points[i]];
    for (let j = i + 1; j < points.length; j++) {
      if (!used[j] && distM(points[i], points[j]) <= radiusM) { group.push(points[j]); used[j] = true; }
    }
    used[i] = true;
    if (group.length === 1) { result.push(group[0]); continue; }
    const totalW = group.reduce((s, p) => s + (p.peakKW || 1), 0) || 1;
    const loadKW = group.reduce((s, p) => s + (p.loadKW || 0), 0);
    const genKW  = group.reduce((s, p) => s + (p.genKW  || 0), 0);
    result.push({
      lat: group.reduce((s, p) => s + p.lat * (p.peakKW || 1), 0) / totalW,
      lng: group.reduce((s, p) => s + p.lng * (p.peakKW || 1), 0) / totalW,
      loadKW, genKW, peakKW: Math.max(loadKW, genKW),
      netKW: loadKW - genKW, weight: Math.max(loadKW, genKW),
      name: `NSHV-Gruppe (${group.length} Pkt.)`, id: group[0].id, type: group[0].type,
    });
  }
  return result;
}

// ── Bestehende Trafos ────────────────────────────────────────────────────────
function _naGetExistingTrafos(year) {
  const yr  = year || globalYear || new Date().getFullYear();
  const cos = NA.cosPhi || 0.9;
  return ASSETS.items.filter(a =>
    a.type === 'Trafo' && getAssetStatus(a, yr) === 'active' && a.lat != null
  ).map(a => {
    const kVA = parseFloat(a.props?.leistungKVA) || 630;
    return { id: a.id, name: a.name, lat: a.lat, lng: a.lng, kVA, maxKW: kVA * cos };
  });
}

function _naAssignPts(pts, trafos) {
  function sqDist(a, b) { const dl = a.lat - b.lat, dg = a.lng - b.lng; return dl*dl + dg*dg; }
  const zmap = new Map(trafos.map(t => [t.id, {
    trafo: t, pts: [], bezugKW: 0, einspeisungKW: 0, peakKW: 0, nettoKW: 0, auslPct: 0, freeKW: 0,
  }]));
  for (const p of pts) {
    let nearest = null, nearestD = Infinity;
    for (const t of trafos) { const d = sqDist(p, t); if (d < nearestD) { nearestD = d; nearest = t; } }
    if (nearest) {
      const z = zmap.get(nearest.id);
      z.pts.push(p); z.bezugKW += p.loadKW || 0; z.einspeisungKW += p.genKW || 0;
    }
  }
  for (const [, z] of zmap) {
    z.peakKW  = Math.max(z.bezugKW, z.einspeisungKW);
    z.nettoKW = z.bezugKW - z.einspeisungKW;
    z.auslPct = z.trafo.maxKW > 0 ? Math.round(z.peakKW / z.trafo.maxKW * 100) : 0;
    z.freeKW  = Math.max(0, z.trafo.maxKW - z.peakKW);
  }
  return zmap;
}

function _naFindExhaustionYears(trafos) {
  const startYear   = globalYear || new Date().getFullYear();
  const basePts     = naGetLoadPoints(startYear);
  const baseAssign  = _naAssignPts(basePts, trafos);
  const trafoIdSets = new Map();
  for (const [tid, z] of baseAssign) trafoIdSets.set(tid, new Set(z.pts.map(p => p.id)));
  const results = new Map(trafos.map(t => [t.id, { exhaustionYear: null, maxAuslYear: startYear, maxAusl: 0 }]));
  for (let yr = startYear; yr <= 2050; yr++) {
    const pts = naGetLoadPoints(yr);
    for (const [tid, idSet] of trafoIdSets) {
      const trafo    = trafos.find(t => t.id === tid);
      if (!trafo) continue;
      const zonePts  = pts.filter(p => idSet.has(p.id));
      const peak     = Math.max(zonePts.reduce((s, p) => s + (p.loadKW || 0), 0),
                                zonePts.reduce((s, p) => s + (p.genKW  || 0), 0));
      const ausl     = trafo.maxKW > 0 ? Math.round(peak / trafo.maxKW * 100) : 0;
      const r        = results.get(tid);
      if (ausl > r.maxAusl) { r.maxAusl = ausl; r.maxAuslYear = yr; }
      if (r.exhaustionYear === null && peak > trafo.maxKW) r.exhaustionYear = yr;
    }
  }
  return results;
}

function _naDrawExistingTrafos(trafos, assignMap, exhaustionMap) {
  _ensureGroups();
  grpExistingTrafos.clearLayers();
  if (trafos.length === 0) return;
  const allPts = naGetLoadPoints();
  const bbox   = _voronoiBBox([...trafos, ...allPts]);
  const cells  = _computeVoronoi(trafos, bbox);
  for (let i = 0; i < trafos.length; i++) {
    const t = trafos[i], z = assignMap.get(t.id), exh = exhaustionMap?.get(t.id), cell = cells[i];
    if (!z || !cell || cell.polygon.length < 3) continue;
    const auslCol  = z.auslPct > 100 ? '#ef5350' : z.auslPct > 80 ? '#ffa726' : '#66bb6a';
    const exhLabel = exh?.exhaustionYear
      ? `⚠ Erschöpft: ${exh.exhaustionYear}` : exh ? 'Reserve bis 2050' : '';
    L.polygon(cell.polygon.map(p => [p.lat, p.lng]), {
      color: auslCol, fillColor: auslCol, fillOpacity: 0.07, opacity: 0.75, weight: 2, dashArray: '5 6',
    }).bindTooltip(`${t.name}: ${z.auslPct}% Auslastung`, { sticky: true })
      .addTo(grpExistingTrafos);
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:#1a237e;border:2.5px solid ${auslCol};border-radius:4px;
               width:28px;height:28px;display:flex;flex-direction:column;align-items:center;
               justify-content:center;font-weight:700;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.6);">
               <span style="font-size:10px;line-height:1.1;">T</span>
               <span style="font-size:7px;line-height:1;color:${auslCol};">${z.auslPct}%</span></div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    L.marker([t.lat, t.lng], { icon, zIndexOffset: 700 })
      .bindPopup(`<b>🔁 ${t.name}</b> (Bestand)<br>` +
        `Nennleistung: <b>${t.kVA} kVA</b> = max. ${t.maxKW.toFixed(0)} kW<br>` +
        `Bezug: ${z.bezugKW.toFixed(0)} kW | Einsp.: ${z.einspeisungKW.toFixed(0)} kW<br>` +
        `Auslastung: <b style="color:${auslCol}">${z.auslPct}%</b> Reserve: ${z.freeKW.toFixed(0)} kW<br>` +
        `Versorgte Punkte: ${z.pts.length}` + (exhLabel ? `<br><span style="color:#ef5350">${exhLabel}</span>` : ''))
      .addTo(grpExistingTrafos);
  }
  if (!map.hasLayer(grpExistingTrafos)) grpExistingTrafos.addTo(map);
}

// ── Öffentliche Trafo-Optimierung API ────────────────────────────────────────
export function naSetMode(m) { NA.mode = m; naRenderPanel(); }
export function naSetK(v)    { NA.k = Math.max(1, Math.min(20, parseInt(v) || 1)); }
export function naSetMaxKVA(v)       { NA.maxKVA     = parseInt(v) || 630; }
export function naSetCosPhi(v)       { NA.cosPhi     = parseFloat(v) || 0.9; }
export function naSetGzf(v)          { NA.gzf        = parseFloat(v) ?? 0.7; naRenderPanel(); }
export function naSetMinUtil(v)      { NA.minUtilPct = parseInt(v) || 0; }
export function naSetProxRadius(v)   { NA.proxRadius = parseInt(v) || 0; naRenderPanel(); }
export function naSetUseExisting(v)  { NA.useExisting = !!v; naRenderPanel(); }
export function naSetTab(tab)        { NA.activeTab = ['trafo','ms','bat','nsa'].includes(tab) ? tab : 'last'; naRenderPanel(); }
export function naApplyKCompare(k)   { NA.mode = 'manual'; NA.k = k; naRunTrafoOptimierung(); }
export function naSetKabelEurM(v)    { NA.naKabelEurM = parseFloat(v) || 200; naRenderPanel(); }
export function naSetErzeugungsnetz(v) { NA.erzeugungsnetz = !!v; naRenderPanel(); }

// ── Erzeugungscluster zeichnen ───────────────────────────────────────────────
function _drawErzeugungClusters(clusters, maxKW) {
  _ensureGroups();
  grpErzeugungKMeans.clearLayers();
  if (!clusters || clusters.length === 0) return;
  const centroids = clusters.map(cl => ({ lat: cl.centroid.lat, lng: cl.centroid.lng }));
  const allPtsForBbox = [...clusters.flatMap(cl => cl.points), ...centroids];
  const vBbox  = _voronoiBBox(allPtsForBbox.length > 0 ? allPtsForBbox : centroids);
  const vCells = _computeVoronoi(centroids, vBbox);
  if (!map.hasLayer(grpErzeugungKMeans)) grpErzeugungKMeans.addTo(map);
  clusters.forEach((cl, i) => {
    const col     = NA_ERZEUG_COLORS[i % NA_ERZEUG_COLORS.length];
    const kvaEmpf = _kvaEmpfStr(cl.einspeisungKW, NA.cosPhi);
    const vCell   = vCells[i];
    if (vCell && vCell.polygon.length >= 3) {
      L.polygon(vCell.polygon.map(p => [p.lat, p.lng]), {
        color: col, fillColor: col, fillOpacity: 0.08, opacity: 0.6,
        weight: 2, dashArray: '3 5',
      }).bindTooltip(`EZ ${i+1}: ${cl.einspeisungKW.toFixed(0)} kW Einsp. · ${cl.points.length} Pkt.`, { sticky: true })
        .addTo(grpErzeugungKMeans);
    }
    L.marker([cl.centroid.lat, cl.centroid.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:${col};border:2px solid #fff;border-radius:50%;
                 width:24px;height:24px;display:flex;align-items:center;justify-content:center;
                 font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);">
                 E</div>`,
        iconSize: [24, 24], iconAnchor: [12, 12],
      }),
      zIndexOffset: 510,
    }).bindPopup(
      `<b>☀ Einspeise-Trafo ${i+1}</b><br>` +
      `Einspeisung: <b>${cl.einspeisungKW.toFixed(0)} kW</b><br>` +
      `Bezug: <b>${cl.bezugKW.toFixed(0)} kW</b><br>` +
      `Netto: <b>${(cl.einspeisungKW - cl.bezugKW).toFixed(0)} kW</b><br>` +
      `Empf. Trafo: <b>${kvaEmpf}</b><br>Punkte: ${cl.points.length}`
    ).addTo(grpErzeugungKMeans);
  });
}

// ── Empfohlene kVA für einen Cluster ─────────────────────────────────────────
function _empfKVA(peakKW, cosPhi) {
  const s = peakKW / (cosPhi || 0.9);
  if (s <= 250)  return 250;
  if (s <= 400)  return 400;
  if (s <= 630)  return 630;
  if (s <= 1000) return 1000;
  if (s <= 1600) return 1600;
  return 2500;
}

export function naRunTrafoOptimierung() {
  _ensureGroups();
  const allPts = naGetLoadPoints();
  if (allPts.length === 0) {
    alert('Keine aktiven Lastpunkte gefunden.\nBitte zuerst Verbraucher, Ladepunkte, Wärmepumpen oder Erzeuger anlegen.');
    return;
  }
  const yr         = globalYear || new Date().getFullYear();
  const existingT  = NA.useExisting ? _naGetExistingTrafos() : [];
  let assignMap = null, exhaustionMap = null;
  if (existingT.length > 0) {
    assignMap     = _naAssignPts(allPts, existingT);
    exhaustionMap = _naFindExhaustionYears(existingT);
    _naDrawExistingTrafos(existingT, assignMap, exhaustionMap);
    NA.naExistingResults = { trafos: existingT, assignMap, exhaustionMap };
  } else {
    grpExistingTrafos.clearLayers();
    NA.naExistingResults = null;
  }
  let ptsForKmeans = allPts;
  if (existingT.length > 0 && assignMap) {
    const overloadedPts = new Set();
    for (const [, z] of assignMap) { if (z.auslPct > 100) z.pts.forEach(p => overloadedPts.add(p.id)); }
    ptsForKmeans = allPts.filter(p => overloadedPts.has(p.id));
  }
  if (ptsForKmeans.length === 0) {
    grpKMeans.clearLayers();
    NA.naResult   = [];
    NA.naMaxKW    = null;
    NA.naAutoInfo = { allServed: true, existingCount: existingT.length };
    naDrawKabeltrassen();
    naRenderPanel();
    return;
  }

  const weightedPts = ptsForKmeans.map(p => ({ ...p, weight: p.peakKW }));
  const groupedPts  = _groupByProximity(weightedPts, NA.proxRadius).map(p => ({
    ...p,
    peakKW: Math.max(p.loadKW || 0, p.genKW || 0),
    netKW:  (p.loadKW || 0) - (p.genKW || 0),
    weight: Math.max(p.loadKW || 0, p.genKW || 0),
  }));

  let clusters, maxKW = null, autoInfo = null;
  NA.naKCompare = null;
  if (NA.mode === 'auto') {
    const res = _findAutoK(groupedPts, NA.maxKVA, NA.cosPhi, NA.gzf, NA.minUtilPct);
    clusters = _refineCentroids(res.clusters); maxKW = res.maxKW; NA.k = res.k;
    autoInfo = { maxKVA: NA.maxKVA, cosPhi: NA.cosPhi, maxKW, gzf: NA.gzf,
                 minUtilPct: NA.minUtilPct,
                 whaleCount: res.whaleCount || 0, normalK: res.normalK || 0,
                 capacityExceeded: res.capacityExceeded || false, onlyOverflow: existingT.length > 0 };

    // Alternativen-Vergleich: benachbarte Stationszahlen gegenüberstellen
    // (Stationsanzahl minimiert ≠ Gesamtkosten minimiert — siehe _totalMstM).
    const maxKAllowed = Math.min(groupedPts.length, 20);
    const candK = [...new Set([res.k - 1, res.k, res.k + 1])].filter(k => k >= 1 && k <= maxKAllowed);
    if (candK.length > 1) {
      NA.naKCompare = candK.sort((a, b) => a - b).map(k => {
        const cls    = k === res.k ? clusters : _refineCentroids(_kMeansCluster(groupedPts, k, 150, 5));
        const filled = cls.filter(cl => cl.points.length > 0);
        const maxAusl = maxKW && filled.length ? Math.max(...filled.map(cl => cl.peakKW / maxKW * 100)) : null;
        const cableM  = _totalMstM(filled);
        return { k: filled.length, maxAuslPct: maxAusl != null ? Math.round(maxAusl) : null,
                 cableM, cableCost: Math.round(cableM * NA.naKabelEurM / 1000),
                 isChosen: k === res.k };
      });
    }
  } else {
    clusters = _refineCentroids(_kMeansCluster(groupedPts, NA.k || 3, 150, 5));
  }

  grpKMeans.clearLayers();
  NA.naResult  = clusters;
  NA.naMaxKW   = maxKW;
  NA.naAutoInfo = autoInfo;

  const centroids = clusters.map(cl => ({ lat: cl.centroid.lat, lng: cl.centroid.lng }));
  const allPtsForBbox = [...groupedPts, ...centroids];
  const vBbox  = _voronoiBBox(allPtsForBbox);
  const vCells = _computeVoronoi(centroids, vBbox);
  if (!map.hasLayer(grpKMeans)) grpKMeans.addTo(map);

  clusters.forEach((cl, i) => {
    const col      = NA_CLUSTER_COLORS[i % NA_CLUSTER_COLORS.length];
    const auslPct  = maxKW ? Math.round(cl.peakKW / maxKW * 100) : null;
    const kvaEmpf  = _kvaEmpfStr(cl.peakKW, NA.cosPhi);
    const overload = maxKW && cl.peakKW > maxKW;
    const vCell    = vCells[i];
    if (vCell && vCell.polygon.length >= 3) {
      const zoneCol = overload ? '#ef5350' : col;
      L.polygon(vCell.polygon.map(p => [p.lat, p.lng]), {
        color: zoneCol, fillColor: zoneCol, fillOpacity: 0.07, opacity: 0.55,
        weight: overload ? 3 : 2, dashArray: '7 4',
      }).bindTooltip(
        `Zone ${i+1}: ${cl.bezugKW.toFixed(0)} kW Bezug / ${cl.einspeisungKW.toFixed(0)} kW Einsp. · ${cl.points.length} Punkte`,
        { sticky: true }
      ).addTo(grpKMeans);
    }
    const isWhale  = !!cl.isWhale;
    const markerBg = isWhale ? '#ffa726' : (overload ? '#ef5350' : col);
    L.marker([cl.centroid.lat, cl.centroid.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:${markerBg};border:2px solid #fff;border-radius:50%;
                 width:24px;height:24px;display:flex;align-items:center;justify-content:center;
                 font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);">
                 ${isWhale ? 'D' : 'T'}</div>`,
        iconSize: [24, 24], iconAnchor: [12, 12],
      }),
      zIndexOffset: 500,
    }).bindPopup(
      `<b>${isWhale ? '⚡ Direktanschluss' : `Trafo-Standort ${i+1}`}</b><br>` +
      (isWhale ? '<span style="color:#ffa726">Einzellast überschreitet Kapazität</span><br>' : '') +
      `Bezug: <b>${cl.bezugKW.toFixed(0)} kW</b><br>Einspeisung: <b>${cl.einspeisungKW.toFixed(0)} kW</b><br>` +
      `Maßgebend: <b>${cl.peakKW.toFixed(0)} kW</b><br>` +
      (auslPct != null ? `Auslastung: <b style="color:${auslPct>100?'#ef5350':auslPct>80?'#ffa726':'#66bb6a'}">${auslPct}%</b><br>` : '') +
      `Empf. Trafo: <b>${kvaEmpf}</b><br>Punkte: ${cl.points.length}`
    ).addTo(grpKMeans);
  });

  // ── Erzeugungsnetz separat optimieren ────────────────────────────────────
  if (NA.erzeugungsnetz) {
    const erzPts = allPts.filter(p => p.genKW > 0);
    if (erzPts.length > 0) {
      const weightedErz = erzPts.map(p => ({ ...p, weight: p.genKW }));
      let erzClusters, erzMaxKW = null;
      if (NA.mode === 'auto') {
        const res = _findAutoK(weightedErz, NA.maxKVA, NA.cosPhi, NA.gzf, NA.minUtilPct);
        erzClusters = res.clusters;
        erzMaxKW = res.maxKW;
      } else {
        erzClusters = _kMeansCluster(weightedErz, NA.k || 3, 150, 5);
      }
      NA.naErzeugResult = _refineCentroids(erzClusters.filter(cl => cl.points.length > 0));
      NA.naErzeugMaxKW  = erzMaxKW;
      _drawErzeugungClusters(NA.naErzeugResult, erzMaxKW);
    } else {
      NA.naErzeugResult = [];
      NA.naErzeugMaxKW  = null;
      grpErzeugungKMeans.clearLayers();
    }
  } else {
    NA.naErzeugResult = null;
    NA.naErzeugMaxKW  = null;
    if (grpErzeugungKMeans) grpErzeugungKMeans.clearLayers();
  }

  naDrawKabeltrassen();
  naRenderPanel();
}

export function naClearTrafoOptimierung() {
  _ensureGroups();
  grpKMeans.clearLayers();
  grpExistingTrafos.clearLayers();
  grpKabeltrassen.clearLayers();
  grpErzeugungKMeans.clearLayers();
  NA.naResult          = null;
  NA.naAutoInfo        = null;
  NA.naMaxKW           = null;
  NA.naExistingResults = null;
  NA.naKabelInfo       = null;
  NA.naErzeugResult    = null;
  NA.naErzeugMaxKW     = null;
  naRenderPanel();
}

// ── Kompaktstation übernehmen ────────────────────────────────────────────────
export function naUebernehmenAlsKompaktstation() {
  const createAsset = window.createAsset;
  const addEdge     = window.addStromEdge;
  if (!createAsset || !addEdge) { alert('createAsset / addStromEdge nicht verfügbar'); return; }

  const verbrauchsClusters = (NA.naResult || []).map(cl => ({ ...cl, kind: 'verbrauch' }));
  const erzClusters        = (NA.naErzeugResult || []).map(cl => ({ ...cl, kind: 'erzeugung' }));
  const allClusters        = [...verbrauchsClusters, ...erzClusters];

  if (allClusters.length === 0) {
    alert('Keine Optimierungsergebnisse vorhanden.\nBitte zuerst die Optimierung berechnen.');
    return;
  }

  const vText  = verbrauchsClusters.length > 0 ? `${verbrauchsClusters.length} Verbrauchstrafo${verbrauchsClusters.length !== 1 ? 's' : ''}` : '';
  const eText  = erzClusters.length > 0        ? `${erzClusters.length} Einspeise-Trafo${erzClusters.length !== 1 ? 's' : ''}` : '';
  const sumTxt = [vText, eText].filter(Boolean).join(' + ');
  const ok = confirm(
    `${allClusters.length} Kompaktstation${allClusters.length !== 1 ? 'en' : ''} erstellen (${sumTxt})?\n\n` +
    'Jede Kompaktstation besteht aus:\n' +
    '  • Gebäude (Stationsgebäude)\n' +
    '  • Schaltanlage (MS-Seite)\n' +
    '  • Trafo\n' +
    '  • NSHV (NS-Verteiler)\n\n' +
    'Die Komponenten werden leicht versetzt im Stationsgebäude platziert und intern verbunden.'
  );
  if (!ok) return;

  const DEG_PER_M = 1 / 111320;
  const WIDTH_M = 3.5, HEIGHT_M = 9.0;
  let created = 0, failed = 0;
  let gebIdx = (window.gebaeude || []).filter(g => g.fromKompakt).length;

  // Rechteck-Grundriss + intern verteilte Positionen (analog Kompaktstations-Dialog)
  function _rect(lat, lng) {
    const dLat = (HEIGHT_M / 2) * DEG_PER_M;
    const dLng = (WIDTH_M  / 2) * DEG_PER_M / Math.cos(lat * Math.PI / 180);
    return [
      L.latLng(lat + dLat, lng - dLng),
      L.latLng(lat + dLat, lng + dLng),
      L.latLng(lat - dLat, lng + dLng),
      L.latLng(lat - dLat, lng - dLng),
    ];
  }
  function _positions(lat, lng, count) {
    const span = HEIGHT_M * 0.65;
    const spacingM = count > 1 ? span / (count - 1) : 0;
    return Array.from({ length: count }, (_, i) => ({
      lat: lat + (i - (count - 1) / 2) * spacingM * DEG_PER_M,
      lng,
    }));
  }

  for (const cl of allClusters) {
    const cx = cl.centroid.lat, cy = cl.centroid.lng;
    const peakKW = cl.kind === 'erzeugung' ? cl.einspeisungKW : cl.peakKW;
    const kva    = _empfKVA(peakKW, NA.cosPhi);
    const isErz  = cl.kind === 'erzeugung';

    // Stationsgebäude erzeugen, in dem die Assets verortet werden
    gebIdx++;
    const g = addGebaeude({
      name: `Kompaktstation ${gebIdx}`,
      nutzung: '',
      coords: _rect(cx, cy),
      strom: '0', waerme: '0',
      skipAutoCreate: true,
    });
    g.fromKompakt = true;
    if (g.polygonLayer) {
      g.polygonLayer.setStyle({
        color: '#cf6679', fillColor: '#cf6679',
        weight: 2, opacity: 0.85, fillOpacity: 0.12,
      });
    }
    const bid = g.id;

    const [pSa, pTrafo, pNshv] = _positions(cx, cy, 3);

    // Schaltanlage (am Trafo-Standort, MS-seitig)
    const sa = createAsset('Schaltanlage', pSa.lat, pSa.lng, {
      buildingId: bid,
      props: { felder: '4', nennstromA: '630' },
    });
    if (!sa) { failed++; continue; }
    if (isErz) sa.name = `${sa.name} (Einsp.)`;

    // Trafo — netzart kennzeichnet Einspeise-Trafo
    const trafo = createAsset('Trafo', pTrafo.lat, pTrafo.lng, {
      buildingId: bid,
      props: {
        leistungKVA: String(kva),
        ukProzent:   '6',
        netzart:     isErz ? 'erzeugung' : 'verbrauch',
      },
    });
    if (!trafo) { failed++; continue; }
    if (isErz) trafo.name = `${trafo.name} (Einsp.)`;

    // NSHV — gleiche netzart wie Trafo
    const nshv = createAsset('NSHV', pNshv.lat, pNshv.lng, {
      buildingId: bid,
      props: {
        nennstromA: String(Math.round(kva * 1000 / (400 * Math.sqrt(3) * 0.9))),
        abgaenge:   '6',
        netzart:    isErz ? 'erzeugung' : 'verbrauch',
      },
    });
    if (!nshv) { failed++; continue; }
    if (isErz) nshv.name = `${nshv.name} (Einsp.)`;

    // SA → Trafo (MS-Kabel), Trafo → NSHV (NS-Kabel)
    addEdge(sa.id, trafo.id);
    addEdge(trafo.id, nshv.id);
    created++;
  }

  if (failed > 0) alert(`${created} erstellt, ${failed} fehlgeschlagen.`);
  else alert(`${created} Kompaktstation${created !== 1 ? 'en' : ''} (inkl. Stationsgebäude) erfolgreich erstellt.\n\nPositionen können per Drag & Drop angepasst werden.`);

  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();

  // Trafobereiche (Optimierungs-Vorschau) wieder ausblenden — Kompaktstationen
  // stehen nun als reale Objekte auf der Karte.
  _ensureGroups();
  if (map.hasLayer(grpKMeans))          map.removeLayer(grpKMeans);
  if (map.hasLayer(grpExistingTrafos))  map.removeLayer(grpExistingTrafos);
  if (map.hasLayer(grpErzeugungKMeans)) map.removeLayer(grpErzeugungKMeans);
}

// ══════════════════════════════════════════════════════════════════════════════
// SPEICHER- & NOTSTROM-PLATZIERUNG (Tabs 'bat' / 'nsa')
// Spiegelt das Trafo-Platzierungs-Paradigma: Lasten clustern → Einheiten an den
// Cluster-Schwerpunkten vorschlagen → "Übernehmen" legt echte Assets an.
//   • zentral  = 1 Einheit am Gesamt-Lastschwerpunkt (k=1)
//   • verteilt = k Einheiten an Cluster-Schwerpunkten
// Notstrom-Dimensionierung: Default aus der Resilienz-Analyse (window._pvResReco),
// umschaltbar auf die Karten-Spitzenlast.
// ══════════════════════════════════════════════════════════════════════════════

const COL_BAT = '#aed581', COL_NSA = '#ff7043';

// Lasten in k Zonen clustern (gewichtet nach Bezugsleistung); leere Cluster raus.
function _naClusterLoads(k) {
  const pts = naGetLoadPoints().filter(p => p.loadKW > 0);
  if (!pts.length) return null;
  const weighted = pts.map(p => ({ ...p, weight: p.loadKW }));
  const kk = Math.max(1, Math.min(k, pts.length));
  return _refineCentroids(_kMeansCluster(weighted, kk, 150, 5)).filter(cl => cl.points.length > 0);
}

// Marker + (bei mehreren) Voronoi-Zonen für die vorgeschlagenen Einheiten zeichnen.
function _naDrawPlacementUnits(grp, clusters, units, kind) {
  grp.clearLayers();
  const col  = kind === 'bat' ? COL_BAT : COL_NSA;
  const icon = kind === 'bat' ? '🔋' : '⚙';
  if (units.length > 1) {
    const centroids = units.map(u => ({ lat: u.lat, lng: u.lng }));
    const allPts = clusters.flatMap(c => c.points);
    const vCells = _computeVoronoi(centroids, _voronoiBBox([...allPts, ...centroids]));
    units.forEach((u, i) => {
      const vc = vCells[i];
      if (vc && vc.polygon.length >= 3)
        L.polygon(vc.polygon.map(p => [p.lat, p.lng]), {
          color: col, fillColor: col, fillOpacity: 0.06, opacity: 0.5, weight: 2, dashArray: '7 4',
        }).addTo(grp);
    });
  }
  units.forEach((u, i) => {
    L.marker([u.lat, u.lng], {
      icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<div style="background:${col};border:2px solid #fff;border-radius:50%;width:26px;height:26px;
               display:flex;align-items:center;justify-content:center;font-size:13px;
               box-shadow:0 2px 6px rgba(0,0,0,.45);">${icon}</div>` }),
      zIndexOffset: 600,
    }).bindPopup(kind === 'bat'
      ? (u.name !== undefined
          ? `<b>🔋 Speicher · ${u.name}</b><br>Knotenspitze: <b>${u.loadKW.toFixed(0)} kW</b>` +
            (u.auslastung > 0 ? ` (Auslastung ${(u.auslastung*100).toFixed(0)} %)` : '') + '<br>' +
            (u.overloadKW > 0 ? `<span style="color:#c62828">Überlast: <b>${u.overloadKW.toFixed(0)} kW</b></span><br>` : '') +
            `Leistung: <b>${u.kW} kW</b><br>Kapazität: <b>${u.kWh} kWh</b><br>` +
            `Bedarf volle Kappung: ${u.reqKWh} kWh ${u.gedeckt ? '✓ gedeckt' : '⚠ Dauer zu kurz'}`
          : `<b>🔋 Batteriespeicher ${i + 1}</b><br>Zonenlast: <b>${u.loadKW.toFixed(0)} kW</b><br>` +
            `Leistung: <b>${u.kW} kW</b><br>Kapazität: <b>${u.kWh} kWh</b><br>Punkte: ${u.pts}`)
      : `<b>⚙ Notstromaggregat ${i + 1}</b><br>Zonenlast: <b>${u.loadKW.toFixed(0)} kW</b><br>` +
        `Leistung: <b>${u.kW} kW</b><br>Autonomie: ${u.autonomieH} h · ${u.kraftstoff}<br>Punkte: ${u.pts}`
    ).addTo(grp);
  });
  if (!map.hasLayer(grp)) grp.addTo(map);
}

// ── Speicher-Merit-Order über Netzknoten ─────────────────────────────────────
// Ein Speicher entlastet nur das, was elektrisch oberhalb von ihm liegt. Wir
// bewerten daher die realen Infrastrukturknoten (NAP/Trafo/NSHV/UV/KVS) anhand
// ihres Residualprofils (Topologie-BFS aus 13r) statt geografischer Cluster:
//   • zentral  → der Verknüpfungspunkt mit dem größten Residual (Leistungspreis/EV)
//   • verteilt → die K unabhängigen Knoten mit der höchsten Entlastung je kWh
//                (Engpass-/Spannungsentlastung am belasteten Strang)

// Aktive Infrastrukturknoten mit Koordinaten.
function _naInfraNodes(yr) {
  const out = [];
  for (const a of ASSETS.items) {
    if (!isInfraNode(a)) continue;
    if (getAssetStatus(a, yr) !== 'active') continue;
    if (!isFinite(a.lat) || !isFinite(a.lng)) continue;
    out.push(a);
  }
  return out;
}

// Infrastrukturknoten, die elektrisch unterhalb von startId liegen (höherer
// TYPE_RANK = weiter vom Netzanschluss entfernt). Dient der Überlappungsprüfung:
// Eltern- und Kindknoten teilen sich dasselbe Residual, dürfen also nicht doppelt
// bestückt werden.
function _infraDownstreamSet(startId) {
  const edges = window.stromEdges || [];
  const startA = getAsset(startId);
  const startRk = startA ? (TYPE_RANK[startA.type] ?? 0) : 0;
  const visited = new Set([startId]);
  const queue = [startId];
  const down = new Set();
  while (queue.length) {
    const cur = queue.shift();
    const neighbors = [...new Set(edges
      .filter(e => e.u === cur || e.v === cur)
      .map(e => (e.u === cur ? e.v : e.u)))].filter(id => !visited.has(id));
    for (const nid of neighbors) {
      visited.add(nid);
      const na = getAsset(nid);
      if (!na) continue;
      const rk = TYPE_RANK[na.type] ?? 0;
      if (rk <= startRk) continue;            // nur abwärts in der Hierarchie
      if (isInfraNode(na)) { down.add(nid); queue.push(nid); }
    }
  }
  return down;
}

// Kappungsanalyse eines Residualprofils: Spitze, Kappleistung und die Energie,
// die der Speicher im größten zusammenhängenden Über-Schwellen-Ereignis halten
// muss, um die Spitze auf die Schwelle zu drücken.
function _shaveAnalysis(prof, shaveFrac) {
  let peak = 0;
  for (let t = 0; t < prof.length; t++) if (prof[t] > peak) peak = prof[t];
  if (peak <= 0) return { peak: 0, threshold: 0, shaveKW: 0, reqKWh: 0, hoursOver: 0 };
  const threshold = peak * (1 - shaveFrac);
  const shaveKW = peak - threshold;
  let maxEvent = 0, cur = 0, hoursOver = 0;
  for (let t = 0; t < prof.length; t++) {
    const ex = prof[t] - threshold;
    if (ex > 0) { cur += ex; hoursOver++; if (cur > maxEvent) maxEvent = cur; }
    else cur = 0;
  }
  return { peak, threshold, shaveKW, reqKWh: maxEvent, hoursOver };
}

// Knoten bewerten und sortieren. Primär: Überlast (Netzcode-Verletzung) zuerst.
// Sekundär: Entlastungseffizienz = gekappte kW je benötigter kWh (peaky → besser).
function _naScoreInfraNodes(shaveFrac) {
  const yr = globalYear || new Date().getFullYear();
  invalidateKnotenProfileCache();            // frische Profile (Assets/Jahr können sich geändert haben)
  const scored = [];
  for (const a of _naInfraNodes(yr)) {
    const { prof, peakKW, capacityKW } = getInfraNodeResidual(a);
    if (peakKW <= 0) continue;               // reiner Einspeise-/Leerknoten → kein Bezugs-Peak zu kappen
    const sh = _shaveAnalysis(prof, shaveFrac);
    const overloadKW = capacityKW > 0 ? Math.max(0, peakKW - capacityKW) : 0;
    const auslastung = capacityKW > 0 ? peakKW / capacityKW : 0;
    const effizienz  = sh.reqKWh > 0 ? sh.shaveKW / sh.reqKWh : 0;
    scored.push({ asset: a, lat: a.lat, lng: a.lng, name: a.name || a.type,
                  peakKW, capacityKW, auslastung, overloadKW,
                  shaveKW: sh.shaveKW, reqKWh: sh.reqKWh, hoursOver: sh.hoursOver, effizienz });
  }
  scored.sort((x, y) => (y.overloadKW - x.overloadKW) || (y.effizienz - x.effizienz) || (y.peakKW - x.peakKW));
  return scored;
}

// ── Feste Speichergrößen aus den PV-Analyse-Varianten ───────────────────────
// Die PV-Analyse (09d) optimiert je Variante eine Batteriegröße (batKwh). Diese
// kann hier als feste Auslegungsgröße übernommen werden, statt aus Shave % zu
// dimensionieren — so bleibt die Netzplatzierung konsistent zur PV-Auslegung.
function _naPvVarianten() {
  const erg = window._pvAnalyse?.ergebnisse || [];
  if (!window._pvAnalyse?.berechnet) return [];
  return erg.filter(e => (e.batKwh || 0) > 0)
            .map(e => ({ id: e.id, label: e.label, batKwh: Math.round(e.batKwh), pvKwp: Math.round(e.pvKwp || 0) }));
}
function _naSelectedPvVariant() {
  const vars = _naPvVarianten();
  if (!vars.length) return null;
  return vars.find(v => v.id === NA.batPvVariantId) || vars[0];
}

// Units so umskalieren, dass ihre Gesamtkapazität exakt totalKWh ergibt;
// Verteilung nach dem bisherigen Leistungsanteil (kW), Leistung über C/2-Rate
// (wie in der PV-Analyse: batLeistKw = batKwh/2).
function _naApplyFixedBudget(units, totalKWh) {
  if (!(totalKWh > 0) || !units.length) return units;
  const sumW = units.reduce((s, u) => s + Math.max(u.kW, 1), 0) || 1;
  for (const u of units) {
    const w = Math.max(u.kW, 1) / sumW;
    u.kWh = Math.max(1, Math.round(totalKWh * w));
    u.kW  = Math.max(1, Math.round(u.kWh / 2));
    u.fixedFromPv = true;
    if (u.reqKWh !== undefined) u.gedeckt = u.kWh >= u.reqKWh;
  }
  return units;
}

// Top-K elektrisch unabhängige Knoten (kein Eltern-/Kind-Verhältnis untereinander).
function _naSelectIndependentNodes(scored, k) {
  const picked = [];
  for (const cand of scored) {
    const overlap = picked.some(p => {
      const dp = _infraDownstreamSet(p.asset.id);
      const dc = _infraDownstreamSet(cand.asset.id);
      return dp.has(cand.asset.id) || dc.has(p.asset.id);
    });
    if (overlap) continue;
    picked.push(cand);
    if (picked.length >= k) break;
  }
  return picked;
}

export function naRunSpeicherMeritOrder() {
  _ensureGroups();
  const shaveFrac = NA.batShavePct / 100, hours = NA.batHours;
  const scored = _naScoreInfraNodes(shaveFrac);
  if (!scored.length) {
    grpBatPlace.clearLayers(); NA.batResult = null;
    alert('Keine bewertbaren Netzknoten gefunden. Netz verkabeln (Stromnetz) oder geografische Platzierung wählen.');
    naRenderPanel(); return;
  }
  let chosen;
  if (NA.batMode === 'zentral') {
    // Verknüpfungspunkt = Knoten mit größtem Residual (aggregiert alles Nachgelagerte)
    chosen = [scored.reduce((best, n) => (n.peakKW > best.peakKW ? n : best), scored[0])];
  } else {
    chosen = _naSelectIndependentNodes(scored, NA.batK);
  }
  const units = chosen.map(n => {
    const kW  = Math.max(1, Math.round(Math.max(n.shaveKW, n.overloadKW)));
    const kWh = Math.max(1, Math.round(kW * hours));
    return { lat: n.lat, lng: n.lng, kW, kWh,
             loadKW: n.peakKW, pts: 0, name: n.name,
             auslastung: n.auslastung, overloadKW: n.overloadKW,
             reqKWh: Math.round(n.reqKWh), gedeckt: kWh >= n.reqKWh };
  });
  units.method = 'netz';
  units.scoredCount = scored.length;
  // Feste Größe aus PV-Variante übernehmen (überschreibt die Shave-Dimensionierung)
  if (NA.batSizeMode === 'pv') {
    const v = _naSelectedPvVariant();
    if (v) { _naApplyFixedBudget(units, v.batKwh); units.pvVariant = v; }
  }
  NA.batResult = units;
  _naDrawPlacementUnits(grpBatPlace, [], units, 'bat');
  naRenderPanel();
}

export function naRunSpeicherPlatzierung() {
  _ensureGroups();
  // Netz-Merit-Order, sofern gewählt und ein verkabeltes Netz vorhanden ist.
  if (NA.batMethod === 'netz' && (window.stromEdges || []).length > 0) {
    naRunSpeicherMeritOrder();
    return;
  }
  const clusters = _naClusterLoads(NA.batMode === 'zentral' ? 1 : NA.batK);
  if (!clusters) { grpBatPlace.clearLayers(); NA.batResult = null; alert('Keine aktiven Lastpunkte gefunden.'); naRenderPanel(); return; }
  const shave = NA.batShavePct / 100, hours = NA.batHours;
  const units = clusters.map(cl => {
    const kW = Math.max(1, Math.round(cl.bezugKW * shave));
    return { lat: cl.centroid.lat, lng: cl.centroid.lng, kW, kWh: Math.round(kW * hours),
             loadKW: cl.bezugKW, pts: cl.points.length };
  });
  units.method = 'geo';
  if (NA.batSizeMode === 'pv') {
    const v = _naSelectedPvVariant();
    if (v) { _naApplyFixedBudget(units, v.batKwh); units.pvVariant = v; }
  }
  NA.batResult = units;
  _naDrawPlacementUnits(grpBatPlace, clusters, units, 'bat');
  naRenderPanel();
}

// ── Anleitung: zentral oder dezentral? — datengestützte Empfehlung ───────────
// Folgt der Werthebel-Logik: Bilanzgrenzen-Hebel (Leistungspreis, Eigenverbrauch)
// → zentral am Verknüpfungspunkt; lokale Netzprobleme (Auslastung, Spannung) tief
// im Netz → dezentral am belasteten Knoten. Liefert {empfehlung, kurz, gruende[]}.
export function naSpeicherEmpfehlung() {
  if (!(window.stromEdges || []).length)
    return { empfehlung: null, kurz: 'Kein verkabeltes Netz — bitte Stromnetz verkabeln oder geografisch platzieren.', gruende: [] };
  const scored = _naScoreInfraNodes(NA.batShavePct / 100);
  if (!scored.length)
    return { empfehlung: null, kurz: 'Keine bewertbaren Netzknoten gefunden.', gruende: [] };

  const boundaryRank = Math.min(...scored.map(n => TYPE_RANK[n.asset.type] ?? 0));
  const isBoundary   = n => (TYPE_RANK[n.asset.type] ?? 0) === boundaryRank;
  const overloaded   = scored.filter(n => n.overloadKW > 0);
  const downstreamOverloaded = overloaded.filter(n => !isBoundary(n));
  const hochlast     = scored.filter(n => n.auslastung >= 0.9 && !isBoundary(n));
  const boundary     = scored.reduce((best, n) => (n.peakKW > best.peakKW ? n : best), scored[0]);

  const gruende = [];
  let empfehlung, kurz, modeK;

  if (downstreamOverloaded.length >= 1 || hochlast.length >= 1) {
    const krit = (downstreamOverloaded.length ? downstreamOverloaded : hochlast);
    empfehlung = 'dezentral'; modeK = Math.min(Math.max(krit.length, 1), 20);
    kurz = `Dezentral an ${krit.length} belastetem/n Strang/Strängen — der Speicher muss elektrisch unterhalb des Engpasses sitzen.`;
    for (const n of krit.slice(0, 4))
      gruende.push(`${n.name}: Auslastung ${(n.auslastung * 100).toFixed(0)} %${n.overloadKW > 0 ? `, Überlast ${n.overloadKW.toFixed(0)} kW` : ''} → lokale Entlastung nötig.`);
    if (downstreamOverloaded.length >= 2)
      gruende.push('Mehrere unabhängige Engpässe → verteilte Standorte entlasten gezielter als ein zentraler Speicher.');
  } else if (overloaded.some(isBoundary) || boundary.auslastung >= 0.9) {
    empfehlung = 'zentral'; modeK = 1;
    kurz = 'Zentral am Verknüpfungspunkt — der Engpass liegt an der Bilanzgrenze (NAP/Trafo), nicht in einzelnen Strängen.';
    gruende.push(`${boundary.name}: Auslastung ${(boundary.auslastung * 100).toFixed(0)} % an der Bilanzgrenze → Leistungsspitze zentral kappen (Leistungspreis).`);
    gruende.push('Downstream keine Engpässe — ein zentraler Speicher genügt und ist je kWh günstiger.');
  } else {
    empfehlung = 'zentral'; modeK = 1;
    kurz = 'Zentral am Verknüpfungspunkt — keine Netzengpässe; der Werthebel ist Eigenverbrauch/Leistungspreis an der Bilanzgrenze.';
    const feed = boundary.feedKW || 0;
    if (feed > 0) gruende.push(`Rückspeisung bis ${Math.round(feed)} kW am ${boundary.name} → zentraler Speicher hebt den Eigenverbrauch (Mittagsüberschuss in die Abendlast).`);
    gruende.push('Kein Knoten über 90 % Auslastung → lokale Entlastung nicht erforderlich; Durchmischung macht einen zentralen Speicher effizienter.');
  }
  return { empfehlung, kurz, gruende, modeK, boundaryName: boundary.name };
}

export function naRunNotstromPlatzierung() {
  _ensureGroups();
  const clusters = _naClusterLoads(NA.nsaMode === 'zentral' ? 1 : NA.nsaK);
  if (!clusters) { grpNsaPlace.clearLayers(); NA.nsaResult = null; alert('Keine aktiven Lastpunkte gefunden.'); naRenderPanel(); return; }
  const reco    = window._pvResReco;
  const useReco = NA.nsaSource === 'resilienz' && reco && reco.genKw > 0;
  const sumLoad = clusters.reduce((s, cl) => s + cl.bezugKW, 0) || 1;
  const sitePeak = Math.ceil(sumLoad * (NA.gzf || 0.7));   // koinzidente Karten-Spitzenlast
  const totalKW  = useReco ? Math.ceil(reco.genKw) : sitePeak;
  const autonomieH = useReco ? reco.durH : 24;
  const kraftstoff = useReco ? (reco.kraftstoff || 'Diesel') : 'Diesel';
  const units = clusters.map(cl => {
    const share = NA.nsaMode === 'zentral' ? 1 : cl.bezugKW / sumLoad;
    return { lat: cl.centroid.lat, lng: cl.centroid.lng, kW: Math.max(1, Math.round(totalKW * share)),
             autonomieH, kraftstoff, loadKW: cl.bezugKW, pts: cl.points.length };
  });
  NA.nsaResult = { units, totalKW, source: useReco ? 'resilienz' : 'spitzenlast',
                   autonomieH, kraftstoff, sitePeak, recoKW: reco ? Math.ceil(reco.genKw) : null };
  _naDrawPlacementUnits(grpNsaPlace, clusters, units, 'nsa');
  naRenderPanel();
}

export function naUebernehmenSpeicher() {
  if (!window.createAsset) { alert('createAsset nicht verfügbar'); return; }
  const units = NA.batResult;
  if (!units || !units.length) { alert('Bitte zuerst die Speicher-Platzierung berechnen.'); return; }
  if (!confirm(`${units.length} Batteriespeicher als Assets anlegen?`)) return;
  let created = 0;
  for (const u of units) {
    const a = window.createAsset('Batterie', u.lat, u.lng, { props: {
      leistungKW: String(u.kW), kapazitaetKWh: String(u.kWh), betriebsmodus: 'eigenverbrauch' } });
    if (a) created++;
  }
  if (grpBatPlace) grpBatPlace.clearLayers();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();
  alert(`${created} Batteriespeicher erstellt. Positionen per Drag & Drop anpassbar.`);
}

export function naUebernehmenNotstrom() {
  if (!window.createAsset) { alert('createAsset nicht verfügbar'); return; }
  const res = NA.nsaResult;
  if (!res || !res.units.length) { alert('Bitte zuerst die Notstrom-Platzierung berechnen.'); return; }
  if (!confirm(`${res.units.length} Notstromaggregat(e) als Assets anlegen?`)) return;
  let created = 0;
  for (const u of res.units) {
    const a = window.createAsset('Nsa', u.lat, u.lng, { props: {
      leistungKW: String(u.kW), autonomieH: String(u.autonomieH), kraftstoff: u.kraftstoff } });
    if (a) created++;
  }
  if (grpNsaPlace) grpNsaPlace.clearLayers();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();
  alert(`${created} Notstromaggregat(e) erstellt. Positionen per Drag & Drop anpassbar.`);
}

export function naClearSpeicher() { _ensureGroups(); grpBatPlace.clearLayers(); NA.batResult = null; naRenderPanel(); }
export function naClearNotstrom() { _ensureGroups(); grpNsaPlace.clearLayers(); NA.nsaResult = null; naRenderPanel(); }

export function naSetBatMethod(m) { NA.batMethod = m === 'geo' ? 'geo' : 'netz'; naRenderPanel(); }
export function naSetBatMode(m)   { NA.batMode = m === 'verteilt' ? 'verteilt' : 'zentral'; naRenderPanel(); }
export function naSetBatSizeMode(m){ NA.batSizeMode = m === 'pv' ? 'pv' : 'auto'; naRenderPanel(); }
export function naSetBatPvVariant(id){ NA.batPvVariantId = id || null; naRenderPanel(); }
export function naToggleBatGuide(){ NA.batGuideOpen = !NA.batGuideOpen; naRenderPanel(); }

// Sprung in die PV-Analyse (Analyse-Ansicht, Abschnitt „pva").
export function naOeffnePvAnalyse() {
  if (typeof window.setViewMode === 'function')       window.setViewMode('analyse');
  if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('pva');
}

// Empfehlung übernehmen: setzt Modus (zentral/verteilt) + Knotenzahl entsprechend.
export function naEmpfehlungUebernehmen() {
  const e = naSpeicherEmpfehlung();
  if (!e.empfehlung) { alert(e.kurz); return; }
  NA.batMode = e.empfehlung === 'dezentral' ? 'verteilt' : 'zentral';
  if (e.empfehlung === 'dezentral' && e.modeK) NA.batK = e.modeK;
  naRenderPanel();
}
export function naSetBatK(v)      { NA.batK = Math.max(1, Math.min(20, parseInt(v) || 3)); naRenderPanel(); }
export function naSetBatShave(v)  { NA.batShavePct = Math.max(5, Math.min(100, parseInt(v) || 40)); naRenderPanel(); }
export function naSetBatHours(v)  { NA.batHours = Math.max(0.5, Math.min(12, parseFloat(v) || 2)); naRenderPanel(); }
export function naSetNsaMode(m)   { NA.nsaMode = m === 'verteilt' ? 'verteilt' : 'zentral'; naRenderPanel(); }
export function naSetNsaK(v)      { NA.nsaK = Math.max(1, Math.min(20, parseInt(v) || 3)); naRenderPanel(); }
export function naSetNsaSource(s) { NA.nsaSource = s === 'spitzenlast' ? 'spitzenlast' : 'resilienz'; naRenderPanel(); }

// ── Panel-Rendering ──────────────────────────────────────────────────────────
export function naRenderPanel() {
  const panel = document.getElementById('netzanalyse-content');
  if (!panel) return;
  const yr           = globalYear || new Date().getFullYear();
  const pts          = naGetLoadPoints();
  const totalBezug   = pts.reduce((s, p) => s + p.loadKW, 0);
  const totalEinsp   = pts.reduce((s, p) => s + p.genKW,  0);
  const totalNetto   = totalBezug - totalEinsp;
  const heatOn       = NA.heatmapActive;
  const heatMode     = NA.heatmapMode;
  const isAuto       = NA.mode === 'auto';
  const kVal         = NA.k;
  const maxKVA       = NA.maxKVA;
  const cosPhi       = NA.cosPhi;
  const gzf          = NA.gzf;
  const minUtilPct   = NA.minUtilPct;
  const proxRadius   = NA.proxRadius;
  const useExisting    = NA.useExisting;
  const hasResult      = NA.naResult !== null;
  const existingT      = _naGetExistingTrafos(yr);
  const kabelOn        = NA.kabelActive;
  const kabelInfo      = NA.naKabelInfo;
  const kabelEurM      = NA.naKabelEurM;
  const erzeugungsnetz = NA.erzeugungsnetz;
  const erzResult      = NA.naErzeugResult;
  const hasAnyResult   = hasResult || (erzResult && erzResult.length > 0);
  const nettoCol       = totalNetto >= 0 ? '#ef5350' : '#42a5f5';
  const nettoSign      = totalNetto >= 0 ? '+' : '';
  const activeTab      = NA.activeTab || 'last';

  const _tabBtn = (id, label, color, tip) => `<button onclick="naSetTab('${id}')" title="${tip}"
    style="flex:1;padding:7px 4px;cursor:pointer;font-family:inherit;font-size:10px;
           font-weight:${activeTab===id?'700':'400'};border:none;
           border-bottom:2px solid ${activeTab===id?color:'transparent'};
           background:transparent;color:${activeTab===id?color:'var(--muted)'};">${label}</button>`;

  const tabBarHtml = `
<div style="display:flex;gap:2px;margin-bottom:10px;border-bottom:1px solid var(--border);">
  ${_tabBtn('last',  '🌡 Lastübersicht',     '#ce93d8', 'Heatmap der räumlichen Verteilung von Verbrauch und Erzeugung auf der Karte anzeigen')}
  ${_tabBtn('trafo', '⚡ Trafo',     '#4fc3f7', 'Optimale Trafo-Standorte automatisch berechnen (Clustering nach Last/Erzeugung) und als Kompaktstationen übernehmen')}
  ${_tabBtn('bat',   '🔋 Speicher',  '#aed581', 'Optimale Standorte für Batteriespeicher (Peak-Shaving/Netzentlastung) berechnen und als Assets übernehmen')}
  ${_tabBtn('nsa',   '⚙ Notstrom',  '#ff7043', 'Optimale Standorte für Notstromaggregate berechnen — Dimensionierung aus der Resilienz-Analyse')}
  ${_tabBtn('ms',    '🔗 MS-Netz',   '#f9a825', 'Mittelspannungsnetz zwischen NAP und Trafos analysieren und automatisch verlegen')}
</div>`;

  // ── Tab 1: Lastübersicht (Heatmap) ─────────────────────────────────────────
  const tabLastHtml = `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Heatmap: Last &amp; Erzeugung</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  <div style="font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.4;">
    Visualisiert die räumliche Verteilung von Verbrauch und Erzeugung auf der Karte.
  </div>
  <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
    <button onclick="naSetHeatmapMode('legacy')" title="Heatmap als Kreise darstellen: Größe und Farbe der Kreise zeigen lokale Lastspitzen"
      style="flex:1;padding:4px;border-radius:4px;border:1px solid ${heatMode==='legacy'?'#ffb74d':'#666'};
             color:${heatMode==='legacy'?'#ffb74d':'#999'};background:${heatMode==='legacy'?'rgba(255,183,77,.12)':'transparent'};
             cursor:pointer;font-family:inherit;font-size:10px;">Kreise</button>
    <button onclick="naSetHeatmapMode('relief')" title="Heatmap als Relief darstellen: flächige Farbverläufe für Verbrauch und Erzeugung mit optionalen Höhenlinien"
      style="flex:1;padding:4px;border-radius:4px;border:1px solid ${heatMode==='relief'?'#81c784':'#666'};
             color:${heatMode==='relief'?'#81c784':'#999'};background:${heatMode==='relief'?'rgba(129,199,132,.12)':'transparent'};
             cursor:pointer;font-family:inherit;font-size:10px;">Relief</button>
  </div>
  ${heatMode === 'relief' ? `
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
    <label style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);">
      <input type="checkbox" ${NA.heatmapLayers?.load !== false ? 'checked' : ''}
             onchange="naHeatmapSetLayerVisibility('load',this.checked)">
      <span style="color:#ef5350">Verbrauch</span></label>
    <label style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);">
      <input type="checkbox" ${NA.heatmapLayers?.gen !== false ? 'checked' : ''}
             onchange="naHeatmapSetLayerVisibility('gen',this.checked)">
      <span style="color:#42a5f5">Erzeugung</span></label>
    <label style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);">
      <input type="checkbox" ${NA.heatmapContours ? 'checked' : ''}
             onchange="window._naToggleContours(this.checked)">
      <span style="color:#cfd8dc">Höhenlinien</span></label>
  </div>
  <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Farblegende (Relief-Intensität)</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
    <div>
      <div style="font-size:9px;color:#ef5350;margin-bottom:2px;">Verbrauch</div>
      <div style="height:8px;border-radius:4px;background:linear-gradient(90deg,#234,#66bb6a,#ffa726,#ef5350);"></div>
      <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--muted);"><span>niedrig</span><span>hoch</span></div>
    </div>
    <div>
      <div style="font-size:9px;color:#42a5f5;margin-bottom:2px;">Erzeugung</div>
      <div style="height:8px;border-radius:4px;background:linear-gradient(90deg,#142036,#2196f3,#64b5f6,#bbdefb);"></div>
      <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--muted);"><span>niedrig</span><span>hoch</span></div>
    </div>
  </div>` : `
  <div style="font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.4;">
    Kreise zeigen lokale Lastspitzen; Radius und Farbe steigen mit der maßgebenden Last.</div>`}
  <button onclick="naHeatmapToggle(${!heatOn})" title="Heatmap-Überlagerung auf der Karte ein-/ausblenden"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid #b39ddb;color:${heatOn?'#ce93d8':'var(--muted)'};
           background:${heatOn?'rgba(179,157,219,.12)':'transparent'};">
    ${heatOn ? '👁 Heatmap ausblenden' : '👁 Heatmap anzeigen'}
  </button>
</div>`;

  // ── Ergebnistabelle: alle vorgeschlagenen Trafo-Standorte (Verbrauch + Erzeugung) ──
  const trafoRows = [];
  (NA.naResult || []).forEach((cl, i) => {
    const auslPct = NA.naMaxKW ? Math.round(cl.peakKW / NA.naMaxKW * 100) : null;
    trafoRows.push({
      label: cl.isWhale ? `⚡ Direktanschluss ${i + 1}` : `Trafo ${i + 1}`,
      col: cl.isWhale ? '#ffa726' : NA_CLUSTER_COLORS[i % NA_CLUSTER_COLORS.length],
      bezugKW: cl.bezugKW, einspeisungKW: cl.einspeisungKW, peakKW: cl.peakKW,
      auslPct, kva: _kvaEmpfStr(cl.peakKW, NA.cosPhi), points: cl.points.length,
    });
  });
  if (erzeugungsnetz) {
    (erzResult || []).forEach((cl, i) => {
      trafoRows.push({
        label: `☀ Einspeise-Trafo ${i + 1}`,
        col: NA_ERZEUG_COLORS[i % NA_ERZEUG_COLORS.length],
        bezugKW: cl.bezugKW, einspeisungKW: cl.einspeisungKW, peakKW: cl.einspeisungKW,
        auslPct: null, kva: _kvaEmpfStr(cl.einspeisungKW, NA.cosPhi), points: cl.points.length,
      });
    });
  }
  const trafoResultTableHtml = trafoRows.length === 0 ? '' : `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Ergebnis: Trafo-Standorte</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:9px;color:var(--text);white-space:nowrap;">
    <thead>
      <tr style="color:var(--muted);">
        <th style="text-align:left;font-weight:400;padding:2px 5px 4px;">Standort</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Bezug</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Einsp.</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Maßgeb.</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Ausl.</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Empf. Leistung</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Pkt.</th>
      </tr>
    </thead>
    <tbody>
      ${trafoRows.map(r => {
        const auslCol = r.auslPct == null ? 'var(--muted)' : r.auslPct > 100 ? '#ef5350' : r.auslPct > 80 ? '#ffa726' : '#66bb6a';
        return `<tr style="border-top:1px solid var(--border);">
          <td style="padding:3px 5px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.col};margin-right:5px;"></span>${r.label}
          </td>
          <td style="text-align:right;padding:3px 5px;color:#ef5350;">${r.bezugKW.toFixed(0)} kW</td>
          <td style="text-align:right;padding:3px 5px;color:#42a5f5;">${r.einspeisungKW.toFixed(0)} kW</td>
          <td style="text-align:right;padding:3px 5px;font-weight:600;">${r.peakKW.toFixed(0)} kW</td>
          <td style="text-align:right;padding:3px 5px;color:${auslCol};">${r.auslPct != null ? r.auslPct + '%' : '–'}</td>
          <td style="text-align:right;padding:3px 5px;">${r.kva}</td>
          <td style="text-align:right;padding:3px 5px;color:var(--muted);">${r.points}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>`;

  // ── Alternativen-Vergleich: benachbarte Stationszahlen (Auto-Modus) ──────────
  const kCompareHtml = (!NA.naKCompare || NA.naKCompare.length < 2) ? '' : `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Alternativen: Stationszahl vs. Kabellänge</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:9px;color:var(--text);white-space:nowrap;">
    <thead>
      <tr style="color:var(--muted);">
        <th style="text-align:left;font-weight:400;padding:2px 5px 4px;">Stationen</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Max. Ausl.</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Kabellänge (MST, gesch.)</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;">Kabelkosten (gesch.)</th>
        <th style="text-align:right;font-weight:400;padding:2px 5px 4px;"></th>
      </tr>
    </thead>
    <tbody>
      ${NA.naKCompare.map(c => {
        const auslCol = c.maxAuslPct == null ? 'var(--muted)' : c.maxAuslPct > 100 ? '#ef5350' : c.maxAuslPct > 80 ? '#ffa726' : '#66bb6a';
        return `<tr style="border-top:1px solid var(--border);${c.isChosen ? 'background:rgba(79,195,247,.08);' : ''}">
          <td style="padding:3px 5px;${c.isChosen ? 'font-weight:700;color:#4fc3f7;' : ''}">${c.k}${c.isChosen ? ' (gewählt)' : ''}</td>
          <td style="text-align:right;padding:3px 5px;color:${auslCol};">${c.maxAuslPct != null ? c.maxAuslPct + '%' : '–'}</td>
          <td style="text-align:right;padding:3px 5px;">${(c.cableM/1000).toLocaleString('de-DE',{maximumFractionDigits:1})} km</td>
          <td style="text-align:right;padding:3px 5px;">${c.cableCost.toLocaleString('de-DE')} T€</td>
          <td style="text-align:right;padding:3px 5px;">
            ${c.isChosen ? '' : `<button onclick="naApplyKCompare(${c.k})"
              style="padding:2px 8px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:9px;
                     border:1px solid #4fc3f7;color:#4fc3f7;background:transparent;">verwenden</button>`}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.4;">
    Schätzung anhand minimaler Spannbäume; Stations-/Trafokosten sind nicht enthalten (kein Kostenmodell hinterlegt).
    Weniger Stationen senken i. d. R. die Stationskosten, erhöhen aber die Kabellänge – und umgekehrt.
  </div>
</div>`;

  // ── Tab 2: Trafo-Platzierung (Bestand, Optimierung, Ergebnis, Kabeltrassen) ──
  const tabTrafoHtml = `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Bestehende Trafos</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  ${existingT.length === 0
    ? `<div style="font-size:10px;color:var(--muted);">Keine aktiven Trafo-Assets im Jahr ${yr} gefunden.<br>
       Trafos können im Elektro-Modus als Asset platziert werden.</div>`
    : `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
         <span style="font-size:10px;color:var(--text);">${existingT.length} Trafo${existingT.length>1?'s':''} aktiv im Jahr ${yr}</span>
         <label style="display:flex;align-items:center;gap:5px;font-size:10px;cursor:pointer;">
           <input type="checkbox" ${useExisting?'checked':''} onchange="naSetUseExisting(this.checked)"
             style="accent-color:#4fc3f7;width:13px;height:13px;"> Bei Optimierung einbeziehen
         </label>
       </div>
       ${existingT.map(t => {
         const z      = NA.naExistingResults?.assignMap?.get(t.id);
         const exh    = NA.naExistingResults?.exhaustionMap?.get(t.id);
         const auslPct = z?.auslPct ?? null;
         const auslCol = auslPct == null ? 'var(--muted)' : auslPct > 100 ? '#ef5350' : auslPct > 80 ? '#ffa726' : '#66bb6a';
         const barW    = auslPct != null ? Math.min(100, auslPct) : 0;
         return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-top:1px solid var(--border);">
           <span style="font-size:10px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${t.name}">${t.name}</span>
           <span style="font-size:9px;color:var(--muted);white-space:nowrap;">${t.kVA} kVA</span>
           ${auslPct != null
             ? `<div style="width:50px;flex-shrink:0;">
                  <div style="background:var(--border);border-radius:2px;height:4px;margin-bottom:1px;">
                    <div style="background:${auslCol};width:${barW}%;height:4px;border-radius:2px;"></div>
                  </div>
                  <div style="font-size:8px;color:${auslCol};text-align:right;">${auslPct}%</div>
                </div>`
             : '<div style="width:50px;font-size:8px;color:var(--muted);text-align:right;">–</div>'}
           ${exh?.exhaustionYear
             ? `<span style="font-size:8px;color:#ef5350;white-space:nowrap;">⚠${exh.exhaustionYear}</span>`
             : exh ? '<span style="font-size:8px;color:#66bb6a;white-space:nowrap;">ok</span>' : ''}
         </div>`;
       }).join('')}`
  }
</div>

<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">
  ${useExisting && existingT.length > 0 ? 'Neue Trafos für überlastete Zonen' : 'Trafo-Platzierungsvorschlag'}
</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  <div style="display:flex;gap:4px;margin-bottom:8px;">
    <button onclick="naSetMode('manual')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid ${!isAuto?'var(--accent)':'var(--border)'};
             background:${!isAuto?'rgba(79,195,247,.12)':'transparent'};
             color:${!isAuto?'var(--accent)':'var(--muted)'};">Manuell (k)</button>
    <button onclick="naSetMode('auto')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid ${isAuto?'#66bb6a':'var(--border)'};
             background:${isAuto?'rgba(102,187,106,.1)':'transparent'};
             color:${isAuto?'#66bb6a':'var(--muted)'};">Auto (max. kVA)</button>
  </div>
  <label style="display:flex;align-items:center;gap:6px;font-size:10px;cursor:pointer;margin-bottom:8px;
                padding:5px 6px;border-radius:4px;background:${erzeugungsnetz?'rgba(38,198,218,.08)':'transparent'};
                border:1px solid ${erzeugungsnetz?'#26c6da':'var(--border)'};">
    <input type="checkbox" ${erzeugungsnetz?'checked':''} onchange="naSetErzeugungsnetz(this.checked)"
      style="accent-color:#26c6da;width:13px;height:13px;flex-shrink:0;">
    <span style="color:${erzeugungsnetz?'#26c6da':'var(--muted)'};">
      Erzeugungstrafos separat berechnen
      <span style="display:block;font-size:9px;opacity:.75;line-height:1.3;">PV / Wind / KWK → eigenes Erzeugungsnetz</span>
    </span>
  </label>
  ${!isAuto ? `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <label style="font-size:10px;color:var(--text);white-space:nowrap;">Anzahl Trafos (k):</label>
    <input type="number" min="1" max="20" value="${kVal}"
      style="width:55px;padding:3px 5px;background:var(--bg);border:1px solid var(--border);
             color:var(--text);border-radius:4px;font-size:11px;"
      oninput="naSetK(this.value)">
  </div>` : `
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:8px;">
    <div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Max. kVA</div>
      <select onchange="naSetMaxKVA(this.value)"
        style="width:100%;padding:3px 5px;background:var(--bg);border:1px solid var(--border);
               color:var(--text);border-radius:4px;font-size:11px;font-family:inherit;">
        ${[250,400,630,1000,1600,2000].map(v=>`<option value="${v}" ${maxKVA===v?'selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">cos φ</div>
      <input type="number" min="0.7" max="1" step="0.05" value="${cosPhi}"
        style="width:100%;padding:3px 5px;background:var(--bg);border:1px solid var(--border);
               color:var(--text);border-radius:4px;font-size:11px;"
        oninput="naSetCosPhi(this.value)">
    </div>
    <div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">GZF</div>
      <select onchange="naSetGzf(this.value)"
        style="width:100%;padding:3px 5px;background:var(--bg);border:1px solid var(--border);
               color:var(--text);border-radius:4px;font-size:11px;">
        ${[0.5,0.6,0.7,0.8,0.9,1.0].map(v=>`<option value="${v}" ${gzf===v?'selected':''}>${v.toFixed(1)}</option>`).join('')}
      </select>
    </div>
    <div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Mind.ausl. %</div>
      <input type="number" min="0" max="80" step="5" value="${minUtilPct}"
        style="width:100%;padding:3px 5px;background:var(--bg);border:1px solid var(--border);
               color:var(--text);border-radius:4px;font-size:11px;"
        oninput="naSetMinUtil(this.value)">
    </div>
    <div style="grid-column:span 2;">
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">NSHV-Bündelungsradius</div>
      <select onchange="naSetProxRadius(this.value)"
        style="width:100%;padding:3px 5px;background:var(--bg);border:1px solid var(--border);
               color:var(--text);border-radius:4px;font-size:11px;">
        ${[0,10,25,50,100,200].map(v=>`<option value="${v}" ${proxRadius===v?'selected':''}>${v===0?'aus':v+' m'}</option>`).join('')}
      </select>
    </div>
  </div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:8px;">
    Eff. Kapazität: <b style="color:var(--text)">${(maxKVA*cosPhi*gzf).toFixed(0)} kW</b>
    (${(maxKVA*cosPhi).toFixed(0)} kW × GZF ${gzf.toFixed(1)}).
    ${proxRadius > 0 ? `Punkte ≤ ${proxRadius} m werden zu NSHV-Knoten gebündelt.` : ''}
  </div>`}
  <button onclick="naRunTrafoOptimierung()" title="Optimale Trafo-Standorte per Clustering aus den Lastpunkten berechnen (Anzahl k automatisch oder manuell)"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid #b39ddb;color:#ce93d8;background:transparent;margin-bottom:5px;">
    ⚡ Optimierung berechnen
  </button>
</div>

${kCompareHtml}
${trafoResultTableHtml}

${hasAnyResult ? `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#4fc3f7;margin-bottom:4px;">Ergebnis übernehmen</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;border-left:3px solid #4fc3f7;">
  <div style="font-size:10px;color:var(--muted);margin-bottom:8px;line-height:1.4;">
    Erzeugt reale Gebäude + Elektro-Assets (Schaltanlage, Trafo, NSHV) auf der Karte.
  </div>
  <button onclick="naUebernehmenAlsKompaktstation()" title="Berechnete Trafo-Standorte als reale Kompaktstationen (Schaltanlage + Trafo + NSHV) inkl. Gebäude auf der Karte anlegen"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid #4fc3f7;color:#4fc3f7;background:rgba(79,195,247,.08);margin-bottom:5px;font-weight:600;">
    🏗 Als Kompaktstationen übernehmen
  </button>
  <button onclick="naClearTrafoOptimierung()" title="Berechnete Optimierungs-Vorschau (Vorschläge für Trafo-Standorte) wieder verwerfen"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid var(--muted);color:var(--muted);background:transparent;">
    ✕ Optimierungs-Vorschau löschen</button>
</div>` : ''}

<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Kabeltrassen (MST)</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  <div style="font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.4;">
    Minimaler Spannbaum – optimaler Kabelverlauf je Trafo/Zone
  </div>
  <button onclick="naKabelToggle(${!kabelOn})" title="Vorgeschlagene Kabeltrassen (minimaler Spannbaum je Trafo/Zone) auf der Karte ein-/ausblenden"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid #80cbc4;color:${kabelOn?'#80cbc4':'var(--muted)'};
           background:${kabelOn?'rgba(128,203,196,.12)':'transparent'};">
    ${kabelOn ? '🔌 Ausblenden' : '🔌 Anzeigen'}
  </button>
  ${kabelOn && kabelInfo?.totalM > 0 ? `
  <div style="font-size:10px;color:var(--text);margin:5px 0;">
    Gesamt: <b style="color:#80cbc4">${(kabelInfo.totalM/1000).toFixed(2)} km</b>
    &nbsp;·&nbsp; ca. <b style="color:#ffa726">${Math.round(kabelInfo.totalM * kabelEurM / 1000)} k€</b>
  </div>
  <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);margin-bottom:6px;">
    Kostensatz: <input type="number" value="${kabelEurM}" min="50" max="2000" step="10"
      style="width:60px;background:var(--surface);border:1px solid var(--border);border-radius:3px;
             color:var(--text);padding:2px 4px;font-size:10px;"
      oninput="naSetKabelEurM(this.value)"> €/m
  </div>
  <div style="background:var(--bg);border-radius:4px;padding:6px 7px;font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.5;">
    💡 Kante auf der Karte <b style="color:#ffb300">anklicken</b> zum Auswählen (gelb).
  </div>
  <div style="display:flex;gap:6px;">
    <button onclick="naKabelSelectAll()" title="Alle vorgeschlagenen Kabeltrassen auswählen" style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;border:1px solid #555;color:#888;background:transparent;">alle ☑</button>
    <button onclick="naKabelSelectNone()" title="Auswahl der Kabeltrassen aufheben" style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;border:1px solid #555;color:#888;background:transparent;">keine</button>
    <button onclick="naImportSelectedKabel()" title="Ausgewählte Kabeltrassen als reale Leitungen ins Stromnetz übernehmen"
      style="flex:2;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid #66bb6a;color:#66bb6a;background:rgba(102,187,106,.1);font-weight:600;">
      ⬆ Übernehmen (${(NA.naKabelEdges||[]).filter(k=>k.selected).length} ✓)
    </button>
  </div>` : ''}
</div>`;

  // ── Tab 3: MS-Netz ──────────────────────────────────────────────────────────
  const tabMsHtml = `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">MS-Netz (Mittelspannung)</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  <div style="font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.4;">
    MS-Ring-Erkennung und (n-1)-Analyse
  </div>
  <button onclick="elRunMSAnalyse()" title="Mittelspannungsnetz auf Ringstrukturen untersuchen und (n-1)-Ausfallsicherheit prüfen"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid #f9a825;color:#f9a825;background:transparent;margin-bottom:5px;">
    ⊞ MS-Topologie analysieren
  </button>
  <button onclick="clearMSRings()" title="MS-Ring-Überlagerung wieder von der Karte entfernen"
    style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
           border:1px solid var(--muted);color:var(--muted);background:transparent;">
    ✕ MS-Overlay ausblenden
  </button>
  <div id="ms-ring-results" style="margin-top:8px;font-size:10px;"></div>
</div>`;

  // ── Tabs 4/5: Speicher- & Notstrom-Platzierung ──────────────────────────────
  const _inp = 'background:#11151d;color:#cfd8dc;border:1px solid #444;border-radius:3px;padding:1px 3px;font-family:inherit;font-size:10px;';
  const _modeBtn = (grp, val, lbl, cur) => {
    const c = grp === 'bat' ? COL_BAT : COL_NSA, on = cur === val;
    return `<button onclick="naSet${grp === 'bat' ? 'Bat' : 'Nsa'}Mode('${val}')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid ${on ? c : '#555'};color:${on ? c : '#999'};background:${on ? 'rgba(255,255,255,.06)' : 'transparent'};">${lbl}</button>`;
  };
  const _runBtn  = (col) => `width:100%;padding:6px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:600;border:1px solid ${col};color:${col};background:rgba(255,255,255,.04);`;
  const _takeBtn = 'flex:3;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:600;border:1px solid #66bb6a;color:#66bb6a;background:rgba(102,187,106,.1);';
  const _clrBtn  = 'flex:1;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;border:1px solid var(--muted);color:var(--muted);background:transparent;';

  const batRes = NA.batResult;
  const isNetz = NA.batMethod === 'netz';
  const _methodBtn = (val, lbl, tip) => {
    const on = NA.batMethod === val;
    return `<button onclick="naSetBatMethod('${val}')" title="${tip}"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid ${on ? COL_BAT : '#555'};color:${on ? COL_BAT : '#999'};
             background:${on ? 'rgba(174,213,129,.12)' : 'transparent'};">${lbl}</button>`;
  };
  const hasNetz = (window.stromEdges || []).length > 0;
  // Netz-Ergebnis: Knoten-Zeilen mit Auslastung/Deckung
  const batNetzRows = batRes && batRes.method === 'netz'
    ? batRes.map((u, i) => `<div style="display:flex;justify-content:space-between;gap:6px;padding:3px 0;
         border-bottom:1px solid rgba(255,255,255,.05);font-size:10px;color:#cfd8dc;">
         <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:96px;" title="${u.name}">${i+1}. ${u.name}</span>
         <span>${u.kW} kW · ${u.kWh} kWh${u.overloadKW>0?` · <span style="color:#ef9a9a">Überlast ${u.overloadKW.toFixed(0)}</span>`:''}${u.gedeckt?'':' <span style="color:#ffa726" title="Dauer deckt das größte Lastereignis nicht ab">⚠</span>'}</span>
       </div>`).join('')
    : '';

  // ── Dimensionierung: Shave-basiert vs. feste Größe aus PV-Variante ──
  const isPvSize = NA.batSizeMode === 'pv';
  const pvVars   = _naPvVarianten();
  const selPvVar = _naSelectedPvVariant();
  const _sizeBtn = (val, lbl, tip) => {
    const on = NA.batSizeMode === val;
    return `<button onclick="naSetBatSizeMode('${val}')" title="${tip}"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid ${on ? COL_BAT : '#555'};color:${on ? COL_BAT : '#999'};
             background:${on ? 'rgba(174,213,129,.12)' : 'transparent'};">${lbl}</button>`;
  };
  const pvLinkBtn = `<button onclick="naOeffnePvAnalyse()" title="Zur PV-Analyse wechseln (Analyse → PV)"
      style="width:100%;padding:5px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid #42a5f5;color:#42a5f5;background:rgba(66,165,245,.08);margin-top:5px;">↗ PV-Analyse öffnen</button>`;
  const pvSizeHtml = isPvSize ? (pvVars.length
    ? `<div style="margin-bottom:6px;">
         <select onchange="naSetBatPvVariant(this.value)" style="width:100%;${_inp}padding:3px;">
           ${pvVars.map(v => `<option value="${v.id}" ${selPvVar && v.id===selPvVar.id?'selected':''}>${v.label} — ${v.batKwh.toLocaleString('de-DE')} kWh (${v.pvKwp} kWp)</option>`).join('')}
         </select>
         <div style="font-size:9px;color:var(--muted);margin-top:3px;line-height:1.4;">
           Feste Gesamtkapazität aus der PV-Variante; Leistung über C/2-Rate. Bei „verteilt" anteilig auf die Knoten verteilt.
         </div>
         ${pvLinkBtn}
       </div>`
    : `<div style="margin-bottom:6px;font-size:10px;color:#ffa726;line-height:1.4;">
         Noch keine PV-Varianten mit Batterie berechnet. Bitte zuerst die PV-Analyse rechnen.${pvLinkBtn}
       </div>`) : '';

  // ── Anleitung: zentral oder dezentral? (datengestützte Empfehlung) ──
  const emp = NA.batGuideOpen ? naSpeicherEmpfehlung() : null;
  const empCol = emp && emp.empfehlung === 'dezentral' ? '#ffa726' : '#66bb6a';
  const guideHtml = `
  <div style="margin-top:8px;border-top:1px solid rgba(255,255,255,.07);padding-top:6px;">
    <button onclick="naToggleBatGuide()" style="width:100%;text-align:left;background:transparent;border:none;
      cursor:pointer;font-family:inherit;font-size:10px;color:#90caf9;padding:2px 0;">
      ${NA.batGuideOpen ? '▾' : '▸'} Anleitung: zentral oder dezentral?
    </button>
    ${NA.batGuideOpen ? `
    <div style="font-size:10px;color:#cfd8dc;line-height:1.5;margin-top:4px;">
      <div style="color:var(--muted);margin-bottom:5px;">Der beste Ort hängt vom Werthebel ab — ein Speicher entlastet nur, was elektrisch oberhalb von ihm liegt:</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin-bottom:6px;">
        <div style="color:#66bb6a;font-weight:600;">zentral</div><div>Leistungspreis kappen · Eigenverbrauch/PV-Überschuss · Arbitrage → am Verknüpfungspunkt (NAP/Trafo).</div>
        <div style="color:#ffa726;font-weight:600;">dezentral</div><div>Engpass / Betriebsmittel-Überlast · Spannungshaltung · Backup → am belasteten Knoten tief im Netz.</div>
      </div>
      ${emp && emp.empfehlung ? `
        <div style="background:rgba(255,255,255,.04);border:1px solid ${empCol};border-radius:5px;padding:6px;">
          <div style="font-weight:700;color:${empCol};margin-bottom:3px;">Empfehlung: ${emp.empfehlung === 'dezentral' ? 'dezentral' : 'zentral'}</div>
          <div style="margin-bottom:4px;">${emp.kurz}</div>
          <ul style="margin:0 0 4px 0;padding-left:14px;color:var(--muted);">${emp.gruende.map(g => `<li>${g}</li>`).join('')}</ul>
          <button onclick="naEmpfehlungUebernehmen()" style="width:100%;padding:4px;border-radius:4px;cursor:pointer;
            font-family:inherit;font-size:10px;font-weight:600;border:1px solid ${empCol};color:${empCol};background:transparent;">
            ✓ Empfehlung übernehmen</button>
        </div>` : `<div style="color:#ffa726;font-size:10px;">${emp ? emp.kurz : ''}</div>`}
    </div>` : ''}
  </div>`;

  const tabBatHtml = `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Batteriespeicher platzieren</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  <div style="font-size:9px;color:var(--muted);margin-bottom:3px;">Methode</div>
  <div style="display:flex;gap:6px;margin-bottom:6px;">
    ${_methodBtn('netz','Netz-Merit-Order','Bewertet reale Netzknoten nach Entlastung je kWh (Topologie-Residualprofil). Empfohlen, wenn das Stromnetz verkabelt ist.')}
    ${_methodBtn('geo','geografisch','Clustert Lastpunkte räumlich (k-Means). Fallback ohne verkabeltes Netz.')}
  </div>
  ${isNetz && !hasNetz ? `<div style="font-size:9px;color:#ffa726;margin-bottom:6px;">⚠ Kein verkabeltes Stromnetz — fällt auf geografische Platzierung zurück.</div>` : ''}
  <div style="font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.4;">
    ${isNetz
      ? 'Bewertet NAP/Trafo/NSHV/UV/KVS anhand ihres Residualprofils. <b>zentral</b> = Verknüpfungspunkt (Leistungspreis/Eigenverbrauch), <b>verteilt</b> = belastete Stränge (Engpass).'
      : 'Schlägt Speicher-Standorte aus Lastschwerpunkten vor. Leistung = Anteil der Zonenlast, Kapazität = Leistung × Dauer.'}
  </div>
  <div style="display:flex;gap:6px;margin-bottom:6px;">${_modeBtn('bat','zentral','zentral',NA.batMode)}${_modeBtn('bat','verteilt',isNetz?'verteilt (Knoten)':'verteilt (Zonen)',NA.batMode)}</div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:3px;">Dimensionierung</div>
  <div style="display:flex;gap:6px;margin-bottom:6px;">
    ${_sizeBtn('auto','aus Netz (Shave %)','Leistung aus Knotenspitze × Shave-Anteil, Kapazität = Leistung × Dauer.')}
    ${_sizeBtn('pv','feste Größe (PV-Variante)','Übernimmt die optimierte Batteriegröße einer PV-Analyse-Variante als feste Gesamtkapazität.')}
  </div>
  ${pvSizeHtml}
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px;font-size:10px;color:var(--muted);">
    ${NA.batMode==='verteilt' ? `<label>${isNetz?'Knoten':'Zonen'} <input type="number" min="1" max="20" value="${NA.batK}" onchange="naSetBatK(this.value)" style="width:42px;${_inp}"></label>` : ''}
    <label>Shave <input type="number" min="5" max="100" value="${NA.batShavePct}" onchange="naSetBatShave(this.value)" style="width:46px;${_inp}"> %</label>
    ${isPvSize ? '' : `<label>Dauer <input type="number" min="0.5" max="12" step="0.5" value="${NA.batHours}" onchange="naSetBatHours(this.value)" style="width:46px;${_inp}"> h</label>`}
  </div>
  <button onclick="naRunSpeicherPlatzierung()" style="${_runBtn(COL_BAT)}">🔋 Platzierung berechnen</button>
  ${batRes ? `
  <div style="margin-top:8px;font-size:10px;color:#cfd8dc;"><b>${batRes.length}</b> Speicher · Σ <b>${batRes.reduce((s,u)=>s+u.kW,0)}</b> kW · <b>${batRes.reduce((s,u)=>s+u.kWh,0).toLocaleString('de-DE')}</b> kWh${batRes.method==='netz'?` <span style="color:var(--muted)">· ${batRes.scoredCount} Knoten bewertet</span>`:''}</div>
  ${batRes.pvVariant ? `<div style="font-size:9px;color:#90caf9;margin-top:2px;">feste Größe aus PV-Variante „${batRes.pvVariant.label}" (${batRes.pvVariant.batKwh.toLocaleString('de-DE')} kWh)</div>` : ''}
  ${batNetzRows ? `<div style="margin-top:5px;">${batNetzRows}</div>` : ''}
  <div style="display:flex;gap:6px;margin-top:6px;">
    <button onclick="naUebernehmenSpeicher()" style="${_takeBtn}">⬆ Als Assets übernehmen</button>
    <button onclick="naClearSpeicher()" title="Vorschlag verwerfen" style="${_clrBtn}">✕</button>
  </div>` : ''}
  ${guideHtml}
</div>`;

  const reco   = window._pvResReco;
  const nsaRes = NA.nsaResult;
  const recoTxt = reco && reco.genKw > 0
    ? `Resilienz-Empfehlung: <b>${Math.ceil(reco.genKw)} kW</b> · ${reco.durH} h · ${reco.kraftstoff}`
    : `<span style="color:#ffa726">Noch keine Resilienz-Rechnung (Abb. 10) — Fallback: Karten-Spitzenlast</span>`;
  const _srcBtn = (val, lbl) => {
    const on = NA.nsaSource === val;
    return `<button onclick="naSetNsaSource('${val}')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;
             border:1px solid ${on ? COL_NSA : '#555'};color:${on ? COL_NSA : '#999'};background:${on ? 'rgba(255,112,67,.1)' : 'transparent'};">${lbl}</button>`;
  };
  const tabNsaHtml = `
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Notstromaggregat platzieren</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;">
  <div style="font-size:10px;color:var(--muted);margin-bottom:6px;line-height:1.4;">
    Schlägt Aggregat-Standorte vor. Gesamtleistung aus der Resilienz-Analyse oder der Karten-Spitzenlast, auf die Zonen verteilt.
  </div>
  <div style="font-size:10px;margin-bottom:6px;padding:5px;border-radius:4px;background:rgba(255,112,67,.08);border:1px solid rgba(255,112,67,.3);color:#cfd8dc;">${recoTxt}</div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Dimensionierung</div>
  <div style="display:flex;gap:6px;margin-bottom:6px;">${_srcBtn('resilienz','aus Resilienz')}${_srcBtn('spitzenlast','Karten-Spitzenlast')}</div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Platzierung</div>
  <div style="display:flex;gap:6px;margin-bottom:6px;">${_modeBtn('nsa','zentral','zentral',NA.nsaMode)}${_modeBtn('nsa','verteilt','verteilt (Zonen)',NA.nsaMode)}</div>
  ${NA.nsaMode==='verteilt' ? `<label style="font-size:10px;color:var(--muted);display:block;margin-bottom:6px;">Zonen <input type="number" min="1" max="20" value="${NA.nsaK}" onchange="naSetNsaK(this.value)" style="width:42px;${_inp}"></label>` : ''}
  <button onclick="naRunNotstromPlatzierung()" style="${_runBtn(COL_NSA)}">⚙ Platzierung berechnen</button>
  ${nsaRes ? `
  <div style="margin-top:8px;font-size:10px;color:#cfd8dc;"><b>${nsaRes.units.length}</b> Aggregat(e) · Σ <b>${nsaRes.totalKW}</b> kW · ${nsaRes.autonomieH} h · ${nsaRes.kraftstoff}
    <div style="font-size:9px;color:var(--muted);margin-top:2px;">Quelle: ${nsaRes.source==='resilienz' ? 'Resilienz-Analyse' : `Karten-Spitzenlast (${nsaRes.sitePeak} kW)`}</div></div>
  <div style="display:flex;gap:6px;margin-top:6px;">
    <button onclick="naUebernehmenNotstrom()" style="${_takeBtn}">⬆ Als Assets übernehmen</button>
    <button onclick="naClearNotstrom()" title="Vorschlag verwerfen" style="${_clrBtn}">✕</button>
  </div>` : ''}
</div>`;

  panel.innerHTML = `
<!-- Übersicht -->
<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Übersicht Lastpunkte</div>
<div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:10px;
     display:grid;grid-template-columns:repeat(4,1fr);gap:4px;text-align:center;">
  <div><div style="font-size:15px;font-weight:700;color:#ce93d8;">${pts.length}</div>
       <div style="font-size:9px;color:var(--muted);">Punkte</div></div>
  <div><div style="font-size:15px;font-weight:700;color:#ef5350;">${totalBezug.toFixed(0)}</div>
       <div style="font-size:9px;color:var(--muted);">kW Bezug</div></div>
  <div><div style="font-size:15px;font-weight:700;color:#42a5f5;">${totalEinsp.toFixed(0)}</div>
       <div style="font-size:9px;color:var(--muted);">kW Einsp.</div></div>
  <div><div style="font-size:15px;font-weight:700;color:${nettoCol};">${nettoSign}${totalNetto.toFixed(0)}</div>
       <div style="font-size:9px;color:var(--muted);">kW Netto</div></div>
</div>

${tabBarHtml}

${activeTab === 'trafo' ? tabTrafoHtml : activeTab === 'bat' ? tabBatHtml : activeTab === 'nsa' ? tabNsaHtml : activeTab === 'ms' ? tabMsHtml : tabLastHtml}`;
}

// ── Panel-Toggle ─────────────────────────────────────────────────────────────
let _panelOpen = false;
// Beim Schließen entfernte Overlay-Gruppen, die beim nächsten Öffnen wieder
// sichtbar gemacht werden (Zustand/Inhalt der Gruppen bleibt dabei erhalten).
let _hiddenGroupsOnClose = [];

function _allNaGroups() {
  return [
    grpHeatmapLoad, grpHeatmapGen, grpHeatmapLegacy, grpKabeltrassen,
    grpKMeans, grpExistingTrafos, grpErzeugungKMeans, grpBatPlace, grpNsaPlace,
  ];
}

export function naTogglePanel() {
  _panelOpen = !_panelOpen;
  const panel    = document.getElementById('netzanalyse-panel');
  const btn      = document.getElementById('btn-netzanalyse-toggle');
  if (!panel) return;
  panel.style.display = _panelOpen ? 'block' : 'none';
  btn?.classList.toggle('active', _panelOpen);
  if (_panelOpen) {
    _ensureGroups();
    // Beim Schließen ausgeblendete Overlays wieder auf die Karte holen
    _hiddenGroupsOnClose.forEach(g => { if (g && !map.hasLayer(g)) g.addTo(map); });
    _hiddenGroupsOnClose = [];
    naRenderPanel();
  } else {
    // Alle Netzanalyse-Overlays (Heatmap, Kabeltrassen, Cluster/Voronoi,
    // Trafo-/Speicher-/Notstrom-Vorschläge) zusammen mit dem Fenster ausblenden
    _hiddenGroupsOnClose = _allNaGroups().filter(g => g && map.hasLayer(g));
    _hiddenGroupsOnClose.forEach(g => map.removeLayer(g));
  }
}

// ── Interne Helfer für inline-onchange ───────────────────────────────────────
window._naToggleContours = function(v) {
  NA.heatmapContours = !!v;
  if (NA.heatmapActive) _requestHeatmapRefresh();
  naRenderPanel();
};

// Zoom-Listener: Relief bei Kartenänderung neu zeichnen
setTimeout(() => {
  map.on('zoomend moveend', () => {
    if (NA.heatmapActive && NA.heatmapMode === 'relief') _requestHeatmapRefresh();
  });
}, 0);
