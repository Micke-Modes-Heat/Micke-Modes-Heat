// Vitest-Tests für den Anlagenteil des Gutachtens: Dokumentmodell (lib/gutachten-dokument.js),
// Steckbrief-Blatt (lib/stations-steckbrief.js) und Word-Ausgabe (lib/steckbrief-docx.js).
import { describe, it, expect } from 'vitest';
import {
  gdNormalisieren, gdStandardDokument, gdMitStandardAbgleichen, gdRoemisch, gdAnlagenNummern,
  gdStationsAnlagenErgaenzen, gdAnlageLoeschen, gdAnlageVerschieben,
} from '../src/lib/gutachten-dokument.js';
import { ssStationModell, ssBestandsStationen, ssSteckbriefBlatt, ssSteckbriefTitel, ssSteckbriefHtml } from '../src/lib/stations-steckbrief.js';
import { ssdxAnlagenVerzeichnis, ssdxSteckbriefAnlage, ssdxBlattTabelle, ssdxSpalten } from '../src/lib/steckbrief-docx.js';

const gebaeude = [
  { id: 1, name: 'Übergabe', gebaeudenummer: '1' },
  { id: 2, name: 'Station Nord', gebaeudenummer: '2', baujahr: 1985,
    stationSteckbrief: { bauweise: 'begehbar', begehung: '2026-09-30', maengel: [{ feld: 'Zugangsregelung', text: 'Schlüssel fehlt\nVNB fragen' }] } },
  { id: 3, name: 'Neubau-Station', gebaeudenummer: '3', schicht: 'entwicklung' },
];
const A = (id, type, buildingId, props = {}, extra = {}) => ({ id, type, name: id, buildingId, props, ...extra });
const assets = [
  A('nap', 'NAP', 1, { spannungKV: 20 }), A('sa1', 'Schaltanlage', 1, { felder: 4 }),
  A('sa2', 'Schaltanlage', 2, { felder: 3, ausfuehrung: 'gasisoliert', isolation: 'sf6' }),
  A('t2a', 'Trafo', 2, { leistungKVA: 630, kuehlung: 'oel' }, { baujahr: 1990 }),
  A('t2neu', 'Trafo', 2, { leistungKVA: 1000 }, { schicht: 'entscheidung' }),
  A('ns2', 'NSHV', 2, { abgaenge: 8 }),
  A('t3', 'Trafo', 3, { leistungKVA: 400 }, { schicht: 'entwicklung' }),
];
const edges = [{ id: 'e1', u: 'nap', v: 'sa1' }, { id: 'r1', u: 'sa1', v: 'sa2' }, { id: 'i2', u: 'sa2', v: 't2a' }, { id: 'n2', u: 't2a', v: 'ns2' }];
const P = { assets, edges, gebaeude, heute: 2026 };

describe('Anlagen im Dokumentmodell', () => {
  it('römische Nummern', () => {
    expect([1, 4, 9, 12, 40].map(gdRoemisch)).toEqual(['I', 'IV', 'IX', 'XII', 'XL']);
    expect(gdAnlagenNummern([{}, {}, {}])).toEqual(['I', 'II', 'III']);
  });

  it('Normalisieren: unbekannte Typen, fehlendes Gebäude und doppelte Station fallen weg', () => {
    const dok = gdNormalisieren({ kapitel: [], anlagen: [
      { id: 'x1', typ: 'stationssteckbrief', gebaeudeId: 2 }, { typ: 'stationssteckbrief', gebaeudeId: '2' },
      { typ: 'quatsch', gebaeudeId: 5 }, { typ: 'stationssteckbrief' }, null,
    ] });
    expect(dok.anlagen).toEqual([{ id: 'x1', typ: 'stationssteckbrief', gebaeudeId: 2 }]);
    expect(gdNormalisieren({ kapitel: [] }).anlagen).toEqual([]);
  });

  it('Ergänzen hängt nur fehlende Stationen an, Verschieben und Löschen', () => {
    const { dok } = gdStandardDokument([]);
    expect(dok.anlagen).toEqual([]);
    expect(gdStationsAnlagenErgaenzen(dok, [1, 2]).length).toBe(2);
    expect(gdStationsAnlagenErgaenzen(dok, [2, 4]).map(a => a.gebaeudeId)).toEqual([4]);
    expect(dok.anlagen.map(a => a.gebaeudeId)).toEqual([1, 2, 4]);
    expect(gdAnlageVerschieben(dok, dok.anlagen[2].id, -1)).toBe(true);
    expect(dok.anlagen.map(a => a.gebaeudeId)).toEqual([1, 4, 2]);
    expect(gdAnlageVerschieben(dok, dok.anlagen[0].id, -1)).toBe(false);
    expect(gdAnlageLoeschen(dok, dok.anlagen[1].id)).toBe(true);
    expect(dok.anlagen.map(a => a.gebaeudeId)).toEqual([1, 2]);
  });

  it('Abgleich mit der Standardgliederung behält die Anlagen', () => {
    const { dok } = gdStandardDokument([]);
    gdStationsAnlagenErgaenzen(dok, [2]);
    expect(gdMitStandardAbgleichen(dok, []).dok.anlagen.map(a => a.gebaeudeId)).toEqual([2]);
  });
});

