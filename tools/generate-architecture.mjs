// ── tools/generate-architecture.mjs ───────────────────────────────────────
// Generiert docs/architektur.html als Dashboard mit 4 Tabs:
//   1. Bereiche       — 6 Domain-Kacheln mit Modul-Liste
//   2. Workflows      — 7 typische User-Stories als Schritt-Ketten
//   3. Treemap        — alle Module visuell (Fläche = LOC, Farbe = Domain)
//   4. Detail-Tabelle — alle Module mit Imports + Used-By

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const SRC_DIR = resolve('src');
const OUT_HTML = resolve('docs', 'architektur.html');

// ── Domain-Mapping mit Farbe + Icon ────────────────────────────────────────
const DOMAINS = [
  { id: 'karte',     name: 'Karte & Gebäude',          icon: '🗺️', color: '#66bb6a',
    pattern: /^02[abc]-|^03[bc]-/, desc: 'Karte zeichnen, OSM-Import, Gebäude verwalten, Wärmenetz verlegen' },
  { id: 'waerme',    name: 'Wärme & Erzeuger',         icon: '🔥', color: '#ff7043',
    pattern: /^03a-|^06[abc]-/, desc: 'Heizungs-Erzeuger anlegen, Lastgang berechnen, Stunden-Dispatch' },
  { id: 'wirt',      name: 'Berechnung & Wirtschaft',  icon: '💰', color: '#ffa726',
    pattern: /^07[ab]-|^08-|^09[abc]-/, desc: 'CalcEngine (KWW-Kosten), Wirtschaftlichkeit, PV-Profile' },
  { id: 'opti',      name: 'Optimizer',                icon: '🎯', color: '#ab47bc',
    pattern: /^10[abcd]-/, desc: 'Variantensuche: Erzeuger-Mix mit min. WGK oder min. CO₂' },
  { id: 'strom',     name: 'Strom (Phase 3)',          icon: '⚡', color: '#4fc3f7',
    pattern: /^13[abcde]-|^14[abc]-|^15[a-z]-|^16/, desc: 'Asset-System, Trassen, Spannungsfall, SLD, Trafo-Optimierung' },
  { id: 'foto',      name: 'Fotos (Phase 4)',          icon: '📷', color: '#ce93d8',
    pattern: /^17[abc]-/, desc: 'Fotos zu Anlagen anhängen — Mobile-Kamera + IndexedDB-Speicher' },
  { id: 'glue',      name: 'UI & Infrastruktur',       icon: '🎬', color: '#78909c',
    pattern: /^01-|^04[ab]-|^05[abc]-|^11-|^12-|^main\.js$|^config\//,
    desc: 'Globals, UI-Panels, Export, Hilfe-System, Inline-Event-Handler' },
];

