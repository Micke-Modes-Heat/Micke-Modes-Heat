import { describe, it, expect } from 'vitest';
import {
  uwSpannungen, uwTrafoMva, uwKategorie, uwAusOverpass, uwLeistungJeSystem, uwTrafoN1,
  uwKosten, uwEbene, uwBewerten, uwParameterMischen, uwDistanzM, uwSatz,
} from '../src/lib/umspannwerk-core.js';

const P = uwParameterMischen(null);

describe('umspannwerk-core: OSM', () => {
  it('liest Spannungen in V oder kV', () => {
    expect(uwSpannungen('110000;20000')).toEqual([110, 20]);
    expect(uwSpannungen('20;110;20')).toEqual([110, 20]);
    expect(uwSpannungen('')).toEqual([]);
  });

  it('liest Trafoleistungen', () => {
    expect(uwTrafoMva('40 MVA')).toBe(40);
    expect(uwTrafoMva('31500 kVA')).toBe(31.5);
    expect(uwTrafoMva('40000')).toBe(40);
    expect(uwTrafoMva('')).toBeNull();
  });

  it('ordnet Anlagen ein', () => {
    expect(uwKategorie({ voltage: '110000;20000', substation: 'distribution' })).toBe('hsms');
    expect(uwKategorie({ voltage: '380000;110000', substation: 'transmission' })).toBe('hoes');
    expect(uwKategorie({ voltage: '110000', substation: 'transmission', name: 'Umspannwerk Großholz' })).toBe('hsms');
    expect(uwKategorie({ voltage: '110000', substation: 'transition', name: 'Kabelgarten' })).toBe('sonstig');
    expect(uwKategorie({ voltage: '30000', substation: 'distribution', name: 'Umspannwerk Klosterstraße' })).toBe('msuw');
    expect(uwKategorie({ voltage: '20000;10000' })).toBe('ms');
    expect(uwKategorie({ voltage: '20000', name: 'Umspannst. Lehrweg' }, 60)).toBe('ms');
    expect(uwKategorie({ substation: 'traction', voltage: '110000;15000' })).toBe('bahn');
    // ohne Spannung: nur groß oder als UW benannt ist ein Kandidat, sonst Ortsnetzstation
    expect(uwKategorie({})).toBe('ms');
    expect(uwKategorie({}, 80)).toBe('ms');
    expect(uwKategorie({}, 10000)).toBe('unbekannt');
    expect(uwKategorie({ name: 'Umspannwerk Altstadt' }, null)).toBe('unbekannt');
    expect(uwKategorie({ name: 'Umspannstation Hof' }, 40)).toBe('ms');
  });

  it('nimmt Flächen mit „out bb" (ohne center) mit und misst die Fläche', () => {
    const els = [{ type: 'way', id: 5, bounds: { minlat: 48.0, minlon: 9.0, maxlat: 48.001, maxlon: 9.0015 },
      tags: { power: 'substation', voltage: '110000', substation: 'transmission', name: 'Umspannwerk X' } }];
    const [u] = uwAusOverpass(els, { ref: { lat: 48.0, lng: 9.0 } });
    expect(u.lat).toBeCloseTo(48.0005, 6);
    expect(u.flaecheM2).toBeGreaterThan(10000);
    expect(u.kategorie).toBe('hsms');
  });

  it('ordnet Trafos dem nächsten UW zu und sortiert nach Entfernung', () => {
    const ref = { lat: 48.0, lng: 9.0 };
    const els = [
      { type: 'way', id: 2, center: { lat: 48.05, lon: 9.0 }, tags: { power: 'substation', voltage: '110000;20000', name: 'Fern' } },
      { type: 'way', id: 1, center: { lat: 48.02, lon: 9.0 }, tags: { power: 'substation', voltage: '110000;20000', name: 'Nah' } },
      { type: 'node', id: 9, lat: 48.0201, lon: 9.0001, tags: { power: 'transformer', rating: '40 MVA', voltage: '110000;20000' } },
      { type: 'node', id: 10, lat: 48.0202, lon: 9.0, tags: { power: 'transformer', rating: '40 MVA' } },
      { type: 'node', id: 11, lat: 48.0199, lon: 9.0, tags: { power: 'transformer', rating: '630 kVA', voltage: '20000;400' } },
    ];
    const uws = uwAusOverpass(els, { ref });
    expect(uws.map(u => u.name)).toEqual(['Nah', 'Fern']);
    expect(uws[0].trafos).toHaveLength(2);            // Ortsnetztrafo 20/0,4 kV zählt nicht
    expect(uws[0].msKv).toBe(20);
    expect(uws[0].luftlinieM).toBeGreaterThan(2000);
  });
});

