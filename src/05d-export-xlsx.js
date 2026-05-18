// ── 05d-export-xlsx.js — Excel-Workbook-Export (12 Sheets + Charts) ──
// Nutzt ExcelJS-Lib (über CDN in index.html) + Canvas-gerenderte Chart-PNGs.
// Einstiegspunkt: exportXlsxWorkbook() — wird vom Button "📊 Excel-Export" aufgerufen.

import { gebaeude, globalYear, netzEdges, variantResults, activeVariantId, varianten, stromEmF, gasEmF } from './01-globals-varianten.js';
import { getComputedStats, getGebStromMwh } from './02b-gebaeude.js';
import { DA_LABELS } from './07a-analysis-charts.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';

// ══════════════════════════════════════════════════════════════════════
// FARBEN — Forst-Grün-Palette (analog zum Mockup)
// ══════════════════════════════════════════════════════════════════════
const COLORS = {
  primary:  '#2d5a3d',
  sage:     '#6b9080',
  oak:      '#b8956b',
  moss:     '#a4ac86',
  stone:    '#7a8f7d',
  wood:     '#d4a574',
  rust:     '#b04545',
  light:    '#a89968',
  text:     '#1a1a1a',
  grid:     '#d4d4d4',
  muted:    '#888888',
  // ARGB für Excel (immer FF-Alpha vorne)
  headerBg:  'FF3D6B4A',
  sectionBg: 'FFE3EDE5',
  sumBg:     'FFF0EAD2',
  altRow:    'FFF7F9F7',
  borderGry: 'FFD4D4D4',
  goodFg:    'FF4A7C59',
  warnFg:    'FFB04545',
  primaryFg: 'FF2D5A3D',
};

const CHART_LAYERS = {
  bhkw:    COLORS.sage,
  wp:      COLORS.primary,
  geo:     COLORS.primary,
  lwwp:    COLORS.primary,
  fg:      COLORS.primary,
  hhs:     COLORS.oak,
  pellets: COLORS.oak,
  bk:      COLORS.oak,
  st:      COLORS.wood,
  gk:      COLORS.moss,
  oel:     COLORS.rust,
  fw:      COLORS.stone,
  ts:      COLORS.light,
};

// ══════════════════════════════════════════════════════════════════════
// CANVAS-CHART-RENDERER
// Liefern PNG-DataURL für ExcelJS.addImage()
// ══════════════════════════════════════════════════════════════════════
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = '11px Calibri, sans-serif';
  ctx.textBaseline = 'top';
  return { canvas: c, ctx, w, h };
}

function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

function drawTitle(ctx, w, title, subtitle) {
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 13px Calibri, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 12, 8);
  if (subtitle) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '10px Calibri, sans-serif';
    ctx.fillText(subtitle, 12, 26);
  }
}

function drawGridY(ctx, plot, ticks, yMax, yMin = 0) {
  ctx.strokeStyle = '#e5e5e5';
  ctx.fillStyle = COLORS.muted;
  ctx.font = '9px Calibri, sans-serif';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  const range = yMax - yMin;
  ticks.forEach(t => {
    const y = plot.y + plot.h - ((t - yMin) / range) * plot.h;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillText(String(t), plot.x - 6, y - 5);
  });
  ctx.setLineDash([]);
  // Axes
  ctx.strokeStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();
}

// ── Donut chart ──────────────────────────────────────────────────────
function renderDonut(segments, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 360, opts.h || 220);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const cx = 100, cy = 120, outerR = 65, innerR = 42;
  const total = segments.reduce((s, x) => s + x.value, 0);
  let angle = -Math.PI / 2;
  ctx.lineWidth = 0;
  segments.forEach(seg => {
    const slice = (seg.value / total) * Math.PI * 2;
    ctx.fillStyle = seg.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, angle + slice);
    ctx.closePath();
    ctx.fill();
    angle += slice;
  });
  // Inner hole
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fill();
  // Center text
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 14px Calibri, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(opts.centerVal || '', cx, cy - 6);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '9px Calibri, sans-serif';
  ctx.fillText(opts.centerUnit || '', cx, cy + 10);
  // Legend
  ctx.font = '10px Calibri, sans-serif';
  ctx.textAlign = 'left';
  segments.forEach((seg, i) => {
    const yL = 50 + i * 22;
    ctx.fillStyle = seg.color;
    ctx.fillRect(190, yL, 12, 10);
    ctx.fillStyle = COLORS.text;
    const pct = ((seg.value / total) * 100).toFixed(1);
    ctx.fillText(`${seg.label}  ${pct} %`, 208, yL);
  });
  return canvasToDataUrl(canvas);
}

// ── Horizontale Balken (z.B. VBh) ─────────────────────────────────────
function renderHorizontalBars(items, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 440, opts.h || 240);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 110, y: 50, w: w - 130, h: h - 90 };
  const maxV = Math.max(...items.map(i => i.value), opts.refMax || 0);
  const barH = Math.min(28, (plot.h - 10) / items.length - 6);
  const barGap = 8;
  ctx.font = '10px Calibri, sans-serif';
  items.forEach((item, i) => {
    const y = plot.y + i * (barH + barGap);
    const len = (item.value / maxV) * plot.w;
    ctx.fillStyle = item.color || COLORS.primary;
    ctx.fillRect(plot.x, y, len, barH);
    // Label left
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.fillText(item.label, plot.x - 8, y + barH / 2 - 5);
    // Value right
    ctx.textAlign = 'left';
    ctx.fillStyle = item.color || COLORS.primary;
    ctx.font = '600 10px Calibri, sans-serif';
    ctx.fillText(item.valueLabel || item.value.toFixed(0), plot.x + len + 6, y + barH / 2 - 5);
    ctx.font = '10px Calibri, sans-serif';
  });
  // X axis line
  ctx.strokeStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.stroke();
  return canvasToDataUrl(canvas);
}

// ── Histogramm / Bar-Chart (vertikal) ─────────────────────────────────
function renderBars(items, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 380, opts.h || 220);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 50, y: 50, w: w - 70, h: h - 90 };
  const maxV = Math.max(...items.map(i => i.value)) * 1.1;
  const ticks = [0, maxV * 0.25, maxV * 0.5, maxV * 0.75, maxV].map(t => Math.round(t));
  drawGridY(ctx, plot, ticks, maxV);
  const barW = (plot.w - 10) / items.length - 8;
  ctx.font = '9px Calibri, sans-serif';
  ctx.textAlign = 'center';
  items.forEach((item, i) => {
    const barH = (item.value / maxV) * plot.h;
    const x = plot.x + 8 + i * (barW + 8);
    const y = plot.y + plot.h - barH;
    ctx.fillStyle = item.color || COLORS.primary;
    ctx.fillRect(x, y, barW, barH);
    // Value above
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 9px Calibri, sans-serif';
    ctx.fillText(String(item.value), x + barW / 2, y - 12);
    // Label below
    ctx.font = '9px Calibri, sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(item.label, x + barW / 2, plot.y + plot.h + 6);
  });
  return canvasToDataUrl(canvas);
}

// ── Vergleichs-Balken (z.B. Plan vs Bestand) ──────────────────────────
function renderComparisonBars(items, opts) {
  return renderBars(items, opts);
}

// ── Stacked Column (Monatswerte) ──────────────────────────────────────
function renderStackedColumn(months, layers, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 760, opts.h || 280);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 60, y: 50, w: w - 240, h: h - 100 };
  const totals = months.map(m => layers.reduce((s, l) => s + (m[l.key] || 0), 0));
  const maxV = opts.yMax || (Math.max(...totals) * 1.15);
  const tickStep = niceStep(maxV / 5);
  const ticks = [];
  for (let t = 0; t <= maxV; t += tickStep) ticks.push(Math.round(t));
  drawGridY(ctx, plot, ticks, maxV);
  const barW = Math.min(40, (plot.w - 20) / months.length - 6);
  ctx.font = '9px Calibri, sans-serif';
  ctx.textAlign = 'center';
  months.forEach((m, i) => {
    const x = plot.x + (i + 0.5) * (plot.w / months.length) - barW / 2;
    let yBase = plot.y + plot.h;
    layers.forEach(layer => {
      const v = m[layer.key] || 0;
      if (v <= 0) return;
      const barH = (v / maxV) * plot.h;
      ctx.fillStyle = layer.color;
      ctx.fillRect(x, yBase - barH, barW, barH);
      yBase -= barH;
    });
    // Total above
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 9px Calibri, sans-serif';
    ctx.fillText(Math.round(totals[i]), x + barW / 2, yBase - 12);
    // Month label
    ctx.fillStyle = COLORS.muted;
    ctx.font = '9px Calibri, sans-serif';
    ctx.fillText(m.label, x + barW / 2, plot.y + plot.h + 6);
  });
  // Legend
  drawLegend(ctx, layers, w - 170, 50);
  return canvasToDataUrl(canvas);
}

// ── Stacked Area (Stundenprofile) ─────────────────────────────────────
function renderStackedArea(data, layers, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 760, opts.h || 280);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 60, y: 50, w: w - 240, h: h - 100 };
  const totals = data.map(d => layers.reduce((s, l) => s + (d[l.key] || 0), 0));
  const maxV = opts.yMax || (Math.max(...totals) * 1.1);
  const tickStep = niceStep(maxV / 5);
  const ticks = [];
  for (let t = 0; t <= maxV; t += tickStep) ticks.push(Math.round(t));
  drawGridY(ctx, plot, ticks, maxV);
  const n = data.length;
  const xAt = i => plot.x + (i / (n - 1)) * plot.w;
  const yAt = v => plot.y + plot.h - (v / maxV) * plot.h;
  const cumLow = new Array(n).fill(0);
  layers.forEach(layer => {
    const top = data.map((d, i) => cumLow[i] + (d[layer.key] || 0));
    ctx.fillStyle = layer.color;
    ctx.globalAlpha = layer.opacity != null ? layer.opacity : 0.92;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = xAt(i), py = yAt(top[i]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(xAt(i), yAt(cumLow[i]));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < n; i++) cumLow[i] = top[i];
  });
  // X axis ticks
  ctx.fillStyle = COLORS.muted;
  ctx.font = '9px Calibri, sans-serif';
  ctx.textAlign = 'center';
  (opts.xTicks || []).forEach(t => {
    const x = xAt(t.i);
    ctx.fillText(t.label, x, plot.y + plot.h + 6);
  });
  // Peak marker
  if (opts.peakIndex != null) {
    const px = xAt(opts.peakIndex);
    const py = yAt(totals[opts.peakIndex]);
    ctx.fillStyle = COLORS.rust;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.rust;
    ctx.font = '600 9px Calibri, sans-serif';
    ctx.fillText(`${Math.round(totals[opts.peakIndex])} kW peak`, px, py - 16);
  }
  drawLegend(ctx, layers, w - 170, 50);
  return canvasToDataUrl(canvas);
}

