import { describe, it, expect } from 'vitest';
import { erstelleZielCache, reihenAbdruck, zielgroessenSuche, zuEnde } from '../src/lib/zielgroessen.js';

// Vereinfachter „Dispatch": Lastgang in Stufen, Erzeuger decken in Reihenfolge, der Rest geht an den Auto-Kessel
const LAST = Array.from({ length: 8760 }, (_, t) => 300 + 700 * Math.max(0, Math.cos(2 * Math.PI * t / 8760)));
function dispatch(erzList) {
  let autoGkKwh = 0, autoGkPeakKw = 0;
  for (const q of LAST) {
    let rest = q;
    for (const e of erzList) rest -= Math.min(rest, e.leistKw * (e.key === 'wp' ? 0.8 : 1));
    autoGkKwh += rest;
    autoGkPeakKw = Math.max(autoGkPeakKw, rest);
  }
  return { autoGkKwh, autoGkPeakKw };
}

// Bisheriger Rechenweg aus 06c (vor der Auslagerung) als Referenz
function alteSuche(erzList, keys, gesamtKwh, spitzenlastKw) {
  const out = {};
  keys.forEach(key => {
    const idx = erzList.findIndex(e => e.key === key);
    const current = erzList[idx];
    const cache = new Map();
    const sim = c => {
      const k = c.toFixed(6);
      if (cache.has(k)) return cache.get(k);
      const trial = erzList.filter(e => e.key !== key).map(e => ({ ...e }));
      trial.splice(idx, 0, { ...current, leistKw: c });
      const r = dispatch(trial);
      cache.set(k, r);
      return r;
    };
    const finde = (feld, tol) => {
      let upper = Math.max(1, current.leistKw || 0);
      const hardLimit = Math.max(upper, spitzenlastKw * 20);
      while (sim(upper)[feld] > tol && upper < hardLimit) upper = Math.min(hardLimit, upper * 2);
      if (sim(upper)[feld] > tol) return null;
      let lower = 0;
      for (let i = 0; i < 14; i++) { const m = (lower + upper) / 2; if (sim(m)[feld] <= tol) upper = m; else lower = m; }
      return upper;
    };
    out[key] = { energyTargetKw: finde('autoGkKwh', Math.max(1, gesamtKwh * .0001)), powerTargetKw: finde('autoGkPeakKw', Math.max(.1, spitzenlastKw * .0001)) };
  });
  return out;
}

const ERZ = [{ key: 'wp', leistKw: 200 }, { key: 'kessel', leistKw: 150 }];
const GESAMT = LAST.reduce((s, x) => s + x, 0);
const SPITZE = Math.max(...LAST);

describe('Zielgrößen-Suche', () => {
  it('liefert dieselben Werte wie der bisherige Rechenweg', () => {
    const neu = zuEnde(zielgroessenSuche({ erzList: ERZ, keys: ['wp', 'kessel'], gesamtKwh: GESAMT, spitzenlastKw: SPITZE, dispatch }));
    expect(neu).toEqual(alteSuche(ERZ, ['wp', 'kessel'], GESAMT, SPITZE));
    // Plausibel: WP muss mit 80 % Verfügbarkeit mehr installieren als der Kessel
    expect(neu.wp.powerTargetKw).toBeGreaterThan(neu.kessel.powerTargetKw);
  });

  it('gibt nach jeder Simulation die Kontrolle ab, Wiederholungen aus dem Cache kosten nichts', () => {
    let rufe = 0;
    const gen = zielgroessenSuche({ erzList: ERZ, keys: ['wp'], gesamtKwh: GESAMT, spitzenlastKw: SPITZE, dispatch: l => { rufe++; return dispatch(l); } });
    let schritte = 0;
    while (!gen.next().done) schritte++;
    expect(schritte).toBe(rufe);
    expect(rufe).toBeGreaterThan(14);
  });

  it('meldet null, wenn die Grenze von 20 × Spitzenlast nicht reicht', () => {
    const r = zuEnde(zielgroessenSuche({ erzList: [{ key: 'aus', leistKw: 10 }], keys: ['aus'], gesamtKwh: GESAMT, spitzenlastKw: SPITZE,
      dispatch: () => ({ autoGkKwh: 1e9, autoGkPeakKw: 1e9 }) }));
    expect(r.aus).toEqual({ energyTargetKw: null, powerTargetKw: null });
  });
});

describe('Zielgrößen-Cache und Reihenabdruck', () => {
  it('hält nur die letzten Stände', () => {
    const c = erstelleZielCache(2);
    c.set('a', { x: 1 }); c.set('b', { x: 2 }); c.get('a'); c.set('c', { x: 3 });
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toEqual({ x: 2 });
    expect(c.size).toBe(2);
  });

  it('erkennt Änderungen an einer Stundenreihe, auch verschobene Werte', () => {
    const a = new Float32Array(8760).fill(1); a[100] = 5;
    const b = new Float32Array(8760).fill(1); b[101] = 5;
    expect(reihenAbdruck(a)).toBe(reihenAbdruck(Float32Array.from(a)));
    expect(reihenAbdruck(a)).not.toBe(reihenAbdruck(b));
    expect(reihenAbdruck(null)).toBe('-');
  });
});
