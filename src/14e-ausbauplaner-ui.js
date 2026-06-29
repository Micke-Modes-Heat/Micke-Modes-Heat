// ── 14e-ausbauplaner-ui.js — Ausbauplaner-Board (M6) ─────────────────────────
// Vollbild-Gantt mit Gewerk-Swimlanes, Drag-Drop (Phase), dependsOn-Pfeile,
// Live-Validierung + Knopf „Plan automatisch erzeugen".

import { ASSETS } from './13a-assets-core.js';
import { phasen, setPhasen, massnahmeJahr } from './01-globals-varianten.js';
import {
  fahrplanTopoSort, fahrplanValidiereReihenfolge,
  fahrplanAutoGenerieren, fahrplanSchreibeAufAssets,
} from './14c-phasen.js';

// ── Gewerk-Definitionen (Swimlane-Reihenfolge) ────────────────────────────────
const GEWERKE = [
  { key: 'Ertuechtigung', label: 'Ertüchtigung', color: '#f59e0b' },
  { key: 'Bau',           label: 'PV-Anlage',    color: '#4fc3f7' },
  { key: 'Sanierung',     label: 'Sanierung',     color: '#a78bfa' },
  { key: 'Abriss',        label: 'Abriss',        color: '#f87171' },
];

// ── Modul-State ───────────────────────────────────────────────────────────────
let _plan         = { items: [], gruppen: [] }; // aktueller Fahrplan
let _konflikte    = new Set();                  // item-IDs mit Validierungsfehler
let _draggingId   = null;

// ── Init + Show/Hide ──────────────────────────────────────────────────────────

