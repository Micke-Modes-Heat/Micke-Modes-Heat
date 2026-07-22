import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('Importarchitektur', () => {
  it('lässt die bereinigten Zweierzyklen nicht zurückkehren und den Altkern nicht wachsen', () => {
    const output = execFileSync(process.execPath, ['tools/import-graph.mjs', '--json'], {encoding:'utf8'});
    const graph = JSON.parse(output);
    expect(graph.cyclicComponents).toBeLessThanOrEqual(1);
    expect(graph.largestCycle).toBeLessThanOrEqual(33);
    expect(graph.cycles.flat()).not.toContain('10e-optimizer-session.js');
    expect(graph.cycles.flat()).not.toContain('config/wind-defaults.js');
  });
});
