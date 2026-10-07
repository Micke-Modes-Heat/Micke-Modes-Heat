// ── lib/trafo-platzierung.js — Rechenkern der Trafo-Platzierung (Netzanalyse) ──
// Rein rechnerisch (kein Leaflet, kein DOM) — 13h-netzanalyse.js liefert Punkte,
// Bestandstrafos und Netzkanten und zeichnet die Ergebnisse.
//
// Punkt:   { id, lat, lng, loadKW, genKW, nVerb, weight }
// Cluster: { centroid, points, bezugKW, einspeisungKW, nVerb, peakKW, nettoKW, totalKW }

import { gzfDIN18015, gzfVDE } from './elektro-formeln.js';

// ── Leistung je Asset — dieselbe Zuordnung wie die Knotenlasten der
//    Stromnetz-Berechnung (05b-stromnetz.js), damit Platzierung und Netzrechnung
//    dieselben Zahlen verwenden. H₂ fehlt dort und ist hier ergänzt.
const zahl = v => parseFloat(v) || 0;
export function netzLeistung(type, props) {
  const p = props || {};
  switch (type) {
    case 'Verbraucher': return { loadKW: zahl(p.leistungKW), genKW: 0 };
    case 'Lade': {
      const gzf = Math.min(1, Math.max(0, parseFloat(p.gleichzeitigFaktor) || 0.3));
      return { loadKW: (parseInt(p.anzahlPunkte) || 8) * (parseFloat(p.leistungProPunktKW) || 11) * gzf
                     + (parseInt(p.anzahlSchnell) || 0) * (parseFloat(p.leistungSchnellKW) || 150), genKW: 0 };
    }
    case 'WP':          return { loadKW: zahl(p.leistungElKW) || zahl(p.leistungKW), genKW: 0 };
    case 'Geo':
    case 'FG':          return { loadKW: zahl(p.leistungElKW), genKW: 0 };
    case 'Stromkessel': return { loadKW: zahl(p.leistungKW), genKW: 0 };
    case 'PV':          return { loadKW: 0, genKW: zahl(p.leistungKWp) * 0.8 };
    case 'Wind':        return { loadKW: 0, genKW: zahl(p.leistungKW) };
    case 'KWK':         return { loadKW: 0, genKW: zahl(p.leistungElKW) };
    // Elektrolyseur bezieht, Brennstoffzelle speist — beide Richtungen als Grenzfall
    case 'H2':          return { loadKW: zahl(p.elektrolyseKW), genKW: zahl(p.brennstoffzelleKW) };
    default:            return { loadKW: 0, genKW: 0 };
  }
}

// ── Gleichzeitigkeitsfaktor — Methoden wie in der Stromnetz-Berechnung ──────
export function gzfNachMethode(methode, n, manuell = 0.6) {
  if (methode === 'keine') return 1.0;
  if (methode === 'manuell') return Math.max(0.1, Math.min(1.0, manuell));
  if (methode === 'vde') return gzfVDE(n);
  return gzfDIN18015(n);
}

// Maßgebende Zonenleistung: der Bezug wird mit dem GZF (abhängig von der Zahl
// der Verbraucher) abgemindert, die Einspeisung zählt voll.
export function zonePeakKW(bezugKW, einspKW, nVerb, gzfFn) {
  return Math.max((bezugKW || 0) * gzfFn(nVerb || 0), einspKW || 0);
}

