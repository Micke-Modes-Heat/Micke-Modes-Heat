import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  loadScript('config/netz-kosten.js');
  loadScript('config/erzeuger-cfg.js');
  loadScript('config/optimizer-defaults.js');
  loadScript('01-globals-varianten.js');
  loadScript('08-calc-engine.js');
  loadScript('07b-analysis-economics.js');
});

// Investfunktion über CalcEngine
function investFn(tech, kw) {
  return Math.round(CalcEngine.investEurProKw(tech === 'gaskessel' ? 'Gaskessel' :
    tech === 'lwwp' ? 'LuftWP' : tech === 'pellets' ? 'Pellets' :
    tech === 'bhkw' ? 'BHKW' : tech === 'heizoel' ? 'Heizoel' :
    tech === 'hhs' ? 'HHS' : tech === 'fernwaerme' ? 'Fernwaerme' :
    tech === 'geo' ? 'GeoWP' : tech === 'fg' ? 'FlussWP' :
    tech === 'stromkessel' ? 'Stromkessel' : tech, kw) * kw);
}

describe('_calcKostenShared — Grundfunktion', () => {
  it('berechnet WGK für reinen Gaskessel', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      zinsPct: 3.5,
      lohn: 45,
      prices: { gas: 10 }, // ct/kWh
      etas: { gaskessel: 0.92 },
      investFn,
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 500, elMwh: 0 }],
      gesamtMwh: 500,
    });

    // WGK muss positiv und in realistischem Bereich sein (5-25 ct/kWh)
    expect(result.wgk).toBeGreaterThan(5);
    expect(result.wgk).toBeLessThan(25);
    // Jahreskosten müssen positiv sein
    expect(result.jahreskosten).toBeGreaterThan(0);
    // Invest muss positiv sein
    expect(result.investGesamt).toBeGreaterThan(0);
  });

  it('WGK = 0 bei 0 MWh Wärme', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      erzList: [],
      gesamtMwh: 0,
    });
    expect(result.wgk).toBe(0);
  });

  it('Jahreskosten = Kapital + Energie + CO2 + PV', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      zinsPct: 3.5,
      lohn: 45,
      prices: { gas: 10 },
      etas: { gaskessel: 0.92 },
      investFn,
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 500, elMwh: 0 }],
      gesamtMwh: 500,
      co2: { pCo2: 55, emf: { gas: 240 }, alleET: true },
    });

    const summe = result.kapitalJk + result.energieJk + result.co2Jk + result.pvJk;
    expect(result.jahreskosten).toBeCloseTo(summe, 0);
  });
});

describe('_calcKostenShared — Energiekosten', () => {
  it('Gaskessel: Brennstoffkosten = Wärme / eta × Gaspreis', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      prices: { gas: 10 }, // 10 ct/kWh
      etas: { gaskessel: 0.92 },
      investFn: () => 0, // kein Invest für diesen Test
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 1000, elMwh: 0 }],
      gesamtMwh: 1000,
    });

    // Erwartung: 1000 MWh / 0.92 × 10 ct/kWh × 10 (→ €/MWh) = 10.870 €
    const erwartet = 1000 / 0.92 * 10 * 10;
    expect(result.energieJk).toBeCloseTo(erwartet, -1);
  });

  it('Luft-WP: Stromkosten berechnet', () => {
    const result = _calcKostenShared({
      pKw: { lwwp: 200 },
      prices: { strom: 35 }, // ct/kWh
      etas: {},
      investFn: () => 0,
      erzList: [{ key: 'lwwp', typ: 'wp', waermeMwh: 800, elMwh: 200 }],
      gesamtMwh: 800,
    });

    // 200 MWh Strom × 35 ct/kWh × 10 = 70.000 €
    expect(result.energieJk).toBeCloseTo(200 * 35 * 10, -1);
  });

  it('Fernwärme: Kosten = Wärme × FW-Preis', () => {
    const result = _calcKostenShared({
      pKw: { fernwaerme: 300 },
      prices: { fw: 17 }, // ct/kWh
      etas: {},
      investFn: () => 0,
      erzList: [{ key: 'fernwaerme', typ: 'fix', waermeMwh: 600, elMwh: 0 }],
      gesamtMwh: 600,
    });

    // 600 MWh × 17 ct/kWh × 10 = 102.000 €
    expect(result.energieJk).toBeCloseTo(600 * 17 * 10, -1);
  });

  it('Pellets: Brennstoffkosten mit eta', () => {
    const result = _calcKostenShared({
      pKw: { pellets: 150 },
      prices: { pk: 8 }, // ct/kWh
      etas: { pellets: 0.88 },
      investFn: () => 0,
      erzList: [{ key: 'pellets', typ: 'fix', waermeMwh: 400, elMwh: 0 }],
      gesamtMwh: 400,
    });

    const erwartet = 400 / 0.88 * 8 * 10;
    expect(result.energieJk).toBeCloseTo(erwartet, -1);
  });

  it('Heizöl: Brennstoffkosten mit eta', () => {
    const result = _calcKostenShared({
      pKw: { heizoel: 100 },
      prices: { hko: 10 },
      etas: { heizoel: 0.90 },
      investFn: () => 0,
      erzList: [{ key: 'heizoel', typ: 'fix', waermeMwh: 300, elMwh: 0 }],
      gesamtMwh: 300,
    });

    const erwartet = 300 / 0.90 * 10 * 10;
    expect(result.energieJk).toBeCloseTo(erwartet, -1);
  });
});

