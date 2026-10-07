// Vitest-Tests für lib/netz-verlauf.js — Signatur, Änderungstexte und Rückgängig/Wiederholen.
import { describe, it, expect } from 'vitest';
import { netzSignatur, netzAenderungText, erstelleNetzVerlauf } from '../src/lib/netz-verlauf.js';

const knoten = [
  { id: 1, type: 'geb', lat: 52, lng: 8, load: 10 },
  { id: 2, type: 'geb', lat: 52.001, lng: 8, load: 12 },
  { id: 3, type: 'geb', lat: 52.002, lng: 8, load: 8 },
  { id: 10001, type: 'junction', lat: 52.0005, lng: 8.0005, load: 0 },
];
const kante = (u, v, extra = {}) => ({ u, v, dn: 40, waypoints: [], routingViaPoints: [], pruned: false, kostKlasse: null, ...extra });
const netz = (...edges) => ({ nodes: knoten.filter(n => edges.some(e => e.u === n.id || e.v === n.id)), edges });

describe('netzSignatur', () => {
  it('ist leer ohne Leitungen', () => {
    expect(netzSignatur(null)).toBe('');
    expect(netzSignatur({ nodes: [], edges: [] })).toBe('');
  });
  it('ignoriert DN, Lasten, Reihenfolge, Kantenrichtung und Lage der Gebäudeknoten', () => {
    const a = netz(kante(1, 10001), kante(10001, 2));
    const b = { nodes: [...a.nodes].reverse().map(n => (n.type === 'geb' ? { ...n, lat: n.lat + 1, load: 99 } : n)),
      edges: [kante(2, 10001, { dn: 80 }), kante(10001, 1, { dn: 25 })] };
    expect(netzSignatur(b)).toBe(netzSignatur(a));
  });
  it('erkennt Verlauf, Abzweiglage, manuelle Kostenklasse und Zeitfenster', () => {
    const a = netz(kante(1, 10001), kante(10001, 2));
    const basis = netzSignatur(a);
    expect(netzSignatur(netz(kante(1, 10001, { waypoints: [{ lat: 52.1, lng: 8.1 }] }), kante(10001, 2)))).not.toBe(basis);
    expect(netzSignatur({ ...a, nodes: a.nodes.map(n => (n.id === 10001 ? { ...n, lat: 52.0006 } : n)) })).not.toBe(basis);
    expect(netzSignatur(netz(kante(1, 10001, { kostKlasse: 'hoch', kostOverride: true }), kante(10001, 2)))).not.toBe(basis);
    // automatisch (verzögert) ermittelte Kostenklasse ist kein eigener Schritt
    expect(netzSignatur(netz(kante(1, 10001, { kostKlasse: 'mittel' }), kante(10001, 2)))).toBe(basis);
    expect(netzSignatur(netz(kante(1, 10001, { visibleFromYear: 2030 }), kante(10001, 2)))).not.toBe(basis);
  });
});

describe('netzAenderungText', () => {
  const leer = { nodes: [], edges: [] };
  const zwei = netz(kante(1, 10001), kante(10001, 2));
  it('beschreibt Erstellen und Entfernen', () => {
    expect(netzAenderungText(leer, zwei)).toBe('Netz erstellt (2 Leitungsabschnitte)');
    expect(netzAenderungText(zwei, leer)).toBe('Netz entfernt');
  });
  it('beschreibt An- und Abschließen von Gebäuden', () => {
    const drei = netz(kante(1, 10001), kante(10001, 2), kante(10001, 3));
    expect(netzAenderungText(zwei, drei)).toBe('Gebäude angeschlossen');
    expect(netzAenderungText(drei, zwei)).toBe('Gebäudeanschluss entfernt');
  });
  it('beschreibt Verlauf, Umhängen und entfernte Leitungen', () => {
    const verlauf = netz(kante(1, 10001, { waypoints: [{ lat: 52.1, lng: 8 }] }), kante(10001, 2));
    expect(netzAenderungText(zwei, verlauf)).toBe('Leitungsverlauf geändert');
    expect(netzAenderungText(zwei, netz(kante(1, 2), kante(10001, 2)))).toBe('Gebäudeanschluss umgehängt');
    const drei = netz(kante(1, 10001), kante(10001, 2), kante(1, 2));
    expect(netzAenderungText(drei, zwei)).toBe('Leitung entfernt');
  });
});

describe('erstelleNetzVerlauf', () => {
  it('geht schrittweise zurück und wieder vor', () => {
    const v = erstelleNetzVerlauf();
    const s0 = { nodes: [], edges: [] }, s1 = netz(kante(1, 2)), s2 = netz(kante(1, 2), kante(2, 3));
    expect(v.kannRueckgaengig).toBe(false);
    v.merken(s0, 'Netz erstellt'); v.merken(s1, 'Gebäude angeschlossen');
    expect(v.textRueckgaengig).toBe('Gebäude angeschlossen');
    const a = v.rueckgaengig(s2);
    expect(a.graph).toEqual(s1);
    expect(v.textWiederholen).toBe('Gebäude angeschlossen');
    const b = v.rueckgaengig(s1);
    expect(b.graph).toEqual(s0);
    expect(v.rueckgaengig(s0)).toBeNull();
    expect(v.wiederholen(s0).graph).toEqual(s1);
    expect(v.wiederholen(s1).graph).toEqual(s2);
    expect(v.kannWiederholen).toBe(false);
  });
  it('eine neue Änderung verwirft den Wiederholen-Stapel', () => {
    const v = erstelleNetzVerlauf();
    v.merken(netz(kante(1, 2)), 'x');
    v.rueckgaengig(netz(kante(1, 3)));
    expect(v.kannWiederholen).toBe(true);
    v.merken(netz(kante(1, 2)), 'y');
    expect(v.kannWiederholen).toBe(false);
  });
  it('speichert Kopien und begrenzt die Länge', () => {
    const v = erstelleNetzVerlauf({ grenze: 2 });
    const g = netz(kante(1, 2));
    v.merken(g, 'a'); g.edges.push(kante(2, 3));
    v.merken(netz(kante(1, 3)), 'b'); v.merken(netz(kante(2, 3)), 'c');
    expect(v.rueckgaengig({ nodes: [], edges: [] }).text).toBe('c');
    expect(v.rueckgaengig({ nodes: [], edges: [] }).text).toBe('b');
    expect(v.rueckgaengig({ nodes: [], edges: [] })).toBeNull();
    v.leeren();
    expect(v.kannRueckgaengig || v.kannWiederholen).toBe(false);
  });
});