// ── Waterfall (Wirtschaftlichkeit) ────────────────────────────────────
function renderWaterfall(steps, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 700, opts.h || 320);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 60, y: 50, w: w - 80, h: h - 110 };
  let running = 0;
  const cumValues = [];
  steps.forEach((s, i) => {
    if (s.isTotal) {
      cumValues.push({ low: 0, high: s.value });
    } else {
      cumValues.push({ low: Math.min(running, running + s.value), high: Math.max(running, running + s.value) });
      running += s.value;
    }
  });
  const maxV = Math.max(...cumValues.map(c => c.high)) * 1.15;
  const minV = Math.min(0, ...cumValues.map(c => c.low));
  const tickStep = niceStep((maxV - minV) / 6);
  const ticks = [];
  for (let t = Math.floor(minV / tickStep) * tickStep; t <= maxV; t += tickStep) ticks.push(+t.toFixed(2));
  drawGridY(ctx, plot, ticks, maxV, minV);
  const barW = Math.min(70, (plot.w - 40) / steps.length - 20);
  const yAt = v => plot.y + plot.h - ((v - minV) / (maxV - minV)) * plot.h;
  ctx.font = '10px Calibri, sans-serif';
  ctx.textAlign = 'center';
  let prevX = 0, prevY = 0;
  steps.forEach((s, i) => {
    const x = plot.x + 20 + i * ((plot.w - 40) / steps.length);
    const yHigh = yAt(cumValues[i].high);
    const yLow = yAt(cumValues[i].low);
    const barH = yLow - yHigh;
    ctx.fillStyle = s.color || (s.isTotal ? COLORS.primary : (s.value < 0 ? COLORS.sage : COLORS.primary));
    ctx.globalAlpha = s.isTotal ? 1 : 0.92;
    ctx.fillRect(x, yHigh, barW, barH);
    ctx.globalAlpha = 1;
    if (s.isTotal) {
      ctx.strokeStyle = '#1f4029';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, yHigh, barW, barH);
    }
    // Connector to next
    if (i > 0 && i < steps.length && !steps[i].isTotal) {
      ctx.strokeStyle = COLORS.muted;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(prevX + barW, prevY);
      ctx.lineTo(x, prevY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Value label
    ctx.fillStyle = s.isTotal ? COLORS.primary : (s.value < 0 ? COLORS.goodFg : COLORS.text);
    ctx.font = s.isTotal ? '700 11px Calibri, sans-serif' : '600 10px Calibri, sans-serif';
    const sign = s.value > 0 && !s.isTotal ? '+' : '';
    ctx.fillText(sign + s.value.toFixed(2).replace('.', ','), x + barW / 2, yHigh - 14);
    // Bottom label
    ctx.fillStyle = COLORS.muted;
    ctx.font = s.isTotal ? '700 10px Calibri, sans-serif' : '10px Calibri, sans-serif';
    ctx.fillText(s.label, x + barW / 2, plot.y + plot.h + 8);
    if (s.sublabel) {
      ctx.font = '8.5px Calibri, sans-serif';
      ctx.fillText(s.sublabel, x + barW / 2, plot.y + plot.h + 22);
    }
    // Track end of bar for connector
    prevX = x;
    prevY = s.isTotal ? yLow : (s.value < 0 ? yLow : yHigh);
  });
  // Reference line (e.g. Bestand-WGK)
  if (opts.refLine != null) {
    const y = yAt(opts.refLine);
    ctx.strokeStyle = COLORS.rust;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.warnFg;
    ctx.font = '600 9px Calibri, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(opts.refLabel || '', plot.x + plot.w - 4, y - 12);
  }
  return canvasToDataUrl(canvas);
}

// ── Stacked Column mit negativen Werten (Variantenvergleich Kostenarten) ─
function renderStackedColumnPN(items, layers, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 760, opts.h || 340);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 60, y: 50, w: w - 220, h: h - 130 };
  // Find positive max and negative min
  let posMax = 0, negMin = 0;
  items.forEach(it => {
    let pos = 0, neg = 0;
    layers.forEach(l => {
      const v = it[l.key] || 0;
      if (v >= 0) pos += v; else neg += v;
    });
    if (pos > posMax) posMax = pos;
    if (neg < negMin) negMin = neg;
  });
  const range = (posMax * 1.15) - (negMin * 1.15);
  const yMax = posMax * 1.15;
  const yMin = negMin * 1.15;
  const tickStep = niceStep(range / 7);
  const ticks = [];
  for (let t = Math.floor(yMin / tickStep) * tickStep; t <= yMax; t += tickStep) ticks.push(+t.toFixed(0));
  drawGridY(ctx, plot, ticks, yMax, yMin);
  const zeroY = plot.y + plot.h - ((0 - yMin) / range) * plot.h;
  // Strong zero line
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plot.x, zeroY);
  ctx.lineTo(plot.x + plot.w, zeroY);
  ctx.stroke();
  const barW = Math.min(70, (plot.w - 20) / items.length - 30);
  ctx.font = '9px Calibri, sans-serif';
  ctx.textAlign = 'center';
  items.forEach((it, i) => {
    const x = plot.x + (i + 0.5) * (plot.w / items.length) - barW / 2;
    let posStack = 0, negStack = 0;
    layers.forEach(layer => {
      const v = it[layer.key] || 0;
      if (v === 0) return;
      const barH = (Math.abs(v) / range) * plot.h;
      const y = v > 0
        ? plot.y + plot.h - ((posStack + v - yMin) / range) * plot.h
        : plot.y + plot.h - ((negStack - yMin) / range) * plot.h;
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = v < 0 ? 0.78 : (it.highlight ? 1 : 0.92);
      ctx.fillRect(x, y, barW, barH);
      ctx.globalAlpha = 1;
      if (it.highlight) {
        ctx.strokeStyle = '#1f4029';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x, y, barW, barH);
      }
      if (v > 0) posStack += v; else negStack += v;
    });
    // Total above (Σ = posStack + negStack)
    const totalY = plot.y + plot.h - ((posStack - yMin) / range) * plot.h;
    ctx.fillStyle = it.highlight ? COLORS.primary : COLORS.text;
    ctx.font = it.highlight ? '700 10px Calibri, sans-serif' : '600 10px Calibri, sans-serif';
    ctx.fillText((posStack + negStack).toFixed(0) + ' T€', x + barW / 2, totalY - 14);
    // X label
    ctx.fillStyle = it.highlight ? COLORS.primary : COLORS.muted;
    ctx.font = it.highlight ? '700 10px Calibri, sans-serif' : '9.5px Calibri, sans-serif';
    ctx.fillText(it.label, x + barW / 2, plot.y + plot.h + 16);
    if (it.sublabel) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '8.5px Calibri, sans-serif';
      ctx.fillText(it.sublabel, x + barW / 2, plot.y + plot.h + 30);
    }
  });
  drawLegend(ctx, layers, w - 150, 50);
  return canvasToDataUrl(canvas);
}

