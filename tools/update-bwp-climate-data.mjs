// Erzeugt die kompakte PLZ-Klimatabelle aus der öffentlichen BWP-Klimakarte.
// Bewusstes Wartungsskript: nicht bei jedem Build ausführen, damit Builds
// reproduzierbar und die fachlichen Eingangsdaten versioniert bleiben.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE_PAGE = 'https://www.waermepumpe.de/werkzeuge/klimakarte/';
const SOURCE_DATA = `${SOURCE_PAGE}?tx_bwpclimatezones_map%5Baction%5D=load&tx_bwpclimatezones_map%5Bcontroller%5D=Map&type=7289322&cHash=009ca26541bf1c0d8a132412e9cac4d5`;
const retrievedAt = new Date().toISOString().slice(0, 10);

const response = await fetch(SOURCE_DATA, {headers:{'User-Agent':'Micke-Heat climate data updater'}});
if (!response.ok) throw new Error(`BWP-Klimadaten: HTTP ${response.status}`);
const html = await response.text();

const entries = [];
const polygonPattern = /<polygon\b[\s\S]*?\/>/g;
for (const polygon of html.match(polygonPattern) || []) {
  const zip = polygon.match(/\bzip="([0-9]{5})"/)?.[1];
  const mean = polygon.match(/\baat="(-?[0-9.]+) °C"/)?.[1];
  const design = polygon.match(/\bdot="(-?[0-9.]+) °C"/)?.[1];
  if (!zip || mean == null || design == null) continue;
  entries.push([zip, Number(design), Number(mean)]);
}
entries.sort((a, b) => a[0].localeCompare(b[0]));
if (entries.length < 8000) throw new Error(`BWP-Klimadaten unvollständig: nur ${entries.length} PLZ`);

const moduleText = `// Automatisch erzeugt durch tools/update-bwp-climate-data.mjs
// Quelle: BWP-Klimakarte, DIN/TS 12831-1 (April 2020)
// Abrufstand: ${retrievedAt}
export const BWP_KLIMA_META = Object.freeze({
  source:'BWP-Klimakarte',
  sourceUrl:'${SOURCE_PAGE}',
  standard:'DIN/TS 12831-1:2020-04',
  retrievedAt:'${retrievedAt}',
});

// PLZ: [Norm-Außentemperatur °C, Jahresmitteltemperatur °C]
export const BWP_KLIMA_PLZ = Object.freeze(${JSON.stringify(Object.fromEntries(
  entries.map(([zip, design, mean]) => [zip, [design, mean]]),
))});
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../src/data/bwp-klima-plz.js');
await mkdir(path.dirname(target), {recursive:true});
await writeFile(target, moduleText, 'utf8');
console.log(`${entries.length} PLZ geschrieben: ${target}`);
