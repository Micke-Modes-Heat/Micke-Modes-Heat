import { describe, it, expect } from 'vitest';
import { vdiAnnuitaetsfaktor, vdiDynFaktor, vdiBausteinAnnuitaet } from '../src/lib/vdi2067.js';

describe('VDI 2067 Blatt 1 — Annuitätenmethode', () => {
  it('Annuitätsfaktor und Preisdynamik', () => {
    expect(vdiAnnuitaetsfaktor(0.035, 20)).toBeCloseTo(0.070361, 5);
    expect(vdiAnnuitaetsfaktor(0, 20)).toBeCloseTo(0.05, 9);
    // ohne Preisänderung: a·b = 1
    expect(vdiDynFaktor(0.035, 20, 0)).toBeCloseTo(1, 9);
    // 2 %/a bei 3,5 % Zins über 20 a: a·b ≈ 1,188 (Prüfbericht)
    expect(vdiDynFaktor(0.035, 20, 0.02)).toBeCloseTo(1.188, 2);
    // r = q: b = T/q
    expect(vdiDynFaktor(0.03, 10, 0.03)).toBeCloseTo(vdiAnnuitaetsfaktor(0.03, 10) * 10 / 1.03, 9);
  });

  it('Netz 5 Mio €, n = 50 a, T = 20 a, 3,5 %: Restwert 3/5 abgezinst', () => {
    const r = vdiBausteinAnnuitaet(5e6, { n: 50, inst: 0, wart: 0, bedien: 0 }, { zins: 0.035, T: 20 });
    expect(r.ersatzBarwert).toBe(0);
    expect(r.restwertBarwert).toBeCloseTo(5e6 * 30 / 50 / Math.pow(1.035, 20), 0);
    expect(r.kapital).toBeCloseTo((5e6 - r.restwertBarwert) * 0.0703611, -2);   // ≈ 246 T€/a
    expect(r.kapital / 1000).toBeCloseTo(246, -1);
  });

  it('Ersatzbeschaffung bei n < T, Restwert der Ersatzanlage', () => {
    const r = vdiBausteinAnnuitaet(100000, { n: 15, inst: 1, wart: 2, bedien: 10 }, { zins: 0.03, T: 20, lohn: 50 });
    expect(r.ersatzBarwert).toBeCloseTo(100000 / Math.pow(1.03, 15), 0);
    expect(r.restwertBarwert).toBeCloseTo(100000 * 10 / 15 / Math.pow(1.03, 20), 0);
    expect(r.instandhaltung).toBeCloseTo(1000, 6);
    expect(r.wartung).toBeCloseTo(2000, 6);
    expect(r.bedienung).toBeCloseTo(500, 6);
    // n = T: kein Ersatz, kein Restwert → klassische Annuität
    const g = vdiBausteinAnnuitaet(100000, { n: 20 }, { zins: 0.03, T: 20 });
    expect(g.kapital).toBeCloseTo(100000 * vdiAnnuitaetsfaktor(0.03, 20), 6);
  });
});

import { vdiKwkZuschlagFaktor } from '../src/lib/vdi2067.js';
describe('KWK-Zuschlag nach KWKG', () => {
  it('3.500 Vbh/a und 30.000 Vbh gesamt', () => {
    // 3.000 Vbh/a: alle Stunden gefördert, 10 Jahre lang; über 20 a annuitätisch weniger als 1
    const f = vdiKwkZuschlagFaktor(3000, 0.035, 20);
    expect(f).toBeLessThan(0.75);
    expect(f).toBeGreaterThan(0.5);
    // 6.000 Vbh/a: nur 3.500/6.000 je Jahr, 30.000/3.500 ≈ 8,6 Jahre
    expect(vdiKwkZuschlagFaktor(6000, 0.035, 20)).toBeLessThan(f * 3500 / 6000 + 1e-9);
    // kurzer Zeitraum innerhalb der Förderdauer: nur die Stundenbegrenzung
    expect(vdiKwkZuschlagFaktor(3000, 0.035, 5)).toBeCloseTo(1, 9);
    expect(vdiKwkZuschlagFaktor(0, 0.035, 20)).toBe(0);
  });
});
