import { describe, it, expect } from 'vitest';
import { kuppelVerbindungen, zentraleJeGebaeude, zonenUebergabe } from '../src/lib/netz-zentralen.js';

const P = (id, lat, lng) => ({ id, pt: { lat, lng } });

describe('mehrere Heizzentralen', () => {
  it('Gebäude gehen an die nächste Zentrale, feste Zuordnung hat Vorrang', () => {
    const z = [P(1, 52.09, 8.0), P(2, 52.08, 8.0)];
    const geb = [P(10, 52.0895, 8.0), P(11, 52.0805, 8.0), P(12, 52.0899, 8.0)];
    const m = zentraleJeGebaeude(geb, z, new Map([[12, 2]]));
    expect(m.get(10)).toBe(1);
    expect(m.get(11)).toBe(2);
    expect(m.get(12)).toBe(2);
    expect(m.get(1)).toBe(1);
  });
  it('Verbindungsleitungen: kürzeste Verbindung, Spannbaum über die Zonen', () => {
    const zonen = new Map([
      [1, [P(1, 52.09, 8.0), P(10, 52.087, 8.0)]],
      [2, [P(2, 52.08, 8.0), P(11, 52.083, 8.0)]],
      [3, [P(3, 52.08, 8.02)]],
    ]);
    const k = kuppelVerbindungen(zonen);
    expect(k).toHaveLength(2);
    expect(k[0].a.id === 10 || k[0].b.id === 10).toBe(true);
    expect(k[0].laengeM).toBeLessThan(500);
  });
  it('Übergabe = Einspeisung − Lastanteil', () => {
    const last = new Float32Array([100, 100]);
    const u = zonenUebergabe(new Map([[1, new Float32Array([100, 0])], [2, new Float32Array([0, 100])]]), new Map([[1, 0.5], [2, 0.5]]), last);
    expect(Array.from(u.get(1).uebergabeKw)).toEqual([50, -50]);
    expect(u.get(1).maxAbgabeKw).toBe(50);
    expect(u.get(2).maxAufnahmeKw).toBe(50);
  });
});
