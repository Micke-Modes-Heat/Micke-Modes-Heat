// ── 15c-stromnetz-calc.js — Strom-Netz-Berechnung (Recalc) ──────────────────
// Portiert aus Standalone-Elektroteil (elCalc, ~6532–6990).
// Vereinfachungen vs Standalone:
//   - Keine Szenario-Merge (kommt mit Phase 3.3): nutzt direkt ASSETS.items + Strom-Leitungen
//   - Kein MS-Hover-Override (kommt mit Phase 3.6): MS-Kabel werden neutral gezeichnet
//   - Kein elShowResults / elApplyVoltageProfile / elSldRefresh (UI-Hooks kommen separat)
// Ergebnis landet in STROMNETZ.calcResult und Polyline-Styling wird live aktualisiert.

import { globalYear } from './01-globals-varianten.js';
import { getAssetStatus, TYPE_RANK } from './13a-assets-core.js';
import { STROMNETZ,
         getEffectiveAssetProps, getEffectiveLeitungQs } from './14b-stromnetz-state.js';
import { KABEL_NS_R_OHM_KM, KABEL_NS_I_MAX_A,
         KABEL_MS_I_MAX_A, SICHERUNG_A, KOSTEN_CFG } from './14a-stromnetz-config.js';
import { getMergedAssets, getMergedStromLeitungen } from './15e-stromnetz-szenarien.js';

const U_N      = 400;   // Nennspannung NS [V]
const COS_PHI  = 0.9;
const MS_TYPES = new Set(['NAP', 'Schaltanlage', 'Trafo']);

// ── Lastfunktionen je Asset-Typ ─────────────────────────────────────────────
function assetVerbrauch(a, yr) {
  const p = getEffectiveAssetProps(a, yr).props;
  switch (a.type) {
    case 'Verbraucher': return parseFloat(p.leistungKW) || 0;
    case 'Lade':        return (parseInt(p.anzahlPunkte) || 4) * (parseFloat(p.leistungProPunktKW) || 22);
    case 'WP':          return parseFloat(p.leistungKW) || 0;
    case 'Nsa':         return 0;  // läuft nicht parallel zum Netz
    case 'Batterie':    return (p.betriebsmodus || 'einspeisung') === 'verbraucher'
                              ? parseFloat(p.leistungKW) || 0 : 0;
    default:            return 0;
  }
}

function assetErzeugung(a, yr) {
  const p = getEffectiveAssetProps(a, yr).props;
  switch (a.type) {
    case 'PV':       return (parseFloat(p.leistungKWp) || 0) * 0.8;
    case 'Batterie': return (p.betriebsmodus || 'einspeisung') === 'einspeisung'
                            ? parseFloat(p.leistungKW) || 0 : 0;
    default:         return 0;
  }
}

// Platzhalter — Batterie ist bereits in Verbrauch/Erzeugung enthalten.
// Nur für Tooltip-Kompatibilität.
function assetBatterie() { return 0; }

// ── BFS-Helper: downstream-Last einer Leitung ───────────────────────────────
// Traversiert NUR zu Knoten mit Rang ≥ aktuellem Rang — verhindert Rückweg
// durch parallele Einspeisungen (z. B. zwei Trafos an einer NSHV).
function bfsDownstream(lt, loadFn, assetMap, adjList, yr) {
  const a = assetMap.get(lt.aId), b = assetMap.get(lt.bId);
  if (!a || !b) return 0;
  const rankA = TYPE_RANK[a.type] ?? 6;
  const rankB = TYPE_RANK[b.type] ?? 6;
  const sourceId = rankA <= rankB ? lt.aId : lt.bId;
  const sinkId   = rankA <= rankB ? lt.bId : lt.aId;
  const visited = new Set([sourceId]);
  const queue   = [sinkId];
  let load = 0;
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const asset = assetMap.get(cur);
    if (asset) load += loadFn(asset, yr);
    const curRank = TYPE_RANK[asset?.type] ?? 6;
    for (const { neighborId } of (adjList.get(cur) || [])) {
      if (visited.has(neighborId)) continue;
      const nbRank = TYPE_RANK[assetMap.get(neighborId)?.type] ?? 6;
      if (nbRank >= curRank) queue.push(neighborId);
    }
  }
  return load;
}

