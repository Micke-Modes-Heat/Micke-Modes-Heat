// ── 03c-gebaeude-io.js — Gebäude-UI, Totals, Chart, Gebäude-PV, Rendering, Projekt-Import/Export, Animation ──
import { _expandedIds, globalYear, isExcluded, selectedId, stromEdges } from './01-globals-varianten.js';
import { getColor, getColorRange, getColorVal, getComputedStats, getGebStromMwh, highlightCard, map } from './02b-gebaeude.js';
import { hidePanels, populateZentraleSelect } from './03b-netz.js';
import { updateLpGebietStatus, updatePrintLegend } from './04a-ui-panels.js';
import { glGetGesamtMwh, glGetMonatswerte, glLastgangKw } from './06a-gbi-lastgang.js';
import { calcStromPanel } from './09b-pv-calc.js';
// Phase 3 — neues Asset/Stromnetz-System (Persistenz-Bug-Fix)
import { ASSETS } from './13a-assets-core.js';
import { redrawAllAssets } from './13b-assets-render.js';
import { STROMNETZ } from './14b-stromnetz-state.js';
import { redrawAllStromnetz } from './15a-stromnetz-render.js';
// Phase 4 — Foto-Anhang
import { exportPhotosForProject, importPhotosFromProject, clearAllPhotos } from './17a-fotos-storage.js';
import { resetUngespeichertReminder, cleanupOrphanPhotos } from './17c-fotos-ui.js';

export function updateTotals(){
  let tw=0, th=0;
  window.gebaeude.forEach(g=>{
    if (isExcluded(g.id)) return;
    const stats = getComputedStats(g, globalYear);
    tw += stats.waerme;
    th += stats.heizlast;
  });
  document.getElementById('tot-waerme').textContent=tw?tw.toLocaleString('de-DE',{maximumFractionDigits:1}):'—';
  document.getElementById('tc-waerme').title='Summe Wärmebedarf aller Gebäude (ohne Netzverluste)';
  document.getElementById('tot-hl').textContent=th?Math.round(th).toLocaleString('de-DE'):'—';
  document.getElementById('tot-hl-lbl').textContent='Heizlast (kW)';
  document.getElementById('tc-hl').title='Summe der Gebäude-Normheizlasten (DIN 12831).\nWird für Rohrdimensionierung im Netz verwendet.';
  // Strom-Totals
  let ts=0, tsl=0;
  if (window.elQuartierH) {
    for (let i=0;i<8760;i++) { ts += window.elQuartierH[i]; if (window.elQuartierH[i] > tsl) tsl = window.elQuartierH[i]; }
    ts /= 1000;
  } else {
    window.gebaeude.forEach(g => { if (!isExcluded(g.id)) ts += getGebStromMwh(g); });
    if (ts > 0) tsl = ts * 1000 / 2500; // Schätzung ~2500 VBH
  }
  document.getElementById('tot-strom').textContent=ts>0?ts.toLocaleString('de-DE',{maximumFractionDigits:1}):'—';
  document.getElementById('tot-stromlast').textContent=tsl>0?Math.round(tsl).toLocaleString('de-DE'):'—';
  document.getElementById('geb-count').textContent=window.gebaeude.length;

  // Quellenübersicht
  const srcEl = document.getElementById('tot-sources');
  if (srcEl) {
    const ss = window.systemState;
    const hatLg = typeof glLastgangKw !== 'undefined' && !!glLastgangKw;
    const hatMonat = typeof glGetMonatswerte === 'function' && glGetMonatswerte().some(v => v !== null);
    const hatGesamt = typeof glGetGesamtMwh === 'function' && glGetGesamtMwh() > 0;
    let wSrc = '—';
    if (hatLg) wSrc = 'Lastgang';
    else if (hatMonat && hatGesamt) wSrc = 'Gesamt + Monate';
    else if (hatMonat) wSrc = 'Monatswerte';
    else if (hatGesamt) wSrc = 'Gesamtwert';
    else if (tw > 0) wSrc = 'Gebäudedaten';

    let sSrc = '—';
    if (window.elQuartierH) sSrc = 'Lastgang';
    else if (parseFloat(document.getElementById('strom-quartier-mwh')?.value) > 0) sSrc = 'Gesamtwert';
    else if (ts > 0) sSrc = 'Gebäudedaten';

    const pvKwp = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
    let pvSrc = '—';
    if (pvKwp > 0) pvSrc = pvKwp.toLocaleString('de-DE',{maximumFractionDigits:1}) + ' kWp';

    const dot = (color) => '<span class="src-dot" style="background:' + color + '"></span>';
    srcEl.innerHTML =
      '<span class="src-tag">' + dot('var(--accent)') + 'Wärme: ' + wSrc + '</span>' +
      '<span class="src-tag">' + dot('#ffd54f') + 'Strom: ' + sSrc + '</span>' +
      '<span class="src-tag">' + dot('#66bb6a') + 'PV: ' + pvSrc + '</span>';
  }

  updatePrintLegend();
}

export function cardDotColor(g){
  const [cMin,cMax]=getColorRange();
  return getColor(getColorVal(g),cMin,cMax);
}

export function drawChart() {
  const container = document.getElementById('svg-chart-container');
  if (!container) return;

  const years = [];
  for (let y = 2026; y <= 2050; y++) years.push(y);

  // Wärme MIT Sanierungen (aktuell)
  const waerme = years.map(y => {
    let s = 0; window.gebaeude.forEach(g => { s += getComputedStats(g, y).waerme; }); return s;
  });
  // Wärme OHNE Sanierungen (Vergleich)
  const waermeOhne = years.map(y => {
    let s = 0;
    window.gebaeude.forEach(g => {
      const saved = g.sanierungen; g.sanierungen = [];
      s += getComputedStats(g, y).waerme;
      g.sanierungen = saved;
    });
    return s;
  });
  // Heizlast MIT Sanierungen
  const hl = years.map(y => {
    let s = 0; window.gebaeude.forEach(g => { s += getComputedStats(g, y).heizlast; }); return s;
  });

  const maxW  = Math.max(...waerme, ...waermeOhne, 1);
  const maxHL = Math.max(...hl, 1);

  const w = Math.max(container.clientWidth, 300);
  const h = Math.max(container.clientHeight, 180);
  const padL = 42, padR = 42, padT = 18, padB = 28;
  const cw = w - padL - padR;
  const ch = h - padT - padB;

  function xp(i) { return padL + (i / (years.length - 1)) * cw; }
  function ypW(v) { return padT + ch - (v / maxW) * ch; }
  function ypHL(v) { return padT + ch - (v / maxHL) * ch; }

  const ptsW     = years.map((_,i) => `${xp(i)},${ypW(waerme[i])}`).join(' ');
  const ptsWohne = years.map((_,i) => `${xp(i)},${ypW(waermeOhne[i])}`).join(' ');
  const ptsHL    = years.map((_,i) => `${xp(i)},${ypHL(hl[i])}`).join(' ');

  // Year marker
  const yi = years.indexOf(globalYear);
  const xCur = xp(yi >= 0 ? yi : 0);

  // Grid lines (4 horizontal)
  let grid = '';
  for (let t = 0; t <= 4; t++) {
    const yg = padT + (t / 4) * ch;
    const vW = Math.round(maxW * (1 - t / 4));
    grid += `<line x1="${padL}" y1="${yg}" x2="${w-padR}" y2="${yg}" stroke="#2a3050" stroke-width="0.5"/>`;
    grid += `<text x="${padL-4}" y="${yg+3}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace" text-anchor="end">${vW}</text>`;
    const vHL = Math.round(maxHL * (1 - t / 4));
    grid += `<text x="${w-padR+4}" y="${yg+3}" fill="#f9a825" font-size="8" font-family="DM Mono,monospace" text-anchor="start" opacity="0.7">${vHL}</text>`;
  }

  // Area fill under waerme line
  const areaW = `${ptsW} ${xp(years.length-1)},${padT+ch} ${xp(0)},${padT+ch}`;

  let html = `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" style="overflow:visible">
    ${grid}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+ch}" stroke="#2a3050" stroke-width="1"/>
    <line x1="${padL}" y1="${padT+ch}" x2="${w-padR}" y2="${padT+ch}" stroke="#2a3050" stroke-width="1"/>
    <line x1="${w-padR}" y1="${padT}" x2="${w-padR}" y2="${padT+ch}" stroke="#2a3050" stroke-width="1" opacity="0.4"/>

    <!-- Vergleich ohne Sanierung -->
    <polyline points="${ptsWohne}" fill="none" stroke="#e53935" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.5"/>

    <!-- Area fill Wärme -->
    <polygon points="${areaW}" fill="#4caf50" opacity="0.07"/>

    <!-- Wärme MIT Sanierung -->
    <polyline points="${ptsW}" fill="none" stroke="#4caf50" stroke-width="2"/>

    <!-- Heizlast (rechte Achse) -->
    <polyline points="${ptsHL}" fill="none" stroke="#f9a825" stroke-width="1.5" stroke-dasharray="7 3" opacity="0.8"/>

    <!-- Aktuelles Jahr -->
    <line x1="${xCur}" y1="${padT}" x2="${xCur}" y2="${padT+ch}" stroke="#4fc3f7" stroke-width="1" stroke-dasharray="4 3" opacity="0.6"/>
    <text x="${xCur}" y="${padT-4}" fill="#4fc3f7" font-size="8" font-family="DM Mono,monospace" text-anchor="middle">${globalYear}</text>

    <!-- X-Achse Labels -->
    <text x="${padL}" y="${padT+ch+12}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace">2026</text>
    <text x="${xp(13)}" y="${padT+ch+12}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace" text-anchor="middle">2037</text>
    <text x="${w-padR}" y="${padT+ch+12}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace" text-anchor="end">2050</text>

    <!-- Achsenbeschriftungen -->
    <text x="${padL-2}" y="${padT-6}" fill="#4caf50" font-size="8" font-family="DM Sans,sans-serif">MWh/a</text>
    <text x="${w-padR+2}" y="${padT-6}" fill="#f9a825" font-size="8" font-family="DM Sans,sans-serif" opacity="0.8">kW</text>

    <!-- Legende -->
    <line x1="${padL}" y1="${padT+ch+22}" x2="${padL+18}" y2="${padT+ch+22}" stroke="#4caf50" stroke-width="2"/>
    <text x="${padL+21}" y="${padT+ch+25}" fill="#7a8099" font-size="8" font-family="DM Sans,sans-serif">Wärme (mit San.)</text>
    <line x1="${padL+105}" y1="${padT+ch+22}" x2="${padL+123}" y2="${padT+ch+22}" stroke="#e53935" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.7"/>
    <text x="${padL+126}" y="${padT+ch+25}" fill="#7a8099" font-size="8" font-family="DM Sans,sans-serif">ohne San.</text>
    <line x1="${padL+185}" y1="${padT+ch+22}" x2="${padL+203}" y2="${padT+ch+22}" stroke="#f9a825" stroke-width="1.5" stroke-dasharray="7 3" opacity="0.8"/>
    <text x="${padL+206}" y="${padT+ch+25}" fill="#7a8099" font-size="8" font-family="DM Sans,sans-serif">Heizlast</text>
  </svg>`;

  container.innerHTML = html;
}

