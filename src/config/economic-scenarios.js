// @ts-check

export const DEFAULT_ECONOMIC_SCENARIO_ID = 'project-base-2026-07-v1';

/** @type {Readonly<Record<string, any>>} */
export const ECONOMIC_SCENARIOS = Object.freeze({
  [DEFAULT_ECONOMIC_SCENARIO_ID]: Object.freeze({
    id: DEFAULT_ECONOMIC_SCENARIO_ID,
    version: 1,
    label: 'Projektbasis 07/2026 · v1',
    effectiveDate: '2026-07-18',
    source: 'Dokumentierte Projektannahmen; vor Beschluss projektspezifisch plausibilisieren',
    values: Object.freeze({
      stromCtKwh: 35, wpStromCtKwh: null, gasCtKwh: 10, heizoelCtKwh: 10,
      fernwaermeCtKwh: 17, pelletsCtKwh: 8, hhsCtKwh: 6,
      co2EurT: 120, co2Alle: true, kapitalzinsPct: 3.5, lohnEurH: 45,
    }),
  }),
});

export function getEconomicScenario(id = DEFAULT_ECONOMIC_SCENARIO_ID) {
  return ECONOMIC_SCENARIOS[id] || null;
}

export function getEconomicScenarioProvenance(id = DEFAULT_ECONOMIC_SCENARIO_ID, manual = false) {
  const scenario = getEconomicScenario(id);
  return scenario ? {
    scenarioId: scenario.id, version: scenario.version, effectiveDate: scenario.effectiveDate,
    source: scenario.source, manualOverrides: !!manual,
  } : {scenarioId: 'manual', version: null, effectiveDate: null, source: 'Manuelle Projekteingaben', manualOverrides: true};
}
