# Zwischenbericht 1 – Daten, Import und Varianten

Stand: umgesetzt und regressionsgeprüft.

- Projekt-Schema v2 mit zentraler Struktur- und Koordinatenprüfung.
- Migration alter v1-Projekte; neuere unbekannte Versionen werden abgelehnt.
- Import arbeitet transaktional und rollt bei Fehlern auf den vorherigen Zustand zurück.
- Vollständiger Wärmenetzgraph inklusive Trassen-/Abzweigknoten, DN, Stilllegung, Kostenklasse und Waypoints.
- Varianten speichern ihre eigene Wärmenetz- und Stromnetz-Topologie; Wechsel erfolgt ohne verzögerte Mischzustände.
- Nullwerte werden beim Laden nicht mehr pauschal durch Truthiness-Defaults überschrieben.
- Ein echter Browser-Roundtrip exportiert, zerstört und lädt Trasse, vollständigen Wärmegraphen, Waypoint und legitime Nullwerte in Singlefile und ESM verlustfrei.
- Autosave nutzt IndexedDB, drei Generationen, Zeitstempel und sichtbare Fehler; localStorage bleibt Kompatibilitätsfallback.

Relevante Tests: `project-schema.test.js`, `autosave-store.test.js`, Wärmenetz-Browserworkflow.
