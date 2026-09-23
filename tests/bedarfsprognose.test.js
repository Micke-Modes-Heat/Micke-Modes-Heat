// Vitest-Tests für lib/bedarfsprognose.js — gemeinsame Rechnung von NAP-Analyse und Gutachten 3.3.1–3.3.3.
import { describe, it, expect } from 'vitest';
import {
  BP_STUFEN, bpStufeVonTyp, bpAssetLeistung, bpMassnahmen, bpWirkungImJahr,
  bpLastJahr, bpZieljahr, bpStufen, bpNormGzf, bpLadeLeistung, bpJahresreihe, bpGzfFuer,
} from '../src/lib/bedarfsprognose.js';

describe('bpLadeLeistung', () => {
  it('rechnet Normalladepunkte mit dem Gleichzeitigkeitsfaktor des Ladeparks', () => {
    const r = bpLadeLeistung({ anzahlPunkte: 10, leistungProPunktKW: 22, gleichzeitigFaktor: 0.5 });
    expect(r).toMatchObject({ punkte: 10, kwProPunkt: 22, gzf: 0.5, schnell: 0 });
    expect(r.kw).toBeCloseTo(110, 9);
  });

  it('nimmt Schnellladepunkte voll und nutzt die Vorgaben von Inspector/Knotenanalyse', () => {
    expect(bpLadeLeistung({ anzahlPunkte: 4, leistungProPunktKW: 11, gleichzeitigFaktor: 1, anzahlSchnell: 2, leistungSchnellKW: 150 }).kw).toBe(344);
    const leer = bpLadeLeistung({});
    expect(leer).toMatchObject({ punkte: 8, kwProPunkt: 11, gzf: 0.3, schnell: 0 });
    expect(leer.kw).toBeCloseTo(26.4, 9);
    expect(bpLadeLeistung({ gleichzeitigFaktor: 1.7 }).gzf).toBe(1);
  });
});

describe('bpNormGzf', () => {
  it('übernimmt gültige Werte aus Eingabe und Projektdatei', () => {
    expect(bpNormGzf(0.7)).toBe(0.7);
    expect(bpNormGzf('0.65')).toBe(0.65);
    expect(bpNormGzf('0,8')).toBe(0.8);
  });

  it('begrenzt auf 0,1 … 1 und fällt sonst auf 1,0 zurück', () => {
    expect(bpNormGzf(1.5)).toBe(1);
    expect(bpNormGzf(0.02)).toBe(0.1);
    expect(bpNormGzf(0)).toBe(1);
    expect(bpNormGzf(undefined)).toBe(1);
    expect(bpNormGzf(null)).toBe(1);
    expect(bpNormGzf('abc')).toBe(1);
  });
});

const asset = (id, type, props, extra = {}) => ({ id, type, name: id, props, ...extra });

describe('bpAssetLeistung', () => {
  it('liest die Leistung je Typ', () => {
    expect(bpAssetLeistung(asset('v', 'Verbraucher', { leistungKW: '50' }))).toEqual({ loadKW: 50, genKW: 0 });
    expect(bpAssetLeistung(asset('l', 'Lade', { anzahlPunkte: 4, leistungProPunktKW: 22, gleichzeitigFaktor: 0.5 }))).toEqual({ loadKW: 44, genKW: 0 });
    expect(bpAssetLeistung(asset('p', 'PV', { leistungKWp: 100 }))).toEqual({ loadKW: 0, genKW: 100 });
    expect(bpAssetLeistung(asset('w', 'WP', { leistungThKW: 300, leistungElKW: 100, jaz: 3 }))).toEqual({ loadKW: 100, genKW: 0 });
    expect(bpAssetLeistung(asset('w0', 'WP', { leistungKW: 80 }))).toEqual({ loadKW: 80, genKW: 0 });
    expect(bpAssetLeistung(asset('g', 'Geo', { leistungThKW: 400, leistungElKW: 90 }))).toEqual({ loadKW: 90, genKW: 0 });
    expect(bpAssetLeistung(asset('k', 'Stromkessel', { leistungKW: 200 }))).toEqual({ loadKW: 200, genKW: 0 });
    expect(bpAssetLeistung(asset('b', 'Batterie', { leistungKW: 30, betriebsmodus: 'verbraucher' }))).toEqual({ loadKW: 30, genKW: 0 });
    expect(bpAssetLeistung(asset('b2', 'Batterie', { leistungKW: 30 }))).toEqual({ loadKW: 0, genKW: 30 });
  });

  it('zählt Notstromaggregate nicht — sie laufen nur bei Netzausfall', () => {
    expect(bpAssetLeistung(asset('n', 'Nsa', { leistungKW: 400 }))).toEqual({ loadKW: 0, genKW: 0 });
  });

  it('nimmt die Profilspitze nur in Wirkrichtung', () => {
    const profil = { werte: [10, 40, 25] };
    expect(bpAssetLeistung(asset('v', 'Verbraucher', { leistungKW: 50 }, { profil }))).toEqual({ loadKW: 40, genKW: 0 });
    expect(bpAssetLeistung(asset('v0', 'Verbraucher', {}, { profil }))).toEqual({ loadKW: 40, genKW: 0 });
    expect(bpAssetLeistung(asset('p', 'PV', { leistungKWp: 100 }, { profil }))).toEqual({ loadKW: 0, genKW: 40 });
    expect(bpAssetLeistung(asset('p0', 'PV', {}, { profil: { werte: [-5, -60], invertSign: true } }))).toEqual({ loadKW: 0, genKW: 60 });
  });
});

