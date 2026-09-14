// Vitest-Tests für lib/gutachten-docx.js + lib/docx-paket.js — OOXML-Bausteine des Word-Exports.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  gdxKontext, gdxUeberschrift, gdxFreitext, gdxBausteinAbsaetze, gdxBeschriftung, gdxTabelle, gdxSpaltenBreiten,
  gdxDeckblatt, gdxInhaltsverzeichnis, gdxVerzeichnis, gdxAbbildung, gdxErzeugePaket,
} from '../src/lib/gutachten-docx.js';
import { xmlEsc, docxStylesXml, GD_SEITE } from '../src/lib/docx-paket.js';

/** Einfache Wohlgeformtheitsprüfung: jedes geöffnete Element wird in richtiger Reihenfolge geschlossen. */
function ausgewogen(xml) {
  const stapel = [];
  const re = /<(\/?)([\w:]+)(?:\s[^>]*?)?(\/?)>/g;
  const rumpf = xml.replace(/<\?xml[^?]*\?>/, '');
  let m;
  while ((m = re.exec(rumpf))) {
    const [, zu, name, selbst] = m;
    if (selbst) continue;
    if (zu) { if (stapel.pop() !== name) return false; } else stapel.push(name);
  }
  return stapel.length === 0;
}

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Grundbausteine', () => {
  it('maskiert XML-Sonderzeichen', () => {
    expect(xmlEsc('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
  });

  it('setzt Überschriften mit grüner Nummer und Geviert- bzw. Halbgeviertabstand', () => {
    const h1 = gdxUeberschrift(1, '3', 'Elektrotechnik');
    expect(h1).toContain('<w:pStyle w:val="Ueberschrift1"/>');
    expect(h1).toContain('3 ');
    expect(h1).toContain('w:val="266426"');
    expect(gdxUeberschrift(2, '3.1', 'Ist')).toContain('3.1 ');
    expect(gdxUeberschrift(3, '3.1.1', '  ')).toContain('[Kapiteltitel]');
  });

  it('teilt Freitext in Absätze, behält Zeilenumbrüche und maskiert', () => {
    const xml = gdxFreitext('Eins & <zwei>\nZeile\n\nDrei');
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('Eins &amp; &lt;zwei&gt;');
    expect(gdxFreitext('   ')).toContain('[Text]');
  });

  it('färbt offene Platzhalter im Textbaustein grau', () => {
    const xml = gdxBausteinAbsaetze([[{ text: 'Netz der ' }, { text: '[Netzbetreiber]', offen: true }]]);
    expect(xml).toMatch(/<w:color w:val="8A8F8A"\/><\/w:rPr><w:t xml:space="preserve">\[Netzbetreiber\]/);
  });

  it('nummeriert Beschriftungen über SEQ-Felder', () => {
    const xml = gdxBeschriftung('Tabelle', 4, 'Trafostationen');
    expect(xml).toContain('SEQ Tabelle');
    expect(xml).toContain('<w:t>4</w:t>');
    expect(xml).toContain('<w:pStyle w:val="Beschriftung"/>');
  });
});

describe('Tabellen', () => {
  it('verteilt die Spaltenbreiten exakt auf die Textbreite und hebt Zeilen hervor', () => {
    const xml = gdxTabelle({
      spalten: [{ label: 'Jahr', gewicht: 2 }, { label: '2021' }, { label: '2022' }],
      zeilen: [{ werte: ['Erdgas', '3.933', ''] }, { werte: ['Summe', '4.011', '3.591'], highlight: true }],
    });
    const summe = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(summe).toBe(GD_SEITE.breiteTw);
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toContain('w:fill="EEF5EC"');
    expect(xml).toContain('>–<');           // leere Zelle
    expect(ausgewogen(xml)).toBe(true);
  });

  it('macht keine Spalte schmaler als ihr längstes Kopfwort, das Gewicht wirkt weiter', () => {
    const spalten = [{ label: 'Variante', gewicht: 4 },
      ...['Investition', 'Jahresüberschuss', 'Amortisation', 'Kapitalwert', 'Stromgestehung'].map(label => ({ label, gewicht: 1 }))];
    const b = gdxSpaltenBreiten(spalten);
    expect(b.reduce((s, x) => s + x, 0)).toBe(GD_SEITE.breiteTw);
    expect(b[2]).toBeGreaterThanOrEqual('Jahresüberschuss'.length * 18 * 6 + 240 - 1);
    expect(b[5]).toBeGreaterThanOrEqual('Stromgestehung'.length * 18 * 6 + 240 - 1);
    expect(b[0]).toBeGreaterThan(b[1]);
    // Passt ohnehin alles, bleibt es bei der Gewichtsverteilung
    expect(gdxSpaltenBreiten([{ label: 'A', gewicht: 1 }, { label: 'B', gewicht: 3 }], 4000)).toEqual([1000, 3000]);
  });

  it('zeigt ohne Zeilen den Leertext über alle Spalten', () => {
    const xml = gdxTabelle({ spalten: [{ label: 'A' }, { label: 'B' }], zeilen: [], leer: 'Keine Trafos' });
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('Keine Trafos');
  });
});

