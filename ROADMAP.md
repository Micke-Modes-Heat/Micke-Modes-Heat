# Roadmap: Nächste Schritte

## Phase 2: Echte ES-Module (geschätzt: 2-3 Sessions)

### Ziel
Alle `window.*`-Globals durch saubere `import`/`export`-Statements ersetzen.
Danach: Tree-Shaking, bessere IDE-Unterstützung, keine Reihenfolge-Abhängigkeiten.

### Vorgehen
1. **State-Modul** (`src/state/globals.js`) — alle globalen Variablen (`gebaeude`, `netzEdges`, etc.) als benannte Exports. Andere Module importieren daraus.
2. **Config-Module** zuerst (`config/*.js`) — reine Daten, keine Abhängigkeiten. `export const ERZEUGER_CFG = {...}` statt `const ERZEUGER_CFG = {...}`.
3. **Rechenkerne** (`calc-engine.js`, `dispatch-core.js`, `analysis-economics.js`, `pv-profile.js`) — bereits quasi-modular (keine DOM-Abhängigkeiten). Einfachste Umstellung.
4. **UI-Module** (`erzeuger.js`, `gebaeude.js`, `netz.js`, etc.) — importieren aus State + Config + Calc. `addEventListener` statt inline-Handler.
5. **Optimizer** — Worker-Code muss String-Template bleiben (Web Worker kann nicht importieren). Aber die Main-Thread-Teile werden Module.
6. **`main.js`** — wird zum echten Entry Point mit Imports statt `<script>`-Tags.

### Risiken
- **Inline Event-Handler** (`onclick="recalcNetz()"`) in `index.html` müssen ALLE auf `addEventListener` umgestellt werden — ~60 Stellen
- **Zirkuläre Abhängigkeiten** — z.B. `globals.js` ↔ `gebaeude.js`. Lösung: Mediator-Pattern oder Lazy-Imports
- **Web Worker** kann nicht importieren → `_dispatchCore.toString()` Muster bleibt

### Verifikation
- Alle 227 Tests müssen weiter grün sein
- App muss im Browser identisch funktionieren
- `npm run build` muss weiter Single-File-Output liefern


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
| Phase 2 (ES-Module) | Hoch — Wartbarkeit, IDE | Mittel | Als nächstes |
| Phase 3 (TypeScript) | Hoch — Fehlerprävention | Mittel | Nach Phase 2 |
| Phase 4 (UI-Tests) | Mittel — Regressionsschutz | Hoch | Optional |
