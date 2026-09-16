// Vitest-Tests für lib/resilienz-core.js — Notstromklassen und Lastbilanz.
import { describe, it, expect } from 'vitest';
import {
  NOTSTROM_KLASSEN, normalisiereNotstrom, notstromLastPct,
  anschlussKwJeGebaeude, notstromBilanz, NOTSTROM_B_VORGABE_PCT,
  NEA_KOSTEN, neaEmpfehlungKw, neaKosten, notstromNetzBaum,
  notstromPlatzierung, notstromPlatzierungVergleich, neaKostenMitBestand,
  inselAggregate, maxFensterEnergie, inselZuschaltstufen, inselMsKennwerte, liegenschaftsInsel,
  maxFensterStart, waermeErzeugerStatus, waermeBlackout,
  ZIEL_VORGABEN, normalisiereZiele, zielGebaeude, zielKraftstoffL, bewerteZiel, resilienzZielMatrix,
} from '../src/lib/resilienz-core.js';

describe('normalisiereNotstrom', () => {
  it('verwirft fehlende und unbekannte Klassen', () => {
    expect(normalisiereNotstrom(null)).toBeNull();
    expect(normalisiereNotstrom({ klasse: 'X' })).toBeNull();
  });

  it('behält lastPct nur bei B und eigeneNea nur bei A', () => {
    expect(normalisiereNotstrom({ klasse: 'A', lastPct: 30, eigeneNea: true }))
      .toEqual({ klasse: 'A', lastPct: null, eigeneNea: true });
    expect(normalisiereNotstrom({ klasse: 'B', lastPct: '40', eigeneNea: true }))
      .toEqual({ klasse: 'B', lastPct: 40, eigeneNea: false });
    expect(normalisiereNotstrom({ klasse: 'C', lastPct: 40 }))
      .toEqual({ klasse: 'C', lastPct: null, eigeneNea: false });
  });

  it('begrenzt lastPct auf 0–100', () => {
    expect(normalisiereNotstrom({ klasse: 'B', lastPct: 140 }).lastPct).toBe(100);
    expect(normalisiereNotstrom({ klasse: 'B', lastPct: -5 }).lastPct).toBe(0);
    expect(normalisiereNotstrom({ klasse: 'B', lastPct: 'abc' }).lastPct).toBeNull();
  });
});

describe('notstromLastPct', () => {
  it('A = 100, C = 0, ohne Klasse = 0', () => {
    expect(notstromLastPct({ klasse: 'A' })).toBe(100);
    expect(notstromLastPct({ klasse: 'C' })).toBe(0);
    expect(notstromLastPct(undefined)).toBe(0);
  });

  it('B nimmt den eigenen Wert, sonst die Vorgabe', () => {
    expect(notstromLastPct({ klasse: 'B', lastPct: 30 }, 60)).toBe(30);
    expect(notstromLastPct({ klasse: 'B' }, 60)).toBe(60);
    expect(notstromLastPct({ klasse: 'B' })).toBe(NOTSTROM_B_VORGABE_PCT);
  });
});

describe('anschlussKwJeGebaeude', () => {
  it('summiert nur Verbraucher mit buildingId und gültiger Leistung', () => {
    const m = anschlussKwJeGebaeude([
      { type: 'Verbraucher', buildingId: 1, props: { leistungKW: '40' } },
      { type: 'Verbraucher', buildingId: 1, props: { leistungKW: '12,5' } },
      { type: 'Verbraucher', buildingId: null, props: { leistungKW: '99' } },
      { type: 'WP',          buildingId: 1, props: { leistungKW: '20' } },
      { type: 'Verbraucher', buildingId: 2, props: { leistungKW: '' } },
    ]);
    expect(m.get(1)).toBeCloseTo(52.5);
    expect(m.has(2)).toBe(false);
  });
});

