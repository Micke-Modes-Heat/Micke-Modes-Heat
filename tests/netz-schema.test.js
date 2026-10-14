import { describe, it, expect } from 'vitest';
import { netzSchemaLayout, dnText } from '../src/lib/netz-schema.js';

describe('Netzschema', () => {
  // Zentrale 1 → T10 → T11 (Abzweig) → Gebäude 2, 3; T11 hat zwei Kinder, T10 nur eines (Durchgang)
  const eltern = new Map([[10, 1], [11, 10], [2, 11], [3, 11]]);
  const kante = new Map([[10, { dn: 100, length: 50, load: 300 }], [11, { dn: 80, length: 30, load: 300 }], [2, { dn: 50, length: 20, load: 150 }], [3, { dn: 40, length: 25, load: 150 }]]);
  const knoten = new Map([[1, { typ: 'geb', name: 'HZ' }], [2, { typ: 'geb', name: 'A', last: 150 }], [3, { typ: 'geb', name: 'B', last: 150 }], [10, { typ: 'trasse' }], [11, { typ: 'junction' }]]);
  it('fasst Durchgangsknoten zusammen und summiert Länge und DN-Spanne', () => {
    const l = netzSchemaLayout({ wurzeln: [1], eltern, kante, knoten });
    expect(l.knoten.map(k => k.id).sort()).toEqual([1, 11, 2, 3]);
    const zuAbzweig = l.kanten.find(k => k.von === 1 && k.nach === 11);
    expect(zuAbzweig.laenge).toBe(80);
    expect(dnText(zuAbzweig.dnMin, zuAbzweig.dnMax)).toBe('DN 80–100');
    expect(l.knoten.find(k => k.id === 1).typ).toBe('zentrale');
  });
  it('Blätter untereinander, Zentrale links, Abzweig mittig', () => {
    const l = netzSchemaLayout({ wurzeln: [1], eltern, kante, knoten }, { spalteBreit: 100, zeileHoch: 20, rand: 0 });
    const p = id => l.knoten.find(k => k.id === id);
    expect(p(1).x).toBe(0);
    expect(p(2).x).toBe(200);
    expect(Math.abs(p(2).y - p(3).y)).toBe(20);
    expect(p(11).y).toBe((p(2).y + p(3).y) / 2);
  });
  it('mehrere Zentralen und Verbindungsleitung', () => {
    const l = netzSchemaLayout({ wurzeln: [1, 5], eltern: new Map([[2, 1], [6, 5]]), kante: new Map([[2, { dn: 50, length: 10 }], [6, { dn: 50, length: 10 }]]),
      knoten: new Map([[1, { typ: 'geb' }], [2, { typ: 'geb' }], [5, { typ: 'geb' }], [6, { typ: 'geb' }]]), kuppel: [{ u: 2, v: 6, dn: 80, length: 300, load: 400 }] });
    expect(l.knoten.filter(k => k.typ === 'zentrale')).toHaveLength(2);
    expect(l.kuppel).toHaveLength(1);
  });
});
