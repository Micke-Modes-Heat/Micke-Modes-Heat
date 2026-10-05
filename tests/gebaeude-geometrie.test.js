import { describe, expect, it } from 'vitest';
import { bereinigeKleinbauten, drehFunktion, flaecheM2, formAbbildung, peilungGrad, rechteckAusDreiPunkten, richteRechtwinklig, uebertrageForm, vereinigePolygone } from '../src/lib/gebaeude-geometrie.js';

// Rechteck in Metern ab (x,y) am Ursprung 53°N/10°E
const LAT = 53, LNG = 10;
const dLat = m => m / 111194.9;
const dLng = m => m / (111194.9 * Math.cos(LAT * Math.PI / 180));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  .map(([px, py]) => ({ lat: LAT + dLat(py), lng: LNG + dLng(px) }));

describe('vereinigePolygone', () => {
  it('fügt zwei aneinanderstoßende Rechtecke zu einer Kontur zusammen', () => {
    const r = vereinigePolygone(rect(0, 0, 10, 10), rect(10, 0, 5, 10));
    expect(r.methode).toBe('vereinigung');
    expect(r.flaecheM2).toBeCloseTo(150, 0);
    expect(r.coords).toHaveLength(4);
  });
  it('vereinigt sich überlappende Rechtecke (L-Form)', () => {
    const r = vereinigePolygone(rect(0, 0, 10, 10), rect(5, 5, 10, 10));
    expect(r.methode).toBe('vereinigung');
    expect(r.flaecheM2).toBeCloseTo(175, 0);
    expect(r.coords).toHaveLength(8);
  });
  it('ein Polygon vollständig im anderen ergibt das größere', () => {
    const r = vereinigePolygone(rect(0, 0, 20, 20), rect(5, 5, 3, 3));
    expect(r.methode).toBe('vereinigung');
    expect(r.flaecheM2).toBeCloseTo(400, 0);
  });
  it('getrennte Gebäude → konvexe Hülle', () => {
    const r = vereinigePolygone(rect(0, 0, 10, 10), rect(20, 0, 10, 10));
    expect(r.methode).toBe('huelle');
    expect(r.flaecheM2).toBeCloseTo(300, 0);
  });
});

describe('bereinigeKleinbauten', () => {
  it('schluckt einen Dachaufbau innerhalb des Gebäudes', () => {
    const gross = { coords: rect(0, 0, 20, 10), name: 'gross' };
    const aufbau = { coords: rect(5, 3, 4, 4), name: 'aufbau' };
    const r = bereinigeKleinbauten([gross, aufbau], { minFlaecheM2: 30 });
    expect(r.items).toHaveLength(1);
    expect(r.verworfen).toBe(1);
    expect(flaecheM2(r.items[0].coords)).toBeCloseTo(200, 0);
  });
  it('rechnet einen angrenzenden Anbau in den Grundriss ein', () => {
    const r = bereinigeKleinbauten([{ coords: rect(0, 0, 20, 10) }, { coords: rect(20, 0, 3, 5) }], { minFlaecheM2: 30 });
    expect(r.items).toHaveLength(1);
    expect(r.angefuegt).toBe(1);
    expect(flaecheM2(r.items[0].coords)).toBeCloseTo(215, 0);
  });
  it('verwirft isolierte Kleinbauten, lässt große Gebäude unberührt', () => {
    const r = bereinigeKleinbauten([{ coords: rect(0, 0, 20, 10) }, { coords: rect(50, 50, 4, 4) }, { coords: rect(100, 0, 30, 10) }], { minFlaecheM2: 30 });
    expect(r.items).toHaveLength(2);
    expect(r.verworfen).toBe(1);
  });
  it('Mindestfläche 0 schaltet die Bereinigung ab', () => {
    const items = [{ coords: rect(0, 0, 20, 10) }, { coords: rect(5, 3, 4, 4) }];
    expect(bereinigeKleinbauten(items, { minFlaecheM2: 0 }).items).toHaveLength(2);
  });
});

