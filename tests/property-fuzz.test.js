import { describe, expect, it } from 'vitest';
import { validateProjectData } from '../src/lib/project-schema.js';
import { validateRadialHeatGraph } from '../src/lib/waerme-graph-validation.js';

function seeded(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 0x100000000);
}

describe('deterministische Property-/Fuzz-Prüfung', () => {
  it('validiert 400 verschieden große gültige Projekte ohne Eingabemutation', () => {
    const random = seeded();
    for (let run = 0; run < 400; run++) {
      const count = 1 + Math.floor(random() * 30);
      const baseLat = -80 + random() * 160;
      const baseLng = -170 + random() * 340;
      const project = {
        version: 2,
        gebaeude: Array.from({length:count}, (_, index) => ({
          id: index + 1,
          polygon: [
            {lat:baseLat, lng:baseLng},
            {lat:Math.min(89.999, baseLat + 0.0001), lng:baseLng},
            {lat:baseLat, lng:Math.min(179.999, baseLng + 0.0001)},
          ],
        })),
        trasse: [{lat:baseLat, lng:baseLng}, {lat:baseLat, lng:Math.min(179.999, baseLng + 0.001)}],
        trasseSegments: [{start:0, end:1, domains:['waerme']}],
      };
      const before = JSON.stringify(project);
      expect(validateProjectData(project).ok, `gültiger Fuzz-Lauf ${run}`).toBe(true);
      expect(JSON.stringify(project)).toBe(before);
    }
  });

  it('lehnt jede zufällig außerhalb der Erde liegende Koordinate ab', () => {
    const random = seeded(0xbadf00d);
    for (let run = 0; run < 300; run++) {
      const invalidLat = (90.0001 + random() * 10000) * (random() < 0.5 ? -1 : 1);
      const project = {
        version:2,
        gebaeude:[{id:1, polygon:[{lat:invalidLat,lng:0},{lat:0,lng:0},{lat:0,lng:1}]}],
      };
      const result = validateProjectData(project);
      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.includes('Koordinaten'))).toBe(true);
    }
  });

  it('erkennt bei 300 Zufallsbäumen Erreichbarkeit und jede zusätzliche Ringkante', () => {
    const random = seeded(0xc1c1e);
    for (let run = 0; run < 300; run++) {
      const nodeCount = 3 + Math.floor(random() * 80);
      const tree = [];
      for (let node = 2; node <= nodeCount; node++) {
        tree.push({u:node, v:1 + Math.floor(random() * (node - 1))});
      }
      const consumers = Array.from({length:nodeCount - 1}, (_, index) => index + 2);
      const radial = validateRadialHeatGraph(tree, 1, consumers);
      expect(radial.disconnectedConsumerIds).toEqual([]);
      expect(radial.cycleEdgeIndexes).toEqual([]);

      const ring = [...tree, {u:2, v:nodeCount}];
      expect(validateRadialHeatGraph(ring, 1, consumers).cycleEdgeIndexes.length).toBeGreaterThan(0);
    }
  });
});
