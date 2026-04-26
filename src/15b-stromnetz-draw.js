// ── 15b-stromnetz-draw.js — Interaktion: Modus, Trassen/Leitungen zeichnen, Routing
// Portiert aus Standalone-Elektroteil (elSetMode/elExitMode, Trassen-Zeichnen,
// Leitung-Asset-Klick, elRoute).

import { map } from './02b-gebaeude.js';
import { pointInPolygon } from './03b-netz.js';
import { showHint, hideHint } from './03c-gebaeude-io.js';
import { ASSETS } from './13a-assets-core.js';
import { setPendingType } from './13c-assets-ui.js';
import { STROMNETZ, createTrasse, deleteTrasse,
         createStromLeitung, deleteStromLeitung, listStromLeitungen,
       } from './14b-stromnetz-state.js';
import { buildTrassenGraph, closestOnTrasse, dijkstra,
         ptDist, projOnSeg } from './14c-stromnetz-graph.js';
import { drawTrasse, drawLeitung, leitungInheritLifecycle,
         redrawAllTrassen } from './15a-stromnetz-render.js';

// ── Modus-Management (eindeutige Ownership) ────────────────────────────────
export function setStromnetzMode(mode) {
  exitStromnetzMode();
  STROMNETZ.mode = mode;
  // Asset-Platzierung beenden (Mutual-Exclusion)
  setPendingType(null);
  map.getContainer().style.cursor = 'crosshair';
  if (mode === 'trasse') {
    document.getElementById('btn-stromnetz-trasse')?.classList.add('active');
    const hint = STROMNETZ.trassen.length > 0
      ? 'Stromtrasse: Grüner Punkt = Anschluss an bestehende Trasse · Klick = Punkt · Doppelklick = Fertig'
      : 'Stromtrasse (1. Trasse): Klick = Punkt · Rechtsklick = rückgängig · Doppelklick = Fertig';
    showHint(hint);
  } else if (mode === 'leitung') {
    document.getElementById('btn-stromnetz-leitung')?.classList.add('active');
    showHint('Leitungen zeichnen: Start-Asset wählen…');
    attachLeitungClickHook();
  }
}

export function exitStromnetzMode() {
  if (STROMNETZ.mode === 'trasse') {
    if (STROMNETZ.trDraw.pts.length >= 2) finishTrasseSegment();
    else resetTrasseDraw();
    document.getElementById('btn-stromnetz-trasse')?.classList.remove('active');
  }
  if (STROMNETZ.mode === 'leitung') {
    resetLeitungDraw();
    detachLeitungClickHook();
    document.getElementById('btn-stromnetz-leitung')?.classList.remove('active');
  }
  STROMNETZ.mode = null;
  map.getContainer().style.cursor = '';
  hideHint();
}

export function toggleTrasseMode() {
  if (STROMNETZ.mode === 'trasse') exitStromnetzMode();
  else setStromnetzMode('trasse');
}

export function toggleLeitungMode() {
  if (STROMNETZ.mode === 'leitung') exitStromnetzMode();
  else setStromnetzMode('leitung');
}

// ── Trasse zeichnen ────────────────────────────────────────────────────────
function pixelsToMeters(px) {
  const c = map.getContainer().getBoundingClientRect();
  const cx = c.width / 2, cy = c.height / 2;
  const p1 = map.containerPointToLatLng(L.point(cx, cy));
  const p2 = map.containerPointToLatLng(L.point(cx + px, cy));
  return L.latLng(p1).distanceTo(L.latLng(p2));
}

function trasseSnapClear() {
  const d = STROMNETZ.trDraw;
  if (d.snapMarker)  { STROMNETZ.grpTrasse.removeLayer(d.snapMarker);  d.snapMarker = null; }
  if (d.previewLine) { STROMNETZ.grpTrasse.removeLayer(d.previewLine); d.previewLine = null; }
  d.snapPt = null;
}

