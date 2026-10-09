// ── 10d-optimizer-worker.js — Worker-Code der Optimierung, Ergebnis-Charts ──
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { _dispatchCore } from './06c-dispatch-core.js';
import { _calcKostenShared } from './07b-analysis-economics.js';
import { pvBatteryStep } from './lib/pv-battery-core.js';
import { estimateBatteryAging } from './lib/battery-aging.js';
import { optKonzeptSchluessel, optMusterSuche } from './lib/optimierer-suche.js';
import { bedienModulStunden } from './lib/vdi-bedien.js';
import { speicherInvestEur } from './lib/waermespeicher.js';

/**
 * Quelltext des Optimierer-Workers. Die Rechenkerne (Dispatch, Kosten, PV/Batterie,
 * Suchbausteine) werden per .toString() eingebettet — dieselben Funktionen wie im
 * Hauptthread, damit Optimierer und Wirtschaftlichkeit identisch rechnen.
 *
 * Nachrichten (mode):
 *   'grob' — eigener Anteil der Grobsuche (Leistungsstufen × ST × Speicher, PV/Batterie
 *            je Punkt nach Zielfunktion), Antwort 'grob_done' mit kompakten Punkten
 *   'fein' — Mustersuche je Startpunkt über alle Größen gemeinsam, Antwort 'done'
 *   'full' — beides in einem Worker (ein Kern)
 */
