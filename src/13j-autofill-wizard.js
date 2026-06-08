// ── 13j-autofill-wizard.js — Auto-Befüllen Wizard (Verbrauch + PV) ──────────
//
// Verbrauch: kW = Fläche [m²] × W/m² (aus SLP-Profil-Registry) / 1000
//            SLP-Profil per Gebäude wählbar — unabhängig von Wärme-Nutzungstypen
// PV:        kWp = Fläche × Dachanteil% × Wp/m² × Korrekturfaktor

import { getPvKorrFaktor, _pvWpM2Global } from './03c-gebaeude-io.js';
import { getAssetsForBuilding } from './13a-assets-core.js';
import { redrawAllAssets } from './13b-assets-render.js';
import { renderSidebarAssetList } from './13e-assets-inspector.js';
import {
  getElSlpProfiles, getElSlpById, getElSlpWpm2, getElSlpGruppen,
  ELSLP_WPM2, showElSlpModal
} from './13k-elslp-registry.js';

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt1(v) { return typeof v === 'number' ? v.toFixed(1) : '—'; }
function isManual(asset, key) { return asset?.props?.[key] !== undefined && asset?.props?.[key] !== null; }

const DACHFORM_LABELS = { flach:'Flachdach', sattel:'Satteldach', walm:'Walmdach', pult:'Pultdach' };
const DACHFORM_DEF_NEI = { flach:5, sattel:35, walm:30, pult:15 };

// ── Gebäudewerte berechnen ───────────────────────────────────────────────────
// cfg.slpAssignments[gId]   = slpId  (Profil-Zuordnung je Gebäude)
// cfg.slpWpm2Overrides[id]  = wpm2   (Session-Overrides für W/m²)
// cfg.pvDachanteil           = %
// cfg.pvWpM2                 = Wp/m²
function calcBuilding(g, cfg = {}) {
  const assets  = getAssetsForBuilding(g.id);
  const verbr   = assets.find(a => a.type === 'Verbraucher');
  const pv      = assets.find(a => a.type === 'PV');
  const hasArea = (g.flaeche || 0) > 0;

  // SLP-Profil: Wizard-Zuweisung → vorhandenes Asset-Profil → Default BW0
  const slpId = cfg.slpAssignments?.[g.id]
    ?? verbr?.props?.slpTyp
    ?? 'BW0';

  // Verbrauch: W/m² aus Registry (mit Session-Override)
  let kw = null;
  if (hasArea) {
    const fl   = parseFloat(g.flaeche) || 0;
    const wpm2 = cfg.slpWpm2Overrides?.[slpId]
              ?? ELSLP_WPM2[slpId]
              ?? getElSlpById(slpId)?.wpm2
              ?? 15;
    kw = Math.round(fl * wpm2 / 1000 * 10) / 10;
  }

  // PV: geometrische Schätzung
  let kwp = null, korrFak = null;
  if (hasArea) {
    const fl     = parseFloat(g.flaeche) || 0;
    const anteil = g.pvDachanteil ?? cfg.pvDachanteil ?? 30;
    const wpM2   = cfg.pvWpM2 ?? _pvWpM2Global();
    korrFak = getPvKorrFaktor(g);
    kwp = Math.round(fl * anteil / 100 * wpM2 / 1000 * korrFak * 10) / 10;
  }

  return {
    g, verbr, pv, hasArea, kw, slp: slpId, kwp, korrFak,
    verbrManual: verbr ? isManual(verbr, 'leistungKW')  : false,
    pvManual:    pv    ? isManual(pv,    'leistungKWp') : false,
  };
}

// ── kW für ein Gebäude live neu berechnen (nach Profil-/W/m²-Änderung) ──────
function recalcKw(g, slpId, cfg) {
  const fl  = parseFloat(g.flaeche) || 0;
  if (!fl) return null;
  const wpm2 = cfg.slpWpm2Overrides?.[slpId]
            ?? ELSLP_WPM2[slpId]
            ?? getElSlpById(slpId)?.wpm2
            ?? 15;
  return Math.round(fl * wpm2 / 1000 * 10) / 10;
}

