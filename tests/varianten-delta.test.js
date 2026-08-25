// Vitest-Tests für lib/varianten-delta.js — Varianten als Delta statt Vollkopie.
import { describe, it, expect } from 'vitest';
import {
  splitStromNetzState, mergeStromNetzState, istDelta, migriereZuDelta, GETEILTE_SCHICHTEN,
} from '../src/lib/varianten-delta.js';
import { SCHICHT } from '../src/lib/schichten.js';

// Netz: NAP(Bestand) ─e1─ Trafo(Bestand) ─e2─ PV(Entscheidung)
const netz = () => ({
  items: [
    { id: 'nap', type: 'NAP',   name: 'NAP 1',   schicht: SCHICHT.BESTAND },
    { id: 'tr',  type: 'Trafo', name: 'Trafo 1', schicht: SCHICHT.BESTAND },
    { id: 'pv',  type: 'PV',    name: 'PV neu',  schicht: SCHICHT.ENTSCHEIDUNG },
  ],
  nodes: [{ id: 'n1', type: 'nshv' }],
  edges: [
    { id: 'e1', u: 'nap', v: 'tr' },
    { id: 'e2', u: 'tr',  v: 'pv' },
  ],
  kabelTyp: 'NAYY',
});

describe('GETEILTE_SCHICHTEN', () => {
  it('teilt Bestand und Entwicklung, nicht die Entscheidung', () => {
    expect(GETEILTE_SCHICHTEN).toContain(SCHICHT.BESTAND);
    expect(GETEILTE_SCHICHTEN).toContain(SCHICHT.ENTWICKLUNG);
    expect(GETEILTE_SCHICHTEN).not.toContain(SCHICHT.ENTSCHEIDUNG);
  });
});

describe('splitStromNetzState', () => {
  it('legt Bestand und Entwicklung in den gemeinsamen Teil', () => {
    const s = netz();
    s.items.push({ id: 'nb', type: 'Verbraucher', schicht: SCHICHT.ENTWICKLUNG });
    const { gemeinsam } = splitStromNetzState(s);
    expect(gemeinsam.items.map(i => i.id).sort()).toEqual(['nap', 'nb', 'tr']);
  });

  it('legt Entscheidungen ins Delta', () => {
    const { delta } = splitStromNetzState(netz());
    expect(delta.items.map(i => i.id)).toEqual(['pv']);
  });

  it('ordnet eine Kante der SPÄTESTEN Schicht ihrer Endpunkte zu', () => {
    const { gemeinsam, delta } = splitStromNetzState(netz());
    // e1 hängt zwischen zwei Bestandsknoten → gemeinsam
    expect(gemeinsam.edges.map(e => e.id)).toEqual(['e1']);
    // e2 führt zur geplanten PV → existiert nur wegen ihr → Delta
    expect(delta.edges.map(e => e.id)).toEqual(['e2']);
  });

  it('behandelt Knoten ohne eigenes Asset als Bestand', () => {
    const s = { items: [], nodes: [], edges: [{ id: 'e', u: 'gebX', v: 'gebY' }] };
    const { gemeinsam, delta } = splitStromNetzState(s);
    expect(gemeinsam.edges).toHaveLength(1);
    expect(delta.edges).toHaveLength(0);
  });

  it('legt reine Infrastrukturknoten immer gemeinsam ab', () => {
    const { gemeinsam, delta } = splitStromNetzState(netz());
    expect(gemeinsam.nodes.map(n => n.id)).toEqual(['n1']);
    expect(delta.nodes).toEqual([]);
  });

  it('behält die Kabeltyp-Vorgabe im gemeinsamen Teil', () => {
    expect(splitStromNetzState(netz()).gemeinsam.kabelTyp).toBe('NAYY');
  });

  it('verträgt leere Eingaben', () => {
    const { gemeinsam, delta } = splitStromNetzState(null);
    expect(gemeinsam.items).toEqual([]);
    expect(delta.items).toEqual([]);
  });
});

describe('mergeStromNetzState', () => {
  it('stellt den ursprünglichen Zustand wieder her (Rundlauf)', () => {
    const s = netz();
    const { gemeinsam, delta } = splitStromNetzState(s);
    const zurueck = mergeStromNetzState(gemeinsam, delta);
    expect(zurueck.items.map(i => i.id).sort()).toEqual(s.items.map(i => i.id).sort());
    expect(zurueck.edges.map(e => e.id).sort()).toEqual(s.edges.map(e => e.id).sort());
    expect(zurueck.nodes.map(n => n.id)).toEqual(['n1']);
    expect(zurueck.kabelTyp).toBe('NAYY');
  });

  it('liefert bei leerem Delta nur den gemeinsamen Teil', () => {
    const { gemeinsam } = splitStromNetzState(netz());
    const z = mergeStromNetzState(gemeinsam, null);
    expect(z.items.map(i => i.id).sort()).toEqual(['nap', 'tr']);
  });

  it('lässt bei ID-Kollision den gemeinsamen Teil gewinnen', () => {
    const g = { items: [{ id: 'a', name: 'gemeinsam' }], nodes: [], edges: [] };
    const d = { items: [{ id: 'a', name: 'delta' }], nodes: [], edges: [] };
    expect(mergeStromNetzState(g, d).items).toEqual([{ id: 'a', name: 'gemeinsam' }]);
  });

  it('verträgt zwei leere Seiten', () => {
    expect(mergeStromNetzState(null, null).items).toEqual([]);
  });
});

