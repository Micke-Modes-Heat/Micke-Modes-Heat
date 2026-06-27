# PV-Varianten-Workflow — Konzept & Implementierungs-Anleitung

*Stand: 2026-06-27 · Branch `claude/pv-variant-workflow-0ghbsv`*

Dieses Dokument ist die **Bauanleitung** für einen durchgängigen Workflow, der von der
PV-Analyse über die Flächenpriorisierung und Infrastruktur-Ertüchtigung bis zu zeitlich
gestaffelten **Ausbau-Fahrplänen** führt. Es ist so geschrieben, dass es in einer
Folge-Session Schritt für Schritt programmiert werden kann — mit konkreten Datei-/Funktions-
Verweisen auf den Bestand.

---

## 0. Leitprinzip

> **Das Tool schlägt vor und rechnet, der Planer entscheidet und korrigiert.**
> Jeder automatische Schritt erzeugt einen *editierbaren Vorschlag*, nie ein gesperrtes
> Ergebnis. Reale Randbedingungen (Eigentum, Statik, „wer zahlt die Ertüchtigung",
> Ästhetik, Phasen) stecken nicht im Modell und bleiben Hand-Entscheidung.

Zweites Leitmotiv (zentrales Nutzer-Bedürfnis): **Effizienz statt Einzel-Pflege.**
Niemand soll Asset für Asset anklicken und Jahre/Maßnahmen zuweisen. Die Default-Bestückung
kommt automatisch; Korrekturen laufen über Mehrfachauswahl + ein Board.

---

## 1. Die drei Objekte (gemeinsames Vokabular)

| Objekt | Was es ist | Wo es lebt |
|---|---|---|
| **Fläche / Ausbaukandidat** | jede einzeln baubare PV-Einheit, bewertbar & priorisierbar | Lese-Schicht über den 4 vorhandenen PV-Quellen (kein Datenmodell-Merge) |
| **Maßnahme** | diskreter Baustein mit Jahr, Kosten, Wirkung **und Abhängigkeiten** | erweitert das vorhandene `asset.massnahmen[]` |
| **Phase / Ausbaustufe** | benannte Zeitgruppe; trägt das Jahr, das die Maßnahmen erben | **neues** leichtes Objekt auf Projekt-/Variantenebene |
| **Variante** | Auswahl von Flächen + Maßnahmen + Phasen-Set + KPIs | erweitert vorhandenen Snapshot (`01-globals-varianten`) |

Kerngedanke: **Priorisierung, Ertüchtigung und Fahrplan sind nur Algorithmen/Sichten auf
diese Objekte.** Stehen die Objekte, ist der Rest geradlinig.

---

## 2. Datenmodell — konkrete Erweiterungen

### 2.1 Maßnahme erweitern (minimal-invasiv)

Bestand (`src/13e-assets-inspector.js`, Speichern ~Z. 552–557):
```js
{ id, titel, jahr, kosten, typ, status, newProps }
```
Neu hinzufügen — **zwei Felder**:
```js
{
  ...,
  dependsOn: [],     // string[]  IDs anderer Maßnahmen, die vorher status==='umgesetzt' sein müssen
  phaseId:   null,   // string|null  Zugehörigkeit zu einer Phase; das Jahr wird daraus abgeleitet
}
```
- `jahr` bleibt erhalten, wird aber **optional**: ist `phaseId` gesetzt, gilt das Jahr der
  Phase; ein gesetztes `jahr` überschreibt (Einzel-Override).
- `MASSN_TYP` (Z. 418) um Infrastruktur-Typen erweitern, die heute fehlen:
  ```js
  const MASSN_TYP = {
    Sanierung:    { label:'Sanierung',     icon:'🔧', hasNewProps:true  },
    Abriss:       { label:'Abriss',        icon:'🏚', hasNewProps:false },
    Bau:          { label:'Neubau/Bau',    icon:'🏗', hasNewProps:false }, // PV-Fläche errichten
    Ertuechtigung:{ label:'Ertüchtigung',  icon:'⚡', hasNewProps:true  }, // Trafo/NAP/Leitung verstärken
  };
  ```
- `getAssetPropsForYear` (`13a-assets-core.js` Z. 135) nutzt schon `status==='umgesetzt' +
  newProps + jahr` → **die Wirkung von Ertüchtigungen ist simulationsseitig bereits
  angeschlossen.** Anpassung nötig: wenn `jahr` fehlt, das Phasen-Jahr auflösen
  (Helper `massnahmeJahr(m)` einführen, s. u.).

