// ── lib/dach-3d.js — Dachformen und PV-Module als 3D-Dreiecke ───────────────
// Reiner Geometrieteil der 3D-Ansicht (32-3d-ansicht.js), ohne DOM/WebGL.
//
// Grundlage sind die PV-Angaben am Gebäude — dieselben Felder, mit denen die
// Modulplatzierung (03c placePvModules) und der Ertrag rechnen:
//   dachform   'flach' | 'sattel' | 'walm' | 'pult'
//   dachNeigung  Grad (leer → Vorgabe je Dachform wie getDachDefaultNeigung)
//   dachAzimut   Falllinie der Vorderseite, Grad (leer → 180 = Süd, wie dort)
//   pvRidgeOverride  manuell gesetzte Firstlage {lat,lng} (nur Satteldach)
//
// Modell: das Dach ist das Minimum mehrerer Ebenen h = a·x + b·y + c über dem
// Grundriss (x Ost, y Nord in Metern, z Höhe). Jede Ebene ist eine Dachfläche;
// wo sie die niedrigste ist, liegt ihr Teil des Dachs. Das ergibt für Rechteck-
// grundrisse exakt Sattel-, Walm- und Pultdach und für beliebige Grundrisse eine
// stimmige Näherung (Ausrichtung im gedrehten Hüllrechteck entlang des Azimuts).
// Die Traufe liegt auf Wandhöhe; wo das Dach höher ansetzt (Giebel, Pult-
// Hochseite, außermittiger First), schließen senkrechte Wandstücke die Lücke.

export const D3D_DACH_NEIGUNG_VORGABE = { flach: 5, sattel: 35, walm: 30, pult: 15 };

const M_PRO_GRAD = 111320;
const MODUL_ABSTAND = 0.12;      // Modul über Dachhaut (m)
const AUFST_UNTEN = 0.15;        // Flachdach: Unterkante der Aufständerung (m)
const AUFST_HUB = 0.25;          // Flachdach: Hub der hohen Modulkante (m)
const FF_UNTEN = 0.7;            // Freifläche: Unterkante (m)
const FF_HUB = 0.55;             // Freifläche: Hub der hohen Kante (m)

/* ── kleine Vektorhelfer ─────────────────────────────────────────────────── */

/** Lokaler metrischer Rahmen um (lng0, lat0). */
export function d3dRahmen(lng0, lat0) {
  const cosL = Math.cos(lat0 * Math.PI / 180);
  return {
    lng0, lat0, cosL,
    nachXY: (lng, lat) => [(lng - lng0) * M_PRO_GRAD * cosL, (lat - lat0) * M_PRO_GRAD],
    nachLL: (x, y) => [lng0 + x / (M_PRO_GRAD * cosL), lat0 + y / M_PRO_GRAD],
  };
}

