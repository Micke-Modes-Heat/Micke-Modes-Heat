// ── 14e-ausbauplaner-ui.js — Ausbauplaner-Board ───────────────────────────────
// Fahrplan-Board für ALLE Maßnahmen ALLER Assets (gekoppelt an den Bulk-Modus):
// Gantt-Swimlanes je Gewerk (Maßnahmen-Typ), Spalten = Phasen, Drag-Drop zwischen
// Phasen (schreibt direkt auf die Maßnahme zurück), dependsOn-Pfeile, Validierung.

import { ASSETS } from './13a-assets-core.js';
import { phasen, setPhasen } from './01-globals-varianten.js';
import { fahrplanTopoSort, fahrplanValidiereReihenfolge } from './14c-phasen.js';
import { MASSN_VORLAGEN, MASSN_VORLAGEN_REIHENFOLGE } from './config/massnahmen-vorlagen.js';
import { clusters, clusterFuerGebaeude } from './14f-cluster-core.js';

// ── Gewerk-Farben (Maßnahmen-Typen) ──────────────────────────────────────────
const GEWERK_COLOR = {
  Ertuechtigung: '#f59e0b',
  Bau:           '#4fc3f7',
  Sanierung:     '#a78bfa',
  Abriss:        '#f87171',
};
const GEWERK_FALLBACK_COLOR = '#90a4ae';

// ── Modul-State ───────────────────────────────────────────────────────────────
let _plan       = { items: [] };
let _konflikte  = new Set();
let _draggingId = null;
let _gruppierung = 'gewerk';   // 'gewerk' | 'cluster' — Swimlane-Achse
const OHNE_CLUSTER = '__ohne__';

function _planningChange(label, mutate) {
  try { (typeof window.runPlanningTransaction === 'function' ? window.runPlanningTransaction(label, mutate) : mutate()); return true; }
  catch (error) { console.error(error); alert(error.message); return false; }
}

// ── Init + Show/Hide ──────────────────────────────────────────────────────────

export function ausbauInit() {
  if (document.getElementById('ausbauplaner-wrap')) return;
  const wrap = document.createElement('div');
  wrap.id = 'ausbauplaner-wrap';
  wrap.style.display = 'none';
  wrap.innerHTML = `
<div id="ausb-inner" style="display:flex;flex-direction:row;height:calc(100vh - 160px);min-height:400px;gap:0;background:var(--bg);border-radius:8px;overflow:hidden;border:1px solid var(--border);">
  <div id="ausb-sidebar" style="width:220px;overflow-y:auto;flex-shrink:0;border-right:1px solid var(--border);padding:10px 10px 16px;background:var(--surface);"></div>
  <div id="ausb-main" style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;">
    <div id="ausb-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--surface2);flex-shrink:0;flex-wrap:wrap;font-size:11px;"></div>
    <div id="ausb-content" style="flex:1;overflow:auto;padding:10px 14px;"></div>
  </div>
</div>`;
  const analyseView = document.getElementById('center-analyse-view');
  if (analyseView) analyseView.appendChild(wrap);
}

export function ausbauShow(visible) {
  ausbauInit();
  const wrap = document.getElementById('ausbauplaner-wrap');
  if (!wrap) return;
  wrap.style.display = visible ? '' : 'none';
  if (visible) ausbauRender();
}

// ── Haupt-Render ──────────────────────────────────────────────────────────────

export function ausbauRender() {
  _buildPlan();
  _validatePlan();
  _renderSidebar();
  _renderToolbar();
  _renderGantt();
}

// ── Plan aus den Maßnahmen aller Assets aufbauen ──────────────────────────────
// Jedes Plan-Item referenziert die echte Maßnahme (_m), damit Drag-Drop direkt
// die phaseId der Maßnahme am Asset überschreibt (Kopplung mit dem Bulk-Modus).