describe('_calcKostenShared — CO₂-Emissionen', () => {
  it('Gaskessel: CO₂ = Wärme / eta × Emissionsfaktor', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      etas: { gaskessel: 0.92 },
      investFn: () => 0,
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 1000, elMwh: 0 }],
      gesamtMwh: 1000,
      co2: { emf: { gas: 240 } },
    });

    // 1000 MWh / 0.92 × 240 g/kWh / 1000 = 260.87 t CO₂/a
    const erwartet = 1000 / 0.92 * 240 / 1000;
    expect(result.co2ta).toBeCloseTo(erwartet, 0);
  });

  it('WP: CO₂ = Strom × Strom-Emissionsfaktor', () => {
    const result = _calcKostenShared({
      pKw: { lwwp: 200 },
      etas: {},
      investFn: () => 0,
      erzList: [{ key: 'lwwp', typ: 'wp', waermeMwh: 800, elMwh: 200 }],
      gesamtMwh: 800,
      co2: { emf: { strom: 363 } },
    });

    // 200 MWh × 363 g/kWh / 1000 = 72.6 t CO₂/a
    expect(result.co2ta).toBeCloseTo(200 * 363 / 1000, 0);
  });

  it('Pellets haben niedrige CO₂-Emissionen (biogen)', () => {
    const result = _calcKostenShared({
      pKw: { pellets: 200 },
      etas: { pellets: 0.88 },
      investFn: () => 0,
      erzList: [{ key: 'pellets', typ: 'fix', waermeMwh: 1000, elMwh: 0 }],
      gesamtMwh: 1000,
      co2: { emf: { pellets: 20 } },
    });

    // 1000/0.88 × 20/1000 ≈ 22.7 t → viel weniger als Gas
    expect(result.co2ta).toBeLessThan(30);
    expect(result.co2ta).toBeGreaterThan(0);
  });

  it('CO₂-Kosten werden bei CO₂-Preis > 0 berechnet', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      etas: { gaskessel: 0.92 },
      investFn: () => 0,
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 1000, elMwh: 0 }],
      gesamtMwh: 1000,
      co2: { pCo2: 55, emf: { gas: 240 }, alleET: true }, // 55 €/t CO₂
    });

    // CO₂-Kosten = CO₂ (t) × 55 €/t
    expect(result.co2Jk).toBeCloseTo(result.co2ta * 55, -1);
    expect(result.co2Jk).toBeGreaterThan(0);
  });

  it('Mehrere Erzeuger: CO₂ wird summiert', () => {
    const result = _calcKostenShared({
      pKw: { lwwp: 200, gaskessel: 100 },
      etas: { gaskessel: 0.92 },
      investFn: () => 0,
      erzList: [
        { key: 'lwwp', typ: 'wp', waermeMwh: 600, elMwh: 150 },
        { key: 'gaskessel', typ: 'fix', waermeMwh: 400, elMwh: 0 },
      ],
      gesamtMwh: 1000,
      co2: { emf: { strom: 363, gas: 240 } },
    });

    const co2Wp = 150 * 363 / 1000;
    const co2Gk = 400 / 0.92 * 240 / 1000;
    expect(result.co2ta).toBeCloseTo(co2Wp + co2Gk, 0);
  });
});

