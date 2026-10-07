// ── 10c-optimizer-run.js — Optimierung starten/abbrechen, Worker-Orchestrierung, Ergebnis-Rendering ──

import { euroKompakt } from './lib/euro-format.js';
import { globalYear, solarthermieAktiv, thermSpeicherAktiv } from './01-globals-varianten.js';
import { aggregateGebStrom } from './02b-gebaeude.js';
import { escHtml } from './03c-gebaeude-io.js';
import { makeStProfile8760 } from './06b-gl-berechnen.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { OPT_FEIN_ANZAHL, OPT_FEIN_EVALS, _collectOptDomParams, _optGetScaledLastgang, _optKennwerte2, _optPvGrenze, _optScore } from './10a-optimizer-core.js';
import { optGrobPunkte, optRasterStufen, optSuchraum } from './lib/optimierer-suche.js';
import { OPT_MERIT_ORDER } from './config/optimizer-defaults.js';
import { _buildOptWorkerCode, _optRenderBarChart, _optRenderRadar, _optRenderScatter } from './10d-optimizer-worker.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { _optFinished } from './10e-optimizer-session.js';
import { addHourlyElectricLoad } from './lib/electric-demand.js';
import { canUseSharedWorkerSeries, copyWorkerSeries } from './lib/worker-series.js';
export { _optFinished } from './10e-optimizer-session.js';

export function runOptimierung() {
  if (window._optRunning) { _optAbbrechen(); return; }
  window._optRunId = (window._optRunId || 0) + 1;
  window._optAborted = false;
  window._optTop3Final = null;
  window._optRunning = true;
  const btn = document.getElementById('btn-opt-start');
  if (btn) {
    btn.setAttribute('data-running', '1');
    btn.innerHTML = '&#x2716; Berechnung abbrechen';
  }
  const resDiv = document.getElementById('opt-result-list');
  resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Berechne&#x2026;</div>';

  // Die schwere Suche läuft ausschließlich im Worker, damit ein Plattformfehler
  // nicht zu einer minutenlangen Blockade der Oberfläche führt.
  try {
    _runOptWorker(resDiv);
  } catch (e) {
    console.error('Web Worker nicht verfügbar:', e);
    _optFinished();
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;">Optimierung konnte nicht gestartet werden: Web Worker ist in diesem Browser nicht verfügbar.</div>';
  }
}

export function _optAbbrechen() {
  window._optRunId = (window._optRunId || 0) + 1;
  window._optAborted = true;
  if (window._optWorker) { window._optWorker.terminate(); window._optWorker = null; }
  for (const w of window._optWorkers) { try { w.terminate(); } catch(e) {} }
  window._optWorkers = [];
  _optFinished();
  const resDiv = document.getElementById('opt-result-list');
  if (resDiv) resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Abgebrochen.</div>';
}

