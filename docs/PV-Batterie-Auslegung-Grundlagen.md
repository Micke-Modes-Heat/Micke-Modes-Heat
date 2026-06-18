# PV- und Batterie-Auslegung für Liegenschaften — eine kompakte Einführung

*Ziel dieses Dokuments: in einem Durchgang verstehen, worum es bei der PV-/Batterie-Auslegung
geht, welche Größen sich wie beeinflussen, und warum die einzelnen Varianten existieren.
Es ist zugleich das Begleitheft zur PV-Analyse im Tool.*

---

## 1. Das Grundproblem in einem Satz

> PV erzeugt **mittags und im Sommer** am meisten — der Verbrauch liegt oft **woanders**
> (abends, nachts, winters). Die ganze Auslegung ist die Kunst, **Erzeugung und Last
> zeitlich und leistungsmäßig in Einklang** zu bringen — unter wirtschaftlichen und
> netztechnischen Randbedingungen.

Alles Weitere sind nur Werkzeuge, um diese Lücke zu schließen: größere/kleinere PV, eine
Batterie, flexible Lasten, ein stärkerer Netzanschluss.

---

## 2. Das mentale Modell: vier Töpfe

Jede vom PV erzeugte Kilowattstunde landet in **genau einem** von vier Töpfen:

```
                    ┌─→  ① Direkter Eigenverbrauch   (wertvollste kWh: spart ~30 ct Bezug)
   PV-Erzeugung ────┼─→  ② Batterie  ──→ später ①    (Eigenverbrauch zeitversetzt)
                    ├─→  ③ Einspeisung               (~8 ct Vergütung oder Börsenpreis)
                    └─→  ④ Abregelung                (0 ct — verschenkt/abgeregelt)

   Bedarf  =  ① Eigenverbrauch  +  ⑤ Netzbezug       (~30 ct Bezugspreis)
```

**Die gesamte Optimierung besteht darin, kWh aus den schlechten Töpfen (③, ④, ⑤) in die
guten zu verschieben (①, ②).** Eine Batterie verschiebt von ③/④ nach ②→①. Eine größere PV
füllt zwar ① stärker, kippt den Überschuss aber zunehmend in ③/④.

> **Faustregel:** Selbst verbrauchte kWh ≈ **3–4× wertvoller** als eingespeiste
> (30 ct vermiedener Bezug vs. 8 ct Vergütung). Eigenverbrauch ist König.

---

## 3. Die zwei zentralen Kennzahlen — und warum sie gegenläufig sind

| Kennzahl | Bedeutung | Verhalten |
|---|---|---|
| **Eigenverbrauchsquote (EV-Quote)** | Anteil der **PV-Erzeugung**, der selbst verbraucht wird | **sinkt** mit PV-Größe |
| **Autarkiegrad** | Anteil des **Bedarfs**, der selbst gedeckt wird | **steigt** mit PV + Batterie |

Das ist der wichtigste Denkschritt:

- **Kleine Anlage** → fast alles wird selbst verbraucht (**EV-Quote hoch**), deckt aber nur
  einen kleinen Teil des Bedarfs (**Autarkie niedrig**).
- **Große Anlage** → deckt viel Bedarf (**Autarkie hoch**), aber ein großer Teil fließt
  ungenutzt ins Netz (**EV-Quote niedrig**).

Man kann **nicht beide gleichzeitig maximieren**. Welche man priorisiert, ist eine
*Zielentscheidung* — und genau das unterscheidet die Varianten (Abschnitt 7).

Weitere Größen: **Abregelungsquote** (Anteil, der am Einspeiselimit verloren geht),
**Rückspeisespitze** (max. Leistung Richtung Netz — netztechnisch entscheidend, Abschnitt 8).

---

## 4. Der wirtschaftliche Kern

Drei Zahlen bestimmen praktisch alles (Größenordnung, projektabhängig):

| Größe | typisch | Wirkung |
|---|---|---|
| Strom**bezugs**preis | ~30 ct/kWh | Wert jeder **selbst verbrauchten** kWh |
| **Einspeise**vergütung | ~7–8 ct/kWh (bzw. Börsenpreis) | Wert jeder **eingespeisten** kWh |
| Batterie-Invest | ~400 €/kWh, Lebensdauer ~15 a | Kosten der Zeitverschiebung |

