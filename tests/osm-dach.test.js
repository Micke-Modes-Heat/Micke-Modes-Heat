// Vitest-Tests für lib/osm-dach.js (OSM-Dachtags beim Gebäudeimport).
import { describe, it, expect } from 'vitest';
import {
  osmDachAusTags, osmRichtung, osmNeigung, osmQuerAzimut, osmDachGebaeude, osmDachZuordnen,
} from '../src/lib/osm-dach.js';

describe('osmDachAusTags', () => {
  it('übersetzt die gängigen roof:shape-Werte', () => {
    expect(osmDachAusTags({ 'roof:shape': 'flat' }).dachform).toBe('flach');
    expect(osmDachAusTags({ 'roof:shape': 'gabled' }).dachform).toBe('sattel');
    expect(osmDachAusTags({ 'roof:shape': 'hipped' }).dachform).toBe('walm');
    expect(osmDachAusTags({ 'roof:shape': 'half-hipped' }).dachform).toBe('walm');
    expect(osmDachAusTags({ 'roof:shape': 'pyramidal' }).dachform).toBe('walm');
    expect(osmDachAusTags({ 'roof:shape': 'skillion' }).dachform).toBe('pult');
    expect(osmDachAusTags({ 'roof:shape': ' Gabled ' }).dachform).toBe('sattel');
  });
  it('lässt unbekannte Formen und fehlende Tags offen', () => {
    expect(osmDachAusTags({ 'roof:shape': 'dome' })).toEqual({ dachform: null, neigung: null, azimut: null, quer: false });
    expect(osmDachAusTags({ building: 'yes' }).dachform).toBeNull();
    expect(osmDachAusTags(null).dachform).toBeNull();
  });
  it('übernimmt Neigung, Richtung und Querfirst', () => {
    expect(osmDachAusTags({ 'roof:shape': 'gabled', 'roof:angle': '42', 'roof:direction': 'SW', 'roof:orientation': 'across' }))
      .toEqual({ dachform: 'sattel', neigung: 42, azimut: 225, quer: true });
  });
  it('Flachdach hat weder Neigung noch Richtung', () => {
    expect(osmDachAusTags({ 'roof:shape': 'flat', 'roof:angle': '3', 'roof:direction': '180' }))
      .toEqual({ dachform: 'flach', neigung: null, azimut: null, quer: false });
  });
});

describe('Einzelwerte', () => {
  it('roof:direction als Zahl oder Himmelsrichtung', () => {
    expect(osmRichtung('180')).toBe(180);
    expect(osmRichtung('-90')).toBe(270);
    expect(osmRichtung('405')).toBe(45);
    expect(osmRichtung('sse')).toBe(158);
    expect(osmRichtung('O')).toBe(90);
    expect(osmRichtung('nord')).toBeNull();
    expect(osmRichtung('')).toBeNull();
  });
  it('roof:angle nur im plausiblen Bereich', () => {
    expect(osmNeigung('30')).toBe(30);
    expect(osmNeigung('22,5')).toBe(22.5);
    expect(osmNeigung('0')).toBeNull();
    expect(osmNeigung('90')).toBeNull();
    expect(osmNeigung('steil')).toBeNull();
  });
  it('Querfirst: ±90° zur Längsermittlung, Seite näher an Süd', () => {
    expect(osmQuerAzimut(180)).toBe(270);    // 90 und 270 gleich weit → +90 wie detectRoofAzimutFromPolygon
    expect(osmQuerAzimut(135)).toBe(225);
    expect(osmQuerAzimut(225)).toBe(135);
    expect(osmQuerAzimut(null)).toBeNull();
  });
});

describe('osmDachGebaeude / osmDachZuordnen', () => {
  // Rechteck um (lat, lng) mit halber Kantenlänge d (Grad)
  const quadrat = (lat, lng, d) => [
    { lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d },
    { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d }];
  const way = (id, poly, tags) => ({ type: 'way', id, tags,
    geometry: [...poly, poly[0]].map(p => ({ lat: p.lat, lon: p.lng })) });

  it('liest nur Wege mit verwertbarer Dachform', () => {
    const data = { elements: [
      way(1, quadrat(50, 8, 0.0001), { building: 'yes', 'roof:shape': 'hipped' }),
      way(2, quadrat(50, 8.01, 0.0001), { building: 'yes' }),
      way(3, quadrat(50, 8.02, 0.0001), { building: 'yes', 'roof:shape': 'dome' }),
      { type: 'node', id: 9, lat: 50, lon: 8 },
    ] };
    const r = osmDachGebaeude(data);
    expect(r).toHaveLength(1);
    expect(r[0].dach.dachform).toBe('walm');
  });

  it('ordnet beidseitig über Schwerpunkte zu', () => {
    const osm = osmDachGebaeude({ elements: [
      way(1, quadrat(50, 8, 0.0002), { building: 'yes', 'roof:shape': 'gabled', 'roof:angle': '40' }),
    ] });
    const geb = [
      { id: 'a', polygon: quadrat(50.00001, 8.00001, 0.00019) },   // dasselbe Gebäude, leicht versetzt
      { id: 'b', polygon: quadrat(50.0001, 8.0001, 0.00002) },     // kleiner Anbau IN der OSM-Fläche
      { id: 'c', polygon: quadrat(50.01, 8, 0.0002) },             // woanders
    ];
    const t = osmDachZuordnen(geb, osm);
    expect(t.map(x => x.id)).toEqual(['a']);
    expect(t[0].dach).toMatchObject({ dachform: 'sattel', neigung: 40 });
  });
});
