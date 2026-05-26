// ── 13g-ms-ring.js — MS-Ring-Topologie-Analyse ──────────────────────────────
// Portiert aus Energiekarte1.1(6).html (Zeilen 6802–7347)
//
// Leistungsumfang:
//   • elDetectMSRings()        – DFS-Zykluserkennung im MS-Netz
//   • elDrawMSRings()          – farbiges Ring-Overlay auf Leaflet-Karte
//   • elClearMSRings()         – Overlay und Daten löschen
//   • elCalcMSRing(ring)       – Stichbetrieb-Berechnung (Trennstelle offen)
//   • elCalcN1(ring)           – (n-1)-Ausfallanalyse je Kante
//   • elBuildMSHoverOverrides  – Hover-Werte für Kabel-Tooltip
//   • elRunMSAnalyse()         – Orchestrierung + HTML-Ausgabe im Panel
//   • runMSAnalyse()           – Globaler Alias (window-Exposition)

import { map } from './02b-gebaeude.js';
import { ASSETS, ASSET_CFG, getAssetStatus } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';
import { calcSpannungsfall, calcStrom } from './lib/elektro-formeln.js';

// ── MS-Kabelparameter ────────────────────────────────────────────────────────
const MS_R_OHM_PER_KM = { 35:0.524, 50:0.387, 70:0.268, 95:0.193, 120:0.153, 150:0.124, 185:0.099, 240:0.0754 };
const MS_X_OHM_PER_KM = { 35:0.11,  50:0.10,  70:0.10,  95:0.09,  120:0.09,  150:0.09,  185:0.08,  240:0.08  };
const MS_I_MAX_A       = { 35:140,   50:175,   70:220,   95:260,   120:300,   150:340,   185:385,   240:445   };

// ── Modulzustand ─────────────────────────────────────────────────────────────
let msRings      = [];
let msRingLayer  = null;
let msHoverOverride = null; // { year, byId: { edgeId → Stichwert } }

// ── Adapter: aktive Assets und Kanten aus dem neuen System ──────────────────
function getActiveAssets(yr) {
  return ASSETS.items.filter(a => getAssetStatus(a, yr) === 'active');
}

function getActiveEdges(yr) {
  // stromEdges aus 05b-stromnetz.js – dort global verwaltet
  return (window.stromEdges || []).filter(e => {
    const bj = e.baujahr  ? parseInt(e.baujahr)  : null;
    const aj = e.abrissjahr ? parseInt(e.abrissjahr) : null;
    if (bj && yr < bj) return false;
    if (aj && yr >= aj) return false;
    return true;
  });
}

// Länge eines Kantes in Metern (aus gespeicherter Route oder Fallback)
function edgeLengthM(edge) {
  if (edge._lengthM != null) return edge._lengthM;
  if (edge.route && edge.route.length >= 2) {
    let d = 0;
    for (let i = 1; i < edge.route.length; i++) {
      d += L.latLng(edge.route[i-1]).distanceTo(L.latLng(edge.route[i]));
    }
    return d;
  }
  // Direkte Luftlinie über Start-/Endknoten
  const nodes = window.stromNodes || [];
  const nA = nodes.find(n => n.id === edge.u);
  const nB = nodes.find(n => n.id === edge.v);
  if (nA && nB) return L.latLng(nA.lat, nA.lng).distanceTo(L.latLng(nB.lat, nB.lng));
  return 0;
}

// Kabelquerschnitt eines Kantes (mm²)
function edgeQs(edge) {
  return edge.crossSection || edge.qs || 95;
}

