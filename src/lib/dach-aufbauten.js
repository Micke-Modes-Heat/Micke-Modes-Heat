// ── lib/dach-aufbauten.js — Aufbauten auf Flachdächern aus dem nDOM erkennen ─
// Reiner Rechenteil (ohne DOM/fetch). Gefüttert mit denselben nDOM-Teilstücken
// wie lib/hoehenmodell hmSammler (56-hoehenmodell.js); Übernahme ins Gebäude in
// 25-pv-modus.js (g.dachAufbauten).
//
// Vorgehen je Flachdach:
//   • alle Rasterfelder im Grundriss mit Abstand zum Rand (Traufe/Lageversatz)
//     sammeln — wie hmSammler, aber mit Lage;
//   • Dachhöhe = Median der Dachfelder (≥ 2 m über Gelände);
//   • Felder mindestens AUF_MIN_HOEHE darüber = Aufbau (Technik, Treppenhaus-
//     köpfe, Lüftungszentralen, überhängende Bäume …);
//   • benachbarte Felder zu Gruppen verbinden; jede Gruppe wird ein Rechteck
//     entlang der Gebäudeachse, um AUF_ABSTAND vergrößert (Wartungs-/Montageraum).
// Große Gruppen (über AUF_MAX_FLAECHE) sind eher höhere Dachteile als Aufbauten
// und bleiben unberührt. Grobe Raster (> AUF_MAX_AUFL, z. B. BW DOM5) taugen
// nicht für Aufbauten — dann gibt es kein Ergebnis, nur den Vermerk „grob".
// Flache Aufbauten (Lichtkuppeln, RWA, ~0,3–0,6 m) bleiben im Rauschen; dafür
// gilt weiter ein (kleinerer) pauschaler Hindernisabschlag.

/** Mindesthöhe über der Dachfläche (m). */
export const AUF_MIN_HOEHE = 1.0;
/** Gruppen bis zu dieser Fläche (m²) gelten als Aufbau. */
export const AUF_MAX_FLAECHE = 60;
/** Kleinere Gruppen sind Rauschen (m²). */
export const AUF_MIN_FLAECHE = 0.5;
/** Freiraum rund um einen Aufbau (m). */
export const AUF_ABSTAND = 0.5;
/** Gröbere Raster taugen nicht (m Rasterweite). */
export const AUF_MAX_AUFL = 1.0;
const DACH_MIN_M = 2;
const MIN_FELDER = 12;

function _imRing(x, y, ring) {
  let innen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) innen = !innen;
  }
  return innen;
}

function _randAbstand(x, y, ring) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
    m = Math.min(m, Math.hypot(x - ax - t * vx, y - ay - t * vy));
  }
  return m;
}

function _box(ring) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}

/** Hauptachse eines Rings (rad, mathematisch) — Kanten nach Länge gewichtet, mod 90°. */
export function hauptachse(ring) {
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const l = Math.hypot(bx - ax, by - ay), w = Math.atan2(by - ay, bx - ax);
    sx += l * Math.cos(4 * w); sy += l * Math.sin(4 * w);
  }
  return Math.hypot(sx, sy) < 1e-9 ? 0 : Math.atan2(sy, sx) / 4;
}

function _median(werte) {
  const s = [...werte].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Felder zu Gruppen verbinden (8er-Nachbarschaft im Raster der Weite d).
 * @param {{x:number, y:number, v:number}[]} felder
 * @returns {{x:number, y:number, v:number}[][]}
 */
export function gruppiere(felder, d) {
  const schluessel = (i, j) => i + ',' + j;
  const karte = new Map();
  for (const f of felder) karte.set(schluessel(Math.floor(f.x / d), Math.floor(f.y / d)), f);
  const gesehen = new Set(), gruppen = [];
  for (const [k0, f0] of karte) {
    if (gesehen.has(k0)) continue;
    gesehen.add(k0);
    const gruppe = [f0], stapel = [f0];
    while (stapel.length) {
      const f = stapel.pop();
      const i = Math.floor(f.x / d), j = Math.floor(f.y / d);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const k = schluessel(i + di, j + dj);
        if (gesehen.has(k) || !karte.has(k)) continue;
        gesehen.add(k);
        const n = karte.get(k);
        gruppe.push(n); stapel.push(n);
      }
    }
    gruppen.push(gruppe);
  }
  return gruppen;
}

/**
 * Rechteck um eine Feldgruppe entlang der Achse `w` (rad), um `rand` vergrößert.
 * @returns {number[][]} 4 Ecken [x, y]
 */
