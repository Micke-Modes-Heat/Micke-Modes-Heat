// Vitest-Tests für lib/bestandsanlage.js und lib/gutachten-anlagentechnik.js — Ist-Zustand Anlagentechnik.
import { describe, it, expect } from 'vitest';
import { baAuswertung, baNormalisiere, baTwwAuswertung } from '../src/lib/bestandsanlage.js';
import { atTextErzeuger, atTextHydraulik, atTextTww, atTextNetz, atLeistung } from '../src/lib/gutachten-anlagentechnik.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
const PARK = {
  erzeuger: [
    { typ: 'nt_gaskessel', thermKw: '2000', feuerungKw: '2150', baujahr: '2008' },
    { typ: 'bw_gaskessel', thermKw: '1200', feuerungKw: '1250', baujahr: '2008' },
    { typ: 'pelletkessel', thermKw: '500', feuerungKw: '550', baujahr: '2008' },
    { typ: 'bhkw_gas', thermKw: '200', feuerungKw: '560', elKw: '140', baujahr: '2008' },
  ],
  pufferM3: '40', heizzentrale: 'Gebäude 12', schemaJahr: '2009',
};

describe('baAuswertung', () => {
  const a = baAuswertung(PARK, { heizlastIstKw: 3200, heizlastSollKw: 3400, jahr: 2026 });
  it('Summen und Anteile', () => {
    expect(a.thermKw).toBe(3900);
    expect(a.feuerungKw).toBe(4510);
    expect(a.elKw).toBe(140);
    expect(a.traegerAnteile[0]).toMatchObject({ traeger: 'Erdgas' });
    expect(a.traegerAnteile[0].pct).toBeCloseTo((3400 / 3900) * 100, 6);
    expect(a.fossilPct).toBeCloseTo((3400 / 3900) * 100, 6);
  });
  it('Reserve und (n−1)', () => {
    expect(a.reserveSollKw).toBe(500);
    expect(a.groesster.typ).toBe('nt_gaskessel');
    expect(a.ohneGroesstenKw).toBe(1900);
    expect(a.n1Erfuellt).toBe(false);
  });
  it('Nutzungsdauer', () => {
    expect(a.zeilen[0].abgaengigAb).toBe(2028);
    expect(a.zeilen[3].abgaengigAb).toBe(2023);
    expect(a.abgaengig.map(z => z.typ)).toEqual(['pelletkessel', 'bhkw_gas']);
  });
  it('Normalisierung', () => {
    expect(baNormalisiere({ erzeuger: [{ typ: 'quatsch' }, null], netzDaten: 'x' })).toMatchObject({ erzeuger: [{ typ: 'sonstiges' }], netzDaten: 'plan' });
  });
});

