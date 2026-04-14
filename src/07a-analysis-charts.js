// 07a-analysis-charts.js — Visualization tabs: Lastgang, JDL, Woche, VL/COP, Metriken, Auslegung, Energiesplit, Heatmap, Small Multiples
// Split from 07-analysis-views.js

// ── Tab state ──────────────────────────────────────────────────────────────
import { CalcEngine } from './08-calc-engine.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';

export let saCurrentTab = 'lastgang';

// ── Farben aus ERZEUGER_CFG (nach dem Laden geladen) + Fallbacks ──────────
export const DA_COLORS_FALLBACK = {
  lwwp:'#66bb6a', fg:'#29b6f6', geo:'#a1887f',
  fernwaerme:'#e53935', pellets:'#ff7043', hhs:'#8d6e63',
  heizoel:'#455a64', gaskessel:'#78909c',
  bhkw:'#ff8f00', stromkessel:'#ff69b4',
  solarthermie:'#ffab40', _thermSpeicher:'#26a69a',
  _autoGk:'#78909c',
  _residual:'#f9a825',
};
export const DA_LABELS = {
  lwwp:'Luft-WP', fg:'Flusswasser-WP', geo:'Geo-WP',
  fernwaerme:'Fernwärme', pellets:'Pelletkessel', hhs:'Hackschnitzel',
  heizoel:'Heizölkessel', gaskessel:'Gaskessel',
  bhkw:'BHKW/KWK', stromkessel:'Stromkessel',
  solarthermie:'Solarthermie', _thermSpeicher:'Wärmespeicher',
  _autoGk:'Gaskessel (auto)', _residual:'Nicht gedeckt',
};
// Farbe immer aus ERZEUGER_CFG holen (Konsistenz mit Karte), Fallback falls noch nicht init
// ── Logo-Balken an aktiven Energiemix anpassen ──────────────────────────
export function _updateLogoBars() {
  const wrap = document.querySelector('.logo-bars');
  if (!wrap) return;
  const keys = window._dispatchActiveKeys || [];
  const en   = window._dispatchEnergy || {};
  if (!keys.length) return; // Keine Daten → Standard beibehalten

  // MWh pro Erzeuger sammeln (nur mit nennenswertem Beitrag)
  const items = [];
  keys.forEach(k => {
    const mwh = en[k]?.waermeMwh || 0;
    if (mwh > 0.01) items.push({ k, mwh, color: _daColor(k) });
  });
  if (!items.length) return;

  // Sortieren nach MWh absteigend
  items.sort((a, b) => b.mwh - a.mwh);
  // Max 6 Balken
  const show = items.slice(0, 6);
  const maxMwh = show[0].mwh;

  wrap.innerHTML = show.map(it => {
    const pct = Math.max(25, Math.round(it.mwh / maxMwh * 100));
    return `<span style="background:${it.color};height:${pct}%" title="${(DA_LABELS[it.k] || it.k)}: ${it.mwh.toFixed(0)} MWh"></span>`;
  }).join('');
}

export function _daColor(k) {
  return (typeof ERZEUGER_CFG !== 'undefined' && ERZEUGER_CFG[k]?.color)
    || DA_COLORS_FALLBACK[k] || '#aaa';
}

// ── Zoom-Zustand ──────────────────────────────────────────────────────────
export let _daZoom = { startH: 0, endH: 8760 };
export let _daRubber = null; // { x0, x1 } während Drag

// ── Tab-Umschaltung ───────────────────────────────────────────────────────
export function saSetTab(name) {
  saCurrentTab = name;
  ['lastgang','jdl','woche','tempvl','metriken','dim','split','optimierung','sensitivitaet'].forEach(n => {
    document.getElementById(`sa-tab-btn-${n}`)?.classList.toggle('active', n === name);
    document.getElementById(`sa-tab-${n}`)?.classList.toggle('active', n === name);
  });
  if (name === 'lastgang') { _lgRenderCurrentView(); }
  if (name === 'jdl')      daRenderJdl();
  if (name === 'woche')    daRenderWoche();
  if (name === 'tempvl')   daRenderTempVL();
  if (name === 'metriken') daRenderMetriken();
  if (name === 'dim')      dimRender();
  if (name === 'split')    splitRender();
  if (name === 'sensitivitaet') { if (typeof runSensitivitaet === 'function') runSensitivitaet(); }
}

// ── Lastgang Sub-Views ──────────────────────────────────────────────────
export let _lgCurrentView = '8760';

export function _lgSetView(mode) {
  _lgCurrentView = mode;
  ['8760','kalender','monate'].forEach(v => {
    document.getElementById('lg-view-' + v)?.classList.toggle('active', v === mode);
    const w = document.getElementById('lg-wrap-' + v);
    if (w) w.style.display = v === mode ? '' : 'none';
  });
  // Zoom controls only for 8760
  const zl = document.getElementById('da-zoom-label');
  const zr = document.getElementById('da-zoom-reset');
  if (zl) zl.style.display = mode === '8760' ? '' : 'none';
  if (zr && mode !== '8760') zr.style.display = 'none';
  _lgRenderCurrentView();
}

export function _lgRenderCurrentView() {
  if (_lgCurrentView === '8760')     daRenderLastgang();
  else if (_lgCurrentView === 'kalender') _daRenderHeatmap();
  else if (_lgCurrentView === 'monate')   _daRenderMultiples();
}

// ── Calendar Heatmap ────────────────────────────────────────────────────
export function _daRenderHeatmap() {
  const canvas = document.getElementById('da-heatmap-canvas');
  if (!canvas) return;
  const W = canvas.parentElement?.clientWidth || canvas.offsetWidth || 700;
  canvas.width = W;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const { hourly, keys, lg } = _daGetData();
  if (!keys.length || !window._dispatchHourly) {
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Erst Grundlagen berechnen.', 20, H / 2);
    return;
  }

  // Aggregate to daily totals (kWh/Tag)
  const nDays = 365;
  const daily = new Float32Array(nDays);
  let dMax = 0;
  for (let d = 0; d < nDays; d++) {
    let sum = 0;
    for (let h = d * 24; h < (d + 1) * 24 && h < lg.length; h++) {
      sum += (lg[h] || 0);
    }
    daily[d] = sum; // kWh (1h steps)
    if (sum > dMax) dMax = sum;
  }
  if (dMax < 1) dMax = 1;

  const pad = { top: 24, right: 20, bottom: 32, left: 32 };
  const cols = 53, rows = 7, cellGap = 2;
  const availW = W - pad.left - pad.right;
  const availH = H - pad.top - pad.bottom;
  const cellSize = Math.min(
    (availW - (cols - 1) * cellGap) / cols,
    (availH - (rows - 1) * cellGap) / rows
  );
  const gridW = cols * cellSize + (cols - 1) * cellGap;
  const gridH = rows * cellSize + (rows - 1) * cellGap;
  const ox = pad.left + (availW - gridW) / 2;
  const oy = pad.top + (availH - gridH) / 2;

  function heatColor(v) {
    if (v < 0.5) {
      const t = v / 0.5;
      return `rgb(${Math.round(30 + t * 200)},${Math.round(100 + t * 100)},${Math.round(60 - t * 40)})`;
    } else {
      const t = (v - 0.5) / 0.5;
      return `rgb(${Math.round(230 - t * 10)},${Math.round(200 - t * 130)},${Math.round(20 - t * 10)})`;
    }
  }

  // Day labels
  ctx.fillStyle = '#78909c'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
  const dayLabels = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  for (let r = 0; r < 7; r++) {
    if (r % 2 === 0) ctx.fillText(dayLabels[r], ox - 5, oy + r * (cellSize + cellGap) + cellSize / 2 + 3);
  }

  // Month labels
  const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  ctx.textAlign = 'center'; ctx.fillStyle = '#78909c'; ctx.font = '9px system-ui';
  monthStarts.forEach((d, mi) => {
    const wk = Math.floor(d / 7);
    ctx.fillText(monthNames[mi], ox + wk * (cellSize + cellGap) + cellSize / 2, oy - 6);
  });

  // Cells
  for (let d = 0; d < nDays; d++) {
    const wk = Math.floor(d / 7), dow = d % 7;
    const x = ox + wk * (cellSize + cellGap);
    const y = oy + dow * (cellSize + cellGap);
    const cr = Math.min(2, cellSize * 0.2);
    ctx.fillStyle = heatColor(daily[d] / dMax);
    ctx.beginPath();
    ctx.moveTo(x + cr, y); ctx.lineTo(x + cellSize - cr, y);
    ctx.quadraticCurveTo(x + cellSize, y, x + cellSize, y + cr);
    ctx.lineTo(x + cellSize, y + cellSize - cr);
    ctx.quadraticCurveTo(x + cellSize, y + cellSize, x + cellSize - cr, y + cellSize);
    ctx.lineTo(x + cr, y + cellSize);
    ctx.quadraticCurveTo(x, y + cellSize, x, y + cellSize - cr);
    ctx.lineTo(x, y + cr);
    ctx.quadraticCurveTo(x, y, x + cr, y);
    ctx.fill();
  }

  // Legend bar
  const legW = 100, legH = 8;
  const lx = ox + gridW - legW;
  const ly = oy + gridH + 12;
  ctx.fillStyle = '#78909c'; ctx.font = '8px system-ui';
  ctx.textAlign = 'right'; ctx.fillText('0', lx - 4, ly + 7);
  for (let i = 0; i < legW; i++) {
    ctx.fillStyle = heatColor(i / legW);
    ctx.fillRect(lx + i, ly, 1, legH);
  }
  ctx.fillStyle = '#78909c'; ctx.textAlign = 'left';
  ctx.fillText(Math.round(dMax) + ' kWh', lx + legW + 4, ly + 7);
}

