// ── 13e-assets-inspector.js — Editor-Panel für selektiertes Asset ──────────

// Persistiert den Einklapp-Zustand der Sektionen innerhalb einer Session
const _sectionCollapsed = {};
// Persistiert den Einklapp-Zustand der Asset-Gruppen in der Hauptliste
const _groupCollapsed = {};

function wireSectionToggles(panel) {
  panel.querySelectorAll('.ins-section-header[data-target]').forEach(hdr => {
    const targetId = hdr.dataset.target;
    const content  = panel.querySelector('#' + targetId);
    if (!content) return;
    // Gespeicherten Zustand wiederherstellen
    if (_sectionCollapsed[targetId]) {
      hdr.classList.add('is-collapsed');
      content.classList.add('is-collapsed');
    }
    hdr.addEventListener('click', () => {
      const nowCollapsed = hdr.classList.toggle('is-collapsed');
      content.classList.toggle('is-collapsed', nowCollapsed);
      _sectionCollapsed[targetId] = nowCollapsed;
    });
  });
}

import { ASSETS, ASSET_CFG, ASSET_PROPS_SCHEMA, TYPE_RANK, getAssetStatus, getAsset, deleteAsset } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets } from './13b-assets-render.js';
import { openSlpEditor } from './13i-slp-editor.js';
import { globalYear } from './01-globals-varianten.js';

// Inspector-Slot sitzt im Elektro-Tab der rechten Sidebar
function getPanel() { return document.getElementById('sb-asset-inspector-slot'); }

export function openAssetInspector(asset) {
  if (!asset) return;
  ASSETS.selectedId = asset.id;
  const panel = getPanel();
  if (!panel) return;
  // Rechte Sidebar: zum Elektro-Tab wechseln
  if (typeof window.setSidebarTab === 'function') window.setSidebarTab('elektro');
  // Inspector anzeigen, Liste ausblenden
  const listEl = document.getElementById('sb-asset-list');
  if (listEl) listEl.style.display = 'none';
  panel.style.display = 'flex';
  renderInspector(asset);
}

export function closeAssetInspector() {
  const panel = getPanel();
  if (panel) panel.style.display = 'none';
  ASSETS.selectedId = null;
  // Asset-Liste wieder einblenden und aktualisieren
  const listEl = document.getElementById('sb-asset-list');
  if (listEl) listEl.style.display = '';
  renderSidebarAssetList();
}

