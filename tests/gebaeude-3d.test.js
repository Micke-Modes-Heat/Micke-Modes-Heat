// Vitest-Tests für lib/gebaeude-3d.js (Datenteil der 3D-Ansicht).
import { describe, it, expect } from 'vitest';
import {
  d3dDeckend, d3dRinge, d3dFeatures, d3dBaujahrFarbe, d3dGrenzen,
  d3dZoomAusLeaflet, d3dZoomNachLeaflet, d3dBearingAusKartendrehung, d3dKachelUrls,
  D3D_NEUTRAL, D3D_GESCHOSSHOEHE,
} from '../src/lib/gebaeude-3d.js';

const QUADRAT = [[50.0, 8.0], [50.0, 8.001], [50.001, 8.001], [50.001, 8.0]];
const stil = (fillColor, fillOpacity) => ({ options: { fillColor, fillOpacity } });

describe('d3dDeckend', () => {
  it('entfernt den Alphakanal aus rgba und #rrggbbaa', () => {
    expect(d3dDeckend('rgba(79,195,247,0.08)')).toBe('rgb(79,195,247)');
    expect(d3dDeckend('rgb(1, 2, 3)')).toBe('rgb(1,2,3)');
    expect(d3dDeckend('#ff149380')).toBe('#ff1493');
  });
  it('lässt Hexfarben und Namen durch, leer → neutral', () => {
    expect(d3dDeckend('#4caf50')).toBe('#4caf50');
    expect(d3dDeckend('red')).toBe('red');
    expect(d3dDeckend('')).toBe(D3D_NEUTRAL);
  });
});

describe('d3dRinge', () => {
  it('dreht [lat,lng] zu [lng,lat] und schließt den Ring', () => {
    const r = d3dRinge(QUADRAT);
    expect(r).toHaveLength(1);
    expect(r[0][0]).toEqual([8.0, 50.0]);
    expect(r[0]).toHaveLength(5);
    expect(r[0][4]).toEqual(r[0][0]);
  });
  it('versteht Ringlisten (Löcher) und LatLng-Objekte', () => {
    const loch = [[50.0002, 8.0002], [50.0002, 8.0004], [50.0004, 8.0004]];
    expect(d3dRinge([QUADRAT, loch])).toHaveLength(2);
    expect(d3dRinge(QUADRAT.map(([lat, lng]) => ({ lat, lng })))[0][1]).toEqual([8.001, 50.0]);
  });
  it('verwirft Unbrauchbares', () => {
    expect(d3dRinge(null)).toBeNull();
    expect(d3dRinge([[50, 8], [50, 9]])).toBeNull();
  });
});

describe('d3dFeatures', () => {
  it('Höhe = Geschosse × Geschosshöhe, Farbe von der Arbeitskarte', () => {
    const fc = d3dFeatures([{ id: 1, name: 'A', stockwerke: 4, polygon: QUADRAT, polygonLayer: stil('#f44336', 0.55) }]);
    const p = fc.features[0].properties;
    expect(fc.features[0].id).toBe(1);
    expect(p.hoehe).toBe(4 * D3D_GESCHOSSHOEHE);
    expect(p.farbe).toBe('#f44336');
    expect(p.art).toBe('aktiv');
  });
  it('fast transparente Polygone (kein Kennwert) werden neutral', () => {
    const fc = d3dFeatures([{ id: 2, polygon: QUADRAT, polygonLayer: stil('rgba(79,195,247,0.08)', 1) },
                            { id: 3, polygon: QUADRAT, polygonLayer: stil('#4caf50', 0.08) },
                            { id: 4, polygon: QUADRAT }]);
    // id 2: Deckkraft 1 → Farbe zählt (auch wenn sie selbst transparent gemeint war)
    expect(fc.features[0].properties.farbe).toBe('rgb(79,195,247)');
    expect(fc.features[1].properties.farbe).toBe(D3D_NEUTRAL);
    expect(fc.features[2].properties.farbe).toBe(D3D_NEUTRAL);
  });
  it('fehlende/unsinnige Geschosszahl → 1, nach oben begrenzt', () => {
    const fc = d3dFeatures([{ id: 1, polygon: QUADRAT }, { id: 2, polygon: QUADRAT, stockwerke: 999 }]);
    expect(fc.features[0].properties.geschosse).toBe(1);
    expect(fc.features[1].properties.geschosse).toBe(60);
  });
  it('Auswahl, Geist (geplant/abgerissen/ausgeschlossen), aktiv', () => {
    const gs = [1, 2, 3, 4, 5].map(id => ({ id, polygon: QUADRAT }));
    const fc = d3dFeatures(gs, {
      ausgewaehltId: 1,
      status: g => ({ 2: 'geplant', 3: 'abgerissen' })[g.id] || 'bestand',
      ausgeschlossen: id => id === 4,
    });
    expect(fc.features.map(f => f.properties.art)).toEqual(['auswahl', 'geist', 'geist', 'geist', 'aktiv']);
    expect(fc.features[3].properties.status).toBe('ausgeschlossen');
  });
  it('überspringt Gebäude ohne Grundriss, übersteht werfende Callbacks', () => {
    const fc = d3dFeatures([{ id: 1 }, null, { id: 2, polygon: QUADRAT }], {
      status: () => { throw new Error('x'); },
    });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.art).toBe('aktiv');
  });
  it('nicht-numerische IDs bekommen keine Feature-ID (MapLibre braucht Zahlen)', () => {
    const fc = d3dFeatures([{ id: 'x7', polygon: QUADRAT }]);
    expect(fc.features[0].id).toBeUndefined();
    expect(fc.features[0].properties.gid).toBe('x7');
  });
});

describe('Hilfsfunktionen', () => {
  it('Baujahrklassen', () => {
    expect(d3dBaujahrFarbe(1900)).toBe('#7b3294');
    expect(d3dBaujahrFarbe('1965')).toBe('#f7d8a8');
    expect(d3dBaujahrFarbe(2020)).toBe('#1b7837');
    expect(d3dBaujahrFarbe('')).toBe(D3D_NEUTRAL);
  });
  it('Grenzen', () => {
    expect(d3dGrenzen(d3dFeatures([{ id: 1, polygon: QUADRAT }]))).toEqual([[8.0, 50.0], [8.001, 50.001]]);
    expect(d3dGrenzen({ features: [] })).toBeNull();
  });
  it('Zoom- und Drehungsumrechnung', () => {
    expect(d3dZoomAusLeaflet(17)).toBe(16);
    expect(d3dZoomNachLeaflet(16)).toBe(17);
    expect(d3dZoomAusLeaflet(0)).toBe(0);
    expect(d3dBearingAusKartendrehung(30)).toBe(-30);
    expect(d3dBearingAusKartendrehung(0)).toBe(0);
    expect(Object.is(d3dBearingAusKartendrehung(0), -0)).toBe(false);
  });
  it('Kachel-URLs mit {s}', () => {
    expect(d3dKachelUrls('https://{s}.t.de/{z}/{x}/{y}.png', 'ab')).toEqual(['https://a.t.de/{z}/{x}/{y}.png', 'https://b.t.de/{z}/{x}/{y}.png']);
    expect(d3dKachelUrls('https://t.de/{z}/{x}/{y}.png')).toEqual(['https://t.de/{z}/{x}/{y}.png']);
  });
});
