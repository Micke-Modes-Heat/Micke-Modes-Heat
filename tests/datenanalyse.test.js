import { describe, it, expect } from 'vitest';
import { monatAusStunde, stundeAlsText, klassieren, monatsSummen, dauerlinie, statistik, quotient, farbeSkala, achsenTicks } from '../src/lib/datenanalyse.js';

describe('Datenanalyse — Rechenbausteine', () => {
  it('Zeitachse: Monat und Datumstext', () => {
    expect(monatAusStunde(0)).toBe(0);
    expect(monatAusStunde(743)).toBe(0);
    expect(monatAusStunde(744)).toBe(1);
    expect(monatAusStunde(8759)).toBe(11);
    expect(stundeAlsText(0)).toBe('Mo 01.01. 00:00');
    expect(stundeAlsText(14 * 24 + 8)).toBe('Mo 15.01. 08:00');
    expect(stundeAlsText(744 + 25, false)).toBe('02.02. 01:00');
  });

  it('Klassieren: Mittel, Minimum, Maximum je Klasse, Maske und NaN ausgelassen', () => {
    const w = Float32Array.from([1, 3, NaN, 5, 7, 9]);
    const k = klassieren(w, 0, 6, 2);
    expect(Array.from(k.mittel)).toEqual([2, 7]);
    expect(Array.from(k.min)).toEqual([1, 5]);
    expect(Array.from(k.max)).toEqual([3, 9]);
    expect(Array.from(k.anzahl)).toEqual([2, 3]);
    const m = klassieren(w, 0, 6, 1, Uint8Array.from([1, 0, 1, 0, 1, 0]));
    expect(m.mittel[0]).toBeCloseTo(4, 9);
  });

  it('Monatssummen, Dauerlinie, Statistik, Quotient', () => {
    const w = new Float32Array(8760).fill(1);
    const s = monatsSummen(w);
    expect(s[0]).toBe(744);
    expect(s[1]).toBe(672);
    expect(Array.from(dauerlinie(Float32Array.from([2, 5, NaN, 1])))).toEqual([5, 2, 1]);
    const st = statistik(Float32Array.from([2, 4, NaN, 6]));
    expect(st).toEqual({ n: 3, summe: 12, mittel: 4, min: 2, max: 6 });
    expect(Number.isNaN(statistik([]).mittel)).toBe(true);
    const q = quotient(Float32Array.from([30, 10]), Float32Array.from([10, 0.1]));
    expect(q[0]).toBe(3);
    expect(Number.isNaN(q[1])).toBe(true);
  });

  it('Farbskala und Achsenschritte', () => {
    expect(farbeSkala(0)).toBe('rgb(49,54,149)');
    expect(farbeSkala(1)).toBe('rgb(215,48,39)');
    expect(farbeSkala(2)).toBe(farbeSkala(1));
    expect(achsenTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(achsenTicks(1.3, 4.7, 4)).toEqual([2, 3, 4]);
  });
});
