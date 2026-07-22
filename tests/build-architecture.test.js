import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const buildSource = readFileSync(new URL('../build-singlefile.mjs', import.meta.url), 'utf8');

describe('kanonischer Singlefile-Build', () => {
  it('bündelt denselben main.js-Einstieg wie der ESM-Modus', () => {
    expect(buildSource).toContain("input: join(SRC, 'main.js')");
    expect(buildSource).toContain("format: 'iife'");
  });

  it('transformiert Anwendungsmodule weder per Regex noch über eine manuelle Ladeliste', () => {
    expect(buildSource).not.toMatch(/function\s+stripModule\b/);
    expect(buildSource).not.toMatch(/const\s+JS_FILES\s*=/);
    expect(buildSource).not.toContain('getExportNames');
  });
});
