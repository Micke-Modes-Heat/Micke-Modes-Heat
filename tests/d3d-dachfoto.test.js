// Vitest-Tests für lib/d3d-dachfoto.js (Luftbild auf den Dächern der 3D-Ansicht).
import { describe, it, expect } from 'vitest';
import { mercatorAus, kachelBereich, texturKoordinate, kachelUrl } from '../src/lib/d3d-dachfoto.js';

describe('mercatorAus', () => {
  it('Nullpunkt und Achsen wie MapLibre (y nach Süden)', () => {
    expect(mercatorAus(0, 0)).toEqual([0.5, 0.5]);
    const [, yNord] = mercatorAus(0, 50), [, ySued] = mercatorAus(0, -50);
    expect(yNord).toBeLessThan(0.5);
    expect(ySued).toBeGreaterThan(0.5);
  });
});

describe('kachelBereich', () => {
  const b = { minLng: 8.0030, minLat: 52.0812, maxLng: 8.0040, maxLat: 52.0820 };   // ~70 × 90 m
  it('Zoom 19 für ein einzelnes Gebäude, Kachel wie die Esri-URL', () => {
    const k = kachelBereich(b, 19, 8);
    expect(k.z).toBe(19);
    expect(k.x0).toBeLessThanOrEqual(273799);
    expect(k.x1).toBeGreaterThanOrEqual(273799);
    expect(k.y0).toBeLessThanOrEqual(172987);
    expect(k.y1).toBeGreaterThanOrEqual(172987);
    expect(k.nx).toBeLessThanOrEqual(8);
  });
  it('großer Ausschnitt → geringere Zoomstufe', () => {
    const k = kachelBereich({ minLng: 7.9, minLat: 52.0, maxLng: 8.1, maxLat: 52.2 }, 19, 8);
    expect(k.z).toBeLessThan(19);
    expect(k.nx).toBeLessThanOrEqual(8);
    expect(k.ny).toBeLessThanOrEqual(8);
  });
});

describe('texturKoordinate', () => {
  it('Ecken des Bereichs → 0 bzw. 1', () => {
    const k = { z: 2, x0: 1, y0: 1, x1: 2, y1: 2, nx: 2, ny: 2 };
    expect(texturKoordinate(0.25, 0.25, k)).toEqual([0, 0]);
    expect(texturKoordinate(0.75, 0.75, k)).toEqual([1, 1]);
    expect(texturKoordinate(0.5, 0.5, k)).toEqual([0.5, 0.5]);
  });
});

describe('kachelUrl', () => {
  it('setzt z/x/y ein', () => {
    expect(kachelUrl('https://t/{z}/{y}/{x}', 19, 5, 7)).toBe('https://t/19/7/5');
  });
});
