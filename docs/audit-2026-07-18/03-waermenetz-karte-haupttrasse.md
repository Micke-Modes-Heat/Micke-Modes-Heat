# Zwischenbericht 03 – Wärmenetz, Karte und Haupttrasse

Stand: 18.07.2026  
Prüfumfang: Karteninteraktion, Trassenmodell, Auto-Netz, Wärmenetzgraph, Dimensionierung, Verluste, Hydraulik, Bestandsnetz und Persistenz.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

Die nachgelagerte Netzberechnung enthält viele sinnvolle fachliche Details. Der Netzaufbau davor ist jedoch kein konsistenter Graph-Editor. Eine flache Punktliste wird zugleich als Wärme-Haupttrasse, Elektrotrasse und Routingvorlage benutzt. Der MST erzeugt geometrisch kurze, aber nicht zwingend baulich sinnvolle Netze. Bedienaktion, Topologieänderung und vollständige Neuberechnung sind zu eng gekoppelt.

## Befunde

### N-01 – Kritisch – Kein eindeutiges fachliches Trassenmodell

`trassePoints`/`trasseSegments` dienen Wärme- und Stromnetz gleichzeitig. Es ist nicht definiert, ob ein Eintrag Tiefbaukorridor, Wärmeleitung, Kabeltrasse oder Routinghilfe ist. Änderungen einer Domäne beeinflussen die andere.

### N-02 – Kritisch – Optische Abzweige sind im Wärmegraphen nicht zwingend verbunden

Beim Abzweigen wird ein vorhandener Punkt als neuer Punkt mit identischen Koordinaten kopiert. Für den Wärme-MST sind das verschiedene IDs; Trasse-zu-Trasse-Kandidaten werden zugleich ausgeschlossen. Das Stromrouting vereinigt Koordinaten später, der Wärmegraph nicht konsistent.

### N-03 – Hoch – Haupttrasse wird vom Auto-Netz nur schwach erzwungen

Der Kruskal/MST-Kandidatensatz enthält weiterhin direkte Gebäude-Gebäude- und Gebäude-Trassen-Luftlinien. Die Trassensegmente werden als Pflichtkanten aufgenommen, aber Anschlüsse müssen nicht entlang eines baulich plausiblen Straßengraphen verlaufen. Die Haupttrasse kann umgangen oder über Gebäude-Komponenten unnatürlich verbunden werden.

### N-04 – Hoch – Zeichnen ersetzt beim Beenden unmittelbar das Netz

Beenden per Doppelklick, Escape oder Finish-Button ruft automatisch `autoGenerateNetz()` auf; dieses beginnt mit `clearNetz()`. Es fehlen Vorschau, Diff, Bestätigung und Schutz manueller Leitungen.

### N-05 – Hoch – Versteckte und widersprüchliche Bediensemantik

- Rechtsklick löst im Trassenmodus einen Strang ab, bei Flächenzeichnung macht er Undo, außerhalb löscht er Trassensegmente/Leitungen.
- Doppelklick beendet die gesamte Trassenbearbeitung.
- Snapping erfolgt nur nahe vorhandenen Punkten, nicht auf einer Linie.
- Segmentlöschung erfolgt per Rechtsklick ohne Bestätigung.
- Nach Generierung wird die Trasse optisch auf Opazität null gesetzt.
- „Trasse zeichnen“ existiert im Elektrobereich, „Haupttrasse zeichnen“ im Wärmenetzpanel – beide bedienen denselben Zustand.

### N-06 – Hoch – Doppelte DOM-ID für Trassenbutton

`btn-draw-trasse` existiert zweimal in `index.html`. `getElementById()` aktualisiert nur das erste Element; der sichtbare geklickte Button kann ohne Aktivzustand bleiben.

### N-07 – Hoch – Wärmenetzgraph und Persistenz passen nicht zusammen

Junction-/Trassenknoten und deren Kanten sind Laufzeitobjekte, werden aber nicht vollständig exportiert. Ein geladenes Projekt kann daher nicht denselben Graphen wiederherstellen.

### N-08 – Hoch – Zyklen/Ringe werden rechnerisch still auf einen BFS-Baum reduziert

`recalcNetz()` bestimmt Lasten, Temperaturen, Druckpfade und Stränge über genau eine BFS-Elternkante pro Knoten. Zusätzliche Ringkanten werden nicht als hydraulisch verteiltes Netz gelöst. Das UI lässt jedoch manuelle Kanten und damit Zyklen zu, ohne klar zu melden, dass die Rechnung nur einen Spannbaum verwendet.

Empfehlung: Entweder Wärmenetz explizit als Baum validieren oder einen echten hydraulischen Ringlöser implementieren. Nicht verwendete Kanten sichtbar kennzeichnen.

### N-09 – Hoch – Nicht erreichbare Verbraucher werden nicht ausreichend als Modellfehler behandelt

