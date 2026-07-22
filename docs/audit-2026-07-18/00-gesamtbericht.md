# Gesamtaudit Micke-Heat

Stand: 18.07.2026  
Auditart: vollständiger statischer und testgestützter Programmaudit ohne Fehlerbehebung.  
Geprüft: Hauptapp, Rechenkerne, Wärme-/Stromnetz, PV/Batterie, Assets/Ausbauplanung, Persistenz, UI, Feld-App, Build, CI und Tests.

## Gesamturteil

Micke-Heat ist fachlich ungewöhnlich leistungsfähig und hat für ein browserbasiertes Planungstool eine breite Rechenkern-Testbasis. Der größte Risikofaktor ist nicht eine einzelne Formel, sondern die Systemarchitektur: nahezu der gesamte Kern ist zyklisch gekoppelt, Zustand liegt parallel in ES-Modulen und auf `window`, und die ausgelieferte Einzeldatei besitzt andere JavaScript-Semantik als der Entwicklungsmodus.

Die Anwendung ist derzeit gut als ambitioniertes Screening- und Variantenwerkzeug einsetzbar, sofern Ergebnisse fachlich plausibilisiert werden. Für belastbare, reproduzierbare Projektbearbeitung müssen zuerst Datenintegrität, State, Persistenz und Graphmodelle stabilisiert werden. Eine reine UI-Politur am Netz würde die darunterliegenden Probleme nicht lösen.

## Auditgrenzen

Dieser Audit umfasst den gesamten vorhandenen Quellbestand und die ausführbaren statischen/Unit-Prüfungen. Nicht Bestandteil eines reinen Codeaudits waren:

- Validierung jeder Fachformel gegen kostenpflichtige Normvolltexte und externe Referenzsoftware,
- reale Feldbegehung auf mehreren Mobilgeräten,
- vollständiger manueller Browserdurchlauf, weil lokal keine Playwright-Chromium-Binärdatei installiert war,
- Penetrationstest eines produktiven Hostings,
- Lasttest mit realen Kundenprojekten, die nicht im Repository vorliegen.

Diese Punkte sind als separate Validierungsphase nach Stabilisierung sinnvoll.

## Kennzahlen

- 61 JavaScript-Module unter `src/`
- rund 63.000 Zeilen Haupt-HTML/JavaScript
- rund 680 direkte `window.*`-Zuweisungen
- ein zyklischer Kernblock aus 34 Modulen
- sechs tatsächlich per `@ts-check` geprüfte Dateien
- 19 Unit-Testdateien, 356 Tests erfolgreich
- ein Browser-Smoke-Szenario
- zwei unterschiedliche Auslieferungs-/Laufzeitmodelle plus VM-Testmodell

## Kritische Befunde

1. **A-01:** ESM und Singlefile-Monolith besitzen unterschiedliche Semantik.
2. **A-02:** 34 Kernmodule bilden einen gemeinsamen Importzyklus.
3. **D-01:** Projektimport löscht den aktuellen Zustand vor vollständiger Validierung.
4. **D-02:** Modul- und Window-Zustand können auseinanderlaufen.
5. **D-03:** Wärmenetzgraph wird nicht verlustfrei gespeichert.
6. **N-01:** Wärme- und Elektrotrasse teilen ein fachlich mehrdeutiges Modell.
7. **N-02:** optische Trassenabzweige sind im Wärmegraphen nicht zwingend verbunden.
8. **E-01:** Hauptdispatch, CalcEngine und Optimierer besitzen parallele Rechenwege.
9. **S-01:** elektrischer Graph wird über mehrere Datenstrukturen synchronisiert.
10. **T-01:** Unit-Testhelper bildet weder echtes ESM noch den exakten Build ab.

## Wichtigste hohe Risiken

- Projekt-Reload/Autosave/Varianten können Zustände verlieren oder vermischen.
- Haupttrasse beeinflusst den Auto-Netz-Verlauf nicht so strikt, wie die UI suggeriert.
- Zeichnungsabschluss löscht und ersetzt unmittelbar das Wärmenetz.
- Ring-/Zyklusnetze werden in zentralen Berechnungen auf einen Baum reduziert.
- Fallbackdaten können Ergebnisse stark beeinflussen, ohne überall sichtbar zu bleiben.
- `typecheck` deckt den überwiegenden Quellbestand nicht ab.
- importierte Texte besitzen einzelne potenzielle DOM-XSS-Pfade.
- Iframe-Nachrichten werden ohne Originprüfung akzeptiert.
- elektrische Ergebnisse sind Screening, keine vollständige Lastfluss-/Schutzstudie.
- zentrale Nutzerworkflows besitzen kaum Browser-/Roundtrip-Tests.

