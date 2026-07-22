# Gesamtstatus der 95 Auditbefunde

Stand: 18.07.2026 nach vollständiger Regression.  
Legende: **behoben** = Ursache im vereinbarten Umfang beseitigt und geprüft; **teilweise** = Risiko deutlich reduziert, strukturelle oder fachliche Vertiefung bleibt; **offen** = noch keine ausreichende Behebung.

Diese Einstufung ist bewusst streng. Ein Disclaimer macht beispielsweise keine vereinfachte Fachrechnung zu einer vollständigen Netzstudie.

## Architektur, Build und CI (A-01 bis A-11)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| A-01 | behoben | ESM und Singlefile verwenden denselben `src/main.js`-Modulgraphen; Rollup ersetzt Regex-Umschreibung und manuelle Ladeliste. Beide Browserworkflows sind grün. |
| A-02 | teilweise | Zwei isolierte Zweierzyklen entfernt und Architekturwächter eingeführt; der verbleibende zyklische Altkern umfasst noch 33 Module. |
| A-03 | teilweise | Neue kritische Bibliotheken sind typgeprüft; die großen Altmodule noch nicht flächendeckend. |
| A-04 | teilweise | Kernzustände besitzen Setter und Live-Accessors; die große historische `window`-API bleibt. |
| A-05 | behoben | Parentfenster, konkrete HTTP(S)-Origin und Antwort-Origin werden geprüft. |
| A-06 | behoben | Browserbibliotheken kommen lokal aus dem Lockfile; PDF-Worker ist eingebettet. |
| A-07 | behoben | Singlefile enthält Bibliotheken und Marker lokal; Browserlauf funktioniert mit blockierten Kartentiles. |
| A-08 | behoben | Lokale Fremdressourcen plus `SOURCE_DATE_EPOCH`; zwei Builds ergaben byteidentische SHA-256-Prüfsummen. |
| A-09 | behoben | Die Browsermatrix umfasst 14 Fach-/UI-Abläufe und läuft vollständig gegen Singlefile und ESM; Feld-App wird zusätzlich direkt unter `file://` geprüft. |
| A-10 | behoben | Feld-App-Shell wird vorab gecacht und besitzt einen echten Offlinefallback. |
| A-11 | teilweise | `type: module` ergänzt; Workflow-SHA-Pinning und Release-Gleichstand bleiben offen. |

## Daten, Zustand, Varianten (D-01 bis D-12)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| D-01 | behoben | Validierung vor Mutation und Rollback bei Apply-Fehlern. |
| D-02 | teilweise | Live-Accessors und kontrollierte Setter für Kernzustände; Restmigration der Altmodule offen. |
| D-03 | behoben | Vollständiger Wärmegraph einschließlich Trassenknoten und Kantenmetadaten wird gespeichert. |
| D-04 | behoben | Schema v2, Prüfung, v1-Migration und Ablehnung unbekannter Zukunftsversionen. |
| D-05 | behoben | Relevante Importdefaults verwenden Nullish-Semantik; Nullwerte bleiben erhalten. |
| D-06 | behoben | Varianten führen Wärmegraph, Trasse und eigenen Stromzustand. |
| D-07 | behoben | Variantenwechsel erfolgt synchron/transaktional ohne verzögerte Nachberechnung. |
| D-08 | behoben | IndexedDB, sichtbarer Fehler und kompatibler Fallback. |
| D-09 | behoben | Drei Generationen mit Zeitstempel und Schemametadaten. |
| D-10 | behoben | Validierte Daten werden tief geklont statt uneinheitlich referenziert. |
| D-11 | teilweise | Dispatch-Eingaben und -Ergebnisse getrennt; weitere abgeleitete UI-Zustände bleiben. |
| D-12 | behoben | Browser-Roundtrip exportiert, verändert und lädt Trasse, Wärmegraph, Waypoint und Nullwerte in Singlefile und ESM verlustfrei. |

