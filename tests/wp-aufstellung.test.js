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

import { wpAufstellungForm } from '../src/lib/wp-aufstellung.js';
describe('wpAufstellungForm', () => {
  const abstaendeOk = r => {
    const A = WP_ABSTAENDE;
    for (const g of r.geraete) {
      expect(Math.abs(g.x) + g.l / 2).toBeLessThanOrEqual(r.laenge / 2 - A.wartung + 1e-6);
      expect(Math.abs(g.y) + g.b / 2).toBeLessThanOrEqual(r.breite / 2 - A.luft + 1e-6);
    }
    const reihenY = [...new Set(r.geraete.map(g => +g.y.toFixed(6)))].sort((p, q) => p - q);
    for (let i = 1; i < reihenY.length; i++) expect(reihenY[i] - reihenY[i - 1] - r.modul.b).toBeGreaterThanOrEqual(A.reihe - 1e-6);
  };
  it('ohne Länge = automatische Anordnung', () => {
    expect(wpAufstellungForm(640, { modulKw: 80 })).toMatchObject({ formFrei: false, passt: true, reihen: 2, mehrFlaeche: 0 });
  });
  it('gezogene Länge: Abstände immer eingehalten, Fläche wächst nur wenn nötig', () => {
    const auto = wpAufstellungForm(640, { modulKw: 80 });
    for (const L of [4, 7, 9, 11.2, 14.6, 18, 22, 30, 500]) {
      const r = wpAufstellungForm(640, { modulKw: 80, laenge: L });
      expect(r.passt).toBe(true);
      expect(r.geraete).toHaveLength(8);
      expect(r.flaeche).toBeGreaterThanOrEqual(auto.flaeche - 1e-6);
      expect(r.laenge * r.breite).toBeCloseTo(r.flaeche, 6);
      abstaendeOk(r);
    }
    // gleiche Länge wie automatisch → gleiche Fläche
    expect(wpAufstellungForm(640, { modulKw: 80, laenge: auto.laenge }).mehrFlaeche).toBeCloseTo(0, 6);
    // 11,2 m → 3 Reihen à 3, etwas mehr Fläche als automatisch
    const kurz = wpAufstellungForm(640, { modulKw: 80, laenge: 11.2 });
    expect(kurz).toMatchObject({ jeReihe: 3, reihen: 3 });
    expect(kurz.mehrFlaeche).toBeGreaterThan(0);
  });
  it('kleine Anlage: andere Form bei gleicher Fläche, solange die Abstände reichen', () => {
    const klein = wpAufstellungForm(100, {});
    const r = wpAufstellungForm(100, { laenge: klein.laenge * 0.9 });
    expect(r.flaeche).toBeGreaterThanOrEqual(klein.flaeche - 1e-6);
    abstaendeOk(r);
  });
});

import { wpGeraete3d, wpAufstellung as _auf } from '../src/lib/wp-aufstellung.js';
describe('wpGeraete3d', () => {
  it('Fundament, Gehäuse, Register und Ventilatoren in der richtigen Höhe', () => {
    const auf = _auf(640, { modulKw: 80 });
    const d = wpGeraete3d(auf, 0);
    const teile = new Set(d.map(x => x.teil));
    expect([...teile].sort()).toEqual(['fundament', 'gehaeuse', 'luefter', 'nabe', 'register']);
    const zMax = Math.max(...d.flatMap(x => x.t.map(p => p[2])));
    expect(zMax).toBeCloseTo(0.15 + auf.modul.h + 0.03, 6);
    // 8 Geräte × 3 Ventilatoren × 16 Segmente
    expect(d.filter(x => x.teil === 'luefter')).toHaveLength(8 * 3 * 16);
  });
  it('Drehung um 90°: Längsachse zeigt nach Süden', () => {
    const auf = _auf(16, {});
    const ohne = wpGeraete3d(auf, 0).filter(x => x.teil === 'fundament').flatMap(x => x.t);
    const mit = wpGeraete3d(auf, 90).filter(x => x.teil === 'fundament').flatMap(x => x.t);
    const span = (pts, i) => Math.max(...pts.map(p => p[i])) - Math.min(...pts.map(p => p[i]));
    expect(span(mit, 1)).toBeCloseTo(span(ohne, 0), 6);
    expect(span(mit, 0)).toBeCloseTo(span(ohne, 1), 6);
  });
});