// ── Asset-Liste (alle Assets nach Typ gruppiert) ────────────────────────────
export function renderSidebarAssetList() {
  const container = document.getElementById('sb-asset-list');
  if (!container) return;

  const items = ASSETS.items;
  const edges = window.stromEdges || [];

  // Zähler-Badge
  const countEl = document.getElementById('sb-asset-count');
  if (countEl) countEl.textContent = items.length;

  if (items.length === 0 && edges.length === 0) {
    container.innerHTML = `<div class="sb-asset-empty">
      <div style="font-size:20px;margin-bottom:6px;">⚡</div>
      <div>Noch keine Komponenten platziert.</div>
      <div style="margin-top:4px;font-size:9px;opacity:.6;">⚡-Tab links → Komponenten platzieren</div>
    </div>`;
    return;
  }

  // Nach Typ gruppieren, Typen nach TYPE_RANK sortieren
  const byType = new Map();
  for (const a of items) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
  }
  const sortedTypes = [...byType.keys()].sort((a, b) =>
    (TYPE_RANK[a] ?? 99) - (TYPE_RANK[b] ?? 99)
  );

  let html = '';
  for (const type of sortedTypes) {
    const cfg = ASSET_CFG[type];
    const typeItems = byType.get(type);
    const rows = typeItems.map(a => {
      const status  = getAssetStatus(a, globalYear);
      const opacity = status === 'active' ? 1 : 0.45;
      const hasPending = (a.massnahmen || []).some(m => m.status === 'geplant');
      const pendingDot = hasPending
        ? `<span class="sb-asset-pending-dot" title="Offene Maßnahmen"></span>`
        : '';
      const sel = ASSETS.selectedId === a.id ? ' selected' : '';
      return `<div class="sb-asset-row${sel}" data-asset-id="${a.id}">
        <span class="sb-asset-row-icon" style="background:${cfg.color};opacity:${opacity};">${cfg.icon}</span>
        <span class="sb-asset-row-name">${esc(a.name)}</span>
        ${pendingDot}
        <span class="sb-asset-row-status sb-asset-row-status-${status}"></span>
      </div>`;
    }).join('');
    const collapsed = !!_groupCollapsed[type];
    html += `<div class="sb-asset-group">
      <div class="sb-asset-group-hdr${collapsed ? ' is-collapsed' : ''}" data-group-type="${type}">
        <span class="sb-asset-group-icon" style="color:${cfg.color};">${cfg.icon}</span>
        <span class="sb-asset-group-label">${cfg.label}</span>
        <span class="sb-asset-group-count">${typeItems.length}</span>
        <span class="sb-asset-group-chevron">▾</span>
      </div>
      <div class="sb-asset-group-rows${collapsed ? ' is-collapsed' : ''}">
        ${rows}
      </div>
    </div>`;
  }

  // Kabel-Sektion
  if (edges.length > 0) {
    const cableRows = edges.map((e, idx) => {
      const np    = e.nParallel > 1 ? `${e.nParallel}× ` : '';
      const label = `${np}${e.cableType || 'NAYY'} ${e.crossSection || '?'} mm²`;
      const lenStr = e.lengthM ? ` · ${Math.round(e.lengthM)} m` : '';
      const ausl  = e.auslastungPct || 0;
      const dot   = ausl < 80 ? '#4caf50' : ausl < 100 ? '#f9a825' : '#e53935';
      return `<div class="sb-asset-row" data-edge-idx="${idx}">
        <span class="sb-asset-row-icon" style="background:#3a3a3a;color:#fdd835;font-size:11px;">━</span>
        <span class="sb-asset-row-name">${esc(label)}${esc(lenStr)}</span>
        <span style="width:6px;height:6px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
      </div>`;
    }).join('');
    const collapsed = !!_groupCollapsed['_cables'];
    html += `<div class="sb-asset-group">
      <div class="sb-asset-group-hdr${collapsed ? ' is-collapsed' : ''}" data-group-type="_cables">
        <span class="sb-asset-group-icon" style="color:#fdd835;">━</span>
        <span class="sb-asset-group-label">Kabel</span>
        <span class="sb-asset-group-count">${edges.length}</span>
        <span class="sb-asset-group-chevron">▾</span>
      </div>
      <div class="sb-asset-group-rows${collapsed ? ' is-collapsed' : ''}">
        ${cableRows}
      </div>
    </div>`;
  }

  container.innerHTML = html;

  // Gruppen einklappen/ausklappen
  container.querySelectorAll('.sb-asset-group-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const type = hdr.dataset.groupType;
      const rows = hdr.nextElementSibling;
      const nowCollapsed = hdr.classList.toggle('is-collapsed');
      rows.classList.toggle('is-collapsed', nowCollapsed);
      _groupCollapsed[type] = nowCollapsed;
    });
  });

  // Klick-Handler: Assets
  container.querySelectorAll('.sb-asset-row[data-asset-id]').forEach(row => {
    row.addEventListener('click', () => {
      const a = ASSETS.items.find(x => x.id === row.dataset.assetId);
      if (a) openAssetInspector(a);
    });
  });

  // Klick-Handler: Kabel → öffnet Kabel-Inspector-Modal
  container.querySelectorAll('.sb-asset-row[data-edge-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const idx  = parseInt(row.dataset.edgeIdx);
      const edge = (window.stromEdges || [])[idx];
      if (edge && typeof window.openCableInspector === 'function') window.openCableInspector(edge);
    });
  });
}

// ── Hilfsfunktionen für Formular-Felder ─────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function numField(id, key, label, dflt, opts = {}) {
  const p = opts.props || {};
  const val = p[key] !== undefined ? p[key] : dflt;
  const step = opts.step || 'any';
  const min  = opts.min  !== undefined ? `min="${opts.min}"` : '';
  return `<div class="ins-field-group">
    <label class="ins-field-label">${label}</label>
    <input class="ins-field-input" type="number" step="${step}" ${min}
      value="${val}" data-prop="${key}" data-id="${id}">
  </div>`;
}

