// ── 06d-waerme-heatmap.js — Heatmap der Wärmelasten und -erzeuger ───────────
// Konzept analog zu 15j-stromnetz-heatmap.js, aber Wärme-Datenquellen:
//   - Lastpunkte: Gebäude-Schwerpunkte mit heizlast (kW)
//   - Erzeuger:   aktivierte Wärmeerzeuger mit Position (LWWP, FG-WP, Geo, BHKW,
//                 Gas/Heizöl/Pellets/HHS-Kessel, Fernwärme-Einspeisepunkt)
//
// Zwei Layer:
//   - load (rot/orange): Wärmebedarf
//   - gen  (grün):       Wärmeerzeugung (statt blau, weil Wärme≠Strom)
// Default ist AUS — User schaltet ein über UI-Toggle.

import { gebaeude, globalYear, isExcluded } from './01-globals-varianten.js';
import { getComputedStats, map } from './02b-gebaeude.js';

// ── Modul-State (analog zu STROMNETZ._heatmap*) ─────────────────────────────
export const WAERME_HEATMAP = {
  active:           false,
  mode:             'relief',     // 'relief' | 'legacy'
  showContours:     true,
  layerVisibility:  { load: true, gen: true },
  reliefCfg:        { kernelRadiusM: 110, gridPx: 10, minAlpha: 0.05, maxAlpha: 0.78 },
  refreshPending:   false,
  // Lazy initialisierte Leaflet-LayerGroups
  grpLoad:    null,
  grpGen:     null,
  grpLegacy:  null,
};

function ensureGroups() {
  if (!WAERME_HEATMAP.grpLoad)   WAERME_HEATMAP.grpLoad   = L.layerGroup();
  if (!WAERME_HEATMAP.grpGen)    WAERME_HEATMAP.grpGen    = L.layerGroup();
  if (!WAERME_HEATMAP.grpLegacy) WAERME_HEATMAP.grpLegacy = L.layerGroup();
}

// ── Datenquellen ────────────────────────────────────────────────────────────

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

// Lastpunkte: Gebäude-Schwerpunkt mit heizlast (kW). Excluded/abrissjahr werden übersprungen.
function getWaermeLastpunkte(year) {
  const yr = year || globalYear || new Date().getFullYear();
  const list = gebaeude || [];
  const out = [];
  for (const g of list) {
    if (!g || !g.polygon || g.polygon.length < 3) continue;
    if (typeof isExcluded === 'function' && isExcluded(g.id)) continue;
    if (g.abrissjahr && parseInt(g.abrissjahr) <= yr) continue;
    if (g.baujahr    && parseInt(g.baujahr)    >  yr) continue;
    const c = polygonCentroid(g.polygon);
    if (!c) continue;
    const stats = (typeof getComputedStats === 'function')
      ? getComputedStats(g, yr) : null;
    const heizlast = parseFloat((stats && stats.heizlast) || g.heizlast) || 0;
    if (heizlast <= 0) continue;
    out.push({
      lat: c.lat, lng: c.lng,
      loadKW: heizlast, genKW: 0,
      peakKW: heizlast, name: g.name || g.id,
    });
  }
  return out;
}

// Erzeuger-Positionen: aus den globalen Erzeuger-Objekten + DOM-Leistungseingaben
function getWaermeErzeugerpunkte() {
  const out = [];
  function readKw(id) { return parseFloat(document.getElementById(id)?.value) || 0; }
  function pushIf(obj, kw, label) {
    if (!obj || obj.lat == null || obj.lng == null) return;
    if (kw <= 0) return;
    out.push({ lat: obj.lat, lng: obj.lng, loadKW: 0, genKW: kw, peakKW: kw, name: label });
  }
  pushIf(window.lwWp,             readKw('lwwp-leistung'),  'Luft-WP');
  pushIf(window.geoThermie,       readKw('geo-leistung-eff'),'Geo-WP');
  pushIf(window.bhkw,             readKw('bhkw-leistung-th'),'BHKW');
  pushIf(window.gasKessel,        readKw('gk-leistung'),    'Gaskessel');
  pushIf(window.heizoelKessel,    readKw('hko-leistung'),   'Heizölkessel');
  pushIf(window.pelletsKessel,    readKw('pk-leistung'),    'Pelletkessel');
  pushIf(window.heizhackschnitzel,readKw('hhs-leistung'),   'HHS-Kessel');
  pushIf(window.fernwaerme,       readKw('fw-leistung'),    'Fernwärme');
  pushIf(window.stromkessel,      readKw('sk-leistung'),    'Stromkessel');
  // Fließgewässer: Mittelpunkt der Linie
  if (window.fliessgewaesser?.latlngs?.length >= 2) {
    const lls = window.fliessgewaesser.latlngs;
    const mid = lls[Math.floor(lls.length / 2)];
    const kw  = readKw('fg-leistung');
    if (kw > 0 && mid) {
      out.push({ lat: mid.lat, lng: mid.lng, loadKW: 0, genKW: kw, peakKW: kw, name: 'Fließgewässer-WP' });
    }
  }
  return out;
}

