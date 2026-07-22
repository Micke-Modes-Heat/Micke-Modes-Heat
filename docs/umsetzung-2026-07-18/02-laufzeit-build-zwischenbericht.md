# Zwischenbericht 2 – Laufzeit, State und Builds

Stand: Laufzeitmodell vereinheitlicht; großer zyklischer Altkern bleibt schrittweise zu entflechten.

- Kontrollierte Setter für ersetzbare Kernzustände; ES-Modus erhält Live-Accessors statt einmaliger `window`-Kopien.
- Browserabläufe laufen identisch gegen Singlefile und echten Vite-/ESM-Modus.
- Singlefile und Entwicklung verwenden jetzt beide `src/main.js` als kanonischen ESM-Einstieg. Rollup parst und bündelt die Module; Regex-Umschreibung, `let`/`const`-Umwandlung und manuelle Dateireihenfolge wurden entfernt.
- Singlefile bettet Leaflet, Toolbar, DistortableImage, JSZip, html2canvas sowie PDF.js und dessen Worker lokal ein.
- Feld-App baut ausschließlich aus package-lock-gebundenen lokalen Bibliotheken.
- PDF.js auf sichere Hauptversion 5 aktualisiert; `npm audit` meldet 0 Schwachstellen.
- Feld-App-Service-Worker installiert die HTML-Shell vor und fällt bei Funkloch zuverlässig darauf zurück.
- Der Hauptbuild akzeptiert `SOURCE_DATE_EPOCH`; zwei Builds mit identischem Epoch-Wert wurden über identische SHA-256-Prüfsummen bytegenau verifiziert.
- Ein reproduzierbarer Importgraph misst die Architektur. Die zwei isolierten Zyklen Optimierer-Orchestrierung↔Worker und Windanalyse↔Restriktionen wurden durch neutrale Session-/Config-Module entfernt; statt drei zyklischen Komponenten bleibt eine mit 33 Altmodulen. Ein Test verhindert Rückfall oder Wachstum.

Die verbleibende Architekturarbeit betrifft damit nicht mehr zwei Laufzeitsemantiken, sondern den weiterhin stark zyklischen Importgraphen und die große Kompatibilitätsoberfläche auf `window`.
