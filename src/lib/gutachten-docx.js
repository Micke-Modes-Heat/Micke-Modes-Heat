// ── lib/gutachten-docx.js — Gutachten-Dokument → OOXML-Bausteine (word/document.xml) ──
// DOM- und importfrei bis auf lib/docx-paket.js. Die Oberfläche
// (21-gutachten-editor.js) sammelt Bilder und Tabellendaten ein und ruft
// gdxErzeugePaket(); das Zippen (JSZip) passiert dort.
//
// Überschriften tragen ihre Nummer als Text (wie in der Vorlage) — die Kopfzeile
// zeigt per STYLEREF damit „3 Elektrotechnik". Beschriftungen nutzen SEQ-Felder,
// Verzeichnisse TOC-Felder; Word füllt sie beim Öffnen (settings: updateFields).

import {
  GD_FARBE, GD_SEITE, xmlEsc, docxStylesXml, docxHeaderXml, docxFooterXml, docxSettingsXml,
  docxContentTypesXml, docxRootRelsXml, docxDocumentRelsXml, docxCoreXml, docxAppXml,
} from './docx-paket.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/* ── Grundbausteine ─────────────────────────────────────────────────────── */
export function gdxLauf(text, o = {}) {
  const rpr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.caps ? '<w:caps/>' : '')
    + (o.farbe ? `<w:color w:val="${o.farbe}"/>` : '') + (o.abstand ? `<w:spacing w:val="${o.abstand}"/>` : '')
    + (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

export function gdxAbsatz(inhalt, o = {}) {
  const ppr = (o.stil ? `<w:pStyle w:val="${o.stil}"/>` : '') + (o.keepNext ? '<w:keepNext/>' : '')
    + (o.pBdr || '') + (o.abstand ? `<w:spacing ${o.abstand}/>` : '') + (o.jc ? `<w:jc w:val="${o.jc}"/>` : '') + (o.sectPr || '');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inhalt}</w:p>`;
}

const leerAbsatz = abstand => gdxAbsatz('', { abstand });
const platzhalter = text => gdxLauf(text, { farbe: GD_FARBE.platzhalter });

/** Überschrift: grüne Nummer, Geviert- (H1) bzw. Halbgeviert-Abstand, schwarzer Titel. */
export function gdxUeberschrift(ebene, nummer, titel) {
  const abstand = ebene === 1 ? ' ' : ' ';
  const t = String(titel || '').trim();
  return gdxAbsatz(gdxLauf(nummer + abstand, { farbe: GD_FARBE.gruen })
    + (t ? gdxLauf(t) : platzhalter('[Kapiteltitel]')), { stil: `Ueberschrift${ebene}` });
}

/** Freitext: Leerzeile = neuer Absatz, einfacher Zeilenumbruch bleibt als Umbruch erhalten. */
export function gdxFreitext(text) {
  const absaetze = String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (!absaetze.length) return gdxAbsatz(platzhalter('[Text]'));
  // Linksbündig wie die Vorlage — Blocksatz würde Zeilen vor einem manuellen Umbruch auseinanderziehen
  return absaetze.map(a => gdxAbsatz(a.split('\n').map((z, i) => (i ? '<w:r><w:br/></w:r>' : '') + gdxLauf(z)).join(''))).join('');
}

/** Textbaustein aus Segmenten [{text, offen}] je Absatz — offene Platzhalter grau wie „[Text]" in der Vorlage. */
export function gdxBausteinAbsaetze(absaetze) {
  return absaetze.map(segs => gdxAbsatz(segs.map(s => (s.offen ? platzhalter(s.text) : gdxLauf(s.text))).join(''))).join('');
}

/** Beschriftung mit SEQ-Feld — Grundlage fürs Abbildungs-/Tabellenverzeichnis. */
export function gdxBeschriftung(art, nr, titel) {
  return gdxAbsatz(gdxLauf(`${art} `)
    + `<w:fldSimple w:instr=" SEQ ${art} \\* ARABIC "><w:r><w:t>${nr}</w:t></w:r></w:fldSimple>`
    + gdxLauf(`: ${titel}`), { stil: 'Beschriftung' });
}

/* ── Bilder ─────────────────────────────────────────────────────────────── */
/** Sammelt Bilder und vergibt Beziehungs- und Zeichnungs-IDs. */
export function gdxKontext() {
  const bilder = [];
  let naechsteId = 100;
  return {
    bilder,
    /** daten: Uint8Array oder Base64-String; liefert rId */
    bild(daten, name = 'bild') {
      const nr = bilder.length + 1;
      const eintrag = { rId: `rIdBild${nr}`, datei: `bild${nr}.png`, daten, name };
      bilder.push(eintrag);
      return eintrag.rId;
    },
    id: () => naechsteId++,
  };
}

function grafik(rId, cx, cy, id, name) {
  return `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>`
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlEsc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic>`;
}

