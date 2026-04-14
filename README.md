# Energieplanung v2 — Modulare Version

## Struktur

```
v2/
├── index.html              ← HTML-Markup (ohne JS/CSS)
├── dev.sh                  ← Dev-Server starten
├── build.sh                ← Einzeldatei erzeugen → dist/Index.html
├── src/
│   ├── styles/app.css      ← Alles CSS
│   ├── 01-globals-varianten.js   ← Globale Variablen, Variantenverwaltung
│   ├── 02-netz-gebaeude.js       ← Netz-Hilfsfunktionen, Lastgang-Skalierung, Gebäude
│   ├── 03-erzeuger-netz.js       ← Alle Erzeuger (WP, BHKW, Kessel, Geo), recalcNetz
│   ├── 04-ui-analyse.js          ← Float-Panels, Analyse-Views, Emissionen, 3D
│   ├── 05-export-stromnetz.js    ← CSV/PDF-Export, Dialoge, Stromnetz, Sankey
│   ├── 06-system-dispatch.js     ← SystemState, CSV-Import, Dispatch (Stundensimulation)
│   ├── 07-analysis-views.js      ← Analyse-Tab Rendering
│   ├── 08-calc-engine.js         ← CalcEngine (SigLinDe, COP, VDI 2067)
│   ├── 09-pv-strom.js            ← PV-Profile, Strom-Panel, Batterie
│   ├── 10-optimizer.js           ← Optimierung (Grobsuche + Feinsuche)
│   ├── 11-hilfe-leitfaden.js     ← Hilfe-Tooltips, Leitfaden-Workflow
│   └── 12-inline-handlers.js     ← Kleine Event-Handler (Details-Toggle)
└── dist/
    └── Index.html          ← Gebaute Einzeldatei (nach build.sh)
```

## Entwicklung

```bash
cd v2
./dev.sh          # startet http://localhost:3000
# → Browser öffnen, bei Änderungen F5 drücken
```

## Ausliefern

```bash
cd v2
./build.sh        # → dist/Index.html (eine Datei, wie bisher)
```

## Hinweise

- Alle JS-Dateien teilen sich den globalen Scope (keine ES-Module)
- Die Reihenfolge der Script-Tags in index.html ist wichtig
- Änderungen an einer JS-Datei erfordern nur Browser-Refresh
- `build.sh` fügt alles wieder zu einer Datei zusammen
- Das Original (`../Index.html`) bleibt unverändert