describe('umspannwerk-core: Leistung und Kosten', () => {
  it('ein 240er-System bei 20 kV trägt kurz thermisch rund 12 MW', () => {
    const r = uwLeistungJeSystem({ laengeKm: 2, uKv: 20, p: P });
    expect(r.thermMw).toBeGreaterThan(11);
    expect(r.thermMw).toBeLessThan(13.5);
    expect(r.grenzeBezug).toBe('thermisch');
    expect(r.einspMw).toBeCloseTo(r.thermMw, 6);
  });

  it('lange Trassen begrenzt der Spannungsfall', () => {
    const r = uwLeistungJeSystem({ laengeKm: 30, uKv: 20, p: P });
    expect(r.grenzeBezug).toBe('spannung');
    expect(r.bezugMw).toBeLessThan(r.thermMw);
  });

  it('10 kV trägt nur rund die Hälfte von 20 kV', () => {
    const a = uwLeistungJeSystem({ laengeKm: 2, uKv: 10, p: P });
    const b = uwLeistungJeSystem({ laengeKm: 2, uKv: 20, p: P });
    expect(a.thermMw / b.thermMw).toBeCloseTo(0.5, 6);
  });

  it('(n-1) aus OSM oder typisch', () => {
    expect(uwTrafoN1({ trafos: [{ mva: 40 }, { mva: 31.5 }] }, P)).toMatchObject({ mva: 31.5, aus: 'osm' });
    expect(uwTrafoN1({ trafos: [] }, P)).toMatchObject({ mva: 40, aus: 'typisch' });
    // Trafos gemappt, aber ohne rating: Anzahl aus OSM, Leistung typisch
    expect(uwTrafoN1({ trafos: [{ mva: null }, { mva: null }, { mva: null }] }, P)).toMatchObject({ mva: 80, anzahl: 3, aus: 'osm-anzahl' });
    expect(uwTrafoN1({ trafos: [{ mva: 25 }] }, P)).toMatchObject({ mva: 0, summeMva: 25, aus: 'osm' });
  });

  it('Kosten wachsen mit Länge und Systemen; BKZ nur mit Satz', () => {
    const k1 = uwKosten({ laengeKm: 3, systeme: 1, p: P, bezugKw: 5000 });
    const k2 = uwKosten({ laengeKm: 3, systeme: 2, p: P });
    expect(k2.anschlussEur).toBeGreaterThan(k1.anschlussEur);
    expect(k1.bkzEur).toBe(0);
    const mitBkz = uwKosten({ laengeKm: 3, systeme: 1, p: { ...P, bkzEurKw: 100 }, bezugKw: 5000 });
    expect(mitBkz.bkzEur).toBe(500000);
    // 3 km, ein System: Größenordnung 1–2 Mio. €
    expect(k1.anschlussEur).toBeGreaterThan(1e6);
    expect(k1.anschlussEur).toBeLessThan(2e6);
  });

  it('Anschlussebene nach Leistung', () => {
    expect(uwEbene(1, P).id).toBe('strang');
    expect(uwEbene(8, P).id).toBe('uw');
    expect(uwEbene(40, P).id).toBe('hs');
    expect(uwEbene(0, P)).toBeNull();
  });

  it('bewertet ein UW samt Zielleistung', () => {
    const ref = { lat: 48.0, lng: 9.0 };
    const uw = { lat: 48.03, lng: 9.0, msKv: 20, trafos: [], name: 'UW Test' };
    expect(uwDistanzM(ref, uw)).toBeCloseTo(3336, -1);
    const b = uwBewerten(uw, { ref, p: P, ziel: { bezugMw: 3, einspMw: 20 } });
    expect(b.laengeKm).toBeCloseTo(3.336 * 1.3, 1);
    expect(b.stufen[1].bezugMw).toBeCloseTo(2 * b.stufen[0].bezugMw, 6);
    expect(b.ziel.systeme).toBe(2);
    expect(uwSatz(uw, b)).toMatch(/UW Test/);
  });
});