// ── Abstände ─────────────────────────────────────────────────────────────────
// 1° Länge ist nur cos(φ) × so lang wie 1° Breite — alle Vergleiche laufen mit
// lng × kx, sonst zählen Ost-West-Abstände auf ~48° N rund 1,5-fach.
export function lngScale(pts) {
  let s = 0, n = 0;
  for (const p of pts || []) { if (p && isFinite(p.lat)) { s += p.lat; n++; } }
  return n ? Math.cos((s / n) * Math.PI / 180) : 1;
}
export function sqDistS(a, b, kx) {
  const dlat = a.lat - b.lat, dlng = (a.lng - b.lng) * kx;
  return dlat * dlat + dlng * dlng;
}
export function distM(a, b) {
  const dlat = (b.lat - a.lat) * 111320;
  const dlng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

// ── Zonen-Kennwerte ──────────────────────────────────────────────────────────
const _nv = p => p.nVerb ?? ((p.loadKW || 0) > 0 ? 1 : 0);

export function zoneAusPunkten(points, centroid, gzfFn) {
  const cl = { centroid, points: [...points], bezugKW: 0, einspeisungKW: 0, nVerb: 0 };
  for (const p of points) { cl.bezugKW += p.loadKW || 0; cl.einspeisungKW += p.genKW || 0; cl.nVerb += _nv(p); }
  return _kennwerte(cl, gzfFn);
}
function _kennwerte(cl, gzfFn) {
  cl.totalKW = cl.bezugKW;
  cl.nettoKW = cl.bezugKW - cl.einspeisungKW;
  cl.peakKW  = zonePeakKW(cl.bezugKW, cl.einspeisungKW, cl.nVerb, gzfFn);
  return cl;
}
function _gewMittel(points) {
  const w = p => p.weight || Math.max(p.loadKW || 0, p.genKW || 0) || 1;
  const sw = points.reduce((s, p) => s + w(p), 0) || 1;
  return { lat: points.reduce((s, p) => s + p.lat * w(p), 0) / sw,
           lng: points.reduce((s, p) => s + p.lng * w(p), 0) / sw };
}

// ── Geometrischer Median (Weiszfeld) ─────────────────────────────────────────
// Minimiert die Summe der gewichteten Abstände (≈ Kabellänge) statt der
// quadrierten wie der Schwerpunkt — kabelgünstigerer Standort bei gleicher Zone.
export function geometricMedian(points, initial, maxIter = 60, tol = 1e-9) {
  if (!points || points.length === 0) return initial;
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng };
  const kx = lngScale(points);
  let x = { lat: initial.lat, lng: initial.lng };
  for (let iter = 0; iter < maxIter; iter++) {
    let sumW = 0, sumLat = 0, sumLng = 0, hit = null;
    for (const p of points) {
      const d = Math.sqrt(sqDistS(x, p, kx));
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
export function refineCentroids(clusters) {
  for (const cl of clusters) {
    if (cl.points && cl.points.length > 1) cl.centroid = geometricMedian(cl.points, cl.centroid);
  }
  return clusters;
}

// ── Kapazitätsreparatur ──────────────────────────────────────────────────────
// k-Means teilt nur nach Nähe auf. Liegt danach eine Zone über der Grenze,
// wandern einzelne Punkte in Nachbarzonen mit Reserve — jeweils der Punkt mit
// dem kleinsten Umweg. So reicht oft eine Station weniger als beim reinen
// „k erhöhen, bis alles passt".
export function capacityRepair(clusters, capKW, gzfFn) {
  if (!isFinite(capKW) || clusters.length < 2) return clusters;
  const kx = lngScale(clusters.flatMap(cl => cl.points));
  const d = (p, c) => Math.sqrt(sqDistS(p, c, kx));
  const pk = (b, e, n) => zonePeakKW(b, e, n, gzfFn);
  const maxMoves = clusters.reduce((s, cl) => s + cl.points.length, 0) * 2;
  for (let m = 0; m < maxMoves; m++) {
    let over = null;
    for (const cl of clusters) if (cl.peakKW > capKW + 1e-9 && (!over || cl.peakKW > over.peakKW)) over = cl;
    if (!over) break;
    let best = null;
    for (const p of over.points) {
      const rest = pk(over.bezugKW - (p.loadKW || 0), over.einspeisungKW - (p.genKW || 0), over.nVerb - _nv(p));
      if (rest >= over.peakKW - 1e-9) continue;          // Punkt entlastet die Zone nicht
      for (const cl of clusters) {
        if (cl === over) continue;
        if (pk(cl.bezugKW + (p.loadKW || 0), cl.einspeisungKW + (p.genKW || 0), cl.nVerb + _nv(p)) > capKW + 1e-9) continue;
        const cost = d(p, cl.centroid) - d(p, over.centroid);
        if (!best || cost < best.cost) best = { p, to: cl, cost };
      }
    }
    if (!best) break;
    const { p, to } = best;
    over.points.splice(over.points.indexOf(p), 1);
    over.bezugKW -= p.loadKW || 0; over.einspeisungKW -= p.genKW || 0; over.nVerb -= _nv(p);
    to.points.push(p);
    to.bezugKW += p.loadKW || 0; to.einspeisungKW += p.genKW || 0; to.nVerb += _nv(p);
    _kennwerte(over, gzfFn); _kennwerte(to, gzfFn);
  }
  for (const cl of clusters) if (cl.points.length) cl.centroid = _gewMittel(cl.points);
  return clusters;
}

// ── k-Means (gewichtet, k-Means++-Start, fester Zufallsstartwert) ────────────
// Auswahl unter den Läufen: erst „alle Zonen unter capKW" (sonst kleinste
// Maximallast), dann die kürzeren Wege (Σ Last × Abstand).
export function kMeansCluster(points, k, { maxIter = 150, runs = 5, gzfFn = () => 1, capKW = Infinity } = {}) {
  if (!points || points.length === 0) return [];
  k = Math.max(1, Math.min(k, points.length));
  const kx = lngScale(points);
  const sqDist = (a, b) => sqDistS(a, b, kx);
  // Fester Startwert statt Math.random: gleiche Eingaben → gleiches Ergebnis
  let seed = (0x9E3779B9 ^ (k * 2654435761) ^ points.length) >>> 0;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const wOf = p => p.weight || 0;

  function singleRun(useRandom) {
    const centroids = [];
    if (!useRandom) {
      centroids.push(_gewMittel(points));
      while (centroids.length < k) {
        let best = null, bestD = -1;
        for (const p of points) {
          const minD = Math.min(...centroids.map(c => sqDist(p, c)));
          if (minD > bestD) { bestD = minD; best = p; }
        }
        centroids.push({ lat: best.lat, lng: best.lng });
      }
    } else {
      const first = points[Math.floor(rand() * points.length)];
      centroids.push({ lat: first.lat, lng: first.lng });
      while (centroids.length < k) {
        const dists = points.map(p => Math.min(...centroids.map(c => sqDist(p, c))));
        const total = dists.reduce((s, x) => s + x, 0) || 1;
        let r = rand() * total, idx = 0;
        for (; idx < dists.length - 1; idx++) { r -= dists[idx]; if (r <= 0) break; }
        centroids.push({ lat: points[idx].lat, lng: points[idx].lng });
      }
    }
    const nearest = p => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < k; i++) { const dd = sqDist(p, centroids[i]); if (dd < bestD) { bestD = dd; best = i; } }
      return best;
    };
    for (let iter = 0; iter < maxIter; iter++) {
      const buckets = Array.from({ length: k }, () => []);
      for (const p of points) buckets[nearest(p)].push(p);
      let changed = false;
      for (let i = 0; i < k; i++) {
        const pts = buckets[i];
        if (pts.length === 0) continue;
        const sw = pts.reduce((s, p) => s + wOf(p), 0) || 1;
        const newLat = pts.reduce((s, p) => s + p.lat * wOf(p), 0) / sw;
        const newLng = pts.reduce((s, p) => s + p.lng * wOf(p), 0) / sw;
        if (Math.abs(newLat - centroids[i].lat) > 1e-10 || Math.abs(newLng - centroids[i].lng) > 1e-10) changed = true;
        centroids[i] = { lat: newLat, lng: newLng };
      }
      if (!changed) break;
    }
    const buckets = Array.from({ length: k }, () => []);
    for (const p of points) buckets[nearest(p)].push(p);
    const clusters = buckets.map((pts, i) => zoneAusPunkten(pts, centroids[i], gzfFn));
    return capacityRepair(clusters, capKW, gzfFn);
  }

  const cost = cls => cls.reduce((s, cl) => s + cl.points.reduce((t, p) =>
    t + (p.weight || 1) * Math.sqrt(sqDist(p, cl.centroid)), 0), 0);
  let best = null, bestMax = Infinity, bestCost = Infinity, bestOk = false;
  for (let r = 0; r < runs; r++) {
    const cls = singleRun(r > 0);
    const filled = cls.filter(cl => cl.points.length > 0);
    const maxLoad = filled.length ? Math.max(...filled.map(cl => cl.peakKW)) : 0;
    const ok = maxLoad <= capKW + 1e-9;
    const c = cost(filled);
    const better = best === null || (ok && !bestOk) || (ok && bestOk && c < bestCost - 1e-12)
      || (!ok && !bestOk && maxLoad < bestMax);
    if (better) { best = cls; bestMax = maxLoad; bestCost = c; bestOk = ok; }
  }
  best.sort((a, b) => b.peakKW - a.peakKW);
  return best;
}

// ── Unterlastete Zonen zusammenlegen ─────────────────────────────────────────
export function mergeUnderloaded(clusters, maxKW, minUtilFrac, gzfFn) {
  let result = clusters.filter(cl => cl.points.length > 0);
  if (!(minUtilFrac > 0)) return result;
  const kx = lngScale(result.map(cl => cl.centroid));
  let changed = true;
  while (changed) {
    changed = false;
    result.sort((a, b) => a.peakKW - b.peakKW);
    for (let i = 0; i < result.length; i++) {
      if (result[i].peakKW / maxKW >= minUtilFrac) break;
      let bestJ = -1, bestDist = Infinity;
      for (let j = 0; j < result.length; j++) {
        if (j === i) continue;
        const a = result[i], b = result[j];
        if (zonePeakKW(a.bezugKW + b.bezugKW, a.einspeisungKW + b.einspeisungKW, a.nVerb + b.nVerb, gzfFn) > maxKW) continue;
        const dd = sqDistS(a.centroid, b.centroid, kx);
        if (dd < bestDist) { bestDist = dd; bestJ = j; }
      }
      if (bestJ < 0) continue;
      const pts = [...result[i].points, ...result[bestJ].points];
      const merged = zoneAusPunkten(pts, _gewMittel(pts), gzfFn);
      const keep = result.filter((_, idx) => idx !== i && idx !== bestJ);
      result = [...keep, merged];
      changed = true;
      break;
    }
  }
  return result;
}

// ── Großlasten: Punkte, die schon allein über der Grenze liegen ─────────────
export function teileGrosslasten(points, maxKW, gzfFn) {
  const whales = [], normals = [];
  for (const p of points) {
    (zonePeakKW(p.loadKW, p.genKW, _nv(p), gzfFn) > maxKW ? whales : normals).push(p);
  }
  const whaleClusters = whales.map(p => Object.assign(
    zoneAusPunkten([p], { lat: p.lat, lng: p.lng }, gzfFn), { isWhale: true }));
  return { whaleClusters, normals };
}

// Feste Gesamtzahl k: Großlasten bekommen je eine eigene Station, der Rest
// teilt sich k − Großlasten Stationen (mindestens eine, wenn Rest vorhanden).
export function clusterMitK(points, kGesamt, { maxKW = Infinity, gzfFn = () => 1, runs = 5 } = {}) {
  const { whaleClusters, normals } = teileGrosslasten(points, maxKW, gzfFn);
  const kRest = normals.length ? Math.max(1, kGesamt - whaleClusters.length) : 0;
  const rest = kRest ? kMeansCluster(normals, kRest, { runs, gzfFn, capKW: maxKW }) : [];
  return refineCentroids([...whaleClusters, ...rest.filter(cl => cl.points.length > 0)]);
}

// ── Automatische Stationszahl ────────────────────────────────────────────────
export function findAutoK(points, { maxKW, gzfFn = () => 1, minUtilPct = 0, maxK = 20, runs = 5 } = {}) {
  const { whaleClusters, normals } = teileGrosslasten(points, maxKW, gzfFn);
  const fertig = (cls, extra = {}) => {
    const merged = refineCentroids(mergeUnderloaded([...whaleClusters, ...cls], maxKW, minUtilPct / 100, gzfFn));
    return { clusters: merged, k: merged.length, whaleCount: whaleClusters.length,
             normalK: merged.length - whaleClusters.length, ...extra };
  };
  if (normals.length === 0) return fertig([]);
  const kMax = Math.min(normals.length, maxK);
  for (let k = 1; k <= kMax; k++) {
    const cls = kMeansCluster(normals, k, { runs, gzfFn, capKW: maxKW }).filter(cl => cl.points.length > 0);
    if (cls.every(cl => cl.peakKW <= maxKW + 1e-9)) return fertig(cls);
  }
  const cls = kMeansCluster(normals, kMax, { runs, gzfFn, capKW: maxKW }).filter(cl => cl.points.length > 0);
  return fertig(cls, { capacityExceeded: true });
}

// ── Netztopologie: welcher Bestandstrafo versorgt welches Asset? ────────────
// Breitensuche wie in der Knotenpunkt-Analyse (13r): vom Trafo aus nur „abwärts"
// (höherer TYPE_RANK); Infrastruktur wird durchlaufen, alles andere ist Blatt.
// Erreichen mehrere Trafos dasselbe Asset (vermaschte NS-Kabel), gewinnt der nähere.
// rankOf(id) → Rang oder null (Netzknoten ohne Asset), isInfra(id) → bool.
export function topologieZuordnung(trafos, edges, rankOf, isInfra, posOf) {
  const adj = new Map();
  for (const e of edges || []) {
    if (!adj.has(e.u)) adj.set(e.u, []);
    if (!adj.has(e.v)) adj.set(e.v, []);
    adj.get(e.u).push(e.v); adj.get(e.v).push(e.u);
  }
  const map = new Map();
  for (const t of trafos) {
    const startRk = rankOf(t.id) ?? 0;
    const visited = new Set([t.id]);
    const queue = [t.id];
    while (queue.length) {
      const cur = queue.shift();
      for (const nx of adj.get(cur) || []) {
        if (visited.has(nx)) continue;
        visited.add(nx);
        const rk = rankOf(nx);
        if (rk != null && rk <= startRk) continue;     // aufwärts / Nachbartrafo
        if (rk == null || isInfra(nx)) { queue.push(nx); continue; }
        const prev = map.get(nx);
        const pos = posOf?.(nx);
        if (!prev || (pos && distM(pos, t) < distM(pos, trafos.find(x => x.id === prev)))) map.set(nx, t.id);
      }
    }
  }
  return map;
}

// ── Bestand: Lasten den Trafos zuordnen, Überlast über Nachbarn abbauen ─────
// 1. Zuordnung nach Netztopologie, ohne Netzanschluss zum nächsten Trafo —
//    aber nur innerhalb der NS-Reichweite reachM; weiter entfernte Lasten ohne
//    Anschluss gelten als nicht versorgt (ohneTrafo).
// 2. entlasten: Überlastete Trafos geben Punkte an Nachbartrafos mit Reserve
//    ab (kleinster Umweg, höchstens reachM entfernt); was dann noch zu viel ist,
//    wird zusammen mit ohneTrafo zum Überhang — nur der braucht neue Stationen.
export function bestandZuordnen(points, trafos, { topoMap = new Map(), gzfFn = () => 1, entlasten = false, reachM = 400 } = {}) {
  const zonen = new Map(trafos.map(t => [t.id, { trafo: t, pts: [], bezugKW: 0, einspeisungKW: 0, nVerb: 0, viaNetz: 0, zugang: 0, abgang: 0 }]));
  const kx = lngScale(trafos);
  const add = (z, p) => { z.pts.push(p); z.bezugKW += p.loadKW || 0; z.einspeisungKW += p.genKW || 0; z.nVerb += _nv(p); };
  const sub = (z, p) => { z.pts.splice(z.pts.indexOf(p), 1); z.bezugKW -= p.loadKW || 0; z.einspeisungKW -= p.genKW || 0; z.nVerb -= _nv(p); };
  const peak = z => zonePeakKW(z.bezugKW, z.einspeisungKW, z.nVerb, gzfFn);
  const ohneTrafo = [];
  for (const p of points) {
    const viaTopo = topoMap.get(p.id);
    let z = viaTopo != null ? zonen.get(viaTopo) : null;
    if (z) z.viaNetz++;
    else {
      let bestD = Infinity;
      for (const t of trafos) { const dd = sqDistS(p, t, kx); if (dd < bestD) { bestD = dd; z = zonen.get(t.id); } }
      if (z && distM(p, z.trafo) > reachM) { ohneTrafo.push(p); continue; }
    }
    if (z) add(z, p);
  }
  const verschoben = [], ueberhang = entlasten ? [...ohneTrafo] : [];
  if (entlasten) {
    const zs = [...zonen.values()].sort((a, b) => (peak(b) - b.trafo.maxKW) - (peak(a) - a.trafo.maxKW));
    for (const z of zs) {
      let guard = z.pts.length * 2 + 5;
      while (peak(z) > z.trafo.maxKW + 1e-9 && z.pts.length && guard-- > 0) {
        const cur = peak(z);
        let best = null;
        for (const p of z.pts) {
          const rest = zonePeakKW(z.bezugKW - (p.loadKW || 0), z.einspeisungKW - (p.genKW || 0), z.nVerb - _nv(p), gzfFn);
          if (rest >= cur - 1e-9) continue;
          for (const u of zonen.values()) {
            if (u === z) continue;
            const dU = distM(p, u.trafo);
            if (dU > reachM) continue;
            if (zonePeakKW(u.bezugKW + (p.loadKW || 0), u.einspeisungKW + (p.genKW || 0), u.nVerb + _nv(p), gzfFn) > u.trafo.maxKW + 1e-9) continue;
            const cost = dU - distM(p, z.trafo);
            if (!best || cost < best.cost) best = { p, u, cost };
          }
        }
        if (best) { sub(z, best.p); add(best.u, best.p); z.abgang++; best.u.zugang++; verschoben.push({ p: best.p, von: z.trafo.id, nach: best.u.trafo.id }); continue; }
        // Kein Nachbar mit Reserve: entferntesten entlastenden Punkt in den Überhang
        let far = null, farD = -1;
        for (const p of z.pts) {
          const rest = zonePeakKW(z.bezugKW - (p.loadKW || 0), z.einspeisungKW - (p.genKW || 0), z.nVerb - _nv(p), gzfFn);
          if (rest >= cur - 1e-9) continue;
          const dd = distM(p, z.trafo);
          if (dd > farD) { farD = dd; far = p; }
        }
        if (!far) break;
        sub(z, far); z.abgang++; ueberhang.push(far);
      }
    }
  }
  for (const z of zonen.values()) {
    z.peakKW  = peak(z);
    // nach dem Umhängen: wie viele der jetzt versorgten Punkte hängen per Kabel an diesem Trafo
    z.viaNetz = z.pts.filter(p => topoMap.get(p.id) === z.trafo.id).length;
    z.nettoKW = z.bezugKW - z.einspeisungKW;
    z.auslPct = z.trafo.maxKW > 0 ? Math.round(z.peakKW / z.trafo.maxKW * 100) : 0;
    z.freeKW  = Math.max(0, z.trafo.maxKW - z.peakKW);
  }
  return { zonen, verschoben, ueberhang, ohneTrafo };
}

// ── Zonenumriss: gepufferte konvexe Hülle (zeigt die tatsächliche Zuordnung,
//    auch wenn Punkte wegen der Kapazität nicht zur nächsten Station gehören) ──
export function gepufferteHuelle(points, radiusM = 15) {
  if (!points || points.length === 0) return [];
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const mLat = 111320, mLng = 111320 * Math.cos(lat0 * Math.PI / 180);
  const xy = [];
  for (const p of points) {
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      xy.push([p.lng * mLng + radiusM * Math.cos(a), p.lat * mLat + radiusM * Math.sin(a)]);
    }
  }
  xy.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of xy) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = xy.length - 1; i >= 0; i--) { const p = xy[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.map(([x, y]) => ({ lat: y / mLat, lng: x / mLng }));
}
