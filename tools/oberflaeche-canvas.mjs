// tools/oberflaeche-canvas.mjs — stellt fest eingetragene Canvas-Farben auf Design-Tokens um.
//
// Hintergrund: Die Diagramme waren für dunklen Grund gezeichnet (Hintergrund #13151f,
// Gitter rgba(255,255,255,.06), helle Beschriftung, Mono-Schrift). Auf hellem LKEBw-Grund
// ergibt das dunkle Kästen und unlesbare Texte. Das Skript ersetzt neutrale Farbwerte in
// JS-Zeichenketten durch Aufrufe aus src/lib/canvas-farben.js, die die Tokens beim Zeichnen
// lesen. Bunte Reihenfarben (#4fc3f7, #ef5350 …) und Schwarz bleiben unverändert.
// Gearbeitet wird auf dem Syntaxbaum (acorn): HTML in Vorlagen-Strings wird nicht berührt,
// außer der Mono-Schrift in ctx.font-Angaben.
//
//   node tools/oberflaeche-canvas.mjs           → Vorschau (zählt, listet #fff-Stellen)
//   node tools/oberflaeche-canvas.mjs --write   → Dateien schreiben
//   NUR=src/a.js node tools/oberflaeche-canvas.mjs  → nur diese Dateien

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

// Dateien mit Bildschirm-Diagrammen. Papier/Export (17, 18, 19, 27, 34, 47, 05a/d/e, 13f)
// und die 3D-/Kartenzeichnung bleiben draußen.
// 03a/04a sind ausgelassen: dort stehen Kartensymbole (weiß auf Farbe) und Karten-Popups.
const DATEIEN = [
  '04b-emissionen-3d', '05c-sankey', '06a-gbi-lastgang',
  '07a-analysis-charts', '07b-analysis-economics', '08-calc-engine', '09c-pv-charts-opt',
  '09d-pv-analyse', '10b-hourly-live', '10d-optimizer-worker', '13e-assets-inspector',
  '13o-nap-analyse', '13r-knotenpunkt-analyse', '31-autarkieziel', '42-speicher-analyse',
  '43-gebaeude-analyse', '44-quartier-sonde', '45-varianten-grafik', '46-heizzentralen',
  '48-datenanalyse',
].map(n => `src/${n}.js`);

// Funktionen, deren Quelltext per toString() in einen Worker wandert — dort gibt es
// keine Tokens und keinen Import. 10d: alles vor _optRenderBarChart ist Worker-Code.
const WORKER_FUNKTIONEN = new Set(['_buildOptWorkerCode', '_calcKostenShared', '_dispatchCore']);

// Funktionen für Papier/Export oder Kartensymbole innerhalb der Diagrammdateien — dort
// sind helle Töne Hintergründe bzw. Weiß auf farbigem Grund gemeint.
// themaFarben (48) liest die Tokens bereits selbst.
const AUSGENOMMEN = new Set(['napExportPDF', 'themaFarben', ...(process.env.AUSGENOMMEN || '').split(',').filter(Boolean)]);

// #fff-Stellen, die bewusst weiß bleiben (Umrandung von Punkten, Text auf farbiger Fläche).
// Schlüssel: "datei:zeile". Wird nach Durchsicht der Vorschau gepflegt.
// Stand 16.10.2026 (Zeilen nach dem ersten Lauf, also mit Importzeile): Treemap-Beschriftung
// (07a) und Zahl im Markerkreis (09d). Zeilennummern bei weiteren Läufen nachziehen.
const WEISS_BLEIBT = new Set([
  'src/07a-analysis-charts.js:1524', 'src/09d-pv-analyse.js:3712',
  ...(process.env.WEISS_BLEIBT || '').split(',').filter(Boolean),
]);

function dateien() {
  if (process.env.NUR) return process.env.NUR.split(',');
  return DATEIEN;
}

// ── Farbklassifikation ─────────────────────────────────────────────────
function parseFarbe(s) {
  s = s.trim().toLowerCase();
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1, hex: true };
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1, hex: true };
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4], hex: false };
  return null;
}

