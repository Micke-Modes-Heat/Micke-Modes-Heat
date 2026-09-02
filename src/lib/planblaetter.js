// ── lib/planblaetter.js — Blätter und Stände eines Bestandsplanwerks ────────
//
// DOM-frei, damit sich die beiden Stellen prüfen lassen, an denen ein Fehler
// still bliebe und teuer wäre:
//
//   • die MIGRATION alter Projektdateien. Vor dem Umbau lag genau ein Plan
//     unter `plan`; wird der nicht auf ein Blatt gehoben, ist der Bestandsplan
//     in jedem Altprojekt wortlos leer.
//   • die VEREINIGUNG über die aktiven Blätter. Ein Planwerk besteht aus
//     Blättern, die sich ergänzen — und liegt in Ständen vor, die einander
//     ablösen. Zählt ein abgelöster Stand mit, gilt ein längst abgerissenes
//     Gebäude weiter als erfasst; zählt ein Nachbarblatt nicht mit, meldet der
//     Abgleich das halbe Planwerk als „nur auf der Karte".
//
// Siehe docs/planblaetter-konzept.md.

/** Blätter, die fachlich zählen — alles außer Archiv (abgelöste Stände). */
export function aktiveBlattIds(plaene) {
  return new Set((plaene || []).filter(b => b && b.rolle !== 'archiv').map(b => b.id));
}

/** Einträge/Kabel eines einzelnen Blattes (Zeichnen, Bedienen). */
export function aufBlatt(items, blattId) {
  return (items || []).filter(x => x && x.planId === blattId);
}

/** Einträge/Kabel aller aktiven Blätter (Abgleich, Übernahme, Netzprüfungen). */
export function aufAktiven(items, plaene) {
  const ids = aktiveBlattIds(plaene);
  return (items || []).filter(x => x && ids.has(x.planId));
}

/**
 * Serialisierten Bestand auf das Blätter-Format bringen.
 * Nimmt beide Formate entgegen (alt: ein `plan`; neu: `plaene[]`) und liefert
 * entweder einen vollständigen, in sich stimmigen Zustand oder null.
 */
export function ladePlanwerk(data) {
  if (!data || typeof data !== 'object') return null;

  const roh = (!Array.isArray(data.plaene) && data.plan && data.plan.url)
    ? _ausEinzelplan(data)
    : data;
  if (!Array.isArray(roh.plaene) || !roh.plaene.length) return null;

  const plaene = roh.plaene.map(b => ({
    ...b,
    // Unbekannte Rolle heißt aktiv: ein Blatt stillschweigend ins Archiv zu
    // legen wäre der gefährlichere Fehler — es fiele aus jedem Abgleich.
    rolle: b.rolle === 'archiv' ? 'archiv' : 'aktiv',
    stand: typeof b.stand === 'string' ? b.stand : '',
    texts: Array.isArray(b.texts) ? b.texts : [],
  }));
  const idsDa = new Set(plaene.map(b => b.id));

  // Marken ohne (bekanntes) Blatt gehören dem ersten Blatt zu. Sie entstehen
  // nur bei von Hand bearbeiteten Projektdateien — sie wegzuwerfen wäre der
  // größere Schaden, denn sie tragen die Verknüpfungen zur Karte.
  const heim = plaene[0].id;
  const nodes = (Array.isArray(roh.nodes) ? roh.nodes : [])
    .map(n => ({ ...n, planId: idsDa.has(n.planId) ? n.planId : heim }));
  const links = (Array.isArray(roh.links) ? roh.links : [])
    .map(l => ({ ...l, planId: idsDa.has(l.planId) ? l.planId : heim }));

  const aktivId = idsDa.has(roh.aktivId)
    ? roh.aktivId
    : (plaene.find(b => b.rolle !== 'archiv') || plaene[0]).id;

  return {
    plaene, aktivId, nodes, links,
    planSeq: Number.isFinite(roh.planSeq) ? roh.planSeq : plaene.length + 1,
    seq: Number.isFinite(roh.seq) ? roh.seq : nodes.length + links.length + 1,
    gebGroesse: Number.isFinite(roh.gebGroesse) ? roh.gebGroesse : 1,
    abgehakt: (roh.abgehakt && typeof roh.abgehakt === 'object') ? { ...roh.abgehakt } : {},
  };
}

// Altformat: ein einzelner Plan ohne Blattbegriff wird das erste Blatt.
function _ausEinzelplan(data) {
  const id = 'pb1';
  return {
    plaene: [{
      id, name: data.plan.name || 'Bestandsplan', stand: '', rolle: 'aktiv',
      url: data.plan.url, w: data.plan.w, h: data.plan.h, texts: data.plan.texts,
    }],
    aktivId: id,
    planSeq: 2,
    nodes: (Array.isArray(data.nodes) ? data.nodes : []).map(n => ({ ...n, planId: id })),
    links: (Array.isArray(data.links) ? data.links : []).map(l => ({ ...l, planId: id })),
    seq: data.seq, gebGroesse: data.gebGroesse, abgehakt: data.abgehakt,
  };
}
