import { describe, expect, it } from 'vitest';
import { bereinigeKleinbauten, flaecheM2, vereinigePolygone } from '../src/lib/gebaeude-geometrie.js';

// Rechteck in Metern ab (x,y) am Ursprung 53°N/10°E
const LAT = 53, LNG = 10;
const dLat = m => m / 111194.9;
const dLng = m => m / (111194.9 * Math.cos(LAT * Math.PI / 180));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  .map(([px, py]) => ({ lat: LAT + dLat(py), lng: LNG + dLng(px) }));

describe('vereinigePolygone', () => {
  it('fügt zwei aneinanderstoßende Rechtecke zu einer Kontur zusammen', () => {
    const r = vereinigePolygone(rect(0, 0, 10, 10), rect(10, 0, 5, 10));
    expect(r.methode).toBe('vereinigung');
    expect(r.flaecheM2).toBeCloseTo(150, 0);
    expect(r.coords).toHaveLength(4);
  });
  it('vereinigt sich überlappende Rechtecke (L-Form)', () => {
    const r = vereinigePolygone(rect(0, 0, 10, 10), rect(5, 5, 10, 10));
    expect(r.methode).toBe('vereinigung');
    expect(r.flaecheM2).toBeCloseTo(175, 0);
    expect(r.coords).toHaveLength(8);
  });
  it('ein Polygon vollständig im anderen ergibt das größere', () => {
    const r = vereinigePolygone(rect(0, 0, 20, 20), rect(5, 5, 3, 3));
    expect(r.methode).toBe('vereinigung');
    expect(r.flaecheM2).toBeCloseTo(400, 0);
  });
  it('getrennte Gebäude → konvexe Hülle', () => {
    const r = vereinigePolygone(rect(0, 0, 10, 10), rect(20, 0, 10, 10));
    expect(r.methode).toBe('huelle');
    expect(r.flaecheM2).toBeCloseTo(300, 0);
  });
});

describe('bereinigeKleinbauten', () => {
  it('schluckt einen Dachaufbau innerhalb des Gebäudes', () => {
    const gross = { coords: rect(0, 0, 20, 10), name: 'gross' };
    const aufbau = { coords: rect(5, 3, 4, 4), name: 'aufbau' };
    const r = bereinigeKleinbauten([gross, aufbau], { minFlaecheM2: 30 });
    expect(r.items).toHaveLength(1);
    expect(r.verworfen).toBe(1);
    expect(flaecheM2(r.items[0].coords)).toBeCloseTo(200, 0);
  });
  it('rechnet einen angrenzenden Anbau in den Grundriss ein', () => {
    const r = bereinigeKleinbauten([{ coords: rect(0, 0, 20, 10) }, { coords: rect(20, 0, 3, 5) }], { minFlaecheM2: 30 });
    expect(r.items).toHaveLength(1);
    expect(r.angefuegt).toBe(1);
    expect(flaecheM2(r.items[0].coords)).toBeCloseTo(215, 0);
  });
  it('verwirft isolierte Kleinbauten, lässt große Gebäude unberührt', () => {
    const r = bereinigeKleinbauten([{ coords: rect(0, 0, 20, 10) }, { coords: rect(50, 50, 4, 4) }, { coords: rect(100, 0, 30, 10) }], { minFlaecheM2: 30 });
    expect(r.items).toHaveLength(2);
    expect(r.verworfen).toBe(1);
  });
  it('Mindestfläche 0 schaltet die Bereinigung ab', () => {
    const items = [{ coords: rect(0, 0, 20, 10) }, { coords: rect(5, 3, 4, 4) }];
    expect(bereinigeKleinbauten(items, { minFlaecheM2: 0 }).items).toHaveLength(2);
  });
});