/** Inline-Bild als eigener Lauf (cx/cy in EMU). */
export function gdxBildLauf(ctx, rId, cx, cy, name = 'Grafik') {
  const id = ctx.id();
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="${xmlEsc(name)} ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + grafik(rId, cx, cy, id, name) + `</wp:inline></w:drawing></w:r>`;
}

/** Abbildung in Textbreite (16 cm), Höhe aus dem Seitenverhältnis des Bildes. */
export function gdxAbbildung(ctx, rId, breitePx, hoehePx, name) {
  const cx = GD_SEITE.bildBreiteEmu;
  const cy = Math.round(cx * hoehePx / Math.max(1, breitePx));
  return gdxAbsatz(gdxBildLauf(ctx, rId, cx, cy, name), { abstand: 'w:before="60" w:after="60"', keepNext: true });
}

/* ── Tabellen ───────────────────────────────────────────────────────────── */
const zellRand = `<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${GD_FARBE.linie}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${GD_FARBE.linie}"/></w:tcBorders>`;
const zellAbstand = '<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>';

function zelle(breite, text, { fill = '', jc = '', lauf = {}, spann = 1 } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${breite}" w:type="dxa"/>${spann > 1 ? `<w:gridSpan w:val="${spann}"/>` : ''}${zellRand}`
    + (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '') + `${zellAbstand}</w:tcPr>`
    + gdxAbsatz(gdxLauf(text, lauf), { stil: 'Tabelleninhalt', jc }) + `</w:tc>`;
}

const KOPF_SZ = 18;   // 9 pt — etwas kleiner als der Rumpf, damit auch sechsspaltige Tabellen ohne Silbenbruch passen

/**
 * Spaltenbreiten (twips) nach Gewicht — aber keine Spalte schmaler als das längste
 * Wort ihrer Kopfzeile, sonst bricht Word mitten im Wort um („Amortisatio|n").
 * Den Mehrbedarf geben die übrigen Spalten anteilig an ihrem Überschuss ab.
 */
export function gdxSpaltenBreiten(spalten, gesamt = GD_SEITE.breiteTw, kopfSz = KOPF_SZ) {
  const n = spalten.length;
  if (!n) return [];
  const summe = spalten.reduce((s, c) => s + (c.gewicht || 1), 0) || 1;
  const breiten = spalten.map(c => gesamt * (c.gewicht || 1) / summe);
  // ~0,6 em je Zeichen (Tahoma fett) plus Zellenränder. Passen alle Mindestbreiten zusammen nicht
  // auf die Seite, werden sie gemeinsam verkleinert — dann geht es immer auf.
  const roh = spalten.map(c => Math.max(0, ...String(c.label || '').split(/\s+/).map(w => w.length)) * kopfSz * 6 + 240);
  const faktor = Math.min(1, gesamt / roh.reduce((s, m) => s + m, 0));
  const min = roh.map(m => m * faktor);
  const zuSchmal = breiten.map((b, i) => b < min[i]);
  const bedarf = breiten.reduce((s, b, i) => s + (zuSchmal[i] ? min[i] - b : 0), 0);
  const vorrat = breiten.reduce((s, b, i) => s + (zuSchmal[i] ? 0 : b - min[i]), 0);
  const angepasst = breiten.map((b, i) => (zuSchmal[i] ? min[i] : vorrat > 0 ? b - bedarf * (b - min[i]) / vorrat : b));
  const gerundet = angepasst.map(b => Math.round(b));
  gerundet[n - 1] += gesamt - gerundet.reduce((s, b) => s + b, 0);
  return gerundet;
}