### 2.2 Phase — neues Objekt

Neu, lebt im globalen State (analog `varianten` in `01-globals-varianten.js`):
```js
export let phasen = [];   // Phase[]
// Phase = { id, name, jahrVon, jahrBis, variantId, reihenfolge }
```
- `variantId === null` ⇒ projektweite Phase; sonst variantenspezifisch.
- Setter/Capture/Restore analog zu `_captureVariantenKernzustand` (Z. 609) ergänzen.
- Helper:
  ```js
  export function massnahmeJahr(m) {
    if (m.jahr) return parseInt(m.jahr);
    const p = phasen.find(x => x.id === m.phaseId);
    return p ? parseInt(p.jahrVon) : null;
  }
  ```

### 2.3 Fläche / Ausbaukandidat — Lese-Schicht (kein Merge!)

Die 4 PV-Quellen werden heute in `pvGetMaxKwpFromAssets()` /
`pvGetAssetBreakdown()` (`src/09d-pv-analyse.js` Z. 215/236) nur **summiert**. Neu:
eine Funktion, die sie als **Einzelliste** aufzählt:
```js
// neu in 09d (oder neues Modul, s. Abschnitt 4)
export function pvEnumerateKandidaten() {
  // → Kandidat[] = {
  //     id, quelle:'asset'|'gebaeude'|'freiflaeche'|'manuell',
  //     refId, name, lat, lng,
  //     kWp, ausrichtung, spezErtrag, jahresertragKWh,   // alle ableitbar (Bestand)
  //     napId:null, anschlussKosten:null,                // NEU, Step 3
  //     score:null, tier:null, deltaUeberschuss:null,    // NEU, Step 3-Ergebnis
  //     status:'kandidat'                                 // kandidat|gewaehlt|bestand
  //   }
}
```
Quellen: `ASSETS.items.filter(type==='PV')` (`props.leistungKWp`), `gebaeude[].pvAktiv`
(`calcGebKwp`), `freiflaechen[]` (`calcFFKwp`, `ff.ausrichtung`), manuelle kWp.
Ausrichtung/Ertrag aus `pvOrientationMix()` / `_PV_SPEZ_DEFAULT` (`09a-pv-profile.js`).

### 2.4 Persistenz

In `src/03c-gebaeude-io.js`:
- `_buildProjectData()` (Z. 1662): Assets werden bei Z. 1744–1752 inkl. `massnahmen`
  serialisiert. **Die neuen Maßnahmen-Felder `dependsOn/phaseId` reisen automatisch mit**
  (ganzes Objekt wird gespeichert) — nichts zu tun. **Zusätzlich** `phasen` serialisieren:
  ```js
  phasen: _captureVariantenKernzustand().phasen ?? phasen,   // neben varianten
  ```
- `_loadProject()` (Z. 1795): `varianten` wird bei Z. 2108 geladen; `massnahmen` bei
  Z. 2127. **Ergänzen:** `phasen` aus `project.phasen` zurückladen (über Setter/Restore).

---

## 3. Die 5 Workflow-Schritte (mit Auto/Hand)

| # | Schritt | Status heute | Auto / Hand |
|---|---|---|---|
| 1 | PV-Potenzial: alle Flächen erfassen | ✅ (4 Quellen) | Hand (Erfassung) |
| 2 | PV-Analyse + Lastentwicklung → wie viel Ausbau | ✅ (5 Archetypen, `09d`) | **Auto** |
| 3 | **Flächen bewerten & priorisieren** (Merit-Order) | ❌ neu | Auto-Score → Hand-Korrektur |
| 4 | **Infra-Ertüchtigung + NAP-Erweiterung** | 🟡 (NAP-Massnahmen, Ampel, `13o`) | Auto-Vorschlag → Hand-Auswahl |
| 5 | **Fahrplan / Bauphasen** | ❌ neu | Auto-Reihenfolge → Hand-Timing |

---

## 4. Modul-Landkarte

**Wiederverwenden (nicht neu bauen):**
- `06c-dispatch-core.js` / `_dispatchCore` — stündliche Simulation
- `07b-analysis-economics.js` — Wirtschaftlichkeit (VDI 2067, Netto-Überschuss)
- `09d-pv-analyse.js` — Archetypen, Infra-Stufen (`pvInfraKosten`, `PV_INFRA_STUFEN`)
- `10a/10c/10d-optimizer-*` — **Worker, der `_dispatchCore` parallel über alle Kerne fährt**
  (für die O(n²)-Merit-Order!)
