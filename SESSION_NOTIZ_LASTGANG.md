# Session-Notiz SigLinDe und Gebäudelastgänge

Stand: 28.07.2026

## Erinnerung

Das gesamte Thema SigLinDe, gebäudespezifische Lastgänge und gemessene
Gesamtlastgänge soll in einer späteren Session noch einmal in Ruhe fachlich
von Grund auf geprüft und anschließend abschließend umgesetzt werden.

Heute keine weiteren fachlichen Festlegungen treffen. Der Lastgang ist ein
Kernbestandteil der Software; plausible Annahmen dürfen nicht als gesicherte
Normwerte erscheinen.

## Gesicherter Git-Ausgangspunkt

- Repository: `HansCodemann/Micke-Heat-2026-07-18`
- Branch: `main`
- Letzter gepushter Commit: `2903a71 Gebäudespezifische Wärmelastgänge ergänzen`
- Dieser Commit enthält den ersten gebäudespezifischen Prototyp.

## Lokaler, noch nicht gepushter Zwischenstand

Nach `2903a71` wurden folgende Sicherheitskorrekturen lokal umgesetzt:

- Heizlastüberschüsse werden nur noch innerhalb desselben Tages verschoben.
- Tages- und Jahresenergie bleiben dabei erhalten.
- Ist `Tagesenergie > Heizlast × 24 h`, wird ein Konflikt ausgewiesen, statt
  Energie zu verlieren oder auf andere Tage zu verschieben.
- Gebäudespezifische Profile werden nur verwendet, wenn die Berechnung
  ausschließlich aus Gebäudejahreswerten stammt.
- Manueller Gesamtverbrauch, Monatswerte und hochgeladene Messlastgänge nutzen
  wieder ausschließlich den bisherigen Gesamtlastgangpfad.
- Keine Kalibrierung von Einzelprofilen auf einen möglicherweise
  verlustbehafteten Zentralenwert.
- Prüfstand: ESLint erfolgreich, 430 Unit- und Bilanztests erfolgreich,
  Singlefile-Build erfolgreich; relevante Browserpfade erfolgreich.

Separater bekannter Befund außerhalb dieses Themas:

- Ein Projekt-Roundtrip-Test verändert weiterhin Wärmenetz-Wegpunkte beim
  Laden. Das gehört zur Routing-/Speicherlogik, nicht zur Lastgangkorrektur.

## Lokale Visualisierung

- Datei: `docs/lastgang-methodik.html`
- Nur lokale Denk- und Diskussionshilfe.
- **Diese HTML-Datei ausdrücklich nicht committen oder pushen.**
- Sie ist lokal über `.git/info/exclude` vom Git-Status auszuschließen.

## Fachlich noch offene Kernfragen

1. Welche Verfahren gelten für welche Gebäudetypen?
   - BDEW/SigLinDe: tägliche Temperaturfunktion und offizielle
     Wochentagsfaktoren für Gas-SLP-Kategorien.
   - VDI 4655: Wohngebäude innerhalb des offiziellen Geltungsbereichs.
   - DIN/TS 18599-10: Nutzungsrandbedingungen und Betriebszeiten für
     Nichtwohngebäude.
   - BEW: Förder- und Nachweisrahmen, kein vollständiger
     8.760-Stunden-Lastgangalgorithmus.
2. Welche Normdaten dürfen lizenzrechtlich in der Software hinterlegt werden?
3. Welche Tages-, Wochenend-, Feiertags- und Ferienprofile sind belastbar?
4. Wie werden Raumwärme, Trinkwarmwasser und Prozesswärme getrennt?
5. Wie werden Heizlastgrenze, feste Tagesenergie und thermische Trägheit
   konsistent verbunden?
6. Wie werden Schaltjahre, Feiertage und regionale Kalender behandelt?
7. Wie werden detaillierte Netzverluste stundenscharf verteilt?
8. Wie werden gemessene Gesamtlastgänge behandelt?
   - Messgrenze eindeutig erfassen.
   - Bekannte Gebäudejahreswerte festhalten.
   - Restenergie nur auf Gebäude ohne gesicherten Jahreswert verteilen.
   - Datenkonflikte und nicht zugeordnete Wärme offen ausweisen.
   - Keine undurchsichtige Matrixkalibrierung ohne ausdrückliche Entscheidung.
9. Wie werden gemessene Einzelprofile priorisiert und dokumentiert?
10. Welche Qualitätsstufen zeigt die Oberfläche?
    - gemessen
    - normbasiert
    - synthetisch
    - aus Gesamtwert abgeleitet
    - ungeklärte Restlast

## Empfohlener Wiedereinstieg

1. Zuerst diese Notiz lesen.
2. Den lokalen Prototyp und die HTML nur als Anschauung behandeln.
3. Eine Quellen-/Verfahrensmatrix erstellen: Gebäudetyp, Verfahren,
   Temperaturmodell, Kalenderfaktor, Stundenprofil, Warmwasser, Quelle,
   Version, Lizenz und Qualitätsstatus.
4. Drei Referenzfälle vollständig von Hand durchrechnen:
   - MFH
   - Schule
   - gemischte Liegenschaft mit gemessenem Zentralenlastgang
5. Erwartete Tages-, Monats- und Jahresbilanzen als Tests festschreiben.
6. Erst danach Profilparameter und Benutzeroberfläche endgültig umsetzen.

