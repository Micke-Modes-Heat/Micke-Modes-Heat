// 10a-optimizer-core.js - Optimizer: Constants, dispatch, economic calculations, configuration
// Split from 10-optimizer.js - Core dispatch, PV/Bat simulation, Kennwerte, Score,
// PV/Bat marginal amortization, year selection, lastgang scaling, estimate,
// DOM parameter collection, variant adoption, status panel
// ==========================================================================

// OPT_INVEST_DEFAULT, OPT_NUTZUNG, OPT_IH, OPT_EE_KEYS, OPT_MERIT_ORDER → src/config/optimizer-defaults.js

// Mapping Optimizer-Key → CalcEngine INVEST_KURVEN Key
import { captureErzeugerState, captureNetzState, fernwaermeEmF, gasEmF, gebaeude, globalYear, heizoelEmF, hhsEmF, networkLocked, netzEdges, pelletsEmF, renderVariantenBar, stromEmF, updateVariantBanner, varianten } from './01-globals-varianten.js';
import { getComputedStats, getGebStromMwh, map } from './02b-gebaeude.js';
import { clearFliessgewaesser, clearLwWp, polygonCenter, redrawFliessgewaesser, redrawLwWp } from './02c-karte-werkzeuge.js';
import { clearBhkw, clearFernwaerme, clearGasKessel, clearHeizoelKessel, clearHhs, clearPellets, clearStromkessel, redrawErzeugerIcons } from './03a-erzeuger.js';
import { calcGeoThermie, clearGeo, redrawGeo } from './03b-netz.js';
import { showHint } from './03c-gebaeude-io.js';
import { getKostenProMKlasse, updateLpErgebnisKpis, updateLpStepProgress } from './04a-ui-panels.js';
import { glGetGesamtMwh, glGetMonatswerte, glLastgangKw } from './06a-gbi-lastgang.js';
import { clearSolarthermie, clearThermSpeicher, getThermSpeicherParams, updateSolarthermieDisplay, updateThermSpeicherDisplay } from './06b-gl-berechnen.js';
import { _dispatchCore, autoGkResult, isErzeugerAktiv, meritOrderKeys, onSystemStateUpdated, setMeritOrderKeys, updateAllDeckungen } from './06c-dispatch-core.js';
import { _calcKostenShared, _parseGeoBohrMeter } from './07b-analysis-economics.js';
import { CalcEngine } from './08-calc-engine.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { OPT_INVEST_DEFAULT } from './config/optimizer-defaults.js';

export const _OPT_CE_KEY = {
  lwwp:'LuftWP', fg:'FlussWP', geo:'GeoWP', gaskessel:'Gaskessel',
  bhkw:'BHKW', stromkessel:'Stromkessel', pellets:'Pellets',
  hhs:'Hackschnitzel', heizoel:'Heizoel'
};
export function _optInvestProKw(key, kw) {
  const ceKey = _OPT_CE_KEY[key];
  if (ceKey && typeof CalcEngine !== 'undefined') {
    const v = CalcEngine.investEurProKw(ceKey, kw);
    if (v > 0) return v;
  }
  return OPT_INVEST_DEFAULT[key] || 200;
}

export function _optAnnF(z, n) {
  if (z <= 0 || n <= 0) return n > 0 ? 1 / n : 1;
  return z * Math.pow(1 + z, n) / (Math.pow(1 + z, n) - 1);
}

// ── Quelltemperatur für Optimierung (kopiert aus _quelleTemp) ──────────────
// _defaultGuetegrad und _readGuetegrad — weiterhin lokal gebraucht für Optimizer-Konfiguration
export function _defaultGuetegrad(key) {
  if (key === 'lwwp') return 0.42;
  if (key === 'fg')   return 0.56;
  if (key === 'geo')  return 0.50;
  return 0.42;
}

export function _readGuetegrad(key) {
  const id = ERZEUGER_CFG[key]?.guetegradId;
  const v = id ? parseFloat(document.getElementById(id)?.value) : NaN;
  return isNaN(v) || v <= 0 ? _defaultGuetegrad(key) : v;
}

// ── Optimizer-Dispatch: dünner Wrapper um _dispatchCore ──────────────────
// Signatur bleibt identisch für alle 10 Aufrufstellen im Optimizer.
// Intern wird der gemeinsame Kern (_dispatchCore aus 06-system-dispatch.js) genutzt.
export function _optDispatch8760(lastgangKw, tempH, vlH, erzeugerList, optSpeicherVol, stExcessH) {
  const bhkwSigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
  const skEta      = (parseFloat(document.getElementById('sk-eta')?.value) || 99) / 100;
  const lwwpMinCop = parseFloat(document.getElementById('lwwp-min-cop')?.value) || 0;

  // Speicher-Parameter (optSpeicherVol überschreibt UI-Volumen)
  let thSp = null;
  if (typeof optSpeicherVol === 'number' && optSpeicherVol > 0) {
    const dt = parseFloat(document.getElementById('ts-dt')?.value) || 40;
    const verlustPctH = parseFloat(document.getElementById('ts-verlust')?.value) || 0.5;
    const entladeKw = parseFloat(document.getElementById('ts-entlade-kw')?.value) || 200;
    thSp = { vol: optSpeicherVol, dt, kapKwh: optSpeicherVol * 1.16 * dt, verlustRate: verlustPctH / 100, entladeKw };
  } else if (window.thermSpeicherAktiv) {
    thSp = getThermSpeicherParams();
  }

  // guetegrad + typ sicherstellen (kann bei manchen Aufrufstellen fehlen)
  for (const erz of erzeugerList) {
    if (!erz.guetegrad) erz.guetegrad = _defaultGuetegrad(erz.key);
    if (!erz.typ) erz.typ = ERZEUGER_CFG[erz.key]?.typ;
  }

  // Kern-Dispatch aufrufen (nutzt _quelleTemp aus 06-system-dispatch.js — identische Logik)
  const r = _dispatchCore({
    lastgangKw, tempH, vlH,
    erzList: erzeugerList,
    speicherParams: thSp,
    stProfile: null,
    stExcessH,
    bhkwSigma, skEta, lwwpMinCop,
    quelleTemp: _quelleTemp,
    recordHourly: false,
    backupMode: true,
  });

  // Ergebnisse in erzeugerList schreiben (Optimizer-Format)
  for (const erz of erzeugerList) {
    erz.waermeMwh = (r.thKwh[erz.key] || 0) / 1000;
    erz.elMwh     = (r.elKwh[erz.key] || 0) / 1000;
  }
  // Backup-Kessel: leistKw auf tatsächlichen Peak anheben
  const backupErz = erzeugerList.length > 0 ? erzeugerList[erzeugerList.length - 1] : null;
  if (backupErz && r.backupPeakKw > backupErz.leistKw) {
    backupErz.leistKw = Math.ceil(r.backupPeakKw);
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
    thSpParams: r.speicherParams ? { kapKwh: r.speicherParams.kapKwh, entladeKw: r.speicherParams.entladeKw } : null,
  };
}