Daraus folgt die ganze Logik:
- PV lohnt sich primär über **vermiedenen Bezug** (Eigenverbrauch), erst sekundär über
  Einspeisung.
- Eine Batterie lohnt sich, wenn sie genug kWh von „Einspeisung 8 ct" auf
  „Eigenverbrauch 30 ct" hebt, um ihre ~400 €/kWh über die Lebensdauer zu verdienen.
- **Bewertungsmaß:** nicht „möglichst viel Ertrag", sondern **maximaler jährlicher
  Netto-Überschuss** (Erlöse + Ersparnisse − alle Jahreskosten). Die Amortisationszeit ist
  eine gute Zusatz-Kennzahl, taugt aber **nicht** als alleiniges Auswahlkriterium (sie
  bevorzugt fälschlich Kleinstanlagen).

---

## 5. Die Hebel und ihre Wechselwirkungen

Was passiert, wenn ich an einer Schraube drehe?

| Wenn ich … erhöhe | … dann passiert |
|---|---|
| **PV-Leistung ↑** | Ertrag ↑, Autarkie ↑ — **aber** EV-Quote ↓, Einspeisung ↑, Abregelung ↑, Rückspeisespitze ↑ |
| **Batterie ↑** | EV-Quote ↑, Autarkie ↑ — **aber** Kosten ↑, Grenznutzen fällt schnell, Jahresspitze bleibt |
| **Last am Tag ↑** (Gewerbe, WP, E-Auto mittags) | EV-Quote ↑ **ohne** Batterie — der billigste Hebel überhaupt |
| **Einspeiselimit ↓** (Netz) | Abregelung ↑ — Batterie/kleinere PV nötig, um sie zu vermeiden |

Drei Abhängigkeiten, die man im Kopf haben muss:

1. **Das Lastprofil ist der heimliche Hauptfaktor.** Eine taglastige Liegenschaft
   (Büro, Produktion, Kühlung) passt von Natur aus gut zu PV → hohe EV-Quote *ohne*
   Batterie. Eine abend-/nachtlastige (Wohnen) braucht Speicher oder Lastverschiebung.
   → **Erst das echte Lastprofil besorgen**, inkl. neuer Lasten (Wärmepumpen, Ladesäulen).

2. **Lastflexibilität schlägt oft die Batterie.** Eine Wärmepumpe mit Pufferspeicher oder
   gesteuertes Mittags-Laden von E-Autos hebt den Eigenverbrauch zu **nahezu null
   Grenzkosten** — eine Batterie kostet 400 €/kWh. Flexibilität zuerst ausreizen.

3. **Der Netzanschluss begrenzt die Einspeisung.** Was nicht ins Netz darf, muss gespeichert,
   selbst verbraucht oder abgeregelt werden (Abschnitt 8).

---

## 6. Warum „mehr ist nicht besser" — die drei Sättigungen

Jeder Hebel hat einen **abnehmenden Grenznutzen**. Das Optimum liegt fast immer **vor**
dem Maximum:

- **PV sättigt:** Ab einer gewissen Größe geht fast jede zusätzliche kWh nur noch in
  Einspeisung/Abregelung — der Zubau verdient seine Kosten nicht mehr. *(Im Tool: die
  Grenznutzen-Kurve, Abb. 2 — wo sie kippt, kostet weiterer Ausbau mehr, als er bringt.)*
- **Batterie sättigt:** Im Sommer ist eine Batterie nach wenigen Stunden voll; die letzten
  kWh Kapazität werden kaum noch zyklisiert. Eine doppelt so große Batterie bringt weit
  weniger als doppelt so viel.
- **„Null Abregelung" sättigt am teuersten:** Die letzten Prozent Abregelung entstehen in
  wenigen sonnigen Spitzenstunden im Jahr. Sie zu vermeiden bräuchte eine riesige Batterie,
  die 360 Tage/Jahr unterbeschäftigt ist → **fast immer unwirtschaftlich**. Ein paar Prozent
  Abregelung zu akzeptieren ist meist das Optimum.