/** Ersatzausdruck für eine neutrale Farbe oder null (unverändert lassen). */
function ersatz(wert) {
  const f = parseFarbe(wert);
  if (!f) return null;
  const { r, g, b, a } = f;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (max === 0) return null;                                  // Schwarz bleibt (Schatten)
  // Helle, neutrale Schleier/Linien/Texte für dunklen Grund → Tinte mit Deckkraft
  if (a < 1) {
    if (min >= 170 && sat < 0.15) return { expr: `cvInk(${a})`, fn: 'cvInk', art: 'ink' };
    // dunkle (nicht schwarze) Schleier als Diagrammgrund → helle Fläche
    if (max < 60 && a >= 0.3) return { expr: `cvTok('surface2')`, fn: 'cvTok', art: 'schleier' };
    return null;
  }
  // Dunkle Flächen (auch bläulich) → Kartenfläche bzw. Linie
  if (max < 90 && L < 60) {
    if (L < 40) return { expr: `cvTok('surface')`, fn: 'cvTok', art: 'flaeche' };
    return { expr: `cvTok('border')`, fn: 'cvTok', art: 'linie' };
  }
  if (sat >= 0.15) return null;                                // bunte Farben bleiben
  if (L >= 250) return { expr: `cvTok('text')`, fn: 'cvTok', art: 'weiss' };
  if (L >= 215) return { expr: `cvTok('text')`, fn: 'cvTok', art: 'hell' };
  if (L >= 150) return { expr: `cvTok('muted')`, fn: 'cvTok', art: 'hell' };
  if (L >= 120) return { expr: `cvTok('faint')`, fn: 'cvTok', art: 'grau' };
  if (L >= 70) return { expr: `cvTok('line-2')`, fn: 'cvTok', art: 'grau' };
  return { expr: `cvTok('border')`, fn: 'cvTok', art: 'linie' };
}

const MONO = /(?:"DM Mono"|'DM Mono'|DM Mono)\s*,\s*monospace|(?:"DM Mono"|'DM Mono')|\bmonospace\b/g;
const SCHRIFT_ANGABE = /\d+(?:\.\d+)?px\s/;   // sieht nach ctx.font aus

// ── Baum durchlaufen ───────────────────────────────────────────────────
function besuchen(node, cb, stapel = []) {
  if (!node || typeof node.type !== 'string') return;
  const istFn = /Function/.test(node.type);
  const p = node.parent;
  const name = istFn ? (node.id?.name
    || (p?.type === 'VariableDeclarator' && p.id?.name)
    || ((p?.type === 'Property' || p?.type === 'MethodDefinition') && (p.key?.name || p.key?.value))
    || (p?.type === 'AssignmentExpression' && (p.left?.property?.name || p.left?.name))
    || '') : null;
  cb(node, stapel);
  const neu = istFn ? [...stapel, name] : stapel;
  for (const k of Object.keys(node)) {
    if (k === 'parent') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(x => x && typeof x.type === 'string' && (x.parent = node, besuchen(x, cb, neu)));
    else if (v && typeof v.type === 'string') { v.parent = node; besuchen(v, cb, neu); }
  }
}

function zeile(src, pos) { return src.slice(0, pos).split('\n').length; }

const summe = { dateien: 0, ersetzungen: 0, schrift: 0 };
const weissListe = [];

