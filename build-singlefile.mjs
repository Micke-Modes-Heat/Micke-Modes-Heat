// Build: derselbe kanonische ESM-Einstieg wie im Entwicklungsmodus wird durch
// Rollup geparst und als eine offline-fähige HTML-Datei ausgeliefert.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const SRC = resolve('src');
const dist = resolve('dist');
mkdirSync(dist, { recursive: true });

// Technische Version für Exporte/Diagnose sowie sichtbarer Stand des aktuell
// ausgecheckten Commits. Auf Netlify entspricht das dem ausgelieferten Push.
const APP_VERSION = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version || '0.0.0';
const sourceEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH || '', 10);
const buildInstant = Number.isFinite(sourceEpoch) ? new Date(sourceEpoch * 1000) : new Date();
const BUILD_DATE = buildInstant.toISOString().slice(0, 10);
const gitValue = (args, fallback) => {
  try { return execFileSync('git',args,{encoding:'utf8'}).trim() || fallback; }
  catch { return fallback; }
};
const RELEASE_DATE = gitValue(['show','-s','--format=%cs','HEAD'],BUILD_DATE);
const localGitHead = () => {
  try {
    const head=readFileSync(resolve('.git','HEAD'),'utf8').trim();
    const full=head.startsWith('ref: ')
      ? readFileSync(resolve('.git',head.slice(5)),'utf8').trim()
      : head;
    return full.slice(0,7);
  } catch { return ''; }
};
const COMMIT_SHA = (process.env.COMMIT_REF || gitValue(['rev-parse','--short','HEAD'],localGitHead())).slice(0,7);

// 1. Lokale Vorläufer und der kanonisch gebündelte Anwendungseinstieg
let jsAll = '';

// PDF-Worker ebenfalls einbetten; 03b erzeugt daraus bei Bedarf eine Blob-URL.
const pdfWorkerPath = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
if (existsSync(pdfWorkerPath)) {
  const workerCode = readFileSync(pdfWorkerPath, 'utf8').replace(/<\/script/gi, '<\\/script');
  jsAll += `window.__PDF_WORKER_CODE__ = ${JSON.stringify(workerCode)};\n`;
}

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

jsAll += 'window._isSingleFileBuild = true;\n';
const appBundle = await rollup({
  input: join(SRC, 'main.js'),
  plugins: [nodeResolve({browser: true})],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
});
const appGenerated = await appBundle.generate({
  format: 'iife',
  name: 'MickeHeatApp',
  inlineDynamicImports: true,
  sourcemap: false,
});
await appBundle.close();
const appCode = appGenerated.output.find(chunk => chunk.type === 'chunk')?.code;
if (!appCode) throw new Error('Anwendung konnte nicht kanonisch gebündelt werden');
jsAll += `${appCode}\n`;

// 2. CSS lesen
const cssCode = readFileSync(join(SRC, 'styles', 'app.css'), 'utf8');

// Inline-Favicon: SVG muss URL-encodiert sein, da < und > in HTML-Attributen den Parser brechen
// (unencoded <svg> im href → leerer href → Browser lädt aktuelle Seite → Unsafe attempt + ERR_FILE_NOT_FOUND)
const FAVICON = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ctext y=\'.9em\' font-size=\'90\'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E">';

// Leaflet-Icon-Fix: verhindert "Unsafe attempt"-Fehler durch relative Marker-Bild-URLs
const LEAFLET_ICON_FIX = `
<script>
// Kleine eingebettete Marker statt relativer/CDN-Bilddateien.
if (typeof L !== 'undefined') {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41"%3E%3Cpath fill="%234fc3f7" stroke="%23111" d="M12.5 1C6 1 1 6 1 12.5 1 22 12.5 40 12.5 40S24 22 24 12.5C24 6 19 1 12.5 1z"/%3E%3Ccircle cx="12.5" cy="12.5" r="4" fill="white"/%3E%3C/svg%3E',
    iconRetinaUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41"%3E%3Cpath fill="%234fc3f7" stroke="%23111" d="M12.5 1C6 1 1 6 1 12.5 1 22 12.5 40 12.5 40S24 22 24 12.5C24 6 19 1 12.5 1z"/%3E%3Ccircle cx="12.5" cy="12.5" r="4" fill="white"/%3E%3C/svg%3E',
    shadowUrl: '',
  });
}
</script>`;

// 3. Quell-HTML lesen und aufbereiten
const srcHtml = readFileSync(resolve('index.html'), 'utf8');
let html = srcHtml
  .replace(/<link[^>]*app\.css[^>]*\/?>/, () => `<style>${cssCode}</style>`)
  .replace(/<script type="module"[^>]*>.*?<\/script>/, '')
  .replace('</title>', `</title>\n${FAVICON}`);

// Alle UI-Laufzeitbibliotheken aus package-lock-gebundenen lokalen Paketen
// einbetten. Der fertige Doppelklick-Build lädt keinen ausführbaren CDN-Code.
const inlineVendor = [
  {pattern:/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"[\s\S]*?\/>/, path:'node_modules/leaflet/dist/leaflet.css', kind:'css'},
  {pattern:/<script src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js"[\s\S]*?<\/script>/, path:'node_modules/leaflet/dist/leaflet.js', kind:'js'},
  {pattern:/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jszip\/3\.10\.1\/jszip\.min\.js"[\s\S]*?<\/script>/, path:'node_modules/jszip/dist/jszip.min.js', kind:'js'},
  {pattern:/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet-toolbar[^>]*>/, path:'node_modules/leaflet-toolbar/dist/leaflet.toolbar.css', kind:'css'},
  {pattern:/<script src="https:\/\/unpkg\.com\/leaflet-toolbar[^>]*><\/script>/, path:'node_modules/leaflet-toolbar/dist/leaflet.toolbar.js', kind:'js'},
  {pattern:/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet-distortableimage[^>]*>/, path:'node_modules/leaflet-distortableimage/dist/leaflet.distortableimage.css', kind:'css'},
  {pattern:/<script src="https:\/\/unpkg\.com\/leaflet-distortableimage[^>]*><\/script>/, path:'node_modules/leaflet-distortableimage/dist/leaflet.distortableimage.js', kind:'js'},
];
for (const vendor of inlineVendor) {
  if (!existsSync(resolve(vendor.path))) throw new Error(`Vendor-Datei fehlt: ${vendor.path}`);
  const code = readFileSync(resolve(vendor.path), 'utf8');
  html = html.replace(vendor.pattern, () => vendor.kind === 'css' ? `<style>${code}</style>` : `<script>${code}</script>`);
}
// PDF.js ist bereits Teil des kanonischen main.js-Bundles.
html = html.replace(/<!-- PDFJS_LOCAL_BUNDLE:[\s\S]*?-->/, '');
html = html.replace('</head>', `${LEAFLET_ICON_FIX}\n</head>`);

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
  .replace(/__BUILD_DATE__/g, RELEASE_DATE)
  .replace(/__COMMIT_SHA__/g, COMMIT_SHA);

// 5. Schreiben
writeFileSync(join(dist, 'index.html'), html);

const size = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Einzeldatei: dist/index.html (${size} KB, ${klimaCount} Klima-Städte eingebettet)`);
