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

describe('nuNetzUebersicht — Linien zwischen zwei Netzanschlusspunkten', () => {
  // NAP 1 (Gebäude 1) und NAP 2 (Gebäude 2), dazwischen drei Linien:
  // L1: 11 → 12 → 13, offen zwischen 12 und 13 · L2: 21 → 22, offen vor NAP 2 · L3: 31 → 32 → 33 ohne Trennstelle
  const geb = [1, 2, 11, 12, 13, 21, 22, 31, 32, 33].map(i => ({ id: i, name: `Station ${i}`, gebaeudenummer: String(i) }));
  const bau = ({ tsL3 = null } = {}) => {
    const as = [A('nap1', 'NAP', 1, { spannungKV: 20 }), A('sa1', 'Schaltanlage', 1),
                A('nap2', 'NAP', 2, { spannungKV: 20 }), A('sa2', 'Schaltanlage', 2)];
    const es = [E('x1', 'nap1', 'sa1'), E('x2', 'nap2', 'sa2')];
    [[11, 12, 13], [21, 22], [31, 32, 33]].forEach((l, li) => {
      let prev = 'sa1';
      l.forEach(g => {
        as.push(A('t' + g, 'Trafo', g, { leistungKVA: 630 }));
        es.push(E('k' + g, prev, 't' + g, { trennstelle: g === 13 || g === tsL3 }));
        prev = 't' + g;
      });
      es.push(E('ende' + li, prev, 'sa2', { trennstelle: li === 1 }));
    });
    return nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE });
  };

  it('erkennt drei Linien statt drei Strahlen an NAP 1; NAP 2 behält keine Abgänge', () => {
    const r = bau();
    expect(r.linien).toHaveLength(3);
    expect(r.linien.map(l => [l.art, l.von, l.bis])).toEqual([['linie', 'g1', 'g2'], ['linie', 'g1', 'g2'], ['linie', 'g1', 'g2']]);
    expect(r.wurzeln.map(w => w.abgaenge.length)).toEqual([0, 0]);
    expect(r.kennzahlen).toMatchObject({ linien: 3, abgaenge: 0, ringe: 0 });
  });

  it('Hauptweg von NAP 1 nach NAP 2, Anbindungen an beiden Enden', () => {
    const [l1] = bau().linien;
    expect(l1.folge).toEqual(['g11', 'g12', 'g13']);
    expect(l1.haupt).toBe(3);
    expect(l1.wurzel.map(x => x.i)).toEqual([0]);
    expect(l1.wurzelB.map(x => x.i)).toEqual([2]);
    expect(l1.innen.map(x => [x.i, x.j])).toEqual([[0, 1], [1, 2]]);
  });

  it('Speiserichtung aus der offenen Trennstelle am Kabel', () => {
    const [l1, l2] = bau().linien;
    expect(l1.speisung).toEqual(['A', 'A', 'B']);
    expect(l2.speisung).toEqual(['A', 'A']);
    expect(l1.gekoppelt).toBe(false);
  });

  it('Linie ohne Trennstelle koppelt beide Netzanschlüsse → Hinweis', () => {
    const r = bau();
    expect(r.linien[2].gekoppelt).toBe(true);
    expect(r.linien[2].speisung).toEqual(['beide', 'beide', 'beide']);
    expect(r.hinweise.join(' ')).toMatch(/Linie 3 zwischen NAP 1 und NAP 2 ohne offene Trennstelle/);
    expect(bau({ tsL3: 32 }).hinweise.join(' ')).not.toMatch(/Linie 3/);
  });

  it('Übergabestationen mit eigenem Trafo und einer Linie dazwischen (Kompaktstationen)', () => {
    const as = [A('nap1', 'NAP', 1), A('sa1', 'Schaltanlage', 1), A('t1', 'Trafo', 1, { leistungKVA: 630 }),
                A('nap2', 'NAP', 2), A('sa2', 'Schaltanlage', 2), A('t2', 'Trafo', 2, { leistungKVA: 630 }),
                A('sa11', 'Schaltanlage', 11), A('t11', 'Trafo', 11, { leistungKVA: 630 }),
                A('sa12', 'Schaltanlage', 12), A('t12', 'Trafo', 12, { leistungKVA: 630 })];
    const es = [E('a', 'nap1', 'sa1'), E('b', 'sa1', 't1'), E('c', 'nap2', 'sa2'), E('d', 'sa2', 't2'),
                E('e', 'sa11', 't11'), E('f', 'sa12', 't12'),
                E('k1', 'sa1', 'sa11'), E('k2', 'sa11', 'sa12', { trennstelle: true }), E('k3', 'sa12', 'sa2')];
    const r = nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE });
    expect(r.linien).toHaveLength(1);
    expect(r.linien[0]).toMatchObject({ art: 'linie', folge: ['g11', 'g12'], speisung: ['A', 'B'] });
    expect(r.kennzahlen).toMatchObject({ stationen: 4, linien: 1, abgaenge: 0 });
  });

  it('direktes Kabel zwischen zwei Übergabestationen ist eine Kupplung', () => {
    const as = [A('nap1', 'NAP', 1), A('sa1', 'Schaltanlage', 1), A('nap2', 'NAP', 2), A('sa2', 'Schaltanlage', 2)];
    const es = [E('a', 'nap1', 'sa1'), E('c', 'nap2', 'sa2'), E('k', 'sa1', 'sa2', { trennstelle: true })];
    const r = nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE });
    expect(r.linien).toHaveLength(1);
    expect(r.linien[0]).toMatchObject({ art: 'kopplung', von: 'g1', bis: 'g2', gekoppelt: false });
    expect(r.kennzahlen.linien).toBe(0);
  });

  it('Abzweig an einer Linie hängt hinter dem Hauptweg', () => {
    const as = [A('nap1', 'NAP', 1), A('nap2', 'NAP', 2),
                A('t11', 'Trafo', 11), A('t12', 'Trafo', 12), A('t13', 'Trafo', 13)];
    const es = [E('a', 'nap1', 't11'), E('b', 't11', 't12', { trennstelle: true }), E('c', 't12', 'nap2'), E('d', 't11', 't13')];
    const [l] = nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE }).linien;
    expect(l).toMatchObject({ art: 'linie', folge: ['g11', 'g12', 'g13'], haupt: 2, abzweige: 1, speisung: ['A', 'B', 'A'] });
  });
});

