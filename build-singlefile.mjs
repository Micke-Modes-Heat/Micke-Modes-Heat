// Build: Quell-Module + HTML + CSS → eine einzige HTML-Datei für Doppelklick
// Kein Rollup/Vite nötig — alle JS-Dateien werden direkt in einen <script>-Block
// zusammengefügt, genau wie im originalen Index.html.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const SRC = resolve('src');
const dist = resolve('dist');
mkdirSync(dist, { recursive: true });

// Reihenfolge wie im Original — Konfiguration zuerst, dann numerisch
const JS_FILES = [
  'config/netz-kosten.js',
  'config/erzeuger-cfg.js',
  'config/optimizer-defaults.js',
  'config/hilfe-texte.js',
  'lib/elektro-formeln.js',      // ← Shared lib: muss vor 05b und 13g stehen
  '01-globals-varianten.js',
  '02a-netz-physik.js',
  '02b-gebaeude.js',
  '02c-karte-werkzeuge.js',
  '03a-erzeuger.js',
  '03b-netz.js',
  '03c-gebaeude-io.js',
  '04a-ui-panels.js',
  '04b-emissionen-3d.js',
  '05a-export.js',
  '05b-stromnetz.js',
  '05c-sankey.js',
  '06a-gbi-lastgang.js',
  '06b-gl-berechnen.js',
  '06c-dispatch-core.js',
  '07a-analysis-charts.js',
  '07b-analysis-economics.js',
  '08-calc-engine.js',
  '09a-pv-profile.js',
  '09b-pv-calc.js',
  '09c-pv-charts-opt.js',
  '10a-optimizer-core.js',
  '10b-hourly-live.js',
  '10c-optimizer-run.js',
  '10d-optimizer-worker.js',
  '11-hilfe-leitfaden.js',
  '12-inline-handlers.js',
  '13a-assets-core.js',
  '13b-assets-render.js',
  '13c-assets-ui.js',
  '13d-assets-autocreate.js',
  '13e-assets-inspector.js',
  '13f-sld.js',
  '13g-ms-ring.js',
  '13h-netzanalyse.js',
  'main.js',                     // ← window.*-Exposition zuletzt
];

// Vorab alle Export-Namen je Datei sammeln (für import * as X → var X = {...})
function getExportNames(code) {
  const names = [];
  for (const line of code.split('\n')) {
    const t = line.trimStart();
    let m;
    if ((m = t.match(/^export\s+(?:async\s+)?function\s+(\w+)/))) names.push(m[1]);
    if ((m = t.match(/^export\s+(?:const|let|var)\s+(\w+)/))) names.push(m[1]);
  }
  return names;
}

// Map: relativer Pfad (wie im import-Statement) → Liste der Export-Namen
const exportMap = {};
for (const file of JS_FILES) {
  const raw = readFileSync(join(SRC, file), 'utf8');
  // Schlüssel so normalisieren, wie er in import-Statements auftaucht (./ + Pfad)
  exportMap['./' + file] = getExportNames(raw);
  // Kurzform ohne führendes Verzeichnis für Dateien im selben Ordner
  const baseName = file.split('/').pop();
  exportMap['./' + baseName] = exportMap['./' + file];
}

// Jede Datei lesen, import/export entfernen
// let/const → var, damit alle Variablen als window.* Properties verfügbar sind
// (viele Module lesen Zustand über window.gebaeude, window.netzEdges, etc.)
function stripModule(code) {
  return code
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart();
      // "import * as X from './Y.js'" → synthetisches Namespace-Objekt var X = { a, b, ... }
      let m;
      if ((m = trimmed.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/))) {
        const alias = m[1];
        const fromPath = m[2];
        const names = exportMap[fromPath] || exportMap['./' + fromPath.split('/').pop()] || [];
        if (names.length) return `var ${alias} = { ${names.join(', ')} };`;
        return '';
      }
      // import-Zeilen komplett entfernen
      if (trimmed.startsWith('import ')) return '';
      // "export function" / "export async function" → "function" / "async function"
      if (trimmed.startsWith('export async function ')) return line.replace('export async function ', 'async function ');
      if (trimmed.startsWith('export function ')) return line.replace('export function ', 'function ');
      // "export const/let/var" → "var" (window-Property nötig)
      if (trimmed.startsWith('export const ')) return line.replace('export const ', 'var ');
      if (trimmed.startsWith('export let '))   return line.replace('export let ',   'var ');
      if (trimmed.startsWith('export var '))   return line.replace('export var ',   'var ');
      // "export {" / "export default" → entfernen
      if (trimmed.startsWith('export {'))       return '';
      if (trimmed.startsWith('export default ')) return '';
      // Top-level (keine Einrückung) let/const → var, damit Mehrfachdeklarationen kein SyntaxError
      if (line.startsWith('let '))   return 'var ' + line.slice(4);
      if (line.startsWith('const ')) return 'var ' + line.slice(6);
      return line;
    })
    .join('\n');
}

// 1. Alle JS-Module zusammenfügen
let jsAll = '';
for (const file of JS_FILES) {
  const raw = readFileSync(join(SRC, file), 'utf8');
  jsAll += `// ── ${file} ──\n` + stripModule(raw) + '\n\n';
}

// 2. CSS lesen
const cssCode = readFileSync(join(SRC, 'styles', 'app.css'), 'utf8');

// 3. Quell-HTML lesen und aufbereiten
const srcHtml = readFileSync(resolve('index.html'), 'utf8');
let html = srcHtml
  .replace(/<link[^>]*app\.css[^>]*\/?>/, () => `<style>${cssCode}</style>`)
  .replace(/<script type="module"[^>]*>.*?<\/script>/, '');

// 4. JS-Code vor </body> einfügen (ein einziger <script>-Block, kein type="module")
const bodyIdx = html.lastIndexOf('</body>');
html = html.substring(0, bodyIdx)
  + `<script>\n${jsAll}</script>\n</body>`
  + html.substring(bodyIdx + 7);

// 5. Schreiben
writeFileSync(join(dist, 'index.html'), html);

const size = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Einzeldatei: dist/index.html (${size} KB)`);
