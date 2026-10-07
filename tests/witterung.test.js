// Vitest-Tests für lib/witterung.js — Gradtagzahl G20/15, Bereinigungsfaktor, Korrektur des Lastgangs.
import { describe, it, expect } from 'vitest';
import { gradtagzahl, gradtagzahlenJeJahr, wbFaktor, sommerGrundlast, wbKorrigiere } from '../src/lib/witterung.js';

describe('Gradtagzahl', () => {
  it('nur Heiztage unter 15 °C, Differenz zu 20 °C', () => {
    expect(gradtagzahl([10, 14.9, 15, 20, -5])).toBeCloseTo(10 + 5.1 + 25, 6);
  });
  it('je Jahr, nur vollständige Jahre', () => {
    const daten = [], t = [];
    for (let i = 0; i < 365; i++) { daten.push(`2020-01-${i}`); t.push(10); }
    for (let i = 0; i < 100; i++) { daten.push(`2021-01-${i}`); t.push(10); }
    const g = gradtagzahlenJeJahr(daten, t);
    expect(g[2020]).toBe(3650);
    expect(g[2021]).toBeUndefined();
  });
});

describe('Faktor', () => {
  it('wärmeres Messjahr → Faktor > 1', () => {
    const g = { 2015: 3600, 2016: 3500, 2017: 3400, 2018: 3500, 2019: 3500, 2020: 3200 };
    const f = wbFaktor(g, 2020, 20);
    expect(f.gMittel).toBe(3500);
    expect(f.faktor).toBeCloseTo(3500 / 3200, 9);
    expect(f.vonJahr).toBe(2015);
    expect(wbFaktor({ 2019: 3000, 2020: 3000 }, 2020)).toBeNull();
  });
});

describe('Korrektur', () => {
  it('Grundlast bleibt, Rest wird skaliert', () => {
    const lg = new Float32Array(8760).fill(100);
    for (let h = 0; h < 2000; h++) lg[h] = 500;
    expect(sommerGrundlast(lg)).toBe(100);
    const k = wbKorrigiere(lg, 1.1);
    expect(k[0]).toBeCloseTo(100 + 400 * 1.1, 4);
    expect(k[5000]).toBe(100);
  });
});
