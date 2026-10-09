// Vitest-Tests für lib/baeume-3d.js (Bäume aus OSM für die 3D-Ansicht).
import { describe, it, expect } from 'vitest';
import {
  baumZahl, baumBlattart, baumRingeVerbinden, baeumeAusOverpass, baumDreiecke, baumOverpassAbfrage, BAUM_VORGABEN, baumOverpassLaden,
} from '../src/lib/baeume-3d.js';

// Ausschnitt ~ 300 m × 300 m bei 48,5° N
const LAT0 = 48.5, LNG0 = 9.0;
const M = 111320, MX = M * Math.cos(LAT0 * Math.PI / 180);
const ll = (x, y) => [LNG0 + x / MX, LAT0 + y / M];          // Meter → [lng, lat]
const geo = pts => pts.map(([x, y]) => { const [lon, lat] = ll(x, y); return { lat, lon }; });
const BBOX = (() => { const [w, s] = ll(-150, -150), [e, n] = ll(150, 150); return { s, w, n, e }; })();
const quadrat = (x0, y0, a) => [[x0, y0], [x0 + a, y0], [x0 + a, y0 + a], [x0, y0 + a], [x0, y0]];
const xy = b => [(b.lng - LNG0) * MX, (b.lat - LAT0) * M];

describe('baumZahl / baumBlattart', () => {
  it('liest Meter, Zentimeter und Komma', () => {
    expect(baumZahl('12')).toBe(12);
    expect(baumZahl('12 m')).toBe(12);
    expect(baumZahl('12,5m')).toBe(12.5);
    expect(baumZahl('230 cm')).toBeCloseTo(2.3, 9);
    expect(baumZahl('ca. 10')).toBeNaN();
    expect(baumZahl(undefined)).toBeNaN();
  });
  it('erkennt Nadelbäume an leaf_type und Gattung', () => {
    expect(baumBlattart({ leaf_type: 'needleleaved' })).toBe('nadel');
    expect(baumBlattart({ leaf_type: 'broadleaved' })).toBe('laub');
    expect(baumBlattart({ leaf_type: 'mixed' })).toBe('gemischt');
    expect(baumBlattart({ genus: 'Picea' })).toBe('nadel');
    expect(baumBlattart({ species: 'Pinus sylvestris' })).toBe('nadel');
    expect(baumBlattart({ species: 'Quercus robur' })).toBe('laub');
    expect(baumBlattart({})).toBeNull();
  });
});

describe('baumOverpassAbfrage', () => {
  it('fragt alle vier Quellen im Ausschnitt ab', () => {
    const q = baumOverpassAbfrage(BBOX);
    for (const t of ['"natural"="tree"', '"natural"="tree_row"', '"natural"="wood"', '"landuse"="forest"', '"landuse"="orchard"']) {
      expect(q).toContain(t);
    }
    expect(q).toContain('out tags geom;');
  });
});

describe('baumOverpassLaden', () => {
  const antwort = (status, body) => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
  const ohneWarten = { warten: () => Promise.resolve() };

  it('wiederholt nach Überlastung (504/429) und liefert dann die Daten', async () => {
    let runde = 0;
    const abrufen = () => antwort(runde < 4 * 2 ? 504 : 200, { elements: [{ type: 'node', id: 1 }] });
    const zaehlen = (...a) => { const r = abrufen(...a); runde++; return r; };
    const meldungen = [];
    const d = await baumOverpassLaden(BBOX, { ...ohneWarten, abrufen: zaehlen, fortschritt: m => meldungen.push(m) });
    expect(d.elements).toHaveLength(1);
    expect(meldungen.map(m => m.versuch)).toEqual([1, 2, 3]);
    expect(meldungen[1].fehler).toContain('HTTP 504');
  });
  it('eine leere Antwort ist gültig (keine Bäume im Gebiet)', async () => {
    const d = await baumOverpassLaden(BBOX, { ...ohneWarten, abrufen: () => antwort(200, { elements: [] }) });
    expect(d.elements).toEqual([]);
  });
  it('viertelt ein Gebiet, das ganz scheitert, und führt die Teile zusammen', async () => {
    let n = 0;
    // Große Abfrage läuft immer in die Zeitgrenze, kleine gehen durch
    const abrufen = (url, init) => {
      const q = decodeURIComponent(init.body.slice(5));
      const [s, , nn] = q.match(/\(([\d.,]+)\)/)[1].split(',').map(Number);
      n++;
      return (nn - s) > 0.002
        ? antwort(200, { elements: [], remark: 'runtime error: Query timed out' })
        : antwort(200, { elements: [{ type: 'node', id: 5 }, { type: 'node', id: n }] });
    };
    const d = await baumOverpassLaden(BBOX, { ...ohneWarten, abrufen });
    expect(d.elements.some(e => e.id === 5)).toBe(true);
    expect(d.elements.filter(e => e.id === 5)).toHaveLength(1);   // doppelte zusammengeführt
  });
  it('gibt nach allen Versuchen eine verständliche Fehlermeldung', async () => {
    await expect(baumOverpassLaden(BBOX, { ...ohneWarten, abrufen: () => antwort(429, null) }))
      .rejects.toThrow(/HTTP 429/);
  });
});

