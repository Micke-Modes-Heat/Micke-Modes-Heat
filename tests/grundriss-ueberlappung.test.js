// Vitest-Tests für lib/grundriss-ueberlappung.js
import { describe, it, expect } from 'vitest';
import { guRing, guUeberlappungM2, guUeberlappungen, guSchluessel } from '../src/lib/grundriss-ueberlappung.js';

const M = 111320, LAT = 49, LNG = 8.4, KX = M * Math.cos(LAT * Math.PI / 180);
const ll = ([x, y]) => [LNG + x / KX, LAT + y / M];                  // Meter → [lng, lat]
const rechteck = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(ll);
const geb = (id, ring, extra = {}) => ({ id, ring, ...extra });

describe('guRing', () => {
  it('liest {lat,lng}, [lat,lng] und Ringlisten, ohne doppelten Schlusspunkt', () => {
    expect(guRing([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }])).toEqual([[2, 1], [4, 3], [6, 5]]);
    expect(guRing([[1, 2], [3, 4], [5, 6], [1, 2]])).toEqual([[2, 1], [4, 3], [6, 5]]);
    expect(guRing([[[1, 2], [3, 4], [5, 6]], [[0, 0], [0, 1], [1, 1]]])).toHaveLength(3);
    expect(guRing(null)).toEqual([]);
  });
});

describe('guUeberlappungM2', () => {
  it('zwei Quadrate 10×10 m, um 5 m versetzt → 50 m²', () => {
    const a = [[0, 0], [10, 0], [10, 10], [0, 10]], b = [[5, 0], [15, 0], [15, 10], [5, 10]];
    expect(guUeberlappungM2(a, b)).toBeCloseTo(50, 0);
  });
  it('getrennt → 0', () => {
    expect(guUeberlappungM2([[0, 0], [1, 0], [1, 1], [0, 1]], [[2, 2], [3, 2], [3, 3], [2, 3]])).toBe(0);
  });
});

describe('guUeberlappungen', () => {
  it('Doppelerfassung, Gebäudeteil und Teilüberlappung werden erkannt und sortiert', () => {
    const r = guUeberlappungen([
      geb('teilA', rechteck(100, 0, 20, 10)), geb('teilB', rechteck(115, 0, 20, 10)),   // 5×10 = 50 m² (25 %)
      geb('haupt', rechteck(0, 0, 40, 20)), geb('anbau', rechteck(5, 5, 10, 10)),        // Anbau ganz drin
      geb('osm', rechteck(0, 50, 30, 15)), geb('alkis', rechteck(0.5, 50.3, 30, 15)),    // fast deckungsgleich
    ]);
    expect(r.map(x => x.art)).toEqual(['doppelt', 'enthalten', 'teil']);
    const teil = r[2];
    expect(teil.m2).toBeCloseTo(50, -1);
    expect(teil.anteilA).toBeCloseTo(0.25, 1);
    const enth = r[1];
    expect(Math.max(enth.anteilA, enth.anteilB)).toBeCloseTo(1, 1);
  });
  it('nur berührend oder Zeichenrauschen → nichts', () => {
    const r = guUeberlappungen([geb(1, rechteck(0, 0, 20, 20)), geb(2, rechteck(20, 0, 20, 20)), geb(3, rechteck(39.99, 0, 20, 20))]);
    expect(r).toEqual([]);
  });
  it('Neubau über Abriss ist kein Konflikt, gleichzeitig bestehend schon', () => {
    const alt = geb('alt', rechteck(0, 0, 20, 20), { baujahr: 1960, abrissjahr: 2028 });
    expect(guUeberlappungen([alt, geb('neu', rechteck(2, 2, 20, 20), { baujahr: 2028 })])).toEqual([]);
    expect(guUeberlappungen([alt, geb('neu', rechteck(2, 2, 20, 20), { baujahr: 2026 })])).toHaveLength(1);
  });
  it('bewusst belassene Paare werden markiert', () => {
    const r = guUeberlappungen([geb('x', rechteck(0, 0, 20, 10)), geb('y', rechteck(10, 0, 20, 10))], { ok: new Set([guSchluessel('y', 'x')]) });
    expect(r[0].ok).toBe(true);
  });
});
