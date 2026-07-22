import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { validateProjectData } from '../src/lib/project-schema.js';
import { validateRadialHeatGraph } from '../src/lib/waerme-graph-validation.js';

describe('Performancebudgets für große Kerndaten', () => {
  it('validiert ein Projekt mit 2.000 Gebäuden unter 1 Sekunde', () => {
    const gebaeude = Array.from({length:2000}, (_, index) => {
      const lat = 48 + (index % 100) * 0.0001;
      const lng = 9 + Math.floor(index / 100) * 0.0001;
      return {id:index + 1, polygon:[{lat,lng},{lat:lat + 0.00005,lng},{lat,lng:lng + 0.00005}]};
    });
    const started = performance.now();
    const result = validateProjectData({version:2, gebaeude});
    const durationMs = performance.now() - started;
    expect(result.ok).toBe(true);
    expect(durationMs).toBeLessThan(1000);
  });

  it('prüft einen Wärmebaum mit 5.000 Knoten unter 1 Sekunde und linearer Ergebnismenge', () => {
    const edges = Array.from({length:4999}, (_, index) => ({u:index + 1, v:index + 2}));
    const consumers = Array.from({length:4999}, (_, index) => index + 2);
    const started = performance.now();
    const result = validateRadialHeatGraph(edges, 1, consumers);
    const durationMs = performance.now() - started;
    expect(result.reachable.size).toBe(5000);
    expect(result.treeEdgeIndexes.size).toBe(4999);
    expect(result.cycleEdgeIndexes).toEqual([]);
    expect(result.disconnectedConsumerIds).toEqual([]);
    expect(durationMs).toBeLessThan(1000);
  });
});