describe('baumRingeVerbinden', () => {
  it('verbindet Wegstücke (auch umgedrehte) zu einem Ring', () => {
    const a = [[0, 0], [1, 0], [1, 1]], b = [[0, 1], [1, 1]], c = [[0, 1], [0, 0]];
    const ringe = baumRingeVerbinden([a, b, c]);
    expect(ringe).toHaveLength(1);
    expect(ringe[0][0]).toEqual(ringe[0][ringe[0].length - 1]);
    expect(ringe[0]).toHaveLength(5);
  });
  it('verwirft offene Reste', () => {
    expect(baumRingeVerbinden([[[0, 0], [1, 0]], [[5, 5], [6, 6]]])).toHaveLength(0);
  });
});

describe('baeumeAusOverpass', () => {
  it('Einzelbaum: Tags werden übernommen, außerhalb des Ausschnitts wird verworfen', () => {
    const [lon, lat] = ll(10, 20);
    const [lonA, latA] = ll(500, 0);
    const r = baeumeAusOverpass({ elements: [
      { type: 'node', id: 1, lat, lon, tags: { natural: 'tree', height: '17 m', diameter_crown: '9', circumference: '1.9', leaf_type: 'needleleaved' } },
      { type: 'node', id: 2, lat: latA, lon: lonA, tags: { natural: 'tree' } },
    ] }, { bbox: BBOX });
    expect(r.baeume).toHaveLength(1);
    const b = r.baeume[0];
    expect(b.hoehe).toBe(17);
    expect(b.krone).toBe(9);
    expect(b.stamm).toBeCloseTo(1.9 / (2 * Math.PI), 9);
    expect(b.art).toBe('nadel');
    expect(xy(b)[0]).toBeCloseTo(10, 6);
    expect(r.zahl.einzel).toBe(1);
  });
  it('Einzelbaum ohne Höhe: Vorgabe mit Streuung, deterministisch', () => {
    const [lon, lat] = ll(0, 0);
    const daten = { elements: [{ type: 'node', id: 42, lat, lon, tags: { natural: 'tree' } }] };
    const a = baeumeAusOverpass(daten, { bbox: BBOX }).baeume[0];
    const b = baeumeAusOverpass(daten, { bbox: BBOX }).baeume[0];
    expect(a).toEqual(b);
    expect(a.hoehe).toBeGreaterThan(BAUM_VORGABEN.einzel.hoehe * 0.8);
    expect(a.hoehe).toBeLessThan(BAUM_VORGABEN.einzel.hoehe * 1.2);
    expect(a.art).toBe('laub');
  });
  it('Baumreihe: Bäume im Abstand, ohne Doppel an erfassten Einzelbäumen', () => {
    const [lon, lat] = ll(16, 0);
    const r = baeumeAusOverpass({ elements: [
      { type: 'way', id: 7, tags: { natural: 'tree_row' }, geometry: geo([[0, 0], [40, 0]]) },
      { type: 'node', id: 8, lat, lon, tags: { natural: 'tree' } },
    ] }, { bbox: BBOX });
    // 0, 8, 16 (= Einzelbaum, entfällt), 24, 32, 40
    expect(r.zahl.reihe).toBe(5);
    expect(r.zahl.einzel).toBe(1);
    const xs = r.baeume.filter(b => b.quelle === 'reihe').map(b => Math.round(xy(b)[0])).sort((a, b) => a - b);
    expect(xs).toEqual([0, 8, 24, 32, 40]);
  });
  it('Abstand läuft über Knicke der Reihe hinweg weiter', () => {
    const r = baeumeAusOverpass({ elements: [
      { type: 'way', id: 9, tags: { natural: 'tree_row' }, geometry: geo([[0, 0], [12, 0], [12, 12]]) },
    ] }, { bbox: BBOX });
    // Gesamtlänge 24 m → 0, 8, 16, 24
    expect(r.zahl.reihe).toBe(4);
  });
  it('Wald: Raster füllt die Fläche, Loch und Gebäude bleiben frei', () => {
    const r = baeumeAusOverpass({ elements: [
      { type: 'relation', id: 3, tags: { landuse: 'forest', leaf_type: 'needleleaved' }, members: [
        { type: 'way', role: 'outer', geometry: geo([[-70, -70], [70, -70], [70, 70]]) },
        { type: 'way', role: 'outer', geometry: geo([[70, 70], [-70, 70], [-70, -70]]) },
        { type: 'way', role: 'inner', geometry: geo(quadrat(-20, -20, 40)) },
      ] },
    ] }, { bbox: BBOX, ausschluss: [quadrat(30, 30, 30).map(([x, y]) => ll(x, y))] });
    const n = r.zahl.wald;
    // 140² − 40² − 30² = 17 100 m² bei 7 m Abstand ≈ 350 Bäume
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(400);
    for (const b of r.baeume) {
      const [x, y] = xy(b);
      expect(Math.abs(x) <= 70 && Math.abs(y) <= 70).toBe(true);
      expect(Math.abs(x) < 20 && Math.abs(y) < 20).toBe(false);
      expect(x > 30 && x < 60 && y > 30 && y < 60).toBe(false);
      expect(b.art).toBe('nadel');
    }
  });
  it('Streuobst: weiteres Raster und kleine Bäume', () => {
    const r = baeumeAusOverpass({ elements: [
      { type: 'way', id: 4, tags: { landuse: 'orchard' }, geometry: geo(quadrat(0, 0, 100)) },
    ] }, { bbox: BBOX });
    expect(r.zahl.obst).toBeGreaterThan(80);
    expect(r.zahl.obst).toBeLessThan(120);
    expect(r.baeume.every(b => b.art === 'obst' && b.hoehe < 8)).toBe(true);
  });
  it('zu viele Bäume → Flächenraster wird gleichmäßig weiter statt abgeschnitten', () => {
    const r = baeumeAusOverpass({ elements: [
      { type: 'way', id: 5, tags: { natural: 'wood' }, geometry: geo(quadrat(-150, -150, 300)) },
    ] }, { bbox: BBOX, max: 500 });
    expect(r.ausgeduennt).toBe(true);
    expect(r.baeume.length).toBeLessThanOrEqual(500);
    expect(r.baeume.length).toBeGreaterThan(400);
    // gleichmäßig: in jedem Viertel etwa ein Viertel der Bäume
    const ne = r.baeume.filter(b => { const [x, y] = xy(b); return x > 0 && y > 0; }).length;
    expect(ne / r.baeume.length).toBeGreaterThan(0.2);
    expect(ne / r.baeume.length).toBeLessThan(0.3);
  });
});

describe('baumDreiecke', () => {
  const hoehen = tris => tris.flat().map(p => p[2]);
  it('Laubbaum: Krone reicht bis zur Baumhöhe, Kronenbreite = Durchmesser', () => {
    const { krone, stamm } = baumDreiecke({ hoehe: 12, krone: 8, stamm: 0.3, art: 'laub' });
    expect(Math.max(...hoehen(krone))).toBeCloseTo(12, 6);
    expect(Math.min(...hoehen(stamm))).toBe(0);
    const r = Math.max(...krone.flat().map(p => Math.hypot(p[0], p[1])));
    expect(r).toBeLessThanOrEqual(4 + 1e-9);
    expect(r).toBeGreaterThan(3.5);
    expect(krone.length + stamm.length).toBeLessThan(80);
  });
  it('Nadelbaum: Spitze auf Baumhöhe, Krone schmal', () => {
    const { krone } = baumDreiecke({ hoehe: 20, krone: 5, stamm: 0.3, art: 'nadel' });
    expect(Math.max(...hoehen(krone))).toBeCloseTo(20, 6);
    expect(Math.max(...krone.flat().map(p => Math.hypot(p[0], p[1])))).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});
