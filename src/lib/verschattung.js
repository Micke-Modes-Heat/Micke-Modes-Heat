// ── lib/verschattung.js — Verschattung von PV-Modulen durch Bäume und Gebäude ─
// Reiner Rechenteil (ohne DOM), aufgerufen aus 40-baeume.js.
//
// Ergebnis ist ein JAHRES-Verschattungsfaktor (0…1) je Prüfpunkt bzw. Dachfläche:
//   Faktor = (Direkt·T + Diffus·SVF + Reflexion) / (Direkt + Diffus + Reflexion)
// Er wird auf den bestehenden Ertrag (Azimut/Neigung, 03c getPvKorrFaktor)
// aufmultipliziert — das Modell der Ausrichtung bleibt unangetastet.
//
// Einstrahlung:
//   • Monatssummen Global horizontal G und Diffusanteil kd: Richtwerte Mitte
//     Deutschland (Größenordnung DWD/PVGIS). Sie gewichten nur die Monate
//     untereinander und Direkt gegen Diffus — Absolutwerte kürzen sich heraus.
//   • Direkt: Klarhimmel-Sonnenbahn des 15. jedes Monats (wie 09a-pv-profile:
//     Meinel-DNI), halbstündlich in Sonnenzeit, auf die Monatssumme skaliert.
//   • Diffus: isotroper Himmel, abgetastet in 7 Höhen × 16 Richtungen.
//   • Bodenreflexion (Albedo 0,2) wird nicht verschattet.
// Hindernisse:
//   • Bäume: Krone als Ellipsoid (Laub/Obst) bzw. Kegel (Nadel), Form wie in der
//     3D-Ansicht (lib/baeume-3d baumKrone). Kronen sind lichtdurchlässig —
//     Laubbäume im Winter deutlich mehr als im Sommer (VS_TRANSMISSION).
//   • Gebäude: senkrechte Prismen bis zu einer wirksamen Höhe (Traufe + halbe
//     Dachhöhe ≈ volumengleich beim Satteldach), undurchsichtig. Das eigene
//     Gebäude zählt nicht (seine Dachflächen-Ausrichtung steckt im Ertrag).
// Koordinaten: lokale Meter, x Ost, y Nord, z oben.

const RAD = Math.PI / 180;

/** Monatssumme Global horizontal (kWh/m²) und Diffusanteil — Richtwerte Mitte Deutschland. */
export const VS_MONATE = {
  G:  [22, 38, 78, 120, 150, 158, 160, 135, 95, 57, 26, 17],
  kd: [0.72, 0.64, 0.56, 0.50, 0.48, 0.47, 0.47, 0.48, 0.52, 0.60, 0.70, 0.75],
};
const MONATSTAG = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const ALBEDO = 0.2;

/**
 * Lichtdurchlässigkeit einer Baumkrone je Monat (Jan…Dez). Laubbäume: belaubt
 * Mai–Sep, kahl Nov–Mär, dazwischen Übergang. Übliche Spannen aus der
 * Stadtklima-Literatur: belaubt 0,1–0,3, kahl 0,5–0,7, Nadelbäume 0,1–0,2.
 */
export const VS_TRANSMISSION = {
  laub:  [0.6, 0.6, 0.6, 0.4, 0.2, 0.2, 0.2, 0.2, 0.2, 0.4, 0.6, 0.6],
  obst:  [0.7, 0.7, 0.7, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.7, 0.7],
  nadel: [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15],
};

/** Reichweite: Hindernisse weiter weg als das bleiben außer Betracht (m). */
export const VS_REICHWEITE = 200;

/* ── Himmel ───────────────────────────────────────────────────────────────── */

/**
 * Sonnenstände je Monat (15. des Monats, halbstündlich in Sonnenzeit).
 * @param {number} latDeg
 * @returns {{dir:number[], dni:number, sinH:number}[][]} je Monat die Stände über dem Horizont
 */
