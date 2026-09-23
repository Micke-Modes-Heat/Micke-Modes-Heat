// Vitest-Tests für lib/pv-netzaufnahme-core.js — Befüllung des Bestandsnetzes
// mit PV und Ausbautreppe. Importfrei/DOM-frei → direkt als ESM importierbar.
import { describe, it, expect } from 'vitest';
import { pvnaFuellen, pvnaVollausbau, pvnaTreppe, pvnaAbregelung, pvnaLastfluss, pvnaSpielraum } from '../src/lib/pv-netzaufnahme-core.js';

// Trafo T (kap 100 kW) → Kabel K1 (kap 60 kW) → Dach A
//                      → Kabel K2 (kap 200 kW) → Dach B
const netz = () => ({
  elemente: [
    { id: 'T',  typ: 'trafo', parentId: null, kapKw: 100, duProKwPct: 0 },
    { id: 'K1', typ: 'kabel', parentId: 'T',  kapKw: 60,  duProKwPct: 0 },
    { id: 'K2', typ: 'kabel', parentId: 'T',  kapKw: 200, duProKwPct: 0 },
  ],
  daecher: [
    { id: 'A', elementId: 'K1', kwpMax: 100, ertragFaktor: 1.0, einspFaktor: 1 },
    { id: 'B', elementId: 'K2', kwpMax: 100, ertragFaktor: 0.9, einspFaktor: 1 },
  ],
});

