// ── tools/generate-architecture.mjs ───────────────────────────────────────
// Scannt src/*.js, extrahiert Header-Zweck + Imports, generiert
// docs/architektur.html mit Mermaid-Diagramm + Tabelle.
//
// Aufruf: `node tools/generate-architecture.mjs`
// Wird automatisch von dev.sh und build-singlefile.mjs ausgeführt.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const SRC_DIR = resolve('src');
const OUT_HTML = resolve('docs', 'architektur.html');

// Domänen-Mapping nach Datei-Präfix (Sortier-Reihenfolge wichtig)
const DOMAINS = [
  { id: 'config',      name: '⚙️ Konfiguration',                pattern: /^config\// },
  { id: 'globals',     name: '🌐 Globals + Varianten',          pattern: /^01-/ },
  { id: 'karte',       name: '🗺️ Karte + Geometrie',            pattern: /^02[abc]-/ },
  { id: 'netz',        name: '🔥 Wärmenetz + Erzeuger + IO',    pattern: /^03[abc]-/ },
  { id: 'uipanels',    name: '🖼️ UI-Panels + 3D',               pattern: /^04[ab]-/ },
  { id: 'exportalt',   name: '📤 Export + Altes Stromnetz',     pattern: /^05[abc]-/ },
  { id: 'lastgang',    name: '📈 Wärme-Lastgang + Dispatch',    pattern: /^06[abc]-/ },
  { id: 'analyse',     name: '📊 Analyse + Wirtschaftlichkeit', pattern: /^07[ab]-/ },
  { id: 'calc',        name: '🧮 CalcEngine',                   pattern: /^08-/ },
  { id: 'pv',          name: '☀ PV',                            pattern: /^09[abc]-/ },
  { id: 'optimizer',   name: '🎯 Optimizer',                    pattern: /^10[abcd]-/ },
  { id: 'hilfe',       name: '❓ Hilfe + Leitfaden',            pattern: /^11-/ },
  { id: 'handlers',    name: '🎬 Inline-Event-Handler',         pattern: /^12-/ },
  { id: 'assets',      name: '🧩 Asset-System (Phase 1)',       pattern: /^13[abcde]-/ },
  { id: 'strom_fund',  name: '⚡ Stromnetz-Fundament (Phase 3.1)', pattern: /^14[abc]-/ },
  { id: 'strom_feat',  name: '⚡ Stromnetz-Features (Phase 3.2–3.6)', pattern: /^15[a-z]-/ },
  { id: 'strom_ui',    name: '⚡ Stromnetz-UI + Self-Test (Phase 3)', pattern: /^16/ },
  { id: 'fotos',       name: '📷 Foto-Anhang (Phase 4)',        pattern: /^17[abc]-/ },
  { id: 'main',        name: '🚪 Main-Entry',                   pattern: /^main\.js$/ },
];

// ── Datei-Liste rekursiv ────────────────────────────────────────────────────
function listJsFiles(dir, prefix = '') {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) out.push(...listJsFiles(join(dir, f.name), prefix + f.name + '/'));
    else if (f.name.endsWith('.js')) out.push(prefix + f.name);
  }
  return out;
}