## Haupttrasse und Wärmenetz (N-01 bis N-14)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| N-01 | teilweise | Segmentnutzungen Wärme/Strom sind explizit; vollständiges eigenständiges Korridor-Domänenmodell bleibt offen. |
| N-02 | behoben | Linienprojektion und Zusammenführung koordinatengleicher Abzweigknoten. |
| N-03 | behoben | Auto-Netz bindet Gebäude an die Haupttrasse statt Luftlinienabkürzungen zuzulassen. |
| N-04 | behoben | Zeichnen/Ändern/Löschen ersetzt das Wärmenetz nicht mehr automatisch. |
| N-05 | behoben | Sichtbarer Abzweig, Abschluss, Undo/Redo, Hinweise und konsistente Bedienung. |
| N-06 | behoben | Eindeutige IDs für Wärme- und Elektro-Trassenbuttons. |
| N-07 | behoben | Persistenz speichert das tatsächliche Graphmodell. |
| N-08 | behoben | Ringe werden erkannt, markiert und gemeldet statt still verschluckt. |
| N-09 | behoben | Nicht erreichbare Verbraucher werden erkannt und sichtbar gemeldet. |
| N-10 | behoben | Beliebig viele geordnete Knickpunkte mit eigenständigen Griffen, Längenberechnung, Schema und Browser-Roundtrip. |
| N-11 | teilweise | Räumlicher Rasterindex und drei nächste Trassenanschlüsse; Extremgrößen brauchen Performancebudgets. |
| N-12 | behoben | Gesperrtes Bestandsnetz blockiert Hinzufügen, Löschen, Abklemmen, Pruning, Auto-Ersetzung und Gesamtlöschung; Browserworkflow prüft die Invariante. |
| N-13 | behoben | Versioniertes Berechnungsmanifest nennt Wärmegraph-/Hydraulikmethode und ihre fachlichen Aussagegrenzen in Projekt und Bericht. |
| N-14 | behoben | Echter Browserworkflow prüft Zeichnung, Snap, Abzweig, Undo/Redo und nichtdestruktiven Abschluss in beiden Laufzeiten. |

## Lastgänge, Dispatch und Optimierung (E-01 bis E-13)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| E-01 | teilweise | Hauptdispatch, Optimiererwrapper, Fallback und Worker verwenden nachweislich denselben `_dispatchCore`; CalcEngine-/PV-Nachrechnungen bleiben zu konsolidieren. |
| E-02 | teilweise | Unvollständige Jahre werden abgelehnt und Provenienz geführt; alle Ergebnisansichten müssen sie noch durchgängig zeigen. |
| E-03 | behoben | Bei 8784 Stunden wird exakt der 29. Februar entfernt. |
| E-04 | teilweise | Normalisierte Metadaten existieren; echte Zeitstempel-/DST-Behandlung ist noch nicht vollständig. |
| E-05 | behoben | Dispatch schreibt Ergebnisse nicht mehr in Erzeugereingaben zurück. |
| E-06 | behoben | Oberfläche bezeichnet das Resultat als heuristisch/beste gefundene Variante. |
| E-07 | behoben | Kein schwerer Main-Thread-Fallback nach Workerfehler. |
| E-08 | teilweise | SharedArrayBuffer für cross-origin-isolierte Web-Auslieferung und alle Grob-/Fein-Worker; Offline-`file://` benötigt sicherheitsbedingt Transferkopien. |
| E-09 | behoben | Lauf-IDs verwerfen verspätete Nachrichten alter/abgebrochener Läufe. |
| E-10 | teilweise | Neue Kernmodelle sind typisiert; Einheiten sind noch nicht systemweit als Typen modelliert. |
| E-11 | behoben | Projekt und Transformationsplan-Bericht führen App-/Buildstand, sechs Modellversionen, Datenprovenienz, Referenzen und Grenzen. |
| E-12 | behoben | Kälte ist stundenscharf in PV/Batterie/BHKW/Netzbezug, Leistungsspitzen, Sankey und Optimierer integriert; Browser-Golden-Test für beide Builds. |
| E-13 | behoben | Versioniertes EconomicScenario mit elf Annahmen, Stichtag, Herkunft, Override-Status sowie verlustfreiem Projekt-/Manifest-Roundtrip. |

