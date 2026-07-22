# Zwischenbericht 04 – Lastgänge, Erzeuger, Dispatch, Kälte, Wirtschaftlichkeit und Optimierer

Stand: 18.07.2026  
Prüfumfang: Datenimport, Jahreslastgang, Temperaturprofile, Erzeugermodelle, Merit Order, Speicher, Kälte, Kostenrechnung, Optimierer und Worker-Ausführung.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

Die Rechenkerne gehören zu den besser getesteten Teilen der Anwendung. Energie- und Kostenlogik besitzt zahlreiche Plausibilitätstests. Die größte Gefahr liegt weniger in einzelnen Formeln als in mehreren parallelen Berechnungswegen, stillen Fallbacks und der fehlenden eindeutigen Datenherkunft. Insbesondere Optimierer, Hauptdispatch und CalcEngine sind nicht garantiert identisch.

## Befunde

### E-01 – Kritisch – Mehrere parallele Rechenimplementierungen

Es existieren mindestens:

- `_dispatchCore()` für den Hauptdispatch,
- CalcEngine-interne Erzeuger-/Merit-Order-Logik,
- Optimierer-Fallback auf dem Main Thread,
- dynamisch erzeugter Worker-Code,
- separate Nachrechnung wirtschaftlicher Kennwerte.

Der Optimierer bindet Funktionen per `toString()` in Worker-Code ein. Dadurch dürfen diese Funktionen keine nicht eingebetteten Closures verwenden. Abweichungen werden teilweise erst nachträglich per Konsolenwarnung (`WGK-DIFF`) sichtbar.

Empfehlung: Einen reinen, DOM-freien Rechenkern als reguläres Worker-Modul und gemeinsame Kostenfunktion verwenden. Identische Fixture muss in Hauptdispatch, Worker und Fallback bit-/toleranzgleich sein.

### E-02 – Hoch – Lastgang-Fallbacks können fachlich stark falsche Ergebnisse erzeugen

- Kürzere Uploads werden bis 8760 Stunden mit dem letzten Messwert aufgefüllt.
- Ohne Lastgang wird ein synthetisches Profil erzeugt.
- Fehlende Klimadaten fallen auf TRY Kassel zurück.
- Fehlende Stromprofile können gleichmäßig verteilt werden.
- Fehlende Verbrauchsdaten werden teils aus Gebäude-, Flächen- oder Pauschalwerten abgeleitet.

Diese Fallbacks halten die App bedienbar, sind aber in Ergebnisansichten und Exporten nicht durchgehend als Datenqualitätsstufe sichtbar.

Empfehlung: Provenienz je Zeitreihe (`measured`, `scaled`, `synthetic`, `fallback`) und sichtbarer Qualitäts-/Warnstatus in allen Ergebnisberichten.

### E-03 – Hoch – Schaltjahr-Normalisierung verändert die Zeitachse

8784 Werte werden durch gleichmäßiges Ausdünnen auf 8760 gebracht. Das entfernt nicht gezielt den 29. Februar, sondern verteilt ausgelassene Stunden über das Jahr. Kalenderzuordnung, Monatswerte, Wetterkopplung und PV-/Stromprofile können dadurch gegeneinander verschoben werden.

Empfehlung: Zeitstempel parsen; bei echtem Schaltjahr exakt den 29. Februar entfernen oder das gesamte Modell kalenderbewusst ausführen.

### E-04 – Hoch – Zeitreihen besitzen meist keine Zeitstempel/Zeitzonenmetadaten

Arrays mit 8760 Werten werden positionsbasiert kombiniert. Sommerzeit, Zeitzone, Messintervall, Startzeit, fehlende/doppelte Stunden und Schaltjahr sind nach dem Import nicht mehr rekonstruierbar.

Empfehlung: normalisiertes Zeitreihenobjekt mit Zeitzone, Intervall, Kalenderjahr, Einheit, Quelle und Transformationshistorie.

### E-05 – Hoch – Hauptberechnung verändert Eingabefelder

Der Dispatch schreibt berechnete Wärmemengen und stundenscharfe JAZ zurück in Erzeugerfelder. Bei Geothermie kann die echte JAZ wiederum eine Neudimensionierung auslösen. Damit verschwimmen Eingabe, Ergebnis und nächster Berechnungsinput.

Risiken: iterative Drift, schwer reproduzierbare Ergebnisse und unerwartete Änderungen beim bloßen Neuberechnen.

Empfehlung: Eingabeparameter unverändert halten; berechnete effektive JAZ/Leistung ausschließlich als Ergebniszustand speichern. Bewusste Übernahme als separate Aktion.

### E-06 – Hoch – Optimierung ist heuristische Raster-/Top-N-Suche, kein globaler Optimalitätsnachweis

Die Grobsuche wird aufgeteilt, dedupliziert und nur die besten fünf Konfigurationen gehen in die Feinsuche. Ein globales Optimum ist dadurch nicht garantiert; nicht-konvexe Kosten-/Speicher-/PV-Wechselwirkungen können Kandidaten früh aussortieren.

Empfehlung: UI und Bericht als „beste gefundene Variante“ kennzeichnen, Suchraum/Schrittweiten ausgeben und Konvergenz-/Sensitivitätstest anbieten.

