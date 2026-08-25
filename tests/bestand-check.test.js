// Vitest-Tests für lib/bestand-check.js — Plausibilitätsprüfung des Bestands.
// Importfrei/DOM-frei → direkt als ESM importierbar.
import { describe, it, expect } from 'vitest';
import {
  SCHWERE, pruefeKabellaengen, pruefeQuerschnitte, pruefeTopologie,
  pruefeLebenszyklus, pruefeAuslastungHeute, bestandReifegrad, bestandPruefen,
} from '../src/lib/bestand-check.js';

const idsVon = befunde => befunde.map(b => b.id);
const finde  = (befunde, id) => befunde.find(b => b.id === id);

describe('pruefeKabellaengen', () => {
  it('meldet nichts bei plausiblen Längen', () => {
    expect(pruefeKabellaengen([{ id: 'e1', lengthM: 42 }])).toEqual([]);
  });

  it('meldet Länge 0 als Fehler — der Auslöser der 0-€-Kosten', () => {
    const b = finde(pruefeKabellaengen([{ id: 'e1', lengthM: 0 }]), 'laenge-null');
    expect(b.schwere).toBe(SCHWERE.FEHLER);
    expect(b.betroffene).toHaveLength(1);
  });

  it('behandelt fehlende und unlesbare Längen wie 0', () => {
    const b = finde(pruefeKabellaengen([{ id: 'a' }, { id: 'b', lengthM: null }, { id: 'c', lengthM: 'x' }]), 'laenge-null');
    expect(b.betroffene).toHaveLength(3);
  });

  it('meldet sehr kurze Kabel nur als Warnung', () => {
    const b = finde(pruefeKabellaengen([{ id: 'e1', lengthM: 0.4 }]), 'laenge-winzig');
    expect(b.schwere).toBe(SCHWERE.WARNUNG);
  });

  it('verträgt leere Eingaben', () => {
    expect(pruefeKabellaengen([])).toEqual([]);
    expect(pruefeKabellaengen(null)).toEqual([]);
  });
});

describe('pruefeQuerschnitte', () => {
  it('lässt auto-dimensionierte Kabel ohne Querschnitt durchgehen', () => {
    expect(pruefeQuerschnitte([{ id: 'e1', autoSized: true, crossSection: 0 }])).toEqual([]);
  });

  it('meldet fest dimensionierte Kabel ohne Querschnitt', () => {
    const b = finde(pruefeQuerschnitte([{ id: 'e1', autoSized: false, crossSection: 0 }]), 'querschnitt-fehlt');
    expect(b.schwere).toBe(SCHWERE.FEHLER);
  });
});

describe('pruefeTopologie', () => {
  const netz = () => ({
    assets: [
      { id: 'nap', type: 'NAP', name: 'NAP 1' },
      { id: 'tr',  type: 'Trafo', name: 'Trafo 1' },
      { id: 'vb',  type: 'Verbraucher', name: 'Halle 1' },
    ],
    edges: [{ id: 'e1', u: 'nap', v: 'tr' }, { id: 'e2', u: 'tr', v: 'vb' }],
  });

  it('meldet nichts bei durchgehend verbundenem Netz', () => {
    const { assets, edges } = netz();
    expect(pruefeTopologie(assets, edges)).toEqual([]);
  });

  it('meldet ein fehlendes NAP als Fehler und bricht dann ab', () => {
    const { assets, edges } = netz();
    const b = pruefeTopologie(assets.filter(a => a.type !== 'NAP'), edges);
    expect(idsVon(b)).toEqual(['keine-quelle']);
    expect(b[0].schwere).toBe(SCHWERE.FEHLER);
  });

  it('erkennt eine Anlage ganz ohne Leitung', () => {
    const { assets, edges } = netz();
    assets.push({ id: 'pv', type: 'PV', name: 'PV Dach A' });
    const b = finde(pruefeTopologie(assets, edges), 'ohne-kante');
    expect(b.betroffene.map(x => x.id)).toEqual(['pv']);
  });

  it('erkennt eine verkabelte, aber von der Quelle getrennte Insel', () => {
    const { assets, edges } = netz();
    assets.push({ id: 'i1', type: 'UV', name: 'UV Insel' }, { id: 'i2', type: 'Verbraucher', name: 'Halle 9' });
    edges.push({ id: 'e9', u: 'i1', v: 'i2' });   // eigene Komponente ohne NAP-Pfad
    const b = finde(pruefeTopologie(assets, edges), 'unerreichbar');
    expect(b.betroffene.map(x => x.id).sort()).toEqual(['i1', 'i2']);
  });

  it('erlaubt einen abweichenden Quelltyp', () => {
    const assets = [{ id: 's', type: 'Schaltanlage' }, { id: 'v', type: 'Verbraucher' }];
    const edges  = [{ id: 'e', u: 's', v: 'v' }];
    expect(pruefeTopologie(assets, edges, ['Schaltanlage'])).toEqual([]);
  });
});