describe('Paket', () => {
  function beispiel() {
    const ctx = gdxKontext();
    const bilder = { logo: ctx.bild(PNG_1X1), wappen: ctx.bild(PNG_1X1), netz: ctx.bild(PNG_1X1) };
    const koerper = gdxDeckblatt(ctx, { liegenschaft: 'Kaserne <A>', ort: 'Musterstadt' }, bilder)
      + gdxInhaltsverzeichnis()
      + gdxVerzeichnis('Abbildungsverzeichnis', 'Abbildung', { neueSeite: true })
      + gdxUeberschrift(1, '1', 'Einleitung') + gdxFreitext('Text')
      + gdxAbbildung(ctx, ctx.bild(new Uint8Array([1, 2, 3])), 1000, 400, 'Lastgang')
      + gdxBeschriftung('Abbildung', 1, 'Lastgang');
    return { ctx, paket: gdxErzeugePaket(ctx, koerper, { titel: 'Gutachten', datumIso: '2026-09-14T08:00:00.000Z' }) };
  }

  it('enthält alle Pflichtteile, wohlgeformtes XML und die Bildbeziehungen', () => {
    const { ctx, paket } = beispiel();
    const pfade = paket.map(t => t.pfad);
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml',
      'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) {
      expect(pfade).toContain(p);
    }
    for (const t of paket.filter(x => x.pfad.endsWith('.xml') || x.pfad.endsWith('.rels'))) {
      expect(ausgewogen(t.inhalt), t.pfad).toBe(true);
    }
    const rels = paket.find(t => t.pfad === 'word/_rels/document.xml.rels').inhalt;
    ctx.bilder.forEach(b => expect(rels).toContain(`Id="${b.rId}"`));
    expect(pfade.filter(p => p.startsWith('word/media/'))).toHaveLength(4);
    const doc = paket.find(t => t.pfad === 'word/document.xml').inhalt;
    expect(doc).toContain('Kaserne &lt;A&gt;');
    expect(doc).toContain('TOC \\o "1-3"');
    expect(doc).toContain('r:id="rIdHeader"');
    // 1000×400 px → 16 cm breit, Höhe im Seitenverhältnis
    expect(doc).toContain(`cx="${GD_SEITE.bildBreiteEmu}" cy="${GD_SEITE.bildBreiteEmu * 0.4}"`);
  });

  it('definiert Überschrift-, Beschriftungs- und Verzeichnisvorlagen mit Word-Standardnamen', () => {
    const styles = docxStylesXml();
    for (const name of ['heading 1', 'heading 2', 'heading 3', 'caption', 'toc 1', 'toc 2', 'toc 3', 'table of figures']) {
      expect(styles).toContain(`<w:name w:val="${name}"/>`);
    }
    expect(styles).toContain('<w:outlineLvl w:val="2"/>');
  });

  it('lässt sich mit JSZip packen und wieder lesen', async () => {
    const { paket } = beispiel();
    const zip = new JSZip();
    for (const t of paket) zip.file(t.pfad, t.inhalt, t.base64 ? { base64: true } : undefined);
    const wieder = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    expect(await wieder.file('word/document.xml').async('string')).toContain('<w:body>');
    expect((await wieder.file('word/media/bild1.png').async('uint8array'))[1]).toBe(0x50);   // „P“ aus der PNG-Signatur
  });
});
