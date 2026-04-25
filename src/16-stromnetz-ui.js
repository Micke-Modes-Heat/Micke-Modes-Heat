// ── 16-stromnetz-ui.js — Mini-UI-Bridge für die neuen Stromnetz-Module ──────
// Convenience-Funktionen, die ohne den alten 05b-stromnetz.js anzufassen
// die neuen Module (3.2c Recalc, 3.4 Maßnahmen, 3.4b Invest, 3.5 SLD)
// als Overlay-Panels aufrufen.
//
// Wird von Buttons im Strom-Sub-Tab via data-click gerufen (siehe index.html).
// ESC schließt jedes Overlay.

import { recalcStromnetz } from './15c-stromnetz-calc.js';
import { buildSldSvg } from './15d-stromnetz-sld.js';
import { buildMassnahmenplan } from './15g-stromnetz-massnahmen.js';
import { buildInvestOverviewHtml } from './15h-stromnetz-invest.js';
import { STROMNETZ } from './14b-stromnetz-state.js';
import { heatmapToggle, isHeatmapActive, heatmapSetMode } from './15j-stromnetz-heatmap.js';
import { runTrafoOptimierung, clearTrafoOptimierung } from './15l-stromnetz-trafoopt.js';

// ── Generischer Overlay-Container ───────────────────────────────────────────
function showOverlay(id, title, contentHtml, opts = {}) {
  closeOverlay(id);
  const w = opts.width  || '700px';
  const h = opts.height || '600px';
  const top   = opts.top   || '70px';
  const left  = opts.left  || 'auto';
  const right = opts.right || '20px';
  const accent = opts.accent || '#4fc3f7';

  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = `position:fixed;top:${top};left:${left};right:${right};
    width:${w};height:${h};background:#0f1b2d;color:#cfd;
    border:2px solid ${accent};border-radius:8px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);
    z-index:9999;display:flex;flex-direction:column;
    font-family:'DM Sans',sans-serif;`;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:#0b0e18;border-bottom:1px solid ${accent}55;border-radius:6px 6px 0 0;">
      <div style="font-size:13px;font-weight:600;color:${accent};">${title}</div>
      <button data-close="${id}" style="background:transparent;border:1px solid #555;
              border-radius:4px;color:#aaa;cursor:pointer;font-size:13px;padding:2px 9px;">✕</button>
    </div>
    <div style="flex:1;overflow:auto;padding:12px;">${contentHtml}</div>`;
  document.body.appendChild(el);
  el.querySelector(`[data-close="${id}"]`).addEventListener('click', () => closeOverlay(id));
  return el;
}

function closeOverlay(id) {
  const old = document.getElementById(id);
  if (old) old.remove();
}

// ESC schließt alle Test-Overlays
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['stromnetz-recalc-panel', 'stromnetz-sld-panel',
   'stromnetz-massnahmen-panel', 'stromnetz-invest-panel'].forEach(closeOverlay);
});

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC API (über window via main.js verfügbar)
// ════════════════════════════════════════════════════════════════════════════

// ── Recalc ausführen + Summary anzeigen ─────────────────────────────────────
export function uiRecalcStromnetz() {
  const result = recalcStromnetz();
  const s = result?.summary || {};
  const warns = (result?.warnings || []).slice(0, 12);
  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:12px;line-height:1.6;">
      <div><span style="color:#7a8099;">Aktive Assets:</span> <b>${s.assets ?? '–'}</b></div>
      <div><span style="color:#7a8099;">Aktive Leitungen:</span> <b>${s.leitungen ?? '–'}</b></div>
      <div><span style="color:#7a8099;">Gesamtlast:</span> <b>${s.P_load_kW ?? '–'} kW</b></div>
      <div><span style="color:#7a8099;">Einspeisung:</span> <b>${s.P_gen_kW ?? '–'} kW</b></div>
      <div><span style="color:#7a8099;">Netto:</span> <b>${s.P_total_kW ?? '–'} kW</b></div>
      <div><span style="color:#7a8099;">Kabellänge:</span> <b>${s.laengeM ?? '–'} m</b></div>
      <div><span style="color:#7a8099;">Kosten:</span> <b>${s.kosten ?? '–'} €</b></div>
      <div><span style="color:#7a8099;">Engpässe:</span> <b>${s.bottlenecks ?? '–'}</b></div>
      <div style="grid-column:1/-1;"><span style="color:#7a8099;">Max. ΔU (kum.):</span>
        <b>${s.maxCumDU_pct ?? '–'} %</b> ${s.maxCumAssetName ? `<span style="color:#7a8099;">@ ${s.maxCumAssetName}</span>` : ''}</div>
    </div>
    <div style="margin-top:14px;border-top:1px solid #2a3050;padding-top:10px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#7a8099;margin-bottom:6px;">
        Warnungen (${result?.warnings?.length ?? 0})</div>
      ${warns.length === 0
        ? `<div style="color:#66bb6a;font-size:11px;">Keine Warnungen.</div>`
        : warns.map(w => `<div style="font-size:11px;color:#f9a825;padding:2px 0;">${w}</div>`).join('')}
      ${result?.warnings?.length > warns.length
        ? `<div style="font-size:10px;color:#7a8099;margin-top:4px;">… +${result.warnings.length - warns.length} weitere</div>` : ''}
    </div>`;
  showOverlay('stromnetz-recalc-panel', '🔄 Stromnetz-Berechnung', html,
              { width: '460px', height: 'auto', accent: '#4fc3f7' });
}