function selectField(id, key, label, options, current) {
  const opts = options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return `<option value="${v}"${current === v ? ' selected' : ''}>${l}</option>`;
  }).join('');
  return `<div class="ins-field-group">
    <label class="ins-field-label">${label}</label>
    <select class="ins-field-input" data-prop="${key}" data-id="${id}">${opts}</select>
  </div>`;
}

function checkField(id, key, label, checked) {
  return `<label class="ins-check-row">
    <input type="checkbox" data-prop="${key}" data-id="${id}" ${checked ? 'checked' : ''}>
    <span>${label}</span>
  </label>`;
}

function row2(...fields) {
  return `<div class="ins-row-2">${fields.join('')}</div>`;
}
function row3(...fields) {
  return `<div class="ins-row-3">${fields.join('')}</div>`;
}

// ── Props-Formular je Typ ───────────────────────────────────────────────────
function buildPropsForm(asset) {
  const id = asset.id;
  const p  = asset.props || {};

  switch (asset.type) {
    case 'NAP':
      return row2(numField(id, 'spannungKV', 'Nennspannung (kV)', 20, {props:p, step:1, min:1}));

    case 'Schaltanlage':
      return row2(
        numField(id, 'felder',     'Anzahl Felder',  6,   {props:p, step:1, min:1}),
        numField(id, 'nennstromA', 'Nennstrom (A)',  630, {props:p, step:1})
      ) + checkField(id, 'trennstelle', 'Trennstelle (Schutzkonzept)', !!p.trennstelle);

    case 'Trafo': {
      const kvaOpts = [50,100,160,200,250,315,400,500,630,800,1000,1250,1600,2000]
        .map(v => ({ value: v, label: `${v} kVA` }));
      const curKva = parseFloat(p.leistungKVA) || 630;
      return row2(
        selectField(id, 'leistungKVA', 'Leistung (kVA)', kvaOpts, curKva),
        numField(id, 'ukProzent', 'UK (%)', 4, {props:p, step:0.1})
      );
    }

    case 'NSHV':
    case 'UV':
      return row2(
        numField(id, 'nennstromA', 'Nennstrom (A)', 400, {props:p, step:1}),
        numField(id, 'abgaenge',   'Abgänge',         4, {props:p, step:1, min:1})
      );

    case 'Verbraucher': {
      const slpOpts = ['G0','G1','G2','G3','G4','G5','G6','H0','L0','L1','L2'];
      const curSlp = p.slpTyp || 'G0';
      return numField(id, 'leistungKW', 'Leistung (kW)', 10, {props:p})
        + selectField(id, 'slpTyp', 'Lastprofil (SLP)', slpOpts.map(t => ({value:t, label:t})), curSlp)
        + `<button class="ins-link-btn" data-slp-open="${curSlp}">Profil ansehen →</button>`;
    }

    case 'WP':
      return numField(id, 'leistungKW', 'Leistung (kW)', 10, {props:p});

    case 'PV':
      return numField(id, 'leistungKWp', 'Leistung (kWp)', 10, {props:p});

    case 'Batterie': {
      const modus = p.betriebsmodus || 'einspeisung';
      return row2(
        numField(id, 'kapazitaetKWh', 'Kapazität (kWh)', 50, {props:p}),
        numField(id, 'leistungKW',    'Leistung (kW)',    25, {props:p})
      ) + `<div class="ins-field-group">
        <label class="ins-field-label">Betriebsmodus</label>
        <div class="ins-toggle-row">
          <button class="ins-toggle-btn${modus==='einspeisung'?' active-gen':''}"
            data-prop="betriebsmodus" data-val="einspeisung" data-id="${id}">⬇ Einspeisung</button>
          <button class="ins-toggle-btn${modus==='verbraucher'?' active-load':''}"
            data-prop="betriebsmodus" data-val="verbraucher" data-id="${id}">⬆ Verbraucher</button>
        </div>
      </div>`;
    }

    case 'Lade':
      return row2(
        numField(id, 'anzahlPunkte',       'Anz. Punkte',   4,  {props:p, step:1, min:1}),
        numField(id, 'leistungProPunktKW', 'kW / Punkt',   22,  {props:p})
      );

    case 'Nsa':
      return row2(
        numField(id, 'leistungKW',  'Leistung (kW)',   100, {props:p}),
        numField(id, 'autonomieH',  'Autonomie (h)',     8, {props:p, step:1})
      ) + selectField(id, 'kraftstoff', 'Kraftstoff',
          [{value:'Diesel',label:'Diesel'},{value:'Gas',label:'Gas'},{value:'HVO',label:'HVO (Biokraftstoff)'}],
          p.kraftstoff || 'Diesel');

    case 'KWK': {
      const brennstoff = p.brennstoff || 'Erdgas';
      return row2(
        numField(id, 'leistungElKW',     'El. Leistung (kW)',       100, {props:p}),
        numField(id, 'leistungThKW',     'Th. Leistung (kW)',       160, {props:p})
      ) + row2(
        numField(id, 'wirkungsgradEl',   'El. Wirkungsgrad (%)',     35, {props:p}),
        numField(id, 'wirkungsgradGes',  'Gesamtwirkungsgrad (%)',   85, {props:p})
      ) + selectField(id, 'brennstoff', 'Brennstoff',
          ['Erdgas','Biogas','Wasserstoff','Heizöl'], brennstoff);
    }

    case 'Wind':
      return row2(
        numField(id, 'leistungKW',         'Nennleistung (kW)',    500, {props:p}),
        numField(id, 'nabenhoheM',          'Nabenhöhe (m)',        100, {props:p, step:1})
      ) + row2(
        numField(id, 'rotordurchmesserM',  'Rotordurchmesser (m)',  60, {props:p, step:1}),
        numField(id, 'einschaltwindMs',    'Einschaltwind (m/s)',    3, {props:p, step:0.5})
      ) + row2(
        numField(id, 'nennwindMs',         'Nennwind (m/s)',         12, {props:p, step:0.5}),
        numField(id, 'abschaltwindMs',     'Abschaltwind (m/s)',     25, {props:p, step:0.5})
      );

    default:
      return `<div style="font-size:10px;color:var(--muted);">Keine weiteren Eigenschaften.</div>`;
  }
}

