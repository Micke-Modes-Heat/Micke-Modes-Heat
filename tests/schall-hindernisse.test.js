import { describe, it, expect } from 'vitest';
import { hindernis, spektrumNormiert, abschirmungOktaven, OKTAVEN, streckeImGrundriss, abschirmung, beugungsDaempfung, spiegelquellen, reflexionGueltig, schallSzene, pegel3d, isophonen3d, immissionsort3d } from '../src/lib/schall-hindernisse.js';
import { pegelAm, isophonRadius } from '../src/lib/wp-schall.js';

const rechteck = (x0, y0, x1, y1) => [{ ost: x0, nord: y0 }, { ost: x1, nord: y0 }, { ost: x1, nord: y1 }, { ost: x0, nord: y1 }];

describe('Gebäude als Schallhindernisse', () => {
  it('Abschnitt einer Strecke im Grundriss', () => {
    const s = streckeImGrundriss(rechteck(10, -5, 20, 5), 0, 0, 50, 0);
    expect(s.a1).toBeCloseTo(10, 6);
    expect(s.a2).toBeCloseTo(20, 6);
    expect(streckeImGrundriss(rechteck(10, 5, 20, 15), 0, 0, 50, 0)).toBeNull();
  });

  it('dünne, breite Wand: Beugung über die Oberkante wie nach ISO 9613-2 (Handrechnung)', () => {
    const wand = h => [hindernis(1, rechteck(9.9, -500, 10.1, 500), h)];
    // h = 4 m, Quelle/Empfänger 2 m: z = 0,248 m, K_met = 0,904 → D_z ≈ 9,8 dB
    const a = abschirmung(wand(4), 0, 0, 2, 50, 0, 2);
    expect(a.oben).toBeCloseTo(9.8, 0);
    expect(a.abar).toBeCloseTo(a.oben, 1);   // seitlich kein Weg um 1 km Wand
    // h = 10 m: D_z gedeckelt auf 20 dB
    expect(abschirmung(wand(10), 0, 0, 2, 50, 0, 2).abar).toBeCloseTo(20.6, 0);   // 20 dB + Umweg
  });

  it('Sichtverbindung über ein niedriges Gebäude: keine Abschirmung', () => {
    expect(abschirmung([hindernis(1, rechteck(10, -5, 20, 5), 1)], 0, 0, 2, 50, 0, 2).abar).toBe(0);
    expect(abschirmung([], 0, 0, 2, 50, 0, 2).abar).toBe(0);
  });

  it('schmales, hohes Gebäude: der Schall läuft seitlich herum', () => {
    const a = abschirmung([hindernis(1, rechteck(19, -1, 21, 1), 30)], 0, 0, 2, 50, 0, 2);
    expect(a.oben).toBeGreaterThan(a.links);
    expect(a.links).toBeCloseTo(a.rechts, 6);
    expect(a.abar).toBeLessThan(a.links);
    expect(a.abar).toBeGreaterThan(3);
  });

  it('dickes Gebäude dämpft mehr als eine dünne Wand gleicher Höhe (Mehrfachbeugung)', () => {
    const duenn = abschirmung([hindernis(1, rechteck(19.9, -500, 20.1, 500), 3)], 0, 0, 2, 60, 0, 2).oben;
    const dick = abschirmung([hindernis(1, rechteck(15, -500, 25, 500), 3)], 0, 0, 2, 60, 0, 2).oben;
    expect(dick).toBeGreaterThan(duenn);
    expect(beugungsDaempfung(-1, 0, false, 1, 1, 10)).toBe(0);
  });

  it('Spiegelquelle an einer Wand hinter der Quelle; gilt nur auf der Seite der Quelle', () => {
    const h = [hindernis(1, rechteck(-20, 5, 20, 15), 8)];
    const sp = spiegelquellen([{ ost: 0, nord: 0, lwa: 90 }], h, 2);
    expect(sp).toHaveLength(1);
    expect(sp[0].nord).toBeCloseTo(10, 6);
    expect(sp[0].lwa).toBe(89);
    expect(reflexionGueltig(sp[0], 0, -30)).toBe(true);
    expect(reflexionGueltig(sp[0], 0, 40)).toBe(false);
    expect(spiegelquellen([{ ost: 0, nord: 0, lwa: 90 }], [hindernis(1, rechteck(-20, 5, 20, 15), 1)], 2)).toHaveLength(0);
  });

  it('Pegel: ohne Gebäude wie bisher; Wand hinter der Quelle bis +3 dB davor, Schatten dahinter', () => {
    const q = [{ ost: 0, nord: 0, lwa: 90 }];
    const frei = schallSzene(q, [], 2);
    // Oktavbänder: im Freifeld wie die Einzahlrechnung (nur die Luftabsorption ist je Oktave verschieden)
    expect(pegel3d(frei, 0, -40, 4).pegel).toBeCloseTo(pegelAm(q, 0, -40), 0);
    expect(Math.abs(pegel3d(frei, 0, -10, 4).pegel - pegelAm(q, 0, -10))).toBeLessThan(0.05);
    const sz = schallSzene(q, [hindernis(1, rechteck(-20, 5, 20, 15), 8)], 2);
    const vorn = pegel3d(sz, 0, -40, 4);
    // Spiegelquelle 50 m statt 40 m entfernt, ρ = 0,8: −2,9 dB gegenüber direkt → +1,8 dB
    expect(vorn.reflexion).toBeCloseTo(1.78, 1);
    expect(vorn.reflexion).toBeLessThan(3);
    const hinten = pegel3d(sz, 0, 40, 4);
    expect(hinten.frei - hinten.pegel).toBeGreaterThan(10);
  });

  it('Isophonen: ohne Gebäude wie die Freifeld-Isophone, im Schatten eines Gebäudes kürzer', () => {
    const q = [{ ost: 0, nord: 0, lwa: 95 }];
    const frei = isophonen3d(schallSzene(q, [], 2), [45], { strahlen: 36, hr: 2 }).get(45);
    const rFrei = isophonRadius(q, 45);
    for (const p of frei) expect(Math.hypot(p.ost, p.nord)).toBeCloseTo(rFrei, -1);
    const sz = schallSzene(q, [hindernis(1, rechteck(-15, 10, 15, 25), 10)], 2);
    const iso = isophonen3d(sz, [45], { strahlen: 36, hr: 4 }).get(45);
    const nord = iso[0], sued = iso[18];
    expect(Math.hypot(nord.ost, nord.nord)).toBeLessThan(Math.hypot(sued.ost, sued.nord) * 0.6);
  });

  it('Immissionsort: Gebäude im Schatten leiser als frei, obere Geschosse weniger abgeschirmt', () => {
    const q = [{ ost: 0, nord: 0, lwa: 95 }];
    const schirm = hindernis(1, rechteck(-15, 10, 15, 20), 6);
    const ziel = { id: 2, poly: rechteck(-10, 40, 10, 50), geschosse: 4 };
    const sz = schallSzene(q, [schirm, hindernis(2, ziel.poly, 12)], 2);
    const io = immissionsort3d(sz, ziel);
    expect(io.frei - io.pegel).toBeGreaterThan(3);
    expect(io.geschoss).toBe(3);
    // Quelle auf dem Dach eines Gebäudes: dieses Gebäude schirmt nicht ab
    const dach = schallSzene([{ ost: 0, nord: 0, lwa: 90 }], [hindernis(9, rechteck(-5, -5, 5, 5), 10)], 12);
    expect(dach.ohne.has(9)).toBe(true);
  });

  it('Oktavbänder: tiefe Frequenzen werden weniger abgeschirmt, tieffrequentes Spektrum ist hinter Gebäuden lauter', () => {
    const h = [hindernis(1, rechteck(9.5, -500, 10.5, 500), 5)];
    const a = abschirmungOktaven(h, 0, 0, 2, 50, 0, 2);
    expect(a).toHaveLength(OKTAVEN.length);
    for (let b = 1; b < a.length; b++) expect(a[b]).toBeGreaterThanOrEqual(a[b - 1]);
    expect(a[0]).toBeLessThan(a[3] - 5);
    const q = [{ ost: 0, nord: 0, lwa: 90 }];
    const tief = schallSzene(q, h, 2, [0, 0, -10, -20, -30, -40, -50, -60]);
    const hoch = schallSzene(q, h, 2, [-60, -50, -40, -30, -20, -10, 0, 0]);
    const lt = pegel3d(tief, 50, 0, 2), lh = pegel3d(hoch, 50, 0, 2);
    expect(lt.frei - lt.pegel).toBeLessThan(lh.frei - lh.pegel);
  });

  it('Spektrum normieren: Summe 0 dB, ungültige Angaben → null', () => {
    const n = spektrumNormiert([80, 80, 80, 80, 80, 80, 80, 80]);
    expect(n[0]).toBeCloseTo(-10 * Math.log10(8), 6);
    expect(spektrumNormiert([1, 2, 3])).toBeNull();
    expect(spektrumNormiert([1, 2, 3, 4, 5, 6, 7, 'x'])).toBeNull();
  });
});
