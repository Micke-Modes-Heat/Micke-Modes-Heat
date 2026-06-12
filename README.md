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
npm run build           # → dist/index.html (eine Datei, Version wird injiziert)
npm run build:feldapp   # → dist/feldapp.html
```

Die aktuelle Version aus `package.json` wird beim Build in die Datei
geschrieben und im Header neben „Micke-Heat" als Badge angezeigt.

## Release & Verteilung ans Team

**Versionierung:** SemVer (`vMAJOR.MINOR.PATCH`), Quelle ist das `version`-Feld
in `package.json`.

**Eine neue Version veröffentlichen:**

```bash
npm version minor      # erhöht package.json + erstellt Git-Tag vX.Y.Z (z. B. v0.2.0)
git push && git push --tags
```

Das Tag startet den Workflow `.github/workflows/release.yml`. Er baut die
Einzeldatei und legt automatisch ein **GitHub Release** mit angehängter
`index.html` (eingefroren, referenzierbar) an.

**Zwei Verteilungswege:**

| Weg            | URL / Ort                                         | Stand          |
|----------------|---------------------------------------------------|----------------|
| GitHub Pages   | `https://<owner>.github.io/<repo>/`               | immer aktuell  |
| GitHub Release | Repo → *Releases* → `index.html` herunterladen    | eingefroren    |

GitHub Pages aktualisiert sich bei jedem Push auf `main`
(`.github/workflows/deploy-pages.yml`).
> Einmalig nötig: Repository → **Settings → Pages → Source: „GitHub Actions"**.

## Feedback vom Team

In der App gibt es oben rechts einen **✉-Button**. Er öffnet ein kleines
Formular (Beschreibung + optionaler Screenshot der aktuellen Ansicht) und
erzeugt daraus eine **HTML-Datei zum Download** (`Feedback_Micke-Heat_vX.Y.Z_…html`)
mit Text, Screenshot und Metadaten (Version, Build-Datum, Browser, Auflösung,
Seite). Diese Datei kann das Team einfach weiterleiten – sie lässt sich direkt
im Browser öffnen und enthält alle Infos für die Auswertung.

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
