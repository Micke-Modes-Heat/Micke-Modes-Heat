// Vitest-Tests für lib/gutachten-lastgang.js — Witterung, Sommergrundlast, Spitzenlast-Extrapolation, EE-Leistung.
import { describe, it, expect } from 'vitest';
import { lgTextWitterung, lgTextGrundlast, lgSpitzenlast, lgTextSpitzenlast, lgTextDeckung } from '../src/lib/gutachten-lastgang.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
/** Lastgang: 200 kW Grundlast, Heizanteil 40 kW je K unter 15 °C nach Tagesmittel. */
function testJahr() {
  const tageT = Array.from({ length: 365 }, (_, d) => 9 - 9 * Math.cos(2 * Math.PI * (d - 15) / 365));
  tageT[20] = -8;
  const lg = new Float32Array(8760);
  for (let h = 0; h < 8760; h++) lg[h] = 200 + Math.max(0, 15 - tageT[Math.floor(h / 24)]) * 40;
  return { lg, tageT };
}

describe('Witterung', () => {
  it('mit Faktor', () => {
    const t = text(lgTextWitterung({ faktor: 1.08, messjahr: 2023, gMess: 3200, gMittel: 3456, vonJahr: 2003, bisJahr: 2022, grundlastKw: 300, vorMwh: 5000, nachMwh: 5300 }));
    expect(t).toContain('Messjahres 2023 (3.200 Kd) zum Mittel der Jahre 2003–2022 (3.456 Kd)');
    expect(t).toContain('wärmer');
    expect(t).toContain('von 5.000 MWh auf 5.300 MWh');
  });
  it('ohne Faktor bei Messung: Platzhalter', () => {
    expect(text(lgTextWitterung(null, { gemessen: true, messjahr: 2023 }))).toContain('Messjahres 2023');
    expect(lgTextWitterung(null, {})).toEqual([]);
  });
});

describe('Grundlast', () => {
  it('Sommermittel, Anteil, Aufteilung', () => {
    const { lg } = testJahr();
    const ges = lg.reduce((a, b) => a + b, 0) / 1000;
    const t = text(lgTextGrundlast({ lastgangKw: lg, gesamtMwh: ges, netzverlustMwh: 876 }));
    expect(t).toContain('Juli und August');
    expect(t).toContain('rund 100 kW');   // Netzverluste 876 MWh / 8760 h
  });
});

describe('Spitzenlast', () => {
  const { lg, tageT } = testJahr();
  it('Extrapolation auf Norm-AT', () => {
    const s = lgSpitzenlast(lg, tageT, -14);
    expect(s.tSpitze).toBe(-8);
    expect(s.pMax).toBeCloseTo(200 + 23 * 40, 3);
    expect(s.pNorm).toBeCloseTo(s.pMax * (22 + 14) / (22 + 8), 6);   // Methode des Gutachters: Verhältnis der Temperaturdifferenzen zu 22 °C
  });
  it('Text mit Reserve und Bestand', () => {
    const t = text(lgTextSpitzenlast({ lastgangKw: lg, tageT, normAtC: -14, auffaelligeNutzung: 'Unterkunft', bestandThermKw: 3000 }));
    expect(t).toContain('lineare Extrapolation');
    expect(t).toContain('Nutzungsart Unterkunft');
    expect(t).toContain('Leistungsreserve von rund');
    expect(text(lgTextSpitzenlast({ lastgangKw: lg, normAtC: -14 }))).toContain('[Gradtagzahlen');
  });
});

describe('Deckung', () => {
  it('GEG 65 % und 90 %', () => {
    const jdl = Float32Array.from({ length: 8760 }, (_, i) => 1000 * (1 - i / 8760));
    const t = text(lgTextDeckung({ jdlKw: jdl }));
    expect(t).toContain('Gebäudeenergiegesetzes');
    expect(t).toContain('regenerative Deckungsrate von 90 %');
  });
});
