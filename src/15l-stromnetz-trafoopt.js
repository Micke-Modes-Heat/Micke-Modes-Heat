// ── 15l-stromnetz-trafoopt.js — Trafo-Optimierung mit Voronoi-Zonen ─────────
// Portiert aus Standalone-Elektroteil (~13458–13970).
// Beinhaltet:
//   - Eigene Voronoi-Implementierung (n² Halbebenen-Clipping, kein external dep)
//   - Nearest-Neighbor-Zuordnung Lastpunkte → Trafos
//   - Visualisierung Bestand-Trafos (Marker mit %-Badge + Voronoi-Zone)
//   - Trafo-Optimierung (k-Means/Auto-k → neue Standort-Vorschläge)
//
// Vereinfachungen vs Standalone:
//   - Keine Erschöpfungsjahr-Analyse (rechnet 26 Jahre Recalcs durch — später)
//   - Keine Kabeltrassen-Verlegung (Standalone-Code rief elNaDrawKabeltrassen)

import { map } from './02b-gebaeude.js';
import { STROMNETZ } from './14b-stromnetz-state.js';
import { getLoadPoints, kMeansCluster, findAutoK,
         groupByProximity, getExistingTrafos,
         recommendedKvaString } from './15i-stromnetz-clustering.js';

const CLUSTER_COLORS = ['#42a5f5','#66bb6a','#ffa726','#ab47bc',
                        '#26c6da','#ef5350','#d4e157','#ec407a','#80cbc4','#ce93d8'];

// ── LayerGroups ─────────────────────────────────────────────────────────────
function ensureGroups() {
  if (!STROMNETZ.grpExistingTrafos) STROMNETZ.grpExistingTrafos = L.layerGroup();
  if (!STROMNETZ.grpKMeans)         STROMNETZ.grpKMeans         = L.layerGroup();
}