// ── Workflows (handgepflegt — was passiert wenn der User XY tut) ───────────
const WORKFLOWS = [
  {
    id: 'osm', icon: '↓', title: 'OSM-Import: Gebäude aus Karte laden',
    steps: [
      { actor: 'User',     do: 'klickt "↓ OSM-Import"' },
      { actor: 'index.html', do: 'data-click → loadOsmBuildings()' },
      { actor: '03b-netz', do: 'WFS-Query oder Overpass-Fallback' },
      { actor: '03b-netz', do: 'parseWfsGeoJson / parseOsmData (mit Mindestfläche-Filter)' },
      { actor: '02b-gebaeude', do: 'addGebaeude pro Polygon' },
      { actor: '13d-assets-autocreate', do: 'auto: UV+Verbraucher+PV pro Gebäude' },
      { actor: '02c-karte-werkzeuge', do: 'updateViz zeichnet Polygone + Kreise' },
    ],
  },
  {
    id: 'asset', icon: '🧩', title: 'Anlage als Asset platzieren',
    steps: [
      { actor: 'User',     do: 'klickt 🧩 (Asset platzieren)' },
      { actor: '13c-assets-ui', do: 'baut Palette mit allen Asset-Typen auf' },
      { actor: 'User',     do: 'wählt Typ (z.B. NAP) und klickt Karte' },
      { actor: '13c-assets-ui', do: 'onMapClickForAsset → createAsset' },
      { actor: '13a-assets-core', do: 'ASSETS.items wächst um 1' },
      { actor: '13b-assets-render', do: 'drawAssetMarker zeichnet Icon' },
    ],
  },
  {
    id: 'trasse', icon: '╱', title: 'Trasse zeichnen',
    steps: [
      { actor: 'User',     do: 'Strom-Tab → "╱ Trasse zeichnen"' },
      { actor: '15b-stromnetz-draw', do: 'setStromnetzMode("trasse"), Cursor = Fadenkreuz' },
      { actor: 'User',     do: 'Klicks auf Karte (Snap-Hilfe an existierende Trassen)' },
      { actor: '15b',      do: 'addTrassePoint pro Klick → STROMNETZ.trDraw.pts wächst' },
      { actor: 'User',     do: 'Doppelklick = Fertig' },
      { actor: '15b',      do: 'finishTrasseSegment → createTrasse (14b)' },
      { actor: '15a-stromnetz-render', do: 'drawTrasse zeichnet Polyline' },
    ],
  },
  {
    id: 'leitung', icon: '—', title: 'Leitung Asset → Asset ziehen',
    steps: [
      { actor: 'User',     do: 'Strom-Tab → "— Leitung ziehen"' },
      { actor: '15b',      do: 'setStromnetzMode("leitung"), Asset-Klicks abfangen' },
      { actor: 'User',     do: 'klickt Start-Asset' },
      { actor: 'User',     do: 'klickt Ziel-Asset' },
      { actor: '15b.route', do: 'Dijkstra über Trassen-Graph (14c) findet Pfad' },
      { actor: '14b',      do: 'createStromLeitung in ASSETS.edges' },
      { actor: '15a',      do: 'drawLeitung zeichnet Polyline mit Parallel-Offset' },
    ],
  },
  {
    id: 'recalc', icon: '🔄', title: 'Strom-Recalc ausführen',
    steps: [
      { actor: 'User',     do: 'klickt "🔄 Recalc"' },
      { actor: '16-stromnetz-ui', do: 'uiRecalcStromnetz → ruft recalcStromnetz' },
      { actor: '15c-stromnetz-calc', do: 'BFS-Lastflussberechnung pro Leitung' },
      { actor: '15c',      do: 'Spannungsfall (kumulativ vom Trafo aus)' },
      { actor: '15c',      do: 'Trafo-Auslastung Worst-Case' },
      { actor: '15c',      do: 'färbt lt._poly grün/gelb/rot' },
      { actor: 'Overlay',  do: 'zeigt Summary + Warnungen' },
    ],
  },
  {
    id: 'foto', icon: '📷', title: 'Foto zu einer Anlage hinzufügen',
    steps: [
      { actor: 'User',     do: 'Inspector → "📷 Fotos verwalten"' },
      { actor: '17c-fotos-ui', do: 'openFotoPanel zeigt Galerie' },
      { actor: 'User',     do: 'klickt "➕ Foto" → Datei wählen / Mobile-Kamera' },
      { actor: '17b-fotos-compress', do: 'compressImage: 1024px / JPEG 75% → ~200 KB' },
      { actor: '17a-fotos-storage', do: 'savePhoto: IndexedDB (Firefox) oder localStorage (Edge)' },
      { actor: 'asset.photoIds', do: 'wächst um neue ID' },
      { actor: '17c',      do: 'Galerie-Refresh' },
    ],
  },
  {
    id: 'waerme', icon: '🔥', title: 'Wärme-Berechnung & Dispatch',
    steps: [
      { actor: 'User',     do: 'tippt Gebäude- oder Erzeuger-Werte' },
      { actor: '06b-gl-berechnen', do: 'glBerechnenDebounced (1 Sek nach letzter Änderung)' },
      { actor: '06b',      do: 'glBerechnen: Lastgang aus DWD-Klima + Profil-Synthese' },
      { actor: '06c-dispatch-core', do: '_dispatchCore: ST → Merit-Order → Speicher → Kessel' },
      { actor: '08-calc-engine', do: 'investEurProKw + Annuität (KWW + VDI 2067)' },
      { actor: '07b-analysis-economics', do: 'WGK-Berechnung pro Erzeuger' },
      { actor: '07a-analysis-charts', do: 'Charts updaten' },
    ],
  },
];