export function ausbauInit() {
  let wrap = document.getElementById('ausbauplaner-wrap');
  if (wrap) return;
  wrap = document.createElement('div');
  wrap.id = 'ausbauplaner-wrap';
  wrap.style.display = 'none';
  wrap.innerHTML = `
<div id="ausb-inner" style="display:flex;flex-direction:row;height:calc(100vh - 160px);min-height:400px;gap:0;background:var(--bg);border-radius:8px;overflow:hidden;border:1px solid var(--border);">
  <div id="ausb-sidebar" style="width:220px;overflow-y:auto;flex-shrink:0;border-right:1px solid var(--border);padding:10px 10px 16px;background:var(--surface);"></div>
  <div id="ausb-main" style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;">
    <div id="ausb-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--surface2);flex-shrink:0;flex-wrap:wrap;font-size:11px;"></div>
    <div id="ausb-gantt-wrap" style="flex:1;overflow:auto;padding:10px 14px;"></div>
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
  _validatePlan();
  _renderSidebar();
  _renderToolbar();
  _renderGantt();
}

// ── Validierung ───────────────────────────────────────────────────────────────

function _validatePlan() {
  _konflikte = new Set();
  try {
    fahrplanTopoSort(_plan.items); // Zyklus-Check
  } catch (_) {
    _plan.items.forEach(it => _konflikte.add(it.id));
    return;
  }
  const v = fahrplanValidiereReihenfolge(_plan.items, phasen);
  for (const viol of v) {
    _konflikte.add(viol.item.id);
    _konflikte.add(viol.prereqId);
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function _renderToolbar() {
  const tb = document.getElementById('ausb-toolbar');
  if (!tb) return;
  tb.innerHTML = `
    <button class="btn-xs blue" onclick="ausbauAutoGenerieren()" title="Merit-Order + Topo-Sort → Fahrplan">⚡ Auto-Plan erzeugen</button>
    <button class="btn-xs" onclick="ausbauNeuePhase()" title="Neue Phase anlegen">+ Phase</button>
    <span style="margin-left:auto;color:var(--muted);">${_plan.items.length} Maßnahmen · ${phasen.length} Phasen</span>
    <span style="color:${_konflikte.size > 0 ? '#ef4444' : '#4caf50'};">
      ${_konflikte.size > 0 ? '⚠ ' + _konflikte.size + ' Konflikt(e)' : '✓ konfliktfrei'}
    </span>
    <button class="btn-xs" onclick="ausbauShow(false)" style="margin-left:4px;">✕ Schließen</button>
  `;
}

// ── Sidebar: Phasen-Editor + Conflicts ───────────────────────────────────────

function _renderSidebar() {
  const sb = document.getElementById('ausb-sidebar');
  if (!sb) return;

  const phasenHtml = phasen.length === 0
    ? `<div style="color:var(--muted);font-size:10px;padding:6px 0;">Noch keine Phasen.<br>Auf „+ Phase" klicken.</div>`
    : phasen
        .sort((a, b) => +a.reihenfolge - +b.reihenfolge)
        .map(p => {
          const invest = _plan.items
            .filter(it => it.phaseId === p.id)
            .reduce((s, it) => s + (it.kosten || 0), 0);
          const investStr = invest > 0
            ? `<span style="color:var(--muted);font-size:9px;"> · ${(invest / 1000).toFixed(0)} k€</span>`
            : '';
          return `<div style="margin-bottom:8px;padding:6px;background:var(--surface2);border-radius:5px;border:1px solid var(--border);">
            <div style="font-weight:600;font-size:11px;margin-bottom:4px;">${esc(p.name)}${investStr}</div>
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
    : [..._konflikte].map(id => {
        const it = _plan.items.find(x => x.id === id);
        return `<div style="color:#ef4444;font-size:10px;padding:2px 0;">⚠ ${esc(it?.titel || id)}</div>`;
      }).join('');

  const ungeplantCount = _plan.items.filter(it => !it.phaseId).length;

  sb.innerHTML = `
    <div style="font-size:11px;font-weight:600;margin-bottom:8px;color:var(--accent);">Phasen</div>
    ${phasenHtml}
    ${ungeplantCount > 0 ? `<div style="color:var(--muted);font-size:10px;margin-top:4px;">${ungeplantCount} ungeplant</div>` : ''}
    <div style="border-top:1px solid var(--border);margin:10px 0 6px;"></div>
    <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--accent);">Validierung</div>
    ${konflikteHtml}
  `;
}

// ── Gantt-Tabelle ─────────────────────────────────────────────────────────────

function _renderGantt() {
  const wrap = document.getElementById('ausb-gantt-wrap');
  if (!wrap) return;

  if (_plan.items.length === 0) {
    wrap.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center;">
      Noch kein Fahrplan. Klicke <b>⚡ Auto-Plan erzeugen</b> oder füge Maßnahmen manuell hinzu.
    </div>`;
    return;
  }

  // Welche Gewerke sind tatsächlich vorhanden?
  const vorhandeneTypen = new Set(_plan.items.map(it => it.typ));
  const aktGewerke = GEWERKE.filter(g => vorhandeneTypen.has(g.key));
  if (aktGewerke.length === 0) aktGewerke.push(GEWERKE[0]); // Fallback

  const sortPhasen = [...phasen].sort((a, b) => +a.reihenfolge - +b.reihenfolge);

  // ── Tabellen-HTML aufbauen ────────────────────────────────────────────────
  let html = `<div class="ausb-gantt" style="display:grid;grid-template-columns:120px repeat(${sortPhasen.length + 1},minmax(140px,1fr));gap:2px;position:relative;">`;

  // Kopfzeile
  html += `<div class="ausb-cell ausb-hdr-label" style="font-size:10px;color:var(--muted);padding:4px 6px;">Gewerk</div>`;
  for (const p of sortPhasen) {
    html += `<div class="ausb-cell ausb-hdr-phase"
      data-phase-id="${p.id}"
      ondragover="ausbauDragOver(event,'${p.id}')"
      ondrop="ausbauDrop(event,'${p.id}')"
      style="font-size:10px;font-weight:600;padding:4px 6px;background:var(--surface2);border-radius:4px 4px 0 0;text-align:center;">
      ${esc(p.name)}<br><span style="font-weight:400;color:var(--muted);">${p.jahrVon}–${p.jahrBis}</span>
    </div>`;
  }
  html += `<div class="ausb-cell ausb-hdr-phase"
    ondragover="ausbauDragOver(event,null)"
    ondrop="ausbauDrop(event,null)"
    style="font-size:10px;font-weight:600;padding:4px 6px;background:var(--surface2);border-radius:4px 4px 0 0;text-align:center;color:var(--muted);">Ungeplant</div>`;

  // Gewerk-Zeilen
  for (const gw of aktGewerke) {
    html += `<div class="ausb-cell ausb-lane-label" style="font-size:10px;font-weight:600;padding:4px 6px;border-right:1px solid var(--border);">${esc(gw.label)}</div>`;
    for (const p of sortPhasen) {
      const items = _plan.items.filter(it => it.typ === gw.key && it.phaseId === p.id);
      html += _cellHtml(gw, items, p.id);
    }
    const ungeplant = _plan.items.filter(it => it.typ === gw.key && !it.phaseId);
    html += _cellHtml(gw, ungeplant, null);
  }

  html += `</div>`;

  // ── SVG-Arrow-Overlay ─────────────────────────────────────────────────────
  // (wird nach dem DOM-Insert berechnet)
  html += `<svg id="ausb-arrows" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;"></svg>`;

  wrap.innerHTML = html;
  wrap.style.position = 'relative';

  // Arrows nach Render berechnen
  requestAnimationFrame(() => _drawArrows(wrap));
}

