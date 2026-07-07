# Windpotentiale auslegen, ermitteln und empfehlen

*Interner Wiki-Leitfaden · Stand: 2026-07-07*

Dieser Artikel erklärt, **wie man das Windpotential einer Liegenschaft ermittelt, eine
Anlage auslegt und eine belastbare Empfehlung ableitet** — und zwar genau entlang der
Rechenwege, die in der **Windanalyse des Tools** (Panel „🌬 Windanalyse") stecken. Er ist
gedacht für Planer:innen, die verstehen wollen, *was das Tool tut, warum, und wo die
Grenzen liegen*.

> **Leitprinzip (wie überall im Tool):** Das Tool *schätzt und schlägt vor*, der Mensch
> *entscheidet*. Jede Zahl hier ist eine **Screening-Größe** — gut genug, um Standorte zu
> vergleichen und Größenordnungen zu finden, aber **kein Ersatz für ein
> Standortwindgutachten** und keine Genehmigungsgrundlage.

---

## 0. Der Weg in drei Schritten

Windpotential wird im Tool in drei aufeinander aufbauenden Schritten bearbeitet. Dieselbe
Reihenfolge gilt fachlich auch ohne Tool:

| Schritt | Frage | Tool-Baustein | Kapitel |
|---|---|---|---|
| **1. Ermitteln** | Wie viel Wind hat der Standort? | Standort-Winddaten (ERA5) | [Kap. 2](#2-ermitteln--wie-viel-wind-hat-der-standort) |
| **2. Auslegen** | Was macht eine Anlage daraus? | Ertragsmodell + Szenarien | [Kap. 3](#3-auslegen--was-macht-eine-anlage-aus-dem-wind) |
| **3. Empfehlen** | Wie viele Anlagen passen, was empfehlen wir? | Eignungsfläche + Platzierung | [Kap. 4](#4-empfehlen--flaeche-anlagenzahl-und-variantenwahl) |

---

## 1. Grundlagen: die vier physikalischen Hebel

Bevor es ums Tool geht — die vier Größen, aus denen sich *jeder* Windertrag zusammensetzt.
Wer diese versteht, kann jede Zahl im Panel einordnen.

### 1.1 Der Wind steckt in der dritten Potenz

Die im Wind enthaltene Leistung wächst mit der **dritten Potenz der Windgeschwindigkeit**:

```
P_Wind  ∝  ½ · ρ · A · v³
```

- `ρ` — Luftdichte (~1,225 kg/m³)
- `A` — überstrichene Rotorfläche = π·(D/2)²
- `v` — Windgeschwindigkeit

Die Konsequenz ist die wichtigste Faustregel überhaupt: **10 % mehr Wind ≈ 33 % mehr
Energie.** Deshalb entscheidet der Standortwind (und die Nabenhöhe, die ihn erschließt)
über Erfolg oder Misserfolg — viel stärker als jedes andere Detail. Im Tool bildet die
Funktion `turbinePowerKw()` (in [`src/13q-wind-ertrag.js`](../src/13q-wind-ertrag.js))
genau diesen kubischen Anstieg zwischen Ein- und Nennwind nach.

### 1.2 Die Leistungskurve der Anlage (cut-in / Nenn / cut-out)

Eine echte Turbine folgt dem `v³`-Gesetz nur in einem Fenster. Das Tool beschreibt die
Kennlinie mit **drei Windgeschwindigkeiten**:

| Größe | Feld im Inspector | Default | Bedeutung |
|---|---|---|---|
| **Einschaltwind** (cut-in) | `Einschaltwind (m/s)` | 3 m/s | darunter dreht die Anlage nicht |
| **Nennwind** (rated) | `Nennwind (m/s)` | 12 m/s | ab hier volle Nennleistung |
| **Abschaltwind** (cut-out) | `Abschaltwind (m/s)` | 25 m/s | darüber Sturmabschaltung |

Das Tool-Modell (bewusst vereinfacht, ohne Herstellerkennlinie):

```
              0                              für v < cut-in oder v > cut-out
P(v)  =   P_nenn · (v³ − v_ein³)/(v_nenn³ − v_ein³)   zwischen cut-in und Nennwind
              P_nenn                         zwischen Nennwind und cut-out
```

> Für Genehmigungsunterlagen ist die **reale Leistungskurve des Herstellers** einzusetzen —
> das generische Modell dient dem Vergleich, nicht dem Nachweis.

### 1.3 Die Weibull-Verteilung: aus Mittelwind wird ein Ertrag

Ein Standort hat nicht *eine* Windgeschwindigkeit, sondern eine **Häufigkeitsverteilung**:
viele schwache Stunden, wenige starke. Diese wird mit der **Weibull-Verteilung**
beschrieben, charakterisiert durch zwei Parameter:

- **Mittelwind `v̄`** — der Jahresmittelwert (auf Nabenhöhe).
- **Formfaktor `k`** — wie „konzentriert" die Verteilung ist. `k = 2` (= Rayleigh-
  Verteilung) ist der übliche Binnenland-Default; höhere Werte = gleichmäßigerer Wind.

Aus Mittelwind und Formfaktor ergibt sich der **Skalenparameter `A`**:

```
A  =  v̄ / Γ(1 + 1/k)
```

(`Γ` = Gammafunktion, im Tool über die Lanczos-Näherung.) Der Jahresertrag ist dann das
**Integral aus Windhäufigkeit × Leistungskurve** über alle Windgeschwindigkeiten — das Tool
rechnet es numerisch in 0,1-m/s-Schritten (`computeWindYield()`).

> **Warum das zählt:** Zwei Standorte mit *gleichem Mittelwind* können unterschiedlich viel
> liefern, wenn ihre Verteilung (`k`) verschieden ist. Deshalb ermittelt das Tool `k` aus
> echten Daten (s. Kap. 2), statt pauschal 2 anzunehmen.

### 1.4 Die Nabenhöhe erschließt den Wind (Hellmann-Gesetz)

Wind wird mit der Höhe stärker (weniger Bodenreibung). Das **Hellmann-Potenzgesetz**
rechnet den Mittelwind von einer Referenzhöhe auf jede Nabenhöhe um:

```
v(h)  =  v_ref · (h / h_ref)^α
```

Der **Hellmann-Exponent `α`** beschreibt die Rauigkeit des Geländes:

| α | Gelände |
|---|---|
| ~0,10 | offene See, glatte Flächen |
| ~0,20 | offenes Binnenland (Tool-Default) |
| ~0,30 | Dörfer, Hecken, Waldnähe |
| ~0,40+ | Wald, Stadt |

Da der Ertrag kubisch am Wind hängt, ist **Höhe bares Geld**: Von 100 m auf 150 m bringt
bei α = 0,2 rund `(150/100)^0,2 ≈ 8 %` mehr Wind — und damit grob **25 % mehr Energie**.
Das Tool nutzt `α` an zwei Stellen: um den Standortwind auf die jeweilige Nabenhöhe
umzurechnen und um die Szenarien mit abweichender Höhe fair zu vergleichen.

---

## 2. Ermitteln — wie viel Wind hat der Standort?

**Ziel dieses Schritts:** die drei Kennwerte `v̄₁₀₀`, `k` und `α` für die Liegenschaft
bestimmen. Alles Weitere leitet sich daraus ab.

### 2.1 Datenquelle: ERA5-Reanalyse über Open-Meteo

Das Tool lädt auf Knopfdruck (`🌐 Winddaten laden`) eine **stündliche Windzeitreihe** vom
Open-Meteo-Archiv (ERA5-Reanalyse, CC-BY 4.0). Abgerufen werden `wind_speed_10m` und
`wind_speed_100m` über 1–5 volle Kalenderjahre (Default 3). Koordinatenquelle in dieser
Priorität:

1. **Windgebiet-Mitte** (falls ein eigenes Windgebiet gezeichnet wurde),
2. sonst **Plangebiet-Mitte**,
3. sonst **Kartenmitte**.

> **Wichtige Einordnung:** ERA5 ist ein **~25-km-Raster-Modell**. Es bildet die großräumige
> Windhöffigkeit gut ab (ideal fürs Screening und den Standortvergleich), **kennt aber keine
> lokalen Effekte** — Waldkanten, Kuppen, Geländeabschattung fehlen. Es **ersetzt kein
> Standortwindgutachten** (MetMast / LiDAR-Messung).

### 2.2 Was das Tool aus den Daten berechnet

Aus der Zeitreihe (`fetchWindSiteData()`) werden vier Dinge ermittelt:

| Kennwert | Herleitung im Tool | Anzeige im Panel |
|---|---|---|
| **Mittelwind 100 m** `v̄₁₀₀` | arithmetisches Mittel aller `wind_speed_100m`-Stunden | `Ø … m/s (100 m)` |
| **Weibull-`k`** | Momentenmethode: `k = (σ/v̄)^−1,086`, begrenzt auf 1,2 … 4,0 | `Weibull-k …` |
| **Hellmann-`α`** | `α = ln(v̄₁₀₀ / v̄₁₀) / ln(10)`, begrenzt auf 0,10 … 0,45 | `Hellmann-α …` |
| **8760-h-Stundenreihe** | reales letztes Kalenderjahr, auf 100 m | intern, für Profile |

Der Formfaktor kommt also aus der **Streuung** der echten Stunden (σ/v̄ = Variations-
koeffizient), der Höhenexponent aus dem **Verhältnis 10 m ↔ 100 m** — beides
standortspezifisch statt pauschal.

### 2.3 Zwei Betriebsarten der Zeitprofile

Sobald Standortdaten geladen sind, ist das ein Schalter für das **ganze Tool**:

- **Mit Standortdaten:** Alle Zeitprofile (Asset-Inspector-Chart, NAP-, PV-, Knotenpunkt-
  Analyse) rechnen mit der **realen ERA5-Stundenreihe**, auf die jeweilige Nabenhöhe
  extrapoliert und durch die Leistungskurve geschickt (`windProfileForAsset()`).
- **Ohne Standortdaten:** Es wird ein **synthetisches Weibull-Profil** erzeugt — ein
  autokorrelierter Zufallsprozess (AR(1), bildet mehrstündige Flauten/Windphasen nach) mit
  deutscher Winter/Sommer-Saisonalität, normiert auf den analytischen Jahresertrag.

> **Empfehlung:** Für jede ernsthafte Auslegung **zuerst Winddaten laden**. Ohne sie sind
> Mittelwind und `k` reine Annahmen (Default 6,0 m/s / k 2).

### 2.4 „Kennwerte übernehmen"

Der Button `→ Kennwerte auf alle Windkraftanlagen übernehmen` schreibt `v̄` (auf die
**jeweilige Nabenhöhe** per Hellmann umgerechnet) und `k` in jede Anlage. So rechnen alle
Anlagen konsistent mit demselben, gemessenen Standortwind.

---

## 3. Auslegen — was macht eine Anlage aus dem Wind?

**Ziel:** aus Standortwind + Anlagenkennwerten die drei Ertragskennzahlen berechnen und
verschiedene Anlagengrößen fair vergleichen.

### 3.1 Die drei Ertragskennzahlen

`computeWindYield()` liefert je Anlage:

| Kennzahl | Formel | Aussage |
|---|---|---|
| **Jahresertrag** `MWh/a` | ∫ Weibull(v) · P(v) dv · 8760 h | die eigentliche Energieausbeute |
| **Volllaststunden** `Vlh` | Jahresertrag / Nennleistung | Standortgüte in Stunden (Binnenland grob 1.500–2.500 Vlh) |
| **Kapazitätsfaktor** `KF %` | Vlh / 8760 h | derselbe Wert als Anteil (grob 17–29 %) |

Zusätzlich die **spezifische Flächenleistung** `P_nenn / Rotorfläche` in W/m². Dieser Wert
ist der „Charakter" der Anlage: **niedrige** W/m² (großer Rotor je kW) = viele Volllast-
stunden, gut für **Schwachwind-Binnenland**; **hohe** W/m² = ertragsstark nur bei viel Wind.

### 3.2 Die Kennwerte je Anlage (Inspector)

Im Asset-Inspector einer Windkraftanlage stehen:

| Feld | Default | Rolle |
|---|---|---|
| Nennleistung (kW) | 500 | Skaliert den Ertrag linear |
| Nabenhöhe (m) | 100 | erschließt den Wind (Hellmann) |
| Rotordurchmesser (m) | 60 | Rotorfläche → spez. Flächenleistung, Gesamthöhe |
| Einschalt-/Nenn-/Abschaltwind | 3 / 12 / 25 | Leistungskurve (Kap. 1.2) |
| Ø Windgeschw. Nabenhöhe | 6,0 | Standortwind (aus ERA5 übernehmbar) |
| Weibull-k | 2,0 | Verteilungsform (aus ERA5 übernehmbar) |
| Planungsabstand ×Ø Rotor | 5 | Abstandsradius (Kap. 4) |

**Gesamthöhe = Nabenhöhe + Rotordurchmesser/2** — die zentrale Genehmigungsgröße. Das Tool
färbt sie grün bei ≤ 50 m, sonst gelb (s. 3.3).

### 3.3 Der Szenarien-Vergleich (drei Auslegungsvarianten)

Für jede Anlage rechnet `computeWindScenarios()` automatisch drei Varianten. Alle behalten
die **Kennlinie und die spezifische Flächenleistung** der konfigurierten Anlage bei — nur
Größe/Höhe variieren:

1. **≤ 50 m Gesamthöhe** — Nabenhöhe wird so gekappt, dass die Gesamthöhe unter 50 m bleibt
   (`50 − Rotor/2`). Hintergrund: Anlagen bis 50 m Gesamthöhe unterliegen in mehreren
   Bundesländern **erleichterten Genehmigungswegen**. Zeigt, was „genehmigungsarm" möglich
   ist. (Grün markiert.)
2. **Bedarfsgerecht (Liegenschaft)** — die Nennleistung wird so skaliert, dass der
   **Jahresertrag ≈ dem Jahresstrombedarf** der Liegenschaft entspricht (Ertrag skaliert
   linear mit der Nennleistung). Zeigt die „passende" Anlagengröße für Eigenverbrauch.
3. **Maximal möglich** — das Minimum aus **Flächenlimit** (aus dem Abstand zur
   Plangebietsgrenze zurückgerechnet) und **Marktobergrenze** (aktuell ~6.000 kW / 162 m
   Rotor). Zeigt die technische Obergrenze am Standort.

> Diese drei Varianten sind die typischen Gesprächsanker mit dem Liegenschaftseigentümer:
> *genehmigungsarm* ↔ *eigenbedarfsdeckend* ↔ *maximaler Beitrag*.

### 3.4 Nebengröße: Schallleistungspegel

`calcWindLwaAuto()` schätzt aus der Nennleistung grob einen Schallleistungspegel
(`82 + 7·log₁₀(kW)`, gedeckelt 90–107 dB(A)). Das ist ein **grober Startwert** für die erste
Abstandsdiskussion — **kein Ersatz für Herstellerangabe oder Schallgutachten**, die für die
TA-Lärm-Prüfung nötig sind.

---

## 4. Empfehlen — Fläche, Anlagenzahl und Variantenwahl

**Ziel:** Wie viele Anlagen welcher Größe passen realistisch ins Gebiet — und welche
Variante empfehlen wir?

### 4.1 Das Eignungsflächen-Raster

`computeSuitabilityGrid()` (in [`src/13s-wind-flaeche.js`](../src/13s-wind-flaeche.js))
rastert das Gebiet (Default 20 m) und markiert jede Zelle als **geeignet**, wenn sie:

1. **innerhalb** des Windgebiets/Plangebiets liegt,
2. mindestens **`boundaryM`** von der Gebietsgrenze entfernt ist, **und**
3. mindestens **`radiusM`** von *jedem* Gebäude entfernt ist.

Der Clou sind die **zwei getrennten Abstände**:

- **Planungsabstand `radiusM` = Planungsabstand-Multiplikator × Rotordurchmesser** (Default
  5×Ø). Gilt **zu Wohnbebauung/Gebäuden und zwischen den Anlagen untereinander** — die
  Faustregel für Immissionsschutz und Abschattung.
- **Grenzabstand `boundaryM` ≈ Kipphöhe (≈ Gesamthöhe)**. Zur reinen *Gebietsgrenze* reicht
  physikalisch die Kipphöhe, nicht der volle Planungsabstand.

> **Warum diese Trennung wichtig ist:** Würde man auch zur Gebietsgrenze den vollen 5×Ø-
> Abstand ansetzen, schrumpft die nutzbare Fläche dramatisch und die Anlagenzahl wird massiv
> unterschätzt. Die Trennung ist **am Windpark Rosengarten II validiert** (2 reale Anlagen
> auf ~150–240 ha).

Die geeignete Fläche wird im Inspector über „Eignungsfläche auf Karte anzeigen" eingeblendet
und in ha in der Windanalyse-Karte je Anlage berichtet.

### 4.2 Platzierungsvorschläge

`computeTurbinePlacements()` wählt aus dem (feineren) Eignungsraster **greedy** Standorte,
die untereinander mindestens den Planungsabstand einhalten. Das ist bewusst **kein echtes
Packungsoptimum** (keine Kreispackung), sondern eine schnelle, robuste Näherung für die
Standort-Übersicht. Bereits vorhandene Anlagen werden als **Ausschlusskreise** behandelt, so
dass Vorschläge nicht an Bestandsanlagen heranrücken.

### 4.3 Die drei Anlagenklassen

Im Panel werden drei marktübliche Klassen gegeneinander gerechnet:

| Klasse | Nennleistung | Rotor-Ø | Nabenhöhe | Gesamthöhe |
|---|---|---|---|---|
| **Klein** | 150 kW | 30 m | 35 m | 50 m (genehmigungsarm) |
| **Mittel** | 500 kW | 60 m | 100 m | 130 m |
| **Groß** | 4.200 kW | 140 m | 150 m | 220 m |

Für jede Klasse zeigt das Panel: **Anzahl gefundener Standorte × Ertrag je Anlage →
Gesamt-MW und Gesamt-MWh/a**. Der Mittelwind wird dabei je Klasse auf ihre Nabenhöhe
umgerechnet (Hellmann), damit die 35-m-Kleinanlage nicht mit dem 150-m-Wind gerechnet wird.
Über „→ übernehmen" werden echte, danach frei editierbare Anlagen an den Vorschlagspunkten
angelegt.

### 4.4 Wie man daraus eine Empfehlung formt

Die Empfehlung ist immer ein **Abwägen von drei Achsen**, die das Tool sichtbar macht:

1. **Ertrag / Beitrag** — Gesamt-MWh/a je Variante (Kap. 4.3) gegen den Liegenschafts­bedarf
   (Header-Kachel „Liegenschaftsbedarf") halten.
2. **Genehmigbarkeit** — Gesamthöhe (grün ≤ 50 m), Abstände, Anlagenzahl. Kleine Klasse =
   niedrige Hürde, kleiner Beitrag; große Klasse = umgekehrt.
3. **Standortgüte** — Volllaststunden/Kapazitätsfaktor: unter ~1.500 Vlh wird es
   wirtschaftlich kritisch, das ist ein Warnsignal für den Standort insgesamt.

Eine gute Tool-gestützte Empfehlung nennt typischerweise **zwei Varianten**: die
*genehmigungsarme* (Klein/≤50 m) als sichere Untergrenze und die *bedarfs- oder
flächenoptimale* (Mittel/Groß) als Zielbild — jeweils mit Anlagenzahl, Gesamtleistung,
Jahresertrag und dem Hinweis auf die nötige Einzelfallprüfung.

---

## 5. Grenzen & Vorbehalte (immer mitkommunizieren)

Das Tool ist ein **Screening-Werkzeug**. Was es *nicht* leistet und in einer Empfehlung
ausdrücklich unter Vorbehalt zu stellen ist:

- **Kein Windgutachten.** ERA5 ist ein 25-km-Raster ohne lokale Topografie. Der reale
  Standortwind kann deutlich abweichen — nur eine Messung (MetMast/LiDAR) ist belastbar.
- **Keine Herstellerkennlinie.** Die generische `v³`-Kurve über-/unterschätzt reale Anlagen.
- **Keine Genehmigungsprüfung.** Abstände sind Faustregeln (×Ø, Kipphöhe), **keine**
  Einzelfallprüfung nach BImSchG, TA-Lärm, Artenschutz, Denkmalschutz, Drehfunk/Radar,
  Abstandsflächenrecht oder landesspezifischen Mindestabständen (z. B. 1000-m-Regeln).
- **Keine Netz-/Einspeiseprüfung** an dieser Stelle — die läuft über die separate
  Netz-/Knotenpunkt-Analyse.
- **Platzierung ist Näherung** (Greedy-Raster), kein Packungsoptimum.
- **Schallwert ist Schätzung** aus der Nennleistung, kein Schallgutachten.

> **Merksatz für Berichte:** „Alle Windzahlen sind Screening-Größen zur Standortbewertung und
> zum Variantenvergleich; für Auslegung und Genehmigung sind Standortwindgutachten,
> Herstellerkennlinien und die fachrechtliche Einzelfallprüfung maßgeblich."

---

## 6. Kurz-Workflow im Tool (Checkliste)

1. **Gebiet festlegen** — optional eigenes Windgebiet zeichnen (`🗺 Eigenes Windgebiet
   zeichnen`), sonst gilt das Plangebiet.
2. **Winddaten laden** — `🌐 Winddaten laden`; `v̄₁₀₀`, `k`, `α` prüfen. Jahre 1–5 wählen.
3. **Platzierungsvorschläge** ansehen — Ø-Wind und Planungsabstand ×Ø ggf. anpassen; die drei
   Klassen (Klein/Mittel/Groß) mit Anzahl × Ertrag vergleichen.
4. **Variante übernehmen** — passende Klasse per „→ übernehmen" als echte Anlagen anlegen.
5. **Feinjustage je Anlage** im Inspector — Nabenhöhe/Rotor/Leistung/Kennlinie; Eignungs-
   fläche einblenden; Szenarien-Vergleich (≤50 m / Bedarf / Max) lesen.
6. **Kennwerte übernehmen** — falls Anlagen zuerst angelegt wurden: ERA5-Werte per
   `→ Kennwerte übernehmen` auf alle Anlagen schreiben.
7. **Empfehlung formulieren** — zwei Varianten (genehmigungsarm ↔ Zielbild) mit Anzahl,
   MW, MWh/a und dem Vorbehalt aus Kap. 5.

---

## 7. Formel- & Kennzahlen-Glossar

| Größe | Formel / Wert | Quelle im Code |
|---|---|---|
| Windleistung | `P ∝ ½ ρ A v³` | Prinzip |
| Leistungskurve | `P = P_nenn·(v³−v_ein³)/(v_nenn³−v_ein³)` | `turbinePowerKw()` |
| Weibull-Skala | `A = v̄ / Γ(1+1/k)` | `weibullScaleFromMean()` |
| Weibull-Dichte | `f(v) = (k/A)(v/A)^{k−1} e^{−(v/A)^k}` | `weibullPdf()` |
| Jahresertrag | `∫ f(v)·P(v) dv · 8760` | `computeWindYield()` |
| Volllaststunden | `Jahresertrag / P_nenn` | `computeWindYield()` |
| Kapazitätsfaktor | `Vlh / 8760` | `computeWindYield()` |
| spez. Flächenleistung | `P_nenn / (π·(D/2)²)` | `computeWindYield()` |
| Höhenformel (Hellmann) | `v(h) = v_ref·(h/h_ref)^α` | `windSiteVAtHeight()` |
| Weibull-k aus Daten | `k = (σ/v̄)^{−1,086}`, [1,2 … 4] | `fetchWindSiteData()` |
| Hellmann-α aus Daten | `α = ln(v̄₁₀₀/v̄₁₀)/ln(10)`, [0,10 … 0,45] | `fetchWindSiteData()` |
| Schallpegel (grob) | `82 + 7·log₁₀(kW)`, [90 … 107] dB(A) | `calcWindLwaAuto()` |
| Gesamthöhe | `Nabenhöhe + Rotor/2` | überall |
| Planungsabstand | `Multiplikator × Rotor-Ø` (Default 5×) | `13s`, Inspector |
| Grenzabstand | `≈ Kipphöhe ≈ Gesamthöhe` | `computeSuitabilityGrid()` |

**Relevante Dateien:** [`src/13q-wind-ertrag.js`](../src/13q-wind-ertrag.js) (Ertrag,
Weibull, Standortdaten, Profile) · [`src/13s-wind-flaeche.js`](../src/13s-wind-flaeche.js)
(Eignungsfläche, Platzierung) · [`src/13t-wind-analyse.js`](../src/13t-wind-analyse.js)
(Panel/Workflow) · [`src/13e-assets-inspector.js`](../src/13e-assets-inspector.js)
(Anlagen-Inspector).
