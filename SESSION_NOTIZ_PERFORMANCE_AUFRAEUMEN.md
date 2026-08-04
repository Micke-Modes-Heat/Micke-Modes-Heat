# Session-Notiz Performance und technische Bereinigung

Stand: 04.08.2026

## Erinnerung

Das Programm soll nach den aktuellen Funktionsarbeiten schrittweise auf
Performance, Doppelstrukturen und überholte Bedienpfade geprüft und bereinigt
werden. Keine große Komplettüberarbeitung auf einmal: Fachlogik und alte
Projektdateien müssen nach jedem kleinen Paket weiter funktionieren.

## Festgestellter Ausgangspunkt

- Rund 64.000 Zeilen JavaScript unter `src/`.
- Besonders große Module:
  - `03b-netz.js`: ca. 5.150 Zeilen
  - `09d-pv-analyse.js`: ca. 4.120 Zeilen
  - `03c-gebaeude-io.js`: ca. 3.690 Zeilen
  - `05b-stromnetz.js`: ca. 3.210 Zeilen
- Der Importgraph enthält einen großen Kreis aus 33 Modulen.
- Sehr viele globale `window.*`-Brücken, besonders in Kartenwerkzeugen,
  Wärmenetz und Gebäude-/Projektverwaltung.
- `updateViz()`, `renderList()`, `updateTotals()` und `recalcNetz()` werden an
  vielen Stellen direkt nacheinander aufgerufen und können sich gegenseitig
  weitere Aktualisierungen auslösen.
- Klassisches Live-Fließbild und beide Hub-Sankeys besitzen teilweise eigene
  Energiezuordnungslogik. Das hat bereits zu doppelten oder widersprüchlichen
  Live-Anzeigen geführt.
- 430 Unit-Tests und 57 Browser-Tests sind vorhanden. Die reine Unit-Coverage
  beträgt nur ca. 4,5 %, weil große DOM-/Kartenmodule hauptsächlich über
  Browsertests geprüft werden. Vor strukturellen Änderungen dort zuerst
  gezielte Regressionstests ergänzen.

## Bereits umgesetzte erste Performancekorrekturen

- Live-Sankey stoppt beim Verlassen des Live-Modus.
- Wärmenetzanimation stoppt beim Ausblenden des Netzes.
- Sankey- und Wärmenetzanimation laufen maximal mit 30 Bildern pro Sekunde.
- Schnelle Bewegungen des Live-Zeitschiebers werden pro Bildschirmframe
  gebündelt.

## Empfohlene Reihenfolge

1. Zentralen Aktualisierungsmanager einführen:
   - Anforderungen an Karte, Liste, Summen und Netze sammeln.
   - Jede notwendige Aktualisierung pro Frame höchstens einmal ausführen.
2. Änderungen nach Wirkung klassifizieren:
   - nur Oberfläche
   - Gebäudeenergie
   - Wärmenetz
   - Stromnetz
   - vollständige Neuberechnung
3. Gebäudeliste inkrementell aktualisieren und bei großen Projekten
   virtualisieren, statt sie vollständig neu aufzubauen.
4. Kartenebenen reduzieren:
   - Bearbeitungselemente nur im Bearbeitungsmodus erzeugen.
   - Unsichtbare Ebenen aus der Verarbeitung nehmen.
   - langfristig gemeinsamen Canvas-Renderer für große Leitungsnetze prüfen.
5. Live-Fließbilder auf eine gemeinsame Bilanzierungsfunktion umstellen.
6. Eindeutig ungenutzte Altpfade nach Referenzprüfung entfernen:
   - `build:old` / `build.sh`
   - ausdrücklich als ungenutzt markierte PV-Legacy-Exporte
   - nicht mehr erreichbare Schaltflächen und zugehörige Hilfetexte
7. Große Dateien erst danach entlang fachlicher Zuständigkeiten aufteilen und
   den 33-Module-Importkreis schrittweise verkleinern.

## Fachlich riskante Bereiche

Nicht beiläufig bereinigen, sondern nur mit eigenen Referenz- und
Regressionstests:

- Wärmenetzaufbau, Straßenrouting und manuelle Bearbeitung
- Bestands- und Neubaunetzlogik
- Gebäudeenergie und jahresscharfe Entwicklung
- SigLinDe und Lastgangsynthese
- Dispatch und Erzeugerauslegung
- Wirtschaftlichkeitsberechnung
- Import/Migration alter Projekt-JSONs
- Stromnetz- und NAP-Berechnungen

## Empfohlener Wiedereinstieg

1. Diese Notiz und `SESSION_NOTIZ_LASTGANG.md` lesen.
2. Mit einem großen realen Projekt eine kurze Performance-Aufzeichnung für
   Karte, Gebäudeliste, Netz und Live-Modus erstellen.
3. Zuerst den Aktualisierungsmanager als kleines, separat rücknehmbares Paket
   umsetzen.
4. Vorher/nachher messen und alle Unit- sowie relevante Browsertests ausführen.
5. Danach erst über die Entfernung konkreter Altpfade entscheiden.
