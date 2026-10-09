// ── lib/dach-grundriss.js — Dachflächen aus dem Grundriss berechnen ──────────
//
// Für Gebäude ohne LoD2-Modell (fehlende Kachel, geplante Neubauten): aus einem
// rechtwinkligen Grundriss ein plausibles Dach mit einzelnen Dachflächen —
// dieselbe Form, die der LoD2-Import liefert (Fläche je Dachseite mit Neigung
// und Ausrichtung, dazu die Giebelwände), damit PV-Belegung, Ertrag und
// 3D-Ansicht ohne Sonderweg damit arbeiten.
//
// Verfahren („Flügel-Modell", wie Satteldach-Häuser tatsächlich aufgebaut sind):
//   1. Grundriss in der Hauptrichtung achsparallel drehen (Eingabe sollte
//      vorher rechtwinklig ausgerichtet sein — richteRechtwinklig).
//   2. Mit möglichst wenigen größten Rechtecken überdecken (Flügel); jeder
//      Flügel bekommt ein Sattel- bzw. Walmdach entlang seiner Längsachse.
//   3. Ein quer anschließender Nebenflügel endet am First des Hauptflügels
//      (L-, T-, U-Form); läuft er auf beiden Seiten weiter, bleibt er ganz
//      (Kreuzgiebel).
//   4. Dach = in jedem Punkt das höchste Flügeldach. Wo sich zwei Flügel
//      schneiden, entstehen so die Kehlen. Die Dachflächen sind die Bereiche, in
//      denen eine Flügelebene oben liegt — exakt als Polygone berechnet.
//
// Rein, ohne DOM/Karte. Koordinaten lokal in Metern: x Ost, y Nord.
// dachAusGrundrissGebaeude macht dasselbe für ein Gebäude (Grundriss in lat/lng,
// Dachangaben am Gebäude) und liefert die Datenform des LoD2-Imports.

import { richteRechtwinklig } from './gebaeude-geometrie.js';
import { d3dRahmen } from './dach-3d.js';

const RAD = Math.PI / 180;
/** Vorgabeneigung je Dachform — wie getDachDefaultNeigung in 03c. */
const NEIGUNG_VORGABE = { flach: 5, sattel: 35, walm: 30, pult: 15 };
const EPS = 1e-6;

/* ── kleine Geometrie ──────────────────────────────────────────────────────── */

function flaeche(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function imPolygon(x, y, r) {
  let innen = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) innen = !innen;
  }
  return innen;
}

/** Konvexes Polygon auf a·x + b·y + c ≥ 0 beschneiden. */
function klippe(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] + c, fq = a * q[0] + b * q[1] + c;
    if (fp >= -EPS) out.push(p);
    if ((fp >= -EPS) !== (fq >= -EPS)) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out.length >= 3 && Math.abs(flaeche(out)) > 1e-4 ? out : [];
}

const rechteckPoly = r => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
const rechteckHalb = r => [[1, 0, -r.x0], [-1, 0, r.x1], [0, 1, -r.y0], [0, -1, r.y1]];   // a,b,c mit ≥ 0 innen

/* ── 1. Hauptrichtung + Rasterzellen ───────────────────────────────────────── */

function hauptrichtung(pts) {
  let sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]), w = Math.atan2(b[1] - a[1], b[0] - a[0]);
    sx += l * Math.cos(4 * w); sy += l * Math.sin(4 * w);
  }
  return Math.atan2(sy, sx) / 4;
}

function eindeutig(werte, tol = 0.05) {
  const s = [...werte].sort((a, b) => a - b), out = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  return out;
}

/* ── 2. Überdeckung mit größten Rechtecken ─────────────────────────────────── */

