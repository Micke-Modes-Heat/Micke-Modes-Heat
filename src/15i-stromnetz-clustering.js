// ── 15i-stromnetz-clustering.js — Lastpunkte + k-Means + Auto-k ─────────────
// Portiert aus Standalone-Elektroteil (~12692, 13001–13694).
// Phase 3.6 (Teil 1): pure Algorithmen für Trafo-Optimierung.
// Heatmap-Render und Voronoi-Zonen (visuell, Phase 3.6 Teil 2) kommen später.
//
// API:
//   getLoadPoints(year)          → Array von Verbrauchern/Erzeugern
//   groupByProximity(pts, m)     → Punkte innerhalb radiusM zu NSHV-Gruppe vereinen
//   kMeansCluster(pts, k, ...)   → k-Means++ gewichtet, mehrere Läufe
//   findAutoK(pts, kVA, cosPhi)  → minimales k bei dem alle Cluster ≤ Kapazität
//   mergeUnderloadedClusters     → Cluster < minUtil mit Nachbarn vereinen
//   getExistingTrafos(year)      → Bestand-Trafos mit Kapazität
//   recommendedKvaString(peak)   → '250/400/630/1000 kVA' oder 'N×1000 kVA'

import { globalYear } from './01-globals-varianten.js';
import { getAssetStatus } from './13a-assets-core.js';
import { getEffectiveAssetProps } from './14b-stromnetz-state.js';
import { getMergedAssets } from './15e-stromnetz-szenarien.js';

