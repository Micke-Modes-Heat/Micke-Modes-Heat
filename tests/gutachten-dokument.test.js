// Vitest-Tests für lib/gutachten-dokument.js — Gliederung, Nummerierung und Blöcke des Gutachten-Editors.
import { describe, it, expect } from 'vitest';
import {
  GUTACHTEN_STANDARD_GLIEDERUNG, gdNormalisieren, gdKapitelNummern, gdStandardDokument,
  gdKapitelEinfuegen, gdKapitelLoeschen, gdKapitelVerschieben, gdKapitelEbene,
  gdNeuerTextBlock, gdNeuerFigurBlock, gdBlockEinfuegen, gdBlockVerschieben, gdBlockLoeschen,
  gdBeschriftungen, gdFindeBlock, gdFigurIds, gdNormDeckblatt, gdMitStandardAbgleichen,
  GUTACHTEN_GLIEDERUNG_V1, gdNummerV1ZuV2, gdGliederungVersion, gdGliederungUmstellen,
} from '../src/lib/gutachten-dokument.js';

/** Kleines Dokument aus [ebene, titel]-Paaren. */
function dokAus(paare) {
  return gdNormalisieren({ kapitel: paare.map(([ebene, titel], i) => ({ id: 'k' + i, ebene, titel, bloecke: [] })) });
}
const titel = dok => dok.kapitel.map(k => k.titel);
const ebenen = dok => dok.kapitel.map(k => k.ebene);

