# Optimizer: Warum kommen Batterie + Wärmespeicher fast nie in der Optivariante?

**Datum:** 2026-04-30 (während der Nacht analysiert)
**Status:** Analyse, **keine Code-Änderungen** vorgenommen — bitte zuerst durchlesen

---

## Kurzantwort

**Ja, du bist zurecht stutzig.** Die Optimierung benachteiligt Batterien und Wärmespeicher systematisch. Es gibt mindestens **zwei harte Bugs** (verifiziert durch direktes Code-Lesen) und **drei Modellierungsschwächen** (Subagent-Analyse, plausibel aber Detail-Verifikation noch offen). Mit Fixes würden Speicher häufiger als optimal gewählt.

---

## Bug 1 — Wärmespeicher wird im Optimizer nie entladen ✅ verifiziert

**Datei:** `src/10a-optimizer-core.js` und `src/10d-optimizer-worker.js` (gleiche Logik beide Stellen)

In der Funktion `_optPvBatSim8760(pvKwp, batKwh, demandH, bhkwElH, dispResult)` (`10a:123-202`) wird der thermische Speicher mit PV-Strom geladen, aber **nirgends im 8760h-Loop entladen**:

```js
let tsSoc = 0;
for (let t = 0; t < 8760; t++) {
  // ... Batterie-Logik ...

  // PV-Überschuss → WP → thermischer Speicher
  if (rGen > 0.1 && dispResult && dispResult.thSpParams && dispResult.wpResKwH) {
    const tsCap = dispResult.thSpParams.kapKwh;
    if (wpResKw > 0.1 && wpCop > 0 && tsCap > 0) {
      const tsFree = Math.max(0, tsCap - tsSoc);    // ← wird klein
      const ladeBudget = Math.min(tsFree, tsEntlKw);
      if (ladeBudget > 0.1) {
        // ...
        tsSoc = Math.min(tsCap, tsSoc + thLade);     // ← nur ge-LADEN
      }
    }
  }
}
```

**Effekt:** Nach den ersten paar sonnigen Stunden ist `tsSoc === tsCap`, dann ist `tsFree = 0` und `ladeBudget = 0` — der gesamte PV→WP→Wärmespeicher-Pfad ist für **den Rest des Jahres tot**. Damit verliert der Wärmespeicher seinen Hauptnutzen in der Optimierungs-Bilanz.

**Wichtig:** Im *normalen* Dispatch (`06c-dispatch-core.js`) wird der Wärmespeicher korrekt geladen UND entladen — nur der Optimierer hat die fehlende Entladung. Das erklärt, warum der Speicher in der manuellen Variante schön Zyklen fährt, aber im Optimizer „unsichtbar" bleibt.

**Fix:** Pro Stunde nach dem Laden eine Wärmesenke simulieren (analog Dispatch). Konkret: solange `lastgangKw[t] > 0` und `tsSoc > 0`, anteilig entladen. Alternative pragmatisch: nachts `tsSoc *= 0.3` als Tagesgang-Reset (deutlich weniger genau, aber ein-Zeiler).

---

## Bug 2 — Batterie wird in der Grobsuche fast nie getestet ✅ verifiziert

**Datei:** `src/10d-optimizer-worker.js` (Worker-Variante) + `10a-optimizer-core.js` (Main-Thread-Variante)

Quality-Settings: `Q.bat = {schnell: 1, standard: 2, gruendlich: 3}` (Anzahl Batterie-Stufen).

In `10d:838`:
```js
let grobBatN = nKand <= 4 ? Q.bat
              : nKand <= 6 ? Math.max(1, Q.bat - 1)
              : 1;                      // ← bei vielen Erzeugern: nur 1 Stufe
```

In `10d:853`:
```js
batStepsGrob = batAktiv
  ? Array.from({length: grobBatN}, (_, i) => Math.round(batMax * i / Math.max(1, grobBatN - 1)))
  : [0];
```

**Bei `grobBatN === 1` ergibt das `batStepsGrob = [0]`** — also die Grobsuche probiert *gar keine Batterie*. Bei >6 Erzeuger-Kandidaten passiert das automatisch.

Bei `grobBatN === 2` (Standard, 5–6 Kandidaten): `[0, batMax]` — also nur „keine Batterie" oder „absurd große Batterie". Optimale 100–500 kWh-Größen liegen genau dazwischen.

