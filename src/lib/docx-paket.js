// ── lib/docx-paket.js — paketweite Teile einer .docx im LKEBw-Gutachtenstil ──
// DOM- und importfrei. Formatvorlagen, Kopf-/Fußzeile und Seitenränder sind der
// Word-Vorlage „Gutachten_Energieversorgung_LKEBw.docx" nachgebaut — dort sind
// Unterüberschriften und Beschriftungen nur direkt formatiert; hier bekommen sie
// echte Formatvorlagen (Überschrift 1–3, Beschriftung, Verzeichnis 1–3), damit
// Inhalts- und Abbildungsverzeichnis in Word funktionieren.

export const GD_FARBE = { gruen: '266426', gruenHell: '3F9C3F', text: '1B1F1C', grau: '5A5F5A', platzhalter: '8A8F8A', linie: 'E2E4DF', tint: 'EEF5EC', band: 'F4F5F2' };
/** Satzspiegel A4 mit 1,5 cm Rand: 18 cm = 10206 twips; Abbildungen 16 cm breit. */
export const GD_SEITE = { breiteTw: 10206, bildBreiteEmu: 5760000 };

const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const KOPF = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function xmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stil(typ, id, name, inhalt, { basis = 'Standard', naechster = '', ui = 1 } = {}) {
  return `<w:style w:type="${typ}" w:styleId="${id}"><w:name w:val="${name}"/>`
    + (basis ? `<w:basedOn w:val="${basis}"/>` : '') + (naechster ? `<w:next w:val="${naechster}"/>` : '')
    + `<w:uiPriority w:val="${ui}"/><w:qFormat/>${inhalt}</w:style>`;
}
const TAB_PUNKTE = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${GD_SEITE.breiteTw}"/></w:tabs>`;

export function docxStylesXml() {
  const F = GD_FARBE;
  return KOPF + `<w:styles ${NS_W}>`
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:eastAsia="Tahoma" w:cs="Tahoma"/>`
    + `<w:color w:val="${F.text}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="de-DE" w:eastAsia="de-DE" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`
    + `<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:qFormat/></w:style>`
    + `<w:style w:type="character" w:default="1" w:styleId="Absatz-Standardschriftart"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>`
    + `<w:style w:type="table" w:default="1" w:styleId="NormaleTabelle"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>`
    + `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`
    + stil('paragraph', 'Ueberschrift1', 'heading 1', `<w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="0" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>`, { naechster: 'Standard', ui: 9 })
    + stil('paragraph', 'Ueberschrift2', 'heading 2', `<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr>`, { naechster: 'Standard', ui: 9 })
    + stil('paragraph', 'Ueberschrift3', 'heading 3', `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr>`, { naechster: 'Standard', ui: 9 })
    + stil('paragraph', 'Beschriftung', 'caption', `<w:pPr><w:spacing w:before="60" w:after="220"/></w:pPr><w:rPr><w:color w:val="${F.grau}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>`, { ui: 35 })
    + stil('paragraph', 'Verzeichnis1', 'toc 1', `<w:pPr>${TAB_PUNKTE}<w:spacing w:before="120" w:after="60"/></w:pPr><w:rPr><w:b/></w:rPr>`, { naechster: 'Standard', ui: 39 })
    + stil('paragraph', 'Verzeichnis2', 'toc 2', `<w:pPr>${TAB_PUNKTE}<w:spacing w:after="20"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>`, { naechster: 'Standard', ui: 39 })
    + stil('paragraph', 'Verzeichnis3', 'toc 3', `<w:pPr>${TAB_PUNKTE}<w:spacing w:after="20"/><w:ind w:left="480"/></w:pPr><w:rPr><w:color w:val="${F.grau}"/><w:sz w:val="20"/></w:rPr>`, { naechster: 'Standard', ui: 39 })
    + stil('paragraph', 'Abbildungsverzeichnis', 'table of figures', `<w:pPr>${TAB_PUNKTE}<w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>`, { naechster: 'Standard', ui: 99 })
    + stil('paragraph', 'Verzeichnistitel', 'Verzeichnistitel', `<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>`, { naechster: 'Standard' })
    + stil('paragraph', 'Tabelleninhalt', 'Tabelleninhalt', `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>`)
    + stil('paragraph', 'Kopfzeile', 'header', `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>`, { ui: 99 })
    + stil('paragraph', 'Fusszeile', 'footer', `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>`, { ui: 99 })
    + `</w:styles>`;
}

const bandRpr = (farbe, extra = '') => `<w:rPr>${extra}<w:color w:val="${farbe}"/><w:spacing w:val="16"/><w:sz w:val="17"/></w:rPr>`;

