// Vitest-Tests für lib/stations-steckbrief.js — Stations-Steckbrief nach der Vorlage „Steckbrief Trafostation".
import { describe, it, expect } from 'vitest';
import { ssStationModell, ssNdStatus, ssSchaltfelder, ssNshvBelegt, ssStationsGebaeude, ssSetzeStationsfeld }
  from '../src/lib/stations-steckbrief.js';

const gebaeude = [
  { id: 1, name: 'Übergabe', gebaeudenummer: '1' },
  { id: 2, name: 'Station Nord', gebaeudenummer: '2', baujahr: 1985 },
  { id: 3, name: 'Station Ost', gebaeudenummer: '3' },
  { id: 4, name: 'Station Süd', gebaeudenummer: '4' },
  { id: 10, name: 'Stab', gebaeudenummer: '10' },
];
const A = (id, type, buildingId, props = {}, extra = {}) => ({ id, type, name: id, buildingId, props, ...extra });
const E = (id, u, v, extra = {}) => ({ id, u, v, ...extra });

// Übergabe (1); Ring 1 → 2 → 3 → 1; Station 4 als Stich an 1.
const assets = [
  A('nap', 'NAP', 1, { spannungKV: 20 }), A('sa1', 'Schaltanlage', 1, { felder: 6 }),
  A('sa2', 'Schaltanlage', 2, { felder: 2 }), A('t2', 'Trafo', 2, { leistungKVA: 630 }, { baujahr: 1996 }), A('ns2', 'NSHV', 2, { abgaenge: 8 }),
  A('sa3', 'Schaltanlage', 3), A('t3', 'Trafo', 3, { leistungKVA: 400 }), A('ns3', 'NSHV', 3),
  A('t4', 'Trafo', 4, { leistungKVA: 250 }, { baujahr: 1990 }), A('ns4', 'NSHV', 4),
  A('v10', 'Verbraucher', 10), A('pv10', 'PV', 10),
];
const edges = [
  E('e1', 'nap', 'sa1'),
  E('r1', 'sa1', 'sa2'), E('r2', 'sa2', 'sa3'), E('r3', 'sa3', 'sa1', { trennstelle: true }),
  E('s1', 'sa1', 't4'),
  E('i2', 'sa2', 't2'), E('i3', 'sa3', 't3'),
  E('n2', 't2', 'ns2'), E('n2a', 'ns2', 'v10'), E('n2b', 'ns2', 'pv10'), E('n2c', 'ns2', 10),
  E('n3', 't3', 'ns3'), E('n4', 't4', 'ns4'),
];
const P = { assets, edges, gebaeude, heute: 2026 };

describe('ssNdStatus', () => {
  it('innerhalb / erreicht / überschritten', () => {
    expect(ssNdStatus(2000, 2026, 30).status).toBe('innerhalb');
    expect(ssNdStatus(1996, 2026, 30).status).toBe('erreicht');
    expect(ssNdStatus(1990, 2026, 30)).toEqual({ alter: 36, rest: -6, status: 'ueberschritten' });
  });
  it('ohne Baujahr nicht bewertbar', () => {
    expect(ssNdStatus(null, 2026)).toBeNull();
  });
});

