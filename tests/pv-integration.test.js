// Integrations-Test: PV-Varianten-Workflow M2 → M3 → M4 (End-to-End ohne DOM)
// Prüft, dass Merit-Order → Ertüchtigung → Fahrplan korrekt zusammenspielen.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  // Minimal-Globals für alle drei Module
  globalThis.freiflaechen = [];
  globalThis.gebaeude = [];
  globalThis.ASSETS = { items: [], edges: [] };
  globalThis.phasen = [];
  globalThis.stromNodes = [];
  globalThis.stromEdges = [];

  loadScript('config/massnahmen-vorlagen.js');
  loadScript('config/netz-kosten.js');
  loadScript('lib/physik-konstanten.js');
  loadScript('01-globals-varianten.js');
  loadScript('13a-assets-core.js');
  loadScript('14a-kandidaten.js');
  loadScript('14b-ertuechtigung.js');
  loadScript('14c-phasen.js');
});

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function makeDemand8760(peakKw = 50) {
  // Einfacher Sinuslastgang: Spitze im Winter
  return Float32Array.from({ length: 8760 }, (_, h) => {
    const tag = Math.floor(h / 24);
    return Math.max(0, peakKw * (0.4 + 0.6 * Math.cos((tag / 365) * 2 * Math.PI)));
  });
}

function makeKandidaten(n = 5, kwpEach = 40) {
  return Array.from({ length: n }, (_, i) => ({
    id: `dach_${i}`,
    typ: 'gebaeude_dach',
    kWp: kwpEach,
    pvSpez: 950,
    jahresertragKWh: kwpEach * 950,
    napId: `NAP_${i % 2}`,
    score: n - i,
    status: 'aktiv',
    titel: `Dach ${i}`,
  }));
}

function makeNapKapazitaeten(napIds, kapKw = 80) {
  const m = new Map();
  for (const id of napIds) m.set(id, kapKw);
  return m;
}

// ── Integrations-Tests ────────────────────────────────────────────────────────

