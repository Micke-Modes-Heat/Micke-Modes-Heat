// ── lib/pv-raster.js — Rechteck-gegen-Polygon-Tests für das PV-Modulraster ──
// Reine Geometrie ohne DOM/Karte, genutzt von placePvModules (03c).
//
// Rechtecke sind achsparallel im (bereits gedrehten) Rasterrahmen:
// { x0, y0, x1, y1 } mit x0 < x1, y0 < y1. Polygone sind Listen von {x, y}.
// Ecken GENAU auf einer Polygonkante entscheidet der Punkt-im-Polygon-Test
// zufällig — Aufrufer ziehen deshalb eine kleine Toleranz ab (03c: 1 mm).
//
// Früher wurde die Belegungsfläche vor dem Rastern um den Randabstand nach
// innen versetzt — über Halbebenen je Kante. Das ist nur für konvexe Polygone
// richtig: bei L-Formen oder Einbuchtungen schneidet die verlängerte Innenkante
// ganze Flügel weg (Katastergrundrisse ergaben so 0 Module auf 300-m²-Dächern).
// Stattdessen prüft rechteckImPolygon das um den Randabstand vergrößerte Modul.

/** Punkt-in-Polygon (Ray-Casting). */
export function punktImPolygon(pt, poly) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) innen = !innen;
  }
  return innen;
}

/**
 * Schneidet die Strecke a–b das OFFENE Rechteck r (Liang–Barsky)? Berührung
 * des Randes zählt nicht — Module dürfen bündig an einer Kante liegen.
 */
export function streckeSchneidetRechteck(a, b, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) { if (q[k] <= 0) return false; continue; }
    const t = q[k] / p[k];
    if (p[k] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else          { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  if (t1 - t0 <= 1e-12) return false;
  // Mittelpunkt des Schnittstücks muss echt innen liegen (nicht nur auf dem Rand)
  const tm = (t0 + t1) / 2, mx = a.x + tm * dx, my = a.y + tm * dy;
  return mx > r.x0 && mx < r.x1 && my > r.y0 && my < r.y1;
}

const _ecken = r => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];

/** Liegt das Rechteck vollständig im (einfachen, auch konkaven) Polygon? */
export function rechteckImPolygon(r, poly) {
  if (!_ecken(r).every(c => punktImPolygon(c, poly))) return false;
  for (let i = 0; i < poly.length; i++) {
    if (streckeSchneidetRechteck(poly[i], poly[(i + 1) % poly.length], r)) return false;
  }
  return true;
}

/** Überlappen sich Rechteck und Polygon (mehr als nur am Rand)? */
export function rechteckTrifftPolygon(r, poly) {
  const mitte = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
  if (punktImPolygon(mitte, poly)) return true;
  if (_ecken(r).some(c => punktImPolygon(c, poly))) return true;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1) return true;   // Polygon ragt hinein
    if (streckeSchneidetRechteck(p, poly[(i + 1) % poly.length], r)) return true;
  }
  return false;
}

/* ── Freie Abschnitte einer Modulreihe ───────────────────────────────────── */

/** Waagerechter Schnitt bei Höhe y: sortierte Innen-Intervalle [a, b]. */
function _schnitt(poly, y) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) out.push([xs[k], xs[k + 1]]);
  return out;
}

/** Schnittmenge zweier sortierter, disjunkter Intervall-Listen. */
function _schneide(A, B) {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const a = Math.max(A[i][0], B[j][0]), b = Math.min(A[i][1], B[j][1]);
    if (b > a) out.push([a, b]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
}

/** Vereinigung beliebiger Intervalle (sortiert, verschmolzen). */
export function vereinigeIntervalle(liste) {
  const s = liste.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of s) {
    const z = out[out.length - 1];
    if (z && a <= z[1]) z[1] = Math.max(z[1], b); else out.push([a, b]);
  }
  return out;
}

/**
 * Alle x, für die die senkrechte Strecke {x}×[y0, y1] ganz im Polygon liegt —
 * als sortierte Intervalle. Zwischen zwei Eckhöhen ändern sich die Schnittkanten
 * linear, daher genügt der Schnitt an den Bandkanten und knapp über/unter jeder
 * Eckhöhe im Band. Damit liegt jedes Rechteck [x0,x1]×[y0,y1] mit [x0,x1] in
 * einem Intervall vollständig im Polygon — auch bei schiefen Kanten und L-Formen.
 */
export function bandIntervalle(poly, y0, y1) {
  if (!poly || poly.length < 3 || !(y1 > y0)) return [];
  const EPS = 1e-7;
  const hoehen = [y0 + EPS, y1 - EPS];
  for (const p of poly) {
    if (p.y > y0 && p.y < y1) hoehen.push(Math.max(y0 + EPS, p.y - EPS), Math.min(y1 - EPS, p.y + EPS));
  }
  let res = null;
  for (const y of hoehen) {
    const s = _schnitt(poly, y);
    res = res ? _schneide(res, s) : s;
    if (!res.length) break;
  }
  return res || [];
}