function _buildPlan() {
  const items = [];
  // Elektro-Asset-Maßnahmen
  for (const a of ASSETS.items) {
    for (const m of (a.massnahmen || [])) {
      if (!m || !m.typ) continue;
      items.push({
        id:        m.id,
        assetId:   a.id,
        assetName: a.name,
        typ:       m.typ,
        titel:     a.name,
        kosten:    m.kosten || 0,
        status:    m.status || 'geplant',
        phaseId:   m.phaseId || null,
        jahr:      m.jahr ?? null,
        dependsOn: m.dependsOn || [],
        clusterId:   m.clusterId || null,
        clusterName: m.clusterName || null,
        _m:        m,
      });
    }
  }
  // Gebäude-Maßnahmen (u.a. aus Cluster-Paketen). Cluster-Zuordnung: explizites Tag
  // gewinnt, sonst Live-Mitgliedschaft (Schwerpunkt-in-Polygon).
  for (const g of (window.gebaeude || [])) {
    if (!Array.isArray(g.massnahmen) || !g.massnahmen.length) continue;
    const liveCl = clusterFuerGebaeude(g, clusters);
    for (const m of g.massnahmen) {
      if (!m || !m.typ) continue;
      items.push({
        id:        m.id,
        assetId:   g.id,
        assetName: g.name,
        typ:       m.typ,
        titel:     g.name || ('Gebäude ' + g.id),
        kosten:    m.kosten || 0,
        status:    m.status || 'geplant',
        phaseId:   m.phaseId || null,
        jahr:      m.jahr ?? null,
        dependsOn: m.dependsOn || [],
        clusterId:   m.clusterId || (liveCl ? liveCl.id : null),
        clusterName: m.clusterName || (liveCl ? liveCl.name : null),
        _m:        m,
      });
    }
  }
  _plan = { items };
}

// ── Swimlane-Achsen: Gewerk (Maßnahmen-Typ) oder Cluster ──────────────────────
function _lanes() {
  if (_gruppierung === 'cluster') return _clusterLanes();
  return _gewerke().map(g => ({ ...g, match: it => it.typ === g.key }));
}

function _clusterLanes() {
  // Cluster in fester Reihenfolge (Stufe, dann Name); nur solche mit Maßnahmen + Rest-Lane.
  const vorhanden = new Set(_plan.items.map(it => it.clusterId || OHNE_CLUSTER));
  const geordnet = [...clusters]
    .sort((a, b) => (a.stufe ?? 99) - (b.stufe ?? 99) || String(a.name).localeCompare(String(b.name)))
    .filter(c => vorhanden.has(c.id))
    .map(c => ({ key: c.id, label: c.name + (c.stufe != null ? ` (St. ${c.stufe})` : ''), icon: '🗺', color: c.farbe, match: it => it.clusterId === c.id }));
  if (vorhanden.has(OHNE_CLUSTER)) {
    geordnet.push({ key: OHNE_CLUSTER, label: 'ohne Cluster', icon: '', color: GEWERK_FALLBACK_COLOR, match: it => !it.clusterId });
  }
  return geordnet;
}

// Aktive Gewerk-Swimlanes (nur Typen, die tatsächlich vorkommen — Katalog zuerst).
function _gewerke() {
  const present = new Set(_plan.items.map(it => it.typ));
  const ordered = MASSN_VORLAGEN_REIHENFOLGE.filter(k => present.has(k));
  for (const t of present) if (!ordered.includes(t)) ordered.push(t);
  return ordered.map(k => ({
    key:   k,
    label: MASSN_VORLAGEN[k]?.label || k,
    icon:  MASSN_VORLAGEN[k]?.icon || '',
    color: GEWERK_COLOR[k] || GEWERK_FALLBACK_COLOR,
  }));
}

// ── Validierung ───────────────────────────────────────────────────────────────