window.addEventListener('resize', () => {
    if (document.getElementById('chart-panel').classList.contains('visible')) drawChart();
    if (typeof map !== 'undefined') setTimeout(() => map.invalidateSize(), 100);
});

export function _renderCompactRow(g, stats, isExpanded) {
  const dot = cardDotColor(g);
  const nutzungLabel = {efh:'EFH',mfh:'MFH',ghd:'GHD',schule:'Schule',buero:'Büro',industrie:'Ind.',oeffentlich:'Öff.'}[g.nutzung] || '—';
  const waermeStr = stats.waerme > 0 ? Math.round(stats.waerme).toLocaleString('de-DE') : '—';
  const hlStr = stats.heizlast > 0 ? Math.round(stats.heizlast).toLocaleString('de-DE') : '—';
  const statusColor = stats.status==='abgerissen'?'#e53935':stats.status==='saniert'?'#4caf50':stats.status==='geplant'?'#f9a825':'transparent';
  const badgeClass = g.polygon ? (g.fromOsm ? 'osm' : 'ok') : '';
  const badgeText = g.polygon ? (g.fromOsm ? 'OSM' : '✓') : '–';
  return `<div class="geb-compact-row" data-click="toggleGebExpand(${g.id})">
    <div style="display:flex;align-items:center;gap:5px;width:100%;">
      <input type="checkbox" style="flex-shrink:0;accent-color:var(--accent);cursor:pointer;" ${g.selected?'checked':''} data-change="toggleSelect(${g.id},this.checked)" data-click="event.stopPropagation()" title="Auswählen"/>
      <div class="geb-color-dot" data-dot="${g.id}" style="background:${dot};flex-shrink:0;"></div>
      <span class="geb-compact-name">${escHtml(g.name)}</span>
      <span style="font-size:9px;color:var(--muted);flex-shrink:0;">${isExpanded?'▲':'▼'}</span>
    </div>
    <div style="display:flex;align-items:center;gap:4px;padding-left:28px;margin-top:1px;">
      <span style="font-size:9px;color:var(--muted);min-width:28px;flex-shrink:0;">${nutzungLabel}</span>
      <span class="geb-compact-val geb-cv-waerme-${g.id}" style="color:var(--accent)">${waermeStr}</span>
      <span class="geb-compact-unit">MWh</span>
      <span class="geb-compact-val geb-cv-hl-${g.id}" style="color:#f9a825">${hlStr}</span>
      <span class="geb-compact-unit">kW</span>
      <div class="geb-badge ${badgeClass}" style="font-size:8px;padding:1px 3px;margin-left:auto;">${badgeText}</div>
      ${statusColor!=='transparent'?`<span style="width:5px;height:5px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>`:''}
    </div>
  </div>`;
}

export function _pvWpM2Global() {
  const b  = parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1;
  const l  = parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7;
  const wp = parseFloat(document.getElementById('pv-modul-wp')?.value)     || 450;
  return wp / (b * l);
}

export function calcGebKwp(g) {
  const fl = parseFloat(g.flaeche) || 0;
  return fl * (g.pvDachanteil || 30) / 100 * _pvWpM2Global() / 1000;
}

export function _gebLabelHtml(g) {
  const pvBadge = g.pvAktiv ? '<span style="color:#ffd54f;font-size:9px;margin-left:3px;vertical-align:middle;">☀</span>' : '';
  return escHtml(g.name) + pvBadge;
}

export function _updateGebLabelPv(id) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g || !g.labelMarker) return;
  const el = g.labelMarker.getElement();
  if (!el) return;
  const inner = el.querySelector('.geb-label-inner');
  if (inner) inner.innerHTML = _gebLabelHtml(g);
}

export function updateGebPv(id, field, val) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  if (field === 'pvAktiv') g.pvAktiv = val;
  else if (field === 'pvDachanteil') g.pvDachanteil = parseFloat(val) || 30;
  _rerenderCard(id);
  _updateGebLabelPv(id);
  calcStromPanel();
  renderGebPvPanel();
}

export function toggleGebPvPanel() {
  const p   = document.getElementById('geb-pv-panel');
  const btn = document.getElementById('btn-geb-pv-toggle');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
  btn.classList.add('active');
  renderGebPvPanel();
}

export function gebPvAllenZuweisen() {
  const dach = parseFloat(document.getElementById('geb-pv-dachanteil')?.value) || 30;
  window.gebaeude.forEach(g => { g.pvDachanteil = dach; _rerenderCard(g.id); });
  renderGebPvPanel();
  calcStromPanel();
}

export function renderGebPvPanel() {
  const panel = document.getElementById('geb-pv-panel');
  if (!panel?.classList.contains('visible')) return;
  const list  = document.getElementById('geb-pv-list');
  const summe = document.getElementById('geb-pv-summe');
  if (!list) return;

  const pvSpez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const wpM2   = _pvWpM2Global();
  const b      = parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1;
  const l      = parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7;
  const wp     = parseFloat(document.getElementById('pv-modul-wp')?.value)     || 450;
  const mFlaeche = b * l;
  const infoEl = document.getElementById('pv-modul-info');
  if (infoEl) infoEl.textContent = `${b.toFixed(2)} × ${l.toFixed(2)} m = ${mFlaeche.toFixed(2)} m²/Modul → ${wpM2.toFixed(0)} Wp/m²`;

  const mitFlaeche = window.gebaeude.filter(g => parseFloat(g.flaeche) > 0);

  if (mitFlaeche.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:6px 0;">Noch keine Gebäude mit Fläche vorhanden.</div>';
    summe.style.display = 'none';
    return;
  }

  // Tabellenkopf
  let html = `<div style="display:grid;grid-template-columns:auto 1fr 64px 50px;gap:4px 8px;align-items:center;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--border);">
    <span style="color:var(--muted)">PV</span>
    <span style="color:var(--muted)">Gebäude</span>
    <span style="color:var(--muted);text-align:right;">Dach%</span>
    <span style="color:var(--muted);text-align:right;">kWp</span>
  </div>`;

  let totalKwp = 0;
  mitFlaeche.forEach(g => {
    const kwp = calcGebKwp(g);
    if (g.pvAktiv) totalKwp += kwp;
    html += `<div style="display:grid;grid-template-columns:auto 1fr 64px 50px;gap:4px 8px;align-items:center;margin-bottom:3px;">
      <input type="checkbox" ${g.pvAktiv ? 'checked' : ''} style="cursor:pointer;"
        data-change="updateGebPv(${g.id},'pvAktiv',this.checked)"/>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(g.name)}">${escHtml(g.name)}</span>
      <input class="inp-field" type="number" value="${g.pvDachanteil || 30}" min="5" max="100" step="5"
        style="padding:2px 4px;font-size:9px;text-align:right;"
        data-input="updateGebPv(${g.id},'pvDachanteil',this.value)"/>
      <span style="text-align:right;font-family:'DM Mono',monospace;color:${g.pvAktiv ? '#ffd54f' : 'var(--muted)'};">${kwp.toFixed(1)}</span>
    </div>`;
  });
  list.innerHTML = html;

  // Summe
  if (totalKwp > 0) {
    const mwha = totalKwp * pvSpez / 1000;
    summe.style.display = 'block';
    summe.innerHTML = `<span style="color:var(--muted)">Gesamt aktiv</span><span style="color:#ffd54f;font-weight:bold;margin-left:auto;display:block;text-align:right;">${totalKwp.toFixed(1)} kWp · ${mwha.toFixed(0)} MWh/a</span>`;
    summe.style.display = 'flex';
    summe.style.justifyContent = 'space-between';
    summe.style.alignItems = 'center';
  } else {
    summe.style.display = 'none';
  }
}

export function _renderExpandedPanel(g, stats) {
  const ausgeschlossen = isExcluded(g.id);
  let planItems = [];
  if (g.baujahr) planItems.push(`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0;"><span>Neubau ab ${g.baujahr}</span><span style="cursor:pointer;color:#e53935" data-click="clearPlan(${g.id}, 'neubau')">✕</span></div>`);
  if (g.sanierungen && g.sanierungen.length > 0) {
    g.sanierungen.forEach((s, idx) => {
      planItems.push(`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0;"><span>Sanierung ${s.jahr}: ${s.zielSpez} kWh/m²a</span><span style="cursor:pointer;color:#e53935" data-click="clearPlan(${g.id}, 'sanierung', ${idx})">✕</span></div>`);
    });
  }
  if (g.abrissjahr) planItems.push(`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0;"><span>Abriss im Jahr ${g.abrissjahr}</span><span style="cursor:pointer;color:#e53935" data-click="clearPlan(${g.id}, 'abriss')">✕</span></div>`);

  let infoLabel = '';
  if(stats.status === 'geplant') infoLabel = '<div style="color:#f9a825;font-size:10px;margin-bottom:5px;">Geplant</div>';
  else if(stats.status === 'abgerissen') infoLabel = '<div style="color:#e53935;font-size:10px;margin-bottom:5px;">Abgerissen</div>';
  else if(stats.status === 'saniert') infoLabel = `<div style="color:#4caf50;font-size:10px;margin-bottom:5px;">Saniert (${stats.spez.toLocaleString('de-DE',{maximumFractionDigits:1})} kWh/m²a)</div>`;

  const fW = window.systemState?.skalierFaktorW;
  const fH = window.systemState?.skalierFaktorH;
  let netzwertHtml = '';
  if (fW && (Math.abs(fW - 1) >= 0.01 || Math.abs((fH || fW) - 1) >= 0.01)) {
    const sW = g.waerme ? Math.round(g.waerme * fW) : null;
    const sH = g.heizlast ? (Math.round(parseFloat(g.heizlast) * (fH || fW) * 10) / 10) : null;
    if (sW || sH) {
      const parts = [];
      if (sW) parts.push(`${sW.toLocaleString('de-DE')} MWh/a`);
      if (sH) parts.push(`${sH.toLocaleString('de-DE')} kW`);
      netzwertHtml = `<div style="font-size:9px;color:#9fa8da;margin-top:3px;padding:2px 6px;background:rgba(63,81,181,0.12);border-radius:3px;border-left:2px solid #5c6bc0;">↑ Netzwert: ${parts.join(' · ')}</div>`;
    }
  }

  return `<div class="geb-expanded">
    ${infoLabel}
    <div style="margin-bottom:5px;">
      <select class="nutzung-select" data-change="setNutzung(${g.id},this.value)" title="Nutzungstyp">
        <option value="">Nutzungstyp…</option>
        <option value="efh"  ${g.nutzung==='efh'?'selected':''}>EFH</option>
        <option value="mfh"  ${g.nutzung==='mfh'?'selected':''}>MFH</option>
        <option value="ghd"  ${g.nutzung==='ghd'?'selected':''}>GHD</option>
        <option value="schule" ${g.nutzung==='schule'?'selected':''}>Schule</option>
        <option value="buero" ${g.nutzung==='buero'?'selected':''}>Büro</option>
        <option value="industrie" ${g.nutzung==='industrie'?'selected':''}>Industrie</option>
        <option value="oeffentlich" ${g.nutzung==='oeffentlich'?'selected':''}>Öffentlich</option>
      </select>
    </div>
    <div class="geb-inputs" style="grid-template-columns: 1fr 1fr; row-gap: 6px; opacity: ${stats.status==='abgerissen'||stats.status==='geplant'?0.4:1}">
      <div class="inp-group">
        <div class="inp-label">Wärme MWh/a (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.waerme)}"
          data-waerme="${g.id}"
          data-input="updateField(${g.id},'waerme',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Spez. kWh/m²a (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.spez)}"
          data-spez="${g.id}"
          style="${g.flaeche && g.waerme ? 'color:#4caf50' : ''}"
          data-input="updateField(${g.id},'spez',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Heizlast kW (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.heizlast)}"
          data-heizlast="${g.id}"
          data-input="updateField(${g.id},'heizlast',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Spez. HL W/m² (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.spezHeizlast)}"
          data-spezhl="${g.id}"
          style="${g.flaeche && g.heizlast ? 'color:#4caf50' : ''}"
          data-input="updateField(${g.id},'spezHeizlast',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Baujahr${g.baujährQuelle ? ' <span title="'+g.baujährQuelle+'" style="cursor:help;opacity:0.6;font-size:0.8em">ⓘ '+g.baujährQuelle.split('(')[0].trim()+'</span>' : ''}</div>
        <input class="inp-field" type="number" placeholder="z.B. 1980" value="${escVal(g.baujahr)}"
          data-input="updateField(${g.id},'baujahr',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Stockwerke</div>
        <input class="inp-field" type="number" placeholder="1" value="${g.stockwerke || 1}"
          data-input="updateField(${g.id},'stockwerke',this.value)"/>
      </div>
      ${g.zustand ? `<div class="inp-group">
        <div class="inp-label">Zustand</div>
        <select class="inp-field" data-change="updateField(${g.id},'zustand',this.value)">
          <option value="">—</option>
          <option value="A" ${g.zustand==='A'?'selected':''}>A (gut)</option>
          <option value="B" ${g.zustand==='B'?'selected':''}>B (mittel)</option>
          <option value="C" ${g.zustand==='C'?'selected':''}>C (schlecht)</option>
        </select>
      </div>` : ''}
      <div class="inp-group" style="grid-column: 1 / -1;">
        <div class="inp-label">Fläche m² ${g.flaeche ? "(OSM)" : ""}</div>
        <input class="inp-field" type="number" placeholder="—"
          value="${g.flaeche ? Math.round(g.flaeche) : ''}"
          data-input="updateField(${g.id},'flaeche',this.value)"/>
      </div>
    </div>
    <div style="margin-top:8px;padding:6px 8px;background:rgba(79,195,247,0.05);border-radius:5px;border:1px solid rgba(79,195,247,0.15);">
      <div style="font-size:9px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px;">⚡ Stromverbrauch</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <div class="inp-group">
          <div class="inp-label">Strom MWh/a</div>
          <input class="inp-field" type="number" placeholder="${getAutoStrom(g) || '—'}" value="${escVal(g.strom)}"
            data-input="updateField(${g.id},'strom',this.value)" title="Jahresstromverbrauch (ohne WP)"/>
        </div>
        <div class="inp-group">
          <div class="inp-label">Spez. kWh/m²a</div>
          <input class="inp-field" type="number" placeholder="${getAutoSpezStrom(g) || '—'}" value="${escVal(g.spezStrom)}"
            data-input="updateField(${g.id},'spezStrom',this.value)" title="Spez. Stromverbrauch"/>
        </div>
        <div class="inp-group" style="grid-column:1/-1;">
          <div class="inp-label">Profil</div>
          <select class="nutzung-select" style="width:100%;" data-change="updateField(${g.id},'stromProfil',this.value)" title="Lastprofil-Typ (SLP)">
            <option value="auto" ${g.stromProfil==='auto'?'selected':''}>Auto (nach Nutzung)</option>
            <option value="H0"   ${g.stromProfil==='H0'?'selected':''}>H0 — Haushalt</option>
            <option value="G0"   ${g.stromProfil==='G0'?'selected':''}>G0 — Gewerbe allg.</option>
            <option value="G1"   ${g.stromProfil==='G1'?'selected':''}>G1 — Gewerbe Werktag</option>
            <option value="G4"   ${g.stromProfil==='G4'?'selected':''}>G4 — Laden/Friseur</option>
            <option value="L0"   ${g.stromProfil==='L0'?'selected':''}>L0 — Landwirtschaft</option>
          </select>
        </div>
      </div>
    </div>
    <div style="margin-top:8px;padding:6px 8px;background:rgba(255,213,79,0.05);border-radius:5px;border:1px solid rgba(255,213,79,0.2);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:${g.pvAktiv ? '6px' : '0'};">
        <label style="font-size:10px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" ${g.pvAktiv ? 'checked' : ''} data-change="updateGebPv(${g.id},'pvAktiv',this.checked)" style="cursor:pointer;"/>
          <span style="color:#ffd54f;">☀ Dach-PV</span>
        </label>
        ${g.pvAktiv && g.flaeche ? `<span style="font-size:10px;color:#ffd54f;font-family:'DM Mono',monospace;margin-left:auto;">${calcGebKwp(g).toFixed(1)} kWp</span>` : ''}
      </div>
      ${g.pvAktiv ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:4px;">
        <div class="inp-group">
          <div class="inp-label">Dachanteil (%)</div>
          <input class="inp-field" type="number" value="${g.pvDachanteil || 30}" min="5" max="100" step="5"
            data-input="updateGebPv(${g.id},'pvDachanteil',this.value)"/>
        </div>
        <div class="inp-group" style="display:flex;flex-direction:column;justify-content:flex-end;">
          <div class="inp-label" style="color:var(--muted);">Modul global</div>
          <div style="font-size:10px;font-family:'DM Mono',monospace;color:#ffd54f;padding:5px 6px;">${calcGebKwp(g).toFixed(1)} kWp</div>
        </div>
      </div>` : ''}
    </div>
    ${netzwertHtml}
    ${g.netzVerlustKW != null ? `<div style="margin-top:6px;padding:5px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);font-size:10px;font-family:'DM Mono',monospace;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;">
      <span style="color:var(--muted)">Zuger. Verlust</span><span style="color:var(--text)">${g.netzVerlustKW.toFixed(1)} kW</span>
      ${g.netzVerlustJahrMWh != null ? `<span style="color:var(--muted)">Verlust/Jahr</span><span style="color:var(--text)">${g.netzVerlustJahrMWh.toLocaleString('de-DE')} MWh/a</span>` : ''}
      <span style="color:var(--muted)">Anteil Verbrauch</span><span style="color:${g.netzVerlustRatioPct < 5 ? '#4caf50' : g.netzVerlustRatioPct < 10 ? '#f9a825' : '#e53935'};font-weight:bold">${g.netzVerlustRatioPct.toFixed(1)} %</span>
    </div>` : ''}
    <div class="geb-actions">
      ${!g.polygon ? `<button class="btn-xs blue" data-click="startDraw(${g.id})">&#9998; Zeichnen</button>` : ''}
      ${g.polygon ? '<button class="btn-xs purple" data-click="flyTo(' + g.id + ')">&#8982;</button>' : ''}
      <button class="btn-xs" data-click="togglePlanPanel(${g.id})" title="Planung & Sanierung">🔧 Planen</button>
      <button class="btn-xs" data-click="startNetzEdgeFrom(${g.id})" title="Leitung von diesem Gebäude zeichnen" style="border-color:#e53935;color:#e53935;">⛕+</button>
      ${netzEdges.some(e => e.u === g.id || e.v === g.id) ? `<button class="btn-xs red" data-click="abklemmenGebaeude(${g.id})" title="Alle Netzleitungen entfernen">⛕✕</button>` : ''}
      <button class="btn-xs" data-click="openFotoPanel('gebaeude', ${g.id})" title="Fotos verwalten" style="border-color:#4fc3f7;color:#4fc3f7;">📷${(g.photoIds && g.photoIds.length) ? ` ${g.photoIds.length}` : ''}</button>
      <button class="btn-xs" data-click="removeGebaeude(${g.id})" title="Löschen" style="margin-left:auto">&#10005;</button>
    </div>
    ${activeVariantId !== null ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--border);">
      <button class="btn-xs ${ausgeschlossen ? 'green' : ''}" style="${ausgeschlossen ? '' : 'border-color:#f9a825;color:#f9a825;'}" data-click="toggleAusschluss(${g.id})">
        ${ausgeschlossen ? '↩ Wieder anschließen' : '⊗ In Variante abkoppeln'}
      </button>
    </div>` : ''}
    <div class="plan-panel" id="plan-${g.id}">
      <div style="font-size:10px; color:var(--accent); margin-bottom:8px;">Lebenszyklus & Sanierung</div>
      <select class="inp-field" style="margin-bottom:8px;" data-change="changePlanMode(${g.id}, this.value)">
        <option value="">Aktion wählen...</option>
        <option value="neubau">Neubau planen</option>
        <option value="sanierung">Sanierung planen</option>
        <option value="abriss">Abriss planen</option>
      </select>
      <div id="plan-mode-neubau-${g.id}" style="display:none; gap:5px; margin-bottom:8px; align-items:center;">
        <input type="number" id="inp-neubau-${g.id}" placeholder="Baujahr (z.B. 2030)" class="inp-field" style="flex:1">
        <button class="btn-xs green" data-click="savePlan(${g.id}, 'neubau')">Speichern</button>
      </div>
      <div id="plan-mode-sanierung-${g.id}" style="display:none; gap:5px; margin-bottom:8px; align-items:center;">
        <input type="number" id="inp-san-jahr-${g.id}" placeholder="Jahr" class="inp-field" style="width:45px; flex:1">
        <input type="number" id="inp-san-spez-${g.id}" placeholder="Ziel kWh/m²a" class="inp-field" style="width:85px; flex:1">
        <button class="btn-xs green" data-click="savePlan(${g.id}, 'sanierung')">Speichern</button>
      </div>
      <div id="plan-mode-abriss-${g.id}" style="display:none; gap:5px; margin-bottom:8px; align-items:center;">
        <input type="number" id="inp-abriss-${g.id}" placeholder="Abrissjahr" class="inp-field" style="flex:1">
        <button class="btn-xs red" data-click="savePlan(${g.id}, 'abriss')">Speichern</button>
      </div>
      <div id="san-list-${g.id}" style="margin-top:4px; font-size:11px; color:var(--text); display:flex; flex-direction:column; gap:2px;">
        ${planItems.join('')}
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);margin-top:8px;cursor:pointer;" title="Verhindert, dass dieses Gebäude beim Wechsel des Bezugsjahres automatisch ans Bestandsnetz angeschlossen wird">
        <input type="checkbox" ${g.nichtAmNetz ? 'checked' : ''} data-change="toggleGebNichtAmNetz(${g.id})" style="accent-color:var(--accent);">
        Nicht automatisch ans Netz anschließen
      </label>
    </div>
  </div>`;
}

