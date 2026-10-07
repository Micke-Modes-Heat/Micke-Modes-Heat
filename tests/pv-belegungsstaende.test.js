import { describe, it, expect } from 'vitest';
import {
  pvbsNeu, pvbsSummen, pvbsPlan, pvbsGleich, pvbsFelder, pvbsDachAbweichung, PVBS_LEER,
} from '../src/lib/pv-belegungsstaende.js';

const fl = (id, typ = 'belegung') => ({ id, typ, polygon: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }], flaeche: 10, layer: { x: 1 } });
const felder = (...fls) => ({ pvAktiv: true, pvModus: 'flaechen', pvFlaechen: fls, pvFlBelegung: 90 });

describe('Belegungsstand anlegen', () => {
  it('rundet Kennzahlen und lässt Kartenlayer weg', () => {
    const s = pvbsNeu({ id: 's1', name: 'Test', eintraege: { 7: { felder: felder(fl(1)), kwp: 12.345, kwpKorr: 11.06, module: 27.4 } } });
    expect(s.geb[7].kwp).toBe(12.3);
    expect(s.geb[7].kwpKorr).toBe(11.1);
    expect(s.geb[7].module).toBe(27);
    expect(s.geb[7].felder.pvFlaechen[0].layer).toBeUndefined();
  });

  it('speichert Dachangaben nur, wenn welche da sind', () => {
    const s = pvbsNeu({ id: 's', name: 'x', eintraege: { 1: { felder: felder(), dach: {} }, 2: { felder: felder(), dach: { dachform: 'sattel' } } } });
    expect(s.geb[1].dach).toBeUndefined();
    expect(s.geb[2].dach).toEqual({ dachform: 'sattel' });
  });
});

describe('Summen', () => {
  it('zählt nur Gebäude, die es noch gibt', () => {
    const s = pvbsNeu({ id: 's', name: 'x', eintraege: { 1: { felder: felder(), kwp: 10, kwpKorr: 9 }, 2: { felder: felder(), kwp: 5, kwpKorr: 5 } } });
    expect(pvbsSummen(s)).toMatchObject({ daecher: 2, kwp: 15, kwpKorr: 14 });
    expect(pvbsSummen(s, id => id === '1')).toMatchObject({ daecher: 1, kwp: 10 });
  });
});

describe('Plan zum Aktivieren', () => {
  it('leert Dächer, die im Stand fehlen, und vergibt neue Flächen-IDs', () => {
    const s = pvbsNeu({ id: 's', name: 'x', eintraege: { 1: { felder: felder(fl(-1), fl(-2, 'sperr')), dach: { dachform: 'flach' } } } });
    let n = 100;
    const { belegung, dach } = pvbsPlan([{ id: 1 }, { id: 2 }], s, () => ++n);
    expect(belegung[1].pvFlaechen.map(f => f.id)).toEqual([101, 102]);
    expect(belegung[2]).toEqual(PVBS_LEER);
    expect(dach.get(1)).toEqual({ dachform: 'flach' });
    expect(s.geb[1].felder.pvFlaechen[0].id).toBe(-1);          // Stand selbst bleibt unberührt
  });
});

describe('Vergleich mit dem Projekt', () => {
  it('ignoriert Flächen-IDs, erkennt geänderte und zusätzliche Dächer', () => {
    const s = pvbsNeu({ id: 's', name: 'x', eintraege: { 1: { felder: felder(fl(-1)) } } });
    expect(pvbsGleich(s, { 1: felder(fl(55)) })).toBe(true);
    expect(pvbsGleich(s, { 1: { ...felder(fl(55)), pvFlBelegung: 80 } })).toBe(false);
    expect(pvbsGleich(s, { 1: felder(fl(55)), 2: felder(fl(56)) })).toBe(false);
    expect(pvbsGleich(s, {})).toBe(false);
  });

  it('ein leeres Dach zählt wie ein fehlendes', () => {
    const s = pvbsNeu({ id: 's', name: 'x', eintraege: {} });
    expect(pvbsGleich(s, { 3: { pvAktiv: false, pvFlaechen: [] } })).toBe(true);
  });
});

describe('Hilfen', () => {
  it('pvbsFelder nimmt nur die Belegungsfelder', () => {
    const f = pvbsFelder({ id: 1, name: 'A', dachform: 'sattel', ...felder(fl(1)) });
    expect(f.name).toBeUndefined();
    expect(f.dachform).toBeUndefined();
    expect(f.pvFlaechen).toHaveLength(1);
  });

  it('pvbsDachAbweichung meldet nur Abweichungen der Kopie', () => {
    expect(pvbsDachAbweichung({ dachform: 'sattel', dachNeigung: 35 }, { dachform: 'sattel', dachNeigung: 30, dachAzimut: 170 }))
      .toEqual({ dachNeigung: 30, dachAzimut: 170 });
  });
});
