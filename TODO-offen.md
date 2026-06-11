# Offene Punkte (Stand 11.06.2026, nach Abarbeitungs-Session)

Erledigt in dieser Session (Commits 038bd70…):
- **ESM Phase 2 komplett**: 111 Zuweisungen auf Setter umgestellt
  (tools/phase2-setters.mjs), `no-undef` + `no-import-assign` stehen jetzt
  auf `error` — die Fehlerklasse „fehlender Import crasht nur im Dev" wird
  ab sofort von ESLint/CI gefangen. Dabei 5 echte latente Bugs gefixt
  (synState-Doppelberechnung, ctx-Global-Leak, toter Sensitivitäts-Tab im
  Dev, fg→fliessgewaesser im Leitfaden, selectedStrandId im data-click).
- **CI ausgebaut**: Playwright-Smoke-Test gegen dist (LWWP → Grundlage →
  pMaxKw/Live-Tab/Konsolenfehler), `npm run typecheck` in CI, lint vor test.
  Lokal: `npm run test:e2e`.
- **Optimierer**: zeigt während Grob-/Feinsuche live die besten 3 Varianten.
  Dabei kritischen Worker-Crash gefixt (quartierH-ReferenceError): Der
  Optimierer lief seit Einführung des Quartier-Stroms IMMER im langsamen
  Main-Thread-Fallback — jetzt wieder echt parallel (alle Kerne). Die
  „~9 min bei Standard" dürften deutlich sinken.
- **Fachlicher Kleinkram**: separate Speicher-Laderate (ts-lade-kw, Dispatch
  Phase 6 + PV-Pfade + Optimizer), 100%-Deckung nicht mehr orange,
  Export-Parser erkennt Mehrfach-Deklarationen (tools/export-names.mjs).
- **JSON-Export dokumentiert**: docs/json-export.md (für Berichts-Workflow).

## 1. GitHub-Push (klein, braucht Konsti)
Inzwischen 12 lokale Commits auf main. Vorher: echten Autor setzen
(`git config user.name/user.email` — aktuell Platzhalter 'Konsti <konsti@local>')
und GitHub-Authentifizierung einrichten (PAT oder SSH).

## 2. Pilotprojekt Berichts-Workflow (eigentliches Ziel, braucht Konsti)
JSON-Export aus dem Tool → Bericht generieren (Vorlage in Berichtvorlagen/).
Eingangsdaten in Projekte/[PROJEKT]/Eingangsdaten/ ablegen, dann Claude den
Bericht generieren lassen. docs/json-export.md beschreibt, welche Werte im
JSON stehen und was nachgefragt werden muss (Förderprogramm, Schall etc.).

## 3. Kleinigkeiten (optional)
- package.json: `"type": "module"` setzen (ESLint-Warnung beim Laden der
  Config; vorher prüfen, dass build-singlefile.mjs/Skripte unverändert laufen).
- Grundlagen-Einstellungen (gl-*-Felder: Klimastandort, Profil, Netzverlust)
  werden nicht mit ins Projekt-JSON exportiert — bei Bedarf ergänzen
  (_buildProjectData/_loadProject in 03c).
- Optimierer-Zwischenstand zeigt Grob-Konfigurationen mit teils kleinen
  kW-Werten (Roh-Stufen vor Feinsuche) — kosmetisch, ggf. ausblenden bei <5%.
