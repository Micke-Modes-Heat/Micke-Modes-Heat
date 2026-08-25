// ── lib/varianten-delta.js — Varianten als Delta statt als Vollkopie ─────────
//
// Bisher besaß JEDE Variante ein vollständiges eigenes Stromnetz
// (captureStromNetzState/applyStromNetzState in 05b). Der Bestand existierte
// damit n+1 mal, mit zwei Folgen:
//   • Eine Bestandskorrektur (z. B. eine nachgetragene Kabellänge) galt nur in
//     der aktiven Variante — in allen anderen blieb der Fehler stehen, lautlos.
//   • Ein Neubau, den man in Variante 1 anlegt, fehlt in Variante 2. Der
//     Vergleich läuft dann gegen zwei verschiedene Zukünfte, sieht aber sauber aus.
//
// Mit den Planungsschichten (lib/schichten.js) lässt sich das auftrennen:
//   Bestand + Entwicklung  → GEMEINSAM, existiert genau einmal
//   Entscheidung           → DELTA je Variante
//
// Beim Variantenwechsel wird aus gemeinsam + delta zusammengesetzt. Die
// bestehende Teardown/Rebuild-Mechanik in 05b bleibt dadurch unverändert —
// sie bekommt nur einen anderen Zustand vorgesetzt.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.

import { SCHICHT, normSchicht, schichtRang } from './schichten.js';

/** Schichten, die über alle Varianten hinweg geteilt werden. */
export const GETEILTE_SCHICHTEN = [SCHICHT.BESTAND, SCHICHT.ENTWICKLUNG];

const _istGeteilt = s => normSchicht(s) !== SCHICHT.ENTSCHEIDUNG;

const _leer = () => ({ items: [], nodes: [], edges: [] });

/**
 * Schicht einer Kante innerhalb eines Snapshots.
 *
 * Knoten ohne eigenes Asset (Gebäude-Anschlusspunkte, reine Infrastruktur-
 * knoten) gelten als Bestand: Gebäude sind ohnehin variantenübergreifend, und
 * für die Delta-Entscheidung zählt allein, ob ENTSCHEIDUNG beteiligt ist.
 */
function _kantenSchicht(edge, schichtVonId) {
  const a = schichtVonId(edge?.u);
  const b = schichtVonId(edge?.v);
  return schichtRang(a) >= schichtRang(b) ? normSchicht(a) : normSchicht(b);
}

/**
 * Zerlegt einen Stromnetz-Snapshot in gemeinsamen Teil und Varianten-Delta.
 *
 * state: { items, nodes, edges } wie von captureStromNetzState geliefert
 * Rückgabe: { gemeinsam, delta } — beide in derselben Form.
 */
export function splitStromNetzState(state) {
  const items = state?.items || [];
  const nodes = state?.nodes || [];
  const edges = state?.edges || [];

  const schichtJeId = new Map(items.map(i => [i.id, normSchicht(i.schicht)]));
  const schichtVonId = id => schichtJeId.get(id) ?? SCHICHT.BESTAND;

  const gemeinsam = _leer();
  const delta = _leer();

  for (const i of items) (_istGeteilt(i.schicht) ? gemeinsam : delta).items.push(i);
  for (const e of edges) (_istGeteilt(_kantenSchicht(e, schichtVonId)) ? gemeinsam : delta).edges.push(e);
  // Reine Infrastrukturknoten tragen keine Schicht → immer gemeinsam.
  gemeinsam.nodes = [...nodes];

  // Kabeltyp-Vorgabe ist eine Einstellung, kein Objekt — sie gehört zum
  // gemeinsamen Teil, damit sie beim Variantenwechsel nicht verlorengeht.
  if (state?.kabelTyp != null) gemeinsam.kabelTyp = state.kabelTyp;

  return { gemeinsam, delta };
}

/**
 * Setzt gemeinsamen Teil und Delta wieder zu einem vollständigen Snapshot
 * zusammen. Bei ID-Kollisionen gewinnt der gemeinsame Teil — er ist die
 * einzige Wahrheit über Bestand und Entwicklung.
 */