// ── Stich-Hilfsfunktion ──────────────────────────────────────────────────────
// Berechnet Ströme auf einem radialen Stich vom Einspeisepunkt zum Ende.
// stichNodes   : [entry, n1, n2, ..., ende]
// stichEdgeObjs: Kanten-Objekte in gleicher Reihenfolge (edge[i] verbindet nodes[i]→nodes[i+1])
function _msCalcStich(stichNodes, stichEdgeObjs, nodeLoadMap, U_N, cosPhi) {
  return stichEdgeObjs.map((edge, i) => {
    const downLoad = stichNodes.slice(i + 1).reduce((s, nid) => s + (nodeLoadMap.get(nid) || 0), 0);
    const I_A      = calcStrom(downLoad, U_N, cosPhi);
    const qs       = edgeQs(edge);
    const lenM     = edgeLengthM(edge);
    const r_per_m  = (MS_R_OHM_PER_KM[qs] || 0.193) / 1000; // Ω/m
    const x_per_m  = (MS_X_OHM_PER_KM[qs] || 0.09)  / 1000; // Ω/m
    const dU_pct   = calcSpannungsfall(I_A, lenM, r_per_m, x_per_m, U_N, cosPhi);
    const I_max    = MS_I_MAX_A[qs] || 260;
    const ausl_pct = I_max > 0 ? (I_A / I_max) * 100 : 0;
    return {
      from: stichNodes[i], to: stichNodes[i + 1],
      edgeId: edge.id, I_A, dU_pct, ausl_pct, I_max, lenM, qs,
    };
  });
}

// ── Ring-Erkennung ───────────────────────────────────────────────────────────
export function elDetectMSRings() {
  const yr       = globalYear || new Date().getFullYear();
  const activeA  = getActiveAssets(yr);
  const activeE  = getActiveEdges(yr);
  const msTypes  = new Set(['NAP', 'Schaltanlage', 'Trafo']);
  const msAssets = activeA.filter(a => msTypes.has(a.type));
  const msIds    = new Set(msAssets.map(a => a.id));

  // Nur Kanten zwischen zwei MS-Knoten
  const msEdges  = activeE.filter(e => msIds.has(e.u) && msIds.has(e.v));

  // Adjazenzliste
  const adj = new Map();
  msAssets.forEach(a => adj.set(a.id, []));
  msEdges.forEach(e => {
    if (adj.has(e.u) && adj.has(e.v)) {
      adj.get(e.u).push({ to: e.v, edge: e });
      adj.get(e.v).push({ to: e.u, edge: e });
    }
  });

  // Zyklen via iterativem DFS (vermeidet Stack-Overflow bei großen Netzen)
  const visited = new Set();
  const rings   = [];

  for (const a of msAssets) {
    if (visited.has(a.id)) continue;
    visited.add(a.id);

    // Gemeinsamer Pfad-Puffer: wird bei Push erweitert, bei Backtrack getrimmt
    const path      = [a.id];
    const pathEdges = [];
    // Stack-Einträge: { node, par, neighbors, idx }
    const stack = [{ node: a.id, par: null, neighbors: adj.get(a.id) || [], idx: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];

      if (frame.idx >= frame.neighbors.length) {
        // Alle Nachbarn verarbeitet → Backtrack
        stack.pop();
        path.pop();
        if (pathEdges.length > 0) pathEdges.pop();
        continue;
      }

      const nb = frame.neighbors[frame.idx++];
      if (nb.to === frame.par) continue;

      if (visited.has(nb.to)) {
        // Rückwärtskante → Zyklus gefunden, falls Knoten im aktuellen Pfad liegt
        const cidx = path.indexOf(nb.to);
        if (cidx >= 0) {
          rings.push({ nodes: path.slice(cidx), edges: pathEdges.slice(cidx).concat([nb.edge]) });
        }
        continue;
      }

      visited.add(nb.to);
      path.push(nb.to);
      pathEdges.push(nb.edge);
      stack.push({ node: nb.to, par: frame.node, neighbors: adj.get(nb.to) || [], idx: 0 });
    }
  }

  // Deduplizierung (gleiche Kantenmenge = gleicher Ring)
  const seen = new Set();
  const uniqueRings = [];
  for (const r of rings) {
    const key = r.edges.map(e => e.id).sort().join(',');
    if (!seen.has(key)) { seen.add(key); uniqueRings.push(r); }
  }

  // Metadaten je Ring
  uniqueRings.forEach(r => {
    r.assetDetails = r.nodes.map(nid => activeA.find(a => a.id === nid)).filter(Boolean);
    r.totalLengthM = r.edges.reduce((s, e) => s + edgeLengthM(e), 0);
    // Trennstellen: Schaltanlagen mit trennstelle-Flag
    r.trennstellen = r.assetDetails.filter(a =>
      a.type === 'Schaltanlage' && a.props?.trennstelle);

    // Topologie 1: NAP ist selbst Ringknoten
    const napInRing = r.nodes.find(nid => activeA.find(a => a.id === nid)?.type === 'NAP') || null;
    r.napId      = napInRing;
    r.napEntryId = napInRing;
    r.napFeedEdge = null;

    // Topologie 2: NAP außerhalb, verbunden mit einem Ringknoten
    if (!r.napId) {
      const ringSet = new Set(r.nodes);
      for (const nap of activeA.filter(a => a.type === 'NAP')) {
        const link = activeE.find(e =>
          (e.u === nap.id && ringSet.has(e.v)) ||
          (e.v === nap.id && ringSet.has(e.u))
        );
        if (link) {
          r.napId       = nap.id;
          r.napEntryId  = ringSet.has(link.u) ? link.u : link.v;
          r.napFeedEdge = link;
          break;
        }
      }
    }
  });

  msRings = uniqueRings;
  return uniqueRings;
}