export function toggleGebNichtAmNetz(id) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  g.nichtAmNetz = !g.nichtAmNetz;
}

export function _rerenderCard(id) {
  const card = document.getElementById('card-' + id);
  if (!card) return;
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  const stats = getComputedStats(g, globalYear);
  const isExpanded = _expandedIds.has(id);
  const ausgeschlossen = isExcluded(g.id);
  const cls = ['geb-card'];
  if (g.polygon) cls.push(g.fromOsm ? 'osm' : 'drawn');
  if (selectedId === id) cls.push('selected');
  if (ausgeschlossen) cls.push('ausgeschlossen');
  card.className = cls.join(' ');
  card.innerHTML = _renderCompactRow(g, stats, isExpanded) +
                   (isExpanded ? _renderExpandedPanel(g, stats) : '');
}

export function toggleGebExpand(id) {
  if (_expandedIds.has(id)) {
    _expandedIds.delete(id);
  } else {
    _expandedIds.add(id);
  }
  highlightCard(id);
  _rerenderCard(id);
}

export function renderList(){
  populateZentraleSelect();
  if (typeof updateLpGebietStatus === 'function') updateLpGebietStatus();
  const el=document.getElementById('geb-list');el.innerHTML='';
  window.gebaeude.forEach(g=>{
    const stats = getComputedStats(g, globalYear);
    const card=document.createElement('div');
    const ausgeschlossen = isExcluded(g.id);
    const cls=['geb-card'];
    if(g.polygon) cls.push(g.fromOsm?'osm':'drawn');
    if(selectedId===g.id) cls.push('selected');
    if(ausgeschlossen) cls.push('ausgeschlossen');
    card.className=cls.join(' ');
    card.id = 'card-' + g.id;
    const isExpanded = _expandedIds.has(g.id);
    card.innerHTML = _renderCompactRow(g, stats, isExpanded) +
                     (isExpanded ? _renderExpandedPanel(g, stats) : '');
    el.appendChild(card);
  });
  updateTotals();
}