// ── Maßnahmen-Hilfsfunktionen ────────────────────────────────────────────────
function massnahmeId() { return 'm_' + Math.random().toString(36).slice(2, 8); }

const MASSN_STATUS = {
  geplant:    { label: 'Geplant',   color: '#4fc3f7' },
  umgesetzt:  { label: 'Umgesetzt', color: '#4caf50' },
  abgelehnt:  { label: 'Abgelehnt', color: '#9e9e9e' },
};

const MASSN_TYP = {
  Sanierung: { label: 'Sanierung', icon: '🔧', hasNewProps: true  },
  Abriss:    { label: 'Abriss',    icon: '🏚', hasNewProps: false },
};

function _massnRowHtml(m) {
  const s = MASSN_STATUS[m.status] || MASSN_STATUS.geplant;
  const t = MASSN_TYP[m.typ]       || MASSN_TYP.Sonstiges;
  const kosten = m.kosten ? m.kosten.toLocaleString('de-DE') + ' €' : '—';
  return `<div class="ins-massn-row" data-m-id="${m.id}">
    <span class="ins-massn-dot" style="background:${s.color};" title="${s.label}"></span>
    <div class="ins-massn-info">
      <div class="ins-massn-titel">${t.icon} ${esc(m.titel || '—')}</div>
      <div class="ins-massn-meta">${m.jahr || '—'} · ${kosten} · <span class="ins-massn-typ-tag">${t.label}</span></div>
    </div>
    <button class="ins-massn-edit" data-m-id="${m.id}" title="Bearbeiten">✎</button>
    <button class="ins-massn-del"  data-m-id="${m.id}" title="Löschen">×</button>
  </div>`;
}