- `13a-assets-core.js` — `createAsset`, `getAssetStatus`, `getAssetPropsForYear`, `ASSETS`
- `13e-assets-inspector.js` — Maßnahmen-Form, `MASSN_TYP`, `MASSN_STATUS`, `ASSET_PROPS_SCHEMA`
- `13o-nap-analyse.js` — `napShowSection` (Vollbild-Muster), Headroom/Kapazität, Rückspeise-Ampel
- `01-globals-varianten.js` — Snapshot/Vergleich/Pareto

**Neue Module (in `build-singlefile.mjs` → `JS_FILES` eintragen, sonst bricht Build ab,
s. Z. 77–104!):**
- `14a-kandidaten.js` — Lese-Schicht Flächen + Merit-Order-Algorithmus (Step 3)
- `14b-ertuechtigung.js` — Headroom→Maßnahmen-Ableitung + Alternativen (Step 4)
- `14c-phasen.js` — Phasen-State, Topo-Sort, Fahrplan (Step 5)
- `14d-ausbauplaner-ui.js` — Vollbild-Board, Selektion, Bulk-Bar (UI)

> **Build-Regel:** Reihenfolge in `JS_FILES` ist maßgeblich für Top-Level-Init. Neue Dateien
> ans Ende der `13*`-Reihe / vor `main`-naher Logik einsortieren. Nach jeder neuen Datei:
> `npm run build` muss durchlaufen (der Wächter Z. 96 fängt Vergessenes).

---

## 5. Algorithmen

### 5.1 Step 3 — Flächen-Merit-Order (Greedy, marginal, voller Wirtschafts-Score)

```
Eingang: Kandidaten C (pvEnumerateKandidaten), Batterie (aus Archetyp Step 2),
         NAP-Lastprofile, Ziel (Ziel-kWp ODER „bis Δ ≤ 0").
S := vorbelegt mit Bestand (status==='bestand')
solange Kandidaten übrig:
  für jeden c ∉ S  (PARALLEL über Optimizer-Worker):
    S' := S ∪ {c}
    PV-Profil neu mischen           → pvOrientationMix()
    Dispatch am betroffenen NAP     → _dispatchCore
    Wirtschaftlichkeit              → economics → Netto-Jahresüberschuss
    Headroom-Check am NAP:
        passt c in freie Kapazität? → Δinfra = 0
        sonst                       → günstigste Ertüchtigung (Abschnitt 5.2), Δinfra = Annuität
    Δ(c) := Überschuss(S') − Überschuss(S) − Δinfra
  c* := argmax Δ(c); S := S ∪ {c*}; protokolliere Δ(c*), kumuliert, getriggerte Infra
  Abbruch wenn Δ(c*) ≤ 0  ODER  Ziel-kWp erreicht
```
**Ausgaben:**
1. Rangliste + Tiers: A (Δ groß) / B (Δ klein >0) / C (Δ ≤ 0).
2. Kumulative Überschuss-Kurve über kWp → **Nulldurchgang = wirtschaftlich sinnvolle
   Ausbaugröße** (präzisiert Step 2 endogen).
3. Die Reihenfolge selbst = Roh-Sequenz für Step 5.

**Performance:** naiv O(n²) Dispatch-Läufe. Zwingend über den **Optimizer-Worker**
parallelisieren. **Per-NAP-Zerlegung**: Flächen verschiedener NAPs interagieren
wirtschaftlich kaum → je NAP separat ranken, am Ende mergen.

**Greedy ist hier korrekt**, nicht Kompromiss: PV hat fallenden Grenznutzen (Doku
`PV-Batterie-Auslegung-Grundlagen.md` §6), und Greedy liefert als einziges die Sequenz,
die Step 5 braucht.

### 5.2 Step 4 — Ertüchtigung aus Headroom ableiten

Pro Engpass am NAP (Rückspeisespitze > zulässig) Maßnahmen-Kandidaten erzeugen, geprüft
gegen die **zwei harten Kriterien** (Doku §8):
- **Spannungsband:** `Δu ≈ 100 · P_rück / Sₖ″`, Budget 3 % (NS) / 2 % (MS).
- **Anschlusskapazität:** Rückspeisespitze vs. Trafo-/Leitungs-Bemessung.