// ── Linie + Bar-Chart (Monatswerte CO₂ Plan vs Bestand) ──────────────
function renderLineWithBars(months, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 760, opts.h || 280);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const plot = { x: 60, y: 50, w: w - 220, h: h - 100 };
  const allVals = [...months.map(m => m.bar), ...months.map(m => m.line)];
  const maxV = Math.max(...allVals) * 1.1;
  const minV = Math.min(0, ...allVals);
  const range = maxV - minV;
  const tickStep = niceStep(range / 6);
  const ticks = [];
  for (let t = Math.floor(minV / tickStep) * tickStep; t <= maxV; t += tickStep) ticks.push(+t.toFixed(0));
  drawGridY(ctx, plot, ticks, maxV, minV);
  const zeroY = plot.y + plot.h - ((0 - minV) / range) * plot.h;
  const barW = (plot.w / months.length) * 0.55;
  const slot = plot.w / months.length;
  // Bars (Bestand)
  months.forEach((m, i) => {
    const cx = plot.x + (i + 0.5) * slot;
    const v = m.bar;
    const barH = (Math.abs(v) / range) * plot.h;
    const y = v >= 0 ? zeroY - barH : zeroY;
    ctx.fillStyle = COLORS.rust;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(cx - barW / 2, y, barW, barH);
    ctx.globalAlpha = 1;
  });
  // Line (Plan)
  ctx.strokeStyle = COLORS.primary;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  months.forEach((m, i) => {
    const cx = plot.x + (i + 0.5) * slot;
    const y = plot.y + plot.h - ((m.line - minV) / range) * plot.h;
    if (i === 0) ctx.moveTo(cx, y); else ctx.lineTo(cx, y);
  });
  ctx.stroke();
  // Points
  ctx.fillStyle = COLORS.primary;
  months.forEach((m, i) => {
    const cx = plot.x + (i + 0.5) * slot;
    const y = plot.y + plot.h - ((m.line - minV) / range) * plot.h;
    ctx.beginPath();
    ctx.arc(cx, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // Month labels
  ctx.fillStyle = COLORS.muted;
  ctx.font = '9px Calibri, sans-serif';
  ctx.textAlign = 'center';
  months.forEach((m, i) => {
    const cx = plot.x + (i + 0.5) * slot;
    ctx.fillText(m.label, cx, plot.y + plot.h + 8);
  });
  // Legend
  ctx.font = '10px Calibri, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.rust;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(w - 200, 60, 14, 10);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(opts.barLabel || 'Bestand', w - 180, 60);
  ctx.fillStyle = COLORS.primary;
  ctx.fillRect(w - 200, 80, 14, 3);
  ctx.beginPath();
  ctx.arc(w - 193, 81.5, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.fillText(opts.lineLabel || 'Plan', w - 180, 76);
  return canvasToDataUrl(canvas);
}

// ── Horizontale Stacked Bar (Nutzungs-Verteilung) ─────────────────────
function renderHorizontalStacked(segments, opts) {
  const { canvas, ctx, w, h } = makeCanvas(opts.w || 380, opts.h || 220);
  drawTitle(ctx, w, opts.title, opts.subtitle);
  const total = segments.reduce((s, x) => s + x.value, 0);
  let x = 50;
  const barW = w - 70;
  const barH = 36;
  const yBar = 50;
  segments.forEach(seg => {
    const segW = (seg.value / total) * barW;
    ctx.fillStyle = seg.color;
    ctx.fillRect(x, yBar, segW, barH);
    if (segW > 40) {
      ctx.fillStyle = 'white';
      ctx.font = '600 10px Calibri, sans-serif';
      ctx.textAlign = 'center';
      const pct = ((seg.value / total) * 100).toFixed(0);
      ctx.fillText(`${seg.shortLabel || seg.label} ${pct}%`, x + segW / 2, yBar + barH / 2 - 5);
    }
    x += segW;
  });
  // Legend
  ctx.font = '10px Calibri, sans-serif';
  ctx.textAlign = 'left';
  segments.forEach((seg, i) => {
    const col = Math.floor(i / 4);
    const row = i % 4;
    const xL = 50 + col * 180;
    const yL = 100 + row * 18;
    ctx.fillStyle = seg.color;
    ctx.fillRect(xL, yL, 11, 9);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(seg.label, xL + 16, yL);
    if (seg.detail) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '9px Calibri, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(seg.detail, xL + 170, yL);
      ctx.font = '10px Calibri, sans-serif';
      ctx.textAlign = 'left';
    }
  });
  return canvasToDataUrl(canvas);
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────
function niceStep(rawStep) {
  if (rawStep <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

function drawLegend(ctx, layers, x, y) {
  ctx.font = '10px Calibri, sans-serif';
  ctx.textAlign = 'left';
  layers.forEach((l, i) => {
    const yL = y + i * 20;
    ctx.fillStyle = l.color;
    ctx.fillRect(x, yL, 14, 10);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(l.label, x + 20, yL);
  });
}

// ══════════════════════════════════════════════════════════════════════
// EXCELJS-STYLE-HELPER
// ══════════════════════════════════════════════════════════════════════
const BORDER_THIN = { style: 'thin', color: { argb: COLORS.borderGry } };
const BORDER_ALL = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };

function styleHeader(row) {
  row.eachCell({ includeEmpty: true }, c => {
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = BORDER_ALL;
  });
  row.height = 22;
}

function styleSection(row) {
  row.eachCell({ includeEmpty: true }, c => {
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.primaryFg } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sectionBg } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    c.border = BORDER_ALL;
  });
}

function styleSum(row) {
  row.eachCell({ includeEmpty: true }, c => {
    c.font = { name: 'Calibri', size: 11, bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sumBg } };
    c.alignment = { vertical: 'middle' };
    c.border = { top: { style: 'medium', color: { argb: 'FFA89968' } }, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
  });
}

function styleDataRow(row, isAlt = false) {
  row.eachCell({ includeEmpty: false }, c => {
    if (!c.font) c.font = { name: 'Calibri', size: 11 };
    c.border = BORDER_ALL;
    if (isAlt) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRow } };
  });
}

function setColWidths(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function alignRight(cell) { cell.alignment = { horizontal: 'right', vertical: 'middle' }; }
function alignCenter(cell) { cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
function fmtNum1(cell) { cell.numFmt = '#,##0.0;-#,##0.0;"—"'; }
function fmtNum0(cell) { cell.numFmt = '#,##0;-#,##0;"—"'; }
function fmtPct1(cell) { cell.numFmt = '0.0"%"'; }
function fmtEuro(cell) { cell.numFmt = '#,##0" €"'; }
function fmtEuroPa(cell) { cell.numFmt = '#,##0" €/a"'; }
function fmtCtkwh(cell) { cell.numFmt = '0.00" ct/kWh"'; }

function addChart(wb, ws, dataUrl, anchorCell, sizePx) {
  const imgId = wb.addImage({ base64: dataUrl, extension: 'png' });
  ws.addImage(imgId, {
    tl: { col: anchorCell.col - 1, row: anchorCell.row - 1 },
    ext: { width: sizePx.w, height: sizePx.h },
    editAs: 'oneCell',
  });
}

// ══════════════════════════════════════════════════════════════════════
// DATEN-COLLECTOR
// Sammelt alle benötigten Daten in einem zentralen Objekt
// ══════════════════════════════════════════════════════════════════════
function collectData() {
  const keys = window._dispatchActiveKeys || [];
  const en = window._dispatchEnergy || {};
  const hourly = window._dispatchHourly || {};
  const sd = window._sankeyData || {};
  const stromKpis = window._stromNetzKpis || {};
  const stromKosten = window._stromNetzKosten || {};

  const connectedIds = new Set((netzEdges || []).filter(e => !e.pruned).flatMap(e => [e.u, e.v]));
  const activeNetz = (netzEdges || []).filter(e => !e.pruned);

  const totalMwh = keys.reduce((s, k) => s + ((en[k] || {}).waermeMwh || 0), 0);
  const gesamtFlaeche = gebaeude.reduce((s, g) => s + (parseFloat(g.flaeche) || 0), 0);
  const gesamtHeizlast = gebaeude.reduce((s, g) => {
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    return s + (parseFloat(st.heizlast || g.heizlast) || 0);
  }, 0);
  const trasseLaenge = Math.round(activeNetz.reduce((s, e) => s + (e.length || 0), 0));
  const totalLossMwh = activeNetz.reduce((s, e) => s + (e.lossKW_annual || 0), 0) * 8.76;

  const variantName = activeVariantId
    ? (varianten.find(v => v.id === activeVariantId)?.name || 'Variante')
    : 'Basisdaten';

  // Erzeuger mit Details
  const erzeuger = keys.map(k => {
    const e = en[k] || {};
    const cfg = ERZEUGER_CFG[k];
    const kw = cfg?.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0;
    return {
      key: k,
      label: DA_LABELS[k] || k,
      kw,
      waermeMwh: e.waermeMwh || 0,
      elMwh: e.elMwh || 0,
      anteilPct: totalMwh > 0 ? (e.waermeMwh || 0) / totalMwh * 100 : 0,
      vbh: kw > 0 ? (e.waermeMwh || 0) * 1000 / kw : 0,
    };
  });

  // Monatswerte aus stündlichen Werten aggregieren
  const monthStarts = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const months = monthNames.map((label, mi) => {
    const obj = { label };
    keys.forEach(k => {
      const arr = hourly[k];
      if (!arr) { obj[k] = 0; return; }
      let sum = 0;
      for (let t = monthStarts[mi]; t < monthStarts[mi + 1]; t++) sum += (arr[t] || 0);
      obj[k] = sum / 1000; // kWh → MWh
    });
    return obj;
  });

  return {
    keys, en, hourly, sd, stromKpis, stromKosten,
    connectedIds, activeNetz, trasseLaenge, totalLossMwh,
    totalMwh, gesamtFlaeche, gesamtHeizlast,
    variantName, erzeuger, months,
    wgkVal: window._lastWgk || null,
    investGes: window._lastInvestGes || 0,
    jkGes: window._lastJkGes || 0,
    eeAnteil: window._lastEeAnteil,
    nGeb: gebaeude.length,
    nAngeschlossen: gebaeude.filter(g => connectedIds.has(g.id)).length,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SHEET-BUILDER
// ══════════════════════════════════════════════════════════════════════

// ── Sheet 1: Übersicht ───────────────────────────────────────────────
function buildSheetUebersicht(wb, d) {
  const ws = wb.addWorksheet('1 Übersicht', {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: COLORS.headerBg } },
  });
  setColWidths(ws, [4, 26, 18, 18, 4, 26, 18, 18]);

  // Title
  ws.mergeCells('B2:H2');
  const titleCell = ws.getCell('B2');
  titleCell.value = 'Energetisches Quartierskonzept';
  titleCell.font = { name: 'Calibri', size: 22, bold: true, color: { argb: COLORS.primaryFg } };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(2).height = 32;

  ws.mergeCells('B3:H3');
  const subCell = ws.getCell('B3');
  subCell.value = 'Variante: ' + d.variantName + ' · Betrachtungsjahr ' + (globalYear || '—');
  subCell.font = { name: 'Calibri', size: 12, color: { argb: 'FF666666' } };

  // KPI Tiles (B5:D6, E5:G6 etc.)
  let kpiRow = 5;
  const kpis = [
    { label: 'Gebäude',       val: d.nGeb,                                        unit: '' },
    { label: 'Gesamtfläche',  val: Math.round(d.gesamtFlaeche).toLocaleString('de-DE'),  unit: 'm²' },
    { label: 'Wärmebedarf',   val: Math.round(d.totalMwh).toLocaleString('de-DE'),       unit: 'MWh/a' },
    { label: 'Heizlast',      val: Math.round(d.gesamtHeizlast).toLocaleString('de-DE'), unit: 'kW' },
    { label: 'EE-Anteil',     val: d.eeAnteil != null ? d.eeAnteil.toFixed(1) : '—',  unit: '%' },
    { label: 'WGK',           val: d.wgkVal ? d.wgkVal.toFixed(2) : '—',            unit: 'ct/kWh' },
    { label: 'Investition',   val: d.investGes ? Math.round(d.investGes / 1000).toLocaleString('de-DE') : '—', unit: 'T€' },
    { label: 'Jahreskosten',  val: d.jkGes ? Math.round(d.jkGes).toLocaleString('de-DE') : '—',     unit: '€/a' },
  ];
  kpis.forEach((kpi, i) => {
    const col = (i % 4) * 2 + 2;  // B(2), D(4), F(6), H(8)
    const row = kpiRow + Math.floor(i / 4) * 3;
    const labelCell = ws.getCell(row, col);
    labelCell.value = kpi.label.toUpperCase();
    labelCell.font = { name: 'Calibri', size: 9, color: { argb: 'FF888888' }, bold: true };
    const valCell = ws.getCell(row + 1, col);
    valCell.value = kpi.val + (kpi.unit ? ' ' + kpi.unit : '');
    valCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLORS.primaryFg } };
    [labelCell, valCell].forEach(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      c.border = { left: { style: 'medium', color: { argb: 'FF6B9080' } }, top: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
    });
  });
  ws.getRow(kpiRow).height = 14;
  ws.getRow(kpiRow + 1).height = 24;
  ws.getRow(kpiRow + 3).height = 14;
  ws.getRow(kpiRow + 4).height = 24;

  // Charts row (anchored around row 13)
  if (d.erzeuger.length > 0 && d.totalMwh > 0) {
    const segs = d.erzeuger
      .filter(e => e.waermeMwh > 0)
      .map((e, i) => ({
        label: e.label,
        value: e.waermeMwh,
        color: CHART_LAYERS[e.key] || [COLORS.primary, COLORS.sage, COLORS.oak, COLORS.moss, COLORS.stone][i % 5],
      }));
    const donutUrl = renderDonut(segs, {
      title: 'Wärmedeckung nach Erzeuger',
      subtitle: 'Jahresanteile · MWh/a',
      centerVal: Math.round(d.totalMwh).toLocaleString('de-DE'),
      centerUnit: 'MWh/a',
    });
    addChart(wb, ws, donutUrl, { col: 2, row: 13 }, { w: 360, h: 220 });
  }

  // Projekt-Meta
  let metaRow = 25;
  ws.mergeCells(`B${metaRow}:H${metaRow}`);
  ws.getCell(`B${metaRow}`).value = 'Projekt-Metadaten';
  ws.getCell(`B${metaRow}`).font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.primaryFg } };
  ws.getCell(`B${metaRow}`).border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } };
  metaRow++;
  const meta = [
    ['Variante', d.variantName],
    ['Betrachtungsjahr', String(globalYear || '—')],
    ['Erstellt', new Date().toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })],
    ['Gebäude im Plangebiet', `${d.nGeb} (davon ${d.nAngeschlossen} am Netz)`],
    ['Trassenlänge Wärmenetz', d.trasseLaenge.toLocaleString('de-DE') + ' m'],
    ['Modell', 'Energieplanung-Tool v2'],
  ];
  meta.forEach(([k, v]) => {
    ws.getCell(metaRow, 2).value = k;
    ws.getCell(metaRow, 2).font = { name: 'Calibri', size: 10, color: { argb: 'FF666666' } };
    ws.mergeCells(metaRow, 3, metaRow, 5);
    ws.getCell(metaRow, 3).value = v;
    ws.getCell(metaRow, 3).font = { name: 'Calibri', size: 10, bold: true };
    metaRow++;
  });
}