// Snap-Priorität: 1) Vertex (VERTEX_PX=30px), 2) Segment-Projektion (SEG_PX=18px)
// Pixel-basiert, damit Schwelle zoom-unabhängig bleibt.
function findSnapPt(lat, lng) {
  if (STROMNETZ.trassen.length === 0) return null;
  const VERTEX_PX = 30, SEG_PX = 18;
  const cur = map.latLngToContainerPoint(L.latLng(lat, lng));

  let bestPt = null, bestD2 = VERTEX_PX * VERTEX_PX;
  for (const tr of STROMNETZ.trassen) {
    for (const v of tr.pts) {
      const vp = map.latLngToContainerPoint(L.latLng(v[0], v[1]));
      const d2 = (cur.x - vp.x) ** 2 + (cur.y - vp.y) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestPt = v; }
    }
  }
  if (bestPt) return bestPt;

  let segBestPt = null, segBestD2 = SEG_PX * SEG_PX;
  for (const tr of STROMNETZ.trassen) {
    for (let i = 0; i < tr.pts.length - 1; i++) {
      const ap = map.latLngToContainerPoint(L.latLng(tr.pts[i][0],   tr.pts[i][1]));
      const bp = map.latLngToContainerPoint(L.latLng(tr.pts[i+1][0], tr.pts[i+1][1]));
      const dx = bp.x - ap.x, dy = bp.y - ap.y;
      const len2 = dx*dx + dy*dy; if (len2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((cur.x-ap.x)*dx + (cur.y-ap.y)*dy) / len2));
      const px = ap.x + t*dx, py = ap.y + t*dy;
      const d2 = (cur.x-px)**2 + (cur.y-py)**2;
      if (d2 < segBestD2) {
        segBestD2 = d2;
        const ll = map.containerPointToLatLng(L.point(px, py));
        segBestPt = [ll.lat, ll.lng];
      }
    }
  }
  return segBestPt;
}

export function addTrassePoint(latlng) {
  const hasTrassen = STROMNETZ.trassen.length > 0;
  const d = STROMNETZ.trDraw;

  // 1. Punkt eines neuen Astes MUSS an bestehender Trasse anschließen
  if (hasTrassen && d.pts.length === 0 && !d.snapPt) {
    showHint('⚠ Neuer Ast muss an einer bestehenden Trasse beginnen – Mauszeiger auf die Trasse führen.');
    return;
  }

  const pt = (hasTrassen && d.snapPt) ? d.snapPt : [latlng.lat, latlng.lng];
  d.pts.push(pt);
  redrawTrasseDraw();
}

export function undoTrassePt() {
  if (STROMNETZ.trDraw.pts.length > 0) {
    STROMNETZ.trDraw.pts.pop();
    redrawTrasseDraw();
  }
}

function redrawTrasseDraw() {
  const d = STROMNETZ.trDraw;
  if (d.poly) { STROMNETZ.grpTrasse.removeLayer(d.poly); d.poly = null; }
  if (d.pts.length >= 2) {
    d.poly = L.polyline(d.pts, { color: '#f9a825', weight: 3, dashArray: '6 4', opacity: 0.75 });
    STROMNETZ.grpTrasse.addLayer(d.poly);
  }
}

export function finishTrasseSegment() {
  const d = STROMNETZ.trDraw;
  if (d.pts.length >= 2) {
    const tr = createTrasse([...d.pts]);
    if (tr) drawTrasse(tr);
    showHint('Ast gespeichert. Nächsten Ast beginnen oder Modus beenden.');
  }
  resetTrasseDraw();
}

function resetTrasseDraw() {
  const d = STROMNETZ.trDraw;
  if (d.poly) { STROMNETZ.grpTrasse.removeLayer(d.poly); d.poly = null; }
  trasseSnapClear();
  d.pts = [];
}

// ── Leitung-Zeichnen (Asset → Asset) ───────────────────────────────────────
// Dispatch-Hook: globaler Click-Handler (Capture-Phase) auf document, der
// data-asset-id-Elemente abfängt solange Leitungs-Modus aktiv ist.
function onDocumentClickForLeitung(e) {
  if (STROMNETZ.mode !== 'leitung') return;
  const el = e.target.closest?.('[data-asset-id]');
  if (!el) return;
  e.stopPropagation();
  e.preventDefault();
  leitungAssetClick(el.dataset.assetId);
}

function attachLeitungClickHook() {
  document.addEventListener('click', onDocumentClickForLeitung, true);
}

function detachLeitungClickHook() {
  document.removeEventListener('click', onDocumentClickForLeitung, true);
}

export function leitungAssetClick(assetId) {
  const d = STROMNETZ.ltDraw;
  if (d.startId === null) {
    d.startId = assetId;
    highlightAsset(assetId, true);
    showHint('Ziel-Asset wählen…');
  } else if (d.startId === assetId) {
    resetLeitungDraw();
    showHint('Auswahl gelöscht. Neues Start-Asset wählen…');
  } else {
    const startId = d.startId;
    resetLeitungDraw();
    createLeitungRouted(startId, assetId);
    showHint('Leitung erstellt. Nächstes Start-Asset wählen…');
  }
}

function resetLeitungDraw() {
  if (STROMNETZ.ltDraw.startId) highlightAsset(STROMNETZ.ltDraw.startId, false);
  STROMNETZ.ltDraw.startId = null;
}

