// Vitest-Tests für lib/slp-kalender.js — Tagtypen der Standardlastprofile.
import { describe, it, expect } from 'vitest';
import {
  ostersonntag, tagImJahr, bundesFeiertage, wochentag, slpTagtypen,
} from '../src/lib/slp-kalender.js';

describe('ostersonntag', () => {
  it('liefert bekannte Ostertermine', () => {
    expect(ostersonntag(2024)).toEqual([3, 31]);
    expect(ostersonntag(2025)).toEqual([4, 20]);
    expect(ostersonntag(2026)).toEqual([4, 5]);
    expect(ostersonntag(2027)).toEqual([3, 28]);
  });
});

describe('wochentag', () => {
  it('1.1.2026 ist ein Donnerstag (0 = Montag)', () => {
    expect(wochentag(2026, 0)).toBe(3);
  });
  it('1.1.2027 ist ein Freitag', () => {
    expect(wochentag(2027, 0)).toBe(4);
  });
});

describe('bundesFeiertage', () => {
  it('enthält neun bundeseinheitliche Feiertage 2026', () => {
    const f = bundesFeiertage(2026);
    expect(f.size).toBe(9);
    expect(f.has(tagImJahr(2026, 4, 3))).toBe(true);   // Karfreitag
    expect(f.has(tagImJahr(2026, 5, 14))).toBe(true);  // Himmelfahrt
    expect(f.has(tagImJahr(2026, 5, 25))).toBe(true);  // Pfingstmontag
    expect(f.has(tagImJahr(2026, 10, 3))).toBe(true);
  });
});

describe('slpTagtypen', () => {
  const tt = slpTagtypen(2026);
  const ttFr = slpTagtypen(2026, { mitFreitag: true });
  const ttBw = slpTagtypen(2026, { bw: true, mitFreitag: true });

  it('liefert 365 Tage', () => {
    expect(tt).toHaveLength(365);
  });

  it('Freitag ist nur mit eigenem Freitagsgang ein eigener Tagtyp', () => {
    const fr = tagImJahr(2026, 1, 9);   // Freitag
    expect(tt[fr]).toBe('WT');
    expect(ttFr[fr]).toBe('Fr');
  });

  it('Feiertage zählen wie Sonntag, auch ein Feiertags-Freitag', () => {
    expect(tt[tagImJahr(2026, 1, 1)]).toBe('So');
    expect(ttFr[tagImJahr(2026, 4, 3)]).toBe('So');   // Karfreitag
  });

  it('Heiligabend und Silvester zählen nach BDEW wie Samstag', () => {
    expect(tt[tagImJahr(2026, 12, 24)]).toBe('Sa');   // Donnerstag
    expect(tt[tagImJahr(2026, 12, 31)]).toBe('Sa');
    expect(tt[tagImJahr(2026, 12, 28)]).toBe('WT');   // Montag zwischen den Jahren
  });

  it('Bundeswehr: Weihnachtsdienstbefreiung 24.–31.12. wie Sonntag', () => {
    for (let d = 24; d <= 31; d++) expect(ttBw[tagImJahr(2026, 12, d)]).toBe('So');
    expect(ttBw[tagImJahr(2026, 12, 23)]).toBe('WT');   // Mittwoch
  });
});
