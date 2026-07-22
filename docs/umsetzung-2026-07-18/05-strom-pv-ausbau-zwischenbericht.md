# Zwischenbericht 5 – Stromnetz, PV und Ausbau

Stand: Datenquelle konsolidiert und Aussagegrenzen sichtbar gemacht.

- `stromEdges` ist die kanonische elektrische Kantenquelle; Ausbau-/NAP-Suchen lesen daraus statt aus dem veralteten `ASSETS.edges`-Puffer.
- Löschen eines Assets entfernt den zugehörigen Stromknoten und seine Kanten über den kanonischen Graphen.
- Feld-App-Export verwendet ebenfalls kanonische, serialisierbare Stromkanten.
- Trassensegmente tragen ihren Geltungsbereich (`waerme`/`strom`). Wärme-Auto-Netz und Elektrorouting verwenden nur ihre eigenen Segmente; gemeinsame Korridore bleiben als bewusste Altprojekt-/Tiefbauoption möglich und sind farblich getrennt.
- Sichtbarer fachlicher Hinweis: symmetrisches 3-Phasen-Screening, pauschaler cos φ, keine prüffähige Schutzstudie und keine globale Netzoptimierung.
- Unbekannte NAP-Kapazität wird als eigener Zustand `kapazitaet_unbekannt` geführt; sie kann nicht mehr als kostenlose Machbarkeit in das Merit-Order-Ranking gelangen.
- Assets, Stromkanten, Maßnahmen und Phasen verwenden UUID-basierte IDs mit monotonem Kompatibilitätsfallback statt kurzer `Math.random()`-Kennungen.
- Der echte Projekt-Browser-Roundtrip prüft zwei elektrische Assets und eine MS-Kante einschließlich Trennstelle, Null-Querschnitt, Maßnahmen und explizitem Baujahr. Explizite Kabeljahre werden nicht mehr nach dem Import durch abgeleitete Endpunktjahre überschrieben.
- PV-Einspeisevergütung und Marktprämie verwenden ein versioniertes Szenario mit Gültigkeit 01.02.–31.07.2026, Abrufstand und Bundesnetzagentur-Quelle. Die Leistungsstaffeln werden anteilig gewichtet statt der Gesamtanlage pauschal den letzten Satz zuzuweisen. Außerhalb des veröffentlichten Bereichs sowie für Ausschreibungen wird keine Scheingenauigkeit erzeugt, sondern eine manuelle Eingabe verlangt.
- Tarifszenario, Vergütungsmodell und manuelle Überschreibung bleiben im Projekt-Roundtrip erhalten; das Rechenmanifest dokumentiert die Tarifprovenienz. Der Browsertest deckt Automatik und manuelle Abweichung in Singlefile- und ESM-Auslieferung ab.
- Oberfläche, PV-/Batterieauslegung, Optimiererwrapper und Worker verwenden denselben DOM-freien Stundenkern für Direktverbrauch, Laden, Entladen und Netzflüsse. Der Worker enthält nach Architekturtest exakt denselben Funktionsquelltext; ein 8.760-h-Browser-Golden-Test vergleicht die Ergebnisse bis auf zehn Nachkommastellen in beiden Builds.
- Der PV-CSV-Import erkennt echte PVGIS-Stundendateien spaltenbezogen, rechnet `P` von W in kW um und normalisiert 8.784 Stunden kalenderkorrekt. Interne, PVGIS- und allgemeine Uploadprofile tragen getrennte Qualitätsstufen; 8.760 Werte und Metadaten werden in Projekt und Manifest verlustfrei gespeichert.
- Batteriealterung kombiniert den gemessenen jährlichen Entladedurchsatz zu Vollzyklen mit einstellbarer Kalenderdegradation, Zykluslebensdauer und EOL-Schwelle. Die erwartete Lebensdauer wirkt auf die Batterie-Annuität in PV-Auslegung, Optimierer und Worker; Parameter und Ergebnis werden im Projekt gespeichert. Temperaturderating und komplexe Reserve-/Netzdienstleistungsstrategien bleiben Modellgrenzen.
- Ausbauobjekte, Gebäude- und Assetmaßnahmen, Cluster, Phasen und Varianten besitzen nun eine gemeinsame synchrone Transaktionsgrenze. Nach jeder Änderung werden IDs, Referenzen, Phasenzeiträume und Maßnahmenabhängigkeiten einschließlich Zyklen geprüft; bei Fehlern wird der gesamte vorherige Zustand wiederhergestellt.
- Die Transaktionshistorie hält die letzten 20 erfolgreichen Planungsschritte. Ausbauplaner, Clustermassenaktionen, Variantenvorgänge, Assetlöschung und Optimiererübernahme erzeugen jeweils genau einen rückgängig machbaren Schritt. Interne Wiederherstellungsarbeiten erzeugen keine falschen Historieneinträge.
- Der Gesamtprojektimport bleibt eine eigene atomare Operation und unterdrückt bewusst Teiltransaktionen. Browserprüfungen belegen Commit, Integritätsrollback, fehlgeschlagene Assetlöschung, Variantenrollback und Undo sowohl in Singlefile als auch ESM.

Offene Vertiefung: ein einheitlicher PV-/Batterie-Szenariokern über alle vier Berechnungspfade.