export function rechteckUm(felder, d, w, rand) {
  const c = Math.cos(w), s = Math.sin(w);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const f of felder) {
    const u = f.x * c + f.y * s, v = -f.x * s + f.y * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const e = d / 2 + rand;
  u0 -= e; v0 -= e; u1 += e; v1 += e;
  const zurueck = (u, v) => [u * c - v * s, u * s + v * c];
  return [zurueck(u0, v0), zurueck(u1, v0), zurueck(u1, v1), zurueck(u0, v1)];
}

/**
 * Sammler für Dachaufbauten — Schnittstelle wie hmSammler (aufnehmen/ergebnis).
 * @param {{id:any, ring:number[][]}[]} gebaeude  Flachdächer, Ringe in UTM
 */
export function aufbautenSammler(gebaeude) {
  const gebs = (gebaeude || []).filter(g => g.ring?.length >= 3).map(g => ({ ...g, box: _box(g.ring) }));
  /** @type {Map<any, Map<string, {x:number, y:number, v:number}>>} */
  const felderJe = new Map();
  let aufl = null, grob = false;

  function aufnehmen(r) {
    if (!(r?.dx > 0)) return;
    if (r.dx > AUF_MAX_AUFL + 1e-9) { grob = true; return; }
    aufl = aufl == null ? r.dx : Math.min(aufl, r.dx);
    const rx0 = r.x0, ry1 = r.y0, rx1 = r.x0 + r.breite * r.dx, ry0 = r.y0 - r.hoehe * r.dy;
    const rand = Math.max(0.75, r.dx);
    for (const g of gebs) {
      const [gx0, gy0, gx1, gy1] = g.box;
      if (gx1 < rx0 || gx0 > rx1 || gy1 < ry0 || gy0 > ry1) continue;
      const i0 = Math.max(0, Math.floor((gx0 - r.x0) / r.dx)), i1 = Math.min(r.breite - 1, Math.floor((gx1 - r.x0) / r.dx));
      const j0 = Math.max(0, Math.floor((r.y0 - gy1) / r.dy)), j1 = Math.min(r.hoehe - 1, Math.floor((r.y0 - gy0) / r.dy));
      const karte = felderJe.get(g.id) || new Map();
      for (let j = j0; j <= j1; j++) {
        const y = r.y0 - (j + 0.5) * r.dy;
        for (let i = i0; i <= i1; i++) {
          const x = r.x0 + (i + 0.5) * r.dx;
          const v = r.daten[j * r.breite + i];
          if (!Number.isFinite(v) || (r.nodata != null && v === r.nodata) || v < -50 || v > 500) continue;
          if (!_imRing(x, y, g.ring) || _randAbstand(x, y, g.ring) < rand) continue;
          karte.set(Math.floor(x / r.dx) + ',' + Math.floor(y / r.dx), { x, y, v });
        }
      }
      if (karte.size) felderJe.set(g.id, karte);
    }
  }

  /**
   * @returns {{aufl:number|null, grob:boolean, gebaeude: Map<any, {dachM:number, felder:number,
   *   aufbauten:{ring:number[][], hoeheM:number, obenM:number, flaecheM2:number}[]}>}}
   */
  function ergebnis() {
    const out = new Map();
    if (aufl == null) return { aufl, grob, gebaeude: out };
    for (const g of gebs) {
      const felder = [...(felderJe.get(g.id)?.values() || [])];
      const dach = felder.filter(f => f.v >= DACH_MIN_M);
      if (dach.length < MIN_FELDER) continue;
      const dachM = _median(dach.map(f => f.v));
      const hoch = dach.filter(f => f.v >= dachM + AUF_MIN_HOEHE);
      const w = hauptachse(g.ring);
      const aufbauten = [];
      for (const gr of gruppiere(hoch, aufl)) {
        const flaeche = gr.length * aufl * aufl;
        if (flaeche < AUF_MIN_FLAECHE - 1e-9 || flaeche > AUF_MAX_FLAECHE) continue;
        const oben = Math.max(...gr.map(f => f.v));
        aufbauten.push({
          ring: rechteckUm(gr, aufl, w, AUF_ABSTAND),
          hoeheM: Math.round((oben - dachM) * 10) / 10,
          obenM: Math.round(oben * 10) / 10,
          flaecheM2: Math.round(flaeche * 10) / 10,
        });
      }
      out.set(g.id, { dachM: Math.round(dachM * 10) / 10, felder: felder.length, aufbauten });
    }
    return { aufl, grob, gebaeude: out };
  }

  return { aufnehmen, ergebnis };
}