describe('pruefeLebenszyklus', () => {
  it('meldet nichts bei stimmigen Jahren', () => {
    expect(pruefeLebenszyklus([{ id: 'a', baujahr: 1980, abrissjahr: 2040 }], 2026)).toEqual([]);
  });

  it('meldet Abriss vor Baujahr als Fehler', () => {
    const b = finde(pruefeLebenszyklus([{ id: 'a', baujahr: 2040, abrissjahr: 2030 }], 2026), 'lebenszyklus-verdreht');
    expect(b.schwere).toBe(SCHWERE.FEHLER);
  });

  it('meldet Bestand mit Baujahr in der Zukunft — erst durch die Schichten prüfbar', () => {
    const b = finde(pruefeLebenszyklus([{ id: 'a', schicht: 'bestand', baujahr: 2035 }], 2026), 'bestand-zukunft');
    expect(b.schwere).toBe(SCHWERE.WARNUNG);
    expect(b.betroffene[0].id).toBe('a');
  });

  it('meldet ein Zukunfts-Baujahr in der Entwicklungsschicht NICHT', () => {
    expect(pruefeLebenszyklus([{ id: 'a', schicht: 'entwicklung', baujahr: 2035 }], 2026)).toEqual([]);
  });

  it('übernimmt die Objektart für den Kartensprung', () => {
    const b = finde(pruefeLebenszyklus([{ id: 'g1', _art: 'gebaeude', baujahr: 2040, abrissjahr: 2030 }], 2026), 'lebenszyklus-verdreht');
    expect(b.betroffene[0].art).toBe('gebaeude');
  });
});

describe('pruefeAuslastungHeute', () => {
  it('meldet nichts unterhalb der Grenze', () => {
    expect(pruefeAuslastungHeute([{ id: 'e', auslastungPct: 80 }], 100)).toEqual([]);
  });

  it('meldet Überlast im Basisjahr als Warnung', () => {
    const b = finde(pruefeAuslastungHeute([{ id: 'e', auslastungPct: 140 }], 100), 'ueberlast-heute');
    expect(b.schwere).toBe(SCHWERE.WARNUNG);
    expect(b.betroffene[0].label).toContain('140');
  });
});

describe('bestandReifegrad', () => {
  it('erfüllt keine Stufe ohne jede Erfassung', () => {
    expect(bestandReifegrad({}).every(s => !s.erfuellt)).toBe(true);
  });

  it('erfüllt die Bedarfsstufe, sobald alle Gebäude Fläche und Nutzung haben', () => {
    const r = bestandReifegrad({ gebaeude: [{ flaeche: 500, nutzung: 'buero' }] });
    expect(r.find(s => s.id === 'bedarf').erfuellt).toBe(true);
  });

  it('benennt, wie viele Gebäude noch fehlen', () => {
    const r = bestandReifegrad({ gebaeude: [{ flaeche: 500, nutzung: 'buero' }, { flaeche: 0 }] });
    const s = r.find(x => x.id === 'bedarf');
    expect(s.erfuellt).toBe(false);
    expect(s.fehlt).toContain('1 Gebäude');
  });

  it('verweigert die Lastflussstufe, solange Längen fehlen — und sagt es', () => {
    const r = bestandReifegrad({
      assets: [{ id: 'nap', type: 'NAP' }],
      edges: [{ lengthM: 0, crossSection: 95 }, { lengthM: 20, crossSection: 95 }],
    });
    const s = r.find(x => x.id === 'lastfluss');
    expect(s.erfuellt).toBe(false);
    expect(s.fehlt).toContain('1 ohne Länge');
  });

  it('erfüllt die Lastflussstufe bei vollständigen Kabeldaten', () => {
    const r = bestandReifegrad({
      assets: [{ id: 'nap', type: 'NAP' }],
      edges: [{ lengthM: 20, crossSection: 95 }],
    });
    expect(r.find(x => x.id === 'lastfluss').erfuellt).toBe(true);
  });
});

describe('bestandPruefen', () => {
  it('sortiert Fehler vor Warnungen', () => {
    const res = bestandPruefen({
      assets: [{ id: 'nap', type: 'NAP' }, { id: 'pv', type: 'PV' }],
      edges:  [{ id: 'e1', u: 'nap', v: 'x', lengthM: 0 }],
      gebaeude: [],
      heute: 2026,
    });
    const rang = { fehler: 0, warnung: 1, hinweis: 2 };
    const werte = res.befunde.map(b => rang[b.schwere]);
    expect(werte).toEqual([...werte].sort((a, b) => a - b));
  });

  it('zählt die Befunde je Schwere', () => {
    const res = bestandPruefen({
      assets: [{ id: 'nap', type: 'NAP' }],
      edges:  [{ id: 'e1', u: 'nap', v: 'nap', lengthM: 0 }],
      heute: 2026,
    });
    expect(res.zaehler.fehler).toBeGreaterThan(0);
    expect(res.zaehler.fehler + res.zaehler.warnung + res.zaehler.hinweis).toBe(res.befunde.length);
  });

  it('bezieht Gebäude in die Lebenszyklusprüfung ein', () => {
    const res = bestandPruefen({
      assets: [{ id: 'nap', type: 'NAP' }],
      edges: [],
      gebaeude: [{ id: 7, name: 'Halle', baujahr: 2040, abrissjahr: 2030 }],
      heute: 2026,
    });
    const b = finde(res.befunde, 'lebenszyklus-verdreht');
    expect(b.betroffene[0]).toMatchObject({ id: 7, art: 'gebaeude' });
  });

  it('liefert bei sauberem Bestand keine Befunde', () => {
    const res = bestandPruefen({
      assets: [
        { id: 'nap', type: 'NAP', baujahr: 1990 },
        { id: 'vb',  type: 'Verbraucher', baujahr: 1990 },
      ],
      edges: [{ id: 'e1', u: 'nap', v: 'vb', lengthM: 30, crossSection: 95, auslastungPct: 40 }],
      gebaeude: [{ id: 1, flaeche: 500, nutzung: 'buero' }],
      heute: 2026,
    });
    expect(res.befunde).toEqual([]);
  });

  it('verträgt komplett leere Eingaben', () => {
    const res = bestandPruefen({});
    expect(Array.isArray(res.befunde)).toBe(true);
    expect(res.reifegrad).toHaveLength(4);
  });
});
