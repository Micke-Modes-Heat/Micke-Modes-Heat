// ── lib/schall-hindernisse.js — Gebäude als Schallhindernisse (DOM-frei) ──
// Erweiterung der Ausbreitungsrechnung in lib/wp-schall.js um Abschirmung und Reflexion an Gebäuden, in Anlehnung
// an DIN ISO 9613-2 (A-bewertet, Einzahlrechnung bei 500 Hz):
// - Abschirmung: Beugung über das Dach (vertikale Schnittebene, „Gummiband“ über alle Gebäude im Weg) und seitlich
//   um die Gebäude herum (horizontal, Hülle der Grundrisse im Weg); die drei Wege werden energetisch addiert.
//   D_z = 10 lg(3 + 20/λ · C3 · z · K_met), höchstens 20 dB (einfache) bzw. 25 dB (mehrfache Beugung); dazu die
//   zusätzliche Ausbreitungsdämpfung auf dem längeren Umweg (wichtig für die seitlichen Wege um lange Gebäude).
// - Reflexion: Spiegelquellen an Fassaden in Quellnähe (erste Ordnung), Reflexionsverlust 1 dB (ρ = 0,8).
// Gebäudehöhe: Traufhöhe (konservativ, das Dach schirmt zusätzlich ab). Koordinaten in m (ost, nord).

export const LAMBDA_M = 0.68;            // Wellenlänge bei 500 Hz
export const DZ_MAX_EINFACH = 20, DZ_MAX_MEHRFACH = 25;
export const REFLEXION_DB = -1;          // ρ = 0,8: Fassade mit Fenstern und kleinen Anbauten
export const REFLEXION_RADIUS_M = 25;    // Fassaden bis zu diesem Abstand von einer Quelle werfen Spiegelquellen

import { schallPegel, pegelSumme } from './wp-schall.js';

const kreuz = (ax, ay, bx, by) => ax * by - ay * bx;

/** Hindernis aus Grundriss [{ost, nord}] und Höhe: mit Bounding-Box für die schnelle Vorauswahl. */
export function hindernis(id, poly, hoeheM) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.ost); x1 = Math.max(x1, p.ost); y0 = Math.min(y0, p.nord); y1 = Math.max(y1, p.nord); }
  return { id, poly, h: hoeheM, box: [x0, y0, x1, y1] };
}

/** Liegt der Punkt im Polygon? */
export function imPolygon(poly, x, y) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.nord > y) !== (b.nord > y) && x < (b.ost - a.ost) * (y - a.nord) / (b.nord - a.nord) + a.ost) innen = !innen;
  }
  return innen;
}

/**
 * Abschnitt der Strecke S→R, der im Grundriss liegt: { a1, a2 } als Abstand von S (horizontal), oder null.
 * Konvexe wie konkave Grundrisse: Schnittpunkte mit allen Kanten, äußerstes Paar.
 */
export function streckeImGrundriss(poly, sx, sy, rx, ry) {
  const dx = rx - sx, dy = ry - sy, d = Math.hypot(dx, dy);
  if (d < 1e-6) return null;
  const ts = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.ost - a.ost, ey = b.nord - a.nord;
    const n = kreuz(dx, dy, ex, ey);
    if (Math.abs(n) < 1e-12) continue;
    const t = kreuz(a.ost - sx, a.nord - sy, ex, ey) / n, u = kreuz(a.ost - sx, a.nord - sy, dx, dy) / n;
    if (u >= 0 && u <= 1 && t > 0 && t < 1) ts.push(t);
  }
  const innenS = imPolygon(poly, sx, sy), innenR = imPolygon(poly, rx, ry);
  if (innenS) ts.push(0);
  if (innenR) ts.push(1);
  if (ts.length < 2) return null;
  return { a1: Math.min(...ts) * d, a2: Math.max(...ts) * d };
}

const boxTrifft = (b, sx, sy, rx, ry) => Math.max(sx, rx) >= b[0] && Math.min(sx, rx) <= b[2] && Math.max(sy, ry) >= b[1] && Math.min(sy, ry) <= b[3];

