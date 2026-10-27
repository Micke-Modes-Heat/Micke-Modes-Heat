// Vitest-Tests für lib/pv-abschlaege.js (technisches → realisierbares PV-Potenzial).
import { describe, it, expect } from 'vitest';
import { pvAbschlagRegeln, pvAbschlag, pvPotenzialStufen, pvKennzeichenAktiv, PV_KENNZEICHEN } from '../src/lib/pv-abschlaege.js';

const R = pvAbschlagRegeln();

describe('pvAbschlagRegeln', () => {
  it('Standardwerte', () => {
    expect(R).toMatchObject({ hindernisFlach: 20, hindernisFlachNdom: 10, hindernisSchraeg: 10, minAnlageKwp: 5 });
    expect(R.kennzeichen).toEqual({ denkmal: 100, statik: 100, dachSanierung: 0 });
  });
  it('übernimmt Vorgaben und klemmt auf 0…100 %', () => {
    const r = pvAbschlagRegeln({ hindernisFlach: 150, hindernisSchraeg: '7,5'.replace(',', '.'), kennzeichen: { denkmal: 50 }, minAnlageKwp: 0 });
    expect(r.hindernisFlach).toBe(100);
    expect(r.hindernisSchraeg).toBe(7.5);
    expect(r.kennzeichen.denkmal).toBe(50);
    expect(r.minAnlageKwp).toBe(0);
  });
});

describe('pvAbschlag', () => {
  it('Hindernisse anteilig nach Flach/Schräg', () => {
    expect(pvAbschlag({ flachAnteil: 1 }, R).faktor).toBeCloseTo(0.8, 9);
    expect(pvAbschlag({ flachAnteil: 0 }, R).faktor).toBeCloseTo(0.9, 9);
    expect(pvAbschlag({ flachAnteil: 0.5 }, R).hindernis).toBeCloseTo(0.15, 9);
  });
  it('im Höhenmodell geprüfte Flachdächer: kleinerer Abschlag', () => {
    expect(pvAbschlag({ flachAnteil: 1, ndomGeprueft: true }, R).faktor).toBeCloseTo(0.9, 9);
    expect(pvAbschlag({ flachAnteil: 0, ndomGeprueft: true }, R).faktor).toBeCloseTo(0.9, 9);
  });
  it('erfasste Hindernisse und pauschale Anlagen ohne Hindernisabschlag', () => {
    expect(pvAbschlag({ flachAnteil: 1, hindernisseErfasst: true }, R).faktor).toBe(1);
    expect(pvAbschlag({ flachAnteil: 1, mitHindernis: false }, R).faktor).toBe(1);
  });
  it('Kennzeichen multiplizieren sich, 100 % schließt aus', () => {
    expect(pvAbschlag({ flachAnteil: 0, kennzeichen: ['denkmal'] }, R).faktor).toBe(0);
    expect(pvAbschlag({ flachAnteil: 0, kennzeichen: ['dachSanierung'] }, R).faktor).toBeCloseTo(0.9, 9);
    const r = pvAbschlagRegeln({ kennzeichen: { denkmal: 50, statik: 50 } });
    expect(pvAbschlag({ flachAnteil: 0, hindernisseErfasst: true, kennzeichen: ['denkmal', 'statik'] }, r).faktor).toBeCloseTo(0.25, 9);
  });
});

describe('pvPotenzialStufen', () => {
  it('Treppe technisch → realisierbar → wirtschaftlich', () => {
    const s = pvPotenzialStufen([
      { kwpTech: 100, ...pvAbschlag({ flachAnteil: 1 }, R), kennzeichen: [] },                 // 80
      { kwpTech: 50, ...pvAbschlag({ flachAnteil: 0, kennzeichen: ['denkmal'] }, R), kennzeichen: ['denkmal'] }, // 0
      { kwpTech: 4, ...pvAbschlag({ flachAnteil: 0 }, R), kennzeichen: [] },                   // 3,6 < 5
      { kwpTech: 0, faktor: 1, hindernis: 0, kennzeichen: [] },
    ], R);
    expect(s.technisch).toBeCloseTo(154, 9);
    expect(s.ohneHindernis).toBeCloseTo(80 + 45 + 3.6, 9);
    expect(s.realisierbar).toBeCloseTo(83.6, 9);
    expect(s.wirtschaftlich).toBeCloseTo(80, 9);
    expect(s).toMatchObject({ daecher: 3, ausgeschlossen: 1, zuKlein: 1 });
    expect(s.jeKennzeichen.denkmal).toEqual({ n: 1, kwp: 50 });
  });
});

describe('pvPotenzialStufen mit Ertragsschwelle', () => {
  it('schwache Anlagen zählen nicht wirtschaftlich', () => {
    const s = pvPotenzialStufen([
      { kwpTech: 20, faktor: 1, hindernis: 0, kennzeichen: [], ertrag: 0.62 },   // Pultdach nach Norden
      { kwpTech: 30, faktor: 1, hindernis: 0, kennzeichen: [], ertrag: 0.95 },
      { kwpTech: 10, faktor: 1, hindernis: 0, kennzeichen: [], ertrag: null },   // unbekannt → zählt
    ], { ...R, ertragMin: 75 });
    expect(s.realisierbar).toBeCloseTo(60, 9);
    expect(s.wirtschaftlich).toBeCloseTo(40, 9);
    expect(s.zuSchwach).toBe(1);
  });
});

describe('pvKennzeichenAktiv', () => {
  it('liefert gesetzte Schlüssel in fester Reihenfolge', () => {
    expect(pvKennzeichenAktiv({ pvKennzeichen: { statik: true, denkmal: true, x: true } })).toEqual(['denkmal', 'statik']);
    expect(pvKennzeichenAktiv({})).toEqual([]);
    expect(PV_KENNZEICHEN.map(k => k.key)).toEqual(['denkmal', 'statik', 'dachSanierung']);
  });
});