function fluegel(ring, minBreite, maxFluegel) {
  const xs = eindeutig(ring.map(p => p[0])), ys = eindeutig(ring.map(p => p[1]));
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];
  const innen = [];
  for (let i = 0; i < nx; i++) {
    innen.push([]);
    for (let j = 0; j < ny; j++) innen[i].push(imPolygon((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, ring) ? 1 : 0);
  }
  // Präfixsummen: Rechteck [i0,i1)×[j0,j1) ganz innen?
  const S = Array.from({ length: nx + 1 }, () => new Array(ny + 1).fill(0));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) S[i + 1][j + 1] = innen[i][j] + S[i][j + 1] + S[i + 1][j] - S[i][j];
  const voll = (i0, i1, j0, j1) => i0 >= 0 && j0 >= 0 && i1 <= nx && j1 <= ny && i1 > i0 && j1 > j0
    && S[i1][j1] - S[i0][j1] - S[i1][j0] + S[i0][j0] === (i1 - i0) * (j1 - j0);
  const kand = [];
  for (let i0 = 0; i0 < nx; i0++) for (let i1 = i0 + 1; i1 <= nx; i1++) {
    for (let j0 = 0; j0 < ny; j0++) for (let j1 = j0 + 1; j1 <= ny; j1++) {
      if (!voll(i0, i1, j0, j1)) break;          // höher wird es auch nicht voll
      if (voll(i0 - 1, i1, j0, j1) || voll(i0, i1 + 1, j0, j1) || voll(i0, i1, j0 - 1, j1) || voll(i0, i1, j0, j1 + 1)) continue;
      const r = { x0: xs[i0], x1: xs[i1], y0: ys[j0], y1: ys[j1], i0, i1, j0, j1 };
      if (Math.min(r.x1 - r.x0, r.y1 - r.y0) >= minBreite) kand.push(r);
    }
  }
  // gierig: jeweils das Rechteck, das die meiste noch offene Fläche deckt
  const offen = innen.map(z => z.slice());
  const zellA = (i, j) => (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  const neu = r => { let a = 0; for (let i = r.i0; i < r.i1; i++) for (let j = r.j0; j < r.j1; j++) if (offen[i][j]) a += zellA(i, j); return a; };
  const out = [];
  while (out.length < maxFluegel) {
    // Gleichstand (z. B. symmetrisches L): größere Gesamtfläche, dann der Flügel
    // entlang der Hauptrichtung (x im gedrehten Rahmen) — eindeutig und stabil
    const besser = (r, b) => {
      const ar = (r.x1 - r.x0) * (r.y1 - r.y0), ab = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (Math.abs(ar - ab) > 1e-6) return ar > ab;
      return (r.x1 - r.x0) >= (r.y1 - r.y0) && (b.x1 - b.x0) < (b.y1 - b.y0);
    };
    let best = null, bestA = 0.5;
    for (const r of kand) {
      const a = neu(r);
      if (a > bestA + 1e-9 || (best && Math.abs(a - bestA) < 1e-9 && besser(r, best))) { best = r; bestA = a; }
    }
    if (!best) break;
    for (let i = best.i0; i < best.i1; i++) for (let j = best.j0; j < best.j1; j++) offen[i][j] = 0;
    out.push({ x0: best.x0, x1: best.x1, y0: best.y0, y1: best.y1 });
  }
  return out;
}

/* ── 3. Firstrichtung + Anschlüsse ─────────────────────────────────────────── */

/**
 * Nebenflügel, die quer über einen früheren Flügel laufen und nur auf einer
 * Seite weitergehen, enden an dessen First. Liegt ein Nebenflügel ganz im
 * früheren, fällt er weg. offenX0/X1/Y0/Y1 = an diesem Ende kein Walm.
 */
function anschluesse(fl) {
  const t = 0.05;
  for (let s = 1; s < fl.length; s++) {
    const S = fl[s];
    for (let p = 0; p < s && !S.weg; p++) {
      const P = fl[p];
      if (P.weg || P.firstX === S.firstX) continue;
      if (P.firstX) {   // P-First entlang x, S quer (First entlang y)
        if (S.x0 < P.x0 - t || S.x1 > P.x1 + t || S.y0 > P.y0 + t || S.y1 < P.y1 - t) continue;
        const unten = S.y0 < P.y0 - t, oben = S.y1 > P.y1 + t, yr = (P.y0 + P.y1) / 2;
        if (oben && !unten) { S.y0 = yr; S.offenY0 = true; }
        else if (unten && !oben) { S.y1 = yr; S.offenY1 = true; }
        else if (!oben && !unten) S.weg = true;
      } else {          // P-First entlang y, S quer (First entlang x)
        if (S.y0 < P.y0 - t || S.y1 > P.y1 + t || S.x0 > P.x0 + t || S.x1 < P.x1 - t) continue;
        const links = S.x0 < P.x0 - t, rechts = S.x1 > P.x1 + t, xr = (P.x0 + P.x1) / 2;
        if (rechts && !links) { S.x0 = xr; S.offenX0 = true; }
        else if (links && !rechts) { S.x1 = xr; S.offenX1 = true; }
        else if (!links && !rechts) S.weg = true;
      }
    }
  }
  return fl.filter(f => !f.weg);
}

