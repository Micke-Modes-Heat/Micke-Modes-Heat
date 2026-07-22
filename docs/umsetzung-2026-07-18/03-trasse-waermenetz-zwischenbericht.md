# Zwischenbericht 3 – Haupttrasse und Wärmenetz

Stand: wichtigste Bedien- und Integritätsmängel umgesetzt.

- Rechtsklick nimmt den letzten Punkt zurück; ein eigener sichtbarer Button beginnt Strang/Abzweig.
- Undo/Redo ist während des Zeichnens über sichtbare Buttons sowie Strg/Cmd+Z und Strg/Cmd+Umschalt+Z verfügbar; die Rücknahme bleibt auf den aktuellen Strang begrenzt.
- Abzweige rasten auf Knoten und direkt auf vorhandenen Linien ein.
- Abschließen, Verschieben und Löschen der Trasse ersetzt das vorhandene Netz nicht mehr automatisch.
- Auto-Netz besitzt vor dem Ersetzen eine Sicherheitsabfrage; Bestandsnetz-Hinweis und bestätigtes Gesamtlöschen.
- Gebäude können eine vorhandene Haupttrasse nicht mehr durch Gebäude-Gebäude-Luftlinien umgehen.
- Koordinatengleiche Abzweige sind im Wärmegraphen derselbe Knoten.
- Ringkanten und von der Zentrale getrennte Verbraucher werden erkannt, gekennzeichnet und im Panel gemeldet.
- Doppelte Trassenbutton-ID beseitigt; Aktivzustand beider Einstiegspunkte synchron.
- Wärme- und Elektrokorridore sind fachlich pro Segment getrennt und werden orange beziehungsweise blau dargestellt; bewusst gemeinsame Altsegmente erscheinen violett.
- Räumlicher Rasterindex reduziert die Auto-Netz-Kandidaten bei detaillierten Trassen von B×T auf typischerweise drei Anschlüsse je Gebäude.
- Wärmeleitungen unterstützen beliebig viele geordnete Knickpunkte. Der Mittelpunktgriff fügt weitere Punkte ein; einzelne Punktgriffe lassen sich verschieben oder per Doppelklick entfernen. Alle Punkte fließen in Länge, Darstellung und Projekt-Roundtrip ein.
- Die Bestandsnetz-Sperre schützt jetzt auch Strukturänderungen: Hinzufügen, Löschen, Abklemmen, Pruning, Auto-Ersetzung und Gesamtlöschung werden bis zum bewussten Entsperren abgewiesen.

Offene Vertiefung: Performancebudgets und ein zusätzlicher räumlicher Index für extrem große Trassennetze.