describe('bpMassnahmen', () => {
  const assets = [
    asset('neu', 'Verbraucher', { leistungKW: 100 }, { baujahr: 2030 }),
    asset('alt', 'Verbraucher', { leistungKW: 40 }, { baujahr: 1980, abrissjahr: 2028 }),
    asset('bleibt', 'Verbraucher', { leistungKW: 70 }, { baujahr: 1990 }),
    asset('abrissOhneLast', 'Verbraucher', {}, { abrissjahr: 2027 }),
    asset('trafo', 'Trafo', { leistungKVA: 630 }, { baujahr: 2031 }),
    asset('nea', 'Nsa', { leistungKW: 400 }, { baujahr: 2029 }),
  ];

  it('findet Neubau und Rückbau nach dem Messjahr, sortiert nach Jahr', () => {
    const list = bpMassnahmen(assets, 2024);
    expect(list.map(m => m.id)).toEqual(['alt__abr', 'neu']);
    expect(list[0]).toMatchObject({ assetId: 'alt', isAbbruch: true, loadKW: 40, checked: true });
    expect(list[1]).toMatchObject({ isAbbruch: false, baujahr: 2030, netKW: 100 });
  });

  it('behält die Haken der vorigen Liste', () => {
    const vorher = bpMassnahmen(assets, 2024).map(m => ({ ...m, checked: m.id !== 'neu' }));
    const list = bpMassnahmen(assets, 2024, vorher);
    expect(list.find(m => m.id === 'neu').checked).toBe(false);
    expect(list.find(m => m.id === 'alt__abr').checked).toBe(true);
  });
});

describe('bpWirkungImJahr / bpLastJahr / bpZieljahr', () => {
  const neu = { type: 'Verbraucher', loadKW: 100, genKW: 0, baujahr: 2030, abrissjahr: null, isAbbruch: false, checked: true };
  const weg = { type: 'Verbraucher', loadKW: 40, genKW: 0, baujahr: 1980, abrissjahr: 2028, isAbbruch: true, checked: true };

  it('bestimmt die Wirkung je Jahr', () => {
    expect(bpWirkungImJahr(neu, 2029)).toBe(0);
    expect(bpWirkungImJahr(neu, 2030)).toBe(1);
    expect(bpWirkungImJahr(weg, 2027)).toBe(0);
    expect(bpWirkungImJahr(weg, 2028)).toBe(-1);
    expect(bpWirkungImJahr({ ...neu, abrissjahr: 2040 }, 2040)).toBe(0);
  });

  it('summiert den Bezug mit Gleichzeitigkeitsfaktor', () => {
    expect(bpLastJahr([neu, weg], 2035, 0.5)).toEqual({ addLoad: 30, addGen: 0 });
  });

  it('nimmt die Einspeisung mit voller Nennleistung, ohne Gleichzeitigkeitsfaktor', () => {
    const pv = { loadKW: 0, genKW: 200, baujahr: 2030, abrissjahr: null, isAbbruch: false, checked: true };
    expect(bpLastJahr([neu, pv], 2035, 0.5)).toEqual({ addLoad: 50, addGen: 200 });
  });

  it('setzt den globalen Gleichzeitigkeitsfaktor nur auf Gebäudeverbraucher', () => {
    expect(bpGzfFuer('Verbraucher', 0.6)).toBe(0.6);
    for (const t of ['WP', 'Geo', 'FG', 'Stromkessel', 'TWW', 'Lade', 'Batterie']) expect(bpGzfFuer(t, 0.6)).toBe(1);
    const wp   = { type: 'WP',   loadKW: 80, genKW: 0, baujahr: 2030, abrissjahr: null, isAbbruch: false, checked: true };
    const lade = { type: 'Lade', loadKW: 26.4, genKW: 0, baujahr: 2030, abrissjahr: null, isAbbruch: false, checked: true };
    // Gebäude 100 × 0,5 + WP voll + Ladepark voll (sein GZF steckt schon in loadKW)
    expect(bpLastJahr([neu, wp, lade], 2035, 0.5).addLoad).toBeCloseTo(50 + 80 + 26.4, 9);
  });

  it('nimmt das späteste angehakte Jahr als Zieljahr', () => {
    expect(bpZieljahr([neu, weg])).toBe(2030);
    expect(bpZieljahr([{ ...neu, checked: false }, weg])).toBe(2028);
    expect(bpZieljahr([])).toBeNull();
  });
});

