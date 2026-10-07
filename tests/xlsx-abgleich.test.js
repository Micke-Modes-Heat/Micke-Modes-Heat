import { describe, it, expect } from 'vitest';
import {
  xNum, xInt, xBool, kopfIndex, zahlGeaendert, textGeaendert, xAuswahl, zelleGeaendert,
  propZuZelle, zelleZuProp, propGeaendert,
  zielParameterText, zielParameterLesen, zielParameterGleich,
  geltungText, geltungLesen, GILT_ALLE,
} from '../src/lib/xlsx-abgleich.js';

describe('Zellwerte lesen', () => {
  it('Zahlen mit deutschem Komma und Tausenderpunkt', () => {
    expect(xNum('1,5')).toBe(1.5);
    expect(xNum('1.234,5')).toBe(1234.5);
    expect(xNum('2.5')).toBe(2.5);
    expect(xNum(42)).toBe(42);
    expect(xNum('')).toBeNull();
    expect(xNum('abc')).toBeNull();
    expect(xNum(true)).toBeNull();
    expect(xInt('2030,4')).toBe(2030);
  });

  it('ja/nein inkl. Excel-Wahrheitswerten', () => {
    expect(xBool('ja')).toBe(true);
    expect(xBool('Nein')).toBe(false);
    expect(xBool(true)).toBe(true);
    expect(xBool(false)).toBe(false);
    expect(xBool('vielleicht')).toBeNull();
    expect(xBool('')).toBeNull();
  });

  it('Spalten über die Kopfzeile, mit Aliasen', () => {
    const k = kopfIndex(['Asset-ID', ' Titel ', 'Jahr']);
    expect(k.hat('Objekt-ID', 'Asset-ID')).toBe(true);
    expect(k.zelle(['a1', 'X', 2030], 'Objekt-ID', 'Asset-ID')).toBe('a1');
    expect(k.zelle(['a1', 'X', 2030], 'Titel')).toBe('X');
    expect(k.zelle(['a1'], 'Fehlt')).toBeUndefined();
  });
});

describe('Änderungserkennung (Rundreise ändert nichts)', () => {
  it('vergleicht auf die Exportgenauigkeit', () => {
    expect(zahlGeaendert(12.3456, 12.35, 2)).toBe(false);
    expect(zahlGeaendert('12.3456', 12.35, 2)).toBe(false);
    expect(zahlGeaendert(12.3456, 12.4, 2)).toBe(true);
    expect(zahlGeaendert(null, '', 0)).toBe(false);
    expect(zahlGeaendert(undefined, null, 0)).toBe(false);
    expect(zahlGeaendert(2030, '', 0)).toBe(true);
    expect(zahlGeaendert(null, 2030, 0)).toBe(true);
  });

  it('Text: leer und null gleich', () => {
    expect(textGeaendert(null, '')).toBe(false);
    expect(textGeaendert('A', ' A ')).toBe(false);
    expect(textGeaendert('A', 'B')).toBe(true);
  });

  it('Auswahl über Schlüssel oder Anzeigename', () => {
    const w = { sued: 'Süd', ostwest: 'Ost-West' };
    expect(xAuswahl('Süd', w)).toBe('sued');
    expect(xAuswahl('ostwest', w)).toBe('ostwest');
    expect(xAuswahl('ost-west', w)).toBe('ostwest');
    expect(xAuswahl('', w)).toBeNull();
    expect(xAuswahl('Nord', w)).toBeUndefined();
  });
});

describe('Exportstand (Dreiwege-Abgleich)', () => {
  it('nur in Excel geänderte Zellen zählen', () => {
    expect(zelleGeaendert(12.35, 12.350000000000001)).toBe(false);   // Excel-Rauschen
    expect(zelleGeaendert('12,35', 12.35)).toBe(false);
    expect(zelleGeaendert('', null)).toBe(false);
    expect(zelleGeaendert('ja', 'ja ')).toBe(false);
    expect(zelleGeaendert(3, 1)).toBe(true);
    expect(zelleGeaendert('', 2040)).toBe(true);
    expect(zelleGeaendert('Süd', 'Ost-West')).toBe(true);
    expect(zelleGeaendert('neu', undefined)).toBe(true);        // Spalte gab es beim Export nicht
  });
});