// ── Schritt 1 — Auswahl ──────────────────────────────────────────────────────
function renderStep1(state) {
  const gebCount = (window.gebaeude || []).filter(g => g.polygon).length;
  return `
    <div class="aw-step-header">
      <span class="aw-step-label">Schritt 1 von 3</span>
      <span class="aw-step-title">✦ Elektro-Assets befüllen</span>
    </div>
    <div class="aw-body">
      <div class="aw-section-title">Was befüllen?</div>
      <label class="aw-check-row">
        <input type="checkbox" id="aw-calc-verbr" ${state.calcVerbrauch ? 'checked' : ''}>
        <div>
          <div>⚡ Verbraucher <span class="aw-hint">(leistungKW + BDEW-SLP-Profil)</span></div>
          <div class="aw-hint" style="margin-top:2px;">kW = Fläche [m²] × W/m² (je SLP-Profil konfigurierbar)</div>
        </div>
      </label>
      <label class="aw-check-row">
        <input type="checkbox" id="aw-calc-pv" ${state.calcPV ? 'checked' : ''}>
        <div>
          <div>☀ PV-Anlagen <span class="aw-hint">(leistungKWp)</span></div>
          <div class="aw-hint" style="margin-top:2px;">kWp = Fläche × Dachanteil% × Wp/m² × Korrekturfaktor</div>
        </div>
      </label>

      <div class="aw-section-title" style="margin-top:14px;">Welche Gebäude?</div>
      <label class="aw-radio-row">
        <input type="radio" name="aw-modus" value="empty" ${state.modus==='empty'?'checked':''}>
        <div>
          <div>Nur Assets ohne Wert <span class="aw-badge">Empfohlen</span></div>
          <div class="aw-hint">Bereits eingetragene Werte bleiben unverändert</div>
        </div>
      </label>
      <label class="aw-radio-row">
        <input type="radio" name="aw-modus" value="all" ${state.modus==='all'?'checked':''}>
        <div>
          <div>Alle Gebäude</div>
          <div class="aw-hint">Überschreibt auch bereits eingetragene Werte</div>
        </div>
      </label>

      <div class="aw-info-row">
        <span>Gebäude mit Polygon:</span><strong>${gebCount}</strong>
      </div>
    </div>
    <div class="aw-footer">
      <button class="ep-modal-btn" id="aw-cancel">Abbrechen</button>
      <button class="ep-modal-btn primary" id="aw-next1">Weiter →</button>
    </div>`;
}

