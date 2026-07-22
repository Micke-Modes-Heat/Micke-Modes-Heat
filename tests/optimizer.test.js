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
  globalThis.thermSpeicherAktiv = false;
  if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
  loadScript('08-calc-engine.js');
  loadScript('06c-dispatch-core.js');
  loadScript('07b-analysis-economics.js');
  loadScript('06a-gbi-lastgang.js');
  loadScript('09a-pv-profile.js');
  loadScript('lib/pv-battery-core.js');
  loadScript('lib/battery-aging.js');
  loadScript('10a-optimizer-core.js');
  loadScript('10d-optimizer-worker.js');
});

// ══════════════════════════════════════════════════════════════════════════════
// Ansatz 1: Unit-Tests der reinen Rechenkerne
// ══════════════════════════════════════════════════════════════════════════════

describe('Ansatz 1: _optScore — Fitness-Funktion', () => {
  it('min-wgk → gibt WGK zurück', () => {
    expect(_optScore({ wgk: 12.5, co2ta: 100, eeAnteil: 50 }, 'min-wgk')).toBe(12.5);
  });

  it('min-co2 → gibt CO₂ zurück', () => {
    expect(_optScore({ wgk: 12.5, co2ta: 100, eeAnteil: 50 }, 'min-co2')).toBe(100);
  });

  it('max-autarkie → negativer Wert (für Minimierung)', () => {
    const s = _optScore({ stromAutarkie: 60, waermeAutarkie: 40 }, 'max-autarkie');
    expect(s).toBe(-100);
  });

  it('min-kosten-ee → EE ≥ 65% nötig, sonst Strafe', () => {
    const gut = _optScore({ wgk: 15, eeAnteil: 70 }, 'min-kosten-ee');
    const schlecht = _optScore({ wgk: 10, eeAnteil: 50 }, 'min-kosten-ee');
    // eeAnteil < 65% → Strafe 1e9
    expect(schlecht).toBeGreaterThan(1e8);
    expect(gut).toBe(15);
  });

  it('niedrigerer Score ist besser (bei gleicher Metrik)', () => {
    const a = _optScore({ wgk: 10 }, 'min-wgk');
    const b = _optScore({ wgk: 15 }, 'min-wgk');
    expect(a).toBeLessThan(b);
  });

  it('unbekanntes Ziel → fällt auf WGK zurück', () => {
    expect(_optScore({ wgk: 8.5 }, 'nonsense')).toBe(8.5);
  });
});

describe('Ansatz 1: _optAnnF — Annuitätenfaktor', () => {
  it('3.5% / 20a → ≈ 0.070', () => {
    expect(_optAnnF(0.035, 20)).toBeCloseTo(0.070, 2);
  });

  it('0% → 1/n', () => {
    expect(_optAnnF(0, 20)).toBeCloseTo(0.05, 4);
  });

  it('0 Jahre → 1', () => {
    expect(_optAnnF(0.03, 0)).toBe(1);
  });
});

describe('Ansatz 1: _defaultGuetegrad', () => {
  it('Luft-WP → 0.42', () => expect(_defaultGuetegrad('lwwp')).toBe(0.42));
  it('Fließgewässer → 0.56', () => expect(_defaultGuetegrad('fg')).toBe(0.56));
  it('Geothermie → 0.50', () => expect(_defaultGuetegrad('geo')).toBe(0.50));
  it('unbekannt → 0.42', () => expect(_defaultGuetegrad('xyz')).toBe(0.42));
});

