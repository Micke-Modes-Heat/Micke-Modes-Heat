// Baut field-app/index.html zu einer einzigen selbst-enthaltenen HTML-Datei.
// Leaflet CSS, Leaflet JS und JSZip werden von den CDN-URLs heruntergeladen
// und direkt in die HTML eingebettet – danach braucht die App kein Internet mehr.
//
// Aufruf: node build-feldapp.mjs
// Ausgabe: dist/feldapp.html

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

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

async function fetchText(url) {
  process.stdout.write(`  Lade ${url} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  const text = await res.text();
  console.log(`${(text.length / 1024).toFixed(0)} KB`);
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
    const content = await fetchText(dep.url);
    // Leaflet inline: Marker-PNG-URLs aus CSS entfernen (würden 404 geben)
    const cleaned = dep.url.includes('leaflet.css')
      ? content.replace(/url\([^)]*images\/marker[^)]*\)/g, 'url()')
      : content;
    html = html.replace(dep.tag, dep.wrap(cleaned));
  }

  // manifest.json-Link entfernen (funktioniert nicht aus einer Einzeldatei heraus)
  html = html.replace(/<link rel="manifest"[^>]*>/g, '');
  // Service-Worker-Registrierung entfernen (SW braucht eigene Origin)
  html = html.replace(
    /if\s*\('serviceWorker' in navigator\)[\s\S]*?}\s*\}/,
    '/* Service Worker nicht verfügbar in Einzeldatei-Modus */'
  );

  writeFileSync(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`\n✓ dist/feldapp.html (${kb} KB) – fertig.`);
  console.log('  Diese Datei per Mail / WhatsApp / USB ans Handy schicken');
  console.log('  und im Browser öffnen. Kein Server nötig.');
}

build().catch(err => { console.error(err); process.exit(1); });
