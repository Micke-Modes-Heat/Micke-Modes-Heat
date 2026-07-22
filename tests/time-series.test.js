import { describe, expect, it } from 'vitest';
import { normalizeHourlyYear } from '../src/lib/time-series.js';

describe('Kalenderkorrekte Zeitreihen', () => {
  it('entfernt aus 8784 Stunden exakt den 29. Februar', () => {
    const leap = Array.from({length: 8784}, (_, i) => i);
    const result = normalizeHourlyYear(leap);
    expect(result.values).toHaveLength(8760);
    expect(result.values[1415]).toBe(1415);
    expect(result.values[1416]).toBe(1440);
    expect(result.values[8759]).toBe(8783);
    expect(result.meta.history[0].operation).toBe('remove-leap-day');
  });

  it('lehnt unvollständige Jahre ab statt den letzten Wert zu vervielfachen', () => {
    expect(() => normalizeHourlyYear(new Array(8759).fill(1))).toThrow(/genau 8760/);
  });

  it('liefert eine unabhängige Kopie samt Provenienz', () => {
    const source = new Float32Array(8760).fill(2);
    const result = normalizeHourlyYear(source, {source: 'synthetic'});
    result.values[0] = 9;
    expect(source[0]).toBe(2);
    expect(result.meta.quality).toBe('synthetic');
  });
});
