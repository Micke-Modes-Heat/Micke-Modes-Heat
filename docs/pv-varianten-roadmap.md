# PV-Varianten-Workflow — Roadmap

*Stand: 2026-06-27 · Branch `claude/pv-variant-workflow-0ghbsv`*

Vollständige Roadmap vom heutigen Stand bis zum ausgelieferten Feature.
Begleitdokument zu `docs/pv-varianten-workflow-konzept.md` (dort: Datenmodell,
Algorithmen, UI-Spec, Reuse-Referenz). Hier: Meilensteine, Reihenfolge,
Abhängigkeiten, Aufwand, Gates.

---

## Übersicht: 4 Phasen, 8 Meilensteine

```
Phase 0  Vorbereitung   M0  Entscheidungen + Setup
Phase 1  Rechenkern     M1 Datenmodell → M2 Merit-Order → M3 Ertüchtigung → M4 Fahrplan
Phase 2  Oberfläche     M5 Selektion+Bulk → M6 Ausbauplaner-Board
Phase 3  Abschluss      M7 Integration+Politur → M8 Release
```

Leitlogik: **erst der Rechenkern (testbar, ohne UI), dann die Oberfläche darauf.**
Jede Logik ist per Vitest absicherbar, bevor sie ein Klick auslöst.
(M1–M7 entsprechen den Etappen A–G im Konzeptdokument.)

---

## Phase 0 — Vorbereitung

### M0 · Entscheidungen & Setup *(klein, ~½ Session)*
- Die 5 offenen Entscheidungen aus Abschnitt 9 des Konzepts klären:
  Phasen projektweit vs. variantenspezifisch · Vorlagen-Katalog-Ort ·
  Per-NAP-Zerlegungs-Grenze · Gantt-Renderer (eigenes Canvas/SVG, keine neue Dep) ·
  Abregelung als Maßnahme oder NAP-Parameter.
- `config/massnahmen-vorlagen.js` als Gerüst anlegen (analog `netz-kosten.js`).
- **Exit:** Entscheidungen als Nachtrag im Konzeptdokument festgehalten.

---

## Phase 1 — Rechenkern (ohne UI, voll testbar)

### M1 · Datenmodell-Fundament (= Etappe A) *(klein, risikoarm)*
- Maßnahme um `dependsOn`/`phaseId` erweitern; `MASSN_TYP` ergänzen (`13e`).
- `phasen`-State + Setter/Capture/Restore (`01`); `massnahmeJahr()`-Helper;
  `getAssetPropsForYear` darauf umstellen (`13a`).
- Persistenz: `phasen` in `_buildProjectData`/`_loadProject` (`03c`).
- **Exit:** Round-Trip-Test grün (speichern/laden mit Phasen + neuen Feldern);
  alte JSONs ohne neue Felder laden weiter.

### M2 · Flächen-Merit-Order (= Etappe B) *(Rechenkern, mittel)*
- `14a-kandidaten.js`: `pvEnumerateKandidaten()` (Einzelliste aus den 4 PV-Quellen).
- Greedy-Marginal-Algorithmus über den Optimizer-Worker + Per-NAP-Zerlegung.
- Ausgaben: Rangliste/Tiers (A/B/C), kumulative Überschuss-Kurve
  (Nulldurchgang = wirtschaftlich sinnvolle Ausbaugröße).
- **Exit:** Vitest mit synthetischer Kandidatenmenge → erwartete Reihenfolge/Tiers;
  Laufzeit bei ~50 Flächen vertretbar.

### M3 · Infrastruktur-Ertüchtigung (= Etappe C) *(Rechenkern + Vorlagen, mittel)*
- `14b-ertuechtigung.js`: Headroom→Alternativen (Δu / Anschlusskapazität, Doku §8).
- Maßnahmen-Vorlagen (Kosten/`newProps`/`dependsOn`); in Merit-Order einklinken (Δinfra).
- **Exit:** Test Engpass-Szenario → erwartete Alternativen + Kosten;
  Δinfra verändert das Ranking korrekt.

### M4 · Fahrplan-Logik (= Etappe D) *(Graph, klein–mittel)*
- `14c-phasen.js`: Topo-Sort, Phasen-Schnitt, Validierung;
  schreibt `jahr`/`phaseId`/`baujahr`.
