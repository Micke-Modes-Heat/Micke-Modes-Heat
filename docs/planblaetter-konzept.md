# Planblätter & Planstände im Bestandsplan-Digitalisierer — Konzept

*Stand: 2026-09-02 · betrifft `src/15-plan-digitalisierer.js`*

> **Umsetzungsstand:** Stufe 1 und 2 sind gebaut (siehe §7). Die Migration und die
> Vereinigung über aktive Blätter liegen DOM-frei in `src/lib/planblaetter.js` und
> sind in `tests/planblaetter.test.js` geprüft. Offen bleiben Stufe 3 und 4 sowie
> die JPEG-Frage aus §8.2 — Blätter werden weiterhin als PNG abgelegt; der
> Platzbedarf steht jetzt in der Blattleiste, und Archivblätter lassen sich ohne
> Bild führen.

Anlass: Es liegt ein **neuerer Bestandsplan** derselben Liegenschaft vor, in dem im
Wesentlichen **neue Gebäude** eingezeichnet sind. Heute kennt der Digitalisierer genau
einen Plan (`PD.plan`, Z. 71). „Plan laden" ersetzt bei vorhandenen Markierungen nur das
Bild und behält Knoten und Kabel — die kleben aber an **Bildpixeln** des alten Plans
(`_ll`/`_xy`, Z. 92/93 rechnen gegen `PD.plan.h`). Der alte Stand ist danach weg.

Dieses Dokument legt fest, wie mehrere Pläne getragen werden, und ist so geschrieben,
dass es Schritt für Schritt programmiert werden kann.

---

## 0. Leitprinzip

> **Ein Datenmodell, zwei Rollen.** „Mehrere Blätter eines Standes" und „mehrere Stände
> desselben Bereichs" sind fachlich gegensätzlich, aber technisch dasselbe Objekt.
> Sie über ein Feld zu unterscheiden ist billiger und ehrlicher als zwei Mechanismen.

Zweites Leitmotiv, aus dem Bestand übernommen (Z. 843): **eine falsche Position ist
gefährlicher als eine fehlende.** Alles, was Markierungen von einem Blatt auf ein
anderes überträgt, bleibt darum sichtbar vorläufig und wird nie stillschweigend als
richtig verbucht.

---

## 1. Die Unterscheidung, die vor allem anderen steht

| | **Blatt** | **Stand** |
|---|---|---|
| Was es ist | Ausschnitt *eines* Planwerks (Netzbereich A / B, Bauabschnitt) | Ausgabe des Planwerks zu *einem Zeitpunkt* (2015 / 2026) |
| Verhältnis zueinander | **ergänzen sich** | **konkurrieren** |
| Fachliche Wahrheit | die **Vereinigung** aller Blätter | der **jüngste** Stand; ältere sind Historie |
| Im Abgleich | alle zählen mit | nur der jüngste zählt |

Warum das nicht kosmetisch ist — `pdAbgleich()` (Z. 946) läuft gegen **alle**
Bestandsgebäude der Liegenschaft:

* Blätter **ohne** Vereinigung → jedes Gebäude des Nachbarblatts erscheint als
  „nur auf der Karte". Man hakt ein halbes Planwerk einzeln ab, bis die Liste wieder
  brauchbar ist — und hat damit genau den Befund abgeschaltet, den man sucht.
* Stände **mit** Vereinigung → ein 2019 abgerissenes Gebäude gilt über den Plan von
  2015 weiter als „erfasst". Der Abgleich meldet Vollständigkeit für einen Bestand,
  den es nicht mehr gibt.

Beide Fehler sind still. Deshalb trägt jedes Blatt eine **Rolle**.

---

## 2. Datenmodell

```js
// statt PD.plan
PD.plaene = [{
  id: 'pb1',            // eigener Zähler, unabhängig von PD.seq
  name: 'Einlinienplan Nord',
  stand: '2026-05',     // frei, nur Anzeige/Sortierung — kein Datum erzwingen
  rolle: 'aktiv',       // 'aktiv' | 'archiv'
  url, w, h, texts,     // wie bisher PD.plan
}];
PD.aktivId = 'pb1';     // das gerade sichtbare Blatt
```

Knoten und Kabel bekommen je ein Feld `planId`.