export function vsSonnenstaende(latDeg, schrittGrad = 7.5) {
  const lat = latDeg * RAD;
  return MONATSTAG.map(n => {
    const dekl = 23.45 * Math.sin(2 * Math.PI * (284 + n) / 365) * RAD;
    const I0 = 1361 * (1 + 0.033 * Math.cos(2 * Math.PI * n / 365));
    const out = [];
    for (let w = -180 + schrittGrad / 2; w < 180; w += schrittGrad) {
      const omega = w * RAD;
      const sinH = Math.sin(lat) * Math.sin(dekl) + Math.cos(lat) * Math.cos(dekl) * Math.cos(omega);
      if (sinH <= 0.03) continue;
      const cosH = Math.sqrt(1 - sinH * sinH);
      // Azimut ab Süd, positiv nach Westen (wie 09a)
      const az = Math.atan2(Math.cos(dekl) * Math.sin(omega),
        Math.cos(dekl) * Math.cos(omega) * Math.sin(lat) - Math.sin(dekl) * Math.cos(lat));
      const dni = I0 * Math.pow(0.75, Math.pow(Math.min(20, 1 / sinH), 0.678));
      out.push({ dir: [-Math.sin(az) * cosH, -Math.cos(az) * cosH, sinH], dni, sinH });
    }
    return out;
  });
}

/**
 * Abtastrichtungen des Himmels mit Gewicht für eine waagrechte Fläche
 * (isotrope Strahldichte: dE = L·cosθ·dΩ, dΩ = cos(h)·dh·dφ).
 * @returns {{dir:number[], w:number}[]} w = cos(h)·Δh·Δφ (ohne den Neigungsterm)
 */
export function vsHimmel(ringe = 7, sektoren = 16) {
  const dh = (Math.PI / 2) / ringe, dphi = 2 * Math.PI / sektoren;
  const out = [];
  for (let i = 0; i < ringe; i++) {
    const h = (i + 0.5) * dh;
    for (let k = 0; k < sektoren; k++) {
      const phi = (k + 0.5) * dphi;
      out.push({ dir: [Math.cos(h) * Math.sin(phi), Math.cos(h) * Math.cos(phi), Math.sin(h)], w: Math.cos(h) * dh * dphi });
    }
  }
  return out;
}

/* ── Hindernisse ──────────────────────────────────────────────────────────── */

/**
 * @param {{baeume?: {x:number,y:number,krone:{form:string,zc?:number,rz?:number,r:number,z0?:number,z1?:number},art:string}[],
 *          gebaeude?: {ring:number[][], hoehe:number}[]}} h
 */