// ════════════════════════════════════════════════════════════════════════════
// VORONOI (Halbebenen-Clipping, O(n²))
// ════════════════════════════════════════════════════════════════════════════
function voronoiBBox(pts, padFactor = 0.5, minPad = 0.005) {
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

// Polygon auf Halbebene näher an `a` als an `b` clippen (Sutherland-Hodgman)
function voronoiClip(poly, a, b) {
  const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2;
  const nx = b.lat - a.lat,       ny = b.lng - a.lng;
  const inside = p => (p.lat - mx) * nx + (p.lng - my) * ny <= 0;
  const intersect = (p1, p2) => {
    const d1 = (p1.lat - mx) * nx + (p1.lng - my) * ny;
    const d2 = (p2.lat - mx) * nx + (p2.lng - my) * ny;
    const t  = d1 / (d1 - d2);
    return { lat: p1.lat + t * (p2.lat - p1.lat),
             lng: p1.lng + t * (p2.lng - p1.lng) };
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

// Voronoi-Zellen für seeds in bbox
export function computeVoronoi(seeds, bbox) {
  const bboxPoly = [
    { lat: bbox.minLat, lng: bbox.minLng },
    { lat: bbox.minLat, lng: bbox.maxLng },
    { lat: bbox.maxLat, lng: bbox.maxLng },
    { lat: bbox.maxLat, lng: bbox.minLng },
  ];
  return seeds.map((seed, i) => {
    let poly = [...bboxPoly];
    for (let j = 0; j < seeds.length; j++) {
      if (i === j || poly.length < 3) continue;
      poly = voronoiClip(poly, seed, seeds[j]);
    }
    return { seed, polygon: poly };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// NEAREST-NEIGHBOR-ZUORDNUNG
// ════════════════════════════════════════════════════════════════════════════
export function assignPtsToTrafos(pts, trafos) {
  const zmap = new Map(trafos.map(t => [t.id, {
    trafo: t, pts: [],
    bezugKW: 0, einspeisungKW: 0, peakKW: 0, nettoKW: 0, auslPct: 0, freeKW: 0,
  }]));
  const sqDist = (a, b) => {
    const dlat = a.lat - b.lat, dlng = a.lng - b.lng;
    return dlat*dlat + dlng*dlng;
  };
  for (const p of pts) {
    let nearest = null, nearestD = Infinity;
    for (const t of trafos) {
      const d = sqDist(p, t);
      if (d < nearestD) { nearestD = d; nearest = t; }
    }
    if (nearest) {
      const z = zmap.get(nearest.id);
      z.pts.push(p);
      z.bezugKW       += p.loadKW || 0;
      z.einspeisungKW += p.genKW  || 0;
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

// ════════════════════════════════════════════════════════════════════════════
// VISUALISIERUNG
// ════════════════════════════════════════════════════════════════════════════
export function drawExistingTrafosWithVoronoi(trafos, assignMap) {
  ensureGroups();
  STROMNETZ.grpExistingTrafos.clearLayers();
  if (!map.hasLayer(STROMNETZ.grpExistingTrafos)) STROMNETZ.grpExistingTrafos.addTo(map);
  if (trafos.length === 0) return;

  const allPts = getLoadPoints();
  const bbox   = voronoiBBox([...trafos, ...allPts]);
  const cells  = computeVoronoi(trafos, bbox);

  for (let i = 0; i < trafos.length; i++) {
    const t = trafos[i];
    const z = assignMap.get(t.id);
    const cell = cells[i];
    if (!z || !cell || cell.polygon.length < 3) continue;

    const auslCol = z.auslPct > 100 ? '#ef5350' : z.auslPct > 80 ? '#ffa726' : '#66bb6a';

    L.polygon(cell.polygon.map(p => [p.lat, p.lng]), {
      color: auslCol, fillColor: auslCol,
      fillOpacity: 0.07, opacity: 0.75, weight: 2, dashArray: '5 6',
    }).bindTooltip(`${t.name}: ${z.auslPct}% Auslastung`, { sticky: true })
      .addTo(STROMNETZ.grpExistingTrafos);

    const icon = L.divIcon({
      className: '',
      html: `<div style="background:#1a237e;border:2.5px solid ${auslCol};border-radius:4px;
               width:28px;height:28px;display:flex;flex-direction:column;align-items:center;
               justify-content:center;font-weight:700;color:#fff;
               box-shadow:0 2px 8px rgba(0,0,0,.6);">
               <span style="font-size:10px;line-height:1.1;">T</span>
               <span style="font-size:7px;line-height:1;color:${auslCol};">${z.auslPct}%</span>
             </div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    L.marker([t.lat, t.lng], { icon, zIndexOffset: 700 })
      .bindPopup(
        `<b>🔁 ${t.name}</b> <i style="color:#9e9e9e">(Bestand)</i><br>` +
        `Nennleistung: <b>${t.kVA} kVA</b> = max. ${t.maxKW.toFixed(0)} kW<br>` +
        `Bezug: ${z.bezugKW.toFixed(0)} kW &nbsp;|&nbsp; Einsp.: ${z.einspeisungKW.toFixed(0)} kW<br>` +
        `Auslastung: <b style="color:${auslCol}">${z.auslPct}%</b> &nbsp; Reserve: ${z.freeKW.toFixed(0)} kW<br>` +
        `Versorgte Punkte: ${z.pts.length}`
      ).addTo(STROMNETZ.grpExistingTrafos);
  }
}

export function drawClusterSuggestions(clusters, maxKW, cosPhi = 0.9) {
  ensureGroups();
  STROMNETZ.grpKMeans.clearLayers();
  if (!map.hasLayer(STROMNETZ.grpKMeans)) STROMNETZ.grpKMeans.addTo(map);
  if (clusters.length === 0) return;

  const centroids     = clusters.map(cl => ({ lat: cl.centroid.lat, lng: cl.centroid.lng }));
  const allPtsForBbox = [...getLoadPoints(), ...centroids];
  const vBbox  = voronoiBBox(allPtsForBbox);
  const vCells = computeVoronoi(centroids, vBbox);

  clusters.forEach((cl, i) => {
    const col     = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
    const auslPct = maxKW ? Math.round(cl.peakKW / maxKW * 100) : null;
    const kvaEmpf = recommendedKvaString(cl.peakKW, cosPhi);
    const overload = maxKW && cl.peakKW > maxKW;

    const vCell = vCells[i];
    if (vCell && vCell.polygon.length >= 3) {
      const zoneCol = overload ? '#ef5350' : col;
      L.polygon(vCell.polygon.map(p => [p.lat, p.lng]), {
        color: zoneCol, fillColor: zoneCol,
        fillOpacity: 0.07, opacity: 0.55, weight: overload ? 3 : 2, dashArray: '7 4',
      }).bindTooltip(
        `Zone ${i+1}: ${cl.bezugKW.toFixed(0)} kW Bezug / ${cl.einspeisungKW.toFixed(0)} kW Einsp. · ${cl.points.length} Punkte`,
        { sticky: true })
        .addTo(STROMNETZ.grpKMeans);
    }

    const isWhale = !!cl.isWhale;
    const markerBg = isWhale ? '#ffa726' : (overload ? '#ef5350' : col);
    const tIcon = L.divIcon({
      className: '',
      html: `<div style="background:${markerBg};border:2px solid #fff;border-radius:50%;
               width:24px;height:24px;display:flex;align-items:center;justify-content:center;
               font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);">
               ${isWhale ? 'D' : 'T'}</div>`,
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    L.marker([cl.centroid.lat, cl.centroid.lng], { icon: tIcon, zIndexOffset: 500 })
      .bindPopup(
        `<b>${isWhale ? '⚡ Direktanschluss' : `Trafo-Standort ${i+1}`}</b><br>` +
        (isWhale ? `<span style="color:#ffa726">Einzellast überschreitet Trafo-Kapazität – Direktanschluss oder Parallel-Trafos erforderlich</span><br>` : '') +
        `Bezug: <b>${cl.bezugKW.toFixed(0)} kW</b><br>` +
        `Einspeisung: <b>${cl.einspeisungKW.toFixed(0)} kW</b><br>` +
        `Maßgebend: <b>${cl.peakKW.toFixed(0)} kW</b><br>` +
        (auslPct != null ? `Auslastung: <b style="color:${auslPct>100?'#ef5350':auslPct>80?'#ffa726':'#66bb6a'}">${auslPct}%</b><br>` : '') +
        `Empf. Trafo: <b>${kvaEmpf}</b><br>` +
        `Punkte: ${cl.points.length}`
      ).addTo(STROMNETZ.grpKMeans);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// HAUPTFUNKTION: Trafo-Optimierung
// ════════════════════════════════════════════════════════════════════════════
// opts: {
//   useExisting: bool — bestehende Trafos einbeziehen (Standardwert true)
//   maxKVA:      Standard-Trafo-Größe (Default 630)
//   cosPhi:      Default 0.9
//   gzf:         Gleichzeitigkeitsfaktor (Default 0.7)
//   minUtilPct:  Minimale Auslastung der Cluster (Default 25)
//   proxRadius:  m — Punkte innerhalb radius zu NSHV-Gruppe vereinen (Default 0)
//   mode:        'auto' (Auto-k) | 'manual' (festes k)
//   k:           bei mode='manual'
// }
export function runTrafoOptimierung(opts = {}) {
  const cfg = {
    useExisting: opts.useExisting !== false,
    maxKVA:      opts.maxKVA      || 630,
    cosPhi:      opts.cosPhi      ?? 0.9,
    gzf:         opts.gzf         ?? 0.7,
    minUtilPct:  opts.minUtilPct  ?? 25,
    proxRadius:  opts.proxRadius  ?? 0,
    mode:        opts.mode        || 'auto',
    k:           opts.k           || 3,
  };

  const allPts = getLoadPoints();
  if (allPts.length === 0) {
    return { ok: false, error: 'Keine aktiven Lastpunkte gefunden.' };
  }

  // Bestand-Trafos
  let assignMap = null, existingT = [];
  if (cfg.useExisting) {
    existingT = getExistingTrafos(undefined, cfg.cosPhi);
    if (existingT.length > 0) {
      assignMap = assignPtsToTrafos(allPts, existingT);
      drawExistingTrafosWithVoronoi(existingT, assignMap);
    }
  }
  if (existingT.length === 0) {
    ensureGroups();
    STROMNETZ.grpExistingTrafos.clearLayers();
  }

  // Welche Punkte brauchen einen NEUEN Trafo?
  let ptsForKmeans = allPts;
  if (existingT.length > 0 && assignMap) {
    const overloadedPts = new Set();
    for (const [, z] of assignMap) {
      if (z.auslPct > 100) z.pts.forEach(p => overloadedPts.add(p.id));
    }
    ptsForKmeans = allPts.filter(p => overloadedPts.has(p.id));
  }
  if (ptsForKmeans.length === 0) {
    ensureGroups();
    STROMNETZ.grpKMeans.clearLayers();
    return { ok: true, allServed: true, existingCount: existingT.length, clusters: [] };
  }

  // Vorgruppierung + k-Means
  const weighted = ptsForKmeans.map(p => ({ ...p, weight: p.peakKW }));
  const grouped  = groupByProximity(weighted, cfg.proxRadius).map(p => ({
    ...p,
    peakKW: Math.max(p.loadKW || 0, p.genKW || 0),
    netKW:  (p.loadKW || 0) - (p.genKW || 0),
    weight: Math.max(p.loadKW || 0, p.genKW || 0),
  }));

  let clusters, maxKW = null, info = null;
  if (cfg.mode === 'auto') {
    const r = findAutoK(grouped, cfg.maxKVA, cfg.cosPhi, cfg.gzf, cfg.minUtilPct);
    clusters = r.clusters;
    maxKW    = r.maxKW;
    info = { mode: 'auto', k: r.k, maxKVA: cfg.maxKVA, maxKW,
             whaleCount: r.whaleCount, normalK: r.normalK,
             capacityExceeded: !!r.capacityExceeded,
             onlyOverflow: existingT.length > 0 };
  } else {
    clusters = kMeansCluster(grouped, cfg.k, 150, 5, cfg.gzf);
    maxKW    = cfg.maxKVA * cfg.cosPhi;
    info     = { mode: 'manual', k: cfg.k, maxKVA: cfg.maxKVA, maxKW };
  }

  drawClusterSuggestions(clusters, maxKW, cfg.cosPhi);

  return { ok: true, clusters, maxKW, info,
           existingCount: existingT.length,
           ptsForKmeansCount: ptsForKmeans.length };
}

// ── Cluster-Layer + Bestand-Layer löschen ───────────────────────────────────
export function clearTrafoOptimierung() {
  ensureGroups();
  STROMNETZ.grpKMeans.clearLayers();
  STROMNETZ.grpExistingTrafos.clearLayers();
  if (map.hasLayer(STROMNETZ.grpKMeans))         map.removeLayer(STROMNETZ.grpKMeans);
  if (map.hasLayer(STROMNETZ.grpExistingTrafos)) map.removeLayer(STROMNETZ.grpExistingTrafos);
}