// ── Sheet 2: Gebäude ─────────────────────────────────────────────────
function buildSheetGebaeude(wb, d) {
  const ws = wb.addWorksheet('2 Gebäude', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  setColWidths(ws, [10, 28, 14, 10, 12, 12, 10, 14, 12, 14, 12, 12, 6, 10, 6, 14]);

  const headers = ['ID', 'Bezeichnung', 'Nutzung', 'Baujahr', 'Zustand', 'Fläche m²', 'Stockwerke', 'Wärme MWh/a', 'Heizlast kW', 'Spez. kWh/m²a', 'Spez. W/m²', 'Strom MWh/a', 'PV', 'PV Dach %', 'Netz', 'Verlust MWh/a'];
  ws.addRow(headers);
  styleHeader(ws.getRow(1));

  const baujahrBins = { '<1948': 0, '1948-68': 0, '1969-78': 0, '1979-94': 0, '1995-09': 0, '2010+': 0 };
  const nutzungAgg = {};

  gebaeude.forEach((g, i) => {
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    const w = st.waerme || g.waerme || 0;
    const fl = parseFloat(g.flaeche) || 0;
    const hl = parseFloat(st.heizlast || g.heizlast) || 0;
    const row = ws.addRow([
      g.id,
      g.name || '',
      g.nutzung || '',
      g.baujahr || '',
      g.zustand || '',
      fl || null,
      g.stockwerke || null,
      w || null,
      hl || null,
      fl > 0 && w > 0 ? Math.round(w * 1000 / fl) : null,
      fl > 0 && hl > 0 ? Math.round(hl * 1000 / fl) : null,
      typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : null,
      g.pvAktiv ? '✓' : '',
      g.pvAktiv ? (g.pvDachanteil || 30) : null,
      d.connectedIds.has(g.id) ? '✓' : '',
      g.netzVerlustJahrMWh || null,
    ]);
    styleDataRow(row, i % 2 === 1);
    fmtNum0(row.getCell(6)); fmtNum1(row.getCell(8)); fmtNum1(row.getCell(9));
    fmtNum0(row.getCell(10)); fmtNum0(row.getCell(11)); fmtNum1(row.getCell(12));
    fmtNum1(row.getCell(16));
    alignCenter(row.getCell(13)); alignCenter(row.getCell(15));
    // Baujahr-Bucket
    const bj = parseInt(g.baujahr) || 0;
    if (bj > 0) {
      if (bj < 1948) baujahrBins['<1948']++;
      else if (bj < 1969) baujahrBins['1948-68']++;
      else if (bj < 1979) baujahrBins['1969-78']++;
      else if (bj < 1995) baujahrBins['1979-94']++;
      else if (bj < 2010) baujahrBins['1995-09']++;
      else baujahrBins['2010+']++;
    }
    const n = g.nutzung || 'Unbekannt';
    if (!nutzungAgg[n]) nutzungAgg[n] = { count: 0, w: 0 };
    nutzungAgg[n].count++;
    nutzungAgg[n].w += w;
  });

  // Σ Zeile
  const sumRow = ws.addRow([
    `Σ ${gebaeude.length}`, '', '', '', '',
    Math.round(d.gesamtFlaeche), '', d.totalMwh, d.gesamtHeizlast, '', '', '', '', '', '', '',
  ]);
  styleSum(sumRow); fmtNum0(sumRow.getCell(6)); fmtNum1(sumRow.getCell(8)); fmtNum1(sumRow.getCell(9));

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount - 1, column: headers.length } };

  // Charts unterhalb
  const chartRow = ws.rowCount + 3;
  const bjColors = [COLORS.rust, COLORS.wood, COLORS.oak, COLORS.moss, COLORS.sage, COLORS.primary];
  const bjItems = Object.keys(baujahrBins).map((k, i) => ({
    label: k, value: baujahrBins[k], color: bjColors[i],
  }));
  const bjUrl = renderBars(bjItems, {
    title: 'Baujahres-Verteilung',
    subtitle: `Anzahl Gebäude je Baualtersklasse · Σ ${gebaeude.length}`,
  });
  addChart(wb, ws, bjUrl, { col: 1, row: chartRow }, { w: 380, h: 220 });

  // Nutzungs-Stacked
  const nutzColors = [COLORS.primary, '#4a7c59', COLORS.sage, COLORS.oak, COLORS.moss, COLORS.stone, COLORS.light];
  const nutzSegs = Object.entries(nutzungAgg)
    .sort((a, b) => b[1].w - a[1].w)
    .map(([k, v], i) => ({
      label: k,
      shortLabel: k.slice(0, 5),
      value: v.w || 0.001,
      color: nutzColors[i % nutzColors.length],
      detail: `${v.count} · ${Math.round(v.w)} MWh`,
    }));
  if (nutzSegs.length > 0) {
    const nutzUrl = renderHorizontalStacked(nutzSegs, {
      title: 'Nutzungs-Verteilung',
      subtitle: 'Anteil am Wärmebedarf',
    });
    addChart(wb, ws, nutzUrl, { col: 8, row: chartRow }, { w: 380, h: 220 });
  }
}

// ── Sheet 3: Erzeugerpark ────────────────────────────────────────────
function buildSheetErzeuger(wb, d) {
  const ws = wb.addWorksheet('3 Erzeugerpark', { views: [{ state: 'frozen', ySplit: 1 }] });
  setColWidths(ws, [6, 28, 18, 14, 14, 14, 14, 14, 14]);
  ws.addRow(['Rang', 'Erzeuger', 'Typ', 'Leistung kW', 'Wärme MWh/a', 'Strom MWh/a', 'VBh h/a', 'Deckung %', 'Brennstoff/Quelle']);
  styleHeader(ws.getRow(1));

  d.erzeuger.forEach((e, i) => {
    const cfg = ERZEUGER_CFG[e.key] || {};
    const row = ws.addRow([
      i + 1, e.label, cfg.kategorie || cfg.typ || '', e.kw || null,
      e.waermeMwh, e.elMwh || null,
      e.vbh > 0 ? Math.round(e.vbh) : null,
      e.anteilPct,
      cfg.brennstoff || '',
    ]);
    styleDataRow(row, i % 2 === 1);
    fmtNum0(row.getCell(4)); fmtNum1(row.getCell(5)); fmtNum1(row.getCell(6));
    fmtNum0(row.getCell(7)); fmtNum1(row.getCell(8));
    alignCenter(row.getCell(1));
  });
  const sumRow = ws.addRow(['Σ', 'Erzeugerpark', '',
    d.erzeuger.reduce((s, e) => s + (e.kw || 0), 0),
    d.totalMwh,
    d.erzeuger.reduce((s, e) => s + (e.elMwh || 0), 0) || null,
    null, 100, '',
  ]);
  styleSum(sumRow); fmtNum0(sumRow.getCell(4)); fmtNum1(sumRow.getCell(5)); fmtNum1(sumRow.getCell(6)); fmtNum1(sumRow.getCell(8));

  // VBh Bars chart
  const vbhItems = d.erzeuger
    .filter(e => e.vbh > 0)
    .sort((a, b) => b.vbh - a.vbh)
    .map(e => ({
      label: e.label,
      value: e.vbh,
      valueLabel: Math.round(e.vbh).toLocaleString('de-DE') + ' h',
      color: CHART_LAYERS[e.key] || COLORS.primary,
    }));
  if (vbhItems.length > 0) {
    const url = renderHorizontalBars(vbhItems, {
      title: 'Vollbenutzungsstunden je Erzeuger',
      subtitle: 'h/a · Referenz: 8760 h/a',
    });
    addChart(wb, ws, url, { col: 1, row: ws.rowCount + 3 }, { w: 480, h: 240 });
  }
}