function _validatePlan() {
  _konflikte = new Set();
  try { fahrplanTopoSort(_plan.items); }
  catch (_) { _plan.items.forEach(it => _konflikte.add(it.id)); return; }
  for (const viol of fahrplanValidiereReihenfolge(_plan.items, phasen)) {
    _konflikte.add(viol.item.id);
    _konflikte.add(viol.prereqId);
  }
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

function _renderToolbar() {
  const tb = document.getElementById('ausb-toolbar');
  if (!tb) return;
  const nGeplant = _plan.items.filter(it => it.phaseId).length;
  tb.innerHTML = `
    <span style="font-weight:600;color:var(--accent);">📅 Maßnahmen-Fahrplan</span>
    <span style="color:var(--muted);font-size:10px;">${_plan.items.length} Maßnahme(n) · ${nGeplant} verplant</span>
    <span style="margin-left:8px;border-left:1px solid var(--border);padding-left:8px;">
      <button class="btn-xs" onclick="ausbauNeuePhase()">+ Phase</button>
    </span>
    <span style="margin-left:8px;border-left:1px solid var(--border);padding-left:8px;font-size:10px;color:var(--muted);">
      Achse:
      <button class="btn-xs" onclick="ausbauSetGruppierung('gewerk')" style="${_gruppierung==='gewerk'?'font-weight:700;color:var(--accent);':''}">Gewerk</button>
      <button class="btn-xs" onclick="ausbauSetGruppierung('cluster')" style="${_gruppierung==='cluster'?'font-weight:700;color:var(--accent);':''}">Cluster</button>
    </span>
    <span style="margin-left:auto;color:var(--muted);font-size:10px;">${phasen.length} Phasen</span>
    <span style="color:${_konflikte.size > 0 ? '#ef4444' : '#4caf50'};font-size:10px;">${_konflikte.size > 0 ? '⚠ ' + _konflikte.size + ' Konflikt(e)' : '✓ konfliktfrei'}</span>
    <button class="btn-xs" onclick="ausbauShow(false)" style="margin-left:4px;">✕</button>
    <button class="btn-xs" onclick="ausbauUndoLast()" title="Letzte Planungsänderung vollständig rückgängig machen">↶ Rückgängig</button>
  `;
}

// ── Sidebar: Phasen-Editor ────────────────────────────────────────────────────

function _renderSidebar() {
  const sb = document.getElementById('ausb-sidebar');
  if (!sb) return;

  // Übersicht je Gewerk (Anzahl Maßnahmen)
  const gewerke = _gewerke();
  const gewerkHtml = gewerke.length === 0
    ? `<div style="font-size:9px;color:var(--muted);">Keine Maßnahmen</div>`
    : gewerke.map(g => {
        const n = _plan.items.filter(it => it.typ === g.key).length;
        return `<div style="font-size:10px;color:var(--muted);line-height:1.9;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${g.color};margin-right:5px;"></span>
          ${g.icon} ${esc(g.label)}: <span style="color:var(--text);font-weight:600;">${n}</span>
        </div>`;
      }).join('');

  const phasenHtml = phasen.length === 0
    ? `<div style="color:var(--muted);font-size:10px;padding:4px 0;">Noch keine Phasen — auf „+ Phase" klicken.</div>`
    : [...phasen].sort((a, b) => +a.reihenfolge - +b.reihenfolge).map(p => {
        const invest = _plan.items.filter(it => it.phaseId === p.id).reduce((s, it) => s + (it.kosten || 0), 0);
        return `<div style="margin-bottom:8px;padding:6px;background:var(--surface2);border-radius:5px;border:1px solid var(--border);">
          <div style="font-weight:600;font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">
            <span>${esc(p.name)}${invest > 0 ? `<span style="color:var(--muted);font-size:9px;font-weight:400;"> ${(invest/1000).toFixed(0)} k€</span>` : ''}</span>
            <span class="ausb-phase-del" title="Phase löschen" onclick="ausbauPhaseLoeschen('${p.id}')" style="cursor:pointer;color:var(--muted);font-size:11px;">✕</span>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <label style="font-size:9px;color:var(--muted);">von</label>
            <input type="number" value="${p.jahrVon}" min="2020" max="2060"
              style="width:50px;font-size:10px;padding:2px 4px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:3px;"
              onchange="ausbauEditPhaseJahr('${p.id}','jahrVon',this.value)">
            <label style="font-size:9px;color:var(--muted);">bis</label>
            <input type="number" value="${p.jahrBis}" min="2020" max="2060"
              style="width:50px;font-size:10px;padding:2px 4px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:3px;"
              onchange="ausbauEditPhaseJahr('${p.id}','jahrBis',this.value)">
          </div>
        </div>`;
      }).join('');

  const konflikteHtml = _konflikte.size === 0
    ? `<div style="color:#4caf50;font-size:10px;padding:4px 0;">✓ Keine Konflikte</div>`
    : [..._konflikte].slice(0, 8).map(id => {
        const it = _plan.items.find(x => x.id === id);
        return `<div style="color:#ef4444;font-size:10px;padding:2px 0;">⚠ ${esc(it?.titel || id)}</div>`;
      }).join('');

  const nUngeplant = _plan.items.filter(it => !it.phaseId).length;

  sb.innerHTML = `
    <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--accent);">Maßnahmen</div>
    ${gewerkHtml}
    <div style="border-top:1px solid var(--border);margin:10px 0 6px;"></div>
    <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--accent);">Phasen</div>
    ${phasenHtml}
    ${nUngeplant > 0 ? `<div style="color:var(--muted);font-size:10px;margin-top:4px;">${nUngeplant} ungeplant</div>` : ''}
    ${_konflikte.size > 0 ? `<div style="border-top:1px solid var(--border);margin:10px 0 6px;"></div>
    <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#ef4444;">Konflikte</div>
    ${konflikteHtml}` : ''}
  `;
}

// ── Gantt-Fahrplan-Ansicht ────────────────────────────────────────────────────

function _renderGantt() {
  const wrap = document.getElementById('ausb-content');
  if (!wrap) return;

  if (_plan.items.length === 0) {
    wrap.innerHTML = `
      <div style="max-width:520px;margin:24px auto;padding:20px 24px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">Noch keine Maßnahmen</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.7;">
          Der Fahrplan zeigt alle Maßnahmen aller Anlagen, Netzkomponenten und Gebäude. Lege Maßnahmen an über:<br><br>
          • ein <b>Cluster-Maßnahmenpaket</b> (Mehr → 🗺 Cluster → „auf Mitglieder anwenden")<br>
          • die <b>Sammelauswahl</b> (Elektro-Tab → Anlagen auswählen → Maßnahme zuweisen)<br>
          • oder die <b>Anlagendetails</b> (einzelne Anlage → „+ Maßnahme")<br><br>
          Anschließend erscheinen sie hier und lassen sich per Drag-&-Drop den Phasen zuordnen.
        </div>
      </div>`;
    return;
  }

  const aktLanes = _lanes();
  const sortPhasen = [...phasen].sort((a, b) => +a.reihenfolge - +b.reihenfolge);
  const achseLabel = _gruppierung === 'cluster' ? 'Cluster' : 'Gewerk';

  let html = `<div class="ausb-gantt" style="display:grid;grid-template-columns:130px repeat(${sortPhasen.length + 1},minmax(140px,1fr));gap:2px;position:relative;">`;

  // Kopfzeile
  html += `<div style="font-size:10px;color:var(--muted);padding:4px 6px;">${achseLabel}</div>`;
  for (const p of sortPhasen) {
    html += `<div ondragover="ausbauDragOver(event,'${p.id}')" ondrop="ausbauDrop(event,'${p.id}')"
      style="font-size:10px;font-weight:600;padding:4px 6px;background:var(--surface2);border-radius:4px 4px 0 0;text-align:center;">
      ${esc(p.name)}<br><span style="font-weight:400;color:var(--muted);">${p.jahrVon}–${p.jahrBis}</span>
    </div>`;
  }
  html += `<div ondragover="ausbauDragOver(event,null)" ondrop="ausbauDrop(event,null)"
    style="font-size:10px;font-weight:600;padding:4px 6px;background:var(--surface2);border-radius:4px 4px 0 0;text-align:center;color:var(--muted);">Ungeplant</div>`;

  for (const lane of aktLanes) {
    const laneItems = _plan.items.filter(lane.match);
    html += `<div style="font-size:10px;font-weight:600;padding:4px 6px;border-right:1px solid var(--border);border-left:3px solid ${lane.color};">${lane.icon} ${esc(lane.label)}</div>`;
    for (const p of sortPhasen) {
      html += _cellHtml(laneItems.filter(it => it.phaseId === p.id), p.id);
    }
    html += _cellHtml(laneItems.filter(it => !it.phaseId), null);
  }
  html += `</div><svg id="ausb-arrows" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;"></svg>`;
  wrap.innerHTML = html;
  wrap.style.position = 'relative';
  requestAnimationFrame(() => _drawArrows(wrap));
}

// Balken werden immer nach Gewerk (Maßnahmen-Typ) eingefärbt — so bleibt der Typ auch
// in der Cluster-Swimlane erkennbar. Der Titel zeigt in der Cluster-Ansicht zusätzlich
// den Gewerk-Namen (im Gewerk-Modus zeigt die Lane das ohnehin).
function _cellHtml(items, phaseId) {
  const phAttr = phaseId ? `'${phaseId}'` : 'null';
  const barsHtml = items.map(it => {
    const err = _konflikte.has(it.id);
    const col = GEWERK_COLOR[it.typ] || GEWERK_FALLBACK_COLOR;
    const gwLabel = MASSN_VORLAGEN[it.typ]?.label || it.typ;
    const gwIcon  = MASSN_VORLAGEN[it.typ]?.icon || '';
    const jahrTxt = it.jahr ? ` · ${it.jahr}` : '';
    const kostenTxt = it.kosten ? ` (${(it.kosten/1000).toFixed(0)} k€)` : '';
    const praefix = _gruppierung === 'cluster' && gwIcon ? gwIcon + ' ' : '';
    return `<div class="ausb-bar" id="ausb-bar-${_cssId(it.id)}"
      data-item-id="${esc(it.id)}" draggable="true" ondragstart="ausbauDragStart(event,'${esc(it.id)}')"
      title="${esc(it.titel)} — ${esc(gwLabel)}${kostenTxt}${jahrTxt}${err?' ⚠ Reihenfolge verletzt!':''}"
      style="background:${col}22;border:${err?'2px solid #ef4444':'1px solid '+col+'44'};${err?'box-shadow:0 0 0 2px #ef4444;':''}border-radius:4px;padding:3px 6px;font-size:9px;cursor:grab;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">
      ${err?'⚠ ':''}${praefix}${esc(it.titel)}${jahrTxt}</div>`;
  }).join('');
  return `<div ondragover="ausbauDragOver(event,${phAttr})" ondrop="ausbauDrop(event,${phAttr})"
    style="min-height:40px;padding:3px;border:1px solid var(--border);border-radius:2px;">${barsHtml}</div>`;
}

function _drawArrows(wrap) {
  const svg = document.getElementById('ausb-arrows');
  if (!svg) return;
  const wr = wrap.getBoundingClientRect();
  const sx = wrap.scrollLeft, sy = wrap.scrollTop;
  let paths = '';
  for (const it of _plan.items) {
    if (!it.dependsOn?.length) continue;
    const toEl = document.getElementById('ausb-bar-' + _cssId(it.id));
    if (!toEl) continue;
    const toR = toEl.getBoundingClientRect();
    const tx = toR.left - wr.left + sx, ty = toR.top - wr.top + sy + toR.height / 2;
    for (const depId of it.dependsOn) {
      const fEl = document.getElementById('ausb-bar-' + _cssId(depId));
      if (!fEl) continue;
      const fR = fEl.getBoundingClientRect();
      const fx = fR.right - wr.left + sx, fy = fR.top - wr.top + sy + fR.height / 2;
      const mx = (fx + tx) / 2;
      const col = (_konflikte.has(it.id)||_konflikte.has(depId)) ? '#ef4444' : '#888';
      paths += `<path d="M${fx},${fy} C${mx},${fy} ${mx},${ty} ${tx},${ty}" stroke="${col}" stroke-width="1.5" fill="none" marker-end="url(#ausb-ah)" opacity="0.7"/>`;
    }
  }
  svg.innerHTML = `<defs><marker id="ausb-ah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#888"/></marker></defs>${paths}`;
}

// ── Drag-and-Drop (schreibt phaseId direkt auf die Maßnahme zurück) ───────────

export function ausbauDragStart(e, itemId) {
  _draggingId = itemId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', itemId);
  setTimeout(() => { if (e.currentTarget) e.currentTarget.style.opacity = '0.4'; }, 0);
}

export function ausbauDragOver(e, _phaseId) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.background = 'rgba(33,150,243,0.12)';
}

