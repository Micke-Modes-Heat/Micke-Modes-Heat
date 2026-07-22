# Zwischenbericht 01 – Architektur, Build und CI

Stand: 18.07.2026  
Prüfumfang: Projektinventar, Modulabhängigkeiten, Entwicklungs-/Auslieferungsbuild, CI, statische Prüfung und externe Laufzeitabhängigkeiten.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

Die Anwendung besitzt eine sehr breite fachliche Abdeckung und eine grundsätzlich sinnvolle CI-Basis. Die technische Architektur ist jedoch stark gekoppelt. Entwicklungsmodus und ausgelieferte Einzeldatei verwenden semantisch unterschiedliche JavaScript-Laufzeitmodelle. Dadurch können Tests im einen Modus Fehler im anderen Modus übersehen. Der angezeigte Typecheck vermittelt außerdem deutlich mehr Abdeckung, als tatsächlich vorhanden ist.

## Verifizierter Umfang

- 61 JavaScript-Module unter `src/` einschließlich Konfiguration und Bibliotheken
- rund 63.000 Zeilen aus `index.html` und `src/**/*.js`
- Hauptanwendung, Singlefile-Build, Feld-App-Build, Service Worker
- GitHub-Actions-Test, Pages-Deployment und Release-Workflow
- Importgraph aller Quellmodule
- ESLint-, TypeScript-, Vitest- und Playwright-Konfiguration
- externe Browserbibliotheken und Build-Abhängigkeiten

## Befunde

### A-01 – Kritisch – Zwei semantisch verschiedene Laufzeitmodelle

Der Vite-Modus führt echte ES-Module aus. `build-singlefile.mjs` entfernt dagegen Importe/Exporte per regulären Ausdrücken, wandelt Top-Level-`let`/`const` in `var` um und verkettet alle Dateien in einer manuell gepflegten Reihenfolge.

Risiken:

- Modulbindungen und globale Properties verhalten sich unterschiedlich.
- Block-/Modul-Sichtbarkeit wird im Singlefile-Build verändert.
- Initialisierungsreihenfolge ist im Monolith Teil der Programmlogik.
- Regex-Transformation ist kein JavaScript-Parser und kann bei neuen Syntaxformen unbemerkt falschen Code erzeugen.
- Ein erfolgreicher Vite-Lauf beweist nicht, dass die Einzeldatei korrekt ist – und umgekehrt.

Nachweise: `README.md` Abschnitt Architektur, `build-singlefile.mjs` Funktion `stripModule`, `src/main.js` Window-Exposition.

Empfehlung: Eine kanonische Laufzeit festlegen. Bevorzugt mit Vite/Rollup eine einzige gebündelte HTML-Datei erzeugen, statt Quelltext per Regex umzuschreiben. Bis dahin beide Laufzeiten mit denselben Integrationsszenarien testen.

### A-02 – Kritisch – Fast der gesamte Kern ist ein zyklischer Abhängigkeitsblock

Die Importgraphanalyse ergibt einen Strongly Connected Component mit 34 Kernmodulen. Darin liegen unter anderem Globals, Gebäude, Karte, Wärme- und Stromnetz, Dispatch, Wirtschaftlichkeit, PV und Assets.

Folgen:

- Änderungen haben schwer vorhersagbare Seiteneffekte.
- Initialisierung kann auf teilweise initialisierte Module treffen.
- isolierte Tests und Wiederverwendung sind erschwert.
- Dateien können kaum unabhängig refaktoriert werden.
- der manuelle Singlefile-Load-Order wird faktisch zum zweiten Abhängigkeitsgraphen.

Besonders stark eingehende Abhängigkeiten: `01-globals-varianten.js` (41 Module), `02b-gebaeude.js` (29), `13a-assets-core.js` (28), `03c-gebaeude-io.js` (22).

Empfehlung: Abhängigkeiten schichten: Domänenmodelle/Rechenkerne → Application Services → UI/Rendering. UI darf Rechenkerne aufrufen, Rechenkerne dürfen nicht zurück in UI-Module importieren.

### A-03 – Hoch – `npm run typecheck` prüft den Großteil des Programms nicht

`tsconfig.json` setzt `allowJs: true`, aber `checkJs: false`. Nur Dateien mit `// @ts-check` werden geprüft. Dieses Kennzeichen besitzen derzeit lediglich sechs kleine Config-/Lib-Dateien. Die großen Fach- und UI-Module bleiben untypisiert, obwohl CI einen erfolgreichen Typecheck meldet.

Folgen:

- falsche Property-Namen und Datenformen in fast allen Hauptmodulen werden nicht erkannt.
- der CI-Schritt erzeugt ein falsches Sicherheitsgefühl.

Empfehlung: Abdeckung transparent benennen und schrittweise `checkJs`/JSDoc aktivieren, zuerst für Zustandsmodelle, Import/Export, Netzgraph, Dispatch-Konfiguration und Assets.

### A-04 – Hoch – Globale Zustands- und Funktionsoberfläche ist sehr groß

Im Quellbestand wurden rund 680 direkte Zuweisungen an `window.*` gefunden. `main.js` kopiert zusätzlich sämtliche Exporte aller Module auf `window`.

Folgen:

- Namenskollisionen werden zur Laufzeit entschieden.
- Besitzer und Lebensdauer eines Zustands sind nicht erkennbar.
- Module können Zustände außerhalb ihrer Domäne verändern.
- Tests benötigen umfangreiche globale Stubs.

Empfehlung: Zentrale Stores pro Domäne mit kontrollierten Mutationen; nur eine kleine, explizite Kompatibilitäts-API auf `window` belassen.

### A-05 – Hoch – Unsichere Iframe-Nachrichtenannahme