// ── Info-Panel: SLP-Profile W/m² + PV-Parameter ──────────────────────────────
function renderInfoPanel(state) {
  const cfg   = state.cfg;
  const wpM2  = cfg.pvWpM2 ?? Math.round(_pvWpM2Global());
  const profs = getElSlpProfiles();

  const profRows = profs.map(p => {
    const sessOver = cfg.slpWpm2Overrides?.[p.id];
    const projOver = ELSLP_WPM2[p.id];
    const wpm2     = sessOver ?? projOver ?? p.wpm2;
    const changed  = wpm2 !== p.wpm2;
    return `<tr>
      <td><span class="aw-slp-tag">${esc(p.id)}</span></td>
      <td class="aw-nt-name">${esc(p.label)}</td>
      <td style="text-align:right;">
        <input class="aw-cfg-input aw-slp-wpm2-inp" type="number"
          data-slpid="${esc(p.id)}" value="${wpm2}" min="0.1" max="9999" step="0.5"
          style="width:60px;${changed?'border-color:#f9a825;':''}"
          title="${changed?'Geändert (Projektstandard: '+(projOver??p.wpm2)+' W/m²)':''}">
      </td>
      <td style="font-size:9px;color:var(--muted);padding-left:4px;">W/m²</td>
    </tr>`;
  }).join('');

  const verbrSection = state.calcVerbrauch ? `
    <div class="aw-info-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div class="aw-info-section-title">⚡ Verbrauch — SLP-Profile</div>
        <button class="aw-cfg-apply-btn" id="aw-manage-slp" style="font-size:9px;padding:2px 8px;">⚙ Profile verwalten</button>
      </div>
      <div class="aw-formula">kW = Fläche [m²] × W/m² ÷ 1000</div>
      <table class="aw-nt-table">
        <thead><tr>
          <th>SLP</th><th>Bezeichnung</th>
          <th style="text-align:right;">W/m²</th><th></th>
        </tr></thead>
        <tbody>${profRows}</tbody>
      </table>
      <div class="aw-info-footnote">Dauerhafte Änderungen über "Profile verwalten". Hier nur für diese Sitzung.</div>
    </div>` : '';

  const pvSection = state.calcPV ? `
    <div class="aw-info-section">
      <div class="aw-info-section-title">☀ PV-Leistung</div>
      <div class="aw-formula">kWp = Fläche × Dachanteil% × Wp/m² ÷ 1000 × <strong>Faktor</strong></div>
      <div class="aw-faktor-erklaerung">
        <div class="aw-faktor-title">Was ist der Faktor?</div>
        <div class="aw-faktor-body">
          Der <strong>Ertragskorrekturfaktor</strong> gibt an, wie viel % des theoretischen Maximals
          (Süd-Ausrichtung, 30° Neigung = 100%) ein Dach tatsächlich liefert.
          Er setzt sich zusammen aus:
        </div>
        <div class="aw-faktor-grid">
          <div class="aw-faktor-row"><span class="aw-faktor-val" style="color:#4caf50;">100%</span><span>Flachdach (aufgeständert Süd 30°) oder Süddach 30°</span></div>
          <div class="aw-faktor-row"><span class="aw-faktor-val" style="color:#4caf50;">~97%</span><span>Süddach 35° · Satteldach Süd (typisch)</span></div>
          <div class="aw-faktor-row"><span class="aw-faktor-val" style="color:#f9a825;">~84%</span><span>Ost- oder Westdach 35°</span></div>
          <div class="aw-faktor-row"><span class="aw-faktor-val" style="color:#e53935;">~58%</span><span>Norddach 35° (unwirtschaftlich)</span></div>
        </div>
        <div class="aw-faktor-hint">Dachform, Neigung &amp; Ausrichtung pro Gebäude über ▾ anpassen.</div>
      </div>
      <div class="aw-cfg-grid" style="margin-top:8px;">
        <label class="aw-cfg-label">PV-Dachanteil Standard</label>
        <div class="aw-cfg-val">
          <input class="aw-cfg-input" type="number" id="aw-cfg-dachanteil"
            value="${cfg.pvDachanteil ?? 30}" min="1" max="100" step="1">
          <span class="aw-cfg-unit">%</span>
          <span class="aw-cfg-hint">(pro Gebäude via ▾ anpassbar)</span>
        </div>
        <label class="aw-cfg-label">Modulleistung</label>
        <div class="aw-cfg-val">
          <input class="aw-cfg-input" type="number" id="aw-cfg-wpm2"
            value="${wpM2}" min="50" max="500" step="5">
          <span class="aw-cfg-unit">Wp/m²</span>
          <span class="aw-cfg-hint">(Standard ~240 Wp/m²)</span>
        </div>
      </div>
    </div>` : '';

  return `
    <div class="aw-info-panel" id="aw-info-panel">
      <div class="aw-info-hdr" id="aw-info-toggle">
        <span class="aw-info-chevron${state.infoOpen ? ' open' : ''}" id="aw-info-chevron">▶</span>
        <span>Berechnungsparameter</span>
        <span class="aw-info-hdr-hint">— konfigurierbar</span>
      </div>
      <div class="aw-info-body" id="aw-info-body"${state.infoOpen ? '' : ' style="display:none;"'}>
        ${verbrSection}
        ${pvSection}
        <div style="padding-top:6px;">
          <button class="aw-cfg-apply-btn" id="aw-cfg-apply">↻ Tabellenwerte neu berechnen</button>
        </div>
      </div>
    </div>`;
}

