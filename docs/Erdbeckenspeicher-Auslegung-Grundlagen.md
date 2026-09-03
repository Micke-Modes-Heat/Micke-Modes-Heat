# Langzeit-/Saisonalspeicher — Grundlagen und Einbindung ins Tool

*Teil A erklärt, wie die Auslegung eines Erdbeckenspeichers (PTES) fachlich funktioniert.
Teil B beschreibt, was das für Micke-Heat konkret bedeutet — welche Stellen im Rechenkern
dafür nicht taugen und in welcher Reihenfolge man sie umbaut.*

> **Status:** Konzeptpapier, noch keine Implementierung. Alle Zahlenwerte sind
> **Planungsansätze für die Vorplanung (LP 1–2)** und als Kalibrierwerte gedacht —
> vor produktivem Einsatz gegen eine aktuelle Quelle (PlanEnergi / SDH-Guidelines /
> AGFW) prüfen. Für die Entwurfsplanung ersetzt das kein dynamisches
> Speichersimulationsmodell und keine Baugrunduntersuchung.

---

## Teil A — Wie die Auslegung funktioniert

## A1. Der Unterschied in einem Satz

> Ein **Pufferspeicher** wird nach **Leistung** ausgelegt (wie viele Stunden Erzeuger-
> leistung will ich überbrücken), ein **Saisonalspeicher** nach **Energie-Bilanz**
> (wie viel Wärme muss ich vom Sommer in den Winter schieben).

Das ist der ganze Denkschritt — und genau der, den das Tool heute nicht macht.
Die aktuelle Automatik rechnet auch für den Typ „saisonal" nach dem Puffer-Muster
(`_autoSpeicherVolumen`, `src/06b-gl-berechnen.js:670`):

```
Volumen = WP-Leistung × 48 h / (1,16 × ΔT)
```

Bei 1.000 kW WP sind das ~1.400 m³. Ein echter Erdbeckenspeicher für dieselbe Anlage
liegt bei **20.000–100.000 m³**. Die Automatik liegt also nicht ein bisschen daneben,
sondern rund **1,5 Größenordnungen** — weil sie die falsche Frage beantwortet.

---

## A2. Das mentale Modell: die Summenlinie

Der Saisonalspeicher lebt von einer einzigen Kurve. Man bildet über das Jahr die
stündliche Differenz aus **billig verfügbarer Wärme** und **Bedarf**:

```
   Überschuss (Sommer)                            Defizit (Winter)
   ST-Ertrag über Bedarf                          Bedarf über billige Erzeugung
   WP bei COP 4,5 statt 2,5                       WP bei COP 2,5, Spitzenkessel
   PV-Überschuss / billige Börsenstunden          teure/emissionsintensive Stunden
        │                                              │
        └──────────────►  Summenlinie S(t) = Σ (Überschuss − Defizit)  ◄──────┘

   erforderliche Netto-Kapazität  =  max S(t) − min S(t)
```

Das ist das **Rippl-Verfahren** (Summenlinienverfahren aus der Talsperrenbemessung).
Es beantwortet exakt die Auslegungsfrage: *Wie viel Speicher brauche ich, damit der
Überschuss aus der Überschusszeit bis in die Defizitzeit reicht?*

Praktisch:

1. Dispatch **ohne** Langzeitspeicher fahren → stündliche Residuallast, ST-Überschuss,
   WP-Reserven, COP-Profil liegen vor (das kann der Kern heute schon).
2. Stündliche Reihe „Überschusspotenzial" bilden: was könnte in dieser Stunde billig
   erzeugt werden, wird aber nicht gebraucht.
3. Summenlinie bilden, **max − min** ablesen → Netto-Kapazität in kWh.
4. Verluste aufschlagen (siehe A5) — iterativ, weil der Verlustanteil selbst vom
   Volumen abhängt. 2–3 Iterationen reichen.
5. In Volumen umrechnen (A4), gegen die **verfügbare Fläche** prüfen (A7).

Die Kurve hat als Nebenprodukt genau die Größe, die man für die Fahrweise braucht:
den **Soll-Füllstandsverlauf über das Jahr** (siehe B4).

---

