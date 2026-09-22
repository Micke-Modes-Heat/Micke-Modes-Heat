// Vitest-Tests für lib/pv-bestand-ausbau.js — PV-Ausbau gegen die Bestandsgrenzen.
import { describe, it, expect } from 'vitest';
import {
  bestandsGrenzen, auslastung, ertuechtigung, ausbauStand, kwpBeiRueck, ausbauTreppe, AUSLASTUNG_ENG,
  ausbauReihenfolge, trafoBelastung, beschlussReife, neubauAuslegung, naechsteTrafoStufe, annuitaet,
} from '../src/lib/pv-bestand-ausbau.js';
import { SCHWELLEN_KOSTEN, TRAFO_RUECK_FAKTOR } from '../src/lib/netz-schwellen.js';

// Trafo 400 kVA → 360 kW · NAP 500 kW · Δu 3 % von 20 MVA → 600 kW
const GRENZEN = () => bestandsGrenzen({ trafoKva: 400, napKw: 500, skKva: 20000, uBudgetPct: 3 });

// Lineare Kurve: 0,8 kW Rückspeisung je kWp, 20 kW Grundlast abgezogen
const KURVE = Array.from({ length: 21 }, (_, i) => {
  const kwp = i * 50;
  return { kwp, rueckKw: Math.max(0, kwp * 0.8 - 20) };
});

describe('bestandsGrenzen', () => {
  it('sortiert nach tragbarer Leistung und rechnet den Trafo rückwärts', () => {
    const g = GRENZEN();
    expect(g.map(x => x.id)).toEqual(['trafo', 'nap', 'du']);
    expect(g[0].kapKw).toBeCloseTo(400 * TRAFO_RUECK_FAKTOR);
    expect(g[2].kapKw).toBeCloseTo(600);
  });

  it('lässt unbekannte Grenzen weg statt sie zu erfinden', () => {
    expect(bestandsGrenzen({ napKw: null, trafoKva: 0, skKva: 0 })).toEqual([]);
    expect(bestandsGrenzen({ napKw: 300 }).map(x => x.id)).toEqual(['nap']);
  });
});

describe('auslastung und ertuechtigung', () => {
  const nap = { id: 'nap', kapKw: 500 };

  it('stuft frei / eng / über', () => {
    expect(auslastung(100, nap).stufe).toBe('frei');
    expect(auslastung(500 * AUSLASTUNG_ENG, nap).stufe).toBe('eng');
    expect(auslastung(500, nap).stufe).toBe('eng');
    expect(auslastung(501, nap).stufe).toBe('ueber');
    expect(auslastung(420, nap).reserveKw).toBe(80);
  });

  it('keine Maßnahme, solange die Grenze trägt', () => {
    expect(ertuechtigung(500, nap)).toBeNull();
  });

  it('bepreist die Überschreitung je Grenze', () => {
    expect(ertuechtigung(600, nap).kostenEUR).toBe(100 * SCHWELLEN_KOSTEN.napEurProKW);
    const trafo = GRENZEN()[0];
    const m = ertuechtigung(450, trafo);
    expect(m.kostenEUR).toBe(Math.round((450 / TRAFO_RUECK_FAKTOR - 400) * SCHWELLEN_KOSTEN.trafoEurProKVA));
    const du = GRENZEN()[2];
    expect(ertuechtigung(700, du).kostenEUR).toBe(100 * SCHWELLEN_KOSTEN.erzeugungsnetzEurProKW);
  });
});

describe('ausbauStand', () => {
  it('Bestand trägt: keine Wege, nächste Grenze mit Reserve', () => {
    const s = ausbauStand(200, GRENZEN());
    expect(s.stufe).toBe('frei');
    expect(s.guenstiger).toBeNull();
    expect(s.naechste.id).toBe('trafo');
    expect(s.wege.bestand.kostenEUR).toBe(0);
    expect(s.wege.hybrid.kostenEUR).toBe(0);
  });

  it('zwei gerissene Grenzen: Bestandsweg summiert, Hybrid nimmt nur den Rest', () => {
    const s = ausbauStand(550, GRENZEN());
    expect(s.stufe).toBe('ueber');
    expect(s.bindend.id).toBe('trafo');
    expect(s.wege.bestand.schritte.map(x => x.id)).toEqual(['trafo', 'nap']);
    const erwartetBestand = Math.round((550 / TRAFO_RUECK_FAKTOR - 400) * SCHWELLEN_KOSTEN.trafoEurProKVA)
                          + 50 * SCHWELLEN_KOSTEN.napEurProKW;
    expect(s.wege.bestand.kostenEUR).toBe(erwartetBestand);
    expect(s.wege.hybrid.restKw).toBeCloseTo(550 - 360);
    expect(s.guenstiger).toBe(s.wege.hybrid.kostenEUR < erwartetBestand ? 'hybrid' : 'bestand');
  });

  it('ohne bekannte Grenze bleibt alles frei', () => {
    const s = ausbauStand(10000, []);
    expect(s.stufe).toBe('frei');
    expect(s.wege.hybrid.tragKw).toBeNull();
  });
});

