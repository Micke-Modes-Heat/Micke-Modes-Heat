// ── lib/xlsx-leser.js — Minimaler XLSX-Reader (OOXML von Hand) ──────────────
//
// Gegenstück zu lib/xlsx-schreiber.js: liest die ausgefüllte Abfragedatei
// ohne SheetJS und ohne DOMParser, damit es im Browser und in den Unit-Tests
// gleich läuft. Der Aufrufer entpackt das ZIP (JSZip) und reicht die Texte
// der benötigten Teile herein.
//
// Bewusst genügsam: Excel schreibt maschinellen, flachen XML-Text — ein
// Tag-Scanner reicht. Alles, was nicht verstanden wird, kommt als leere Zelle
// zurück; die fachliche Prüfung liegt in lib/resilienz-abfrage.js.

/** XML-Entitäten zurückübersetzen. */
export function xmlUnesc(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Spaltenbuchstaben → 0-basierter Index („A" → 0, „AA" → 26). */
export function buchstabeZuSpalte(s) {
  let n = 0;
  for (const z of String(s || '').toUpperCase()) {
    const c = z.charCodeAt(0) - 64;
    if (c < 1 || c > 26) continue;
    n = n * 26 + c;
  }
  return n - 1;
}

/** Inhalt aller <si>-Einträge aus sharedStrings.xml (Rich Text wird zusammengefügt). */
export function leseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const si = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = si.exec(xml)) !== null) {
    let text = '';
    const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let mt;
    while ((mt = t.exec(m[1])) !== null) text += xmlUnesc(mt[1]);
    out.push(text);
  }
  return out;
}

/** Blattnamen und zugehörige r:id aus workbook.xml, in Dateireihenfolge. */
export function leseBlattListe(workbookXml) {
  const out = [];
  const re = /<sheet\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(workbookXml || '')) !== null) {
    const attr = m[1];
    const name = /name="([^"]*)"/.exec(attr)?.[1];
    const rid = /r:id="([^"]*)"/.exec(attr)?.[1];
    if (name && rid) out.push({ name: xmlUnesc(name), rid });
  }
  return out;
}

/** r:id → Zielpfad innerhalb von xl/ aus workbook.xml.rels. */
export function leseBeziehungen(relsXml) {
  const map = new Map();
  const re = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(relsXml || '')) !== null) {
    const id = /Id="([^"]*)"/.exec(m[1])?.[1];
    let ziel = /Target="([^"]*)"/.exec(m[1])?.[1];
    if (!id || !ziel) continue;
    ziel = xmlUnesc(ziel).replace(/^\.?\//, '');
    map.set(id, ziel.startsWith('xl/') ? ziel : 'xl/' + ziel);
  }
  return map;
}

/**
 * Ein Arbeitsblatt in ein Zeilenraster übersetzen.
 * Fehlende Zeilen und Zellen werden aufgefüllt, damit Indizes verlässlich sind.
 * @returns {Array<Array<string|number|null>>}
 */
export function leseBlatt(sheetXml, sharedStrings = []) {
  const zeilen = [];
  const reZeile = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let mz;
  while ((mz = reZeile.exec(sheetXml || '')) !== null) {
    const attr = mz[1] || '';
    const inhalt = mz[2] || '';
    const nr = Number(/r="(\d+)"/.exec(attr)?.[1]);
    const index = Number.isFinite(nr) && nr > 0 ? nr - 1 : zeilen.length;
    const zeile = [];
    const reZelle = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let mc;
    while ((mc = reZelle.exec(inhalt)) !== null) {
      const cAttr = mc[1] || '';
      const cInhalt = mc[2] || '';
      const ref = /r="([A-Z]+)\d+"/.exec(cAttr)?.[1];
      const spalte = ref ? buchstabeZuSpalte(ref) : zeile.length;
      const typ = /t="([^"]*)"/.exec(cAttr)?.[1] || 'n';
      let wert = null;
      if (typ === 'inlineStr') {
        let text = '';
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let mt;
        while ((mt = t.exec(cInhalt)) !== null) text += xmlUnesc(mt[1]);
        wert = text;
      } else {
        const roh = /<v>([\s\S]*?)<\/v>/.exec(cInhalt)?.[1];
        if (roh != null) {
          if (typ === 's') wert = sharedStrings[Number(roh)] ?? '';
          else if (typ === 'str' || typ === 'e') wert = xmlUnesc(roh);
          else if (typ === 'b') wert = roh === '1' ? 'ja' : 'nein';
          else { const z = Number(roh); wert = Number.isFinite(z) ? z : xmlUnesc(roh); }
        }
      }
      while (zeile.length < spalte) zeile.push(null);
      zeile[spalte] = wert;
    }
    while (zeilen.length < index) zeilen.push([]);
    zeilen[index] = zeile;
  }
  return zeilen;
}

/**
 * Ganze Mappe aus den entpackten Dateien.
 * @param {(pfad:string)=>(string|null|Promise<string|null>)} lies  liefert den Text eines ZIP-Eintrags
 * @returns {Promise<{blaetter: Record<string, Array<Array<string|number|null>>>, namen: string[]}>}
 */
export async function xlsxLesen(lies) {
  const workbookXml = await lies('xl/workbook.xml');
  if (!workbookXml) throw new Error('Keine Excel-Datei: xl/workbook.xml fehlt.');
  const rels = leseBeziehungen(await lies('xl/_rels/workbook.xml.rels'));
  const sst = leseSharedStrings(await lies('xl/sharedStrings.xml'));

  const blaetter = {};
  const namen = [];
  for (const { name, rid } of leseBlattListe(workbookXml)) {
    const pfad = rels.get(rid);
    if (!pfad) continue;
    const xml = await lies(pfad);
    if (xml == null) continue;
    namen.push(name);
    blaetter[name] = leseBlatt(xml, sst);
  }
  return { blaetter, namen };
}

/** Gepackte .xlsx über JSZip einlesen. */
export async function xlsxAusBlob(daten, JSZipKlasse) {
  const zip = await new JSZipKlasse().loadAsync(daten);
  return xlsxLesen(pfad => {
    const eintrag = zip.file(pfad);
    return eintrag ? eintrag.async('string') : null;
  });
}
