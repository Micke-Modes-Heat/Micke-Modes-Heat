// ── 05c-bericht.js — Begehungsbericht
import { gebaeude } from './01-globals-varianten.js';
import { ASSETS } from './13a-assets-core.js';


// ── Begehungsbericht ──────────────────────────────────────────────────────────
export function exportBegehungsbericht() {
  const projektName = document.querySelector('.header-projekt-name')?.textContent
    || document.title
    || 'Energieplanung';
  const datum = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });

  // Objekte mit Felddaten sammeln
  const gebMitFeld = (window.gebaeude || []).filter(g =>
    g.feldNotizen || g.feldStatus || g.feldFotos?.length
  );
  const assetsMitFeld = (window.ASSETS?.items || []).filter(a =>
    a.feldNotizen || a.feldStatus
  );

  const totalFotos = gebMitFeld.reduce((s, g) => s + (g.feldFotos?.length || 0), 0);
  const erledigt   = [...gebMitFeld, ...assetsMitFeld].filter(x => x.feldStatus === 'erledigt').length;
  const besucht    = [...gebMitFeld, ...assetsMitFeld].filter(x => x.feldStatus === 'besucht').length;

  const NUTZUNG_LABEL = {
    efh:'Einfamilienhaus', mfh:'Mehrfamilienhaus', ghd:'Gewerbe/Handel',
    schule:'Schule', buero:'Büro', industrie:'Industrie', oeffentlich:'Öffentlich'
  };
  const statusLabel = { erledigt:'✅ Erledigt', besucht:'👁 Besucht', offen:'📋 Offen' };
  const statusColor = { erledigt:'#dcfce7', besucht:'#dbeafe', offen:'#f3f4f6' };
  const statusBorder= { erledigt:'#16a34a', besucht:'#2563eb', offen:'#9ca3af' };

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtKw(v) { const n=parseFloat(v); return isNaN(n)||n<=0?'–':n>=1000?`${(n/1000).toFixed(1)} MW`:`${Math.round(n)} kW`; }

  // ── Gebäude-Abschnitte ────────────────────────────────────────────────────
  const gebSections = gebMitFeld.map(g => {
    const st = statusLabel[g.feldStatus] || '–';
    const stC = statusColor[g.feldStatus]  || '#f9fafb';
    const stB = statusBorder[g.feldStatus] || '#e5e7eb';
    const fotos = (g.feldFotos || []).map(f =>
      `<div style="break-inside:avoid;"><img src="${f.dataUrl}" alt="${esc(f.name)}" style="width:100%;max-width:300px;height:200px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;display:block;"></div>`
    ).join('');

    return `
    <div style="break-inside:avoid;margin-bottom:24px;border:1.5px solid ${stB};border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
      <div style="background:${stC};padding:10px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid ${stB};">
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;">${esc(g.name)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">${NUTZUNG_LABEL[g.nutzung]||g.nutzung||'–'} · Baujahr ${g.baujahr||'–'} · ${g.flaeche?Math.round(g.flaeche)+' m²':'–'}</div>
        </div>
        <div style="font-size:13px;white-space:nowrap;">${st}</div>
      </div>
      <div style="padding:12px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;border-bottom:1px solid #f0f0f0;">
        <div><div style="font-size:10px;color:#9ca3af;">Wärmebedarf</div><div style="font-weight:700;color:#f59e0b;">${fmtKw(g.waerme)}</div></div>
        <div><div style="font-size:10px;color:#9ca3af;">Heizlast</div><div style="font-weight:700;">${fmtKw(g.heizlast)}</div></div>
        <div><div style="font-size:10px;color:#9ca3af;">Zustand</div><div style="font-weight:700;">${esc(g.zustand)||'–'}</div></div>
      </div>
      ${g.feldNotizen ? `<div style="padding:10px 16px;border-bottom:${(g.feldFotos?.length)?'1px solid #f0f0f0':'none'};background:#fffbeb;">
        <div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:4px;">NOTIZEN</div>
        <div style="font-size:12px;white-space:pre-wrap;color:#1f2937;">${esc(g.feldNotizen)}</div>
      </div>` : ''}
      ${fotos ? `<div style="padding:12px 16px;">
        <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:8px;">FOTOS (${g.feldFotos.length})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">${fotos}</div>
      </div>` : ''}
    </div>`;
  }).join('');

  // ── Asset-Abschnitte ──────────────────────────────────────────────────────
  const assetSections = assetsMitFeld.map(a => {
    const cfg = window.ASSET_CFG?.[a.type] || {};
    const st = statusLabel[a.feldStatus] || '–';
    const stC = statusColor[a.feldStatus]  || '#f9fafb';
    const stB = statusBorder[a.feldStatus] || '#e5e7eb';
    return `
    <div style="break-inside:avoid;margin-bottom:16px;border:1.5px solid ${stB};border-radius:10px;overflow:hidden;">
      <div style="background:${stC};padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid ${stB};">
        <span style="font-size:18px;">${cfg.icon||'◻'}</span>
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${esc(a.name||cfg.label)}</div>
        <div style="font-size:10px;color:#6b7280;">${cfg.label||a.type} · ID: ${a.id}</div></div>
        <div style="font-size:13px;">${st}</div>
      </div>
      ${a.feldNotizen ? `<div style="padding:10px 16px;background:#fffbeb;">
        <div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:4px;">NOTIZEN</div>
        <div style="font-size:12px;white-space:pre-wrap;">${esc(a.feldNotizen)}</div>
      </div>` : ''}
    </div>`;
  }).join('');

  // ── Vollständiges HTML ────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Begehungsbericht – ${esc(projektName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; background: white; }
  @media print {
    body { font-size: 11pt; }
    .no-print { display: none !important; }
    .page-break { break-before: page; }
  }
  .cover { background: linear-gradient(135deg, #1e40af, #0891b2); color: white; padding: 60px 48px; min-height: 260px; }
  .cover h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
  .cover .sub { font-size: 14px; opacity: .8; margin-bottom: 4px; }
  .kpi-bar { display: flex; gap: 0; border-bottom: 2px solid #e5e7eb; }
  .kpi { flex: 1; padding: 20px 24px; border-right: 1px solid #e5e7eb; }
  .kpi:last-child { border-right: none; }
  .kpi-val { font-size: 28px; font-weight: 800; color: #1e40af; }
  .kpi-lbl { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .section-title { font-size: 16px; font-weight: 700; color: #1e40af; padding: 20px 32px 12px; border-bottom: 2px solid #e5e7eb; }
  .content { padding: 20px 32px; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #1e40af; color: white; border: none; padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(30,64,175,.4); z-index: 100; }
  .print-btn:hover { background: #1d4ed8; }
</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">🖨 Drucken / Als PDF speichern</button>

<div class="cover">
  <h1>Begehungsbericht</h1>
  <div class="sub">Projekt: ${esc(projektName)}</div>
  <div class="sub">Erstellt am: ${datum}</div>
</div>

<div class="kpi-bar">
  <div class="kpi"><div class="kpi-val">${gebMitFeld.length + assetsMitFeld.length}</div><div class="kpi-lbl">Objekte mit Felddaten</div></div>
  <div class="kpi"><div class="kpi-val">${erledigt}</div><div class="kpi-lbl">✅ Erledigt</div></div>
  <div class="kpi"><div class="kpi-val">${besucht}</div><div class="kpi-lbl">👁 Besucht</div></div>
  <div class="kpi"><div class="kpi-val">${totalFotos}</div><div class="kpi-lbl">📷 Fotos</div></div>
  <div class="kpi"><div class="kpi-val">${(window.gebaeude||[]).length}</div><div class="kpi-lbl">Gebäude gesamt</div></div>
</div>

${gebMitFeld.length ? `
<div class="section-title">🏠 Gebäude (${gebMitFeld.length})</div>
<div class="content">${gebSections}</div>` : ''}

${assetsMitFeld.length ? `
<div class="section-title page-break">⚡ Elektro-Assets (${assetsMitFeld.length})</div>
<div class="content">${assetSections}</div>` : ''}

${gebMitFeld.length === 0 && assetsMitFeld.length === 0 ? `
<div style="text-align:center;padding:80px;color:#9ca3af;">
  <div style="font-size:48px;margin-bottom:16px;">📋</div>
  <div style="font-size:16px;">Keine Felddaten vorhanden.<br>Importiere zuerst einen Feldapp-Export.</div>
</div>` : ''}

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Popup wurde blockiert – bitte Popups für diese Seite erlauben.'); return; }
  win.document.write(html);
  win.document.close();
}
