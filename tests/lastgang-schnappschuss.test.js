// Vitest-Tests für lib/lastgang-schnappschuss.js — eingefrorene Knotenlastgänge.
import { describe, it, expect } from 'vitest';
import {
  knotenKennwerte, erstelleSchnappschuss, schnappschussUeberlast, vergleicheSchnappschuesse,
} from '../src/lib/lastgang-schnappschuss.js';

describe('knotenKennwerte', () => {
  it('findet Bezugsspitze und Summe', () => {
    const k = knotenKennwerte([10, 20, 30, 40]);
    expect(k.peak).toBe(40);
    expect(k.summe).toBe(100);
    expect(k.annualMwh).toBeCloseTo(0.1);
  });

  it('erkennt Rückspeisung als negatives Minimum', () => {
    const k = knotenKennwerte([50, -200, 10]);
    expect(k.minV).toBe(-200);
    expect(k.peak).toBe(50);
  });

  it('meldet peak 0, wenn nur eingespeist wird — nicht das kleinste Negativ', () => {
    const k = knotenKennwerte([-10, -50, -30]);
    expect(k.peak).toBe(-10);      // höchster Wert der Reihe
    expect(k.minV).toBe(-50);
  });

  it('berechnet Vollbenutzungsstunden aus Summe und Spitze', () => {
    // 4 Stunden à 50 kW → Summe 200 kWh, Spitze 50 kW → 4 h
    expect(knotenKennwerte([50, 50, 50, 50]).vbh).toBeCloseTo(4);
  });

  it('setzt vbh und Lastfaktor auf 0, wenn es keine Bezugsspitze gibt', () => {
    const k = knotenKennwerte([-5, -5]);
    expect(k.vbh).toBe(0);
    expect(k.lastfaktor).toBe(0);
  });

  it('liefert für eine leere Reihe lauter Nullen', () => {
    expect(knotenKennwerte([])).toMatchObject({ peak: 0, minV: 0, summe: 0 });
    expect(knotenKennwerte(null).peak).toBe(0);
  });

  it('verändert die Eingabereihe nicht (Sortierung für die Grundlast)', () => {
    const reihe = [3, 1, 2];
    knotenKennwerte(reihe);
    expect(reihe).toEqual([3, 1, 2]);
  });
});

describe('erstelleSchnappschuss', () => {
  const knoten = () => ([
    { id: 'tr1', name: 'Trafo 1', type: 'Trafo', kapazitaetKW: 100, profil: [50, 80, 20] },
    { id: 'tr2', name: 'Trafo 2', type: 'Trafo', kapazitaetKW: 100, profil: [10, -150, 5] },
  ]);

  it('übernimmt Metadaten', () => {
    const s = erstelleSchnappschuss({ jahr: 2030, varianteId: 'v1', varianteName: 'PV groß', knoten: knoten() });
    expect(s).toMatchObject({ jahr: 2030, varianteId: 'v1', varianteName: 'PV groß' });
    expect(s.knoten).toHaveLength(2);
  });

  it('rechnet die Auslastung gegen die Kapazität', () => {
    const s = erstelleSchnappschuss({ knoten: knoten() });
    expect(s.knoten[0].auslastungPct).toBeCloseTo(80);
  });

  it('weist Rückspeisung getrennt aus — sie rührt die Bezugsspitze nicht an', () => {
    const s = erstelleSchnappschuss({ knoten: knoten() });
    expect(s.knoten[1].rueckspeisungPct).toBeCloseTo(150);
    expect(s.knoten[1].auslastungPct).toBeCloseTo(10);
  });

  it('lässt die Auslastung ohne Kapazität unbestimmt statt 0', () => {
    const s = erstelleSchnappschuss({ knoten: [{ id: 'x', profil: [10] }] });
    expect(s.knoten[0].auslastungPct).toBeNull();
    expect(s.knoten[0].rueckspeisungPct).toBeNull();
  });

  it('behält die vollen Reihen nur auf Wunsch', () => {
    expect(erstelleSchnappschuss({ knoten: knoten() }).profile).toBeUndefined();
    const mit = erstelleSchnappschuss({ knoten: knoten() }, { mitProfilen: true });
    expect(mit.profile.get('tr1')).toEqual([50, 80, 20]);
  });

  it('verträgt leere Eingaben', () => {
    expect(erstelleSchnappschuss().knoten).toEqual([]);
  });
});

describe('schnappschussUeberlast', () => {
  const s = () => erstelleSchnappschuss({ knoten: [
    { id: 'ok',    kapazitaetKW: 100, profil: [50] },
    { id: 'bezug', kapazitaetKW: 100, profil: [140] },
    { id: 'rueck', kapazitaetKW: 100, profil: [10, -130] },
    { id: 'ohne',  kapazitaetKW: 0,   profil: [999] },
  ] });

  it('findet Überlast in Bezugsrichtung', () => {
    expect(schnappschussUeberlast(s()).map(k => k.id)).toContain('bezug');
  });

  it('findet Überlast in Rückspeiserichtung', () => {
    expect(schnappschussUeberlast(s()).map(k => k.id)).toContain('rueck');
  });

  it('lässt unkritische Knoten aus', () => {
    expect(schnappschussUeberlast(s()).map(k => k.id)).not.toContain('ok');
  });

  it('meldet Knoten ohne Kapazität nicht als überlastet', () => {
    expect(schnappschussUeberlast(s()).map(k => k.id)).not.toContain('ohne');
  });

  it('akzeptiert eine abweichende Grenze', () => {
    expect(schnappschussUeberlast(s(), 40).map(k => k.id)).toContain('ok');
  });
});

describe('vergleicheSchnappschuesse', () => {
  const a = () => erstelleSchnappschuss({ varianteName: 'A', knoten: [
    { id: 'tr1', name: 'Trafo 1', kapazitaetKW: 100, profil: [50] },
    { id: 'tr2', name: 'Trafo 2', kapazitaetKW: 100, profil: [10] },
  ] });
  const b = () => erstelleSchnappschuss({ varianteName: 'B', knoten: [
    { id: 'tr1', name: 'Trafo 1', kapazitaetKW: 100, profil: [90] },
    { id: 'tr2', name: 'Trafo 2', kapazitaetKW: 100, profil: [10, -300] },
  ] });

  it('bildet die Differenz der Bezugsspitze', () => {
    const v = vergleicheSchnappschuesse(a(), b());
    expect(v.find(x => x.id === 'tr1').dPeak).toBe(40);
  });

  it('bildet die Differenz der Rückspeisung getrennt', () => {
    const v = vergleicheSchnappschuesse(a(), b());
    expect(v.find(x => x.id === 'tr2').dRueck).toBe(300);
  });

  it('sortiert nach der größten Veränderung der Bezugsspitze', () => {
    expect(vergleicheSchnappschuesse(a(), b())[0].id).toBe('tr1');
  });

  it('führt auch Knoten, die nur auf einer Seite vorkommen', () => {
    const nurB = erstelleSchnappschuss({ knoten: [{ id: 'neu', name: 'Neu', kapazitaetKW: 100, profil: [70] }] });
    const v = vergleicheSchnappschuesse(a(), nurB);
    const e = v.find(x => x.id === 'neu');
    expect(e.a).toBeNull();
    expect(e.dPeak).toBe(70);
  });

  it('verträgt leere Seiten', () => {
    expect(vergleicheSchnappschuesse(null, null)).toEqual([]);
  });
});
