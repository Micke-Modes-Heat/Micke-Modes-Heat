// Vitest-Tests für lib/wp-schall.js — Schallausbreitung der LW-WP-Außengeräte.
import { describe, it, expect } from 'vitest';
import { schallPegel, pegelSumme, wpSchallQuellen, lwaGesamt, pegelAm, isophone, isophonRadius, naechsterFassadenpunkt, schallschutzDb, quellenMitSchallschutz } from '../src/lib/wp-schall.js';
import { wpAufstellung } from '../src/lib/wp-aufstellung.js';

describe('Ausbreitung', () => {
  it('stimmt mit der Herstellerangabe überein: L_WA 92 dB(A) → L_pA ≈ 64 dB(A) in 10 m', () => {
    expect(schallPegel(92, 10)).toBeCloseTo(64, 1);
    expect(schallPegel(94, 10)).toBeCloseTo(66, 1);
  });
  it('Abstandsverdopplung −6 dB, zwei gleiche Quellen +3 dB', () => {
    expect(schallPegel(90, 20) - schallPegel(90, 40)).toBeCloseTo(6.02 + 0.04, 2);
    expect(pegelSumme([50, 50])).toBeCloseTo(53.01, 2);
  });
});

describe('Quellen aus der Aufstellung', () => {
  it('Großgeräte nach Herstellerangabe, Summe = Gerät + 10·log n', () => {
    const auf = wpAufstellung(1620, { modulKw: 810 });
    const q = wpSchallQuellen(auf);
    expect(q).toHaveLength(2);
    expect(q[0].lwa).toBe(94);
    expect(lwaGesamt(q)).toBeCloseTo(97.01, 2);
  });
  it('Vorgabe der Gesamtschallleistung wird gleichmäßig verteilt; Drehung dreht die Quellen', () => {
    const auf = wpAufstellung(640, { modulKw: 80, reihen: 1 });
    const q = wpSchallQuellen(auf, 0, 90);
    expect(lwaGesamt(q)).toBeCloseTo(90, 6);
    const g = wpSchallQuellen(auf, 90, 90);
    expect(g[0].ost).toBeCloseTo(0, 6);   // Reihe entlang x → nach 90° entlang Nord/Süd
    expect(Math.abs(g[0].nord)).toBeCloseTo(Math.abs(q[0].ost), 6);
  });
});

describe('Isophonen und Immissionsorte', () => {
  it('eine Quelle: Kreis mit dem Abstand, an dem der Pegel erreicht wird', () => {
    const q = [{ ost: 0, nord: 0, lwa: 92 }];
    const r = isophonRadius(q, 40);
    expect(schallPegel(92, r)).toBeCloseTo(40, 1);
    const linie = isophone(q, 40);
    expect(linie).toHaveLength(72);
    for (const p of linie) expect(Math.hypot(p.ost, p.nord)).toBeCloseTo(r, 0);
  });
  it('mehrere Geräte in einer Reihe: Isophone länger entlang der Reihe', () => {
    const q = [-12, -4, 4, 12].map(x => ({ ost: x, nord: 0, lwa: 90 }));
    const linie = isophone(q, 60);
    const ost = Math.max(...linie.map(p => Math.abs(p.ost))), nord = Math.max(...linie.map(p => Math.abs(p.nord)));
    expect(ost).toBeGreaterThan(nord);
    expect(pegelAm(q, 0, 0)).toBeGreaterThan(pegelAm(q, 0, 30));
  });
  it('nächster Fassadenpunkt eines Gebäudes', () => {
    const f = naechsterFassadenpunkt([{ ost: 10, nord: -5 }, { ost: 20, nord: -5 }, { ost: 20, nord: 5 }, { ost: 10, nord: 5 }]);
    expect(f).toMatchObject({ ost: 10, nord: 0, d: 10 });
  });
});

describe('Schallschutz an den Außengeräten', () => {
  it('Richtwerte je Art, eigener Wert auf 0–30 dB begrenzt', () => {
    expect(schallschutzDb(null)).toBe(0);
    expect(schallschutzDb({ art: 'haube' })).toBe(10);
    expect(schallschutzDb({ art: 'einhausung' })).toBe(15);
    expect(schallschutzDb({ art: 'manuell', db: 12 })).toBe(12);
    expect(schallschutzDb({ art: 'manuell', db: 80 })).toBe(30);
  });
  it('mindert jede Quelle: Pegel am Ort und Isophonen-Radius schrumpfen entsprechend', () => {
    const q = wpSchallQuellen(wpAufstellung(1500), 0, null);
    const m = quellenMitSchallschutz(q, 10);
    expect(pegelAm(q, 0, 100) - pegelAm(m, 0, 100)).toBeCloseTo(10, 6);
    expect(isophonRadius(m, 40)).toBeLessThan(isophonRadius(q, 40) / 2);
    expect(quellenMitSchallschutz(q, 0)).toBe(q);
  });
});