// ── PV/Bat stündliche Simulation ──────────────────────────────────────────
export function _optPvBatSim8760(pvKwp, batKwh, demandH, bhkwElH, dispResult) {
  const hasBhkw = bhkwElH && bhkwElH.some(v => v > 0);
  if (pvKwp <= 0 && !hasBhkw) {
    let sumDem = 0;
    for (let t = 0; t < 8760; t++) sumDem += demandH[t];
    return { eigenMwh: 0, einspeiseMwh: 0, netzbezugMwh: sumDem / 1000,
             pvEigenMwh: 0, pvEinspMwh: 0, bhkwEigenMwh: 0, bhkwEinspMwh: 0 };
  }

  const pvProfile = window._optCachedPvProfile || ((typeof makePvProfile8760 === 'function') ? makePvProfile8760() : null);
  const spez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const ETA_BAT = 0.90;
  const batLeistKw = batKwh > 0 ? batKwh / 2 : 0; // C/2 Rate

  let sv = 0, ins = 0, bez = 0, soc = 0;
  let pvEig = 0, pvEinsp = 0, bhkwEig = 0, bhkwEinsp = 0;
  let tsSoc = 0, pvWpSpeicherGes = 0; // Thermischer Speicher SOC + PV→WP→Speicher kumulativ
  for (let t = 0; t < 8760; t++) {
    let pvWpSpeicher = 0; // pro Stunde
    const dem = demandH[t];
    const pvGen = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const bhkwGen = bhkwElH ? bhkwElH[t] : 0;
    const gen = pvGen + bhkwGen;

    const dsc = Math.min(gen, dem);
    const pvFrac = gen > 0 ? pvGen / gen : 0;
    let rDem = dem - dsc;
    let rGen = gen - dsc;

    // Batterie laden
    if (batKwh > 0 && rGen > 0) {
      const cMax = Math.min(rGen, batLeistKw, batKwh - soc);
      soc += cMax;
      rGen -= cMax;
    }
    // Batterie entladen
    if (batKwh > 0 && rDem > 0) {
      const avail = Math.min(soc * ETA_BAT, rDem, batLeistKw);
      soc -= avail / ETA_BAT;
      rDem -= avail;
    }

    // PV-Überschuss → WP → thermischer Speicher
    if (rGen > 0.1 && dispResult && dispResult.thSpParams && dispResult.wpResKwH) {
      const tsCap = dispResult.thSpParams.kapKwh;
      const tsEntlKw = dispResult.thSpParams.entladeKw;
      const wpResKw = dispResult.wpResKwH[t] || 0;
      const wpCop = dispResult.wpResCopH[t] || 0;
      if (wpResKw > 0.1 && wpCop > 0 && tsCap > 0) {
        const tsFree = Math.max(0, tsCap - tsSoc);
        const ladeBudget = Math.min(tsFree, tsEntlKw);
        if (ladeBudget > 0.1) {
          const maxElKw = wpResKw / wpCop;
          const elUsed = Math.min(rGen, maxElKw);
          const thLade = Math.min(elUsed * wpCop, ladeBudget);
          if (thLade > 0.1) {
            const elActual = thLade / wpCop;
            tsSoc = Math.min(tsCap, tsSoc + thLade);
            rGen -= elActual;
            pvWpSpeicher += elActual / 1000;
          }
        }
      }
    }

    pvWpSpeicherGes += pvWpSpeicher;
    const evThisH = (dsc + (dem - dsc - rDem)) / 1000;
    sv += dsc + (dem - dsc - rDem);
    ins += rGen;
    bez += rDem;
    pvEig += evThisH * pvFrac + pvWpSpeicher;  // PV→WP→Speicher zählt als PV-Eigenverbrauch
    bhkwEig += evThisH * (1 - pvFrac);
    pvEinsp += (rGen / 1000) * pvFrac;
    bhkwEinsp += (rGen / 1000) * (1 - pvFrac);
  }

  return { eigenMwh: sv / 1000 + pvWpSpeicherGes, einspeiseMwh: ins / 1000, netzbezugMwh: bez / 1000,
           pvEigenMwh: pvEig, pvEinspMwh: pvEinsp, bhkwEigenMwh: bhkwEig, bhkwEinspMwh: bhkwEinsp,
           pvWpSpeicherMwh: pvWpSpeicherGes };
}

// _calcBausteinKostenOpt ENTFERNT — nutzt jetzt _calcKostenShared

