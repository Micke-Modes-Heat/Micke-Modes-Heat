// Baut die Web-Fassung der Artikel: Skizzen aus docs/skizzen ({{FIG:Name}}) und eigene Abbildungen
// ({{SVG:figuren/datei.svg|Titel}}) als <img>-Data-URI einsetzen, Logo aus src/config/lkebw-logo.js.
// node docs/artikel/bauen.cjs [Artikel|alle] [Zielordner]   Standard: alle → artikel-ausgabe/
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const skizzen = path.join(REPO, 'docs', 'skizzen');
const katalog = JSON.parse(fs.readFileSync(path.join(skizzen, 'katalog.json'), 'utf8')).skizzen;
const LOGO = fs.readFileSync(path.join(REPO, 'src/config/lkebw-logo.js'), 'utf8')
  .match(/export const LKEBW_LOGO = '(data:image\/png;base64,[A-Za-z0-9+/=]+)'/)[1];

const wahl = process.argv[2] || 'alle';
const ZIEL = path.resolve(process.argv[3] || path.join(REPO, 'artikel-ausgabe'));
const artikelListe = wahl === 'alle'
  ? fs.readdirSync(__dirname).filter(d => d.endsWith('.html')).map(d => d.slice(0, -5))
  : [wahl];

const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const bild = (svg, titel) => {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  return `<button type="button" aria-label="Abbildung vergrößern: ${esc(titel)}"><img src="data:image/svg+xml;base64,${b64}" alt="${esc(titel)}" width="${vb[1]}" height="${vb[2]}"></button>`;
};

fs.mkdirSync(ZIEL, { recursive: true });
for (const artikel of artikelListe) {
  let html = fs.readFileSync(path.join(__dirname, `${artikel}.html`), 'utf8');
  html = html.replace('{{LOGO}}', LOGO);
  html = html.replace(/\{\{FIG:([\w-]+)\}\}/g, (_, name) => {
    const k = katalog.find(e => e.datei === name);
    if (!k) throw new Error('Nicht im Katalog: ' + name);
    return bild(fs.readFileSync(path.join(skizzen, k.thema, name + '.svg'), 'utf8'), k.titel);
  });
  html = html.replace(/\{\{SVG:([^|}]+)\|([^}]+)\}\}/g, (_, datei, titel) => bild(fs.readFileSync(path.join(__dirname, datei), 'utf8'), titel));
  if (/\{\{/.test(html)) throw new Error(`${artikel}: Platzhalter übrig`);
  const ziel = path.join(ZIEL, `${artikel}_Web.html`);
  fs.writeFileSync(ziel, html);
  console.log(ziel, Math.round(html.length / 1024) + ' KB');
}