describe('pvnaFuellen', () => {
  it('begrenzt jedes Dach durch das engste Element auf seinem Pfad', () => {
    const r = pvnaFuellen(netz());
    const a = r.daecher.find(d => d.id === 'A');
    const b = r.daecher.find(d => d.id === 'B');
    expect(a.kwp).toBeCloseTo(60);                  // Kabel K1
    expect(a.begrenzer).toEqual({ elementId: 'K1', art: 'strom' });
    expect(b.kwp).toBeCloseTo(40);                  // Rest am Trafo
    expect(b.begrenzer).toEqual({ elementId: 'T', art: 'trafo' });
    expect(r.summeKwp).toBeCloseTo(100);
    expect(r.potenzialKwp).toBe(200);
  });

  it('belegt das ertragsstärkere Dach zuerst', () => {
    const e = netz();
    e.daecher[1].ertragFaktor = 1.2;               // B jetzt besser
    const r = pvnaFuellen(e);
    expect(r.daecher.find(d => d.id === 'B').kwp).toBeCloseTo(100);
    expect(r.daecher.find(d => d.id === 'A').kwp).toBeCloseTo(0);
  });

  it('berücksichtigt den Einspeisefaktor kW je kWp', () => {
    const e = netz();
    e.daecher.forEach(d => { d.einspFaktor = 0.5; });
    const r = pvnaFuellen(e);
    // K1 trägt 60 kW → 120 kWp, aber Dach hat nur 100 kWp; Trafo 100 kW → 200 kWp gesamt
    expect(r.daecher.find(d => d.id === 'A').kwp).toBeCloseTo(100);
    expect(r.daecher.find(d => d.id === 'B').kwp).toBeCloseTo(100);
  });

  it('zieht Vorlast (vorhandene Einspeisung) von der Kapazität ab', () => {
    const e = netz();
    e.elemente[2].vorlastKw = 80;                  // z. B. KWK hinter K2 → belegt auch T
    const r = pvnaFuellen(e);
    expect(r.daecher.find(d => d.id === 'A').kwp).toBeCloseTo(20);
    expect(r.daecher.find(d => d.id === 'B').kwp).toBeCloseTo(0);
  });

  it('hält die Spannungsgrenze an allen Prüfpunkten ein', () => {
    // Strang: T → K1 (0,02 %/kW) → Dach A; K1 → K3 (0,03 %/kW) → Dach C
    const e = {
      elemente: [
        { id: 'T',  typ: 'trafo', parentId: null, kapKw: 1000, duProKwPct: 0 },
        { id: 'K1', typ: 'kabel', parentId: 'T',  kapKw: 1000, duProKwPct: 0.02 },
        { id: 'K3', typ: 'kabel', parentId: 'K1', kapKw: 1000, duProKwPct: 0.03 },
      ],
      daecher: [
        { id: 'A', elementId: 'K1', kwpMax: 500, ertragFaktor: 1, einspFaktor: 1 },
        { id: 'C', elementId: 'K3', kwpMax: 500, ertragFaktor: 1, einspFaktor: 1 },
      ],
      duGrenzePct: 3,
    };
    const r = pvnaFuellen(e);
    // A zuerst (ID-Reihenfolge bei gleichem Ertrag): 0,02·x ≤ 3 → 150 kW
    expect(r.daecher.find(d => d.id === 'A').kwp).toBeCloseTo(150);
    expect(r.daecher.find(d => d.id === 'A').begrenzer.art).toBe('spannung');
    // Danach ist das Budget an A voll; C hebt A über K1 ebenfalls an → 0
    expect(r.daecher.find(d => d.id === 'C').kwp).toBeCloseTo(0);
    for (const p of r.pruefpunkte) expect(p.duPct).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('meldet Dächer ohne Netzanbindung', () => {
    const e = netz();
    e.daecher.push({ id: 'X', elementId: 'gibtsnicht', kwpMax: 50 });
    const r = pvnaFuellen(e);
    const x = r.daecher.find(d => d.id === 'X');
    expect(x.kwp).toBe(0);
    expect(x.begrenzer.art).toBe('nicht-angebunden');
  });

  it('ohne Stromgrenze (stationsintern) wird nicht begrenzt', () => {
    const e = netz();
    e.elemente[1].kapKw = Infinity;
    e.elemente[0].kapKw = null;
    const r = pvnaFuellen(e);
    expect(r.summeKwp).toBeCloseTo(200);
  });
});

describe('pvnaVollausbau', () => {
  it('meldet die bei Vollbelegung überlasteten Elemente', () => {
    const v = pvnaVollausbau(netz());
    expect(v.flussKw.get('T')).toBeCloseTo(200);
    expect(v.ueberlastet.sort()).toEqual(['K1', 'T']);
  });
});

describe('pvnaTreppe', () => {
  it('ordnet Maßnahmen nach Zuwachs je Euro und bündelt vorgelagerte Engpässe', () => {
    const e = netz();
    e.elemente[0].massnahme = { label: 'Trafo größer', investEUR: 50000, kapKw: 500 };
    e.elemente[1].massnahme = { label: 'K1 größer',    investEUR: 5000,  kapKw: 300 };
    const t = pvnaTreppe(e);
    expect(t.basis.summeKwp).toBeCloseTo(100);
    // K1 allein bringt nichts (Trafo voll) → wird mit dem Trafo gebündelt;
    // Trafo allein bringt +60 (B voll) für 50 k€ — das Bündel +100 für 55 k€ ist besser.
    expect(t.schritte.length).toBe(1);
    expect(t.schritte[0].massnahmen.map(m => m.elementId).sort()).toEqual(['K1', 'T']);
    expect(t.schritte[0].zuwachsKwp).toBeCloseTo(100);
    expect(t.schritte[0].kumInvestEUR).toBe(55000);
    expect(t.ende.summeKwp).toBeCloseTo(200);
    expect(t.restKwp).toBeCloseTo(0);
  });

  it('kauft eine vorgelagerte Maßnahme nicht mit, wenn das Kabel allein reicht', () => {
    // Trafo hat noch Luft (500 kW), aber für den Vollausbau wäre er zu klein → trägt
    // eine Maßnahme. K1 ist der eigentliche Engpass.
    const e = netz();
    e.elemente[0].kapKw = 180;
    e.elemente[0].massnahme = { label: 'Trafo größer', investEUR: 50000, kapKw: 500 };
    e.elemente[1].massnahme = { label: 'K1 größer',    investEUR: 5000,  kapKw: 300 };
    const t = pvnaTreppe(e);
    expect(t.basis.summeKwp).toBeCloseTo(160);      // A 60 (K1) + B 100
    expect(t.schritte[0].massnahmen.map(m => m.elementId)).toEqual(['K1']);
    expect(t.schritte[0].zuwachsKwp).toBeCloseTo(20); // bis der Trafo (180) voll ist
    expect(t.schritte[0].investEUR).toBe(5000);
  });

  it('findet Maßnahmen, die nur gemeinsam wirken (Sammelstufe), ohne Überflüssiges', () => {
    // T → S (ΔU) → K1 (durch Vorlast voll) → A
    //       S → K3 (ΔU, Vorlast z. B. BHKW) → Prüfpunkt C über der Spannungsgrenze.
    // K1 allein: A scheitert an der Spannung bei C. K3 allein: A scheitert an K1.
    // K9 auf einem dritten Abgang ist teuer und für den Zuwachs unnötig.
    const e = {
      elemente: [
        { id: 'T',  typ: 'trafo', parentId: null, kapKw: Infinity, duProKwPct: 0 },
        { id: 'S',  typ: 'kabel', parentId: 'T', kapKw: 1000, duProKwPct: 0.01 },
        { id: 'K1', typ: 'kabel', parentId: 'S', kapKw: 50, duProKwPct: 0, vorlastKw: 50,
          massnahme: { label: 'K1', investEUR: 10000, kapKw: 500 } },
        { id: 'K3', typ: 'kabel', parentId: 'S', kapKw: 1000, duProKwPct: 0.04, vorlastKw: 60,
          massnahme: { label: 'K3', investEUR: 10000, duProKwPct: 0.001 } },
        { id: 'K9', typ: 'kabel', parentId: 'T', kapKw: 1000, duProKwPct: 0,
          massnahme: { label: 'K9', investEUR: 99999, kapKw: 2000 } },
      ],
      daecher: [
        { id: 'A', elementId: 'K1', kwpMax: 200, ertragFaktor: 1.0, einspFaktor: 1 },
        { id: 'D', elementId: 'K9', kwpMax: 10,  ertragFaktor: 0.9, einspFaktor: 1 },
      ],
      pruefpunkte: [{ id: 'C', elementId: 'K3' }],
      duGrenzePct: 3,
    };
    const t = pvnaTreppe(e);
    expect(t.basis.daecher.find(d => d.id === 'A').kwp).toBeCloseTo(0);
    expect(t.schritte.length).toBeGreaterThan(0);
    const s = t.schritte.find(x => x.sammel);
    expect(s).toBeTruthy();
    expect(s.massnahmen.map(m => m.elementId).sort()).toEqual(['K1', 'K3']);
    expect(s.zuwachsKwp).toBeGreaterThan(1);
    expect(t.schritte.flatMap(x => x.massnahmen.map(m => m.elementId))).not.toContain('K9');
  });

  it('weist unerschließbares Potenzial als Rest aus', () => {
    const e = netz();                               // keine Maßnahmen hinterlegt
    const t = pvnaTreppe(e);
    expect(t.schritte).toEqual([]);
    expect(t.restKwp).toBeCloseTo(100);
  });
});

describe('pvnaAbregelung', () => {
  // 4 Stunden, Formsumme 1: 0,1 / 0,4 / 0,4 / 0,1 × (0,1 kWp · 1000 kWh/kWp) = 10/40/40/10 kW
  const profil = [0.1, 0.4, 0.4, 0.1];
  it('kappt jede Stunde an der Einspeisegrenze', () => {
    const r = pvnaAbregelung(profil, 1000, 0.1, 30); // Erzeugung 10/40/40/10 kW
    expect(r.erzeugungMwh).toBeCloseTo(0.1);
    expect(r.abgeregeltMwh).toBeCloseTo(0.02);     // 2 × 10 kWh
    expect(r.nutzbarMwh).toBeCloseTo(0.08);
    expect(r.verlustPct).toBeCloseTo(20);
    expect(r.stundenAbgeregelt).toBe(2);
    expect(r.spitzeKw).toBeCloseTo(40);
  });
  it('ohne Netzkapazität geht alles verloren, ohne Grenzüberschreitung nichts', () => {
    expect(pvnaAbregelung(profil, 1000, 0.1, 0).verlustPct).toBeCloseTo(100);
    expect(pvnaAbregelung(profil, 1000, 0.1, 50).verlustPct).toBe(0);
  });
});

describe('pvnaLastfluss', () => {
  it('rechnet Flüsse, Auslastung und Verletzungen der vorgegebenen Belegung', () => {
    const r = pvnaLastfluss(netz(), new Map([['A', 70], ['B', 50]]));
    expect(r.flussKw.get('K1')).toBeCloseTo(70);
    expect(r.flussKw.get('T')).toBeCloseTo(120);
    expect(r.auslastungPct.get('T')).toBeCloseTo(120);
    expect(r.ueberlastet.sort()).toEqual(['K1', 'T']);
    expect(r.summeKwp).toBe(120);
    expect(r.zulaessig).toBe(false);
  });

  it('summiert die Spannungsanhebung entlang des Pfades', () => {
    const e = netz();
    e.elemente[1].duProKwPct = 0.02;
    e.elemente.push({ id: 'K3', typ: 'kabel', parentId: 'K1', kapKw: 500, duProKwPct: 0.03 });
    e.daecher.push({ id: 'C', elementId: 'K3', kwpMax: 100, einspFaktor: 1 });
    const r = pvnaLastfluss(e, { A: 10, C: 20 });
    expect(r.duPct.get('K1')).toBeCloseTo(0.02 * 30);
    expect(r.duPct.get('K3')).toBeCloseTo(0.02 * 30 + 0.03 * 20);
  });

  it('stimmt beim Befüllungsergebnis mit dessen Zulässigkeit überein', () => {
    const e = netz();
    const f = pvnaFuellen(e);
    const r = pvnaLastfluss(e, new Map(f.daecher.map(d => [d.id, d.kwp])));
    expect(r.zulaessig).toBe(true);
  });
});

describe('pvnaSpielraum', () => {
  it('liefert die freie Kapazität eines Dachs bei gegebener übriger Belegung', () => {
    const e = netz();
    const s = pvnaSpielraum(e, new Map([['A', 30], ['B', 80]]), 'B');
    expect(s.kwp).toBeCloseTo(70);                  // Trafo 100 − A 30
    expect(s.begrenzer).toEqual({ elementId: 'T', art: 'trafo' });
    expect(pvnaSpielraum(e, new Map([['A', 0]]), 'A').kwp).toBeCloseTo(60);   // K1
  });

  it('berücksichtigt die Spannung an anderen Strangenden', () => {
    const e = netz();
    e.elemente[1].duProKwPct = 0.02;
    e.elemente.push({ id: 'K3', typ: 'kabel', parentId: 'K1', kapKw: 500, duProKwPct: 0.03 });
    e.daecher.push({ id: 'C', elementId: 'K3', kwpMax: 100, einspFaktor: 1 });
    e.elemente[1].kapKw = 500;                      // nur die Spannung soll begrenzen
    e.elemente[0].kapKw = 500;
    // C = 50 → ΔU(K3) = 0,02·(A+50) + 0,03·50 ≤ 3 → A ≤ 25
    const s = pvnaSpielraum(e, new Map([['C', 50]]), 'A');
    expect(s.kwp).toBeCloseTo(25);
    expect(s.begrenzer.art).toBe('spannung');
  });
});
