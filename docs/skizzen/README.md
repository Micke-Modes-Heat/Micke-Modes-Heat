# Skizzenbibliothek

Allgemeine Prinzipskizzen für Gutachten, **ohne Projektdaten**. Das Repository ist öffentlich: Skizzen mit
Liegenschaftsnamen oder -werten gehören in die Projektablage des jeweiligen Gutachtens, nicht hierher.

Hier liegt die **Quelle**. Die Kollegen lesen die **Ausgabe** auf dem Netzlaufwerk; sie wird mit
`npm run skizzen` erzeugt und von Hand dorthin kopiert.

## Aufbau

```
docs/skizzen/
  katalog.json        Verzeichnis aller Skizzen (Titel, Thema, Kapitel, Status, Quelle)
  quellen/            Erzeugerskripte; _basis.mjs enthält Rahmen, Farben, Logo
  uebergreifend/ strom/ waerme/ ga/   die SVGs, eine Datei je Skizze
```

## Regeln

1. **Jede Skizze hat genau eine Quelle.** Wenn möglich ein Erzeuger unter `quellen/`; sonst „nur SVG“
   (dann direkt die SVG-Datei bearbeiten). Ist die Skizze eine Figur im Tool, ist die Tool-Figur die Quelle
   und die Datei hier nur ein Export.
2. **Status** in `katalog.json`: `entwurf` (noch nicht abgestimmt, Ausgabe mit Wasserzeichen im Ordner
   Entwurf), `abgestimmt`, `im-tool` (als Figur in Analyse › Gutachten-Grafiken).
3. **Lebensweg:** Entwurf → abgestimmt → ins Tool, sobald die Skizze in jedes Gutachten gehört.
4. **Dateinamen bleiben gleich**, den Verlauf führt Git. Feste Stände für abgegebene Gutachten liegen in
   der Projektablage bzw. im Archiv der Ausgabe.

## Neue Skizze

1. SVG im passenden Themenordner ablegen oder einen Erzeuger in `quellen/` anlegen. Ein Erzeuger bekommt
   den Themenordner als Argument (`node quellen/<name> <Zielordner>`) und schreibt seine Skizze(n) unter
   festem Namen dorthin; Bausteine in `_basis.mjs`. Ein Erzeuger darf mehrere Skizzen liefern, dann steht
   er bei jeder im Katalog. Die `.cjs`-Erzeuger stammen aus der Zeit vor der Bibliothek.
2. Eintrag in `katalog.json` ergänzen.
3. `npm run skizzen` ausführen, Ergebnis prüfen, committen.

## Auf das Netzlaufwerk bringen

`npm run skizzen` schreibt nach `skizzen-ausgabe/` (nicht versioniert; anderer Ordner über die
Umgebungsvariable `SKIZZEN_AUSGABE`). Was zu kopieren oder auf dem Laufwerk zu löschen ist, steht oben in
`_Änderungsprotokoll.txt`. Der Inhalt von `skizzen-ausgabe/` lässt sich auch komplett kopieren; nur
`.stand.json` braucht das Laufwerk nicht.

- Jede Skizze erscheint als SVG (für Word) und PNG (dreifache Auflösung, über Edge erzeugt; liefert Edge kein
  Bild, springt Chrome ein, der Hinweis steht im Protokoll).
- Erst wenn alle PNGs geschrieben sind, wird archiviert und ersetzt. Bricht der Lauf ab, bleibt die Ausgabe
  unverändert; dann offene Edge-Fenster schließen oder `SKIZZEN_EDGE` auf `chrome.exe` setzen.
- Fußzeile mit Stand und Version; „Version abc1234+“ heißt: enthält noch nicht committete Änderungen.
- Hat sich eine Skizze geändert, wandert der alte Stand nach `_Archiv/`.
- `Änderungswünsche.csv` wird nur beim ersten Lauf beigelegt und danach nie wieder, damit die Einträge
  der Kollegen auf dem Laufwerk nicht überschrieben werden.
- `skizzen-ausgabe/` nicht löschen: dort steht in `.stand.json`, welcher Stand zuletzt veröffentlicht wurde.

## Verzeichnis

<!-- katalog:start -->
| Skizze | Thema | Kapitel | Status | Quelle | Stand |
|---|---|---|---|---|---|
| [Energiesystem der Liegenschaft im Überblick: Ist-Zustand](uebergreifend/Prinzip-Energiesystem-Ist.svg) | Übergreifend | 1.2 Liegenschaftsinformationen | Im Tool | `quellen/energiesystem.mjs` | 28.10.2026 |
| [Energiesystem der Liegenschaft im Überblick: Zielbild](uebergreifend/Prinzip-Energiesystem-Zielbild.svg) | Übergreifend | 9.1 Wärmeversorgung | Im Tool | `quellen/energiesystem.mjs` | 28.10.2026 |
| [Aufbau und Anbindung des EMS in der Liegenschaft](ga/Prinzip-EMS-Anbindung.svg) | GA | 6 Gebäudeautomation | Entwurf | nur SVG | 23.10.2026 |
| [Programmablauf des EMS: Regelzyklus, Fahrplan, Kaskade](ga/Prinzip-EMS-Programmablauf.svg) | GA | 6 Gebäudeautomation | Entwurf | nur SVG | 23.10.2026 |
| [EMS und EZA-Regler im Beispiel: Signale und Leistungsbilanz](ga/Prinzip-EMS-Beispiel.svg) | GA | 6 Gebäudeautomation | Entwurf | `quellen/ems-beispiel.cjs` | 23.10.2026 |
| [EZA-Regler: Regelkreis, Zeitkette und Anforderungen](strom/Prinzip-EZA-Regelkreis.svg) | Strom | Entscheidungshilfe EZA-Eigenbau | Entwurf | `quellen/eza-eigenbau.cjs` | 23.10.2026 |
| [Eigener EZA-Regler: was zu bauen und nachzuweisen ist](strom/Prinzip-EZA-Eigenbau.svg) | Strom | Entscheidungshilfe EZA-Eigenbau | Entwurf | `quellen/eza-eigenbau.cjs` | 23.10.2026 |
| [EZA-Regler am Netzanschlusspunkt: Vorgaben, Vorrang, Rückfall](strom/Prinzip-EZA-Regelung.svg) | Strom | 6 Gebäudeautomation / 3.4.2 | Entwurf | `quellen/eza-regelung.mjs` | 23.10.2026 |
| [EMS und EZA-Regelung über die Bestandsleittechnik?](ga/Prinzip-EMS-Bestandsleittechnik.svg) | GA | Entscheidungshilfe | Entwurf | `quellen/ems-bestandsleittechnik.mjs` | 23.10.2026 |
| [Einbindung des Batteriespeichers: zentral, dezentral, hybrid](strom/Prinzip-Speichereinbindung.svg) | Strom | 3.4.2 | Im Tool | Tool-Figur `pv-speicher-standort-prinzip` | 23.10.2026 |
<!-- katalog:end -->