function highlightAsset(assetId, on) {
  const el = document.querySelector(`[data-asset-id="${assetId}"]`);
  if (el) el.classList.toggle('leitung-start', on);
}

// ── Routing: A → (Trassen) → B ─────────────────────────────────────────────
// Liefert Array [lat,lng] mit Zwischen-Punkten entlang der Trassen.
// Gleiches Gebäude → Luftlinie. Ohne Trassen → Luftlinie.
export function route(aId, bId) {
  const asA = ASSETS.items.find(a => a.id === aId);
  const asB = ASSETS.items.find(a => a.id === bId);
  if (!asA || !asB) return [];
  const ptA = [asA.lat, asA.lng], ptB = [asB.lat, asB.lng];

  // Gleiches Gebäude → direkte Verbindung
  const bA = asA.buildingId || findBuildingAt(asA.lat, asA.lng);
  const bB = asB.buildingId || findBuildingAt(asB.lat, asB.lng);
  if (bA && bA === bB) return [ptA, ptB];

  if (!STROMNETZ.trassen.some(t => t.pts.length >= 2)) return [ptA, ptB];

  const nodeMap = buildTrassenGraph();
  if (nodeMap.size === 0) return [ptA, ptB];

  const projA = closestOnTrasse(asA.lat, asA.lng);
  const projB = closestOnTrasse(asB.lat, asB.lng);
  if (!projA || !projB) return [ptA, ptB];

  // Virtuelle Einstiegsknoten in Graph einfügen (portiert aus Standalone elRoute)
  function insertVirtual(proj) {
    const tr = STROMNETZ.trassen.find(t => t.id === proj.trasseId);
    if (!tr) return null;
    const ptPrev = tr.pts[proj.segIdx], ptNext = tr.pts[proj.segIdx+1];
    const kPrev = ptPrev[0].toFixed(7) + ',' + ptPrev[1].toFixed(7);
    const kNext = ptNext[0].toFixed(7) + ',' + ptNext[1].toFixed(7);
    const kVirt = proj.pt[0].toFixed(7) + ',' + proj.pt[1].toFixed(7);
    if (nodeMap.has(kVirt)) return kVirt;

    const { t: tVirt } = projOnSeg(proj.pt, ptPrev, ptNext);
    const segNodes = [{ k: kPrev, t: 0 }, { k: kNext, t: 1 }];
    for (const [k, n] of nodeMap) {
      if (k === kPrev || k === kNext) continue;
      const { t, pt: onPt } = projOnSeg([n.lat, n.lng], ptPrev, ptNext);
      if (t > 1e-4 && t < 1-1e-4 && ptDist([n.lat, n.lng], onPt) < 2.0) {
        segNodes.push({ k, t });
      }
    }
    segNodes.sort((a, b) => a.t - b.t);

    const vn = { id: kVirt, lat: proj.pt[0], lng: proj.pt[1], adj: [] };
    nodeMap.set(kVirt, vn);

    const prevNb = [...segNodes].reverse().find(sn => sn.t <= tVirt + 1e-9);
    const nextNb = segNodes.find(sn => sn.t >= tVirt - 1e-9);
    [prevNb, nextNb].forEach(nb => {
      if (!nb || nb.k === kVirt) return;
      const nbNode = nodeMap.get(nb.k);
      if (!nbNode) return;
      const d = ptDist(proj.pt, [nbNode.lat, nbNode.lng]);
      if (!vn.adj.some(a => a.toKey === nb.k)) {
        vn.adj.push({ toKey: nb.k, dist: d, segPts: [proj.pt, [nbNode.lat, nbNode.lng]] });
        nbNode.adj.push({ toKey: kVirt, dist: d, segPts: [[nbNode.lat, nbNode.lng], proj.pt] });
      }
    });
    return kVirt;
  }

  const kA = insertVirtual(projA), kB = insertVirtual(projB);
  if (!kA || !kB) return [ptA, ptB];

  // Beide auf demselben Segment → Direktkante einfügen (Umweg-Bug vermeiden)
  if (kA !== kB && projA.trasseId === projB.trasseId && projA.segIdx === projB.segIdx) {
    const dAB = ptDist(projA.pt, projB.pt);
    nodeMap.get(kA)?.adj.push({ toKey: kB, dist: dAB, segPts: [projA.pt, projB.pt] });
    nodeMap.get(kB)?.adj.push({ toKey: kA, dist: dAB, segPts: [projB.pt, projA.pt] });
  }

  const trassePth = dijkstra(nodeMap, kA, kB);
  if (!trassePth || trassePth.length === 0) return [ptA, ptB];

  const r = [ptA];
  if (ptDist(ptA, projA.pt) > 2) r.push(projA.pt);
  for (const pt of trassePth) {
    const last = r[r.length - 1];
    if (!last || ptDist(last, pt) > 0.5) r.push(pt);
  }
  if (ptDist(ptB, projB.pt) > 2) {
    const last = r[r.length - 1];
    if (!last || ptDist(last, projB.pt) > 0.5) r.push(projB.pt);
  }
  r.push(ptB);
  return r;
}

