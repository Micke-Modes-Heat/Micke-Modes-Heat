// ── Gemeinsamer Export-Namen-Parser für build-singlefile.mjs und ────────────
// tools/fix-missing-imports.mjs. Erfasst auch Mehrfach-Deklarationen wie
// `export const R_MIN = 4, R_MAX = 54;` (vorher wurde nur der erste Name
// erkannt). Kommata in Initialisierern — f(1,2), [a,b], {x:1,y:2} — werden
// über Klammertiefe übersprungen; Deklaration muss auf einer Zeile stehen.

// Alle deklarierten Namen aus dem Teil nach `export const|let|var` ziehen.
function declaredNames(declPart) {
  const names = [];
  let depth = 0, expectName = true, i = 0;
  while (i < declPart.length) {
    const ch = declPart[i];
    if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch; i++;
      while (i < declPart.length && declPart[i] !== quote) i += declPart[i] === '\\' ? 2 : 1;
      i++; continue;
    }
    if (depth === 0 && ch === ',') { expectName = true; i++; continue; }
    if (depth === 0 && ch === ';') break;
    if (expectName && /[\w$]/.test(ch)) {
      let j = i;
      while (j < declPart.length && /[\w$]/.test(declPart[j])) j++;
      names.push(declPart.slice(i, j));
      expectName = false; i = j; continue;
    }
    i++;
  }
  return names;
}

// Alle Export-Namen einer Moduldatei (zeilenbasiert, wie bisher).
export function getExportNames(code) {
  const names = [];
  for (const line of code.split('\n')) {
    const t = line.trimStart();
    let m;
    if ((m = t.match(/^export\s+(?:async\s+)?function\s+([\w$]+)/))) names.push(m[1]);
    if ((m = t.match(/^export\s+(?:const|let|var)\s+(.+)/))) names.push(...declaredNames(m[1]));
  }
  return names;
}
