// ── 14a-kandidaten.js — PV-Flächen-Enumeration + Merit-Order ────────────────
// M2: pvEnumerateKandidaten (4 Quellen) + pvMeritOrderCore (Greedy-Marginal)
//
// Zwei Schichten:
//   PURE (export, testbar, kein DOM):
//     pvMeritAnnF, pvMeritDispatch, pvMeritInfraJk, pvMeritNettoUeberschuss,
//     pvMeritOrderCore
//   APP-SIDE (liest DOM/ASSETS/gebaeude/freiflaechen):
//     pvEnumerateKandidaten, pvRunMeritOrder

import { ASSETS } from './13a-assets-core.js';
import { freiflaechen, gebaeude } from './01-globals-varianten.js';
import { calcFFKwp } from './03a-erzeuger.js';
import { calcGebKwp } from './03c-gebaeude-io.js';
import { _PV_SPEZ_DEFAULT, makePvProfile8760 } from './09a-pv-profile.js';
import { PV_INFRA_STUFEN } from './09d-pv-analyse.js';

// ── Pure Helpers ──────────────────────────────────────────────────────────────

/** Annuitätenfaktor (VDI 2067). */
export function pvMeritAnnF(z, n) {
  if (!z || z <= 0) return n > 0 ? 1 / n : 1;
  return z * Math.pow(1 + z, n) / (Math.pow(1 + z, n) - 1);
}

/**
 * Strom-Dispatch am NAP für eine vorberechnete PV-Erzeugung.
 * pvGenH: Float32Array[N] in kWh/h (absolute Erzeugung, nicht normiert)
 * batKwh: Batteriekapazität in kWh (0 = keine Batterie)
 * demandH: Float32Array[N] in kW (= kWh/h)
 * napMaxEinsKw: Einspeiselimit am NAP (0 = unbegrenzt)
 * → { eigenMwh, einspeiseMwh, netzbezugMwh, curtailMwh, batVerlustMwh, maxEinspeiseKw }
 */
export function pvMeritDispatch(pvGenH, batKwh, demandH, napMaxEinsKw) {
  const N = demandH.length;
  const dt = N > 8784 ? 0.25 : 1.0;
  const ETA = 0.90;
  const batLeistKw = batKwh > 0 ? batKwh / 2 : 0; // C/2-Rate
  const maxEinsp = (napMaxEinsKw > 0) ? napMaxEinsKw : Infinity;

  let soc = 0;
  let eigenMwh = 0, einspeiseMwh = 0, netzbezugMwh = 0, curtailMwh = 0, batVerlustMwh = 0;
  let maxEinspeiseKw = 0;

  for (let t = 0; t < N; t++) {
    const dem   = demandH[t];
    const pvGen = pvGenH ? pvGenH[t] : 0;

    // 1. Direkter Eigenverbrauch
    const dsc = Math.min(pvGen, dem);
    let rDem = dem - dsc;
    let rGen = pvGen - dsc;

    // 2. NAP-Einspeiselimit → Batterie zwingen
    if (rGen > maxEinsp && batKwh > 0) {
      const mustStore = rGen - maxEinsp;
      const cPow  = Math.min(mustStore, batLeistKw);
      const cEkwh = Math.min(cPow * dt, (batKwh - soc) / ETA);
      soc += cEkwh * ETA; batVerlustMwh += cEkwh * (1 - ETA);
      rGen -= cEkwh / dt;
    }
    if (rGen > maxEinsp) { curtailMwh += (rGen - maxEinsp) * dt / 1000; rGen = maxEinsp; }

    // 3. Batterie entladen für Restbedarf
    if (rDem > 0 && soc > 0) {
      const dPow  = Math.min(rDem, batLeistKw, soc / dt);
      soc -= dPow * dt;
      rDem -= dPow;
    }

    // 4. Restüberschuss in Batterie laden
    if (rGen > 0 && soc < batKwh) {
      const cPow  = Math.min(rGen, batLeistKw);
      const cEkwh = Math.min(cPow * dt, (batKwh - soc) / ETA);
      soc += cEkwh * ETA; batVerlustMwh += cEkwh * (1 - ETA);
      rGen -= cEkwh / ETA / dt;
      if (rGen < 0) rGen = 0;
    }

    eigenMwh      += dsc  * dt / 1000;
    netzbezugMwh  += rDem * dt / 1000;
    if (rGen > 0) {
      einspeiseMwh += rGen * dt / 1000;
      if (rGen > maxEinspeiseKw) maxEinspeiseKw = rGen;
    }
  }

  return { eigenMwh, einspeiseMwh, netzbezugMwh, curtailMwh, batVerlustMwh, maxEinspeiseKw };
}