function flaecheXY(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Ring ohne doppelte Schlusspunkte und ohne (fast) doppelte Nachbarn. */
function bereinigen(pts, eps = 1e-6) {
  const out = [];
  for (const p of pts) {
    const v = out[out.length - 1];
    if (!v || Math.abs(v[0] - p[0]) > eps || Math.abs(v[1] - p[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], z = out[out.length - 1];
    if (Math.abs(a[0] - z[0]) > eps || Math.abs(a[1] - z[1]) > eps) break;
    out.pop();
  }
  return out;
}

/* ── Dachebenen ──────────────────────────────────────────────────────────── */

/**
 * Ebenen eines Dachs über dem Grundriss.
 * @param {string} form 'flach'|'sattel'|'walm'|'pult'
 * @param {number[][]} pts Grundriss [x,y] (m, lokal)
 * @param {{azimut?:number, neigung?:number, traufe:number, first?:number[]|null}} p
 * @returns {{a:number,b:number,c:number}[]} h = a·x + b·y + c; Dach = Minimum
 */
export function d3dDachEbenen(form, pts, p) {
  const traufe = p.traufe;
  if (!pts || pts.length < 3 || form === 'flach' || !form) return [{ a: 0, b: 0, c: traufe }];
  const A = (p.azimut != null && isFinite(p.azimut) ? p.azimut : 180) * Math.PI / 180;
  const neigung = p.neigung != null && isFinite(p.neigung) ? p.neigung : (D3D_DACH_NEIGUNG_VORGABE[form] ?? 35);
  const T = Math.tan(Math.max(0, Math.min(75, neigung)) * Math.PI / 180);
  const d = [Math.sin(A), Math.cos(A)];          // Falllinie der Vorderseite (Ost, Nord)
  const r = [Math.cos(A), -Math.sin(A)];         // entlang des Firsts
  let sMin = Infinity, sMax = -Infinity, uMin = Infinity, uMax = -Infinity;
  for (const q of pts) {
    const s = q[0] * d[0] + q[1] * d[1], u = q[0] * r[0] + q[1] * r[1];
    if (s < sMin) sMin = s; if (s > sMax) sMax = s;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
  }
  // Ebene h = h0 + k·(Richtung·p)  →  a, b, c
  const ebene = (h0, k, dir) => ({ a: k * dir[0], b: k * dir[1], c: h0 });

  if (form === 'pult') {
    // Tiefste Kante auf der Azimut-Seite (Fläche zeigt nach A)
    return [ebene(traufe + T * sMax, -T, d)];
  }
  if (form === 'walm') {
    return [
      ebene(traufe + T * sMax, -T, d),           // Vorderseite
      ebene(traufe - T * sMin, T, d),            // Rückseite
      ebene(traufe + T * uMax, -T, r),           // Walm an einem Ende
      ebene(traufe - T * uMin, T, r),            // Walm am anderen Ende
    ];
  }
  // Satteldach: First mittig im Hüllrechteck oder an der manuell gesetzten Stelle
  let sF = (sMin + sMax) / 2;
  if (p.first && isFinite(p.first[0]) && isFinite(p.first[1])) {
    sF = Math.max(sMin, Math.min(sMax, p.first[0] * d[0] + p.first[1] * d[1]));
  }
  const firstH = traufe + T * Math.max(sMax - sF, sF - sMin);
  return [
    ebene(firstH + T * sF, -T, d),               // Vorderseite: fällt Richtung A
    ebene(firstH - T * sF, T, d),                // Rückseite
  ];
}

/** Dachhöhe an (x, y) = Minimum der Ebenen. */
export function d3dDachHoehe(ebenen, x, y) {
  let h = Infinity;
  for (const e of ebenen) { const v = e.a * x + e.b * y + e.c; if (v < h) h = v; }
  return h;
}

/** Sutherland-Hodgman: Teil von pts mit f(p) <= 0 (f linear). */
function klippen(pts, f) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/**
 * Ohrenschnitt-Triangulierung eines einfachen Polygons (auch konkav).
 * @param {number[][]} pts
 * @returns {number[][][]} Dreiecke aus [x,y]
 */
export function d3dTriangulieren(pts) {
  const p = bereinigen(pts);
  if (p.length < 3) return [];
  const ccw = flaecheXY(p) > 0;
  const idx = p.map((_, i) => i);
  const kreuz = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const innen = (q, a, b, c) => {
    const d1 = kreuz(a, b, q), d2 = kreuz(b, c, q), d3 = kreuz(c, a, q);
    return ccw ? (d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12) : (d1 < -1e-12 && d2 < -1e-12 && d3 < -1e-12);
  };
  const tris = [];
  let schutz = 0;
  while (idx.length > 3 && schutz++ < 5000) {
    let geschnitten = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = p[ia], b = p[ib], c = p[ic];
      const k = kreuz(a, b, c);
      if (Math.abs(k) < 1e-12) { idx.splice(i, 1); geschnitten = true; break; }   // kollinear
      if (ccw ? k < 0 : k > 0) continue;                                           // Spiegelecke
      if (idx.some(j => j !== ia && j !== ib && j !== ic && innen(p[j], a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      geschnitten = true;
      break;
    }
    if (!geschnitten) break;   // entartet — Rest verwerfen statt Endlosschleife
  }
  if (idx.length === 3) {
    const [a, b, c] = idx.map(i => p[i]);
    if (Math.abs(kreuz(a, b, c)) > 1e-12) tris.push([a, b, c]);
  }
  return tris;
}

/**
 * Dach + Giebelwände eines Gebäudes als Dreiecke (lokal, [x,y,z]).
 * Flachdach liefert nichts — dessen Oberseite ist die extrudierte Wand.
 * @param {number[][]} pts Grundriss [x,y]
 * @param {{a:number,b:number,c:number}[]} ebenen
 * @param {number} traufe
 * @returns {{dach:number[][][], wand:number[][][]}}
 */
export function d3dDachDreiecke(pts, ebenen, traufe) {
  const dach = [], wand = [];
  const ring = bereinigen(pts);
  if (ring.length < 3 || ebenen.length === 1 && ebenen[0].a === 0 && ebenen[0].b === 0) return { dach, wand };
  const h = (x, y) => d3dDachHoehe(ebenen, x, y);

  // Dachflächen: Grundriss auf den Bereich zuschneiden, in dem die Ebene die niedrigste ist
  ebenen.forEach((ei, i) => {
    let teil = ring;
    ebenen.forEach((ej, j) => {
      if (i === j || teil.length < 3) return;
      teil = klippen(teil, q => (ei.a - ej.a) * q[0] + (ei.b - ej.b) * q[1] + (ei.c - ej.c) - 1e-9);
    });
    if (teil.length < 3 || Math.abs(flaecheXY(teil)) < 1e-4) return;
    for (const t of d3dTriangulieren(teil)) {
      dach.push(t.map(([x, y]) => [x, y, ei.a * x + ei.b * y + ei.c]));
    }
  });

  // Wandstücke von der Traufe bis zur Dachkante, je Grundrisskante an den
  // Knickstellen (Ebenenwechsel) unterteilt
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const ts = [0, 1];
    for (let i = 0; i < ebenen.length; i++) {
      for (let j = i + 1; j < ebenen.length; j++) {
        const da = ebenen[i].a - ebenen[j].a, db = ebenen[i].b - ebenen[j].b, dc = ebenen[i].c - ebenen[j].c;
        const fa = da * a[0] + db * a[1] + dc, fb = da * b[0] + db * b[1] + dc;
        if ((fa < 0) !== (fb < 0) && fa !== fb) {
          const t = fa / (fa - fb);
          if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
        }
      }
    }
    ts.sort((x, y) => x - y);
    for (let m = 0; m + 1 < ts.length; m++) {
      const t0 = ts[m], t1 = ts[m + 1];
      if (t1 - t0 < 1e-9) continue;
      const p0 = [a[0] + t0 * (b[0] - a[0]), a[1] + t0 * (b[1] - a[1])];
      const p1 = [a[0] + t1 * (b[0] - a[0]), a[1] + t1 * (b[1] - a[1])];
      const h0 = h(p0[0], p0[1]), h1 = h(p1[0], p1[1]);
      if (h0 - traufe < 0.02 && h1 - traufe < 0.02) continue;
      const u0 = [p0[0], p0[1], traufe], u1 = [p1[0], p1[1], traufe];
      const o0 = [p0[0], p0[1], Math.max(traufe, h0)], o1 = [p1[0], p1[1], Math.max(traufe, h1)];
      if (h1 - traufe >= 0.02) wand.push([u0, u1, o1]);
      if (h0 - traufe >= 0.02) wand.push([u0, o1, o0]);
    }
  }
  return { dach, wand };
}

/**
 * Module aus placePvModules (Meter-Rahmen: x Ost ab minLng, y SÜD ab maxLat)
 * → lokale 3D-Vierecke auf der Dachhaut.
 * @param {{modules:{pts:{x:number,y:number}[], edge:{x:number,y:number}[]}[], bbox:any}} res
 * @param {ReturnType<typeof d3dRahmen>} rahmen
 * @param {{ebenen?:any[], schraeg:boolean, boden?:boolean, ebeneBei?:(x:number,y:number)=>any}} p
 *   schraeg: Module liegen auf der Dachhaut; sonst aufgeständert (hohe Kante = edge)
 *   boden: Freifläche (Höhe über Gelände statt über Dach)
 *   ebeneBei: LoD2 — Ebene {a,b,c,schraeg} der Dachfläche unter der Modulmitte
 * @returns {number[][][]} je Modul 4 Ecken [x,y,z]
 */
export function d3dModule(res, rahmen, p) {
  const out = [];
  const bb = res && res.bbox;
  if (!bb || !res.modules || !res.modules.length) return out;
  const cosB = Math.cos((bb.minLat + bb.maxLat) / 2 * Math.PI / 180);
  const zuLokal = q => rahmen.nachXY(bb.minLng + q.x / (M_PRO_GRAD * cosB), bb.maxLat - q.y / M_PRO_GRAD);
  for (const m of res.modules) {
    if (!m.pts || m.pts.length < 4) continue;
    const hoch = new Set(m.edge || []);
    // LoD2: Ebene der Dachfläche unter der Modulmitte (p.ebeneBei), sonst Dachmodell
    let ebene = null, schraeg = p.schraeg;
    if (p.ebeneBei) {
      const lok = m.pts.map(zuLokal);
      const e = p.ebeneBei(lok.reduce((s, q) => s + q[0], 0) / lok.length, lok.reduce((s, q) => s + q[1], 0) / lok.length);
      if (e) { ebene = [e]; schraeg = e.schraeg; }
    }
    out.push(m.pts.map(q => {
      const [x, y] = zuLokal(q);
      let z;
      if (p.boden) z = FF_UNTEN + (hoch.has(q) ? FF_HUB : 0);
      else {
        const dach = d3dDachHoehe(ebene || p.ebenen || [{ a: 0, b: 0, c: 0 }], x, y);
        z = schraeg ? dach + MODUL_ABSTAND : dach + AUFST_UNTEN + (hoch.has(q) ? AUFST_HUB : 0);
      }
      return [x, y, z];
    }));
  }
  return out;
}

/** Normale eines Dreiecks (normiert, z ≥ 0 bevorzugt nicht erzwungen). */
export function d3dNormale(t) {
  const [a, b, c] = t;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Helligkeit 0.55…1 für eine Fläche bei Licht aus Südwest-oben (beidseitig). */
export function d3dSchattierung(t) {
  const n = d3dNormale(t);
  const L = [-0.42, -0.55, 0.72];   // Richtung zum Licht, normiert genug
  const l = Math.hypot(L[0], L[1], L[2]);
  const dot = Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / l;
  return 0.55 + 0.45 * dot;
}

/* ── Beliebige 3D-Flächen (LoD2-Dachflächen und Giebelwände) ──────────────── */

function _newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/**
 * Ebene h = a·x + b·y + c durch einen (fast) ebenen 3D-Ring [x,y,z] — für die
 * Modulhöhe auf einer LoD2-Dachfläche. null bei senkrechten Flächen.
 */
export function d3dEbeneAusPunkten(pts) {
  if (!pts || pts.length < 3) return null;
  const [nx, ny, nz] = _newell(pts);
  if (Math.abs(nz) < 1e-9 * (Math.abs(nx) + Math.abs(ny) + 1)) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= pts.length; cy /= pts.length; cz /= pts.length;
  return { a: -nx / nz, b: -ny / nz, c: cz + (nx * cx + ny * cy) / nz };
}

/**
 * Dreiecke eines beliebig im Raum liegenden, ebenen Polygons [x,y,z]: projiziert
 * auf die Koordinatenebene, in der es am größten erscheint, dort per
 * Ohrenschnitt zerlegt, Eckpunkte unverändert zurück.
 * @returns {number[][][]}
 */
export function d3dPolygon3dDreiecke(pts) {
  if (!pts || pts.length < 3) return [];
  const n = _newell(pts).map(Math.abs);
  const weg = n[2] >= n[0] && n[2] >= n[1] ? 2 : n[0] >= n[1] ? 0 : 1;   // diese Achse entfällt
  const [u, v] = [0, 1, 2].filter(k => k !== weg);
  const flach = pts.map((p, i) => [p[u], p[v], i]);
  return d3dTriangulieren(flach).map(t => t.map(q => pts[q[2]]));
}