// ── Hauptberechnung ─────────────────────────────────────────────────────────
export function recalcStromnetz() {
  const yr = globalYear || new Date().getFullYear();
  const warn = [];
  // Merged: Bestand + aktives Szenario-Delta
  const allAssets    = getMergedAssets();
  const allLeitungen = getMergedStromLeitungen();
  const activeA = allAssets   .filter(a => getAssetStatus(a, yr) === 'active');
  const activeL = allLeitungen.filter(l => getAssetStatus(l, yr) === 'active');

  // Topologieprüfung
  if (!activeA.find(a => a.type === 'NAP'))   warn.push('⚠ Kein NAP vorhanden.');
  if (!activeA.find(a => a.type === 'Trafo')) warn.push('⚠ Kein Trafo vorhanden – Berechnung mit 400 V NS.');
  if (activeA.length === 0)                   warn.push('⚠ Keine aktiven Elektroobjekte.');
  if (activeL.length === 0 && activeA.length > 0) warn.push('ℹ Keine aktiven Leitungen.');

  const bottlenecks = [];
  const edgeResults = {};

  // ── Adjazenzliste für BFS ─────────────────────────────────────────────────
  const assetMap = new Map(activeA.map(a => [a.id, a]));
  const adjList  = new Map(activeA.map(a => [a.id, []]));
  for (const lt of activeL) {
    if (assetMap.has(lt.aId) && assetMap.has(lt.bId)) {
      adjList.get(lt.aId).push({ ltId: lt.id, neighborId: lt.bId });
      adjList.get(lt.bId).push({ ltId: lt.id, neighborId: lt.aId });
    }
  }

  // ── 1. Pro Leitung: lokaler Spannungsfall, Strom, Kosten ─────────────────
  for (const lt of activeL) {
    const aA = assetMap.get(lt.aId), bA = assetMap.get(lt.bId);
    const rankA = TYPE_RANK[aA?.type] ?? 6;
    const rankB = TYPE_RANK[bA?.type] ?? 6;

    const isMS = MS_TYPES.has(aA?.type) && MS_TYPES.has(bA?.type)
              && !(aA?.type === 'Trafo' && bA?.type === 'Trafo');

    const laenge = lt._result?.laengeM || 0;
    const { qs, pc } = getEffectiveLeitungQs(lt, yr);
    const kosten = (KOSTEN_CFG.kabel[qs] || 58) * laenge * pc;
    const srcAsset = rankA <= rankB ? aA : bA;
    const snkAsset = rankA <= rankB ? bA : aA;

    if (isMS) {
      // MS-Kabel: kein NS-Berechnung, nur Metadaten
      const napAss = [aA, bA].find(a => a?.type === 'NAP');
      const U_ref  = (parseFloat(napAss?.props?.spannungKV
                    || activeA.find(x => x.type === 'NAP')?.props?.spannungKV) || 20) * 1000;
      const I_max  = (KABEL_MS_I_MAX_A[qs] || 260) * pc;
      edgeResults[lt.id] = {
        laenge, qs, pc,
        P_kW: 0, P_load: 0, P_gen: 0, P_bat: 0, P_worst: 0,
        I_A: 0, dU_V: 0, dU_pct: 0, ausl_pct: 0, I_max, kosten,
        isMS: true, U_ref, isReverse: false,
        srcName: srcAsset?.name || '–', snkName: snkAsset?.name || '–',
      };
      continue;
    }

    // NS-Leitung
    const U_ref      = U_N;
    const P_v        = bfsDownstream(lt, assetVerbrauch, assetMap, adjList, yr);
    const P_e        = bfsDownstream(lt, assetErzeugung, assetMap, adjList, yr);
    const P_bat      = bfsDownstream(lt, assetBatterie,  assetMap, adjList, yr);
    const P_net      = P_v - P_e;
    const P_worst    = Math.max(P_v, P_e);
    const I_A        = P_worst * 1000 / (Math.sqrt(3) * U_ref * COS_PHI);
    const I_A_sign   = P_net   * 1000 / (Math.sqrt(3) * U_ref * COS_PHI);
    const R_seg      = (KABEL_NS_R_OHM_KM[qs] || 0.387) * laenge / 1000 / pc;
    const dU_V       = Math.sqrt(3) * R_seg * I_A_sign;
    const dU_pct     = (dU_V / U_ref) * 100;
    const I_max      = (KABEL_NS_I_MAX_A[qs] || 140) * pc;
    const ausl_pct   = I_max > 0 ? (I_A / I_max) * 100 : 0;
    const isReverse  = P_net < -0.5;

    edgeResults[lt.id] = {
      laenge, qs, pc,
      P_kW: P_net, P_load: P_v, P_gen: P_e, P_bat, P_worst,
      I_A, dU_V, dU_pct, ausl_pct, I_max, kosten,
      isMS: false, U_ref, isReverse,
      srcName: srcAsset?.name || '–', snkName: snkAsset?.name || '–',
    };
  }

  // ── 2. Kumulativer Spannungsfall: gerichteter BFS von Trafos aus ─────────
  const dirAdj = new Map(activeA.map(a => [a.id, []]));
  for (const lt of activeL) {
    const er = edgeResults[lt.id]; if (!er || er.isMS) continue;
    const a = assetMap.get(lt.aId), b = assetMap.get(lt.bId);
    if (!a || !b) continue;
    const rankA = TYPE_RANK[a.type] ?? 6, rankB = TYPE_RANK[b.type] ?? 6;
    const srcId = rankA <= rankB ? lt.aId : lt.bId;
    const snkId = rankA <= rankB ? lt.bId : lt.aId;
    dirAdj.get(srcId)?.push({ ltId: lt.id, nextId: snkId, dU_V: er.dU_V });
    er.snkId = snkId;
  }

  const nodeVoltDrop = new Map();
  const trafos = activeA.filter(a => a.type === 'Trafo');
  const srcNodes = trafos.length > 0 ? trafos : (() => {
    if (activeA.length === 0) return [];
    const minRank = Math.min(...activeA.map(a => TYPE_RANK[a.type] ?? 6));
    return activeA.filter(a => (TYPE_RANK[a.type] ?? 6) === minRank);
  })();
  srcNodes.forEach(s => nodeVoltDrop.set(s.id, 0));
  const bfsQ = srcNodes.map(s => s.id);
  const bfsVis = new Set(bfsQ);
  while (bfsQ.length) {
    const curId = bfsQ.shift();
    const cumV  = nodeVoltDrop.get(curId) ?? 0;
    for (const { ltId, nextId, dU_V } of (dirAdj.get(curId) || [])) {
      if (bfsVis.has(nextId)) continue;
      bfsVis.add(nextId);
      const cumNext = cumV + dU_V;
      nodeVoltDrop.set(nextId, cumNext);
      edgeResults[ltId].dU_cum_pct = (cumNext / U_N) * 100;
      bfsQ.push(nextId);
    }
  }

  // ── 3. Polyline-Styling + Tooltip aktualisieren ───────────────────────────
  for (const lt of activeL) {
    const er = edgeResults[lt.id]; if (!er) continue;

    if (er.isMS) {
      // Neutral grau (ohne MS-Analyse)
      lt._poly?.setStyle({ color: '#78909c', dashArray: '6 4' });
      const uKV = ((er.U_ref || 20000) / 1000).toFixed(0);
      lt._poly?.setTooltipContent(buildMsTooltip(er, uKV));
      continue;
    }

    // NS-Leitung
    const dU_c    = er.dU_cum_pct ?? er.dU_pct;
    const dU_cAbs = Math.abs(dU_c);
    const overload = er.ausl_pct > 100;
    let farbe = '#4caf50';
    if (overload) {
      farbe = '#b71c1c';
      bottlenecks.push(lt.id);
      warn.push(`⚠ Leitung …${lt.id.slice(-5)}: Überlastet ${er.ausl_pct.toFixed(0)} % (${er.I_A.toFixed(0)} A > ${er.I_max} A)`);
    } else if (dU_cAbs > 5) {
      farbe = '#e53935';
      bottlenecks.push(lt.id);
      warn.push(dU_c < 0
        ? `⚠ Leitung …${lt.id.slice(-5)}: Überspannung kum. ΔU ${dU_c.toFixed(1)} % (Rückspeisung)`
        : `⚠ Leitung …${lt.id.slice(-5)}: kum. ΔU ${dU_c.toFixed(1)} % > 5 % (VDE-Grenze)`);
    } else if (dU_cAbs > 3) {
      farbe = '#f9a825';
      if (dU_c < 0) warn.push(`⚠ Leitung …${lt.id.slice(-5)}: Spannungserhöhung ${dU_c.toFixed(1)} % (Einspeisung > Last)`);
    } else if (er.ausl_pct > 80) {
      farbe = '#f9a825';
    }
    lt._poly?.setStyle({ color: farbe, dashArray: er.isReverse ? '8 5' : null });
    lt._poly?.setTooltipContent(buildNsTooltip(er, dU_c, dU_cAbs));
  }

  // ── 4. Max. kumulativer ΔU an Verbrauchern ────────────────────────────────
  const consTypes = new Set(['Verbraucher', 'WP', 'Lade']);
  let maxCumPct = 0, maxCumAssetName = '';
  for (const a of activeA) {
    if (!consTypes.has(a.type)) continue;
    const v = nodeVoltDrop.get(a.id);
    if (v == null) continue;
    const p = (v / U_N) * 100;
    if (p > maxCumPct) { maxCumPct = p; maxCumAssetName = a.name; }
  }

  // ── 5. Schutzkonzept: Kurzschluss + Sicherung ────────────────────────────
  const trafo = activeA.find(a => a.type === 'Trafo');
  const trafoEP = trafo ? getEffectiveAssetProps(trafo, yr).props : {};
  const S_N_kVA = trafo ? (parseFloat(trafoEP.leistungKVA) || 630) : 630;
  const uk_pct  = trafo ? (parseFloat(trafoEP.ukProzent)   || 4)   : 4;
  const Z_trafo = (uk_pct / 100) * (U_N * U_N) / (S_N_kVA * 1000);

  for (const lt of activeL) {
    const er = edgeResults[lt.id]; if (!er || er.isMS) continue;
    const R_kabel = (KABEL_NS_R_OHM_KM[er.qs] || 0.387) * er.laenge / 1000 / (lt.parallelCount || 1);
    const Z_ges   = Z_trafo + R_kabel;
    const I_k     = (U_N / Math.sqrt(3)) / Z_ges;
    er.I_k = I_k;
    er.I_siche = lt.sicherungA || null;

    if (er.I_siche) {
      if (I_k < 5 * er.I_siche)
        warn.push(`⚠ Leitung …${lt.id.slice(-5)}: Ik = ${I_k.toFixed(0)} A < 5 × ${er.I_siche} A – Abschaltung nicht sicher!`);
      if (er.I_siche > er.I_max)
        warn.push(`⚠ Leitung …${lt.id.slice(-5)}: Sicherung ${er.I_siche} A > Kabelbelastbarkeit ${er.I_max} A!`);
    }
  }

  // ── 6. Auto-Sicherung für Leitungen ohne eingetragene Sicherung ──────────
  for (const lt of activeL) {
    if (lt.sicherungA) continue;
    const er = edgeResults[lt.id]; if (!er) continue;
    const autoFuse = SICHERUNG_A.find(s =>
      s >= er.I_A && s <= er.I_max && (er.I_k == null || er.I_k >= 5 * s)
    ) || null;
    if (autoFuse) { lt.sicherungA = autoFuse; er.I_siche = autoFuse; }
  }

  // ── 7. Trafo-Auslastung (Worst-Case Bezug vs. Einspeisung) ───────────────
  const trafoResults = [];
  for (const a of activeA) {
    if (a.type !== 'Trafo') continue;
    const kVA = parseFloat(getEffectiveAssetProps(a, yr).props.leistungKVA) || 630;
    const P_max_kW = kVA * COS_PHI;

    const visited = new Set([a.id]);
    const q = [];
    const trafoRank = TYPE_RANK[a.type] ?? 6;
    for (const { neighborId } of (adjList.get(a.id) || [])) {
      const nbRank = TYPE_RANK[assetMap.get(neighborId)?.type] ?? 6;
      if (nbRank > trafoRank) q.push(neighborId);
    }
    let P_v = 0, P_e = 0;
    while (q.length) {
      const cur = q.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const nb = assetMap.get(cur);
      if (nb) { P_v += assetVerbrauch(nb, yr); P_e += assetErzeugung(nb, yr); }
      const curRank = TYPE_RANK[nb?.type] ?? 6;
      for (const { neighborId } of (adjList.get(cur) || [])) {
        if (visited.has(neighborId)) continue;
        const nbRank = TYPE_RANK[assetMap.get(neighborId)?.type] ?? 6;
        if (nbRank > curRank) q.push(neighborId);
      }
    }
    const P_net   = P_v - P_e;
    const P_worst = Math.max(P_v, P_e);
    const ausl    = P_max_kW > 0 ? (P_worst / P_max_kW) * 100 : 0;
    trafoResults.push({
      id: a.id, name: a.name, kVA,
      P_kW: P_net, P_load: P_v, P_gen: P_e, P_worst, ausl,
      isReverse: P_net < -0.5,
    });

    if (ausl > 100)
      warn.push(`⚠ ${a.name}: Überlastet ${ausl.toFixed(0)} % (${P_worst.toFixed(0)} kW > ${P_max_kW.toFixed(0)} kW, Worst-Case)`);
    else if (ausl > 85)
      warn.push(`⚠ ${a.name}: Hohe Auslastung ${ausl.toFixed(0)} % (>85 % – Reservekapazität prüfen)`);
  }

  // ── 8. Gesamt-Summary ─────────────────────────────────────────────────────
  const P_total_v = activeA.reduce((s, a) => s + assetVerbrauch(a, yr), 0);
  const P_total_e = activeA.reduce((s, a) => s + assetErzeugung(a, yr), 0);
  const P_net     = P_total_v - P_total_e;
  const totalKosten = Object.values(edgeResults).reduce((s, e) => s + (e.kosten || 0), 0);
  const totalLaenge = Object.values(edgeResults).reduce((s, e) => s + (e.laenge || 0), 0);

  STROMNETZ.calcResult = {
    summary: {
      P_total_kW:   P_net.toFixed(1),
      P_load_kW:    P_total_v.toFixed(1),
      P_gen_kW:     P_total_e.toFixed(1),
      laengeM:      totalLaenge.toFixed(0),
      kosten:       Math.round(totalKosten).toLocaleString('de-DE'),
      assets:       activeA.length,
      leitungen:    activeL.length,
      bottlenecks:  bottlenecks.length,
      maxCumDU_pct: maxCumPct.toFixed(2),
      maxCumAssetName,
    },
    warnings: warn,
    bottlenecks,
    edges: edgeResults,
    nodeVoltDrop: Object.fromEntries(nodeVoltDrop),
    trafoResults,
  };

  return STROMNETZ.calcResult;
}

