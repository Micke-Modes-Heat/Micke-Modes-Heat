// Vitest-Tests für lib/gutachten-abbildungen.js sowie Verbrauchsaufteilung (B4), LW-WP-Sweep (B5) und PV-Vergleich (B6).
import { describe, it, expect } from 'vitest';
import {
  abTagesmittel, abMonatsMwh, abKorrelation, abDeckungsKurve, abWoche, abLwwpSimulation, abLwwpSweep,
  abKostenstruktur, abPvVergleich, abWasserfallBedarf, abSchallAbstaende, abFahrplanPhasen,
} from '../src/lib/gutachten-abbildungen.js';
import { baVerbrauchsaufteilung, baNormalisiere } from '../src/lib/bestandsanlage.js';
import { vbTextAufteilung } from '../src/lib/gutachten-verbrauch.js';
import { ptTextLwwpSweep } from '../src/lib/gutachten-potenzial.js';
import { vaTextPv } from '../src/lib/gutachten-varianten.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

// Synthetisches Jahr: Temperatur als Kosinus (kalt im Januar), Leistung linear zur Differenz zu 22 °C plus Grundlast
const tageT = Array.from({ length: 365 }, (_, d) => 8 - 10 * Math.cos((2 * Math.PI * d) / 365));
const tempH = Float32Array.from({ length: 8760 }, (_, h) => tageT[Math.floor(h / 24)]);
const last = Float32Array.from({ length: 8760 }, (_, h) => 50 + Math.max(0, 15 - tempH[h]) * 20);
const text = b => wtKlartext(b);

describe('Lastgang-Auswertungen', () => {
  it('Tagesmittel und Monatssummen', () => {
    expect(abTagesmittel(last)).toHaveLength(365);
    const m = abMonatsMwh(last);
    expect(m).toHaveLength(12);
    expect(m.reduce((a, b) => a + b, 0)).toBeCloseTo(last.reduce((a, b) => a + b, 0) / 1000, 3);
    expect(m[0]).toBeGreaterThan(m[6]);
  });
  it('Korrelation: Regression fällt, Extrapolation über 22 °C', () => {
    const k = abKorrelation(last, tageT, -12);
    expect(k.punkte).toHaveLength(365);
    expect(k.regression.b).toBeCloseTo(-20, 0);
    expect(k.bestimmtheit).toBeGreaterThan(0.95);
    expect(k.spitzeLinie[0]).toEqual({ x: 22, y: 0 });
    expect(k.spitzeLinie.at(-1).x).toBe(-12);
    expect(abKorrelation(last, null, -12)).toBeNull();
  });
  it('Deckungskurve steigt monoton bis 100 %', () => {
    const jdl = Array.from(last).sort((a, b) => b - a);
    const k = abDeckungsKurve(jdl, 20);
    expect(k[0].y).toBe(0);
    expect(k.at(-1).y).toBeCloseTo(100, 6);
    for (let i = 1; i < k.length; i++) expect(k[i].y).toBeGreaterThanOrEqual(k[i - 1].y);
  });
  it('Sommerwoche beginnt am ersten Montag im August', () => {
    const w = abWoche(last, 2023);
    expect(w.start).toBe('2023-08-07');
    expect(w.daten).toHaveLength(168);
    expect(w.ticks[0].label).toBe('Mo 07.08.');
  });
});

