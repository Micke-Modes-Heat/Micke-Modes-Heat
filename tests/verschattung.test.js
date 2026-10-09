// Vitest-Tests für lib/verschattung.js (PV-Verschattung durch Bäume und Gebäude).
import { describe, it, expect } from 'vitest';
import {
  vsSonnenstaende, vsHimmel, vsHindernisse, vsStrahl, vsFaktoren, vsStichprobe, vsNahe,
} from '../src/lib/verschattung.js';
import { baumKrone } from '../src/lib/baeume-3d.js';

const LAT = 48.5;
const OBEN = [0, 0, 1];
const sued30 = [0, -Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180)];   // Südfläche 30°
const baum = (x, y, hoehe, krone, art = 'laub') => ({ x, y, art, krone: baumKrone({ hoehe, krone, art }) });
const quader = (x0, y0, x1, y1, hoehe) => ({ ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], hoehe });
const faktor = (hind, n = sued30, p = [0, 0, 6]) => vsFaktoren([{ p, n, gruppe: 'a', gewicht: 1 }], vsHindernisse(hind), LAT);

describe('Sonnenstände und Himmel', () => {
  it('Mittagshöhe Juni ≈ 90 − 48,5 + 23,4, Dezember ≈ 90 − 48,5 − 23,4', () => {
    const s = vsSonnenstaende(LAT);
    const max = m => Math.max(...s[m].map(x => Math.asin(x.sinH) * 180 / Math.PI));
    expect(max(5)).toBeGreaterThan(64);
    expect(max(5)).toBeLessThan(65.5);
    expect(max(11)).toBeGreaterThan(17);
    expect(max(11)).toBeLessThan(19);
  });
  it('Mittagssonne steht im Süden (y < 0), Richtungen sind normiert', () => {
    const juni = vsSonnenstaende(LAT)[5];
    const mittag = juni.reduce((a, b) => (b.sinH > a.sinH ? b : a));
    expect(mittag.dir[1]).toBeLessThan(0);
    expect(Math.abs(mittag.dir[0])).toBeLessThan(0.1);
    for (const s of juni) expect(Math.hypot(...s.dir)).toBeCloseTo(1, 9);
  });
  it('Himmelsgewichte ergeben für die Waagrechte π (isotrop)', () => {
    const h = vsHimmel();
    expect(h.reduce((s, x) => s + x.w * x.dir[2], 0)).toBeCloseTo(Math.PI, 1);
  });
});

describe('vsStrahl', () => {
  const hind = vsHindernisse({ baeume: [baum(0, -10, 12, 8), baum(20, 0, 15, 5, 'nadel')], gebaeude: [quader(-5, 20, 5, 30, 10)] });
  it('trifft die Laubkrone im Süden, nicht daran vorbei', () => {
    const z = 6, ziel = [0, -10, baumKrone({ hoehe: 12, krone: 8, art: 'laub' }).zc];
    const d = [ziel[0], ziel[1], ziel[2] - z]; const l = Math.hypot(...d);
    expect(vsStrahl([0, 0, z], d.map(v => v / l), hind).laub).toBe(1);
    expect(vsStrahl([0, 0, z], [0, 0, 1], hind).laub).toBe(0);
  });
  it('trifft den Nadelbaum-Kegel, aber nicht über der Spitze', () => {
    expect(vsStrahl([0, 0, 5], [1, 0, 0.2].map(v => v / Math.hypot(1, 0.2)), hind).nadel).toBe(1);
    expect(vsStrahl([0, 0, 5], [1, 0, 1].map(v => v / Math.SQRT2), hind).nadel).toBe(0);
  });
  it('Gebäude: Wand trifft unterhalb der Höhe, darüber nicht', () => {
    const flach = [0, 1, 0.3].map(v => v / Math.hypot(1, 0.3));
    expect(vsStrahl([0, 0, 2], flach, hind).geb).toBe(true);
    expect(vsStrahl([0, 0, 2], [0, 1, 1].map(v => v / Math.SQRT2), hind).geb).toBe(false);
    expect(vsStrahl([0, 0, 11], flach, hind).geb).toBe(false);
  });
});