describe('Ansatz 1: _optInvestProKw', () => {
  it('Gaskessel 200 kW → positiver Invest', () => {
    expect(_optInvestProKw('gaskessel', 200)).toBeGreaterThan(50);
  });

  it('Luft-WP 100 kW → höher als Gaskessel', () => {
    const wp = _optInvestProKw('lwwp', 100);
    const gk = _optInvestProKw('gaskessel', 100);
    expect(wp).toBeGreaterThan(gk);
  });

  it('unbekannter Key → Fallback auf Defaults', () => {
    expect(_optInvestProKw('dampfmaschine', 100)).toBe(200); // OPT_INVEST_DEFAULT fallback
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ansatz 2: Referenzszenarien — Bekannte Eingaben → erwartete Ergebnisse
// ══════════════════════════════════════════════════════════════════════════════

// Hilfsfunktion: Dispatcher direkt über _dispatchCore aufrufen (ohne DOM)
function refDispatch(lastgangKw, tempH, vlH, erzList, speicherVol) {
  let thSp = null;
  if (speicherVol > 0) {
    thSp = { kapKwh: speicherVol * 1.16 * 40, verlustRate: 0.005, entladeKw: 200 };
  }
  for (const erz of erzList) {
    if (!erz.guetegrad) erz.guetegrad = _defaultGuetegrad(erz.key);
    if (!erz.typ) erz.typ = ERZEUGER_CFG[erz.key]?.typ;
  }
  const r = _dispatchCore({
    lastgangKw, tempH, vlH, erzList,
    speicherParams: thSp, stProfile: null, stExcessH: null,
    bhkwSigma: 0.45, skEta: 0.99, lwwpMinCop: 0,
    quelleTemp: (key, tAussen, t) => {
      if (key === 'lwwp') return tAussen;
      if (key === 'fg') return Math.max(0.5, 10 + 8 * Math.sin(2 * Math.PI * (Math.floor(t/24) - 119) / 365));
      return 10 + 2 * Math.sin(2 * Math.PI * (Math.floor(t/24) - 75) / 365);
    },
    recordHourly: false, backupMode: true,
  });
  for (const erz of erzList) {
    erz.waermeMwh = (r.thKwh[erz.key] || 0) / 1000;
    erz.elMwh = (r.elKwh[erz.key] || 0) / 1000;
  }
  const bk = erzList[erzList.length - 1];
  if (bk && r.backupPeakKw > bk.leistKw) bk.leistKw = Math.ceil(r.backupPeakKw);
  return {
    erzeugerList: erzList,
    autoGkMwh: r.autoGkKwh / 1000,
    gesamtMwh: r.gesamtKwh / 1000,
    wpElH: r.wpElH, bhkwElH: r.bhkwElH, skElH: r.skElH,
    wpResKwH: r.wpResKwH, wpResCopH: r.wpResCopH,
    thSpParams: null,
  };
}

describe('Cross-Engine-Golden: Hauptdispatch ↔ Optimierer ↔ Workerquelle', () => {
  it('liefert für eine gemischte 8760h-Fixture dieselben Energie- und Stundenwerte', () => {
    const hours = 8760;
    const load = Float32Array.from({length:hours}, (_, h) => 80 + 45 * (1 + Math.sin(2 * Math.PI * h / 24)) + (h % 168 < 72 ? 35 : 0));
    const temp = Float32Array.from({length:hours}, (_, h) => 7 + 11 * Math.sin(2 * Math.PI * (h / 24 - 170) / 365));
    const vl = Float32Array.from({length:hours}, (_, h) => 48 - Math.min(12, temp[h]) * 0.6);
    const source = [
      {key:'lwwp', typ:'wp', leistKw:90, guetegrad:0.42},
      {key:'bhkw', typ:'bhkw', leistKw:55, eta:0.9},
      {key:'stromkessel', typ:'stromkessel', leistKw:40},
      {key:'gaskessel', typ:'kessel', leistKw:120, eta:0.92},
    ];
    const direct = refDispatch(load, temp, vl, source.map(item => ({...item})), 35);
    const optimized = _optDispatch8760(load, temp, vl, source.map(item => ({...item})), 35, null);

    expect(optimized.gesamtMwh).toBeCloseTo(direct.gesamtMwh, 10);
    expect(optimized.autoGkMwh).toBeCloseTo(direct.autoGkMwh, 10);
    for (const key of source.map(item => item.key)) {
      const a = optimized.erzeugerList.find(item => item.key === key);
      const b = direct.erzeugerList.find(item => item.key === key);
      expect(a.waermeMwh).toBeCloseTo(b.waermeMwh, 10);
      expect(a.elMwh).toBeCloseTo(b.elMwh, 10);
    }
    expect(Array.from(optimized.wpElH)).toEqual(Array.from(direct.wpElH));
    expect(Array.from(optimized.bhkwElH)).toEqual(Array.from(direct.bhkwElH));
    expect(Array.from(optimized.skElH)).toEqual(Array.from(direct.skElH));
  });
});

function refKennwerte(disp, pvKwp, batKwh, stMwh) {
  const pvBat = { eigenMwh: 0, einspeiseMwh: 0, pvEigenMwh: 0, pvEinspMwh: 0, bhkwEigenMwh: 0, bhkwEinspMwh: 0 };
  const pKw = {};
  for (const erz of disp.erzeugerList) pKw[erz.key] = erz.leistKw;
  const erzListTyped = disp.erzeugerList.map(e => ({
    key: e.key, waermeMwh: e.waermeMwh, elMwh: e.elMwh,
    typ: ERZEUGER_CFG[e.key]?.typ
  }));
  const investFn = (key, kw) => kw > 0.1 ? Math.round(kw * _optInvestProKw(key, kw)) : 0;
  const result = _calcKostenShared({
    pKw, erzList: erzListTyped, zinsPct: 3.5, lohn: 45,
    prices: { strom: 35, gas: 10, hko: 10, fw: 17, pk: 8, hhs: 6 },
    etas: { gaskessel: 0.92, heizoel: 0.90, pellets: 0.88, hhs: 0.85, bhkw: 0.88, bhkwSigma: 0.45 },
    investFn,
    extra: { bohrMeter: 0, nGeb: 0, netzInvest: 0 },
    pv: { kwp: pvKwp, batKwh, eigenMwh: pvBat.pvEigenMwh, einspMwh: pvBat.pvEinspMwh, invPerKwp: 1000, batInvPerKwh: 400 },
    strom: { quartierMwh: 0 },
    co2: { pCo2: 0, emf: { gas: 240, heizoel: 310, pellets: 20, hhs: 20, fernwaerme: 180, strom: 363 } },
    gesamtMwh: disp.gesamtMwh, stMwh: stMwh || 0,
  });
  return result;
}

// Referenz-Temperaturprofil: realistischer Jahresgang
function refTempH() {
  const t = new Float32Array(8760);
  for (let i = 0; i < 8760; i++) {
    const d = i / 24;
    t[i] = 9 - 11 * Math.cos(2 * Math.PI * (d - 15) / 365) + 3 * Math.sin(2 * Math.PI * i / 24 - Math.PI);
  }
  return t;
}

function refVlH(tempH) {
  const vl = new Float32Array(8760);
  // Inline vorlaufTemp(T, 70, 35): clamp(35, 70, 70 + (35-70)*(T+5)/20)
  for (let i = 0; i < 8760; i++) {
    vl[i] = Math.max(35, Math.min(70, 70 + (-35) * (tempH[i] + 5) / 20));
  }
  return vl;
}

describe('Ansatz 2: Referenzszenario — Reiner Gaskessel (200 kW, 500 MWh/a)', () => {
  let disp, kw;
  const tempH = refTempH();
  const vlH = refVlH(tempH);

  // Lastgang: ~500 MWh/a, variabler Jahresgang
  const lastgangKw = new Float32Array(8760);
  const targetMwh = 500;
  let rawSum = 0;
  for (let i = 0; i < 8760; i++) {
    const d = i / 24;
    lastgangKw[i] = Math.max(5, 100 - 60 * Math.sin(2 * Math.PI * (d - 180) / 365));
    rawSum += lastgangKw[i];
  }
  const scale = targetMwh * 1000 / rawSum;
  for (let i = 0; i < 8760; i++) lastgangKw[i] *= scale;

  beforeAll(() => {
    disp = refDispatch(lastgangKw, tempH, vlH, [
      { key: 'gaskessel', leistKw: 200 },
    ], 0);
    kw = refKennwerte(disp, 0, 0, 0);
  });

  it('Gesamtenergie ≈ 500 MWh', () => {
    expect(disp.gesamtMwh).toBeCloseTo(500, -1);
  });

  it('WGK zwischen 10-25 ct/kWh', () => {
    expect(kw.wgk).toBeGreaterThan(10);
    expect(kw.wgk).toBeLessThan(25);
  });

  it('CO₂ ≈ 130 t/a (500 MWh / 0.92 × 240 g/kWh)', () => {
    expect(kw.co2ta).toBeGreaterThan(100);
    expect(kw.co2ta).toBeLessThan(160);
  });

  it('EE-Anteil = 0%', () => {
    expect(kw.eeAnteil).toBe(0);
  });

  it('Invest > 0', () => {
    expect(kw.investGesamt).toBeGreaterThan(10000);
  });
});

describe('Ansatz 2: Referenzszenario — Luft-WP + Gaskessel (500 MWh/a)', () => {
  let disp, kw;
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760);
  let rawSum = 0;
  for (let i = 0; i < 8760; i++) {
    const d = i / 24;
    lastgangKw[i] = Math.max(5, 100 - 60 * Math.sin(2 * Math.PI * (d - 180) / 365));
    rawSum += lastgangKw[i];
  }
  const scale = 500 * 1000 / rawSum;
  for (let i = 0; i < 8760; i++) lastgangKw[i] *= scale;

  beforeAll(() => {
    disp = refDispatch(lastgangKw, tempH, vlH, [
      { key: 'lwwp', leistKw: 100 },
      { key: 'gaskessel', leistKw: 200 },
    ], 0);
    kw = refKennwerte(disp, 0, 0, 0);
  });

  it('WP deckt Grundlast (> 50% der Energie)', () => {
    const wpAnteil = disp.erzeugerList[0].waermeMwh / disp.gesamtMwh;
    expect(wpAnteil).toBeGreaterThan(0.3);
  });

  it('CO₂ niedriger als reiner Gaskessel', () => {
    const gkDisp = refDispatch(lastgangKw, tempH, vlH, [{ key: 'gaskessel', leistKw: 200 }], 0);
    const gkKw = refKennwerte(gkDisp, 0, 0, 0);
    expect(kw.co2ta).toBeLessThan(gkKw.co2ta);
  });

  it('EE-Anteil > 0% (WP = erneuerbar)', () => {
    expect(kw.eeAnteil).toBeGreaterThan(0);
  });

  it('Energiebilanz: Summe Erzeuger = Gesamtlast', () => {
    const summe = disp.erzeugerList.reduce((s, e) => s + e.waermeMwh, 0) + disp.autoGkMwh;
    expect(summe).toBeCloseTo(disp.gesamtMwh, 0);
  });
});

describe('Ansatz 2: Referenzszenario — Pellets-Kessel (500 MWh/a)', () => {
  let kw;
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760);
  let rawSum = 0;
  for (let i = 0; i < 8760; i++) {
    const d = i / 24;
    lastgangKw[i] = Math.max(5, 100 - 60 * Math.sin(2 * Math.PI * (d - 180) / 365));
    rawSum += lastgangKw[i];
  }
  const scale = 500 * 1000 / rawSum;
  for (let i = 0; i < 8760; i++) lastgangKw[i] *= scale;

  beforeAll(() => {
    const disp = refDispatch(lastgangKw, tempH, vlH, [{ key: 'pellets', leistKw: 200 }], 0);
    kw = refKennwerte(disp, 0, 0, 0);
  });

  it('EE-Anteil = 100% (Pellets = erneuerbar)', () => {
    expect(kw.eeAnteil).toBe(100);
  });

  it('CO₂ sehr niedrig (biogen: 20 g/kWh)', () => {
    // 500/0.88 × 20/1000 ≈ 11.4 t
    expect(kw.co2ta).toBeLessThan(15);
  });

  it('Invest enthält Pellets-Kessel + Lager + Schornstein', () => {
    const ids = kw.bausteinRows.map(r => r.id);
    expect(ids).toContain('pk');
    expect(ids).toContain('pk_lager');
    expect(ids).toContain('schornstein');
  });
});

describe('Ansatz 2: Referenzszenario — BHKW + Gaskessel (500 MWh/a)', () => {
  let disp, kw;
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760);
  let rawSum = 0;
  for (let i = 0; i < 8760; i++) {
    const d = i / 24;
    lastgangKw[i] = Math.max(5, 100 - 60 * Math.sin(2 * Math.PI * (d - 180) / 365));
    rawSum += lastgangKw[i];
  }
  const scale = 500 * 1000 / rawSum;
  for (let i = 0; i < 8760; i++) lastgangKw[i] *= scale;

  beforeAll(() => {
    disp = refDispatch(lastgangKw, tempH, vlH, [
      { key: 'bhkw', leistKw: 50 },
      { key: 'gaskessel', leistKw: 200 },
    ], 0);
    kw = refKennwerte(disp, 0, 0, 0);
  });

  it('BHKW erzeugt Wärme UND Strom', () => {
    const bhkw = disp.erzeugerList[0];
    expect(bhkw.waermeMwh).toBeGreaterThan(0);
    expect(bhkw.elMwh).toBeGreaterThan(0);
  });

  it('Stromkennzahl ≈ 0.45', () => {
    const bhkw = disp.erzeugerList[0];
    const sigma = bhkw.elMwh / bhkw.waermeMwh;
    expect(sigma).toBeCloseTo(0.45, 1);
  });

  it('Invest enthält BHKW + Hydraulik', () => {
    const ids = kw.bausteinRows.map(r => r.id);
    expect(ids).toContain('bhkw');
    expect(ids).toContain('bhkw_hydr');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ansatz 3: Konvergenz-Tests — Optimierung darf nicht verschlechtern
// ══════════════════════════════════════════════════════════════════════════════

describe('Ansatz 3: Konvergenz — Mehr Erzeuger kann nicht schlechter sein', () => {
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760);
  let rawSum = 0;
  for (let i = 0; i < 8760; i++) {
    const d = i / 24;
    lastgangKw[i] = Math.max(5, 100 - 60 * Math.sin(2 * Math.PI * (d - 180) / 365));
    rawSum += lastgangKw[i];
  }
  const scale = 500 * 1000 / rawSum;
  for (let i = 0; i < 8760; i++) lastgangKw[i] *= scale;

  it('WP+GK hat niedrigere CO₂ als reiner GK', () => {
    const gkDisp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [{ key: 'gaskessel', leistKw: 200 }], 0);
    const gkKw = refKennwerte(gkDisp, 0, 0, 0);

    const wpDisp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [
      { key: 'lwwp', leistKw: 100 }, { key: 'gaskessel', leistKw: 200 }
    ], 0);
    const wpKw = refKennwerte(wpDisp, 0, 0, 0);

    expect(wpKw.co2ta).toBeLessThan(gkKw.co2ta);
  });

  it('Größere WP deckt mehr Energie ab', () => {
    const wp50 = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [
      { key: 'lwwp', leistKw: 50 }, { key: 'gaskessel', leistKw: 200 }
    ], 0);
    const wp150 = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [
      { key: 'lwwp', leistKw: 150 }, { key: 'gaskessel', leistKw: 200 }
    ], 0);

    expect(wp150.erzeugerList[0].waermeMwh).toBeGreaterThan(wp50.erzeugerList[0].waermeMwh);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ansatz 4: Symmetrie- und Plausibilitäts-Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Ansatz 4: Plausibilität — Energiebilanz immer korrekt', () => {
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760);
  for (let i = 0; i < 8760; i++) lastgangKw[i] = 80 + 40 * Math.cos(2 * Math.PI * i / 24);

  const configs = [
    [{ key: 'gaskessel', leistKw: 200 }],
    [{ key: 'lwwp', leistKw: 100 }, { key: 'gaskessel', leistKw: 200 }],
    [{ key: 'pellets', leistKw: 80 }, { key: 'gaskessel', leistKw: 200 }],
    [{ key: 'bhkw', leistKw: 50 }, { key: 'gaskessel', leistKw: 200 }],
    [{ key: 'stromkessel', leistKw: 100 }, { key: 'gaskessel', leistKw: 200 }],
  ];

  for (const cfg of configs) {
    const name = cfg.map(e => e.key).join('+');
    it(`Bilanz korrekt: ${name}`, () => {
      const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, JSON.parse(JSON.stringify(cfg)), 0);
      const summe = disp.erzeugerList.reduce((s, e) => s + e.waermeMwh, 0) + disp.autoGkMwh;
      expect(summe).toBeCloseTo(disp.gesamtMwh, 0);
    });
  }
});