## A3. Temperaturniveaus — die eigentliche Auslegungsgröße

Ein Erdbecken ist geschichtet: oben heiß, unten kalt. Nutzbar ist nur die Spreizung,
die man wirklich fahren kann:

| Größe | typisch | Anmerkung |
|---|---|---|
| Ladetemperatur oben | 80–90 °C | begrenzt durch Liner/Deckel-Material |
| Entladetemperatur unten **ohne** Entlade-WP | = Netzrücklauf, ~40–50 °C | tiefer geht nicht, der Speicher kann nicht mehr einspeisen |
| Entladetemperatur unten **mit** Entlade-WP | 10–20 °C | die WP hebt das Restniveau aufs Netz |
| ΔT nutzbar ohne WP | **40–50 K** | |
| ΔT nutzbar mit WP | **60–75 K** | ≈ +50 % Kapazität aus demselben Loch |
| Schichtungsgüte f_schicht | 0,85–0,90 | reale Vermischung |

**Das ist die wichtigste Erkenntnis für die Modellierung:** Die Entlade-Wärmepumpe ist
kein Zubehör, sondern verändert die nutzbare Kapazität um ~50 % und ist gleichzeitig ein
erheblicher Strom- und Kostenposten. Ein Modell ohne sie überschätzt den Ertrag
systematisch — oder unterschätzt das nötige Volumen um denselben Faktor.

Ein niedriges Netz-Temperaturniveau ist für den Saisonalspeicher also doppelt wertvoll:
mehr nutzbare Spreizung **und** weniger Verluste. Das koppelt die Speicherauslegung an
die Netzauslegung (`gl-*`-Vorlauftemperatur) — im Tool bereits vorhanden und nutzbar.

---

## A4. Kapazität und Geometrie

```
Kapazität [kWh]  =  V [m³] × 1,16 × ΔT_nutzbar [K] × f_schicht
```

Der Faktor 1,16 (= ρ·c/3600) stimmt im Tool bereits. Zu ergänzen sind **ΔT_nutzbar aus
den Temperaturniveaus** statt eines freien Eingabefeldes und **f_schicht**.

Geometrie: umgekehrter Pyramidenstumpf, Böschung 1:2, Tiefe 10–16 m (nach oben durch
den **Grundwasserstand** begrenzt — das ist meist die harte Randbedingung, nicht die
Statik).

| Volumen | Tiefe | Deckelfläche | Bruttofläche inkl. Randweg |
|---|---|---|---|
| 10.000 m³ | 10 m | ~2.500 m² | ~0,35 ha |
| 50.000 m³ | 15 m | ~7.200 m² | ~0,95 ha |
| 100.000 m³ | 15 m | ~12.000 m² | ~1,5 ha |

Faustformel: **Deckelfläche ≈ V/4** (kleine, flache Becken) bis **V/7** (große, tiefe),
plus 20–30 % für Randweg und Technikfläche. Der Deckel ist gleichzeitig der teuerste
Einzelposten und der Verlustpfad Nr. 1 — deshalb ist **tief und groß immer besser**.

---

## A5. Verluste — warum ein U·A-Modell hier falsch ist

Naheliegend wäre `Q̇_verlust = U · A · (T_Speicher − T_Erdreich)`. Das ist für den
**Deckel** richtig (gedämmt, gegen Außenluft), für **Boden und Böschung** aber falsch:
Das umgebende Erdreich heizt sich über die ersten Betriebsjahre mit auf und wird selbst
Teil des Speichers. Ein stationärer U·A-Ansatz rechnet deshalb Verluste heraus, die real
nicht auftreten — in einer Überschlagsrechnung leicht um den Faktor 3.

Praxistauglich für ein Planungswerkzeug ist ein **kalibrierter, volumenabhängiger
Jahresverlustanteil**, weil die Oberfläche mit V^(2/3), das Volumen aber mit V^1 wächst:

```
Jahresverlustanteil  ≈  5,3 × V^(−1/3)      (V in m³, Anteil der eingespeicherten Wärme)
```

| Volumen | Verlustanteil |
|---|---|
| 10.000 m³ | ~25 % |
| 50.000 m³ | ~14 % |
| 200.000 m³ | ~9 % |