// Punkte in Metern → {lat,lng}, gedreht um den Ursprung (Grad im Uhrzeigersinn)
const ptsM = (pts, grad = 0) => {
  const f = drehFunktion({ lat: LAT, lng: LNG }, grad);
  return pts.map(([x, y]) => f({ lat: LAT + dLat(y), lng: LNG + dLng(x) }));
};

describe('rechteckAusDreiPunkten', () => {
  it('bildet aus Grundlinie und Breite ein Rechteck mit passender Fläche', () => {
    const [a, b, c] = ptsM([[0, 0], [20, 0], [7, 8]]);
    const r = rechteckAusDreiPunkten(a, b, c);
    expect(r.coords).toHaveLength(4);
    expect(r.laengeM).toBeCloseTo(20, 1);
    expect(r.breiteM).toBeCloseTo(8, 1);
    expect(flaecheM2(r.coords)).toBeCloseTo(160, 0);
  });
  it('funktioniert gedreht und auf beiden Seiten der Grundlinie', () => {
    const [a, b, c] = ptsM([[0, 0], [20, 0], [5, -6]], 37);
    expect(flaecheM2(rechteckAusDreiPunkten(a, b, c).coords)).toBeCloseTo(120, 0);
  });
  it('liefert null bei entarteter Breite', () => {
    const [a, b, c] = ptsM([[0, 0], [20, 0], [5, 0.1]]);
    expect(rechteckAusDreiPunkten(a, b, c)).toBeNull();
  });
});

describe('drehFunktion / peilungGrad', () => {
  it('90° im Uhrzeigersinn dreht Ost nach Süd', () => {
    const f = drehFunktion({ lat: LAT, lng: LNG }, 90);
    const p = f({ lat: LAT, lng: LNG + dLng(10) });
    expect(p.lat).toBeLessThan(LAT);
    expect((LAT - p.lat) / dLat(1)).toBeCloseTo(10, 1);
  });
  it('erhält die Fläche', () => {
    const r = ptsM([[0, 0], [12, 0], [12, 7], [0, 7]]);
    const f = drehFunktion({ lat: LAT, lng: LNG }, 33);
    expect(flaecheM2(r.map(f))).toBeCloseTo(flaecheM2(r), 3);
  });
  it('Peilung: Ost = 90°, Süd = 180°', () => {
    const z = { lat: LAT, lng: LNG };
    expect(peilungGrad(z, { lat: LAT, lng: LNG + 0.001 })).toBeCloseTo(90, 3);
    expect(peilungGrad(z, { lat: LAT - 0.001, lng: LNG })).toBeCloseTo(180, 3);
  });
});

describe('richteRechtwinklig', () => {
  const winkel90 = coords => {
    return coords.map((p, i) => {
      const a = coords[(i + coords.length - 1) % coords.length], b = coords[(i + 1) % coords.length];
      const d1 = peilungGrad(p, a), d2 = peilungGrad(p, b);
      return Math.abs(((d1 - d2) % 180 + 180) % 180 - 90);
    });
  };
  it('macht ein leicht verzogenes Rechteck rechtwinklig', () => {
    const verzogen = ptsM([[0, 0], [20.4, 0.5], [19.8, 10.2], [0.3, 9.7]]);
    const r = richteRechtwinklig(verzogen);
    expect(r.coords).toHaveLength(4);
    expect(Math.max(...winkel90(r.coords))).toBeLessThan(0.1);
    expect(r.abweichungProzent).toBeLessThan(5);
  });
  it('behält die Gebäuderichtung (gedrehtes Gebäude bleibt gedreht)', () => {
    const verzogen = ptsM([[0, 0], [20.4, 0.5], [19.8, 10.2], [0.3, 9.7]], 28);
    const r = richteRechtwinklig(verzogen);
    expect(Math.min(Math.abs(r.winkelGrad - 28), Math.abs(r.winkelGrad - 28 + 90), Math.abs(r.winkelGrad - 28 - 90))).toBeLessThan(2.5);
    expect(Math.max(...winkel90(r.coords))).toBeLessThan(0.1);
  });
  it('erhält eine L-Form (6 Ecken) und legt Zwischenpunkte auf Kanten zusammen', () => {
    const l = ptsM([[0, 0], [20, 0.4], [20.3, 8], [10, 8.2], [9.8, 15], [0.2, 14.8], [0, 7]]);
    const r = richteRechtwinklig(l);
    expect(r.coords).toHaveLength(6);
    expect(Math.max(...winkel90(r.coords))).toBeLessThan(0.1);
    expect(r.flaecheNachherM2).toBeGreaterThan(200);
  });
  it('meldet diagonale Kanten', () => {
    const abgeschraegt = ptsM([[0, 0], [20, 0], [20, 6], [14, 12], [0, 12]]);
    const r = richteRechtwinklig(abgeschraegt);
    expect(r.diagonaleKanten).toBeGreaterThan(0);
  });
  it('liefert null für ein Dreieck', () => {
    expect(richteRechtwinklig(ptsM([[0, 0], [10, 0], [5, 8]]))).toBeNull();
  });
});