describe('Luft-WP (B5)', () => {
  const e = { lastgangKw: last, tempH, vlC: 55, guete: 0.45 };
  it('Simulation: Bilanz und JAZ', () => {
    const r = abLwwpSimulation({ ...e, nennKw: 200 });
    expect(r.waermeMwh + r.spitzeMwh).toBeCloseTo(r.gesamtMwh, 6);
    expect(r.umweltMwh + r.stromMwh).toBeCloseTo(r.waermeMwh, 6);
    expect(r.jaz).toBeGreaterThan(2);
    expect(r.leistungKaltKw).toBeLessThan(200);
  });
  it('Sweep trifft die Deckungsgrade; mehr Deckung braucht überproportional mehr Leistung', () => {
    const s = abLwwpSweep(e, [50, 65, 80]);
    expect(s.map(x => Math.round(x.deckungPct))).toEqual([50, 65, 80]);
    expect(s[2].nennKw / s[0].nennKw).toBeGreaterThan(1.6);
    const t = text(ptTextLwwpSweep(s));
    expect(t).toContain('Prozentpunkte mehr Deckung');
    expect(t).toContain('Nennleistung von rund');
  });
  it('Standard 65/90/99/100 %: 100 % ohne Spitzenlasterzeuger, letzte Prozentpunkte gesondert', () => {
    const s = abLwwpSweep(e);
    expect(s.map(x => x.ziel)).toEqual([65, 90, 99, 100]);
    expect(s.every(x => x.erreichbar)).toBe(true);
    expect(s.slice(0, 3).map(x => Math.round(x.deckungPct * 10) / 10)).toEqual([65, 90, 99]);
    expect(s[3].deckungPct).toBeCloseTo(100, 6);
    expect(s[3].restMaxKw).toBeLessThan(1);
    expect(s[3].nennKw).toBeGreaterThan(s[2].nennKw);
    const t = text(ptTextLwwpSweep(s));
    expect(t).toContain('4 Deckungsgrade');
    expect(t).toContain('am letzten Prozentpunkt');
    expect(t).toContain('ein Spitzenlasterzeuger ist rechnerisch nicht mehr erforderlich');
    expect(t).toContain('Erst bei vollständiger Deckung entfällt der Spitzenlasterzeuger');
  });
  it('nicht erreichbarer Deckungsgrad bei Sperre unter Mindest-COP', () => {
    const s = abLwwpSweep({ ...e, minCop: 3.2 }, [100]);
    expect(s[0].erreichbar).toBe(false);
    expect(text(ptTextLwwpSweep(s))).toContain('nicht erreichbar');
  });
});

describe('Varianten: Kostenstruktur und PV (B6)', () => {
  const v = [
    { name: 'V1', wirtKomp: { kapitalEur: 100000, betriebEur: 20000, jkAnlagenEur: 120000, energieEur: 200000, co2Eur: 10000, pvJkEur: 15000, pvEnergieEur: 40000, pvCo2Eur: 3000, gesamtMwh: 4000 } },
    { name: 'V2', wirtKomp: { kapitalEur: 80000, betriebEur: 15000, jkAnlagenEur: 95000, energieEur: 260000, co2Eur: 40000, pvJkEur: 15000, pvEnergieEur: 10000, pvCo2Eur: 1000, gesamtMwh: 4000 } },
    { name: 'ohne Aufteilung' },
  ];
  it('Kostenstruktur in ct/kWh', () => {
    const r = abKostenstruktur(v);
    expect(r).toHaveLength(2);
    expect(r[0].kapital).toBeCloseTo(2.5, 6);
    expect(r[0].summe).toBeCloseTo((345000 / 4000) / 10, 6);
  });
  it('mit/ohne PV und Text', () => {
    const r = abPvVergleich(v);
    expect(r[0].mitCt).toBeCloseTo(345000 / 40000, 6);
    expect(r[0].ohneCt).toBeCloseTo((345000 - 15000 + 43000) / 40000, 6);
    const t = text(vaTextPv({ vergleich: r }));
    expect(t).toContain('Den größten Vorteil erzielt V1');
    expect(t).toMatch(/Rangfolge/);
    expect(text(vaTextPv({}))).toContain('PV-Anlage im Strom-Panel');
  });
});

