// 10b-optimizer-ui.js - Optimizer: UI, Worker orchestration, charts, hourly mode
// Split from 10-optimizer.js - Hourly mode, stacked dispatch canvas, Strom-Bilanz,
// flow SVG, drag overlay, hourly update, SOC chart, zoom, timeline, play, keyboard,
// runOptimierung, Worker orchestration, _buildOptWorkerCode, _doRunOptimierung,
// bar chart, radar chart, scatter plot
// ==========================================================================

// ── Stundenscharfer Zeitschieber (Hourly Live-Modus) ─────────────────────
let _hourlyModeActive = false;

function _toggleHourlyMode() {
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

function _showHourlySlider() {
  const liveTab = document.getElementById('view-tab-live');
  if (liveTab) liveTab.style.display = '';
}

function _hideHourlySlider() {
  _hourlyModeActive = false;
  const liveTab = document.getElementById('view-tab-live');
  if (liveTab) liveTab.style.display = 'none';
  _removeHourlyOverlay();
}

function _hourToDateStr(h) {
  const day = Math.floor(h / 24);
  const hr = h % 24;
  const m = [31,28,31,30,31,30,31,31,30,31,30,31];
  const mNames = ['Januar','Februar','M\u00e4rz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  let d = day, mo = 0;
  while (mo < 12 && d >= m[mo]) { d -= m[mo]; mo++; }
  return String(d + 1) + '. ' + mNames[mo] + ' \u00B7 ' + String(hr).padStart(2, '0') + ':00';
}

function _onHourSlider(val) {
  const t = parseInt(val) || 0;
  if (_hourlyModeActive) _updateHourlyOverlay(t);
}

function _removeHourlyOverlay() {
  _hourlyModeActive = false;
  if (currentViewMode === 'live') setViewMode('karte');
}

// ── Gestapeltes Erzeugerlastgang-Diagramm (Canvas) ──────────────────────
function _drawStackedDispatch(canvas, currentHour, keys, hourly, ss) {
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
function _drawStromBilanz(canvas, currentHour) {
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
function _buildFlowSVG(container, data) {
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

function _initDragOverlay(el, handle) {
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

function _updateHourlyOverlay(t) {
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
    const deckColor = deckung >= 100 ? '#66bb6a' : (deckung >= 80 ? '#ffb74d' : '#ef5350');
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

  // ── Flow-Schema (SVG) zeichnen ──
  const flowSvgDiv = document.getElementById('live-flow-svg');
  if (flowSvgDiv) {
    _buildFlowSVG(flowSvgDiv, { erzeuger: erzFiltered, bedarf: lastKw, speicher, strom, tempC, vlC, t });
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
function _checkShowHourlySlider() {
  if (window._dispatchHourly && window._dispatchActiveKeys?.length > 0) {
    _showHourlySlider();
  } else {
    _hideHourlySlider();
  }
}

// ── Speicher-SOC-Chart (separate Canvas) ────────────────────────────────
function _drawSpeicherSocChart(canvas, currentHour) {
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
let _liveZoomMode = 'jahr';

function _setLiveZoom(mode) {
  _liveZoomMode = mode;
  document.querySelectorAll('.live-zoom-tab').forEach(b => b.classList.toggle('active', b.dataset.zoom === mode));
  // Re-render
  const sl = document.getElementById('live-slider');
  if (sl) _onHourSlider(parseInt(sl.value) || 0);
}

function _getLiveZoomRange(currentHour) {
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

function _drawLiveXAxis(ctx, PAD, plotW, plotH, range) {
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
function _updateLiveTimeline(t) {
  const pct = (t / 8759) * 100;
  const fill = document.getElementById('live-tl-fill');
  const thumb = document.getElementById('live-tl-thumb');
  if (fill) fill.style.width = pct + '%';
  if (thumb) thumb.style.left = pct + '%';
  // Draw demand histogram once
  _drawTimelineHisto();
}

let _tlHistoDrawn = false;
function _drawTimelineHisto() {
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

let _liveTlDragging = false;

function _liveTlDown(ev) {
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

function _liveTlMove(ev) {
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

function _liveStep(delta) {
  const sl = document.getElementById('live-slider');
  if (!sl) return;
  const newVal = Math.max(0, Math.min(8759, parseInt(sl.value) + delta));
  sl.value = newVal;
  _onHourSlider(newVal);
}

// ── Play-Modus ──────────────────────────────────────────────────────────
let _livePlayTimer = null;
let _livePlaySpeed = 1;
const _liveSpeedSteps = [1, 10, 60, 360];

function _liveTogglePlay() {
  if (_livePlayTimer) {
    _liveStopPlay();
  } else {
    _liveStartPlay();
  }
}

function _liveStartPlay() {
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

function _liveStopPlay() {
  if (_livePlayTimer) { clearInterval(_livePlayTimer); _livePlayTimer = null; }
  const btn = document.getElementById('live-play-btn');
  if (btn) { btn.innerHTML = '\u25B6'; btn.classList.remove('active'); }
}

function _liveCycleSpeed() {
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


let _optAborted = false;
let _optRunning = false;

let _optWorker = null;  // Single Worker oder Array von Workers
let _optWorkers = [];   // Multi-Worker-Referenzen für Abbruch


function runOptimierung() {
  if (_optRunning) { _optAbbrechen(); return; }
  _optAborted = false;
  _optRunning = true;
  const btn = document.getElementById('btn-opt-start');
  if (btn) {
    btn.setAttribute('data-running', '1');
    btn.innerHTML = '&#x2716; Berechnung abbrechen';
  }
  const resDiv = document.getElementById('opt-result-list');
  resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Berechne&#x2026;</div>';

  // Versuche Web Worker, Fallback auf Main-Thread
  try {
    _runOptWorker(resDiv);
  } catch (e) {
    console.warn('Web Worker nicht verfügbar, Fallback auf Main-Thread:', e);
    setTimeout(() => _doRunOptimierung(resDiv), 30);
  }
}

function _optAbbrechen() {
  _optAborted = true;
  if (_optWorker) { _optWorker.terminate(); _optWorker = null; }
  for (const w of _optWorkers) { try { w.terminate(); } catch(e) {} }
  _optWorkers = [];
  _optFinished();
  const resDiv = document.getElementById('opt-result-list');
  if (resDiv) resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Abgebrochen.</div>';
}

function _optFinished() {
  _optRunning = false;
  _optWorker = null;
  _optWorkers = [];
  const btn = document.getElementById('btn-opt-start');
  if (btn) {
    btn.removeAttribute('data-running');
    btn.innerHTML = '&#x26A1; Optimalvarianten berechnen';
    btn.disabled = false;
  }
}

function _runOptWorker(resDiv) {
  const ss = window.systemState;
  if (!ss?.lastgangKw || ss.lastgangKw.length < 8760 || !ss.tempH || !ss.vlH) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Kein stundenscharfer Lastgang verfügbar.</div>';
    _optFinished();
    return;
  }

  const dom = _collectOptDomParams();
  const pvProfile = (typeof makePvProfile8760 === 'function') ? makePvProfile8760() : null;
  const stNormProfile = document.getElementById('opt-cand-st')?.checked ? ((typeof makeStProfile8760 === 'function') ? makeStProfile8760(1) : null) : null;

  // Kandidaten, Constraints, Ziel, Quality auslesen
  const allKeys = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel'];
  const aktiv = allKeys.filter(k => document.getElementById('opt-cand-' + k)?.checked);
  const pvAktiv = !!document.getElementById('opt-cand-pv')?.checked;
  const batAktiv = !!document.getElementById('opt-cand-bat')?.checked;
  const stAktiv = !!document.getElementById('opt-cand-st')?.checked;
  const tsAktiv = !!document.getElementById('opt-cand-ts')?.checked;
  const constraints = {};
  for (const k of [...allKeys, 'pv', 'bat', 'ts']) {
    constraints[k] = {
      minKw: parseFloat(document.getElementById('opt-min-' + k)?.value) || 0,
      maxKw: parseFloat(document.getElementById('opt-max-' + k)?.value) || 0,
      bisJahr: parseInt(document.getElementById('opt-bis-' + k)?.value) || 0,
    };
  }
  const ziel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';
  const quality = document.getElementById('opt-quality')?.value || 'standard';
  const optYear = parseInt(document.getElementById('opt-year')?.value) || (typeof globalYear !== 'undefined' ? globalYear : 2026);
  const globalYr = optYear;
  // Lastgang für das gewählte Betrachtungsjahr skalieren
  const _optScaledLastgang = _optGetScaledLastgang(optYear);

  // Wirtschaftsparameter
  const params = {
    pStrom: parseFloat(document.getElementById('wirt-p-strom')?.value) || 30,
    pGas: parseFloat(document.getElementById('wirt-p-gas')?.value) || 10,
    pPk: parseFloat(document.getElementById('wirt-p-pk')?.value) || 7,
    pHhs: parseFloat(document.getElementById('wirt-p-hhs')?.value) || 4,
    pHko: parseFloat(document.getElementById('wirt-p-hko')?.value) || 9.5,
    pFw: parseFloat(document.getElementById('wirt-p-fw')?.value) || 8,
    pEinsp: parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8,
    pBhkwEinsp: parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8,
    pBhkwKwkE: parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8,
    pBhkwKwkEig: parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4,
    zinssatz: (parseFloat(document.getElementById('wirt-zins')?.value) || 2.7) / 100,
  };

  // Quartier-Strom (gleiche Kaskade wie calcStromPanel)
  const quartierH = new Float32Array(8760);
  if (window.elQuartierH) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window.elQuartierH[t];
  } else if (window._elQuartierFromGeb) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window._elQuartierFromGeb[t];
  } else {
    // Fallback: Manuelle Eingabe oder SLP aus Gebäudedaten
    const qMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
    if (qMwh > 0) {
      const perH = qMwh * 1000 / 8760;
      for (let t = 0; t < 8760; t++) quartierH[t] = perH;
    } else if (typeof aggregateGebStrom === 'function') {
      const gebStrom = aggregateGebStrom();
      if (gebStrom && gebStrom.totalMWh > 0) {
        for (let t = 0; t < 8760; t++) quartierH[t] = gebStrom.hourly[t];
      }
    }
  }

  // Anzahl paralleler Worker bestimmen (min 1, max 8, einen Kern für UI freilassen)
  const numWorkers = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const startTime = Date.now();

  const workerCode = _buildOptWorkerCode();
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  // Gemeinsame Payload (ohne Transferable — wird pro Worker kopiert)
  const basePayload = {
    dom, params, aktiv, constraints, ziel, quality,
    pvAktiv, batAktiv, stAktiv, tsAktiv, globalYear: globalYr,
  };

  // ── Hilfsfunktion: Worker mit Daten-Kopie starten ──
  function createAndSendWorker(mode, extraPayload) {
    const w = new Worker(blobUrl);
    const lastgang = new Float32Array(_optScaledLastgang || ss.lastgangKw);
    const tempArr = new Float32Array(ss.tempH);
    const vlArr = new Float32Array(ss.vlH);
    const pvArr = pvProfile ? new Float32Array(pvProfile) : null;
    const stArr = stNormProfile ? new Float32Array(stNormProfile) : null;
    const qArr = new Float32Array(quartierH);
    const transferList = [lastgang.buffer, tempArr.buffer, vlArr.buffer, qArr.buffer];
    if (pvArr) transferList.push(pvArr.buffer);
    if (stArr) transferList.push(stArr.buffer);
    const payload = {
      ...basePayload, ...extraPayload, mode,
      lastgangKw: lastgang, tempH: tempArr, vlH: vlArr,
      pvProfile: pvArr, stNormProfile: stArr, quartierH: qArr,
    };
    w.postMessage(payload, transferList);
    return w;
  }

  // ── Fortschrittsanzeige ──
  const workerProgress = new Array(numWorkers).fill(0);
  function updateProgress(phase) {
    const totalPct = Math.round(workerProgress.reduce((s, v) => s + v, 0) / numWorkers);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const nwLabel = numWorkers > 1 ? ' \u00b7 ' + numWorkers + ' Kerne' : '';
    resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">' + phase + ': ' + totalPct + '% \u00b7 ' + elapsed + 's' + nwLabel + '</div>';
  }

  // ── Single Worker (Fallback für 1 Kern) ──
  if (numWorkers <= 1) {
    const worker = createAndSendWorker('full', { workerIdx: 0, numWorkers: 1 });
    _optWorker = worker;
    _optWorkers = [worker];
    worker.onmessage = function(e) {
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[0] = msg.pct;
        updateProgress(msg.phase);
      } else if (msg.type === 'done') {
        window._optGrobResults = msg.grobResults;
        _renderWorkerResults(msg.topFein, msg.grobResults, resDiv, startTime, params);
      }
    };
    worker.onerror = function(e) {
      console.error('OptWorker Error:', e);
      _optWorker = null; _optWorkers = [];
      resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Worker-Fehler, Fallback&#x2026;</div>';
      setTimeout(() => _doRunOptimierung(resDiv), 30);
    };
    URL.revokeObjectURL(blobUrl);
    return;
  }

  // ── Multi-Worker: Phase 1 — Grobsuche parallelisiert ──
  console.log('[OPT] Multi-Worker Grobsuche mit', numWorkers, 'Kernen');
  let allGrobResults = [];
  let grobWorkersFinished = 0;
  let hadError = false;
  _optWorkers = [];

  for (let i = 0; i < numWorkers; i++) {
    const w = createAndSendWorker('grob', { workerIdx: i, numWorkers });
    _optWorkers.push(w);

    w.onmessage = function(e) {
      if (_optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[msg.workerIdx || i] = msg.pct;
        updateProgress('Grobsuche');
      } else if (msg.type === 'grob_done') {
        allGrobResults.push(...(msg.grobResults || []));
        grobWorkersFinished++;
        workerProgress[msg.workerIdx || i] = 100;
        updateProgress('Grobsuche');
        w.terminate();
        if (grobWorkersFinished === numWorkers) {
          _startFeinPhase();
        }
      }
    };

    w.onerror = function(e) {
      console.error('OptWorker', i, 'Error:', e);
      if (!hadError) {
        hadError = true;
        for (const wk of _optWorkers) { try { wk.terminate(); } catch(ex) {} }
        _optWorker = null; _optWorkers = [];
        resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Worker-Fehler, Fallback&#x2026;</div>';
        setTimeout(() => _doRunOptimierung(resDiv), 30);
      }
    };
  }
  URL.revokeObjectURL(blobUrl);

  // ── Multi-Worker: Phase 2 — Feinsuche mit einem Worker ──
  function _startFeinPhase() {
    if (_optAborted) return;
    // Grobresultate zusammenführen, deduplizieren, Top 5 auswählen
    allGrobResults.sort((a, b) => a.score - b.score);
    const seen = new Set();
    const grobTop = [];
    for (const r of allGrobResults) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); grobTop.push(r); }
    }
    const topNGrob = grobTop.slice(0, 5);
    window._optGrobResults = allGrobResults.map(r => ({
      kombiKey: r.kombiKey, keys: r.keys, kw: r.kw, score: r.score,
      stM2: r.stM2, tsVol: r.tsVol, pvKwp: r.pvKwp, batKwh: r.batKwh
    }));

    if (topNGrob.length === 0) {
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
      _optFinished();
      return;
    }

    console.log('[OPT] Feinsuche für', topNGrob.length, 'Varianten');
    workerProgress.fill(0);

    // Neuen Blob-URL erzeugen (der alte wurde nach der Grobsuche revoked)
    const workerCode2 = _buildOptWorkerCode();
    const blob2 = new Blob([workerCode2], { type: 'application/javascript' });
    const url2 = URL.createObjectURL(blob2);
    const feinWorker = new Worker(url2);
    // Daten-Kopien für den Fein-Worker erstellen und senden
    const fLastgang = new Float32Array(_optScaledLastgang || ss.lastgangKw);
    const fTempArr = new Float32Array(ss.tempH);
    const fVlArr = new Float32Array(ss.vlH);
    const fPvArr = pvProfile ? new Float32Array(pvProfile) : null;
    const fStArr = stNormProfile ? new Float32Array(stNormProfile) : null;
    const fQArr = new Float32Array(quartierH);
    const fTransferList = [fLastgang.buffer, fTempArr.buffer, fVlArr.buffer, fQArr.buffer];
    if (fPvArr) fTransferList.push(fPvArr.buffer);
    if (fStArr) fTransferList.push(fStArr.buffer);
    feinWorker.postMessage({
      ...basePayload, mode: 'fein', workerIdx: 0, numWorkers: 1, topNGrob,
      lastgangKw: fLastgang, tempH: fTempArr, vlH: fVlArr,
      pvProfile: fPvArr, stNormProfile: fStArr, quartierH: fQArr,
    }, fTransferList);
    _optWorker = feinWorker;
    _optWorkers = [feinWorker];
    URL.revokeObjectURL(url2);

    feinWorker.onmessage = function(e) {
      if (_optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[0] = msg.pct;
        updateProgress('Feinsuche');
      } else if (msg.type === 'done') {
        _renderWorkerResults(msg.topFein, window._optGrobResults, resDiv, startTime, params);
      }
    };

    feinWorker.onerror = function(e) {
      console.error('Fein-Worker Error:', e);
      _optFinished();
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Feinsuche fehlgeschlagen.</div>';
    };
  }
}

function _renderWorkerResults(topFein, grobResults, resDiv, startTime, params) {
  if (!topFein || topFein.length === 0) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
    _optFinished();
    return;
  }
  topFein.sort((a, b) => a.score - b.score);
  const top3 = topFein.slice(0, 3);

  // ── WGK-Nachrechnung auf dem Main-Thread (gleicher Code wie Wirtschafts-Panel) ──
  // Damit Optimizer-WGK und Panel-WGK garantiert übereinstimmen
  for (const r of top3) {
    try {
      // Dispatch-Ergebnis aus Worker-Daten rekonstruieren
      const dispResult = {
        erzeugerList: r.config.map((c, i) => ({
          key: c.key, typ: ERZEUGER_CFG[c.key]?.typ || c.typ,
          leistKw: r.erzLeistKw?.[i] ?? c.leistKw,
          waermeMwh: r.erzWaermeMwh?.[i] ?? 0,
          elMwh: r.erzElMwh?.[i] ?? 0,
        })),
        autoGkMwh: r.autoGkMwh || 0,
        autoGkPeakKw: r.autoGkPeakKw || 0,
        gesamtMwh: r.gesamtMwh || 0,
        speicherEntladenMwh: r.speicherEntladenMwh || 0,
      };
      // PV/Bat-Ergebnis aus Worker-Daten verwenden
      const pvBatResult = r.pvBatData || null;
      // WGK mit _optKennwerte2 neu berechnen (Main-Thread)
      const recalc = _optKennwerte2(dispResult, r.pvKwp || 0, r.batKwh || 0, pvBatResult, params, r.stMwh || 0, r.stM2 || 0, r.tsVol || 0);
      // Vergleich loggen
      const wWorker = r.kw.wgk, wMain = recalc.wgk;
      if (Math.abs(wWorker - wMain) > 0.3) {
        console.warn('[WGK-DIFF] #' + (top3.indexOf(r)+1), r.keys.join('+'),
          '| Worker:', wWorker.toFixed(1), '| Main:', wMain.toFixed(1), '| Diff:', (wWorker - wMain).toFixed(1),
          '| W-JK:', Math.round(r.kw.jahreskosten), '| M-JK:', Math.round(recalc.jahreskosten),
          '| W-Inv:', Math.round(r.kw.investGesamt), '| M-Inv:', Math.round(recalc.investGesamt));
      }
      // Main-Thread-Ergebnis verwenden (konsistent mit Panel)
      r.kw = recalc;
    } catch (e) {
      console.warn('[WGK-RECALC] Fehler bei Nachrechnung:', e.message);
    }
  }

  // Re-sort nach Nachrechnung (Reihenfolge könnte sich ändern)
  const _reZiel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';
  top3.sort((a, b) => _optScore(a.kw, _reZiel) - _optScore(b.kw, _reZiel));

  resDiv.innerHTML = '';
  // Jahr-Info im Ergebnis anzeigen
  const _optResYear = parseInt(document.getElementById('opt-year')?.value) || globalYear;
  const _optResYearDiv = document.createElement('div');
  _optResYearDiv.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;';
  _optResYearDiv.innerHTML = '<span style="color:var(--accent);font-weight:600;">Betrachtungsjahr: ' + _optResYear + '</span>'
    + (window._basisYear && _optResYear !== window._basisYear ? ' <span style="color:#78909c;font-size:9px;">(Lastgang skaliert)</span>' : '');
  resDiv.appendChild(_optResYearDiv);
  top3.forEach((r, idx) => {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface2);border-radius:8px;padding:12px 14px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.3);';

    const titel = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join(' + ')
      + (r.stM2 > 0 ? ' + ST ' + r.stM2 + ' m\u00b2' : '')
      + (r.tsVol > 0 ? ' + WS ' + r.tsVol + ' m\u00b3' : '')
      + (r.pvKwp > 0 ? ' + PV ' + r.pvKwp.toFixed(0) + ' kWp' : '')
      + (r.batKwh > 0 ? ' + Bat ' + r.batKwh.toFixed(0) + ' kWh' : '');

    const eeColor = r.kw.eeAnteil >= 65 ? '#81c784' : '#ef9a9a';
    const eeBadge = '<span style="background:' + eeColor + ';color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;">' + r.kw.eeAnteil.toFixed(0) + '% EE</span>';

    // ── Hauptzeile: WGK prominent + Sekundär-KPIs ──
    const totalInkST = (r.gesamtMwh || 0) + (r.stMwh || 0);

    let kpiHtml = '<div style="display:flex;align-items:stretch;gap:6px;margin:6px 0;">';
    // WGK groß links
    kpiHtml += '<div style="background:rgba(253,216,53,0.08);border:1px solid rgba(253,216,53,0.25);border-radius:6px;padding:6px 12px;text-align:center;min-width:80px;">'
      + '<div style="font-size:18px;font-weight:700;color:#fdd835;line-height:1.1;">' + r.kw.wgk.toFixed(1) + '</div>'
      + '<div style="font-size:8px;color:var(--muted);margin-top:1px;">ct/kWh</div></div>';
    // Sekundär-KPIs rechts
    kpiHtml += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px;flex:1;">';
    const kpis2 = [
      { val: (r.kw.investGesamt / 1000).toFixed(0) + ' k\u20ac', lbl: 'Invest', color: '#b0bec5' },
      { val: r.kw.co2ta.toFixed(1) + ' t/a', lbl: 'CO\u2082', color: '#90a4ae' },
      { val: r.kw.jahreskosten ? (r.kw.jahreskosten / 1000).toFixed(1) + ' k\u20ac/a' : '\u2014', lbl: 'Jahreskosten', color: '#ce93d8' },
      { val: (r.kw.stromAutarkie || 0).toFixed(0) + '%', lbl: '\u26A1 Strom-Aut.', color: '#fdd835' },
      { val: (r.kw.waermeAutarkie || 0).toFixed(0) + '%', lbl: '\uD83C\uDF21 W\u00e4rme-Aut.', color: '#e53935' },
      { val: totalInkST.toFixed(0) + ' MWh', lbl: 'W\u00e4rme ges.', color: '#ff7043' },
    ];
    for (const k of kpis2) {
      kpiHtml += '<div style="background:rgba(255,255,255,0.03);border-radius:3px;padding:2px 4px;text-align:center;">'
        + '<div style="font-size:10px;font-weight:600;color:' + k.color + ';">' + k.val + '</div>'
        + '<div style="font-size:7px;color:var(--muted);white-space:nowrap;">' + k.lbl + '</div></div>';
    }
    kpiHtml += '</div></div>';

    // ── Erzeuger-Tabelle: Leistung, Energie, Anteil ──
    let erzHtml = '<div style="display:grid;grid-template-columns:auto repeat(3,1fr);gap:0 8px;font-size:9px;margin:4px 0;padding:4px 0;border-top:1px solid var(--border);">';
    // Header
    erzHtml += '<div style="color:var(--muted);font-size:8px;">Erzeuger</div>'
      + '<div style="color:var(--muted);font-size:8px;text-align:right;">Leistung</div>'
      + '<div style="color:var(--muted);font-size:8px;text-align:right;">Energie</div>'
      + '<div style="color:var(--muted);font-size:8px;text-align:right;">Anteil</div>';
    // Solarthermie
    if (r.stM2 > 0 && r.stMwh > 0) {
      const dckPct = totalInkST > 0 ? (r.stMwh / totalInkST * 100) : 0;
      erzHtml += '<div><span style="color:#ef6c00;">\u25CF</span> ST ' + r.stM2 + ' m\u00b2</div>'
        + '<div style="text-align:right;">\u2014</div>'
        + '<div style="text-align:right;">' + r.stMwh.toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
    }
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const waermeMwh = r.erzWaermeMwh ? r.erzWaermeMwh[ci] : 0;
      const col = ERZEUGER_CFG[erz.key]?.color || '#aaa';
      const dckPct = totalInkST > 0 ? (waermeMwh / totalInkST * 100) : 0;
      const displayKw = r.erzLeistKw ? r.erzLeistKw[ci] : erz.leistKw;
      erzHtml += '<div><span style="color:' + col + ';">\u25CF</span> ' + (ERZEUGER_CFG[erz.key]?.label || erz.key) + '</div>'
        + '<div style="text-align:right;">' + displayKw.toFixed(0) + ' kW</div>'
        + '<div style="text-align:right;">' + waermeMwh.toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
    }
    if (r.autoGkMwh > 0) {
      const dckPct = totalInkST > 0 ? (r.autoGkMwh / totalInkST * 100) : 0;
      erzHtml += '<div><span style="color:#78909c;">\u25CF</span> Backup-GK</div>'
        + '<div style="text-align:right;">\u2014</div>'
        + '<div style="text-align:right;">' + r.autoGkMwh.toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
    }
    // PV/Batterie
    if (r.pvKwp > 0) {
      erzHtml += '<div><span style="color:#fdd835;">\u25CF</span> PV' + (r.batKwh > 0 ? ' + Bat' : '') + '</div>'
        + '<div style="text-align:right;">' + r.pvKwp.toFixed(0) + ' kWp' + (r.batKwh > 0 ? ' / ' + r.batKwh.toFixed(0) + ' kWh' : '') + '</div>'
        + '<div style="text-align:right;color:var(--muted);">' + (r.kw.pvErtragMwh || 0).toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;color:var(--muted);">\u2014</div>';
    }
    erzHtml += '</div>';

    card.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);">' +
        '<span style="font-size:12px;font-weight:700;color:var(--text);">' + (idx + 1) + '. ' + escHtml(titel) + '</span>' +
        eeBadge +
      '</div>' +
      kpiHtml +
      erzHtml +
      '<div style="text-align:center;margin-top:6px;"><button class="btn-secondary" style="font-size:9px;padding:3px 12px;" onclick="_optVarianteUebernehmen(window._optLastResults[' + idx + '], this)">Als Variante \u00fcbernehmen</button></div>';
    resDiv.appendChild(card);
  });

  // Ergebnis-Objekte für "Als Variante übernehmen" bereitstellen
  // Konvertiere Worker-Ergebnisse in das erwartete Format
  window._optLastResults = top3.map(r => ({
    keys: r.keys, config: r.config, pvKwp: r.pvKwp, batKwh: r.batKwh,
    stM2: r.stM2, stMwh: r.stMwh, tsVol: r.tsVol, kw: r.kw,
    sim: { gesamtMwh: r.gesamtMwh, autoGkMwh: r.autoGkMwh, autoGkPeakKw: r.autoGkPeakKw || 0,
      erzeugerList: r.config.map((c, i) => ({ ...c, waermeMwh: r.erzWaermeMwh?.[i] || 0,
        leistKw: r.erzLeistKw?.[i] || c.leistKw, elMwh: r.erzElMwh?.[i] || 0 })) },
    score: r.score,
  }));

  _optRenderBarChart(window._optLastResults, resDiv);
  _optRenderRadar(window._optLastResults, resDiv);
  _optRenderScatter(resDiv);

  const totalElapsed = ((Date.now() - startTime) / 1000);
  const timeLabel = totalElapsed < 60 ? totalElapsed.toFixed(1) + 's' : (totalElapsed / 60).toFixed(1) + ' min';
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'font-size:9px;color:var(--muted);text-align:center;margin-top:8px;';
  infoDiv.textContent = 'Berechnung abgeschlossen in ' + timeLabel + ' (' + (grobResults?.length || 0) + ' Konfigurationen getestet)';
  resDiv.appendChild(infoDiv);

  window._optCachedPvProfile = null;
  _optFinished();
}

function _buildOptWorkerCode() {
  return `
'use strict';
// ═══ Web Worker: Optimierungsberechnung (DOM-frei) ═══

let D; // DOM-Parameter (wird via postMessage empfangen)

function _annF(z, n) {
  if (z <= 0 || n <= 0) return n > 0 ? 1 / n : 1;
  return z * Math.pow(1 + z, n) / (Math.pow(1 + z, n) - 1);
}

function _defaultGuetegrad(key) {
  if (key === 'lwwp') return 0.42;
  if (key === 'fg') return 0.56;
  if (key === 'geo') return 0.50;
  return 0.42;
}

function _quelleTemp(key, tAussen, t) {
  if (key === 'lwwp') return tAussen;
  if (key === 'fg') {
    const d = Math.floor(t / 24);
    return Math.max(0.5, 10 + 8 * Math.sin(2 * Math.PI * (d - 119) / 365));
  }
  const d2 = Math.floor(t / 24);
  return 10 + 2 * Math.sin(2 * Math.PI * (d2 - 75) / 365) - D.geoDtAbsenkung;
}

function _investProKw(key, kw) {
  const pts = D.investKurven[key];
  if (pts && pts.length > 0) {
    // Lineare Interpolation aus vorberechneten Punkten
    if (kw <= pts[0].kw) return pts[0].eurKw > 0 ? pts[0].eurKw : D.OPT_INVEST_DEFAULT[key] || 200;
    for (let i = 0; i < pts.length - 1; i++) {
      if (kw >= pts[i].kw && kw <= pts[i+1].kw) {
        const t = (kw - pts[i].kw) / (pts[i+1].kw - pts[i].kw);
        const v = pts[i].eurKw + t * (pts[i+1].eurKw - pts[i].eurKw);
        return v > 0 ? v : D.OPT_INVEST_DEFAULT[key] || 200;
      }
    }
    const last = pts[pts.length-1];
    return last.eurKw > 0 ? last.eurKw : D.OPT_INVEST_DEFAULT[key] || 200;
  }
  return D.OPT_INVEST_DEFAULT[key] || 200;
}

function _pvInvestPerKwp(kwp) {
  const tab = D.pvInvestTabelle;
  if (kwp <= 0 || kwp <= tab[0].kwp) return tab[0].eurKwp;
  if (kwp >= tab[tab.length-1].kwp) return tab[tab.length-1].eurKwp;
  for (let i = 0; i < tab.length - 1; i++) {
    if (kwp >= tab[i].kwp && kwp <= tab[i+1].kwp) {
      const t = (kwp - tab[i].kwp) / (tab[i+1].kwp - tab[i].kwp);
      return Math.round(tab[i].eurKwp + t * (tab[i+1].eurKwp - tab[i].eurKwp));
    }
  }
  return tab[tab.length-1].eurKwp;
}

// ── Gemeinsame Kostenberechnung (eingebettet aus Main-Thread) ──
` + _calcKostenShared.toString() + `

function dispatch8760(lastgangKw, tempH, vlH, erzeugerList, optSpeicherVol, stExcessH) {
  const n = 8760;
  const wpElH = new Float32Array(n);
  const bhkwElH = new Float32Array(n);
  const skElH = new Float32Array(n);
  const wpResKwH = new Float32Array(n);
  const wpResCopH = new Float32Array(n);
  const bhkwSigma = D.bhkwSkz;
  const skEta = D.skEta;
  const lwwpMinCop = D.lwwpMinCop;
  let gesamtKwh = 0;
  const KESSEL_SET = new Set(D.KESSEL_KEYS);

  const copRef = {};
  for (const erz of erzeugerList) {
    if (D.ERZEUGER_TYP[erz.key] === 'wp') {
      copRef[erz.key] = ((273.15 + 35) / (35 - 2)) * (erz.guetegrad || _defaultGuetegrad(erz.key));
    }
  }

  let thSp = null;
  if (typeof optSpeicherVol === 'number' && optSpeicherVol > 0) {
    thSp = { vol: optSpeicherVol, dt: D.tsDt, kapKwh: optSpeicherVol * 1.16 * D.tsDt, verlustRate: D.tsVerlust / 100, entladeKw: D.tsEntladeKw };
  }
  const hatSpeicher = thSp !== null && thSp.kapKwh > 0;
  const nonKesselErz = hatSpeicher ? erzeugerList.filter(e => !KESSEL_SET.has(e.key)) : erzeugerList;
  const kesselErz = hatSpeicher ? erzeugerList.filter(e => KESSEL_SET.has(e.key)) : [];
  let thermSOC = 0, thermEntladenGes = 0, thermGeladenGes = 0;

  for (const erz of erzeugerList) { erz._thKwh = 0; erz._elKwh = 0; }
  let residualKwh = 0, residualPeakKw = 0;
  // Letzter Erzeuger = Spitzenlasterzeuger: deckt gesamte Restlast ab
  const _backupErz = erzeugerList.length > 0 ? erzeugerList[erzeugerList.length - 1] : null;
  let _backupPeakKw = 0, _backupHourKw = 0;

  for (let t = 0; t < n; t++) {
    let residual = lastgangKw[t];
    gesamtKwh += residual;
    _backupHourKw = 0;

    if (hatSpeicher && thermSOC > 0) {
      thermSOC = Math.max(0, thermSOC - thermSOC * thSp.verlustRate);
    }

    // ST-Überschuss → Speicher (wie im Haupt-Dispatch Phase 1)
    if (hatSpeicher && stExcessH && stExcessH[t] > 0.001) {
      const laden = Math.min(stExcessH[t], thSp.kapKwh - thermSOC);
      if (laden > 0.001) { thermSOC += laden; thermGeladenGes += laden; }
    }

    const wpReserves = [];
    for (const erz of nonKesselErz) {
      if (residual <= 0.001) break;
      if (erz.leistKw <= 0) continue;
      let erreichbarKw = erz.leistKw;
      let cop = 0;
      const typ = D.ERZEUGER_TYP[erz.key];

      if (typ === 'wp') {
        const tQ = _quelleTemp(erz.key, tempH[t], t);
        if (erz.key === 'fg' && tQ < 2) continue;
        const tVLK = vlH[t] + 273.15;
        const hub = Math.max(tVLK - (tQ + 273.15), 0.1);
        cop = Math.min((tVLK / hub) * (erz.guetegrad || _defaultGuetegrad(erz.key)), 8);
        if (erz.key === 'lwwp' && lwwpMinCop > 0 && cop < lwwpMinCop) continue;
        erreichbarKw = erz.leistKw * (cop / copRef[erz.key]);
      }

      // Gaskessel/Heizöl: kein Kapazitätslimit (Backup-Funktion, ersetzt Auto-GK)
      const _isBackup = (erz === _backupErz);
      let pTh;
      if (typ === 'kwk' && !_isBackup) {
        // BHKW-Mindestteillast 50%
        const minLastKw = erz.leistKw * 0.5;
        if (residual >= minLastKw) {
          pTh = Math.min(erreichbarKw, Math.max(0, residual));
        } else if (hatSpeicher && (thSp.kapKwh - thermSOC) > 0.1) {
          pTh = Math.min(erreichbarKw, minLastKw);
          const ueberschuss = Math.max(0, pTh - residual);
          if (ueberschuss > 0.001) {
            const laden = Math.min(ueberschuss, thSp.kapKwh - thermSOC);
            thermSOC += laden;
            thermGeladenGes += laden;
          }
        } else {
          pTh = 0;
        }
      } else {
        pTh = _isBackup ? Math.max(0, residual) : Math.min(erreichbarKw, Math.max(0, residual));
      }
      if (pTh < 0.001) continue;
      erz._thKwh += pTh;
      if (_isBackup) _backupHourKw += pTh;

      if (typ === 'wp' && cop > 0) {
        const elH = pTh / cop;
        erz._elKwh += elH;
        wpElH[t] += elH;
        const reserveKw = Math.max(0, erreichbarKw - pTh);
        if (reserveKw > 0.1) wpReserves.push({ erz, reserveKw, cop });
      }
      if (typ === 'kwk') { const elH = pTh * bhkwSigma; erz._elKwh += elH; bhkwElH[t] += elH; }
      if (erz.key === 'stromkessel') { const elH = pTh / skEta; erz._elKwh += elH; skElH[t] += elH; }
      residual -= Math.min(pTh, residual);  // bei BHKW-Mindestlast nur Bedarfsanteil abziehen
    }
    wpReserves.sort((a, b) => b.cop - a.cop);
    // WP-Reserven für PV→WP→Speicher speichern
    let _wrTot = 0, _wrCW = 0;
    for (const wp of wpReserves) { _wrTot += wp.reserveKw; _wrCW += wp.reserveKw * wp.cop; }
    wpResKwH[t] = _wrTot;
    wpResCopH[t] = _wrTot > 0 ? _wrCW / _wrTot : 0;

    if (hatSpeicher && residual > 0.001 && thermSOC > 0.001) {
      const entladen = Math.min(residual, thermSOC, thSp.entladeKw);
      if (entladen > 0.001) { residual -= entladen; thermSOC -= entladen; thermEntladenGes += entladen; }
    }

    for (const erz of kesselErz) {
      if (residual <= 0.001) break;
      if (erz.leistKw <= 0) continue;
      // Gaskessel/Heizöl: kein Kapazitätslimit (Backup-Funktion)
      const _isBackup = (erz === _backupErz);
      const pTh = _isBackup ? Math.max(0, residual) : Math.min(erz.leistKw, residual);
      if (pTh < 0.001) continue;
      erz._thKwh += pTh;
      if (_isBackup) _backupHourKw += pTh;
      residual -= pTh;
    }

    if (_backupHourKw > _backupPeakKw) _backupPeakKw = _backupHourKw;
    const _rKw = Math.max(0, residual);
    residualKwh += _rKw;
    if (_rKw > residualPeakKw) residualPeakKw = _rKw;

    if (hatSpeicher && thermSOC < thSp.kapKwh && wpReserves.length > 0) {
      const h = t % 24;
      if (h >= 8 && h < 18) {
        let restLade = Math.min(thSp.kapKwh - thermSOC, thSp.entladeKw);
        for (const wp of wpReserves) {
          if (restLade <= 0.1 || wp.reserveKw <= 0.1 || wp.cop <= 0) break;
          const ladeKw = Math.min(wp.reserveKw, restLade);
          thermSOC += ladeKw; thermGeladenGes += ladeKw; restLade -= ladeKw;
          const extraEl = ladeKw / wp.cop;
          wpElH[t] += extraEl; wp.erz._elKwh += extraEl;
        }
      }
    }
  }

  for (const erz of erzeugerList) {
    erz.waermeMwh = erz._thKwh / 1000;
    erz.elMwh = erz._elKwh / 1000;
    delete erz._thKwh; delete erz._elKwh;
  }
  // Backup-Kessel: leistKw auf tatsächlichen Peak anheben (für korrekte Investitionsberechnung)
  if (_backupErz && _backupPeakKw > _backupErz.leistKw) {
    _backupErz.leistKw = Math.ceil(_backupPeakKw);
  }

  return { erzeugerList, autoGkMwh: residualKwh / 1000, autoGkPeakKw: residualPeakKw, gesamtMwh: gesamtKwh / 1000, wpElH, bhkwElH, skElH,
    speicherEntladenMwh: thermEntladenGes / 1000, speicherGeladenMwh: thermGeladenGes / 1000,
    wpResKwH, wpResCopH,
    thSpParams: hatSpeicher ? { kapKwh: thSp.kapKwh, entladeKw: thSp.entladeKw } : null };
}

function pvBatSim8760(pvKwp, batKwh, demandH, bhkwElH, pvProfile, dispResult) {
  const hasBhkw = bhkwElH && bhkwElH.some(v => v > 0);
  if (pvKwp <= 0 && !hasBhkw) {
    let sumDem = 0;
    for (let t = 0; t < 8760; t++) sumDem += demandH[t];
    return { eigenMwh: 0, einspeiseMwh: 0, netzbezugMwh: sumDem / 1000,
             pvEigenMwh: 0, pvEinspMwh: 0, bhkwEigenMwh: 0, bhkwEinspMwh: 0 };
  }
  const spez = D.pvSpez;
  const batLeistKw = batKwh > 0 ? batKwh / 2 : 0;
  let sv = 0, ins = 0, bez = 0, soc = 0;
  let pvEig = 0, pvEinsp = 0, bhkwEig = 0, bhkwEinsp = 0;
  let tsSoc = 0, pvWpSpGes = 0;
  for (let t = 0; t < 8760; t++) {
    const dem = demandH[t];
    const pvGen = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const bhkwGen = bhkwElH ? bhkwElH[t] : 0;
    const gen = pvGen + bhkwGen;
    const dsc = Math.min(gen, dem);
    const pvFrac = gen > 0 ? pvGen / gen : 0;
    let rDem = dem - dsc, rGen = gen - dsc;
    if (batKwh > 0 && rGen > 0) { const c = Math.min(rGen, batLeistKw, batKwh - soc); soc += c; rGen -= c; }
    if (batKwh > 0 && rDem > 0) { const a = Math.min(soc * 0.90, rDem, batLeistKw); soc -= a / 0.90; rDem -= a; }

    // PV-Überschuss → WP → thermischer Speicher
    let pvWpSp = 0;
    if (rGen > 0.1 && dispResult && dispResult.thSpParams && dispResult.wpResKwH) {
      const tsCap = dispResult.thSpParams.kapKwh;
      const tsEntlKw = dispResult.thSpParams.entladeKw;
      const wpRKw = dispResult.wpResKwH[t] || 0;
      const wpCop = dispResult.wpResCopH[t] || 0;
      if (wpRKw > 0.1 && wpCop > 0 && tsCap > 0) {
        const tsFree = Math.max(0, tsCap - tsSoc);
        const ladeBudget = Math.min(tsFree, tsEntlKw);
        if (ladeBudget > 0.1) {
          const maxElKw = wpRKw / wpCop;
          const elUsed = Math.min(rGen, maxElKw);
          const thLade = Math.min(elUsed * wpCop, ladeBudget);
          if (thLade > 0.1) {
            const elActual = thLade / wpCop;
            tsSoc = Math.min(tsCap, tsSoc + thLade);
            rGen -= elActual;
            pvWpSp = elActual / 1000;
            pvWpSpGes += pvWpSp;
          }
        }
      }
    }

    const evThisH = (dsc + (dem - dsc - rDem)) / 1000;
    sv += dsc + (dem - dsc - rDem); ins += rGen; bez += rDem;
    pvEig += evThisH * pvFrac + pvWpSp;
    bhkwEig += evThisH * (1 - pvFrac);
    pvEinsp += (rGen / 1000) * pvFrac;
    bhkwEinsp += (rGen / 1000) * (1 - pvFrac);
  }
  return { eigenMwh: sv / 1000 + pvWpSpGes, einspeiseMwh: ins / 1000, netzbezugMwh: bez / 1000,
           pvEigenMwh: pvEig, pvEinspMwh: pvEinsp, bhkwEigenMwh: bhkwEig, bhkwEinspMwh: bhkwEinsp,
           pvWpSpeicherMwh: pvWpSpGes };
}

// _calcBausteinKostenW ENTFERNT — nutzt jetzt _calcKostenShared

function kennwerte(dispR, pvKwp, batKwh, pvBatR, params, stMwh, stM2, optSpeicherVol) {
  const { erzeugerList, autoGkMwh, autoGkPeakKw, gesamtMwh } = dispR;
  const { pStrom, pGas, pPk, pHhs, pHko, pFw, pEinsp, pBhkwEinsp, pBhkwKwkE, pBhkwKwkEig, zinssatz } = params;

  // pKw aus erzeugerList
  const _bPKw = {};
  for (const erz of erzeugerList) _bPKw[erz.key] = erz.leistKw;

  // erzList mit typ-Info für _calcKostenShared
  const erzListTyped = erzeugerList.map(erz => ({
    key: erz.key, waermeMwh: erz.waermeMwh, elMwh: erz.elMwh,
    typ: D.ERZEUGER_TYP[erz.key]
  }));

  // Quartier-Strom
  let quartierStromMwh = 0;
  if (quartierH) { for (let t = 0; t < 8760; t++) quartierStromMwh += quartierH[t]; quartierStromMwh /= 1000; }

  // PV-Daten
  const pvEigenMwh = pvBatR ? (pvBatR.pvEigenMwh != null ? pvBatR.pvEigenMwh : pvBatR.eigenMwh) : 0;
  const pvEinspMwh = pvBatR ? (pvBatR.pvEinspMwh != null ? pvBatR.pvEinspMwh : pvBatR.einspeiseMwh) : 0;
  const gesamtEigenMwh = pvBatR ? (pvBatR.eigenMwh || 0) : 0;

  // BHKW-Erlös-Daten
  const bhkwEigMwh = pvBatR ? (pvBatR.bhkwEigenMwh || 0) : 0;
  const bhkwEinspMwh = pvBatR ? (pvBatR.bhkwEinspMwh || 0) : 0;
  const bhkwStromErloes = bhkwEigMwh * (pStrom + (pBhkwKwkEig || 4)) * 10
    + bhkwEinspMwh * ((pBhkwEinsp || 8) + (pBhkwKwkE || 8)) * 10;

  // Dynamische Bohrmeter für Geo
  let _dynBohrMeter = D.bohrMeter || 0;
  const _geoErz = erzeugerList.find(e => e.key === 'geo');
  if (_geoErz && _geoErz.leistKw > 0) {
    const _geoJaz = (_geoErz.elMwh > 0) ? _geoErz.waermeMwh / _geoErz.elMwh : 4.0;
    const _geoTiefe = D.geoTiefe || 100;
    const _geoQPerM = D.geoQPerM || 31;
    const _erdwaermeKw = _geoErz.leistKw * (_geoJaz - 1) / _geoJaz;
    const _proSondeKw = _geoQPerM * _geoTiefe / 1000;
    const _nLeistung = Math.max(1, Math.ceil(_erdwaermeKw / _proSondeKw));
    let _nEnergie = 1;
    if (_geoErz.waermeMwh > 0) {
      const _maxEntzugProSondeKwh = _proSondeKw * 2100;
      const _erdwaermeKwh = _geoErz.waermeMwh * 1000 * (_geoJaz - 1) / _geoJaz;
      _nEnergie = Math.max(1, Math.ceil(_erdwaermeKwh / _maxEntzugProSondeKwh));
    }
    _dynBohrMeter = Math.max(_nLeistung, _nEnergie) * _geoTiefe;
  }

  // PV-Invest
  const pvInvPerKwp = D.pvInvestMode === 'auto' ? _pvInvestPerKwp(pvKwp) : D.pvInvestManual;

  const result = _calcKostenShared({
    pKw: _bPKw,
    erzList: erzListTyped,
    zinsPct: zinssatz * 100,
    lohn: D.lohn || 45,
    prices: { strom: pStrom, gas: pGas, hko: pHko, fw: pFw, pk: pPk, hhs: pHhs },
    etas: { gaskessel: D.etaGk, heizoel: D.etaHko, pellets: D.etaPk, hhs: D.etaHhs, bhkw: D.etaBhkw, bhkwSigma: D.bhkwSkz },
    investFn: function(key, kw) { return kw > 0.1 ? Math.round(kw * _investProKw(key, kw)) : 0; },
    extra: {
      bohrMeter: _dynBohrMeter,
      nGeb: D.nGeb || 0,
      netzInvest: D.netzInvest || 0,
      stM2: (stMwh || 0) > 0 ? (stM2 || 0) : 0,
      optSpeicherVol: optSpeicherVol || 0,
      tsTyp: D.tsTyp, tsDt: D.tsDt,
    },
    pv: {
      kwp: pvKwp, batKwh: batKwh,
      eigenMwh: pvEigenMwh, einspMwh: pvEinspMwh,
      gesamtEigenMwh: gesamtEigenMwh,
      invPerKwp: pvInvPerKwp,
      batInvPerKwh: D.batInvest,
      vergModell: D.pvVergModell || 'teil',
      pEinsp: pEinsp,
    },
    strom: {
      quartierMwh: quartierStromMwh,
      bhkwEigenMwh: bhkwEigMwh, bhkwEinspMwh: bhkwEinspMwh,
      bhkwStromErloes: bhkwStromErloes,
      pBhkwEinsp: pBhkwEinsp, pBhkwKwkE: pBhkwKwkE, pBhkwKwkEig: pBhkwKwkEig,
    },
    co2: {
      pCo2: D.pCo2 || 0,
      alleET: true,
      emf: { gas: D.gasEmF, heizoel: D.heizoelEmF, pellets: D.pelletsEmF, hhs: D.hhsEmF, fernwaerme: D.fernwaermeEmF, strom: D.stromEmF },
    },
    gesamtMwh: gesamtMwh,
    stMwh: stMwh || 0,
  });

  const pvErtragMwh = pvKwp * D.pvSpez / 1000;

  return { wgk: result.wgk, co2ta: result.co2ta, eeAnteil: result.eeAnteil,
    stromAutarkie: result.stromAutarkie, waermeAutarkie: result.waermeAutarkie,
    investGesamt: result.investGesamt, jahreskosten: result.jahreskosten,
    pvEigenMwh: pvEigenMwh, pvErtragMwh: pvErtragMwh,
    _dbg: { kapitalJk: result.kapitalJk, energieJk: result.energieJk, totalWaerme: result.totalWaerme,
      gesamtMwh, stMwh: stMwh || 0, nGeb: D.nGeb, netzInvest: D.netzInvest,
      basisInvest: result.investGesamt, autoGkMwh, autoGkPeakKw,
      erzList: erzeugerList.map(e => e.key + ':' + e.leistKw.toFixed(0) + 'kW/' + e.waermeMwh.toFixed(1) + 'MWh').join(', ') } };
}

function score(kw, ziel) {
  if (ziel === 'min-wgk') return kw.wgk;
  if (ziel === 'min-co2') return kw.co2ta;
  if (ziel === 'max-autarkie') return -(kw.stromAutarkie + kw.waermeAutarkie);
  if (ziel === 'min-kosten-ee') return kw.eeAnteil >= 65 ? kw.wgk : 1e9 + kw.wgk;
  return kw.wgk;
}

// ── PV+Bat Dimensionierung per marginaler Amortisation ──
// Für jede Bat-Stufe: PV schrittweise vergrößern, bis Amortisation > Schwellwert.
// Dann beste PV+Bat-Kombi per Score auswählen.
function _findOptPvBat(pvSteps, batSteps, demandH, bhkwElH, pvProfile, disp,
                       params, stMwh, stM2, tsVol, ziel, maxAmortJ, simFn, kwFn) {
  const pStrom = params.pStrom;
  // Einspeisevergütung effektiv (abhängig von PV-Größe + Modell)
  function einspeiseCtKwh(pvKwp) {
    const mod = D.pvVergModell || 'teil';
    if (mod === 'teil') return pvKwp <= 0 ? 8.1 : (Math.min(pvKwp,10)*8.1 + Math.max(0,Math.min(pvKwp,40)-10)*7.0 + Math.max(0,pvKwp-40)*5.7) / pvKwp;
    if (mod === 'voll') return pvKwp <= 0 ? 12.9 : (Math.min(pvKwp,10)*12.9 + Math.max(0,pvKwp-10)*10.8) / pvKwp;
    return params.pEinsp || 8;
  }
  function pvInvPerKwp(kwp) {
    if (typeof _pvInvestPerKwp === 'function') return _pvInvestPerKwp(kwp);
    return D.pvInvestManual || 1200;
  }

  let bestPv = 0, bestBat = 0, bestScore = Infinity, bestKw = null;

  // Immer PV=0 testen (Variante ohne PV)
  const pvBat0 = simFn(0, 0, demandH, bhkwElH, pvProfile, disp);
  const kw0 = kwFn(disp, 0, 0, pvBat0, params, stMwh, stM2, tsVol);
  const sc0 = score(kw0, ziel);
  if (sc0 < bestScore) { bestScore = sc0; bestPv = 0; bestBat = 0; bestKw = kw0; }

  for (const batK of batSteps) {
    // Cache: PV-Ergebnisse für diese Bat-Stufe, aufsteigend nach PV-Größe
    let prevEigen = 0, prevEinsp = 0, prevPvK = 0;
    const batInvest = batK * (D.batInvest || 400);

    for (let pi = 0; pi < pvSteps.length; pi++) {
      const pvK = pvSteps[pi];
      if (pvK <= 0) continue;

      const pvBat = simFn(pvK, batK, demandH, bhkwElH, pvProfile, disp);
      const curEigen = pvBat.pvEigenMwh || 0;  // MWh
      const curEinsp = pvBat.pvEinspMwh || 0;  // MWh

      // Marginale Amortisation dieses PV-Inkrements
      const deltaPvInvest = (pvK - prevPvK) * pvInvPerKwp(pvK);
      // Beim ersten PV-Schritt: Batterie-Invest mit einrechnen
      const deltaInvest = deltaPvInvest + (pi === 0 ? batInvest : 0);

      const deltaEigen = curEigen - prevEigen;  // MWh zusätzlicher Eigenverbrauch
      const deltaEinsp = curEinsp - prevEinsp;  // MWh zusätzliche Einspeisung
      // Jährliche Ersparnis: Eigenverbrauch spart Netzbezug, Einspeisung bringt Vergütung
      const deltaSavings = deltaEigen * pStrom * 10 + deltaEinsp * einspeiseCtKwh(pvK) * 10;

      if (deltaSavings <= 0 || deltaInvest / deltaSavings > maxAmortJ) {
        // Dieses Inkrement lohnt sich nicht mehr → Stopp für diese Bat-Stufe
        break;
      }

      // Inkrement OK → kennwerte berechnen und als Kandidat merken
      const kw = kwFn(disp, pvK, batK, pvBat, params, stMwh, stM2, tsVol);
      const sc = score(kw, ziel);
      if (sc < bestScore) { bestScore = sc; bestPv = pvK; bestBat = batK; bestKw = kw; }

      prevEigen = curEigen; prevEinsp = curEinsp; prevPvK = pvK;
    }
  }
  return { pvKwp: bestPv, batKwh: bestBat, kw: bestKw, score: bestScore };
}

// ═══ Hauptlogik ═══
self.onmessage = function(e) {
  const data = e.data;
  D = data.dom;
  const { lastgangKw, tempH, vlH, pvProfile, stNormProfile, quartierH,
    params, aktiv, constraints, ziel, quality, pvAktiv, batAktiv, stAktiv, tsAktiv, globalYear } = data;

  let peak = 0;
  for (let i = 0; i < lastgangKw.length; i++) if (lastgangKw[i] > peak) peak = lastgangKw[i];
  if (peak < 1) peak = 1;

  // Kombinationen
  const _allKombis = [];
  for (let i = 0; i < aktiv.length; i++) _allKombis.push([aktiv[i]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++) _allKombis.push([aktiv[i], aktiv[j]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++)
      for (let k2 = j + 1; k2 < aktiv.length; k2++) _allKombis.push([aktiv[i], aktiv[j], aktiv[k2]]);

  // Gaskessel/Heizöl werden als reguläre Spitzenlastkessel in Kombinationen berücksichtigt
  const kombis = _allKombis;

  const Q = { schnell: { n: 5, pv: 2, bat: 1 }, standard: { n: 7, pv: 3, bat: 2 }, gruendlich: { n: 11, pv: 5, bat: 3 } }[quality];
  const nKand = aktiv.length;
  const GROB_N = Q.n;
  const grobPvN = nKand <= 4 ? Q.pv : nKand <= 6 ? Math.max(1, Q.pv - 1) : 1;
  const grobBatN = nKand <= 4 ? Q.bat : nKand <= 6 ? Math.max(1, Q.bat - 1) : 1;
  const GROB_STUFEN = Array.from({length: GROB_N}, (_, i) => Math.round(i / (GROB_N - 1) * 100) / 100);

  // PV/Bat Steps — dynamische Limits basierend auf Projektgröße
  const hatWP = aktiv.some(k => D.ERZEUGER_TYP[k] === 'wp');
  let gesamtStromSchaetz = 0;
  for (let t = 0; t < 8760; t++) gesamtStromSchaetz += quartierH[t];
  if (hatWP) gesamtStromSchaetz += peak * 0.25 * 8760 / 3.5;
  const gesamtStromSchaetzMwh = gesamtStromSchaetz / 1000;
  const pvMaxConstr = constraints.pv?.maxKw || 0;
  const pvMinConstr = constraints.pv?.minKw || 0;
  const batMaxConstr = constraints.bat?.maxKw || 0;
  // Dynamisch: 150% Strombedarf, min 100 kWp, max 2000 kWp (ohne explizite Obergrenze)
  let pvMaxSinnvoll = pvMaxConstr > 0 ? pvMaxConstr : Math.min(2000, Math.max(100, gesamtStromSchaetzMwh * 1000 / D.pvSpez * 1.5));
  // Dynamisch: 2 kWh/kWp oder Tages-Strombedarf, was größer ist
  const tagesStromKwh = gesamtStromSchaetzMwh * 1000 / 365;
  let batMax = batMaxConstr > 0 ? batMaxConstr : Math.max(Math.round(pvMaxSinnvoll * 2), Math.round(tagesStromKwh));

  let pvStepsGrob, batStepsGrob;
  if (grobPvN <= 1 || !pvAktiv) {
    const pvEst = pvAktiv ? Math.round(gesamtStromSchaetzMwh * 1000 / D.pvSpez * 0.7) : 0;
    pvStepsGrob = [pvEst];
    batStepsGrob = [pvEst > 0 && batAktiv ? Math.round(Math.min(pvEst * 0.3, batMax)) : 0];
  } else {
    pvStepsGrob = pvAktiv ? Array.from({length: grobPvN}, (_, i) => Math.round(pvMaxSinnvoll * i / (grobPvN - 1))) : [0];
    if (pvMinConstr > 0 && pvAktiv) pvStepsGrob = pvStepsGrob.filter(v => v >= pvMinConstr);
    batStepsGrob = batAktiv ? Array.from({length: grobBatN}, (_, i) => Math.round(batMax * i / Math.max(1, grobBatN - 1))) : [0];
  }

  // ST Steps
  let gesamtWaermeMwh = 0;
  for (let t = 0; t < 8760; t++) gesamtWaermeMwh += lastgangKw[t];
  gesamtWaermeMwh /= 1000;
  const stMinConstr = constraints.st?.minKw || 0;
  const stMaxConstr = constraints.st?.maxKw || 0;
  const stMaxSinnvoll = stMaxConstr > 0 ? stMaxConstr : Math.round(gesamtWaermeMwh * 0.4 * 1000 / D.stSpez);
  const grobStN = !stAktiv ? 1 : (nKand <= 4 ? 5 : nKand <= 6 ? 3 : 2);
  let stStepsGrob = stAktiv ? Array.from({length: grobStN}, (_, i) => Math.round(stMaxSinnvoll * i / (grobStN - 1))) : [0];
  if (stMinConstr > 0 && stAktiv) stStepsGrob = stStepsGrob.filter(v => v >= stMinConstr || v === 0);
  if (!stAktiv) stStepsGrob = [0];

  // TS Steps
  const tsMinConstr = constraints.ts?.minKw || 0;
  const tsMaxConstr = constraints.ts?.maxKw || 0;
  let tsStepsGrob;
  if (!tsAktiv) {
    tsStepsGrob = [0];
  } else {
    // Einfache Auto-Sizing im Worker (ohne DOM-Leistungswerte — verwende Peak-basierte Schätzung)
    const wpFrac = aktiv.filter(k => D.ERZEUGER_TYP[k] === 'wp').length > 0 ? 0.5 : 0;
    const estWpKw = peak * wpFrac;
    const tsAutoVol = estWpKw > 0 ? Math.round(estWpKw * 3 / (1.16 * D.tsDt)) : 50;
    const tsMaxVol = tsMaxConstr > 0 ? tsMaxConstr : Math.round(tsAutoVol * 3);
    const tsMinVol = tsMinConstr > 0 ? tsMinConstr : 0;
    const grobTsN = nKand <= 4 ? 5 : 3;
    tsStepsGrob = [0];
    for (let i = 1; i < grobTsN; i++) {
      const vol = Math.round(tsMinVol + (tsMaxVol - tsMinVol) * i / (grobTsN - 1));
      if (vol > 0 && !tsStepsGrob.includes(vol)) tsStepsGrob.push(vol);
    }
    if (tsMinConstr > 0) tsStepsGrob = tsStepsGrob.filter(v => v >= tsMinConstr || v === 0);
  }

  // ST Reduced Lastgang Helper — gibt auch ST-Überschuss zurück für Speicherbeladung
  function stReducedLastgang(stM2) {
    if (stM2 <= 0 || !stNormProfile) return { lastgang: lastgangKw, waermeMwh: 0, stExcessH: null };
    const reduced = new Float32Array(8760);
    const stExcessH = new Float32Array(8760);
    let sumKwh = 0;
    for (let t = 0; t < 8760; t++) {
      const stKw = stNormProfile[t] * stM2;
      const used = Math.min(stKw, lastgangKw[t]);
      reduced[t] = lastgangKw[t] - used;
      stExcessH[t] = stKw - used;
      sumKwh += used;
    }
    return { lastgang: reduced, waermeMwh: sumKwh / 1000, stExcessH };
  }

  // Config Batches aufbauen
  const configBatches = [];
  function makeErzObj(key, frac) {
    const con = constraints[key] || {};
    let kw = Math.round(frac * peak);
    if (con.minKw > 0 && (!con.bisJahr || con.bisJahr >= globalYear)) kw = Math.max(kw, con.minKw);
    if (con.maxKw > 0) kw = Math.min(kw, con.maxKw);
    kw = Math.max(1, kw);
    return { key, leistKw: kw, typ: D.ERZEUGER_TYP[key] || 'fix', guetegrad: D.guetegrade[key] || _defaultGuetegrad(key) };
  }
  function getConstrainedFracs(key) {
    const con = constraints[key] || {};
    const minFrac = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= globalYear) ? con.minKw / peak : 0;
    const maxFrac = con.maxKw > 0 ? con.maxKw / peak : 1.5;
    const fracs = [];
    for (const f of GROB_STUFEN) {
      if (f < minFrac - 0.02 || f > maxFrac + 0.02) continue;
      fracs.push(f);
    }
    if (fracs.length === 0) fracs.push(Math.max(minFrac, 0.08));
    return fracs;
  }

  for (const keys of kombis) {
    const sortedKeys = keys.slice().sort((a, b) => {
      const ia = D.OPT_MERIT_ORDER.indexOf(a);
      const ib = D.OPT_MERIT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const kombiKey = keys.slice().sort().join('+');
    const configs = [];
    if (sortedKeys.length === 1) {
      for (const f0 of getConstrainedFracs(sortedKeys[0])) { if (f0 < 0.01) continue; configs.push([makeErzObj(sortedKeys[0], f0)]); }
    } else if (sortedKeys.length === 2) {
      const fr0 = getConstrainedFracs(sortedKeys[0]), fr1 = getConstrainedFracs(sortedKeys[1]);
      for (const f0 of fr0) for (const f1 of fr1) { if (f0 + f1 < 0.05) continue; configs.push([makeErzObj(sortedKeys[0], f0), makeErzObj(sortedKeys[1], f1)]); }
    } else if (sortedKeys.length === 3) {
      const fr0 = getConstrainedFracs(sortedKeys[0]), fr1 = getConstrainedFracs(sortedKeys[1]), fr2 = getConstrainedFracs(sortedKeys[2]);
      for (const f0 of fr0) for (const f1 of fr1) for (const f2 of fr2) { if (f0 + f1 + f2 < 0.05) continue; configs.push([makeErzObj(sortedKeys[0], f0), makeErzObj(sortedKeys[1], f1), makeErzObj(sortedKeys[2], f2)]); }
    }
    configBatches.push({ kombiKey, keys: sortedKeys, sortedKeys, configs });
  }

  // ═══ Multi-Worker Modus: nur Grobsuche oder nur Feinsuche ═══
  const _mode = data.mode || 'full';
  const _workerIdx = data.workerIdx || 0;
  const _numWorkers = data.numWorkers || 1;

  // ═══ GROBSUCHE (wird im 'fein'-Modus übersprungen) ═══
  const grobResults = [];
  let _topNGrob = [];

  if (_mode !== 'fein') {
    // Arbeitspakete aufbauen (alle Kombinationen aus configs × ST × TS)
    let allWorkItems = [];
    for (const batch of configBatches) {
      for (const config of batch.configs) {
        for (const stM2 of stStepsGrob) {
          for (const tsVol of tsStepsGrob) {
            allWorkItems.push({ batch, config, stM2, tsVol });
          }
        }
      }
    }

    // Multi-Worker: nur eigenen Anteil bearbeiten
    if (_numWorkers > 1) {
      allWorkItems = allWorkItems.filter((_, i) => i % _numWorkers === _workerIdx);
    }
    const totalConfigs = allWorkItems.length;

    let doneConfigs = 0;
    let lastProgressAt = 0;

    for (const { batch, config, stM2, tsVol } of allWorkItems) {
      doneConfigs++;
      const { lastgang: lgForDisp, waermeMwh: stMwh, stExcessH } = stReducedLastgang(stM2);
      const disp = dispatch8760(lgForDisp, tempH, vlH, config.map(c => ({...c})), tsVol, stExcessH);

      // Mindestleistung: Jeder Erzeuger muss ≥10% der Spitzenleistung liefern
      const minKw = peak * 0.1;
      if (config.length > 1 && disp.erzeugerList.some(e => e.leistKw < minKw)) continue;

      const demandH = new Float32Array(8760);
      for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];

      const pvBatRes = _findOptPvBat(pvStepsGrob, batStepsGrob, demandH, disp.bhkwElH, pvProfile, disp,
        params, stMwh, stM2, tsVol, ziel, D.pvMaxAmort || 10, pvBatSim8760, kennwerte);
      if (pvBatRes.kw) {
        grobResults.push({ kombiKey: batch.kombiKey, keys: batch.keys, config,
          pvKwp: pvBatRes.pvKwp, batKwh: pvBatRes.batKwh, stM2, stMwh, tsVol, kw: pvBatRes.kw, score: pvBatRes.score });
      }

      const now = Date.now();
      if (now - lastProgressAt > 500) {
        lastProgressAt = now;
        const pct = Math.round(doneConfigs / totalConfigs * 100);
      self.postMessage({ type: 'progress', phase: 'Grobsuche', pct, done: doneConfigs, total: totalConfigs, workerIdx: _workerIdx });
    }
  }

    // Modus 'grob': nur Grobsuche, Ergebnisse zurücksenden und fertig
    if (_mode === 'grob') {
      self.postMessage({ type: 'grob_done', grobResults, workerIdx: _workerIdx });
      return;
    }

    // Deduplizierung (für 'full'-Modus)
    grobResults.sort((a, b) => a.score - b.score);
    const seen = new Set();
    const grobTop = [];
    for (const r of grobResults) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); grobTop.push(r); }
    }
    _topNGrob = grobTop.slice(0, 5);
  } // Ende: if (_mode !== 'fein')

  // topNGrob bestimmen: aus Grobsuche oder aus Message (fein-Modus)
  const topNGrob = (_mode === 'fein') ? (data.topNGrob || []) : _topNGrob;

  // ═══ FEINSUCHE ═══
  const FEIN_STEP = Math.max(1, Math.round(peak / 200));
  const topFein = [];

  for (let fi = 0; fi < topNGrob.length; fi++) {
    self.postMessage({ type: 'progress', phase: 'Feinsuche', pct: Math.round(fi / topNGrob.length * 100), done: fi, total: topNGrob.length });
    const grob = topNGrob[fi];
    let currentConfig = grob.config.map(c => ({...c}));
    let currentStM2 = grob.stM2 || 0;
    let currentTsVol = grob.tsVol || 0;
    const feinRange = Math.round(peak * 0.10);

    for (let runde = 0; runde < 2; runde++) {
      let changed = false;
      const { lastgang: lgFein, waermeMwh: stMwhFein, stExcessH: stExFein } = stReducedLastgang(currentStM2);

      for (let ei = 0; ei < currentConfig.length; ei++) {
        const erz = currentConfig[ei];
        const con = constraints[erz.key] || {};
        const minKwCon = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= globalYear) ? con.minKw : 1;
        const maxKwCon = con.maxKw > 0 ? con.maxKw : Math.round(peak * 1.2);
        const _minKwFein = currentConfig.length > 1 ? Math.round(peak * 0.1) : 1;
        const lo = Math.max(_minKwFein, minKwCon, erz.leistKw - feinRange);
        const hi = Math.min(maxKwCon, erz.leistKw + feinRange);
        let bestKwVal = erz.leistKw, bestScoreVal = Infinity;
        for (let kw = lo; kw <= hi; kw += FEIN_STEP) {
          const tc = currentConfig.map(c => ({...c}));
          tc[ei] = { ...erz, leistKw: kw };
          const disp = dispatch8760(lgFein, tempH, vlH, tc, currentTsVol, stExFein);
          const demH = new Float32Array(8760);
          for (let t = 0; t < 8760; t++) demH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
          const pvBat = pvBatSim8760(grob.pvKwp, grob.batKwh, demH, disp.bhkwElH, pvProfile, disp);
          const kwR = kennwerte(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhFein, currentStM2, currentTsVol);
          const sc = score(kwR, ziel);
          if (sc < bestScoreVal) { bestScoreVal = sc; bestKwVal = kw; }
        }
        if (bestKwVal !== erz.leistKw) changed = true;
        currentConfig[ei] = { ...erz, leistKw: bestKwVal };
      }

      // ST fein
      if (stAktiv && currentStM2 > 0) {
        const stLo = Math.max(stMinConstr, Math.round(currentStM2 * 0.8));
        const stHi = stMaxConstr > 0 ? Math.min(stMaxConstr, Math.round(currentStM2 * 1.2)) : Math.round(currentStM2 * 1.2);
        const stStep = Math.max(1, Math.round((stHi - stLo) / 10));
        let bestSt = currentStM2, bestStSc = Infinity;
        for (let sm2 = stLo; sm2 <= stHi; sm2 += stStep) {
          const { lastgang: lgSt, waermeMwh: mwh, stExcessH: stExSt } = stReducedLastgang(sm2);
          const disp = dispatch8760(lgSt, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExSt);
          const demH = new Float32Array(8760);
          for (let t = 0; t < 8760; t++) demH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
          const pvBat = pvBatSim8760(grob.pvKwp, grob.batKwh, demH, disp.bhkwElH, pvProfile, disp);
          const kwR = kennwerte(disp, grob.pvKwp, grob.batKwh, pvBat, params, mwh, sm2, currentTsVol);
          const sc = score(kwR, ziel);
          if (sc < bestStSc) { bestStSc = sc; bestSt = sm2; }
        }
        if (bestSt !== currentStM2) { changed = true; currentStM2 = bestSt; }
      }

      // TS fein
      if (tsAktiv && currentTsVol > 0) {
        const tsLo = Math.max(tsMinConstr, Math.round(currentTsVol * 0.7));
        const tsHi = tsMaxConstr > 0 ? Math.min(tsMaxConstr, Math.round(currentTsVol * 1.3)) : Math.round(currentTsVol * 1.3);
        const tsStep = Math.max(1, Math.round((tsHi - tsLo) / 8));
        let bestTs = currentTsVol, bestTsSc = Infinity;
        const { lastgang: lgTs, waermeMwh: mwhTs, stExcessH: stExTs } = stReducedLastgang(currentStM2);
        for (let tv = tsLo; tv <= tsHi; tv += tsStep) {
          const disp = dispatch8760(lgTs, tempH, vlH, currentConfig.map(c => ({...c})), tv, stExTs);
          const demH = new Float32Array(8760);
          for (let t = 0; t < 8760; t++) demH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
          const pvBat = pvBatSim8760(grob.pvKwp, grob.batKwh, demH, disp.bhkwElH, pvProfile, disp);
          const kwR = kennwerte(disp, grob.pvKwp, grob.batKwh, pvBat, params, mwhTs, currentStM2, tv);
          const sc = score(kwR, ziel);
          if (sc < bestTsSc) { bestTsSc = sc; bestTs = tv; }
        }
        if (bestTs !== currentTsVol) { changed = true; currentTsVol = bestTs; }
      }

      if (!changed) break;
    }

    // PV/Bat Volloptimierung mit Auto-Expand bei Rand-Optimum
    const { lastgang: lgFinal, waermeMwh: stMwhFinal, stExcessH: stExFinal } = stReducedLastgang(currentStM2);
    const finalDisp = dispatch8760(lgFinal, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExFinal);
    const demFinal = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) demFinal[t] = finalDisp.wpElH[t] + finalDisp.skElH[t] + quartierH[t];

    // PV/Bat Feinoptimierung per marginaler Amortisation (feinere Steps als Grobphase)
    const pvStepsFein = pvAktiv ? Array.from({length: 15}, (_, i) => Math.round(pvMaxSinnvoll * i / 14)) : [0];
    if (pvMinConstr > 0 && pvAktiv) { const f = pvStepsFein.filter(v => v >= pvMinConstr || v === 0); if (f.length > 0) { pvStepsFein.length = 0; f.forEach(v => pvStepsFein.push(v)); } }
    const batStepsFein = batAktiv ? Array.from({length: 8}, (_, i) => Math.round(batMax * i / 7)) : [0];

    const pvBatFein = _findOptPvBat(pvStepsFein, batStepsFein, demFinal, finalDisp.bhkwElH, pvProfile, finalDisp,
      params, stMwhFinal, currentStM2, currentTsVol, ziel, D.pvMaxAmort || 10, pvBatSim8760, kennwerte);
    const bestPv = pvBatFein.pvKwp, bestBat = pvBatFein.batKwh, bestScF = pvBatFein.score;

    const finalPvBat = pvBatSim8760(bestPv, bestBat, demFinal, finalDisp.bhkwElH, pvProfile, finalDisp);
    const finalKw = kennwerte(finalDisp, bestPv, bestBat, finalPvBat, params, stMwhFinal, currentStM2, currentTsVol);

    topFein.push({
      keys: grob.keys, config: currentConfig, pvKwp: bestPv, batKwh: bestBat,
      stM2: currentStM2, stMwh: stMwhFinal, tsVol: currentTsVol,
      kw: finalKw, gesamtMwh: finalDisp.gesamtMwh, autoGkMwh: finalDisp.autoGkMwh,
      autoGkPeakKw: finalDisp.autoGkPeakKw,
      erzWaermeMwh: finalDisp.erzeugerList.map(e => e.waermeMwh),
      erzLeistKw: finalDisp.erzeugerList.map(e => e.leistKw),
      erzElMwh: finalDisp.erzeugerList.map(e => e.elMwh),
      speicherEntladenMwh: finalDisp.speicherEntladenMwh || 0,
      pvBatData: finalPvBat ? { eigenMwh: finalPvBat.eigenMwh, einspeiseMwh: finalPvBat.einspeiseMwh,
        pvEigenMwh: finalPvBat.pvEigenMwh, pvEinspMwh: finalPvBat.pvEinspMwh,
        bhkwEigenMwh: finalPvBat.bhkwEigenMwh, bhkwEinspMwh: finalPvBat.bhkwEinspMwh,
        netzbezugMwh: finalPvBat.netzbezugMwh } : null,
      score: bestScF,
    });
  }

  // Ergebnisse zurücksenden
  self.postMessage({ type: 'done', topFein, grobResults: grobResults.map(r => ({
    kombiKey: r.kombiKey, keys: r.keys, kw: r.kw, score: r.score,
    stM2: r.stM2, tsVol: r.tsVol, pvKwp: r.pvKwp, batKwh: r.batKwh
  })) });
};
`;
}

function _doRunOptimierung(resDiv) {
  // PV-Profil einmal cachen (ändert sich nicht während Optimierung)
  window._optCachedPvProfile = (typeof makePvProfile8760 === 'function') ? makePvProfile8760() : null;
  // 1. Lastgang holen — für gewähltes Betrachtungsjahr skaliert
  const ss = window.systemState;
  const optYear = parseInt(document.getElementById('opt-year')?.value) || (typeof globalYear !== 'undefined' ? globalYear : 2026);
  const lastgangKw = _optGetScaledLastgang(optYear) || ss?.lastgangKw;
  const tempH = ss?.tempH;
  const vlH = ss?.vlH;

  if (!lastgangKw || lastgangKw.length < 8760 || !tempH || !vlH) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Kein stundenscharfer Lastgang verfügbar. Bitte zuerst Grundlagen berechnen (8760h Lastgang + Temperatur + Vorlauftemperatur erforderlich).</div>';
    return;
  }

  // Peak-Last bestimmen
  let peak = 0;
  for (let i = 0; i < lastgangKw.length; i++) { if (lastgangKw[i] > peak) peak = lastgangKw[i]; }
  if (peak < 1) peak = 1;

  // 2. Wirtschaftsparameter
  const pStrom   = parseFloat(document.getElementById('wirt-p-strom')?.value) || 30;
  const pGas     = parseFloat(document.getElementById('wirt-p-gas')?.value)   || 10;
  const pPk      = parseFloat(document.getElementById('wirt-p-pk')?.value)    || 7;
  const pHhs     = parseFloat(document.getElementById('wirt-p-hhs')?.value)   || 4;
  const pHko     = parseFloat(document.getElementById('wirt-p-hko')?.value)   || 9.5;
  const pFw      = parseFloat(document.getElementById('wirt-p-fw')?.value)    || 8;
  const pEinsp   = parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8;
  const pBhkwEinsp = parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8;
  const pBhkwKwkE  = parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8;
  const pBhkwKwkEig = parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4;
  const zins     = (parseFloat(document.getElementById('wirt-zins')?.value) || 2.7) / 100;
  const params = { pStrom, pGas, pPk, pHhs, pHko, pFw, pEinsp, pBhkwEinsp, pBhkwKwkE, pBhkwKwkEig, zinssatz: zins };

  // 3. Aktive Kandidaten + Constraints
  const allKeys = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel'];
  const aktiv = allKeys.filter(k => document.getElementById('opt-cand-' + k)?.checked);
  if (aktiv.length === 0) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Bitte mindestens einen Kandidaten w\u00e4hlen.</div>';
    return;
  }
  const pvAktiv  = document.getElementById('opt-cand-pv')?.checked;
  const batAktiv = document.getElementById('opt-cand-bat')?.checked;
  const stAktiv  = document.getElementById('opt-cand-st')?.checked;
  const tsAktiv  = document.getElementById('opt-cand-ts')?.checked;

  const constraints = {};
  for (const k of [...allKeys, 'pv', 'bat', 'ts']) {
    constraints[k] = {
      minKw:    parseFloat(document.getElementById('opt-min-' + k)?.value)  || 0,
      maxKw:    parseFloat(document.getElementById('opt-max-' + k)?.value)  || 0,
      bisJahr:  parseInt(document.getElementById('opt-bis-' + k)?.value)    || 0,
    };
  }

  // 4. Optimierungsziel
  const ziel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';

  // 5. Kombinationen generieren (Einzeln + Paare + ggf. Tripel)
  const _allKombis = [];
  for (let i = 0; i < aktiv.length; i++) _allKombis.push([aktiv[i]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++)
      _allKombis.push([aktiv[i], aktiv[j]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++)
      for (let k2 = j + 1; k2 < aktiv.length; k2++)
        _allKombis.push([aktiv[i], aktiv[j], aktiv[k2]]);

  // Gaskessel/Heizöl werden als reguläre Spitzenlastkessel in Kombinationen berücksichtigt
  const kombis = _allKombis;

  // 6. Quartier-Stromprofil vorbereiten (gleiche Kaskade wie calcStromPanel)
  const quartierH = new Float32Array(8760);
  if (window.elQuartierH) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window.elQuartierH[t];
  } else if (window._elQuartierFromGeb) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window._elQuartierFromGeb[t];
  } else {
    const qMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
    if (qMwh > 0) {
      const perH = qMwh * 1000 / 8760;
      for (let t = 0; t < 8760; t++) quartierH[t] = perH;
    } else if (typeof aggregateGebStrom === 'function') {
      const gebStrom = aggregateGebStrom();
      if (gebStrom && gebStrom.totalMWh > 0) {
        for (let t = 0; t < 8760; t++) quartierH[t] = gebStrom.hourly[t];
      }
    }
  }

  // Quartier-Strom Check

  // 7. PV/Bat Vorbereitung
  const spez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const pvMaxConstr = constraints.pv?.maxKw || 0;
  const pvMinConstr = constraints.pv?.minKw || 0;
  const batMaxConstr = constraints.bat?.maxKw || 0;

  // Gesamt-Strombedarf schätzen (für PV-Sizing)
  let gesamtStromSchaetz = 0;
  for (let t = 0; t < 8760; t++) gesamtStromSchaetz += quartierH[t];
  const hatWP = aktiv.some(k => ERZEUGER_CFG[k]?.typ === 'wp');
  if (hatWP) gesamtStromSchaetz += peak * 0.25 * 8760 / 3.5;
  const gesamtStromSchaetzMwh = gesamtStromSchaetz / 1000;
  // Dynamisch: 300% Strombedarf, min 200 kWp
  let pvMaxSinnvoll = pvMaxConstr > 0 ? pvMaxConstr : Math.min(2000, Math.max(100, gesamtStromSchaetzMwh * 1000 / spez * 1.5));
  // Dynamisch: 2 kWh/kWp oder Tages-Strombedarf, was größer ist
  const tagesStromKwh = gesamtStromSchaetzMwh * 1000 / 365;
  let batMax = batMaxConstr > 0 ? batMaxConstr : Math.max(Math.round(pvMaxSinnvoll * 2), Math.round(tagesStromKwh));

  // 8. ADAPTIVE GROBSUCHE — Auflösung abhängig von Genauigkeits-Setting + Kandidatenanzahl
  const nKand = aktiv.length;
  const optQuality = document.getElementById('opt-quality')?.value || 'standard';
  // Basis-Auflösungen pro Quality-Stufe
  const Q = { schnell: { n: 5, pv: 2, bat: 1 }, standard: { n: 7, pv: 3, bat: 2 }, gruendlich: { n: 11, pv: 5, bat: 3 } }[optQuality];
  // Bei vielen Kandidaten: PV/Bat reduzieren um kombinatorische Explosion zu begrenzen
  let GROB_N = Q.n;
  let grobPvN = nKand <= 4 ? Q.pv : nKand <= 6 ? Math.max(1, Q.pv - 1) : 1;
  let grobBatN = nKand <= 4 ? Q.bat : nKand <= 6 ? Math.max(1, Q.bat - 1) : 1;

  // Leistungsstufen generieren (gleichmäßig verteilt inkl. 0 und 1)
  const GROB_STUFEN = Array.from({length: GROB_N}, (_, i) => Math.round(i / (GROB_N - 1) * 100) / 100);

  // PV/Bat Stufen für Grobsuche
  let pvStepsGrob, batStepsGrob;
  if (grobPvN <= 1 || !pvAktiv) {
    // Nur 1 geschätzte PV-Größe (basierend auf geschätztem Strombedarf)
    const pvEst = pvAktiv ? Math.round(gesamtStromSchaetzMwh * 1000 / spez * 0.7) : 0;
    pvStepsGrob = [pvEst];
    batStepsGrob = [pvEst > 0 && batAktiv ? Math.round(Math.min(pvEst * 0.3, batMax)) : 0];
  } else {
    pvStepsGrob = pvAktiv ? Array.from({length: grobPvN}, (_, i) => Math.round(pvMaxSinnvoll * i / (grobPvN - 1))) : [0];
    if (pvMinConstr > 0 && pvAktiv) pvStepsGrob = pvStepsGrob.filter(v => v >= pvMinConstr);
    batStepsGrob = batAktiv ? Array.from({length: grobBatN}, (_, i) => Math.round(batMax * i / Math.max(1, grobBatN - 1))) : [0];
  }

  const grobResults = [];

  // Konfigurationen für Dispatch vorbauen
  const configBatches = [];

  function _makeErzObj(key, frac) {
    const con = constraints[key] || {};
    let kw = Math.round(frac * peak);
    if (con.minKw > 0 && (!con.bisJahr || con.bisJahr >= (typeof globalYear !== 'undefined' ? globalYear : 2026))) {
      kw = Math.max(kw, con.minKw);
    }
    if (con.maxKw > 0) kw = Math.min(kw, con.maxKw);
    kw = Math.max(1, kw);
    return { key, leistKw: kw, typ: ERZEUGER_CFG[key]?.typ || 'fix', guetegrad: _readGuetegrad(key) };
  }

  function _getConstrainedFracs(key) {
    const con = constraints[key] || {};
    const curYear = (typeof globalYear !== 'undefined' ? globalYear : 2026);
    const minFrac = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= curYear) ? con.minKw / peak : 0;
    const maxFrac = con.maxKw > 0 ? con.maxKw / peak : 1.5;
    const fracs = [];
    for (const f of GROB_STUFEN) {
      if (f < minFrac - 0.02) continue;
      if (f > maxFrac + 0.02) continue;
      fracs.push(f);
    }
    if (fracs.length === 0) fracs.push(Math.max(minFrac, 0.08));
    return fracs;
  }

  for (const keys of kombis) {
    const sortedKeys = keys.slice().sort((a, b) => {
      const ia = OPT_MERIT_ORDER.indexOf(a);
      const ib = OPT_MERIT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const kombiKey = keys.slice().sort().join('+');
    const configs = [];

    if (sortedKeys.length === 1) {
      for (const f0 of _getConstrainedFracs(sortedKeys[0])) {
        if (f0 < 0.01) continue;
        configs.push([_makeErzObj(sortedKeys[0], f0)]);
      }
    } else if (sortedKeys.length === 2) {
      const fr0 = _getConstrainedFracs(sortedKeys[0]), fr1 = _getConstrainedFracs(sortedKeys[1]);
      for (const f0 of fr0) for (const f1 of fr1) {
        if (f0 + f1 < 0.05) continue;
        configs.push([_makeErzObj(sortedKeys[0], f0), _makeErzObj(sortedKeys[1], f1)]);
      }
    } else if (sortedKeys.length === 3) {
      const fr0 = _getConstrainedFracs(sortedKeys[0]), fr1 = _getConstrainedFracs(sortedKeys[1]), fr2 = _getConstrainedFracs(sortedKeys[2]);
      for (const f0 of fr0) for (const f1 of fr1) for (const f2 of fr2) {
        if (f0 + f1 + f2 < 0.05) continue;
        configs.push([_makeErzObj(sortedKeys[0], f0), _makeErzObj(sortedKeys[1], f1), _makeErzObj(sortedKeys[2], f2)]);
      }
    }
    configBatches.push({ kombiKey, keys: sortedKeys, sortedKeys, configs });
  }

  // Solarthermie-Stufen vorbereiten (variable Kollektorfläche in m²)
  const stSpez = parseFloat(document.getElementById('st-spez')?.value) || 400;
  const stMinConstr = parseFloat(document.getElementById('opt-min-st')?.value) || 0;
  const stMaxConstr = parseFloat(document.getElementById('opt-max-st')?.value) || 0;
  // Normiertes Solarprofil einmal berechnen (1 m² Basis)
  const stNormProfile = stAktiv ? makeStProfile8760(1) : null; // kW pro m² pro Stunde
  // Gesamt-Wärmebedarf in MWh für Obergrenze
  let gesamtWaermeMwh = 0;
  for (let t = 0; t < 8760; t++) gesamtWaermeMwh += lastgangKw[t];
  gesamtWaermeMwh /= 1000;
  // Sinnvolle Max-Fläche: ST soll max. ~40% der Jahreswärme liefern können
  const stMaxSinnvoll = stMaxConstr > 0 ? stMaxConstr : Math.round(gesamtWaermeMwh * 0.4 * 1000 / stSpez);
  // ST-Stufen adaptiv: bei vielen Kandidaten weniger ST-Varianten
  const grobStN = !stAktiv ? 1 : (nKand <= 4 ? 5 : nKand <= 6 ? 3 : 2);
  let stStepsGrob = stAktiv
    ? Array.from({length: grobStN}, (_, i) => Math.round(stMaxSinnvoll * i / (grobStN - 1)))
    : [0];
  if (stMinConstr > 0 && stAktiv) stStepsGrob = stStepsGrob.filter(v => v >= stMinConstr || v === 0);
  if (!stAktiv) stStepsGrob = [0];

  // Wärmespeicher-Stufen vorbereiten (variable Volumen in m³)
  const tsTyp = document.getElementById('ts-typ')?.value || 'puffer';
  const tsMinConstr = parseFloat(document.getElementById('opt-min-ts')?.value) || 0;
  const tsMaxConstr = parseFloat(document.getElementById('opt-max-ts')?.value) || 0;
  let tsStepsGrob;
  if (!tsAktiv) {
    tsStepsGrob = [0];
  } else {
    // Auto-Sizing als Basis: berechne empfohlenes Volumen aus WP-Kapazität
    const tsAutoVol = _autoSpeicherVolumen(tsTyp, parseFloat(document.getElementById('ts-dt')?.value) || 40);
    const tsMaxVol = tsMaxConstr > 0 ? tsMaxConstr : Math.round(tsAutoVol * 3);
    const tsMinVol = tsMinConstr > 0 ? tsMinConstr : 0;
    const grobTsN = nKand <= 4 ? 5 : 3;
    tsStepsGrob = [0]; // immer auch ohne Speicher testen
    for (let i = 1; i < grobTsN; i++) {
      const vol = Math.round(tsMinVol + (tsMaxVol - tsMinVol) * i / (grobTsN - 1));
      if (vol > 0 && !tsStepsGrob.includes(vol)) tsStepsGrob.push(vol);
    }
    if (tsMinConstr > 0) tsStepsGrob = tsStepsGrob.filter(v => v >= tsMinConstr || v === 0);
  }

  // Hilfsfunktion: Lastgang mit ST-Abzug und Wärme-Summe + Überschuss für Speicher
  function _stReducedLastgang(stM2) {
    if (stM2 <= 0 || !stNormProfile) return { lastgang: lastgangKw, waermeMwh: 0, stExcessH: null };
    const reduced = new Float32Array(8760);
    const stExcessH = new Float32Array(8760);
    let sumKwh = 0;
    for (let t = 0; t < 8760; t++) {
      const stKw = stNormProfile[t] * stM2;
      const used = Math.min(stKw, lastgangKw[t]);
      reduced[t] = lastgangKw[t] - used;
      stExcessH[t] = stKw - used;
      sumKwh += used;
    }
    return { lastgang: reduced, waermeMwh: sumKwh / 1000, stExcessH };
  }


  let totalConfigs = 0;
  for (const batch of configBatches) totalConfigs += batch.configs.length * stStepsGrob.length * tsStepsGrob.length;
  let doneConfigs = 0;

  // Asynchrone Batch-Verarbeitung für UI-Responsivität
  let batchIdx = 0;
  let configIdx = 0;
  let stIdx = 0;
  let tsIdx = 0;

  const _optStartTime = Date.now();

  function processBatch() {
    if (_optAborted) {
      const elapsed = ((Date.now() - _optStartTime) / 1000).toFixed(0);
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Abgebrochen nach ' + elapsed + 's. ' + doneConfigs + '/' + totalConfigs + ' Konfigurationen berechnet.</div>';
      if (grobResults.length > 0) { finishOptimierung(); } else { _optFinished(); }
      return;
    }
    const startTime = Date.now();
    const BATCH_TIME_MS = 200; // 200ms pro Batch — reduziert yields gegen Browser-Throttling

    while (batchIdx < configBatches.length) {
      const batch = configBatches[batchIdx];

      while (configIdx < batch.configs.length) {
        const config = batch.configs[configIdx];

        while (stIdx < stStepsGrob.length) {
          const stM2 = stStepsGrob[stIdx];

          while (tsIdx < tsStepsGrob.length) {
            const tsVol = tsStepsGrob[tsIdx];
            tsIdx++;
            doneConfigs++;

            // ST vom Lastgang abziehen
            const { lastgang: lgForDisp, waermeMwh: stMwh, stExcessH } = _stReducedLastgang(stM2);

            // Dispatch (mit optionalem Speichervolumen + ST-Überschuss → Speicher)
            const disp = _optDispatch8760(lgForDisp, tempH, vlH, config.map(c => ({...c})), tsVol, stExcessH);

            // Mindestleistung: Jeder Erzeuger muss ≥10% der Spitzenleistung liefern
            const minKw = peak * 0.1;
            if (config.length > 1 && disp.erzeugerList.some(e => e.leistKw < minKw)) continue;

            // Stromprofil: WP + SK + Quartier
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) {
              demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            }

            // PV/Bat Suche per marginaler Amortisation
            const pvMaxAmort = parseFloat(document.getElementById('opt-pv-max-amort')?.value) || 10;
            const pvBatRes = _findOptPvBatMain(pvStepsGrob, batStepsGrob, demandH, disp.bhkwElH, disp,
              params, stMwh, stM2, tsVol, ziel, pvMaxAmort);

            if (pvBatRes.kw) {
              grobResults.push({
                kombiKey: batch.kombiKey,
                keys: batch.keys,
                config: config,
                pvKwp: pvBatRes.pvKwp,
                batKwh: pvBatRes.batKwh,
                stM2: stM2,
                stMwh: stMwh,
                tsVol: tsVol,
                kw: pvBatRes.kw,
                score: pvBatRes.score
              });
            }

            // UI-Update check
            if (Date.now() - startTime > BATCH_TIME_MS) {
              const pct = Math.round(doneConfigs / totalConfigs * 100);
              const elapsed = ((Date.now() - _optStartTime) / 1000).toFixed(0);
              resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">Grobsuche (' + GROB_N + ' Stufen, ' + nKand + ' Kand.' + (stAktiv ? ', ST variabel' : '') + (tsAktiv ? ', TS variabel' : '') + '): ' + pct + '% \u00b7 ' + doneConfigs + '/' + totalConfigs + ' \u00b7 ' + elapsed + 's</div>';
              setTimeout(processBatch, 0);
              return;
            }
          }

          tsIdx = 0;
          stIdx++;
        }

        stIdx = 0;
        configIdx++;
      }

      configIdx = 0;
      batchIdx++;
    }

    // Grobsuche fertig — weiter mit Deduplizierung und Feinsuche
    finishOptimierung();
  }

  function finishOptimierung() {
    if (grobResults.length === 0) {
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse. Bitte Lastgang berechnen.</div>';
      _optFinished();
      return;
    }
    // Grob-Ergebnisse für Scatter-Plot aufheben
    window._optGrobResults = grobResults.slice();

    // Dedupliziere: pro kombiKey nur bestes Ergebnis, Top 5 weiterreichen
    grobResults.sort((a, b) => a.score - b.score);
    const seen = new Set();
    const grobTop = [];
    for (const r of grobResults) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); grobTop.push(r); }
    }
    const topNGrob = grobTop.slice(0, 5); // Top 5 für Feinsuche

    resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">Feinsuche l\u00e4uft\u2026</div>';

    // Feinsuche asynchron — 5-kW-Schritte statt 1-kW für Performanz
    let feinIdx = 0;
    const topFein = [];
    const FEIN_STEP = Math.max(1, Math.round(peak / 200)); // ~5 kW bei peak=1000

    function processFein() {
      if (_optAborted || feinIdx >= topNGrob.length) {
        // Top 3 an Renderer übergeben (auch bei Abbruch, falls Teilergebnisse da)
        const pool = topFein.length > 0 ? topFein : topNGrob;
        pool.sort((a, b) => a.score - b.score);
        renderResults(pool.slice(0, 3));
        return;
      }

      const grob = topNGrob[feinIdx];
      feinIdx++;

      // Sequentielle Feinsuche pro Erzeuger-Achse, 2 Runden
      let currentConfig = grob.config.map(c => ({...c}));
      let currentStM2 = grob.stM2 || 0;
      let currentTsVol = grob.tsVol || 0;
      const feinRange = Math.round(peak * 0.10);

      for (let runde = 0; runde < 2; runde++) {
        let changed = false;
        // ST vom Lastgang abziehen mit aktueller ST-Fläche
        const { lastgang: lgFein, waermeMwh: stMwhFein, stExcessH: stExFein } = _stReducedLastgang(currentStM2);

        for (let ei = 0; ei < currentConfig.length; ei++) {
          const erz = currentConfig[ei];
          const con = constraints[erz.key] || {};
          const curYear = (typeof globalYear !== 'undefined' ? globalYear : 2026);
          const minKwCon = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= curYear) ? con.minKw : 1;
          const maxKwCon = con.maxKw > 0 ? con.maxKw : Math.round(peak * 1.2);
          const _minKwFein = currentConfig.length > 1 ? Math.round(peak * 0.1) : 1;
          const lo = Math.max(_minKwFein, minKwCon, erz.leistKw - feinRange);
          const hi = Math.min(maxKwCon, erz.leistKw + feinRange);

          let bestKwVal = erz.leistKw, bestScoreVal = Infinity;
          for (let kw = lo; kw <= hi; kw += FEIN_STEP) {
            const testConfig = currentConfig.map(c => ({...c}));
            testConfig[ei] = { ...erz, leistKw: kw };
            const disp = _optDispatch8760(lgFein, tempH, vlH, testConfig.map(c => ({...c})), currentTsVol, stExFein);
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            const pvBat = _optPvBatSim8760(grob.pvKwp, grob.batKwh, demandH, disp.bhkwElH, disp);
            const kwRes = _optKennwerte2(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhFein, currentStM2, currentTsVol);
            const score = _optScore(kwRes, ziel);
            if (score < bestScoreVal) { bestScoreVal = score; bestKwVal = kw; }
          }
          if (bestKwVal !== erz.leistKw) { changed = true; }
          currentConfig[ei] = { ...erz, leistKw: bestKwVal };
        }

        // ST-Fläche feinoptimieren (±20% vom Grobwert, 10 Stufen)
        if (stAktiv && currentStM2 > 0) {
          const stLoFein = Math.max(stMinConstr, Math.round(currentStM2 * 0.8));
          const stHiFein = stMaxConstr > 0 ? Math.min(stMaxConstr, Math.round(currentStM2 * 1.2)) : Math.round(currentStM2 * 1.2);
          const stFeinStep = Math.max(1, Math.round((stHiFein - stLoFein) / 10));
          let bestStVal = currentStM2, bestStScore = Infinity;
          for (let sm2 = stLoFein; sm2 <= stHiFein; sm2 += stFeinStep) {
            const { lastgang: lgSt, waermeMwh: stMwhSt, stExcessH: stExSt } = _stReducedLastgang(sm2);
            const disp = _optDispatch8760(lgSt, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExSt);
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            const pvBat = _optPvBatSim8760(grob.pvKwp, grob.batKwh, demandH, disp.bhkwElH, disp);
            const kwRes = _optKennwerte2(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhSt, sm2, currentTsVol);
            const score = _optScore(kwRes, ziel);
            if (score < bestStScore) { bestStScore = score; bestStVal = sm2; }
          }
          if (bestStVal !== currentStM2) { changed = true; currentStM2 = bestStVal; }
        }

        // Wärmespeicher-Volumen feinoptimieren (±30% vom Grobwert, 8 Stufen)
        if (tsAktiv && currentTsVol > 0) {
          const tsLoFein = Math.max(tsMinConstr, Math.round(currentTsVol * 0.7));
          const tsHiFein = tsMaxConstr > 0 ? Math.min(tsMaxConstr, Math.round(currentTsVol * 1.3)) : Math.round(currentTsVol * 1.3);
          const tsFeinStep = Math.max(1, Math.round((tsHiFein - tsLoFein) / 8));
          let bestTsVal = currentTsVol, bestTsScore = Infinity;
          const { lastgang: lgTs, waermeMwh: stMwhTs, stExcessH: stExTs } = _stReducedLastgang(currentStM2);
          for (let tv = tsLoFein; tv <= tsHiFein; tv += tsFeinStep) {
            const disp = _optDispatch8760(lgTs, tempH, vlH, currentConfig.map(c => ({...c})), tv, stExTs);
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            const pvBat = _optPvBatSim8760(grob.pvKwp, grob.batKwh, demandH, disp.bhkwElH, disp);
            const kwRes = _optKennwerte2(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhTs, currentStM2, tv);
            const score = _optScore(kwRes, ziel);
            if (score < bestTsScore) { bestTsScore = score; bestTsVal = tv; }
          }
          if (bestTsVal !== currentTsVol) { changed = true; currentTsVol = bestTsVal; }
        }

        if (!changed) break;
      }

      // PV/Bat Volloptimierung (breites Grid)
      const { lastgang: lgFinal, waermeMwh: stMwhFinal, stExcessH: stExFinal } = _stReducedLastgang(currentStM2);
      const finalDisp = _optDispatch8760(lgFinal, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExFinal);
      const demandHFinal = new Float32Array(8760);
      for (let t = 0; t < 8760; t++) demandHFinal[t] = finalDisp.wpElH[t] + finalDisp.skElH[t] + quartierH[t];

      // PV/Bat Feinoptimierung per marginaler Amortisation
      const pvStepsFein = pvAktiv ? Array.from({length: 15}, (_, i) => Math.round(pvMaxSinnvoll * i / 14)) : [0];
      if (pvMinConstr > 0 && pvAktiv) {
        const filtered = pvStepsFein.filter(v => v >= pvMinConstr || v === 0);
        if (filtered.length > 0) { pvStepsFein.length = 0; filtered.forEach(v => pvStepsFein.push(v)); }
      }
      const batStepsFein = batAktiv ? Array.from({length: 8}, (_, i) => Math.round(batMax * i / 7)) : [0];
      const pvMaxAmortFein = parseFloat(document.getElementById('opt-pv-max-amort')?.value) || 10;
      const pvBatFein = _findOptPvBatMain(pvStepsFein, batStepsFein, demandHFinal, finalDisp.bhkwElH, finalDisp,
        params, stMwhFinal, currentStM2, currentTsVol, ziel, pvMaxAmortFein);
      const bestPv = pvBatFein.pvKwp, bestBat = pvBatFein.batKwh, bestScoreFinal = pvBatFein.score;

      // Finales Ergebnis
      const finalPvBat = _optPvBatSim8760(bestPv, bestBat, demandHFinal, finalDisp.bhkwElH, finalDisp);
      const finalKw = _optKennwerte2(finalDisp, bestPv, bestBat, finalPvBat, params, stMwhFinal, currentStM2, currentTsVol);

      topFein.push({
        keys: grob.keys,
        config: currentConfig,
        pvKwp: bestPv,
        batKwh: bestBat,
        stM2: currentStM2,
        stMwh: stMwhFinal,
        tsVol: currentTsVol,
        kw: finalKw,
        sim: finalDisp,
        score: bestScoreFinal,
      });

      const elapsedFein = ((Date.now() - _optStartTime) / 1000).toFixed(0);
      resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">Feinsuche: ' + feinIdx + '/' + topNGrob.length + ' Konstellationen \u00b7 ' + elapsedFein + 's</div>';
      setTimeout(processFein, 0);
    }

    processFein();
  }

  function renderResults(top3) {
    if (top3.length === 0) {
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
      return;
    }

    top3.sort((a, b) => a.score - b.score);

    resDiv.innerHTML = '';
    // Jahr-Info im Ergebnis anzeigen
    const _optResYear2 = parseInt(document.getElementById('opt-year')?.value) || globalYear;
    const _optResYearDiv2 = document.createElement('div');
    _optResYearDiv2.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;';
    _optResYearDiv2.innerHTML = '<span style="color:var(--accent);font-weight:600;">Betrachtungsjahr: ' + _optResYear2 + '</span>'
      + (window._basisYear && _optResYear2 !== window._basisYear ? ' <span style="color:#78909c;font-size:9px;">(Lastgang skaliert)</span>' : '');
    resDiv.appendChild(_optResYearDiv2);
    top3.forEach((r, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border-radius:8px;padding:12px 14px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.3);';

      const titel = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join(' + ')
        + (r.stM2 > 0 ? ' + ST ' + r.stM2 + ' m\u00b2' : '')
        + (r.tsVol > 0 ? ' + WS ' + r.tsVol + ' m\u00b3' : '')
        + (r.pvKwp > 0 ? ' + PV ' + r.pvKwp.toFixed(0) + ' kWp' : '')
        + (r.batKwh > 0 ? ' + Bat ' + r.batKwh.toFixed(0) + ' kWh' : '');

      const eeColor = r.kw.eeAnteil >= 65 ? '#81c784' : '#ef9a9a';
      const eeBadge = '<span style="background:' + eeColor + ';color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;">' + r.kw.eeAnteil.toFixed(0) + '% EE</span>';

      const totalInkST = (r.sim.gesamtMwh || 0) + (r.stMwh || 0);

      // ── Hauptzeile: WGK prominent + Sekundär-KPIs ──
      let kpiHtml = '<div style="display:flex;align-items:stretch;gap:6px;margin:6px 0;">';
      kpiHtml += '<div style="background:rgba(253,216,53,0.08);border:1px solid rgba(253,216,53,0.25);border-radius:6px;padding:6px 12px;text-align:center;min-width:80px;">'
        + '<div style="font-size:18px;font-weight:700;color:#fdd835;line-height:1.1;">' + r.kw.wgk.toFixed(1) + '</div>'
        + '<div style="font-size:8px;color:var(--muted);margin-top:1px;">ct/kWh</div></div>';
      kpiHtml += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px;flex:1;">';
      const kpis2 = [
        { val: (r.kw.investGesamt / 1000).toFixed(0) + ' k\u20ac', lbl: 'Invest', color: '#b0bec5' },
        { val: r.kw.co2ta.toFixed(1) + ' t/a', lbl: 'CO\u2082', color: '#90a4ae' },
        { val: r.kw.jahreskosten ? (r.kw.jahreskosten / 1000).toFixed(1) + ' k\u20ac/a' : '\u2014', lbl: 'Jahreskosten', color: '#ce93d8' },
        { val: (r.kw.stromAutarkie || 0).toFixed(0) + '%', lbl: '\u26A1 Strom-Aut.', color: '#fdd835' },
        { val: (r.kw.waermeAutarkie || 0).toFixed(0) + '%', lbl: '\uD83C\uDF21 W\u00e4rme-Aut.', color: '#e53935' },
        { val: totalInkST.toFixed(0) + ' MWh', lbl: 'W\u00e4rme ges.', color: '#ff7043' },
      ];
      for (const k of kpis2) {
        kpiHtml += '<div style="background:rgba(255,255,255,0.03);border-radius:3px;padding:2px 4px;text-align:center;">'
          + '<div style="font-size:10px;font-weight:600;color:' + k.color + ';">' + k.val + '</div>'
          + '<div style="font-size:7px;color:var(--muted);white-space:nowrap;">' + k.lbl + '</div></div>';
      }
      kpiHtml += '</div></div>';

      // ── Erzeuger-Tabelle ──
      let erzHtml = '<div style="display:grid;grid-template-columns:auto repeat(3,1fr);gap:0 8px;font-size:9px;margin:4px 0;padding:4px 0;border-top:1px solid var(--border);">';
      erzHtml += '<div style="color:var(--muted);font-size:8px;">Erzeuger</div>'
        + '<div style="color:var(--muted);font-size:8px;text-align:right;">Leistung</div>'
        + '<div style="color:var(--muted);font-size:8px;text-align:right;">Energie</div>'
        + '<div style="color:var(--muted);font-size:8px;text-align:right;">Anteil</div>';
      if (r.stM2 > 0 && r.stMwh > 0) {
        const dckPct = totalInkST > 0 ? (r.stMwh / totalInkST * 100) : 0;
        erzHtml += '<div><span style="color:#ef6c00;">\u25CF</span> ST ' + r.stM2 + ' m\u00b2</div>'
          + '<div style="text-align:right;">\u2014</div>'
          + '<div style="text-align:right;">' + r.stMwh.toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
      }
      for (let ci = 0; ci < r.config.length; ci++) {
        const erz = r.config[ci];
        const simErz = r.sim.erzeugerList ? r.sim.erzeugerList[ci] : null;
        const waermeMwh = simErz ? (simErz.waermeMwh || 0) : 0;
        const col = ERZEUGER_CFG[erz.key]?.color || '#aaa';
        const dckPct = totalInkST > 0 ? (waermeMwh / totalInkST * 100) : 0;
        const displayKw = simErz ? simErz.leistKw : erz.leistKw;
        erzHtml += '<div><span style="color:' + col + ';">\u25CF</span> ' + (ERZEUGER_CFG[erz.key]?.label || erz.key) + '</div>'
          + '<div style="text-align:right;">' + displayKw.toFixed(0) + ' kW</div>'
          + '<div style="text-align:right;">' + waermeMwh.toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
      }
      if (r.sim.autoGkMwh > 0) {
        const dckPct = totalInkST > 0 ? (r.sim.autoGkMwh / totalInkST * 100) : 0;
        erzHtml += '<div><span style="color:#78909c;">\u25CF</span> Backup-GK</div>'
          + '<div style="text-align:right;">\u2014</div>'
          + '<div style="text-align:right;">' + r.sim.autoGkMwh.toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
      }
      if (r.pvKwp > 0) {
        erzHtml += '<div><span style="color:#fdd835;">\u25CF</span> PV' + (r.batKwh > 0 ? ' + Bat' : '') + '</div>'
          + '<div style="text-align:right;">' + r.pvKwp.toFixed(0) + ' kWp' + (r.batKwh > 0 ? ' / ' + r.batKwh.toFixed(0) + ' kWh' : '') + '</div>'
          + '<div style="text-align:right;color:var(--muted);">' + (r.kw.pvErtragMwh || 0).toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;color:var(--muted);">\u2014</div>';
      }
      erzHtml += '</div>';

      card.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);">' +
          '<span style="font-size:12px;font-weight:700;color:var(--text);">' + (idx + 1) + '. ' + escHtml(titel) + '</span>' +
          eeBadge +
        '</div>' +
        kpiHtml +
        erzHtml +
        '<div style="text-align:center;margin-top:6px;"><button class="btn-secondary" style="font-size:9px;padding:3px 12px;" onclick="_optVarianteUebernehmen(window._optLastResults[' + idx + '], this)">Als Variante \u00fcbernehmen</button></div>';
      resDiv.appendChild(card);
    });

    window._optLastResults = top3;

    // Debug: WGK-Aufschlüsselung der Top-Varianten loggen
    top3.forEach((r, i) => {
      const d = r.kw._dbg;
      if (d) console.log('[OPT-WGK] #' + (i+1), r.keys.join('+'),
        '| WGK:', r.kw.wgk.toFixed(1), 'ct/kWh',
        '| Kapital:', Math.round(d.kapitalJk), '€/a',
        '| Energie:', Math.round(d.energieJk), '€/a',
        '| JK ges:', Math.round(r.kw.jahreskosten), '€/a',
        '| Wärme:', d.totalWaerme.toFixed(1), 'MWh',
        '| Invest:', Math.round(d.basisInvest), '€',
        '| nGeb:', d.nGeb, '| NetzInv:', d.netzInvest,
        '| AutoGK:', d.autoGkMwh.toFixed(1), 'MWh/' + (d.autoGkPeakKw||0).toFixed(0) + 'kW',
        '| Erz:', d.erzList);
    });

    // Visualisierungen rendern
    _optRenderBarChart(top3, resDiv);
    _optRenderRadar(top3, resDiv);
    _optRenderScatter(resDiv);
    // Gesamtdauer anzeigen
    const totalElapsed = ((Date.now() - _optStartTime) / 1000);
    const timeLabel = totalElapsed < 60 ? totalElapsed.toFixed(1) + 's' : (totalElapsed / 60).toFixed(1) + ' min';
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'font-size:9px;color:var(--muted);text-align:center;margin-top:8px;';
    infoDiv.textContent = 'Berechnung abgeschlossen in ' + timeLabel + ' (' + (window._optGrobResults?.length || 0) + ' Konfigurationen getestet)';
    resDiv.appendChild(infoDiv);
    // PV-Cache aufräumen
    window._optCachedPvProfile = null;
    _optFinished();
  }

  // Start der asynchronen Grobsuche
  processBatch();
}

