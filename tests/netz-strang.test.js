// Vitest-Tests für lib/netz-strang.js — Strang umlegen: Teilnetz, verwaiste Abzweige, Wegsuche.
import { describe, it, expect } from 'vitest';
import { strangAnalyse, dijkstraBisZiel, abstandZuLinie, linienLaenge, linieVereinfachen, lageAufLinie, netzwegAbZentrale } from '../src/lib/netz-strang.js';

// Zentrale 1 — J10 — J11 — J12 (Außenquartier) — Gebäude 3, 4; an J10 hängt außerdem Gebäude 2
const k = (u, v) => ({ u, v });
const K = [k(1, 10), k(10, 2), k(10, 11), k(11, 12), k(12, 3), k(12, 4)];
const abzweig = id => id >= 10;

describe('strangAnalyse', () => {
  it('bestimmt oberes/unteres Ende und das Teilnetz dahinter', () => {
    const a = strangAnalyse(K, K[3], 1, abzweig);   // Leitung J11–J12
    expect([a.oben, a.unten]).toEqual([11, 12]);
    expect([...a.teilnetz].sort()).toEqual([12, 3, 4].sort());
  });
  it('entfernt verwaiste Abzweige bis zum nächsten versorgenden Knoten', () => {
    const a = strangAnalyse(K, K[3], 1, abzweig);
    // J11 versorgt nach dem Lösen niemanden mehr → J10–J11 entfällt; J10 versorgt noch Gebäude 2
    expect(a.totKanten).toEqual([K[2]]);
  });
  it('Zentrale und Gebäude werden nie entfernt', () => {
    const kurz = [k(1, 12), k(12, 3)];
    const a = strangAnalyse(kurz, kurz[1], 1, abzweig);
    expect(a.unten).toBe(3);
    expect(a.totKanten).toEqual([kurz[0]]);   // J12 hängt nur noch an der Zentrale
    const b = strangAnalyse(kurz, kurz[0], 1, abzweig);
    expect(b.totKanten).toEqual([]);           // oben ist die Zentrale
  });
  it('ohne eindeutige Richtung (nicht angebunden) kein Ergebnis', () => {
    expect(strangAnalyse([k(5, 6)], { u: 5, v: 6 }, 1, abzweig)).toBeNull();
  });
});

describe('dijkstraBisZiel', () => {
  const adj = new Map();
  const add = (a, b, d) => { for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push({ to: y, distance: d }); } };
  add('s', 'a', 5); add('a', 'z1', 50); add('s', 'b', 10); add('b', 'z2', 10);
  it('findet das nächste Ziel über den kürzesten Weg', () => {
    const r = dijkstraBisZiel(adj, 's', key => key.startsWith('z'));
    expect(r).toEqual({ ziel: 'z2', weg: ['s', 'b', 'z2'], laenge: 20, gesamt: 20 });
  });
  it('mit Zuschlag je Ziel gewinnt die kleinste Summe (z. B. Leitungsweg bis zur Zentrale)', () => {
    // z2 ist näher (20), liegt aber 100 m Leitung von der Zentrale entfernt; z1 (55) direkt an der Zentrale
    const r = dijkstraBisZiel(adj, 's', key => key.startsWith('z'), () => false, key => (key === 'z2' ? 100 : 0));
    expect(r).toMatchObject({ ziel: 'z1', laenge: 55, gesamt: 55 });
  });
  it('gesperrte Knoten werden umgangen', () => {
    const r = dijkstraBisZiel(adj, 's', key => key.startsWith('z'), key => key === 'b');
    expect(r.ziel).toBe('z1');
  });
  it('Start selbst kann Ziel sein; ohne Ziel null', () => {
    expect(dijkstraBisZiel(adj, 's', key => key === 's').laenge).toBe(0);
    expect(dijkstraBisZiel(adj, 's', () => false)).toBeNull();
  });
});

describe('Geometrie', () => {
  const p = { lat: 52, lng: 8 };
  it('Abstand zur Linie und Länge in Metern', () => {
    const linie = [{ lat: 52.0001, lng: 7.999 }, { lat: 52.0001, lng: 8.001 }];   // ~11 m nördlich
    expect(abstandZuLinie(p, linie)).toBeCloseTo(11.05, 1);
    expect(linienLaenge([{ lat: 52, lng: 8 }, { lat: 52.001, lng: 8 }])).toBeCloseTo(110.5, 0);
    expect(abstandZuLinie(p, [])).toBe(Infinity);
  });
  it('Lage auf der Linie und Leitungsweg ab der Zentrale', () => {
    const linie = [{ lat: 52, lng: 8 }, { lat: 52.001, lng: 8 }];
    const l = lageAufLinie({ lat: 52.0005, lng: 8.0001 }, linie);
    expect(l.entlang).toBeCloseTo(55.3, 0);
    expect(l.laenge).toBeCloseTo(110.5, 0);
    const d = netzwegAbZentrale(K, 1, () => 10);
    expect([d.get(1), d.get(10), d.get(12), d.get(4)]).toEqual([0, 10, 30, 40]);
  });
  it('Vereinfachen entfernt nur Punkte auf der Geraden', () => {
    const l = [{ lat: 52, lng: 8 }, { lat: 52.0005, lng: 8 }, { lat: 52.001, lng: 8 }, { lat: 52.001, lng: 8.001 }];
    expect(linieVereinfachen(l)).toEqual([l[0], l[2], l[3]]);
  });
});
