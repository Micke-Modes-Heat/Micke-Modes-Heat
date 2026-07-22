# Zwischenbericht 6 – UI, Sicherheit und Feld-App

Stand: zentrale Hoch-Risiken umgesetzt.

- Iframe-Nachrichten prüfen Elternfenster und konkrete HTTP(S)-Origin; keine `*`-Zielorigin mehr.
- Galerie-Metadaten, Notizen und NAP-Dateinamen werden HTML-escaped beziehungsweise per `textContent` gesetzt.
- Feedback übermittelt standardmäßig nur Text. Screenshot, Logs und DOM-Diagnose benötigen getrennte Zustimmung mit Datenhinweis.
- Doppelte PV- und Trassen-IDs entfernt.
- Global sichtbarer Tastaturfokus und `prefers-reduced-motion`-Strategie ergänzt.
- Feld-App-Shell wird offline vorgehalten; Einzeldatei-Build aus lokalen Bibliotheken erfolgreich geprüft.
- Die Kartenwerkzeuge besitzen nun einen gemeinsamen Interaktionszustand mit genau einem aktiven Werkzeug. Ein Wechsel ruft den registrierten Abbruch-Lebenszyklus des alten Werkzeugs auf; Abschluss und Abbruch sind getrennt.
- Haupttrasse, Wärme- und Stromverbindungen, Plangebiet, Windgebiet, Cluster, Anlagenflächen, Fluss, Asset-/Stromkomponentenplatzierung, Wärmepumpen- und Erzeugerstandorte sowie Netz-Pruning sind angeschlossen. Der bisher verteilte defensive Abbruch zwischen einzelnen Werkzeugen entfällt in den Kernpfaden.
- Ein dauerhaft sichtbares Statusbanner nennt Modus und nächsten Schritt und bietet einen Abbrechen-Knopf. Escape beendet denselben zentralen Zustand; ein Browsertest prüft Werkzeugwechsel, Bereinigung und Anzeige in Singlefile und ESM.
- Für 1.366-, 1.024-, 768- und 600-Pixel-Ansichten gelten abgestufte Laptop-/Tabletlayouts. Auf kompakten Geräten startet die rechte Seitenleiste, im Hochformat zusätzlich die linke Seitenleiste eingeklappt, sodass die Karte bedienbar bleibt.
- Seitenleisten werden auf Tablets zu überlagernden Drawern, schwebende Dialoge nutzen den verfügbaren Bildschirm und Tabellen scrollen innerhalb ihres Panels. Seltenere Kopfaktionen wandern an schmalen Breakpoints aus der knappen Direktleiste; die zentralen Ansichten bleiben erreichbar.
- Browserprüfungen messen Kartenbreite, horizontales Seitenüberlaufen und Startzustände für alle vier Viewports in Singlefile und ESM.
- Ein gemeinsamer `LifecycleScope` registriert DOM- und Leaflet-Listener sowie Timeouts und Intervalle zusammen mit ihrem Teardown. `dispose()` arbeitet idempotent und räumt in umgekehrter Reihenfolge auf; Unit-Tests prüfen Listener und Timer.
- Der globale App-Lebenszyklus endet auf `pagehide`. Autosave, Status-/Footeraktualisierung, Leitfadenstatus und linke Kennwerte laufen darüber und bleiben nach dem Verlassen nicht weiter aktiv.
- Die dynamischen Plangebiet-/Windgebiet-Maphandler und der zentrale Escape-Handler verwenden Scopes statt verteilter manueller Registrierung. Komponentenintervalle für Wiedergabe, Fortschritt und Livezeit bleiben bewusst lokal und besitzen jeweils ihren eigenen Stop-Pfad.
- Ein sichtbares Datenschutzpanel beschreibt lokale Speicherung, sensible Inhalte (Adressen, technische Daten, GPS, Notizen, Fotos), aktive Export-/Feedbackweitergabe sowie Risiken bei Geräteverlust und Browserwechsel. Die Feld-App zeigt denselben Kernhinweis bereits am Einstieg und über die Kartenkopfzeile.
- „Alle lokalen App-Daten löschen“ entfernt nach deutlicher Bestätigung die bekannten Autosave- und Feld-App-Datenbanken, lokale App-Einstellungen sowie App-/Offline-Karten-Caches. Fremde LocalStorage-Schlüssel und fremde Caches derselben Origin werden bewusst nicht angerührt.
- Ein Browsertest legt Autosave, Feld-App-Datenbank, lokale Einstellungen und Caches an, führt die Löschung aus und belegt in Singlefile und ESM sowohl vollständige App-Löschung als auch Erhalt fremder Daten.
- Ein zentrales UI-Glossar legt die sichtbaren Begriffe fest. Intern bleiben kompatible Daten-/API-Namen erhalten, in Oberfläche, Hinweisen und Berichten heißen sie einheitlich „Anlagen und Netzkomponenten“, „Wärme-Haupttrasse“, „Elektro-Korridor“, „Netz automatisch erzeugen“, „Netzabschnitte ausschließen“ und „stündliche Einsatzplanung“.
- Die besonders missverständlichen Mischbegriffe „Asset“, „Auto-Netz“, „Pruning“ und unkommentiertes „Dispatch“ wurden in den zentralen Bedienpfaden ersetzt; ein Unit-Test fixiert das Glossar gegen unbeabsichtigtes Zurückdriften.
- Ein dauerhaftes Diagnosezentrum sammelt globale Laufzeitfehler, fehlgeschlagene Hintergrundvorgänge und gezielt gemeldete Fachfehler mit Bereich, Zeitpunkt und konkretem nächsten Schritt. Der Zähler ist im Mehr-Menü sichtbar; Meldungen enthalten keine Fotos oder vollständigen Projektdaten und können geleert werden.

Offene Vertiefung: vollständige WCAG-2.2-AA-Prüfung aller dynamischen Dialoge und ein dauerhaftes Diagnosezentrum statt ausschließlich flüchtiger Hinweise.