describe('nuNetzUebersicht — Leiter unter einer Übergabe', () => {
  // Übergabe (1) speist Station 5 und 6 über eigene Kabel; zwischen 5 und 6 drei Linien, an 6 ein Stich (40)
  const geb = [1, 5, 6, 11, 12, 13, 21, 22, 31, 32, 33, 40].map(i => ({ id: i, name: `G${i}`, gebaeudenummer: String(i) }));
  const bau = ({ ts = [], knotenUebergabe = false } = {}) => {
    const as = [A('nap', 'NAP', 1), A('sa0', 'Schaltanlage', 1), A('sa6', 'Schaltanlage', 6), A('t6', 'Trafo', 6, { leistungKVA: 800 }),
                A('t40', 'Trafo', 40, { leistungKVA: 250 })];
    const es = [E('x', 'nap', 'sa0'), E('i6', 'sa6', 't6'), E('z6', 'sa0', 'sa6'), E('s40', 'sa6', 't40')];
    let links = 'sa0';
    if (!knotenUebergabe) {
      as.push(A('sa5', 'Schaltanlage', 5), A('t5', 'Trafo', 5, { leistungKVA: 800 }));
      es.push(E('i5', 'sa5', 't5'), E('z5', 'sa0', 'sa5'));
      links = 'sa5';
    }
    [[11, 12, 13], [21, 22], [31, 32, 33]].forEach((l, li) => {
      let prev = links;
      l.forEach(g => { as.push(A('t' + g, 'Trafo', g, { leistungKVA: 400 })); es.push(E('k' + g, prev, 't' + g, { trennstelle: ts.includes(g) })); prev = 't' + g; });
      es.push(E('e' + li, prev, 'sa6'));
    });
    return nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE });
  };

  it('zwei Knotenstationen mit drei Linien dazwischen werden eine Leiter statt „vermascht“', () => {
    const r = bau();
    const [ab] = r.wurzeln[0].abgaenge;
    expect(ab.art).toBe('leiter');
    expect(ab.leiter).toMatchObject({ links: 'g5', rechts: 'g6' });
    expect(ab.leiter.zubringer.map(v => [v.a, v.b])).toEqual([['g1', 'g5'], ['g1', 'g6']]);
    expect(ab.leiter.linien.map(l => [l.art, l.folge.join(',')])).toEqual([['linie', 'g11,g12,g13'], ['linie', 'g21,g22'], ['linie', 'g31,g32,g33']]);
    expect(ab.leiter.stiche).toHaveLength(1);
    expect(ab.leiter.stiche[0]).toMatchObject({ seite: 'B', art: 'strahl', folge: ['g40'] });
    expect(r.kennzahlen).toMatchObject({ linien: 3, abgaenge: 1, ringe: 0 });
    expect(ab.folge).toHaveLength(11);   // Rückfall-Felder bleiben vollständig
  });

  it('Speiserichtung je Linie aus der Trennstelle am Kabel; ohne Trennstelle ein Hinweis', () => {
    expect(bau().hinweise.join(' ')).toMatch(/3 Linien zwischen zwei Knotenstationen ohne erfasste offene Trennstelle/);
    const r = bau({ ts: [13, 21, 32] });
    const [l1, l2, l3] = r.wurzeln[0].abgaenge[0].leiter.linien;
    expect(l1.speisung).toEqual(['A', 'A', 'B']);
    expect(l2.speisung).toEqual(['B', 'B']);
    expect(l3.speisung).toEqual(['A', 'B', 'B']);
    expect(r.hinweise.join(' ')).not.toMatch(/Knotenstationen/);
  });

  it('Übergabe selbst als linker Knoten: direktes Kabel zur rechten Station ist Zubringer, keine Kupplung', () => {
    const [ab] = bau({ knotenUebergabe: true }).wurzeln[0].abgaenge;
    expect(ab.art).toBe('leiter');
    expect(ab.leiter.links).toBeNull();
    expect(ab.leiter.rechts).toBe('g6');
    expect(ab.leiter.linien.map(l => l.art)).toEqual(['linie', 'linie', 'linie']);
    expect(ab.leiter.zubringer[0]).toBeNull();
    expect(ab.leiter.zubringer[1]).toMatchObject({ a: 'g1', b: 'g6' });
  });

  it('einfacher Ring bleibt Ring (nur eine Linie zwischen zwei Stationen ist keine Leiter)', () => {
    const [ab] = lauf().wurzeln[0].abgaenge;
    expect(ab.art).toBe('ring');
    expect(ab.leiter).toBeNull();
  });
});