/** Dachebenen eines Flügels: h = gx·x + gy·y + h0 (Dach = Minimum). */
function ebenen(F, form, T, traufe) {
  const E = [];
  if (F.firstX) {
    E.push({ gx: 0, gy: T, h0: traufe - T * F.y0 });          // fällt nach Süden (−y)
    E.push({ gx: 0, gy: -T, h0: traufe + T * F.y1 });         // fällt nach Norden
    if (form === 'walm') {
      if (!F.offenX0) E.push({ gx: T, gy: 0, h0: traufe - T * F.x0 });
      if (!F.offenX1) E.push({ gx: -T, gy: 0, h0: traufe + T * F.x1 });
    }
  } else {
    E.push({ gx: T, gy: 0, h0: traufe - T * F.x0 });
    E.push({ gx: -T, gy: 0, h0: traufe + T * F.x1 });
    if (form === 'walm') {
      if (!F.offenY0) E.push({ gx: 0, gy: T, h0: traufe - T * F.y0 });
      if (!F.offenY1) E.push({ gx: 0, gy: -T, h0: traufe + T * F.y1 });
    }
  }
  return E;
}

const hoehe = (e, x, y) => e.gx * x + e.gy * y + e.h0;

/* ── 4. Flächen = Bereiche, in denen eine Ebene oben liegt ─────────────────── */

/** Konvexes K minus konvexes C (als Halbebenen a,b,c ≥ 0) → konvexe Stücke. */
function ohne(K, C) {
  const stuecke = [];
  let rest = K;
  for (const [a, b, c] of C) {
    // entartete Bedingung (deckungsgleiche Ebenen): immer erfüllt → übergehen,
    // nie erfüllt → C ist leer, K bleibt ganz
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) { if (c >= -EPS) continue; return [K]; }
    const aussen = klippe(rest, -a, -b, -c);
    if (aussen.length) stuecke.push(aussen);
    rest = klippe(rest, a, b, c);
    if (!rest.length) return stuecke;
  }
  return stuecke;          // rest liegt in C → entfällt
}

/** Konvexe Stücke derselben Fläche zu Ringen verschmelzen (gemeinsame Kanten heben sich auf). */
function verschmelzen(stuecke) {
  const key = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const ringe = stuecke.map(s => {
    const r = s.map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
    return flaeche(r) < 0 ? r.reverse() : r;
  });
  const alle = ringe.flat();
  // Kanten an T-Stößen teilen
  const kanten = [];
  for (const r of ringe) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      if (l2 < 1e-10) continue;
      const ts = [];
      for (const p of alle) {
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
        if (qx * qx + qy * qy < 1e-8) ts.push(t);
      }
      ts.sort((u, v) => u - v);
      let prev = a;
      for (const t of ts) { const p = [a[0] + t * dx, a[1] + t * dy]; kanten.push([prev, p]); prev = p; }
      kanten.push([prev, b]);
    }
  }
  const zaehl = new Map();
  for (const [a, b] of kanten) { const k = key(a) + '>' + key(b); zaehl.set(k, (zaehl.get(k) || 0) + 1); }
  const rand = kanten.filter(([a, b]) => !zaehl.has(key(b) + '>' + key(a)));
  // Ketten bilden
  const ab = new Map();
  for (const k of rand) { const s = key(k[0]); if (!ab.has(s)) ab.set(s, []); ab.get(s).push(k); }
  const benutzt = new Set(), out = [];
  for (const k0 of rand) {
    if (benutzt.has(k0)) continue;
    const ring = [];
    let k = k0, schutz = 0;
    while (k && !benutzt.has(k) && schutz++ < 10000) {
      benutzt.add(k);
      ring.push(k[0]);
      k = (ab.get(key(k[1])) || []).find(x => !benutzt.has(x));
    }
    // kollineare Punkte entfernen
    const sauber = ring.filter((p, i) => {
      const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length];
      return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-6;
    });
    if (sauber.length >= 3 && flaeche(sauber) > 0.01) out.push(sauber);   // Löcher (negativ) entfallen
  }
  return out;
}