export function _buildOptWorkerCode() {
  return `
'use strict';
// ═══ Web Worker: Optimierungsberechnung (DOM-frei) ═══

let D; // DOM-Parameter (via postMessage)
let QH = null; // Quartier-Stromlastgang
let QH_MWH = 0;

${pvBatteryStep.toString()}
${estimateBatteryAging.toString()}
${optKonzeptSchluessel.toString()}
${optMusterSuche.toString()}
${bedienModulStunden.toString()}
${speicherInvestEur.toString()}

function _defaultGuetegrad(key) {
  if (key === 'lwwp') return 0.42;
  if (key === 'fg') return 0.56;
  if (key === 'geo') return 0.50;
  return 0.42;
}

function _quelleTemp(key, tAussen, t) {
  if (key === 'lwwp') return tAussen;
  if (key === 'fg') {
    const d = Math.floor(t / 24);
    return Math.max(0.5, 10 + 8 * Math.sin(2 * Math.PI * (d - 119) / 365));
  }
  const d2 = Math.floor(t / 24);
  return 10 + 2 * Math.sin(2 * Math.PI * (d2 - 75) / 365) - D.geoDtAbsenkung;
}

// Lineare Interpolation in einer Tabelle [{x, y}] (sortiert); außerhalb Randwert
function _tabelle(pts, x) {
  if (!pts || !pts.length) return 0;
  if (x <= pts[0].x) return pts[0].y;
  const n = pts.length;
  if (x >= pts[n - 1].x) return pts[n - 1].y;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].x <= x) lo = m; else hi = m; }
  const t = (x - pts[lo].x) / (pts[hi].x - pts[lo].x);
  return pts[lo].y + t * (pts[hi].y - pts[lo].y);
}

function _investProKw(key, kw) {
  const v = _tabelle(D.investKurven[key], kw);
  return v > 0 ? v : (D.OPT_INVEST_DEFAULT[key] || 200);
}

// ── Gemeinsame Kostenberechnung (eingebettet aus Main-Thread) ──
` + _calcKostenShared.toString() + `

// ── Dispatch-Kern (eingebettet aus Main-Thread) ──
` + _dispatchCore.toString() + `

function dispatch8760(lastgangKw, tempH, vlH, erzeugerList, optSpeicherVol, stExcessH, backupMode) {
  let thSp = null;
  if (typeof optSpeicherVol === 'number' && optSpeicherVol > 0) {
    thSp = { kapKwh: optSpeicherVol * 1.16 * D.tsDt, verlustRate: D.tsVerlust / 100, entladeKw: D.tsEntladeKw, ladeKw: D.tsLadeKw ?? D.tsEntladeKw };
  }
  for (const erz of erzeugerList) {
    if (!erz.typ) erz.typ = D.ERZEUGER_TYP[erz.key] || 'fix';
    if (!erz.guetegrad) erz.guetegrad = D.guetegrade[erz.key] || _defaultGuetegrad(erz.key);
  }
  const r = _dispatchCore({
    lastgangKw, tempH, vlH,
    erzList: erzeugerList,
    speicherParams: thSp,
    stProfile: null,
    stExcessH: stExcessH,
    bhkwSigma: D.bhkwSkz, skEta: D.skEta, lwwpMinCop: D.lwwpMinCop,
    quelleTemp: _quelleTemp,
    recordHourly: false,
    backupMode: !!backupMode,
  });
  for (const erz of erzeugerList) {
    erz.waermeMwh = (r.thKwh[erz.key] || 0) / 1000;
    erz.elMwh = (r.elKwh[erz.key] || 0) / 1000;
  }
  // Backup-Kessel: Leistung = tatsächliche Spitze seines Einsatzes
  const _backupErz = backupMode && erzeugerList.length > 0 ? erzeugerList[erzeugerList.length - 1] : null;
  if (_backupErz && r.backupPeakKw > _backupErz.leistKw) _backupErz.leistKw = Math.ceil(r.backupPeakKw);
  return {
    erzeugerList,
    autoGkMwh: r.autoGkKwh / 1000,
    autoGkPeakKw: r.autoGkPeakKw,
    gesamtMwh: r.gesamtKwh / 1000,
    wpElH: r.wpElH, bhkwElH: r.bhkwElH, skElH: r.skElH,
    speicherEntladenMwh: r.thermEntladenGes / 1000,
    speicherGeladenMwh: r.thermGeladenGes / 1000,
    wpResKwH: r.wpResKwH, wpResCopH: r.wpResCopH,
    thSpParams: r.hatSpeicher ? { kapKwh: r.speicherParams.kapKwh, entladeKw: r.speicherParams.entladeKw, ladeKw: r.speicherParams.ladeKw ?? r.speicherParams.entladeKw } : null,
  };
}

// wpSkH: stündlicher Strombedarf von WP + Stromkessel → PV-Strom an diese Verbraucher (direkt / über die Batterie)
function pvBatSim8760(pvKwp, batKwh, demandH, bhkwElH, pvProfile, dispResult, wpSkH) {
  const hasBhkw = bhkwElH && bhkwElH.some(v => v > 0);
  if (pvKwp <= 0 && !hasBhkw) {
    let sumDem = 0;
    for (let t = 0; t < 8760; t++) sumDem += demandH[t];
    return { eigenMwh: 0, einspeiseMwh: 0, netzbezugMwh: sumDem / 1000,
             pvEigenMwh: 0, pvEinspMwh: 0, bhkwEigenMwh: 0, bhkwEinspMwh: 0, batDischargeMwh: 0,
             pvErtragMwh: 0, zuWpDirektMwh: 0, zuWpBatMwh: 0 };
  }
  const spez = D.pvSpez;
  const batLeistKw = batKwh > 0 ? (D.batKw > 0 ? D.batKw : batKwh / 2) : 0;
  let zuWpDirekt = 0, zuWpBat = 0;
  let sv = 0, ins = 0, bez = 0, soc = 0, socPv = 0, socBhkw = 0;
  let pvEig = 0, pvEinsp = 0, bhkwEig = 0, bhkwEinsp = 0;
  let tsSoc = 0, pvWpSpGes = 0, batDischargeKwh = 0;
  for (let t = 0; t < 8760; t++) {
    const dem = demandH[t];
    const pvGen = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const bhkwGen = bhkwElH ? bhkwElH[t] : 0;
    const step = pvBatteryStep({demand:dem,pvGen,bhkwGen,socKwh:soc,socPvKwh:socPv,socBhkwKwh:socBhkw,capacityKwh:batKwh,powerKw:batLeistKw,etaCharge:1,etaDischarge:.9});
    const dsc = step.direct;
    const pvFrac = step.pvFraction;
    let rDem = step.residualDemand, rGen = step.residualGeneration;
    soc = step.socKwh;
    socPv = step.socPvKwh; socBhkw = step.socBhkwKwh;
    batDischargeKwh += step.dischargedKwh;

    // PV-Überschuss → WP → thermischer Speicher
    let pvWpSp = 0;
    if (rGen > 0.1 && dispResult && dispResult.thSpParams && dispResult.wpResKwH) {
      const tsCap = dispResult.thSpParams.kapKwh;
      const tsLadeKw = dispResult.thSpParams.ladeKw ?? dispResult.thSpParams.entladeKw;
      const wpRKw = dispResult.wpResKwH[t] || 0;
      const wpCop = dispResult.wpResCopH[t] || 0;
      if (wpRKw > 0.1 && wpCop > 0 && tsCap > 0) {
        const tsFree = Math.max(0, tsCap - tsSoc);
        const ladeBudget = Math.min(tsFree, tsLadeKw);
        if (ladeBudget > 0.1) {
          const maxElKw = wpRKw / wpCop;
          const elUsed = Math.min(rGen, maxElKw);
          const thLade = Math.min(elUsed * wpCop, ladeBudget);
          if (thLade > 0.1) {
            const elActual = thLade / wpCop;
            tsSoc = Math.min(tsCap, tsSoc + thLade);
            rGen -= elActual;
            pvWpSp = elActual / 1000;
            pvWpSpGes += pvWpSp;
          }
        }
      }
    }

    sv += dsc + (dem - dsc - rDem); ins += rGen; bez += rDem;
    pvEig += (step.pvDirectKwh + step.pvDischargedKwh) / 1000 + pvWpSp;
    bhkwEig += (step.bhkwDirectKwh + step.bhkwDischargedKwh) / 1000;
    pvEinsp += (rGen / 1000) * pvFrac;
    bhkwEinsp += (rGen / 1000) * (1 - pvFrac);
    if (wpSkH && dem > 0) {
      const anteil = Math.min(1, wpSkH[t] / dem);
      zuWpDirekt += step.pvDirectKwh * anteil / 1000 + pvWpSp;
      zuWpBat += step.pvDischargedKwh * anteil / 1000;
    }
  }
  return { eigenMwh: sv / 1000 + pvWpSpGes, einspeiseMwh: ins / 1000, netzbezugMwh: bez / 1000,
           pvEigenMwh: pvEig, pvEinspMwh: pvEinsp, bhkwEigenMwh: bhkwEig, bhkwEinspMwh: bhkwEinsp,
           pvWpSpeicherMwh: pvWpSpGes, batDischargeMwh: batDischargeKwh / 1000,
           pvErtragMwh: pvKwp * spez / 1000, zuWpDirektMwh: zuWpDirekt, zuWpBatMwh: zuWpBat };
}

function kennwerte(dispR, pvKwp, batKwh, pvBatR, params, stMwh, stM2, optSpeicherVol) {
  const { erzeugerList, gesamtMwh } = dispR;
  const { pStrom, pStromWp, pGas, pPk, pHhs, pHko, pFw, pBhkwEinsp, pBhkwKwkE, pBhkwKwkEig, zinssatz } = params;

  const _bPKw = {};
  for (const erz of erzeugerList) _bPKw[erz.key] = erz.leistKw;
  // Spitzenlastkessel (Rest, den die gewählten Erzeuger nicht decken) wie in der Wirtschaftlichkeit
  const _agkMwh = dispR.autoGkMwh || 0, _agkKw = dispR.autoGkPeakKw || 0;
  if (_agkMwh > 0.05 && _agkKw > 0.1) _bPKw._autoGk = Math.ceil(_agkKw);
  const erzListTyped = erzeugerList.map(erz => ({ key: erz.key, waermeMwh: erz.waermeMwh, elMwh: erz.elMwh, typ: D.ERZEUGER_TYP[erz.key] }));
  if (_bPKw._autoGk) erzListTyped.push({ key: '_autoGk', waermeMwh: _agkMwh, elMwh: 0, typ: 'fix' });

  const bhkwEigMwh = pvBatR ? (pvBatR.bhkwEigenMwh || 0) : 0;
  const bhkwEinspMwh = pvBatR ? (pvBatR.bhkwEinspMwh || 0) : 0;

  // Erdsonden nach Leistung und Jahresentzug der Geo-WP dieser Variante
  let _dynBohrMeter = D.bohrMeter || 0;
  const _geoErz = erzeugerList.find(e => e.key === 'geo');
  if (_geoErz && _geoErz.leistKw > 0 && _dynBohrMeter < 1) {
    const _geoJaz = (_geoErz.elMwh > 0) ? _geoErz.waermeMwh / _geoErz.elMwh : 4.0;
    const _proSondeKw = D.geoQPerM * D.geoTiefe / 1000;
    const _nLeistung = Math.max(1, Math.ceil(_geoErz.leistKw * (_geoJaz - 1) / _geoJaz / _proSondeKw));
    let _nEnergie = 1;
    if (_geoErz.waermeMwh > 0) _nEnergie = Math.max(1, Math.ceil(_geoErz.waermeMwh * 1000 * (_geoJaz - 1) / _geoJaz / (_proSondeKw * 2100)));
    _dynBohrMeter = Math.max(_nLeistung, _nEnergie) * D.geoTiefe;
  }

  const batAging = batKwh > 0 ? estimateBatteryAging({capacityKwh:batKwh,annualDischargeKwh:(pvBatR?.batDischargeMwh||0)*1000,
    calendarFadePctPerYear:D.batCalendarFade,cycleLife:D.batCycleLife,eolCapacityPct:D.batEolPct,studyYears:20}) : null;

  const result = _calcKostenShared({
    pKw: _bPKw,
    erzList: erzListTyped,
    zinsPct: zinssatz * 100,
    lohn: D.lohn || 45,
    prices: { strom: pStrom, stromWp: pStromWp, gas: pGas, hko: pHko, fw: pFw, pk: pPk, hhs: pHhs },
    etas: { gaskessel: D.etaGk, heizoel: D.etaHko, pellets: D.etaPk, hhs: D.etaHhs, bhkw: D.etaBhkw, bhkwSigma: D.bhkwSkz },
    investFn: function(key, kw) { return kw > 0.1 ? Math.round(kw * _investProKw(key, kw)) : 0; },
    extra: {
      bohrMeter: _dynBohrMeter,
      nGeb: D.nGeb || 0,
      netzInvest: D.netzInvest || 0,
      ohneNetz: !!D.ohneNetz,
      stM2: (stMwh || 0) > 0 ? (stM2 || 0) : 0,
      optSpeicherVol: optSpeicherVol || 0,
      tsTyp: D.tsTyp, tsDt: D.tsDt,
    },
    // PV/Batterie wie in der Planung; angerechnet wird nur PV-Strom an WP/Stromkessel (wie pvWaermeEingaben)
    pv: D.pvWp && pvKwp > 0 ? {
      modus: 'wp', kwp: pvKwp, ertragMwh: pvBatR ? pvBatR.pvErtragMwh : 0, invPerKwp: D.pvInvPerKwpPlan,
      batKwh: batKwh, batInvPerKwh: D.batInvest, batEntladungMwh: pvBatR ? pvBatR.batDischargeMwh : 0,
      batLifeYears: batAging && Number.isFinite(batAging.expectedLifeYears) && batAging.expectedLifeYears > 0 ? Math.max(1, batAging.expectedLifeYears) : (D.batLife || 15),
      zuWpDirektMwh: pvBatR ? pvBatR.zuWpDirektMwh : 0, zuWpBatMwh: pvBatR ? pvBatR.zuWpBatMwh : 0,
    } : { modus: 'aus' },
    strom: {
      quartierMwh: QH_MWH,
      bhkwEigenMwh: bhkwEigMwh, bhkwEinspMwh: bhkwEinspMwh,
      pBhkwEinsp: pBhkwEinsp, pBhkwKwkE: pBhkwKwkE, pBhkwKwkEig: pBhkwKwkEig,
    },
    co2: {
      pCo2: D.pCo2 || 0,
      alleET: D.co2Alle !== false,
      bhkwGutschrift: !!D.bhkwGutschrift, verdraengungEf: D.verdraengungEf,
      emf: { gas: D.gasEmF, heizoel: D.heizoelEmF, pellets: D.pelletsEmF, hhs: D.hhsEmF, fernwaerme: D.fernwaermeEmF, strom: D.stromEmF },
    },
    gesamtMwh: gesamtMwh,
    stMwh: stMwh || 0,
  });

  return { wgk: result.wgk, co2ta: result.co2ta, eeAnteil: result.eeAnteil,
    stromAutarkie: result.stromAutarkie, waermeAutarkie: result.waermeAutarkie,
    investGesamt: result.investGesamt, jahreskosten: result.jahreskosten,
    pvErtragMwh: pvBatR ? pvBatR.pvErtragMwh : 0, pvZuWpMwh: result.pvZuWpMwh, pvCt: result.pvCt };
}

function score(kw, ziel) {
  if (ziel === 'min-co2') return kw.co2ta;
  if (ziel === 'max-autarkie') return -(kw.stromAutarkie + kw.waermeAutarkie);
  // ≥ 65 % EE: unzulässige Varianten bleiben vergleichbar (näher an 65 % = besser), damit die Suche hinfindet
  if (ziel === 'min-kosten-ee') return kw.eeAnteil >= 65 ? kw.wgk : 1e9 + (65 - kw.eeAnteil) * 1e3 + kw.wgk;
  return kw.wgk;
}

// ═══ Hauptlogik ═══
self.onmessage = function(e) {
  const data = e.data;
  D = data.dom;
  const { lastgangKw, tempH, vlH, pvProfile, stNormProfile, quartierH, params, ziel } = data;
  const S = data.suche;
  QH = quartierH;
  QH_MWH = 0;
  for (let t = 0; t < 8760; t++) QH_MWH += QH[t];
  QH_MWH /= 1000;
  const mode = data.mode || 'full';
  const workerIdx = data.workerIdx || 0;
  const numWorkers = data.numWorkers || 1;

  // ── Solarthermie: Lastgang um den direkt genutzten Ertrag reduzieren (Cache je Fläche) ──
  const stCache = new Map();
  function stReduziert(stM2) {
    if (stM2 <= 0 || !stNormProfile) return { lastgang: lastgangKw, waermeMwh: 0, stExcessH: null };
    const c = stCache.get(stM2);
    if (c) return c;
    const reduced = new Float32Array(8760), stExcessH = new Float32Array(8760);
    let sumKwh = 0;
    for (let t = 0; t < 8760; t++) {
      const stKw = stNormProfile[t] * stM2;
      const used = Math.min(stKw, lastgangKw[t]);
      reduced[t] = lastgangKw[t] - used;
      stExcessH[t] = stKw - used;
      sumKwh += used;
    }
    const r = { lastgang: reduced, waermeMwh: sumKwh / 1000, stExcessH };
    if (stCache.size > 24) stCache.delete(stCache.keys().next().value);
    stCache.set(stM2, r);
    return r;
  }

  // ── Einsatzplanung je Erzeugerpark (Cache: PV/Batterie-Schritte brauchen keinen neuen Dispatch) ──
  const dispCache = new Map();
  function einsatz(keys, gens, stM2, tsVol) {
    const ck = keys.join(',') + '|' + gens.join(',') + '|' + stM2 + '|' + tsVol;
    const c = dispCache.get(ck);
    if (c) return c;
    const st = stReduziert(stM2);
    const config = keys.map((k, i) => ({ key: k, leistKw: gens[i], typ: D.ERZEUGER_TYP[k] || 'fix', guetegrad: D.guetegrade[k] || _defaultGuetegrad(k) }));
    const disp = dispatch8760(st.lastgang, tempH, vlH, config, tsVol, st.stExcessH, S.backupMode);
    const demandH = new Float32Array(8760), wpSkH = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) { wpSkH[t] = disp.wpElH[t] + disp.skElH[t]; demandH[t] = wpSkH[t] + quartierH[t]; }
    const r = { disp, demandH, wpSkH, stMwh: st.waermeMwh };
    if (dispCache.size > 48) dispCache.delete(dispCache.keys().next().value);
    dispCache.set(ck, r);
    return r;
  }

  // ── Vollständige Bewertung eines Punktes x = [Erzeuger…, PV kWp, Batterie kWh, ST m², Speicher m³] ──
  function bewerte(keys, x) {
    const n = keys.length;
    const gens = x.slice(0, n);
    const pvKwp = x[n], batKwh = x[n + 1], stM2 = x[n + 2], tsVol = x[n + 3];
    const E = einsatz(keys, gens, stM2, tsVol);
    const pvBat = pvBatSim8760(pvKwp, batKwh, E.demandH, E.disp.bhkwElH, pvProfile, E.disp, E.wpSkH);
    const kw = kennwerte(E.disp, pvKwp, batKwh, pvBat, params, E.stMwh, stM2, tsVol);
    const kanon = optKonzeptSchluessel(keys, E.disp.autoGkMwh, E.disp.autoGkPeakKw);
    let sc = score(kw, ziel);
    // Höchstleistung des Gaskessels gilt auch für den Spitzenlastkessel
    if (S.gasMaxKw > 0 && E.disp.autoGkMwh > 0.05 && E.disp.autoGkPeakKw > S.gasMaxKw + 0.5) sc = Infinity;
    return { score: sc, kw, kanon, E, pvBat, x };
  }

  function detail(keys, b) {
    const n = keys.length, d = b.E.disp;
    return {
      keys, kanon: b.kanon, x: b.x,
      config: d.erzeugerList.map(e => ({ key: e.key, leistKw: e.leistKw })),
      pvKwp: b.x[n], batKwh: b.x[n + 1], stM2: b.x[n + 2], stMwh: b.E.stMwh, tsVol: b.x[n + 3],
      kw: b.kw, score: b.score,
      gesamtMwh: d.gesamtMwh, autoGkMwh: d.autoGkMwh, autoGkPeakKw: d.autoGkPeakKw,
      erzWaermeMwh: d.erzeugerList.map(e => e.waermeMwh),
      erzLeistKw: d.erzeugerList.map(e => e.leistKw),
      erzElMwh: d.erzeugerList.map(e => e.elMwh),
      speicherEntladenMwh: d.speicherEntladenMwh || 0,
      pvBatData: { eigenMwh: b.pvBat.eigenMwh, einspeiseMwh: b.pvBat.einspeiseMwh,
        pvEigenMwh: b.pvBat.pvEigenMwh, pvEinspMwh: b.pvBat.pvEinspMwh,
        bhkwEigenMwh: b.pvBat.bhkwEigenMwh, bhkwEinspMwh: b.pvBat.bhkwEinspMwh,
        netzbezugMwh: b.pvBat.netzbezugMwh, batDischargeMwh: b.pvBat.batDischargeMwh,
        pvErtragMwh: b.pvBat.pvErtragMwh, zuWpDirektMwh: b.pvBat.zuWpDirektMwh, zuWpBatMwh: b.pvBat.zuWpBatMwh },
    };
  }

  function kompakt(keys, b) {
    const n = keys.length;
    return { kombiKey: b.kanon, kanon: b.kanon, keys, x: b.x, score: b.score,
      kw: { wgk: b.kw.wgk, co2ta: b.kw.co2ta, investGesamt: b.kw.investGesamt, eeAnteil: b.kw.eeAnteil,
        stromAutarkie: b.kw.stromAutarkie, waermeAutarkie: b.kw.waermeAutarkie, jahreskosten: b.kw.jahreskosten },
      config: b.E.disp.erzeugerList.map(e => ({ key: e.key, leistKw: e.leistKw })),
      pvKwp: b.x[n], batKwh: b.x[n + 1], stM2: b.x[n + 2], tsVol: b.x[n + 3] };
  }

  // ═══ GROBSUCHE ═══
  // Je Startpunkt: PV und Batterie nach Zielfunktion aus wenigen Stufen (Dispatch einmal)
  function grobPunkt(keys, gens, stM2, tsVol) {
    const pv = S.pv, bat = S.bat;
    const pvStufen = pv.hi > pv.lo ? [pv.lo, Math.round((pv.lo + pv.hi) / 2), pv.hi] : [pv.lo];
    let best = null;
    for (const p of pvStufen) {
      const b = bewerte(keys, gens.concat([p, bat.lo, stM2, tsVol]));
      if (!best || b.score < best.score) best = b;
    }
    if (bat.hi > bat.lo && best.x[keys.length] > 0) {
      const b = bewerte(keys, gens.concat([best.x[keys.length], Math.round((bat.lo + bat.hi) / 2), stM2, tsVol]));
      if (b.score < best.score) best = b;
    }
    return best;
  }

  const grobResults = [];
  if (mode !== 'fein') {
    const stStufen = S.st.hi > S.st.lo ? [S.st.lo, Math.round((S.st.lo + S.st.hi) / 2)] : [S.st.lo];
    const tsStufen = S.ts.hi > S.ts.lo ? [S.ts.lo, Math.round((S.ts.lo + S.ts.hi) / 2)] : [S.ts.lo];
    let items = [];
    for (const k of S.kombis) {
      for (const gens of k.punkte) for (const st of stStufen) for (const ts of tsStufen) items.push({ keys: k.keys, gens, st, ts });
    }
    if (numWorkers > 1) items = items.filter((_, i) => i % numWorkers === workerIdx);
    let done = 0, lastProgressAt = 0;
    for (const it of items) {
      done++;
      const b = grobPunkt(it.keys, it.gens, it.st, it.ts);
      if (b && Number.isFinite(b.score)) grobResults.push(kompakt(it.keys, b));
      const now = Date.now();
      if (now - lastProgressAt > 500) {
        lastProgressAt = now;
        const best3 = [];
        for (const r of grobResults) {
          if (best3.length < 3) { best3.push(r); best3.sort((a, c) => a.score - c.score); }
          else if (r.score < best3[2].score) { best3[2] = r; best3.sort((a, c) => a.score - c.score); }
        }
        self.postMessage({ type: 'progress', phase: 'Grobsuche', pct: Math.round(done / items.length * 100), done, total: items.length, workerIdx,
          best3: best3.map(r => ({ kombiKey: r.kanon, score: r.score, wgk: r.kw.wgk, config: r.config, pvKwp: r.pvKwp, batKwh: r.batKwh, stM2: r.stM2, tsVol: r.tsVol })) });
      }
    }
    if (mode === 'grob') {
      self.postMessage({ type: 'grob_done', grobResults, workerIdx });
      return;
    }
  }

  // ═══ FEINSUCHE: Mustersuche über alle Größen gemeinsam ═══
  let seeds = data.seeds || [];
  if (mode === 'full') {
    // Bestes Ergebnis je Anlagenkonzept als Startpunkt
    const besteJe = new Map();
    for (const r of grobResults) { const b = besteJe.get(r.kanon); if (!b || r.score < b.score) besteJe.set(r.kanon, r); }
    seeds = [...besteJe.values()].sort((a, c) => a.score - c.score).slice(0, S.anzahlFein).map(r => ({ keys: r.keys, x: r.x, kanon: r.kanon }));
    for (const s of (data.zusatzSeeds || [])) seeds.push(s);
  }

  const topFein = [];
  for (let si = 0; si < seeds.length; si++) {
    self.postMessage({ type: 'progress', phase: 'Feinsuche', pct: Math.round(si / seeds.length * 100), done: si, total: seeds.length, workerIdx });
    const seed = seeds[si];
    const keys = seed.keys;
    const k = S.kombis.find(kk => kk.keys.join(',') === keys.join(','));
    if (!k) continue;
    const dims = k.grenzen.map(g => ({ lo: g.lo, hi: g.hi, schritt: Math.max(1, Math.round(S.peak * 0.15)), minSchritt: S.minSchrittErz, gruppe: 'erz' }));
    for (const ach of [S.pv, S.bat, S.st, S.ts]) {
      dims.push({ lo: ach.lo, hi: ach.hi, schritt: Math.max(1, Math.round((ach.hi - ach.lo) / 4)), minSchritt: Math.max(1, Math.round((ach.hi - ach.lo) / 100)) });
    }
    const start = seed.x.map((v, i) => Math.round(Math.min(dims[i].hi, Math.max(dims[i].lo, v))));
    const startB = bewerte(keys, start);
    // Das Anlagenkonzept bleibt während der Suche gleich (sonst wandert z. B. „Pellets“ in „Pellets + Gaskessel“)
    const kanonSoll = seed.kanon || startB.kanon;
    let besterB = startB.kanon === kanonSoll ? startB : null;
    const res = optMusterSuche(start, dims, x => {
      const b = bewerte(keys, x);
      if (b.kanon !== kanonSoll) return Infinity;
      if (!besterB || b.score < besterB.score) besterB = b;
      return b.score;
    }, S.maxEvalFein);
    if (!besterB || !Number.isFinite(besterB.score)) continue;
    const out = detail(keys, besterB);
    out.evals = res.evals;
    out.ausgangsplanung = !!seed.ausgangsplanung;
    // Ausgangsplanung exakt (ohne Suchgrenzen) als Vergleichswert
    if (seed.ausgangsplanung) out.start = detail(keys, bewerte(keys, seed.x));
    topFein.push(out);
  }

  self.postMessage({ type: 'done', topFein, grobResults: mode === 'full' ? grobResults : [], workerIdx });
};
`;
}

