// ── lib/grundriss-ueberlappung.js — überlappende Gebäudegrundrisse finden ─────
// Rein, ohne DOM. Grundlage von 41-grundriss-pruefung.js.
//
// Überlappende Grundrisse entstehen beim Import (Gebäudeteile als eigene
// Gebäude, OSM und ALKIS doppelt, Neubau über Bestand gezeichnet). Sie
// verfälschen Wärme- und Strombedarf, das Dachpotenzial und die Verschattung
// (ein Modul liegt „im" Nachbargebäude). Je Paar wird die Überlappungsfläche
// bestimmt und eingeordnet:
//   doppelt   — beide Grundrisse decken sich zu ≥ 80 % (Doppelerfassung)
//   enthalten — das kleinere liegt zu ≥ 80 % im größeren (Gebäudeteil)
//   teil      — Teilüberlappung (angrenzende Flügel, Digitalisierungsfehler)
// Kein Konflikt: ein Gebäude ist abgerissen, bevor das andere gebaut wird.

const M_PRO_GRAD = 111320;
export const GU_DECKUNG = 0.8;        // Anteil für „doppelt" bzw. „enthalten"
export const GU_MIN_M2 = 1;           // kleinere Überlappungen …
export const GU_MIN_ANTEIL = 0.01;    // … unter 1 % des kleineren Gebäudes gelten als Zeichenrauschen

/**
 * Äußerer Ring eines Gebäudegrundrisses als [[lng, lat]] — g.polygon ist eine
 * Liste von {lat,lng} oder [lat,lng], ggf. eine Liste von Ringen (mit Löchern).
 */
export function guRing(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return [];
  const istPunkt = q => Array.isArray(q) ? typeof q[0] === 'number' : (q && typeof q.lat === 'number');
  const ring = istPunkt(polygon[0]) ? polygon : polygon[0];
  const pts = (ring || []).map(q => Array.isArray(q) ? [+q[1], +q[0]] : [+q.lng, +q.lat])
    .filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (pts.length > 1) {
    const a = pts[0], z = pts[pts.length - 1];
    if (a[0] === z[0] && a[1] === z[1]) pts.pop();
  }
  return pts;
}

function flaeche(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

function innen(x, y, r) {
  let drin = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/**
 * Überlappungsfläche zweier Ringe in Metern (Rasterzählung, Zellweite an die
 * Größe angepasst — Genauigkeit im Prozentbereich, für die Einordnung genug).
 */
export function guUeberlappungM2(ra, rb) {
  const box = r => r.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity]);
  const A = box(ra), B = box(rb);
  const x0 = Math.max(A[0], B[0]), y0 = Math.max(A[1], B[1]), x1 = Math.min(A[2], B[2]), y1 = Math.min(A[3], B[3]);
  if (x1 <= x0 || y1 <= y0) return 0;
  const h = Math.max(0.1, Math.min(2, Math.sqrt((x1 - x0) * (y1 - y0) / 8000)));
  let n = 0;
  for (let x = x0 + h / 2; x < x1; x += h) {
    for (let y = y0 + h / 2; y < y1; y += h) if (innen(x, y, ra) && innen(x, y, rb)) n++;
  }
  return n * h * h;
}

/**
 * Überlappende Gebäudepaare.
 * @param {{id:any, ring:number[][], baujahr?:number|null, abrissjahr?:number|null}[]} gebs ring in [lng, lat]
 * @param {{ok?: Set<string>}} [opt] ok: Schlüssel bewusst belassener Paare (guSchluessel)
 * @returns {{a:any, b:any, m2:number, anteilA:number, anteilB:number, art:'doppelt'|'enthalten'|'teil', ok:boolean}[]}
 *   schwerste zuerst (doppelt, enthalten, dann nach Anteil am kleineren Gebäude)
 */
export function guUeberlappungen(gebs, opt = {}) {
  const liste = (gebs || []).filter(g => g && Array.isArray(g.ring) && g.ring.length >= 3).map(g => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of g.ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    return { ...g, w, s, e, n };
  }).sort((p, q) => p.w - q.w);
  const ok = opt.ok || new Set();
  const out = [];
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    for (let j = i + 1; j < liste.length && liste[j].w < a.e; j++) {
      const b = liste[j];
      if (b.n <= a.s || b.s >= a.n) continue;
      // Nachfolge: das eine ist abgerissen, bevor das andere steht
      if ((a.abrissjahr && b.baujahr && a.abrissjahr <= b.baujahr) || (b.abrissjahr && a.baujahr && b.abrissjahr <= a.baujahr)) continue;
      const lat0 = (Math.max(a.s, b.s) + Math.min(a.n, b.n)) / 2, lng0 = (Math.max(a.w, b.w) + Math.min(a.e, b.e)) / 2;
      const kx = M_PRO_GRAD * Math.cos(lat0 * Math.PI / 180);
      const xy = r => r.map(([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * M_PRO_GRAD]);
      const ra = xy(a.ring), rb = xy(b.ring);
      const m2 = guUeberlappungM2(ra, rb);
      const fa = flaeche(ra), fb = flaeche(rb);
      if (!(m2 > 0) || !(fa > 0) || !(fb > 0)) continue;
      const anteilA = Math.min(1, m2 / fa), anteilB = Math.min(1, m2 / fb);
      if (m2 < GU_MIN_M2 && Math.max(anteilA, anteilB) < GU_MIN_ANTEIL) continue;
      if (Math.max(anteilA, anteilB) < GU_MIN_ANTEIL) continue;
      const art = anteilA >= GU_DECKUNG && anteilB >= GU_DECKUNG ? 'doppelt'
        : Math.max(anteilA, anteilB) >= GU_DECKUNG ? 'enthalten' : 'teil';
      out.push({ a: a.id, b: b.id, m2, anteilA, anteilB, art, ok: ok.has(guSchluessel(a.id, b.id)) });
    }
  }
  const rang = { doppelt: 0, enthalten: 1, teil: 2 };
  return out.sort((p, q) => rang[p.art] - rang[q.art] || Math.max(q.anteilA, q.anteilB) - Math.max(p.anteilA, p.anteilB));
}

/** Schlüssel eines Paars, unabhängig von der Reihenfolge. */
export function guSchluessel(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return `${x}|${y}`;
}