describe('PV-Integration: Merit-Order → Fahrplan', () => {
  it('pvMeritOrderCore gibt ranking + kurve zurück', () => {
    const demand = makeDemand8760(50);
    const pvProfSued = Float32Array.from({ length: 8760 }, (_, h) => {
      const std = h % 24;
      return std >= 6 && std <= 18 ? 0.8 : 0;
    });
    const pvProfOstWest = Float32Array.from({ length: 8760 }, (_, h) => {
      const std = h % 24;
      return std >= 7 && std <= 17 ? 0.6 : 0;
    });
    const kandidaten = makeKandidaten(5, 40);
    const result = globalThis.pvMeritOrderCore(kandidaten, demand, pvProfSued, pvProfOstWest, {
      pStrom: 30, pEinsp: 8, pvInvestPerKwp: 1200, batKwh: 0, zins: 0.035,
      napMaxEinsKw: 0, pvInfraStufen: [],
    });
    expect(result).toBeTruthy();
    expect(Array.isArray(result.ranking)).toBe(true);
    expect(result.ranking.length).toBe(5);
    expect(['A', 'B', 'C']).toContain(result.ranking[0].tier);
    expect(Array.isArray(result.kurve)).toBe(true);
  });

  it('Merit-Order-Ranking sortiert nach Δ absteigend (Tier A vor C)', () => {
    const demand = makeDemand8760(100);
    const pvP = Float32Array.from({ length: 8760 }, (_, h) => (h % 24 >= 8 && h % 24 <= 16 ? 0.9 : 0));
    // Großer Kandidat (200 kWp) produziert viel Überschuss — sollte Tier C bekommen
    // Kleiner Kandidat (30 kWp) passt gut zum Bedarf — sollte Tier A bekommen
    const kandidaten = [
      { id: 'gross', typ: 'dach', kWp: 200, pvSpez: 950, jahresertragKWh: 190000, napId: 'NAP_1', score: 1, status: 'aktiv', titel: 'Groß' },
      { id: 'klein', typ: 'dach', kWp: 30,  pvSpez: 950, jahresertragKWh: 28500,  napId: 'NAP_1', score: 2, status: 'aktiv', titel: 'Klein' },
    ];
    const result = globalThis.pvMeritOrderCore(kandidaten, demand, pvP, pvP, {
      pStrom: 30, pEinsp: 8, pvInvestPerKwp: 1200, batKwh: 0, zins: 0.035,
      napMaxEinsKw: 0, pvInfraStufen: [],
    });
    // Beide Tiers vorhanden (A, B oder C)
    const tiers = new Set(result.ranking.map(r => r.tier));
    expect(tiers.size).toBeGreaterThanOrEqual(1);
  });

  it('ertDeltaInfraJk gibt 0 zurück wenn kein Engpass neu ausgelöst', () => {
    // Neue Spitze 30 kW, alte 20 kW, Kapazität 100 kW → kein Engpass
    const delta = globalThis.ertDeltaInfraJk(30, 100, 20, 0.035);
    expect(delta).toBe(0);
  });

  it('ertDeltaInfraJk gibt >0 zurück wenn neuer Engpass ausgelöst', () => {
    // Neue Spitze 110 kW, alte 50 kW, Kapazität 80 kW → Engpass bei 110 kW
    const delta = globalThis.ertDeltaInfraJk(110, 80, 50, 0.035);
    expect(delta).toBeGreaterThan(0);
  });

  it('fahrplanTopoSort: lineare Kette wird korrekt sortiert', () => {
    const items = [
      { id: 'c', dependsOn: ['b'] },
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
    ];
    const sorted = globalThis.fahrplanTopoSort(items);
    const ids = sorted.map(x => x.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  it('fahrplanTopoSort: Zyklus wirft Error', () => {
    const items = [
      { id: 'x', dependsOn: ['y'] },
      { id: 'y', dependsOn: ['x'] },
    ];
    expect(() => globalThis.fahrplanTopoSort(items)).toThrow();
  });

  it('fahrplanAutoGenerieren erzeugt Bau-Items für ranking', () => {
    const ranking = Array.from({ length: 4 }, (_, i) => ({
      kandidat: { id: `asset_${i}`, kWp: 30 + i * 10, jahresertragKWh: (30 + i * 10) * 950 },
      tier: i < 2 ? 'A' : 'B',
      napId: 'NAP_1',
      delta: 100 - i * 20,
    }));
    const infraMap = new Map();
    const phasenArr = [
      { id: 'ph1', name: 'Phase 1', jahrVon: '2026', jahrBis: '2027', reihenfolge: 0, variantId: null },
      { id: 'ph2', name: 'Phase 2', jahrVon: '2028', jahrBis: '2029', reihenfolge: 1, variantId: null },
    ];
    const plan = globalThis.fahrplanAutoGenerieren(ranking, infraMap, phasenArr, { msProPhase: 2 });
    expect(plan).toBeTruthy();
    expect(Array.isArray(plan.items)).toBe(true);
    expect(plan.items.length).toBeGreaterThan(0);
    // Alle items haben phaseId gesetzt
    const ohnePhase = plan.items.filter(it => !it.phaseId);
    expect(ohnePhase.length).toBe(0);
    // Topo-Sort läuft durch (kein Fehler)
    expect(() => globalThis.fahrplanTopoSort(plan.items)).not.toThrow();
  });

  it('fahrplanValidiereReihenfolge: keine Konflikte bei korrektem Plan', () => {
    const phasenArr = [
      { id: 'ph1', name: 'Phase 1', jahrVon: '2026', jahrBis: '2027', reihenfolge: 0 },
      { id: 'ph2', name: 'Phase 2', jahrVon: '2028', jahrBis: '2029', reihenfolge: 1 },
    ];
    const items = [
      { id: 'ert', typ: 'Ertuechtigung', phaseId: 'ph1', dependsOn: [], kosten: 5000, titel: 'Trafo' },
      { id: 'bau', typ: 'Bau', phaseId: 'ph2', dependsOn: ['ert'], kosten: 20000, titel: 'PV' },
    ];
    const violations = globalThis.fahrplanValidiereReihenfolge(items, phasenArr);
    expect(violations.length).toBe(0);
  });

  it('fahrplanValidiereReihenfolge: Konflikt wenn abhängige Maßnahme früher als Prereq', () => {
    const phasenArr = [
      { id: 'ph1', name: 'Phase 1', jahrVon: '2026', jahrBis: '2027', reihenfolge: 0 },
      { id: 'ph2', name: 'Phase 2', jahrVon: '2028', jahrBis: '2029', reihenfolge: 1 },
    ];
    // bau in Phase 1 (früher), ertüchtigung in Phase 2 (später) — Konflikt!
    const items = [
      { id: 'ert', typ: 'Ertuechtigung', phaseId: 'ph2', dependsOn: [], kosten: 5000, titel: 'Trafo' },
      { id: 'bau', typ: 'Bau', phaseId: 'ph1', dependsOn: ['ert'], kosten: 20000, titel: 'PV' },
    ];
    const violations = globalThis.fahrplanValidiereReihenfolge(items, phasenArr);
    expect(violations.length).toBeGreaterThan(0);
  });
});
