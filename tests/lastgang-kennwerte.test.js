import { describe, it, expect } from 'vitest';
import { dauerlinie, gleichzeitigkeit, lastgangKennwerte, lastgangMonate, typtag } from '../src/lib/lastgang-kennwerte.js';

describe('Lastgang-Kennwerte', () => {
  const kw = new Float32Array(8760).map((_, i) => (i % 24 === 7 ? 300 : 100));
  it('Jahresmenge, Spitze, Vollbenutzung', () => {
    const k = lastgangKennwerte(kw);
    expect(k.mwh).toBeCloseTo((8760 * 100 + 365 * 200) / 1000, 6);
    expect(k.spitzeKw).toBe(300);
    expect(k.spitzeStunde).toBe(7);
    expect(k.vbh).toBeCloseTo(k.mwh * 1000 / 300, 6);
    expect(k.sommerKw).toBeGreaterThan(100);
  });
  it('Monate summieren sich zum Jahr', () => {
    const m = lastgangMonate(kw);
    expect(m).toHaveLength(12);
    expect(m.reduce((a, b) => a + b, 0)).toBeCloseTo(lastgangKennwerte(kw).mwh, 6);
    expect(m[0]).toBeCloseTo(31 * (24 * 100 + 200) / 1000, 6);
  });
  it('Dauerlinie absteigend', () => {
    const d = dauerlinie(kw);
    expect(d[0]).toBe(300);
    expect(d[8759]).toBe(100);
  });
  it('Typtag zeigt die Morgenspitze, Werktag und Wochenende getrennt', () => {
    const t = typtag(kw, [0], 2026, false);
    expect(t).toHaveLength(24);
    expect(t[7]).toBe(300);
    expect(t[3]).toBe(100);
    expect(typtag(kw, [0], 2026, true)[7]).toBe(300);
  });
  it('Gleichzeitigkeit', () => {
    expect(gleichzeitigkeit(80, 100)).toBe(0.8);
    expect(gleichzeitigkeit(80, 0)).toBeNull();
  });
});