export function _runOptWorker(resDiv) {
  const runId = window._optRunId;
  const ss = window.systemState;
  if (!ss?.lastgangKw || ss.lastgangKw.length < 8760 || !ss.tempH || !ss.vlH) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Kein stundenscharfer Lastgang verfügbar.</div>';
    _optFinished();
    return;
  }

  const dom = _collectOptDomParams();
  const pvProfile = (typeof makePvProfile8760 === 'function') ? makePvProfile8760() : null;
  const stAktiv = !!document.getElementById('opt-cand-st')?.checked;
  const stNormProfile = stAktiv && typeof makeStProfile8760 === 'function' ? makeStProfile8760(1) : null;

  // Kandidaten, Randbedingungen, Ziel, Qualität
  const allKeys = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel'];
  const aktiv = allKeys.filter(k => document.getElementById('opt-cand-' + k)?.checked);
  if (!aktiv.length) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Bitte mindestens einen Wärmeerzeuger als Kandidaten wählen.</div>';
    _optFinished();
    return;
  }
  const pvAktiv = !!document.getElementById('opt-cand-pv')?.checked;
  const batAktiv = !!document.getElementById('opt-cand-bat')?.checked;
  const tsAktiv = !!document.getElementById('opt-cand-ts')?.checked;
  const constraints = {};
  for (const k of [...allKeys, 'pv', 'bat', 'st', 'ts']) {
    constraints[k] = {
      minKw: parseFloat(document.getElementById('opt-min-' + k)?.value) || 0,
      maxKw: parseFloat(document.getElementById('opt-max-' + k)?.value) || 0,
      bisJahr: parseInt(document.getElementById('opt-bis-' + k)?.value) || 0,
    };
  }
  const ziel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';
  const quality = document.getElementById('opt-quality')?.value || 'standard';
  const optYear = parseInt(document.getElementById('opt-year')?.value) || (typeof globalYear !== 'undefined' ? globalYear : 2026);
  const lastgang = _optGetScaledLastgang(optYear) || ss.lastgangKw;

  // Wirtschaftsparameter (Fallbacks = HTML-Defaults der wirt-p-* Felder)
  const _pStromOpt = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const _pWpRawOpt = parseFloat(document.getElementById('wirt-p-strom-wp')?.value);
  const _zinsRawOpt = parseFloat(document.getElementById('wirt-zins')?.value);
  const params = {
    pStrom: _pStromOpt,
    pStromWp: isNaN(_pWpRawOpt) ? _pStromOpt : _pWpRawOpt, // optionaler WP-Sondervertragspreis
    pGas: parseFloat(document.getElementById('wirt-p-gas')?.value) || 10,
    pPk: parseFloat(document.getElementById('wirt-p-pk')?.value) || 8,
    pHhs: parseFloat(document.getElementById('wirt-p-hhs')?.value) || 6,
    pHko: parseFloat(document.getElementById('wirt-p-hko')?.value) || 10,
    pFw: parseFloat(document.getElementById('wirt-p-fw')?.value) || 17,
    pBhkwEinsp: parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8,
    pBhkwKwkE: parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8,
    pBhkwKwkEig: parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4,
    zinssatz: (isNaN(_zinsRawOpt) ? 3.5 : _zinsRawOpt) / 100,
  };

  // Quartier-Strom — gleiche Rangfolge wie die Strombilanz (09b): Upload, manuelle Jahressumme, Gebäudedaten
  const quartierH = new Float32Array(8760);
  const qMwhManuell = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
  if (window.elQuartierH) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window.elQuartierH[t];
  } else if (qMwhManuell > 0) {
    quartierH.fill(qMwhManuell * 1000 / 8760);
  } else if (window._elQuartierFromGeb) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window._elQuartierFromGeb[t];
  } else if (typeof aggregateGebStrom === 'function') {
    const gebStrom = aggregateGebStrom();
    if (gebStrom && gebStrom.totalMWh > 0) {
      for (let t = 0; t < 8760; t++) quartierH[t] = gebStrom.hourly[t];
    }
  }
  // Kälte ist keine separate Nebenrechnung, sondern Teil derselben Stromnachfrage.
  addHourlyElectricLoad(quartierH, window._kaelteElHourly || null);
  // Die Nachrechnung der Top-Varianten im Hauptthread (_optKennwerte2) muss denselben Bedarf verwenden
  let _qSum = 0; for (let t = 0; t < 8760; t++) _qSum += quartierH[t];
  window._optQuartierStromMwh = _qSum / 1000;

  // ── Suchraum ──
  let peak = 0, waermeMwh = 0;
  for (let t = 0; t < 8760; t++) { if (lastgang[t] > peak) peak = lastgang[t]; waermeMwh += lastgang[t]; }
  peak = Math.max(1, peak); waermeMwh /= 1000;
  const raum = optSuchraum({ aktiv, constraints, jahr: optYear, peak, typen: dom.ERZEUGER_TYP, meritOrder: OPT_MERIT_ORDER });
  const stufen = optRasterStufen(quality);
  const kombis = raum.kombis.map(k => ({ ...k, punkte: optGrobPunkte(k.grenzen, stufen, peak) }));

  const hatWp = aktiv.some(k => dom.ERZEUGER_TYP[k] === 'wp');
  const stromSchaetzMwh = _qSum / 1000 + (hatWp ? waermeMwh / 3.2 : 0);
  const achse = (aktivFlag, con, hiAuto) => {
    if (!aktivFlag) return { lo: 0, hi: 0 };
    const hi = Math.max(0, Math.round(con.maxKw > 0 ? con.maxKw : hiAuto));
    return { lo: Math.min(hi, Math.round(con.minKw || 0)), hi };
  };
  const pvGrenze = _optPvGrenze(constraints.pv.maxKw, stromSchaetzMwh, dom.pvSpez);
  const pv = achse(pvAktiv, { ...constraints.pv, maxKw: pvGrenze.kwp }, pvGrenze.kwp);
  // Batterie: höchstens ein Tagesstrombedarf bzw. 2 kWh je kWp
  const bat = achse(batAktiv && pv.hi > 0, constraints.bat, Math.max(20, Math.min(pv.hi * 2, stromSchaetzMwh * 1000 / 365)));
  const st = achse(stAktiv && !!stNormProfile, constraints.st, waermeMwh * 0.4 * 1000 / (dom.stSpez || 400));
  // Wärmespeicher: bis zur dreifachen Stundenleistung der halben Spitzenlast (WP-Pufferung)
  const ts = achse(tsAktiv, constraints.ts, Math.max(10, peak * 0.5 * 3 / (1.16 * dom.tsDt) * 3));
  const suche = {
    peak, backupMode: raum.backupMode, gasImplizit: raum.gasImplizit, kombis, pv, bat, st, ts,
    gasMaxKw: raum.gasImplizit ? (constraints.gaskessel.maxKw || 0) : 0,
    minSchrittErz: Math.max(1, Math.round(peak * 0.005)),
    maxEvalFein: OPT_FEIN_EVALS[quality] || 350,
    anzahlFein: OPT_FEIN_ANZAHL[quality] || 6,
  };
  const ausgangsSeed = _optAusgangsSeed(raum, { pvAktiv: pv.hi > 0, batAktiv: bat.hi > 0, stAktiv: st.hi > 0, tsAktiv: ts.hi > 0 });
  const info = { pvGrenze: pvAktiv ? pvGrenze : null, ohneNetz: !!window._wirtOhneNetz, jahr: optYear };

  // Anzahl paralleler Worker (min 1, max 8, einen Kern für die Oberfläche freilassen)
  const numWorkers = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const startTime = Date.now();
  const blobUrl = URL.createObjectURL(new Blob([_buildOptWorkerCode()], { type: 'application/javascript' }));

  const basePayload = { dom, params, ziel, suche };
  const shareSeries = canUseSharedWorkerSeries();
  const sharedSeries = shareSeries ? {
    lastgang: copyWorkerSeries(lastgang, true), temp: copyWorkerSeries(ss.tempH, true),
    vl: copyWorkerSeries(ss.vlH, true), pv: pvProfile ? copyWorkerSeries(pvProfile, true) : null,
    st: stNormProfile ? copyWorkerSeries(stNormProfile, true) : null, quartier: copyWorkerSeries(quartierH, true),
  } : null;
  window._optSeriesTransport = shareSeries ? 'shared-array-buffer' : 'transferable-copy';

  function createAndSendWorker(mode, extraPayload) {
    const w = new Worker(blobUrl);
    const lg = sharedSeries?.lastgang || new Float32Array(lastgang);
    const tempArr = sharedSeries?.temp || new Float32Array(ss.tempH);
    const vlArr = sharedSeries?.vl || new Float32Array(ss.vlH);
    const pvArr = sharedSeries?.pv || (pvProfile ? new Float32Array(pvProfile) : null);
    const stArr = sharedSeries?.st || (stNormProfile ? new Float32Array(stNormProfile) : null);
    const qArr = sharedSeries?.quartier || new Float32Array(quartierH);
    const transferList = shareSeries ? [] : [lg.buffer, tempArr.buffer, vlArr.buffer, qArr.buffer];
    if (!shareSeries && pvArr) transferList.push(pvArr.buffer);
    if (!shareSeries && stArr) transferList.push(stArr.buffer);
    w.postMessage({
      ...basePayload, ...extraPayload, mode,
      lastgangKw: lg, tempH: tempArr, vlH: vlArr, pvProfile: pvArr, stNormProfile: stArr, quartierH: qArr,
    }, transferList);
    return w;
  }

  // ── Fortschrittsanzeige ──
  const workerProgress = new Array(numWorkers).fill(0);
  const workerBest3 = new Array(numWorkers).fill(null); // Zwischenstände je Worker (Grobsuche)
  function _zwischenstandHtml() {
    const all = [];
    for (const b of workerBest3) if (b) all.push(...b);
    if (!all.length) return '';
    all.sort((a, b) => a.score - b.score);
    const seen = new Set(); const top = [];
    for (const r of all) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); top.push(r); if (top.length === 3) break; }
    }
    const name = k => ERZEUGER_CFG[k]?.label || k;
    const rows = top.map((r, i) => {
      const erz = r.kombiKey.split('+').map(name).join(' + ');
      const extras = [];
      if (r.pvKwp > 0) extras.push('PV ' + r.pvKwp + ' kWp');
      if (r.batKwh > 0) extras.push('Bat. ' + r.batKwh + ' kWh');
      if (r.stM2 > 0) extras.push('ST ' + r.stM2 + ' m²');
      if (r.tsVol > 0) extras.push('Speicher ' + r.tsVol + ' m³');
      const wgk = (r.wgk != null && r.wgk < 1e6) ? r.wgk.toFixed(1).replace('.', ',') + ' ct/kWh' : '';
      return '<div style="padding:3px 6px;border-left:2px solid ' + (i === 0 ? '#fdd835' : 'var(--border)') + ';margin-bottom:2px;font-size:9px;color:var(--text);">'
        + (i + 1) + '. ' + escHtml(erz)
        + (extras.length ? ' · ' + escHtml(extras.join(' · ')) : '')
        + (wgk ? ' <span style="color:#fdd835;">' + wgk + '</span>' : '')
        + '</div>';
    });
    return '<div style="margin-top:6px;text-align:left;">'
      + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Beste Konzepte bisher (Grobsuche)</div>'
      + rows.join('') + '</div>';
  }
  function updateProgress(phase) {
    const totalPct = Math.round(workerProgress.reduce((s, v) => s + v, 0) / workerProgress.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const nwLabel = numWorkers > 1 ? ' · ' + numWorkers + ' Kerne' : '';
    resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">' + phase + ': ' + totalPct + '% · ' + elapsed + 's' + nwLabel + '</div>'
      + _zwischenstandHtml();
  }
  let hadError = false;
  function fehler(e, text) {
    if (runId !== window._optRunId || hadError) return;
    hadError = true;
    console.error('OptWorker Error:', e);
    for (const wk of window._optWorkers) { try { wk.terminate(); } catch (ex) { /* bereits beendet */ } }
    _optFinished();
    URL.revokeObjectURL(blobUrl);
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;">' + text + '</div>';
  }

  // ── Phase 1: Grobsuche, auf alle Kerne verteilt ──
  const allGrob = [];
  let grobFertig = 0;
  window._optWorkers = [];
  for (let i = 0; i < numWorkers; i++) {
    const w = createAndSendWorker('grob', { workerIdx: i, numWorkers });
    window._optWorkers.push(w);
    w.onmessage = function(e) {
      if (runId !== window._optRunId || window._optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[i] = msg.pct;
        if (msg.best3) workerBest3[i] = msg.best3;
        updateProgress('Grobsuche');
      } else if (msg.type === 'grob_done') {
        allGrob.push(...(msg.grobResults || []));
        workerProgress[i] = 100;
        w.terminate();
        if (++grobFertig === numWorkers) _startFein();
      }
    };
    w.onerror = e => fehler(e, 'Worker-Fehler. Die Suche wurde beendet; bitte erneut starten oder Genauigkeit reduzieren.');
  }

  // ── Phase 2: Mustersuche je Anlagenkonzept, ebenfalls parallel ──
  function _startFein() {
    if (window._optAborted) return;
    window._optGrobResults = allGrob;
    const besteJe = new Map();
    for (const r of allGrob) { const b = besteJe.get(r.kanon); if (!b || r.score < b.score) besteJe.set(r.kanon, r); }
    const seeds = [...besteJe.values()].sort((a, b) => a.score - b.score).slice(0, suche.anzahlFein)
      .map(r => ({ keys: r.keys, x: r.x, kanon: r.kanon }));
    if (ausgangsSeed) seeds.push(ausgangsSeed);
    if (!seeds.length) {
      _optFinished(); URL.revokeObjectURL(blobUrl);
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine zulässige Variante gefunden — Randbedingungen prüfen.</div>';
      return;
    }
    const nFein = Math.min(numWorkers, seeds.length);
    const anteile = Array.from({ length: nFein }, () => []);
    seeds.forEach((s, i) => anteile[i % nFein].push(s));
    workerProgress.length = nFein; workerProgress.fill(0);
    const feinErg = [];
    let feinFertig = 0;
    window._optWorkers = [];
    anteile.forEach((teil, i) => {
      const w = createAndSendWorker('fein', { workerIdx: i, numWorkers: nFein, seeds: teil });
      window._optWorkers.push(w);
      w.onmessage = function(e) {
        if (runId !== window._optRunId || window._optAborted) return;
        const msg = e.data;
        if (msg.type === 'progress') {
          workerProgress[i] = msg.pct;
          updateProgress('Feinsuche');
        } else if (msg.type === 'done') {
          feinErg.push(...(msg.topFein || []));
          w.terminate();
          if (++feinFertig === nFein) {
            URL.revokeObjectURL(blobUrl);
            window._optLetzterLauf = { topFein: feinErg, startTime, params, info };
            _renderWorkerResults(feinErg, allGrob, resDiv, startTime, params, info);
          }
        }
      };
      w.onerror = e => fehler(e, 'Feinsuche fehlgeschlagen.');
    });
  }
}

