// ── 13f-sld.js — Einlinienschema (Single-Line Diagram) ──────────────────────

import { ASSETS, ASSET_CFG, TYPE_RANK, getAssetStatus, getAsset } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';
import { map } from './02b-gebaeude.js';

const SLD_LH = 120;   // px per rank level (vertical)
const SLD_CW = 110;   // min column width per node
const SLD_NW = 86;    // node box width
const SLD_NH = 54;    // node box height

const SLD_STATE = { zoom: 1.0, wasDrag: false };

// ── Toggle ────────────────────────────────────────────────────────────────────
export function sldToggle() {
  const panel = document.getElementById('sld-panel');
  const btn   = document.getElementById('btn-sld-toggle');
  if (!panel) return;
  if (panel.classList.contains('sld-fullscreen')) sldToggleFullscreen();
  const vis = panel.classList.toggle('visible');
  btn?.classList.toggle('active', vis);
  try { map.invalidateSize(); } catch(e) {}
  if (vis) { sldRender(); sldInitResize(); }
}

export function sldToggleFullscreen() {
  const panel = document.getElementById('sld-panel');
  const btn   = document.getElementById('btn-sld-fs');
  if (!panel) return;
  const fs = panel.classList.toggle('sld-fullscreen');
  if (btn) btn.classList.toggle('active', fs);
  if (fs) {
    if (!panel.classList.contains('visible')) panel.classList.add('visible');
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
  setTimeout(() => { try { map.invalidateSize(); } catch(e) {} sldRender(); }, 80);
}

export function sldZoom(delta) {
  if (delta === 0) { SLD_STATE.zoom = 1.0; }
  else { SLD_STATE.zoom = Math.min(3, Math.max(0.25, SLD_STATE.zoom + delta)); }
  const lbl = document.getElementById('sld-zoom-label');
  if (lbl) lbl.textContent = Math.round(SLD_STATE.zoom * 100) + '%';
  const wrap = document.getElementById('sld-canvas-wrap');
  if (!wrap) return;
  const svg = wrap.querySelector('svg#sld-svg');
  if (svg) {
    svg.style.transform = `scale(${SLD_STATE.zoom})`;
    svg.style.transformOrigin = 'top left';
    const vb = svg.getAttribute('viewBox')?.split(' ');
    if (vb) {
      svg.style.width  = parseFloat(vb[2]) * SLD_STATE.zoom + 'px';
      svg.style.height = parseFloat(vb[3]) * SLD_STATE.zoom + 'px';
    }
  }
}

// ── PDF Export ────────────────────────────────────────────────────────────────
export function sldExportPDF() {
  const yr = globalYear ?? new Date().getFullYear();
  const { activeA, activeL } = _getActive(yr);
  if (activeA.length === 0) { alert('Keine aktiven Elektroobjekte vorhanden.'); return; }
  const layout = _sldLayout(activeA, activeL);
  const { nodes, edges, W, H } = layout;
  const svgContent = _buildSvgRaw(nodes, edges, W, H, layout, yr);
  const today = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
  const legendRows = nodes.map(n => {
    const cfg = ASSET_CFG[n.type] || {};
    return `<tr>
      <td style="padding:3px 8px;border-bottom:.3pt solid #e8ecf0;">${cfg.icon||'·'} ${n.name}</td>
      <td style="padding:3px 8px;border-bottom:.3pt solid #e8ecf0;color:#546e7a;">${cfg.label||n.type}</td>
      <td style="padding:3px 8px;border-bottom:.3pt solid #e8ecf0;color:#546e7a;font-family:monospace;font-size:8pt;">${_spec(n)}</td>
    </tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>Einlinienschema – ${yr}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,sans-serif;background:#fff;color:#1a2535;}
  .page{width:297mm;min-height:210mm;padding:12mm 14mm;position:relative;}
  h1{font-size:18pt;font-weight:600;color:#006064;margin-bottom:3pt;}
  h3{font-size:9pt;font-weight:600;color:#37474f;margin:10pt 0 4pt;text-transform:uppercase;letter-spacing:.06em;}
  .meta{font-size:8pt;color:#90a4ae;margin-bottom:10pt;}
  .sld-wrap{border:1pt solid #cfd8dc;border-radius:4pt;overflow:hidden;margin-bottom:8pt;background:#0b0e18;}
  table{width:100%;border-collapse:collapse;font-size:9pt;}
  th{padding:4pt 8pt;text-align:left;font-size:7.5pt;color:#006064;text-transform:uppercase;background:#e0f7fa;border-bottom:1.5pt solid #00bcd4;font-weight:600;}
  .footer{position:absolute;bottom:8mm;left:14mm;right:14mm;font-size:7.5pt;color:#b0bec5;display:flex;justify-content:space-between;border-top:.4pt solid #eee;padding-top:3pt;}
  @page{size:A4 landscape;margin:0;}
  @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact;}}
</style></head><body>
<div class="page">
  <div style="border-left:4pt solid #00bcd4;padding-left:12pt;margin-bottom:10pt;">
    <h1>Einlinienschema (SLD)</h1>
    <div class="meta">Planungsjahr: <b>${yr}</b> · ${activeA.length} Komponenten · ${activeL.length} Leitungen · Erstellt: ${today}</div>
  </div>
  <div class="sld-wrap">
    <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto;max-height:130mm;" xmlns="http://www.w3.org/2000/svg">
      ${svgContent}
    </svg>
  </div>
  <h3>Komponentenverzeichnis</h3>
  <table><thead><tr><th>Bezeichnung</th><th>Typ</th><th>Kenndaten</th></tr></thead><tbody>${legendRows}</tbody></table>
  <div class="footer"><span>⚡ Einlinienschema · Jahr ${yr}</span><span>${today}</span></div>
</div></body></html>`;
  const win = window.open('', '_blank');
  if (!win) { alert('Popup blockiert.'); return; }
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => setTimeout(() => win.print(), 500));
}

// ── Resize handle ─────────────────────────────────────────────────────────────
function sldInitResize() {
  const handle = document.getElementById('sld-resize-handle');
  const panel  = document.getElementById('sld-panel');
  if (!handle || !panel || handle._sldResizeInit) return;
  handle._sldResizeInit = true;
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX; startW = panel.offsetWidth;
    const onMove = ev => {
      const w = Math.max(280, Math.min(window.innerWidth * 0.6, startW - (ev.clientX - startX)));
      panel.style.width = w + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { map.invalidateSize(); } catch(e) {}
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ── Pan & wheel-zoom ──────────────────────────────────────────────────────────
function sldInitPan() {
  const wrap = document.getElementById('sld-canvas-wrap');
  if (!wrap || wrap._sldPanInit) return;
  wrap._sldPanInit = true;
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const oldZ  = SLD_STATE.zoom;
    const newZ  = Math.min(3, Math.max(0.25, oldZ + delta));
    if (newZ === oldZ) return;
    const rect = wrap.getBoundingClientRect();
    const mxC  = e.clientX - rect.left + wrap.scrollLeft;
    const myC  = e.clientY - rect.top  + wrap.scrollTop;
    SLD_STATE.zoom = newZ;
    const lbl = document.getElementById('sld-zoom-label');
    if (lbl) lbl.textContent = Math.round(newZ * 100) + '%';
    const svg = wrap.querySelector('svg#sld-svg');
    if (svg) {
      svg.style.transform = `scale(${newZ})`;
      svg.style.transformOrigin = 'top left';
      const vb = svg.getAttribute('viewBox')?.split(' ');
      if (vb) {
        svg.style.width  = parseFloat(vb[2]) * newZ + 'px';
        svg.style.height = parseFloat(vb[3]) * newZ + 'px';
      }
    }
    wrap.scrollLeft = mxC * (newZ / oldZ) - (e.clientX - rect.left);
    wrap.scrollTop  = myC * (newZ / oldZ) - (e.clientY - rect.top);
  }, { passive: false });

  let dragging = false, sx, sy, ssl, sst;
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true; SLD_STATE.wasDrag = false;
    sx = e.clientX; sy = e.clientY;
    ssl = wrap.scrollLeft; sst = wrap.scrollTop;
    wrap.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) SLD_STATE.wasDrag = true;
    wrap.scrollLeft = ssl - dx;
    wrap.scrollTop  = sst - dy;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    wrap.style.cursor = '';
  });
}

