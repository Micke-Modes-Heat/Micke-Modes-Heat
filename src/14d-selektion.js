// ── 14d-selektion.js — Asset-Selektion + Elektro-Bulk-Bar ────────────────────
// M5: assetSelection-State; Shift+Click + Box-Selektion auf Karte;
//     Checkboxen in Sidebar; schwebende Bulk-Bar mit Sammelaktionen.

import { ASSETS } from './13a-assets-core.js';
import { phasen, massnahmeJahr } from './01-globals-varianten.js';
import { MASSN_VORLAGEN, MASSN_VORLAGEN_REIHENFOLGE } from './config/massnahmen-vorlagen.js';
import { redrawAllAssets } from './13b-assets-render.js';

// ── Selektions-State ──────────────────────────────────────────────────────────

export let assetSelection = new Set();

export function selToggle(id) {
  if (assetSelection.has(id)) assetSelection.delete(id);
  else assetSelection.add(id);
  _afterSelChange();
}

export function selAdd(id) {
  assetSelection.add(id);
  _afterSelChange();
}

export function selRemove(id) {
  assetSelection.delete(id);
  _afterSelChange();
}

export function selSet(ids) {
  assetSelection = new Set(ids);
  _afterSelChange();
}

export function selClear() {
  assetSelection = new Set();
  _afterSelChange();
}

export function selHas(id) {
  return assetSelection.has(id);
}

export function selGetAssets() {
  return ASSETS.items.filter(a => assetSelection.has(a.id));
}

// Aus Merit-Order-Ergebnis füllen (window._lastMeritOrderResult, gesetzt von pvRunMeritOrder)
export function selFromMeritOrderTier(tier) {
  const result = window._lastMeritOrderResult;
  if (!result?.ranking) {
    console.warn('selFromMeritOrderTier: kein Merit-Order-Ergebnis (pvRunMeritOrder() zuerst aufrufen)');
    return;
  }
  const ids = result.ranking
    .filter(r => r.tier === tier && r.kandidat?.refId)
    .map(r => r.kandidat.refId);
  selSet(ids);
}

// ── Interner After-Change-Handler ─────────────────────────────────────────────

function _afterSelChange() {
  _refreshSelectedRings();
  selRenderBulkBar();
  // Sidebar-Liste refreshen (leichtgewichtig: nur Checkbox-State)
  _refreshSidebarCheckboxes();
}

// ── Marker-Ring-Update (ohne vollen Redraw) ───────────────────────────────────

function _applyRing(asset) {
  const el = asset._marker?._icon?.querySelector('.asset-marker');
  if (!el) return;
  if (assetSelection.has(asset.id)) el.classList.add('asset-selected');
  else el.classList.remove('asset-selected');
}

function _refreshSelectedRings() {
  for (const a of ASSETS.items) _applyRing(a);
}

export function selRefreshMarkerRing(asset) {
  _applyRing(asset);
}

// ── Sidebar-Checkboxen refresh (kein Re-Render der ganzen Liste) ──────────────

function _refreshSidebarCheckboxes() {
  const container = document.getElementById('sb-asset-list');
  if (!container) return;
  container.querySelectorAll('.sb-asset-cb').forEach(cb => {
    const id = cb.closest('[data-asset-id]')?.dataset.assetId;
    if (id) cb.checked = assetSelection.has(id);
  });
}

// ── Bulk-Bar ──────────────────────────────────────────────────────────────────

export function selRenderBulkBar() {
  const bar = document.getElementById('asset-bulk-bar');
  if (!bar) return;

  const selAssets = selGetAssets();
  const count     = selAssets.length;

  if (count === 0) {
    bar.style.display = 'none';
    return;
  }

  const totalKwp = selAssets.reduce((s, a) => {
    const kWp = parseFloat(a.props?.leistungKWp) || parseFloat(a.pvKwpCalc) || 0;
    return s + kWp;
  }, 0);
  const kwpLabel = totalKwp > 0
    ? ` · Σ ${totalKwp < 1000 ? totalKwp.toFixed(0) + ' kWp' : (totalKwp / 1000).toFixed(1) + ' MWp'}`
    : '';

  document.getElementById('asset-bulk-lbl').textContent = `${count} Asset${count > 1 ? 's' : ''}${kwpLabel}`;

  // Phasen-Dropdown befüllen
  const phSel = document.getElementById('asset-bulk-phase');
  if (phSel) {
    const curVal = phSel.value;
    phSel.innerHTML = '<option value="">— Phase —</option>'
      + phasen.map(p => `<option value="${p.id}">${p.name} (${p.jahrVon})</option>`).join('');
    if (curVal) phSel.value = curVal;
  }

  // Maßnahmen-Dropdown befüllen (einmalig beim ersten Render)
  const maSel = document.getElementById('asset-bulk-massn');
  if (maSel && !maSel._filled) {
    maSel._filled = true;
    maSel.innerHTML = '<option value="">— Maßnahme —</option>'
      + MASSN_VORLAGEN_REIHENFOLGE.map(k =>
          `<option value="${k}">${MASSN_VORLAGEN[k].icon} ${MASSN_VORLAGEN[k].label}</option>`
        ).join('');
  }

  bar.style.display = 'flex';
}