> **Faustregel:** Abregelung ist kein Defekt, sondern eine **Stellgröße**. Ein bisschen
> davon ist optimal.

---

## 7. Die fünf Varianten — Sinn, Vor- und Nachteile

Jede Variante beantwortet **genau eine** Frage. Sie sind keine Konkurrenten um „die beste
Lösung", sondern Antworten auf **verschiedene Stakeholder-Ziele**.

| Variante | Frage | Auslegung | Vorteil | Nachteil | Für wen |
|---|---|---|---|---|---|
| **Minimal** | Günstigster Einstieg? | PV knapp unter Kostenschwelle (z. B. < 100 kWp), keine Batterie | niedrigste Investition, regulatorisch einfach | lässt Potenzial & Erlöse liegen | Referenzpunkt |
| **Eigenverbrauchs-optimiert** | Was verbraucht man selbst? | kleinere PV (≈ EV-Quote ≥ 90 %), kleine Batterie | höchste EV-Quote, geringstes Netz-/Marktrisiko | kleiner Gesamtbeitrag | risikoscheuer Eigennutzer |
| **Wirtschaftlich optimiert** | Höchster Jahresüberschuss? | PV × Batterie gemeinsam auf max. Netto-Überschuss | beste Rendite, akzeptiert etwas Abregelung bewusst | nicht maximaler Klimabeitrag | Investor / Eigentümer |
| **Autarkie-optimiert** | Wie netzunabhängig maximal? | volle PV + Batterie bis zur Sättigung | höchste Versorgungssicherheit | teuer (große Batterie), selten wirtschaftlich | Versorgungssicherheit / ESG |
| **Maximaler PV-Ausbau** | Wie viel passt aufs Dach? | volles Flächenpotenzial, ohne Speicher | max. Ertrag/Klimabeitrag | höchste Netzinfrastruktur, Abregelung | Klimaziele / Bund-Land |

**Wie sie zusammenhängen:** Von oben nach unten steigen PV-Größe und Investition,
die **Autarkie steigt**, die **EV-Quote sinkt**, und die **Wirtschaftlichkeit** ist
irgendwo in der Mitte am besten („Wirtschaftlich optimiert" liegt zwischen Eigenverbrauch
und Autarkie). *(Im Tool sichtbar in der 2D-Fläche, Abb. 1: die Varianten sind Punkte auf
der Überschuss-Landschaft über PV × Batterie.)*

---

## 8. Netztechnik in Kürze — wann der Anschluss zum Engpass wird

PV-Auslegung endet nicht an der wirtschaftlichen Optimierung — der **Netzanschluss** kann
zur harten Grenze werden. Die entscheidende Größe ist **nicht** die Jahresenergie
(Erzeugung vs. Verbrauch), sondern die **gleichzeitige Rückspeiseleistung** am
Anschlusspunkt:

> **Rückspeiseleistung(t) = Erzeugung(t) − gleichzeitige Last(t)** → die **Jahresspitze**
> bestimmt, wie stark der Anschluss sein muss.

Zwei harte Kriterien (das schärfere zählt):

- **Spannungsband:** Einspeisung hebt die Netzspannung. Näherung **Δu ≈ 100 · P_rück / S_k″**
  (S_k″ = Kurzschlussleistung am Anschluss). Budget: **3 %** in der Niederspannung
  (VDE-AR-N 4105), **2 %** in der Mittelspannung (4110).
- **Anschlusskapazität:** Rückspeisespitze gegen die Bemessung von Trafo/Leitung.

Wichtig — und kontraintuitiv: **Eine Batterie löst das nicht zuverlässig.** Im Sommer ist
sie zur Mittagsspitze meist schon voll und schert die **Jahresspitze nicht**. Die Hebel sind
stattdessen: **Abregeln**, **Anschluss verstärken** (größere Übergabestation, neue/stärkere
Anschlussleitung zum MS-Netz) oder ein **internes Erzeugungsnetz** (Sammelnetz mehrerer
Erzeuger auf einen starken Übergabepunkt). *(Im Tool: Rückspeise-Ampel, Abb. 6.)*

---

## 9. Batteriebetrieb — zwei Grundstrategien