export function mergeStromNetzState(gemeinsam, delta) {
  const g = gemeinsam || _leer();
  const d = delta || _leer();

  const vereinen = (a, b) => {
    const out = [];
    const gesehen = new Set();
    for (const x of [...(a || []), ...(b || [])]) {
      const key = x?.id ?? `${x?.u}|${x?.v}`;
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      out.push(x);
    }
    return out;
  };

  return {
    items: vereinen(g.items, d.items),
    nodes: vereinen(g.nodes, d.nodes),
    edges: vereinen(g.edges, d.edges),
    kabelTyp: g.kabelTyp ?? d.kabelTyp ?? null,
  };
}

/** Ist ein Snapshot bereits migriert (enthält also kein Gemeinsames mehr)? */
export function istDelta(state) {
  return (state?.items || []).every(i => !_istGeteilt(i.schicht));
}

/**
 * Überführt Altprojekte vom Vollkopie- ins Delta-Modell.
 *
 * Altprojekte enthalten in JEDER Variante ein komplettes Netz, dessen Objekte
 * durch die Schicht-Rückfüllung sämtlich als Bestand/Entwicklung gelten. Würde
 * man einfach nur nach Schicht aufteilen, wären alle Deltas leer und die
 * Varianten damit ununterscheidbar — vorhandene Variantenarbeit ginge still
 * verloren.
 *
 * Deshalb wird zusätzlich verglichen: Objekte, die es NUR in einer Variante
 * gibt, sind offensichtlich variantenspezifisch und werden zur Entscheidung
 * befördert. Objekte, die überall vorkommen, werden gemeinsam.
 *
 * Abweichende Eigenschaften desselben Objekts lassen sich im Delta-Modell nicht
 * abbilden (der Bestand ist gemeinsam) — solche Fälle werden im Bericht
 * ausgewiesen statt stillschweigend übergangen.
 *
 * eingabe: { live, varianten: [{ id, name, stromnetz }] }
 *   live — der aktuell geladene Zustand; er bestimmt den gemeinsamen Teil.
 *
 * Rückgabe: { gemeinsam, deltas: { [variantId]: delta }, bericht }
 */
export function migriereZuDelta({ live, varianten } = {}) {
  const basis = live || _leer();
  const { gemeinsam } = splitStromNetzState(basis);

  const gemeinsameItemIds = new Set(gemeinsam.items.map(i => i.id));
  const gemeinsameKantenIds = new Set(gemeinsam.edges.map(e => e.id ?? `${e.u}|${e.v}`));

  const deltas = {};
  const bericht = { befoerdert: [], abweichungen: [] };

  for (const v of (varianten || [])) {
    const snap = v?.stromnetz || _leer();
    const eigeneItems = [];
    const eigeneKanten = [];

    for (const i of (snap.items || [])) {
      if (!gemeinsameItemIds.has(i.id)) {
        // Nur in dieser Variante vorhanden → echte Planungsentscheidung.
        // Ein eigenes `variante`-Feld braucht es NICHT: Die Zugehörigkeit ergibt
        // sich daraus, in welchem Delta das Objekt liegt. Ein zusätzliches Feld
        // müsste bei jedem Anlegen mitgepflegt werden und liefe sonst auseinander.
        eigeneItems.push({ ...i, schicht: SCHICHT.ENTSCHEIDUNG });
        bericht.befoerdert.push({ variante: v.id, id: i.id, name: i.name });
      } else if (_weichtAb(i, gemeinsam.items.find(g => g.id === i.id))) {
        bericht.abweichungen.push({ variante: v.id, id: i.id, name: i.name });
      }
    }
    for (const e of (snap.edges || [])) {
      const key = e.id ?? `${e.u}|${e.v}`;
      if (!gemeinsameKantenIds.has(key)) eigeneKanten.push({ ...e });
    }

    deltas[v.id] = { items: eigeneItems, nodes: [], edges: eigeneKanten };
  }

  return { gemeinsam, deltas, bericht };
}

// ── Variantenvergleich ───────────────────────────────────────────────────────

/**
 * Kennwert eines geplanten Objekts — das, was bei diesem Typ die Größe ausmacht.
 * Gibt { wert, einheit } oder null (dann zählt nur die Stückzahl).
 */