describe('uebertrageForm', () => {
  const mitte = c => ({ lat: c.reduce((a, p) => a + p.lat, 0) / c.length, lng: c.reduce((a, p) => a + p.lng, 0) / c.length });
  it('übernimmt Maße, behält Schwerpunkt und Drehung des Ziels', () => {
    const ziel = ptsM([[0, 0], [10, 0], [10, 6], [0, 6]], 30);
    const quelle = ptsM([[100, 50], [120, 50], [120, 58], [100, 58]], 75);
    const r = uebertrageForm(ziel, quelle);
    expect(r.flaecheM2).toBeCloseTo(160, 0);
    expect(mitte(r.coords).lat).toBeCloseTo(mitte(ziel).lat, 7);
    expect(mitte(r.coords).lng).toBeCloseTo(mitte(ziel).lng, 7);
    // Lange Seite (20 m) liegt in Zielrichtung: erste Kante des Ergebnisses ∥ erster Kante des Ziels
    const peil = (a, b) => peilungGrad(a, b);
    const d = Math.abs(((peil(r.coords[0], r.coords[1]) - peil(ziel[0], ziel[1])) % 180 + 180) % 180);
    expect(Math.min(d, 180 - d)).toBeLessThan(0.1);
  });
  it('erhält die Kantenlängen der Quelle (L-Form)', () => {
    const ziel = ptsM([[0, 0], [30, 0], [30, 12], [0, 12]], 10);
    const quelle = ptsM([[0, 0], [20, 0], [20, 8], [10, 8], [10, 15], [0, 15]], 200);
    const r = uebertrageForm(ziel, quelle);
    expect(r.coords).toHaveLength(6);
    expect(r.flaecheM2).toBeCloseTo(flaecheM2(quelle), 1);
  });
});

describe('formAbbildung', () => {
  it('streckt Punkte anteilig in den Gebäudeachsen des Ziels mit', () => {
    const ziel = ptsM([[0, 0], [10, 0], [10, 6], [0, 6]], 30);
    const quelle = ptsM([[100, 50], [120, 50], [120, 58], [100, 58]], 75);
    const r = uebertrageForm(ziel, quelle);
    const f = formAbbildung(ziel, r.coords);
    // PV-Fläche auf der halben Länge, volle Breite → bleibt halbe Länge, volle Breite
    const pv = ptsM([[0, 0], [5, 0], [5, 6], [0, 6]], 30);
    const neu = pv.map(f);
    expect(flaecheM2(neu)).toBeCloseTo(80, 0); // 10 × 8 m
    // Ecken des alten Grundrisses landen auf Ecken des neuen
    ziel.map(f).forEach(p => {
      const d = Math.min(...r.coords.map(q => Math.hypot((p.lat - q.lat) * 111194.9, (p.lng - q.lng) * 111194.9 * Math.cos(LAT * Math.PI / 180))));
      expect(d).toBeLessThan(0.01);
    });
  });
  it('liefert null bei entartetem Grundriss', () => {
    expect(formAbbildung(rect(0, 0, 10, 10).slice(0, 2), rect(0, 0, 5, 5))).toBeNull();
  });
});