// ── SLD anzeigen ────────────────────────────────────────────────────────────
export function uiShowSld() {
  const svg = buildSldSvg();
  showOverlay('stromnetz-sld-panel', '⚡ Einlinienschema (SLD)',
              `<div style="background:#0b0e18;padding:8px;">${svg}</div>`,
              { width: '750px', height: '700px', accent: '#26a69a' });
}

// ── Maßnahmenplan anzeigen ──────────────────────────────────────────────────
export function uiShowMassnahmenplan() {
  const entries = buildMassnahmenplan();
  if (entries.length === 0) {
    showOverlay('stromnetz-massnahmen-panel', '📋 Maßnahmenplan',
      `<div style="color:#9aa;font-size:11px;text-align:center;padding:30px;">
        Noch keine Maßnahmen erfasst.<br>
        <span style="font-size:10px;">In Maßnahmen-CRUD via Console:
        <code>addAssetMassnahme(assetId, {jahr:2030, eigenschaft:'leistungKW', wertNeu:50, kosten:8000})</code></span>
       </div>`,
      { width: '550px', height: 'auto', accent: '#ce93d8' });
    return;
  }
  const totalK = entries.reduce((s, e) => s + e.kosten, 0);
  const rows = entries.map(e => {
    const sim = e.sim ? '⬟' : '○';
    const kostenStr = e.kosten > 0 ? `${e.kosten.toLocaleString('de-DE')} €` : '–';
    const katIcon = { 'asset':'⚡','leitung':'〰','gebaeude-sanierung':'🔥','gebaeude-abriss':'🏚' }[e.kategorie] || '·';
    return `<tr style="border-bottom:1px solid #2a3050;">
      <td style="padding:3px 6px;color:#cfd;font-weight:600;">${e.jahr}</td>
      <td style="padding:3px 6px;font-size:13px;">${katIcon}</td>
      <td style="padding:3px 6px;color:#cfd;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.objektName}">${e.objektName}</td>
      <td style="padding:3px 6px;color:#9aa;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.detail}">${e.detail}</td>
      <td style="padding:3px 6px;text-align:center;color:${e.sim?'#66bb6a':'#7a8099'};">${sim}</td>
      <td style="padding:3px 6px;text-align:right;color:#4fc3f7;white-space:nowrap;">${kostenStr}</td>
    </tr>`;
  }).join('');
  const html = `
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="border-bottom:1px solid #2a3050;color:#7a8099;font-size:9px;text-transform:uppercase;">
        <th style="padding:4px 6px;text-align:left;">Jahr</th>
        <th style="padding:4px 6px;">Kat.</th>
        <th style="padding:4px 6px;text-align:left;">Objekt</th>
        <th style="padding:4px 6px;text-align:left;">Maßnahme</th>
        <th style="padding:4px 6px;text-align:center;">Sim</th>
        <th style="padding:4px 6px;text-align:right;">Kosten</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:1px solid #2a3050;">
        <td colspan="5" style="padding:6px;color:#9aa;font-size:10px;">Summe</td>
        <td style="padding:6px;text-align:right;color:#4fc3f7;font-weight:600;font-size:13px;">${totalK.toLocaleString('de-DE')} €</td>
      </tr></tfoot>
    </table>
    <div style="margin-top:8px;font-size:9px;color:#7a8099;">⬟ Sim-relevant · ○ Doku</div>`;
  showOverlay('stromnetz-massnahmen-panel', '📋 Maßnahmenplan', html,
              { width: '650px', height: '550px', accent: '#ce93d8' });
}

