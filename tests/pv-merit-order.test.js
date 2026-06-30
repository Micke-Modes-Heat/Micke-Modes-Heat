// Vitest-Tests für 14a-kandidaten.js — pvMeritOrderCore + pure helpers
// Exit-Kriterium M2: synthetische Kandidatenmenge → erwartete Reihenfolge/Tiers

import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

// Minimales PV_INFRA_STUFEN-Fixture (aktiviert nur Pauschalkosten, kein perKwh)
const INFRA_FIXTURE = [
  { id: 'xs', bisKwp:  30, items: [{ id: 'a', label: 'Anschluss', investEUR:   500, aktiv: true }] },
  { id: 's',  bisKwp: 100, items: [{ id: 'b', label: 'NVP',       investEUR:  4500, aktiv: true }] },
  { id: 'm',  bisKwp: 500, items: [{ id: 'c', label: 'EZA',       investEUR:  8000, aktiv: true }] },
  { id: 'xl', bisKwp: Infinity, items: [{ id: 'd', label: 'ÜES', investEUR: 150000, aktiv: true }] },
];

// Synthetischer konstanter Lastgang: 100 kW rund um die Uhr
function makeFlatDemand(kw = 100, n = 8760) {
  return new Float32Array(n).fill(kw);
}

// Einfaches normiertes PV-Tages-Profil (nur tagsüber, Summe = 1)
// Bildet 6 Sonnenstunden pro Tag ab (10–15 Uhr, gleichmäßig verteilt)
function makeFlatPvProfile() {
  const p = new Float32Array(8760);
  const sunHours = 6;
  const daysInYear = 365;
  const totalSlots = daysInYear * sunHours;
  const val = 1.0 / totalSlots;
  for (let d = 0; d < daysInYear; d++) {
    for (let h = 10; h < 10 + sunHours; h++) {
      p[d * 24 + h] = val;
    }
  }
  return p;
}

let pvProfileSued, pvProfileOstWest;

beforeAll(() => {
  // Stubs für Globals die von 09a benötigt werden
  globalThis.freiflaechen = [];
  globalThis.gebaeude = [];
  globalThis.ASSETS = { items: [], edges: [] };
  globalThis.calcFFKwp = () => 0;
  globalThis.calcGebKwp = () => 0;
  globalThis.PV_INFRA_STUFEN = INFRA_FIXTURE;

  loadScript('06a-gbi-lastgang.js');
  loadScript('09a-pv-profile.js');
  loadScript('14a-kandidaten.js');

  pvProfileSued    = makePvProfile8760('sued');
  pvProfileOstWest = makePvProfile8760('ostwest');
});

// ── pvMeritAnnF ───────────────────────────────────────────────────────────────
describe('pvMeritAnnF — Annuitätenfaktor', () => {
  it('positiver Zins: 0 < ann < 1 für n > 1', () => {
    const a = pvMeritAnnF(0.035, 20);
    expect(a).toBeGreaterThan(0.035);
    expect(a).toBeLessThan(1);
  });
  it('Zins 0 → lineare Abschreibung 1/n', () => {
    expect(pvMeritAnnF(0, 20)).toBeCloseTo(1 / 20, 6);
  });
});

