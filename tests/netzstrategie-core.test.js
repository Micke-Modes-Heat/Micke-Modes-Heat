// Vitest-Tests für lib/netzstrategie-core.js — Anschlusswege je Flächengruppe,
// Strategie-Bewertung, Optimierung, Pareto, Robustheit.
import { describe, it, expect } from 'vitest';
import {
  nsDistanzM, nsGruppieren, nsKostenMischen, nsTrafoGroesse, nsOptionen, nsStrategieEingabe,
  nsBewerten, nsEnergie, nsWirtschaft, nsZielwert, nsOptimieren, nsPareto, nsRobustheit, nsBreakEven,
  NS_KOSTEN_STANDARD,
} from '../src/lib/netzstrategie-core.js';
import { pvnaFuellen } from '../src/lib/pv-netzaufnahme-core.js';

// ~ 0,0009° Breite ≈ 100 m
const P = (dLatM, dLngM = 0) => ({ lat: 51 + dLatM / 111195, lng: 10 + dLngM / (111195 * Math.cos(51 * Math.PI / 180)) });

// Einfaches Kabelmodell für die Tests: 150 kW je Strang, ΔU 0,001 %/kW je 100 m
const kabelNeu = (pKw, L, duZiel) => {
  for (let n = 1; n <= 4; n++) {
    const du = 0.001 * L / 100 / n;
    if (n * 150 >= pKw && du * pKw <= duZiel) return { kapKw: n * 150, duProKwPct: du, eurM: 20 * n, text: `${n}×test` };
  }
  return null;
};

// Bestand: Trafo T (360 kW) — Kabel K (100 kW) — Dach alt1 (Bestand, 200 kWp)
// Neubau-Gruppe: n1, n2 (je 150 kWp) 300 m nördlich, nicht angebunden
// Schaltanlage S 50 m südlich des Trafos
const basis = () => ({
  elemente: [
    { id: 'T', typ: 'trafo', parentId: null, kapKw: 360, duProKwPct: 0, vorlastKw: 0 },
    { id: 'K', typ: 'kabel', parentId: 'T', kapKw: 100, duProKwPct: 0, vorlastKw: 0,
      massnahme: { label: 'K verstärken', investEUR: 20000, kapKw: 300, duProKwPct: 0 } },
  ],
  daecher: [
    { id: 'alt1', elementId: 'K', kwpMax: 200, ertragFaktor: 1, einspFaktor: 0.8 },
    { id: 'n1', elementId: null, kwpMax: 150, ertragFaktor: 1, einspFaktor: 0.8 },
    { id: 'n2', elementId: null, kwpMax: 150, ertragFaktor: 1, einspFaktor: 0.8 },
  ],
  pruefpunkte: [], duGrenzePct: 3,
});
const ctx = () => ({
  eingabe: basis(),
  dachPos: new Map([['alt1', P(20)], ['n1', P(300)], ['n2', P(320, 20)]]),
  elPos: new Map([['T', P(0)], ['K', P(20)]]),
  msPunkte: [{ id: 'S', typ: 'Schaltanlage', name: 'Schaltanlage', pos: P(-50) }, { id: 'Tr', typ: 'Trafo', name: 'Trafo', pos: P(0) }],
  kabelNeu, kosten: nsKostenMischen({}), duGrenzePct: 3,
});
const flach = () => { const a = new Float32Array(8760); a.fill(1 / 8760); return a; };
const ectx = (extra = {}) => ({ formen: { sued: flach(), ostwest: flach() }, spezSued: 1000, ostwest: new Map(), lastH: null, napKw: null, ...extra });
const preise = { pStrom: 30, pEinsp: 8, pvInvestPerKwp: 1000, zins: 0.03, pvLife: 20, ihPv: 0.01, netzLife: 40 };

describe('Geometrie und Katalog', () => {
  it('misst Luftlinien', () => {
    expect(nsDistanzM(P(0), P(100))).toBeCloseTo(100, 0);
    expect(nsDistanzM(P(0), null)).toBe(Infinity);
  });
  it('gruppiert über Nachbarketten', () => {
    const g = nsGruppieren([{ id: 'a', pos: P(0) }, { id: 'b', pos: P(90) }, { id: 'c', pos: P(180) }, { id: 'd', pos: P(600) }, { id: 'e', pos: null }], 100);
    expect(g).toEqual([['a', 'b', 'c'], ['d'], ['e']]);
  });
  it('mischt den Kostenkatalog mit gültigen Projektwerten', () => {
    const k = nsKostenMischen({ kvsEur: 9000, tiefbauNsEurM: 'x', msSchaltfeldEur: -5 });
    expect(k.kvsEur).toBe(9000);
    expect(k.tiefbauNsEurM).toBe(NS_KOSTEN_STANDARD.tiefbauNsEurM.wert);
    expect(k.msSchaltfeldEur).toBe(NS_KOSTEN_STANDARD.msSchaltfeldEur.wert);
  });
  it('wählt die kleinste passende Trafogröße', () => {
    expect(nsTrafoGroesse(240)).toBe(400);
    expect(nsTrafoGroesse(5000)).toBeNull();
  });
});