function buildMassnahmenSection(asset) {
  const list = (asset.massnahmen || []);
  const rows = list.map(_massnRowHtml).join('');

  const typOpts    = Object.entries(MASSN_TYP)
    .map(([v, t]) => `<option value="${v}">${t.icon} ${t.label}</option>`).join('');
  const statusOpts = Object.entries(MASSN_STATUS)
    .map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('');

  return `
    <div class="ins-massn-list" id="ins-massn-list-${asset.id}">${rows || '<div class="ins-massn-empty">Keine Maßnahmen</div>'}</div>
    <button class="ins-massn-add-btn" id="ins-massn-add-${asset.id}">+ Maßnahme hinzufügen</button>
    <div class="ins-massn-form" id="ins-massn-form-${asset.id}" style="display:none;">
      <input class="ins-field-input" type="text" id="mf-titel-${asset.id}" placeholder="Titel der Maßnahme">
      <div class="ins-row-2" style="margin-top:4px;">
        <input class="ins-field-input" type="number" id="mf-jahr-${asset.id}"   placeholder="Jahr">
        <input class="ins-field-input" type="number" id="mf-kosten-${asset.id}" placeholder="Kosten €" min="0">
      </div>
      <div class="ins-row-2" style="margin-top:4px;">
        <select class="ins-field-input" id="mf-typ-${asset.id}">${typOpts}</select>
        <select class="ins-field-input" id="mf-status-${asset.id}">${statusOpts}</select>
      </div>
      <div id="mf-newprops-${asset.id}" style="display:none;"></div>
      <div class="ins-massn-form-btns">
        <button class="ins-massn-form-cancel" id="mf-cancel-${asset.id}">Abbrechen</button>
        <button class="ins-massn-form-save"   id="mf-save-${asset.id}">Speichern</button>
      </div>
    </div>`;
}