// ── Small Multiples (12 Monate × 24h Tagesprofil) ──────────────────────
export function _daRenderMultiples() {
  const canvas = document.getElementById('da-multiples-canvas');
  if (!canvas) return;
  const W = canvas.parentElement?.clientWidth || canvas.offsetWidth || 700;
  canvas.width = W;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const { hourly, keys, lg } = _daGetData();
  if (!keys.length || !window._dispatchHourly) {
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Erst Grundlagen berechnen.', 20, H / 2);
    return;
  }

  const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const MHOURS = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
  const nCols = 6, nRows = 2;
  const pad = { top: 6, right: 10, bottom: 10, left: 10 };
  const gap = 8;
  const cellW = (W - pad.left - pad.right - (nCols - 1) * gap) / nCols;
  const cellH = (H - pad.top - pad.bottom - (nRows - 1) * gap) / nRows;

  // Build average hourly profile per month per key
  let globalMax = 0;
  const monthData = [];
  for (let m = 0; m < 12; m++) {
    const h0 = MHOURS[m], h1 = MHOURS[m + 1];
    const nDays = Math.round((h1 - h0) / 24);
    const profile = {}; // key -> [24 avg values]
    keys.forEach(k => { profile[k] = new Float32Array(24); });
    for (let d = 0; d < nDays; d++) {
      for (let hr = 0; hr < 24; hr++) {
        const t = h0 + d * 24 + hr;
        if (t >= h1) break;
        keys.forEach(k => { profile[k][hr] += (hourly[k]?.[t] || 0) / nDays; });
      }
    }
    // Find max stacked value for this month
    for (let hr = 0; hr < 24; hr++) {
      let s = 0;
      keys.forEach(k => { s += profile[k][hr]; });
      if (s > globalMax) globalMax = s;
    }
    monthData.push(profile);
  }
  if (globalMax < 1) globalMax = 1;

  for (let m = 0; m < 12; m++) {
    const col = m % nCols, row = Math.floor(m / nCols);
    const ox2 = pad.left + col * (cellW + gap);
    const oy2 = pad.top + row * (cellH + gap);
    const profile = monthData[m];

    // Background
    ctx.fillStyle = '#23262f';
    const cr = 4;
    ctx.beginPath();
    ctx.moveTo(ox2 + cr, oy2); ctx.lineTo(ox2 + cellW - cr, oy2);
    ctx.quadraticCurveTo(ox2 + cellW, oy2, ox2 + cellW, oy2 + cr);
    ctx.lineTo(ox2 + cellW, oy2 + cellH - cr);
    ctx.quadraticCurveTo(ox2 + cellW, oy2 + cellH, ox2 + cellW - cr, oy2 + cellH);
    ctx.lineTo(ox2 + cr, oy2 + cellH);
    ctx.quadraticCurveTo(ox2, oy2 + cellH, ox2, oy2 + cellH - cr);
    ctx.lineTo(ox2, oy2 + cr);
    ctx.quadraticCurveTo(ox2, oy2, ox2 + cr, oy2);
    ctx.fill();

    // Title
    ctx.fillStyle = '#e8eaf0'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(months[m], ox2 + 6, oy2 + 13);

    const pL = 6, pT = 18, pR = 4, pB = 4;
    const pw = cellW - pL - pR, ph = cellH - pT - pB;
    function xP(hr) { return ox2 + pL + (hr / 23) * pw; }
    function yP(v) { return oy2 + pT + ph - (v / globalMax) * ph; }

    // Stacked areas (bottom to top, draw top first)
    const stacked = [];
    for (let hr = 0; hr < 24; hr++) {
      const st = {}; let cum = 0;
      keys.forEach(k => { cum += profile[k][hr]; st[k] = cum; });
      stacked.push(st);
    }

    for (let ki = keys.length - 1; ki >= 0; ki--) {
      const k = keys[ki];
      const prevK = ki > 0 ? keys[ki - 1] : null;
      ctx.fillStyle = _daColor(k) + '88';
      ctx.beginPath();
      ctx.moveTo(xP(0), yP(stacked[0][k]));
      for (let hr = 1; hr < 24; hr++) ctx.lineTo(xP(hr), yP(stacked[hr][k]));
      if (prevK) {
        for (let hr = 23; hr >= 0; hr--) ctx.lineTo(xP(hr), yP(stacked[hr][prevK]));
      } else {
        for (let hr = 23; hr >= 0; hr--) ctx.lineTo(xP(hr), yP(0));
      }
      ctx.closePath(); ctx.fill();
    }

    // Baseline
    ctx.strokeStyle = '#333844'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(ox2 + pL, oy2 + pT + ph); ctx.lineTo(ox2 + pL + pw, oy2 + pT + ph); ctx.stroke();
  }

  // Legend
  const legEl = document.getElementById('da-multiples-legend');
  if (legEl) {
    legEl.innerHTML = keys.map(k =>
      `<span style="display:inline-flex;align-items:center;gap:3px;">` +
      `<span style="width:8px;height:8px;border-radius:1px;background:${_daColor(k)};"></span>` +
      `<span style="color:var(--muted);">${DA_LABELS[k] || k}</span></span>`
    ).join('');
  }
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────
export function _daGetData() {
  const hourly = window._dispatchHourly || {};
  const keys   = window._dispatchActiveKeys || [];
  const ss     = window.systemState;
  const lg     = ss?.lastgangKw || new Float32Array(8760);
  const tempH  = ss?.tempH || null;
  return { hourly, keys, lg, tempH };
}

export function _daSetupCanvas(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const W = canvas.parentElement?.clientWidth || canvas.offsetWidth || 700;
  if (W < 10) return null;
  canvas.width  = W;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, canvas.height);
  return { canvas, ctx, W, H: canvas.height };
}

export function _daLegend(elId, keys, showResidual) {
  const el = document.getElementById(elId);
  if (!el) return;
  // Wenn gaskessel + _autoGk beide aktiv: nur einen Gaskessel-Eintrag zeigen
  const hasManualGk = keys.includes('gaskessel');
  const items = keys
    .filter(k => !(k === '_autoGk' && hasManualGk)) // _autoGk bei manuellem GK nicht extra auflisten
    .map(k => {
      const label = (k === 'gaskessel' && keys.includes('_autoGk'))
        ? 'Gaskessel (teil-auto)'  // manuell + auto zusammen
        : (DA_LABELS[k] || k);
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:10px;">
        <span style="width:10px;height:10px;border-radius:2px;background:${_daColor(k)};display:inline-block;"></span>
        ${label}</span>`;
    });
  if (showResidual) items.push(
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:10px;">
      <span style="width:10px;height:10px;border-radius:2px;background:${DA_COLORS_FALLBACK._residual};display:inline-block;"></span>
      Nicht gedeckt</span>`
  );
  el.innerHTML = items.join('');
}

export function _daMaxArr(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

export function _daNoData(ctx, W, H) {
  ctx.fillStyle = '#888';
  ctx.font = '12px sans-serif';
  ctx.fillText('Noch keine Berechnung vorhanden', 20, H / 2);
}

// ── Monatslinien ─────────────────────────────────────────────────────────
export const MONATSH = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760];
export const MONAT_LABELS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

export function _daMonatLinien(ctx, W, H, n) {
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  MONATSH.forEach((h,i) => {
    const x = Math.round(h / n * W);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    if (i < 12) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '9px sans-serif';
      const nx = Math.round(MONATSH[i+1] / n * W);
      ctx.fillText(MONAT_LABELS[i], x + 2, H - 3);
    }
  });
}

