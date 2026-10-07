// Vitest-Tests für lib/wp-aufstellung.js — Aufstellfläche der LW-WP-Außengeräte.
import { describe, it, expect } from 'vitest';
import { wpAufstellung, rechteckEcken, WP_ABSTAENDE } from '../src/lib/wp-aufstellung.js';

describe('wpAufstellung', () => {
  it('kleine Anlage: ein Gerät mit Luft- und Wartungsabständen', () => {
    const a = wpAufstellung(12);
    expect(a).toMatchObject({ anzahl: 1, reihen: 1, jeReihe: 1 });
    expect(a.modul.kw).toBe(16);
    expect(a.laenge).toBeCloseTo(1.3 + 2 * WP_ABSTAENDE.wartung, 6);
    expect(a.breite).toBeCloseTo(0.6 + 2 * WP_ABSTAENDE.luft, 6);
    expect(a.geraete).toHaveLength(1);
    expect(a.geraete[0].x).toBeCloseTo(0, 9);
    expect(a.geraete[0].y).toBeCloseTo(0, 9);
  });
  it('wählt automatisch die kleinste Gerätegröße mit höchstens vier Geräten', () => {
    expect(wpAufstellung(100).modul.kw).toBe(40);
    expect(wpAufstellung(100).anzahl).toBe(3);
    expect(wpAufstellung(500)).toMatchObject({ anzahl: 4, reihen: 1 });
    expect(wpAufstellung(1500)).toMatchObject({ anzahl: 5, reihen: 2, jeReihe: 3 });
  });
  it('feste Gerätegröße und Reihenzahl', () => {
    const a = wpAufstellung(640, { modulKw: 80, reihen: 2 });
    expect(a).toMatchObject({ anzahl: 8, reihen: 2, jeReihe: 4 });
    expect(a.breite).toBeCloseTo(2 * 1.5 + 2 * 1.2 + 2.0, 6);
    expect(a.flaecheGeraete).toBeCloseTo(8 * 2.8 * 1.2, 6);
    // alle Geräte liegen innerhalb der Fläche
    for (const g of a.geraete) {
      expect(Math.abs(g.x) + g.l / 2).toBeLessThanOrEqual(a.laenge / 2 + 1e-9);
      expect(Math.abs(g.y) + g.b / 2).toBeLessThanOrEqual(a.breite / 2 + 1e-9);
    }
    // mehr Reihen als Geräte gibt es nicht
    expect(wpAufstellung(30, { modulKw: 16, reihen: 5 }).reihen).toBe(2);
  });
});

describe('rechteckEcken', () => {
  it('dreht im Uhrzeigersinn (Nord oben)', () => {
    const e = rechteckEcken(0, 0, 4, 2, 90);
    // nach 90° liegt die Länge in Nord-Süd-Richtung
    const ost = e.map(p => p.ost), nord = e.map(p => p.nord);
    expect(Math.max(...nord) - Math.min(...nord)).toBeCloseTo(4, 6);
    expect(Math.max(...ost) - Math.min(...ost)).toBeCloseTo(2, 6);
    // ein Gerät östlich der Mitte wandert nach Süden
    const g = rechteckEcken(3, 0, 0, 0, 90)[0];
    expect(g.ost).toBeCloseTo(0, 6);
    expect(g.nord).toBeCloseTo(-3, 6);
  });
});
