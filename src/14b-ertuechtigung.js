// ── 14b-ertuechtigung.js — Infrastruktur-Ertüchtigung für PV-Ausbau ──────────
// M3: Headroom → Alternativen; Δinfra für Merit-Order-Callback
//
// Zwei Schichten:
//   PURE (export, testbar, kein DOM):
//     ERT_TRAFO_STUFEN, ertTrafoKapKw, ertDeltaInfraJk, ertGeneriereAlternativen
//   APP-SIDE (liest ASSETS):
//     ertFindTrafoFuerNap, ertNapKapazitaetKw, ertNapKapazitaetMap,
//     ertMakeDeltaInfraFn, ertRunMitInfra

import { ASSETS } from './13a-assets-core.js';
import { pvMeritOrderCore, pvMeritAnnF, pvEnumerateKandidaten, pvRunMeritOrder } from './14a-kandidaten.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { PV_INFRA_STUFEN } from './09d-pv-analyse.js';

// ── Trafo-Kostenstufen ────────────────────────────────────────────────────────
// Standardtrafo NS/MS inkl. Montage; gerundete DE-Richtwerte 2024.
// bisKvA = Nennleistung des neuen Trafos;  investEUR = Gesamtkosten ca.
// lebensdauerJ = Nutzungsdauer für Annuität; iHProzent = jährl. Instandhaltung
export const ERT_TRAFO_STUFEN = [
  { bisKvA:  100, investEUR:  12000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA:  250, investEUR:  18000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA:  400, investEUR:  25000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA:  630, investEUR:  38000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA: 1000, investEUR:  58000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA: 1600, investEUR:  85000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA: 2500, investEUR: 125000, lebensdauerJ: 30, iHProzent: 0.5 },
  { bisKvA: Infinity, investEUR: 200000, lebensdauerJ: 30, iHProzent: 0.5 }, // Übergabestation
];

// Leistungsfaktor für kVA → kW Umrechnung (konservativ NS = 0.9)
const PF_NS = 0.9;

// ── Pure Helpers ──────────────────────────────────────────────────────────────

/**
 * Kapazität eines Trafo-Assets in kW (aus leistungKVA-Prop).
 * Gibt 0 zurück wenn keine Angabe vorhanden.
 */
export function ertTrafoKapKw(asset, pfFaktor) {
  const kva = parseFloat(asset?.props?.leistungKVA) || 0;
  return kva * (pfFaktor != null ? pfFaktor : PF_NS);
}

/**
 * Kleinstmögliche Trafo-Stufe, die mindestens minKapKw liefert.
 * Gibt null zurück wenn keine Stufe ausreichend ist (sollte nicht vorkommen).
 */
export function ertNaechsteTrafoStufe(minKapKw, trafoStufen) {
  const st = trafoStufen || ERT_TRAFO_STUFEN;
  return st.find(s => s.bisKvA * PF_NS >= minKapKw) || st[st.length - 1];
}

/**
 * Jährliche Kapitalkosten eines Trafo-Upgrades.
 * aktuellKapKw: aktuelle Kapazität (0 = kein Trafo vorhanden)
 * benoetigtKw: benötigte Kapazität nach Ausbau
 * zins: Kalkulationszinssatz (Dezimalbruch)
 * trafoStufen: optional (Fixture für Tests)
 */
export function ertTrafoUpgradeJk(aktuellKapKw, benoetigtKw, zins, trafoStufen) {
  if (benoetigtKw <= aktuellKapKw) return 0;
  const st   = trafoStufen || ERT_TRAFO_STUFEN;
  const neu  = ertNaechsteTrafoStufe(benoetigtKw, st);
  if (!neu) return 0;
  const iHF  = (neu.iHProzent || 0.5) / 100;
  return neu.investEUR * (pvMeritAnnF(zins, neu.lebensdauerJ) + iHF);
}

/**
 * Jährliche Marginalkosten der Infrastruktur-Ertüchtigung.
 * Wird von pvMeritOrderCore als deltaInfraFn-Callback aufgerufen.
 *
 * Logik:
 *   - spitzeKwAlt ≤ napKapKw  UND  spitzeKwNeu ≤ napKapKw → kein Bottleneck → 0
 *   - spitzeKwAlt ≤ napKapKw  UND  spitzeKwNeu >  napKapKw → Bottleneck neu ausgelöst
 *       → günstigste Upgrade-Annuität (Trafo auf nächste Stufe)
 *   - spitzeKwAlt >  napKapKw                              → schon vorher Bottleneck
 *       → zusätzliche Kosten nur wenn eine höhere Stufe benötigt wird
 *
 * napKapKw: Ist-Kapazität des NAP (aus Trafo-Nennleistung × PF)
 * zins: Kalkulationszinssatz
 * trafoStufen: optional für Tests
 */