Die BFS startet an der Zentrale. Knoten außerhalb ihrer Komponente bleiben ohne Elternpfad; die Anwendung berechnet den erreichbaren Teil weiter. Ein eindeutiger Blocker „Netz nicht zusammenhängend“ fehlt im zentralen Workflow.

### N-10 – Mittel – Geometrie unterstützt nur einen Waypoint je Wärmeleitung

Manuell gezeichnete Gebäude-Gebäude-Kanten können genau einen Mittelpunkt/Waypoint besitzen. Realistische Straßenführung erfordert beliebig viele Stützpunkte oder Routing entlang des Trassengraphen.

### N-11 – Mittel – Automatische Netzbildung skaliert quadratisch

Für alle Gebäude-/Trassenpunktpaare werden Kandidaten erzeugt und sortiert. Bei großen OSM-Importen beziehungsweise detaillierten Trassen wächst Speicher- und Laufzeitbedarf quadratisch.

Empfehlung: räumlicher Index, k-nächste Kandidaten, Delaunay-/Straßengraph oder Multi-Source-Routing.

### N-12 – Mittel – Bestandsnetz sperrt DN, aber nicht alle Strukturänderungen

`networkLocked` verhindert primär Neudimensionierung vorhandener DN und ermöglicht automatische Lotpunktanschlüsse. Andere Aktionen können weiterhin Topologie löschen oder neu generieren. „Bestandsnetz“ suggeriert stärkeren Schutz als technisch vorhanden.

### N-13 – Mittel – Fachliche Näherungen sind nicht als Gültigkeitsbereich ausgewiesen

Hydraulik und Verlustrechnung nutzen unter anderem:

- DN näherungsweise als Innendurchmesser,
- konstante Wasserwerte bei etwa 70 °C,
- pauschale 30 kPa je Hausstation,
- gestaffelte Pumpenwirkungsgrade,
- vereinfachte Gleichzeitigkeitsfaktoren,
- Jahresverlust aus mittlerer Leistung × 8760 h.

Diese Näherungen können für Screening sinnvoll sein, sollten aber im Bericht mit Quelle, Gültigkeitsbereich und Sensitivität ausgewiesen werden.

### N-14 – Mittel – Netztests prüfen Rechenhilfen, nicht den Workflow

Vorhandene Tests prüfen unter anderem DN-/U-Wert-/WLD-Eigenschaften. Nicht getestet sind Trassenzeichnung, Abzweige, MST-Topologie, Zusammenhang, Ringverhalten, Import-Roundtrip, Bestandsnetzschutz und UI-Kommandos.

## Positive Befunde

- DN-abhängige U-Werte und Fließgeschwindigkeiten.
- Gleichzeitigkeitsfaktor wird pro Subtree berücksichtigt.
- Darcy-Weisbach/Swamee-Jain-Näherung, Reynolds-Zahl und kritischer Druckpfad werden berechnet.
- Vor-/Rücklaufverluste werden bei der Vorlaufabkühlung nicht doppelt angesetzt.
- Netzverluste, Pumpenleistung, WLD, Subtree-Wirtschaftlichkeit und Kosten werden transparent visualisiert.
- Hit-Layer verbessern die Anklickbarkeit dünner Leitungen.
- Bestandsnetz und Pruning sind fachlich wertvolle Arbeitsmodi.

## Empfohlenes Zielmodell

Ein echter Graph:

- `CorridorNode` mit stabiler ID und Koordinate
- `CorridorEdge` mit beliebiger Polyline
- Nutzungen je Kante: Wärme, NS, MS, Reserve
- Gebäudeanschluss als eigener Service-Edge
- explizite Junctions beim Klick/Snap auf Linien
- getrennte Zustände `draft`, `preview`, `accepted`, `locked`

## Empfohlener Bedienfluss

1. Bearbeitungsmodus öffnen.
2. Strang zeichnen; Klick auf Linie erzeugt automatisch einen Abzweig.
3. Backspace/Rechtsklick = letzter Punkt zurück; Enter/Doppelklick = nur aktuellen Strang abschließen; Escape = aktuelle Aktion abbrechen.
4. Vorschau mit Modi „streng entlang Trasse“, „Trasse bevorzugen“, „frei“.
5. Unterschiede und nicht angeschlossene Gebäude anzeigen.
6. Erst „Übernehmen“ verändert das Netz.
7. Manuell gesperrte Leitungen bleiben bei neuen Vorschlägen erhalten.

## Priorität für spätere Behebung

1. State-Divergenz und gemeinsames Wärme-/Elektro-Trassenmodell klären.
2. echten Knoten-/Kantengraphen einführen.
3. Zeichnen, Vorschau und Übernahme entkoppeln.
4. Zusammenhang/Baumannahme validieren.
5. Persistenz und Tests an das Graphmodell anpassen.
6. danach UX-Werkzeuge und Algorithmus verbessern.

