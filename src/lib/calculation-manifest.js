// @ts-check

export const CALCULATION_MANIFEST_VERSION = 1;

export const CALCULATION_MODELS = Object.freeze({
  heatDispatch: {id:'heat-dispatch', version:'1.0', method:'stündliche Merit-Order mit thermischem Speicher'},
  heatNetwork: {id:'heat-network-screening', version:'2.0', method:'radialer Wärmegraph, GZF und vereinfachte Rohrhydraulik'},
  electricity: {id:'electric-network-screening', version:'1.0', method:'symmetrisches Drei-Phasen-Screening mit pauschalem cos φ'},
  pvBattery: {id:'pv-battery-hourly', version:'2.0', method:'stündliche Energie-/SOC-Bilanz plus Kalender- und Vollzyklus-Alterung'},
  optimizer: {id:'heuristic-grid-topn', version:'1.0', method:'heuristische Raster-/Top-N-Suche ohne globalen Optimalitätsnachweis'},
  economics: {id:'annualized-cost', version:'1.0', method:'Annuitäten- und Jahreskostenrechnung'},
});

/**
 * Maschinenlesbarer Nachweis der verwendeten Rechenmodelle und Aussagegrenzen.
 * @param {{appVersion?: string, buildDate?: string, generatedAt?: string, timeSeriesMeta?: any, pvProfileMeta?: any, tariffMeta?: any, economicMeta?: any}} [input]
 */
export function createCalculationManifest(input = {}) {
  const runtime = /** @type {{APP_VERSION?: string, APP_BUILD_DATE?: string}} */ (
    typeof window !== 'undefined' ? window : {}
  );
  return {
    manifestVersion: CALCULATION_MANIFEST_VERSION,
    appVersion: input.appVersion || runtime.APP_VERSION || 'dev',
    buildDate: input.buildDate || runtime.APP_BUILD_DATE || null,
    generatedAt: input.generatedAt || new Date().toISOString(),
    models: structuredClone(CALCULATION_MODELS),
    dataQuality: {
      heatLoadSeries: input.timeSeriesMeta ? structuredClone(input.timeSeriesMeta) : {
        quality: 'synthetic_or_not_recorded',
        source: 'Kein importierter Messlastgang im Manifest erfasst',
      },
      pvProfile: input.pvProfileMeta ? structuredClone(input.pvProfileMeta) : {
        quality:'not_recorded', source:'Keine PV-Profilherkunft im Manifest erfasst',
      },
      pvTariff: input.tariffMeta ? structuredClone(input.tariffMeta) : {
        scenarioId: 'not_recorded', source: 'Kein Tarifszenario im Manifest erfasst',
      },
      economics: input.economicMeta ? structuredClone(input.economicMeta) : {
        scenarioId: 'not_recorded', source: 'Kein Wirtschaftsszenario im Manifest erfasst',
      },
    },
    limitations: [
      'Ergebnisse dienen der Vorplanung und ersetzen keine prüffähige Fachplanung.',
      'Das elektrische Netzmodell ist kein unsymmetrischer AC-Lastfluss und keine Schutzstudie.',
      'Die Wärmehydraulik ist eine Planungsnäherung; Ringnetze werden als Modellwarnung ausgewiesen.',
      'PV-Standardprofile sind synthetisch, sofern keine gemessene oder externe Zeitreihe dokumentiert ist.',
      'Die Optimierung liefert die beste gefundene, nicht garantiert global optimale Variante.',
    ],
    references: [
      {topic:'Wärme-/Kältemodelle', reference:'im Tool dokumentierte VDI-/Carnot-Gütegradansätze'},
      {topic:'Elektrisches Screening', reference:'vereinfachte symmetrische Drei-Phasen- und Spannungsfallansätze'},
      {topic:'Wirtschaftlichkeit', reference:'Annuitätenmethode mit den im Projekt gespeicherten Eingaben'},
    ],
  };
}