function getAllWaermePoints(year) {
  return [...getWaermeLastpunkte(year), ...getWaermeErzeugerpunkte()];
}

// ── Helpers (Render-Logik portiert aus 15j) ─────────────────────────────────
function metersToPixels(meters, lat) {
  const zoom = map.getZoom();
  const mpp = 156543.03392 * Math.cos((lat || map.getCenter().lat) * Math.PI / 180) / Math.pow(2, zoom);
  return meters / Math.max(mpp, 0.001);
}

// Farbverlauf: load = rot/orange, gen = warmes Grün (Wärme-Erzeuger)
function reliefColor(t, kind) {
  const v = Math.max(0, Math.min(1, t));
  const stops = kind === 'gen'
    ? [[0, [22, 50, 35]],   [0.4,  [102, 187, 106]], [0.7,  [165, 214, 167]], [1, [232, 245, 233]]]
    : [[0, [35, 25, 25]],   [0.35, [255, 167, 38]],  [0.65, [239, 83, 80]],   [1, [183, 28, 28]]];
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
  return kind === 'gen' ? [232, 245, 233] : [183, 28, 28];
}

function buildReliefCanvas(points, kind) {
  const size = map.getSize();
  const w = Math.max(32, size.x);
  const h = Math.max(32, size.y);
  const cfg = WAERME_HEATMAP.reliefCfg;
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
    const sigmaPx = Math.max(14, metersToPixels(cfg.kernelRadiusM || 110, p.lat) * 0.6);
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
  const minAlpha = cfg.minAlpha ?? 0.05;
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

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(gridCanvas, 0, 0, w, h);
  return { canvas: out, maxValue: maxV, field, gw, gh, cellPx };
}

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

// ── Refresh ─────────────────────────────────────────────────────────────────
export function refreshWaermeHeatmapRelief() {
  ensureGroups();
  WAERME_HEATMAP.grpLoad.clearLayers();
  WAERME_HEATMAP.grpGen.clearLayers();
  WAERME_HEATMAP.grpLegacy.clearLayers();
  if (!WAERME_HEATMAP.active) return;
  if (!map.hasLayer(WAERME_HEATMAP.grpLoad)) WAERME_HEATMAP.grpLoad.addTo(map);
  if (!map.hasLayer(WAERME_HEATMAP.grpGen))  WAERME_HEATMAP.grpGen .addTo(map);

  const pts = getAllWaermePoints();
  if (!pts.length) {
    if (typeof window.showHint === 'function') {
      window.showHint('Wärme-Heatmap aktiv, aber keine Lastpunkte/Erzeuger mit Position gefunden. Gebäude mit Heizlast laden bzw. Erzeuger auf der Karte platzieren.', 6000);
    }
    return;
  }
  const bounds = map.getBounds();
  const vis = WAERME_HEATMAP.layerVisibility || { load: true, gen: true };

  if (vis.load !== false) {
    const r = buildReliefCanvas(pts, 'load');
    if (r.maxValue > 0) {
      if (WAERME_HEATMAP.showContours) {
        drawContoursOnCanvas(r.canvas.getContext('2d'),
          r.field, r.gw, r.gh, r.cellPx, r.maxValue, 'rgba(255,235,220,0.95)');
      }
      L.imageOverlay(r.canvas.toDataURL('image/png'), bounds, { opacity: 1, interactive: false })
        .addTo(WAERME_HEATMAP.grpLoad);
    }
  }
  if (vis.gen !== false) {
    const r = buildReliefCanvas(pts, 'gen');
    if (r.maxValue > 0) {
      if (WAERME_HEATMAP.showContours) {
        drawContoursOnCanvas(r.canvas.getContext('2d'),
          r.field, r.gw, r.gh, r.cellPx, r.maxValue, 'rgba(225,245,225,0.95)');
      }
      L.imageOverlay(r.canvas.toDataURL('image/png'), bounds, { opacity: 1, interactive: false })
        .addTo(WAERME_HEATMAP.grpGen);
    }
  }
}