/** Obere konvexe Hülle (Gummiband) über das Profil [{x, z}] von S (erster) bis R (letzter Punkt). */
function gummiband(punkte) {
  const h = [];
  for (const p of punkte) {
    while (h.length >= 2 && kreuz(h[h.length - 1].x - h[h.length - 2].x, h[h.length - 1].z - h[h.length - 2].z, p.x - h[h.length - 2].x, p.z - h[h.length - 2].z) >= 0) h.pop();
    h.push(p);
  }
  return h;
}

/** D_z eines Beugungswegs: z Umweg, e Abstand erste–letzte Beugungskante, mehrfach, dss/dsr/d für K_met. */
export function beugungsDaempfung(z, e, mehrfach, dss, dsr, d, mitKmet = true) {
  if (!(z > 0)) return 0;
  const c3 = mehrfach && e > 0 ? (1 + (5 * LAMBDA_M / e) ** 2) / (1 / 3 + (5 * LAMBDA_M / e) ** 2) : 1;
  const kmet = mitKmet ? Math.exp(-(1 / 2000) * Math.sqrt(dss * dsr * d / (2 * z))) : 1;
  const dz = 10 * Math.log10(3 + (20 / LAMBDA_M) * c3 * z * kmet);
  return Math.max(0, Math.min(mehrfach ? DZ_MAX_MEHRFACH : DZ_MAX_EINFACH, dz));
}

/** Zusätzliche geometrische Ausbreitung auf dem längeren Beugungsweg (Länge l statt d). */
const umweg = (l, d) => 20 * Math.log10(Math.max(l, d) / Math.max(d, 1e-9));

/** Weglänge eines Kantenzugs [{x, z}]. */
const zugLaenge = h => { let l = 0; for (let i = 1; i < h.length; i++) l += Math.hypot(h[i].x - h[i - 1].x, h[i].z - h[i - 1].z); return l; };

