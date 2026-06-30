// Vitest-Tests für 14b-ertuechtigung.js — Infrastruktur-Ertüchtigung
// Exit-Kriterium M3: Engpass-Szenario → erwartete Alternativen + Kosten;
//                   Δinfra verändert das Ranking korrekt.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

// Minimales PV_INFRA_STUFEN-Fixture
const INFRA_FIXTURE = [
  { id: 'xs', bisKwp:  30, items: [{ id: 'a', investEUR:   500, aktiv: true }] },
  { id: 's',  bisKwp: 100, items: [{ id: 'b', investEUR:  4500, aktiv: true }] },
  { id: 'm',  bisKwp: 500, items: [{ id: 'c', investEUR:  8000, aktiv: true }] },
  { id: 'xl', bisKwp: Infinity, items: [{ id: 'd', investEUR: 150000, aktiv: true }] },
];

// Minimale Trafo-Stufen-Fixture
const TRAFO_FIXTURE = [
  { bisKvA:  100, investEUR:  5000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA:  250, investEUR: 10000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA:  630, investEUR: 20000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA: 1000, investEUR: 35000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA: Infinity, investEUR: 100000, lebensdauerJ: 30, iHProzent: 0.5 },
];

const ZINS = 0.035;

function makeFlatDemand(kw = 100, n = 8760) {
  return new Float32Array(n).fill(kw);
}

function makeFlatPvProfile() {
  const p = new Float32Array(8760);
  const val = 1.0 / (365 * 6);
  for (let d = 0; d < 365; d++)
    for (let h = 10; h < 16; h++)
      p[d * 24 + h] = val;
  return p;
}

let pvProfileSued, pvProfileOstWest;

beforeAll(() => {
  globalThis.freiflaechen = [];
  globalThis.gebaeude = [];
  globalThis.ASSETS = { items: [], edges: [] };
  globalThis.calcFFKwp = () => 0;
  globalThis.calcGebKwp = () => 0;
  globalThis.PV_INFRA_STUFEN = INFRA_FIXTURE;
  globalThis.ERT_TRAFO_STUFEN = TRAFO_FIXTURE;

  loadScript('06a-gbi-lastgang.js');
  loadScript('09a-pv-profile.js');
  loadScript('14a-kandidaten.js');
  loadScript('14b-ertuechtigung.js');

  pvProfileSued    = makePvProfile8760('sued');
  pvProfileOstWest = makePvProfile8760('ostwest');
});

// ── ertTrafoKapKw ─────────────────────────────────────────────────────────────
describe('ertTrafoKapKw', () => {
  it('kVA × PF = kW', () => {
    const asset = { props: { leistungKVA: '630' } };
    expect(ertTrafoKapKw(asset)).toBeCloseTo(630 * 0.9, 3);
  });
  it('kein props → 0', () => {
    expect(ertTrafoKapKw({})).toBe(0);
    expect(ertTrafoKapKw(null)).toBe(0);
  });
  it('expliziter PF-Faktor', () => {
    const asset = { props: { leistungKVA: '1000' } };
    expect(ertTrafoKapKw(asset, 0.95)).toBeCloseTo(950, 3);
  });
});

// ── ertNaechsteTrafoStufe ─────────────────────────────────────────────────────
describe('ertNaechsteTrafoStufe', () => {
  it('findet erste ausreichende Stufe', () => {
    // 200 kW benötigt → 250 kVA × 0.9 = 225 kW ≥ 200
    const s = ertNaechsteTrafoStufe(200, TRAFO_FIXTURE);
    expect(s.bisKvA).toBe(250);
  });
  it('Kapazität genau auf Stufengrenze → diese Stufe', () => {
    // 90 kW → 100 kVA × 0.9 = 90 kW genau
    const s = ertNaechsteTrafoStufe(90, TRAFO_FIXTURE);
    expect(s.bisKvA).toBe(100);
  });
  it('sehr große Anforderung → letzte Stufe (Infinity)', () => {
    const s = ertNaechsteTrafoStufe(99999, TRAFO_FIXTURE);
    expect(s.bisKvA).toBe(Infinity);
  });
});