function _cellHtml(gw, items, phaseId) {
  const phAttr = phaseId ? `'${phaseId}'` : 'null';
  const barsHtml = items.map(it => {
    const isKonflikt = _konflikte.has(it.id);
    const border = isKonflikt
      ? '2px solid #ef4444'
      : `1px solid ${gw.color}44`;
    const outline = isKonflikt ? 'box-shadow:0 0 0 2px #ef4444;' : '';
    return `<div class="ausb-bar"
      id="ausb-bar-${it.id.replace(/[^a-z0-9]/gi, '_')}"
      data-item-id="${it.id}"
      draggable="true"
      ondragstart="ausbauDragStart(event,'${it.id}')"
      title="${esc(it.titel)} (${(it.kosten / 1000).toFixed(0)} k€)${isKonflikt ? ' ⚠ Reihenfolge verletzt!' : ''}"
      style="background:${gw.color}22;border:${border};${outline}border-radius:4px;padding:3px 6px;font-size:9px;cursor:grab;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">
      ${isKonflikt ? '⚠ ' : ''}${esc(it.titel)}
    </div>`;
  }).join('');
  return `<div class="ausb-cell ausb-gantt-cell"
    data-phase-id="${phaseId || ''}"
    ondragover="ausbauDragOver(event,${phAttr})"
    ondrop="ausbauDrop(event,${phAttr})"
    style="min-height:40px;padding:3px;border:1px solid var(--border);border-radius:2px;vertical-align:top;">
    ${barsHtml}
  </div>`;
}

// ── SVG-Arrows ────────────────────────────────────────────────────────────────

function _drawArrows(wrap) {
  const svg = document.getElementById('ausb-arrows');
  if (!svg) return;
  const wrapRect = wrap.getBoundingClientRect();
  const scrollX = wrap.scrollLeft, scrollY = wrap.scrollTop;
  let paths = '';

  for (const it of _plan.items) {
    if (!it.dependsOn?.length) continue;
    const toEl = document.getElementById('ausb-bar-' + it.id.replace(/[^a-z0-9]/gi, '_'));
    if (!toEl) continue;
    const toR = toEl.getBoundingClientRect();
    const tx = toR.left - wrapRect.left + scrollX;
    const ty = toR.top - wrapRect.top + scrollY + toR.height / 2;

    for (const depId of it.dependsOn) {
      const fromEl = document.getElementById('ausb-bar-' + depId.replace(/[^a-z0-9]/gi, '_'));
      if (!fromEl) continue;
      const fromR = fromEl.getBoundingClientRect();
      const fx = fromR.right - wrapRect.left + scrollX;
      const fy = fromR.top - wrapRect.top + scrollY + fromR.height / 2;
      const mx = (fx + tx) / 2;
      const color = (_konflikte.has(it.id) || _konflikte.has(depId)) ? '#ef4444' : '#888';
      paths += `<path d="M${fx},${fy} C${mx},${fy} ${mx},${ty} ${tx},${ty}"
        stroke="${color}" stroke-width="1.5" fill="none" marker-end="url(#ausb-arrow-head)" opacity="0.7"/>`;
    }
  }

  svg.innerHTML = `
    <defs>
      <marker id="ausb-arrow-head" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#888"/>
      </marker>
    </defs>
    ${paths}
  `;
}

