// tools/oberflaeche-schrift.mjs — hebt zu kleine Schriftgrößen in der Oberfläche an.
//
// Die Panels nutzten 8–10 px; lesbare Untergrenze im neuen Erscheinungsbild sind 11 px.
// Ersetzt nur CSS-Deklarationen (`font-size:9px`), keine SVG-Attribute (`font-size="9"`).
// Zuordnung: 7–8,5 → 10,5 · 9–9,5 → 11 · 10–10,5 → 12 · 11–11,5 → 12,5 px; Größeres bleibt.
// Dokument-, Export- und Abbildungsdateien sind ausgenommen.
//
//   node tools/oberflaeche-schrift.mjs          → Vorschau
//   node tools/oberflaeche-schrift.mjs --write  → schreiben

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const AUSNAHMEN = new Set([
  'src/05a-export.js', 'src/05d-bericht.js', 'src/05e-projektbericht.js',
  'src/06c-dispatch-core.js', 'src/10d-optimizer-worker.js',
  'src/13f-sld.js', 'src/17-gutachten-grafik.js', 'src/18-liegenschaftsbilder.js', 'src/19-el-ergebnisblatt.js',
  'src/21-gutachten-editor.js', 'src/27-resilienz-abfrage.js', 'src/34-stations-steckbrief.js', 'src/47-waerme-schema.js',
]);
const neuGroesse = px => px < 9 ? 10.5 : px < 10 ? 11 : px < 11 ? 12 : px < 12 ? 12.5 : px;

const dateien = ['index.html', 'src/styles/app.css', ...fs.readdirSync(path.join(ROOT, 'src'))
  .filter(f => f.endsWith('.js') && !AUSNAHMEN.has('src/' + f)).map(f => 'src/' + f)];

let gesamt = 0;
for (const rel of dateien) {
  const abs = path.join(ROOT, rel);
  const alt = fs.readFileSync(abs, 'utf8');
  let n = 0;
  const neu = alt.replace(/(^|[^-\w])font-size(\s*:\s*)(\d+(?:\.\d+)?)px/g, (m, vor, sep, wert) => {
    const g = neuGroesse(+wert);
    if (g === +wert) return m;
    n++;
    return `${vor}font-size${sep}${g}px`;
  });
  if (n) { gesamt += n; console.log(String(n).padStart(5), rel); }
  if (WRITE && neu !== alt) fs.writeFileSync(abs, neu);
}
console.log('\nGesamt', gesamt, WRITE ? '' : '(Vorschau — mit --write schreiben)');
