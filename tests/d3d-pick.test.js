// Vitest-Tests für lib/d3d-pick.js (Dachflächen in der 3D-Ansicht anklicken).
import { describe, it, expect } from 'vitest';
import {
  invertiere4, pickMatrix, sehstrahl, strahlDreieck, strahlQuader, pickSammler, naechsterTreffer,
  ebeneAzimut, ebeneNeigung, projiziere, ebeneAusDreieck, ebeneZ, strahlEbene, ebeneFallrichtung, rechteckAufEbene, rechteckAchsen, eckeEinrasten, viereckHalten,
} from '../src/lib/d3d-pick.js';

// Spaltenweise 4×4-Hilfen
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const proj = (r, i) => [r[0] * i[0] + r[4] * i[1] + r[8] * i[2] + r[12], r[1] * i[0] + r[5] * i[1] + r[9] * i[2] + r[13],
  r[2] * i[0] + r[6] * i[1] + r[10] * i[2] + r[14], r[3] * i[0] + r[7] * i[1] + r[11] * i[2] + r[15]];
const perspektive = (fovy, asp, n, f) => {
  const t = 1 / Math.tan(fovy / 2);
  return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0];
};
const verschiebung = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const skalierung = s => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
// Kamera 50 m über dem Ursprung, blickt senkrecht nach unten (−z)
const KAMERA = mul(perspektive(Math.PI / 3, 1, 1, 500), verschiebung(0, 0, -50));

