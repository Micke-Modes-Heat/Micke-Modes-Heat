// ── 14c-phasen.js — Fahrplan-Logik: Topo-Sort, Phasen-Schnitt, Validierung ──
// M4: dependsOn-Graph → Bau-Sequenz; Auto-Schnitt in Phasen; Verletzungsprüfung
//
// Zwei Schichten:
//   PURE (export, testbar, kein DOM):
//     fahrplanTopoSort, fahrplanDetektZyklus, fahrplanValidiereReihenfolge,
//     fahrplanAutoSchnitt, fahrplanBerechneInvestJePhase
//   APP-SIDE:
//     fahrplanAutoGenerieren, fahrplanSchreibeAufAssets

import { ASSETS } from './13a-assets-core.js';
import { phasen, massnahmeJahr } from './01-globals-varianten.js';

// ── Typen (JSDoc-Referenz) ────────────────────────────────────────────────────
// FahrplanItem = {
//   id:        string,        — eindeutige ID dieser Fahrplan-Maßnahme
//   assetId:   string,        — zugehöriges Asset
//   typ:       string,        — 'Bau' | 'Ertuechtigung' | 'Sanierung' | ...
//   titel:     string,
//   kosten:    number,        — €
//   jahr:      number|null,   — explizites Jahr (Override, null = aus Phase)
//   phaseId:   string|null,
//   dependsOn: string[],      — IDs anderer FahrplanItems (Prereqs)
//   deltaRank: number,        — Δ aus Merit-Order (0 wenn nicht aus MO)
// }

// ── Pure: Topologische Sortierung ────────────────────────────────────────────

/**
 * Kahn-Algorithmus: sortiert FahrplanItems so, dass jede Maßnahme erst nach
 * allen ihren Prereqs erscheint.
 *
 * items: FahrplanItem[]  (jedes hat .id und .dependsOn: string[])
 * Gibt sortiertes Array zurück.
 * Wirft Error wenn ein Zyklus erkannt wird (mit betroffenen IDs).
 */
export function fahrplanTopoSort(items) {
  const idMap   = new Map(items.map(it => [it.id, it]));
  const indegree = new Map(items.map(it => [it.id, 0]));

  // Eingehende Kanten zählen
  for (const it of items) {
    for (const dep of (it.dependsOn || [])) {
      if (!idMap.has(dep)) continue; // externe Dep, ignorieren
      indegree.set(it.id, (indegree.get(it.id) || 0) + 1);
    }
  }

  // Startknoten: alle ohne eingehende Kanten (innerhalb des Sets)
  const queue  = items.filter(it => indegree.get(it.id) === 0).map(it => it.id);
  const result = [];

  while (queue.length > 0) {
    const cur  = queue.shift();
    const item = idMap.get(cur);
    if (!item) continue;
    result.push(item);

    // Alle Items die cur als Prereq haben → indegree senken
    for (const other of items) {
      if (!(other.dependsOn || []).includes(cur)) continue;
      const newDeg = (indegree.get(other.id) || 0) - 1;
      indegree.set(other.id, newDeg);
      if (newDeg === 0) queue.push(other.id);
    }
  }

  if (result.length < items.length) {
    const remaining = items.filter(it => !result.find(r => r.id === it.id)).map(it => it.id);
    throw new Error('Zyklus erkannt in FahrplanItems: ' + remaining.join(', '));
  }

  return result;
}

/**
 * Prüft ob im dependsOn-Graph ein Zyklus existiert.
 * Gibt Array der am Zyklus beteiligten IDs zurück, oder null wenn zyklenfrei.
 */
export function fahrplanDetektZyklus(items) {
  try {
    fahrplanTopoSort(items);
    return null;
  } catch (e) {
    const match = e.message.match(/: (.+)$/);
    return match ? match[1].split(', ') : [];
  }
}

/**
 * Prüft ob die zeitliche Reihenfolge (massnahmeJahr) die dependsOn-Kanten respektiert.
 * Eine Verletzung liegt vor wenn ein Item früher geplant ist als einer seiner Prereqs.
 *
 * items: FahrplanItem[]
 * phasenArr: Phase[]  (zur Jahr-Auflösung via massnahmeJahr)
 *
 * Gibt array von { item, prereqId, itemJahr, prereqJahr } zurück (leer = alles ok).
 */
