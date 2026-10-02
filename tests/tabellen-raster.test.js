// Vitest-Tests für lib/tabellen-raster.js — Markieren, Ausfüllen, Kopieren/Einfügen, Zahlen und Nutzungen.
import { describe, it, expect } from 'vitest';
import { trBereich, trImBereich, trGroesse, trFuellen, trNachUnten, trZwischenablageLesen, trAlsText, trEinfuegen, trZahl, trNutzung } from '../src/lib/tabellen-raster.js';

describe('Bereiche', () => {
  it('normalisiert Ecken in beliebiger Reihenfolge', () => {
    expect(trBereich({ r: 5, c: 3 }, { r: 2, c: 1 })).toEqual({ r0: 2, r1: 5, c0: 1, c1: 3 });
    expect(trBereich({ r: 4, c: 2 })).toEqual({ r0: 4, r1: 4, c0: 2, c1: 2 });
  });
  it('prüft Zugehörigkeit und Größe', () => {
    const b = trBereich({ r: 1, c: 1 }, { r: 3, c: 2 });
    expect(trImBereich(b, 2, 2)).toBe(true);
    expect(trImBereich(b, 4, 2)).toBe(false);
    expect(trImBereich(null, 0, 0)).toBe(false);
    expect(trGroesse(b)).toBe(6);
    expect(trGroesse(null)).toBe(0);
  });
});

describe('Ausfüllen', () => {
  it('zieht eine Zelle nach unten', () => {
    expect(trFuellen(trBereich({ r: 2, c: 0 }), 4)).toEqual([{ r: 3, c: 0, quelleR: 2 }, { r: 4, c: 0, quelleR: 2 }]);
  });
  it('wiederholt mehrere Quellzeilen zyklisch', () => {
    const z = trFuellen(trBereich({ r: 0, c: 0 }, { r: 1, c: 0 }), 4).map(x => x.quelleR);
    expect(z).toEqual([0, 1, 0]);
  });
  it('zieht nach oben', () => {
    expect(trFuellen(trBereich({ r: 5, c: 1 }), 3).map(x => [x.r, x.quelleR])).toEqual([[4, 5], [3, 5]]);
    const zwei = trFuellen(trBereich({ r: 4, c: 0 }, { r: 5, c: 0 }), 1).map(x => [x.r, x.quelleR]);
    expect(zwei).toEqual([[3, 5], [2, 4], [1, 5]]);
  });
  it('füllt über mehrere Spalten', () => {
    expect(trFuellen(trBereich({ r: 0, c: 1 }, { r: 0, c: 2 }), 1)).toEqual([{ r: 1, c: 1, quelleR: 0 }, { r: 1, c: 2, quelleR: 0 }]);
  });
  it('innerhalb des Bereichs passiert nichts', () => {
    expect(trFuellen(trBereich({ r: 1, c: 0 }, { r: 3, c: 0 }), 2)).toEqual([]);
  });
  it('Strg+D übernimmt die oberste Zeile', () => {
    expect(trNachUnten(trBereich({ r: 2, c: 0 }, { r: 4, c: 1 }))).toEqual([
      { r: 3, c: 0, quelleR: 2 }, { r: 3, c: 1, quelleR: 2 }, { r: 4, c: 0, quelleR: 2 }, { r: 4, c: 1, quelleR: 2 },
    ]);
    expect(trNachUnten(trBereich({ r: 2, c: 0 }))).toEqual([]);
  });
});