// ── pvMeritDispatch — Energiebilanzen ────────────────────────────────────────
describe('pvMeritDispatch — Energiebilanzen', () => {
  it('Ohne PV: Bezug = Gesamtbedarf', () => {
    const demand = makeFlatDemand(100);
    const d = pvMeritDispatch(null, 0, demand, 0);
    const expectedMwh = 100 * 8760 / 1000;
    expect(d.netzbezugMwh).toBeCloseTo(expectedMwh, 1);
    expect(d.eigenMwh).toBeCloseTo(0, 3);
    expect(d.einspeiseMwh).toBeCloseTo(0, 3);
  });

  it('Nachfragebilanz: eigenMwh + netzbezugMwh ≈ Gesamtbedarf', () => {
    const demand  = makeFlatDemand(100);
    const pvProf  = makeFlatPvProfile();
    const pvKwp   = 200;
    const pvSpez  = 1000;
    const genH    = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) genH[t] = pvProf[t] * pvKwp * pvSpez;

    const d = pvMeritDispatch(genH, 0, demand, 0);
    const demMwh = 100 * 8760 / 1000;
    expect(d.eigenMwh + d.netzbezugMwh).toBeCloseTo(demMwh, 2);
  });

  it('Mehr PV → höheres Eigenverbrauch (bis Sättigung)', () => {
    const demand = makeFlatDemand(200);
    const prof   = makeFlatPvProfile();
    let prevEigen = 0;
    for (const kwp of [50, 150, 300, 600]) {
      const genH = new Float32Array(8760);
      for (let t = 0; t < 8760; t++) genH[t] = prof[t] * kwp * 1000;
      const d = pvMeritDispatch(genH, 0, demand, 0);
      expect(d.eigenMwh).toBeGreaterThanOrEqual(prevEigen - 1e-3);
      prevEigen = d.eigenMwh;
    }
  });

  it('NAP-Einspeiselimit begrenzt maxEinspeiseKw', () => {
    const demand = makeFlatDemand(50);
    const prof   = makeFlatPvProfile();
    const genH   = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) genH[t] = prof[t] * 500 * 1000;
    const d = pvMeritDispatch(genH, 0, demand, 30);
    expect(d.maxEinspeiseKw).toBeLessThanOrEqual(30 + 1e-6);
    expect(d.curtailMwh).toBeGreaterThan(0);
  });
});

// ── pvMeritNettoUeberschuss ───────────────────────────────────────────────────
describe('pvMeritNettoUeberschuss — Wirtschaftlichkeit', () => {
  const params = {
    pStrom: 30, pEinsp: 8,
    pvInvestPerKwp: 1200, batKwh: 0,
    zins: 0.035, pvLife: 20,
  };

  it('100 kWp bei 100 kW Grundlast hat positiven Überschuss (Invest amortisiert)', () => {
    const demand = makeFlatDemand(100);
    const prof   = makeFlatPvProfile();
    const genH   = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) genH[t] = prof[t] * 100 * 1000;
    const d   = pvMeritDispatch(genH, 0, demand, 0);
    const ert = genH.reduce((s, v) => s + v, 0) / 1000;
    const ueb = pvMeritNettoUeberschuss(d, 100, ert, params, INFRA_FIXTURE);
    expect(ueb).toBeGreaterThan(0);
  });

  it('Überschuss wächst bei steigendem Strompreis', () => {
    const demand = makeFlatDemand(100);
    const prof   = makeFlatPvProfile();
    const genH   = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) genH[t] = prof[t] * 100 * 1000;
    const d   = pvMeritDispatch(genH, 0, demand, 0);
    const ert = genH.reduce((s, v) => s + v, 0) / 1000;
    const ueb20 = pvMeritNettoUeberschuss(d, 100, ert, { ...params, pStrom: 20 }, INFRA_FIXTURE);
    const ueb40 = pvMeritNettoUeberschuss(d, 100, ert, { ...params, pStrom: 40 }, INFRA_FIXTURE);
    expect(ueb40).toBeGreaterThan(ueb20);
  });
});

