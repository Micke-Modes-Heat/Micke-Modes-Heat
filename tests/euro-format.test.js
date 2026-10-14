// Vitest-Tests für lib/euro-format.js
import { describe, it, expect } from 'vitest';
import { euroKompakt, euroTeile } from '../src/lib/euro-format.js';

describe('euroKompakt', () => {
  it('unter 1 Mio. in k€, ab 1 Mio. in Mio. €', () => {
    expect(euroKompakt(940900, true)).toBe('941 k€/a');
    expect(euroKompakt(7765000)).toBe('7,77 Mio. €');
    expect(euroKompakt(96730000)).toBe('96,7 Mio. €');
    expect(euroKompakt(154800000)).toBe('155 Mio. €');
    expect(euroKompakt(999600)).toBe('1,00 Mio. €');   // keine „1.000 k€“
    expect(euroKompakt(4200, true)).toBe('4,2 k€/a');
    expect(euroKompakt(0)).toBe('0 k€');
    expect(euroKompakt(-2500000)).toBe('-2,50 Mio. €');
  });
  it('Teile für Zahl und Einheit getrennt', () => {
    expect(euroTeile(2325000)).toEqual({ zahl: '2,33', einheit: 'Mio. €' });
  });
});