// ── Gestapeltes Balkendiagramm: Energie- und Leistungsanteile Top-Varianten ──
export function _optRenderBarChart(results, container) {
  if (!results || results.length === 0) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:12px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:9px;color:var(--muted);margin-bottom:4px;font-family:"DM Sans",sans-serif;';
  lbl.textContent = 'Energie- und Leistungsanteile der Top-Varianten';
  wrap.appendChild(lbl);

  const canvas = document.createElement('canvas');
  canvas.id = 'opt-bar-canvas';
  canvas.style.cssText = 'width:100%;border-radius:6px;background:var(--surface2);';
  wrap.appendChild(canvas);
  container.insertBefore(wrap, container.firstChild);

  const W = canvas.offsetWidth || 460;
  const energyH = 22;  // Energiebalken (dicker = wichtiger)
  const powerH = 12;   // Leistungsbalken (dünner)
  const gapH = 2;      // Abstand zwischen Energie- und Leistungsbalken
  const groupGap = 28;  // Abstand zwischen Varianten (mehr Luft)
  const blockH = energyH + gapH + powerH + groupGap;
  const H = results.length * blockH + 20;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Volle Erzeugernamen
  const _fullName = k => ERZEUGER_CFG[k]?.label || k;

  // ── Labels vorbereiten (Variantenname) ──
  ctx.font = '10px "DM Sans", sans-serif';
  let maxLabelW = 0;
  const varLabels = results.map((r, idx) => {
    const txt = (idx + 1) + '. ' + (r.anzeigeKeys || r.keys).map(k => _fullName(k)).join(' + ');
    const w = ctx.measureText(txt).width;
    if (w > maxLabelW) maxLabelW = w;
    return txt;
  });
  const PAD = { l: Math.max(90, Math.ceil(maxLabelW) + 12), r: 80, t: 8 };
  const barW = W - PAD.l - PAD.r;

  // Hilfsfunktion: gestapelten Balken zeichnen
  function drawStackedBar(segments, x0, y0, totalBarW, barHeight, showLabels) {
    let xOff = x0;
    for (const seg of segments) {
      const segW = seg.frac * totalBarW;
      ctx.fillStyle = seg.color;
      ctx.fillRect(xOff, y0, Math.max(0.5, segW), barHeight);
      seg._x = xOff;
      seg._w = segW;
      xOff += segW;
    }
    if (showLabels) {
      ctx.font = '8px "DM Sans", sans-serif';
      ctx.textBaseline = 'middle';
      for (const seg of segments) {
        const pctTxt = seg.pct.toFixed(0) + '%';
        const nameTxt = seg.name;
        if (seg._w > 70) {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.textAlign = 'center';
          ctx.fillText(nameTxt + ' ' + pctTxt, seg._x + seg._w / 2, y0 + barHeight / 2);
        } else if (seg._w > 28) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(pctTxt, seg._x + seg._w / 2, y0 + barHeight / 2);
        }
      }
    } else {
      // Dünner Balken: nur Prozent wenn genug Platz
      ctx.font = '7px "DM Sans", sans-serif';
      ctx.textBaseline = 'middle';
      for (const seg of segments) {
        const pctTxt = seg.pct.toFixed(0) + '%';
        if (seg._w > 22) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.textAlign = 'center';
          ctx.fillText(pctTxt, seg._x + seg._w / 2, y0 + barHeight / 2);
        }
      }
    }
  }

  results.forEach((r, idx) => {
    const y = PAD.t + idx * blockH;
    const simList = r.sim?.erzeugerList || [];

    // ── Energieanteile (MWh) ──
    const totalMwh = (r.sim?.gesamtMwh || r.gesamtMwh || 0) + (r.stMwh || 0) || 1;
    const eSegments = [];
    if (r.stMwh > 0.1) {
      eSegments.push({ frac: r.stMwh / totalMwh, pct: r.stMwh / totalMwh * 100, name: 'Solarthermie', color: '#ef6c00' });
    }
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const simErz = simList[ci];
      const mwh = simErz?.waermeMwh || (r.erzWaermeMwh ? r.erzWaermeMwh[ci] : 0) || 0;
      eSegments.push({ frac: mwh / totalMwh, pct: mwh / totalMwh * 100, name: _fullName(erz.key), color: ERZEUGER_CFG[erz.key]?.color || '#aaa' });
    }
    if (r.sim?.autoGkMwh > 0) {
      eSegments.push({ frac: r.sim.autoGkMwh / totalMwh, pct: r.sim.autoGkMwh / totalMwh * 100, name: 'Backup-GK', color: '#78909c' });
    }
    // ── Leistungsanteile (kW) ──
    let totalKw = 0;
    const pParts = [];
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const kw = (r.erzLeistKw ? r.erzLeistKw[ci] : erz.leistKw) || 0;
      totalKw += kw;
      pParts.push({ kw, name: _fullName(erz.key), color: ERZEUGER_CFG[erz.key]?.color || '#aaa' });
    }
    if (totalKw < 0.1) totalKw = 1;
    const pSegments = pParts.map(p => ({ frac: p.kw / totalKw, pct: p.kw / totalKw * 100, name: p.name, color: p.color }));
    // Label links (Variantenname)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '10px "DM Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(varLabels[idx], PAD.l - 6, y);

    // Zeilen-Labels links
    ctx.fillStyle = '#78909c';
    ctx.font = '8px "DM Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('Energie', PAD.l - 6, y + energyH / 2 + 12);
    ctx.fillText('Leistung', PAD.l - 6, y + energyH + gapH + powerH / 2 + 12);

    // Balken zeichnen
    drawStackedBar(eSegments, PAD.l, y + 12, barW, energyH, true);
    drawStackedBar(pSegments, PAD.l, y + 12 + energyH + gapH, barW, powerH, false);

    // WGK + Invest rechts (vertikal zentriert)
    const midY = y + 12 + (energyH + gapH + powerH) / 2;
    ctx.fillStyle = '#fdd835';
    ctx.font = 'bold 11px "DM Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.kw.wgk.toFixed(1) + ' ct', PAD.l + barW + 6, midY - 6);
    ctx.fillStyle = '#90a4ae';
    ctx.font = '9px "DM Mono", monospace';
    ctx.fillText((r.kw.investGesamt / 1000).toFixed(0) + ' k\u20ac', PAD.l + barW + 6, midY + 7);

    // Trennlinie zwischen Varianten
    if (idx < results.length - 1) {
      const lineY = y + energyH + gapH + powerH + 18;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, lineY);
      ctx.lineTo(W - 8, lineY);
      ctx.stroke();
    }
  });
}

