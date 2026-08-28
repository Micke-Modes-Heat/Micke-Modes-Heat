// ── 13f-sld.js — Einlinienschema (Single-Line Diagram) ──────────────────────

import { ASSETS, ASSET_CFG, TYPE_RANK, getAssetStatus, getAsset } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';
import { map } from './02b-gebaeude.js';
import { getStromEdgeColor, buildStromEdgeTooltip } from './05b-stromnetz.js';
import { _buildAssetTooltip } from './13b-assets-render.js';

const SLD_LH = 120;   // px per rank level (vertical)
const SLD_CW = 110;   // min column width per node
const SLD_NW = 86;    // node box width
const SLD_NH = 54;    // node box height

// SVG-Text muss maskiert werden — ein & oder < in einem Gebäudenamen zerlegt
// sonst das ganze Diagramm.
const _esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Namen wie „Verbraucher Gewerbe, Handel, Dienstleistung 28" sind doppelt so
// breit wie das Kästchen und überdecken die Nachbarn. Gekürzt wird MITTIG:
// vorne steht, was es ist, hinten die Nummer — und genau die identifiziert das
// Betriebsmittel. Der vollständige Name steht weiter im Tooltip und im
// Komponentenverzeichnis des PDF-Exports.
function _passend(text, breitePx, schriftPx) {
  const s = String(text ?? '');
  const maxZeichen = Math.max(6, Math.floor(breitePx / (schriftPx * 0.55)));
  if (s.length <= maxZeichen) return _esc(s);
  const kopf = Math.ceil((maxZeichen - 1) * 0.6);
  const schwanz = maxZeichen - 1 - kopf;
  return _esc(s.slice(0, kopf).trimEnd() + '…' + (schwanz > 0 ? s.slice(-schwanz) : ''));
}

// Zwei Gebäude derselben Nutzung heißen gleich („Kfz-Abstellhalle") — erst die
// Gebäudenummer macht den Knoten im Schema eindeutig. Vorangestellt, weil
// _passend() MITTIG kürzt: der Kopf mit der Nummer überlebt jede Kürzung.
function _gebNummer(n) {
  if (!n || n.buildingId == null) return '';
  const g = (window.gebaeude || []).find(x => String(x.id) === String(n.buildingId));
  return g && g.gebaeudenummer ? String(g.gebaeudenummer).trim() : '';
}

function _knotenName(n) {
  const nr = _gebNummer(n);
  return nr ? nr + ' · ' + n.name : n.name;
}

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
  if (vis) { sldRender(); sldInitResize(); } else { _sldHideTooltip(); }
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
      <td style="padding:3px 8px;border-bottom:.3pt solid #e8ecf0;">${cfg.icon||'·'} ${_knotenName(n)}</td>
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
    _sldHideTooltip();
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
  _letzteKnoten = nodes;
  sldInitPan();
  _sucheInit();
  _sldBindHover(canvas);
  _sldStartFlowAnim();
}

export function sldRefresh() {
  if (document.getElementById('sld-panel')?.classList.contains('visible')) sldRender();
}

// ── Suche ─────────────────────────────────────────────────────────────────────
// Gesucht wird in den Knoten des ZULETZT GEZEICHNETEN Layouts, nicht im
// Gesamtbestand: nur was im Schema steht, lässt sich auch anfahren. In der
// Gebäudeansicht ist das der Sammelknoten — die eingeklappten Anlagen bleiben
// trotzdem durchsuchbar, sonst fände man „UV Sporthalle" dort nie wieder.
let _letzteKnoten = [];

function _sucheTreffer(s) {
  const treffer = [];
  for (const n of _letzteKnoten) {
    const nr    = _gebNummer(n);
    const label = _knotenName(n);
    const typ   = ASSET_CFG[n.type]?.label || n.type;
    const chips = n._chips ? n._chips.map(c => c.name).join(' ') : '';
    if (!`${nr} ${label} ${typ} ${chips}`.toLowerCase().includes(s)) continue;
    // Wer eine Gebäudenummer eintippt, meint genau dieses Gebäude — nicht das,
    // in dessen Kabellänge die Ziffernfolge zufällig vorkommt.
    const rang = nr.toLowerCase() === s ? 0
      : label.toLowerCase().startsWith(s) ? 1
      : 2;
    treffer.push({ n, rang });
  }
  treffer.sort((a, b) => (a.rang - b.rang) || (a.n.y - b.n.y) || (a.n.x - b.n.x));
  return treffer.map(t => t.n);
}

export function sldSuche(q) {
  const box = document.getElementById('sld-suche-res');
  if (!box) return;
  const s = String(q || '').trim().toLowerCase();
  if (!s) { _sucheZu(); return; }
  const gefunden = _sucheTreffer(s);
  if (!gefunden.length) {
    box.innerHTML = '<div class="sld-suche-leer">Kein Objekt im Schema — evtl. im gewählten Jahr nicht aktiv</div>';
    box.style.display = 'block';
    return;
  }
  box.innerHTML = gefunden.slice(0, 25).map(n => {
    const cfg = ASSET_CFG[n.type] || {};
    const nr  = _gebNummer(n);
    const meta = n._chips ? `${n._chips.length} Anlagen` : (cfg.label || n.type);
    return `<div class="sld-suche-row" data-click="sldSucheWahl('${_esc(String(n.id)).replace(/'/g, "\'")}')">
      <span class="sld-suche-nr">${_esc(nr || cfg.icon || '·')}</span>
      <span class="sld-suche-name">${_esc(n.name)}</span>
      <span class="sld-suche-meta">${_esc(meta)}</span>
    </div>`;
  }).join('')
  + (gefunden.length > 25 ? `<div class="sld-suche-leer">… ${gefunden.length - 25} weitere</div>` : '');
  box.style.display = 'block';
}

export function sldSucheTaste(ev) {
  if (ev.key === 'Escape') { ev.target.value = ''; _sucheZu(); ev.target.blur(); return; }
  if (ev.key !== 'Enter') return;
  document.querySelector('#sld-suche-res .sld-suche-row')?.click();
}

export function sldSucheWahl(id) {
  _sucheZu();
  ASSETS.selectedId = id;
  const asset = getAsset(id);
  if (asset) _showNodeInfo(asset);
  sldRender();                                   // zeichnet die Auswahl hervor
  const n = _letzteKnoten.find(k => String(k.id) === String(id));
  if (!n) return;
  _sldZuKnoten(n);
  const hin = document.getElementById('sld-suche-hinweis');
  if (hin) hin.textContent = '→ ' + _knotenName(n);
}