// ── Tabellenzeilen ────────────────────────────────────────────────────────────
function renderTableRows(state) {
  const buildings = (window.gebaeude || []).filter(g => g.polygon);
  const profs     = getElSlpProfiles();
  const gruppen   = getElSlpGruppen();
  const showV = state.calcVerbrauch, showP = state.calcPV;
  // totalCols: Gebäude + V(2) + P(3) + Status = varies
  const colCount = 1 + (showV ? 2 : 0) + (showP ? 3 : 0) + 1;

  const statusBadge = (st, label) => {
    if (st === 'no_asset') return `<span class="aw-badge-warn">⚠ Kein Asset</span>`;
    if (st === 'no_area')  return `<span class="aw-badge-warn">⚠ Keine Fläche</span>`;
    if (st === 'manual')   return `<span class="aw-badge-muted">🔒 Gesetzt</span>`;
    return `<span class="aw-badge-ok">${label}</span>`;
  };

  return buildings.map(g => {
    const c = calcBuilding(g, state.cfg);

    let statusV = 'apply';
    if (showV && !c.verbr)                         statusV = 'no_asset';
    else if (state.modus === 'empty' && c.verbrManual) statusV = 'manual';

    let statusP = 'apply';
    if (showP && !c.pv)                            statusP = 'no_asset';
    else if (!c.hasArea)                           statusP = 'no_area';
    else if (state.modus === 'empty' && c.pvManual) statusP = 'manual';

    const skipV = statusV !== 'apply';
    const skipP = statusP !== 'apply';

    const ov     = state.overrides[g.id] || {};
    const kwVal  = ov.kw  !== undefined ? ov.kw  : c.kw;
    const kwpVal = ov.kwp !== undefined ? ov.kwp : c.kwp;
    const slpVal = c.slp;

    const fakPct = c.korrFak != null ? Math.round(c.korrFak * 100) : null;
    const fakCol = fakPct == null ? '' : fakPct >= 90 ? '#4caf50' : fakPct >= 75 ? '#f9a825' : '#e53935';

    const isExpanded = state.expandedRows?.has(g.id);

    // SLP dropdown
    const slpCell = skipV
      ? `<span class="aw-skip-val">${esc(slpVal)}</span>`
      : `<select class="aw-slp-select" data-gid="${g.id}" data-field="slp" style="max-width:130px;">
           ${gruppen.map(gr => {
             const opts = profs.filter(p => p.gruppe === gr).map(p =>
               `<option value="${esc(p.id)}"${p.id === slpVal ? ' selected' : ''}>${esc(p.id)} — ${esc(p.label)}</option>`
             ).join('');
             return `<optgroup label="${esc(gr)}">${opts}</optgroup>`;
           }).join('')}
         </select>`;

    // Status cell
    let statusCell;
    if (showV && showP && statusV !== statusP) {
      statusCell = statusBadge(statusV, '⚡') + ' ' + statusBadge(statusP, '☀');
    } else {
      statusCell = statusBadge(showV ? statusV : statusP, '→ Befüllen');
    }

    // ── PV-Dach expand sub-row ──
    const dachform = g.dachform || 'sattel';
    const defNei   = DACHFORM_DEF_NEI[dachform] ?? 35;
    const expandRow = (isExpanded && showP) ? `
      <tr class="aw-dach-subrow">
        <td colspan="${colCount}" style="padding:0;">
          <div class="aw-dach-subrow-inner">
            <div class="aw-dach-subrow-label">☀ Dach-Parameter: <strong>${esc(g.name)}</strong></div>
            <div class="aw-dach-subrow-grid">
              <label>Dachform</label>
              <select class="aw-cfg-input aw-dach-inp" data-gid="${g.id}" data-dachfield="dachform">
                ${Object.entries(DACHFORM_LABELS).map(([v,l]) =>
                  `<option value="${v}"${dachform===v?' selected':''}>${l}</option>`
                ).join('')}
              </select>
              <label>Neigung (°)</label>
              <input class="aw-cfg-input aw-dach-inp" type="number" min="0" max="75"
                data-gid="${g.id}" data-dachfield="dachNeigung"
                value="${g.dachNeigung ?? ''}" placeholder="${defNei}">
              <label title="0°=Nord · 90°=Ost · 180°=Süd · 270°=West">Ausrichtung (°) ℹ</label>
              <input class="aw-cfg-input aw-dach-inp" type="number" min="0" max="359"
                data-gid="${g.id}" data-dachfield="dachAzimut"
                value="${g.dachAzimut ?? ''}" placeholder="180 (Süd)">
              <label>Dachanteil (%)</label>
              <input class="aw-cfg-input aw-dach-inp" type="number" min="1" max="100"
                data-gid="${g.id}" data-dachfield="pvDachanteil"
                value="${g.pvDachanteil ?? 30}">
            </div>
            ${c.korrFak != null ? `
              <div class="aw-dach-subrow-result">
                Faktor: <strong style="color:${fakCol}">${fakPct}%</strong>
                &nbsp;→&nbsp; <strong style="color:${fakCol}">${fmt1(c.kwp)} kWp</strong>
              </div>` : ''}
          </div>
        </td>
      </tr>` : '';

    return `<tr data-gid="${g.id}" class="${isExpanded ? 'aw-row-expanded' : ''}">
      <td class="aw-col-name" title="${esc(g.name)}">${esc(g.name)}</td>
      ${showV ? `
        <td class="aw-col-verbr">${slpCell}</td>
        <td class="aw-col-verbr" style="text-align:right;">${skipV
          ? `<span class="aw-skip-val">${fmt1(c.kw)}</span>`
          : `<input class="aw-inline-input" type="number" step="0.1"
               value="${kwVal ?? ''}" placeholder="—"
               data-gid="${g.id}" data-field="kw">`}
        </td>
      ` : ''}
      ${showP ? `
        <td class="aw-col-pv" style="text-align:right;">${skipP
          ? `<span class="aw-skip-val">${fmt1(c.kwp)}</span>`
          : `<input class="aw-inline-input" type="number" step="0.1"
               value="${kwpVal ?? ''}" placeholder="—"
               data-gid="${g.id}" data-field="kwp">`}
        </td>
        <td class="aw-col-pv" style="text-align:center;">
          ${fakPct != null && !skipP
            ? `<span style="color:${fakCol};font-size:10px;font-weight:600;">${fakPct}%</span>`
            : '<span style="color:var(--muted)">—</span>'}
        </td>
        <td class="aw-col-pv" style="text-align:center;padding:0 2px;">
          <button class="aw-expand-btn${isExpanded ? ' open' : ''}"
            data-expand-gid="${g.id}"
            title="${isExpanded ? 'Dach-Parameter ausblenden' : 'Dach-Parameter bearbeiten'}">
            ${isExpanded ? '▲' : '▾'}
          </button>
        </td>
      ` : ''}
      <td class="aw-status-cell">${statusCell}</td>
    </tr>${expandRow}`;
  }).join('');
}