describe('Typ-Props', () => {
  const janeinDef = { key: 'trennstelle', art: 'janein' };
  const auswahlDef = { key: 'ausrichtung', art: 'auswahl', werte: { sued: 'Süd', ostwest: 'Ost-West' } };
  const zahlDef = { key: 'leistungKVA', art: 'zahl' };

  it('false bleibt false (früher: Text "false" galt als an)', () => {
    const zelle = propZuZelle(janeinDef, false);
    expect(zelle).toBe('nein');
    const res = zelleZuProp(janeinDef, zelle);
    expect(res).toEqual({ ok: true, wert: false });
    expect(propGeaendert(janeinDef, false, res.wert)).toBe(false);
    // Excel liefert ggf. einen echten Wahrheitswert
    expect(zelleZuProp(janeinDef, false)).toEqual({ ok: true, wert: false });
  });

  it('Auswahl: Export als Anzeigename, Import zurück als Schlüssel', () => {
    const zelle = propZuZelle(auswahlDef, 'ostwest');
    expect(zelle).toBe('Ost-West');
    expect(zelleZuProp(auswahlDef, zelle)).toEqual({ ok: true, wert: 'ostwest' });
    expect(zelleZuProp(auswahlDef, 'Nord').ok).toBe(false);
  });

  it('Zahl: leer = null, Text = Fehler, gleiche Zahl = unverändert', () => {
    expect(zelleZuProp(zahlDef, '')).toEqual({ ok: true, wert: null });
    expect(zelleZuProp(zahlDef, 'viel').ok).toBe(false);
    expect(propGeaendert(zahlDef, '630', 630)).toBe(false);
    expect(propGeaendert(zahlDef, undefined, null)).toBe(false);
    expect(propGeaendert(zahlDef, 630, null)).toBe(true);
  });
});

describe('Ziel-Parameter', () => {
  const defs = [{ key: 'leistungKVA', label: 'Leistung (kVA)' }, { key: 'ukProzent', label: 'UK (%)' }];

  it('Rundreise über Anzeigenamen', () => {
    const np = { leistungKVA: 1000, ukProzent: 6 };
    const text = zielParameterText(np, defs);
    expect(text).toBe('Leistung (kVA)=1000; UK (%)=6');
    const { props, unbekannt } = zielParameterLesen(text, defs);
    expect(unbekannt).toEqual([]);
    expect(zielParameterGleich(props, np)).toBe(true);
  });

  it('akzeptiert Schlüssel und vorhandene fremde Schlüssel, meldet Unbekanntes', () => {
    expect(zielParameterLesen('leistungKVA=800', defs).props).toEqual({ leistungKVA: 800 });
    expect(zielParameterLesen('napMaxEinsKw=50', defs, ['napMaxEinsKw']).props).toEqual({ napMaxEinsKw: 50 });
    expect(zielParameterLesen('Farbe=rot', defs).unbekannt).toEqual(['Farbe']);
    expect(zielParameterLesen('', defs).props).toEqual({});
  });

  it('leer und fehlend gleich', () => {
    expect(zielParameterGleich({}, undefined)).toBe(true);
    expect(zielParameterGleich({ a: 1 }, { a: '1' })).toBe(true);
    expect(zielParameterGleich({ a: 1 }, {})).toBe(false);
  });
});

describe('Gilt für', () => {
  const vars = [{ key: 'base', name: 'Hauptplan' }, { key: 'v1', name: 'Ring' }];
  const nameVon = k => vars.find(v => v.key === k)?.name || 'Variante';

  it('Export: fehlend = leer, null = alle, Schlüssel = Name', () => {
    expect(geltungText({}, nameVon)).toBe('');
    expect(geltungText({ variante: null }, nameVon)).toBe(GILT_ALLE);
    expect(geltungText({ variante: 'v1' }, nameVon)).toBe('Ring');
  });

  it('Import', () => {
    expect(geltungLesen('', vars)).toEqual({ aendern: false });
    expect(geltungLesen('alle Varianten', vars)).toEqual({ aendern: true, wert: null });
    expect(geltungLesen('nur Ring', vars)).toEqual({ aendern: true, wert: 'v1' });
    expect(geltungLesen('Hauptplan', vars)).toEqual({ aendern: true, wert: 'base' });
    expect(geltungLesen('Gibtsnicht', vars).fehler).toBeTruthy();
  });
});