// ── pvMeritOrderCore — Ranking + Tiers ───────────────────────────────────────
describe('pvMeritOrderCore — Ranking und Tier-Zuweisung', () => {
  const demand = makeFlatDemand(200); // 200 kW Grundlast

  const params = {
    pStrom: 30, pEinsp: 8,
    pvInvestPerKwp: 1200,
    batKwh: 0, zins: 0.035, pvLife: 20,
    pvInfraStufen: INFRA_FIXTURE,
    napMaxEinsKw: 0,
  };

  // Drei Kandidaten: A (50 kWp), B (100 kWp), C (5000 kWp — überdimensioniert)
  const kandidaten = [
    { id: 'A', kWp: 50,   ausrichtung: 'sued',   pvSpez: 1000, napId: 'nap1' },
    { id: 'B', kWp: 100,  ausrichtung: 'sued',   pvSpez: 1000, napId: 'nap1' },
    { id: 'C', kWp: 5000, ausrichtung: 'ostwest', pvSpez: 950,  napId: 'nap1' },
  ];

  it('gibt ranking und kurve zurück', () => {
    const { ranking, kurve } = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, params);
    expect(Array.isArray(ranking)).toBe(true);
    expect(ranking.length).toBe(3);
    expect(Array.isArray(kurve)).toBe(true);
  });

  it('Ranking ist nach Δ absteigend sortiert (nur A/B-Einträge)', () => {
    const { ranking } = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, params);
    const abRanking = ranking.filter(r => r.tier !== 'C');
    for (let i = 1; i < abRanking.length; i++) {
      expect(abRanking[i-1].delta).toBeGreaterThanOrEqual(abRanking[i].delta);
    }
  });

  it('Überdimensionierter Kandidat (5000 kWp) landet in Tier C bei pEinsp=0', () => {
    // Ohne Einspeisevergütung ist massiv überdimensionierte PV (viel Abregelung/Einspeisung
    // ohne Erlös) unrentabel: nettoUeberschuss < 0 → greedy wählt sie nicht → tier C
    const noFeedIn = { ...params, pEinsp: 0 };
    const { ranking } = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, noFeedIn);
    const rC = ranking.find(r => r.kandidat.id === 'C');
    expect(rC).toBeDefined();
    expect(rC.tier).toBe('C');
  });

  it('Jeder Ranking-Eintrag hat ein tier-Feld (A, B oder C)', () => {
    const { ranking } = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, params);
    for (const r of ranking) {
      expect(['A', 'B', 'C']).toContain(r.tier);
    }
  });

  it('Kumulative Kurve steigt monoton in kWpKumuliert', () => {
    const { kurve } = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, params);
    for (let i = 1; i < kurve.length; i++) {
      expect(kurve[i].kWpKumuliert).toBeGreaterThan(kurve[i-1].kWpKumuliert);
    }
  });

  it('Fallende Grenzrenditen: Δ[0] ≥ Δ[1] für gleiche NAP-Gruppe', () => {
    // Beide sinnvollen Kandidaten haben abnehmende Grenzrenditen
    const { ranking } = pvMeritOrderCore(kandidaten, demand, pvProfileSued, pvProfileOstWest, params);
    const ab = ranking.filter(r => r.tier !== 'C');
    if (ab.length >= 2) {
      expect(ab[0].delta).toBeGreaterThanOrEqual(ab[1].delta);
    }
  });

  it('Leere Kandidatenmenge → leeres Ergebnis', () => {
    const { ranking, kurve } = pvMeritOrderCore([], demand, pvProfileSued, pvProfileOstWest, params);
    expect(ranking).toHaveLength(0);
    expect(kurve).toHaveLength(0);
  });

  it('Per-NAP-Zerlegung: verschiedene NAPs werden separat verarbeitet', () => {
    const zweiNaps = [
      { id: 'X', kWp: 100, ausrichtung: 'sued', pvSpez: 1000, napId: 'nap1' },
      { id: 'Y', kWp: 100, ausrichtung: 'sued', pvSpez: 1000, napId: 'nap2' },
    ];
    const { ranking } = pvMeritOrderCore(zweiNaps, demand, pvProfileSued, pvProfileOstWest, params);
    const napIds = new Set(ranking.map(r => r.napId));
    expect(napIds.has('nap1')).toBe(true);
    expect(napIds.has('nap2')).toBe(true);
  });
});