function wireMassnahmen(panel, asset) {
  const aid = asset.id;
  let editingId = null;

  function refreshList() {
    const listEl = panel.querySelector(`#ins-massn-list-${aid}`);
    if (!listEl) return;
    const list = asset.massnahmen || [];
    listEl.innerHTML = list.length
      ? list.map(_massnRowHtml).join('')
      : '<div class="ins-massn-empty">Keine Maßnahmen</div>';
    bindRowButtons();
  }

  function updateNewPropsForm(typ) {
    const container = panel.querySelector(`#mf-newprops-${aid}`);
    if (!container) return;
    const typDef = MASSN_TYP[typ];
    if (!typDef?.hasNewProps) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    const schema = ASSET_PROPS_SCHEMA[asset.type] || [];
    if (schema.length === 0) {
      container.innerHTML = `<div class="ins-newprops-label">Keine editierbaren Parameter für diesen Typ.</div>`;
      container.style.display = '';
      return;
    }
    container.innerHTML = `<div class="ins-newprops-label">Ziel-Parameter (optional):</div>` +
      schema.map(s => `<div class="ins-field-group">
        <label class="ins-field-label">${s.label}</label>
        <input class="ins-field-input mf-newprop" type="text" data-prop="${s.key}" placeholder="${s.label}">
      </div>`).join('');
    container.style.display = '';
  }

  function openForm(m) {
    editingId = m ? m.id : null;
    const form = panel.querySelector(`#ins-massn-form-${aid}`);
    form.querySelector(`#mf-titel-${aid}`).value  = m?.titel  || '';
    form.querySelector(`#mf-jahr-${aid}`).value   = m?.jahr   || '';
    form.querySelector(`#mf-kosten-${aid}`).value = m?.kosten || '';
    form.querySelector(`#mf-typ-${aid}`).value    = m?.typ    || 'Sanierung';
    form.querySelector(`#mf-status-${aid}`).value = m?.status || 'geplant';
    updateNewPropsForm(m?.typ || 'Sanierung');
    // Gespeicherte Ziel-Props befüllen
    if (m?.newProps) {
      const container = panel.querySelector(`#mf-newprops-${aid}`);
      container?.querySelectorAll('.mf-newprop').forEach(inp => {
        const key = inp.dataset.prop;
        if (m.newProps[key] !== undefined) inp.value = m.newProps[key];
      });
    }
    form.style.display = '';
    form.querySelector(`#mf-titel-${aid}`).focus();
  }

  function closeForm() {
    editingId = null;
    panel.querySelector(`#ins-massn-form-${aid}`).style.display = 'none';
  }

  function saveForm() {
    const titel  = panel.querySelector(`#mf-titel-${aid}`).value.trim();
    if (!titel) return;
    const jahr   = parseInt(panel.querySelector(`#mf-jahr-${aid}`).value)    || null;
    const kosten = parseFloat(panel.querySelector(`#mf-kosten-${aid}`).value) || 0;
    const typ    = panel.querySelector(`#mf-typ-${aid}`).value;
    const status = panel.querySelector(`#mf-status-${aid}`).value;

    // Ziel-Parameter einsammeln
    const newProps = {};
    if (MASSN_TYP[typ]?.hasNewProps) {
      panel.querySelector(`#mf-newprops-${aid}`)?.querySelectorAll('.mf-newprop').forEach(inp => {
        const key = inp.dataset.prop;
        const v = inp.value.trim();
        if (v !== '') {
          const n = parseFloat(v);
          newProps[key] = isNaN(n) ? v : n;
        }
      });
    }

    if (!asset.massnahmen) asset.massnahmen = [];
    if (editingId) {
      const m = asset.massnahmen.find(x => x.id === editingId);
      if (m) Object.assign(m, { titel, jahr, kosten, typ, status, newProps });
    } else {
      asset.massnahmen.push({ id: massnahmeId(), titel, jahr, kosten, typ, status, newProps });
    }
    closeForm();
    refreshList();
    drawAssetMarker(asset); // Marker-Badge aktualisieren
  }

  function bindRowButtons() {
    panel.querySelectorAll('.ins-massn-edit').forEach(btn => {
      btn.onclick = () => {
        const m = (asset.massnahmen || []).find(x => x.id === btn.dataset.mId);
        if (m) openForm(m);
      };
    });
    panel.querySelectorAll('.ins-massn-del').forEach(btn => {
      btn.onclick = () => {
        asset.massnahmen = (asset.massnahmen || []).filter(x => x.id !== btn.dataset.mId);
        refreshList();
        drawAssetMarker(asset); // Marker-Badge aktualisieren
      };
    });
  }

  panel.querySelector(`#ins-massn-add-${aid}`)?.addEventListener('click', () => openForm(null));
  panel.querySelector(`#mf-cancel-${aid}`)?.addEventListener('click',  closeForm);
  panel.querySelector(`#mf-save-${aid}`)?.addEventListener('click',    saveForm);
  panel.querySelector(`#mf-typ-${aid}`)?.addEventListener('change', e => updateNewPropsForm(e.target.value));
  panel.querySelector(`#ins-massn-form-${aid}`)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveForm();
    if (e.key === 'Escape') closeForm();
  });
  bindRowButtons();
}

