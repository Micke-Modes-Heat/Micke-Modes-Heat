// ── Codemod: ESM-Migration Phase 2 — Zuweisungen an Import-Variablen ────────
// Ersetzt in Konsument-Dateien Zuweisungen an Variablen, die ein anderes Modul
// exportiert, durch Setter-Aufrufe (Muster: setMeritOrderKeys in 06c) und legt
// die Setter im exportierenden Modul an. Positionsbasiert über die exakten
// ESLint-no-undef-Fundstellen — kein Regex-Raten über die ganze Datei.
//
// Aufruf:  node tools/phase2-setters.mjs          (Probelauf, ändert nichts)
//          node tools/phase2-setters.mjs --write  (schreibt Dateien)
//
// Danach: node tools/fix-missing-imports.mjs --write  (Imports für Variablen
// und Setter ergänzen), npm run build, npm test.

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { getExportNames } from './export-names.mjs';

const SRC = 'src';
const WRITE = process.argv.includes('--write');

// ── 1. Export-Karte: Name → Modulpfad ──────────────────────────────────────
const exportOwner = new Map();
const allFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'styles') walk(p); }
    else if (f.endsWith('.js')) allFiles.push(p);
  }
})(SRC);
const codeByFile = new Map();
for (const file of allFiles) {
  const code = readFileSync(file, 'utf8');
  codeByFile.set(file, code);
  for (const name of getExportNames(code)) {
    if (exportOwner.has(name) && exportOwner.get(name) !== file) exportOwner.set(name, 'AMBIGUOUS');
    else exportOwner.set(name, file);
  }
}

// ── 2. ESLint no-undef Fundstellen (file, name, line, column) ──────────────
let report;
try {
  report = execSync('npx eslint -c eslint-undef.config.mjs src --format json',
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) { report = e.stdout; }

const hits = []; // { file, name, line, col }
for (const r of JSON.parse(report)) {
  for (const msg of r.messages) {
    if (msg.ruleId !== 'no-undef') continue;
    const name = (msg.message.match(/^'([^']+)'/) || [])[1];
    if (!name) continue;
    hits.push({ file: relative(process.cwd(), r.filePath), name, line: msg.line, col: msg.column });
  }
}

// ── 3. Hilfen ───────────────────────────────────────────────────────────────
const setterName = n => n.startsWith('_') ? 'set' + n : 'set' + n[0].toUpperCase() + n.slice(1);

function lineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return starts;
}

// Statement-Ende suchen: ab idx vorwärts bis ';' auf Klammertiefe 0
function findStatementEnd(code, idx) {
  let depth = 0;
  for (let i = idx; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) return -1; depth--; }
    else if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i++;
      while (i < code.length && code[i] !== q) i += code[i] === '\\' ? 2 : 1;
    }
    else if (ch === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; }
    else if (ch === ';' && depth === 0) return i;
  }
  return -1;
}

// Statement-Kontext? (vorhergehendes Nicht-Leerzeichen bzw. Wort prüfen)
function inStatementContext(code, idx) {
  let i = idx - 1;
  while (i >= 0 && /\s/.test(code[i])) i--;
  if (i < 0) return true;
  if (';{})'.includes(code[i])) return true;
  // vorhergehendes Wort 'else' / 'do'?
  let j = i;
  while (j >= 0 && /[a-z]/.test(code[j])) j--;
  const word = code.slice(j + 1, i + 1);
  return word === 'else' || word === 'do';
}

// ── 4. Transformationen pro Datei (rückwärts, damit Positionen gültig bleiben)
const byFile = new Map();
for (const h of hits) {
  const owner = exportOwner.get(h.name);
  if (!owner || owner === 'AMBIGUOUS') continue;
  if (relative(owner, h.file) === '') continue; // eigene Datei
  if (!byFile.has(h.file)) byFile.set(h.file, []);
  byFile.get(h.file).push(h);
}

const settersNeeded = new Map(); // ownerFile → Set(varName)
const log = { umgestellt: [], manuell: [], reads: 0 };