describe('invertiere4', () => {
  it('liefert die Inverse', () => {
    const inv = invertiere4(KAMERA);
    const e = mul(KAMERA, inv);
    for (let i = 0; i < 16; i++) expect(e[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
  });
  it('null bei singulärer Matrix', () => {
    expect(invertiere4(new Array(16).fill(0))).toBeNull();
  });
});

describe('sehstrahl + strahlDreieck', () => {
  it('Bildmitte trifft das Dreieck unter der Kamera in 10 m Höhe', () => {
    const s = sehstrahl(KAMERA, 50, 50, 100, 100);
    const tri = [-5, -5, 10, 5, -5, 10, 0, 5, 10];
    const t = strahlDreieck(s.o, s.d, tri);
    expect(isFinite(t)).toBe(true);
    const p = s.o.map((v, k) => v + s.d[k] * t);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(10, 6);
  });
  it('Rand des Bildes verfehlt ein kleines Dreieck in der Mitte', () => {
    const s = sehstrahl(KAMERA, 2, 2, 100, 100);
    expect(strahlDreieck(s.o, s.d, [-1, -1, 10, 1, -1, 10, 0, 1, 10])).toBe(Infinity);
  });
});

describe('pickMatrix — Genauigkeit bei Mercator-Größenordnungen', () => {
  it('trifft auf Zentimeter genau, obwohl die Kameramatrix Einträge um 10^8 hat', () => {
    // Weltmaßstab wie MapLibre bei Zoom 19: 512·2^19 Pixel je Mercator-Einheit
    const welt = 512 * 2 ** 19;
    const U = { x: 0.5215, y: 0.3412, z: 0 };
    const mu = 1 / 40075016.68 / Math.cos(52 * Math.PI / 180);   // Mercator je Meter bei 52°
    // Absolute Kameramatrix: Szene um U, in Pixeln, Kamera 600 px darüber
    const absolut = mul(mul(perspektive(0.6435, 1.5, 1, 5000), verschiebung(0, 0, -600)),
      mul(skalierung(welt), verschiebung(-U.x, -U.y, -U.z)));
    const m = pickMatrix(absolut, U, mu);
    // Punkt 12,34 m östlich / 5,67 m „südlich" (Mercator-y wächst nach Süden) in 9 m Höhe
    const ziel = [12.34, 5.67, 9];
    const c = proj(m, [...ziel, 1]);
    const px = (c[0] / c[3] + 1) / 2 * 1500, py = (1 - c[1] / c[3]) / 2 * 1000;
    const s = sehstrahl(m, px, py, 1500, 1000);
    const tri = [ziel[0] - 1, ziel[1] - 1, 9, ziel[0] + 1, ziel[1] - 1, 9, ziel[0], ziel[1] + 1, 9];
    const t = strahlDreieck(s.o, s.d, tri);
    const p = s.o.map((v, k) => v + s.d[k] * t);
    expect(Math.abs(p[0] - ziel[0])).toBeLessThan(0.01);
    expect(Math.abs(p[1] - ziel[1])).toBeLessThan(0.01);
  });
});

describe('strahlQuader', () => {
  it('erkennt Treffer und Fehlschuss', () => {
    const b = [-1, -1, -1, 1, 1, 1];
    expect(strahlQuader([0, 0, 10], [0, 0, -1], b)).toBe(true);
    expect(strahlQuader([5, 0, 10], [0, 0, -1], b)).toBe(false);
    expect(strahlQuader([0, 0, 10], [0, 0, -1], b, 5)).toBe(false);   // erst nach tMax
  });
});

describe('pickSammler + naechsterTreffer', () => {
  const s = { o: [0, 0, 100], d: [0, 0, -1] };
  it('nimmt die nächste Fläche, auch wenn eine andere darunter liegt', () => {
    const p = pickSammler();
    p.beginne(1, 'unten'); p.dreieck([-5, -5, 5], [5, -5, 5], [0, 5, 5]);
    p.beginne(2, 'oben'); p.dreieck([-5, -5, 8], [5, -5, 8], [0, 5, 8]);
    const t = naechsterTreffer(s, p.flaechen);
    expect(t.gid).toBe(2);
    expect(t.key).toBe('oben');
    expect(t.punkt[2]).toBeCloseTo(8, 9);
  });
  it('Hindernis (Schlüssel null) verdeckt eine Fläche dahinter', () => {
    const p = pickSammler();
    p.beginne(1, 'dach'); p.dreieck([-5, -5, 5], [5, -5, 5], [0, 5, 5]);
    p.beginne(3, null); p.dreieck([-5, -5, 20], [5, -5, 20], [0, 5, 20]);
    expect(naechsterTreffer(s, p.flaechen).key).toBeNull();
  });
  it('gleiche Fläche wird zusammengeführt', () => {
    const p = pickSammler();
    p.beginne(1, 'a'); p.dreieck([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    p.beginne(1, 'b'); p.dreieck([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    p.beginne(1, 'a'); p.dreieck([0, 0, 1], [1, 0, 1], [0, 1, 1]);
    expect(p.flaechen).toHaveLength(2);
    expect(p.flaechen[0].tris).toHaveLength(18);
    expect(p.flaechen[0].box).toEqual([0, 0, 0, 1, 1, 1]);
  });
  it('kein Treffer → null', () => {
    expect(naechsterTreffer(s, [])).toBeNull();
  });
});

describe('ebeneAzimut / ebeneNeigung', () => {
  it('Ebene, die nach Süden fällt (Höhe wächst nach Norden)', () => {
    const e = { a: 0, b: Math.tan(30 * Math.PI / 180), c: 0 };
    expect(ebeneAzimut(e)).toBeCloseTo(180, 9);
    expect(ebeneNeigung(e)).toBeCloseTo(30, 9);
  });
  it('nach Osten fallend = 90°, waagrecht = null', () => {
    expect(ebeneAzimut({ a: -0.5, b: 0, c: 0 })).toBeCloseTo(90, 9);
    expect(ebeneAzimut({ a: 0, b: 0, c: 3 })).toBeNull();
  });
});

// Pick-Raum: x Ost, y SÜD. Dach fällt nach Süden: z nimmt nach Süden (y+) ab, 35°.
const T = Math.tan(35 * Math.PI / 180);
const SUEDDACH = [0, 0, 10, 10, 0, 10, 0, 5, 10 - 5 * T];   // Dreieck: First bei y=0, nach Süden fallend

describe('Zeichnen auf der Dachebene', () => {
  const e = ebeneAusDreieck(SUEDDACH);
  it('Ebene aus Dreieck: Höhe und Fallrichtung', () => {
    expect(ebeneZ(e, 3, 4)).toBeCloseTo(10 - 4 * T, 9);
    expect(ebeneFallrichtung(e)).toBeCloseTo(180, 6);
    expect(ebeneFallrichtung(ebeneAusDreieck([0, 0, 5, 1, 0, 5, 0, 1, 5]))).toBeNull();
  });
  it('Ostdach (fällt nach Osten) → 90°', () => {
    expect(ebeneFallrichtung(ebeneAusDreieck([0, 0, 10, 0, 5, 10, 5, 0, 10 - 5 * T]))).toBeCloseTo(90, 6);
  });
  it('Strahl–Ebene: senkrecht von oben', () => {
    const p = strahlEbene({ o: [2, 3, 100], d: [0, 0, -1] }, e);
    expect(p[2]).toBeCloseTo(10 - 3 * T, 9);
    expect(strahlEbene({ o: [2, 3, 100], d: [0, 0, 1] }, e)).toBeNull();   // Ebene hinter dem Strahl
  });
  it('Rechteck: an First/Falllinie ausgerichtet, Ecken auf der Ebene', () => {
    const { ecken, laenge, breite } = rechteckAufEbene([1, 1, 0], [4, 3, 0], 180, e);
    expect(laenge).toBeCloseTo(3, 9);
    expect(breite).toBeCloseTo(2, 9);
    for (const q of ecken) expect(q[2]).toBeCloseTo(ebeneZ(e, q[0], q[1]), 9);
    expect(ecken.map(q => q[0]).sort((a, b) => a - b)).toEqual([1, 1, 4, 4].map(x => expect.closeTo(x, 9)));
  });
  it('Begrenzung auf die Fläche und Einrasten an der Kante', () => {
    const grenzen = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const { ecken } = rechteckAufEbene([0.3, 0.2, 0], [12, 3, 0], 180, e, { grenzen, fang: 0.4 });
    const xs = ecken.map(q => q[0]), ys = ecken.map(q => q[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);    // eingerastet (0,3 < 0,4)
    expect(Math.max(...xs)).toBeCloseTo(10, 9);   // begrenzt
    expect(Math.min(...ys)).toBeCloseTo(0, 9);    // First eingerastet
    expect(Math.max(...ys)).toBeCloseTo(3, 9);
  });
  it('naechsterTreffer liefert das getroffene Dreieck', () => {
    const p = pickSammler();
    p.beginne(1, 'a'); p.dreieck([-5, -5, 1], [5, -5, 1], [0, 5, 1]); p.dreieck([-5, -5, 5], [5, -5, 5], [0, 5, 5]);
    const t = naechsterTreffer({ o: [0, 0, 100], d: [0, 0, -1] }, p.flaechen);
    expect(t.tri).toBe(9);
    expect(ebeneZ(ebeneAusDreieck(t.flaeche.tris, t.tri), 0, 0)).toBeCloseTo(5, 9);
  });
});

describe('projiziere', () => {
  it('ist die Umkehrung von sehstrahl', () => {
    const p = projiziere(KAMERA, [3, -2, 10], 100, 100);
    const s = sehstrahl(KAMERA, p[0], p[1], 100, 100);
    const t = strahlDreieck(s.o, s.d, [-50, -50, 10, 50, -50, 10, 0, 50, 10]);
    expect(s.o[0] + s.d[0] * t).toBeCloseTo(3, 6);
    expect(s.o[1] + s.d[1] * t).toBeCloseTo(-2, 6);
  });
  it('Punkt hinter der Kamera → null', () => {
    expect(projiziere(KAMERA, [0, 0, 80], 100, 100)).toBeNull();
  });
});

describe('eckeEinrasten', () => {
  // Dachfläche 10 × 5 (First bei y = 0), Achsen für Azimut 180 (Falllinie nach Süden = +y)
  const achsen = rechteckAchsen(180);
  const kanten = [[[0, 0], [10, 0]], [[10, 0], [10, 5]], [[10, 5], [0, 5]], [[0, 5], [0, 0]]];
  const punkte = [[0, 0], [10, 0], [10, 5], [0, 5]];
  it('Punkt hat Vorrang', () => {
    expect(eckeEinrasten([9.8, 0.2], { punkte, kanten }, { fang: 0.3 })).toEqual({ p: [10, 0], art: 'punkt' });
  });
  it('Kante: Projektion auf First', () => {
    const r = eckeEinrasten([4, 0.2], { punkte, kanten }, { fang: 0.3 });
    expect(r.art).toBe('kante');
    expect(r.p[0]).toBeCloseTo(4, 9);
    expect(r.p[1]).toBeCloseTo(0, 9);
  });
  it('Kante + Ausrichtung: Schnittpunkt', () => {
    // Nachbarecke bei x = 3 → Ecke rastet auf dem First bei x = 3 ein
    const r = eckeEinrasten([3.2, 0.15], { punkte, kanten, nachbarn: [[3, 2]], achsen }, { fang: 0.3 });
    expect(r.art).toBe('kante');
    expect(r.p[0]).toBeCloseTo(3, 9);
    expect(r.p[1]).toBeCloseTo(0, 9);
  });
  it('nur Ausrichtung an Nachbarn (rechtwinklig halten)', () => {
    const r = eckeEinrasten([6.1, 2.85], { punkte, kanten, nachbarn: [[6, 1], [3, 3]], achsen }, { fang: 0.3 });
    expect(r.art).toBe('achse');
    expect(r.p[0]).toBeCloseTo(6, 9);
    expect(r.p[1]).toBeCloseTo(3, 9);
  });
  it('nichts in Reichweite → unverändert', () => {
    expect(eckeEinrasten([5, 2.5], { punkte, kanten, nachbarn: [[1, 1]], achsen }, { fang: 0.3 })).toEqual({ p: [5, 2.5], art: null });
  });
});

describe('viereckHalten (Shift)', () => {
  const R = [[0, 0], [6, 0], [6, 3], [0, 3]];
  it('Rechteck bleibt Rechteck, gegenüberliegende Ecke bleibt', () => {
    const r = viereckHalten(R, 2, [8, 4]);
    expect(r).toEqual([[0, 0], [8, 0], [8, 4], [0, 4]]);
  });
  it('gedrehtes Rechteck (45°) behält Richtung der Kanten', () => {
    const c = Math.SQRT1_2;
    const G = [[0, 0], [2 * c, 2 * c], [2 * c - c, 2 * c + c], [-c, c]];   // 2 × 1, um 45° gedreht
    const r = viereckHalten(G, 2, [0, 3]);
    // Kanten an der festen Ecke 0 bleiben senkrecht zueinander
    const a = [r[1][0] - r[0][0], r[1][1] - r[0][1]], b = [r[3][0] - r[0][0], r[3][1] - r[0][1]];
    expect(a[0] * b[0] + a[1] * b[1]).toBeCloseTo(0, 9);
    expect(r[2]).toEqual([0, 3]);
    expect(r[0]).toEqual([0, 0]);
  });
  it('nicht vier Ecken → null', () => {
    expect(viereckHalten([[0, 0], [1, 0], [0, 1]], 0, [2, 2])).toBeNull();
  });
});
