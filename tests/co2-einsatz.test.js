// Vitest-Tests für lib/co2-einsatz.js — CO₂ aus den Energiemengen der Einsatzplanung.
import { describe, it, expect } from 'vitest';
import { co2AusEinsatz } from '../src/lib/co2-einsatz.js';

const ef = { gas: 240, oel: 310, pellets: 20, hhs: 20, fw: 180, strom: 380 };

describe('co2AusEinsatz', () => {
  it('rechnet alle Erzeugerarten, auch Heizöl, Biomasse, Fernwärme und Stromkessel', () => {
    const r = co2AusEinsatz({
      lwwp: { waermeMwh: 900, elMwh: 300 }, gaskessel: { waermeMwh: 92 }, heizoel: { waermeMwh: 90 },
      pellets: { waermeMwh: 88 }, fernwaerme: { waermeMwh: 100 }, stromkessel: { waermeMwh: 99, elMwh: 0 },
      _thermSpeicher: { waermeMwh: 50 }, solarthermie: { waermeMwh: 40 },
    }, ef, { gaskessel: 0.92, heizoel: 0.9, pellets: 0.88, stromkessel: 0.99 });
    expect(r.proErzeuger.lwwp).toBeCloseTo(114, 6);        // 300 MWh Strom × 380 g
    expect(r.proErzeuger.gaskessel).toBeCloseTo(24, 6);    // 100 MWh Gas × 240 g
    expect(r.proErzeuger.heizoel).toBeCloseTo(31, 6);
    expect(r.proErzeuger.pellets).toBeCloseTo(2, 6);
    expect(r.proErzeuger.fernwaerme).toBeCloseTo(18, 6);
    expect(r.proErzeuger.stromkessel).toBeCloseTo(38, 6);  // 100 MWh Strom aus dem Wirkungsgrad
    expect(r.proErzeuger._thermSpeicher).toBeUndefined();
    expect(r.t).toBeCloseTo(114 + 24 + 31 + 2 + 18 + 38, 6);
  });
  it('BHKW mit und ohne Stromgutschrift, nie negativ', () => {
    const en = { bhkw: { waermeMwh: 500 } };
    expect(co2AusEinsatz(en, ef, { bhkwTh: 0.5 }).t).toBeCloseTo(240, 6);
    expect(co2AusEinsatz(en, ef, { bhkwTh: 0.5 }, { gutschrift: true, sigma: 0.8, verdraengungEf: 400 }).t).toBeCloseTo(80, 6);
    expect(co2AusEinsatz(en, ef, { bhkwTh: 0.5 }, { gutschrift: true, sigma: 2, verdraengungEf: 400 }).t).toBe(0);
  });
});