describe('Blattbausteine (Schreiben → Lesen)', async () => {
  const { listenBlatt, tabellenBlatt } = await import('../src/lib/xlsx-abgleich.js');
  const { xlsxDateien, XS } = await import('../src/lib/xlsx-schreiber.js');
  const { xlsxLesen } = await import('../src/lib/xlsx-leser.js');

  const { blatt: listen, namen } = listenBlatt({ L_JaNein: ['ja', 'nein'], L_Leer: [], L_Typ: ['NAYY', 'NYY', 'NA2XS2Y'] });
  const spalten = [
    { kopf: 'ID', wert: o => o.id },
    { kopf: 'Name', wert: o => o.name, edit: true },
    { kopf: 'Von', wert: o => o.von, edit: 'neu', liste: 'L_Typ' },
    { kopf: 'Aktiv', wert: o => o.aktiv, edit: true, liste: 'L_JaNein' },
    { kopf: 'Wert', wert: o => o.wert, edit: true, zahl: true },
  ];
  const objekte = [{ id: 'a1', name: 'Trafo 1', von: 'x', aktiv: true, wert: 12.5 }, { id: 'a2', name: '', von: 'y', aktiv: false, wert: null }];
  const blatt = tabellenBlatt('Test', spalten, objekte, { leerzeilen: 3, namen });

  it('Listen: leere Listen entfallen, Namen zeigen auf die Spalten', () => {
    expect(namen).toEqual({ L_JaNein: 'Listen!$A$2:$A$3', L_Typ: 'Listen!$B$2:$B$4' });
    expect(listen.versteckt).toBe(true);
  });

  it('Stile: gelb = Eingabe, grau = Info, Schlüsselspalte nur in Leerzeilen gelb', () => {
    expect(blatt.zeilen[0][0].s).toBe(XS.kopf);
    expect(blatt.zeilen[1][0].s).toBe(XS.info);
    expect(blatt.zeilen[1][1].s).toBe(XS.eingabe);
    expect(blatt.zeilen[1][2].s).toBe(XS.info);          // Von in bestehender Zeile
    expect(blatt.zeilen[3][2].s).toBe(XS.eingabe);       // Von in Leerzeile
    expect(blatt.zeilen[1][4].s).toBe(XS.eingabeZahl);
    expect(blatt.zeilen[1][3].w).toBe('ja');             // Wahrheitswert als ja/nein
  });

  it('Dropdowns: ganze Spalte bzw. nur Leerzeilen', () => {
    expect(blatt.pruefungen.map(p => [p.bereich, p.liste])).toEqual([['C4:C6', 'L_Typ'], ['D2:D6', 'L_JaNein']]);
  });

  it('Rundreise über xlsxDateien und xlsxLesen', async () => {
    const dateien = xlsxDateien({ blaetter: [blatt, listen], namen });
    expect(dateien['xl/workbook.xml']).toContain('<definedName name="L_Typ">Listen!$B$2:$B$4</definedName>');
    expect(dateien['xl/worksheets/sheet1.xml']).toContain('<dataValidation type="list"');
    expect(dateien['xl/worksheets/sheet1.xml']).toContain('<sheetProtection');
    // Autofilter muss in der Datei stehen — auf geschütztem Blatt lässt Excel keinen neuen anlegen
    expect(dateien['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:E6"/>');
    expect(dateien['xl/workbook.xml']).toContain('<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;Test&apos;!$A$1:$E$6</definedName>');
    expect(dateien['xl/worksheets/sheet2.xml']).not.toContain('<autoFilter');
    const { blaetter } = await xlsxLesen(p => dateien[p] ?? null);
    const rows = blaetter.Test;
    expect(rows[0]).toEqual(['ID', 'Name', 'Von', 'Aktiv', 'Wert']);
    expect(rows[1]).toEqual(['a1', 'Trafo 1', 'x', 'ja', 12.5]);
    expect(rows[2].slice(0, 4)).toEqual(['a2', null, 'y', 'nein']);
    const k = kopfIndex(rows[0]);
    expect(zahlGeaendert(12.5, k.zelle(rows[1], 'Wert'), 2)).toBe(false);
  });
});
