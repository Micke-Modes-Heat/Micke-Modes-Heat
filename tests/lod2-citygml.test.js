import { describe, expect, it } from 'vitest';
import { lod2Dachdaten, lod2Dachform, lod2FlaecheKennwerte, lod2Parsen, lod2UeberHoehe, lod2Zone, lod2Zuordnen,
  utmNachWgs84, wgs84NachUtm } from '../src/lib/lod2-citygml.js';

// Satteldachhaus 12 × 8 m, First Ost–West (Dachflächen nach Süd und Nord), Traufe 6 m, First 9 m,
// Gelände 100 m NHN, Ursprung bei E0/N0 (UTM 32)
const E0 = 437000, N0 = 5771000, Z0 = 100;
const P = pts => pts.map(([x, y, z]) => `${(E0 + x).toFixed(3)} ${(N0 + y).toFixed(3)} ${(Z0 + z).toFixed(3)}`).join(' ');
const poly = (id, pts) => `<gml:Polygon gml:id="${id}"><gml:exterior><gml:LinearRing><gml:posList srsDimension="3">${P([...pts, pts[0]])}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
const flaeche = (art, id, pts) => `<bldg:boundedBy><bldg:${art} gml:id="${id}s"><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember>${poly(id, pts)}</gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:${art}></bldg:boundedBy>`;
const haus = (gid, dx = 0) => `<core:cityObjectMember><bldg:Building gml:id="${gid}">
  <bldg:roofType codeSpace="x">3100</bldg:roofType><bldg:measuredHeight uom="m">9</bldg:measuredHeight>
  ${flaeche('GroundSurface', gid + 'g', [[dx, 0, 0], [dx, 8, 0], [dx + 12, 8, 0], [dx + 12, 0, 0]])}
  ${flaeche('RoofSurface', gid + 'rs', [[dx, 0, 6], [dx + 12, 0, 6], [dx + 12, 4, 9], [dx, 4, 9]])}
  ${flaeche('RoofSurface', gid + 'rn', [[dx, 4, 9], [dx + 12, 4, 9], [dx + 12, 8, 6], [dx, 8, 6]])}
  ${flaeche('WallSurface', gid + 'w1', [[dx, 0, 0], [dx + 12, 0, 0], [dx + 12, 0, 6], [dx, 0, 6]])}
  ${flaeche('WallSurface', gid + 'w2', [[dx, 0, 0], [dx, 0, 6], [dx, 4, 9], [dx, 8, 6], [dx, 8, 0]])}
</bldg:Building></core:cityObjectMember>`;
const DATEI = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:gml="http://www.opengis.net/gml">
<gml:boundedBy><gml:Envelope srsName="urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH" srsDimension="3"></gml:Envelope></gml:boundedBy>
${haus('DEBY_A')}${haus('DEBY_B', 40)}
</core:CityModel>`;

describe('UTM', () => {
  it('Referenzpunkt 52° N / 9° E liegt bei E 500000, N 5 761 038', () => {
    const u = wgs84NachUtm(52, 9, 32);
    expect(u.E).toBeCloseTo(500000, 2);
    expect(Math.abs(u.N - 5761038.2)).toBeLessThan(0.5);
  });
  it('Hin- und Rückweg stimmen auf Millimeter', () => {
    const ll = utmNachWgs84(437123.45, 5771234.56, 32);
    const u = wgs84NachUtm(ll.lat, ll.lng, 32);
    expect(u.E).toBeCloseTo(437123.45, 3);
    expect(u.N).toBeCloseTo(5771234.56, 3);
  });
  it('Zone aus dem srsName', () => {
    expect(lod2Zone('srsName="urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH"')).toBe(32);
    expect(lod2Zone('srsName="EPSG:25833"')).toBe(33);
    expect(lod2Zone('srsName="EPSG:4326"')).toBeNull();
  });
});

