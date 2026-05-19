// ── main.js — ES Module entry point ────────────────────────────────────────
// Imports all modules and exposes their exports on window for data-* handlers.

import * as netzKosten from './config/netz-kosten.js';
import * as erzeugerCfg from './config/erzeuger-cfg.js';
import * as optimizerDefaults from './config/optimizer-defaults.js';
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
import * as stromnetz from './05b-stromnetz.js';
import * as sankey from './05c-sankey.js';
import * as gbiLastgang from './06a-gbi-lastgang.js';
import * as glBerechnen from './06b-gl-berechnen.js';
import * as dispatchCore from './06c-dispatch-core.js';
import * as analysisCharts from './07a-analysis-charts.js';
import * as analysisEconomics from './07b-analysis-economics.js';
import * as calcEngine from './08-calc-engine.js';
import * as pvProfile from './09a-pv-profile.js';
import * as pvCalc from './09b-pv-calc.js';
import * as pvChartsOpt from './09c-pv-charts-opt.js';
import * as optimizerCore from './10a-optimizer-core.js';
import * as hourlyLive from './10b-hourly-live.js';
import * as optimizerRun from './10c-optimizer-run.js';
import * as optimizerWorker from './10d-optimizer-worker.js';
import * as hilfeLeitfaden from './11-hilfe-leitfaden.js';
import './12-inline-handlers.js';
import * as assetsCore from './13a-assets-core.js';
import * as assetsRender from './13b-assets-render.js';
import * as assetsUi from './13c-assets-ui.js';
import * as assetsAuto from './13d-assets-autocreate.js';
import * as assetsInspector from './13e-assets-inspector.js';
import * as sld from './13f-sld.js';

// Expose all exports on window for data-* event handlers in HTML
const modules = [
  netzKosten, erzeugerCfg, optimizerDefaults, hilfeTexte,
  globals, netzPhysik, gebaeude, karteWerkzeuge,
  erzeuger, netz, gebaeudeIo, uiPanels,
  emissionen3d, exportMod, stromnetz, sankey,
  gbiLastgang, glBerechnen, dispatchCore,
  analysisCharts, analysisEconomics, calcEngine,
  pvProfile, pvCalc, pvChartsOpt,
  optimizerCore, hourlyLive, optimizerRun, optimizerWorker,
  hilfeLeitfaden,
  assetsCore, assetsRender, assetsUi, assetsAuto, assetsInspector, sld,
];

for (const mod of modules) {
  for (const [key, value] of Object.entries(mod)) {
    window[key] = value;
  }
}
