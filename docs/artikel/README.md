# Fachartikel und Papiere

Allgemeine Fachtexte für Webseite und Wiki, **ohne Projektdaten**. Das Repository ist öffentlich: Texte mit
Liegenschaftsnamen oder -werten gehören in die Projektablage, nicht hierher.

Hier liegt die **Quelle**. Gebaut wird je Artikel eine Web-Fassung (eigenständige HTML-Seite, Abbildungen per
Klick vergrößerbar) und eine OneNote-Fassung (alle Stile inline, Abbildungen als PNG, zum Einfügen per
Strg+A / Strg+C / Strg+V).

## Aufbau

```
docs/artikel/
  <Artikel>.html      Vorlage je Artikel (Text, Tabellen, Platzhalter für Abbildungen)
  figuren.cjs         Erzeuger der eigenen Abbildungen → figuren/*.svg
  figuren/            eigene Abbildungen (keine Prinzipskizzen)
  bauen.cjs           Web-Fassung
  bauen-onenote.cjs   OneNote-Fassung
```

| Vorlage | Inhalt |
|---|---|
| `EMS-und-EZA-Regler.html` | Papier „EZA-Regler und EMS: Gebäudeautomation oder eigener Regler?“ |
| `EZA-Regler-im-Detail.html` | Fachartikel „Der EZA-Regler im Detail“ |

## Bauen

```
npm run artikel                                        alle Artikel, beide Fassungen → artikel-ausgabe/
node docs/artikel/bauen.cjs EZA-Regler-im-Detail       nur ein Artikel, nur Web
node docs/artikel/bauen-onenote.cjs alle <Zielordner>  OneNote-Fassungen in einen anderen Ordner
```

`artikel-ausgabe/` ist nicht versioniert. Die OneNote-Fassung braucht Microsoft Edge (rendert die Abbildungen
zu PNG, wie `npm run skizzen`) und `sharp` aus den devDependencies.

## Regeln für Vorlagen

- Prinzipskizzen aus der Skizzenbibliothek mit `{{FIG:<Dateiname laut docs/skizzen/katalog.json>}}` einbinden;
  sie werden beim Bauen aus `docs/skizzen` gelesen, eine korrigierte Skizze erscheint also beim nächsten Bau.
- Eigene Abbildungen mit `{{SVG:figuren/<datei>.svg|<Titel>}}`; sie entstehen über `node docs/artikel/figuren.cjs`.
- Abbildungen stehen in `<figure class="skizze">` mit `<figcaption>`.
- Das Logo kommt über `{{LOGO}}` aus `src/config/lkebw-logo.js`.
- Kopfangaben der OneNote-Fassung stehen als `<meta name="on-eyebrow|on-zweck|on-grundlage|on-stand">` im Kopf.
- Die OneNote-Fassung kennt nur die Bausteine der vorhandenen Vorlagen (Absätze, `merke`, Listen, Tabellen,
  `spalten` mit `kasten`, `herausforderungen`); andere Elemente brechen den Bau mit einer Meldung ab.
- Verweise zwischen Artikeln sind relativ (`<Artikel>_Web.html`) und funktionieren, wenn die Dateien
  im selben Ordner liegen. Der Artikel „EZA-Regler und Energiemanagement in der GLT“
  (`EZA-Regler-und-EMS_Web.html`), auf den beide verweisen, liegt noch nicht hier.