export function fahrplanValidiereReihenfolge(items, phasenArr) {
  const idMap     = new Map(items.map(it => [it.id, it]));
  const jahrFn    = (it) => _itemJahr(it, phasenArr);
  const verletzungen = [];

  for (const it of items) {
    const itJahr = jahrFn(it);
    if (itJahr == null) continue; // kein Jahr → kein Check möglich
    for (const depId of (it.dependsOn || [])) {
      const prereq = idMap.get(depId);
      if (!prereq) continue;
      const prereqJahr = jahrFn(prereq);
      if (prereqJahr == null) continue;
      if (itJahr < prereqJahr) {
        verletzungen.push({ item: it, prereqId: depId, itemJahr: itJahr, prereqJahr });
      }
    }
  }
  return verletzungen;
}

/**
 * Verteilt eine topo-sortierte Sequenz von FahrplanItems auf Phasen.
 * Pro Phase werden maximal `msProPhase` Items zugeordnet (Standard: 5).
 * Gibt ein Array von { phaseIdx, items } zurück.
 *
 * sortierteItems: FahrplanItem[] (bereits topo-sortiert)
 * msProPhase: max. Items pro Phase (Standard 5)
 *
 * Hinweis: Diese Funktion weist NICHT phaseId zu — das macht der Aufrufer.
 * Sie liefert nur die Gruppen-Indizes.
 */
export function fahrplanAutoSchnitt(sortierteItems, msProPhase) {
  const n       = msProPhase > 0 ? msProPhase : 5;
  const gruppen = [];
  for (let i = 0; i < sortierteItems.length; i += n) {
    gruppen.push({ phaseIdx: gruppen.length, items: sortierteItems.slice(i, i + n) });
  }
  return gruppen;
}

/**
 * Aggregiert Invest-Kosten je Phase.
 * items: FahrplanItem[]
 * phasenArr: Phase[]
 *
 * Gibt Map<phaseId|null, gesamtKostenEUR> zurück.
 * Null-Key = Items ohne Phase (ungeplant).
 */
export function fahrplanBerechneInvestJePhase(items, phasenArr) {
  const map = new Map();
  for (const it of items) {
    const pid = it.phaseId || null;
    map.set(pid, (map.get(pid) || 0) + (it.kosten || 0));
  }
  return map;
}

// ── App-Side ──────────────────────────────────────────────────────────────────

/**
 * Vollständiger Auto-Fahrplan aus Merit-Order-Ranking + optionalen Ertüchtigungen.
 *
 * ranking: Ergebnis von pvMeritOrderCore().ranking (nur A+B-Einträge werden verarbeitet)
 * infraMap: Map<massnahmeId, { typ, titel, kosten, assetId, newProps }> — Ertüchtigungen
 *           die durch den Merit-Order-Lauf erzeugt wurden (optional, kann leer Map sein)
 * phasenArr: Phase[] — vorhandene Phasen (für Schnitt)
 * opts: {
 *   msProPhase?: number,      — Items pro Phase (Standard 5)
 *   pvInvestPerKwp?: number,  — €/kWp für Bau-Kosten
 * }
 *
 * Gibt { items: FahrplanItem[], gruppen: [{phaseIdx, items}] } zurück.
 * Weist phaseId aus phasenArr zu (oder null wenn keine Phasen vorhanden).
 */