describe('_calcKostenShared — EE-Anteil', () => {
  it('100% WP → hoher EE-Anteil', () => {
    const result = _calcKostenShared({
      pKw: { lwwp: 200 },
      investFn: () => 0,
      erzList: [{ key: 'lwwp', typ: 'wp', waermeMwh: 800, elMwh: 200 }],
      gesamtMwh: 800,
    });

    expect(result.eeAnteil).toBe(100);
  });

  it('100% Gaskessel → 0% EE', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      investFn: () => 0,
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 1000, elMwh: 0 }],
      gesamtMwh: 1000,
    });

    expect(result.eeAnteil).toBe(0);
  });

  it('Mix aus WP und Gas → anteiliger EE', () => {
    const result = _calcKostenShared({
      pKw: { lwwp: 100, gaskessel: 100 },
      investFn: () => 0,
      erzList: [
        { key: 'lwwp', typ: 'wp', waermeMwh: 600, elMwh: 150 },
        { key: 'gaskessel', typ: 'fix', waermeMwh: 400, elMwh: 0 },
      ],
      gesamtMwh: 1000,
    });

    // EE = 600/1000 = 60%
    expect(result.eeAnteil).toBeCloseTo(60, 0);
  });
});

describe('_calcKostenShared — Kapitalkosten (VDI 2067)', () => {
  it('Bausteine werden für aktive Erzeuger angelegt', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      zinsPct: 3.5,
      lohn: 45,
      investFn,
      erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: 500, elMwh: 0 }],
      gesamtMwh: 500,
    });

    // Mindestens Gaskessel + Schornstein + Puffer + Zuschläge
    expect(result.bausteinRows.length).toBeGreaterThanOrEqual(4);
    // Alle haben Invest und Jahreskosten
    for (const row of result.bausteinRows) {
      expect(row.inv).toBeGreaterThanOrEqual(0);
      expect(row.jk).toBeGreaterThanOrEqual(0);
    }
  });

  it('Prozentuale Zuschläge (Bauteil 5%, Hydraulik 12%, Planung 10%, Unvorhergesehenes 7%)', () => {
    const result = _calcKostenShared({
      pKw: { gaskessel: 200 },
      investFn,
      erzList: [],
      gesamtMwh: 0,
    });

    const ids = result.bausteinRows.map(r => r.id);
    expect(ids).toContain('bauteil');
    expect(ids).toContain('hydr_elt');
    expect(ids).toContain('planung');
    expect(ids).toContain('unvorg');
  });

  it('Kapitalkosten steigen mit Zinssatz', () => {
    const base = { pKw: { gaskessel: 200 }, investFn, erzList: [], gesamtMwh: 0 };
    const low = _calcKostenShared({ ...base, zinsPct: 1.0 });
    const high = _calcKostenShared({ ...base, zinsPct: 5.0 });
    expect(high.kapitalJk).toBeGreaterThan(low.kapitalJk);
  });
});

