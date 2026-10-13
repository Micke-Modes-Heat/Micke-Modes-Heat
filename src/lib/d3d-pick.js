// ── lib/d3d-pick.js — Dachflächen in der 3D-Ansicht anklicken ─────────────────
// Reiner Geometrieteil, ohne DOM/WebGL. Dächer und Module zeichnet eine eigene
// WebGL-Ebene (32-3d-ansicht.js) — dort hilft queryRenderedFeatures nicht. Statt
// dessen: Mauspunkt über die umgekehrte Kameramatrix in einen Strahl verwandeln
// und mit den Dreiecken der Szene schneiden (nächster Treffer gewinnt).
//
// Genauigkeit: Die Kameramatrix von MapLibre bildet absolute Mercator-
// Koordinaten (0…1) auf den Bildschirm ab — Einträge um 10^8, ihre Umkehrung
// wäre auf Gebäudeebene nur auf Dezimeter genau. Deshalb wird sie vorher auf
// einen Raum um den Ursprung der Szene in Metern umgerechnet
// (pickMatrix): dort sind die Einträge klein und die Umkehrung ist exakt genug.

/**
 * Kameramatrix (spaltenweise, absolute Mercator-Koordinaten → Clip) auf den
 * Pick-Raum umrechnen: q = (p − ursprung) / mu, also p = ursprung + mu·q.
 * @param {ArrayLike<number>} m 4×4 spaltenweise
 * @param {{x:number,y:number,z:number}} u Ursprung (Mercator)
 * @param {number} mu Mercator-Einheiten je Meter am Ursprung
 * @returns {number[]} 4×4 spaltenweise
 */
export function pickMatrix(m, u, mu) {
  const out = new Array(16);
  for (let i = 0; i < 12; i++) out[i] = m[i] * mu;
  for (let r = 0; r < 4; r++) out[12 + r] = m[r] * u.x + m[4 + r] * u.y + m[8 + r] * u.z + m[12 + r];
  return out;
}

/** Inverse einer 4×4-Matrix (spaltenweise) oder null. */
export function invertiere4(m) {
  const a = m;
  const inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det || !isFinite(det)) return null;
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

function _mal(inv, x, y, z) {
  const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
  return [
    (inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w,
    (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w,
    (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w,
  ];
}

/**
 * Punkt im Pick-Raum → Bildschirm (CSS-Pixel). null, wenn er hinter der Kamera liegt.
 * @param {number[]} m Matrix Pick-Raum → Clip (pickMatrix)
 * @returns {number[]|null} [x, y]
 */
export function projiziere(m, q, breite, hoehe) {
  const x = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12];
  const y = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13];
  const w = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15];
  if (!(w > 1e-9)) return null;
  return [(x / w + 1) / 2 * breite, (1 - y / w) / 2 * hoehe];
}

/**
 * Sehstrahl durch einen Bildschirmpunkt.
 * @param {number[]} m Matrix Pick-Raum → Clip (pickMatrix)
 * @param {number} px Bildschirm x (CSS-Pixel ab links)
 * @param {number} py Bildschirm y (ab oben)
 * @param {number} breite Canvas-Breite (CSS-Pixel)
 * @param {number} hoehe Canvas-Höhe
 * @returns {{o:number[], d:number[]}|null} Ursprung (Nahebene) und Richtung (normiert)
 */
export function sehstrahl(m, px, py, breite, hoehe) {
  const inv = invertiere4(m);
  if (!inv || !(breite > 0) || !(hoehe > 0)) return null;
  const nx = 2 * px / breite - 1, ny = 1 - 2 * py / hoehe;
  const a = _mal(inv, nx, ny, -1), b = _mal(inv, nx, ny, 1);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!(l > 0) || !isFinite(l)) return null;
  return { o: a, d: [d[0] / l, d[1] / l, d[2] / l] };
}

/**
 * Schnitt Strahl–Dreieck (Möller–Trumbore, beidseitig).
 * @param {Float64Array|number[]} t Dreiecksdaten, Ecken ab Index i (9 Werte)
 * @returns {number} Abstand t > 0 oder Infinity
 */
export function strahlDreieck(o, d, t, i = 0) {
  const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
  const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const f = 1 / det;
  const sx = o[0] - t[i], sy = o[1] - t[i + 1], sz = o[2] - t[i + 2];
  const u = f * (sx * px + sy * py + sz * pz);
  if (u < -1e-9 || u > 1 + 1e-9) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
  if (v < -1e-9 || u + v > 1 + 1e-9) return Infinity;
  const dist = f * (e2x * qx + e2y * qy + e2z * qz);
  return dist > 1e-9 ? dist : Infinity;
}