## Strom, Assets, PV und Ausbau (S-01 bis S-16)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| S-01 | teilweise | `stromEdges` ist kanonische Kantenquelle; Assets bleiben als Metadaten plus Knoten gekoppelt. |
| S-02 | behoben | Segmente tragen getrennte Nutzungsdomänen; bewusste gemeinsame Korridore bleiben möglich. |
| S-03 | teilweise | Screeninggrenze sichtbar; kein durchgängiger AC-Lastfluss. |
| S-04 | teilweise | Symmetrie/cos-phi-Grenzen sichtbar; kein Unsymmetrie-/Oberschwingungsmodell. |
| S-05 | teilweise | Klar als Screening und nicht Schutzstudie ausgewiesen; Fachmodell nicht erweitert. |
| S-06 | teilweise | Lokale Dimensionierung wird nicht als globale Optimierung ausgegeben; globaler Solver fehlt. |
| S-07 | teilweise | Zeitreihenprovenienz eingeführt; NAP-Entscheidungen führen sie noch nicht überall. |
| S-08 | behoben | Kanonischer PV-/Batterie-Stundenkern in Oberfläche, Auslegung, Optimierer und Worker; 8.760-h-Cross-Engine-Golden-Test in beiden Builds. |
| S-09 | behoben | Formatbewusster PVGIS-Import mit W→kW, Schaltjahrnormalisierung, drei Qualitätsstufen sowie vollständigem Profil-/Metadaten-Roundtrip. |
| S-10 | teilweise | Kalender- und Vollzyklusalterung, EOL/Lebensdauer und kostenwirksame Annuität durchgängig; Temperaturderating und komplexe Betriebsstrategien bleiben Modellgrenze. |
| S-11 | behoben | Versioniertes EEG-Szenario 01.02.–31.07.2026 mit offizieller Quelle, anteiliger Leistungsstaffel, Manifest-Provenienz und erhaltener manueller Überschreibung. |
| S-12 | behoben | Unbekannte NAP-Kapazität liefert einen expliziten Status und wird nicht als 0-€-Machbarkeit gerankt. |
| S-13 | behoben | Produktive Asset-/Kanten-/Maßnahmen-/Phasen-IDs nutzen UUIDs mit monotonem Fallback. |
| S-14 | teilweise | `autoGenerated` und bestätigte Ersetzung vorhanden; vollständiges Merge/Diff-Ownership fehlt. |
| S-15 | behoben | Ausbauobjekte, Maßnahmen, Cluster, Phasen und Varianten laufen über eine validierte Transaktionsgrenze mit Rollback und Undo; produktive Browserpfade und Projektimport sind geprüft. |
| S-16 | teilweise | Browser-Roundtrip deckt Assets und MS-Kante samt Trennstelle/Lebenszyklus/Maßnahmen ab; NAP-CSV und kompletter Ausbauplaner-Workflow fehlen noch. |