### E-07 – Hoch – Worker-Fallback kann die Oberfläche lange blockieren

Bei Worker-Fehlern startet `_doRunOptimierung()` im Main Thread. Gerade Standard-/Hoch-Modus kann dadurch die UI erheblich blockieren. Ein Workerfehler wird funktional kaschiert, während Performance und Abbruchverhalten stark abweichen.

Empfehlung: kein vollständiger schwerer Main-Thread-Fallback; stattdessen klare Fehlermeldung oder kooperativ gechunkte Berechnung.

### E-08 – Mittel – Worker-Speicherbedarf skaliert mit Kernzahl

Für jeden von bis zu acht Workern werden Lastgang, Temperatur, Vorlauf, PV, Solarthermie und Quartierstrom kopiert und transferiert. Das ist für 8760 Werte beherrschbar, erzeugt aber unnötige Allokationen und GC-Spitzen.

Empfehlung: SharedArrayBuffer bei geeigneter Isolation oder kleinere unveränderliche Payloads; Speicher/Zeiten instrumentieren.

### E-09 – Mittel – Abbruch- und Race-Zustände sind global

Optimiererstatus liegt auf `window`; Worker callbacks, Fallback-Timer und neue Läufe teilen diesen Zustand. Schnelles Abbrechen/Neustarten besitzt keine eindeutige Run-ID, mit der verspätete Nachrichten verworfen werden.

Empfehlung: pro Lauf immutable Run-ID/AbortController; jede Nachricht gegen aktiven Lauf prüfen.

### E-10 – Mittel – Einheiten und Werteformen sind nicht systematisch typisiert

DOM-Felder liefern Strings; interne Namen wechseln zwischen kW, kWh und MWh. Viele Umrechnungen sind korrekt kommentiert, aber nicht typgesichert. Falsy-Defaults können Nullwerte ersetzen.

Empfehlung: Einheitenkonvention dokumentieren, Value Objects/JSDoc-Typen und zentrale Konverter verwenden.

### E-11 – Mittel – Fachquellen und Modellversionen fehlen im Ergebnis

Kommentare nennen teilweise VDI, Carnot-/Gütegradmodelle oder Herstellerbandbreiten. Ein exportierter Bericht enthält jedoch nicht zwingend Formel-/Parameter-Version und Quellenstand, mit denen das Ergebnis erzeugt wurde.

Empfehlung: Calculation Manifest mit App-Version, Modellversionen, Annahmen und Datenquellen in Projekt und Bericht.

### E-12 – Mittel – Kältemodell ist fachlich getrennt, aber systemisch nur begrenzt gekoppelt

Kälte besitzt einen eigenen 8760-Dispatch und EER-Ansatz. Wechselwirkungen mit Stromnetz, PV/Batterie, Lastspitzen und wirtschaftlicher Gesamtoptimierung sind nicht überall als ein gemeinsamer Energiefluss abgesichert.

Empfehlung: gemeinsame elektrische Bilanzfixture mit Wärme, Kälte, PV, Batterie, BHKW und Netzbezug.

### E-13 – Mittel – Wirtschaftliche Defaults können stille Ergebnisquellen sein

Wenn CalcEngine-/Detailwerte fehlen, existieren pauschale Investitionsfallbacks. Zinssätze, Preise und Nutzungsdauern werden an mehreren Stellen aus DOM oder Defaults gelesen. Abweichungen zwischen Panel und Optimierer sind möglich.

Empfehlung: ein versioniertes EconomicScenario-Objekt als einzige Quelle; Ergebnis zeigt verwendete Defaults und Overrides.

## Positive Befunde

- 8760-stündiger Dispatch mit temperaturabhängigem WP-COP.
- Merit Order, thermischer Speicher, Solarthermie, BHKW-Strom und Auto-Spitzenlast sind berücksichtigt.
- Zahlreiche Tests für Energiebilanzen, Speicher, BHKW/Stromkessel, Kosten, Optimierer und Kälte.
- Optimierer nutzt mehrere Kerne und besitzt Fortschritts-/Abbruchanzeige.
- Main-Thread-Nachrechnung prüft die Worker-WGK auf Abweichungen.
- Nullzins wird in neueren Wirtschaftsfunktionen ausdrücklich korrekt behandelt.
- Speicher besitzt getrennte Lade- und Entladeleistung.

## Fehlende zentrale Tests

- identische Ergebnisse zwischen Hauptdispatch, Worker und Fallback,
- kalenderkorrekter 8784-Import,
- Zeitreihen mit Lücken/Duplikaten/Zeitzonen,
- vollständige Strombilanz inklusive Kälte,
- wiederholte Berechnung ohne Veränderung der Eingaben,
- Optimierer-Abbruch/Neustart und verspätete Worker-Nachrichten,
- Kennzeichnung und Export aller Fallback-Provenienzen.

## Priorität für spätere Behebung

1. Rechenpfade konsolidieren und Cross-Engine-Golden-Tests.
2. Zeitreihenmodell mit Zeitstempeln/Provenienz.
3. Eingabe und Ergebnis strikt trennen.
4. Optimierer als heuristisch kennzeichnen und Run-Isolation ergänzen.
5. gemeinsames Wirtschafts-/Annahmenobjekt.
6. Kälte vollständig in elektrische Gesamtbilanz integrieren.

