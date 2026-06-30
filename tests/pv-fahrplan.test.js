// Vitest-Tests für 14c-phasen.js — Fahrplan-Logik
// Exit-Kriterium M4: Abhängigkeitskette → korrekte Bau-Reihenfolge;
//                   Zyklen/Verletzungen werden erkannt.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  globalThis.freiflaechen = [];
  globalThis.gebaeude = [];
  globalThis.ASSETS = { items: [], edges: [] };
  globalThis.phasen = [];

  loadScript('config/massnahmen-vorlagen.js');
  loadScript('01-globals-varianten.js');
  loadScript('13a-assets-core.js');
  loadScript('14c-phasen.js');
});

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function makeItem(id, dependsOn = [], extra = {}) {
  return { id, assetId: 'a_' + id, typ: 'Bau', titel: id, kosten: 1000, jahr: null, phaseId: null, dependsOn, deltaRank: 0, ...extra };
}

function makePhasen(anzahl, startJahr = 2026) {
  return Array.from({ length: anzahl }, (_, i) => ({
    id: 'ph_' + i,
    name: 'Phase ' + (i + 1),
    jahrVon: String(startJahr + i),
    jahrBis: String(startJahr + i),
    variantId: null,
    reihenfolge: i,
  }));
}

// ── fahrplanTopoSort ──────────────────────────────────────────────────────────
describe('fahrplanTopoSort — Topologische Sortierung', () => {
  it('leere Liste → leeres Ergebnis', () => {
    expect(fahrplanTopoSort([])).toHaveLength(0);
  });

  it('einfache Kette A→B→C: korrekte Reihenfolge', () => {
    const items = [
      makeItem('C', ['B']),
      makeItem('A', []),
      makeItem('B', ['A']),
    ];
    const sorted = fahrplanTopoSort(items);
    expect(sorted.map(i => i.id)).toEqual(['A', 'B', 'C']);
  });

  it('parallele unabhängige Items: alle erscheinen', () => {
    const items = [makeItem('X'), makeItem('Y'), makeItem('Z')];
    const sorted = fahrplanTopoSort(items);
    expect(sorted.map(i => i.id).sort()).toEqual(['X', 'Y', 'Z']);
  });

  it('Diamant-Abhängigkeit: D kommt nach A, B, C', () => {
    // A → B → D
    //       ↗
    // A → C
    const items = [
      makeItem('D', ['B', 'C']),
      makeItem('B', ['A']),
      makeItem('C', ['A']),
      makeItem('A', []),
    ];
    const sorted = fahrplanTopoSort(items);
    const ids = sorted.map(i => i.id);
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('C'));
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('D'));
    expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('D'));
  });

  it('Zyklus A→B→A wirft Error', () => {
    const items = [
      makeItem('A', ['B']),
      makeItem('B', ['A']),
    ];
    expect(() => fahrplanTopoSort(items)).toThrow();
  });

  it('Dreier-Zyklus wirft Error', () => {
    const items = [makeItem('A', ['C']), makeItem('B', ['A']), makeItem('C', ['B'])];
    expect(() => fahrplanTopoSort(items)).toThrow();
  });

  it('externe dependsOn-IDs (nicht im Set) werden ignoriert', () => {
    const items = [makeItem('A', ['extern_123']), makeItem('B', ['A'])];
    expect(() => fahrplanTopoSort(items)).not.toThrow();
    const sorted = fahrplanTopoSort(items);
    expect(sorted.map(i => i.id)).toEqual(['A', 'B']);
  });
});

// ── fahrplanDetektZyklus ──────────────────────────────────────────────────────
describe('fahrplanDetektZyklus', () => {
  it('zyklenfreier Graph → null', () => {
    const items = [makeItem('A'), makeItem('B', ['A'])];
    expect(fahrplanDetektZyklus(items)).toBeNull();
  });

  it('Graph mit Zyklus → Array mit betroffenen IDs', () => {
    const items = [makeItem('X', ['Y']), makeItem('Y', ['X'])];
    const zyklen = fahrplanDetektZyklus(items);
    expect(zyklen).not.toBeNull();
    expect(Array.isArray(zyklen)).toBe(true);
    expect(zyklen.length).toBeGreaterThan(0);
  });
});