// ── Gebäude-Zuordnung (Point-in-Polygon) ───────────────────────────────────
function findBuildingAt(lat, lng) {
  const list = window.gebaeude || [];
  const pt = { lat, lng };
  for (const g of list) {
    if (!g.polygon || g.polygon.length < 3) continue;
    if (pointInPolygon(pt, g.polygon)) return g.id;
  }
  return null;
}

// pointInPolygon ist jetzt zentral aus 03b-netz.js importiert (siehe Zeile 6).

// ── Leitung mit Auto-Routing anlegen + zeichnen ────────────────────────────
export function createLeitungRouted(aId, bId, opts = {}) {
  // Duplikate verhindern
  const existing = listStromLeitungen().find(l =>
    (l.aId === aId && l.bId === bId) || (l.aId === bId && l.bId === aId));
  if (existing) {
    showHint('Leitung zwischen diesen Assets bereits vorhanden.');
    return null;
  }
  const r = route(aId, bId);
  const lt = createStromLeitung(aId, bId, { ...opts, route: r });
  if (!lt) return null;
  if (opts.baujahr === undefined && opts.abrissjahr === undefined) {
    leitungInheritLifecycle(lt);
  }
  drawLeitung(lt);
  return lt;
}

// ── Reroute-API ────────────────────────────────────────────────────────────
export function rerouteStromLeitungenForAsset(assetId) {
  const leitungen = listStromLeitungen().filter(l => l.aId === assetId || l.bId === assetId);
  for (const l of leitungen) {
    l.route = route(l.aId, l.bId);
    drawLeitung(l);
  }
}

export function rerouteAllStromLeitungen() {
  for (const l of listStromLeitungen()) {
    l.route = route(l.aId, l.bId);
    drawLeitung(l);
  }
  showHint('Alle Leitungen neu ausgerichtet.');
}

// ── Map-Event-Handler ──────────────────────────────────────────────────────
function onMapClick(e) {
  if (STROMNETZ.mode === 'trasse') addTrassePoint(e.latlng);
}

function onMapDblclick(e) {
  if (STROMNETZ.mode === 'trasse') {
    L.DomEvent.stopPropagation(e);
    finishTrasseSegment();
    showHint('Ast abgeschlossen. Neuen Ast beginnen oder Modus beenden.');
  }
}

function onMapContextmenu(e) {
  if (STROMNETZ.mode === 'trasse') {
    L.DomEvent.preventDefault(e);
    undoTrassePt();
  }
}

function onMapMousemove(e) {
  if (STROMNETZ.mode !== 'trasse') { trasseSnapClear(); return; }
  trasseSnapClear();
  const ll = e.latlng;
  const snapPt = findSnapPt(ll.lat, ll.lng);
  STROMNETZ.trDraw.snapPt = snapPt;

  if (snapPt) {
    STROMNETZ.trDraw.snapMarker = L.circleMarker(snapPt, {
      radius: 8, color: '#00e676', weight: 2.5,
      fillColor: '#00e676', fillOpacity: 0.3,
      className: 'stromnetz-snap-ring',
    });
    STROMNETZ.grpTrasse.addLayer(STROMNETZ.trDraw.snapMarker);
  }

  const target = snapPt || [ll.lat, ll.lng];
  if (STROMNETZ.trDraw.pts.length > 0) {
    const last = STROMNETZ.trDraw.pts[STROMNETZ.trDraw.pts.length - 1];
    STROMNETZ.trDraw.previewLine = L.polyline([last, target], {
      color: snapPt ? '#00e676' : '#f9a825',
      weight: 1.5, dashArray: '5 5', opacity: 0.7,
    });
    STROMNETZ.grpTrasse.addLayer(STROMNETZ.trDraw.previewLine);
  }
}

function onKeydown(e) {
  if (e.key === 'Escape' && STROMNETZ.mode) exitStromnetzMode();
}

// ── Init: Event-Handler einmalig registrieren ──────────────────────────────
setTimeout(() => {
  map.on('click',       onMapClick);
  map.on('dblclick',    onMapDblclick);
  map.on('contextmenu', onMapContextmenu);
  map.on('mousemove',   onMapMousemove);
  document.addEventListener('keydown', onKeydown);
}, 0);
