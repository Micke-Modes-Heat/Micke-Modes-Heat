// Vitest-Tests für lib/elektro-kosten.js — Investitionen und Jahreskosten der Elektro-Maßnahmen (Gutachten 3.5).
import { describe, it, expect } from 'vitest';
import {
  EK_VORGABEN, ekNormKennwerte, ekAnnuitaetsfaktor, ekJahreskosten, ekAuswertung,
} from '../src/lib/elektro-kosten.js';

describe('ekAnnuitaetsfaktor / ekJahreskosten', () => {
  it('rechnet die Annuität nach VDI 2067', () => {
    expect(ekAnnuitaetsfaktor(3.5, 20)).toBeCloseTo(0.070361, 5);
    expect(ekAnnuitaetsfaktor(0, 20)).toBeCloseTo(0.05, 9);
  });

  it('addiert die Instandhaltung', () => {
    expect(ekJahreskosten(100000, 0, 10, 2)).toBeCloseTo(12000, 6);
  });
});

describe('ekNormKennwerte', () => {
  it('liefert ohne Eingabe die Vorschlagswerte', () => {
    const k = ekNormKennwerte(null);
    expect(k.zinsPct).toBe(EK_VORGABEN.zinsPct);
    expect(k.nutzungsdauer).toEqual({ ...EK_VORGABEN.nutzungsdauer });
  });

  it('übernimmt gültige Werte (auch mit Komma) und verwirft unplausible', () => {
    const k = ekNormKennwerte({ zinsPct: '2,5', bkzEurKw: -3, ladepunktEur: '', nutzungsdauer: { kabel: 50, trafo: 0 } });
    expect(k.zinsPct).toBe(2.5);
    expect(k.bkzEurKw).toBe(EK_VORGABEN.bkzEurKw);
    expect(k.ladepunktEur).toBe(EK_VORGABEN.ladepunktEur);
    expect(k.nutzungsdauer.kabel).toBe(50);
    expect(k.nutzungsdauer.trafo).toBe(EK_VORGABEN.nutzungsdauer.trafo);
  });
});

describe('ekAuswertung', () => {
  const kennwerte = { zinsPct: 0, instandhaltungPct: { kabel: 0, trafo: 0, lade: 0 }, nutzungsdauer: { kabel: 40, trafo: 20, lade: 10 } };
  const positionen = [
    { gruppe: 'netz', art: 'trafo', label: 'Trafo', investEur: 40000, jahr: 2028 },
    { gruppe: 'netz', art: 'kabel', label: 'Kabel', investEur: 20000, jahr: 2028 },
    { gruppe: 'lade', art: 'lade', label: 'Ladepark', investEur: 30000, jahr: 2030 },
    { gruppe: 'pv', art: 'pv', label: 'PV', investEur: 100000, jahreskostenEur: 9000, nutzungsdauer: 20 },
    { gruppe: 'notstrom', art: 'notstrom', label: 'leer', investEur: 0, jahr: 2029 },
  ];

  it('summiert je Gruppe und nimmt vorgegebene Jahreskosten unverändert', () => {
    const a = ekAuswertung(positionen, kennwerte);
    const netz = a.gruppen.find(g => g.key === 'netz');
    expect(netz.investEur).toBe(60000);
    expect(netz.jahreskostenEur).toBeCloseTo(40000 / 20 + 20000 / 40, 6);
    expect(netz.nutzungsdauern).toEqual([20, 40]);
    expect(a.gruppen.find(g => g.key === 'pv').jahreskostenEur).toBe(9000);
    expect(a.positionen).toHaveLength(4);
    expect(a.summeInvestEur).toBe(190000);
  });

  it('verteilt die Investitionen auf die Jahre und weist Positionen ohne Jahr gesondert aus', () => {
    const a = ekAuswertung(positionen, kennwerte);
    expect(a.jahresreihe.map(z => z.jahr)).toEqual([2028, 2030]);
    expect(a.jahresreihe[0].netz).toBe(60000);
    expect(a.jahresreihe[1].lade).toBe(30000);
    expect(a.ohneJahrEur).toBe(100000);
  });
});