// ── Karte: Ring-Overlay ──────────────────────────────────────────────────────
export function elDrawMSRings() {
  if (msRingLayer) { map.removeLayer(msRingLayer); msRingLayer = null; }
  if (msRings.length === 0) return;
  msRingLayer = L.layerGroup().addTo(map);
  const colors = ['#f9a825', '#ff7043', '#ab47bc', '#26a69a', '#42a5f5'];

  msRings.forEach((ring, ri) => {
    const col = colors[ri % colors.length];
    ring.edges.forEach(e => {
      const pts = e.route && e.route.length >= 2
        ? e.route
        : (() => {
            const nodes = window.stromNodes || [];
            const nA = nodes.find(n => n.id === e.u);
            const nB = nodes.find(n => n.id === e.v);
            return nA && nB ? [[nA.lat, nA.lng], [nB.lat, nB.lng]] : null;
          })();
      if (pts) {
        L.polyline(pts, { color: col, weight: 5, opacity: 0.35, dashArray: '10,6', interactive: false })
          .addTo(msRingLayer);
      }
    });
    ring.trennstellen.forEach(ts => {
      L.circleMarker([ts.lat, ts.lng], {
        radius: 8, color: '#e53935', fillColor: '#e53935', fillOpacity: 0.6, weight: 2,
      }).bindTooltip(`Trennstelle: ${ts.name}`).addTo(msRingLayer);
    });
  });
}

export function elClearMSRings() {
  if (msRingLayer) { map.removeLayer(msRingLayer); msRingLayer = null; }
  msRings = [];
  msHoverOverride = null;
  _refreshMSPanel();
}

