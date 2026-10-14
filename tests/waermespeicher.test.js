import { describe, it, expect } from 'vitest';
import { speicherAmortisation, speicherInvestEur, speicherKapKwh, speicherKennwerte, speicherOptimum,
  speicherVerlustProH, speicherVolumenStufen, rundeVolumen } from '../src/lib/waermespeicher.js';

describe('Wärmespeicher-Kennwerte', () => {
  it('Kapazität V × 1,16 × ΔT', () => {
    expect(speicherKapKwh(100, 40)).toBeCloseTo(4640, 6);
  });
  it('spezifische Kosten sinken mit der Größe, Erdbecken günstiger als Tank', () => {
    const jeM3 = (v, t) => speicherInvestEur(v, t) / v;
    expect(jeM3(1, 'puffer')).toBeGreaterThan(jeM3(50, 'puffer'));
    expect(jeM3(50, 'puffer')).toBeGreaterThan(jeM3(5000, 'gross'));
    expect(jeM3(50000, 'saisonal')).toBeLessThan(jeM3(50000, 'gross'));
    expect(jeM3(50, 'puffer')).toBeGreaterThan(400);
    expect(jeM3(50, 'puffer')).toBeLessThan(900);
    expect(speicherInvestEur(0, 'puffer')).toBe(0);
  });
  it('in sich geschlossen (wird in den Worker kopiert)', () => {
    const f = new Function('return ' + speicherInvestEur.toString())();
    expect(f(50, 'puffer')).toBe(speicherInvestEur(50, 'puffer'));
  });
  it('Verluste relativ geringer bei großen Speichern', () => {
    expect(speicherVerlustProH(10, 'kurz')).toBeGreaterThan(speicherVerlustProH(1000, 'kurz'));
  });
  it('Volumenstufen steigen monoton, Langzeit deutlich größer', () => {
    const k = speicherVolumenStufen('kurz', 1000, 3000, 40);
    const l = speicherVolumenStufen('lang', 1000, 3000, 30);
    for (let i = 1; i < k.length; i++) expect(k[i]).toBeGreaterThan(k[i - 1]);
    expect(l[0]).toBeGreaterThan(k[0]);
    expect(l[l.length - 1]).toBeGreaterThan(k[k.length - 1]);
    expect(rundeVolumen(1234)).toBe(1200);
  });
  it('Kennwerte gegenüber ohne Speicher', () => {
    const ohne = { autoGkKwh: 100000, autoGkPeakKw: 300, thKwh: { gaskessel: 50000 } };
    const mit = { autoGkKwh: 80000, autoGkPeakKw: 280, thKwh: { gaskessel: 40000 }, thermEntladenGes: 40000, thermGeladenGes: 45000, thermVerlustGes: 5000, thermSocMax: 900 };
    const k = speicherKennwerte(mit, ohne, 1000, ['gaskessel']);
    expect(k.kesselVermiedenMwh).toBeCloseTo(30, 6);
    expect(k.vollzyklen).toBeCloseTo(40, 6);
    expect(k.verlustPct).toBeCloseTo(11.11, 1);
    expect(k.maxFuellPct).toBeCloseTo(90, 6);
  });
  it('Optimum und Amortisation', () => {
    expect(speicherOptimum([{ vol: 1, jahreskosten: 10 }, { vol: 2, jahreskosten: 8 }, { vol: 3, jahreskosten: 9 }]).vol).toBe(2);
    expect(speicherAmortisation(100000, 10000)).toBe(10);
    expect(speicherAmortisation(100000, 0)).toBeNull();
  });
});