describe('kwpBeiRueck und ausbauTreppe', () => {
  it('interpoliert den Kipp-Punkt linear', () => {
    // 0,8·kWp − 20 = 360 → kWp = 475
    expect(kwpBeiRueck(KURVE, 360)).toBeCloseTo(475);
    expect(kwpBeiRueck(KURVE, 10000)).toBeNull();
    expect(kwpBeiRueck([], 1)).toBeNull();
  });

  it('liefert die Grenzen in der Reihenfolge, in der der Ausbau sie trifft', () => {
    const t = ausbauTreppe(KURVE, GRENZEN());
    expect(t.map(x => x.id)).toEqual(['trafo', 'nap', 'du']);
    expect(t[1].abKwp).toBeCloseTo(650);                 // NAP 500 kW
    expect(t[1].engAbKwp).toBeCloseTo((350 + 20) / 0.8); // 70 % von 500 kW
    expect(t[2].abKwp).toBeCloseTo(775);                 // Δu 600 kW
  });

  it('nie erreichte Grenzen stehen hinten', () => {
    const g = bestandsGrenzen({ trafoKva: 5000, napKw: 400 });
    const t = ausbauTreppe(KURVE, g);
    expect(t[0].id).toBe('nap');
    expect(t[1].abKwp).toBeNull();
  });
});