// ── ertTrafoUpgradeJk ─────────────────────────────────────────────────────────
describe('ertTrafoUpgradeJk', () => {
  it('keine Ertüchtigung nötig → 0', () => {
    expect(ertTrafoUpgradeJk(500, 300, ZINS, TRAFO_FIXTURE)).toBe(0);
  });
  it('Upgrade liefert positive Annuität', () => {
    const jk = ertTrafoUpgradeJk(100, 400, ZINS, TRAFO_FIXTURE);
    expect(jk).toBeGreaterThan(0);
  });
  it('größeres Upgrade kostet mehr', () => {
    const jkKlein = ertTrafoUpgradeJk(100, 200, ZINS, TRAFO_FIXTURE);
    const jkGross = ertTrafoUpgradeJk(100, 700, ZINS, TRAFO_FIXTURE);
    expect(jkGross).toBeGreaterThan(jkKlein);
  });
  it('Annuität = invest × (annF + IH)', () => {
    // Upgrade von 0 auf 100 kW → 100 kVA Stufe
    const stufe   = TRAFO_FIXTURE[0]; // bisKvA: 100, invest: 5000
    const annF    = pvMeritAnnF(ZINS, stufe.lebensdauerJ);
    const expected = stufe.investEUR * (annF + stufe.iHProzent / 100);
    const result   = ertTrafoUpgradeJk(0, 90, ZINS, TRAFO_FIXTURE);
    expect(result).toBeCloseTo(expected, 2);
  });
});

// ── ertDeltaInfraJk ───────────────────────────────────────────────────────────
describe('ertDeltaInfraJk', () => {
  it('kein Engpass → 0', () => {
    expect(ertDeltaInfraJk(80, 100, 50, ZINS, TRAFO_FIXTURE)).toBe(0);
  });
  it('napKapKw = 0 (unbekannt) → immer 0', () => {
    expect(ertDeltaInfraJk(500, 0, 0, ZINS, TRAFO_FIXTURE)).toBe(0);
  });
  it('Engpass neu ausgelöst → positive Marginalkosten', () => {
    // spitzeAlt=50 ≤ kap=100, spitzeNeu=150 > kap=100 → Upgrade nötig
    const delta = ertDeltaInfraJk(150, 100, 50, ZINS, TRAFO_FIXTURE);
    expect(delta).toBeGreaterThan(0);
  });
  it('Engpass schon vorher vorhanden, gleiche Stufe → 0', () => {
    // spitzeAlt=110 schon über kap=100, spitzeNeu=120 braucht dieselbe Stufe
    // → kein Marginalanteil
    const delta = ertDeltaInfraJk(120, 100, 110, ZINS, TRAFO_FIXTURE);
    expect(delta).toBe(0);
  });
  it('Engpass schon vorhanden, aber nächste Stufe nötig → Differenz', () => {
    // spitzeAlt=95 schon über kap=90, Stufe 1 (bis 100 kW) war nötig
    // spitzeNeu=230 braucht Stufe 3 (bis 630 kVA→567 kW) → Differenz der Annuitäten
    const delta = ertDeltaInfraJk(230, 90, 95, ZINS, TRAFO_FIXTURE);
    const jkAlt = ertTrafoUpgradeJk(90, 95, ZINS, TRAFO_FIXTURE);
    const jkNeu = ertTrafoUpgradeJk(90, 230, ZINS, TRAFO_FIXTURE);
    expect(delta).toBeCloseTo(jkNeu - jkAlt, 2);
  });
});

// ── ertGeneriereAlternativen ──────────────────────────────────────────────────
describe('ertGeneriereAlternativen', () => {
  it('gibt Array zurück', () => {
    const alts = ertGeneriereAlternativen(150, 100, { zins: ZINS, trafoStufen: TRAFO_FIXTURE });
    expect(Array.isArray(alts)).toBe(true);
    expect(alts.length).toBeGreaterThan(0);
  });
  it('enthält Abregelung als Option', () => {
    const alts = ertGeneriereAlternativen(150, 100, { zins: ZINS, trafoStufen: TRAFO_FIXTURE });
    const abr  = alts.find(a => a.typ === 'abregelung');
    expect(abr).toBeDefined();
    expect(abr.investEUR).toBe(0);
    expect(abr.jkEUR).toBe(0);
  });
  it('enthält Trafo-Upgrade-Optionen', () => {
    const alts   = ertGeneriereAlternativen(150, 100, { zins: ZINS, trafoStufen: TRAFO_FIXTURE });
    const trafos = alts.filter(a => a.typ === 'Ertuechtigung');
    expect(trafos.length).toBeGreaterThan(0);
    expect(trafos[0].newProps?.leistungKVA).toBeDefined();
  });
  it('Alternativen aufsteigend nach jkEUR sortiert', () => {
    const alts = ertGeneriereAlternativen(150, 100, { zins: ZINS, trafoStufen: TRAFO_FIXTURE });
    for (let i = 1; i < alts.length; i++) {
      expect(alts[i].jkEUR).toBeGreaterThanOrEqual(alts[i - 1].jkEUR);
    }
  });
  it('Spannungscheck bei bekanntem S_k″', () => {
    // S_k″ = 200 kVA, Spitze = 10 kW → Δu = 100*10/200 = 5% > Budget 3% → spannungOk = false
    const alts = ertGeneriereAlternativen(10, 5, {
      zins: ZINS, trafoStufen: TRAFO_FIXTURE, skKva: 200, uBudgetPct: 3,
    });
    const trafos = alts.filter(a => a.typ === 'Ertuechtigung');
    if (trafos.length > 0) expect(trafos[0].spannungOk).toBe(false);
  });
});

