// ── 15h-stromnetz-invest.js — Investitionsplanung (Kosten + Diagramm) ───────
// Portiert aus Standalone-Elektroteil (~10097–10268).
// Reine Logik:
//   - Kostenrechnung pro Asset/Leitung (KOSTEN_CFG aus 14a)
//   - Investitionsplan-Aggregation nach Baujahr inkl. Maßnahmen-Kosten
//   - SVG-Balkendiagramm-Builder (pure Funktion → String)
//
// Vereinfachungen vs Standalone:
//   - Keine UI-Verdrahtung (Toggle-Panel, Tab-Switcher)
//   - Kein PDF-Export (separates Modul, falls gewünscht)
//   - Szenario-aware via getMergedAssets/getMergedStromLeitungen

import { ASSET_CFG } from './13a-assets-core.js';
import { KOSTEN_CFG, MASSNAHMEN_SIM_PROPS } from './14a-stromnetz-config.js';
import { getMergedAssets, getMergedStromLeitungen } from './15e-stromnetz-szenarien.js';

// ════════════════════════════════════════════════════════════════════════════
// KOSTENRECHNUNG
// ════════════════════════════════════════════════════════════════════════════
//
// Single-Source-of-Truth-Strategie:
//   - Wenn der Asset-Typ ein Pendant in CalcEngine (08-calc-engine.js) hat
//     → CalcEngine als Quelle nutzen (KWW-Technikkatalog + leistungsabhängige Kurven)
//   - Sonst → KOSTEN_CFG aus 14a (für reine Strom-Infrastruktur die in
//     CalcEngine nicht vorkommt)
// Verhindert die Doppelung mit unterschiedlichen Werten.
//
// Mapping ASSET_CFG-Typ → CalcEngine-Tech:
//   PV       → getPvInvestPerKwp(kWp) · TABELLE
//   WP       → 'LuftWP' (Default — Sub-Typ-Auswahl Geo/Fluss kommt später)
//   KWK      → 'BHKW' (auf kW_th)
//   sonstige → KOSTEN_CFG.assets[type] (basis + per*)

export function calcAssetKosten(a) {
  const ce = (typeof window !== 'undefined') ? window.CalcEngine : null;

  // ── Überlappende Tech: CalcEngine ist Quelle ──────────────────────────────
  if (ce) {
    if (a.type === 'PV' && typeof ce.getPvInvestPerKwp === 'function') {
      const kWp = parseFloat(a.props?.leistungKWp) || 10;
      return ce.getPvInvestPerKwp(kWp) * kWp;
    }
    if (a.type === 'WP' && typeof ce.investEurProKw === 'function') {
      const kW = parseFloat(a.props?.leistungKW) || 10;
      return ce.investEurProKw('LuftWP', kW) * kW;  // Default LuftWP
    }
    if (a.type === 'KWK' && typeof ce.investEurProKw === 'function') {
      // BHKW-Kostenkurve auf thermischer Leistung (kW_th); Fallback auf kW_el
      const kWth = parseFloat(a.props?.leistungKW_th)
                || parseFloat(a.props?.leistungKW_el)
                || 100;
      return ce.investEurProKw('BHKW', kWth) * kWth;
    }
  }

  // ── Strom-Infrastruktur etc.: KOSTEN_CFG ─────────────────────────────────
  const cfg = KOSTEN_CFG.assets[a.type];
  if (!cfg) return 0;
  let k = cfg.basis || 0;
  if (cfg.perKVA)    k += cfg.perKVA    * (parseFloat(a.props?.leistungKVA)   || 630);
  if (cfg.perKW)     k += cfg.perKW     * (parseFloat(a.props?.leistungKW)    || 10);
  if (cfg.perAbgang) k += cfg.perAbgang * (parseInt  (a.props?.abgaenge)      || 4);
  if (cfg.perPunkt)  k += cfg.perPunkt  * (parseInt  (a.props?.anzahlPunkte)  || 4);
  if (cfg.perKWp)    k += cfg.perKWp    * (parseFloat(a.props?.leistungKWp)   || 10);
  if (cfg.perKWh)    k += cfg.perKWh    * (parseFloat(a.props?.kapazitaetKWh) || 50);
  if (cfg.perFeld)   k += cfg.perFeld   * (parseInt  (a.props?.felder)        || 6);
  return k;
}

// Leitungs-Investkosten: €/m aus KOSTEN_CFG.kabel × Länge × Parallelfaktor
export function calcLeitungKosten(lt) {
  const laenge = lt._result?.laengeM || 0;
  const qs     = lt.qs || 50;
  const pc     = lt.parallelCount || 1;
  return (KOSTEN_CFG.kabel[qs] || 58) * laenge * pc;
}

