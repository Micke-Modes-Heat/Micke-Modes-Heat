// Vitest-Tests für lib/baum-vorlagen.js (Vorlagen für von Hand gesetzte Bäume und Bestände).
import { describe, it, expect } from 'vitest';
import { BAUM_VORLAGEN, vorlageBaum, vorlageFlaeche, vorlageHoehe, vorlageText, rauschFeld } from '../src/lib/baum-vorlagen.js';
import { baumZufall } from '../src/lib/baeume-3d.js';

const quadrat = a => [[0, 0], [a, 0], [a, a], [0, a]];
const mittel = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = xs => { const m = mittel(xs); return Math.sqrt(mittel(xs.map(x => (x - m) ** 2))); };

describe('Vorlagen', () => {
  it('alle Vorlagen sind vollständig und die Anteile summieren sich zu 1', () => {
    for (const [id, v] of Object.entries(BAUM_VORLAGEN)) {
      expect(v.name, id).toBeTruthy();
      expect(['einzel', 'bestand'], id).toContain(v.gruppe);
      expect(v.abstand, id).toBeGreaterThan(0);
      expect(v.schichten.reduce((s, k) => s + k.anteil, 0), id).toBeCloseTo(1, 9);
    }
  });

  it('Kurzbeschreibung nennt Mischung, Höhenspanne und Abstand', () => {
    const t = vorlageText(BAUM_VORLAGEN.mischwald);
    expect(t).toContain('60 % Laub');
    expect(t).toContain('40 % Nadel');
    expect(t).toMatch(/\d+–\d+ m/);
    expect(t).toContain('Abstand 6 m');
  });
});

describe('vorlageBaum', () => {
  it('streut die Höhe um den Mittelwert, „gleichmäßig" deutlich weniger als „stark"', () => {
    const v = BAUM_VORLAGEN.laub;
    const z = baumZufall(7);
    const nat = Array.from({ length: 800 }, () => vorlageBaum(v, z).hoehe);
    const gleich = Array.from({ length: 800 }, () => vorlageBaum(v, z, { streuung: 'gleich' }).hoehe);
    const stark = Array.from({ length: 800 }, () => vorlageBaum(v, z, { streuung: 'stark' }).hoehe);
    expect(mittel(nat)).toBeGreaterThan(13);
    expect(mittel(nat)).toBeLessThan(15);
    expect(sd(nat)).toBeGreaterThan(2.5);
    expect(sd(gleich)).toBeLessThan(sd(nat) / 2);
    expect(sd(stark)).toBeGreaterThan(sd(nat));
    expect(new Set(nat).size).toBeGreaterThan(50);              // nicht alle gleich hoch
  });

  it('mittlere Höhe skaliert die ganze Vorlage', () => {
    const v = BAUM_VORLAGEN.mischwald;
    const z = baumZufall(3);
    const hs = Array.from({ length: 600 }, () => vorlageBaum(v, z, { hoeheMittel: 12 }).hoehe);
    expect(mittel(hs)).toBeGreaterThan(10.5);
    expect(mittel(hs)).toBeLessThan(13.5);
    expect(vorlageHoehe(v)).toBeCloseTo(24.8, 6);
  });

  it('mischt die Arten nach Anteil', () => {
    const z = baumZufall(11);
    const arten = Array.from({ length: 2000 }, () => vorlageBaum(BAUM_VORLAGEN.mischwald, z).art);
    const nadel = arten.filter(a => a === 'nadel').length / arten.length;
    expect(nadel).toBeGreaterThan(0.33);
    expect(nadel).toBeLessThan(0.47);
  });

  it('Krone im Bestand höchstens ~1,4 × Abstand, am Rand breiter und Baum niedriger', () => {
    const z1 = baumZufall(5), z2 = baumZufall(5);
    const innen = vorlageBaum(BAUM_VORLAGEN.laubwald, z1, { kroneMax: 8, hoeheFeld: 0, rand: 0 });
    const rand = vorlageBaum(BAUM_VORLAGEN.laubwald, z2, { kroneMax: 8, hoeheFeld: 0, rand: 1 });
    expect(innen.krone).toBeLessThanOrEqual(8);
    expect(rand.krone).toBeGreaterThan(innen.krone);
    expect(rand.hoehe).toBeLessThan(innen.hoehe);
  });
});

describe('rauschFeld', () => {
  it('ist glatt: Nachbarpunkte ähnlich, ferne Punkte unabhängig', () => {
    const F = rauschFeld(42, 25);
    let nah = 0, fern = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 13.7, y = i * 7.3;
      nah += Math.abs(F(x, y) - F(x + 1, y));
      fern += Math.abs(F(x, y) - F(x + 400, y + 300));
      expect(Math.abs(F(x, y))).toBeLessThanOrEqual(1);
    }
    expect(nah * 5).toBeLessThan(fern);
  });
});

describe('vorlageFlaeche', () => {
  it('füllt die Fläche mit gestreuten Höhen, Unterwuchs und Lücken', () => {
    const v = BAUM_VORLAGEN.mischwald;
    const b = vorlageFlaeche(v, quadrat(120), { zufall: baumZufall(1), seed: 1 });
    const haupt = b.filter(x => !x.unterstand), unter = b.filter(x => x.unterstand);
    // Volles Raster wären 120² / (6² · 0,866) ≈ 462 Bäume; Lücken nehmen ein paar weg
    expect(haupt.length).toBeGreaterThan(380);
    expect(haupt.length).toBeLessThan(470);
    expect(unter.length).toBeCloseTo(haupt.length * 0.15, -1);
    expect(mittel(unter.map(x => x.hoehe))).toBeLessThan(mittel(haupt.map(x => x.hoehe)) * 0.6);
    const hs = haupt.map(x => x.hoehe);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(10);
    expect(b.every(x => x.x >= 0 && x.x <= 120 && x.y >= 0 && x.y <= 120)).toBe(true);
    expect(b.every(x => x.krone <= 6 * 1.4 * 1.25 + 1e-9)).toBe(true);
  });

  it('Arten stehen in Gruppen (Nachbarn häufiger gleich als zufällig)', () => {
    const b = vorlageFlaeche(BAUM_VORLAGEN.mischwald, quadrat(200), { zufall: baumZufall(2), seed: 2 }).filter(x => !x.unterstand);
    const p = b.filter(x => x.art === 'nadel').length / b.length;
    const zufallsGleich = p * p + (1 - p) * (1 - p);
    let gleich = 0, paare = 0;
    for (const a of b) {
      for (const c of b) {
        if (a === c) continue;
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        if (d < 7.5) { paare++; if (a.art === c.art) gleich++; }
      }
    }
    expect(gleich / paare).toBeGreaterThan(zufallsGleich + 0.05);
  });

  it('spart Sperrflächen (Gebäude) aus', () => {
    const haus = [[40, 40], [80, 40], [80, 80], [40, 80]];
    const b = vorlageFlaeche(BAUM_VORLAGEN.laubwald, quadrat(120), { zufall: baumZufall(3), sperren: [haus] });
    expect(b.some(x => x.x > 41 && x.x < 79 && x.y > 41 && x.y < 79)).toBe(false);
  });
});
