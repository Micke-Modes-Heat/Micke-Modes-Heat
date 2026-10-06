// ── lib/gutachten-pptx.js — Präsentation zum Gutachten als .pptx (PresentationML) ──
// DOM-frei, nutzt nur lib/docx-paket.js. Die Oberfläche (21-gutachten-editor.js) rastert die Abbildungen, sammelt Stichpunkte und
// zippt die Teile mit JSZip — wie beim Word-Export (lib/gutachten-docx.js). Design wie das Gutachten: weißer Grund,
// dunkelgrüner Kopfbalken, grüne Kapitelnummer, LKEBw-Wortmarke oben rechts, Fußzeile mit Liegenschaft und Foliennummer.
import { xmlEsc, docxCoreXml, docxAppXml } from './docx-paket.js';

export const GP_FARBE = Object.freeze({ gruen: '266426', gruenHell: '3F9C3F', text: '1B1F1C', grau: '5A5F5A', linie: 'E2E4DF', tint: 'EEF5EC' });
const B = 12192000, H = 6858000;           // 16:9 in EMU
const RAND = 457200;                       // 0,5 Zoll
const KOPF = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const FONT = 'Tahoma';

/* ── Formen ─────────────────────────────────────────────────────────────── */
let _id = 2;
const nid = () => _id++;
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;

function rechteck(x, y, w, h, farbe) {
  const id = nid();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rechteck ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${farbe}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}

/** Ein Lauf: { text, b, farbe, sz (Punkt) } */
function lauf(l) {
  return `<a:r><a:rPr lang="de-DE" sz="${Math.round((l.sz || 16) * 100)}"${l.b ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${l.farbe || GP_FARBE.text}"/></a:solidFill>`
    + `<a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr><a:t>${xmlEsc(l.text)}</a:t></a:r>`;
}

