// ── lib/netz-verlauf.js — Rückgängig/Wiederholen für das Wärmenetz ──
// DOM-frei. Gearbeitet wird mit dem JSON-Graphen aus captureWaermeNetzGraph(): { nodes, edges }.
// Die Oberfläche (03b-netz.js) vergleicht nach jeder Netzberechnung die Signatur des Graphen mit dem
// letzten Stand. Nur eine echte Strukturänderung (Leitung, Anschluss, Verlauf) wird ein Schritt —
// automatisch neu berechnete DN, Lasten oder verschobene Gebäudemittelpunkte nicht.

/**
 * Strukturschlüssel des Netzes. Enthält Knoten (Gebäudeknoten nur mit Kennung, da ihre Lage aus dem
 * Grundriss folgt), Kanten mit Verlauf, manuell gesetzter Kostenklasse, Sperren und Zeitfenstern. DN, Lasten
 * und die automatisch (verzögert über OSM) ermittelte Kostenklasse fehlen bewusst, weil sie neu berechnet werden.
 */
export function netzSignatur(graph) {
  if (!graph || !Array.isArray(graph.edges) || !graph.edges.length) return '';
  const r = v => Math.round(Number(v) * 1e6) / 1e6;
  const pt = p => (p ? `${r(p.lat)},${r(p.lng)}` : '');
  const knoten = (graph.nodes || [])
    .map(n => (n.type === 'geb' ? `g${n.id}` : `${n.type || 'j'}${n.id}@${pt(n)}`))
    .sort();
  const kanten = graph.edges.map(e => {
    const [a, b] = Number(e.u) <= Number(e.v) ? [e.u, e.v] : [e.v, e.u];
    const wege = (e.waypoints || []).map(pt).join(';');
    const via = (e.routingViaPoints || []).map(pt).join(';');
    return [a, b, wege, via, e.pruned ? 'p' : '', e.kostOverride ? `k${e.kostKlasse || ''}` : '',
      e.visibleFromYear ?? '', e.visibleUntilYear ?? ''].join('|');
  }).sort();
  return `${knoten.join(' ')}#${kanten.join(' ')}`;
}

const gebKnoten = graph => new Set((graph?.nodes || []).filter(n => n.type === 'geb').map(n => n.id));

/** Kurzbeschreibung einer Änderung für Schaltflächen und Hinweise („Rückgängig: …“). */
export function netzAenderungText(vorher, nachher) {
  const kv = vorher?.edges?.length || 0, kn = nachher?.edges?.length || 0;
  if (kv && !kn) return 'Netz entfernt';
  if (!kv && kn) return `Netz erstellt (${kn} Leitungsabschnitte)`;
  const gv = gebKnoten(vorher), gn = gebKnoten(nachher);
  const neu = [...gn].filter(id => !gv.has(id)).length, weg = [...gv].filter(id => !gn.has(id)).length;
  if (neu && !weg) return neu === 1 ? 'Gebäude angeschlossen' : `${neu} Gebäude angeschlossen`;
  if (weg && !neu) return weg === 1 ? 'Gebäudeanschluss entfernt' : `${weg} Gebäudeanschlüsse entfernt`;
  if (Math.abs(kn - kv) > 3 || (neu && weg)) return `Netz neu aufgebaut (${kn} Leitungsabschnitte)`;
  if (kn < kv) return kv - kn === 1 ? 'Leitung entfernt' : `${kv - kn} Leitungen entfernt`;
  const verbindungen = g => new Set((g?.edges || []).map(e => [e.u, e.v].sort().join('-')));
  const vv = verbindungen(vorher), vn = verbindungen(nachher);
  const gleich = vv.size === vn.size && [...vv].every(k => vn.has(k));
  if (gleich) return 'Leitungsverlauf geändert';
  return 'Gebäudeanschluss umgehängt';
}

/**
 * Verlauf mit Rückgängig- und Wiederholen-Stapel. Gespeichert werden tiefe Kopien der Graphen.
 * merken(vorher, text) legt den Stand vor einer Änderung ab und leert den Wiederholen-Stapel.
 * rueckgaengig(aktuell) / wiederholen(aktuell) liefern { graph, text } oder null.
 */
export function erstelleNetzVerlauf({ grenze = 40 } = {}) {
  const kopie = g => JSON.parse(JSON.stringify(g || { nodes: [], edges: [] }));
  let zurueck = [], vor = [];
  return {
    merken(vorher, text) {
      zurueck.push({ graph: kopie(vorher), text });
      if (zurueck.length > grenze) zurueck.shift();
      vor = [];
    },
    rueckgaengig(aktuell) {
      const schritt = zurueck.pop();
      if (!schritt) return null;
      vor.push({ graph: kopie(aktuell), text: schritt.text });
      return schritt;
    },
    wiederholen(aktuell) {
      const schritt = vor.pop();
      if (!schritt) return null;
      zurueck.push({ graph: kopie(aktuell), text: schritt.text });
      return schritt;
    },
    leeren() { zurueck = []; vor = []; },
    get kannRueckgaengig() { return zurueck.length > 0; },
    get kannWiederholen() { return vor.length > 0; },
    get textRueckgaengig() { return zurueck.at(-1)?.text || ''; },
    get textWiederholen() { return vor.at(-1)?.text || ''; },
  };
}
