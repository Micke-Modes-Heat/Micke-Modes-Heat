// ── 05b-stromnetz.js — Elektrisches Netz, Kabel, Trafo, Spannungsfall ──

// ══════════════════════════════════════════════════════════════════
// STROMNETZ — Elektrisches Netz (Planungsskizze Level A)
// ══════════════════════════════════════════════════════════════════

// ── Styled Modal-Dialoge ────────────────────────────────────────
import { areaLatLngs, bhkw, freiflaechen, gebaeude, geoThermie, lwWp, trassePoints, trasseSegments } from './01-globals-varianten.js';
import { getGebStromMwh, map } from './02b-gebaeude.js';
import { polygonAreaM2, polygonCenter } from './02c-karte-werkzeuge.js';
import { setNetzVisible } from './03b-netz.js';
import { calcGebKwp, hideHint, showHint, startAnimStrom } from './03c-gebaeude-io.js';
import { _hideForDraw, _restoreAfterDraw, setLeftTab } from './04a-ui-panels.js';
import { KABEL_TYPEN, TRAFO_GROESSEN } from './config/netz-kosten.js';
import { ASSETS, TYPE_RANK, getAssetStatus } from './13a-assets-core.js';

export function epConfirm(title, message, opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    const overlay = document.createElement('div');
    overlay.className = 'ep-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'ep-modal';
    const cancelTxt = opts.cancelText !== undefined ? opts.cancelText : 'Abbrechen';
    modal.innerHTML = '<div class="ep-modal-title">' + title + '</div>' +
      '<div class="ep-modal-body">' + message + '</div>' +
      '<div class="ep-modal-btns">' +
        (cancelTxt ? '<button class="ep-modal-btn" id="ep-m-cancel">' + cancelTxt + '</button>' : '') +
        '<button class="ep-modal-btn ' + (opts.danger ? 'danger' : 'primary') + '" id="ep-m-ok">' + (opts.okText || 'OK') + '</button>' +
      '</div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = function(val) { document.body.removeChild(overlay); resolve(val); };
    const cancelBtn = modal.querySelector('#ep-m-cancel');
    if (cancelBtn) cancelBtn.onclick = function() { close(false); };
    modal.querySelector('#ep-m-ok').onclick = function() { close(true); };
    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) close(false); });
    modal.querySelector('#ep-m-ok').focus();
  });
}

export function epPrompt(title, message, defaultVal, opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    const overlay = document.createElement('div');
    overlay.className = 'ep-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'ep-modal';
    modal.innerHTML = '<div class="ep-modal-title">' + title + '</div>' +
      '<div class="ep-modal-body">' + message +
        '<input class="ep-modal-input" id="ep-m-input" type="' + (opts.type || 'text') + '" value="' + (defaultVal || '') + '">' +
      '</div>' +
      '<div class="ep-modal-btns">' +
        '<button class="ep-modal-btn" id="ep-m-cancel">Abbrechen</button>' +
        '<button class="ep-modal-btn primary" id="ep-m-ok">' + (opts.okText || 'OK') + '</button>' +
      '</div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const input = modal.querySelector('#ep-m-input');
    const close = function(val) { document.body.removeChild(overlay); resolve(val); };
    modal.querySelector('#ep-m-cancel').onclick = function() { close(null); };
    modal.querySelector('#ep-m-ok').onclick = function() { close(input.value); };
    input.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') close(input.value); if (ev.key === 'Escape') close(null); });
    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) close(null); });
    input.focus();
    input.select();
  });
}