describe('Steckbrief-Blatt', () => {
  it('Bestandsstationen: geplante Station und geplanter Trafo zählen nicht', () => {
    expect(ssBestandsStationen(assets, gebaeude, 2026).map(g => g.id)).toEqual([1, 2]);
    const m = ssStationModell({ ...P, gebaeudeId: 2, nurBestand: true });
    expect(m.trafos.map(t => t.asset.id)).toEqual(['t2a']);
    expect(ssStationModell({ ...P, gebaeudeId: 2 }).trafos.length).toBe(2);
  });

  it('Zeilen nach der Vorlage mit Ankreuzfeldern, Feldliste, Mängeln und Begehungsdatum', () => {
    const m = ssStationModell({ ...P, gebaeudeId: 2, nurBestand: true });
    const blatt = ssSteckbriefBlatt(m, { liegenschaft: 'Musterkaserne', adresse: 'Weg 1, 12345 Ort', weNummer: '3407' });
    expect(ssSteckbriefTitel(blatt)).toBe('Steckbrief Trafostation Geb. 2 – Station Nord');
    expect(blatt.kopf.begehung).toBe('30.09.2026');
    const titel = blatt.zeilen.filter(z => z.art === 'titel').map(z => z.text);
    expect(titel).toEqual(['1. MS-Station (inkl. Gebäude)', '2. MS-Schaltanlage', '3. Transformatoren', '4. NSHV', 'weitere Betrachtung der Trafostation']);
    const alles = JSON.stringify(blatt.zeilen);
    expect(alles).toContain('☒ gasisoliert');
    expect(alles).toContain('☒ SF6');
    expect(alles).toContain('☒ Öl');
    expect(alles).toContain('☒ überschritten');      // 1990 + 30 a < 2026
    expect(alles).toContain('☒ begehbar');
    expect(alles).toContain('Feld 1 – Kabelfeld → Übergabe (Geb. 1)');
    expect(alles).toContain('Zugangsregelung');
    // jede Datenzeile füllt genau die fünf Spalten
    for (const z of blatt.zeilen.filter(x => x.art === 'zeile')) {
      expect(z.zellen.reduce((s, c) => s + (c.span || 1), 0)).toBe(5);
    }
    const html = ssSteckbriefHtml(blatt);
    expect(html).toContain('Datum der Begehung: 30.09.2026');
    expect(html).toContain('Schlüssel fehlt<br>VNB fragen');
  });

  it('Übergabestation: Titel und Zählung aus dem Messort', () => {
    const m = ssStationModell({ ...P, gebaeudeId: 1, messort: 'ns', nurBestand: true });
    const blatt = ssSteckbriefBlatt(m);
    expect(ssSteckbriefTitel(blatt)).toBe('Steckbrief Übergabestation Geb. 1 – Übergabe');
    expect(JSON.stringify(blatt.zeilen)).toContain('☒ NS-seitig');
  });
});

describe('Word-Ausgabe der Anlagen', () => {
  const wohlgeformt = xml => {
    const doc = `<w:root xmlns:w="w" xmlns:r="r">${xml}</w:root>`;
    // einfache Klammerprüfung: jedes geöffnete Element wird geschlossen
    const stapel = [];
    for (const m of doc.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) { if (stapel.pop() !== m[2]) return false; } else stapel.push(m[2]);
    }
    return stapel.length === 0;
  };
  const m = ssStationModell({ ...P, gebaeudeId: 2, nurBestand: true });
  const blatt = ssSteckbriefBlatt(m, { liegenschaft: 'Musterkaserne & Co' });

  it('Spalten füllen den Satzspiegel', () => {
    expect(ssdxSpalten().reduce((s, b) => s + b, 0)).toBe(10206);
  });

  it('Anlagenverzeichnis und Anlage sind wohlgeformt und escaped', () => {
    const verz = ssdxAnlagenVerzeichnis([{ nr: 'I', titel: 'Steckbrief <A>' }]);
    expect(verz).toContain('Anlage I');
    expect(verz).toContain('Steckbrief &lt;A&gt;');
    expect(wohlgeformt(verz)).toBe(true);
    expect(ssdxAnlagenVerzeichnis([])).toBe('');
    const anl = ssdxSteckbriefAnlage('II', ssSteckbriefTitel(blatt), blatt);
    expect(anl).toContain('Anlage II');
    expect(anl).toContain('<w:caps/>');
    expect(anl).toContain('Musterkaserne &amp; Co');
    expect(anl).toContain('Datum der Begehung: 30.09.2026');
    expect(wohlgeformt(anl)).toBe(true);
  });

  it('gridSpan je Zeile ergibt fünf Spalten', () => {
    const xml = ssdxBlattTabelle(blatt);
    for (const tr of xml.match(/<w:tr>.*?<\/w:tr>/gs)) {
      const spans = [...tr.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(t => +(t[1].match(/<w:gridSpan w:val="(\d+)"/)?.[1] || 1));
      expect(spans.reduce((s, x) => s + x, 0)).toBe(5);
    }
  });
});
