// Vitest-Tests für lib/kostenanalyse.js — Kosten je Erzeuger und Kostentreiber.
import { describe, it, expect } from 'vitest';
import { annuitaet, bausteinJahreskosten, kostenJeErzeuger, kostentreiber } from '../src/lib/kostenanalyse.js';

// Formel der Bausteintabelle (07b-analysis-economics.js, _calcBausteinJK)
const _calcBausteinJK = (investEur, vdi, zins, lohn) => {
  if (vdi.n > 0) {
    const q = 1 + zins / 100;
    const ann = zins > 0 ? (q ** vdi.n * (q - 1)) / (q ** vdi.n - 1) : 1 / vdi.n;
    return investEur * (ann + vdi.inst / 100 + vdi.wart / 100) + vdi.bedien * lohn;
  }
  return vdi.bedien * lohn;
};

const bausteine = [
  { id: 'lwwp', invest: 1_000_000, n: 20, inst: 1, wart: 1.5, bedien: 50 },
  { id: 'gk', invest: 100_000, n: 20, inst: 1, wart: 2, bedien: 100 },
  { id: 'waermenetz', invest: 500_000, n: 50, inst: 1, wart: 0, bedien: 40 },
  { id: 'planung', invest: 160_000, n: 20, inst: 0, wart: 0, bedien: 0 },
];

describe('Jahreskosten wie die Bausteintabelle', () => {
  it('Annuität + Instandhaltung + Wartung + Bedienung = _calcBausteinJK', () => {
    for (const b of bausteine) {
      const jk = bausteinJahreskosten(b, 3.5, 45);
      expect(jk.kapital + jk.betrieb).toBeCloseTo(_calcBausteinJK(b.invest, b, 3.5, 45), 6);
    }
    expect(annuitaet(0, 20)).toBeCloseTo(0.05, 9);
  });
});

describe('kostenJeErzeuger', () => {
  const r = kostenJeErzeuger({
    bausteine, zinsPct: 3.5, lohn: 45,
    energie: { lwwp: 300_000, gaskessel: 50_000 }, co2: { lwwp: 20_000, gaskessel: 25_000 },
    waerme: { lwwp: 9000, gaskessel: 1000 }, leistungKw: { lwwp: 2000, gaskessel: 2000 }, gesamtMwh: 10000,
  });
  it('Summe aller Teile = Jahreskosten gesamt', () => {
    const jkAnlagen = bausteine.reduce((s, b) => s + _calcBausteinJK(b.invest, b, 3.5, 45), 0);
    const summe = r.erzeuger.reduce((s, e) => s + e.summe, 0) + r.gemeinsam.summe;
    expect(summe).toBeCloseTo(jkAnlagen + 300_000 + 50_000 + 20_000 + 25_000, 4);
  });
  it('Spitzenkessel mit wenig Volllaststunden hat die teuerste kWh', () => {
    expect(r.erzeuger[0].key).toBe('gaskessel');
    expect(r.erzeuger[0].vbh).toBeCloseTo(500, 6);
    expect(r.erzeuger.find(e => e.key === 'lwwp').anteil).toBeCloseTo(90, 6);
    expect(r.gemeinsam.ctKwh).toBeGreaterThan(0);
  });
});

describe('kostentreiber', () => {
  it('Wirkung in ct/kWh, sortiert; Zins über die Annuität', () => {
    const t = kostentreiber({ bausteine, zinsPct: 3.5, lohn: 45, energieTraeger: { strom: 300_000, gas: 50_000 }, co2Eur: 45_000, gesamtMwh: 10000 });
    expect(t[0].name).toBe('Strompreis');
    expect(t[0].plus).toBeCloseTo(300_000 * 0.2 / 10000 / 10, 9);
    const zins = t.find(x => x.name === 'Kalkulationszins');
    expect(zins.plus).toBeGreaterThan(0);
    expect(zins.minus).toBeLessThan(0);
    expect(t.find(x => x.name === 'Heizölpreis')).toBeUndefined();
  });
});