// ── Gestapeltes Balkendiagramm: Energie- und Leistungsanteile Top-Varianten ──
function _optRenderBarChart(results, container) {
  if (!results || results.length === 0) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:12px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:9px;color:var(--muted);margin-bottom:4px;font-family:"DM Sans",sans-serif;';
  lbl.textContent = 'Energie- und Leistungsanteile der Top-Varianten';
  wrap.appendChild(lbl);

  const canvas = document.createElement('canvas');
  canvas.id = 'opt-bar-canvas';
  canvas.style.cssText = 'width:100%;border-radius:6px;background:var(--surface2);';
  wrap.appendChild(canvas);
  container.insertBefore(wrap, container.firstChild);

  const W = canvas.offsetWidth || 460;
  const energyH = 22;  // Energiebalken (dicker = wichtiger)
  const powerH = 12;   // Leistungsbalken (dünner)
  const gapH = 2;      // Abstand zwischen Energie- und Leistungsbalken
  const groupGap = 28;  // Abstand zwischen Varianten (mehr Luft)
  const blockH = energyH + gapH + powerH + groupGap;
  const H = results.length * blockH + 20;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Volle Erzeugernamen
  const _fullName = k => ERZEUGER_CFG[k]?.label || k;

  // ── Labels vorbereiten (Variantenname) ──
  ctx.font = '10px "DM Sans", sans-serif';
  let maxLabelW = 0;
  const varLabels = results.map((r, idx) => {
    const txt = (idx + 1) + '. ' + r.keys.map(k => _fullName(k)).join(' + ');
    const w = ctx.measureText(txt).width;
    if (w > maxLabelW) maxLabelW = w;
    return txt;
  });
  const PAD = { l: Math.max(90, Math.ceil(maxLabelW) + 12), r: 80, t: 8 };
  const barW = W - PAD.l - PAD.r;

  // Hilfsfunktion: gestapelten Balken zeichnen
  function drawStackedBar(segments, x0, y0, totalBarW, barHeight, showLabels) {
    let xOff = x0;
    for (const seg of segments) {
      const segW = seg.frac * totalBarW;
      ctx.fillStyle = seg.color;
      ctx.fillRect(xOff, y0, Math.max(0.5, segW), barHeight);
      seg._x = xOff;
      seg._w = segW;
      xOff += segW;
    }
    if (showLabels) {
      ctx.font = '8px "DM Sans", sans-serif';
      ctx.textBaseline = 'middle';
      for (const seg of segments) {
        const pctTxt = seg.pct.toFixed(0) + '%';
        const nameTxt = seg.name;
        if (seg._w > 70) {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.textAlign = 'center';
          ctx.fillText(nameTxt + ' ' + pctTxt, seg._x + seg._w / 2, y0 + barHeight / 2);
        } else if (seg._w > 28) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(pctTxt, seg._x + seg._w / 2, y0 + barHeight / 2);
        }
      }
    } else {
      // Dünner Balken: nur Prozent wenn genug Platz
      ctx.font = '7px "DM Sans", sans-serif';
      ctx.textBaseline = 'middle';
      for (const seg of segments) {
        const pctTxt = seg.pct.toFixed(0) + '%';
        if (seg._w > 22) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.textAlign = 'center';
          ctx.fillText(pctTxt, seg._x + seg._w / 2, y0 + barHeight / 2);
        }
      }
    }
  }

  results.forEach((r, idx) => {
    const y = PAD.t + idx * blockH;
    const simList = r.sim?.erzeugerList || [];

    // ── Energieanteile (MWh) ──
    const totalMwh = (r.sim?.gesamtMwh || r.gesamtMwh || 0) + (r.stMwh || 0) || 1;
    const eSegments = [];
    if (r.stMwh > 0.1) {
      eSegments.push({ frac: r.stMwh / totalMwh, pct: r.stMwh / totalMwh * 100, name: 'Solarthermie', color: '#ef6c00' });
    }
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const simErz = simList[ci];
      const mwh = simErz?.waermeMwh || (r.erzWaermeMwh ? r.erzWaermeMwh[ci] : 0) || 0;
      eSegments.push({ frac: mwh / totalMwh, pct: mwh / totalMwh * 100, name: _fullName(erz.key), color: ERZEUGER_CFG[erz.key]?.color || '#aaa' });
    }
    if (r.sim?.autoGkMwh > 0) {
      eSegments.push({ frac: r.sim.autoGkMwh / totalMwh, pct: r.sim.autoGkMwh / totalMwh * 100, name: 'Backup-GK', color: '#78909c' });
    }
    // ── Leistungsanteile (kW) ──
    let totalKw = 0;
    const pParts = [];
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const kw = (r.erzLeistKw ? r.erzLeistKw[ci] : erz.leistKw) || 0;
      totalKw += kw;
      pParts.push({ kw, name: _fullName(erz.key), color: ERZEUGER_CFG[erz.key]?.color || '#aaa' });
    }
    if (totalKw < 0.1) totalKw = 1;
    const pSegments = pParts.map(p => ({ frac: p.kw / totalKw, pct: p.kw / totalKw * 100, name: p.name, color: p.color }));
    // Label links (Variantenname)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '10px "DM Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(varLabels[idx], PAD.l - 6, y);

    // Zeilen-Labels links
    ctx.fillStyle = '#78909c';
    ctx.font = '8px "DM Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('Energie', PAD.l - 6, y + energyH / 2 + 12);
    ctx.fillText('Leistung', PAD.l - 6, y + energyH + gapH + powerH / 2 + 12);

    // Balken zeichnen
    drawStackedBar(eSegments, PAD.l, y + 12, barW, energyH, true);
    drawStackedBar(pSegments, PAD.l, y + 12 + energyH + gapH, barW, powerH, false);

    // WGK + Invest rechts (vertikal zentriert)
    const midY = y + 12 + (energyH + gapH + powerH) / 2;
    ctx.fillStyle = '#fdd835';
    ctx.font = 'bold 11px "DM Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.kw.wgk.toFixed(1) + ' ct', PAD.l + barW + 6, midY - 6);
    ctx.fillStyle = '#90a4ae';
    ctx.font = '9px "DM Mono", monospace';
    ctx.fillText((r.kw.investGesamt / 1000).toFixed(0) + ' k\u20ac', PAD.l + barW + 6, midY + 7);

    // Trennlinie zwischen Varianten
    if (idx < results.length - 1) {
      const lineY = y + energyH + gapH + powerH + 18;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, lineY);
      ctx.lineTo(W - 8, lineY);
      ctx.stroke();
    }
  });
}