// ── Normaloperation: Stichbetrieb ────────────────────────────────────────────
export function elCalcMSRing(ring) {
  const yr      = globalYear || new Date().getFullYear();
  const activeA = getActiveAssets(yr);
  const activeE = getActiveEdges(yr);

  const napId = ring.napId;
  if (!napId) return null;

  const entryId  = ring.napEntryId || napId;
  const napAsset = activeA.find(a => a.id === napId);
  const U_kV     = parseFloat(napAsset?.props?.spannungKV) || 20;
  const U_N      = U_kV * 1000;
  const cosPhi   = parseFloat(document.getElementById('strom-ms-cosphi')?.value) || 0.9;

  // Geordneten Ring-Pfad ab entryId aufbauen
  const adj = new Map();
  ring.nodes.forEach(nid => adj.set(nid, []));
  ring.edges.forEach(e => {
    adj.get(e.u)?.push({ to: e.v, edge: e });
    adj.get(e.v)?.push({ to: e.u, edge: e });
  });

  const orderedNodes = [entryId];
  const orderedEdges = [];
  let prev = null, cur = entryId;
  for (let s = 0; s < ring.nodes.length + 2; s++) {
    const next = (adj.get(cur) || []).find(n => n.to !== prev);
    if (!next) break;
    if (next.to === entryId) { orderedEdges.push(next.edge); break; }
    orderedNodes.push(next.to);
    orderedEdges.push(next.edge);
    prev = cur; cur = next.to;
  }
  const N = orderedNodes.length;
  if (orderedEdges.length < N) return null; // Ring nicht geschlossen

  // Trennstelle im Pfad lokalisieren
  const trennId  = ring.trennstellen[0]?.id ?? null;
  const trennIdx = trennId ? orderedNodes.indexOf(trennId) : -1;

  // Knotenlasten: Summe der NS-Lasten aller angeschlossenen Trafos
  const ringEdgeIds = new Set(ring.edges.map(e => e.id));
  const nodeLoads   = new Map();

  for (const nid of orderedNodes) {
    const asset = activeA.find(a => a.id === nid);
    if (!asset) { nodeLoads.set(nid, 0); continue; }

    const abgaenge = activeE.filter(e =>
      (e.u === nid || e.v === nid) && !ringEdgeIds.has(e.id));

    let totalLoad = 0;
    if (asset.type === 'Trafo') {
      // Trafo direkt im Ring: NS-Last aus gespeicherter Kalkulation
      totalLoad = abgaenge.reduce((s, e) =>
        s + Math.abs(e.peakFlowKw || 0), 0);
    } else {
      // SA oder NAP: Lasten der angebundenen Trafos summieren
      for (const abg of abgaenge) {
        const otherId = abg.u === nid ? abg.v : abg.u;
        const other   = activeA.find(a => a.id === otherId);
        if (!other || other.type !== 'Trafo') continue;
        const nsEdges = activeE.filter(e =>
          (e.u === otherId || e.v === otherId) && !ringEdgeIds.has(e.id) && e.id !== abg.id);
        totalLoad += nsEdges.reduce((s, e) => s + Math.abs(e.peakFlowKw || 0), 0);
      }
    }
    nodeLoads.set(nid, totalLoad);
  }

  const totalLoadKW = Array.from(nodeLoads.values()).reduce((s, v) => s + v, 0);

  // Stich-Berechnung
  const sticheMode = trennIdx > 0 && trennIdx < N;
  let leftNodes = [], leftEdges = [], leftEdgeResults = [];
  let rightNodes = [], rightEdges = [], rightEdgeResults = [];

  if (sticheMode) {
    leftNodes        = orderedNodes.slice(0, trennIdx + 1);
    leftEdges        = orderedEdges.slice(0, trennIdx);
    leftEdgeResults  = _msCalcStich(leftNodes, leftEdges, nodeLoads, U_N, cosPhi);
    rightNodes       = [orderedNodes[0], ...orderedNodes.slice(trennIdx).reverse()];
    rightEdges       = [...orderedEdges.slice(trennIdx)].reverse();
    rightEdgeResults = _msCalcStich(rightNodes, rightEdges, nodeLoads, U_N, cosPhi);
  } else {
    leftNodes        = [...orderedNodes, orderedNodes[0]];
    leftEdges        = [...orderedEdges];
    leftEdgeResults  = _msCalcStich(leftNodes, leftEdges, nodeLoads, U_N, cosPhi);
  }

  // Zugangs-Kante NAP→entryId (nur bei Topologie 2)
  let feedEdgeResult = null;
  if (ring.napFeedEdge) {
    const fe  = ring.napFeedEdge;
    const I_A     = calcStrom(totalLoadKW, U_N, cosPhi);
    const qs      = edgeQs(fe);
    const lenM    = edgeLengthM(fe);
    const r_per_m = (MS_R_OHM_PER_KM[qs] || 0.193) / 1000;
    const x_per_m = (MS_X_OHM_PER_KM[qs] || 0.09)  / 1000;
    feedEdgeResult = {
      from: napId, to: entryId, edgeId: fe.id, I_A,
      dU_pct: calcSpannungsfall(I_A, lenM, r_per_m, x_per_m, U_N, cosPhi),
      ausl_pct: (I_A / (MS_I_MAX_A[qs] || 260)) * 100,
      I_max: MS_I_MAX_A[qs] || 260, lenM, qs, isFeedEdge: true,
    };
  }

  return {
    nodes: orderedNodes.map(nid => ({ id: nid, P_kW: nodeLoads.get(nid) || 0 })),
    edges: [...leftEdgeResults, ...rightEdgeResults],
    totalLoadKW, U_kV, napId, entryId, feedEdgeResult,
    orderedNodes, orderedEdges, trennIdx, nodeLoads,
    leftNodes, leftEdges, leftEdgeResults,
    rightNodes, rightEdges, rightEdgeResults,
    sticheMode,
  };
}