// ── Schritt 2 — Vorschau-Tabelle ─────────────────────────────────────────────
function renderStep2(state) {
  const buildings = (window.gebaeude || []).filter(g => g.polygon);

  const applyCount = buildings.filter(g => {
    const c = calcBuilding(g, state.cfg);
    const vOk = !state.calcVerbrauch || (c.verbr && (state.modus === 'all' || !c.verbrManual));
    const pOk = !state.calcPV        || (c.pv && c.hasArea && (state.modus === 'all' || !c.pvManual));
    return vOk || pOk;
  }).length;

  const lockedCount = buildings.filter(g => {
    const c = calcBuilding(g, state.cfg);
    return state.modus === 'empty' && (c.verbrManual || c.pvManual);
  }).length;

  const lockedHint = lockedCount > 0 && state.modus === 'empty'
    ? ` · <span class="aw-locked-hint">🔒 ${lockedCount} gesperrt — <button class="aw-link-btn" id="aw-switch-all">Alle bearbeiten</button></span>`
    : '';

  const showV = state.calcVerbrauch, showP = state.calcPV;

  // Two-row group header when both sections active, single row otherwise
  const faktorTitle = 'Ertragskorrekturfaktor = Azimutfaktor × Neigungsfaktor. 100% = Süd 30° (optimal). Klick auf ▾ zum Bearbeiten der Dachparameter.';
  const theadHtml = (showV && showP) ? `
    <tr class="aw-thead-group">
      <th rowspan="2" class="aw-th-gebaeude">Gebäude</th>
      <th colspan="2" class="aw-th-grp aw-th-grp-verbr">⚡ Verbraucher</th>
      <th colspan="3" class="aw-th-grp aw-th-grp-pv">☀ PV</th>
      <th rowspan="2" class="aw-th-status">Status</th>
    </tr>
    <tr>
      <th class="aw-col-verbr">SLP-Profil</th>
      <th class="aw-col-verbr" style="text-align:right;">kW</th>
      <th class="aw-col-pv" style="text-align:right;">kWp</th>
      <th class="aw-col-pv" style="text-align:center;" title="${faktorTitle}">Faktor <span style="opacity:.5;cursor:help;">ℹ</span></th>
      <th class="aw-col-pv" style="width:22px;"></th>
    </tr>` : `
    <tr>
      <th>Gebäude</th>
      ${showV ? '<th class="aw-col-verbr">SLP-Profil</th><th class="aw-col-verbr" style="text-align:right;">kW</th>' : ''}
      ${showP ? `<th class="aw-col-pv" style="text-align:right;">kWp</th><th class="aw-col-pv" style="text-align:center;" title="${faktorTitle}">Faktor <span style="opacity:.5;cursor:help;">ℹ</span></th><th class="aw-col-pv" style="width:22px;"></th>` : ''}
      <th>Status</th>
    </tr>`;

  return `
    <div class="aw-step-header">
      <span class="aw-step-label">Schritt 2 von 3</span>
      <span class="aw-step-title">✦ Vorschau &amp; Anpassen</span>
    </div>
    ${renderInfoPanel(state)}
    <div class="aw-body aw-body-table">
      <table class="aw-table">
        <colgroup>
          <col style="min-width:90px;">
          ${showV ? '<col style="width:145px;"><col style="width:72px;">' : ''}
          ${showP ? '<col style="width:72px;"><col style="width:54px;"><col style="width:22px;">' : ''}
          <col style="width:86px;">
        </colgroup>
        <thead>${theadHtml}</thead>
        <tbody id="aw-table-body">${renderTableRows(state)}</tbody>
      </table>
    </div>
    <div class="aw-footer">
      <button class="ep-modal-btn" id="aw-back2">← Zurück</button>
      <span class="aw-count-hint">${applyCount} Assets werden befüllt${lockedHint}</span>
      <button class="ep-modal-btn primary" id="aw-apply">Anwenden ✓</button>
    </div>`;
}

