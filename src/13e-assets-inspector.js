// ── 13e-assets-inspector.js — Editor-Panel für selektiertes Asset ──────────

import { ASSETS, ASSET_CFG, ASSET_PROPS_SCHEMA, getAsset, deleteAsset } from './13a-assets-core.js';
import { drawAssetMarker } from './13b-assets-render.js';

function getPanel() {
  return document.getElementById('asset-inspector');
}

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

function renderInspector(asset) {
  const panel = getPanel();
  if (!panel) return;
  const cfg = ASSET_CFG[asset.type];
  const propsSchema = ASSET_PROPS_SCHEMA[asset.type] || [];

  let html = `
    <div class="asset-ins-header" style="background:${cfg.color};">
      <span class="asset-ins-icon">${cfg.icon}</span>
      <span class="asset-ins-title">${cfg.label}</span>
      <button class="asset-ins-close" data-action="close">×</button>
    </div>
    <div class="asset-ins-body">
      <label>Name
        <input type="text" data-field="name" value="${escapeAttr(asset.name)}">
      </label>
      <label>Position (Lat, Lng)
        <div style="display:flex;gap:4px;">
          <input type="number" step="0.0000001" data-field="lat" value="${asset.lat}">
          <input type="number" step="0.0000001" data-field="lng" value="${asset.lng}">
        </div>
      </label>
      <div class="asset-ins-row-2">
        <label>Baujahr
          <input type="number" data-field="baujahr" value="${asset.baujahr ?? ''}" placeholder="—">
        </label>
        <label>Abrissjahr
          <input type="number" data-field="abrissjahr" value="${asset.abrissjahr ?? ''}" placeholder="—">
        </label>
      </div>
  `;

  if (propsSchema.length > 0) {
    html += `<div class="asset-ins-section-title">Eigenschaften</div>`;
    for (const p of propsSchema) {
      const val = asset.props[p.key] ?? '';
      html += `<label>${p.label}
        <input type="number" step="any" data-prop="${p.key}" value="${val}">
      </label>`;
    }
  }

  html += `
      <div style="font-size:10px;color:var(--muted);margin-top:8px;">
        ID: <code>${asset.id}</code>
        ${asset.buildingId ? `· Gebäude: ${asset.buildingId}` : ''}
        · Domain: ${asset.domain}
      </div>
      <button class="asset-ins-delete" data-action="delete">🗑 Löschen</button>
    </div>
  `;

  panel.innerHTML = html;

  // Event-Wiring
  panel.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('input', () => updateField(asset, inp.dataset.field, inp.value));
  });
  panel.querySelectorAll('[data-prop]').forEach(inp => {
    inp.addEventListener('input', () => {
      const v = inp.value === '' ? null : parseFloat(inp.value);
      asset.props[inp.dataset.prop] = v;
    });
  });
  panel.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', closeAssetInspector));
  panel.querySelectorAll('[data-action="delete"]').forEach(b => b.addEventListener('click', () => {
    if (confirm(`Asset "${asset.name}" wirklich löschen?`)) {
      deleteAsset(asset.id);
      closeAssetInspector();
    }
  }));
}

function updateField(asset, field, rawValue) {
  if (field === 'name') {
    asset.name = rawValue;
  } else if (field === 'lat' || field === 'lng') {
    const n = parseFloat(rawValue);
    if (!isNaN(n)) {
      asset[field] = n;
      drawAssetMarker(asset);
    }
  } else if (field === 'baujahr' || field === 'abrissjahr') {
    asset[field] = rawValue === '' ? null : parseInt(rawValue);
    drawAssetMarker(asset);
  }
}

function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Window-Bridge für 13b-assets-render.js
setTimeout(() => {
  window.openAssetInspector = openAssetInspector;
}, 0);
