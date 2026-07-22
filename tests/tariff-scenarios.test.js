import { describe, expect, it } from 'vitest';
import { DEFAULT_PV_TARIFF_SCENARIO_ID, calculateTieredRate, getPvTariffProvenance, getPvTariffResult } from '../src/config/tariff-scenarios.js';

describe('versionierte PV-Tarifszenarien', () => {
  it('berechnet kumulative Leistungsstaffeln anteilig', () => {
    expect(calculateTieredRate(10, [{upToKwp:10,ctPerKwh:8},{upToKwp:40,ctPerKwh:6}])).toBe(8);
    expect(calculateTieredRate(20, [{upToKwp:10,ctPerKwh:8},{upToKwp:40,ctPerKwh:6}])).toBe(7);
  });

  it('wendet die offiziellen EEG-Grenzen 2026 an', () => {
    expect(getPvTariffResult(DEFAULT_PV_TARIFF_SCENARIO_ID, 'teil', 10).rate).toBeCloseTo(7.78, 10);
    expect(getPvTariffResult(DEFAULT_PV_TARIFF_SCENARIO_ID, 'teil', 40).rate).toBeCloseTo((10*7.78 + 30*6.73) / 40, 10);
    expect(getPvTariffResult(DEFAULT_PV_TARIFF_SCENARIO_ID, 'voll', 100).rate).toBeCloseTo((10*12.34 + 90*10.35) / 100, 10);
  });

  it('erzwingt außerhalb der veröffentlichten Grenze eine manuelle Annahme', () => {
    expect(getPvTariffResult(DEFAULT_PV_TARIFF_SCENARIO_ID, 'teil', 100.01).rate).toBeNull();
    expect(getPvTariffResult(DEFAULT_PV_TARIFF_SCENARIO_ID, 'ausschreibung', 1500).reason).toBe('manual_or_unsupported');
  });

  it('liefert Gültigkeit und offizielle Herkunft maschinenlesbar', () => {
    const meta = getPvTariffProvenance();
    expect(meta.validFrom).toBe('2026-02-01');
    expect(meta.validTo).toBe('2026-07-31');
    expect(meta.sourceUrl).toMatch(/^https:\/\/www\.bundesnetzagentur\.de\//);
  });
});
