import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  loadScript('config/netz-kosten.js');
  loadScript('02a-netz-physik.js');
});

describe('Rohrdimensionierung — Physik-Grundlagen', () => {
  it('standardDNs enthält alle gängigen Nennweiten', () => {
    expect(standardDNs).toContain(20);
    expect(standardDNs).toContain(50);
    expect(standardDNs).toContain(100);
    expect(standardDNs).toContain(200);
    expect(standardDNs).toContain(500);
    expect(standardDNs).toContain(800);
    expect(standardDNs.length).toBe(21);
  });

  it('standardDNs sind aufsteigend sortiert', () => {
    for (let i = 1; i < standardDNs.length; i++) {
      expect(standardDNs[i]).toBeGreaterThan(standardDNs[i - 1]);
    }
  });
});

describe('DN-Auswahl (manuelle Berechnung)', () => {
  // Nachrechnung der Rohrdimensionierung nach physikalischen Grundlagen
  const cp = 4.184; // kJ/(kg·K)

  function calcRequiredDN(loadKw, dt, vFlow) {
    const mDot = loadKw / (cp * dt);          // kg/s
    const reqArea = (mDot / 1000) / vFlow;    // m² (Wasser ~1000 kg/m³)
    const reqDMm = Math.sqrt(4 * reqArea / Math.PI) * 1000; // mm
    return standardDNs.find(dn => dn >= reqDMm) || standardDNs[standardDNs.length - 1];
  }

  it('100 kW bei ΔT=30K, v=1.0 m/s → kleiner DN', () => {
    const dn = calcRequiredDN(100, 30, 1.0);
    expect(dn).toBeLessThanOrEqual(32);
    expect(dn).toBeGreaterThanOrEqual(15);
  });

  it('1000 kW bei ΔT=30K, v=1.0 m/s → mittlerer DN', () => {
    const dn = calcRequiredDN(1000, 30, 1.0);
    expect(dn).toBeGreaterThanOrEqual(50);
    expect(dn).toBeLessThanOrEqual(125);
  });

  it('10000 kW bei ΔT=30K, v=1.0 m/s → großer DN', () => {
    const dn = calcRequiredDN(10000, 30, 1.0);
    expect(dn).toBeGreaterThanOrEqual(200);
  });

  it('Höhere Last → größerer DN', () => {
    const dn_small = calcRequiredDN(50, 30, 1.0);
    const dn_large = calcRequiredDN(5000, 30, 1.0);
    expect(dn_large).toBeGreaterThan(dn_small);
  });

  it('Kleinerer ΔT → größerer DN (mehr Volumenstrom nötig)', () => {
    const dn_30K = calcRequiredDN(500, 30, 1.0);
    const dn_10K = calcRequiredDN(500, 10, 1.0); // Weniger ΔT → mehr Flow
    expect(dn_10K).toBeGreaterThanOrEqual(dn_30K);
  });

  it('Höhere Geschwindigkeit → kleinerer DN möglich', () => {
    const dn_slow = calcRequiredDN(500, 30, 0.5);
    const dn_fast = calcRequiredDN(500, 30, 1.5);
    expect(dn_slow).toBeGreaterThanOrEqual(dn_fast);
  });
});

describe('Wärmeverlust-Berechnung', () => {
  it('Verlust = U-Wert × Länge × ΔT × 2 (VL+RL)', () => {
    // DN100, 100m, VL=80°C, Boden=10°C → ΔT=70K
    const u = getUWertForDN(100, 0.25); // W/(m·K) pro Rohr
    const laenge = 100; // m
    const dt = 70; // K (VL-Boden + RL-Boden gemittelt)
    const verlustW = u * laenge * dt; // Watt
    const verlustKw = verlustW / 1000;

    // Realistisch: wenige kW auf 100m
    expect(verlustKw).toBeGreaterThan(0.5);
    expect(verlustKw).toBeLessThan(10);
  });

  it('Längere Leitung → mehr Verlust', () => {
    const u = getUWertForDN(100, 0.25);
    const v100m = u * 100 * 70;
    const v500m = u * 500 * 70;
    expect(v500m).toBe(v100m * 5);
  });

  it('Größerer DN → relativ weniger Verlust pro kW transportiert', () => {
    // DN50 transportiert weniger, hat aber höheren U-Wert
    const u50 = getUWertForDN(50, 0.25);
    const u200 = getUWertForDN(200, 0.25);
    // U-Wert sinkt mit DN → bessere Isolation
    expect(u200).toBeLessThan(u50);
  });
});

describe('Wärmeliniendichte — erweiterte Tests', () => {
  it('WLD 0.5 = Grenze wirtschaftlich/unwirtschaftlich', () => {
    // 50 kW auf 180m → WLD = 50 × 1800 / 1000 / 180 = 0.5
    expect(getWLD({ load: 50, loadRaw: 50, length: 180 })).toBeCloseTo(0.5, 2);
  });

  it('Typisches Wohngebiet: WLD > 1.5', () => {
    // 500 kW auf 200m → WLD = 500 × 1800 / 1000 / 200 = 4.5
    const wld = getWLD({ load: 500, loadRaw: 500, length: 200 });
    expect(wld).toBeGreaterThan(1.5);
  });

  it('Ländlicher Bereich: WLD < 0.5', () => {
    // 20 kW auf 300m → WLD = 20 × 1800 / 1000 / 300 = 0.12
    const wld = getWLD({ load: 20, loadRaw: 20, length: 300 });
    expect(wld).toBeLessThan(0.5);
  });
});

describe('Druckverlust — physikalische Plausibilität', () => {
  it('Reynolds-Zahl Berechnung', () => {
    // v=1.0 m/s, d=0.1m (DN100), ν=4.15e-7 m²/s
    const Re = 1.0 * 0.1 / 4.15e-7;
    // Re ≈ 240.964 → turbulent
    expect(Re).toBeGreaterThan(2300);
    expect(Re).toBeLessThan(1e6);
  });

  it('Darcy-Weisbach Druckverlust plausibel', () => {
    // DN100, v=1.0 m/s, ρ=975 kg/m³, λ≈0.02
    const lambda = 0.02;
    const rho = 975;
    const v = 1.0;
    const d = 0.1; // m
    const dpPerM = lambda * rho * v * v / (2 * d); // Pa/m
    // Erwartung: ~100 Pa/m
    expect(dpPerM).toBeGreaterThan(50);
    expect(dpPerM).toBeLessThan(200);
  });
});