// ── Investitionsplan ─────────────────────────────────────────────────────────
export function showInvestitionsplan() {
  const allAssets = (typeof window !== 'undefined' && window.ASSETS?.items)
    ? window.ASSETS.items
    : (typeof ASSETS !== 'undefined' ? ASSETS.items : []);

  const rows = [];
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      rows.push({ asset: a, m });
    }
  }

  if (rows.length === 0) {
    const overlay = document.createElement('div');
    overlay.className = 'ep-modal-overlay';
    overlay.innerHTML = `<div class="ep-modal">
      <div class="ep-modal-title">Investitionsplan</div>
      <div class="ep-modal-body">Keine Maßnahmen vorhanden.<br>Öffne ein Asset und füge Maßnahmen hinzu.</div>
      <div class="ep-modal-btns"><button class="ep-modal-btn primary" id="inv-close">Schließen</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#inv-close').onclick = () => document.body.removeChild(overlay);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) document.body.removeChild(overlay); });
    return;
  }

  rows.sort((a, b) => (a.m.jahr || 9999) - (b.m.jahr || 9999));

  // Jahres-Gruppen
  const byYear = new Map();
  for (const r of rows) {
    const y = r.m.jahr || '—';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }

  let tableHtml = '';
  let total = 0;
  for (const [year, yearRows] of byYear) {
    const yearTotal = yearRows.reduce((s, r) => s + (r.m.kosten || 0), 0);
    total += yearTotal;
    tableHtml += `<tr class="inv-year-header"><td colspan="5">${year}
      <span class="inv-year-total">${yearTotal.toLocaleString('de-DE')} €</span></td></tr>`;
    for (const r of yearRows) {
      const s = MASSN_STATUS[r.m.status] || MASSN_STATUS.geplant;
      const t = MASSN_TYP[r.m.typ]       || MASSN_TYP.Sonstiges;
      tableHtml += `<tr>
        <td><span class="ins-massn-dot" style="background:${s.color};display:inline-block;"></span> ${esc(r.asset.name)}</td>
        <td>${esc(r.m.titel || '—')}</td>
        <td style="font-size:9px;white-space:nowrap;">${t.icon} ${t.label}</td>
        <td class="inv-num">${r.m.kosten ? r.m.kosten.toLocaleString('de-DE') + ' €' : '—'}</td>
        <td><span style="color:${s.color};font-size:9px;">${s.label}</span></td>
      </tr>`;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'ep-modal-overlay';
  overlay.innerHTML = `<div class="ep-modal inv-modal">
    <div class="ep-modal-title">📋 Investitionsplan
      <span class="inv-total-badge">${total.toLocaleString('de-DE')} €</span>
    </div>
    <div class="inv-table-wrap">
      <table class="inv-table">
        <thead><tr><th>Asset</th><th>Maßnahme</th><th>Typ</th><th class="inv-num">Kosten</th><th>Status</th></tr></thead>
        <tbody>${tableHtml}</tbody>
      </table>
    </div>
    <div class="ep-modal-btns" style="margin-top:12px;">
      <button class="ep-modal-btn primary" id="inv-close">Schließen</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#inv-close').onclick = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', ev => { if (ev.target === overlay) document.body.removeChild(overlay); });
}

// ── Berechnungsergebnis-Block ────────────────────────────────────────────────
function buildResultBlock(asset) {
  const sn = (window.stromNodes || []).find(n => n.id === asset.id);
  if (!sn || sn._voltDropV == null) return '';
  const dU_pct = (sn._voltDropV / 400) * 100;
  const col = Math.abs(dU_pct) > 5 ? '#e53935' : Math.abs(dU_pct) > 3 ? '#f9a825' : '#4caf50';
  return `<div class="ins-result-block" style="border-left-color:${col};">
    <div class="ins-result-label">Kum. Spannungsfall ab Trafo</div>
    <div class="ins-result-value" style="color:${col};">${dU_pct.toFixed(2)} %</div>
    <div class="ins-result-sub">${sn._voltDropV.toFixed(1)} V &nbsp;(Grenze: 3 % / 5 %)</div>
  </div>`;
}