describe('Zwischenablage', () => {
  it('liest Excel-Text mit Tabulatoren und Zeilenumbrüchen, auch \\r\\n und abschließenden Umbruch', () => {
    expect(trZwischenablageLesen('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(trZwischenablageLesen('1.200\n800')).toEqual([['1.200'], ['800']]);
    expect(trZwischenablageLesen('')).toEqual([]);
  });
  it('löst Anführungszeichen-Zellen mit Umbruch und doppelten Anführungszeichen auf', () => {
    expect(trZwischenablageLesen('"Haus\nNord"\t"Sagt ""Hallo"""\nx\ty')).toEqual([['Haus\nNord', 'Sagt "Hallo"'], ['x', 'y']]);
  });
  it('erhält leere Zellen', () => {
    expect(trZwischenablageLesen('a\t\tc')).toEqual([['a', '', 'c']]);
  });
  it('schreibt Text, den Excel wieder liest', () => {
    const m = [['Haus "A"', '12'], ['Zeile\nzwei', '3']];
    expect(trZwischenablageLesen(trAlsText(m))).toEqual(m);
    expect(trAlsText([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });
});

describe('Einfügen', () => {
  it('ein Wert in einen markierten Bereich füllt alles', () => {
    const z = trEinfuegen([['Unterkunft']], { r: 0, c: 2 }, trBereich({ r: 0, c: 2 }, { r: 2, c: 2 }), 10, 9);
    expect(z).toEqual([{ r: 0, c: 2, wert: 'Unterkunft' }, { r: 1, c: 2, wert: 'Unterkunft' }, { r: 2, c: 2, wert: 'Unterkunft' }]);
  });
  it('eine Spalte aus Excel ab der Ankerzelle', () => {
    expect(trEinfuegen([['1'], ['2'], ['3']], { r: 4, c: 1 }, null, 10, 9).map(x => [x.r, x.c, x.wert])).toEqual([[4, 1, '1'], [5, 1, '2'], [6, 1, '3']]);
  });
  it('schneidet am Tabellenrand ab', () => {
    expect(trEinfuegen([['1', '2'], ['3', '4']], { r: 9, c: 8 }, null, 10, 9)).toEqual([{ r: 9, c: 8, wert: '1' }]);
  });
  it('wiederholt ein Muster, wenn der Bereich ein Vielfaches ist', () => {
    const z = trEinfuegen([['a'], ['b']], { r: 0, c: 0 }, trBereich({ r: 0, c: 0 }, { r: 3, c: 0 }), 10, 9).map(x => x.wert);
    expect(z).toEqual(['a', 'b', 'a', 'b']);
    const kein = trEinfuegen([['a'], ['b']], { r: 0, c: 0 }, trBereich({ r: 0, c: 0 }, { r: 2, c: 0 }), 10, 9).map(x => x.wert);
    expect(kein).toEqual(['a', 'b']);
  });
  it('leere Zwischenablage fügt nichts ein', () => {
    expect(trEinfuegen([], { r: 0, c: 0 }, null, 10, 9)).toEqual([]);
  });
});

describe('Zahlen und Nutzungen', () => {
  it('liest deutsche und englische Zahlen', () => {
    expect(trZahl('1.234,5')).toBe(1234.5);
    expect(trZahl('1234,5')).toBe(1234.5);
    expect(trZahl('1234.5')).toBe(1234.5);
    expect(trZahl('1.234')).toBe(1234);
    expect(trZahl('12.345.678')).toBe(12345678);
    expect(trZahl(' 1 200 ')).toBe(1200);
    expect(trZahl('850 m²')).toBe(850);
    expect(trZahl('120 kWh/m²a')).toBe(120);
    expect(trZahl('-3,5')).toBe(-3.5);
    expect(trZahl('abc')).toBeNaN();
    expect(trZahl('')).toBeNaN();
  });
  it('findet Nutzungen über Kennung, Bezeichnung oder Anfang der Bezeichnung', () => {
    const typen = [{ id: 'unterkunft', label: 'Unterkunftsgebäude' }, { id: 'buero', label: 'Bürogebäude' }];
    expect(trNutzung('Unterkunftsgebäude', typen)).toBe('unterkunft');
    expect(trNutzung('BUERO', typen)).toBe('buero');
    expect(trNutzung('büro', typen)).toBe('buero');
    expect(trNutzung('Halle', typen)).toBeNull();
    expect(trNutzung('', typen)).toBeNull();
  });
});
