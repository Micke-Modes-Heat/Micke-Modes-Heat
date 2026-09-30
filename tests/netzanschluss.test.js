// Vitest-Tests für lib/netzanschluss.js — Zahleneingabe und Vorschlag Messverfahren.
import { describe, it, expect } from 'vitest';
import {
  NA_MESSVERFAHREN, NA_MESSORTE, naZahl, naKvaText, naMessverfahrenVorschlag, naMessortVorschlag,
} from '../src/lib/netzanschluss.js';

describe('naZahl', () => {
  it('liest deutsche und englische Schreibweisen', () => {
    expect(naZahl('1000')).toBe(1000);
    expect(naZahl('1.000')).toBe(1000);
    expect(naZahl('1.250,5')).toBe(1250.5);
    expect(naZahl('630,5')).toBe(630.5);
    expect(naZahl('1.5')).toBe(1.5);
    expect(naZahl(' 2 000 ')).toBe(2000);
  });

  it('liefert null bei leerer oder ungültiger Eingabe', () => {
    expect(naZahl('')).toBeNull();
    expect(naZahl(null)).toBeNull();
    expect(naZahl('ca. 800')).toBeNull();
  });
});

describe('naKvaText', () => {
  it('formatiert Zahlen deutsch und lässt Freitext stehen', () => {
    expect(naKvaText('1000')).toBe('1.000');
    expect(naKvaText('ca. 800')).toBe('ca. 800');
    expect(naKvaText('')).toBe('');
  });
});

describe('naMessverfahrenVorschlag', () => {
  const [RLM, SLP] = NA_MESSVERFAHREN;

  it('schlägt RLM vor, sobald ein gemessener Lastgang geladen ist', () => {
    expect(naMessverfahrenVorschlag({ lastgangAufloesung: 15 }).wert).toBe(RLM.wert);
    expect(naMessverfahrenVorschlag({ lastgangAufloesung: 60, jahresMwh: 20 }).kurz).toBe('RLM');
  });

  it('entscheidet ohne Lastgang an der 100-MWh-Grenze', () => {
    expect(naMessverfahrenVorschlag({ jahresMwh: 250 }).kurz).toBe('RLM');
    expect(naMessverfahrenVorschlag({ jahresMwh: 100 }).kurz).toBe('SLP');
    expect(naMessverfahrenVorschlag({ jahresMwh: 40 }).wert).toBe(SLP.wert);
  });

  it('liefert ohne Daten keinen Vorschlag', () => {
    expect(naMessverfahrenVorschlag()).toBeNull();
    expect(naMessverfahrenVorschlag({ jahresMwh: 0 })).toBeNull();
  });
});

describe('naMessortVorschlag', () => {
  it('mehrere Trafostationen → MS-seitige Messung', () => {
    const v = naMessortVorschlag({ msAnschluss: true, trafoStationen: 4 });
    expect(v.wert).toBe('ms');
    expect(v.grund).toMatch(/4 Trafostationen/);
    expect(NA_MESSORTE.map(o => o.wert)).toEqual(['ms', 'ns']);
  });
  it('eine Station oder NS-Anschluss → kein Vorschlag', () => {
    expect(naMessortVorschlag({ msAnschluss: true, trafoStationen: 1 })).toBeNull();
    expect(naMessortVorschlag({ msAnschluss: false, trafoStationen: 5 })).toBeNull();
  });
});