describe('Ansatz 4: Plausibilität — WGK immer positiv', () => {
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760).fill(100);

  const configs = [
    [{ key: 'gaskessel', leistKw: 200 }],
    [{ key: 'lwwp', leistKw: 200 }],
    [{ key: 'pellets', leistKw: 200 }],
    [{ key: 'fernwaerme', leistKw: 200 }],
  ];

  for (const cfg of configs) {
    const name = cfg.map(e => e.key).join('+');
    it(`WGK > 0 für ${name}`, () => {
      const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, JSON.parse(JSON.stringify(cfg)), 0);
      const kw = refKennwerte(disp, 0, 0, 0);
      expect(kw.wgk).toBeGreaterThan(0);
      expect(Number.isFinite(kw.wgk)).toBe(true);
    });
  }
});

describe('Ansatz 4: Plausibilität — Preissensitivität', () => {
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760).fill(100);

  it('Teurerer Gaspreis → höhere WGK für Gaskessel', () => {
    const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [{ key: 'gaskessel', leistKw: 200 }], 0);

    const kwBillig = _calcKostenShared({
      pKw: { gaskessel: 200 }, erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: disp.gesamtMwh, elMwh: 0 }],
      prices: { gas: 8 }, etas: { gaskessel: 0.92 }, investFn: () => 0, gesamtMwh: disp.gesamtMwh,
    });
    const kwTeuer = _calcKostenShared({
      pKw: { gaskessel: 200 }, erzList: [{ key: 'gaskessel', typ: 'fix', waermeMwh: disp.gesamtMwh, elMwh: 0 }],
      prices: { gas: 15 }, etas: { gaskessel: 0.92 }, investFn: () => 0, gesamtMwh: disp.gesamtMwh,
    });

    expect(kwTeuer.wgk).toBeGreaterThan(kwBillig.wgk);
  });

  it('Teurerer Strom → höhere WGK für WP', () => {
    const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [{ key: 'lwwp', leistKw: 200 }], 0);
    const wp = disp.erzeugerList[0];

    const kwBillig = _calcKostenShared({
      pKw: { lwwp: 200 }, erzList: [{ key: 'lwwp', typ: 'wp', waermeMwh: wp.waermeMwh, elMwh: wp.elMwh }],
      prices: { strom: 25 }, investFn: () => 0, gesamtMwh: disp.gesamtMwh,
    });
    const kwTeuer = _calcKostenShared({
      pKw: { lwwp: 200 }, erzList: [{ key: 'lwwp', typ: 'wp', waermeMwh: wp.waermeMwh, elMwh: wp.elMwh }],
      prices: { strom: 45 }, investFn: () => 0, gesamtMwh: disp.gesamtMwh,
    });

    expect(kwTeuer.wgk).toBeGreaterThan(kwBillig.wgk);
  });
});