// ── Zoom-Hilfsfunktionen ──────────────────────────────────────────────────
export function _daZoomLabel(startH, endH) {
  const MONATE = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const MHOURS = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760];
  function hToStr(h) {
    let m = 0;
    for (let i = 0; i < 12; i++) if (h >= MHOURS[i]) m = i;
    const d = Math.floor((h - MHOURS[m]) / 24) + 1;
    return `${MONATE[m]} ${d}.`;
  }
  const span = endH - startH;
  if (span >= 8700) return 'Gesamtjahr';
  return `${hToStr(startH)} – ${hToStr(endH)}  (${Math.round(span/24)} Tage)`;
}

export function _daUpdateZoomLabel() {
  const el = document.getElementById('da-zoom-label');
  if (el) el.textContent = _daZoomLabel(_daZoom.startH, _daZoom.endH);
  const btnEl = document.getElementById('da-zoom-reset');
  if (btnEl) btnEl.style.display = (_daZoom.endH - _daZoom.startH < 8700) ? 'inline-block' : 'none';
}

export function daZoomReset() {
  _daZoom = { startH: 0, endH: 8760 };
  _daUpdateZoomLabel();
  daRenderLastgang();
}

// ── Tab: Lastgang (gestapelter Canvas, mit Rubber-Band-Zoom) ─────────────
export function daRenderLastgang() {
  const r = _daSetupCanvas('da-canvas');
  if (!r) return;
  const { canvas, ctx, W, H } = r;
  const { hourly, keys, lg } = _daGetData();
  const nTotal = lg.length || 8760;

  if (!keys.length) { _daNoData(ctx, W, H); return; }
  if (!window._dispatchHourly) {
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Stunden-Lastgang verfügbar nach', 20, H/2 - 8);
    ctx.fillText('Grundlagen-Berechnung (📋)', 20, H/2 + 8);
    return;
  }

  // Zoom-Fenster
  const startH = Math.max(0, _daZoom.startH);
  const endH   = Math.min(nTotal, _daZoom.endH);
  const nVis   = endH - startH;
  if (nVis < 1) return;

  // Y-Skalierung: max innerhalb des Zoom-Fensters
  let pMax = 0;
  for (let t = startH; t < endH; t++) if ((lg[t]||0) > pMax) pMax = lg[t];
  if (pMax < 1) pMax = 1;

  const hPerPx = nVis / W;

  for (let x = 0; x < W; x++) {
    const t0 = startH + Math.floor(x * hPerPx);
    const t1 = Math.min(endH, startH + Math.floor((x + 1) * hPerPx) || t0 + 1);
    const cnt = t1 - t0 || 1;

    const avg = {};
    let lgAvg = 0;
    keys.forEach(k => { avg[k] = 0; });
    for (let t = t0; t < t1; t++) {
      keys.forEach(k => { avg[k] += (hourly[k]?.[t] || 0); });
      lgAvg += (lg[t] || 0);
    }
    keys.forEach(k => { avg[k] /= cnt; });
    lgAvg /= cnt;

    const dispSum = keys.reduce((s, k) => s + avg[k], 0);
    const trueResidual = Math.max(0, lgAvg - dispSum);

    let yBase = H;
    keys.forEach(k => {
      const h = (avg[k] / pMax) * H;
      if (h < 0.3) return;
      ctx.fillStyle = _daColor(k);
      ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
      yBase -= h;
    });
    // Echte Unterdeckung (nur wenn kein Auto-GK)
    if (trueResidual > 0.1) {
      const h = (trueResidual / pMax) * H;
      ctx.fillStyle = DA_COLORS_FALLBACK._residual;
      ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
    }
  }

  // Monats-/Tageslinien je nach Zoom-Level
  _daZeitlinien(ctx, W, H, startH, endH, nVis);

  // Y-Achsen-Hilfslinien
  ctx.font = '9px monospace';
  [25, 50, 75, 100].forEach(pct => {
    const y = H - (pct / 100) * H;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(Math.round(pMax * pct / 100) + ' kW', 4, y - 2);
  });

  _daLegend('da-legend', keys, false);
  _daUpdateZoomLabel();
  _daBindEvents(canvas, hourly, keys, lg, pMax, nTotal, W, H, startH, endH);
}

// Zeitlinien: Monate bei >30 Tagen Sicht, sonst Tage, sonst Stunden
export function _daZeitlinien(ctx, W, H, startH, endH, nVis) {
  const MHOURS = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760];
  const MLABELS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  ctx.lineWidth = 1;
  ctx.font = '9px sans-serif';

  if (nVis > 24 * 30) {
    // Monatslinien
    MHOURS.forEach((mh, i) => {
      if (mh < startH || mh > endH) return;
      const x = Math.round((mh - startH) / nVis * W);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (i < 12 && mh >= startH) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText(MLABELS[i], x + 2, H - 3);
      }
    });
  } else if (nVis > 24) {
    // Tageslinien
    const d0 = Math.floor(startH / 24), d1 = Math.ceil(endH / 24);
    for (let d = d0; d <= d1; d++) {
      const mh = d * 24;
      if (mh < startH || mh > endH) continue;
      const x = Math.round((mh - startH) / nVis * W);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      const doy = d + 1;
      ctx.fillText(`Tag ${doy}`, x + 2, H - 3);
    }
  } else {
    // Stundenlinien
    for (let hh = startH; hh <= endH; hh++) {
      const x = Math.round((hh - startH) / nVis * W);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if ((hh % 6) === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillText(`${hh%24}:00`, x + 2, H - 3);
      }
    }
  }
}

// ── Mouse-Events: Tooltip + Rubber-Band-Zoom ──────────────────────────────
export function _daBindEvents(canvas, hourly, keys, lg, pMax, nTotal, W, H, startH, endH) {
  const nVis = endH - startH;
  const tip  = document.getElementById('da-tooltip');

  function hAtX(x) {
    return Math.min(endH - 1, Math.max(startH, Math.round(startH + x / W * nVis)));
  }

  canvas.onmousedown = (e) => {
    if (e.button !== 0) return;
    _daRubber = { x0: e.offsetX, x1: e.offsetX };
    canvas.style.cursor = 'crosshair';
  };

  canvas.onmousemove = (e) => {
    const x = e.offsetX;

    if (_daRubber) {
      // Rubber-Band: Canvas neu zeichnen + Rechteck-Overlay
      _daRubber.x1 = x;
      // Tooltip ausblenden während Drag
      if (tip) tip.style.display = 'none';
      // Rechteck zeichnen (ohne alles neu zu rendern für Performance)
      // Einfacher Ansatz: transparentes Overlay auf ImageData
      const x0 = Math.min(_daRubber.x0, _daRubber.x1);
      const x1 = Math.max(_daRubber.x0, _daRubber.x1);
      // Nur das Rubber-Band-Overlay zeichnen (Chart bleibt)
      ctx.clearRect(0, 0, W, H);
      // Chart neu malen (ohne Event-Rebind)
      _daDrawChart(ctx, hourly, keys, lg, W, H, startH, endH, nVis, pMax);
      _daZeitlinien(ctx, W, H, startH, endH, nVis);
      // Overlay
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, 0, x1 - x0, H);
      // Label der Selektion
      const h0 = hAtX(x0), h1 = hAtX(x1);
      if (h1 > h0 + 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px monospace';
        ctx.fillText(_daZoomLabel(h0, h1), x0 + 4, 14);
      }
      return;
    }

    // Tooltip
    if (!tip) return;
    const t   = hAtX(x);
    const doy = Math.floor(t / 24) + 1;
    const hr  = t % 24;
    let html  = `<b>${doy}. Tag, ${hr}:00 Uhr</b><br>`;
    let sum   = 0;
    keys.forEach(k => {
      const v = hourly[k]?.[t] || 0;
      if (v > 0.5) {
        html += `<span style="color:${_daColor(k)}">${DA_LABELS[k]||k}: ${v.toFixed(0)} kW</span><br>`;
        sum += v;
      }
    });
    const res = Math.max(0, (lg[t]||0) - sum);
    if (res > 0.5) html += `<span style="color:${DA_COLORS_FALLBACK._residual}">Nicht gedeckt: ${res.toFixed(0)} kW</span><br>`;
    html += `<b>Gesamt: ${(lg[t]||0).toFixed(0)} kW</b>`;
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = (x > W * 0.65 ? x - tip.offsetWidth - 8 : x + 10) + 'px';
    tip.style.top  = '8px';
  };

  canvas.onmouseup = (e) => {
    if (!_daRubber) return;
    const x0 = Math.min(_daRubber.x0, e.offsetX);
    const x1 = Math.max(_daRubber.x0, e.offsetX);
    _daRubber = null;
    canvas.style.cursor = 'crosshair';
    if (x1 - x0 > 8) {
      // Zoom anwenden
      const h0 = Math.round(startH + x0 / W * nVis);
      const h1 = Math.round(startH + x1 / W * nVis);
      if (h1 - h0 >= 2) {
        _daZoom = { startH: h0, endH: h1 };
        daRenderLastgang();
        return;
      }
    }
    // Kein ausreichender Drag → neu rendern (Rubber-Band entfernen)
    daRenderLastgang();
  };

  canvas.onmouseleave = () => {
    _daRubber = null;
    if (tip) tip.style.display = 'none';
    canvas.style.cursor = 'crosshair';
  };

  canvas.ondblclick = () => { daZoomReset(); };
}

