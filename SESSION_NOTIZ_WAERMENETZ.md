# Session-Notiz Wärmenetz

Stand: 23.07.2026

## Arbeitsstand

Die Wärmenetz-Bedienung und Netzgenerierung wurden umfangreich lokal überarbeitet. Die Änderungen sind noch nicht auf GitHub gepusht.

Repository:

- Lokal: `/home/konstantin/Micke-Heat-2026-07-18-ueberarbeitung`
- GitHub: `HansCodemann/Micke-Heat-2026-07-18`
- Zielbranch: `main`

## Bedienkonzept

- Im Netz-Tab gibt es direkte Einstiege „Wärmenetz erstellen“ und „Wärmenetz bearbeiten“.
- Der Arbeitsbereich erscheint in der linken Sidebar; störende Kartenfenster werden geschlossen.
- Reihenfolge in beiden Arbeitsbereichen:
  1. Heizzentrale
  2. Erstellungs- beziehungsweise Bearbeitungswerkzeuge
  3. eingeklappte weitere Netzeinstellungen
- „Gebäudeanschluss umhängen“ ist die wichtigste Bearbeitungsfunktion.
- Netzdetails erscheinen nur nach Klick auf einen Netzstrang, nicht beim Hover.
- Entfernt beziehungsweise aus der sichtbaren Bedienung genommen:
  - Strangfilter „Strang anzeigen“
  - Abschnitte ausschließen
  - Netzsanierung aus der Netzkonfiguration; befindet sich jetzt in „Wirtschaftlichkeit“
- „Neue Leitung zeichnen“ soll als Nächstes aus dem normalen Bearbeitungsmenü entfernt werden; die interne Funktion kann für Kompatibilität bestehen bleiben.

## Netzgenerierung

- Drei Varianten:
  - straßenorientiert
  - Auto-Netz direkt
  - gezeichnete Haupttrasse
- Gemeinsamer Regler für lokal gebündelte oder direkte Gebäudeanschlüsse.
- Straßen werden parallel, mit Timeout und Cache geladen.
- Straßen-Vorschau wird nach der Berechnung entfernt.
- Bewegte Striche für den Wärmefluss bleiben erhalten.

## Bestandsnetz und zeitliche Gebäudeentwicklung

- Ein neu gezeichnetes Gebäude wird automatisch an die nächstgelegene Bestandsleitung angeschlossen.
- Die Bestandsnetz-Sperre erlaubt ausschließlich diesen neuen Hausanschluss.
- Bestehende DN, Kostenklasse und Leitungsgeometrie bleiben erhalten.
- Die Bestandsleitung wird am Abzweig nur topologisch geteilt.
- Ein Anschluss ist vor dem Baujahr des Gebäudes unsichtbar und nicht anklickbar.
- Ab dem Baujahr erscheint er und geht in die hydraulische Berechnung ein.
- Ab dem Abrissjahr verschwindet er wieder.
- Zeitliche Sichtbarkeitswerte werden im vollständigen Wärmenetzgraph gespeichert.

## Hydraulik – aktuelle Entscheidung

Die Druckanzeige soll bewusst einfach bleiben.

Geplante beziehungsweise gerade implementierte Regeln:

- Netz-/Verteilleitung: maximal 150 Pa/m
- Hausanschlussleitung: maximal 250 Pa/m
- Hausanschluss = letzter Stich, der genau ein Gebäude versorgt
- normale Ziel-Fließgeschwindigkeit: 1,0 m/s
- einstellbarer Bereich: 0,3 bis 2,0 m/s
- Hausstationsreserve: 0,5 bar statt bisher 0,3 bar
- Neubaunetz:
  - DN automatisch so wählen, dass Geschwindigkeits- und Druckverlustgrenze in allen relevanten Projektjahren eingehalten werden
- Bestandsnetz:
  - DN niemals automatisch ändern
  - Überschreitungen nur markieren und auswerten
- 500 Pa/m ist kein normaler Hausanschluss-Grenzwert; höchstens eine manuelle Sonderauslegung.
- Der berechnete Druckverlust darf nicht am Grenzwert abgeschnitten werden.

## Gerade bearbeiteter, noch zu prüfender Code

Die Hydraulikänderungen wurden unmittelbar vor dieser Notiz in folgenden Dateien begonnen:

- `index.html`
- `src/03b-netz.js`
- `src/04a-ui-panels.js`

Neu eingebaut:

- Eingaben für 150 Pa/m Netz und 250 Pa/m Anschluss
- Fließgeschwindigkeitsbereich 0,3–2,0 m/s
- DN-Auswahl anhand Geschwindigkeit und Druckverlust
- Hydraulikstatus in der Netz-Zusammenfassung
- dynamische Bewertung im Strang-Popup
- Hausstationsreserve 50 kPa

Weitere Lebenszyklusregeln:

- Bestandsnetz-Grundstruktur basiert auf dem Gebäudebestand im Basisjahr 2026.
- Bereits bekannte spätere Neubauten erhalten nur zeitlich geschaltete Hausanschlüsse.
- Neubaunetze werden gegen das Lastmaximum aus Bau-, Abriss- und Sanierungsjahren ausgelegt.
- Jahreswechsel dürfen DN eines Neubaunetzes nicht verkleinern.
- Bestands-DN und Bestands-Leitungsverläufe sind auch über Popup und Bearbeitungsmodus gesperrt.
- Beim bewussten Löschen eines Bestandsnetzes wechselt der Zustand auf Neubaunetz.
- Leere gespeicherte Wärmegraphen blockieren die Neuerzeugung nicht mehr.
- Manuell gesetzte DN im Neubaunetz sperren nicht mehr versehentlich das gesamte Netz.

Prüfstand nach der Änderung:

- ESLint erfolgreich
- 42 Testdateien / 415 Tests erfolgreich
- Produktions-Build erfolgreich
- 10 relevante Playwright-Tests erfolgreich, einschließlich 150/250-Pa/m-Auslegung,
  zeitlicher Maximaldimensionierung, Bestands-Sperre, Leergraph-Import und Neustart.

## Bisheriger Teststand vor der Hydraulikänderung

- ESLint erfolgreich
- 42 Testdateien / 415 Tests erfolgreich
- Produktions-Build erfolgreich
- relevante Playwright-Abläufe erfolgreich:
  - Sidebar-Erstellen/Bearbeiten
  - Anschluss umhängen
  - Neubau an gesperrtes Bestandsnetz anschließen
  - zeitliche Sichtbarkeit des Anschlusses

## Nächste sinnvolle Schritte

1. Hydraulikänderungen linten, bauen und testen.
2. Tests für 150/250-Pa/m-DN-Auswahl ergänzen.
3. Prüfen, dass Bestands-DN bei Überschreitung unverändert bleiben.
4. „Neue Leitung zeichnen“ aus dem sichtbaren Bearbeitungsmenü entfernen.
5. Gesamten Wärmenetz-Workflow im Nutzerprojekt prüfen.
6. Erst nach Freigabe committen und auf `main` pushen.
