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

import { bewuchsDaempfungWeg, baumKoerper, baumSehne, baumBestand, bewuchsWeg, bewuchsDaempfung, BEWUCHS_DB_JE_M, LUFT_DB_JE_KM, SPEKTRUM_LWWP_TYPISCH } from '../src/lib/schall-hindernisse.js';
import { baumKrone } from '../src/lib/baeume-3d.js';

describe('Bewuchs — DIN ISO 9613-2 Anhang A', () => {
  it('Tabelle A.1: unter 10 m keine Dämpfung, 10–20 m feste Werte, darüber dB/m, ab 200 m gedeckelt', () => {
    expect(bewuchsDaempfungWeg(0).every(v => v === 0)).toBe(true);
    expect(bewuchsDaempfungWeg(9.99).every(v => v === 0)).toBe(true);
    expect(Array.from(bewuchsDaempfungWeg(10))).toEqual([0, 0, 1, 1, 1, 1, 2, 3]);
    expect(Array.from(bewuchsDaempfungWeg(19.9))).toEqual([0, 0, 1, 1, 1, 1, 2, 3]);
    const b50 = bewuchsDaempfungWeg(50);
    expect(b50[4]).toBeCloseTo(3, 9);      // 1 kHz: 0,06 dB/m · 50 m
    expect(b50[7]).toBeCloseTo(6, 9);      // 8 kHz: 0,12 dB/m · 50 m
    expect(bewuchsDaempfungWeg(500)[4]).toBeCloseTo(BEWUCHS_DB_JE_M[4] * 200, 9);
    expect(bewuchsDaempfungWeg(NaN).every(v => v === 0)).toBe(true);
  });

  // Unabhängige Prüfung der Sehne: dichtes Abtasten der Strecke gegen die Körperform
  const innen = (bk, x, y, z) => {
    const dx = x - bk.ost, dy = y - bk.nord, rad = Math.hypot(dx, dy);
    if (bk.form === 'ellipsoid') return (rad / bk.r) ** 2 + ((z - bk.zc) / bk.rz) ** 2 <= 1;
    return z >= bk.z0 && z <= bk.z1 && rad <= bk.r * (bk.z1 - z) / (bk.z1 - bk.z0);
  };
  const sehneAbgetastet = (bk, s, d) => {
    const N = 40000; let n = 0;
    for (let i = 0; i < N; i++) { const t = (i + 0.5) / N; if (innen(bk, s[0] + t * d[0], s[1] + t * d[1], s[2] + t * d[2])) n++; }
    return n / N * Math.hypot(...d);
  };
  const laenge = (t, d) => (t ? (t[1] - t[0]) * Math.hypot(...d) : 0);

  it('Sehne durch Ellipsoid- und Kegelkrone stimmt mit dichter Abtastung überein', () => {
    const laub = baumKoerper({ ost: 3, nord: -2, hoehe: 14, krone: 9, art: 'laub' });
    const nadel = baumKoerper({ ost: -4, nord: 5, hoehe: 18, krone: 6, art: 'nadel' });
    expect(laub.form).toBe('ellipsoid');
    expect(nadel.form).toBe('kegel');
    let n = 0;
    for (const bk of [laub, nadel]) {
      for (let k = 0; k < 40; k++) {
        const w = k * 2.399963;   // goldener Winkel: gleichmäßig über Richtungen
        const s = [bk.ost + 30 * Math.cos(w), bk.nord + 30 * Math.sin(w), 1 + (k % 7) * 1.8];
        const e = [bk.ost - 30 * Math.cos(w + 0.1) + (k % 5) - 2, bk.nord - 30 * Math.sin(w + 0.1), 1 + ((k * 3) % 11) * 1.5];
        const d = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
        const ana = laenge(baumSehne(bk, s[0], s[1], s[2], d[0], d[1], d[2]), d);
        const num = sehneAbgetastet(bk, s, d);
        expect(Math.abs(ana - num)).toBeLessThan(0.02);
        if (ana > 0.5) n++;
      }
    }
    expect(n).toBeGreaterThan(10);   // die Strahlen treffen die Kronen auch tatsächlich
  });

  it('Sehne: waagrecht durch die Kronenmitte = Kronendurchmesser, Strahl daneben = 0', () => {
    const bk = baumKoerper({ ost: 0, nord: 0, hoehe: 12, krone: 8, art: 'laub' });
    const zc = baumKrone({ hoehe: 12, krone: 8, art: 'laub' }).zc;
    expect(laenge(baumSehne(bk, -20, 0, zc, 40, 0, 0), [40, 0, 0])).toBeCloseTo(8, 6);
    expect(laenge(baumSehne(bk, -20, 2, zc, 40, 0, 0), [40, 0, 0])).toBeCloseTo(2 * Math.sqrt(16 - 4), 6);
    expect(baumSehne(bk, -20, 4.5, zc, 40, 0, 0)).toBeNull();
    expect(baumSehne(bk, -20, 0, 0.5, 40, 0, 0)).toBeNull();   // unter der Krone (Stammbereich)
  });

  const reihe = (abstand, n) => Array.from({ length: n }, (_, i) => ({ ost: 20 + i * abstand, nord: 0, hoehe: 12, krone: 8, art: 'nadel' }));
  const hoehe = baumKrone({ hoehe: 12, krone: 8, art: 'nadel' });
  const hKern = (hoehe.z0 + hoehe.z1) / 2 - 3;   // im unteren, breiten Teil des Kegels

  it('Weg durch Bewuchs: überlappende Kronen zählen einmal, ein einzelner Baum bleibt unter 10 m', () => {
    const einzel = baumBestand(reihe(8, 1));
    expect(bewuchsWeg(einzel, 0, 0, hKern, 60, 0, hKern)).toBeLessThan(8.001);
    expect(bewuchsDaempfung(einzel, 0, 0, hKern, 60, 0, hKern).every(v => v === 0)).toBe(true);
    // auf der Achse durch den Kegel in Höhe hKern ist die Kronenbreite kleiner als der Durchmesser; Abstand = Breite → berührend
    const b = baumKoerper(reihe(8, 1)[0]);
    const sehne = laenge(baumSehne(b, 0, 0, hKern, 60, 0, 0), [60, 0, 0]);
    expect(sehne).toBeGreaterThan(4);
    const dicht = baumBestand(reihe(sehne, 6));
    expect(bewuchsWeg(dicht, 0, 0, hKern, 100, 0, hKern)).toBeCloseTo(6 * sehne, 2);
    // gleiche Bäume im halben Abstand überlappen: Vereinigung statt Summe
    const ueberlappt = baumBestand(reihe(sehne / 2, 6));
    expect(bewuchsWeg(ueberlappt, 0, 0, hKern, 100, 0, hKern)).toBeCloseTo(5 * sehne / 2 + sehne, 2);
    // Strahl neben der Reihe, hoch darüber: nichts
    expect(bewuchsWeg(dicht, 0, 20, hKern, 100, 20, hKern)).toBe(0);
    expect(bewuchsWeg(dicht, 0, 0, 40, 100, 0, 40)).toBe(0);
    expect(bewuchsWeg(null, 0, 0, 2, 10, 0, 2)).toBe(0);
  });

  it('Pegel: dichter Waldstreifen dämpft nach Tabelle, ohne Bäume unverändert, Abschirmung bleibt getrennt', () => {
    const q = [{ ost: 0, nord: 0, lwa: 90 }];
    // Quelle in 4 m Höhe: Fichtenkronen beginnen erst bei ca. 3 m, darunter läuft der Schall durch den Stammbereich
    const ohne = schallSzene(q, [], 4);
    const leer = schallSzene(q, [], 4, null, []);
    expect(pegel3d(leer, 120, 0, 4).pegel).toBe(pegel3d(ohne, 120, 0, 4).pegel);
    expect(pegel3d(leer, 120, 0, 4).bewuchs).toBe(0);
    // 12 dicht stehende Fichten (je 8 m Krone, 6 m Abstand → überlappend) bilden einen Streifen quer zur Ausbreitung
    const streifen = Array.from({ length: 12 }, (_, i) => ({ ost: 40 + (i % 2) * 2, nord: -33 + i * 6, hoehe: 25, krone: 14, art: 'nadel' }));
    const mit = schallSzene(q, [], 4, null, streifen);
    const a = pegel3d(ohne, 120, 0, 5), b = pegel3d(mit, 120, 0, 5);
    const df = bewuchsWeg(mit.baeume, 0, 0, 4, 120, 0, 5);
    expect(df).toBeGreaterThan(10);
    // erwartete Wirkung nach Tabelle, energetisch über das Spektrum
    const band = bewuchsDaempfungWeg(df);
    const rel = SPEKTRUM_LWWP_TYPISCH;
    const s = 10 * Math.log10(rel.reduce((x, v) => x + 10 ** (v / 10), 0));
    let e0 = 0, e1 = 0;
    rel.forEach((v, i) => { const l = 90 + v - s - 20 * Math.log10(120) - 8 - LUFT_DB_JE_KM[i] * 120 / 1000; e0 += 10 ** (l / 10); e1 += 10 ** ((l - band[i]) / 10); });
    expect(a.pegel - b.pegel).toBeCloseTo(10 * Math.log10(e0 / e1), 1);
    expect(b.bewuchs).toBeCloseTo(a.pegel - b.pegel, 6);
    expect(b.pegel).toBeLessThan(a.pegel);
    expect(b.frei).toBeCloseTo(a.frei, 6);
    // zusammen mit einem Gebäude: beide Anteile wirken, die Bewuchsdämpfung steht getrennt im Ergebnis
    const geb = [hindernis(1, rechteck(20, -15, 30, 15), 8)];
    const beide = schallSzene(q, geb, 4, null, streifen), nurGeb = schallSzene(q, geb, 4);
    const c = pegel3d(beide, 120, 0, 5), d = pegel3d(nurGeb, 120, 0, 5);
    expect(c.pegel).toBeLessThan(d.pegel);
    expect(c.bewuchs).toBeGreaterThan(0);
    expect(pegel3d(beide, 120, 0, 5, { exakt: true }).bewuchs).toBeCloseTo(c.bewuchs, 6);
  });
});