// ── Sammelaktionen ────────────────────────────────────────────────────────────

/**
 * Weist jedem selektierten Asset eine Phase zu.
 * Sucht eine vorhandene Bau-Maßnahme oder legt eine neue an.
 */
export function selApplyPhase(phaseId) {
  if (!phaseId) return;
  for (const a of selGetAssets()) {
    if (!a.massnahmen) a.massnahmen = [];
    let bau = a.massnahmen.find(m => m.typ === 'Bau');
    if (bau) {
      bau.phaseId = phaseId;
      bau.jahr    = null; // Phase überschreibt explizites Jahr
    } else {
      a.massnahmen.push({
        id:        'bau_' + a.id + '_' + Date.now(),
        typ:       'Bau',
        titel:     'PV-Anlage',
        kosten:    0,
        status:    'geplant',
        phaseId,
        jahr:      null,
        dependsOn: [],
        newProps:  {},
      });
    }
  }
  _bulkDone('Phase zugewiesen');
}

/**
 * Legt je selektiertem Asset eine neue Maßnahme aus der Vorlage an.
 */
export function selApplyMassnahmeVorlage(typKey) {
  if (!typKey || !MASSN_VORLAGEN[typKey]) return;
  const vorl = MASSN_VORLAGEN[typKey];
  for (const a of selGetAssets()) {
    if (!a.massnahmen) a.massnahmen = [];
    a.massnahmen.push({
      id:        typKey + '_' + a.id + '_' + Date.now(),
      typ:       typKey,
      titel:     vorl.label,
      kosten:    vorl.kostenRichtwert || 0,
      status:    'geplant',
      phaseId:   null,
      jahr:      null,
      dependsOn: [],
      newProps:  {},
    });
  }
  _bulkDone('Maßnahmen angelegt');
}

/**
 * Setzt den Status der zuletzt angelegten Maßnahme jedes selektierten Assets.
 */
export function selApplyStatus(status) {
  if (!status) return;
  for (const a of selGetAssets()) {
    const ms = a.massnahmen || [];
    if (ms.length === 0) continue;
    ms[ms.length - 1].status = status;
  }
  _bulkDone('Status gesetzt');
}

/**
 * Setzt ein explizites Jahr auf alle selektierten Assets' neueste Maßnahme.
 */
export function selApplyJahr(jahr) {
  const y = parseInt(jahr);
  if (!y || isNaN(y)) return;
  for (const a of selGetAssets()) {
    const ms = a.massnahmen || [];
    if (ms.length === 0) continue;
    ms[ms.length - 1].jahr = y;
    ms[ms.length - 1].phaseId = null;
  }
  _bulkDone('Jahr gesetzt');
}

function _bulkDone(msg) {
  // Reset Dropdown-Werte nach Aktion
  const phSel = document.getElementById('asset-bulk-phase');
  const maSel = document.getElementById('asset-bulk-massn');
  if (phSel) phSel.value = '';
  if (maSel) maSel.value = '';
  // Sidebar-Liste refreshen
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  console.info('[Bulk]', msg, '—', assetSelection.size, 'Assets');
}

// ── Handler für die Bulk-Bar-Dropdowns (aufgerufen aus HTML) ──────────────────

export function selBulkPhaseChanged(phaseId) {
  if (phaseId) selApplyPhase(phaseId);
}

export function selBulkMassnChanged(typKey) {
  if (typKey) selApplyMassnahmeVorlage(typKey);
}

export function selBulkStatusChanged(status) {
  if (status) selApplyStatus(status);
}

export function selBulkJahrApply() {
  const inp = document.getElementById('asset-bulk-jahr');
  if (inp) selApplyJahr(inp.value);
}

// ── Box-Selektion auf Karte (Shift+Drag) ─────────────────────────────────────

export function selInitBoxSelect() {
  const m = window._appLeafletMap;
  if (!m || m._selBoxInited) return;
  m._selBoxInited = true;

  let startLl = null, rect = null, active = false;

  L.DomEvent.on(m.getContainer(), 'mousedown', e => {
    if (!e.shiftKey || e.button !== 0) return;
    active   = true;
    startLl  = m.mouseEventToLatLng(e);
    m.dragging.disable();
    L.DomEvent.preventDefault(e);
  });

  L.DomEvent.on(m.getContainer(), 'mousemove', e => {
    if (!active || !startLl) return;
    const curLl = m.mouseEventToLatLng(e);
    const bounds = L.latLngBounds(startLl, curLl);
    if (!rect) {
      rect = L.rectangle(bounds, {
        color: '#2196F3', weight: 1.5, fillOpacity: 0.07, interactive: false,
      }).addTo(m);
    } else {
      rect.setBounds(bounds);
    }
  });

  L.DomEvent.on(m.getContainer(), 'mouseup', e => {
    if (!active) return;
    active = false;
    m.dragging.enable();
    if (rect) {
      const bounds = rect.getBounds();
      rect.remove(); rect = null;
      const ids = ASSETS.items
        .filter(a => a.lat != null && a.lng != null && bounds.contains([a.lat, a.lng]))
        .map(a => a.id);
      if (ids.length > 0) {
        for (const id of ids) assetSelection.add(id);
        _afterSelChange();
      }
    }
    startLl = null;
  });
}