describe('Verbrauchsaufteilung (B4)', () => {
  const geb = [{ name: 'A', modellMwh: 600, bgfM2: 4000, referenzSpez: 100 }, { name: 'B', modellMwh: 400, bgfM2: 2000 }];
  it('WMZ Netzeinspeisung: Netzverluste abziehen, proportional verteilen', () => {
    const r = baVerbrauchsaufteilung({ messungMwh: 1300, messpunkt: 'einspeisung', netzverlustMwh: 100, gebaeude: geb });
    expect(r.nutzMwh).toBe(1200);
    expect(r.faktor).toBeCloseTo(1.2, 9);
    expect(r.zeilen[0]).toMatchObject({ name: 'A', mwh: 720, spez: 180 });
  });
  it('Brennstoffzähler: Kesselnutzungsgrad, WMZ an Gebäuden: keine Netzverluste', () => {
    const b = baVerbrauchsaufteilung({ messungMwh: 1000, messpunkt: 'brennstoff', kesselEtaPct: 80, netzverlustMwh: 100, gebaeude: geb });
    expect(b.kesselverlustMwh).toBeCloseTo(200, 9);
    expect(b.nutzMwh).toBeCloseTo(700, 9);
    expect(baVerbrauchsaufteilung({ messungMwh: 1000, messpunkt: 'gebaeude', netzverlustMwh: 100, gebaeude: geb }).nutzMwh).toBe(1000);
    expect(baVerbrauchsaufteilung({ messungMwh: 50, netzverlustMwh: 100, gebaeude: geb })).toBeNull();
  });
  it('Text und Normalisierung', () => {
    const r = baVerbrauchsaufteilung({ messungMwh: 1000, messpunkt: 'brennstoff', netzverlustMwh: 100, gebaeude: geb });
    const t = text(vbTextAufteilung(r, { quelle: 'Verbrauchsdaten 2023' }));
    expect(t).toContain('Jahresnutzungsgrad von 90 %');
    expect(t).toContain('Verluste des Wärmeversorgungsnetzes');
    expect(baNormalisiere({ messpunkt: 'quatsch' }).messpunkt).toBe('einspeisung');
    expect(baNormalisiere({ messpunkt: 'brennstoff', kesselEtaPct: 88 })).toMatchObject({ messpunkt: 'brennstoff', kesselEtaPct: '88' });
  });
});

describe('Wasserfall, Schall, Fahrplan', () => {
  it('Wasserfall Ist → Soll', () => {
    const a = { jahre: [{ jahr: 2025, bedarfMwh: 1000 }, { jahr: 2030, bedarfMwh: 900 }], ereignisseJahr: [{ art: 'abriss', anzahl: 2, deltaMwh: -200 }, { art: 'neubau', anzahl: 1, deltaMwh: 100 }] };
    const b = abWasserfallBedarf(a);
    expect(b.map(x => x.label)).toEqual(['Ist 2025', 'Abriss', 'Neubau', 'Soll 2030']);
    expect(abWasserfallBedarf({ jahre: [{}] })).toEqual([]);
  });
  it('Schallabstände wachsen zur Nacht und zum reinen Wohngebiet', () => {
    const r = abSchallAbstaende(80);
    expect(r).toHaveLength(5);
    expect(r.at(-1).rNacht).toBeGreaterThan(r.at(-1).rTag);
    expect(r.at(-1).rNacht).toBeGreaterThan(r[0].rNacht);
  });
  it('Fahrplanphasen', () => {
    const p = abFahrplanPhasen(2027);
    expect(p[0]).toMatchObject({ von: 2027, bis: 2027 });
    expect(p.at(-1)).toMatchObject({ von: 2037, bis: 2045 });
    const q = abFahrplanPhasen(2027, 2045, { wp: false, fossil: false, name: 'Pellets' }, [{ name: 'Stufe 1', von: 2028, bis: 2030 }]);
    expect(q.map(x => x.name)).toEqual(['Sofortmaßnahmen: PV auf Neubauten', 'Bestandsaufnahme Elektro und Heiztechnik', 'Fachplanung Pellets', 'Errichtung und Inbetriebnahme Erzeuger', 'Ausbaustufe: Stufe 1']);
  });
});