**`PD.nodes` und `PD.links` bleiben je EINE Liste.** Das ist die zentrale Entscheidung:
die rund 40 Lesestellen im Modul bleiben unverändert, es kommt an genau zwei Kategorien
ein Filter dazu. Eine Zerlegung in `blatt.nodes[]` würde jede dieser Stellen anfassen,
ohne fachlich etwas zu gewinnen.

**Drei Sichten, drei Filter:**

| Sicht | Filter | Begründung |
|---|---|---|
| **Zeichnen & Bedienen** — `_renderMarks` (1224), `_onMapClick` (493), `_renderList` (1833), `_renderForm` (1562) | nur `planId === PD.aktivId` | unter der Leaflet-Karte liegt genau ein Bild; Pixelkoordinaten gelten nur relativ zu diesem Bild |
| **Fachliche Wahrheit** — `pdAbgleich` (946), `pdApply` (2477), `_speiseVorbilder` (2185), `_quellKnoten` (2169), `pdNsMaschen` (2329), `pdMsAnlagenPruefung` (2245) | alle Blätter mit `rolle === 'aktiv'` | das Planwerk ist die Vereinigung seiner Blätter |
| **Historie** — Archivblätter | nirgends, nur ansehbar | ein alter Stand ist Beleg, keine Aussage über heute |

`PD.abgehakt` bleibt **projektweit** und unverändert. Seine Aussage lautet „steht auf
keinem Blatt" — das ist genau die richtige Ebene.

---

## 3. Änderungen im Bestand, Stelle für Stelle

1. **`PD` (Z. 71)** — `plan` → `plaene[]` + `aktivId`. Dazu ein **Kompatibilitäts-Getter**
   `get plan() { return this.plaene.find(p => p.id === this.aktivId) || null; }`.
   Damit bleiben `_ll`/`_xy` (92/93), die rund fünfzehn `if (!PD.plan)`-Wachen,
   `_showPlanLayer` (311) und die Textebene (774/786/1356) **wörtlich stehen**.
   Das ist der Kniff, der den Umbau klein hält.
2. **`_setPlan` (429)** — hängt an, statt zu ersetzen. Beim Laden eine Rückfrage
   (`epPrompt`): *neues Blatt* oder *neuer Stand von …*. Kein stilles Verhalten mehr.
3. **`_showPlanLayer` (311)** — zeichnet das aktive Blatt; ein Blattwechsel ruft es
   erneut auf und setzt `_refZoom` neu (die Symbolgröße hängt daran, Z. 107 ff.).
4. **`_renderMarks` (1224) / `_onMapClick` (493) / `_renderList` (1833) / `_renderForm` (1562)** —
   Filter auf das aktive Blatt. Neu angelegte Knoten bekommen `planId: PD.aktivId`
   (Z. 510, 693, 738, 1060), neue Kabel ebenso (Z. 1509).
5. **`_ankerPaare` (853)** — Anker **nur aus dem eigenen Blatt**. Maßstab und Drehung
   sind je Blatt verschieden; eine über zwei Blätter gemittelte Ähnlichkeitsabbildung
   ist systematisch falsch, nicht nur ungenau. Der Fallback „aus dem ganzen Blatt"
   (Z. 899) heißt danach wörtlich, was er sagt.
6. **`pdAbgleich` (946)** — Archivblätter ausschließen; die Vereinigung über die aktiven
   Blätter ergibt sich von selbst, weil `PD.nodes` global bleibt.
7. **`pdApply` (2477)** — läuft über **alle aktiven Blätter**, nicht nur über das
   sichtbare. Sonst muss je Blatt einmal übernommen werden, und der stationsinterne
   Standardaufbau (Z. 2078 ff.) liefe mehrfach an. Der Bericht schlüsselt nach Blatt auf.
8. **`pdSerialize` / `pdDeserialize` (2648 / 2660)** — neues Format samt Migration, s. §6.
9. **Panel-Kopf (158) und `_renderFortschritt` (2030)** — Blattleiste zum Wechseln,
   Fortschritt je Blatt *und* gesamt. `pdAbgleichKopieren` (990) trägt heute
   `PD.plan.name` im Kopf; künftig die Liste der aktiven Blätter.

---

## 4. Der konkrete Fall: neuer Stand mit neuen Gebäuden