for (const [file, fileHits] of byFile) {
  let code = readFileSync(file, 'utf8');
  const starts = lineStarts(code);
  const withIdx = fileHits
    .map(h => ({ ...h, idx: starts[h.line - 1] + h.col - 1 }))
    .sort((a, b) => b.idx - a.idx);

  let changed = false;
  for (const h of withIdx) {
    const { name, idx } = h;
    if (code.slice(idx, idx + name.length) !== name) { log.manuell.push(`${file}:${h.line} ${name} (Position verschoben?)`); continue; }
    let after = idx + name.length;
    while (after < code.length && /[ \t]/.test(code[after])) after++;
    const two = code.slice(after, after + 2);
    const three = code.slice(after, after + 3);

    let opLen = 0, expand = null; // expand: (expr) => Ersatz-Ausdruck
    if (two === '++' || two === '--') {
      // Postfix-Inkrement: name++  →  setName(name ± 1)
      const repl = `${setterName(name)}(${name} ${two === '++' ? '+' : '-'} 1)`;
      if (!inStatementContext(code, idx)) { log.manuell.push(`${file}:${h.line} ${name}${two} (Expression-Kontext)`); continue; }
      code = code.slice(0, idx) + repl + code.slice(after + 2);
      log.umgestellt.push(`${file}:${h.line}  ${name}${two}  →  ${repl}`);
      noteSetter(name); changed = true; continue;
    }
    else if (three === '??=' || three === '||=' || three === '&&=') { opLen = 3; const op = three.slice(0, 2); expand = e => `${name} ${op} (${e})`; }
    else if (/^(\+=|-=|\*=|\/=|%=)/.test(two)) { opLen = 2; const op = two[0]; expand = e => `${name} ${op} (${e})`; }
    else if (code[after] === '=' && code[after + 1] !== '=' && code[after + 1] !== '>') { opLen = 1; expand = e => e; }
    else { log.reads++; continue; } // Lese-Zugriff → fix-missing-imports

    if (!inStatementContext(code, idx)) { log.manuell.push(`${file}:${h.line} ${name} (Expression-Kontext)`); continue; }
    const exprStart = after + opLen;
    const end = findStatementEnd(code, exprStart);
    if (end < 0) { log.manuell.push(`${file}:${h.line} ${name} (kein Statement-Ende gefunden)`); continue; }
    const expr = code.slice(exprStart, end).trim();
    if (/^[\w$]+\s*=[^=]/.test(expr)) { log.manuell.push(`${file}:${h.line} ${name} (verkettete Zuweisung)`); continue; }
    const repl = `${setterName(name)}(${expand(expr)})`;
    code = code.slice(0, idx) + repl + code.slice(end);
    log.umgestellt.push(`${file}:${h.line}  ${name} ${'='.padStart(opLen, ' ')} …  →  ${repl.slice(0, 60)}`);
    noteSetter(name); changed = true;
  }

  if (changed && WRITE) writeFileSync(file, code);

  function noteSetter(name) {
    const owner = exportOwner.get(name);
    if (!settersNeeded.has(owner)) settersNeeded.set(owner, new Set());
    settersNeeded.get(owner).add(name);
  }
}

// ── 5. Setter in den Owner-Modulen anlegen (falls nicht vorhanden) ──────────
for (const [owner, names] of settersNeeded) {
  let code = readFileSync(owner, 'utf8');
  let changed = false;
  for (const name of names) {
    const sn = setterName(name);
    if (exportOwner.has(sn) || new RegExp(`function\\s+${sn}\\b`).test(code)) continue; // existiert schon
    // direkt nach der Deklarationszeile einfügen
    const re = new RegExp(`^(export\\s+(?:let|var)\\s+(?:[^\\n]*[,\\s])?${name}\\b[^\\n]*)$`, 'm');
    const m = code.match(re);
    const setterLine = `export function ${sn}(v) { ${name} = v; }`;
    if (m) code = code.replace(re, `$1\n${setterLine}`);
    else { code += `\n${setterLine}\n`; log.manuell.push(`${owner}: Deklaration von ${name} nicht gefunden — Setter ans Dateiende`); }
    log.umgestellt.push(`${owner}: + ${setterLine}`);
    changed = true;
  }
  if (changed && WRITE) writeFileSync(owner, code);
}

// ── 6. Bericht ───────────────────────────────────────────────────────────────
console.log(`${WRITE ? 'GESCHRIEBEN' : 'PROBELAUF'} — ${log.umgestellt.length} Änderungen, ${log.reads} Lese-Zugriffe (→ fix-missing-imports), ${log.manuell.length} manuell:`);
for (const l of log.umgestellt) console.log('  ✓ ' + l);
for (const l of log.manuell) console.log('  ✗ MANUELL: ' + l);