function _kennwert(item) {
  const p = item?.props || {};
  const z = k => { const v = parseFloat(p[k]); return Number.isFinite(v) ? v : null; };
  switch (item?.type) {
    case 'PV':       return z('leistungKWp')   != null ? { wert: z('leistungKWp'),   einheit: 'kWp' } : null;
    case 'Batterie': return z('kapazitaetKWh') != null ? { wert: z('kapazitaetKWh'), einheit: 'kWh' } : null;
    case 'Trafo':    return z('leistungKVA')   != null ? { wert: z('leistungKVA'),   einheit: 'kVA' } : null;
    case 'Wind':
    case 'Nsa':      return z('leistungKW')    != null ? { wert: z('leistungKW'),    einheit: 'kW' }  : null;
    case 'KWK':      return z('leistungElKW')  != null ? { wert: z('leistungElKW'),  einheit: 'kW' }  : null;
    default:         return null;
  }
}

/**
 * Verdichtet ein Delta zu einer Zusammenfassung je Anlagentyp.
 * Rückgabe: [{ type, anzahl, summe, einheit }] — nach Stückzahl absteigend.
 */
export function fasseDeltaZusammen(delta) {
  const proTyp = new Map();
  for (const i of (delta?.items || [])) {
    if (!proTyp.has(i.type)) proTyp.set(i.type, { type: i.type, anzahl: 0, summe: 0, einheit: null });
    const g = proTyp.get(i.type);
    g.anzahl++;
    const kw = _kennwert(i);
    if (kw) { g.summe += kw.wert; g.einheit = kw.einheit; }
  }
  return [...proTyp.values()].sort((a, b) => b.anzahl - a.anzahl || a.type.localeCompare(b.type));
}

/**
 * Vergleich aller Varianten OHNE Umschalten.
 *
 * Erst durch das Delta-Modell möglich: Die Planungsentscheidungen jeder
 * Variante liegen als eigene, kleine Liste vor und lassen sich direkt lesen.
 * Vorher hätte man jede Variante aktivieren und dabei das ganze Netz neu
 * aufbauen müssen, nur um zu sehen, was darin geplant ist.
 *
 * eingabe: { basisDelta, varianten, aktiveVarianteId, gemeinsam, liveDelta }
 *   liveDelta — Delta des GERADE bearbeiteten Zustands. Nötig, weil das
 *     gespeicherte Delta einer Variante erst beim Wechsel geschrieben wird:
 *     ohne diesen Wert zeigte die aktive Spalte den Stand vom letzten Wechsel
 *     und unterschlüge alles, was seither angelegt wurde.
 * Rückgabe: {
 *   gemeinsam: { items, edges },        // Kennzahlen der geteilten Grundlage
 *   spalten: [{ id, name, aktiv, anzahl, kabel, zusammenfassung, items }]
 * }
 * Die Basisdaten erscheinen als erste Spalte mit id === null.
 */
export function variantenVergleich({ basisDelta, varianten, aktiveVarianteId, gemeinsam, liveDelta } = {}) {
  const aktivId = aktiveVarianteId ?? null;
  const spalte = (id, name, delta) => {
    const aktiv = aktivId === id;
    const d = (aktiv && liveDelta) ? liveDelta : delta;
    return {
      id, name, aktiv,
      anzahl: (d?.items || []).length,
      kabel: (d?.edges || []).length,
      zusammenfassung: fasseDeltaZusammen(d),
      items: [...(d?.items || [])],
    };
  };

  return {
    gemeinsam: {
      items: (gemeinsam?.items || []).length,
      edges: (gemeinsam?.edges || []).length,
    },
    spalten: [
      spalte(null, 'Basisdaten', basisDelta),
      ...(varianten || []).map(v => spalte(v.id, v.name, v.stromnetz)),
    ],
  };
}

// Vergleicht die planungsrelevanten Eigenschaften zweier Assets.
function _weichtAb(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return true;
  if (String(a.baujahr ?? '') !== String(b.baujahr ?? '')) return true;
  if (String(a.abrissjahr ?? '') !== String(b.abrissjahr ?? '')) return true;
  return JSON.stringify(a.props || {}) !== JSON.stringify(b.props || {});
}
