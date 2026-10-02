// Vitest-Tests für lib/eisspeicher.js — Physik, Regeneration, Sperre bei Vollvereisung, Auslegung.
import { describe, it, expect } from 'vitest';
import { EIS, eisAuslegungVorschlag, eisGeometrie, eisEinstrahlung, eisErdreichTemp, eisParameter, erstelleEisZustand, eisInvest, eisBewertung, eisQuellTempNaeherung } from '../src/lib/eisspeicher.js';

describe('Stoffwerte und Auslegung', () => {
  it('Schmelzwärme und Wärmekapazität je m³', () => {
    expect(EIS.latentKwhProM3).toBeCloseTo(92.8, 1);
    expect(EIS.cpKwhProM3K).toBeCloseTo(1.163, 3);
  });
  it('Faustwerte je kW WP-Leistung', () => {
    expect(eisAuslegungVorschlag(100)).toEqual({ volumenM3: 100, absorberM2: 260 });
    expect(eisAuslegungVorschlag(0)).toEqual({ volumenM3: 5, absorberM2: 10 });
  });
  it('Zylindergeometrie', () => {
    const g = eisGeometrie(100);
    expect(Math.PI * g.durchmesserM ** 3 / 4).toBeCloseTo(100, 6);
    expect(g.oberflaecheM2).toBeCloseTo(1.5 * Math.PI * g.durchmesserM ** 2, 6);
  });
  it('Investition', () => {
    expect(eisInvest(100, 260)).toBe(100 * 750 + 260 * 350);
  });
});

describe('Klima-Hilfsmodelle', () => {
  it('Einstrahlung nachts null, mittags im Juni höher als im Dezember', () => {
    expect(eisEinstrahlung(0)).toBe(0);
    const juni = 160 * 24 + 13, dez = 350 * 24 + 12;
    expect(eisEinstrahlung(juni)).toBeGreaterThan(eisEinstrahlung(dez));
    expect(eisEinstrahlung(juni)).toBeLessThanOrEqual(850 * EIS.bewoelkung);
  });
  it('Erdreich: Minimum im Februar, Maximum im August', () => {
    expect(eisErdreichTemp(44 * 24)).toBeCloseTo(EIS.erdMittel - EIS.erdAmplitude, 1);
    expect(eisErdreichTemp(226 * 24)).toBeCloseTo(EIS.erdMittel + EIS.erdAmplitude, 1);
  });
  it('Näherung der Quelltemperatur', () => {
    expect(eisQuellTempNaeherung(10 * 24)).toBe(-EIS.soleDeltaT);
    expect(eisQuellTempNaeherung(180 * 24)).toBe(8 - EIS.soleDeltaT);
  });
});

describe('Zustand', () => {
  it('fühlbar, dann latent bei 0 °C, dann gesperrt', () => {
    const z = erstelleEisZustand({ volumenM3: 10, absorberM2: 0, maxVereisungPct: 80, startW: 10 * EIS.cpKwhProM3K * 5 });
    expect(z.temp()).toBeCloseTo(5, 6);
    expect(z.quellTemp()).toBeCloseTo(5 - EIS.soleDeltaT, 6);
    z.entziehen(10 * EIS.cpKwhProM3K * 5);          // auf 0 °C abkühlen
    expect(z.temp()).toBeCloseTo(0, 6);
    expect(z.vereisung()).toBe(0);
    z.entziehen(10 * EIS.latentKwhProM3 * 0.4);      // 40 % gefroren
    expect(z.vereisung()).toBeCloseTo(0.4, 6);
    expect(z.temp()).toBe(0);
    const rest = z.verfuegbarKwh();
    expect(rest).toBeCloseTo(10 * EIS.latentKwhProM3 * 0.4, 3);
    expect(z.entziehen(rest + 100)).toBeCloseTo(rest, 3);  // nicht über die Grenze hinaus
    expect(z.gesperrt()).toBe(true);
    expect(z.vereisung()).toBeCloseTo(0.8, 6);
  });
  it('Absorber regeneriert bei Sonne, nicht in kalter Nacht; Erdreich wärmt einen vereisten Speicher', () => {
    const p = { volumenM3: 20, absorberM2: 50, maxVereisungPct: 85, startW: -500 };
    const sonne = erstelleEisZustand(p);
    sonne.regenerieren(160 * 24 + 13, 20);
    expect(sonne.statistik().absorberKwh).toBeGreaterThan(10);
    const nacht = erstelleEisZustand(p);
    nacht.regenerieren(20 * 24 + 2, -10);
    expect(nacht.statistik().absorberKwh).toBe(0);
    expect(nacht.statistik().erdreichKwh).toBeGreaterThan(0);
  });
  it('nicht über 25 °C regenerieren', () => {
    const z = erstelleEisZustand({ volumenM3: 1, absorberM2: 500, startW: EIS.cpKwhProM3K * 24.9 });
    for (let t = 160 * 24; t < 161 * 24; t++) z.regenerieren(t, 30);
    expect(z.temp()).toBeLessThanOrEqual(EIS.tMax + 1e-9);
  });
  it('Jahressimulation: ausreichender Speicher bleibt verfügbar, zu kleiner wird gesperrt', () => {
    const jahr = (volumenM3, absorberM2) => {
      const z = erstelleEisZustand({ volumenM3, absorberM2 });
      for (let t = 0; t < 8760; t++) {
        const tag = Math.floor(t / 24);
        const tLuft = 9 - 9 * Math.cos(2 * Math.PI * (tag - 15) / 365);
        z.regenerieren(t, tLuft);
        const bedarfQuelle = Math.max(0, 15 - tLuft) * 0.166;   // ~9,5 MWh/a Quellenwärme (10-kW-WP)
        if (z.entziehen(bedarfQuelle) < bedarfQuelle - 0.01) z.meldeGesperrt();
        z.stundeAbschliessen(t);
      }
      return z.statistik();
    };
    const gut = jahr(10, 26), knapp = jahr(3, 0);
    expect(gut.gesperrtH).toBe(0);
    expect(knapp.gesperrtH).toBeGreaterThan(gut.gesperrtH);
    expect(gut.absorberKwh + gut.erdreichKwh).toBeGreaterThan(0);
    expect(eisBewertung(knapp).status).toBe('unterdimensioniert');
    expect(eisBewertung(gut).absorberAnteil).toBeGreaterThan(0.5);
  });
  it('Parameter begrenzen den Vereisungsgrad', () => {
    expect(eisParameter({ volumenM3: 10, maxVereisungPct: 150 }).maxVereisung).toBe(1);
    expect(eisParameter({ volumenM3: 10 }).maxVereisung).toBe(0.85);
  });
});
