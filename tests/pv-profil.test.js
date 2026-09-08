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

// ── Neu 09/2026: Klarhimmel-Geometrie + Wetterstreuung ─────────────────────
// Diese Tests sichern genau die Eigenschaften ab, wegen derer das alte
// Sinus-Profil ersetzt wurde (siehe Kopfkommentar in 09a-pv-profile.js).

describe('makePvProfile8760 — realistische Spitzenleistung', () => {
  const peakKwPerKwp = (aus, spez) => {
    const p = makePvProfile8760(aus);
    let max = 0, sum = 0;
    for (let i = 0; i < 8760; i++) { sum += p[i]; if (p[i] > max) max = p[i]; }
    return max / sum * spez;
  };

  it('Süd erreicht 0,78–0,92 kW/kWp (Stundenmittel)', () => {
    // Das alte Profil lag bei 0,465 kW/kWp — Faktor ~1,8 zu niedrig. Dadurch
    // erzeugte jede Einspeisegrenze oberhalb ~47 % der kWp rechnerisch null
    // Abregelung und die Rückspeise-Ampel war systematisch zu grün.
    const peak = peakKwPerKwp('sued', 1050);
    expect(peak).toBeGreaterThan(0.78);
    expect(peak).toBeLessThan(0.92);
  });

  it('Ost-West flacher als Süd, aber über 0,65 kW/kWp', () => {
    const peakOw = peakKwPerKwp('ostwest', 950);
    expect(peakOw).toBeGreaterThan(0.65);
    expect(peakOw).toBeLessThan(peakKwPerKwp('sued', 1050));
  });

  it('nennenswerter Energieanteil oberhalb 70 % der Nennleistung', () => {
    // Physikalisch liegen ~10–20 % des Jahresertrags über 0,7 kW/kWp.
    // Das alte Profil kam nie über 0,47 → exakt 0 %.
    const p = makePvProfile8760('sued');
    let sum = 0, hoch = 0;
    for (let i = 0; i < 8760; i++) { sum += p[i]; if (p[i] * 1050 > 0.7) hoch += p[i]; }
    const anteil = hoch / sum * 100;
    expect(anteil).toBeGreaterThan(8);
    expect(anteil).toBeLessThan(25);
  });
});

describe('makePvProfile8760 — Kalibrierung bleibt erhalten', () => {
  it('Monatsanteile entsprechen exakt _PV_MONTH', () => {
    const p = makePvProfile8760('sued');
    const monatsStunden = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];
    let ptr = 0;
    for (let m = 0; m < 12; m++) {
      let s = 0;
      for (let i = 0; i < monatsStunden[m]; i++) s += p[ptr++];
      expect(s).toBeCloseTo(_PV_MONTH.sued[m], 4);
    }
  });
});

describe('makePvProfile8760 — Wetterstreuung', () => {
  const tagesSummen = (p) => {
    const t = [];
    for (let d = 0; d < 365; d++) {
      let s = 0;
      for (let h = 0; h < 24; h++) s += p[d * 24 + h];
      t.push(s);
    }
    return t;
  };

  it('Tage eines Monats sind nicht mehr identisch', () => {
    const tage = tagesSummen(makePvProfile8760('sued')).slice(151, 181); // Juni
    const min = Math.min(...tage), max = Math.max(...tage);
    expect(max / min).toBeGreaterThan(2); // trüber vs. klarer Junitag
  });

  it('deterministisch — gleicher Seed liefert identische Werte', () => {
    const a = makePvProfile8760('sued', 4242);
    const b = makePvProfile8760('sued', 4242);
    for (let i = 0; i < 8760; i += 97) expect(b[i]).toBe(a[i]);
  });

  it('anderer Seed liefert ein anderes Wetterjahr bei gleicher Jahressumme', () => {
    const a = makePvProfile8760('sued', 1);
    const b = makePvProfile8760('sued', 2);
    let diff = 0, sumA = 0, sumB = 0;
    for (let i = 0; i < 8760; i++) { diff += Math.abs(a[i] - b[i]); sumA += a[i]; sumB += b[i]; }
    expect(diff).toBeGreaterThan(0.05);
    expect(sumA).toBeCloseTo(sumB, 4);
  });

  it('Schönwetter-/Trübphasen halten mehrere Tage an (Persistenz)', () => {
    // Ohne Persistenz wäre die Autokorrelation aufeinanderfolgender Tage ~0.
    // Für die Speicherauslegung ist genau diese Persistenz entscheidend.
    const t = tagesSummen(makePvProfile8760('sued')).slice(120, 240); // Mai–Aug
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    let cov = 0, varr = 0;
    for (let i = 0; i < t.length - 1; i++) cov += (t[i] - mean) * (t[i + 1] - mean);
    for (let i = 0; i < t.length; i++) varr += (t[i] - mean) ** 2;
    expect(cov / varr).toBeGreaterThan(0.15);
  });
});

describe('makePvProfile8760 — Tagesform', () => {
  it('Sommer-Mittagsspitze liegt wegen Sommerzeit bei 13:00–14:00 Ortszeit', () => {
    const p = makePvProfile8760('sued');
    // klarsten Junitag suchen, dann dessen Spitzenstunde
    let bestTag = 151, bestSum = -1;
    for (let d = 151; d < 181; d++) {
      let s = 0;
      for (let h = 0; h < 24; h++) s += p[d * 24 + h];
      if (s > bestSum) { bestSum = s; bestTag = d; }
    }
    let peakH = 0, peakV = -1;
    for (let h = 0; h < 24; h++) {
      const v = p[bestTag * 24 + h];
      if (v > peakV) { peakV = v; peakH = h; }
    }
    expect(peakH).toBeGreaterThanOrEqual(12);
    expect(peakH).toBeLessThanOrEqual(14);
  });

  it('Ost-West hat mittags einen kleineren Anteil am Tagesertrag als Süd', () => {
    const anteilMittag = (aus) => {
      const p = makePvProfile8760(aus);
      let tag = 0, mittag = 0;
      for (let d = 151; d < 181; d++) {
        for (let h = 0; h < 24; h++) {
          const v = p[d * 24 + h];
          tag += v;
          if (h >= 12 && h <= 14) mittag += v;
        }
      }
      return mittag / tag;
    };
    expect(anteilMittag('ostwest')).toBeLessThan(anteilMittag('sued'));
  });
});

describe('pvProfilKennwerte', () => {
  it('rechnet die Spitzenleistung aus einem normierten Profil zurück', () => {
    const p = makePvProfile8760('sued');
    const k = pvProfilKennwerte(p, 1050);
    let max = 0;
    for (let i = 0; i < 8760; i++) if (p[i] > max) max = p[i];
    expect(k.peakKwPerKwp).toBeCloseTo(max * 1050, 3);
    expect(k.vollLastStunden).toBeCloseTo(1050 / k.peakKwPerKwp, 1);
    expect(k.stundenMitErtrag).toBeGreaterThan(3800);
    expect(k.stundenMitErtrag).toBeLessThan(4800);
  });

  it('leeres Profil ergibt Nullwerte statt NaN', () => {
    const k = pvProfilKennwerte(null, 1050);
    expect(k.peakKwPerKwp).toBe(0);
    expect(k.vollLastStunden).toBe(0);
  });
});