// ── Sheet 4: Dispatch 8760 + Wochen-Chart ────────────────────────────
function buildSheetDispatch8760(wb, d) {
  const ws = wb.addWorksheet('4 Dispatch_8760', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const cols = ['Stunde', 'Monat', 'T_Außen °C', 'Last gesamt kW', ...d.keys.map(k => (DA_LABELS[k] || k) + ' kW')];
  setColWidths(ws, [8, 8, 12, 14, ...d.keys.map(() => 14)]);
  ws.addRow(cols);
  styleHeader(ws.getRow(1));

  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const mStarts = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016];
  // Außentemperatur aus Synthese-Lastgang (TRY) — wenn verfügbar
  const tArr = window._tAussenHourly || window._tryTemps || [];

  for (let t = 0; t < 8760; t++) {
    let m = 0;
    for (let mi = 11; mi >= 0; mi--) if (t >= mStarts[mi]) { m = mi; break; }
    const vals = d.keys.map(k => (d.hourly[k] ? d.hourly[k][t] : 0) || 0);
    const sum = vals.reduce((s, v) => s + v, 0);
    const row = ws.addRow([t + 1, monthNames[m], tArr[t] != null ? tArr[t] : null, sum, ...vals]);
    if (t % 50 === 0) styleDataRow(row, t % 100 === 0);
    fmtNum1(row.getCell(3)); fmtNum1(row.getCell(4));
    for (let i = 0; i < vals.length; i++) fmtNum1(row.getCell(5 + i));
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 8761, column: cols.length } };

  // Auslegungswoche-Chart (kälteste Woche)
  let coldestStart = 0;
  let coldestSum = 0;
  for (let t = 0; t < 8760 - 168; t += 24) {
    let sum = 0;
    for (let h = t; h < t + 168; h++) {
      d.keys.forEach(k => { sum += (d.hourly[k] && d.hourly[k][h]) || 0; });
    }
    if (sum > coldestSum) { coldestSum = sum; coldestStart = t; }
  }
  const weekData = [];
  let peakIdx = 0, peakVal = 0;
  for (let i = 0; i < 168; i++) {
    const t = coldestStart + i;
    const point = { h: i };
    let total = 0;
    d.keys.forEach(k => {
      const v = (d.hourly[k] && d.hourly[k][t]) || 0;
      point[k] = v;
      total += v;
    });
    weekData.push(point);
    if (total > peakVal) { peakVal = total; peakIdx = i; }
  }
  const layers = d.keys.map(k => ({ key: k, color: CHART_LAYERS[k] || COLORS.moss, label: DA_LABELS[k] || k }));
  const url = renderStackedArea(weekData, layers, {
    title: 'Auslegungswoche — 168 Stunden gestapelt',
    subtitle: `kW · Stundenwerte ab Stunde ${coldestStart + 1} (kälteste Woche)`,
    peakIndex: peakIdx,
    xTicks: [0, 1, 2, 3, 4, 5, 6].map(d => ({ i: d * 24 + 12, label: 'Tag ' + (d + 1) })),
  });
  addChart(wb, ws, url, { col: 4 + d.keys.length + 2, row: 2 }, { w: 760, h: 280 });
}

// ── Sheet 5: Dispatch_Aggregat (Monatswerte + Stacked Column + JDL) ──
function buildSheetDispatchAggregat(wb, d) {
  const ws = wb.addWorksheet('5 Dispatch_Aggregat', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = ['Monat', ...d.keys.map(k => (DA_LABELS[k] || k) + ' MWh'), 'Σ MWh'];
  setColWidths(ws, [10, ...d.keys.map(() => 14), 14]);
  ws.addRow(cols);
  styleHeader(ws.getRow(1));

  d.months.forEach((m, i) => {
    const vals = d.keys.map(k => m[k] || 0);
    const sum = vals.reduce((s, v) => s + v, 0);
    const row = ws.addRow([m.label, ...vals, sum]);
    styleDataRow(row, i % 2 === 1);
    for (let c = 2; c <= row.cellCount; c++) fmtNum1(row.getCell(c));
  });
  const sumRow = ws.addRow(['Σ Jahr',
    ...d.keys.map(k => d.months.reduce((s, m) => s + (m[k] || 0), 0)),
    d.totalMwh,
  ]);
  styleSum(sumRow); for (let c = 2; c <= sumRow.cellCount; c++) fmtNum1(sumRow.getCell(c));

  // Monatschart
  const layers = d.keys.map(k => ({ key: k, color: CHART_LAYERS[k] || COLORS.moss, label: DA_LABELS[k] || k }));
  const url = renderStackedColumn(d.months, layers, {
    title: 'Monatliche Wärmeerzeugung — gestapelt',
    subtitle: 'MWh/Monat',
  });
  addChart(wb, ws, url, { col: 1, row: ws.rowCount + 3 }, { w: 760, h: 280 });

  // JDL-Chart (Jahresdauerlinie absteigend nach Last)
  const hourlyTotals = [];
  for (let t = 0; t < 8760; t++) {
    const point = { i: t };
    d.keys.forEach(k => { point[k] = (d.hourly[k] && d.hourly[k][t]) || 0; });
    point.total = d.keys.reduce((s, k) => s + point[k], 0);
    hourlyTotals.push(point);
  }
  hourlyTotals.sort((a, b) => b.total - a.total);
  // Bucket to 200 points
  const buckets = 200;
  const bucketSize = Math.floor(8760 / buckets);
  const jdl = [];
  for (let b = 0; b < buckets; b++) {
    const slice = hourlyTotals.slice(b * bucketSize, (b + 1) * bucketSize);
    const point = { i: b };
    d.keys.forEach(k => {
      point[k] = slice.reduce((s, x) => s + x[k], 0) / slice.length;
    });
    jdl.push(point);
  }
  const jdlUrl = renderStackedArea(jdl, layers, {
    title: 'Jahresdauerlinie — gestapelte Erzeugung',
    subtitle: 'kW · 8760 h absteigend nach Last',
    xTicks: [0, 50, 100, 150, 199].map((i, idx) => ({ i, label: ['0', '2.000', '4.000', '6.000', '8.760'][idx] })),
  });
  addChart(wb, ws, jdlUrl, { col: 1, row: ws.rowCount + 18 }, { w: 760, h: 280 });
}

// ── Sheet 6: Wärmenetz ───────────────────────────────────────────────
function buildSheetWaermenetz(wb, d) {
  const ws = wb.addWorksheet('6 Wärmenetz', { views: [{ showGridLines: false }] });
  setColWidths(ws, [4, 24, 18, 14, 14, 14, 14, 14]);

  ws.getCell('B2').value = 'Netz-Kennwerte';
  ws.getCell('B2').font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.primaryFg } };
  let row = 4;
  const kpis = [
    ['Trassenlänge', d.trasseLaenge.toLocaleString('de-DE') + ' m'],
    ['Netzverluste', d.totalLossMwh.toFixed(1) + ' MWh/a (' + (d.totalMwh > 0 ? (d.totalLossMwh / d.totalMwh * 100).toFixed(1) : '0') + ' %)'],
    ['Anschlussgrad', `${d.nAngeschlossen} / ${d.nGeb} Gebäude (${d.nGeb > 0 ? (d.nAngeschlossen / d.nGeb * 100).toFixed(1) : '0'} %)`],
    ['Wärmebelegungsdichte', d.trasseLaenge > 0 ? (d.totalMwh * 1000 / d.trasseLaenge).toFixed(0) + ' kWh/(m·a)' : '—'],
  ];
  kpis.forEach(([k, v]) => {
    ws.getCell(row, 2).value = k;
    ws.getCell(row, 2).font = { name: 'Calibri', size: 11, color: { argb: 'FF666666' } };
    ws.getCell(row, 3).value = v;
    ws.getCell(row, 3).font = { name: 'Calibri', size: 11, bold: true };
    row++;
  });

  // DN-Verteilung
  row += 2;
  ws.getCell(row, 2).value = 'DN-Verteilung';
  ws.getCell(row, 2).font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.primaryFg } };
  row++;
  const headerRow = ws.getRow(row);
  headerRow.values = ['', 'Nennweite', 'Länge m', 'Anteil %', 'Verlust MWh/a'];
  styleHeader(headerRow);
  row++;
  const dnCounts = {};
  d.activeNetz.forEach(e => {
    const dn = e.dn || '?';
    if (!dnCounts[dn]) dnCounts[dn] = { length: 0, loss: 0 };
    dnCounts[dn].length += (e.length || 0);
    dnCounts[dn].loss += (e.lossKW_annual || 0) * 8.76;
  });
  const totalLength = d.trasseLaenge;
  Object.keys(dnCounts).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach((dn, i) => {
    const r = ws.getRow(row);
    r.values = ['', 'DN ' + dn, dnCounts[dn].length, totalLength > 0 ? dnCounts[dn].length / totalLength * 100 : 0, dnCounts[dn].loss];
    styleDataRow(r, i % 2 === 1); fmtNum0(r.getCell(3)); fmtPct1(r.getCell(4)); fmtNum1(r.getCell(5));
    row++;
  });

  // Edges-Tabelle
  row += 2;
  ws.getCell(row, 2).value = 'Einzelleitungen';
  ws.getCell(row, 2).font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.primaryFg } };
  row++;
  const edgeHeader = ws.getRow(row);
  edgeHeader.values = ['', 'ID', 'Von', 'Nach', 'Länge m', 'DN', 'Spitzenlast kW', 'Verlust MWh/a', 'Aktiv'];
  styleHeader(edgeHeader); row++;
  (netzEdges || []).forEach((e, i) => {
    const r = ws.getRow(row);
    r.values = ['', e.id || (i + 1), e.u, e.v, e.length || 0, e.dn || '', e.peakKW || null, (e.lossKW_annual || 0) * 8.76, e.pruned ? '' : '✓'];
    styleDataRow(r, i % 2 === 1); fmtNum0(r.getCell(5)); fmtNum1(r.getCell(7)); fmtNum1(r.getCell(8));
    alignCenter(r.getCell(9));
    row++;
  });
}