// ── Main render ───────────────────────────────────────────────────────────────
export function sldRender() {
  const canvas = document.getElementById('sld-canvas');
  if (!canvas) return;
  const yr  = globalYear ?? new Date().getFullYear();
  const lbl = document.getElementById('sld-yr-label');
  if (lbl) lbl.textContent = yr;

  const { activeA, activeL } = _getActive(yr);
  if (activeA.length === 0) {
    canvas.className = 'sld-empty';
    canvas.innerHTML = '<span style="font-size:20px;">⚡</span><span>Keine aktiven Elektroobjekte</span>';
    return;
  }
  canvas.className = '';

  const layout = _sldLayout(activeA, activeL);
  const { nodes, edges, W, H } = layout;
  const z  = SLD_STATE.zoom;
  const sw = Math.round(W * z), sh = Math.round(H * z);
  const inner = _buildSvgRaw(nodes, edges, W, H, layout, yr);
  const svg = `<svg id="sld-svg" viewBox="0 0 ${W} ${H}" width="${sw}" height="${sh}"
    xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:DM Sans,sans-serif;">${inner}</svg>`;
  canvas.innerHTML = `<div onclick="sldClick(event)" style="line-height:0;min-width:${sw}px;min-height:${sh}px;">${svg}</div>`;
  sldInitPan();
}

export function sldRefresh() {
  if (document.getElementById('sld-panel')?.classList.contains('visible')) sldRender();
}

// ── Active assets & edges ─────────────────────────────────────────────────────
function _getActive(yr) {
  const activeA = ASSETS.items.filter(a =>
    (a.domain === 'strom' || a.domain === 'hybrid') &&
    getAssetStatus(a, yr) === 'active'
  );
  const activeIds = new Set(activeA.map(a => a.id));
  const activeL = (window.stromEdges || []).filter(e =>
    activeIds.has(e.u) && activeIds.has(e.v)
  );
  return { activeA, activeL };
}