// ── Kennwerte (WGK, CO2, EE-Anteil, Autarkie) — Wrapper um _calcKostenShared ──
export function _optKennwerte2(dispatchResult, pvKwp, batKwh, pvBatResult, params, stWaermeMwhOpt, stM2Opt, optSpeicherVol) {
  const { erzeugerList, gesamtMwh } = dispatchResult;
  const { pStrom, pGas, pPk, pHhs, pHko, pFw, pEinsp, pBhkwEinsp, pBhkwKwkE, pBhkwKwkEig, zinssatz } = params;

  // Peak-Leistungen für Bausteine
  const _bPKw = {};
  for (const erz of erzeugerList) _bPKw[erz.key] = erz.leistKw;
  const _bInvestFn = (key, kw) => kw > 0.1 ? Math.round(kw * _optInvestProKw(key, kw)) : 0;

  // Dynamische Bohrmeter für Geo
  let _dynBohrMeter = typeof _parseGeoBohrMeter === 'function' ? _parseGeoBohrMeter() : 0;
  const _geoErz = erzeugerList.find(e => e.key === 'geo');
  if (_geoErz && _geoErz.leistKw > 0 && _dynBohrMeter < 1) {
    const jaz = (_geoErz.elMwh > 0) ? _geoErz.waermeMwh / _geoErz.elMwh : 4.0;
    const tiefe = Math.min(400, Math.max(30, parseFloat(document.getElementById('geo-tiefe')?.value) || 100));
    const qPerM = Math.min(60, Math.max(10, parseFloat(document.getElementById('geo-q-perm')?.value) || 31));
    const erdwKw = _geoErz.leistKw * (jaz - 1) / jaz;
    const proSondeKw = qPerM * tiefe / 1000;
    const nL = Math.max(1, Math.ceil(erdwKw / proSondeKw));
    let nE = 1;
    if (_geoErz.waermeMwh > 0) {
      nE = Math.max(1, Math.ceil(_geoErz.waermeMwh * 1000 * (jaz - 1) / jaz / (proSondeKw * 2100)));
    }
    _dynBohrMeter = Math.max(nL, nE) * tiefe;
  }

  // Quartier-Strom
  let quartierStromMwh = 0;
  if (window.elQuartierH) { for (let t = 0; t < 8760; t++) quartierStromMwh += window.elQuartierH[t]; quartierStromMwh /= 1000; }
  else { const gebs = typeof gebaeude !== 'undefined' ? gebaeude : []; let s = 0; for (const g of gebs) s += parseFloat(g.stromJahr || g.stromkwh || 0); quartierStromMwh = s / 1000; }

  // PV-Daten
  const pvEigenMwh = pvBatResult ? (pvBatResult.pvEigenMwh != null ? pvBatResult.pvEigenMwh : pvBatResult.eigenMwh) : 0;
  const pvEinspMwh = pvBatResult ? (pvBatResult.pvEinspMwh != null ? pvBatResult.pvEinspMwh : pvBatResult.einspeiseMwh) : 0;
  const gesamtEigenMwh = pvBatResult ? (pvBatResult.eigenMwh || 0) : 0;
  const pvAutoChk = document.getElementById('pv-invest-auto');
  let pvInvPerKwp = OPT_INVEST_DEFAULT.pv;
  if (pvAutoChk?.checked && typeof CalcEngine !== 'undefined') pvInvPerKwp = CalcEngine.getPvInvestPerKwp(pvKwp);
  else pvInvPerKwp = parseFloat(document.getElementById('opt-pv-invest')?.value) || OPT_INVEST_DEFAULT.pv;

  // ErzList mit typ ergänzen
  const erzListTyped = erzeugerList.map(e => ({
    key: e.key, waermeMwh: e.waermeMwh, elMwh: e.elMwh,
    typ: (typeof ERZEUGER_CFG !== 'undefined' && ERZEUGER_CFG[e.key]) ? ERZEUGER_CFG[e.key].typ : null
  }));

  // BHKW-Erlös-Daten
  const bhkwEigMwh = pvBatResult ? (pvBatResult.bhkwEigenMwh || 0) : 0;
  const bhkwEinspMwh = pvBatResult ? (pvBatResult.bhkwEinspMwh || 0) : 0;

  const result = _calcKostenShared({
    pKw: _bPKw,
    erzList: erzListTyped,
    zinsPct: zinssatz * 100,
    lohn: parseFloat(document.getElementById('wirt-lohn')?.value) || 45,
    prices: { strom: pStrom, gas: pGas, hko: pHko, fw: pFw, pk: pPk, hhs: pHhs },
    etas: {
      gaskessel: (parseFloat(document.getElementById('gk-eta')?.value) || 92) / 100,
      heizoel: (parseFloat(document.getElementById('hko-eta')?.value) || 90) / 100,
      pellets: (parseFloat(document.getElementById('pk-eta')?.value) || 88) / 100,
      hhs: (parseFloat(document.getElementById('hhs-eta')?.value) || 85) / 100,
      bhkw: (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100,
      bhkwSigma: parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45
    },
    investFn: _bInvestFn,
    extra: {
      bohrMeter: _dynBohrMeter,
      nGeb: parseInt(document.getElementById('netz-n-geb')?.value) || 0,
      netzInvest: typeof _calcNetzInvestForOpt === 'function' ? _calcNetzInvestForOpt() : 0,
      stM2: stM2Opt || (stWaermeMwhOpt > 0 ? (parseFloat(document.getElementById('st-flaeche')?.value) || 0) : 0),
      optSpeicherVol: optSpeicherVol || 0,
      tsTyp: document.getElementById('ts-typ')?.value || 'puffer',
      tsDt: parseFloat(document.getElementById('ts-dt')?.value) || 40,
    },
    pv: {
      kwp: pvKwp, batKwh: batKwh,
      eigenMwh: pvEigenMwh, einspMwh: pvEinspMwh,
      gesamtEigenMwh: gesamtEigenMwh,
      invPerKwp: pvInvPerKwp,
      batInvPerKwh: parseFloat(document.getElementById('opt-bat-invest')?.value) || OPT_INVEST_DEFAULT.bat,
      vergModell: document.getElementById('pv-verg-modell')?.value || 'teil',
      pEinsp: pEinsp
    },
    strom: {
      quartierMwh: quartierStromMwh,
      bhkwEigenMwh: bhkwEigMwh, bhkwEinspMwh: bhkwEinspMwh,
      pBhkwEinsp: pBhkwEinsp, pBhkwKwkE: pBhkwKwkE, pBhkwKwkEig: pBhkwKwkEig
    },
    co2: {
      pCo2: parseFloat(document.getElementById('wirt-p-co2')?.value) || 0,
      alleET: document.getElementById('wirt-co2-alle')?.checked !== false,
      emf: {
        gas: typeof gasEmF !== 'undefined' ? gasEmF : 240,
        heizoel: typeof heizoelEmF !== 'undefined' ? heizoelEmF : 310,
        pellets: typeof pelletsEmF !== 'undefined' ? pelletsEmF : 20,
        hhs: typeof hhsEmF !== 'undefined' ? hhsEmF : 20,
        fernwaerme: typeof fernwaermeEmF !== 'undefined' ? fernwaermeEmF : 200,
        strom: typeof stromEmF !== 'undefined' ? stromEmF : 420
      }
    },
    gesamtMwh: gesamtMwh,
    stMwh: stWaermeMwhOpt || 0
  });

  // Debug

  const spez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const pvErtragMwh = pvKwp * spez / 1000;

  return {
    wgk: result.wgk, co2ta: result.co2ta, eeAnteil: result.eeAnteil,
    stromAutarkie: result.stromAutarkie, waermeAutarkie: result.waermeAutarkie,
    investGesamt: result.investGesamt, jahreskosten: result.jahreskosten,
    pvEigenMwh: pvEigenMwh, pvErtragMwh: pvErtragMwh
  };
}

// ── Score-Berechnung je Optimierungsziel ──────────────────────────────────
export function _optScore(kw, ziel) {
  if (ziel === 'min-wgk')       return kw.wgk;
  if (ziel === 'min-co2')       return kw.co2ta;
  if (ziel === 'max-autarkie')  return -(kw.stromAutarkie + kw.waermeAutarkie);
  if (ziel === 'min-kosten-ee') return kw.eeAnteil >= 65 ? kw.wgk : 1e9 + kw.wgk;
  return kw.wgk;
}

// ── PV+Bat Dimensionierung per marginaler Amortisation (Main-Thread) ──
export function _findOptPvBatMain(pvSteps, batSteps, demandH, bhkwElH, disp,
                           params, stMwh, stM2, tsVol, ziel, maxAmortJ) {
  const pStrom = params.pStrom;
  function einspeiseCtKwh(pvKwp) {
    const mod = document.getElementById('pv-verg-modell')?.value || 'teil';
    if (mod === 'teil') return pvKwp <= 0 ? 8.1 : (Math.min(pvKwp,10)*8.1 + Math.max(0,Math.min(pvKwp,40)-10)*7.0 + Math.max(0,pvKwp-40)*5.7) / pvKwp;
    if (mod === 'voll') return pvKwp <= 0 ? 12.9 : (Math.min(pvKwp,10)*12.9 + Math.max(0,pvKwp-10)*10.8) / pvKwp;
    return params.pEinsp || 8;
  }
  function pvInvPerKwp(kwp) {
    const chk = document.getElementById('pv-invest-auto');
    if (chk?.checked && typeof CalcEngine !== 'undefined') return CalcEngine.getPvInvestPerKwp(kwp);
    return parseFloat(document.getElementById('opt-pv-invest')?.value) || OPT_INVEST_DEFAULT.pv;
  }
  const batInvPerKwh = parseFloat(document.getElementById('opt-bat-invest')?.value) || OPT_INVEST_DEFAULT.bat;

  let bestPv = 0, bestBat = 0, bestScore = Infinity, bestKw = null;

  // PV=0 immer testen
  const pvBat0 = _optPvBatSim8760(0, 0, demandH, bhkwElH, disp);
  const kw0 = _optKennwerte2(disp, 0, 0, pvBat0, params, stMwh, stM2, tsVol);
  const sc0 = _optScore(kw0, ziel);
  if (sc0 < bestScore) { bestScore = sc0; bestPv = 0; bestBat = 0; bestKw = kw0; }

  for (const batK of batSteps) {
    let prevEigen = 0, prevEinsp = 0, prevPvK = 0;
    const batInvest = batK * batInvPerKwh;

    for (let pi = 0; pi < pvSteps.length; pi++) {
      const pvK = pvSteps[pi];
      if (pvK <= 0) continue;

      const pvBat = _optPvBatSim8760(pvK, batK, demandH, bhkwElH, disp);
      const curEigen = pvBat.pvEigenMwh || 0;
      const curEinsp = pvBat.pvEinspMwh || 0;

      const deltaPvInvest = (pvK - prevPvK) * pvInvPerKwp(pvK);
      const deltaInvest = deltaPvInvest + (pi === 0 ? batInvest : 0);
      const deltaEigen = curEigen - prevEigen;
      const deltaEinsp = curEinsp - prevEinsp;
      const deltaSavings = deltaEigen * pStrom * 10 + deltaEinsp * einspeiseCtKwh(pvK) * 10;

      if (deltaSavings <= 0 || deltaInvest / deltaSavings > maxAmortJ) break;

      const kw = _optKennwerte2(disp, pvK, batK, pvBat, params, stMwh, stM2, tsVol);
      const sc = _optScore(kw, ziel);
      if (sc < bestScore) { bestScore = sc; bestPv = pvK; bestBat = batK; bestKw = kw; }

      prevEigen = curEigen; prevEinsp = curEinsp; prevPvK = pvK;
    }
  }
  return { pvKwp: bestPv, batKwh: bestBat, kw: bestKw, score: bestScore };
}

// _optAborted, _optRunning, _optWorker, _optWorkers — defined in 10b-optimizer-ui.js

// ── Betrachtungsjahr-Auswahl für Optimierung ──────────────────────────────
export function _optPopulateYearSelect() {
  const sel = document.getElementById('opt-year');
  if (!sel) return;
  const minY = parseInt(document.getElementById('year-slider')?.min) || 2026;
  const maxY = parseInt(document.getElementById('year-slider')?.max) || 2050;
  const curY = typeof globalYear !== 'undefined' ? globalYear : minY;
  // Nur neu befüllen wenn nötig
  if (sel.options.length === (maxY - minY + 1) && sel.value === String(curY)) return;
  sel.innerHTML = '';
  for (let y = minY; y <= maxY; y++) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === curY) opt.selected = true;
    sel.appendChild(opt);
  }
  _optUpdateYearInfo();
  sel.onchange = _optUpdateYearInfo;
}