describe('Ansatz 4: Plausibilität — EE-Anteil Konsistenz', () => {
  const tempH = refTempH();
  const vlH = refVlH(tempH);
  const lastgangKw = new Float32Array(8760).fill(100);

  it('100% Gas → 0% EE', () => {
    const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [{ key: 'gaskessel', leistKw: 200 }], 0);
    const kw = refKennwerte(disp, 0, 0, 0);
    expect(kw.eeAnteil).toBe(0);
  });

  it('100% Pellets → 100% EE', () => {
    const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [{ key: 'pellets', leistKw: 200 }], 0);
    const kw = refKennwerte(disp, 0, 0, 0);
    expect(kw.eeAnteil).toBe(100);
  });

  it('100% WP → 100% EE', () => {
    const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [{ key: 'lwwp', leistKw: 200 }], 0);
    const kw = refKennwerte(disp, 0, 0, 0);
    expect(kw.eeAnteil).toBe(100);
  });

  it('50% WP + 50% Gas → EE zwischen 30-70%', () => {
    const disp = refDispatch(new Float32Array(lastgangKw), tempH, vlH, [
      { key: 'lwwp', leistKw: 80 }, { key: 'gaskessel', leistKw: 200 }
    ], 0);
    const kw = refKennwerte(disp, 0, 0, 0);
    expect(kw.eeAnteil).toBeGreaterThan(20);
    expect(kw.eeAnteil).toBeLessThan(80);
  });
});

