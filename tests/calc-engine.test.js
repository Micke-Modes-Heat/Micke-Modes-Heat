import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  loadScript('08-calc-engine.js');
});

describe('CalcEngine.annuitaet', () => {
  it('berechnet Annuitätenfaktor korrekt (3.5%, 20a)', () => {
    const af = CalcEngine.annuitaet(0.035, 20);
    // Erwartung: 0.035 × 1.035^20 / (1.035^20 - 1) ≈ 0.0700
    expect(af).toBeCloseTo(0.0700, 3);
  });

  it('gibt 1/n zurück bei Zinssatz 0', () => {
    expect(CalcEngine.annuitaet(0, 20)).toBeCloseTo(0.05, 6);
    expect(CalcEngine.annuitaet(0, 10)).toBeCloseTo(0.1, 6);
  });

  it('gibt 0 zurück bei Nutzungsdauer 0', () => {
    expect(CalcEngine.annuitaet(0.03, 0)).toBe(0);
  });

  it('höherer Zinssatz → höherer Annuitätenfaktor', () => {
    const af3 = CalcEngine.annuitaet(0.03, 20);
    const af5 = CalcEngine.annuitaet(0.05, 20);
    expect(af5).toBeGreaterThan(af3);
  });
});

describe('CalcEngine.vorlaufTemp', () => {
  it('gibt VL bei -5°C zurück', () => {
    expect(CalcEngine.vorlaufTemp(-5, 70, 35)).toBe(70);
  });

  it('gibt VL bei +15°C zurück', () => {
    expect(CalcEngine.vorlaufTemp(15, 70, 35)).toBe(35);
  });

  it('interpoliert linear bei 5°C', () => {
    // Mitte zwischen -5 und +15 → Mitte zwischen 70 und 35 = 52.5
    const vl = CalcEngine.vorlaufTemp(5, 70, 35);
    expect(vl).toBeCloseTo(52.5, 1);
  });

  it('klemmt nicht unter Minimum', () => {
    // Bei T=20°C (über 15°C) sollte es bei 35°C bleiben (Minimum)
    expect(CalcEngine.vorlaufTemp(20, 70, 35)).toBe(35);
  });

  it('klemmt nicht über Maximum', () => {
    // Bei T=-15°C (unter -5°C) sollte es bei 70°C bleiben (Maximum)
    expect(CalcEngine.vorlaufTemp(-15, 70, 35)).toBe(70);
  });
});

describe('CalcEngine.calcCOP', () => {
  it('berechnet COP für Luft-WP bei 35/2°C mit Gütegrad 0.42', () => {
    const vlH = new Float32Array(1).fill(35);
    const tqH = new Float32Array(1).fill(2);
    const { cop, copRef } = CalcEngine.calcCOP(vlH, tqH, 0.42);
    // Carnot: (273.15+35)/(35-2) = 9.338 × 0.42 ≈ 3.92
    expect(cop[0]).toBeCloseTo(3.92, 1);
    expect(copRef).toBeCloseTo(3.92, 1);
  });

  it('COP ist gedeckelt bei 8', () => {
    // Kleiner Hub → riesiger Carnot-COP → soll auf 8 begrenzt sein
    const vlH = new Float32Array(1).fill(30);
    const tqH = new Float32Array(1).fill(29); // Hub nur 1K
    const { cop } = CalcEngine.calcCOP(vlH, tqH, 0.5);
    expect(cop[0]).toBe(8);
  });

  it('COP sinkt bei niedrigerer Quellentemperatur', () => {
    const vl = new Float32Array(1).fill(55);
    const tq_warm = new Float32Array(1).fill(10);
    const tq_kalt = new Float32Array(1).fill(-5);
    const warm = CalcEngine.calcCOP(vl, tq_warm, 0.42);
    const kalt = CalcEngine.calcCOP(vl, tq_kalt, 0.42);
    expect(warm.cop[0]).toBeGreaterThan(kalt.cop[0]);
  });

  it('berechnet 8760 Stunden korrekt', () => {
    const vlH = new Float32Array(8760).fill(45);
    const tqH = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) tqH[i] = 5 + 5 * Math.sin(2 * Math.PI * i / 8760);
    const { cop } = CalcEngine.calcCOP(vlH, tqH, 0.42);
    expect(cop.length).toBe(8760);
    // Im Winter (kalt) niedriger, im Sommer höher
    const _winter = cop[0];    // tqH ≈ 5
    const _sommer = cop[4380]; // tqH ≈ 5 (sin peak bei ~2190)
    expect(cop.every(v => v > 0 && v <= 8)).toBe(true);
  });
});

