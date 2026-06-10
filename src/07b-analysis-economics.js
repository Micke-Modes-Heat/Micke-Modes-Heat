// 07b-analysis-economics.js — Wirtschaftlichkeit (VDI 2067), CO2-Emissionen, Jahresscheiben (NPV/Cashflow/LCOE)
// Split from 07-analysis-views.js
// NOTE: _calcKostenShared is also stringified into the Web Worker via .toString(), so it must remain a named global function.

// ── Wirtschaftlichkeit Hilfsfunktionen ────────────────────────────────────
import { _getEtaMap, bhkwCo2Gutschrift, gasEmF, gebaeude, networkLocked, netzEdges } from './01-globals-varianten.js';
import { updateFliessgewaesserData, updateLwWpDisplay } from './02c-karte-werkzeuge.js';
import { calcVerdraengungEmF, updateBhkwDisplay, updateFernwaermeDisplay, updateGasKesselDisplay, updateHeizoelDisplay, updateHhsDisplay, updatePelletsDisplay, updateStromkesselDisplay } from './03a-erzeuger.js';
import { calcGeoThermie } from './03b-netz.js';
import { getKostenProMKlasse } from './04a-ui-panels.js';
import { getThermSpeicherParams } from './06b-gl-berechnen.js';
import { DA_LABELS, _daColor } from './07a-analysis-charts.js';
import { CalcEngine } from './08-calc-engine.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { OPT_IH, OPT_INVEST_DEFAULT, OPT_NUTZUNG } from './config/optimizer-defaults.js';
import { autoGkResult } from './06c-dispatch-core.js';
import { fernwaermeEmF, heizoelEmF, hhsEmF, pelletsEmF, solarthermieAktiv, stromEmF, stromEmFLZ, thermSpeicherAktiv } from './01-globals-varianten.js';

window._wirtBausteineOverrides = window._wirtBausteineOverrides || {};
window._wirtVdiOverrides       = window._wirtVdiOverrides       || {};
window._wirtOpenGroups         = window._wirtOpenGroups         || {};