Erzeuge **Alternativen** mit Kosten + Konsequenz, Default = wirtschaftlich beste:
| Alternative | Wirkung | Default-Kosten-Quelle |
|---|---|---|
| Abregelung X % | 0 € Invest, −Ertrag/a | aus Dispatch |
| NAP-Kapazität ↑ | `newProps` am NAP | Maßnahmen-Vorlage |
| Trafo verstärken/neu | `newProps.leistungKVA` | Vorlage + `PV_INFRA_STUFEN` |
| Übergabestation | neue Station-Maßnahme | Vorlage |
| Anschlussleitung MS | neue Leitung | `netz-kosten.js` |
| internes Erzeugungsnetz | Sammelnetz | `pvInfraKosten` Erzeugungsnetz-Option |

Jede Alternative wird als **Maßnahme** (Abschnitt 2.1) materialisiert und trägt ihre
`dependsOn` (z. B. Trafo `dependsOn` MS-Leitung). Auswahl = Hand (Kosten/Risiko-Abwägung);
Übersteuern rechnet Step 3 neu (Δinfra ändert sich).

### 5.3 Step 5 — Fahrplan (topologische Sortierung)

- Knoten = Maßnahmen (Flächen-`Bau` + Ertüchtigungen). Kanten = `dependsOn`.
- **Topo-Sort** liefert gültige Bau-Sequenz → automatisch „Ertüchtigung → MS → Trafo → NS → PV".
- Innerhalb gleicher Stufe: Reihenfolge aus Δ-Ranking (Step 3).
- Phasen-Zuordnung: Sequenz in Phasen schneiden (Auto-Vorschlag), Jahre an Phasen.
- Validierung live: keine Maßnahme vor ihrer Vorbedingung; kein NAP im Jahr X über Kapazität;
  optional Budget/Jahr.
- Schreibt `massnahme.jahr`/`phaseId` und ggf. `asset.baujahr` → Lastentwicklung (Step 2,
  `napGetEndausbauLastgang` `13o` Z. 688) läuft zeitlich korrekt mit.

---

## 6. UI-Spezifikation — drei Effizienz-Ebenen

### Ebene 1 — Selektion (Assets in Mengen greifen)
Gemeinsamer State: `window.assetSelection = new Set()` (es gibt heute **keine**
Mehrfachauswahl für Assets — neu, aber klein).
- **Karte:** Box-/Lasso-Auswahl (Shift+Ziehen) → Set füllen; „selected"-Ring am Marker
  (Renderer `13b-assets-render.js`).
- **Sidebar-Liste** (`renderSidebarAssetList`, `sb-asset-row`): Checkboxen + Filterzeile
  (Typ · NAP · Tier · Status) + „alle sichtbaren wählen".
- **Aus Merit-Order:** Button „Tier A übernehmen" füllt das Set.