describe('bpStufen', () => {
  const m = (id, type, kw, jahr, isAbbruch = false, checked = true, genKW = 0) => ({
    id, type, loadKW: kw, genKW, isAbbruch, checked,
    baujahr: isAbbruch ? 1990 : jahr, abrissjahr: isAbbruch ? jahr : null,
  });
  const liste = [
    m('g-weg', 'Verbraucher', 160, 2027, true),
    m('g-neu', 'Verbraucher', 300, 2030),
    m('wp', 'WP', 180, 2031),
    m('lade', 'Lade', 220, 2033),
    m('lade-aus', 'Lade', 999, 2033, false, false),
    m('pv', 'PV', 0, 2032, false, true, 150),
  ];

  it('ordnet Typen den Gutachtenstufen zu', () => {
    expect(BP_STUFEN.map(s => s.kapitel)).toEqual(['3.3.1', '3.3.2', '3.3.3']);
    expect(bpStufeVonTyp('TWW')).toBe('waerme');
    expect(bpStufeVonTyp('Geo')).toBe('waerme');
    expect(bpStufeVonTyp('Stromkessel')).toBe('waerme');
    expect(bpStufeVonTyp('Nsa')).toBe('sonstige');
  });

  it('baut die Stufen aufeinander auf', () => {
    const r = bpStufen({ basisKw: 1000, gzf: 1, massnahmen: liste });
    expect(r.zieljahr).toBe(2033);
    const [geb, waerme, lade] = r.stufen;
    expect(geb).toMatchObject({ startKw: 1000, rueckbauKw: -160, zubauKw: 300, endKw: 1140 });
    expect(waerme).toMatchObject({ startKw: 1140, zubauKw: 180, endKw: 1320 });
    expect(lade).toMatchObject({ startKw: 1320, zubauKw: 220, endKw: 1540 });
    // Erzeugung mindert den Bezug nicht, sie steht getrennt als Einspeisung
    expect(r.sonstige.kw).toBe(0);
    expect(r.endKw).toBe(1540);
    expect(r.einspeisung.kw).toBe(150);
    expect(r.einspeisung.eintraege.map(e => e.m.id)).toEqual(['pv']);
    expect(r.abgewaehlt).toBe(1);
  });

  it('stimmt im Zieljahr exakt mit der Lastentwicklung der NAP-Analyse überein', () => {
    const gzf = 0.8;
    const r = bpStufen({ basisKw: 1000, gzf, massnahmen: liste });
    const { addLoad, addGen } = bpLastJahr(liste.filter(x => x.checked), r.zieljahr, gzf);
    expect(r.endKw).toBeCloseTo(1000 + addLoad, 9);
    expect(r.einspeisung.kw).toBeCloseTo(addGen, 9);
    expect(r.einspeisung.kw).toBe(150);   // PV voll, obwohl GZF 0,8
    // GZF nur auf Gebäude: (−160 + 300) × 0,8, WP und Ladepark voll
    expect(r.stufen[0].endKw).toBeCloseTo(1000 + 140 * 0.8, 9);
    expect(r.stufen[1].zubauKw).toBe(180);
    expect(r.stufen[2].zubauKw).toBe(220);
  });

  it('liefert die Jahresreihe bis zum Zieljahr mit derselben Endleistung', () => {
    const reihe = bpJahresreihe({ basisKw: 1000, gzf: 1, massnahmen: liste, von: 2026, bis: 2033 });
    expect(reihe.map(z => z.jahr)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    expect(reihe[0]).toEqual({ jahr: 2026, bezugKw: 1000, einspeisungKw: 0 });
    expect(reihe.find(z => z.jahr === 2027).bezugKw).toBe(840);
    expect(reihe[reihe.length - 1].bezugKw).toBe(bpStufen({ basisKw: 1000, gzf: 1, massnahmen: liste }).endKw);
    expect(reihe[reihe.length - 1].einspeisungKw).toBe(150);
  });

  it('lässt Maßnahmen nach einem festen Zieljahr weg', () => {
    const r = bpStufen({ basisKw: 1000, massnahmen: liste, zieljahr: 2030 });
    expect(r.stufen[0].endKw).toBe(1140);
    expect(r.stufen[1].zubauKw).toBe(0);
    expect(r.stufen[2].eintraege).toHaveLength(0);
  });
});