export function vsHindernisse(h) {
  const baeume = (h.baeume || []).map(b => {
    const k = b.krone;
    const oben = k.form === 'kegel' ? k.z1 : k.zc + k.rz;
    return { ...b, oben, art: VS_TRANSMISSION[b.art] ? b.art : 'laub' };
  });
  const gebaeude = (h.gebaeude || []).filter(g => g.ring && g.ring.length >= 3 && g.hoehe > 0).map(g => {
    let cx = 0, cy = 0;
    for (const [x, y] of g.ring) { cx += x; cy += y; }
    cx /= g.ring.length; cy /= g.ring.length;
    const r = Math.max(...g.ring.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    return { ...g, cx, cy, r };
  });
  return { baeume, gebaeude };
}

/** Abstand des Punkts (cx,cy) vom 2D-Strahl p + t·u (t ≥ 0), u nicht normiert. */
function abstandStrahl2d(px, py, ux, uy, cx, cy) {
  const uu = ux * ux + uy * uy;
  let t = uu > 1e-12 ? ((cx - px) * ux + (cy - py) * uy) / uu : 0;
  if (t < 0) t = 0;
  return Math.hypot(px + t * ux - cx, py + t * uy - cy);
}

function trifftEllipsoid(p, d, b, k) {
  const ox = (p[0] - b.x) / k.r, oy = (p[1] - b.y) / k.r, oz = (p[2] - k.zc) / k.rz;
  const dx = d[0] / k.r, dy = d[1] / k.r, dz = d[2] / k.rz;
  const a = dx * dx + dy * dy + dz * dz, bb = 2 * (ox * dx + oy * dy + oz * dz), c = ox * ox + oy * oy + oz * oz - 1;
  if (c <= 0) return true;                       // Punkt liegt in der Krone
  const disk = bb * bb - 4 * a * c;
  if (disk < 0) return false;
  return (-bb + Math.sqrt(disk)) / (2 * a) > 0;
}

function trifftKegel(p, d, b, k) {
  const h = k.z1 - k.z0;
  if (h <= 0) return false;
  const kk = (k.r / h) ** 2;
  const qx = p[0] - b.x, qy = p[1] - b.y, qz = p[2] - k.z1;   // relativ zur Spitze
  const imKegel = (z, r2) => z <= 0 && z >= -h && r2 <= kk * z * z;
  if (imKegel(qz, qx * qx + qy * qy)) return true;
  // Mantel
  const a = d[0] * d[0] + d[1] * d[1] - kk * d[2] * d[2];
  const bb = 2 * (qx * d[0] + qy * d[1] - kk * qz * d[2]);
  const c = qx * qx + qy * qy - kk * qz * qz;
  const pruefe = t => { if (t <= 1e-9) return false; const z = qz + t * d[2]; return z <= 0 && z >= -h; };
  if (Math.abs(a) < 1e-12) { if (Math.abs(bb) > 1e-12 && pruefe(-c / bb)) return true; }
  else {
    const disk = bb * bb - 4 * a * c;
    if (disk >= 0) {
      const s = Math.sqrt(disk);
      if (pruefe((-bb - s) / (2 * a)) || pruefe((-bb + s) / (2 * a))) return true;
    }
  }
  // Grundfläche
  if (Math.abs(d[2]) > 1e-12) {
    const t = (-h - qz) / d[2];
    if (t > 1e-9) { const x = qx + t * d[0], y = qy + t * d[1]; if (x * x + y * y <= k.r * k.r) return true; }
  }
  return false;
}

function trifftGebaeude(p, d, g) {
  if (p[2] >= g.hoehe) return false;             // Strahlen gehen nach oben
  const n = g.ring.length;
  for (let i = 0; i < n; i++) {
    const a = g.ring[i], b = g.ring[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - p[0], wy = a[1] - p[1];
    const t = (wx * ey - wy * ex) / den;
    const s = (wx * d[1] - wy * d[0]) / den;
    if (t > 1e-6 && s >= 0 && s <= 1 && p[2] + t * d[2] <= g.hoehe) return true;
  }
  return false;
}

/**
 * Was ein Strahl von p in Richtung d (normiert, d[2] > 0) trifft.
 * @returns {{laub:number, obst:number, nadel:number, geb:boolean}}
 */
export function vsStrahl(p, d, hind) {
  const treffer = { laub: 0, obst: 0, nadel: 0, geb: false };
  // Waagrechte Strecke, nach der der Strahl um 1 m gestiegen ist — weiter
  // entfernte Hindernisse überragt er bereits
  const proMeter = Math.hypot(d[0], d[1]) / Math.max(1e-9, d[2]);
  const zuWeit = (cx, cy, r, oben) => Math.hypot(cx - p[0], cy - p[1]) - r > (oben - p[2]) * proMeter;
  for (const g of hind.gebaeude) {
    if (p[2] >= g.hoehe || zuWeit(g.cx, g.cy, g.r, g.hoehe)
        || abstandStrahl2d(p[0], p[1], d[0], d[1], g.cx, g.cy) > g.r) continue;
    if (trifftGebaeude(p, d, g)) { treffer.geb = true; break; }
  }
  for (const b of hind.baeume) {
    if (p[2] >= b.oben || zuWeit(b.x, b.y, b.krone.r, b.oben)
        || abstandStrahl2d(p[0], p[1], d[0], d[1], b.x, b.y) > b.krone.r) continue;
    if (b.krone.form === 'kegel' ? trifftKegel(p, d, b, b.krone) : trifftEllipsoid(p, d, b, b.krone)) treffer[b.art]++;
  }
  return treffer;
}

/* ── Richtungsindex je Prüfpunkt ──────────────────────────────────────────── */
// Je Punkt werden die Hindernisse nach Himmelsrichtung (5°-Sektoren) einsortiert,
// samt der steilsten Höhe, unter der sie noch zu sehen sind. Ein Strahl prüft
// dann nur die Hindernisse seines Sektors, die über seine Höhe hinausragen.

const SEKTOREN = 72;

function imRing(x, y, ring) {
  let innen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) innen = !innen;
  }
  return innen;
}

