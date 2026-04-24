// ── 14c-stromnetz-graph.js — Trassen-Graph für Routing ──────────────────────
// Portiert aus Standalone-Elektroteil (~5146–5290).
// Baut aus STROMNETZ.trassen einen ungerichteten Graph, inkl. Cross-Trassen-Snapping
// (Enden, die <8m an eine andere Trasse reichen, werden verbunden).
// Dijkstra zum Pfadsuchen. elRoute (A→B mit Trassen-Einstiegen) kommt in Phase 3.2.

import { STROMNETZ } from './14b-stromnetz-state.js';

// ── Geometrie-Hilfsfunktionen ───────────────────────────────────────────────
export function ptDist(a, b) {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
}

// Projiziere Punkt P auf Segment AB → {t, pt:[lat,lng]}, t in [0,1]
export function projOnSeg(p, a, b) {
  const ax = a[1], ay = a[0];
  const bx = b[1], by = b[0];
  const px = p[1], py = p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 < 1e-18) return { t: 0, pt: a };
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
  return { t, pt: [ay + t*dy, ax + t*dx] };
}

// ── Graph aus allen Trassen bauen ───────────────────────────────────────────
// Schritt 1: Kanten aus allen Trassen-Segmenten
// Schritt 2: Trassen-Enden, die < SNAP_M an ein anderes Trassen-Segment kommen,
//            werden per Cross-Snap verbunden (Projektion auf Segment).
//            Alle Snaps auf dasselbe Segment werden gesammelt und als sortierte
//            Kette A→sn1→sn2→…→B eingebaut (vermeidet Doppel-Split-Bug).
export function buildTrassenGraph() {
  const SNAP_M = 8;  // m — Toleranz für Cross-Trassen-Verbindung
  const nodeMap = new Map();
  const key = pt => pt[0].toFixed(7) + ',' + pt[1].toFixed(7);

  function getNode(pt) {
    const k = key(pt);
    if (!nodeMap.has(k)) nodeMap.set(k, { id: k, lat: pt[0], lng: pt[1], adj: [] });
    return nodeMap.get(k);
  }

  function addEdge(nA, nB, segPts) {
    const d = ptDist([nA.lat, nA.lng], [nB.lat, nB.lng]);
    if (!nA.adj.some(a => a.toKey === nB.id)) nA.adj.push({ toKey: nB.id, dist: d, segPts });
    if (!nB.adj.some(a => a.toKey === nA.id)) nB.adj.push({ toKey: nA.id, dist: d, segPts: [...segPts].reverse() });
  }

  // Schritt 1: Basis-Graph aus allen Trassen-Segmenten
  for (const tr of STROMNETZ.trassen) {
    for (let i = 0; i < tr.pts.length - 1; i++) {
      addEdge(getNode(tr.pts[i]), getNode(tr.pts[i+1]), [tr.pts[i], tr.pts[i+1]]);
    }
  }

  // Schritt 2: Trassen-Enden auf fremde Trassen snappen
  // Snaps pro Segment sammeln, dann sortiert als Kette einbauen.
  const snapsBySegment = new Map();

  for (const tr of STROMNETZ.trassen) {
    const endpoints = [tr.pts[0], tr.pts[tr.pts.length - 1]];
    for (const ep of endpoints) {
      const kEp = key(ep);
      const nEp = nodeMap.get(kEp);
      if (!nEp) continue;

      let best = null;
      for (const other of STROMNETZ.trassen) {
        if (other.id === tr.id) continue;
        for (let i = 0; i < other.pts.length - 1; i++) {
          const { pt: proj, t } = projOnSeg(ep, other.pts[i], other.pts[i+1]);
          const d = ptDist(ep, proj);
          if (d < SNAP_M && (!best || d < best.d)) {
            best = { d, proj, t, ptA: other.pts[i], ptB: other.pts[i+1], otherId: other.id, segIdx: i };
          }
        }
      }
      if (!best) continue;

      const segKey = `${best.otherId}:${best.segIdx}`;
      if (!snapsBySegment.has(segKey)) {
        snapsBySegment.set(segKey, { ptA: best.ptA, ptB: best.ptB, snaps: [] });
      }
      snapsBySegment.get(segKey).snaps.push({ t: best.t, proj: best.proj, kEp, nEp });
    }
  }

  // Pro Segment: Snap-Knoten nach t sortieren, Original-Kante A↔B durch Kette ersetzen
  for (const { ptA, ptB, snaps } of snapsBySegment.values()) {
    const kA = key(ptA), kB = key(ptB);
    const nA = nodeMap.get(kA), nB = nodeMap.get(kB);
    if (!nA || !nB) continue;

    // Original-Kante A↔B raus (wird durch Kette ersetzt)
    nA.adj = nA.adj.filter(a => a.toKey !== kB);
    nB.adj = nB.adj.filter(a => a.toKey !== kA);

    // Nur Interior-Snaps (t nicht ~0/1) bilden die Kette; Vertex-Snaps nur Querverbindung
    const interior = [];
    for (const { t, proj, kEp, nEp } of snaps) {
      if (t < 1e-5) {
        if (kEp !== kA) addEdge(nEp, nA, [proj, ptA]);
      } else if (t > 1 - 1e-5) {
        if (kEp !== kB) addEdge(nEp, nB, [proj, ptB]);
      } else {
        const kP = key(proj);
        if (!nodeMap.has(kP)) nodeMap.set(kP, { id: kP, lat: proj[0], lng: proj[1], adj: [] });
        const nP = nodeMap.get(kP);
        if (kEp !== kP) addEdge(nEp, nP, [proj, proj]); // Querverbindung ep↔snap
        if (!interior.some(s => s.k === kP)) interior.push({ k: kP, n: nP, t });
      }
    }

    // Kette aufbauen: A → sn_sorted[0] → … → sn_sorted[n] → B
    interior.sort((a, b) => a.t - b.t);
    let prevKey = kA, prevNode = nA;
    for (const { k, n } of interior) {
      if (prevKey !== k) addEdge(prevNode, n, [[prevNode.lat, prevNode.lng], [n.lat, n.lng]]);
      prevKey = k;
      prevNode = n;
    }
    if (prevKey !== kB) addEdge(prevNode, nB, [[prevNode.lat, prevNode.lng], ptB]);
  }

  return nodeMap;
}

