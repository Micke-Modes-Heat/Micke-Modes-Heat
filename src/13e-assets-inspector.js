// ── 13e-assets-inspector.js — Editor-Panel für selektiertes Asset ──────────

import { ASSETS, ASSET_CFG, getAsset, deleteAsset } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets } from './13b-assets-render.js';

function getPanel() { return document.getElementById('asset-inspector'); }

export function openAssetInspector(asset) {
  if (!asset) return;
  ASSETS.selectedId = asset.id;
  const panel = getPanel();
  if (!panel) return;
  renderInspector(asset);
  panel.classList.add('visible');
}

export function closeAssetInspector() {
  const panel = getPanel();
  if (panel) panel.classList.remove('visible');
  ASSETS.selectedId = null;
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

// ── Haupt-Render ─────────────────────────────────────────────────────────────
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
      <div class="ins-meta">ID: ${asset.id} · ${asset.domain}</div>
      <button class="asset-ins-delete" data-action="delete">🗑 Löschen</button>
    </div>
  `;

  wireEvents(panel, asset);
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

  // Toggle-Buttons (Batterie Betriebsmodus)
  panel.querySelectorAll('.ins-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      asset.props[btn.dataset.prop] = btn.dataset.val;
      renderInspector(asset); // neu rendern für Button-Highlight
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
setTimeout(() => { window.openAssetInspector = openAssetInspector; }, 0);