// ── Sheet 7: Stromnetz ───────────────────────────────────────────────
function buildSheetStromnetz(wb, d) {
  const ws = wb.addWorksheet('7 Stromnetz', { views: [{ showGridLines: false }] });
  setColWidths(ws, [4, 24, 18, 14, 14, 14, 14]);
  const stromNodes = window.stromNodes || [];
  const stromEdges = window.stromEdges || [];
  const trafos = stromNodes.filter(n => n.type === 'trafo');
  const naps = stromNodes.filter(n => n.type === 'nap');
  const kabelLaenge = stromEdges.reduce((s, e) => s + (e.lengthM || 0), 0);

  ws.getCell('B2').value = 'Stromnetz-Kennwerte';
  ws.getCell('B2').font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.primaryFg } };
  let row = 4;
  [
    ['Kabellänge gesamt', Math.round(kabelLaenge).toLocaleString('de-DE') + ' m'],
    ['Trafostationen', trafos.length + ' (' + trafos.reduce((s, t) => s + (t.ratedKva || 0), 0) + ' kVA)'],
    ['NAP-Anschlüsse', naps.length],
    ['Max. Spannungsfall', (d.stromKpis.maxDeltaU || 0).toFixed(1) + ' %'],
  ].forEach(([k, v]) => {
    ws.getCell(row, 2).value = k;
    ws.getCell(row, 2).font = { name: 'Calibri', size: 11, color: { argb: 'FF666666' } };
    ws.getCell(row, 3).value = v;
    ws.getCell(row, 3).font = { name: 'Calibri', size: 11, bold: true };
    row++;
  });

  // Trafostationen
  row += 2;
  ws.getCell(row, 2).value = 'Trafostationen';
  ws.getCell(row, 2).font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.primaryFg } };
  row++;
  const trafoHeader = ws.getRow(row);
  trafoHeader.values = ['', 'ID', 'Bezeichnung', 'Nennleistung kVA', 'Spitzenlast kW', 'Auslastung %'];
  styleHeader(trafoHeader); row++;
  trafos.forEach((t, i) => {
    const ausl = t.ratedKva > 0 && t.peakLoadKw ? (t.peakLoadKw / t.ratedKva * 100) : 0;
    const r = ws.getRow(row);
    r.values = ['', t.id, t.label || ('Trafo ' + t.id), t.ratedKva || null, t.peakLoadKw || null, ausl || null];
    styleDataRow(r, i % 2 === 1); fmtNum0(r.getCell(4)); fmtNum1(r.getCell(5)); fmtPct1(r.getCell(6));
    row++;
  });

  // Kabelquerschnitte
  row += 2;
  ws.getCell(row, 2).value = 'Kabel-Querschnittsverteilung';
  ws.getCell(row, 2).font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.primaryFg } };
  row++;
  const cabHeader = ws.getRow(row);
  cabHeader.values = ['', 'Querschnitt', 'Länge m', 'Anteil %'];
  styleHeader(cabHeader); row++;
  const mmCounts = {};
  stromEdges.forEach(e => {
    const mm = (e.crossSection || '?') + ' mm²';
    if (!mmCounts[mm]) mmCounts[mm] = 0;
    mmCounts[mm] += (e.lengthM || 0);
  });
  Object.keys(mmCounts).sort().forEach((mm, i) => {
    const r = ws.getRow(row);
    r.values = ['', mm, mmCounts[mm], kabelLaenge > 0 ? mmCounts[mm] / kabelLaenge * 100 : 0];
    styleDataRow(r, i % 2 === 1); fmtNum0(r.getCell(3)); fmtPct1(r.getCell(4));
    row++;
  });
}

// ── Sheet 8: Strombilanz ─────────────────────────────────────────────
function buildSheetStrombilanz(wb, d) {
  const ws = wb.addWorksheet('8 Strombilanz', { views: [{ state: 'frozen', ySplit: 1 }] });
  setColWidths(ws, [10, 16, 16, 16, 16, 16, 16, 14]);
  ws.addRow(['Monat', 'PV-Erz. MWh', 'BHKW-Strom MWh', 'Verbrauch MWh', 'Eigenverbrauch MWh', 'Einspeisung MWh', 'Netzbezug MWh', 'EV-Quote %']);
  styleHeader(ws.getRow(1));

  const sd = d.sd;
  // Wenn keine Monatswerte vorliegen, schätzen wir aus Jahressummen via PV-Profil
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const pvMonthShare = [0.034, 0.046, 0.080, 0.105, 0.118, 0.129, 0.137, 0.129, 0.099, 0.067, 0.042, 0.023];
  const heatShare = [0.165, 0.144, 0.114, 0.085, 0.069, 0.051, 0.044, 0.045, 0.060, 0.083, 0.106, 0.145];
  const pvMwhTotal = sd.pvMwh || 0;
  const bhkwMwhTotal = sd.bhkwStromMwh || 0;
  const evTotal = sd.eigenverbrauchMwh || 0;
  const einspTotal = (sd.pvEinspMwh || 0) + (sd.bhkwEinspMwh || 0);
  const bezugTotal = sd.netzbezugMwh || 0;
  const verbrauchTotal = evTotal + bezugTotal;

  for (let mi = 0; mi < 12; mi++) {
    const pv = pvMwhTotal * pvMonthShare[mi];
    const bhkw = bhkwMwhTotal * heatShare[mi];
    const verbr = verbrauchTotal * (0.083 + heatShare[mi] * 0.3); // approximiert
    const totVerbr = verbrauchTotal > 0 ? verbr / verbrauchTotal * verbrauchTotal : 0;
    const ev = evTotal * (heatShare[mi] * 0.5 + pvMonthShare[mi] * 0.5);
    const einsp = einspTotal * pvMonthShare[mi];
    const bezug = totVerbr - ev;
    const evq = totVerbr > 0 ? ev / totVerbr * 100 : 0;
    const r = ws.addRow([monthNames[mi], pv || null, bhkw || null, totVerbr || null, ev || null, einsp || null, bezug || null, evq || null]);
    styleDataRow(r, mi % 2 === 1);
    for (let c = 2; c <= 8; c++) fmtNum1(r.getCell(c));
  }
  const sumRow = ws.addRow(['Σ Jahr', pvMwhTotal, bhkwMwhTotal, verbrauchTotal, evTotal, einspTotal, bezugTotal, verbrauchTotal > 0 ? evTotal / verbrauchTotal * 100 : 0]);
  styleSum(sumRow); for (let c = 2; c <= 8; c++) fmtNum1(sumRow.getCell(c));

  // Strom-JDL-Chart (approximiert aus Wärme-Profil + PV-Profil)
  // Verwende WP-Strombedarf als Hauptlast
  const wpKeys = d.keys.filter(k => ['lwwp', 'fg', 'geo'].includes(k));
  const elDemandHourly = new Array(8760).fill(0);
  wpKeys.forEach(k => {
    const arr = d.hourly[k] || [];
    const cop = 3.5; // Vereinfacht
    for (let t = 0; t < 8760; t++) elDemandHourly[t] += (arr[t] || 0) / cop;
  });
  // Base demand
  for (let t = 0; t < 8760; t++) elDemandHourly[t] += 25;
  // PV-Erzeugung — interne Variable des Tools heißt elPvH
  const pvHourly = window.elPvH || [];
  // BHKW-Strom hourly — eigene Variable, nicht in dispatch.hourly
  const bhkwHourly = window._bhkwElHourly || d.hourly['bhkw'] || [];

  const dataPoints = [];
  for (let t = 0; t < 8760; t++) {
    const demand = elDemandHourly[t];
    const bhkwEl = (bhkwHourly[t] || 0) * 0.5; // Stromkennzahl 0.5 vereinfacht
    const pv = pvHourly[t] || 0;
    const evBhkw = Math.min(bhkwEl, demand);
    const evPv = Math.min(pv, demand - evBhkw);
    const bezug = Math.max(0, demand - evBhkw - evPv);
    dataPoints.push({ demand, evBhkw, evPv, bezug });
  }
  dataPoints.sort((a, b) => b.demand - a.demand);
  const stromJdl = [];
  for (let b = 0; b < 200; b++) {
    const slice = dataPoints.slice(b * 43, (b + 1) * 43);
    stromJdl.push({
      i: b,
      evBhkw: slice.reduce((s, x) => s + x.evBhkw, 0) / slice.length,
      evPv: slice.reduce((s, x) => s + x.evPv, 0) / slice.length,
      bezug: slice.reduce((s, x) => s + x.bezug, 0) / slice.length,
    });
  }
  const stromUrl = renderStackedArea(stromJdl, [
    { key: 'evBhkw', color: COLORS.primary, label: 'Eigenverbrauch BHKW' },
    { key: 'evPv',   color: COLORS.sage,    label: 'Eigenverbrauch PV' },
    { key: 'bezug',  color: COLORS.rust,    label: 'Netzbezug', opacity: 0.78 },
  ], {
    title: 'Strom-Jahresdauerlinie',
    subtitle: 'kW · 8760 h absteigend nach Strom-Verbrauch',
    xTicks: [0, 50, 100, 150, 199].map((i, idx) => ({ i, label: ['0', '2.000', '4.000', '6.000', '8.760'][idx] })),
  });
  addChart(wb, ws, stromUrl, { col: 1, row: ws.rowCount + 3 }, { w: 760, h: 280 });
}

