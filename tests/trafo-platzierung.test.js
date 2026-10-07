// Vitest-Tests für lib/trafo-platzierung.js — Rechenkern der Trafo-Platzierung (Netzanalyse).
import { describe, it, expect } from 'vitest';
import {
  netzLeistung, gzfNachMethode, zonePeakKW, kMeansCluster, findAutoK, clusterMitK,
  capacityRepair, zoneAusPunkten, topologieZuordnung, bestandZuordnen, gepufferteHuelle, distM,
} from '../src/lib/trafo-platzierung.js';

// Punkte in Metern um einen Bezugspunkt auf 52° N anlegen
const C = { lat: 52.08, lng: 8.0 };
const pt = (id, x, y, loadKW, genKW = 0) => ({
  id, lat: C.lat + y / 111320, lng: C.lng + x / (111320 * Math.cos(C.lat * Math.PI / 180)),
  loadKW, genKW, nVerb: loadKW > 0 ? 1 : 0, weight: Math.max(loadKW, genKW),
});
const toM = p => ({ x: Math.round((p.lng - C.lng) * 111320 * Math.cos(C.lat * Math.PI / 180)),
                    y: Math.round((p.lat - C.lat) * 111320) });
const fest = g => () => g;

describe('netzLeistung', () => {
  it('rechnet wie die Knotenlasten der Stromnetz-Berechnung', () => {
    expect(netzLeistung('PV', { leistungKWp: '100' })).toEqual({ loadKW: 0, genKW: 80 });
    // Ladepark: 8 × 11 kW × GZF 0,3 + 1 Schnelllader 150 kW
    expect(netzLeistung('Lade', { anzahlPunkte: '8', leistungProPunktKW: '11', anzahlSchnell: '1' }).loadKW)
      .toBeCloseTo(8 * 11 * 0.3 + 150);
    expect(netzLeistung('WP', { leistungElKW: '30', leistungKW: '90' }).loadKW).toBe(30);
    expect(netzLeistung('Batterie', { leistungKW: '100' })).toEqual({ loadKW: 0, genKW: 0 });
    expect(netzLeistung('NSHV', { leistungKW: '100' })).toEqual({ loadKW: 0, genKW: 0 });
  });
});

describe('GZF', () => {
  it('folgt der gewählten Methode', () => {
    expect(gzfNachMethode('din18015', 1)).toBe(1);
    expect(gzfNachMethode('din18015', 4)).toBeCloseTo(0.69);
    expect(gzfNachMethode('keine', 50)).toBe(1);
    expect(gzfNachMethode('manuell', 50, 0.55)).toBe(0.55);
  });
  it('mindert nur den Bezug, nicht die Einspeisung', () => {
    expect(zonePeakKW(1000, 0, 2, fest(0.5))).toBe(500);
    expect(zonePeakKW(100, 600, 2, fest(0.5))).toBe(600);
  });
});

describe('kMeansCluster', () => {
  it('misst metrisch: Rechteck 200 m O-W × 260 m N-S wird in Nord/Süd geteilt', () => {
    const pts = [pt('a', -100, 130, 200), pt('b', 100, 130, 200), pt('c', -100, -130, 200), pt('d', 100, -130, 200)];
    const cls = kMeansCluster(pts, 2);
    const ys = cls.map(cl => Math.sign(toM(cl.centroid).y)).sort();
    expect(ys).toEqual([-1, 1]);
    for (const cl of cls) expect(Math.abs(toM(cl.centroid).x)).toBeLessThan(2);
  });
  it('ist reproduzierbar', () => {
    const pts = Array.from({ length: 30 }, (_, i) => pt(`p${i}`, (i * 37) % 300, (i * 53) % 280, 50 + (i % 5) * 10));
    const a = kMeansCluster(pts, 4).map(cl => cl.points.map(p => p.id).sort().join());
    const b = kMeansCluster(pts, 4).map(cl => cl.points.map(p => p.id).sort().join());
    expect(a).toEqual(b);
  });
});

describe('capacityRepair', () => {
  it('verschiebt den Randpunkt einer überlasteten Zone in die Nachbarzone mit Reserve', () => {
    const z1 = zoneAusPunkten([pt('a', 0, 0, 300), pt('b', 40, 0, 300)], { lat: C.lat, lng: C.lng }, fest(1));
    const z2 = zoneAusPunkten([pt('c', 200, 0, 100)], pt('x', 200, 0, 0), fest(1));
    capacityRepair([z1, z2], 450, fest(1));
    expect(z1.peakKW).toBeLessThanOrEqual(450);
    expect(z2.points.map(p => p.id).sort()).toEqual(['b', 'c']);   // b liegt näher an z2
  });
});

