// Vitest-Tests für lib/netz-3d.js (Netze in der 3D-Ansicht).
import { describe, it, expect } from 'vitest';
import { d3dNetzLinien, d3dStationen } from '../src/lib/netz-3d.js';

// Attrappe einer Leaflet-Polylinie
const pl = (pts, options) => ({ options, getLatLngs: () => pts.map(([lat, lng]) => ({ lat, lng })) });
const immer = () => true;

describe('d3dNetzLinien', () => {
  it('übernimmt Linienzug, Farbe und Stärke der Karte', () => {
    const w = { layer: pl([[50, 8], [50, 8.001]], { color: '#1e88e5', weight: 5 }), dn: 80, length: 71.6, load: 120 };
    const s = { layer: pl([[50, 8], [50.001, 8]], { color: 'rgba(253,216,53,0.9)', weight: 3 }),
                cableType: 'NAYY', crossSection: 150, nParallel: 2, lengthM: 111, auslastungPct: 63.4 };
    const fc = d3dNetzLinien([w], [s], immer);
    expect(fc.features).toHaveLength(2);
    const [fw, fs] = fc.features;
    expect(fw.geometry.coordinates).toEqual([[8, 50], [8.001, 50]]);
    expect(fw.properties).toMatchObject({ art: 'waerme', farbe: '#1e88e5', breite: 5, info: 'Wärmeleitung DN 80 · 72 m · 120 kW' });
    expect(fs.properties).toMatchObject({ art: 'strom', farbe: 'rgb(253,216,53)', info: 'Kabel NAYY 2× 150 mm² · 111 m · 63 % Auslastung' });
  });

  it('Farbverlauf: Teilstücke statt der Gesamtlinie', () => {
    const e = { layer: pl([[50, 8], [50, 8.002]], { color: '#e53935', weight: 4 }),
                segLayers: [pl([[50, 8], [50, 8.001]], { color: '#ff0000', weight: 4 }),
                            pl([[50, 8.001], [50, 8.002]], { color: '#0000ff', weight: 4 })] };
    const fc = d3dNetzLinien([e], [], immer);
    expect(fc.features.map(f => f.properties.farbe)).toEqual(['#ff0000', '#0000ff']);
  });

  it('lässt Unsichtbares weg: nicht auf der Karte, transparent, abgeschaltet', () => {
    const versteckt = { layer: pl([[50, 8], [50, 8.001]], { color: '#e53935' }) };
    const transparent = { layer: pl([[50, 8], [50, 8.001]], { color: 'transparent' }) };
    const ok = { layer: pl([[50, 8], [50, 8.001]], { color: '#e53935' }) };
    const sichtbar = l => l !== versteckt.layer;
    expect(d3dNetzLinien([versteckt, transparent, ok], [], sichtbar).features).toHaveLength(1);
    expect(d3dNetzLinien([ok], [ok], immer, { waerme: false }).features.map(f => f.properties.art)).toEqual(['strom']);
    expect(d3dNetzLinien([ok], [ok], immer, { strom: false }).features.map(f => f.properties.art)).toEqual(['waerme']);
  });

  it('übersteht kaputte Kanten', () => {
    const kaputt = { layer: { options: { color: '#fff' }, getLatLngs: () => { throw new Error('x'); } } };
    const einPunkt = { layer: pl([[50, 8]], { color: '#fff' }) };
    const nullLaenge = { layer: pl([[50, 8], [50, 8]], { color: '#fff' }) };   // stationsintern
    expect(d3dNetzLinien([null, kaputt, einPunkt, {}], [null, nullLaenge], immer).features).toHaveLength(0);
  });
});

describe('d3dStationen', () => {
  it('nur freistehende Stationstypen, als geschlossener Quader-Grundriss', () => {
    const fc = d3dStationen([
      { type: 'Trafo', lat: 50, lng: 8, name: 'TS 1' },
      { type: 'Trafo', lat: 50, lng: 8, buildingId: 7 },       // im Gebäude
      { type: 'UV', lat: 50, lng: 8 },                          // kein Stationstyp
      { type: 'NAP', lat: NaN, lng: 8 },
    ]);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.properties).toMatchObject({ typ: 'Trafo', hoehe: 2.6, info: 'Trafostation · TS 1' });
    const ring = f.geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // 3,2 m breit
    const breiteM = (ring[1][0] - ring[0][0]) * 111320 * Math.cos(50 * Math.PI / 180);
    expect(breiteM).toBeCloseTo(3.2, 6);
  });
});
