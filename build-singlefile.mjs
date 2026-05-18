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
  'config/kostenkomponenten-cfg.js',
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
  '05d-export-xlsx.js',
  '06a-gbi-lastgang.js',
  '06b-gl-berechnen.js',
  '06c-dispatch-core.js',
  '06d-waerme-heatmap.js',
  '07a-analysis-charts.js',
  '07b-analysis-economics.js',
  '07c-wirtschaft-tab.js',
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
  // Phase-3: Assets, Stromnetz, Fotos — vor 11.5.2026 nicht im Build, daher
  // im Single-File bisher leer/fehlerhaft. Nachgetragen 2026-05-08.
  '13a-assets-core.js',
  '13b-assets-render.js',
  '13c-assets-ui.js',
  '13d-assets-autocreate.js',
  '13e-assets-inspector.js',
  '14a-stromnetz-config.js',
  '14b-stromnetz-state.js',
  '14c-stromnetz-graph.js',
  '15a-stromnetz-render.js',
  '15b-stromnetz-draw.js',
  '15c-stromnetz-calc.js',
  '15d-stromnetz-sld.js',
  '15e-stromnetz-szenarien.js',
  '15f-stromnetz-messlastgang.js',
  '15g-stromnetz-massnahmen.js',
  '15h-stromnetz-invest.js',
  '15i-stromnetz-clustering.js',
  '15j-stromnetz-heatmap.js',
  '15l-stromnetz-trafoopt.js',
  '16-stromnetz-ui.js',
  '16b-stromnetz-selftest.js',
  '17a-fotos-storage.js',
  '17b-fotos-compress.js',
  '17c-fotos-ui.js',
];

// Jede Datei lesen, import/export entfernen
// let/const → var, damit alle Variablen als window.* Properties verfügbar sind
// (viele Module lesen Zustand über window.gebaeude, window.netzEdges, etc.)
function stripModule(code) {
  const lines = code.split('\n');
  const out = [];
  let inMultiLineImport = false;
  let inMultiLineExport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Mehrzeiliger Import: bis Zeile die from '...' oder } enthält + ;
    if (inMultiLineImport) {
      if (/['"]\s*;?\s*$/.test(line) || /\}\s*from\s*['"]/.test(line)) {
        inMultiLineImport = false;
      }
      out.push('');
      continue;
    }
    // Mehrzeiliger Export-Block: export { … }
    if (inMultiLineExport) {
      if (/\}/.test(line)) inMultiLineExport = false;
      out.push('');
      continue;
    }

    // Single-line oder Start eines mehrzeiligen Imports
    if (trimmed.startsWith('import ')) {
      // Wenn die Zeile mit ; endet (oder von '...';) → single-line, fertig.
      // Sonst → mehrzeilig
      if (!/;\s*$/.test(line) && !/from\s+['"][^'"]+['"]\s*;?\s*$/.test(line)) {
        inMultiLineImport = true;
      }
      out.push('');
      continue;
    }

    // export-Variationen
    if (trimmed.startsWith('export async function ')) { out.push(line.replace('export async function ', 'async function ')); continue; }
    if (trimmed.startsWith('export function '))       { out.push(line.replace('export function ', 'function ')); continue; }
    if (trimmed.startsWith('export const '))          { out.push(line.replace('export const ', 'var ')); continue; }
    if (trimmed.startsWith('export let '))            { out.push(line.replace('export let ', 'var ')); continue; }
    if (trimmed.startsWith('export var '))            { out.push(line.replace('export var ', 'var ')); continue; }
    if (trimmed.startsWith('export class '))          { out.push(line.replace('export class ', 'class ')); continue; }
    if (trimmed.startsWith('export default '))        { out.push(line.replace('export default ', '')); continue; }
    if (trimmed.startsWith('export {')) {
      // single-line oder mehrzeilig?
      if (!/\}/.test(trimmed) || !/;?\s*$/.test(line)) {
        inMultiLineExport = true;
      }
      out.push('');
      continue;
    }

    out.push(line);
  }
  return out.join('\n');
}

// 1. Alle JS-Module zusammenfügen
// (Kein IIFE-Wrap pro Modul — Module greifen gegenseitig über globale
// Names zu. Bei doppelter file-scope-let-Deklaration: die Variable in einem
// der Module umbenennen — siehe layerVisible-Fix in 13b und 15a.)
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

// 6b. Klimadaten (DWD-TRY pro Stadt + Jahr) ins dist/data/ kopieren —
//     damit dist self-contained ist (Zip/Mail/Deploy ohne Symlinks).
const parentData = resolve('..', 'data');
const distData   = resolve('dist', 'data');
if (existsSync(parentData)) {
  function _copyDir(src, dst) {
    mkdirSync(dst, { recursive: true });
    let cnt = 0, bytes = 0;
    for (const f of readdirSync(src)) {
      const s = join(src, f);
      const d = join(dst, f);
      const st = statSync(s);
      if (st.isDirectory()) {
        const sub = _copyDir(s, d);
        cnt += sub.cnt; bytes += sub.bytes;
      } else if (st.isFile()) {
        copyFileSync(s, d);
        cnt++; bytes += st.size;
      }
    }
    return { cnt, bytes };
  }
  const { cnt, bytes } = _copyDir(parentData, distData);
  console.log(`Klimadaten kopiert: ${cnt} Dateien nach dist/data/ (${(bytes/1024/1024).toFixed(1)} MB)`);
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
