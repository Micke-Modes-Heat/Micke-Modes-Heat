import { describe, it, expect } from 'vitest';
import { bedienModulStunden, bedienStunden, bedienErlaeuterung } from '../src/lib/vdi-bedien.js';

describe('Bedienaufwand nach Modulen (VDI 2067)', () => {
  it('Luft-WP: Module bis 800 kW, Grundaufwand + Stunden je Modul', () => {
    expect(bedienModulStunden('lwwp', 200)).toMatchObject({ module: 1, stunden: 20 });
    expect(bedienModulStunden('lwwp', 800)).toMatchObject({ module: 1, stunden: 20 });
    expect(bedienModulStunden('lwwp', 801)).toMatchObject({ module: 2, stunden: 32 });
    // 10 MW → 13 Module
    expect(bedienModulStunden('lwwp', 10000)).toMatchObject({ module: 13, stunden: 8 + 13 * 12 });
  });
  it('10 MW braucht deutlich mehr Bedienung als 200 kW', () => {
    expect(bedienStunden('lwwp', 10000)).toBeGreaterThan(bedienStunden('lwwp', 200) * 5);
  });
  it('Biomasse: Stunden je Modul nach Modulgröße gestaffelt, kleine Anlagen wie bisher', () => {
    expect(bedienStunden('pk', 40)).toBe(100);
    expect(bedienStunden('pk', 300)).toBe(300);
    expect(bedienStunden('pk', 900)).toBe(408);
    // 1,8 MW → 2 Module à 900 kW
    expect(bedienStunden('pk', 1800)).toBe(816);
  });
  it('ohne Leistung oder unbekannter Baustein: 0 h', () => {
    expect(bedienStunden('lwwp', 0)).toBe(0);
    expect(bedienStunden('unbekannt', 500)).toBe(0);
  });
  it('Erläuterung nennt Module und Summe', () => {
    expect(bedienErlaeuterung('lwwp', 10000)).toContain('13 Module');
    expect(bedienErlaeuterung('lwwp', 10000)).toContain('164 h/a');
  });
  it('in sich geschlossen (wird in den Worker kopiert)', () => {
    const f = new Function('return ' + bedienModulStunden.toString())();
    expect(f('lwwp', 10000).stunden).toBe(164);
  });
});