Angelehnt an die Betriebserfahrung dänischer Anlagen (Marstal, Dronninglund, Vojens),
die im Bereich 10–30 % liegen. **Der Skaleneffekt ist der Kern der Technologie** — und
genau das, was ein konstanter %/h-Ansatz nicht abbilden kann.

Innerhalb des Jahres verteilt man den Verlust proportional zur Übertemperatur
(also SOC-abhängig), sodass die Jahressumme den kalibrierten Anteil trifft:

```
Verlust(t) = k × (T_min + SOC(t)/Kap × ΔT_nutz − T_Erdreich)
```

`k` wird einmal außerhalb der Schleife so bestimmt, dass die Jahressumme passt.
Physik liefert die Form, die Kalibrierung das Niveau.

**Zum Vergleich der heutige Wert:** Preset „saisonal" = 0,02 %/h. Bei ~3.000 h
mittlerer Verweildauer sind das ~45 % Verlust — etwa **das Drei- bis Vierfache**
eines realen großen Erdbeckens. Größenordnung für ein großes PTES: **~0,005 %/h**.

---

## A6. Kosten — der größte Fehler im heutigen Modell

Kosten skalieren beim Erdbecken **nicht linear mit kWh**, sondern degressiv mit dem
Volumen (Erdbau, Liner, Deckel — alles Flächen- und Aushubgrößen):

```
Investition [€]  ≈  f_Standort × 1000 × V^0,7           (V in m³)
spezifisch       ≈  f_Standort × 1000 × V^(−0,3) €/m³
```

`f_Standort ≈ 1,3–1,6` für Deutschland gegenüber dänischem Referenzniveau
(Genehmigung, Baugrund, Lohnniveau).

| Volumen | €/m³ (DK-Niveau) | €/m³ (DE, f=1,4) | Investition (DE) |
|---|---|---|---|
| 10.000 m³ | ~63 | ~88 | ~0,9 Mio. € |
| 50.000 m³ | ~39 | ~55 | ~2,7 Mio. € |
| 200.000 m³ | ~26 | ~36 | ~7,2 Mio. € |

Dazu 15–25 % für Entlade-WP, Wärmetauscher, Pumpen, Anbindungsleitung,
Baugrunduntersuchung und Genehmigung.

**Jetzt der Abgleich mit dem Tool.** Heute (`src/07b-analysis-economics.js:485`):
`saisonal → 40 €/kWh`. Umgerechnet sind 1 m³ bei ΔT 45 K rund 52 kWh, also
**~2.090 €/m³**. Das ist der Ansatz für einen **Stahl-Pufferspeicher** (dort sind
60–100 €/kWh korrekt), nicht für ein ausgekleidetes Erdbecken.

> Für 50.000 m³ ergäbe das heutige Modell **~104 Mio. €** statt ~2,7 Mio. €
> — ein Faktor von rund **40**. Jede Wirtschaftlichkeitsrechnung mit einem
> Saisonalspeicher ist damit aktuell wertlos.

**Nutzungsdauern (VDI 2067)** — heute pauschal n = 20 für alles. Richtig ist eine
Aufteilung, weil das lange Leben des Erdbaus die halbe Wirtschaftlichkeit ausmacht:

| Komponente | n |
|---|---|
| Erdarbeiten / Becken | 40 a |
| Liner + Deckel | 20–25 a |
| Technik (WT, Pumpen, Entlade-WP) | 15–20 a |

---

## A7. Randbedingungen, die früh geprüft werden müssen

Beim Erdbeckenspeicher scheitert die Idee selten an der Rechnung, sondern an diesen
fünf Punkten. Sie gehören deshalb vor die Detailauslegung:

1. **Fläche.** 0,3–1,5 ha zusammenhängend, in Netznähe. Auf einer Liegenschaft die
   praktisch immer bindende Restriktion.
2. **Grundwasser.** Bestimmt die mögliche Tiefe und damit Fläche, Verluste und Kosten.
   Wasserrechtliche Erlaubnis erforderlich.
3. **Baugrund.** Aushub-Massenbilanz — wohin mit ~50.000 m³ Boden? Wall vor Ort
   (dann Höhenbeschränkung/Landschaftsbild prüfen) oder Abtransport (teuer).
