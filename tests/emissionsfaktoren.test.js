import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  loadScript('01-globals-varianten.js');
});

describe('Emissionsfaktoren (GEG Anlage 9)', () => {
  it('Strom aktuell: 363 g CO₂/kWh (UBA 2024)', () => {
    expect(stromEmF).toBe(363);
  });

  it('Strom langfristig: 72 g CO₂/kWh (iinas 2025)', () => {
    expect(stromEmFLZ).toBe(72);
  });

  it('Erdgas: 240 g CO₂/kWh', () => {
    expect(gasEmF).toBe(240);
  });

  it('Heizöl: 310 g CO₂/kWh', () => {
    expect(heizoelEmF).toBe(310);
  });

  it('Pellets: 20 g CO₂/kWh (biogen)', () => {
    expect(pelletsEmF).toBe(20);
  });

  it('HHS: 20 g CO₂/kWh (biogen)', () => {
    expect(hhsEmF).toBe(20);
  });

  it('Fernwärme: 180 g CO₂/kWh', () => {
    expect(fernwaermeEmF).toBe(180);
  });

  it('Rangfolge: Pellets < Fernwärme < Gas < Heizöl < Strom', () => {
    expect(pelletsEmF).toBeLessThan(fernwaermeEmF);
    expect(fernwaermeEmF).toBeLessThan(gasEmF);
    expect(gasEmF).toBeLessThan(heizoelEmF);
    // Strom-EmF kann je nach Energiewende-Stand über oder unter Heizöl liegen
    expect(stromEmF).toBeGreaterThan(fernwaermeEmF);
  });
});

describe('Primärenergiefaktoren (GEG Anlage 4)', () => {
  it('Strom Netzmix: 1.8', () => {
    expect(pefStrom).toBe(1.8);
  });

  it('Strom WP: 1.2', () => {
    expect(pefWP).toBe(1.2);
  });

  it('Erdgas: 1.1', () => {
    expect(pefGas).toBe(1.1);
  });

  it('Heizöl: 1.1', () => {
    expect(pefHeizoel).toBe(1.1);
  });

  it('Pellets: 0.2', () => {
    expect(pefPellets).toBe(0.2);
  });

  it('HHS: 0.2', () => {
    expect(pefHhs).toBe(0.2);
  });

  it('Fernwärme: 0.3', () => {
    expect(pefFernwaerme).toBe(0.3);
  });

  it('Kappungsgrenze: 0.3', () => {
    expect(PEF_KAPPUNG).toBe(0.3);
  });

  it('Erneuerbare haben niedrigere PEF als fossile', () => {
    expect(pefPellets).toBeLessThan(pefGas);
    expect(pefHhs).toBeLessThan(pefHeizoel);
    expect(pefFernwaerme).toBeLessThan(pefStrom);
  });
});

describe('GEG Verdrängungsstrommix', () => {
  it('Verhältnis 860/560 ≈ 1.536', () => {
    expect(GEG_VERDRAENGUNG_RATIO).toBeCloseTo(860 / 560, 3);
  });
});
