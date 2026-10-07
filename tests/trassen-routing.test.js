import { describe, expect, it } from 'vitest';
import { baueTrassenGraph, routeEntlangTrassen } from '../src/lib/trassen-routing.js';

// Lokales Meter-Raster ab 48,5°N/9°E (dort ist ein Längengrad nur ~0,66 Breitengrade lang)
const LAT = 48.5, LNG = 9;
const M_LAT = 111194.9, M_LNG = 111194.9 * Math.cos(LAT * Math.PI / 180);
const P = (x, y) => [LAT + y / M_LAT, LNG + x / M_LNG];
const XY = p => [(p[1] - LNG) * M_LNG, (p[0] - LAT) * M_LAT];
const tr = (id, ...pts) => ({ id, pts: pts.map(([x, y]) => P(x, y)) });
const laenge = route => route.reduce((s, p, i) => i ? s + Math.hypot(XY(p)[0] - XY(route[i - 1])[0], XY(p)[1] - XY(route[i - 1])[1]) : 0, 0);

describe('routeEntlangTrassen', () => {
  it('fällt das Lot auf eine diagonale Trasse rechtwinklig (in Metern, nicht in Grad)', () => {
    const g = baueTrassenGraph([tr('a', [0, 0], [200, 200])]);
    const route = routeEntlangTrassen(g, P(0, 100), P(100, 0));
    // Lotfußpunkte von (0,100) und (100,0) auf y=x liegen beide bei (50,50)
    const [fx, fy] = XY(route[1]);
    expect(fx).toBeCloseTo(50, 0);
    expect(fy).toBeCloseTo(50, 0);
    expect(laenge(route)).toBeCloseTo(2 * Math.hypot(50, 50), 0);
  });

  it('verknüpft sich kreuzende Trassen ohne gemeinsamen Stützpunkt', () => {
    const g = baueTrassenGraph([tr('h', [0, 0], [200, 0]), tr('v', [100, -100], [100, 100])]);
    const route = routeEntlangTrassen(g, P(10, 5), P(105, 90));
    expect(route).not.toBeNull();
    // 5 m Stich + 90 m bis zur Kreuzung + 90 m nach Norden + 5 m Stich
    expect(laenge(route)).toBeCloseTo(190, 0);
  });

  it('nutzt übereinanderliegende, nicht verbundene Trassen', () => {
    // Trasse b liegt 1 m versetzt auf a und führt dann nach Norden weiter
    const g = baueTrassenGraph([
      tr('a', [0, 0], [100, 0]),
      tr('b', [40, 1], [100, 1], [100, 150]),
    ]);
    const route = routeEntlangTrassen(g, P(5, -10), P(110, 140));
    expect(g.anzahlKomp).toBe(1);
    expect(laenge(route)).toBeLessThan(10 + 100 + 150 + 10 + 5);
    // nie ein schräger Sprung über mehr als die Stichlänge
    for (let i = 1; i < route.length; i++) {
      const [x0, y0] = XY(route[i - 1]), [x1, y1] = XY(route[i]);
      const schraeg = Math.abs(x1 - x0) > 2 && Math.abs(y1 - y0) > 2;
      expect(schraeg).toBe(false);
    }
  });

  it('fängt ein offenes Trassenende bis 20 m an einer fremden Trasse', () => {
    const g = baueTrassenGraph([tr('a', [0, 0], [100, 0]), tr('b', [50, 15], [50, 100])]);
    expect(g.anzahlKomp).toBe(1);
  });

  it('wählt bei getrennten Netzinseln die Insel mit der kürzesten Gesamtroute', () => {
    // Kurzes Stück direkt am Start, aber unverbunden; das Hauptnetz ist 30 m entfernt
    const g = baueTrassenGraph([
      tr('stummel', [0, 3], [10, 3]),
      tr('haupt', [-50, 30], [250, 30]),
    ]);
    const route = routeEntlangTrassen(g, P(5, 0), P(200, 0));
    expect(route).not.toBeNull();
    expect(laenge(route)).toBeCloseTo(30 + 195 + 30, 0);
  });

  it('liefert null ohne Trassen', () => {
    expect(baueTrassenGraph([])).toBeNull();
    expect(routeEntlangTrassen(null, P(0, 0), P(1, 1))).toBeNull();
  });
});
