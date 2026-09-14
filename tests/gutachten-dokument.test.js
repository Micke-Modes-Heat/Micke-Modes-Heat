// Vitest-Tests für lib/gutachten-dokument.js — Gliederung, Nummerierung und Blöcke des Gutachten-Editors.
import { describe, it, expect } from 'vitest';
import {
  GUTACHTEN_STANDARD_GLIEDERUNG, gdNormalisieren, gdKapitelNummern, gdStandardDokument,
  gdKapitelEinfuegen, gdKapitelLoeschen, gdKapitelVerschieben, gdKapitelEbene,
  gdNeuerTextBlock, gdNeuerFigurBlock, gdBlockEinfuegen, gdBlockVerschieben, gdBlockLoeschen,
  gdBeschriftungen, gdFindeBlock, gdFigurIds, gdNormDeckblatt,
} from '../src/lib/gutachten-dokument.js';

/** Kleines Dokument aus [ebene, titel]-Paaren. */
function dokAus(paare) {
  return gdNormalisieren({ kapitel: paare.map(([ebene, titel], i) => ({ id: 'k' + i, ebene, titel, bloecke: [] })) });
}
const titel = dok => dok.kapitel.map(k => k.titel);
const ebenen = dok => dok.kapitel.map(k => k.ebene);

describe('Nummerierung', () => {
  it('zählt je Ebene fortlaufend und setzt tiefere Ebenen zurück', () => {
    const dok = dokAus([[1, 'A'], [2, 'A1'], [3, 'A1a'], [2, 'A2'], [1, 'B'], [2, 'B1']]);
    expect(gdKapitelNummern(dok.kapitel)).toEqual(['1', '1.1', '1.1.1', '1.2', '2', '2.1']);
  });

  it('Standardgliederung trifft die Kapitelnummern der Gutachten-Grafiken', () => {
    const { dok } = gdStandardDokument();
    const nr = gdKapitelNummern(dok.kapitel);
    const bei = n => dok.kapitel[nr.indexOf(n)]?.titel;
    expect(bei('1.2')).toBe('Liegenschaftsinformationen');
    expect(bei('3.1.5')).toBe('Stromdaten');
    expect(bei('3.2.2')).toBe('Liegenschaftsstromnetzanschluss');
    expect(bei('3.2.3')).toBe('Stromnetz intern');
    expect(bei('3.2.5')).toBe('PV-Anlage und Batteriespeicher');
    expect(bei('3.2.6')).toBe('Wirtschaftlichkeit und Investitionskosten');
    expect(bei('5.2')).toBe('Bewertung Resilienz');
    expect(bei('2.3')).toBe('Analyse möglicher Energiequellen und Technologien');
    expect(bei('6.2')).toBe('Elektrotechnik');
    expect(dok.kapitel).toHaveLength(GUTACHTEN_STANDARD_GLIEDERUNG.length);
    expect(dok.kapitel.every(k => k.titel)).toBe(true);
  });
});

describe('Deckblatt', () => {
  it('liefert immer alle Felder und genau drei Ansprechpersonen', () => {
    const d = gdNormDeckblatt({ liegenschaft: 'Kaserne', ort: 42, ansprechpersonen: [{ name: 'A', telefon: 1 }, 'x'] });
    expect(d.liegenschaft).toBe('Kaserne');
    expect(d.ort).toBe('');
    expect(d.ansprechpersonen).toEqual([{ name: 'A', telefon: '' }, { name: '', telefon: '' }, { name: '', telefon: '' }]);
  });

  it('bleibt beim Normalisieren eines gespeicherten Dokuments erhalten', () => {
    const dok = gdNormalisieren({ kapitel: [], deckblatt: { stand: '14.09.2026' } });
    expect(dok.deckblatt.stand).toBe('14.09.2026');
    expect(gdNormalisieren({ kapitel: [] }).deckblatt.stand).toBe('');
  });
});

