// ── trassen-routing.js — Kabelführung entlang der Elektro-Trassen ──
// Reine Funktionen ohne Karten-/DOM-Bezug. Eingabe: trassen = [{ id, pts: [[lat,lng], …] }].
//
// Alle Geometrie läuft in einem lokalen Meter-System (Längengrade mit cos(Breite)
// skaliert). In Grad gerechnet wäre ein Lot auf eine schräge Trasse nicht
// rechtwinklig – die Stichleitung zum Gebäude stünde sichtbar schief.
//
// Der Graph verknüpft Trassen nicht nur an ihren Enden, sondern auch dort, wo
// sie sich kreuzen oder übereinanderliegen (Stützpunkt nahe fremder Trasse).

const R = 6371000;
const RAD = Math.PI / 180;
const EPS_T = 1e-6;

export const KNOTEN_TOL_M = 5;   // Stützpunkt so nah an fremder Trasse → dort verknüpfen
export const ENDE_FANG_M = 20;   // offenes Trassenende fängt sich an fremder Trasse
// Stichleitung abseits der Trasse zählt bei der Wahl der Netzinsel mehrfach: lieber
// 30 m Stich ins Hauptnetz als 190 m schräg über ein kurzes, unverbundenes Trassenstück.
export const STICH_GEWICHT = 4;
const VERSCHMELZ_M = 0.5;        // näher als das: gleicher Knoten statt Querverbindung
const ZELLE_M = 25;

function fussAufStrecke(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx, y = ay + t * dy;
  return { t, x, y, d: Math.hypot(px - x, py - y) };
}

function schnitt(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null; // parallel/kollinear → über Stützpunkte erfasst
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t <= EPS_T || t >= 1 - EPS_T || u <= EPS_T || u >= 1 - EPS_T) return null;
  return { t, u, x: a.x + t * rx, y: a.y + t * ry };
}

function gitter() {
  const zellen = new Map();
  const k = (i, j) => i + ',' + j;
  return {
    einfuegen(idx, x0, y0, x1, y1) {
      for (let i = Math.floor(x0 / ZELLE_M); i <= Math.floor(x1 / ZELLE_M); i++)
        for (let j = Math.floor(y0 / ZELLE_M); j <= Math.floor(y1 / ZELLE_M); j++) {
          const key = k(i, j);
          if (!zellen.has(key)) zellen.set(key, []);
          zellen.get(key).push(idx);
        }
    },
    kandidaten(x0, y0, x1, y1) {
      const out = new Set();
      for (let i = Math.floor(x0 / ZELLE_M); i <= Math.floor(x1 / ZELLE_M); i++)
        for (let j = Math.floor(y0 / ZELLE_M); j <= Math.floor(y1 / ZELLE_M); j++)
          for (const idx of zellen.get(k(i, j)) || []) out.add(idx);
      return out;
    },
  };
}

