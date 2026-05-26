// ── 13e-assets-inspector.js — Editor-Panel für selektiertes Asset ──────────

import { ASSETS, ASSET_CFG, getAsset, deleteAsset } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets } from './13b-assets-render.js';

function getPanel() { return document.getElementById('asset-inspector'); }

export function openAssetInspector(asset) {
  if (!asset) return;
  ASSETS.selectedId = asset.id;
  // Sidebar öffnen falls zugeklappt
  const sb = document.getElementById('sidebar');
  if (sb?.classList.contains('collapsed') && typeof window.toggleSidebar === 'function') {
    window.toggleSidebar();
  }
  // Zum Assets-Tab wechseln
  if (typeof window.setSidebarTab === 'function') window.setSidebarTab('assets');
  else renderAssetSidebar();
  // Nach kurzem Timeout scrollen, damit DOM gerendert ist
  setTimeout(() => {
    const card = document.getElementById(`asb-card-${asset.id}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 60);
}

export function closeAssetInspector() {
  const panel = getPanel();
  if (panel) panel.classList.remove('visible');
  ASSETS.selectedId = null;
  renderAssetSidebar();
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

    case 'Verbraucher':
      return numField(id, 'leistungKW', 'Leistung (kW)', 10, {props:p});

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
  geplant:    { label: 'Geplant',    color: '#4fc3f7' },
  umgesetzt:  { label: 'Umgesetzt', color: '#4caf50' },
  abgelehnt:  { label: 'Abgelehnt', color: '#9e9e9e' },
};

function buildMassnahmenSection(asset) {
  const list = (asset.massnahmen || []);
  const rows = list.map(m => {
    const s = MASSN_STATUS[m.status] || MASSN_STATUS.geplant;
    const kosten = m.kosten ? m.kosten.toLocaleString('de-DE') + ' €' : '—';
    return `<div class="ins-massn-row" data-m-id="${m.id}">
      <span class="ins-massn-dot" style="background:${s.color};" title="${s.label}"></span>
      <div class="ins-massn-info">
        <div class="ins-massn-titel">${esc(m.titel || '—')}</div>
        <div class="ins-massn-meta">${m.jahr || '—'} · ${kosten}</div>
      </div>
      <button class="ins-massn-edit" data-m-id="${m.id}" title="Bearbeiten">✎</button>
      <button class="ins-massn-del"  data-m-id="${m.id}" title="Löschen">×</button>
    </div>`;
  }).join('');

  return `
    <div class="asset-ins-section-title" style="margin-top:12px;">Maßnahmen</div>
    <div class="ins-massn-list" id="ins-massn-list-${asset.id}">${rows || '<div class="ins-massn-empty">Keine Maßnahmen</div>'}</div>
    <button class="ins-massn-add-btn" id="ins-massn-add-${asset.id}">+ Maßnahme hinzufügen</button>
    <div class="ins-massn-form" id="ins-massn-form-${asset.id}" style="display:none;">
      <input class="ins-field-input" type="text"   id="mf-titel-${asset.id}"  placeholder="Titel der Maßnahme">
      <div class="ins-row-2" style="margin-top:4px;">
        <input class="ins-field-input" type="number" id="mf-jahr-${asset.id}"   placeholder="Jahr">
        <input class="ins-field-input" type="number" id="mf-kosten-${asset.id}" placeholder="Kosten €" min="0">
      </div>
      <select class="ins-field-input" id="mf-status-${asset.id}" style="margin-top:4px;">
        ${Object.entries(MASSN_STATUS).map(([v,s]) => `<option value="${v}">${s.label}</option>`).join('')}
      </select>
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
    listEl.innerHTML = list.length ? list.map(m => {
      const s = MASSN_STATUS[m.status] || MASSN_STATUS.geplant;
      const kosten = m.kosten ? m.kosten.toLocaleString('de-DE') + ' €' : '—';
      return `<div class="ins-massn-row" data-m-id="${m.id}">
        <span class="ins-massn-dot" style="background:${s.color};" title="${s.label}"></span>
        <div class="ins-massn-info">
          <div class="ins-massn-titel">${esc(m.titel || '—')}</div>
          <div class="ins-massn-meta">${m.jahr || '—'} · ${kosten}</div>
        </div>
        <button class="ins-massn-edit" data-m-id="${m.id}" title="Bearbeiten">✎</button>
        <button class="ins-massn-del"  data-m-id="${m.id}" title="Löschen">×</button>
      </div>`;
    }).join('') : '<div class="ins-massn-empty">Keine Maßnahmen</div>';
    bindRowButtons();
  }

  function openForm(m) {
    editingId = m ? m.id : null;
    const form  = panel.querySelector(`#ins-massn-form-${aid}`);
    form.querySelector(`#mf-titel-${aid}`).value  = m?.titel  || '';
    form.querySelector(`#mf-jahr-${aid}`).value   = m?.jahr   || '';
    form.querySelector(`#mf-kosten-${aid}`).value = m?.kosten || '';
    form.querySelector(`#mf-status-${aid}`).value = m?.status || 'geplant';
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
    const jahr   = parseInt(panel.querySelector(`#mf-jahr-${aid}`).value) || null;
    const kosten = parseFloat(panel.querySelector(`#mf-kosten-${aid}`).value) || 0;
    const status = panel.querySelector(`#mf-status-${aid}`).value;
    if (!asset.massnahmen) asset.massnahmen = [];
    if (editingId) {
      const m = asset.massnahmen.find(x => x.id === editingId);
      if (m) Object.assign(m, { titel, jahr, kosten, status });
    } else {
      asset.massnahmen.push({ id: massnahmeId(), titel, jahr, kosten, status });
    }
    closeForm();
    refreshList();
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
      };
    });
  }

  panel.querySelector(`#ins-massn-add-${aid}`)?.addEventListener('click', () => openForm(null));
  panel.querySelector(`#mf-cancel-${aid}`)?.addEventListener('click',  closeForm);
  panel.querySelector(`#mf-save-${aid}`)?.addEventListener('click',    saveForm);
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
    tableHtml += `<tr class="inv-year-header"><td colspan="4">${year}
      <span class="inv-year-total">${yearTotal.toLocaleString('de-DE')} €</span></td></tr>`;
    for (const r of yearRows) {
      const s = MASSN_STATUS[r.m.status] || MASSN_STATUS.geplant;
      tableHtml += `<tr>
        <td><span class="ins-massn-dot" style="background:${s.color};display:inline-block;"></span> ${esc(r.asset.name)}</td>
        <td>${esc(r.m.titel || '—')}</td>
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
        <thead><tr><th>Asset</th><th>Maßnahme</th><th class="inv-num">Kosten</th><th>Status</th></tr></thead>
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

// ── Gebäude-Badge ────────────────────────────────────────────────────────────
function buildBuildingBadge(asset) {
  if (!asset.buildingId) return '';
  const geb = (window.gebaeude || []).find(g => g.id === asset.buildingId);
  if (!geb) return '';
  return `<div class="ins-building-badge">
    <span>🏢</span>
    <div>
      <div class="ins-result-label">Gebäude</div>
      <div class="ins-building-name">${esc(geb.name)}</div>
    </div>
  </div>`;
}

// ── Gemeinsamer Rumpf (floating panel + sidebar card) ────────────────────────
function buildBodyHtml(asset) {
  return `
    <div class="ins-field-group">
      <label class="ins-field-label">Name</label>
      <input class="ins-field-input" type="text" data-field="name" value="${esc(asset.name)}">
    </div>
    ${buildBuildingBadge(asset)}
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
    <div class="asset-ins-section-title">Eigenschaften</div>
    ${buildPropsForm(asset)}
    ${buildResultBlock(asset)}
    ${buildMassnahmenSection(asset)}
    <div class="ins-meta" style="margin-top:12px;">ID: ${asset.id} · ${asset.domain}</div>`;
}

// ── Haupt-Render (floating panel, für Rückwärtskompatibilität) ───────────────
function renderInspector(asset) {
  const panel = getPanel();
  if (!panel) return;
  const cfg = ASSET_CFG[asset.type];

  panel.innerHTML = `
    <div class="asset-ins-header" style="background:${cfg.color};">
      <span class="asset-ins-icon">${cfg.icon}</span>
      <span class="asset-ins-title">${cfg.label}</span>
      <button class="asset-ins-close" data-action="close">×</button>
    </div>
    <div class="asset-ins-body">
      ${buildBodyHtml(asset)}
      <button class="asset-ins-delete" data-action="delete">🗑 Löschen</button>
    </div>
  `;

  wireEvents(panel, asset);
  wireMassnahmen(panel, asset);
}

// ── Asset-Sidebar ─────────────────────────────────────────────────────────────
const TYPE_ORDER = ['NAP','Schaltanlage','Trafo','NSHV','UV','Verbraucher','Lade','PV','Wind','Batterie','WP','KWK','Nsa'];

export function renderAssetSidebar(filterText) {
  const container = document.getElementById('asset-sidebar-list');
  if (!container) return;

  // Zähler im Tab aktualisieren
  const cntEl = document.getElementById('asset-count');
  if (cntEl) cntEl.textContent = (ASSETS.items || []).length;

  const ft = (filterText ?? document.getElementById('asset-filter')?.value ?? '').toLowerCase();
  const items = (ASSETS.items || []).filter(a => !ft || (a.name || '').toLowerCase().includes(ft));

  // Nach Typ gruppieren
  const groups = {};
  for (const a of items) {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  }

  let html = '';
  for (const type of TYPE_ORDER) {
    if (!groups[type]) continue;
    const cfg = ASSET_CFG[type];
    const sorted = groups[type].slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    html += `<div class="asb-group">
      <div class="asb-group-hdr" style="border-left:3px solid ${cfg.color};">
        <span>${cfg.icon}</span>
        <span class="asb-group-lbl">${cfg.label}</span>
        <span class="asb-group-cnt">${sorted.length}</span>
      </div>`;
    for (const a of sorted) {
      const isOpen = ASSETS.selectedId === a.id;
      html += `<div class="asb-card${isOpen ? ' asb-open' : ''}" id="asb-card-${a.id}">
        <div class="asb-card-hdr" data-asid="${a.id}">
          <span class="asb-card-ico">${cfg.icon}</span>
          <span class="asb-card-name">${esc(a.name)}</span>
          <span class="asb-card-chev">${isOpen ? '▲' : '▼'}</span>
        </div>
        ${isOpen ? `<div class="asb-card-body">
          ${buildBodyHtml(a)}
          <button class="asb-card-del" data-asid="${a.id}">🗑 Löschen</button>
        </div>` : ''}
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html || '<div class="asb-empty">Keine Assets vorhanden.</div>';

  // Events für geöffnete Karte verdrahten
  if (ASSETS.selectedId) {
    const selAsset = (ASSETS.items || []).find(a => a.id === ASSETS.selectedId);
    const card = document.getElementById(`asb-card-${ASSETS.selectedId}`);
    if (selAsset && card) {
      wireEvents(card, selAsset);
      wireMassnahmen(card, selAsset);
      // Toggle-Buttons in Sidebar auch neu rendern
      card.querySelectorAll('.ins-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selAsset.props[btn.dataset.prop] = btn.dataset.val;
          renderAssetSidebar();
        });
      });
    }
  }

  // Karten-Header-Klick: auf-/zuklappen
  container.querySelectorAll('.asb-card-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const id = hdr.dataset.asid;
      ASSETS.selectedId = ASSETS.selectedId === id ? null : id;
      renderAssetSidebar();
      if (ASSETS.selectedId) {
        const card = document.getElementById(`asb-card-${ASSETS.selectedId}`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  // Löschen-Buttons
  container.querySelectorAll('.asb-card-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const asset = (ASSETS.items || []).find(a => a.id === btn.dataset.asid);
      if (!asset) return;
      if (!confirm(`Asset "${asset.name}" wirklich löschen?`)) return;
      if (typeof window.removeStromNode === 'function') window.removeStromNode(asset.id);
      deleteAsset(asset.id);
      redrawAllAssets();
      ASSETS.selectedId = null;
      renderAssetSidebar();
    });
  });
}

