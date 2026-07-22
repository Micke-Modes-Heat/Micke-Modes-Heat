# Zwischenbericht 7 – Qualitätssicherung

Stand: 383 Unit-Tests plus Browserparität für zwei Laufzeiten und Feld-App unter `file://`.

- Neue Tests für Schema/Migration, tiefes Klonen, Wärmenetzgraph, Ring-/Erreichbarkeitsprüfung, Autosave-Metadaten und kalenderkorrekte Zeitreihen.
- Deterministische Property-/Fuzz-Suite: 400 variable gültige Projekte ohne Mutation, 300 ungültige Koordinatenfälle und 300 zufällige Wärmebäume mit Ringinjektion.
- Harte Kernbudgets: Projektvalidierung mit 2.000 Gebäuden und Wärmegraphprüfung mit 5.000 Knoten jeweils unter einer Sekunde.
- Playwright prüft Smoke-Dispatch, den vollständigen Trassen-/Abzweigworkflow und einen validierten Projekt-Roundtrip mit Wärmegraph/Nullwerten.
- Dieselben E2E-Szenarien laufen gegen Offline-Singlefile und echten Vite-/ESM-Modus.
- Die Feld-App wird als gebaute Einzeldatei direkt über `file://` mit Demo-Karte, IndexedDB, Leaflet, ZIP und eindeutigen DOM-IDs geprüft.
- Die erweiterte Browsermatrix umfasst 14 Abläufe je Hauptlaufzeit. Neu hinzugekommen sind zentrale Planungstransaktionen, Kartenwerkzeugwechsel, vier Responsive-Viewports, lokale Datenschutzlöschung und ein echter elektrischer MS-Ring mit Trennstelle/Stichbetrieb/(n-1)-Fällen.
- Coverage v8 ist eingerichtet; HTML-/JSON-Bericht und ein nicht unterschreitbarer Gesamt-Baseline-Wächter sind aktiv.
- `test:all` bündelt Lint, Typecheck, Unit-Tests, Build und beide Browserlaufzeiten.
- npm-Abhängigkeitsprüfung: 0 bekannte Schwachstellen.

Die Coverage-Baseline liegt wegen der großen DOM-gebundenen Altmodule erst bei rund 4 %. Sie ist nun transparent und geschützt, muss aber mit weiteren UI-Integrationstests systematisch steigen.
