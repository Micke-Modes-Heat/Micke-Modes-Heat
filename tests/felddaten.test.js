import { describe, it, expect } from 'vitest';
import { captureFelddaten, applyFelddaten, planFeldMerge, pickFeldwerte, sauberFeldDaten } from '../src/lib/felddaten.js';

const FOTO_A = { name: 'foto_01.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' };
const FOTO_B = { name: 'foto_02.jpg', dataUrl: 'data:image/jpeg;base64,BBBB' };

describe('Felddaten sichern und wiederherstellen', () => {
  it('überlebt einen Speichern-/Laden-Zyklus (Gebäude, Assets, Erzeuger)', () => {
    const gebaeude = [
      { id: 1, name: 'Rathaus', feldStatus: 'erledigt', feldNotizen: 'Heizraum im Keller', feldDaten: { baujahr: '1971', heizung: 'Gas' }, feldVorgemerkt: true, feldFotos: [FOTO_A] },
      { id: 2, name: 'Ohne Befund' },
    ];
    const assets = [{ id: 'a1', feldStatus: 'besucht' }];
    const erzeuger = { lwWp: { lat: 1, lng: 2, feldNotizen: 'Aufstellort prüfen' } };

    const gesichert = JSON.parse(JSON.stringify(captureFelddaten({ gebaeude, assets, erzeuger })));
    expect(Object.keys(gesichert.gebaeude)).toEqual(['1']);

    const neuGeb = [{ id: 1, name: 'Rathaus' }, { id: 2, name: 'Ohne Befund' }];
    const neuAssets = [{ id: 'a1' }];
    const neuErz = { lwWp: { lat: 1, lng: 2 } };
    expect(applyFelddaten(gesichert, { gebaeude: neuGeb, assets: neuAssets, erzeuger: neuErz })).toBe(3);
    expect(neuGeb[0]).toMatchObject({ feldStatus: 'erledigt', feldNotizen: 'Heizraum im Keller', feldDaten: { baujahr: '1971', heizung: 'Gas' }, feldVorgemerkt: true, feldFotos: [FOTO_A] });
    expect(neuGeb[1].feldStatus).toBeUndefined();
    expect(neuAssets[0].feldStatus).toBe('besucht');
    expect(neuErz.lwWp.feldNotizen).toBe('Aufstellort prüfen');
  });

  it('ignoriert fehlende oder kaputte Abschnitte (Altprojekte)', () => {
    const g = [{ id: 1 }];
    expect(applyFelddaten(undefined, { gebaeude: g })).toBe(0);
    expect(applyFelddaten({ gebaeude: 'quatsch' }, { gebaeude: g })).toBe(0);
    expect(g[0]).toEqual({ id: 1 });
  });

  it('nimmt nur gültige Werte mit', () => {
    expect(pickFeldwerte({ feldStatus: 'kaputt', feldNotizen: '   ', feldFotos: [{ dataUrl: 'javascript:alert(1)' }] })).toBeNull();
    expect(sauberFeldDaten({ baujahr: ' 1971 ', fremd: 'x', heizung: 'a'.repeat(500) })).toEqual({ baujahr: '1971', heizung: 'a'.repeat(200) });
  });
});