// ── Sheet 9: Wirtschaftlichkeit ──────────────────────────────────────
function buildSheetWirtschaft(wb, d) {
  const ws = wb.addWorksheet('9 Wirtschaftlichkeit', { views: [{ state: 'frozen', ySplit: 1 }] });
  setColWidths(ws, [32, 14, 14, 16, 16, 16, 16, 16]);
  ws.addRow(['Baustein', 'Invest €', 'Annuität €/a', 'Wartung €/a', 'Instandh. €/a', 'Bedienung €/a', 'Energie €/a', 'Σ €/a']);
  styleHeader(ws.getRow(1));

  const sm = window._wirtschaftSummary || null;
  let kgfSum = 0, betrSum = 0, bgkSum = 0;
  let investGesamt = 0;

  if (sm && sm.rows) {
    // KGF + BetrGK aus Bausteinen
    const secKap = ws.addRow(['Anlagen und Bauteile', '', '', '', '', '', '', '']);
    ws.mergeCells(secKap.number, 1, secKap.number, 8);
    styleSection(secKap);
    sm.rows.forEach((r, i) => {
      const dt = r.detail || {};
      const annu = dt.annuitaet || 0;
      const wart = dt.wartung || 0;
      const inst = dt.instandhaltung || 0;
      const bed = dt.bedienung || 0;
      const summe = annu + wart + inst + bed;
      kgfSum += annu;
      betrSum += wart + inst + bed;
      investGesamt += (r.inv || 0);
      const row = ws.addRow([r.label || r.id, r.inv || null, annu || null, wart || null, inst || null, bed || null, null, summe || null]);
      styleDataRow(row, i % 2 === 1);
      fmtEuro(row.getCell(2));
      for (let c = 3; c <= 8; c++) fmtEuroPa(row.getCell(c));
    });

    // BGK aus energyRows
    if (sm.energyRows && sm.energyRows.length > 0) {
      const secBgk = ws.addRow(['Energiekosten / BGK', '', '', '', '', '', '', '']);
      ws.mergeCells(secBgk.number, 1, secBgk.number, 8);
      styleSection(secBgk);
      sm.energyRows.forEach((er, i) => {
        const row = ws.addRow([er.label || er.key, null, null, null, null, null, er.kosten || null, er.kosten || null]);
        styleDataRow(row, i % 2 === 1);
        fmtEuroPa(row.getCell(7)); fmtEuroPa(row.getCell(8));
        bgkSum += (er.kosten || 0);
      });
    }
  } else {
    ws.addRow(['Wirtschaftlichkeit noch nicht berechnet — bitte Tab „Wirtschaftlichkeit" öffnen oder „Grundlage berechnen" ausführen.']);
  }

  const sumTotal = kgfSum + betrSum + bgkSum;
  const sumRow = ws.addRow(['Σ Jahreskosten', investGesamt || null, kgfSum || null, null, null, null, bgkSum || null, sumTotal || null]);
  styleSum(sumRow);
  fmtEuro(sumRow.getCell(2));
  for (let c = 3; c <= 8; c++) fmtEuroPa(sumRow.getCell(c));

  // KGF / BGK / BetrGK Splittung
  ws.addRow([]);
  const splittRow = ws.addRow(['Kostenarten-Splittung (Bilanzsumme)', null, null, null, null, null, null, null]);
  ws.mergeCells(splittRow.number, 1, splittRow.number, 8);
  styleSection(splittRow);
  const kgfR = ws.addRow(['Kapitalgebunden (KGF)', null, kgfSum || null, null, null, null, null, kgfSum || null]);
  const betrR = ws.addRow(['Betriebsgebunden (BetrGK)', null, null, null, null, null, null, betrSum || null]);
  const bgkR = ws.addRow(['Bedarfsgebunden (BGK)', null, null, null, null, null, bgkSum || null, bgkSum || null]);
  [kgfR, betrR, bgkR].forEach((r, i) => { styleDataRow(r, i % 2 === 1); fmtEuroPa(r.getCell(3)); fmtEuroPa(r.getCell(7)); fmtEuroPa(r.getCell(8)); });

  const wgk = sm?.totals?.wgk || (d.totalMwh > 0 ? sumTotal / (d.totalMwh * 1000) * 100 : 0);
  const wgkRow = ws.addRow(['WGK = Jahreskosten / Wärmebedarf', '', '', '', '', '', '', wgk]);
  styleSum(wgkRow);
  wgkRow.getCell(8).font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLORS.primaryFg } };
  fmtCtkwh(wgkRow.getCell(8));

  // Waterfall-Chart
  if (d.totalMwh > 0 && (kgfSum + bgkSum + betrSum) > 0) {
    const totalKwh = d.totalMwh * 1000;
    const kgfCt = kgfSum / totalKwh * 100;
    const bgkCt = bgkSum / totalKwh * 100;
    const betrCt = betrSum / totalKwh * 100;
    const totalCt = kgfCt + bgkCt + betrCt;
    const steps = [
      { label: 'KGF',    sublabel: 'kapitalgeb.',    value: kgfCt,   color: COLORS.primary },
      { label: 'BGK',    sublabel: 'bedarfsgeb.',    value: bgkCt,   color: COLORS.sage },
      { label: 'BetrGK', sublabel: 'betriebsgeb.',   value: betrCt,  color: COLORS.oak },
      { label: 'WGK Σ',  sublabel: 'ct/kWh',         value: totalCt, color: COLORS.primary, isTotal: true },
    ];
    const url = renderWaterfall(steps, {
      title: 'WGK-Komposition — Waterfall',
      subtitle: 'ct/kWh · Aufbau nach VDI 2067',
    });
    addChart(wb, ws, url, { col: 1, row: ws.rowCount + 3 }, { w: 700, h: 320 });
  }
}

// ── Sheet 10: CO₂ ────────────────────────────────────────────────────
function buildSheetCO2(wb, d) {
  const ws = wb.addWorksheet('10 CO₂', { views: [{ state: 'frozen', ySplit: 1 }] });
  setColWidths(ws, [28, 18, 18, 16]);
  ws.addRow(['Erzeuger / Position', 'Endenergie MWh/a', 'EF g/kWh', 'CO₂ t/a']);
  styleHeader(ws.getRow(1));

  let planTotal = 0;
  const co2Rows = window._wirtschaftSummary?.co2Rows || [];
  if (co2Rows.length > 0) {
    co2Rows.forEach((cr, i) => {
      planTotal += cr.tCo2 || 0;
      const row = ws.addRow([cr.label || cr.key, null, null, cr.tCo2 || null]);
      styleDataRow(row, i % 2 === 1);
      fmtNum1(row.getCell(4));
    });
  } else {
    // Fallback: aus Erzeuger-Mengen mit pauschalen EF
    const ef = { gk: gasEmF, oel: 266, pellets: 23, hhs: 14, lwwp: stromEmF, fg: stromEmF, geo: stromEmF, st: 0 };
    d.erzeuger.forEach((e, i) => {
      const isWp = ['lwwp', 'fg', 'geo'].includes(e.key);
      const ende = isWp ? (e.elMwh || 0) : (e.waermeMwh || 0);
      const f = ef[e.key] ?? 200;
      const co2 = (ende * 1000 * f) / 1e6;
      planTotal += co2;
      const row = ws.addRow([e.label, ende, f, co2]);
      styleDataRow(row, i % 2 === 1);
      fmtNum1(row.getCell(2)); fmtNum0(row.getCell(3)); fmtNum1(row.getCell(4));
    });
  }
  const sumRow = ws.addRow(['Σ Plan-Variante', '', '', planTotal]);
  styleSum(sumRow); fmtNum1(sumRow.getCell(4));

  // Vergleich Bestand (Gaskessel-Annahme)
  const bestandCo2 = (d.totalMwh * 1000 * gasEmF) / 1e6;
  const r = ws.addRow(['Vergleich: Bestand (100 % Gaskessel, η=90 %)', d.totalMwh / 0.9, gasEmF, bestandCo2 / 0.9]);
  r.eachCell(c => {
    c.font = { name: 'Calibri', size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } };
    c.border = BORDER_ALL;
  });
  fmtNum1(r.getCell(2)); fmtNum0(r.getCell(3)); fmtNum1(r.getCell(4));

  const einspRow = ws.addRow(['CO₂-Einsparung gegenüber Bestand', '', '', planTotal - bestandCo2 / 0.9]);
  einspRow.eachCell(c => {
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.goodFg } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8D4' } };
    c.border = BORDER_ALL;
  });
  fmtNum1(einspRow.getCell(4));

  // Monats-Chart (Plan vs. Bestand) — Heizlast-Profil als Verteilungs-Schlüssel
  const heatShare = [0.165, 0.144, 0.114, 0.085, 0.069, 0.051, 0.044, 0.045, 0.060, 0.083, 0.106, 0.145];
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const bestandPerMonth = bestandCo2 / 0.9;
  const monthlyData = monthNames.map((label, mi) => ({
    label,
    bar:  bestandPerMonth * heatShare[mi],
    line: planTotal * heatShare[mi],
  }));
  const url = renderLineWithBars(monthlyData, {
    title: 'CO₂-Emissionen monatlich — Plan vs. Bestand',
    subtitle: 't CO₂ / Monat',
    barLabel: 'Bestand (Gaskessel)',
    lineLabel: 'Plan-Variante',
  });
  addChart(wb, ws, url, { col: 1, row: ws.rowCount + 3 }, { w: 760, h: 280 });
}

