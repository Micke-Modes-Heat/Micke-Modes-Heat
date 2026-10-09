import { describe, it, expect } from 'vitest';
import { glfWinter } from '../src/lib/gleichzeitigkeit.js';

describe('Gleichzeitigkeitsfaktor Wärme (Winter et al. 2001)', () => {
  it('Werte aus der Formel', () => {
    expect(glfWinter(1)).toBe(1);
    expect(glfWinter(10)).toBeCloseTo(0.97, 2);
    expect(glfWinter(30)).toBeCloseTo(0.86, 2);
    expect(glfWinter(100)).toBeCloseTo(0.59, 2);
    expect(glfWinter(10000)).toBeGreaterThan(0.449);
  });
  it('monoton fallend', () => {
    for (let n = 2; n < 500; n++) expect(glfWinter(n)).toBeLessThanOrEqual(glfWinter(n - 1));
  });
});