export function _optUpdateYearInfo() {
  const info = document.getElementById('opt-year-info');
  if (!info) return;
  const selY = parseInt(document.getElementById('opt-year')?.value) || 0;
  if (!window._basisLastgangKw || !window._basisGebWaermeSumme || window._basisGebWaermeSumme < 0.1) {
    info.textContent = '';
    return;
  }
  if (selY === window._basisYear) {
    info.innerHTML = '<span style="color:var(--muted);">= Berechnungsjahr (keine Skalierung)</span>';
    return;
  }
  let zielSumme = 0;
  for (const g of gebaeude) {
    const st = getComputedStats(g, selY);
    zielSumme += (st.waerme || 0);
  }
  const faktor = zielSumme / window._basisGebWaermeSumme;
  const pct = ((faktor - 1) * 100).toFixed(1);
  const sign = faktor >= 1 ? '+' : '';
  const col = faktor < 1 ? '#66bb6a' : faktor > 1 ? '#ff9800' : 'var(--muted)';
  info.innerHTML = '<span style="color:' + col + ';">Lastgang ' + sign + pct + '% (' + (faktor * 100).toFixed(0) + '%)</span>';
}

// ── Lastgang für Optimierung skalieren (temporär) ─────────────────────────
export function _optGetScaledLastgang(targetYear) {
  const ss = window.systemState;
  if (!ss?.lastgangKw) return null;
  if (!window._basisLastgangKw || !window._basisGebWaermeSumme || window._basisGebWaermeSumme < 0.1) {
    return new Float32Array(ss.lastgangKw); // keine Skalierung möglich, aktuellen zurückgeben
  }
  if (targetYear === window._basisYear) {
    return new Float32Array(window._basisLastgangKw);
  }
  let zielSumme = 0;
  for (const g of gebaeude) {
    const st = getComputedStats(g, targetYear);
    zielSumme += (st.waerme || 0);
  }
  const faktor = zielSumme / window._basisGebWaermeSumme;
  const basis = window._basisLastgangKw;
  const skaliert = new Float32Array(basis.length);
  for (let i = 0; i < basis.length; i++) skaliert[i] = basis[i] * faktor;
  return skaliert;
}

// ── Zeitschätzung für Optimierung ────────────────────────────────────────
export function _optUpdateEstimate() {
  const el = document.getElementById('opt-estimate');
  if (!el) return;
  const allKeys = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel'];
  const nKand = allKeys.filter(k => document.getElementById('opt-cand-' + k)?.checked).length;
  if (nKand === 0) { el.textContent = ''; return; }
  const pvAktiv = document.getElementById('opt-cand-pv')?.checked;
  const batAktiv = document.getElementById('opt-cand-bat')?.checked;
  const stAktiv = document.getElementById('opt-cand-st')?.checked;
  const tsAktiv = document.getElementById('opt-cand-ts')?.checked;
  const q = document.getElementById('opt-quality')?.value || 'standard';

  // Kombinations-Anzahl: C(n,1) + C(n,2) + C(n,3)
  const nKombis = nKand + nKand * (nKand - 1) / 2 + nKand * (nKand - 1) * (nKand - 2) / 6;
  // Leistungsstufen pro Quality
  const gN = { schnell: 5, standard: 7, gruendlich: 11 }[q];
  // Durchschnittliche Configs pro Kombi (gewichteter Mix aus 1er, 2er, 3er)
  const avg1 = gN, avg2 = gN * gN, avg3 = gN * gN * gN;
  const n1 = nKand, n2 = nKand * (nKand - 1) / 2, n3 = nKand * (nKand - 1) * (nKand - 2) / 6;
  const totalConfigs = n1 * avg1 + n2 * avg2 + n3 * avg3;
  // ST/TS Multiplikatoren
  const stSteps = stAktiv ? (nKand <= 4 ? 5 : nKand <= 6 ? 3 : 2) : 1;
  const tsSteps = tsAktiv ? (nKand <= 4 ? 5 : 3) : 1;
  // PV/Bat innere Schleife
  const pvN = { schnell: 2, standard: 3, gruendlich: 5 }[q];
  const batN = { schnell: 1, standard: 2, gruendlich: 3 }[q];
  const pvBatSteps = (pvAktiv ? pvN : 1) * (batAktiv ? batN : 1);

  const totalDispatches = totalConfigs * stSteps * tsSteps;
  const totalEvals = totalDispatches * pvBatSteps;
  // Empirischer Faktor: ~0.5ms pro Dispatch+PvBat auf modernem Rechner
  const estSec = totalEvals * 0.5 / 1000;
  // + Feinsuche ~40% Overhead
  const estTotal = estSec * 1.4;

  let label;
  if (estTotal < 10) label = '~' + Math.max(1, Math.round(estTotal)) + 's';
  else if (estTotal < 90) label = '~' + Math.round(estTotal / 5) * 5 + 's';
  else if (estTotal < 600) label = '~' + Math.round(estTotal / 60) + ' min';
  else label = '~' + (estTotal / 60).toFixed(0) + ' min';

  el.textContent = nKombis.toFixed(0) + ' Kombis \u00b7 ' + label;
  el.style.color = estTotal < 30 ? '#81c784' : estTotal < 120 ? '#ffcc80' : '#ef9a9a';
}

// Event-Listener für Kandidaten-Checkboxen → Schätzung aktualisieren
// Direkt ausführen (DOM existiert bereits, da dieses Script nach dem HTML steht)
(function() {
  const ids = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel','pv','bat','st','ts'];
  for (const k of ids) {
    const cb = document.getElementById('opt-cand-' + k);
    if (cb) cb.addEventListener('change', _optUpdateEstimate);
  }
  _optUpdateEstimate();
})();

export function _calcNetzInvestForOpt() {
  if (typeof netzEdges === 'undefined' || !netzEdges.length) return 0;
  if (typeof networkLocked !== 'undefined' && networkLocked && !window._netzSanierung) return 0;
  let s = 0;
  netzEdges.forEach(function(e) {
    if (e.pruned) return;
    const kpm = typeof getKostenProMKlasse === 'function' ? getKostenProMKlasse(e.dn, e.kostKlasse || 'mittel') : 0;
    s += kpm * (e.length || 0);
  });
  if (typeof networkLocked !== 'undefined' && networkLocked && window._netzSanierung) {
    const pct = (parseFloat(document.getElementById('netz-sanierung-pct')?.value) || 40) / 100;
    return Math.round(s * pct);
  }
  return Math.round(s);
}