describe('Texte Wärmeerzeuger', () => {
  const t = text(atTextErzeuger(baAuswertung(PARK, { heizlastIstKw: 3200, heizlastSollKw: 3400, jahr: 2026 })));
  it('Leistung, Träger, BHKW', () => {
    expect(t).toContain('thermischen Gesamtleistung von 3,90 MW bei einer Feuerungsleistung von 4,51 MW');
    expect(t).toContain('ganz überwiegend auf Basis von Erdgas: Der NT-Gaskessel (2,00 MW) und der Brennwertkessel (1,20 MW) decken zusammen rund 82 %');
    expect(t).toContain('Erneuerbare bzw. hocheffiziente Erzeuger sind bislang nur nachrangig vertreten');
    expect(t).toContain('Der Pelletkessel trägt mit 500 kW etwa 13 % bei');
    expect(t).toContain('Das BHKW stellt mit 200 kW rund 5 % der thermischen Leistung, liefert daneben jedoch 140 kW elektrische Leistung');
  });
  it('Vergleich mit der Heizlast und (n−1)', () => {
    expect(t).toContain('sowohl die aktuelle Gesamtheizlast (3,20 MW) als auch die künftig zu erwartende Heizlast (3,40 MW) übersteigt');
    expect(t).toContain('Leistungsreserve von rund 500 kW');
    expect(t).toContain('(n−1)-Versorgungsredundanz im Auslegungspunkt ist demnach nicht gegeben');
  });
  it('fossil und Alter', () => {
    expect(t).toContain('weitgehend fossil geprägt');
    expect(t).toContain('Sämtliche Wärmeerzeuger wurden im Jahr 2008 zentral in Gebäude 12 installiert');
    expect(t).toContain('VDI 2067 sind der NT-Gaskessel und der Brennwertkessel (20 Jahre) voraussichtlich ab dem Jahr 2028 als abgängig einzustufen');
    expect(t).toContain('Der Pelletkessel und das BHKW (15 Jahre) haben die kalkulatorische Nutzungsdauer nach VDI 2067 bereits seit 2023 überschritten');
    expect(t).toContain('das BHKW (15 Jahre)');
    expect(t).toContain('Ersatz der betroffenen Erzeuger');
  });
  it('Unterdeckung künftig', () => {
    const u = text(atTextErzeuger(baAuswertung(PARK, { heizlastIstKw: 3200, heizlastSollKw: 4200, jahr: 2026 })));
    expect(u).toContain('zwar übersteigt, die künftig zu erwartende Heizlast (4,20 MW) jedoch um rund 300 kW unterschreitet');
  });
  it('ohne Bestandsanlage: Platzhalter', () => {
    expect(text(atTextErzeuger(baAuswertung({})))).toContain('[Bestehende Wärmeerzeuger');
  });
  it('Leistungsformat', () => {
    expect(atLeistung(950)).toBe('950 kW');
    expect(atLeistung(1234)).toBe('1,23 MW');
  });
});

describe('Hydraulik, TWW, Netz', () => {
  const a = baAuswertung(PARK, { jahr: 2026 });
  it('Hydraulik', () => {
    const t = text(atTextHydraulik(a));
    expect(t).toContain('multivalentes Heizsystem');
    expect(t).toContain('Nennvolumen von 40 m³ (rund 10 l je kW');
    expect(t).toContain('Stand aus dem Jahr 2009');
  });
  it('TWW aus Gebäudefeldern', () => {
    const geb = [
      { id: 1, name: 'A', twwArt: 'fws', twwKw: '400' }, { id: 2, name: 'B', twwArt: 'fws', twwKw: '300' }, { id: 3, name: 'C', twwArt: 'pwt', twwKw: '200' },
      { id: 4, name: 'D', twwArt: 'dle', twwKw: '50' }, { id: 5, name: 'E', twwArt: 'speicher', twwKw: '50' }, { id: 6, name: 'F', twwArt: 'keine' }, { id: 7, name: 'G' },
    ];
    const tw = baTwwAuswertung(geb);
    expect(tw.kw).toBe(1000);
    expect(tw.anzahlOhne).toBe(1);
    const t = text(atTextTww(tw));
    expect(t).toContain('summierte TWW-Erzeugungsleistung von rund 1.000 kW, verteilt auf 5 Gebäude; an 1 Gebäude ist keine eigene TWW-Erzeugung vorhanden');
    expect(t).toContain('Rund 90 % der TWW-Leistung entfallen auf Frischwasserstationen und Plattenwärmetauscher (zusammen ca. 900 kW)');
    expect(t).toContain('u. a. 400, 300 und 200 kW');
    expect(t).toContain('Elektrische Durchlauferhitzer (ca. 50 kW) und speicherbasierte Einzellösungen (zusammen ca. 50 kW) sind nachrangig');
    expect(t).toContain('Booster-Wärmepumpen');
    expect(text(atTextTww(baTwwAuswertung([])))).toContain('[zentral oder dezentral');
  });
  it('Netz je Datenlage', () => {
    expect(text(atTextNetz(a))).toContain('über den nachfolgenden Plan hinaus keine weiteren Angaben');
    expect(text(atTextNetz(a))).toContain('Heizzentrale befindet sich in Gebäude 12');
    expect(text(atTextNetz({ ...a, netzDaten: 'keine' }))).toContain('keine Unterlagen');
    expect(text(atTextNetz(a, { imTool: true, laengeM: 2345 }))).toContain('rund 2.345 m');
  });
});