// ── (n-1)-Analyse ────────────────────────────────────────────────────────────
export function elCalcN1(ring) {
  const nr = elCalcMSRing(ring);
  if (!nr) return null;
  const { orderedNodes, orderedEdges, nodeLoads, U_kV } = nr;
  const U_N = U_kV * 1000;
  const cosPhi = parseFloat(document.getElementById('strom-ms-cosphi')?.value) || 0.9;
  const yr  = globalYear || new Date().getFullYear();
  const activeA = getActiveAssets(yr);

  const contingencies = [];
  for (let fi = 0; fi < orderedEdges.length; fi++) {
    const failedEdge = orderedEdges[fi];
    const lpNodes = orderedNodes.slice(0, fi + 1);
    const lpEdges = orderedEdges.slice(0, fi);
    const rpNodes = [orderedNodes[0], ...orderedNodes.slice(fi + 1).reverse()];
    const rpEdges = [...orderedEdges.slice(fi + 1)].reverse();

    const all        = [
      ..._msCalcStich(lpNodes, lpEdges, nodeLoads, U_N, cosPhi),
      ..._msCalcStich(rpNodes, rpEdges, nodeLoads, U_N, cosPhi),
    ];
    const worstAusl = all.reduce((m, e) => Math.max(m, e.ausl_pct), 0);
    const worstDU   = all.reduce((m, e) => Math.max(m, e.dU_pct),   0);

    contingencies.push({
      failedEdgeId: failedEdge.id,
      failedEdgeName: `${activeA.find(a => a.id === failedEdge.u)?.name || '?'} – ${activeA.find(a => a.id === failedEdge.v)?.name || '?'}`,
      worstAusl, worstDU,
      ok: worstAusl <= 100 && worstDU <= 5,
    });
  }

  return {
    contingencies,
    allOk: contingencies.every(c => c.ok),
    worstCase: contingencies.length > 0
      ? contingencies.reduce((w, c) => c.worstAusl > w.worstAusl ? c : w, contingencies[0])
      : null,
    sticheMode: nr.sticheMode,
  };
}

// ── Hover-Overrides (MS-Kabel-Tooltip) ──────────────────────────────────────
export function elBuildMSHoverOverrides(rings) {
  const byId   = {};
  const cosPhi = parseFloat(document.getElementById('strom-ms-cosphi')?.value) || 0.9;
  if (!Array.isArray(rings) || rings.length === 0) return byId;

  const merge = (edgeResults, uKV, tag) => {
    (edgeResults || []).forEach(e => {
      if (!e?.edgeId) return;
      byId[e.edgeId] = {
        edgeId: e.edgeId, from: e.from, to: e.to,
        I_A: e.I_A || 0, I_max: e.I_max || 0,
        ausl_pct: e.ausl_pct || 0, dU_pct: e.dU_pct || 0,
        U_kV: uKV || 20, source: tag,
        P_kW_equiv: (Math.sqrt(3) * (uKV || 20) * 1000 * (e.I_A || 0) * cosPhi) / 1000,
      };
    });
  };

  rings.forEach(ring => {
    const lf = elCalcMSRing(ring);
    if (!lf) return;
    const uKV = lf.U_kV || 20;
    if (lf.feedEdgeResult?.edgeId) merge([lf.feedEdgeResult], uKV, 'nap-feed');
    if (lf.sticheMode) {
      merge(lf.leftEdgeResults,  uKV, 'left-stich');
      merge(lf.rightEdgeResults, uKV, 'right-stich');
      const openEdge = lf.orderedEdges?.[lf.trennIdx];
      if (openEdge?.id) {
        byId[openEdge.id] = {
          edgeId: openEdge.id, from: openEdge.u, to: openEdge.v,
          I_A: 0, I_max: MS_I_MAX_A[edgeQs(openEdge)] || 260,
          ausl_pct: 0, dU_pct: 0, U_kV: uKV,
          source: 'open-trennstelle', isOpenTrennstelle: true, P_kW_equiv: 0,
        };
      }
    } else {
      merge(lf.edges, uKV, 'ring');
    }
  });
  return byId;
}