describe('Normalisieren', () => {
  it('liefert null ohne Kapitelliste', () => {
    expect(gdNormalisieren(null)).toBeNull();
    expect(gdNormalisieren({})).toBeNull();
  });

  it('glättet Ebenensprünge, verwirft kaputte Blöcke und vergibt doppelte IDs neu', () => {
    const dok = gdNormalisieren({ kapitel: [
      { id: 'x', ebene: 3, titel: 'erst', bloecke: [{ id: 'b1', typ: 'text', text: 'Hallo' }, { typ: 'unbekannt' }, 'Müll'] },
      { id: 'x', ebene: 3, titel: 'zweit', bloecke: [{ id: 'b1', typ: 'figur', figurId: 'lastgang-strom', layout: 'voll', kennzahlen: false }] },
      { id: 'y', ebene: 9, titel: 42, bloecke: [{ typ: 'figur' }] },
    ] });
    expect(ebenen(dok)).toEqual([1, 2, 3]);
    expect(dok.kapitel[0].bloecke).toEqual([{ id: 'b1', typ: 'text', text: 'Hallo' }]);
    expect(dok.kapitel[1].id).not.toBe('x');
    expect(dok.kapitel[1].bloecke[0]).toMatchObject({ typ: 'figur', figurId: 'lastgang-strom', layout: 'voll', kennzahlen: false, unterschrift: '' });
    expect(dok.kapitel[1].bloecke[0].id).not.toBe('b1');
    expect(dok.kapitel[2].titel).toBe('42');
    expect(dok.kapitel[2].bloecke).toEqual([]);
  });

  it('verändert die Eingabe nicht', () => {
    const roh = { kapitel: [{ id: 'a', ebene: 2, titel: 'T', bloecke: [] }] };
    gdNormalisieren(roh);
    expect(roh.kapitel[0].ebene).toBe(2);
  });
});

describe('Standarddokument', () => {
  it('ordnet Figuren nach Kapitelnummer zu, Textbausteine zuerst', () => {
    const { dok, nichtZugeordnet } = gdStandardDokument([
      { id: 'anschluss', kapitel: '3.2.2 Liegenschaftsstromnetzanschluss' },
      { id: 'na-text', kapitel: '3.2.2 Liegenschaftsstromnetzanschluss', istText: true },
      { id: 'lastgang', kapitel: '3.1.5 Stromdaten' },
      { id: 'ohne', kapitel: '' },
      { id: 'falsch', kapitel: '9.9 Gibt es nicht' },
    ]);
    const nr = gdKapitelNummern(dok.kapitel);
    expect(dok.kapitel[nr.indexOf('3.2.2')].bloecke.map(b => b.figurId)).toEqual(['na-text', 'anschluss']);
    expect(dok.kapitel[nr.indexOf('3.1.5')].bloecke.map(b => b.figurId)).toEqual(['lastgang']);
    expect(nichtZugeordnet).toEqual(['ohne', 'falsch']);
  });
});

describe('Kapitel bearbeiten', () => {
  it('fügt Geschwister hinter dem ganzen Teilbaum und Unterkapitel als letztes Kind ein', () => {
    const dok = dokAus([[1, 'A'], [2, 'A1'], [1, 'B']]);
    gdKapitelEinfuegen(dok, 'k0', { titel: 'neu' });
    expect(titel(dok)).toEqual(['A', 'A1', 'neu', 'B']);
    expect(ebenen(dok)).toEqual([1, 2, 1, 1]);
    gdKapitelEinfuegen(dok, 'k0', { unter: true, titel: 'A2' });
    expect(titel(dok)).toEqual(['A', 'A1', 'A2', 'neu', 'B']);
    expect(ebenen(dok)).toEqual([1, 2, 2, 1, 1]);
    gdKapitelEinfuegen(dok, null, { titel: 'Ende' });
    expect(titel(dok).at(-1)).toBe('Ende');
  });

  it('verschiebt Kapitel mitsamt Unterkapiteln nur zwischen Geschwistern', () => {
    const dok = dokAus([[1, 'A'], [2, 'A1'], [2, 'A2'], [1, 'B'], [2, 'B1']]);
    expect(gdKapitelVerschieben(dok, 'k3', -1)).toBe(true);
    expect(titel(dok)).toEqual(['B', 'B1', 'A', 'A1', 'A2']);
    expect(gdKapitelVerschieben(dok, 'k3', 1)).toBe(true);
    expect(titel(dok)).toEqual(['A', 'A1', 'A2', 'B', 'B1']);
    expect(gdKapitelVerschieben(dok, 'k2', -1)).toBe(true);
    expect(titel(dok)).toEqual(['A', 'A2', 'A1', 'B', 'B1']);
    // A1 ist jetzt letztes Kind von A — nach unten ginge es nur über die Kapitelgrenze
    expect(gdKapitelVerschieben(dok, 'k1', 1)).toBe(false);
    expect(gdKapitelVerschieben(dok, 'k0', -1)).toBe(false);
  });

  it('ändert Ebenen nur, wenn die Gliederung gültig bleibt', () => {
    const dok = dokAus([[1, 'A'], [1, 'B'], [2, 'B1']]);
    expect(gdKapitelEbene(dok, 'k0', 1)).toBe(false);          // erstes Kapitel
    expect(gdKapitelEbene(dok, 'k2', 1)).toBe(false);          // Vorgänger ist schon sein Elternkapitel
    expect(gdKapitelEbene(dok, 'k1', 1)).toBe(true);           // B samt Teilbaum unter A
    expect(ebenen(dok)).toEqual([1, 2, 3]);
    expect(gdKapitelEbene(dok, 'k1', -1)).toBe(true);
    expect(ebenen(dok)).toEqual([1, 1, 2]);
    expect(gdKapitelEbene(dok, 'k0', -1)).toBe(false);

    // Teilbaum würde über Ebene 3 hinauswachsen
    const tief = dokAus([[1, 'A'], [1, 'B'], [2, 'B1'], [3, 'B1a']]);
    expect(gdKapitelEbene(tief, 'k1', 1)).toBe(false);
    expect(ebenen(tief)).toEqual([1, 1, 2, 3]);
  });

  it('zieht beim Löschen die Unterkapitel eine Ebene hoch', () => {
    const dok = dokAus([[1, 'A'], [1, 'B'], [2, 'B1'], [3, 'B1a'], [1, 'C']]);
    expect(gdKapitelLoeschen(dok, 'k1')).toBe(true);
    expect(titel(dok)).toEqual(['A', 'B1', 'B1a', 'C']);
    expect(ebenen(dok)).toEqual([1, 1, 2, 1]);
  });
});