/** Trifft der Strahl den Quader [minx,miny,minz,maxx,maxy,maxz] vor tMax? */
export function strahlQuader(o, d, b, tMax = Infinity) {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-15) {
      if (o[k] < b[k] || o[k] > b[k + 3]) return false;
      continue;
    }
    let ta = (b[k] - o[k]) / d[k], tb = (b[k + 3] - o[k]) / d[k];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Sammler für die Pick-Geometrie: je Fläche (Gebäude + Schlüssel) die Dreiecke
 * im Pick-Raum samt Hüllquader. Schlüssel null = nur Hindernis (Wände): verdeckt,
 * ist aber selbst nicht anwählbar.
 */
export function pickSammler() {
  /** @type {{gid:any, key:string|null, tris:number[], box:number[]}[]} */
  const flaechen = [];
  let aktuell = null;
  return {
    flaechen,
    /** Neue Fläche beginnen (oder an die letzte gleiche anhängen). */
    beginne(gid, key) {
      if (aktuell && aktuell.gid === gid && aktuell.key === key) return;
      aktuell = flaechen.find(f => f.gid === gid && f.key === key) || null;
      if (!aktuell) {
        aktuell = { gid, key, tris: [], box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
        flaechen.push(aktuell);
      }
    },
    /** Dreieck aus drei Punkten [x,y,z] im Pick-Raum. */
    dreieck(a, b, c) {
      if (!aktuell) return;
      for (const p of [a, b, c]) {
        aktuell.tris.push(p[0], p[1], p[2]);
        for (let k = 0; k < 3; k++) {
          if (p[k] < aktuell.box[k]) aktuell.box[k] = p[k];
          if (p[k] > aktuell.box[k + 3]) aktuell.box[k + 3] = p[k];
        }
      }
    },
  };
}

/**
 * Nächster Treffer des Strahls.
 * @param {{o:number[], d:number[]}} s
 * @param {{gid:any, key:string|null, tris:ArrayLike<number>, box:number[]}[]} flaechen
 * @returns {{gid:any, key:string|null, t:number, punkt:number[]}|null}
 */
export function naechsterTreffer(s, flaechen) {
  if (!s) return null;
  let best = null, bestT = Infinity, bestI = -1;
  for (const f of flaechen) {
    if (!strahlQuader(s.o, s.d, f.box, bestT)) continue;
    const t = f.tris;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const d = strahlDreieck(s.o, s.d, t, i);
      if (d < bestT) { bestT = d; best = f; bestI = i; }
    }
  }
  if (!best) return null;
  return { gid: best.gid, key: best.key, t: bestT, flaeche: best, tri: bestI,
    punkt: [s.o[0] + s.d[0] * bestT, s.o[1] + s.d[1] * bestT, s.o[2] + s.d[2] * bestT] };
}

/* ── Zeichnen auf der Dachebene (Stufe 2) ─────────────────────────────────── */
// Pick-Raum: x Ost, y SÜD (Mercator), z oben — Meter bis auf einen gemeinsamen Faktor.