Ablauf nach dem Umbau:

1. Neuen Plan laden, Antwort: **neuer Stand von „Einlinienplan Nord"**.
   → neues Blatt `rolle:'aktiv'`, das alte wird auf `rolle:'archiv'` gesetzt.
2. Rückfrage **„Markierungen übernehmen?"** — Knoten und Kabel des alten Blattes werden
   auf das neue kopiert: neue `planId`, Pixelkoordinaten 1:1, bei abweichender Auflösung
   über `w`/`h` skaliert. Alle Verknüpfungen (`linkId`, `assetId`, `anschlussAssetId`,
   `edgeId`) wandern mit — **nichts muss neu verknüpft werden**, der Übernahmestand
   bleibt erhalten. Das ist genau das heutige Verhalten von `_setPlan`, nur explizit und
   ohne den alten Stand zu verlieren.
   Voraussetzung: dieselbe Zeichnung im selben Ausschnitt. Wurde der Plan neu gesetzt,
   antwortet man Nein und fängt auf dem Blatt leer an.
3. **Sichtprüfung**: die kopierten Marken liegen auf ihren Kästchen oder daneben. Was
   verrutscht ist, zieht man zurecht. Kopierte Marken werden bis zur ersten Berührung
   optisch als *übertragen* geführt, damit sichtbar bleibt, was noch niemand angesehen hat.
4. Neue Gebäude ergänzen wie bisher über das Suchfeld bzw. „fehlendes Gebäude".

Danach ist der Vergleich „was ist neu?" ein Blattwechsel statt einer Erinnerungsleistung.

**Bewusst nicht:** automatische Bildregistrierung zwischen altem und neuem Stand
(Feature-Matching). Auf schematischen Plänen ohne Passpunkte ist das nicht verlässlich,
und eine falsche Position kostet hier über das Trassenrouting direkt Kabellänge und
Kosten (Z. 843).

---

## 5. Blattübergreifende Kabel

Auf Blatt 1 endet eine Leitung an einem Pfeil „weiter auf Blatt 3". Fachlich ist das ein
Kabel, dessen Enden auf zwei Blättern liegen.

Der Kabelgraph ist blattfrei (`_speiseVorbilder`, `pdNsMaschen`, `pdApply` arbeiten nur
über `l.a`/`l.b`) — fachlich funktioniert das also sofort. Nur das **Zeichnen** braucht
einen Sonderfall, und die Stützpunkte (`_pendingPts`, ebenfalls Bildpixel) hätten sonst
zwei Bezugssysteme.

Vorschlag: ein eigener Knotentyp **`art:'uebergang'`**, der auf jedem der beiden Blätter
einmal am Blattrand sitzt und auf sein Gegenstück zeigt. Zwei gewöhnliche Kabel plus eine
Verbindung der Übergänge — jedes Kabel bleibt damit vollständig auf einem Blatt, der
Graph läuft trotzdem durch.

→ **Eigener Schritt, nach Blättern und Ständen.** Vorher prüfen, ob die vorliegenden
Pläne das überhaupt brauchen; bei einem Planwerk je Netzbereich oft nicht.

---

## 6. Kosten, Fallen, Migration

* **Projektgröße.** Jedes Blatt liegt als PNG-DataURL bei Scale 2.5 in der Projektdatei
  (Z. 366). Ein gerastertes A1-Blatt sind schnell 4–8 MB, Base64 schlägt ~33 % auf.
  Fünf Blätter plus Archiv sprengen die Projektdatei.
  **Empfehlung:** gerasterte Blätter als **JPEG q≈0.85** ablegen (Text bleibt lesbar,
  Faktor 5–10 kleiner), im Panel anzeigen, wie viel MB die Blätter belegen, und für
  Archivblätter **„Bild verwerfen, Marken behalten"** anbieten — dann bleibt die Historie
  als Beleg, ohne die Datei zu tragen.
* **Migration.** Bestehende Projekte tragen `schemaPlan.plan`. `pdDeserialize` (2660)
  muss das auf `plaene:[{...data.plan, id:'pb1', rolle:'aktiv', stand:''}]` heben und
  allen Knoten/Kabeln `planId:'pb1'` geben. **Ohne diesen Zweig ist der Bestandsplan in
  jedem Altprojekt leer** — der einzige Punkt, an dem der Umbau Daten kosten kann.