/**
 * Liegt der Punkt im Grundriss eines anderen Gebäudes, überlappen die Grundrisse
 * (Gebäudeteile, Doppelerfassung, Neubau über Bestand). Ein solches Gebäude
 * verdeckte den Punkt in jeder Richtung — es zählt hier nicht, sondern wird als
 * Überlappung gemeldet.
 */
function vsIndex(p, hind) {
  const sek = Array.from({ length: SEKTOREN }, () => []);
  const ueberlappt = [];
  const eintragen = (x, y, r, oben, o, typ) => {
    if (p[2] >= oben) return;
    const dist = Math.hypot(x - p[0], y - p[1]);
    const e = { o, typ, maxTan: dist <= r ? Infinity : (oben - p[2]) / (dist - r) };
    if (dist <= r * 1.05 + 0.5) { for (const s of sek) s.push(e); return; }
    const mitte = Math.atan2(x - p[0], y - p[1]);
    const halb = Math.asin(Math.min(1, r / dist)) + 0.02;
    const von = Math.floor((mitte - halb) / (2 * Math.PI) * SEKTOREN), bis = Math.floor((mitte + halb) / (2 * Math.PI) * SEKTOREN);
    for (let k = von; k <= bis; k++) sek[((k % SEKTOREN) + SEKTOREN) % SEKTOREN].push(e);
  };
  for (const g of hind.gebaeude) {
    if (p[2] < g.hoehe && Math.hypot(g.cx - p[0], g.cy - p[1]) <= g.r && imRing(p[0], p[1], g.ring)) { ueberlappt.push(g); continue; }
    eintragen(g.cx, g.cy, g.r, g.hoehe, g, 'g');
  }
  for (const b of hind.baeume) eintragen(b.x, b.y, b.krone.r, b.oben, b, 'b');
  return { sek, ueberlappt };
}

function strahlIndex(p, d, sek) {
  const treffer = { laub: 0, obst: 0, nadel: 0, geb: false, gebObj: null, baumObjs: [] };
  const waag = Math.hypot(d[0], d[1]);
  const tanE = waag > 1e-9 ? d[2] / waag : Infinity;
  let k = Math.floor(Math.atan2(d[0], d[1]) / (2 * Math.PI) * SEKTOREN);
  k = ((k % SEKTOREN) + SEKTOREN) % SEKTOREN;
  for (const e of sek[k]) {
    if (tanE > e.maxTan) continue;
    if (e.typ === 'g') {
      if (!treffer.geb && trifftGebaeude(p, d, e.o)) { treffer.geb = true; treffer.gebObj = e.o; }
      continue;
    }
    const b = e.o;
    if (b.krone.form === 'kegel' ? trifftKegel(p, d, b, b.krone) : trifftEllipsoid(p, d, b, b.krone)) {
      treffer[b.art]++;
      treffer.baumObjs.push(b);
    }
  }
  return treffer;
}