4. **Netztemperatur.** Je niedriger der Rücklauf, desto größer die nutzbare Spreizung
   (A3). Ein 80/60-Bestandsnetz halbiert den Nutzen gegenüber einem 70/40-Netz.
5. **Wärmequelle im Sommer.** Ohne echten Sommerüberschuss (Solarthermie-Feld,
   PV-Überschuss, Abwärme, billige Netzstunden) hat der Speicher nichts einzulagern.
   **Das ist die Vorbedingung — Speicher zuerst, Quelle später funktioniert nicht.**

---

## A8. Plausibilitätsanker für das fertige Ergebnis

Wenn die Auslegung durchgelaufen ist, sollten diese Größen stimmen:

| Kennzahl | Erwartungsbereich |
|---|---|
| **Vollzyklen pro Jahr** | **1–2** (nicht 50–200 wie beim Puffer!) |
| Nutzbare Kapazität | 10–25 % des Jahreswärmebedarfs |
| Volumen je m² Kollektorfläche (solar) | 2–4 m³/m² für 40–50 % solare Deckung |
| Speichernutzungsgrad (entladen/geladen) | 70–90 % |
| Mittlere Verweildauer | 3–5 Monate |

Die Vollzyklenzahl ist der schnellste Test: Zeigt das Tool nach dem Umbau für ein
Erdbecken 30 Vollzyklen an, ist die Fahrweise noch die eines Puffers (siehe B4).

---

## Teil B — Einbindung in Micke-Heat

## B0. Zusammenfassung: was heute nicht passt

| # | Stelle | Problem | Auswirkung |
|---|---|---|---|
| 1 | `07b:485`, `07b:92` | 40 €/kWh statt degressiv €/m³ | Invest ~40× zu hoch |
| 2 | `06b:670` `_autoSpeicherVolumen` | Leistungs- statt Bilanzauslegung | Volumen ~30× zu klein |
| 3 | `06c:392` Verluste | konstant %/h, skaleninvariant | Skaleneffekt fehlt; Preset ~3–4× zu verlustreich |
| 4 | `06c:518/555` Fahrweise | gieriges Entladen, Ladefenster 8–18 h | Speicher ist im Oktober leer, nie ein Saisonzyklus |
| 5 | `06b:704` `getThermSpeicherParams` | ΔT als freies Feld | kein Temperaturniveau, keine Entlade-WP |
| 6 | `index.html:2570` | „saisonal" mischt Erdbecken und BTES | zwei sehr verschiedene Technologien in einem Preset |
| 7 | `07b:485` VDI | n = 20 pauschal | Erdbau-Lebensdauer verschenkt |
| 8 | `06b:777` Karte | Tiefe fest 8 m, keine Flächenprüfung | Flächenbedarf ~2× überzeichnet, keine Restriktionsprüfung |

Punkt **4 ist der fachlich schwerwiegendste**: Selbst mit korrektem Volumen, Verlust
und Preis liefert ein gieriger Merit-Order-Dispatch keinen Saisonspeicher, weil er
den Speicher beim ersten Kälteeinbruch im Herbst entleert.

---

## B1. Neues Modul `src/lib/langzeitspeicher.js`

Reine Funktionen, ohne DOM, ohne Closures — testbar und im Worker verwendbar:

```js
ptesGeometrie(vol, tiefe, boeschung)   → {grundflaeche, deckelflaeche, mantelflaeche, bruttoflaeche}
ptesKapazitaet({vol, tLade, tEntlade, fSchicht})     → {kapKwh, dTNutz}
ptesVerlustanteilA(vol)                → Jahresverlustanteil (A5)
ptesVerlustK(vol, kapKwh, ...)         → k für die Stundenformel
ptesInvest(vol, standortfaktor)        → {becken, liner, technik} (getrennt für VDI)
```

Dazu `tests/langzeitspeicher.test.js` mit den Ankerwerten aus A4–A6. Damit bleibt der
Rechenkern schlank und die Kalibrierwerte stehen an genau einer Stelle.

## B2. Speichertypen aufspalten

