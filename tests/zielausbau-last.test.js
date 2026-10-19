// Vitest-Tests für lib/zielausbau-last.js — Stromlastgang im Zielausbau (PV-Analyse).
import { describe, it, expect } from 'vitest';
import {
  ZL_WP_MONATSANTEIL, zlWpErsatzProfil, zlAufLaenge, zlMwh, zlZusammensetzen,
} from '../src/lib/zielausbau-last.js';

const konst = (n, v) => new Float32Array(n).fill(v);

describe('zlWpErsatzProfil', () => {
  it('verteilt kw × Vollaststunden nach Monatsanteilen und bleibt unter der Nennleistung', () => {
    expect(ZL_WP_MONATSANTEIL.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    const p = zlWpErsatzProfil(100, 2000);
    expect(p.length).toBe(8760);
    expect(zlMwh(p, 1)).toBeCloseTo(200, 3);              // 100 kW × 2.000 h
    expect(Math.max(...p)).toBeLessThan(100);
    expect(p[0]).toBeGreaterThan(p[24 * 200]);             // Januar > Juli
  });

  it('liefert ohne Leistung eine Nullreihe', () => {
    expect(zlMwh(zlWpErsatzProfil(0), 1)).toBe(0);
  });
});

describe('zlAufLaenge', () => {
  const h = Float32Array.from({ length: 8760 }, (_, i) => i);
  it('übernimmt Stundenwerte unverändert', () => {
    const r = zlAufLaenge(h, 8760);
    expect(r[0]).toBe(0);
    expect(r[8759]).toBe(8759);
  });
  it('wiederholt jede Stunde viermal bei 15-min-Lastgängen', () => {
    const r = zlAufLaenge(h, 35040);
    expect([r[0], r[3], r[4], r[35039]]).toEqual([0, 0, 1, 8759]);
  });
  it('füllt den Schaltjahrstag mit dem letzten Tag statt mit 0', () => {
    const r = zlAufLaenge(h, 8784);
    expect(r[8760]).toBe(8736);
    expect(r[8783]).toBe(8759);
    const q = zlAufLaenge(h, 35136);
    expect(q[35040]).toBe(8736);
    expect(q[35135]).toBe(8759);
  });
});

describe('zlZusammensetzen', () => {
  it('addiert die Bausteine und bilanziert sie einzeln', () => {
    const r = zlZusammensetzen(konst(8760, 100), {
      gebaeude: konst(8760, 20), waerme: zlWpErsatzProfil(50), lade: konst(8760, 5),
    }, { dt: 1 });
    expect(r.basisMwh).toBeCloseTo(876, 3);
    expect(r.bilanz.map(b => b.key)).toEqual(['gebaeude', 'waerme', 'lade']);
    expect(r.bilanz.find(b => b.key === 'waerme').mwh).toBeCloseTo(100, 3);
    expect(r.summeMwh).toBeCloseTo(876 + 175.2 + 100 + 43.8, 2);
    expect(r.gekapptMwh).toBe(0);
  });

  it('rechnet 15-min-Lastgänge mit dt 0,25', () => {
    const r = zlZusammensetzen(konst(35040, 100), { lade: konst(8760, 10) }, { dt: 0.25 });
    expect(r.basisMwh).toBeCloseTo(876, 3);
    expect(r.bilanz[0].mwh).toBeCloseTo(87.6, 3);
  });

  it('kappt negative Last aus Rückbau und weist sie aus', () => {
    const r = zlZusammensetzen(konst(8760, 10), { gebaeude: konst(8760, -15) }, { dt: 1 });
    expect(Math.min(...r.arr)).toBe(0);
    expect(r.gekapptMwh).toBeCloseTo(43.8, 3);
    expect(r.bilanz[0].mwh).toBeCloseTo(-131.4, 3);
  });

  it('lässt leere Bausteine weg und verändert die Messung nicht', () => {
    const basis = konst(8760, 7);
    const r = zlZusammensetzen(basis, { gebaeude: null, waerme: new Float32Array(8760) });
    expect(r.bilanz).toEqual([]);
    expect(basis[0]).toBe(7);
    expect(r.arr).not.toBe(basis);
  });
});