// ── Schritt 3 — Ergebnis ─────────────────────────────────────────────────────
function applyAndRenderStep3(state) {
  const buildings = (window.gebaeude || []).filter(g => g.polygon);
  let cntV = 0, cntP = 0, cntSkip = 0, cntNoAsset = 0;

  buildings.forEach(g => {
    const c  = calcBuilding(g, state.cfg);
    const ov = state.overrides[g.id] || {};

    if (state.calcVerbrauch) {
      if (!c.verbr) { cntNoAsset++; }
      else if (state.modus === 'empty' && c.verbrManual) { cntSkip++; }
      else {
        const kw  = ov.kw  !== undefined ? parseFloat(ov.kw) : c.kw;
        const slp = ov.slp !== undefined ? ov.slp : c.slp;
        if (kw  != null && !isNaN(kw)) c.verbr.props.leistungKW = kw;
        if (slp)                       c.verbr.props.slpTyp     = slp;
        cntV++;
      }
    }

    if (state.calcPV) {
      if (!c.pv || !c.hasArea) { cntNoAsset++; }
      else if (state.modus === 'empty' && c.pvManual) { cntSkip++; }
      else {
        const kwp = ov.kwp !== undefined ? parseFloat(ov.kwp) : c.kwp;
        if (kwp != null && !isNaN(kwp)) c.pv.props.leistungKWp = kwp;
        cntP++;
      }
    }
  });

  redrawAllAssets();
  renderSidebarAssetList();

  const row = (icon, col, text) =>
    `<div class="aw-result-row"><span style="color:${col};font-size:14px;">${icon}</span><span>${text}</span></div>`;

  return `
    <div class="aw-step-header">
      <span class="aw-step-label">Schritt 3 von 3</span>
      <span class="aw-step-title">✦ Fertig</span>
    </div>
    <div class="aw-body">
      ${state.calcVerbrauch ? row('✓','#4caf50', `${cntV} Verbraucher-Assets aktualisiert`) : ''}
      ${state.calcPV        ? row('✓','#4caf50', `${cntP} PV-Assets aktualisiert`) : ''}
      ${cntSkip    > 0 ? row('—','var(--muted)', `${cntSkip} übersprungen (bereits gesetzt)`) : ''}
      ${cntNoAsset > 0 ? row('⚠','#f9a825', `${cntNoAsset} ohne passendes Asset`) : ''}
    </div>
    <div class="aw-footer">
      <button class="ep-modal-btn primary" id="aw-done">Fertig</button>
    </div>`;
}

