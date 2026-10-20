import { describe, it, expect } from 'vitest';
import {
  ncEinspeisungImJahr, ncZieljahr, ncReihe, ncUeberschreitung, ncWege, ncBaustein, ncCsv, ncBedarfSvg,
  ncAntwort, ncLeiterSvg, ncMassgeblichKva, NC_NETZEBENEN, ncCheckliste, ncMassnahme,
} from '../src/lib/netzanschluss-check.js';
import { aeEinordnung, aeSvg, aeKva } from '../src/lib/anschlussebenen.js';
import { uwParameterMischen, uwBewerten, uwSatz } from '../src/lib/umspannwerk-core.js';

const P = uwParameterMischen(null);

const ASSETS = [
  { id: 'pv1', type: 'PV', props: { leistungKWp: 500 } },                         // Bestand
  { id: 'pv2', type: 'PV', props: { leistungKWp: 3000 }, baujahr: 2030 },          // Zubau
  { id: 'bh', type: 'KWK', props: { leistungElKW: 200 }, abrissjahr: 2028 },       // Rückbau
  { id: 'wp', type: 'WP', props: { leistungElKW: 400 }, baujahr: 2029 },           // Last, keine Einspeisung
];
const STAND = {
  dataYear: 2026, basisKw: 1800, gzf: 1, quelle: 'Messung 2026',
  massnahmen: [{ id: 'wp', type: 'WP', loadKW: 400, genKW: 0, baujahr: 2029, abrissjahr: null, isAbbruch: false, checked: true }],
};

describe('netzanschluss-check: Bedarf', () => {
  it('Einspeisung je Jahr: Bestand + Zubau − Rückbau', () => {
    expect(ncEinspeisungImJahr(ASSETS, 2026)).toBe(700);
    expect(ncEinspeisungImJahr(ASSETS, 2028)).toBe(500);
    expect(ncEinspeisungImJahr(ASSETS, 2030)).toBe(3500);
  });

  it('Zieljahr = spätestes Maßnahmen- oder Erzeugerjahr', () => {
    expect(ncZieljahr(STAND, ASSETS)).toBe(2030);
    expect(ncZieljahr({ dataYear: 2026, massnahmen: [] }, [])).toBe(2026);
  });

  it('Reihe: Bezug aus der Bedarfsprognose, Überschreitung je Richtung', () => {
    const reihe = ncReihe({ stand: STAND, assets: ASSETS, von: 2026, bis: 2032 });
    expect(reihe[0]).toMatchObject({ jahr: 2026, bezugKw: 1800, einspKw: 700 });
    expect(reihe.find(r => r.jahr === 2029).bezugKw).toBe(2200);
    expect(ncUeberschreitung(reihe, 'bezugKw', 2000)).toBe(2029);
    expect(ncUeberschreitung(reihe, 'einspKw', 1500)).toBe(2030);
    expect(ncUeberschreitung(reihe, 'einspKw', null)).toBeNull();
  });
});