export function openCableInspector(edge) {
  const overlay = document.createElement('div');
  overlay.className = 'ep-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'ep-modal';

  const kt0 = KABEL_TYPEN[edge.cableType] || KABEL_TYPEN.NAYY;
  const FUSE_SIZES = [0, 16, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250];
  const typeOpts = Object.entries(KABEL_TYPEN)
    .map(([k, v]) => `<option value="${k}"${k === edge.cableType ? ' selected' : ''}>${v.label}</option>`)
    .join('');
  const fuseOpts = FUSE_SIZES
    .map(a => `<option value="${a}"${a === (edge.fuseA || 0) ? ' selected' : ''}>${a === 0 ? '— kein —' : a + ' A'}</option>`)
    .join('');

  const auslColor = edge.auslastungPct < 80 ? '#4caf50' : edge.auslastungPct < 100 ? '#f9a825' : '#e53935';
  const duColor   = edge.deltaUPct   < 1   ? '#4caf50' : edge.deltaUPct   < 3   ? '#f9a825' : '#e53935';

  modal.innerHTML = `
    <div class="ep-modal-title">Kabel bearbeiten</div>
    <div class="ci-info">
      <div class="ci-info-item">Länge<br><span>${Math.round(edge.lengthM || 0)} m</span></div>
      <div class="ci-info-item">Leistung<br><span>${Math.abs(edge.peakFlowKw || 0).toFixed(1)} kW</span></div>
      <div class="ci-info-item">Auslastung<br><span style="color:${auslColor}">${(edge.auslastungPct || 0).toFixed(1)} %</span></div>
      <div class="ci-info-item">Spannungsfall<br><span style="color:${duColor}">${(edge.deltaUPct || 0).toFixed(2)} %</span></div>
    </div>
    <div class="ci-field">
      <label>Kabeltyp</label>
      <select class="ci-select" id="ci-type">${typeOpts}</select>
    </div>
    <div class="ci-field">
      <label>Querschnitt</label>
      <select class="ci-select" id="ci-qs"></select>
    </div>
    <div class="ci-field">
      <label>Sicherung</label>
      <select class="ci-select" id="ci-fuse">${fuseOpts}</select>
    </div>
    <div class="ci-field">
      <label>Parallelkabel</label>
      <input class="ci-select" id="ci-parallel" type="number" min="1" max="8" step="1"
        value="${edge.nParallel || 1}" style="text-align:center;">
    </div>
    <div class="ci-field" style="margin-bottom:16px;">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" id="ci-auto"${edge.autoSized ? ' checked' : ''}>
        Automatisch dimensionieren
      </label>
    </div>
    <div class="ep-modal-btns">
      <button class="ep-modal-btn danger" id="ci-del">Löschen</button>
      <button class="ep-modal-btn" id="ci-cancel">Abbrechen</button>
      <button class="ep-modal-btn primary" id="ci-ok">Übernehmen</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const typeEl     = modal.querySelector('#ci-type');
  const qsEl       = modal.querySelector('#ci-qs');
  const fuseEl     = modal.querySelector('#ci-fuse');
  const parallelEl = modal.querySelector('#ci-parallel');
  const autoEl     = modal.querySelector('#ci-auto');

  function populateQs(typeName, selected) {
    const kt = KABEL_TYPEN[typeName] || KABEL_TYPEN.NAYY;
    qsEl.innerHTML = kt.sections
      .map(s => `<option value="${s.mm2}"${s.mm2 === selected ? ' selected' : ''}>${s.mm2} mm² (Iz ${s.Iz} A)</option>`)
      .join('');
    qsEl.disabled = autoEl.checked;
  }
  populateQs(edge.cableType || 'NAYY', edge.crossSection);

  typeEl.addEventListener('change', () => populateQs(typeEl.value, null));
  autoEl.addEventListener('change', () => { qsEl.disabled = autoEl.checked; });

  const close = () => document.body.removeChild(overlay);

  modal.querySelector('#ci-del').onclick = () => {
    close();
    epConfirm('Kabel entfernen',
      'Dieses Kabel (' + (edge.cableType || 'NAYY') + ' ' + (edge.crossSection || '?') + ' mm²) entfernen?',
      { danger: true, okText: 'Entfernen' }
    ).then(ok => { if (ok) removeStromEdge(edge); });
  };
  modal.querySelector('#ci-cancel').onclick = close;
  overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });

  modal.querySelector('#ci-ok').onclick = () => {
    edge.cableType    = typeEl.value;
    edge.autoSized    = autoEl.checked;
    edge.crossSection = autoEl.checked ? 0 : parseInt(qsEl.value);
    edge.fuseA        = parseInt(fuseEl.value) || 0;
    edge.nParallel    = Math.max(1, parseInt(parallelEl.value) || 1);
    close();
    recalcStromNetz();
    if (typeof window.sldRefresh === 'function') window.sldRefresh();
  };
}

export function setNetzSubTab(sub) {
  // Leitet auf den eigenen Elektro-Tab um (Sub-Tabs wurden entfernt)
  if (sub === 'strom') {
    setLeftTab('elektro');
  } else {
    setLeftTab('netz');
  }
}

// ── Stromnetz-Knoten Icons ──────────────────────────────────────
export function stromNodeIcon(type) {
  const cfg = {
    nap:   { cls: 'strom-icon strom-icon-nap',   text: '⚡', size: [28,28] },
    trafo: { cls: 'strom-icon strom-icon-trafo',  text: '⏚',  size: [26,26] },
    nshv:  { cls: 'strom-icon strom-icon-nshv',   text: '▦',  size: [24,24] },
  };
  const c = cfg[type] || cfg.nshv;
  return L.divIcon({
    className: '',
    html: '<div class="' + c.cls + '">' + c.text + '</div>',
    iconSize: c.size,
    iconAnchor: [c.size[0]/2, c.size[1]/2]
  });
}

// ── Platzierung von Stromnetz-Komponenten ────────────────────────
export function startPlaceStromNode(type) {
  // Cancel any other placement mode
  if (window.isPlacingStromNode === type) { cancelPlaceStromNode(); return; }
  cancelPlaceStromNode();
  window.isPlacingStromNode = type;
  const btnId = { nap: 'btn-place-nap', trafo: 'btn-place-trafo', nshv: 'btn-place-nshv' }[type];
  const btn = document.getElementById(btnId);
  if (btn) { btn.style.background = 'rgba(79,195,247,0.2)'; btn.style.fontWeight = 'bold'; }
  _hideForDraw();
  map.getContainer().style.cursor = 'crosshair';
  map.once('click', function(ev) {
    if (!window.isPlacingStromNode) return;
    const nodeType = window.isPlacingStromNode;
    cancelPlaceStromNode();
    addStromNode(nodeType, ev.latlng);
    recalcStromNetz();
  });
}

export function cancelPlaceStromNode() {
  window.isPlacingStromNode = null;
  map.getContainer().style.cursor = '';
  _restoreAfterDraw();
  ['btn-place-nap','btn-place-trafo','btn-place-nshv'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.style.background = ''; b.style.fontWeight = ''; }
  });
}

export function addStromNode(type, latlng, props) {
  props = props || {};
  const id = props.id || window.stromNextId++;
  if (id >= window.stromNextId) window.stromNextId = id + 1;

  const labels = { nap: 'NAP', trafo: 'Trafo', nshv: 'NSHV' };
  const count = window.stromNodes.filter(n => n.type === type).length + 1;
  const label = props.label || (labels[type] || type) + ' ' + count;

  const marker = L.marker(latlng, { icon: stromNodeIcon(type), draggable: true, zIndexOffset: 3000 });
  marker.bindTooltip(function() {
    const n = window.stromNodes.find(sn => sn.id === id);
    if (!n) return label;
    let tt = '<b>' + n.label + '</b> (' + type.toUpperCase() + ')';
    if (type === 'trafo') tt += '<br>Nennleistung: ' + (n.ratedKva || 630) + ' kVA';
    if (type === 'nap') tt += '<br>Anschlussleistung: ' + (n.maxKva || '∞') + ' kVA';
    if (n.peakLoadKw != null) tt += '<br>Last: ' + n.peakLoadKw.toFixed(1) + ' kW';
    return tt;
  }, { sticky: true, className: 'geb-tooltip' });

  if (window.stromNetzVisible) marker.addTo(map);

  marker.on('dragend', function() {
    const n = window.stromNodes.find(sn => sn.id === id);
    if (n) { n.lat = marker.getLatLng().lat; n.lng = marker.getLatLng().lng; }
    updateStromEdgeGeometry();
    recalcStromNetz();
  });

  // Right-click to delete
  marker.on('contextmenu', function(ev) {
    L.DomEvent.stop(ev);
    epConfirm('Knoten entfernen', 'Strom-Knoten <b>"' + label + '"</b> und alle angeschlossenen Kabel entfernen?', { danger: true, okText: 'Entfernen' }).then(function(ok) {
      if (ok) removeStromNode(id);
    });
  });

  const node = {
    id: id, type: type, lat: latlng.lat, lng: latlng.lng, marker: marker, label: label,
    maxKva: props.maxKva || (type === 'nap' ? 0 : undefined),
    ratedKva: props.ratedKva || (type === 'trafo' ? 630 : undefined),
    ukPct: props.ukPct || (type === 'trafo' ? 4 : undefined),
    peakLoadKw: 0, annualMwh: 0, isProducer: false
  };
  window.stromNodes.push(node);

  // Trafo: prompt for size
  if (type === 'trafo' && !props.ratedKva) {
    epPrompt('Trafo konfigurieren', 'Nennleistung in kVA (Standard: 250, 400, 630, 1000, 1600):', '630', { type: 'number', okText: 'Setzen' }).then(function(size) {
      if (size && !isNaN(parseFloat(size))) { node.ratedKva = parseFloat(size); recalcStromNetz(); }
    });
  }

  updateLpStromSummary();
  return node;
}

export function removeStromNode(id) {
  // Remove connected edges first
  window.stromEdges.filter(e => e.u === id || e.v === id).forEach(e => removeStromEdge(e));
  const idx = window.stromNodes.findIndex(n => n.id === id);
  if (idx >= 0) {
    const n = window.stromNodes[idx];
    if (n.marker && map.hasLayer(n.marker)) map.removeLayer(n.marker);
    window.stromNodes.splice(idx, 1);
  }
  recalcStromNetz();
  updateLpStromSummary();
}

// ── Kabel (Strom-Kanten) ────────────────────────────────────────
export function startDrawStromEdge() {
  if (window.isDrawingStromEdge) { cancelDrawStromEdge(); return; }
  // Andere Modi beenden
  if (window.isDrawingTrasse && typeof window.toggleDrawTrasse === 'function') window.toggleDrawTrasse();
  if (typeof window.setPendingType === 'function' && window._pendingAssetType) window.setPendingType(window._pendingAssetType);
  window.isDrawingStromEdge = true;
  window.stromEdgeStartId = null;
  const btn = document.getElementById('btn-draw-strom-edge');
  if (btn) { btn.style.background = 'rgba(79,195,247,0.2)'; btn.style.fontWeight = 'bold'; }
  map.getContainer().style.cursor = 'crosshair';
}

export function cancelDrawStromEdge() {
  window.isDrawingStromEdge = false;
  window.stromEdgeStartId = null;
  map.getContainer().style.cursor = '';
  const btn = document.getElementById('btn-draw-strom-edge');
  if (btn) { btn.style.background = ''; btn.style.fontWeight = ''; }
}

export function stromNodeClick(nodeId) {
  if (!window.isDrawingStromEdge) return false;
  if (window.stromEdgeStartId == null) {
    window.stromEdgeStartId = nodeId;
    const n = window.stromNodes.find(sn => sn.id === nodeId);
    if (n && n.marker) n.marker.setOpacity(0.5);
    return true;
  }
  // Gleiche Komponente nochmal angeklickt → Startpunkt zurücksetzen, Modus bleibt aktiv
  const sn = window.stromNodes.find(s => s.id === window.stromEdgeStartId);
  if (sn && sn.marker) sn.marker.setOpacity(1);
  const startId = window.stromEdgeStartId;
  window.stromEdgeStartId = null;
  if (nodeId === startId) return true;
  // Doppelte Kante ignorieren
  const exists = window.stromEdges.some(e =>
    (e.u === startId && e.v === nodeId) || (e.u === nodeId && e.v === startId)
  );
  if (!exists) {
    addStromEdge(startId, nodeId);
    recalcStromNetz();
  }
  return true;
}

// ── Trassen-Routing für Elektroleitungen (portiert aus Energiekarte1.1) ───────
// Konvertiert window.trassePoints + window.trasseSegments in das EL.trassen-Format
function _getTrassenForRouting() {
  const pts = window.trassePoints;
  const segs = window.trasseSegments;
  if (!pts || pts.length < 2 || !segs || segs.length === 0) return [];
  return segs
    .map((seg, i) => ({
      id: 'seg_' + i,
      pts: pts.slice(seg.start, seg.end + 1).map(p => [p.lat, p.lng])
    }))
    .filter(t => t.pts.length >= 2);
}

function _elPtDist(a, b) {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
}

function _elProjOnSeg(p, a, b) {
  const ax = a[1], ay = a[0], bx = b[1], by = b[0], px = p[1], py = p[0];
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { t: 0, pt: a };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { t, pt: [ay + t * dy, ax + t * dx] };
}

// Baut Graph aus Trassen-Segmenten mit Cross-Trassen-Verbindungen
function _elBuildGraph(trassen) {
  const SNAP_M = 20;
  const nodeMap = new Map();
  const key = pt => pt[0].toFixed(7) + ',' + pt[1].toFixed(7);

  function getNode(pt) {
    const k = key(pt);
    if (!nodeMap.has(k)) nodeMap.set(k, { id: k, lat: pt[0], lng: pt[1], adj: [] });
    return nodeMap.get(k);
  }
  function addEdge(nA, nB) {
    const d = _elPtDist([nA.lat, nA.lng], [nB.lat, nB.lng]);
    if (!nA.adj.some(a => a.toKey === nB.id)) nA.adj.push({ toKey: nB.id, dist: d });
    if (!nB.adj.some(a => a.toKey === nA.id)) nB.adj.push({ toKey: nA.id, dist: d });
  }

  for (const tr of trassen) {
    for (let i = 0; i < tr.pts.length - 1; i++) {
      addEdge(getNode(tr.pts[i]), getNode(tr.pts[i + 1]));
    }
  }

  // Cross-Trassen-Snapping: Enden nahe anderer Trassen verbinden
  const snapsBySegment = new Map();
  for (const tr of trassen) {
    const endpoints = [tr.pts[0], tr.pts[tr.pts.length - 1]];
    for (const ep of endpoints) {
      const kEp = key(ep);
      const nEp = nodeMap.get(kEp); if (!nEp) continue;
      let best = null;
      for (const other of trassen) {
        if (other.id === tr.id) continue;
        for (let i = 0; i < other.pts.length - 1; i++) {
          const { pt: proj, t } = _elProjOnSeg(ep, other.pts[i], other.pts[i + 1]);
          const d = _elPtDist(ep, proj);
          if (d < SNAP_M && (!best || d < best.d))
            best = { d, proj, t, ptA: other.pts[i], ptB: other.pts[i + 1], otherId: other.id, segIdx: i };
        }
      }
      if (!best) continue;
      const segKey = `${best.otherId}:${best.segIdx}`;
      if (!snapsBySegment.has(segKey))
        snapsBySegment.set(segKey, { ptA: best.ptA, ptB: best.ptB, snaps: [] });
      snapsBySegment.get(segKey).snaps.push({ t: best.t, proj: best.proj, kEp, nEp });
    }
  }
  for (const { ptA, ptB, snaps } of snapsBySegment.values()) {
    const kA = key(ptA), kB = key(ptB);
    const nA = nodeMap.get(kA), nB = nodeMap.get(kB);
    if (!nA || !nB) continue;
    nA.adj = nA.adj.filter(a => a.toKey !== kB);
    nB.adj = nB.adj.filter(a => a.toKey !== kA);
    const interior = [];
    for (const { t, proj, kEp, nEp } of snaps) {
      if (t < 1e-5) {
        if (kEp !== kA) addEdge(nEp, nA);
      } else if (t > 1 - 1e-5) {
        if (kEp !== kB) addEdge(nEp, nB);
      } else {
        const kP = key(proj);
        if (!nodeMap.has(kP)) nodeMap.set(kP, { id: kP, lat: proj[0], lng: proj[1], adj: [] });
        const nP = nodeMap.get(kP);
        if (kEp !== kP) addEdge(nEp, nP);
        if (!interior.some(s => s.k === kP)) interior.push({ k: kP, n: nP, t });
      }
    }
    interior.sort((a, b) => a.t - b.t);
    let prevKey = kA, prevNode = nA;
    for (const { k, n } of interior) {
      if (prevKey !== k) addEdge(prevNode, n);
      prevKey = k; prevNode = n;
    }
    if (prevKey !== kB) addEdge(prevNode, nB);
  }
  return nodeMap;
}

function _elClosestOnTrasse(trassen, lat, lng) {
  const p = [lat, lng]; let best = null;
  for (const tr of trassen) {
    for (let i = 0; i < tr.pts.length - 1; i++) {
      const { pt } = _elProjOnSeg(p, tr.pts[i], tr.pts[i + 1]);
      const d = _elPtDist(p, pt);
      if (!best || d < best.dist) best = { trasseId: tr.id, segIdx: i, pt, dist: d };
    }
  }
  return best;
}

function _elDijkstra(nodeMap, startKey, endKey) {
  if (startKey === endKey) return [[nodeMap.get(startKey).lat, nodeMap.get(startKey).lng]];
  const dist = new Map(), prev = new Map(), vis = new Set();
  dist.set(startKey, 0);
  const q = [[0, startKey]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, u] = q.shift();
    if (vis.has(u)) continue;
    vis.add(u);
    if (u === endKey) break;
    const node = nodeMap.get(u); if (!node) continue;
    for (const { toKey, dist: ed } of node.adj) {
      const nd = d + ed;
      if (!dist.has(toKey) || nd < dist.get(toKey)) {
        dist.set(toKey, nd); prev.set(toKey, { from: u }); q.push([nd, toKey]);
      }
    }
  }
  if (!dist.has(endKey)) return null;
  const path = []; let cur = endKey;
  while (cur) { const node = nodeMap.get(cur); if (node) path.unshift([node.lat, node.lng]); cur = prev.get(cur)?.from; }
  return path;
}

// Vollständiges Routing: von Punkt A nach B entlang Trassen (mit virtuellem Knoteneinstieg)
function routeAlongTrasse(from, to) {
  const trassen = _getTrassenForRouting();
  if (trassen.length === 0) return null;

  const ptA = [from.lat, from.lng];
  const ptB = [to.lat,   to.lng];
  const nodeMap = _elBuildGraph(trassen);
  if (nodeMap.size === 0) return null;

  const projA = _elClosestOnTrasse(trassen, from.lat, from.lng);
  const projB = _elClosestOnTrasse(trassen, to.lat,   to.lng);
  if (!projA || !projB) return null;

  const key = pt => pt[0].toFixed(7) + ',' + pt[1].toFixed(7);

  function insertVirtual(proj) {
    const tr = trassen.find(t => t.id === proj.trasseId); if (!tr) return null;
    const ptPrev = tr.pts[proj.segIdx], ptNext = tr.pts[proj.segIdx + 1];
    const kPrev = key(ptPrev), kNext = key(ptNext);
    const kVirt = key(proj.pt);
    if (nodeMap.has(kVirt)) return kVirt;
    const { t: tVirt } = _elProjOnSeg(proj.pt, ptPrev, ptNext);
    const segNodes = [{ k: kPrev, t: 0.0 }, { k: kNext, t: 1.0 }];
    for (const [k, n] of nodeMap) {
      if (k === kPrev || k === kNext) continue;
      const { t, pt: onPt } = _elProjOnSeg([n.lat, n.lng], ptPrev, ptNext);
      if (t > 1e-4 && t < 1 - 1e-4 && _elPtDist([n.lat, n.lng], onPt) < 2.0)
        segNodes.push({ k, t });
    }
    segNodes.sort((a, b) => a.t - b.t);
    const vn = { id: kVirt, lat: proj.pt[0], lng: proj.pt[1], adj: [] };
    nodeMap.set(kVirt, vn);
    const prevNb = [...segNodes].reverse().find(sn => sn.t <= tVirt + 1e-9);
    const nextNb = segNodes.find(sn => sn.t >= tVirt - 1e-9);
    [prevNb, nextNb].forEach(nb => {
      if (!nb || nb.k === kVirt) return;
      const nbNode = nodeMap.get(nb.k); if (!nbNode) return;
      const d = _elPtDist(proj.pt, [nbNode.lat, nbNode.lng]);
      if (!vn.adj.some(a => a.toKey === nb.k)) {
        vn.adj.push({ toKey: nb.k, dist: d });
        nbNode.adj.push({ toKey: kVirt, dist: d });
      }
    });
    return kVirt;
  }

  const kA = insertVirtual(projA), kB = insertVirtual(projB);
  if (!kA || !kB) return null;

  // Gleicher Abschnitt → direkte Kante einfügen (verhindert Umweg-Bug)
  if (kA !== kB && projA.trasseId === projB.trasseId && projA.segIdx === projB.segIdx) {
    const dAB = _elPtDist(projA.pt, projB.pt);
    nodeMap.get(kA)?.adj.push({ toKey: kB, dist: dAB });
    nodeMap.get(kB)?.adj.push({ toKey: kA, dist: dAB });
  }

  const trassePth = _elDijkstra(nodeMap, kA, kB);
  if (!trassePth || trassePth.length === 0) return null;

  const route = [ptA];
  if (_elPtDist(ptA, projA.pt) > 2) route.push(projA.pt);
  for (const pt of trassePth) {
    const last = route[route.length - 1];
    if (!last || _elPtDist(last, pt) > 0.5) route.push(pt);
  }
  if (_elPtDist(ptB, projB.pt) > 2) {
    const last = route[route.length - 1];
    if (!last || _elPtDist(last, projB.pt) > 0.5) route.push(projB.pt);
  }
  route.push(ptB);

  // Rückgabe als Leaflet LatLng-Array
  return route.map(p => L.latLng(p[0], p[1]));
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i - 1].distanceTo(pts[i]);
  return len;
}

export function addStromEdge(uId, vId) {
  const uNode = window.stromNodes.find(n => n.id === uId);
  const vNode = window.stromNodes.find(n => n.id === vId);
  if (!uNode || !vNode) return null;

  const pt1 = L.latLng(uNode.lat, uNode.lng);
  const pt2 = L.latLng(vNode.lat, vNode.lng);

  const routed = routeAlongTrasse(pt1, pt2);
  const linePts = routed || [pt1, pt2];
  const lengthM = routed ? polylineLength(routed) : pt1.distanceTo(pt2);

  const defaultType = document.getElementById('strom-kabel-typ')?.value || 'NAYY';

  const layer = L.polyline(linePts, {
    color: '#fdd835', weight: 3, opacity: 0.8, dashArray: '8,4', pane: 'netzPane', interactive: true
  });
  const hitLayer = L.polyline(linePts, {
    color: 'transparent', weight: 16, opacity: 0, interactive: true, pane: 'netzPane'
  });

  if (window.stromNetzVisible) { layer.addTo(map); hitLayer.addTo(map); }

  const edge = {
    id: 'se_' + Math.random().toString(36).slice(2, 9),
    u: uId, v: vId, uNode: uNode, vNode: vNode,
    layer: layer, hitLayer: hitLayer, arrowMarker: null,
    cableType: defaultType, crossSection: 0, autoSized: true, fuseA: 0, nParallel: 1,
    lengthM: lengthM,
    peakCurrentA: 0, ratedCurrentA: 0, auslastungPct: 0,
    deltaUPct: 0, peakFlowKw: 0, flowDirection: 1
  };

  // Tooltip
  hitLayer.bindTooltip(function() { return buildStromEdgeTooltip(edge); }, { sticky: true, className: 'geb-tooltip' });

  // Left-click to inspect / edit (both layers for reliable hit detection)
  function onCableClick(ev) {
    if (window.isDrawingStromEdge) return;
    L.DomEvent.stop(ev);
    openCableInspector(edge);
  }
  layer.on('click', onCableClick);
  hitLayer.on('click', onCableClick);

  // Right-click to delete
  hitLayer.on('contextmenu', function(ev) {
    L.DomEvent.stop(ev);
    epConfirm('Kabel entfernen', 'Dieses Kabel (' + (edge.cableType || 'NAYY') + ' ' + (edge.crossSection || '?') + ' mm²) entfernen?', { danger: true, okText: 'Entfernen' }).then(function(ok) {
      if (ok) removeStromEdge(edge);
    });
  });

  window.stromEdges.push(edge);
  startAnimStrom();
  return edge;
}

export function buildStromEdgeTooltip(e) {
  const kt = KABEL_TYPEN[e.cableType] || {};
  const np = (e.nParallel || 1) > 1 ? (e.nParallel + '× ') : '';
  let tt = '<b>' + np + e.cableType + ' ' + e.crossSection + ' mm²</b>';
  tt += '<br>Länge: ' + e.lengthM.toFixed(0) + ' m';
  tt += '<br>Leistung: ' + Math.abs(e.peakFlowKw).toFixed(1) + ' kW';
  tt += ' (' + (e.flowDirection > 0 ? '→ Verbraucher' : '← Rückspeisung') + ')';
  if (e._nVerbraucher > 0) tt += '<br>Verbraucher: ' + e._nVerbraucher + ' (GZF ' + (e._gzf != null ? e._gzf.toFixed(2) : '1.00') + ')';
  tt += '<br>Strom: ' + e.peakCurrentA.toFixed(1) + ' / ' + e.ratedCurrentA.toFixed(0) + ' A';
  const auslColor = e.auslastungPct < 80 ? '#4caf50' : e.auslastungPct < 100 ? '#f9a825' : '#e53935';
  tt += '<br>Auslastung: <span style="color:' + auslColor + '">' + e.auslastungPct.toFixed(1) + ' %</span>';
  const duColor = e.deltaUPct < 1 ? '#4caf50' : e.deltaUPct < 2 ? '#8bc34a' : e.deltaUPct < 3 ? '#f9a825' : '#e53935';
  tt += '<br>Spannungsfall: <span style="color:' + duColor + '">' + e.deltaUPct.toFixed(2) + ' %</span>';
  if (e.fuseA > 0) {
    const fuseColor = e.peakCurrentA > e.fuseA ? '#e53935' : '#4caf50';
    tt += '<br>Sicherung: <span style="color:' + fuseColor + '">' + e.fuseA + ' A</span>';
  }
  return tt;
}

export function removeStromEdge(edge) {
  if (edge.layer && map.hasLayer(edge.layer)) map.removeLayer(edge.layer);
  if (edge.hitLayer && map.hasLayer(edge.hitLayer)) map.removeLayer(edge.hitLayer);
  if (edge.arrowMarker && map.hasLayer(edge.arrowMarker)) map.removeLayer(edge.arrowMarker);
  const idx = window.stromEdges.indexOf(edge);
  if (idx >= 0) window.stromEdges.splice(idx, 1);
  recalcStromNetz();
  updateLpStromSummary();
}

export function updateStromEdgeGeometry() {
  window.stromEdges.forEach(e => {
    const un = window.stromNodes.find(n => n.id === e.u);
    const vn = window.stromNodes.find(n => n.id === e.v);
    if (!un || !vn) return;
    const pt1 = L.latLng(un.lat, un.lng);
    const pt2 = L.latLng(vn.lat, vn.lng);
    const routed = routeAlongTrasse(pt1, pt2);
    const pts = routed || [pt1, pt2];
    e.layer.setLatLngs(pts);
    e.hitLayer.setLatLngs(pts);
    e.lengthM = routed ? polylineLength(routed) : pt1.distanceTo(pt2);
  });
}

// ── Stromnetz sichtbar/unsichtbar ───────────────────────────────
export function setStromNetzVisible(vis) {
  window.stromNetzVisible = vis;
  window.stromNodes.forEach(n => {
    // Asset-Marker werden vom Asset-Layer-System (standaloneLayer) verwaltet —
    // direktes addTo(map) würde Ghost-Duplikate erzeugen, da map.hasLayer()
    // Layer-Gruppen-Marker als "nicht auf Karte" meldet.
    if (!n.marker || n.isAsset) return;
    if (vis) { if (!map.hasLayer(n.marker)) n.marker.addTo(map); }
    else { if (map.hasLayer(n.marker)) map.removeLayer(n.marker); }
  });
  window.stromEdges.forEach(e => {
    if (vis) {
      if (!map.hasLayer(e.layer)) e.layer.addTo(map);
      if (!map.hasLayer(e.hitLayer)) e.hitLayer.addTo(map);
      if (e.arrowMarker && !map.hasLayer(e.arrowMarker)) e.arrowMarker.addTo(map);
    } else {
      if (map.hasLayer(e.layer)) map.removeLayer(e.layer);
      if (map.hasLayer(e.hitLayer)) map.removeLayer(e.hitLayer);
      if (e.arrowMarker && map.hasLayer(e.arrowMarker)) map.removeLayer(e.arrowMarker);
    }
  });
}

export function setStromSzenario(sz) {
  stromSzenario = sz;
  recalcStromNetz();
}

// Szenario-basierte Stunde finden
export function _getStromSzenarioHour() {
  const qH = window.elQuartierH;   // Gebäude-Grundlast (kWh)
  const wpH = window._wpElHourly;  // WP-Verbrauch (kWh)
  const skH = window._skElHourly;  // Stromkessel (kWh)
  const pvH = window.elPvH;        // PV-Erzeugung (kWh)
  const bhkwH = window._bhkwElHourly; // BHKW-Erzeugung (kWh)
  if (!qH) return -1; // Keine stündlichen Daten

  let bestH = 0, bestVal = -Infinity;
  for (let h = 0; h < 8760; h++) {
    const load = (qH[h]||0) + (wpH?wpH[h]:0) + (skH?skH[h]:0);
    const gen = (pvH?pvH[h]:0) + (bhkwH?bhkwH[h]:0);
    const netto = load - gen; // positiv = Netzbezug, negativ = Rückspeisung

    switch (stromSzenario) {
      case 'spitzenlast':
        if (load > bestVal) { bestVal = load; bestH = h; }
        break;
      case 'pvmax':
        if (gen > bestVal) { bestVal = gen; bestH = h; }
        break;
      case 'rueckspeisung':
        if (-netto > bestVal) { bestVal = -netto; bestH = h; } // max Rückspeisung = max negatives Netto
        break;
      case 'jahresmittel':
        return -2; // Sonderwert: Jahresmittel
    }
  }
  return bestH;
}

export function setStromColorMode(mode) {
  window.stromColorMode = mode;
  document.querySelectorAll('#lp-strom-viz .lp-tool-btn').forEach(b => {
    const isActive = b.getAttribute('onclick')?.includes("'" + mode + "'");
    b.style.background = isActive ? 'rgba(253,216,53,0.15)' : '';
    b.style.borderColor = isActive ? '#fdd835' : '';
    b.style.color = isActive ? '#fdd835' : '';
  });
  recalcStromNetz();
}

// ── Marker-Klick für Kabelzeichnen abfangen ─────────────────────
// Hook into stromNode marker clicks
export function hookStromNodeClicks() {
  window.stromNodes.forEach(n => {
    if (!n.marker) return;
    n.marker.off('click.stromEdge');
    n.marker.on('click.stromEdge', function() { stromNodeClick(n.id); });
  });
}

// ── Erzeuger/Verbraucher als Stromnetz-Knoten registrieren ──────
export function _autoRegisterErzeugerStromNodes() {
  const erzTypes = [];
  // Luft-Wasser WP
  if (lwWp && lwWp.lat && lwWp.lng) {
    erzTypes.push({ key: 'lwwp', lat: lwWp.lat, lng: lwWp.lng, label: 'Luft-WP', icon: '🌊', isProducer: false, color: '#66bb6a' });
  }
  // Geothermie WP
  if (geoThermie && geoThermie.lat && geoThermie.lng) {
    erzTypes.push({ key: 'geo', lat: geoThermie.lat, lng: geoThermie.lng, label: 'Geothermie-WP', icon: '⛏', isProducer: false, color: '#8d6e63' });
  }
  // BHKW
  if (bhkw && bhkw.lat && bhkw.lng) {
    erzTypes.push({ key: 'bhkw', lat: bhkw.lat, lng: bhkw.lng, label: 'BHKW', icon: '⚙', isProducer: true, color: '#ff9800' });
  }
  // Freiflächen-PV
  if (typeof freiflaechen !== 'undefined') {
    freiflaechen.forEach(ff => {
      if (!ff.polygon || ff.polygon.length < 3) return;
      const center = polygonCenter(ff.polygon);
      if (center) {
        erzTypes.push({ key: 'ff_' + ff.id, lat: center.lat, lng: center.lng, label: ff.name || 'PV-Fläche', icon: '☀', isProducer: true, color: '#fdd835' });
      }
    });
  }

  erzTypes.forEach(erz => {
    const erzId = 'erz_' + erz.key;
    const existing = window.stromNodes.find(n => n._erzKey === erz.key);
    if (existing) {
      // Update position
      existing.lat = erz.lat; existing.lng = erz.lng;
      if (existing.marker) existing.marker.setLatLng(L.latLng(erz.lat, erz.lng));
      return;
    }
    // Create new erzeuger strom node
    const erzIcon = L.divIcon({
      className: '',
      html: '<div class="strom-icon strom-icon-erz" style="background:' + erz.color + ';width:20px;height:20px;font-size:11px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.3);cursor:pointer;">' + erz.icon + '</div>',
      iconSize: [20, 20], iconAnchor: [10, 10]
    });
    const marker = L.marker(L.latLng(erz.lat, erz.lng), { icon: erzIcon, interactive: true, zIndexOffset: 2100 });
    marker.bindTooltip(() => {
      const n = window.stromNodes.find(sn => sn._erzKey === erz.key);
      let tt = '<b>' + erz.label + '</b>';
      if (n && n.peakLoadKw) tt += '<br>' + (n.isProducer ? 'Einspeisung' : 'Verbrauch') + ': ' + Math.abs(n.peakLoadKw).toFixed(1) + ' kW';
      if (n && n.annualMwh) tt += '<br>' + Math.abs(n.annualMwh).toFixed(1) + ' MWh/a';
      return tt;
    }, { sticky: true, className: 'geb-tooltip' });
    marker.on('click', function() { if (typeof stromNodeClick === 'function') stromNodeClick(marker._stromNodeId); });
    if (window.stromNetzVisible) marker.addTo(map);

    const nodeId = window.stromNextId++;
    marker._stromNodeId = nodeId;
    window.stromNodes.push({
      id: nodeId, type: 'erzeuger', _erzKey: erz.key,
      lat: erz.lat, lng: erz.lng, marker: marker,
      label: erz.label, peakLoadKw: 0, annualMwh: 0, isProducer: erz.isProducer
    });
  });
}

// ── Stromnetz Szenario-Auswahl ──────────────────────────────────
export let stromSzenario = 'spitzenlast'; // 'spitzenlast' | 'pvmax' | 'rueckspeisung' | 'jahresmittel'

// ── Auto-Connect unverbundener Stromnetz-Knoten ─────────────────
export function _autoConnectStromNodes() {
  const nap = window.stromNodes.find(n => n.type === 'nap');
  if (!nap) return;
  const connected = id => window.stromEdges.some(e => e.u === id || e.v === id);

  // 1. Trafos ohne Verbindung → NAP
  window.stromNodes.filter(n => n.type === 'trafo' && !connected(n.id)).forEach(t => {
    addStromEdge(nap.id, t.id);
  });

  // 2. NSHVs ohne Verbindung → nächster Trafo (oder NAP)
  window.stromNodes.filter(n => n.type === 'nshv' && !connected(n.id)).forEach(nshv => {
    const trafos = window.stromNodes.filter(n => n.type === 'trafo');
    let nearest = nap, minD = L.latLng(nshv.lat, nshv.lng).distanceTo(L.latLng(nap.lat, nap.lng));
    trafos.forEach(t => {
      const d = L.latLng(nshv.lat, nshv.lng).distanceTo(L.latLng(t.lat, t.lng));
      if (d < minD) { minD = d; nearest = t; }
    });
    addStromEdge(nearest.id, nshv.id);
  });

  // 3. Gebäude + Erzeuger ohne Verbindung → MST-Baum statt Stern
  const infra = window.stromNodes.filter(n => n.type === 'trafo' || n.type === 'nshv' || n.type === 'nap');
  if (!infra.length) return;
  const connPts = new Map();
  // Alle bereits verbundenen Knoten als Startmenge
  window.stromNodes.filter(n => connected(n.id)).forEach(n => connPts.set(n.id, { lat: n.lat, lng: n.lng }));
  infra.forEach(n => connPts.set(n.id, { lat: n.lat, lng: n.lng }));

  const unconnected = window.stromNodes
    .filter(n => (n.type === 'geb' || n.type === 'erzeuger') && !connected(n.id))
    .map(n => ({ id: n.id, lat: n.lat, lng: n.lng }));

  while (unconnected.length > 0) {
    let bestIdx = -1, bestConnId = null, bestDist = Infinity;
    for (let i = 0; i < unconnected.length; i++) {
      const c = unconnected[i];
      for (const [cId, pt] of connPts) {
        const d = L.latLng(c.lat, c.lng).distanceTo(L.latLng(pt.lat, pt.lng));
        if (d < bestDist) { bestDist = d; bestIdx = i; bestConnId = cId; }
      }
    }
    if (bestIdx < 0) break;
    const c = unconnected.splice(bestIdx, 1)[0];
    addStromEdge(bestConnId, c.id);
    connPts.set(c.id, { lat: c.lat, lng: c.lng });
  }
}

// ── Fortschrittsanzeige für Stromnetz-Berechnung ────────────────
export function _showStromProgress(msg) {
  let el = document.getElementById('strom-progress-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'strom-progress-overlay';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:19000;display:flex;align-items:center;justify-content:center;background:rgba(15,17,23,0.45);backdrop-filter:blur(1px);pointer-events:none;';
    el.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 28px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);"><div class="strom-spinner"></div><span id="strom-progress-text" style="color:var(--text);font-size:12px;">Berechne…</span></div>';
    document.body.appendChild(el);
  }
  const txt = document.getElementById('strom-progress-text');
  if (txt) txt.textContent = msg || 'Berechne Stromnetz…';
  el.style.display = 'flex';
}
export function _hideStromProgress() {
  const el = document.getElementById('strom-progress-overlay');
  if (el) el.style.display = 'none';
}

export let _recalcStromBusy = false;
// ── Berechnung: recalcStromNetz() ───────────────────────────────
export function recalcStromNetz() {
  if (!window.stromEdges.length && !window.stromNodes.length) return;
  if (_recalcStromBusy) return; // Rekursionsschutz
  _recalcStromBusy = true;
  try {
    const t0 = performance.now();
    _recalcStromNetzInner();
    const dt = performance.now() - t0;
    if (dt > 200) console.log('recalcStromNetz: ' + dt.toFixed(0) + 'ms');
  } finally {
    _recalcStromBusy = false;
  }
}
export function _recalcStromNetzInner() {

  hookStromNodeClicks();

  // Auto-register gebaeude as strom nodes (type='geb') with small ⚡ markers
  if (typeof gebaeude !== 'undefined') {
    gebaeude.forEach(g => {
      const existing = window.stromNodes.find(n => n.id === g.id && n.type === 'geb');
      if (!existing) {
        const stromMwh = typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : (parseFloat(g.strom) || 0);
        if (stromMwh > 0 || window.stromEdges.some(e => e.u === g.id || e.v === g.id)) {
          const center = g.polygon ? polygonCenter(g.polygon) : null;
          if (center) {
            const gebIcon = L.divIcon({
              className: '',
              html: '<div class="strom-icon strom-icon-geb">⚡</div>',
              iconSize: [14, 14], iconAnchor: [7, 7]
            });
            const gebMarker = L.marker(center, { icon: gebIcon, interactive: true, zIndexOffset: 2000 });
            gebMarker.bindTooltip(function() {
              const n = window.stromNodes.find(sn => sn.id === g.id);
              let tt = '<b>' + g.name + '</b> (Strom)';
              if (n && n.peakLoadKw) tt += '<br>Last: ' + n.peakLoadKw.toFixed(1) + ' kW';
              if (n && n.annualMwh) tt += '<br>Verbrauch: ' + n.annualMwh.toFixed(1) + ' MWh/a';
              if (n && n.isProducer) tt += '<br><span style="color:#66bb6a">Einspeiser (PV)</span>';
              return tt;
            }, { sticky: true, className: 'geb-tooltip' });
            // Click for edge drawing
            gebMarker.on('click', function() { stromNodeClick(g.id); });
            if (window.stromNetzVisible) gebMarker.addTo(map);
            window.stromNodes.push({
              id: g.id, type: 'geb', lat: center.lat, lng: center.lng,
              marker: gebMarker, label: g.name, peakLoadKw: 0, annualMwh: 0, isProducer: false
            });
          }
        }
      } else if (existing && existing.marker) {
        // Update position if building moved
        const center = g.polygon ? polygonCenter(g.polygon) : null;
        if (center) { existing.marker.setLatLng(center); existing.lat = center.lat; existing.lng = center.lng; }
      }
    });
  }

  // Auto-register Erzeuger/Verbraucher (WP, PV-Flächen, BHKW, Stromkessel) als Strom-Knoten
  _autoRegisterErzeugerStromNodes();

  // Find NAP (root)
  const nap = window.stromNodes.find(n => n.type === 'nap');
  if (!nap) {
    // No NAP — just update visuals without calculation
    updateStromEdgeVisuals();
    return;
  }
  const napId = nap.id;

  // Build adjacency from stromEdges
  const nodeMap = {};
  window.stromNodes.forEach(n => {
    nodeMap[n.id] = { id: n.id, node: n, adj: [], loadKw: 0 };
  });

  // Szenario-Stunde ermitteln
  const szHour = typeof _getStromSzenarioHour === 'function' ? _getStromSzenarioHour() : -1;
  const isJahresmittel = (szHour === -2);
  const hasHourly = (szHour >= 0 || isJahresmittel);
  const qH = window.elQuartierH, wpH = window._wpElHourly, skH = window._skElHourly;
  const pvH = window.elPvH, bhkwH = window._bhkwElHourly;

  // Szenario-Info anzeigen
  const szInfoEl = document.getElementById('strom-szenario-info');
  if (szInfoEl) {
    if (szHour >= 0) {
      const MONAT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
      const tag = Math.floor(szHour / 24) + 1;
      const uhr = szHour % 24;
      let monat = 0, rest = tag;
      const mtage = [31,28,31,30,31,30,31,31,30,31,30,31];
      for (let m = 0; m < 12; m++) { if (rest <= mtage[m]) { monat = m; break; } rest -= mtage[m]; }
      const load = (qH?qH[szHour]:0) + (wpH?wpH[szHour]:0) + (skH?skH[szHour]:0);
      const gen = (pvH?pvH[szHour]:0) + (bhkwH?bhkwH[szHour]:0);
      const netto = load - gen;
      szInfoEl.style.display = '';
      szInfoEl.innerHTML = rest + '. ' + MONAT[monat] + ', ' + uhr + ':00 Uhr — Bezug: ' + load.toFixed(0) + ' kW, Erzeugung: ' + gen.toFixed(0) + ' kW, Netto: <b>' + netto.toFixed(0) + ' kW</b>';
    } else if (isJahresmittel) {
      szInfoEl.style.display = '';
      szInfoEl.textContent = 'Darstellung: Jahresmittelwerte';
    } else {
      szInfoEl.style.display = 'none';
    }
  }
  // Cache Summen für Jahresmittel + Anteilsberechnung
  const _sumCache = new WeakMap();
  function arrSum(arr) { if (!arr) return 0; if (_sumCache.has(arr)) return _sumCache.get(arr); let s = 0; for (let i = 0; i < arr.length; i++) s += (arr[i]||0); _sumCache.set(arr, s); return s; }
  function arrAvg(arr) { return arr ? arrSum(arr) / arr.length : 0; }

  // Compute electrical loads per node — szenario-abhängig
  window.stromNodes.forEach(n => {
    const nm = nodeMap[n.id];
    if (!nm) return;
    if (n.type === 'geb') {
      const g = typeof gebaeude !== 'undefined' ? gebaeude.find(gb => gb.id === n.id) : null;
      if (g) {
        const stromMwh = typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : (parseFloat(g.strom) || 0);
        n.annualMwh = stromMwh;
        // Stündlich oder Peak-basiert
        if (hasHourly && qH && stromMwh > 0) {
          const anteil = stromMwh / Math.max(0.001, arrSum(qH)/1000); // Anteil am Quartier
          if (isJahresmittel) {
            nm.loadKw = (arrSum(qH) / 8760) * anteil;
          } else {
            nm.loadKw = (qH[szHour] || 0) * anteil;
          }
        } else {
          nm.loadKw = stromMwh > 0 ? (stromMwh * 1000 / 1800) : 0;
        }
        n.peakLoadKw = nm.loadKw;
        n.isProducer = false;
      }
    }
  });

  // Erzeuger-Knoten Lasten (WP, BHKW, PV, Stromkessel) — szenario-abhängig
  const erzHourlyMap = {
    lwwp: wpH, geo: wpH, // Geo nutzt selben Array-Anteil
    bhkw: bhkwH, stromkessel: skH
  };
  if (window._dispatchEnergy) {
    const de = window._dispatchEnergy;
    ['lwwp', 'geo', 'bhkw', 'stromkessel'].forEach(erzKey => {
      if (!de[erzKey] || !de[erzKey].elMwh) return;
      const erzNode = window.stromNodes.find(n => n._erzKey === erzKey);
      const nm = erzNode ? nodeMap[erzNode.id] : null;
      if (!nm) return;
      const mwh = de[erzKey].elMwh;
      const isInj = (erzKey === 'bhkw');
      const hourlyArr = erzHourlyMap[erzKey];
      let kw;
      if (hasHourly && hourlyArr) {
        if (isJahresmittel) {
          kw = arrSum(hourlyArr) / 8760;
        } else {
          kw = hourlyArr[szHour] || 0;
        }
      } else {
        const vbh = isInj ? 4500 : 1800;
        kw = mwh * 1000 / vbh;
      }
      if (isInj) {
        nm.loadKw -= kw;
        erzNode.peakLoadKw = -kw;
        erzNode.annualMwh = -mwh;
        erzNode.isProducer = true;
      } else {
        nm.loadKw += kw;
        erzNode.peakLoadKw = kw;
        erzNode.annualMwh = mwh;
      }
    });
    // Freiflächen-PV
    freiflaechen.forEach(ff => {
      const erzNode = window.stromNodes.find(n => n._erzKey === 'ff_' + ff.id);
      const nm = erzNode ? nodeMap[erzNode.id] : null;
      if (nm && ff.polygon && ff.polygon.length >= 3) {
        const flaeche = typeof polygonAreaM2 === 'function' ? polygonAreaM2(ff.polygon) : 0;
        const kwp = flaeche * (ff.gcr || 35) / 100 * 0.21;
        const pvMwh = kwp * 950 / 1000;
        let pvKw;
        if (hasHourly && pvH) {
          // Anteil dieser Fläche an Gesamt-PV
          const totalPvMwh = arrSum(pvH)/1000;
          const anteil = totalPvMwh > 0 ? pvMwh / totalPvMwh : 0;
          if (isJahresmittel) {
            pvKw = (arrSum(pvH) / 8760) * anteil;
          } else {
            pvKw = (pvH[szHour]||0) * anteil;
          }
        } else {
          pvKw = kwp * 1.0; // 100% STC = Worst-Case für Rückspeiseberechnung
        }
        nm.loadKw -= pvKw;
        erzNode.peakLoadKw = -pvKw;
        erzNode.annualMwh = -pvMwh;
        erzNode.isProducer = true;
      }
    });
    // Stromkessel (falls kein eigener Erzeuger-Knoten → auf Zentrale)
    if (de.stromkessel && de.stromkessel.elMwh && !window.stromNodes.find(n => n._erzKey === 'stromkessel')) {
      const zId = parseInt(document.getElementById('netz-zentrale')?.value);
      const zNode = zId ? nodeMap[zId] : null;
      if (zNode) zNode.loadKw += (de.stromkessel.elMwh * 1000 / 1800);
    }
  }

  // PV on buildings (szenario-abhängig)
  if (typeof gebaeude !== 'undefined') {
    gebaeude.forEach(g => {
      if (g.pvAktiv && nodeMap[g.id]) {
        const kwp = typeof calcGebKwp === 'function' ? calcGebKwp(g) : 0;
        let pvKw;
        if (hasHourly && pvH) {
          const gebPvMwh = kwp * 950 / 1000;
          const totalPvMwh = arrSum(pvH)/1000;
          const anteil = totalPvMwh > 0 ? gebPvMwh / totalPvMwh : 0;
          pvKw = isJahresmittel
            ? (arrSum(pvH) / 8760) * anteil
            : (pvH[szHour]||0) * anteil;
        } else {
          pvKw = kwp * 1.0; // 100% STC = Worst-Case für Rückspeiseberechnung
        }
        nodeMap[g.id].loadKw -= pvKw;
      }
    });
  }

  window.stromEdges.forEach(e => {
    if (nodeMap[e.u]) nodeMap[e.u].adj.push({ to: e.v, edge: e });
    if (nodeMap[e.v]) nodeMap[e.v].adj.push({ to: e.u, edge: e });
  });

  // BFS from NAP
  const order = [];
  const parentEdge = {};
  const visited = new Set([napId]);
  const queue = [napId];
  while (queue.length > 0) {
    const curr = queue.shift();
    order.push(curr);
    if (nodeMap[curr]) {
      nodeMap[curr].adj.forEach(a => {
        if (!visited.has(a.to)) {
          visited.add(a.to);
          parentEdge[a.to] = { e: a.edge, pNodeId: curr };
          queue.push(a.to);
        }
      });
    }
  }

  // Gleichzeitigkeitsfaktor (GZF)
  const gzfMethode = document.getElementById('strom-gzf-methode')?.value || 'din18015';
  const gzfManuell = parseFloat(document.getElementById('strom-gzf-manuell')?.value) || 0.6;

  // DIN 18015-1 Tabellenwerte (lineare Interpolation zwischen Stützstellen)
  const _GZF_DIN = [
    [1,1.00],[2,0.80],[3,0.73],[4,0.69],[5,0.66],
    [6,0.64],[7,0.62],[8,0.61],[9,0.60],[10,0.58],
    [15,0.52],[20,0.47],[30,0.43],[50,0.40],[100,0.37],[200,0.35],
  ];
  function _gzfDIN(n) {
    if (n <= 1) return 1.0;
    for (let i = 0; i < _GZF_DIN.length - 1; i++) {
      if (n <= _GZF_DIN[i + 1][0]) {
        const t = (n - _GZF_DIN[i][0]) / (_GZF_DIN[i + 1][0] - _GZF_DIN[i][0]);
        return _GZF_DIN[i][1] + t * (_GZF_DIN[i + 1][1] - _GZF_DIN[i][1]);
      }
    }
    return _GZF_DIN[_GZF_DIN.length - 1][1];
  }

  function _gzf(nVerbraucher) {
    if (gzfMethode === 'keine') return 1.0;
    if (gzfMethode === 'manuell') return Math.max(0.1, Math.min(1.0, gzfManuell));
    if (gzfMethode === 'vde') {
      if (nVerbraucher <= 1) return 1.0;
      return Math.max(0.2, 1.0 / Math.pow(nVerbraucher, 0.4));
    }
    return _gzfDIN(nVerbraucher); // din18015 (default)
  }

  // Bottom-up: Anzahl Verbraucher und Summe Einzellasten pro Knoten zählen
  window.stromEdges.forEach(e => { e.peakFlowKw = 0; e._nVerbraucher = 0; });
  const accLoadSum = {};  // Summe der Einzellasten (ohne GZF)
  const accNVerb = {};    // Anzahl Verbraucher hinter diesem Knoten
  Object.keys(nodeMap).forEach(k => {
    const isVerb = nodeMap[k].loadKw > 0 && nodeMap[k].node.type === 'geb';
    accLoadSum[k] = Math.abs(nodeMap[k].loadKw);
    accNVerb[k] = isVerb ? 1 : 0;
  });

  for (let i = order.length - 1; i > 0; i--) {
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if (!pInfo) continue;
    accLoadSum[pInfo.pNodeId] += accLoadSum[curr];
    accNVerb[pInfo.pNodeId] += accNVerb[curr];
    // Kantenfluss = Summe Einzellasten × GZF für Anzahl Verbraucher dahinter
    const nV = accNVerb[curr];
    const rawLoad = accLoadSum[curr];
    const gzfVal = _gzf(nV);
    pInfo.e.peakFlowKw += rawLoad * gzfVal;
    pInfo.e._nVerbraucher = nV;
    pInfo.e._gzf = gzfVal;
  }

  // accLoad für NAP/Trafo: mit GZF
  const accLoad = {};
  Object.keys(nodeMap).forEach(k => {
    accLoad[k] = accLoadSum[k] * _gzf(accNVerb[k]);
  });

  // Cable sizing + voltage drop
  const U = 400; // V (NS Drehstrom)
  const cosPhi = parseFloat(document.getElementById('strom-ns-cosphi')?.value) || 0.95;
  const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
  // Leitertemperatur für Widerstandskorrektur (IEC 60228): ρ(T) = ρ(20°C) × (1 + α·ΔT)
  const tLeiter = parseFloat(document.getElementById('strom-leiter-temp')?.value) || 70;
  const defaultType = document.getElementById('strom-kabel-typ')?.value || 'NAYY';

  window.stromEdges.forEach(e => {
    const absKw = Math.abs(e.peakFlowKw);
    const I = absKw * 1000 / (Math.sqrt(3) * U * cosPhi); // Ampere
    e.peakCurrentA = I;
    e.flowDirection = e.peakFlowKw >= 0 ? 1 : -1;

    // Auto cable sizing
    const kt = KABEL_TYPEN[e.cableType || defaultType] || KABEL_TYPEN.NAYY;
    if (e.autoSized || e.crossSection === 0) {
      e.cableType = defaultType;
      const section = kt.sections.find(s => s.Iz >= I);
      if (section) {
        e.crossSection = section.mm2;
        e.ratedCurrentA = section.Iz;
      } else {
        // Oversized: use largest
        const last = kt.sections[kt.sections.length - 1];
        e.crossSection = last.mm2;
        e.ratedCurrentA = last.Iz;
      }
    } else {
      const sec = kt.sections.find(s => s.mm2 === e.crossSection);
      e.ratedCurrentA = sec ? sec.Iz : 0;
    }

    e.auslastungPct = e.ratedCurrentA > 0 ? (I / e.ratedCurrentA * 100) : 0;

    // Voltage drop: ΔU = √3 × I × L × (R × cosφ + X × sinφ) / U  (DIN VDE 0276)
    const alphaK = kt.alphaK || 0.004;
    const rhoCorr = kt.rhoOhmMm2pM * (1 + alphaK * (tLeiter - 20));
    const R_per_m = rhoCorr / e.crossSection; // Ω/m bei Betriebstemperatur
    const sec = kt.sections.find(s => s.mm2 === e.crossSection);
    const X_per_m = sec?.xMuOhmPerM ? sec.xMuOhmPerM / 1e6 : 0.00008; // Ω/m
    const deltaU_V = Math.sqrt(3) * I * e.lengthM * (R_per_m * cosPhi + X_per_m * sinPhi);
    e.deltaUPct = (deltaU_V / U) * 100;
  });

  // NAP: akkumulierte Gesamtlast zuweisen
  if (nap && accLoad[napId] != null) {
    nap.peakLoadKw = accLoad[napId];
  }

  // Trafo utilization
  window.stromNodes.filter(n => n.type === 'trafo').forEach(tn => {
    let loadBehind = 0;
    // Sum all nodes behind this trafo
    const behindTrafo = new Set();
    const tQueue = [tn.id];
    const tVisited = new Set([tn.id]);
    while (tQueue.length) {
      const c = tQueue.shift();
      behindTrafo.add(c);
      if (nodeMap[c]) {
        nodeMap[c].adj.forEach(a => {
          if (!tVisited.has(a.to) && parentEdge[a.to] && parentEdge[a.to].pNodeId === c) {
            tVisited.add(a.to);
            tQueue.push(a.to);
          }
        });
      }
    }
    let nVerb = 0;
    behindTrafo.forEach(nId => {
      if (nId !== tn.id && nodeMap[nId]) {
        loadBehind += Math.abs(nodeMap[nId].loadKw);
        if (nodeMap[nId].loadKw > 0 && nodeMap[nId].node.type === 'geb') nVerb++;
      }
    });
    tn.peakLoadKw = loadBehind * _gzf(nVerb);
    tn._auslastungPct = tn.ratedKva > 0 ? (tn.peakLoadKw / tn.ratedKva * 100) : 0;
  });

  // Critical voltage drop (path NAP → leaf)
  let maxDeltaU = 0;
  order.forEach(nodeId => {
    if (nodeId === napId || !parentEdge[nodeId]) return;
    let pathDu = 0;
    let curr = nodeId;
    while (parentEdge[curr]) {
      pathDu += parentEdge[curr].e.deltaUPct;
      curr = parentEdge[curr].pNodeId;
    }
    if (pathDu > maxDeltaU) maxDeltaU = pathDu;
  });
  window._stromNetzKpis = { maxDeltaU: maxDeltaU };

  // ── Stromnetz-Kosten berechnen ──
  _calcStromNetzKosten();

  updateStromEdgeVisuals();
  updateLpStromSummary();
}

export function _calcStromNetzKosten() {
  const tiefbauEurM = parseFloat(document.getElementById('strom-k-tiefbau')?.value) || 100;
  const napPausch = parseFloat(document.getElementById('strom-k-nap')?.value) || 3000;
  const trafoEurKva = parseFloat(document.getElementById('strom-k-trafo')?.value) || 60;
  const nd = parseFloat(document.getElementById('strom-k-nd')?.value) || 40;
  const zinssatz = 0.03; // 3% Kalkulationszins

  // Kabelkosten + Tiefbau
  let kabelInvest = 0, trasseLaenge = 0;
  window.stromEdges.forEach(e => {
    const kt = KABEL_TYPEN[e.cableType] || KABEL_TYPEN.NAYY;
    const sec = kt.sections.find(s => s.mm2 === e.crossSection);
    const eurM = sec ? sec.eurM : 15;
    kabelInvest += e.lengthM * (eurM + tiefbauEurM);
    trasseLaenge += e.lengthM;
  });

  // Trafo-Kosten
  let trafoInvest = 0, nTrafos = 0;
  window.stromNodes.filter(n => n.type === 'trafo').forEach(tn => {
    trafoInvest += (tn.ratedKva || 400) * trafoEurKva;
    nTrafos++;
  });

  // NAP-Kosten
  const nNap = window.stromNodes.filter(n => n.type === 'nap').length;
  const napInvest = nNap * napPausch;

  const investGesamt = kabelInvest + trafoInvest + napInvest;

  // Annuität (VDI 2067)
  const q = 1 + zinssatz;
  const annF = zinssatz > 0 ? (Math.pow(q, nd) * zinssatz) / (Math.pow(q, nd) - 1) : 1 / nd;
  const ihF = 0.01; // 1% Instandhaltung
  const annuitaet = investGesamt * (annF + ihF);

  // KPIs anzeigen
  const fmtEur = v => v >= 1e6 ? (v/1e6).toFixed(2) + ' M€' : v >= 1000 ? (v/1000).toFixed(0) + ' T€' : v.toFixed(0) + ' €';
  const elInv = document.getElementById('strom-kpi-invest');
  const elAnn = document.getElementById('strom-kpi-annuitaet');
  const elDet = document.getElementById('strom-kpi-detail');
  if (elInv) elInv.textContent = fmtEur(investGesamt);
  if (elAnn) elAnn.textContent = fmtEur(annuitaet);
  if (elDet) elDet.textContent = 'Kabel: ' + fmtEur(kabelInvest) + ' | Trafo: ' + fmtEur(trafoInvest) + ' | Trasse: ' + trasseLaenge.toFixed(0) + ' m';

  window._stromNetzKosten = { investGesamt, annuitaet, kabelInvest, trafoInvest, napInvest, trasseLaenge };
}

// ── Kanten-Visualisierung ───────────────────────────────────────
export function getStromEdgeColor(e) {
  switch (window.stromColorMode) {
    case 'auslastung':
      if (e.auslastungPct > 100) return '#e53935';
      if (e.auslastungPct > 80)  return '#f9a825';
      if (e.auslastungPct > 30)  return '#4caf50';
      return '#4fc3f7';
    case 'spannungsfall':
      if (e.deltaUPct > 3) return '#e53935';
      if (e.deltaUPct > 2) return '#f9a825';
      if (e.deltaUPct > 1) return '#8bc34a';
      return '#4caf50';
    case 'leistung': {
      const maxKw = Math.max(1, ...stromEdges.map(se => Math.abs(se.peakFlowKw)));
      const t = Math.min(1, Math.abs(e.peakFlowKw) / maxKw);
      return t < 0.5 ? '#4caf50' : t < 0.8 ? '#f9a825' : '#e53935';
    }
    case 'richtung':
      return e.flowDirection >= 0 ? '#ff9800' : '#42a5f5'; // orange=demand, blue=backfeed
    default: return '#fdd835';
  }
}

export function updateStromEdgeVisuals() {
  window.stromEdges.forEach(e => {
    const absKw = Math.abs(e.peakFlowKw);
    const w = Math.max(2, Math.min(12, 2 + absKw / 20));
    const color = getStromEdgeColor(e);
    // Strichlinien für Flussrichtung (Animation läuft über animateStromPipes)
    if (absKw > 0.1) {
      e.layer.setStyle({ color: color, weight: w, opacity: 0.85, dashArray: '12,6' });
      e._flowActive = true;
      e._flowDir = e.flowDirection >= 0 ? 1 : -1;
      if (e.layer._path) e.layer._path.style.animation = '';
    } else {
      // Kein Lastfluss — Kabel trotzdem sichtbar als durchgezogene Linie
      e.layer.setStyle({ color: '#fdd835', weight: 3, opacity: 0.6, dashArray: '' });
      e._flowActive = false;
      if (e.layer._path) e.layer._path.style.animation = '';
    }

    // Arrow marker for direction
    const un = window.stromNodes.find(n => n.id === e.u);
    const vn = window.stromNodes.find(n => n.id === e.v);
    if (un && vn && absKw > 0.1) {
      const pt1 = L.latLng(un.lat, un.lng);
      const pt2 = L.latLng(vn.lat, vn.lng);
      const mid = L.latLng((pt1.lat + pt2.lat) / 2, (pt1.lng + pt2.lng) / 2);
      const angle = Math.atan2(pt2.lng - pt1.lng, pt2.lat - pt1.lat) * 180 / Math.PI;
      const rot = e.flowDirection >= 0 ? angle : angle + 180;
      const arrowHtml = '<div style="color:' + color + ';font-size:16px;transform:rotate(' + rot + 'deg);line-height:1;">▲</div>';
      if (e.arrowMarker) {
        e.arrowMarker.setLatLng(mid);
        e.arrowMarker.setIcon(L.divIcon({ className: '', html: arrowHtml, iconSize: [16, 16], iconAnchor: [8, 8] }));
        if (window.stromNetzVisible && !map.hasLayer(e.arrowMarker)) e.arrowMarker.addTo(map);
      } else {
        e.arrowMarker = L.marker(mid, {
          icon: L.divIcon({ className: '', html: arrowHtml, iconSize: [16, 16], iconAnchor: [8, 8] }),
          interactive: false, zIndexOffset: 2500
        });
        if (window.stromNetzVisible) e.arrowMarker.addTo(map);
      }
    } else if (e.arrowMarker) {
      if (map.hasLayer(e.arrowMarker)) map.removeLayer(e.arrowMarker);
    }
  });
}

// ── Auto-Netz: Alle Gebäude mit nächstem Trafo/NSHV verbinden ──
export function autoStromNetz() {
  const infra = window.stromNodes.filter(n => n.type === 'trafo' || n.type === 'nshv');
  if (!infra.length) {
    epConfirm('Kein Trafo/NSHV', 'Bitte zuerst mindestens einen Trafo oder eine NSHV platzieren.', { okText: 'OK', cancelText: '' });
    return;
  }
  const nap = window.stromNodes.find(n => n.type === 'nap');
  if (!nap) {
    epConfirm('Kein NAP', 'Bitte zuerst einen NAP (Netzanknüpfungspunkt) platzieren.', { okText: 'OK', cancelText: '' });
    return;
  }

  // Connect NAP to each Trafo (if not already)
  window.stromNodes.filter(n => n.type === 'trafo').forEach(trafo => {
    const exists = window.stromEdges.some(e =>
      (e.u === nap.id && e.v === trafo.id) || (e.u === trafo.id && e.v === nap.id));
    if (!exists) addStromEdge(nap.id, trafo.id);
  });

  // Connect Trafos to NSHVs (nearest Trafo)
  window.stromNodes.filter(n => n.type === 'nshv').forEach(nshv => {
    if (window.stromEdges.some(e => e.u === nshv.id || e.v === nshv.id)) return; // already connected
    let nearest = null, minDist = Infinity;
    window.stromNodes.filter(n => n.type === 'trafo').forEach(t => {
      const d = L.latLng(nshv.lat, nshv.lng).distanceTo(L.latLng(t.lat, t.lng));
      if (d < minDist) { minDist = d; nearest = t; }
    });
    if (nearest) addStromEdge(nearest.id, nshv.id);
  });

  // Gebäude + Erzeuger per MST an Infrastruktur anbinden (Baum statt Stern)
  {
    // Alle infra-Knoten + bereits verbundene Knoten als Startmenge
    const connPts = new Map();
    const allInfra = window.stromNodes.filter(n => n.type === 'trafo' || n.type === 'nshv' || n.type === 'nap');
    allInfra.forEach(n => connPts.set(n.id, { lat: n.lat, lng: n.lng }));

    // Unverbundene Gebäude sammeln
    const unconnected = [];
    if (typeof gebaeude !== 'undefined') {
      gebaeude.forEach(g => {
        const stromMwh = typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : 0;
        if (!stromMwh || stromMwh <= 0) return;
        if (window.stromEdges.some(e => e.u === g.id || e.v === g.id)) return;
        const center = g.polygon ? polygonCenter(g.polygon) : null;
        if (!center) return;
        unconnected.push({ id: g.id, lat: center.lat, lng: center.lng });
      });
    }
    // Erzeuger-Knoten auch einbeziehen
    window.stromNodes.filter(n => n.type === 'erzeuger' && !window.stromEdges.some(e => e.u === n.id || e.v === n.id))
      .forEach(n => unconnected.push({ id: n.id, lat: n.lat, lng: n.lng }));

    // Greedy MST: immer nächsten Nachbar verbinden
    while (unconnected.length > 0) {
      let bestIdx = -1, bestConnId = null, bestDist = Infinity;
      for (let i = 0; i < unconnected.length; i++) {
        const c = unconnected[i];
        for (const [connId, pt] of connPts) {
          const d = L.latLng(c.lat, c.lng).distanceTo(L.latLng(pt.lat, pt.lng));
          if (d < bestDist) { bestDist = d; bestIdx = i; bestConnId = connId; }
        }
      }
      if (bestIdx < 0) break;
      const c = unconnected.splice(bestIdx, 1)[0];
      addStromEdge(bestConnId, c.id);
      connPts.set(c.id, { lat: c.lat, lng: c.lng });
    }
  }

  recalcStromNetz();
  // Automatisch auf Strom-Sub-Tab wechseln und Netz anzeigen
  setNetzSubTab('strom');
}

// ── Schnellberechnung: NAP + Trafos + Kabel automatisch ────────
export function schnellberechnungStrom() {
  if (!gebaeude || !gebaeude.length) {
    epConfirm('Keine Gebäude', 'Keine Gebäude vorhanden. Bitte zuerst Gebäude laden.', { okText: 'OK', cancelText: '' });
    return;
  }

  // Bestehende Strom-Infrastruktur löschen
  if (window.stromNodes.length > 0) {
    epConfirm('Stromnetz ersetzen', 'Das bestehende Stromnetz wird komplett ersetzt. Fortfahren?', { danger: true, okText: 'Ersetzen' }).then(function(ok) {
      if (ok) { clearStromNetz(); _schnellberechnungStromInner(); }
    });
    return;
  }
  _schnellberechnungStromInner();
}

export function _schnellberechnungStromInner() {
  // 1. Gebäude mit Stromverbrauch sammeln + Peak-Last berechnen
  const consumers = [];
  gebaeude.forEach(g => {
    const center = g.polygon ? polygonCenter(g.polygon) : null;
    if (!center) return;
    const stromMwh = typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : (parseFloat(g.strom) || 0);
    if (!stromMwh || stromMwh <= 0) return;
    const peakKw = stromMwh * 1000 / 1800; // VBH ~1800h für Strom
    consumers.push({ id: g.id, lat: center.lat, lng: center.lng, peakKw: peakKw, stromMwh: stromMwh, assigned: false });
  });

  // WP-Verbrauch auf Zentrale-Gebäude addieren
  let wpPeakKw = 0;
  if (window._dispatchEnergy) {
    const de = window._dispatchEnergy;
    ['lwwp', 'fg', 'geo'].forEach(k => { if (de[k]) wpPeakKw += (de[k].elMwh || 0) * 1000 / 1800; });
    if (de.stromkessel) wpPeakKw += (de.stromkessel.elMwh || 0) * 1000 / 1800;
  }
  const zId = parseInt(document.getElementById('netz-zentrale')?.value);
  if (zId && wpPeakKw > 0) {
    const zCons = consumers.find(c => c.id === zId);
    if (zCons) zCons.peakKw += wpPeakKw;
  }

  if (!consumers.length) return;

  const totalPeakKw = consumers.reduce((s, c) => s + c.peakKw, 0);
  // Gleichzeitigkeitsfaktor (sinkt mit Anzahl Verbraucher)
  const n = consumers.length;
  const glzf = Math.max(0.3, 1 / (1 + 0.1 * Math.sqrt(n))); // Richtwert: 0.3–0.7
  const gleichzeitigLastKw = totalPeakKw * glzf;
  const gleichzeitigKva = gleichzeitigLastKw / 0.95; // cos phi

  // 2. NAP platzieren — am Rand des Plangebiets (oder Schwerpunkt wenn kein Gebiet)
  let napPos;
  if (areaLatLngs && areaLatLngs.length >= 3) {
    let maxSum = -Infinity, bestPt = null;
    areaLatLngs.forEach(p => {
      const sum = p.lat + p.lng;
      if (sum > maxSum) { maxSum = sum; bestPt = p; }
    });
    const center = L.latLng(
      consumers.reduce((s, c) => s + c.lat, 0) / consumers.length,
      consumers.reduce((s, c) => s + c.lng, 0) / consumers.length
    );
    const dx = bestPt.lng - center.lng;
    const dy = bestPt.lat - center.lat;
    napPos = L.latLng(bestPt.lat + dy * 0.15, bestPt.lng + dx * 0.15);
  } else {
    const cLat = consumers.reduce((s, c) => s + c.lat, 0) / consumers.length;
    const cLng = consumers.reduce((s, c) => s + c.lng, 0) / consumers.length;
    const spread = Math.max(...consumers.map(c => L.latLng(c.lat, c.lng).distanceTo(L.latLng(cLat, cLng))));
    napPos = L.latLng(cLat + spread * 0.000012, cLng);
  }
  const napNode = addStromNode('nap', napPos, { maxKva: Math.ceil(gleichzeitigKva) });

  // 2b. Trasse als Kabel-Backbone nutzen (falls Haupttrasse gezeichnet)
  var trasseJunctions = []; // [{id, lat, lng}]
  if (typeof trassePoints !== 'undefined' && trassePoints.length >= 2) {
    var jBaseId = 30000;
    var jIdx = 0;
    var segs = trasseSegments.length > 0 ? trasseSegments : [{ start: 0, end: trassePoints.length - 1 }];

    segs.forEach(function(seg) {
      var lastJunction = null;
      for (var i = seg.start; i <= seg.end; i++) {
        var pt = trassePoints[i];
        // Ausdünnen: ~25m Abstand zwischen Junctions
        if (lastJunction && i < seg.end) {
          if (L.latLng(lastJunction.lat, lastJunction.lng).distanceTo(pt) < 25) continue;
        }
        var jId = jBaseId + jIdx;
        if (jId >= window.stromNextId) window.stromNextId = jId + 1;
        window.stromNodes.push({
          id: jId, type: 'junction', lat: pt.lat, lng: pt.lng,
          marker: null, label: 'J' + jIdx, peakLoadKw: 0, annualMwh: 0, isProducer: false
        });
        var jObj = { id: jId, lat: pt.lat, lng: pt.lng };
        trasseJunctions.push(jObj);
        if (lastJunction) addStromEdge(lastJunction.id, jId);
        lastJunction = jObj;
        jIdx++;
      }
    });

    // NAP mit nächster Junction verbinden
    if (trasseJunctions.length > 0) {
      var napJDist = Infinity, napJId = null;
      trasseJunctions.forEach(function(j) {
        var d = L.latLng(napPos.lat, napPos.lng).distanceTo(L.latLng(j.lat, j.lng));
        if (d < napJDist) { napJDist = d; napJId = j.id; }
      });
      if (napJId) addStromEdge(napNode.id, napJId);
    }
  }

  // 3. Trafos per Greedy-Clustering platzieren
  const maxTrafoLoadKva = 630 * 0.8; // Max 80% Auslastung eines 630-kVA-Trafos als Ziel
  const maxGebProTrafo = 60; // Max Gebäude pro Trafo (realistisch: 30–60 Wohngebäude pro 630-kVA-Trafo)

  consumers.sort((a, b) => b.peakKw - a.peakKw);
  const clusters = [];

  consumers.forEach(c => {
    let bestCluster = null, bestDist = Infinity;
    clusters.forEach(cl => {
      if (cl.consumers.length >= maxGebProTrafo) return;
      const clKva = cl.totalKw / 0.95;
      if (clKva + c.peakKw / 0.95 > maxTrafoLoadKva) return;
      const d = L.latLng(c.lat, c.lng).distanceTo(L.latLng(cl.centLat, cl.centLng));
      if (d < bestDist) { bestDist = d; bestCluster = cl; }
    });

    if (bestCluster && bestDist < 400) {
      bestCluster.consumers.push(c);
      bestCluster.totalKw += c.peakKw;
      bestCluster.centLat = bestCluster.consumers.reduce((s, x) => s + x.lat, 0) / bestCluster.consumers.length;
      bestCluster.centLng = bestCluster.consumers.reduce((s, x) => s + x.lng, 0) / bestCluster.consumers.length;
    } else {
      clusters.push({ consumers: [c], totalKw: c.peakKw, centLat: c.lat, centLng: c.lng });
    }
  });

  // Gebäude als Strom-Knoten vorab registrieren (damit addStromEdge sie findet)
  consumers.forEach(c => {
    if (window.stromNodes.find(n => n.id === c.id)) return;
    const g = gebaeude.find(gb => gb.id === c.id);
    if (!g) return;
    const gebIcon = L.divIcon({ className: '', html: '<div class="strom-icon strom-icon-geb">⚡</div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    const gebMarker = L.marker(L.latLng(c.lat, c.lng), { icon: gebIcon, interactive: true, zIndexOffset: 2000 });
    gebMarker.bindTooltip(function() {
      const n = window.stromNodes.find(sn => sn.id === c.id);
      let tt = '<b>' + g.name + '</b> (Strom)';
      if (n && n.peakLoadKw) tt += '<br>Last: ' + n.peakLoadKw.toFixed(1) + ' kW';
      if (n && n.annualMwh) tt += '<br>Verbrauch: ' + n.annualMwh.toFixed(1) + ' MWh/a';
      return tt;
    }, { sticky: true, className: 'geb-tooltip' });
    gebMarker.on('click', function() { stromNodeClick(c.id); });
    if (window.stromNetzVisible) gebMarker.addTo(map);
    window.stromNodes.push({ id: c.id, type: 'geb', lat: c.lat, lng: c.lng, marker: gebMarker, label: g.name, peakLoadKw: 0, annualMwh: 0, isProducer: false });
  });

  const trafoNodes = [];
  clusters.forEach(cl => {
    const clKva = cl.totalKw * glzf / 0.95;
    const trafoSize = TRAFO_GROESSEN.find(s => s >= clKva) || TRAFO_GROESSEN[TRAFO_GROESSEN.length - 1];

    // Trafo auf nächste Trassen-Junction snappen (falls Trasse vorhanden)
    let tPos;
    let snapJId = null;
    if (trasseJunctions.length > 0) {
      let snapDist = Infinity;
      trasseJunctions.forEach(function(j) {
        const d = L.latLng(cl.centLat, cl.centLng).distanceTo(L.latLng(j.lat, j.lng));
        if (d < snapDist) { snapDist = d; snapJId = j.id; tPos = L.latLng(j.lat + 0.00002, j.lng + 0.00002); }
      });
    } else {
      tPos = L.latLng(cl.centLat + 0.00003, cl.centLng + 0.00003);
    }

    const trafoNode = addStromNode('trafo', tPos, { ratedKva: trafoSize });
    trafoNodes.push(trafoNode);

    // Trafo an Trassen-Backbone oder direkt an NAP anbinden
    if (snapJId) {
      addStromEdge(snapJId, trafoNode.id);
    } else {
      addStromEdge(napNode.id, trafoNode.id);
    }

    // MST: Gebäude als Baum verbinden (nächster Nachbar)
    // Bei Trasse: Junctions mit in die verbundene Menge aufnehmen
    const connPts = new Map(); // id → {lat, lng}
    connPts.set(trafoNode.id, { lat: tPos.lat, lng: tPos.lng });
    if (trasseJunctions.length > 0) {
      trasseJunctions.forEach(function(j) { connPts.set(j.id, { lat: j.lat, lng: j.lng }); });
    }

    const remaining = cl.consumers.slice();
    while (remaining.length > 0) {
      let bestIdx = -1, bestConnId = null, bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        for (const [connId, pt] of connPts) {
          const d = L.latLng(c.lat, c.lng).distanceTo(L.latLng(pt.lat, pt.lng));
          if (d < bestDist) { bestDist = d; bestIdx = i; bestConnId = connId; }
        }
      }
      if (bestIdx < 0) break;
      const c = remaining.splice(bestIdx, 1)[0];
      addStromEdge(bestConnId, c.id);
      connPts.set(c.id, { lat: c.lat, lng: c.lng });
    }
  });

  // Erzeuger-Knoten registrieren & ans nächste Infra anbinden
  _autoRegisterErzeugerStromNodes();
  const allInfra = [napNode, ...trafoNodes];
  window.stromNodes.filter(n => n.type === 'erzeuger').forEach(erz => {
    if (window.stromEdges.some(e => e.u === erz.id || e.v === erz.id)) return;
    let nearest = null, minDist = Infinity;
    allInfra.forEach(n => {
      const d = L.latLng(erz.lat, erz.lng).distanceTo(L.latLng(n.lat, n.lng));
      if (d < minDist) { minDist = d; nearest = n; }
    });
    if (nearest) addStromEdge(nearest.id, erz.id);
  });

  recalcStromNetz();
  // Automatisch auf Strom-Sub-Tab wechseln und Netz anzeigen
  setNetzSubTab('strom');

  const nTrafos = clusters.length;
  const info = `Schnellberechnung: ${consumers.length} Verbraucher, ${nTrafos} Trafo${nTrafos > 1 ? 's' : ''}, ` +
    `Gleichzeitigkeitslast ${gleichzeitigLastKw.toFixed(0)} kW (GZF ${(glzf*100).toFixed(0)}%)`;
  if (typeof showHint === 'function') { showHint(info); setTimeout(hideHint, 5000); }
}

// ── KPI-Anzeige im Strom Sub-Tab ───────────────────────────────
export function updateLpStromSummary() {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const hint = document.getElementById('lp-strom-hint');

  if (!(window.stromNodes || []).length) {
    if (hint) hint.style.display = '';
    setVal('lp-strom-sz-hour', '—');
    setVal('lp-strom-last', '—');
    setVal('lp-strom-einsp', '—');
    setVal('lp-strom-trafo-ausl', '—');
    setVal('lp-strom-delta-u', '—');
    setVal('lp-strom-kabel-len', '—');
    setVal('lp-strom-komp', '—');
    return;
  }
  if (hint) hint.style.display = 'none';

  // Szenario-Stunde anzeigen
  const szH = typeof _getStromSzenarioHour === 'function' ? _getStromSzenarioHour() : -1;
  if (szH === -2) {
    setVal('lp-strom-sz-hour', 'Ø Jahresmittel');
  } else if (szH >= 0) {
    const tag = Math.floor(szH / 24) + 1;
    const std = szH % 24;
    const monat = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    const m = [31,28,31,30,31,30,31,31,30,31,30,31];
    let d = tag, mi = 0;
    while (mi < 12 && d > m[mi]) { d -= m[mi]; mi++; }
    setVal('lp-strom-sz-hour', d + '. ' + monat[mi] + ' ' + std + ':00 (h' + szH + ')');
  } else {
    setVal('lp-strom-sz-hour', 'Peak (VBH)');
  }

  // Gesamtlast (consumers only)
  let totalLoad = 0, totalInj = 0;
  window.stromNodes.forEach(n => {
    if (n.type === 'geb' || n.type === 'erzeuger') {
      if (n.peakLoadKw > 0) totalLoad += n.peakLoadKw;
      else totalInj += Math.abs(n.peakLoadKw);
    }
  });
  setVal('lp-strom-last', totalLoad > 0 ? totalLoad.toFixed(0) + ' kW' : '—');
  setVal('lp-strom-einsp', totalInj > 0 ? totalInj.toFixed(0) + ' kW' : '—');

  // Max Trafo-Auslastung
  let maxTrafoAusl = 0;
  window.stromNodes.filter(n => n.type === 'trafo').forEach(t => {
    if (t._auslastungPct > maxTrafoAusl) maxTrafoAusl = t._auslastungPct;
  });
  const trafoColor = maxTrafoAusl < 80 ? '#4caf50' : maxTrafoAusl < 100 ? '#f9a825' : '#e53935';
  const trafoEl = document.getElementById('lp-strom-trafo-ausl');
  if (trafoEl) {
    trafoEl.textContent = window.stromNodes.some(n => n.type === 'trafo') ? maxTrafoAusl.toFixed(0) + ' %' : '—';
    trafoEl.style.color = trafoColor;
  }

  // Krit. Spannungsfall
  const kpis = window._stromNetzKpis || {};
  const du = kpis.maxDeltaU || 0;
  const duColor = du < 1 ? '#4caf50' : du < 2 ? '#8bc34a' : du < 3 ? '#f9a825' : '#e53935';
  const duEl = document.getElementById('lp-strom-delta-u');
  if (duEl) { duEl.textContent = du > 0 ? du.toFixed(2) + ' %' : '—'; duEl.style.color = duColor; }

  // Kabellänge
  const totalLen = window.stromEdges.reduce((s, e) => s + (e.lengthM || 0), 0);
  setVal('lp-strom-kabel-len', totalLen > 0 ? totalLen.toFixed(0) + ' m' : '—');

  // Komponenten
  const nNap = window.stromNodes.filter(n => n.type === 'nap').length;
  const nTrafo = window.stromNodes.filter(n => n.type === 'trafo').length;
  const nNshv = window.stromNodes.filter(n => n.type === 'nshv').length;
  setVal('lp-strom-komp', nNap + ' NAP · ' + nTrafo + ' Trafo · ' + nNshv + ' NSHV');
}

// ── Elektroberechnung auf Basis manuell platzierter Assets ──────
// Portiert von elCalc() aus Energiekarte1.1. Arbeitet auf ASSETS.items +
// window.stromEdges statt auf Gebäudedaten.
export function elCalcAssets() {
  const yr = globalYear ?? new Date().getFullYear();
  const U_N = 400, COS_PHI = 0.9;

  const activeA = ASSETS.items.filter(a =>
    (a.domain === 'strom' || a.domain === 'hybrid') &&
    getAssetStatus(a, yr) === 'active'
  );
  const activeIds = new Set(activeA.map(a => a.id));
  const activeE = (window.stromEdges || []).filter(e =>
    activeIds.has(e.u) && activeIds.has(e.v)
  );

  const warn = [];
  if (!activeA.find(a => a.type === 'NAP'))   warn.push('⚠ Kein NAP vorhanden.');
  if (!activeA.find(a => a.type === 'Trafo')) warn.push('⚠ Kein Trafo – Berechnung mit 400 V NS.');
  if (activeA.length === 0) { warn.push('⚠ Keine aktiven Elektro-Assets.'); _showElCalcResult(warn, []); return; }
  if (activeE.length === 0 && activeA.length > 0) warn.push('ℹ Keine Kabel vorhanden.');

  function assetVerbrauch(a) {
    const p = a.props || {};
    switch (a.type) {
      case 'Verbraucher': return parseFloat(p.leistungKW) || 0;
      case 'Lade':        return (parseInt(p.anzahlPunkte) || 4) * (parseFloat(p.leistungProPunktKW) || 22);
      case 'WP':          return parseFloat(p.leistungKW) || 0;
      default:            return 0;
    }
  }
  function assetErzeugung(a) {
    const p = a.props || {};
    switch (a.type) {
      case 'PV':   return (parseFloat(p.leistungKWp) || 0) * 0.8;
      case 'Wind': return parseFloat(p.leistungKW) || 0;
      case 'KWK':  return parseFloat(p.leistungElKW) || 0;
      default:     return 0;
    }
  }

  const assetMap = new Map(activeA.map(a => [a.id, a]));
  const adjList  = new Map(activeA.map(a => [a.id, []]));
  for (const e of activeE) {
    adjList.get(e.u)?.push({ neighborId: e.v });
    adjList.get(e.v)?.push({ neighborId: e.u });
  }

  function bfsDownstream(edge, loadFn) {
    const a = assetMap.get(edge.u), b = assetMap.get(edge.v);
    if (!a || !b) return 0;
    const rankA = TYPE_RANK[a.type] ?? 6, rankB = TYPE_RANK[b.type] ?? 6;
    const sourceId = rankA <= rankB ? edge.u : edge.v;
    const sinkId   = rankA <= rankB ? edge.v : edge.u;
    const visited = new Set([sourceId]);
    const queue   = [sinkId];
    let load = 0;
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const asset = assetMap.get(cur);
      if (asset) load += loadFn(asset);
      const curRank = TYPE_RANK[asset?.type] ?? 6;
      for (const { neighborId } of (adjList.get(cur) || [])) {
        if (visited.has(neighborId)) continue;
        if ((TYPE_RANK[assetMap.get(neighborId)?.type] ?? 6) >= curRank) queue.push(neighborId);
      }
    }
    return load;
  }

  // Kumulativer Spannungsfall: gerichtete Adjazenzliste
  const dirAdj = new Map(activeA.map(a => [a.id, []]));

  for (const e of activeE) {
    const aAsset = assetMap.get(e.u), bAsset = assetMap.get(e.v);
    if (!aAsset || !bAsset) continue;
    const rankA = TYPE_RANK[aAsset.type] ?? 6, rankB = TYPE_RANK[bAsset.type] ?? 6;
    const lengthM = e.lengthM || 0;

    const P_v = bfsDownstream(e, assetVerbrauch);
    const P_g = bfsDownstream(e, assetErzeugung);
    const P_net   = P_v - P_g;
    const P_worst = Math.max(P_v, P_g);
    const I_A      = P_worst * 1000 / (Math.sqrt(3) * U_N * COS_PHI);
    const I_A_sign = P_net   * 1000 / (Math.sqrt(3) * U_N * COS_PHI);

    const kt = KABEL_TYPEN[e.cableType] || KABEL_TYPEN.NAYY;
    const np = Math.max(1, e.nParallel || 1);
    // Auto-Querschnitt: Strom pro Ader = Gesamtstrom / Parallelkabel
    const I_per_cable = I_A / np;
    if (!e.crossSection || e.autoSized) {
      const minSec = kt.sections.find(s => s.Iz >= I_per_cable);
      e.crossSection = minSec ? minSec.mm2 : kt.sections[kt.sections.length - 1].mm2;
    }
    const sec   = kt.sections.find(s => s.mm2 === e.crossSection) || kt.sections[kt.sections.length - 1];
    const R_km  = kt.rhoOhmMm2pM * 1000 / e.crossSection;
    const R_seg = (R_km * lengthM / 1000) / np;   // Parallelschaltung halbiert R
    const dU_V  = Math.sqrt(3) * R_seg * (I_A_sign / np);
    const dU_pct = (dU_V / U_N) * 100;

    e.peakFlowKw   = P_net;
    e.peakCurrentA = I_A;
    e.ratedCurrentA = sec.Iz * np;
    e.auslastungPct = sec.Iz > 0 ? (I_A / sec.Iz) * 100 : 0;
    e.deltaUPct    = Math.abs(dU_pct);
    e.flowDirection = P_net >= 0 ? 1 : -1;

    const srcId = rankA <= rankB ? e.u : e.v;
    dirAdj.get(srcId)?.push({ nextId: rankA <= rankB ? e.v : e.u, dU_V });
  }

  // BFS kumulativer Spannungsfall ab Trafo
  const nodeVoltDrop = new Map();
  const srcNodes = activeA.filter(a => a.type === 'Trafo');
  const fallbackRank = srcNodes.length === 0
    ? Math.min(...activeA.map(a => TYPE_RANK[a.type] ?? 6))
    : null;
  (srcNodes.length > 0 ? srcNodes : activeA.filter(a => (TYPE_RANK[a.type] ?? 6) === fallbackRank))
    .forEach(s => nodeVoltDrop.set(s.id, 0));
  const bfsQ   = [...nodeVoltDrop.keys()];
  const bfsVis = new Set(bfsQ);
  while (bfsQ.length) {
    const curId = bfsQ.shift();
    const cumV = nodeVoltDrop.get(curId) ?? 0;
    for (const { nextId, dU_V } of (dirAdj.get(curId) || [])) {
      if (bfsVis.has(nextId)) continue;
      bfsVis.add(nextId);
      nodeVoltDrop.set(nextId, cumV + dU_V);
      bfsQ.push(nextId);
    }
  }
  nodeVoltDrop.forEach((v, id) => {
    const sn = (window.stromNodes || []).find(n => n.id === id);
    if (sn) sn._voltDropV = v;
  });

  // Trafo-Auslastung: Gesamtlast aller nachgelagerten Assets per BFS
  for (const trafoAsset of activeA.filter(a => a.type === 'Trafo')) {
    const ratedKVA = parseFloat(trafoAsset.props?.leistungKVA) || 630;
    const trafoRank = TYPE_RANK[trafoAsset.type] ?? 6;
    const visited = new Set([trafoAsset.id]);
    const queue = [];
    for (const { neighborId } of (adjList.get(trafoAsset.id) || [])) {
      if ((TYPE_RANK[assetMap.get(neighborId)?.type] ?? 6) > trafoRank) queue.push(neighborId);
    }
    let P_v = 0, P_g = 0;
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const curAsset = assetMap.get(cur);
      if (!curAsset) continue;
      P_v += assetVerbrauch(curAsset);
      P_g += assetErzeugung(curAsset);
      const curRank = TYPE_RANK[curAsset.type] ?? 6;
      for (const { neighborId } of (adjList.get(cur) || [])) {
        if (!visited.has(neighborId) && (TYPE_RANK[assetMap.get(neighborId)?.type] ?? 6) >= curRank) {
          queue.push(neighborId);
        }
      }
    }
    const P_net = Math.max(P_v - P_g, 0);
    trafoAsset._calcPeakLoadKw = P_net;
    trafoAsset._calcPeakLoadPct = ratedKVA > 0 ? (P_net / (ratedKVA * COS_PHI)) * 100 : 0;
  }

  updateStromEdgeVisuals();

  // Ergebniszusammenfassung
  const bottlenecks = activeE
    .filter(e => e.auslastungPct > 100 || e.deltaUPct > 3 || (e.fuseA > 0 && e.peakCurrentA > e.fuseA))
    .map(e => {
      const a = assetMap.get(e.u), b = assetMap.get(e.v);
      let msg = '';
      if (e.auslastungPct > 100)                  msg += `Überlast ${e.auslastungPct.toFixed(0)} % `;
      if (e.deltaUPct > 3)                        msg += `ΔU ${e.deltaUPct.toFixed(1)} % `;
      if (e.fuseA > 0 && e.peakCurrentA > e.fuseA) msg += `Sicherung ${e.fuseA} A ausgelöst (${e.peakCurrentA.toFixed(0)} A)`;
      return `${a?.name || e.u} → ${b?.name || e.v}: ${msg.trim()}`;
    });

  _updateAssetStatusRings(nodeVoltDrop, activeA, activeE, assetMap);

  const totalVerbrauch = activeA.reduce((s, a) => s + assetVerbrauch(a), 0);
  const totalErzeugung = activeA.reduce((s, a) => s + assetErzeugung(a), 0);
  const summary = [
    `Verbraucher: ${totalVerbrauch.toFixed(1)} kW · Einspeisung: ${totalErzeugung.toFixed(1)} kW`,
    `Kabel: ${activeE.length} · Assets: ${activeA.length}`,
  ];
  _showElCalcResult([...warn, ...summary], bottlenecks);
  if (typeof window.sldRefresh === 'function') window.sldRefresh();
}

function _updateAssetStatusRings(nodeVoltDrop, activeA, activeE, assetMap) {
  const U_N = 400;
  // Welche Assets haben überlastete oder sicherungsauslösende Kabel?
  const overloadedIds = new Set();
  for (const e of activeE) {
    if (e.auslastungPct > 100 || (e.fuseA > 0 && e.peakCurrentA > e.fuseA)) {
      overloadedIds.add(e.u);
      overloadedIds.add(e.v);
    }
  }
  for (const a of activeA) {
    const markerEl = a._marker?.getElement?.();
    if (!markerEl) continue;
    const inner = markerEl.querySelector('.asset-marker');
    if (!inner) continue;
    inner.classList.remove('av-ok', 'av-warn', 'av-crit', 'av-overload');
    if (overloadedIds.has(a.id)) {
      inner.classList.add('av-overload');
    } else {
      const dropV   = nodeVoltDrop.get(a.id) ?? 0;
      const dropPct = Math.abs(dropV / U_N * 100);
      if (dropPct >= 3)    inner.classList.add('av-crit');
      else if (dropPct >= 2) inner.classList.add('av-warn');
      else                   inner.classList.add('av-ok');
    }
  }
  // Nicht-aktive Assets: Status-Ringe entfernen
  for (const a of ASSETS.items) {
    if (activeA.includes(a)) continue;
    const markerEl = a._marker?.getElement?.();
    if (!markerEl) continue;
    const inner = markerEl.querySelector('.asset-marker');
    if (inner) inner.classList.remove('av-ok', 'av-warn', 'av-crit', 'av-overload');
  }
}

export function clearAssetStatusRings() {
  for (const a of ASSETS.items) {
    const markerEl = a._marker?.getElement?.();
    if (!markerEl) continue;
    const inner = markerEl.querySelector('.asset-marker');
    if (inner) inner.classList.remove('av-ok', 'av-warn', 'av-crit', 'av-overload');
  }
}

function _showElCalcResult(lines, bottlenecks) {
  const el = document.getElementById('lp-el-calc-result');
  if (!el) return;
  const all = [...lines, ...(bottlenecks.length ? ['Engpässe:', ...bottlenecks] : [])];
  el.innerHTML = all.map(l => `<div class="lp-el-calc-line${l.startsWith('⚠') ? ' warn' : l.startsWith('Engpässe') ? ' err' : ''}">${l}</div>`).join('');
  el.style.display = '';
}

// ── Stromnetz komplett löschen ──────────────────────────────────
export function clearStromNetz() {
  window.stromEdges.forEach(e => {
    if (e.layer && map.hasLayer(e.layer)) map.removeLayer(e.layer);
    if (e.hitLayer && map.hasLayer(e.hitLayer)) map.removeLayer(e.hitLayer);
    if (e.arrowMarker && map.hasLayer(e.arrowMarker)) map.removeLayer(e.arrowMarker);
  });
  window.stromNodes.forEach(n => {
    if (n.marker && map.hasLayer(n.marker)) map.removeLayer(n.marker);
  });
  window.stromEdges = [];
  window.stromNodes = [];
  window.stromNextId = 20000;
  window._stromNetzKpis = null;
  updateLpStromSummary();
}

