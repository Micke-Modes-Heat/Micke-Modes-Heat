// Baut field-app/index.html zu einer einzigen selbst-enthaltenen HTML-Datei.
// Leaflet CSS, Leaflet JS und JSZip werden von den CDN-URLs heruntergeladen
// und direkt in die HTML eingebettet – danach braucht die App kein Internet mehr.
//
// Aufruf: node build-feldapp.mjs
// Ausgabe: dist/feldapp.html            – die App (auch einzeln per Datei nutzbar)
//          dist/feldapp.webmanifest     – macht sie auf dem Handy installierbar
//          dist/feldapp-sw.js           – Service Worker für den Offline-Betrieb
//          dist/feldapp-icon-*.png      – App-Icons
// Die Zusatzdateien wirken nur, wenn dist/ über https ausgeliefert wird
// (Netlify / GitHub Pages). Als einzelne Datei läuft feldapp.html wie bisher.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

const SRC  = resolve('field-app/index.html');
const OUT  = resolve('dist/feldapp.html');

mkdirSync('dist', { recursive: true });

const DEPS = [
  {
    tag: '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">',
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    wrap: (css) => `<style>${css}</style>`,
  },
  {
    tag: '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    wrap: (js) => `<script>${js}</script>`,
  },
  {
    tag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    wrap: (js) => `<script>${js}</script>`,
  },
];

const LOCAL_DEPS = new Map([
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'node_modules/leaflet/dist/leaflet.css'],
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'node_modules/leaflet/dist/leaflet.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'node_modules/jszip/dist/jszip.min.js'],
]);

function loadDependency(url) {
  const local = LOCAL_DEPS.get(url);
  if (!local) throw new Error(`Keine gesperrte lokale Quelle für ${url}`);
  const text = readFileSync(resolve(local), 'utf8');
  console.log(`  Lokal ${local} (${(text.length / 1024).toFixed(0)} KB)`);
  return text;
}

async function build() {
  console.log('=== Feldapp Build ===');

  let html = readFileSync(SRC, 'utf8');

  // Leaflet-Marker-Icons kommen normalerweise aus dem CDN-Pfad;
  // wir überschreiben die Default-Icon-URLs auf leere Platzhalter
  // (die Feldapp nutzt nur CircleMarker + DivIcon, keine Default-Icons).
  html = html.replace(
    '</head>',
    `<script>
// Leaflet Default-Icon-Pfad deaktivieren (keine externen Bild-Requests)
if (typeof L !== 'undefined') {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' });
}
</script>\n</head>`
  );

  for (const dep of DEPS) {
    const content = loadDependency(dep.url);
    // Leaflet inline: Marker-PNG-URLs aus CSS entfernen (würden 404 geben)
    const cleaned = dep.url.includes('leaflet.css')
      ? content.replace(/url\([^)]*images\/marker[^)]*\)/g, 'url()')
      : content;
    html = html.replace(dep.tag, dep.wrap(cleaned));
  }

  // LKEBw-Wortmarke als Data-URI einbetten (die Einzeldatei hat keine Nachbardateien)
  const logo = readFileSync(resolve('field-app/lkebw-logo.png')).toString('base64');
  html = html.split('src="lkebw-logo.png"').join(`src="data:image/png;base64,${logo}"`);

  // Installierbare App: dist/ enthält auch die Hauptapp (index.html). Deshalb
  // bekommen Manifest, Service Worker und Icons eigene Namen, und der Service
  // Worker gilt nur für Adressen, die mit /feldapp beginnen.
  html = mustReplace(html, '<link rel="manifest" href="manifest.json">', '<link rel="manifest" href="feldapp.webmanifest">');
  html = mustReplace(html, "const SW_URL = './sw.js', SW_SCOPE = './';", "const SW_URL = './feldapp-sw.js', SW_SCOPE = './feldapp';");
  html = html.replace('</head>', '  <link rel="apple-touch-icon" href="feldapp-icon-192.png">\n</head>');

  writeFileSync(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);

  // Version = Inhalt der App → jede geänderte App bekommt einen frischen Cache.
  const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
  const shell = ['./feldapp.html', './feldapp.webmanifest', './feldapp-icon-192.png', './feldapp-icon-512.png'];
  let sw = readFileSync(resolve('field-app/sw.js'), 'utf8');
  sw = mustReplace(sw, "const VERSION = 'dev';", `const VERSION = '${version}';`);
  sw = sw.replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(shell, null, 2)};`);
  if (!sw.includes('./feldapp.webmanifest')) throw new Error('SHELL-Liste in field-app/sw.js nicht gefunden');
  writeFileSync(resolve('dist/feldapp-sw.js'), sw);

  const manifest = JSON.parse(readFileSync(resolve('field-app/manifest.json'), 'utf8'));
  Object.assign(manifest, {
    id: './feldapp.html',
    start_url: './feldapp.html',
    scope: './feldapp',
    icons: manifest.icons.map(i => ({ ...i, src: 'feldapp-' + i.src })),
  });
  writeFileSync(resolve('dist/feldapp.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
  for (const size of [192, 512]) {
    copyFileSync(resolve(`field-app/icon-${size}.png`), resolve(`dist/feldapp-icon-${size}.png`));
  }

  console.log(`\n✓ dist/feldapp.html (${kb} KB) + Manifest, Service Worker (Version ${version}), Icons – fertig.`);
  console.log('  Über https (Netlify / GitHub Pages) als App installierbar und offline nutzbar.');
  console.log('  Als einzelne Datei weiterhin ohne Server im Browser zu öffnen.');
}

function mustReplace(text, search, replacement) {
  if (!text.includes(search)) throw new Error(`Build-Feldapp: Stelle nicht gefunden: ${search}`);
  return text.split(search).join(replacement);
}

build().catch(err => { console.error(err); process.exit(1); });
