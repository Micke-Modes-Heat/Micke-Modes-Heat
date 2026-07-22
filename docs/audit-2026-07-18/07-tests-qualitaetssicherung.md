# Zwischenbericht 07 – Tests und Qualitätssicherung

Stand: 18.07.2026  
Prüfumfang: Unit-/Integration-/E2E-Tests, Testhelper, CI-Ausführung, Assertions, Laufzeitmodi und fehlende Testklassen.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

356 grüne Unit-Tests sind eine gute Basis, insbesondere für Recheninvarianten. Die Zahl darf jedoch nicht mit Systemabdeckung verwechselt werden: Die Tests konzentrieren sich stark auf Optimierer, Wirtschaftlichkeit, PV, Konfiguration und reine Formeln. Karten-, DOM-, Persistenz- und vollständige Nutzerworkflows sind nahezu ungetestet. Der Testhelper erzeugt zudem ein drittes, künstliches Laufzeitmodell.

## Befunde

### T-01 – Kritisch – Testhelper prüft weder echtes ESM noch exakt den Singlefile-Build

`tests/load-script.js` entfernt Import-/Exportzeilen mit Regex und führt Dateien via `vm.runInThisContext()` global aus. Das ähnelt dem Monolithen, verwendet aber nicht dessen vollständige Transformation/Reihenfolge und nicht die ESM-Semantik.

Folgen: Importzyklen, Live-Bindings, `window`-Kopien und echte Browserinitialisierung werden nicht realistisch geprüft.

Empfehlung: reine Kerne regulär als ES-Module importieren; Singlefile-Verhalten ausschließlich gegen das gebaute Artefakt im Browser testen.

### T-02 – Hoch – Keine gemessene Coverage

Es existieren keine Coverage-Schwellen für Statements, Branches, Functions oder Lines. Bei sehr großen Modulen kann eine hohe Testzahl nur kleine Funktionsinseln abdecken.

Empfehlung: V8-Coverage einführen, zunächst Bericht ohne Gate; danach modulbezogene Mindestwerte für Rechenkerne und kritische Zustandslogik.

### T-03 – Hoch – Nur ein E2E-Szenario

Der Playwright-Smoke prüft LWWP-Platzierung, Grundlagenberechnung und Live-Tab. Er deckt weder Projektimport/-export, Netzaufbau, Varianten, Stromnetz, Optimierer, Exporte noch Feld-App ab.

### T-04 – Hoch – Keine DOM-/UI-Integrationstests

Das minimale DOM-Mock liefert meist `null` und kann Rendering, Eventdelegation, doppelte IDs, Fokus, Dialoge und Eingabevalidierung nicht prüfen.

### T-05 – Hoch – Keine Persistenz-/Migrationstests

Es fehlen Projekt-JSON-Roundtrips, Altversionsfixtures, fehlerhafte Dateien, transaktionales Rollback und Autosave-Quota-Szenarien.

### T-06 – Hoch – Netzgraph-Workflows ungetestet

Nicht abgedeckt: Trassenabzweige, MST, Zusammenhang, Zyklen, Junctions, Bestandsnetz, manuelle Waypoints, Graphimport und Wärme-/Elektrotrasseninteraktion.

### T-07 – Hoch – Kein Cross-Engine-Konsistenztest

Hauptdispatch, CalcEngine, Optimierer-Worker und Main-Thread-Fallback werden nicht systematisch mit identischer Fixture verglichen.

### T-08 – Mittel – Keine Property-/Fuzz-Tests für Parser und Graphen

CSV-/JSON-/GML-/GeoJSON-Parser sowie Netzgraphen erhalten keine zufällig generierten Grenzfälle. Gerade externe Datenformate profitieren von Fuzzing und Invarianten.

### T-09 – Mittel – Keine Accessibility-/Visual-Regressionstests

Es fehlen axe-Prüfung, Tastaturnavigation, Fokusablauf und Screenshots zentraler Ansichten.

### T-10 – Mittel – Keine Performance-/Speicherbudgets

Große OSM-Projekte, zahlreiche Assets, 8 Worker, große Overlays und Feldfotos werden nicht unter definierten Limits getestet.

### T-11 – Mittel – E2E lokal nicht selbstbereitstellend

`npm run test:e2e` setzt eine separat installierte Playwright-Chromium-Binärdatei voraus. CI installiert sie, die lokale Entwickleranleitung erwähnt den zusätzlichen Schritt nicht ausreichend.

### T-12 – Mittel – CI-Matrix ist schmal

Nur Node 20 und Chromium auf Ubuntu. Keine Firefox-/WebKit-Prüfung, kein Windows/file://-Szenario und kein echter Offline-Lauf, obwohl die Einzeldatei gerade dort eingesetzt wird.

## Positive Befunde

- 19 Unit-Testdateien und 356 erfolgreiche Tests.
- gute Invariantentests für PV-/Batteriebilanzen.
- umfangreiche Optimierer- und Wirtschaftstests.
- Tests für Nullzins, Monotonien, Grenzen und Determinismus.
- Fahrplan-Zyklen und Cluster-Roundtrip werden geprüft.
- CI baut vor E2E das reale Singlefile-Artefakt.
- `main.js` besitzt einen Wächter gegen vergessene Window-Expositionen.

## Empfohlene Testpyramide

1. Reine Domänenkerne: reguläre ESM-Unit- und Property-Tests.
2. Application Services: Projektimport, Varianten, Graphoperationen mit realistischen Fixtures.
3. DOM-Komponenten: jsdom/happy-dom nur für formularbasierte UI.
4. Browser-E2E gegen Vite und Singlefile.
5. file://-/Offline-Smoke für ausgelieferte Einzeldateien.
6. Performancefixtures und Accessibilityprüfung.

## Unmittelbar wichtigste neue Szenarien

1. Projekt-Roundtrip mit Wärmejunction, Stromassets und Varianten.
2. Haupttrasse zeichnen → Abzweig → Vorschlag → Reload.
3. identische Dispatch-Ergebnisse in Main/Worker/Fallback.
4. ungültiger Import lässt aktuelles Projekt unverändert.
5. Feld-App laden → Foto/Notiz → ZIP → Hauptapp-Reimport.
6. vollständiger Offline-Start.

