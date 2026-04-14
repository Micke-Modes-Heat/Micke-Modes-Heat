# Energieplanung v2 — Modulare Version

## Struktur

```
v2/
├── index.html                  ← HTML-Markup (kein inline JS)
├── build.sh                    ← Einzeldatei erzeugen → dist/Index.html
├── package.json                ← npm-Projekt (Vite, ESLint)
├── vite.config.js              ← Vite Dev-Server Config
├── eslint.config.js            ← ESLint Flat Config
├── src/
│   ├── styles/app.css
│   ├── config/
│   │   ├── netz-kosten.js      ← KMR_KOSTEN, KABEL_TYPEN, TRAFO_GROESSEN
│   │   ├── erzeuger-cfg.js     ← ERZEUGER_CFG, NUTZUNG_DEFAULTS
│   │   ├── optimizer-defaults.js ← OPT_INVEST_DEFAULT, OPT_NUTZUNG, OPT_IH
│   │   └── hilfe-texte.js      ← HILFE_TEXTE
│   ├── 01-globals-varianten.js ← Globale Variablen, Variantenverwaltung
│   ├── 02a-netz-physik.js      ← Rohrphysik, Farbschemata, Legende
│   ├── 02b-gebaeude.js         ← Karte-Init, Gebäude-CRUD, OSM
│   ├── 02c-karte-werkzeuge.js  ← Zeichenwerkzeuge, Trasse, LWWP
│   ├── 03a-erzeuger.js         ← Erzeuger-Panels (WP, BHKW, Kessel, FW)
│   ├── 03b-netz.js             ← Geothermie, Netzgraph, Strang-Report
│   ├── 03c-gebaeude-io.js      ← Gebäude-UI, Import/Export
│   ├── 04a-ui-panels.js        ← Panels, Layout, LP-KPIs
│   ├── 04b-emissionen-3d.js    ← Emissionen, Dispatch-Chart, 3D-Energiekrone
│   ├── 05a-export.js           ← CSV/PDF-Export, Druckansicht
│   ├── 05b-stromnetz.js        ← Elektrisches Netz, Kabel, Trafo
│   ├── 05c-sankey.js           ← Sankey-Diagramm
│   ├── 06a-gbi-lastgang.js     ← CSV-Import, Lastgang-UI, Klimadaten
│   ├── 06b-gl-berechnen.js     ← Hauptberechnung, Synthese, Solarthermie
│   ├── 06c-dispatch-core.js    ← Merit-Order, _dispatchCore
│   ├── 07a-analysis-charts.js  ← Analyse-Charts (JDL, Heatmap, Lastgang)
│   ├── 07b-analysis-economics.js ← Wirtschaftlichkeit, CO2, Jahresscheiben
│   ├── 08-calc-engine.js       ← CalcEngine (SigLinDe, COP, VDI 2067)
│   ├── 09a-pv-profile.js       ← PV-Profil, Datei-Upload, Preise
│   ├── 09b-pv-calc.js          ← Strom-Panel Berechnung, Batterie
│   ├── 09c-pv-charts-opt.js    ← Strom-Charts, PV+Bat-Optimierung
│   ├── 10a-optimizer-core.js   ← Optimizer-Kern, Dispatch, Kennwerte
│   ├── 10b-hourly-live.js      ← Stündliche Live-Ansicht, Timeline
│   ├── 10c-optimizer-run.js    ← Worker-Orchestrierung
│   ├── 10d-optimizer-worker.js ← Worker-Code, Ergebnis-Charts
│   ├── 11-hilfe-leitfaden.js   ← Hilfe-Tooltips, Leitfaden
│   └── 12-inline-handlers.js   ← Event-Delegation, Details-Toggle
└── dist/
    └── Index.html              ← Gebaute Einzeldatei
```

## Entwicklung

```bash
cd v2
npm install         # einmalig
npm run dev         # Vite Dev-Server mit Auto-Reload (Port 3000)
npm run lint        # ESLint prüfen
```

Alternativ: `index.html` direkt im Browser öffnen.

## Ausliefern

```bash
./build.sh          # → dist/Index.html (eine Datei, wie bisher)
```

## Architektur

- Alle JS-Dateien teilen sich den globalen Scope (plain `<script>` Tags)
- Event-Handler über Event-Delegation (`data-click`, `data-input`, `data-change`)
- Config-Objekte in `src/config/` separiert
- Reihenfolge der Script-Tags in index.html ist wichtig
- `build.sh` konkateniert alles zu einer Einzeldatei
