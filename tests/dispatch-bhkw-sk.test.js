import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

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
  globalThis.getComputedStats = () => ({ waerme: 0, heizlast: 0 });
  globalThis.glLastgangKw = null;
  loadScript('06c-dispatch-core.js');
});

function makeConstantLoad(kw, hours = 8760) {
  return new Float32Array(hours).fill(kw);
}

describe('_dispatchCore — BHKW (KWK)', () => {
  it('BHKW erzeugt gleichzeitig Wärme und Strom', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(80, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [{ key: 'bhkw', typ: 'kwk', leistKw: 100, guetegrad: 0.42, color: '#888' }],
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

    // BHKW deckt Wärme
    expect(result.thKwh.bhkw).toBeGreaterThan(0);
    // BHKW erzeugt Strom: el = th × sigma
    expect(result.elKwh.bhkw).toBeGreaterThan(0);
    const sigma = result.elKwh.bhkw / result.thKwh.bhkw;
    expect(sigma).toBeCloseTo(0.45, 1);
  });

  it('BHKW Mindestteillast 50% wird eingehalten', () => {
    const n = 100;
    // Last nur 20 kW, BHKW hat 100 kW → Mindestlast 50 kW > Bedarf
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(20, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [{ key: 'bhkw', typ: 'kwk', leistKw: 100, guetegrad: 0.42, color: '#888' }],
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

    // BHKW kann bei 20 kW Bedarf nicht laufen (Mindestlast 50 kW, kein Speicher)
    // → alles geht auf AutoGK
    expect(result.thKwh.bhkw).toBeCloseTo(0, 0);
    expect(result.autoGkKwh).toBeGreaterThan(0);
  });

  it('BHKW mit Speicher: kann Mindestlast fahren und überschüssige Wärme speichern', () => {
    const n = 100;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(30, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [{ key: 'bhkw', typ: 'kwk', leistKw: 100, guetegrad: 0.42, color: '#888' }],
      speicherParams: { kapKwh: 500, verlustRate: 0.005, entladeKw: 100 },
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: () => 5,
      recordHourly: false,
      backupMode: false,
    });

    // Mit Speicher kann BHKW auf Mindestlast laufen → Wärmeproduktion > 0
    expect(result.thKwh.bhkw).toBeGreaterThan(0);
  });
});

describe('_dispatchCore — Stromkessel', () => {
  it('Stromkessel erzeugt Wärme und verbraucht Strom', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(100, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [{ key: 'stromkessel', typ: 'fix', leistKw: 200, guetegrad: 0.42, color: '#888' }],
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

    expect(result.thKwh.stromkessel).toBeCloseTo(876000, -2);
    // Strom = Wärme / eta (0.99)
    expect(result.elKwh.stromkessel).toBeGreaterThan(0);
    const eta = result.thKwh.stromkessel / result.elKwh.stromkessel;
    expect(eta).toBeCloseTo(0.99, 1);
  });
});

describe('_dispatchCore — Multi-Erzeuger mit BHKW', () => {
  it('BHKW Grundlast + Gaskessel Spitze: korrekte Bilanz', () => {
    const n = 8760;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(120, n),
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [
        { key: 'bhkw', typ: 'kwk', leistKw: 80, guetegrad: 0.42, color: '#888' },
        { key: 'gaskessel', typ: 'fix', leistKw: 200, guetegrad: 0.42, color: '#888' },
      ],
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

    // BHKW deckt 80 kW Grundlast, Gaskessel die restlichen 40 kW
    expect(result.thKwh.bhkw).toBeCloseTo(80 * n, -3);
    expect(result.thKwh.gaskessel).toBeCloseTo(40 * n, -3);
    // Bilanz stimmt
    const summe = result.thKwh.bhkw + result.thKwh.gaskessel + result.autoGkKwh;
    expect(summe).toBeCloseTo(result.gesamtKwh, -1);
  });
});

describe('_dispatchCore — WP Randfälle', () => {
  it('Luft-WP bei niedrigem COP wird abgeschaltet (lwwpMinCop)', () => {
    const n = 100;
    // Sehr kalte Außentemperatur → niedriger COP
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(100, n),
      tempH: new Float32Array(n).fill(-20), // sehr kalt
      vlH: new Float32Array(n).fill(55),    // hohe Vorlauf
      erzList: [
        { key: 'lwwp', typ: 'wp', leistKw: 200, guetegrad: 0.42, color: '#888' },
        { key: 'gaskessel', typ: 'fix', leistKw: 200, guetegrad: 0.42, color: '#888' },
      ],
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 2.5, // Minimum COP
      quelleTemp: (key, tAussen) => tAussen, // Luft → gleich Außentemp
      recordHourly: false,
      backupMode: false,
    });

    // Bei -20°C und 55°C VL: COP = (328.15/75) × 0.42 ≈ 1.84 < 2.5
    // → WP wird abgeschaltet, Gaskessel übernimmt
    expect(result.thKwh.gaskessel).toBeGreaterThan(result.thKwh.lwwp);
  });

  it('Fließgewässer-WP schaltet bei < 2°C ab', () => {
    const n = 100;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(100, n),
      tempH: new Float32Array(n).fill(-5),
      vlH: new Float32Array(n).fill(45),
      erzList: [
        { key: 'fg', typ: 'wp', leistKw: 200, guetegrad: 0.56, color: '#888' },
        { key: 'gaskessel', typ: 'fix', leistKw: 200, guetegrad: 0.42, color: '#888' },
      ],
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: (key, tAussen) => key === 'fg' ? 1.5 : tAussen, // Fließgewässer < 2°C
      recordHourly: false,
      backupMode: false,
    });

    // Fließgewässer-WP darf bei tQ < 2°C nicht laufen
    expect(result.thKwh.fg).toBeCloseTo(0, 0);
    expect(result.thKwh.gaskessel).toBeGreaterThan(0);
  });
});

describe('_dispatchCore — backupMode', () => {
  it('letzter Erzeuger hat unbegrenzte Kapazität im backupMode', () => {
    const n = 100;
    const result = _dispatchCore({
      lastgangKw: makeConstantLoad(500, n), // 500 kW Bedarf
      tempH: new Float32Array(n).fill(5),
      vlH: new Float32Array(n).fill(45),
      erzList: [
        { key: 'lwwp', typ: 'wp', leistKw: 100, guetegrad: 0.42, color: '#888' },
        { key: 'gaskessel', typ: 'fix', leistKw: 50, guetegrad: 0.42, color: '#888' }, // nur 50 kW
      ],
      speicherParams: null,
      stProfile: null,
      stExcessH: null,
      bhkwSigma: 0.45,
      skEta: 0.99,
      lwwpMinCop: 1.5,
      quelleTemp: (key, tAussen) => tAussen,
      recordHourly: false,
      backupMode: true, // letzter Erzeuger = Backup
    });

    // Gaskessel deckt alles was WP nicht schafft, auch über seine 50 kW hinaus
    const summe = result.thKwh.lwwp + result.thKwh.gaskessel + result.autoGkKwh;
    expect(summe).toBeCloseTo(result.gesamtKwh, -1);
    // AutoGK sollte 0 sein (Backup deckt alles)
    expect(result.autoGkKwh).toBeCloseTo(0, 0);
  });
});