export function _collectOptDomParams() {
  const f = (id, def) => parseFloat(document.getElementById(id)?.value) || def;
  const s = (id, def) => document.getElementById(id)?.value || def;
  const b = (id) => !!document.getElementById(id)?.checked;
  // Gütegrade dynamisch aus ERZEUGER_CFG
  const guetegrade = {};
  for (const k of ['lwwp','fg','geo']) {
    const gid = ERZEUGER_CFG[k]?.guetegradId;
    const v = gid ? parseFloat(document.getElementById(gid)?.value) : NaN;
    guetegrade[k] = isNaN(v) || v <= 0 ? (k === 'lwwp' ? 0.42 : k === 'fg' ? 0.56 : 0.50) : v;
  }
  // Invest-Kurven aus CalcEngine vorab berechnen für relevante Leistungen
  // (statt CalcEngine im Worker zu brauchen, pre-compute die €/kW Werte)
  const investKurven = {};
  if (typeof CalcEngine !== 'undefined') {
    for (const [optKey, ceKey] of Object.entries(_OPT_CE_KEY)) {
      const pts = [];
      for (let kw = 1; kw <= 5000; kw = kw < 50 ? kw + 1 : kw < 500 ? kw + 10 : kw + 50) {
        pts.push({ kw, eurKw: CalcEngine.investEurProKw(ceKey, kw) });
      }
      investKurven[optKey] = pts;
    }
  }
  // PV-Invest: Auto vs manuell
  let pvInvestMode = 'manual';
  let pvInvestManual = f('opt-pv-invest', OPT_INVEST_DEFAULT.pv);
  const pvAutoChk = document.getElementById('pv-invest-auto');
  if (pvAutoChk?.checked && typeof CalcEngine !== 'undefined') {
    pvInvestMode = 'auto';
  }
  // PV-Invest-Tabelle für auto-Modus
  const pvInvestTabelle = [
    {kwp:5,eurKwp:1400},{kwp:10,eurKwp:1300},{kwp:30,eurKwp:1150},{kwp:50,eurKwp:1050},
    {kwp:100,eurKwp:950},{kwp:300,eurKwp:850},{kwp:750,eurKwp:780},{kwp:1000,eurKwp:750},
    {kwp:5000,eurKwp:650},{kwp:10000,eurKwp:600}
  ];
  return {
    bhkwSkz: f('bhkw-skz', 0.45), skEta: f('sk-eta', 99) / 100, lwwpMinCop: f('lwwp-min-cop', 0),
    geoDtAbsenkung: f('geo-dt-absenkung', 0),
    geoTiefe: Math.min(400, Math.max(30, f('geo-tiefe', 100))),
    geoQPerM: Math.min(60, Math.max(10, f('geo-q-perm', 31))),
    tsDt: f('ts-dt', 40), tsVerlust: f('ts-verlust', 0.5), tsEntladeKw: f('ts-entlade-kw', 200),
    tsTyp: s('ts-typ', 'puffer'),
    etaGk: f('gk-eta', 92) / 100, etaHko: f('hko-eta', 90) / 100,
    etaPk: f('pk-eta', 88) / 100, etaHhs: f('hhs-eta', 85) / 100,
    etaBhkw: f('bhkw-eta', 88) / 100,
    pvSpez: f('pv-spez', 1000), stSpez: f('st-spez', 400),
    guetegrade,
    investKurven, pvInvestMode, pvInvestManual,
    pvInvestTabelle,
    batInvest: f('opt-bat-invest', OPT_INVEST_DEFAULT.bat),
    pvVergModell: s('pv-verg-modell', 'teil'),
    // Emissionsfaktoren
    stromEmF: typeof stromEmF !== 'undefined' ? stromEmF : 363,
    gasEmF: typeof gasEmF !== 'undefined' ? gasEmF : 240,
    heizoelEmF: typeof heizoelEmF !== 'undefined' ? heizoelEmF : 310,
    pelletsEmF: typeof pelletsEmF !== 'undefined' ? pelletsEmF : 20,
    hhsEmF: typeof hhsEmF !== 'undefined' ? hhsEmF : 20,
    fernwaermeEmF: typeof fernwaermeEmF !== 'undefined' ? fernwaermeEmF : 180,
    // CO2-Preis (€/t) für WGK-Berechnung
    pCo2: f('wirt-p-co2', 0),
    // Konstanten
    OPT_INVEST_DEFAULT: { ...OPT_INVEST_DEFAULT },
    OPT_NUTZUNG: { ...OPT_NUTZUNG }, OPT_IH: { ...OPT_IH },
    OPT_EE_KEYS: [...OPT_EE_KEYS], OPT_MERIT_ORDER: [...OPT_MERIT_ORDER],
    KESSEL_KEYS: ['gaskessel', 'heizoel', 'pellets', 'hhs'],
    ERZEUGER_TYP: (() => { const m = {}; for (const [k, v] of Object.entries(ERZEUGER_CFG)) m[k] = v.typ; return m; })(),
    // Wirtschaft-Bausteine: zusätzliche Daten für vollständige WGK-Berechnung
    lohn: f('wirt-lohn', 45),
    bohrMeter: typeof _parseGeoBohrMeter === 'function' ? _parseGeoBohrMeter() : 0,
    nGeb: parseInt(document.getElementById('netz-n-geb')?.value) || 0,
    netzInvest: _calcNetzInvestForOpt(),
    pvMaxAmort: f('opt-pv-max-amort', 10),
  };
}