## UI, Sicherheit und Feld-App (U-01 bis U-17)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| U-01 | teilweise | Trassenworkflow ist kontextuell gebündelt; Gesamtnavigation bleibt komplex. |
| U-02 | behoben | Eine zentrale Interaction State Machine garantiert genau ein aktives Kartenwerkzeug, standardisierten Abbruch/Abschluss, Escape und ein einheitliches Statusbanner. |
| U-03 | teilweise | Fokus, Tabs/ARIA und Tastatur-Trassenbedienung verbessert; Dialoge/Kartenalternativen nicht vollständig WCAG 2.2 AA. |
| U-04 | teilweise | Konkrete Import-/Galerie-/Dateinamen-Senken gesichert; systematischer Ersatz aller `innerHTML`-Pfade fehlt. |
| U-05 | behoben | Siehe A-05. |
| U-06 | behoben | Diagnosebestandteile getrennt, standardmäßig aus und verständlich beschrieben. |
| U-07 | behoben | Bestätigte Doppel-IDs entfernt und im E2E geprüft. |
| U-08 | behoben | Laptop-/Tablet-Breakpoints, automatische Start-Einklappung, Drawer-Sidebars, bildschirmfüllende Dialoge und überlauffreie Kopfzeile sind für vier Viewports in beiden Builds geprüft. |
| U-09 | behoben | Zentrale Reduced-Motion-Regel ergänzt. |
| U-10 | behoben | Zentrales Diagnosezentrum sammelt Laufzeit-/Hintergrundfehler und gezielte Fachmeldungen dauerhaft für die Sitzung mit Bereich, Zeitpunkt und Handlungsempfehlung. |
| U-11 | teilweise | Auto-Netz-Kandidaten räumlich indexiert; große DOM-/Kartenrenderings bleiben. |
| U-12 | behoben | Gemeinsame Lifecycle-Scopes verwalten DOM-/Map-Listener, Timeouts und Intervalle mit idempotentem Teardown; globale Dauertimer und dynamische Kartenhandler sind migriert. |
| U-13 | behoben | Verlässlicher App-Shell-Cache; Einzeldatei separat gebaut/geprüft. |
| U-14 | teilweise | IndexedDB und Export bleiben; Quota/Rotation/Verschlüsselung fehlen. |
| U-15 | teilweise | Offline-Einzeldatei und PWA-Weg vorhanden; Browser-Originrisiko bleibt technisch. |
| U-16 | behoben | Haupt- und Feld-App erklären lokale/sensible Daten, GPS, Exporte und Geräteverlust; bestätigtes Löschen entfernt bekannte Datenbanken, Einstellungen und App-Caches. |
| U-17 | behoben | Zentrales UI-Glossar und vereinheitlichte Nutzerbegriffe für Anlagen/Komponenten, Wärme-Haupttrasse, Elektro-Korridor, automatische Netzerzeugung, Ausschlussmodus und Einsatzplanung. |

## Tests und Qualität (T-01 bis T-12)

| ID | Status | Ergebnis / Restarbeit |
|---|---|---|
| T-01 | behoben | Dieselben Playwright-Szenarien laufen gegen echten ESM-Modus und gebautes Singlefile. |
| T-02 | behoben | V8-Coverage mit HTML/JSON und nicht unterschreitbarer Baseline. |
| T-03 | behoben | 14 E2E-Abläufe decken Smoke, Feld-App, Trasse, Projekt, Strombilanz, Planungstransaktionen, Kartenmodi, Datenschutz, Responsive und MS-Ring ab. |
| T-04 | teilweise | Echte DOM-/Kartenintegration für Smoke und Trasse; übrige Panels fehlen. |
| T-05 | behoben | Schema-, Migration-, Klon- und Autosave-Tests vorhanden. |
| T-06 | behoben | Wärmegraph, Trasse, elektrischer Projektroundtrip sowie echter MS-Ring mit Trennstelle, Stichbetrieb und drei (n-1)-Fällen laufen in beiden Builds. |
| T-07 | behoben | 8.760h-Golden-Fixture vergleicht Hauptdispatch/Optimierer samt Stundenarrays; Workerquelle enthält exakt denselben Kern. |
| T-08 | behoben | Reproduzierbare Fuzz-Suite variiert 400 Projekte, 300 ungültige Koordinatensätze und 300 zufällige Wärmegraphen samt Ringinjektion. |
| T-09 | teilweise | ARIA-/Fokusgrundlage im Browser geprüft; axe und visuelle Regression fehlen. |
| T-10 | teilweise | Harte Laufzeitbudgets für 2.000 Projektobjekte und 5.000 Wärmeknoten; DOM-/Karten-/Worker-Speicherbudgets fehlen noch. |
| T-11 | behoben | Lokale Playwright-Konfiguration und Browserlauf funktionieren reproduzierbar. |
| T-12 | teilweise | Beide Laufzeitmodelle in der lokalen Gesamtprüfung; CI-Browser-/OS-Matrix bleibt schmal. |

## Zusammenfassung

- **Behoben:** 63
- **Teilweise behoben/entschärft:** 32
- **Offen:** 0
- **Gesamt:** 95

Die nächste technische Reihenfolge ergibt sich daraus: kanonischer Singlefile-Bundler und Importentflechtung; gemeinsamer Rechenkern plus Golden Tests; PV-/Batterie-/Wirtschaftsszenario; zentrale Werkzeug-State-Machine; vollständige WCAG-/Diagnose-/Performanceprüfung.
