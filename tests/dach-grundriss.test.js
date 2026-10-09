import { describe, expect, it } from 'vitest';
import { dachAusGrundriss, dachAusGrundrissGebaeude } from '../src/lib/dach-grundriss.js';

const summeGrund = d => d.flaechen.reduce((s, f) => s + f.grundM2, 0);
const nachAz = d => [...new Set(d.flaechen.map(f => f.azimut))].sort((a, b) => a - b);
const dreh = (pts, grad) => { const w = grad * Math.PI / 180; return pts.map(([x, y]) => [x * Math.cos(w) - y * Math.sin(w), x * Math.sin(w) + y * Math.cos(w)]); };

describe('dachAusGrundriss', () => {
  it('Rechteck → Satteldach mit zwei Flächen, First entlang der Längsseite', () => {
    const d = dachAusGrundriss([[0, 0], [12, 0], [12, 8], [0, 8]], { form: 'sattel', neigung: 35, traufe: 6 });
    expect(d.flaechen).toHaveLength(2);
    expect(nachAz(d)).toEqual([0, 180]);
    expect(summeGrund(d)).toBeCloseTo(96, 0);
    expect(d.firstH).toBeCloseTo(6 + 4 * Math.tan(35 * Math.PI / 180), 3);
    expect(d.waende).toHaveLength(2);                       // zwei Giebel
  });
  it('Walmdach: vier Flächen, keine Giebel', () => {
    const d = dachAusGrundriss([[0, 0], [16, 0], [16, 10], [0, 10]], { form: 'walm', neigung: 30, traufe: 5 });
    expect(nachAz(d)).toEqual([0, 90, 180, 270]);
    expect(summeGrund(d)).toBeCloseTo(160, 0);
    expect(d.waende).toHaveLength(0);
  });
  it('L-Form: Nebenflügel endet am First des Hauptflügels, Kehle statt Lücke', () => {
    const L = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];
    const d = dachAusGrundriss(L, { form: 'sattel', neigung: Math.atan(0.75) * 180 / Math.PI, traufe: 6 });
    expect(d.fluegel).toBe(2);
    expect(summeGrund(d)).toBeCloseTo(20 * 8 + 8 * 12, 0);  // Dach deckt den Grundriss genau
    expect(nachAz(d)).toEqual([0, 90, 180, 270]);
    const sued = d.flaechen.filter(f => f.azimut === 180);
    expect(sued).toHaveLength(1);
    expect(sued[0].grundM2).toBeCloseTo(80, 0);            // Südseite des Hauptflügels ungestört
    const nord = d.flaechen.find(f => f.azimut === 0);
    expect(nord.grundM2).toBeCloseTo(80 - 16, 0);          // minus Kehldreieck
    // durchgehendes Dach: kein Punkt ragt über den First
    for (const f of d.flaechen) for (const p of f.ring) expect(p[2]).toBeLessThanOrEqual(9 + 1e-6);
    expect(d.waende).toHaveLength(3);                       // Giebel Ost + West am Hauptflügel, Nord am Nebenflügel
  });
  it('T-Form und Drehung: Flächen folgen dem gedrehten Gebäude', () => {
    const T = [[0, 0], [30, 0], [30, 8], [19, 8], [19, 20], [11, 20], [11, 8], [0, 8]];
    const d = dachAusGrundriss(dreh(T, 30), { form: 'sattel', neigung: 35, traufe: 6 });
    expect(d.fluegel).toBe(2);
    expect(summeGrund(d)).toBeCloseTo(30 * 8 + 8 * 12, 0);
    expect(nachAz(d)).toEqual([60, 150, 240, 330]);
  });
  it('millimetergenau schiefe Kanten (Kartenumrechnung): Giebel werden trotzdem erkannt', () => {
    const L = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]].map(([x, y]) => [x + 0.0013 * y, y - 0.0011 * x]);
    const d = dachAusGrundriss(dreh(L, 15), { form: 'sattel', neigung: 35, traufe: 6 });
    expect(d.waende).toHaveLength(3);
    expect(summeGrund(d)).toBeCloseTo(256, 0);
  });
  it('U-Form: drei Flügel, Dach deckt den Grundriss lückenlos', () => {
    const U = [[0, 0], [20, 0], [20, 20], [14, 20], [14, 6], [6, 6], [6, 20], [0, 20]];
    const d = dachAusGrundriss(U, { form: 'sattel', neigung: 35, traufe: 6 });
    expect(d.fluegel).toBe(3);
    expect(summeGrund(d)).toBeCloseTo(20 * 6 + 2 * 6 * 14, 0);
  });
  it('Walm auf L-Form deckt ebenfalls lückenlos', () => {
    const L = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];
    const d = dachAusGrundriss(L, { form: 'walm', neigung: 30, traufe: 6 });
    expect(summeGrund(d)).toBeCloseTo(20 * 8 + 8 * 12, 0);
  });
  it('Pultdach fällt zur Südseite, Flachdach ist eine Fläche', () => {
    const p = dachAusGrundriss([[0, 0], [10, 0], [10, 6], [0, 6]], { form: 'pult', neigung: 10, traufe: 4 });
    expect(p.flaechen).toHaveLength(1);
    expect(p.flaechen[0].azimut).toBe(180);
    expect(p.waende.length).toBeGreaterThanOrEqual(3);      // hohe Seite + zwei schräge Seiten
    const f = dachAusGrundriss([[0, 0], [10, 0], [10, 6], [0, 6]], { form: 'flach', traufe: 4 });
    expect(f.flaechen[0].neigung).toBe(0);
    expect(f.waende).toHaveLength(0);
  });
  it('vorgegebener Azimut dreht den First eines einzelnen Flügels', () => {
    const d = dachAusGrundriss([[0, 0], [12, 0], [12, 10], [0, 10]], { form: 'sattel', azimut: 90 });
    expect(nachAz(d)).toEqual([90, 270]);
  });
  it('schräge Kanten → null (bisheriges Modell bleibt)', () => {
    expect(dachAusGrundriss([[0, 0], [10, 0], [14, 6], [0, 6]], { form: 'sattel' })).toBeNull();
  });
});