export function _parseGeoBohrMeter() {
  const el = document.getElementById('geo-r-length');
  if (!el) return 0;
  return parseFloat(el.textContent.replace(/[^\d.]/g, '')) || 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// Gemeinsame Kostenberechnung — wird von Panel, Optimizer UND Worker genutzt
// Pure function: kein DOM, keine Globals. Alle Eingaben über Parameter-Objekt.
// ══════════════════════════════════════════════════════════════════════════════
export function _calcKostenShared(p) {
  var zinsFrac = (p.zinsPct || 3.5) / 100;
  var pKw = p.pKw || {};
  var aktiv = function(k) { return (pKw[k] || 0) > 0.1; };
  var sumKw = 0; for (var _k in pKw) { if (pKw.hasOwnProperty(_k)) sumKw += (pKw[_k] || 0); }
  var prices = p.prices || {};
  var etas = p.etas || {};
  var extra = p.extra || {};
  var pv = p.pv || {};
  var strom = p.strom || {};
  var co2p = p.co2 || {};

  // VDI 2067 Annuität
  function annJK(inv, vdi) {
    var bed = (vdi.bedien || 0) * (p.lohn || 45);
    if (inv <= 0) return bed;
    if (vdi.n > 0) {
      var q = 1 + zinsFrac;
      var ann = zinsFrac > 0 ? (Math.pow(q, vdi.n) * (q - 1)) / (Math.pow(q, vdi.n) - 1) : 1 / vdi.n;
      return inv * (ann + (vdi.inst || 0) / 100 + (vdi.wart || 0) / 100) + bed;
    }
    return bed;
  }

  // ── Bausteine (Kapitalkosten) ──
  var bausteinRows = [];
  var basisInvest = 0, kapitalJk = 0;
  function add(id, inv, vdi) {
    var jk = annJK(inv, vdi);
    bausteinRows.push({ id: id, inv: inv, vdi: vdi, jk: jk });
    basisInvest += inv;
    kapitalJk += jk;
  }

  // Erzeuger-Hauptkomponenten
  var investFn = p.investFn || function() { return 0; };
  if (aktiv('lwwp'))        add('lwwp', investFn('lwwp', pKw.lwwp), {n:20,inst:1.0,wart:1.5,bedien:5});
  if (aktiv('fg'))          add('fg', investFn('fg', pKw.fg), {n:20,inst:2.0,wart:1.0,bedien:5});
  if (aktiv('geo'))         add('geo_wp', investFn('geo', pKw.geo), {n:20,inst:1.0,wart:1.5,bedien:5});
  if (aktiv('geo'))         add('geo_sonden', Math.round((extra.bohrMeter||0)*95), {n:50,inst:2.0,wart:1.0,bedien:0});
  if (aktiv('pellets'))     { var _pkw=pKw.pellets||0; add('pk', investFn('pellets',_pkw), {n:15,inst:3.0,wart:3.0,bedien:_pkw<50?100:_pkw<200?200:_pkw<500?300:408}); }
  if (aktiv('pellets'))     { var _pkw2=pKw.pellets||0; add('pk_lager', Math.round(_pkw2*100), {n:20,inst:3.0,wart:2.0,bedien:_pkw2<50?50:_pkw2<200?100:_pkw2<500?150:204}); }
  if (aktiv('hhs'))         { var _hkw=pKw.hhs||0; add('hhs_kessel', investFn('hhs',_hkw), {n:15,inst:3.0,wart:3.0,bedien:_hkw<50?150:_hkw<200?250:_hkw<500?350:408}); }
  if (aktiv('hhs'))         { var _hkw2=pKw.hhs||0; add('hhs_lager', Math.round(_hkw2*150), {n:30,inst:1.0,wart:1.0,bedien:_hkw2<50?100:_hkw2<200?200:_hkw2<500?400:612}); }
  if (aktiv('heizoel'))     add('hko', investFn('heizoel', pKw.heizoel), {n:20,inst:1.0,wart:2.0,bedien:20});
  if (aktiv('gaskessel'))   add('gk', investFn('gaskessel', pKw.gaskessel), {n:20,inst:1.0,wart:2.0,bedien:20});
  if (aktiv('bhkw'))        { var _bkw=pKw.bhkw||0; add('bhkw', investFn('bhkw',_bkw), {n:15,inst:3.0,wart:3.5,bedien:_bkw<20?100:_bkw<100?200:_bkw<500?300:408}); }
  if (aktiv('bhkw'))        add('bhkw_hydr', Math.round((pKw.bhkw||0)*150), {n:25,inst:1.5,wart:1.0,bedien:0});
  if (aktiv('stromkessel')) add('stromkessel', Math.round((pKw.stromkessel||0)*80), {n:20,inst:1.0,wart:1.0,bedien:0});
  if (aktiv('fernwaerme'))  add('fw_pumpe', Math.round((pKw.fernwaerme||0)*80), {n:18,inst:2.0,wart:1.0,bedien:0});

  // Solarthermie
  if ((extra.stM2||0) > 0)  add('solarthermie', Math.round(extra.stM2*300), {n:25,inst:1.0,wart:1.0,bedien:0});

  // Wärmespeicher
  if ((extra.optSpeicherVol||0) > 0) {
    var vol = extra.optSpeicherVol;
    var eurKwh;
    if (extra.tsTyp==='saisonal') eurKwh = 40;
    else if (extra.tsTyp==='gross') eurKwh = 80;
    else eurKwh = vol > 50 ? 60 : vol > 20 ? 70 : vol > 5 ? 80 : 100;
    add('thermSpeicher', Math.round(vol * 1.16 * (extra.tsDt||40) * eurKwh), {n:20,inst:1.0,wart:0.5,bedien:0});
  }

  // Nebenkomponenten
  var combustKw = (pKw.pellets||0)+(pKw.hhs||0)+(pKw.heizoel||0)+(pKw.gaskessel||0)+(pKw.bhkw||0);
  if (combustKw > 0.1)     add('schornstein', Math.round(combustKw*60), {n:40,inst:1.0,wart:2.0,bedien:0});
  if (sumKw > 0)            add('puffer', Math.round(sumKw*25*7/1000)*1000, {n:20,inst:1.0,wart:1.0,bedien:0});
  var schallKw = (pKw.lwwp||0)+(pKw.bhkw||0);
  if (schallKw > 0.1)      add('schallschutz', Math.round(schallKw*75), {n:25,inst:0.5,wart:0.5,bedien:0});
  var bioKw = (pKw.pellets||0)+(pKw.hhs||0);
  if (bioKw > 200)          add('entstaubung', bioKw<=500?20000:bioKw<=1000?30000:40000, {n:15,inst:2.0,wart:3.0,bedien:100});
  var nGeb = extra.nGeb || 0;
  if (nGeb > 1) {
    var avgKw = sumKw > 0 ? sumKw / nGeb : 50;
    add('huest', nGeb * (avgKw<30?5000:avgKw<100?8000:avgKw<300?12000:15000), {n:25,inst:1.0,wart:1.0,bedien:0});
  }
  var elKw = (pKw.lwwp||0)+(pKw.fg||0)+(pKw.geo||0)+(pKw.stromkessel||0);
  if (elKw > 500)           add('netzanschluss', Math.round(elKw*40), {n:40,inst:0.5,wart:0,bedien:0});
  if (aktiv('fg'))          add('fg_entnahme', Math.round((pKw.fg||0)*300), {n:30,inst:2.0,wart:1.0,bedien:100});
  if ((extra.netzInvest||0) > 0) add('waermenetz', extra.netzInvest, {n:50,inst:1.5,wart:0.5,bedien:40});

  // Prozentuale Zuschläge auf Basisinvestition
  var base = basisInvest;
  if (base > 0) {
    add('bauteil',  Math.round(base*0.05), {n:50,inst:1.0,wart:1.0,bedien:0});
    add('hydr_elt', Math.round(base*0.12), {n:40,inst:1.0,wart:0,  bedien:0});
    add('planung',  Math.round(base*0.10), {n:20,inst:0,  wart:0,  bedien:0});
    add('unvorg',   Math.round(base*0.07), {n:20,inst:0,  wart:0,  bedien:0});
  }

  var investGesamt = 0;
  for (var _i=0; _i<bausteinRows.length; _i++) investGesamt += bausteinRows[_i].inv;

  // ── Energiekosten ──
  var erzList = p.erzList || [];
  var wpSkStromMwh = 0;
  var bhkwElMwh = 0;
  for (var _e=0; _e<erzList.length; _e++) {
    var _erz = erzList[_e];
    if (_erz.typ === 'wp' || _erz.key === 'stromkessel') wpSkStromMwh += (_erz.elMwh||0);
    if (_erz.typ === 'kwk') bhkwElMwh += (_erz.elMwh||0);
  }
  var gesamtStromMwh = wpSkStromMwh + (strom.quartierMwh || 0);
  var pvEigenMwh = pv.eigenMwh || 0;
  var pvEinspMwh = pv.einspMwh || 0;

  var energieJk = 0;
  var energyRows = [];
  for (var _j=0; _j<erzList.length; _j++) {
    var erz = erzList[_j];
    var wMwh = erz.waermeMwh || 0;
    var eMwh = erz.elMwh || 0;
    if (wMwh < 0.1 && eMwh < 0.1) continue;
    var kosten = 0;
    if (erz.key === 'lwwp' || erz.key === 'fg' || erz.key === 'geo') {
      var pvAbzug = pvEigenMwh > 0 && gesamtStromMwh > 0 ? pvEigenMwh * (eMwh / gesamtStromMwh) : 0;
      kosten = Math.max(0, eMwh - pvAbzug) * (prices.strom||35) * 10;
    } else if (erz.key === 'fernwaerme') {
      kosten = wMwh * (prices.fw||17) * 10;
    } else if (erz.key === 'stromkessel') {
      var skEl = eMwh > 0.1 ? eMwh : wMwh;
      var pvAbzugSk = pvEigenMwh > 0 && gesamtStromMwh > 0 ? pvEigenMwh * (skEl / gesamtStromMwh) : 0;
      kosten = Math.max(0, skEl - pvAbzugSk) * (prices.strom||35) * 10;
    } else if (erz.typ === 'kwk' || erz.key === 'bhkw') {
      var bhkwSigma = etas.bhkwSigma || 0.45;
      var etaTh = (etas.bhkw||0.88) / (1 + bhkwSigma);
      var gasK = wMwh / etaTh * (prices.gas||10) * 10;
      // BHKW-Erlös
      var erloes = 0;
      if (strom.bhkwStromErloes != null && strom.bhkwStromErloes !== undefined) {
        erloes = strom.bhkwStromErloes;
      } else {
        var _bEig = strom.bhkwEigenMwh || 0;
        var _bEinsp = strom.bhkwEinspMwh || 0;
        erloes = _bEig * ((prices.strom||35) + (strom.pBhkwKwkEig||4)) * 10
               + _bEinsp * ((strom.pBhkwEinsp||8) + (strom.pBhkwKwkE||8)) * 10;
      }
      kosten = gasK - erloes;
    } else if (erz.key === 'gaskessel') {
      kosten = wMwh / (etas.gaskessel||0.92) * (prices.gas||10) * 10;
    } else if (erz.key === 'heizoel') {
      kosten = wMwh / (etas.heizoel||0.90) * (prices.hko||10) * 10;
    } else if (erz.key === 'pellets') {
      kosten = wMwh / (etas.pellets||0.88) * (prices.pk||8) * 10;
    } else if (erz.key === 'hhs') {
      kosten = wMwh / (etas.hhs||0.85) * (prices.hhs||6) * 10;
    }
    if (Math.abs(kosten) > 0.1) { energieJk += kosten; energyRows.push({key:erz.key, kosten:kosten}); }
  }

  // ── CO₂-Kosten ──
  var co2Jk = 0, co2ta = 0;
  var pCo2 = co2p.pCo2 || 0;
  var emf = co2p.emf || {};
  for (var _c=0; _c<erzList.length; _c++) {
    var erz2 = erzList[_c];
    var wM = erz2.waermeMwh||0, eM = erz2.elMwh||0;
    var tCo2 = 0;
    if (erz2.typ === 'wp' || erz2.key === 'stromkessel') {
      var pvA = pvEigenMwh > 0 && gesamtStromMwh > 0 ? pvEigenMwh * (eM / gesamtStromMwh) : 0;
      tCo2 = Math.max(0, eM - pvA) * (emf.strom||420) / 1e3;
    } else if (erz2.key === 'gaskessel') {
      tCo2 = wM / (etas.gaskessel||0.92) * (emf.gas||240) / 1e3;
    } else if (erz2.typ === 'kwk' || erz2.key === 'bhkw') {
      var etaThCo2 = (etas.bhkw||0.88) / (1 + (etas.bhkwSigma||0.45));
      tCo2 = wM / etaThCo2 * (emf.gas||240) / 1e3;
    } else if (erz2.key === 'heizoel') {
      tCo2 = wM / (etas.heizoel||0.90) * (emf.heizoel||310) / 1e3;
    } else if (erz2.key === 'pellets') {
      tCo2 = wM / (etas.pellets||0.88) * (emf.pellets||20) / 1e3;
    } else if (erz2.key === 'hhs') {
      tCo2 = wM / (etas.hhs||0.85) * (emf.hhs||20) / 1e3;
    } else if (erz2.key === 'fernwaerme') {
      tCo2 = wM * (emf.fernwaerme||200) / 1e3;
    }
    co2ta += tCo2;
    if (pCo2 > 0 && (co2p.alleET !== false || erz2.key === 'gaskessel' || erz2.key === 'heizoel' || erz2.key === 'bhkw')) {
      co2Jk += tCo2 * pCo2;
    }
  }

  // ── PV + Batterie ──
  var pvJk = 0, pvInvestGes = 0;
  var pvKwp = pv.kwp || 0;
  var batKwh = pv.batKwh || 0;
  function annF(z, n) { return z > 0 ? z * Math.pow(1+z,n) / (Math.pow(1+z,n)-1) : 1/n; }
  if (pvKwp > 0) {
    var pvInv = pvKwp * (pv.invPerKwp || 1200);
    pvInvestGes += pvInv;
    pvJk += pvInv * (annF(zinsFrac, 20) + 0.01);
    if (pvEinspMwh > 0.01) {
      var pEinspEff = pv.pEinsp || 8;
      if (pv.vergModell === 'teil') { pEinspEff = pvKwp <= 0 ? 8.1 : (Math.min(pvKwp,10)*8.1 + Math.max(0,Math.min(pvKwp,40)-10)*7.0 + Math.max(0,pvKwp-40)*5.7) / pvKwp; }
      else if (pv.vergModell === 'voll') { pEinspEff = pvKwp <= 0 ? 12.9 : (Math.min(pvKwp,10)*12.9 + Math.max(0,pvKwp-10)*10.8) / pvKwp; }
      pvJk -= pvEinspMwh * pEinspEff * 10;
    }
  }
  if (batKwh > 0) {
    var batInv = batKwh * (pv.batInvPerKwh || 400);
    pvInvestGes += batInv;
    pvJk += batInv * (annF(zinsFrac, 15) + 0.01);
  }

  // ── Ergebnis ──
  var jahreskosten = kapitalJk + energieJk + co2Jk + pvJk;
  var totalWaerme = (p.gesamtMwh || 0) + (p.stMwh || 0);
  var wgk = totalWaerme > 0 ? jahreskosten / totalWaerme / 10 : 0;

  // EE-Anteil
  var EE_KEYS_SET = {lwwp:1,fg:1,geo:1,pellets:1,hhs:1};
  var eeMwh = p.stMwh || 0;
  for (var _ee=0; _ee<erzList.length; _ee++) { if (EE_KEYS_SET[erzList[_ee].key]) eeMwh += erzList[_ee].waermeMwh; }
  var eeAnteil = totalWaerme > 0 ? eeMwh / totalWaerme * 100 : 0;

  // Strom-/Wärmeautarkie
  var gesamtEigenMwh = (pv.gesamtEigenMwh || pvEigenMwh);
  var stromAutarkie = gesamtStromMwh > 0 ? Math.min(100, gesamtEigenMwh / gesamtStromMwh * 100) : 0;
  var stMwh = p.stMwh || 0;
  var autarkeWaermeMwh = stMwh;
  if (pvEigenMwh > 0 && gesamtStromMwh > 0) {
    var pvAnteil = Math.min(1, pvEigenMwh / gesamtStromMwh);
    for (var _aw=0; _aw<erzList.length; _aw++) {
      if ((erzList[_aw].typ === 'wp' || erzList[_aw].key === 'stromkessel') && erzList[_aw].elMwh > 0) {
        autarkeWaermeMwh += erzList[_aw].waermeMwh * pvAnteil;
      }
    }
  }
  var waermeAutarkie = totalWaerme > 0 ? Math.min(100, autarkeWaermeMwh / totalWaerme * 100) : 0;

  return {
    investGesamt: investGesamt + pvInvestGes, kapitalJk: kapitalJk,
    energieJk: energieJk, co2Jk: co2Jk, pvJk: pvJk,
    jahreskosten: jahreskosten, wgk: wgk,
    co2ta: co2ta, eeAnteil: eeAnteil,
    stromAutarkie: stromAutarkie, waermeAutarkie: waermeAutarkie,
    pvEigenMwh: pvEigenMwh, pvEinspMwh: pvEinspMwh,
    totalWaerme: totalWaerme,
    bausteinRows: bausteinRows, energyRows: energyRows
  };
}

export function _calcBausteinJK(investEur, vdi, zins, lohn) {
  if (vdi.n > 0) {
    const q   = 1 + zins / 100;
    const ann = (zins > 0) ? (q ** vdi.n * (q - 1)) / (q ** vdi.n - 1) : 1 / vdi.n;
    return investEur * (ann + vdi.inst / 100 + vdi.wart / 100) + vdi.bedien * lohn;
  }
  return vdi.bedien * lohn;
}
export function _calcBausteinJKDetail(investEur, vdi, zins, lohn) {
  const annRate = vdi.n > 0 ? ((zins > 0) ? ((1+zins/100)**vdi.n * (zins/100)) / ((1+zins/100)**vdi.n - 1) : 1/vdi.n) : 0;
  return {
    annuitaet: investEur * annRate,
    instandhaltung: investEur * (vdi.inst || 0) / 100,
    wartung: investEur * (vdi.wart || 0) / 100,
    bedienung: (vdi.bedien || 0) * lohn,
  };
}

export function wirtBausteinBlur(el, id) {
  const v = el.value.trim().replace(/\./g, '').replace(',', '.');
  if (v === '') {
    delete window._wirtBausteineOverrides[id];
  } else {
    const num = parseFloat(v);
    if (!isNaN(num) && num >= 0) window._wirtBausteineOverrides[id] = Math.round(num);
  }
  setTimeout(calcWirtschaftPanel, 0);
}

export function wirtVdiBlur(el, id, field) {
  const v = el.value.trim().replace(',', '.');
  if (v === '') {
    if (window._wirtVdiOverrides[id]) {
      delete window._wirtVdiOverrides[id][field];
      if (!Object.keys(window._wirtVdiOverrides[id]).length) delete window._wirtVdiOverrides[id];
    }
  } else {
    const num = parseFloat(v);
    if (!isNaN(num) && num >= 0) {
      window._wirtVdiOverrides[id] = window._wirtVdiOverrides[id] || {};
      window._wirtVdiOverrides[id][field] = num;
    }
  }
  setTimeout(calcWirtschaftPanel, 0);
}

export function _syncZins() {
  const v = parseFloat(document.getElementById('wirt-zins')?.value) || 3.5;
  const hidden = document.getElementById('opt-zinssatz');
  const display = document.getElementById('opt-zinssatz-sync');
  if (hidden) hidden.value = v;
  if (display) display.textContent = v.toFixed(1) + ' %';
  const jsSync = document.getElementById('js-diskont-sync');
  if (jsSync) jsSync.textContent = v.toFixed(1);
}

export function calcWirtschaftPanel() {
  _syncZins();
  const wrap = document.getElementById('wirt-table-wrap');
  if (!wrap) return;

  const keys  = window._dispatchActiveKeys || [];
  const en    = window._dispatchEnergy    || {};
  const ov    = window._wirtBausteineOverrides || {};
  const ovVdi = window._wirtVdiOverrides       || {};

  if (!keys.length) {
    wrap.innerHTML = '<p style="color:var(--muted);font-size:11px;padding:8px;">Erst Berechnung starten.</p>';
    return;
  }

  const zins  = parseFloat(document.getElementById('wirt-zins')?.value)    || 2.7;
  const lohn  = parseFloat(document.getElementById('wirt-lohn')?.value)    || 45;
  const pStrom = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const pGas   = parseFloat(document.getElementById('wirt-p-gas')?.value)   || 10;
  const pHko   = parseFloat(document.getElementById('wirt-p-hko')?.value)   || 10;
  const pFw    = parseFloat(document.getElementById('wirt-p-fw')?.value)    || 17;
  const pPk    = parseFloat(document.getElementById('wirt-p-pk')?.value)    || 8;
  const pHhs   = parseFloat(document.getElementById('wirt-p-hhs')?.value)   || 6;

  // Installierte Leistung je Erzeuger (konsistent mit Optimierer: konfigurierte Leistung statt Dispatch-Peak)
  const pKw = {};
  keys.forEach(k => {
    const cfg = ERZEUGER_CFG[k];
    const konfigKw = cfg?.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0;
    if (k === '_autoGk') {
      // Auto-GK: Dispatch-Peak verwenden (keine konfigurierte Leistung)
      const arr = window._dispatchHourly?.[k];
      if (arr && arr.length > 0) {
        let m = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; pKw[k] = m;
      } else if (autoGkResult) {
        pKw[k] = autoGkResult.leistungKw || 0;
      } else {
        pKw[k] = 0;
      }
    } else if (konfigKw > 0.1) {
      pKw[k] = konfigKw;
    } else {
      // Fallback: Dispatch-Peak (z.B. wenn leistungId nicht vorhanden)
      const arr = window._dispatchHourly?.[k];
      if (arr && arr.length > 0) {
        let m = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; pKw[k] = m;
      }
    }
  });

  const aktiv = k => keys.includes(k) && (pKw[k] || 0) > 0.1;
  const sumKw  = keys.reduce((s, k) => s + (pKw[k] || 0), 0);
  const bohrm  = _parseGeoBohrMeter();

  const iKW = (tech, kw) => {
    if (typeof CalcEngine !== 'undefined') return Math.round(kw * CalcEngine.investEurProKw(tech, kw));
    return 0;
  };
  // Tooltip-Helfer: zeigt Kostenkurve-Formel + aktuelles Ergebnis
  const iKWtip = (tech, kw, extra) => {
    if (typeof CalcEngine === 'undefined' || !kw) return extra || '';
    const eur = CalcEngine.investEurProKw(tech, kw);
    const K = CalcEngine.INVEST_KURVEN?.[tech];
    let formel = '';
    if (K) {
      const isZen = kw > (K.maxDez || 100);
      const a = isZen ? K.aZen : K.aDez;
      const b = isZen ? K.bZen : K.bDez;
      if (a && b) formel = a + ' × P^(' + (b-1).toFixed(2) + ') = ' + Math.round(eur) + ' €/kW';
    }
    return (extra ? extra + '. ' : '') + (formel || Math.round(eur) + ' €/kW') + ' bei ' + Math.round(kw) + ' kW (Quelle: KWW-Technikkatalog 2025)';
  };

  // Direkte Bausteine
  const BD = [
    { id:'lwwp',       label:'Luft-WP (Anlage)',        vdi:{n:20,inst:1.0,wart:1.5,bedien:5},
      aktiv:()=>aktiv('lwwp'),    auto:()=>iKW('LuftWP', pKw.lwwp||0),
      get tooltip(){return iKWtip('LuftWP', pKw.lwwp||0, 'Luft-Wasser-WP inkl. Aufstellung');} },
    { id:'fg',         label:'Flusswasser-WP (Anlage)',  vdi:{n:20,inst:2.0,wart:1.0,bedien:5},
      aktiv:()=>aktiv('fg'),      auto:()=>iKW('FlussWP', pKw.fg||0),
      get tooltip(){return iKWtip('FlussWP', pKw.fg||0, 'WP-Anlage Flusswasser inkl. Wärmetauscher');} },
    { id:'geo_wp',     label:'Geo-WP (Anlage)',          vdi:{n:20,inst:1.0,wart:1.5,bedien:5},
      aktiv:()=>aktiv('geo'),     auto:()=>iKW('GeoWP', pKw.geo||0),
      get tooltip(){return iKWtip('GeoWP', pKw.geo||0, 'WP-Anlage Geothermie ohne Bohrungen');} },
    { id:'geo_sonden', label:'Erdsondenbohrungen',       vdi:{n:50,inst:2.0,wart:1.0,bedien:0},
      aktiv:()=>aktiv('geo'),     auto:()=>Math.round(bohrm * 95),
      tooltip:'Bohrmeter × 95 €/m (Duplex-Erdsonden inkl. Verfüllung, Marktdurchschnitt 2025)' },
    { id:'pk',         label:'Pelletkessel',
      get vdi(){ const kw=pKw.pellets||0; return {n:15,inst:3.0,wart:3.0,bedien:kw<50?100:kw<200?200:kw<500?300:408}; },
      aktiv:()=>aktiv('pellets'), auto:()=>iKW('Pellets', pKw.pellets||0),
      get tooltip(){const kw=pKw.pellets||0; const bh=kw<50?100:kw<200?200:kw<500?300:408; return iKWtip('Pellets', kw, 'Pelletkessel inkl. Regelung, ohne Lager. Bedienung: '+bh+' h/a');} },
    { id:'pk_lager',   label:'Pellet-Lager',
      get vdi(){ const kw=pKw.pellets||0; return {n:20,inst:3.0,wart:2.0,bedien:kw<50?50:kw<200?100:kw<500?150:204}; },
      aktiv:()=>aktiv('pellets'), auto:()=>Math.round((pKw.pellets||0)*100),
      get tooltip(){const kw=pKw.pellets||0; const bh=kw<50?50:kw<200?100:kw<500?150:204; return 'Pelletlager inkl. Silo + Förderschnecke, pauschal 100 €/kW. Bedienung: '+bh+' h/a';} },
    { id:'hhs',        label:'HHS-Kessel',
      get vdi(){ const kw=pKw.hhs||0; return {n:15,inst:3.0,wart:3.0,bedien:kw<50?150:kw<200?250:kw<500?350:408}; },
      aktiv:()=>aktiv('hhs'),     auto:()=>iKW('Hackschnitzel', pKw.hhs||0),
      get tooltip(){const kw=pKw.hhs||0; const bh=kw<50?150:kw<200?250:kw<500?350:408; return iKWtip('Hackschnitzel', kw, 'HHS-Kessel inkl. Förderung und Regelung. Bedienung: '+bh+' h/a');} },
    { id:'hhs_lager',  label:'HHS-Lager',
      get vdi(){ const kw=pKw.hhs||0; return {n:30, inst:1.0, wart:1.0, bedien:kw<50?100:kw<200?200:kw<500?400:612}; },
      aktiv:()=>aktiv('hhs'),     auto:()=>Math.round((pKw.hhs||0)*150),
      get tooltip(){const kw=pKw.hhs||0; const bh=kw<50?100:kw<200?200:kw<500?400:612; return 'HHS-Bunker + Schubboden/Austragung, 150 €/kW. Bedienung: '+bh+' h/a';} },
    { id:'hko',        label:'Heizölkessel',             vdi:{n:20,inst:1.0,wart:2.0,bedien:20},
      aktiv:()=>aktiv('heizoel'), auto:()=>iKW('Heizoel', pKw.heizoel||0),
      get tooltip(){return iKWtip('Heizoel', pKw.heizoel||0, 'Heizölkessel inkl. Brenner und Regelung');} },
    { id:'gk',         label:'Gaskessel',                vdi:{n:20,inst:1.0,wart:2.0,bedien:20},
      aktiv:()=>aktiv('gaskessel'),
      auto:()=>iKW('Gaskessel', (pKw.gaskessel||0)),
      get tooltip(){return iKWtip('Gaskessel', pKw.gaskessel||0, 'Gaskessel inkl. Brenner und Regelung');} },
    { id:'bhkw_agg',   label:'BHKW-Aggregat',
      get vdi(){ const kw=pKw.bhkw||0; return {n:15,inst:3.0,wart:3.5,bedien:kw<20?100:kw<100?200:kw<500?300:408}; },
      aktiv:()=>aktiv('bhkw'),   auto:()=>iKW('BHKW', pKw.bhkw||0),
      get tooltip(){
        const kw=pKw.bhkw||0; const bh=kw<20?100:kw<100?200:kw<500?300:408;
        return iKWtip('BHKW', kw, 'BHKW-Aggregat inkl. Schalldämpfer. Bedienung: '+bh+' h/a (nach Leistung skaliert)');
      } },
    { id:'bhkw_hydr',  label:'BHKW Hydraulik/Abgas',     vdi:{n:25,inst:1.5,wart:1.0,bedien:0},
      aktiv:()=>aktiv('bhkw'),   auto:()=>Math.round((pKw.bhkw||0)*150),
      tooltip:'BHKW-Peripherie: Hydraulik, Abgaswärmetauscher, 150 €/kW_th' },
    { id:'sk',         label:'Stromkessel',               vdi:{n:20,inst:1.0,wart:1.0,bedien:0},
      aktiv:()=>aktiv('stromkessel'), auto:()=>Math.round((pKw.stromkessel||0)*80),
      tooltip:'Elektroheizkessel ca. 80 €/kW' },
    { id:'solarthermie',label:'Solarthermie-Kollektoren', vdi:{n:25,inst:1.0,wart:1.0,bedien:0},
      aktiv:()=>solarthermieAktiv,
      auto:()=>{ const fl=parseFloat(document.getElementById('st-flaeche')?.value)||0; return Math.round(fl*300); },
      tooltip:'Flachkollektoren ca. 300 €/m² inkl. Montage' },
    { id:'thermSpeicher',label:'Wärmespeicher',          vdi:{n:20,inst:1.0,wart:0.5,bedien:0},
      aktiv:()=>thermSpeicherAktiv,
      auto:()=>{
        const p=getThermSpeicherParams(); if(!p) return 0;
        const typ=document.getElementById('ts-typ')?.value||'puffer';
        // €/kWh nach Typ, bei 'puffer' automatisch nach Volumen abstufen
        let eurProKwh;
        if (typ==='saisonal') eurProKwh = 40;
        else if (typ==='gross') eurProKwh = 80;
        else {
          // Puffer: große Speicher (>5 m³) sind deutlich günstiger pro kWh
          eurProKwh = p.vol > 50 ? 60 : p.vol > 20 ? 70 : p.vol > 5 ? 80 : 100;
        }
        return Math.round(p.kapKwh*eurProKwh);
      },
      get tooltip(){
        const p=getThermSpeicherParams();
        const typ=document.getElementById('ts-typ')?.value||'puffer';
        if (!p) return 'Puffer ~100 €/kWh (klein), ~60-80 €/kWh (>5 m³), Großspeicher 80, Saisonal 40';
        let eurKwh;
        if (typ==='saisonal') eurKwh = 40;
        else if (typ==='gross') eurKwh = 80;
        else eurKwh = p.vol > 50 ? 60 : p.vol > 20 ? 70 : p.vol > 5 ? 80 : 100;
        return `${Math.round(p.vol)} m³ × ${eurKwh} €/kWh = ${Math.round(p.kapKwh*eurKwh).toLocaleString('de-DE')} € (Typ: ${typ}, ${eurKwh} €/kWh bei ${Math.round(p.vol)} m³)`;
      } },
    { id:'fw_pumpe',   label:'FW-Übergabe/Pumpenstation',vdi:{n:18,inst:2.0,wart:1.0,bedien:0},
      aktiv:()=>aktiv('fernwaerme'),auto:()=>Math.round((pKw.fernwaerme||0)*80),
      tooltip:'Fernwärme-Übergabestation inkl. WT, Regelung, Pumpe, pauschal 80 €/kW (AGFW-Richtwert)' },
    { id:'schornstein',label:'Schornstein/Abgasanlage',  vdi:{n:40,inst:1.0,wart:2.0,bedien:0},
      aktiv:()=>aktiv('pellets')||aktiv('hhs')||aktiv('heizoel')||aktiv('gaskessel')||aktiv('bhkw'),
      auto:()=>Math.round(((pKw.pellets||0)+(pKw.hhs||0)+(pKw.heizoel||0)+(pKw.gaskessel||0)+(pKw.bhkw||0))*60),
      tooltip:'Schornstein für alle Feuerungsanlagen (inkl. BHKW), 60 €/kW' },
    { id:'puffer',     label:'Pufferspeicher',           vdi:{n:20,inst:1.0,wart:1.0,bedien:0},
      aktiv:()=>sumKw > 0,        auto:()=>Math.round(sumKw * 25 * 7 / 1000) * 1000,
      tooltip:'~25 L/kW à 7 €/L Speichervolumen (Stahl-Pufferspeicher, inkl. Dämmung + Aufstellung)' },
    { id:'schallschutz',label:'Schallschutz/Einhausung', vdi:{n:25,inst:0.5,wart:0.5,bedien:0},
      aktiv:()=>aktiv('lwwp')||aktiv('bhkw'),
      auto:()=>Math.round(((pKw.lwwp||0)+(pKw.bhkw||0))*75),
      tooltip:'Schallschutzhaube/Einhausung für LWWP und BHKW, ~75 €/kW (BImSchG-Anforderung bei Wohngebietsnähe)' },
    { id:'entstaubung',label:'Entstaubung Biomasse',     vdi:{n:15,inst:2.0,wart:3.0,bedien:100},
      aktiv:()=>{
        const pBio=(pKw.pellets||0)+(pKw.hhs||0);
        return pBio>200; // E-Filter erst ab 200 kW wirtschaftlich/pflicht (1.BImSchV)
      },
      auto:()=>{
        const pBio=(pKw.pellets||0)+(pKw.hhs||0);
        if(pBio<=500) return 20000;
        if(pBio<=1000) return 30000;
        return 40000;
      },
      tooltip:'Elektrofilter/Entstaubung für Biomassekessel >200 kW (1. BImSchV). Staffelung: ≤500kW: 20.000€, ≤1MW: 30.000€, >1MW: 40.000€' },
    { id:'huest',       label:'Hausübergabestationen',   vdi:{n:25,inst:1.0,wart:1.0,bedien:0},
      aktiv:()=>{
        const nGeb=parseInt(document.getElementById('netz-n-geb')?.value)||0;
        return nGeb>1; // Nur bei Nah-/Fernwärmenetz (>1 Gebäude)
      },
      auto:()=>{
        const nGeb=parseInt(document.getElementById('netz-n-geb')?.value)||0;
        const avgKw=sumKw>0&&nGeb>1?sumKw/nGeb:50;
        const eurProSt=avgKw<30?5000:avgKw<100?8000:avgKw<300?12000:15000;
        return nGeb>1?nGeb*eurProSt:0;
      },
      tooltip:'Dezentrale Hausübergabestationen (HÜST) im Wärmenetz. Staffelung nach Größe: <30kW: 5.000€, <100kW: 8.000€, <300kW: 12.000€, ≥300kW: 15.000€ je Station (AGFW 2024)' },
    { id:'netzanschluss',label:'Elektro-Netzanschluss', vdi:{n:40,inst:0.5,wart:0,bedien:0},
      aktiv:()=>(pKw.lwwp||0)+(pKw.fg||0)+(pKw.geo||0)+(pKw.stromkessel||0)>500,
      auto:()=>{
        const pEl=(pKw.lwwp||0)+(pKw.fg||0)+(pKw.geo||0)+(pKw.stromkessel||0);
        return Math.round(pEl*40); // ~40 €/kW für MS-Anschluss >500 kW
      },
      tooltip:'Mittelspannungs-Netzanschluss bei elektrischer Gesamtleistung >500 kW, pauschal ~40 €/kW (Stadtwerke-Erfahrungswerte)' },
    { id:'fg_entnahme', label:'Entnahmebauwerk Fließgew.',vdi:{n:30,inst:2.0,wart:1.0,bedien:100},
      aktiv:()=>aktiv('fg'),
      auto:()=>Math.round((pKw.fg||0)*300),
      tooltip:'Entnahmebauwerk + Rechen + Rückgabekanal für Fließgewässer-WP, ~300 €/kW (stark standortabhängig, ggf. +Wasserrechtl. Genehmigung)' },
    { id:'waermenetz', get label(){ return networkLocked ? (window._netzSanierung ? 'Wärmenetz (Sanierung)' : 'Wärmenetz (Bestand)') : 'Wärmenetz (KMR-Trassen)'; },  vdi:{n:50,inst:1.5,wart:0.5,bedien:40},
      aktiv:()=>typeof netzEdges!=='undefined'&&netzEdges.some(e=>!e.pruned),
      auto:()=>{
        if(typeof netzEdges==='undefined'||!netzEdges.length) return 0;
        // Bestandsnetz: Invest = 0 (Rohre bereits bezahlt), optional Sanierungsanteil
        if(networkLocked) {
          if(!window._netzSanierung) return 0;
          const pct = (parseFloat(document.getElementById('netz-sanierung-pct')?.value) || 40) / 100;
          let s=0;netzEdges.forEach(e=>{if(e.pruned)return;
            const kpm=typeof getKostenProMKlasse==='function'?getKostenProMKlasse(e.dn,e.kostKlasse||'mittel'):0;
            s+=kpm*(e.length||0);});
          return Math.round(s * pct);
        }
        let s=0;netzEdges.forEach(e=>{if(e.pruned)return;
          const kpm=typeof getKostenProMKlasse==='function'?getKostenProMKlasse(e.dn,e.kostKlasse||'mittel'):0;
          s+=kpm*(e.length||0);});return Math.round(s);
      },
      get tooltip(){
        if(networkLocked && !window._netzSanierung) return 'Bestandsnetz: Investitionskosten = 0 (Rohre bereits verlegt)';
        if(networkLocked && window._netzSanierung) return 'Netzsanierung: ' + (parseFloat(document.getElementById('netz-sanierung-pct')?.value)||40) + '% der Neubaukosten (Rohrtausch, Erdarbeiten)';
        return 'KMR-Rohrleitungen inkl. Erdarbeiten + Verlegung (KWW-Technikkatalog 2025). n=50a, Inst.1.5%, Wart.0.5%, Betrieb ~40h/a';
      } },
  ];

  // 1. Pass: direkte Bausteine
  const rows = [];
  let basisInvest = 0;
  for (const b of BD) {
    if (!b.aktiv()) continue;
    const autoVal = b.auto();
    const effVal  = (ov[b.id] !== undefined) ? ov[b.id] : autoVal;
    const effVdi  = { ...b.vdi, ...(ovVdi[b.id] || {}) };
    const jk      = _calcBausteinJK(effVal, effVdi, zins, lohn);
    rows.push({ ...b, autoVal, effVal, effVdi, jk });
    if (b.vdi.n > 0) basisInvest += effVal;
  }

  // 2. Pass: prozentuale Bausteine
  const PCT = [
    { id:'bauteil',  label:'Bauteil (5%)',          vdi:{n:50,inst:1.0,wart:1.0,bedien:0}, pct:0.05,
      tooltip:'Bauteilleistungen 5% der Basisinvestition' },
    { id:'hydr_elt', label:'Hydr./Elek./MSR (12%)', vdi:{n:40,inst:1.0,wart:0,  bedien:0}, pct:0.12,
      tooltip:'Hydraulik, Elektro und MSR-Technik 12% der Basisinvestition' },
    { id:'planung',  label:'Planung (10%)',          vdi:{n:20,inst:0,  wart:0,   bedien:0}, pct:0.10,
      tooltip:'Planung und Projektsteuerung 10% der Basisinvestition' },
    { id:'unvorg',   label:'Unvorhergesehenes (7%)',  vdi:{n:20,inst:0,  wart:0,   bedien:0}, pct:0.07,
      tooltip:'Risikozuschlag für Unvorhergesehenes 7% der Basisinvestition (HOAI/KfW-Empfehlung: 5–10%)' },
  ];
  if (basisInvest > 0) {
    for (const b of PCT) {
      const autoVal = Math.round(basisInvest * b.pct);
      const effVal  = (ov[b.id] !== undefined) ? ov[b.id] : autoVal;
      const effVdi  = { ...b.vdi, ...(ovVdi[b.id] || {}) };
      const jk      = _calcBausteinJK(effVal, effVdi, zins, lohn);
      rows.push({ ...b, autoVal, effVal, effVdi, jk, isPct: true });
    }
  }

  const gesamtInvest = rows.reduce((s, r) => s + r.effVal, 0);
  const gesamtJk     = rows.reduce((s, r) => s + r.jk,     0);

  // Aufschlüsselung der Kapitalkosten in Annuität, Instandhaltung, Wartung, Bedienung
  let _sumAnn = 0, _sumInst = 0, _sumWart = 0, _sumBed = 0;
  for (const r of rows) {
    const d = _calcBausteinJKDetail(r.effVal, r.effVdi, zins, lohn);
    _sumAnn  += d.annuitaet;
    _sumInst += d.instandhaltung;
    _sumWart += d.wartung;
    _sumBed  += d.bedienung;
  }

  // Energiekosten
  // PV-Eigenverbrauch: WP/SK-Stromkosten anteilig reduzieren (konsistent mit Optimierer)
  const _bil = window._stromBilanz || {};
  const _pvEigenMwh = _bil.pvEigenMwh || 0;
  const _pvEinspMwh = _bil.pvEinspMwh || 0;
  // Gesamter Strombedarf (WP + SK + Quartier) für anteilige Zuordnung
  let _wpSkElMwh = 0;
  keys.forEach(k => {
    const e = en[k] || {};
    if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') _wpSkElMwh += (e.elMwh || 0);
  });
  let _quartierStromMwh = 0;
  if (window.elQuartierH) { for (let t = 0; t < 8760; t++) _quartierStromMwh += window.elQuartierH[t]; _quartierStromMwh /= 1000; }
  else { const _gebs = typeof gebaeude !== 'undefined' ? gebaeude : []; let _sK = 0; for (const g of _gebs) _sK += parseFloat(g.stromJahr || g.stromkwh || 0); _quartierStromMwh = _sK / 1000; }
  const _gesamtStromMwh = _wpSkElMwh + _quartierStromMwh;

  const energyRows = [];
  keys.forEach(k => {
    const e    = en[k] || {};
    const wMwh = e.waermeMwh || 0;
    const eMwh = e.elMwh     || 0;
    if (wMwh < 0.1) return;
    let kosten = 0, detail = '';
    const ETA = _getEtaMap();
    const P   = { gaskessel:pGas, heizoel:pHko, pellets:pPk, hhs:pHhs, _autoGk:pGas };
    if (k === 'lwwp' || k === 'fg' || k === 'geo') {
      // PV-Eigenverbrauchsanteil abziehen (nur Netzbezug kostet)
      const pvAbzug = _pvEigenMwh > 0 && _gesamtStromMwh > 0 ? _pvEigenMwh * (eMwh / _gesamtStromMwh) : 0;
      const netzbezugMwh = Math.max(0, eMwh - pvAbzug);
      kosten = netzbezugMwh * pStrom * 10;
      detail = pvAbzug > 0.1
        ? `${eMwh.toFixed(0)} MWh Strom − ${pvAbzug.toFixed(0)} MWh PV = ${netzbezugMwh.toFixed(0)} MWh × ${pStrom} ct/kWh`
        : `${eMwh.toFixed(0)} MWh Strom × ${pStrom} ct/kWh`;
    } else if (k === 'fernwaerme') {
      kosten = wMwh * pFw * 10;
      detail = `${wMwh.toFixed(0)} MWh × ${pFw} ct/kWh`;
    } else if (k === 'bhkw') {
      // BHKW: Gaskosten − Stromerlös (differenziert)
      const etaBhkw = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
      const sigma = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      const etaTh = (1 + sigma) > 0 ? etaBhkw / (1 + sigma) : 0.4;
      const gasVerb = etaTh > 0 ? wMwh / etaTh : wMwh;
      const gasK = gasVerb * pGas * 10;
      const stromErl = window._bhkwStromErloes || 0;
      kosten = gasK - stromErl;
      const _bilHint = (window._stromBilanz?.bhkwEigenMwh > 0 || window._stromBilanz?.bhkwEinspMwh > 0) ? '' : ' ⚠ Eigen/Einsp.=60/40 geschätzt – Strom-Panel für genaue Werte';
      detail = `Gas: ${gasVerb.toFixed(0)} MWh × ${pGas} ct − Strom-Erlös: ${Math.round(stromErl).toLocaleString('de-DE')} €${_bilHint}`;
    } else if (k === 'stromkessel') {
      // PV-Eigenverbrauchsanteil abziehen (η ≈ 1.0 → wMwh ≈ eMwh)
      const skElMwh = eMwh > 0.1 ? eMwh : wMwh;
      const pvAbzugSk = _pvEigenMwh > 0 && _gesamtStromMwh > 0 ? _pvEigenMwh * (skElMwh / _gesamtStromMwh) : 0;
      const skNetzbezug = Math.max(0, skElMwh - pvAbzugSk);
      kosten = skNetzbezug * pStrom * 10;
      detail = pvAbzugSk > 0.1
        ? `${skElMwh.toFixed(0)} MWh Strom − ${pvAbzugSk.toFixed(0)} MWh PV = ${skNetzbezug.toFixed(0)} MWh × ${pStrom} ct/kWh`
        : `${wMwh.toFixed(0)} MWh Strom × ${pStrom} ct/kWh`;
    } else if (ETA[k]) {
      const verb = wMwh / ETA[k];
      kosten = verb * P[k] * 10;
      detail = `${verb.toFixed(0)} MWh Brennstoff × ${P[k]} ct/kWh`;
    }
    if (kosten > 0) energyRows.push({ label: DA_LABELS[k]||k, kosten, detail, color: _daColor(k) });
  });
  const gesamtEnergie = energyRows.reduce((s, r) => s + r.kosten, 0);

  // CO₂-Kosten (alle Energieträger, inkl. WP-Strom)
  const pCo2 = parseFloat(document.getElementById('wirt-p-co2')?.value) || 0; // €/t
  let co2Kosten = 0;
  if (pCo2 > 0) {
    // Emissionsfaktoren g CO₂eq/kWh (globale Variablen aus Kennwerte-Panel)
    // Verbrennungsanlagen: pro kWh Brennstoff → auf Wärme umrechnen über η
    // Wärmepumpen: pro kWh Strom (elMwh aus Dispatch)
    // Fernwärme: EmF bereits bezogen auf kWh Nutzwärme
    const alleET = document.getElementById('wirt-co2-alle')?.checked !== false;
    const emfMap = {
      gaskessel:   { emf: gasEmF,        eta: 0.92,  typ: 'verbrennung', fossil: true  },
      _autoGk:     { emf: gasEmF,        eta: 0.92,  typ: 'verbrennung', fossil: true  },
      heizoel:     { emf: heizoelEmF,    eta: 0.90,  typ: 'verbrennung', fossil: true  },
      pellets:     { emf: pelletsEmF,    eta: _getEtaMap().pellets, typ: 'verbrennung', fossil: false },
      hhs:         { emf: hhsEmF,        eta: _getEtaMap().hhs,     typ: 'verbrennung', fossil: false },
      fernwaerme:  { emf: fernwaermeEmF, eta: 1.0,   typ: 'nutzwaerme',  fossil: false },
      lwwp:        { emf: stromEmF,      eta: null,  typ: 'strom',       fossil: false },
      fg:          { emf: stromEmF,      eta: null,  typ: 'strom',       fossil: false },
      geo:         { emf: stromEmF,      eta: null,  typ: 'strom',       fossil: false },
    };
    keys.forEach(k => {
      const e   = en[k] || {};
      const cfg = emfMap[k];
      if (!cfg) return;
      if (!alleET && !cfg.fossil) return;
      let tCo2 = 0;
      if (cfg.typ === 'verbrennung') {
        const wMwh = e.waermeMwh || 0;
        if (wMwh < 0.1) return;
        tCo2 = wMwh / cfg.eta * (cfg.emf / 1e6) * 1e3; // MWh_W / η × g/kWh × 1000kWh/MWh / 1e6g/t
      } else if (cfg.typ === 'nutzwaerme') {
        const wMwh = e.waermeMwh || 0;
        if (wMwh < 0.1) return;
        tCo2 = wMwh * (cfg.emf / 1e6) * 1e3;
      } else if (cfg.typ === 'strom') {
        const eMwh = e.elMwh || 0;
        if (eMwh < 0.1) return;
        // PV-Eigenverbrauchsanteil abziehen — nur Netzbezug verursacht CO2
        const _pvAnteilCo2 = _pvEigenMwh > 0 && _gesamtStromMwh > 0 ? _pvEigenMwh * (eMwh / _gesamtStromMwh) : 0;
        const _netzbezugCo2 = Math.max(0, eMwh - _pvAnteilCo2);
        tCo2 = _netzbezugCo2 * (cfg.emf / 1e6) * 1e3;
      }
      co2Kosten += tCo2 * pCo2;
    });
    if (co2Kosten > 1) {
      energyRows.push({ label: `CO₂-Kosten (${pCo2} €/t)`, kosten: co2Kosten,
        detail: `${alleET ? 'alle Energieträger inkl. WP-Strom' : 'nur fossile Brennstoffe'} × ${pCo2} €/t`, color: '#f9a825' });
    }
  }
  // PV + Batterie: Investitionskosten und Einspeisevergütung (konsistent mit Optimierer)
  let pvJk = 0, pvInvestGes = 0;
  const _pvKwp = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
  const _batKwh = parseFloat(document.getElementById('bat-kapazitaet')?.value) || 0;
  if (_pvKwp > 0 || _batKwh > 0) {
    const _zinsFrac = (parseFloat(document.getElementById('wirt-zins')?.value) || 3.5) / 100;
    const _annF = (z, n) => z > 0 ? z * Math.pow(1+z,n) / (Math.pow(1+z,n)-1) : 1/n;
    if (_pvKwp > 0) {
      const pvAutoChk = document.getElementById('pv-invest-auto');
      let pvInvPerKwp;
      if (pvAutoChk?.checked && typeof CalcEngine !== 'undefined') {
        pvInvPerKwp = CalcEngine.getPvInvestPerKwp(_pvKwp);
      } else {
        pvInvPerKwp = parseFloat(document.getElementById('opt-pv-invest')?.value) || OPT_INVEST_DEFAULT.pv;
      }
      const pvInvEuro = _pvKwp * pvInvPerKwp;
      pvInvestGes += pvInvEuro;
      pvJk += pvInvEuro * (_annF(_zinsFrac, OPT_NUTZUNG.pv) + OPT_IH.pv);
      // Einspeisevergütung
      if (_pvEinspMwh > 0.01) {
        const pvVergModell = document.getElementById('pv-verg-modell')?.value || 'teil';
        let pEinspEff = parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8;
        if (pvVergModell === 'teil') {
          if (_pvKwp <= 10) pEinspEff = 8.1; else if (_pvKwp <= 40) pEinspEff = 7.0; else pEinspEff = 5.7;
        } else if (pvVergModell === 'voll') {
          if (_pvKwp <= 10) pEinspEff = 12.9; else pEinspEff = 10.8;
        }
        pvJk -= _pvEinspMwh * pEinspEff * 10;
      }
    }
    if (_batKwh > 0) {
      const batInvEuro = _batKwh * (parseFloat(document.getElementById('opt-bat-invest')?.value) || OPT_INVEST_DEFAULT.bat);
      pvInvestGes += batInvEuro;
      pvJk += batInvEuro * (_annF(_zinsFrac, OPT_NUTZUNG.bat) + OPT_IH.bat);
    }
    if (Math.abs(pvJk) > 1) {
      energyRows.push({ label: 'PV/Batterie', kosten: pvJk,
        detail: pvJk > 0
          ? `Annuität ${Math.round(pvInvestGes).toLocaleString('de-DE')} € Invest − Einsp. ${_pvEinspMwh.toFixed(0)} MWh`
          : `Einsp.-Vergütung übersteigt Annuität (Netto-Gutschrift)`,
        color: '#ffd54f' });
    }
  }

  const gesamtEnergieMitCo2 = energyRows.reduce((s, r) => s + r.kosten, 0);

  // WGK
  const gesamtMwh = window.systemState?.gesamtMwhMitNV
    || window.systemState?.nutzwaermeMwh
    || Object.values(en).reduce((s, e) => s + (e.waermeMwh || 0), 0)
    || 1;
  const wgk = gesamtMwh > 0.01 ? (gesamtJk + gesamtEnergieMitCo2) / gesamtMwh / 10 : 0; // ct/kWh


  window._lastWgk = wgk;
  window._lastInvestGes = gesamtInvest + pvInvestGes;
  window._lastJkGes = gesamtJk + gesamtEnergieMitCo2;

  // Erzeuger-WGKs aktualisieren (CO₂-Preis/Switch kann sich geändert haben)
  // Guard verhindert Endlosschleife: calcGeoThermie → dispatch → calcWirtschaftPanel
  if (!window._wirtRefreshing) {
    window._wirtRefreshing = true;
    updateGasKesselDisplay(); updateHeizoelDisplay(); updatePelletsDisplay();
    updateHhsDisplay(); updateFernwaermeDisplay(); updateStromkesselDisplay();
    updateLwWpDisplay(); updateFliessgewaesserData(); calcGeoThermie();
    updateBhkwDisplay();
    window._wirtRefreshing = false;
  }

  // Render
  const fmt  = v => Math.round(v).toLocaleString('de-DE');
  const fmtK = v => (v / 1000).toFixed(1).replace('.', ',');

  const vdiInput = (b, field, width) => {
    const defVal = b.vdi[field];
    const ovrVal = ovVdi[b.id]?.[field];
    const over   = ovrVal !== undefined;
    const dispVal = over ? ovrVal : defVal;
    return `<input type="text" value="${dispVal ?? ''}"
      style="width:${width}px;text-align:right;font-size:10px;
        background:${over?'rgba(255,152,0,0.15)':'transparent'};
        border:1px solid ${over?'#ff9800':'var(--border)'};
        border-radius:3px;color:var(--text);padding:1px 2px;"
      placeholder="${defVal ?? ''}"
      onblur="wirtVdiBlur(this,'${b.id}','${field}')"
      onfocus="this.select()"/>`;
  };

  // Gruppierung der Investbausteine (aufklappbar)
  const INVEST_GROUPS = [
    { label:'Wärmepumpen',     color:'#66bb6a', ids:['lwwp','fg','geo_wp','geo_sonden'] },
    { label:'Biomasse',        color:'#ff7043', ids:['pk','pk_lager','hhs','hhs_lager'] },
    { label:'Verbrennung/Gas', color:'#78909c', ids:['hko','gk'] },
    { label:'BHKW',            color:'#ab47bc', ids:['bhkw_agg','bhkw_hydr'] },
    { label:'Solarthermie',     color:'#ef6c00', ids:['solarthermie'] },
    { label:'Stromkessel',      color:'#ff69b4', ids:['sk'] },
    { label:'Sonstige',        color:'var(--muted)', ids:['thermSpeicher','fw_pumpe','puffer','schornstein','schallschutz','entstaubung','huest','netzanschluss','fg_entnahme','waermenetz'] },
    { label:'Nebenkosten',     color:'#ff9800', ids:['bauteil','hydr_elt','planung','unvorg'] },
  ];

  function _wirtDetailRow(b, gi, isOpen) {
    const over = ov[b.id] !== undefined;
    const vdi  = b.vdi || {};
    return '<tr class="wirt-detail wirt-grp-' + gi + '" style="display:' + (isOpen ? '' : 'none') + ';">' +
      '<td style="padding-left:18px;"><span style="color:' + (_daColor(b.id)||'var(--text)') + ';font-size:10px;">' + b.label + '</span>' +
        ' <span title="' + (b.tooltip||'') + '" style="cursor:help;color:var(--muted);font-size:9px;">ⓘ</span>' +
        (vdi.n===0 ? ' <span style="font-size:9px;color:var(--muted);">(nur Betrieb)</span>' : '') +
      '</td>' +
      '<td style="text-align:right;color:var(--muted);font-size:10px;">' + (vdi.n||'—') + '</td>' +
      '<td style="text-align:right;">' +
        '<input type="text" value="' + fmt(b.effVal) + '"' +
          ' style="width:82px;text-align:right;font-size:10px;' +
            'background:' + (over?'rgba(255,152,0,0.15)':'transparent') + ';' +
            'border:1px solid ' + (over?'#ff9800':'var(--border)') + ';' +
            'border-radius:3px;color:var(--text);padding:1px 4px;"' +
          ' placeholder="' + fmt(b.autoVal) + '"' +
          ' onblur="wirtBausteinBlur(this,\'' + b.id + '\')"' +
          ' onfocus="this.select()"/>' +
      '</td>' +
      '<td style="text-align:right;">' + vdiInput(b,'inst',38) + '</td>' +
      '<td style="text-align:right;">' + vdiInput(b,'wart',38) + '</td>' +
      '<td style="text-align:right;">' + vdiInput(b,'bedien',44) + '</td>' +
      '<td style="text-align:right;font-family:\'DM Mono\',monospace;">' + fmtK(b.jk) + ' k€/a</td>' +
      '<td style="text-align:right;font-family:\'DM Mono\',monospace;font-size:9px;color:#a5d6a7;">' + _wgkCt(b.jk) + '</td>' +
    '</tr>';
  }

  // WGK-Beitrag pro Baustein (ct/kWh)
  const _wgkMwh = gesamtMwh > 0.01 ? gesamtMwh : 1;
  const _wgkCt = (jk) => (jk / _wgkMwh / 10).toFixed(1);

  let invHtml = '';
  let grpIdx = 0;
  const _openGrps = window._wirtOpenGroups || {};
  for (const grp of INVEST_GROUPS) {
    const grpRows = rows.filter(r => grp.ids.includes(r.id));
    if (!grpRows.length) continue;
    const grpInvest = grpRows.reduce((s, r) => s + r.effVal, 0);
    const grpJk     = grpRows.reduce((s, r) => s + r.jk, 0);
    const gi = grpIdx;
    const isOpen = !!_openGrps[gi];
    const subLabel = grpRows.length === 1 ? grpRows[0].label : '(' + grpRows.length + ' Bausteine)';
    invHtml += '<tr class="wirt-grp-header" style="cursor:pointer;background:rgba(255,255,255,0.03);"' +
      ' data-click="window._wirtOpenGroups[' + gi + ']=!window._wirtOpenGroups[' + gi + '];document.querySelectorAll(\'.wirt-grp-' + gi + '\').forEach(function(r){r.style.display=window._wirtOpenGroups[' + gi + ']?\'\':\'none\'});this.querySelector(\'.wirt-grp-arrow\').textContent=window._wirtOpenGroups[' + gi + ']?\'▾\':\'▸\'">' +
      '<td style="font-weight:600;font-size:11px;" colspan="2">' +
        '<span class="wirt-grp-arrow" style="display:inline-block;width:14px;color:var(--muted);font-size:10px;">' + (isOpen ? '▾' : '▸') + '</span>' +
        '<span style="color:' + grp.color + ';">' + grp.label + '</span> ' +
        '<span style="font-weight:normal;font-size:9px;color:var(--muted);margin-left:4px;">' + subLabel + '</span>' +
      '</td>' +
      '<td style="text-align:right;font-family:\'DM Mono\',monospace;font-size:11px;">' + fmt(grpInvest) + ' €</td>' +
      '<td colspan="3"></td>' +
      '<td style="text-align:right;font-family:\'DM Mono\',monospace;">' + fmtK(grpJk) + ' k€/a</td>' +
      '<td style="text-align:right;font-family:\'DM Mono\',monospace;font-size:10px;color:#a5d6a7;">' + _wgkCt(grpJk) + '</td>' +
    '</tr>';
    grpRows.forEach(b => { invHtml += _wirtDetailRow(b, gi, isOpen); });
    grpIdx++;
  }

  const enHtml = energyRows.map(r =>
    `<tr>
      <td style="color:${r.color}">${r.label}</td>
      <td style="color:var(--muted);font-size:10px;">${r.detail}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">${fmtK(r.kosten)} k€/a</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:10px;color:#a5d6a7;">${_wgkCt(r.kosten)}</td>
    </tr>`
  ).join('');

  // Store waterfall data for visualization
  window._wirtWaterfallData = [];
  for (const grp of INVEST_GROUPS) {
    const grpRows = rows.filter(r => grp.ids.includes(r.id));
    if (!grpRows.length) continue;
    window._wirtWaterfallData.push({ label: grp.label, value: grpRows.reduce((s, r) => s + r.effVal, 0), color: grp.color });
  }

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Investitionsbausteine</div>
      <div style="display:flex;gap:2px;">
        <button class="viz-btn active" id="wirt-view-table" data-click="_wirtSetView('table')" style="font-size:9px;padding:2px 8px;">Tabelle</button>
        <button class="viz-btn" id="wirt-view-waterfall" data-click="_wirtSetView('waterfall')" style="font-size:9px;padding:2px 8px;">Aufbau</button>
      </div>
    </div>
    <div id="wirt-wrap-table">
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px;">
      <thead><tr style="color:var(--muted);font-size:9px;border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding-bottom:4px;">Baustein</th>
        <th style="text-align:right;">n (a)</th>
        <th style="text-align:right;">Invest (€)</th>
        <th style="text-align:right;">Instandh. %</th>
        <th style="text-align:right;">Wartung %</th>
        <th style="text-align:right;">Bedienung h</th>
        <th style="text-align:right;">JK k€/a</th>
        <th style="text-align:right;color:#a5d6a7;">ct/kWh</th>
      </tr></thead>
      <tbody>${invHtml}</tbody>
      <tfoot><tr style="border-top:1px solid var(--border);font-weight:600;font-size:11px;">
        <td colspan="4">Kapital- &amp; Betriebskosten</td>
        <td></td><td></td>
        <td style="text-align:right;font-family:'DM Mono',monospace;">${fmtK(gesamtJk)} k€/a</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(gesamtJk)}</td>
      </tr></tfoot>
    </table>
    </div>
    <div id="wirt-wrap-waterfall" style="display:none;">
      <canvas id="wirt-waterfall-canvas" height="260" style="width:100%;display:block;border-radius:4px;margin-bottom:14px;"></canvas>
    </div>
    ${enHtml ? `
    <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Energiekosten</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px;">
      <thead><tr style="color:var(--muted);font-size:9px;border-bottom:1px solid var(--border);">
        <th style="text-align:left;">Erzeuger</th><th style="text-align:left;">Basis</th><th style="text-align:right;">k€/a</th><th style="text-align:right;color:#a5d6a7;">ct/kWh</th>
      </tr></thead>
      <tbody>${enHtml}</tbody>
      <tfoot><tr style="border-top:1px solid var(--border);font-weight:600;">
        <td colspan="2">Energiekosten gesamt</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;">${fmtK(gesamtEnergieMitCo2)} k€/a</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(gesamtEnergieMitCo2)}</td>
      </tr></tfoot>
    </table>` : ''}
    <div style="background:rgba(76,175,80,0.12);border:2px solid #66bb6a;border-radius:8px;padding:14px 10px;margin-bottom:8px;">
      <div style="text-align:center;margin-bottom:10px;">
        <div style="font-size:9px;font-weight:600;color:#a5d6a7;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">WGK (VDI 2067 Annuität) <span class="htip" data-tip="Wärmegestehungskosten nach VDI 2067: Investitionskosten werden auf jährliche Raten umgerechnet (Annuität). Dazu Wartung, Instandhaltung und Energiekosten. Abzüglich BHKW-Stromerlöse. Geteilt durch die gesamte Nutzwärme.">?</span></div>
        <div style="font-family:'DM Mono',monospace;font-size:28px;font-weight:700;color:#a5d6a7;">${wgk.toFixed(1)} <span style="font-size:14px;font-weight:400;">ct/kWh</span></div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;border-top:1px solid rgba(165,214,167,0.2);">
        <tr><td style="color:var(--muted);padding:3px 0;">Annuität (Kapital) <span class="htip" data-tip="Jährliche Rate aus den Investitionskosten — wie bei einem Kredit. Umfasst Zinsen und Tilgung über die Nutzungsdauer der Anlage (VDI 2067).">?</span></td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(_sumAnn)} ct/kWh</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);padding-left:8px;">${fmtK(_sumAnn)} k&euro;/a</td></tr>
        <tr><td style="color:var(--muted);padding:3px 0;">Instandhaltung</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(_sumInst)} ct/kWh</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);padding-left:8px;">${fmtK(_sumInst)} k&euro;/a</td></tr>
        <tr><td style="color:var(--muted);padding:3px 0;">Wartung</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(_sumWart)} ct/kWh</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);padding-left:8px;">${fmtK(_sumWart)} k&euro;/a</td></tr>
        <tr><td style="color:var(--muted);padding:3px 0;">Bedienung</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(_sumBed)} ct/kWh</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);padding-left:8px;">${fmtK(_sumBed)} k&euro;/a</td></tr>
        <tr style="border-top:1px solid rgba(165,214,167,0.2);">
            <td style="color:var(--muted);padding:3px 0;">Energiekosten (inkl. CO₂)</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${_wgkCt(gesamtEnergieMitCo2)} ct/kWh</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);padding-left:8px;">${fmtK(gesamtEnergieMitCo2)} k&euro;/a</td></tr>
        <tr style="border-top:1px solid rgba(165,214,167,0.3);font-weight:600;">
            <td style="padding:4px 0;color:#a5d6a7;">Gesamt</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;">${wgk.toFixed(1)} ct/kWh</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:#a5d6a7;padding-left:8px;">${fmtK(gesamtJk+gesamtEnergieMitCo2)} k&euro;/a</td></tr>
      </table>
    </div>
    <div style="background:rgba(255,152,0,0.1);border:1px solid #ff9800;border-radius:6px;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:center;">
      <div><div style="font-family:'DM Mono',monospace;font-size:14px;color:#ffb74d;">${fmtK(gesamtJk+gesamtEnergieMitCo2)} k&euro;/a</div><div style="font-size:9px;color:var(--muted);">Jahreskosten gesamt</div></div>
      <div><div style="font-family:'DM Mono',monospace;font-size:14px;color:#fff176;">${fmt(gesamtInvest/1000)} k&euro;</div><div style="font-size:9px;color:var(--muted);">Investition gesamt</div></div>
    </div>
  `;

  // CO₂-Übersicht Chart
  _renderWirtCo2Chart(keys, en);

  // Sensitivitätsanalyse und Jahresscheiben automatisch mitberechnen
  if (typeof runSensitivitaet === 'function') runSensitivitaet();
  if (typeof calcJahresscheiben === 'function') calcJahresscheiben();
}

// ── Waterfall toggle ────────────────────────────────────────────────
export function _wirtSetView(mode) {
  ['table','waterfall'].forEach(v => {
    document.getElementById('wirt-view-' + v)?.classList.toggle('active', v === mode);
    const w = document.getElementById('wirt-wrap-' + v);
    if (w) w.style.display = v === mode ? '' : 'none';
  });
  if (mode === 'waterfall') _wirtRenderWaterfall();
}

export function _wirtRenderWaterfall() {
  const canvas = document.getElementById('wirt-waterfall-canvas');
  if (!canvas) return;
  const W = canvas.parentElement?.clientWidth || canvas.offsetWidth || 500;
  canvas.width = W;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const items = window._wirtWaterfallData;
  if (!items || !items.length) {
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Keine Investitionsdaten.', 20, H / 2);
    return;
  }

  const total = items.reduce((s, i) => s + i.value, 0);
  const pad = { top: 24, right: 16, bottom: 52, left: 56 };
  const n = items.length + 1;
  const barW = Math.min(42, (W - pad.left - pad.right) / n * 0.6);
  const gapX = (W - pad.left - pad.right) / n;
  const maxVal = total * 1.12;
  const plotH = H - pad.top - pad.bottom;
  const yScale = plotH / maxVal;

  // Y grid
  ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = '#78909c';
  const step = Math.pow(10, Math.floor(Math.log10(maxVal))) || 100000;
  const gridStep = maxVal / step > 6 ? step * 2 : step;
  for (let v = 0; v <= maxVal; v += gridStep) {
    const y = pad.top + plotH - v * yScale;
    ctx.strokeStyle = '#333844'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillText((v / 1000).toFixed(0) + 'k €', pad.left - 4, y + 3);
  }

  let running = 0;
  items.forEach((item, i) => {
    const x = pad.left + gapX * i + (gapX - barW) / 2;
    const base = running;
    running += item.value;
    const y1 = pad.top + plotH - running * yScale;
    const barH = Math.abs(item.value) * yScale;

    ctx.fillStyle = item.color || '#4caf50';
    const r = 3;
    ctx.beginPath();
    ctx.moveTo(x + r, y1); ctx.lineTo(x + barW - r, y1);
    ctx.quadraticCurveTo(x + barW, y1, x + barW, y1 + r);
    ctx.lineTo(x + barW, y1 + barH); ctx.lineTo(x, y1 + barH);
    ctx.lineTo(x, y1 + r); ctx.quadraticCurveTo(x, y1, x + r, y1);
    ctx.fill();

    // Value above
    ctx.fillStyle = '#e8eaf0'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
    ctx.fillText((item.value / 1000).toFixed(0) + 'k', x + barW / 2, y1 - 4);

    // X label
    ctx.fillStyle = item.color || '#78909c'; ctx.font = '9px system-ui';
    ctx.save(); ctx.translate(x + barW / 2, H - pad.bottom + 8);
    ctx.rotate(-Math.PI / 5); ctx.textAlign = 'right';
    ctx.fillText(item.label, 0, 0); ctx.restore();

    // Connector
    if (i < items.length - 1) {
      const nextX = pad.left + gapX * (i + 1) + (gapX - barW) / 2;
      const cy = pad.top + plotH - running * yScale;
      ctx.strokeStyle = '#333844'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x + barW, cy); ctx.lineTo(nextX, cy); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Total bar
  const tx = pad.left + gapX * items.length + (gapX - barW) / 2;
  const ty = pad.top + plotH - total * yScale;
  const tH = total * yScale;
  ctx.fillStyle = '#607d8b';
  const r = 3;
  ctx.beginPath();
  ctx.moveTo(tx + r, ty); ctx.lineTo(tx + barW - r, ty);
  ctx.quadraticCurveTo(tx + barW, ty, tx + barW, ty + r);
  ctx.lineTo(tx + barW, ty + tH); ctx.lineTo(tx, ty + tH);
  ctx.lineTo(tx, ty + r); ctx.quadraticCurveTo(tx, ty, tx + r, ty);
  ctx.fill();
  ctx.fillStyle = '#e8eaf0'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
  ctx.fillText((total / 1000).toFixed(0) + 'k €', tx + barW / 2, ty - 4);
  ctx.fillStyle = '#ff9800'; ctx.font = 'bold 9px system-ui';
  ctx.save(); ctx.translate(tx + barW / 2, H - pad.bottom + 8);
  ctx.rotate(-Math.PI / 5); ctx.textAlign = 'right';
  ctx.fillText('Gesamt', 0, 0); ctx.restore();
}

export function _renderWirtCo2Chart(keys, en) {
  const wrap   = document.getElementById('wirt-co2-chart-wrap');
  const canvas = document.getElementById('wirt-co2-canvas');
  if (!wrap || !canvas) return;

  // Emissionsfaktoren
  const ETA  = _getEtaMap();
  const EMF_HEUTE = { gaskessel:gasEmF, heizoel:heizoelEmF, pellets:pelletsEmF, hhs:hhsEmF,
                  _autoGk:gasEmF, fernwaerme:fernwaermeEmF, lwwp:stromEmF, fg:stromEmF, geo:stromEmF, stromkessel:stromEmF, bhkw:gasEmF };
  const EMF_2050  = { gaskessel:gasEmF, heizoel:heizoelEmF, pellets:pelletsEmF, hhs:hhsEmF,
                   _autoGk:gasEmF, fernwaerme:fernwaermeEmF, lwwp:stromEmFLZ, fg:stromEmFLZ, geo:stromEmFLZ, stromkessel:stromEmFLZ, bhkw:gasEmF };
  const ETA_BHKW_SIGMA = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
  const ETA_BHKW_GES   = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
  const ETA_BHKW_TH    = ETA_BHKW_GES / (1 + ETA_BHKW_SIGMA);

  // Pro Erzeuger: Basis-Verbrauchswerte für CO2-Berechnung sammeln
  const erzData = [];
  for (const k of keys) {
    const e    = en[k] || {};
    const wMwh = e.waermeMwh || 0;
    const eMwh = e.elMwh     || 0;
    if (wMwh < 0.1) continue;
    const emfH = EMF_HEUTE[k] || 0;
    const emfZ = EMF_2050[k]  || 0;
    // Berechne tCo2 als Funktion eines Emissionsfaktors
    let calcCo2;
    if (k === 'bhkw') {
      const gutschriftBase = bhkwCo2Gutschrift ? (wMwh * ETA_BHKW_SIGMA) : 0;
      calcCo2 = (emf) => Math.max(0, wMwh / ETA_BHKW_TH * emf / 1e3 - gutschriftBase * calcVerdraengungEmF() / 1e3);
    } else if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
      calcCo2 = (emf) => eMwh * emf / 1e3;
    } else if (k === 'fernwaerme') {
      calcCo2 = (emf) => wMwh * emf / 1e3;
    } else if (ETA[k]) {
      const verb = wMwh / ETA[k];
      calcCo2 = (emf) => verb * emf / 1e3;
    } else continue;
    const tCo2Heute = calcCo2(emfH);
    const tCo2_2050 = calcCo2(emfZ);
    if (tCo2Heute < 0.01 && tCo2_2050 < 0.01) continue;
    erzData.push({ key: k, label: DA_LABELS[k] || k, color: _daColor(k), emfH, emfZ, calcCo2, tCo2Heute, tCo2_2050 });
  }

  if (!erzData.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  // Jahresreihe 2025–2050 (26 Punkte)
  const START_YEAR = 2025, END_YEAR = 2050;
  const nYears = END_YEAR - START_YEAR + 1;
  // Pro Erzeuger + Jahr: tCo2 berechnen (Strom-EmF interpoliert linear)
  const series = erzData.map(d => {
    const vals = new Float64Array(nYears);
    for (let y = 0; y < nYears; y++) {
      const t = y / (nYears - 1); // 0…1
      const emf = d.emfH + (d.emfZ - d.emfH) * t;
      vals[y] = d.calcCo2(emf);
    }
    return { ...d, vals };
  });

  // Gesamt heute + 2050 für Infotext
  const totalHeute = series.reduce((s, d) => s + d.vals[0], 0);
  const total2050  = series.reduce((s, d) => s + d.vals[nYears - 1], 0);
  const totalEl = document.getElementById('wirt-co2-total');
  if (totalEl) totalEl.textContent = totalHeute.toFixed(1) + ' → ' + total2050.toFixed(1) + ' t CO₂/a';

  // Legende
  const legendEl = document.getElementById('wirt-co2-legend');
  if (legendEl) {
    legendEl.innerHTML = series.map(d =>
      `<span style="display:inline-flex;align-items:center;gap:3px;"><span style="display:inline-block;width:8px;height:8px;border-radius:1px;background:${d.color};opacity:0.7;"></span><span style="color:var(--muted);">${d.label}</span></span>`
    ).join('');
  }

  // Zeichnen
  const _doDrawCo2 = () => {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth || canvas.parentElement?.clientWidth || 460;
    const H   = 160;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD = { l: 38, r: 10, t: 12, b: 24 };
    const iW  = W - PAD.l - PAD.r;
    const iH  = H - PAD.t - PAD.b;

    // Max über gestapelte Werte
    let maxV = 0;
    for (let y = 0; y < nYears; y++) {
      let sum = 0;
      series.forEach(d => { sum += d.vals[y]; });
      if (sum > maxV) maxV = sum;
    }
    maxV = maxV * 1.12 || 1;

    // Hintergrund-Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const yy = PAD.t + iH - iH * i / 4;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(W - PAD.r, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(200,200,200,0.4)';
      ctx.font = '8px "DM Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText((maxV * i / 4).toFixed(1), PAD.l - 3, yy + 3);
    }

    // Y-Achse
    ctx.save();
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.font = '7px sans-serif';
    ctx.translate(8, PAD.t + iH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('t CO₂/a', 0, 0);
    ctx.restore();

    // X-Achse (Jahreszahlen)
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    for (let y = 0; y < nYears; y += 5) {
      const x = PAD.l + (y / (nYears - 1)) * iW;
      ctx.fillText(String(START_YEAR + y), x, H - 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + iH); ctx.stroke();
    }

    // Gestapelte Flächen (von unten nach oben)
    const baseY = PAD.t + iH;
    // Vorberechnung der kumulierten Stacks
    const stacks = new Array(nYears);
    for (let y = 0; y < nYears; y++) stacks[y] = new Float64Array(series.length + 1); // cumulative
    for (let y = 0; y < nYears; y++) {
      let cum = 0;
      for (let s = 0; s < series.length; s++) {
        cum += series[s].vals[y];
        stacks[y][s + 1] = cum;
      }
    }

    for (let s = series.length - 1; s >= 0; s--) {
      const color = series[s].color;
      ctx.beginPath();
      // Obere Kante (kumuliert bis s+1)
      for (let y = 0; y < nYears; y++) {
        const x = PAD.l + (y / (nYears - 1)) * iW;
        const yy = baseY - (stacks[y][s + 1] / maxV) * iH;
        y === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      // Untere Kante zurück (kumuliert bis s)
      for (let y = nYears - 1; y >= 0; y--) {
        const x = PAD.l + (y / (nYears - 1)) * iW;
        const yy = baseY - (stacks[y][s] / maxV) * iH;
        ctx.lineTo(x, yy);
      }
      ctx.closePath();
      ctx.fillStyle = color + '55'; // halbtransparent
      ctx.fill();
      // Obere Linie
      ctx.beginPath();
      for (let y = 0; y < nYears; y++) {
        const x = PAD.l + (y / (nYears - 1)) * iW;
        const yy = baseY - (stacks[y][s + 1] / maxV) * iH;
        y === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = color + 'aa';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Reduktionspfeil / Annotation
    const redPct = totalHeute > 0 ? ((totalHeute - total2050) / totalHeute * 100) : 0;
    if (redPct > 1) {
      ctx.fillStyle = '#a5d6a7';
      ctx.font = 'bold 10px "DM Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('−' + redPct.toFixed(0) + '%', W - PAD.r - 2, PAD.t + 12);
    }
  };

  if (canvas.clientWidth > 10) _doDrawCo2();
  else requestAnimationFrame(_doDrawCo2);
}

// ── Jahresscheiben-Berechnung (NPV) ──────────────────────────────────────
export function calcJahresscheiben() {
  const keys  = window._dispatchActiveKeys || [];
  const en    = window._dispatchEnergy    || {};
  const ov    = window._wirtBausteineOverrides || {};
  const ovVdi = window._wirtVdiOverrides       || {};

  if (!keys.length) {
    const r = document.getElementById('js-result');
    if (r) { r.style.display = 'block'; r.innerHTML = '<p style="color:var(--muted);font-size:10px;">Erst Dispatch berechnen.</p>'; }
    return;
  }

  const laufzeit   = parseInt(document.getElementById('js-laufzeit')?.value) || 20;
  const eskalation = (parseFloat(document.getElementById('js-eskalation')?.value) || 2) / 100;
  const zins  = parseFloat(document.getElementById('wirt-zins')?.value) || 2.7;
  const diskont    = zins / 100; // Synchron mit Kapitalzins (VDI 2067)
  const dSync = document.getElementById('js-diskont-sync');
  if (dSync) dSync.textContent = zins.toFixed(1);
  const lohn  = parseFloat(document.getElementById('wirt-lohn')?.value) || 45;
  const pStrom = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const pGas   = parseFloat(document.getElementById('wirt-p-gas')?.value)   || 10;
  const pHko   = parseFloat(document.getElementById('wirt-p-hko')?.value)   || 10;
  const pFw    = parseFloat(document.getElementById('wirt-p-fw')?.value)    || 17;
  const pPk    = parseFloat(document.getElementById('wirt-p-pk')?.value)    || 8;
  const pHhs   = parseFloat(document.getElementById('wirt-p-hhs')?.value)   || 6;

  // Investition (Jahr 0)
  const pKw = {};
  keys.forEach(k => {
    const arr = window._dispatchHourly?.[k];
    if (arr && arr.length > 0) { let m = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; pKw[k] = m; }
    else { const cfg = ERZEUGER_CFG[k]; pKw[k] = cfg?.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0; }
  });
  const aktiv = k => keys.includes(k) && (pKw[k] || 0) > 0.1;
  const sumKw = keys.reduce((s, k) => s + (pKw[k] || 0), 0);
  const bohrm = _parseGeoBohrMeter();
  const iKW = (tech, kw) => typeof CalcEngine !== 'undefined' ? Math.round(kw * CalcEngine.investEurProKw(tech, kw)) : 0;

  // Simplified: get total invest and annual costs from calcWirtschaftPanel results
  // Rebuild investment calc
  const nGeb = parseInt(document.getElementById('netz-n-geb')?.value)||0;
  const BD = [
    { id:'lwwp', aktiv:()=>aktiv('lwwp'), auto:()=>iKW('LuftWP', pKw.lwwp||0), vdi:{n:20,inst:1.0,wart:1.5,bedien:5} },
    { id:'fg', aktiv:()=>aktiv('fg'), auto:()=>iKW('FlussWP', pKw.fg||0), vdi:{n:20,inst:2.0,wart:1.0,bedien:5} },
    { id:'geo_wp', aktiv:()=>aktiv('geo'), auto:()=>iKW('GeoWP', pKw.geo||0), vdi:{n:20,inst:1.0,wart:1.5,bedien:5} },
    { id:'geo_sonden', aktiv:()=>aktiv('geo'), auto:()=>Math.round(bohrm*95), vdi:{n:50,inst:2.0,wart:1.0,bedien:0} },
    { id:'pk', aktiv:()=>aktiv('pellets'), auto:()=>iKW('Pellets', pKw.pellets||0), get vdi(){const kw=pKw.pellets||0; return {n:15,inst:3.0,wart:3.0,bedien:kw<50?100:kw<200?200:kw<500?300:408};} },
    { id:'pk_lager', aktiv:()=>aktiv('pellets'), auto:()=>Math.round((pKw.pellets||0)*100), get vdi(){const kw=pKw.pellets||0; return {n:20,inst:3.0,wart:2.0,bedien:kw<50?50:kw<200?100:kw<500?150:204};} },
    { id:'hhs', aktiv:()=>aktiv('hhs'), auto:()=>iKW('Hackschnitzel', pKw.hhs||0), get vdi(){const kw=pKw.hhs||0; return {n:15,inst:3.0,wart:3.0,bedien:kw<50?150:kw<200?250:kw<500?350:408};} },
    { id:'hhs_lager', aktiv:()=>aktiv('hhs'), auto:()=>Math.round((pKw.hhs||0)*150), get vdi(){const kw=pKw.hhs||0; return {n:30,inst:1.0,wart:1.0,bedien:kw<50?100:kw<200?200:kw<500?400:612};} },
    { id:'hko', aktiv:()=>aktiv('heizoel'), auto:()=>iKW('Heizoel', pKw.heizoel||0), vdi:{n:20,inst:1.0,wart:2.0,bedien:20} },
    { id:'gk', aktiv:()=>aktiv('gaskessel'), auto:()=>iKW('Gaskessel',pKw.gaskessel||0), vdi:{n:20,inst:1.0,wart:2.0,bedien:20} },
    { id:'bhkw_agg', aktiv:()=>aktiv('bhkw'), auto:()=>iKW('BHKW', pKw.bhkw||0), get vdi(){const kw=pKw.bhkw||0; return {n:15,inst:3.0,wart:3.5,bedien:kw<20?100:kw<100?200:kw<500?300:408};} },
    { id:'bhkw_hydr', aktiv:()=>aktiv('bhkw'), auto:()=>Math.round((pKw.bhkw||0)*150), vdi:{n:25,inst:1.5,wart:1.0,bedien:0} },
    { id:'sk', aktiv:()=>aktiv('stromkessel'), auto:()=>Math.round((pKw.stromkessel||0)*80), vdi:{n:20,inst:1.0,wart:1.0,bedien:0} },
    { id:'fw_pumpe', aktiv:()=>aktiv('fernwaerme'), auto:()=>Math.round((pKw.fernwaerme||0)*80), vdi:{n:18,inst:2.0,wart:1.0,bedien:0} },
    { id:'schornstein', aktiv:()=>aktiv('pellets')||aktiv('hhs')||aktiv('heizoel')||aktiv('gaskessel')||aktiv('bhkw'),
      auto:()=>Math.round(((pKw.pellets||0)+(pKw.hhs||0)+(pKw.heizoel||0)+(pKw.gaskessel||0)+(pKw.bhkw||0))*60), vdi:{n:40,inst:1.0,wart:2.0,bedien:0} },
    { id:'puffer', aktiv:()=>sumKw>0, auto:()=>Math.round(sumKw*25*7/1000)*1000, vdi:{n:20,inst:1.0,wart:1.0,bedien:0} },
    { id:'schallschutz', aktiv:()=>aktiv('lwwp')||aktiv('bhkw'), auto:()=>Math.round(((pKw.lwwp||0)+(pKw.bhkw||0))*75), vdi:{n:25,inst:0.5,wart:0.5,bedien:0} },
    { id:'entstaubung', aktiv:()=>(pKw.pellets||0)+(pKw.hhs||0)>200,
      auto:()=>{const p=(pKw.pellets||0)+(pKw.hhs||0);return p<=500?20000:p<=1000?30000:40000;}, vdi:{n:15,inst:2.0,wart:3.0,bedien:100} },
    { id:'huest', aktiv:()=>nGeb>1,
      auto:()=>{const avg=sumKw>0&&nGeb>1?sumKw/nGeb:50;const e=avg<30?5000:avg<100?8000:avg<300?12000:15000;return nGeb>1?nGeb*e:0;}, vdi:{n:25,inst:1.0,wart:1.0,bedien:0} },
    { id:'netzanschluss', aktiv:()=>(pKw.lwwp||0)+(pKw.fg||0)+(pKw.geo||0)+(pKw.stromkessel||0)>500,
      auto:()=>Math.round(((pKw.lwwp||0)+(pKw.fg||0)+(pKw.geo||0)+(pKw.stromkessel||0))*40), vdi:{n:40,inst:0.5,wart:0,bedien:0} },
    { id:'fg_entnahme', aktiv:()=>aktiv('fg'), auto:()=>Math.round((pKw.fg||0)*300), vdi:{n:30,inst:2.0,wart:1.0,bedien:100} },
    { id:'waermenetz', aktiv:()=>typeof netzEdges!=='undefined'&&netzEdges.some(e=>!e.pruned),
      auto:()=>{if(typeof netzEdges==='undefined'||!netzEdges.length)return 0;
        if(networkLocked){
          if(!window._netzSanierung)return 0;
          const pct=(parseFloat(document.getElementById('netz-sanierung-pct')?.value)||40)/100;
          let s=0;netzEdges.forEach(e=>{if(e.pruned)return;
            const kpm=typeof getKostenProMKlasse==='function'?getKostenProMKlasse(e.dn,e.kostKlasse||'mittel'):0;s+=kpm*(e.length||0);});return Math.round(s*pct);
        }
        let s=0;netzEdges.forEach(e=>{if(e.pruned)return;
          const kpm=typeof getKostenProMKlasse==='function'?getKostenProMKlasse(e.dn,e.kostKlasse||'mittel'):0;s+=kpm*(e.length||0);});return Math.round(s);},
      vdi:{n:50,inst:1.5,wart:0.5,bedien:40} },
  ];

  let totalInvest = 0;
  let annualOpex = 0; // Betriebskosten (Inst., Wartung, Bedienung) ohne Energie
  const reinvestYears = []; // [{year, amount}]

  let basisInvest = 0;
  for (const b of BD) {
    if (!b.aktiv()) continue;
    const inv = (ov[b.id] !== undefined) ? ov[b.id] : b.auto();
    const vdi = { ...b.vdi, ...(ovVdi[b.id] || {}) };
    totalInvest += inv;
    if (vdi.n > 0) basisInvest += inv;
    // Annual opex (VDI 2067)
    const instK = inv * (vdi.inst || 0) / 100;
    const wartK = inv * (vdi.wart || 0) / 100;
    const bedK  = (vdi.bedien || 0) * lohn;
    annualOpex += instK + wartK + bedK;
    // Reinvestition when lifetime < Betrachtungszeitraum
    if (vdi.n > 0 && vdi.n < laufzeit) {
      for (let y = vdi.n; y < laufzeit; y += vdi.n) {
        reinvestYears.push({ year: y, amount: inv });
      }
    }
  }
  // Percent-based items
  const PCT_ITEMS = [
    { id:'bauteil', pct:0.05, vdi:{n:50,inst:1.0,wart:1.0,bedien:0} },
    { id:'hydr_elt', pct:0.12, vdi:{n:40,inst:1.0,wart:0,bedien:0} },
    { id:'planung', pct:0.10, vdi:{n:20,inst:0,wart:0,bedien:0} },
    { id:'unvorg', pct:0.07, vdi:{n:20,inst:0,wart:0,bedien:0} },
  ];
  if (basisInvest > 0) {
    for (const b of PCT_ITEMS) {
      const inv = (ov[b.id] !== undefined) ? ov[b.id] : Math.round(basisInvest * b.pct);
      const vdi = { ...b.vdi, ...(ovVdi[b.id] || {}) };
      totalInvest += inv;
      const instK = inv * (vdi.inst || 0) / 100;
      const wartK = inv * (vdi.wart || 0) / 100;
      annualOpex += instK + wartK;
      if (vdi.n > 0 && vdi.n < laufzeit) {
        for (let y = vdi.n; y < laufzeit; y += vdi.n) reinvestYears.push({ year: y, amount: inv });
      }
    }
  }

  // Annual energy costs (year 0 prices)
  let energyCostYear0 = 0;
  const ETA = _getEtaMap();
  const P   = { gaskessel:pGas, heizoel:pHko, pellets:pPk, hhs:pHhs, _autoGk:pGas };
  keys.forEach(k => {
    const e = en[k] || {};
    const wMwh = e.waermeMwh || 0; const eMwh = e.elMwh || 0;
    if (wMwh < 0.1) return;
    if (k === 'lwwp' || k === 'fg' || k === 'geo') energyCostYear0 += eMwh * pStrom * 10;
    else if (k === 'fernwaerme') energyCostYear0 += wMwh * pFw * 10;
    else if (ETA[k]) energyCostYear0 += (wMwh / ETA[k]) * P[k] * 10;
  });

  // Annuität der Erstinvestition (VDI 2067 Kapitalkosten p.a.)
  const q = 1 + diskont;
  const annF = diskont > 1e-6 ? (diskont * Math.pow(q, laufzeit)) / (Math.pow(q, laufzeit) - 1) : 1 / laufzeit;
  const annInvest = totalInvest * annF; // €/a Kapitalkosten

  // Build year-by-year cashflow
  const years = [];
  let kumulativ = 0;
  let npv = 0;
  for (let y = 0; y <= laufzeit; y++) {
    const invest = y === 0 ? totalInvest : reinvestYears.filter(r => r.year === y).reduce((s, r) => s + r.amount, 0);
    const energie = y === 0 ? 0 : energyCostYear0 * Math.pow(1 + eskalation, y - 1);
    const betrieb = y === 0 ? 0 : annualOpex;
    const total = invest + energie + betrieb;
    kumulativ += total;
    const diskFaktor = Math.pow(1 + diskont, -y);
    npv += total * diskFaktor;
    // Jahreskosten = Annuität(Kapital) + Betrieb + eskalierte Energie
    const jahreskosten = y === 0 ? 0 : annInvest + annualOpex + energyCostYear0 * Math.pow(1 + eskalation, y - 1);
    years.push({ y, invest, energie, betrieb, total, kumulativ, npv, diskFaktor, jahreskosten });
  }

  // Gesamtwärme (diskontiert, analog LCOE: Wärmemenge wird ebenso diskontiert wie Kosten)
  const gesamtMwh = window.systemState?.gesamtMwhMitNV
    || window.systemState?.nutzwaermeMwh
    || Object.values(en).reduce((s, e) => s + (e.waermeMwh || 0), 0) || 1;
  let totalWaermeDisk = 0;
  for (let y = 1; y <= laufzeit; y++) totalWaermeDisk += gesamtMwh * Math.pow(1 + diskont, -y);
  const totalWaerme = totalWaermeDisk > 0 ? totalWaermeDisk : gesamtMwh * laufzeit;
  const wgkNpv = npv / totalWaerme / 10; // LCOE-basierte WGK in ct/kWh (Kosten UND Wärme diskontiert)

  // Results
  const fmt = v => Math.round(v).toLocaleString('de-DE');
  const fmtK = v => (v / 1000).toFixed(0);
  const res = document.getElementById('js-result');
  if (res) {
    res.style.display = 'block';
    res.innerHTML = `
      <div style="font-size:9px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;opacity:0.7;">Ergänzend: Barwert-/NPV-Methode</div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:4px;text-align:center;margin-bottom:4px;">
        <div><div style="font-family:'DM Mono',monospace;font-size:11px;color:rgba(255,183,77,0.7);">${fmtK(totalInvest)} k&euro;</div><div style="font-size:7px;color:var(--muted);">Erstinvestition</div></div>
        <div><div style="font-family:'DM Mono',monospace;font-size:11px;color:rgba(206,147,216,0.7);">${fmtK(years[1]?.jahreskosten||0)} k&euro;/a</div><div style="font-size:7px;color:var(--muted);">Jahreskosten (J.1)</div></div>
        <div><div style="font-family:'DM Mono',monospace;font-size:11px;color:rgba(255,241,118,0.7);">${fmtK(npv)} k&euro;</div><div style="font-size:7px;color:var(--muted);">NPV (${laufzeit}a)</div></div>
        <div><div style="font-family:'DM Mono',monospace;font-size:11px;color:rgba(165,214,167,0.7);">${fmtK(kumulativ)} k&euro;</div><div style="font-size:7px;color:var(--muted);">Gesamtkosten nom.</div></div>
        <div><div style="font-family:'DM Mono',monospace;font-size:11px;color:rgba(79,195,247,0.7);">${wgkNpv.toFixed(1)} ct/kWh</div><div style="font-size:7px;color:var(--muted);">WGK (NPV)</div></div>
      </div>
      <details style="font-size:10px;color:var(--muted);margin-top:4px;">
        <summary style="cursor:pointer;">Jahresscheiben-Tabelle</summary>
        <div style="max-height:200px;overflow-y:auto;margin-top:4px;">
          <table style="width:100%;border-collapse:collapse;font-size:9px;font-family:'DM Mono',monospace;">
            <thead><tr style="border-bottom:1px solid var(--border);color:var(--muted);">
              <th style="text-align:left;padding:2px 4px;">Jahr</th>
              <th style="text-align:right;padding:2px 4px;">Invest</th>
              <th style="text-align:right;padding:2px 4px;">Betrieb</th>
              <th style="text-align:right;padding:2px 4px;">Energie</th>
              <th style="text-align:right;padding:2px 4px;">Cashflow</th>
              <th style="text-align:right;padding:2px 4px;color:#ce93d8;">Jahresk.</th>
              <th style="text-align:right;padding:2px 4px;">Kumulativ</th>
            </tr></thead>
            <tbody>${years.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:1px 4px;">${r.y}</td>
              <td style="text-align:right;padding:1px 4px;${r.invest>0?'color:#ffb74d':''}">${r.invest>0?fmtK(r.invest):'—'}</td>
              <td style="text-align:right;padding:1px 4px;">${r.betrieb>0?fmtK(r.betrieb):'—'}</td>
              <td style="text-align:right;padding:1px 4px;">${r.energie>0?fmtK(r.energie):'—'}</td>
              <td style="text-align:right;padding:1px 4px;">${fmtK(r.total)}</td>
              <td style="text-align:right;padding:1px 4px;color:#ce93d8;">${r.jahreskosten>0?fmtK(r.jahreskosten):'—'}</td>
              <td style="text-align:right;padding:1px 4px;color:#4fc3f7;">${fmtK(r.kumulativ)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </details>`;
  }

  // Draw chart
  renderJahresscheibenChart(years, laufzeit);
}

export function renderJahresscheibenChart(years, laufzeit) {
  const wrap = document.getElementById('js-chart-wrap');
  const canvas = document.getElementById('js-canvas');
  if (!wrap || !canvas) return;
  wrap.style.display = 'block';

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 460;
  const H = 160;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD = { l: 54, r: 10, t: 16, b: 24 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // Skip year 0 for stacked bars (invest shown separately)
  const barData = years.filter(y => y.y > 0);
  const maxVal = Math.max(...barData.map(y => y.invest + y.betrieb + y.energie)) * 1.1 || 1;
  const bW = Math.min(iW / barData.length * 0.7, 16);
  const gap = iW / barData.length;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const y = PAD.t + iH - iH * i / 4;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,200,200,0.4)';
    ctx.font = '8px DM Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * i / 4 / 1000) + 'k', PAD.l - 3, y + 3);
  }
  ctx.fillStyle = 'rgba(200,200,200,0.5)';
  ctx.font = '7px sans-serif';
  ctx.save();
  ctx.translate(10, PAD.t + iH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('€/a', 0, 0);
  ctx.restore();

  barData.forEach((d, i) => {
    const cx = PAD.l + gap * i + gap / 2;
    const x = cx - bW / 2;
    const base = PAD.t + iH;

    // Stacked: invest (orange), betrieb (blue), energie (yellow)
    let y0 = base;
    const segments = [
      { val: d.invest, color: '#ffb74d' },
      { val: d.betrieb, color: '#4fc3f7' },
      { val: d.energie, color: '#fff176' },
    ];
    segments.forEach(seg => {
      if (seg.val <= 0) return;
      const h = (seg.val / maxVal) * iH;
      ctx.fillStyle = seg.color;
      ctx.fillRect(x, y0 - h, bW, h);
      y0 -= h;
    });

    // Year label every 5 years or first/last
    if (d.y === 1 || d.y === laufzeit || d.y % 5 === 0) {
      ctx.fillStyle = 'rgba(200,200,200,0.6)';
      ctx.font = '8px DM Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.y, cx, H - 6);
    }
  });

  // Legend
  ctx.font = '8px sans-serif';
  const legend = [{ l: 'Invest/Reinvest', c: '#ffb74d' }, { l: 'Betrieb', c: '#4fc3f7' }, { l: 'Energie', c: '#fff176' }];
  let lx = PAD.l;
  legend.forEach(lg => {
    ctx.fillStyle = lg.c;
    ctx.fillRect(lx, 2, 8, 8);
    ctx.fillStyle = 'rgba(200,200,200,0.6)';
    ctx.fillText(lg.l, lx + 10, 9);
    lx += ctx.measureText(lg.l).width + 26;
  });
}

// ── Optimizer-Kostenübersicht (VDI 2067 / KWW) ───────────────────────────
// Ehemals in 12-inline-handlers.js — gehört hier, da Wirtschaftlichkeitslogik
export function _renderOptKostenUebersicht() {
  const wrap = document.getElementById('opt-kosten-content');
  if (!wrap) return;
  const pStrom = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const pGas = parseFloat(document.getElementById('wirt-p-gas')?.value) || 10;
  const pHko = parseFloat(document.getElementById('wirt-p-hko')?.value) || 10;
  const pFw = parseFloat(document.getElementById('wirt-p-fw')?.value) || 17;
  const pPk = parseFloat(document.getElementById('wirt-p-pk')?.value) || 8;
  const pHhs = parseFloat(document.getElementById('wirt-p-hhs')?.value) || 6;
  const pCo2 = parseFloat(document.getElementById('wirt-p-co2')?.value) || 120;
  const zins = parseFloat(document.getElementById('wirt-zins')?.value) || 3.5;
  const lohn = parseFloat(document.getElementById('wirt-lohn')?.value) || 45;
  const pEinsp = parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8;
  const pBhkwE = parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8;
  const pBhkwKwk = parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8;
  const pBhkwEig = parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4;
  const co2Alle = document.getElementById('wirt-co2-alle')?.checked;

  const rows = [
    // Wärmeerzeuger
    {k:'lwwp',     label:'Luft-WP (Anlage)',inv:OPT_INVEST_DEFAULT.lwwp, unit:'€/kW', n:20, ih:1.0, wart:1.5, bed:5,   color:'#66bb6a', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'LuftWP'},
    {k:'fg',       label:'FG-WP (Anlage)',  inv:OPT_INVEST_DEFAULT.fg,   unit:'€/kW', n:20, ih:2.0, wart:1.0, bed:5,   color:'#29b6f6', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'FlussWP'},
    {k:'fg_ent',   label:'└ Entnahmebauwerk', inv:300, unit:'€/kW', n:30, ih:2.0, wart:1.0, bed:100, color:'#29b6f6', fuel:'—', grp:'erz'},
    {k:'geo',      label:'Geo-WP (Anlage)', inv:OPT_INVEST_DEFAULT.geo,  unit:'€/kW', n:20, ih:1.0, wart:1.5, bed:5,   color:'#a1887f', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'GeoWP'},
    {k:'geo_sond', label:'└ Erdsondenbohrung',inv:95,  unit:'€/Bohrmeter', n:50, ih:2.0, wart:1.0, bed:0, color:'#a1887f', fuel:'—', grp:'erz'},
    {k:'gaskessel',label:'Gaskessel',       inv:OPT_INVEST_DEFAULT.gaskessel, unit:'€/kW', n:20, ih:1.0, wart:2.0, bed:20, color:'#78909c', fuel:'Erdgas '+pGas+' ct', grp:'erz', ce:'Gaskessel'},
    {k:'bhkw',     label:'BHKW/KWK',       inv:OPT_INVEST_DEFAULT.bhkw, unit:'€/kWₜₕ', n:15, ih:3.0, wart:3.5, bed:'100–408', color:'#ff69b4', fuel:'Erdgas '+pGas+' ct', grp:'erz', ce:'BHKW'},
    {k:'bhkw_hyd', label:'└ Hydraulik/Einbindung',inv:150, unit:'€/kWₜₕ', n:25, ih:1.5, wart:1.0, bed:0, color:'#ff69b4', fuel:'—', grp:'erz'},
    {k:'stromkessel',label:'Stromkessel',   inv:80,  unit:'€/kW', n:20, ih:1.0, wart:1.0, bed:0, color:'#ff8f00', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'Stromkessel'},
    {k:'pellets',  label:'Pelletkessel',    inv:OPT_INVEST_DEFAULT.pellets, unit:'€/kW', n:15, ih:3.0, wart:3.0, bed:'100–408', color:'#ff7043', fuel:'Pellets '+pPk+' ct', grp:'erz', ce:'Pellets'},
    {k:'pk_lager', label:'└ Pelletlager',inv:100, unit:'€/kW', n:20, ih:3.0, wart:2.0, bed:'50–204', color:'#ff7043', fuel:'—', grp:'erz'},
    {k:'hhs',      label:'Hackschnitzelkessel',inv:OPT_INVEST_DEFAULT.hhs, unit:'€/kW', n:15, ih:3.0, wart:3.0, bed:'150–408', color:'#8d6e63', fuel:'HHS '+pHhs+' ct', grp:'erz', ce:'Hackschnitzel'},
    {k:'hhs_lager',label:'└ HHS-Lager',inv:150, unit:'€/kW', n:30, ih:1.0, wart:1.0, bed:'100–612', color:'#8d6e63', fuel:'—', grp:'erz'},
    {k:'heizoel',  label:'Ölkessel',        inv:OPT_INVEST_DEFAULT.heizoel, unit:'€/kW', n:20, ih:1.0, wart:2.0, bed:20, color:'#455a64', fuel:'Heizöl '+pHko+' ct', grp:'erz', ce:'Heizoel'},
    {k:'fernwaerme',label:'Fernwärme (Üst.)',inv:OPT_INVEST_DEFAULT.fernwaerme, unit:'€/kW', n:20, ih:2.0, wart:1.0, bed:0, color:'#e53935', fuel:'FW '+pFw+' ct', grp:'erz'},
    // Solarthermie + Speicher
    {k:'st',       label:'Solarthermie',    inv:300,  unit:'€/m²', n:25, ih:1.0, wart:1.0, bed:0, color:'#ef6c00', fuel:'Sonne (0 ct)', grp:'zusatz'},
    {k:'ts',       label:'Wärmespeicher',   inv:'60–80', unit:'€/kWhₜₕ', n:20, ih:1.0, wart:0.5, bed:0, color:'#26a69a', fuel:'—', grp:'zusatz', note:'Puffer 80–100 · Groß 60–80 · Saisonal ~40'},
    // PV + Batterie
    {k:'pv',       label:'PV-Anlage',       inv:OPT_INVEST_DEFAULT.pv, unit:'€/kWp', n:20, ih:1.0, wart:0.5, bed:0, color:'#ffd54f', fuel:'—', grp:'strom', note:'Größenabh. 600–1.400 €/kWp'},
    {k:'bat',      label:'Batterie',        inv:OPT_INVEST_DEFAULT.bat, unit:'€/kWh', n:15, ih:1.0, wart:0.5, bed:0, color:'#b39ddb', fuel:'—', grp:'strom'},
    // Nebenkomponenten (Infrastruktur)
    {k:'schornstein',label:'Schornstein',   inv:60, unit:'€/kWₜₕ', n:40, ih:1.0, wart:2.0, bed:0, color:'#616161', fuel:'—', grp:'neben', note:'bei Feuerungsanlagen'},
    {k:'puffer',   label:'Pufferspeicher',  inv:'~175', unit:'€/kW (25L/kW × 7€/L)', n:20, ih:1.0, wart:1.0, bed:0, color:'#546e7a', fuel:'—', grp:'neben'},
    {k:'schall',   label:'Schallschutz',    inv:75, unit:'€/kW', n:25, ih:0.5, wart:0.5, bed:0, color:'#78909c', fuel:'—', grp:'neben', note:'bei Luft-WP, BHKW'},
    {k:'entstaub', label:'Entstaubung',     inv:'20–40k', unit:'€ pauschal', n:15, ih:2.0, wart:3.0, bed:100, color:'#795548', fuel:'—', grp:'neben', note:'bei Biomasse >200 kW'},
    {k:'huest',    label:'Hausübergabestationen', inv:'5–15k', unit:'€/Geb.', n:25, ih:1.0, wart:1.0, bed:0, color:'#607d8b', fuel:'—', grp:'neben'},
    {k:'netzanschl',label:'Netzanschluss (Strom)',inv:40, unit:'€/kWₑₗ', n:40, ih:0.5, wart:0, bed:0, color:'#9e9e9e', fuel:'—', grp:'neben', note:'bei >500 kWₑₗ'},
    {k:'waermenetz',label:'Wärmenetz (KMR)',inv:'—', unit:'strangweise', n:50, ih:1.5, wart:0.5, bed:40, color:'#c62828', fuel:'—', grp:'neben', note:'aus Netzplanung'},
    // Prozentuale Zuschläge
    {k:'bauteil',  label:'Bautechnik',      inv:'5%', unit:'der Basisinvest.', n:50, ih:1.0, wart:1.0, bed:0, color:'#9e9e9e', fuel:'—', grp:'zuschlag'},
    {k:'hydr_elt', label:'Hydraulik + E-Technik',inv:'12%', unit:'der Basisinvest.', n:40, ih:1.0, wart:0, bed:0, color:'#9e9e9e', fuel:'—', grp:'zuschlag'},
    {k:'planung',  label:'Planung + Projektsteuerung',inv:'10%', unit:'der Basisinvest.', n:20, ih:0, wart:0, bed:0, color:'#9e9e9e', fuel:'—', grp:'zuschlag'},
    {k:'unvorg',   label:'Unvorhergesehenes',inv:'7%', unit:'der Basisinvest.', n:20, ih:0, wart:0, bed:0, color:'#9e9e9e', fuel:'—', grp:'zuschlag'},
  ];

  let html = '<div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Investitions-, Nutzungsdauer- und Instandhaltungswerte der Optimierung. Energiepreise aus dem Wirtschaftlichkeits-Panel. VDI 2067 / KWW-Technikkatalog.</div>';

  html += '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text);width:100%;margin-bottom:2px;">Energiepreise</span>';
  const ep = [
    ['Strom (Bezug)',pStrom,'ct/kWh'],['Erdgas',pGas,'ct/kWh'],['Heizöl',pHko,'ct/kWh'],
    ['Fernwärme',pFw,'ct/kWh'],['Pellets',pPk,'ct/kWh'],['HHS',pHhs,'ct/kWh'],
    ['PV-Einspeisung',pEinsp,'ct/kWh'],['BHKW-Einsp.',pBhkwE,'ct/kWh'],
    ['BHKW KWK-Netz',pBhkwKwk,'ct/kWh'],['BHKW KWK-Eigen',pBhkwEig,'ct/kWh'],
    ['CO₂-Ansatz',pCo2,'€/t' + (co2Alle ? ' (alle ET)' : ' (nur fossil)')],
  ];
  ep.forEach(([l,v,u]) => {
    html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;white-space:nowrap;">' + l + ': <b>' + v + '</b> ' + u + '</span>';
  });
  html += '</div>';

  const etaGk = parseFloat(document.getElementById('gk-eta')?.value) || 92;
  const etaHko = parseFloat(document.getElementById('hko-eta')?.value) || 90;
  const etaPk = parseFloat(document.getElementById('pk-eta')?.value) || 88;
  const etaHhs = parseFloat(document.getElementById('hhs-eta')?.value) || 85;
  const etaBhkw = parseFloat(document.getElementById('bhkw-eta')?.value) || 88;
  const bhkwSkz = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text);width:100%;margin-bottom:2px;">Kapital &amp; Betrieb</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Kapitalzins: <b>' + zins + '</b> %</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Stundensatz: <b>' + lohn + '</b> €/h</span>';
  html += '</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text);width:100%;margin-bottom:2px;">Wirkungsgrade / Kennwerte</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Gaskessel: <b>'+etaGk+'</b> %</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Heizöl: <b>'+etaHko+'</b> %</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Pellets: <b>'+etaPk+'</b> %</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">HHS: <b>'+etaHhs+'</b> %</span>';
  html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">BHKW ηₜₕ: <b>'+etaBhkw+'</b> % · σ: <b>'+bhkwSkz+'</b></span>';
  html += '</div>';

  const z = zins / 100;
  const grpLabels = {erz:'Wärmeerzeuger',zusatz:'Solarthermie &amp; Speicher',strom:'PV &amp; Batterie',neben:'Infrastruktur &amp; Nebenkomponenten',zuschlag:'Prozentuale Zuschläge'};
  html += '<div style="overflow-x:auto;">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:\'DM Mono\',monospace;">';
  html += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);color:var(--muted);font-size:9px;text-align:right;">';
  html += '<th style="text-align:left;padding:3px 6px;">Komponente</th>';
  html += '<th style="padding:3px 6px;">Invest</th>';
  html += '<th style="padding:3px 6px;">Nutzung (a)</th>';
  html += '<th style="padding:3px 6px;">IH (% p.a.)</th>';
  html += '<th style="padding:3px 6px;">Wartung (% p.a.)</th>';
  html += '<th style="padding:3px 6px;">Bedienung (h/a)</th>';
  html += '<th style="padding:3px 6px;">Brennstoff / Hinweis</th>';
  html += '</tr></thead><tbody>';

  const ceAvail = typeof CalcEngine !== 'undefined';
  let lastGrp = '';
  rows.forEach(r => {
    if (r.grp !== lastGrp) {
      lastGrp = r.grp;
      html += '<tr><td colspan="7" style="padding:6px 6px 2px;font-size:9px;font-weight:600;color:var(--accent);border-bottom:1px solid rgba(255,255,255,0.06);">'+grpLabels[r.grp]+'</td></tr>';
    }
    const n = r.n;
    const ann = z > 0 && n > 0 ? (z * Math.pow(1+z,n) / (Math.pow(1+z,n)-1) * 100).toFixed(1) : (n > 0 ? (100/n).toFixed(1) : '—');
    const isSub = r.label.startsWith('└');
    const bedStr = (typeof r.bed === 'string') ? r.bed : (r.bed > 0 ? r.bed : '—');
    let invDisplay = '' + r.inv;
    if (r.ce && ceAvail) {
      const ce200 = Math.round(CalcEngine.investEurProKw(r.ce, 200));
      const ce50 = Math.round(CalcEngine.investEurProKw(r.ce, 50));
      if (ce200 > 0) invDisplay = ce50+'/'+ce200+' <span style="color:var(--muted);font-size:7px;">50/200kW</span>';
    }
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);'+(isSub?'opacity:0.75;':'')+'">';
    html += '<td style="padding:3px 6px;text-align:left;'+(isSub?'padding-left:20px;':'')+'"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+r.color+';vertical-align:middle;margin-right:5px;'+(isSub?'opacity:0.4;':'')+'"></span>'+r.label+'</td>';
    html += '<td style="padding:3px 6px;text-align:right;">'+invDisplay+' <span style="color:var(--muted);font-size:8px;">'+r.unit+'</span></td>';
    html += '<td style="padding:3px 6px;text-align:right;">'+n+' <span style="color:var(--muted);font-size:8px;">('+ann+'%)</span></td>';
    html += '<td style="padding:3px 6px;text-align:right;">'+(typeof r.ih === 'number' ? r.ih.toFixed(1) : r.ih)+'</td>';
    html += '<td style="padding:3px 6px;text-align:right;">'+(typeof r.wart === 'number' ? r.wart.toFixed(1) : r.wart)+'</td>';
    html += '<td style="padding:3px 6px;text-align:right;">'+bedStr+'</td>';
    html += '<td style="padding:3px 6px;text-align:right;font-size:9px;color:var(--muted);">'+(r.note || r.fuel)+'</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  html += '<div style="margin-top:6px;font-size:8px;color:var(--muted);">'
    + (ceAvail ? 'Invest-Spalte zeigt leistungsabhängige Werte aus CalcEngine (KWW-Technikkatalog 12/2025) bei 50 und 200 kW.'
               : 'Invest = pauschale Fallback-Werte. CalcEngine nicht geladen — im Normalbetrieb werden leistungsabhängige Kostenkurven verwendet.')
    + ' IH/Wartung/Bedienung nach VDI 2067. Annuität = Kapitalwiedergewinnungsfaktor bei '+zins+'% Zins.'
    + ' Bedienung wird mit '+lohn+' €/h bewertet.</div>';
  wrap.innerHTML = html;
}

