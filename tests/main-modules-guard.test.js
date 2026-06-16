// Wächter: Jeder Namespace-Import in src/main.js muss auch im modules-Array
// stehen, sonst landen seine Exporte im Vite-Dev-Modus nicht auf window und
// data-*-Handler schlagen still fehl (dist-Build funktioniert trotzdem).
// Zuletzt passiert mit 05d-bericht.js und 09d-pv-analyse.js (gefixt 11.06.2026).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mainJsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const source = readFileSync(mainJsPath, 'utf8');

// Namespace-Imports einsammeln: import * as X from './...';
// Reine Seiteneffekt-Imports (import './12-inline-handlers.js';) haben keinen
// Namespace und werden hier automatisch nicht erfasst — das ist gewollt.
function parseNamespaceImports(src) {
  const imports = [];
  const re = /^\s*import\s*\*\s*as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    imports.push({ name: m[1], path: m[2] });
  }
  return imports;
}

// Inhalt des modules-Arrays extrahieren und in Bezeichner zerlegen
function parseModulesArray(src) {
  const m = src.match(/const\s+modules\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const body = m[1].replace(/\/\/[^\n]*/g, ''); // Zeilenkommentare entfernen
  return body.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

const namespaceImports = parseNamespaceImports(source);
const modulesEntries = parseModulesArray(source);

describe('main.js modules-Wächter', () => {
  it('findet das modules-Array in src/main.js', () => {
    expect(modulesEntries, 'const modules = [...] nicht gefunden — Test an neue Struktur anpassen').not.toBeNull();
  });

  it('findet eine plausible Anzahl Namespace-Imports', () => {
    expect(namespaceImports.length).toBeGreaterThan(10);
  });

  it('jeder Namespace-Import steht im modules-Array', () => {
    const inArray = new Set(modulesEntries);
    const missing = namespaceImports.filter(({ name }) => !inArray.has(name));
    const msg = missing.map(({ name, path }) => `${name} (${path})`).join(', ');
    expect(missing, `Fehlt im modules-Array (Exporte landen im Dev-Modus nicht auf window): ${msg}`).toHaveLength(0);
  });

  it('jeder Eintrag im modules-Array ist ein bekannter Namespace-Import', () => {
    const imported = new Set(namespaceImports.map(({ name }) => name));
    const unknown = modulesEntries.filter((name) => !imported.has(name));
    expect(unknown, `Im modules-Array, aber kein "import * as ..." dazu: ${unknown.join(', ')}`).toHaveLength(0);
  });

  it('keine doppelten Einträge im modules-Array', () => {
    const seen = new Set();
    const dupes = modulesEntries.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
    expect(dupes, `Doppelt im modules-Array: ${dupes.join(', ')}`).toHaveLength(0);
  });
});