// ── Datei scannen ──────────────────────────────────────────────────────────
function listJsFiles(dir, prefix = '') {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) out.push(...listJsFiles(join(dir, f.name), prefix + f.name + '/'));
    else if (f.name.endsWith('.js')) out.push(prefix + f.name);
  }
  return out;
}

function parseModule(relPath) {
  const text = readFileSync(join(SRC_DIR, relPath), 'utf8');
  const lines = text.split('\n');
  let purpose = '';
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const m = lines[i].match(/^\/\/\s*[─=]+\s*([^─=]+?)\s*[─=]+/) ||
              lines[i].match(/^\/\/\s*(.+?)\s*[─=]+/);
    if (m) {
      const dashSplit = m[1].split(/\s+[—–-]\s+/);
      purpose = dashSplit.length > 1 ? dashSplit.slice(1).join(' — ') : m[1];
      break;
    }
  }
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

function findDomain(relPath) {
  for (const d of DOMAINS) if (d.pattern.test(relPath)) return d;
  return { id: 'misc', name: 'Sonstige', icon: '❔', color: '#999', desc: '' };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Daten aufbereiten ──────────────────────────────────────────────────────
const files = listJsFiles(SRC_DIR);
const modules = files.map(parseModule);
const totalLoc = modules.reduce((s, m) => s + m.loc, 0);
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

// ── Tab 1: Bereiche-Kacheln ────────────────────────────────────────────────
function renderBereiche() {
  let html = '<div class="bereiche-grid">';
  for (const d of DOMAINS) {
    const entry = byDomain.get(d.id);
    if (!entry) continue;
    const mods = entry.modules.sort((a, b) => a.name.localeCompare(b.name));
    const loc = mods.reduce((s, m) => s + m.loc, 0);
    const modsHtml = mods.map(m =>
      `<span class="mod-chip" title="${esc(m.purpose)}">${esc(m.shortName)}</span>`).join(' ');
    html += `
      <div class="kachel" style="border-left-color:${d.color};">
        <div class="k-header">
          <span class="k-icon">${d.icon}</span>
          <span class="k-title">${esc(d.name)}</span>
        </div>
        <div class="k-desc">${esc(d.desc)}</div>
        <div class="k-stats">${mods.length} Module · ${loc.toLocaleString('de-DE')} LOC</div>
        <div class="k-mods">${modsHtml}</div>
      </div>`;
  }
  html += '</div>';
  return html;
}

// ── Tab 2: Workflows ───────────────────────────────────────────────────────
function renderWorkflows() {
  let html = '<div class="workflows">';
  for (const wf of WORKFLOWS) {
    const stepsHtml = wf.steps.map((s, i) => `
      <div class="step">
        <div class="step-num">${i+1}</div>
        <div class="step-body">
          <span class="step-actor">${esc(s.actor)}</span>
          <span class="step-do">${esc(s.do)}</span>
        </div>
      </div>`).join('<div class="step-arrow">↓</div>');
    html += `
      <div class="workflow">
        <h3><span class="wf-icon">${wf.icon}</span> ${esc(wf.title)}</h3>
        <div class="steps">${stepsHtml}</div>
      </div>`;
  }
  html += '</div>';
  return html;
}

// ── Tab 3: Treemap (CSS-Flex squarified) ───────────────────────────────────
// Vereinfachtes Treemap: pro Domain ein Flex-Container, Module proportional zu LOC
function renderTreemap() {
  let html = '<div class="treemap">';
  const domains = DOMAINS.map(d => ({ d, mods: byDomain.get(d.id)?.modules || [] }))
    .filter(x => x.mods.length > 0)
    .map(x => ({ ...x, totalLoc: x.mods.reduce((s, m) => s + m.loc, 0) }))
    .sort((a, b) => b.totalLoc - a.totalLoc);

  for (const { d, mods, totalLoc: dl } of domains) {
    const flexBasis = (dl / totalLoc * 100).toFixed(2);
    const sortedMods = mods.sort((a, b) => b.loc - a.loc);
    const tilesHtml = sortedMods.map(m => {
      const flex = m.loc;  // flex-grow = LOC
      const fontSize = Math.max(9, Math.min(13, Math.sqrt(m.loc) / 4));
      const showLoc = m.loc > 200;
      return `<div class="tm-mod" style="flex:${flex} 1 0;background:${d.color}22;border:1px solid ${d.color}66;color:${d.color};"
                   data-name="${esc(m.shortName)}" data-purpose="${esc(m.purpose)}" data-loc="${m.loc}"
                   onclick='showModDetail(${JSON.stringify({name:m.shortName, purpose:m.purpose, loc:m.loc, imports:m.imports, usedBy:usedBy.get(m.shortName)||[]}).replace(/'/g, "&#39;")})'>
                <div class="tm-name" style="font-size:${fontSize}px">${esc(m.shortName)}</div>
                ${showLoc ? `<div class="tm-loc">${m.loc} LOC</div>` : ''}
              </div>`;
    }).join('');
    html += `
      <div class="tm-domain" style="flex:${dl} 1 ${flexBasis}%;">
        <div class="tm-dheader" style="background:${d.color}33;color:${d.color};">
          ${d.icon} ${esc(d.name)} <span style="opacity:.7;font-size:10px;">${dl.toLocaleString('de-DE')} LOC</span>
        </div>
        <div class="tm-tiles">${tilesHtml}</div>
      </div>`;
  }
  html += '</div>';
  return html;
}

// ── Tab 4: Detail-Tabelle ──────────────────────────────────────────────────
function renderTabelle() {
  let html = '';
  for (const d of DOMAINS) {
    const entry = byDomain.get(d.id);
    if (!entry) continue;
    const mods = entry.modules.sort((a, b) => a.name.localeCompare(b.name));
    const loc = mods.reduce((s, m) => s + m.loc, 0);
    html += `<h3 style="color:${d.color};">${d.icon} ${esc(d.name)} <span class="loc">(${mods.length} · ${loc} LOC)</span></h3>\n<table>\n`;
    html += '<thead><tr><th>Modul</th><th>Zweck</th><th>LOC</th><th>Importiert</th><th>Genutzt von</th></tr></thead>\n<tbody>\n';
    for (const m of mods) {
      const users = usedBy.get(m.shortName) || [];
      const imps = (m.imports || []).map(i => i.replace(/^.*\//, ''));
      const fmt = arr => arr.length === 0 ? '<span class="muted">—</span>' :
        arr.length <= 3 ? arr.map(x => `<code>${esc(x)}</code>`).join(' ') :
        arr.slice(0,2).map(x => `<code>${esc(x)}</code>`).join(' ') + ` <span class="muted">+${arr.length-2}</span>`;
      html += `<tr><td><code>${esc(m.shortName)}</code></td><td>${esc(m.purpose)}</td><td class="num">${m.loc}</td><td>${fmt(imps)}</td><td>${fmt(users)}</td></tr>\n`;
    }
    html += '</tbody></table>\n';
  }
  return html;
}

const now = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

const html = `<!DOCTYPE html><html lang="de"><head>
<meta charset="UTF-8">
<title>Architektur — Energieplanung</title>
<style>
  :root {
    --bg: #0b0e18; --surface: #12182a; --surface2: #1a2535;
    --text: #cfd; --muted: #7a8099; --border: #2a3050;
    --accent: #4fc3f7;
  }
  * { box-sizing: border-box; }
  body { font-family: 'DM Sans', system-ui, sans-serif; max-width: 1500px; margin: 0 auto;
         padding: 20px; color: var(--text); background: var(--bg); }
  h1 { color: var(--accent); margin: 0 0 4px; font-weight: 600; font-size: 22px; }
  .meta { color: var(--muted); font-size: 11px; margin-bottom: 16px; }
  .meta a { color: var(--accent); text-decoration: none; }
  .stats-bar { display: flex; gap: 18px; margin: 14px 0 20px; padding: 12px 16px;
               background: var(--surface); border-left: 3px solid var(--accent); border-radius: 4px; }
  .stats-bar > div { font-size: 12px; color: var(--muted); }
  .stats-bar b { color: var(--text); font-size: 18px; display: block; font-weight: 600; }

  /* ── Tabs ── */
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .tab-btn { background: transparent; border: 1px solid var(--border); border-bottom: none;
             color: var(--muted); padding: 10px 18px; cursor: pointer; font-size: 13px;
             border-radius: 6px 6px 0 0; font-family: inherit; transition: all .15s; }
  .tab-btn:hover { color: var(--text); background: var(--surface); }
  .tab-btn.active { color: var(--accent); background: var(--surface); border-color: var(--accent);
                    border-bottom: 1px solid var(--surface); margin-bottom: -1px; font-weight: 600; }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  /* ── Tab 1: Bereiche ── */
  .bereiche-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                   gap: 14px; }
  .kachel { background: var(--surface); border-radius: 6px; padding: 14px 16px;
            border-left: 4px solid #555; }
  .k-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .k-icon { font-size: 20px; }
  .k-title { font-size: 15px; font-weight: 600; color: var(--text); }
  .k-desc { font-size: 11px; color: var(--muted); line-height: 1.5; margin-bottom: 8px; }
  .k-stats { font-size: 10px; color: var(--accent); margin-bottom: 8px; text-transform: uppercase;
             letter-spacing: .04em; }
  .k-mods { display: flex; flex-wrap: wrap; gap: 4px; }
  .mod-chip { background: rgba(79,195,247,.08); color: var(--accent); padding: 2px 7px;
              border-radius: 3px; font-family: 'DM Mono', monospace; font-size: 10px; cursor: help; }

  /* ── Tab 2: Workflows ── */
  .workflows { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
               gap: 16px; }
  .workflow { background: var(--surface); border-radius: 6px; padding: 14px; border-left: 3px solid var(--accent); }
  .workflow h3 { margin: 0 0 12px; color: var(--text); font-size: 13px; font-weight: 600;
                 display: flex; align-items: center; gap: 8px; }
  .wf-icon { font-size: 18px; }
  .steps { display: flex; flex-direction: column; }
  .step { display: flex; gap: 10px; align-items: flex-start; padding: 4px 0; }
  .step-num { background: var(--surface2); color: var(--accent); width: 22px; height: 22px;
              border-radius: 50%; display: flex; align-items: center; justify-content: center;
              font-size: 11px; font-weight: 600; flex-shrink: 0; }
  .step-body { flex: 1; font-size: 11px; line-height: 1.5; }
  .step-actor { color: var(--accent); font-family: 'DM Mono', monospace; font-size: 10px;
                margin-right: 6px; }
  .step-do { color: var(--text); }
  .step-arrow { color: var(--border); margin-left: 11px; font-size: 12px; line-height: .5; }

  /* ── Tab 3: Treemap ── */
  .treemap { display: flex; flex-wrap: wrap; gap: 8px; min-height: 600px; }
  .tm-domain { display: flex; flex-direction: column; min-width: 250px; }
  .tm-dheader { padding: 6px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 4px 0 0; }
  .tm-tiles { flex: 1; display: flex; flex-wrap: wrap; gap: 3px; padding: 3px;
              background: var(--surface); border-radius: 0 0 4px 4px; min-height: 100px; }
  .tm-mod { display: flex; flex-direction: column; align-items: center; justify-content: center;
            padding: 4px; border-radius: 3px; cursor: pointer; min-width: 60px; min-height: 50px;
            font-family: 'DM Mono', monospace; transition: all .15s; }
  .tm-mod:hover { transform: scale(1.05); box-shadow: 0 0 8px rgba(79,195,247,.3); }
  .tm-name { font-weight: 600; text-align: center; line-height: 1.2; }
  .tm-loc { font-size: 9px; opacity: .7; margin-top: 3px; }
  /* Modul-Detail-Modal */
  #mod-detail { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: none;
                align-items: center; justify-content: center; z-index: 9999; }
  #mod-detail.show { display: flex; }
  .md-card { background: var(--surface2); border: 2px solid var(--accent); border-radius: 8px;
             padding: 20px; max-width: 600px; width: 90%; max-height: 80vh; overflow: auto;
             color: var(--text); }
  .md-card h3 { color: var(--accent); margin: 0 0 12px; font-family: 'DM Mono', monospace; }
  .md-card .row { margin: 8px 0; font-size: 12px; }
  .md-card .row b { color: var(--muted); display: inline-block; min-width: 100px; font-weight: normal; }
  .md-card code { background: rgba(79,195,247,.08); color: var(--accent); padding: 1px 5px;
                  border-radius: 3px; font-size: 11px; }
  .md-close { float: right; background: transparent; border: 1px solid var(--border); color: var(--muted);
              cursor: pointer; padding: 3px 10px; border-radius: 4px; font-size: 14px; }

  /* ── Tab 4: Tabelle ── */
  table { width: 100%; border-collapse: collapse; font-size: 11px; background: var(--surface);
          border-radius: 4px; overflow: hidden; margin-top: 8px; }
  th { padding: 6px 10px; text-align: left; background: var(--surface2); color: var(--accent);
       font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
       border-bottom: 1px solid var(--border); font-weight: 600; }
  td { padding: 5px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td.num { text-align: right; font-family: 'DM Mono', monospace; color: var(--muted); font-size: 10px; }
  code { background: rgba(79,195,247,.08); padding: 1px 5px; border-radius: 3px;
         font-family: 'DM Mono', monospace; font-size: 10px; color: var(--accent); }
  .muted { color: var(--muted); font-size: 10px; }
  .loc { color: var(--muted); font-weight: normal; font-size: 11px; }
</style>
</head><body>

<h1>🏗️ Architektur — Energieplanung</h1>
<div class="meta">Auto-generiert · ${esc(now)} · <a href="../index.html">← zum Tool</a></div>

<div class="stats-bar">
  <div><b>${modules.length}</b>Module</div>
  <div><b>${totalLoc.toLocaleString('de-DE')}</b>Zeilen Code</div>
  <div><b>${WORKFLOWS.length}</b>Workflows dokumentiert</div>
  <div><b>${DOMAINS.filter(d => byDomain.has(d.id)).length}</b>Bereiche</div>
</div>

<div class="tabs">
  <button class="tab-btn active" data-tab="bereiche">📦 Bereiche</button>
  <button class="tab-btn" data-tab="workflows">🔀 Workflows</button>
  <button class="tab-btn" data-tab="treemap">🧱 Modul-Treemap</button>
  <button class="tab-btn" data-tab="tabelle">📋 Detail-Tabelle</button>
</div>

<div class="tab-pane active" id="tab-bereiche">${renderBereiche()}</div>
<div class="tab-pane" id="tab-workflows">${renderWorkflows()}</div>
<div class="tab-pane" id="tab-treemap">${renderTreemap()}</div>
<div class="tab-pane" id="tab-tabelle">${renderTabelle()}</div>

<div id="mod-detail" onclick="if(event.target.id==='mod-detail')this.classList.remove('show')">
  <div class="md-card">
    <button class="md-close" onclick="document.getElementById('mod-detail').classList.remove('show')">✕</button>
    <h3 id="md-name"></h3>
    <div class="row"><b>Zweck:</b> <span id="md-purpose"></span></div>
    <div class="row"><b>Code-Zeilen:</b> <span id="md-loc"></span></div>
    <div class="row"><b>Importiert:</b> <span id="md-imports"></span></div>
    <div class="row"><b>Genutzt von:</b> <span id="md-usedby"></span></div>
  </div>
</div>

<script>
  // Tab-Logik
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
  // Modul-Detail-Modal (Treemap-Klick)
  function showModDetail(d) {
    document.getElementById('md-name').textContent = d.name;
    document.getElementById('md-purpose').textContent = d.purpose;
    document.getElementById('md-loc').textContent = d.loc;
    document.getElementById('md-imports').innerHTML = (d.imports||[]).length === 0 ? '<span class="muted">—</span>' :
      d.imports.map(i => '<code>' + i.replace(/^.*\\//, '') + '</code>').join(' ');
    document.getElementById('md-usedby').innerHTML = (d.usedBy||[]).length === 0 ? '<span class="muted">— (Dead Code? Oder Entry-Point)</span>' :
      d.usedBy.map(i => '<code>' + i + '</code>').join(' ');
    document.getElementById('mod-detail').classList.add('show');
  }
</script>

</body></html>`;

mkdirSync(resolve('docs'), { recursive: true });
writeFileSync(OUT_HTML, html);
console.log(`Architektur-Doku: docs/architektur.html (${modules.length} Module, ${totalLoc} LOC, ${WORKFLOWS.length} Workflows)`);