// Nur Chart zeichnen (ohne Events, für Rubber-Band-Overlay)
export function _daDrawChart(ctx, hourly, keys, lg, W, H, startH, endH, nVis, pMax) {
  for (let x = 0; x < W; x++) {
    const t0  = startH + Math.floor(x * nVis / W);
    const t1  = Math.min(endH, startH + Math.floor((x + 1) * nVis / W) || t0 + 1);
    const cnt = t1 - t0 || 1;
    const avg = {};
    let lgAvg = 0;
    keys.forEach(k => { avg[k] = 0; });
    for (let t = t0; t < t1; t++) {
      keys.forEach(k => { avg[k] += (hourly[k]?.[t] || 0); });
      lgAvg += (lg[t] || 0);
    }
    keys.forEach(k => { avg[k] /= cnt; });
    lgAvg /= cnt;
    let yBase = H;
    keys.forEach(k => {
      const h = (avg[k] / pMax) * H;
      if (h < 0.3) return;
      ctx.fillStyle = _daColor(k);
      ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
      yBase -= h;
    });
    const res = Math.max(0, lgAvg - keys.reduce((s,k) => s + avg[k], 0));
    if (res > 0.1) {
      const h = (res / pMax) * H;
      ctx.fillStyle = DA_COLORS_FALLBACK._residual;
      ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
    }
  }
  // Y-Hilfslinien
  ctx.font = '9px monospace';
  [25,50,75,100].forEach(pct => {
    const y = H - (pct/100)*H;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(Math.round(pMax*pct/100)+' kW', 4, y-2);
  });
}

// ── Tab: Jahresdauerlinie (nach Gesamtlast sortiert) ─────────────────────
export function daRenderJdl() {
  const r = _daSetupCanvas('da-canvas-jdl');
  if (!r) return;
  const { canvas, ctx, W, H } = r;
  let { hourly, keys, lg } = _daGetData();
  const n = lg.length || 8760;

  if (!keys.length) { _daNoData(ctx, W, H); return; }

  // JDL-Modus: kein Stundenprofil → JDL aus Gebäudedaten direkt verwenden
  // _jdlTotal ist bereits sortiert (absteigend) → sorted[] ist Identität
  if (!window._dispatchHourly) {
    if (!window._jdlTotal || !window._jdlStack) { _daNoData(ctx, W, H); return; }
    lg     = window._jdlTotal;
    hourly = window._jdlStack;
    // lg ist bereits absteigend sortiert → sorted[i] = i (kein erneutes Sortieren nötig)
  }

  // Index-Array nach Gesamtlast sortieren (absteigend)
  const sorted = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (lg[b] || 0) - (lg[a] || 0));

  let pMax = _daMaxArr(lg);
  if (pMax < 1) pMax = 1;

  const hPerPx = n / W;

  for (let x = 0; x < W; x++) {
    const i0  = Math.floor(x * hPerPx);
    const i1  = Math.min(n, Math.floor((x + 1) * hPerPx) || i0 + 1);
    const cnt = i1 - i0;
    const avg = {};
    let lgAvg = 0;
    keys.forEach(k => { avg[k] = 0; });
    for (let i = i0; i < i1; i++) {
      const t = sorted[i];
      keys.forEach(k => { avg[k] += (hourly[k]?.[t] || 0); });
      lgAvg += (lg[t] || 0);
    }
    keys.forEach(k => { avg[k] /= cnt; });
    lgAvg /= cnt;

    let yBase = H;
    keys.forEach(k => {
      const h = (avg[k] / pMax) * H;
      if (h < 0.3) return;
      ctx.fillStyle = _daColor(k);
      ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
      yBase -= h;
    });
    const res = Math.max(0, lgAvg - keys.reduce((s, k) => s + avg[k], 0));
    if (res > 0.1) {
      const h = (res / pMax) * H;
      ctx.fillStyle = DA_COLORS_FALLBACK._residual;
      ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
    }
  }

  // X-Achse: Stunden-Labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '9px monospace';
  [2000, 4000, 6000, 8000].forEach(h => {
    const x = Math.round(h / n * W);
    ctx.fillText(h + 'h', x + 2, H - 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  });

  // KPIs in individuelle Elemente schreiben
  const lgArr = Array.from({ length: n }, (_, t) => lg[t] || 0);
  lgArr.sort((a, b) => b - a);
  const p65  = lgArr[Math.floor(n * 0.35)];
  const p90  = lgArr[Math.floor(n * 0.10)];
  const mwh  = lgArr.reduce((s, v) => s + v, 0) / 1000;
  const _kpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  _kpi('da-kpi-pmax',    Math.round(pMax).toLocaleString('de-DE'));
  _kpi('da-kpi-p65',     Math.round(p65).toLocaleString('de-DE'));
  _kpi('da-kpi-p90',     Math.round(p90).toLocaleString('de-DE'));
  _kpi('da-kpi-energie', Math.round(mwh).toLocaleString('de-DE'));
  // T_min aus Temperaturdaten
  const _tempH = window.systemState?.tempH;
  if (_tempH && _tempH.length > 0) {
    let tMin = _tempH[0];
    for (let i = 1; i < _tempH.length; i++) { if (_tempH[i] < tMin) tMin = _tempH[i]; }
    _kpi('da-kpi-tmin', tMin.toFixed(1));
  }

  // Legende
  _daLegend('da-legend-jdl', keys, true);
}