describe('istDelta', () => {
  it('erkennt einen bereits migrierten Snapshot', () => {
    expect(istDelta({ items: [{ id: 'a', schicht: SCHICHT.ENTSCHEIDUNG }] })).toBe(true);
  });

  it('erkennt einen Altsnapshot mit Bestandsobjekten', () => {
    expect(istDelta(netz())).toBe(false);
  });

  it('wertet einen leeren Snapshot als Delta', () => {
    expect(istDelta({ items: [] })).toBe(true);
  });
});

describe('migriereZuDelta', () => {
  // Altprojekt: beide Varianten enthalten eine Vollkopie; Variante 2 hat
  // zusätzlich einen eigenen Erzeugungstrafo.
  const live = () => ({
    items: [
      { id: 'nap', type: 'NAP',   name: 'NAP 1',   schicht: SCHICHT.BESTAND },
      { id: 'tr',  type: 'Trafo', name: 'Trafo 1', schicht: SCHICHT.BESTAND },
    ],
    nodes: [], edges: [{ id: 'e1', u: 'nap', v: 'tr' }],
  });
  const varianten = () => ([
    { id: 'v1', name: 'Bestandsnetz', stromnetz: live() },
    { id: 'v2', name: 'Erzeugungsnetz', stromnetz: {
      items: [...live().items, { id: 'tr2', type: 'Trafo', name: 'Erzeugungstrafo', schicht: SCHICHT.BESTAND }],
      nodes: [], edges: [...live().edges, { id: 'e9', u: 'nap', v: 'tr2' }],
    } },
  ]);

  it('macht die überall vorhandenen Objekte gemeinsam', () => {
    const { gemeinsam } = migriereZuDelta({ live: live(), varianten: varianten() });
    expect(gemeinsam.items.map(i => i.id).sort()).toEqual(['nap', 'tr']);
  });

  it('befördert nur in einer Variante vorhandene Objekte zur Entscheidung', () => {
    const { deltas } = migriereZuDelta({ live: live(), varianten: varianten() });
    expect(deltas.v2.items).toHaveLength(1);
    expect(deltas.v2.items[0]).toMatchObject({ id: 'tr2', schicht: SCHICHT.ENTSCHEIDUNG, variante: 'v2' });
  });

  it('nimmt die zugehörigen Kanten ins Delta mit', () => {
    const { deltas } = migriereZuDelta({ live: live(), varianten: varianten() });
    expect(deltas.v2.edges.map(e => e.id)).toEqual(['e9']);
  });

  it('lässt eine Variante ohne Abweichung leer — sie hatte wirklich keine', () => {
    const { deltas } = migriereZuDelta({ live: live(), varianten: varianten() });
    expect(deltas.v1.items).toEqual([]);
    expect(deltas.v1.edges).toEqual([]);
  });

  it('berichtet, was befördert wurde', () => {
    const { bericht } = migriereZuDelta({ live: live(), varianten: varianten() });
    expect(bericht.befoerdert).toEqual([{ variante: 'v2', id: 'tr2', name: 'Erzeugungstrafo' }]);
  });

  it('weist abweichende Eigenschaften aus, statt sie stillschweigend zu verwerfen', () => {
    const v = varianten();
    v[0].stromnetz.items[1] = { ...v[0].stromnetz.items[1], props: { leistungKVA: 1000 } };
    const { bericht } = migriereZuDelta({ live: live(), varianten: v });
    expect(bericht.abweichungen).toEqual([{ variante: 'v1', id: 'tr', name: 'Trafo 1' }]);
  });

  it('verträgt ein Projekt ganz ohne Varianten', () => {
    const r = migriereZuDelta({ live: live(), varianten: [] });
    expect(r.deltas).toEqual({});
    expect(r.gemeinsam.items).toHaveLength(2);
  });

  it('verträgt komplett leere Eingaben', () => {
    const r = migriereZuDelta({});
    expect(r.gemeinsam.items).toEqual([]);
    expect(r.bericht.befoerdert).toEqual([]);
  });
});