export function _optVarianteUebernehmen(result, btnEl) {
  if (!result) { console.warn('OptVariante: kein result'); return; }
  try {
  const titel = result.keys.map(k => ERZEUGER_CFG[k]?.label || k).join('+');
  const varName = 'Opt: ' + titel;

  // Variante anlegen (wie addVariante(), aber ohne prompt)
  if (window.activeVariantId === null) {
    window.baseNetzSnapshot = captureNetzState();
    window.baseErzeugerSnapshot = captureErzeugerState();
  } else {
    const cur = varianten.find(v => v.id === window.activeVariantId);
    if (cur) { cur.netz = captureNetzState(); cur.erzeuger = captureErzeugerState(); }
  }

  // Alle Erzeuger deaktivieren (saubere Basis für neue Variante)
  if (typeof clearLwWp === 'function') clearLwWp();
  if (typeof clearGeo === 'function') clearGeo();
  if (typeof clearFliessgewaesser === 'function') clearFliessgewaesser();
  if (typeof clearGasKessel === 'function') clearGasKessel();
  if (typeof clearBhkw === 'function') clearBhkw();
  if (typeof clearStromkessel === 'function') clearStromkessel();
  if (typeof clearHeizoelKessel === 'function') clearHeizoelKessel();
  if (typeof clearPellets === 'function') clearPellets();
  if (typeof clearHhs === 'function') clearHhs();
  if (typeof clearFernwaerme === 'function') clearFernwaerme();
  setMeritOrderKeys([]);

  // Default-Position für Erzeuger ohne Koordinaten: Heizzentrale
  let defaultLat = null, defaultLng = null;
  const zIdOpt = parseInt(document.getElementById('netz-zentrale')?.value);
  if (zIdOpt) {
    const zGeb = gebaeude.find(g => g.id === zIdOpt);
    if (zGeb && zGeb.polygon) {
      const c = polygonCenter(zGeb.polygon);
      defaultLat = c.lat; defaultLng = c.lng;
    }
  }
  // Fallback: Kartenmitte
  if (defaultLat == null && typeof map !== 'undefined') {
    const mc = map.getCenter();
    defaultLat = mc.lat; defaultLng = mc.lng;
  }

  // Erzeuger der Kombination aktivieren und Leistung setzen
  // (ohne moBeiAktivierung in der Schleife — wird einmal am Ende aufgerufen)
  for (const erz of result.config) {
    const leist = Math.max(1, Math.round(erz.leistKw));
    const setBtn = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
    const showSec = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };
    switch (erz.key) {
      case 'gaskessel':
        document.getElementById('gk-leistung').value = leist;
        window.gasKessel = { leistungKw: leist };
        setBtn('btn-activate-gaskessel'); showSec('gaskessel-data-section');
        break;
      case 'bhkw':
        document.getElementById('bhkw-leistung-th').value = leist;
        window.bhkw = { leistungThKw: leist };
        setBtn('btn-activate-bhkw'); showSec('bhkw-data-section');
        break;
      case 'stromkessel':
        document.getElementById('sk-leistung').value = leist;
        window.stromkessel = { leistungKw: leist };
        setBtn('btn-activate-stromkessel'); showSec('stromkessel-data-section');
        break;
      case 'heizoel':
        document.getElementById('hko-leistung').value = leist;
        window.heizoelKessel = { leistungKw: leist };
        setBtn('btn-activate-heizoel'); showSec('heizoel-data-section');
        break;
      case 'pellets':
        document.getElementById('pk-leistung').value = leist;
        window.pelletsKessel = { leistungKw: leist };
        setBtn('btn-activate-pellets'); showSec('pellets-data-section');
        break;
      case 'hhs':
        document.getElementById('hhs-leistung').value = leist;
        window.heizhackschnitzel = { leistungKw: leist };
        setBtn('btn-activate-hhs'); showSec('hhs-data-section');
        break;
      case 'fernwaerme':
        document.getElementById('fw-leistung').value = leist;
        window.fernwaerme = { leistungKw: leist };
        setBtn('btn-activate-fernwaerme'); showSec('fernwaerme-data-section');
        break;
      case 'lwwp':
        document.getElementById('lwwp-leistung').value = leist;
        if (window.lwWp && window.lwWp.lat != null) {
          window.lwWp = { ...window.lwWp, leistungKw: leist };
        } else {
          window.lwWp = { lat: defaultLat, lng: defaultLng, leistungKw: leist, lwaDb: 80, visible: true };
        }
        window.lwWpVisible = true;
        showSec('lwwp-data-section');
        if (typeof redrawLwWp === 'function') redrawLwWp();
        break;
      case 'geo':
        document.getElementById('geo-leistung-eff').value = leist;
        // Heizlast + Wärme aus Optimierungsergebnis setzen (nötig damit calcGeoThermie nicht abbricht)
        document.getElementById('geo-heizlast').value = leist;
        { const simErz = result.sim?.erzeugerList?.find(e => e.key === 'geo');
          const waermeMwh = simErz?.waermeMwh || 0;
          document.getElementById('geo-waerme').value = waermeMwh > 0 ? Math.round(waermeMwh) : Math.round(leist * 2000 / 1000); }
        if (window.geoThermie && window.geoThermie.lat != null) {
          window.geoThermie = { ...window.geoThermie, leistungKwEff: leist };
        } else {
          // Geo-Sondenfeld braucht Dimensionierung — Defaults setzen
          const nSonden = Math.max(1, Math.round(leist / 8)); // ~8 kW pro Sonde
          const abstand = 6;
          const cols = Math.ceil(Math.sqrt(nSonden));
          const rows = Math.ceil(nSonden / cols);
          window.geoThermie = { lat: defaultLat, lng: defaultLng, leistungKwEff: leist,
            n_sonden: nSonden, abstand: abstand, cols: cols, rows: rows,
            breite: cols * abstand, laenge: rows * abstand, tiefe: 100 };
        }
        document.getElementById('geo-panel').classList.add('visible');
        if (typeof redrawGeo === 'function') redrawGeo();
        if (typeof calcGeoThermie === 'function') calcGeoThermie();
        break;
      case 'fg':
        document.getElementById('fg-leistung').value = leist;
        if (window.fliessgewaesser && window.fliessgewaesser.latlngs && window.fliessgewaesser.latlngs.length >= 2) {
          window.fliessgewaesser = { ...window.fliessgewaesser, leistungKw: leist };
        } else {
          // FG-WP braucht Fließgewässer-Linie — Platzhalter an Heizzentrale, User muss anpassen
          const offset = 0.0003;
          window.fliessgewaesser = { latlngs: [
            {lat: defaultLat + offset, lng: defaultLng - offset},
            {lat: defaultLat, lng: defaultLng},
            {lat: defaultLat - offset, lng: defaultLng + offset}
          ], leistungKw: leist, durchflussLs: 50, jaz: 4.5 };
        }
        showSec('fg-data-section');
        if (typeof redrawFliessgewaesser === 'function') redrawFliessgewaesser();
        break;
    }
    // Merit-Order eintragen (ohne sofortige Neuberechnung)
    if (!meritOrderKeys.includes(erz.key)) {
      meritOrderKeys.push(erz.key);
    }
  }

  // Solarthermie-Fläche aus Optimierungsergebnis übernehmen
  if (result.stM2 > 0) {
    const stEl = document.getElementById('st-flaeche');
    if (stEl) stEl.value = result.stM2;
    window.solarthermieAktiv = true;
    if (typeof updateSolarthermieDisplay === 'function') updateSolarthermieDisplay();
  } else {
    if (typeof clearSolarthermie === 'function') clearSolarthermie();
  }

  // Wärmespeicher-Volumen aus Optimierungsergebnis übernehmen
  if (result.tsVol > 0) {
    const tsVolEl = document.getElementById('ts-volumen');
    if (tsVolEl) tsVolEl.value = result.tsVol;
    window.thermSpeicherAktiv = true;
    if (typeof updateThermSpeicherDisplay === 'function') updateThermSpeicherDisplay();
  } else {
    if (typeof clearThermSpeicher === 'function') clearThermSpeicher();
  }

  // PV + Batterie aus Optimierungsergebnis übernehmen
  if (result.pvKwp > 0) {
    const pvEl = document.getElementById('pv-kwp');
    if (pvEl) pvEl.value = result.pvKwp.toFixed(1);
  }
  if (result.batKwh > 0) {
    const batEl = document.getElementById('bat-kapazitaet');
    if (batEl) batEl.value = result.batKwh.toFixed(1);
  }

  // Einmal am Ende: Icons aktualisieren
  if (typeof redrawErzeugerIcons === 'function') redrawErzeugerIcons();

  // Variante mit diesem Zustand speichern
  const id = 'v_' + Date.now();
  varianten.push({ id, name: varName, netz: captureNetzState(), erzeuger: captureErzeugerState(), gebaeudeAusschlüsse: [] });
  window.activeVariantId = id;
  renderVariantenBar();
  updateVariantBanner();

  // Neuberechnung auslösen
  if (typeof updateAllDeckungen === 'function') updateAllDeckungen();

  // Hinweis wenn standortabhängige Erzeuger automatisch platziert wurden
  const wpKeys = result.config.map(e => e.key).filter(k => ['lwwp','fg','geo'].includes(k));
  const wpLabels = wpKeys.map(k => ERZEUGER_CFG[k]?.label || k);
  if (wpKeys.length > 0) {
    showHint('\u2713 Variante "' + varName + '" angelegt. ' + wpLabels.join(', ') + ' wurde(n) an der Heizzentrale platziert \u2014 bitte Standort auf der Karte anpassen.', 6000);
  }

  // Kurze Rückmeldung am Button
  if (btnEl) {
    const orig = btnEl.textContent;
    btnEl.textContent = '\u2713 Variante angelegt';
    btnEl.style.color = '#81c784';
    setTimeout(() => { btnEl.textContent = orig; btnEl.style.color = ''; }, 2000);
  }

  } catch(err) {
    console.error('OptVariante Fehler:', err);
    showHint('Fehler beim Anlegen der Variante: ' + err.message);
  }
}

