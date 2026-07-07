# JSON-Export — Struktur der Projektdatei

Der Button **„Projekt exportieren"** (`exportJSON()` in `src/03c-gebaeude-io.js`,
Funktion `_buildProjectData()`) erzeugt `liegenschaft_projekt.json`. Diese Datei
ist der primäre Dateninput für die Berichtsgenerierung im Arbeitsordner
(`Projekte/[PROJEKT]/Eingangsdaten/`).

Stand: Juni 2026, `version: 1`. Maßgeblich ist immer `_buildProjectData()` —
bei Unklarheiten dort nachsehen.

## Top-Level-Übersicht

| Schlüssel | Typ | Inhalt |
|---|---|---|
| `version` | Zahl | Schema-Version (aktuell 1) |
| `gebaeude` | Array | Alle Gebäude mit Bedarfen und Geometrie |
| `netz` | Objekt | Wärmenetz-Parameter (Temperaturen!, Verluste, GZF) |
| `trasse`, `trasseSegments`, `customEdges`, `edgeWaypoints` | Array/Objekt | Trassenverlauf und Netz-Topologie |
| `lwWp`, `geoThermie`, `fliessgewaesser`, `gasKessel`, `heizoelKessel`, `bhkw`, `stromkessel`, `pelletsKessel`, `heizhackschnitzel`, `fernwaerme` | Objekt oder `null` | Erzeuger — `null` = nicht im Projekt |
| `solarthermie`, `waermespeicher` | Objekt oder `null` | Solarthermie / thermischer Speicher |
| `freiflaechen`, `pvModul`, `pvPanel` | Array/Objekt | PV-Freiflächen und PV-/Strom-Parameter |
| `meritOrderKeys` | Array | Einsatzreihenfolge der Erzeuger (Dispatch) |
| `heizoelEmF` … `stromEmFLZ` | Zahl | CO₂-Emissionsfaktoren (g/kWh, GEG Anlage 9) |
| `pefStrom` … `pefFernwaerme` | Zahl | Primärenergiefaktoren |
| `wirtBausteineOverrides`, `wirtVdiOverrides` | Objekt | Manuelle Overrides der Wirtschaftlichkeit (VDI 2067) |
| `varianten`, `activeVariantId`, `base*Snapshot` | Array/Objekt | Planungsvarianten mit Kernzuständen |
| `stromNetz`, `elektroAssets` | Objekt | Stromnetz-Knoten/-Kabel und Elektro-Assets (Trafos etc.) |
| `customNutzungstypen`, `customElSlpProfiles`, `elSlpWpm2Overrides` | Array/Objekt | Eigene Nutzungstypen und Strom-Lastprofile |

## Für den Bericht besonders relevante Felder

### `gebaeude[]` — je Gebäude
- `name`, `nutzung` (Nutzungstyp), `flaeche` (m² Grundfläche), `stockwerke`, `baujahr`, `zustand`
- `waerme` — **Wärmebedarf in MWh/a**, `heizlast` — **Heizlast in kW**
- `spez` (kWh/m²a), `spezHeizlast` (W/m²)
- `waermeManual`/`heizlastManual` — `true` = von Konstantin manuell gesetzt, sonst Schätzung aus Fläche×Baujahr (IWU/TABULA)
- `strom`, `spezStrom`, `stromProfil` — Strombedarf
- `abrissjahr`, `sanierungen` — für Transformationspfad
- `polygon` — Geometrie (für Bericht meist irrelevant)

### `netz` — Wärmenetz
- `vl`, `rl` — **Vor-/Rücklauftemperatur in °C** (Bestand)
- `planJahr`, `planVl`, `planRl` — geplante Temperaturabsenkung (Transformationsplan!)
- `tAussen` (Norm-Außentemperatur °C), `tMittel` (Erdreich-Mitteltemperatur °C), `uWert` (W/mK Rohr), `v` (m/s Auslegungsgeschwindigkeit)
- `kostenSzenario` — Kostenszenario der Trasse
- `gzfMethode`/`gzfManuell` — Gleichzeitigkeitsfaktor
- `sanierung`, `sanierungPct` — Sanierungsannahme Gebäudebestand