Die Feinsuche (Z.1200) testet zwar 8 Stufen — aber nur für die **TOP-5 Konfigurationen aus der Grobsuche**, in denen `batK=0` schon vorausgewählt war. Damit fällt die Batterie meistens komplett raus.

**Fix:** `Q.bat`-Stufen erhöhen (mind. 3 immer) und Stufen sinnvoller verteilen, z.B. `[0, 0.5h-Tagesbedarf, 1h-Tagesbedarf, 2h-Tagesbedarf]` statt `[0, batMax]`. Außerdem die `grobBatN`-Reduktion auf 1 bei `nKand > 6` entfernen.

---

## Weitere Befunde (vom Subagent, noch zu verifizieren)

Diese sind plausibel, aber ich habe sie nicht selbst nachgelesen. Vor dem Fixen einzeln prüfen.

### 3. Doppelte Pufferinvestition in der Wirtschaftsrechnung

**Datei:** `src/07b-analysis-economics.js:86-98`

> Wenn `optSpeicherVol > 0` wird `add('thermSpeicher', vol*1.16*dt*eurKwh, ...)` aufgerufen.
> Aber zusätzlich wird `if (sumKw > 0) add('puffer', sumKw*25*7/1000*1000, ...)` immer addiert.
> Der vom Optimizer gewählte Speicher kommt also *on top* des Basispuffers — verteuert thermSpeicher künstlich.

**Verifizieren:** beide Zeilen lesen, prüfen ob die Annahme stimmt (oder ob die Pufferinvest schon abgezogen wird).

### 4. PV-Eigenverbrauchs-Gutschrift wird durch Quartier-Strom verdünnt

**Datei:** `src/07b-analysis-economics.js:134, 147`

> `gesamtStromMwh = wpSk + quartierMwh`; PV-Gutschrift = `pvEigenMwh * (eMwh / gesamtStromMwh)`.
> Quartier-Strom erhöht den Nenner, ohne als Kostenposition aufzutauchen → PV-Anteil, der Quartiers-Verbrauch deckt, bringt 0 € Ersparnis im Optimizer-Score.

**Verifizieren:** Berechnungslogik in der Wirtschaftsfunktion durchgehen.

### 5. Tote Marginal-Gate-Logik (kein direkter Effekt auf Symptom)

`10a:369-376` und `10d:336-345`: `if (pvK <= 0) continue;` springt vor `(pi === 0 ? batInvest : 0)`. Da `pvSteps[0] === 0` immer gilt, wird `pi===0` nie erreicht — Batterie-Investitionskosten werden im Marginal-Gate nicht berücksichtigt. Das macht Batterien im Gate sogar *bevorzugt*, passt also nicht zum Symptom — aber zeigt dass die Logik nicht das tut, was der Kommentar verspricht.

---

## Empfohlener Fix-Plan (nach Priorität)

| Prio | Bug | Aufwand | Risiko |
|------|-----|---------|--------|
| 🔴 1 | tsSoc-Entladung im Optimizer (10a + 10d) | ~30 LOC, 30 Min | gering — Logik aus Dispatch übernehmen |
| 🔴 2 | grobBatN-Stufen erhöhen + Stufen besser verteilen | ~5 LOC, 10 Min | gering |
| 🟡 3 | Doppel-Puffer-Invest prüfen + ggf. exclusiv | 5 Min Check + 5 LOC | gering |
| 🟡 4 | Quartier-Strom-Gutschrift sauber modellieren | ~10 LOC | mittel — Wirtschaftsformel ändert sich |
| 🟢 5 | pi===0-Logik korrigieren (firstPvAdded-Flag) | ~3 LOC | gering |

**Empfehlung:** Bugs 1 + 2 zusammen fixen, dann eine Test-Optimierung laufen lassen und schauen ob plötzlich Speicher in der Optivariante landen. Falls ja → restliche Punkte sind sekundär. Falls nein → Punkt 3 + 4 angehen.

---

## Test-Vorschlag (bevor wir fixen)

Bevor wir Code ändern, lass uns reproduzieren:
1. Ein kleines Testszenario bauen (5-10 Gebäude, eine WP, etwas Wärmespeicher-Volumen vorgeben)
2. Optimierung mit Quality „gründlich" starten
3. Ergebnis: kommt Batterie/Speicher in der Variante? Wenn nicht — Bugs 1+2 fixen, nochmal laufen lassen.

So hast du einen direkten Vorher/Nachher-Vergleich.