// ── Footer-Statuszeile ───────────────────────────────────────────────────
export function updateFooterStatus() {
  function _fsDot(el, ok, warn) {
    const d = el?.querySelector('.fs-dot');
    if (d) d.style.background = ok ? (warn ? '#f9a825' : '#66bb6a') : '#455a64';
  }
  function _fsTxt(el, txt) {
    const t = el?.querySelector('.fs-txt');
    if (t) t.textContent = txt;
  }

  // Wärme (mit Quellenangabe)
  const fsW = document.getElementById('fs-waerme');
  const fsHL = document.getElementById('fs-heizlast');
  const ss = window.systemState;
  const wMwh = ss?.gesamtMwhMitNV || ss?.nutzwaermeMwh || 0;
  const hatLg = !!glLastgangKw;
  const hatMonat = typeof glGetMonatswerte === 'function' && glGetMonatswerte().some(v => v !== null);
  const hatGesamt = typeof glGetGesamtMwh === 'function' && glGetGesamtMwh() > 0;
  const gebMwh = gebaeude.reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const gebKw = gebaeude.reduce((s, g) => s + (parseFloat(g.heizlast) || 0), 0);

  if (wMwh > 0) {
    // Quelle bestimmen
    let quelle = '';
    if (hatLg) quelle = 'Lastgang';
    else if (hatMonat) quelle = 'Monatswerte';
    else if (hatGesamt) quelle = 'Eingabe';
    else if (ss?.nurGebaeude) quelle = 'Gebäude';
    const qlabel = quelle ? ' (' + quelle + ')' : '';
    _fsTxt(fsW, Math.round(wMwh).toLocaleString('de-DE') + ' MWh' + qlabel);
    _fsDot(fsW, true);
  } else if (gebMwh > 0) {
    _fsTxt(fsW, '~' + Math.round(gebMwh).toLocaleString('de-DE') + ' MWh (Gebäude)');
    _fsDot(fsW, true, true);
  } else {
    _fsTxt(fsW, 'Wärme: —'); _fsDot(fsW, false);
  }

  // Heizlast (mit Quellenangabe)
  if (ss?.pMaxKw > 0) {
    let hlQuelle = hatLg ? 'Lastgang' : (ss?.nurGebaeude ? 'Gebäude' : 'Synthese');
    _fsTxt(fsHL, Math.round(ss.pMaxKw).toLocaleString('de-DE') + ' kW (' + hlQuelle + ')');
    _fsDot(fsHL, true);
  } else if (gebKw > 0) {
    _fsTxt(fsHL, '~' + Math.round(gebKw).toLocaleString('de-DE') + ' kW (Gebäude)');
    _fsDot(fsHL, true, true);
  } else {
    _fsTxt(fsHL, 'Heizlast: —'); _fsDot(fsHL, false);
  }

  // Strom (mit Quellenangabe)
  const fsS = document.getElementById('fs-strom');
  let sMwh = 0, sQuelle = '';
  if (window.elQuartierH) {
    for (let i = 0; i < 8760; i++) sMwh += window.elQuartierH[i]; sMwh /= 1000;
    sQuelle = 'Lastgang';
  } else {
    const manMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
    if (manMwh > 0) { sMwh = manMwh; sQuelle = 'Eingabe'; }
    else {
      // Gebäude-Aggregation
      const gebStromMwh = gebaeude.reduce((s, g) => s + getGebStromMwh(g), 0);
      if (gebStromMwh > 0) { sMwh = gebStromMwh; sQuelle = 'Gebäude'; }
    }
  }
  if (sMwh > 0) {
    const prefix = sQuelle === 'Gebäude' ? '~' : '';
    _fsTxt(fsS, prefix + Math.round(sMwh).toLocaleString('de-DE') + ' MWh (' + sQuelle + ')');
    _fsDot(fsS, true, sQuelle === 'Gebäude');
  } else { _fsTxt(fsS, 'Strom: —'); _fsDot(fsS, false); }

  // Erzeuger
  const fsE = document.getElementById('fs-erzeuger');
  const aktiv = meritOrderKeys.filter(k => isErzeugerAktiv(k));
  if (aktiv.length > 0) {
    const namen = aktiv.map(k => ERZEUGER_CFG[k]?.label || k).join(', ');
    _fsTxt(fsE, aktiv.length + ' Erz: ' + namen);
    _fsDot(fsE, true);
  } else { _fsTxt(fsE, 'Erzeuger: —'); _fsDot(fsE, false); }

  // WGK
  const fsWgk = document.getElementById('fs-wgk');
  const wgk = window._lastWgk;
  if (wgk && wgk > 0) { _fsTxt(fsWgk, 'WGK: ' + wgk.toFixed(1) + ' ct'); _fsDot(fsWgk, true); }
  else { _fsTxt(fsWgk, 'WGK: —'); _fsDot(fsWgk, false); }

  // EE-Anteil
  const fsEE = document.getElementById('fs-ee');
  const en = window._dispatchEnergy || {};
  const EE_KEYS = ['lwwp','fg','geo','pellets','hhs'];
  let eeWaerme = 0, gesWaerme = 0;
  for (const k of Object.keys(en)) {
    const w = en[k]?.waermeMwh || 0;
    gesWaerme += w;
    if (EE_KEYS.includes(k)) eeWaerme += w;
  }
  if (gesWaerme > 0) {
    const eePct = eeWaerme / gesWaerme * 100;
    window._lastEeAnteil = eePct;
    _fsTxt(fsEE, 'EE: ' + eePct.toFixed(0) + ' %');
    _fsDot(fsEE, true, eePct < 65);
  } else { window._lastEeAnteil = null; _fsTxt(fsEE, 'EE: —'); _fsDot(fsEE, false); }

  // Variante + Jahr
  const fsV = document.getElementById('fs-variante');
  if (fsV) {
    const vName = window.activeVariantId ? (varianten.find(v => v.id === window.activeVariantId)?.name || '?') : 'Basis';
    fsV.textContent = vName + ' · ' + (typeof globalYear !== 'undefined' ? globalYear : '—');
  }
  // Update Ergebnis-Tab KPIs + Step Progress
  if (typeof updateLpErgebnisKpis === 'function') updateLpErgebnisKpis();
  if (typeof updateLpStepProgress === 'function') updateLpStepProgress();
}

// Footer alle 2s aktualisieren + nach wichtigen Events
setTimeout(() => setInterval(updateFooterStatus, 2000), 0);

// ── Eingabestatus-Panel ──────────────────────────────────────────────────
export function toggleStatusPanel() {
  const p = document.getElementById('status-panel');
  if (!p) return;
  const vis = p.classList.toggle('visible');
  if (vis) updateStatusPanel();
}

