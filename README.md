# Micke-Modes-Heat — Energieplanung

Browser-App zur Wärmenetz- und Energiekonzept-Planung: Gebäude auf der Karte erfassen
(OSM/WFS-Import), Wärmenetz zeichnen und dimensionieren, Erzeuger auslegen
(WP, BHKW, Kessel, Solarthermie, Speicher, PV), stundenscharfer Merit-Order-Dispatch,
Wirtschaftlichkeit nach VDI 2067, Stromnetz, Optimierer und Variantenvergleich.

## Struktur

```
├── index.html                  ← HTML-Markup (kein inline JS)
├── build-singlefile.mjs        ← Build: alles → dist/index.html (eine Datei)
│                                  ⚠ Neue src-Dateien MÜSSEN in JS_FILES eingetragen
│                                  werden — der Build bricht sonst mit Hinweis ab.
├── build-feldapp.mjs           ← Build: field-app → dist/feldapp.html (offline-fähig)
├── eslint.config.js            ← ESLint Flat Config
├── eslint-undef.config.mjs     ← Zusatz-Check: findet fehlende Imports (Dev-Modus)
├── src/
│   ├── styles/app.css
│   ├── config/                 ← Kostentabellen, Erzeuger-Defaults, Hilfetexte
│   ├── lib/                    ← Shared: util.js, physik-konstanten.js, elektro-formeln.js
│   ├── 01–12 …                 ← Karte, Netz, Erzeuger, Dispatch, Analyse, PV, Optimizer
│   ├── 13a–13r …               ← Elektro-Assets, SLD, Netzanalyse, NAP, Knotenpunkte
│   └── main.js                 ← ES-Module-Entry (nur Vite-Dev; exponiert Exporte auf window)
├── tests/                      ← Vitest (CalcEngine, Dispatch, Netz, WGK, Optimizer …)
├── field-app/                  ← PWA für Vor-Ort-Datenaufnahme
└── dist/
    ├── index.html              ← Gebaute Einzeldatei (per Doppelklick nutzbar)
    └── feldapp.html            ← Gebaute Feldapp
```

## Entwicklung

```bash
npm install         # einmalig
npm run dev         # Vite Dev-Server (Port 3000) — Achtung: ESM-Migration unvollständig,
                    #   einige Aktionen crashen nur im Dev-Modus (siehe eslint-undef.config.mjs)
npm test            # Vitest (Rechenkern-Tests)
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

## Ausliefern

```bash
npm run build           # → dist/index.html (eine Datei, doppelklickbar)
npm run build:feldapp   # → dist/feldapp.html
```

## Architektur

- **Zwei Laufzeitwelten:** Vite-Dev nutzt echte ES-Module; der Singlefile-Build entfernt
  alle import/export-Anweisungen und verkettet alles in einen globalen `<script>`-Block.
  Code muss in beiden Welten funktionieren — bevorzugt `window.*` für laufzeit-erzeugten
  Zustand und Setter-Funktionen statt Direktzuweisung an importierte Variablen.
- Event-Handler über Delegation (`data-click`, `data-input`, `data-change`), siehe
  `src/12-inline-handlers.js`.
- Der Optimizer-Worker bindet `_dispatchCore` per `toString()` ein — die Funktion muss
  self-contained bleiben (keine Closures).
- Reihenfolge der Dateien in `JS_FILES` (build-singlefile.mjs) ist maßgeblich für die
  Initialisierung von Top-Level-Variablen.