// ── Sheet 11: Variantenvergleich ─────────────────────────────────────
function buildSheetVarianten(wb, d) {
  const ws = wb.addWorksheet('11 Variantenvergleich', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const vrKeys = Object.keys(variantResults || {});
  if (vrKeys.length === 0) {
    ws.addRow(['Keine Varianten verfügbar — nur aktive Variante exportiert.']);
    return;
  }
  setColWidths(ws, [28, ...vrKeys.map(() => 18)]);
  const header = ws.addRow(['Kennwert', ...vrKeys.map(k => variantResults[k].label || k)]);
  styleHeader(header);

  const rows = [
    { label: 'Wärmebedarf MWh/a', getter: k => variantResults[k].gebäudebedarf || 0, fmt: 'num0' },
    { label: 'Erzeugung MWh/a',   getter: k => variantResults[k].erzeugung || 0,    fmt: 'num0' },
    { label: 'Netzverluste %',    getter: k => variantResults[k].netzverlustePct || 0, fmt: 'num1' },
    { label: 'EE-Anteil %',       getter: k => variantResults[k].eeAnteil || 0, fmt: 'num1' },
    { label: 'CO₂ t/a',           getter: k => variantResults[k].co2GesH || 0,   fmt: 'num1' },
    { label: 'Investition €',     getter: k => variantResults[k].investGes || 0,  fmt: 'euro' },
    { label: 'Jahreskosten €/a',  getter: k => variantResults[k].jkGes || 0,     fmt: 'euroPa' },
    { label: 'WGK ct/kWh',        getter: k => parseFloat(variantResults[k].wgkText) || 0, fmt: 'ctkwh' },
  ];
  rows.forEach((rdef, i) => {
    const r = ws.addRow([rdef.label, ...vrKeys.map(k => rdef.getter(k))]);
    styleDataRow(r, i % 2 === 1);
    for (let c = 2; c <= r.cellCount; c++) {
      if (rdef.fmt === 'num0') fmtNum0(r.getCell(c));
      else if (rdef.fmt === 'num1') fmtNum1(r.getCell(c));
      else if (rdef.fmt === 'euro') fmtEuro(r.getCell(c));
      else if (rdef.fmt === 'euroPa') fmtEuroPa(r.getCell(c));
      else if (rdef.fmt === 'ctkwh') fmtCtkwh(r.getCell(c));
    }
  });

  // WGK-Vergleich Chart
  const wgkItems = vrKeys.map(k => ({
    label: variantResults[k].label || k,
    value: parseFloat(variantResults[k].wgkText) || 0,
    color: k === activeVariantId ? COLORS.primary : COLORS.sage,
  })).filter(i => i.value > 0);
  if (wgkItems.length > 0) {
    const url = renderBars(wgkItems, {
      title: 'Wärmegestehungskosten je Variante',
      subtitle: 'ct/kWh · niedriger ist besser',
    });
    addChart(wb, ws, url, { col: 1, row: ws.rowCount + 3 }, { w: 480, h: 240 });
  }

  // CO2-Vergleich Chart
  const co2Items = vrKeys.map(k => ({
    label: variantResults[k].label || k,
    value: variantResults[k].co2GesH || 0,
    color: k === activeVariantId ? COLORS.primary : COLORS.rust,
  })).filter(i => i.value > 0);
  if (co2Items.length > 0) {
    const url = renderBars(co2Items, {
      title: 'CO₂-Emissionen je Variante',
      subtitle: 't/a · niedriger ist besser',
    });
    addChart(wb, ws, url, { col: 6, row: ws.rowCount + 3 - 12 }, { w: 480, h: 240 });
  }

  // Kostenarten-Stacked je Variante — Felder aus 01-globals-varianten cacheVariantResults
  const costItems = vrKeys.map(k => {
    const vr = variantResults[k];
    return {
      label: vr.label || k,
      highlight: k === activeVariantId,
      kgf:   (vr.kapitalJk  || 0) / 1000,
      bgk:   (vr.energieJk  || 0) / 1000,
      betr:  (vr.betriebJk  || 0) / 1000,
      sonst: ((vr.co2Jk || 0) - (vr.pvJk || 0)) / 1000,  // CO₂-Kosten positiv, PV-Erlös negativ
    };
  });
  if (costItems.some(c => c.kgf || c.bgk || c.betr || c.sonst)) {
    const url = renderStackedColumnPN(costItems, [
      { key: 'kgf',  color: COLORS.primary, label: 'KGF kapitalgeb.' },
      { key: 'bgk',  color: COLORS.sage,    label: 'BGK bedarfsgeb.' },
      { key: 'betr', color: COLORS.oak,     label: 'BetrGK betriebsgeb.' },
      { key: 'sonst', color: '#7ba087',     label: 'Sonst (Erlöse/Förd.)' },
    ], {
      title: 'Jahreskosten nach VDI-2067-Kostenarten',
      subtitle: 'T€/a · gestapelt · negative Werte = Erlöse',
    });
    addChart(wb, ws, url, { col: 1, row: ws.rowCount + 16 }, { w: 760, h: 340 });
  }
}

// ── Sheet 12: Annahmen ───────────────────────────────────────────────
function buildSheetAnnahmen(wb, d) {
  const ws = wb.addWorksheet('12 Annahmen', { views: [{ showGridLines: false }] });
  setColWidths(ws, [4, 30, 16, 12, 30]);

  ws.getCell('B2').value = 'Annahmen und Stammdaten';
  ws.getCell('B2').font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLORS.primaryFg } };
  let row = 4;

  function section(title, items) {
    ws.getCell(row, 2).value = title;
    ws.getCell(row, 2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLORS.primaryFg } };
    ws.getCell(row, 2).border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } };
    ws.mergeCells(row, 2, row, 5);
    row++;
    items.forEach(([k, v, u, src]) => {
      ws.getCell(row, 2).value = k;
      ws.getCell(row, 2).font = { name: 'Calibri', size: 10, color: { argb: 'FF666666' } };
      ws.getCell(row, 3).value = v;
      ws.getCell(row, 3).font = { name: 'Calibri', size: 10, bold: true };
      alignRight(ws.getCell(row, 3));
      ws.getCell(row, 4).value = u || '';
      ws.getCell(row, 4).font = { name: 'Calibri', size: 10, color: { argb: 'FF666666' } };
      if (src) {
        ws.getCell(row, 5).value = src;
        ws.getCell(row, 5).font = { name: 'Calibri', size: 10, color: { argb: 'FF888888' }, italic: true };
      }
      row++;
    });
    row++;
  }

  // Energiepreise
  const getPrice = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) : fallback;
  };
  section('12.1 Energiepreise', [
    ['Strompreis (Bezug)',       getPrice('preis-strom', 23.0), 'ct/kWh', 'aktuelle Tool-Eingabe'],
    ['Strompreis (Einspeisung PV)', getPrice('preis-eeg-pv', 8.2), 'ct/kWh', ''],
    ['Strompreis (Einspeisung KWK)', getPrice('preis-kwk', 8.4), 'ct/kWh', ''],
    ['Erdgaspreis',              getPrice('preis-gas', 8.1),    'ct/kWh', ''],
    ['Pellets',                  getPrice('preis-pellets', 7.2), 'ct/kWh', ''],
    ['Holzhackschnitzel',        getPrice('preis-hhs', 4.1),    'ct/kWh', ''],
  ]);

  section('12.2 Wirtschaftlichkeit (VDI 2067)', [
    ['Zinssatz (real)',          getPrice('wirt-zins', 3.0),       '%',     ''],
    ['Betrachtungszeitraum',     getPrice('wirt-zeitraum', 20),    'Jahre', ''],
    ['Preissteigerung Energie',  getPrice('wirt-pe', 2.5),         '%/a',   ''],
    ['Preissteigerung Wartung',  getPrice('wirt-pw', 2.0),         '%/a',   ''],
  ]);

  section('12.3 Emissionsfaktoren CO₂', [
    ['Erdgas',                   201, 'g/kWh', 'BEW 2026'],
    ['Heizöl',                   266, 'g/kWh', 'BEW 2026'],
    ['Pellets',                   23, 'g/kWh', 'BEW 2026'],
    ['Strom-Mix DE',             380, 'g/kWh', 'UBA 2025'],
    ['Solarthermie',               0, 'g/kWh', ''],
    ['Geothermie',                 0, 'g/kWh', ''],
  ]);

  section('12.4 Modell-Stammdaten', [
    ['Tool-Version',             'Energieplanung-Tool v2', '', ''],
    ['Modell-Datum',             new Date().toLocaleDateString('de-DE'), '', ''],
    ['Betrachtungsjahr',         globalYear || '—', '', ''],
    ['TABULA/IWU-Tabelle',       '2017, deutsche Wohngebäude-Typologie', '', ''],
    ['U-Werte',                  'EnEV/GEG 2024 nach Baujahresklasse', '', ''],
    ['Dispatch-Methode',         'Merit-Order', '', ''],
  ]);
}

// ══════════════════════════════════════════════════════════════════════
// HAUPT-EINSTIEG
// ══════════════════════════════════════════════════════════════════════
export async function exportXlsxWorkbook() {
  if (typeof ExcelJS === 'undefined') {
    alert('ExcelJS-Bibliothek nicht geladen. Bitte Seite neu laden und Internet-Verbindung prüfen.');
    return;
  }

  const btn = document.querySelector('[data-click="exportXlsxWorkbook()"]');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ Excel wird erzeugt...'; btn.disabled = true; }

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Energieplanung-Tool';
    wb.created = new Date();
    wb.lastModifiedBy = 'Energieplanung-Tool';

    const d = collectData();

    if (d.keys.length === 0 || d.totalMwh === 0) {
      alert('Keine Berechnungsergebnisse verfügbar.\n\nBitte zuerst Dispatch-Berechnung durchführen (Erzeuger aktivieren, Wärmebedarf berechnen lassen).');
      return;
    }

    buildSheetUebersicht(wb, d);
    buildSheetGebaeude(wb, d);
    buildSheetErzeuger(wb, d);
    buildSheetDispatch8760(wb, d);
    buildSheetDispatchAggregat(wb, d);
    buildSheetWaermenetz(wb, d);
    buildSheetStromnetz(wb, d);
    buildSheetStrombilanz(wb, d);
    buildSheetWirtschaft(wb, d);
    buildSheetCO2(wb, d);
    buildSheetVarianten(wb, d);
    buildSheetAnnahmen(wb, d);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const datum = new Date().toISOString().slice(0, 10);
    const variant = (d.variantName || 'Variante').replace(/[^a-z0-9_-]/gi, '_');
    a.download = `Energieplanung_${variant}_${datum}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error('Excel-Export-Fehler:', err);
    alert('Excel-Export fehlgeschlagen:\n\n' + err.message);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

// Auf window für inline-data-click-Handler exportieren
window.exportXlsxWorkbook = exportXlsxWorkbook;