// ════════════════════════════════════════════════════════════════════════════
// INVESTITIONSPLAN-AGGREGATION (Map year → {assets[], leitungen[], massnahmen[], kosten})
// ════════════════════════════════════════════════════════════════════════════
// Liefert Map sortiert nach Jahr. Aktuelles Jahr wird als Trennlinie genutzt
// (Bestand vor currentYear wird ausgelassen — nur Investitionen in Zukunft + heute).
// Maßnahmen werden zusätzlich pro Maßnahmen-Jahr aggregiert (auch in Vergangenheit).
export function calcInvestitionsplan(opts = {}) {
  const currentYear = opts.currentYear || new Date().getFullYear();
  const allAssets    = getMergedAssets();
  const allLeitungen = getMergedStromLeitungen();
  const plan = new Map();

  function slot(yr) {
    if (!plan.has(yr)) plan.set(yr, { assets: [], leitungen: [], massnahmen: [], kosten: 0 });
    return plan.get(yr);
  }

  // 1) Neue Assets ab currentYear
  for (const a of allAssets) {
    const bj = a.baujahr ? parseInt(a.baujahr) : null;
    if (!bj || bj < currentYear) continue;
    const k = calcAssetKosten(a);
    const s = slot(bj);
    s.assets.push({ id: a.id, name: a.name, type: a.type, kosten: k });
    s.kosten += k;
  }

  // 2) Neue Leitungen ab currentYear
  for (const lt of allLeitungen) {
    const bj = lt.baujahr ? parseInt(lt.baujahr) : null;
    if (!bj || bj < currentYear) continue;
    const k   = calcLeitungKosten(lt);
    const len = Math.round(lt._result?.laengeM || 0);
    const s   = slot(bj);
    s.leitungen.push({ id: lt.id, name: `Kabel ${lt.qs || 50} mm² · ${len} m`, kosten: k });
    s.kosten += k;
  }

  // 3) Asset-Maßnahmen (auch in Vergangenheit)
  const _detail = (m, propCfg) => {
    if (m.typ === 'Austausch') return 'Austausch';
    const pLabel = (propCfg.find(p => p.key === m.eigenschaft)?.label) || m.eigenschaft || '';
    return `${pLabel}: → ${m.wertNeu != null ? m.wertNeu : '–'}`;
  };
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      const yr = parseInt(m.jahr); if (!yr) continue;
      const s = slot(yr);
      const k = m.kosten || 0;
      s.massnahmen.push({
        objektId: a.id, name: a.name, type: a.type, kind: 'asset',
        icon: ASSET_CFG[a.type]?.icon || '·',
        detail: _detail(m, MASSNAHMEN_SIM_PROPS[a.type] || []),
        sim: m.sim, kosten: k, notiz: m.notiz || '',
      });
      s.kosten += k;
    }
  }

  // 4) Leitungs-Maßnahmen
  for (const lt of allLeitungen) {
    for (const m of (lt.massnahmen || [])) {
      const yr = parseInt(m.jahr); if (!yr) continue;
      const s = slot(yr);
      const k = m.kosten || 0;
      const na = allAssets.find(a => a.id === lt.aId)?.name || '?';
      const nb = allAssets.find(a => a.id === lt.bId)?.name || '?';
      const len = Math.round(lt._result?.laengeM || 0);
      s.massnahmen.push({
        objektId: lt.id, name: `${na} ↔ ${nb}`, type: 'Leitung', kind: 'leitung',
        icon: '〰', detail: _detail(m, MASSNAHMEN_SIM_PROPS['Leitung'] || []),
        sim: m.sim, kosten: k, notiz: m.notiz || '',
        qs: m.wertNeu, laenge: len,
      });
      s.kosten += k;
    }
  }

  return plan;
}

// ── Convenience: flache, sortierte Ausgabe statt Map ────────────────────────
export function getInvestitionsplanRows(opts = {}) {
  const plan = calcInvestitionsplan(opts);
  const years = [...plan.keys()].sort((a, b) => a - b);
  let cum = 0;
  return years.map(yr => {
    const e = plan.get(yr);
    cum += e.kosten;
    return {
      year:      yr,
      assets:    e.assets,
      leitungen: e.leitungen,
      massnahmen:e.massnahmen,
      kosten:    e.kosten,
      kumuliert: cum,
    };
  });
}

export function getInvestitionsplanSumme(opts = {}) {
  const plan = calcInvestitionsplan(opts);
  let summe = 0;
  for (const e of plan.values()) summe += e.kosten;
  return summe;
}