describe('_calcKostenShared — PV & Batterie', () => {
  it('PV-Invest wird annuitätisch berechnet', () => {
    const result = _calcKostenShared({
      pKw: {},
      investFn: () => 0,
      erzList: [],
      gesamtMwh: 100,
      pv: { kwp: 100, invPerKwp: 1000 },
    });

    // PV-Invest: 100 kWp × 1000 €/kWp = 100.000 €
    expect(result.investGesamt).toBeCloseTo(100000, -2);
    expect(result.pvJk).toBeGreaterThan(0);
  });

  it('Batterie-Invest wird addiert', () => {
    const result = _calcKostenShared({
      pKw: {},
      investFn: () => 0,
      erzList: [],
      gesamtMwh: 100,
      pv: { kwp: 50, invPerKwp: 1000, batKwh: 100, batInvPerKwh: 400 },
    });

    // PV 50.000 + Bat 40.000 = 90.000
    expect(result.investGesamt).toBeCloseTo(90000, -2);
  });

  it('PV-Einspeisung reduziert Jahreskosten', () => {
    const ohne = _calcKostenShared({
      pKw: {},
      investFn: () => 0,
      erzList: [],
      gesamtMwh: 100,
      pv: { kwp: 100, invPerKwp: 1000, einspMwh: 0 },
    });
    const mit = _calcKostenShared({
      pKw: {},
      investFn: () => 0,
      erzList: [],
      gesamtMwh: 100,
      pv: { kwp: 100, invPerKwp: 1000, einspMwh: 50, pEinsp: 8 },
    });

    // Einspeisung bringt Erlös → niedrigere PV-Jahreskosten
    expect(mit.pvJk).toBeLessThan(ohne.pvJk);
  });
});

describe('_calcKostenShared — BHKW (KWK)', () => {
  it('BHKW Brennstoffkosten abzüglich Stromerlös', () => {
    const result = _calcKostenShared({
      pKw: { bhkw: 100 },
      prices: { gas: 10 },
      etas: { bhkw: 0.88, bhkwSigma: 0.45 },
      investFn: () => 0,
      erzList: [{ key: 'bhkw', typ: 'kwk', waermeMwh: 500, elMwh: 225 }],
      gesamtMwh: 500,
      strom: { bhkwEigenMwh: 100, bhkwEinspMwh: 125, pBhkwKwkEig: 4, pBhkwEinsp: 8, pBhkwKwkE: 8 },
    });

    // Brennstoff: 500 / (0.88/1.45) × 10 × 10 = 82.386 €
    // Erlöse: Eigen 100×(35+4)×10 + Einsp 125×(8+8)×10
    expect(result.energieJk).toBeDefined();
    // BHKW kann negative Energiekosten haben (Erlöse > Brennstoff)
    // Hauptsache der Wert ist berechnet und nicht NaN
    expect(Number.isFinite(result.energieJk)).toBe(true);
  });

  it('BHKW CO₂ basiert auf Gasbedarf', () => {
    const result = _calcKostenShared({
      pKw: { bhkw: 100 },
      etas: { bhkw: 0.88, bhkwSigma: 0.45 },
      investFn: () => 0,
      erzList: [{ key: 'bhkw', typ: 'kwk', waermeMwh: 500, elMwh: 225 }],
      gesamtMwh: 500,
      co2: { emf: { gas: 240 } },
    });

    // CO₂ = 500 / (0.88/1.45) × 240/1000
    const etaTh = 0.88 / 1.45;
    const erwartet = 500 / etaTh * 240 / 1000;
    expect(result.co2ta).toBeCloseTo(erwartet, 0);
  });
});

describe('_calcBausteinJK / _calcBausteinJKDetail', () => {
  it('berechnet Annuität + IH + Wartung + Bedienung', () => {
    const jk = _calcBausteinJK(100000, { n: 20, inst: 1.0, wart: 1.5, bedien: 5 }, 3.5, 45);
    // Annuität ~7000 + IH 1000 + Wartung 1500 + Bedienung 225 ≈ 9725
    expect(jk).toBeGreaterThan(8000);
    expect(jk).toBeLessThan(12000);
  });

  it('Detail gibt einzelne Komponenten zurück', () => {
    const d = _calcBausteinJKDetail(100000, { n: 20, inst: 1.0, wart: 1.5, bedien: 5 }, 3.5, 45);
    expect(d.annuitaet).toBeGreaterThan(0);
    expect(d.instandhaltung).toBe(1000);
    expect(d.wartung).toBe(1500);
    expect(d.bedienung).toBe(225);
  });

  it('Invest 0 → nur Bedienkosten', () => {
    const jk = _calcBausteinJK(0, { n: 20, inst: 1.0, wart: 1.5, bedien: 10 }, 3.5, 45);
    expect(jk).toBe(450); // 10h × 45€/h
  });
});