/** Kopfzeile wie in der Vorlage: dunkelgrüner Streifen, links der Dokumenttitel, rechts das aktuelle Hauptkapitel (STYLEREF). */
export function docxHeaderXml(titel = 'Gutachten Energieversorgung') {
  const r = bandRpr(GD_FARBE.grau, '<w:caps/>');
  return KOPF + `<w:hdr ${NS_W} ${NS_R}>`
    + `<w:tbl><w:tblPr><w:tblW w:w="11906" w:type="dxa"/><w:tblInd w:w="-850" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="11906"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="75"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="11906" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${GD_FARBE.gruen}"/></w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p></w:tc></w:tr></w:tbl>`
    + `<w:p><w:pPr><w:pStyle w:val="Kopfzeile"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${GD_FARBE.linie}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${GD_SEITE.breiteTw}"/></w:tabs></w:pPr>`
    + `<w:r>${r}<w:t>${xmlEsc(titel)}</w:t></w:r><w:r><w:tab/></w:r>`
    + `<w:r>${r}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${r}<w:instrText xml:space="preserve"> STYLEREF 1 \\* MERGEFORMAT </w:instrText></w:r>`
    + `<w:r>${r}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${r}<w:t> </w:t></w:r><w:r>${r}<w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`;
}

/** Fußzeile wie in der Vorlage: grünes Band mit Absender links und Seitenzahl rechts. */
export function docxFooterXml(absender = 'LKEBw · Leitstelle Klimaneutrale Energieversorgung') {
  const weiss = `<w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="17"/></w:rPr>`;
  const zelle = (breite, rand, inhalt, rechts) => `<w:tc><w:tcPr><w:tcW w:w="${breite}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${GD_FARBE.gruenHell}"/>`
    + `<w:tcMar><w:${rechts ? 'right' : 'left'} w:w="${rand}" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>`
    + `<w:p><w:pPr><w:pStyle w:val="Fusszeile"/>${rechts ? '<w:jc w:val="right"/>' : ''}</w:pPr>${inhalt}</w:p></w:tc>`;
  return KOPF + `<w:ftr ${NS_W} ${NS_R}>`
    + `<w:tbl><w:tblPr><w:tblW w:w="12745" w:type="dxa"/><w:tblInd w:w="-850" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="7535"/><w:gridCol w:w="5210"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="593"/></w:trPr>`
    + zelle(7535, 850, `<w:r>${bandRpr('FFFFFF')}<w:t>${xmlEsc(absender)}</w:t></w:r>`, false)
    + zelle(5210, 850,`<w:r>${weiss}<w:t xml:space="preserve">Seite </w:t></w:r><w:r>${weiss}<w:fldChar w:fldCharType="begin"/></w:r>`
        + `<w:r>${weiss}<w:instrText>PAGE</w:instrText></w:r><w:r>${weiss}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${weiss}<w:t>1</w:t></w:r>`
        + `<w:r>${weiss}<w:fldChar w:fldCharType="end"/></w:r>`, true)
    + `</w:tr></w:tbl></w:ftr>`;
}

/** updateFields: Word fragt beim Öffnen, ob die Felder aktualisiert werden sollen — füllt Inhalts- und Abbildungsverzeichnis. */
export function docxSettingsXml() {
  return KOPF + `<w:settings ${NS_W}><w:zoom w:percent="100"/><w:updateFields w:val="true"/><w:defaultTabStop w:val="708"/>`
    + `<w:hyphenationZone w:val="425"/><w:characterSpacingControl w:val="doNotCompress"/>`
    + `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>`
    + `<w:themeFontLang w:val="de-DE"/><w:decimalSymbol w:val=","/><w:listSeparator w:val=";"/></w:settings>`;
}

export function docxContentTypesXml() {
  const o = (teil, typ) => `<Override PartName="${teil}" ContentType="application/vnd.openxmlformats-officedocument.${typ}"/>`;
  return KOPF + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + o('/word/document.xml', 'wordprocessingml.document.main+xml') + o('/word/styles.xml', 'wordprocessingml.styles+xml')
    + o('/word/settings.xml', 'wordprocessingml.settings+xml') + o('/word/header1.xml', 'wordprocessingml.header+xml')
    + o('/word/footer1.xml', 'wordprocessingml.footer+xml') + o('/docProps/app.xml', 'extended-properties+xml')
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
}

export function docxRootRelsXml() {
  const t = 'http://schemas.openxmlformats.org';
  return KOPF + `<Relationships xmlns="${t}/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${t}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
    + `<Relationship Id="rId2" Type="${t}/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
    + `<Relationship Id="rId3" Type="${t}/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

/** Beziehungen von document.xml; `bilder` = [{rId, datei}] mit Dateinamen unter word/media/. */
export function docxDocumentRelsXml(bilder = []) {
  const t = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = (id, typ, ziel) => `<Relationship Id="${id}" Type="${t}/${typ}" Target="${ziel}"/>`;
  return KOPF + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rel('rIdStyles', 'styles', 'styles.xml') + rel('rIdSettings', 'settings', 'settings.xml')
    + rel('rIdHeader', 'header', 'header1.xml') + rel('rIdFooter', 'footer', 'footer1.xml')
    + bilder.map(b => rel(b.rId, 'image', `media/${b.datei}`)).join('') + `</Relationships>`;
}

export function docxCoreXml({ titel = '', autor = 'LKEBw', datumIso = new Date().toISOString() } = {}) {
  const d = datumIso.replace(/\.\d+Z$/, 'Z');
  return KOPF + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" `
    + `xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${xmlEsc(titel)}</dc:title><dc:creator>${xmlEsc(autor)}</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${d}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${d}</dcterms:modified></cp:coreProperties>`;
}

export function docxAppXml() {
  return KOPF + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Micke-Modes-Heat</Application></Properties>`;
}
