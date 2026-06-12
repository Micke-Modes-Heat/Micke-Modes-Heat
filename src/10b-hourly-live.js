// ── 10b-hourly-live.js — Stündliche Live-Ansicht: Dispatch-Canvas, Strom-Bilanz, Flow-SVG, SOC, Zoom, Timeline, Play ──
// 10b-optimizer-ui.js - Optimizer: UI, Worker orchestration, charts, hourly mode
// Split from 10-optimizer.js - Hourly mode, stacked dispatch canvas, Strom-Bilanz,
// flow SVG, drag overlay, hourly update, SOC chart, zoom, timeline, play, keyboard,
// runOptimierung, Worker orchestration, _buildOptWorkerCode, _doRunOptimierung,
// bar chart, radar chart, scatter plot
// ==========================================================================

// ── Stundenscharfer Zeitschieber (Hourly Live-Modus) ─────────────────────
import { currentViewMode, setViewMode } from './04a-ui-panels.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';

export let _hourlyModeActive = false;

export function _toggleHourlyMode() {
  const hasData = window._dispatchHourly && window._dispatchActiveKeys?.length > 0;
  if (!hasData) return;
  if (currentViewMode === 'live') {
    _hourlyModeActive = false;
    setViewMode('karte');
  } else {
    _hourlyModeActive = true;
    setViewMode('live');
  }
}

export function _showHourlySlider() {
  const liveTab = document.getElementById('view-tab-live');
  if (liveTab) liveTab.style.display = '';
}

export function _hideHourlySlider() {
  _hourlyModeActive = false;
  const liveTab = document.getElementById('view-tab-live');
  if (liveTab) liveTab.style.display = 'none';
  _removeHourlyOverlay();
}