`index.html:2570`: `puffer | gross | erdbecken | btes | ates`. Erdbecken und BTES haben
unterschiedliche Leistungsgrenzen (BTES kann nur langsam laden/entladen), Verluste,
Kosten und ΔT — sie in einem Preset zu führen, produziert falsche Ergebnisse für beide.
Zunächst nur **Erdbecken** ausmodellieren, die anderen als Platzhalter mit Hinweis.

## B3. Verlustmodell im Dispatch

`src/06c-dispatch-core.js:392` — ein zusätzlicher Zweig, wenn `thSp.langzeit` gesetzt ist:

```js
const verlust = thSp.verlustK
  ? thSp.verlustK * (thSp.tMin + (thermSOC / thSp.kapKwh) * thSp.dTNutz - thSp.tErd)
  : thermSOC * thSp.verlustRate;
```

`verlustK` wird außerhalb berechnet. Eine Multiplikation mehr pro Stunde — kein
Performance-Thema, und `_dispatchCore` bleibt self-contained (Worker-Anforderung
aus der README).

## B4. Saisonale Fahrweise über ein Ziel-SOC-Band ← der Kern

Kein Perfect-Foresight-Optimierer im Worker. Stattdessen: die Summenlinie aus A2 liefert
ohnehin schon den Soll-Füllstandsverlauf. Diesen als `Float32Array(8760)` **außerhalb**
berechnen und über `speicherParams.zielSocH` hereinreichen. Im Kern dann zwei kleine
Änderungen:

- **Phase 3 (Entladen, `06c:518`):** nur bis zum Sollwert entladen
  `entladen = min(residual, SOC − zielSocH[t], entladeKw)`.
  Im Winter läuft `zielSocH` gegen 0, also volle Entladung; im Sommer ist es hoch,
  eine kühle Augustnacht leert den Speicher nicht mehr.
- **Phase 6 (Laden, `06c:555`):** Das Fenster `h >= 8 && h < 18` gilt nur für Puffer.
  Der Langzeitspeicher lädt, wann immer `SOC < zielSocH[t]` und eine billige Quelle
  Reserve hat.

Das ist einfach, deterministisch, einpassig, ohne Foresight im Kern — und erzeugt genau
das gewünschte Saisonverhalten.

## B5. Beladekriterium „billige Stunde"

Heute lädt der Speicher, wenn eine WP Reserve hat und es zwischen 8 und 18 Uhr ist. Für
den Saisonalspeicher ist das falsche Kriterium; richtig ist ein Merit-Signal je Stunde,
außerhalb vorberechnet: ST-Überschuss · PV-Überschuss · COP über Schwelle (Sommer) ·
niedriger Strompreis, falls eine Preisreihe vorliegt. Als `Float32Array`/Bitmaske
in `speicherParams` — im Kern bleibt es ein Lookup.

## B6. Entlade-Wärmepumpe

Erster Schritt bewusst klein: kein Umbau der Merit-Order, sondern ein
Strombedarf je entladener kWh aus einer COP-Annahme bei mittlerer Entladetemperatur,
plus Begrenzung der Entladeleistung. Damit sind Kapazitätsgewinn (A3) und Strom-/
Kostenwirkung erfasst. Volle Integration als eigener Erzeuger erst, wenn das steht.

## B7. Auslegungsassistent (das eigentliche Werkzeug)

Neue Funktion `ptesAuslegung()`, die für den Typ Erdbecken `_autoSpeicherVolumen`
ersetzt und das Verfahren aus A2 umsetzt: Dispatch ohne Speicher → Überschussreihe →
Summenlinie → max−min → Verlustaufschlag (2–3 Iterationen) → Volumen → Flächenprüfung.

Ausgabe als nachvollziehbares Auslegungsblatt: Volumen, Fläche, Tiefe, ΔT_nutzbar,
Kapazität, Investition, Vollzyklen, Speichernutzungsgrad, sommerlicher Deckungsanteil —
also genau die Anker aus A8, damit ein falsches Ergebnis sofort auffällt.

## B8. Kosten und VDI 2067