describe('Kartenansicht: Reihenfolge und Trafobelastung', () => {
  const anlagen = [
    { id: 'a', kwp: 50,  schicht: 'entscheidung' },
    { id: 'b', kwp: 200, schicht: 'entwicklung' },
    { id: 'c', kwp: 30,  schicht: 'bestand' },
    { id: 'd', kwp: 400, schicht: 'entscheidung' },
  ];

  it('Bestand zuerst, dann nach Modus', () => {
    expect(ausbauReihenfolge(anlagen, 'schicht').map(a => a.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(ausbauReihenfolge(anlagen, 'gross').map(a => a.id)).toEqual(['c', 'd', 'b', 'a']);
    expect(ausbauReihenfolge(anlagen, 'klein').map(a => a.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('verteilt die Spitze nach kWp, Unverkabeltes nach kVA', () => {
    const trafos = [{ id: 't1', kva: 400 }, { id: 't2', kva: 400 }];
    const gebaut = [{ kwp: 300, trafoId: 't1' }, { kwp: 100, trafoId: null }];
    const m = trafoBelastung(gebaut, trafos, 400);           // 1 kW je kWp
    expect(m.get('t1').rueckKw).toBeCloseTo(300 + 50);
    expect(m.get('t2').rueckKw).toBeCloseTo(50);
    expect(m.get('t2').geschaetztKw).toBeCloseTo(50);
    expect(m.get('t1').rueckKw + m.get('t2').rueckKw).toBeCloseTo(400);
    expect(m.get('t1').stufe).toBe('eng');                  // 350 von 360 kW
  });
});

describe('beschlussReife', () => {
  // 1 kW Rückspeisung je kWp; Trafo t1 250 kVA (225 kW), t2 630 kVA (567 kW)
  const trafos = [{ id: 't1', name: 'T1', kva: 250 }, { id: 't2', name: 'T2', kva: 630 }];
  const basis = {
    trafos, rueckBeiKwp: k => k, napKw: null, duKw: null,
    nutzenJeKwp: () => 60,           // 60 €/a je kWp, konstant
  };

  it('Bestand, Pflicht, dann A in die Reserve', () => {
    const r = beschlussReife({ ...basis, anlagen: [
      { id: 'b', kwp: 50,  trafoId: 't1', schicht: 'bestand' },
      { id: 'p', kwp: 100, trafoId: 't1', pflicht: true },
      { id: 'x', kwp: 60,  trafoId: 't1' },
      { id: 'y', kwp: 300, trafoId: 't2' },
    ] });
    expect(r.liste.map(l => [l.anlage.id, l.klasse])).toEqual([
      ['b', 'bestand'], ['p', 'pflicht'], ['y', 'A'], ['x', 'A'],
    ]);
    expect(r.massnahmen).toEqual([]);
  });

  it('B, wenn sich die Ertüchtigung über die Anlagen trägt, die sie nutzen', () => {
    const r = beschlussReife({ ...basis, anlagen: [
      { id: 'gross', kwp: 200, trafoId: 't1' },
      { id: 'mehr',  kwp: 100, trafoId: 't1' },
      { id: 'noch',  kwp: 60,  trafoId: 't1' },
    ] });
    const k = Object.fromEntries(r.liste.map(l => [l.anlage.id, l.klasse]));
    expect(k.gross).toBe('A');
    expect(k.mehr).toBe('B');
    expect(k.noch).toBe('B');                         // teilt sich die Ertüchtigung
    expect(r.massnahmen[0].neu).toBe(400);            // 300/0,9 = 333 → 400 kVA
    expect(r.summe.investEUR).toBe((400 - 250) * SCHWELLEN_KOSTEN.trafoEurProKVA);
  });

  it('C, wenn die Ertüchtigung den Nutzen übersteigt oder PV sich nicht rechnet', () => {
    const teuer = beschlussReife({ ...basis, nutzenJeKwp: () => 1, anlagen: [
      { id: 'a', kwp: 200, trafoId: 't1' }, { id: 'b', kwp: 100, trafoId: 't1' },
    ] });
    expect(teuer.liste.find(l => l.anlage.id === 'b').klasse).toBe('C');
    const nichts = beschlussReife({ ...basis, nutzenJeKwp: () => -5, anlagen: [{ id: 'a', kwp: 10, trafoId: 't2' }] });
    expect(nichts.liste[0].klasse).toBe('C');
    expect(nichts.liste[0].grund).toContain('rechnet sich nicht');
  });

  it('Pflicht erzwingt die Maßnahme auch am NAP', () => {
    const r = beschlussReife({ ...basis, napKw: 100, anlagen: [{ id: 'p', kwp: 150, trafoId: 't2', pflicht: true }] });
    expect(r.liste[0].klasse).toBe('pflicht');
    expect(r.massnahmen.map(m => m.art)).toEqual(['nap']);
  });
});

describe('neubauAuslegung', () => {
  const preis = kva => 10000 + 60 * kva;
  const basis = { heute: 2026, zins: 0.03, rueckBeiKwp: k => k, trafoPreis: preis };

  it('rechnet das Jahr der Überlastung aus dem Ausbaupfad und vergleicht mit dem Barwert', () => {
    const [t] = neubauAuslegung({ ...basis,
      trafos: [{ id: 'n', name: 'Neubau', kva: 250, neubau: true }],
      anlagen: [{ kwp: 150, trafoId: 'n', jahr: 2027 }, { kwp: 250, trafoId: 'n', jahr: 2031 }],
    });
    expect(t.jahrUeber).toBe(2031);                      // 400 kW > 225 kW
    expect(t.empfKva).toBe(630);                         // 400/0,9 = 444 → 630
    expect(t.mehrJetztEUR).toBe(preis(630) - preis(250));
    expect(t.barwertEUR).toBe(Math.round(preis(630) * 1.3 / Math.pow(1.03, 5)));
    expect(t.urteil).toBe('jetzt-groesser');
  });

  it('Bezug kann maßgeblich sein; ohne Größe gibt es eine Empfehlung', () => {
    const [t] = neubauAuslegung({ ...basis, gzf: 1,
      trafos: [{ id: 'n', kva: 0, neubau: true }],
      anlagen: [{ kwp: 50, trafoId: 'n', jahr: 2027 }],
      lasten: [{ kw: 500, trafoId: 'n', jahr: 2030 }],
    });
    expect(t.richtung).toBe('bezug');
    expect(t.urteil).toBe('dimensionieren');
    expect(t.empfKva).toBe(630);
  });

  it('Bestandstrafos werden nicht ausgelegt, passende Neubau-Trafos bleiben', () => {
    const r = neubauAuslegung({ ...basis,
      trafos: [{ id: 'b', kva: 400, neubau: false }, { id: 'n', kva: 630, neubau: true }],
      anlagen: [{ kwp: 100, trafoId: 'n', jahr: 2028 }],
    });
    expect(r.map(x => x.id)).toEqual(['n']);
    expect(r[0].urteil).toBe('passt');
  });

  it('Normstufe und Annuität', () => {
    expect(naechsteTrafoStufe(333)).toBe(400);
    expect(naechsteTrafoStufe(3100)).toBe(3500);
    expect(annuitaet(0, 20)).toBeCloseTo(0.05);
  });
});