// ── Panel-Hilfe: Stich-Tabelle ───────────────────────────────────────────────
function _renderStich(edgeResults, label, assetList) {
  if (!edgeResults || edgeResults.length === 0) return '';
  const rows = edgeResults.map(e => {
    const fn  = assetList.find(a => a.id === e.from)?.name || '?';
    const tn  = assetList.find(a => a.id === e.to)?.name   || '?';
    const col = e.ausl_pct > 100 ? '#ef5350' : e.ausl_pct > 80 ? '#ffa726' : '#66bb6a';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:2px 3px;color:var(--text);font-size:9px;">${fn}→${tn}</td>
      <td style="padding:2px 3px;text-align:right;font-size:9px;">${e.I_A.toFixed(1)}</td>
      <td style="padding:2px 3px;text-align:right;font-size:9px;">${e.dU_pct.toFixed(2)}</td>
      <td style="padding:2px 3px;text-align:right;color:${col};font-weight:600;font-size:9px;">${e.ausl_pct.toFixed(0)}%</td>
    </tr>`;
  }).join('');
  return `<div style="font-size:9px;color:var(--muted);margin:6px 0 2px;">${label}</div>
  <table style="width:100%;border-collapse:collapse;">
    <tr style="color:var(--muted);border-bottom:1px solid var(--border);">
      <th style="text-align:left;padding:2px 3px;font-size:8px;">Kante</th>
      <th style="text-align:right;padding:2px 3px;font-size:8px;">I (A)</th>
      <th style="text-align:right;padding:2px 3px;font-size:8px;">ΔU (%)</th>
      <th style="text-align:right;padding:2px 3px;font-size:8px;">Ausl.</th>
    </tr>${rows}
  </table>`;
}

function _refreshMSPanel() {
  const panel = document.getElementById('ms-ring-results');
  if (!panel) return;
  panel.innerHTML = '';
}

// ── Haupt-Orchestrierung ─────────────────────────────────────────────────────
export function elRunMSAnalyse() {
  msHoverOverride = null;
  const rings = elDetectMSRings();
  elDrawMSRings();

  const panel = document.getElementById('ms-ring-results');
  if (!panel) return;

  if (rings.length === 0) {
    panel.innerHTML = `<div style="font-size:10px;color:var(--muted);padding:6px 0;line-height:1.5;">
      Keine MS-Ringe erkannt.<br>
      Verbinde NAP, Schaltanlagen und Trafos zu einem Ring.</div>`;
    return;
  }

  const yr = globalYear || new Date().getFullYear();
  msHoverOverride = { year: yr, byId: elBuildMSHoverOverrides(rings) };

  let html = `<div style="font-size:9px;color:var(--muted);padding:3px 0 5px;">
    Jahr: <b style="color:var(--text);">${yr}</b> · ${rings.length} Ring${rings.length !== 1 ? 'e' : ''} erkannt
  </div>`;

  rings.forEach((ring, ri) => {
    const lf = elCalcMSRing(ring);
    const n1 = elCalcN1(ring);
    const n1Color = n1?.allOk ? '#66bb6a' : '#ef5350';
    const n1Text  = n1?.allOk ? '(n-1) ✓ OK' : '(n-1) ✗ KRITISCH';
    const trennName = ring.trennstellen[0]?.name || 'Trennstelle';
    const allAssets = getActiveAssets(yr);

    html += `<div style="background:var(--bg);border-radius:4px;padding:6px 8px;margin-top:6px;border-left:3px solid #f9a825;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <span style="font-size:11px;font-weight:600;color:#f9a825;">Ring ${ri + 1}</span>
        <span style="font-size:9px;color:${n1Color};font-weight:700;">${n1Text}</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:5px;">
        ${ring.nodes.length} Knoten · ${ring.edges.length} Kanten · ${Math.round(ring.totalLengthM)} m
        ${lf?.sticheMode
          ? ` · <span style="color:#4fc3f7;">Stichbetrieb</span>`
          : ` · <span style="color:#f9a825;">Ringbetrieb</span>`}
      </div>`;

    if (lf) {
      html += `<div style="font-size:10px;color:var(--text);margin-bottom:4px;">
        Gesamt: <b>${lf.totalLoadKW.toFixed(0)} kW</b> · ${lf.U_kV} kV
      </div>`;

      // Zugangs-Kante NAP→Ring (Topologie 2)
      if (lf.feedEdgeResult) {
        const fe  = lf.feedEdgeResult;
        const col = fe.ausl_pct > 100 ? '#ef5350' : fe.ausl_pct > 80 ? '#ffa726' : '#66bb6a';
        html += `<div style="font-size:9px;color:var(--muted);margin:4px 0 2px;">🔌 Zugang NAP → Ring</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="color:var(--muted);border-bottom:1px solid var(--border);">
            <th style="text-align:left;padding:2px 3px;font-size:8px;">Kante</th>
            <th style="text-align:right;padding:2px 3px;font-size:8px;">I (A)</th>
            <th style="text-align:right;padding:2px 3px;font-size:8px;">ΔU (%)</th>
            <th style="text-align:right;padding:2px 3px;font-size:8px;">Ausl.</th>
          </tr>
          <tr><td style="padding:2px 3px;font-size:9px;">${allAssets.find(a=>a.id===fe.from)?.name||'?'}→${allAssets.find(a=>a.id===fe.to)?.name||'?'}</td>
            <td style="padding:2px 3px;text-align:right;font-size:9px;">${fe.I_A.toFixed(1)}</td>
            <td style="padding:2px 3px;text-align:right;font-size:9px;">${fe.dU_pct.toFixed(2)}</td>
            <td style="padding:2px 3px;text-align:right;color:${col};font-weight:600;font-size:9px;">${fe.ausl_pct.toFixed(0)}%</td>
          </tr>
        </table>`;
      }

      if (lf.sticheMode) {
        const pfx = lf.feedEdgeResult
          ? (allAssets.find(a => a.id === lf.entryId)?.name || '?') + ' → '
          : 'NAP → ';
        html += _renderStich(lf.leftEdgeResults,  `⬅ Linker Stich (${pfx}${trennName})`, allAssets);
        html += `<div style="font-size:9px;color:#f9a825;padding:3px 5px;margin:3px 0;
          background:rgba(249,168,37,.1);border-radius:3px;border:1px dashed #f9a82560;">
          ✂ ${trennName} — offen im Normalbetrieb · I = 0 A</div>`;
        html += _renderStich(lf.rightEdgeResults, `➡ Rechter Stich (${pfx}${trennName})`, allAssets);
      } else {
        html += _renderStich(lf.edges, 'Leitungen (Ringbetrieb, Näherung)', allAssets);
      }
    }

    // (n-1)-Ergebnisse
    if (n1) {
      const hint = lf?.sticheMode
        ? '(n-1) · Trennstelle schließt bei Ausfall'
        : '(n-1) · Kabelausfall → Stichbetrieb';
      html += `<div style="font-size:8px;text-transform:uppercase;letter-spacing:.05em;
        color:var(--muted);margin-top:9px;margin-bottom:3px;">${hint}</div>`;

      n1.contingencies.forEach(c => {
        const cCol = c.ok ? '#66bb6a' : '#ef5350';
        html += `<div style="display:flex;align-items:center;gap:5px;padding:3px 0;
            border-bottom:1px solid var(--border);">
          <span style="color:${cCol};font-weight:700;font-size:10px;">${c.ok ? '✓' : '✗'}</span>
          <span style="flex:1;color:var(--text);font-size:9px;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;" title="Ausfall: ${c.failedEdgeName}">
            ↯ ${c.failedEdgeName}</span>
          <span style="color:${cCol};font-size:9px;font-weight:600;">${c.worstAusl.toFixed(0)}%</span>
          <span style="color:var(--muted);font-size:9px;">ΔU ${c.worstDU.toFixed(1)}%</span>
        </div>`;
      });

      if (n1.worstCase) {
        html += `<div style="font-size:9px;margin-top:5px;padding:4px 7px;
          background:rgba(${n1.allOk ? '102,187,106' : '239,83,80'},.08);
          border-radius:3px;color:${n1Color};line-height:1.5;">
          <b>Worst-Case:</b> ${n1.worstCase.failedEdgeName}<br>
          max. Auslastung <b>${n1.worstCase.worstAusl.toFixed(0)} %</b> ·
          max. ΔU <b>${n1.worstCase.worstDU.toFixed(1)} %</b>
        </div>`;
      }
    }

    html += `</div>`;
  });

  panel.innerHTML = html;
}

// Globaler Alias für window-Exposition via main.js
export const runMSAnalyse   = elRunMSAnalyse;
export const clearMSRings   = elClearMSRings;
export function getMSHoverOverride() { return msHoverOverride; }
