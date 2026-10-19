// Vitest-Tests für lib/pv-netzkostenkurve.js — Netzkosten der PV-Analyse aus der Ausbautreppe.
import { describe, it, expect } from 'vitest';
import { pvnkAusTreppe, pvnkKosten, pvnkErzeugungsnetzEUR } from '../src/lib/pv-netzkostenkurve.js';
import { nsKostenMischen } from '../src/lib/netzstrategie-core.js';

const treppe = {
  basisKwp: 300, potenzialKwp: 1000,
  schritte: [
    { summeKwp: 450, kumInvestEUR: 20000, label: 'Kabel A', eurProKwp: 133 },
    { summeKwp: 800, kumInvestEUR: 80000, label: 'Trafo 630 → 1000 kVA' },
  ],
};

describe('pvnkAusTreppe', () => {
  it('baut die Treppe ab dem Bestandsnetz mit kumulierten Kosten', () => {
    const k = pvnkAusTreppe(treppe);
    expect(k.stufen.map(s => [s.stufe, s.bisKwp, s.investEUR])).toEqual([[0, 300, 0], [1, 450, 20000], [2, 800, 80000]]);
    expect(k.endeKwp).toBe(800);
    expect(k.restKwp).toBe(200);
    expect(k.stufen[2].eurProKwp).toBeCloseTo(60000 / 350, 6);
  });

  it('hängt den Rest als Erzeugungsnetz an, wenn Kosten dafür bekannt sind', () => {
    const k = pvnkAusTreppe(treppe, { rest: { investEUR: 150000, label: 'Erzeugungsnetz' } });
    const r = k.stufen.at(-1);
    expect(r).toMatchObject({ rest: true, bisKwp: 1000, investEUR: 230000, label: 'Erzeugungsnetz' });
  });

  it('kommt ohne Treppe mit dem Bestandsnetz aus', () => {
    const k = pvnkAusTreppe({ basisKwp: 500, potenzialKwp: 500, schritte: [] });
    expect(k.stufen).toHaveLength(1);
    expect(k.restKwp).toBe(0);
  });
});

describe('pvnkKosten', () => {
  const k = pvnkAusTreppe(treppe);
  it('liefert die kleinste Stufe, deren Kapazität reicht', () => {
    expect(pvnkKosten(k, 250).investEUR).toBe(0);
    expect(pvnkKosten(k, 300).investEUR).toBe(0);
    expect(pvnkKosten(k, 400)).toMatchObject({ investEUR: 20000, stufe: 1, anschliessbar: true });
    expect(pvnkKosten(k, 800).investEUR).toBe(80000);
  });
  it('markiert Leistung über der letzten Stufe als nicht anschließbar', () => {
    expect(pvnkKosten(k, 900)).toMatchObject({ investEUR: 80000, anschliessbar: false });
  });
  it('rechnet kWp der Analyse über den Faktor ins Netzmodell um', () => {
    expect(pvnkKosten(k, 400, 0.5).investEUR).toBe(0);      // 400 kWp ≙ 200 kWp im Modell
  });
  it('kostet ohne Kurve nichts', () => {
    expect(pvnkKosten(null, 5000)).toMatchObject({ investEUR: 0, anschliessbar: true });
  });
});

describe('pvnkErzeugungsnetzEUR', () => {
  const kat = nsKostenMischen({});
  it('wählt die passende Station und rechnet MS-Feld und Trasse dazu', () => {
    const r = pvnkErzeugungsnetzEUR(500, kat, 200);
    expect(r.kva).toBe(630);
    expect(r.investEUR).toBe(70000 + 40000 + 200 * (90 + 150));
  });
  it('teilt große Leistungen auf mehrere Stationen auf', () => {
    const r = pvnkErzeugungsnetzEUR(5000, kat, 0);
    expect(r.stationen).toBe(3);
  });
  it('ist ohne Leistung oder Katalog 0', () => {
    expect(pvnkErzeugungsnetzEUR(0, kat).investEUR).toBe(0);
    expect(pvnkErzeugungsnetzEUR(100, null).investEUR).toBe(0);
  });
});