/** Ebene durch ein Dreieck der Daten ab Index i: {n (normiert), p}. */
export function ebeneAusDreieck(t, i = 0) {
  const p = [t[i], t[i + 1], t[i + 2]];
  const u = [t[i + 3] - p[0], t[i + 4] - p[1], t[i + 5] - p[2]];
  const v = [t[i + 6] - p[0], t[i + 7] - p[1], t[i + 8] - p[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return { n: [n[0] / l, n[1] / l, n[2] / l], p };
}

/** Höhe der Ebene über (x, y); bei (fast) senkrechter Ebene die Höhe des Bezugspunkts. */
export function ebeneZ(e, x, y) {
  if (Math.abs(e.n[2]) < 1e-6) return e.p[2];
  return e.p[2] - (e.n[0] * (x - e.p[0]) + e.n[1] * (y - e.p[1])) / e.n[2];
}

/** Schnittpunkt Strahl–Ebene (auch hinter Kanten der Fläche) oder null. */
export function strahlEbene(s, e) {
  if (!s) return null;
  const nen = s.d[0] * e.n[0] + s.d[1] * e.n[1] + s.d[2] * e.n[2];
  if (Math.abs(nen) < 1e-9) return null;
  const t = ((e.p[0] - s.o[0]) * e.n[0] + (e.p[1] - s.o[1]) * e.n[1] + (e.p[2] - s.o[2]) * e.n[2]) / nen;
  if (!(t > 0)) return null;
  return [s.o[0] + s.d[0] * t, s.o[1] + s.d[1] * t, s.o[2] + s.d[2] * t];
}

/**
 * Kompassrichtung, in die die Ebene fällt (0 = Nord, 90 = Ost), oder null bei
 * (fast) waagrechter Ebene. Pick-Raum: y zeigt nach Süden.
 */
export function ebeneFallrichtung(e) {
  if (Math.abs(e.n[2]) < 1e-9) return null;
  const gx = -e.n[0] / e.n[2], gy = -e.n[1] / e.n[2];   // dz/dx, dz/dy (y = Süd)
  if (Math.hypot(gx, gy) < Math.tan(1 * Math.PI / 180)) return null;
  // bergab = −Gradient; Nordkomponente = −(Südkomponente)
  const ost = -gx, nord = gy;
  return ((Math.atan2(ost, nord) * 180 / Math.PI) + 360) % 360;
}

/** Achsen eines am Azimut ausgerichteten Rechtecks im Pick-Raum: r entlang First, d Falllinie. */
export function rechteckAchsen(azimut) {
  const a = azimut * Math.PI / 180;
  const d = [Math.sin(a), -Math.cos(a)];         // Ost, Süd
  return { d, r: [-d[1], d[0]] };
}

/**
 * Rechteck aus zwei Punkten auf einer Dachebene, an Falllinie/First ausgerichtet.
 * Mit `grenzen` (Eckpunkte [x,y] der Dachfläche) wird auf deren Ausdehnung
 * begrenzt und an Traufe/First/Ortgang eingerastet, wenn eine Kante näher als
 * `fang` liegt.
 * @param {number[]} p1 [x,y,z]  @param {number[]} p2 [x,y,z]
 * @param {number} azimut Kompassgrad der Falllinie
 * @param {{n:number[], p:number[]}} ebene
 * @param {{grenzen?:number[][], fang?:number}} [opt]
 * @returns {{ecken:number[][], laenge:number, breite:number}} ecken [x,y,z] ×4 (Umlauf)
 */
export function rechteckAufEbene(p1, p2, azimut, ebene, opt = {}) {
  const { r, d } = rechteckAchsen(azimut);
  const zuUV = p => [p[0] * r[0] + p[1] * r[1], p[0] * d[0] + p[1] * d[1]];
  let [u1, v1] = zuUV(p1), [u2, v2] = zuUV(p2);
  const g = opt.grenzen;
  if (g?.length) {
    const us = g.map(q => q[0] * r[0] + q[1] * r[1]), vs = g.map(q => q[0] * d[0] + q[1] * d[1]);
    const uMin = Math.min(...us), uMax = Math.max(...us), vMin = Math.min(...vs), vMax = Math.max(...vs);
    const fang = opt.fang ?? 0;
    const rasten = (w, lo, hi) => {
      w = Math.max(lo, Math.min(hi, w));
      if (w - lo < fang) return lo;
      if (hi - w < fang) return hi;
      return w;
    };
    u1 = rasten(u1, uMin, uMax); u2 = rasten(u2, uMin, uMax);
    v1 = rasten(v1, vMin, vMax); v2 = rasten(v2, vMin, vMax);
  }
  const punkt = (u, v) => {
    const x = u * r[0] + v * d[0], y = u * r[1] + v * d[1];
    return [x, y, ebeneZ(ebene, x, y)];
  };
  const ecken = [punkt(u1, v1), punkt(u2, v1), punkt(u2, v2), punkt(u1, v2)];
  return { ecken, laenge: Math.abs(u2 - u1), breite: Math.abs(v2 - v1) };
}

/**
 * Himmelsrichtung, in die eine Dachebene h = a·x + b·y + c fällt (x Ost, y Nord):
 * Kompassgrad 0 = Nord, 90 = Ost … null bei waagrechter Ebene.
 */
export function ebeneAzimut(e) {
  const gx = -e.a, gy = -e.b;   // bergab
  if (Math.hypot(gx, gy) < 1e-9) return null;
  return ((Math.atan2(gx, gy) * 180 / Math.PI) + 360) % 360;
}

/** Neigung einer Ebene h = a·x + b·y + c in Grad. */
export function ebeneNeigung(e) {
  return Math.atan(Math.hypot(e.a, e.b)) * 180 / Math.PI;
}

/* ── Einrasten beim Verschieben einer Ecke ─────────────────────────────────── */

/** Nächster Punkt auf der Strecke a–b zu q, mit Abstand. */
function _aufStrecke(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  const p = [a[0] + t * dx, a[1] + t * dy];
  return { p, d: Math.hypot(q[0] - p[0], q[1] - p[1]), a, b };
}

/**
 * Ecke beim Verschieben einrasten (Pick-Raum xy, Meter).
 * Vorrang: Punkt (Dachecken, Ecken anderer Flächen) → Kante (Traufe, First,
 * Ortgang, Kehle), dabei möglichst im Schnitt mit einer Ausrichtung → Ausrichtung
 * an den Nachbarecken entlang First (u) bzw. Falllinie (v).
 * @param {number[]} q [x, y]
 * @param {{punkte?:number[][], kanten?:number[][][], nachbarn?:number[][], achsen?:{r:number[], d:number[]}}} ziele
 * @param {{fang?:number}} [opt]
 * @returns {{p:number[], art:'punkt'|'kante'|'achse'|null}}
 */
export function eckeEinrasten(q, ziele, opt = {}) {
  const fang = opt.fang ?? 0.3;
  // 1) Punkt
  let best = null, bestD = fang;
  for (const p of ziele.punkte || []) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) return { p: [best[0], best[1]], art: 'punkt' };
  // Ausrichtung an den Nachbarn (u entlang First, v entlang Falllinie)
  const ax = ziele.achsen;
  let u = null, v = null, achsPunkt = null;
  if (ax) {
    const uq = q[0] * ax.r[0] + q[1] * ax.r[1], vq = q[0] * ax.d[0] + q[1] * ax.d[1];
    let du = fang, dv = fang;
    for (const n of ziele.nachbarn || []) {
      const un = n[0] * ax.r[0] + n[1] * ax.r[1], vn = n[0] * ax.d[0] + n[1] * ax.d[1];
      if (Math.abs(uq - un) < du) { du = Math.abs(uq - un); u = un; }
      if (Math.abs(vq - vn) < dv) { dv = Math.abs(vq - vn); v = vn; }
    }
    if (u != null || v != null) {
      const uu = u ?? uq, vv = v ?? vq;
      achsPunkt = [uu * ax.r[0] + vv * ax.d[0], uu * ax.r[1] + vv * ax.d[1]];
    }
  }
  // 2) Kante — wenn eine Ausrichtung greift, deren Schnitt mit der Kante bevorzugen
  let kante = null;
  for (const [a, b] of ziele.kanten || []) {
    const s = _aufStrecke(q, a, b);
    if (s.d < (kante?.d ?? fang)) kante = s;
  }
  if (kante) {
    if (ax && (u != null || v != null)) {
      const { a, b } = kante;
      // Schnitt der Kantengeraden mit u = const bzw. v = const
      const schnitt = (achse, wert) => {
        const fa = a[0] * achse[0] + a[1] * achse[1], fb = b[0] * achse[0] + b[1] * achse[1];
        if (Math.abs(fb - fa) < 1e-9) return null;
        const t = (wert - fa) / (fb - fa);
        return t >= -1e-9 && t <= 1 + 1e-9 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
      };
      for (const p of [u != null ? schnitt(ax.r, u) : null, v != null ? schnitt(ax.d, v) : null]) {
        if (p && Math.hypot(q[0] - p[0], q[1] - p[1]) < 2 * fang) return { p, art: 'kante' };
      }
    }
    return { p: kante.p, art: 'kante' };
  }
  // 3) Ausrichtung
  if (achsPunkt) return { p: achsPunkt, art: 'achse' };
  return { p: [q[0], q[1]], art: null };
}

/**
 * Viereck beim Ziehen einer Ecke in seiner Form halten (Shift): die gegenüberliegende
 * Ecke O bleibt, die Kanten von O aus behalten ihre Richtung (e1 zu Nachbar 1, e2 zu
 * Nachbar 2) — beim Rechteck bleibt es also ein Rechteck. Die gezogene Ecke landet
 * genau auf p; die Nachbarn laufen mit.
 * @param {number[][]} start Ecken [x,y] beim Greifen (genau 4)
 * @param {number} i gezogene Ecke
 * @param {number[]} p neue Lage [x,y]
 * @returns {number[][]|null} neue Ecken oder null (entartet / nicht 4 Ecken)
 */
export function viereckHalten(start, i, p) {
  if (!Array.isArray(start) || start.length !== 4) return null;
  const o = start[(i + 2) % 4], n1 = start[(i + 1) % 4], n2 = start[(i + 3) % 4];
  const e1 = [n1[0] - o[0], n1[1] - o[1]], e2 = [n2[0] - o[0], n2[1] - o[1]];
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  if (Math.abs(det) < 1e-9) return null;
  // p − o = s·e1 + t·e2
  const dx = p[0] - o[0], dy = p[1] - o[1];
  const s = (dx * e2[1] - dy * e2[0]) / det, t = (e1[0] * dy - e1[1] * dx) / det;
  const out = start.map(q => [q[0], q[1]]);
  out[i] = [p[0], p[1]];
  out[(i + 1) % 4] = [o[0] + s * e1[0], o[1] + s * e1[1]];
  out[(i + 3) % 4] = [o[0] + t * e2[0], o[1] + t * e2[1]];
  return out;
}
