// Holt die Deckblatt-Bilder aus der Word-Vorlage des Gutachtens und schreibt sie
// als data-freie Base64-Konstanten nach src/config/gutachten-vorlage-assets.js.
// Aufruf: node tools/gutachten-vorlage-assets.mjs "<Pfad zur Vorlage.docx>"
// Nur nötig, wenn sich Logo, Wappen oder Deckblattgrafik der Vorlage ändern.
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const pfad = process.argv[2];
if (!pfad) { console.error('Pfad zur Vorlage fehlt.'); process.exit(1); }

const zip = await JSZip.loadAsync(readFileSync(pfad));
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
const doc = await zip.file('word/document.xml').async('string');
const ziel = id => rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1];

// Deckblatt: 1. und 2. Bild im grünen Band (Logo, Wappen), 3. die freigestellte Netzgrafik
const blips = [...doc.matchAll(/r:embed="(rId\d+)"/g)].map(m => m[1]).slice(0, 3);
const namen = ['LOGO', 'WAPPEN', 'NETZGRAFIK'];
let out = '// ── config/gutachten-vorlage-assets.js — Deckblatt-Bilder der Word-Vorlage ──\n'
  + '// Erzeugt von tools/gutachten-vorlage-assets.mjs aus "Gutachten_Energieversorgung_LKEBw.docx".\n'
  + '// Nicht von Hand bearbeiten — bei geänderter Vorlage das Skript neu ausführen.\n\n';
for (let i = 0; i < blips.length; i++) {
  const datei = ziel(blips[i]);
  const b64 = await zip.file('word/' + datei).async('base64');
  out += `export const GV_${namen[i]}_PNG = '${b64}';\n`;
  console.log(`${namen[i]}: ${datei} (${Math.round(b64.length * 0.75 / 1024)} KB)`);
}
writeFileSync(new URL('../src/config/gutachten-vorlage-assets.js', import.meta.url), out);
console.log('geschrieben: src/config/gutachten-vorlage-assets.js');