function durchlass(t, m) {
  let T = 1;
  if (t.laub) T *= VS_TRANSMISSION.laub[m] ** t.laub;
  if (t.obst) T *= VS_TRANSMISSION.obst[m] ** t.obst;
  if (t.nadel) T *= VS_TRANSMISSION.nadel[m] ** t.nadel;
  return T;
}

/** Nur die Hindernisse, die einen Punkt überhaupt erreichen können. */
export function vsNahe(hind, x, y, reichweite = VS_REICHWEITE) {
  return {
    baeume: hind.baeume.filter(b => Math.hypot(b.x - x, b.y - y) - b.krone.r <= reichweite),
    gebaeude: hind.gebaeude.filter(g => Math.hypot(g.cx - x, g.cy - y) - g.r <= reichweite),
  };
}

/** Schlüssel eines Hindernisses für die Verursacher-Liste: 'g<id>' bzw. 'b<id>'. */
const vsSchluessel = o => (o.ring ? 'g' : 'b') + (o.id ?? '?');

/**
 * Jahreseinstrahlung eines Prüfpunkts ohne und mit Verschattung (kWh/m²,
 * Richtwert) — dazu getrennt nur durch Bäume bzw. nur durch Gebäude, der
 * Verlust je Hindernis (Gebäude zuerst; mehrere Kronen teilen sich den Verlust)
 * und die Gebäude, in deren Grundriss der Punkt liegt.
 * @param {{p:number[], n:number[]}} punkt Lage und Flächennormale (nach oben)
 * @returns {{ohne:number, mit:number, nurBaeume:number, nurGebaeude:number,
 *   verlust: Map<string, number>, ueberlappt: any[]}}
 */
export function vsPunkt(punkt, hind, sonne, himmel) {
  const n = punkt.n, p = punkt.p;
  const { sek, ueberlappt } = vsIndex(p, hind);
  const cosB = Math.max(-1, Math.min(1, n[2]));
  let ohne = 0, mit = 0, nurB = 0, nurG = 0;
  const verlust = new Map();
  const zuordnen = (t, w) => {
    if (!(w > 0)) return;
    if (t.gebObj) { const k = vsSchluessel(t.gebObj); verlust.set(k, (verlust.get(k) || 0) + w); return; }
    const anteil = w / (t.baumObjs.length || 1);
    for (const b of t.baumObjs) { const k = vsSchluessel(b); verlust.set(k, (verlust.get(k) || 0) + anteil); }
  };

  // Diffus: Himmelsrichtungen einmal je Punkt, Durchlass je Monat
  let wH = 0;
  const himmelTreffer = [];
  for (const s of himmel) {
    wH += s.w * s.dir[2];
    const c = n[0] * s.dir[0] + n[1] * s.dir[1] + n[2] * s.dir[2];
    if (c <= 0) continue;
    himmelTreffer.push({ w: s.w * c, t: strahlIndex(p, s.dir, sek) });
  }

  for (let m = 0; m < 12; m++) {
    const G = VS_MONATE.G[m], kd = VS_MONATE.kd[m];
    const B = (1 - kd) * G, D = kd * G, R = G * ALBEDO * (1 - cosB) / 2;
    // Direkt: Klarhimmel-Bahn auf die Monatssumme skalieren
    let hor = 0;
    for (const s of sonne[m]) hor += s.dni * s.sinH;
    const k = hor > 0 ? B / hor : 0;
    let mod = 0, modMit = 0, modB = 0, modG = 0;
    for (const s of sonne[m]) {
      const c = n[0] * s.dir[0] + n[1] * s.dir[1] + n[2] * s.dir[2];
      if (c <= 0) continue;
      const e = k * s.dni * c;
      mod += e;
      const t = strahlIndex(p, s.dir, sek);
      const Tb = durchlass(t, m), Tg = t.geb ? 0 : 1;
      modMit += e * Tb * Tg; modB += e * Tb; modG += e * Tg;
      zuordnen(t, e * (1 - Tb * Tg));
    }
    const kD = wH > 0 ? D / wH : 0;
    let dOhne = 0, dMit = 0, dB = 0, dG = 0;
    for (const h of himmelTreffer) {
      const e = kD * h.w;
      const Tb = durchlass(h.t, m), Tg = h.t.geb ? 0 : 1;
      dOhne += e; dMit += e * Tb * Tg; dB += e * Tb; dG += e * Tg;
      zuordnen(h.t, e * (1 - Tb * Tg));
    }
    ohne += mod + dOhne + R;
    mit += modMit + dMit + R;
    nurB += modB + dB + R;
    nurG += modG + dG + R;
  }
  return { ohne, mit, nurBaeume: nurB, nurGebaeude: nurG, verlust, ueberlappt };
}

