import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';
import { auslegungsSpitze, spitzeHochrechnen, tagesmittel365, vorlaufNachHeizkurve, THETA_INNEN_HOCHRECHNUNG } from '../src/lib/auslegung.js';
import { lgSpitzenlast } from '../src/lib/gutachten-lastgang.js';

// Jahreslastgang mit einer Spitze von 1.000 kW am Tag 20 (Tagesmittel −5 °C), sonst 400 kW bei +5 °C
function jahr() {
  const lg = new Float32Array(8760).fill(400);
  const tageT = new Array(365).fill(5);
  tageT[20] = -5;
  lg[20 * 24 + 8] = 1000;
  return { lg, tageT };
}

describe('Auslegungsspitze', () => {
  it('aus Gebäudedaten: Σ Normheizlast × Gleichzeitigkeit + Netzverlust', () => {
    const { lg } = jahr();
    const a = auslegungsSpitze({ lastgangKw: lg, heizlastenKw: [600, 500, 400, 0], glf: 0.9, verlustKw: 50, normAt: -12 });
    expect(a.quelle).toBe('heizlast');
    expect(a.anzahl).toBe(3);
    expect(a.kw).toBeCloseTo(1500 * 0.9 + 50, 6);
    expect(a.lastgangKw).toBe(1000);
  });

  it('nie unter der Spitze des Lastgangs', () => {
    const { lg } = jahr();
    const a = auslegungsSpitze({ lastgangKw: lg, heizlastenKw: [300, 300], glf: 0.8, verlustKw: 10 });
    expect(a.kw).toBe(1000);
  });

  it('ohne Heizlasten: lineare Extrapolation auf die Normaußentemperatur wie im Gutachten (lgSpitzenlast)', () => {
    const { lg, tageT } = jahr();
    const a = auslegungsSpitze({ lastgangKw: lg, tageT, normAt: -12 });
    expect(a.quelle).toBe('hochrechnung');
    expect(a.tSpitze).toBe(-5);
    // 1.000 kW · (22 − (−12)) / (22 − (−5)) = 1.259 kW
    expect(a.kw).toBeCloseTo(1000 * 34 / 27, 3);
    expect(THETA_INNEN_HOCHRECHNUNG).toBe(22);
    expect(lgSpitzenlast(lg, tageT, -12).pNorm).toBeCloseTo(a.kw, 9);
    // Spitzentag kälter als die Normaußentemperatur: keine Hochrechnung
    expect(auslegungsSpitze({ lastgangKw: lg, tageT, normAt: -3 }).kw).toBe(1000);
    // ohne Tagestemperaturen: Spitze des Lastgangs
    const o = auslegungsSpitze({ lastgangKw: lg, tageT: null, normAt: -12 });
    expect(o.quelle).toBe('lastgang');
    expect(o.kw).toBe(1000);
    expect(spitzeHochrechnen(lg.slice(0, 100), tageT, -12)).toBeNull();
  });

  it('Tagesmittel und Heizkurve', () => {
    const t = new Float32Array(8760).fill(3);
    for (let h = 0; h < 24; h++) t[h] = h < 12 ? 0 : 10;
    const tm = tagesmittel365(t);
    expect(tm).toHaveLength(365);
    expect(tm[0]).toBeCloseTo(5, 9);
    expect(vorlaufNachHeizkurve(-12, 90, 70)).toBe(90);
    expect(vorlaufNachHeizkurve(5, 90, 70)).toBe(80);
    expect(vorlaufNachHeizkurve(20, 90, 70)).toBe(70);
  });
});

describe('Dispatch-Kern: Mindestleistung des Spitzenkessels im Auslegungsfall', () => {
  beforeAll(() => {
    loadScript('config/netz-kosten.js');
    loadScript('config/erzeuger-cfg.js');
    loadScript('config/optimizer-defaults.js');
    loadScript('01-globals-varianten.js');
    globalThis.recalcNetz = () => {};
    globalThis.recalcStromNetz = () => {};
    globalThis.redrawErzeugerIcons = () => {};
    globalThis.calcStromPanel = () => {};
    globalThis.saSetTab = () => {};
    globalThis.saCurrentTab = 'lastgang';
    globalThis.gebaeude = [];
    globalThis.isExcluded = () => false;
    globalThis.getComputedStats = g => ({ waerme: parseFloat(g.waerme) || 0, heizlast: parseFloat(g.heizlast) || 0 });
    globalThis.glLastgangKw = null;
    loadScript('lib/zielgroessen.js');
    loadScript('06c-dispatch-core.js');
  });

  const lauf = (erzList, extra = {}) => _dispatchCore({
    lastgangKw: new Float32Array(8760).fill(300), tempH: new Float32Array(8760).fill(5), vlH: new Float32Array(8760).fill(45),
    erzList, speicherParams: null, stProfile: null, stExcessH: null, bhkwSigma: 0.45, skEta: 0.99, lwwpMinCop: 1.5,
    quelleTemp: (key, tA) => (key === 'fg' ? 1 : tA), recordHourly: false, backupMode: false, ...extra,
  });
  const wp = { key: 'lwwp', typ: 'wp', leistKw: 500, guetegrad: 0.42 };
  const ausl = { kw: 600, normAt: -12, vorlauf: 70 };

  it('Luft-WP deckt das Klimajahr, bei −12 °C fehlen 284 kW → Spitzenkessel ohne Wärme, aber mit Leistung', () => {
    const ohne = lauf([wp]);
    expect(ohne.autoGkKwh).toBeCloseTo(0, 6);
    expect(ohne.autoGkPeakKw).toBeCloseTo(0, 6);
    const r = lauf([wp], { auslegung: ausl });
    // Leistungsfaktor bei −12 °C / VL 70 °C: 1 + 0,02·(−14) − 0,0025·35 = 0,6325
    expect(r.gesichertKw).toBeCloseTo(500 * 0.6325, 6);
    expect(r.autoGkAuslegungKw).toBeCloseTo(600 - 316.25, 6);
    expect(r.autoGkPeakKw).toBeCloseTo(283.75, 6);
    expect(r.autoGkKwh).toBeCloseTo(ohne.autoGkKwh, 6);
    expect(r.thKwh.lwwp).toBeCloseTo(ohne.thKwh.lwwp, 3);
  });

  it('Mindest-COP der Luft-WP und Fließgewässer unter 2 °C: im Auslegungsfall keine gesicherte Leistung', () => {
    expect(lauf([wp], { auslegung: ausl, lwwpMinCop: 2 }).gesichertKw).toBe(0);
    expect(lauf([{ key: 'fg', typ: 'wp', leistKw: 500, guetegrad: 0.5 }], { auslegung: ausl }).gesichertKw).toBe(0);
  });

  it('Kessel zählt mit Nennleistung; reicht er, bleibt kein Spitzenkessel', () => {
    const r = lauf([wp, { key: 'pellets', typ: 'fix', leistKw: 300, guetegrad: 0 }], { auslegung: ausl });
    expect(r.gesichertKw).toBeCloseTo(616.25, 6);
    expect(r.autoGkPeakKw).toBeCloseTo(0, 6);
  });

  it('Optimierer (Backup-Erzeuger): der Backup-Kessel wird auf die fehlende Leistung bemessen', () => {
    const r = lauf([wp, { key: 'gaskessel', typ: 'fix', leistKw: 1, guetegrad: 0 }], { auslegung: ausl, backupMode: true });
    expect(r.backupPeakKw).toBeCloseTo(283.75, 6);
    expect(r.autoGkPeakKw).toBeCloseTo(0, 6);
  });
});
