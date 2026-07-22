# Zwischenbericht 02 – Zustand, Varianten, Import/Export und Datenintegrität

Stand: 18.07.2026  
Prüfumfang: globaler Zustand, Projekt-JSON, Autosave, Varianten-Snapshots, Wärme-/Stromtopologie und Wiederherstellungsreihenfolge.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

Der Export erfasst viele fachliche Bereiche, ist aber kein verlustfreier Snapshot der laufenden Anwendung. Besonders Wärme-Netztopologie, globale ES-Modul-/Window-Bindings, Nullwerte und Varianten sind gefährdet. Projektdateien besitzen zwar `version: 1`, es gibt jedoch weder Schema-Validierung noch Migration. Ein fehlerhafter Import beginnt außerdem mit dem Löschen des aktuellen Projekts und ist nicht transaktional.

## Befunde

### D-01 – Kritisch – Projektimport ist destruktiv und nicht transaktional

`_loadProject()` entfernt zuerst Gebäude, Netz, Trasse und Erzeugerzustände. Erst danach werden die importierten Daten schrittweise verarbeitet. Wirft ein späterer Schritt eine Exception, bleibt ein teilweise geladenes Projekt zurück; der vorherige Zustand ist verloren. Der äußere `try/catch` zeigt lediglich „Fehler beim Laden“.

Empfehlung: Datei zuerst vollständig parsen, validieren und in ein unabhängiges Datenmodell migrieren. Anschließend atomar anwenden. Vor dem Commit einen Wiederherstellungssnapshot halten.

### D-02 – Kritisch – Modulzustand und `window`-Zustand können auseinanderlaufen

`main.js` kopiert Exportwerte einmalig nach `window`. Bei Arrays/Objekten bleibt das zunächst dieselbe Referenz, spätere Neuzuweisungen trennen sie jedoch. Im Code werden beide Formen gemischt. Beispiel: Trassen-Setter ersetzen Modulbindings, während Zeichenwerkzeuge direkt `window.trassePoints` ersetzen oder mutieren.

Folgen:

- Darstellung und Berechnung können unterschiedliche Arrays sehen.
- Import, Löschen und Variantenwechsel können je Laufzeitmodus anders reagieren.
- Singlefile-Monolith kaschiert Fehler, die im echten ESM-Modus auftreten.

Empfehlung: Eine einzige autoritative State-Quelle; keine Datenkopien in `main.js`; kontrollierte Getter/Actions oder Property-Deskriptoren nur als Übergangslösung.

### D-03 – Kritisch – Wärmenetz-Topologie wird nicht vollständig gespeichert

`customEdges` exportiert ausschließlich Kanten mit beiden IDs unter 10000, also Gebäude-zu-Gebäude. Trassenknoten und später erzeugte Junctions werden nicht gespeichert. Ebenso fehlen wesentliche Kantenattribute wie DN, individuelle Länge, Kostenklasse, Sanierungsstatus und sonstige manuelle Anpassungen.

Konkrete Folgen:

- automatisch über Trassenknoten aufgebautes Netz kann nach dem Laden anders aussehen,
- Lotpunkt-Abzweige neu hinzugefügter Gebäude gehen verloren,
- manuelle Dimensionierungs-/Bestandsinformationen können verschwinden,
- Projekt-Reload ist kein Roundtrip.

Empfehlung: Netz als eigenständigen Graphen mit stabilen Knoten-/Kanten-IDs vollständig serialisieren. Roundtrip-Tests müssen semantische Gleichheit prüfen.

### D-04 – Hoch – Schema-Version ohne Schema, Validierung oder Migration

Der Export schreibt `version: 1`; `_loadProject()` wertet die Version nicht aus. Es existiert kein formales Schema und kein zentraler Migrationspfad.

Risiken:

- unbekannte zukünftige Dateien werden stillschweigend teilweise geladen,
- falsche Typen gelangen tief in DOM- und Kartenlogik,
- Altprojekte hängen von verstreuten Fallbacks ab,
- Fehler können erst nach dem Löschen des aktuellen Projekts auftreten.

Empfehlung: JSON Schema oder typisierte Laufzeitvalidierung, explizite Migrationen `v1 -> v2`, Ablehnung neuer unbekannter Major-Versionen und verständliche Fehlerliste vor dem Laden.

### D-05 – Hoch – Zahlreiche legitime Nullwerte werden durch Defaults ersetzt

Export und Import verwenden häufig `value || default` sowie `if (project.x)`. Dadurch gelten `0`, leere Zeichenketten und `false` als „nicht vorhanden“.

Betroffene Klassen:

- Leistungen und Energiemengen,
- Wirkungsgrade/Faktoren,
- Speicherverluste und Lade-/Entladeleistungen,
- Emissionsfaktoren,
- PV-/Strompreise,
- Sanierungsanteile,
- Gebäudestockwerke und Dachanteile.

Nicht jeder Nullwert ist fachlich zulässig, aber diese Entscheidung muss validiert werden und darf nicht implizit durch JavaScript-Truthiness erfolgen.

Empfehlung: `??` für fehlende Werte, explizite Bereichsvalidierung und separate Behandlung leerer Eingaben.

### D-06 – Hoch – Varianten sind keine vollständigen Projektvarianten

Varianten erfassen Wärme-Netzparameter, Erzeugerzustand und Stromnetzsnapshot. Nicht variantenspezifisch gesichert werden unter anderem:

- Wärmenetz-Topologie/Trassen,
- Gebäudegrunddaten und Sanierungszustände (teilweise nur Ausschlüsse),
- allgemeine Grundlagen/Lastgangparameter,
- Freiflächen und mehrere PV-Grundlagen,
- Karten-/Planungsobjekte außerhalb des Stromnetz-Snapshots,
- diverse wirtschaftliche/globale Einstellungen.

Damit kann ein Variantenwechsel Zustände vermischen, wenn Benutzer eine „vollständige Alternative“ erwarten.

Empfehlung: Variantenbegriff fachlich definieren. Entweder ausdrücklich nur „Versorgungsvariante“ nennen oder einen vollständigen, versionierten Variantensnapshot einführen.

### D-07 – Hoch – Variantenwechsel besitzt Race-/Zwischenzustandsrisiken

`applyNetzState()` plant `recalcNetz()` per `setTimeout(50)`, während anschließend Erzeuger- und Stromnetzzustand angewendet sowie weitere Berechnungen ausgelöst werden. Es gibt keine Transaktion oder zentrale „Apply abgeschlossen“-Phase.

Folgen:

- Berechnungen können teilweise alten und teilweise neuen Zustand sehen,
- schnelles Umschalten kann mehrere verzögerte Neuberechnungen überlagern,
- UI und Ergebnis-Caches können kurzfristig inkonsistent sein.

Empfehlung: Batch-/Transaction-API: Events und Berechnungen während Restore unterdrücken, danach genau eine vollständige Invalidierung und Neuberechnung.

### D-08 – Hoch – Autosave kann aufgrund Umfang/Quota still ausfallen

Alle 30 Sekunden wird das vollständige Projekt inklusive eingebetteter Overlays und gegebenenfalls umfangreicher Winddaten nach `localStorage` geschrieben. Browserlimits liegen typischerweise im niedrigen MB-Bereich. Fehler werden vollständig verschluckt.

Folgen:

- Nutzer glaubt an Autosave, obwohl keiner mehr geschrieben wird,
- große Planbilder machen das Problem wahrscheinlich,
- es gibt weder Zeitstempel noch Quota-/Fehleranzeige.

Empfehlung: IndexedDB für große Daten, Status „zuletzt gespeichert“, Fehler sichtbar melden und Binärdaten getrennt/dedupliziert speichern.

### D-09 – Mittel – Autosave besitzt nur einen Slot und keine Integritätsmetadaten

Es gibt keine Generationen, Prüfsumme, Projekt-ID oder Recovery-Historie. Ein fehlerhafter/teilweiser Zustand überschreibt nach spätestens 30 Sekunden den letzten brauchbaren Stand.

Empfehlung: rotierende Generationen, Zeitstempel, Schema-Version und manuelle Auswahl eines Wiederherstellungspunkts.

### D-10 – Mittel – Importdaten werden tief und uneinheitlich kopiert

Einige Zustände werden tief per JSON kopiert, andere nur per Spread oder direkt referenziert. Verschachtelte Arrays wie Maßnahmen, Props, Profile und Varianten können Referenzen teilen oder uneinheitlich behandelt werden.

Empfehlung: zentrale Clone-/Normalize-Funktion je Schemaobjekt; `structuredClone` für reine Daten, anschließend Validierung.

### D-11 – Mittel – Projektzustand und abgeleitete Ergebnisse sind nicht klar getrennt

Der Export mischt Benutzereingaben, fachliche Konfiguration, Karten-Geometrien, Maßnahmen, Assets und teilweise abgeleitete Werte. Andere Ergebnis-/Cachezustände werden nach Import asynchron neu erzeugt.

Folgen:

- unklar, welche Werte Quelle der Wahrheit sind,
- importierte abgeleitete Werte können bis zur Neuberechnung veraltet sein,
- Reproduzierbarkeit eines Berichts ist nicht garantiert.

Empfehlung: `inputs`, `model`, `derivedResults`, `metadata` trennen; Ergebnisse mit Berechnungsversion und Input-Hash kennzeichnen.

### D-12 – Mittel – Keine automatisierten Projekt-Roundtrip-Tests

Es fehlen Tests für `export -> clear -> import -> export`, insbesondere mit Trassenabzweigen, manuellen Wärmeleitungen, Assets, Varianten, Overrides, Winddaten und Overlays.

Empfehlung: kanonische Fixture-Projekte pro Schema-Version und semantischer Deep-Diff nach Roundtrip in beiden Laufzeitmodellen.

## Positive Befunde

- Projekt-JSON deckt viele Domänen ab und ist lesbar formatiert.
- Klimadaten, Windstandort, Overlays, Cluster, Custom-SLPs und Maßnahmen wurden bewusst in die Persistenz aufgenommen.
- Die Kommentare erkennen das Problem nicht-lebender ES-Modul-Window-Kopien an einzelnen Stellen bereits ausdrücklich.
- Stromnetz-Import versucht Asset-Duplikate und verwaiste Erzeugerknoten zu vermeiden.
- `null` wird bei mehreren neueren Feldern bereits korrekt über `??`/`!= null` behandelt.

## Priorität für spätere Behebung

1. Transaktionaler, vorab validierter Import.
2. Autoritative State-Quelle ohne Window-/Modul-Divergenz.
3. Vollständige Serialisierung des Wärmenetzgraphen.
4. Schema und Migrationen.
5. Falsy-/Nullwertbehandlung systematisch korrigieren.
6. Variantengrenzen definieren und Restore bündeln.
7. belastbares Autosave und Roundtrip-Tests.