export function fahrplanAutoGenerieren(ranking, infraMap, phasenArr, opts) {
  const { msProPhase = 5, pvInvestPerKwp = 1200 } = opts || {};
  const items = [];
  const infra = infraMap || new Map();

  // 1. Ertüchtigungs-Items voranstellen (müssen VOR den Bau-Items kommen)
  for (const [mId, ert] of infra) {
    items.push({
      id:        mId,
      assetId:   ert.assetId || null,
      typ:       ert.typ || 'Ertuechtigung',
      titel:     ert.titel || 'Ertüchtigung',
      kosten:    ert.kosten || 0,
      jahr:      null,
      phaseId:   null,
      dependsOn: [],
      deltaRank: 0,
      newProps:  ert.newProps || {},
    });
  }

  // 2. Bau-Items aus Ranking (Tier A+B, in Ranking-Reihenfolge = absteigendes Δ)
  for (let i = 0; i < ranking.length; i++) {
    const r = ranking[i];
    if (r.tier === 'C') continue;
    const k   = r.kandidat;
    const bid = 'bau_' + k.id;

    // Prereqs: alle Ertüchtigungen die diesem NAP zugeordnet sind
    const ertPrereqs = [];
    for (const [mId, ert] of infra) {
      if (ert.napId === k.napId || ert.assetId === k.napId) ertPrereqs.push(mId);
    }

    items.push({
      id:        bid,
      assetId:   k.refId || k.id,
      typ:       'Bau',
      titel:     'PV-Anlage ' + (k.name || k.id),
      kosten:    Math.round(k.kWp * pvInvestPerKwp),
      jahr:      null,
      phaseId:   null,
      dependsOn: ertPrereqs,
      deltaRank: r.delta,
      newProps:  { leistungKWp: k.kWp, ausrichtung: k.ausrichtung },
    });
  }

  // 3. Topo-Sort
  const sortiert = fahrplanTopoSort(items);

  // 4. Auto-Schnitt in Phasen
  const gruppen = fahrplanAutoSchnitt(sortiert, msProPhase);

  // 5. phaseId zuweisen (aus phasenArr wenn vorhanden, sonst Phasen-Index als Placeholder)
  const sortPhasen = [...(phasenArr || [])].sort(
    (a, b) => parseInt(a.reihenfolge) - parseInt(b.reihenfolge)
  );
  for (const g of gruppen) {
    const phase = sortPhasen[g.phaseIdx] || null;
    for (const it of g.items) {
      it.phaseId = phase ? phase.id : null;
    }
  }

  return { items: sortiert, gruppen };
}

/**
 * Schreibt einen fertig berechneten Fahrplan auf die echten Asset-Maßnahmen zurück.
 * Bestehende Maßnahmen mit passender ID werden aktualisiert, neue werden angelegt.
 *
 * items: FahrplanItem[]
 * assetsList: Asset[]  (typischerweise ASSETS.items)
 *
 * Gibt Anzahl der geschriebenen Einträge zurück.
 */
export function fahrplanSchreibeAufAssets(items, assetsList) {
  const assets = assetsList || ASSETS?.items || [];
  let count = 0;
  for (const it of items) {
    const asset = assets.find(a => a.id === it.assetId);
    if (!asset) continue;
    if (!asset.massnahmen) asset.massnahmen = [];
    const vorh = asset.massnahmen.find(m => m.id === it.id);
    if (vorh) {
      // Bestehende Maßnahme aktualisieren (nur Felder die der Fahrplan setzt)
      Object.assign(vorh, {
        typ:       it.typ,
        titel:     it.titel,
        kosten:    it.kosten,
        phaseId:   it.phaseId,
        jahr:      it.jahr,
        dependsOn: it.dependsOn,
        newProps:  it.newProps || vorh.newProps || {},
        status:    vorh.status || 'geplant',
      });
    } else {
      asset.massnahmen.push({
        id:        it.id,
        typ:       it.typ,
        titel:     it.titel,
        kosten:    it.kosten,
        phaseId:   it.phaseId,
        jahr:      it.jahr,
        dependsOn: it.dependsOn,
        newProps:  it.newProps || {},
        status:    'geplant',
      });
    }
    count++;
  }
  return count;
}

// ── Interner Helper ───────────────────────────────────────────────────────────

function _itemJahr(it, phasenArr) {
  if (it.jahr != null) return parseInt(it.jahr);
  if (!it.phaseId || !phasenArr?.length) return null;
  const p = phasenArr.find(p => p.id === it.phaseId);
  return p ? parseInt(p.jahrVon) : null;
}
