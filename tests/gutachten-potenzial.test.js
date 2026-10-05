// Vitest-Tests für lib/gutachten-potenzial.js — Potenzialanalyse.
import { describe, it, expect } from 'vitest';
import { PT_NICHT, ptTextNicht, ptGeoSondenfeld, ptTextGeoBerechnung, ptFoerdermenge, ptTextTiefengeothermie, ptTextLwwp, ptSchallRadius, ptTextSchall, ptBioKennwerte, ptTextBiomasse, ptTextGeoGrundlagen } from '../src/lib/gutachten-potenzial.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
const jdl = Float32Array.from({ length: 8760 }, (_, i) => 2000 * (1 - i / 8760));
const gesamt = jdl.reduce((a, b) => a + b, 0) / 1000;

describe('Nicht berücksichtigt', () => {
  it('alle Einträge mit Überschrift', () => {
    for (const k of Object.keys(PT_NICHT)) expect(text(ptTextNicht(k)).split('\n')[0]).toBe(PT_NICHT[k].titel);
    expect(text(ptTextNicht('gasGrundlast'))).toContain('[Vorgabe zum Zweistoffbrenner');
    expect(text(ptTextNicht('gasGrundlast', { vorgabeZsb: 'Schreiben X' }))).toContain('gemäß Schreiben X ein Zweistoffbrenner');
  });
});

describe('Geothermie', () => {
  it('Sondenfeld', () => {
    const f = ptGeoSondenfeld({ qPerM: 30, tiefe: 100, abstand: 10, jaz: 4, wpKw: 400, waermeMwh: 1000 });
    expect(f.entzugKw).toBeCloseTo(3, 9);
    expect(f.heizKw).toBeCloseTo(4, 9);
    expect(f.nLeistung).toBe(100);
    expect(f.flLeistung).toBe(10000);
    expect(f.nEnergie).toBe(Math.ceil(750000 / (3 * 2100)));
  });
  it('Text', () => {
    const t = text(ptTextGeoBerechnung({ lambda: 1.8, qPerM: 29, tiefe: 100, tiefe2: 200, abstand: 10, jaz: 4, jdlKw: jdl, gesamtMwh: gesamt }));
    expect(t).toContain('1,8 W/(m·K)');
    expect(t).toContain('mittleren Wert');
    expect(t).toContain('Deckungsrate von 65 %');
    expect(t).toContain('Bohrtiefe auf 200 m');
    expect(t).toContain('[Quelle der Wärmeleitfähigkeit');
    expect(text(ptTextGeoGrundlagen())).toContain('Erdwärmesonden');
  });
});

describe('Tiefengeothermie', () => {
  it('Fördermenge', () => {
    expect(ptFoerdermenge(4100, 65, 35)).toBeCloseTo(4100 / (4.1 * 30), 9);
    const t = text(ptTextTiefengeothermie({ leistungKw: 3000 }));
    expect(t).toContain('Fördertemperatur von etwa 65 °C und Abkühlung auf 35 °C rund 24 l/s');
    expect(t).toContain('Dublette');
  });
});

describe('Luft-WP und Schall', () => {
  it('Heizkurve und Anteile', () => {
    const t = text(ptTextLwwp({ vl15: 45, vlMinus5: 60, wpKw: 1500, jaz: 3, deckungPct: 90, waermeMwh: 5000, stromMwh: 1667, platzM2: 500 }));
    expect(t).toContain('Vorlauftemperatur von 45 °C');
    expect(t).toContain('linear auf 60 °C');
    expect(t).toContain('60 % der Wärme stammen aus der Umgebungsluft und 30 % aus dem Strombezug, der Spitzenlasterzeuger übernimmt 10 %');
  });
  it('Schall', () => {
    expect(ptSchallRadius(90, 90)).toBe(0);
    expect(ptSchallRadius(91, 40)).toBeCloseTo(10 ** 2, 9);
    expect(text(ptTextSchall({ lwaDb: 91 }))).toContain('in rund 100 m Abstand eingehalten');
  });
});

describe('Biomasse', () => {
  it('Kennwerte', () => {
    const k = ptBioKennwerte({ waermeMwh: 4800, leistungKw: 1000, preisCtKwh: { pellets: 7, hhs: 4 } });
    expect(k.pellets.tA).toBeCloseTo(4800 / 0.9 / 4.8, 6);
    expect(k.hhs.lagerM3).toBeGreaterThan(k.pellets.lagerM3);
    expect(k.pellets.kostenEur).toBeCloseTo(4800 / 0.9 * 70, 6);
  });
  it('Text mit vorhandenem Pelletkessel', () => {
    const t = text(ptTextBiomasse({ waermeMwh: 4800, leistungKw: 1000, preisCtKwh: { pellets: 7, hhs: 4 }, bestandPelletKw: 500, jdlKw: jdl }));
    expect(t).toContain('Einsparpotenzial');
    expect(t).toContain('ENplus A1');
    expect(t).toContain('Pelletkessel in der Heizzentrale mit 500 kW');
  });
});