// ── Layout engine ─────────────────────────────────────────────────────────────
function _sldLayout(activeA, activeL) {
  const assetMap = new Map(activeA.map(a => [a.id, a]));
  const PAD_TOP  = 50;

  const connectedIds = new Set();
  for (const e of activeL) {
    if (assetMap.has(e.u) && assetMap.has(e.v)) {
      connectedIds.add(e.u);
      connectedIds.add(e.v);
    }
  }
  const connectedA   = activeA.filter(a =>  connectedIds.has(a.id));
  const unconnectedA = activeA.filter(a => !connectedIds.has(a.id));

  const children  = new Map(activeA.map(a => [a.id, []]));
  const parentOf  = new Map();
  const ringEdges = new Set();

  // Pass 1: edges with different TYPE_RANK → clear hierarchy
  for (const e of activeL) {
    const a = assetMap.get(e.u), b = assetMap.get(e.v);
    if (!a || !b) continue;
    const rA = TYPE_RANK[a.type] ?? 6, rB = TYPE_RANK[b.type] ?? 6;
    if (rA === rB) continue;
    const [srcId, snkId] = rA < rB ? [e.u, e.v] : [e.v, e.u];
    if (!parentOf.has(snkId)) {
      parentOf.set(snkId, srcId);
      if (!children.get(srcId).includes(snkId)) children.get(srcId).push(snkId);
    } else {
      ringEdges.add(e.id);
    }
  }

  // Pass 2: same-rank edges → use established parenthood as direction guide
  for (const e of activeL) {
    const a = assetMap.get(e.u), b = assetMap.get(e.v);
    if (!a || !b) continue;
    const rA = TYPE_RANK[a.type] ?? 6, rB = TYPE_RANK[b.type] ?? 6;
    if (rA !== rB) continue;
    const aHasParent = parentOf.has(e.u);
    const bHasParent = parentOf.has(e.v);
    let srcId, snkId;
    if      ( aHasParent && !bHasParent) { srcId = e.u; snkId = e.v; }
    else if (!aHasParent &&  bHasParent) { srcId = e.v; snkId = e.u; }
    else { ringEdges.add(e.id); continue; }
    if (!parentOf.has(snkId)) {
      parentOf.set(snkId, srcId);
      if (!children.get(srcId).includes(snkId)) children.get(srcId).push(snkId);
    } else {
      ringEdges.add(e.id);
    }
  }

  // Effective rank: max(TYPE_RANK, parent_effectiveRank + 1) — handles UV→UV cascades
  const effRank = new Map();
  function getEffRank(id, seen = new Set()) {
    if (effRank.has(id)) return effRank.get(id);
    if (seen.has(id))    return TYPE_RANK[assetMap.get(id)?.type] ?? 4;
    seen.add(id);
    const base = TYPE_RANK[assetMap.get(id)?.type] ?? 4;
    const par  = parentOf.get(id);
    const eff  = par ? Math.max(base, getEffRank(par, seen) + 1) : base;
    effRank.set(id, eff);
    return eff;
  }
  for (const a of activeA) getEffRank(a.id);

  // Subtree width
  const stW = new Map();
  function subtreeWidth(id, vis = new Set()) {
    if (stW.has(id))  return stW.get(id);
    if (vis.has(id))  return SLD_CW;
    vis.add(id);
    const ch = children.get(id) || [];
    const w  = ch.length === 0
      ? SLD_CW
      : Math.max(SLD_CW, ch.reduce((s, c) => s + subtreeWidth(c, new Set(vis)), 0));
    stW.set(id, w);
    return w;
  }
  connectedA.forEach(a => subtreeWidth(a.id));

  // Place nodes
  const pos    = new Map();
  const placed = new Set();
  function place(id, cx) {
    if (placed.has(id)) return;
    placed.add(id);
    pos.set(id, { x: cx, y: PAD_TOP + getEffRank(id) * SLD_LH });
    const ch = (children.get(id) || []).filter(c => !placed.has(c));
    if (ch.length === 0) return;
    const total = ch.reduce((s, c) => s + subtreeWidth(c), 0);
    let x = cx - total / 2;
    for (const c of ch) {
      const cw = subtreeWidth(c);
      place(c, x + cw / 2);
      x += cw;
    }
  }

  const roots = connectedA.filter(a => !parentOf.has(a.id));
  if (roots.length === 0 && connectedA.length > 0) roots.push(connectedA[0]);
  let rx = SLD_CW / 2;
  for (const r of roots) { const rw = subtreeWidth(r.id); place(r.id, rx + rw / 2); rx += rw; }
  connectedA.forEach(a => {
    if (!pos.has(a.id)) {
      pos.set(a.id, { x: rx + SLD_CW / 2, y: PAD_TOP + getEffRank(a.id) * SLD_LH });
      placed.add(a.id);
      rx += SLD_CW;
    }
  });

  const treeH    = placed.size > 0 ? Math.max(...[...pos.values()].map(p => p.y)) + SLD_NH : PAD_TOP;
  const ORF_SEP  = 60;
  const orphanY  = treeH + ORF_SEP;
  let ox = SLD_CW / 2;
  unconnectedA.forEach(a => { pos.set(a.id, { x: ox, y: orphanY }); ox += SLD_CW; });

  const nodes = activeA.map(a => ({
    ...a,
    x: pos.get(a.id)?.x ?? 60,
    y: pos.get(a.id)?.y ?? orphanY,
    _orphan: !connectedIds.has(a.id),
  }));

  const edges = [];
  for (const e of activeL) {
    const pA = pos.get(e.u), pB = pos.get(e.v);
    if (!pA || !pB) continue;
    edges.push({ e, x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y, isRing: ringEdges.has(e.id) });
  }

  const xs  = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const PAD = 44;
  const W   = Math.max(360, Math.max(...xs) + SLD_NW / 2 + PAD);
  const H   = Math.max(240, Math.max(...ys) + SLD_NH + (unconnectedA.length > 0 ? 40 : PAD));
  const separatorY = unconnectedA.length > 0 ? treeH + ORF_SEP / 2 : null;

  return { nodes, edges, W, H, separatorY, orphanCount: unconnectedA.length };
}