1. **Eigenverbrauch (Standard):** Mittagsüberschuss laden, abends für die Last entladen.
   Maximiert den wertvollen Eigenverbrauch. **Das ist fast immer die richtige Priorität.**
2. **Börsen-/Spotbetrieb (ergänzend):** Bei negativen Preisen nicht einspeisen (lieber
   speichern/abregeln), bei hohen Preisen gezielt einspeisen. Sinnvoll erst bei
   Direktvermarktung (> 100 kWp) — aber **Eigenverbrauch hat Vorrang**, weil der Spread
   30 → 8 ct die Spot-Arbitrage (Cent-Beträge) klar schlägt.

> Eine reale Batterie macht **beides**, in dieser Reihenfolge: erst Eigenverbrauch
> verschieben, dann mit dem Rest Arbitrage/Abregelungsvermeidung.

---

## 10. Vorgehen Schritt für Schritt (die eigentliche „Anleitung")

1. **Lastgang besorgen** — viertelstündlich/stündlich, inkl. künftiger Lasten (WP, Ladesäulen).
   Ohne realistisches Lastprofil ist jede Auslegung Raten.
2. **Flexibilität prüfen** — lassen sich WP/E-Autos in die PV-Stunden schieben? Wenn ja,
   zuerst nutzen (billiger als Batterie).
3. **PV-Potenzial bestimmen** — verfügbare Dach-/Freiflächen → maximale kWp.
4. **PV-Größe einkreisen** — die EV-Quote-Kurve über der PV-Größe ansehen *(Abb. 3)*; den
   Bereich finden, in dem der Grenznutzen noch die Grenzkosten deckt *(Grenznutzen, Abb. 2)*.
5. **Batterie dimensionieren** — nur so groß, wie der marginale Nutzen (mehr Eigenverbrauch)
   die marginalen Kosten übersteigt; Sättigung beachten.
6. **Netzanschluss prüfen** — Rückspeisespitze gegen Spannungsband und Anschlusskapazität
   *(Abb. 6)*. Bei „rot": Abregeln vs. Verstärken vs. Erzeugungsnetz abwägen.
7. **Varianten je Ziel aufbereiten** — Minimal / Eigenverbrauch / Wirtschaftlich / Autarkie /
   Max PV, jeweils mit denselben Kennzahlen.
8. **Sensitivitäten** — Strompreis, Einspeise-/Spotpfad, Batteriekosten, Zinssatz variieren;
   sie treiben das Ergebnis stärker als das Simulationsmodell.

---

## 11. Häufige Denkfehler

- **„Erzeugung > Verbrauch" als Netzkriterium.** Falsch — es zählt die **gleichzeitige
  Rückspeisespitze**, nicht die Jahresenergie.
- **„Mehr PV ist immer besser."** Nein — ab der Sättigung verdient der Zubau seine Kosten nicht.
- **„Die Batterie löst das Netzproblem."** Nein — sie ist im Sommer-Peak gesättigt.
- **„Null Abregelung anstreben."** Meist unwirtschaftlich; etwas Abregelung ist optimal.
- **„Maximale Autarkie ist das Ziel."** Nur, wenn jemand dafür zahlt — Autarkie ist teuer.
- **Lastprofil ignorieren.** Der größte Fehler: ohne echtes Profil ist EV-Quote nur geraten.
- **Ein Preisjahr für 20 Jahre.** Immer Sensitivitäten rechnen.

---

## 12. Glossar

| Begriff | Bedeutung |
|---|---|
| **Eigenverbrauchsquote** | Anteil der PV-Erzeugung, der selbst verbraucht wird |
| **Autarkiegrad** | Anteil des Bedarfs, der selbst (PV + Batterie) gedeckt wird |
| **Abregelung** | am Einspeiselimit nicht einspeisbare, verworfene Erzeugung |
| **Rückspeisespitze** | maximale Leistung Richtung Netz (dimensioniert den Anschluss) |
| **S_k″** | Kurzschlussleistung am Netzanschluss — Maß für die „Stärke" des Netzes |
| **Δu** | Spannungsanhebung durch Einspeisung; Budget 3 % (NS) / 2 % (MS) |
| **Direktvermarktung** | Pflicht zur Vermarktung am Spotmarkt für Anlagen > 100 kWp |
| **Erzeugungsnetz** | internes Sammelnetz, das mehrere Erzeuger zu einem Übergabepunkt bündelt |
| **LCOE / Stromgestehungskosten** | Kosten je erzeugte/genutzte kWh über die Lebensdauer |
| **Netto-Jahresüberschuss** | Erlöse + Ersparnisse − alle Jahreskosten (zentrales Bewertungsmaß) |