export function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export function escVal(v){return v!=null&&v!==''?v:'';}
export function flyTo(id){const g=window.gebaeude.find(x=>x.id===id);if(g?.polygonLayer)map.flyToBounds(g.polygonLayer.getBounds(),{padding:[40,40]});}

export function _buildProjectData() {
  return {
    version: 1,
    gebaeude: window.gebaeude.map(g => ({
      id: g.id, name: g.name, waerme: g.waerme, heizlast: g.heizlast, spez: g.spez, spezHeizlast: g.spezHeizlast,
      flaeche: g.flaeche, nutzung: g.nutzung, fromOsm: g.fromOsm, osmId: g.osmId, polygon: g.polygon,
      baujahr: g.baujahr, baujährQuelle: g.baujährQuelle || null, abrissjahr: g.abrissjahr, sanierungen: g.sanierungen,
      stockwerke: g.stockwerke || 1, waermeManual: g.waermeManual || false, heizlastManual: g.heizlastManual || false,
      pvAktiv: g.pvAktiv || false, pvDachanteil: g.pvDachanteil || 30, zustand: g.zustand || '',
      strom: g.strom || '', spezStrom: g.spezStrom || '', stromProfil: g.stromProfil || 'auto',
      nichtAmNetz: g.nichtAmNetz || false,
      photoIds: g.photoIds || [],
    })),
    netz: {
      zentrale: document.getElementById('netz-zentrale').value,
      vl: document.getElementById('netz-vl').value,
      rl: document.getElementById('netz-rl').value,
      v: document.getElementById('netz-v').value,
      tAussen: document.getElementById('netz-t-aussen').value,
      tMittel: document.getElementById('netz-t-mittel').value,
      uWert: document.getElementById('netz-u-wert').value,
      planJahr: document.getElementById('netz-plan-jahr').value,
      planVl: document.getElementById('netz-plan-vl').value,
      planRl: document.getElementById('netz-plan-rl').value,
      isLocked: networkLocked,
      kostenSzenario: kostenSzenario,
      sanierung: window._netzSanierung || false,
      sanierungPct: parseFloat(document.getElementById('netz-sanierung-pct')?.value) || 40,
      gzfMethode: document.getElementById('netz-gzf-methode')?.value || 'richtwert',
      gzfManuell: parseFloat(document.getElementById('netz-gzf-manuell')?.value) || 0.6
    },
    trasse: trassePoints.map(p => ({lat: p.lat, lng: p.lng})),
    trasseSegments: trasseSegments,
    customEdges: netzEdges.filter(e => e.u < 10000 && e.v < 10000).map(e => ({u: e.u, v: e.v, pruned: e.pruned || false})),
    edgeWaypoints: edgeWaypoints,
    fliessgewaesser: fliessgewaesser ? { latlngs: fliessgewaesser.latlngs, durchflussLs: fliessgewaesser.durchflussLs, leistungKw: fliessgewaesser.leistungKw, jaz: fliessgewaesser.jaz, visible: fliessgewaesserVisible } : null,
    lwWp: lwWp ? { lat: lwWp.lat, lng: lwWp.lng, leistungKw: lwWp.leistungKw, lwaDb: lwWp.lwaDb, jaz: parseFloat(document.getElementById('lwwp-jaz').value)||3.0, waerme: document.getElementById('lwwp-waerme').value, minCop: document.getElementById('lwwp-min-cop')?.value || '', visible: lwWpVisible } : null,
    geoThermie: geoThermie ? { ...geoThermie, heizlast: document.getElementById('geo-heizlast').value, waerme: document.getElementById('geo-waerme').value, jaz: parseFloat(document.getElementById('geo-jaz').value)||4.5, tiefe: parseFloat(document.getElementById('geo-tiefe').value)||100, qPerM: parseFloat(document.getElementById('geo-q-perm').value)||50, abstand: parseFloat(document.getElementById('geo-abstand').value)||10, dtAbsenkung: parseFloat(document.getElementById('geo-dt-absenkung').value)||0 } : null,
    gasKessel: gasKessel ? { leistungKw: gasKessel.leistungKw, eta: document.getElementById('gk-eta').value, waerme: document.getElementById('gk-waerme').value } : null,
    heizoelKessel: heizoelKessel ? { leistungKw: heizoelKessel.leistungKw, eta: document.getElementById('hko-eta').value, waerme: document.getElementById('hko-waerme').value } : null,
    bhkw: bhkw ? { leistungThKw: parseFloat(document.getElementById('bhkw-leistung-th').value)||100, skz: document.getElementById('bhkw-skz').value, eta: document.getElementById('bhkw-eta').value, waerme: document.getElementById('bhkw-waerme').value } : null,
    stromkessel: stromkessel ? { leistungKw: parseFloat(document.getElementById('sk-leistung').value)||200, eta: document.getElementById('sk-eta').value, waerme: document.getElementById('sk-waerme').value } : null,
    solarthermie: solarthermieAktiv ? { flaeche: parseFloat(document.getElementById('st-flaeche')?.value)||0, spez: parseFloat(document.getElementById('st-spez')?.value)||400, polygon: window._stPolygon || null } : null,
    waermespeicher: thermSpeicherAktiv ? { typ: document.getElementById('ts-typ')?.value||'puffer', volumen: parseFloat(document.getElementById('ts-volumen')?.value)||0, dt: parseFloat(document.getElementById('ts-dt')?.value)||40, verlust: parseFloat(document.getElementById('ts-verlust')?.value)||0.5, entladeKw: parseFloat(document.getElementById('ts-entlade-kw')?.value)||200 } : null,
    freiflaechen: freiflaechen.map(ff => ({ id: ff.id, name: ff.name, polygon: ff.polygon, flaeche: ff.flaeche, gcr: ff.gcr, ausrichtung: ff.ausrichtung })),
    pvModul: { breite: document.getElementById('pv-modul-breite')?.value, laenge: document.getElementById('pv-modul-laenge')?.value, wp: document.getElementById('pv-modul-wp')?.value },
    pvPanel: { kwp: document.getElementById('pv-kwp')?.value, spez: document.getElementById('pv-spez')?.value, ausrichtung: document.getElementById('pv-ausrichtung')?.value, quartierMwh: document.getElementById('strom-quartier-mwh')?.value, strompreis: document.getElementById('strom-preis-bezug')?.value, einspeisung: document.getElementById('strom-preis-einsp')?.value, leistungspreis: document.getElementById('strom-leistungspreis')?.value },
    meritOrderKeys: [...window.meritOrderKeys],
    pelletsKessel: pelletsKessel ? { leistungKw: pelletsKessel.leistungKw, eta: document.getElementById('pk-eta').value, waerme: document.getElementById('pk-waerme').value, lat: pelletsKessel.lat, lng: pelletsKessel.lng } : null,
    heizhackschnitzel: heizhackschnitzel ? { leistungKw: heizhackschnitzel.leistungKw, eta: document.getElementById('hhs-eta').value, waerme: document.getElementById('hhs-waerme').value, lat: heizhackschnitzel.lat, lng: heizhackschnitzel.lng } : null,
    fernwaerme: fernwaerme ? { leistungKw: fernwaerme.leistungKw, waerme: document.getElementById('fw-waerme').value, co2f: document.getElementById('fw-co2f').value, lat: fernwaerme.lat, lng: fernwaerme.lng } : null,
    heizoelEmF: heizoelEmF, gasEmF: gasEmF,
    pelletsEmF: pelletsEmF, hhsEmF: hhsEmF, fernwaermeEmF: fernwaermeEmF,
    stromEmF: stromEmF, stromEmFLZ: stromEmFLZ,
    pefStrom: pefStrom, pefWP: pefWP, pefGas: pefGas, pefHeizoel: pefHeizoel,
    pefPellets: pefPellets, pefHhs: pefHhs, pefFernwaerme: pefFernwaerme,
    wirtBausteineOverrides: window._wirtBausteineOverrides || {},
    wirtVdiOverrides: window._wirtVdiOverrides || {},
    wirtPctSettings: window._wirtPctSettings || {},
    varianten: varianten,
    activeVariantId: activeVariantId,
    baseNetzSnapshot: baseNetzSnapshot,
    baseErzeugerSnapshot: baseErzeugerSnapshot,
    baseKostenSnapshot: baseKostenSnapshot,
    baseHiddenAutoSnapshot: baseHiddenAutoSnapshot,
    baseInvOverridesSnapshot: baseInvOverridesSnapshot,
    baseVdiOverridesSnapshot: baseVdiOverridesSnapshot,
    stromNetz: {
      nodes: stromNodes.filter(n => n.type !== 'geb' && n.type !== 'erzeuger' && n.type !== 'junction').map(n => ({
        id: n.id, type: n.type, lat: n.lat, lng: n.lng, label: n.label,
        maxKva: n.maxKva, ratedKva: n.ratedKva, ukPct: n.ukPct
      })),
      edges: stromEdges.filter(e => {
        const skip = ['geb', 'erzeuger', 'junction'];
        const un = stromNodes.find(n => n.id === e.u);
        const vn = stromNodes.find(n => n.id === e.v);
        return (!un || !skip.includes(un.type)) || (!vn || !skip.includes(vn.type));
      }).map(e => ({
        u: e.u, v: e.v, cableType: e.cableType, crossSection: e.crossSection, autoSized: e.autoSized
      })),
      kabelTyp: document.getElementById('strom-kabel-typ')?.value || 'NAYY'
    },
    // ── Phase-3-System (neu): Assets, Trassen, Strom-Leitungen, Szenarien ──
    // Runtime-Felder (_marker, _poly, _result, _editMarkers) werden bewusst weggelassen
    // — die werden beim Restore vom Renderer neu erzeugt.
    // IIFE-Build-Sicherung: ASSETS/STROMNETZ über window-Fallback (gleiches Pattern wie _loadProject).
    ...(function(){
      const _ASSETS = (typeof ASSETS !== 'undefined') ? ASSETS : window.ASSETS;
      const _STROMNETZ = (typeof STROMNETZ !== 'undefined') ? STROMNETZ : window.STROMNETZ;
      return {
        assetsNew: _ASSETS ? {
          items: _ASSETS.items.map(a => ({
            id: a.id, type: a.type, domain: a.domain, lat: a.lat, lng: a.lng,
            name: a.name, buildingId: a.buildingId, props: a.props || {},
            baujahr: a.baujahr, abrissjahr: a.abrissjahr,
            massnahmen: a.massnahmen || [],
          })),
          edges: _ASSETS.edges.map(e => ({
            id: e.id, domain: e.domain, aId: e.aId, bId: e.bId,
            route: e.route || [], qs: e.qs, parallelCount: e.parallelCount,
            baujahr: e.baujahr, abrissjahr: e.abrissjahr,
            massnahmen: e.massnahmen || [], sicherungA: e.sicherungA || null,
          })),
          selectedId: _ASSETS.selectedId,
        } : { items: [], edges: [], selectedId: null },
        stromnetzNew: _STROMNETZ ? {
          trassen: _STROMNETZ.trassen.map(t => ({ id: t.id, pts: t.pts })),
          szenarien: _STROMNETZ.szenarien,
          aktivSzenario: _STROMNETZ.aktivSzenario,
          napProfiles: _STROMNETZ.napProfiles || {},
          napSelectedId: _STROMNETZ.napSelectedId || null,
        } : { trassen: [], szenarien: [], aktivSzenario: null, napProfiles: {}, napSelectedId: null },
      };
    })(),
    // Fotos werden nicht hier eingebunden — _buildProjectDataWithPhotos
    // ist async und sammelt sie aus dem Storage ein.
  };
}

