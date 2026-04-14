import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  // Config muss zuerst geladen werden (KMR_KOSTEN wird referenziert)
  loadScript('config/netz-kosten.js');
  loadScript('02a-netz-physik.js');
});

describe('getKostenProM', () => {
  it('gibt korrekten Wert für DN100 mittel', () => {
    const k = getKostenProM(100, 'mittel');
    expect(k).toBe(2786);
  });

  it('gibt korrekten Wert für DN100 niedrig', () => {
    expect(getKostenProM(100, 'niedrig')).toBe(2418);
  });

  it('gibt korrekten Wert für DN100 hoch', () => {
    expect(getKostenProM(100, 'hoch')).toBe(3463);
  });

  it('gibt 0 für unbekannten DN', () => {
    expect(getKostenProM(999)).toBe(0);
  });

  it('größerer DN → höhere Kosten', () => {
    const k50 = getKostenProM(50, 'mittel');
    const k200 = getKostenProM(200, 'mittel');
    const k500 = getKostenProM(500, 'mittel');
    expect(k200).toBeGreaterThan(k50);
    expect(k500).toBeGreaterThan(k200);
  });
});

describe('getUWertForDN', () => {
  it('DN100 → Faktor 1.0 (Referenz)', () => {
    expect(getUWertForDN(100, 0.25)).toBeCloseTo(0.25, 4);
  });

  it('kleiner DN → höherer U-Wert (schlechter isoliert)', () => {
    expect(getUWertForDN(20, 0.25)).toBeGreaterThan(getUWertForDN(100, 0.25));
  });

  it('großer DN → niedrigerer U-Wert (besser isoliert)', () => {
    expect(getUWertForDN(500, 0.25)).toBeLessThan(getUWertForDN(100, 0.25));
  });

  it('Default baseU = 0.25 wenn nicht angegeben', () => {
    expect(getUWertForDN(100)).toBeCloseTo(0.25, 4);
  });
});

describe('getVFlowForDN', () => {
  it('kleine Rohre → langsamer', () => {
    expect(getVFlowForDN(20, 1.0)).toBeLessThan(getVFlowForDN(200, 1.0));
  });

  it('DN200 → Referenzgeschwindigkeit', () => {
    expect(getVFlowForDN(200, 1.0)).toBe(1.0);
  });

  it('DN600 → schneller als Referenz', () => {
    expect(getVFlowForDN(600, 1.0)).toBeGreaterThan(1.0);
  });
});

describe('getWLD', () => {
  it('berechnet Wärmeliniendichte korrekt', () => {
    // 100 kW Last, 100m Länge → WLD = (100 × 1800 / 1000) / 100 = 1.8 MWh/(m·a)
    const wld = getWLD({ load: 100, loadRaw: 100, length: 100 });
    expect(wld).toBeCloseTo(1.8, 2);
  });

  it('gibt 0 zurück bei Länge 0', () => {
    expect(getWLD({ load: 100, length: 0 })).toBe(0);
  });

  it('höhere Last → höhere WLD', () => {
    const wld_low = getWLD({ load: 50, loadRaw: 50, length: 100 });
    const wld_high = getWLD({ load: 200, loadRaw: 200, length: 100 });
    expect(wld_high).toBeGreaterThan(wld_low);
  });
});

describe('getWLDColor', () => {
  it('rot bei WLD < 0.5 (unwirtschaftlich)', () => {
    expect(getWLDColor(0.3)).toBe('#e53935');
  });

  it('gelb bei WLD 0.5-1.0', () => {
    expect(getWLDColor(0.7)).toBe('#f9a825');
  });

  it('hellgrün bei WLD 1.0-2.0', () => {
    expect(getWLDColor(1.5)).toBe('#8bc34a');
  });

  it('dunkelgrün bei WLD > 2.0 (wirtschaftlich)', () => {
    expect(getWLDColor(3.0)).toBe('#4caf50');
  });

  it('grau bei WLD 0', () => {
    expect(getWLDColor(0)).toBe('#999');
  });
});

describe('lerpColor', () => {
  it('t=0 → erste Farbe', () => {
    expect(lerpColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('t=1 → zweite Farbe', () => {
    expect(lerpColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('t=0.5 → Mischfarbe', () => {
    const c = lerpColor('#ff0000', '#0000ff', 0.5);
    // Rot: 128, Grün: 0, Blau: 128 → #800080
    expect(c).toBe('#800080');
  });

  it('Schwarz → Weiß bei t=0.5 ergibt Grau', () => {
    const c = lerpColor('#000000', '#ffffff', 0.5);
    expect(c).toBe('#808080');
  });
});