describe('nuNetzUebersicht — Leiter mit Abzweigen, Querverbindung und Diagnose', () => {
  const geb = [1, 5, 6, 11, 12, 13, 21, 22, 31, 32, 33, 50, 60].map(i => ({ id: i, name: `G${i}`, gebaeudenummer: String(i) }));
  const T = (g, kva = 630) => A('t' + g, 'Trafo', g, { leistungKVA: kva });
  const basis = () => {
    const as = [A('nap', 'NAP', 1), A('sa0', 'Schaltanlage', 1), T(5), T(6), T(11), T(12), T(13), T(21), T(22), T(31), T(32), T(33), T(50)];
    const es = [E('x', 'nap', 'sa0'), E('z5', 'sa0', 't5'), E('z6', 'sa0', 't6'),
      E('a1', 't5', 't11'), E('a2', 't11', 't12'), E('a3', 't12', 't13'), E('a4', 't13', 't6'),
      E('b1', 't5', 't21'), E('b2', 't21', 't22'), E('b3', 't22', 't6'),
      E('c1', 't5', 't31'), E('c2', 't31', 't32'), E('c3', 't32', 't33'), E('c4', 't33', 't6'),
      E('st', 't21', 't50')];   // Abzweig an einer Linienstation → dritte Station mit ≥ 3 Nachbarn
    return { as, es };
  };
  const lauf2 = ({ as, es }) => nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE });

  it('Abzweig an einer Linienstation: Knoten = die beiden von der Übergabe gespeisten Stationen', () => {
    const [ab] = lauf2(basis()).wurzeln[0].abgaenge;
    expect(ab.art).toBe('leiter');
    expect(ab.leiter).toMatchObject({ links: 'g5', rechts: 'g6' });
    const l2 = ab.leiter.linien[1];
    expect(l2).toMatchObject({ art: 'linie', folge: ['g21', 'g22', 'g50'], haupt: 2, abzweige: 1 });
  });

  it('Querverbindung zwischen zwei Linien: eine vermaschte Linie, weiter Leiter', () => {
    const b = basis();
    b.es.push(E('q', 't12', 't32'));
    const [ab] = lauf2(b).wurzeln[0].abgaenge;
    expect(ab.art).toBe('leiter');
    expect(ab.leiter.linien.map(l => l.art)).toEqual(['vermascht', 'linie']);
    expect(ab.leiter.linien[0].wege).toEqual([3, 3]);   // zwei Linien über die Querverbindung, je eigene Zeile
    expect(lauf2(b).kennzahlen.linien).toBe(3);
  });

  it('kein Leitermuster → Hinweis nennt die störenden Stationen', () => {
    const b = basis();
    b.es.push(E('w', 'sa0', 't12'));   // Linienstation zusätzlich an der Übergabe
    const r = lauf2(b);
    expect(r.wurzeln[0].abgaenge[0].art).toBe('vermascht');
    expect(r.hinweise.join(' ')).toMatch(/Abgang 1 ist vermascht.*Übergabe speist Gebäude 5, Gebäude 6, Gebäude 12/);
    expect(r.hinweise.join(' ')).toMatch(/Stationen mit ≥ 3 MS-Verbindungen: .*Gebäude 5 \(4\)/);
  });
});