// Async-Variante mit Fotos eingebettet — für JSON-Export.
// Autosave (localStorage) nutzt _buildProjectData() OHNE Fotos, weil das JSON sonst
// das localStorage-Limit sprengt (5–10 MB). Fotos sind separat im Storage-Layer
// (IndexedDB/localStorage/RAM) auto-persistiert.
export async function _buildProjectDataWithPhotos() {
  const data = _buildProjectData();
  try {
    data.fotos = await exportPhotosForProject();
  } catch (e) {
    console.warn('Foto-Export fehlgeschlagen:', e);
    data.fotos = [];
  }
  return data;
}

export async function exportJSON(){
  // Async: Fotos aus Storage einbetten (1–3 Sek bei vielen Fotos)
  const project = await _buildProjectDataWithPhotos();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liegenschaft_projekt.json';
  a.click();
  // Reminder zurücksetzen: Fotos sind jetzt im Backup
  resetUngespeichertReminder();
}

export function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const project = JSON.parse(e.target.result);
      _loadProject(project);
      showHint('Projekt erfolgreich geladen.');
      setTimeout(hideHint, 3000);
    } catch (err) {
      showHint('Fehler beim Laden der Datei.');
      console.error(err);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

export function _loadProject(project, _opts) {
      _loadProjectInner(project, _opts);
}
function _loadProjectInner(project, _opts) {
      window.gebaeude.forEach(g => {
        if(g.polygonLayer) map.removeLayer(g.polygonLayer);
        if(g.circleMarker) map.removeLayer(g.circleMarker);
        if(g.labelMarker) map.removeLayer(g.labelMarker);
      });
      // In-place clearen statt reassignen — sonst halten ES-Module-Imports
      // (z.B. `gebaeude` in 02c-karte-werkzeuge.js) den alten Array-Reference
      // und updateViz operiert auf einem leeren Array → keine Polygone/Marker.
      // Gleiches Pattern wie removeGebaeude (siehe Memo zum Live-Binding).
      window.gebaeude.length = 0;
      clearNetz();
      clearTrasse();
      clearFliessgewaesser();
      clearLwWp();
      clearGasKessel();
      clearStromkessel();
      clearHeizoelKessel();
      clearPellets();
      clearHhs();
      clearFernwaerme();
      clearSolarthermie();
      clearThermSpeicher();
      idCounter = 1;

      if (project.gebaeude) {
         _batchImporting = true;
         try { project.gebaeude.forEach(g => {
            const newG = addGebaeude({ id: g.id, coords: g.polygon, name: g.name, fromOsm: g.fromOsm, osmId: g.osmId });
            newG.waerme = g.waerme;
            newG.heizlast = g.heizlast;
            newG.spez = g.spez;
            newG.spezHeizlast = g.spezHeizlast;
            newG.flaeche = g.flaeche;
            newG.baujahr = g.baujahr;
            newG.abrissjahr = g.abrissjahr;
            newG.sanierungen = g.sanierungen || [];
            newG.nutzung = g.nutzung || '';
            newG.stockwerke = g.stockwerke || 1;
            newG.waermeManual = g.waermeManual || false;
            newG.heizlastManual = g.heizlastManual || false;
            newG.strom = g.strom || '';
            newG.spezStrom = g.spezStrom || '';
            newG.stromProfil = g.stromProfil || 'auto';
            newG.pvAktiv = g.pvAktiv || false;
            newG.pvDachanteil = g.pvDachanteil || 30;
            newG.zustand = g.zustand || '';
            newG.nichtAmNetz = g.nichtAmNetz || false;
            if (g.id >= idCounter) idCounter = g.id + 1;
         });
         } finally { _batchImporting = false; }
      }

      if (project.netz) {
         document.getElementById('netz-vl').value = project.netz.vl || 90;
         document.getElementById('netz-rl').value = project.netz.rl || 60;
         syncVLTemps('netz');
         document.getElementById('netz-v').value = project.netz.v || 1.0;
         document.getElementById('netz-t-aussen').value = project.netz.tAussen ?? -12;
         document.getElementById('netz-t-mittel').value = project.netz.tMittel ?? 10;
         document.getElementById('netz-u-wert').value = project.netz.uWert || 0.25;
         if (project.netz.gzfMethode) {
           document.getElementById('netz-gzf-methode').value = project.netz.gzfMethode;
           document.getElementById('netz-gzf-manuell-wrap').style.display = project.netz.gzfMethode === 'manuell' ? '' : 'none';
         }
         if (project.netz.gzfManuell != null) document.getElementById('netz-gzf-manuell').value = project.netz.gzfManuell;
         document.getElementById('netz-plan-jahr').value = project.netz.planJahr || '';
         document.getElementById('netz-plan-vl').value = project.netz.planVl || '';
         document.getElementById('netz-plan-rl').value = project.netz.planRl || '';

         if (project.netz.kostenSzenario) {
           kostenSzenario = project.netz.kostenSzenario;
           document.getElementById('kosten-szenario').value = kostenSzenario;
         }

         populateZentraleSelect();
         document.getElementById('netz-zentrale').value = project.netz.zentrale || '';

         if (project.netz.isLocked && !networkLocked) {
             toggleNetworkLock();
         } else if (!project.netz.isLocked && networkLocked) {
             toggleNetworkLock();
         }
         if (project.netz.sanierung) {
           window._netzSanierung = true;
           const cb = document.getElementById('netz-sanierung-toggle');
           if (cb) cb.checked = true;
           const det = document.getElementById('netz-sanierung-detail');
           if (det) det.style.display = 'flex';
         }
         if (project.netz.sanierungPct) {
           const inp = document.getElementById('netz-sanierung-pct');
           if (inp) inp.value = project.netz.sanierungPct;
         }
      }

      if (project.trasse && project.trasse.length > 0) {
         trassePoints = project.trasse.map(p => L.latLng(p.lat, p.lng));
         trasseSegments = project.trasseSegments || [];
         trasseCurrentSegStart = trassePoints.length;
         redrawTrasse();
      }

      edgeWaypoints = project.edgeWaypoints || {};
      const _prunedMap = {};
      if (project.customEdges) {
         project.customEdges.forEach(e => { if (e.pruned) _prunedMap[edgeKey(e.u, e.v)] = true; });
         project.customEdges.forEach(e => addNetzEdge(e.u, e.v));
      }
      if (project.netz && project.netz.zentrale) {
         autoGenerateNetz();
      }
      // Restore pruned state
      if (Object.keys(_prunedMap).length > 0) {
        netzEdges.forEach(e => {
          if (_prunedMap[edgeKey(e.u, e.v)]) { e.pruned = true; applyEdgePrunedStyle(e); }
        });
        recalcNetz();
        updatePruningSummary();
      }

      if (project.fliessgewaesser && project.fliessgewaesser.latlngs && project.fliessgewaesser.latlngs.length >= 2) {
        fliessgewaesser = {
          latlngs: project.fliessgewaesser.latlngs,
          durchflussLs: project.fliessgewaesser.durchflussLs || 50,
          leistungKw: project.fliessgewaesser.leistungKw || 200,
          jaz: project.fliessgewaesser.jaz || 4.5,
          visible: project.fliessgewaesser.visible !== false
        };
        fliessgewaesserVisible = fliessgewaesser.visible;
        document.getElementById('fg-visible').checked = fliessgewaesserVisible;
        document.getElementById('fg-durchfluss').value = fliessgewaesser.durchflussLs;
        document.getElementById('fg-leistung').value = fliessgewaesser.leistungKw;
        document.getElementById('fg-jaz').value = fliessgewaesser.jaz;
        document.getElementById('fg-draw-section').style.display = 'none';
        document.getElementById('fg-data-section').style.display = 'block';
        redrawFliessgewaesser();
        updateFliessgewaesserVisibility();
      }

    if (project.lwWp && project.lwWp.lat != null && project.lwWp.lng != null) {
        lwWp = { lat: project.lwWp.lat, lng: project.lwWp.lng, leistungKw: project.lwWp.leistungKw || 12, lwaDb: project.lwWp.lwaDb || 80, visible: project.lwWp.visible !== false };
        lwWpVisible = lwWp.visible;
        document.getElementById('lwwp-visible').checked = lwWpVisible;
        document.getElementById('lwwp-leistung').value = lwWp.leistungKw;
        document.getElementById('lwwp-lwa').value = lwWp.lwaDb;
        if (project.lwWp.jaz) document.getElementById('lwwp-jaz').value = project.lwWp.jaz;
        if (project.lwWp.waerme) document.getElementById('lwwp-waerme').value = project.lwWp.waerme;
        if (project.lwWp.minCop) document.getElementById('lwwp-min-cop').value = project.lwWp.minCop;
        document.getElementById('lwwp-data-section').style.display = 'block';
        redrawLwWp(); updateLwWpDisplay(); updateLwWpVisibility();
      }
      if (project.geoThermie && project.geoThermie.lat != null) {
        if (!geoLayerGroup) geoLayerGroup = L.layerGroup().addTo(map);
        geoThermie = { ...project.geoThermie };
        document.getElementById('geo-heizlast').value = project.geoThermie.heizlast || '';
        document.getElementById('geo-waerme').value = project.geoThermie.waerme || '';
        document.getElementById('geo-jaz').value = project.geoThermie.jaz || 4.5;
        document.getElementById('geo-tiefe').value = project.geoThermie.tiefe || 100;
        document.getElementById('geo-q-perm').value = Math.min(60, Math.max(10, project.geoThermie.qPerM || 31));
        document.getElementById('geo-abstand').value = Math.min(15, Math.max(6, project.geoThermie.abstand || 10));
        document.getElementById('geo-lambda').value = Math.min(5, Math.max(0.5, project.geoThermie.lambda || 2.0));
        document.getElementById('geo-guetegrad').value = Math.min(0.70, Math.max(0.20, project.geoThermie.guetegrad || 0.50));
        if (project.geoThermie.dtAbsenkung != null) document.getElementById('geo-dt-absenkung').value = project.geoThermie.dtAbsenkung;
        document.getElementById('btn-place-geo').textContent = 'Position verschieben';
        calcGeoThermie(); redrawGeo();
      }

      if (project.gasKessel) {
        gasKessel = { leistungKw: project.gasKessel.leistungKw || 500 };
        document.getElementById('gk-leistung').value = gasKessel.leistungKw;
        if (project.gasKessel.eta)      document.getElementById('gk-eta').value      = project.gasKessel.eta;
        if (project.gasKessel.waerme)   document.getElementById('gk-waerme').value   = project.gasKessel.waerme;
        document.getElementById('btn-activate-gaskessel').style.display = 'none';
        document.getElementById('gaskessel-data-section').style.display = 'block';
        redrawGasKessel(); updateGasKesselDisplay();
      }
      if (project.heizoelKessel) {
        heizoelKessel = { leistungKw: project.heizoelKessel.leistungKw || 500 };
        document.getElementById('hko-leistung').value = heizoelKessel.leistungKw;
        if (project.heizoelKessel.eta)      document.getElementById('hko-eta').value      = project.heizoelKessel.eta;
        if (project.heizoelKessel.waerme)   document.getElementById('hko-waerme').value   = project.heizoelKessel.waerme;
        document.getElementById('btn-activate-heizoel').style.display = 'none';
        document.getElementById('heizoel-data-section').style.display = 'block';
        redrawHeizoelKessel(); updateHeizoelDisplay();
      }
      if (project.bhkw) {
        bhkw = { leistungThKw: project.bhkw.leistungThKw || 100 };
        document.getElementById('bhkw-leistung-th').value = bhkw.leistungThKw;
        if (project.bhkw.skz)     document.getElementById('bhkw-skz').value     = project.bhkw.skz;
        if (project.bhkw.eta)     document.getElementById('bhkw-eta').value     = project.bhkw.eta;
        if (project.bhkw.waerme)  document.getElementById('bhkw-waerme').value  = project.bhkw.waerme;
        document.getElementById('btn-activate-bhkw').style.display = 'none';
        document.getElementById('bhkw-data-section').style.display = 'block';
        moBeiAktivierung('bhkw'); updateBhkwDisplay();
      }
      if (project.stromkessel) {
        stromkessel = { leistungKw: project.stromkessel.leistungKw || 200 };
        document.getElementById('sk-leistung').value = stromkessel.leistungKw;
        if (project.stromkessel.eta)    document.getElementById('sk-eta').value    = project.stromkessel.eta;
        if (project.stromkessel.waerme) document.getElementById('sk-waerme').value = project.stromkessel.waerme;
        document.getElementById('btn-activate-stromkessel').style.display = 'none';
        document.getElementById('stromkessel-data-section').style.display = 'block';
        moBeiAktivierung('stromkessel'); updateStromkesselDisplay();
      }
      if (project.solarthermie) {
        document.getElementById('st-flaeche').value = project.solarthermie.flaeche || 0;
        document.getElementById('st-spez').value = project.solarthermie.spez || 400;
        solarthermieAktiv = (project.solarthermie.flaeche || 0) > 0;
        if (project.solarthermie.polygon && project.solarthermie.polygon.length >= 3) {
          window._stPolygon = project.solarthermie.polygon;
          _attachSTLayer(project.solarthermie.polygon);
          const srcEl = document.getElementById('st-flaeche-src');
          if (srcEl) srcEl.textContent = '(aus Karte)';
        }
        updateSolarthermieDisplay();
        document.getElementById('solarthermie-panel').style.display = 'block';
      }
      if (project.waermespeicher) {
        document.getElementById('ts-typ').value = project.waermespeicher.typ || 'puffer';
        document.getElementById('ts-volumen').value = project.waermespeicher.volumen || 0;
        document.getElementById('ts-dt').value = project.waermespeicher.dt || 40;
        document.getElementById('ts-verlust').value = project.waermespeicher.verlust || 0.5;
        document.getElementById('ts-entlade-kw').value = project.waermespeicher.entladeKw || 200;
        thermSpeicherAktiv = (project.waermespeicher.volumen || 0) > 0;
        updateThermSpeicherDisplay();
        document.getElementById('therm-speicher-panel').style.display = 'block';
      }
      if (project.freiflaechen && project.freiflaechen.length > 0) {
        project.freiflaechen.forEach(ff => {
          const obj = { id: ff.id, name: ff.name, polygon: ff.polygon, flaeche: ff.flaeche, gcr: ff.gcr !== undefined ? ff.gcr : 35, ausrichtung: ff.ausrichtung || 'sued' };
          freiflaechen.push(obj);
          if (obj.id >= ffCounter) ffCounter = obj.id + 1;
          attachFFLayer(obj);
        });
        renderFFPanel();
      }
      if (project.pvModul) {
        if (project.pvModul.breite) document.getElementById('pv-modul-breite').value = project.pvModul.breite;
        if (project.pvModul.laenge) document.getElementById('pv-modul-laenge').value = project.pvModul.laenge;
        if (project.pvModul.wp)     document.getElementById('pv-modul-wp').value     = project.pvModul.wp;
      }
      if (project.pvPanel) {
        if (project.pvPanel.kwp)          { const el = document.getElementById('pv-kwp');             if (el) el.value = project.pvPanel.kwp; }
        if (project.pvPanel.spez)         { const el = document.getElementById('pv-spez');            if (el) el.value = project.pvPanel.spez; }
        if (project.pvPanel.ausrichtung) { const el = document.getElementById('pv-ausrichtung');     if (el) el.value = project.pvPanel.ausrichtung; }
        if (project.pvPanel.quartierMwh)  { const el = document.getElementById('strom-quartier-mwh'); if (el) el.value = project.pvPanel.quartierMwh; }
        if (project.pvPanel.strompreis)   { const el = document.getElementById('strom-preis-bezug');  if (el) el.value = project.pvPanel.strompreis; _onStrompreisChange('strom-preis-bezug'); }
        if (project.pvPanel.einspeisung)   { const el = document.getElementById('strom-preis-einsp');    if (el) el.value = project.pvPanel.einspeisung; }
        if (project.pvPanel.leistungspreis){ const el = document.getElementById('strom-leistungspreis'); if (el) el.value = project.pvPanel.leistungspreis; }
      }
      if (project.meritOrderKeys) {
        window.meritOrderKeys = project.meritOrderKeys.filter(k => isErzeugerAktiv(k));
      }
      if (project.pelletsKessel) {
        pelletsKessel = { leistungKw: project.pelletsKessel.leistungKw || 300 };
        if (project.pelletsKessel.lat != null) { pelletsKessel.lat = project.pelletsKessel.lat; pelletsKessel.lng = project.pelletsKessel.lng; }
        if (project.pelletsKessel.eta) document.getElementById('pk-eta').value = project.pelletsKessel.eta;
        if (project.pelletsKessel.waerme) document.getElementById('pk-waerme').value = project.pelletsKessel.waerme;
        document.getElementById('btn-activate-pellets').style.display = 'none';
        document.getElementById('pellets-data-section').style.display = 'block';
        redrawPellets(); updatePelletsDisplay();
      }
      if (project.heizhackschnitzel) {
        heizhackschnitzel = { leistungKw: project.heizhackschnitzel.leistungKw || 400 };
        if (project.heizhackschnitzel.lat != null) { heizhackschnitzel.lat = project.heizhackschnitzel.lat; heizhackschnitzel.lng = project.heizhackschnitzel.lng; }
        if (project.heizhackschnitzel.eta) document.getElementById('hhs-eta').value = project.heizhackschnitzel.eta;
        if (project.heizhackschnitzel.waerme) document.getElementById('hhs-waerme').value = project.heizhackschnitzel.waerme;
        document.getElementById('btn-activate-hhs').style.display = 'none';
        document.getElementById('hhs-data-section').style.display = 'block';
        redrawHhs(); updateHhsDisplay();
      }
      if (project.fernwaerme) {
        fernwaerme = { leistungKw: project.fernwaerme.leistungKw || 500 };
        if (project.fernwaerme.lat != null) { fernwaerme.lat = project.fernwaerme.lat; fernwaerme.lng = project.fernwaerme.lng; }
        if (project.fernwaerme.waerme) document.getElementById('fw-waerme').value = project.fernwaerme.waerme;
        if (project.fernwaerme.co2f) document.getElementById('fw-co2f').value = project.fernwaerme.co2f;
        document.getElementById('btn-activate-fernwaerme').style.display = 'none';
        document.getElementById('fernwaerme-data-section').style.display = 'block';
        redrawFernwaerme(); updateFernwaermeDisplay();
      }
      // Emissionsfaktoren
      if (project.heizoelEmF) { heizoelEmF = project.heizoelEmF; document.getElementById('heizoel-emf').value = heizoelEmF; }
      if (project.gasEmF)     { gasEmF     = project.gasEmF;     document.getElementById('gas-emf').value      = gasEmF; }
      if (project.pelletsEmF)     { pelletsEmF     = project.pelletsEmF;     document.getElementById('pellets-emf').value      = pelletsEmF; }
      if (project.hhsEmF)         { hhsEmF         = project.hhsEmF;         document.getElementById('hhs-emf').value          = hhsEmF; }
      if (project.fernwaermeEmF)  { fernwaermeEmF  = project.fernwaermeEmF;  document.getElementById('fernwaerme-emf').value   = fernwaermeEmF; }
      if (project.stromEmF)   { stromEmF   = project.stromEmF;   document.getElementById('strom-emf').value    = stromEmF; }
      if (project.stromEmFLZ) { stromEmFLZ = project.stromEmFLZ; document.getElementById('strom-emf-lz').value = stromEmFLZ; }
      if (project.pefStrom      != null) { pefStrom      = project.pefStrom;      document.getElementById('pef-strom').value      = pefStrom; }
      if (project.pefWP         != null) { pefWP         = project.pefWP;         document.getElementById('pef-wp').value         = pefWP; }
      if (project.pefGas        != null) { pefGas        = project.pefGas;        document.getElementById('pef-gas').value        = pefGas; }
      if (project.pefHeizoel    != null) { pefHeizoel    = project.pefHeizoel;    document.getElementById('pef-heizoel').value    = pefHeizoel; }
      if (project.pefPellets    != null) { pefPellets    = project.pefPellets;    document.getElementById('pef-pellets').value    = pefPellets; }
      if (project.pefHhs        != null) { pefHhs        = project.pefHhs;        document.getElementById('pef-hhs').value        = pefHhs; }
      if (project.pefFernwaerme != null) { pefFernwaerme = project.pefFernwaerme; document.getElementById('pef-fernwaerme').value = pefFernwaerme; }
      // Wirtschaftlichkeits-Overrides wiederherstellen
      if (project.wirtBausteineOverrides) window._wirtBausteineOverrides = project.wirtBausteineOverrides;
      if (project.wirtVdiOverrides)       window._wirtVdiOverrides       = project.wirtVdiOverrides;
      if (project.wirtPctSettings)        window._wirtPctSettings        = project.wirtPctSettings;
      // Varianten wiederherstellen
      varianten = project.varianten || [];
      baseNetzSnapshot = project.baseNetzSnapshot || null;
      baseErzeugerSnapshot = project.baseErzeugerSnapshot || null;
      // Phase 4b/5: neue Snapshots — defensive Fallbacks für ältere Saves
      baseKostenSnapshot       = project.baseKostenSnapshot       || [];
      baseHiddenAutoSnapshot   = project.baseHiddenAutoSnapshot   || [];
      baseInvOverridesSnapshot = project.baseInvOverridesSnapshot || project.wirtBausteineOverrides || {};
      baseVdiOverridesSnapshot = project.baseVdiOverridesSnapshot || project.wirtVdiOverrides       || {};
      activeVariantId = null; // Immer mit Basisdaten starten beim Laden
      renderVariantenBar();
      updateVariantBanner();

      // Stromnetz wiederherstellen
      clearStromNetz();
      if (project.stromNetz) {
        if (project.stromNetz.kabelTyp) {
          const ktSel = document.getElementById('strom-kabel-typ');
          if (ktSel) ktSel.value = project.stromNetz.kabelTyp;
        }
        if (project.stromNetz.nodes) {
          project.stromNetz.nodes.forEach(n => {
            addStromNode(n.type, L.latLng(n.lat, n.lng), {
              id: n.id, label: n.label, maxKva: n.maxKva, ratedKva: n.ratedKva, ukPct: n.ukPct
            });
          });
        }
        // Gebäude-Strom-Knoten VOR Kantenwiederherstellung registrieren,
        // damit infra→geb Kanten nicht fehlschlagen (geb-Knoten müssen existieren)
        if (typeof window.gebaeude !== 'undefined') {
          window.gebaeude.forEach(g => {
            if (stromNodes.find(n => n.id === g.id && n.type === 'geb')) return;
            const stromMwh = typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : (parseFloat(g.strom) || 0);
            if (stromMwh <= 0) return;
            const center = g.polygon ? polygonCenter(g.polygon) : null;
            if (!center) return;
            const gebIcon = L.divIcon({ className: '', html: '<div class="strom-icon strom-icon-geb">⚡</div>', iconSize: [14, 14], iconAnchor: [7, 7] });
            const gebMarker = L.marker(center, { icon: gebIcon, interactive: true, zIndexOffset: 2000 });
            gebMarker.bindTooltip(function() {
              const n = stromNodes.find(sn => sn.id === g.id);
              let tt = '<b>' + g.name + '</b> (Strom)';
              if (n && n.peakLoadKw) tt += '<br>Last: ' + n.peakLoadKw.toFixed(1) + ' kW';
              if (n && n.annualMwh) tt += '<br>Verbrauch: ' + n.annualMwh.toFixed(1) + ' MWh/a';
              if (n && n.isProducer) tt += '<br><span style="color:#66bb6a">Einspeiser (PV)</span>';
              return tt;
            }, { sticky: true, className: 'geb-tooltip' });
            gebMarker.on('click', function() { stromNodeClick(g.id); });
            if (stromNetzVisible) gebMarker.addTo(map);
            stromNodes.push({
              id: g.id, type: 'geb', lat: center.lat, lng: center.lng,
              marker: gebMarker, label: g.name, peakLoadKw: 0, annualMwh: 0, isProducer: false
            });
          });
        }
        if (project.stromNetz.edges) {
          project.stromNetz.edges.forEach(se => {
            const edge = addStromEdge(se.u, se.v);
            if (edge) {
              edge.cableType = se.cableType || 'NAYY';
              edge.crossSection = se.crossSection || 0;
              edge.autoSized = se.autoSized !== false;
            }
          });
        }
        recalcStromNetz();
      }

      // ── Phase-3-System (neu) restaurieren ─────────────────────────────────
      // ASSETS.items + ASSETS.edges + STROMNETZ.trassen/szenarien/napProfiles
      // Defensive Zugriff über window (im IIFE-Build sind ES-Imports nicht in
      // jedem Closure-Scope verfügbar, aber main.js expose-t sie auf window).
      const _ASSETS = (typeof ASSETS !== 'undefined') ? ASSETS : window.ASSETS;
      const _STROMNETZ = (typeof STROMNETZ !== 'undefined') ? STROMNETZ : window.STROMNETZ;
      if (_ASSETS) {
        _ASSETS.items.length = 0;
        _ASSETS.edges.length = 0;
        _ASSETS.selectedId = null;
      }
      if (_STROMNETZ) {
        _STROMNETZ.trassen.length = 0;
        _STROMNETZ.szenarien.length = 0;
        _STROMNETZ.aktivSzenario = null;
        _STROMNETZ.napProfiles = {};
        _STROMNETZ.napSelectedId = null;
      }

      if (project.assetsNew && _ASSETS) {
        if (Array.isArray(project.assetsNew.items)) _ASSETS.items.push(...project.assetsNew.items);
        if (Array.isArray(project.assetsNew.edges)) _ASSETS.edges.push(...project.assetsNew.edges);
        _ASSETS.selectedId = project.assetsNew.selectedId || null;
      }
      if (project.stromnetzNew && _STROMNETZ) {
        if (Array.isArray(project.stromnetzNew.trassen)) {
          // Trassen brauchen Runtime-Slots _poly/_editMarkers
          _STROMNETZ.trassen.push(...project.stromnetzNew.trassen.map(t => ({
            id: t.id, pts: t.pts, _poly: null, _editMarkers: [],
          })));
        }
        if (Array.isArray(project.stromnetzNew.szenarien)) {
          _STROMNETZ.szenarien.push(...project.stromnetzNew.szenarien);
        }
        _STROMNETZ.aktivSzenario = project.stromnetzNew.aktivSzenario || null;
        _STROMNETZ.napProfiles   = project.stromnetzNew.napProfiles || {};
        _STROMNETZ.napSelectedId = project.stromnetzNew.napSelectedId || null;
      }

      // Re-Render aller Phase-3-Layer (deferred wegen TDZ in Dev-Modus)
      setTimeout(() => {
        try { redrawAllStromnetz(); } catch (e) { console.warn('redrawAllStromnetz:', e); }
        try { redrawAllAssets();    } catch (e) { console.warn('redrawAllAssets:', e); }
      }, 0);

      // Phase 4 — Fotos importieren (falls im Projekt-JSON enthalten)
      if (Array.isArray(project.fotos) && project.fotos.length > 0) {
        clearAllPhotos()
          .then(() => importPhotosFromProject(project.fotos))
          .then(n => console.log(`Fotos restauriert: ${n}/${project.fotos.length}`))
          .catch(e => console.warn('Foto-Import fehlgeschlagen:', e));
      } else {
        // Auch wenn keine Fotos im Projekt sind: orphan-Cleanup nach Restore
        setTimeout(() => cleanupOrphanPhotos().catch(()=>{}), 200);
      }

      redrawErzeugerIcons();
      _invalidateStats();
      renderList();
      updateViz();
      updateTotals();
      glBerechnenDebounced(800);
      // Karte auf das geladene Gebiet zoomen — außer beim Undo-Restore
      // (da bleibt der View, wo der User gerade war).
      if (!_opts || !_opts.keepUndoStack) {
        try {
          const allLatLngs = [];
          for (const g of (window.gebaeude || [])) {
            if (g.polygon && Array.isArray(g.polygon)) {
              for (const p of g.polygon) {
                const lat = (p.lat ?? p[0]);
                const lng = (p.lng ?? p[1]);
                if (lat != null && lng != null) allLatLngs.push([lat, lng]);
              }
            }
          }
          if (allLatLngs.length > 0 && typeof map !== 'undefined' && map.flyToBounds) {
            map.flyToBounds(L.latLngBounds(allLatLngs), { padding: [40, 40], maxZoom: 18, duration: 1.6 });
          }
        } catch (e) { console.warn('[loadProject] fitBounds fehlgeschlagen:', e); }
      }
      // Frisch geladenes Projekt: Undo-Stack leeren — außer wenn vom Undo
      // selbst getriggert (sonst hätten wir nach 1× Strg+Z keinen Stack mehr).
      if (!_opts || !_opts.keepUndoStack) {
        _undoStack.length = 0;
        _renderUndoBadge();
      }
}

export function loadGebaeudeFromParent(gebaeudeArray) {
  if (!Array.isArray(gebaeudeArray)) return;
  window.gebaeude.forEach(g => {
    if (g.polygonLayer) map.removeLayer(g.polygonLayer);
    if (g.circleMarker) map.removeLayer(g.circleMarker);
    if (g.labelMarker) map.removeLayer(g.labelMarker);
  });
  // In-place clearen (siehe _loadProjectInner) — Reassignment bricht ES-Module-Imports
  window.gebaeude.length = 0;
  clearNetz();
  clearTrasse();
  idCounter = 1;
  gebaeudeArray.forEach(g => {
    const newG = addGebaeude({ id: g.id, coords: g.polygon, name: g.name || 'Gebäude ' + g.id, fromOsm: g.fromOsm || false, osmId: g.osmId || null, stockwerke: g.stockwerke != null ? g.stockwerke : 1, baujahr: g.baujahr || null });
    newG.waerme = g.waerme;
    newG.heizlast = g.heizlast;
    newG.spez = g.spez;
    newG.spezHeizlast = g.spezHeizlast;
    newG.flaeche = g.flaeche;
    newG.baujahr = g.baujahr;
    newG.abrissjahr = g.abrissjahr;
    newG.sanierungen = g.sanierungen || [];
    newG.nutzung = g.nutzung || '';
    if (g.id >= idCounter) idCounter = g.id + 1;
  });
  _invalidateStats();
  renderList();
  updateViz();
  updateTotals();
  showHint('Gebäude aus Liegenschaftsrechner übernommen.');
  setTimeout(hideHint, 2500);
}

export function sendToLiegenschaftsrechner() {
  if (window.parent === window) return;
  const payload = window.gebaeude.map(g => ({
    id: g.id, name: g.name, waerme: g.waerme, heizlast: g.heizlast, spez: g.spez, spezHeizlast: g.spezHeizlast,
    flaeche: g.flaeche, nutzung: g.nutzung, fromOsm: g.fromOsm, osmId: g.osmId, polygon: g.polygon,
    baujahr: g.baujahr, abrissjahr: g.abrissjahr, sanierungen: g.sanierungen || [], stockwerke: g.stockwerke != null ? g.stockwerke : 1
  }));
  window.parent.postMessage({ type: 'ENERGIEKARTE_APPLY_GEBAEUDE', gebaeude: payload }, '*');
  showHint('An Liegenschaftsrechner gesendet.');
  setTimeout(hideHint, 2500);
}

(function initEnergiekarteIframe() {
  if (window.self === window.top) return;
  const btn = document.getElementById('btn-send-to-lr');
  if (btn) btn.style.display = 'block';
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'ENERGIEKARTE_LOAD_BUILDINGS') return;
    if (Array.isArray(e.data.gebaeude)) loadGebaeudeFromParent(e.data.gebaeude);
  });
  setTimeout(function() { window.parent.postMessage({ type: 'ENERGIEKARTE_READY' }, '*'); }, 800);
})();