---

## Anhang A — Formelsammlung (zum Selbst-Nachrechnen)

Notation: `p_bez` Bezugspreis (€/kWh), `p_ein` Einspeisevergütung (€/kWh), `z` Zinssatz,
`n` Nutzungsdauer (a), `I` Investition (€), `ih` Instandhaltung (Anteil von `I` pro Jahr).

**1) Energie-Kennzahlen** (Energien `E` in kWh/a; aus der Simulation):

```
PV-Ertrag           E_pv      = P_kWp · spez. Ertrag (kWh/kWp/a)
Eigenverbrauchsquote EVQ      = E_eigen / E_pv
Autarkiegrad        AUT       = E_eigen / E_bedarf
Abregelungsquote    ABR       = E_abregel / E_pv
                    E_pv      = E_eigen + E_einsp + E_abregel + E_batverlust
                    E_bedarf  = E_eigen + E_netzbezug
```

**2) Annuitätenfaktor** (verteilt eine Investition gleichmäßig über `n` Jahre, inkl. Zins):

```
a(z, n) = z · (1+z)^n / [ (1+z)^n − 1 ]
```

**3) Annualisierte Jahreskosten** (Kapitaldienst + Instandhaltung):

```
JK = I · [ a(z, n) + ih ]          je Komponente (PV, Batterie, Infrastruktur), dann summieren
```

**4) Jährliche Erlöse/Ersparnisse:**

```
Eigenverbrauchs-Ersparnis  = E_eigen · p_bez        (vermiedener Netzbezug — der große Hebel)
Einspeiseerlös             = E_einsp · p_ein         (bzw. Σ E_einsp(t) · Spotpreis(t) bei Direktvermarktung)
Erlöse_gesamt              = Eigenverbrauchs-Ersparnis + Einspeiseerlös
```

**5) Zentrale Bewertungsgrößen:**

```
Netto-Jahresüberschuss   = Erlöse_gesamt − JK_gesamt        ← Auswahlkriterium (maximieren)
Amortisation (statisch)  = I_gesamt / Erlöse_gesamt          (grob; ignoriert Betriebskosten)
Stromgestehungskosten    LCOE = JK_gesamt / E_genutzt        mit E_genutzt = E_eigen + E_einsp
Batterie-Break-even      = JK_Batterie / (p_bez − p_ein)     nötige jährl. Eigenverbrauchs-Verschiebung (kWh)
```

**6) Kapitalwert (NPV)** — die belastbarere Sicht über die Laufzeit `T`:

```
NPV = −I_gesamt + Σ_{t=1..T}  CF_t / (1+z)^t   − Ersatzinvest_t / (1+z)^t
      CF_t = Erlöse_gesamt − Betriebskosten (ohne Annuität, echter Zahlungsstrom)
Barwertfaktor (konstanter CF):  Σ 1/(1+z)^t = [ 1 − (1+z)^−T ] / z
```

NPV > 0 ⇒ lohnt sich über die Laufzeit. Batterie-Ersatz (≈ Jahr 15) als abgezinste Ausgabe abziehen.

**7) Netztechnik — Spannungsanhebung** (Screening, cos φ ≈ 1):

```
Δu [%] ≈ 100 · P_rückspeise / S_k″           Grenze: 3 % (NS) / 2 % (MS)
zulässige Einspeiseleistung  S_zul ≈ (Budget% / 100) · S_k″
```

---

## Anhang B — Durchgerechnetes Beispiel

**Liegenschaft & Annahmen** (entsprechen den Tool-Standardwerten):

