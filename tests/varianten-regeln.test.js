import { describe, it, expect } from 'vitest';
import {
  variantKey, kategorieFuerAsset, schichtFuerNeu, baujahrFuerNeu, wirkungAusSchicht,
  massnahmeStandardVariante, massnahmeGiltIn, massnahmenHerausnehmen, massnahmenEinsetzen,
  waermeGeometrie, geometrieGleich, netzMitGeometrie,
  pvBelegungErfassen, pvBelegungAnwenden,
  ergebnisStempel, stempelAbweichung, zeitstrahlEintraege,
} from '../src/lib/varianten-regeln.js';
import { SCHICHT } from '../src/lib/schichten.js';

describe('Schicht neuer Objekte', () => {
  it('Slider auf heute → Bestand, egal welche Objektart', () => {
    expect(schichtFuerNeu({ kategorie: 'bedarf', jahr: 2026, basisjahr: 2026 })).toBe(SCHICHT.BESTAND);
    expect(schichtFuerNeu({ kategorie: 'entscheidung', jahr: 2026, basisjahr: 2026 })).toBe(SCHICHT.BESTAND);
  });
  it('Zukunft: Bedarf kommt ohnehin, Anlagen sind Entscheidungen', () => {
    expect(schichtFuerNeu({ kategorie: 'bedarf', jahr: 2032, basisjahr: 2026 })).toBe(SCHICHT.ENTWICKLUNG);
    expect(schichtFuerNeu({ kategorie: 'entscheidung', jahr: 2032, basisjahr: 2026 })).toBe(SCHICHT.ENTSCHEIDUNG);
  });
  it('fest eingestellter Modus übersteuert die Regel', () => {
    expect(schichtFuerNeu({ modus: SCHICHT.BESTAND, kategorie: 'entscheidung', jahr: 2040, basisjahr: 2026 })).toBe(SCHICHT.BESTAND);
  });
  it('Verbraucher sind Bedarf, alles andere Entscheidung', () => {
    expect(kategorieFuerAsset('verbraucher')).toBe('bedarf');
    expect(kategorieFuerAsset('erzeuger')).toBe('entscheidung');
    expect(kategorieFuerAsset('infrastruktur')).toBe('entscheidung');
  });
  it('Baujahr = Slider-Jahr nur in der Zukunft', () => {
    expect(baujahrFuerNeu({ jahr: 2032, basisjahr: 2026 })).toBe(2032);
    expect(baujahrFuerNeu({ jahr: 2026, basisjahr: 2026 })).toBeNull();
  });
  it('Wirkung: nur Entscheidungen sind variantenspezifisch', () => {
    expect(wirkungAusSchicht(SCHICHT.ENTSCHEIDUNG)).toBe('variante');
    expect(wirkungAusSchicht(SCHICHT.ENTWICKLUNG)).toBe('alle');
    expect(wirkungAusSchicht(undefined)).toBe('alle');
  });
  it('Hauptplan hat den Schlüssel base', () => {
    expect(variantKey(null)).toBe('base');
    expect(variantKey('v_1')).toBe('v_1');
  });
});

