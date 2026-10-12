import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';
import { spitzenkesselSpec, erzeugerSchluessel } from '../src/lib/spitzenkessel.js';
import { optKonzeptSchluessel, optSuchraum } from '../src/lib/optimierer-suche.js';
import { co2AusEinsatz } from '../src/lib/co2-einsatz.js';

beforeAll(() => {
  loadScript('config/netz-kosten.js');
  loadScript('config/erzeuger-cfg.js');
  loadScript('config/optimizer-defaults.js');
  loadScript('01-globals-varianten.js');
  globalThis.recalcNetz = () => {};
  globalThis.recalcStromNetz = () => {};
  globalThis.redrawErzeugerIcons = () => {};
  globalThis.calcStromPanel = () => {};
  globalThis.saSetTab = () => {};
  globalThis.saCurrentTab = 'lastgang';
  globalThis.gebaeude = [];
  globalThis.isExcluded = () => false;
  globalThis.getComputedStats = g => ({ waerme: parseFloat(g.waerme) || 0, heizlast: parseFloat(g.heizlast) || 0 });
  globalThis.glLastgangKw = null;
  loadScript('08-calc-engine.js');
  loadScript('06c-dispatch-core.js');
  loadScript('lib/vdi-bedien.js');
  loadScript('lib/waermespeicher.js');
  loadScript('lib/vdi2067.js');
  loadScript('07b-analysis-economics.js');
});

describe('Art des automatischen Spitzenlastkessels', () => {
  it('Standard Erdgas, Zuordnung zum gleichartigen Erzeuger', () => {
    expect(spitzenkesselSpec(undefined).key).toBe('gaskessel');
    expect(spitzenkesselSpec('xyz').art).toBe('gas');
    expect(spitzenkesselSpec('heizoel').key).toBe('heizoel');
    expect(spitzenkesselSpec('strom')).toMatchObject({ key: 'stromkessel', verbrennung: false, fossil: false, strom: true });
    expect(erzeugerSchluessel('_autoGk', 'strom')).toBe('stromkessel');
    expect(erzeugerSchluessel('lwwp', 'strom')).toBe('lwwp');
  });

  const investFn = (tech, kw) => Math.round(kw * ({ gaskessel: 60, heizoel: 70, stromkessel: 90 }[tech] || 100));
  const kosten = (agkKey, el = 0) => _calcKostenShared({
    pKw: { lwwp: 500, _autoGk: 400 }, agkKey, zinsPct: 3.5, lohn: 45,
    prices: { gas: 11, hko: 12, strom: 30, stromWp: 25 }, etas: { gaskessel: 0.92, heizoel: 0.9 },
    investFn, co2: { pCo2: 50, emf: { gas: 240, heizoel: 310, strom: 400 } },
    erzList: [{ key: 'lwwp', typ: 'wp', waermeMwh: 900, elMwh: 300 }, { key: '_autoGk', typ: 'fix', waermeMwh: 100, elMwh: el }],
    gesamtMwh: 1000,
  });
  const zeile = (r, id) => r.bausteinRows.find(b => b.id === id);
  const energie = (r, key) => r.energyRows.find(e => e.key === key)?.kosten;

  it('Kostenrechnung: Investition, Energie, CO₂ und Schornstein nach der gewählten Art', () => {
    const gas = kosten(undefined), oel = kosten('heizoel'), strom = kosten('stromkessel', 100 / 0.99);
    // Investition des Spitzenlastkessels wie der gleichartige Kessel
    expect(zeile(gas, 'gk_auto').inv).toBe(400 * 60);
    expect(zeile(oel, 'gk_auto').inv).toBe(400 * 70);
    expect(zeile(strom, 'gk_auto').inv).toBe(400 * 90);
    // Energie: 100 MWh Wärme / η × Preis
    expect(energie(gas, '_autoGk')).toBeCloseTo(100 / 0.92 * 11 * 10, 6);
    expect(energie(oel, '_autoGk')).toBeCloseTo(100 / 0.9 * 12 * 10, 6);
    expect(energie(strom, '_autoGk')).toBeCloseTo(100 / 0.99 * 25 * 10, 6);   // WP-/Stromkesseltarif
    // Schornstein nur für Feuerungsanlagen
    expect(zeile(gas, 'schornstein')).toBeTruthy();
    expect(zeile(strom, 'schornstein')).toBeUndefined();
    // CO₂: Heizöl mehr als Gas, Strom nach Strommix
    const co2Wp = 300 * 400 / 1e3;
    expect(gas.co2ta).toBeCloseTo(co2Wp + 100 / 0.92 * 240 / 1e3, 6);
    expect(oel.co2ta).toBeCloseTo(co2Wp + 100 / 0.9 * 310 / 1e3, 6);
    expect(strom.co2ta).toBeCloseTo(co2Wp + 100 / 0.99 * 400 / 1e3, 6);
  });

  it('Dispatch-Kern: Spitzenlast-Stromkessel geht in die Strombilanz', () => {
    const n = 8760;
    const lauf = agkStromEta => _dispatchCore({
      lastgangKw: new Float32Array(n).fill(300), tempH: new Float32Array(n).fill(5), vlH: new Float32Array(n).fill(45),
      erzList: [{ key: 'pellets', typ: 'fix', leistKw: 200, guetegrad: 0 }], speicherParams: null, stProfile: null, stExcessH: null,
      bhkwSigma: 0.45, skEta: 0.99, lwwpMinCop: 0, quelleTemp: () => 5, recordHourly: false, backupMode: false, agkStromEta,
    });
    const gas = lauf(0), strom = lauf(0.99);
    expect(gas.autoGkElKwh).toBe(0);
    expect(strom.autoGkKwh).toBeCloseTo(100 * n, 0);
    expect(strom.autoGkElKwh).toBeCloseTo(100 * n / 0.99, 0);
    expect(strom.skElH[0]).toBeCloseTo(100 / 0.99, 4);
  });

  it('Optimierer: Konzept und impliziter Spitzenlastkessel folgen der Art', () => {
    expect(optKonzeptSchluessel(['lwwp'], 0, 300, 'stromkessel')).toBe('lwwp+stromkessel');
    expect(optKonzeptSchluessel(['lwwp'], 0, 300)).toBe('gaskessel+lwwp');
    const typen = { lwwp: 'wp', gaskessel: 'fix', heizoel: 'fix' };
    const merit = ['lwwp', 'gaskessel', 'heizoel'];
    const oel = optSuchraum({ aktiv: ['lwwp', 'heizoel', 'gaskessel'], constraints: {}, jahr: 2030, peak: 1000, typen, meritOrder: merit, agkKey: 'heizoel' });
    expect(oel.gasImplizit).toBe(true);
    expect(oel.agkKey).toBe('heizoel');
    expect(oel.kombis.some(k => k.keys.includes('heizoel'))).toBe(false);
    expect(oel.kombis.some(k => k.keys.includes('gaskessel'))).toBe(true);
  });

  it('CO₂ aus der Einsatzplanung: Spitzenlastkessel nach Art', () => {
    const en = { _autoGk: { waermeMwh: 92, elMwh: 0 } };
    const ef = { gas: 240, oel: 310, strom: 400 }, eta = { gaskessel: 0.92, heizoel: 0.92, stromkessel: 0.92 };
    expect(co2AusEinsatz(en, ef, eta).t).toBeCloseTo(24, 6);
    expect(co2AusEinsatz(en, ef, eta, {}, 'heizoel').t).toBeCloseTo(31, 6);
    expect(co2AusEinsatz(en, ef, eta, {}, 'stromkessel').t).toBeCloseTo(40, 6);
  });
});