describe('Felddaten zusammenführen', () => {
  it('leere Werte aus der Feldapp überschreiben nichts', () => {
    const ziel = { feldNotizen: 'Wichtig', feldStatus: 'besucht', feldDaten: { baujahr: '1971' } };
    const plan = planFeldMerge(ziel, { feldNotizen: '', feldDaten: {} });
    expect(plan.aenderungen).toBe(0);
    expect(plan.patch).toEqual({});
  });

  it('zwei Kollegen, zwei Notizen: beide bleiben erhalten', () => {
    const ziel = { feldNotizen: 'Zugang über Hof' };
    const plan = planFeldMerge(ziel, { feldNotizen: 'Hausmeister ab 7 Uhr' }, [], { label: 'Feldapp 22.09.2026' });
    expect(plan.patch.feldNotizen).toContain('Zugang über Hof');
    expect(plan.patch.feldNotizen).toContain('Hausmeister ab 7 Uhr');
    expect(plan.konflikte).toHaveLength(1);
  });

  it('erweiterte Notiz ersetzt die alte, gleiche Notiz ändert nichts', () => {
    expect(planFeldMerge({ feldNotizen: 'Zugang' }, { feldNotizen: 'Zugang über Hof' }).patch.feldNotizen).toBe('Zugang über Hof');
    expect(planFeldMerge({ feldNotizen: 'Zugang' }, { feldNotizen: 'Zugang' }).aenderungen).toBe(0);
  });

  it('Status geht nur vorwärts', () => {
    expect(planFeldMerge({ feldStatus: 'besucht' }, { feldStatus: 'erledigt' }).patch.feldStatus).toBe('erledigt');
    const zurueck = planFeldMerge({ feldStatus: 'erledigt' }, { feldStatus: 'offen' });
    expect(zurueck.patch.feldStatus).toBeUndefined();
    expect(zurueck.konflikte).toHaveLength(1);
    expect(planFeldMerge({}, { feldStatus: 'besucht' }).patch.feldStatus).toBe('besucht');
  });

  it('Vor-Ort-Werte werden ergänzt, abweichende gemeldet', () => {
    const plan = planFeldMerge({ feldDaten: { baujahr: '1970' } }, { feldDaten: { baujahr: '1971', heizung: 'Gas' } });
    expect(plan.patch.feldDaten).toEqual({ baujahr: '1971', heizung: 'Gas' });
    expect(plan.konflikte).toEqual(['Baujahr Gebäude (vor Ort): „1970" → „1971"']);
  });

  it('Fotos werden ergänzt, nicht ersetzt und nicht verdoppelt', () => {
    const plan = planFeldMerge({ feldFotos: [FOTO_A] }, {}, [FOTO_A, FOTO_B, FOTO_B]);
    expect(plan.neueFotos).toBe(1);
    expect(plan.patch.feldFotos.map(f => f.name)).toEqual(['foto_01.jpg', 'foto_02.jpg']);
  });

  it('Foto-Kategorien und Checkliste kommen mit, unbekannte Kategorien nicht', () => {
    const plan = planFeldMerge({}, { feldCheckliste: { profil: 'wohnen', erfuellt: 4, gesamt: 6, fehlend: ['Foto Typenschild', 'Baujahr Heizung'] } },
      [{ ...FOTO_A, kategorie: 'typenschild' }, { ...FOTO_B, kategorie: '<script>' }]);
    expect(plan.patch.feldFotos.map(f => f.kategorie)).toEqual(['typenschild', undefined]);
    expect(plan.patch.feldCheckliste).toEqual({ profil: 'wohnen', erfuellt: 4, gesamt: 6, fehlend: ['Foto Typenschild', 'Baujahr Heizung'] });
    expect(planFeldMerge({}, { feldCheckliste: { erfuellt: 9, gesamt: 6 } }).aenderungen).toBe(0);
  });

  it('neue Vor-Ort-Felder werden übernommen und gesichert', () => {
    const g = { id: 1, feldDaten: { heizung: 'Pelletkessel', leistungKw: '45', zaehlerstand: '12345.6', zaehlerDatum: '2026-09-22', fremd: 'x' } };
    const gesichert = captureFelddaten({ gebaeude: [g] });
    expect(gesichert.gebaeude['1'].feldDaten).toEqual({ heizung: 'Pelletkessel', leistungKw: '45', zaehlerstand: '12345.6', zaehlerDatum: '2026-09-22' });
  });

  it('die Vormerkung gehört dem Büro', () => {
    expect(planFeldMerge({ feldVorgemerkt: true }, { feldVorgemerkt: false }).aenderungen).toBe(0);
  });
});

describe('Stations-Steckbrief in den Felddaten', () => {
  const STB = { version: 1, werte: { leistungKVA: '800', ausfuehrung: 'Öl', 'böse<key>': 'x' }, zustand: 'mittel', notiz: 'Wanne fehlt', erfasstAm: '2026-09-23T08:00:00Z' };

  it('wird bereinigt, gesichert und wiederhergestellt', () => {
    const gesichert = captureFelddaten({ assets: [{ id: 't1', feldSteckbrief: { ...STB, zustand: 'kaputt' } }] });
    expect(gesichert.assets.t1.feldSteckbrief).toEqual({ version: 1, werte: { leistungKVA: '800', ausfuehrung: 'Öl' }, zustand: '', notiz: 'Wanne fehlt', erfasstAm: '2026-09-23T08:00:00Z' });
    const t1 = { id: 't1' };
    applyFelddaten(gesichert, { assets: [t1] });
    expect(t1.feldSteckbrief.werte.leistungKVA).toBe('800');
  });

  it('Mängel behalten nur bekannte Prioritäten, leere Steckbriefe fallen weg', () => {
    const w = pickFeldwerte({ feldSteckbrief: { werte: {}, maengel: [{ text: 'Tür klemmt', prio: 'egal' }, { text: '  ' }] } });
    expect(w.feldSteckbrief.maengel).toEqual([{ id: '', text: 'Tür klemmt', prio: 'hinweis', bezug: '', bezugName: '', erfasstAm: '' }]);
    expect(pickFeldwerte({ feldSteckbrief: { werte: { a: '' } } })).toBeNull();
  });

  it('der jüngere Erfassungsstand gilt', () => {
    const neu = planFeldMerge({}, { feldSteckbrief: STB });
    expect(neu.patch.feldSteckbrief.werte.leistungKVA).toBe('800');
    const aelter = planFeldMerge({ feldSteckbrief: { ...STB, erfasstAm: '2026-09-24T08:00:00Z' } }, { feldSteckbrief: { ...STB, notiz: 'alt' } });
    expect(aelter.patch.feldSteckbrief).toBeUndefined();
    expect(aelter.konflikte).toEqual(['Steckbrief: älterer Stand nicht übernommen']);
    expect(planFeldMerge({ feldSteckbrief: STB }, { feldSteckbrief: STB }).aenderungen).toBe(0);
  });

  it('Foto-Kategorien der Stationsakte kommen mit', () => {
    const plan = planFeldMerge({}, {}, [{ ...FOTO_A, kategorie: 'gesamt' }, { ...FOTO_B, kategorie: 'messgeraete' }]);
    expect(plan.patch.feldFotos.map(f => f.kategorie)).toEqual(['gesamt', 'messgeraete']);
  });
});
