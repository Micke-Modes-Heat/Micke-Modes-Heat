import { describe, it, expect } from 'vitest';
import { erzeugtMwh, jazAus, lastMwh, speicherHerkunft, waermeAnLastJeErzeuger, eeAnteilPct } from '../src/lib/dispatch-energie.js';

// Last 10.000 MWh: WP direkt 6.000 + 900 in den Speicher, Speicher gibt 800 ab (100 Verlust), Kessel 3.200
const en = {
  lwwp: { waermeMwh: 6000, elMwh: 2300, ladeMwh: 900, erzeugtMwh: 6900 },
  gaskessel: { waermeMwh: 3200, elMwh: 0, ladeMwh: 0, erzeugtMwh: 3200 },
  _thermSpeicher: { waermeMwh: 800, elMwh: 0, geladenMwh: 900, verlustMwh: 100 },
};

describe('Kennwerte aus der Einsatzplanung', () => {
  it('erzeugte Wärme und JAZ inkl. Speicherladung', () => {
    expect(erzeugtMwh(en, 'lwwp')).toBe(6900);
    expect(jazAus(en, 'lwwp')).toBeCloseTo(3.0, 6);
    expect(jazAus(en, 'gaskessel')).toBeNull();
    // ältere Stände ohne Ladefelder: erzeugt = direkt
    expect(erzeugtMwh({ geo: { waermeMwh: 500, elMwh: 100 } }, 'geo')).toBe(500);
  });

  it('Last, Herkunft der Speicherwärme und EE-Anteil', () => {
    expect(lastMwh(en)).toBe(10000);
    expect(speicherHerkunft(en)).toEqual({ lwwp: 1 });
    const an = waermeAnLastJeErzeuger(en);
    expect(an.lwwp).toBe(6800);
    expect(an.lwwp + an.gaskessel).toBe(10000);
    expect(eeAnteilPct(en)).toBeCloseTo(68, 6);
  });

  it('Solarthermie zählt als erneuerbar, BHKW-Ladung nicht', () => {
    const e2 = {
      solarthermie: { waermeMwh: 100, elMwh: 0, ladeMwh: 100 },
      bhkw: { waermeMwh: 500, elMwh: 300, ladeMwh: 100 },
      gaskessel: { waermeMwh: 300, elMwh: 0 },
      _thermSpeicher: { waermeMwh: 200, elMwh: 0 },
    };
    expect(lastMwh(e2)).toBe(1100);
    expect(eeAnteilPct(e2)).toBeCloseTo((100 + 100) / 1100 * 100, 6);
  });
});
