// Vitest-Tests für lib/netz-uebersicht.js — Übersichtsschaltbild des Liegenschaftsnetzes (Gutachten 3.1.2).
import { describe, it, expect } from 'vitest';
import { nuNetzUebersicht, nuIstGeplant, nuIstAbgerissen, nuWirksameProps } from '../src/lib/netz-uebersicht.js';

const RANG = { NAP: 0, Schaltanlage: 1, Trafo: 2, NSHV: 3, UV: 4, KVS: 4, Verbraucher: 5, Nsa: 5, KWK: 5, PV: 6, Batterie: 6 };
const HEUTE = 2026;

const gebaeude = [
  { id: 1, name: 'Übergabe', gebaeudenummer: '1' },
  { id: 2, name: 'Station Nord', gebaeudenummer: '2' },
  { id: 3, name: 'Station Ost', gebaeudenummer: '3' },
  { id: 4, name: 'Station Süd', gebaeudenummer: '4' },
  { id: 10, name: 'Stab', gebaeudenummer: '10' },
  { id: 11, name: 'Unterkunft', gebaeudenummer: '11' },
];
const A = (id, type, buildingId, props = {}, extra = {}) => ({ id, type, name: id, buildingId, props, ...extra });
const E = (id, u, v, extra = {}) => ({ id, u, v, ...extra });

// Übergabe (1) mit NAP und Schaltanlage; Ring 1 → 2 → 3 → 1; Station 4 als Strahl an 1.
const assets = [
  A('nap', 'NAP', 1, { spannungKV: 20 }), A('sa1', 'Schaltanlage', 1, { felder: 4 }),
  A('sa2', 'Schaltanlage', 2), A('t2', 'Trafo', 2, { leistungKVA: 630 }), A('ns2', 'NSHV', 2),
  A('sa3', 'Schaltanlage', 3, { trennstelle: 'true' }), A('t3a', 'Trafo', 3, { leistungKVA: '630' }), A('t3b', 'Trafo', 3, { leistungKVA: 400 }),
  A('ns3', 'NSHV', 3),
  A('t4', 'Trafo', 4, { leistungKVA: 250 }), A('ns4', 'NSHV', 4),
  A('uv10', 'UV', 10), A('v10', 'Verbraucher', 10), A('pv10', 'PV', 10, { leistungKWp: 99.5 }),
  A('uv11', 'UV', 11), A('nea11', 'Nsa', 11, { leistungKW: 200 }),
];
const edges = [
  E('e1', 'nap', 'sa1'),
  E('r1', 'sa1', 'sa2', { cableType: 'NA2XS2Y', crossSection: 150, lengthM: 300 }),
  E('r2', 'sa2', 'sa3', { cableType: 'NA2XS2Y', crossSection: 150, lengthM: 200 }),
  E('r3', 'sa3', 'sa1', { cableType: 'NA2XS2Y', crossSection: 150, lengthM: 250 }),
  E('s1', 'sa1', 't4', { cableType: 'NA2XS2Y', crossSection: 95 }),
  E('s1b', 'sa1', 't4', { cableType: 'NA2XS2Y', crossSection: 95 }),   // zweites System
  E('i2', 'sa2', 't2'), E('i3a', 'sa3', 't3a'), E('i3b', 'sa3', 't3b'),
  E('n2', 't2', 'ns2'), E('n2a', 'ns2', 'uv10'), E('n2b', 'uv10', 'v10'), E('n2c', 'uv10', 'pv10'),
  E('n3', 't3a', 'ns3'), E('n3a', 'ns3', 'uv11'), E('n3b', 'uv11', 'nea11'),
  E('n4', 't4', 'ns4'),
];
const lauf = (extra = {}) => nuNetzUebersicht({ assets, edges, gebaeude, typeRank: RANG, heute: HEUTE, ...extra });

describe('nuIstGeplant / nuIstAbgerissen', () => {
  it('Planungsschicht oder Baujahr in der Zukunft = geplant', () => {
    expect(nuIstGeplant({ schicht: 'entwicklung' }, null, HEUTE)).toBe(true);
    expect(nuIstGeplant({ schicht: 'entscheidung' }, null, HEUTE)).toBe(true);
    expect(nuIstGeplant({ baujahr: 2030 }, null, HEUTE)).toBe(true);
    expect(nuIstGeplant({}, { baujahr: 2031 }, HEUTE)).toBe(true);
    expect(nuIstGeplant({ schicht: 'bestand', baujahr: 1990 }, null, HEUTE)).toBe(false);
  });
  it('Abrissjahr vor dem laufenden Jahr = abgerissen', () => {
    expect(nuIstAbgerissen({ abrissjahr: 2020 }, null, HEUTE)).toBe(true);
    expect(nuIstAbgerissen({ abrissjahr: 2026 }, null, HEUTE)).toBe(false);
    expect(nuIstAbgerissen({}, { abrissjahr: 2001 }, HEUTE)).toBe(true);
  });
});

