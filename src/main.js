// ── main.js — ES Module entry point ────────────────────────────────────────
// Imports all modules and exposes their exports on window for data-* handlers.

import * as physikKonstanten from './lib/physik-konstanten.js';
import * as projectSchema from './lib/project-schema.js';
import * as autosaveStore from './lib/autosave-store.js';
import * as waermeGraphValidation from './lib/waerme-graph-validation.js';
import * as timeSeries from './lib/time-series.js';
import * as calculationManifest from './lib/calculation-manifest.js';
import * as electricDemand from './lib/electric-demand.js';
import * as pvBatteryCore from './lib/pv-battery-core.js';
import * as pvProfileImport from './lib/pv-profile-import.js';
import * as batteryAging from './lib/battery-aging.js';
import * as workerSeries from './lib/worker-series.js';
import * as planningTransaction from './lib/planning-transaction.js';
import * as interactionState from './lib/interaction-state.js';
import * as lifecycle from './lib/lifecycle.js';
import * as localDataPrivacy from './lib/local-data-privacy.js';
import * as diagnostics from './lib/diagnostics.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as netzKosten from './config/netz-kosten.js';
import * as erzeugerCfg from './config/erzeuger-cfg.js';
import * as optimizerDefaults from './config/optimizer-defaults.js';
import * as tariffScenarios from './config/tariff-scenarios.js';
import * as economicScenarios from './config/economic-scenarios.js';
import * as terminology from './config/terminology.js';
import * as hilfeTexte from './config/hilfe-texte.js';
import * as globals from './01-globals-varianten.js';
import * as netzPhysik from './02a-netz-physik.js';
import * as gebaeude from './02b-gebaeude.js';
import * as karteWerkzeuge from './02c-karte-werkzeuge.js';
import * as erzeuger from './03a-erzeuger.js';
import * as netz from './03b-netz.js';
import * as gebaeudeIo from './03c-gebaeude-io.js';
import * as uiPanels from './04a-ui-panels.js';
import * as emissionen3d from './04b-emissionen-3d.js';
import * as exportMod from './05a-export.js';
import * as bericht from './05d-bericht.js';
import * as projektbericht from './05e-projektbericht.js';
import * as stromnetz from './05b-stromnetz.js';
import * as sankey from './05c-sankey.js';
import * as gbiLastgang from './06a-gbi-lastgang.js';
import * as glBerechnen from './06b-gl-berechnen.js';
import * as dispatchCore from './06c-dispatch-core.js';
import * as kaelteCore from './06d-kaelte-core.js';
import * as analysisCharts from './07a-analysis-charts.js';
import * as analysisEconomics from './07b-analysis-economics.js';
import * as calcEngine from './08-calc-engine.js';
import * as pvProfile from './09a-pv-profile.js';
import * as pvCalc from './09b-pv-calc.js';
import * as pvChartsOpt from './09c-pv-charts-opt.js';
import * as pvAnalyse from './09d-pv-analyse.js';
import * as optimizerCore from './10a-optimizer-core.js';
import * as hourlyLive from './10b-hourly-live.js';
import * as optimizerRun from './10c-optimizer-run.js';
import * as optimizerWorker from './10d-optimizer-worker.js';
import * as optimizerSession from './10e-optimizer-session.js';
import * as hilfeLeitfaden from './11-hilfe-leitfaden.js';
import './12-inline-handlers.js';
import * as assetsCore from './13a-assets-core.js';
import * as assetsRender from './13b-assets-render.js';
import * as assetsUi from './13c-assets-ui.js';
import * as assetsAuto from './13d-assets-autocreate.js';
import * as assetsInspector from './13e-assets-inspector.js';
import * as sld from './13f-sld.js';
import * as msRing from './13g-ms-ring.js';
import * as netzanalyse from './13h-netzanalyse.js';
import * as slpEditor from './13i-slp-editor.js';
import * as autofillWizard from './13j-autofill-wizard.js';
import * as elslpRegistry from './13k-elslp-registry.js';
import * as autonetz from './13l-autonetz.js';
import * as kompaktstation from './13m-kompaktstation.js';
import * as elektroPanel from './13n-elektro-panel.js';
import * as schichtBar from './13v-schicht-bar.js';
import * as bestandPanel from './13w-bestand-panel.js';
import * as variantenVergleichPanel from './13x-varianten-vergleich.js';
import * as lastgangSchnappschuss from './13y-lastgang-schnappschuss.js';
import * as schwellenPanel from './13z-schwellen-panel.js';
import * as napAnalyse from './13o-nap-analyse.js';
import * as knotenAnalyse from './13r-knotenpunkt-analyse.js';
import * as windAnalyse from './13t-wind-analyse.js';
import * as kandidaten from './14a-kandidaten.js';
import * as ertuechtigung from './14b-ertuechtigung.js';
import * as phasenFahrplan from './14c-phasen.js';
import * as selektion from './14d-selektion.js';
import * as ausbauplaner from './14e-ausbauplaner-ui.js';
import * as clusterCore from './14f-cluster-core.js';
import * as clusterMap from './14g-cluster-map.js';
import * as engpassSweep from './14h-engpass-sweep.js';
import * as engpassPanel from './14i-engpass-panel.js';
import * as planDigitalisierer from './15-plan-digitalisierer.js';
import * as dualScreen from './16-dual-screen.js';
import * as gutachtenGrafik from './17-gutachten-grafik.js';
import * as liegenschaftsbilder from './18-liegenschaftsbilder.js';

