// Vitest-Tests für lib/dach-aufbauten.js (Aufbauten auf Flachdächern aus dem nDOM).
import { describe, it, expect } from 'vitest';
import { aufbautenSammler, gruppiere, rechteckUm, hauptachse, AUF_ABSTAND } from '../src/lib/dach-aufbauten.js';

/** nDOM-Raster 0,5 m über [0,50]×[0,40] (UTM-artig, Zeile 0 oben) mit Höhenfunktion h(x, y). */
function raster(h, dx = 0.5, w = 50, hh = 40) {
  const breite = Math.round(w / dx), hoehe = Math.round(hh / dx);
  const daten = new Float32Array(breite * hoehe);
  for (let j = 0; j < hoehe; j++) for (let i = 0; i < breite; i++) {
    daten[j * breite + i] = h((i + 0.5) * dx, hh - (j + 0.5) * dx);
  }
  return { breite, hoehe, x0: 0, y0: hh, dx, dy: dx, epsg: 25832, nodata: null, daten };
}
const ring = [[10, 10], [40, 10], [40, 30], [10, 30]];          // Flachdach 30 × 20 m
const imDach = (x, y) => x >= 10 && x <= 40 && y >= 10 && y <= 30;

describe('aufbautenSammler', () => {
  it('findet einen Technikaufbau und ignoriert Rauschen', () => {
    const h = (x, y) => {
      if (!imDach(x, y)) return 0;
      if (x >= 20 && x < 23 && y >= 15 && y < 17) return 10.5;   // Aufbau 3 × 2 m, 2,5 m hoch
      if (x >= 30 && x < 30.5 && y >= 20 && y < 20.5) return 9.6; // einzelnes Feld 0,25 m² → Rauschen
      return 8;
    };
    const s = aufbautenSammler([{ id: 1, ring }]);
    s.aufnehmen(raster(h));
    const e = s.ergebnis().gebaeude.get(1);
    expect(e.dachM).toBe(8);
    expect(e.aufbauten).toHaveLength(1);
    const a = e.aufbauten[0];
    expect(a.hoeheM).toBe(2.5);
    expect(a.obenM).toBe(10.5);
    expect(a.flaecheM2).toBeCloseTo(6, 6);
    // Rechteck = Aufbau + Abstand ringsum
    const xs = a.ring.map(p => p[0]), ys = a.ring.map(p => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(20 - AUF_ABSTAND, 6);
    expect(Math.max(...xs)).toBeCloseTo(23 + AUF_ABSTAND, 6);
    expect(Math.min(...ys)).toBeCloseTo(15 - AUF_ABSTAND, 6);
    expect(Math.max(...ys)).toBeCloseTo(17 + AUF_ABSTAND, 6);
  });
  it('größerer höherer Dachteil ist kein Aufbau', () => {
    const h = (x, y) => (!imDach(x, y) ? 0 : x >= 25 ? 12 : 8);
    const s = aufbautenSammler([{ id: 1, ring }]);
    s.aufnehmen(raster(h));
    expect(s.ergebnis().gebaeude.get(1).aufbauten).toHaveLength(0);
  });
  it('grobes Raster (5 m) → kein Ergebnis, nur Vermerk', () => {
    const s = aufbautenSammler([{ id: 1, ring }]);
    s.aufnehmen(raster(() => 8, 5));
    const e = s.ergebnis();
    expect(e.grob).toBe(true);
    expect(e.gebaeude.size).toBe(0);
  });
  it('Teilstücke werden zusammengeführt', () => {
    const h = (x, y) => (!imDach(x, y) ? 0 : x >= 24 && x < 26 && y >= 18 && y < 22 ? 11 : 8);
    const r = raster(h);
    // in zwei Hälften (links/rechts) teilen
    const halb = (von, bis) => {
      const breite = bis - von, daten = new Float32Array(breite * r.hoehe);
      for (let j = 0; j < r.hoehe; j++) for (let i = 0; i < breite; i++) daten[j * breite + i] = r.daten[j * r.breite + von + i];
      return { ...r, breite, x0: von * r.dx, daten };
    };
    const s = aufbautenSammler([{ id: 1, ring }]);
    s.aufnehmen(halb(0, 50)); s.aufnehmen(halb(50, 100));
    const a = s.ergebnis().gebaeude.get(1).aufbauten;
    expect(a).toHaveLength(1);                     // über die Kachelgrenze x = 25 hinweg eine Gruppe
    expect(a[0].flaecheM2).toBeCloseTo(8, 6);
  });
});

describe('Hilfen', () => {
  it('gruppiere verbindet auch diagonal', () => {
    const f = [{ x: 0.25, y: 0.25, v: 1 }, { x: 0.75, y: 0.75, v: 1 }, { x: 5.25, y: 5.25, v: 1 }];
    expect(gruppiere(f, 0.5).map(g => g.length).sort()).toEqual([1, 2]);
  });
  it('hauptachse und rechteckUm folgen einem gedrehten Gebäude', () => {
    const w = 30 * Math.PI / 180, c = Math.cos(w), s = Math.sin(w);
    const rot = ([x, y]) => [x * c - y * s, x * s + y * c];
    const r = [[0, 0], [20, 0], [20, 10], [0, 10]].map(rot);
    expect(((hauptachse(r) * 180 / Math.PI) % 90 + 90) % 90).toBeCloseTo(30, 6);
    const rect = rechteckUm([{ x: 0, y: 0 }, { x: 2, y: 0 }].map(p => { const [x, y] = rot([p.x, p.y]); return { x, y }; }), 0.5, w, 0);
    const kante = Math.hypot(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]);
    expect(kante).toBeCloseTo(2.5, 6);             // 2 m Abstand + je halbe Rasterweite
  });
});