// ── Nächste Projektion eines Punkts auf eine Trasse ─────────────────────────
// Liefert {trasseId, segIdx, pt:[lat,lng], dist} oder null falls keine Trassen.
export function closestOnTrasse(lat, lng) {
  const p = [lat, lng];
  let best = null;
  for (const tr of STROMNETZ.trassen) {
    for (let i = 0; i < tr.pts.length - 1; i++) {
      const { pt } = projOnSeg(p, tr.pts[i], tr.pts[i+1]);
      const d = ptDist(p, pt);
      if (!best || d < best.dist) best = { trasseId: tr.id, segIdx: i, pt, dist: d };
    }
  }
  return best;
}

// ── Dijkstra: kürzester Pfad im Trassen-Graph ───────────────────────────────
// nodeMap: wie von buildTrassenGraph() geliefert.
// Rückgabe: Array von [lat,lng] oder null falls nicht erreichbar.
export function dijkstra(nodeMap, startKey, endKey) {
  if (startKey === endKey) {
    const n = nodeMap.get(startKey);
    return n ? [[n.lat, n.lng]] : null;
  }

  const dist = new Map();
  const prev = new Map();
  const vis  = new Set();
  dist.set(startKey, 0);
  const q = [[0, startKey]];

  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, u] = q.shift();
    if (vis.has(u)) continue;
    vis.add(u);
    if (u === endKey) break;

    const node = nodeMap.get(u);
    if (!node) continue;
    for (const { toKey, dist: ed } of node.adj) {
      const nd = d + ed;
      if (!dist.has(toKey) || nd < dist.get(toKey)) {
        dist.set(toKey, nd);
        prev.set(toKey, { from: u });
        q.push([nd, toKey]);
      }
    }
  }

  if (!dist.has(endKey)) return null;

  // Pfad rekonstruieren
  const path = [];
  let cur = endKey;
  while (cur) {
    const node = nodeMap.get(cur);
    if (node) path.unshift([node.lat, node.lng]);
    cur = prev.get(cur)?.from;
  }
  return path;
}
