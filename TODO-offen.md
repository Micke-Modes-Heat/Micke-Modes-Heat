# Offene Punkte (Stand 12.06.2026, nach Review-/Fix-Session)

Erledigt bis hier: siehe `git log` (5 Commits, 39b1a94…2ff758b) — Build-Crashes,
Build-Wächter, fachliche Fixes (Erdreich/Defaults/VBH), ESM Phase 1 (230 Imports),
latente Crashes (CSV-Abgleich, Asset-Inspektor), Variantenvergleich-Fallback.

## 1. ESM Phase 2 — Setter-Refactor (mittel, mit Sorgfalt)
~54 Stellen weisen importierten Variablen direkt zu (Liste: `node tools/fix-missing-imports.mjs`
Probelauf, Abschnitt "Übersprungen"). Pro Variable Setter im exportierenden Modul anlegen
(Muster: `setMeritOrderKeys` in 06c), Aufrufstellen umstellen. Danach in eslint.config.js
`no-undef` von 'off' auf 'error' → CI fängt die Fehlerklasse künftig automatisch.
Verifikation: 227 Tests, dist-Diff minimal, Browser-Smoke (WP platzieren, Grundlage, Live-Tab).

## 2. GitHub-Push (klein, braucht Konsti)
5 lokale Commits auf main. Vorher: echten Autor setzen
(`git config user.name/user.email` — aktuell Platzhalter 'Konsti <konsti@local>')
und GitHub-Authentifizierung einrichten (PAT oder SSH).

## 3. Browser-Smoke-Test in CI (klein-mittel, risikofrei, lohnend)
Playwright-Test, der dist/index.html lädt und durchklickt: LWWP platzieren →
Grundlage berechnen (gl-gesamt=500) → prüfen: systemState.pMaxKw>0, Live-Tab sichtbar,
keine Konsolenfehler. In test.yml ergänzen; außerdem `npm run typecheck` in CI aufnehmen
und lint vor test ziehen.

## 4. Optimierer: Zwischenergebnisse (mittel)
Während der Grobsuche (~9 min bei Standard) die jeweils besten 3 Varianten live anzeigen
(Worker posten Teilergebnisse bereits an 10c-optimizer-run — dort einhängen).

## 5. Fachlicher Kleinkram (winzig)
- Wärmespeicher: `entladeKw` begrenzt in 06c-dispatch-core Phase 6 auch das LADEN —
  separate Laderate einführen (getThermSpeicherParams + UI-Feld).
- Live-Ansicht: „100 % Deckung" erscheint in Warnfarbe orange, obwohl alles ok.
- Codemod-Limitation: Mehrfach-Deklarationen (`export const R_MIN = 4, R_MAX = 54`)
  werden von tools/fix-missing-imports.mjs und build-singlefile.mjs getExportNames
  nur mit dem ersten Namen erfasst.

## 6. Eigentliches Ziel (Arbeitsordner-Workflow)
- Pilotprojekt: JSON-Export aus dem Tool → Bericht generieren (Vorlage in Berichtvorlagen/)
- JSON-Exportstruktur dokumentieren