describe('findAutoK', () => {
  it('kommt dank Kapazitätsreparatur mit weniger Stationen aus', () => {
    // 3 Gruppen; die mittlere ist allein zu groß für eine Station, passt aber
    // zusammen mit den Nachbarn auf zwei Stationen.
    const pts = [
      pt('a1', 0, 0, 200), pt('a2', 20, 0, 200),
      pt('m1', 150, 0, 150), pt('m2', 170, 0, 150),
      pt('b1', 300, 0, 200), pt('b2', 320, 0, 200),
    ];
    const res = findAutoK(pts, { maxKW: 600, gzfFn: fest(1) });
    expect(res.k).toBe(2);
    for (const cl of res.clusters) expect(cl.peakKW).toBeLessThanOrEqual(600);
  });
  it('gibt Großlasten eine eigene Station', () => {
    const pts = [pt('g', 0, 0, 900), pt('n1', 100, 0, 50), pt('n2', 120, 0, 50)];
    const res = findAutoK(pts, { maxKW: 567, gzfFn: fest(1) });
    expect(res.whaleCount).toBe(1);
    expect(res.clusters.find(cl => cl.isWhale).points[0].id).toBe('g');
  });
  it('clusterMitK behandelt Großlasten wie der Auto-Modus', () => {
    const pts = [pt('g', 0, 0, 900), pt('n1', 100, 0, 50), pt('n2', 300, 0, 50)];
    const cls = clusterMitK(pts, 3, { maxKW: 567, gzfFn: fest(1) });
    expect(cls.length).toBe(3);
    expect(cls.filter(cl => cl.isWhale).length).toBe(1);
  });
});

describe('Bestand', () => {
  const T1 = { id: 'T1', lat: C.lat, lng: C.lng, maxKW: 360 };
  const T2 = { ...pt('T2', 250, 0, 0), id: 'T2', maxKW: 360 };
  it('ordnet nach Netztopologie zu, auch wenn ein anderer Trafo näher liegt', () => {
    const p = pt('v', 200, 0, 100);   // liegt näher an T2, hängt aber an T1
    const edges = [{ u: 'T1', v: 'N1' }, { u: 'N1', v: 'v' }];
    const rank = { T1: 2, T2: 2, N1: 3, v: 5 };
    const topo = topologieZuordnung([T1, T2], edges, id => rank[id] ?? null, id => id === 'N1');
    expect(topo.get('v')).toBe('T1');
    const { zonen } = bestandZuordnen([p], [T1, T2], { topoMap: topo });
    expect(zonen.get('T1').pts.length).toBe(1);
    expect(zonen.get('T1').viaNetz).toBe(1);
  });
  it('nutzt die Reserve des Nachbarn, bevor ein Überhang entsteht', () => {
    const pts = [pt('a', 0, 10, 200), pt('b', 20, 0, 100), pt('c', 150, 0, 150)];
    const { zonen, verschoben, ueberhang } = bestandZuordnen(pts, [T1, T2],
      { topoMap: new Map([['a', 'T1'], ['b', 'T1'], ['c', 'T1']]), entlasten: true, gzfFn: fest(1) });
    expect(ueberhang).toEqual([]);
    expect(verschoben.map(v => v.p.id)).toEqual(['c']);
    expect(zonen.get('T1').peakKW).toBeLessThanOrEqual(360);
  });
  it('legt nur den Rest in den Überhang, nicht die ganze Zone', () => {
    const pts = [pt('a', 0, 10, 200), pt('b', 20, 0, 200), pt('c', -30, 0, 200)];
    const { zonen, ueberhang } = bestandZuordnen(pts, [T1],
      { topoMap: new Map(), entlasten: true, gzfFn: fest(1) });
    expect(ueberhang.length).toBe(2);
    expect(zonen.get('T1').pts.length).toBe(1);
  });
});

describe('Bestand — Reichweite', () => {
  it('weit entfernte Lasten ohne Netzanschluss gelten als nicht versorgt', () => {
    const T = { id: 'T', lat: C.lat, lng: C.lng, maxKW: 1000 };
    const pts = [pt('nah', 100, 0, 50), pt('fern', 900, 0, 50)];
    const r1 = bestandZuordnen(pts, [T], { reachM: 400 });
    expect(r1.ohneTrafo.map(p => p.id)).toEqual(['fern']);
    expect(r1.ueberhang).toEqual([]);
    const r2 = bestandZuordnen(pts, [T], { reachM: 400, entlasten: true });
    expect(r2.ueberhang.map(p => p.id)).toEqual(['fern']);
  });
});

describe('gepufferteHuelle', () => {
  it('umschließt alle Punkte mit Abstand', () => {
    const pts = [pt('a', 0, 0, 1), pt('b', 100, 0, 1)];
    const h = gepufferteHuelle(pts, 15);
    expect(h.length).toBeGreaterThan(4);
    const breite = Math.max(...h.map(p => toM(p).x)) - Math.min(...h.map(p => toM(p).x));
    expect(breite).toBeGreaterThanOrEqual(129);
    expect(distM(pts[0], pts[1])).toBeCloseTo(100, 0);
  });
});
