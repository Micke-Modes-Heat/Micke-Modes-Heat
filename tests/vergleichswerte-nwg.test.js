// Vitest-Tests für lib/vergleichswerte-nwg.js — Vergleichswerte Wärme nach der Bekanntmachung vom 15.04.2021.
import { describe, it, expect } from 'vitest';
import { NWG_TEK, NWG_ZUORDNUNG, nwgGroessenfaktor, nwgVergleichswert } from '../src/lib/vergleichswerte-nwg.js';

describe('Tabelle und Faktoren', () => {
  it('52 Kategorien, Stichproben aus Anlage 1', () => {
    expect(Object.keys(NWG_TEK)).toHaveLength(52);
    expect(NWG_TEK[1]).toEqual(['Verwaltungsgebäude (allgemein)', 48.5, 6.9]);
    expect(NWG_TEK[30][1]).toBe(68.6);
    expect(NWG_TEK[44]).toEqual(['Gebäude für Lagerung', 38.1, 19.3]);
    expect(NWG_TEK[52][2]).toBe(4.0);
    for (const nr of Object.values(NWG_ZUORDNUNG)) expect(NWG_TEK[nr]).toBeDefined();
  });
  it('Größenfaktor Nummer 6.3.1', () => {
    expect(nwgGroessenfaktor(400)).toBe(1.46);
    expect(nwgGroessenfaktor(60000)).toBe(0.71);
    expect(nwgGroessenfaktor(5000)).toBeCloseTo(4.53 * 5000 ** -0.215 + 0.27, 9);
    expect(nwgGroessenfaktor(5000)).toBeCloseTo(1.0, 1);   // Tabellenwerte beziehen sich auf 5.000 m²
  });
});

describe('Vergleichswert', () => {
  it('Beispiel der Bekanntmachung (Abbildung 8): Verwaltung, NGF ≤ 500 m², Heizung', () => {
    const v = nwgVergleichswert({ nutzung: 'verwaltung', bgfM2: 400 / 0.85, twwZentral: false });
    expect(v.tekH * v.f).toBeCloseTo(70.81, 2);
    expect(v.jeNgf).toBeCloseTo(70.81, 2);
    expect(v.jeBgf).toBeCloseTo(70.81 * 0.85, 2);
  });
  it('Warmwasser zentral addiert, Wohngebäude ohne Wert, Fallback über waermeRef', () => {
    const v = nwgVergleichswert({ nutzung: 'kaserne', bgfM2: 3000 });
    expect(v.kategorie).toBe('Jugendherbergen u. Ferienhäuser');
    expect(v.jeNgf).toBeCloseTo(63.4 * nwgGroessenfaktor(2550) + 50.9, 6);
    expect(nwgVergleichswert({ nutzung: 'mfh', bgfM2: 1000 })).toBeNull();
    expect(nwgVergleichswert({ nutzung: 'eigener_typ', waermeRef: 'buero', bgfM2: 1000 }).nr).toBe(7);
  });
});
