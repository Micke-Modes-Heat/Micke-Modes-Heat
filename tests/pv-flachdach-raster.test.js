// Vitest-Tests für die Flachdach-Helfer in lib/pv-raster.js: Ost-West an der
// Gebäudeachse, Doppelreihen, Wartungsgänge, Feldgrenzen.
import { describe, expect, it } from 'vitest';
import { rasterWinkelOstWest, reihenLagen, feldIntervalle, inFeldern, OW_PAAR_FUGE } from '../src/lib/pv-raster.js';

const grad = rad => Math.round(rad * 180 / Math.PI * 1e6) / 1e6;

describe('rasterWinkelOstWest', () => {
  it('ohne Achse genau Nord-Süd (wie bisher)', () => {
    expect(grad(rasterWinkelOstWest(null))).toBe(90);
  });
  it('Gebäude genau Nord-Süd oder Ost-West → Reihen Nord-Süd', () => {
    expect(grad(rasterWinkelOstWest(0))).toBe(90);
    expect(grad(rasterWinkelOstWest(90))).toBe(90);
  });
  it('schiefes Gebäude: die Achse näher an Nord-Süd zählt', () => {
    // Achse 20° (fast N-S) → Reihen 20° gedreht: θ = 20 + 90 = 110
    expect(grad(rasterWinkelOstWest(20))).toBe(110);
    // Achse 70° (fast O-W) → die Querachse 160° liegt näher an N-S: θ = 70
    expect(grad(rasterWinkelOstWest(70))).toBe(70);
  });
});

describe('reihenLagen', () => {
  const basis = { y0: 0, rand: 0, cellD: 1, pitchY: 2 };
  it('Einzelreihen im Reihenabstand, ohne Gänge wie bisher', () => {
    const r = reihenLagen({ ...basis, yMax: 9 });
    expect(r.map(x => x.y)).toEqual([0, 2, 4, 6, 8]);
    expect(r.every(x => x.paar === null)).toBe(true);
  });
  it('Süd: Gang breiter als der Reihenabstand weitet nur die Blockgrenze', () => {
    const r = reihenLagen({ ...basis, yMax: 20, gangAlle: 4, gangBreite: 2.5 });
    // 2 Reihen je Block ((4 + 1) / 2), danach Abstand 2,5 statt 1
    expect(r.map(x => x.y)).toEqual([0, 2, 5.5, 7.5, 11, 13, 16.5, 18.5]);
  });
  it('Süd: Gang schmaler als der Reihenabstand ändert nichts', () => {
    const ohne = reihenLagen({ ...basis, yMax: 20 }).map(x => x.y);
    const mit = reihenLagen({ ...basis, yMax: 20, gangAlle: 4, gangBreite: 0.5 }).map(x => x.y);
    expect(mit).toEqual(ohne);
  });
  it('Ost-West: Doppelreihen Rücken an Rücken mit gleicher Ausnutzung', () => {
    const r = reihenLagen({ ...basis, yMax: 8.05, ow: true });
    expect(r.map(x => x.paar)).toEqual([0, 1, 0, 1]);
    expect(r[1].y).toBeCloseTo(1 + OW_PAAR_FUGE, 9);
    expect(r[2].y).toBeCloseTo(4, 9);                 // Paar-Teilung 2 · pitchY
  });
  it('Ost-West: Gang zwischen zwei Doppelreihen', () => {
    const r = reihenLagen({ y0: 0, rand: 0, cellD: 1.1, pitchY: 1.1 / 0.85, yMax: 40, ow: true, gangAlle: 12, gangBreite: 1 });
    const paare = r.filter(x => x.paar === 0).map(x => x.y);
    const abstaende = paare.slice(1).map((y, i) => y - paare[i] - (2 * 1.1 + OW_PAAR_FUGE));
    // normale Fuge ~0,34 m, nach jedem Block 1,0 m
    expect(Math.min(...abstaende)).toBeCloseTo(2 * 1.1 / 0.85 - 2.2 - OW_PAAR_FUGE, 6);
    expect(Math.max(...abstaende)).toBeCloseTo(1, 6);
  });
  it('Ost-West: am Ende passt nur eine Reihe → einseitig', () => {
    const r = reihenLagen({ ...basis, yMax: 5.2, ow: true });
    expect(r.map(x => x.paar)).toEqual([0, 1, 0]);
  });
  it('Rand zählt am Ende mit', () => {
    expect(reihenLagen({ ...basis, yMax: 9, rand: 0.5 }).map(x => x.y)).toEqual([0, 2, 4, 6]);
  });
});

describe('feldIntervalle / inFeldern', () => {
  it('kurze Breite → ein Feld', () => {
    expect(feldIntervalle(0, 30, 40, 1)).toEqual([[0, 30]]);
    expect(feldIntervalle(0, 30, 0, 1)).toEqual([[0, 30]]);
  });
  it('lange Breite → gleich lange Felder ≤ feldMax mit Gassen', () => {
    const f = feldIntervalle(0, 100, 40, 1);
    expect(f).toHaveLength(3);
    const L = (100 - 2) / 3;
    f.forEach(([a, b]) => expect(b - a).toBeCloseTo(L, 9));
    expect(f[1][0] - f[0][1]).toBeCloseTo(1, 9);
    expect(f[2][1]).toBeCloseTo(100, 9);
  });
  it('genau passend: zwei 40-m-Felder auf 81 m', () => {
    expect(feldIntervalle(0, 81, 40, 1)).toEqual([[0, 40], [41, 81]]);
  });
  it('mit Modulraster: volle Felder + Restfeld, Gasse exakt, Gruppe mittig', () => {
    const f = feldIntervalle(0, 88, 40, 1, { cellW: 1.7, pitchX: 1.72 });
    const anzahl = ([a, b]) => Math.floor((b - a - 1.7) / 1.72 + 1e-9) + 1;
    expect(f.map(anzahl)).toEqual([23, 23, 4]);          // 50 statt 51 ohne Felder
    for (const iv of f) expect(iv[1] - iv[0]).toBeCloseTo((anzahl(iv) - 1) * 1.72 + 1.7, 4);
    for (const iv of f) expect(iv[1] - iv[0]).toBeLessThanOrEqual(40);
    expect(f[1][0] - f[0][1]).toBeCloseTo(1, 5);
    expect(f[0][0]).toBeCloseTo(88 - f[2][1], 5);
  });
  it('inFeldern schneidet ein Reihenstück an den Gassen', () => {
    const f = [[0, 40], [41, 81]];
    expect(inFeldern(10, 60, f)).toEqual([[10, 40], [41, 60]]);
    expect(inFeldern(40.2, 40.8, f)).toEqual([]);
    expect(inFeldern(5, 8, null)).toEqual([[5, 8]]);
  });
});