// ════════════════════════════════════════════════════════════════════════════
// SVG-BALKENDIAGRAMM (pure Funktion → String)
// ════════════════════════════════════════════════════════════════════════════
// rows: Output von getInvestitionsplanRows()
// opts: { width=340, height=110, currentYear, accentColor='#4fc3f7' }
export function buildInvestSvg(rows, opts = {}) {
  if (!rows || rows.length === 0) return '';
  const W = opts.width  || 340;
  const H = opts.height || 110;
  const PL = 44, PB = 22, PT = 10, PR = 8;
  const bArea  = W - PL - PR;
  const barH   = H - PT - PB;
  const bStep  = bArea / Math.max(rows.length, 1);
  const bw     = Math.max(4, Math.min(28, bStep - 4));
  const curYr  = opts.currentYear || new Date().getFullYear();
  const accent = opts.accentColor || '#4fc3f7';

  const maxK = Math.max(...rows.map(r => r.kosten), 1);

  let bars = '';
  rows.forEach((r, i) => {
    const k   = r.kosten;
    const h   = Math.round((k / maxK) * barH);
    const x   = PL + i * bStep + (bStep - bw) / 2;
    const y   = PT + barH - h;
    const cur = r.year === curYr;
    const col = k === 0 ? '#2a3050' : cur ? accent : '#26a69a';
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw}" height="${Math.max(h,1)}" fill="${col}" rx="2" opacity="${cur?1:0.75}"/>`;
    if (cur) bars += `<rect x="${x.toFixed(1)}" y="${PT}" width="${bw}" height="${barH}" fill="${accent}" rx="2" opacity="0.06"/>`;
    bars += `<text x="${(x+bw/2).toFixed(1)}" y="${H-PB+13}" text-anchor="middle" fill="${cur?accent:'#7a8099'}" font-size="8" font-weight="${cur?'600':'normal'}">${r.year}</text>`;
    if (k > 0) {
      const lbl = k >= 1000000 ? `${(k/1000000).toFixed(1)}M`
                : k >= 1000    ? `${Math.round(k/1000)}k`
                                : Math.round(k).toString();
      bars += `<text x="${(x+bw/2).toFixed(1)}" y="${y-2}" text-anchor="middle" fill="#e8eaf0" font-size="7">${lbl}</text>`;
    }
  });
  const yTop = maxK >= 1000000 ? `${(maxK/1000000).toFixed(1)}M€`
             : maxK >= 1000    ? `${Math.round(maxK/1000)}k€`
                                : `${Math.round(maxK)}€`;

  return `<svg width="${W}" height="${H}" style="display:block;margin:0 auto;overflow:visible;">
  <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H-PB}" stroke="#2a3050" stroke-width="1"/>
  <line x1="${PL}" y1="${H-PB}" x2="${W-PR}" y2="${H-PB}" stroke="#2a3050" stroke-width="1"/>
  <text x="${PL-3}" y="${PT+7}" text-anchor="end" fill="#7a8099" font-size="8">${yTop}</text>
  <text x="${PL-3}" y="${H-PB}" text-anchor="end" fill="#7a8099" font-size="8">0</text>
  ${bars}
</svg>`;
}

// ── Komplette Übersichts-HTML (pure Funktion → String) ──────────────────────
// Convenience für Tests: buildInvestSvg + Tabelle in einem.
export function buildInvestOverviewHtml(opts = {}) {
  const rows = getInvestitionsplanRows(opts);
  if (rows.length === 0) {
    return `<div style="color:#9aa;font-size:11px;text-align:center;padding:20px 10px;">
      Kein Objekt hat ein Baujahr gesetzt.</div>`;
  }
  const totalK = rows.reduce((s, r) => s + r.kosten, 0);
  const curYr  = opts.currentYear || new Date().getFullYear();
  const svg    = buildInvestSvg(rows, opts);

  const tableRows = rows.map(r => {
    const all = [
      ...r.assets.map(a => `${ASSET_CFG[a.type]?.icon || '·'} ${a.name}`),
      ...r.leitungen.map(l => l.name),
      ...r.massnahmen.map(m => `🔧 ${m.name}`),
    ];
    const preview = all.slice(0, 2).join(', ') + (all.length > 2 ? ` +${all.length-2}` : '');
    const cur = r.year === curYr;
    return `<tr style="background:${cur?'rgba(79,195,247,.07)':'transparent'};">
      <td style="padding:3px 6px;color:${cur?'#4fc3f7':'inherit'};font-weight:${cur?'600':'normal'};">${r.year}</td>
      <td style="padding:3px 6px;color:#9aa;font-size:10px;">${preview || '–'}</td>
      <td style="padding:3px 6px;text-align:right;color:#4fc3f7;">${Math.round(r.kosten).toLocaleString('de-DE')} €</td>
      <td style="padding:3px 6px;text-align:right;color:#9aa;font-size:10px;">${Math.round(r.kumuliert).toLocaleString('de-DE')} €</td>
    </tr>`;
  }).join('');

  return `<div style="margin-bottom:6px;">${svg}</div>
<table style="width:100%;border-collapse:collapse;font-size:11px;">
  <thead><tr style="border-bottom:1px solid #2a3050;color:#9aa;font-size:9px;text-transform:uppercase;">
    <th style="padding:3px 6px;text-align:left;">Jahr</th>
    <th style="padding:3px 6px;text-align:left;">Neue Objekte</th>
    <th style="padding:3px 6px;text-align:right;">Invest.</th>
    <th style="padding:3px 6px;text-align:right;">Kumuliert</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
  <tfoot><tr style="border-top:1px solid #2a3050;">
    <td colspan="2" style="padding:5px 6px;color:#9aa;font-size:10px;">Gesamtinvestition</td>
    <td colspan="2" style="padding:5px 6px;text-align:right;font-weight:600;color:#4fc3f7;font-size:13px;">${Math.round(totalK).toLocaleString('de-DE')} €</td>
  </tr></tfoot>
</table>`;
}