describe('notstromBilanz', () => {
  const geb = [
    { id: 1, name: 'Wache',   notstrom: { klasse: 'A', eigeneNea: true } },
    { id: 2, name: 'Stab',    notstrom: { klasse: 'A' } },
    { id: 3, name: 'Kantine', notstrom: { klasse: 'B', lastPct: 40 } },
    { id: 4, name: 'Halle',   notstrom: { klasse: 'B' } },
    { id: 5, name: 'Lager',   notstrom: { klasse: 'C' } },
    { id: 6, name: 'Garage' },
  ];
  const kw = new Map([[1, 50], [2, 100], [3, 200], [4, 80], [5, 30], [6, 999]]);

  it('rechnet Anschluss- und Notstromleistung je Klasse', () => {
    const b = notstromBilanz(geb, kw, { bVorgabePct: 25 });
    expect(b.klassen.A).toEqual({ anzahl: 2, anschlussKw: 150, notstromKw: 150, ohneLast: 0 });
    expect(b.klassen.B).toEqual({ anzahl: 2, anschlussKw: 280, notstromKw: 80 + 20, ohneLast: 0 });
    expect(b.klassen.C).toEqual({ anzahl: 1, anschlussKw: 30, notstromKw: 0, ohneLast: 0 });
    expect(b.summe.notstromKw).toBe(250);
    expect(b.einspeisepunkte).toBe(1);
  });

  it('trennt Aggregate am Gebäude von der zentral zu tragenden Last', () => {
    const b = notstromBilanz(geb, kw, { bVorgabePct: 25 });
    expect(b.neaAmGebaeude).toEqual({ anzahl: 1, kw: 50 });
    expect(b.zentralKw).toBe(200);
  });

  it('zählt eingestufte Gebäude ohne Verbraucher-Asset', () => {
    const b = notstromBilanz(geb, new Map([[1, 50]]));
    expect(b.klassen.A.ohneLast).toBe(1);
    expect(b.summe.ohneLast).toBe(4);
  });

  it('sortiert nach Klasse, dann nach Notstromlast', () => {
    const b = notstromBilanz(geb, kw, { bVorgabePct: 25 });
    expect(b.zeilen.map(z => z.id)).toEqual([2, 1, 3, 4, 5]);
    expect(b.zeilen.find(z => z.id === 4).lastPctVorgabe).toBe(true);
  });

  it('hat für jede Klasse eine Farbe', () => {
    for (const k of Object.values(NOTSTROM_KLASSEN)) expect(k.farbe).toMatch(/^#/);
  });
});

// ── Schritt 2: Platzierung am Netz ──────────────────────────────────────────
//  nap ─ t1 ─ n1 ─ k1 ─ Geb 1 (A, 40 kW), Geb 2 (A, 30 kW), Geb 3 (—, 200 kW), Geb 7 (A mit NEA)
//                 └ k2 ─ Geb 4 (B 50 %, 100 kW), Ladepark L1 (22 kW)
//      └ t2 ─ v5 (Verbraucher von Geb 5, A, 20 kW)
//  Geb 6 (A, 10 kW) hängt nicht am Netz.
function netz() {
  const assets = [
    { id: 'nap', type: 'NAP', name: 'NAP' },
    { id: 't1', type: 'Trafo', name: 'Trafo 1' },
    { id: 't2', type: 'Trafo', name: 'Trafo 2' },
    { id: 'n1', type: 'NSHV', name: 'NSHV 1' },
    { id: 'k1', type: 'KVS', name: 'KVS 1' },
    { id: 'k2', type: 'KVS', name: 'KVS 2' },
    { id: 'L1', type: 'Lade', name: 'Ladepark', lastKw: 22 },
    { id: 'v5', type: 'Verbraucher', name: 'Verbr. 5', buildingId: 5, lastKw: 20 },
  ];
  const kante = (id, u, v) => ({ id, u, v });
  const kanten = [
    kante('e1', 'nap', 't1'), kante('e2', 't1', 'n1'), kante('e3', 'n1', 'k1'), kante('e4', 'n1', 'k2'),
    kante('e5', 'k1', 1), kante('e6', 'k1', 2), kante('e7', 'k1', 3), kante('e8', 'k1', 7),
    kante('e9', 'k2', 4), kante('e10', 'k2', 'L1'), kante('e11', 'nap', 't2'), kante('e12', 't2', 'v5'),
  ];
  const gebaeude = [
    { id: 1, name: 'G1', notstrom: { klasse: 'A' } },
    { id: 2, name: 'G2', notstrom: { klasse: 'A' } },
    { id: 3, name: 'G3' },
    { id: 4, name: 'G4', notstrom: { klasse: 'B', lastPct: 50 } },
    { id: 5, name: 'G5', notstrom: { klasse: 'A' } },
    { id: 6, name: 'G6', notstrom: { klasse: 'A' } },
    { id: 7, name: 'G7', notstrom: { klasse: 'A', eigeneNea: true } },
  ];
  const kwJeGebaeude = new Map([[1, 40], [2, 30], [3, 200], [4, 100], [5, 20], [6, 10], [7, 15]]);
  return { assets, kanten, gebaeude, kwJeGebaeude };
}

describe('neaEmpfehlungKw / neaKosten', () => {
  it('rundet die Spitze mit Reserve auf das Raster', () => {
    expect(neaEmpfehlungKw(40)).toBe(50);
    expect(neaEmpfehlungKw(0)).toBe(0);
  });
  it('unterscheidet Einspeisung am Knoten und am Gebäude', () => {
    expect(neaKosten(50, 'gebaeude')).toBe(NEA_KOSTEN.fixEur + 50 * NEA_KOSTEN.eurProKw + NEA_KOSTEN.einspeisungGebaeudeEur);
    expect(neaKosten(50, 'knoten') - neaKosten(50, 'gebaeude'))
      .toBe(NEA_KOSTEN.einspeisungKnotenEur - NEA_KOSTEN.einspeisungGebaeudeEur);
    expect(neaKosten(0, 'knoten')).toBe(0);
  });
});

describe('notstromNetzBaum', () => {
  it('baut den Baum ab dem NAP und bricht Ringe auf', () => {
    const { assets, kanten } = netz();
    const b = notstromNetzBaum(assets, [...kanten, { id: 'ring', u: 'k1', v: 'k2' }], new Set([1, 2, 3, 4, 7]));
    expect(b.wurzeln).toEqual(['nap']);
    expect(b.parent.get(3)).toBe('k1');
    expect(b.parent.get('k2')).toBe('n1');
    expect(b.parentKante.get(4)).toBe('e9');
  });
  it('nimmt ohne NAP die Trafos als Wurzeln', () => {
    const { assets, kanten } = netz();
    const b = notstromNetzBaum(assets.filter(a => a.id !== 'nap'), kanten, new Set());
    expect(b.wurzeln.sort()).toEqual(['t1', 't2']);
  });
});

describe('notstromPlatzierung', () => {
  it('optimiert: Trafo 1 für G1/G2/G4, Gebäudeaggregat für G5', () => {
    const r = notstromPlatzierung({ ...netz(), strategie: 'optimal' });
    const t1 = r.aggregate.find(a => a.id === 't1');
    expect(t1).toMatchObject({ ort: 'knoten', typ: 'Trafo', peakKw: 120, empfKw: 145 });
    expect(t1.gebaeude.sort()).toEqual([1, 2, 4]);
    expect(r.aggregate.find(a => a.id === 5)).toMatchObject({ ort: 'gebaeude', empfKw: 25 });
    expect(r.summe.kosten).toBe(93250 + 31250 + 26750 + 29000);
  });

  it('vermerkt die abzuschaltenden Abgänge — ohne das Gebäude mit eigenem Aggregat', () => {
    const r = notstromPlatzierung({ ...netz(), strategie: 'optimal' });
    const ab = r.abgaenge.map(a => `${a.vonId}→${a.zuId}`).sort();
    expect(ab).toEqual(['k1→3', 'k2→L1']);
    expect(r.abgaenge.find(a => a.zuId === 3)).toMatchObject({ kanteId: 'e7', lastKw: 200, aggregatId: 't1' });
  });

  it('benennt Abgänge zu Gebäudelasten nach dem Gebäude', () => {
    const n = netz();
    n.gebaeude.find(g => g.id === 5).notstrom = null;
    n.kanten.push({ id: 'e13', u: 't2', v: 6 });          // G6 (A) hängt jetzt an Trafo 2
    const r = notstromPlatzierung({ ...n, strategie: 'trafo' });
    expect(r.abgaenge.find(a => a.zuId === 'v5')).toMatchObject({ vonName: 'Trafo 2', zuName: 'G5' });
  });

  it('führt Gebäude außerhalb des Netzes und mit eigenem Aggregat gesondert', () => {
    const r = notstromPlatzierung({ ...netz(), strategie: 'optimal' });
    expect(r.nichtAmNetz).toEqual([6]);
    expect(r.fest).toEqual([7]);
    expect(r.aggregate.find(a => a.id === 6).nichtAmNetz).toBe(true);
    expect(r.aggregate.find(a => a.id === 7).fest).toBe(true);
  });

  it('je Gebäude: kein Knotenaggregat, keine Abgänge', () => {
    const r = notstromPlatzierung({ ...netz(), strategie: 'gebaeude' });
    expect(r.aggregate.every(a => a.ort === 'gebaeude')).toBe(true);
    expect(r.summe.abgaenge).toBe(0);
    expect(r.summe.anzahl).toBe(6);
    expect(r.summe.kosten).toBe(214500);
  });

  it('je Trafostation: beide Trafos erzwungen', () => {
    const r = notstromPlatzierung({ ...netz(), strategie: 'trafo' });
    expect(r.aggregate.filter(a => a.ort === 'knoten').map(a => a.id).sort()).toEqual(['t1', 't2']);
    expect(r.summe.kosten).toBe(93250 + 36250 + 26750 + 29000);
  });

  it('der Vergleich empfiehlt die günstigste Strategie', () => {
    const v = notstromPlatzierungVergleich(netz());
    expect(v.empfohlen).toBe('optimal');
    expect(Object.keys(v.varianten).sort()).toEqual(['gebaeude', 'optimal', 'trafo']);
  });

  it('bemisst mit der gleichzeitigen Spitze der Lastgänge', () => {
    const n = netz();
    // G1 Spitze tags, G2 Spitze nachts → gemeinsam nie 70 kW
    const profil = id => (id === 1 ? [40, 0] : id === 2 ? [0, 30] : null);
    const r = notstromPlatzierung({ ...n, profil, strategie: 'trafo' });
    // 40 (G1/G2 zeitversetzt) + 50 (G4 ohne Lastgang, 50 %)
    expect(r.aggregate.find(a => a.id === 't1').peakKw).toBe(90);
  });

  it('trennt Lasten, die auf dem Weg zu einem A/B-Gebäude liegen, an Ort und Stelle', () => {
    const n = netz();
    n.assets.push({ id: 'w', type: 'Verbraucher', name: 'Werkstatt', lastKw: 35 });
    n.kanten.push({ id: 'x1', u: 't2', v: 'w' }, { id: 'x2', u: 'w', v: 8 });
    n.gebaeude.push({ id: 8, name: 'G8', notstrom: { klasse: 'A' } });
    n.kwJeGebaeude.set(8, 100);
    const r = notstromPlatzierung({ ...n, strategie: 'trafo' });
    const lokal = r.abgaenge.find(a => a.lokal);
    expect(lokal).toMatchObject({ vonId: 'w', kanteId: null, lastKw: 35 });
  });
});

// ── Schritt 3: Liegenschafts-Insel ──────────────────────────────────────────
describe('inselAggregate', () => {
  it('wählt die nächste Standardgröße', () => {
    expect(inselAggregate(900)).toEqual({ anzahl: 1, kvaJe: 1000, kvaGesamt: 1000 });
  });
  it('teilt große Leistungen auf gleiche Einheiten und ergänzt N+1', () => {
    expect(inselAggregate(3000)).toEqual({ anzahl: 2, kvaJe: 1500, kvaGesamt: 3000 });
    expect(inselAggregate(3000, true)).toEqual({ anzahl: 3, kvaJe: 1500, kvaGesamt: 4500 });
    expect(inselAggregate(0).anzahl).toBe(0);
  });
});

describe('maxFensterEnergie', () => {
  it('findet das energiereichste Fenster, auch über den Jahreswechsel', () => {
    expect(maxFensterEnergie([1, 5, 5, 1], 2)).toBe(10);
    expect(maxFensterEnergie([5, 1, 1, 5], 2)).toBe(10);
    expect(maxFensterEnergie([], 24)).toBe(0);
  });
});

describe('inselZuschaltstufen', () => {
  it('packt Trafos unter die kVA-Grenze und meldet zu große', () => {
    const t = [{ name: 'T630', kva: 630 }, { name: 'T400', kva: 400 }, { name: 'Ta', kva: 250 }, { name: 'Tb', kva: 250 }];
    const r = inselZuschaltstufen(t, 1000, 10000);
    expect(r.kvaGrenze).toBe(500);
    expect(r.zuGross.map(x => x.name)).toEqual(['T630']);
    expect(r.stufen.map(s => s.trafos.map(x => x.name))).toEqual([['T630'], ['T400'], ['Ta', 'Tb']]);
  });
  it('begrenzt zusätzlich den Lastsprung', () => {
    const t = [{ name: 'a', kva: 100, lastKw: 250 }, { name: 'b', kva: 100, lastKw: 250 }];
    expect(inselZuschaltstufen(t, 1000, 1000).stufen).toHaveLength(2);   // Grenze 400 kW
  });
});

describe('inselMsKennwerte', () => {
  it('schätzt Kurzschluss-, Erdschluss- und Blindleistungskennwerte', () => {
    const r = inselMsKennwerte({ sAggKva: 1000, sMtKva: 1000, uKv: 20, msKabelKm: 1, groessterTrafoKva: 630 });
    expect(r.inMsA).toBeCloseTo(28.87, 1);
    expect(r.ikSubA).toBeCloseTo(28.87 / 0.21, 0);
    expect(r.ikDauerA).toBeCloseTo(86.6, 0);
    expect(r.icA).toBeCloseTo(3.26, 1);
    expect(r.qcKvar).toBeCloseTo(37.7, 0);
    expect(r.iGrossA).toBeCloseTo(145.5, 0);
  });
});

describe('liegenschaftsInsel', () => {
  const basis = () => ({
    profil: [200, 800, 600, 300],
    anteilPct: 50, dauerH: 2, jahr: 2026,
    abSpitzeKw: 150,
    trafos: [
      { id: 't1', name: 'T1', kva: 630, spitzeKw: 300, abKw: 150, nsAbgaenge: [{ zuName: 'Halle', lastKw: 100 }] },
      { id: 't2', name: 'T2', kva: 250, spitzeKw: 100, abKw: 0 },
      { id: 't3', name: 'T3', kva: 400, spitzeKw: 400, abKw: 0 },
    ],
    netz: { spannungKV: 20, msKabelM: 2000,
            schaltanlagen: [{ id: 'nap', name: 'NAP', type: 'NAP', baujahr: 1995 },
                            { id: 'sa', name: 'SA 1', type: 'Schaltanlage', baujahr: 2020 }] },
  });

  it('versorgt die A/B-Stationen und füllt das Ziel mit weiteren auf', () => {
    const r = liegenschaftsInsel(basis());
    expect(r.spitzeKw).toBe(800);
    expect(r.zielKw).toBe(400);
    expect(r.lastabwurf.versorgt.map(t => t.id)).toEqual(['t1', 't2']);
    expect(r.lastabwurf.abschalten.map(t => t.id)).toEqual(['t3']);
    expect(r.lastabwurf.nsAbwurf).toHaveLength(0);
  });

  it('bemisst Aggregat, Maschinentrafo und Tank', () => {
    const r = liegenschaftsInsel(basis());
    // 400 kW × 1,2 / 0,8 = 600 kVA → 630 kVA
    expect(r.aggregate).toMatchObject({ anzahl: 1, kvaJe: 630, sBedarfKva: 600 });
    expect(r.maschinentrafoKva).toBe(630);
    // Fenster 800+600 = 1400 kWh × 50 % = 700 kWh × 0,28 × 1,1 × 1,15 = 247,9 → 300 l
    expect(r.energieKwh).toBe(700);
    expect(r.liter).toBe(300);
  });

  it('wirft NS-seitig ab und bemisst mindestens auf die A/B-Last, wenn das Ziel zu klein ist', () => {
    const b = basis();
    b.anteilPct = 25;                                  // Ziel 200 kW < 300 kW an T1
    b.abSpitzeKw = 250;
    const r = liegenschaftsInsel(b);
    expect(r.abReichtNicht).toBe(true);
    expect(r.bemessungKw).toBe(250);
    expect(r.lastabwurf.nsAbwurf.map(a => a.zuName)).toEqual(['Halle']);
    expect(r.lastabwurf.versorgtKw).toBe(250);         // max(250, 300 − 100)
    // T1 wird nach dem NS-Abwurf mit max(150, 300 − 100) = 200 kW zugeschaltet
    expect(r.lastabwurf.versorgt.find(t => t.id === 't1').lastKw).toBe(200);
    expect(r.checkliste.find(c => c.id === 'nsabwurf')).toBeTruthy();
  });

  it('leitet den Schutzstatus aus dem Alter ab und übernimmt Überschreibungen', () => {
    const r = liegenschaftsInsel(basis());
    const nap = r.checkliste.find(c => c.id === 'schutz:nap');
    expect(nap).toMatchObject({ status: 'erneuern', kosten: 15000 });
    const b = basis();
    b.bewertung = { 'schutz:nap': 'ok' };
    const r2 = liegenschaftsInsel(b);
    expect(r2.checkliste.find(c => c.id === 'schutz:nap')).toMatchObject({ status: 'ok', auto: 'erneuern', kosten: 0 });
    expect(r2.kosten).toBe(r.kosten - 15000);
  });

  it('kommt ohne Lastgang mit einer Spitze aus', () => {
    const b = basis();
    b.profil = null;
    b.spitzeKw = 1000;
    const r = liegenschaftsInsel(b);
    expect(r.zielKw).toBe(500);
    expect(r.energieKwh).toBe(1000);
  });
});

// ── Schritt 4: Wärme ────────────────────────────────────────────────────────
describe('maxFensterStart', () => {
  it('liefert den Beginn des energiereichsten Fensters, auch über den Jahreswechsel', () => {
    expect(maxFensterStart([100, 300, 300, 100], 2)).toBe(1);
    expect(maxFensterStart([300, 100, 100, 300], 2)).toBe(3);
  });
});

describe('waermeErzeugerStatus', () => {
  const erz = [{ key: 'gaskessel', label: 'Gas', kw: 200 }, { key: 'lwwp', label: 'WP', kw: 100 },
               { key: 'fernwaerme', label: 'FW', kw: 80 }, { key: 'pellets', label: 'Pellets', kw: 50 }];
  it('ohne Notstrom fällt alles aus', () => {
    expect(waermeErzeugerStatus(erz, 'strom', false).every(e => !e.verfuegbar)).toBe(true);
  });
  it('mit Notstrom hängt es am Energieträger', () => {
    const v = s => waermeErzeugerStatus(erz, s, true).filter(e => e.verfuegbar).map(e => e.key);
    expect(v('strom')).toEqual(['gaskessel', 'fernwaerme', 'pellets']);
    expect(v('strom-gas')).toEqual(['fernwaerme', 'pellets']);
    expect(v('total')).toEqual(['pellets']);
  });
});

describe('waermeBlackout', () => {
  const basis = () => ({
    last: [100, 300, 300, 100], dauerH: 2, szenario: 'total', mitNea: true,
    erzeuger: [{ key: 'pellets', label: 'Pellets', kw: 50 }, { key: 'gaskessel', label: 'Gas', kw: 200 },
               { key: 'lwwp', label: 'WP', kw: 100 }],
    zweistoffKw: 200, tankL: 20,
  });

  it('rechnet Leistungs- und Energiedeckung mit begrenztem Heizöllager', () => {
    const r = waermeBlackout(basis());
    expect(r.kwJeTraeger).toMatchObject({ fest: 50, gas: 0, oel: 200 });
    expect(r.kapazitaetKw).toBe(250);
    expect(r.deckungLeistungPct).toBeCloseTo(250 / 3, 5);
    // Stunde 1: 50 + 180 (Lager leer) · Stunde 2: nur 50 → 280 von 600 kWh
    expect(r.deckungEnergiePct).toBeCloseTo(280 / 6, 5);
    expect(r.stundenUngedeckt).toBe(2);
    expect(r.reichweiteH).toBe(1);
  });

  it('empfiehlt das Lager für die volle Dauer und bemisst das Aggregat der Heizzentrale', () => {
    const r = waermeBlackout(basis());
    // 400 kWh / 0,9 / 10 = 44,4 l × 1,15 → 100 l
    expect(r.tankEmpfehlungL).toBe(100);
    expect(r.tankFehltL).toBe(80);
    // 2 % von 250 kW = 5 kW → × 1,2 → 10 kW
    expect(r.hilfsKw).toBe(5);
    expect(r.neaKw).toBe(10);
    expect(r.kosten).toEqual({ nea: 24500, zweistoff: 19000, tank: 120 });
  });

  it('ohne Notstromaggregat ist die Deckung null — auch der Puffer steht', () => {
    const b = basis();
    b.mitNea = false;
    b.puffer = { kapKwh: 1000, entladeKw: 500 };
    const r = waermeBlackout(b);
    expect(r.kapazitaetKw).toBe(0);
    expect(r.deckungEnergiePct).toBe(0);
    expect(r.neaKw).toBe(0);
  });

  it('bei reinem Stromausfall läuft der Gaskessel, der Zweistoffbrenner zählt nicht doppelt', () => {
    const b = basis();
    b.szenario = 'strom';
    const r = waermeBlackout(b);
    expect(r.kwJeTraeger).toMatchObject({ fest: 50, gas: 200, oel: 0 });
    expect(r.erzeuger.some(e => e.key === 'zweistoff')).toBe(false);
    expect(r.deckungEnergiePct).toBeCloseTo(500 / 6, 5);
    expect(r.reichweiteH).toBeNull();
  });

  it('der Puffer deckt Spitzen, wenn das Aggregat läuft', () => {
    const b = basis();
    b.tankL = 0;                                         // Lager unbekannt → unbegrenzt
    b.puffer = { kapKwh: 100, entladeKw: 50 };
    const r = waermeBlackout(b);
    expect(r.deckungEnergiePct).toBeCloseTo(600 / 6, 5);  // 250 + 50 Puffer, 250 + 50 Puffer
    expect(r.reichweiteH).toBeNull();
  });

  it('nimmt einen festen Hilfsenergiewert statt des Prozentansatzes', () => {
    const b = basis();
    b.hilfsKw = 22;
    expect(waermeBlackout(b).neaKw).toBe(30);
  });
});

// ── Aufräumen: vorhandene Aggregate anrechnen ───────────────────────────────
describe('Bestandsaggregate in der Platzierung', () => {
  it('neaKostenMitBestand: nichts, Erweiterung oder Neubau', () => {
    expect(neaKostenMitBestand(100, 'knoten', 150)).toBe(0);
    expect(neaKostenMitBestand(100, 'knoten', 60)).toBe(NEA_KOSTEN.fixEur + 40 * NEA_KOSTEN.eurProKw);
    expect(neaKostenMitBestand(100, 'knoten', 0)).toBe(neaKosten(100, 'knoten'));
  });

  it('rechnet Aggregate am Knoten und am Gebäude an', () => {
    const n = netz();
    n.assets.push({ id: 'nsa1', type: 'Nsa', name: 'NEA Bestand T1', neaKw: 300 },
                  { id: 'nsa5', type: 'Nsa', name: 'NEA G5', buildingId: 5, neaKw: 10 },
                  { id: 'nsaX', type: 'Nsa', name: 'irgendwo', neaKw: 50 });
    n.kanten.push({ id: 'x1', u: 't1', v: 'nsa1' });
    const r = notstromPlatzierung({ ...n, strategie: 'trafo' });
    const t1 = r.aggregate.find(a => a.id === 't1');
    expect(t1).toMatchObject({ bestandKw: 300, zusatzKw: 0, kosten: 2 * NEA_KOSTEN.abgangEur });
    const g5 = r.aggregate.find(a => a.id === 't2');
    expect(g5).toMatchObject({ empfKw: 25, bestandKw: 0 });   // G5-Aggregat hängt am Gebäude, nicht am Trafo
    const optimal = notstromPlatzierung({ ...n, strategie: 'optimal' });
    expect(optimal.aggregate.find(a => a.id === 5)).toMatchObject({ bestandKw: 10, zusatzKw: 15,
      kosten: NEA_KOSTEN.fixEur + 15 * NEA_KOSTEN.eurProKw });
    expect(r.bestandOhneOrt.map(b => b.id)).toEqual(['nsaX']);
  });

  it('das Aggregat am Knoten macht die Knotenlösung zur günstigsten', () => {
    const n = netz();
    n.assets.push({ id: 'nsa1', type: 'Nsa', neaKw: 300 });
    n.kanten.push({ id: 'x1', u: 'k1', v: 'nsa1' });
    const r = notstromPlatzierung({ ...n, strategie: 'optimal' });
    // KVS 1 trägt G1+G2 (70 kW → 85 kW) aus dem Bestand; G4 bleibt eigenständig
    expect(r.aggregate.find(a => a.id === 'k1')).toMatchObject({ bestandKw: 300, zusatzKw: 0 });
  });
});

// ── Schritt 5: Schutzziele ──────────────────────────────────────────────────
describe('normalisiereZiele', () => {
  it('liefert ohne Liste die Vorgaben', () => {
    expect(normalisiereZiele(undefined).map(z => z.id)).toEqual(ZIEL_VORGABEN.map(z => z.id));
  });
  it('begrenzt Werte und macht Kennungen eindeutig', () => {
    const z = normalisiereZiele([{ id: 'a', strom: 'x', anteilPct: 300, dauerH: -1, waerme: false }, { id: 'a', name: ' ' }]);
    expect(z[0]).toMatchObject({ id: 'a', strom: 'A', anteilPct: 100, dauerH: 1, waerme: false });
    expect(z[1]).toMatchObject({ id: 'a_', name: 'Schutzziel 2', waerme: true });
    expect(normalisiereZiele([])).toEqual([]);
  });
});

describe('zielGebaeude / zielKraftstoffL', () => {
  const geb = [{ id: 1, notstrom: { klasse: 'A' } }, { id: 2, notstrom: { klasse: 'B' } }, { id: 3, notstrom: { klasse: 'C' } }];
  it('Stufe A lässt die B-Gebäude weg, AB behält alle', () => {
    expect(zielGebaeude(geb, 'A').map(g => g.notstrom?.klasse ?? null)).toEqual(['A', null, 'C']);
    expect(zielGebaeude(geb, 'AB').map(g => g.notstrom.klasse)).toEqual(['A', 'B', 'C']);
  });
  it('Kraftstoff: Spitze × Dauer × Auslastung × Verbrauch × Zuschlag', () => {
    expect(zielKraftstoffL(100, 72)).toBe(1400);   // 1.391 l aufgerundet
    expect(zielKraftstoffL(0, 72)).toBe(0);
  });
});

describe('bewerteZiel / resilienzZielMatrix', () => {
  const waerme = voll => waermeBlackout({
    last: [100, 100], dauerH: 2, szenario: 'total', mitNea: true,
    erzeuger: [{ key: 'pellets', label: 'Pellets', kw: voll ? 150 : 50 }],
  });

  it('Stufe A: Platzierung ohne die B-Gebäude, Kraftstoff dazu', () => {
    const n = netz();
    const platz = notstromPlatzierungVergleich({ ...n, gebaeude: zielGebaeude(n.gebaeude, 'A') });
    const ziel = normalisiereZiele([{ id: 'z', strom: 'A', dauerH: 72, waerme: false }])[0];
    const b = bewerteZiel({ ziel, platz });
    expect(b.status).toBe('erfuellt');
    expect(b.strom.art).toBe('gebaeude');
    const alle = platz.varianten[platz.empfohlen].aggregate.flatMap(a => a.gebaeude);
    expect(alle).not.toContain(4);
    expect(b.kosten).toBe(platz.varianten[platz.empfohlen].summe.kosten + b.strom.liter * 1.5);
  });

  it('ohne eingestufte Gebäude fehlen Daten', () => {
    const n = netz();
    const platz = notstromPlatzierungVergleich({ ...n, gebaeude: zielGebaeude(n.gebaeude, 'keine') });
    const b = bewerteZiel({ ziel: normalisiereZiele([{ strom: 'AB', waerme: false }])[0], platz });
    expect(b.status).toBe('offen');
    expect(b.gruende[0]).toMatch(/keine Gebäude/);
  });

  it('Wärme unter Vollversorgung macht das Ziel teilweise', () => {
    const ziel = normalisiereZiele([{ strom: 'keine', waerme: true }])[0];
    expect(bewerteZiel({ ziel, waerme: waerme(true) }).status).toBe('erfuellt');
    const b = bewerteZiel({ ziel, waerme: waerme(false) });
    expect(b.status).toBe('teilweise');
    expect(b.gruende).toContain('Wärme nur zu 50 % gedeckt');
    expect(bewerteZiel({ ziel }).status).toBe('offen');
  });

  it('Insel-Ziel übernimmt Aggregat, Maschinentrafo und Kosten', () => {
    const insel = liegenschaftsInsel({
      profil: [400, 800], anteilPct: 50, dauerH: 2, jahr: 2026,
      trafos: [{ id: 't', name: 'T', kva: 400, spitzeKw: 300, abKw: 0 }], netz: {},
    });
    const b = bewerteZiel({ ziel: normalisiereZiele([{ strom: 'insel', anteilPct: 50, waerme: false }])[0], insel });
    expect(b.strom).toMatchObject({ art: 'insel', anzahl: 1, kvaJe: 630, mtKva: 630 });
    expect(b.kosten).toBe(insel.kosten);
  });

  it('die Matrix stellt die Ziele nebeneinander', () => {
    const n = netz();
    const zA = normalisiereZiele([{ name: 'Kritisch', strom: 'A', dauerH: 72 }])[0];
    const zW = normalisiereZiele([{ name: 'Nur Wärme', strom: 'keine', dauerH: 24 }])[0];
    const m = resilienzZielMatrix([
      bewerteZiel({ ziel: zA, platz: notstromPlatzierungVergleich({ ...n, gebaeude: zielGebaeude(n.gebaeude, 'A') }), waerme: waerme(true) }),
      bewerteZiel({ ziel: zW, waerme: waerme(false) }),
    ]);
    expect(m.spalten).toEqual(['Kritisch', 'Nur Wärme']);
    const zeile = l => m.zeilen.find(z => z.label === l).werte;
    expect(zeile('Dauer')).toEqual(['3 Tage', '24 h']);
    expect(zeile('Notstromaggregate')[1]).toBe('—');
    expect(zeile('Wärmedeckung')).toEqual(['100 %', '50 %']);
    expect(m.zeilen.find(z => z.label === 'Investition (Richtwert)').highlight).toBe(true);
    expect(zeile('Bewertung')[1]).toMatch(/^teilweise — Wärme nur zu 50 %/);
  });
});