describe('nuNetzUebersicht', () => {
  it('fasst MS-Betriebsmittel je Gebäude zu Stationen zusammen', () => {
    const r = lauf();
    expect(Object.keys(r.stationen).sort()).toEqual(['g1', 'g2', 'g3', 'g4']);
    const s3 = r.stationen.g3;
    expect(s3.trafos.map(t => t.kva)).toEqual([630, 400]);
    expect(s3.schaltanlagen).toBe(1);
    expect(s3.nshv).toBe(1);
    expect(s3.trennstelle).toBe(true);
    expect(r.stationen.g1.hatNap).toBe(true);
    expect(r.stationen.g1.napKV).toBe(20);
  });

  it('erkennt Ring und Strahl an der Übergabestation', () => {
    const r = lauf();
    expect(r.wurzeln).toHaveLength(1);
    const [w] = r.wurzeln;
    expect(w.key).toBe('g1');
    const ring = w.abgaenge.find(a => a.art === 'ring');
    const strahl = w.abgaenge.find(a => a.art === 'strahl');
    expect(ring.folge).toEqual(['g2', 'g3']);
    expect(ring.wurzel.map(x => x.i)).toEqual([0, 1]);
    expect(ring.innen.map(x => [x.i, x.j])).toEqual([[0, 1]]);
    expect(ring.trennstelleErfasst).toBe(true);
    expect(strahl.folge).toEqual(['g4']);
    expect(r.ohneNap).toEqual([]);
  });

  it('bündelt parallele Kabel zu einer Verbindung mit Systemanzahl', () => {
    const v = lauf().verbindungen.find(x => x.a === 'g1' && x.b === 'g4');
    expect(v.anzahl).toBe(2);
    expect(v.kabel.map(k => k.qs)).toEqual([95, 95]);
  });

  it('zählt versorgte Gebäude und Erzeuger auf der NS-Seite je Station', () => {
    const r = lauf();
    expect(r.stationen.g2.gebaeudeVersorgt).toBe(1);
    expect(r.stationen.g2.erzeuger.PV).toEqual({ anzahl: 1, kw: 99.5, ohneWert: 0 });
    expect(r.stationen.g3.erzeuger.Nsa).toEqual({ anzahl: 1, kw: 200, ohneWert: 0 });
    expect(r.stationen.g4.gebaeudeVersorgt).toBe(0);
  });

  it('Kennzahlen: Stationen, Trafos, Leistung, Ringe, Kabellänge', () => {
    const k = lauf().kennzahlen;
    expect(k).toMatchObject({ stationen: 3, trafos: 4, kva: 1910, ringe: 1, abgaenge: 2, msLaengeM: 750, napKV: 20 });
  });

  it('Ist-Zustand lässt geplante Stationen weg, mitPlanung zeigt sie markiert', () => {
    const plus = [...assets, A('sa5', 'Schaltanlage', 11, {}, { schicht: 'entwicklung' }), A('t5', 'Trafo', 11, { leistungKVA: 800 }, { schicht: 'entwicklung' })];
    const plusE = [...edges, E('p1', 'sa1', 'sa5'), E('p2', 'sa5', 't5')];
    const ist = nuNetzUebersicht({ assets: plus, edges: plusE, gebaeude, typeRank: RANG, heute: HEUTE });
    expect(ist.stationen.g11).toBeUndefined();
    const plan = nuNetzUebersicht({ assets: plus, edges: plusE, gebaeude, typeRank: RANG, heute: HEUTE, mitPlanung: true });
    expect(plan.stationen.g11.geplant).toBe(true);
    expect(plan.verbindungen.find(v => v.b === 'g11').geplant).toBe(true);
    expect(plan.wurzeln[0].abgaenge.some(a => a.folge.includes('g11'))).toBe(true);
  });

  it('meldet Ring ohne Trennstelle und Stationen ohne Verbindung zum NAP', () => {
    const ohneTs = assets.map(a => (a.id === 'sa3' ? { ...a, props: {} } : a));
    const ohneStich = edges.filter(e => e.id !== 's1' && e.id !== 's1b');
    const r = nuNetzUebersicht({ assets: ohneTs, edges: ohneStich, gebaeude, typeRank: RANG, heute: HEUTE });
    expect(r.hinweise.some(h => /Ring ohne erfasste offene Trennstelle/.test(h))).toBe(true);
    expect(r.ohneNap.map(a => a.folge)).toEqual([['g4']]);
    expect(r.hinweise.some(h => /ohne MS-Verbindung zum Netzanschlusspunkt/.test(h))).toBe(true);
  });

  it('Trennstelle an der Kante zählt für den Ring', () => {
    const ohneTs = assets.map(a => (a.id === 'sa3' ? { ...a, props: {} } : a));
    const tsKante = edges.map(e => (e.id === 'r2' ? { ...e, trennstelle: true } : e));
    const r = nuNetzUebersicht({ assets: ohneTs, edges: tsKante, gebaeude, typeRank: RANG, heute: HEUTE });
    const ring = r.wurzeln[0].abgaenge.find(a => a.art === 'ring');
    expect(ring.trennstelleErfasst).toBe(true);
    expect(ring.innen[0].kante.trennstelle).toBe(true);
  });

  it('ohne NAP: Hinweis, alle Stationen unter ohneNap', () => {
    const r = nuNetzUebersicht({ assets: assets.filter(a => a.type !== 'NAP'), edges, gebaeude, typeRank: RANG, heute: HEUTE });
    expect(r.wurzeln).toEqual([]);
    expect(r.hinweise[0]).toMatch(/Kein Netzanschlusspunkt/);
    expect(r.ohneNap.flatMap(a => a.folge).sort()).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('verzweigter Abgang: Abzweig steht als Verbindung zwischen nicht benachbarten Stationen', () => {
    // 1 → 2 → 3 und 2 → 4 (Abzweig), ohne Ringschluss
    const es = [E('e1', 'nap', 'sa1'), E('a', 'sa1', 'sa2'), E('b', 'sa2', 'sa3'), E('c', 'sa2', 't4'),
      E('i2', 'sa2', 't2'), E('i3', 'sa3', 't3a')];
    const r = nuNetzUebersicht({ assets, edges: es, gebaeude, typeRank: RANG, heute: HEUTE });
    const [ab] = r.wurzeln[0].abgaenge;
    expect(ab.art).toBe('verzweigt');
    expect(ab.folge).toEqual(['g2', 'g3', 'g4']);
    expect(ab.innen.map(x => [x.i, x.j])).toEqual([[0, 1], [0, 2]]);
  });

  it('leeres Modell', () => {
    const r = nuNetzUebersicht({ assets: [], edges: [], gebaeude: [], typeRank: RANG, heute: HEUTE });
    expect(r.hinweise[0]).toMatch(/Keine Mittelspannungsbetriebsmittel/);
    expect(r.kennzahlen.stationen).toBe(0);
  });
});

describe('nuWirksameProps', () => {
  const ms = [
    { status: 'umgesetzt', jahr: 2020, newProps: { leistungKVA: 800 } },
    { status: 'geplant', jahr: 2030, newProps: { leistungKVA: 1000 } },
    { status: 'geplant', jahr: 2040, newProps: { leistungKVA: 1250 } },
    { status: 'verworfen', jahr: 2025, newProps: { leistungKVA: 99 } },
  ];
  it('Ist: nur umgesetzte, fällige Maßnahmen', () => {
    expect(nuWirksameProps({ leistungKVA: 630 }, ms, { heute: HEUTE }).leistungKVA).toBe(800);
    expect(nuWirksameProps({ leistungKVA: 630 }, ms, { heute: 2019 }).leistungKVA).toBe(630);
  });
  it('Ziel: auch geplante, bis zum Zieljahr, chronologisch', () => {
    expect(nuWirksameProps({ leistungKVA: 630 }, ms, { ziel: true, heute: HEUTE }).leistungKVA).toBe(1250);
    expect(nuWirksameProps({ leistungKVA: 630 }, ms, { ziel: true, heute: HEUTE, zieljahr: 2035 }).leistungKVA).toBe(1000);
  });
  it('Jahr über injizierte Funktion (Phasen)', () => {
    const m = [{ status: 'geplant', phaseId: 'p1', newProps: { leistungKVA: 1000 } }];
    const jahrVon = x => (x.phaseId === 'p1' ? 2050 : null);
    expect(nuWirksameProps({ leistungKVA: 630 }, m, { ziel: true, heute: HEUTE, zieljahr: 2040, jahrVon }).leistungKVA).toBe(630);
    expect(nuWirksameProps({ leistungKVA: 630 }, m, { ziel: true, heute: HEUTE, jahrVon }).leistungKVA).toBe(1000);
  });
});

describe('nuNetzUebersicht — Zielnetz (mitPlanung)', () => {
  const tausch = { status: 'geplant', jahr: 2029, newProps: { leistungKVA: 1000 } };
  const plusA = [
    ...assets.map(a => (a.id === 't2' ? { ...a, massnahmen: [tausch] } : a.id === 't4' ? { ...a, abrissjahr: 2031 } : a)),
    A('sa5', 'Schaltanlage', 11, {}, { baujahr: 2032 }), A('t5', 'Trafo', 11, { leistungKVA: 800 }, { baujahr: 2032 }),
  ];
  const plusE = [
    ...edges.map(e => (e.id === 'r2' ? { ...e, massnahmen: [{ status: 'geplant', jahr: 2030, newProps: { crossSection: 240 } }] } : e)),
    E('p1', 'sa3', 'sa5', { baujahr: 2032, cableType: 'NA2XS2Y', crossSection: 150 }), E('p2', 'sa5', 't5', { baujahr: 2032 }),
  ];
  const ziel = extra => nuNetzUebersicht({ assets: plusA, edges: plusE, gebaeude, typeRank: RANG, heute: HEUTE, mitPlanung: true, ...extra });

  it('Trafo-Tausch per Maßnahme: kva Ziel, kvaIst Bestand, ertuechtigt', () => {
    const t = ziel().stationen.g2.trafos[0];
    expect(t).toMatchObject({ kva: 1000, kvaIst: 630, ertuechtigt: true, geplant: false });
    const ist = nuNetzUebersicht({ assets: plusA, edges: plusE, gebaeude, typeRank: RANG, heute: HEUTE });
    expect(ist.stationen.g2.trafos[0]).toMatchObject({ kva: 630, ertuechtigt: false });
  });

  it('Kabel-Ertüchtigung markiert die Verbindung, Querschnitt aus der Maßnahme', () => {
    const v = ziel().verbindungen.find(x => x.a === 'g2' && x.b === 'g3');
    expect(v.ertuechtigt).toBe(true);
    expect(v.geplant).toBe(false);
    expect(v.kabel[0].qs).toBe(240);
  });

  it('Rückbau bis Zieljahr fällt weg, Neubau ist geplant, Zieljahr = spätestes Planjahr', () => {
    const r = ziel();
    expect(r.stationen.g4).toBeUndefined();
    expect(r.stationen.g11.geplant).toBe(true);
    expect(r.kennzahlen.zieljahr).toBe(2032);
  });

  it('Zieljahr begrenzt Neubau, Rückbau und Maßnahmen', () => {
    const r = ziel({ zieljahr: 2030 });
    expect(r.stationen.g11).toBeUndefined();
    expect(r.stationen.g4).toBeDefined();
    expect(r.stationen.g2.trafos[0].kva).toBe(1000);
    expect(r.kennzahlen.zieljahr).toBe(2030);
  });

  it('nParallel aus Maßnahme ist Ertüchtigung, aber kein zusätzliches System (3×1×185 = ein System)', () => {
    const es = edges.map(e => (e.id === 'r1' ? { ...e, massnahmen: [{ status: 'geplant', jahr: 2030, newProps: { nParallel: 2 } }] } : e));
    const r = nuNetzUebersicht({ assets, edges: es, gebaeude, typeRank: RANG, heute: HEUTE, mitPlanung: true });
    const v = r.verbindungen.find(x => x.a === 'g1' && x.b === 'g2');
    expect(v).toMatchObject({ anzahl: 1, ertuechtigt: true });
  });

  it('Ring mit Abzweig bleibt Ring: Ringweg zuerst, Abzweig danach', () => {
    // Ring 1 → 2 → 3 → 1, dazu Station 4 als Stich an Station 2
    const es = [...edges.filter(e => e.id !== 's1' && e.id !== 's1b'), E('st', 'sa2', 't4')];
    const r = nuNetzUebersicht({ assets, edges: es, gebaeude, typeRank: RANG, heute: HEUTE });
    const [ab] = r.wurzeln[0].abgaenge;
    expect(ab.art).toBe('ring');
    expect(ab.folge).toEqual(['g2', 'g3', 'g4']);
    expect(ab.abzweige).toBe(1);
    expect(ab.wurzel.map(x => x.i)).toEqual([0, 1]);
    expect(ab.innen.map(x => [x.i, x.j])).toEqual([[0, 1], [0, 2]]);
    expect(r.kennzahlen.ringe).toBe(1);
  });
});