## Stärken

- sehr breite fachliche Modellierung in einer lokal nutzbaren Anwendung,
- nachvollziehbare Kommentare und zahlreiche explizite Fallbacks,
- gute PV-/Batterie-Bilanzinvarianten,
- umfangreiche Optimierer-, Wirtschaftlichkeits- und Rechenkern-Tests,
- stündliche Wärme-/Strombetrachtung,
- Wärmehydraulik, WLD, Verluste, Druckpfad und Subtree-Wirtschaftlichkeit,
- elektrische Assets, NAP, MS-Ring, Ertüchtigung und Ausbauphasen,
- Feld-App mit IndexedDB, Fotokompression und ZIP-Rückweg,
- etablierte CI-, Release- und Pages-Prozesse.

## Empfohlene Sanierungsreihenfolge

### Phase 0 – Sicherung und Reproduzierbarkeit

- Referenzprojekte/Golden Files anlegen.
- aktuellen Singlefile-Stand und ESM-Verhalten mit denselben Szenarien erfassen.
- Projekt-Roundtrip und Berechnungsmanifest einführen.
- vor Umbauten eine belastbare E2E-Baseline schaffen.

### Phase 1 – Datenintegrität

- Projektimport validieren und transaktional machen.
- Schema/Migrationen einführen.
- Falsy-/Nullwertfehler beheben.
- vollständigen Wärmegraphen serialisieren.
- Autosave mit Status/Generationen absichern.

### Phase 2 – State und Laufzeit

- eine autoritative State-Quelle schaffen.
- `window` auf kleine Kompatibilitäts-API reduzieren.
- Singlefile über echten Bundler erzeugen.
- Importzyklen schrittweise aufbrechen.

### Phase 3 – Netzgrundmodell

- gemeinsames Korridormodell mit getrennten Nutzungen Wärme/NS/MS.
- stabiler Graph aus Nodes/Edges/Polylines.
- Zusammenhang, Baum/Ring und Ownership explizit validieren.
- Zeichnen, Vorschau und Übernahme trennen.

### Phase 4 – Rechenkerne konsolidieren

- Hauptdispatch/Worker/Fallback auf gemeinsamen Core bringen.
- Zeitreihenmodell mit Kalender/Provenienz.
- Eingaben und Ergebnisse trennen.
- wirtschaftliche Szenarien zentralisieren.

### Phase 5 – UI/UX

- zentrale Interaction State Machine.
- aufgabenbasierter Netzeditor mit Undo/Redo und Snap auf Linien.
- barrierefreie Dialoge/Tabs/Fokusführung.
- dauerhaftes Fehler-/Datenqualitätszentrum.

### Phase 6 – Fachliche Validierung und Skalierung

- Referenzfälle gegen externe Fachsoftware/Normbeispiele.
- Performancebudgets für große Projekte.
- Cross-Browser/file:///Offline/Feldgeräte.
- Security-/Datenschutzprüfung des produktiven Hostings.

## Konkreter Start nach dem Audit

Für den von dir priorisierten Netzaufbau sollte die Umsetzung nicht direkt mit Button-/Mausänderungen beginnen. Die sinnvolle erste Arbeitseinheit lautet:

1. Trassen-State vereinheitlichen.
2. bestehende Wärme- und Elektro-Nutzung inventarisieren/migrieren.
3. Graphmodell plus verlustfreien Export/Import entwickeln.
4. Tests für Abzweig, Roundtrip und Auto-Netz-Vorschau schreiben.
5. erst danach den flüssigen Karteneditor implementieren.

So wird das Handling dauerhaft besser, statt nur die aktuelle instabile Logik komfortabler erreichbar zu machen.

## Zwischenberichte

1. `01-architektur-build-ci.md`
2. `02-zustand-varianten-import-export.md`
3. `03-waermenetz-karte-haupttrasse.md`
4. `04-lastgang-erzeuger-dispatch-optimierer.md`
5. `05-stromnetz-assets-pv-batterie-ausbau.md`
6. `06-ui-ux-sicherheit-performance-feldapp.md`
7. `07-tests-qualitaetssicherung.md`

