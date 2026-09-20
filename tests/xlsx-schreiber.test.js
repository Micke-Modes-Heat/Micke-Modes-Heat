// Vitest-Tests für lib/xlsx-schreiber.js und lib/xlsx-leser.js.
// Die Abnahme „öffnet in Excel ohne Reparaturmeldung" lässt sich hier nicht
// fahren; geprüft wird stattdessen, dass jede Datei wohlgeformtes XML ist, die
// Schema-Reihenfolge im Arbeitsblatt stimmt und der Round-Trip trägt.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  xlsxDateien, xmlEsc, spalteZuBuchstabe, zellBezug, blattName, XS,
} from '../src/lib/xlsx-schreiber.js';
import {
  xlsxAusBlob, buchstabeZuSpalte, leseSharedStrings, leseBlatt, xmlUnesc,
} from '../src/lib/xlsx-leser.js';

const beispiel = () => ({
  titel: 'Test', autor: 'Micke-Heat',
  namen: { L_JaNein: 'Listen!$A$2:$A$4' },
  blaetter: [
    {
      name: 'Daten',
      zeilen: [
        [{ w: 'Überschrift & <Zeichen>', s: XS.titel }],
        [],
        ['ID', 'Wert', 'Auswahl'].map(t => ({ w: t, s: XS.kopf })),
        [{ w: 'F01', s: XS.text }, { w: 12.5, s: XS.eingabeZahl }, { w: 'ja', s: XS.eingabe }],
      ],
      spalten: [{ breite: 8 }, { breite: 12 }, { breite: 12, verborgen: true }],
      fixZeilen: 3,
      verbunden: ['A1:C1'],
      pruefungen: [{ bereich: 'C4:C40', liste: 'L_JaNein', titel: 'Auswahl', hinweis: 'ja/nein' }],
    },
    { name: 'Listen', versteckt: true, zeilen: [['L_JaNein'], ['ja'], ['nein'], ['unbekannt']] },
  ],
});

describe('Hilfsfunktionen', () => {
  it('rechnet Spaltenindizes in beide Richtungen', () => {
    for (const i of [0, 1, 25, 26, 51, 52, 701, 702]) {
      expect(buchstabeZuSpalte(spalteZuBuchstabe(i))).toBe(i);
    }
    expect(spalteZuBuchstabe(0)).toBe('A');
    expect(spalteZuBuchstabe(26)).toBe('AA');
    expect(zellBezug(4, 3)).toBe('D5');
  });

  it('maskiert XML-Sonderzeichen und entfernt Steuerzeichen', () => {
    expect(xmlEsc('a & b < c > "d" \'e\'')).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
    expect(xmlEsc('a\u0007b')).toBe('ab');
    expect(xmlEsc('a\nb\tc')).toBe('a\nb\tc');
    expect(xmlUnesc(xmlEsc('a & b < c'))).toBe('a & b < c');
  });

  it('kürzt Blattnamen auf das von Excel Zulässige', () => {
    expect(blattName('a'.repeat(40))).toHaveLength(31);
    expect(blattName('Plan[1]:A/B\\C*?')).toBe('Plan 1  A B C');
    expect(blattName('   ')).toBe('Blatt');
  });
});