### Erzeuger (jeweils `null`, wenn nicht vorhanden)
Gemeinsame Felder: `leistungKw` (thermisch), `waerme` (Deckel MWh/a, leer = unbegrenzt), Position `lat`/`lng` wo vorhanden.
- `lwWp`: + `jaz`, `lwaDb` (Schallleistung), `minCop` (Abschaltgrenze)
- `geoThermie`: + `jaz`, `tiefe` (m), `qPerM` (W/m Sondenentzug), `abstand`, `dtAbsenkung`
- `fliessgewaesser`: + `durchflussLs` (l/s), `jaz`
- `gasKessel`/`heizoelKessel`/`pelletsKessel`/`heizhackschnitzel`: + `eta` (%)
- `bhkw`: `leistungThKw`, `skz` (Stromkennzahl), `eta`
- `fernwaerme`: + `co2f` (g/kWh)
- `waermespeicher`: `typ` (puffer/gross/saisonal), `volumen` (m³), `dt` (K), `verlust` (%/h), `entladeKw`, `ladeKw`
- `solarthermie`: `flaeche` (m²), `spez` (kWh/m²a)

### `kaelte` — Kälteversorgung (`null`, wenn nicht im Projekt)
Stundenscharfe Kälteberechnung (EER analog zur Wärmepumpe). Zwei Unterobjekte:

**`kaelte.eingabe`** — die UI-Parameter (Round-Trip):
- `lastMode` (`direkt` = MWh/a | `flaeche` = kWh/m²a × Fläche), `mwh`, `nutzung`, `spez` (kWh/m²a), `flaeche` (m²)
- `kuehlgrenze` (°C, Tagesmittel ab dem gekühlt wird), `kaltwasserVl` (°C Kaltwasser-Vorlauf)
- `revwp` — reversible WP: `on`, `quelle` (`luft`/`fg`/`geo` = Rückkühlung), `guetegradK` (η_K), `auto` (Leistung = Wärme-WP), `leistungKw`, `freecool`
- `chiller` — dedizierte Kältemaschine: `on`, `quelle`, `guetegradK`, `leistungKw`, `freecool`
- `freecoolDtMin` (K), `freecoolEer`, `investChillerEurKw`, `investRevwpEurKw`, `zins` (%)

**`kaelte.ergebnis`** — berechnete Werte (für den Bericht):
- `kaelteMwh` (erzeugte Kälte MWh/a), `stromMwh` (Kältestrom MWh/a), `seer` (Jahres-EER)
- `peakKw` (Spitzen-Kältelast), `restMwh` (ungedeckt), `freecoolMwh` (freie Kühlung)
- `investEur`, `stromkostenEurA`, `jahreskostenEurA`, `wgkKaelteCt` (Kältegestehungskosten ct/kWh), `co2TonnenA`
- `monthlyEer[12]`, `erzeuger[]` (je Erzeuger: `kaelteMwh`, `stromMwh`, `seer`, …)

### Emissions- und Primärenergiefaktoren
`stromEmF` (heute) und `stromEmFLZ` (Lebenszyklus/Zieljahr) in g/kWh; übrige
`*EmF` analog. `pef*` = Primärenergiefaktoren für den GEG-Nachweis.

### `varianten[]`
Jede Variante: `id`, `name`, `gebaeudeAusschlüsse` (Gebäude-IDs), eingefrorene
Zustände von Netz/Erzeugern/Stromnetz (`captureNetzState`/`captureErzeugerState`
in `src/01-globals-varianten.js`). Der Basiszustand liegt in
`baseNetzSnapshot`/`baseErzeugerSnapshot`/`baseStromNetzSnapshot`.

## Was NICHT im JSON steht (für den Bericht nachfragen)

- Förderprogramm und Vorgangsnummer
- Standortbesonderheiten (Schallschutz-Auflagen, Denkmalschutz, …)
- Berechnungs-**Ergebnisse** (Wärmegestehungskosten, Jahresdauerlinie,
  Dispatch-Ergebnisse, CO₂-Bilanz): Das JSON enthält nur **Eingangsdaten**.
  Ergebnisse entstehen erst beim Laden im Tool — für den Bericht entweder
  Screenshots/Excel-Export aus dem Tool verwenden oder Werte separat notieren.
- Klimastandort/Lastprofil-Einstellungen der Grundlagenberechnung (gl-*-Felder)
  werden derzeit **nicht** mit exportiert.
