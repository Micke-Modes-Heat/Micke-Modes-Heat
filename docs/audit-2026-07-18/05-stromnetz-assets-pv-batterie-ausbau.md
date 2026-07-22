# Zwischenbericht 05 – Stromnetz, Assets, PV, Batterie und Ausbauplanung

Stand: 18.07.2026  
Prüfumfang: elektrischer Graph, Trassenrouting, Dimensionierung/Spannungsfall, MS-Ring, Assets, NAP-Analysen, PV-/Batteriebilanz, Maßnahmen, Phasen und Cluster.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

Dieser Programmteil ist funktional sehr ambitioniert und besitzt besonders für PV-Merit-Order/Fahrplan gute Kerntests. Gleichzeitig gibt es mehrere überlappende Repräsentationen desselben elektrischen Netzes (`stromNodes`, `stromEdges`, `ASSETS.items`, `ASSETS.edges`) sowie vereinfachte Netzberechnungen. Die Ergebnisse eignen sich als Screening, dürfen aber nicht als vollständige Netzberechnung missverstanden werden.

## Befunde

### S-01 – Kritisch – Mehrere konkurrierende elektrische Graphrepräsentationen

Assets werden zugleich in `ASSETS.items` und als Stromknoten registriert; Kanten liegen primär in `stromEdges`, während Teile der Anwendung `ASSETS.edges` beziehungsweise assetgefilterte Kanten verwenden. Importcode enthält bereits Sonderlogik gegen doppelte Marker und „Geisterknoten“.

Risiken: Duplikate, verwaiste Kanten, unterschiedliche Sicht auf aktive Objekte und Verlust bei Serialisierung/Variantenwechsel.

Empfehlung: ein kanonischer elektrischer Graph; Asset ist Metadatenobjekt oder Graphknoten, nicht beides mit manueller Synchronisation.

### S-02 – Hoch – Strom- und Wärmetrasse teilen Geometrie und Zustand

Elektrische Leitungen routen per Dijkstra über `trassePoints`/`trasseSegments`, die auch die Wärme-Haupttrasse darstellen. OSM-Straßenübernahme schreibt in denselben Zustand. Fachlich getrennte Korridore können nicht zuverlässig modelliert werden.

### S-03 – Hoch – Radiale Berechnung und Ringanalyse sind getrennte Welten

Das allgemeine Stromnetz berechnet Lastflüsse/Spannungsfälle überwiegend über gerichtete/radiale Pfade. MS-Ringe besitzen eine eigene Erkennung und Stichbetriebs-/N-1-Näherung. Es gibt keinen durchgängigen AC-Lastfluss oder symmetrischen Komponentenansatz.

Empfehlung: Ergebnis klar als vereinfachtes symmetrisches Screening ausweisen; Netzmodus/Trennstellenzustand als explizite Topologiekonfiguration behandeln.

### S-04 – Hoch – Phasenunsymmetrie, Blindleistung und Harmonische sind stark vereinfacht

Das Modell arbeitet überwiegend dreiphasig-symmetrisch mit pauschalem cos φ. Einphasenlasten, Phasenbelegung, Neutralleiter, Oberschwingungen, Gleichzeitigkeiten nach Verbraucherart und dynamische Blindleistungsregelung werden nicht vollständig gelöst.

Folge: NS-Spannungsfall und Auslastung können bei realen unsymmetrischen Netzen abweichen.

### S-05 – Hoch – Kurzschluss-/Schutzbewertung ist Screening, keine Schutzstudie

Kurzschlusswerte, Sicherungen und Selektivität werden angeboten, aber ohne vollständiges Netzersatzbild, Schutzkennlinienkoordination und alle IEC-60909-Faktoren kann dies keine prüffähige Schutzberechnung ersetzen.

Empfehlung: sichtbarer Disclaimer und Export der verwendeten Annahmen; Grenzfälle mit Referenzsoftware vergleichen.

### S-06 – Hoch – Automatische Dimensionierung kann lokale Optimierung als Netzlösung darstellen

Kabelquerschnitte werden anhand Stromtragfähigkeit und verteiltem Spannungsfallbudget gewählt. Das ist nachvollziehbar, aber kein globales Optimierungsproblem mit Schutz, Kosten, Parallelkabeln, Schaltzuständen und Zukunftsszenarien. Ringe und nicht erreichte Kanten erhalten Sonderbehandlung.

### S-07 – Hoch – Zeitreihen-/NAP-Modi besitzen unterschiedliche Datenqualität

NAP-Analyse kann Messdaten, synthetische BFS-Profile und statische Fallbacks mischen. Die Oberfläche zeigt Hinweise, aber nachgelagerte Maßnahmen-/Kapazitätsentscheidungen müssen die Provenienz zwingend mitführen.

### S-08 – Hoch – PV-/Batterierechnung existiert in mehreren Pfaden

PV/Batterie wird im Strompanel, PV-NAP-Simulator, Merit-Order und Optimierer berechnet. Zwar bestehen gute Bilanztests innerhalb einzelner Kerne, dennoch sind Parameter wie Wirkungsgrade, Einspeiselimit, Preise und Profile nicht offensichtlich über ein gemeinsames Szenarioobjekt gekoppelt.