// ════════════════════════════════════════════════════════════════════════════
// LASTPUNKTE
// ════════════════════════════════════════════════════════════════════════════
// Verbraucher/PV/WP/Lade als {lat, lng, loadKW, genKW, peakKW, netKW, ...}
// peakKW = max(load, gen) — Trafo muss beide Richtungen tragen.
export function getLoadPoints(year) {
  const yr = year || globalYear || new Date().getFullYear();
  const out = [];
  for (const a of getMergedAssets()) {
    if (getAssetStatus(a, yr) !== 'active') continue;
    const ep = getEffectiveAssetProps(a, yr).props;
    let loadKW = 0, genKW = 0;
    switch (a.type) {
      case 'Verbraucher': loadKW = parseFloat(ep.leistungKW) || 0; break;
      case 'Lade':        loadKW = (parseInt(ep.anzahlPunkte) || 1) * (parseFloat(ep.leistungProPunktKW) || 11); break;
      case 'WP':          loadKW = parseFloat(ep.leistungKW) || 0; break;
      case 'Nsa':         loadKW = parseFloat(ep.leistungKW) || 0; break;
      case 'PV':          genKW  = (parseFloat(ep.leistungKWp) || 0) * 0.8; break;  // konsistent mit Recalc
      case 'Batterie':    genKW  = parseFloat(ep.leistungKW) || 0; break;
    }
    const peakKW = Math.max(loadKW, genKW);
    if (peakKW > 0 && a.lat != null && a.lng != null && isFinite(a.lat) && isFinite(a.lng)) {
      out.push({
        lat: a.lat, lng: a.lng, loadKW, genKW, peakKW,
        netKW: loadKW - genKW,
        name: a.name, id: a.id, type: a.type,
        weight: peakKW,  // für gewichteten k-Means
      });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// RÄUMLICHE VORGRUPPIERUNG (NSHV-Bildung)
// ════════════════════════════════════════════════════════════════════════════
// Punkte innerhalb radiusM (Haversine) werden zu einer NSHV-Gruppe vereint.
// Schwerpunkt nach peakKW gewichtet.
export function groupByProximity(points, radiusM) {
  if (!radiusM || radiusM <= 0) return points;

  function distM(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const x = sinLat * sinLat +
              Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
              sinLng * sinLng;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  const used = new Array(points.length).fill(false);
  const result = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const group = [points[i]];
    for (let j = i + 1; j < points.length; j++) {
      if (!used[j] && distM(points[i], points[j]) <= radiusM) {
        group.push(points[j]);
        used[j] = true;
      }
    }
    used[i] = true;
    if (group.length === 1) { result.push(group[0]); continue; }
    const totalW = group.reduce((s, p) => s + (p.peakKW || 1), 0) || 1;
    const loadKW = group.reduce((s, p) => s + (p.loadKW || 0), 0);
    const genKW  = group.reduce((s, p) => s + (p.genKW  || 0), 0);
    const peakKW = Math.max(loadKW, genKW);
    result.push({
      lat:    group.reduce((s, p) => s + p.lat * (p.peakKW || 1), 0) / totalW,
      lng:    group.reduce((s, p) => s + p.lng * (p.peakKW || 1), 0) / totalW,
      loadKW, genKW, peakKW,
      netKW:  loadKW - genKW,
      weight: peakKW,
      name:   `NSHV-Gruppe (${group.length} Pkt.)`,
      id:     group[0].id,
      type:   group[0].type,
      _group: group,
    });
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// k-MEANS-CLUSTERING (gewichtet, k-Means++)
// ════════════════════════════════════════════════════════════════════════════
// runs > 1 → mehrere Läufe mit probabilistischer Init, bestes Ergebnis
// (minimaler Maximal-Cluster-Peak) wird zurückgegeben.
// gzf = Gleichzeitigkeitsfaktor (auf peakKW)
export function kMeansCluster(points, k, maxIter = 150, runs = 1, gzf = 1.0) {
  if (points.length === 0) return [];
  k = Math.min(k, points.length);

  function sqDist(a, b) {
    const dlat = a.lat - b.lat, dlng = a.lng - b.lng;
    return dlat * dlat + dlng * dlng;
  }

  function singleRun(useRandom) {
    // Initialisierung
    const centroids = [];
    if (!useRandom) {
      // Deterministisch: 1. Centroid = gewichteter Schwerpunkt, dann farthest-point
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
      // Probabilistisch k-Means++
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

    // Iterationen (Lloyd's algorithm)
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
        if (Math.abs(newLat - centroids[i].lat) > 1e-10 ||
            Math.abs(newLng - centroids[i].lng) > 1e-10) changed = true;
        centroids[i] = { lat: newLat, lng: newLng };
      }
      if (!changed) break;
    }

    // Cluster-Statistik
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

  // Mehrere Läufe — bestes Ergebnis (minimaler Max-Peak) wählen
  let best = null, bestMaxLoad = Infinity;
  for (let r = 0; r < runs; r++) {
    const cls    = singleRun(r > 0);
    const filled = cls.filter(cl => cl.points.length > 0);
    const maxLoad = filled.length > 0 ? Math.max(...filled.map(cl => cl.peakKW)) : 0;
    if (maxLoad < bestMaxLoad) { bestMaxLoad = maxLoad; best = cls; }
  }
  best.sort((a, b) => b.peakKW - a.peakKW);
  return best;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTO-k: minimales k bei dem alle Cluster ≤ maxKW
// ════════════════════════════════════════════════════════════════════════════
// Großverbraucher (>maxKW) werden vorab als Direktanschluss isoliert.
// Wenn capacityExceeded === true: selbst bei maxK noch überlastete Zonen.
export function findAutoK(allPts, maxKVA, cosPhi, gzf = 1.0, minUtilPct = 0) {
  const maxKW  = maxKVA * cosPhi;
  const whales = allPts.filter(p => p.peakKW > maxKW);
  const normals = allPts.filter(p => p.peakKW <= maxKW);

  const whaleClusters = whales.map(p => ({
    centroid: { lat: p.lat, lng: p.lng },
    points: [p],
    bezugKW: p.loadKW, einspeisungKW: p.genKW,
    peakKW_raw: p.peakKW, peakKW: p.peakKW * gzf,
    nettoKW: p.netKW, totalKW: p.loadKW,
    isWhale: true,
  }));

  if (normals.length === 0) {
    const merged = mergeUnderloadedClusters(whaleClusters, maxKW, minUtilPct / 100, gzf);
    return { clusters: merged, k: merged.length, maxKW, whaleCount: whales.length, normalK: 0 };
  }

  const RUNS = 5;
  const maxK = Math.min(normals.length, 20);
  for (let k = 1; k <= maxK; k++) {
    const cls      = kMeansCluster(normals, k, 150, RUNS, gzf);
    const nonEmpty = cls.filter(cl => cl.points.length > 0);
    if (nonEmpty.every(cl => cl.peakKW <= maxKW)) {
      const merged = mergeUnderloadedClusters([...whaleClusters, ...nonEmpty], maxKW, minUtilPct / 100, gzf);
      return { clusters: merged, k: merged.length, maxKW,
               whaleCount: whales.length, normalK: merged.length - whaleClusters.length };
    }
  }

  // Fallback: trotz maxK überschritten
  const cls      = kMeansCluster(normals, maxK, 150, RUNS, gzf);
  const nonEmpty = cls.filter(cl => cl.points.length > 0);
  const merged   = mergeUnderloadedClusters([...whaleClusters, ...nonEmpty], maxKW, minUtilPct / 100, gzf);
  return { clusters: merged, k: merged.length, maxKW,
           whaleCount: whales.length, normalK: merged.length - whaleClusters.length,
           capacityExceeded: true };
}

// ── Cluster mit < minUtilFrac mit nächstem Nachbarn vereinen (iterativ) ─────
export function mergeUnderloadedClusters(clusters, maxKW, minUtilFrac, gzf) {
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
          const d = dlat * dlat + dlng * dlng;
          if (d < bestDist) { bestDist = d; bestJ = j; }
        }
      }
      if (bestJ < 0) continue;
      const a = result[i], b = result[bestJ];
      const mergedPts = [...a.points, ...b.points];
      const totalW = mergedPts.reduce((s, p) => s + (p.peakKW || 1), 0) || 1;
      const merged = {
        points: mergedPts,
        bezugKW: a.bezugKW + b.bezugKW,
        einspeisungKW: a.einspeisungKW + b.einspeisungKW,
        peakKW_raw: (a.peakKW_raw || a.peakKW) + (b.peakKW_raw || b.peakKW),
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

// ════════════════════════════════════════════════════════════════════════════
// BESTEHENDE TRAFOS
// ════════════════════════════════════════════════════════════════════════════
export function getExistingTrafos(year, cosPhi = 0.9) {
  const yr = year || globalYear || new Date().getFullYear();
  const res = [];
  for (const a of getMergedAssets()) {
    if (a.type !== 'Trafo') continue;
    if (getAssetStatus(a, yr) !== 'active') continue;
    if (a.lat == null || a.lng == null) continue;
    const ep  = getEffectiveAssetProps(a, yr).props;
    const kVA = parseFloat(ep.leistungKVA) || 630;
    res.push({ id: a.id, name: a.name, lat: a.lat, lng: a.lng,
               kVA, maxKW: kVA * cosPhi });
  }
  return res;
}

// ── Empfohlene Trafo-Größe als lesbarer String ──────────────────────────────
export function recommendedKvaString(peakKW, cosPhi = 0.9) {
  const s = peakKW / cosPhi;
  if (s <= 250)  return '250 kVA';
  if (s <= 400)  return '400 kVA';
  if (s <= 630)  return '630 kVA';
  if (s <= 1000) return '1000 kVA';
  const n = Math.ceil(s / 1000);
  return `${n}× 1000 kVA`;
}
