# Zwischenbericht 06 – UI/UX, Barrierefreiheit, Sicherheit, Performance und Feld-App

Stand: 18.07.2026  
Prüfumfang: Hauptnavigation, Panels/Modi, Tastaturbedienung, HTML/CSS, dynamisches Markup, Browserdaten, externe Kommunikation, Feld-App, Fotos/Offline und Performance-Risiken.  
Status: abgeschlossen; keine Produktivcode-Änderungen.

## Kurzurteil

Die Oberfläche bietet außergewöhnlich viele Funktionen, ist dadurch aber stark modus- und panelorientiert. Viele Aktionen besitzen keine einheitliche Befehlslogik. Barrierefreiheit ist nur punktuell vorhanden. Sicherheitsrisiken entstehen vor allem durch ungeprüfte Frame-Nachrichten, dynamisches `innerHTML` und Feedback-/Exportdaten. Die Feld-App ist für den Vor-Ort-Einsatz sinnvoll konzipiert und nutzt IndexedDB für Fotos, benötigt aber robustere Offline-/Speicherkommunikation.

## Befunde

### U-01 – Hoch – Zu viele überlappende Navigations- und Bedienebenen

Kopfzeile, Mehr-Menü, Ebenenpanel, linke fünfteilige Sidebar, rechte Sidebar, zahlreiche Floating Panels, zentrale Ansichten und Kartenmodi konkurrieren um Aufmerksamkeit. Dieselbe Funktion ist teilweise mehrfach erreichbar, jedoch nicht immer synchronisiert.

Folgen: hohe Lernlast, schwer erkennbarer aktueller Modus, lange Mauswege und inkonsistente Rückkehr zum vorherigen Kontext.

Empfehlung: aufgabenbasierte Hauptnavigation und kontextuelle Kartenwerkzeugleiste; Einstellungen/Analyse klar von Modellbearbeitung trennen.

### U-02 – Hoch – Modale Zeichen-/Auswahlzustände sind nicht zentral verwaltet

Viele boolesche Flags steuern Platzierung, Zeichnung, Selektion, Pruning und Overlay-Referenz. Module beenden andere Modi jeweils defensiv und unvollständig. Cursor, Panels, Kartenzoom und Hinweise werden an vielen Stellen separat gesetzt/zurückgesetzt.

Empfehlung: zentrale Interaction State Machine mit genau einem aktiven Werkzeug, standardisierten `enter/cancel/commit`-Lebenszyklen und einheitlichem Statusbanner.

### U-03 – Hoch – Tastatur- und Screenreader-Bedienung ist unvollständig

- viele Icon-Buttons besitzen nur `title`, keinen zugänglichen Namen,
- dynamische Dialoge haben selten Fokusfalle/Fokusrückgabe,
- Kartenfunktionen setzen präzise Pointerinteraktion voraus,
- aktive Tabs/Schalter melden ihren Zustand nicht durchgehend via ARIA,
- Fokus-Outlines werden häufig entfernt und nur durch Farbänderung ersetzt,
- versteckte Kompatibilitätsbuttons enthalten teilweise keine Beschriftung.

Empfehlung: WCAG-2.2-AA-Baseline, semantische Tabs/Dialogs, sichtbarer `:focus-visible`, Tastaturalternative für Kartenobjekte und automatisierte axe-Tests.

### U-04 – Hoch – Potenzielle DOM-XSS über importierte/benutzerdefinierte Texte

Das Projekt verwendet an vielen Stellen `innerHTML`. Häufig wird korrekt escaped, aber nicht durchgehend. Auffällige Stellen sind unter anderem Feldapp-Galerie-Metadaten in `05a-export.js` und Dateinamen in der NAP-Analyse. Projekt-/CSV-Dateien sind externe Eingaben und können HTML enthalten.

Empfehlung: Text standardmäßig über `textContent`; zentraler sicherer Template-Renderer; verbleibendes HTML mit geprüftem Escaper/Allowlist. Sicherheits-Testfixture mit HTML/Attribut-/SVG-Payloads.

### U-05 – Hoch – Frame-Kommunikation ohne Originprüfung

Siehe A-05: Gebäudedaten können in eingebettetem Betrieb ohne geprüfte Herkunft empfangen werden. Dies ist gleichzeitig Sicherheits- und Datenintegritätsproblem.

### U-06 – Hoch – Feedback kann umfangreiche Projektdaten übertragen

Feedback kann Screenshot, Konsolenlogs und bis zu 200 KB DOM-Snapshot versenden. Darin können Gebäudenamen, Projektwerte, Kartenpositionen und sonstige sensible Informationen stehen. Die Checkboxen bieten teilweise Zustimmung, aber Umfang und Datenschutzwirkung sollten deutlicher erklärt werden.

Empfehlung: Vorschau/Datentypen anzeigen, standardmäßig minimale Diagnose, sensible Felder redigieren, Datenschutzhinweis und Aufbewahrungsweg dokumentieren.

### U-07 – Mittel – Doppelte IDs verursachen unzuverlässige UI-Synchronisation

Bestätigt: `btn-draw-trasse` und `el-pv-visible` kommen jeweils doppelt vor. DOM-APIs und Labels adressieren dadurch unter Umständen das falsche Element.