describe('Maßnahmen mit Geltungsbereich', () => {
  it('Ertüchtigung am Bestandsobjekt gilt standardmäßig nur in der aktiven Variante', () => {
    expect(massnahmeStandardVariante({ objektSchicht: SCHICHT.BESTAND, typ: 'Sanierung', aktivKey: 'v_2' })).toBe('v_2');
  });
  it('an einem Objekt der Variante braucht es keine Zuordnung', () => {
    expect(massnahmeStandardVariante({ objektSchicht: SCHICHT.ENTSCHEIDUNG, typ: 'Sanierung', aktivKey: 'v_2' })).toBeNull();
  });
  it('Ersatz am Lebensende fällt ohnehin an → alle', () => {
    expect(massnahmeStandardVariante({ objektSchicht: SCHICHT.BESTAND, typ: 'Ersatz', aktivKey: 'base' })).toBeNull();
  });
  it('massnahmeGiltIn', () => {
    expect(massnahmeGiltIn({ variante: null }, 'base')).toBe(true);
    expect(massnahmeGiltIn({}, 'base')).toBe(true);
    expect(massnahmeGiltIn({ variante: 'v_1' }, 'base')).toBe(false);
    expect(massnahmeGiltIn({ variante: 'v_1' }, 'v_1')).toBe(true);
  });
  it('herausnehmen und wieder einsetzen ist verlustfrei', () => {
    const t1 = { massnahmen: [{ id: 'm1', variante: null }, { id: 'm2', variante: 'base' }] };
    const k1 = { massnahmen: [{ id: 'm3', variante: 'base' }] };
    const traeger = [{ ziel: 'asset', id: 'A', obj: t1 }, { ziel: 'kante', id: 'K', obj: k1 }];
    const ablage = massnahmenHerausnehmen(traeger, 'base');
    expect(ablage.map(e => e.m.id)).toEqual(['m2', 'm3']);
    expect(t1.massnahmen.map(m => m.id)).toEqual(['m1']);
    expect(k1.massnahmen).toEqual([]);
    const verwaist = massnahmenEinsetzen(traeger, ablage);
    expect(verwaist).toEqual([]);
    expect(t1.massnahmen.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(k1.massnahmen.map(m => m.id)).toEqual(['m3']);
  });
  it('Maßnahmen gelöschter Objekte bleiben als verwaist erhalten', () => {
    const verwaist = massnahmenEinsetzen([], [{ ziel: 'asset', id: 'weg', m: { id: 'm9' } }]);
    expect(verwaist).toHaveLength(1);
  });
});

describe('Wärmenetz: Geometrie gemeinsam', () => {
  const a = { vl: 70, rl: 45, trasse: [{ lat: 1, lng: 2 }], trasseSegments: [], graph: { n: 1 } };
  it('vergleicht nur die Geometrie, nicht die Temperaturen', () => {
    expect(geometrieGleich(a, { ...a, vl: 90 })).toBe(true);
    expect(geometrieGleich(a, { ...a, trasse: [] })).toBe(false);
  });
  it('setzt Parameter der Variante mit gemeinsamer Geometrie zusammen', () => {
    const r = netzMitGeometrie({ vl: 60, trasse: [] }, waermeGeometrie(a));
    expect(r.vl).toBe(60);
    expect(r.trasse).toEqual(a.trasse);
  });
});

describe('Dach-PV-Belegung je Variante', () => {
  it('erfasst ohne Kartenlayer und spielt zurück', () => {
    const layer = { kreis: null }; layer.kreis = layer;     // zirkulär wie ein Leaflet-Layer
    const g = { id: 1, pvAktiv: true, pvFlaechen: [{ id: 'f', typ: 'belegung', polygon: [[0, 0]], layer }], dachform: 'sattel' };
    const bel = pvBelegungErfassen([g]);
    expect(bel[1].pvFlaechen[0].layer).toBeUndefined();
    g.pvAktiv = false; g.pvFlaechen = [];
    const vorher = new Map();
    const geaendert = pvBelegungAnwenden([g], bel, vorher);
    expect(geaendert).toEqual([g]);
    expect(g.pvAktiv).toBe(true);
    expect(g.pvFlaechen).toHaveLength(1);
    expect(g.dachform).toBe('sattel');                   // Dachdaten bleiben unberührt
    expect(vorher.get(1).pvAktiv).toBe(false);
  });
  it('Gebäude ohne Eintrag behalten ihren Stand', () => {
    const g = { id: 2, pvAktiv: true };
    expect(pvBelegungAnwenden([g], { 1: { pvAktiv: false } })).toEqual([]);
    expect(g.pvAktiv).toBe(true);
  });
});

describe('Ergebnis-Stempel', () => {
  it('meldet nur eine abweichende Variante', () => {
    const s = ergebnisStempel(null, 'Hauptplan', new Date('2026-10-05T10:00:00Z'));
    expect(stempelAbweichung(s, null)).toBeNull();
    expect(stempelAbweichung(s, 'v_1')).toMatchObject({ name: 'Hauptplan' });
    expect(stempelAbweichung(null, 'v_1')).toBeNull();
  });
});

describe('Zeitstrahl', () => {
  it('ordnet Stamm, Variantenpakete und Maßnahmen ihren Spuren zu', () => {
    const ev = zeitstrahlEintraege({
      basisjahr: 2026,
      gebaeude: [{ id: 'g1', name: 'Neubau 12', baujahr: 2028, schicht: SCHICHT.ENTWICKLUNG }, { id: 'g0', name: 'Alt', baujahr: 1970 }],
      assets: [
        { id: 't1', name: 'T1', schicht: SCHICHT.BESTAND, massnahmen: [{ id: 'm', titel: '1000 kVA', jahr: 2029, variante: 'base' }] },
        { id: 'pv', name: 'PV Dach 7', schicht: SCHICHT.ENTSCHEIDUNG, baujahr: 2031 },
      ],
      pakete: [{ key: 'base', items: [] }, { key: 'v_b', items: [{ id: 'ms', name: 'MS-Abgang', baujahr: 2030 }] }],
      massnahmenAblage: { v_b: [{ ziel: 'asset', id: 't1', m: { id: 'x', titel: 'Tausch', jahr: 2033 } }] },
      aktivKey: 'base',
    });
    const kurz = ev.map(e => `${e.spur}:${e.jahr}:${e.art}`);
    expect(kurz).toContain('stamm:2028:entwicklung');
    expect(kurz).toContain('base:2029:massnahme');
    expect(kurz).toContain('base:2031:entscheidung');
    expect(kurz).toContain('v_b:2030:entscheidung');
    expect(kurz).toContain('v_b:2033:massnahme');
    expect(kurz.some(k => k.includes('1970'))).toBe(false);   // Bestand vor heute erscheint nicht
  });
});
