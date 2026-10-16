// tools/oberflaeche-emojis.mjs — entfernt Emojis vor Beschriftungen („🔥 Wärme-Grundlagen“ → „Wärme-Grundlagen“).
//
// Nur führende Emojis direkt am Anfang eines Textes (nach > ' " `) und nur, wenn danach ein Wort
// folgt. Reine Symbole (Kartenmarker, Icon-Spans) bleiben stehen, ebenso Warn- und Prüfzeichen
// (⚠ ✓ ✕ ★). Dokument-, Export- und Kartensymbol-Dateien sind ausgenommen.
//
//   node tools/oberflaeche-emojis.mjs          → Vorschau
//   node tools/oberflaeche-emojis.mjs --write  → schreiben

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const AUSNAHMEN = new Set([
  'src/05a-export.js', 'src/05d-bericht.js', 'src/05e-projektbericht.js',
  'src/06c-dispatch-core.js', 'src/10d-optimizer-worker.js',
  'src/17-gutachten-grafik.js', 'src/19-el-ergebnisblatt.js',
  'src/27-resilienz-abfrage.js', 'src/34-stations-steckbrief.js',
]);

const EMOJI = '(?:[\\p{Extended_Pictographic}--[⚠★☆✓✔✕✖✗©®™↔↕]]|[⬡⊞⋯])[\\u{FE0F}\\u{200D}\\p{Extended_Pictographic}]*';
const RE = new RegExp(`(['"\`>]\\s*)((?:${EMOJI}\\s*)+)\\s(?=[\\p{L}\\d„\\(])`, 'gv');

const dateien = ['index.html', ...fs.readdirSync(path.join(ROOT, 'src'))
  .filter(f => f.endsWith('.js') && !AUSNAHMEN.has('src/' + f)).map(f => 'src/' + f)];

let gesamt = 0;
for (const rel of dateien) {
  const abs = path.join(ROOT, rel);
  const alt = fs.readFileSync(abs, 'utf8');
  let n = 0;
  const neu = alt.replace(RE, (m, vor) => { n++; return vor; });
  if (n) { gesamt += n; console.log(String(n).padStart(5), rel); }
  if (WRITE && neu !== alt) fs.writeFileSync(abs, neu);
}
console.log('\nGesamt', gesamt, WRITE ? '' : '(Vorschau — mit --write schreiben)');