/**
 * Jährliche Infra-Kapitalkosten (Netzanschluss-Stufen) für pvKwp.
 * Entspricht dem Annuitätsanteil aus pvInfraKosten in 09d, aber
 * vollständig DOM-frei (pvInfraStufen = PV_INFRA_STUFEN oder Test-Fixture).
 */
export function pvMeritInfraJk(pvKwp, pvErtragMwh, pvInfraStufen, zins) {
  if (!pvKwp || !pvInfraStufen?.length) return 0;
  const stufe = pvInfraStufen.find(s => pvKwp <= s.bisKwp) || pvInfraStufen[pvInfraStufen.length - 1];
  let invest = 0, jaehrlich = 0;
  for (const item of stufe.items) {
    if (item.aktiv === false) continue;
    invest    += item.investEUR || 0;
    jaehrlich += item.perKwh ? item.perKwh * pvErtragMwh * 10 : 0; // ct/kWh → €/a
  }
  return invest * pvMeritAnnF(zins, 20) + jaehrlich;
}

/**
 * Netto-Jahresüberschuss einer PV-Konfiguration (positiv = wirtschaftlich vorteilhaft).
 * dispatch: Ergebnis von pvMeritDispatch
 * pvKwp:    Gesamt-kWp der Konfiguration
 * pvErtragMwh: Jahresertrag in MWh
 * params: { pStrom, pEinsp, pvInvestPerKwp, batKwh?, batInvestPerKwh?, zins?, pvLife?, batLife? }
 * pvInfraStufen: PV_INFRA_STUFEN oder Test-Fixture
 */
export function pvMeritNettoUeberschuss(dispatch, pvKwp, pvErtragMwh, params, pvInfraStufen) {
  const {
    pStrom, pEinsp,
    pvInvestPerKwp,
    batKwh        = 0,
    batInvestPerKwh = 400,
    zins          = 0.035,
    pvLife        = 20,
    batLife       = 15,
  } = params;

  const annPv  = pvMeritAnnF(zins, pvLife);
  const annBat = pvMeritAnnF(zins, batLife);

  const pvJk   = pvKwp  * pvInvestPerKwp   * (annPv  + 0.01); // 1 % IH
  const batJk  = batKwh * batInvestPerKwh  * (annBat + 0.01); // 1 % IH
  const infJk  = pvMeritInfraJk(pvKwp, pvErtragMwh, pvInfraStufen, zins);

  const eigenErsparnis = dispatch.eigenMwh    * pStrom * 10; // ct/kWh → €/a
  const einspeisErloes = dispatch.einspeiseMwh * pEinsp  * 10;

  return (eigenErsparnis + einspeisErloes) - (pvJk + batJk + infJk);
}

