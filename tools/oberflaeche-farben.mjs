// tools/oberflaeche-farben.mjs — stellt fest eingetragene UI-Farben auf Design-Tokens um.
//
// Hintergrund: Die Oberfläche war für dunklen Grund gebaut; viele Inline-Stile tragen helle
// Pastelltöne (#b0bec5, #ffd54f …), die auf hellem LKEBw-Grund unlesbar wären. Das Skript
// ersetzt Farbangaben in CSS-Deklarationen (style-Attribute, CSS-Strings in JS, app.css)
// durch Tokens aus src/styles/lkebw.css. Kartenfarben in JS-Objekten (`color: '#…'`),
// Canvas-Farben und Dokument-/Exportdateien bleiben unberührt.
//
//   node tools/oberflaeche-farben.mjs          → Vorschau (zählt nur)
//   node tools/oberflaeche-farben.mjs --write  → Dateien schreiben

import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

// Dateien, die Papier/Export erzeugen oder in Worker eingebettet werden — nicht anfassen
const AUSNAHMEN = new Set([
  'src/05a-export.js', 'src/05d-bericht.js', 'src/05e-projektbericht.js',
  'src/06c-dispatch-core.js', 'src/10d-optimizer-worker.js',
  'src/17-gutachten-grafik.js', 'src/18-liegenschaftsbilder.js', 'src/19-el-ergebnisblatt.js',
  'src/13f-sld.js', 'src/21-gutachten-editor.js', 'src/47-waerme-schema.js', 'src/27-resilienz-abfrage.js', 'src/34-stations-steckbrief.js',
]);

function dateien() {
  // NUR=src/a.js,src/b.js → nur diese Dateien (auch ausgenommene, z. B. für gezielte Nacharbeit)
  if (process.env.NUR) return process.env.NUR.split(',');
  const out = ['index.html', 'src/styles/app.css'];
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    if (f.endsWith('.js') && !AUSNAHMEN.has('src/' + f)) out.push('src/' + f);
  }
  return out;
}

// ── Farbklassifikation ──────────────────────────────────────────────
function hexRgb(h) {
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
function farbton(h) {
  if (h < 15 || h >= 345) return 'var(--c-red)';
  if (h < 38) return 'var(--c-orange)';
  if (h < 66) return 'var(--c-amber)';
  if (h < 160) return 'var(--c-green)';
  if (h < 196) return 'var(--c-teal)';
  if (h < 250) return 'var(--c-blue)';
  return 'var(--c-violet)';
}

// art: 'text' | 'bg' | 'border'
function ersetzeHex(hex, art) {
  const low = hex.toLowerCase();
  if (low.length === 9 || low.length === 5) return null;            // mit Alpha: unverändert
  if (low === '#fff' || low === '#ffffff') return art === 'border' ? 'var(--border)' : null;
  if (low === '#000' || low === '#000000') return null;
  if (low === '#266426' || low === '#3f9c3f') return null;                 // LKEBw-Grün bleibt
  const [h, s, l] = hsl(hexRgb(low));
  if (art === 'text') {
    if (s < 0.15) {
      if (l >= 0.88) return 'var(--text)';
      if (l >= 0.62) return 'var(--muted)';
      if (l >= 0.3) return 'var(--faint)';
      return null;
    }
    if (l < 0.3) return null;
    return farbton(h);
  }
  if (art === 'bg') {
    if (l < 0.13) return 'var(--surface)';
    if (l < 0.26) return s < 0.3 ? 'var(--surface2)' : 'var(--hover)';
    return null;                                                     // Farbflächen (Knöpfe, Badges) bleiben
  }
  // border
  if (s < 0.15) return 'var(--border)';
  if (l < 0.22) return 'var(--border)';
  return farbton(h);
}

function ersetzeRgba(m, art) {
  const p = m.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!p) return null;
  const [r, g, b] = [+p[1], +p[2], +p[3]], a = p[4] === undefined ? 1 : +p[4];
  if (r >= 245 && g >= 245 && b >= 245) {
    if (a >= 0.9) return art === 'text' ? 'var(--text)' : null;
    return `rgba(var(--ink),${p[4] ?? 1})`;                           // weiße Schleier → Tinte des Themas
  }
  if (art === 'bg' && r < 60 && g < 60 && b < 70 && a >= 0.6) return 'var(--surface)';
  return null;
}

const PROP = /(^|[^-\w$])(color|background|background-color|border|border-color|border-(?:left|right|top|bottom)(?:-color)?|outline|outline-color|fill|stroke|box-shadow)(\s*:\s*)([^;"'`{}<>\n]*)/g;
const LIT = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

function artVon(prop) {
  if (prop === 'color' || prop === 'fill' || prop === 'stroke') return 'text';
  if (prop.startsWith('background')) return 'bg';
  if (prop === 'box-shadow') return 'shadow';
  return 'border';
}

const zaehler = {};
function umstellen(text) {
  return text.replace(PROP, (all, vor, prop, sep, wert) => {
    const art = artVon(prop);
    const neu = wert.replace(LIT, lit => {
      let r = null;
      if (lit.startsWith('#')) { if (art !== 'shadow') r = ersetzeHex(lit, art); }
      else r = ersetzeRgba(lit, art === 'shadow' ? 'bg' : art);
      if (r && !(art === 'shadow' && !r.startsWith('rgba(var'))) {
        zaehler[r] = (zaehler[r] || 0) + 1;
        return r;
      }
      return lit;
    });
    return vor + prop + sep + neu;
  });
}

// app.css: :root-Block nicht anfassen (wird von lkebw.css überschrieben)
let gesamt = 0;
for (const rel of dateien()) {
  const abs = path.join(ROOT, rel);
  const alt = fs.readFileSync(abs, 'utf8');
  const vorher = { ...zaehler };
  // AB=<Text> / BIS=<Text>: nur den Bereich dazwischen umstellen (z. B. die Panel-Oberfläche einer
  // Datei, deren übrige Teile Abbildungen für Word erzeugen)
  const a = process.env.AB ? alt.indexOf(process.env.AB) : 0;
  const bRoh = process.env.BIS ? alt.indexOf(process.env.BIS, Math.max(a, 0)) : -1;
  const b = bRoh < 0 ? alt.length : bRoh;
  if (a < 0) { console.log('AB nicht gefunden in', rel); continue; }
  const neu = alt.slice(0, a) + umstellen(alt.slice(a, b)) + alt.slice(b);
  const n = Object.keys(zaehler).reduce((s, k) => s + (zaehler[k] - (vorher[k] || 0)), 0);
  if (n) { gesamt += n; console.log(String(n).padStart(5), rel); }
  if (WRITE && neu !== alt) fs.writeFileSync(abs, neu);
}
console.log('\nGesamt', gesamt);
console.log(Object.entries(zaehler).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}× ${k}`).join('\n'));
if (!WRITE) console.log('\n(Vorschau — mit --write schreiben)');