Empfehlung: Golden Test mit identischer Eingabe über alle vier Pfade und zentraler Parameterquelle.

### S-09 – Hoch – PV-Erzeugungsprofil ist teils stark synthetisch

Das Standardprofil basiert auf Monatsanteilen und idealisierten Tagesformen. Ausrichtungen werden vereinfacht gemischt; lokale Verschattung, Modul-/Wechselrichterkennlinie, Temperatur, Schnee und konkrete Wetterjahre sind nicht vollständig abgebildet.

Empfehlung: Qualitätsstufe anzeigen; für belastbare Planung PVGIS-/Messprofilimport bevorzugen und Quelle dokumentieren.

### S-10 – Mittel – Batterieoptimierung bildet Alterung nur vereinfacht ab

SOC, Wirkungsgrade und Leistungsgrenzen sind berücksichtigt. Zyklus-/Kalenderalterung, temperaturabhängige Leistung, Reserve-SOC, Ersatzinvestition und Betriebsstrategien können je Rechenpfad pauschal bleiben.

### S-11 – Mittel – EEG-/Preisdefaults sind zeitabhängige eingebettete Werte

Vergütungssätze und wirtschaftliche Annahmen stehen direkt im Code/UI. Ohne Gültigkeitsdatum und Version können spätere Nutzer veraltete Rechts-/Marktwerte anwenden.

Empfehlung: versionierte Tarifszenarien mit Standdatum, manuellem Override und Hinweis „keine Rechts-/Förderberatung“.

### S-12 – Mittel – Unbekannte Kapazität wird oft als „keine Zusatzkosten“ behandelt

Beispielsweise gibt die Ertüchtigungslogik bei unbekannter NAP-Kapazität teilweise null Zusatzkosten zurück. Das verhindert falsche Strafkosten, kann aber Unwissen wie ausreichende Kapazität aussehen lassen.

Empfehlung: dreiwertige Logik `ausreichend / Engpass / unbekannt`; Unbekanntes darf nicht als Nullkostenentscheidung gerankt werden.

### S-13 – Mittel – Zufallsbasierte IDs sind kollisionsanfällig und erschweren Reproduzierbarkeit

Kanten/Maßnahmen nutzen teilweise kurze `Math.random().toString(36)`-IDs. Kollisionen sind selten, aber möglich; identische Läufe erzeugen unterschiedliche Projekt-Diffs.

Empfehlung: `crypto.randomUUID()` oder deterministische stabile IDs bei Auto-Erzeugung.

### S-14 – Mittel – Auto-Netz und manuelle Änderungen benötigen Ownership

Kanten besitzen `autoGenerated`, aber es fehlt ein durchgängiges Merge-/Diff-Modell. Erneute Auto-Erzeugung kann schwer nachvollziehbar mit manuell veränderten, gesperrten oder maßnahmenbehafteten Kanten interagieren.

### S-15 – Mittel – Ausbauplanung koppelt fachlich verschiedene Ebenen

Kandidaten, Maßnahmen, Phasen, Varianten und Cluster greifen aufeinander zu. Positiv sind Toposortierung und Zyklustests. Unklar bleibt jedoch eine zentrale Transaktion, wenn Assets gelöscht, Varianten gewechselt oder Cluster neu erzeugt werden.

### S-16 – Mittel – Browser-/Roundtrip-Tests fehlen

Gut getestet sind reine PV-Bilanzen, Ranking, Ertüchtigung, Fahrplan und Cluster-Core. Kaum getestet sind Kartenplatzierung, Auto-Netz, Kabelrouting, Stromgraph-Import, MS-Ring-Interaktion, NAP-CSV und kompletter Ausbauplaner-Workflow.

## Positive Befunde

- Dijkstra-Routing entlang vorhandener Trassen.
- Kabeltypen, Parallelstränge, Sicherungen, Trafo- und Kurzschlussparameter werden modelliert.
- separate MS-Ring-/N-1-Analyse vorhanden.
- PV-Nachfrage- und Erzeugungsbilanzen besitzen Invariantentests.
- Merit-Order berücksichtigt NAP-Einspeisegrenzen und Infrastrukturmehrkosten.
- Fahrplan erkennt Abhängigkeitszyklen und validiert Reihenfolgen.
- Cluster-Persistenz hat einen echten Roundtrip-Test und hält Arraybinding stabil.
- Maßnahmenmodell enthält Bau-/Abrissjahre und Abhängigkeiten.

## Priorität für spätere Behebung

1. kanonischen elektrischen Graphen schaffen.
2. Korridor/Trasse von Wärme- und Stromnutzung trennen.
3. Berechnungsgrenzen als Screening transparent machen.
4. PV-/Batterieparameter und Rechenpfade konsolidieren.
5. „unbekannt“ in Kapazitätsentscheidungen explizit behandeln.
6. Auto-/Manuell-Ownership und Roundtrip-Tests ergänzen.