describe('netzanschluss-check: Wege und Text', () => {
  const reihe = ncReihe({ stand: STAND, assets: ASSETS, von: 2026, bis: 2032 });
  const ziel = { jahr: 2030, bezugKw: 2200, einspKw: 3500 };
  const grenzen = { bezugKw: 2500, einspKw: 1500 };
  const uwRoh = { lat: 48.03, lng: 9.0, msKv: 20, trafos: [] };
  const b = uwBewerten(uwRoh, { ref: { lat: 48, lng: 9 }, p: P, ziel: { bezugMw: 2.2, einspMw: 3.5 } });

  it('A meldet das letzte tragfähige Jahr, C deckt das Ziel', () => {
    const w = ncWege({ ziel, grenzen, reihe, p: P, uw: { name: 'UW Test', b } });
    expect(w.map(x => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(w[0].ampel).toMatchObject({ stufe: 'warn', text: 'reicht bis 2029 (Einspeisung)' });
    expect(w[2].ampel.stufe).toBe('ok');
    expect(w[3].ampel.stufe).toBe('na');
    // Karten: Einheiten je Richtung beschriftet, nächster Schritt je Weg
    expect(w[0].traegt).toBe('Bezug 2,5 MVA · Einsp. 1,5 MW');
    expect(w.map(x => x.naechster.aktion)).toEqual(['pva', 'ergebnis', 'uw-zeigen', null]);
    const ohneUw = ncWege({ ziel, grenzen: {}, reihe, p: P, uw: null });
    expect(ohneUw[0].naechster.aktion).toBe('grenzen');
    expect(ohneUw[2].naechster.aktion).toBe('uw-waehlen');
  });

  it('A: schon im Messjahr überschritten', () => {
    const w = ncWege({ ziel, grenzen: { bezugKw: 1000, einspKw: null }, reihe, p: P, uw: null });
    expect(w[0].ampel).toMatchObject({ stufe: 'bad' });
    expect(w[2].ampel.stufe).toBe('na');   // ohne gewähltes UW
  });

  it('Textbaustein nennt Grenzen, Bedarf, Zeitpunkt und Vorbehalt', () => {
    const t = ncBaustein({ stand: STAND, ziel, grenzen, reihe, uw: { name: 'UW Test', betreiber: 'Netz AG', b }, osmStand: '2026-10-14' });
    expect(t).toMatch(/2\.500 kVA Bezug/);
    expect(t).toMatch(/für die Einspeisung bis 2029/);
    expect(t).toMatch(/geeignete UW Test \(Netz AG\)/);
    expect(t).not.toMatch(/Umspannwerk UW/);
    expect(t).toMatch(/gemessenen Höchstlast von 1,8 MW im Jahr 2026/);
    expect(t).toMatch(/wäre ein Kabelsystem nötig/);
    const ohneKv = ncBaustein({ stand: STAND, ziel, grenzen, reihe, uw: { name: 'Umspannwerk Nord', b: { ...b, uAusUw: false } } });
    expect(ohneKv).toMatch(/geeignete Umspannwerk Nord liegt/);
    expect(ohneKv).toMatch(/angenommen 20 kV/);
    expect(t).toMatch(/Netzanschlussanfrage/);
  });

  it('CSV und Diagramm', () => {
    const csv = ncCsv(reihe, grenzen).split('\r\n');
    expect(csv[0]).toMatch(/^Jahr;/);
    expect(csv[1]).toBe('2026;1800;700;2500;1500');
    expect(ncBedarfSvg({ reihe, grenzen, zieljahr: 2030 })).toMatch(/^<svg/);
  });
});

describe('netzanschluss-check: Antwort und Leistungsleiter', () => {
  const reihe = ncReihe({ stand: STAND, assets: ASSETS, von: 2026, bis: 2032 });
  const grenzen = { bezugKw: 2500, einspKw: 1500 };
  const zielVon = j => { const r = reihe.find(z => z.jahr === j); return { jahr: j, bezugKw: r.bezugKw, einspKw: r.einspKw }; };

  it('vor der ersten Überschreitung: Bestand reicht, nichts zu tun', () => {
    const ziel = zielVon(2028);
    const wege = ncWege({ ziel, grenzen, reihe, p: P, uw: null });
    expect(wege[0].ampel.stufe).toBe('ok');   // Einspeisung wird erst 2030 knapp — nach dem Zieljahr
    const a = ncAntwort({ reihe, ziel, grenzen, wege, heute: 2026 });
    expect(a.bezug).toMatchObject({ stufe: 'ok', satz: 'reicht bis 2028' });
    expect(a.einsp.stufe).toBe('ok');
    expect(a.empfehlung).toMatchObject({ satz: 'Nichts zu tun', weg: 'A' });
  });

  it('Überschreitung vor dem Zieljahr: reicht bis Vorjahr, Empfehlung = günstigster grüner Weg', () => {
    const ziel = zielVon(2030);   // 2,2 MW Bezug, 3,5 MW Einspeisung → 3,7 MVA
    const wege = ncWege({ ziel, grenzen, reihe, p: P, uw: null });
    const a = ncAntwort({ reihe, ziel, grenzen, wege, heute: 2026 });
    expect(a.bezug.stufe).toBe('ok');
    expect(a.einsp).toMatchObject({ stufe: 'warn', satz: 'reicht bis 2029' });
    expect(a.empfehlung).toMatchObject({ weg: 'B', stufe: 'warn' });   // B im Grenzbereich, C ohne UW offen
  });

  it('schon heute zu knapp und ohne Grenzen', () => {
    const ziel = zielVon(2026);
    const g = { bezugKw: 1000, einspKw: null };
    const a = ncAntwort({ reihe, ziel, grenzen: g, wege: ncWege({ ziel, grenzen: g, reihe, p: P, uw: null }), heute: 2026 });
    expect(a.bezug.stufe).toBe('bad');
    expect(a.einsp.stufe).toBe('na');
    const leer = ncAntwort({ reihe, ziel, grenzen: {}, wege: ncWege({ ziel, grenzen: {}, reihe, p: P, uw: null }), heute: 2026 });
    expect(leer.empfehlung.satz).toMatch(/vereinbarte Leistung eintragen/);
  });

  it('Leiter: Bereiche je Weg, Netzebenen lückenlos, SVG mit Bedarfsmarke', () => {
    const ziel = zielVon(2030);
    const uw = { lat: 48.03, lng: 9.0, msKv: 20, trafos: [] };
    const b = uwBewerten(uw, { ref: { lat: 48, lng: 9 }, p: P, ziel: { bezugMw: 2.2, einspMw: 3.5 } });
    const wege = ncWege({ ziel, grenzen, reihe, p: P, uw: { name: 'UW Test', b } });
    expect(wege[0].leiter.fest).toEqual([[0, 2500]]);
    expect(wege[0].leiter.kerbe).toBeCloseTo(1500 / P.cosPhi, 6);
    expect(wege[2].leiter.fest[0][1]).toBeGreaterThan(1000);                  // eigenes Kabel belastbar
    expect(wege[2].leiter.annahme[0][1]).toBeCloseTo(b.n1.mva * 1000, 6);     // UW-Reserve nur Annahme
    expect(wege[3].leiter.annahme[0][0]).toBe(P.grenzeUwMva * 1000);
    for (let i = 1; i < NC_NETZEBENEN.length; i++) expect(NC_NETZEBENEN[i].von).toBeCloseTo(NC_NETZEBENEN[i - 1].bis, 6);
    expect(ncMassgeblichKva(ziel, P)).toBeCloseTo(3500 / P.cosPhi, 6);
    const svg = ncLeiterSvg({ ziel, p: P, wege, farben: {} });
    expect(svg).toMatch(/^<svg/);
    expect(svg).toMatch(/Bedarf 2030: 3,7 MVA/);
    expect(svg).toMatch(/UW \(n-1\)/);
    expect(svg).toMatch(/ncl-schraff-ok/);
  });
});

describe('anschlussebenen', () => {
  it('ordnet Leistungen ein', () => {
    const e = aeEinordnung(10000);
    expect(e.haeufig.map(b => b.name)).toContain('20 kV · Sammelschiene UW');
    expect(e.tab.t).toBe('Sammelschiene im UW');
    expect(aeEinordnung(0).haeufig).toEqual([]);
    expect(aeKva(2500)).toBe('2,5 MVA');
  });
  it('zeichnet Marker', () => {
    const s = aeSvg({ farben: {}, marker: [{ kva: 5000, farbe: '#f00', label: 'B 2030' }] });
    expect(s).toMatch(/B 2030/);
  });
});

describe('umspannwerk-core: n-1 zwischen Kabelsystemen', () => {
  const uw = { lat: 48.03, lng: 9.0, msKv: 20, trafos: [], name: 'UW Test' };
  const ref = { lat: 48, lng: 9 };
  it('mit Reserve trägt das kleinste Paket ein System, braucht aber zwei', () => {
    const ohne = uwBewerten(uw, { ref, p: P, ziel: { bezugMw: 5 } });
    const mit = uwBewerten(uw, { ref, p: P, ziel: { bezugMw: 5 }, redundant: true });
    expect(mit.stufen[0].systeme).toBe(2);
    expect(mit.stufen[0].bezugMw).toBeCloseTo(ohne.stufen[0].bezugMw, 6);
    expect(mit.ziel.systeme).toBe(ohne.ziel.systeme + 1);
    expect(mit.stufen[0].kosten.anschlussEur).toBeGreaterThan(ohne.stufen[0].kosten.anschlussEur);
    expect(uwSatz(uw, mit)).toMatch(/Reserve \(n-1\)/);
  });
});

describe('netzanschluss-check: Steckbrief', () => {
  const reihe = ncReihe({ stand: STAND, assets: ASSETS, von: 2026, bis: 2032 });
  const grenzen = { bezugKw: 2500, einspKw: 1500 };
  const ziel = { jahr: 2030, bezugKw: 2200, einspKw: 3500 };

  it('Checkliste: abgeleitete Punkte, UW nur bei Weg C/D, Haken von Hand', () => {
    const c = ncCheckliste({ reihe, stand: STAND, grenzen, erzeuger: 2, netzbetreiber: '', empfWeg: 'B', uwGewaehlt: false });
    const st = id => c.find(x => x.id === id).stufe;
    expect(st('tabelle')).toBe('ok');
    expect(st('lastgang')).toBe('ok');
    expect(st('grenzen')).toBe('ok');
    expect(st('netzbetreiber')).toBe('fehlt');
    expect(st('uw')).toBe('na');
    expect(st('lageplan')).toBe('fehlt');
    const c2 = ncCheckliste({ reihe, stand: {}, grenzen: {}, erzeuger: 0, netzbetreiber: 'Netz AG', empfWeg: 'C', uwGewaehlt: false, haken: { lageplan: true } });
    const st2 = id => c2.find(x => x.id === id).stufe;
    expect(st2('lastgang')).toBe('fehlt');
    expect(st2('erzeuger')).toBe('na');
    expect(st2('uw')).toBe('fehlt');
    expect(st2('lageplan')).toBe('ok');
    expect(st2('netzbetreiber')).toBe('ok');
  });

  it('Maßnahme: Jahr der ersten Überschreitung, Kosten nur beim Direktanschluss', () => {
    const uw = { name: 'UW Test', b: uwBewerten({ lat: 48.03, lng: 9.0, msKv: 20, trafos: [] }, { ref: { lat: 48, lng: 9 }, p: P, ziel: { bezugMw: 2.2, einspMw: 3.5 } }) };
    const wege = ncWege({ ziel, grenzen, reihe, p: P, uw });
    const b = ncMassnahme({ weg: wege[1], reihe, grenzen, ziel, p: P, heute: 2026, uw });
    expect(b).toMatchObject({ typ: 'Ertuechtigung', jahr: 2030, kosten: 0, weg: 'B' });
    expect(b.titel).toMatch(/3,7 MVA/);
    const c = ncMassnahme({ weg: wege[2], reihe, grenzen, ziel, p: P, heute: 2026, uw });
    expect(c.typ).toBe('Bau');
    expect(c.kosten).toBeGreaterThan(0);
    expect(c.titel).toMatch(/UW Test, 1 Kabelsystem, Trasse/);
    // ohne Überschreitung bis zum Zieljahr: das Zieljahr
    const früh = ncMassnahme({ weg: wege[1], reihe, grenzen, ziel: { jahr: 2028, bezugKw: 1800, einspKw: 500 }, p: P, heute: 2026, uw: null });
    expect(früh.jahr).toBe(2028);
  });
});