function _sucheZu() {
  const box = document.getElementById('sld-suche-res');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

// Den Treffer in die Mitte der Arbeitsfläche holen und kurz blinken lassen.
// Ohne das Blinken sucht man die Auswahl in einem 11 000 px breiten Schema
// genauso lange wie vorher.
function _sldZuKnoten(n) {
  const wrap = document.getElementById('sld-canvas-wrap');
  if (!wrap) return;
  const z = SLD_STATE.zoom;
  wrap.scrollTo({
    left: Math.max(0, n.x * z - wrap.clientWidth  / 2),
    top:  Math.max(0, n.y * z - wrap.clientHeight / 2),
    behavior: 'smooth',
  });
  const g = wrap.querySelector(`[data-assetid="${String(n.id).replace(/"/g, '\\"')}"]`);
  if (g) { g.classList.remove('sld-fund'); void g.getBoundingClientRect(); g.classList.add('sld-fund'); }
}

// Klick neben die Trefferliste schließt sie — data-* kennt kein blur.
let _sucheGebunden = false;
function _sucheInit() {
  if (_sucheGebunden) return;
  _sucheGebunden = true;
  document.addEventListener('click', ev => {
    if (!ev.target.closest('.sld-suche-wrap')) _sucheZu();
  });
}

// ── Active assets & edges ─────────────────────────────────────────────────────
// ── Gebäude zusammenfassen (Schalter) ─────────────────────────────
// In einer Liegenschaft mit 77 Gebäuden sind 154 der Knoten schlicht das Paar
// UV + Verbraucher desselben Hauses. Zusammengefasst halbiert sich die Breite.
//
// BEWUSST NICHT der Standard: ein Einlinienschema soll Betriebsmittel zeigen,
// und die Unterscheidung UV/Verbraucher geht dabei verloren. Wer nach dem
// Spannungsfall an einer bestimmten Unterverteilung sucht, braucht sie einzeln.
let SLD_GEB_SAMMELN = false;

export function sldToggleGebaeude() {
  SLD_GEB_SAMMELN = !SLD_GEB_SAMMELN;
  document.getElementById('btn-sld-geb')?.classList.toggle('active', SLD_GEB_SAMMELN);
  sldRender();
}

/**
 * Anlagen je Gebäude auf eine stellvertretende Anlage zusammenziehen.
 * Stellvertreter ist die netzseitigste (kleinster TYPE_RANK) — dort kommt die
 * Zuleitung an, also bleiben die Kanten von außen sinnvoll. Kanten INNERHALB
 * des Gebäudes fallen weg, mehrfach gewordene Kanten werden zu einer.
 */
function _sammleGebaeude(activeA, activeL) {
  if (!SLD_GEB_SAMMELN) return { activeA, activeL };

  const proGeb = new Map();
  for (const a of activeA) {
    if (a.buildingId == null) continue;
    if (!proGeb.has(a.buildingId)) proGeb.set(a.buildingId, []);
    proGeb.get(a.buildingId).push(a);
  }

  const vertreter = new Map();   // assetId → Stellvertreter-Id
  const behalten  = new Set(activeA.filter(a => a.buildingId == null).map(a => a.id));
  const chips     = new Map();
  const namen     = new Map();

  for (const [gid, liste] of proGeb) {
    if (liste.length < 2) { liste.forEach(a => behalten.add(a.id)); continue; }
    const sortiert = [...liste].sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9));
    const v = sortiert[0];
    behalten.add(v.id);
    liste.forEach(a => vertreter.set(a.id, v.id));
    chips.set(v.id, sortiert);
    const g = (window.gebaeude || []).find(x => String(x.id) === String(gid));
    namen.set(v.id, g?.name || v.name);
  }

  const neueA = activeA.filter(a => behalten.has(a.id)).map(a => chips.has(a.id)
    // Stellvertreter ist nach TYPE_RANK die Schaltanlage oder der Trafo, nie die
    // NSHV — die Schienen-Eigenschaft hängt deshalb am INHALT des Gebäudes,
    // nicht am Typ des Stellvertreters.
    ? { ...a, name: namen.get(a.id), _chips: chips.get(a.id), _sammel: true,
        _schiene: chips.get(a.id).some(c => c.type === 'NSHV') }
    : a);

  const zu = id => vertreter.get(id) || id;
  const gesehen = new Set();
  const neueL = [];
  for (const e of activeL) {
    const u = zu(e.u), v = zu(e.v);
    if (u === v) continue;                                  // gebäudeintern
    const schl = u < v ? `${u}|${v}` : `${v}|${u}`;
    if (gesehen.has(schl)) continue;                        // doppelt geworden
    gesehen.add(schl);
    neueL.push((u === e.u && v === e.v) ? e : { ...e, u, v });
  }
  return { activeA: neueA, activeL: neueL };
}

function _getActive(yr) {
  const activeA = ASSETS.items.filter(a =>
    (a.domain === 'strom' || a.domain === 'hybrid') &&
    getAssetStatus(a, yr) === 'active'
  );
  const activeIds = new Set(activeA.map(a => a.id));
  const activeL = (window.stromEdges || []).filter(e =>
    activeIds.has(e.u) && activeIds.has(e.v)
  );
  return _sammleGebaeude(activeA, activeL);
}