/**
 * Greedy-Marginal-Merit-Order für einen Satz PV-Kandidaten.
 *
 * kandidaten: Kandidat[] mit { id, kWp, ausrichtung, pvSpez, napId }
 * demandH: Float32Array[8760] in kW (geteilter Lastgang für alle NAPs in M2;
 *          Per-NAP-Lastgänge kommen in M3)
 * pvProfileSued / pvProfileOstWest: normierte 8760h-Profile (Summe ≈ 1.0)
 * params: {
 *   pStrom, pEinsp,          — ct/kWh
 *   pvInvestPerKwp,          — €/kWp
 *   batKwh?,                 — 0 = keine Batterie
 *   batInvestPerKwh?,
 *   zins?, pvLife?, batLife?,
 *   napMaxEinsKw?,           — 0 = unbegrenzt
 *   pvInfraStufen?,          — Fallback auf PV_INFRA_STUFEN aus 09d
 * }
 *
 * Rückgabe: { ranking, kurve }
 *   ranking: [{ kandidat, delta, napId, tier }]   (nach Δ absteigend, C ans Ende)
 *   kurve:   [{ kWpKumuliert, ueberschussKumuliert }]
 */
export function pvMeritOrderCore(kandidaten, demandH, pvProfileSued, pvProfileOstWest, params) {
  const {
    batKwh        = 0,
    napMaxEinsKw  = 0,
    pStrom, pEinsp,
    pvInvestPerKwp,
    batInvestPerKwh = 400,
    zins          = 0.035,
    pvLife        = 20,
    batLife       = 15,
    pvInfraStufen,
  } = params;

  const infStufen = pvInfraStufen || PV_INFRA_STUFEN;
  const wParams   = { pStrom, pEinsp, pvInvestPerKwp, batKwh, batInvestPerKwh, zins, pvLife, batLife };

  // Per-NAP-Zerlegung: Kandidaten nach napId gruppieren
  const napGroups = new Map();
  for (const k of kandidaten) {
    const nid = k.napId ?? 'default';
    if (!napGroups.has(nid)) napGroups.set(nid, []);
    napGroups.get(nid).push(k);
  }

  const ranking = []; // alle Ergebnis-Einträge (A/B vorn, C hinten)
  const kurve   = []; // kumulative Überschuss-Kurve

  for (const [napId, groupKand] of napGroups) {
    // In M2: gemeinsamer Lastgang für alle NAPs.
    // In M3 wird pro NAP ein eigener Lastgang ergänzt.
    const demand = demandH;

    // Vorab alle Beitrags-Profile berechnen (je Kandidat eine 8760h-Kurve in kWh/h)
    const remaining   = [...groupKand];
    const candGenH    = remaining.map(c => _buildCandGenH(c, pvProfileSued, pvProfileOstWest));

    // Inkrementelles Gesamt-Profil für die bisher gewählte Menge
    const genHSelected = new Float32Array(8760);
    const trialGen     = new Float32Array(8760); // Arbeits-Buffer, wird überschrieben
    let selectedKwp    = 0;
    let uebSelected    = 0; // Netto-Überschuss für leere Menge = 0 (kein Invest, kein Ertrag)

    while (remaining.length > 0) {
      let bestDelta = -Infinity, bestIdx = -1, bestUeb = uebSelected;

      for (let i = 0; i < remaining.length; i++) {
        // Probier-Profil: bisheriges Profil + Kandidat i
        const cg = candGenH[i];
        for (let t = 0; t < 8760; t++) trialGen[t] = genHSelected[t] + cg[t];

        const trialKwp = selectedKwp + remaining[i].kWp;
        let trialErtragMwh = 0;
        for (let t = 0; t < 8760; t++) trialErtragMwh += trialGen[t];
        trialErtragMwh /= 1000;

        const dispatch = pvMeritDispatch(trialGen, batKwh, demand, napMaxEinsKw);
        const ueb      = pvMeritNettoUeberschuss(dispatch, trialKwp, trialErtragMwh, wParams, infStufen);
        const delta    = ueb - uebSelected;

        if (delta > bestDelta) { bestDelta = delta; bestIdx = i; bestUeb = ueb; }
      }

      // Abbruch wenn kein Kandidat mehr einen positiven Beitrag liefert
      if (bestDelta <= 0) {
        for (const c of remaining) ranking.push({ kandidat: c, delta: bestDelta, napId, tier: 'C' });
        break;
      }

      // Besten Kandidaten zur gewählten Menge hinzufügen
      const best = remaining[bestIdx];
      const bg   = candGenH[bestIdx];
      for (let t = 0; t < 8760; t++) genHSelected[t] += bg[t];
      selectedKwp += best.kWp;
      uebSelected  = bestUeb;

      ranking.push({ kandidat: best, delta: bestDelta, napId });
      kurve.push({ kWpKumuliert: selectedKwp, ueberschussKumuliert: uebSelected });

      remaining.splice(bestIdx, 1);
      candGenH.splice(bestIdx, 1);
    }
  }

  // Tiers A/B für die im Algorithmus gewählten Einträge vergeben
  _assignTiers(ranking);

  return { ranking, kurve };
}