/**
 * Verschattungsfaktoren für Prüfpunkte, zusammengefasst je Gruppe (Dachfläche)
 * und gesamt. Jeder Punkt steht für `gewicht` Module.
 * @param {{p:number[], n:number[], gruppe:string, gewicht:number}[]} punkte
 * @param {ReturnType<typeof vsHindernisse>} hind
 * @param {number} latDeg
 * @returns {{faktor:number, faktorBaeume:number, faktorGebaeude:number,
 *   gruppen: Record<string, {faktor:number, module:number}>,
 *   verursacher: {key:string, anteil:number}[], ueberlappungen: any[]}}
 *   verursacher: größte Verluste je Hindernis als Anteil am unverschatteten Ertrag
 *   ueberlappungen: ids der Gebäude, in deren Grundriss Prüfpunkte liegen
 */
export function vsFaktoren(punkte, hind, latDeg, maxVerursacher = 6) {
  const sonne = vsSonnenstaende(latDeg), himmel = vsHimmel();
  const summe = { ohne: 0, mit: 0, b: 0, g: 0 };
  const gruppen = {};
  const verlust = new Map();
  const ueberlappt = new Set();
  for (const pt of punkte) {
    const nah = vsNahe(hind, pt.p[0], pt.p[1]);
    const r = vsPunkt(pt, nah, sonne, himmel);
    const w = pt.gewicht || 1;
    summe.ohne += w * r.ohne; summe.mit += w * r.mit; summe.b += w * r.nurBaeume; summe.g += w * r.nurGebaeude;
    const gr = gruppen[pt.gruppe] || (gruppen[pt.gruppe] = { ohne: 0, mit: 0, module: 0 });
    gr.ohne += w * r.ohne; gr.mit += w * r.mit; gr.module += w;
    for (const [k, v] of r.verlust) verlust.set(k, (verlust.get(k) || 0) + w * v);
    for (const o of r.ueberlappt) ueberlappt.add(o.id ?? o);
  }
  const q = (a, b) => (b > 0 ? Math.min(1, a / b) : 1);
  const aus = {};
  for (const [k, g] of Object.entries(gruppen)) aus[k] = { faktor: q(g.mit, g.ohne), module: Math.round(g.module) };
  const verursacher = [...verlust.entries()]
    .map(([key, v]) => ({ key, anteil: summe.ohne > 0 ? v / summe.ohne : 0 }))
    .filter(v => v.anteil >= 0.001)
    .sort((a, b) => b.anteil - a.anteil)
    .slice(0, maxVerursacher);
  return { faktor: q(summe.mit, summe.ohne), faktorBaeume: q(summe.b, summe.ohne),
    faktorGebaeude: q(summe.g, summe.ohne), gruppen: aus, verursacher, ueberlappungen: [...ueberlappt] };
}

/**
 * Höchstens `max` Indizes gleichmäßig aus 0…n−1 (Stichprobe der Module).
 * @returns {number[]}
 */
export function vsStichprobe(n, max) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (let i = 0; i < max; i++) out.push(Math.floor((i + 0.5) * n / max));
  return out;
}