export function ausbauDrop(e, phaseId) {
  e.preventDefault();
  e.currentTarget.style.background = '';
  const itemId = e.dataTransfer.getData('text/plain') || _draggingId;
  if (!itemId) return;
  const it = _plan.items.find(x => x.id === itemId);
  if (it && it._m) _planningChange('Maßnahme in Phase verschieben', () => {
    it._m.phaseId = phaseId || null;
    it._m.jahr = null;
  });
  _draggingId = null;
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  ausbauRender();
}

// ── Phasen-Verwaltung ─────────────────────────────────────────────────────────

export function ausbauNeuePhase() {
  const maxR = phasen.reduce((m, p) => Math.max(m, +p.reihenfolge), -1);
  const lJ   = phasen.reduce((m, p) => Math.max(m, +p.jahrBis || 0), new Date().getFullYear());
  _planningChange('Phase anlegen', () => setPhasen([...phasen, {
    id: 'ph_' + Date.now(), name: 'Phase ' + (phasen.length + 1),
    jahrVon: String(lJ + 1), jahrBis: String(lJ + 1), variantId: null, reihenfolge: maxR + 1,
  }]));
  ausbauRender();
}

export function ausbauEditPhaseJahr(phaseId, field, value) {
  const p = phasen.find(x => x.id === phaseId);
  if (p) { _planningChange('Phasenzeitraum ändern', () => { p[field] = value; }); ausbauRender(); }
}

