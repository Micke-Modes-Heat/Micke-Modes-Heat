// ── 14e-ausbauplaner-ui.js — Ausbauplaner-Board ───────────────────────────────
// Zwei-Tab-Board: "Merit-Order" (Berechnungs-Button + Ranking) und
// "Fahrplan" (Gantt-Swimlanes, Drag-Drop, dependsOn-Pfeile, Live-Validierung).

import { ASSETS } from './13a-assets-core.js';
import { phasen, setPhasen } from './01-globals-varianten.js';
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

const TIER_COLOR = { A: '#4caf50', B: '#fdd835', C: '#ef9a9a' };

// ── Modul-State ───────────────────────────────────────────────────────────────
let _plan       = { items: [], gruppen: [] };
let _konflikte  = new Set();
let _draggingId = null;
let _tab        = 'meritorder'; // 'meritorder' | 'fahrplan'

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

export function ausbauSetTab(tab) {
  _tab = tab;
  ausbauRender();
}

// ── Haupt-Render ──────────────────────────────────────────────────────────────

export function ausbauRender() {
  _validatePlan();
  _renderSidebar();
  _renderToolbar();
  if (_tab === 'meritorder') _renderMeritOrderView();
  else _renderGantt();
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

// ── Toolbar mit Tab-Leiste ────────────────────────────────────────────────────

function _renderToolbar() {
  const tb = document.getElementById('ausb-toolbar');
  if (!tb) return;
  const moResult = window._lastMeritOrderResult;
  const hasMo    = !!(moResult?.ranking?.length);
  const tabStyle = (key) =>
    `padding:3px 10px;border-radius:4px 4px 0 0;font-size:10px;font-weight:600;cursor:pointer;border:1px solid var(--border);border-bottom:${_tab === key ? '1px solid var(--bg)' : '1px solid var(--border)'};background:${_tab === key ? 'var(--bg)' : 'var(--surface2)'};color:${_tab === key ? 'var(--accent)' : 'var(--muted)'};`;

  tb.innerHTML = `
    <button style="${tabStyle('meritorder')}" onclick="ausbauSetTab('meritorder')">
      📊 Merit-Order${hasMo ? ' ✓' : ''}
    </button>
    <button style="${tabStyle('fahrplan')}" onclick="ausbauSetTab('fahrplan')">
      📅 Fahrplan${_plan.items.length > 0 ? ' (' + _plan.items.length + ')' : ''}
    </button>
    <span style="margin-left:8px;border-left:1px solid var(--border);padding-left:8px;">
      ${_tab === 'meritorder'
        ? `<button class="btn-xs blue" onclick="ausbauMeritOrderBerechnen()" title="PV-Kandidaten (Dächer, Freifl., Assets) nach Wirtschaftlichkeit ranken">📊 Merit-Order berechnen</button>`
        : `<button class="btn-xs" onclick="ausbauNeuePhase()">+ Phase</button>
           <button class="btn-xs blue" onclick="ausbauAutoGenerieren()" title="Fahrplan aus Merit-Order erzeugen — Phasen müssen bereits angelegt sein">⚡ Auto-Plan erzeugen</button>`
      }
    </span>
    <span style="margin-left:auto;color:var(--muted);font-size:10px;">${phasen.length} Phasen</span>
    ${_tab === 'fahrplan' ? `<span style="color:${_konflikte.size > 0 ? '#ef4444' : '#4caf50'};font-size:10px;">${_konflikte.size > 0 ? '⚠ ' + _konflikte.size + ' Konflikt(e)' : '✓ konfliktfrei'}</span>` : ''}
    <button class="btn-xs" onclick="ausbauShow(false)" style="margin-left:4px;">✕</button>
  `;
}

// ── Sidebar: Phasen-Editor ────────────────────────────────────────────────────

function _renderSidebar() {
  const sb = document.getElementById('ausb-sidebar');
  if (!sb) return;

  const moResult   = window._lastMeritOrderResult;
  const moSummary  = moResult?.ranking?.length
    ? (() => {
        const r = moResult.ranking;
        const a = r.filter(x => x.tier === 'A').length;
        const b = r.filter(x => x.tier === 'B').length;
        const c = r.filter(x => x.tier === 'C').length;
        const kwp = r.filter(x => x.tier !== 'C').reduce((s, x) => s + (x.kandidat?.kWp || 0), 0);
        return `<div style="font-size:9px;color:var(--muted);line-height:1.8;">
          <span style="color:${TIER_COLOR.A};font-weight:600;">A: ${a}</span> &nbsp;
          <span style="color:${TIER_COLOR.B};font-weight:600;">B: ${b}</span> &nbsp;
          <span style="color:#888;">C: ${c}</span><br>
          ${Math.round(kwp).toLocaleString('de-DE')} kWp (A+B)
        </div>`
      })()
    : `<div style="font-size:9px;color:var(--muted);">Noch nicht berechnet</div>`;

  const phasenHtml = phasen.length === 0
    ? `<div style="color:var(--muted);font-size:10px;padding:4px 0;">Noch keine Phasen — auf „+ Phase" klicken.</div>`
    : [...phasen].sort((a, b) => +a.reihenfolge - +b.reihenfolge).map(p => {
        const invest = _plan.items.filter(it => it.phaseId === p.id).reduce((s, it) => s + (it.kosten || 0), 0);
        return `<div style="margin-bottom:8px;padding:6px;background:var(--surface2);border-radius:5px;border:1px solid var(--border);">
          <div style="font-weight:600;font-size:11px;margin-bottom:4px;">${esc(p.name)}
            ${invest > 0 ? `<span style="color:var(--muted);font-size:9px;font-weight:400;"> ${(invest/1000).toFixed(0)} k€</span>` : ''}
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
    : [..._konflikte].slice(0, 6).map(id => {
        const it = _plan.items.find(x => x.id === id);
        return `<div style="color:#ef4444;font-size:10px;padding:2px 0;">⚠ ${esc(it?.titel || id)}</div>`;
      }).join('');

  sb.innerHTML = `
    <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--accent);">Merit-Order</div>
    ${moSummary}
    <div style="border-top:1px solid var(--border);margin:10px 0 6px;"></div>
    <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--accent);">Phasen</div>
    ${phasenHtml}
    ${_plan.items.filter(it => !it.phaseId).length > 0
      ? `<div style="color:var(--muted);font-size:10px;margin-top:4px;">${_plan.items.filter(it=>!it.phaseId).length} ungeplant</div>` : ''}
    ${_konflikte.size > 0 ? `<div style="border-top:1px solid var(--border);margin:10px 0 6px;"></div>
    <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#ef4444;">Konflikte</div>
    ${konflikteHtml}` : ''}
  `;
}

// ── Merit-Order-Ansicht ───────────────────────────────────────────────────────

function _renderMeritOrderView() {
  const wrap = document.getElementById('ausb-content');
  if (!wrap) return;
  const moResult = window._lastMeritOrderResult;

  if (!moResult?.ranking?.length) {
    const hasLastgang = !!(window.elQuartierH15 || window.elQuartierH);
    const hasAssets   = (window.ASSETS?.items?.length || 0) > 0;
    wrap.innerHTML = `
      <div style="max-width:520px;margin:24px auto;padding:20px 24px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Merit-Order berechnen</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.7;margin-bottom:16px;">
          Die Merit-Order bewertet alle PV-Flächen der Liegenschaft (Dächer, Freifl., Assets)
          nach ihrem wirtschaftlichen Zusatznutzen und ordnet sie in Tiers ein:<br><br>
          <span style="color:${TIER_COLOR.A};font-weight:600;">Tier A</span> — wirtschaftlich positiv · sollte gebaut werden<br>
          <span style="color:${TIER_COLOR.B};font-weight:600;">Tier B</span> — knapp positiv oder neutral<br>
          <span style="color:#888;">Tier C</span> — Überschuss überwiegt · aktuell nicht wirtschaftlich
        </div>
        <div style="font-size:10px;margin-bottom:14px;">
          ${hasLastgang
            ? `<span style="color:#4caf50;">✓ Strom-Lastgang vorhanden</span>`
            : `<span style="color:#ef4444;">⚠ Kein Strom-Lastgang — bitte im PV-Analyse-Tab hochladen</span>`}
          &nbsp;·&nbsp;
          ${hasAssets
            ? `<span style="color:#4caf50;">✓ ${window.ASSETS.items.length} Assets</span>`
            : `<span style="color:var(--muted);">Keine Assets</span>`}
        </div>
        <button class="btn-xs blue" style="font-size:11px;padding:6px 16px;"
          onclick="ausbauMeritOrderBerechnen()"
          ${!hasLastgang ? 'disabled title="Zuerst Strom-Lastgang hochladen"' : ''}>
          📊 Merit-Order berechnen
        </button>
      </div>`;
    return;
  }

  // Ergebnis-Tabelle
  const ranking = moResult.ranking;
  const kwpGesamt = ranking.filter(r => r.tier !== 'C').reduce((s, r) => s + (r.kandidat?.kWp || 0), 0);
  const ertragMwh = ranking.filter(r => r.tier !== 'C').reduce((s, r) => s + (r.kandidat?.jahresertragKWh || 0) / 1000, 0);

  const rows = ranking.map((r, i) => {
    const k   = r.kandidat;
    const tier = r.tier || '—';
    const tc   = TIER_COLOR[tier] || '#888';
    const delta = (r.delta / 1000).toFixed(1);
    const kwp   = Math.round(k?.kWp || 0);
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:4px 8px;color:var(--muted);font-size:10px;">${i + 1}</td>
      <td style="padding:4px 8px;font-size:10px;font-weight:600;color:${tc};">${tier}</td>
      <td style="padding:4px 8px;font-size:10px;">${esc(k?.id || '—')}</td>
      <td style="padding:4px 8px;font-size:10px;color:var(--muted);">${esc(k?.typ || '—')}</td>
      <td style="padding:4px 8px;font-size:10px;text-align:right;">${kwp.toLocaleString('de-DE')} kWp</td>
      <td style="padding:4px 8px;font-size:10px;text-align:right;color:${parseFloat(delta) >= 0 ? '#4caf50' : '#ef4444'};">${delta} k€/a</td>
      <td style="padding:4px 8px;font-size:10px;color:var(--muted);">${esc(r.napId || '—')}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;flex-wrap:wrap;">
      <div>
        <span style="font-size:13px;font-weight:600;">Merit-Order-Ergebnis</span>
        <span style="font-size:10px;color:var(--muted);margin-left:8px;">${ranking.length} Kandidaten</span>
      </div>
      <div style="display:flex;gap:12px;font-size:11px;">
        ${['A','B','C'].map(t => {
            const n = ranking.filter(r => r.tier === t).length;
            return `<span><span style="color:${TIER_COLOR[t]};font-weight:600;">Tier ${t}:</span> ${n}</span>`;
          }).join('')}
        <span style="color:var(--muted);">| ${Math.round(kwpGesamt).toLocaleString('de-DE')} kWp (A+B) · ${ertragMwh.toFixed(0)} MWh/a</span>
      </div>
      <button class="btn-xs" onclick="ausbauMeritOrderBerechnen()" style="margin-left:auto;" title="Neu berechnen">↻ Neu berechnen</button>
      <button class="btn-xs blue" onclick="ausbauSetTab('fahrplan')" title="Zu Fahrplan wechseln">→ Zum Fahrplan</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="background:var(--surface2);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">
          <th style="padding:4px 8px;text-align:left;">#</th>
          <th style="padding:4px 8px;text-align:left;">Tier</th>
          <th style="padding:4px 8px;text-align:left;">Fläche / Asset</th>
          <th style="padding:4px 8px;text-align:left;">Typ</th>
          <th style="padding:4px 8px;text-align:right;">kWp</th>
          <th style="padding:4px 8px;text-align:right;">Δ €/a</th>
          <th style="padding:4px 8px;text-align:left;">NAP</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Merit-Order-Berechnung ────────────────────────────────────────────────────

export function ausbauMeritOrderBerechnen() {
  if (typeof window.pvRunMeritOrder !== 'function') {
    alert('pvRunMeritOrder nicht verfügbar — Build neu laden.');
    return;
  }
  const result = window.pvRunMeritOrder();
  if (!result?.ranking) {
    alert('Merit-Order konnte nicht berechnet werden.\n\nHinweis: Ein Strom-Lastgang muss vorhanden sein.\nBitte im Tab „PV-Analyse" den Quartier-Lastgang hochladen.');
    return;
  }
  ausbauRender();
}

// ── Gantt-Fahrplan-Ansicht ────────────────────────────────────────────────────

function _renderGantt() {
  const wrap = document.getElementById('ausb-content');
  if (!wrap) return;

  if (_plan.items.length === 0) {
    const hasMo = !!(window._lastMeritOrderResult?.ranking?.length);
    wrap.innerHTML = `
      <div style="max-width:480px;margin:24px auto;padding:20px 24px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">Fahrplan erstellen</div>
        ${!hasMo
          ? `<div style="font-size:11px;color:#ef9a9a;margin-bottom:12px;">⚠ Noch keine Merit-Order berechnet.<br>
             <a href="#" onclick="ausbauSetTab('meritorder');return false;" style="color:#4fc3f7;">→ Zuerst Merit-Order berechnen</a></div>`
          : `<div style="font-size:11px;color:#4caf50;margin-bottom:12px;">✓ Merit-Order vorhanden (${window._lastMeritOrderResult.ranking.length} Kandidaten)</div>`}
        ${phasen.length === 0
          ? `<div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Lege zuerst Phasen an (Schaltfläche „+ Phase" oben).</div>`
          : `<div style="font-size:11px;color:var(--muted);margin-bottom:12px;">${phasen.length} Phase(n) vorhanden.</div>`}
        <button class="btn-xs blue" style="font-size:11px;padding:6px 16px;"
          onclick="ausbauAutoGenerieren()"
          ${!hasMo || phasen.length === 0 ? 'disabled' : ''}>
          ⚡ Auto-Plan erzeugen
        </button>
      </div>`;
    return;
  }

  const vorhandeneTypen = new Set(_plan.items.map(it => it.typ));
  const aktGewerke = GEWERKE.filter(g => vorhandeneTypen.has(g.key));
  if (aktGewerke.length === 0) aktGewerke.push(GEWERKE[0]);

  const sortPhasen = [...phasen].sort((a, b) => +a.reihenfolge - +b.reihenfolge);

  let html = `<div class="ausb-gantt" style="display:grid;grid-template-columns:120px repeat(${sortPhasen.length + 1},minmax(140px,1fr));gap:2px;position:relative;">`;

  // Kopfzeile
  html += `<div style="font-size:10px;color:var(--muted);padding:4px 6px;">Gewerk</div>`;
  for (const p of sortPhasen) {
    html += `<div ondragover="ausbauDragOver(event,'${p.id}')" ondrop="ausbauDrop(event,'${p.id}')"
      style="font-size:10px;font-weight:600;padding:4px 6px;background:var(--surface2);border-radius:4px 4px 0 0;text-align:center;">
      ${esc(p.name)}<br><span style="font-weight:400;color:var(--muted);">${p.jahrVon}–${p.jahrBis}</span>
    </div>`;
  }
  html += `<div ondragover="ausbauDragOver(event,null)" ondrop="ausbauDrop(event,null)"
    style="font-size:10px;font-weight:600;padding:4px 6px;background:var(--surface2);border-radius:4px 4px 0 0;text-align:center;color:var(--muted);">Ungeplant</div>`;

  for (const gw of aktGewerke) {
    html += `<div style="font-size:10px;font-weight:600;padding:4px 6px;border-right:1px solid var(--border);">${esc(gw.label)}</div>`;
    for (const p of sortPhasen) {
      html += _cellHtml(gw, _plan.items.filter(it => it.typ === gw.key && it.phaseId === p.id), p.id);
    }
    html += _cellHtml(gw, _plan.items.filter(it => it.typ === gw.key && !it.phaseId), null);
  }
  html += `</div><svg id="ausb-arrows" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;"></svg>`;
  wrap.innerHTML = html;
  wrap.style.position = 'relative';
  requestAnimationFrame(() => _drawArrows(wrap));
}

function _cellHtml(gw, items, phaseId) {
  const phAttr = phaseId ? `'${phaseId}'` : 'null';
  const barsHtml = items.map(it => {
    const err = _konflikte.has(it.id);
    return `<div class="ausb-bar" id="ausb-bar-${it.id.replace(/[^a-z0-9]/gi,'_')}"
      data-item-id="${it.id}" draggable="true" ondragstart="ausbauDragStart(event,'${it.id}')"
      title="${esc(it.titel)} (${(it.kosten/1000).toFixed(0)} k€)${err?' ⚠ Reihenfolge verletzt!':''}"
      style="background:${gw.color}22;border:${err?'2px solid #ef4444':'1px solid '+gw.color+'44'};${err?'box-shadow:0 0 0 2px #ef4444;':''}border-radius:4px;padding:3px 6px;font-size:9px;cursor:grab;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">
      ${err?'⚠ ':''}${esc(it.titel)}</div>`;
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
    const toEl = document.getElementById('ausb-bar-' + it.id.replace(/[^a-z0-9]/gi,'_'));
    if (!toEl) continue;
    const toR = toEl.getBoundingClientRect();
    const tx = toR.left - wr.left + sx, ty = toR.top - wr.top + sy + toR.height / 2;
    for (const depId of it.dependsOn) {
      const fEl = document.getElementById('ausb-bar-' + depId.replace(/[^a-z0-9]/gi,'_'));
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

// ── Drag-and-Drop ─────────────────────────────────────────────────────────────

export function ausbauDragStart(e, itemId) {
  _draggingId = itemId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', itemId);
  setTimeout(() => { if (e.currentTarget) e.currentTarget.style.opacity = '0.4'; }, 0);
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
  if (it) { it.phaseId = phaseId || null; it.jahr = null; }
  _draggingId = null;
  ausbauRender();
}

// ── Auto-Plan-Generierung ─────────────────────────────────────────────────────

export function ausbauAutoGenerieren() {
  const moResult = window._lastMeritOrderResult;
  if (!moResult?.ranking) {
    alert('Kein Merit-Order-Ergebnis vorhanden.\nBitte zuerst den Tab „Merit-Order" öffnen und berechnen.');
    return;
  }
  if (phasen.length === 0) {
    alert('Bitte zuerst mindestens eine Phase anlegen (Schaltfläche „+ Phase").');
    return;
  }
  try {
    _plan = fahrplanAutoGenerieren(moResult.ranking, window._lastInfraMap || new Map(), phasen, { msProPhase: 3, pvInvestPerKwp: 1200 });
  } catch (err) {
    console.error('ausbauAutoGenerieren:', err);
    alert('Fehler beim Fahrplan-Erzeugen: ' + err.message);
    return;
  }
  _tab = 'fahrplan';
  ausbauRender();
}

// ── Phasen-Verwaltung ─────────────────────────────────────────────────────────

export function ausbauNeuePhase() {
  const maxR = phasen.reduce((m, p) => Math.max(m, +p.reihenfolge), -1);
  const lJ   = phasen.reduce((m, p) => Math.max(m, +p.jahrBis || 0), new Date().getFullYear());
  setPhasen([...phasen, {
    id: 'ph_' + Date.now(), name: 'Phase ' + (phasen.length + 1),
    jahrVon: String(lJ + 1), jahrBis: String(lJ + 1),
    variantId: null, reihenfolge: maxR + 1,
  }]);
  ausbauRender();
}

export function ausbauEditPhaseJahr(phaseId, field, value) {
  const p = phasen.find(x => x.id === phaseId);
  if (p) { p[field] = value; ausbauRender(); }
}

// ── Fahrplan auf Assets zurückschreiben ───────────────────────────────────────

export function ausbauSchreibeZurueck() {
  const count = fahrplanSchreibeAufAssets(_plan.items, ASSETS.items);
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  console.info('[Ausbauplaner] Fahrplan auf', count, 'Assets zurückgeschrieben.');
}

// ── Getter ────────────────────────────────────────────────────────────────────
export function ausbauGetPlan() { return _plan; }
export function ausbauGetKonflikte() { return _konflikte; }

// ── Helfer ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