/**
 * Dach aus einem Grundriss.
 * @param {number[][]} grundriss [[x,y]] in Metern (lokal, x Ost, y Nord), möglichst rechtwinklig
 * @param {{ form?:'sattel'|'walm'|'pult'|'flach', neigung?:number, traufe?:number, azimut?:number|null,
 *   minBreite?:number, maxFluegel?:number }} [opt]
 *   azimut: bei einem einzelnen Flügel/Pultdach die gewünschte Fallrichtung (sonst Längsachse)
 * @returns {null | { flaechen: Array<{ ring:number[][], neigung:number, azimut:number, grundM2:number }>,
 *   waende: number[][][], firstH:number, fluegel:number }}
 *   ring = [[x,y,z]] mit z über Gelände. null = Grundriss nicht rechtwinklig genug.
 */
export function dachAusGrundriss(grundriss, opt = {}) {
  const form = opt.form || 'sattel';
  const neigung = Math.max(0, Math.min(75, opt.neigung ?? (form === 'walm' ? 30 : form === 'pult' ? 15 : form === 'flach' ? 0 : 35)));
  const traufe = opt.traufe ?? 6;
  const T = Math.tan(neigung * RAD);
  let pts = grundriss.map(p => [p[0], p[1]]);
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  if (pts.length < 3) return null;
  if (flaeche(pts) < 0) pts.reverse();

  // in die Hauptrichtung drehen
  const th = hauptrichtung(pts), c = Math.cos(th), s = Math.sin(th);
  const hin = p => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
  const zurueck = p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  const roh = pts.map(hin);
  for (let i = 0; i < roh.length; i++) {
    const a = roh[i], b = roh[(i + 1) % roh.length];
    if (Math.min(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) > 0.15) return null;   // schräge Kante
  }
  // Ecken auf gemeinsame Achsen einrasten: nach der Umrechnung aus lat/lng sind
  // die Kanten nur auf Millimeter achsparallel — sonst liegen First- und
  // Kehlpunkte knapp neben den Grundrisskanten und Giebel werden übersehen
  const raster = werte => { const u = eindeutig(werte, 0.05); return v => u.reduce((b, w) => Math.abs(w - v) < Math.abs(b - v) ? w : b, u[0]); };
  const rx = raster(roh.map(p => p[0])), ry = raster(roh.map(p => p[1]));
  const ring = roh.map(p => [rx(p[0]), ry(p[1])]).filter((p, i, r) => {
    const q = r[(i + 1) % r.length];
    return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9;
  });
  if (ring.length < 4) return null;
  const azWelt = (gx, gy) => {           // Fallrichtung (−Gradient) → Kompass
    const [wx, wy] = zurueck([-gx, -gy]);
    return ((Math.atan2(wx, wy) / RAD) % 360 + 360) % 360;
  };

  // Hülle und Höhenfunktion je nach Dachform
  let fl, hoeheBei;
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  if (form === 'flach' || form === 'pult' || T < 1e-6) {
    let e = { gx: 0, gy: 0, h0: traufe };
    if (form === 'pult' && T > 1e-6) {
      // Fallrichtung: vorgegebener Azimut, sonst quer zur Längsachse Richtung Süd
      let az = opt.azimut;
      if (az == null) {
        const quer = (box.x1 - box.x0) >= (box.y1 - box.y0) ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
        const kand = quer.map(([fx, fy]) => { const [wx, wy] = zurueck([fx, fy]); return ((Math.atan2(wx, wy) / RAD) % 360 + 360) % 360; });
        az = Math.abs(kand[0] - 180) <= Math.abs(kand[1] - 180) ? kand[0] : kand[1];
      }
      const [fx, fy] = hin([Math.sin(az * RAD), Math.cos(az * RAD)]);   // Fallrichtung im gedrehten Rahmen
      let sMax = -Infinity;
      for (const p of ring) sMax = Math.max(sMax, p[0] * fx + p[1] * fy);
      e = { gx: -T * fx, gy: -T * fy, h0: traufe + T * sMax };
    }
    fl = [{ ebene: e, stuecke: [ring] }];
    hoeheBei = (x, y) => hoehe(e, x, y);
  } else {
    let F = fluegel(ring, opt.minBreite ?? 2, opt.maxFluegel ?? 8);
    if (!F.length) return null;
    // First entlang der Längsseite; ein einzelner Flügel folgt einem vorgegebenen Azimut
    F.forEach(f => { f.firstX = (f.x1 - f.x0) >= (f.y1 - f.y0); });
    if (F.length === 1 && opt.azimut != null) {
      const [fx, fy] = hin([Math.sin(opt.azimut * RAD), Math.cos(opt.azimut * RAD)]);
      F[0].firstX = Math.abs(fy) >= Math.abs(fx);       // Fall in y-Richtung ⇒ First entlang x
    }
    F = anschluesse(F);
    const E = F.map(f => ebenen(f, form, T, traufe));
    const drin = (f, x, y) => x >= f.x0 - 1e-6 && x <= f.x1 + 1e-6 && y >= f.y0 - 1e-6 && y <= f.y1 + 1e-6;
    hoeheBei = (x, y) => {
      let h = -Infinity;
      F.forEach((f, k) => { if (drin(f, x, y)) h = Math.max(h, Math.min(...E[k].map(e => hoehe(e, x, y)))); });
      return Number.isFinite(h) ? h : traufe;
    };
    fl = [];
    F.forEach((f, k) => {
      E[k].forEach((e, ie) => {
        // Bereich im Flügel, in dem e die niedrigste seiner Ebenen ist
        let K = rechteckPoly(f);
        E[k].forEach((g, ig) => { if (ig !== ie && K.length) K = klippe(K, g.gx - e.gx, g.gy - e.gy, g.h0 - e.h0); });
        if (!K.length) return;
        // minus Bereiche, in denen ein anderer Flügel höher liegt
        let stuecke = [K];
        F.forEach((f2, k2) => {
          if (k2 === k || f2.x1 <= f.x0 || f2.x0 >= f.x1 || f2.y1 <= f.y0 || f2.y0 >= f.y1) return;
          // Gleichstand (deckungsgleiche Ebenen): der frühere Flügel behält die Fläche.
          // Abstand deutlich über der Klipp-Toleranz EPS, sonst wirkt er nicht.
          const vorrang = k2 < k ? -1e-4 : 1e-4;
          const C = rechteckHalb(f2).concat(E[k2].map(g => [g.gx - e.gx, g.gy - e.gy, g.h0 - e.h0 - vorrang]));
          stuecke = stuecke.flatMap(st => ohne(st, C));
        });
        if (stuecke.length) fl.push({ ebene: e, stuecke });
      });
    });
    fl.fluegel = F.length;
  }

  // Flächen: Stücke verschmelzen, Höhen anbringen, zurückdrehen
  const flaechen = [];
  for (const { ebene: e, stuecke } of fl) {
    const geneigt = Math.hypot(e.gx, e.gy) > 1e-9;
    const az = geneigt ? azWelt(e.gx, e.gy) : 180;
    const nei = Math.atan(Math.hypot(e.gx, e.gy)) / RAD;
    // Stücke derselben Fläche verschmelzen — nur wenn die Fläche dabei erhalten
    // bleibt (Berührung nur in einem Punkt, Löcher …), sonst einzeln lassen
    let ringe = stuecke;
    if (stuecke.length > 1) {
      const v = verschmelzen(stuecke);
      const soll = stuecke.reduce((sum, r) => sum + Math.abs(flaeche(r)), 0);
      const ist = v.reduce((sum, r) => sum + Math.abs(flaeche(r)), 0);
      if (Math.abs(ist - soll) < 0.01 * soll + 0.05) ringe = v;
    }
    for (const r0 of ringe) {
      const r = r0.filter((p, i) => { const q = r0[(i + 1) % r0.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
      const a = Math.abs(flaeche(r));
      if (a < 0.05) continue;
      flaechen.push({ ring: r.map(p => { const w = zurueck(p); return [w[0], w[1], hoehe(e, p[0], p[1])]; }),
        neigung: Math.round(nei * 10) / 10, azimut: Math.round(az), grundM2: Math.round(a * 10) / 10 });
    }
  }

  // Giebel-/Hochwände: über jeder Grundrisskante das Dachprofil, wo es über der Traufe liegt
  const lokEcken = fl.flatMap(f => f.stuecke.flat());
  const waende = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (l2 < 1e-8) continue;
    const ts = [0, 1];
    for (const p of lokEcken) {
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      const qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
      if (qx * qx + qy * qy < 1e-4) ts.push(t);          // 1 cm
    }
    const tsU = eindeutig(ts, 1e-6);
    const profil = tsU.map(t => { const x = a[0] + t * dx, y = a[1] + t * dy; return [x, y, hoeheBei(x, y)]; });
    if (!profil.some(p => p[2] > traufe + 0.02)) continue;
    const w = [[a[0], a[1], traufe], ...profil.filter(p => p[2] > traufe + 1e-6), [b[0], b[1], traufe]];
    waende.push(w.map(p => { const z = zurueck(p); return [z[0], z[1], p[2]]; }));
  }

  const firstH = flaechen.reduce((m, f) => Math.max(m, ...f.ring.map(p => p[2])), traufe);
  return { flaechen, waende, firstH, fluegel: fl.fluegel || 1 };
}

/**
 * Dachflächen aus dem Grundriss eines Gebäudes — Datenform wie der LoD2-Import
 * (g.dachFlaechen + g.dachLod2 mit quelle 'grundriss'). null, wenn der Grundriss
 * nicht rechtwinklig genug ist (schräge Kanten, Rundungen) — dann bleibt das
 * Ein-Dach-Modell. Genutzt von 37 (Knopf, Nachführen), der 3D-Ansicht und der
 * Verschattung (Höhe von Nachbargebäuden) sowie der automatischen Belegung.
 * @param {{polygon:{lat:number,lng:number}[], dachform?:string, dachNeigung?:number|null,
 *   dachAzimut?:number|null, dachAutoAzimut?:boolean, stockwerke?:any}} g
 * @returns {null | {dachFlaechen:any[], lod2:any, fluegel:number}}
 */
export function dachAusGrundrissGebaeude(g) {
  if (!Array.isArray(g?.polygon) || g.polygon.length < 3) return null;
  const r = richteRechtwinklig(g.polygon.map(p => ({ lat: p.lat, lng: p.lng })));
  if (!r || r.diagonaleKanten > 0 || r.abweichungProzent > 5) return null;
  let la = 0, ln = 0;
  for (const p of r.coords) { la += p.lat; ln += p.lng; }
  const rahmen = d3dRahmen(ln / r.coords.length, la / r.coords.length);
  const form = ['sattel', 'walm', 'pult', 'flach'].includes(g.dachform) ? g.dachform : 'sattel';
  const traufe = Math.max(1, Math.min(60, parseInt(g.stockwerke, 10) || 1)) * 3;
  const azimut = form === 'pult' ? (g.dachAzimut ?? null)
    : (g.dachAzimut != null && !g.dachAutoAzimut ? g.dachAzimut : null);
  const d = dachAusGrundriss(r.coords.map(p => rahmen.nachXY(p.lng, p.lat)), {
    form, neigung: form === 'flach' ? 0 : (g.dachNeigung ?? NEIGUNG_VORGABE[form] ?? 35), traufe, azimut,
  });
  if (!d || !d.flaechen.length) return null;
  const ll = q => { const [lng, lat] = rahmen.nachLL(q[0], q[1]); return [lat, lng, Math.round(q[2] * 100) / 100]; };
  return {
    dachFlaechen: d.flaechen.map((f, i) => ({ id: i + 1, punkte: f.ring.map(ll), neigung: f.neigung, azimut: f.azimut,
      grundM2: f.grundM2, flaecheM2: Math.round(f.grundM2 / Math.cos(f.neigung * RAD) * 10) / 10 })),
    lod2: { quelle: 'grundriss', gmlId: null, traufeM: traufe, firstM: Math.round(d.firstH * 100) / 100,
      bodenGeschaetzt: false, waende: d.waende.map(w => w.map(ll)) },
    fluegel: d.fluegel,
  };
}