/**
 * Aktuelle Planung als zusätzlicher Startpunkt der Feinsuche — so findet die Optimierung
 * mindestens so gute Lösungen wie eine von Hand eingestellte Variante desselben Konzepts.
 * null, wenn die Planung Erzeuger enthält, die nicht zur Auswahl stehen.
 */
export function _optAusgangsSeed(raum, achsen) {
  const live = (window._dispatchActiveKeys || []).filter(k => k !== '_autoGk' && ERZEUGER_CFG[k]);
  const keys = live.filter(k => !(raum.gasImplizit && k === 'gaskessel'));
  if (!live.length) return null;
  const k = raum.kombis.find(kk => kk.keys.length === keys.length && kk.keys.every(x => keys.includes(x)));
  if (!k) return null;
  const leist = key => parseFloat(document.getElementById(ERZEUGER_CFG[key]?.leistungId)?.value) || 0;
  const gens = k.keys.map((key, i) => i === k.backupIdx ? 1 : Math.max(1, Math.round(leist(key))));
  const zahl = id => Math.max(0, Math.round(parseFloat(document.getElementById(id)?.value) || 0));
  const x = gens.concat([
    achsen.pvAktiv ? zahl('pv-kwp') : 0,
    achsen.batAktiv ? zahl('bat-kapazitaet') : 0,
    achsen.stAktiv && solarthermieAktiv ? zahl('st-flaeche') : 0,
    achsen.tsAktiv && thermSpeicherAktiv ? zahl('ts-volumen') : 0,
  ]);
  return { keys: k.keys, x, kanon: null, ausgangsplanung: true };
}