// ── Interne Helpers ───────────────────────────────────────────────────────────

function _buildCandGenH(c, pvProfileSued, pvProfileOstWest) {
  const prof  = (c.ausrichtung === 'ostwest') ? pvProfileOstWest : pvProfileSued;
  const spez  = c.pvSpez || _PV_SPEZ_DEFAULT[c.ausrichtung] || 1000;
  const scale = c.kWp * spez;
  const gen   = new Float32Array(8760);
  for (let t = 0; t < 8760; t++) gen[t] = prof[t] * scale;
  return gen;
}

function _assignTiers(ranking) {
  const selected = ranking.filter(r => !r.tier);
  if (!selected.length) return;
  const maxDelta  = Math.max(...selected.map(r => r.delta));
  const threshold = maxDelta * 0.3; // A-Tier: obere 70 % der Delta-Spanne
  for (const r of selected) {
    r.tier = r.delta > threshold ? 'A' : 'B';
  }
}

/** BFS durch ASSETS.edges vom startId → gibt ID des nächsten NAP-Assets zurück, oder null. */
function _findNapForAsset(startId) {
  const edges = ASSETS.edges;
  const items = ASSETS.items;
  const visited = new Set([startId]);
  const queue   = [startId];
  while (queue.length) {
    const id    = queue.shift();
    const asset = items.find(a => a.id === id);
    if (asset?.type === 'NAP') return asset.id;
    for (const e of edges) {
      if (e.u === id && !visited.has(e.v)) { visited.add(e.v); queue.push(e.v); }
      if (e.v === id && !visited.has(e.u)) { visited.add(e.u); queue.push(e.u); }
    }
  }
  return null;
}

/** Ableitung der Ausrichtung eines Gebäudes (analog pvOrientationMix). */
function _gebAusrichtung(g) {
  if (g.pvModus === 'flaechen') {
    if (!g.dachform || g.dachform === 'flach') return g.pvFlAusrichtung || 'sued';
    if (g.dachform === 'sattel') {
      const A     = g.dachAzimut != null ? g.dachAzimut : 180;
      const devEW = Math.min(Math.abs(A - 90), Math.abs(A - 270));
      return devEW <= 45 ? 'ostwest' : 'sued';
    }
  }
  return 'sued';
}

/** Standortspezifischer Ertrag (DOM-safe, fällt auf Default zurück). */
function _pvSpezFor(ausrichtung) {
  const globalSpez = parseFloat(
    typeof document !== 'undefined' ? document.getElementById?.('pv-spez')?.value : ''
  );
  const baseSued = _PV_SPEZ_DEFAULT['sued'] || 1050;
  const baseDef  = _PV_SPEZ_DEFAULT[ausrichtung] || 1000;
  if (!globalSpez || isNaN(globalSpez) || globalSpez <= 0) return baseDef;
  return baseDef * (globalSpez / baseSued);
}

// ── App-Side: Kandidaten-Enumeration ────────────────────────────────────────