describe('lod2Parsen', () => {
  it('liest Gebäude mit Dach-, Wand- und Bodenflächen', () => {
    const r = lod2Parsen(DATEI);
    expect(r.zone).toBe(32);
    expect(r.gesamt).toBe(2);
    expect(r.gebaeude).toHaveLength(2);
    const a = r.gebaeude[0];
    expect(a.id).toBe('DEBY_A');
    expect(a.roofType).toBe(3100);
    expect(a.dach).toHaveLength(2);
    expect(a.wand).toHaveLength(2);
    expect(a.boden).toHaveLength(1);
    expect(a.dach[0]).toHaveLength(4);             // Schlusspunkt entfernt
  });
  it('Vorfilter überspringt Gebäude außerhalb', () => {
    const r = lod2Parsen(DATEI, { imBereich: E => E < E0 + 20 });
    expect(r.gebaeude.map(g => g.id)).toEqual(['DEBY_A']);
  });
  it('löst xlink-Verweise auf Polygone auf', () => {
    const txt = `<x srsName="EPSG:25832"/><bldg:Building gml:id="X">
      <bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember>${poly('p1', [[0, 0, 6], [12, 0, 6], [12, 4, 9], [0, 4, 9]])}</gml:surfaceMember></gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
      <bldg:boundedBy><bldg:RoofSurface gml:id="r"><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember xlink:href="#p1"/></gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
    </bldg:Building>`;
    const r = lod2Parsen(txt);
    expect(r.gebaeude[0].dach).toHaveLength(1);
  });
});

describe('Kennwerte', () => {
  it('Süddachfläche: Neigung atan(3/4), Azimut 180, Fläche 12 × 5 m', () => {
    const k = lod2FlaecheKennwerte([[0, 0, 6], [12, 0, 6], [12, 4, 9], [0, 4, 9]]);
    expect(k.neigung).toBeCloseTo(Math.atan(3 / 4) * 180 / Math.PI, 3);
    expect(k.azimut).toBeCloseTo(180, 3);
    expect(k.flaecheM2).toBeCloseTo(60, 3);
    expect(k.grundM2).toBeCloseTo(48, 3);
  });
  it('Umlaufsinn egal, Westfläche → 270', () => {
    const k = lod2FlaecheKennwerte([[0, 0, 5], [0, 10, 5], [3, 10, 8], [3, 0, 8]].reverse());
    expect(k.azimut).toBeCloseTo(270, 3);
  });
  it('Wand oberhalb der Traufe = Giebeldreieck', () => {
    const g = lod2UeberHoehe([[0, 0, 0], [0, 0, 6], [0, 4, 9], [0, 8, 6], [0, 8, 0]], 6.05);
    expect(g.length).toBe(3);
    expect(Math.max(...g.map(p => p[2]))).toBe(9);
  });
  it('Dachform aus den Flächen, wenn roofType fehlt', () => {
    const k = (neigung, azimut, grundM2) => ({ neigung, azimut, grundM2 });
    expect(lod2Dachform(null, [k(2, 180, 100)])).toBe('flach');
    expect(lod2Dachform(null, [k(15, 180, 100)])).toBe('pult');
    expect(lod2Dachform(null, [k(35, 180, 50), k(35, 0, 50)])).toBe('sattel');
    expect(lod2Dachform(null, [k(35, 180, 40), k(35, 0, 40), k(35, 90, 10), k(35, 270, 10)])).toBe('walm');
    expect(lod2Dachform(3200, [])).toBe('walm');
  });
});

describe('lod2Dachdaten + Zuordnung', () => {
  const r = lod2Parsen(DATEI);
  const d = lod2Dachdaten(r.gebaeude[0], 32);
  it('Höhen über Gelände, Traufe/First, Giebelwand', () => {
    expect(d.lod2.traufeM).toBeCloseTo(6, 2);
    expect(d.lod2.firstM).toBeCloseTo(9, 2);
    expect(d.lod2.bodenGeschaetzt).toBe(false);
    expect(d.lod2.waende).toHaveLength(1);            // nur der Giebel ragt über die Traufe
    expect(d.dachFlaechen).toHaveLength(2);
    expect(Math.max(...d.dachFlaechen[0].punkte.map(p => p[2]))).toBeCloseTo(9, 2);
  });
  it('Dachform/Neigung/Azimut fürs Tool', () => {
    expect(d.dachform).toBe('sattel');
    expect(d.dachNeigung).toBe(37);
    expect(d.dachAzimut).toBe(180);
  });
  it('ordnet über den Grundriss zu', () => {
    const ll = (x, y) => utmNachWgs84(E0 + x, N0 + y, 32);
    const projekt = [
      { id: 7, polygon: [ll(0, 0), ll(12, 0), ll(12, 8), ll(0, 8)] },
      { id: 8, polygon: [ll(100, 0), ll(110, 0), ll(110, 8), ll(100, 8)] },
    ];
    const daten = r.gebaeude.map(g => lod2Dachdaten(g, 32));
    const z = lod2Zuordnen(daten, projekt);
    expect([...z.zuordnung.entries()]).toEqual([[7, [0]]]);
    expect(z.ohne).toEqual([1]);
  });
});