// ── Layout engine ─────────────────────────────────────────────────────────────
// Was im Schema als Balken gezeichnet wird — und woran die Abgänge als Stiche
// hängen. In der Gebäudeansicht ist das der Sammelknoten mit einer NSHV im
// Inneren (_schiene), sonst die NSHV/UV selbst.
function _istSchiene(a) {
  return !!a && (a._schiene || (!a._sammel && (a.type === 'NSHV' || a.type === 'UV')));
}

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
  //
  // BIS ZUM FIXPUNKT, nicht in einem Durchlauf. Ein Ring A→B→C→D wird über
  // gleichrangige Kanten verkettet; kommt die Kante C—D vor B—C dran, hat noch
  // keiner der beiden einen Elternteil und die Kante galt als Ringschluss. Aus
  // einem Ring wurden so mehrere Bruchstücke mit je eigenem „Ringschluss" —
  // im Bild lauter lange gestrichelte Linien und Mitglieder, die im Schema
  // nicht nebeneinander standen. Jeder Durchlauf hängt an, was inzwischen
  // entscheidbar ist; erst wenn nichts mehr geht, bleibt der echte Ringschluss.
  let offen = activeL.filter(e => {
    const a = assetMap.get(e.u), b = assetMap.get(e.v);
    if (!a || !b) return false;
    return (TYPE_RANK[a.type] ?? 6) === (TYPE_RANK[b.type] ?? 6);
  });
  const _anhaengen = (srcId, snkId) => {
    parentOf.set(snkId, srcId);
    if (!children.get(srcId).includes(snkId)) children.get(srcId).push(snkId);
  };
  while (offen.length) {
    let fortschritt = false;
    const rest = [];
    for (const e of offen) {
      const aHat = parentOf.has(e.u), bHat = parentOf.has(e.v);
      if (aHat && bHat)       { ringEdges.add(e.id); continue; }   // echter Ringschluss
      if (!aHat && !bHat)     { rest.push(e); continue; }          // noch nicht entscheidbar
      if (aHat) _anhaengen(e.u, e.v); else _anhaengen(e.v, e.u);
      fortschritt = true;
    }
    if (!fortschritt) {
      // Freistehende Kette ohne Anker von oben: eine Richtung setzen und weiter.
      const e = rest.shift();
      if (!e) break;
      _anhaengen(e.u, e.v);
    }
    offen = rest;
  }

  // Welche Baumkanten liegen wirklich auf einem Ring? Nur zwischen ihren Enden
  // sind zwei gleichrangige Knoten Nachbarn und gehören nebeneinander. Eine
  // radiale Kaskade UV→UV→Verbraucher ist KEIN Ring — sie soll sich weiter als
  // Baum nach unten verzweigen. Der Zyklus ist der Weg im Baum zwischen den
  // Enden einer Ringkante, also von beiden Enden aufwärts bis zum gemeinsamen
  // Vorfahren.
  const ringKanten = new Set();                    // "elternId|kindId"
  const ringPaare  = [];                           // [elternId, kindId] mit echten Ids
  const _tiefe = new Map();
  function tiefeVon(id, seen = new Set()) {
    if (_tiefe.has(id)) return _tiefe.get(id);
    if (seen.has(id))   return 0;
    seen.add(id);
    const p = parentOf.get(id);
    const t = p != null ? tiefeVon(p, seen) + 1 : 0;
    _tiefe.set(id, t);
    return t;
  }
  for (const e of activeL) {
    if (!ringEdges.has(e.id)) continue;
    if (!assetMap.has(e.u) || !assetMap.has(e.v)) continue;
    let a = e.u, b = e.v, ta = tiefeVon(a), tb = tiefeVon(b), schutz = 0;
    while (a !== b && schutz++ < 500) {
      if (ta >= tb) { const p = parentOf.get(a); if (p == null) break; ringKanten.add(p + '|' + a); ringPaare.push([p, a]); a = p; ta--; }
      else          { const p = parentOf.get(b); if (p == null) break; ringKanten.add(p + '|' + b); ringPaare.push([p, b]); b = p; tb--; }
    }
    ringPaare.push([e.u, e.v]);                    // der Ringschluss selbst
  }

  // Ebene im Schema. Für die Netzinfrastruktur ist sie FEST: NAP ganz oben,
  // darunter alle Schaltanlagen, dann alle Trafos, dann alle NSHV. Das ist die
  // Spannungsebene, und die hängt nicht davon ab, wie tief ein Betriebsmittel
  // zufällig im Speisebaum hängt. Ohne diese Ausnahme rutschte eine Schaltanlage,
  // die an einer anderen Schaltanlage hängt, auf die Trafo-Zeile.
  //
  // Erst ab der Verteilebene gilt wieder max(TYPE_RANK, Elternebene + 1) — dort
  // sind Kaskaden real (UV→UV→Verbraucher) und sollen sich auch so zeigen.
  const FESTE_EBENE = new Set(['NAP', 'Schaltanlage', 'Trafo', 'NSHV']);
  const effRank = new Map();
  function getEffRank(id, seen = new Set()) {
    if (effRank.has(id)) return effRank.get(id);
    if (seen.has(id))    return TYPE_RANK[assetMap.get(id)?.type] ?? 4;
    seen.add(id);
    const typ  = assetMap.get(id)?.type;
    const base = TYPE_RANK[typ] ?? 4;
    if (FESTE_EBENE.has(typ)) { effRank.set(id, base); return base; }
    const par  = parentOf.get(id);
    // Ein Ring ist eine KETTE GLEICHRANGIGER Stationen. Als Eltern-Kind-Folge
    // gelesen, rutschte jede Station eine Ebene tiefer — ein Ring mit zwölf
    // Stationen wurde zu einer Treppe über zwölf Reihen, und der Ringschluss
    // lief als Bogen quer durchs ganze Bild. Gleicher Typrang heißt gleiche
    // Spannungsebene: dann kein Ebenensprung, die Kette bleibt eine Reihe.
    const parBase  = TYPE_RANK[assetMap.get(par)?.type] ?? 4;
    const imRing   = par != null && ringKanten.has(par + '|' + id) && parBase === base;
    const eff  = par ? Math.max(base, getEffRank(par, seen) + (imRing ? 0 : 1)) : base;
    effRank.set(id, eff);
    return eff;
  }
  for (const a of activeA) getEffRank(a.id);

  // Ein Ring liegt auf EINER Spannungsebene — auch wenn ein Mitglied im
  // Speisebaum tiefer hängt. Genau das passiert bei durchgeschliffenen UV und
  // bei Ringen, die über KVS laufen: der Baum erreicht so ein Mitglied über
  // eine Kante, die nicht auf dem Zyklus liegt, es bekommt darüber einen
  // Ebenensprung und steht am Ende eine Reihe tiefer als der Rest seines Rings.
  // Die Ringlinie musste es dann quer über die Zwischenreihe hinweg einsammeln.
  // Nachträglich wird jeder Ring auf die oberste Ebene gezogen, die eines
  // seiner Mitglieder erreicht hat.
  const rWurzel = new Map();
  const findeRK = x => {
    while (rWurzel.get(x) !== x) { rWurzel.set(x, rWurzel.get(rWurzel.get(x))); x = rWurzel.get(x); }
    return x;
  };
  for (const [u, v] of ringPaare) for (const id of [u, v]) if (!rWurzel.has(id)) rWurzel.set(id, id);
  for (const [u, v] of ringPaare) { const a = findeRK(u), b = findeRK(v); if (a !== b) rWurzel.set(a, b); }
  const ringGlieder = new Map();
  for (const [u, v] of ringPaare) for (const id of [u, v]) {
    const w = findeRK(id);
    if (!ringGlieder.has(w)) ringGlieder.set(w, new Set());
    ringGlieder.get(w).add(id);
  }
  const ringFest = new Set();
  for (const [, glieder] of ringGlieder) {
    // Die Netzinfrastruktur hat feste Ebenen — ein Ring hebt sie nicht auf.
    const mitglieder = [...glieder].filter(id => !FESTE_EBENE.has(assetMap.get(id)?.type));
    if (mitglieder.length < 2) continue;
    const ziel = Math.min(...mitglieder.map(id => effRank.get(id) ?? 4));
    for (const id of mitglieder) {
      if ((TYPE_RANK[assetMap.get(id)?.type] ?? 4) > ziel) continue;   // gehört von Haus aus tiefer
      const par = parentOf.get(id);
      // Nie über den eigenen Einspeisepunkt heben — sonst stünde der Abgang
      // im Bild über seiner Quelle.
      if (par != null && !glieder.has(par) && (effRank.get(par) ?? 0) >= ziel) continue;
      effRank.set(id, ziel);
      ringFest.add(id);
    }
  }

  // Was unter einem gehobenen Ringmitglied hängt, rutscht mit — sonst klafft
  // zwischen Ring und Abgängen eine leere Reihe.
  if (ringFest.size) {
    const neuRank = new Map();
    const nachziehen = (id, seen = new Set()) => {
      if (neuRank.has(id)) return neuRank.get(id);
      if (seen.has(id))    return effRank.get(id) ?? 4;
      seen.add(id);
      const typ  = assetMap.get(id)?.type;
      const base = TYPE_RANK[typ] ?? 4;
      if (FESTE_EBENE.has(typ) || ringFest.has(id)) {
        const r = effRank.get(id) ?? base;
        neuRank.set(id, r);
        return r;
      }
      const par     = parentOf.get(id);
      const parBase = TYPE_RANK[assetMap.get(par)?.type] ?? 4;
      const imRing  = par != null && ringKanten.has(par + '|' + id) && parBase === base;
      const r = par != null ? Math.max(base, nachziehen(par, seen) + (imRing ? 0 : 1)) : base;
      neuRank.set(id, r);
      return r;
    };
    for (const a of activeA) nachziehen(a.id);
    for (const [id, r] of neuRank) effRank.set(id, r);
  }

  // Geschwister in der Reihenfolge der Karte anordnen (West → Ost).
  //
  // Bisher entschied die Reihenfolge, in der die Kanten zufällig eingelesen
  // wurden — zwei benachbarte Gebäude konnten im Schema an entgegengesetzten
  // Enden stehen. Mit der Kartenreihenfolge findet man sich wieder: was auf der
  // Karte links liegt, steht auch im Schema links.
  const _kartenX = id => {
    const a = assetMap.get(id);
    if (!a || a.lat == null || a.lng == null) return null;
    try { return map.options.crs.project(L.latLng(a.lat, a.lng)).x; } catch (err) { return null; }
  };
  for (const [, kinder] of children) {
    if (kinder.length < 2) continue;
    const platz = new Map(kinder.map((id, i) => [id, i]));
    kinder.sort((a, b) => {
      const xa = _kartenX(a), xb = _kartenX(b);
      // Ohne Koordinaten ans Ende, untereinander in der bisherigen Reihenfolge
      if (xa == null && xb == null) return platz.get(a) - platz.get(b);
      if (xa == null) return 1;
      if (xb == null) return -1;
      return (xa - xb) || (platz.get(a) - platz.get(b));
    });
  }

  // Geschwister umsortieren, damit Ringpartner nebeneinander landen.
  //
  // Baumkanten kreuzen sich in diesem Layout nie — die Teilbäume belegen
  // disjunkte x-Bereiche. Was kreuzt, sind die Ringkanten: verbindet ein Ring
  // zwei UV, die zufällig an den entgegengesetzten Enden einer Reihe von 77
  // Geschwistern stehen, läuft die Leitung quer durch das ganze Bild.
  //
  // Gruppiert statt gemittelt: das Baryzentrum-Verfahren taugt hier nicht, weil
  // ein Paar dabei nur die Plätze TAUSCHT (Kind A bekommt die Position von B und
  // umgekehrt) und in jeder Runde erneut. Stattdessen werden die über Ringkanten
  // zusammenhängenden Geschwister zu einer Gruppe zusammengefasst und
  // zusammenhängend platziert, verankert an der frühesten Ausgangsposition.
  const ringNachbarn = new Map();
  for (const e of activeL) {
    if (!ringEdges.has(e.id)) continue;
    if (!ringNachbarn.has(e.u)) ringNachbarn.set(e.u, []);
    if (!ringNachbarn.has(e.v)) ringNachbarn.set(e.v, []);
    ringNachbarn.get(e.u).push(e.v);
    ringNachbarn.get(e.v).push(e.u);
  }
  if (ringNachbarn.size) {
    for (const [, kinder] of children) {
      if (kinder.length < 3) continue;
      const platz = new Map(kinder.map((id, i) => [id, i]));
      const wurzel = new Map(kinder.map(id => [id, id]));
      const finde = x => {
        while (wurzel.get(x) !== x) { wurzel.set(x, wurzel.get(wurzel.get(x))); x = wurzel.get(x); }
        return x;
      };
      for (const id of kinder) {
        for (const partner of (ringNachbarn.get(id) || [])) {
          if (!platz.has(partner)) continue;
          const a = finde(id), b = finde(partner);
          if (a !== b) wurzel.set(a, b);
        }
      }
      const gruppenStart = new Map();
      for (const id of kinder) {
        const w = finde(id), i = platz.get(id);
        if (!gruppenStart.has(w) || i < gruppenStart.get(w)) gruppenStart.set(w, i);
      }
      kinder.sort((a, b) =>
        (gruppenStart.get(finde(a)) - gruppenStart.get(finde(b))) || (platz.get(a) - platz.get(b)));
    }
  }

  // Kinder auf DERSELBEN Ebene sind Ringnachbarn, keine Abgänge: sie stehen
  // neben dem Knoten in derselben Reihe, nicht unter ihm. Alle anderen Kinder
  // hängen wie bisher darunter.
  const _istNachbar = (id, c) => ringKanten.has(id + '|' + c) && getEffRank(c) === getEffRank(id);
  const _peer     = id => (children.get(id) || []).filter(c =>  _istNachbar(id, c));
  const _abgaenge = id => (children.get(id) || []).filter(c => !_istNachbar(id, c));

  // Die Kette in Reihenfolge — sie bestimmt, in welcher Folge die Stationen
  // des Rings nebeneinander stehen (die Geschwistersortierung oben hat sie
  // bereits nach der Karte von West nach Ost gebracht).
  function _kette(id, out = [], seen = new Set()) {
    if (seen.has(id)) return out;
    seen.add(id);
    out.push(id);
    for (const c of _peer(id)) _kette(c, out, seen);
    return out;
  }

  // Subtree width
  const stW = new Map();
  function eigenBreite(id) {
    const ch = _abgaenge(id);
    return ch.length === 0
      ? SLD_CW
      : Math.max(SLD_CW, ch.reduce((s, c) => s + subtreeWidth(c), 0));
  }
  function subtreeWidth(id) {            // Breite der ganzen Ringkette ab id
    if (stW.has(id)) return stW.get(id);
    stW.set(id, SLD_CW);                 // Zyklusschutz während der Rekursion
    const w = _kette(id).reduce((sum, m) => sum + eigenBreite(m), 0);
    stW.set(id, w);
    return w;
  }
  connectedA.forEach(a => subtreeWidth(a.id));

  // Place nodes
  const pos    = new Map();
  const placed = new Set();
  function place(id, cx) {               // cx ist die Mitte der ganzen Kette
    if (placed.has(id)) return;
    const glieder = _kette(id).filter(m => !placed.has(m));
    if (!glieder.length) return;
    const y      = PAD_TOP + getEffRank(id) * SLD_LH;
    const gesamt = glieder.reduce((sum, m) => sum + eigenBreite(m), 0);
    let x = cx - gesamt / 2;
    for (const m of glieder) {
      const bw = eigenBreite(m);
      placed.add(m);
      pos.set(m, { x: x + bw / 2, y });
      const ch = _abgaenge(m).filter(c => !placed.has(c));
      if (ch.length) {
        const total = ch.reduce((sum, c) => sum + subtreeWidth(c), 0);
        let cx2 = x + bw / 2 - total / 2;
        for (const c of ch) { const cw = subtreeWidth(c); place(c, cx2 + cw / 2); cx2 += cw; }
      }
      x += bw;
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

  // Sammelschienen über die Breite ihrer Abgänge spannen.
  //
  // Bisher war eine NSHV ein 102 px breites Kästchen, aus dem sich bis zu
  // siebzig Leitungen fächerförmig spreizten — deren waagerechte Segmente fielen
  // alle auf dieselbe Höhe und ergaben ein Knäuel. Im Einlinienschema ist die
  // Sammelschiene ein BALKEN, von dem die Abgänge senkrecht herunterhängen.
  const busSpanne = new Map();
  for (const [pid] of children) {
    if (!_istSchiene(assetMap.get(pid))) continue;
    const eigen = pos.get(pid);
    if (!eigen) continue;
    // Nur die Abgänge spannen die Schiene. Ein Ringnachbar derselben Ebene
    // (MS-Kupplung Station↔Station) hängt nicht an ihr, sondern daneben —
    // sein x würde den Balken über die halbe Liegenschaft ziehen.
    const xs = _abgaenge(pid).map(c => pos.get(c)?.x).filter(x => x != null);
    if (!xs.length) continue;
    // Der Einspeisepunkt (eigene x-Position) muss auf der Schiene liegen
    const von = Math.min(Math.min(...xs) - SLD_NW / 2, eigen.x - (SLD_CW - 8) / 2);
    const bis = Math.max(Math.max(...xs) + SLD_NW / 2, eigen.x + (SLD_CW - 8) / 2);
    // Eine UV mit einem einzigen Abgang ergibt keine breitere Schiene als der
    // Standardbalken. Sie trotzdem einzutragen hieße, sie in die Spurenrechnung
    // zu schicken — Reihen gleich breiter UV wurden dort im Zickzack versetzt.
    if (bis - von <= SLD_CW - 8 + 2) continue;
    busSpanne.set(pid, { von, bis });
  }

  // Zwei Schienen auf derselben Ebene können sich überspannen: die eine speist
  // die andere, oder ihre Abgänge stehen ineinander. Auf gleicher Höhe wären
  // sie ein einziger Balken mit zwei Beschriftungen (genau das Bild, das eine
  // überlappende Station macht). Wer sich mit einer schon belegten Spur
  // überschneidet, rutscht deshalb eine Spur tiefer.
  const SPUR_H = 46;
  const spurVersatz = new Map();     // id → px, um die die Schiene tiefer liegt
  const proEbene = new Map();
  for (const [id, sp] of busSpanne) {
    const p = pos.get(id);
    if (!p) continue;
    if (!proEbene.has(p.y)) proEbene.set(p.y, []);
    proEbene.get(p.y).push({ id, von: sp.von, bis: sp.bis });
  }
  for (const [, schienen] of proEbene) {
    if (schienen.length < 2) continue;
    schienen.sort((a, b) => (a.von - b.von) || (a.bis - b.bis));
    const spurEnde = [];               // rechtes Ende der letzten Schiene je Spur
    for (const sch of schienen) {
      let spur = spurEnde.findIndex(ende => sch.von > ende + 1);
      if (spur === -1) spur = spurEnde.length;
      spurEnde[spur] = sch.bis;
      if (spur > 0) { pos.get(sch.id).y += spur * SPUR_H; spurVersatz.set(sch.id, spur * SPUR_H); }
    }
  }

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
    _bus: busSpanne.get(a.id) || null,
  }));

  const edges = [];
  for (const e of activeL) {
    const pA = pos.get(e.u), pB = pos.get(e.v);
    if (!pA || !pB) continue;
    // Hängt die Leitung an einer Sammelschiene, wird sie zum senkrechten Stich
    // am Ort des unteren Knotens — nicht mehr diagonal aus der Schienenmitte.
    const obenA  = pA.y <= pB.y ? assetMap.get(e.u) : assetMap.get(e.v);
    const untenA = pA.y <= pB.y ? assetMap.get(e.v) : assetMap.get(e.u);
    // Der Spurversatz ist reine Darstellung — fachlich stehen zwei versetzte
    // Schienen weiter auf DERSELBEN Ebene. Die MS-Verbindung zwischen ihnen
    // bleibt darum der Bogen mit Plakette und wird nicht zum Stich.
    const ebeneA = pA.y - (spurVersatz.get(e.u) || 0);
    const ebeneB = pB.y - (spurVersatz.get(e.v) || 0);
    const gleicheEbene = Math.abs(ebeneA - ebeneB) < 4;
    const vonSchiene = _istSchiene(obenA) && !gleicheEbene
      && Math.abs(pA.y - pB.y) > 4 && !ringEdges.has(e.id);
    // Nur was auf einem Ring liegt, gehört auf die Ringschiene. Eine beliebige
    // Verbindung zwischen zwei gleichrangigen Knoten (etwa eine MS-Kupplung)
    // hätte die Schiene sonst über Knoten gespannt, die gar nicht zum Ring
    // gehören — im Bild lief die Linie dann über unbeteiligte Nachbarn hinweg.
    const imRing = ringEdges.has(e.id)
      || ringKanten.has(e.u + '|' + e.v) || ringKanten.has(e.v + '|' + e.u);
    edges.push({ e, x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y,
      isRing: ringEdges.has(e.id), vonSchiene, zuSchiene: _istSchiene(untenA), gleicheEbene, imRing });
  }

  // ── Ringschiene ────────────────────────────────────────────────────────────
  // Alle Verbindungen INNERHALB einer Reihe gehören zu einem Ring. Bisher bekam
  // jedes Segment einen eigenen Bogen mit eigener Tiefe — zwölf ineinander
  // geschachtelte Bögen und zwölf „Ring"-Plaketten. Jetzt liegen alle Segmente
  // eines Rings auf EINER Linie unter der Reihe, jede Station hängt mit einer
  // kurzen Senkrechten daran. Jedes Segment bleibt ein eigenes Kabel mit
  // eigener Farbe, Beschriftung und Tooltip.
  const wurzelVon = new Map();
  const findeR = x => {
    while (wurzelVon.get(x) !== x) { wurzelVon.set(x, wurzelVon.get(wurzelVon.get(x))); x = wurzelVon.get(x); }
    return x;
  };
  for (const ed of edges) {
    if (!ed.gleicheEbene || !ed.imRing) continue;
    for (const id of [ed.e.u, ed.e.v]) if (!wurzelVon.has(id)) wurzelVon.set(id, id);
  }
  for (const ed of edges) {
    if (!ed.gleicheEbene || !ed.imRing) continue;
    const a = findeR(ed.e.u), b = findeR(ed.e.v);
    if (a !== b) wurzelVon.set(a, b);
  }
  const ringGruppen = new Map();
  for (const ed of edges) {
    if (!ed.gleicheEbene || !ed.imRing) continue;
    const w = findeR(ed.e.u);
    if (!ringGruppen.has(w)) ringGruppen.set(w, { kanten: [], mitglieder: new Set(), xVon: Infinity, xBis: -Infinity, y: -Infinity });
    const g = ringGruppen.get(w);
    g.kanten.push(ed);
    g.mitglieder.add(ed.e.u); g.mitglieder.add(ed.e.v);
    g.xVon = Math.min(g.xVon, ed.x1, ed.x2);
    g.xBis = Math.max(g.xBis, ed.x1, ed.x2);
    g.y    = Math.max(g.y, ed.y1, ed.y2);
  }
  // Auf welcher Seite der Reihe ist Platz? Unter einer Station hängen ihre
  // Abgänge, über ihr die Einspeisung. Eine Ringlinie auf der belegten Seite
  // wird von jeder dieser Leitungen gekreuzt — genau das machte die Zuordnung
  // unmöglich. Für einen UV-Ring ist oben frei (nur die beiden Ringenden werden
  // von der NSHV gespeist), für einen Ring aus Verbrauchern unten (Blätter
  // haben keine Abgänge). Gewählt wird die Seite mit den wenigsten Kreuzungen.
  const ringLinien = [];
  for (const [, g] of ringGruppen) {
    // Eine einzelne Verbindung ist kein Ring (z. B. die MS-Kupplung zwischen
    // zwei Stationen) — die bleibt der Bogen mit ihrer eigenen Plakette.
    if (g.kanten.length < 2) continue;
    let untenBelegt = 0, obenBelegt = 0;
    for (const id of g.mitglieder) {
      if (_abgaenge(id).length) untenBelegt++;
      const par = parentOf.get(id);
      if (par != null && !_istNachbar(par, id)) obenBelegt++;
    }
    g.oben  = obenBelegt <= untenBelegt;
    // Unterhalb erst unter die Bildunterschrift (Name +13, Kennwert +23, ΔU +33).
    g.linie = g.oben ? g.y - SLD_NH / 2 - 18 : g.y + SLD_NH / 2 + 42;
    ringLinien.push(g);
  }

  // Zwei Ringe derselben Reihe landen sonst auf derselben Höhe und lesen sich
  // als ein einziger durchgehender Ring. Überschneiden sie sich in x, bekommt
  // der zweite eine eigene Spur — weiter weg von der Reihe.
  const proLinie = new Map();
  for (const g of ringLinien) {
    const schl = `${Math.round(g.linie)}|${g.oben ? 'o' : 'u'}`;
    if (!proLinie.has(schl)) proLinie.set(schl, []);
    proLinie.get(schl).push(g);
  }
  for (const [, gruppe] of proLinie) {
    if (gruppe.length > 1) {
      gruppe.sort((a, b) => a.xVon - b.xVon);
      const spurEnde = [];
      for (const g of gruppe) {
        let spur = spurEnde.findIndex(ende => g.xVon > ende + 1);
        if (spur === -1) spur = spurEnde.length;
        spurEnde[spur] = g.xBis;
        g.linie += (g.oben ? -1 : 1) * spur * 30;
      }
    }
  }

  for (const g of ringLinien) {
    // Der Ringschluss ist die Rückleitung: eine Linie weiter außen, sonst läge
    // er deckungsgleich auf allen Segmenten der Kette.
    const zurueck = g.linie + (g.oben ? -13 : 13);
    for (const ed of g.kanten) ed.ringY = ed.isRing ? zurueck : g.linie;
    const kopf = g.kanten.filter(ed => !ed.isRing)
      .sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2))[0] || g.kanten[0];
    kopf.ringKopf = { x: g.xVon, n: g.mitglieder.size };
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
  // Die Kabel des ausgewählten Objekts kommen ZULETZT: an einer Sammelschiene
  // mit siebzig Abgängen läge die hervorgehobene Leitung sonst unter den
  // dreißig, die nach ihr gezeichnet werden.
  const amSel = ed => sel != null
    && (String(ed.e.u) === String(sel) || String(ed.e.v) === String(sel));
  for (const ed of edges) if (!amSel(ed)) s += _drawEdge(ed, W, false);
  for (const ed of edges) if ( amSel(ed)) s += _drawEdge(ed, W, true);
  for (const n  of nodes) s += _drawNode(n, n.id === sel);
  s += `<text x="8" y="${H-8}" font-size="8" fill="#1e2d40" font-family="DM Mono,monospace">Einlinienschema · Jahr ${yr ?? globalYear ?? 2024}</text>`;
  return s;
}