/** Textfeld; absaetze = [{ laeufe: [lauf], punkt, abstandNach }] */
function textfeld(x, y, w, h, absaetze, { anker = 't', autofit = false } = {}) {
  const id = nid();
  const ps = absaetze.map(a => `<a:p><a:pPr${a.punkt ? ' marL="285750" indent="-285750"' : ' marL="0" indent="0"'}>`
    + (a.abstandNach ? `<a:spcAft><a:spcPts val="${a.abstandNach * 100}"/></a:spcAft>` : '')
    + (a.punkt ? `<a:buClr><a:srgbClr val="${GP_FARBE.gruenHell}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>')
    + `</a:pPr>${a.laeufe.map(lauf).join('')}</a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anker}">${autofit ? '<a:normAutofit/>' : '<a:noAutofit/>'}</a:bodyPr><a:lstStyle/>${ps || '<a:p><a:endParaRPr lang="de-DE"/></a:p>'}</p:txBody></p:sp>`;
}

function bild(rId, x, y, w, h, name = 'Abbildung') {
  const id = nid();
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlEsc(name)} ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** Bild in einen Rahmen einpassen (Seitenverhältnis bleibt), oben zentriert. */
function eingepasst(bw, bh, x, y, w, h) {
  const s = Math.min(w / bw, h / bh);
  const cw = bw * s, ch = bh * s;
  return { x: x + (w - cw) / 2, y: y + (h - ch) / 2, w: cw, h: ch };
}

/* ── Folienrahmen ───────────────────────────────────────────────────────── */
function rahmen(nr, o, logoRId) {
  let s = rechteck(0, 0, B, 91440, GP_FARBE.gruen);                                    // Kopfbalken
  if (logoRId) s += bild(logoRId, B - RAND - 1600000, 230000, 1600000, 506667, 'LKEBw');  // Wortmarke 1200×380 px
  s += rechteck(RAND, H - 480000, B - 2 * RAND, 9525, GP_FARBE.linie);                 // Fußlinie
  s += textfeld(RAND, H - 420000, B / 2, 260000, [{ laeufe: [{ text: o.fusszeile || 'LKEBw', sz: 10, farbe: GP_FARBE.grau }] }]);
  s += textfeld(B - RAND - 1500000, H - 420000, 1500000, 260000, [{ laeufe: [{ text: String(nr), sz: 10, farbe: GP_FARBE.grau }] }]);
  return s;
}

function folienTitel(folie) {
  const laeufe = [];
  if (folie.nr) laeufe.push({ text: `${folie.nr}  `, b: true, farbe: GP_FARBE.gruen, sz: 24 });
  laeufe.push({ text: folie.titel || '', b: true, sz: 24 });
  let s = textfeld(RAND, 300000, B - 2 * RAND - 1800000, 520000, [{ laeufe }], { anker: 'ctr' });
  if (folie.unter) s += textfeld(RAND, 840000, B - 2 * RAND, 320000, [{ laeufe: [{ text: folie.unter, sz: 14, farbe: GP_FARBE.grau }] }]);
  return s;
}

/**
 * Folie → spTree-Inhalt. Arten:
 *   titel   { titel, untertitel, zeilen: [Text] }
 *   kapitel { nr, titel }
 *   inhalt  { nr, titel, unter, bild: { rId, breite, hoehe }, punkte: [Text] }
 *   punkte  { nr, titel, unter, punkte: [Text] }
 */
function folienInhalt(folie, nr, o, logoRId) {
  _id = 2;
  if (folie.art === 'titel') {
    let s = rechteck(0, 0, B, H * 0.62, GP_FARBE.gruen);
    s += rechteck(0, H * 0.62, B, 45720, GP_FARBE.gruenHell);
    s += textfeld(RAND * 2, H * 0.2, B - 4 * RAND, 1400000, [
      { laeufe: [{ text: folie.titel || '', b: true, sz: 36, farbe: 'FFFFFF' }], abstandNach: 10 },
      ...(folie.untertitel ? [{ laeufe: [{ text: folie.untertitel, sz: 20, farbe: 'FFFFFF' }] }] : []),
    ], { anker: 'b' });
    s += textfeld(RAND * 2, H * 0.68, B / 2, 1400000, (folie.zeilen || []).filter(Boolean).map(z => ({ laeufe: [{ text: z, sz: 14, farbe: GP_FARBE.grau }], abstandNach: 4 })));
    if (logoRId) s += bild(logoRId, B - 2 * RAND - 2400000, H * 0.7, 2400000, 760000, 'LKEBw');
    return s;
  }
  if (folie.art === 'kapitel') {
    let s = rechteck(0, 0, B, 91440, GP_FARBE.gruen);
    s += rechteck(0, H * 0.38, 182880, H * 0.24, GP_FARBE.gruenHell);
    s += textfeld(RAND * 2, H * 0.36, B - 4 * RAND, 1700000, [
      { laeufe: [{ text: String(folie.nr || ''), b: true, sz: 54, farbe: GP_FARBE.gruen }] },
      { laeufe: [{ text: folie.titel || '', b: true, sz: 32 }] },
    ]);
    if (logoRId) s += bild(logoRId, B - RAND - 1600000, 230000, 1600000, 506667, 'LKEBw');
    s += textfeld(B - RAND - 1500000, H - 420000, 1500000, 260000, [{ laeufe: [{ text: String(nr), sz: 10, farbe: GP_FARBE.grau }] }]);
    return s;
  }
  let s = rahmen(nr, o, logoRId) + folienTitel(folie);
  const oben = folie.unter ? 1250000 : 1000000, unten = H - 560000;
  const punkte = (folie.punkte || []).filter(Boolean);
  const absatzListe = punkte.map(p => ({ laeufe: [{ text: p, sz: punkte.length > 4 ? 14 : 16 }], punkt: true, abstandNach: 8 }));
  if (folie.art === 'inhalt' && folie.bild) {
    const breiteBild = punkte.length ? (B - 2 * RAND) * 0.64 : B - 2 * RAND;
    const r = eingepasst(folie.bild.breite, folie.bild.hoehe, RAND, oben, breiteBild, unten - oben);
    s += bild(folie.bild.rId, r.x, r.y, r.w, r.h, folie.titel);
    if (punkte.length) {
      const x = RAND + breiteBild + 300000;
      s += rechteck(x - 150000, oben, 22860, unten - oben - 200000, GP_FARBE.gruenHell);
      s += textfeld(x, oben + 50000, B - RAND - x, unten - oben - 250000, absatzListe, { autofit: true });
    }
  } else {
    s += textfeld(RAND, oben + 100000, B - 2 * RAND, unten - oben - 200000, absatzListe, { autofit: true });
  }
  return s;
}

/* ── Paket ─────────────────────────────────────────────────────────────── */
function folieXml(inhalt) {
  return KOPF + `<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>`
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + inhalt + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = liste => KOPF + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + liste.map(([id, typ, ziel]) => `<Relationship Id="${id}" Type="${REL}/${typ}" Target="${ziel}"/>`).join('') + '</Relationships>';

function themeXml() {
  const f = c => `<a:srgbClr val="${c}"/>`;
  return KOPF + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="LKEBw"><a:themeElements>`
    + `<a:clrScheme name="LKEBw"><a:dk1>${f('1B1F1C')}</a:dk1><a:lt1>${f('FFFFFF')}</a:lt1><a:dk2>${f('266426')}</a:dk2><a:lt2>${f('EEF5EC')}</a:lt2>`
    + `<a:accent1>${f('266426')}</a:accent1><a:accent2>${f('3F9C3F')}</a:accent2><a:accent3>${f('C9A227')}</a:accent3><a:accent4>${f('4F7FA8')}</a:accent4>`
    + `<a:accent5>${f('7A6334')}</a:accent5><a:accent6>${f('C0392B')}</a:accent6><a:hlink>${f('266426')}</a:hlink><a:folHlink>${f('5A5F5A')}</a:folHlink></a:clrScheme>`
    + `<a:fontScheme name="LKEBw"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + '<a:fmtScheme name="LKEBw"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}

const LEER_BAUM = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function masterXml() {
  return KOPF + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${LEER_BAUM}</p:spTree></p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
    + '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
}
function layoutXml() {
  return KOPF + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Leer"><p:spTree>${LEER_BAUM}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

/**
 * Präsentation als Paketteile [{ pfad, inhalt, base64? }].
 * folien: siehe folienInhalt; bilder: [{ rId-Schlüssel 'bildN', daten: Uint8Array|Base64 }] werden über folie.bild.datei referenziert.
 * o: { titel, fusszeile, logo (PNG Base64) }
 */
export function gpxErzeugePaket(folien, o = {}) {
  const teile = [];
  const medien = [];   // { datei, daten }
  const medium = daten => { const datei = `bild${medien.length + 1}.png`; medien.push({ datei, daten }); return datei; };
  const logoDatei = o.logo ? medium(o.logo) : null;

  folien.forEach((f, i) => {
    const nr = i + 1;
    const r = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    let logoRId = null;
    if (logoDatei) { logoRId = 'rIdLogo'; r.push([logoRId, 'image', `../media/${logoDatei}`]); }
    const folie = { ...f };
    if (f.bild?.daten) {
      const datei = medium(f.bild.daten);
      r.push(['rIdBild', 'image', `../media/${datei}`]);
      folie.bild = { ...f.bild, rId: 'rIdBild' };
    } else if (folie.art === 'inhalt') folie.bild = null;
    teile.push({ pfad: `ppt/slides/slide${nr}.xml`, inhalt: folieXml(folienInhalt(folie, nr, o, logoRId)) });
    teile.push({ pfad: `ppt/slides/_rels/slide${nr}.xml.rels`, inhalt: rels(r) });
  });
  for (const m of medien) teile.push({ pfad: `ppt/media/${m.datei}`, inhalt: m.daten, base64: typeof m.daten === 'string' });

  const n = folien.length;
  teile.push({ pfad: '[Content_Types].xml', inhalt: KOPF + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>'
    + '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>'
    + '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>'
    + Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' });
  teile.push({ pfad: '_rels/.rels', inhalt: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]).replace('</Relationships>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`) });
  teile.push({ pfad: 'docProps/core.xml', inhalt: docxCoreXml({ titel: o.titel || 'Präsentation' }) });
  teile.push({ pfad: 'docProps/app.xml', inhalt: docxAppXml() });
  teile.push({ pfad: 'ppt/presentation.xml', inhalt: KOPF + `<p:presentation ${NS} saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst>'
    + `<p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${B}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="de-DE"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>` });
  teile.push({ pfad: 'ppt/_rels/presentation.xml.rels', inhalt: rels([
    ['rIdM', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rIdT', 'theme', 'theme/theme1.xml'],
    ['rIdP', 'presProps', 'presProps.xml'], ['rIdV', 'viewProps', 'viewProps.xml'], ['rIdTS', 'tableStyles', 'tableStyles.xml'],
    ...Array.from({ length: n }, (_, i) => [`rIdS${i + 1}`, 'slide', `slides/slide${i + 1}.xml`]),
  ]) });
  teile.push({ pfad: 'ppt/slideMasters/slideMaster1.xml', inhalt: masterXml() });
  teile.push({ pfad: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', inhalt: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) });
  teile.push({ pfad: 'ppt/slideLayouts/slideLayout1.xml', inhalt: layoutXml() });
  teile.push({ pfad: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', inhalt: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) });
  teile.push({ pfad: 'ppt/theme/theme1.xml', inhalt: themeXml() });
  teile.push({ pfad: 'ppt/presProps.xml', inhalt: KOPF + `<p:presentationPr ${NS}/>` });
  teile.push({ pfad: 'ppt/viewProps.xml', inhalt: KOPF + `<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>` });
  teile.push({ pfad: 'ppt/tableStyles.xml', inhalt: KOPF + '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>' });
  return teile;
}

/**
 * Stichpunkte aus Fließtext: Sätze mit Zahlen bevorzugt, Platzhalter und Querverweise raus, gekürzt.
 * absaetze: [[{text, offen}]] wie ggFigurWordDaten; max: Anzahl.
 */
export function gpxStichpunkte(absaetze, max = 4) {
  const saetze = [];
  for (const a of absaetze || []) {
    if (a.ueberschrift) continue;
    // Offene Platzhalter markieren: Sätze mit Lücke („beträgt [ ] Jahre“) gehören nicht auf eine Folie
    const t = a.map(x => (x.offen ? '\u0000' : x.text)).join('').replace(/\s+/g, ' ').replace(/\s*\((?:vgl\.\s*)?Kapitel[^)]*\)/g, '').trim();
    for (const s of t.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9•])/)) {
      const x = s.replace(/^[•\-–]\s*/, '').trim();
      if (x.length < 25 || x.includes('\u0000') || /\[|vgl\. Kapitel|siehe Kapitel/.test(x)) continue;
      saetze.push(x);
    }
  }
  const mitZahl = saetze.filter(s => /\d/.test(s));
  const wahl = (mitZahl.length >= 2 ? mitZahl : saetze).slice(0, max);
  return wahl.map(s => (s.length > 180 ? s.slice(0, 177).replace(/\s+\S*$/, '') + ' …' : s).replace(/\.$/, ''));
}
