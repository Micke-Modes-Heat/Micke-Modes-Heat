// tools/lkebw-favicon.mjs — schneidet das grüne LKEBw-Zeichen aus der Wortmarke (Browser-Tab-Symbol).
//
// Das Zeichen steht links in LKEBW_LOGO, durch eine leere Spalte von der Schrift getrennt. Es wird
// auf seine Fläche zugeschnitten, quadratisch mit etwas Rand gesetzt und als 64×64-PNG unter
// LKEBW_ZEICHEN in src/config/lkebw-logo.js geschrieben (ersetzt eine vorhandene Fassung).
// build-singlefile.mjs setzt es als Favicon ein.
//
//   node tools/lkebw-favicon.mjs            → schreiben
//   node tools/lkebw-favicon.mjs <png>      → zusätzlich Vorschau als PNG-Datei ablegen

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATEI = path.join(ROOT, 'src/config/lkebw-logo.js');
const quelle = fs.readFileSync(DATEI, 'utf8');
const b64 = quelle.match(/export const LKEBW_LOGO = 'data:image\/png;base64,([A-Za-z0-9+/=]+)'/)[1];
const logo = Buffer.from(b64, 'base64');

const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const sichtbar = (x, y) => data[(y * W + x) * 4 + 3] > 24;

// Spalten mit Inhalt; das Zeichen ist der erste zusammenhängende Block von links
const spalteVoll = x => { for (let y = 0; y < H; y++) if (sichtbar(x, y)) return true; return false; };
let x0 = 0;
while (x0 < W && !spalteVoll(x0)) x0++;
let x1 = x0;
while (x1 < W && spalteVoll(x1)) x1++;
let y0 = H, y1 = 0;
for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (sichtbar(x, y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
const bw = x1 - x0, bh = y1 - y0;
if (bw < 8 || bw > W / 2) throw new Error(`Zeichen nicht gefunden (Block ${x0}–${x1})`);

// Quadratisch mit 6 % Rand, dann auf 64 px. Zwei Durchgänge: sharp verkleinert sonst vor dem
// Auffüllen (resize läuft immer vor extend) und schneidet das Zeichen an.
const seite = Math.ceil(Math.max(bw, bh) * 1.12);
const quadrat = await sharp(logo)
  .extract({ left: x0, top: y0, width: bw, height: bh })
  .extend({
    top: Math.floor((seite - bh) / 2), bottom: Math.ceil((seite - bh) / 2),
    left: Math.floor((seite - bw) / 2), right: Math.ceil((seite - bw) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
const png = await sharp(quadrat).resize(64, 64).png({ compressionLevel: 9 }).toBuffer();

const zeile = `export const LKEBW_ZEICHEN = 'data:image/png;base64,${png.toString('base64')}';`;
const kopf = '\n// Nur das grüne Zeichen, 64×64 (Browser-Tab-Symbol) — erzeugt mit tools/lkebw-favicon.mjs\n';
const ohne = quelle.replace(/\n\/\/ Nur das grüne Zeichen[^\n]*\nexport const LKEBW_ZEICHEN = '[^']*';\n?/, '\n');
fs.writeFileSync(DATEI, ohne.replace(/\n*$/, '\n') + kopf + zeile + '\n');
if (process.argv[2]) fs.writeFileSync(process.argv[2], png);
console.log(`Zeichen ${bw}×${bh} px bei x=${x0}, y=${y0} (Logo ${W}×${H}) → LKEBW_ZEICHEN, ${png.length} Bytes`);