export function refreshWaermeHeatmapLegacy() {
  ensureGroups();
  WAERME_HEATMAP.grpLoad.clearLayers();
  WAERME_HEATMAP.grpGen.clearLayers();
  WAERME_HEATMAP.grpLegacy.clearLayers();
  if (!WAERME_HEATMAP.active) return;
  if (!map.hasLayer(WAERME_HEATMAP.grpLegacy)) WAERME_HEATMAP.grpLegacy.addTo(map);
  const pts = getAllWaermePoints();
  if (pts.length === 0) {
    if (typeof window.showHint === 'function') {
      window.showHint('Wärme-Heatmap aktiv, aber keine Lastpunkte/Erzeuger gefunden.', 6000);
    }
    return;
  }
  const maxPeak = Math.max(...pts.map(p => p.peakKW));
  for (const p of pts) {
    const ratio = maxPeak > 0 ? p.peakKW / maxPeak : 0;
    const r = 30 + Math.sqrt(ratio) * 110;
    if (!isFinite(r) || r <= 0) continue;
    const isGen = p.genKW > p.loadKW;
    const col = isGen
      ? (ratio > 0.66 ? '#2e7d32' : ratio > 0.33 ? '#66bb6a' : '#a5d6a7')
      : (ratio > 0.66 ? '#b71c1c' : ratio > 0.33 ? '#ef5350' : '#ffa726');
    L.circle([p.lat, p.lng], {
      radius: r, color: col, fillColor: col,
      fillOpacity: 0.28, opacity: 0.55, weight: 1,
    }).bindTooltip(`<b>${p.name}</b><br>${(p.peakKW || 0).toFixed(1)} kW`, { direction: 'top' })
      .addTo(WAERME_HEATMAP.grpLegacy);
  }
}

export function refreshWaermeHeatmap() {
  if (WAERME_HEATMAP.mode === 'legacy') refreshWaermeHeatmapLegacy();
  else refreshWaermeHeatmapRelief();
}

// ── Public API ─────────────────────────────────────────────────────────────
export function waermeHeatmapToggle(show) {
  WAERME_HEATMAP.active = !!show;
  ensureGroups();
  if (!WAERME_HEATMAP.active) {
    WAERME_HEATMAP.grpLoad.clearLayers();
    WAERME_HEATMAP.grpGen.clearLayers();
    WAERME_HEATMAP.grpLegacy.clearLayers();
    if (map.hasLayer(WAERME_HEATMAP.grpLoad))   map.removeLayer(WAERME_HEATMAP.grpLoad);
    if (map.hasLayer(WAERME_HEATMAP.grpGen))    map.removeLayer(WAERME_HEATMAP.grpGen);
    if (map.hasLayer(WAERME_HEATMAP.grpLegacy)) map.removeLayer(WAERME_HEATMAP.grpLegacy);
  } else {
    refreshWaermeHeatmap();
  }
  // Button-Status visuell anpassen
  const btn = document.getElementById('btn-waerme-heatmap');
  if (btn) btn.classList.toggle('active', WAERME_HEATMAP.active);
}

export function isWaermeHeatmapActive() { return !!WAERME_HEATMAP.active; }

export function uiToggleWaermeHeatmap() {
  waermeHeatmapToggle(!WAERME_HEATMAP.active);
}

// ── Auto-Refresh bei Map-Move/Zoom ─────────────────────────────────────────
function requestWaermeHeatmapRefresh() {
  if (WAERME_HEATMAP.mode === 'legacy') return;  // legacy = Geo-Koordinaten, kein Refresh nötig
  if (!WAERME_HEATMAP.active || WAERME_HEATMAP.refreshPending) return;
  WAERME_HEATMAP.refreshPending = true;
  requestAnimationFrame(() => {
    WAERME_HEATMAP.refreshPending = false;
    refreshWaermeHeatmap();
  });
}

setTimeout(() => {
  if (!map || !map.on) return;
  map.on('moveend', requestWaermeHeatmapRefresh);
  map.on('zoomend', requestWaermeHeatmapRefresh);
  map.on('resize',  requestWaermeHeatmapRefresh);
}, 0);