/**
 * Tabelle im Hausstil der Vorlage: grüner Kopf mit weißer Schrift (wiederholt sich
 * auf Folgeseiten), graue Haarlinien, jede zweite Zeile leicht getönt,
 * hervorgehobene Zeilen hellgrün und fett.
 * spalten: [{label, gewicht, align}], zeilen: [{werte: [...], highlight}]
 */
export function gdxTabelle({ spalten = [], zeilen = [], fussnote = '', leer = 'Keine Daten vorhanden.' }) {
  const gesamt = GD_SEITE.breiteTw;
  const breiten = gdxSpaltenBreiten(spalten, gesamt);
  const jc = (c, i) => { const a = c.align || (i === 0 ? 'left' : 'right'); return a === 'left' ? '' : a === 'center' ? 'center' : 'right'; };

  const kopf = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>`
    + spalten.map((c, i) => zelle(breiten[i], c.label || '', { fill: GD_FARBE.gruen, jc: jc(c, i), lauf: { b: true, farbe: 'FFFFFF', sz: KOPF_SZ } })).join('') + `</w:tr>`;
  const rumpf = zeilen.length
    ? zeilen.map((z, zi) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>` + spalten.map((c, i) => {
        const v = z.werte?.[i];
        const text = v == null || v === '' ? '–' : String(v);
        return zelle(breiten[i], text, {
          fill: z.highlight ? GD_FARBE.tint : zi % 2 ? GD_FARBE.band : '',
          jc: jc(c, i),
          lauf: z.highlight ? { b: true, farbe: GD_FARBE.gruen } : {},
        });
      }).join('') + `</w:tr>`).join('')
    : `<w:tr>${zelle(gesamt, leer, { spann: Math.max(1, spalten.length), lauf: { farbe: GD_FARBE.platzhalter } })}</w:tr>`;
  const fuss = fussnote
    ? `<w:tr>${zelle(gesamt, fussnote, { spann: Math.max(1, spalten.length), lauf: { i: true, farbe: GD_FARBE.grau, sz: 16 } })}</w:tr>`
    : '';

  return `<w:tbl><w:tblPr><w:tblW w:w="${gesamt}" w:type="dxa"/><w:tblInd w:w="100" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>`
    + `<w:tblGrid>${breiten.map(b => `<w:gridCol w:w="${b}"/>`).join('')}</w:tblGrid>${kopf}${rumpf}${fuss}</w:tbl>`
    + leerAbsatz('w:after="0"');
}

/* ── Verzeichnisse ──────────────────────────────────────────────────────── */
function feld(instr, hinweis) {
  return gdxAbsatz(`<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>`
    + `<w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`
    + platzhalter(hinweis) + `<w:r><w:fldChar w:fldCharType="end"/></w:r>`);
}

export function gdxInhaltsverzeichnis() {
  return gdxAbsatz(gdxLauf('Inhalt'), { stil: 'Verzeichnistitel' })
    + feld('TOC \\o "1-3" \\h \\z \\u', 'Verzeichnis wird beim Öffnen in Word aktualisiert (sonst: Rechtsklick › Felder aktualisieren).');
}

export function gdxVerzeichnis(titel, seq, { neueSeite = false } = {}) {
  return gdxAbsatz((neueSeite ? '<w:r><w:br w:type="page"/></w:r>' : '') + gdxLauf(titel), { stil: 'Verzeichnistitel', abstand: neueSeite ? '' : 'w:before="400" w:after="200"' })
    + feld(`TOC \\h \\z \\c "${seq}"`, `${titel} wird beim Öffnen in Word aktualisiert.`);
}

/* ── Deckblatt ──────────────────────────────────────────────────────────── */
const SECT_DECKBLATT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="720"/><w:titlePg/></w:sectPr>';
const SECT_HAUPT = '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>'
  + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1250" w:right="850" w:bottom="1100" w:left="850" w:header="600" w:footer="500" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>';

const mitPlatzhalter = (wert, name) => (String(wert || '').trim() ? String(wert).trim() : `[${name}]`);