// ── Haupt-Einstiegspunkt ─────────────────────────────────────────────────────
export function showAutofillWizard() {
  document.getElementById('autofill-wizard-modal')?.remove();

  const state = {
    calcVerbrauch: true,
    calcPV: true,
    modus: 'empty',
    overrides: {},
    expandedRows: new Set(),
    cfg: {
      pvDachanteil: 30,
      pvWpM2: null,
      slpAssignments: {},   // gId → slpId (Wizard-Session)
      slpWpm2Overrides: {}, // slpId → wpm2 (Wizard-Session, temporär)
    },
    infoOpen: false,
  };

  const overlay = document.createElement('div');
  overlay.id        = 'autofill-wizard-modal';
  overlay.className = 'ep-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'ep-modal aw-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  function goStep1() {
    modal.innerHTML = renderStep1(state);
    modal.querySelector('#aw-cancel').onclick = () => overlay.remove();
    modal.querySelector('#aw-next1').onclick  = () => {
      state.calcVerbrauch = modal.querySelector('#aw-calc-verbr').checked;
      state.calcPV        = modal.querySelector('#aw-calc-pv').checked;
      state.modus         = modal.querySelector('input[name="aw-modus"]:checked')?.value || 'empty';
      if (!state.calcVerbrauch && !state.calcPV) { alert('Bitte mindestens eine Option auswählen.'); return; }
      goStep2();
    };
  }

  function goStep2() {
    modal.innerHTML = renderStep2(state);
    modal.querySelector('#aw-back2').onclick = goStep1;

    modal.querySelector('#aw-switch-all')?.addEventListener('click', () => {
      state.modus = 'all'; goStep2();
    });

    // Info-Panel Toggle
    modal.querySelector('#aw-info-toggle')?.addEventListener('click', () => {
      state.infoOpen = !state.infoOpen;
      const body    = modal.querySelector('#aw-info-body');
      const chevron = modal.querySelector('#aw-info-chevron');
      if (body)    body.style.display = state.infoOpen ? 'block' : 'none';
      if (chevron) { chevron.textContent = state.infoOpen ? '▼' : '▶'; chevron.classList.toggle('open', state.infoOpen); }
    });

    // "Profile verwalten" → Modal öffnen, danach Schritt 2 neu rendern
    modal.querySelector('#aw-manage-slp')?.addEventListener('click', () => {
      showElSlpModal(() => goStep2());
    });

    // Neuberechnung: W/m²-Overrides + PV-Params einlesen
    modal.querySelector('#aw-cfg-apply')?.addEventListener('click', () => {
      modal.querySelectorAll('.aw-slp-wpm2-inp').forEach(inp => {
        const val = parseFloat(inp.value);
        if (!isNaN(val)) state.cfg.slpWpm2Overrides[inp.dataset.slpid] = val;
      });
      const da   = parseFloat(modal.querySelector('#aw-cfg-dachanteil')?.value);
      const wpm2 = parseFloat(modal.querySelector('#aw-cfg-wpm2')?.value);
      if (!isNaN(da))   state.cfg.pvDachanteil = da;
      if (!isNaN(wpm2)) state.cfg.pvWpM2       = wpm2;

      const tbody = modal.querySelector('#aw-table-body');
      if (tbody) { tbody.innerHTML = renderTableRows(state); wireTableInputs(); }
    });

    wireTableInputs();

    modal.querySelector('#aw-apply').onclick = () => {
      modal.querySelectorAll('.aw-inline-input').forEach(inp => {
        const gid = parseInt(inp.dataset.gid), field = inp.dataset.field;
        if (!state.overrides[gid]) state.overrides[gid] = {};
        state.overrides[gid][field] = inp.value === '' ? undefined : parseFloat(inp.value);
      });
      modal.querySelectorAll('.aw-slp-select').forEach(sel => {
        const gid = parseInt(sel.dataset.gid);
        if (!state.overrides[gid]) state.overrides[gid] = {};
        state.overrides[gid].slp = sel.value || undefined;
        state.cfg.slpAssignments[gid] = sel.value;
      });
      modal.innerHTML = applyAndRenderStep3(state);
      modal.querySelector('#aw-done').onclick = () => overlay.remove();
    };
  }

  function wireTableInputs() {
    // kW / kWp — manuelle Inputs
    modal.querySelectorAll('.aw-inline-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const gid = parseInt(inp.dataset.gid), field = inp.dataset.field;
        if (!state.overrides[gid]) state.overrides[gid] = {};
        state.overrides[gid][field] = inp.value === '' ? undefined : parseFloat(inp.value);
      });
    });

    // SLP-Dropdown → kW live aktualisieren
    modal.querySelectorAll('.aw-slp-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const gid   = parseInt(sel.dataset.gid);
        const slpId = sel.value;
        state.cfg.slpAssignments[gid] = slpId;
        if (!state.overrides[gid]) state.overrides[gid] = {};
        state.overrides[gid].slp = slpId;
        const g = (window.gebaeude || []).find(g => g.id === gid);
        if (g) {
          const kw = recalcKw(g, slpId, state.cfg);
          const kwInp = sel.closest('tr')?.querySelector('.aw-inline-input[data-field="kw"]');
          if (kwInp && kw != null) {
            kwInp.value = kw;
            state.overrides[gid].kw = kw;
          }
        }
      });
    });

    // Expand-Buttons — Dach-Parameter ein-/ausblenden
    modal.querySelectorAll('.aw-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const gid = parseInt(btn.dataset.expandGid);
        if (state.expandedRows.has(gid)) state.expandedRows.delete(gid);
        else                             state.expandedRows.add(gid);
        const tbody = modal.querySelector('#aw-table-body');
        if (tbody) { tbody.innerHTML = renderTableRows(state); wireTableInputs(); }
      });
    });

    // Dach-Parameter-Inputs in Expand-Zeilen → Gebäude direkt aktualisieren
    modal.querySelectorAll('.aw-dach-inp').forEach(inp => {
      inp.addEventListener('change', () => {
        const gid   = parseInt(inp.dataset.gid);
        const field = inp.dataset.dachfield;
        const g = (window.gebaeude || []).find(g => g.id === gid);
        if (!g) return;
        if (inp.tagName === 'SELECT') {
          g[field] = inp.value;
        } else {
          g[field] = inp.value === '' ? null : parseFloat(inp.value);
          if (field === 'pvDachanteil' && g[field] == null) g[field] = 30;
        }
        // kWp für diese Zeile neu berechnen
        const tbody = modal.querySelector('#aw-table-body');
        if (tbody) { tbody.innerHTML = renderTableRows(state); wireTableInputs(); }
      });
    });
  }

  goStep1();
}

// Window-Bridge
setTimeout(() => { window.showAutofillWizard = showAutofillWizard; }, 0);