for (const rel of dateien()) {
  const datei = path.join(ROOT, rel);
  const src = fs.readFileSync(datei, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const aenderungen = [];   // { start, end, text }
  const fns = new Set();
  let oben = 0;
  const art = {};

  besuchen(ast, (node, stapel) => {
    if (stapel.some(n => WORKER_FUNKTIONEN.has(n))) return;
    // Zeichenketten-Literal
    if (node.type === 'Literal' && typeof node.value === 'string') {
      const p = node.parent;
      if (p && (p.type === 'ImportDeclaration' || p.type === 'ExportNamedDeclaration' || p.type === 'ExportAllDeclaration')) return;
      if (p && p.type === 'Property' && p.key === node) return;
      const e = ersatz(node.value);
      if (e) {
        const z = zeile(src, node.start);
        if (e.art === 'weiss') {
          const ctxZeile = src.split('\n')[z - 1].trim().slice(0, 150);
          weissListe.push(`${rel}:${z}  ${ctxZeile}`);
          if (WEISS_BLEIBT.has(`${rel}:${z}`)) return;
        }
        if (AUSGENOMMEN.has(stapel.filter(Boolean).at(-1)) || stapel.some(n => AUSGENOMMEN.has(n))) return;
        if (process.env.LISTE && e.art !== 'ink') {
          console.log(`  ${rel}:${zeile(src, node.start)}  [${stapel.filter(Boolean).at(-1) || '-'}]  ${node.value} → ${e.expr}`);
        }
        aenderungen.push({ start: node.start, end: node.end, text: e.expr });
        fns.add(e.fn);
        art[e.art] = (art[e.art] || 0) + 1;
        if (!stapel.length) oben++;
        return;
      }
      if (SCHRIFT_ANGABE.test(node.value) && MONO.test(node.value)) {
        MONO.lastIndex = 0;
        const neu = node.value.replace(MONO, '"Source Sans 3","Segoe UI",Tahoma,sans-serif');
        aenderungen.push({ start: node.start, end: node.end, text: JSON.stringify(neu).replace(/^"|"$/g, "'").replace(/\\"/g, '"') });
        summe.schrift++;
      }
      MONO.lastIndex = 0;
      return;
    }
    // Vorlage `rgba(255,255,255,${a})` → cvInk(a)
    if (node.type === 'TemplateLiteral' && node.expressions.length === 1) {
      const vor = node.quasis[0].value.cooked.replace(/\s+/g, '');
      const nach = node.quasis[1].value.cooked.replace(/\s+/g, '');
      if (/^rgba\((2[0-5]\d|1[7-9]\d),\1,\1,$/.test(vor) && nach === ')') {
        const ausdruck = src.slice(node.expressions[0].start, node.expressions[0].end);
        aenderungen.push({ start: node.start, end: node.end, text: `cvInk(${ausdruck})` });
        fns.add('cvInk');
        art.ink = (art.ink || 0) + 1;
        return;
      }
    }
    // ctx.font-Vorlagen mit Mono-Schrift: nur die Schriftfamilie tauschen
    if (node.type === 'TemplateElement') {
      const roh = node.value.raw;
      if (/px\s*(?:"DM Mono"|'DM Mono'|DM Mono|monospace)/.test(roh) || /^\s*(?:"DM Mono"|'DM Mono')\s*,\s*monospace/.test(roh)) {
        MONO.lastIndex = 0;
        aenderungen.push({ start: node.start, end: node.end, text: roh.replace(MONO, '"Source Sans 3","Segoe UI",Tahoma,sans-serif') });
        summe.schrift++;
      }
      MONO.lastIndex = 0;
    }
  });

  // Verkettung 'rgba(255,255,255,' + a + ')' → cvInk(a)
  const verkettung = /(['"])rgba\(\s*(25[0-5]|2[0-4]\d|1[7-9]\d)\s*,\s*\2\s*,\s*\2\s*,\s*\1\s*\+\s*([^+]+?)\s*\+\s*(['"])\)\4/g;
  let m;
  while ((m = verkettung.exec(src))) {
    const ueberlappt = aenderungen.some(a => a.start < m.index + m[0].length && a.end > m.index);
    if (ueberlappt) continue;
    aenderungen.push({ start: m.index, end: m.index + m[0].length, text: `cvInk(${m[3]})` });
    fns.add('cvInk');
    art.ink = (art.ink || 0) + 1;
  }

  if (!aenderungen.length) continue;
  aenderungen.sort((a, b) => b.start - a.start);
  let out = src;
  for (const a of aenderungen) out = out.slice(0, a.start) + a.text + out.slice(a.end);

  // Import ergänzen bzw. erweitern
  if (fns.size) {
    const namen = [...fns].sort();
    const vorhanden = out.match(/^import \{([^}]*)\} from '\.\/lib\/canvas-farben\.js';\n/m);
    if (vorhanden) {
      const alle = [...new Set([...vorhanden[1].split(',').map(s => s.trim()).filter(Boolean), ...namen])].sort();
      out = out.replace(vorhanden[0], `import { ${alle.join(', ')} } from './lib/canvas-farben.js';\n`);
    } else {
      const imports = [...out.matchAll(/^import [^;]+;\n/gm)];
      const zeileImport = `import { ${namen.join(', ')} } from './lib/canvas-farben.js';\n`;
      if (imports.length) {
        const letzter = imports[imports.length - 1];
        const pos = letzter.index + letzter[0].length;
        out = out.slice(0, pos) + zeileImport + out.slice(pos);
      } else {
        // nach dem Kopfkommentar einfügen
        const kopf = out.match(/^(?:\/\/[^\n]*\n|\s*\n)*/)[0];
        out = kopf + zeileImport + out.slice(kopf.length);
      }
    }
  }

  summe.dateien++;
  summe.ersetzungen += aenderungen.length;
  console.log(`${rel.padEnd(34)} ${String(aenderungen.length).padStart(4)}  ${JSON.stringify(art)}${oben ? `  (${oben} auf Modulebene)` : ''}`);
  if (WRITE) fs.writeFileSync(datei, out);
}

console.log(`\n${summe.dateien} Dateien, ${summe.ersetzungen} Ersetzungen (davon ${summe.schrift} Schriftangaben)${WRITE ? ' — geschrieben' : ' — Vorschau, --write schreibt'}`);
if (weissListe.length) {
  console.log(`\n#fff-Stellen (werden zu Schriftfarbe; Ausnahmen per WEISS_BLEIBT=datei:zeile,…):`);
  console.log(weissListe.join('\n'));
}
