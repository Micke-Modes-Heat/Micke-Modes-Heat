// Vitest-Tests für lib/tww-dezentral.js — Trinkwarmwasser dezentral, Wärmenetz im Sommer aus.
import { describe, it, expect } from 'vitest';
import { netzBetriebStunden, raumwaermeImBetrieb, raumwaermeAusLastgang } from '../src/lib/tww-dezentral.js';
import { lgTextGrundlast } from '../src/lib/gutachten-lastgang.js';
import { buildBuildingHeatProfile } from '../src/lib/building-heat-profiles.js';

// Jahresgang: Tagesmittel 0 °C im Januar bis 20 °C im Juli
const tempH = Float32Array.from({ length: 8760 }, (_, h) => 10 - 10 * Math.cos(2 * Math.PI * (Math.floor(h / 24) - 15) / 365));

describe('netzBetriebStunden', () => {
  it('Netz im Winter an, im Hochsommer aus, ganze Tage', () => {
    const an = netzBetriebStunden(tempH, 15, 3);
    expect(an[10 * 24]).toBe(1);          // Januar
    expect(an[196 * 24 + 5]).toBe(0);     // Mitte Juli
    for (let d = 0; d < 365; d++) for (let h = 1; h < 24; h++) expect(an[d * 24 + h]).toBe(an[d * 24]);
    const aus = 365 - an.reduce((s, v) => s + v, 0) / 24;
    expect(aus).toBeGreaterThan(60);
    expect(aus).toBeLessThan(200);
  });
  it('höhere Heizgrenze → längere Heizperiode', () => {
    const summe = g => netzBetriebStunden(tempH, g, 3).reduce((s, v) => s + v, 0);
    expect(summe(17)).toBeGreaterThan(summe(15));
  });
});

describe('raumwaermeImBetrieb', () => {
  it('außerhalb des Betriebs null, Jahresmenge bleibt erhalten', () => {
    const raum = Float32Array.from({ length: 8760 }, (_, h) => Math.max(0, 15 - tempH[h]) * 10);
    const an = netzBetriebStunden(tempH, 15, 3);
    const r = raumwaermeImBetrieb(raum, an);
    const sum = a => a.reduce((s, v) => s + v, 0);
    expect(sum(r.kw)).toBeCloseTo(sum(raum), -1);
    for (let h = 0; h < 8760; h++) if (!an[h]) expect(r.kw[h]).toBe(0);
  });
});

describe('raumwaermeAusLastgang', () => {
  it('zieht TWW-Sockel (Sommergrundlast − Verluste) und Verluste ab', () => {
    const lg = Float32Array.from({ length: 8760 }, (_, h) => 30 + Math.max(0, 15 - tempH[h]) * 10);
    const { raumKw, twwKw } = raumwaermeAusLastgang(lg, 30, 12);
    expect(twwKw).toBe(18);
    expect(raumKw[0]).toBeCloseTo(lg[0] - 30, 4);
  });
});

describe('Gebäudeprofil ohne Sockel', () => {
  it('ohne TWW-Sockel bleibt nur der wetterabhängige Anteil', () => {
    const g = { nutzung: 'mfh' };
    const voll = buildBuildingHeatProfile(g, tempH, 100, 0, 2026);
    const ohne = buildBuildingHeatProfile(g, tempH, 100, 0, 2026, { ohneSockel: true });
    const sum = a => a.reduce((s, v) => s + v, 0) / 1000;
    expect(sum(voll.values)).toBeCloseTo(100, 0);
    expect(sum(ohne.values)).toBeLessThan(sum(voll.values));
    expect(ohne.values[196 * 24 + 12]).toBeLessThan(voll.values[196 * 24 + 12]);
  });
});

describe('Gutachtentext Betriebsweise', () => {
  it('nennt dezentrales TWW, Heizgrenze und Abschalttage', () => {
    const txt = JSON.stringify(lgTextGrundlast({ twwDezentral: { heizgrenze: 15, ausTage: 120 } }));
    expect(txt).toContain('dezentral');
    expect(txt).toContain('15 °C');
    expect(txt).toContain('120 Tagen');
  });
});
