import { describe, expect, it } from 'vitest';
import { bandIntervalle, punktImPolygon, rechteckImPolygon, rechteckTrifftPolygon, streckeSchneidetRechteck, vereinigeIntervalle } from '../src/lib/pv-raster.js';

const P = pts => pts.map(([x, y]) => ({ x, y }));
// L-Form: 20 × 10 unten, dazu 8 × 10 Flügel links oben
const L_FORM = P([[0, 0], [20, 0], [20, 10], [8, 10], [8, 20], [0, 20]]);
const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

describe('rechteckImPolygon', () => {
  it('Rechteck im Flügel einer L-Form liegt innen (Halbebenen-Einrücken hätte ihn weggeschnitten)', () => {
    expect(rechteckImPolygon(R(1, 12, 7, 19), L_FORM)).toBe(true);
    expect(rechteckImPolygon(R(12, 1, 19, 9), L_FORM)).toBe(true);
  });
  it('Rechteck über der Einbuchtung ist nicht innen, obwohl alle Ecken innen liegen könnten', () => {
    expect(rechteckImPolygon(R(6, 8, 12, 12), L_FORM)).toBe(false);
  });
  it('bündig an der Kante zählt als innen (mit der 1-mm-Toleranz des Aufrufers)', () => {
    expect(rechteckImPolygon(R(0.001, 0.001, 19.999, 9.999), L_FORM)).toBe(true);
  });
  it('schmaler Schlitz durchs Rechteck wird erkannt', () => {
    // Quadrat 10×10 mit einem Schlitz von oben bis y = 2 bei x = 5
    const schlitz = P([[0, 0], [10, 0], [10, 10], [5.1, 10], [5.1, 2], [4.9, 2], [4.9, 10], [0, 10]]);
    expect(rechteckImPolygon(R(1, 4, 9, 6), schlitz)).toBe(false);
    expect(rechteckImPolygon(R(1, 0.5, 9, 1.5), schlitz)).toBe(true);
  });
});

describe('rechteckTrifftPolygon', () => {
  it('kleine Sperrfläche (Kamin) mitten im Modul trifft', () => {
    expect(rechteckTrifftPolygon(R(0, 0, 1.1, 1.7), P([[0.4, 0.7], [0.7, 0.7], [0.7, 1], [0.4, 1]]))).toBe(true);
  });
  it('angrenzende Fläche (gemeinsame Kante) trifft nicht', () => {
    expect(rechteckTrifftPolygon(R(0.001, 0.001, 0.999, 0.999), P([[1, 0], [2, 0], [2, 1], [1, 1]]))).toBe(false);
  });
  it('getrennte Fläche trifft nicht', () => {
    expect(rechteckTrifftPolygon(R(0, 0, 1, 1), P([[3, 3], [4, 3], [4, 4]]))).toBe(false);
  });
});

describe('Grundbausteine', () => {
  it('punktImPolygon', () => {
    expect(punktImPolygon({ x: 2, y: 15 }, L_FORM)).toBe(true);
    expect(punktImPolygon({ x: 15, y: 15 }, L_FORM)).toBe(false);
  });
  it('Strecke auf dem Rand schneidet nicht, quer durch schneidet', () => {
    expect(streckeSchneidetRechteck({ x: 0, y: 0 }, { x: 5, y: 0 }, R(0, 0, 5, 5))).toBe(false);
    expect(streckeSchneidetRechteck({ x: -1, y: 2 }, { x: 6, y: 2 }, R(0, 0, 5, 5))).toBe(true);
  });
});

describe('bandIntervalle', () => {
  it('Rechteck: ganzes Band ist ein Intervall', () => {
    const r = bandIntervalle(P([[0, 0], [10, 0], [10, 5], [0, 5]]), 1, 4);
    expect(r).toHaveLength(1);
    expect(r[0][0]).toBeCloseTo(0, 5);
    expect(r[0][1]).toBeCloseTo(10, 5);
  });
  it('L-Form: Band über die Innenecke wird auf den Flügel begrenzt', () => {
    const r = bandIntervalle(L_FORM, 8, 12);
    expect(r).toHaveLength(1);
    expect(r[0][1]).toBeCloseTo(8, 5);
  });
  it('leicht schiefe Unterkante kostet nur das Stück, wo sie ins Band ragt', () => {
    // Unterkante steigt von y = 0 (x = 0) auf y = 0.1 (x = 10)
    const r = bandIntervalle(P([[0, 0], [10, 0.1], [10, 5], [0, 5]]), 0.05, 2);
    expect(r).toHaveLength(1);
    expect(r[0][0]).toBeCloseTo(0, 5);
    expect(r[0][1]).toBeCloseTo(5, 3);
  });
  it('Einbuchtung von oben teilt das Band in zwei Abschnitte', () => {
    const u = P([[0, 0], [10, 0], [10, 5], [6, 5], [6, 2], [4, 2], [4, 5], [0, 5]]);
    const r = bandIntervalle(u, 3, 4);
    expect(r.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)])).toEqual([[0, 4], [6, 10]]);
    expect(bandIntervalle(u, 0.5, 1.5)).toHaveLength(1);
  });
  it('vereinigeIntervalle verschmilzt Überlappungen', () => {
    expect(vereinigeIntervalle([[5, 7], [0, 2], [1, 3]])).toEqual([[0, 3], [5, 7]]);
  });
});