export function getStromCalcResult() {
  return STROMNETZ.calcResult;
}

// ── Tooltip-Builder (extrahiert für Lesbarkeit) ─────────────────────────────
function buildMsTooltip(er, uKV) {
  return `<div style="font-family:sans-serif;font-size:12px;min-width:190px">` +
    `<div style="background:#37474f;color:#fff;padding:5px 8px;border-radius:4px 4px 0 0;font-weight:600;font-size:13px">` +
    `⚡ MS-Kabel ${uKV} kV</div>` +
    `<div style="padding:5px 8px;border-bottom:1px solid #e0e0e0;color:#546e7a;font-size:11px">` +
    `${er.srcName} &nbsp;→&nbsp; ${er.snkName}</div>` +
    `<div style="padding:5px 8px;display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:11px">` +
    `<span style="color:#90a4ae">Querschnitt</span><span>${er.qs} mm² × ${er.pc}</span>` +
    `<span style="color:#90a4ae">Länge</span><span>${Math.round(er.laenge)} m</span>` +
    `<span style="color:#90a4ae">Kosten</span><span>${Math.round(er.kosten).toLocaleString('de-DE')} €</span>` +
    `</div>` +
    `<div style="padding:5px 8px;color:#f9a825;font-size:10px;">` +
    `ℹ MS-Ströme: bitte „MS-Topologie analysieren" starten</div></div>`;
}