// Expose all exports on window for data-* event handlers in HTML
const modules = [
  pdfjsLib, physikKonstanten, projectSchema, autosaveStore, waermeGraphValidation, timeSeries, calculationManifest, electricDemand, pvBatteryCore, pvProfileImport, batteryAging, workerSeries, planningTransaction, interactionState, lifecycle, localDataPrivacy, diagnostics, netzKosten, erzeugerCfg, optimizerDefaults, tariffScenarios, economicScenarios, terminology, hilfeTexte,
  globals, netzPhysik, gebaeude, karteWerkzeuge,
  erzeuger, netz, gebaeudeIo, uiPanels,
  emissionen3d, exportMod, bericht, projektbericht, stromnetz, sankey,
  gbiLastgang, glBerechnen, dispatchCore, kaelteCore,
  analysisCharts, analysisEconomics, calcEngine,
  pvProfile, pvCalc, pvChartsOpt, pvAnalyse,
  optimizerCore, hourlyLive, optimizerRun, optimizerWorker, optimizerSession,
  hilfeLeitfaden,
  assetsCore, assetsRender, assetsUi, assetsAuto, assetsInspector, sld, msRing, netzanalyse,
  slpEditor, autofillWizard, elslpRegistry, autonetz, kompaktstation, elektroPanel, schichtBar, bestandPanel, variantenVergleichPanel, lastgangSchnappschuss, schwellenPanel,
  napAnalyse, knotenAnalyse, windAnalyse,
  kandidaten, ertuechtigung, phasenFahrplan, selektion, ausbauplaner,
  clusterCore, clusterMap, engpassSweep, engpassPanel,
  planDigitalisierer, dualScreen, gutachtenGrafik, liegenschaftsbilder,
];
window.pdfjsLib = pdfjsLib;
lifecycle.appLifecycle.listen(window,'pagehide',()=>lifecycle.appLifecycle.dispose(),{once:true});
diagnostics.installGlobalDiagnostics();

// Normale Funktionsoberfläche zuerst. Der zentrale State wird anschließend als
// Live-Accessor exponiert; dadurch ist window.x im ESM-Modus kein veralteter
// Startwert mehr und Zuweisungen laufen – soweit vorhanden – über Actions.
for (const mod of modules.filter(mod => mod !== globals)) {
  for (const [key, value] of Object.entries(mod)) {
    window[key] = value;
  }
}
for (const [key, value] of Object.entries(globals)) {
  if (typeof value === 'function') { window[key] = value; continue; }
  const setterName = key === 'globalYear'
    ? 'setGlobalYearValue'
    : key === 'stromNetzVisible' ? 'setStromNetzVisibleState'
    : key === 'stromColorMode' ? 'setStromColorModeState'
    : key === 'stromDynamicViz' ? 'setStromDynamicVizState'
    : `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const setter = globals[setterName];
  if (typeof setter === 'function') {
    Object.defineProperty(window, key, {
      configurable: true,
      enumerable: true,
      get: () => globals[key],
      set: next => { setter(next); },
    });
  } else window[key] = value;
}

function initAccessibilityBaseline() {
  document.querySelectorAll('button:not([aria-label])').forEach(button => {
    if (!button.textContent.trim() && button.title) button.setAttribute('aria-label', button.title);
  });
  const tabList = document.getElementById('view-tabs');
  if (tabList) {
    tabList.setAttribute('role', 'tablist');
    const sync = () => tabList.querySelectorAll('.view-tab').forEach(tab => {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
      tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');
    });
    sync();
    new MutationObserver(sync).observe(tabList, {subtree:true, attributes:true, attributeFilter:['class']});
    tabList.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const tabs = [...tabList.querySelectorAll('.view-tab')].filter(tab => tab.style.display !== 'none');
      const current = tabs.indexOf(document.activeElement);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      tabs[(current + delta + tabs.length) % tabs.length]?.focus();
      event.preventDefault();
    });
  }
}

// BDEW-SLP-Tabellen in den Cache laden (ersetzt die vereinfachte Approximation)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    slpEditor.initBdewProfiles();
    selektion.selInitBoxSelect();
    clusterMap.clusterInit();
    initAccessibilityBaseline();
    uiPanels.initResponsiveLayout();
    dualScreen.dsInit();
  });
} else {
  slpEditor.initBdewProfiles();
  selektion.selInitBoxSelect();
  clusterMap.clusterInit();
  initAccessibilityBaseline();
  uiPanels.initResponsiveLayout();
  dualScreen.dsInit();
}
