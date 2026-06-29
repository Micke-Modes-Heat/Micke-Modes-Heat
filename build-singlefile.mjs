// Build: Quell-Module + HTML + CSS → eine einzige HTML-Datei für Doppelklick
// Kein Rollup/Vite nötig — alle JS-Dateien werden direkt in einen <script>-Block
// zusammengefügt, genau wie im originalen Index.html.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { getExportNames } from './tools/export-names.mjs';

const SRC = resolve('src');
const dist = resolve('dist');
mkdirSync(dist, { recursive: true });

// Version + Build-Datum aus package.json → werden unten in die HTML injiziert
// (Platzhalter __APP_VERSION__ / __BUILD_DATE__ im index.html-Quelltext)
const APP_VERSION = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version || '0.0.0';
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// Reihenfolge wie im Original — Konfiguration zuerst, dann numerisch
const JS_FILES = [
  'config/netz-kosten.js',
  'config/massnahmen-vorlagen.js',
  'config/erzeuger-cfg.js',
  'config/optimizer-defaults.js',
  'config/hilfe-texte.js',
  'lib/elektro-formeln.js',      // ← Shared lib: muss vor 05b und 13g stehen
  'lib/physik-konstanten.js',    // ← DAYS_PER_YEAR/HOURS_PER_YEAR: u.a. 04b, 05b, 05c, 06c
  'lib/util.js',                 // ← readNum/clampNum: u.a. 06b
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
  '05d-bericht.js',
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
  '09d-pv-analyse.js',
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
  '13i-slp-editor.js',
  '13j-autofill-wizard.js',
  '13k-elslp-registry.js',
  '13l-autonetz.js',
  '13m-kompaktstation.js',
  '13n-elektro-panel.js',
  '13o-nap-analyse.js',
  '13p-erzeuger-assets.js',
  '13r-knotenpunkt-analyse.js',
  '14a-kandidaten.js',
  '14b-ertuechtigung.js',
  '14c-phasen.js',
  // main.js wird NICHT eingebunden — es macht nur import/window-Exposition,
  // die im Monolith überflüssig ist (alles bereits global). Der Namespace-
  // Alias "glBerechnen" würde die private Funktion gleichen Namens überschreiben.
];

// ── Wächter: keine src-Datei darf in JS_FILES fehlen ────────────────────────
// Vergessene Dateien führten bereits 3× zu "function X is not defined" in
// dist/index.html (lib/util.js, lib/physik-konstanten.js, 13p-erzeuger-assets.js).
// Der Build bricht ab, statt stillschweigend eine kaputte Datei zu erzeugen.
{
  const istJsDatei = f => f.endsWith('.js') && !f.endsWith('.d.ts');
  const alleSrcJs = [];
  const sammle = (dir, prefix) => {
    for (const f of readdirSync(join(SRC, dir))) {
      const rel = dir ? `${dir}/${f}` : f;
      if (statSync(join(SRC, rel)).isDirectory()) {
        if (f !== 'styles') sammle(rel, prefix);
      } else if (istJsDatei(f)) {
        alleSrcJs.push(rel);
      }
    }
  };
  sammle('', '');
  const AUSNAHMEN = ['main.js']; // main.js macht nur import/window-Exposition
  const fehltImBuild = alleSrcJs.filter(f => !JS_FILES.includes(f) && !AUSNAHMEN.includes(f));
  const fehltAufPlatte = JS_FILES.filter(f => !alleSrcJs.includes(f));
  if (fehltImBuild.length || fehltAufPlatte.length) {
    if (fehltImBuild.length)
      console.error('✗ BUILD ABGEBROCHEN — diese src-Dateien fehlen in JS_FILES (build-singlefile.mjs):\n  ' + fehltImBuild.join('\n  '));
    if (fehltAufPlatte.length)
      console.error('✗ BUILD ABGEBROCHEN — diese JS_FILES-Einträge existieren nicht in src/:\n  ' + fehltAufPlatte.join('\n  '));
    process.exit(1);
  }
}

// Vorab alle Export-Namen je Datei sammeln (für import * as X → var X = {...})
// getExportNames kommt aus tools/export-names.mjs (erfasst Mehrfach-Deklarationen)

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
  // ── Schritt 1: "import * as X from './Y'" → synthetisches Namespace-Objekt ──
  code = code.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/gm,
    (_, alias, fromPath) => {
      const names = exportMap[fromPath] || exportMap['./' + fromPath.split('/').pop()] || [];
      return names.length ? `var ${alias} = { ${names.join(', ')} };` : '';
    }
  );

  // ── Schritt 2: alle import-Anweisungen entfernen (auch mehrzeilig) ──
  // Mehrzeilig: "import {\n  a, b\n} from './x'"
  code = code.replace(/^import\s[\s\S]*?from\s*['"][^'"]*['"]\s*;?\n?/gm, '');
  // Bare side-effect imports: import './x.js'
  code = code.replace(/^import\s+['"][^'"]+['"]\s*;?\n?/gm, '');

  // ── Schritt 3: export-Transformationen + let/const → var (zeilenweise) ──
  return code
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('export async function ')) return line.replace('export async function ', 'async function ');
      if (trimmed.startsWith('export function '))       return line.replace('export function ', 'function ');
      if (trimmed.startsWith('export const '))          return line.replace('export const ', 'var ');
      if (trimmed.startsWith('export let '))            return line.replace('export let ',   'var ');
      if (trimmed.startsWith('export var '))            return line.replace('export var ',   'var ');
      if (trimmed.startsWith('export {'))               return '';
      if (trimmed.startsWith('export default '))        return '';
      if (line.startsWith('let '))   return 'var ' + line.slice(4);
      if (line.startsWith('const ')) return 'var ' + line.slice(6);
      return line;
    })
    .join('\n');
}