describe('xlsxDateien', () => {
  const dateien = xlsxDateien(beispiel());

  it('legt alle Pflichtteile eines OOXML-Pakets an', () => {
    for (const pfad of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(Object.keys(dateien), pfad).toContain(pfad);
    }
  });

  it('erzeugt ausschließlich wohlgeformtes XML', () => {
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      expect(XMLValidator.validate(inhalt), `${pfad} ist nicht wohlgeformt`).toBe(true);
    }
  });

  it('hält die vom Schema vorgeschriebene Elementreihenfolge im Arbeitsblatt ein', () => {
    const xml = dateien['xl/worksheets/sheet1.xml'];
    const pos = t => xml.indexOf('<' + t);
    for (const t of ['dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
      'sheetProtection', 'mergeCells', 'dataValidations', 'pageMargins']) {
      expect(pos(t), t + ' fehlt').toBeGreaterThan(-1);
    }
    const folge = ['dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
      'sheetProtection', 'mergeCells', 'dataValidations', 'pageMargins'].map(pos);
    expect(folge).toEqual([...folge].sort((a, b) => a - b));
  });

  it('schützt das Blatt ohne Passwort und lässt nur die Eingabezellen frei', () => {
    const xml = dateien['xl/worksheets/sheet1.xml'];
    expect(xml).toContain('<sheetProtection sheet="1"');
    expect(xml).not.toMatch(/password=|hashValue=/);
    // Eingabe- und Zahlen-Eingabestil tragen protection locked="0"
    const styles = new XMLParser({ ignoreAttributes: false }).parse(dateien['xl/styles.xml']);
    const xfs = styles.styleSheet.cellXfs.xf;
    expect(xfs[XS.eingabe].protection['@_locked']).toBe('0');
    expect(xfs[XS.eingabeZahl].protection['@_locked']).toBe('0');
    expect(xfs[XS.text].protection).toBeUndefined();
    expect(xfs[XS.standard].protection).toBeUndefined();
  });

  it('schreibt Datenüberprüfung, Fixierung, verbundene Zellen und versteckte Spalten', () => {
    const xml = dateien['xl/worksheets/sheet1.xml'];
    expect(xml).toContain('<dataValidation type="list"');
    expect(xml).toContain('sqref="C4:C40"');
    expect(xml).toContain('<formula1>L_JaNein</formula1>');
    expect(xml).toContain('ySplit="3"');
    expect(xml).toContain('<mergeCell ref="A1:C1"/>');
    expect(xml).toContain('hidden="1"');
  });

  it('meldet definierte Namen und versteckte Blätter in der Arbeitsmappe', () => {
    const wb = dateien['xl/workbook.xml'];
    expect(wb).toContain('<definedName name="L_JaNein">Listen!$A$2:$A$4</definedName>');
    expect(wb).toContain('state="hidden"');
  });

  it('nutzt für Excel reservierte Füllungsplätze 0 und 1', () => {
    const fills = dateien['xl/styles.xml'].match(/<fills[^>]*>([\s\S]*?)<\/fills>/)[1];
    expect(fills.indexOf('patternType="none"')).toBeLessThan(fills.indexOf('patternType="gray125"'));
    expect(fills.indexOf('patternType="gray125"')).toBeLessThan(fills.indexOf('patternType="solid"'));
  });

  it('verweigert eine Mappe ohne Blätter', () => {
    expect(() => xlsxDateien({ blaetter: [] })).toThrow();
  });

  it('nummeriert doppelte Blattnamen eindeutig', () => {
    const d = xlsxDateien({ blaetter: [{ name: 'A', zeilen: [['x']] }, { name: 'A', zeilen: [['y']] }] });
    const namen = [...d['xl/workbook.xml'].matchAll(/name="([^"]*)"/g)].map(m => m[1]);
    expect(new Set(namen).size).toBe(namen.length);
  });
});

describe('Round-Trip über JSZip', () => {
  it('liest Texte, Zahlen und Blattnamen unverändert zurück', async () => {
    const zip = new JSZip();
    for (const [p, c] of Object.entries(xlsxDateien(beispiel()))) zip.file(p, c);
    const { blaetter, namen } = await xlsxAusBlob(await zip.generateAsync({ type: 'nodebuffer' }), JSZip);
    expect(namen).toEqual(['Daten', 'Listen']);
    expect(blaetter.Daten[0][0]).toBe('Überschrift & <Zeichen>');
    expect(blaetter.Daten[2]).toEqual(['ID', 'Wert', 'Auswahl']);
    expect(blaetter.Daten[3]).toEqual(['F01', 12.5, 'ja']);
    expect(blaetter.Listen[1]).toEqual(['ja']);
  });

  it('parst dieselben Daten wie ein vollwertiger XML-Parser', () => {
    const xml = xlsxDateien(beispiel())['xl/worksheets/sheet1.xml'];
    const baum = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const rows = baum.worksheet.sheetData.row;
    expect(rows).toHaveLength(3);   // Leerzeile 2 wird nicht geschrieben
    expect(rows.map(r => r['@_r'])).toEqual(['1', '3', '4']);
  });
});

describe('leseBlatt', () => {
  const sst = leseSharedStrings('<sst><si><t>eins</t></si><si><r><t>zw</t></r><r><t>ei</t></r></si></sst>');

  it('setzt Rich-Text-Bruchstücke zusammen', () => {
    expect(sst).toEqual(['eins', 'zwei']);
  });

  it('füllt fehlende Zeilen und Spalten auf, damit Indizes stimmen', () => {
    const xml = '<sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>5</v></c></row>'
      + '<row r="3"><c r="B3" t="inlineStr"><is><t>direkt</t></is></c></row>'
      + '</sheetData>';
    const zeilen = leseBlatt(xml, sst);
    expect(zeilen).toHaveLength(3);
    expect(zeilen[0]).toEqual(['eins', null, 5]);
    expect(zeilen[1]).toEqual([]);
    expect(zeilen[2]).toEqual([null, 'direkt']);
  });

  it('verträgt selbstschließende Zellen und leeres XML', () => {
    expect(leseBlatt('<sheetData><row r="1"><c r="A1" s="5"/><c r="B1"><v>2</v></c></row></sheetData>'))
      .toEqual([[null, 2]]);
    expect(leseBlatt('')).toEqual([]);
    expect(leseBlatt(null)).toEqual([]);
  });
});
