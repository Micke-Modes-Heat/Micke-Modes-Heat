// Vitest-Tests für lib/quartier-herausloesen.js — Quartier aus einer Liegenschaft als eigenes Projekt.
import { describe, it, expect } from 'vitest';
import { punktInPolygon, gebaeudeImBereich, trassenImBereich, quartierProjekt, bereichUmGebaeude } from '../src/lib/quartier-herausloesen.js';

const P = (lat, lng) => ({ lat, lng });
const quadrat = (lat, lng, d = 0.00005) => [P(lat - d, lng - d), P(lat - d, lng + d), P(lat + d, lng + d), P(lat + d, lng - d)];
const bereich = [P(52.0, 8.0), P(52.0, 8.01), P(52.01, 8.01), P(52.01, 8.0)];

describe('Bereich', () => {
  it('Punkt im Polygon und Gebäude nach ihrer Mitte', () => {
    expect(punktInPolygon(P(52.005, 8.005), bereich)).toBe(true);
    expect(punktInPolygon(P(52.02, 8.005), bereich)).toBe(false);
    const geb = [{ id: 1, polygon: quadrat(52.005, 8.005) }, { id: 2, polygon: quadrat(52.02, 8.005) }, { id: 3, lat: 52.001, lng: 8.009 }];
    expect(gebaeudeImBereich(geb, bereich)).toEqual([1, 3]);
  });
  it('Rechteck um ausgewählte Gebäude mit Puffer', () => {
    const b = bereichUmGebaeude([{ polygon: quadrat(52.005, 8.005) }], 40);
    expect(b).toHaveLength(4);
    expect(punktInPolygon(P(52.005 + 0.0003, 8.005), b)).toBe(true);    // ~33 m nördlich: noch drin
    expect(punktInPolygon(P(52.005 + 0.0006, 8.005), b)).toBe(false);   // ~67 m: draußen
  });
});

describe('trassenImBereich', () => {
  it('schneidet an der Bereichsgrenze ab und nummeriert neu', () => {
    const punkte = [P(52.005, 7.99), P(52.005, 8.002), P(52.005, 8.008), P(52.005, 8.02), P(52.002, 8.002), P(52.008, 8.002)];
    const segmente = [{ start: 0, end: 3, source: 'osm-street' }, { start: 4, end: 5 }];
    const r = trassenImBereich(punkte, segmente, bereich);
    expect(r.segmente).toEqual([{ start: 0, end: 1, source: 'osm-street' }, { start: 2, end: 3 }]);
    expect(r.punkte).toEqual([P(52.005, 8.002), P(52.005, 8.008), P(52.002, 8.002), P(52.008, 8.002)]);
  });
  it('ein Abschnitt, der den Bereich verlässt und wieder betritt, wird zu zwei Stücken', () => {
    const punkte = [P(52.002, 8.002), P(52.004, 8.002), P(52.02, 8.002), P(52.006, 8.004), P(52.008, 8.004)];
    const r = trassenImBereich(punkte, [{ start: 0, end: 4 }], bereich);
    expect(r.segmente).toHaveLength(2);
  });
});

describe('quartierProjekt', () => {
  const projekt = {
    version: 9,
    economicScenario: { scenarioId: 'manual', values: { stromCtKwh: 30 } },
    projektStammdaten: { kaserneName: 'Großkaserne', weNummer: '123' },
    waermeGrundlagen: { stadt: 'Kassel', vlMinus5: '80', gesamtMwh: '20000', monatswerte: ['1', '2'], lastgangKw: [1, 2, 3], bestandsanlage: { x: 1 }, witterung: { y: 1 } },
    netz: { zentrale: '5', vl: '80', isLocked: true, sanierung: true },
    gebaeude: [{ id: 1, waerme: '500', heizlast: '200', polygon: quadrat(52.005, 8.005) }, { id: 2, waerme: '900', heizlast: '300', polygon: quadrat(52.02, 8.0) }],
    trasse: [P(52.003, 8.003), P(52.006, 8.003)], trasseSegments: [{ start: 0, end: 1 }],
    freiflaechen: [{ id: 'f1', polygon: quadrat(52.004, 8.004, 0.0002) }, { id: 'f2', polygon: quadrat(52.03, 8.0, 0.0002) }],
    waermeNetzGraph: { edges: [1] }, lwWp: { lat: 1, lng: 2 }, varianten: [{ id: 'v1' }], gutachten: { a: 1 }, stromNetz: { nodes: [1] },
  };
  it('übernimmt Gebäude, Trassen und Annahmen, aber kein Netz, keine Erzeuger und keine Verbräuche der Liegenschaft', () => {
    const { projekt: q, info } = quartierProjekt(projekt, { gebIds: [1], bereich, name: 'Quartier Nord', quelle: 'Großkaserne.json', datum: '2026-10-07' });
    expect(q.gebaeude.map(g => g.id)).toEqual([1]);
    expect(info).toMatchObject({ gebaeude: 1, waermeMwh: 500, heizlastKw: 200, trassen: 1, freiflaechen: 1 });
    expect(q.economicScenario.values.stromCtKwh).toBe(30);
    expect(q.waermeGrundlagen).toMatchObject({ stadt: 'Kassel', vlMinus5: '80', gesamtMwh: '', lastgangKw: null, bestandsanlage: null, witterung: null });
    expect(q.waermeGrundlagen.monatswerte).toHaveLength(12);
    expect(q.netz).toEqual({ zentrale: '', vl: '80', isLocked: false, sanierung: false });
    for (const k of ['waermeNetzGraph', 'lwWp', 'varianten', 'gutachten', 'stromNetz']) expect(q[k]).toBeUndefined();
    expect(q.projektStammdaten).toEqual({ kaserneName: 'Großkaserne – Quartier Nord', weNummer: '123' });
    expect(q.herausgeloestAus).toMatchObject({ projekt: 'Großkaserne.json', anzahlGebaeude: 1, gesamtGebaeude: 2 });
    // die Liegenschaft selbst bleibt unverändert
    expect(projekt.gebaeude).toHaveLength(2);
    expect(projekt.waermeGrundlagen.gesamtMwh).toBe('20000');
  });
});
