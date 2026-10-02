// Vitest-Tests für lib/dach-3d.js (Dachformen und Module der 3D-Ansicht).
import { describe, it, expect } from 'vitest';
import {
  d3dDachEbenen, d3dDachHoehe, d3dDachDreiecke, d3dTriangulieren, d3dModule, d3dRahmen,
  d3dSchattierung,
} from '../src/lib/dach-3d.js';

// 20 m (Ost-West) × 10 m (Nord-Süd), Mitte im Ursprung
const RECHTECK = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
const T35 = Math.tan(35 * Math.PI / 180);
const flaeche = tris => tris.reduce((s, [a, b, c]) =>
  s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0);

describe('d3dDachEbenen / d3dDachHoehe', () => {
  it('Flachdach = eine waagrechte Ebene auf Traufhöhe', () => {
    const e = d3dDachEbenen('flach', RECHTECK, { traufe: 9 });
    expect(e).toHaveLength(1);
    expect(d3dDachHoehe(e, 3, 2)).toBe(9);
  });
  it('Satteldach Süd: Traufe an Nord-/Südkante, First mittig, Höhe = tan(Neigung)·halbe Tiefe', () => {
    const e = d3dDachEbenen('sattel', RECHTECK, { azimut: 180, neigung: 35, traufe: 6 });
    expect(d3dDachHoehe(e, 0, -5)).toBeCloseTo(6, 6);
    expect(d3dDachHoehe(e, 0, 5)).toBeCloseTo(6, 6);
    expect(d3dDachHoehe(e, 7, 0)).toBeCloseTo(6 + 5 * T35, 6);
    // First läuft Ost-West: entlang x konstant
    expect(d3dDachHoehe(e, -9, 0)).toBeCloseTo(d3dDachHoehe(e, 9, 0), 6);
  });
  it('Satteldach mit Azimut 90°: First läuft Nord-Süd', () => {
    const e = d3dDachEbenen('sattel', RECHTECK, { azimut: 90, neigung: 35, traufe: 6 });
    expect(d3dDachHoehe(e, 0, 0)).toBeCloseTo(6 + 10 * T35, 6);
    expect(d3dDachHoehe(e, 10, 0)).toBeCloseTo(6, 6);
  });
  it('fehlender Azimut → 180 (wie die Modulplatzierung), fehlende Neigung → Vorgabe', () => {
    const a = d3dDachEbenen('sattel', RECHTECK, { traufe: 0 });
    const b = d3dDachEbenen('sattel', RECHTECK, { azimut: 180, neigung: 35, traufe: 0 });
    expect(d3dDachHoehe(a, 1, 1)).toBeCloseTo(d3dDachHoehe(b, 1, 1), 9);
  });
  it('manueller First verschiebt die Firstlinie (kürzere Seite endet höher)', () => {
    const e = d3dDachEbenen('sattel', RECHTECK, { azimut: 180, neigung: 45, traufe: 0, first: [0, 2] });
    // First bei y = 2 → längere Seite (Süd, 7 m) erreicht die Traufe
    expect(d3dDachHoehe(e, 0, 2)).toBeCloseTo(7, 6);
    expect(d3dDachHoehe(e, 0, -5)).toBeCloseTo(0, 6);
    expect(d3dDachHoehe(e, 0, 5)).toBeCloseTo(4, 6);
  });
  it('Pultdach fällt zur Azimut-Seite', () => {
    const e = d3dDachEbenen('pult', RECHTECK, { azimut: 180, neigung: 15, traufe: 3 });
    expect(d3dDachHoehe(e, 0, -5)).toBeCloseTo(3, 6);                         // Süd = tief
    expect(d3dDachHoehe(e, 0, 5)).toBeCloseTo(3 + 10 * Math.tan(15 * Math.PI / 180), 6);
  });
  it('Walmdach: auch die Giebelseiten fallen auf Traufhöhe', () => {
    const e = d3dDachEbenen('walm', RECHTECK, { azimut: 180, neigung: 30, traufe: 4 });
    expect(d3dDachHoehe(e, 10, 0)).toBeCloseTo(4, 6);
    expect(d3dDachHoehe(e, -10, 0)).toBeCloseTo(4, 6);
    expect(d3dDachHoehe(e, 0, 0)).toBeCloseTo(4 + 5 * Math.tan(30 * Math.PI / 180), 6);
  });
});