describe('nsOptionen', () => {
  it('bietet für eine Neubau-Gruppe alle Wege an — A mit Hausanschlüssen, B über das vorgelagerte Kabel', () => {
    const o = nsOptionen({ id: 'g1', daecher: ['n1', 'n2'] }, ctx());
    expect(o.map(x => x.id)).toEqual(['0', 'A', 'A~', 'B', 'C', 'D', 'E']);
    expect(o.find(x => x.id === 'B').massnahmen).toEqual(['K']);   // Hausanschlüsse hängen hinter K
    const a = o.find(x => x.id === 'A');
    expect(a.patch.neu).toHaveLength(2);
    expect(a.patch.umhaengen.n1).toBe('N:g1:HA:n1');
    const e = o.find(x => x.id === 'E');
    expect(e.machbar).toBe(true);
    expect(e.posten.some(p => p.label.includes('Abgangsfeld'))).toBe(true);
    expect(e.patch.neu[0]).toMatchObject({ typ: 'trafo', parentId: null });
    expect(o.find(x => x.id === 'D').posten.some(p => p.label.includes('Ring'))).toBe(true);
  });
  it('bietet B nur an, wenn auf dem Weg eine Ertüchtigung liegt', () => {
    const o = nsOptionen({ id: 'g0', daecher: ['alt1'] }, ctx());
    const b = o.find(x => x.id === 'B');
    expect(b.massnahmen).toEqual(['K']);
    expect(o.find(x => x.id === 'A').investEUR).toBe(0);         // schon angebunden
  });
});

describe('Bewertung', () => {
  const setup = () => {
    const c = ctx();
    const gruppen = [{ id: 'g0', daecher: ['alt1'] }, { id: 'g1', daecher: ['n1', 'n2'] }];
    return { c, optionen: gruppen.map(g => nsOptionen(g, c)) };
  };
  const idx = (optionen, g, id) => optionen[g].findIndex(o => o.id === id);

  it('Bestand A begrenzt durch Kabel K, Ertüchtigung B hebt die Grenze und kostet die Maßnahme', () => {
    const { c, optionen } = setup();
    const wA = [idx(optionen, 0, 'A'), idx(optionen, 1, '0')];
    const rA = nsBewerten(c.eingabe, optionen, wA, ectx(), preise);
    expect(rA.energie.kwpNetz).toBeCloseTo(125);                  // 100 kW / 0,8
    const wB = [idx(optionen, 0, 'B'), idx(optionen, 1, '0')];
    const rB = nsBewerten(c.eingabe, optionen, wB, ectx(), preise);
    expect(rB.energie.kwpNetz).toBeCloseTo(200);
    expect(rB.investMassEUR).toBe(20000);
  });

  it('Erzeugungsnetz schließt die Neubau-Gruppe voll an, ohne das Bestandsnetz zu belasten', () => {
    const { c, optionen } = setup();
    const w = [idx(optionen, 0, 'A'), idx(optionen, 1, 'E')];
    const st = nsStrategieEingabe(c.eingabe, optionen, w);
    const f = pvnaFuellen(st.eingabe);
    expect(f.daecher.find(d => d.id === 'n1').kwp).toBeCloseTo(150);
    expect(f.daecher.find(d => d.id === 'alt1').kwp).toBeCloseTo(125);
  });

  it('A~ baut voll und regelt auf die Netzgrenze ab', () => {
    const { c, optionen } = setup();
    const r = nsBewerten(c.eingabe, optionen, [idx(optionen, 0, 'A~'), idx(optionen, 1, '0')], ectx(), preise);
    expect(r.energie.kwp).toBeCloseTo(200);
    // flaches Profil: 200 kWp × 1000 kWh/kWp / 8760 h ≈ 22,8 kW je Stunde < 100 kW Grenze → keine Abregelung
    expect(r.energie.abgeregeltDachMwh).toBeCloseTo(0);
  });

  it('rechnet Eigenverbrauch und Abregelung am NAP stündlich', () => {
    const e = { daecher: [{ id: 'x', kwpMax: 876, ertragFaktor: 1, einspFaktor: 1 }] };
    const fuell = { daecher: [{ id: 'x', kwp: 876 }] };
    const last = new Float32Array(8760).fill(50);
    const r = nsEnergie(fuell, e, new Set(), ectx({ lastH: last, napKw: 30 }));
    // 876 kWp × 1000 / 8760 = 100 kW je Stunde → 50 Eigenverbrauch, 30 Einspeisung, 20 abgeregelt
    expect(r.eigenMwh).toBeCloseTo(438, 0);
    expect(r.einspMwh).toBeCloseTo(262.8, 0);
    expect(r.abgeregeltNapMwh).toBeCloseTo(175.2, 0);
    expect(r.rueckspeiseSpitzeKw).toBeCloseTo(50);
    const w = nsWirtschaft(r, 0, preise);
    expect(w.erloes).toBeCloseTo(438 * 300 + 262.8 * 80, -1);
  });
});