describe('dachAusGrundrissGebaeude', () => {
  // L-Form 40 × 12 m + 12 × 30 m Flügel bei 49° N, 4 Geschosse
  const M = 111320, LAT = 49, LNG = 8.4, KX = M * Math.cos(LAT * Math.PI / 180);
  const ll = ([x, y]) => ({ lat: LAT + y / M, lng: LNG + x / KX });
  const L = [[0, 0], [40, 0], [40, 12], [12, 12], [12, 30], [0, 30]].map(ll);

  it('verwinkelter Grundriss → mehrere Flügel, First deutlich niedriger als ein Dach über alles', () => {
    const d = dachAusGrundrissGebaeude({ polygon: L, dachform: 'sattel', stockwerke: 4 });
    expect(d.fluegel).toBeGreaterThanOrEqual(2);
    expect(d.lod2.quelle).toBe('grundriss');
    expect(d.lod2.traufeM).toBe(12);
    // Flügel 12 m tief bei 35°: First ≈ Traufe + 6 · tan 35° ≈ 16,2 m
    expect(d.lod2.firstM).toBeGreaterThan(15.5);
    expect(d.lod2.firstM).toBeLessThan(17);
    expect(d.dachFlaechen.length).toBeGreaterThanOrEqual(4);
    expect(d.dachFlaechen[0].punkte[0]).toHaveLength(3);   // [lat, lng, h]
  });
  it('Neigung und Dachform des Gebäudes gelten, Flachdach ohne First', () => {
    const steil = dachAusGrundrissGebaeude({ polygon: L, dachform: 'sattel', dachNeigung: 45, stockwerke: 4 });
    expect(steil.lod2.firstM).toBeCloseTo(18, 0);
    const flach = dachAusGrundrissGebaeude({ polygon: L, dachform: 'flach', stockwerke: 4 });
    expect(flach.lod2.firstM).toBeCloseTo(12, 5);
  });
  it('schräge Kanten → null (bisheriges Ein-Dach-Modell)', () => {
    const schief = [[0, 0], [30, 0], [40, 15], [0, 20]].map(ll);
    expect(dachAusGrundrissGebaeude({ polygon: schief, dachform: 'sattel', stockwerke: 2 })).toBeNull();
  });
});