| Eingang | Wert |
|---|---|
| Jahres-Strombedarf `E_bedarf` | 600 MWh/a |
| PV-Leistung `P_kWp` | 500 kWp · spez. Ertrag 1.000 kWh/kWp → `E_pv` = **500 MWh/a** |
| Batterie | 500 kWh |
| Preise | `p_bez` = 30 ct/kWh · `p_ein` = 8 ct/kWh |
| Invest | PV 1.200 €/kWp · Batterie 400 €/kWh · Infra (EZA-Stufe) 12.000 € |
| Finanzierung | `z` = 3,5 % · `n_PV` = 20 a · `n_Bat` = 15 a · `ih` = 1 %/a |
| **Aus der Simulation** | Eigenverbrauch 300 · Einspeisung 195 · Abregelung 5 MWh (Σ = 500 ✓), Netzbezug 300 MWh |

**Schritt 1 — Energie-Kennzahlen**

```
EVQ = 300 / 500 = 60 %        AUT = 300 / 600 = 50 %        ABR = 5 / 500 = 1 %
```

**Schritt 2 — Annuitätenfaktoren**

```
a(3,5 %, 20) = 0,035 · 1,035^20 / (1,035^20 − 1) = 0,035 · 1,9898 / 0,9898 = 0,0704
a(3,5 %, 15) = 0,035 · 1,035^15 / (1,035^15 − 1) = 0,035 · 1,6753 / 0,6753 = 0,0868
```

**Schritt 3 — Investition**

```
PV   = 500 kWp · 1.200 €/kWp = 600.000 €
Bat  = 500 kWh ·   400 €/kWh = 200.000 €
Infra                        =  12.000 €
I_gesamt                     = 812.000 €
```

**Schritt 4 — Jahreskosten**

```
PV   = 600.000 · (0,0704 + 0,01) = 600.000 · 0,0804 = 48.240 €/a
Bat  = 200.000 · (0,0868 + 0,01) = 200.000 · 0,0968 = 19.360 €/a
Infra=  12.000 · 0,0704                              =    845 €/a
JK_gesamt                                            = 68.445 €/a
```

**Schritt 5 — Erlöse**

```
Eigenverbrauch = 300.000 kWh · 0,30 €/kWh = 90.000 €/a
Einspeisung    = 195.000 kWh · 0,08 €/kWh = 15.600 €/a
Erlöse_gesamt                             = 105.600 €/a
```

**Schritt 6 — Ergebnis**

```
Netto-Jahresüberschuss = 105.600 − 68.445            = 37.155 €/a
Amortisation (statisch)= 812.000 / 105.600           = 7,7 a
LCOE = 68.445 / 495.000 kWh                          = 0,138 €/kWh = 13,8 ct/kWh   (< 30 ct → lohnt)
```

**Schritt 7 — Lohnt die Batterie?** (Break-even)

```
JK_Batterie / (p_bez − p_ein) = 19.360 € / 0,22 €/kWh ≈ 88.000 kWh/a
```

Die 500-kWh-Batterie muss also **≈ 88 MWh/a** von Einspeisung (8 ct) auf Eigenverbrauch (30 ct)
verschieben — das sind ~176 Vollzyklen/a. Schafft das Lastprofil das nicht, ist sie zu groß.

**Schritt 8 — Kapitalwert (Gegenprobe, 20 Jahre)**

```
CF (Zahlungsstrom)   = 105.600 − ih·I = 105.600 − 0,01·800.000 = 97.600 €/a
Barwertfaktor 20 a   = (1 − 1,035^−20) / 0,035 = 14,21
Σ Cashflows          = 97.600 · 14,21 = 1.387.000 €
Batterie-Ersatz J.15 = 200.000 / 1,035^15 = 119.400 €  (abgezinst)
NPV = −812.000 + 1.387.000 − 119.400 = +455.600 €   → klar lohnend
```

> Alle Zwischenwerte erscheinen im Tool im **„Rechenweg"-Block** unter der Variantentabelle —
> dort mit den echten Projektzahlen je Variante, sodass sich diese Rechnung 1:1 nachvollziehen lässt.

---

*Kurzformel zum Mitnehmen: **Erst das Lastprofil, dann der Eigenverbrauch, dann erst die
Batterie — und immer die gleichzeitige Leistung im Blick, nicht nur die Jahresenergie.***
