import { describe, it, expect } from 'vitest';
import { anschlussKlasse, anschlussAuto, anschlussWirksam } from '../src/lib/anschlussleistung.js';

describe('anschlussleistung', () => {
  it('rundet auf die nächsthöhere Klasse', () => {
    expect(anschlussKlasse(30)).toBe(30);
    expect(anschlussKlasse(30.1)).toBe(43);
    expect(anschlussKlasse(1100)).toBe(1100);
  });
  it('rechnet 20 % Reserve auf die Leistung', () => {
    expect(anschlussAuto(25)).toBe(30);   // 25·1,2 = 30
    expect(anschlussAuto(26)).toBe(43);   // 31,2 → 43
    expect(anschlussAuto(0)).toBe(0);
  });
  it('Handwert hat Vorrang', () => {
    expect(anschlussWirksam({ leistungKW: 26, anschlussleistungKW: 100 })).toEqual({ kw: 100, auto: false });
    expect(anschlussWirksam({ leistungKW: 26, anschlussleistungKW: '' })).toEqual({ kw: 43, auto: true });
  });
});