function buildNsTooltip(er, dU_c, dU_cAbs) {
  const duLabel = dU_c < -0.1
    ? `<span style="color:#ef5350">↑ Überspannung ${Math.abs(dU_c).toFixed(2)} %</span>`
    : `<span style="${dU_cAbs>5?'color:#ef5350':dU_cAbs>3?'color:#f9a825':'color:#66bb6a'}">ΔU ${dU_c.toFixed(2)} %</span>`;
  const auslColor = er.ausl_pct>100 ? '#ef5350' : er.ausl_pct>80 ? '#f9a825' : '#66bb6a';
  return `<div style="font-family:sans-serif;font-size:12px;min-width:210px">` +
    `<div style="background:#1565c0;color:#fff;padding:5px 8px;border-radius:4px 4px 0 0;font-weight:600;font-size:13px">` +
    `🔌 NS-Leitung</div>` +
    `<div style="padding:5px 8px;border-bottom:1px solid #e0e0e0;color:#546e7a;font-size:11px">` +
    `${er.srcName} &nbsp;→&nbsp; ${er.snkName}</div>` +
    `<div style="padding:5px 8px;border-bottom:1px solid #e0e0e0;display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:11px">` +
    `<span style="color:#90a4ae">Querschnitt</span><span>${er.qs} mm² × ${er.pc}</span>` +
    `<span style="color:#90a4ae">Länge</span><span>${Math.round(er.laenge)} m</span>` +
    `</div>` +
    `<div style="padding:5px 8px;border-bottom:1px solid #e0e0e0;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px">` +
    `<span style="color:#42a5f5">⬆ Bezug</span><span>${er.P_load.toFixed(1)} kW</span>` +
    `<span style="color:#ef5350">⬇ Einsp.</span><span>${er.P_gen.toFixed(1)} kW</span>` +
    `<span style="color:#90a4ae">↔ Netto</span><span>${er.P_kW.toFixed(1)} kW${er.isReverse?' <span style="color:#ef5350">⟵ Rücksp.</span>':''}</span>` +
    `</div>` +
    `<div style="padding:5px 8px;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px">` +
    `<span style="color:#90a4ae">Strom (WC)</span><span>${er.I_A.toFixed(1)} A / ${er.I_max} A</span>` +
    `<span style="color:#90a4ae">Auslastung</span><span style="font-weight:600;color:${auslColor}">${er.ausl_pct.toFixed(0)} %</span>` +
    `<span style="color:#90a4ae">Spannungsfall</span><span>${duLabel} (kum.)</span>` +
    `<span style="color:#90a4ae">Kosten</span><span>${Math.round(er.kosten).toLocaleString('de-DE')} €</span>` +
    `</div></div>`;
}