/** Anzeige-Reihenfolge der Erzeuger eines Konzepts (Merit-Order, Gaskessel zuletzt). */
function _optAnzeigeKeys(kanon) {
  const rang = k => { const i = OPT_MERIT_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  return kanon.split('+').filter(Boolean).sort((a, b) => rang(a) - rang(b));
}

/** Ergebnis im Hauptthread mit demselben Code wie das Wirtschaftlichkeits-Panel nachrechnen. */
function _optNachrechnen(r, params) {
  const dispResult = {
    erzeugerList: r.config.map((c, i) => ({
      key: c.key, typ: ERZEUGER_CFG[c.key]?.typ || c.typ,
      leistKw: r.erzLeistKw?.[i] ?? c.leistKw,
      waermeMwh: r.erzWaermeMwh?.[i] ?? 0,
      elMwh: r.erzElMwh?.[i] ?? 0,
    })),
    autoGkMwh: r.autoGkMwh || 0,
    autoGkPeakKw: r.autoGkPeakKw || 0,
    gesamtMwh: r.gesamtMwh || 0,
    speicherEntladenMwh: r.speicherEntladenMwh || 0,
  };
  return _optKennwerte2(dispResult, r.pvKwp || 0, r.batKwh || 0, r.pvBatData || null, params, r.stMwh || 0, r.stM2 || 0, r.tsVol || 0);
}

/** Nach dem Umschalten „Gesamtsystem / Nur Wärmeerzeugung“: letzte Ergebnisse neu bewerten. */
export function _optUmfangGeaendert() {
  const L = window._optLetzterLauf;
  if (!L || window._optRunning) return;
  const resDiv = document.getElementById('opt-result-list');
  if (!resDiv) return;
  L.info = { ...L.info, ohneNetz: !!window._wirtOhneNetz };
  _renderWorkerResults(L.topFein, window._optGrobResults, resDiv, L.startTime, L.params, L.info, true);
}

export function _renderWorkerResults(topFein, grobResults, resDiv, startTime, params, info = {}, nurNeuBewertet = false) {
  if (!topFein || topFein.length === 0) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
    _optFinished();
    return;
  }
  const ziel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';

  // ── Nachrechnung aller Feinergebnisse im Hauptthread (gleicher Code wie das Wirtschafts-Panel) ──
  for (const r of topFein) {
    try {
      const recalc = _optNachrechnen(r, params);
      if (!nurNeuBewertet && Math.abs(r.kw.wgk - recalc.wgk) > 0.3) {
        console.warn('[WGK-DIFF]', r.kanon, '| Worker:', r.kw.wgk.toFixed(2), '| Main:', recalc.wgk.toFixed(2));
      }
      r.kw = recalc;
      r.score = _optScore(recalc, ziel);
      if (r.start) { r.start.kw = _optNachrechnen(r.start, params); r.start.score = _optScore(r.start.kw, ziel); }
    } catch (e) {
      console.warn('[WGK-RECALC] Fehler bei Nachrechnung:', e.message);
    }
  }

  // ── Je Anlagenkonzept nur die beste Variante (die Ausgangsplanung ist ein Startpunkt, kein eigenes Konzept) ──
  const besteJe = new Map();
  for (const r of topFein) {
    if (!Number.isFinite(r.score)) continue;
    const b = besteJe.get(r.kanon);
    if (!b || r.score < b.score) besteJe.set(r.kanon, r);
  }
  const top3 = [...besteJe.values()].sort((a, b) => a.score - b.score).slice(0, 3);
  for (const r of top3) r.anzeigeKeys = _optAnzeigeKeys(r.kanon);
  window._optTop3Final = top3;   // für die Markierung im Streudiagramm
  const ausgang = topFein.find(r => r.ausgangsplanung && r.start)?.start || null;

  resDiv.innerHTML = '';
  const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  // ── Kopf: Jahr, Betrachtungsumfang, Vergleich mit der aktuellen Planung ──
  const kopf = document.createElement('div');
  kopf.className = 'opt-ergebnis-kopf';
  const _optResYear = info.jahr || parseInt(document.getElementById('opt-year')?.value) || globalYear;
  let kopfHtml = '<span style="color:var(--accent);font-weight:600;">Betrachtungsjahr: ' + _optResYear + '</span>'
    + (window._basisYear && _optResYear !== window._basisYear ? ' <span style="color:#78909c;font-size:9px;">(Lastgang skaliert)</span>' : '')
    + ' <span class="opt-umfang-hinweis">' + (window._wirtOhneNetz ? 'Nur Wärmeerzeugung (ohne Netzkosten)' : 'Gesamtsystem inkl. Netz') + '</span>';
  if (ausgang?.kw && top3[0]) {
    const diff = ausgang.kw.wgk - top3[0].kw.wgk;
    kopfHtml += '<div class="opt-ausgang">Aktuelle Planung im selben Rechenmodell: <b>' + nf(ausgang.kw.wgk, 1) + ' ct/kWh</b>'
      + (ziel === 'min-wgk' && diff > 0.05 ? ' — Variante 1 ist ' + nf(diff, 1) + ' ct/kWh günstiger' : '') + '</div>';
  }
  kopf.innerHTML = kopfHtml;
  resDiv.appendChild(kopf);

  top3.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'opt-karte' + (idx === 0 ? ' opt-karte-erste' : '');
    const titel = r.anzeigeKeys.map(k => ERZEUGER_CFG[k]?.label || k).join(' + ')
      + (r.stM2 > 0 ? ' + ST ' + nf(r.stM2) + ' m²' : '')
      + (r.tsVol > 0 ? ' + WS ' + nf(r.tsVol) + ' m³' : '')
      + (r.pvKwp > 0 ? ' + PV ' + nf(r.pvKwp) + ' kWp' : '')
      + (r.batKwh > 0 ? ' + Batterie ' + nf(r.batKwh) + ' kWh' : '');

    const eeColor = r.kw.eeAnteil >= 65 ? '#81c784' : '#ef9a9a';
    const eeBadge = '<span style="background:' + eeColor + ';color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;">' + r.kw.eeAnteil.toFixed(0) + '% EE</span>';

    const totalInkST = (r.gesamtMwh || 0) + (r.stMwh || 0);
    let kpiHtml = '<div class="opt-karte-kpis">'
      + '<div class="opt-karte-wgk"><b>' + nf(r.kw.wgk, 1) + '</b><span>ct/kWh WGK</span></div>'
      + '<div class="opt-karte-werte">';
    const kpis2 = [
      { val: euroKompakt(r.kw.investGesamt), lbl: 'Investition' },
      { val: r.kw.jahreskosten ? euroKompakt(r.kw.jahreskosten, true) : '—', lbl: 'Jahreskosten' },
      { val: nf(r.kw.co2ta) + ' t/a', lbl: 'CO₂' },
      { val: nf(r.kw.stromAutarkie) + ' %', lbl: 'Strom-Autarkie' },
      { val: nf(r.kw.waermeAutarkie) + ' %', lbl: 'Wärme-Autarkie' },
      { val: nf(totalInkST) + ' MWh/a', lbl: 'Wärme gesamt' },
    ];
    for (const k of kpis2) kpiHtml += '<div><b>' + k.val + '</b><span>' + k.lbl + '</span></div>';
    kpiHtml += '</div></div>';

    // ── Erzeuger-Tabelle: Leistung, Energie, Anteil ──
    const zeile = (farbe, name, leistung, energie, pct) => '<div class="opt-erz-name"><i style="background:' + farbe + '"></i>' + name + '</div>'
      + '<div>' + leistung + '</div><div>' + energie + '</div>'
      + '<div class="opt-erz-anteil">' + (pct == null ? '—' : '<span><em style="width:' + Math.min(100, pct) + '%;background:' + farbe + '"></em></span>' + nf(pct) + ' %') + '</div>';
    let erzHtml = '<div class="opt-erz-tabelle"><div class="opt-erz-kopf">Erzeuger</div><div class="opt-erz-kopf">Leistung</div><div class="opt-erz-kopf">Wärme</div><div class="opt-erz-kopf">Anteil</div>';
    if (r.stM2 > 0 && r.stMwh > 0) {
      erzHtml += zeile('#ef6c00', 'Solarthermie ' + nf(r.stM2) + ' m²', '—', nf(r.stMwh) + ' MWh', totalInkST > 0 ? r.stMwh / totalInkST * 100 : 0);
    }
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const waermeMwh = r.erzWaermeMwh ? r.erzWaermeMwh[ci] : 0;
      const displayKw = r.erzLeistKw ? r.erzLeistKw[ci] : erz.leistKw;
      erzHtml += zeile(ERZEUGER_CFG[erz.key]?.color || '#aaa', escHtml(ERZEUGER_CFG[erz.key]?.label || erz.key), nf(displayKw) + ' kW', nf(waermeMwh) + ' MWh', totalInkST > 0 ? waermeMwh / totalInkST * 100 : 0);
    }
    if (r.autoGkMwh > 0.05) {
      erzHtml += zeile(ERZEUGER_CFG.gaskessel?.color || '#78909c', 'Gaskessel (Spitzenlast)', r.autoGkPeakKw ? nf(Math.ceil(r.autoGkPeakKw)) + ' kW' : '—', nf(r.autoGkMwh) + ' MWh', totalInkST > 0 ? r.autoGkMwh / totalInkST * 100 : 0);
    }
    if (r.pvKwp > 0) {
      erzHtml += zeile('#fdd835', 'PV' + (r.batKwh > 0 ? ' + Batterie' : ''), nf(r.pvKwp) + ' kWp' + (r.batKwh > 0 ? ' / ' + nf(r.batKwh) + ' kWh' : ''), nf(r.kw.pvErtragMwh) + ' MWh Strom', null);
    }
    erzHtml += '</div>';

    // PV am Rand des Suchraums: Grenze offenlegen, statt ein scheinbares Optimum zu zeigen
    let hinweis = '';
    const pg = info.pvGrenze;
    if (pg && r.pvKwp > 0 && r.pvKwp >= pg.kwp - Math.max(1, pg.kwp * 0.01)) {
      hinweis = '<div class="opt-karte-hinweis">PV an der Obergrenze ('
        + (pg.quelle === 'max' ? 'eingestellter Max-Wert' : pg.quelle === 'potenzial' ? 'PV-Potenzial des Projekts' : 'geschätzt aus dem Strombedarf — PV-Potenzial im PV-Modus erfassen oder Max-Wert setzen')
        + ', ' + nf(pg.kwp) + ' kWp): jede weitere kWp senkt die Kosten noch.</div>';
    }

    card.innerHTML =
      '<div class="opt-karte-kopf"><span class="opt-karte-rang">' + (idx + 1) + '</span>' +
        '<span class="opt-karte-titel">' + escHtml(titel) + '</span>' + eeBadge + '</div>' +
      kpiHtml + erzHtml + hinweis +
      '<div class="opt-karte-fuss"><button class="btn-secondary" data-click="_optVarianteUebernehmen(window._optLastResults[' + idx + '], this)">Als Variante übernehmen</button></div>';
    resDiv.appendChild(card);
  });

  // Ergebnis-Objekte für „Als Variante übernehmen“ und die Diagramme
  window._optLastResults = top3.map(r => ({
    keys: r.keys, anzeigeKeys: r.anzeigeKeys, config: r.config, pvKwp: r.pvKwp, batKwh: r.batKwh,
    stM2: r.stM2, stMwh: r.stMwh, tsVol: r.tsVol, kw: r.kw, erzLeistKw: r.erzLeistKw,
    sim: { gesamtMwh: r.gesamtMwh, autoGkMwh: r.autoGkMwh, autoGkPeakKw: r.autoGkPeakKw || 0,
      erzeugerList: r.config.map((c, i) => ({ ...c, waermeMwh: r.erzWaermeMwh?.[i] || 0,
        leistKw: r.erzLeistKw?.[i] || c.leistKw, elMwh: r.erzElMwh?.[i] || 0 })) },
    score: r.score,
  }));

  _optRenderBarChart(window._optLastResults, resDiv);
  _optRenderRadar(window._optLastResults, resDiv);
  _optRenderScatter(resDiv);

  const totalElapsed = ((Date.now() - startTime) / 1000);
  const timeLabel = totalElapsed < 60 ? totalElapsed.toFixed(1) + 's' : (totalElapsed / 60).toFixed(1) + ' min';
  const nEval = topFein.reduce((s, r) => s + (r.evals || 0), 0);
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'font-size:9px;color:var(--muted);text-align:center;margin-top:8px;';
  infoDiv.textContent = nurNeuBewertet ? 'Neu bewertet (Betrachtungsumfang geändert).'
    : 'Berechnung abgeschlossen in ' + timeLabel + ' · ' + (grobResults?.length || 0) + ' Startpunkte, '
      + besteJe.size + ' Konzepte verfeinert (' + nEval + ' Bewertungen)';
  resDiv.appendChild(infoDiv);

  if (!nurNeuBewertet) _optFinished();
}