describe('nuNetzUebersicht — Änderungen im Zielnetz (Marken, Rückbau)', () => {
  const geb = [1, 2, 3, 4, 5, 6].map(i => ({ id: i, name: `G${i}`, gebaeudenummer: String(i) }));
  const as = [
    A('nap', 'NAP', 1), A('sa1', 'Schaltanlage', 1),
    A('t2', 'Trafo', 2, { leistungKVA: 630 }, { massnahmen: [{ status: 'geplant', jahr: 2030, newProps: { leistungKVA: 1000 } }] }),
    A('t3', 'Trafo', 3, { leistungKVA: 400 }), A('t4', 'Trafo', 4, { leistungKVA: 250 }, { abrissjahr: 2029 }),
    A('t5', 'Trafo', 5, { leistungKVA: 630 }, { baujahr: 2032 }),
  ];
  const es = [
    E('x', 'nap', 'sa1'), E('a1', 'sa1', 't2', { crossSection: 150, baujahr: 1998 }),
    E('a2', 't2', 't3', { crossSection: 150, massnahmen: [{ status: 'geplant', jahr: 2031, newProps: { crossSection: 240 } }] }),
    E('a3', 't3', 'sa1', { baujahr: 2031 }), E('b1', 'sa1', 't4', { abrissjahr: 2029 }), E('c1', 't3', 't5', { baujahr: 2032 }),
  ];
  const ziel = () => nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE, mitPlanung: true });

  it('nummeriert die Änderungen nach Jahr; Kabel zur neuen Station gehören zu deren Neubau', () => {
    const r = ziel();
    expect(r.aenderungen.map(x => [x.nr, x.art, x.jahr])).toEqual([
      [1, 'station-weg', 2029], [2, 'trafo', 2030], [3, 'kabel-neu', 2031], [4, 'kabel-ertuechtigt', 2031], [5, 'station-neu', 2032],
    ]);
    expect(r.aenderungen[4]).toMatchObject({ station: 'g5', anbindung: 1 });
    expect(r.aenderungen[1].tausch.map(t => [t.kvaIst, t.kva])).toEqual([[630, 1000]]);
  });

  it('zurückgebaute Station bleibt als „entfällt“ erhalten, Kabel bekommen Baujahr und Ist-Querschnitt', () => {
    const r = ziel();
    expect(r.stationen.g4).toBeUndefined();
    expect(r.entfallen.g4).toMatchObject({ entfaellt: true, jahr: 2029 });
    const v = r.verbindungen.find(x => x.a === 'g2' && x.b === 'g3');
    expect(v.kabel[0]).toMatchObject({ qs: 240, qsIst: 150 });
    expect(r.verbindungen.find(x => x.a === 'g1' && x.b === 'g2').baujahr).toBe(1998);
  });

  it('Bestand ohne Planung: keine Änderungen, nichts entfällt', () => {
    const r = nuNetzUebersicht({ assets: as, edges: es, gebaeude: geb, typeRank: RANG, heute: HEUTE });
    expect(r.aenderungen).toEqual([]);
    expect(r.entfallen).toEqual({});
  });
});