export function _hourToDateStr(h) {
  const day = Math.floor(h / 24);
  const hr = h % 24;
  const m = [31,28,31,30,31,30,31,31,30,31,30,31];
  const mNames = ['Januar','Februar','M\u00e4rz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  let d = day, mo = 0;
  while (mo < 12 && d >= m[mo]) { d -= m[mo]; mo++; }
  return String(d + 1) + '. ' + mNames[mo] + ' \u00B7 ' + String(hr).padStart(2, '0') + ':00';
}

export function _onHourSlider(val) {
  const t = parseInt(val) || 0;
  if (_hourlyModeActive) _updateHourlyOverlay(t);
}

export function _removeHourlyOverlay() {
  _hourlyModeActive = false;
  if (currentViewMode === 'live') setViewMode('karte');
}

// ── Gestapeltes Erzeugerlastgang-Diagramm (Canvas) ──────────────────────
export function _drawStackedDispatch(canvas, currentHour, keys, hourly, ss) {
  const parent = canvas.parentElement;
  const W = (parent?.offsetWidth || 600) - 12;
  const H = Math.max(180, Math.min(800, (parent?.offsetHeight || 340) - 24));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Datenaufbereitung: Erzeuger + Solarthermie + Speicher + Backup
  const hasTSoc = !!(window._thermSpeicherState?.socH && window._thermSpeicherState?.params?.kapKwh > 0);
  const PAD = { l: 46, r: hasTSoc ? 52 : 12, t: 10, b: 46 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const allKeys = [];
  const allColors = [];
  const allLabels = [];
  for (const k of keys) {
    if (!hourly[k]) continue;
    if (k === '_autoGk' || k === '_thermSpeicher' || k === 'solarthermie') continue; // separat unten
    allKeys.push(k);
    allColors.push(ERZEUGER_CFG[k]?.color || '#aaa');
    allLabels.push(ERZEUGER_CFG[k]?.label || k);
  }
  if (hourly['solarthermie']) { allKeys.push('solarthermie'); allColors.push('#ffab40'); allLabels.push('ST'); }
  if (hourly['_thermSpeicher']) { allKeys.push('_thermSpeicher'); allColors.push('#26a69a'); allLabels.push('Speicher'); }
  if (hourly['_autoGk']) { allKeys.push('_autoGk'); allColors.push('#78909c'); allLabels.push('GK-Backup'); }

  const N = allKeys.length;
  if (N === 0) return;

  // Zoom range support
  const range = (typeof _getLiveZoomRange === 'function') ? _getLiveZoomRange(currentHour) : { start: 0, end: 8760 };
  const rangeLen = range.end - range.start;

  // Downsampling: rangeLen → plotW Pixel (1 Pixel = mehrere Stunden)
  const samplesPerPx = Math.max(1, Math.ceil(rangeLen / plotW));
  const nSamples = Math.ceil(rangeLen / samplesPerPx);

  // Stack-Summen + Max berechnen
  const stacks = new Array(nSamples);
  let maxKw = 0;
  const lastgangDown = new Float32Array(nSamples);

  for (let s = 0; s < nSamples; s++) {
    const t0 = range.start + s * samplesPerPx;
    const t1 = Math.min(t0 + samplesPerPx, range.end);
    stacks[s] = new Float32Array(N);
    let sum = 0, lastSum = 0, lastCount = 0;
    for (let t = t0; t < t1; t++) {
      let acc = 0;
      for (let ki = 0; ki < N; ki++) {
        const v = hourly[allKeys[ki]]?.[t] || 0;
        if (v > 0) acc += v;
      }
      sum = Math.max(sum, acc);
      const _dlk = window._dispatchLastgangKw || ss.lastgangKw;
      if (_dlk) { lastSum += _dlk[t] || 0; lastCount++; }
    }
    // Max-Wert pro Pixel-Bucket für Erzeugerstapel
    for (let ki = 0; ki < N; ki++) {
      let maxV = 0;
      for (let t = t0; t < t1; t++) maxV = Math.max(maxV, hourly[allKeys[ki]]?.[t] || 0);
      stacks[s][ki] = maxV;
    }
    maxKw = Math.max(maxKw, sum);
    lastgangDown[s] = lastCount > 0 ? lastSum / lastCount : 0;
    maxKw = Math.max(maxKw, lastgangDown[s]);
  }
  if (maxKw < 1) maxKw = 1;
  maxKw *= 1.08;

  // ── Hintergrund ──
  const bgGrad = ctx.createLinearGradient(PAD.l, PAD.t, PAD.l, PAD.t + plotH);
  bgGrad.addColorStop(0, 'rgba(0,0,0,0.2)');
  bgGrad.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = bgGrad;
  ctx.beginPath(); ctx.roundRect(PAD.l, PAD.t, plotW, plotH, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(PAD.l, PAD.t, plotW, plotH, 6); ctx.stroke();

  // ── Horizontale Rasterlinien + Y-Achse ──
  const nTicks = 4;
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= nTicks; i++) {
    const frac = i / nTicks;
    const yy = PAD.t + plotH * (1 - frac);
    const kw = maxKw * frac;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + plotW, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(kw >= 1000 ? (kw / 1000).toFixed(1) + ' MW' : kw.toFixed(0) + ' kW', PAD.l - 4, yy);
  }

  // ── Gestapelte Flächen ──
  for (let ki = N - 1; ki >= 0; ki--) {
    ctx.beginPath();
    for (let s = 0; s < nSamples; s++) {
      const x = PAD.l + (s / nSamples) * plotW;
      let stackTop = 0;
      for (let j = 0; j <= ki; j++) stackTop += stacks[s][j];
      const y = PAD.t + plotH * (1 - stackTop / maxKw);
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // Unterseite (vorheriger Stack oder Baseline)
    for (let s = nSamples - 1; s >= 0; s--) {
      const x = PAD.l + (s / nSamples) * plotW;
      let stackBot = 0;
      for (let j = 0; j < ki; j++) stackBot += stacks[s][j];
      const y = PAD.t + plotH * (1 - stackBot / maxKw);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    // Solid fill
    const _col = allColors[ki] || '#aaa';
    ctx.fillStyle = _col;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    // Obere Kante
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = _col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 0; s < nSamples; s++) {
      const x = PAD.l + (s / nSamples) * plotW;
      let stackTop = 0;
      for (let j = 0; j <= ki; j++) stackTop += stacks[s][j];
      const y = PAD.t + plotH * (1 - stackTop / maxKw);
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Lastgang-Linie (Bedarf) mit Glow ──
  ctx.save();
  ctx.beginPath();
  for (let s = 0; s < nSamples; s++) {
    const x = PAD.l + (s / nSamples) * plotW;
    const y = PAD.t + plotH * (1 - lastgangDown[s] / maxKw);
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  // Lastgang-Linie
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.restore();

  // ── X-Achse (Zoom-aware) ──
  _drawLiveXAxis(ctx, PAD, plotW, plotH, range);

  // ── Wärmespeicher SoC Overlay ──
  const tss = window._thermSpeicherState;
  if (tss && tss.socH && tss.params?.kapKwh > 0) {
    const socH = tss.socH;
    const kapKwh = tss.params.kapKwh;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#26a69a';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let s = 0; s < nSamples; s++) {
      const t0 = range.start + s * samplesPerPx;
      const soc = socH[Math.min(t0, 8759)] || 0;
      const x = PAD.l + (s / nSamples) * plotW;
      const y = PAD.t + plotH * (1 - soc / kapKwh);
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Rechte Y-Achse: Speicher SoC
    ctx.textAlign = 'left';
    ctx.font = '8px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(38,166,154,0.5)';
    for (let i = 0; i <= 2; i++) {
      const frac = i / 2;
      const yy = PAD.t + plotH * (1 - frac);
      const kwh = kapKwh * frac;
      ctx.fillText(kwh >= 1000 ? (kwh / 1000).toFixed(1) + ' MWh' : kwh.toFixed(0) + ' kWh', PAD.l + plotW + 3, yy + 3);
    }
    ctx.restore();
  }

  // ── Vertikaler Cursor mit Glow (aktuelle Stunde) ──
  const curFrac = (currentHour - range.start) / rangeLen;
  if (curFrac >= 0 && curFrac <= 1) {
    const curX = PAD.l + curFrac * plotW;
    ctx.save();
    // Glow
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.moveTo(curX, PAD.t); ctx.lineTo(curX, PAD.t + plotH); ctx.stroke();
    // Core line
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(curX, PAD.t); ctx.lineTo(curX, PAD.t + plotH); ctx.stroke();
    // Dot at top
    ctx.beginPath();
    ctx.arc(curX, PAD.t, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#4dd0e1';
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.restore();
  }

  // ── Legende (horizontal unterhalb X-Achse) ──
  const legY = PAD.t + plotH + 22;
  let legX = PAD.l;
  ctx.font = '8px "DM Sans", sans-serif';
  ctx.textAlign = 'left';
  for (let ki = 0; ki < N; ki++) {
    if (!allLabels[ki]) continue;
    ctx.fillStyle = allColors[ki];
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.roundRect(legX, legY - 4, 8, 8, 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(allLabels[ki], legX + 11, legY + 3);
    legX += ctx.measureText(allLabels[ki]).width + 20;
  }
  // Bedarf
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(legX, legY); ctx.lineTo(legX + 10, legY); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('Bedarf', legX + 14, legY + 3);
  // Speicher-Legende
  if (tss && tss.socH && tss.params?.kapKwh > 0) {
    legX += ctx.measureText('Bedarf').width + 20;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#26a69a'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(legX, legY); ctx.lineTo(legX + 10, legY); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('Speicher SoC', legX + 14, legY + 3);
  }
}

// ── Strom-Bilanz-Chart (Erzeugung vs. Verbrauch) ────────────────────────
export function _drawStromBilanz(canvas, currentHour) {
  const parent = canvas.parentElement;
  const W = (parent?.offsetWidth || 400) - 12;
  const H = Math.max(180, Math.min(800, (parent?.offsetHeight || 340) - 24));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { l: 46, r: 12, t: 10, b: 46 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  // Datenquellen
  const pvH = window._stromPvH || window.elPvH;
  const bhkwElH = window._bhkwElHourly;
  const wpElH = window._wpElHourly;
  const skElH = window._skElHourly;
  const quartierH = window.elQuartierH || window._elQuartierFromGeb;
  const batSocH = window._stromBatSocH;

  const hasPv = pvH && pvH.some(v => v > 0.1);
  const hasBhkw = bhkwElH && bhkwElH.some(v => v > 0.1);
  const hasWp = wpElH && wpElH.some(v => v > 0.1);
  const hasSk = skElH && skElH.some(v => v > 0.1);
  const hasQuartier = quartierH && quartierH.some(v => v > 0.1);

  if (!hasPv && !hasBhkw && !hasWp && !hasSk && !hasQuartier) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '11px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Keine Stromdaten', W / 2, H / 2);
    return;
  }

  // Erzeuger: PV, BHKW-el (positiv, nach oben)
  // Verbraucher: WP, SK, Quartier-HH-Strom (negativ, nach unten)
  const range = (typeof _getLiveZoomRange === 'function') ? _getLiveZoomRange(currentHour) : { start: 0, end: 8760 };
  const rangeLen = range.end - range.start;
  const samplesPerPx = Math.max(1, Math.ceil(rangeLen / plotW));
  const nSamples = Math.ceil(rangeLen / samplesPerPx);

  const erzPv = new Float32Array(nSamples);
  const erzBhkw = new Float32Array(nSamples);
  const verWp = new Float32Array(nSamples);
  const verSk = new Float32Array(nSamples);
  const verHH = new Float32Array(nSamples);
  let maxPos = 0, maxNeg = 0;

  for (let s = 0; s < nSamples; s++) {
    const t0 = range.start + s * samplesPerPx;
    const t1 = Math.min(t0 + samplesPerPx, range.end);
    let mPv = 0, mBh = 0, mWp = 0, mSk = 0, mHH = 0;
    for (let t = t0; t < t1; t++) {
      mPv = Math.max(mPv, pvH?.[t] || 0);
      mBh = Math.max(mBh, bhkwElH?.[t] || 0);
      mWp = Math.max(mWp, wpElH?.[t] || 0);
      mSk = Math.max(mSk, skElH?.[t] || 0);
      mHH = Math.max(mHH, quartierH?.[t] || 0);
    }
    erzPv[s] = mPv; erzBhkw[s] = mBh;
    verWp[s] = mWp; verSk[s] = mSk; verHH[s] = mHH;
    maxPos = Math.max(maxPos, mPv + mBh);
    maxNeg = Math.max(maxNeg, mWp + mSk + mHH);
  }

  const maxAbs = Math.max(maxPos, maxNeg, 1) * 1.08;
  const zeroY = PAD.t + plotH * (maxPos / (maxPos + maxNeg + 0.001));

  // ── Hintergrund ──
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.roundRect(PAD.l, PAD.t, plotW, plotH, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(PAD.l, PAD.t, plotW, plotH, 6); ctx.stroke();

  // ── Nulllinie ──
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(PAD.l, zeroY); ctx.lineTo(PAD.l + plotW, zeroY); ctx.stroke();

  // ── Y-Achse ──
  ctx.font = '9px "DM Mono", monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const nTicks = 3;
  for (let i = 1; i <= nTicks; i++) {
    const frac = i / nTicks;
    // Positive Achse
    if (maxPos > 0.1) {
      const yy = zeroY - (zeroY - PAD.t) * frac;
      const kw = maxPos * frac;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + plotW, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(kw >= 1000 ? (kw / 1000).toFixed(1) + ' MW' : kw.toFixed(0) + ' kW', PAD.l - 4, yy);
    }
    // Negative Achse
    if (maxNeg > 0.1) {
      const yy = zeroY + (PAD.t + plotH - zeroY) * frac;
      const kw = maxNeg * frac;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + plotW, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(kw >= 1000 ? (kw / 1000).toFixed(1) + ' MW' : kw.toFixed(0) + ' kW', PAD.l - 4, yy);
    }
  }

  // Helper: draw stacked area
  function drawArea(data1, data2, color1, color2, dir) {
    // dir=1: up from zero, dir=-1: down from zero
    const arrs = []; const cols = [];
    if (data1.some(v => v > 0.01)) { arrs.push(data1); cols.push(color1); }
    if (data2 && data2.some(v => v > 0.01)) { arrs.push(data2); cols.push(color2); }
    const maxRef = dir > 0 ? maxPos : maxNeg;
    const halfH = dir > 0 ? (zeroY - PAD.t) : (PAD.t + plotH - zeroY);

    for (let ki = arrs.length - 1; ki >= 0; ki--) {
      ctx.beginPath();
      for (let s = 0; s < nSamples; s++) {
        const x = PAD.l + (s / nSamples) * plotW;
        let stack = 0;
        for (let j = 0; j <= ki; j++) stack += arrs[j][s];
        const y = zeroY - dir * (stack / (maxRef || 1)) * halfH;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let s = nSamples - 1; s >= 0; s--) {
        const x = PAD.l + (s / nSamples) * plotW;
        let stackBot = 0;
        for (let j = 0; j < ki; j++) stackBot += arrs[j][s];
        const y = zeroY - dir * (stackBot / (maxRef || 1)) * halfH;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = cols[ki]; ctx.globalAlpha = 0.5; ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Erzeugung (oben, positiv)
  drawArea(erzPv, erzBhkw, '#fdd835', '#ff8f00', 1);

  // Verbrauch (unten, negativ) — WP, SK, HH
  const verAll = [verWp, verSk, verHH].filter(a => a.some(v => v > 0.01));
  const verColors = [];
  if (verWp.some(v => v > 0.01)) verColors.push('#42a5f5');
  if (verSk.some(v => v > 0.01)) verColors.push('#e040fb');
  if (verHH.some(v => v > 0.01)) verColors.push('#90a4ae');
  const verMax = maxNeg;
  const halfDown = PAD.t + plotH - zeroY;
  for (let ki = verAll.length - 1; ki >= 0; ki--) {
    ctx.beginPath();
    for (let s = 0; s < nSamples; s++) {
      const x = PAD.l + (s / nSamples) * plotW;
      let stack = 0;
      for (let j = 0; j <= ki; j++) stack += verAll[j][s];
      const y = zeroY + (stack / (verMax || 1)) * halfDown;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let s = nSamples - 1; s >= 0; s--) {
      const x = PAD.l + (s / nSamples) * plotW;
      let stackBot = 0;
      for (let j = 0; j < ki; j++) stackBot += verAll[j][s];
      const y = zeroY + (stackBot / (verMax || 1)) * halfDown;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = verColors[ki]; ctx.globalAlpha = 0.5; ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── X-Achse (Zoom-aware) ──
  _drawLiveXAxis(ctx, PAD, plotW, plotH, range);

  // ── Cursor ──
  const curFrac = (currentHour - range.start) / rangeLen;
  if (curFrac >= 0 && curFrac <= 1) {
    const curX = PAD.l + curFrac * plotW;
    ctx.save();
    ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(curX, PAD.t); ctx.lineTo(curX, PAD.t + plotH); ctx.stroke();
    ctx.restore();
  }

  // ── Achsen-Labels ──
  ctx.font = '8px "DM Sans", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.textAlign = 'left';
  if (maxPos > 0.1) ctx.fillText('Erzeugung \u2191', PAD.l + 4, PAD.t + 10);
  if (maxNeg > 0.1) ctx.fillText('Verbrauch \u2193', PAD.l + 4, PAD.t + plotH - 4);

  // ── Legende ──
  const legY = PAD.t + plotH + 22;
  let legX = PAD.l;
  ctx.font = '8px "DM Sans", sans-serif'; ctx.textAlign = 'left';
  const legItems = [];
  if (hasPv) legItems.push(['PV', '#fdd835']);
  if (hasBhkw) legItems.push(['BHKW-el', '#ff8f00']);
  if (hasWp) legItems.push(['WP', '#42a5f5']);
  if (hasSk) legItems.push(['SK', '#e040fb']);
  if (hasQuartier) legItems.push(['HH-Strom', '#90a4ae']);
  for (const [lbl, col] of legItems) {
    ctx.fillStyle = col; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.roundRect(legX, legY - 4, 8, 8, 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(lbl, legX + 11, legY + 3);
    legX += ctx.measureText(lbl).width + 18;
  }
}

// ── Schematisches Netz-Fließbild (SVG) — Zwei-Bus-Layout ──────
export function _buildFlowSVG(container, data) {
  if (!container) { console.warn('FlowSVG: no container'); return; }
  const { erzeuger, bedarf, speicher, strom, tempC, vlC, t } = data;
  const hasStrom = strom.pvKw > 0.1 || strom.bhkwKw > 0.1 || strom.wpKw > 0.1 || strom.skKw > 0.1 || strom.hhKw > 0.1 || strom.batKap > 0 || strom.netzbezugKw > 0.1;
  const hasSpeicher = speicher.tsKap > 0;

  // Farben — dezent, passend zum var(--surface)/var(--border) Stil
  const C = {
    waerme: '#9b5b5b', strom: '#8a7a3d', wp: '#5e8a82', gk: '#6b7b7c',
    pellets: '#7a6248', bhkw: '#8a6b40', solar: '#8a7040', speicher: '#4a7568',
    pv: '#8a7a3d', netz: '#5a6878', hh: '#5e6b70', bat: '#6e6488',
    einsp: '#4e7a52', umwelt: '#4a7b6e', verlust: '#4a5060',
    text: '#7a8898', dim: '#4a5568', bus: '#3a4250', bg: '#111318',
  };
  const erzCMap = { lwwp:C.wp, fg:C.wp, geo:C.wp, gaskessel:C.gk, _autoGk:C.gk, bhkw:C.bhkw, pellets:C.pellets, hhs:C.pellets, heizoel:C.gk, fernwaerme:C.waerme, stromkessel:C.strom, solarthermie:C.solar };

  const W = 660, nW = 110, nH = 30, smH = 26, nR = 4, pad = 8;
  const allKw = [bedarf, ...erzeuger.map(e=>e.kw)];
  if (hasStrom) allKw.push(strom.pvKw, strom.wpKw + strom.skKw + strom.hhKw);
  const maxKw = Math.max(...allKw, 1);

  // Helpers
  function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function fw(kw){return Math.max(1, Math.min(3.5, (kw/maxKw)*2.5 + 0.8));}

  // WP identifizieren
  const wpKeys = ['lwwp','fg','geo'];
  const wpErz = erzeuger.filter(e=>wpKeys.includes(e.key));
  const othErz = erzeuger.filter(e=>!wpKeys.includes(e.key));
  const wpKw = wpErz.reduce((a,e)=>a+e.kw, 0);
  const hasWP = wpKw > 0.1;
  const wpEl = strom.wpKw || 0;
  const wpUmw = hasWP ? Math.max(0, wpKw - wpEl) : 0;
  const wpCOP = wpEl > 0.1 ? (wpKw/wpEl).toFixed(1) : '-';

  // Strom-Quellen & Verbraucher zählen
  const sQ = []; // Strom-Quellen
  if (strom.pvKw > 0.1) sQ.push({l:'PV', kw:strom.pvKw, c:C.pv});
  if (strom.bhkwKw > 0.1) sQ.push({l:'BHKW-el', kw:strom.bhkwKw, c:C.bhkw});
  if (strom.netzbezugKw > 0.1) sQ.push({l:'Netzbezug', kw:strom.netzbezugKw, c:C.netz, dash:true});
  const sV = []; // Strom-Verbraucher
  // WP nicht als Strom-Verbraucher — wird als Bridge-Knoten gezeichnet
  if (strom.skKw > 0.1) sV.push({l:'Stromkessel', kw:strom.skKw, c:C.strom, bridge:true});
  if (strom.hhKw > 0.1) sV.push({l:'Haushaltsstrom', kw:strom.hhKw, c:C.hh});
  if (strom.einspeisungKw > 0.1) sV.push({l:'Einspeisung', kw:strom.einspeisungKw, c:C.einsp, dash:true});
  if (strom.batKap > 0) { const bp=strom.batKap>0?(strom.batSoc/strom.batKap*100):0; sV.push({l:'Batterie '+bp.toFixed(0)+'%', kw:Math.max(strom.batLadeKw,strom.batEntladeKw), c:C.bat, batLade:strom.batLadeKw>0.1, batEntlade:strom.batEntladeKw>0.1}); }

  // Wärme-Quellen (ohne WP, die kommt extra)
  const wQ = [];
  if (hasWP) wQ.push({l:wpErz[0]?.label||'WP', kw:wpKw, c:C.wp, isWP:true});
  othErz.forEach(function(e){ if(e.kw>0.01) wQ.push({l:e.label, kw:e.kw, c:erzCMap[e.key]||C.gk}); });
  const wV = []; // Wärme-Verbraucher
  wV.push({l:'Wärmebedarf', kw:bedarf, c:C.waerme});
  if (hasSpeicher) { const p=speicher.tsKap>0?(speicher.tsSoc/speicher.tsKap*100):0; wV.push({l:'Speicher '+p.toFixed(0)+'%', kw:Math.max(speicher.tsLade,speicher.tsEntlade,0.01), c:C.speicher, lade:speicher.tsLade>0.1, entlade:speicher.tsEntlade>0.1}); }

  // ── Y-Layout: Strom-Quellen → Strom-Bus → Brücke(WP) → Wärme-Quellen → Wärme-Bus → Wärme-Verbraucher ──
  const rowH = smH + 4;
  const busH = 8;
  let y = 10;

  // Strom-Quellen-Reihe
  const yStromQ = y; y += (sQ.length > 0 ? rowH + 6 : 0);
  // Strom-Bus
  const yStromBus = y; y += busH + 6;
  // Strom-Verbraucher-Reihe
  const yStromV = y; y += (sV.length > 0 ? rowH + 6 : 0);
  // Brücke WP (Strom→Wärme Transformation)
  const yBridge = y; y += (hasWP ? 40 : 8);
  // Wärme-Quellen (nicht-WP)
  const othActive = othErz.filter(e=>e.kw>0.01);
  const yWaermeQ = y; y += (othActive.length > 0 ? rowH + 6 : 0);
  // Umweltwärme-Zeile
  const yUmwelt = hasWP ? yBridge + 2 : y;
  // Wärme-Bus
  const yWaermeBus = y; y += busH + 6;
  // Wärme-Verbraucher-Reihe
  const yWaermeV = y; y += rowH + 6;
  // Footer
  const yFooter = y + 4;
  const H = yFooter + 12;

  let s = '<svg width="100%" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;">';
  s += '<defs><marker id="fmh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M1 1L6 4L1 7" fill="none" stroke="context-stroke" stroke-width="1.2"/></marker></defs>';

  // ── Zeichenhilfen (gut sichtbar) ──
  function nodeAt(x, y, w, h, color, label, val) {
    let n = '<g>';
    n += '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+nR+'" fill="'+C.bg+'" stroke="'+color+'" stroke-width="0.8"/>';
    n += '<text x="'+(x+w/2)+'" y="'+(y+h/2-2)+'" text-anchor="middle" font-family="\'DM Mono\',monospace" font-size="8" font-weight="600" fill="'+color+'">'+esc(label)+'</text>';
    n += '<text x="'+(x+w/2)+'" y="'+(y+h/2+9)+'" text-anchor="middle" font-family="\'DM Mono\',monospace" font-size="7" fill="'+C.text+'">'+esc(val)+'</text>';
    n += '</g>';
    return n;
  }
  function bus(x, y, w, color, label) {
    let b = '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+busH+'" rx="2" fill="'+color+'" opacity="0.18" stroke="'+color+'" stroke-width="0.6"/>';
    b += '<text x="'+(x+6)+'" y="'+(y+busH/2+3)+'" font-family="\'DM Sans\',sans-serif" font-size="7" font-weight="600" fill="'+color+'" opacity="0.7">'+esc(label)+'</text>';
    return b;
  }
  function vLine(x, y1, y2, color, thick, lbl, dash) {
    let f = '';
    if (dash) {
      f += '<path d="M'+x+' '+y1+' L'+x+' '+y2+'" fill="none" stroke="'+color+'" stroke-width="'+thick+'" stroke-dasharray="3 3" opacity="0.5" marker-end="url(#fmh)"/>';
    } else {
      f += '<path d="M'+x+' '+y1+' L'+x+' '+y2+'" fill="none" stroke="'+color+'" stroke-width="'+thick+'" opacity="0.3"/>';
      f += '<path class="flow-anim" d="M'+x+' '+y1+' L'+x+' '+y2+'" fill="none" stroke="'+color+'" stroke-width="'+Math.max(0.8,thick*0.6)+'" opacity="0.7" marker-end="url(#fmh)"/>';
    }
    if (lbl) f += '<text x="'+(x+5)+'" y="'+((y1+y2)/2+3)+'" font-family="\'DM Mono\',monospace" font-size="6.5" fill="'+color+'" opacity="0.7">'+esc(lbl)+'</text>';
    return f;
  }

  // ── STROM-BUS ──
  const busL = 40, busR = W - 40;
  if (hasStrom) {
    s += bus(busL, yStromBus, busR - busL, C.strom, 'Strom-Schiene');

    // Strom-Quellen (oben, vertikal nach unten zum Bus)
    const sqW = Math.min(nW, (busR - busL - 20) / Math.max(sQ.length, 1));
    sQ.forEach(function(q, i) {
      const cx = busL + 30 + i * (sqW + 12) + sqW/2;
      s += nodeAt(cx - sqW/2, yStromQ, sqW, smH, q.c, q.l, q.kw.toFixed(0)+' kW', q.dash ? 0.5 : 0.75);
      s += vLine(cx, yStromQ + smH, yStromBus, q.c, fw(q.kw), q.kw.toFixed(0)+' kW', q.dash);
    });

    // Strom-Verbraucher (unten, vertikal vom Bus nach unten)
    const svW = Math.min(nW, (busR - busL - 20) / Math.max(sV.length, 1));
    sV.forEach(function(v, i) {
      const cx = busL + 30 + i * (svW + 12) + svW/2;
      const lbl = v.batLade ? '\u2193 '+v.kw.toFixed(0)+' kW' : (v.batEntlade ? '\u2191 '+v.kw.toFixed(0)+' kW' : v.kw.toFixed(0)+' kW');
      s += nodeAt(cx - svW/2, yStromV, svW, smH, v.c, v.l, lbl, 0.7);
      if (v.batEntlade) {
        s += vLine(cx, yStromV, yStromBus + busH, v.c, fw(v.kw), '', false); // reversed
      } else {
        s += vLine(cx, yStromBus + busH, yStromV, v.c, fw(v.kw), '', v.dash);
      }
      // Brücke WP: vertikale Verbindung Strom→Wärme
      if (v.bridge && hasWP) {
        v._cx = cx; // merken für Brücken-Zeichnung
      }
    });
  }

  // ── BRÜCKE: WP-Transformation (Strom + Umwelt → Wärme) ──
  if (hasWP) {
    const bx = W/2 - 60, bw = 120;
    const bh = 32;
    const by = yBridge;
    // WP-Kasten
    s += '<rect x="'+bx+'" y="'+by+'" width="'+bw+'" height="'+bh+'" rx="5" fill="'+C.bg+'" stroke="'+C.wp+'" stroke-width="0.8"/>';
    const wpLabel = wpErz[0]?.label || 'Wärmepumpe';
    s += '<text x="'+(bx+bw/2)+'" y="'+(by+13)+'" text-anchor="middle" font-family="\'DM Mono\',monospace" font-size="8.5" font-weight="600" fill="'+C.wp+'">'+esc(wpLabel)+'</text>';
    s += '<text x="'+(bx+bw/2)+'" y="'+(by+24)+'" text-anchor="middle" font-family="\'DM Mono\',monospace" font-size="7" fill="'+C.text+'">'+wpKw.toFixed(0)+' kW th \u00b7 COP '+wpCOP+'</text>';
    // Strom-Bus → WP (vertikal von oben)
    if (wpEl > 0.1) {
      s += vLine(bx + bw/2, yStromBus + busH, by, C.strom, fw(wpEl), wpEl.toFixed(0)+' kW el', false);
    }

    // Umweltwärme → WP (horizontal von links)
    if (wpUmw > 0.1) {
      const umwW = 90;
      s += nodeAt(bx - umwW - 16, by, umwW, bh, C.umwelt, 'Umweltwärme', wpUmw.toFixed(0)+' kW', 0.85);
      s += '<path d="M'+(bx-16)+' '+(by+bh/2)+' L'+bx+' '+(by+bh/2)+'" fill="none" stroke="'+C.umwelt+'" stroke-width="'+fw(wpUmw)+'" opacity="0.3" marker-end="url(#fmh)"/>';
      s += '<path class="flow-anim" d="M'+(bx-16)+' '+(by+bh/2)+' L'+bx+' '+(by+bh/2)+'" fill="none" stroke="'+C.umwelt+'" stroke-width="'+Math.max(0.8,fw(wpUmw)*0.6)+'" opacity="0.65" marker-end="url(#fmh)"/>';
    }

    // WP → Wärme-Bus (vertikal nach unten)
    s += vLine(bx+bw/2, by+bh, yWaermeBus, C.waerme, fw(wpKw), wpKw.toFixed(0)+' kW th', false);
  }

  // ── WÄRME-BUS ──
  s += bus(busL, yWaermeBus, busR - busL, C.waerme, 'Wärme-Schiene');

  // Andere Wärme-Quellen (oben, zum Bus)
  if (othActive.length > 0) {
    const owW = Math.min(nW, (busR - busL - 20) / Math.max(othActive.length, 1));
    // Rechts vom WP-Pfeil positionieren
    const startX = W/2 + 80;
    othActive.forEach(function(e, i) {
      const cx = startX + i * (owW + 10) + owW/2;
      if (cx + owW/2 > busR - 10) return; // overflow protection
      const col = erzCMap[e.key] || C.gk;
      s += nodeAt(cx - owW/2, yWaermeQ, owW, smH, col, e.label, e.kw.toFixed(0)+' kW', 0.7);
      s += vLine(cx, yWaermeQ + smH, yWaermeBus, col, fw(e.kw), e.kw.toFixed(0)+' kW', false);
    });
  }

  // Wärme-Verbraucher (unten, vom Bus nach unten)
  const wvW = Math.min(nW + 10, (busR - busL - 20) / Math.max(wV.length, 1));
  wV.forEach(function(v, i) {
    const cx = busL + 50 + i * (wvW + 20) + wvW/2;
    let lbl = v.kw.toFixed(0)+' kW';
    if (v.lade) lbl = '\u2193 '+speicher.tsLade.toFixed(0)+' kW';
    else if (v.entlade) lbl = '\u2191 '+speicher.tsEntlade.toFixed(0)+' kW';
    s += nodeAt(cx - wvW/2, yWaermeV, wvW, smH + 2, v.c, v.l, lbl, 0.8);
    if (v.entlade) {
      s += vLine(cx, yWaermeV, yWaermeBus + busH, v.c, fw(speicher.tsEntlade), '', false);
    } else {
      s += vLine(cx, yWaermeBus + busH, yWaermeV, v.c, fw(v.kw), '', false);
    }
  });

  // ── Footer ──
  const sumKw = erzeuger.reduce(function(a,e){return a+e.kw;},0);
  s += '<text x="6" y="'+yFooter+'" font-family="\'DM Mono\',monospace" font-size="7" fill="'+C.dim+'">' +
    'h'+t+' \u00b7 \u03A3 '+sumKw.toFixed(0)+' kW \u2192 '+bedarf.toFixed(0)+' kW \u00b7 '+tempC.toFixed(1)+'\u00b0C \u00b7 VL '+vlC.toFixed(0)+'\u00b0C</text>';

  s += '</svg>';
  container.innerHTML = s;

  // Zoom & Pan auf dem SVG (State am Container, überlebt Re-Render)
  const svgEl = container.querySelector('svg');
  if (!svgEl) return;
  if (!container._zp) container._zp = { s: 1, x: 0, y: 0 };
  const zp = container._zp;
  function _applyZP() {
    const el = container.querySelector('svg');
    if (el) { el.style.transform = 'scale('+zp.s+') translate('+zp.x+'px,'+zp.y+'px)'; el.style.transformOrigin = 'center top'; }
  }
  if (zp.s !== 1 || zp.x !== 0 || zp.y !== 0) _applyZP();

  if (!container._zoomInit) {
    container._zoomInit = true;
    let isPanning = false, startX = 0, startY = 0;
    container.style.overflow = 'hidden';
    container.style.cursor = 'grab';
    container.addEventListener('wheel', function(e) {
      e.preventDefault();
      zp.s = Math.max(0.5, Math.min(4, zp.s * (e.deltaY > 0 ? 0.92 : 1.08)));
      _applyZP();
    }, {passive: false});
    container.addEventListener('mousedown', function(e) {
      isPanning = true; startX = e.clientX - zp.x * zp.s; startY = e.clientY - zp.y * zp.s;
      container.style.cursor = 'grabbing';
    });
    container.addEventListener('mousemove', function(e) {
      if (!isPanning) return;
      zp.x = (e.clientX - startX) / zp.s; zp.y = (e.clientY - startY) / zp.s;
      _applyZP();
    });
    container.addEventListener('mouseup', function() { isPanning = false; container.style.cursor = 'grab'; });
    container.addEventListener('mouseleave', function() { isPanning = false; container.style.cursor = 'grab'; });
    container.addEventListener('dblclick', function() { zp.s = 1; zp.x = 0; zp.y = 0; _applyZP(); });
  }
}

// ── Hub-Sankey (Canvas) — Energiefluss als zwei Hubs (Strom + Wärme) ──
// Anlagen außenrum, Brücken (WP/BHKW/SK) in der Mitte, Detail-Modus mit
// TWW/Raumwärme/Netzverluste + Verlust-Bändern.
const _SANKEY_C = {
  netz:'#5a6878', pv:'#8a7a3d', bhkw:'#8a6b40', hh:'#5e6b70', sk:'#7a5b8a',
  bat:'#6e6488', wp:'#5e8a82', fw:'#9b5b5b', pellets:'#7a6248', hhs:'#5d4838',
  gk:'#6b7b7c', speicher:'#4a7568', bedarf:'#9b5b5b',
  hubStrom:'#8a7a3d', hubWaerme:'#9b5b5b',
  bandStrom:'#8a7a3d', bandWaerme:'#9b5b5b',
  bandUmwelt:'#5a8a6e', bandBrennstoff:'#5a6878',
  bandBezug:'#8a7a3d', bandEinsp:'#4e7a52',
  bandVerlust:'#4a5060',
};
const _SANKEY_ETAS = { gaskessel:0.92, heizoel:0.90, pellets:0.88, hhs:0.85 };
const _SANKEY_BHKW_ETA = 0.88;
const _SANKEY_BRENNSTOFF_LBL = { gaskessel:'Erdgas', heizoel:'Heizöl', pellets:'Pellets', hhs:'Hackschnitzel', bhkw:'Erdgas' };

// Wirkungsgrade aus DOM lesen falls verfügbar
function _sankeyEtas() {
  const f = (id, d) => (parseFloat(document.getElementById(id)?.value) || (d * 100)) / 100;
  return {
    gaskessel: f('gk-eta', 0.92),
    heizoel:   f('hko-eta', 0.90),
    pellets:   f('pk-eta', 0.88),
    hhs:       f('hhs-eta', 0.85),
    bhkw:      f('bhkw-eta', 0.88),
  };
}

// Stündliche TWW-Last (Floor des Sommer-Mitternachts-Lastgangs × (1−Netzverlust))
// — analog zu _splitTwwFloor in 07a, lokal um Zirkularität zu vermeiden.
function _sankeyTwwKw() {
  const lg = window.systemState?.lastgangKw;
  if (!lg || lg.length < 8760) return 0;
  const vf = (parseFloat(document.getElementById('gl-netzverlust')?.value) || 10) / 100;
  const vals = [];
  for (let h = 0; h < lg.length; h++) {
    const day = Math.floor(h / 24), hr = h % 24;
    if (day >= 151 && day <= 242 && hr >= 2 && hr <= 5) vals.push(lg[h] * (1 - vf));
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return Math.max(0, vals[Math.floor(vals.length * 0.10)]);
}

function _sankeyClassify(data, detail) {
  const C = _SANKEY_C;
  const { erzeuger, bedarf, speicher, strom } = data;
  const stromOnly = [], waermeOnly = [], bridges = [], sonder = [], annotations = [];

  if (strom.netzbezugKw > 0.1)   stromOnly.push({ label:'Netzbezug', value:strom.netzbezugKw, color:C.netz, dir:'in' });
  if (strom.pvKw > 0.1)          stromOnly.push({ label:'PV', value:strom.pvKw, color:C.pv, dir:'in' });
  if (strom.batEntladeKw > 0.1)  stromOnly.push({ label:'Batterie ↑', value:strom.batEntladeKw, color:C.bat, dir:'in' });
  if (strom.hhKw > 0.1)          stromOnly.push({ label:'Haushaltsstrom', value:strom.hhKw, color:C.hh, dir:'out' });
  if (strom.einspeisungKw > 0.1) stromOnly.push({ label:'Einspeisung', value:strom.einspeisungKw, color:C.bandEinsp, dir:'out' });
  if (strom.batLadeKw > 0.1)     stromOnly.push({ label:'Batterie ↓', value:strom.batLadeKw, color:C.bat, dir:'out' });

  const wpErz = erzeuger.find(e => ['lwwp','fg','geo'].includes(e.key));
  const wpKw = wpErz ? wpErz.kw : 0;
  if (wpErz) {
    const wpUmw = Math.max(0, wpKw - (strom.wpKw || 0));
    bridges.push({ label:wpErz.label, color:C.wp, kind:'wp', stromIn:strom.wpKw||0, waermeOut:wpKw, umwelt:wpUmw, kw:wpKw, cop:strom.wpKw>0.1?wpKw/strom.wpKw:null });
    if (wpUmw > 0.1) sonder.push({ label:'Umweltwärme', value:wpUmw, color:C.bandUmwelt, target:'wp' });
  }
  const bhkwErz = erzeuger.find(e => e.key === 'bhkw');
  if (bhkwErz) {
    bridges.push({ label:bhkwErz.label, color:C.bhkw, kind:'bhkw', stromOut:strom.bhkwKw||0, waermeOut:bhkwErz.kw, kw:bhkwErz.kw });
    sonder.push({ label:'Erdgas (BHKW)', value:bhkwErz.kw + (strom.bhkwKw||0) + 50, color:C.bandBrennstoff, target:'bhkw' });
  }
  if (strom.skKw > 0.1) bridges.push({ label:'Stromkessel', color:C.sk, kind:'sk', stromIn:strom.skKw, waermeOut:strom.skKw, kw:strom.skKw });

  for (const e of erzeuger) {
    if (['lwwp','fg','geo','bhkw'].includes(e.key)) continue;
    if (e.kw < 0.1) continue;
    let col = C.gk;
    if (e.key === 'fernwaerme') col = C.fw;
    else if (e.key === 'pellets') col = C.pellets;
    else if (e.key === 'hhs')     col = C.hhs;
    waermeOnly.push({ key:e.key, label:e.label, value:e.kw, color:col, dir:'in' });
  }

  if (detail) {
    const nv = bedarf * 0.10;
    const tww = Math.min(_sankeyTwwKw(), bedarf - nv);
    const rw = Math.max(0, bedarf - nv - tww);
    if (nv > 0.1)  waermeOnly.push({ label:'Netzverluste', value:nv, color:C.bandVerlust, dir:'out', verlust:true });
    if (tww > 0.1) waermeOnly.push({ label:'TWW', value:tww, color:'#ff8a65', dir:'out' });
    if (rw > 0.1)  waermeOnly.push({ label:'Raumwärme', value:rw, color:C.bedarf, dir:'out' });
  } else {
    waermeOnly.push({ label:'Wärmebedarf', value:bedarf, color:C.bedarf, dir:'out' });
  }
  if (speicher.tsLade > 0.1)    waermeOnly.push({ label:'Speicher ↓', value:speicher.tsLade, color:C.speicher, dir:'out' });
  if (speicher.tsEntlade > 0.1) waermeOnly.push({ label:'Speicher ↑', value:speicher.tsEntlade, color:C.speicher, dir:'in' });

  const verlustNodes = [];
  if (detail) {
    const etas = _sankeyEtas();
    for (const e of erzeuger) {
      const eta = etas[e.key];
      if (eta && e.kw > 0.1) {
        const brennstoff = e.kw / eta;
        const verlust = brennstoff - e.kw;
        sonder.push({ label:_SANKEY_BRENNSTOFF_LBL[e.key], value:brennstoff, color:C.bandBrennstoff, target:e.key, dezent:true });
        annotations.push({ anchor:'erzeuger', erzKey:e.key, text:'η ' + Math.round(eta*100) + '%' });
        if (verlust > 0.5) verlustNodes.push({ label:'η-Verlust', value:verlust, source:e.key, sourceType:'waermeIn' });
      }
    }
    if (bhkwErz && bhkwErz.kw > 0.1) {
      const eta = etas.bhkw;
      const brennstoff = (bhkwErz.kw + (strom.bhkwKw||0)) / eta;
      const bhSonder = sonder.find(s => s.target === 'bhkw');
      if (bhSonder) bhSonder.value = brennstoff;
      const verlust = brennstoff - bhkwErz.kw - (strom.bhkwKw||0);
      annotations.push({ anchor:'erzeuger', erzKey:'bhkw', text:'η ' + Math.round(eta*100) + '%' });
      if (verlust > 0.5) verlustNodes.push({ label:'η-Verlust', value:verlust, source:'bhkw', sourceType:'bridge' });
    }
    if (speicher.tsKap > 0) {
      const v = speicher.tsKap * 0.005;
      if (v > 0.1) verlustNodes.push({ label:'Speicher-Verlust', value:v, source:'speicher', sourceType:'speicher' });
    }
    const batKw = (strom.batLadeKw||0) + (strom.batEntladeKw||0);
    if (batKw > 0.1) verlustNodes.push({ label:'Bat-Verlust', value:batKw*0.05, source:'bat', sourceType:'bat' });
  }

  return { stromOnly, waermeOnly, bridges, sonder, annotations, verlustNodes };
}

export function _buildFlowSankey(container, data, mode) {
  // Stop alte Animation
  if (container._sankeyAnim) { cancelAnimationFrame(container._sankeyAnim); container._sankeyAnim = null; }

  // Canvas anlegen oder wiederverwenden
  let canvas = container.querySelector('canvas.live-sankey');
  if (!canvas) {
    container.innerHTML = '';
    canvas = document.createElement('canvas');
    canvas.className = 'live-sankey';
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    container.appendChild(canvas);
  }
  // Tooltip
  let tt = container.querySelector('.live-sankey-tt');
  if (!tt) {
    tt = document.createElement('div');
    tt.className = 'live-sankey-tt';
    tt.style.cssText = 'position:absolute;pointer-events:none;background:#1a1d26;color:#cfd8dc;border:1px solid #2a3040;border-radius:4px;padding:4px 8px;font-family:DM Mono,monospace;font-size:10px;display:none;white-space:nowrap;z-index:99;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
    container.style.position = 'relative';
    container.appendChild(tt);
  }

  const detail = (mode === 'sankey-detail');
  // Container-Höhe sicherstellen
  if (container.clientHeight < 100) container.style.minHeight = '420px';

  _drawSankeyOnCanvas(canvas, data, detail, tt);
}

function _drawSankeyOnCanvas(canvas, data, detail, tt) {
  const C = _SANKEY_C;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600, cssH = canvas.clientHeight || 420;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cls = _sankeyClassify(data, detail);
  const { stromOnly, waermeOnly, bridges, sonder, annotations, verlustNodes } = cls;

  const hubR = 50, cy = cssH / 2;
  const hubStrom = { cx: cssW * 0.30, cy, r: hubR, color: C.hubStrom, label: 'STROM' };
  const hubWaerme = { cx: cssW * 0.70, cy, r: hubR, color: C.hubWaerme, label: 'WÄRME' };

  const stromIn = stromOnly.filter(s => s.dir === 'in');
  const stromOut = stromOnly.filter(s => s.dir === 'out');
  const waermeIn = waermeOnly.filter(s => s.dir === 'in');
  const waermeOut = waermeOnly.filter(s => s.dir === 'out');

  const boxW = 90, boxH = 26, vGap = 12;
  function placeColumn(items, x, startY) {
    const total = items.length * boxH + Math.max(0, items.length - 1) * vGap;
    let y = startY ?? (cy - total / 2);
    return items.map(it => {
      const r = { ...it, x, y, w: boxW, h: boxH };
      y += boxH + vGap;
      return r;
    });
  }
  const xStromLeft = 14;
  const stromInBoxes  = placeColumn(stromIn,  xStromLeft, 30);
  const stromOutBoxes = placeColumn(stromOut, xStromLeft, cssH - 30 - (stromOut.length*boxH + Math.max(0,stromOut.length-1)*vGap));
  const xWaermeRight = cssW - 14 - boxW;
  const waermeInBoxes  = placeColumn(waermeIn,  xWaermeRight, 30);
  const waermeOutBoxes = placeColumn(waermeOut, xWaermeRight, cssH - 30 - (waermeOut.length*boxH + Math.max(0,waermeOut.length-1)*vGap));

  const xBridgeMid = (hubStrom.cx + hubWaerme.cx) / 2;
  const bridgeBoxW = 110, bridgeBoxH = 30;
  const bridgeGap = bridges.length >= 3 ? 56 : 78;
  const totalBridgeH = bridges.length * bridgeBoxH + Math.max(0, bridges.length - 1) * bridgeGap;
  let by = cy - totalBridgeH / 2;
  const bridgeBoxes = bridges.map(b => {
    const r = { ...b, x: xBridgeMid - bridgeBoxW/2, y: by, w: bridgeBoxW, h: bridgeBoxH };
    by += bridgeBoxH + bridgeGap;
    return r;
  });

  // Sonder-Layout
  const sonderByTarget = {};
  sonder.forEach(s => { (sonderByTarget[s.target] = sonderByTarget[s.target] || []).push(s); });
  const sonderBoxes = [];
  for (const tgt in sonderByTarget) {
    const items = sonderByTarget[tgt];
    let target = bridgeBoxes.find(b => b.kind === tgt);
    if (!target) target = waermeInBoxes.find(w => w.key === tgt);
    if (!target) continue;
    items.forEach(s => {
      const isDezent = !!s.dezent;
      const sw = isDezent ? 60 : boxW;
      const sh = isDezent ? 16 : boxH;
      const yOff = isDezent ? 12 : 8;
      let x, y;
      if (bridgeBoxes.includes(target)) {
        x = target.x + (target.w - sw)/2;
        y = target.y - sh - yOff;
      } else {
        x = target.x - sw - 12;
        y = target.y + (target.h - sh)/2;
      }
      sonderBoxes.push({ ...s, x, y, w:sw, h:sh, anchor:bridgeBoxes.includes(target)?'bottom':'left', bridge:target, dezent:isDezent });
    });
  }

  // Verlust-Boxen
  const verlustBoxes = [];
  for (const v of (verlustNodes || [])) {
    let src = null;
    if (v.sourceType === 'waermeIn') src = waermeInBoxes.find(w => w.key === v.source);
    else if (v.sourceType === 'bridge') src = bridgeBoxes.find(b => b.kind === v.source);
    else if (v.sourceType === 'speicher') src = [...waermeOutBoxes, ...waermeInBoxes].find(w => w.label && w.label.startsWith('Speicher'));
    else if (v.sourceType === 'bat') src = [...stromInBoxes, ...stromOutBoxes].find(b => b.label && b.label.startsWith('Batterie'));
    if (!src) continue;
    const vw = 70, vh = 16;
    verlustBoxes.push({ label:v.label, value:v.value, color:C.bandVerlust, x:src.x+(src.w-vw)/2, y:src.y+src.h+14, w:vw, h:vh, source:src, dezent:true });
  }

  const allValues = [
    ...stromInBoxes.map(b=>b.value), ...stromOutBoxes.map(b=>b.value),
    ...waermeInBoxes.map(b=>b.value), ...waermeOutBoxes.map(b=>b.value),
    ...bridgeBoxes.map(b=>b.kw), ...sonderBoxes.map(b=>b.value),
  ];
  const maxVal = Math.max(...allValues, 1);
  const bandScale = 30 / maxVal;
  const bandWidth = v => Math.max(1.5, v * bandScale);
  const allBands = [];

  function hubAnchor(hub, fx, fy) {
    const dx = fx - hub.cx, dy = fy - hub.cy;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    return { x: hub.cx + dx/len * hub.r, y: hub.cy + dy/len * hub.r };
  }

  function drawBand(p0, p1, w, color) {
    const dx = p1.x - p0.x;
    const cx0 = p0.x + dx*0.55, cy0 = p0.y;
    const cx1 = p1.x - dx*0.55, cy1 = p1.y;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) + Math.PI/2;
    const ox = Math.cos(angle)*w/2, oy = Math.sin(angle)*w/2;
    ctx.beginPath();
    ctx.moveTo(p0.x+ox, p0.y+oy);
    ctx.bezierCurveTo(cx0+ox, cy0+oy, cx1+ox, cy1+oy, p1.x+ox, p1.y+oy);
    ctx.lineTo(p1.x-ox, p1.y-oy);
    ctx.bezierCurveTo(cx1-ox, cy1-oy, cx0-ox, cy0-oy, p0.x-ox, p0.y-oy);
    ctx.closePath();
    ctx.fillStyle = color; ctx.globalAlpha = 0.42; ctx.fill(); ctx.globalAlpha = 1;
    return { p0, p1, w, color, cx0, cy0, cx1, cy1 };
  }

  function drawHub(h) {
    ctx.fillStyle = h.color; ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(h.cx, h.cy, h.r, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = h.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.cx, h.cy, h.r, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = h.color; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font = 'bold 13px DM Sans, sans-serif';
    ctx.fillText(h.label, h.cx, h.cy - 6);
    let total = 0;
    if (h === hubStrom) total = stromInBoxes.reduce((s,b)=>s+b.value,0) + bridges.filter(b=>b.kind==='bhkw').reduce((s,b)=>s+(b.stromOut||0),0);
    else total = waermeInBoxes.reduce((s,b)=>s+b.value,0) + bridges.reduce((s,b)=>s+(b.waermeOut||0),0);
    ctx.font = '10px DM Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(Math.round(total) + ' kW', h.cx, h.cy + 8);
  }

  function drawBox(b, color) {
    const isDezent = !!b.dezent;
    ctx.fillStyle = color || '#3a4252'; ctx.globalAlpha = isDezent?0.10:0.18;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color || '#5e6b70'; ctx.lineWidth = isDezent?0.7:1;
    ctx.strokeRect(b.x+0.5, b.y+0.5, b.w-1, b.h-1);
    ctx.fillStyle = color || '#cfd8dc'; ctx.textAlign='center'; ctx.textBaseline='middle';
    if (isDezent) {
      ctx.font = '8px DM Mono, monospace';
      ctx.fillText(b.label + ' ' + Math.round(b.value||b.kw) + ' kW', b.x+b.w/2, b.y+b.h/2);
    } else {
      ctx.font = '10px DM Mono, monospace';
      ctx.fillText(b.label, b.x+b.w/2, b.y+b.h/2 - 4);
      ctx.font = '9px DM Mono, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(Math.round(b.value||b.kw) + ' kW' + (b.cop?' · COP '+b.cop.toFixed(1):''), b.x+b.w/2, b.y+b.h/2 + 7);
    }
  }

  function drawAnnotations() {
    if (!detail || !annotations || !annotations.length) return;
    ctx.font = '9px DM Mono, monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
    for (const a of annotations) {
      let target = null;
      if (a.anchor==='erzeuger' && a.erzKey) {
        const wpKeys = ['lwwp','fg','geo'];
        if (wpKeys.includes(a.erzKey)) target = bridgeBoxes.find(b=>b.kind==='wp');
        else if (a.erzKey==='bhkw') target = bridgeBoxes.find(b=>b.kind==='bhkw');
        else target = waermeInBoxes.find(w=>w.key===a.erzKey);
      }
      if (!target) continue;
      const verlustBox = verlustBoxes.find(v => v.source === target);
      const text = a.text;
      const padX = 5, padY = 2;
      const textW = ctx.measureText(text).width;
      const px = target.x + target.w/2 - (textW+padX*2)/2;
      const py = (verlustBox ? verlustBox.y + verlustBox.h : target.y + target.h) + 5;
      ctx.fillStyle = 'rgba(15,17,22,0.85)';
      ctx.fillRect(px, py, textW+padX*2, 12+padY*2);
      ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 0.5;
      ctx.strokeRect(px+0.5, py+0.5, textW+padX*2-1, 12+padY*2-1);
      ctx.fillStyle = '#cfd8dc';
      ctx.fillText(text, target.x+target.w/2, py+padY+1);
    }
  }

  function renderAll() {
    ctx.clearRect(0, 0, cssW, cssH);
    allBands.forEach(g => drawBand(g.p0, g.p1, g.w, g.color));
    drawHub(hubStrom); drawHub(hubWaerme);
    stromInBoxes.forEach(b=>drawBox(b, b.color));
    stromOutBoxes.forEach(b=>drawBox(b, b.color));
    waermeInBoxes.forEach(b=>drawBox(b, b.color));
    waermeOutBoxes.forEach(b=>drawBox(b, b.color));
    bridgeBoxes.forEach(b => drawBox({ ...b, value:b.kw }, b.color));
    sonderBoxes.forEach(s => drawBox(s, s.color));
    verlustBoxes.forEach(v => drawBox(v, v.color));
    drawAnnotations();
  }

  function stromBandColor(b) {
    if (b.label === 'Netzbezug')   return C.bandBezug;
    if (b.label === 'Einspeisung') return C.bandEinsp;
    return C.bandStrom;
  }

  // Bänder zeichnen + sammeln
  stromInBoxes.forEach(b => {
    const from = { x: b.x + b.w, y: b.y + b.h/2 };
    const to = hubAnchor(hubStrom, from.x, from.y);
    const g = drawBand(from, to, bandWidth(b.value), stromBandColor(b));
    allBands.push({ ...g, label: b.label + ' → Strom', value: b.value });
  });
  stromOutBoxes.forEach(b => {
    const to = { x: b.x + b.w, y: b.y + b.h/2 };
    const from = hubAnchor(hubStrom, to.x, to.y);
    const g = drawBand(from, to, bandWidth(b.value), stromBandColor(b));
    allBands.push({ ...g, label: 'Strom → ' + b.label, value: b.value });
  });
  waermeInBoxes.forEach(b => {
    const from = { x: b.x, y: b.y + b.h/2 };
    const to = hubAnchor(hubWaerme, from.x, from.y);
    const g = drawBand(from, to, bandWidth(b.value), C.bandWaerme);
    allBands.push({ ...g, label: b.label + ' → Wärme', value: b.value });
  });
  waermeOutBoxes.forEach(b => {
    const to = { x: b.x, y: b.y + b.h/2 };
    const from = hubAnchor(hubWaerme, to.x, to.y);
    const bandCol = b.verlust ? C.bandVerlust : C.bandWaerme;
    const g = drawBand(from, to, bandWidth(b.value), bandCol);
    allBands.push({ ...g, label: 'Wärme → ' + b.label, value: b.value });
  });
  bridgeBoxes.forEach(b => {
    const by_ = b.y + b.h/2;
    if (b.kind === 'wp') {
      const aFrom = hubAnchor(hubStrom, b.x, by_);
      const aTo = { x:b.x, y:by_ };
      const g1 = drawBand(aFrom, aTo, bandWidth(b.stromIn||0), C.bandStrom);
      allBands.push({ ...g1, label:'Strom → '+b.label, value:b.stromIn });
      const cFrom = { x:b.x+b.w, y:by_ };
      const cTo = hubAnchor(hubWaerme, b.x+b.w, by_);
      const g2 = drawBand(cFrom, cTo, bandWidth(b.waermeOut||0), C.bandWaerme);
      allBands.push({ ...g2, label:b.label+' → Wärme', value:b.waermeOut });
    } else if (b.kind === 'bhkw') {
      const aFrom = { x:b.x, y:by_ };
      const aTo = hubAnchor(hubStrom, b.x, by_);
      const g1 = drawBand(aFrom, aTo, bandWidth(b.stromOut||0), C.bandStrom);
      allBands.push({ ...g1, label:b.label+' → Strom', value:b.stromOut });
      const cFrom = { x:b.x+b.w, y:by_ };
      const cTo = hubAnchor(hubWaerme, b.x+b.w, by_);
      const g2 = drawBand(cFrom, cTo, bandWidth(b.waermeOut||0), C.bandWaerme);
      allBands.push({ ...g2, label:b.label+' → Wärme', value:b.waermeOut });
    } else if (b.kind === 'sk') {
      const aFrom = hubAnchor(hubStrom, b.x, by_);
      const aTo = { x:b.x, y:by_ };
      const g1 = drawBand(aFrom, aTo, bandWidth(b.stromIn||0), C.bandStrom);
      allBands.push({ ...g1, label:'Strom → '+b.label, value:b.stromIn });
      const cFrom = { x:b.x+b.w, y:by_ };
      const cTo = hubAnchor(hubWaerme, b.x+b.w, by_);
      const g2 = drawBand(cFrom, cTo, bandWidth(b.waermeOut||0), C.bandWaerme);
      allBands.push({ ...g2, label:b.label+' → Wärme', value:b.waermeOut });
    }
  });
  sonderBoxes.forEach(s => {
    let from, to;
    if (s.anchor === 'left') {
      from = { x:s.x+s.w, y:s.y+s.h/2 };
      to = { x:s.bridge.x, y:s.bridge.y+s.bridge.h/2 };
    } else {
      from = { x:s.x+s.w/2, y:s.y+s.h };
      to = { x:s.bridge.x+s.bridge.w/2, y:s.bridge.y };
    }
    const bandCol = s.target === 'wp' ? C.bandUmwelt : C.bandBrennstoff;
    const g = drawBand(from, to, bandWidth(s.value), bandCol);
    allBands.push({ ...g, label:s.label, value:s.value });
  });
  verlustBoxes.forEach(v => {
    const from = { x:v.source.x+v.source.w/2, y:v.source.y+v.source.h };
    const to = { x:v.x+v.w/2, y:v.y };
    const g = drawBand(from, to, Math.max(2, bandWidth(v.value)*0.6), v.color);
    allBands.push({ ...g, label:v.label, value:v.value });
  });

  // Initial-Render (Bänder + Knoten)
  renderAll();

  // Hover-Geometrie
  const allBoxes = [
    { name:'STROM-Hub', x:hubStrom.cx-hubR, y:hubStrom.cy-hubR, w:hubR*2, h:hubR*2,
      val:stromInBoxes.reduce((s,b)=>s+b.value,0)+bridges.filter(b=>b.kind==='bhkw').reduce((s,b)=>s+(b.stromOut||0),0) },
    { name:'WÄRME-Hub', x:hubWaerme.cx-hubR, y:hubWaerme.cy-hubR, w:hubR*2, h:hubR*2,
      val:waermeInBoxes.reduce((s,b)=>s+b.value,0)+bridges.reduce((s,b)=>s+(b.waermeOut||0),0) },
    ...stromInBoxes.map(b=>({name:b.label,x:b.x,y:b.y,w:b.w,h:b.h,val:b.value})),
    ...stromOutBoxes.map(b=>({name:b.label,x:b.x,y:b.y,w:b.w,h:b.h,val:b.value})),
    ...waermeInBoxes.map(b=>({name:b.label,x:b.x,y:b.y,w:b.w,h:b.h,val:b.value})),
    ...waermeOutBoxes.map(b=>({name:b.label,x:b.x,y:b.y,w:b.w,h:b.h,val:b.value})),
    ...bridgeBoxes.map(b=>({name:b.label,x:b.x,y:b.y,w:b.w,h:b.h,val:b.kw})),
    ...sonderBoxes.map(s=>({name:s.label,x:s.x,y:s.y,w:s.w,h:s.h,val:s.value})),
    ...verlustBoxes.map(v=>({name:v.label,x:v.x,y:v.y,w:v.w,h:v.h,val:v.value})),
  ];
  canvas._sankeyBoxes = allBoxes;
  canvas._sankeyBands = allBands;

  if (!canvas._hoverInit) {
    canvas._hoverInit = true;
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let hit = null;
      for (const b of canvas._sankeyBoxes || []) {
        if (mx>=b.x && mx<=b.x+b.w && my>=b.y && my<=b.y+b.h) { hit = '<b>'+b.name+'</b><br>'+Math.round(b.val)+' kW'; break; }
      }
      if (!hit) {
        for (const g of canvas._sankeyBands || []) {
          const steps = 24;
          let on = false;
          for (let i = 0; i <= steps; i++) {
            const t = i/steps, it = 1-t;
            const bx = it*it*it*g.p0.x + 3*it*it*t*g.cx0 + 3*it*t*t*g.cx1 + t*t*t*g.p1.x;
            const by_ = it*it*it*g.p0.y + 3*it*it*t*g.cy0 + 3*it*t*t*g.cy1 + t*t*t*g.p1.y;
            if (Math.hypot(mx-bx, my-by_) <= Math.max(4, g.w/2 + 1)) { on = true; break; }
          }
          if (on) { hit = g.label + '<br><b>'+Math.round(g.value)+' kW</b>'; break; }
        }
      }
      if (hit) {
        tt.innerHTML = hit; tt.style.display = 'block';
        tt.style.left = (e.clientX - rect.left + 14) + 'px';
        tt.style.top = (e.clientY - rect.top + 14) + 'px';
      } else { tt.style.display = 'none'; }
    });
    canvas.addEventListener('mouseleave', () => tt.style.display = 'none');
  }

  // Animation-Loop
  let phase = 0;
  function tick() {
    phase = (phase + 0.005) % 1;
    renderAll();
    allBands.forEach(g => {
      const tt2 = (phase + (g.value % 0.7)) % 1;
      const t = tt2, it = 1-t;
      const x = it*it*it*g.p0.x + 3*it*it*t*g.cx0 + 3*it*t*t*g.cx1 + t*t*t*g.p1.x;
      const y = it*it*it*g.p0.y + 3*it*it*t*g.cy0 + 3*it*t*t*g.cy1 + t*t*t*g.p1.y;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, g.w/4), 0, Math.PI*2);
      ctx.fillStyle = g.color; ctx.globalAlpha = 0.9; ctx.fill();
      ctx.globalAlpha = 1;
    });
    canvas.parentElement._sankeyAnim = requestAnimationFrame(tick);
  }
  canvas.parentElement._sankeyAnim = requestAnimationFrame(tick);
}

export function _initDragOverlay(el, handle) {
  let ox = 0, oy = 0, sx = 0, sy = 0;
  handle.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    sx = e.clientX; sy = e.clientY;
    handle.style.cursor = 'grabbing';
    // Switch from centered to explicit left/top positioning
    if (el.style.transform) {
      const rect = el.getBoundingClientRect();
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.transform = 'none';
    }
    function onMove(ev) {
      ox = ev.clientX - sx; oy = ev.clientY - sy;
      sx = ev.clientX; sy = ev.clientY;
      el.style.left = (el.offsetLeft + ox) + 'px';
      el.style.top = (el.offsetTop + oy) + 'px';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function _updateHourlyOverlay(t) {
  const hourly = window._dispatchHourly;
  const keys = window._dispatchActiveKeys || [];
  const ss = window.systemState;
  if (!hourly || !ss) return;

  // Daten sammeln — Lastgang aus Dispatch (synchron mit Erzeugern), Fallback auf systemState
  const lastKw = window._dispatchLastgangKw?.[t] ?? ss.lastgangKw?.[t] ?? 0;
  const tempC = ss.tempH?.[t] || 0;
  const vlC = ss.vlH?.[t] || 0;

  // Erzeuger (_autoGk separat behandelt, nicht doppelt zählen)
  const erzeuger = [];
  for (const k of keys) {
    if (k === '_autoGk' || k === '_thermSpeicher' || k === 'solarthermie') continue; // separat unten
    const arr = hourly[k];
    if (!arr) continue;
    const kw = arr[t] || 0;
    if (kw < 0.01 && !['lwwp','fg','geo','gaskessel','bhkw','pellets','hhs','heizoel','fernwaerme','stromkessel'].includes(k)) continue;
    erzeuger.push({ label: ERZEUGER_CFG[k]?.label || k, kw, color: ERZEUGER_CFG[k]?.color || '#aaa', key: k });
  }
  if (hourly['solarthermie']?.[t] > 0.01) erzeuger.push({ label: 'Solarthermie', kw: hourly['solarthermie'][t], color: '#ffab40', key: 'solarthermie' });
  if (hourly['_thermSpeicher']?.[t] > 0.01) erzeuger.push({ label: 'Speicher \u2192', kw: hourly['_thermSpeicher'][t], color: '#26a69a', key: '_thermSpeicher' });
  if (hourly['_autoGk']?.[t] > 0.01) erzeuger.push({ label: 'GK-Backup', kw: hourly['_autoGk'][t], color: '#78909c', key: '_autoGk' });
  const erzFiltered = erzeuger.filter(e => e.kw > 0.01);

  // Speicher
  const tss = window._thermSpeicherState;
  const speicher = {
    tsKap: tss?.params?.kapKwh || 0,
    tsSoc: tss?.socH?.[t] || 0,
    tsLade: tss?.ladeH?.[t] || 0,
    tsEntlade: hourly['_thermSpeicher']?.[t] || 0,
  };

  // Strom
  const pvKw = window._stromPvH?.[t] || window.elPvH?.[t] || 0;
  const bhkwElKw = window._bhkwElHourly?.[t] || 0;
  const wpElKw = window._wpElHourly?.[t] || 0;
  const skElKw = window._skElHourly?.[t] || 0;
  const hhKw = window.elQuartierH?.[t] || window._elQuartierFromGeb?.[t] || 0;
  const batKap = parseFloat(document.getElementById('bat-kapazitaet')?.value) || 0;
  const batSocNow = window._stromBatSocH?.[t] || 0;
  const batSocPrev = t > 0 ? (window._stromBatSocH?.[t-1] || 0) : batSocNow;
  const batDelta = batSocNow - batSocPrev; // positiv = laden, negativ = entladen
  const batLadeKw = Math.max(0, batDelta);   // kW die in Batterie fließen
  const batEntladeKw = Math.max(0, -batDelta); // kW die aus Batterie kommen
  const stromErz = pvKw + bhkwElKw + batEntladeKw;
  const stromVerb = wpElKw + skElKw + hhKw + batLadeKw;
  const strom = {
    pvKw, bhkwKw: bhkwElKw, wpKw: wpElKw, skKw: skElKw,
    hhKw,
    batLadeKw, batEntladeKw,
    einspeisungKw: Math.max(0, stromErz - stromVerb),
    netzbezugKw: Math.max(0, stromVerb - stromErz),
    batSoc: batSocNow,
    batKap,
  };

  // Init click handler once
  if (!window._liveStackClickInit) {
    window._liveStackClickInit = true;
    function _liveChartClick(ev) {
      const rect = ev.target.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      const sl = document.getElementById('live-slider');
      const curHour = parseInt(sl?.value) || 0;
      const range = (typeof _getLiveZoomRange === 'function') ? _getLiveZoomRange(curHour) : { start: 0, end: 8760 };
      const newH = Math.round(range.start + frac * (range.end - range.start));
      if (sl) sl.value = Math.max(0, Math.min(8759, newH));
      _onHourSlider(Math.max(0, Math.min(8759, newH)));
    }
    const stackC = document.getElementById('live-stack-canvas');
    const stromC = document.getElementById('live-strom-canvas');
    const socC = document.getElementById('live-soc-canvas');
    if (stackC) stackC.addEventListener('click', _liveChartClick);
    if (stromC) stromC.addEventListener('click', _liveChartClick);
    if (socC) socC.addEventListener('click', _liveChartClick);
  }

  // Sync slider
  const liveSlider = document.getElementById('live-slider');
  if (liveSlider && parseInt(liveSlider.value) !== t) liveSlider.value = t;

  // Titel + Stundenzähler
  const titleEl = document.getElementById('live-title');
  if (titleEl) titleEl.textContent = _hourToDateStr(t);
  const hourCounter = document.getElementById('live-hour-counter');
  if (hourCounter) hourCounter.textContent = 'Stunde ' + t + ' / 8760';
  const flowHour = document.getElementById('live-flow-hour');
  if (flowHour) flowHour.textContent = 'Stunde ' + t;
  // Timeline sync
  _updateLiveTimeline(t);

  // Season badge
  const seasonBadge = document.getElementById('live-season-badge');
  if (seasonBadge) {
    const month = Math.floor(t / 730);
    const seasons = ['\u2744\ufe0f Winter','\u2744\ufe0f Winter','\ud83c\udf31 Fr\u00fchling','\ud83c\udf31 Fr\u00fchling','\ud83c\udf31 Fr\u00fchling','\u2600\ufe0f Sommer','\u2600\ufe0f Sommer','\u2600\ufe0f Sommer','\ud83c\udf42 Herbst','\ud83c\udf42 Herbst','\ud83c\udf42 Herbst','\u2744\ufe0f Winter'];
    seasonBadge.textContent = seasons[Math.min(month, 11)];
  }

  // KPI-Cells (Premium Dashboard)
  const kpiBar = document.getElementById('live-kpi-bar');
  if (kpiBar) {
    const sumKw = erzFiltered.reduce((s, e) => s + e.kw, 0);
    const delta = sumKw - lastKw;
    const deckung = lastKw > 0 ? Math.min(100, sumKw / lastKw * 100) : 0;
    // Farbe am angezeigten (gerundeten) Wert festmachen — sonst erscheint "100%" orange
    const deckungAnzeige = Math.round(deckung);
    const deckColor = deckungAnzeige >= 100 ? '#66bb6a' : (deckungAnzeige >= 80 ? '#ffb74d' : '#ef5350');
    const deltaArrow = delta >= 0 ? '\u25b2' : '\u25bc';
    const deltaColor = delta >= 0 ? 'rgba(102,187,106,0.7)' : 'rgba(239,83,80,0.7)';
    const cell = (label, value, unit, color, sub) =>
      '<div class="live-kpi-cell">' +
        '<div class="kl">' + label + '</div>' +
        '<div class="kv" style="color:' + color + ';">' + value + ' <span class="ku">' + unit + '</span></div>' +
        (sub ? '<div class="ks">' + sub + '</div>' : '') +
        '<div class="kpi-bar-bottom" style="background:' + color + ';"></div>' +
      '</div>';
    let kpiHtml =
      cell('Bedarf', lastKw.toFixed(0), 'kW', '#e53935', '') +
      cell('Erzeugung', sumKw.toFixed(0), 'kW', '#66bb6a',
        '<span style="color:' + deltaColor + '">' + deltaArrow + ' ' + Math.abs(delta).toFixed(0) + ' kW</span> \u00b7 ' +
        '<span style="color:' + deckColor + '">' + deckung.toFixed(0) + '% Deckung</span>') +
      cell('Au\u00dfentemp.', tempC.toFixed(1), '\u00b0C', '#64b5f6',
        'VL ' + vlC.toFixed(0) + ' \u00b0C \u00b7 \u0394T ' + Math.abs(vlC - tempC).toFixed(0) + 'K');
    if (speicher.tsKap > 0) {
      const pct = Math.min(100, Math.max(0, speicher.tsSoc / speicher.tsKap * 100));
      const dir = speicher.tsLade > 0.1 ? ' \u25b2 +' + speicher.tsLade.toFixed(0) + ' kW' : (speicher.tsEntlade > 0.1 ? ' \u25bc \u2212' + speicher.tsEntlade.toFixed(0) + ' kW' : ' \u2500 Ruhe');
      const gaugeColor = pct > 60 ? '#26a69a' : (pct > 25 ? '#ffb74d' : '#ef5350');
      kpiHtml +=
        '<div class="live-kpi-cell">' +
          '<div class="kl">Speicher</div>' +
          '<div class="kv" style="color:#26a69a;">' + pct.toFixed(0) + ' <span class="ku">%</span></div>' +
          '<div class="live-kpi-gauge"><div class="live-kpi-gauge-fill" style="width:' + pct.toFixed(1) + '%;background:' + gaugeColor + ';"></div></div>' +
          '<div class="ks">' + speicher.tsSoc.toFixed(0) + '/' + speicher.tsKap.toFixed(0) + ' kWh' + dir + '</div>' +
        '</div>';
    }
    // PV/Strom
    const pvKwVal = strom.pvKw;
    const gridIcon = strom.netzbezugKw > 0.1 ? '\u25bc' : (strom.einspeisungKw > 0.1 ? '\u25b2' : '\u2500');
    const gridColor = strom.netzbezugKw > 0.1 ? 'rgba(239,83,80,0.6)' : (strom.einspeisungKw > 0.1 ? 'rgba(76,175,80,0.6)' : 'rgba(255,255,255,0.3)');
    const gridSub = strom.netzbezugKw > 0.1 ? '<span style="color:' + gridColor + '">' + gridIcon + ' Bezug ' + strom.netzbezugKw.toFixed(0) + ' kW</span>'
      : (strom.einspeisungKw > 0.1 ? '<span style="color:' + gridColor + '">' + gridIcon + ' Einsp. ' + strom.einspeisungKw.toFixed(0) + ' kW</span>' : '<span style="color:' + gridColor + '">' + gridIcon + ' Ausgeglichen</span>');
    kpiHtml += cell('PV / Strom', pvKwVal.toFixed(0), 'kW', '#fdd835', gridSub);
    kpiBar.innerHTML = kpiHtml;
  }

  // ── Stacked-Chart zeichnen ──
  const stackCanvas = document.getElementById('live-stack-canvas');
  if (stackCanvas) {
    _drawStackedDispatch(stackCanvas, t, keys, hourly, ss);
  }

  // ── Speicher-SOC-Chart zeichnen ──
  const socCanvas = document.getElementById('live-soc-canvas');
  const socPanel = document.getElementById('live-chart-soc');
  const tssForSoc = window._thermSpeicherState;
  if (tssForSoc && tssForSoc.socH && tssForSoc.params?.kapKwh > 0) {
    if (socPanel) socPanel.style.display = '';
    if (socCanvas) _drawSpeicherSocChart(socCanvas, t);
    const socInfo = document.getElementById('live-soc-info');
    if (socInfo) {
      const pctNow = Math.min(100, Math.max(0, (tssForSoc.socH[t] || 0) / tssForSoc.params.kapKwh * 100));
      socInfo.textContent = pctNow.toFixed(0) + '% \u00B7 ' + (tssForSoc.socH[t] || 0).toFixed(0) + ' kWh';
    }
  } else {
    if (socPanel) socPanel.style.display = 'none';
  }

  // ── Flow-Schema zeichnen ── Mode aus localStorage (Default: Hub-Sankey)
  const flowSvgDiv = document.getElementById('live-flow-svg');
  if (flowSvgDiv) {
    const flowMode = localStorage.getItem('live-flow-mode') || 'sankey';
    const flowData = { erzeuger: erzFiltered, bedarf: lastKw, speicher, strom, tempC, vlC, t };
    if (flowMode === 'sankey' || flowMode === 'sankey-detail') {
      _buildFlowSankey(flowSvgDiv, flowData, flowMode);
    } else {
      // Mode-Wechsel zurück: Canvas + Tooltip aufräumen, Animation stoppen
      if (flowSvgDiv._sankeyAnim) { cancelAnimationFrame(flowSvgDiv._sankeyAnim); flowSvgDiv._sankeyAnim = null; }
      _buildFlowSVG(flowSvgDiv, flowData);
    }
  }

  // ── Strom-Bilanz zeichnen ──
  const stromCanvas = document.getElementById('live-strom-canvas');
  const stromPanel = document.getElementById('live-chart-strom');
  if (stromCanvas) {
    // Auto-hide if no power data
    const hasAnyStrom = strom.pvKw > 0.1 || strom.bhkwKw > 0.1 || strom.wpKw > 0.1 || strom.skKw > 0.1 || strom.hhKw > 0.1 || strom.batKap > 0;
    if (stromPanel) stromPanel.style.display = hasAnyStrom ? '' : 'none';
    if (hasAnyStrom) _drawStromBilanz(stromCanvas, t);
  }
}

// Zeitschieber einblenden wenn Dispatch-Daten vorhanden
export function _checkShowHourlySlider() {
  if (window._dispatchHourly && window._dispatchActiveKeys?.length > 0) {
    _showHourlySlider();
  } else {
    _hideHourlySlider();
  }
}

// ── Speicher-SOC-Chart (separate Canvas) ────────────────────────────────
export function _drawSpeicherSocChart(canvas, currentHour) {
  const parent = canvas.parentElement;
  const W = (parent?.offsetWidth || 400) - 4;
  const H = Math.max(60, (parent?.offsetHeight || 100) - 4);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const tss = window._thermSpeicherState;
  if (!tss || !tss.socH || !tss.params?.kapKwh) return;
  const socH = tss.socH;
  const kapKwh = tss.params.kapKwh;

  const PAD = { l: 46, r: 12, t: 6, b: 24 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  // Zoom range
  const range = _getLiveZoomRange(currentHour);
  const rangeLen = range.end - range.start;

  // Background
  const bgGrad = ctx.createLinearGradient(PAD.l, PAD.t, PAD.l, PAD.t + plotH);
  bgGrad.addColorStop(0, 'rgba(0,0,0,0.15)');
  bgGrad.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = bgGrad;
  ctx.beginPath(); ctx.roundRect(PAD.l, PAD.t, plotW, plotH, 4); ctx.fill();

  // Y-Axis (0%, 50%, 100%)
  ctx.font = '8px "DM Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 2; i++) {
    const frac = i / 2;
    const yy = PAD.t + plotH * (1 - frac);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + plotW, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(38,166,154,0.5)';
    ctx.fillText((frac * 100).toFixed(0) + '%', PAD.l - 4, yy);
  }

  // Downsample
  const samplesPerPx = Math.max(1, Math.ceil(rangeLen / plotW));
  const nSamples = Math.ceil(rangeLen / samplesPerPx);

  // SOC area fill
  ctx.beginPath();
  for (let s = 0; s < nSamples; s++) {
    const t0 = range.start + s * samplesPerPx;
    const soc = socH[Math.min(t0, 8759)] || 0;
    const x = PAD.l + (s / nSamples) * plotW;
    const y = PAD.t + plotH * (1 - soc / kapKwh);
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineTo(PAD.l + plotW, PAD.t + plotH);
  ctx.lineTo(PAD.l, PAD.t + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + plotH);
  grad.addColorStop(0, 'rgba(38,166,154,0.4)');
  grad.addColorStop(1, 'rgba(38,166,154,0.05)');
  ctx.fillStyle = grad;
  ctx.fill();

  // SOC line
  ctx.beginPath();
  ctx.strokeStyle = '#26a69a';
  ctx.lineWidth = 1.5;
  for (let s = 0; s < nSamples; s++) {
    const t0 = range.start + s * samplesPerPx;
    const soc = socH[Math.min(t0, 8759)] || 0;
    const x = PAD.l + (s / nSamples) * plotW;
    const y = PAD.t + plotH * (1 - soc / kapKwh);
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current hour marker
  const curFrac = (currentHour - range.start) / rangeLen;
  if (curFrac >= 0 && curFrac <= 1) {
    const curX = PAD.l + curFrac * plotW;
    ctx.save();
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(curX, PAD.t); ctx.lineTo(curX, PAD.t + plotH); ctx.stroke();
    // Dot at current value
    const curSoc = socH[currentHour] || 0;
    const curY = PAD.t + plotH * (1 - curSoc / kapKwh);
    ctx.beginPath();
    ctx.arc(curX, curY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4dd0e1';
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.restore();
  }

  // X-Axis labels
  _drawLiveXAxis(ctx, PAD, plotW, plotH, range);
}

// ── Live-Ansicht: Zeitzoom ──────────────────────────────────────────────
export let _liveZoomMode = 'jahr';

export function _setLiveZoom(mode) {
  _liveZoomMode = mode;
  document.querySelectorAll('.live-zoom-tab').forEach(b => b.classList.toggle('active', b.dataset.zoom === mode));
  // Re-render
  const sl = document.getElementById('live-slider');
  if (sl) _onHourSlider(parseInt(sl.value) || 0);
}

export function _getLiveZoomRange(currentHour) {
  if (_liveZoomMode === 'tag') {
    const dayStart = Math.floor(currentHour / 24) * 24;
    return { start: dayStart, end: Math.min(dayStart + 24, 8760) };
  } else if (_liveZoomMode === 'woche') {
    const center = currentHour;
    const start = Math.max(0, center - 84);
    return { start, end: Math.min(start + 168, 8760) };
  } else if (_liveZoomMode === 'monat') {
    const center = currentHour;
    const start = Math.max(0, center - 360);
    return { start, end: Math.min(start + 720, 8760) };
  }
  return { start: 0, end: 8760 };
}

export function _drawLiveXAxis(ctx, PAD, plotW, plotH, range) {
  ctx.font = '8px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  const rangeLen = range.end - range.start;
  if (rangeLen <= 48) {
    // Tag/2-Tag: show hour labels
    for (let h = Math.ceil(range.start / 3) * 3; h < range.end; h += 3) {
      const x = PAD.l + ((h - range.start) / rangeLen) * plotW;
      ctx.fillText((h % 24).toString().padStart(2, '0') + ':00', x, PAD.t + plotH + 12);
    }
  } else if (rangeLen <= 200) {
    // Woche: show day labels
    for (let h = Math.ceil(range.start / 24) * 24; h < range.end; h += 24) {
      const x = PAD.l + ((h - range.start) / rangeLen) * plotW;
      const dayStr = _hourToDateStr(h).split(' ')[0];
      ctx.fillText(dayStr, x, PAD.t + plotH + 12);
    }
  } else if (rangeLen <= 800) {
    // Monat: show every 5 days
    for (let h = Math.ceil(range.start / 120) * 120; h < range.end; h += 120) {
      const x = PAD.l + ((h - range.start) / rangeLen) * plotW;
      const dayStr = _hourToDateStr(h).split(' ')[0];
      ctx.fillText(dayStr, x, PAD.t + plotH + 12);
    }
  } else {
    // Jahr: month labels
    const months = ['Jan','Feb','Mrz','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    const mHours = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
    for (let m = 0; m < 12; m++) {
      const x = PAD.l + (mHours[m] / 8760) * plotW;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + plotH); ctx.stroke();
      const midX = PAD.l + ((mHours[m] + (m < 11 ? mHours[m + 1] : 8760)) / 2 / 8760) * plotW;
      ctx.fillText(months[m], midX, PAD.t + plotH + 12);
    }
  }
}

// ── Live-Ansicht: Timeline-Slider ───────────────────────────────────────
export function _updateLiveTimeline(t) {
  const pct = (t / 8759) * 100;
  const fill = document.getElementById('live-tl-fill');
  const thumb = document.getElementById('live-tl-thumb');
  if (fill) fill.style.width = pct + '%';
  if (thumb) thumb.style.left = pct + '%';
  // Draw demand histogram once
  _drawTimelineHisto();
}

export let _tlHistoDrawn = false;
export function _drawTimelineHisto() {
  if (_tlHistoDrawn) return;
  const canvas = document.getElementById('live-tl-histo');
  const ss = window.systemState;
  const lastgang = window._dispatchLastgangKw || ss?.lastgangKw;
  if (!canvas || !lastgang) return;
  _tlHistoDrawn = true;
  const rect = canvas.parentElement;
  const W = rect?.offsetWidth || 600;
  const H = 16;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  // Downsample to pixels
  const nBars = Math.min(W, 365);
  const step = Math.floor(8760 / nBars);
  let maxKw = 1;
  const bars = new Float32Array(nBars);
  for (let i = 0; i < nBars; i++) {
    let sum = 0, cnt = 0;
    for (let t = i * step; t < Math.min((i + 1) * step, 8760); t++) {
      sum += lastgang[t] || 0; cnt++;
    }
    bars[i] = cnt > 0 ? sum / cnt : 0;
    if (bars[i] > maxKw) maxKw = bars[i];
  }
  // Draw bars with seasonal color gradient
  for (let i = 0; i < nBars; i++) {
    const x = (i / nBars) * W;
    const bw = Math.max(1, W / nBars);
    const bh = (bars[i] / maxKw) * H;
    // Color: red-warm in winter, yellow-warm in summer
    const month = Math.floor((i / nBars) * 12);
    const isWinter = month <= 1 || month >= 10;
    const isSummer = month >= 4 && month <= 8;
    const r = isWinter ? 229 : (isSummer ? 253 : 200);
    const g = isWinter ? 57 : (isSummer ? 216 : 120);
    const b = isWinter ? 53 : (isSummer ? 53 : 80);
    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.25)';
    ctx.fillRect(x, H - bh, bw, bh);
  }
}

export let _liveTlDragging = false;

export function _liveTlDown(ev) {
  ev.preventDefault();
  _liveTlDragging = true;
  _liveTlMove(ev);
  const onMove = (e) => { if (_liveTlDragging) _liveTlMove(e); };
  const onUp = () => { _liveTlDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}

export function _liveTlMove(ev) {
  const wrap = document.getElementById('live-tl-slider');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const newH = Math.round(frac * 8759);
  const sl = document.getElementById('live-slider');
  if (sl) sl.value = newH;
  _onHourSlider(newH);
}

export function _liveStep(delta) {
  const sl = document.getElementById('live-slider');
  if (!sl) return;
  const newVal = Math.max(0, Math.min(8759, parseInt(sl.value) + delta));
  sl.value = newVal;
  _onHourSlider(newVal);
}

// ── Play-Modus ──────────────────────────────────────────────────────────
export let _livePlayTimer = null;
export let _livePlaySpeed = 1;
export const _liveSpeedSteps = [1, 10, 60, 360];

export function _liveTogglePlay() {
  if (_livePlayTimer) {
    _liveStopPlay();
  } else {
    _liveStartPlay();
  }
}

export function _liveStartPlay() {
  if (_livePlayTimer) return;
  const btn = document.getElementById('live-play-btn');
  if (btn) { btn.innerHTML = '\u275A\u275A'; btn.classList.add('active'); }
  const interval = Math.max(16, 1000 / _livePlaySpeed);
  const stepsPerTick = Math.max(1, Math.floor(_livePlaySpeed / 60));
  _livePlayTimer = setInterval(() => {
    const sl = document.getElementById('live-slider');
    if (!sl) return;
    let cur = parseInt(sl.value) || 0;
    cur += stepsPerTick;
    if (cur >= 8760) cur = 0;
    sl.value = cur;
    _onHourSlider(cur);
  }, interval);
}

export function _liveStopPlay() {
  if (_livePlayTimer) { clearInterval(_livePlayTimer); _livePlayTimer = null; }
  const btn = document.getElementById('live-play-btn');
  if (btn) { btn.innerHTML = '\u25B6'; btn.classList.remove('active'); }
}

export function _liveCycleSpeed() {
  const idx = _liveSpeedSteps.indexOf(_livePlaySpeed);
  _livePlaySpeed = _liveSpeedSteps[(idx + 1) % _liveSpeedSteps.length];
  const speedBtn = document.getElementById('live-speed-btn');
  if (speedBtn) speedBtn.textContent = _livePlaySpeed + '\u00D7';
  // Restart play if active
  if (_livePlayTimer) {
    _liveStopPlay();
    _liveStartPlay();
  }
}

// ── Keyboard-Navigation ─────────────────────────────────────────────────
document.addEventListener('keydown', function(ev) {
  if (typeof currentViewMode === 'undefined' || currentViewMode !== 'live') return;
  // Ignore when focus is on input/textarea
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT') return;
  if (ev.key === 'ArrowLeft') {
    ev.preventDefault();
    _liveStep(ev.shiftKey ? -24 : -1);
  } else if (ev.key === 'ArrowRight') {
    ev.preventDefault();
    _liveStep(ev.shiftKey ? 24 : 1);
  } else if (ev.key === ' ') {
    ev.preventDefault();
    _liveTogglePlay();
  } else if (ev.key === 'Home') {
    ev.preventDefault();
    const sl = document.getElementById('live-slider');
    if (sl) { sl.value = 0; _onHourSlider(0); }
  } else if (ev.key === 'End') {
    ev.preventDefault();
    const sl = document.getElementById('live-slider');
    if (sl) { sl.value = 8759; _onHourSlider(8759); }
  }
});

// Play-Stop is handled in setViewMode directly

// ── Live-Flow-Mode-Toggle (Klassisch / Sankey / Sankey-Detail) ──
setTimeout(() => {
  const btns = document.querySelectorAll('.live-flow-mode-btn');
  if (!btns.length) return;
  // Einmal-Migration: alten Default 'box' aus localStorage auf neuen Default 'sankey' umstellen.
  // Wer bewusst 'sankey-detail' gewählt hatte, behält das. Wer nichts gewählt hatte, sieht jetzt Hub-Sankey.
  if (!localStorage.getItem('live-flow-mode-v2')) {
    const old = localStorage.getItem('live-flow-mode');
    if (!old || old === 'box') localStorage.setItem('live-flow-mode', 'sankey');
    localStorage.setItem('live-flow-mode-v2', '1');
  }
  // Initial-State aus localStorage übernehmen (Default: Hub-Sankey)
  const initial = localStorage.getItem('live-flow-mode') || 'sankey';
  btns.forEach(b => {
    const isActive = b.dataset.mode === initial;
    b.dataset.active = isActive ? '1' : '0';
    b.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
    b.style.color = isActive ? 'var(--accent)' : 'var(--muted)';
  });
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem('live-flow-mode', btn.dataset.mode);
      btns.forEach(b => {
        const isActive = b.dataset.mode === btn.dataset.mode;
        b.dataset.active = isActive ? '1' : '0';
        b.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
        b.style.color = isActive ? 'var(--accent)' : 'var(--muted)';
      });
      // Re-render mit aktueller Stunde
      const sl = document.getElementById('live-slider');
      const t = sl ? parseInt(sl.value) || 0 : 0;
      if (typeof _updateHourlyOverlay === 'function') _updateHourlyOverlay(t);
    });
  });
}, 0);


export let _optAborted = false;
export let _optRunning = false;

export let _optWorker = null;  // Single Worker oder Array von Workers
export let _optWorkers = [];   // Multi-Worker-Referenzen für Abbruch