- **Exit:** Test Abhängigkeitskette → korrekte Bau-Reihenfolge;
  Zyklen/Verletzungen werden erkannt.

> **Zwischenstand nach Phase 1:** Der gesamte Workflow rechnet durch — eine Variante
> samt Fahrplan ließe sich per Konsole erzeugen. Es fehlt nur die bequeme Bedienung.

---

## Phase 2 — Oberfläche

### M5 · Selektion + Bulk-Bar (= Etappe E) *(UI, mittel)*
- `assetSelection`-State; Karten- (Box/Lasso) + Listen-Selektion (Checkboxen, Filter);
  „selected"-Ring am Marker.
- Bulk-Bar mit Sammelaktionen (→ Phase / Maßnahme aus Vorlage / Status / Jahr),
  Reuse `wireMassnahmen`.
- **Exit:** mehrere Assets wählen → einer Phase zuweisen → State korrekt (manuell verifiziert).

### M6 · Ausbauplaner-Board (= Etappe F) *(größte UI-Etappe)*
- `14d-ausbauplaner-ui.js`: Vollbild (Muster `napShowSection`), Gantt mit Gewerk-Swimlanes.
- Drag (Balken/Phase), `dependsOn`-Pfeile, Live-Validierung (rot bei Konflikt),
  Knopf „Plan automatisch erzeugen".
- Variantenwähler, „Abspielen" (über `globalYear`), Anbindung an Variantenvergleich.
- **Exit:** Auto-Plan erzeugen → Phase verschieben → Konflikt sichtbar →
  zwei Varianten vergleichen.

---

## Phase 3 — Abschluss

### M7 · Integration & Politur (= Etappe G) *(mittel)*
- Variantenvergleich um „Invest je Phase/Jahr" erweitern (`01` `renderVergleich`/Pareto).
- Sensitivitäten (Strompreis, Einspeise-/Spotpfad, Batteriekosten, Zins) auf Varianten.
- Export/Bericht (`05a`/`05d`), Hilfetexte (`config/hilfe-texte.js`), Leitfaden (`11`).
- e2e-Smoke (`tests-e2e`) gegen `dist`.
- **Exit:** Lint/Typecheck/Test/Build/e2e grün; ein Beispielprojekt durchgespielt.

### M8 · Release
- `ROADMAP.md`/`README.md` aktualisieren; `npm version minor` → Tag → Release-Workflow.
- **Exit:** versionierter Build verteilt (GitHub Pages + Release-Asset).

---

## Abhängigkeiten & kritischer Pfad

```
M0 ─► M1 ─► M2 ─► M3 ─► M4 ─► M5 ─► M6 ─► M7 ─► M8
   M3 hängt an M2 (Δinfra) · M4 nutzt M3-Maßnahmen
   M5/M6 brauchen M1-Datenmodell
```
- **Kritischer Pfad:** M2 → M3 → M4.
- **M5** (Selektion) kann parallel zu M3/M4 vorgezogen werden, wenn früher eine
  bedienbare Oberfläche gewünscht ist.

## Qualitäts-Gates (nach jedem Meilenstein)
`npm run lint && npm run typecheck && npm test && npm run build` müssen grün sein.
Bei UI-Meilensteinen zusätzlich manuell in `dist/index.html` prüfen.
**Jede neue `src/*.js` sofort in `JS_FILES` (build-singlefile.mjs)** — Build-Wächter bricht sonst ab.

## Aufwandsschätzung (grob)
| Phase | Sessions | Schwerpunkt |
|---|---|---|
| Phase 1 (Rechenkern) | ~4 | M2/M3 am dichtesten |
| Phase 2 (UI) | ~2–3 | M6 (Board) am größten |
| Phase 3 (Abschluss) | ~1–2 | Politur + Release |

## Fortschritt
- [x] M0 Entscheidungen & Setup
- [ ] M1 Datenmodell-Fundament
- [ ] M2 Flächen-Merit-Order
- [ ] M3 Infrastruktur-Ertüchtigung
- [ ] M4 Fahrplan-Logik
- [ ] M5 Selektion + Bulk-Bar
- [ ] M6 Ausbauplaner-Board
- [ ] M7 Integration & Politur
- [ ] M8 Release
</content>
