// ── 15d-stromnetz-sld.js — Single-Line-Diagram (Einlinienschema) ────────────
// Portiert aus Standalone-Elektroteil (~10665–11500).
// Reine Render-Logik — KEINE UI-Verdrahtung (Toggle-Panel, Fullscreen, PDF,
// Pan/Zoom, Click-Handler kommen mit Phase 3.8 oder eigener UI-Phase).
//
// Verwendung:
//   const svg = buildSldSvg();   // SVG-String aus aktuellen ASSETS/Leitungen
//   document.body.insertAdjacentHTML('beforeend',
//     `<div style="position:fixed;top:50px;right:50px;width:600px;height:600px;
//       background:#0b0e18;overflow:auto;z-index:9999;">${svg}</div>`);

import { globalYear } from './01-globals-varianten.js';
import { ASSETS, ASSET_CFG, getAssetStatus, TYPE_RANK } from './13a-assets-core.js';
import { STROMNETZ } from './14b-stromnetz-state.js';
import { getMergedAssets, getMergedStromLeitungen } from './15e-stromnetz-szenarien.js';

// ── Layout-Konstanten ───────────────────────────────────────────────────────
const SLD_LH = 120;   // Vertikalabstand zwischen Ebenen [px]
const SLD_CW = 110;   // Mindestspaltenbreite pro Knoten [px]
const SLD_NW = 86;    // Knoten-Box-Breite [px]
const SLD_NH = 54;    // Knoten-Box-Höhe [px]

// ── Public State (für spätere Zoom-UI) ──────────────────────────────────────
export const SLD_STATE = { zoom: 1.0, wasDrag: false };