// ── Modul-Info aus Datei extrahieren ────────────────────────────────────────
function parseModule(relPath) {
  const text = readFileSync(join(SRC_DIR, relPath), 'utf8');
  const lines = text.split('\n');
  // Header-Zweck: erste Zeile nach Kommentar-Box oder "// ── XYZ — Zweck"
  let purpose = '';
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const m = lines[i].match(/^\/\/\s*[─=]+\s*([^─=]+?)\s*[─=]+/) ||
              lines[i].match(/^\/\/\s*(.+?)\s*[─=]+/);
    if (m) {
      // "13a-assets-core.js — Unified Asset-System (Strom + später Wärme)"
      const dashSplit = m[1].split(/\s+[—–-]\s+/);
      purpose = dashSplit.length > 1 ? dashSplit.slice(1).join(' — ') : m[1];
      break;
    }
  }
  // Imports
  const imports = [];
  const importRe = /^import\s+(?:[^'";]+\s+from\s+)?['"](\.\/[^'"]+\.js)['"]/gm;
  let m2;
  while ((m2 = importRe.exec(text)) !== null) {
    imports.push(m2[1].replace(/^\.\//, '').replace(/\.js$/, ''));
  }
  return {
    name: relPath,
    shortName: relPath.replace(/^.*\//, '').replace(/\.js$/, ''),
    loc: lines.length,
    purpose: purpose || '(kein Header-Kommentar)',
    imports,
  };
}

// ── Domain ableiten ─────────────────────────────────────────────────────────
function findDomain(relPath) {
  for (const d of DOMAINS) {
    if (d.pattern.test(relPath)) return d;
  }
  return { id: 'misc', name: '❔ Sonstige' };
}

// ── Mermaid-Diagramm bauen ──────────────────────────────────────────────────
function buildMermaid(modules) {
  const byDomain = new Map();
  for (const m of modules) {
    const d = findDomain(m.name);
    if (!byDomain.has(d.id)) byDomain.set(d.id, { domain: d, modules: [] });
    byDomain.get(d.id).modules.push(m);
  }
  let s = 'graph LR\n';
  s += '%% Auto-generiert aus src/*.js\n\n';
  // Subgraphen pro Domäne
  for (const { domain, modules: mods } of byDomain.values()) {
    if (mods.length === 0) continue;
    s += `  subgraph ${domain.id}["${domain.name}"]\n`;
    for (const m of mods) {
      const safeId = m.shortName.replace(/[^a-zA-Z0-9_]/g, '_');
      s += `    ${safeId}["${m.shortName}"]\n`;
    }
    s += '  end\n';
  }
  s += '\n';
  // Wichtige Kanten — nur solche die DOMAIN-übergreifend gehen, sonst zu chaotisch
  for (const m of modules) {
    const dFrom = findDomain(m.name).id;
    const fromId = m.shortName.replace(/[^a-zA-Z0-9_]/g, '_');
    for (const imp of m.imports) {
      const target = modules.find(mm => mm.shortName === imp.replace(/^.*\//, ''));
      if (!target) continue;
      const dTo = findDomain(target.name).id;
      if (dFrom === dTo) continue;  // intra-Domain weglassen für Übersicht
      const toId = target.shortName.replace(/[^a-zA-Z0-9_]/g, '_');
      s += `  ${fromId} --> ${toId}\n`;
    }
  }
  return s;
}

// ── HTML-Tabelle bauen ──────────────────────────────────────────────────────
function buildTables(modules) {
  // Reverse-Map: wer importiert mich?
  const usedBy = new Map();
  for (const m of modules) {
    for (const imp of m.imports) {
      const target = imp.replace(/^.*\//, '');
      if (!usedBy.has(target)) usedBy.set(target, []);
      usedBy.get(target).push(m.shortName);
    }
  }

  const byDomain = new Map();
  for (const m of modules) {
    const d = findDomain(m.name);
    if (!byDomain.has(d.id)) byDomain.set(d.id, { domain: d, modules: [] });
    byDomain.get(d.id).modules.push(m);
  }

  let html = '';
  for (const { domain, modules: mods } of byDomain.values()) {
    if (mods.length === 0) continue;
    const totalLoc = mods.reduce((s, m) => s + m.loc, 0);
    html += `<h3>${esc(domain.name)} <span class="loc">(${mods.length} Module · ${totalLoc} LOC)</span></h3>\n`;
    html += '<table>\n';
    html += '<thead><tr><th>Modul</th><th>Zweck</th><th>LOC</th><th>Wird genutzt von</th></tr></thead>\n';
    html += '<tbody>\n';
    for (const m of mods.sort((a, b) => a.name.localeCompare(b.name))) {
      const users = usedBy.get(m.shortName) || [];
      const usersHtml = users.length === 0
        ? '<span class="muted">—</span>'
        : users.length <= 4
          ? users.map(u => `<code>${esc(u)}</code>`).join(', ')
          : `<code>${esc(users[0])}</code>, <code>${esc(users[1])}</code> <span class="muted">+${users.length-2}</span>`;
      html += `<tr><td><code>${esc(m.shortName)}</code></td><td>${esc(m.purpose)}</td><td class="num">${m.loc}</td><td>${usersHtml}</td></tr>\n`;
    }
    html += '</tbody></table>\n';
  }
  return html;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Generieren ──────────────────────────────────────────────────────────────
const files = listJsFiles(SRC_DIR);
const modules = files.map(parseModule);
const totalLoc = modules.reduce((s, m) => s + m.loc, 0);
const mermaid = buildMermaid(modules);
const tables = buildTables(modules);
const now = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

const html = `<!DOCTYPE html><html lang="de"><head>
<meta charset="UTF-8">
<title>Architektur — Energieplanung</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  body { font-family: 'DM Sans', sans-serif; max-width: 1400px; margin: 24px auto; padding: 0 24px; color: #1a2535; background: #f6f8fb; }
  h1 { color: #006064; margin-bottom: 4px; }
  h2 { color: #006064; margin-top: 32px; border-bottom: 2px solid #e0e0e0; padding-bottom: 4px; }
  h3 { color: #00838f; margin-top: 28px; font-size: 14px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .stats { display: flex; gap: 24px; margin: 16px 0; padding: 12px 16px; background: #fff; border-left: 4px solid #00838f; border-radius: 4px; }
  .stats > div { font-size: 13px; }
  .stats b { color: #006064; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; }
  th { padding: 6px 10px; text-align: left; background: #e0f7fa; color: #006064; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #00bcd4; }
  td { padding: 5px 10px; border-bottom: 1px solid #e8ecf0; vertical-align: top; }
  td.num { text-align: right; font-family: 'DM Mono', monospace; color: #607d8b; }
  code { background: #eff4f8; padding: 1px 5px; border-radius: 3px; font-size: 11px; color: #006064; }
  .muted { color: #999; font-size: 11px; }
  .loc { color: #888; font-weight: normal; font-size: 11px; }
  #mermaid-container { background: #fff; padding: 16px; border-radius: 6px; margin: 16px 0; overflow-x: auto; }
  #mermaid-fallback { display: none; padding: 12px 16px; background: #fff3c4; border-left: 4px solid #f9a825; border-radius: 4px; font-size: 12px; color: #5d4037; margin: 16px 0; }
  .legend { font-size: 11px; color: #666; margin: 8px 0 16px; }
</style>
</head><body>

<h1>🏗️ Architektur — Energieplanung</h1>
<div class="meta">Auto-generiert · ${esc(now)} · <a href="../index.html">← zum Tool</a></div>

<div class="stats">
  <div><b>${modules.length}</b> Module</div>
  <div><b>${totalLoc.toLocaleString('de-DE')}</b> Zeilen</div>
  <div><b>${DOMAINS.filter(d => modules.some(m => findDomain(m.name).id === d.id)).length}</b> Domänen</div>
</div>

<h2>Modul-Übersicht (Diagramm)</h2>
<div class="legend">Domain-Gruppen mit ihren Modulen. Pfeile zeigen domain-übergreifende Imports (intra-Domain weggelassen für Übersicht).</div>
<div id="mermaid-fallback">⚠ Mermaid-Diagramm konnte nicht geladen werden (offline?). Siehe Tabelle unten.</div>
<div id="mermaid-container">
<pre class="mermaid">
${mermaid}
</pre>
</div>

<h2>Modul-Tabellen nach Domäne</h2>
<div class="legend">Sortiert nach Code-Reihenfolge. „Wird genutzt von" hilft beim Refactor — wenn niemand mich nutzt, bin ich tot.</div>
${tables}

<script>
  // Fallback-Anzeige falls Mermaid-CDN nicht lädt
  setTimeout(() => {
    if (typeof mermaid === 'undefined') {
      document.getElementById('mermaid-fallback').style.display = 'block';
      document.getElementById('mermaid-container').style.display = 'none';
    } else {
      mermaid.initialize({ startOnLoad: true, theme: 'default', flowchart: { curve: 'basis' } });
    }
  }, 500);
</script>

</body></html>`;

mkdirSync(resolve('docs'), { recursive: true });
writeFileSync(OUT_HTML, html);
console.log(`Architektur-Doku: docs/architektur.html (${modules.length} Module, ${totalLoc} LOC)`);
