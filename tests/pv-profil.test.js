import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  loadScript('06a-gbi-lastgang.js');
  loadScript('09a-pv-profile.js');
});

describe('makePvProfile8760 — Grundeigenschaften', () => {
  it('gibt Float32Array mit 8760 Einträgen zurück', () => {
    const p = makePvProfile8760('sued');
    expect(p).toBeInstanceOf(Float32Array);
    expect(p.length).toBe(8760);
  });

  it('Summe ≈ 1.0 (normiertes Profil)', () => {
    const p = makePvProfile8760('sued');
    let sum = 0;
    for (let i = 0; i < 8760; i++) sum += p[i];
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('keine negativen Werte', () => {
    const p = makePvProfile8760('sued');
    for (let i = 0; i < 8760; i++) {
      expect(p[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('Nachts (Mitternacht Januar) kein Ertrag', () => {
    const p = makePvProfile8760('sued');
    // Stunde 0 = 1. Januar 00:00 → dunkel
    expect(p[0]).toBe(0);
    // Stunde 3 = 1. Januar 03:00 → dunkel
    expect(p[3]).toBe(0);
  });

  it('Mittags im Sommer höchster Ertrag', () => {
    const p = makePvProfile8760('sued');
    // Juni Mitte: Tag ~151-181, Stunde 12:00
    // Tag 170, Stunde 12 → Index 170*24 + 12 = 4092
    const mittagJuni = p[4092];
    // Januar Mittag: Tag 15, Stunde 12 → Index 15*24 + 12 = 372
    const mittagJan = p[372];
    expect(mittagJuni).toBeGreaterThan(mittagJan);
  });
});

describe('makePvProfile8760 — Ausrichtung', () => {
  it('Ost-West-Profil existiert und ist normiert', () => {
    const p = makePvProfile8760('ostwest');
    let sum = 0;
    for (let i = 0; i < 8760; i++) sum += p[i];
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('Süd und Ost-West haben unterschiedliche Tagesprofile', () => {
    const sued = makePvProfile8760('sued');
    const ow = makePvProfile8760('ostwest');
    // Sommertag: beide Profile müssen unterschiedlich sein
    let diff = 0;
    for (let h = 0; h < 24; h++) {
      diff += Math.abs(sued[170 * 24 + h] - ow[170 * 24 + h]);
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('Ost-West hat im Sommer höheren Monatsanteil', () => {
    // OW-Profile haben im Juni/Juli höhere Anteile als Süd
    expect(_PV_MONTH.ostwest[5]).toBeGreaterThan(_PV_MONTH.sued[5]); // Juni
    expect(_PV_MONTH.ostwest[6]).toBeGreaterThan(_PV_MONTH.sued[6]); // Juli
  });

  it('unbekannte Ausrichtung fällt auf Süd zurück', () => {
    const p = makePvProfile8760('nordpol');
    let sum = 0;
    for (let i = 0; i < 8760; i++) sum += p[i];
    expect(sum).toBeCloseTo(1.0, 2);
  });
});

describe('makePvProfile8760 — Saisonalität', () => {
  it('Sommermonate haben mehr Ertrag als Wintermonate', () => {
    const p = makePvProfile8760('sued');
    // Januar: Stunden 0-743
    let sumJan = 0;
    for (let i = 0; i < 744; i++) sumJan += p[i];
    // Juni: Stunden 3624-4343 (Jan 744 + Feb 672 + Mär 744 + Apr 720 + Mai 744 = 3624)
    let sumJun = 0;
    for (let i = 3624; i < 3624 + 720; i++) sumJun += p[i];

    expect(sumJun).toBeGreaterThan(sumJan * 3); // Juni > 3× Januar
  });

  it('Jahresverteilung entspricht _PV_MONTH', () => {
    const p = makePvProfile8760('sued');
    const monatsStunden = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];
    const monatsSummen = [];
    let ptr = 0;
    for (let m = 0; m < 12; m++) {
      let s = 0;
      for (let i = 0; i < monatsStunden[m]; i++) s += p[ptr++];
      monatsSummen.push(s);
    }
    // Juni (Index 5) sollte den höchsten Anteil haben
    const maxIdx = monatsSummen.indexOf(Math.max(...monatsSummen));
    expect(maxIdx).toBe(5); // Juni
    // Dezember (Index 11) den niedrigsten
    const minIdx = monatsSummen.indexOf(Math.min(...monatsSummen));
    expect(minIdx).toBe(11); // Dezember
  });
});

describe('_PV_MONTH Konstanten', () => {
  it('Süd-Monatsanteile summieren auf ~1.0', () => {
    const sum = _PV_MONTH.sued.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('Ost-West-Monatsanteile summieren auf ~1.0', () => {
    const sum = _PV_MONTH.ostwest.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('12 Monate pro Ausrichtung', () => {
    expect(_PV_MONTH.sued.length).toBe(12);
    expect(_PV_MONTH.ostwest.length).toBe(12);
  });
});

describe('_PV_SUN Konstanten', () => {
  it('12 Monate mit [Aufgang, Untergang]', () => {
    expect(_PV_SUN.length).toBe(12);
    for (const [rise, set] of _PV_SUN) {
      expect(rise).toBeGreaterThanOrEqual(4);
      expect(rise).toBeLessThanOrEqual(9);
      expect(set).toBeGreaterThanOrEqual(15);
      expect(set).toBeLessThanOrEqual(22);
      expect(set).toBeGreaterThan(rise);
    }
  });

  it('Sommer hat längere Tage als Winter', () => {
    const [riseJan, setJan] = _PV_SUN[0]; // Januar
    const [riseJun, setJun] = _PV_SUN[5]; // Juni
    expect(setJun - riseJun).toBeGreaterThan(setJan - riseJan);
  });
});
