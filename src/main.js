// ── main.js — Entry Point: importiert alle Module, setzt window.* für data-click Handler ──

// Config (reine Daten)
import * as netzKosten from './config/netz-kosten.js';
import * as erzeugerCfg from './config/erzeuger-cfg.js';
import * as optDefaults from './config/optimizer-defaults.js';
import * as hilfeTexte from './config/hilfe-texte.js';

// Globaler State + Varianten
import * as globals from './01-globals-varianten.js';

// Netz-Physik, Gebäude, Karte
import * as netzPhysik from './02a-netz-physik.js';
import * as gebaeude from './02b-gebaeude.js';
import * as karteWerkzeuge from './02c-karte-werkzeuge.js';

// Erzeuger + Netz + I/O
import * as erzeuger from './03a-erzeuger.js';
import * as netz from './03b-netz.js';
import * as gebaeudeIo from './03c-gebaeude-io.js';

// UI-Panels
import * as uiPanels from './04a-ui-panels.js';
import * as emissionen3d from './04b-emissionen-3d.js';

// Export + Stromnetz + Sankey
import * as exportMod from './05a-export.js';
import * as stromnetz from './05b-stromnetz.js';
import * as sankey from './05c-sankey.js';

// Lastgang + Berechnung + Dispatch
import * as gbiLastgang from './06a-gbi-lastgang.js';
import * as glBerechnen from './06b-gl-berechnen.js';
import * as dispatchCore from './06c-dispatch-core.js';

// Analyse + Wirtschaft
import * as analysisCharts from './07a-analysis-charts.js';
import * as analysisEcon from './07b-analysis-economics.js';

// CalcEngine
import * as calcEngine from './08-calc-engine.js';

// PV + Strom
import * as pvProfile from './09a-pv-profile.js';
import * as pvCalc from './09b-pv-calc.js';
import * as pvChartsOpt from './09c-pv-charts-opt.js';

// Optimizer
import * as optCore from './10a-optimizer-core.js';
import * as hourlyLive from './10b-hourly-live.js';
import * as optRun from './10c-optimizer-run.js';
import * as optWorker from './10d-optimizer-worker.js';

// Hilfe + Leitfaden
import * as hilfeLeitfaden from './11-hilfe-leitfaden.js';

// Event-Delegation (IIFE — registriert sich selbst)
import './12-inline-handlers.js';

// ── Alle Exports auf window setzen (für data-click Handler in HTML) ──
const modules = [
  netzKosten, erzeugerCfg, optDefaults, hilfeTexte,
  globals,
  netzPhysik, gebaeude, karteWerkzeuge,
  erzeuger, netz, gebaeudeIo,
  uiPanels, emissionen3d,
  exportMod, stromnetz, sankey,
  gbiLastgang, glBerechnen, dispatchCore,
  analysisCharts, analysisEcon,
  calcEngine,
  pvProfile, pvCalc, pvChartsOpt,
  optCore, hourlyLive, optRun, optWorker,
  hilfeLeitfaden,
];

for (const mod of modules) {
  for (const [key, value] of Object.entries(mod)) {
    window[key] = value;
  }
}
