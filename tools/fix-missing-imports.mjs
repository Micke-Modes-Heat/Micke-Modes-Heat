// ── Codemod: fehlende Imports in src/ ergänzen (ESM-Migration Phase 1) ──────
// Liest die no-undef-Meldungen von ESLint (eslint-undef.config.mjs), ermittelt
// für jeden fehlenden Bezeichner das exportierende Modul und fügt die
// Import-Zeile ein. NUR Lese-Zugriffe — Bezeichner, denen in der Datei
// zugewiesen wird, werden übersprungen (Phase 2: Setter-Refactor).
//
// Aufruf:  node tools/fix-missing-imports.mjs          (Probelauf, ändert nichts)
//          node tools/fix-missing-imports.mjs --write  (schreibt Dateien)
//
// Sicherheitsbeweis: dist/index.html muss nach `npm run build` byte-identisch
// bleiben, da build-singlefile.mjs alle import-Zeilen entfernt.

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const SRC = 'src';
const WRITE = process.argv.includes('--write');

// ── 1. Export-Karte aufbauen: Name → Modulpfad ──────────────────────────────
const exportOwner = new Map();   // name → relPath (oder 'AMBIGUOUS')
const allFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'styles') walk(p); }
    else if (f.endsWith('.js')) allFiles.push(p);
  }
})(SRC);

for (const file of allFiles) {
  const code = readFileSync(file, 'utf8');
  for (const line of code.split('\n')) {
    const t = line.trimStart();
    let m;
    if ((m = t.match(/^export\s+(?:async\s+)?function\s+([\w$]+)/)) ||
        (m = t.match(/^export\s+(?:const|let|var)\s+([\w$]+)/))) {
      const name = m[1];
      if (exportOwner.has(name) && exportOwner.get(name) !== file) {
        exportOwner.set(name, 'AMBIGUOUS');
      } else {
        exportOwner.set(name, file);
      }
    }
  }
}

// ── 2. ESLint no-undef Meldungen einsammeln ─────────────────────────────────
let report;
try {
  report = execSync('npx eslint -c eslint-undef.config.mjs src --format json', {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  report = e.stdout; // eslint exit code 1 bei Fehlern ist erwartet
}
const results = JSON.parse(report);

// file → Set(names)
const undefByFile = new Map();
for (const r of results) {
  for (const msg of r.messages) {
    if (msg.ruleId !== 'no-undef') continue;
    const name = (msg.message.match(/^'([^']+)'/) || [])[1];
    if (!name) continue;
    const rel = relative(process.cwd(), r.filePath);
    if (!undefByFile.has(rel)) undefByFile.set(rel, new Set());
    undefByFile.get(rel).add(name);
  }
}

// ── 3. Pro Datei: Namen klassifizieren und Imports einfügen ─────────────────
// Zuweisungs-Erkennung: NAME =  (aber nicht ==, =>, ===), NAME++, NAME--, NAME +=, …
function wirdZugewiesen(code, name) {
  const re = new RegExp(
    String.raw`(^|[^.\w$])${name}\s*(\+\+|--|(?:[+\-*/%&|^]|\*\*|<<|>>>?|\?\?|\|\||&&)?=(?![=>]))`, 'm'
  );
  return re.test(code);
}

const stats = { importiert: 0, zuweisungen: new Set(), unbekannt: new Set(), ambiguous: new Set() };

for (const [file, names] of undefByFile) {
  const code = readFileSync(file, 'utf8');
  const proModul = new Map(); // ownerPath → [names]

  for (const name of names) {
    const owner = exportOwner.get(name);
    if (!owner) { stats.unbekannt.add(name); continue; }
    if (owner === 'AMBIGUOUS') { stats.ambiguous.add(name); continue; }
    if (relative(owner, file) === '') continue; // eigene Datei
    if (wirdZugewiesen(code, name)) { stats.zuweisungen.add(`${file}: ${name}`); continue; }
    let rel = relative(dirname(file), owner).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    if (!proModul.has(rel)) proModul.set(rel, []);
    proModul.get(rel).push(name);
  }

  if (!proModul.size) continue;

  const lines = [...proModul.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mod, ns]) => `import { ${ns.sort().join(', ')} } from '${mod}';`);
  stats.importiert += [...proModul.values()].reduce((s, ns) => s + ns.length, 0);

  if (WRITE) {
    const codeLines = code.split('\n');
    // Nach dem letzten Top-Import einfügen, sonst nach führendem Kommentarblock
    let idx = -1;
    for (let i = 0; i < Math.min(codeLines.length, 80); i++) {
      if (/^import\s/.test(codeLines[i])) idx = i;
    }
    if (idx < 0) {
      idx = -1;
      for (let i = 0; i < codeLines.length; i++) {
        if (codeLines[i].startsWith('//') || codeLines[i].trim() === '') idx = i;
        else break;
      }
    }
    codeLines.splice(idx + 1, 0, '// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)', ...lines);
    writeFileSync(file, codeLines.join('\n'));
  }
  console.log(`${WRITE ? '✓' : '·'} ${file}: ${[...proModul.values()].flat().length} Importe ${WRITE ? 'ergänzt' : 'würden ergänzt'}`);
}

console.log(`\n${WRITE ? 'Geschrieben' : 'Probelauf'}: ${stats.importiert} Importe in ${undefByFile.size} Dateien`);
if (stats.zuweisungen.size) console.log(`\nÜbersprungen (Zuweisung → Phase 2 Setter nötig): ${stats.zuweisungen.size}\n  ` + [...stats.zuweisungen].slice(0, 40).join('\n  '));
if (stats.unbekannt.size) console.log(`\nKein Export gefunden (window-Globals o.ä.): ${[...stats.unbekannt].join(', ')}`);
if (stats.ambiguous.size) console.log(`\nMehrdeutig (mehrere Module exportieren den Namen): ${[...stats.ambiguous].join(', ')}`);