/**
 * Listet alle PV-Ausbaukandidaten aus den 4 Quellen auf.
 * Gibt ein reines Datenobjekt zurück, berührt keinen State.
 *
 * Kandidat = { id, quelle, refId, name, lat, lng, kWp, ausrichtung, pvSpez,
 *              jahresertragKWh, napId, score, tier, deltaUeberschuss, status }
 */
export function pvEnumerateKandidaten() {
  const result = [];

  // 1. Elektro-Assets vom Typ 'PV'
  for (const a of (ASSETS?.items || []).filter(a => a.type === 'PV')) {
    const kWp = parseFloat(a.props?.leistungKWp) || 0;
    if (kWp <= 0) continue;
    const ausrichtung = a.props?.ausrichtung || 'sued';
    const pvSpez      = parseFloat(a.props?.pvSpez) || _pvSpezFor(ausrichtung);
    result.push({
      id:              'pv_asset_' + a.id,
      quelle:          'asset',
      refId:           a.id,
      name:            a.name || ('PV ' + a.id),
      lat:             a.lat,
      lng:             a.lng,
      kWp,
      ausrichtung,
      pvSpez,
      jahresertragKWh: kWp * pvSpez,
      napId:           _findNapForAsset(a.id),
      score:           null,
      tier:            null,
      deltaUeberschuss: null,
      status:          'kandidat',
    });
  }

  // 2. Gebäude-integrierte PV (pvAktiv)
  for (const g of (typeof gebaeude !== 'undefined' ? gebaeude : [])) {
    if (!g.pvAktiv) continue;
    const kWp = calcGebKwp(g) || 0;
    if (kWp <= 0) continue;
    const ausrichtung = _gebAusrichtung(g);
    const pvSpez      = _pvSpezFor(ausrichtung);
    const center      = _gebCenter(g);
    result.push({
      id:              'pv_geb_' + g.id,
      quelle:          'gebaeude',
      refId:           g.id,
      name:            g.name || ('Gebäude ' + g.id),
      lat:             center.lat,
      lng:             center.lng,
      kWp,
      ausrichtung,
      pvSpez,
      jahresertragKWh: kWp * pvSpez,
      napId:           null, // Gebäude-PV hat keine direkte NAP-Verknüpfung in M2
      score:           null,
      tier:            null,
      deltaUeberschuss: null,
      status:          'kandidat',
    });
  }

  // 3. Freiflächen-PV
  for (const ff of (typeof freiflaechen !== 'undefined' ? freiflaechen : [])) {
    const kWp = calcFFKwp(ff) || 0;
    if (kWp <= 0) continue;
    const ausrichtung = ff.ausrichtung || 'sued';
    const pvSpez      = _pvSpezFor(ausrichtung);
    result.push({
      id:              'pv_ff_' + ff.id,
      quelle:          'freiflaeche',
      refId:           ff.id,
      name:            ff.name || ('Freifläche ' + ff.id),
      lat:             ff.lat  || null,
      lng:             ff.lng  || null,
      kWp,
      ausrichtung,
      pvSpez,
      jahresertragKWh: kWp * pvSpez,
      napId:           ff.napId || null,
      score:           null,
      tier:            null,
      deltaUeberschuss: null,
      status:          'kandidat',
    });
  }

  // 4. Manuelle kWp-Eingabe (eine Einzel-Quelle)
  const manualKwp = parseFloat(
    typeof document !== 'undefined' ? document.getElementById?.('pv-kwp')?.value : ''
  ) || 0;
  if (manualKwp > 0) {
    const ausrichtung = (typeof document !== 'undefined'
      ? document.getElementById?.('pv-ausrichtung')?.value
      : null) || 'sued';
    const pvSpez = _pvSpezFor(ausrichtung);
    result.push({
      id:              'pv_manuell',
      quelle:          'manuell',
      refId:           null,
      name:            'Manuelle PV (' + manualKwp + ' kWp)',
      lat:             null,
      lng:             null,
      kWp:             manualKwp,
      ausrichtung,
      pvSpez,
      jahresertragKWh: manualKwp * pvSpez,
      napId:           null,
      score:           null,
      tier:            null,
      deltaUeberschuss: null,
      status:          'kandidat',
    });
  }

  return result;
}

