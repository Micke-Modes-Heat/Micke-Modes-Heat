// Build: Quell-Module + HTML + CSS → eine einzige HTML-Datei für Doppelklick
// Kein Rollup/Vite nötig — alle JS-Dateien werden direkt in einen <script>-Block
// zusammengefügt, genau wie im originalen Index.html.
import { readFileSync, writeFileSync, mkdirSync,
         existsSync, copyFileSync, readdirSync, statSync } from 'fs';
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
];

// Jede Datei lesen, import/export entfernen
// let/const → var, damit alle Variablen als window.* Properties verfügbar sind
// (viele Module lesen Zustand über window.gebaeude, window.netzEdges, etc.)
function stripModule(code) {
  return code
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart();
      // import-Zeilen komplett entfernen
      if (trimmed.startsWith('import ')) return '';
      // "export async function" → "async function"
      if (trimmed.startsWith('export async function ')) return line.replace('export async function ', 'async function ');
      // "export function" → "function"
      if (trimmed.startsWith('export function ')) return line.replace('export function ', 'function ');
      // "export const" → "var" (window-Property nötig)
      if (trimmed.startsWith('export const ')) return line.replace('export const ', 'var ');
      // "export let" → "var" (window-Property nötig)
      if (trimmed.startsWith('export let ')) return line.replace('export let ', 'var ');
      // "export var" → "var"
      if (trimmed.startsWith('export var ')) return line.replace('export var ', 'var ');
      // "export {" → entfernen
      if (trimmed.startsWith('export {')) return '';
      // "export default" → entfernen
      if (trimmed.startsWith('export default ')) return '';
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

// 6. Statische Doku-HTMLs (Berechnungslogik etc.) aus Parent-/docs/
//    nach modular/docs/ und dist/docs/ kopieren — damit der 📐-Button
//    auch im Build funktioniert.
const parentDocs = resolve('..', 'docs');
const localDocs  = resolve('docs');
const distDocs   = resolve('dist', 'docs');
if (existsSync(parentDocs)) {
  mkdirSync(localDocs, { recursive: true });
  mkdirSync(distDocs,  { recursive: true });
  let n = 0;
  for (const f of readdirSync(parentDocs)) {
    const src = join(parentDocs, f);
    if (!statSync(src).isFile() || !f.endsWith('.html')) continue;
    copyFileSync(src, join(localDocs, f));
    copyFileSync(src, join(distDocs,  f));
    n++;
  }
  console.log(`Doku-Dateien synchronisiert: ${n} HTML aus ../docs/`);
}

// 7. Architektur-Doku regenerieren (analysiert src/*.js)
//    + nach dist/docs/ kopieren
import { execSync } from 'child_process';
try {
  execSync('node tools/generate-architecture.mjs', { stdio: 'inherit' });
  if (existsSync(join(localDocs, 'architektur.html'))) {
    copyFileSync(join(localDocs, 'architektur.html'), join(distDocs, 'architektur.html'));
  }
} catch (e) {
  console.warn('Architektur-Generator fehlgeschlagen:', e.message);
}