// ════════════════════════════════════════════════════════════════════════════
// LAYOUT-ENGINE
// ════════════════════════════════════════════════════════════════════════════
export function sldLayout(activeA, activeL) {
  const assetMap = new Map(activeA.map(a => [a.id, a]));
  const PAD_TOP  = 50;

  // 1. Verbundene vs. isolierte Knoten
  const connectedIds = new Set();
  for (const lt of activeL) {
    if (assetMap.has(lt.aId) && assetMap.has(lt.bId)) {
      connectedIds.add(lt.aId);
      connectedIds.add(lt.bId);
    }
  }
  const connectedA   = activeA.filter(a =>  connectedIds.has(a.id));
  const unconnectedA = activeA.filter(a => !connectedIds.has(a.id));

  // 2. Gerichteter Baum: nur Edges mit unterschiedlichem Rang sind Baum-Kanten.
  //    Same-Rank-Edges (z.B. SA↔SA Ring) sind immer Ring-Edges.
  const children  = new Map(activeA.map(a => [a.id, []]));
  const parentOf  = new Map();
  const ringEdges = new Set();

  for (const lt of activeL) {
    const a = assetMap.get(lt.aId), b = assetMap.get(lt.bId);
    if (!a || !b) continue;
    const rA = TYPE_RANK[a.type] ?? 6;
    const rB = TYPE_RANK[b.type] ?? 6;
    if (rA === rB) { ringEdges.add(lt.id); continue; }
    const [srcId, snkId] = rA < rB ? [lt.aId, lt.bId] : [lt.bId, lt.aId];
    if (!parentOf.has(snkId)) {
      parentOf.set(snkId, srcId);
      if (!children.get(srcId).includes(snkId)) children.get(srcId).push(snkId);
    } else {
      ringEdges.add(lt.id);  // Ring-Schluss
    }
  }

  // 3. Subtree-Breiten (rekursiv mit Zykel-Schutz)
  const stW = new Map();
  function subtreeWidth(id, vis = new Set()) {
    if (stW.has(id)) return stW.get(id);
    if (vis.has(id)) return SLD_CW;
    vis.add(id);
    const ch = children.get(id) || [];
    const w = ch.length === 0
      ? SLD_CW
      : Math.max(SLD_CW, ch.reduce((s, c) => s + subtreeWidth(c, new Set(vis)), 0));
    stW.set(id, w);
    return w;
  }
  connectedA.forEach(a => subtreeWidth(a.id));

  // 4. Knoten platzieren — Y nach TYPE_RANK fix, X aus Subtree-Spread
  const pos    = new Map();
  const placed = new Set();

  function place(id, cx) {
    if (placed.has(id)) return;
    placed.add(id);
    const rank = TYPE_RANK[assetMap.get(id)?.type] ?? 4;
    pos.set(id, { x: cx, y: PAD_TOP + rank * SLD_LH });
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
  for (const r of roots) {
    const rw = subtreeWidth(r.id);
    place(r.id, rx + rw / 2);
    rx += rw;
  }
  // Disconnected Sub-Graphen
  connectedA.forEach(a => {
    if (!pos.has(a.id)) {
      const rank = TYPE_RANK[a.type] ?? 4;
      pos.set(a.id, { x: rx + SLD_CW / 2, y: PAD_TOP + rank * SLD_LH });
      placed.add(a.id);
      rx += SLD_CW;
    }
  });

  // 5. Isolierte Knoten in separater Reihe unten
  const treeH = placed.size > 0
    ? Math.max(...[...pos.values()].map(p => p.y)) + SLD_NH
    : PAD_TOP;
  const ORPHAN_SEP = 60;
  const orphanY    = treeH + ORPHAN_SEP;
  let ox = SLD_CW / 2;
  unconnectedA.forEach(a => {
    pos.set(a.id, { x: ox, y: orphanY });
    ox += SLD_CW;
  });

  // 6. Ausgabe-Arrays
  const nodes = activeA.map(a => ({
    ...a,
    x: pos.get(a.id)?.x ?? 60,
    y: pos.get(a.id)?.y ?? orphanY,
    _orphan: !connectedIds.has(a.id),
  }));

  const edges = [];
  for (const lt of activeL) {
    const pA = pos.get(lt.aId), pB = pos.get(lt.bId);
    if (!pA || !pB) continue;
    edges.push({
      lt, x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y,
      er: STROMNETZ.calcResult?.edges?.[lt.id] || null,
      isRing: ringEdges.has(lt.id),
    });
  }

  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const PAD = 44;
  const W = Math.max(360, Math.max(...xs) + SLD_NW / 2 + PAD);
  const H = Math.max(240, Math.max(...ys) + SLD_NH + (unconnectedA.length > 0 ? 40 : PAD));
  const separatorY = unconnectedA.length > 0 ? treeH + ORPHAN_SEP / 2 : null;

  return { nodes, edges, W, H, separatorY, orphanCount: unconnectedA.length };
}

// ════════════════════════════════════════════════════════════════════════════
// SVG-BUILDER
// ════════════════════════════════════════════════════════════════════════════
export function sldBuildSvgRaw(nodes, edges, W, H, layoutExtra) {
  const sel = ASSETS.selectedId;
  const { separatorY, orphanCount } = layoutExtra || {};
  let s = '';
  s += `<rect width="${W}" height="${H}" fill="#0b0e18"/>`;
  for (let gx = 0; gx < W; gx += 60) s += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#131825" stroke-width="1"/>`;
  for (let gy = 0; gy < H; gy += 60) s += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#131825" stroke-width="1"/>`;

  if (separatorY != null && orphanCount > 0) {
    s += `<line x1="12" y1="${separatorY}" x2="${W-12}" y2="${separatorY}"
      stroke="#2a3a4a" stroke-width="1" stroke-dasharray="6,4"/>`;
    s += `<text x="${W/2}" y="${separatorY - 5}" text-anchor="middle"
      font-size="8" fill="#2a4a5a" font-family="DM Mono,monospace">nicht verbunden (${orphanCount})</text>`;
  }

  for (const e of edges) s += sldEdge(e);
  for (const n of nodes) s += sldNode(n, n.id === sel);
  s += `<text x="8" y="${H-8}" font-size="8" fill="#1e2d40" font-family="DM Mono,monospace">Einlinienschema · Jahr ${globalYear || new Date().getFullYear()}</text>`;
  return s;
}

export function sldBuildSvg(nodes, edges, W, H, layoutExtra) {
  const z = SLD_STATE.zoom;
  const sw = Math.round(W * z);
  const sh = Math.round(H * z);
  const inner = sldBuildSvgRaw(nodes, edges, W, H, layoutExtra);
  return `<svg id="sld-svg" viewBox="0 0 ${W} ${H}" width="${sw}" height="${sh}"
    xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:DM Sans,sans-serif;">${inner}</svg>`;
}

// ── Convenience: aus aktuellem State direkt SVG generieren ──────────────────
export function buildSldSvg() {
  const yr = globalYear || new Date().getFullYear();
  // Merged: Bestand + aktives Szenario-Delta
  const activeA = getMergedAssets().filter(a => getAssetStatus(a, yr) === 'active');
  const activeL = getMergedStromLeitungen().filter(l => getAssetStatus(l, yr) === 'active');
  if (activeA.length === 0) {
    return `<div style="padding:40px;text-align:center;color:#546e7a;">⚡<br>Keine aktiven Elektroobjekte</div>`;
  }
  const layout = sldLayout(activeA, activeL);
  return sldBuildSvg(layout.nodes, layout.edges, layout.W, layout.H, layout);
}

// ════════════════════════════════════════════════════════════════════════════
// EDGE / NODE / BUSBAR DRAWING
// ════════════════════════════════════════════════════════════════════════════
function sldEdge({ lt, x1, y1, x2, y2, er, isRing }) {
  const isMS = er?.isMS;
  const overload = er && er.ausl_pct > 100;
  const warnDU   = er && !overload && (er.dU_cum_pct ?? er.dU_pct) > 5;
  const noteDU   = er && !overload && !warnDU && (er.dU_cum_pct ?? er.dU_pct) > 3;

  const strokeCol = overload ? '#ef5350' : warnDU ? '#ef5350' : noteDU ? '#f9a825'
                  : isMS ? '#f9a825' : isRing ? '#546e7a' : '#37474f';
  const strokeW   = isMS ? 2.5 : 2;
  const dash = isRing ? '10,5' : isMS ? '8,4' : '';

  let path;
  const sameX = Math.abs(x1 - x2) < 4;
  if (isRing) {
    const loopOffset = 32 + Math.abs(x1 - x2) * 0.15;
    const lx = Math.max(x1, x2) + loopOffset;
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)}`
         + ` L${lx.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)}`
         + ` L${lx.toFixed(1)},${(y2+SLD_NH/2).toFixed(1)}`
         + ` L${x2.toFixed(1)},${(y2+SLD_NH/2).toFixed(1)}`;
  } else if (sameX) {
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${x2.toFixed(1)},${(y2-SLD_NH/2).toFixed(1)}`;
  } else {
    const midY = y1 + (y2 - y1) * 0.42;
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${x1.toFixed(1)},${midY.toFixed(1)} L${x2.toFixed(1)},${midY.toFixed(1)} L${x2.toFixed(1)},${(y2-SLD_NH/2).toFixed(1)}`;
  }

  const titleTxt = sldEdgeTitle(lt, er).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let s = `<g data-ltid="${lt.id}" style="cursor:pointer;"><title>${titleTxt}</title>`;
  s += `<path d="${path}" stroke="${strokeCol}" stroke-width="${strokeW}" fill="none"
    stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''}
    opacity="${isRing ? 0.5 : 0.85}"/>`;

  if (isRing) {
    const lx = Math.max(x1, x2) + 32 + Math.abs(x1 - x2) * 0.15;
    const ly = (y1 + y2) / 2;
    s += `<rect x="${(lx+3).toFixed(1)}" y="${(ly-8).toFixed(1)}" width="24" height="13" rx="3"
      fill="#1a2535" stroke="#546e7a" stroke-width="1" pointer-events="none"/>`;
    s += `<text x="${(lx+15).toFixed(1)}" y="${(ly+2).toFixed(1)}" text-anchor="middle"
      font-size="7" fill="#78909c" pointer-events="none">Ring</text>`;
    return s + `</g>`;
  }

  // Kabel-Label mid-path
  const midY2 = sameX ? (y1 + y2) / 2 : y1 + (y2 - y1) * 0.42;
  const labelX = ((x1 + x2) / 2).toFixed(1);
  const labelY = (midY2 - 5).toFixed(1);
  const qs = lt.qs || 50;
  const lenM = Math.round(lt._result?.laengeM || 0);
  const labelTxt = lenM > 0 ? `${qs} mm² · ${lenM} m` : `${qs} mm²`;
  s += `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="7.5"
    fill="${strokeCol}" opacity="0.8" pointer-events="none">${labelTxt}</text>`;

  // Auslastungs-Pill
  if (er && er.ausl_pct != null && er.ausl_pct >= 1) {
    const auslCol = er.ausl_pct > 100 ? '#ef5350' : er.ausl_pct > 80 ? '#f9a825' : '#546e7a';
    const px = ((x1 + x2) / 2 + 2).toFixed(1);
    const py = (midY2 + 8).toFixed(1);
    const txt = `${er.ausl_pct.toFixed(0)}%`;
    const pw = txt.length * 4.5 + 6;
    s += `<rect x="${(parseFloat(px) - pw/2).toFixed(1)}" y="${(parseFloat(py) - 7).toFixed(1)}"
      width="${pw.toFixed(1)}" height="11" rx="3"
      fill="${auslCol}22" stroke="${auslCol}" stroke-width="0.8" pointer-events="none"/>`;
    s += `<text x="${px}" y="${(parseFloat(py) + 2).toFixed(1)}" text-anchor="middle"
      font-size="7" font-weight="600" fill="${auslCol}" pointer-events="none">${txt}</text>`;
  }

  // Sicherungs-Symbol
  if (lt.sicherungA) {
    const fx = parseFloat(labelX), fy = midY2;
    s += `<rect x="${(fx-8).toFixed(1)}" y="${(fy-6).toFixed(1)}" width="16" height="11" rx="2"
      fill="#1a2535" stroke="${strokeCol}" stroke-width="1" pointer-events="none"/>`;
    s += `<text x="${fx.toFixed(1)}" y="${(fy+2.5).toFixed(1)}" text-anchor="middle" font-size="6.5"
      fill="${strokeCol}" pointer-events="none">${lt.sicherungA}A</text>`;
  }

  return s + `</g>`;
}

function sldNode(n, selected) {
  const cfg = ASSET_CFG[n.type] || { color: '#607d8b', icon: '·', label: n.type };
  const col = cfg.color;
  const { x, y } = n;

  if (n.type === 'NSHV' || n.type === 'UV') return sldBusbar(n, selected);

  const rx = (x - SLD_NW/2).toFixed(1);
  const ry = (y - SLD_NH/2).toFixed(1);

  let s = `<g data-assetid="${n.id}" style="cursor:pointer;">`;
  s += `<title>${sldNodeTitle(n).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>`;

  if (selected) {
    s += `<rect x="${(parseFloat(rx)-3).toFixed(1)}" y="${(parseFloat(ry)-3).toFixed(1)}"
      width="${SLD_NW+6}" height="${SLD_NH+6}" rx="8" fill="${col}" opacity="0.18"/>`;
  }

  const orphan = n._orphan;
  s += `<rect x="${rx}" y="${ry}" width="${SLD_NW}" height="${SLD_NH}" rx="5"
    fill="${selected ? col+'28' : orphan ? '#0d1018' : '#111a28'}"
    stroke="${orphan ? col+'55' : col}" stroke-width="${selected ? 2 : 1.5}"
    ${orphan ? 'stroke-dasharray="5,3"' : ''}/>`;

  s += sldSymbolShape(n.type, col, x, y);

  s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+13).toFixed(1)}" text-anchor="middle"
    font-size="9" fill="${col}" font-weight="500">${n.name}</text>`;

  const spec = sldSpec(n);
  if (spec) {
    s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+23).toFixed(1)}" text-anchor="middle"
      font-size="7.5" fill="#546e7a">${spec}</text>`;
  }

  const badge = sldBadge(n);
  if (badge.txt) {
    const bx = (x + SLD_NW/2 - 3).toFixed(1);
    const by = (y - SLD_NH/2 - 3).toFixed(1);
    s += `<circle cx="${bx}" cy="${by}" r="8" fill="${badge.col}"/>`;
    s += `<text x="${bx}" y="${(parseFloat(by)+3.5).toFixed(1)}" text-anchor="middle"
      font-size="7" fill="#fff" font-weight="700">${badge.txt}</text>`;
  }

  const nvd = STROMNETZ.calcResult?.nodeVoltDrop;
  if (nvd && nvd[n.id] != null && n.type !== 'NAP' && n.type !== 'Schaltanlage') {
    const dU_V   = nvd[n.id];
    const dU_pct = (dU_V / 400) * 100;
    const duCol  = Math.abs(dU_pct) > 5 ? '#ef5350' : Math.abs(dU_pct) > 3 ? '#f9a825' : '#66bb6a';
    const specOff = spec ? 33 : 23;
    s += `<text x="${x.toFixed(1)}" y="${(y + SLD_NH/2 + specOff).toFixed(1)}" text-anchor="middle"
      font-size="7" fill="${duCol}" pointer-events="none">ΔU ${dU_pct.toFixed(1)}%</text>`;
  }

  return s + `</g>`;
}

function sldBusbar(n, selected) {
  const cfg = ASSET_CFG[n.type];
  const col = cfg.color;
  const { x, y } = n;
  const bw = Math.max(SLD_NW, SLD_CW - 8);
  const bh = 14;

  let s = `<g data-assetid="${n.id}" style="cursor:pointer;">`;
  s += `<title>${sldNodeTitle(n).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>`;

  if (selected) {
    s += `<rect x="${(x-bw/2-4).toFixed(1)}" y="${(y-bh/2-4).toFixed(1)}"
      width="${bw+8}" height="${bh+8}" rx="5" fill="${col}" opacity="0.15"/>`;
  }
  s += `<rect x="${(x-bw/2).toFixed(1)}" y="${(y-bh/2).toFixed(1)}"
    width="${bw}" height="${bh}" rx="3"
    fill="${selected ? col+'30' : '#182435'}" stroke="${col}" stroke-width="${selected ? 2 : 1.8}"/>`;

  s += `<text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle"
    font-size="9" fill="${col}" font-weight="600">${cfg.icon} ${n.name}</text>`;

  const spec = sldSpec(n);
  if (spec) {
    s += `<text x="${x.toFixed(1)}" y="${(y+bh/2+11).toFixed(1)}" text-anchor="middle"
      font-size="7.5" fill="#546e7a">${spec}</text>`;
  }

  const badge = sldBadge(n);
  if (badge.txt) {
    const bx = (x + bw/2 - 2).toFixed(1);
    const by = (y - bh/2 - 2).toFixed(1);
    s += `<circle cx="${bx}" cy="${by}" r="8" fill="${badge.col}"/>`;
    s += `<text x="${bx}" y="${(parseFloat(by)+3.5).toFixed(1)}" text-anchor="middle"
      font-size="7" fill="#fff" font-weight="700">${badge.txt}</text>`;
  }

  return s + `</g>`;
}

// ════════════════════════════════════════════════════════════════════════════
// IEC-SYMBOLE
// ════════════════════════════════════════════════════════════════════════════
function sldSymbolShape(type, col, cx, cy) {
  const lc = col, lw = 1.4;
  switch (type) {
    case 'NAP': {
      const pts = `${cx},${cy-14} ${cx-8},${cy-4} ${cx+8},${cy-4} ${cx},${cy+6} ${cx-8},${cy+16}`;
      return `<polyline points="${pts}" stroke="${lc}" stroke-width="${lw}" fill="none" stroke-linejoin="round" pointer-events="none"/>
        <text x="${cx}" y="${cy+24}" text-anchor="middle" font-size="8" fill="${col}40">NAP</text>`;
    }
    case 'Schaltanlage':
      return `<rect x="${cx-14}" y="${cy-10}" width="28" height="20" rx="2" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <line x1="${cx-10}" y1="${cy-6}" x2="${cx+10}" y2="${cy+6}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx+10}" y1="${cy-6}" x2="${cx-10}" y2="${cy+6}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>
        <text x="${cx}" y="${cy+22}" text-anchor="middle" font-size="7" fill="${col}60" pointer-events="none">SA</text>`;
    case 'Trafo':
      return `<circle cx="${cx}" cy="${cy-9}" r="10" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <circle cx="${cx}" cy="${cy+9}" r="10" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+28}" text-anchor="middle" font-size="7" fill="${col}60" pointer-events="none">Tr</text>`;
    case 'Verbraucher':
      return `<circle cx="${cx}" cy="${cy}" r="14" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <line x1="${(cx-9).toFixed(1)}" y1="${(cy+9).toFixed(1)}" x2="${(cx+9).toFixed(1)}" y2="${(cy-9).toFixed(1)}"
          stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>`;
    case 'WP':
      return `<circle cx="${cx}" cy="${cy}" r="12" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <path d="M${cx-5},${cy+4} Q${cx},${cy-8} ${cx+5},${cy+4}" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>`;
    case 'PV':
      return `<rect x="${cx-13}" y="${cy-10}" width="26" height="20" rx="1" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <line x1="${cx-13}" y1="${cy}" x2="${cx+13}" y2="${cy}" stroke="${lc}" stroke-width="${lw*0.7}" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx}" y2="${cy+10}" stroke="${lc}" stroke-width="${lw*0.7}" pointer-events="none"/>`;
    case 'Batterie':
      return `<line x1="${cx-12}" y1="${cy}" x2="${cx+12}" y2="${cy}" stroke="${lc}" stroke-width="2.5" pointer-events="none"/>
        <line x1="${cx-8}" y1="${cy-8}" x2="${cx-8}" y2="${cy+8}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-5}" x2="${cx}" y2="${cy+5}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx+8}" y1="${cy-8}" x2="${cx+8}" y2="${cy+8}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>`;
    case 'Lade':
      return `<circle cx="${cx}" cy="${cy}" r="12" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="13" fill="${col}" pointer-events="none">⚡</text>`;
    case 'UV':
      return `<rect x="${cx-10}" y="${cy-8}" width="20" height="16" rx="2" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>`;
    case 'Nsa':
      return `<circle cx="${cx}" cy="${cy}" r="12" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" font-weight="bold" fill="${col}" pointer-events="none">G</text>`;
    case 'KWK':
      return `<circle cx="${cx}" cy="${cy-2}" r="11" stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>
        <text x="${cx}" y="${cy+2}" text-anchor="middle" font-size="10" font-weight="bold" fill="${col}" pointer-events="none">G</text>
        <path d="M${cx+6},${cy-10} Q${cx+10},${cy-16} ${cx+7},${cy-20} Q${cx+12},${cy-15} ${cx+10},${cy-10}"
          stroke="${lc}" stroke-width="${lw}" fill="none" pointer-events="none"/>`;
    case 'Wind':
      return `<line x1="${cx}" y1="${cy-14}" x2="${cx}" y2="${cy+14}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx-10}" y2="${cy+2}" stroke="${lc}" stroke-width="${lw}" stroke-linecap="round" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx+10}" y2="${cy+2}" stroke="${lc}" stroke-width="${lw}" stroke-linecap="round" pointer-events="none"/>
        <line x1="${cx}" y1="${cy-10}" x2="${cx}" y2="${cy-14}" stroke="${lc}" stroke-width="${lw}" pointer-events="none"/>
        <circle cx="${cx}" cy="${cy-10}" r="2.5" fill="${col}" pointer-events="none"/>`;
    default:
      return `<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" fill="${col}" pointer-events="none">${ASSET_CFG[type]?.icon || '·'}</text>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════
export function sldSpec(a) {
  const p = a.props || {};
  switch (a.type) {
    case 'NAP':          return `${p.spannungKV || 20} kV`;
    case 'Schaltanlage': return `${p.felder || 6} Felder${p.trennstelle ? ' TS' : ''}`;
    case 'Trafo':        return `${p.leistungKVA || 630} kVA`;
    case 'NSHV':
    case 'UV':           return `${p.nennstromA || 400} A`;
    case 'Verbraucher':  return `${p.leistungKW || 10} kW`;
    case 'WP':           return `${p.leistungKW || 10} kW`;
    case 'PV':           return `${p.leistungKWp || 10} kWp`;
    case 'Batterie':     return `${p.kapazitaetKWh || 50} kWh`;
    case 'Lade':         return `${p.anzahlPunkte || 4}×${p.leistungProPunktKW || 22} kW`;
    case 'Nsa':          return `${p.leistungKW || 100} kW`;
    case 'KWK':          return `${p.leistungElKW || 100} kWel`;
    case 'Wind':         return `${p.leistungKW || 500} kW`;
    default:             return '';
  }
}

export function sldBadge(n) {
  const res = STROMNETZ.calcResult;
  if (!res) return { txt: null, col: '#546e7a' };
  if (n.type === 'Trafo') {
    const tr = (res.trafoResults || []).find(t => t.id === n.id);
    if (!tr) return { txt: null, col: '#546e7a' };
    const col = tr.ausl > 100 ? '#ef5350' : tr.ausl > 85 ? '#f9a825' : '#4caf50';
    return { txt: `${Math.round(tr.ausl)}%`, col };
  }
  const nvd = res.nodeVoltDrop;
  if (nvd && nvd[n.id] != null) {
    const pct = (nvd[n.id] / 400) * 100;
    const col = pct > 5 ? '#ef5350' : pct > 3 ? '#f9a825' : '#4caf50';
    if (pct >= 0.5) return { txt: `${pct.toFixed(1)}%`, col };
  }
  return { txt: null, col: '#546e7a' };
}

export function sldNodeTitle(n) {
  const res = STROMNETZ.calcResult;
  const p   = n.props || {};
  const lines = [n.name, `Typ: ${ASSET_CFG[n.type]?.label || n.type}`];
  switch (n.type) {
    case 'Trafo': {
      lines.push(`${p.leistungKVA || 630} kVA`);
      const tr = res?.trafoResults?.find(t => t.id === n.id);
      if (tr) {
        lines.push(`Bezug: ${tr.P_load.toFixed(1)} kW  |  Einsp.: ${tr.P_gen.toFixed(1)} kW`);
        lines.push(`Worst-Case: ${tr.P_worst.toFixed(1)} kW  |  Auslastung: ${tr.ausl.toFixed(0)} %`);
      }
      break;
    }
    case 'Schaltanlage':
      lines.push(`${p.felder || 6} Felder  |  ${p.nennstromA || 630} A${p.trennstelle ? '  |  Trennstelle' : ''}`);
      break;
    case 'NSHV': case 'UV':
      lines.push(`${p.nennstromA || 400} A  |  ${p.abgaenge || 4} Abgänge`);
      break;
    case 'Verbraucher': case 'WP': case 'Nsa':
      lines.push(`Leistung: ${p.leistungKW || 10} kW`);
      break;
    case 'PV':
      lines.push(`Leistung: ${p.leistungKWp || 10} kWp`);
      break;
    case 'Lade':
      lines.push(`${p.anzahlPunkte || 4} × ${p.leistungProPunktKW || 22} kW = ${((p.anzahlPunkte || 4)*(p.leistungProPunktKW || 22)).toFixed(0)} kW`);
      break;
    case 'Batterie':
      lines.push(`${p.leistungKW || 25} kW  |  ${p.kapazitaetKWh || 50} kWh`);
      break;
    case 'KWK':
      lines.push(`El: ${p.leistungElKW || 100} kW  |  Th: ${p.leistungThKW || 160} kW`);
      break;
    case 'Wind':
      lines.push(`Nennleistung: ${p.leistungKW || 500} kW`);
      break;
  }
  const nvd = res?.nodeVoltDrop;
  if (nvd && nvd[n.id] != null && n.type !== 'NAP') {
    const dU_V = nvd[n.id];
    const dU_pct = (dU_V / 400) * 100;
    lines.push(`Spannung: ${(400 - dU_V).toFixed(1)} V  (ΔU ${dU_pct.toFixed(2)} %)`);
  }
  return lines.join('\n');
}

export function sldEdgeTitle(lt, er) {
  const lines = [lt.name || `Leitung ${lt.qs || 50} mm²`];
  lines.push(`Querschnitt: ${lt.qs || 50} mm²`);
  if (lt._result?.laengeM) lines.push(`Länge: ${Math.round(lt._result.laengeM)} m`);
  if (lt.parallelCount > 1) lines.push(`Parallelkabel: ${lt.parallelCount}`);
  if (er) {
    lines.push(`Strom: ${er.I_A?.toFixed(1) || '–'} A  |  Imax: ${er.I_max?.toFixed(0) || '–'} A`);
    lines.push(`Auslastung: ${er.ausl_pct?.toFixed(0) || '–'} %`);
    lines.push(`ΔU: ${er.dU_pct?.toFixed(2) || '–'} %  |  kum. ΔU: ${(er.dU_cum_pct ?? er.dU_pct)?.toFixed(2) || '–'} %`);
  }
  if (lt.sicherungA) lines.push(`Sicherung: ${lt.sicherungA} A`);
  return lines.join('\n');
}
