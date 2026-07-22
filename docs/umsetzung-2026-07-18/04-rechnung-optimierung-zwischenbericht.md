# Zwischenbericht 4 – Lastgang, Dispatch und Optimierung

Stand: kritische Zeitachsen- und Rückkopplungsfehler umgesetzt.

- 8784 Stunden werden kalenderkorrekt durch Entfernen des 29. Februar normalisiert.
- Unvollständige Messjahre werden abgelehnt statt mit dem letzten Wert aufgefüllt.
- Zeitreihen führen Intervall, Einheit, Zeitzone, Quelle, Qualität und Transformationshistorie.
- Dispatch-Ergebnisse verändern keine Erzeuger-Eingabefelder oder Geothermiedimensionierung mehr.
- Optimierung ist sichtbar als heuristische Raster-/Top-Kandidaten-Suche gekennzeichnet.
- Kein schwerer Main-Thread-Fallback bei Workerfehlern.
- Lauf-ID verwirft verspätete Antworten abgebrochener oder älterer Optimierungsläufe.
- Projektdatei und Transformationsplan-Bericht enthalten ein versioniertes Berechnungsmanifest mit App-/Buildstand, Modellversionen, Lastgangprovenienz, Quellenhinweisen und fachlichen Aussagegrenzen.
- Cross-Engine-Golden-Fixture über 8.760 Stunden: Hauptdispatch und Optimiererwrapper stimmen für WP, BHKW, Strom-/Gaskessel und Speicher auf Energie- und Stundenreihenebene überein; der Worker bettet exakt denselben `_dispatchCore` ein.
- Kältestrom ist in die gemeinsame 8.760-Stunden-Stromnachfrage integriert. Er wirkt auf PV-/BHKW-Eigenverbrauch, Batterie, Netzbezug, Leistungsspitzen und Optimierer und erscheint im Sankey als eigene Senke. Ein Browser-Golden-Test bilanziert 8,76 MWh Kälte exakt in 4,38 MWh PV und 4,38 MWh Netz – in Singlefile und ESM.
- Ein versioniertes Wirtschaftsszenario führt elf zentrale Preis-, CO₂-, Zins- und Lohnannahmen mit Version, Stichtag und Override-Status. Projekt und Manifest speichern die tatsächlich sichtbaren Werte; der Browser-Roundtrip deckt auch 0-Werte und einen leeren WP-Sondertarif ab.
- Worker-Zeitreihen werden bei cross-origin-isolierter Bereitstellung einmalig in SharedArrayBuffer kopiert und von Grob-/Fein-Workern gemeinsam gelesen. COOP/COEP sind für lokale Web-Auslieferungen gesetzt; `file://` nutzt wegen der Browser-Sicherheitsgrenze weiterhin Transferkopien und weist den Transportmodus diagnostisch aus.

Offene Vertiefung: CalcEngine-Nachrechnung sowie die PV-/Batteriepfade vollständig auf dieselben Szenario- und Kostenkerne umstellen.