export function updateStatusPanel() {
  const p = document.getElementById('status-panel');
  if (!p || !p.classList.contains('visible')) return;
  const body = document.getElementById('status-panel-body');
  if (!body) return;

  const dot = (ok) => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${ok ? '#66bb6a' : '#455a64'};margin-right:4px;vertical-align:middle;"></span>`;
  const warn = () => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f9a825;margin-right:4px;vertical-align:middle;"></span>`;
  const val = (v, unit) => v ? `<span style="color:var(--text);font-family:'DM Mono',monospace;">${v}</span> <span style="color:var(--muted);">${unit||''}</span>` : `<span style="color:#455a64;">—</span>`;

  let html = '';

  // ─── Abschnitt: Variante ────────────────────────────────────────────
  const varName = window.activeVariantId ? (varianten.find(v => v.id === window.activeVariantId)?.name || '?') : 'Basisdaten';
  html += `<div style="margin-bottom:8px;padding:5px 8px;background:var(--surface2);border-radius:5px;border-left:3px solid ${activeVariantId ? 'var(--accent)' : '#4caf50'};">`;
  html += `<span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;">Aktive Variante</span><br>`;
  html += `<span style="color:var(--text);font-size:12px;">${varName}</span>`;
  if (typeof globalYear !== 'undefined') html += ` <span style="color:var(--muted);font-size:9px;margin-left:6px;">Planungsjahr ${globalYear}</span>`;
  html += `</div>`;

  // ─── Abschnitt: Wärme-Lastgang ──────────────────────────────────────
  html += `<div style="margin-bottom:6px;"><span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;">Wärme-Lastgang</span></div>`;
  const hatLg = !!glLastgangKw;
  const monatswerte = typeof glGetMonatswerte === 'function' ? glGetMonatswerte() : [];
  const hatMonat = monatswerte.some(v => v !== null);
  const gesamtMwh = typeof glGetGesamtMwh === 'function' ? glGetGesamtMwh() : 0;
  const ss = window.systemState;

  html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin-bottom:8px;padding-left:4px;">`;
  html += `<div>${dot(hatLg)}Lastgang (8760h)</div><div>${hatLg ? val(Math.round(glLastgangKw.reduce((a,b)=>a+b,0)/1000).toLocaleString('de-DE'), 'MWh/a') : '<span style="color:#455a64;">nicht geladen</span>'}</div>`;
  html += `<div>${dot(hatMonat)}Monatswerte</div><div>${hatMonat ? val(Math.round(monatswerte.reduce((a,b)=>a+(b||0),0)).toLocaleString('de-DE'), 'MWh/a') : '<span style="color:#455a64;">nicht eingegeben</span>'}</div>`;
  html += `<div>${dot(gesamtMwh > 0)}Gesamtverbrauch</div><div>${gesamtMwh > 0 ? val(Math.round(gesamtMwh).toLocaleString('de-DE'), 'MWh/a') : '<span style="color:#455a64;">—</span>'}</div>`;
  html += `<div>${dot(!!ss)}Berechnet (systemState)</div><div>${ss ? val(Math.round(ss.gesamtMwhMitNV || ss.nutzwaermeMwh || 0).toLocaleString('de-DE'), 'MWh/a inkl. NV') : '<span style="color:#455a64;">noch nicht berechnet</span>'}</div>`;

  // Fall-Anzeige
  if (hatLg && !hatMonat) html += `<div colspan="2" style="grid-column:1/-1;color:#81c784;font-size:9px;">→ Fall 1: Lastgang direkt</div>`;
  else if (hatLg && hatMonat) html += `<div style="grid-column:1/-1;color:#81c784;font-size:9px;">→ Fall 2: Lastgang + Monatsskalierung</div>`;
  else if (!hatLg && hatMonat) html += `<div style="grid-column:1/-1;color:#81c784;font-size:9px;">→ Fall 3/4: SigLinDe-Synthese aus Monatswerten</div>`;
  else if (!hatLg && !hatMonat && gesamtMwh > 0) html += `<div style="grid-column:1/-1;color:#81c784;font-size:9px;">→ Fall 5: Reine SigLinDe-Synthese</div>`;
  else html += `<div style="grid-column:1/-1;color:#f9a825;font-size:9px;">→ Keine Wärmedaten eingegeben</div>`;
  html += `</div>`;

  // Gebäude als Quelle
  const gebMitDaten = gebaeude.filter(g => parseFloat(g.waerme) > 0 || parseFloat(g.heizlast) > 0).length;
  if (gebMitDaten > 0) {
    const gebSumHL = gebaeude.reduce((s,g) => s + (parseFloat(g.heizlast)||0), 0);
    const gebSumW = gebaeude.reduce((s,g) => s + (parseFloat(g.waerme)||0), 0);
    html += `<div style="padding-left:4px;margin-bottom:8px;">${dot(true)}Gebäude: ${gebMitDaten}/${gebaeude.length} mit Daten · ${val(Math.round(gebSumHL).toLocaleString('de-DE'), 'kW')} · ${val(gebSumW.toFixed(0), 'MWh/a')}</div>`;
  }

  // ─── Abschnitt: Strom-Lastgang ──────────────────────────────────────
  html += `<div style="margin-bottom:6px;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;">Strom-Lastgang (L&K)</span></div>`;
  const hatStromLg = !!window.elQuartierH;
  const stromMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
  html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin-bottom:8px;padding-left:4px;">`;
  html += `<div>${dot(hatStromLg)}CSV-Upload (8760h)</div><div>${hatStromLg ? val(Math.round(window.elQuartierH.reduce((a,b)=>a+b,0)/1000).toLocaleString('de-DE'), 'MWh/a') : '<span style="color:#455a64;">nicht geladen</span>'}</div>`;
  html += `<div>${dot(stromMwh > 0)}Jahressumme manuell</div><div>${stromMwh > 0 ? val(stromMwh.toLocaleString('de-DE'), 'MWh/a') : '<span style="color:#455a64;">—</span>'}</div>`;
  html += `</div>`;

  // ─── Abschnitt: Erzeuger ────────────────────────────────────────────
  html += `<div style="margin-bottom:6px;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;">Wärmeerzeuger (aktiv)</span></div>`;
  const activeErz = meritOrderKeys.filter(k => isErzeugerAktiv(k));
  if (activeErz.length === 0) {
    html += `<div style="padding-left:4px;color:#455a64;margin-bottom:8px;">Keine Erzeuger aktiv</div>`;
  } else {
    html += `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:1px 8px;margin-bottom:8px;padding-left:4px;">`;
    activeErz.forEach((k, i) => {
      const cfg = ERZEUGER_CFG[k];
      const leistKw = parseFloat(document.getElementById(cfg.leistungId)?.value) || 0;
      const en = window._dispatchEnergy?.[k];
      const mwh = en?.waermeMwh ? en.waermeMwh.toFixed(0) : '—';
      html += `<div><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${cfg.color};margin-right:3px;vertical-align:middle;"></span>${cfg.label}</div>`;
      html += `<div style="color:var(--text);font-family:'DM Mono',monospace;">${Math.round(leistKw).toLocaleString('de-DE')} kW</div>`;
      html += `<div style="color:var(--muted);font-family:'DM Mono',monospace;">${mwh} MWh/a</div>`;
    });
    html += `</div>`;
    // Auto-GK
    const agk = autoGkResult;
    if (agk && agk.waermeMwh > 0.1) {
      html += `<div style="padding-left:4px;margin-bottom:4px;">${warn()}Auto-Spitzenlastkessel: ${val(Math.round(agk.leistungKw), 'kW')} · ${val(agk.waermeMwh.toFixed(0), 'MWh/a')} · ${agk.deckungPct.toFixed(1)} %</div>`;
    }
  }

  // ─── Abschnitt: PV + Batterie ───────────────────────────────────────
  html += `<div style="margin-bottom:6px;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;">Strom: PV & Batterie</span></div>`;
  html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin-bottom:4px;padding-left:4px;">`;

  const pvKwp = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
  const pvSpez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  html += `<div>${dot(pvKwp > 0)}PV pauschal</div><div>${pvKwp > 0 ? val(pvKwp, 'kWp') + ` (${val(Math.round(pvKwp*pvSpez/1000), 'MWh/a')})` : '<span style="color:#455a64;">—</span>'}</div>`;

  // Gebäude-PV
  const gebPvEl = document.getElementById('geb-pv-summe');
  const gebPvActive = gebPvEl && gebPvEl.style.display !== 'none';
  html += `<div>${dot(gebPvActive)}Gebäude-PV</div><div>${gebPvActive ? '<span style="color:#ffd54f;">aktiv</span>' : '<span style="color:#455a64;">—</span>'}</div>`;

  // FF-PV
  const ffPvPanel = document.getElementById('ff-pv-panel');
  const ffPvActive = ffPvPanel?.classList.contains('visible');
  html += `<div>${dot(ffPvActive)}Freiflächen-PV</div><div>${ffPvActive ? '<span style="color:#ffd54f;">aktiv</span>' : '<span style="color:#455a64;">—</span>'}</div>`;

  // Batterie
  const batKwh = parseFloat(document.getElementById('bat-kapazitaet')?.value) || 0;
  const batKw = parseFloat(document.getElementById('bat-leistung')?.value) || 0;
  const batAktiv = batKwh > 0 && batKw > 0;
  html += `<div>${dot(batAktiv)}Batterie</div><div>${batAktiv ? val(batKwh, 'kWh') + ` / ${val(batKw, 'kW')}` : '<span style="color:#455a64;">—</span>'}</div>`;

  // BHKW-Strom
  const bhkwAktiv = isErzeugerAktiv('bhkw');
  if (bhkwAktiv) {
    const bhkwEl = window._dispatchEnergy?.bhkw?.elMwh;
    html += `<div>${dot(true)}BHKW-Strom</div><div>${bhkwEl ? val(bhkwEl.toFixed(0), 'MWh/a erzeugt') : '<span style="color:var(--muted);">nach Dispatch</span>'}</div>`;
  }
  html += `</div>`;

  // ─── Abschnitt: Wirtschaftlichkeit ──────────────────────────────────
  html += `<div style="margin-bottom:6px;border-top:1px solid var(--border);padding-top:6px;"><span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;">Wirtschaftlichkeit</span></div>`;
  const wgk = window._lastWgk;
  const pStrom = document.getElementById('wirt-p-strom')?.value;
  const pGas = document.getElementById('wirt-p-gas')?.value;
  html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;padding-left:4px;">`;
  html += `<div>${dot(!!wgk)}WGK gesamt</div><div>${wgk ? val(wgk.toFixed(1), 'ct/kWh') : '<span style="color:#455a64;">nach Wirtschaftlichkeitsberechnung</span>'}</div>`;
  html += `<div>${dot(!!pStrom)}Strompreis</div><div>${val(pStrom || '—', 'ct/kWh')}</div>`;
  html += `<div>${dot(!!pGas)}Gaspreis</div><div>${val(pGas || '—', 'ct/kWh')}</div>`;
  html += `</div>`;

  body.innerHTML = html;
}

// Auto-Update: nach Dispatch, Strom, Wirtschaftlichkeit
export const _origOnSystemStateUpdated = typeof onSystemStateUpdated === 'function' ? onSystemStateUpdated : null;
// Wir patchen nicht, sondern nutzen ein Interval das prüft ob Panel offen ist
setInterval(() => {
  if (document.getElementById('status-panel')?.classList.contains('visible')) updateStatusPanel();
}, 3000);

// ══════════════════════════════════════════════════════════════════════════════