`03c-gebaeude-io.js` akzeptiert `ENERGIEKARTE_LOAD_BUILDINGS` per `window.addEventListener('message', ...)`, prüft aber weder `event.origin` noch `event.source`. Antworten werden mit Zielorigin `*` versendet.

Auswirkung: Wenn die App eingebettet wird, kann jeder erreichbare Frame Gebäudedaten einspeisen beziehungsweise über die Integration Daten empfangen. Abhängig vom Hosting ist das ein Integritäts- und Datenschutzrisiko.

Empfehlung: erlaubte Origins konfigurieren, `event.source === window.parent` prüfen, Nachrichtenschema validieren und Antworten an die konkrete geprüfte Origin senden.

### A-06 – Hoch – Externe CDN-Ressourcen ohne Integritätsbindung

Die Hauptapp lädt Leaflet, JSZip, Leaflet Toolbar, DistortableImage und PDF.js von CDNs. Es sind keine `integrity`-Hashes oder CSP-Regeln vorhanden. Die Feld-App lädt beim Build ebenfalls Bibliotheken live aus CDNs.

Folgen:

- Online-Entwicklung und Feld-App-Build hängen von Drittanbietern ab.
- Supply-Chain-Inhalte werden nicht kryptografisch gebunden.
- ein reproduzierbarer Feld-App-Build ist ohne eingefrorene lokale Artefakte nicht garantiert.

Empfehlung: Abhängigkeiten über `package-lock.json` beziehen und bundeln oder lokale, geprüfte Artefakte mit Hashprüfung verwenden. CSP für gehostete Varianten ergänzen.

### A-07 – Mittel – Singlefile-Hauptapp ist nicht vollständig offline

`html2canvas` und Klimadaten werden eingebettet, Leaflet-Markerbilder werden jedoch auf unpkg umgebogen; weitere Bibliotheken bleiben als CDN-Tags erhalten. „Per Doppelklick nutzbar“ ist damit nicht gleichbedeutend mit vollständig offline.

Empfehlung: Offline-Garantie exakt definieren und mit einem Browser-Test bei vollständig blockiertem Netzwerk verifizieren.

### A-08 – Mittel – Build ist nicht bytegenau reproduzierbar

Das Build-Datum wird bei jedem Lauf in die Datei injiziert. Die Feld-App lädt aktuelle CDN-Antworten, ohne Content-Hash zu prüfen. Gleicher Commit und gleiche Version können daher unterschiedliche Artefakte erzeugen.

Empfehlung: Build-Zeit über `SOURCE_DATE_EPOCH` oder Commit-Zeit steuerbar machen; Fremdressourcen versioniert lokal halten; Artefakt-Checksums im Release veröffentlichen.

### A-09 – Mittel – CI deckt nur einen sehr schmalen Browserpfad ab

Der einzige Playwright-Test prüft LWWP-Platzierung, Grundlagenberechnung und Sichtbarkeit des Live-Tabs. Zentrale Workflows wie Projektimport, Netzzeichnung, Varianten, Stromnetz, Feld-App und Exporte werden nicht geprüft.

Empfehlung: Smoke-Matrix für die wichtigsten End-to-End-Arbeitsabläufe und getrennte Läufe gegen Vite sowie Singlefile.

### A-10 – Mittel – Feld-App-Service-Worker verspricht einen Offline-Fallback, cached `index.html` aber bewusst nicht vor

Der Service Worker kommentiert, dass `index.html` nicht gecacht werde, verwendet bei Netzfehler dennoch `caches.match('./index.html')`. Ohne früheren anderweitigen Cache-Eintrag ist dieser Fallback leer.

Empfehlung: App-Shell versioniert precachen oder Navigation mit Network-First und garantiertem Cache-Fallback implementieren.

### A-11 – Niedrig – CI-/Paketpflege

- `package.json` enthält kein `type: module`; Node meldet beim ESLint-Lauf eine Modulwarnung.
- GitHub Actions sind nur über Major-Tags (`@v4`, `@v3`, `@v2`) statt Commit-SHAs gebunden.
- Release-Workflow baut nur die Hauptapp, während Pages Haupt- und Feld-App baut; Releaseinhalt und öffentliche Auslieferung sind nicht deckungsgleich.

## Positive Befunde

- CI führt Lint, Typecheck, Unit-Tests, Build und einen Browser-Smoke-Test in sinnvoller Reihenfolge aus.
- `npm ci` und `package-lock.json` werden verwendet.
- Der Singlefile-Build besitzt einen Wächter gegen vergessene Quelldateien.
- Externe Anfragen besitzen an mehreren Stellen Timeouts und Fallbacks.
- Rechennahe Config-/Lib-Dateien beginnen bereits mit Typprüfung.
- Release und Pages sind als getrennte, nachvollziehbare Verteilungswege dokumentiert.

## Verifikation

- ESLint: erfolgreich, nur Node-Modultyp-Warnung
- TypeScript: erfolgreich, aber geringe reale Abdeckung gemäß A-03
- Vitest: 19 Dateien, 356 Tests erfolgreich
- Singlefile-Build: erfolgreich
- lokaler Playwright-Lauf: nicht ausführbar, weil Chromium-Binärdatei nicht installiert war; CI installiert sie explizit

## Priorität für spätere Behebung

1. Laufzeitmodelle vereinheitlichen oder gleichwertig testen.
2. State-/Window-Divergenzen beseitigen.
3. Importzyklen durch fachliche Schichtung aufbrechen.
4. Iframe-Origin- und Schema-Prüfung ergänzen.
5. reale Typecheck-Abdeckung schrittweise ausbauen.
6. reproduzierbare, lokal gebundene Abhängigkeiten herstellen.