export function ausbauPhaseLoeschen(phaseId) {
  _planningChange('Phase löschen', () => {
    for (const a of ASSETS.items) for (const m of (a.massnahmen || [])) if (m.phaseId === phaseId) m.phaseId = null;
    for (const g of (window.gebaeude || [])) for (const m of (g.massnahmen || [])) if (m.phaseId === phaseId) m.phaseId = null;
    setPhasen(phasen.filter(p => p.id !== phaseId));
  });
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  ausbauRender();
}

// Swimlane-Achse umschalten (Gewerk ⇄ Cluster)
export function ausbauSetGruppierung(modus) {
  _gruppierung = modus === 'cluster' ? 'cluster' : 'gewerk';
  ausbauRender();
}

export function ausbauUndoLast() {
  if (typeof window.undoLastPlanningTransaction !== 'function' || !window.undoLastPlanningTransaction()) return;
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  if (typeof window.clusterRenderAll === 'function') window.clusterRenderAll();
  ausbauRender();
}

// ── Getter ────────────────────────────────────────────────────────────────────
export function ausbauGetPlan() { return _plan; }
export function ausbauGetKonflikte() { return _konflikte; }

// ── Helfer ────────────────────────────────────────────────────────────────────
function _cssId(id) { return String(id).replace(/[^a-z0-9]/gi, '_'); }
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
