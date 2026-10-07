import { describe, it, expect } from 'vitest';
import { trafoGruppen, trafoAufteilung, gruppenBetriebsart, BETRIEBSART_VORGABE } from '../src/lib/trafo-parallel.js';

describe('trafoGruppen', () => {
  it('fasst Trafos auf derselben NSHV zusammen, getrennte Netze bleiben einzeln', () => {
    const r = new Map([
      ['T1', new Set(['NSHV1', 'G1', 'G2'])],
      ['T2', new Set(['NSHV1', 'G1', 'G2'])],
      ['T3', new Set(['NSHV3', 'G9'])],
    ]);
    expect(trafoGruppen(r)).toEqual([['T1', 'T2'], ['T3']]);
  });

  it('verbindet transitiv über gemeinsame Knoten', () => {
    const r = new Map([
      ['A', new Set([1, 2])], ['B', new Set([3])], ['C', new Set([2, 3])],
    ]);
    expect(trafoGruppen(r)).toEqual([['A', 'B', 'C']]);
  });
});

describe('trafoAufteilung', () => {
  const zwei = [{ id: 'a', kva: 630, ukPct: 4 }, { id: 'b', kva: 630, ukPct: 4 }];

  it('zwei gleiche Trafos: parallel 50/50, N-1 je 100 %', () => {
    const p = trafoAufteilung(zwei, { kwV: 800, kwG: 0 }, 'parallel', 0.9);
    expect(p.get('a').kw).toBeCloseTo(400);
    expect(p.get('a').pct).toBeCloseTo(400 / 567 * 100);
    expect(p.get('a').n1.kw).toBeCloseTo(800);
    const n = trafoAufteilung(zwei, { kwV: 800, kwG: 0 }, 'n1', 0.9);
    expect(n.get('b').kw).toBeCloseTo(800);
    expect(n.get('b').normal.kw).toBeCloseTo(400);
  });

  it('Summe der Normalbetriebs-Anteile ergibt die Gruppenlast', () => {
    const t = [{ id: 1, kva: 400, ukPct: 4 }, { id: 2, kva: 630, ukPct: 6 }, { id: 3, kva: 1000, ukPct: 6 }];
    const r = trafoAufteilung(t, { kwV: 1000, kwG: 300 }, 'parallel');
    const sV = [...r.values()].reduce((s, x) => s + x.normal.kwV, 0);
    const sG = [...r.values()].reduce((s, x) => s + x.normal.kwG, 0);
    expect(sV).toBeCloseTo(1000);
    expect(sG).toBeCloseTo(300);
  });

  it('Aufteilung nach Sr/uk; N-1 lässt den stärksten anderen Trafo ausfallen', () => {
    const t = [{ id: 'k', kva: 400, ukPct: 4 }, { id: 'g', kva: 800, ukPct: 4 }];
    const r = trafoAufteilung(t, { kwV: 600, kwG: 0 }, 'parallel');
    expect(r.get('k').anteil).toBeCloseTo(1 / 3);
    expect(r.get('g').normal.kw).toBeCloseTo(400);
    expect(r.get('k').n1.kw).toBeCloseTo(600);
  });

  it('Einzeltrafo: beide Lastfälle gleich, keine Redundanz', () => {
    const r = trafoAufteilung([{ id: 'x', kva: 630 }], { kwV: 300, kwG: 500 }, 'parallel').get('x');
    expect(r.n1Moeglich).toBe(false);
    expect(r.kw).toBeCloseTo(500);
    expect(r.n1.kw).toBeCloseTo(500);
  });

  it('fehlende Angaben: 630 kVA, uk 4 %, Vorgabe-Betriebsart', () => {
    const r = trafoAufteilung([{ id: 1 }, { id: 2, kva: '630', ukPct: '' }], { kwV: 100, kwG: 0 });
    expect(r.get(1).betriebsart).toBe(BETRIEBSART_VORGABE);
    expect(r.get(1).anteil).toBeCloseTo(0.5);
  });
});

describe('gruppenBetriebsart', () => {
  it('erster gesetzter Wert gilt, sonst die Vorgabe', () => {
    expect(gruppenBetriebsart([undefined, 'parallel', 'n1'])).toBe('parallel');
    expect(gruppenBetriebsart(['', null])).toBe(BETRIEBSART_VORGABE);
  });
});
