// Vitest-Tests für lib/lod2-dienste.js und das Lesen von CRS84-CityGML (NRW-OGC-API)
import { describe, it, expect } from 'vitest';
import {
  lod2Dienst, lod2Teilstuecke, lod2Ausschnitt, lod2NrwUrl, lod2NaechsteSeite,
  lod2NiSucheUrl, lod2NiKacheln, lod2BwUrl, lod2WfsZahlen, LOD2_SEITE,
} from '../src/lib/lod2-dienste.js';
import { lod2Parsen, lod2Dachdaten, lod2Zone, lod2Geografisch, wgs84NachUtm } from '../src/lib/lod2-citygml.js';

describe('lod2Dienst', () => {
  it('kennt NRW, Niedersachsen und BW — sonst null', () => {
    expect(lod2Dienst('nw').id).toBe('nw');
    expect(lod2Dienst('ni').id).toBe('ni');
    expect(lod2Dienst('bw').id).toBe('bw');
    for (const bl of ['by', 'he', 'hh', null, undefined]) expect(lod2Dienst(bl)).toBeNull();
  });
});

describe('Ausschnitt und Teilstücke', () => {
  it('Ausschnitt um die Grundrisse mit Rand', () => {
    const b = lod2Ausschnitt([{ polygon: [{ lat: 52, lng: 8 }, { lat: 52.001, lng: 8.002 }, { lat: 52, lng: 8.002 }] }], 20);
    expect(b[0]).toBeLessThan(52);
    expect(b[3]).toBeGreaterThan(8.002);
    expect(lod2Ausschnitt([])).toBeNull();
  });
  it('teilt große Gebiete, kleine bleiben ein Stück', () => {
    expect(lod2Teilstuecke([52, 8, 52.003, 8.004])).toHaveLength(1);
    const t = lod2Teilstuecke([52, 8, 52.02, 8.02], 700);   // ~2,2 × 1,4 km
    expect(t.length).toBe(4 * 2);
    expect(t[0][0]).toBe(52);
    expect(t[t.length - 1][2]).toBeCloseTo(52.02, 9);
    expect(lod2Teilstuecke([52, 8, 51, 9])).toEqual([]);
  });
});

describe('Adressen', () => {
  const t = [51.96, 7.62, 51.965, 7.63];
  it('NRW: bbox in Länge/Breite, Seitengröße', () => {
    const u = lod2NrwUrl(t);
    expect(u).toContain('ogc-api.nrw.de/3dg/v1/collections/building/items?f=citygml');
    expect(u).toContain('bbox=7.620000,51.960000,7.630000,51.965000');
    expect(u).toContain(`limit=${LOD2_SEITE}`);
  });
  it('NRW: Folgeseite aus dem Link-Header', () => {
    const h = '<https://x/items?f=cityjson>; rel="alternate"; type="application/city+json", '
      + '<https://x/items?f=citygml&offset=50>; rel="next"; title="Nächste Seite", <https://x/self>; rel="self"';
    expect(lod2NaechsteSeite(h)).toBe('https://x/items?f=citygml&offset=50');
    expect(lod2NaechsteSeite('<https://x/self>; rel="self"')).toBeNull();
    expect(lod2NaechsteSeite(null)).toBeNull();
  });
  it('Niedersachsen: STAC-Suche und Kacheln aus der Antwort', () => {
    expect(lod2NiSucheUrl([52.05, 8.0, 52.06, 8.01])).toContain('collections=lod2&limit=200&bbox=8.000000,52.050000,8.010000,52.060000');
    const k = lod2NiKacheln({ features: [
      { id: 'LoD2_32_432_5768_1_ni', assets: { 'lod2-gml': { href: 'https://s3/LoD2_32_432_5768_1_ni.gml' }, 'lod2-shp': { href: 'https://s3/x.zip' } } },
      { id: 'leer', assets: {} },
    ] });
    expect(k).toEqual([{ id: 'LoD2_32_432_5768_1_ni', url: 'https://s3/LoD2_32_432_5768_1_ni.gml' }]);
  });
  it('BW: BBOX in UTM 32, Seiten über STARTINDEX', () => {
    const u = lod2BwUrl([49.008, 8.400, 49.012, 8.406], 2000);
    const m = u.match(/BBOX=(\d+),(\d+),(\d+),(\d+),urn:ogc:def:crs:EPSG::25832/);
    expect(m).not.toBeNull();
    const a = wgs84NachUtm(49.008, 8.400, 32);
    expect(+m[1]).toBeLessThanOrEqual(a.E);
    expect(+m[2]).toBeLessThanOrEqual(a.N);
    expect(u).toContain('STARTINDEX=2000');
    expect(lod2WfsZahlen('<wfs:FeatureCollection numberMatched="1699" numberReturned="100">'))
      .toEqual({ zurueck: 100, gesamt: 1699 });
    expect(lod2WfsZahlen('<x numberMatched="unknown" numberReturned="5">')).toEqual({ zurueck: 5, gesamt: null });
  });
});

