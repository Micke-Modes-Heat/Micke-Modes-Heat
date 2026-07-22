// ── 10d-optimizer-worker.js — Worker-Code-Template, _doRunOptimierung (Fallback), Ergebnis-Charts ──
import { globalYear } from './01-globals-varianten.js';
import { aggregateGebStrom } from './02b-gebaeude.js';
import { escHtml } from './03c-gebaeude-io.js';
import { _autoSpeicherVolumen, makeStProfile8760 } from './06b-gl-berechnen.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { _findOptPvBatMain, _optDispatch8760, _optGetScaledLastgang, _optKennwerte2, _optPvBatSim8760, _optScore, _readGuetegrad } from './10a-optimizer-core.js';
import { _optAborted } from './10b-hourly-live.js';
import { _optFinished } from './10e-optimizer-session.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { OPT_MERIT_ORDER } from './config/optimizer-defaults.js';
import { _dispatchCore } from './06c-dispatch-core.js';
import { _calcKostenShared } from './07b-analysis-economics.js';
import { pvBatteryStep } from './lib/pv-battery-core.js';
import { estimateBatteryAging } from './lib/battery-aging.js';

export function _buildOptWorkerCode() {
  return `
'use strict';
// ═══ Web Worker: Optimierungsberechnung (DOM-frei) ═══

let D; // DOM-Parameter (wird via postMessage empfangen)
let QH = null; // Quartier-Stromlastgang — von onmessage gesetzt, von kennwerte() gelesen

${pvBatteryStep.toString()}
${estimateBatteryAging.toString()}

function _annF(z, n) {
  if (z <= 0 || n <= 0) return n > 0 ? 1 / n : 1;
  return z * Math.pow(1 + z, n) / (Math.pow(1 + z, n) - 1);
}

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

function _investProKw(key, kw) {
  const pts = D.investKurven[key];
  if (pts && pts.length > 0) {
    // Lineare Interpolation aus vorberechneten Punkten
    if (kw <= pts[0].kw) return pts[0].eurKw > 0 ? pts[0].eurKw : D.OPT_INVEST_DEFAULT[key] || 200;
    for (let i = 0; i < pts.length - 1; i++) {
      if (kw >= pts[i].kw && kw <= pts[i+1].kw) {
        const t = (kw - pts[i].kw) / (pts[i+1].kw - pts[i].kw);
        const v = pts[i].eurKw + t * (pts[i+1].eurKw - pts[i].eurKw);
        return v > 0 ? v : D.OPT_INVEST_DEFAULT[key] || 200;
      }
    }
    const last = pts[pts.length-1];
    return last.eurKw > 0 ? last.eurKw : D.OPT_INVEST_DEFAULT[key] || 200;
  }
  return D.OPT_INVEST_DEFAULT[key] || 200;
}

function _pvInvestPerKwp(kwp) {
  const tab = D.pvInvestTabelle;
  if (kwp <= 0 || kwp <= tab[0].kwp) return tab[0].eurKwp;
  if (kwp >= tab[tab.length-1].kwp) return tab[tab.length-1].eurKwp;
  for (let i = 0; i < tab.length - 1; i++) {
    if (kwp >= tab[i].kwp && kwp <= tab[i+1].kwp) {
      const t = (kwp - tab[i].kwp) / (tab[i+1].kwp - tab[i].kwp);
      return Math.round(tab[i].eurKwp + t * (tab[i+1].eurKwp - tab[i].eurKwp));
    }
  }
  return tab[tab.length-1].eurKwp;
}

// ── Gemeinsame Kostenberechnung (eingebettet aus Main-Thread) ──
` + _calcKostenShared.toString() + `

// ── Dispatch-Kern (eingebettet aus Main-Thread) ──
` + _dispatchCore.toString() + `

function dispatch8760(lastgangKw, tempH, vlH, erzeugerList, optSpeicherVol, stExcessH) {
  // Speicher-Parameter aus Worker-Config aufbauen
  let thSp = null;
  if (typeof optSpeicherVol === 'number' && optSpeicherVol > 0) {
    thSp = { kapKwh: optSpeicherVol * 1.16 * D.tsDt, verlustRate: D.tsVerlust / 100, entladeKw: D.tsEntladeKw, ladeKw: D.tsLadeKw ?? D.tsEntladeKw };
  }

  // Typ + Gütegrad sicherstellen (makeErzObj setzt typ, aber Sicherheit)
  for (const erz of erzeugerList) {
    if (!erz.typ) erz.typ = D.ERZEUGER_TYP[erz.key] || 'fix';
    if (!erz.guetegrad) erz.guetegrad = _defaultGuetegrad(erz.key);
  }

  // Einheitlichen Dispatch-Kern aufrufen
  const r = _dispatchCore({
    lastgangKw, tempH, vlH,
    erzList: erzeugerList,
    speicherParams: thSp,
    stProfile: null,
    stExcessH: stExcessH,
    bhkwSigma: D.bhkwSkz, skEta: D.skEta, lwwpMinCop: D.lwwpMinCop,
    quelleTemp: _quelleTemp,
    recordHourly: false,
    backupMode: true,
  });

  // Ergebnisse in Erzeuger-Objekte übertragen
  for (const erz of erzeugerList) {
    erz.waermeMwh = (r.thKwh[erz.key] || 0) / 1000;
    erz.elMwh = (r.elKwh[erz.key] || 0) / 1000;
  }
  // Backup-Kessel: leistKw auf tatsächlichen Peak anheben
  const _backupErz = erzeugerList.length > 0 ? erzeugerList[erzeugerList.length - 1] : null;
  if (_backupErz && r.backupPeakKw > _backupErz.leistKw) {
    _backupErz.leistKw = Math.ceil(r.backupPeakKw);
  }

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

function pvBatSim8760(pvKwp, batKwh, demandH, bhkwElH, pvProfile, dispResult) {
  const hasBhkw = bhkwElH && bhkwElH.some(v => v > 0);
  if (pvKwp <= 0 && !hasBhkw) {
    let sumDem = 0;
    for (let t = 0; t < 8760; t++) sumDem += demandH[t];
    return { eigenMwh: 0, einspeiseMwh: 0, netzbezugMwh: sumDem / 1000,
             pvEigenMwh: 0, pvEinspMwh: 0, bhkwEigenMwh: 0, bhkwEinspMwh: 0 };
  }
  const spez = D.pvSpez;
  const batLeistKw = batKwh > 0 ? batKwh / 2 : 0;
  let sv = 0, ins = 0, bez = 0, soc = 0;
  let pvEig = 0, pvEinsp = 0, bhkwEig = 0, bhkwEinsp = 0;
  let tsSoc = 0, pvWpSpGes = 0, batDischargeKwh = 0;
  for (let t = 0; t < 8760; t++) {
    const dem = demandH[t];
    const pvGen = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const bhkwGen = bhkwElH ? bhkwElH[t] : 0;
    const step = pvBatteryStep({demand:dem,pvGen,bhkwGen,socKwh:soc,capacityKwh:batKwh,powerKw:batLeistKw,etaCharge:1,etaDischarge:.9});
    const dsc = step.direct;
    const pvFrac = step.pvFraction;
    let rDem = step.residualDemand, rGen = step.residualGeneration;
    soc = step.socKwh;
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

    const evThisH = (dsc + (dem - dsc - rDem)) / 1000;
    sv += dsc + (dem - dsc - rDem); ins += rGen; bez += rDem;
    pvEig += evThisH * pvFrac + pvWpSp;
    bhkwEig += evThisH * (1 - pvFrac);
    pvEinsp += (rGen / 1000) * pvFrac;
    bhkwEinsp += (rGen / 1000) * (1 - pvFrac);
  }
  return { eigenMwh: sv / 1000 + pvWpSpGes, einspeiseMwh: ins / 1000, netzbezugMwh: bez / 1000,
           pvEigenMwh: pvEig, pvEinspMwh: pvEinsp, bhkwEigenMwh: bhkwEig, bhkwEinspMwh: bhkwEinsp,
           pvWpSpeicherMwh: pvWpSpGes, batDischargeMwh:batDischargeKwh/1000 };
}

// _calcBausteinKostenW ENTFERNT — nutzt jetzt _calcKostenShared

function kennwerte(dispR, pvKwp, batKwh, pvBatR, params, stMwh, stM2, optSpeicherVol) {
  const { erzeugerList, autoGkMwh, autoGkPeakKw, gesamtMwh } = dispR;
  const { pStrom, pStromWp, pGas, pPk, pHhs, pHko, pFw, pEinsp, pBhkwEinsp, pBhkwKwkE, pBhkwKwkEig, zinssatz } = params;

  // pKw aus erzeugerList
  const _bPKw = {};
  for (const erz of erzeugerList) _bPKw[erz.key] = erz.leistKw;

  // erzList mit typ-Info für _calcKostenShared
  const erzListTyped = erzeugerList.map(erz => ({
    key: erz.key, waermeMwh: erz.waermeMwh, elMwh: erz.elMwh,
    typ: D.ERZEUGER_TYP[erz.key]
  }));

  // Quartier-Strom
  let quartierStromMwh = 0;
  if (QH) { for (let t = 0; t < 8760; t++) quartierStromMwh += QH[t]; quartierStromMwh /= 1000; }

  // PV-Daten
  const pvEigenMwh = pvBatR ? (pvBatR.pvEigenMwh != null ? pvBatR.pvEigenMwh : pvBatR.eigenMwh) : 0;
  const pvEinspMwh = pvBatR ? (pvBatR.pvEinspMwh != null ? pvBatR.pvEinspMwh : pvBatR.einspeiseMwh) : 0;
  const gesamtEigenMwh = pvBatR ? (pvBatR.eigenMwh || 0) : 0;

  // BHKW-Erlös-Daten
  const bhkwEigMwh = pvBatR ? (pvBatR.bhkwEigenMwh || 0) : 0;
  const bhkwEinspMwh = pvBatR ? (pvBatR.bhkwEinspMwh || 0) : 0;
  const bhkwStromErloes = bhkwEigMwh * (pStrom + (pBhkwKwkEig || 4)) * 10
    + bhkwEinspMwh * ((pBhkwEinsp || 8) + (pBhkwKwkE || 8)) * 10;

  // Dynamische Bohrmeter für Geo
  let _dynBohrMeter = D.bohrMeter || 0;
  const _geoErz = erzeugerList.find(e => e.key === 'geo');
  if (_geoErz && _geoErz.leistKw > 0) {
    const _geoJaz = (_geoErz.elMwh > 0) ? _geoErz.waermeMwh / _geoErz.elMwh : 4.0;
    const _geoTiefe = D.geoTiefe || 100;
    const _geoQPerM = D.geoQPerM || 31;
    const _erdwaermeKw = _geoErz.leistKw * (_geoJaz - 1) / _geoJaz;
    const _proSondeKw = _geoQPerM * _geoTiefe / 1000;
    const _nLeistung = Math.max(1, Math.ceil(_erdwaermeKw / _proSondeKw));
    let _nEnergie = 1;
    if (_geoErz.waermeMwh > 0) {
      const _maxEntzugProSondeKwh = _proSondeKw * 2100;
      const _erdwaermeKwh = _geoErz.waermeMwh * 1000 * (_geoJaz - 1) / _geoJaz;
      _nEnergie = Math.max(1, Math.ceil(_erdwaermeKwh / _maxEntzugProSondeKwh));
    }
    _dynBohrMeter = Math.max(_nLeistung, _nEnergie) * _geoTiefe;
  }

  // PV-Invest
  const pvInvPerKwp = D.pvInvestMode === 'auto' ? _pvInvestPerKwp(pvKwp) : D.pvInvestManual;
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
      stM2: (stMwh || 0) > 0 ? (stM2 || 0) : 0,
      optSpeicherVol: optSpeicherVol || 0,
      tsTyp: D.tsTyp, tsDt: D.tsDt,
    },
    pv: {
      kwp: pvKwp, batKwh: batKwh,
      eigenMwh: pvEigenMwh, einspMwh: pvEinspMwh,
      gesamtEigenMwh: gesamtEigenMwh,
      invPerKwp: pvInvPerKwp,
      batInvPerKwh: D.batInvest,
      batLifeYears: batAging && Number.isFinite(batAging.expectedLifeYears) ? Math.max(1,batAging.expectedLifeYears) : 15,
      vergModell: D.pvVergModell || 'teil',
      pEinsp: pEinsp,
    },
    strom: {
      quartierMwh: quartierStromMwh,
      bhkwEigenMwh: bhkwEigMwh, bhkwEinspMwh: bhkwEinspMwh,
      bhkwStromErloes: bhkwStromErloes,
      pBhkwEinsp: pBhkwEinsp, pBhkwKwkE: pBhkwKwkE, pBhkwKwkEig: pBhkwKwkEig,
    },
    co2: {
      pCo2: D.pCo2 || 0,
      alleET: true,
      emf: { gas: D.gasEmF, heizoel: D.heizoelEmF, pellets: D.pelletsEmF, hhs: D.hhsEmF, fernwaerme: D.fernwaermeEmF, strom: D.stromEmF },
    },
    gesamtMwh: gesamtMwh,
    stMwh: stMwh || 0,
  });

  const pvErtragMwh = pvKwp * D.pvSpez / 1000;

  return { wgk: result.wgk, co2ta: result.co2ta, eeAnteil: result.eeAnteil,
    stromAutarkie: result.stromAutarkie, waermeAutarkie: result.waermeAutarkie,
    investGesamt: result.investGesamt, jahreskosten: result.jahreskosten,
    pvEigenMwh: pvEigenMwh, pvErtragMwh: pvErtragMwh,
    _dbg: { kapitalJk: result.kapitalJk, energieJk: result.energieJk, totalWaerme: result.totalWaerme,
      gesamtMwh, stMwh: stMwh || 0, nGeb: D.nGeb, netzInvest: D.netzInvest,
      basisInvest: result.investGesamt, autoGkMwh, autoGkPeakKw,
      erzList: erzeugerList.map(e => e.key + ':' + e.leistKw.toFixed(0) + 'kW/' + e.waermeMwh.toFixed(1) + 'MWh').join(', ') } };
}

function score(kw, ziel) {
  if (ziel === 'min-wgk') return kw.wgk;
  if (ziel === 'min-co2') return kw.co2ta;
  if (ziel === 'max-autarkie') return -(kw.stromAutarkie + kw.waermeAutarkie);
  if (ziel === 'min-kosten-ee') return kw.eeAnteil >= 65 ? kw.wgk : 1e9 + kw.wgk;
  return kw.wgk;
}

// ── PV+Bat Dimensionierung per marginaler Amortisation ──
// Für jede Bat-Stufe: PV schrittweise vergrößern, bis Amortisation > Schwellwert.
// Dann beste PV+Bat-Kombi per Score auswählen.
function _findOptPvBat(pvSteps, batSteps, demandH, bhkwElH, pvProfile, disp,
                       params, stMwh, stM2, tsVol, ziel, maxAmortJ, simFn, kwFn) {
  const pStrom = params.pStrom;
  // Einspeisevergütung effektiv (abhängig von PV-Größe + Modell)
  function einspeiseCtKwh(pvKwp) {
    const mod = D.pvVergModell || 'teil';
    if (mod === 'teil') return pvKwp <= 0 ? 8.1 : (Math.min(pvKwp,10)*8.1 + Math.max(0,Math.min(pvKwp,40)-10)*7.0 + Math.max(0,pvKwp-40)*5.7) / pvKwp;
    if (mod === 'voll') return pvKwp <= 0 ? 12.9 : (Math.min(pvKwp,10)*12.9 + Math.max(0,pvKwp-10)*10.8) / pvKwp;
    return params.pEinsp || 8;
  }
  function pvInvPerKwp(kwp) {
    if (typeof _pvInvestPerKwp === 'function') return _pvInvestPerKwp(kwp);
    return D.pvInvestManual || 1200;
  }

  let bestPv = 0, bestBat = 0, bestScore = Infinity, bestKw = null;

  // Immer PV=0 testen (Variante ohne PV)
  const pvBat0 = simFn(0, 0, demandH, bhkwElH, pvProfile, disp);
  const kw0 = kwFn(disp, 0, 0, pvBat0, params, stMwh, stM2, tsVol);
  const sc0 = score(kw0, ziel);
  if (sc0 < bestScore) { bestScore = sc0; bestPv = 0; bestBat = 0; bestKw = kw0; }

  for (const batK of batSteps) {
    // Cache: PV-Ergebnisse für diese Bat-Stufe, aufsteigend nach PV-Größe
    let prevEigen = 0, prevEinsp = 0, prevPvK = 0;
    const batInvest = batK * (D.batInvest || 400);

    for (let pi = 0; pi < pvSteps.length; pi++) {
      const pvK = pvSteps[pi];
      if (pvK <= 0) continue;

      const pvBat = simFn(pvK, batK, demandH, bhkwElH, pvProfile, disp);
      const curEigen = pvBat.pvEigenMwh || 0;  // MWh
      const curEinsp = pvBat.pvEinspMwh || 0;  // MWh

      // Marginale Amortisation dieses PV-Inkrements
      const deltaPvInvest = (pvK - prevPvK) * pvInvPerKwp(pvK);
      // Beim ersten PV-Schritt: Batterie-Invest mit einrechnen
      const deltaInvest = deltaPvInvest + (pi === 0 ? batInvest : 0);

      const deltaEigen = curEigen - prevEigen;  // MWh zusätzlicher Eigenverbrauch
      const deltaEinsp = curEinsp - prevEinsp;  // MWh zusätzliche Einspeisung
      // Jährliche Ersparnis: Eigenverbrauch spart Netzbezug, Einspeisung bringt Vergütung
      const deltaSavings = deltaEigen * pStrom * 10 + deltaEinsp * einspeiseCtKwh(pvK) * 10;

      if (deltaSavings <= 0 || deltaInvest / deltaSavings > maxAmortJ) {
        // Dieses Inkrement lohnt sich nicht mehr → Stopp für diese Bat-Stufe
        break;
      }

      // Inkrement OK → kennwerte berechnen und als Kandidat merken
      const kw = kwFn(disp, pvK, batK, pvBat, params, stMwh, stM2, tsVol);
      const sc = score(kw, ziel);
      if (sc < bestScore) { bestScore = sc; bestPv = pvK; bestBat = batK; bestKw = kw; }

      prevEigen = curEigen; prevEinsp = curEinsp; prevPvK = pvK;
    }
  }
  return { pvKwp: bestPv, batKwh: bestBat, kw: bestKw, score: bestScore };
}

// ═══ Hauptlogik ═══
self.onmessage = function(e) {
  const data = e.data;
  D = data.dom;
  const { lastgangKw, tempH, vlH, pvProfile, stNormProfile, quartierH,
    params, aktiv, constraints, ziel, quality, pvAktiv, batAktiv, stAktiv, tsAktiv, globalYear } = data;
  QH = quartierH;

  let peak = 0;
  for (let i = 0; i < lastgangKw.length; i++) if (lastgangKw[i] > peak) peak = lastgangKw[i];
  if (peak < 1) peak = 1;

  // Kombinationen
  const _allKombis = [];
  for (let i = 0; i < aktiv.length; i++) _allKombis.push([aktiv[i]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++) _allKombis.push([aktiv[i], aktiv[j]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++)
      for (let k2 = j + 1; k2 < aktiv.length; k2++) _allKombis.push([aktiv[i], aktiv[j], aktiv[k2]]);

  // Gaskessel/Heizöl werden als reguläre Spitzenlastkessel in Kombinationen berücksichtigt
  const kombis = _allKombis;

  const Q = { schnell: { n: 5, pv: 2, bat: 1 }, standard: { n: 7, pv: 3, bat: 2 }, gruendlich: { n: 11, pv: 5, bat: 3 } }[quality];
  const nKand = aktiv.length;
  const GROB_N = Q.n;
  const grobPvN = nKand <= 4 ? Q.pv : nKand <= 6 ? Math.max(1, Q.pv - 1) : 1;
  const grobBatN = nKand <= 4 ? Q.bat : nKand <= 6 ? Math.max(1, Q.bat - 1) : 1;
  const GROB_STUFEN = Array.from({length: GROB_N}, (_, i) => Math.round(i / (GROB_N - 1) * 100) / 100);

  // PV/Bat Steps — dynamische Limits basierend auf Projektgröße
  const hatWP = aktiv.some(k => D.ERZEUGER_TYP[k] === 'wp');
  let gesamtStromSchaetz = 0;
  for (let t = 0; t < 8760; t++) gesamtStromSchaetz += quartierH[t];
  if (hatWP) gesamtStromSchaetz += peak * 0.25 * 8760 / 3.5;
  const gesamtStromSchaetzMwh = gesamtStromSchaetz / 1000;
  const pvMaxConstr = constraints.pv?.maxKw || 0;
  const pvMinConstr = constraints.pv?.minKw || 0;
  const batMaxConstr = constraints.bat?.maxKw || 0;
  // Dynamisch: 150% Strombedarf, min 100 kWp, max 2000 kWp (ohne explizite Obergrenze)
  let pvMaxSinnvoll = pvMaxConstr > 0 ? pvMaxConstr : Math.min(2000, Math.max(100, gesamtStromSchaetzMwh * 1000 / D.pvSpez * 1.5));
  // Dynamisch: 2 kWh/kWp oder Tages-Strombedarf, was größer ist
  const tagesStromKwh = gesamtStromSchaetzMwh * 1000 / 365;
  let batMax = batMaxConstr > 0 ? batMaxConstr : Math.max(Math.round(pvMaxSinnvoll * 2), Math.round(tagesStromKwh));

  let pvStepsGrob, batStepsGrob;
  if (grobPvN <= 1 || !pvAktiv) {
    const pvEst = pvAktiv ? Math.round(gesamtStromSchaetzMwh * 1000 / D.pvSpez * 0.7) : 0;
    pvStepsGrob = [pvEst];
    batStepsGrob = [pvEst > 0 && batAktiv ? Math.round(Math.min(pvEst * 0.3, batMax)) : 0];
  } else {
    pvStepsGrob = pvAktiv ? Array.from({length: grobPvN}, (_, i) => Math.round(pvMaxSinnvoll * i / (grobPvN - 1))) : [0];
    if (pvMinConstr > 0 && pvAktiv) pvStepsGrob = pvStepsGrob.filter(v => v >= pvMinConstr);
    batStepsGrob = batAktiv ? Array.from({length: grobBatN}, (_, i) => Math.round(batMax * i / Math.max(1, grobBatN - 1))) : [0];
  }

  // ST Steps
  let gesamtWaermeMwh = 0;
  for (let t = 0; t < 8760; t++) gesamtWaermeMwh += lastgangKw[t];
  gesamtWaermeMwh /= 1000;
  const stMinConstr = constraints.st?.minKw || 0;
  const stMaxConstr = constraints.st?.maxKw || 0;
  const stMaxSinnvoll = stMaxConstr > 0 ? stMaxConstr : Math.round(gesamtWaermeMwh * 0.4 * 1000 / D.stSpez);
  const grobStN = !stAktiv ? 1 : (nKand <= 4 ? 5 : nKand <= 6 ? 3 : 2);
  let stStepsGrob = stAktiv ? Array.from({length: grobStN}, (_, i) => Math.round(stMaxSinnvoll * i / (grobStN - 1))) : [0];
  if (stMinConstr > 0 && stAktiv) stStepsGrob = stStepsGrob.filter(v => v >= stMinConstr || v === 0);
  if (!stAktiv) stStepsGrob = [0];

  // TS Steps
  const tsMinConstr = constraints.ts?.minKw || 0;
  const tsMaxConstr = constraints.ts?.maxKw || 0;
  let tsStepsGrob;
  if (!tsAktiv) {
    tsStepsGrob = [0];
  } else {
    // Einfache Auto-Sizing im Worker (ohne DOM-Leistungswerte — verwende Peak-basierte Schätzung)
    const wpFrac = aktiv.filter(k => D.ERZEUGER_TYP[k] === 'wp').length > 0 ? 0.5 : 0;
    const estWpKw = peak * wpFrac;
    const tsAutoVol = estWpKw > 0 ? Math.round(estWpKw * 3 / (1.16 * D.tsDt)) : 50;
    const tsMaxVol = tsMaxConstr > 0 ? tsMaxConstr : Math.round(tsAutoVol * 3);
    const tsMinVol = tsMinConstr > 0 ? tsMinConstr : 0;
    const grobTsN = nKand <= 4 ? 5 : 3;
    tsStepsGrob = [0];
    for (let i = 1; i < grobTsN; i++) {
      const vol = Math.round(tsMinVol + (tsMaxVol - tsMinVol) * i / (grobTsN - 1));
      if (vol > 0 && !tsStepsGrob.includes(vol)) tsStepsGrob.push(vol);
    }
    if (tsMinConstr > 0) tsStepsGrob = tsStepsGrob.filter(v => v >= tsMinConstr || v === 0);
  }

  // ST Reduced Lastgang Helper — gibt auch ST-Überschuss zurück für Speicherbeladung
  function stReducedLastgang(stM2) {
    if (stM2 <= 0 || !stNormProfile) return { lastgang: lastgangKw, waermeMwh: 0, stExcessH: null };
    const reduced = new Float32Array(8760);
    const stExcessH = new Float32Array(8760);
    let sumKwh = 0;
    for (let t = 0; t < 8760; t++) {
      const stKw = stNormProfile[t] * stM2;
      const used = Math.min(stKw, lastgangKw[t]);
      reduced[t] = lastgangKw[t] - used;
      stExcessH[t] = stKw - used;
      sumKwh += used;
    }
    return { lastgang: reduced, waermeMwh: sumKwh / 1000, stExcessH };
  }

  // Config Batches aufbauen
  const configBatches = [];
  function makeErzObj(key, frac) {
    const con = constraints[key] || {};
    let kw = Math.round(frac * peak);
    if (con.minKw > 0 && (!con.bisJahr || con.bisJahr >= globalYear)) kw = Math.max(kw, con.minKw);
    if (con.maxKw > 0) kw = Math.min(kw, con.maxKw);
    kw = Math.max(1, kw);
    return { key, leistKw: kw, typ: D.ERZEUGER_TYP[key] || 'fix', guetegrad: D.guetegrade[key] || _defaultGuetegrad(key) };
  }
  function getConstrainedFracs(key) {
    const con = constraints[key] || {};
    const minFrac = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= globalYear) ? con.minKw / peak : 0;
    const maxFrac = con.maxKw > 0 ? con.maxKw / peak : 1.5;
    const fracs = [];
    for (const f of GROB_STUFEN) {
      if (f < minFrac - 0.02 || f > maxFrac + 0.02) continue;
      fracs.push(f);
    }
    if (fracs.length === 0) fracs.push(Math.max(minFrac, 0.08));
    return fracs;
  }

  for (const keys of kombis) {
    const sortedKeys = keys.slice().sort((a, b) => {
      const ia = D.OPT_MERIT_ORDER.indexOf(a);
      const ib = D.OPT_MERIT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const kombiKey = keys.slice().sort().join('+');
    const configs = [];
    if (sortedKeys.length === 1) {
      for (const f0 of getConstrainedFracs(sortedKeys[0])) { if (f0 < 0.01) continue; configs.push([makeErzObj(sortedKeys[0], f0)]); }
    } else if (sortedKeys.length === 2) {
      const fr0 = getConstrainedFracs(sortedKeys[0]), fr1 = getConstrainedFracs(sortedKeys[1]);
      for (const f0 of fr0) for (const f1 of fr1) { if (f0 + f1 < 0.05) continue; configs.push([makeErzObj(sortedKeys[0], f0), makeErzObj(sortedKeys[1], f1)]); }
    } else if (sortedKeys.length === 3) {
      const fr0 = getConstrainedFracs(sortedKeys[0]), fr1 = getConstrainedFracs(sortedKeys[1]), fr2 = getConstrainedFracs(sortedKeys[2]);
      for (const f0 of fr0) for (const f1 of fr1) for (const f2 of fr2) { if (f0 + f1 + f2 < 0.05) continue; configs.push([makeErzObj(sortedKeys[0], f0), makeErzObj(sortedKeys[1], f1), makeErzObj(sortedKeys[2], f2)]); }
    }
    configBatches.push({ kombiKey, keys: sortedKeys, sortedKeys, configs });
  }

  // ═══ Multi-Worker Modus: nur Grobsuche oder nur Feinsuche ═══
  const _mode = data.mode || 'full';
  const _workerIdx = data.workerIdx || 0;
  const _numWorkers = data.numWorkers || 1;

  // ═══ GROBSUCHE (wird im 'fein'-Modus übersprungen) ═══
  const grobResults = [];
  let _topNGrob = [];

  if (_mode !== 'fein') {
    // Arbeitspakete aufbauen (alle Kombinationen aus configs × ST × TS)
    let allWorkItems = [];
    for (const batch of configBatches) {
      for (const config of batch.configs) {
        for (const stM2 of stStepsGrob) {
          for (const tsVol of tsStepsGrob) {
            allWorkItems.push({ batch, config, stM2, tsVol });
          }
        }
      }
    }

    // Multi-Worker: nur eigenen Anteil bearbeiten
    if (_numWorkers > 1) {
      allWorkItems = allWorkItems.filter((_, i) => i % _numWorkers === _workerIdx);
    }
    const totalConfigs = allWorkItems.length;

    let doneConfigs = 0;
    let lastProgressAt = 0;

    for (const { batch, config, stM2, tsVol } of allWorkItems) {
      doneConfigs++;
      const { lastgang: lgForDisp, waermeMwh: stMwh, stExcessH } = stReducedLastgang(stM2);
      const disp = dispatch8760(lgForDisp, tempH, vlH, config.map(c => ({...c})), tsVol, stExcessH);

      // Mindestleistung: Jeder Erzeuger muss ≥10% der Spitzenleistung liefern
      const minKw = peak * 0.1;
      if (config.length > 1 && disp.erzeugerList.some(e => e.leistKw < minKw)) continue;

      const demandH = new Float32Array(8760);
      for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];

      const pvBatRes = _findOptPvBat(pvStepsGrob, batStepsGrob, demandH, disp.bhkwElH, pvProfile, disp,
        params, stMwh, stM2, tsVol, ziel, D.pvMaxAmort || 10, pvBatSim8760, kennwerte);
      if (pvBatRes.kw) {
        grobResults.push({ kombiKey: batch.kombiKey, keys: batch.keys, config,
          pvKwp: pvBatRes.pvKwp, batKwh: pvBatRes.batKwh, stM2, stMwh, tsVol, kw: pvBatRes.kw, score: pvBatRes.score });
      }

      const now = Date.now();
      if (now - lastProgressAt > 500) {
        lastProgressAt = now;
        const pct = Math.round(doneConfigs / totalConfigs * 100);
        // Aktuell beste 3 Varianten mitschicken (O(n)-Auswahl alle 500 ms)
        const best3 = [];
        for (const r of grobResults) {
          if (best3.length < 3) { best3.push(r); best3.sort((a, b) => a.score - b.score); }
          else if (r.score < best3[2].score) { best3[2] = r; best3.sort((a, b) => a.score - b.score); }
        }
        const best3Min = best3.map(r => ({
          kombiKey: r.kombiKey, score: r.score,
          wgk: r.kw ? r.kw.wgk : null,
          config: (r.config || []).map(c => ({ key: c.key, leistKw: c.leistKw })),
          pvKwp: r.pvKwp, batKwh: r.batKwh, stM2: r.stM2, tsVol: r.tsVol,
        }));
      self.postMessage({ type: 'progress', phase: 'Grobsuche', pct, done: doneConfigs, total: totalConfigs, workerIdx: _workerIdx, best3: best3Min });
    }
  }

    // Modus 'grob': nur Grobsuche, Ergebnisse zurücksenden und fertig
    if (_mode === 'grob') {
      self.postMessage({ type: 'grob_done', grobResults, workerIdx: _workerIdx });
      return;
    }

    // Deduplizierung (für 'full'-Modus)
    grobResults.sort((a, b) => a.score - b.score);
    const seen = new Set();
    const grobTop = [];
    for (const r of grobResults) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); grobTop.push(r); }
    }
    _topNGrob = grobTop.slice(0, 5);
  } // Ende: if (_mode !== 'fein')

  // topNGrob bestimmen: aus Grobsuche oder aus Message (fein-Modus)
  const topNGrob = (_mode === 'fein') ? (data.topNGrob || []) : _topNGrob;

  // ═══ FEINSUCHE ═══
  const FEIN_STEP = Math.max(1, Math.round(peak / 200));
  const topFein = [];

  for (let fi = 0; fi < topNGrob.length; fi++) {
    self.postMessage({ type: 'progress', phase: 'Feinsuche', pct: Math.round(fi / topNGrob.length * 100), done: fi, total: topNGrob.length });
    const grob = topNGrob[fi];
    let currentConfig = grob.config.map(c => ({...c}));
    let currentStM2 = grob.stM2 || 0;
    let currentTsVol = grob.tsVol || 0;
    const feinRange = Math.round(peak * 0.10);

    for (let runde = 0; runde < 2; runde++) {
      let changed = false;
      const { lastgang: lgFein, waermeMwh: stMwhFein, stExcessH: stExFein } = stReducedLastgang(currentStM2);

      for (let ei = 0; ei < currentConfig.length; ei++) {
        const erz = currentConfig[ei];
        const con = constraints[erz.key] || {};
        const minKwCon = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= globalYear) ? con.minKw : 1;
        const maxKwCon = con.maxKw > 0 ? con.maxKw : Math.round(peak * 1.2);
        const _minKwFein = currentConfig.length > 1 ? Math.round(peak * 0.1) : 1;
        const lo = Math.max(_minKwFein, minKwCon, erz.leistKw - feinRange);
        const hi = Math.min(maxKwCon, erz.leistKw + feinRange);
        let bestKwVal = erz.leistKw, bestScoreVal = Infinity;
        for (let kw = lo; kw <= hi; kw += FEIN_STEP) {
          const tc = currentConfig.map(c => ({...c}));
          tc[ei] = { ...erz, leistKw: kw };
          const disp = dispatch8760(lgFein, tempH, vlH, tc, currentTsVol, stExFein);
          const demH = new Float32Array(8760);
          for (let t = 0; t < 8760; t++) demH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
          const pvBat = pvBatSim8760(grob.pvKwp, grob.batKwh, demH, disp.bhkwElH, pvProfile, disp);
          const kwR = kennwerte(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhFein, currentStM2, currentTsVol);
          const sc = score(kwR, ziel);
          if (sc < bestScoreVal) { bestScoreVal = sc; bestKwVal = kw; }
        }
        if (bestKwVal !== erz.leistKw) changed = true;
        currentConfig[ei] = { ...erz, leistKw: bestKwVal };
      }

      // ST fein
      if (stAktiv && currentStM2 > 0) {
        const stLo = Math.max(stMinConstr, Math.round(currentStM2 * 0.8));
        const stHi = stMaxConstr > 0 ? Math.min(stMaxConstr, Math.round(currentStM2 * 1.2)) : Math.round(currentStM2 * 1.2);
        const stStep = Math.max(1, Math.round((stHi - stLo) / 10));
        let bestSt = currentStM2, bestStSc = Infinity;
        for (let sm2 = stLo; sm2 <= stHi; sm2 += stStep) {
          const { lastgang: lgSt, waermeMwh: mwh, stExcessH: stExSt } = stReducedLastgang(sm2);
          const disp = dispatch8760(lgSt, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExSt);
          const demH = new Float32Array(8760);
          for (let t = 0; t < 8760; t++) demH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
          const pvBat = pvBatSim8760(grob.pvKwp, grob.batKwh, demH, disp.bhkwElH, pvProfile, disp);
          const kwR = kennwerte(disp, grob.pvKwp, grob.batKwh, pvBat, params, mwh, sm2, currentTsVol);
          const sc = score(kwR, ziel);
          if (sc < bestStSc) { bestStSc = sc; bestSt = sm2; }
        }
        if (bestSt !== currentStM2) { changed = true; currentStM2 = bestSt; }
      }

      // TS fein
      if (tsAktiv && currentTsVol > 0) {
        const tsLo = Math.max(tsMinConstr, Math.round(currentTsVol * 0.7));
        const tsHi = tsMaxConstr > 0 ? Math.min(tsMaxConstr, Math.round(currentTsVol * 1.3)) : Math.round(currentTsVol * 1.3);
        const tsStep = Math.max(1, Math.round((tsHi - tsLo) / 8));
        let bestTs = currentTsVol, bestTsSc = Infinity;
        const { lastgang: lgTs, waermeMwh: mwhTs, stExcessH: stExTs } = stReducedLastgang(currentStM2);
        for (let tv = tsLo; tv <= tsHi; tv += tsStep) {
          const disp = dispatch8760(lgTs, tempH, vlH, currentConfig.map(c => ({...c})), tv, stExTs);
          const demH = new Float32Array(8760);
          for (let t = 0; t < 8760; t++) demH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
          const pvBat = pvBatSim8760(grob.pvKwp, grob.batKwh, demH, disp.bhkwElH, pvProfile, disp);
          const kwR = kennwerte(disp, grob.pvKwp, grob.batKwh, pvBat, params, mwhTs, currentStM2, tv);
          const sc = score(kwR, ziel);
          if (sc < bestTsSc) { bestTsSc = sc; bestTs = tv; }
        }
        if (bestTs !== currentTsVol) { changed = true; currentTsVol = bestTs; }
      }

      if (!changed) break;
    }

    // PV/Bat Volloptimierung mit Auto-Expand bei Rand-Optimum
    const { lastgang: lgFinal, waermeMwh: stMwhFinal, stExcessH: stExFinal } = stReducedLastgang(currentStM2);
    const finalDisp = dispatch8760(lgFinal, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExFinal);
    const demFinal = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) demFinal[t] = finalDisp.wpElH[t] + finalDisp.skElH[t] + quartierH[t];

    // PV/Bat Feinoptimierung per marginaler Amortisation (feinere Steps als Grobphase)
    const pvStepsFein = pvAktiv ? Array.from({length: 15}, (_, i) => Math.round(pvMaxSinnvoll * i / 14)) : [0];
    if (pvMinConstr > 0 && pvAktiv) { const f = pvStepsFein.filter(v => v >= pvMinConstr || v === 0); if (f.length > 0) { pvStepsFein.length = 0; f.forEach(v => pvStepsFein.push(v)); } }
    const batStepsFein = batAktiv ? Array.from({length: 8}, (_, i) => Math.round(batMax * i / 7)) : [0];

    const pvBatFein = _findOptPvBat(pvStepsFein, batStepsFein, demFinal, finalDisp.bhkwElH, pvProfile, finalDisp,
      params, stMwhFinal, currentStM2, currentTsVol, ziel, D.pvMaxAmort || 10, pvBatSim8760, kennwerte);
    const bestPv = pvBatFein.pvKwp, bestBat = pvBatFein.batKwh, bestScF = pvBatFein.score;

    const finalPvBat = pvBatSim8760(bestPv, bestBat, demFinal, finalDisp.bhkwElH, pvProfile, finalDisp);
    const finalKw = kennwerte(finalDisp, bestPv, bestBat, finalPvBat, params, stMwhFinal, currentStM2, currentTsVol);

    topFein.push({
      keys: grob.keys, config: currentConfig, pvKwp: bestPv, batKwh: bestBat,
      stM2: currentStM2, stMwh: stMwhFinal, tsVol: currentTsVol,
      kw: finalKw, gesamtMwh: finalDisp.gesamtMwh, autoGkMwh: finalDisp.autoGkMwh,
      autoGkPeakKw: finalDisp.autoGkPeakKw,
      erzWaermeMwh: finalDisp.erzeugerList.map(e => e.waermeMwh),
      erzLeistKw: finalDisp.erzeugerList.map(e => e.leistKw),
      erzElMwh: finalDisp.erzeugerList.map(e => e.elMwh),
      speicherEntladenMwh: finalDisp.speicherEntladenMwh || 0,
      pvBatData: finalPvBat ? { eigenMwh: finalPvBat.eigenMwh, einspeiseMwh: finalPvBat.einspeiseMwh,
        pvEigenMwh: finalPvBat.pvEigenMwh, pvEinspMwh: finalPvBat.pvEinspMwh,
        bhkwEigenMwh: finalPvBat.bhkwEigenMwh, bhkwEinspMwh: finalPvBat.bhkwEinspMwh,
        netzbezugMwh: finalPvBat.netzbezugMwh } : null,
      score: bestScF,
    });
  }

  // Ergebnisse zurücksenden
  self.postMessage({ type: 'done', topFein, grobResults: grobResults.map(r => ({
    kombiKey: r.kombiKey, keys: r.keys, kw: r.kw, score: r.score,
    stM2: r.stM2, tsVol: r.tsVol, pvKwp: r.pvKwp, batKwh: r.batKwh
  })) });
};
`;
}