describe('ssStationModell', () => {
  it('Übergabestation: Stationsart, MS-Ebene vom NAP, Zählung aus dem Messort', () => {
    const m = ssStationModell({ ...P, gebaeudeId: 1, messort: 'ms' });
    expect(m.station.stationsart).toEqual({ wert: 'uebergabe', auto: true });
    expect(m.station.msKV).toBe(20);
    expect(m.station.msKVQuelle).toBe('nap');
    expect(m.station.zaehlung).toBe('ms');
    expect(m.station.einspeisung.wert).toBeNull();
    expect(m.station.anbindung.map(x => x.label)).toEqual(expect.arrayContaining(['Netz (VNB)', 'Station Nord (Geb. 2)', 'Station Süd (Geb. 4)']));
  });

  it('Ringstation: Verteilstation, Ring, MS-Ebene aus dem Netz, keine VNB-Zählung', () => {
    const m = ssStationModell({ ...P, gebaeudeId: 2, messort: 'ms' });
    expect(m.station.stationsart.wert).toBe('verteil');
    expect(m.station.einspeisung.wert).toBe('ring');
    expect(m.station.msKV).toBe(20);
    expect(m.station.msKVQuelle).toBe('netz');
    expect(m.station.zaehlung).toBeNull();
    expect(m.station.anbindung.map(x => x.gebId).sort()).toEqual([1, 3]);
  });

  it('Stichstation an der Übergabe', () => {
    expect(ssStationModell({ ...P, gebaeudeId: 4 }).station.einspeisung.wert).toBe('stich');
  });

  it('Eingaben am Gebäude schlagen die Ableitung', () => {
    const geb = structuredClone(gebaeude);
    ssSetzeStationsfeld(geb[1], 'einspeisung', 'sonstige');
    ssSetzeStationsfeld(geb[1], 'begehung', '2030-05-01');
    const m = ssStationModell({ ...P, gebaeude: geb, gebaeudeId: 2 });
    expect(m.station.einspeisung).toMatchObject({ wert: 'sonstige', auto: false });
    expect(m.bezugsjahr).toBe(2030);
    // Trafo t2 (1996) hat zum Begehungsjahr 2030 die 30 Jahre überschritten
    expect(m.trafos[0].nd.status).toBe('ueberschritten');
    ssSetzeStationsfeld(geb[1], 'einspeisung', '');
    ssSetzeStationsfeld(geb[1], 'begehung', '');
    expect(geb[1].stationSteckbrief).toBeUndefined();
  });

  it('Hinweis bei mehr Kabelabgängen als erfassten Feldern', () => {
    const m = ssStationModell({ ...P, gebaeudeId: 2 });
    expect(m.hinweise.some(h => h.includes('sa2') && h.includes('3 belegte Felder'))).toBe(true);
  });
});

describe('ssSchaltfelder', () => {
  it('Übergabe-, Kabel- und Trafofelder, aufgefüllt mit Reserve', () => {
    const r = ssSchaltfelder(assets.find(a => a.id === 'sa1'), { assets, edges, gebaeude });
    expect(r.felder.map(f => f.art)).toEqual(['einspeisung', 'kabel', 'kabel', 'kabel', 'reserve', 'reserve']);
    expect(r.felder.find(f => f.trennstelle)?.auto).toBe('Kabelfeld → Station Ost (Geb. 3)');
    expect(r.felder.map(f => f.auto)).toContain('Kabelfeld → Station Süd (Geb. 4)');
    expect(r.belegt).toBe(4);
  });
  it('Feldnamen aus props überschreiben die Ableitung', () => {
    const sa = { ...assets.find(a => a.id === 'sa2'), props: { felder: 3, feldNamen: ['K1 Übergabe', '', 'T1'] } };
    const r = ssSchaltfelder(sa, { assets, edges, gebaeude });
    expect(r.felder.map(f => f.name)).toEqual(['K1 Übergabe', null, 'T1']);
  });
});

describe('ssNshvBelegt / ssStationsGebaeude', () => {
  it('zählt NS-Kabel ohne Trafo-Zuleitung, auch zu Gebäudeknoten', () => {
    expect(ssNshvBelegt(assets.find(a => a.id === 'ns2'), { assets, edges })).toBe(3);
    const m = ssStationModell({ ...P, gebaeudeId: 2 });
    expect(m.nshvs[0]).toMatchObject({ abgaenge: 8, belegt: 3, frei: 5, freiAuto: true });
  });
  it('Stationsgebäude = Gebäude mit NAP, Schaltanlage oder Trafo', () => {
    expect(ssStationsGebaeude(assets, gebaeude).map(g => g.id)).toEqual([1, 2, 3, 4]);
  });
});