describe('Blöcke', () => {
  it('verschiebt über Kapitelgrenzen und bleibt an den Dokumenträndern stehen', () => {
    const dok = dokAus([[1, 'A'], [1, 'B']]);
    const t1 = gdNeuerTextBlock('eins'), t2 = gdNeuerTextBlock('zwei'), f = gdNeuerFigurBlock('fig');
    gdBlockEinfuegen(dok, 'k0', t1);
    gdBlockEinfuegen(dok, 'k0', t2);
    gdBlockEinfuegen(dok, 'k0', f, t1.id);
    expect(dok.kapitel[0].bloecke.map(b => b.id)).toEqual([t1.id, f.id, t2.id]);

    expect(gdBlockVerschieben(dok, t2.id, 1)).toBe(true);
    expect(dok.kapitel[1].bloecke.map(b => b.id)).toEqual([t2.id]);
    expect(gdBlockVerschieben(dok, t2.id, 1)).toBe(false);
    expect(gdBlockVerschieben(dok, t2.id, -1)).toBe(true);
    expect(dok.kapitel[0].bloecke.at(-1).id).toBe(t2.id);
    expect(gdBlockVerschieben(dok, t1.id, -1)).toBe(false);
    expect(gdFindeBlock(dok, t1.id)).toEqual({ kapIdx: 0, blockIdx: 0 });

    expect(gdBlockLoeschen(dok, f.id)).toBe(true);
    expect(gdFindeBlock(dok, f.id)).toBeNull();
    expect(gdFigurIds(dok).size).toBe(0);
  });

  it('nummeriert Abbildungen und Tabellen getrennt und dokumentweit', () => {
    const dok = dokAus([[1, 'A'], [1, 'B']]);
    const a = gdNeuerFigurBlock('blatt'), t = gdNeuerTextBlock('x'), b = gdNeuerFigurBlock('tabelle'), c = gdNeuerFigurBlock('text');
    gdBlockEinfuegen(dok, 'k0', a);
    gdBlockEinfuegen(dok, 'k0', t);
    gdBlockEinfuegen(dok, 'k1', b);
    gdBlockEinfuegen(dok, 'k1', c);
    const arten = { blatt: ['Abbildung', 'Tabelle'], tabelle: ['Tabelle'], text: [null] };
    const m = gdBeschriftungen(dok, blk => arten[blk.figurId]);
    expect(m.get(a.id)).toEqual([{ art: 'Abbildung', nr: 1 }, { art: 'Tabelle', nr: 1 }]);
    expect(m.get(t.id)).toEqual([]);
    expect(m.get(b.id)).toEqual([{ art: 'Tabelle', nr: 2 }]);
    expect(m.get(c.id)).toEqual([null]);
  });
});