let _hintTimer = null;
export function showHint(msg, autoHideMs){
  const h=document.getElementById('hint');
  h.textContent=msg;
  h.classList.remove('hidden');
  // Auto-Hide: vorherigen Timer abbrechen, neuen setzen wenn ms > 0
  if (_hintTimer) { clearTimeout(_hintTimer); _hintTimer = null; }
  if (autoHideMs && autoHideMs > 0) {
    _hintTimer = setTimeout(() => { h.classList.add('hidden'); _hintTimer = null; }, autoHideMs);
  }
}
export function hideHint(){document.getElementById('hint').classList.add('hidden');}

export const sty=document.createElement('style');
sty.textContent=`.geb-tooltip{background:#0f1117;border:1px solid #2a3050;color:#e8eaf0;font-family:'DM Sans',sans-serif;font-size:12px;padding:6px 10px;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.5);font-weight:normal;}`;
document.head.appendChild(sty);

export let dashOffset = 0;
export let _animPipesRunning = false;
export function animatePipes() {
  if (!_animPipesRunning) return;
  dashOffset -= 0.5;
  netzEdges.forEach(e => {
    if(e.load > 0 && e.layer && e.layer._path) {
      e.layer._path.style.strokeDasharray = "12, 12";
      e.layer._path.style.strokeDashoffset = dashOffset + "px";
    }
  });
  requestAnimationFrame(animatePipes);
}
export function startAnimPipes() { if (!_animPipesRunning) { _animPipesRunning = true; animatePipes(); } }
export function stopAnimPipes()  { _animPipesRunning = false; }