export function ertDeltaInfraJk(spitzeKwNeu, napKapKw, spitzeKwAlt, zins, trafoStufen) {
  if (!napKapKw || napKapKw <= 0) return 0; // unbekannte Kapazität → kein Constraint
  if (spitzeKwNeu <= napKapKw) return 0;     // passt noch rein

  // Welche Upgrade-Stufe war bisher nötig (für spitzeKwAlt)?
  const jkAlt = spitzeKwAlt > napKapKw
    ? ertTrafoUpgradeJk(napKapKw, spitzeKwAlt, zins, trafoStufen)
    : 0;

  // Welche Upgrade-Stufe wird jetzt nötig (für spitzeKwNeu)?
  const jkNeu = ertTrafoUpgradeJk(napKapKw, spitzeKwNeu, zins, trafoStufen);

  // Nur der Marginalanteil (kann 0 sein wenn schon dieselbe Stufe nötig war)
  return Math.max(0, jkNeu - jkAlt);
}

/**
 * Erzeugt eine Liste von Upgrade-Alternativen für einen NAP-Engpass.
 * Jede Alternative ist ein Maßnahmen-Objekt (passt zu asset.massnahmen[]).
 *
 * spitzeKw: aufgetretene Rückspeise-Spitze in kW
 * napKapKw: aktuelle NAP-Kapazität in kW
 * params: { zins, trafoStufen?, skKva?, uBudgetPct? }
 *
 * Rückgabe: Alternative[] mit { id, label, investEUR, jkEUR, deltaKapKw, typ, newProps }
 */
export function ertGeneriereAlternativen(spitzeKw, napKapKw, params) {
  const { zins = 0.035, trafoStufen, skKva = 0, uBudgetPct = 3 } = params || {};
  const st = trafoStufen || ERT_TRAFO_STUFEN;
  const alternativen = [];
  const ueberlastKw  = spitzeKw - napKapKw;

  // 1. Spannungscheck (nur wenn S_k″ bekannt)
  let spannungOk = true;
  let deltaU_pct = 0;
  if (skKva > 0) {
    // Δu ≈ 100 · P_rück / S_k″; zulässig: uBudgetPct %
    deltaU_pct = 100 * spitzeKw / skKva;
    spannungOk = deltaU_pct <= uBudgetPct;
  }

  // 2. Trafo-Upgrade-Alternativen (Stufenfolge ab der aktuell nötigen Kapazität)
  const relevanteStuden = st.filter(s => s.bisKvA * PF_NS >= spitzeKw);
  for (const s of relevanteStuden.slice(0, 3)) { // max. 3 Optionen
    const newKapKw = s.bisKvA * PF_NS;
    const jk       = ertTrafoUpgradeJk(napKapKw, newKapKw, zins, st);
    const stufenLabel = s.bisKvA < Infinity ? `${s.bisKvA} kVA` : 'Übergabestation';
    alternativen.push({
      id:          `trafo_${s.bisKvA}`,
      label:       `Trafo neu/verstärkt — ${stufenLabel}`,
      investEUR:   s.investEUR,
      jkEUR:       jk,
      deltaKapKw:  newKapKw - napKapKw,
      typ:         'Ertuechtigung',
      newProps:    { leistungKVA: s.bisKvA },
      spannungOk,
      deltaU_pct:  deltaU_pct.toFixed(1),
    });
  }

  // 3. Abregelung (immer als günstigste Option, 0 €)
  alternativen.push({
    id:          'abregelung',
    label:       `Abregelung auf ${napKapKw.toFixed(0)} kW (${ueberlastKw.toFixed(0)} kW kappen)`,
    investEUR:   0,
    jkEUR:       0,
    deltaKapKw:  0,
    typ:         'abregelung',
    newProps:    { napMaxEinsKw: napKapKw },
    spannungOk:  true,
    deltaU_pct:  uBudgetPct.toFixed(1),
  });

  // Nach jkEUR aufsteigend sortieren (günstigste Variante zuerst)
  alternativen.sort((a, b) => a.jkEUR - b.jkEUR);
  return alternativen;
}

// ── App-Side Helpers ──────────────────────────────────────────────────────────

/**
 * Sucht den ersten Trafo im Netz, der einem NAP-Asset (napId) vorgelagert ist.
 * Traversiert ASSETS.edges rückwärts (Richtung Netzeinspeisung).
 * Gibt das Trafo-Asset zurück oder null.
 */