// ── SVG content ───────────────────────────────────────────────────────────────
function _buildSvgRaw(nodes, edges, W, H, layoutExtra, yr) {
  const sel = ASSETS.selectedId;
  const { separatorY, orphanCount } = layoutExtra || {};
  let s = '';
  s += `<rect width="${W}" height="${H}" fill="#0b0e18"/>`;
  for (let gx = 0; gx < W; gx += 60) s += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#131825" stroke-width="1"/>`;
  for (let gy = 0; gy < H; gy += 60) s += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#131825" stroke-width="1"/>`;
  if (separatorY != null && orphanCount > 0) {
    s += `<line x1="12" y1="${separatorY}" x2="${W-12}" y2="${separatorY}" stroke="#2a3a4a" stroke-width="1" stroke-dasharray="6,4"/>`;
    s += `<text x="${W/2}" y="${separatorY-5}" text-anchor="middle" font-size="8" fill="#2a4a5a" font-family="DM Mono,monospace">nicht verbunden (${orphanCount})</text>`;
  }
  for (const ed of edges) s += _drawEdge(ed, W);
  for (const n  of nodes) s += _drawNode(n, n.id === sel);
  s += `<text x="8" y="${H-8}" font-size="8" fill="#1e2d40" font-family="DM Mono,monospace">Einlinienschema · Jahr ${yr ?? globalYear ?? 2024}</text>`;
  return s;
}

// ── Edge ──────────────────────────────────────────────────────────────────────
function _drawEdge({ e, x1, y1, x2, y2, isRing }, svgW) {
  const overload  = e.auslastungPct > 100;
  const warnDU    = !overload && e.deltaUPct > 5;
  const noteDU    = !overload && !warnDU && e.deltaUPct > 3;
  const strokeCol = overload ? '#ef5350' : warnDU ? '#ef5350' : noteDU ? '#f9a825' : isRing ? '#546e7a' : '#37474f';

  let path;
  const sameX = Math.abs(x1 - x2) < 4;

  if (isRing) {
    // Route left or right depending on which side has more space
    const loopOff = 34 + Math.abs(x1 - x2) * 0.18;
    const useLeft = x1 < (svgW || 600) / 2 && x2 < (svgW || 600) / 2;
    const lx = useLeft ? Math.min(x1, x2) - loopOff : Math.max(x1, x2) + loopOff;
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${lx.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${lx.toFixed(1)},${(y2+SLD_NH/2).toFixed(1)} L${x2.toFixed(1)},${(y2+SLD_NH/2).toFixed(1)}`;
  } else if (sameX) {
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${x2.toFixed(1)},${(y2-SLD_NH/2).toFixed(1)}`;
  } else {
    const midY = y1 + (y2 - y1) * 0.42;
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${x1.toFixed(1)},${midY.toFixed(1)} L${x2.toFixed(1)},${midY.toFixed(1)} L${x2.toFixed(1)},${(y2-SLD_NH/2).toFixed(1)}`;
  }

  const titleTxt = _edgeTitle(e).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let s = `<g data-edgeid="${e.id}" style="cursor:pointer;"><title>${titleTxt}</title>`;
  // Wide hit area
  s += `<path d="${path}" stroke="transparent" stroke-width="12" fill="none"/>`;
  s += `<path d="${path}" stroke="${strokeCol}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" ${isRing ? 'stroke-dasharray="10,5"' : ''} opacity="${isRing?0.55:0.9}"/>`;

  if (isRing) {
    const loopOff = 34 + Math.abs(x1 - x2) * 0.18;
    const useLeft = x1 < (svgW || 600) / 2 && x2 < (svgW || 600) / 2;
    const lx = useLeft ? Math.min(x1, x2) - loopOff : Math.max(x1, x2) + loopOff;
    const ly = (y1 + y2) / 2;
    s += `<rect x="${(lx-10).toFixed(1)}" y="${(ly-8).toFixed(1)}" width="32" height="13" rx="3" fill="#1a2535" stroke="#546e7a" stroke-width="1" pointer-events="none"/>`;
    s += `<text x="${(lx+6).toFixed(1)}" y="${(ly+2).toFixed(1)}" text-anchor="middle" font-size="7" fill="#78909c" pointer-events="none">Ring</text>`;
    return s + '</g>';
  }

  // Cable label
  const midY2  = sameX ? (y1 + y2) / 2 : y1 + (y2 - y1) * 0.42;
  const labelX = ((x1 + x2) / 2).toFixed(1);
  const labelY = (midY2 - 5).toFixed(1);
  const qs     = e.crossSection || 50;
  const lenM   = Math.round(e.lengthM || 0);
  const lTxt   = lenM > 0 ? `${qs} mm² · ${lenM} m` : `${qs} mm²`;
  s += `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="7.5" fill="${strokeCol}" opacity="0.8" pointer-events="none">${lTxt}</text>`;

  // Auslastungs-Pill
  if (e.auslastungPct >= 1) {
    const col = e.auslastungPct > 100 ? '#ef5350' : e.auslastungPct > 80 ? '#f9a825' : '#546e7a';
    const px  = ((x1 + x2) / 2 + 2).toFixed(1);
    const py  = (midY2 + 8).toFixed(1);
    const txt = `${e.auslastungPct.toFixed(0)}%`;
    const pw  = txt.length * 4.5 + 6;
    s += `<rect x="${(parseFloat(px)-pw/2).toFixed(1)}" y="${(parseFloat(py)-7).toFixed(1)}" width="${pw.toFixed(1)}" height="11" rx="3" fill="${col}22" stroke="${col}" stroke-width="0.8" pointer-events="none"/>`;
    s += `<text x="${px}" y="${(parseFloat(py)+2).toFixed(1)}" text-anchor="middle" font-size="7" font-weight="600" fill="${col}" pointer-events="none">${txt}</text>`;
  }

  return s + '</g>';
}

// ── Node ──────────────────────────────────────────────────────────────────────
function _drawNode(n, selected) {
  if (n.type === 'NSHV' || n.type === 'UV') return _drawBusbar(n, selected);
  const cfg = ASSET_CFG[n.type] || { color:'#607d8b', icon:'·', label:n.type };
  const col = cfg.color;
  const { x, y } = n;
  const rx = (x - SLD_NW/2).toFixed(1), ry = (y - SLD_NH/2).toFixed(1);

  let s = `<g data-assetid="${n.id}" style="cursor:pointer;">`;
  s += `<title>${_nodeTitle(n).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</title>`;
  // Wide hit area
  s += `<rect x="${(parseFloat(rx)-4).toFixed(1)}" y="${(parseFloat(ry)-4).toFixed(1)}" width="${SLD_NW+8}" height="${SLD_NH+8}" rx="9" fill="transparent"/>`;

  if (selected) s += `<rect x="${(parseFloat(rx)-3).toFixed(1)}" y="${(parseFloat(ry)-3).toFixed(1)}" width="${SLD_NW+6}" height="${SLD_NH+6}" rx="8" fill="${col}" opacity="0.18"/>`;

  const orphan = n._orphan;
  s += `<rect x="${rx}" y="${ry}" width="${SLD_NW}" height="${SLD_NH}" rx="5"
    fill="${selected ? col+'28' : orphan ? '#0d1018' : '#111a28'}"
    stroke="${orphan ? col+'55' : col}" stroke-width="${selected ? 2 : 1.5}"
    ${orphan ? 'stroke-dasharray="5,3"' : ''}/>`;

  s += _symbolShape(n.type, col, x, y);
  s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${col}" font-weight="500">${n.name}</text>`;

  const spec = _spec(n);
  if (spec) s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+23).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#546e7a">${spec}</text>`;

  const badge = _badge(n);
  if (badge.txt) {
    const bx = (x + SLD_NW/2 - 3).toFixed(1), by = (y - SLD_NH/2 - 3).toFixed(1);
    s += `<circle cx="${bx}" cy="${by}" r="8" fill="${badge.col}"/>`;
    s += `<text x="${bx}" y="${(parseFloat(by)+3.5).toFixed(1)}" text-anchor="middle" font-size="7" fill="#fff" font-weight="700">${badge.txt}</text>`;
  }

  const dU_V = _voltDrop(n.id);
  if (dU_V != null && n.type !== 'NAP' && n.type !== 'Schaltanlage') {
    const pct = (dU_V / 400) * 100;
    if (Math.abs(pct) >= 0.1) {
      const duCol  = Math.abs(pct) > 5 ? '#ef5350' : Math.abs(pct) > 3 ? '#f9a825' : '#66bb6a';
      const offset = spec ? 33 : 23;
      s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+offset).toFixed(1)}" text-anchor="middle" font-size="7" fill="${duCol}" pointer-events="none">ΔU ${pct.toFixed(1)}%</text>`;
    }
  }

  return s + '</g>';
}

