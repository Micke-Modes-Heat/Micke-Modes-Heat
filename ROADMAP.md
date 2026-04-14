# Roadmap: Nächste Schritte

## Phase 2: ES-Module — ERLEDIGT (2026-04-14)

Alle 31 src/-Dateien auf ES-Module umgestellt:
- `export` vor allen Top-Level-Deklarationen
- `import`-Statements für Funktionen und Konstanten
- Mutable cross-file State nutzt `window.*` (ES-Module imported bindings sind read-only)
- `src/main.js` als Entry Point, bridged alle Exports auf `window.*`
- `index.html`: 30 `<script>`-Tags durch `<script type="module">` ersetzt
- Vite-Build: 35 Module → 789 KB Bundle (250 KB gzip)
- 227 Tests grün, ESLint clean, CI green

### Offene Verbesserungen (Phase 2b, optional)
- `window.*` für mutable State → echtes State-Modul mit Setter-Funktionen
- `data-click`-Handler in HTML → `addEventListener` in JS (entfernt window-Bridge-Bedarf)
- Zirkuläre Abhängigkeiten auflösen (globals ↔ gebaeude ↔ karte-werkzeuge)


## Phase 3: TypeScript (geschätzt: 2-4 Sessions, setzt Phase 2 voraus)

### Ziel
Tippfehler wie `leistungKw` vs `leistKw` zur Compile-Zeit fangen. Bessere Autovervollständigung.

### Vorgehen
1. **tsconfig.json** mit `allowJs: true, checkJs: true` — TypeScript prüft auch .js-Dateien
2. **Schrittweise**: Erst `.js` → `.ts` für Rechenkerne (reine Logik, kein DOM)
3. **Interfaces definieren**: `ErzeugerConfig`, `DispatchResult`, `KostenResult`, etc.
4. **DOM-Typen**: Leaflet, html2canvas als `@types/*` Pakete installieren

### Risiken
- Vite unterstützt TypeScript nativ — kein zusätzlicher Build-Step
- Worker-Code (String-Template) bleibt untypisiert
- Großer Aufwand bei UI-Modulen wegen DOM-Zugriff


## Phase 4: UI-Tests (optional, geschätzt: 1-2 Sessions)

### Ziel
DOM-Interaktion testen (CSV-Import, Gebäude-Management, Panel-Steuerung).

### Vorgehen
1. **jsdom** als Vitest-Environment aktivieren
2. **Mock-HTML**: Minimal-DOM mit den relevanten IDs aus `index.html`
3. **Integration-Tests**: CSV importieren → Gebäude erscheinen in Liste → recalcNetz wird aufgerufen
4. **Snapshot-Tests**: Panel-Rendering prüfen

### Risiken
- Leaflet braucht Canvas-Mock oder wird gemockt
- html2canvas funktioniert nicht in jsdom
- Hoher Aufwand für DOM-Setup


## Priorisierung

| Phase | Nutzen | Aufwand | Empfehlung |
|-------|--------|---------|------------|
| Phase 2 (ES-Module) | Hoch — Wartbarkeit, IDE | Mittel | ✓ Erledigt |
| Phase 3 (TypeScript) | Hoch — Fehlerprävention | Mittel | Nach Phase 2 |
| Phase 4 (UI-Tests) | Mittel — Regressionsschutz | Hoch | Optional |