export function _doRunOptimierung(resDiv) {
  // PV-Profil einmal cachen (ändert sich nicht während Optimierung)
  window._optCachedPvProfile = (typeof makePvProfile8760 === 'function') ? makePvProfile8760() : null;
  // 1. Lastgang holen — für gewähltes Betrachtungsjahr skaliert
  const ss = window.systemState;
  const optYear = parseInt(document.getElementById('opt-year')?.value) || (typeof globalYear !== 'undefined' ? globalYear : 2026);
  const lastgangKw = _optGetScaledLastgang(optYear) || ss?.lastgangKw;
  const tempH = ss?.tempH;
  const vlH = ss?.vlH;

  if (!lastgangKw || lastgangKw.length < 8760 || !tempH || !vlH) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Kein stundenscharfer Lastgang verfügbar. Bitte zuerst Grundlagen berechnen (8760h Lastgang + Temperatur + Vorlauftemperatur erforderlich).</div>';
    return;
  }

  // Peak-Last bestimmen
  let peak = 0;
  for (let i = 0; i < lastgangKw.length; i++) { if (lastgangKw[i] > peak) peak = lastgangKw[i]; }
  if (peak < 1) peak = 1;

  // 2. Wirtschaftsparameter
  // Fallbacks = HTML-Defaults der wirt-p-* Felder (einheitlich in allen Modulen)
  const pStrom   = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const _pWpRaw  = parseFloat(document.getElementById('wirt-p-strom-wp')?.value);
  const pStromWp = isNaN(_pWpRaw) ? pStrom : _pWpRaw; // optionaler WP-Sondervertragspreis
  const pGas     = parseFloat(document.getElementById('wirt-p-gas')?.value)   || 10;
  const pPk      = parseFloat(document.getElementById('wirt-p-pk')?.value)    || 8;
  const pHhs     = parseFloat(document.getElementById('wirt-p-hhs')?.value)   || 6;
  const pHko     = parseFloat(document.getElementById('wirt-p-hko')?.value)   || 10;
  const pFw      = parseFloat(document.getElementById('wirt-p-fw')?.value)    || 17;
  const pEinsp   = parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8;
  const pBhkwEinsp = parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8;
  const pBhkwKwkE  = parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8;
  const pBhkwKwkEig = parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4;
  const _zRaw    = parseFloat(document.getElementById('wirt-zins')?.value);
  const zins     = (isNaN(_zRaw) ? 3.5 : _zRaw) / 100;
  const params = { pStrom, pStromWp, pGas, pPk, pHhs, pHko, pFw, pEinsp, pBhkwEinsp, pBhkwKwkE, pBhkwKwkEig, zinssatz: zins };

  // 3. Aktive Kandidaten + Constraints
  const allKeys = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel'];
  const aktiv = allKeys.filter(k => document.getElementById('opt-cand-' + k)?.checked);
  if (aktiv.length === 0) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Bitte mindestens einen Kandidaten w\u00e4hlen.</div>';
    return;
  }
  const pvAktiv  = document.getElementById('opt-cand-pv')?.checked;
  const batAktiv = document.getElementById('opt-cand-bat')?.checked;
  const stAktiv  = document.getElementById('opt-cand-st')?.checked;
  const tsAktiv  = document.getElementById('opt-cand-ts')?.checked;

  const constraints = {};
  for (const k of [...allKeys, 'pv', 'bat', 'ts']) {
    constraints[k] = {
      minKw:    parseFloat(document.getElementById('opt-min-' + k)?.value)  || 0,
      maxKw:    parseFloat(document.getElementById('opt-max-' + k)?.value)  || 0,
      bisJahr:  parseInt(document.getElementById('opt-bis-' + k)?.value)    || 0,
    };
  }

  // 4. Optimierungsziel
  const ziel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';

  // 5. Kombinationen generieren (Einzeln + Paare + ggf. Tripel)
  const _allKombis = [];
  for (let i = 0; i < aktiv.length; i++) _allKombis.push([aktiv[i]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++)
      _allKombis.push([aktiv[i], aktiv[j]]);
  for (let i = 0; i < aktiv.length; i++)
    for (let j = i + 1; j < aktiv.length; j++)
      for (let k2 = j + 1; k2 < aktiv.length; k2++)
        _allKombis.push([aktiv[i], aktiv[j], aktiv[k2]]);

  // Gaskessel/Heizöl werden als reguläre Spitzenlastkessel in Kombinationen berücksichtigt
  const kombis = _allKombis;

  // 6. Quartier-Stromprofil vorbereiten (gleiche Kaskade wie calcStromPanel)
  const quartierH = new Float32Array(8760);
  if (window.elQuartierH) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window.elQuartierH[t];
  } else if (window._elQuartierFromGeb) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window._elQuartierFromGeb[t];
  } else {
    const qMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
    if (qMwh > 0) {
      const perH = qMwh * 1000 / 8760;
      for (let t = 0; t < 8760; t++) quartierH[t] = perH;
    } else if (typeof aggregateGebStrom === 'function') {
      const gebStrom = aggregateGebStrom();
      if (gebStrom && gebStrom.totalMWh > 0) {
        for (let t = 0; t < 8760; t++) quartierH[t] = gebStrom.hourly[t];
      }
    }
  }

  // Quartier-Strom Check

  // 7. PV/Bat Vorbereitung
  const spez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const pvMaxConstr = constraints.pv?.maxKw || 0;
  const pvMinConstr = constraints.pv?.minKw || 0;
  const batMaxConstr = constraints.bat?.maxKw || 0;

  // Gesamt-Strombedarf schätzen (für PV-Sizing)
  let gesamtStromSchaetz = 0;
  for (let t = 0; t < 8760; t++) gesamtStromSchaetz += quartierH[t];
  const hatWP = aktiv.some(k => ERZEUGER_CFG[k]?.typ === 'wp');
  if (hatWP) gesamtStromSchaetz += peak * 0.25 * 8760 / 3.5;
  const gesamtStromSchaetzMwh = gesamtStromSchaetz / 1000;
  // Dynamisch: 300% Strombedarf, min 200 kWp
  let pvMaxSinnvoll = pvMaxConstr > 0 ? pvMaxConstr : Math.min(2000, Math.max(100, gesamtStromSchaetzMwh * 1000 / spez * 1.5));
  // Dynamisch: 2 kWh/kWp oder Tages-Strombedarf, was größer ist
  const tagesStromKwh = gesamtStromSchaetzMwh * 1000 / 365;
  let batMax = batMaxConstr > 0 ? batMaxConstr : Math.max(Math.round(pvMaxSinnvoll * 2), Math.round(tagesStromKwh));

  // 8. ADAPTIVE GROBSUCHE — Auflösung abhängig von Genauigkeits-Setting + Kandidatenanzahl
  const nKand = aktiv.length;
  const optQuality = document.getElementById('opt-quality')?.value || 'standard';
  // Basis-Auflösungen pro Quality-Stufe
  const Q = { schnell: { n: 5, pv: 2, bat: 1 }, standard: { n: 7, pv: 3, bat: 2 }, gruendlich: { n: 11, pv: 5, bat: 3 } }[optQuality];
  // Bei vielen Kandidaten: PV/Bat reduzieren um kombinatorische Explosion zu begrenzen
  let GROB_N = Q.n;
  let grobPvN = nKand <= 4 ? Q.pv : nKand <= 6 ? Math.max(1, Q.pv - 1) : 1;
  let grobBatN = nKand <= 4 ? Q.bat : nKand <= 6 ? Math.max(1, Q.bat - 1) : 1;

  // Leistungsstufen generieren (gleichmäßig verteilt inkl. 0 und 1)
  const GROB_STUFEN = Array.from({length: GROB_N}, (_, i) => Math.round(i / (GROB_N - 1) * 100) / 100);

  // PV/Bat Stufen für Grobsuche
  let pvStepsGrob, batStepsGrob;
  if (grobPvN <= 1 || !pvAktiv) {
    // Nur 1 geschätzte PV-Größe (basierend auf geschätztem Strombedarf)
    const pvEst = pvAktiv ? Math.round(gesamtStromSchaetzMwh * 1000 / spez * 0.7) : 0;
    pvStepsGrob = [pvEst];
    batStepsGrob = [pvEst > 0 && batAktiv ? Math.round(Math.min(pvEst * 0.3, batMax)) : 0];
  } else {
    pvStepsGrob = pvAktiv ? Array.from({length: grobPvN}, (_, i) => Math.round(pvMaxSinnvoll * i / (grobPvN - 1))) : [0];
    if (pvMinConstr > 0 && pvAktiv) pvStepsGrob = pvStepsGrob.filter(v => v >= pvMinConstr);
    batStepsGrob = batAktiv ? Array.from({length: grobBatN}, (_, i) => Math.round(batMax * i / Math.max(1, grobBatN - 1))) : [0];
  }

  const grobResults = [];

  // Konfigurationen für Dispatch vorbauen
  const configBatches = [];

  function _makeErzObj(key, frac) {
    const con = constraints[key] || {};
    let kw = Math.round(frac * peak);
    if (con.minKw > 0 && (!con.bisJahr || con.bisJahr >= (typeof globalYear !== 'undefined' ? globalYear : 2026))) {
      kw = Math.max(kw, con.minKw);
    }
    if (con.maxKw > 0) kw = Math.min(kw, con.maxKw);
    kw = Math.max(1, kw);
    return { key, leistKw: kw, typ: ERZEUGER_CFG[key]?.typ || 'fix', guetegrad: _readGuetegrad(key) };
  }

  function _getConstrainedFracs(key) {
    const con = constraints[key] || {};
    const curYear = (typeof globalYear !== 'undefined' ? globalYear : 2026);
    const minFrac = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= curYear) ? con.minKw / peak : 0;
    const maxFrac = con.maxKw > 0 ? con.maxKw / peak : 1.5;
    const fracs = [];
    for (const f of GROB_STUFEN) {
      if (f < minFrac - 0.02) continue;
      if (f > maxFrac + 0.02) continue;
      fracs.push(f);
    }
    if (fracs.length === 0) fracs.push(Math.max(minFrac, 0.08));
    return fracs;
  }

  for (const keys of kombis) {
    const sortedKeys = keys.slice().sort((a, b) => {
      const ia = OPT_MERIT_ORDER.indexOf(a);
      const ib = OPT_MERIT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const kombiKey = keys.slice().sort().join('+');
    const configs = [];

    if (sortedKeys.length === 1) {
      for (const f0 of _getConstrainedFracs(sortedKeys[0])) {
        if (f0 < 0.01) continue;
        configs.push([_makeErzObj(sortedKeys[0], f0)]);
      }
    } else if (sortedKeys.length === 2) {
      const fr0 = _getConstrainedFracs(sortedKeys[0]), fr1 = _getConstrainedFracs(sortedKeys[1]);
      for (const f0 of fr0) for (const f1 of fr1) {
        if (f0 + f1 < 0.05) continue;
        configs.push([_makeErzObj(sortedKeys[0], f0), _makeErzObj(sortedKeys[1], f1)]);
      }
    } else if (sortedKeys.length === 3) {
      const fr0 = _getConstrainedFracs(sortedKeys[0]), fr1 = _getConstrainedFracs(sortedKeys[1]), fr2 = _getConstrainedFracs(sortedKeys[2]);
      for (const f0 of fr0) for (const f1 of fr1) for (const f2 of fr2) {
        if (f0 + f1 + f2 < 0.05) continue;
        configs.push([_makeErzObj(sortedKeys[0], f0), _makeErzObj(sortedKeys[1], f1), _makeErzObj(sortedKeys[2], f2)]);
      }
    }
    configBatches.push({ kombiKey, keys: sortedKeys, sortedKeys, configs });
  }

  // Solarthermie-Stufen vorbereiten (variable Kollektorfläche in m²)
  const stSpez = parseFloat(document.getElementById('st-spez')?.value) || 400;
  const stMinConstr = parseFloat(document.getElementById('opt-min-st')?.value) || 0;
  const stMaxConstr = parseFloat(document.getElementById('opt-max-st')?.value) || 0;
  // Normiertes Solarprofil einmal berechnen (1 m² Basis)
  const stNormProfile = stAktiv ? makeStProfile8760(1) : null; // kW pro m² pro Stunde
  // Gesamt-Wärmebedarf in MWh für Obergrenze
  let gesamtWaermeMwh = 0;
  for (let t = 0; t < 8760; t++) gesamtWaermeMwh += lastgangKw[t];
  gesamtWaermeMwh /= 1000;
  // Sinnvolle Max-Fläche: ST soll max. ~40% der Jahreswärme liefern können
  const stMaxSinnvoll = stMaxConstr > 0 ? stMaxConstr : Math.round(gesamtWaermeMwh * 0.4 * 1000 / stSpez);
  // ST-Stufen adaptiv: bei vielen Kandidaten weniger ST-Varianten
  const grobStN = !stAktiv ? 1 : (nKand <= 4 ? 5 : nKand <= 6 ? 3 : 2);
  let stStepsGrob = stAktiv
    ? Array.from({length: grobStN}, (_, i) => Math.round(stMaxSinnvoll * i / (grobStN - 1)))
    : [0];
  if (stMinConstr > 0 && stAktiv) stStepsGrob = stStepsGrob.filter(v => v >= stMinConstr || v === 0);
  if (!stAktiv) stStepsGrob = [0];

  // Wärmespeicher-Stufen vorbereiten (variable Volumen in m³)
  const tsTyp = document.getElementById('ts-typ')?.value || 'puffer';
  const tsMinConstr = parseFloat(document.getElementById('opt-min-ts')?.value) || 0;
  const tsMaxConstr = parseFloat(document.getElementById('opt-max-ts')?.value) || 0;
  let tsStepsGrob;
  if (!tsAktiv) {
    tsStepsGrob = [0];
  } else {
    // Auto-Sizing als Basis: berechne empfohlenes Volumen aus WP-Kapazität
    const tsAutoVol = _autoSpeicherVolumen(tsTyp, parseFloat(document.getElementById('ts-dt')?.value) || 40);
    const tsMaxVol = tsMaxConstr > 0 ? tsMaxConstr : Math.round(tsAutoVol * 3);
    const tsMinVol = tsMinConstr > 0 ? tsMinConstr : 0;
    const grobTsN = nKand <= 4 ? 5 : 3;
    tsStepsGrob = [0]; // immer auch ohne Speicher testen
    for (let i = 1; i < grobTsN; i++) {
      const vol = Math.round(tsMinVol + (tsMaxVol - tsMinVol) * i / (grobTsN - 1));
      if (vol > 0 && !tsStepsGrob.includes(vol)) tsStepsGrob.push(vol);
    }
    if (tsMinConstr > 0) tsStepsGrob = tsStepsGrob.filter(v => v >= tsMinConstr || v === 0);
  }

  // Hilfsfunktion: Lastgang mit ST-Abzug und Wärme-Summe + Überschuss für Speicher
  function _stReducedLastgang(stM2) {
    if (stM2 <= 0 || !stNormProfile) return { lastgang: lastgangKw, waermeMwh: 0, stExcessH: null };
    const reduced = new Float32Array(8760);
    const stExcessH = new Float32Array(8760);
    let sumKwh = 0;
    for (let t = 0; t < 8760; t++) {
      const stKw = stNormProfile[t] * stM2;
      const used = Math.min(stKw, lastgangKw[t]);
      reduced[t] = lastgangKw[t] - used;
      stExcessH[t] = stKw - used;
      sumKwh += used;
    }
    return { lastgang: reduced, waermeMwh: sumKwh / 1000, stExcessH };
  }


  let totalConfigs = 0;
  for (const batch of configBatches) totalConfigs += batch.configs.length * stStepsGrob.length * tsStepsGrob.length;
  let doneConfigs = 0;

  // Asynchrone Batch-Verarbeitung für UI-Responsivität
  let batchIdx = 0;
  let configIdx = 0;
  let stIdx = 0;
  let tsIdx = 0;

  const _optStartTime = Date.now();

  function processBatch() {
    if (_optAborted) {
      const elapsed = ((Date.now() - _optStartTime) / 1000).toFixed(0);
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Abgebrochen nach ' + elapsed + 's. ' + doneConfigs + '/' + totalConfigs + ' Konfigurationen berechnet.</div>';
      if (grobResults.length > 0) { finishOptimierung(); } else { _optFinished(); }
      return;
    }
    const startTime = Date.now();
    const BATCH_TIME_MS = 200; // 200ms pro Batch — reduziert yields gegen Browser-Throttling

    while (batchIdx < configBatches.length) {
      const batch = configBatches[batchIdx];

      while (configIdx < batch.configs.length) {
        const config = batch.configs[configIdx];

        while (stIdx < stStepsGrob.length) {
          const stM2 = stStepsGrob[stIdx];

          while (tsIdx < tsStepsGrob.length) {
            const tsVol = tsStepsGrob[tsIdx];
            tsIdx++;
            doneConfigs++;

            // ST vom Lastgang abziehen
            const { lastgang: lgForDisp, waermeMwh: stMwh, stExcessH } = _stReducedLastgang(stM2);

            // Dispatch (mit optionalem Speichervolumen + ST-Überschuss → Speicher)
            const disp = _optDispatch8760(lgForDisp, tempH, vlH, config.map(c => ({...c})), tsVol, stExcessH);

            // Mindestleistung: Jeder Erzeuger muss ≥10% der Spitzenleistung liefern
            const minKw = peak * 0.1;
            if (config.length > 1 && disp.erzeugerList.some(e => e.leistKw < minKw)) continue;

            // Stromprofil: WP + SK + Quartier
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) {
              demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            }

            // PV/Bat Suche per marginaler Amortisation
            const pvMaxAmort = parseFloat(document.getElementById('opt-pv-max-amort')?.value) || 10;
            const pvBatRes = _findOptPvBatMain(pvStepsGrob, batStepsGrob, demandH, disp.bhkwElH, disp,
              params, stMwh, stM2, tsVol, ziel, pvMaxAmort);

            if (pvBatRes.kw) {
              grobResults.push({
                kombiKey: batch.kombiKey,
                keys: batch.keys,
                config: config,
                pvKwp: pvBatRes.pvKwp,
                batKwh: pvBatRes.batKwh,
                stM2: stM2,
                stMwh: stMwh,
                tsVol: tsVol,
                kw: pvBatRes.kw,
                score: pvBatRes.score
              });
            }

            // UI-Update check
            if (Date.now() - startTime > BATCH_TIME_MS) {
              const pct = Math.round(doneConfigs / totalConfigs * 100);
              const elapsed = ((Date.now() - _optStartTime) / 1000).toFixed(0);
              resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">Grobsuche (' + GROB_N + ' Stufen, ' + nKand + ' Kand.' + (stAktiv ? ', ST variabel' : '') + (tsAktiv ? ', TS variabel' : '') + '): ' + pct + '% \u00b7 ' + doneConfigs + '/' + totalConfigs + ' \u00b7 ' + elapsed + 's</div>';
              setTimeout(processBatch, 0);
              return;
            }
          }

          tsIdx = 0;
          stIdx++;
        }

        stIdx = 0;
        configIdx++;
      }

      configIdx = 0;
      batchIdx++;
    }

    // Grobsuche fertig — weiter mit Deduplizierung und Feinsuche
    finishOptimierung();
  }

  function finishOptimierung() {
    if (grobResults.length === 0) {
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse. Bitte Lastgang berechnen.</div>';
      _optFinished();
      return;
    }
    // Grob-Ergebnisse für Scatter-Plot aufheben
    window._optGrobResults = grobResults.slice();

    // Dedupliziere: pro kombiKey nur bestes Ergebnis, Top 5 weiterreichen
    grobResults.sort((a, b) => a.score - b.score);
    const seen = new Set();
    const grobTop = [];
    for (const r of grobResults) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); grobTop.push(r); }
    }
    const topNGrob = grobTop.slice(0, 5); // Top 5 für Feinsuche

    resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">Feinsuche l\u00e4uft\u2026</div>';

    // Feinsuche asynchron — 5-kW-Schritte statt 1-kW für Performanz
    let feinIdx = 0;
    const topFein = [];
    const FEIN_STEP = Math.max(1, Math.round(peak / 200)); // ~5 kW bei peak=1000

    function processFein() {
      if (_optAborted || feinIdx >= topNGrob.length) {
        // Top 3 an Renderer übergeben (auch bei Abbruch, falls Teilergebnisse da)
        const pool = topFein.length > 0 ? topFein : topNGrob;
        pool.sort((a, b) => a.score - b.score);
        renderResults(pool.slice(0, 3));
        return;
      }

      const grob = topNGrob[feinIdx];
      feinIdx++;

      // Sequentielle Feinsuche pro Erzeuger-Achse, 2 Runden
      let currentConfig = grob.config.map(c => ({...c}));
      let currentStM2 = grob.stM2 || 0;
      let currentTsVol = grob.tsVol || 0;
      const feinRange = Math.round(peak * 0.10);

      for (let runde = 0; runde < 2; runde++) {
        let changed = false;
        // ST vom Lastgang abziehen mit aktueller ST-Fläche
        const { lastgang: lgFein, waermeMwh: stMwhFein, stExcessH: stExFein } = _stReducedLastgang(currentStM2);

        for (let ei = 0; ei < currentConfig.length; ei++) {
          const erz = currentConfig[ei];
          const con = constraints[erz.key] || {};
          const curYear = (typeof globalYear !== 'undefined' ? globalYear : 2026);
          const minKwCon = con.minKw > 0 && (!con.bisJahr || con.bisJahr >= curYear) ? con.minKw : 1;
          const maxKwCon = con.maxKw > 0 ? con.maxKw : Math.round(peak * 1.2);
          const _minKwFein = currentConfig.length > 1 ? Math.round(peak * 0.1) : 1;
          const lo = Math.max(_minKwFein, minKwCon, erz.leistKw - feinRange);
          const hi = Math.min(maxKwCon, erz.leistKw + feinRange);

          let bestKwVal = erz.leistKw, bestScoreVal = Infinity;
          for (let kw = lo; kw <= hi; kw += FEIN_STEP) {
            const testConfig = currentConfig.map(c => ({...c}));
            testConfig[ei] = { ...erz, leistKw: kw };
            const disp = _optDispatch8760(lgFein, tempH, vlH, testConfig.map(c => ({...c})), currentTsVol, stExFein);
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            const pvBat = _optPvBatSim8760(grob.pvKwp, grob.batKwh, demandH, disp.bhkwElH, disp);
            const kwRes = _optKennwerte2(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhFein, currentStM2, currentTsVol);
            const score = _optScore(kwRes, ziel);
            if (score < bestScoreVal) { bestScoreVal = score; bestKwVal = kw; }
          }
          if (bestKwVal !== erz.leistKw) { changed = true; }
          currentConfig[ei] = { ...erz, leistKw: bestKwVal };
        }

        // ST-Fläche feinoptimieren (±20% vom Grobwert, 10 Stufen)
        if (stAktiv && currentStM2 > 0) {
          const stLoFein = Math.max(stMinConstr, Math.round(currentStM2 * 0.8));
          const stHiFein = stMaxConstr > 0 ? Math.min(stMaxConstr, Math.round(currentStM2 * 1.2)) : Math.round(currentStM2 * 1.2);
          const stFeinStep = Math.max(1, Math.round((stHiFein - stLoFein) / 10));
          let bestStVal = currentStM2, bestStScore = Infinity;
          for (let sm2 = stLoFein; sm2 <= stHiFein; sm2 += stFeinStep) {
            const { lastgang: lgSt, waermeMwh: stMwhSt, stExcessH: stExSt } = _stReducedLastgang(sm2);
            const disp = _optDispatch8760(lgSt, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExSt);
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            const pvBat = _optPvBatSim8760(grob.pvKwp, grob.batKwh, demandH, disp.bhkwElH, disp);
            const kwRes = _optKennwerte2(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhSt, sm2, currentTsVol);
            const score = _optScore(kwRes, ziel);
            if (score < bestStScore) { bestStScore = score; bestStVal = sm2; }
          }
          if (bestStVal !== currentStM2) { changed = true; currentStM2 = bestStVal; }
        }

        // Wärmespeicher-Volumen feinoptimieren (±30% vom Grobwert, 8 Stufen)
        if (tsAktiv && currentTsVol > 0) {
          const tsLoFein = Math.max(tsMinConstr, Math.round(currentTsVol * 0.7));
          const tsHiFein = tsMaxConstr > 0 ? Math.min(tsMaxConstr, Math.round(currentTsVol * 1.3)) : Math.round(currentTsVol * 1.3);
          const tsFeinStep = Math.max(1, Math.round((tsHiFein - tsLoFein) / 8));
          let bestTsVal = currentTsVol, bestTsScore = Infinity;
          const { lastgang: lgTs, waermeMwh: stMwhTs, stExcessH: stExTs } = _stReducedLastgang(currentStM2);
          for (let tv = tsLoFein; tv <= tsHiFein; tv += tsFeinStep) {
            const disp = _optDispatch8760(lgTs, tempH, vlH, currentConfig.map(c => ({...c})), tv, stExTs);
            const demandH = new Float32Array(8760);
            for (let t = 0; t < 8760; t++) demandH[t] = disp.wpElH[t] + disp.skElH[t] + quartierH[t];
            const pvBat = _optPvBatSim8760(grob.pvKwp, grob.batKwh, demandH, disp.bhkwElH, disp);
            const kwRes = _optKennwerte2(disp, grob.pvKwp, grob.batKwh, pvBat, params, stMwhTs, currentStM2, tv);
            const score = _optScore(kwRes, ziel);
            if (score < bestTsScore) { bestTsScore = score; bestTsVal = tv; }
          }
          if (bestTsVal !== currentTsVol) { changed = true; currentTsVol = bestTsVal; }
        }

        if (!changed) break;
      }

      // PV/Bat Volloptimierung (breites Grid)
      const { lastgang: lgFinal, waermeMwh: stMwhFinal, stExcessH: stExFinal } = _stReducedLastgang(currentStM2);
      const finalDisp = _optDispatch8760(lgFinal, tempH, vlH, currentConfig.map(c => ({...c})), currentTsVol, stExFinal);
      const demandHFinal = new Float32Array(8760);
      for (let t = 0; t < 8760; t++) demandHFinal[t] = finalDisp.wpElH[t] + finalDisp.skElH[t] + quartierH[t];

      // PV/Bat Feinoptimierung per marginaler Amortisation
      const pvStepsFein = pvAktiv ? Array.from({length: 15}, (_, i) => Math.round(pvMaxSinnvoll * i / 14)) : [0];
      if (pvMinConstr > 0 && pvAktiv) {
        const filtered = pvStepsFein.filter(v => v >= pvMinConstr || v === 0);
        if (filtered.length > 0) { pvStepsFein.length = 0; filtered.forEach(v => pvStepsFein.push(v)); }
      }
      const batStepsFein = batAktiv ? Array.from({length: 8}, (_, i) => Math.round(batMax * i / 7)) : [0];
      const pvMaxAmortFein = parseFloat(document.getElementById('opt-pv-max-amort')?.value) || 10;
      const pvBatFein = _findOptPvBatMain(pvStepsFein, batStepsFein, demandHFinal, finalDisp.bhkwElH, finalDisp,
        params, stMwhFinal, currentStM2, currentTsVol, ziel, pvMaxAmortFein);
      const bestPv = pvBatFein.pvKwp, bestBat = pvBatFein.batKwh, bestScoreFinal = pvBatFein.score;

      // Finales Ergebnis
      const finalPvBat = _optPvBatSim8760(bestPv, bestBat, demandHFinal, finalDisp.bhkwElH, finalDisp);
      const finalKw = _optKennwerte2(finalDisp, bestPv, bestBat, finalPvBat, params, stMwhFinal, currentStM2, currentTsVol);

      topFein.push({
        keys: grob.keys,
        config: currentConfig,
        pvKwp: bestPv,
        batKwh: bestBat,
        stM2: currentStM2,
        stMwh: stMwhFinal,
        tsVol: currentTsVol,
        kw: finalKw,
        sim: finalDisp,
        score: bestScoreFinal,
      });

      const elapsedFein = ((Date.now() - _optStartTime) / 1000).toFixed(0);
      resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">Feinsuche: ' + feinIdx + '/' + topNGrob.length + ' Konstellationen \u00b7 ' + elapsedFein + 's</div>';
      setTimeout(processFein, 0);
    }

    processFein();
  }

  function renderResults(top3) {
    if (top3.length === 0) {
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
      return;
    }

    top3.sort((a, b) => a.score - b.score);

    resDiv.innerHTML = '';
    // Jahr-Info im Ergebnis anzeigen
    const _optResYear2 = parseInt(document.getElementById('opt-year')?.value) || globalYear;
    const _optResYearDiv2 = document.createElement('div');
    _optResYearDiv2.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;';
    _optResYearDiv2.innerHTML = '<span style="color:var(--accent);font-weight:600;">Betrachtungsjahr: ' + _optResYear2 + '</span>'
      + (window._basisYear && _optResYear2 !== window._basisYear ? ' <span style="color:#78909c;font-size:9px;">(Lastgang skaliert)</span>' : '');
    resDiv.appendChild(_optResYearDiv2);
    top3.forEach((r, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border-radius:8px;padding:12px 14px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.3);';

      const titel = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join(' + ')
        + (r.stM2 > 0 ? ' + ST ' + r.stM2 + ' m\u00b2' : '')
        + (r.tsVol > 0 ? ' + WS ' + r.tsVol + ' m\u00b3' : '')
        + (r.pvKwp > 0 ? ' + PV ' + r.pvKwp.toFixed(0) + ' kWp' : '')
        + (r.batKwh > 0 ? ' + Bat ' + r.batKwh.toFixed(0) + ' kWh' : '');

      const eeColor = r.kw.eeAnteil >= 65 ? '#81c784' : '#ef9a9a';
      const eeBadge = '<span style="background:' + eeColor + ';color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;">' + r.kw.eeAnteil.toFixed(0) + '% EE</span>';

      const totalInkST = (r.sim.gesamtMwh || 0) + (r.stMwh || 0);

      // ── Hauptzeile: WGK prominent + Sekundär-KPIs ──
      let kpiHtml = '<div style="display:flex;align-items:stretch;gap:6px;margin:6px 0;">';
      kpiHtml += '<div style="background:rgba(253,216,53,0.08);border:1px solid rgba(253,216,53,0.25);border-radius:6px;padding:6px 12px;text-align:center;min-width:80px;">'
        + '<div style="font-size:18px;font-weight:700;color:#fdd835;line-height:1.1;">' + r.kw.wgk.toFixed(1) + '</div>'
        + '<div style="font-size:8px;color:var(--muted);margin-top:1px;">ct/kWh</div></div>';
      kpiHtml += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px;flex:1;">';
      const kpis2 = [
        { val: (r.kw.investGesamt / 1000).toFixed(0) + ' k\u20ac', lbl: 'Invest', color: '#b0bec5' },
        { val: r.kw.co2ta.toFixed(1) + ' t/a', lbl: 'CO\u2082', color: '#90a4ae' },
        { val: r.kw.jahreskosten ? (r.kw.jahreskosten / 1000).toFixed(1) + ' k\u20ac/a' : '\u2014', lbl: 'Jahreskosten', color: '#ce93d8' },
        { val: (r.kw.stromAutarkie || 0).toFixed(0) + '%', lbl: '\u26A1 Strom-Aut.', color: '#fdd835' },
        { val: (r.kw.waermeAutarkie || 0).toFixed(0) + '%', lbl: '\uD83C\uDF21 W\u00e4rme-Aut.', color: '#e53935' },
        { val: totalInkST.toFixed(0) + ' MWh', lbl: 'W\u00e4rme ges.', color: '#ff7043' },
      ];
      for (const k of kpis2) {
        kpiHtml += '<div style="background:rgba(255,255,255,0.03);border-radius:3px;padding:2px 4px;text-align:center;">'
          + '<div style="font-size:10px;font-weight:600;color:' + k.color + ';">' + k.val + '</div>'
          + '<div style="font-size:7px;color:var(--muted);white-space:nowrap;">' + k.lbl + '</div></div>';
      }
      kpiHtml += '</div></div>';

      // ── Erzeuger-Tabelle ──
      let erzHtml = '<div style="display:grid;grid-template-columns:auto repeat(3,1fr);gap:0 8px;font-size:9px;margin:4px 0;padding:4px 0;border-top:1px solid var(--border);">';
      erzHtml += '<div style="color:var(--muted);font-size:8px;">Erzeuger</div>'
        + '<div style="color:var(--muted);font-size:8px;text-align:right;">Leistung</div>'
        + '<div style="color:var(--muted);font-size:8px;text-align:right;">Energie</div>'
        + '<div style="color:var(--muted);font-size:8px;text-align:right;">Anteil</div>';
      if (r.stM2 > 0 && r.stMwh > 0) {
        const dckPct = totalInkST > 0 ? (r.stMwh / totalInkST * 100) : 0;
        erzHtml += '<div><span style="color:#ef6c00;">\u25CF</span> ST ' + r.stM2 + ' m\u00b2</div>'
          + '<div style="text-align:right;">\u2014</div>'
          + '<div style="text-align:right;">' + r.stMwh.toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
      }
      for (let ci = 0; ci < r.config.length; ci++) {
        const erz = r.config[ci];
        const simErz = r.sim.erzeugerList ? r.sim.erzeugerList[ci] : null;
        const waermeMwh = simErz ? (simErz.waermeMwh || 0) : 0;
        const col = ERZEUGER_CFG[erz.key]?.color || '#aaa';
        const dckPct = totalInkST > 0 ? (waermeMwh / totalInkST * 100) : 0;
        const displayKw = simErz ? simErz.leistKw : erz.leistKw;
        erzHtml += '<div><span style="color:' + col + ';">\u25CF</span> ' + (ERZEUGER_CFG[erz.key]?.label || erz.key) + '</div>'
          + '<div style="text-align:right;">' + displayKw.toFixed(0) + ' kW</div>'
          + '<div style="text-align:right;">' + waermeMwh.toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
      }
      if (r.sim.autoGkMwh > 0) {
        const dckPct = totalInkST > 0 ? (r.sim.autoGkMwh / totalInkST * 100) : 0;
        erzHtml += '<div><span style="color:#78909c;">\u25CF</span> Backup-GK</div>'
          + '<div style="text-align:right;">\u2014</div>'
          + '<div style="text-align:right;">' + r.sim.autoGkMwh.toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
      }
      if (r.pvKwp > 0) {
        erzHtml += '<div><span style="color:#fdd835;">\u25CF</span> PV' + (r.batKwh > 0 ? ' + Bat' : '') + '</div>'
          + '<div style="text-align:right;">' + r.pvKwp.toFixed(0) + ' kWp' + (r.batKwh > 0 ? ' / ' + r.batKwh.toFixed(0) + ' kWh' : '') + '</div>'
          + '<div style="text-align:right;color:var(--muted);">' + (r.kw.pvErtragMwh || 0).toFixed(0) + ' MWh</div>'
          + '<div style="text-align:right;color:var(--muted);">\u2014</div>';
      }
      erzHtml += '</div>';

      card.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);">' +
          '<span style="font-size:12px;font-weight:700;color:var(--text);">' + (idx + 1) + '. ' + escHtml(titel) + '</span>' +
          eeBadge +
        '</div>' +
        kpiHtml +
        erzHtml +
        '<div style="text-align:center;margin-top:6px;"><button class="btn-secondary" style="font-size:9px;padding:3px 12px;" data-click="_optVarianteUebernehmen(window._optLastResults[' + idx + '], this)">Als Variante \u00fcbernehmen</button></div>';
      resDiv.appendChild(card);
    });

    window._optLastResults = top3;

    // Debug: WGK-Aufschlüsselung der Top-Varianten loggen
    top3.forEach((r, i) => {
      const d = r.kw._dbg;
      if (d) console.log('[OPT-WGK] #' + (i+1), r.keys.join('+'),
        '| WGK:', r.kw.wgk.toFixed(1), 'ct/kWh',
        '| Kapital:', Math.round(d.kapitalJk), '€/a',
        '| Energie:', Math.round(d.energieJk), '€/a',
        '| JK ges:', Math.round(r.kw.jahreskosten), '€/a',
        '| Wärme:', d.totalWaerme.toFixed(1), 'MWh',
        '| Invest:', Math.round(d.basisInvest), '€',
        '| nGeb:', d.nGeb, '| NetzInv:', d.netzInvest,
        '| AutoGK:', d.autoGkMwh.toFixed(1), 'MWh/' + (d.autoGkPeakKw||0).toFixed(0) + 'kW',
        '| Erz:', d.erzList);
    });

    // Visualisierungen rendern
    _optRenderBarChart(top3, resDiv);
    _optRenderRadar(top3, resDiv);
    _optRenderScatter(resDiv);
    // Gesamtdauer anzeigen
    const totalElapsed = ((Date.now() - _optStartTime) / 1000);
    const timeLabel = totalElapsed < 60 ? totalElapsed.toFixed(1) + 's' : (totalElapsed / 60).toFixed(1) + ' min';
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'font-size:9px;color:var(--muted);text-align:center;margin-top:8px;';
    infoDiv.textContent = 'Berechnung abgeschlossen in ' + timeLabel + ' (' + (window._optGrobResults?.length || 0) + ' Konfigurationen getestet)';
    resDiv.appendChild(infoDiv);
    // PV-Cache aufräumen
    window._optCachedPvProfile = null;
    _optFinished();
  }

  // Start der asynchronen Grobsuche
  processBatch();
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
    const txt = (idx + 1) + '. ' + r.keys.map(k => _fullName(k)).join(' + ');
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
    const name = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join('+');
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
    { label: '\u26A1Autarkie', key: 'stromAutarkie', inv: false, unit: '%' },
    { label: '\uD83D\uDD25Autarkie', key: 'waermeAutarkie', inv: false, unit: '%' },
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
  const top3 = allRes.slice().sort((a, b) => a.score - b.score).slice(0, 3);
  const top3Set = new Set(top3.map(r => r.kombiKey + '|' + r.score));

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
      ctx.fillText(v.toFixed(1), xOf(v), PAD.t + ph + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = minCo2 + (maxCo2 - minCo2) * i / 4;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(v.toFixed(1), PAD.l - 5, yOf(v));
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

    // Top-3 Labels
    const top3sorted = top3.slice().sort((a, b) => a.kw.wgk - b.kw.wgk);
    ctx.font = '8px "DM Sans",sans-serif'; ctx.textBaseline = 'bottom';
    top3sorted.forEach((r, i) => {
      const x = xOf(r.kw.wgk), y = yOf(r.kw.co2ta);
      const txt = '#' + (i + 1) + ' ' + r.keys.map(k => _fullName(k)).join('+');
      const truncTxt = txt.length > 28 ? txt.slice(0, 26) + '\u2026' : txt;
      ctx.textAlign = x > PAD.l + pw * 0.7 ? 'right' : 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(truncTxt, x + (ctx.textAlign === 'left' ? 8 : -8), y - 4);
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