// ── Busbar (NSHV / UV) ────────────────────────────────────────────────────────
function _drawBusbar(n, selected) {
  const cfg = ASSET_CFG[n.type];
  const col = cfg.color;
  const { x, y } = n;
  const bw = Math.max(SLD_NW, SLD_CW - 8), bh = 14;

  let s = `<g data-assetid="${n.id}" style="cursor:pointer;">`;
  s += `<title>${_nodeTitle(n).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</title>`;
  s += `<rect x="${(x-bw/2-4).toFixed(1)}" y="${(y-bh/2-4).toFixed(1)}" width="${bw+8}" height="${bh+8}" rx="5" fill="transparent"/>`;
  if (selected) s += `<rect x="${(x-bw/2-4).toFixed(1)}" y="${(y-bh/2-4).toFixed(1)}" width="${bw+8}" height="${bh+8}" rx="5" fill="${col}" opacity="0.15"/>`;
  s += `<rect x="${(x-bw/2).toFixed(1)}" y="${(y-bh/2).toFixed(1)}" width="${bw}" height="${bh}" rx="3" fill="${selected?col+'30':'#182435'}" stroke="${col}" stroke-width="${selected?2:1.8}"/>`;
  s += `<text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${col}" font-weight="600">${cfg.icon} ${n.name}</text>`;
  const spec = _spec(n);
  if (spec) s += `<text x="${x.toFixed(1)}" y="${(y+bh/2+11).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#546e7a">${spec}</text>`;
  return s + '</g>';
}