// ── fahrplanValidiereReihenfolge ──────────────────────────────────────────────
describe('fahrplanValidiereReihenfolge', () => {
  it('korrekte Reihenfolge → keine Verletzungen', () => {
    const items = [
      makeItem('Ertüchtigung', [], { jahr: 2026 }),
      makeItem('PV-Bau',       ['Ertüchtigung'], { jahr: 2027 }),
    ];
    expect(fahrplanValidiereReihenfolge(items, [])).toHaveLength(0);
  });

  it('PV-Bau vor Ertüchtigung → Verletzung erkannt', () => {
    const items = [
      makeItem('Ertüchtigung', [], { jahr: 2028 }),
      makeItem('PV-Bau',       ['Ertüchtigung'], { jahr: 2026 }),
    ];
    const v = fahrplanValidiereReihenfolge(items, []);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].item.id).toBe('PV-Bau');
    expect(v[0].prereqId).toBe('Ertüchtigung');
  });

  it('Item ohne Jahr → kein Check (keine Verletzung)', () => {
    const items = [
      makeItem('A', [], { jahr: 2028 }),
      makeItem('B', ['A'], { jahr: null }),
    ];
    expect(fahrplanValidiereReihenfolge(items, [])).toHaveLength(0);
  });

  it('Jahr aus Phase wird korrekt aufgelöst', () => {
    const phasenArr = makePhasen(3, 2026); // ph_0=2026, ph_1=2027, ph_2=2028
    const items = [
      makeItem('Ertüchtigung', [], { phaseId: 'ph_2' }), // 2028
      makeItem('PV-Bau', ['Ertüchtigung'], { phaseId: 'ph_0' }), // 2026 < 2028 → Verletzung
    ];
    const v = fahrplanValidiereReihenfolge(items, phasenArr);
    expect(v.length).toBeGreaterThan(0);
  });
});

// ── fahrplanAutoSchnitt ───────────────────────────────────────────────────────
describe('fahrplanAutoSchnitt', () => {
  it('6 Items, 2 pro Phase → 3 Gruppen', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('d'), makeItem('e'), makeItem('f')];
    const gruppen = fahrplanAutoSchnitt(items, 2);
    expect(gruppen).toHaveLength(3);
    expect(gruppen[0].items).toHaveLength(2);
    expect(gruppen[2].items).toHaveLength(2);
  });

  it('7 Items, 3 pro Phase → 3 Gruppen (letzte mit 1 Item)', () => {
    const items = Array.from({ length: 7 }, (_, i) => makeItem('x' + i));
    const gruppen = fahrplanAutoSchnitt(items, 3);
    expect(gruppen).toHaveLength(3);
    expect(gruppen[2].items).toHaveLength(1);
  });

  it('leere Liste → leeres Ergebnis', () => {
    expect(fahrplanAutoSchnitt([], 5)).toHaveLength(0);
  });

  it('phaseIdx läuft korrekt durch', () => {
    const items = Array.from({ length: 4 }, (_, i) => makeItem('y' + i));
    const gruppen = fahrplanAutoSchnitt(items, 2);
    expect(gruppen[0].phaseIdx).toBe(0);
    expect(gruppen[1].phaseIdx).toBe(1);
  });
});

// ── fahrplanBerechneInvestJePhase ─────────────────────────────────────────────
describe('fahrplanBerechneInvestJePhase', () => {
  it('summiert Kosten je Phase korrekt', () => {
    const items = [
      makeItem('a', [], { phaseId: 'ph_0', kosten: 10000 }),
      makeItem('b', [], { phaseId: 'ph_0', kosten: 5000  }),
      makeItem('c', [], { phaseId: 'ph_1', kosten: 20000 }),
    ];
    const map = fahrplanBerechneInvestJePhase(items, []);
    expect(map.get('ph_0')).toBe(15000);
    expect(map.get('ph_1')).toBe(20000);
  });

  it('Items ohne Phase unter null-Key', () => {
    const items = [makeItem('a', [], { phaseId: null, kosten: 7000 })];
    const map = fahrplanBerechneInvestJePhase(items, []);
    expect(map.get(null)).toBe(7000);
  });
});

