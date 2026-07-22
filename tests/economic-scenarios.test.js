import { describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMIC_SCENARIO_ID, getEconomicScenario, getEconomicScenarioProvenance } from '../src/config/economic-scenarios.js';

describe('versioniertes Wirtschaftsszenario', () => {
  it('führt Version, Stand und alle zentralen Rechenannahmen', () => {
    const scenario = getEconomicScenario();
    expect(scenario.id).toBe(DEFAULT_ECONOMIC_SCENARIO_ID);
    expect(scenario.version).toBe(1);
    expect(scenario.effectiveDate).toBe('2026-07-18');
    expect(Object.keys(scenario.values).sort()).toEqual([
      'co2Alle','co2EurT','fernwaermeCtKwh','gasCtKwh','heizoelCtKwh','hhsCtKwh',
      'kapitalzinsPct','lohnEurH','pelletsCtKwh','stromCtKwh','wpStromCtKwh',
    ]);
  });

  it('kennzeichnet manuelle Overrides in der Provenienz', () => {
    expect(getEconomicScenarioProvenance(DEFAULT_ECONOMIC_SCENARIO_ID, true).manualOverrides).toBe(true);
    expect(getEconomicScenarioProvenance('manual').scenarioId).toBe('manual');
  });
});
