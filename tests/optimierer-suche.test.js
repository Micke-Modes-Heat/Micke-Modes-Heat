import { describe, it, expect } from 'vitest';
import { optKombinationen, optKonzeptSchluessel, optMusterSuche, optSuchraum, optGrobPunkte, optRasterStufen } from '../src/lib/optimierer-suche.js';

const TYPEN = { lwwp: 'wp', fg: 'wp', geo: 'wp', gaskessel: 'fix', pellets: 'fix', bhkw: 'kwk', heizoel: 'fix' };
const MERIT = ['bhkw', 'geo', 'fg', 'lwwp', 'pellets', 'hhs', 'stromkessel', 'fernwaerme', 'gaskessel', 'heizoel'];

describe('optKombinationen', () => {
  it('liefert alle Teilmengen bis zur Größe 3', () => {
    expect(optKombinationen(['a', 'b', 'c', 'd'], 3)).toHaveLength(4 + 6 + 4);
    expect(optKombinationen(['a', 'b'], 3)).toEqual([['a'], ['a', 'b'], ['b']]);
  });
});

describe('optKonzeptSchluessel', () => {
  it('Spitzenlastkessel und Gaskessel sind dasselbe Konzept', () => {
    expect(optKonzeptSchluessel(['lwwp'], 120, 300)).toBe(optKonzeptSchluessel(['lwwp', 'gaskessel'], 0, 0));
  });
  it('ohne Restwärme kein Gaskessel', () => {
    expect(optKonzeptSchluessel(['pellets'], 0.01, 50)).toBe('pellets');
  });
});

describe('optMusterSuche', () => {
  it('findet das Minimum einer glatten Funktion auf ganze Zahlen genau', () => {
    const f = x => (x[0] - 37) ** 2 + 2 * (x[1] - 412) ** 2 + 0.5 * (x[0] - 37) * (x[1] - 412);
    const dims = [{ lo: 0, hi: 200, schritt: 50, minSchritt: 1 }, { lo: 0, hi: 1000, schritt: 250, minSchritt: 1 }];
    const r = optMusterSuche([0, 0], dims, f, 2000);
    expect(r.x).toEqual([37, 412]);
  });
  it('folgt einem schmalen Tal über gekoppelte Paare', () => {
    // Summe fest bei 300 optimal, Aufteilung leicht bevorzugt — reine Achsenschritte bleiben hängen
    const f = x => 100 * Math.abs(x[0] + x[1] - 300) + Math.abs(x[0] - 220);
    const dims = [{ lo: 0, hi: 400, schritt: 40, minSchritt: 1, gruppe: 'erz' }, { lo: 0, hi: 400, schritt: 40, minSchritt: 1, gruppe: 'erz' }];
    const r = optMusterSuche([150, 150], dims, f, 3000);
    expect(r.x).toEqual([220, 80]);
  });
  it('hält Grenzen ein und meidet unzulässige Punkte', () => {
    const f = x => (x[0] > 60 ? Infinity : -x[0]);
    const r = optMusterSuche([10], [{ lo: 0, hi: 100, schritt: 25, minSchritt: 1 }], f, 500);
    expect(r.x[0]).toBe(60);
  });
});

describe('optSuchraum / optGrobPunkte', () => {
  it('Gaskessel-Kandidat = Spitzenlastkessel: keine eigene Achse, keine Doppel-Konzepte', () => {
    const r = optSuchraum({ aktiv: ['lwwp', 'gaskessel', 'pellets'], constraints: {}, jahr: 2026, peak: 1000, typen: TYPEN, meritOrder: MERIT });
    expect(r.gasImplizit).toBe(true);
    expect(r.backupMode).toBe(false);
    const keys = r.kombis.map(k => k.keys.join('+'));
    expect(keys).toEqual(['', 'lwwp', 'lwwp+pellets', 'pellets']);
    expect(keys.some(k => k.includes('gaskessel'))).toBe(false);
  });
  it('ohne Gaskessel deckt der letzte Kessel als Backup die Spitze', () => {
    const r = optSuchraum({ aktiv: ['lwwp', 'pellets'], constraints: {}, jahr: 2026, peak: 1000, typen: TYPEN, meritOrder: MERIT });
    const k = r.kombis.find(kk => kk.keys.join('+') === 'lwwp+pellets');
    expect(k.backupIdx).toBe(1);
    expect(k.grenzen[1]).toEqual({ lo: 1, hi: 1 });
  });
  it('Wärmepumpen dürfen bis 2 × Spitzenlast groß werden (Kälteeinbußen), Kessel bis 1,2 ×', () => {
    const r = optSuchraum({ aktiv: ['lwwp', 'pellets', 'gaskessel'], constraints: {}, jahr: 2026, peak: 1000, typen: TYPEN, meritOrder: MERIT });
    expect(r.kombis.find(k => k.keys.join('+') === 'lwwp').grenzen[0].hi).toBe(2000);
    expect(r.kombis.find(k => k.keys.join('+') === 'pellets').grenzen[0].hi).toBe(1200);
  });
  it('Min/Max-Leistungen und Bis-Jahr', () => {
    const constraints = { lwwp: { minKw: 300, maxKw: 600, bisJahr: 2030 } };
    const r = optSuchraum({ aktiv: ['lwwp', 'gaskessel'], constraints, jahr: 2026, peak: 1000, typen: TYPEN, meritOrder: MERIT });
    expect(r.kombis.find(k => k.keys[0] === 'lwwp').grenzen[0]).toEqual({ lo: 300, hi: 600 });
    const spaeter = optSuchraum({ aktiv: ['lwwp', 'gaskessel'], constraints, jahr: 2035, peak: 1000, typen: TYPEN, meritOrder: MERIT });
    expect(spaeter.kombis.find(k => k.keys[0] === 'lwwp').grenzen[0].lo).toBe(50);
  });
  it('Grobpunkte innerhalb der Grenzen, ohne Überdimensionierung', () => {
    const p = optGrobPunkte([{ lo: 100, hi: 1200 }, { lo: 100, hi: 1200 }], optRasterStufen('standard'), 1000);
    expect(p.length).toBeGreaterThan(10);
    for (const [a, b] of p) { expect(a).toBeGreaterThanOrEqual(100); expect(a + b).toBeLessThanOrEqual(1600); }
    expect(optGrobPunkte([], [0.5], 1000)).toEqual([[]]);
  });
});