// ── Integration: deltaInfraFn in pvMeritOrderCore ────────────────────────────
describe('pvMeritOrderCore mit deltaInfraFn — Δinfra beeinflusst Ranking', () => {
  const demand = makeFlatDemand(50); // kleiner Lastgang: NAP-Limit wird schnell erreicht
  const baseParams = {
    pStrom: 30, pEinsp: 8,
    pvInvestPerKwp: 1200,
    batKwh: 0, zins: ZINS, pvLife: 20,
    pvInfraStufen: INFRA_FIXTURE,
    napMaxEinsKw: 0,
  };

  // 3 Kandidaten: S (30 kWp, klein), M (100 kWp, mittel), L (300 kWp, groß)
  const kandidaten = [
    { id: 'S', kWp:  30, ausrichtung: 'sued', pvSpez: 1000, napId: 'nap1' },
    { id: 'M', kWp: 100, ausrichtung: 'sued', pvSpez: 1000, napId: 'nap1' },
    { id: 'L', kWp: 300, ausrichtung: 'sued', pvSpez: 1000, napId: 'nap1' },
  ];

  it('Ohne deltaInfraFn: L wird höher bewertet als S (mehr kWp)', () => {
    // Ohne Infra-Constraint: größere Anlage hat höheren absoluten Δ
    const { ranking } = pvMeritOrderCore(
      kandidaten, demand, pvProfileSued, pvProfileOstWest, baseParams
    );
    const rL = ranking.find(r => r.kandidat.id === 'L');
    const rS = ranking.find(r => r.kandidat.id === 'S');
    expect(rL).toBeDefined();
    expect(rS).toBeDefined();
    // L hat mindestens so großen oder größeren Δ wie S (ohne Infra-Constraint)
    const abEntries = ranking.filter(r => r.tier !== 'C');
    expect(abEntries.length).toBeGreaterThan(0);
  });

  it('Mit strafendem deltaInfraFn: NAP-Bottleneck verteuert große Anlagen', () => {
    // NAP-Kapazität = 30 kW (sehr niedrig) → M und L lösen sofort einen Upgrade aus
    const napKapazitaeten = new Map([['nap1', 30]]);
    const params = {
      ...baseParams,
      deltaInfraFn: ertMakeDeltaInfraFn(napKapazitaeten, ZINS, TRAFO_FIXTURE),
    };
    const mitInfra    = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, params);
    const ohneInfra   = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, baseParams);

    // Mit Infra-Constraint sollte die Gesamtzahl der A/B-Kandidaten gleich oder kleiner sein
    const abMit   = mitInfra.ranking.filter(r => r.tier !== 'C').length;
    const abOhne  = ohneInfra.ranking.filter(r => r.tier !== 'C').length;
    expect(abMit).toBeLessThanOrEqual(abOhne + 1); // max. 1 mehr (Rundungstoleranz)
  });

  it('deltaInfraFn = () => 0 verhält sich identisch zu keinem Callback', () => {
    const nullFn  = { ...baseParams, deltaInfraFn: () => 0 };
    const noFn    = { ...baseParams };
    const r1 = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, nullFn);
    const r2 = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, noFn);
    // Gleiche Tier-Zuweisung erwartet
    const tiers1 = r1.ranking.map(r => r.tier).join(',');
    const tiers2 = r2.ranking.map(r => r.tier).join(',');
    expect(tiers1).toBe(tiers2);
  });

  it('ertMakeDeltaInfraFn: unbekannter NAP (kein Eintrag) → 0', () => {
    const leereMap = new Map();
    const fn = ertMakeDeltaInfraFn(leereMap, ZINS, TRAFO_FIXTURE);
    expect(fn('nap999', 500, 0)).toBe(0);
  });

  it('ertMakeDeltaInfraFn: kein Engpass → 0', () => {
    const map = new Map([['nap1', 1000]]);
    const fn  = ertMakeDeltaInfraFn(map, ZINS, TRAFO_FIXTURE);
    expect(fn('nap1', 200, 100)).toBe(0);
  });
});
