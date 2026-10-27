// Vitest-Tests für lib/pv-ertrag.js (Ertragsfaktor nach Ausrichtung und Neigung).
import { describe, it, expect } from 'vitest';
import {
  pvErtragsfaktor, pvUnterSchwelle, pvNordSektorBei, abweichungVonSued, pvGcrSued, pvFlachErtragsfaktor,
  PV_ERTRAG_TABELLE, PV_ERTRAG_NEIGUNG, PV_ERTRAG_ABWEICHUNG,
} from '../src/lib/pv-ertrag.js';

describe('Tabelle', () => {
  it('ist vollständig und waagrecht richtungsunabhängig', () => {
    expect(PV_ERTRAG_TABELLE).toHaveLength(PV_ERTRAG_NEIGUNG.length);
    for (const z of PV_ERTRAG_TABELLE) expect(z).toHaveLength(PV_ERTRAG_ABWEICHUNG.length);
    expect(new Set(PV_ERTRAG_TABELLE[0]).size).toBe(1);
  });
  it('fällt je Neigung > 0 mit der Abweichung von Süd monoton', () => {
    for (const z of PV_ERTRAG_TABELLE.slice(1))
      for (let i = 1; i < z.length; i++) expect(z[i]).toBeLessThan(z[i - 1]);
  });
});

describe('pvErtragsfaktor', () => {
  it('Optimum Süd 30° = 1', () => {
    expect(pvErtragsfaktor(180, 30)).toBeCloseTo(1, 6);
  });
  it('Ost und West gleich, Azimut über 360° normiert', () => {
    expect(pvErtragsfaktor(90, 40)).toBeCloseTo(pvErtragsfaktor(270, 40), 9);
    expect(pvErtragsfaktor(-90, 40)).toBeCloseTo(pvErtragsfaktor(270, 40), 9);
    expect(abweichungVonSued(540)).toBe(0);
  });
  it('flache Norddächer besser als steile (Kopplung Ausrichtung × Neigung)', () => {
    expect(pvErtragsfaktor(0, 15)).toBeCloseTo(0.77, 2);
    expect(pvErtragsfaktor(0, 45)).toBeCloseTo(0.52, 2);
    expect(pvErtragsfaktor(0, 15)).toBeGreaterThan(pvErtragsfaktor(0, 45));
  });
  it('interpoliert bilinear zwischen den Stützstellen', () => {
    // NO/NW bei 35°: zwischen 30° (0,705) und 45° (0,605)
    expect(pvErtragsfaktor(45, 35)).toBeCloseTo(0.705 - (5 / 15) * 0.1, 6);
  });
  it('klemmt Neigung auf 0…90°', () => {
    expect(pvErtragsfaktor(180, -5)).toBeCloseTo(0.87, 6);
    expect(pvErtragsfaktor(180, 120)).toBeCloseTo(0.67, 6);
  });
});

describe('Ertragsschwelle', () => {
  it('Nord 15° bleibt bei 75 % belegbar, Nordost 35° nicht', () => {
    expect(pvUnterSchwelle(0, 15, 75)).toBe(false);
    expect(pvUnterSchwelle(45, 35, 75)).toBe(true);
  });
  it('Sektor um Nord wächst mit der Neigung', () => {
    expect(pvNordSektorBei(15, 75)).toBeNull();
    const s30 = pvNordSektorBei(30, 75), s35 = pvNordSektorBei(35, 75), s45 = pvNordSektorBei(45, 75);
    expect(s30).toBeGreaterThan(55);
    expect(s35).toBeGreaterThan(s30);
    expect(s45).toBeGreaterThan(s35);
    expect(s45).toBeLessThan(90);
    // an der Grenze liegt der Faktor genau auf der Schwelle
    expect(pvErtragsfaktor(s35, 35)).toBeCloseTo(0.75, 3);
  });
  it('ganz unter der Schwelle → 180', () => {
    expect(pvNordSektorBei(90, 75)).toBe(180);
  });
});

describe('Flachdach-Aufständerung', () => {
  it('GCR Süd: 30° → 40 % (bisheriger Standard), 15° → 55 %, flacher dichter', () => {
    expect(pvGcrSued(30)).toBe(40);
    expect(pvGcrSued(15)).toBe(55);
    expect(pvGcrSued(10)).toBeGreaterThan(pvGcrSued(15));
  });
  it('Ertragsfaktor: Süd 30° = 1, Süd 15° ≈ 0,96, Ost-West 10° ≈ 0,88', () => {
    expect(pvFlachErtragsfaktor('sued', 30)).toBeCloseTo(1, 6);
    expect(pvFlachErtragsfaktor('sued', 15)).toBeCloseTo(0.96, 6);
    expect(pvFlachErtragsfaktor('ostwest')).toBeCloseTo(0.877, 3);
  });
});