describe('d3dTriangulieren', () => {
  it('Rechteck → 2 Dreiecke mit voller Fläche', () => {
    const t = d3dTriangulieren(RECHTECK);
    expect(t).toHaveLength(2);
    expect(flaeche(t)).toBeCloseTo(200, 6);
  });
  it('konkaves L, beide Umlaufrichtungen', () => {
    const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    expect(flaeche(d3dTriangulieren(L))).toBeCloseTo(64, 6);
    expect(flaeche(d3dTriangulieren([...L].reverse()))).toBeCloseTo(64, 6);
  });
  it('kollineare und doppelte Punkte', () => {
    const p = [[0, 0], [5, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(flaeche(d3dTriangulieren(p))).toBeCloseTo(100, 6);
  });
});

describe('d3dDachDreiecke', () => {
  it('Flachdach erzeugt keine Dreiecke', () => {
    const r = d3dDachDreiecke(RECHTECK, d3dDachEbenen('flach', RECHTECK, { traufe: 6 }), 6);
    expect(r.dach).toHaveLength(0);
    expect(r.wand).toHaveLength(0);
  });
  it('Satteldach: Dachflächen decken den Grundriss, Giebel nur an den Schmalseiten', () => {
    const e = d3dDachEbenen('sattel', RECHTECK, { azimut: 180, neigung: 35, traufe: 6 });
    const r = d3dDachDreiecke(RECHTECK, e, 6);
    expect(flaeche(r.dach)).toBeCloseTo(200, 4);
    // jede Dachecke liegt auf der Dachfläche
    for (const t of r.dach) for (const [x, y, z] of t) expect(z).toBeCloseTo(d3dDachHoehe(e, x, y), 6);
    // Giebelwände: nur auf x = ±10
    expect(r.wand.length).toBeGreaterThan(0);
    for (const t of r.wand) for (const [x] of t) expect(Math.abs(x)).toBeCloseTo(10, 6);
    // Giebelfläche je Seite = ½ · 10 · 5·tan35
    const giebel = r.wand.reduce((s, [a, b, c]) => {
      const u = [b[1] - a[1], b[2] - a[2]], v = [c[1] - a[1], c[2] - a[2]];
      return s + Math.abs(u[0] * v[1] - u[1] * v[0]) / 2;
    }, 0);
    expect(giebel).toBeCloseTo(2 * 0.5 * 10 * 5 * T35, 4);
  });
  it('Walmdach: keine Giebelwände, vier Dachflächen', () => {
    const e = d3dDachEbenen('walm', RECHTECK, { azimut: 180, neigung: 30, traufe: 4 });
    const r = d3dDachDreiecke(RECHTECK, e, 4);
    expect(r.wand).toHaveLength(0);
    expect(flaeche(r.dach)).toBeCloseTo(200, 4);
  });
});

describe('d3dModule', () => {
  // Rahmen und Modul-Bbox mit gleichem Bezugspunkt (8.0, 50.0) → Meter direkt vergleichbar
  const rahmen = d3dRahmen(8.0, 50.0);
  const bbox = { minLng: 8.0, maxLng: 8.0, minLat: 50.0, maxLat: 50.0 };
  const modul = () => {
    const pts = [{ x: 1, y: 1 }, { x: 2.1, y: 1 }, { x: 2.1, y: 2.5 }, { x: 1, y: 2.5 }];
    return { modules: [{ pts, edge: [pts[0], pts[1]] }], bbox };
  };
  it('rechnet den Süd-Meter-Rahmen in lokale Ost/Nord-Meter um', () => {
    const [q] = d3dModule(modul(), rahmen, { ebenen: [{ a: 0, b: 0, c: 10 }], schraeg: true });
    expect(q[0][0]).toBeCloseTo(1, 3);
    expect(q[0][1]).toBeCloseTo(-1, 3);       // y nach Süden → negativ Nord
    expect(q[2][1]).toBeCloseTo(-2.5, 3);
    expect(q.every(p => Math.abs(p[2] - 10.12) < 1e-9)).toBe(true);
  });
  it('Flachdach: hohe Kante (edge) aufgeständert', () => {
    const [q] = d3dModule(modul(), rahmen, { ebenen: [{ a: 0, b: 0, c: 10 }], schraeg: false });
    expect(q[0][2]).toBeCloseTo(10.4, 6);
    expect(q[1][2]).toBeCloseTo(10.4, 6);
    expect(q[2][2]).toBeCloseTo(10.15, 6);
  });
  it('Freifläche über Gelände', () => {
    const [q] = d3dModule(modul(), rahmen, { boden: true, schraeg: false });
    expect(q[0][2]).toBeCloseTo(1.25, 6);
    expect(q[3][2]).toBeCloseTo(0.7, 6);
  });
  it('leere Ergebnisse', () => {
    expect(d3dModule(null, rahmen, { schraeg: true })).toEqual([]);
    expect(d3dModule({ modules: [], bbox }, rahmen, { schraeg: true })).toEqual([]);
  });
});

describe('d3dSchattierung', () => {
  it('liegt zwischen 0.55 und 1, beidseitig gleich', () => {
    const t = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const s = d3dSchattierung(t);
    expect(s).toBeGreaterThanOrEqual(0.55);
    expect(s).toBeLessThanOrEqual(1);
    expect(d3dSchattierung([t[0], t[2], t[1]])).toBeCloseTo(s, 9);
  });
});