* **`PD.seq`** bleibt gemeinsamer Zähler für Knoten und Kabel; Blätter bekommen einen
  eigenen (`PD.planSeq`), damit Blatt-IDs nicht mit `pn…`/`pl…` kollidieren.
* **Symbolgröße (erledigt, war ein Fehler).** Der 100-%-Bezug war die Zoomstufe der
  Einpassung beim Laden — also die *Panelbreite zum Ladezeitpunkt*. Damit hatten die
  gespeicherten Größen (`PD.gebGroesse`, `n.skala`) keinen reproduzierbaren Bezug:
  dasselbe Projekt kam auf einem anderen Bildschirm, in einem anderen Panelzustand
  oder auf einem Blatt anderer Auflösung in anderer Größe zurück, und der Blattwechsel
  ließ die Symbole springen. Der Bezug hängt jetzt am Blatt (`_refZoomFuer`: die
  Zoomstufe, bei der das Blatt `PLAN_REF_PX` Bildpixel breit steht). Gemessen deckt ein
  Symbol seither auf Blättern von 3000×2000, 6000×4000 und 4000×4000 denselben Anteil
  der Zeichnung ab. Zusätzlich läuft die Leaflet-Karte des Panels mit
  `markerZoomAnimation: false` — sonst skaliert der Browser die Symbole während der
  Zoom-Animation per CSS mit (verzerrt, unscharf) und sie schnappen am Ende zurück.
* **Übertragen skaliert einachsig.** x und y getrennt zu skalieren zieht die Anordnung
  schief, sobald die Seitenverhältnisse nicht exakt übereinstimmen — bei einer neuen
  PDF-Ausgabe fast immer. `_uebertrageMarken` nimmt deshalb einen Faktor für beide
  Achsen und weist auf abweichende Seitenverhältnisse hin, statt sie stillschweigend
  wegzurechnen.
* **Testabdeckung.** Für den Digitalisierer gibt es heute keine Tests. Mindestens die
  Migration (`pdDeserialize` mit altem Format) und die Vereinigung im Abgleich sollten
  einen bekommen — beides ist DOM-frei prüfbar.

---

## 7. Reihenfolge

| Stufe | Inhalt | Stand |
|---|---|---|
| **1** | `plaene[]` + `aktivId` + Kompatibilitäts-Getter + Migration + Blattleiste + Zeichenfilter; Abgleich und Übernahme über alle aktiven Blätter | **gebaut** |
| **2** | Rolle `archiv`, „als neuen Stand laden", Markierungen übertragen, Bild verwerfen | **gebaut** |
| **3** | Übergangsknoten für blattübergreifende Kabel | offen |
| **4** | Delta-Ansicht alter/neuer Stand (was ist dazugekommen, was ist weg) | offen |

Stufe 2 ist der Anlass, Stufe 1 die Voraussetzung dafür.

---

## 8. Entscheidungen

1. **`pdApply` über alle aktiven Blätter oder nur über das sichtbare?**
   → **alle aktiven Blätter**, umgesetzt. Die Meldung nennt die Zahl der Blätter,
   damit „3 Kabel" nicht wie das Ergebnis eines einzelnen Blattes gelesen wird.
   Ein Schalter für blattweises Übernehmen ist bewusst nicht gebaut — er wäre
   nachrüstbar, sobald sich beim Abarbeiten großer Planwerke zeigt, dass er fehlt.
2. **JPEG als Standard für gerasterte Blätter?** → **offen, weiter PNG.** Statt der
   Qualitätsfrage vorzugreifen zeigt die Blattleiste jetzt den Platzbedarf je Blatt
   und in Summe; damit lässt sich am realen Planwerk entscheiden, ob es überhaupt
   drückt. PDF-Blätter mit Textebene wären davon ohnehin nicht betroffen.
3. **Archivblätter mit oder ohne Bild speichern?** → **Wahl beim Blatt**, umgesetzt
   als „Bild verwerfen, Marken behalten" (nur für Archivblätter, mit Rückfrage).
   Ein Blatt ohne Bild behält seine Ausdehnung, damit die Marken an ihrer Stelle
   liegen bleiben.
