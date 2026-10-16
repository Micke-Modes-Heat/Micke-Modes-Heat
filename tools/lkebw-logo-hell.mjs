// tools/lkebw-logo-hell.mjs — erzeugt aus der LKEBw-Wortmarke eine Fassung für dunklen Grund.
//
// Dunkle, ungesättigte Pixel (die Schrift „LKE“) werden weiß, das Grün bleibt. Ergebnis wird als
// LKEBW_LOGO_HELL in src/config/lkebw-logo.js geschrieben (ersetzt eine vorhandene Fassung).
//
//   node tools/lkebw-logo-hell.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATEI = path.join(ROOT, 'src/config/lkebw-logo.js');
const quelle = fs.readFileSync(DATEI, 'utf8');
const b64 = quelle.match(/export const LKEBW_LOGO = 'data:image\/png;base64,([A-Za-z0-9+/=]+)'/)[1];

const { data, info } = await sharp(Buffer.from(b64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
  if (!a) continue;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 40 && max < 140) { data[i] = data[i + 1] = data[i + 2] = 255; }
}
const png = await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
const zeile = `export const LKEBW_LOGO_HELL = 'data:image/png;base64,${png.toString('base64')}';`;

const kopf = '\n// Fassung für dunklen Grund (Programmrahmen): Schrift weiß, Grün unverändert — erzeugt mit tools/lkebw-logo-hell.mjs\n';
const ohne = quelle.replace(/\n\/\/ Fassung für dunklen Grund[^\n]*\nexport const LKEBW_LOGO_HELL = '[^']*';\n?/, '\n');
fs.writeFileSync(DATEI, ohne.replace(/\n*$/, '\n') + kopf + zeile + '\n');
console.log('LKEBW_LOGO_HELL geschrieben,', png.length, 'Bytes');