/** Konvexe Hülle (2D, ost/nord). */
function huelle(pts) {
  const p = pts.slice().sort((a, b) => a.ost - b.ost || a.nord - b.nord);
  if (p.length < 3) return p;
  const k = (o, a, b) => kreuz(a.ost - o.ost, a.nord - o.nord, b.ost - o.ost, b.nord - o.nord);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && k(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && k(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/**
 * Abschirmung zwischen Quelle S (sx, sy, hs) und Empfänger R (rx, ry, hr) durch die Hindernisse.
 * ohne: Set von Hindernis-IDs, die nicht zählen (Gebäude, in dem Quelle bzw. Empfänger liegt).
 * Ergebnis: { abar (dB, ≥ 0), oben, links, rechts (D_z je Weg), hindernisse: Anzahl im Weg }.
 */
export function abschirmung(hind, sx, sy, hs, rx, ry, hr, ohne = null) {
  const d = Math.hypot(rx - sx, ry - sy);
  const leer = { abar: 0, oben: 0, links: 0, rechts: 0, hindernisse: 0 };
  if (d < 1) return leer;
  const imWeg = [];
  for (const o of hind) {
    if (ohne && ohne.has(o.id)) continue;
    if (!boxTrifft(o.box, sx, sy, rx, ry)) continue;
    const s = streckeImGrundriss(o.poly, sx, sy, rx, ry);
    if (s) imWeg.push({ o, ...s });
  }
  if (!imWeg.length) return leer;
  // Über das Dach: Profil in der vertikalen Ebene durch S und R
  imWeg.sort((a, b) => a.a1 - b.a1);
  const profil = [{ x: 0, z: hs }];
  for (const w of imWeg) { profil.push({ x: w.a1, z: w.o.h }, { x: w.a2, z: w.o.h }); }
  profil.push({ x: d, z: hr });
  profil.sort((a, b) => a.x - b.x);
  const band = gummiband(profil);
  const direkt = Math.hypot(d, hr - hs);
  const kanten = band.slice(1, -1);
  let oben = 0;
  if (kanten.length) {
    const z = zugLaenge(band) - direkt;
    const e = zugLaenge(kanten);
    const dss = Math.hypot(kanten[0].x, kanten[0].z - hs), dsr = Math.hypot(d - kanten[kanten.length - 1].x, kanten[kanten.length - 1].z - hr);
    oben = beugungsDaempfung(z, e, kanten.length > 1 && e > 0.5, dss, dsr, d) + umweg(direkt + z, direkt);
  }
  if (!(oben > 0)) return leer;   // Sichtverbindung über die Gebäude hinweg
  // Seitlich: Hülle der Grundrisse im Weg zusammen mit S und R, beide Seiten der Sichtlinie
  const S = { ost: sx, nord: sy }, R = { ost: rx, nord: ry };
  const hu = huelle([S, R, ...imWeg.flatMap(w => w.o.poly)]);
  const iS = hu.indexOf(S), iR = hu.indexOf(R);
  const seite = [];
  if (iS >= 0 && iR >= 0) {
    const n = hu.length;
    for (const richtung of [1, -1]) {
      const zug = [];
      for (let i = iS; ; i = (i + richtung + n) % n) { zug.push(hu[i]); if (i === iR) break; }
      const l = zug.reduce((s, p, i) => i ? s + Math.hypot(p.ost - zug[i - 1].ost, p.nord - zug[i - 1].nord) : 0, 0);
      const ke = zug.slice(1, -1);
      const e = ke.reduce((s, p, i) => i ? s + Math.hypot(p.ost - ke[i - 1].ost, p.nord - ke[i - 1].nord) : 0, 0);
      seite.push(ke.length ? beugungsDaempfung(l - d, e, ke.length > 1 && e > 0.5, 0, 0, d, false) + umweg(l, d) : 0);
    }
  }
  const [links = DZ_MAX_MEHRFACH, rechts = DZ_MAX_MEHRFACH] = seite;
  const summe = 10 ** (-oben / 10) + 10 ** (-links / 10) + 10 ** (-rechts / 10);
  return { abar: Math.max(0, -10 * Math.log10(summe)), oben, links, rechts, hindernisse: imWeg.length };
}

/**
 * Spiegelquellen erster Ordnung: für jede Quelle und jede Fassade (Kante eines Hindernisses, das mindestens so
 * hoch ist wie die Quelle) im Umkreis radiusM. Ergebnis: [{ ost, nord, lwa, wand: {a, b}, id, quelle }].
 */
export function spiegelquellen(quellen, hind, hs, radiusM = REFLEXION_RADIUS_M, ohne = null) {
  const out = [];
  for (const o of hind) {
    if (ohne && ohne.has(o.id)) continue;
    if (o.h < hs) continue;
    for (const [qi, q] of quellen.entries()) {
      if (q.ost < o.box[0] - radiusM || q.ost > o.box[2] + radiusM || q.nord < o.box[1] - radiusM || q.nord > o.box[3] + radiusM) continue;
      if (imPolygon(o.poly, q.ost, q.nord)) continue;
      for (let i = 0; i < o.poly.length; i++) {
        const a = o.poly[i], b = o.poly[(i + 1) % o.poly.length];
        const ex = b.ost - a.ost, ey = b.nord - a.nord, l2 = ex * ex + ey * ey;
        if (l2 < 1) continue;
        const t = ((q.ost - a.ost) * ex + (q.nord - a.nord) * ey) / l2;
        const fx = a.ost + t * ex, fy = a.nord + t * ey;
        const abst = Math.hypot(q.ost - fx, q.nord - fy);
        if (abst > radiusM || abst < 0.1) continue;
        // Nur die Außenseite der Fassade spiegelt: Quelle und Gebäudeinneres liegen auf verschiedenen Seiten
        const mx = (a.ost + b.ost) / 2, my = (a.nord + b.nord) / 2;
        const nx = -ey / Math.sqrt(l2), ny = ex / Math.sqrt(l2);
        const innen = imPolygon(o.poly, mx + nx * 0.2, my + ny * 0.2) ? 1 : -1;
        if (((q.ost - mx) * nx + (q.nord - my) * ny) * innen > 0) continue;
        out.push({ ost: 2 * fx - q.ost, nord: 2 * fy - q.nord, lwa: q.lwa + REFLEXION_DB, wand: { a, b }, id: o.id, quelle: qi });
      }
    }
  }
  return out;
}

/** Trifft der Weg Spiegelquelle → Empfänger die Fassade (innerhalb der Wandkante)? Dann gilt die Reflexion. */
export function reflexionGueltig(sp, rx, ry) {
  const { a, b } = sp.wand;
  const dx = rx - sp.ost, dy = ry - sp.nord, ex = b.ost - a.ost, ey = b.nord - a.nord;
  const n = kreuz(dx, dy, ex, ey);
  if (Math.abs(n) < 1e-12) return false;
  const t = kreuz(a.ost - sp.ost, a.nord - sp.nord, ex, ey) / n, u = kreuz(a.ost - sp.ost, a.nord - sp.nord, dx, dy) / n;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
}

/**
 * Rechenszene: Quellen [{ost, nord, lwa}] in Quellhöhe hs, Hindernisse, Spiegelquellen. Gebäude, in denen eine
 * Quelle steht (Dachaufstellung), schirmen nicht ab.
 */
export function schallSzene(quellen, hind, hs) {
  const ohne = new Set(hind.filter(o => quellen.some(q => imPolygon(o.poly, q.ost, q.nord))).map(o => o.id));
  const mitte = quellen.length
    ? { ost: quellen.reduce((s, q) => s + q.ost, 0) / quellen.length, nord: quellen.reduce((s, q) => s + q.nord, 0) / quellen.length }
    : { ost: 0, nord: 0 };
  return { quellen, hind, hs, ohne, mitte, spiegel: spiegelquellen(quellen, hind, hs, REFLEXION_RADIUS_M, ohne) };
}

/**
 * Pegel am Empfänger (x, y) in Höhe hr. o.exakt: Abschirmung je Quelle (sonst einmal ab der Mitte der
 * Quellengruppe, für Karten), o.ohne: weitere Hindernis-IDs (z. B. das Gebäude des Empfängers), o.hind: Vorauswahl,
 * o.innenLeer: im Gebäude kein Pegel (−∞).
 * Ergebnis: { pegel, frei (ohne Gebäude), abar (Abschirmung ab Mitte), reflexion (dB Zuschlag) }.
 */
export function pegel3d(sz, x, y, hr, o = {}) {
  const hind = o.hind || sz.hind;
  // Für Karten: in Gebäuden gibt es keinen Außenpegel — die Isophone endet an der Fassade
  if (o.innenLeer && hind.some(h => !sz.ohne.has(h.id) && x >= h.box[0] && x <= h.box[2] && y >= h.box[1] && y <= h.box[3] && imPolygon(h.poly, x, y))) {
    return { pegel: -Infinity, frei: -Infinity, abar: 0, reflexion: 0 };
  }
  let ohne = sz.ohne;
  if (o.ohne || hind.some(h => x >= h.box[0] && x <= h.box[2] && y >= h.box[1] && y <= h.box[3] && imPolygon(h.poly, x, y))) {
    ohne = new Set([...sz.ohne, ...(o.ohne || []), ...hind.filter(h => imPolygon(h.poly, x, y)).map(h => h.id)]);
  }
  const ab = (sx, sy, extra) => abschirmung(hind, sx, sy, sz.hs, x, y, hr, extra ? new Set([...ohne, extra]) : ohne).abar;
  const aMitte = ab(sz.mitte.ost, sz.mitte.nord);
  const direkt = [], frei = [];
  for (const q of sz.quellen) {
    const l = schallPegel(q.lwa, Math.hypot(x - q.ost, y - q.nord));
    frei.push(l);
    direkt.push(l - (o.exakt ? ab(q.ost, q.nord) : aMitte));
  }
  const refl = [];
  for (const sp of sz.spiegel) {
    if (!reflexionGueltig(sp, x, y)) continue;
    refl.push(schallPegel(sp.lwa, Math.hypot(x - sp.ost, y - sp.nord)) - (o.exakt ? ab(sp.ost, sp.nord, sp.id) : aMitte));
  }
  const ohneRefl = pegelSumme(direkt), pegel = pegelSumme([...direkt, ...refl]);
  return { pegel, frei: pegelSumme(frei), abar: aMitte, reflexion: refl.length ? pegel - ohneRefl : 0 };
}

/**
 * Isophonen mit Gebäuden: je Strahl ab der Mitte der Quellengruppe wird der Pegel abgetastet (Abschirmung ab der
 * Mitte) und der äußerste Punkt je Zielpegel gesucht. Ergebnis: Map ziel → [{ost, nord}] (leer, wenn der Pegel
 * schon an der Quelle unterschritten wird oder über maxM hinausreicht).
 */
export function isophonen3d(sz, ziele, o = {}) {
  const strahlen = o.strahlen ?? 180, hr = o.hr ?? 4, maxM = o.maxM ?? 3000;
  const lwaSum = pegelSumme(sz.quellen.map(q => q.lwa));
  const tiefster = Math.min(...ziele);
  // Reichweite im Freifeld (+ 3 dB für Reflexionen) als Obergrenze
  let rMax = 1;
  while (rMax < maxM && schallPegel(lwaSum + 3, rMax) >= tiefster) rMax *= 1.25;
  rMax = Math.min(maxM, rMax + 20);
  const out = new Map(ziele.map(z => [z, []]));
  const ueber = new Set();
  const m = sz.mitte;
  for (let i = 0; i < strahlen; i++) {
    const a = 2 * Math.PI * i / strahlen, dx = Math.sin(a), dy = Math.cos(a);
    const ex = m.ost + dx * rMax, ey = m.nord + dy * rMax;
    const hind = sz.hind.filter(h => boxTrifft(h.box, m.ost, m.nord, ex, ey));
    const pegel = r => pegel3d(sz, m.ost + dx * r, m.nord + dy * r, hr, { hind, innenLeer: true }).pegel;
    const proben = [];
    for (let r = 1; r <= rMax; r += Math.max(1, r * 0.03)) proben.push([r, pegel(r)]);
    for (const z of ziele) {
      let k = -1;
      for (let j = proben.length - 1; j >= 0; j--) if (proben[j][1] >= z) { k = j; break; }
      if (k === proben.length - 1 && proben[k][0] >= maxM - 1) { ueber.add(z); continue; }
      let r;
      if (k < 0) r = 0;
      else if (k === proben.length - 1) r = proben[k][0];
      else {
        let lo = proben[k][0], hi = proben[k + 1][0];
        for (let n = 0; n < 12 && hi - lo > 0.1; n++) { const mm = (lo + hi) / 2; if (pegel(mm) >= z) lo = mm; else hi = mm; }
        r = hi;
      }
      out.get(z).push({ ost: m.ost + dx * r, nord: m.nord + dy * r });
    }
  }
  for (const z of ziele) {
    const p = out.get(z);
    if (ueber.has(z) || p.every(q => Math.hypot(q.ost - m.ost, q.nord - m.nord) < 0.5)) out.set(z, []);
  }
  return out;
}

/**
 * Immissionsort an einem Gebäude: lautester Punkt der Fassade (Ecken, Kantenmitten, nächster Punkt) über alle
 * Geschosse (Fenstermitte 2 m + 3 m je Geschoss). Abschirmung je Quelle, das Gebäude selbst zählt nicht.
 * Ergebnis: { pegel, frei, abstand, geschoss, ost, nord }.
 */
export function immissionsort3d(sz, geb) {
  const p = geb.poly, n = p.length;
  const punkte = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    punkte.push(a, { ost: (a.ost + b.ost) / 2, nord: (a.nord + b.nord) / 2 });
    const ex = b.ost - a.ost, ey = b.nord - a.nord, l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((sz.mitte.ost - a.ost) * ex + (sz.mitte.nord - a.nord) * ey) / l2)) : 0;
    punkte.push({ ost: a.ost + t * ex, nord: a.nord + t * ey });
  }
  const geschosse = Math.max(1, Math.min(30, geb.geschosse || 1));
  const ohne = new Set([geb.id]);
  let best = null;
  for (const q of punkte) {
    for (let k = 0; k < geschosse; k++) {
      const r = pegel3d(sz, q.ost, q.nord, 2 + 3 * k, { exakt: true, ohne });
      if (!best || r.pegel > best.pegel) best = { ...r, ost: q.ost, nord: q.nord, geschoss: k, abstand: Math.hypot(q.ost - sz.mitte.ost, q.nord - sz.mitte.nord) };
    }
  }
  return best;
}
