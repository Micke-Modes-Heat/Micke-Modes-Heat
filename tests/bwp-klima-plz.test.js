import { describe, expect, it } from 'vitest';
import { BWP_KLIMA_META, BWP_KLIMA_PLZ } from '../src/data/bwp-klima-plz.js';

describe('BWP-Klimadaten nach PLZ', () => {
  it('enthält den vollständigen versionierten PLZ-Datenstand', () => {
    expect(Object.keys(BWP_KLIMA_PLZ).length).toBeGreaterThan(8000);
    expect(BWP_KLIMA_META.standard).toBe('DIN/TS 12831-1:2020-04');
    expect(BWP_KLIMA_META.sourceUrl).toContain('waermepumpe.de');
  });

  it('liefert bekannte offizielle Vergleichswerte', () => {
    expect(BWP_KLIMA_PLZ['34117']).toEqual([-10.1, 10.3]);
    expect(BWP_KLIMA_PLZ['20095']).toEqual([-8.2, 10.6]);
    expect(BWP_KLIMA_PLZ['10115'][0]).toBe(-11.1);
  });
});