// ── Tab: Kälteste Woche ───────────────────────────────────────────────────
export function daRenderWoche() {
  const r = _daSetupCanvas('da-canvas-woche');
  if (!r) return;
  const { canvas, ctx, W, H } = r;
  const { hourly, keys, lg, tempH } = _daGetData();
  const n   = lg.length || 8760;
  const LEN = 168; // 7 Tage × 24h

  if (!keys.length) { _daNoData(ctx, W, H); return; }

  // Kälteste Woche: CalcEngine oder eigene Suche
  let startH = 0;
  if (tempH && typeof CalcEngine !== 'undefined') {
    startH = CalcEngine.findKaeltesteWoche(tempH);
  } else if (tempH) {
    // Fallback: 168h-Fenster mit niedrigster Durchschnittstemperatur
    let minT = Infinity, minS = 0;
    for (let s = 0; s <= n - LEN; s += 24) {
      let sum = 0;
      for (let i = 0; i < LEN; i++) sum += (tempH[(s + i) % n] || 0);
      if (sum < minT) { minT = sum; minS = s; }
    }
    startH = minS;
  }

  // Y-Skalierung
  let pMax = 0;
  for (let i = 0; i < LEN; i++) {
    const t = (startH + i) % n;
    let tot = keys.reduce((s, k) => s + (hourly[k]?.[t] || 0), 0);
    const total = Math.max(tot, lg[t] || 0);
    if (total > pMax) pMax = total;
  }
  if (pMax < 1) pMax = 1;

  const bw = W / LEN;

  for (let i = 0; i < LEN; i++) {
    const t  = (startH + i) % n;
    const x  = i * bw;
    const bwR = Math.max(1, Math.round(bw));
    let yBase = H;

    keys.forEach(k => {
      const v = hourly[k]?.[t] || 0;
      if (v < 0.3) return;
      const h = (v / pMax) * H;
      ctx.fillStyle = _daColor(k);
      ctx.fillRect(Math.round(x), Math.round(yBase - h), bwR, Math.max(1, Math.ceil(h)));
      yBase -= h;
    });
    const tot = keys.reduce((s, k) => s + (hourly[k]?.[t] || 0), 0);
    const res = Math.max(0, (lg[t] || 0) - tot);
    if (res > 0.3) {
      const h = (res / pMax) * H;
      ctx.fillStyle = DA_COLORS_FALLBACK._residual;
      ctx.fillRect(Math.round(x), Math.round(yBase - h), bwR, Math.max(1, Math.ceil(h)));
    }
  }

  // Tages-Trennlinien + Labels
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  const TAGE = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  for (let d = 0; d <= 7; d++) {
    const x = Math.round(d * 24 * bw);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    if (d < 7) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '9px sans-serif';
      ctx.fillText(TAGE[d], x + 3, 10);
    }
  }

  // Legende
  _daLegend('da-legend-woche', keys, true);

  // Temperaturkurve (SVG)
  const svgEl = document.getElementById('da-svg-temp-woche');
  if (svgEl && tempH) {
    const SW = W, SH = 60;
    svgEl.setAttribute('viewBox', `0 0 ${SW} ${SH}`);
    svgEl.style.width = W + 'px';
    const temps = Array.from({ length: LEN }, (_, i) => tempH[(startH + i) % n] || 0);
    const tMin  = Math.min(...temps), tMax = Math.max(...temps);
    const tRange = (tMax - tMin) || 1;
    const pts = temps.map((tv, i) => {
      const x = (i / (LEN - 1)) * SW;
      const y = SH - 8 - ((tv - tMin) / tRange) * (SH - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svgEl.innerHTML =
      `<polyline points="${pts}" fill="none" stroke="#4fc3f7" stroke-width="1.5" opacity="0.85"/>
       <text x="3" y="12" fill="#4fc3f7" font-size="9">${tMax.toFixed(1)}°C</text>
       <text x="3" y="${SH - 3}" fill="#4fc3f7" font-size="9">${tMin.toFixed(1)}°C</text>`;
  }

}

// ── Tab: VL / COP — Vorlauftemperatur, Außentemperatur, COP über 8760h ───
export function daRenderTempVL() {
  const canvas = document.getElementById('da-canvas-tempvl');
  if (!canvas) return;
  const ss = window.systemState;
  const vlH = ss?.vlH, atH = ss?.tempH;
  const { hourly, keys } = _daGetData();
  const wpElH = window._wpElHourly;
  const showAT = document.getElementById('tempvl-show-at')?.checked;
  const showCOP = document.getElementById('tempvl-show-cop')?.checked;
  const N = 8760;

  const dpr = window.devicePixelRatio || 1;
  const cW = canvas.clientWidth || canvas.parentElement?.clientWidth || 700;
  const cH = 240;
  canvas.width = cW * dpr; canvas.height = cH * dpr;
  canvas.style.width = cW + 'px'; canvas.style.height = cH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cW, cH);

  if (!vlH) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px sans-serif';
    ctx.fillText('Keine VL-Daten — Dispatch ausführen', 10, cH / 2);
    return;
  }

  // Daten sammeln
  const vlArr = new Float32Array(N), atArr = new Float32Array(N), copArr = new Float32Array(N);
  let vlMin = 999, vlMax = -999, atMin = 999, atMax = -999, copMin = 999, copMax = 0;
  for (let t = 0; t < N; t++) {
    const vl = vlH[t] || 0;
    vlArr[t] = vl;
    if (vl < vlMin) vlMin = vl; if (vl > vlMax) vlMax = vl;
    if (showAT && atH) {
      const at = atH[t] || 0;
      atArr[t] = at;
      if (at < atMin) atMin = at; if (at > atMax) atMax = at;
    }
    if (showCOP && wpElH) {
      const wpThKw = keys.filter(k => ['lwwp','fg','geo'].includes(k)).reduce((s,k) => s + (hourly?.[k]?.[t] || 0), 0);
      const wpElKw = wpElH[t] || 0;
      copArr[t] = wpElKw > 0.5 ? wpThKw / wpElKw : 0;
      if (copArr[t] > 0.5 && copArr[t] < copMin) copMin = copArr[t];
      if (copArr[t] > copMax) copMax = copArr[t];
    }
  }

  // Y-Achsen-Logik:
  // - AT+COP beide aktiv: gemeinsame °C-Achse links (VL+AT), COP rechts
  // - nur AT aktiv: VL links, AT rechts (eigene Skalierung)
  // - nur COP aktiv: VL links, COP rechts
  const bothATandCOP = showAT && atH && showCOP && copMax > 0.5;
  const onlyAT = showAT && atH && !(showCOP && copMax > 0.5);
  const hasRightAxis = onlyAT || (showCOP && copMax > 0.5);
  const PAD = { l: 40, r: hasRightAxis ? 40 : 10, t: 10, b: 22 };
  const pW = cW - PAD.l - PAD.r, pH = cH - PAD.t - PAD.b;
  // Linke Achse (°C)
  let tLo = vlMin, tHi = vlMax;
  if (bothATandCOP) { tLo = Math.min(tLo, atMin); tHi = Math.max(tHi, atMax); }
  const tR = (tHi - tLo) || 1;
  function tY(v) { return PAD.t + pH * (1 - (v - tLo) / tR); }
  // AT eigene Achse (nur wenn AT allein rechts)
  const atR = (atMax - atMin) || 1;
  function atY(v) { return PAD.t + pH * (1 - (v - atMin) / atR); }

  // Hintergrund
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(PAD.l, PAD.t, pW, pH);

  // Monats-Trennlinien
  const mStarts = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760];
  const mNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '8px "DM Mono",monospace'; ctx.textAlign = 'center';
  for (let m = 0; m < 12; m++) {
    const x1 = PAD.l + (mStarts[m] / N) * pW;
    const x2 = PAD.l + (mStarts[m+1] / N) * pW;
    ctx.beginPath(); ctx.moveTo(x1, PAD.t); ctx.lineTo(x1, PAD.t + pH); ctx.stroke();
    ctx.fillText(mNames[m], (x1 + x2) / 2, PAD.t + pH + 12);
  }

  // Y-Achse links (°C)
  ctx.fillStyle = bothATandCOP ? 'rgba(255,255,255,0.3)' : 'rgba(239,83,80,0.5)';
  ctx.font = '8px "DM Mono",monospace'; ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const v = tLo + (tR / 5) * i;
    const yy = tY(v);
    ctx.fillText(v.toFixed(0) + '°C', PAD.l - 4, yy + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + pW, yy); ctx.stroke();
  }

  // Downsampling für Performance (max ~700 Punkte)
  const step = Math.max(1, Math.floor(N / pW));

  // AT-Linie (optional)
  if (showAT && atH) {
    const atMapper = bothATandCOP ? tY : atY; // gemeinsame oder eigene Achse
    ctx.beginPath();
    for (let t = 0; t < N; t += step) {
      const x = PAD.l + (t / N) * pW;
      if (t === 0) ctx.moveTo(x, atMapper(atArr[t])); else ctx.lineTo(x, atMapper(atArr[t]));
    }
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.4; ctx.stroke();
    ctx.globalAlpha = 1;

    // Y-Achse rechts (AT °C) — nur wenn AT allein (ohne COP)
    if (onlyAT) {
      ctx.fillStyle = 'rgba(79,195,247,0.5)'; ctx.font = '8px "DM Mono",monospace'; ctx.textAlign = 'left';
      for (let i = 0; i <= 5; i++) {
        const v = atMin + (atR / 5) * i;
        ctx.fillText(v.toFixed(0) + '°C', PAD.l + pW + 4, atY(v) + 3);
      }
    }
  }

  // VL-Linie (linke Y-Achse)
  ctx.beginPath();
  for (let t = 0; t < N; t += step) {
    const x = PAD.l + (t / N) * pW;
    if (t === 0) ctx.moveTo(x, tY(vlArr[t])); else ctx.lineTo(x, tY(vlArr[t]));
  }
  ctx.strokeStyle = '#ef5350'; ctx.lineWidth = 1.2; ctx.stroke();

  // COP-Linie (rechte Y-Achse)
  if (showCOP && copMax > 0.5) {
    if (copMin > 900) copMin = 1;
    const cR = (copMax - copMin) || 1;
    const cY = (v) => PAD.t + pH * (1 - (v - copMin) / cR);

    ctx.beginPath();
    let started = false;
    for (let t = 0; t < N; t += step) {
      const x = PAD.l + (t / N) * pW;
      if (copArr[t] > 0.5) {
        if (!started) { ctx.moveTo(x, cY(copArr[t])); started = true; } else ctx.lineTo(x, cY(copArr[t]));
      }
    }
    ctx.strokeStyle = '#66bb6a'; ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.stroke();
    ctx.globalAlpha = 1;

    // Y-Achse rechts (COP)
    ctx.fillStyle = 'rgba(102,187,106,0.5)'; ctx.font = '8px "DM Mono",monospace'; ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const v = copMin + (cR / 4) * i;
      ctx.fillText(v.toFixed(1), PAD.l + pW + 4, cY(v) + 3);
    }
  }

  // Legende (HTML)
  const legEl = document.getElementById('da-legend-tempvl');
  if (legEl) {
    let lh = '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;height:2px;background:#ef5350;display:inline-block;"></span> Vorlauf °C</span>';
    if (showAT) lh += '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;height:2px;background:#4fc3f7;opacity:0.5;display:inline-block;"></span> Außentemp. °C' + (onlyAT ? ' (rechte Achse)' : '') + '</span>';
    if (showCOP && copMax > 0.5) lh += '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;height:2px;background:#66bb6a;display:inline-block;"></span> COP (rechte Achse)</span>';
    legEl.innerHTML = lh;
  }
}