export function ertFindTrafoFuerNap(napId) {
  const items = ASSETS?.items || [];
  const edges = ASSETS?.edges || [];
  const visited = new Set([napId]);
  const queue   = [napId];
  while (queue.length) {
    const id   = queue.shift();
    const asset = items.find(a => a.id === id);
    if (id !== napId && asset?.type === 'Trafo') return asset;
    for (const e of edges) {
      if (e.u === id && !visited.has(e.v)) { visited.add(e.v); queue.push(e.v); }
      if (e.v === id && !visited.has(e.u)) { visited.add(e.u); queue.push(e.u); }
    }
  }
  return null;
}

/**
 * Kapazität eines NAP in kW (aus dem vorgelagerten Trafo-Asset oder NAP-Props).
 * Gibt 0 zurück wenn unbekannt.
 */
export function ertNapKapazitaetKw(napId, pfFaktor) {
  // Zuerst: NAP-Asset selbst nach leistungKVA-Prop befragen (selten gesetzt)
  const items = ASSETS?.items || [];
  const napAsset = items.find(a => a.id === napId);
  const direktKva = parseFloat(napAsset?.props?.leistungKVA) || 0;
  if (direktKva > 0) return direktKva * (pfFaktor != null ? pfFaktor : PF_NS);

  // Dann: vorgelagerten Trafo suchen
  const trafo = ertFindTrafoFuerNap(napId);
  return trafo ? ertTrafoKapKw(trafo, pfFaktor) : 0;
}

/**
 * Gibt eine Map<napId, kapKw> für alle NAPs im ASSETS-Netz zurück.
 * NAPs ohne Kapazitätsangabe werden ausgelassen (Map hat keinen Eintrag → kein Limit).
 */
export function ertNapKapazitaetMap(pfFaktor) {
  const items = ASSETS?.items || [];
  const map   = new Map();
  for (const a of items) {
    if (a.type !== 'NAP') continue;
    const kapKw = ertNapKapazitaetKw(a.id, pfFaktor);
    if (kapKw > 0) map.set(a.id, kapKw);
  }
  return map;
}

/**
 * Erzeugt eine deltaInfraFn, die in pvMeritOrderCore als params.deltaInfraFn
 * übergeben werden kann.
 *
 * napKapazitaeten: Map<napId, kw> — typischerweise von ertNapKapazitaetMap()
 * zins: Kalkulationszinssatz
 * trafoStufen: optional (für Tests)
 */
export function ertMakeDeltaInfraFn(napKapazitaeten, zins, trafoStufen) {
  return function(napId, spitzeKwNeu, spitzeKwAlt) {
    const napKapKw = napKapazitaeten?.get(napId) || 0;
    return ertDeltaInfraJk(spitzeKwNeu, napKapKw, spitzeKwAlt, zins, trafoStufen);
  };
}

/**
 * Wrapper: Merit-Order mit automatischer Infra-Einbeziehung.
 * Liest NAP-Kapazitäten aus ASSETS und wired deltaInfraFn automatisch.
 * opts wird an pvRunMeritOrder weitergegeben (kann alle pvRunMeritOrder-Felder enthalten).
 */
export function ertRunMitInfra(opts) {
  const dom   = id => parseFloat(document?.getElementById?.(id)?.value) || 0;
  const zins  = opts?.zins != null ? opts.zins : (dom('opt-zins') / 100 || 0.035);
  const napKapazitaeten = ertNapKapazitaetMap();

  const pvProfileSued    = makePvProfile8760('sued');
  const pvProfileOstWest = makePvProfile8760('ostwest');

  const kandidaten = opts?.kandidaten ?? pvEnumerateKandidaten();
  const demandH    = opts?.demandH    ?? window.elQuartierH ?? window.elQuartierH15;
  if (!demandH?.length) {
    console.warn('ertRunMitInfra: kein Lastgang verfügbar');
    return null;
  }

  const pStrom         = opts?.pStrom         != null ? opts.pStrom         : (dom('strom-preis')  || 30);
  const pEinsp         = opts?.pEinsp         != null ? opts.pEinsp         : (dom('pv-verg')       || 8);
  const pvInvestPerKwp = opts?.pvInvestPerKwp != null ? opts.pvInvestPerKwp : (dom('opt-pv-invest') || 1200);
  const batKwh         = opts?.batKwh         != null ? opts.batKwh         : 0;

  return pvMeritOrderCore(
    kandidaten, demandH, pvProfileSued, pvProfileOstWest,
    {
      pStrom, pEinsp, pvInvestPerKwp, batKwh, zins,
      napMaxEinsKw:  0,
      pvInfraStufen: PV_INFRA_STUFEN,
      deltaInfraFn:  ertMakeDeltaInfraFn(napKapazitaeten, zins),
    }
  );
}