/** Mittelpunkt eines Gebäudes aus seinem Polygon (oder 0/0 als Fallback). */
function _gebCenter(g) {
  const poly = g.polygon;
  if (!poly?.length) return { lat: g.lat || 0, lng: g.lng || 0 };
  let la = 0, ln = 0;
  for (const pt of poly) { la += pt[0]; ln += pt[1]; }
  return { lat: la / poly.length, lng: ln / poly.length };
}

// ── App-Side: Merit-Order starten ─────────────────────────────────────────────

/**
 * Führt die Merit-Order für alle aktuellen Kandidaten durch.
 * Liest PV-Profile und wirtschaftliche Parameter aus dem DOM.
 * opts überschreibt DOM-Defaults (nützlich für Tests / programmatischen Aufruf).
 *
 * opts: {
 *   kandidaten?: Kandidat[]   — Standard: pvEnumerateKandidaten()
 *   demandH?: Float32Array    — Standard: window.elQuartierH || window.elQuartierH15
 *   pStrom?: number           — ct/kWh, Standard: DOM 'strom-preis'
 *   pEinsp?: number           — ct/kWh, Standard: DOM 'pv-verg'
 *   pvInvestPerKwp?: number   — €/kWp, Standard: DOM 'opt-pv-invest'
 *   batKwh?: number           — kWh, Standard: 0
 *   zins?: number             — Dezimalbruch, Standard: DOM 'opt-zins'
 * }
 */
export function pvRunMeritOrder(opts = {}) {
  const dom = (id) => parseFloat(document.getElementById?.(id)?.value) || 0;

  const kandidaten     = opts.kandidaten ?? pvEnumerateKandidaten();
  const demandH        = opts.demandH    ?? window.elQuartierH ?? window.elQuartierH15;
  if (!demandH?.length) {
    console.warn('pvRunMeritOrder: kein Lastgang verfügbar — Merit-Order abgebrochen');
    return null;
  }

  const demandH8760 = demandH.length <= 8784
    ? demandH
    : _resampleTo8760(demandH); // 15-min → stündlich für den Merit-Order-Core

  const pStrom         = opts.pStrom         != null ? opts.pStrom         : (dom('strom-preis')  || 30);
  const pEinsp         = opts.pEinsp         != null ? opts.pEinsp         : (dom('pv-verg')       || 8);
  const pvInvestPerKwp = opts.pvInvestPerKwp != null ? opts.pvInvestPerKwp : (dom('opt-pv-invest') || 1200);
  const batKwh         = opts.batKwh         != null ? opts.batKwh         : 0;
  const zins           = opts.zins           != null ? opts.zins           : (dom('opt-zins') / 100 || 0.035);

  const pvProfileSued    = makePvProfile8760('sued');
  const pvProfileOstWest = makePvProfile8760('ostwest');

  return pvMeritOrderCore(kandidaten, demandH8760, pvProfileSued, pvProfileOstWest, {
    pStrom, pEinsp, pvInvestPerKwp, batKwh, zins,
    napMaxEinsKw: 0,
    pvInfraStufen: PV_INFRA_STUFEN,
  });
}

/** 15-min-Array auf 8760 Stundenwerte mitteln (gleitender Mittelwert je 4 Slots). */
function _resampleTo8760(arr15) {
  const out = new Float32Array(8760);
  const N15 = Math.min(arr15.length, 35040);
  for (let h = 0; h < 8760; h++) {
    const i = h * 4;
    out[h] = i + 3 < N15
      ? (arr15[i] + arr15[i+1] + arr15[i+2] + arr15[i+3]) / 4
      : (i < N15 ? arr15[i] : 0);
  }
  return out;
}