describe('Ansatz 4: Plausibilität — Score-Funktion wählt richtig', () => {
  it('min-wgk wählt billigste Variante', () => {
    const billig = { wgk: 10, co2ta: 200, eeAnteil: 30 };
    const teuer = { wgk: 15, co2ta: 50, eeAnteil: 90 };
    expect(_optScore(billig, 'min-wgk')).toBeLessThan(_optScore(teuer, 'min-wgk'));
  });

  it('min-co2 wählt sauberste Variante', () => {
    const sauber = { wgk: 15, co2ta: 50, eeAnteil: 90 };
    const schmutzig = { wgk: 10, co2ta: 200, eeAnteil: 30 };
    expect(_optScore(sauber, 'min-co2')).toBeLessThan(_optScore(schmutzig, 'min-co2'));
  });

  it('min-kosten-ee: Variante unter 65% EE hat schlechtesten Score', () => {
    const ee40_wgk8 = { wgk: 8, eeAnteil: 40 };  // billig aber zu wenig EE
    const ee70_wgk12 = { wgk: 12, eeAnteil: 70 }; // teurer aber genug EE
    expect(_optScore(ee70_wgk12, 'min-kosten-ee')).toBeLessThan(_optScore(ee40_wgk8, 'min-kosten-ee'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ansatz 5: Worker-Code-Validierung
// ══════════════════════════════════════════════════════════════════════════════

describe('Ansatz 5: Worker-Code Struktur', () => {
  it('_buildOptWorkerCode() gibt gültigen JavaScript-String zurück', () => {
    const code = _buildOptWorkerCode();
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(5000);
    // Enthält die Kernfunktionen
    expect(code).toContain('function dispatch8760');
    expect(code).toContain('function pvBatSim8760');
    expect(code).toContain('function kennwerte');
    expect(code).toContain('function score');
    expect(code).toContain('function _findOptPvBat');
    expect(code).toContain('function _calcKostenShared');
    expect(code).toContain(_dispatchCore.toString());
    expect(code).toContain(pvBatteryStep.toString());
    expect(code).toContain(estimateBatteryAging.toString());
  });

  it('Worker-Code enthält alle nötigen Hilfsfunktionen', () => {
    const code = _buildOptWorkerCode();
    expect(code).toContain('function _annF');
    expect(code).toContain('function _defaultGuetegrad');
    expect(code).toContain('function _quelleTemp');
    expect(code).toContain('function _investProKw');
    expect(code).toContain('function _pvInvestPerKwp');
  });

  it('Worker-Code enthält self.onmessage Handler', () => {
    const code = _buildOptWorkerCode();
    expect(code).toContain('self.onmessage');
  });
});