// ── Investitionsplanung anzeigen ────────────────────────────────────────────
export function uiShowInvest() {
  const html = buildInvestOverviewHtml();
  showOverlay('stromnetz-invest-panel', '💰 Investitionsplan', html,
              { width: '500px', height: 'auto', accent: '#26a69a',
                left: '20px', right: 'auto' });
}

// ── Heatmap toggle (Last/Erzeugung als Pixel-Relief) ───────────────────────
export function uiToggleHeatmap() {
  const willOn = !isHeatmapActive();
  heatmapToggle(willOn);
  // Button-Status visuell anpassen (falls Button mit ID 'btn-stromnetz-heatmap' existiert)
  const btn = document.getElementById('btn-stromnetz-heatmap');
  if (btn) btn.classList.toggle('active', willOn);
}

export function uiSetHeatmapMode(mode) {
  heatmapSetMode(mode);
}

// ── Trafo-Optimierung ausführen + Ergebnis-Overlay ─────────────────────────
export function uiRunTrafoOptimierung(opts) {
  const r = runTrafoOptimierung(opts || {});
  const id = 'stromnetz-trafoopt-panel';
  closeOverlay(id);
  if (!r.ok) {
    showOverlay(id, '🔁 Trafo-Optimierung',
      `<div style="color:#ef5350;padding:20px;text-align:center;">${r.error}</div>`,
      { width: '420px', height: 'auto', accent: '#ef5350' });
    return;
  }
  if (r.allServed) {
    showOverlay(id, '🔁 Trafo-Optimierung',
      `<div style="color:#66bb6a;padding:20px;text-align:center;">
        ✓ Alle Lastpunkte werden von den ${r.existingCount} bestehenden Trafos versorgt.<br>
        <span style="color:#9aa;font-size:11px;">Keine zusätzlichen Trafos nötig.</span>
       </div>`,
      { width: '420px', height: 'auto', accent: '#66bb6a' });
    return;
  }
  const info = r.info || {};
  const totalKw = r.clusters.reduce((s, c) => s + c.peakKW, 0);
  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;font-size:12px;line-height:1.6;margin-bottom:12px;">
      <div><span style="color:#7a8099;">Bestand-Trafos:</span> <b>${r.existingCount}</b></div>
      <div><span style="color:#7a8099;">Neue Trafo-Standorte:</span> <b>${r.clusters.length}</b></div>
      <div><span style="color:#7a8099;">Modus:</span> <b>${info.mode || '–'}</b></div>
      <div><span style="color:#7a8099;">Standard-kVA:</span> <b>${info.maxKVA ?? '–'}</b></div>
      ${info.whaleCount ? `<div style="grid-column:1/-1;">
        <span style="color:#ffa726;">⚡ Direktanschlüsse (Großverbraucher):</span> <b>${info.whaleCount}</b></div>` : ''}
      ${info.capacityExceeded ? `<div style="grid-column:1/-1;color:#ef5350;">
        ⚠ Kapazität trotz max. k überschritten.</div>` : ''}
      <div style="grid-column:1/-1;border-top:1px solid #2a3050;padding-top:6px;margin-top:4px;">
        <span style="color:#7a8099;">Gesamt-Peak (alle neuen):</span>
        <b>${totalKw.toFixed(0)} kW</b></div>
    </div>
    <div style="font-size:10px;color:#9aa;margin-bottom:8px;">
      Cluster auf der Karte sichtbar (T-Marker + Voronoi-Zonen).
      Klick auf Marker für Details.
    </div>
    <button id="trafoopt-clear-btn" style="width:100%;padding:6px;background:transparent;
      border:1px solid #ef5350;color:#ef5350;border-radius:4px;cursor:pointer;font-size:11px;">
      Cluster-Layer von Karte entfernen
    </button>`;
  const el = showOverlay(id, '🔁 Trafo-Optimierung — Ergebnis', html,
              { width: '460px', height: 'auto', accent: '#ffa726' });
  el.querySelector('#trafoopt-clear-btn')?.addEventListener('click', () => {
    clearTrafoOptimierung();
    closeOverlay(id);
  });
}

export function uiClearTrafoOptimierung() {
  clearTrafoOptimierung();
}

// ── Szenario-Quick-Selector (Toast-Stil) ────────────────────────────────────
// Zeigt Szenarien als Pill-Liste, klick → aktivieren. Nicht persistent.
export function uiShowSzenarienPills() {
  const id = 'stromnetz-sz-pills';
  closeOverlay(id);
  const aktiv = STROMNETZ.aktivSzenario;
  const items = [{ id: null, name: 'Bestand', farbe: '#4caf50' }, ...STROMNETZ.szenarien];
  if (items.length === 1) {
    showOverlay(id, '🎯 Szenarien',
      `<div style="color:#9aa;font-size:11px;text-align:center;padding:20px;">
        Noch keine Szenarien angelegt.<br>
        <span style="font-size:10px;">Console: <code>createSzenario('Mein Plan')</code></span>
       </div>`,
      { width: '320px', height: 'auto', accent: '#9c27b0', top: '70px', right: '20px', left: 'auto' });
    return;
  }
  const pills = items.map(s => {
    const isActive = s.id === aktiv;
    return `<button data-szid="${s.id || ''}"
      style="display:flex;align-items:center;gap:6px;padding:5px 10px;margin:3px;
             background:${isActive ? s.farbe : 'transparent'};
             border:1px solid ${s.farbe};border-radius:14px;
             color:${isActive ? '#000' : s.farbe};cursor:pointer;font-size:11px;font-weight:${isActive?'700':'500'};">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.farbe};"></span>
      ${s.name}
    </button>`;
  }).join('');
  const el = showOverlay(id, '🎯 Szenarien',
    `<div style="display:flex;flex-wrap:wrap;">${pills}</div>
     <div style="margin-top:10px;font-size:10px;color:#7a8099;">Klick = aktivieren · Recalc/SLD übernehmen das Szenario.</div>`,
    { width: '380px', height: 'auto', accent: '#9c27b0', top: '70px', right: '20px', left: 'auto' });
  el.querySelectorAll('[data-szid]').forEach(b => {
    b.addEventListener('click', () => {
      const szid = b.dataset.szid || null;
      if (typeof window.activateSzenario === 'function') window.activateSzenario(szid);
      uiShowSzenarienPills();  // Pills neu rendern
    });
  });
}