// ── Edge ──────────────────────────────────────────────────────────────────────
function _drawEdge({ e, x1, y1, x2, y2, isRing, vonSchiene, zuSchiene, gleicheEbene, ringY, ringKopf }, svgW, hervor) {
  // Gleiche Einfärbung wie auf der Karte (Auslastung/ΔU%/Leistung/Richtung),
  // MS-Kabel immer violett — analog zu updateStromEdgeVisuals() in 05b-stromnetz.js.
  const strokeCol = e.msLevel ? '#7c4dff' : getStromEdgeColor(e);
  const dynamic   = window.stromDynamicViz !== false;
  const flowing   = Math.abs(e.peakFlowKw || 0) > 0.1;
  const flowAnim  = !isRing && dynamic && flowing;

  let path;
  const sameX = Math.abs(x1 - x2) < 4;
  // Gleiche Ebene: Ringschluss zwischen zwei Schaltanlagen, Ringversorgung
  // zwischen zwei UV. Eine gerade Verbindung liefe quer durch die Kästchen
  // der Reihe.
  // Nicht die Pixelhöhe entscheidet, sondern die Ebene: zwei Schienen derselben
  // Ebene sind nur zur Entzerrung gegeneinander versetzt (s. Spuren im Layout).
  const gleicheHoehe = gleicheEbene != null ? gleicheEbene : Math.abs(y1 - y2) < 4;

  // Bogen UNTERHALB beider Enden. Vorher lief jede Ringkante um das gesamte
  // Diagramm herum (loopOff ab dem linken bzw. rechten Rand) — bei 11 000 px
  // Breite ein Umweg quer durch alles. Die Tiefe wächst mit der Spannweite,
  // damit sich mehrere Bögen ineinander schachteln statt sich zu überlagern.
  const bogen = () => {
    const unten = Math.max(y1, y2) + SLD_NH / 2;
    // Gehört das Segment zu einer Ringschiene, gilt deren gemeinsame Höhe —
    // die spannweitenabhängige Tiefe erzeugte die geschachtelten Bögen.
    if (ringY != null) return { yb: ringY, unten };
    const tiefe = 16 + Math.min(70, Math.abs(x1 - x2) * 0.05);
    return { yb: unten + tiefe, unten };
  };
  // Die Ringschiene liegt über der Reihe, der freie Bogen darunter — der
  // Anschluss sitzt entsprechend an der Ober- oder Unterkante des Kästchens.
  const anschluss = yy => (ringY != null && ringY < yy) ? yy - SLD_NH / 2 : yy + SLD_NH / 2;

  // Abgang von der Sammelschiene: senkrecht herab an der Stelle des Abgangs.
  // BUSBAR_H/2 = 7 ist die halbe Höhe des Balkens aus _drawBusbar.
  const stich = vonSchiene && !isRing && !gleicheHoehe;
  const stichX = y1 <= y2 ? x2 : x1;

  if (stich) {
    const oben  = Math.min(y1, y2) + 7;
    // Endet der Stich auf einer Schiene (Station speist Station), gehört er an
    // deren Balkenkante — SLD_NH/2 würde ihn 27 px darüber abbrechen lassen.
    const unten = Math.max(Math.max(y1, y2) - (zuSchiene ? 7 : SLD_NH / 2), oben);
    path = `M${stichX.toFixed(1)},${oben.toFixed(1)} L${stichX.toFixed(1)},${unten.toFixed(1)}`;
  } else if (isRing || gleicheHoehe) {
    const { yb } = bogen();
    path = `M${x1.toFixed(1)},${anschluss(y1).toFixed(1)} L${x1.toFixed(1)},${yb.toFixed(1)} L${x2.toFixed(1)},${yb.toFixed(1)} L${x2.toFixed(1)},${anschluss(y2).toFixed(1)}`;
  } else if (sameX) {
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${x2.toFixed(1)},${(y2-SLD_NH/2).toFixed(1)}`;
  } else {
    const midY = y1 + (y2 - y1) * 0.42;
    path = `M${x1.toFixed(1)},${(y1+SLD_NH/2).toFixed(1)} L${x1.toFixed(1)},${midY.toFixed(1)} L${x2.toFixed(1)},${midY.toFixed(1)} L${x2.toFixed(1)},${(y2-SLD_NH/2).toFixed(1)}`;
  }

  let s = `<g data-edgeid="${e.id}"${hervor ? ' class="sld-kabel-sel"' : ''} style="cursor:pointer;">`;
  // Wide hit area
  s += `<path d="${path}" stroke="transparent" stroke-width="12" fill="none"/>`;
  // Hervorgehoben wird mit einem Schein in der EIGENEN Farbe, nicht mit einer
  // Signalfarbe: die Linienfarbe trägt die Auslastung bzw. den Spannungsfall —
  // sie zu überschreiben würde die Aussage des Bildes löschen.
  if (hervor) {
    s += `<path d="${path}" stroke="${strokeCol}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.25" pointer-events="none"/>`;
  }
  const flowAttrs = flowAnim ? `class="sld-flow-path" data-flowdir="${e.flowDirection >= 0 ? 1 : -1}" stroke-dasharray="10,5"` : '';
  s += `<path d="${path}" stroke="${strokeCol}" stroke-width="${hervor ? 3.2 : 2}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${isRing ? 'stroke-dasharray="10,5"' : flowAttrs} opacity="${isRing ? (hervor ? 0.9 : 0.55) : (hervor ? 1 : 0.9)}"/>`;

  if (isRing || gleicheHoehe) {
    // Der Ring trägt seine Marke EINMAL am linken Ende — nicht je Segment,
    // sonst stünden zwölf Plaketten auf derselben Linie.
    if (ringY != null && !ringKopf) return s + '</g>';
    const { yb } = bogen();
    const txt = ringKopf ? `Ring · ${ringKopf.n}` : (isRing ? 'Ring' : (e.msLevel ? 'MS' : 'NS'));
    const bw  = Math.max(32, 11 + txt.length * 4.4);
    const lx  = ringKopf ? Math.max(bw / 2 + 2, ringKopf.x - bw / 2 - 8) : (x1 + x2) / 2;
    s += `<rect x="${(lx-bw/2).toFixed(1)}" y="${(yb-7).toFixed(1)}" width="${bw.toFixed(1)}" height="13" rx="3" fill="#1a2535" stroke="#546e7a" stroke-width="1" pointer-events="none"/>`;
    s += `<text x="${lx.toFixed(1)}" y="${(yb+3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#78909c" pointer-events="none">${txt}</text>`;
    return s + '</g>';
  }

  // Stationsinterne Verbindungen tragen keine Beschriftung: sie sind 0 m lang
  // (beide Enden im selben Gebäude, Sammelschiene statt Kabel) und ihr
  // Querschnitt ist auto-dimensioniert. Im Bestandsplan der Liegenschaft waren
  // das 72 von 137 Beschriftungen — mehr als die Hälfte, und alle ohne Aussage.
  // Ein „35 mm²" zwischen NAP und Schaltanlage legt zudem nahe, dort läge ein
  // Kabel dieser Größe.
  if (e.stationsintern) return s + '</g>';

  // Cable label
  const midY2  = stich ? (Math.min(y1, y2) + 7 + Math.max(y1, y2) - SLD_NH / 2) / 2
               : sameX ? (y1 + y2) / 2 : y1 + (y2 - y1) * 0.42;
  const labelX = stich ? (stichX + 4).toFixed(1) : ((x1 + x2) / 2).toFixed(1);
  const labelY = (midY2 - 5).toFixed(1);
  const qs     = e.crossSection || 50;
  const lenM   = Math.round(e.lengthM || 0);
  const lTxt   = lenM > 0 ? `${qs} mm² · ${lenM} m` : `${qs} mm²`;
  s += `<text x="${labelX}" y="${labelY}" text-anchor="${stich ? 'start' : 'middle'}" font-size="${hervor ? 8.5 : 7.5}" fill="${strokeCol}" opacity="${hervor ? 1 : 0.8}" ${hervor ? 'font-weight="600"' : ''} pointer-events="none">${lTxt}</text>`;

  // Richtungspfeil (Lastfluss) — analog zum Pfeil-Marker auf der Karte:
  // ▲ zeigt standardmäßig von u nach v, bei flowDirection<0 umgekehrt.
  if (flowAnim) {
    const dx  = x2 - x1, dy = y2 - y1;
    const rot = (Math.atan2(dx, -dy) * 180 / Math.PI) + (e.flowDirection >= 0 ? 0 : 180);
    const ax  = (parseFloat(labelX) - 20).toFixed(1);
    const ay  = labelY;
    s += `<text x="${ax}" y="${ay}" text-anchor="middle" font-size="9" fill="${strokeCol}" transform="rotate(${rot.toFixed(1)} ${ax} ${ay})" pointer-events="none">▲</text>`;
  }

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

// Anlagen des Gebäudes als Symbolreihe — dieselbe Sprache wie die Kästen im
// Plan-Digitalisierer. Wird vom Gebäude-Kasten wie von der Gebäude-Schiene
// benutzt, damit ein zusammengefasstes Gebäude in beiden Formen gleich liest.
function _chipReihe(n, cx, cy, col) {
  const symbole = n._chips.slice(0, 6);
  const breite  = symbole.length * 13;
  let s = '';
  symbole.forEach((c, i) => {
    const sx = cx - breite / 2 + 6.5 + i * 13;
    s += `<text x="${sx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="11" fill="${ASSET_CFG[c.type]?.color || col}" pointer-events="none">${ASSET_CFG[c.type]?.icon || '·'}</text>`;
  });
  if (n._chips.length > 6) {
    s += `<text x="${(cx + breite / 2 + 6).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="8" fill="#546e7a" pointer-events="none">+${n._chips.length - 6}</text>`;
  }
  return s;
}

// ── Node ──────────────────────────────────────────────────────────────────────
function _drawNode(n, selected) {
  // Ein Gebäude mit NSHV bleibt auch zusammengefasst eine Sammelschiene: es ist
  // der Verteilpunkt, seine Abgänge sollen als Stiche daran hängen wie in der
  // Anlagenansicht. Ein Gebäude ohne NSHV ist dagegen ein Kasten — eine Schiene
  // würde dort das Gegenteil behaupten.
  if (_istSchiene(n)) return _drawBusbar(n, selected);
  const cfg = ASSET_CFG[n.type] || { color:'#607d8b', icon:'·', label:n.type };
  const col = cfg.color;
  const { x, y } = n;
  const rx = (x - SLD_NW/2).toFixed(1), ry = (y - SLD_NH/2).toFixed(1);

  let s = `<g data-assetid="${n.id}" style="cursor:pointer;">`;
  // Wide hit area
  s += `<rect x="${(parseFloat(rx)-4).toFixed(1)}" y="${(parseFloat(ry)-4).toFixed(1)}" width="${SLD_NW+8}" height="${SLD_NH+8}" rx="9" fill="transparent"/>`;

  if (selected) s += `<rect x="${(parseFloat(rx)-3).toFixed(1)}" y="${(parseFloat(ry)-3).toFixed(1)}" width="${SLD_NW+6}" height="${SLD_NH+6}" rx="8" fill="${col}" opacity="0.18"/>`;

  const orphan = n._orphan;
  s += `<rect x="${rx}" y="${ry}" width="${SLD_NW}" height="${SLD_NH}" rx="5"
    fill="${selected ? col+'28' : orphan ? '#0d1018' : '#111a28'}"
    stroke="${orphan ? col+'55' : col}" stroke-width="${selected ? 2 : 1.5}"
    ${orphan ? 'stroke-dasharray="5,3"' : ''}/>`;

  if (n._sammel) {
    s += _chipReihe(n, x, y + 2, col);
  } else {
    s += _symbolShape(n.type, col, x, y);
  }
  s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${col}" font-weight="500">${_passend(_knotenName(n), SLD_CW - 6, 9)}</text>`;

  const spec = n._sammel
    ? `${n._chips.length} Anlagen`
    : _spec(n);
  if (spec) s += `<text x="${x.toFixed(1)}" y="${(y+SLD_NH/2+23).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#546e7a">${_passend(spec, SLD_CW - 6, 7.5)}</text>`;

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
  // Der Balken IST die NSHV des Gebäudes — er trägt ihre Farbe, nicht die des
  // Stellvertreters (Schaltanlage/Trafo). Die stehen als Symbol darunter.
  const cfg = ASSET_CFG[n._schiene && n._sammel ? 'NSHV' : n.type] || { color:'#607d8b', icon:'·', label:n.type };
  const col = cfg.color;
  const { x, y } = n;
  const bh = 14;
  // Über die Breite der Abgänge gespannt, sonst als schmaler Balken
  const von = n._bus ? n._bus.von : x - (SLD_CW - 8) / 2;
  const bis = n._bus ? n._bus.bis : x + (SLD_CW - 8) / 2;
  const bw  = Math.max(SLD_NW, bis - von);
  const mx  = (von + bis) / 2;

  let s = `<g data-assetid="${n.id}" style="cursor:pointer;">`;
  s += `<rect x="${(von-4).toFixed(1)}" y="${(y-bh/2-4).toFixed(1)}" width="${(bw+8).toFixed(1)}" height="${bh+8}" rx="5" fill="transparent"/>`;
  if (selected) s += `<rect x="${(von-4).toFixed(1)}" y="${(y-bh/2-4).toFixed(1)}" width="${(bw+8).toFixed(1)}" height="${bh+8}" rx="5" fill="${col}" opacity="0.15"/>`;
  s += `<rect x="${von.toFixed(1)}" y="${(y-bh/2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="3" fill="${selected?col+'30':'#182435'}" stroke="${col}" stroke-width="${selected?2:1.8}"/>`;
  // Beschriftung am Einspeisepunkt, nicht in der Balkenmitte: dort kommt die
  // Zuleitung an, dort sucht das Auge den Namen.
  const beschrX = n._bus ? Math.min(Math.max(x, von + 46), bis - 46) : mx;
  s += `<text x="${beschrX.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${col}" font-weight="600">${cfg.icon} ${_passend(_knotenName(n), Math.min(bw, SLD_CW) - 14, 9)}</text>`;
  // Zusammengefasstes Gebäude: die Anlagen hängen als Symbolreihe unter der
  // Schiene, darunter ihre Anzahl — dieselbe Information wie im Gebäude-Kasten.
  if (n._sammel) {
    s += _chipReihe(n, beschrX, y + bh/2 + 14, col);
    s += `<text x="${beschrX.toFixed(1)}" y="${(y+bh/2+25).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#546e7a">${n._chips.length} Anlagen</text>`;
    return s + '</g>';
  }
  const spec = _spec(n);
  if (spec) s += `<text x="${beschrX.toFixed(1)}" y="${(y+bh/2+11).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#546e7a">${_passend(spec, Math.min(bw, SLD_CW), 7.5)}</text>`;
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

// ── Hover-Tooltip (gleiche Popup-Optik wie auf der Karte) ────────────────────
// Die SVG ist statisches innerHTML ohne Leaflet — Tooltips werden daher als
// eigenes, mausverfolgtes .geb-tooltip-Div gebaut, mit denselben Bau-Funktionen
// (_buildAssetTooltip / buildStromEdgeTooltip), die auch die Kartenmarker nutzen.
// .geb-tooltip selbst ist bereits global gestylt (s. 03c-gebaeude-io.js).
let _sldTooltipEl = null;
function _sldTooltip() {
  if (_sldTooltipEl) return _sldTooltipEl;
  const el = document.createElement('div');
  el.className = 'geb-tooltip';
  el.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;display:none;max-width:260px;';
  document.body.appendChild(el);
  _sldTooltipEl = el;
  return el;
}
function _sldMoveTooltip(cx, cy) {
  const el = _sldTooltipEl;
  if (!el || el.style.display === 'none') return;
  el.style.left = (cx + 16) + 'px';
  el.style.top  = (cy + 16) + 'px';
}
function _sldHideTooltip() {
  if (_sldTooltipEl) _sldTooltipEl.style.display = 'none';
}
function _sldOnHover(ev) {
  const gA = ev.target.closest('[data-assetid]');
  if (gA) {
    const asset = getAsset(gA.dataset.assetid);
    if (!asset) return;
    const el = _sldTooltip();
    el.innerHTML = _buildAssetTooltip(asset);
    el.style.display = 'block';
    _sldMoveTooltip(ev.clientX, ev.clientY);
    return;
  }
  const gE = ev.target.closest('[data-edgeid]');
  if (gE) {
    const edge = (window.stromEdges || []).find(e => e.id === gE.dataset.edgeid);
    if (!edge) return;
    const el = _sldTooltip();
    el.innerHTML = buildStromEdgeTooltip(edge);
    el.style.display = 'block';
    _sldMoveTooltip(ev.clientX, ev.clientY);
  }
}
function _sldOnHoverOut(ev) {
  const related = ev.relatedTarget;
  if (related?.closest?.('[data-assetid]') || related?.closest?.('[data-edgeid]')) return;
  _sldHideTooltip();
}
function _sldBindHover(canvas) {
  if (canvas.dataset.hoverBound) return;
  canvas.dataset.hoverBound = '1';
  canvas.addEventListener('mouseover', _sldOnHover);
  canvas.addEventListener('mousemove', ev => _sldMoveTooltip(ev.clientX, ev.clientY));
  canvas.addEventListener('mouseout', _sldOnHoverOut);
}

// ── Dynamische Lastfluss-Animation (wie auf der Karte, s. animateStromPipes) ──
let _sldFlowAnimRunning = false;
let _sldDashOffset = 0;
function _sldAnimateFlow() {
  const panel  = document.getElementById('sld-panel');
  const active = panel?.classList.contains('visible') && window.stromDynamicViz !== false;
  if (!active) { _sldFlowAnimRunning = false; return; }
  _sldDashOffset -= 0.6;
  document.getElementById('sld-svg')?.querySelectorAll('.sld-flow-path').forEach(path => {
    const dir = parseFloat(path.dataset.flowdir) || 1;
    path.style.strokeDashoffset = (_sldDashOffset * dir) + 'px';
  });
  requestAnimationFrame(_sldAnimateFlow);
}
function _sldStartFlowAnim() {
  if (_sldFlowAnimRunning) return;
  _sldFlowAnimRunning = true;
  requestAnimationFrame(_sldAnimateFlow);
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
      <div style="font-weight:600;font-size:12px;">${_knotenName(asset)}</div>
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
