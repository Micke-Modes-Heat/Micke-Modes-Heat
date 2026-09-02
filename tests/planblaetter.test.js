import { describe, expect, it } from 'vitest';
import { aktiveBlattIds, aufBlatt, aufAktiven, ladePlanwerk } from '../src/lib/planblaetter.js';

const altesProjekt = {
  plan: { name: 'Einlinienplan Nord', url: 'data:image/png;base64,AAAA', w: 2000, h: 1400, texts: [{ x: 1, y: 2, str: 'NYY-J 4x35' }] },
  nodes: [{ id: 'pn1', x: 10, y: 20, art: 'gebaeude', linkKind: 'g', linkId: 7, assetId: 'a1' }],
  links: [{ id: 'pl1', a: 'pn1', b: 'pn2', edgeId: 'e1' }],
  seq: 5, gebGroesse: 1.25, abgehakt: { 'g:9': 'nicht im Planausschnitt' },
};

describe('Migration alter Projektdateien', () => {
  it('hebt den Einzelplan auf ein erstes, aktives Blatt', () => {
    const p = ladePlanwerk(altesProjekt);
    expect(p.plaene).toHaveLength(1);
    expect(p.plaene[0]).toMatchObject({ name: 'Einlinienplan Nord', rolle: 'aktiv', w: 2000, h: 1400 });
    expect(p.aktivId).toBe(p.plaene[0].id);
  });

  it('hängt alle Marken an dieses Blatt — sonst wäre der Plan im Altprojekt leer', () => {
    const p = ladePlanwerk(altesProjekt);
    const id = p.plaene[0].id;
    expect(p.nodes.every(n => n.planId === id)).toBe(true);
    expect(p.links.every(l => l.planId === id)).toBe(true);
    expect(aufAktiven(p.nodes, p.plaene)).toHaveLength(1);
  });

  it('trägt Verknüpfungen, Zähler und Abhaken unverändert weiter', () => {
    const p = ladePlanwerk(altesProjekt);
    expect(p.nodes[0].assetId).toBe('a1');
    expect(p.links[0].edgeId).toBe('e1');
    expect(p.seq).toBe(5);
    expect(p.gebGroesse).toBe(1.25);
    expect(p.abgehakt).toEqual({ 'g:9': 'nicht im Planausschnitt' });
  });

  it('liefert null, wenn gar kein Plan gespeichert war', () => {
    expect(ladePlanwerk(null)).toBeNull();
    expect(ladePlanwerk({})).toBeNull();
    expect(ladePlanwerk({ plaene: [] })).toBeNull();
  });
});

describe('Blätter und Stände', () => {
  const werk = {
    plaene: [
      { id: 'pb1', name: 'Nord 2015', rolle: 'archiv', url: 'x', w: 100, h: 100 },
      { id: 'pb2', name: 'Nord 2026', rolle: 'aktiv', url: 'x', w: 100, h: 100 },
      { id: 'pb3', name: 'Süd', rolle: 'aktiv', url: 'x', w: 100, h: 100 },
    ],
    aktivId: 'pb2',
    nodes: [
      { id: 'n1', planId: 'pb1', linkId: 1 },   // alter Stand
      { id: 'n2', planId: 'pb2', linkId: 1 },   // derselbe Bau, neuer Stand
      { id: 'n3', planId: 'pb3', linkId: 2 },   // Nachbarblatt
    ],
    links: [{ id: 'l1', planId: 'pb1' }, { id: 'l2', planId: 'pb3' }],
  };

  it('vereinigt Blätter desselben Standes', () => {
    const p = ladePlanwerk(werk);
    // Nord 2026 UND Süd zählen — ohne die Vereinigung meldete der Abgleich
    // jedes Gebäude des Nachbarblatts als „nur auf der Karte".
    expect(aufAktiven(p.nodes, p.plaene).map(n => n.id)).toEqual(['n2', 'n3']);
    expect(aufAktiven(p.links, p.plaene).map(l => l.id)).toEqual(['l2']);
  });

  it('lässt abgelöste Stände draußen', () => {
    const p = ladePlanwerk(werk);
    expect(aktiveBlattIds(p.plaene).has('pb1')).toBe(false);
    expect(aufAktiven(p.nodes, p.plaene).some(n => n.planId === 'pb1')).toBe(false);
  });

  it('zeichnet nur das sichtbare Blatt', () => {
    const p = ladePlanwerk(werk);
    expect(aufBlatt(p.nodes, p.aktivId).map(n => n.id)).toEqual(['n2']);
  });

  it('behält das gespeicherte aktive Blatt bei', () => {
    expect(ladePlanwerk(werk).aktivId).toBe('pb2');
  });

  it('fällt auf das erste aktive Blatt zurück, wenn das gespeicherte fehlt', () => {
    const p = ladePlanwerk({ ...werk, aktivId: 'weg' });
    expect(p.aktivId).toBe('pb2');
  });

  it('wertet eine unbekannte Rolle als aktiv — ein stilles Archiv wäre der teurere Fehler', () => {
    const p = ladePlanwerk({ ...werk, plaene: [{ id: 'pb9', name: 'X', url: 'x', w: 1, h: 1 }], nodes: [], links: [] });
    expect(p.plaene[0].rolle).toBe('aktiv');
  });

  it('rettet Marken ohne bekanntes Blatt auf das erste Blatt', () => {
    const p = ladePlanwerk({ ...werk, nodes: [{ id: 'nX', planId: 'geloescht', assetId: 'a9' }] });
    expect(p.nodes[0].planId).toBe('pb1');
  });
});