/** Baut den Routing-Graphen aus den Trassen. Liefert null, wenn keine nutzbare Trasse existiert. */
export function baueTrassenGraph(trassen) {
  const gueltig = (trassen || []).filter(t => Array.isArray(t.pts) && t.pts.length >= 2);
  if (!gueltig.length) return null;
  const ref = gueltig[0].pts[0];
  const cosLat = Math.cos(ref[0] * RAD);
  const hin = p => ({ x: (p[1] - ref[1]) * RAD * R * cosLat, y: (p[0] - ref[0]) * RAD * R });
  const zurueck = p => [ref[0] + p.y / R / RAD, ref[1] + p.x / (R * cosLat) / RAD];

  const knoten = [];
  const knotenIndex = new Map();
  const knotenBei = (x, y) => {
    const key = Math.round(x * 100) + ',' + Math.round(y * 100);
    if (!knotenIndex.has(key)) { knotenIndex.set(key, knoten.length); knoten.push({ x, y }); }
    return knotenIndex.get(key);
  };

  // Stützpunkte und Rohstrecken
  const punkte = []; // { x, y, n, tr, i, ende }
  const strecken = []; // { tr, a, b (Punktindizes), schnitte: [{t, n}] }
  gueltig.forEach((tr, trIdx) => {
    const erste = punkte.length;
    tr.pts.forEach((p, i) => {
      const m = hin(p);
      punkte.push({ ...m, n: knotenBei(m.x, m.y), tr: trIdx, i, ende: i === 0 || i === tr.pts.length - 1 });
    });
    for (let i = 0; i < tr.pts.length - 1; i++) {
      const a = punkte[erste + i], b = punkte[erste + i + 1];
      if (a.n === b.n) continue;
      strecken.push({ tr: trIdx, a: erste + i, b: erste + i + 1, schnitte: [{ t: 0, n: a.n }, { t: 1, n: b.n }] });
    }
  });

  const index = gitter();
  strecken.forEach((s, idx) => {
    const a = punkte[s.a], b = punkte[s.b];
    index.einfuegen(idx, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  });

  const quer = []; // zusätzliche Verbindungskanten [n1, n2]

  // 1. Kreuzungen: beide Strecken bekommen dort einen gemeinsamen Knoten
  strecken.forEach((s, i) => {
    const a = punkte[s.a], b = punkte[s.b];
    for (const j of index.kandidaten(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
      if (j <= i) continue;
      const o = strecken[j];
      if (o.tr === s.tr && (o.a === s.b || o.b === s.a)) continue;
      const x = schnitt(a, b, punkte[o.a], punkte[o.b]);
      if (!x) continue;
      const n = knotenBei(x.x, x.y);
      s.schnitte.push({ t: x.t, n });
      o.schnitte.push({ t: x.u, n });
    }
  });

  // 2. Stützpunkte auf/nahe fremder Trasse (T-Anschluss, übereinanderliegende Trassen),
  //    offene Enden zusätzlich mit größerem Fangradius
  punkte.forEach(p => {
    const radius = p.ende ? ENDE_FANG_M : KNOTEN_TOL_M;
    let nahe = null;     // alle Treffer ≤ KNOTEN_TOL_M
    let bestEnde = null; // bester Treffer für offenes Ende
    for (const j of index.kandidaten(p.x - radius, p.y - radius, p.x + radius, p.y + radius)) {
      const s = strecken[j];
      if (s.tr === p.tr) continue;
      const a = punkte[s.a], b = punkte[s.b];
      const f = fussAufStrecke(p.x, p.y, a.x, a.y, b.x, b.y);
      if (f.d <= KNOTEN_TOL_M) (nahe ||= []).push({ s, f });
      else if (p.ende && f.d <= ENDE_FANG_M && (!bestEnde || f.d < bestEnde.f.d)) bestEnde = { s, f };
    }
    const treffer = nahe || (bestEnde ? [bestEnde] : []);
    for (const { s, f } of treffer) {
      if (f.t <= EPS_T || f.t >= 1 - EPS_T) {
        const nEnde = f.t <= EPS_T ? punkte[s.a].n : punkte[s.b].n;
        if (nEnde !== p.n) quer.push([p.n, nEnde]);
      } else if (f.d <= VERSCHMELZ_M) {
        s.schnitte.push({ t: f.t, n: p.n });
      } else {
        const n = knotenBei(f.x, f.y);
        s.schnitte.push({ t: f.t, n });
        quer.push([p.n, n]);
      }
    }
  });

  // 3. Kanten: jede Strecke an ihren Schnittpunkten zerlegt, plus Querverbindungen
  const kanten = [];
  const kantenIndex = new Map();
  const adj = knoten.map(() => []);
  const kante = (u, v) => {
    if (u === v) return;
    const key = u < v ? u + '|' + v : v + '|' + u;
    if (kantenIndex.has(key)) return;
    const len = Math.hypot(knoten[u].x - knoten[v].x, knoten[u].y - knoten[v].y);
    kantenIndex.set(key, kanten.length);
    adj[u].push({ n: v, len });
    adj[v].push({ n: u, len });
    kanten.push({ u, v, len });
  };
  strecken.forEach(s => {
    s.schnitte.sort((x, y) => x.t - y.t);
    for (let i = 1; i < s.schnitte.length; i++) kante(s.schnitte[i - 1].n, s.schnitte[i].n);
  });
  quer.forEach(([u, v]) => kante(u, v));

  // 4. Zusammenhangskomponenten (Netzinseln)
  const komp = new Int32Array(knoten.length).fill(-1);
  let anzahlKomp = 0;
  for (let s = 0; s < knoten.length; s++) {
    if (komp[s] >= 0 || !adj[s].length) continue;
    const stapel = [s];
    komp[s] = anzahlKomp;
    while (stapel.length) {
      const u = stapel.pop();
      for (const { n } of adj[u]) if (komp[n] < 0) { komp[n] = anzahlKomp; stapel.push(n); }
    }
    anzahlKomp++;
  }

  const kantenGitter = gitter();
  kanten.forEach((k, idx) => {
    const a = knoten[k.u], b = knoten[k.v];
    kantenGitter.einfuegen(idx, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  });

  return { hin, zurueck, knoten, kanten, adj, komp, anzahlKomp, kantenGitter, _fussCache: new Map() };
}

/** Je Netzinsel der nächstgelegene Lotfußpunkt von p (Map komp → Fuß). */
function fuessteJeInsel(g, p) {
  const key = p[0].toFixed(8) + ',' + p[1].toFixed(8);
  if (g._fussCache.has(key)) return g._fussCache.get(key);
  const m = g.hin(p);
  const best = new Map();
  const pruefe = idx => {
    const k = g.kanten[idx];
    const a = g.knoten[k.u], b = g.knoten[k.v];
    const f = fussAufStrecke(m.x, m.y, a.x, a.y, b.x, b.y);
    const c = g.komp[k.u];
    const alt = best.get(c);
    if (!alt || f.d < alt.d) best.set(c, { kante: idx, x: f.x, y: f.y, d: f.d });
  };
  // Erst in der Umgebung suchen; liegt die Trasse weiter weg, alle Kanten prüfen
  const r = 100;
  for (const idx of g.kantenGitter.kandidaten(m.x - r, m.y - r, m.x + r, m.y + r)) pruefe(idx);
  if (best.size < g.anzahlKomp) g.kanten.forEach((_, idx) => pruefe(idx));
  g._fussCache.set(key, best);
  return best;
}

function heapPush(h, e) {
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]]; i = p;
  }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}

