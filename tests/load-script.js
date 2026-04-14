/**
 * Test-Helper: Lädt eine globale Script-Datei (kein ES-Module) in die aktuelle Umgebung.
 * Funktionen und Variablen landen auf globalThis (≈ window im Browser).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';

const srcDir = resolve(import.meta.dirname, '..', 'src');

export function loadScript(...filePaths) {
  for (const filePath of filePaths) {
    const fullPath = filePath.startsWith('/')
      ? filePath
      : resolve(srcDir, filePath);
    let code = readFileSync(fullPath, 'utf8');
    // Strip ES module syntax so code runs in global scope (vm context)
    code = code.replace(/^import\s+.*$/gm, '');
    code = code.replace(/^export\s+/gm, '');
    runInThisContext(code, { filename: fullPath });
  }
}

// Minimales DOM-Mock für Code der document.getElementById aufruft
if (!globalThis.document) {
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag,
      style: {},
      classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      setAttribute(){},
      getAttribute(){ return null; },
      addEventListener(){},
      appendChild(){},
      innerHTML: '',
      textContent: '',
    }),
    addEventListener(){},
  };
}
if (!globalThis.window) {
  globalThis.window = globalThis;
}