// ── Radar-/Spinnendiagramm: Kennzahlen-Vergleich Top-3 ───────────────────
export function _optRenderRadar(results, container) {
  if (!results || results.length === 0) return;
  const top3 = results.slice(0, 3);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:12px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:9px;color:var(--muted);margin-bottom:4px;font-family:"DM Sans",sans-serif;';
  lbl.textContent = 'Kennzahlen-Vergleich (Top 3)';
  wrap.appendChild(lbl);

  const canvas = document.createElement('canvas');
  canvas.id = 'opt-radar-canvas';
  canvas.style.cssText = 'width:100%;border-radius:6px;background:var(--surface2);';
  wrap.appendChild(canvas);

  // Legende
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;';
  const varColors = ['#66bb6a','#29b6f6','#ff7043'];
  top3.forEach((r, i) => {
    const name = (r.anzeigeKeys || r.keys).map(k => ERZEUGER_CFG[k]?.label || k).join('+');
    const sp = document.createElement('span');
    sp.style.cssText = 'font-size:9px;color:var(--muted);font-family:"DM Sans",sans-serif;display:flex;align-items:center;gap:3px;';
    sp.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + varColors[i] + ';opacity:0.7;"></span>' + (i + 1) + '. ' + name;
    legendDiv.appendChild(sp);
  });
  wrap.appendChild(legendDiv);
  container.appendChild(wrap);

  const W = canvas.offsetWidth || 460;
  const H = 260;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W / 2 - 50, H / 2 - 30);

  // 5 Achsen: WGK (inv), CO2 (inv), EE-Anteil, Autarkie, Invest (inv)
  const axes = [
    { label: 'WGK',       key: 'wgk',          inv: true,  unit: 'ct/kWh' },
    { label: 'CO₂',       key: 'co2ta',         inv: true,  unit: 't/a' },
    { label: 'EE-Anteil',  key: 'eeAnteil',     inv: false, unit: '%' },
    { label: 'Strom-Autarkie', key: 'stromAutarkie', inv: false, unit: '%' },
    { label: 'W\u00e4rme-Autarkie', key: 'waermeAutarkie', inv: false, unit: '%' },
    { label: 'Invest',     key: 'investGesamt', inv: true,  unit: 'k€' },
  ];
  const N = axes.length;
  const angleStep = (2 * Math.PI) / N;
  const startAngle = -Math.PI / 2; // 12-Uhr-Position

  // Min/Max über alle Top-3 bestimmen
  const ranges = axes.map(ax => {
    const vals = top3.map(r => ax.key === 'investGesamt' ? r.kw[ax.key] / 1000 : r.kw[ax.key]);
    let mn = Math.min(...vals);
    let mx = Math.max(...vals);
    if (mx - mn < 0.01) { mn -= 1; mx += 1; }
    return { min: mn, max: mx };
  });

  // Normalisierung: 0–1, wobei "besser" = 1 (= außen)
  function normalize(axIdx, val) {
    const ax = axes[axIdx];
    const rng = ranges[axIdx];
    if (ax.key === 'investGesamt') val = val / 1000;
    let t = (val - rng.min) / (rng.max - rng.min);
    t = Math.max(0, Math.min(1, t));
    if (ax.inv) t = 1 - t;
    // Mindestens 15% Radius damit Polygon sichtbar bleibt
    return 0.15 + t * 0.85;
  }

  function axisXY(axIdx, frac) {
    const angle = startAngle + axIdx * angleStep;
    return { x: cx + Math.cos(angle) * R * frac, y: cy + Math.sin(angle) * R * frac };
  }

  // Hintergrund-Ringe
  ctx.strokeStyle = '#2a3050';
  ctx.lineWidth = 0.5;
  for (let ring = 1; ring <= 4; ring++) {
    const frac = ring / 4;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = axisXY(i % N, frac);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Achsenlinien + Labels
  ctx.strokeStyle = '#3a4060';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < N; i++) {
    const p = axisXY(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // Label
    const lp = axisXY(i, 1.18);
    ctx.fillStyle = '#90a4ae';
    ctx.font = '9px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(axes[i].label, lp.x, lp.y);
  }

  // Polygone zeichnen
  top3.forEach((r, vIdx) => {
    const col = varColors[vIdx];
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const val = axes[i].key === 'investGesamt' ? r.kw[axes[i].key] : r.kw[axes[i].key];
      const norm = normalize(i, val);
      const p = axisXY(i, norm);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = col + '33'; // ~20% alpha
    ctx.fill();
    ctx.strokeStyle = col + 'cc'; // ~80% alpha
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Punkte auf Achsen
    for (let i = 0; i < N; i++) {
      const val = axes[i].key === 'investGesamt' ? r.kw[axes[i].key] : r.kw[axes[i].key];
      const norm = normalize(i, val);
      const p = axisXY(i, norm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.fill();
    }
  });
}

// ── Scatter-Plot: Alle Grob-Ergebnisse (WGK vs CO2) ─────────────────────
export function _optRenderScatter(container) {
  const allRes = window._optGrobResults;
  if (!allRes || allRes.length < 2) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:12px;position:relative;';

  // Header mit Titel + 2D/3D-Toggle
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:9px;color:var(--muted);font-family:"DM Sans",sans-serif;';
  lbl.textContent = 'Alle getesteten Konfigurationen (' + allRes.length + ') \u2014 WGK vs. CO\u2082';
  header.appendChild(lbl);

  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = 'font-size:9px;padding:2px 10px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:.15s;';
  toggleBtn.textContent = '\u25C8 3D';
  toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.borderColor = 'var(--accent)'; toggleBtn.style.color = 'var(--accent)'; });
  toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.borderColor = 'var(--border)'; toggleBtn.style.color = 'var(--muted)'; });
  header.appendChild(toggleBtn);

  const hullBtn = document.createElement('button');
  hullBtn.style.cssText = 'font-size:9px;padding:2px 10px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:.15s;margin-left:4px;display:none;';
  hullBtn.textContent = '\u25A7 Fl\u00e4chen';
  hullBtn.addEventListener('mouseenter', () => { hullBtn.style.borderColor = 'var(--accent)'; hullBtn.style.color = 'var(--accent)'; });
  hullBtn.addEventListener('mouseleave', () => { hullBtn.style.borderColor = 'var(--border)'; hullBtn.style.color = 'var(--muted)'; });
  header.appendChild(hullBtn);
  wrap.appendChild(header);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;border-radius:6px;background:var(--surface2);cursor:crosshair;';
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  // Erzeuger-Farben aus Config
  const _fullName = k => ERZEUGER_CFG[k]?.label || k;
  const allGenKeys = [...new Set(allRes.flatMap(r => r.keys))];
  const genColors = {};
  allGenKeys.forEach(k => { genColors[k] = ERZEUGER_CFG[k]?.color || '#aaa'; });

  // State
  let activeFilter = null;
  let is3D = false;
  let rotX = -0.45, rotZ = 0.65, zoom3D = 1.0;
  let dragging = false, dragSX = 0, dragSY = 0, dragSRX = 0, dragSRZ = 0;
  let showHulls = true; // Kombinations-Flächen anzeigen

  // Convex-Hull (Andrew's monotone chain)
  function convexHull(points) {
    if (points.length < 3) return points.slice();
    const pts = points.slice().sort((a, b) => a.px - b.px || a.py - b.py);
    const cross = (O, A, B) => (A.px - O.px) * (B.py - O.py) - (A.py - O.py) * (B.px - O.px);
    const lower = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Kombinations-Gruppen für Hüllen
  const kombiGroups = {};
  for (const r of allRes) {
    if (!kombiGroups[r.kombiKey]) kombiGroups[r.kombiKey] = [];
    kombiGroups[r.kombiKey].push(r);
  }

  // Daten-Bereiche
  let minWgk = Infinity, maxWgk = -Infinity, minCo2 = Infinity, maxCo2 = -Infinity, minInv = Infinity, maxInv = -Infinity;
  for (const r of allRes) {
    if (r.kw.wgk < minWgk) minWgk = r.kw.wgk;
    if (r.kw.wgk > maxWgk) maxWgk = r.kw.wgk;
    if (r.kw.co2ta < minCo2) minCo2 = r.kw.co2ta;
    if (r.kw.co2ta > maxCo2) maxCo2 = r.kw.co2ta;
    const inv = (r.kw.investGesamt || 0) / 1000;
    if (inv < minInv) minInv = inv;
    if (inv > maxInv) maxInv = inv;
  }
  const wgkR = Math.max(0.1, maxWgk - minWgk), co2R = Math.max(0.1, maxCo2 - minCo2), invR = Math.max(0.1, maxInv - minInv);
  minWgk -= wgkR * 0.05; maxWgk += wgkR * 0.05;
  minCo2 -= co2R * 0.05; maxCo2 += co2R * 0.05;
  minInv -= invR * 0.05; maxInv += invR * 0.05;

  // Top 3
  // Hervorgehoben werden die endgültigen Plätze (nach Feinsuche und Nachrechnung), nicht die Grobsuche
  const top3Final = Array.isArray(window._optTop3Final) && window._optTop3Final.length ? window._optTop3Final : null;
  const top3 = top3Final || allRes.slice().sort((a, b) => a.score - b.score).slice(0, 3);
  const top3Set = top3Final ? new Set() : new Set(top3.map(r => r.kombiKey + '|' + r.score));

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:absolute;display:none;background:#1a1d26;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;font-size:9px;color:#cfd8dc;pointer-events:none;z-index:999;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.5);line-height:1.5;';
  wrap.appendChild(tooltip);

  // Kompakte Legende: einzelne Erzeugertypen, klickbar als Filter
  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px 6px;font-size:9px;margin-top:6px;';
  allGenKeys.forEach(k => {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;cursor:pointer;transition:.15s;background:rgba(255,255,255,0.05);border:1px solid transparent;user-select:none;';
    chip.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + genColors[k] + ';flex-shrink:0;"></span>' + _fullName(k);
    chip.dataset.key = k;
    chip.addEventListener('click', () => {
      if (activeFilter === k) {
        activeFilter = null;
        legendDiv.querySelectorAll('span[data-key]').forEach(s => { s.style.opacity = '1'; s.style.borderColor = 'transparent'; });
      } else {
        activeFilter = k;
        legendDiv.querySelectorAll('span[data-key]').forEach(s => {
          const match = s.dataset.key === k;
          s.style.opacity = match ? '1' : '0.35';
          s.style.borderColor = match ? genColors[k] : 'transparent';
        });
      }
      render();
    });
    legendDiv.appendChild(chip);
  });
  wrap.appendChild(legendDiv);

  // Hinweis
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:8px;color:rgba(255,255,255,0.25);margin-top:3px;';
  hint.textContent = 'Klick auf Erzeuger = Filter \u2022 Hover = Details';
  wrap.appendChild(hint);

  // ── Render-Engine ──
  function render() {
    const W = canvas.offsetWidth || 460;
    const H = is3D ? 320 : 260;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (is3D) render3D(ctx, W, H); else render2D(ctx, W, H);
  }

  function pointColor(r) { return genColors[r.keys[0]] || '#aaa'; }

  function render2D(ctx, W, H) {
    const PAD = { l: 52, r: 16, t: 16, b: 34 };
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    const xOf = wgk => PAD.l + (wgk - minWgk) / (maxWgk - minWgk) * pw;
    const yOf = co2 => PAD.t + ph - (co2 - minCo2) / (maxCo2 - minCo2) * ph;

    // Gitter
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = PAD.t + ph - ph * i / 4;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const x = PAD.l + pw * i / 5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
    }

    // Achsen
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + ph); ctx.lineTo(PAD.l + pw, PAD.t + ph); ctx.stroke();

    // Achsen-Beschriftung
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px "DM Sans",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('WGK (ct/kWh)', PAD.l + pw / 2, H - 4);
    ctx.save(); ctx.translate(13, PAD.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('CO\u2082 (t/a)', 0, 0); ctx.restore();

    // Ticks
    ctx.font = '8px "DM Mono",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 5; i++) {
      const v = minWgk + (maxWgk - minWgk) * i / 5;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), xOf(v), PAD.t + ph + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = minCo2 + (maxCo2 - minCo2) * i / 4;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(Math.round(v).toLocaleString('de-DE'), PAD.l - 5, yOf(v));
    }

    // Punkte
    for (const r of allRes) {
      const x = xOf(r.kw.wgk), y = yOf(r.kw.co2ta);
      const isTop = top3Set.has(r.kombiKey + '|' + r.score);
      const match = !activeFilter || r.keys.includes(activeFilter);
      ctx.beginPath(); ctx.arc(x, y, isTop ? 5.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = pointColor(r);
      ctx.globalAlpha = match ? (isTop ? 0.95 : 0.5) : 0.06;
      ctx.fill();
      if (isTop) {
        ctx.globalAlpha = match ? 1 : 0.15;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Top-3: Markierung mit Platzziffer (Platz = Reihenfolge der Ergebniskarten); Text versetzt, damit nahe Punkte lesbar bleiben
    ctx.font = '10px "DM Sans",sans-serif'; ctx.textBaseline = 'middle';
    top3.forEach((r, i) => {
      const x = xOf(r.kw.wgk), y = yOf(r.kw.co2ta);
      if (top3Final) {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = pointColor(r); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.font = 'bold 9px "DM Sans",sans-serif';
        ctx.fillText(String(i + 1), x, y + 0.5);
        ctx.font = '10px "DM Sans",sans-serif';
      }
      const txt = (i + 1) + '. ' + (r.anzeigeKeys || r.keys).map(k => _fullName(k)).join(' + ');
      const truncTxt = txt.length > 34 ? txt.slice(0, 32) + '\u2026' : txt;
      const rechts = x > PAD.l + pw * 0.7;
      ctx.textAlign = rechts ? 'right' : 'left';
      const ty = y - 14 - i * 13;
      const tx = x + (rechts ? -12 : 12);
      const tw = ctx.measureText(truncTxt).width;
      ctx.fillStyle = 'rgba(15,17,23,0.8)';
      ctx.fillRect(rechts ? tx - tw - 3 : tx - 3, ty - 7, tw + 6, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(truncTxt, tx, ty);
    });

    canvas._proj = allRes.map(r => ({ x: xOf(r.kw.wgk), y: yOf(r.kw.co2ta), r }));
  }

  function render3D(ctx, W, H) {
    const cx = W / 2, cy = H / 2 + 10;
    const sc = Math.min(W, H) * 0.30 * zoom3D;
    const norm = (v, mn, mx) => (v - mn) / (mx - mn) * 2 - 1;
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX), cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

    function proj(wgk, co2, inv) {
      let x = norm(wgk, minWgk, maxWgk), y = norm(inv, minInv, maxInv), z = norm(co2, minCo2, maxCo2);
      const x1 = x * cosZ - y * sinZ, y1 = x * sinZ + y * cosZ;
      const z1 = z * cosX - y1 * sinX, y2 = z * sinX + y1 * cosX;
      return { px: cx + x1 * sc, py: cy - y2 * sc, depth: z1 };
    }

    // Boden-Gitter (WGK x Invest bei minCo2)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const wgk = minWgk + (maxWgk - minWgk) * i / 5;
      const a = proj(wgk, minCo2, minInv), b = proj(wgk, minCo2, maxInv);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      const inv = minInv + (maxInv - minInv) * i / 5;
      const c = proj(minWgk, minCo2, inv), d = proj(maxWgk, minCo2, inv);
      ctx.beginPath(); ctx.moveTo(c.px, c.py); ctx.lineTo(d.px, d.py); ctx.stroke();
    }

    // Achsen
    const axes = [
      { f: [minWgk, minCo2, minInv], t: [maxWgk, minCo2, minInv], lbl: 'WGK (ct/kWh)', c: 'rgba(255,183,77,0.6)' },
      { f: [minWgk, minCo2, minInv], t: [minWgk, minCo2, maxInv], lbl: 'Invest (k\u20ac)', c: 'rgba(79,195,247,0.6)' },
      { f: [minWgk, minCo2, minInv], t: [minWgk, maxCo2, minInv], lbl: 'CO\u2082 (t/a)', c: 'rgba(129,199,132,0.6)' },
    ];
    for (const ax of axes) {
      const p0 = proj(ax.f[0], ax.f[1], ax.f[2]), p1 = proj(ax.t[0], ax.t[1], ax.t[2]);
      ctx.strokeStyle = ax.c; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p0.px, p0.py); ctx.lineTo(p1.px, p1.py); ctx.stroke();
      // Pfeilspitze
      const dx = p1.px - p0.px, dy = p1.py - p0.py, len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const ux = dx / len, uy = dy / len;
        ctx.fillStyle = ax.c;
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p1.px - ux * 6 + uy * 3, p1.py - uy * 6 - ux * 3);
        ctx.lineTo(p1.px - ux * 6 - uy * 3, p1.py - uy * 6 + ux * 3);
        ctx.fill();
      }
      // Label
      ctx.fillStyle = ax.c; ctx.font = '9px "DM Sans",sans-serif'; ctx.textAlign = 'center';
      const lx = len > 0 ? p1.px + (dx / len) * 16 : p1.px;
      const ly = len > 0 ? p1.py + (dy / len) * 16 : p1.py;
      ctx.fillText(ax.lbl, lx, ly);
    }

    // Achsen-Ticks (Enden)
    ctx.font = '7px "DM Mono",monospace'; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    const tw0 = proj(minWgk, minCo2, minInv), tw1 = proj(maxWgk, minCo2, minInv);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(minWgk.toFixed(1), tw0.px, tw0.py + 4);
    ctx.fillText(maxWgk.toFixed(1), tw1.px, tw1.py + 4);
    const tc1 = proj(minWgk, maxCo2, minInv);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(maxCo2.toFixed(0), tc1.px - 4, tc1.py);
    const ti1 = proj(minWgk, minCo2, maxInv);
    ctx.textAlign = 'left';
    ctx.fillText(maxInv.toFixed(0) + 'k', ti1.px + 4, ti1.py);

    // Alle Punkte projizieren
    const pts = allRes.map(r => {
      const inv = (r.kw.investGesamt || 0) / 1000;
      const p = proj(r.kw.wgk, r.kw.co2ta, inv);
      return { ...p, r };
    });

    // Kombinations-Hüllen zeichnen (vor Punkten, damit Punkte drüber liegen)
    if (showHulls) {
      const hullGroups = {};
      for (const pt of pts) {
        const kk = pt.r.kombiKey;
        if (!hullGroups[kk]) hullGroups[kk] = [];
        hullGroups[kk].push(pt);
      }
      // Hüllen nach mittlerer Tiefe sortieren (hintere zuerst)
      const hullEntries = Object.entries(hullGroups)
        .filter(([, arr]) => arr.length >= 3)
        .map(([kk, arr]) => {
          const avgDepth = arr.reduce((s, p) => s + p.depth, 0) / arr.length;
          return { kk, arr, avgDepth };
        })
        .sort((a, b) => a.avgDepth - b.avgDepth);

      for (const { kk, arr } of hullEntries) {
        const match = !activeFilter || arr[0].r.keys.includes(activeFilter);
        const hull = convexHull(arr);
        if (hull.length < 3) continue;
        const color = pointColor(arr[0].r);
        ctx.beginPath();
        ctx.moveTo(hull[0].px, hull[0].py);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].px, hull[i].py);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = match ? 0.08 : 0.01;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = match ? 0.8 : 0.3;
        ctx.globalAlpha = match ? 0.25 : 0.03;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Punkte (depth-sortiert: hinten zuerst)
    pts.sort((a, b) => a.depth - b.depth);

    for (const pt of pts) {
      const r = pt.r;
      const isTop = top3Set.has(r.kombiKey + '|' + r.score);
      const match = !activeFilter || r.keys.includes(activeFilter);
      const df = 0.35 + 0.65 * ((pt.depth + 1) / 2);
      const rad = isTop ? 5 : 1.5 + df * 1.5;
      ctx.beginPath(); ctx.arc(pt.px, pt.py, rad, 0, Math.PI * 2);
      ctx.fillStyle = pointColor(r);
      ctx.globalAlpha = match ? (isTop ? 0.95 : 0.2 + df * 0.35) : 0.04;
      ctx.fill();
      if (isTop) {
        ctx.globalAlpha = match ? 1 : 0.15;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    canvas._proj = pts.map(p => ({ x: p.px, y: p.py, r: p.r }));

    // Dreh-Hinweis
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '8px "DM Sans",sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('\u21BB Ziehen zum Drehen', W - 8, H - 6);
  }

  // Toggle 2D/3D
  toggleBtn.addEventListener('click', () => {
    is3D = !is3D;
    toggleBtn.textContent = is3D ? '\u25A3 2D' : '\u25C8 3D';
    hullBtn.style.display = is3D ? 'inline-block' : 'none';
    lbl.textContent = 'Alle getesteten Konfigurationen (' + allRes.length + ') \u2014 ' + (is3D ? 'WGK vs. CO\u2082 vs. Invest' : 'WGK vs. CO\u2082');
    canvas.style.cursor = is3D ? 'grab' : 'crosshair';
    hint.textContent = is3D ? 'Ziehen = Drehen \u2022 Scrollen = Zoom \u2022 Klick auf Erzeuger = Filter' : 'Klick auf Erzeuger = Filter \u2022 Hover = Details';
    render();
  });

  // Toggle Flächen
  hullBtn.addEventListener('click', () => {
    showHulls = !showHulls;
    hullBtn.textContent = showHulls ? '\u25A7 Fl\u00e4chen' : '\u25A1 Fl\u00e4chen';
    render();
  });

  // 3D Maus-Rotation
  canvas.addEventListener('mousedown', e => {
    if (!is3D) return;
    dragging = true; dragSX = e.clientX; dragSY = e.clientY; dragSRX = rotX; dragSRZ = rotZ;
    canvas.style.cursor = 'grabbing';
  });
  const onMove3D = e => {
    if (!dragging) return;
    rotZ = dragSRZ + (e.clientX - dragSX) * 0.007;
    rotX = Math.max(-1.2, Math.min(0.3, dragSRX + (e.clientY - dragSY) * 0.007));
    render();
  };
  const onUp3D = () => { if (dragging) { dragging = false; canvas.style.cursor = is3D ? 'grab' : 'crosshair'; } };
  window.addEventListener('mousemove', onMove3D);
  window.addEventListener('mouseup', onUp3D);

  // Zoom per Mausrad (nur 3D)
  canvas.addEventListener('wheel', e => {
    if (!is3D) return;
    e.preventDefault();
    zoom3D *= e.deltaY < 0 ? 1.08 : 0.92;
    zoom3D = Math.max(0.3, Math.min(4.0, zoom3D));
    render();
  }, { passive: false });

  // Tooltip
  canvas.addEventListener('mousemove', function(e) {
    if (dragging) { tooltip.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - rect.left) * (canvas.width / dpr) / rect.width / dpr;
    const my = (e.clientY - rect.top) * (canvas.height / dpr) / rect.height / dpr;
    const proj = canvas._proj;
    if (!proj) return;
    let nearest = null, nearDist = 14;
    for (const p of proj) {
      const dx = p.x - mx, dy = p.y - my, d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearDist) { nearDist = d; nearest = p.r; }
    }
    if (nearest) {
      const names = nearest.keys.map(k => _fullName(k)).join(' + ');
      const inv = (nearest.kw.investGesamt / 1000).toFixed(0);
      tooltip.innerHTML = '<b style="color:#fff;">' + names + '</b><br>'
        + 'WGK: <b>' + nearest.kw.wgk.toFixed(2) + '</b> ct/kWh \u00b7 CO\u2082: <b>' + nearest.kw.co2ta.toFixed(1) + '</b> t/a<br>'
        + 'EE: ' + nearest.kw.eeAnteil.toFixed(0) + '% \u00b7 Invest: ' + inv + ' k\u20ac'
        + (nearest.tsVol > 0 ? ' \u00b7 WS: ' + nearest.tsVol + ' m\u00b3' : '')
        + (nearest.stM2 > 0 ? ' \u00b7 ST: ' + nearest.stM2 + ' m\u00b2' : '');
      tooltip.style.display = 'block';
      const ttX = e.clientX - rect.left + 14;
      const ttMaxX = rect.width - 220;
      tooltip.style.left = Math.min(ttX, ttMaxX) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  // Initial
  render();
}
