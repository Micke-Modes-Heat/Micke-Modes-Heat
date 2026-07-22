import { describe, expect, it } from 'vitest';
import { validateRadialHeatGraph } from '../src/lib/waerme-graph-validation.js';

describe('Wärmenetz-Topologieprüfung', () => {
  it('erkennt Ringkanten, die der radiale Rechenweg nicht löst', () => {
    const edges = [{u:1,v:2}, {u:2,v:3}, {u:3,v:1}];
    const result = validateRadialHeatGraph(edges, 1, [2, 3]);
    expect(result.cycleEdgeIndexes).toHaveLength(1);
    expect(result.disconnectedConsumerIds).toEqual([]);
  });

  it('meldet nicht erreichbare Verbraucher eindeutig', () => {
    const result = validateRadialHeatGraph([{u:1,v:2}, {u:3,v:4}], 1, [2, 3]);
    expect(result.disconnectedConsumerIds).toEqual([3]);
  });

  it('ignoriert stillgelegte Kanten', () => {
    const result = validateRadialHeatGraph([{u:1,v:2}, {u:2,v:3,pruned:true}], 1, [3]);
    expect(result.disconnectedConsumerIds).toEqual([3]);
    expect(result.cycleEdgeIndexes).toEqual([]);
  });
});