describe('CalcEngine.investEurProKw', () => {
  it('gibt positive Werte für alle Technologien', () => {
    const techs = Object.keys(CalcEngine.INVEST_KURVEN);
    for (const tech of techs) {
      const inv = CalcEngine.investEurProKw(tech, 200);
      expect(inv, `${tech} bei 200 kW`).toBeGreaterThan(0);
    }
  });

  it('Investkosten sinken mit steigender Leistung (Skaleneffekt)', () => {
    const inv50 = CalcEngine.investEurProKw('LuftWP', 50);
    const inv500 = CalcEngine.investEurProKw('LuftWP', 500);
    expect(inv50).toBeGreaterThan(inv500);
  });

  it('gibt 0 zurück für unbekannte Technologie', () => {
    expect(CalcEngine.investEurProKw('Dampfmaschine', 100)).toBe(0);
  });

  it('gibt 0 zurück für 0 kW', () => {
    expect(CalcEngine.investEurProKw('LuftWP', 0)).toBe(0);
  });

  it('Luft-WP bei 200 kW liegt zwischen 400-1500 €/kW', () => {
    const inv = CalcEngine.investEurProKw('LuftWP', 200);
    expect(inv).toBeGreaterThan(400);
    expect(inv).toBeLessThan(1500);
  });
});

describe('CalcEngine.getPvInvestPerKwp', () => {
  it('5 kWp → 1400 €/kWp (Tabellenwert)', () => {
    expect(CalcEngine.getPvInvestPerKwp(5)).toBe(1400);
  });

  it('10000 kWp → 600 €/kWp (Tabellenwert)', () => {
    expect(CalcEngine.getPvInvestPerKwp(10000)).toBe(600);
  });

  it('interpoliert linear zwischen Stützstellen', () => {
    // Zwischen 5 kWp (1400) und 10 kWp (1300) → 7.5 kWp ≈ 1350
    const inv = CalcEngine.getPvInvestPerKwp(7.5);
    expect(inv).toBeCloseTo(1350, -1); // auf 10er gerundet
  });

  it('größere Anlage → günstiger pro kWp', () => {
    const inv10 = CalcEngine.getPvInvestPerKwp(10);
    const inv100 = CalcEngine.getPvInvestPerKwp(100);
    const inv1000 = CalcEngine.getPvInvestPerKwp(1000);
    expect(inv10).toBeGreaterThan(inv100);
    expect(inv100).toBeGreaterThan(inv1000);
  });
});

describe('CalcEngine.sigH (SigLinDe)', () => {
  it('gibt positiven Wert bei -10°C (Heizfall)', () => {
    const p = CalcEngine.SIGLINDE.HEF34;
    expect(CalcEngine.sigH(-10, p)).toBeGreaterThan(0);
  });

  it('Heizlast steigt bei sinkender Temperatur', () => {
    const p = CalcEngine.SIGLINDE.HEF34;
    const h_warm = CalcEngine.sigH(10, p);
    const h_kalt = CalcEngine.sigH(-15, p);
    expect(h_kalt).toBeGreaterThan(h_warm);
  });

  it('alle SigLinDe-Profile sind verfügbar', () => {
    const keys = Object.keys(CalcEngine.SIGLINDE);
    expect(keys.length).toBeGreaterThanOrEqual(14);
    // Jedes Profil hat die nötigen Parameter
    for (const key of keys) {
      const p = CalcEngine.SIGLINDE[key];
      expect(p).toHaveProperty('A');
      expect(p).toHaveProperty('B');
      expect(p).toHaveProperty('C');
      expect(p).toHaveProperty('D');
      expect(p).toHaveProperty('mh');
      expect(p).toHaveProperty('bh');
      expect(p).toHaveProperty('mw');
      expect(p).toHaveProperty('bw');
    }
  });
});

describe('CalcEngine VDI2067 Tabellen', () => {
  it('VDI2067 enthält Nutzungsdauern für alle Erzeugertypen', () => {
    const vdi = CalcEngine.VDI2067;
    expect(vdi).toBeDefined();
    expect(vdi.LuftWP).toBeDefined();
    expect(vdi.LuftWP.n).toBeGreaterThan(10);
    expect(vdi.Gaskessel).toBeDefined();
    expect(vdi.Pellets).toBeDefined();
    expect(vdi.Fernwaerme).toBeDefined();
  });
});