export let stromDashOffset = 0;
export let _animStromRunning = false;
export function animateStromPipes() {
  if (!_animStromRunning) return;
  stromDashOffset -= 0.6;
  stromEdges.forEach(e => {
    if (e._flowActive && e.layer && e.layer._path) {
      e.layer._path.style.strokeDashoffset = (stromDashOffset * e._flowDir) + 'px';
    }
  });
  requestAnimationFrame(animateStromPipes);
}
export function startAnimStrom() { if (!_animStromRunning) { _animStromRunning = true; animateStromPipes(); } }
export function stopAnimStrom()  { _animStromRunning = false; }

// ── Undo-Stack (Variante B: 5 Schritte FIFO) ─────────────────────────────
// Snapshot-basiert: vor jeder größeren mutierenden Aktion wird der komplette
// Projekt-State serialisiert auf einen Stack gepusht. Bei Strg+Z wird der
// letzte Snapshot via _loadProject zurückgespielt.
const _UNDO_MAX = 5;
const _undoStack = [];

export function pushUndoSnapshot(label) {
  try {
    const snapshot = _buildProjectData();
    _undoStack.push({ label: label || 'Aktion', snapshot, ts: Date.now() });
    while (_undoStack.length > _UNDO_MAX) _undoStack.shift();
    _renderUndoBadge();
  } catch (e) {
    console.warn('[Undo] Snapshot fehlgeschlagen:', e);
  }
}

