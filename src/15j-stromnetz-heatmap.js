// ── 15j-stromnetz-heatmap.js — Heatmap-Visualisierung der Lastpunkte ────────
// Portiert aus Standalone-Elektroteil (~12717–13000).
// Zwei Modi:
//   - 'relief': Pixel-Grid mit Gauß-Kernel + optionalen Höhenlinien
//   - 'legacy': einfache farbige Kreise pro Lastpunkt
//
// State liegt in STROMNETZ._heatmap*
// Layer werden direkt auf die Map gerendert (Leaflet ImageOverlay bzw. circles).
// Default ist AUS — User schaltet ein über UI-Toggle.

import { map } from './02b-gebaeude.js';
import { STROMNETZ } from './14b-stromnetz-state.js';
import { getLoadPoints } from './15i-stromnetz-clustering.js';

// ── LayerGroups (lazy initialisiert) ────────────────────────────────────────
function ensureGroups() {
  if (!STROMNETZ.grpHeatmapLoad)   STROMNETZ.grpHeatmapLoad   = L.layerGroup();
  if (!STROMNETZ.grpHeatmapGen)    STROMNETZ.grpHeatmapGen    = L.layerGroup();
  if (!STROMNETZ.grpHeatmapLegacy) STROMNETZ.grpHeatmapLegacy = L.layerGroup();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function metersToPixels(meters, lat) {
  const zoom = map.getZoom();
  const mpp = 156543.03392 * Math.cos((lat || map.getCenter().lat) * Math.PI / 180) / Math.pow(2, zoom);
  return meters / Math.max(mpp, 0.001);
}

// Farbverlauf: load = rot/orange/grün (Schwellwerte), gen = blau-skala
function reliefColor(t, kind) {
  const v = Math.max(0, Math.min(1, t));
  const stops = kind === 'gen'
    ? [[0, [20, 30, 55]],   [0.4,  [33, 150, 243]], [0.7,  [100, 181, 246]], [1, [187, 222, 251]]]
    : [[0, [35, 25, 25]],   [0.35, [102, 187, 106]],[0.65, [255, 167, 38]],  [1, [239, 83, 80]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
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

// ════════════════════════════════════════════════════════════════════════════
// RELIEF-MODUS (Pixel-Grid + Gauß-Kernel)
// ════════════════════════════════════════════════════════════════════════════
function buildReliefCanvas(points, kind) {
  const size = map.getSize();
  const w = Math.max(32, size.x);
  const h = Math.max(32, size.y);
  const cfg = STROMNETZ._heatmapReliefCfg || {};
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
    const sigmaPx = Math.max(14, metersToPixels(cfg.kernelRadiusM || 90, p.lat) * 0.6);
    const reachPx = sigmaPx * 3;
    const minX = Math.max(0,      Math.floor((cp.x - reachPx) / cellPx));
    const maxX = Math.min(gw - 1, Math.ceil ((cp.x + reachPx) / cellPx));
    const minY = Math.max(0,      Math.floor((cp.y - reachPx) / cellPx));
    const maxY = Math.min(gh - 1, Math.ceil ((cp.y + reachPx) / cellPx));
    const inv2Sigma2 = 1 / (2 * sigmaPx * sigmaPx);

    for (let gy = minY; gy <= maxY; gy++) {
      const py = (gy + 0.5) * cellPx;
      const dy = py - cp.y;
      for (let gx = minX; gx <= maxX; gx++) {
        const px = (gx + 0.5) * cellPx;
        const dx = px - cp.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > reachPx * reachPx) continue;
        const idx = gy * gw + gx;
        const v = kw * Math.exp(-d2 * inv2Sigma2);
        const nv = field[idx] + v;
        field[idx] = nv;
        if (nv > maxV) maxV = nv;
      }
    }
  }

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gw;
  gridCanvas.height = gh;
  const gctx = gridCanvas.getContext('2d');
  const img = gctx.createImageData(gw, gh);
  const minAlpha = cfg.minAlpha ?? 0.04;
  const maxAlpha = cfg.maxAlpha ?? 0.78;

  for (let i = 0; i < field.length; i++) {
    const base = i * 4;
    if (maxV <= 0 || field[i] <= 0) { img.data[base + 3] = 0; continue; }
    const t = Math.pow(field[i] / maxV, 0.72);
    const rgb = reliefColor(t, kind);
    const alpha = Math.max(minAlpha, Math.min(maxAlpha, t * maxAlpha));
    img.data[base]     = rgb[0];
    img.data[base + 1] = rgb[1];
    img.data[base + 2] = rgb[2];
    img.data[base + 3] = Math.round(alpha * 255);
  }
  gctx.putImageData(img, 0, 0);

  // Hochskalieren auf Original-Bildschirmgröße
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(gridCanvas, 0, 0, w, h);
  return { canvas: out, maxValue: maxV, field, gw, gh, cellPx };
}

// ── Höhenlinien (Marching Squares) ─────────────────────────────────────────
function drawContoursOnCanvas(ctx, field, gw, gh, cellPx, maxV, color) {
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
    0: [], 1: [[3,0]], 2: [[0,1]], 3: [[3,1]],
    4: [[1,2]], 5: [[3,2],[0,1]], 6: [[0,2]], 7: [[3,2]],
    8: [[2,3]], 9: [[0,2]], 10: [[0,3],[1,2]], 11: [[1,2]],
    12: [[1,3]], 13: [[0,1]], 14: [[3,0]], 15: [],
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let li = 0; li < levels.length; li++) {
    const thr = levels[li] * maxV;
    ctx.globalAlpha = 0.17 + li * 0.07;
    ctx.lineWidth = 0.8 + li * 0.15;
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const tl = field[y * gw + x]         > thr ? 8 : 0;
        const tr = field[y * gw + x + 1]     > thr ? 4 : 0;
        const br = field[(y + 1) * gw + x + 1] > thr ? 2 : 0;
        const bl = field[(y + 1) * gw + x]   > thr ? 1 : 0;
        const code = tl | tr | br | bl;
        const segs = lookup[code];
        for (const [a, b] of segs) {
          const [ax, ay] = edgePt(a, x, y);
          const [bx, by] = edgePt(b, x, y);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// REFRESH-FUNKTIONEN
// ════════════════════════════════════════════════════════════════════════════
export function refreshHeatmapRelief() {
  ensureGroups();
  STROMNETZ.grpHeatmapLoad.clearLayers();
  STROMNETZ.grpHeatmapGen.clearLayers();
  STROMNETZ.grpHeatmapLegacy.clearLayers();
  if (!STROMNETZ._heatmapActive) return;

  if (!map.hasLayer(STROMNETZ.grpHeatmapLoad)) STROMNETZ.grpHeatmapLoad.addTo(map);
  if (!map.hasLayer(STROMNETZ.grpHeatmapGen))  STROMNETZ.grpHeatmapGen .addTo(map);

  const pts = getLoadPoints();
  if (!pts.length) {
    // User-Hinweis: Heatmap aktiviert, aber keine Lastpunkte vorhanden
    if (typeof window.showHint === 'function') {
      window.showHint('Heatmap aktiv, aber keine Lastpunkte gefunden. Platziere Verbraucher / PV / WP / Lade / Bat / Nsa als Anlagen, damit etwas angezeigt wird.', 6000);
    }
    return;
  }
  const bounds = map.getBounds();

  const vis = STROMNETZ._heatmapLayerVisibility || { load: true, gen: true };
  if (vis.load !== false) {
    const r = buildReliefCanvas(pts, 'load');
    if (r.maxValue > 0) {
      if (STROMNETZ._heatmapShowContours) {
        drawContoursOnCanvas(r.canvas.getContext('2d'),
          r.field, r.gw, r.gh, r.cellPx, r.maxValue, 'rgba(255,240,230,0.95)');
      }
      L.imageOverlay(r.canvas.toDataURL('image/png'), bounds, { opacity: 1, interactive: false })
        .addTo(STROMNETZ.grpHeatmapLoad);
    }
  }
  if (vis.gen !== false) {
    const r = buildReliefCanvas(pts, 'gen');
    if (r.maxValue > 0) {
      if (STROMNETZ._heatmapShowContours) {
        drawContoursOnCanvas(r.canvas.getContext('2d'),
          r.field, r.gw, r.gh, r.cellPx, r.maxValue, 'rgba(230,245,255,0.95)');
      }
      L.imageOverlay(r.canvas.toDataURL('image/png'), bounds, { opacity: 1, interactive: false })
        .addTo(STROMNETZ.grpHeatmapGen);
    }
  }
}

// Einfacher Modus: ein Kreis pro Lastpunkt, Größe + Farbe nach Last/Einspeisung
export function refreshHeatmapLegacy() {
  ensureGroups();
  STROMNETZ.grpHeatmapLoad.clearLayers();
  STROMNETZ.grpHeatmapGen.clearLayers();
  STROMNETZ.grpHeatmapLegacy.clearLayers();
  if (!STROMNETZ._heatmapActive) return;

  if (!map.hasLayer(STROMNETZ.grpHeatmapLegacy)) STROMNETZ.grpHeatmapLegacy.addTo(map);
  const pts = getLoadPoints();
  if (pts.length === 0) {
    if (typeof window.showHint === 'function') {
      window.showHint('Heatmap aktiv, aber keine Lastpunkte gefunden. Platziere Verbraucher / PV / WP / Lade / Bat / Nsa als Anlagen, damit etwas angezeigt wird.', 6000);
    }
    return;
  }
  const maxPeak = Math.max(...pts.map(p => p.peakKW));

  for (const p of pts) {
    if (p.lat == null || p.lng == null) continue;
    const ratio = maxPeak > 0 ? p.peakKW / maxPeak : 0;
    const r = 25 + Math.sqrt(ratio) * 95;  // 25 m – 120 m
    if (!isFinite(r) || r <= 0) continue;
    const isFeeder = p.genKW > p.loadKW;
    const col = isFeeder
      ? (ratio > 0.66 ? '#1565c0' : ratio > 0.33 ? '#42a5f5' : '#90caf9')
      : (ratio > 0.66 ? '#ef5350' : ratio > 0.33 ? '#ffa726' : '#66bb6a');
    const tip = [`<b>${p.name}</b> (${p.type})`];
    if (p.loadKW > 0) tip.push(`Bezug: ${p.loadKW.toFixed(1)} kW`);
    if (p.genKW  > 0) tip.push(`Einspeisung: ${p.genKW.toFixed(1)} kW`);
    tip.push(`Netto: ${p.netKW >= 0 ? '+' : ''}${p.netKW.toFixed(1)} kW`);
    L.circle([p.lat, p.lng], {
      radius: r, color: col, fillColor: col,
      fillOpacity: 0.28, opacity: 0.55, weight: 1,
    }).bindTooltip(tip.join('<br>'), { direction: 'top' })
      .addTo(STROMNETZ.grpHeatmapLegacy);
  }
}

export function refreshHeatmap() {
  if ((STROMNETZ._heatmapMode || 'relief') === 'legacy') refreshHeatmapLegacy();
  else refreshHeatmapRelief();
}

// ── Public Toggle-API ──────────────────────────────────────────────────────
export function heatmapToggle(show) {
  STROMNETZ._heatmapActive = !!show;
  ensureGroups();
  if (!STROMNETZ._heatmapActive) {
    STROMNETZ.grpHeatmapLoad.clearLayers();
    STROMNETZ.grpHeatmapGen.clearLayers();
    STROMNETZ.grpHeatmapLegacy.clearLayers();
    if (map.hasLayer(STROMNETZ.grpHeatmapLoad))   map.removeLayer(STROMNETZ.grpHeatmapLoad);
    if (map.hasLayer(STROMNETZ.grpHeatmapGen))    map.removeLayer(STROMNETZ.grpHeatmapGen);
    if (map.hasLayer(STROMNETZ.grpHeatmapLegacy)) map.removeLayer(STROMNETZ.grpHeatmapLegacy);
  } else {
    refreshHeatmap();
  }
}

export function heatmapSetMode(mode) {
  STROMNETZ._heatmapMode = mode === 'legacy' ? 'legacy' : 'relief';
  if (STROMNETZ._heatmapActive) refreshHeatmap();
}

export function heatmapSetLayerVisibility(kind, show) {
  if (!STROMNETZ._heatmapLayerVisibility) STROMNETZ._heatmapLayerVisibility = { load: true, gen: true };
  if (kind !== 'load' && kind !== 'gen') return;
  STROMNETZ._heatmapLayerVisibility[kind] = !!show;
  if (STROMNETZ._heatmapActive) refreshHeatmap();
}

export function heatmapSetContours(show) {
  STROMNETZ._heatmapShowContours = !!show;
  if (STROMNETZ._heatmapActive) refreshHeatmap();
}

export function isHeatmapActive() { return !!STROMNETZ._heatmapActive; }

// ── Auto-Refresh bei Map-Move/Zoom (debounced via rAF) ─────────────────────
function requestHeatmapRefresh() {
  if ((STROMNETZ._heatmapMode || 'relief') === 'legacy') return;  // legacy nutzt Geo-Koordinaten direkt
  if (!STROMNETZ._heatmapActive || STROMNETZ._heatmapRefreshPending) return;
  STROMNETZ._heatmapRefreshPending = true;
  requestAnimationFrame(() => {
    STROMNETZ._heatmapRefreshPending = false;
    refreshHeatmap();
  });
}

setTimeout(() => {
  map.on('moveend', requestHeatmapRefresh);
  map.on('zoomend', requestHeatmapRefresh);
  map.on('resize',  requestHeatmapRefresh);
}, 0);
