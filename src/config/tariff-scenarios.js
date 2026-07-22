// @ts-check

export const DEFAULT_PV_TARIFF_SCENARIO_ID = 'de-eeg-2026-02-01';

/** @type {Readonly<Record<string, any>>} */
export const PV_TARIFF_SCENARIOS = Object.freeze({
  [DEFAULT_PV_TARIFF_SCENARIO_ID]: Object.freeze({
    id: DEFAULT_PV_TARIFF_SCENARIO_ID,
    label: 'EEG 2026 (01.02.–31.07.2026)',
    validFrom: '2026-02-01',
    validTo: '2026-07-31',
    jurisdiction: 'DE',
    source: 'Bundesnetzagentur – EEG-Förderung und -Fördersätze',
    sourceUrl: 'https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/ErneuerbareEnergien/EEG_Foerderung/start.html',
    retrievedAt: '2026-07-19',
    // Grenzwerte sind kumulativ. Der Mischsatz wird leistungsanteilig berechnet.
    tariffs: Object.freeze({
      teil: Object.freeze({maxKwp: 100, tiers: Object.freeze([
        Object.freeze({upToKwp: 10, ctPerKwh: 7.78}),
        Object.freeze({upToKwp: 40, ctPerKwh: 6.73}),
        Object.freeze({upToKwp: 100, ctPerKwh: 5.50}),
      ])}),
      voll: Object.freeze({maxKwp: 100, tiers: Object.freeze([
        Object.freeze({upToKwp: 10, ctPerKwh: 12.34}),
        Object.freeze({upToKwp: 40, ctPerKwh: 10.35}),
        Object.freeze({upToKwp: 100, ctPerKwh: 10.35}),
      ])}),
      markt: Object.freeze({maxKwp: 1000, tiers: Object.freeze([
        Object.freeze({upToKwp: 10, ctPerKwh: 8.18}),
        Object.freeze({upToKwp: 40, ctPerKwh: 7.13}),
        Object.freeze({upToKwp: 100, ctPerKwh: 5.90}),
        Object.freeze({upToKwp: 400, ctPerKwh: 5.90}),
        Object.freeze({upToKwp: 1000, ctPerKwh: 5.90}),
      ])}),
    }),
  }),
});

/**
 * Berechnet den leistungsgewichteten Mischsatz einer kumulativen EEG-Staffel.
 * @param {number} kwp
 * @param {Array<{upToKwp:number, ctPerKwh:number}> | readonly {upToKwp:number, ctPerKwh:number}[]} tiers
 */
export function calculateTieredRate(kwp, tiers) {
  const capacity = Number(kwp);
  if (!Number.isFinite(capacity) || capacity <= 0 || !Array.isArray(tiers) || tiers.length === 0) return null;
  let previous = 0;
  let weighted = 0;
  for (const tier of tiers) {
    const upper = Number(tier.upToKwp);
    const slice = Math.max(0, Math.min(capacity, upper) - previous);
    weighted += slice * Number(tier.ctPerKwh);
    previous = upper;
    if (capacity <= upper) break;
  }
  if (capacity > previous) return null;
  return weighted / capacity;
}

/** @param {string} scenarioId @param {string} model @param {number} kwp */
export function getPvTariffResult(scenarioId, model, kwp) {
  const scenario = PV_TARIFF_SCENARIOS[scenarioId];
  const tariff = scenario?.tariffs?.[model];
  if (!scenario || !tariff) return {rate: null, scenario: scenario || null, reason: 'manual_or_unsupported'};
  const rate = calculateTieredRate(kwp, tariff.tiers);
  return {rate, scenario, reason: rate == null ? 'outside_scope' : 'official_tiered_rate'};
}

export function getPvTariffProvenance(scenarioId = DEFAULT_PV_TARIFF_SCENARIO_ID) {
  const scenario = PV_TARIFF_SCENARIOS[scenarioId];
  if (!scenario) return {scenarioId: 'manual', source: 'Manuelle Projekteingabe', sourceUrl: null, validFrom: null, validTo: null};
  return {
    scenarioId: scenario.id, source: scenario.source, sourceUrl: scenario.sourceUrl,
    validFrom: scenario.validFrom, validTo: scenario.validTo, retrievedAt: scenario.retrievedAt,
  };
}