// ── Tab: Metriken ─────────────────────────────────────────────────────────
export function daRenderMetriken() {
  const wrap = document.getElementById('da-metriken-wrap');
  if (!wrap) return;
  const { hourly, keys, lg } = _daGetData();
  const n = lg.length || 8760;

  if (!keys.length) {
    wrap.innerHTML = '<p style="color:var(--muted);font-size:11px;">Noch keine Berechnung vorhanden.</p>';
    return;
  }

  // JDL-Modus: kein Stundenprofil → Daten aus _dispatchEnergy
  const jdlMode = !window._dispatchHourly;
  const dispEn  = window._dispatchEnergy || {};

  const totalKwh = jdlMode
    ? Object.values(dispEn).reduce((s, e) => s + (e.waermeMwh || 0), 0) * 1000
    : Array.from({ length: n }, (_, t) => lg[t] || 0).reduce((s, v) => s + v, 0);

  const cards = keys.map(k => {
    let kwh, pMax;
    if (!jdlMode) {
      const arr = hourly[k] || new Float32Array(n);
      kwh = 0; pMax = 0;
      for (let t = 0; t < n; t++) { kwh += arr[t]; if (arr[t] > pMax) pMax = arr[t]; }
    } else {
      kwh  = ((dispEn[k] || {}).waermeMwh || 0) * 1000;
      const cfg = ERZEUGER_CFG[k];
      pMax = cfg?.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0;
      if (k === '_autoGk' && window._autoGkResult) pMax = window._autoGkResult.leistungKw || 0;
    }
    const deckP = totalKwh > 0 ? (kwh / totalKwh * 100) : 0;
    const vbh   = pMax > 0 ? Math.round(kwh / pMax) : 0;
    const mwh   = kwh / 1000;
    return `<div style="background:var(--panel);border:1px solid ${_daColor(k)};border-radius:6px;padding:10px;">
      <div style="font-size:11px;font-weight:600;color:${_daColor(k)};margin-bottom:8px;">${DA_LABELS[k]||k}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">
        <div><div style="color:var(--text);font-family:'DM Mono',monospace">${Math.round(mwh).toLocaleString('de-DE')} MWh</div><div style="color:var(--muted)">Wärme/a</div></div>
        <div><div style="color:var(--text);font-family:'DM Mono',monospace">${deckP.toFixed(1)} %</div><div style="color:var(--muted)">Deckung</div></div>
        <div><div style="color:var(--text);font-family:'DM Mono',monospace">${Math.round(pMax).toLocaleString('de-DE')} kW</div><div style="color:var(--muted)">P<sub>max</sub></div></div>
        <div><div style="color:var(--text);font-family:'DM Mono',monospace">${vbh.toLocaleString('de-DE')} h</div><div style="color:var(--muted)">VBH/a</div></div>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${cards}</div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// AUSLEGUNGS-TAB — Leistungs-Deckungs-Kurve mit Schieber
// ══════════════════════════════════════════════════════════════════════════

export let _dimJdlSorted  = null;  // Float32Array, absteigend sortiert
export let _dimCumRight   = null;  // Kumulative Summe von rechts [h] = sum(jdl[h..n-1])
export let _dimTotalEnergy = 0;    // Summe kWh
export let _dimPMax       = 0;     // Spitzenlast kW

export function _dimInit() {
  if (_dimJdlSorted) return true; // Cache gültig
  // Echte Dispatch-Daten bevorzugen, sonst synthetischer Fallback
  const raw = window._dimLastgangKw || window.systemState?.lastgangKw;
  if (!raw || raw.length === 0) { _dimJdlSorted = null; return false; }
  const n = raw.length;
  _dimJdlSorted = Float32Array.from(raw).sort((a, b) => b - a);
  _dimCumRight  = new Float64Array(n + 1);
  for (let h = n - 1; h >= 0; h--) _dimCumRight[h] = _dimCumRight[h + 1] + _dimJdlSorted[h];
  _dimTotalEnergy = _dimCumRight[0];
  _dimPMax        = _dimJdlSorted[0];
  return true;
}

// Stunde (0-based) ab der Last <= pInst: erstes h mit jdl[h] <= pInst
export function _dimHcut(pInst) {
  const jdl = _dimJdlSorted;
  let lo = 0, hi = jdl.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (jdl[m] > pInst) lo = m + 1; else hi = m; }
  return lo;
}

// Gedeckte Energie [kWh] für installierte Leistung pInst
export function _dimEnergy(pInst) {
  const hc = _dimHcut(pInst);
  return pInst * hc + _dimCumRight[hc];
}

// Binärsuche: finde P so dass Deckungsgrad = fraction (0–1)
export function _dimFindP(fraction) {
  const target = fraction * _dimTotalEnergy;
  let lo = 0, hi = _dimPMax;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (_dimEnergy(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function dimOnSlider(val) {
  document.getElementById('dim-slider-val').textContent = Math.round(val).toLocaleString('de-DE') + ' kW';
  dimDraw(val);
}

export function dimRender() {
  if (!_dimInit()) {
    const canvas = document.getElementById('dim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth || 600;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
    ctx.fillText('Erst Dispatch ausführen (Grundlagen berechnen).', 20, canvas.height / 2);
    return;
  }
  // Schieber kalibrieren: max = Spitzenlast, Startwert ca. P_80%
  const slider = document.getElementById('dim-slider');
  if (slider) {
    slider.max   = Math.ceil(_dimPMax);
    slider.value = Math.round(_dimFindP(0.80));
  }
  const val = slider ? +slider.value : _dimPMax * 0.5;
  document.getElementById('dim-slider-val').textContent = Math.round(val).toLocaleString('de-DE') + ' kW';
  dimDraw(val);
}

export function dimDraw(pInst) {
  const canvas = document.getElementById('dim-canvas');
  if (!canvas || !_dimJdlSorted) return;
  canvas.width = canvas.offsetWidth || 600;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  const ML = 52, MB = 22, MT = 10; // Margins left/bottom/top
  const PW = W - ML, PH = H - MB - MT; // Plot-Breite/-Höhe

  const n    = _dimJdlSorted.length;
  const pMax = _dimPMax;

  // Koordinaten-Helfer
  const px = h => ML + (h / n) * PW;
  const py = p => MT + (1 - p / pMax) * PH;

  ctx.clearRect(0, 0, W, H);

  // Hintergrund
  ctx.fillStyle = '#13151f';
  ctx.fillRect(0, 0, W, H);

  // Y-Gitter + Labels
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'right';
  [0, 25, 50, 75, 100].forEach(pct => {
    const p = pMax * pct / 100;
    const y = py(p);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(Math.round(p).toLocaleString('de-DE'), ML - 3, y + 3);
  });

  // X-Gitter + Labels
  ctx.textAlign = 'center';
  [2000, 4000, 6000, 8000].forEach(h => {
    const x = px(h);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, MT); ctx.lineTo(x, H - MB); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(h + ' h', x, H - 5);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('0', px(0), H - 5);
  ctx.fillText('8760 h', px(n), H - 5);

  // Achsenlinien
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ML, MT); ctx.lineTo(ML, H - MB); ctx.lineTo(W, H - MB); ctx.stroke();

  // JDL-Kurve zeichnen (Füllung unter der Kurve)
  ctx.beginPath();
  ctx.moveTo(px(0), py(_dimJdlSorted[0]));
  const step = Math.max(1, Math.floor(n / PW));
  for (let h = 0; h < n; h += step) ctx.lineTo(px(h), py(_dimJdlSorted[h]));
  ctx.lineTo(px(n - 1), py(_dimJdlSorted[n - 1]));
  ctx.lineTo(px(n), py(0));
  ctx.lineTo(px(0), py(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();

  // JDL-Kurve (Linie)
  ctx.beginPath();
  ctx.moveTo(px(0), py(_dimJdlSorted[0]));
  for (let h = 0; h < n; h += step) ctx.lineTo(px(h), py(_dimJdlSorted[h]));
  ctx.lineTo(px(n - 1), py(_dimJdlSorted[n - 1]));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Hilfsfunktion: Kreuzlinien (L-Form) mit Rechteck-Marker ────────────
  function drawCrosshair(pVal, color, label, dashed) {
    if (pVal <= 0 || pVal > pMax) return;
    const hc      = _dimHcut(pVal);
    const eCov    = _dimEnergy(pVal);
    const covPct  = _dimTotalEnergy > 0 ? eCov / _dimTotalEnergy * 100 : 0;
    const vls     = pVal > 0 ? eCov / pVal : 0;

    const xC = px(hc);
    const yC = py(pVal);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.2;
    if (dashed) ctx.setLineDash([5, 4]);
    else        ctx.setLineDash([]);

    // Horizontale Linie: y-Achse → Schnittpunkt
    ctx.beginPath(); ctx.moveTo(ML, yC); ctx.lineTo(xC, yC); ctx.stroke();
    // Vertikale Linie: Schnittpunkt → x-Achse
    ctx.beginPath(); ctx.moveTo(xC, yC); ctx.lineTo(xC, H - MB); ctx.stroke();

    ctx.setLineDash([]);

    // Rechteck-Marker am Schnittpunkt
    const r = 4;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(xC, yC, r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#13151f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(xC, yC, r, 0, 2 * Math.PI); ctx.stroke();

    // Label rechts vom Schnittpunkt (oder links wenn zu nah am Rand)
    ctx.fillStyle = color;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = xC > W * 0.75 ? 'right' : 'left';
    const lx = xC > W * 0.75 ? xC - 8 : xC + 8;
    ctx.fillText(label, lx, yC - 6);
    ctx.font = '9px monospace';
    ctx.fillText(`${covPct.toFixed(1)} % · ${Math.round(vls).toLocaleString('de-DE')} VLh`, lx, yC + 13);

    // P-Label auf y-Achse
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.font = '9px monospace';
    ctx.fillText(Math.round(pVal).toLocaleString('de-DE'), ML - 3, yC - 3);

    // h-Label auf x-Achse
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(hc).toLocaleString('de-DE'), xC, H - MB + 12);

    ctx.restore();
    return { covPct, vls, hc };
  }

  // 65 % Referenzlinie
  const p65  = _dimFindP(0.65);
  drawCrosshair(p65, '#ffd54f', '65 %', true);

  // 90 % Referenzlinie
  const p90  = _dimFindP(0.90);
  drawCrosshair(p90, '#ff8a65', '90 %', true);

  // Schieber-Linie (über den anderen gezeichnet)
  const res = drawCrosshair(pInst, '#4fc3f7', 'P inst', false);

  // KPI-Box aktualisieren
  const kpiBox = document.getElementById('dim-kpi-box');
  if (kpiBox && res) {
    const eCov = _dimEnergy(pInst);
    const covPct = _dimTotalEnergy > 0 ? eCov / _dimTotalEnergy * 100 : 0;
    kpiBox.innerHTML =
      `<div style="color:#4fc3f7;font-weight:bold;">${Math.round(pInst).toLocaleString('de-DE')} kW</div>` +
      `<div>Deckung: <b style="color:#4fc3f7;">${covPct.toFixed(1)} %</b></div>` +
      `<div>VLh: <b>${Math.round(res.vls).toLocaleString('de-DE')} h</b></div>` +
      `<div style="color:var(--muted);font-size:9px;">Gesamt: ${(_dimTotalEnergy/1000).toFixed(0)} MWh/a</div>` +
      `<div style="color:var(--muted);font-size:9px;">P<sub>max</sub>: ${Math.round(pMax).toLocaleString('de-DE')} kW</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ENERGIESPLIT-TAB — Stundenscharf mit Zoom + KW-Schieber
// ══════════════════════════════════════════════════════════════════════════

export let _splitZoom   = { startH: 0, endH: 8760 };
export let _splitRubber = null;

// TWW-Grundlast aus Sommer-Nacht-10%-Quantil (netto nach Verlusten)
export function _splitTwwFloor(lastgangKw, vf) {
  const vals = [];
  for (let h = 0; h < lastgangKw.length; h++) {
    const day = Math.floor(h / 24), hr = h % 24;
    if (day >= 151 && day <= 242 && hr >= 2 && hr <= 5)
      vals.push(lastgangKw[h] * (1 - vf));
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return Math.max(0, vals[Math.floor(vals.length * 0.10)]);
}

export function _splitGetData() {
  const lg = window.systemState?.lastgangKw;
  if (!lg || lg.length < 8760) return null;
  const vf  = (parseFloat(document.getElementById('gl-netzverlust')?.value) || 10) / 100;
  const tww = _splitTwwFloor(lg, vf);
  return { lg, vf, tww };
}

export function splitZoomReset() {
  _splitZoom = { startH: 0, endH: 8760 };
  // KW-Schieber zurücksetzen
  const sl = document.getElementById('split-kw-slider');
  if (sl) { sl.value = 1; document.getElementById('split-kw-label').textContent = 'KW 1'; }
  splitDraw();
}

export function splitOnKwSlider(kw) {
  document.getElementById('split-kw-label').textContent = `KW ${kw}`;
  const startH = (kw - 1) * 168;
  _splitZoom = { startH, endH: Math.min(8760, startH + 168) };
  splitDraw();
}

// ── Energiesplit View Toggle ──────────────────────────────────────────
export function _splitSetView(mode) {
  ['balken','treemap'].forEach(v => {
    document.getElementById('split-view-' + v)?.classList.toggle('active', v === mode);
    const w = document.getElementById('split-wrap-' + v);
    if (w) w.style.display = v === mode ? '' : 'none';
  });
  const leg = document.getElementById('split-legend-inline');
  if (leg) leg.style.display = mode === 'balken' ? '' : 'none';
  if (mode === 'treemap') _splitRenderTreemap();
  else splitRender();
}

export function _splitRenderTreemap() {
  const canvas = document.getElementById('split-treemap-canvas');
  if (!canvas) return;
  const W = canvas.parentElement?.clientWidth || canvas.offsetWidth || 700;
  canvas.width = W; const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const { hourly, keys } = _daGetData();
  const en = window._dispatchEnergy || {};
  if (!keys.length) {
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Erst Grundlagen berechnen.', 20, H / 2); return;
  }

  // Build data: annual MWh per generator
  const data = [];
  keys.forEach(k => {
    const wMwh = en[k]?.waermeMwh || 0;
    if (wMwh < 0.01) return;
    data.push({ label: DA_LABELS[k] || k, value: wMwh, color: _daColor(k) });
  });
  if (!data.length) { ctx.fillStyle = '#888'; ctx.font = '11px sans-serif'; ctx.fillText('Keine Daten.', 20, H / 2); return; }
  data.sort((a, b) => b.value - a.value);
  const total = data.reduce((s, d) => s + d.value, 0);

  // Squarified treemap
  const pad = 8;
  function squarify(items, x, y, ww, hh) {
    const rects = []; const rem = items.slice();
    function worst(row, rT, side) {
      if (!row.length) return Infinity;
      const area = rT / total * ww * hh;
      let mx = 0;
      row.forEach(it => {
        const ia = it.value / total * ww * hh;
        const r1 = (side * side * ia) / (area * area);
        const r2 = (area * area) / (side * side * ia);
        mx = Math.max(mx, r1, r2);
      }); return mx;
    }
    let rect = { x, y, w: ww, h: hh }; let idx = 0;
    while (idx < rem.length) {
      const isW = rect.w >= rect.h; const side = isW ? rect.h : rect.w;
      let row = [], rT = 0;
      while (idx < rem.length) {
        const test = [...row, rem[idx]], tT = rT + rem[idx].value;
        if (!row.length || worst(test, tT, side) <= worst(row, rT, side)) {
          row.push(rem[idx]); rT = tT; idx++;
        } else break;
      }
      const rowSize = isW ? (rT / total * ww * hh) / rect.h : (rT / total * ww * hh) / rect.w;
      let off = 0;
      row.forEach(it => {
        const frac = it.value / rT;
        const len = isW ? rect.h * frac : rect.w * frac;
        if (isW) rects.push({ ...it, x: rect.x, y: rect.y + off, w: rowSize, h: len });
        else rects.push({ ...it, x: rect.x + off, y: rect.y, w: len, h: rowSize });
        off += len;
      });
      if (isW) rect = { x: rect.x + rowSize, y: rect.y, w: rect.w - rowSize, h: rect.h };
      else rect = { x: rect.x, y: rect.y + rowSize, w: rect.w, h: rect.h - rowSize };
    }
    return rects;
  }

  const rects = squarify(data, pad, pad, W - pad * 2, H - pad * 2);
  rects.forEach(r => {
    const inset = 2, rx = r.x + inset, ry = r.y + inset;
    const rw = r.w - inset * 2, rh = r.h - inset * 2;
    if (rw <= 0 || rh <= 0) return;
    const cr = 5;
    ctx.fillStyle = r.color + 'cc';
    ctx.beginPath();
    ctx.moveTo(rx + cr, ry); ctx.lineTo(rx + rw - cr, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + cr);
    ctx.lineTo(rx + rw, ry + rh - cr);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - cr, ry + rh);
    ctx.lineTo(rx + cr, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - cr);
    ctx.lineTo(rx, ry + cr);
    ctx.quadraticCurveTo(rx, ry, rx + cr, ry);
    ctx.fill();
    ctx.strokeStyle = r.color; ctx.lineWidth = 1; ctx.stroke();

    // Label + value
    const fs = Math.min(13, rw / 6, rh / 3);
    if (fs < 7) return;
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(fs)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const pct = (r.value / total * 100).toFixed(1);
    ctx.fillText(r.label, rx + rw / 2, ry + rh / 2 - fs * 0.6);
    ctx.font = `${Math.round(fs * 0.85)}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(r.value.toFixed(0) + ' MWh (' + pct + '%)', rx + rw / 2, ry + rh / 2 + fs * 0.6);
    ctx.textBaseline = 'alphabetic';
  });
}

export function splitRender() {
  const d = _splitGetData();
  if (!d) {
    const canvas = document.getElementById('split-canvas');
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#13151f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
    ctx.fillText('Erst Grundlagen berechnen.', 20, canvas.height / 2);
    return;
  }
  splitDraw();
  _splitBindEvents();
}

export function splitDraw() {
  const canvas = document.getElementById('split-canvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 800;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  const d = _splitGetData();
  if (!d) return;
  const { lg, vf, tww } = d;
  const n = lg.length;

  const { startH, endH } = _splitZoom;
  const nVis = endH - startH;

  // Zoom-Label aktualisieren
  const zlbl = document.getElementById('split-zoom-label');
  const zrst = document.getElementById('split-zoom-reset');
  if (zlbl) {
    if (nVis < 8760) {
      const d1 = Math.floor(startH/24)+1, d2 = Math.floor((endH-1)/24)+1;
      zlbl.textContent = nVis <= 168 ? `KW ${Math.ceil(startH/168)} (${nVis}h)` : `Tag ${d1}–${d2}`;
    } else { zlbl.textContent = ''; }
  }
  if (zrst) zrst.style.display = nVis < 8760 ? '' : 'none';

  const ML = 50, MB = 18, MT = 6;
  const PW = W - ML, PH = H - MB - MT;

  ctx.fillStyle = '#13151f'; ctx.fillRect(0, 0, W, H);

  // Stundenwerte per Pixel zusammenfassen
  const step = Math.max(1, Math.floor(nVis / PW));
  const nCols = Math.ceil(nVis / step);

  // Daten aggregieren
  const rwArr = new Float32Array(nCols);
  const twwArr = new Float32Array(nCols);
  const vlArr = new Float32Array(nCols);
  let pMax = 0;

  for (let col = 0; col < nCols; col++) {
    const h0 = startH + col * step;
    const h1 = Math.min(h0 + step, endH);
    let sumRw = 0, sumTww = 0, sumVl = 0, cnt = 0;
    for (let h = h0; h < h1 && h < n; h++) {
      const verlust = lg[h] * vf;
      const netto   = lg[h] - verlust;
      const twwH    = Math.min(netto, tww);
      const rw      = Math.max(0, netto - twwH);
      sumRw  += rw; sumTww += twwH; sumVl += verlust; cnt++;
    }
    if (cnt > 0) { rwArr[col] = sumRw/cnt; twwArr[col] = sumTww/cnt; vlArr[col] = sumVl/cnt; }
    const tot = rwArr[col] + twwArr[col] + vlArr[col];
    if (tot > pMax) pMax = tot;
  }
  if (pMax <= 0) pMax = 1;

  // Y-Gitter + Labels
  ctx.font = '8px monospace'; ctx.textAlign = 'right';
  [25,50,75,100].forEach(pct => {
    const p = pMax * pct / 100;
    const y = MT + PH - (p / pMax) * PH;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(Math.round(p) + ' kW', ML - 2, y + 3);
  });

  // Balken zeichnen
  const colW = Math.max(1, Math.floor(PW / nCols));
  for (let col = 0; col < nCols; col++) {
    const x = ML + Math.round(col * PW / nCols);
    let y = MT + PH;
    const draw = (val, color) => {
      const h = (val / pMax) * PH;
      if (h < 0.3) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.round(y - h), colW, Math.max(1, Math.ceil(h)));
      y -= h;
    };
    draw(vlArr[col],  '#78909c');  // unten: Netzverluste
    draw(rwArr[col],  '#e53935');  // mitte: Raumwärme
    draw(twwArr[col], '#ff8a65');  // oben/Spitzen: TWW
  }

  // Zeitlinien (verschoben um linken Rand)
  ctx.save(); ctx.translate(ML, 0);
  _daZeitlinien(ctx, PW, PH, startH, endH, nVis);
  ctx.restore();

  // Rubber-Band-Overlay
  if (_splitRubber) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const x0 = Math.min(_splitRubber.x0, _splitRubber.x1);
    const x1 = Math.max(_splitRubber.x0, _splitRubber.x1);
    ctx.fillRect(x0, MT, x1 - x0, PH);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
    ctx.strokeRect(x0, MT, x1 - x0, PH);
    ctx.setLineDash([]);
  }
}

export function _splitBindEvents() {
  const canvas = document.getElementById('split-canvas');
  const tip    = document.getElementById('split-tooltip');
  if (!canvas) return;
  canvas.onmousedown = e => { _splitRubber = { x0: e.offsetX, x1: e.offsetX }; canvas.style.cursor = 'ew-resize'; };
  canvas.onmousemove = e => {
    const ML = 50;
    if (_splitRubber) { _splitRubber.x1 = e.offsetX; splitDraw(); return; }
    if (!tip) return;
    const W = canvas.width, { startH, endH } = _splitZoom;
    const x = e.offsetX - ML;
    const PW = W - ML;
    if (x < 0 || x > PW) { tip.style.display = 'none'; return; }
    const t = startH + Math.round(x / PW * (endH - startH));
    if (t < 0 || t >= 8760) { tip.style.display = 'none'; return; }
    const d = _splitGetData();
    if (!d) return;
    const { lg, vf, tww } = d;
    const verlust = lg[t] * vf;
    const netto   = lg[t] - verlust;
    const twwH    = Math.min(netto, tww);
    const rw      = Math.max(0, netto - twwH);
    const kw = Math.floor(t / 168) + 1;
    const day = Math.floor(t / 24) + 1;
    const hr  = t % 24;
    tip.innerHTML =
      `<b>KW ${kw} · Tag ${day} · ${hr}:00 Uhr</b><br>` +
      `<span style="color:#e53935;">Raumwärme: ${rw.toFixed(0)} kW</span><br>` +
      `<span style="color:#ff8a65;">TWW: ${twwH.toFixed(0)} kW</span><br>` +
      `<span style="color:#90a4ae;">Verluste: ${verlust.toFixed(0)} kW</span><br>` +
      `<b>Gesamt: ${lg[t].toFixed(0)} kW</b>`;
    tip.style.display = 'block';
    tip.style.left = (e.offsetX > W * 0.65 ? e.offsetX - tip.offsetWidth - 8 : e.offsetX + 10) + 'px';
    tip.style.top  = '8px';
  };
  canvas.onmouseup = e => {
    if (!_splitRubber) return;
    const x0r = Math.min(_splitRubber.x0, e.offsetX) - 50;
    const x1r = Math.max(_splitRubber.x0, e.offsetX) - 50;
    _splitRubber = null;
    canvas.style.cursor = 'crosshair';
    if (x1r - x0r > 8) {
      const PW = canvas.width - 50;
      const { startH, endH } = _splitZoom;
      const span = endH - startH;
      const nStart = startH + Math.round(Math.max(0, x0r) / PW * span);
      const nEnd   = startH + Math.round(Math.min(PW, x1r) / PW * span);
      if (nEnd - nStart > 1) {
        _splitZoom = { startH: nStart, endH: nEnd };
        // KW-Schieber synchronisieren
        const kw = Math.floor(nStart / 168) + 1;
        const sl = document.getElementById('split-kw-slider');
        if (sl) { sl.value = kw; document.getElementById('split-kw-label').textContent = `KW ${kw}`; }
      }
    }
    splitDraw();
    if (tip) tip.style.display = 'none';
  };
  canvas.onmouseleave = () => { if (tip) tip.style.display = 'none'; };
  canvas.ondblclick   = () => splitZoomReset();
}

// ── Auto-Update wenn Panel offen ──────────────────────────────────────────
export function daUpdateIfOpen() {
  if (!document.getElementById('analyse-panel')?.classList.contains('visible')) return;
  saSetTab(saCurrentTab || 'lastgang');
}