describe('Abgleich mit der Standardgliederung', () => {
  const std = paare => paare.map(([ebene, titel]) => ({ ebene, titel }));

  it('meldet bei einem aktuellen Standarddokument nichts', () => {
    const katalog = [
      { id: 'f-text', kapitel: '5.3.1 Bestandsbedarf und bauliche Entwicklung', istText: true, reihe: 5 },
      { id: 'f-abb', kapitel: '5.3.1 Bestandsbedarf und bauliche Entwicklung', reihe: 10 },
    ];
    const { dok } = gdStandardDokument(katalog);
    const r = gdMitStandardAbgleichen(dok, katalog);
    expect(r.neueKapitel).toEqual([]);
    expect(r.neueBloecke).toEqual([]);
    expect(r.fremdeKapitel).toEqual([]);
    expect(titel(r.dok)).toEqual(titel(dok));
  });

  it('ergänzt fehlende Kapitel und Bausteine, ohne Vorhandenes anzufassen', () => {
    const vorlage = std([[1, 'A'], [2, 'A1'], [2, 'A2'], [1, 'B'], [2, 'B1']]);
    const alt = dokAus([[1, 'A'], [2, ' a1 '], [2, 'Eigenes Kapitel'], [1, 'B']]);
    alt.kapitel[1].bloecke.push(gdNeuerTextBlock('Mein Text'));
    const vorher = JSON.stringify(alt);
    const katalog = [
      { id: 'fa2', kapitel: '1.2 A2' }, { id: 'fb1', kapitel: '2.1 B1' },
      { id: 'fx', kapitel: '9.9 Gibt es nicht' }, { id: 'ohne' },
    ];

    const r = gdMitStandardAbgleichen(alt, katalog, vorlage);
    expect(titel(r.dok)).toEqual(['A', ' a1 ', 'A2', 'Eigenes Kapitel', 'B', 'B1']);
    expect(ebenen(r.dok)).toEqual([1, 2, 2, 2, 1, 2]);
    expect(r.neueKapitel.map(k => `${k.nr} ${k.titel}`)).toEqual(['1.2 A2', '2.1 B1']);
    expect(r.fremdeKapitel.map(k => `${k.nr} ${k.titel}`)).toEqual(['1.3 Eigenes Kapitel']);
    expect(r.neueBloecke.map(b => `${b.nr}:${b.figurId}`)).toEqual(['1.2:fa2', '2.1:fb1']);
    expect(r.nichtZugeordnet).toEqual(['fx', 'ohne']);
    expect(r.dok.kapitel[1].bloecke.map(b => b.text)).toEqual(['Mein Text']);
    expect(r.dok.kapitel.map(k => k.id).slice(0, 2)).toEqual(['k0', 'k1']);
    expect(JSON.stringify(alt)).toBe(vorher);
  });

  it('ordnet Szenario-Kapitel unabhängig von ihrer Nummer zu und zieht nur die Nummer nach', () => {
    const vorlage = std([[1, 'R'], [2, 'Szenario 1: Gebäude'], [2, 'Szenario 2: Station'], [2, 'Szenario 3: Liegenschaft']]);
    const alt = dokAus([[1, 'R'], [2, 'Szenario 1: Gebäude'], [2, 'Szenario 2: Liegenschaft (Entwurf)']]);
    alt.kapitel[2].bloecke.push(gdNeuerTextBlock('Insel'));
    const vorher = JSON.stringify(alt);
    const r = gdMitStandardAbgleichen(alt, [], vorlage);
    expect(titel(r.dok)).toEqual(['R', 'Szenario 1: Gebäude', 'Szenario 2: Station', 'Szenario 3: Liegenschaft (Entwurf)']);
    expect(r.neueKapitel.map(k => `${k.nr} ${k.titel}`)).toEqual(['1.2 Szenario 2: Station']);
    expect(r.umbenannt).toEqual([{ id: 'k2', nr: '1.3', von: 'Szenario 2: Liegenschaft (Entwurf)', nach: 'Szenario 3: Liegenschaft (Entwurf)' }]);
    expect(r.dok.kapitel[3].bloecke.map(b => b.text)).toEqual(['Insel']);
    expect(JSON.stringify(alt)).toBe(vorher);
  });

  it('ordnet gleichnamige Kapitel nur unter demselben Oberkapitel zu', () => {
    const vorlage = std([[1, 'Wärme'], [2, 'Wirtschaftlichkeit'], [1, 'Strom'], [2, 'Wirtschaftlichkeit']]);
    const alt = dokAus([[1, 'Wärme'], [2, 'Wirtschaftlichkeit'], [1, 'Strom']]);
    const r = gdMitStandardAbgleichen(alt, [], vorlage);
    expect(r.neueKapitel.map(k => k.nr)).toEqual(['2.1']);
    expect(titel(r.dok)).toEqual(['Wärme', 'Wirtschaftlichkeit', 'Strom', 'Wirtschaftlichkeit']);
  });

  it('legt fehlende Oberkapitel samt Unterkapiteln an und listet alte Zweige einmal', () => {
    const vorlage = std([[1, 'Strom'], [2, 'Varianten'], [3, 'PV']]);
    const alt = dokAus([[1, 'Strom'], [2, 'Soll-Zustand'], [3, 'PV']]);
    const r = gdMitStandardAbgleichen(alt, [], vorlage);
    expect(titel(r.dok)).toEqual(['Strom', 'Varianten', 'PV', 'Soll-Zustand', 'PV']);
    expect(r.neueKapitel.map(k => `${k.nr} ${k.titel}`)).toEqual(['1.1 Varianten', '1.1.1 PV']);
    expect(r.fremdeKapitel.map(k => `${k.nr} ${k.titel}`)).toEqual(['1.2 Soll-Zustand']);
  });

  it('setzt neue Bausteine nach ihrer Reihe zwischen vorhandene Abbildungen', () => {
    const vorlage = std([[1, 'A']]);
    const alt = dokAus([[1, 'A']]);
    alt.kapitel[0].bloecke.push(gdNeuerFigurBlock('f10'), gdNeuerFigurBlock('f30'));
    const katalog = [
      { id: 'f10', kapitel: '1 A', reihe: 10 }, { id: 'f20', kapitel: '1 A', reihe: 20 },
      { id: 'f30', kapitel: '1 A', reihe: 30 }, { id: 'f5', kapitel: '1 A', istText: true, reihe: 5 },
    ];
    const r = gdMitStandardAbgleichen(alt, katalog, vorlage);
    expect(r.dok.kapitel[0].bloecke.map(b => b.figurId)).toEqual(['f5', 'f10', 'f20', 'f30']);
  });

  it('baut ohne Dokument die ganze Gliederung auf', () => {
    const r = gdMitStandardAbgleichen(null, [], std([[1, 'A'], [2, 'A1']]));
    expect(titel(r.dok)).toEqual(['A', 'A1']);
    expect(r.neueKapitel).toHaveLength(2);
  });
});

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
    expect(bei('5.1.1')).toBe('Liegenschaftsstromnetzanschluss');
    expect(bei('3.1.1')).toBe('Erdgasanschluss');
    expect(bei('5.1.2')).toBe('Stromnetz intern (MS/NS)');
    expect(bei('5.2')).toBe('Stromverbrauchsdaten');
    expect(bei('5.4.2')).toBe('PV-Anlage und Batteriespeicher');
    expect(bei('5.5')).toBe('Wirtschaftlichkeit und Investitionskosten');
    expect(bei('6')).toBe('Gebäudeautomation (GA)');
    expect(bei('7.2.1')).toBe('Wirtschaftlichkeit mit PV-Eigenstrom');
    expect(bei('8.2')).toBe('Bewertung Resilienz');
    expect(bei('4')).toBe('Potenzialanalyse');
    expect(bei('2.1')).toBe('Baulicher Ist-Zustand');
    expect(bei('9.2')).toBe('Elektrotechnik');
    expect(dok.gliederung).toBe(2);
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
      { id: 'anschluss', kapitel: '5.1.1 Liegenschaftsstromnetzanschluss' },
      { id: 'na-text', kapitel: '5.1.1 Liegenschaftsstromnetzanschluss', istText: true },
      { id: 'lastgang', kapitel: '5.2 Stromverbrauchsdaten' },
      { id: 'ohne', kapitel: '' },
      { id: 'falsch', kapitel: '9.9 Gibt es nicht' },
    ]);
    const nr = gdKapitelNummern(dok.kapitel);
    expect(dok.kapitel[nr.indexOf('5.1.1')].bloecke.map(b => b.figurId)).toEqual(['na-text', 'anschluss']);
    expect(dok.kapitel[nr.indexOf('5.2')].bloecke.map(b => b.figurId)).toEqual(['lastgang']);
    expect(nichtZugeordnet).toEqual(['ohne', 'falsch']);
  });

  it('wechselt Texte und Abbildungen nach `reihe` ab', () => {
    const kap = '5.4.2 PV-Anlage und Batteriespeicher';
    const { dok } = gdStandardDokument([
      { id: 'tabelle', kapitel: kap, reihe: 40 },
      { id: 'text-b', kapitel: kap, istText: true, reihe: 30 },
      { id: 'ohne-reihe', kapitel: kap },
      { id: 'herleitung', kapitel: kap, reihe: 20 },
      { id: 'text-a', kapitel: kap, istText: true, reihe: 10 },
    ]);
    const nr = gdKapitelNummern(dok.kapitel);
    expect(dok.kapitel[nr.indexOf('5.4.2')].bloecke.map(b => b.figurId))
      .toEqual(['text-a', 'herleitung', 'text-b', 'tabelle', 'ohne-reihe']);
  });

  it('ordnet beim Abgleich Kapitel trotz abweichendem Klammerzusatz zu', () => {
    const standard = [{ ebene: 1, titel: 'Elektrotechnik' }, { ebene: 2, titel: 'Bedarfsprognose' },
                      { ebene: 3, titel: 'Zusatzbedarf aus Wärmekonzept' }];
    const alt = { kapitel: [
      { id: 'e', ebene: 1, titel: 'Elektrotechnik', bloecke: [] },
      { id: 'b', ebene: 2, titel: 'Bedarfsprognose (Soll)', bloecke: [] },
      { id: 'w', ebene: 3, titel: 'Zusatzbedarf aus Wärmekonzept (Übernahme aus 3.8)', bloecke: [] },
    ] };
    const r = gdMitStandardAbgleichen(alt, [], standard);
    expect(r.neueKapitel).toHaveLength(0);
    expect(r.dok.kapitel.map(k => k.titel)).toEqual(['Elektrotechnik', 'Bedarfsprognose (Soll)', 'Zusatzbedarf aus Wärmekonzept (Übernahme aus 3.8)']);
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

describe('Gliederung Version 2 (Variante B)', () => {
  /** Dokument nach der alten Standardgliederung, Kapitel-IDs = alte Nummer. */
  const altDok = () => {
    const nr = gdKapitelNummern(GUTACHTEN_GLIEDERUNG_V1);
    return gdNormalisieren({ kapitel: GUTACHTEN_GLIEDERUNG_V1.map((k, i) => ({ id: 'v' + nr[i].replace(/\./g, '_'), ebene: k.ebene, titel: k.titel, bloecke: [] })) });
  };
  const kapNr = (dok, nr) => dok.kapitel[gdKapitelNummern(dok.kapitel).indexOf(nr)];

  it('übersetzt Kapitelnummern der alten Gliederung', () => {
    expect(['1.1', '1.3', '1.3.1', '1.3.3', '2.1.7', '2.2.1', '2.3.1', '2.4', '2.6', '3.4.1', '4', '5.2.4', '6.1', '9.9'].map(gdNummerV1ZuV2))
      .toEqual(['1.1', '2', '2.1', '2.2.2', '3.2.4', '3.2.5', '4.2', '7', '7.4', '5.4.1', '6', '8.2.4', '9.1', '9.9']);
  });

  it('jedes alte Standardkapitel hat ein Gegenstück; Elektro, GA, Resilienz und Fazit behalten ihre Titel', () => {
    const n1 = gdKapitelNummern(GUTACHTEN_GLIEDERUNG_V1), n2 = gdKapitelNummern(GUTACHTEN_STANDARD_GLIEDERUNG);
    GUTACHTEN_GLIEDERUNG_V1.forEach((k, i) => {
      const z = n2.indexOf(gdNummerV1ZuV2(n1[i]));
      expect(z).toBeGreaterThanOrEqual(0);
      if (/^[3-6]/.test(n1[i])) expect(GUTACHTEN_STANDARD_GLIEDERUNG[z].titel).toBe(k.titel);
    });
  });

  it('erkennt alte Dokumente; neue und leere gelten als aktuell', () => {
    expect(gdGliederungVersion(altDok())).toBe(1);
    expect(gdGliederungVersion(gdStandardDokument().dok)).toBe(2);
    expect(gdGliederungVersion(dokAus([[1, 'A'], [1, 'B']]))).toBe(2);
    expect(gdNormalisieren({ kapitel: [], gliederung: 2 }).gliederung).toBe(2);
  });

  it('stellt um, ohne Inhalte zu verlieren', () => {
    const alt = altDok();
    const k = nr => kapNr(alt, nr);
    k('1.3.1').bloecke.push({ id: 'b1', typ: 'text', text: 'Freitext Hochbau' }, gdNeuerFigurBlock('gebaeude-uebersicht'));
    k('2.4').bloecke.push({ id: 'b2', typ: 'text', text: 'Freitext Varianten' }, gdNeuerFigurBlock('va-klima-text'), gdNeuerFigurBlock('va-gegenueberstellung'));
    k('2.3').bloecke.push(gdNeuerFigurBlock('potenzial-nicht-wind'));
    k('3.4.2').bloecke.push({ id: 'b3', typ: 'text', text: 'PV-Text' });
    // eigenes Kapitel unter 2.4 mit Unterkapitel
    const pos = alt.kapitel.indexOf(k('2.4')) + 1;
    alt.kapitel.splice(pos, 0, { id: 'e1', ebene: 2, titel: 'Eigene Variante', bloecke: [{ id: 'b4', typ: 'text', text: 'eigen' }] },
      { id: 'e2', ebene: 3, titel: 'Eigene Variante B', bloecke: [] });
    alt.kapitel[0].bloecke.push({ id: 'b5', typ: 'text', text: 'Einleitung' });
    const katalog = [
      { id: 'gebaeude-uebersicht', kapitel: '2.1 Baulicher Ist-Zustand' }, { id: 'va-klima-text', kapitel: '7.1 Klimarelevanz' },
      { id: 'va-gegenueberstellung', kapitel: '7 Variantenvergleich Wärme' }, { id: 'potenzial-nicht-wind', kapitel: '4.1 Nicht berücksichtigte Potenziale' },
    ];
    const r = gdGliederungUmstellen(alt, katalog);
    const d = r.dok;
    expect(d.gliederung).toBe(2);
    expect(gdGliederungVersion(d)).toBe(2);
    const bl = nr => kapNr(d, nr).bloecke.map(b => b.text || b.figurId);
    expect(bl('2.1')).toEqual(['Freitext Hochbau', 'gebaeude-uebersicht']);
    expect(bl('7')).toEqual(['Freitext Varianten', 'va-gegenueberstellung']);
    expect(bl('7.1')).toEqual(['va-klima-text']);
    expect(bl('4.1')).toEqual(['potenzial-nicht-wind']);
    expect(bl('5.4.2')).toEqual(['PV-Text']);
    expect(bl('1')).toEqual(['Einleitung']);
    expect(kapNr(d, '2.1').id).toBe('v1_3_1');   // Kapitel-ID bleibt erhalten
    // eigene Kapitel stehen hinter dem Teilbaum von 7 (vor 8), Inhalte und Ebenenabstand bleiben
    const titel = d.kapitel.map(x => x.titel);
    const iE = titel.indexOf('Eigene Variante');
    expect(iE).toBeGreaterThan(titel.indexOf('Empfehlung', titel.indexOf('Variantenvergleich Wärme')));
    expect(titel[iE + 1]).toBe('Eigene Variante B');
    expect(d.kapitel[iE + 1].ebene).toBe(d.kapitel[iE].ebene + 1);
    expect(titel[iE + 2]).toBe('Maßnahmen zur Steigerung der Resilienz');
    expect(d.kapitel[iE].bloecke[0].text).toBe('eigen');
    expect(r.eigene).toEqual(['Eigene Variante', 'Eigene Variante B']);
    const zaehle = x => x.kapitel.reduce((a, kk) => a + kk.bloecke.length, 0);
    expect(zaehle(d)).toBe(zaehle(alt));
    expect(d.kapitel.length).toBe(GUTACHTEN_STANDARD_GLIEDERUNG.length + 2);
  });
});

describe('Automatische Querverweise', () => {
  it('folgen verschobenen Kapiteln, unbekannte Nummern bleiben', async () => {
    const { gdVerweisNummern, gdVerweiseErsetzen } = await import('../src/lib/gutachten-dokument.js');
    const { dok } = gdStandardDokument();
    expect(gdVerweisNummern(dok).get('3.2')).toBe('3.2');
    // Kapitel 2 (Ist-Zustand Wärme) hinter Kapitel 3 verschieben → 3 wird 2
    const nr = gdKapitelNummern(dok.kapitel);
    const i2 = nr.indexOf('2'), i3 = nr.indexOf('3'), i4 = nr.indexOf('4');
    const k = dok.kapitel;
    const neu = { ...dok, kapitel: [...k.slice(0, i2), ...k.slice(i3, i4), ...k.slice(i2, i3), ...k.slice(i4)] };
    const m = gdVerweisNummern(neu);
    expect(m.get('3.2')).toBe('2.2');
    expect(m.get('2.2.1')).toBe('3.2.1');
    expect(gdVerweiseErsetzen('vgl. Kapitel 3.2 und Kapiteln 2.2.1 bis 2.2.2; Kapitel 6.1 der PV-Analyse; 3.2 kW', m))
      .toBe('vgl. Kapitel 2.2 und Kapiteln 3.2.1 bis 3.2.2; Kapitel 6.1 der PV-Analyse; 3.2 kW');
  });
});