// ── IEC Symbol shapes ─────────────────────────────────────────────────────────
function _symbolShape(type, col, cx, cy) {
  const lw = 1.4;
  switch (type) {
    case 'NAP': {
      const pts = `${cx},${cy-14} ${cx-8},${cy-4} ${cx+8},${cy-4} ${cx},${cy+6} ${cx-8},${cy+16}`;
      return `<polyline points="${pts}" stroke="${col}" stroke-width="${lw}" fill="none" stroke-linejoin="round" pointer-events="none"/>
        <text x="${cx}" y="${cy+24}" text-anchor="middle" font-size="8" fill="${col}40" pointer-events="none">NAP</text>`;
    }
    case 'Schaltanlage':
      return `<rect x="${cx-14}" y="${cy-10}" width="28" height="20" rx="2" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <line x1="${cx-10}" y1="${cy-6}" x2="${cx+10}" y2="${cy+6}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx+10}" y1="${cy-6}" x2="${cx-10}" y2="${cy+6}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>
        <text x="${cx}" y="${cy+22}" text-anchor="middle" font-size="7" fill="${col}60" pointer-events="none">SA</text>`;
    case 'Trafo':
      return `<circle cx="${cx}" cy="${cy-9}" r="10" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <circle cx="${cx}" cy="${cy+9}" r="10" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+28}" text-anchor="middle" font-size="7" fill="${col}60" pointer-events="none">Tr</text>`;
    case 'Verbraucher':
      return `<circle cx="${cx}" cy="${cy}" r="14" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <line x1="${cx-9}" y1="${cy+9}" x2="${cx+9}" y2="${cy-9}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>`;
    case 'WP':
      return `<circle cx="${cx}" cy="${cy}" r="12" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <path d="M${cx-5},${cy+4} Q${cx},${cy-8} ${cx+5},${cy+4}" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>`;
    case 'PV':
      return `<rect x="${cx-13}" y="${cy-10}" width="26" height="20" rx="1" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <line x1="${cx-13}" y1="${cy}" x2="${cx+13}" y2="${cy}" stroke="${col}" stroke-width="${lw*0.7}" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx}" y2="${cy+10}" stroke="${col}" stroke-width="${lw*0.7}" pointer-events="none"/>`;
    case 'Batterie':
      return `<line x1="${cx-12}" y1="${cy}" x2="${cx+12}" y2="${cy}" stroke="${col}" stroke-width="2.5" pointer-events="none"/>
        <line x1="${cx-8}" y1="${cy-8}" x2="${cx-8}" y2="${cy+8}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-5}" x2="${cx}" y2="${cy+5}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx+8}" y1="${cy-8}" x2="${cx+8}" y2="${cy+8}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>`;
    case 'Lade':
      return `<circle cx="${cx}" cy="${cy}" r="12" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="13" fill="${col}" pointer-events="none">⚡</text>`;
    case 'Nsa':
      return `<circle cx="${cx}" cy="${cy}" r="12" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" font-weight="bold" fill="${col}" pointer-events="none">G</text>`;
    case 'KWK':
      return `<circle cx="${cx}" cy="${cy-2}" r="11" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+2}" text-anchor="middle" font-size="10" font-weight="bold" fill="${col}" pointer-events="none">G</text>
        <path d="M${cx+6},${cy-10} Q${cx+10},${cy-16} ${cx+7},${cy-20} Q${cx+12},${cy-15} ${cx+10},${cy-10}" stroke="${col}" stroke-width="${lw}" fill="none" pointer-events="none"/>`;
    case 'Wind': {
      return `<line x1="${cx}" y1="${cy-14}" x2="${cx}" y2="${cy+14}" stroke="${col}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx-10}" y2="${cy+2}" stroke="${col}" stroke-width="${lw}" stroke-linecap="round" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx+10}" y2="${cy+2}" stroke="${col}" stroke-width="${lw}" stroke-linecap="round" pointer-events="none"/>
        <circle cx="${cx}" cy="${cy-10}" r="2.5" fill="${col}" pointer-events="none"/>`;
    }
    default:
      return `<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" fill="${col}" pointer-events="none">${ASSET_CFG[type]?.icon || '·'}</text>`;
  }
}

// ── Spec string ───────────────────────────────────────────────────────────────
function _spec(a) {
  const p = a.props || {};
  switch (a.type) {
    case 'NAP':          return `${p.spannungKV||20} kV`;
    case 'Schaltanlage': return `${p.felder||6} Felder${p.trennstelle?' · TS':''}`;
    case 'Trafo':        return `${p.leistungKVA||630} kVA`;
    case 'NSHV': case 'UV': return `${p.nennstromA||400} A`;
    case 'Verbraucher':  return `${p.leistungKW||10} kW`;
    case 'WP':           return `${p.leistungKW||10} kW`;
    case 'PV':           return `${p.leistungKWp||10} kWp`;
    case 'Batterie':     return `${p.kapazitaetKWh||50} kWh`;
    case 'Lade':         return `${p.anzahlPunkte||4}×${p.leistungProPunktKW||22} kW`;
    case 'Nsa':          return `${p.leistungKW||100} kW`;
    case 'KWK':          return `${p.leistungElKW||100} kWel`;
    case 'Wind':         return `${p.leistungKW||500} kW`;
    default:             return '';
  }
}

// ── Result badge ──────────────────────────────────────────────────────────────
function _badge(n) {
  // Trafo: Auslastungs-Badge (% der Nennleistung)
  if (n.type === 'Trafo' && n._calcPeakLoadPct != null) {
    const pct = n._calcPeakLoadPct;
    if (pct >= 1) {
      const col = pct >= 100 ? '#ef5350' : pct >= 80 ? '#f9a825' : '#4caf50';
      return { txt: `${Math.round(pct)}%`, col };
    }
  }
  // Alle anderen: kumulativer Spannungsfall
  const dU_V = _voltDrop(n.id);
  if (dU_V == null) return { txt: null, col: '#546e7a' };
  const pct = (dU_V / 400) * 100;
  const col = Math.abs(pct) > 5 ? '#ef5350' : Math.abs(pct) > 3 ? '#f9a825' : '#4caf50';
  if (Math.abs(pct) >= 0.5) return { txt: `${Math.abs(pct).toFixed(1)}%`, col };
  return { txt: null, col: '#546e7a' };
}

function _voltDrop(id) {
  const sn = (window.stromNodes || []).find(n => n.id === id);
  return sn?._voltDropV ?? null;
}

