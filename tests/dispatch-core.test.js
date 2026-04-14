import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  // Lade Abhängigkeiten in der richtigen Reihenfolge
  loadScript('config/netz-kosten.js');
  loadScript('config/erzeuger-cfg.js');
  loadScript('config/optimizer-defaults.js');
  loadScript('01-globals-varianten.js');
  // 06c braucht einige Funktionen die in anderen Dateien definiert sind
  // Wir definieren die nötigsten Stubs
  globalThis.recalcNetz = () => {};
  globalThis.recalcStromNetz = () => {};
  globalThis.redrawErzeugerIcons = () => {};
  globalThis.calcStromPanel = () => {};
  globalThis.saSetTab = () => {};
  globalThis.saCurrentTab = 'lastgang';
  globalThis.gebaeude = [];
  globalThis.isExcluded = () => false;
  globalThis.getComputedStats = (g) => ({ waerme: parseFloat(g.waerme)||0, heizlast: parseFloat(g.heizlast)||0 });
  globalThis.glLastgangKw = null;
  loadScript('06c-dispatch-core.js');
});

// Hilfsfunktion: einfachen Lastgang erzeugen (konstant)
function makeConstantLoad(kw, hours = 8760) {
  return new Float32Array(hours).fill(kw);
}

// Einfache Erzeuger-Liste bauen
function makeErzList(entries) {
  return entries.map(e => ({
    key: e.key,
    typ: e.typ || 'fix',
    leistKw: e.kw,
    guetegrad: e.guetegrad || 0.42,
    color: '#888',
  }));
}

describe('_dispatchCore — Energiebilanz', () => {
  it('Gaskessel deckt gesamte Last bei 100 kW konstant', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(100, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: makeErzList([{ key: 'gaskessel', kw: 200 }]),
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: false,
      backupMode: false,
    });

    // Gesamte thermische Energie: 100 kW × 8760 h = 876.000 kWh = 876 MWh
    expect(result.thKwh.gaskessel).toBeCloseTo(876000, -2);
    expect(result.gesamtKwh).toBeCloseTo(876000, -2);
    // Kein Residual (Kessel deckt alles)
    expect(result.autoGkKwh).toBeCloseTo(0, 0);
  });

  it('Energiebilanz stimmt: Summe Erzeuger = Gesamtlast', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(150, n),
      tempH: new Float32Array(n).fill(0),
      vlH: new Float32Array(n).fill(50),
      erzList: makeErzList([
        { key: 'lwwp', typ: 'wp', kw: 100, guetegrad: 0.42 },
        { key: 'gaskessel', kw: 200 },
      ]),
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 0,
      recordHourly: false,
      backupMode: false,
    });

    const summeErz = Object.values(result.thKwh).reduce((s, v) => s + v, 0);
    // Summe aller Erzeuger + AutoGK = Gesamtlast
    expect(summeErz + result.autoGkKwh).toBeCloseTo(result.gesamtKwh, -1);
  });

  it('Merit-Order: erster Erzeuger wird bevorzugt', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(80, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: makeErzList([
        { key: 'pellets', kw: 100 },   // zuerst in Liste → Grundlast
        { key: 'gaskessel', kw: 100 },  // danach → Spitzenlast
      ]),
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: false,
      backupMode: false,
    });

    // Pellets sollte fast alles decken (80 kW < 100 kW Kapazität)
    expect(result.thKwh.pellets).toBeGreaterThan(result.thKwh.gaskessel);
    // Gaskessel sollte ~0 sein
    expect(result.thKwh.gaskessel).toBeCloseTo(0, 0);
  });

  it('WP erzeugt Strom-Verbrauch', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(100, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: makeErzList([
        { key: 'lwwp', typ: 'wp', kw: 200, guetegrad: 0.42 },
      ]),
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: false,
      backupMode: false,
    });

    // WP braucht Strom: elKwh > 0
    expect(result.elKwh.lwwp).toBeGreaterThan(0);
    // COP ≈ 3-4 → Strom ≈ 25-33% der Wärme
    const cop_eff = result.thKwh.lwwp / result.elKwh.lwwp;
    expect(cop_eff).toBeGreaterThan(2);
    expect(cop_eff).toBeLessThan(6);
  });

  it('Speicher entladen funktioniert', () => {
    const n = 24; // ein Tag reicht
    // Last: 200 kW morgens (h0-h11), 0 kW nachmittags (h12-h23)
    const load = new Float32Array(n);
    for (let h = 0; h < 12; h++) load[h] = 200;

    const result = _dispatchCore({
      lastgangKw: load,
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: makeErzList([
        { key: 'gaskessel', kw: 300 },
      ]),
      speicherParams: { kapKwh: 500, verlustRate: 0.005, entladeKw: 100 },
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: true,
      backupMode: false,
    });

    expect(result.hatSpeicher).toBe(true);
    // Speicher sollte Daten haben
    expect(result.thermSocH).toBeDefined();
    expect(result.thermSocH.length).toBe(n);
  });
});

describe('_dispatchCore — Randfälle', () => {
  it('leere Erzeugerliste → alles auf AutoGK', () => {
    const n = 100;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(50, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [],
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: false,
      backupMode: false,
    });

    // Gesamte Last geht auf AutoGK (Automatischer Gaskessel)
    expect(result.autoGkKwh).toBeCloseTo(50 * n, -1);
  });

  it('Lastgang 0 kW → keine Erzeugung', () => {
    const n = 100;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(0, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: makeErzList([{ key: 'gaskessel', kw: 100 }]),
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: false,
      backupMode: false,
    });

    expect(result.gesamtKwh).toBe(0);
    expect(result.thKwh.gaskessel).toBe(0);
  });
});