// ── Gebäude-Zuordnung (editierbares Dropdown) ────────────────────────────────
function buildBuildingSelect(asset) {
  const buildings = (window.gebaeude || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const opts = buildings.map(g =>
    `<option value="${g.id}"${asset.buildingId === g.id ? ' selected' : ''}>${esc(g.name)}</option>`
  ).join('');
  return `<div class="ins-field-group">
    <label class="ins-field-label">🏢 Gebäude</label>
    <select class="ins-field-input" data-field="buildingId">
      <option value=""${!asset.buildingId ? ' selected' : ''}>— Frei (kein Gebäude)</option>
      ${opts}
    </select>
  </div>`;
}

// ── Haupt-Render ─────────────────────────────────────────────────────────────
function renderInspector(asset) {
  const panel = getPanel();
  if (!panel) return;
  const cfg = ASSET_CFG[asset.type];

  panel.innerHTML = `
    <button class="sb-asset-back-btn" id="sb-asset-back">← Alle Assets</button>
    <div class="asset-ins-header" style="background:${cfg.color};">
      <span class="asset-ins-icon">${cfg.icon}</span>
      <span class="asset-ins-title">${cfg.label}</span>
    </div>
    <div class="asset-ins-body">
      <div class="ins-field-group">
        <label class="ins-field-label">Name</label>
        <input class="ins-field-input" type="text" data-field="name" value="${esc(asset.name)}">
      </div>
      ${buildBuildingSelect(asset)}
      <div class="ins-row-2">
        <div class="ins-field-group">
          <label class="ins-field-label">Baujahr</label>
          <input class="ins-field-input" type="number" data-field="baujahr"
            value="${asset.baujahr ?? ''}" placeholder="—">
        </div>
        <div class="ins-field-group">
          <label class="ins-field-label">Abrissjahr</label>
          <input class="ins-field-input" type="number" data-field="abrissjahr"
            value="${asset.abrissjahr ?? ''}" placeholder="—">
        </div>
      </div>
      <div class="ins-section-header" data-target="ins-sec-eigenschaften">
        <span class="asset-ins-section-title">Eigenschaften</span>
        <span class="ins-section-chevron">▾</span>
      </div>
      <div class="ins-section-content" id="ins-sec-eigenschaften">
        ${buildPropsForm(asset)}
        ${buildResultBlock(asset)}
      </div>
      <div class="ins-section-header" data-target="ins-sec-massnahmen">
        <span class="asset-ins-section-title">Maßnahmen</span>
        <span class="ins-section-chevron">▾</span>
      </div>
      <div class="ins-section-content" id="ins-sec-massnahmen">
        ${buildMassnahmenSection(asset)}
      </div>
      <div class="ins-meta" style="margin-top:12px;">ID: ${asset.id} · ${asset.domain}</div>
      <button class="asset-ins-delete" data-action="delete">🗑 Löschen</button>
    </div>
  `;

  panel.querySelector('#sb-asset-back')?.addEventListener('click', closeAssetInspector);
  wireSectionToggles(panel);
  wireEvents(panel, asset);
  wireMassnahmen(panel, asset);
}

function wireEvents(panel, asset) {
  // Textfelder, Zahlenfelder, Gebäude-Zuweisung
  panel.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('change', () => {
      const f = inp.dataset.field;
      if (f === 'name') {
        asset.name = inp.value;
      } else if (f === 'baujahr' || f === 'abrissjahr') {
        asset[f] = inp.value === '' ? null : parseInt(inp.value);
        drawAssetMarker(asset);
      } else if (f === 'buildingId') {
        asset.buildingId = inp.value || null;
        redrawAllAssets();
      }
    });
  });

  // Props: Zahlfelder und Selects
  panel.querySelectorAll('[data-prop][data-id]').forEach(el => {
    const key = el.dataset.prop;
    const handler = () => {
      if (el.type === 'checkbox') {
        asset.props[key] = el.checked;
      } else if (el.tagName === 'SELECT') {
        const rawVal = el.value;
        const numVal = parseFloat(rawVal);
        asset.props[key] = isNaN(numVal) ? rawVal : numVal;
      } else {
        const v = el.value === '' ? null : parseFloat(el.value);
        asset.props[key] = v;
      }
    };
    el.addEventListener('change', handler);
  });

  // Toggle-Buttons (Batterie Betriebsmodus)
  panel.querySelectorAll('.ins-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      asset.props[btn.dataset.prop] = btn.dataset.val;
      renderInspector(asset); // neu rendern für Button-Highlight
    });
  });

  // SLP-Profil-Viewer öffnen (liest slpTyp aus aktuellem Select-Wert)
  panel.querySelectorAll('[data-slp-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = panel.querySelector('[data-prop="slpTyp"]');
      const typ = sel ? sel.value : (btn.dataset.slpOpen || 'G0');
      openSlpEditor(typ);
    });
  });

  panel.querySelectorAll('[data-action="close"]').forEach(b =>
    b.addEventListener('click', closeAssetInspector));

  panel.querySelectorAll('[data-action="delete"]').forEach(b =>
    b.addEventListener('click', () => {
      if (typeof window.removeStromNode === 'function') window.removeStromNode(asset.id);
      deleteAsset(asset.id);
      redrawAllAssets();
      closeAssetInspector();
    }));
}

// Window-Bridge
setTimeout(() => {
  window.openAssetInspector    = openAssetInspector;
  window.closeAssetInspector   = closeAssetInspector;
  window.showInvestitionsplan  = showInvestitionsplan;
  window.renderSidebarAssetList = renderSidebarAssetList;
}, 0);