### U-08 – Mittel – Responsive Nutzung der Hauptapp ist begrenzt

Einige Breakpoints existieren, die Oberfläche basiert jedoch auf mehreren festen Sidebars/Floating Panels und dichten Tabellen. Tablet-/kleine Laptopansichten dürften häufig überlagert oder scrollintensiv sein.

### U-09 – Mittel – Keine Reduced-Motion-Strategie

Animationen, Übergänge, Karteneffekte und automatische Scrollbewegungen werden nicht zentral über `prefers-reduced-motion` reduziert.

### U-10 – Mittel – Fehler werden häufig nur kurzzeitig oder nur in der Konsole gemeldet

Viele `catch`-Blöcke schlucken Fehler oder zeigen flüchtige Hinweise. Bei Import, Autosave, externen Diensten und Berechnungsfallbacks fehlt ein dauerhaftes Diagnosezentrum mit Handlungsempfehlung.

### U-11 – Mittel – Große DOM-/SVG-Neuzeichnungen und lineare Suchen

Zahlreiche Panels werden vollständig per `innerHTML` neu aufgebaut. Viele Schleifen suchen wiederholt per `.find()` in globalen Arrays. Kartenlayer werden teilweise komplett entfernt und neu erzeugt. Bei großen Liegenschaften kann dies zu UI-Ruckeln und GC-Spitzen führen.

Empfehlung: Performancebudgets mit 100/500/2000 Gebäuden, Maps nach ID, inkrementelles Rendering, LayerGroups/Canvas und Messung langer Tasks.

### U-12 – Mittel – Event-/Timer-Lebenszyklen sind schwer nachprüfbar

Im Bestand gibt es mehr als 350 Listener-/Map-/Timer-Registrierungen. Teilweise werden Listener dynamisch ergänzt oder per `setTimeout(0)` initialisiert. Nicht alle Komponenten besitzen symmetrisches Teardown.

Empfehlung: Komponenten-Lifecycle und AbortController für DOM-Listener; Timerregister für Modi/Views.

### U-13 – Mittel – Feld-App-Offlinefallback ist nicht garantiert

Der Service Worker cached die HTML-Shell nicht vor, versucht sie bei Netzfehler aber aus dem Cache zu lesen. Die als Einzeldatei ausgelieferte Feld-App entfernt den Service Worker und funktioniert anders als die gehostete PWA. Beide Varianten benötigen eigene Tests.

### U-14 – Mittel – Feld-App-Daten sind lokal, aber Recovery/Quota bleibt begrenzt

Positiv: Fotos und Notizen liegen in IndexedDB, Fotos werden komprimiert, Blob-URLs werden bereinigt und nicht exportierte Inhalte werden angezeigt. Es fehlen jedoch Quota-Anzeige, rotierende Sicherung, Verschlüsselung und robuste Wiederherstellung bei Browser-/Originwechsel.

### U-15 – Mittel – Temporäre Messenger-/Dateiquellen gefährden Feld-App-Daten

Die App warnt bereits davor. Das Problem bleibt technisch real: unterschiedliche `file://`-/temporäre Origins können getrennte oder kurzlebige Browserdatenbereiche erzeugen.

Empfehlung: bevorzugter gehosteter Installationsweg oder echte installierbare PWA; Projekt-/Fotoexport früh und regelmäßig anbieten.

### U-16 – Mittel – Karten-/GPS-/Foto-Datenschutz braucht explizites Konzept

Feldfotos, Notizen, GPS und Gebäudedaten können betriebliche oder personenbezogene Informationen enthalten. Es fehlen sichtbare Angaben zu lokaler Speicherung, Exportziel, Löschung und Geräteverlust.

### U-17 – Niedrig – Semantik und Schreibweisen sind uneinheitlich

Deutsch/englische Fachbegriffe, Abkürzungen und unterschiedliche Bezeichnungen („Auto-Netz“, „Haupttrasse“, „Trasse“, „Leitungen“) erschweren mentale Modelle.

## Positive Befunde

- Hinweise, Tooltips, Leitfaden und Feedbackfunktion unterstützen Pilotnutzer.
- Feld-App nutzt IndexedDB statt LocalStorage für Binärdaten.
- Fotos werden komprimiert und Blob-URLs aktiv freigegeben.
- Benutzereingaben werden in der Feld-App überwiegend durch `esc()` geschützt.
- Origin-/temporäre-Datei-Problematik wird dem Feldnutzer bereits erklärt.
- Karten-Hit-Layer und responsive Teilbereiche verbessern praktische Bedienbarkeit.
- Dark-/Light-Themes und kompakte Vor-Ort-Oberfläche sind vorhanden.

## Priorität für spätere Behebung

1. zentrale Interaction State Machine und aufgabenbasierte Navigation.
2. Originprüfung und konsequentes sicheres DOM-Rendering.
3. barrierefreie Dialog-/Tab-/Fokusgrundlage.
4. dauerhaftes Fehler-/Datenqualitätszentrum.
5. Performancebudgets und große Fixtures.
6. Feld-App-Offlinestrategie, Quota/Recovery und Datenschutz.

