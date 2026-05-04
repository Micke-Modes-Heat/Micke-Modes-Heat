# Strom-Integration in den Rest des Programms — Stand-Analyse

**Datum:** 2026-04-30
**Status:** Reine Analyse, **keine Code-Änderungen**. Empfehlungen am Ende mit Priorisierung.

---

## TL;DR

Du hast aktuell **zwei parallele Welten** im Tool:

- **„Alte Welt"** (Wärme + alter Stromteil): Globals wie `gebaeude[]`, `bhkw`, `lwWp`, `geoThermie`, `gasKessel`, `stromNodes/stromEdges` (in `05b-stromnetz.js`)
- **„Neue Welt"** (Strom-Refactor Phase 3): `ASSETS.items[]` mit `domain: 'strom'|'waerme'|'hybrid'`, `STROMNETZ.trassen[]`, Module 13a-e + 14a-c + 15a-l + 16

Die Sektorkopplung **funktioniert technisch** (WP-Stromverbrauch fließt aus Wärme-Dispatch in die Strom-Bilanz), aber **nur durch die alte Welt**. Die neuen Asset-Strukturen sind nicht in die Berechnungs-/Dispatch-Logik eingebunden — sie sind aktuell ein **paralleles UI-/Datenmodell**, kein integrierter Berechnungsteil.

Der Persistenz-Bug aus dem Review vom 25.04 ist **bereits gefixt** — `assetsNew` und `stromnetzNew` werden korrekt gespeichert (`03c-gebaeude-io.js:655-676`).

---

## Was bereits gut funktioniert

### 1. Sektorkopplung im Dispatch
`06c-dispatch-core.js` läuft den Wärme-Dispatch über 8760h und produziert `_dispatchEnergy[key] = {waermeMwh, elMwh}` für jeden Erzeuger. Wärmepumpen-Strombedarf, BHKW-Stromerzeugung, Stromkessel-Verbrauch — alles wird korrekt erfasst.

### 2. Strom-Bilanz im Live-Modus
`09b-pv-calc.js:calcStromPanel()` zieht aus `_dispatchEnergy` die WP- und Stromkessel-Verbräuche, addiert Quartiers-Strom (4 Quellen-Prioritäten: Upload, manuell MWh, gebäudescharf, Pauschalwerte) und PV-Erzeugung (Pauschal + Gebäude + Freiflächen). Das Ergebnis landet in `window._dispatchEnergy` und im Live-View.

### 3. Persistenz neuer Daten (gefixt!)
`03c-gebaeude-io.js:_buildProjectData()` schreibt:
- `assetsNew.items[]` + `assetsNew.edges[]` (alle Maßnahmen, Baujahr, Position, props)
- `stromnetzNew.trassen` + `szenarien` + `napProfiles`

Beim Reload: `_loadProject` ruft die entsprechenden Restore-Funktionen. Der „kritische Persistenz-Bug" aus dem Review vom 25.04 ist also **erledigt**.

### 4. Asset-System ist sauber designed
`13a-assets-core.js` ist die Kerndatenstruktur: ein `ASSETS.items[]` mit `domain`-Feld. Hybrid-Typen (WP, KWK) sind vorgesehen. Auto-Create-Logik (`13d`) erzeugt UV/Verbraucher/PV pro Gebäude. Lebenszyklus (Baujahr/Abrissjahr/Maßnahmen) durchgängig in jedem Asset/Edge.

---

## Wo es bricht / nicht integriert ist

### A. Wärme-Erzeuger sind NICHT im Asset-System
Konkret: Wenn du eine Wärmepumpe auf der Karte platzierst (über Wärme-Panel), entsteht ein globaler `lwWp = {lat, lng, leistungKw, ...}` — **aber kein Eintrag in `ASSETS.items[]`**.

Die Folge:
- Im Asset-Inspector siehst du sie nicht
- Der Strom-Sektor sieht sie nur indirekt (via `_dispatchEnergy.lwwp.elMwh`), nicht als platzierte Anlage
- Du kannst keine Maßnahme „WP austauschen 2030" zeitlich auf dem WP-Asset hinterlegen — die Wärme-Erzeuger haben ihre eigene (alte) Lebenszyklus-Logik
- Hybrid-Typen sind vorbereitet (`domain: 'hybrid'` für WP/KWK in `ASSET_CFG`), aber faktisch werden sie nie angelegt

### B. Stromnetz-Doppelwelt: 05b vs. 14/15
`05b-stromnetz.js` (1469 Zeilen) läuft als „Library-Layer" weiter parallel — hat eigene `stromNodes[]`, `stromEdges[]`, eigene UI, eigene Berechnung. Der neue Strom-Teil (`14a-c` + `15a-l`) hat sein eigenes Datenmodell (`STROMNETZ.trassen` + `ASSETS.edges` mit `domain:'strom'`).

Aktuell hängen noch 5 Funktionen aus `05b` an: `setNetzSubTab`, `setStromNetzVisible`, `epConfirm`, `updateLpStromSummary`, `recalcStromNetz`. Die werden von 5 anderen Modulen importiert. Das ist die letzte Phase 3.8c, die laut Memory bewusst aufgeschoben war.