describe('Optimierung', () => {
  it('Aufzählung und lokale Suche finden dasselbe Optimum', () => {
    const c = ctx();
    const gruppen = [{ id: 'g0', daecher: ['alt1'] }, { id: 'g1', daecher: ['n1', 'n2'] }];
    const optionen = gruppen.map(g => nsOptionen(g, c));
    const bewerte = w => { const r = nsBewerten(c.eingabe, optionen, w, ectx({ lastH: new Float32Array(8760).fill(80) }), preise); r.zielwert = nsZielwert(r, { art: 'wirtschaft' }); return r; };
    const nOpt = optionen.map(l => l.length);
    const voll = nsOptimieren({ nOpt, bewerte });
    const lokal = nsOptimieren({ nOpt, bewerte, maxKombi: 1 });
    expect(voll.methode).toBe('vollständig');
    expect(voll.bewertungen).toBe(nOpt[0] * nOpt[1]);
    expect(lokal.methode).toBe('lokale Suche');
    expect(lokal.beste.zielwert).toBeCloseTo(voll.beste.zielwert, 3);
  });

  it('Budget-Ziel hält das Netz-Budget ein', () => {
    const c = ctx();
    const optionen = [{ id: 'g0', daecher: ['alt1'] }, { id: 'g1', daecher: ['n1', 'n2'] }].map(g => nsOptionen(g, c));
    const bewerte = w => { const r = nsBewerten(c.eingabe, optionen, w, ectx(), preise); r.zielwert = nsZielwert(r, { art: 'budget', budgetEUR: 25000 }); return r; };
    const { beste } = nsOptimieren({ nOpt: optionen.map(l => l.length), bewerte });
    expect(beste.investEUR).toBeLessThanOrEqual(25000);
    expect(beste.energie.nutzbarMwh).toBeGreaterThan(0);
  });
});

describe('Pareto, Robustheit, Break-even', () => {
  it('Pareto-Front behält nur nicht dominierte Punkte', () => {
    const pts = [{ x: 0, y: 10 }, { x: 5, y: 8 }, { x: 5, y: 20 }, { x: 9, y: 20 }, { x: 12, y: 30 }];
    expect(nsPareto(pts, p => [p.x, p.y])).toEqual([{ x: 0, y: 10 }, { x: 5, y: 20 }, { x: 12, y: 30 }]);
  });
  it('empfiehlt die Kandidatin mit dem geringsten maximalen Bedauern', () => {
    const e = (eig, eins, kwp) => ({ eigenMwh: eig, einspMwh: eins, kwp, nutzbarMwh: eig + eins });
    const k1 = { energie: e(100, 0, 100), investEUR: 0 };       // gut bei hohem Strompreis
    const k2 = { energie: e(100, 400, 400), investEUR: 150000 }; // viel Einspeisung, teures Netz
    const r = nsRobustheit([k1, k2], preise);
    expect(r.tabelle).toHaveLength(2);
    expect(r.empfehlung.maxBedauern).toBe(Math.min(...r.tabelle.map(t => t.maxBedauern)));
  });
  it('Break-even nur, wenn der Bestandsweg je kWp teurer ist', () => {
    expect(nsBreakEven(100000, 100, 500)).toBeCloseTo(250);
    expect(nsBreakEven(100000, 500, 400)).toBeNull();
  });
});