// ── Radar-/Spinnendiagramm: Kennzahlen-Vergleich Top-3 ───────────────────
function _optRenderRadar(results, container) {
  if (!results || results.length === 0) return;
  const top3 = results.slice(0, 3);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:12px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:9px;color:var(--muted);margin-bottom:4px;font-family:"DM Sans",sans-serif;';
  lbl.textContent = 'Kennzahlen-Vergleich (Top 3)';
  wrap.appendChild(lbl);

  const canvas = document.createElement('canvas');
  canvas.id = 'opt-radar-canvas';
  canvas.style.cssText = 'width:100%;border-radius:6px;background:var(--surface2);';
  wrap.appendChild(canvas);

  // Legende
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;';
  const varColors = ['#66bb6a','#29b6f6','#ff7043'];
  top3.forEach((r, i) => {
    const name = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join('+');
    const sp = document.createElement('span');
    sp.style.cssText = 'font-size:9px;color:var(--muted);font-family:"DM Sans",sans-serif;display:flex;align-items:center;gap:3px;';
    sp.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + varColors[i] + ';opacity:0.7;"></span>' + (i + 1) + '. ' + name;
    legendDiv.appendChild(sp);
  });
  wrap.appendChild(legendDiv);
  container.appendChild(wrap);

  const W = canvas.offsetWidth || 460;
  const H = 260;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W / 2 - 50, H / 2 - 30);

  // 5 Achsen: WGK (inv), CO2 (inv), EE-Anteil, Autarkie, Invest (inv)
  const axes = [
    { label: 'WGK',       key: 'wgk',          inv: true,  unit: 'ct/kWh' },
    { label: 'CO₂',       key: 'co2ta',         inv: true,  unit: 't/a' },
    { label: 'EE-Anteil',  key: 'eeAnteil',     inv: false, unit: '%' },
    { label: '\u26A1Autarkie', key: 'stromAutarkie', inv: false, unit: '%' },
    { label: '\uD83D\uDD25Autarkie', key: 'waermeAutarkie', inv: false, unit: '%' },
    { label: 'Invest',     key: 'investGesamt', inv: true,  unit: 'k€' },
  ];
  const N = axes.length;
  const angleStep = (2 * Math.PI) / N;
  const startAngle = -Math.PI / 2; // 12-Uhr-Position

  // Min/Max über alle Top-3 bestimmen
  const ranges = axes.map(ax => {
    const vals = top3.map(r => ax.key === 'investGesamt' ? r.kw[ax.key] / 1000 : r.kw[ax.key]);
    let mn = Math.min(...vals);
    let mx = Math.max(...vals);
    if (mx - mn < 0.01) { mn -= 1; mx += 1; }
    return { min: mn, max: mx };
  });

  // Normalisierung: 0–1, wobei "besser" = 1 (= außen)
  function normalize(axIdx, val) {
    const ax = axes[axIdx];
    const rng = ranges[axIdx];
    if (ax.key === 'investGesamt') val = val / 1000;
    let t = (val - rng.min) / (rng.max - rng.min);
    t = Math.max(0, Math.min(1, t));
    if (ax.inv) t = 1 - t;
    // Mindestens 15% Radius damit Polygon sichtbar bleibt
    return 0.15 + t * 0.85;
  }

  function axisXY(axIdx, frac) {
    const angle = startAngle + axIdx * angleStep;
    return { x: cx + Math.cos(angle) * R * frac, y: cy + Math.sin(angle) * R * frac };
  }

  // Hintergrund-Ringe
  ctx.strokeStyle = '#2a3050';
  ctx.lineWidth = 0.5;
  for (let ring = 1; ring <= 4; ring++) {
    const frac = ring / 4;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = axisXY(i % N, frac);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Achsenlinien + Labels
  ctx.strokeStyle = '#3a4060';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < N; i++) {
    const p = axisXY(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // Label
    const lp = axisXY(i, 1.18);
    ctx.fillStyle = '#90a4ae';
    ctx.font = '9px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(axes[i].label, lp.x, lp.y);
  }

  // Polygone zeichnen
  top3.forEach((r, vIdx) => {
    const col = varColors[vIdx];
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const val = axes[i].key === 'investGesamt' ? r.kw[axes[i].key] : r.kw[axes[i].key];
      const norm = normalize(i, val);
      const p = axisXY(i, norm);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = col + '33'; // ~20% alpha
    ctx.fill();
    ctx.strokeStyle = col + 'cc'; // ~80% alpha
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Punkte auf Achsen
    for (let i = 0; i < N; i++) {
      const val = axes[i].key === 'investGesamt' ? r.kw[axes[i].key] : r.kw[axes[i].key];
      const norm = normalize(i, val);
      const p = axisXY(i, norm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.fill();
    }
  });
}

// ── Scatter-Plot: Alle Grob-Ergebnisse (WGK vs CO2) ─────────────────────
function _optRenderScatter(container) {
  const allRes = window._optGrobResults;
  if (!allRes || allRes.length < 2) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:12px;position:relative;';

  // Header mit Titel + 2D/3D-Toggle
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:9px;color:var(--muted);font-family:"DM Sans",sans-serif;';
  lbl.textContent = 'Alle getesteten Konfigurationen (' + allRes.length + ') \u2014 WGK vs. CO\u2082';
  header.appendChild(lbl);

  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = 'font-size:9px;padding:2px 10px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:.15s;';
  toggleBtn.textContent = '\u25C8 3D';
  toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.borderColor = 'var(--accent)'; toggleBtn.style.color = 'var(--accent)'; });
  toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.borderColor = 'var(--border)'; toggleBtn.style.color = 'var(--muted)'; });
  header.appendChild(toggleBtn);

  const hullBtn = document.createElement('button');
  hullBtn.style.cssText = 'font-size:9px;padding:2px 10px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:.15s;margin-left:4px;display:none;';
  hullBtn.textContent = '\u25A7 Fl\u00e4chen';
  hullBtn.addEventListener('mouseenter', () => { hullBtn.style.borderColor = 'var(--accent)'; hullBtn.style.color = 'var(--accent)'; });
  hullBtn.addEventListener('mouseleave', () => { hullBtn.style.borderColor = 'var(--border)'; hullBtn.style.color = 'var(--muted)'; });
  header.appendChild(hullBtn);
  wrap.appendChild(header);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;border-radius:6px;background:var(--surface2);cursor:crosshair;';
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  // Erzeuger-Farben aus Config
  const _fullName = k => ERZEUGER_CFG[k]?.label || k;
  const allGenKeys = [...new Set(allRes.flatMap(r => r.keys))];
  const genColors = {};
  allGenKeys.forEach(k => { genColors[k] = ERZEUGER_CFG[k]?.color || '#aaa'; });

  // State
  let activeFilter = null;
  let is3D = false;
  let rotX = -0.45, rotZ = 0.65, zoom3D = 1.0;
  let dragging = false, dragSX = 0, dragSY = 0, dragSRX = 0, dragSRZ = 0;
  let showHulls = true; // Kombinations-Flächen anzeigen

  // Convex-Hull (Andrew's monotone chain)
  function convexHull(points) {
    if (points.length < 3) return points.slice();
    const pts = points.slice().sort((a, b) => a.px - b.px || a.py - b.py);
    const cross = (O, A, B) => (A.px - O.px) * (B.py - O.py) - (A.py - O.py) * (B.px - O.px);
    const lower = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Kombinations-Gruppen für Hüllen
  const kombiGroups = {};
  for (const r of allRes) {
    if (!kombiGroups[r.kombiKey]) kombiGroups[r.kombiKey] = [];
    kombiGroups[r.kombiKey].push(r);
  }

  // Daten-Bereiche
  let minWgk = Infinity, maxWgk = -Infinity, minCo2 = Infinity, maxCo2 = -Infinity, minInv = Infinity, maxInv = -Infinity;
  for (const r of allRes) {
    if (r.kw.wgk < minWgk) minWgk = r.kw.wgk;
    if (r.kw.wgk > maxWgk) maxWgk = r.kw.wgk;
    if (r.kw.co2ta < minCo2) minCo2 = r.kw.co2ta;
    if (r.kw.co2ta > maxCo2) maxCo2 = r.kw.co2ta;
    const inv = (r.kw.investGesamt || 0) / 1000;
    if (inv < minInv) minInv = inv;
    if (inv > maxInv) maxInv = inv;
  }
  const wgkR = Math.max(0.1, maxWgk - minWgk), co2R = Math.max(0.1, maxCo2 - minCo2), invR = Math.max(0.1, maxInv - minInv);
  minWgk -= wgkR * 0.05; maxWgk += wgkR * 0.05;
  minCo2 -= co2R * 0.05; maxCo2 += co2R * 0.05;
  minInv -= invR * 0.05; maxInv += invR * 0.05;

  // Top 3
  const top3 = allRes.slice().sort((a, b) => a.score - b.score).slice(0, 3);
  const top3Set = new Set(top3.map(r => r.kombiKey + '|' + r.score));

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:absolute;display:none;background:#1a1d26;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;font-size:9px;color:#cfd8dc;pointer-events:none;z-index:999;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.5);line-height:1.5;';
  wrap.appendChild(tooltip);

  // Kompakte Legende: einzelne Erzeugertypen, klickbar als Filter
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px 6px;font-size:9px;margin-top:6px;';
  allGenKeys.forEach(k => {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;cursor:pointer;transition:.15s;background:rgba(255,255,255,0.05);border:1px solid transparent;user-select:none;';
    chip.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + genColors[k] + ';flex-shrink:0;"></span>' + _fullName(k);
    chip.dataset.key = k;
    chip.addEventListener('click', () => {
      if (activeFilter === k) {
        activeFilter = null;
        legendDiv.querySelectorAll('span[data-key]').forEach(s => { s.style.opacity = '1'; s.style.borderColor = 'transparent'; });
      } else {
        activeFilter = k;
        legendDiv.querySelectorAll('span[data-key]').forEach(s => {
          const match = s.dataset.key === k;
          s.style.opacity = match ? '1' : '0.35';
          s.style.borderColor = match ? genColors[k] : 'transparent';
        });
      }
      render();
    });
    legendDiv.appendChild(chip);
  });
  wrap.appendChild(legendDiv);

  // Hinweis
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:8px;color:rgba(255,255,255,0.25);margin-top:3px;';
  hint.textContent = 'Klick auf Erzeuger = Filter \u2022 Hover = Details';
  wrap.appendChild(hint);

  // ── Render-Engine ──
  function render() {
    const W = canvas.offsetWidth || 460;
    const H = is3D ? 320 : 260;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (is3D) render3D(ctx, W, H); else render2D(ctx, W, H);
  }

  function pointColor(r) { return genColors[r.keys[0]] || '#aaa'; }

  function render2D(ctx, W, H) {
    const PAD = { l: 52, r: 16, t: 16, b: 34 };
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    const xOf = wgk => PAD.l + (wgk - minWgk) / (maxWgk - minWgk) * pw;
    const yOf = co2 => PAD.t + ph - (co2 - minCo2) / (maxCo2 - minCo2) * ph;

    // Gitter
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = PAD.t + ph - ph * i / 4;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const x = PAD.l + pw * i / 5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
    }

    // Achsen
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + ph); ctx.lineTo(PAD.l + pw, PAD.t + ph); ctx.stroke();

    // Achsen-Beschriftung
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px "DM Sans",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('WGK (ct/kWh)', PAD.l + pw / 2, H - 4);
    ctx.save(); ctx.translate(13, PAD.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('CO\u2082 (t/a)', 0, 0); ctx.restore();

    // Ticks
    ctx.font = '8px "DM Mono",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 5; i++) {
      const v = minWgk + (maxWgk - minWgk) * i / 5;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(v.toFixed(1), xOf(v), PAD.t + ph + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = minCo2 + (maxCo2 - minCo2) * i / 4;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(v.toFixed(1), PAD.l - 5, yOf(v));
    }

    // Punkte
    for (const r of allRes) {
      const x = xOf(r.kw.wgk), y = yOf(r.kw.co2ta);
      const isTop = top3Set.has(r.kombiKey + '|' + r.score);
      const match = !activeFilter || r.keys.includes(activeFilter);
      ctx.beginPath(); ctx.arc(x, y, isTop ? 5.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = pointColor(r);
      ctx.globalAlpha = match ? (isTop ? 0.95 : 0.5) : 0.06;
      ctx.fill();
      if (isTop) {
        ctx.globalAlpha = match ? 1 : 0.15;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Top-3 Labels
    const top3sorted = top3.slice().sort((a, b) => a.kw.wgk - b.kw.wgk);
    ctx.font = '8px "DM Sans",sans-serif'; ctx.textBaseline = 'bottom';
    top3sorted.forEach((r, i) => {
      const x = xOf(r.kw.wgk), y = yOf(r.kw.co2ta);
      const txt = '#' + (i + 1) + ' ' + r.keys.map(k => _fullName(k)).join('+');
      const truncTxt = txt.length > 28 ? txt.slice(0, 26) + '\u2026' : txt;
      ctx.textAlign = x > PAD.l + pw * 0.7 ? 'right' : 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(truncTxt, x + (ctx.textAlign === 'left' ? 8 : -8), y - 4);
    });

    canvas._proj = allRes.map(r => ({ x: xOf(r.kw.wgk), y: yOf(r.kw.co2ta), r }));
  }

  function render3D(ctx, W, H) {
    const cx = W / 2, cy = H / 2 + 10;
    const sc = Math.min(W, H) * 0.30 * zoom3D;
    const norm = (v, mn, mx) => (v - mn) / (mx - mn) * 2 - 1;
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX), cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

    function proj(wgk, co2, inv) {
      let x = norm(wgk, minWgk, maxWgk), y = norm(inv, minInv, maxInv), z = norm(co2, minCo2, maxCo2);
      const x1 = x * cosZ - y * sinZ, y1 = x * sinZ + y * cosZ;
      const z1 = z * cosX - y1 * sinX, y2 = z * sinX + y1 * cosX;
      return { px: cx + x1 * sc, py: cy - y2 * sc, depth: z1 };
    }

    // Boden-Gitter (WGK x Invest bei minCo2)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const wgk = minWgk + (maxWgk - minWgk) * i / 5;
      const a = proj(wgk, minCo2, minInv), b = proj(wgk, minCo2, maxInv);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      const inv = minInv + (maxInv - minInv) * i / 5;
      const c = proj(minWgk, minCo2, inv), d = proj(maxWgk, minCo2, inv);
      ctx.beginPath(); ctx.moveTo(c.px, c.py); ctx.lineTo(d.px, d.py); ctx.stroke();
    }

    // Achsen
    const axes = [
      { f: [minWgk, minCo2, minInv], t: [maxWgk, minCo2, minInv], lbl: 'WGK (ct/kWh)', c: 'rgba(255,183,77,0.6)' },
      { f: [minWgk, minCo2, minInv], t: [minWgk, minCo2, maxInv], lbl: 'Invest (k\u20ac)', c: 'rgba(79,195,247,0.6)' },
      { f: [minWgk, minCo2, minInv], t: [minWgk, maxCo2, minInv], lbl: 'CO\u2082 (t/a)', c: 'rgba(129,199,132,0.6)' },
    ];
    for (const ax of axes) {
      const p0 = proj(ax.f[0], ax.f[1], ax.f[2]), p1 = proj(ax.t[0], ax.t[1], ax.t[2]);
      ctx.strokeStyle = ax.c; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p0.px, p0.py); ctx.lineTo(p1.px, p1.py); ctx.stroke();
      // Pfeilspitze
      const dx = p1.px - p0.px, dy = p1.py - p0.py, len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const ux = dx / len, uy = dy / len;
        ctx.fillStyle = ax.c;
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p1.px - ux * 6 + uy * 3, p1.py - uy * 6 - ux * 3);
        ctx.lineTo(p1.px - ux * 6 - uy * 3, p1.py - uy * 6 + ux * 3);
        ctx.fill();
      }
      // Label
      ctx.fillStyle = ax.c; ctx.font = '9px "DM Sans",sans-serif'; ctx.textAlign = 'center';
      const lx = len > 0 ? p1.px + (dx / len) * 16 : p1.px;
      const ly = len > 0 ? p1.py + (dy / len) * 16 : p1.py;
      ctx.fillText(ax.lbl, lx, ly);
    }

    // Achsen-Ticks (Enden)
    ctx.font = '7px "DM Mono",monospace'; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    const tw0 = proj(minWgk, minCo2, minInv), tw1 = proj(maxWgk, minCo2, minInv);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(minWgk.toFixed(1), tw0.px, tw0.py + 4);
    ctx.fillText(maxWgk.toFixed(1), tw1.px, tw1.py + 4);
    const tc1 = proj(minWgk, maxCo2, minInv);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(maxCo2.toFixed(0), tc1.px - 4, tc1.py);
    const ti1 = proj(minWgk, minCo2, maxInv);
    ctx.textAlign = 'left';
    ctx.fillText(maxInv.toFixed(0) + 'k', ti1.px + 4, ti1.py);

    // Alle Punkte projizieren
    const pts = allRes.map(r => {
      const inv = (r.kw.investGesamt || 0) / 1000;
      const p = proj(r.kw.wgk, r.kw.co2ta, inv);
      return { ...p, r };
    });

    // Kombinations-Hüllen zeichnen (vor Punkten, damit Punkte drüber liegen)
    if (showHulls) {
      const hullGroups = {};
      for (const pt of pts) {
        const kk = pt.r.kombiKey;
        if (!hullGroups[kk]) hullGroups[kk] = [];
        hullGroups[kk].push(pt);
      }
      // Hüllen nach mittlerer Tiefe sortieren (hintere zuerst)
      const hullEntries = Object.entries(hullGroups)
        .filter(([, arr]) => arr.length >= 3)
        .map(([kk, arr]) => {
          const avgDepth = arr.reduce((s, p) => s + p.depth, 0) / arr.length;
          return { kk, arr, avgDepth };
        })
        .sort((a, b) => a.avgDepth - b.avgDepth);

      for (const { kk, arr } of hullEntries) {
        const match = !activeFilter || arr[0].r.keys.includes(activeFilter);
        const hull = convexHull(arr);
        if (hull.length < 3) continue;
        const color = pointColor(arr[0].r);
        ctx.beginPath();
        ctx.moveTo(hull[0].px, hull[0].py);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].px, hull[i].py);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = match ? 0.08 : 0.01;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = match ? 0.8 : 0.3;
        ctx.globalAlpha = match ? 0.25 : 0.03;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Punkte (depth-sortiert: hinten zuerst)
    pts.sort((a, b) => a.depth - b.depth);

    for (const pt of pts) {
      const r = pt.r;
      const isTop = top3Set.has(r.kombiKey + '|' + r.score);
      const match = !activeFilter || r.keys.includes(activeFilter);
      const df = 0.35 + 0.65 * ((pt.depth + 1) / 2);
      const rad = isTop ? 5 : 1.5 + df * 1.5;
      ctx.beginPath(); ctx.arc(pt.px, pt.py, rad, 0, Math.PI * 2);
      ctx.fillStyle = pointColor(r);
      ctx.globalAlpha = match ? (isTop ? 0.95 : 0.2 + df * 0.35) : 0.04;
      ctx.fill();
      if (isTop) {
        ctx.globalAlpha = match ? 1 : 0.15;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    canvas._proj = pts.map(p => ({ x: p.px, y: p.py, r: p.r }));

    // Dreh-Hinweis
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '8px "DM Sans",sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('\u21BB Ziehen zum Drehen', W - 8, H - 6);
  }

  // Toggle 2D/3D
  toggleBtn.addEventListener('click', () => {
    is3D = !is3D;
    toggleBtn.textContent = is3D ? '\u25A3 2D' : '\u25C8 3D';
    hullBtn.style.display = is3D ? 'inline-block' : 'none';
    lbl.textContent = 'Alle getesteten Konfigurationen (' + allRes.length + ') \u2014 ' + (is3D ? 'WGK vs. CO\u2082 vs. Invest' : 'WGK vs. CO\u2082');
    canvas.style.cursor = is3D ? 'grab' : 'crosshair';
    hint.textContent = is3D ? 'Ziehen = Drehen \u2022 Scrollen = Zoom \u2022 Klick auf Erzeuger = Filter' : 'Klick auf Erzeuger = Filter \u2022 Hover = Details';
    render();
  });

  // Toggle Flächen
  hullBtn.addEventListener('click', () => {
    showHulls = !showHulls;
    hullBtn.textContent = showHulls ? '\u25A7 Fl\u00e4chen' : '\u25A1 Fl\u00e4chen';
    render();
  });

  // 3D Maus-Rotation
  canvas.addEventListener('mousedown', e => {
    if (!is3D) return;
    dragging = true; dragSX = e.clientX; dragSY = e.clientY; dragSRX = rotX; dragSRZ = rotZ;
    canvas.style.cursor = 'grabbing';
  });
  const onMove3D = e => {
    if (!dragging) return;
    rotZ = dragSRZ + (e.clientX - dragSX) * 0.007;
    rotX = Math.max(-1.2, Math.min(0.3, dragSRX + (e.clientY - dragSY) * 0.007));
    render();
  };
  const onUp3D = () => { if (dragging) { dragging = false; canvas.style.cursor = is3D ? 'grab' : 'crosshair'; } };
  window.addEventListener('mousemove', onMove3D);
  window.addEventListener('mouseup', onUp3D);

  // Zoom per Mausrad (nur 3D)
  canvas.addEventListener('wheel', e => {
    if (!is3D) return;
    e.preventDefault();
    zoom3D *= e.deltaY < 0 ? 1.08 : 0.92;
    zoom3D = Math.max(0.3, Math.min(4.0, zoom3D));
    render();
  }, { passive: false });

  // Tooltip
  canvas.addEventListener('mousemove', function(e) {
    if (dragging) { tooltip.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - rect.left) * (canvas.width / dpr) / rect.width / dpr;
    const my = (e.clientY - rect.top) * (canvas.height / dpr) / rect.height / dpr;
    const proj = canvas._proj;
    if (!proj) return;
    let nearest = null, nearDist = 14;
    for (const p of proj) {
      const dx = p.x - mx, dy = p.y - my, d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearDist) { nearDist = d; nearest = p.r; }
    }
    if (nearest) {
      const names = nearest.keys.map(k => _fullName(k)).join(' + ');
      const inv = (nearest.kw.investGesamt / 1000).toFixed(0);
      tooltip.innerHTML = '<b style="color:#fff;">' + names + '</b><br>'
        + 'WGK: <b>' + nearest.kw.wgk.toFixed(2) + '</b> ct/kWh \u00b7 CO\u2082: <b>' + nearest.kw.co2ta.toFixed(1) + '</b> t/a<br>'
        + 'EE: ' + nearest.kw.eeAnteil.toFixed(0) + '% \u00b7 Invest: ' + inv + ' k\u20ac'
        + (nearest.tsVol > 0 ? ' \u00b7 WS: ' + nearest.tsVol + ' m\u00b3' : '')
        + (nearest.stM2 > 0 ? ' \u00b7 ST: ' + nearest.stM2 + ' m\u00b2' : '');
      tooltip.style.display = 'block';
      const ttX = e.clientX - rect.left + 14;
      const ttMaxX = rect.width - 220;
      tooltip.style.left = Math.min(ttX, ttMaxX) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  // Initial
  render();
}