// ── Tooltip text ──────────────────────────────────────────────────────────────
function _nodeTitle(n) {
  const p = n.props || {};
  const lines = [`${n.name}  [${ASSET_CFG[n.type]?.label || n.type}]`];
  switch (n.type) {
    case 'Trafo': {
      lines.push(`Leistung: ${p.leistungKVA||630} kVA  ·  UK: ${p.ukProzent||4} %`);
      if (n._calcPeakLoadKw != null) lines.push(`Last: ${n._calcPeakLoadKw.toFixed(1)} kW  ·  Auslastung: ${n._calcPeakLoadPct.toFixed(0)} %`);
      break;
    }
    case 'Schaltanlage': lines.push(`${p.felder||6} Felder  ·  ${p.nennstromA||630} A${p.trennstelle?'  ·  Trennstelle':''}`); break;
    case 'NSHV': case 'UV': lines.push(`${p.nennstromA||400} A  ·  ${p.abgaenge||4} Abgänge`); break;
    case 'Verbraucher': case 'WP': case 'Nsa': lines.push(`Leistung: ${p.leistungKW||10} kW`); break;
    case 'PV':      lines.push(`Leistung: ${p.leistungKWp||10} kWp`); break;
    case 'Lade':    lines.push(`${p.anzahlPunkte||4} × ${p.leistungProPunktKW||22} kW = ${(p.anzahlPunkte||4)*(p.leistungProPunktKW||22)} kW`); break;
    case 'Batterie': lines.push(`${p.leistungKW||25} kW  ·  ${p.kapazitaetKWh||50} kWh  ·  ${p.betriebsmodus||'einspeisung'}`); break;
    case 'KWK':     lines.push(`El: ${p.leistungElKW||100} kW  ·  Th: ${p.leistungThKW||160} kW  ·  ${p.brennstoff||'Erdgas'}`); break;
    case 'Wind':    lines.push(`${p.leistungKW||500} kW  ·  Nabenhöhe: ${p.nabenhoheM||100} m`); break;
  }
  const dU_V = _voltDrop(n.id);
  if (dU_V != null && n.type !== 'NAP') {
    const pct = (dU_V / 400) * 100;
    lines.push(`Spannung: ${(400-dU_V).toFixed(1)} V  (kum. ΔU ${pct.toFixed(2)} %)`);
  }
  return lines.join('\n');
}

function _edgeTitle(e) {
  const uA = ASSETS.items.find(a => a.id === e.u), vA = ASSETS.items.find(a => a.id === e.v);
  const lines = [`${uA?.name||e.u} → ${vA?.name||e.v}`];
  lines.push(`${e.crossSection||50} mm²  ·  ${e.cableType||'NAYY'}  ·  ${Math.round(e.lengthM||0)} m`);
  if (e.peakCurrentA)  lines.push(`Strom: ${e.peakCurrentA.toFixed(1)} A  /  Imax: ${e.ratedCurrentA.toFixed(0)} A`);
  if (e.auslastungPct) lines.push(`Auslastung: ${e.auslastungPct.toFixed(0)} %`);
  if (e.deltaUPct)     lines.push(`ΔU (Segment): ${e.deltaUPct.toFixed(2)} %`);
  if (e.peakFlowKw)    lines.push(`Leistungsfluss: ${e.peakFlowKw.toFixed(1)} kW  (${e.flowDirection >= 0 ? '↓ Last' : '↑ Einspeisung'})`);
  return lines.join('\n');
}

// ── Click → info bar ──────────────────────────────────────────────────────────
export function sldClick(event) {
  if (SLD_STATE.wasDrag) { SLD_STATE.wasDrag = false; return; }

  const gA = event.target.closest('[data-assetid]');
  if (gA) {
    const asset = getAsset(gA.dataset.assetid);
    if (asset) {
      ASSETS.selectedId = asset.id;
      _showNodeInfo(asset);
      sldRender();
    }
    return;
  }

  const gE = event.target.closest('[data-edgeid]');
  if (gE) {
    const edge = (window.stromEdges || []).find(e => e.id === gE.dataset.edgeid);
    if (edge) _showEdgeInfo(edge);
    return;
  }

  // Background click → deselect
  ASSETS.selectedId = null;
  _hideInfo();
  sldRender();
}

