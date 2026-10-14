import { describe, it, expect } from 'vitest';
import { baualtersklasse, gaAuswerten, gaBalkenwert, gaStatistik, groessenklasse, GA_KENNWERTE } from '../src/lib/gebaeude-analyse.js';

const geb = (id, nutzung, baujahr, flaeche, stockwerke, waerme, heizlast, status = 'bestand') =>
  ({ g: { id, nutzung, baujahr, flaeche, stockwerke }, st: { waerme, heizlast, status } });

describe('Gebäudeanalyse', () => {
  it('Baualters- und Größenklassen', () => {
    expect(baualtersklasse(1900)).toBe('bis 1918');
    expect(baualtersklasse(1975)).toBe('1969–1978');
    expect(baualtersklasse(2020)).toBe('ab 2016');
    expect(baualtersklasse(null)).toBe('unbekannt');
    expect(groessenklasse(800)).toBe('500–1.000 m²');
  });
  it('Statistik mit Quartilen und gewichtetem Mittel', () => {
    const s = gaStatistik([1, 2, 3, 4, 100], [1, 1, 1, 1, 0]);
    expect(s.n).toBe(5);
    expect(s.median).toBe(3);
    expect(s.q1).toBe(2);
    expect(s.q3).toBe(4);
    expect(s.gewMittel).toBeCloseTo(2.5, 9);
    expect(gaStatistik([NaN]).n).toBe(0);
  });
  it('spez. Wärme flächengewichtet je Nutzung; Gebäude ohne Wert fallen heraus', () => {
    const items = [
      geb(1, 'mfh', 1970, 500, 2, 120, 60),   // 800 m² → 150 kWh/m²a
      geb(2, 'mfh', 1995, 250, 2, 40, 20),    // 400 m² → 100 kWh/m²a
      geb(3, 'schule', 1960, 1000, 1, 160, 100), // 800 m² → 200
      geb(4, 'schule', 1960, 0, 1, 50, 20),   // keine Fläche
    ];
    const a = gaAuswerten(items, 'spezWaerme', 'nutzung');
    expect(a.gesamt.n).toBe(3);
    const mfh = a.gruppen.find(g => g.name === 'mfh');
    expect(mfh.stat.gewMittel).toBeCloseTo((150 * 800 + 100 * 400) / 1200, 6);
    expect(a.gruppen[0].name).toBe('schule');   // nach Median absteigend
    expect(gaBalkenwert(mfh.stat, GA_KENNWERTE.spezWaerme)).toBeCloseTo(mfh.stat.gewMittel, 9);
  });
  it('Baualtersklassen in fester Reihenfolge, absolute Werte als Summe', () => {
    const items = [geb(1, 'mfh', 1990, 100, 1, 10, 5), geb(2, 'mfh', 1950, 100, 1, 20, 8), geb(3, 'mfh', 1952, 100, 1, 30, 9)];
    const a = gaAuswerten(items, 'waerme', 'baualter');
    expect(a.gruppen.map(g => g.name)).toEqual(['1949–1957', '1984–1994']);
    expect(gaBalkenwert(a.gruppen[0].stat, GA_KENNWERTE.waerme)).toBe(50);
  });
  it('Vergleichswert über Kontextfunktion', () => {
    const items = [geb(1, 'buero', 1990, 1000, 1, 80, 40)];
    const a = gaAuswerten(items, 'vergleich', 'alle', { vergleichswert: () => 50 });
    expect(a.gesamt.median).toBeCloseTo(80 * 1000 / 800 / 50 * 100, 6);
  });
});
