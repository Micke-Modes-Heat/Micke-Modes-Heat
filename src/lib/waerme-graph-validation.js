// @ts-check
// DOM-freie Topologieprüfung für das Wärmenetz. Die thermohydraulische
// Rechnung ist derzeit radial; Ringe dürfen deshalb nicht still als vollständig
// gelöst erscheinen.
/** @param {Array<{u: number|string, v: number|string, pruned?: boolean}>} edges @param {number|string|null} rootId @param {Array<number|string>} [consumerNodeIds] */
export function validateRadialHeatGraph(edges, rootId, consumerNodeIds = []) {
  const adjacency = new Map();
  /** @type {Array<{edge:{u:number|string,v:number|string,pruned?:boolean},index:number}>} */
  const active = [];
  edges.forEach((edge, index) => {
    if (edge.pruned) return;
    active.push({edge, index});
    if (!adjacency.has(edge.u)) adjacency.set(edge.u, []);
    if (!adjacency.has(edge.v)) adjacency.set(edge.v, []);
    adjacency.get(edge.u).push({to: edge.v, index});
    adjacency.get(edge.v).push({to: edge.u, index});
  });
  const reachable = new Set(rootId == null ? [] : [rootId]);
  const treeEdgeIndexes = new Set();
  const queue = rootId == null ? [] : [rootId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (reachable.has(next.to)) continue;
      reachable.add(next.to);
      treeEdgeIndexes.add(next.index);
      queue.push(next.to);
    }
  }
  const cycleEdgeIndexes = active
    .filter(({edge, index}) => reachable.has(edge.u) && reachable.has(edge.v) && !treeEdgeIndexes.has(index))
    .map(({index}) => index);
  const disconnectedConsumerIds = consumerNodeIds.filter(id => !reachable.has(id));
  return {reachable, treeEdgeIndexes, cycleEdgeIndexes, disconnectedConsumerIds};
}