function _showNodeInfo(asset) {
  const bar     = document.getElementById('sld-info-bar');
  const content = document.getElementById('sld-info-content');
  if (!bar || !content) return;
  const cfg = ASSET_CFG[asset.type] || {};
  const p   = asset.props || {};

  let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:6px;">
    <span style="font-size:20px;line-height:1;">${cfg.icon||'⚡'}</span>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;font-size:12px;">${asset.name}</div>
      <div style="font-size:10px;color:var(--muted);">${cfg.label||asset.type} · ${asset.domain}</div>
    </div>
    <button data-click="sldInfoClose()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:15px;padding:0 2px;line-height:1;flex-shrink:0;">✕</button>
  </div>`;

  const rows = _propRows(asset);
  if (rows.length) {
    html += '<table style="width:100%;border-collapse:collapse;font-size:10px;">';
    for (const [lbl, val] of rows) {
      html += `<tr><td style="color:var(--muted);padding:2px 0;width:55%;">${lbl}</td><td style="font-family:DM Mono,monospace;color:var(--text);">${val}</td></tr>`;
    }
    html += '</table>';
  }

  const dU_V = _voltDrop(asset.id);
  if (dU_V != null && asset.type !== 'NAP') {
    const pct = (dU_V / 400) * 100;
    const col = Math.abs(pct) > 5 ? '#ef5350' : Math.abs(pct) > 3 ? '#f9a825' : '#4caf50';
    html += `<div style="margin-top:6px;padding:4px 6px;background:${col}18;border-left:3px solid ${col};border-radius:3px;font-size:10px;">
      <span style="color:var(--muted);">Spannung:</span>
      <span style="color:${col};font-family:DM Mono,monospace;margin-left:6px;">${(400-dU_V).toFixed(1)} V &nbsp;·&nbsp; ΔU ${Math.abs(pct).toFixed(2)} %</span>
    </div>`;
  }

  if (asset.baujahr || asset.abrissjahr) {
    html += `<div style="margin-top:4px;font-size:9px;color:var(--muted);">`;
    if (asset.baujahr)    html += `Baujahr ${asset.baujahr}`;
    if (asset.abrissjahr) html += ` · Abrissjahr ${asset.abrissjahr}`;
    html += '</div>';
  }

  content.innerHTML = html;
  bar.style.display = 'block';
}

function _showEdgeInfo(e) {
  const bar     = document.getElementById('sld-info-bar');
  const content = document.getElementById('sld-info-content');
  if (!bar || !content) return;
  const uA = ASSETS.items.find(a => a.id === e.u), vA = ASSETS.items.find(a => a.id === e.v);
  const col = e.auslastungPct > 100 ? '#ef5350' : e.auslastungPct > 80 ? '#f9a825' : '#80cbc4';

  let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:6px;">
    <span style="font-size:18px;">🔌</span>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;font-size:12px;">${uA?.name||'?'} → ${vA?.name||'?'}</div>
      <div style="font-size:10px;color:var(--muted);">${e.cableType||'NAYY'} · ${e.crossSection||50} mm²</div>
    </div>
    <button data-click="sldInfoClose()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:15px;padding:0 2px;line-height:1;flex-shrink:0;">✕</button>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:10px;">
    <tr><td style="color:var(--muted);padding:2px 0;width:55%;">Länge</td><td style="font-family:DM Mono,monospace;">${Math.round(e.lengthM||0)} m</td></tr>
    <tr><td style="color:var(--muted);padding:2px 0;">Querschnitt</td><td style="font-family:DM Mono,monospace;">${e.crossSection||50} mm²</td></tr>`;
  if (e.peakCurrentA)  html += `<tr><td style="color:var(--muted);padding:2px 0;">Strom / Imax</td><td style="font-family:DM Mono,monospace;">${e.peakCurrentA.toFixed(1)} A / ${e.ratedCurrentA.toFixed(0)} A</td></tr>`;
  if (e.auslastungPct) html += `<tr><td style="color:var(--muted);padding:2px 0;">Auslastung</td><td style="color:${col};font-family:DM Mono,monospace;">${e.auslastungPct.toFixed(0)} %</td></tr>`;
  if (e.deltaUPct)     html += `<tr><td style="color:var(--muted);padding:2px 0;">ΔU Segment</td><td style="font-family:DM Mono,monospace;">${e.deltaUPct.toFixed(2)} %</td></tr>`;
  if (e.peakFlowKw)    html += `<tr><td style="color:var(--muted);padding:2px 0;">Leistungsfluss</td><td style="font-family:DM Mono,monospace;">${e.peakFlowKw.toFixed(1)} kW</td></tr>`;
  html += '</table>';

  content.innerHTML = html;
  bar.style.display = 'block';
}

function _hideInfo() {
  const bar = document.getElementById('sld-info-bar');
  if (bar) bar.style.display = 'none';
}

export function sldInfoClose() {
  ASSETS.selectedId = null;
  _hideInfo();
  sldRender();
}

// ── Props table rows ──────────────────────────────────────────────────────────
function _propRows(asset) {
  const p = asset.props || {};
  switch (asset.type) {
    case 'NAP':          return [['Nennspannung', `${p.spannungKV||20} kV`]];
    case 'Schaltanlage': return [['Felder', p.felder||6], ['Nennstrom', `${p.nennstromA||630} A`], ['Trennstelle', p.trennstelle?'Ja':'Nein']];
    case 'Trafo':        return [['Leistung', `${p.leistungKVA||630} kVA`], ['UK', `${p.ukProzent||4} %`]];
    case 'NSHV': case 'UV': return [['Nennstrom', `${p.nennstromA||400} A`], ['Abgänge', p.abgaenge||4]];
    case 'Verbraucher':  return [['Leistung', `${p.leistungKW||10} kW`]];
    case 'WP':           return [['Leistung', `${p.leistungKW||10} kW`]];
    case 'PV':           return [['Leistung', `${p.leistungKWp||10} kWp`]];
    case 'Batterie':     return [['Kapazität', `${p.kapazitaetKWh||50} kWh`], ['Leistung', `${p.leistungKW||25} kW`], ['Modus', p.betriebsmodus||'einspeisung']];
    case 'Lade':         return [['Ladepunkte', p.anzahlPunkte||4], ['kW / Punkt', `${p.leistungProPunktKW||22} kW`], ['Gesamt', `${(p.anzahlPunkte||4)*(p.leistungProPunktKW||22)} kW`]];
    case 'Nsa':          return [['Leistung', `${p.leistungKW||100} kW`], ['Autonomie', `${p.autonomieH||8} h`], ['Kraftstoff', p.kraftstoff||'Diesel']];
    case 'KWK':          return [['El. Leistung', `${p.leistungElKW||100} kW`], ['Th. Leistung', `${p.leistungThKW||160} kW`], ['El. Wirkungsgrad', `${p.wirkungsgradEl||35} %`], ['Brennstoff', p.brennstoff||'Erdgas']];
    case 'Wind':         return [['Nennleistung', `${p.leistungKW||500} kW`], ['Nabenhöhe', `${p.nabenhoheM||100} m`], ['Rotordurchmesser', `${p.rotordurchmesserM||60} m`]];
    default:             return [];
  }
}

// ── Window bridge ─────────────────────────────────────────────────────────────
setTimeout(() => {
  window.sldToggle           = sldToggle;
  window.sldToggleFullscreen = sldToggleFullscreen;
  window.sldZoom             = sldZoom;
  window.sldExportPDF        = sldExportPDF;
  window.sldRefresh          = sldRefresh;
  window.sldClick            = sldClick;
  window.sldInfoClose        = sldInfoClose;
}, 0);