// ── Drag-and-Drop ─────────────────────────────────────────────────────────────

export function ausbauDragStart(e, itemId) {
  _draggingId = itemId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', itemId);
  const el = e.currentTarget;
  setTimeout(() => { if (el) el.style.opacity = '0.4'; }, 0);
}

export function ausbauDragOver(e, phaseId) {
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
  if (!it) return;
  it.phaseId = phaseId || null;
  it.jahr    = null; // Phase überschreibt explizites Jahr
  _draggingId = null;
  ausbauRender();
}

// ── Auto-Plan-Generierung ─────────────────────────────────────────────────────

export function ausbauAutoGenerieren() {
  // Merit-Order-Ergebnis holen (letzter Lauf oder frisch starten)
  const moResult = window._lastMeritOrderResult || (() => {
    if (typeof window.pvRunMeritOrder === 'function') return window.pvRunMeritOrder();
    return null;
  })();

  if (!moResult?.ranking) {
    alert('Kein Merit-Order-Ergebnis vorhanden.\nBitte zuerst im PV-Tab „Merit-Order" berechnen.');
    return;
  }

  // Ertüchtigungs-Map aus dem letzten Ertüchtigungs-Lauf (wenn vorhanden)
  const infraMap = window._lastInfraMap || new Map();

  try {
    _plan = fahrplanAutoGenerieren(
      moResult.ranking,
      infraMap,
      phasen,
      { msProPhase: 3, pvInvestPerKwp: 1200 }
    );
  } catch (err) {
    console.error('ausbauAutoGenerieren:', err);
    alert('Fehler beim Fahrplan-Erzeugen: ' + err.message);
    return;
  }

  ausbauRender();
}

// ── Phasen-Verwaltung ─────────────────────────────────────────────────────────

export function ausbauNeuePhase() {
  const maxReihenfolge = phasen.reduce((m, p) => Math.max(m, +p.reihenfolge), -1);
  const letzteJahr     = phasen.reduce((m, p) => Math.max(m, +p.jahrBis || 0), new Date().getFullYear());
  const neuesJahr      = letzteJahr + 1;
  const neuePhase = {
    id:          'ph_' + Date.now(),
    name:        'Phase ' + (phasen.length + 1),
    jahrVon:     String(neuesJahr),
    jahrBis:     String(neuesJahr),
    variantId:   null,
    reihenfolge: maxReihenfolge + 1,
  };
  setPhasen([...phasen, neuePhase]);
  ausbauRender();
}

export function ausbauEditPhaseJahr(phaseId, field, value) {
  const p = phasen.find(x => x.id === phaseId);
  if (!p) return;
  p[field] = value;
  // Phasen-Array neu setzen (triggert keine automatische Re-Render — ausbauRender manuell)
  ausbauRender();
}

// ── Fahrplan auf Assets zurückschreiben ───────────────────────────────────────

export function ausbauSchreibeZurueck() {
  const count = fahrplanSchreibeAufAssets(_plan.items, ASSETS.items);
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  console.info('[Ausbauplaner] Fahrplan auf', count, 'Assets zurückgeschrieben.');
}

// ── Getter für externe Module ─────────────────────────────────────────────────
export function ausbauGetPlan() { return _plan; }
export function ausbauGetKonflikte() { return _konflikte; }

// ── Helfer ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