describe('CityGML in CRS84 (NRW)', () => {
  // Satteldach 10 × 8 m, First 3 m über Traufe, Traufe 6 m über Boden, bei 51,96° N / 7,62° O
  const LAT = 51.96, LNG = 7.62, M = 111320, KX = M * Math.cos(LAT * Math.PI / 180);
  const p = (x, y, z) => `${(LNG + x / KX).toFixed(9)} ${(LAT + y / M).toFixed(9)} ${z}`;
  const poly = pts => `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList srsDimension="3">${[...pts, pts[0]].join(' ')}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
  const text = `<core:CityModel><core:cityObjectMember><bldg:Building gml:id="DENW_1">
    <bldg:roofType>3100</bldg:roofType>
    <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface srsName="http://www.opengis.net/def/crs/OGC/0/CRS84h">
      <gml:surfaceMember>${poly([p(0, 0, 56), p(10, 0, 56), p(10, 4, 59), p(0, 4, 59)])}</gml:surfaceMember>
      <gml:surfaceMember>${poly([p(0, 4, 59), p(10, 4, 59), p(10, 8, 56), p(0, 8, 56)])}</gml:surfaceMember>
    </gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
    <bldg:boundedBy><bldg:GroundSurface><bldg:lod2MultiSurface><gml:MultiSurface>
      <gml:surfaceMember>${poly([p(0, 0, 50), p(0, 8, 50), p(10, 8, 50), p(10, 0, 50)])}</gml:surfaceMember>
    </gml:MultiSurface></bldg:lod2MultiSurface></bldg:GroundSurface></bldg:boundedBy>
  </bldg:Building></core:cityObjectMember></core:CityModel>`;

  it('erkennt CRS84 und die UTM-Zone aus der Länge', () => {
    expect(lod2Geografisch(text)).toBe(true);
    expect(lod2Zone(text)).toBe(32);
    expect(lod2Geografisch('<x srsName="urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH">')).toBe(false);
  });
  it('rechnet in Meter um: Neigung, Ausrichtung, Fläche, Höhen und Lage stimmen', () => {
    const r = lod2Parsen(text);
    expect(r.gebaeude).toHaveLength(1);
    const d = lod2Dachdaten(r.gebaeude[0], r.zone);
    expect(d.dachform).toBe('sattel');
    expect(d.dachFlaechen).toHaveLength(2);
    const [a, b] = d.dachFlaechen;
    expect(a.neigung).toBeCloseTo(36.9, 0);              // atan(3/4)
    expect([a.azimut, b.azimut].sort((x, y) => x - y)).toEqual([0, 180]);
    expect(a.grundM2).toBeCloseTo(40, 0);
    expect(d.lod2.traufeM).toBeCloseTo(6, 1);
    expect(d.lod2.firstM).toBeCloseTo(9, 1);
    expect(a.punkte[0][0]).toBeCloseTo(LAT, 5);
    expect(a.punkte[0][1]).toBeCloseTo(LNG, 5);
  });
});