// ── fahrplanAutoGenerieren ────────────────────────────────────────────────────
describe('fahrplanAutoGenerieren — Integration', () => {
  it('Ertüchtigung kommt vor PV-Bau (topo-sortiert)', () => {
    const ertMap = new Map([
      ['ert_nap1', { assetId: 'nap1', napId: 'nap1', typ: 'Ertuechtigung', titel: 'Trafo +', kosten: 35000 }],
    ]);
    const ranking = [
      { kandidat: { id: 'pv1', refId: 'a1', name: 'PV 1', kWp: 100, ausrichtung: 'sued', napId: 'nap1' }, delta: 5000, tier: 'A', napId: 'nap1' },
      { kandidat: { id: 'pv2', refId: 'a2', name: 'PV 2', kWp: 50, ausrichtung: 'sued', napId: 'nap1' }, delta: 2000, tier: 'B', napId: 'nap1' },
    ];
    const phasenArr = makePhasen(2, 2026);
    const { items } = fahrplanAutoGenerieren(ranking, ertMap, phasenArr, { msProPhase: 5 });
    const ids = items.map(it => it.id);
    expect(ids.indexOf('ert_nap1')).toBeLessThan(ids.indexOf('bau_pv1'));
    expect(ids.indexOf('ert_nap1')).toBeLessThan(ids.indexOf('bau_pv2'));
  });

  it('Tier-C-Kandidaten werden nicht in den Fahrplan aufgenommen', () => {
    const ranking = [
      { kandidat: { id: 'pv1', refId: 'a1', name: 'PV 1', kWp: 100, ausrichtung: 'sued', napId: 'nap1' }, delta: 5000, tier: 'A', napId: 'nap1' },
      { kandidat: { id: 'pv_c', refId: 'a3', name: 'PV C', kWp: 5000, ausrichtung: 'sued', napId: 'nap1' }, delta: -100, tier: 'C', napId: 'nap1' },
    ];
    const { items } = fahrplanAutoGenerieren(ranking, new Map(), [], {});
    expect(items.find(it => it.id === 'bau_pv_c')).toBeUndefined();
  });

  it('phaseId wird aus phasenArr zugewiesen', () => {
    const ranking = [
      { kandidat: { id: 'pv1', refId: 'a1', name: 'PV 1', kWp: 100, ausrichtung: 'sued', napId: null }, delta: 5000, tier: 'A', napId: null },
    ];
    const phasenArr = makePhasen(1, 2026);
    const { items } = fahrplanAutoGenerieren(ranking, new Map(), phasenArr, { msProPhase: 5 });
    expect(items[0].phaseId).toBe('ph_0');
  });

  it('leeres Ranking → leerer Fahrplan', () => {
    const { items, gruppen } = fahrplanAutoGenerieren([], new Map(), [], {});
    expect(items).toHaveLength(0);
    expect(gruppen).toHaveLength(0);
  });
});

// ── fahrplanSchreibeAufAssets ─────────────────────────────────────────────────
describe('fahrplanSchreibeAufAssets', () => {
  it('schreibt neue Maßnahme auf Asset', () => {
    const assets = [{ id: 'a1', name: 'Asset 1', massnahmen: [] }];
    const items  = [makeItem('bau_a1', [], { assetId: 'a1', phaseId: 'ph_0', kosten: 50000, typ: 'Bau', titel: 'PV-Bau' })];
    const count  = fahrplanSchreibeAufAssets(items, assets);
    expect(count).toBe(1);
    expect(assets[0].massnahmen).toHaveLength(1);
    expect(assets[0].massnahmen[0].id).toBe('bau_a1');
    expect(assets[0].massnahmen[0].phaseId).toBe('ph_0');
  });

  it('aktualisiert vorhandene Maßnahme statt Duplikat', () => {
    const assets = [{ id: 'a1', massnahmen: [{ id: 'bau_a1', phaseId: 'ph_0', status: 'geplant' }] }];
    const items  = [makeItem('bau_a1', [], { assetId: 'a1', phaseId: 'ph_1' })];
    fahrplanSchreibeAufAssets(items, assets);
    expect(assets[0].massnahmen).toHaveLength(1);
    expect(assets[0].massnahmen[0].phaseId).toBe('ph_1');
  });

  it('unbekanntes Asset wird übersprungen', () => {
    const assets = [{ id: 'a1', massnahmen: [] }];
    const items  = [makeItem('bau_x', [], { assetId: 'unbekannt' })];
    const count  = fahrplanSchreibeAufAssets(items, assets);
    expect(count).toBe(0);
  });
});
