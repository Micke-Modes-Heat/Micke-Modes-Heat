// ── lib/xlsx-schreiber.js — Minimaler XLSX-Writer (OOXML von Hand) ──────────
//
// Warum nicht SheetJS: die Community-Edition schreibt keine Datenüberprüfung
// (Dropdowns), und sie wird in 05a-export.js erst zur Laufzeit vom CDN geladen.
// Beides trägt nicht für eine Abfragedatei, die offline in der Bw-IT ausgefüllt
// werden soll. Gebaut wird darum wie die .docx in lib/gutachten-docx.js: dieses
// Modul liefert die entpackten Dateien, das Zippen (JSZip) passiert im Aufrufer.
//
// DOM- und importfrei → direkt in Unit-Tests nutzbar.

/** Zeichen, die in XML-Text nicht roh stehen dürfen. */
export function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Steuerzeichen sind in XML 1.0 nicht erlaubt und lösen in Excel die
    // Reparaturmeldung aus. Tabulator/Zeilenumbruch bleiben. Genau darum steht
    // hier ein Steuerzeichen-Bereich — die Regel ist hier nicht anwendbar.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Spaltenindex (0-basiert) → Spaltenbuchstaben („A", „Z", „AA"). */
export function spalteZuBuchstabe(i) {
  let n = Math.max(0, Math.floor(i)), s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/** Zellbezug aus 0-basierten Indizes: (0,0) → „A1". */
export const zellBezug = (zeile, spalte) => spalteZuBuchstabe(spalte) + (zeile + 1);

// ── Stile ───────────────────────────────────────────────────────────────────
// Die Indizes entsprechen der Reihenfolge in <cellXfs> (siehe _stylesXml).
export const XS = Object.freeze({
  standard:    0,
  titel:       1,   // 14 pt fett, LKEBw-dunkelgrün
  hinweis:     2,   // 9 pt grau, umbrechend
  kopf:        3,   // Tabellenkopf: weiß auf dunkelgrün, umbrechend
  text:        4,   // gesperrte Tabellenzelle mit Rahmen
  eingabe:     5,   // gelb, entsperrt
  eingabeZahl: 6,   // gelb, entsperrt, Zahlenformat
  fett:        7,
  fliess:      8,   // umbrechender Fließtext ohne Rahmen
  abschnitt:   9,   // Abschnittsüberschrift: grün auf hellgrün
});

const F_DUNKEL = 'FF266426';   // LKEBw dunkel
const F_HELL   = 'FF3F9C3F';   // LKEBw hell
const F_GELB   = 'FFFFF2A8';   // Eingabezellen
const F_TINT   = 'FFEEF5EC';   // Abschnittsband
const F_GRAU   = 'FF5A5F5A';
const F_LINIE  = 'FFD0D4CE';

const KOPF = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function _stylesXml() {
  const font = (inhalt) => `<font>${inhalt}<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>`;
  const fonts = [
    font('<sz val="11"/><color theme="1"/>'),
    font('<b/><sz val="11"/><color theme="1"/>'),
    font('<b/><sz val="11"/><color rgb="FFFFFFFF"/>'),
    font(`<sz val="9"/><color rgb="${F_GRAU}"/>`),
    font(`<b/><sz val="14"/><color rgb="${F_DUNKEL}"/>`),
    font(`<b/><sz val="11"/><color rgb="${F_DUNKEL}"/>`),
  ];
  const solid = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  // Excel erwartet Füllung 0 = none und Füllung 1 = gray125; eigene ab Index 2.
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    solid(F_DUNKEL), solid(F_GELB), solid(F_TINT), solid(F_HELL),
  ];
  const kante = s => `<${s} style="thin"><color rgb="${F_LINIE}"/></${s}>`;
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border>${kante('left')}${kante('right')}${kante('top')}${kante('bottom')}<diagonal/></border>`,
  ];
  // Reihenfolge = Werte in XS
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">'
      + '<alignment vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
      + '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">'
      + '<alignment vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1">'
      + '<alignment vertical="top" wrapText="1"/><protection locked="0"/></xf>',
    '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1">'
      + '<alignment horizontal="right" vertical="top"/><protection locked="0"/></xf>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">'
      + '<alignment vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">'
      + '<alignment vertical="center"/></xf>',
  ];
  return KOPF + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.0"/></numFmts>'
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
    + `<fills count="${fills.length}">${fills.join('')}</fills>`
    + `<borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

// ── Zellen und Blätter ──────────────────────────────────────────────────────

/** Rohwert einer Zelle in die interne Form bringen. */
function _zelle(roh) {
  if (roh == null) return { w: null, s: XS.standard };
  if (typeof roh === 'object') return { w: roh.w ?? null, s: Number(roh.s) || XS.standard };
  return { w: roh, s: XS.standard };
}

/**
 * Ein Arbeitsblatt als sheetN.xml.
 * @param {object} blatt          siehe xlsxDateien()
 * @param {(s:string)=>number} sst  Text → Index in der sharedStrings-Tabelle
 */
function _sheetXml(blatt, sst) {
  const zeilen = blatt.zeilen || [];
  let maxSpalte = 0;
  for (const z of zeilen) if (z && z.length > maxSpalte) maxSpalte = z.length;

  const zeilenXml = zeilen.map((rohZeile, r) => {
    if (!rohZeile || !rohZeile.length) return '';
    const zellen = rohZeile.map((roh, c) => {
      const { w, s } = _zelle(roh);
      const ref = zellBezug(r, c);
      const stil = s ? ` s="${s}"` : '';
      if (w == null || w === '') return s ? `<c r="${ref}"${stil}/>` : '';
      if (typeof w === 'number' && Number.isFinite(w)) return `<c r="${ref}"${stil}><v>${w}</v></c>`;
      return `<c r="${ref}"${stil} t="s"><v>${sst(String(w))}</v></c>`;
    }).join('');
    if (!zellen) return '';
    const hoehe = blatt.zeilenHoehe?.[r];
    const h = hoehe ? ` ht="${hoehe}" customHeight="1"` : '';
    return `<row r="${r + 1}"${h}>${zellen}</row>`;
  }).join('');

  const cols = (blatt.spalten || []).map((sp, i) => sp
    ? `<col min="${i + 1}" max="${i + 1}" width="${sp.breite ?? 12}" customWidth="1"${sp.verborgen ? ' hidden="1"' : ''}/>`
    : '').join('');

  // Fixierte Kopfzeilen: ySplit = Anzahl der stehenbleibenden Zeilen
  const fix = Number(blatt.fixZeilen) || 0;
  const pane = fix > 0
    ? `<pane ySplit="${fix}" topLeftCell="A${fix + 1}" activePane="bottomLeft" state="frozen"/>`
      + `<selection pane="bottomLeft" activeCell="A${fix + 1}" sqref="A${fix + 1}"/>`
    : '';

  // Blattschutz ohne Passwort: gesperrt sind nur die Zellen ohne <protection locked="0">.
  // Formatieren, Zeilen einfügen/löschen und Sortieren bleiben erlaubt, damit die
  // Liste erweiterbar bleibt (Wert 0 = zugelassen).
  const schutz = blatt.schutz === false ? ''
    : '<sheetProtection sheet="1" objects="1" scenarios="1" formatCells="0" formatColumns="0"'
      + ' formatRows="0" insertRows="0" deleteRows="0" sort="0" autoFilter="0"/>';

  const verbunden = (blatt.verbunden || []).length
    ? `<mergeCells count="${blatt.verbunden.length}">`
      + blatt.verbunden.map(b => `<mergeCell ref="${b}"/>`).join('') + '</mergeCells>'
    : '';

  const pruef = (blatt.pruefungen || []).filter(p => p && p.bereich && p.liste);
  const pruefXml = pruef.length
    ? `<dataValidations count="${pruef.length}">` + pruef.map(p =>
      '<dataValidation type="list" errorStyle="warning" allowBlank="1" showInputMessage="1"'
      + ` showErrorMessage="1" sqref="${p.bereich}"`
      + (p.titel ? ` promptTitle="${xmlEsc(p.titel)}"` : '')
      + (p.hinweis ? ` prompt="${xmlEsc(p.hinweis)}"` : '')
      + ' errorTitle="Auswahlliste"'
      + ' error="Bitte einen Wert aus der Liste wählen. Wenn nichts passt, ist &quot;unbekannt&quot; die richtige Antwort."'
      + `><formula1>${xmlEsc(p.liste)}</formula1></dataValidation>`).join('') + '</dataValidations>'
    : '';

  const dim = zeilen.length && maxSpalte
    ? `<dimension ref="A1:${spalteZuBuchstabe(maxSpalte - 1)}${zeilen.length}"/>` : '<dimension ref="A1"/>';

  // Reihenfolge der Elemente ist im Schema festgelegt — Abweichung führt in
  // Excel zur Reparaturmeldung.
  return KOPF + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + dim
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${zeilenXml}</sheetData>`
    + schutz + verbunden + pruefXml
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + '</worksheet>';
}

/** Blattname auf das beschränken, was Excel zulässt (31 Zeichen, ohne []:*?/\). */
export function blattName(name) {
  const s = String(name ?? '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return s || 'Blatt';
}

/**
 * Eine Arbeitsmappe in die entpackten OOXML-Dateien übersetzen.
 *
 * @param {object} mappe
 * @param {Array<{
 *   name: string,
 *   zeilen: Array<Array<null|string|number|{w:any,s?:number}>>,
 *   spalten?: Array<{breite:number, verborgen?:boolean}|null>,
 *   zeilenHoehe?: Record<number, number>,
 *   fixZeilen?: number,
 *   schutz?: boolean,
 *   versteckt?: boolean,
 *   verbunden?: string[],
 *   pruefungen?: Array<{bereich:string, liste:string, titel?:string, hinweis?:string}>,
 * }>} mappe.blaetter
 * @param {Record<string,string>} [mappe.namen]  definierte Namen → Bezug, z. B. {L_JaNein:'Listen!$A$2:$A$4'}
 * @param {string} [mappe.titel]
 * @param {string} [mappe.autor]
 * @returns {Record<string,string>} Pfad → XML-Inhalt (UTF-8-Text)
 */
export function xlsxDateien(mappe) {
  const blaetter = (mappe?.blaetter || []).filter(Boolean);
  if (!blaetter.length) throw new Error('xlsxDateien: keine Blätter übergeben');

  // Gemeinsame Zeichenkettentabelle — Excel schreibt Text genauso zurück.
  const sstIndex = new Map();
  const sstListe = [];
  const sst = (s) => {
    if (sstIndex.has(s)) return sstIndex.get(s);
    const i = sstListe.length;
    sstIndex.set(s, i); sstListe.push(s);
    return i;
  };

  const dateien = {};
  const namenBelegt = new Set();
  const blattNamen = blaetter.map((b, i) => {
    let n = blattName(b.name || `Blatt${i + 1}`);
    while (namenBelegt.has(n.toLowerCase())) n = blattName(n.slice(0, 29) + '_');
    namenBelegt.add(n.toLowerCase());
    return n;
  });

  blaetter.forEach((b, i) => { dateien[`xl/worksheets/sheet${i + 1}.xml`] = _sheetXml(b, sst); });

  const sstXml = KOPF
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstListe.length}" uniqueCount="${sstListe.length}">`
    + sstListe.map(s => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')
    + '</sst>';
  dateien['xl/sharedStrings.xml'] = sstXml;
  dateien['xl/styles.xml'] = _stylesXml();

  const namen = mappe?.namen && Object.keys(mappe.namen).length
    ? '<definedNames>' + Object.entries(mappe.namen)
      .map(([n, bezug]) => `<definedName name="${xmlEsc(n)}">${xmlEsc(bezug)}</definedName>`).join('')
      + '</definedNames>'
    : '';
  dateien['xl/workbook.xml'] = KOPF
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<bookViews><workbookView activeTab="0"/></bookViews>'
    + '<sheets>' + blattNamen.map((n, i) =>
      `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}"${blaetter[i].versteckt ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
    + '</sheets>' + namen + '</workbook>';

  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const wbRels = blaetter.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${blaetter.length + 1}" Type="${R}/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${blaetter.length + 2}" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>`;
  dateien['xl/_rels/workbook.xml.rels'] = KOPF
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + wbRels + '</Relationships>';

  dateien['_rels/.rels'] = KOPF
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + `<Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/>`
    + '</Relationships>';

  const jetzt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  dateien['docProps/core.xml'] = KOPF
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${xmlEsc(mappe?.titel || '')}</dc:title>`
    + `<dc:creator>${xmlEsc(mappe?.autor || 'Micke-Heat')}</dc:creator>`
    + `<cp:lastModifiedBy>${xmlEsc(mappe?.autor || 'Micke-Heat')}</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${jetzt}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${jetzt}</dcterms:modified>`
    + '</cp:coreProperties>';
  dateien['docProps/app.xml'] = KOPF
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + '<Application>Micke-Heat</Application></Properties>';

  dateien['[Content_Types].xml'] = KOPF
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + blaetter.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>';

  return dateien;
}

/**
 * Entpackte Dateien mit JSZip zu einem Blob packen.
 * JSZip wird übergeben, damit dieses Modul global-frei bleibt.
 */
export async function xlsxBlob(dateien, JSZipKlasse) {
  const zip = new JSZipKlasse();
  for (const [pfad, inhalt] of Object.entries(dateien)) zip.file(pfad, inhalt);
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}