export function undoLastAction() {
  if (_undoStack.length === 0) {
    showHint('↩ Nichts mehr rückgängig zu machen', 2500);
    return;
  }
  const entry = _undoStack.pop();
  try {
    _loadProject(entry.snapshot, { keepUndoStack: true });
    showHint('↩ Rückgängig: ' + entry.label, 3000);
  } catch (e) {
    console.error('[Undo] Restore fehlgeschlagen:', e);
    showHint('⚠ Rückgängig fehlgeschlagen — siehe Konsole', 5000);
  } finally {
    _renderUndoBadge();
  }
}

export function _undoStackSize() { return _undoStack.length; }

// Optionales Status-Badge (zeigt Anzahl der rückgängig-machbaren Schritte)
function _renderUndoBadge() {
  const el = document.getElementById('undo-badge');
  if (!el) return;
  if (_undoStack.length === 0) {
    el.style.display = 'none';
  } else {
    el.style.display = '';
    const last = _undoStack[_undoStack.length - 1];
    el.textContent = `↩ ${_undoStack.length}× Strg+Z`;
    el.title = 'Letzte Aktion: ' + last.label + ' — Strg+Z (oder Cmd+Z) zum Rückgängig-Machen';
  }
}



// ── Sichere Window-Exposition (IIFE-Build-Robustheit) ────────────────────
if (typeof window !== 'undefined') {
  window.pushUndoSnapshot = pushUndoSnapshot;
  window.undoLastAction = undoLastAction;
  window.toggleGebNichtAmNetz = toggleGebNichtAmNetz;
  window.showHint = showHint;
  window.hideHint = hideHint;
  window._buildProjectData = _buildProjectData;
  window._loadProject = _loadProject;
}

// ── Globaler Strg+Z / Cmd+Z für Undo (Variante B: 5-Schritt-Stack) ──
// Listener hier registrieren (statt main.js), damit er auch im Single-File-Build
// aktiv ist. main.js wird beim IIFE-Build nicht mit aufgenommen.
if (typeof window !== 'undefined' && !window._undoKeyListenerRegistered) {
  window._undoKeyListenerRegistered = true;
  window.addEventListener('keydown', e => {
    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
    if (!isUndo) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (typeof window.undoLastAction === 'function') window.undoLastAction();
  });
}