**Persistenz speichert beide Welten** (`stromNetz` + `assetsNew/stromnetzNew`) — das verdoppelt die Größe und kann bei Inkonsistenz für Verwirrung sorgen.

### C. UI-Pfade sind nicht einheitlich
- **Wärme-Erzeuger**: Sidebar links → Erzeuger-Panel → „Auf Karte platzieren"-Button pro Erzeuger
- **Strom-Komponenten**: 🧩-Toggle im Header → Asset-Palette → Klick auf Karte
- **Karten-Sub-Modi**: Wärme/Spez/Heizlast/Verlust/Strom — Button-Leiste zur Visualisierung
- **Asset-Layer**: zusätzlich an/aus über `isAssetLayerVisible()`

Es gibt keinen einheitlichen „Anlage hinzufügen"-Workflow. Für den Nutzer wirkt das wie zwei Tools im selben Fenster.

### D. Strom-Module sind unverhältnismäßig viele
14 Module für Strom (14a-c, 15a-l, 16, 16b) gegenüber 3 für Wärme (03a, 03b, 06c). Gerechtfertigt durch die Migrations-Phase (jedes Modul = eine Standalone-Funktion, isoliert testbar). Aber für die langfristige Wartung zu fragmentiert.

---

## Empfehlungen mit Priorisierung

### 🔴 Hoch

**1. Wärme-Erzeuger ins Asset-System spiegeln (Hybrid-Domain aktivieren)**
- Bei Platzierung von `lwWp/fg/geo/bhkw/kwk` automatisch ein Asset mit `domain: 'hybrid'` anlegen — Position, Leistung, Baujahr aus dem Wärme-Erzeuger-State übernehmen
- Vom Asset-Inspector aus editierbar machen
- Maßnahmen-System nutzen (Baujahr/Austausch/Abriss zentral)
- **Aufwand:** ~200 LOC, eigene Session
- **Nutzen:** Strom-Sektor sieht alle Verbraucher/Erzeuger einheitlich; Maßnahmen + Lebenszyklus zentral

**2. Phase 3.8c abschließen — alten 05b-stromnetz.js ausbauen**
- Die 5 verbliebenen Funktionen in ein Mini-Modul `05b-legacy-bridge.js` extrahieren oder in die jeweils logischen neuen Module verschieben
- Persistenz-Block `stromNetz: {nodes, edges, kabelTyp}` aus `_buildProjectData` entfernen (alte Welt nicht mehr speichern)
- Reduziert: 1469 LOC weg, eine Daten-Welt weniger
- **Aufwand:** 1 Session
- **Nutzen:** Klarheit, weniger Konflikt-Quellen

### 🟡 Mittel

**3. UI-Konsolidierung: ein einheitlicher „Anlage platzieren"-Workflow**
- Wärme-Erzeuger-Buttons in die Asset-Palette integrieren (oder umgekehrt)
- Eine Sidebar-Sektion mit allen Anlagen-Typen, Filterung nach Domain (Wärme/Strom/Hybrid)
- **Aufwand:** 1 Session UI-Refactor
- **Nutzen:** weniger UI-Pfade, vorhersagbares Bedienkonzept

**4. Live-Modus erweitern um Asset-System-Daten**
- Strom-Bilanz zeigt aktuell aggregierte MWh aus Dispatch-Output. Mit Asset-System könnten einzelne Verbraucher/Erzeuger im Flow-SVG zeigen, was wann fließt.
- **Aufwand:** mittel, eigene Session
- **Nutzen:** Visuelle Klarheit, „wer verbraucht/erzeugt wann?"

### 🟢 Niedrig (optional)

**5. Strom-Module-Konsolidierung**
- 15a-render + 15b-draw → ein Modul; ähnlich für andere logisch zusammengehörige Funktionen
- **Aufwand:** 1 Session
- **Nutzen:** Wartbarkeit, weniger Datei-Springerei

---

## Was ich NICHT empfehle

- **Keine komplette Re-Architektur in einem Big-Bang.** Das Tool funktioniert, die Phase-3-Migration war erfolgreich. Die nächsten Schritte sollten inkrementell sein, mit Tests dazwischen.
- **Persistenz nicht weiter anfassen** — sieht nach dem Review-Fix gut aus, lass das in Ruhe.
- **05b-stromnetz.js nicht ohne Vorbereitung löschen** — erst die 5 Importe migrieren, dann Datei wegwerfen. Sonst hast du wieder einen UI-Stillstand wie beim 3.8b-Migration-Bug.

---

## Vorgeschlagene Reihenfolge

1. **Erst Optimizer-Speicher-Bug fixen** (siehe `optimizer-speicher-bug-2026-04-30.md`) — direkter Nutzen für die Berechnung
2. **Phase 3.8c** (alten 05b ausbauen) — Aufräumen, dann Klarheit für nächsten Schritt
3. **Wärme-Erzeuger ins Asset-System spiegeln** — die eigentliche Sektorkopplung im Datenmodell
4. **UI-Konsolidierung** — danach
5. Mobile-Layout / Foto-Anhang aus dem 25.04-Review wenn die Hauptarchitektur sitzt