/**
 * Deckblatt nach der Vorlage. d: {liegenschaft, ort, projekt, auftraggeber, auftrag,
 * aufgestelltDurch, aufgestellt, standort, stand, ansprechpersonen: [{name, telefon}]}
 * bilder: {logo, wappen, netz} = rIds (optional)
 */
export function gdxDeckblatt(ctx, d = {}, bilder = {}) {
  const gruen = GD_FARBE.gruen;
  const band = `<w:tbl><w:tblPr><w:tblW w:w="12747" w:type="dxa"/><w:tblInd w:w="-850" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="7536"/><w:gridCol w:w="5211"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:trHeight w:val="1775"/></w:trPr>`
    + `<w:tc><w:tcPr><w:tcW w:w="7536" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${gruen}"/><w:tcMar><w:left w:w="1700" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>`
    + gdxAbsatz(bilder.logo ? gdxBildLauf(ctx, bilder.logo, 1512000, 478800, 'Logo LKEBw') : '', { abstand: 'w:before="60" w:after="60"' }) + `</w:tc>`
    + `<w:tc><w:tcPr><w:tcW w:w="5211" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${gruen}"/><w:tcMar><w:right w:w="850" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>`
    + gdxAbsatz(bilder.wappen ? gdxBildLauf(ctx, bilder.wappen, 684000, 889200, 'Wappen') : '', { abstand: 'w:before="60" w:after="60"', jc: 'right' }) + `</w:tc></w:tr></w:tbl>`;

  const titelLauf = (t, farbe) => gdxLauf(t, { b: true, sz: 56, farbe });
  let netz = '';
  if (bilder.netz) {
    const id = ctx.id();
    netz = `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251660288" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">`
      + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>3281752</wp:posOffset></wp:positionH>`
      + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>1365672</wp:posOffset></wp:positionV><wp:extent cx="3731948" cy="5276871"/>`
      + `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Deckblattgrafik"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
      + grafik(bilder.netz, 3731948, 5276871, id, 'Deckblattgrafik') + `</wp:anchor></w:drawing></w:r>`;
  }
  const titel = gdxAbsatz(gdxLauf('Gutachten Energieversorgung', { caps: true, farbe: GD_FARBE.gruenHell, abstand: 40, sz: 19 }), { abstand: 'w:after="260"' })
    + gdxAbsatz(titelLauf('Gutachten'), { abstand: 'w:after="0" w:line="288" w:lineRule="auto"' })
    + gdxAbsatz(titelLauf('zur zukünftigen Energieversorgung'), { abstand: 'w:after="0" w:line="288" w:lineRule="auto"' })
    + gdxAbsatz(netz + titelLauf(`der ${mitPlatzhalter(d.liegenschaft, 'Liegenschaftsname')}${d.ort ? ` in ${d.ort}` : ''}`, gruen),
      { abstand: 'w:after="600" w:line="288" w:lineRule="auto"' });

  const randLinks = `<w:tcBorders><w:left w:val="single" w:sz="18" w:space="0" w:color="${gruen}"/></w:tcBorders>`;
  const projektZeile = (label, wert, kursiv) => `<w:tr>`
    + `<w:tc><w:tcPr><w:tcW w:w="2858" w:type="dxa"/>${randLinks}<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`
    + gdxAbsatz(label ? gdxLauf(label, { farbe: GD_FARBE.grau, sz: 19 }) : '', { abstand: 'w:after="0" w:line="240" w:lineRule="auto"' }) + `</w:tc>`
    + `<w:tc><w:tcPr><w:tcW w:w="7348" w:type="dxa"/>${randLinks}<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`
    + gdxAbsatz(gdxLauf(wert, kursiv ? { i: true, farbe: GD_FARBE.grau, sz: 19 } : { sz: 19 }), { abstand: 'w:after="0" w:line="240" w:lineRule="auto"' }) + `</w:tc></w:tr>`;
  const projekt = `<w:tbl><w:tblPr><w:tblW w:w="10206" w:type="dxa"/><w:tblInd w:w="140" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2858"/><w:gridCol w:w="7348"/></w:tblGrid>`
    + projektZeile('Projekt', mitPlatzhalter(d.projekt, 'Liegenschaftsname'))
    + projektZeile('Auftraggeber', mitPlatzhalter(d.auftraggeber, 'Auftraggeber'))
    + projektZeile('', mitPlatzhalter(d.auftrag, 'Auftrag vom … von …'), true)
    + projektZeile('Aufgestellt durch', mitPlatzhalter(d.aufgestelltDurch, 'Aufgestellt durch'))
    + projektZeile('', mitPlatzhalter(d.aufgestellt, 'am … · Fachbereich …'), true)
    + projektZeile('Liegenschaft', mitPlatzhalter(d.standort, 'Standort, PLZ Ort'))
    + projektZeile('Stand', mitPlatzhalter(d.stand, 'Datum'))
    + `</w:tbl>`;

  const personen = (d.ansprechpersonen || []).filter(p => p && (p.name || p.telefon)).slice(0, 3);
  while (personen.length < 3) personen.push({});
  const personenTabelle = `<w:tbl><w:tblPr><w:tblW w:w="10206" w:type="dxa"/><w:tblInd w:w="10" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="3402"/>'.repeat(3)}</w:tblGrid><w:tr>`
    + personen.map(p => `<w:tc><w:tcPr><w:tcW w:w="3402" w:type="dxa"/></w:tcPr>`
      + gdxAbsatz(gdxLauf(mitPlatzhalter(p.name, 'Name'), { b: true, sz: 19 }), { abstand: 'w:after="20" w:line="240" w:lineRule="auto"' })
      + gdxAbsatz(gdxLauf(mitPlatzhalter(p.telefon, 'Telefonnummer'), { farbe: GD_FARBE.grau, sz: 19 }), { abstand: 'w:after="0" w:line="240" w:lineRule="auto"' })
      + `</w:tc>`).join('') + `</w:tr></w:tbl>`;

  return band + leerAbsatz('') + leerAbsatz('w:after="900"') + titel + projekt
    + gdxAbsatz('', { pBdr: `<w:pBdr><w:top w:val="single" w:sz="4" w:space="10" w:color="${GD_FARBE.linie}"/></w:pBdr>`, abstand: 'w:before="480" w:after="0" w:line="240" w:lineRule="auto"' })
    + gdxAbsatz(gdxLauf('Ansprechpersonen', { caps: true, farbe: GD_FARBE.grau, abstand: 30, sz: 17 }), { abstand: 'w:before="140" w:after="180" w:line="240" w:lineRule="auto"' })
    + personenTabelle
    + gdxAbsatz('', { sectPr: SECT_DECKBLATT });
}

/* ── Paket ──────────────────────────────────────────────────────────────── */
export function gdxDokumentXml(koerper) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<w:document ${NS}><w:body>${koerper}${SECT_HAUPT}</w:body></w:document>`;
}

/** Alle Dateien der .docx: [{pfad, inhalt}] — inhalt ist String oder (bei Bildern) Uint8Array/Base64. */
export function gdxErzeugePaket(ctx, koerper, { titel = 'Gutachten zur zukünftigen Energieversorgung', autor = 'LKEBw', datumIso } = {}) {
  return [
    { pfad: '[Content_Types].xml', inhalt: docxContentTypesXml() },
    { pfad: '_rels/.rels', inhalt: docxRootRelsXml() },
    { pfad: 'docProps/core.xml', inhalt: docxCoreXml({ titel, autor, datumIso }) },
    { pfad: 'docProps/app.xml', inhalt: docxAppXml() },
    { pfad: 'word/document.xml', inhalt: gdxDokumentXml(koerper) },
    { pfad: 'word/styles.xml', inhalt: docxStylesXml() },
    { pfad: 'word/settings.xml', inhalt: docxSettingsXml() },
    { pfad: 'word/header1.xml', inhalt: docxHeaderXml() },
    { pfad: 'word/footer1.xml', inhalt: docxFooterXml() },
    { pfad: 'word/_rels/document.xml.rels', inhalt: docxDocumentRelsXml(ctx.bilder) },
    ...ctx.bilder.map(b => ({ pfad: `word/media/${b.datei}`, inhalt: b.daten, base64: typeof b.daten === 'string' })),
  ];
}