describe('vsFaktoren', () => {
  it('ohne Hindernisse = 1', () => {
    expect(faktor({}).faktor).toBe(1);
  });
  it('hoher Baum im Süden mindert deutlich, im Norden kaum', () => {
    const sued = faktor({ baeume: [baum(0, -8, 18, 10)] }).faktor;
    const nord = faktor({ baeume: [baum(0, 8, 18, 10)] }).faktor;
    expect(sued).toBeLessThan(0.85);
    expect(nord).toBeGreaterThan(0.95);
    expect(nord).toBeLessThan(1);
  });
  it('Kronen sind lichtdurchlässig: Baum mindert weniger als ein Gebäude gleicher Größe', () => {
    const laub = faktor({ baeume: [baum(0, -8, 18, 8)] }).faktor;
    const block = faktor({ gebaeude: [quader(-4, -12, 4, -4, 18)] }).faktor;
    expect(block).toBeLessThan(laub);
  });
  it('hohes Nachbargebäude im Süden: nur Gebäude-Anteil, Bäume-Anteil = 1', () => {
    const r = faktor({ gebaeude: [quader(-30, -16, 30, -10, 25)] });
    expect(r.faktor).toBeLessThan(0.7);
    expect(r.faktorBaeume).toBe(1);
    expect(r.faktorGebaeude).toBeCloseTo(r.faktor, 9);
  });
  it('Gruppen werden getrennt ausgewiesen und nach Modulen gewichtet', () => {
    const hind = vsHindernisse({ baeume: [baum(0, -8, 18, 10)] });
    const r = vsFaktoren([
      { p: [0, 0, 6], n: sued30, gruppe: 'sued', gewicht: 10 },
      { p: [0, 40, 6], n: OBEN, gruppe: 'frei', gewicht: 30 },
    ], hind, LAT);
    expect(r.gruppen.sued.faktor).toBeLessThan(0.85);
    expect(r.gruppen.frei.faktor).toBe(1);
    expect(r.gruppen.sued.module).toBe(10);
    expect(r.faktor).toBeGreaterThan(r.gruppen.sued.faktor);
  });
  it('Überlappender Grundriss (Punkt liegt im Nachbargebäude) zählt nicht als Schatten, wird aber gemeldet', () => {
    const r = faktor({ gebaeude: [{ id: 7, ...quader(-20, -20, 20, 20, 30) }] });
    expect(r.faktor).toBe(1);
    expect(r.ueberlappungen).toEqual([7]);
  });
  it('Verursacher: Verluste werden dem Hindernis zugeordnet, größter zuerst', () => {
    const r = faktor({
      baeume: [{ id: 3, ...baum(0, -8, 18, 10) }, { id: 4, ...baum(0, 30, 8, 4) }],
      gebaeude: [{ id: 9, ...quader(-40, -30, -25, -20, 20) }],
    });
    expect(r.verursacher[0].key).toBe('b3');
    const summe = r.verursacher.reduce((s, v) => s + v.anteil, 0);
    // Verluste je Hindernis ergeben zusammen den Gesamtverlust
    expect(summe).toBeCloseTo(1 - r.faktor, 2);
    expect(r.verursacher.every(v => v.anteil > 0)).toBe(true);
  });
  it('Punkte über allen Hindernissen bleiben unverschattet', () => {
    expect(faktor({ baeume: [baum(0, -8, 10, 8)] }, OBEN, [0, 0, 30]).faktor).toBe(1);
  });
});

describe('Hilfen', () => {
  it('vsStichprobe verteilt gleichmäßig', () => {
    expect(vsStichprobe(5, 10)).toEqual([0, 1, 2, 3, 4]);
    const s = vsStichprobe(100, 4);
    expect(s).toEqual([12, 37, 62, 87]);
  });
  it('vsNahe lässt ferne Hindernisse weg', () => {
    const hind = vsHindernisse({ baeume: [baum(0, 50, 10, 6), baum(0, 500, 10, 6)] });
    expect(vsNahe(hind, 0, 0).baeume).toHaveLength(1);
  });
});