### Ebene 2 — Sammelaktions-Leiste (Bulk-Bar)
Schwebende Leiste, sobald Selektion ≥ 1 („12 Assets · Σ 1,4 MWp"):
- **→ Phase ▾** (vorhandene / „neue Phase") — ersetzt Jahr-pro-Asset
- **Maßnahme anlegen ▾** (Vorlage aus `MASSN_TYP`) → je Asset eine Maßnahme, Kosten/`newProps`
  aus Vorlage
- **Status ▾** (`geplant`/`umgesetzt`) · **Jahr setzen** (Override) · **zur Variante ±**

Wiederverwendet die Form-Logik aus `wireMassnahmen` (`13e` Z. 468), nur batch statt einzeln.

### Ebene 3 — Ausbauplaner (Vollbild, Muster `napShowSection` `13o` Z. 215)
Layout „Sidebar links + Hauptbereich". Hauptbereich = **Gantt mit Gewerk-Swimlanes**
(Primäransicht; Phasen-Kanban als Sekundär-Toggle):
```
 Phase:   │ Phase 1 (2026–27) │ Phase 2 (2028) │ Phase 3 (2029–30) │
 Ertücht. │ ███ NAP-3 +250kVA │                │                   │
 MS-Netz  │     ██ MS-Stich   │                │                   │
 Trafo    │            ██ T-2 →─┐              │                   │
 NS-Netz  │                     └─ ██ NS-Strang│                   │
 PV       │                    │  ███ PV Dach A│ ███ PV Freifl. B  │
```
- Zeilen = Gewerke (Ertüchtigung/MS/Trafo/NS/PV) → Bau-Kette direkt ablesbar.
- Balken = Maßnahmen (Position aus `massnahmeJahr`), Pfeile = `dependsOn`.
- **Drag Balken** → Phase/Jahr ändern. **Drag Phasen-Kopf** → ganze Phase verschiebt sich.
- Ungültige Platzierung blinkt rot (Graph + Headroom validieren live).
- **Knopf „Plan automatisch erzeugen"** → bestückt Board aus Step 3 + 4 (Topo-Sort). Nie
  leeres Board.
- **Sidebar:** Variantenwähler, Phasenliste (Jahr-von/bis editierbar), Budget/Jahr, Konfliktliste.

### Verzahnung (nichts Bestehendes bricht)
- Klick auf Balken/Asset öffnet weiterhin den **Inspector** (Detail-Edit). Board = Bulk-Schicht darüber.
- `globalYear`-Scrubber unverändert; Planer bekommt „Abspielen"-Knopf, der durch Jahre steppt
  (`getAssetStatus`/`getAssetPropsForYear` liefern die Jahresscheibe).
- Variantenvergleich (`renderVergleich`/Pareto `01`) erbt Phasen-Invest → Spalte „Invest je Phase".

---

## 7. Implementierungsplan (Etappen mit Checkpoints)

> Nach **jeder** Etappe: `npm run lint && npm run typecheck && npm test && npm run build`.
> Neue `src/*.js` **sofort** in `JS_FILES` eintragen (Wächter bricht sonst ab).

**Etappe A — Datenmodell-Fundament** *(klein, risikoarm)*
1. Maßnahme um `dependsOn`/`phaseId` erweitern (`13e`), `MASSN_TYP` ergänzen.
2. `phasen`-State + Setter/Capture/Restore in `01-globals-varianten.js`.
3. `massnahmeJahr()`-Helper; `getAssetPropsForYear` darauf umstellen (`13a`).
4. Persistenz: `phasen` in `_buildProjectData`/`_loadProject` (`03c`).
- ✅ Test: Projekt speichern/laden round-trip mit Phasen + neuen Feldern.

**Etappe B — Flächen-Merit-Order (Step 3)** *(Rechenkern)*
1. `14a-kandidaten.js`: `pvEnumerateKandidaten()`.
2. Greedy-Marginal-Algorithmus über Optimizer-Worker; Per-NAP-Zerlegung.
3. Ausgaben: Rangliste/Tiers, kumulative Kurve.
- ✅ Test (Vitest): kleine synthetische Kandidatenmenge → erwartete Reihenfolge/Tiers.

**Etappe C — Ertüchtigung (Step 4)** *(Rechenkern + Vorlagen)*
1. `14b-ertuechtigung.js`: Headroom→Alternativen (Doku §8 Kriterien).
2. Maßnahmen-Vorlagen (Kosten/`newProps`/`dependsOn`).
3. In Merit-Order einklinken (Δinfra).
- ✅ Test: Engpass-Szenario → erwartete Alternativen + Kosten.

**Etappe D — Fahrplan (Step 5)** *(Graph)*
1. `14c-phasen.js`: Topo-Sort, Phasen-Schnitt, Validierung.
2. Schreibt `jahr`/`phaseId`/`baujahr`.
- ✅ Test: Abhängigkeitskette → korrekte Reihenfolge; Zyklus/Verletzung erkannt.

**Etappe E — UI Ebene 1+2** *(Selektion + Bulk-Bar)*
1. `assetSelection`-State, Karten-/Listen-Selektion, „selected"-Ring.
2. Bulk-Bar mit Sammelaktionen (Reuse `wireMassnahmen`).
- ✅ Manuell: mehrere Assets wählen → einer Phase zuweisen → erscheint im State.

**Etappe F — UI Ebene 3 (Ausbauplaner-Board)** *(größte UI-Etappe)*
1. `14d-ausbauplaner-ui.js`: Vollbild (Muster `napShowSection`), Gantt-Swimlanes.
2. Drag (Balken/Phase), `dependsOn`-Pfeile, Live-Validierung, „Plan automatisch erzeugen".
3. Variantenwähler, „Abspielen", Vergleichs-Integration.
- ✅ Manuell: Auto-Plan erzeugen → Phase verschieben → Konflikt rot → Variante vergleichen.

**Etappe G — Politur**
Sensitivitäten, Export/Bericht (`05a/05d`), Hilfetexte (`config/hilfe-texte.js`), e2e-Smoke.

---

## 8. Reuse-Referenz (Symbol → Ort)

| Symbol | Datei:Zeile | Zweck |
|---|---|---|
| `ASSETS`, `createAsset` | `13a-assets-core.js` :112/:149 | Asset-Store/CRUD |
| `getAssetStatus` | `13a` :124 | Jahres-Lebenszyklus |
| `getAssetPropsForYear` | `13a` :135 | Wirkung umgesetzter Maßnahmen |
| `ASSET_PROPS_SCHEMA` | `13a` :63 | editierbare Parameter je Typ |
| `MASSN_TYP` / `MASSN_STATUS` | `13e-assets-inspector.js` :418/:412 | Maßnahmen-Typen/Status |
| `wireMassnahmen` / Form | `13e` :468/:438 | Maßnahmen-Eingabe (für Bulk reuse) |
| `napShowSection` | `13o-nap-analyse.js` :215 | Vollbild-Toggle-Muster |
| `napGetEndausbauLastgang` | `13o` :688 | Lastentwicklung über Jahre |
| `pvGetMaxKwpFromAssets` / `pvGetAssetBreakdown` | `09d-pv-analyse.js` :215/:236 | PV-Quellen (→ Einzelliste) |
| `pvInfraKosten` / `PV_INFRA_STUFEN` | `09d` :267/:256 | Infra-Kosten (Fallback) |
| `pvOrientationMix` / `_PV_SPEZ_DEFAULT` | `09a-pv-profile.js` :43/:24 | Ausrichtung/Ertrag |
| `_dispatchCore` | `06c-dispatch-core.js` | Stunden-Dispatch |
| Optimizer-Worker | `10d-optimizer-worker.js` | parallele Dispatch-Läufe |
| `varianten`, `activateVariant`, Snapshot | `01-globals-varianten.js` :596/:902/:609 | Varianten |
| `renderVergleich` / Pareto | `01` :311/:400 | Variantenvergleich |
| `_buildProjectData` / `_loadProject` | `03c-gebaeude-io.js` :1662/:1795 | Persistenz (Phasen ergänzen) |
| `JS_FILES` + Build-Wächter | `build-singlefile.mjs` :18/:77 | neue Module registrieren |

---

## 9. Offene Entscheidungen (vor/while coding zu klären)

1. **Phasen-Geltung:** projektweit vs. variantenspezifisch als Default? (Feld `variantId`
   ist vorgesehen — Default-Verhalten festlegen.)
2. **Maßnahmen-Vorlagen-Katalog:** wo definieren (`config/`-Datei analog `netz-kosten.js`)?
   Welche Standard-Kosten/`newProps`?
3. **Per-NAP-Zerlegung-Grenze:** ab wann lohnt globaler statt lokaler Dispatch (mehrere NAPs
   mit gemeinsamer Übergabe)?
4. **Gantt-Renderer:** eigenes Canvas/SVG vs. leichte Lib? (Single-File-Build bevorzugt
   eigenes, keine neuen Runtime-Deps.)
5. **Abregelung als Maßnahme** oder als NAP-Parameter? (beeinflusst, wie sie im Fahrplan
   erscheint.)

---

## 10. Risiken / Fallstricke

- **Build-Wächter** (`build-singlefile.mjs` :96): jede neue `src/*.js` muss in `JS_FILES`.
- **Zwei Laufzeitwelten** (README §Architektur): Code muss in Vite-Dev *und* Single-File
  laufen; mutable Cross-File-State über `window.*` + Setter, nicht Direktzuweisung an Importe.
- **Worker self-contained:** `_dispatchCore` wird per `toString()` in den Worker gebunden —
  keine Closures/externe Refs einführen (README §Architektur).
- **O(n²)-Kosten:** ohne Worker-Parallelisierung + Per-NAP-Zerlegung wird Step 3 bei vielen
  Flächen zäh.
- **Persistenz-Kompatibilität:** alte Projekt-JSONs ohne `phasen`/neue Maßnahmen-Felder müssen
  weiter laden (Defaults `[]`/`null`).
</content>
</invoke>