// 1. Alle JS-Module zusammenfügen
let jsAll = '';

// ── Klimadaten einbetten (data/klima/*.js → window.KLIMA_DATA) ──────────────
// Jede Datei setzt window.KLIMA_DATA['Stadt'] = {...}. Vorangestellt, damit die
// stündlichen DWD-Temperaturprofile auch im Single-File-Build/Testlink verfügbar
// sind. Ohne sie fällt glGetTempH() für JEDE Stadt auf TRY Kassel zurück.
let klimaCount = 0;
const klimaDir = resolve('data', 'klima');
if (existsSync(klimaDir)) {
  jsAll += '// ── Eingebettete Klimadaten (data/klima/) ──\n';
  for (const f of readdirSync(klimaDir).filter(n => n.endsWith('.js')).sort()) {
    jsAll += readFileSync(join(klimaDir, f), 'utf8') + '\n';
    klimaCount++;
  }
  jsAll += '\n';
} else {
  console.warn('⚠ data/klima/ nicht gefunden — Single-File-Build nutzt TRY-Kassel-Fallback für alle Städte.');
}

for (const file of JS_FILES) {
  const raw = readFileSync(join(SRC, file), 'utf8');
  jsAll += `// ── ${file} ──\n` + stripModule(raw) + '\n\n';
}

// BDEW-Initialisierung (ersetzt den main.js-Aufruf)
jsAll += `
// ── Initialisierung (aus main.js) ──
window._isSingleFileBuild = true; // verhindert data/klima/-Dateiladen (kein Verzeichnis im Build)
if (typeof initBdewProfiles === 'function') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { initBdewProfiles(); });
  } else {
    initBdewProfiles();
  }
}
`;

// 2. CSS lesen
const cssCode = readFileSync(join(SRC, 'styles', 'app.css'), 'utf8');

// Inline-Favicon: SVG muss URL-encodiert sein, da < und > in HTML-Attributen den Parser brechen
// (unencoded <svg> im href → leerer href → Browser lädt aktuelle Seite → Unsafe attempt + ERR_FILE_NOT_FOUND)
const FAVICON = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ctext y=\'.9em\' font-size=\'90\'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E">';

// Leaflet-Icon-Fix: verhindert "Unsafe attempt"-Fehler durch relative Marker-Bild-URLs
const LEAFLET_ICON_FIX = `
<script>
// Leaflet-Marker-Icons aus CDN explizit setzen, damit keine relative file://-URL entsteht
if (typeof L !== 'undefined') {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}
</script>`;

// 3. Quell-HTML lesen und aufbereiten
const srcHtml = readFileSync(resolve('index.html'), 'utf8');
let html = srcHtml
  .replace(/<link[^>]*app\.css[^>]*\/?>/, () => `<style>${cssCode}</style>`)
  .replace(/<script type="module"[^>]*>.*?<\/script>/, '')
  .replace('</title>', `</title>\n${FAVICON}`);

// Leaflet-Icon-Fix direkt nach dem Leaflet-Script-Tag einfügen
html = html.replace(
  /(<script src="https:\/\/unpkg\.com\/leaflet[^>]*><\/script>)/,
  `$1${LEAFLET_ICON_FIX}`
);

// html2canvas CDN-Tag durch lokal eingebettete Version ersetzen (für Offline/file://)
const html2canvasPath = resolve('html2canvas.min.js');
if (existsSync(html2canvasPath)) {
  const h2cCode = readFileSync(html2canvasPath, 'utf8');
  html = html.replace(
    /<script src="https:\/\/unpkg\.com\/html2canvas[^"]*"[^>]*><\/script>/,
    `<script>${h2cCode}</script>`
  );
  console.log('html2canvas eingebettet (offline-fähig)');
} else {
  console.warn('WARNUNG: html2canvas.min.js nicht gefunden – Screenshot im Feedback funktioniert nur online.');
}

// 4. JS-Code vor </body> einfügen (ein einziger <script>-Block, kein type="module")
const bodyIdx = html.lastIndexOf('</body>');
html = html.substring(0, bodyIdx)
  + `<script>\n${jsAll}</script>\n</body>`
  + html.substring(bodyIdx + 7);

// 4b. Version + Build-Datum injizieren (Platzhalter aus index.html-Inline-Script)
html = html
  .replace(/__APP_VERSION__/g, APP_VERSION)
  .replace(/__BUILD_DATE__/g, BUILD_DATE);

// 5. Schreiben
writeFileSync(join(dist, 'index.html'), html);

const size = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Einzeldatei: dist/index.html (${size} KB, ${klimaCount} Klima-Städte eingebettet)`);
