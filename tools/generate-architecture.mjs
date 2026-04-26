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
// Mermaid 10 ist pingelig:
//   - subgraph-Titel ohne Emojis (sonst Parser-Fehler)
//   - IDs müssen mit Buchstabe beginnen → Prefix 'm_'
//   - Bindestriche in Label-Texten in Anführungsstriche
function safeId(name) {
  return 'm_' + name.replace(/[^a-zA-Z0-9_]/g, '_');
}
function stripEmoji(s) {
  // Entfernt Unicode-Emojis (UC-Plane > BMP + Variation-Selectors)
  return s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
}

function buildMermaid(modules) {
  const byDomain = new Map();
  for (const m of modules) {
    const d = findDomain(m.name);
    if (!byDomain.has(d.id)) byDomain.set(d.id, { domain: d, modules: [] });
    byDomain.get(d.id).modules.push(m);
  }
  let s = 'graph LR\n';
  for (const { domain, modules: mods } of byDomain.values()) {
    if (mods.length === 0) continue;
    const title = stripEmoji(domain.name);
    s += `  subgraph d_${domain.id}["${title}"]\n`;
    for (const m of mods) {
      s += `    ${safeId(m.shortName)}["${m.shortName}"]\n`;
    }
    s += '  end\n';
  }
  // Domain-übergreifende Imports als Kanten
  for (const m of modules) {
    const dFrom = findDomain(m.name).id;
    for (const imp of m.imports) {
      const target = modules.find(mm => mm.shortName === imp.replace(/^.*\//, ''));
      if (!target) continue;
      const dTo = findDomain(target.name).id;
      if (dFrom === dTo) continue;
      s += `  ${safeId(m.shortName)} --> ${safeId(target.shortName)}\n`;
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
  :root {
    --bg:        #0b0e18;
    --surface:   #12182a;
    --surface2:  #1a2535;
    --text:      #cfd;
    --muted:     #7a8099;
    --border:    #2a3050;
    --accent:    #4fc3f7;
    --accent2:   #26a69a;
    --warn:      #f9a825;
  }
  body {
    font-family: 'DM Sans', system-ui, sans-serif;
    max-width: 1400px; margin: 0 auto; padding: 24px;
    color: var(--text); background: var(--bg);
  }
  h1 { color: var(--accent); margin: 0 0 4px; font-weight: 600; font-size: 22px; }
  h2 { color: var(--accent); margin-top: 32px; border-bottom: 1px solid var(--border);
       padding-bottom: 6px; font-size: 15px; font-weight: 600; text-transform: uppercase;
       letter-spacing: .05em; }
  h3 { color: var(--accent2); margin-top: 24px; font-size: 13px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 11px; margin-bottom: 16px; }
  .meta a { color: var(--accent); text-decoration: none; }
  .meta a:hover { text-decoration: underline; }
  .stats {
    display: flex; gap: 18px; margin: 14px 0;
    padding: 12px 16px; background: var(--surface);
    border-left: 3px solid var(--accent); border-radius: 4px;
  }
  .stats > div { font-size: 12px; color: var(--muted); }
  .stats b { color: var(--text); font-size: 18px; display: block; font-weight: 600; }
  table {
    width: 100%; border-collapse: collapse; font-size: 11px;
    background: var(--surface); border-radius: 4px; overflow: hidden;
    margin-top: 8px;
  }
  th {
    padding: 6px 10px; text-align: left;
    background: var(--surface2); color: var(--accent);
    font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
    border-bottom: 1px solid var(--border); font-weight: 600;
  }
  td { padding: 5px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td.num { text-align: right; font-family: 'DM Mono', monospace; color: var(--muted); font-size: 10px; }
  code {
    background: rgba(79,195,247,.08);
    padding: 1px 6px; border-radius: 3px;
    font-family: 'DM Mono', monospace; font-size: 10px;
    color: var(--accent);
  }
  .muted { color: var(--muted); font-size: 10px; }
  .loc { color: var(--muted); font-weight: normal; font-size: 10px; }
  #mermaid-container {
    background: var(--surface); padding: 16px; border-radius: 4px;
    margin: 12px 0; overflow-x: auto;
    border: 1px solid var(--border);
  }
  /* Mermaid-Diagramm-Farben überschreiben für Dark-Theme */
  #mermaid-container .mermaid { color: var(--text); }
  #mermaid-container svg { background: transparent !important; max-width: 100%; }
  #mermaid-fallback {
    display: none; padding: 12px 16px;
    background: rgba(249,168,37,.10); border-left: 3px solid var(--warn);
    border-radius: 4px; font-size: 11px; color: var(--warn); margin: 12px 0;
  }
  .legend { font-size: 10px; color: var(--muted); margin: 6px 0 12px; line-height: 1.5; }
</style>
</head><body>

<h1>🏗️ Architektur — Energieplanung</h1>
<div class="meta">Auto-generiert · ${esc(now)} · <a href="../index.html">← zum Tool</a></div>

<div class="stats">
  <div><b>${modules.length}</b>Module</div>
  <div><b>${totalLoc.toLocaleString('de-DE')}</b>Zeilen</div>
  <div><b>${DOMAINS.filter(d => modules.some(m => findDomain(m.name).id === d.id)).length}</b>Domänen</div>
</div>

<h2>Modul-Übersicht (Diagramm)</h2>
<div class="legend">Subgraphen = Domänen. Pfeile = domain-übergreifende Imports (intra-Domain für Übersicht weggelassen).</div>
<div id="mermaid-fallback">⚠ Mermaid-Diagramm konnte nicht geladen werden (offline / CDN nicht erreichbar). Siehe Tabellen unten.</div>
<div id="mermaid-container">
<pre class="mermaid">
${mermaid}
</pre>
</div>

<h2>Modul-Tabellen nach Domäne</h2>
<div class="legend">Spalte „Wird genutzt von" hilft beim Refactor: wenn niemand mich nutzt, kann ich vermutlich raus.</div>
${tables}

<script>
  setTimeout(() => {
    if (typeof mermaid === 'undefined') {
      document.getElementById('mermaid-fallback').style.display = 'block';
      document.getElementById('mermaid-container').style.display = 'none';
      return;
    }
    try {
      mermaid.initialize({
        startOnLoad: true,
        theme: 'dark',
        themeVariables: {
          primaryColor:        '#1a2535',
          primaryTextColor:    '#cfd',
          primaryBorderColor:  '#4fc3f7',
          lineColor:           '#4fc3f7',
          secondaryColor:      '#12182a',
          tertiaryColor:       '#0b0e18',
          background:          'transparent',
          mainBkg:             '#1a2535',
          clusterBkg:          'rgba(79,195,247,0.04)',
          clusterBorder:       '#2a3050',
        },
        flowchart: { curve: 'basis', padding: 16 },
      });
    } catch (e) {
      console.error('Mermaid init:', e);
      document.getElementById('mermaid-fallback').style.display = 'block';
    }
  }, 100);
</script>

</body></html>`;

mkdirSync(resolve('docs'), { recursive: true });
writeFileSync(OUT_HTML, html);
console.log(`Architektur-Doku: docs/architektur.html (${modules.length} Module, ${totalLoc} LOC)`);