`07b:485` und `07b:92`: `ptesInvest()` statt linearem €/kWh, aufgeteilt in drei Posten
mit n = 40 / 25 / 20 (A6). Der `puffer`-Posten (`07b:517`) muss beim Langzeitspeicher
**erhalten bleiben** — ein Erdbecken übernimmt die hydraulische Entkopplung der
Heizzentrale gerade *nicht*, dafür braucht es weiterhin einen kleinen Pufferspeicher.
Die heutige `!thermSpeicherAktiv`-Bedingung ist für den Saisonalfall also falsch.

## B9. Karte und Flächenprüfung

`_drawErdbeckenSpeicher` (`06b:777`) zeichnet bereits die Haldenform — gute Grundlage.
Zu ergänzen: Tiefe als Parameter statt fest 8 m, das Polygon frei platzierbar, und eine
Prüfung gegen Gebäudepolygone und Restriktionsflächen. Für die Restriktionslogik gibt es
mit `src/13u-wind-restriktion.js` bereits ein übertragbares Muster. Da die Fläche auf
einer Liegenschaft die bindende Restriktion ist (A7), gehört dieser Check in den
Auslegungsassistenten, nicht nur in die Darstellung.

## B10. Optimierer

`10a`/`10d`: Das Volumenraster muss für den Saisonalfall einen anderen Bereich abdecken
(10³ vs. 10⁵ m³) — ein gemeinsames Raster taugt für keinen der beiden Fälle. Verlust-
und Kostenfunktion müssen in den Worker (Stringify-Constraint beachten).

## B11. Kennzahlen im Panel

`ts-zyklen` ist für ein Erdbecken die falsche Leitgröße. Ergänzen: Speichernutzungsgrad,
Verlustanteil, mittlere Verweildauer, Flächenbedarf, sommerlicher Deckungsanteil und
€/kWh_verschoben.

---

## B12. Vorschlag zur Reihenfolge

| Stufe | Inhalt | Nutzen |
|---|---|---|
| **1** | B1 + B2 + B8: Modul, Typtrennung, Kostenmodell | Der 40er-Fehler ist weg; Wirtschaftlichkeit wird belastbar — kein Eingriff in den Dispatch |
| **2** | B3 + B4: Verlustmodell + Ziel-SOC-Band | Der Speicher verhält sich saisonal; Skaleneffekt wirkt |
| **3** | B7 + B9: Auslegungsassistent + Flächenprüfung | Aus dem Modell wird ein Auslegungswerkzeug |
| **4** | B5 + B6 + B10 + B11: Beladekriterium, Entlade-WP, Optimierer, Kennzahlen | Feinschliff, Variantenvergleich |

Stufe 1 ist in sich abgeschlossen und ohne Risiko für den bestehenden Puffer-Pfad —
ein guter erster Schnitt.

---

## B13. Was ich bewusst nicht empfehle

- **Kein gemeinsames Modell für Puffer und Saisonalspeicher.** Die beiden werden nach
  verschiedenen Größen ausgelegt (A1). Ein Parametersatz, der beides abdecken soll,
  wird für beide falsch — das ist die Ursache der heutigen Befunde.
- **Kein 2D/3D-Erdreichmodell.** Für die Vorplanung ist die kalibrierte Kennlinie (A5)
  genauer als ein schlecht parametriertes Feldmodell, und um Größenordnungen billiger.
- **Keine vorausschauende Optimierung im Worker.** Das Ziel-SOC-Band (B4) liefert
  ~95 % des Nutzens bei einem Bruchteil der Komplexität und hält `_dispatchCore`
  stringify-fähig.
- **Kein BTES/ATES im selben Aufwasch.** Erst das Erdbecken sauber, dann übertragen.

---

## Quellenhinweis

Die Zahlenwerte orientieren sich an der Betriebs- und Kostenerfahrung dänischer
Erdbeckenspeicher (Marstal, Dronninglund, Vojens) und an den gängigen
Solar-District-Heating-Planungshilfen. Sie sind hier als **Kalibrierwerte für die
Vorplanung** gedacht und in `src/lib/langzeitspeicher.js` an einer Stelle zu halten,
damit sie gegen aktuelle Quellen nachgeführt werden können. Für die Entwurfsplanung
sind Baugrund- und Grundwassergutachten sowie eine dynamische Speichersimulation
erforderlich.
