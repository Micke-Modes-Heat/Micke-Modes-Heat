// Vitest-Tests für lib/phasen-core.js — Reparatur und Bearbeitung von Phasen-Zeiträumen.
// Regression: eine einzige Phase mit unstimmigem Zeitraum ließ jede
// Planungstransaktion scheitern — auch das Löschen eines Assets.
import { describe, it, expect } from 'vitest';
import { repairPhasen, phaseJahrSetzen } from '../src/lib/phasen-core.js';

describe('repairPhasen', () => {
  it('lässt gültige Zeiträume unverändert', () => {
    expect(repairPhasen([{ id: 'p1', name: 'A', jahrVon: '2030', jahrBis: '2035' }], 2026))
      .toEqual([{ id: 'p1', name: 'A', jahrVon: '2030', jahrBis: '2035' }]);
  });

  it('zieht ein leeres Endjahr auf das Startjahr — der Auslöser des Blockierens', () => {
    // Number('') === 0, dadurch galt die Phase als "Start nach Ende"
    expect(repairPhasen([{ id: 'p1', jahrVon: '2030', jahrBis: '' }], 2026)[0].jahrBis).toBe('2030');
  });

  it('korrigiert ein Endjahr vor dem Startjahr', () => {
    expect(repairPhasen([{ id: 'p1', jahrVon: '2035', jahrBis: '2030' }], 2026)[0])
      .toMatchObject({ jahrVon: '2035', jahrBis: '2035' });
  });

  it('ersetzt ein fehlendes Startjahr durch das Bezugsjahr', () => {
    expect(repairPhasen([{ id: 'p1', jahrVon: null, jahrBis: null }], 2026)[0])
      .toMatchObject({ jahrVon: '2026', jahrBis: '2026' });
  });

  it('behält alle übrigen Felder der Phase', () => {
    expect(repairPhasen([{ id: 'p1', name: 'Stufe 1', variantId: 'v1', reihenfolge: 3, jahrVon: '2030', jahrBis: '' }], 2026)[0])
      .toMatchObject({ id: 'p1', name: 'Stufe 1', variantId: 'v1', reihenfolge: 3 });
  });

  it('liefert Ergebnisse, die die Validierungsregel erfüllen', () => {
    const kaputt = [
      { id: 'a', jahrVon: '2030', jahrBis: '' },
      { id: 'b', jahrVon: '2035', jahrBis: '2030' },
      { id: 'c', jahrVon: 'quatsch', jahrBis: undefined },
    ];
    for (const p of repairPhasen(kaputt, 2026)) {
      expect(Number(p.jahrVon) > Number(p.jahrBis)).toBe(false);
    }
  });

  it('verändert die Eingabe nicht', () => {
    const ein = [{ id: 'p1', jahrVon: '2035', jahrBis: '2030' }];
    repairPhasen(ein, 2026);
    expect(ein[0].jahrBis).toBe('2030');
  });

  it('verträgt fehlende und leere Eingaben', () => {
    expect(repairPhasen(null, 2026)).toEqual([]);
    expect(repairPhasen([], 2026)).toEqual([]);
  });
});

describe('phaseJahrSetzen', () => {
  const p = { jahrVon: '2030', jahrBis: '2035' };

  it('setzt ein Jahr innerhalb des gültigen Bereichs', () => {
    expect(phaseJahrSetzen(p, 'jahrVon', '2032')).toEqual({ jahrVon: '2032', jahrBis: '2035' });
    expect(phaseJahrSetzen(p, 'jahrBis', '2040')).toEqual({ jahrVon: '2030', jahrBis: '2040' });
  });

  it('zieht das Endjahr mit, wenn das Startjahr darüber hinausgeht', () => {
    expect(phaseJahrSetzen(p, 'jahrVon', '2038')).toEqual({ jahrVon: '2038', jahrBis: '2038' });
  });

  it('zieht das Startjahr mit, wenn das Endjahr darunter fällt', () => {
    expect(phaseJahrSetzen(p, 'jahrBis', '2028')).toEqual({ jahrVon: '2028', jahrBis: '2028' });
  });

  it('verwirft eine leere oder unbrauchbare Eingabe, statt 0 zu schreiben', () => {
    expect(phaseJahrSetzen(p, 'jahrBis', '')).toBeNull();
    expect(phaseJahrSetzen(p, 'jahrBis', 'abc')).toBeNull();
    expect(phaseJahrSetzen(p, 'jahrVon', null)).toBeNull();
  });
});