/** Kürzester Weg zwischen zwei Lotfußpunkten auf derselben Netzinsel. */
function wegZwischen(g, fA, fB) {
  const kA = g.kanten[fA.kante], kB = g.kanten[fB.kante];
  const abst = (f, n) => Math.hypot(f.x - g.knoten[n].x, f.y - g.knoten[n].y);
  let bestLen = Infinity, bestZiel = null;
  if (fA.kante === fB.kante) { bestLen = Math.hypot(fA.x - fB.x, fA.y - fB.y); bestZiel = 'direkt'; }

  const dist = new Map(), vor = new Map(), fertig = new Set();
  const h = [];
  for (const n of [kA.u, kA.v]) {
    const d = abst(fA, n);
    if (!dist.has(n) || d < dist.get(n)) { dist.set(n, d); heapPush(h, [d, n]); }
  }
  const ziele = new Set([kB.u, kB.v]);
  while (h.length) {
    const [d, u] = heapPop(h);
    if (fertig.has(u)) continue;
    if (d >= bestLen) break;
    fertig.add(u);
    if (ziele.has(u)) {
      const gesamt = d + abst(fB, u);
      if (gesamt < bestLen) { bestLen = gesamt; bestZiel = u; }
    }
    for (const { n, len } of g.adj[u]) {
      const nd = d + len;
      if (!dist.has(n) || nd < dist.get(n)) { dist.set(n, nd); vor.set(n, u); heapPush(h, [nd, n]); }
    }
  }
  if (bestZiel == null) return null;
  const pfad = [];
  if (bestZiel !== 'direkt') for (let n = bestZiel; n != null; n = vor.get(n)) pfad.unshift(n);
  return { len: bestLen, pfad };
}

/**
 * Route von `von` nach `nach` ([lat,lng]) entlang der Trassen: rechtwinklige
 * Stichleitung auf die Trasse, kürzester Weg im Trassennetz, Stich zum Ziel.
 * Sind die Trassen in mehrere Inseln zerfallen, gewinnt die Insel mit den
 * geringsten Kosten (Trassenweg + STICH_GEWICHT × Stichlängen). Liefert [[lat,lng], …] oder null.
 */
export function routeEntlangTrassen(g, von, nach) {
  if (!g) return null;
  const fuesseA = fuessteJeInsel(g, von), fuesseB = fuessteJeInsel(g, nach);
  const inseln = [...fuesseA.keys()].filter(c => fuesseB.has(c))
    .sort((x, y) => (fuesseA.get(x).d + fuesseB.get(x).d) - (fuesseA.get(y).d + fuesseB.get(y).d));
  let best = null;
  for (const c of inseln) {
    const fA = fuesseA.get(c), fB = fuesseB.get(c);
    const stich = STICH_GEWICHT * (fA.d + fB.d);
    if (best && stich + Math.hypot(fA.x - fB.x, fA.y - fB.y) >= best.kosten) continue;
    const weg = wegZwischen(g, fA, fB);
    if (!weg) continue;
    const kosten = stich + weg.len;
    if (!best || kosten < best.kosten) best = { kosten, fA, fB, weg };
  }
  if (!best) return null;

  const mA = g.hin(von), mB = g.hin(nach);
  const roh = [mA, best.fA, ...best.weg.pfad.map(n => g.knoten[n]), best.fB, mB];
  const route = [];
  for (const p of roh) {
    const last = route[route.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > VERSCHMELZ_M) route.push(p);
  }
  // Zielpunkt exakt übernehmen, auch wenn er mit dem Fußpunkt verschmolzen wurde
  if (route.length >= 2) route[route.length - 1] = mB; else route.push(mB);
  route[0] = mA;
  return route.map((p, i) => i === 0 ? [von[0], von[1]] : i === route.length - 1 ? [nach[0], nach[1]] : g.zurueck(p));
}