export function filterAssetSidebar(text) {
  renderAssetSidebar(text);
}

function wireEvents(panel, asset) {
  // Textfelder & Zahlenfelder (name, baujahr, abrissjahr)
  panel.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('change', () => {
      const f = inp.dataset.field;
      if (f === 'name') {
        asset.name = inp.value;
      } else if (f === 'baujahr' || f === 'abrissjahr') {
        asset[f] = inp.value === '' ? null : parseInt(inp.value);
        drawAssetMarker(asset);
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

  // Toggle-Buttons (Batterie Betriebsmodus) — im floating panel: Panel neu rendern
  panel.querySelectorAll('.ins-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      asset.props[btn.dataset.prop] = btn.dataset.val;
      if (panel.id === 'asset-inspector') renderInspector(asset);
    });
  });

  panel.querySelectorAll('[data-action="close"]').forEach(b =>
    b.addEventListener('click', closeAssetInspector));

  panel.querySelectorAll('[data-action="delete"]').forEach(b =>
    b.addEventListener('click', () => {
      if (confirm(`Asset "${asset.name}" wirklich löschen?`)) {
        if (typeof window.removeStromNode === 'function') window.removeStromNode(asset.id);
        deleteAsset(asset.id);
        redrawAllAssets();
        closeAssetInspector();
      }
    }));
}

// Window-Bridge
setTimeout(() => {
  window.openAssetInspector   = openAssetInspector;
  window.showInvestitionsplan  = showInvestitionsplan;
  window.renderAssetSidebar   = renderAssetSidebar;
  window.filterAssetSidebar   = filterAssetSidebar;
}, 0);
