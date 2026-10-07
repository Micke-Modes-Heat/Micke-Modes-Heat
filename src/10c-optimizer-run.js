// ── 10c-optimizer-run.js — Optimierung starten/abbrechen, Worker-Orchestrierung, Ergebnis-Rendering ──

import { euroKompakt } from './lib/euro-format.js';
import { globalYear } from './01-globals-varianten.js';
import { aggregateGebStrom } from './02b-gebaeude.js';
import { escHtml } from './03c-gebaeude-io.js';
import { makeStProfile8760 } from './06b-gl-berechnen.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { _collectOptDomParams, _optGetScaledLastgang, _optKennwerte2, _optScore } from './10a-optimizer-core.js';

import { _buildOptWorkerCode, _doRunOptimierung, _optRenderBarChart, _optRenderRadar, _optRenderScatter } from './10d-optimizer-worker.js';
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
  const stNormProfile = document.getElementById('opt-cand-st')?.checked ? ((typeof makeStProfile8760 === 'function') ? makeStProfile8760(1) : null) : null;

  // Kandidaten, Constraints, Ziel, Quality auslesen
  const allKeys = ['lwwp','fg','geo','gaskessel','bhkw','stromkessel','pellets','hhs','fernwaerme','heizoel'];
  const aktiv = allKeys.filter(k => document.getElementById('opt-cand-' + k)?.checked);
  const pvAktiv = !!document.getElementById('opt-cand-pv')?.checked;
  const batAktiv = !!document.getElementById('opt-cand-bat')?.checked;
  const stAktiv = !!document.getElementById('opt-cand-st')?.checked;
  const tsAktiv = !!document.getElementById('opt-cand-ts')?.checked;
  const constraints = {};
  for (const k of [...allKeys, 'pv', 'bat', 'ts']) {
    constraints[k] = {
      minKw: parseFloat(document.getElementById('opt-min-' + k)?.value) || 0,
      maxKw: parseFloat(document.getElementById('opt-max-' + k)?.value) || 0,
      bisJahr: parseInt(document.getElementById('opt-bis-' + k)?.value) || 0,
    };
  }
  const ziel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';
  const quality = document.getElementById('opt-quality')?.value || 'standard';
  const optYear = parseInt(document.getElementById('opt-year')?.value) || (typeof globalYear !== 'undefined' ? globalYear : 2026);
  const globalYr = optYear;
  // Lastgang für das gewählte Betrachtungsjahr skalieren
  const _optScaledLastgang = _optGetScaledLastgang(optYear);

  // Wirtschaftsparameter
  const _pStromOpt = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const _pWpRawOpt = parseFloat(document.getElementById('wirt-p-strom-wp')?.value);
  const _zinsRawOpt = parseFloat(document.getElementById('wirt-zins')?.value);
  const params = {
    // Fallbacks = HTML-Defaults der wirt-p-* Felder (einheitlich in allen Modulen)
    pStrom: _pStromOpt,
    pStromWp: isNaN(_pWpRawOpt) ? _pStromOpt : _pWpRawOpt, // optionaler WP-Sondervertragspreis
    pGas: parseFloat(document.getElementById('wirt-p-gas')?.value) || 10,
    pPk: parseFloat(document.getElementById('wirt-p-pk')?.value) || 8,
    pHhs: parseFloat(document.getElementById('wirt-p-hhs')?.value) || 6,
    pHko: parseFloat(document.getElementById('wirt-p-hko')?.value) || 10,
    pFw: parseFloat(document.getElementById('wirt-p-fw')?.value) || 17,
    pEinsp: parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8,
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

  // Anzahl paralleler Worker bestimmen (min 1, max 8, einen Kern für UI freilassen)
  const numWorkers = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const startTime = Date.now();

  const workerCode = _buildOptWorkerCode();
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  // Gemeinsame Payload (ohne Transferable — wird pro Worker kopiert)
  const basePayload = {
    dom, params, aktiv, constraints, ziel, quality,
    pvAktiv, batAktiv, stAktiv, tsAktiv, globalYear: globalYr,
  };
  const shareSeries = canUseSharedWorkerSeries();
  const sharedSeries = shareSeries ? {
    lastgang:copyWorkerSeries(_optScaledLastgang || ss.lastgangKw,true), temp:copyWorkerSeries(ss.tempH,true),
    vl:copyWorkerSeries(ss.vlH,true), pv:pvProfile?copyWorkerSeries(pvProfile,true):null,
    st:stNormProfile?copyWorkerSeries(stNormProfile,true):null, quartier:copyWorkerSeries(quartierH,true),
  } : null;
  window._optSeriesTransport = shareSeries ? 'shared-array-buffer' : 'transferable-copy';

  // ── Hilfsfunktion: Worker mit Daten-Kopie starten ──
  function createAndSendWorker(mode, extraPayload) {
    const w = new Worker(blobUrl);
    const lastgang = sharedSeries?.lastgang || new Float32Array(_optScaledLastgang || ss.lastgangKw);
    const tempArr = sharedSeries?.temp || new Float32Array(ss.tempH);
    const vlArr = sharedSeries?.vl || new Float32Array(ss.vlH);
    const pvArr = sharedSeries?.pv || (pvProfile ? new Float32Array(pvProfile) : null);
    const stArr = sharedSeries?.st || (stNormProfile ? new Float32Array(stNormProfile) : null);
    const qArr = sharedSeries?.quartier || new Float32Array(quartierH);
    const transferList = shareSeries ? [] : [lastgang.buffer, tempArr.buffer, vlArr.buffer, qArr.buffer];
    if (!shareSeries && pvArr) transferList.push(pvArr.buffer);
    if (!shareSeries && stArr) transferList.push(stArr.buffer);
    const payload = {
      ...basePayload, ...extraPayload, mode,
      lastgangKw: lastgang, tempH: tempArr, vlH: vlArr,
      pvProfile: pvArr, stNormProfile: stArr, quartierH: qArr,
    };
    w.postMessage(payload, transferList);
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
      const erz = (r.config || []).map(c => name(c.key) + ' ' + Math.round(c.leistKw) + ' kW').join(' + ');
      const extras = [];
      if (r.pvKwp > 0) extras.push('PV ' + r.pvKwp + ' kWp');
      if (r.batKwh > 0) extras.push('Bat. ' + r.batKwh + ' kWh');
      if (r.stM2 > 0) extras.push('ST ' + r.stM2 + ' m²');
      if (r.tsVol > 0) extras.push('Speicher ' + r.tsVol + ' m³');
      const wgk = (r.wgk != null && r.wgk < 1e6) ? r.wgk.toFixed(1).replace('.', ',') + ' €/MWh' : '';
      return '<div style="padding:3px 6px;border-left:2px solid ' + (i === 0 ? '#fdd835' : 'var(--border)') + ';margin-bottom:2px;font-size:9px;color:var(--text);">'
        + (i + 1) + '. ' + escHtml(erz)
        + (extras.length ? ' · ' + escHtml(extras.join(' · ')) : '')
        + (wgk ? ' <span style="color:#fdd835;">' + wgk + '</span>' : '')
        + '</div>';
    });
    return '<div style="margin-top:6px;text-align:left;">'
      + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Beste Varianten bisher</div>'
      + rows.join('') + '</div>';
  }

  function updateProgress(phase) {
    const totalPct = Math.round(workerProgress.reduce((s, v) => s + v, 0) / numWorkers);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const nwLabel = numWorkers > 1 ? ' \u00b7 ' + numWorkers + ' Kerne' : '';
    resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">' + phase + ': ' + totalPct + '% \u00b7 ' + elapsed + 's' + nwLabel + '</div>'
      + _zwischenstandHtml();
  }

  // ── Single Worker (Fallback für 1 Kern) ──
  if (numWorkers <= 1) {
    const worker = createAndSendWorker('full', { workerIdx: 0, numWorkers: 1 });
    window._optWorker = worker;
    window._optWorkers = [worker];
    worker.onmessage = function(e) {
      if (runId !== window._optRunId) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[0] = msg.pct;
        if (msg.best3) workerBest3[0] = msg.best3;
        updateProgress(msg.phase);
      } else if (msg.type === 'done') {
        window._optGrobResults = msg.grobResults;
        _renderWorkerResults(msg.topFein, msg.grobResults, resDiv, startTime, params);
      }
    };
    worker.onerror = function(e) {
      if (runId !== window._optRunId) return;
      console.error('OptWorker Error:', e);
      window._optWorker = null; window._optWorkers = [];
      _optFinished();
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;">Worker-Fehler. Die Suche wurde beendet; es erfolgt keine blockierende Berechnung im Hauptfenster.</div>';
    };
    URL.revokeObjectURL(blobUrl);
    return;
  }

  // ── Multi-Worker: Phase 1 — Grobsuche parallelisiert ──
  console.log('[OPT] Multi-Worker Grobsuche mit', numWorkers, 'Kernen');
  let allGrobResults = [];
  let grobWorkersFinished = 0;
  let hadError = false;
  window._optWorkers = [];

  for (let i = 0; i < numWorkers; i++) {
    const w = createAndSendWorker('grob', { workerIdx: i, numWorkers });
    window._optWorkers.push(w);

    w.onmessage = function(e) {
      if (runId !== window._optRunId) return;
      if (window._optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[msg.workerIdx || i] = msg.pct;
        if (msg.best3) workerBest3[msg.workerIdx || i] = msg.best3;
        updateProgress('Grobsuche');
      } else if (msg.type === 'grob_done') {
        allGrobResults.push(...(msg.grobResults || []));
        grobWorkersFinished++;
        workerProgress[msg.workerIdx || i] = 100;
        updateProgress('Grobsuche');
        w.terminate();
        if (grobWorkersFinished === numWorkers) {
          _startFeinPhase();
        }
      }
    };

    w.onerror = function(e) {
      if (runId !== window._optRunId) return;
      console.error('OptWorker', i, 'Error:', e);
      if (!hadError) {
        hadError = true;
        for (const wk of window._optWorkers) { try { wk.terminate(); } catch(ex) {} }
        window._optWorker = null; window._optWorkers = [];
        _optFinished();
        resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;">Worker-Fehler. Die Suche wurde beendet; bitte erneut starten oder Suchqualität reduzieren.</div>';
      }
    };
  }
  URL.revokeObjectURL(blobUrl);

  // ── Multi-Worker: Phase 2 — Feinsuche mit einem Worker ──
  function _startFeinPhase() {
    if (window._optAborted) return;
    // Grobresultate zusammenführen, deduplizieren, Top 5 auswählen
    allGrobResults.sort((a, b) => a.score - b.score);
    const seen = new Set();
    const grobTop = [];
    for (const r of allGrobResults) {
      if (!seen.has(r.kombiKey)) { seen.add(r.kombiKey); grobTop.push(r); }
    }
    const topNGrob = grobTop.slice(0, 5);
    window._optGrobResults = allGrobResults.map(r => ({
      kombiKey: r.kombiKey, keys: r.keys, kw: r.kw, score: r.score,
      stM2: r.stM2, tsVol: r.tsVol, pvKwp: r.pvKwp, batKwh: r.batKwh
    }));

    if (topNGrob.length === 0) {
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
      _optFinished();
      return;
    }

    console.log('[OPT] Feinsuche für', topNGrob.length, 'Varianten');
    workerProgress.fill(0);

    // Neuen Blob-URL erzeugen (der alte wurde nach der Grobsuche revoked)
    const workerCode2 = _buildOptWorkerCode();
    const blob2 = new Blob([workerCode2], { type: 'application/javascript' });
    const url2 = URL.createObjectURL(blob2);
    const feinWorker = new Worker(url2);
    // Daten-Kopien für den Fein-Worker erstellen und senden
    const fLastgang = sharedSeries?.lastgang || new Float32Array(_optScaledLastgang || ss.lastgangKw);
    const fTempArr = sharedSeries?.temp || new Float32Array(ss.tempH);
    const fVlArr = sharedSeries?.vl || new Float32Array(ss.vlH);
    const fPvArr = sharedSeries?.pv || (pvProfile ? new Float32Array(pvProfile) : null);
    const fStArr = sharedSeries?.st || (stNormProfile ? new Float32Array(stNormProfile) : null);
    const fQArr = sharedSeries?.quartier || new Float32Array(quartierH);
    const fTransferList = shareSeries ? [] : [fLastgang.buffer, fTempArr.buffer, fVlArr.buffer, fQArr.buffer];
    if (!shareSeries && fPvArr) fTransferList.push(fPvArr.buffer);
    if (!shareSeries && fStArr) fTransferList.push(fStArr.buffer);
    feinWorker.postMessage({
      ...basePayload, mode: 'fein', workerIdx: 0, numWorkers: 1, topNGrob,
      lastgangKw: fLastgang, tempH: fTempArr, vlH: fVlArr,
      pvProfile: fPvArr, stNormProfile: fStArr, quartierH: fQArr,
    }, fTransferList);
    window._optWorker = feinWorker;
    window._optWorkers = [feinWorker];
    URL.revokeObjectURL(url2);

    feinWorker.onmessage = function(e) {
      if (runId !== window._optRunId) return;
      if (window._optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[0] = msg.pct;
        updateProgress('Feinsuche');
      } else if (msg.type === 'done') {
        _renderWorkerResults(msg.topFein, window._optGrobResults, resDiv, startTime, params);
      }
    };

    feinWorker.onerror = function(e) {
      if (runId !== window._optRunId) return;
      console.error('Fein-Worker Error:', e);
      _optFinished();
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Feinsuche fehlgeschlagen.</div>';
    };
  }
}

export function _renderWorkerResults(topFein, grobResults, resDiv, startTime, params) {
  if (!topFein || topFein.length === 0) {
    resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Keine Ergebnisse.</div>';
    _optFinished();
    return;
  }
  topFein.sort((a, b) => a.score - b.score);
  const top3 = topFein.slice(0, 3);

  // ── WGK-Nachrechnung auf dem Main-Thread (gleicher Code wie Wirtschafts-Panel) ──
  // Damit Optimizer-WGK und Panel-WGK garantiert übereinstimmen
  for (const r of top3) {
    try {
      // Dispatch-Ergebnis aus Worker-Daten rekonstruieren
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
      // PV/Bat-Ergebnis aus Worker-Daten verwenden
      const pvBatResult = r.pvBatData || null;
      // WGK mit _optKennwerte2 neu berechnen (Main-Thread)
      const recalc = _optKennwerte2(dispResult, r.pvKwp || 0, r.batKwh || 0, pvBatResult, params, r.stMwh || 0, r.stM2 || 0, r.tsVol || 0);
      // Vergleich loggen
      const wWorker = r.kw.wgk, wMain = recalc.wgk;
      if (Math.abs(wWorker - wMain) > 0.3) {
        console.warn('[WGK-DIFF] #' + (top3.indexOf(r)+1), r.keys.join('+'),
          '| Worker:', wWorker.toFixed(1), '| Main:', wMain.toFixed(1), '| Diff:', (wWorker - wMain).toFixed(1),
          '| W-JK:', Math.round(r.kw.jahreskosten), '| M-JK:', Math.round(recalc.jahreskosten),
          '| W-Inv:', Math.round(r.kw.investGesamt), '| M-Inv:', Math.round(recalc.investGesamt));
      }
      // Main-Thread-Ergebnis verwenden (konsistent mit Panel)
      r.kw = recalc;
    } catch (e) {
      console.warn('[WGK-RECALC] Fehler bei Nachrechnung:', e.message);
    }
  }

  // Re-sort nach Nachrechnung (Reihenfolge könnte sich ändern)
  const _reZiel = document.querySelector('input[name="opt-ziel"]:checked')?.value || 'min-wgk';
  top3.sort((a, b) => _optScore(a.kw, _reZiel) - _optScore(b.kw, _reZiel));
  window._optTop3Final = top3;   // für die Markierung im Streudiagramm

  resDiv.innerHTML = '';
  // Jahr-Info im Ergebnis anzeigen
  const _optResYear = parseInt(document.getElementById('opt-year')?.value) || globalYear;
  const _optResYearDiv = document.createElement('div');
  _optResYearDiv.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;';
  _optResYearDiv.innerHTML = '<span style="color:var(--accent);font-weight:600;">Betrachtungsjahr: ' + _optResYear + '</span>'
    + (window._basisYear && _optResYear !== window._basisYear ? ' <span style="color:#78909c;font-size:9px;">(Lastgang skaliert)</span>' : '');
  resDiv.appendChild(_optResYearDiv);
  top3.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'opt-karte' + (idx === 0 ? ' opt-karte-erste' : '');

    const titel = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join(' + ')
      + (r.stM2 > 0 ? ' + ST ' + r.stM2 + ' m\u00b2' : '')
      + (r.tsVol > 0 ? ' + WS ' + r.tsVol + ' m\u00b3' : '')
      + (r.pvKwp > 0 ? ' + PV ' + Math.round(r.pvKwp).toLocaleString('de-DE') + ' kWp' : '')
      + (r.batKwh > 0 ? ' + Batterie ' + Math.round(r.batKwh).toLocaleString('de-DE') + ' kWh' : '');

    const eeColor = r.kw.eeAnteil >= 65 ? '#81c784' : '#ef9a9a';
    const eeBadge = '<span style="background:' + eeColor + ';color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;">' + r.kw.eeAnteil.toFixed(0) + '% EE</span>';

    // ── Hauptzeile: WGK prominent + Sekundär-KPIs ──
    const totalInkST = (r.gesamtMwh || 0) + (r.stMwh || 0);
    const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

    let kpiHtml = '<div class="opt-karte-kpis">'
      + '<div class="opt-karte-wgk"><b>' + nf(r.kw.wgk, 1) + '</b><span>ct/kWh WGK</span></div>'
      + '<div class="opt-karte-werte">';
    const kpis2 = [
      { val: euroKompakt(r.kw.investGesamt), lbl: 'Investition' },
      { val: r.kw.jahreskosten ? euroKompakt(r.kw.jahreskosten, true) : '\u2014', lbl: 'Jahreskosten' },
      { val: nf(r.kw.co2ta) + ' t/a', lbl: 'CO\u2082' },
      { val: nf(r.kw.stromAutarkie) + ' %', lbl: 'Strom-Autarkie' },
      { val: nf(r.kw.waermeAutarkie) + ' %', lbl: 'W\u00e4rme-Autarkie' },
      { val: nf(totalInkST) + ' MWh/a', lbl: 'W\u00e4rme gesamt' },
    ];
    for (const k of kpis2) kpiHtml += '<div><b>' + k.val + '</b><span>' + k.lbl + '</span></div>';
    kpiHtml += '</div></div>';

    // ── Erzeuger-Tabelle: Leistung, Energie, Anteil (mit Balken) ──
    const zeile = (farbe, name, leistung, energie, pct) => '<div class="opt-erz-name"><i style="background:' + farbe + '"></i>' + name + '</div>'
      + '<div>' + leistung + '</div><div>' + energie + '</div>'
      + '<div class="opt-erz-anteil">' + (pct == null ? '\u2014' : '<span><em style="width:' + Math.min(100, pct) + '%;background:' + farbe + '"></em></span>' + nf(pct) + ' %') + '</div>';
    let erzHtml = '<div class="opt-erz-tabelle"><div class="opt-erz-kopf">Erzeuger</div><div class="opt-erz-kopf">Leistung</div><div class="opt-erz-kopf">W\u00e4rme</div><div class="opt-erz-kopf">Anteil</div>';
    if (r.stM2 > 0 && r.stMwh > 0) {
      erzHtml += zeile('#ef6c00', 'Solarthermie ' + nf(r.stM2) + ' m\u00b2', '\u2014', nf(r.stMwh) + ' MWh', totalInkST > 0 ? r.stMwh / totalInkST * 100 : 0);
    }
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const waermeMwh = r.erzWaermeMwh ? r.erzWaermeMwh[ci] : 0;
      const displayKw = r.erzLeistKw ? r.erzLeistKw[ci] : erz.leistKw;
      erzHtml += zeile(ERZEUGER_CFG[erz.key]?.color || '#aaa', escHtml(ERZEUGER_CFG[erz.key]?.label || erz.key), nf(displayKw) + ' kW', nf(waermeMwh) + ' MWh', totalInkST > 0 ? waermeMwh / totalInkST * 100 : 0);
    }
    if (r.autoGkMwh > 0) {
      erzHtml += zeile('#78909c', 'Spitzenlast-Gaskessel (automatisch)', r.autoGkPeakKw ? nf(r.autoGkPeakKw) + ' kW' : '\u2014', nf(r.autoGkMwh) + ' MWh', totalInkST > 0 ? r.autoGkMwh / totalInkST * 100 : 0);
    }
    if (r.pvKwp > 0) {
      erzHtml += zeile('#fdd835', 'PV' + (r.batKwh > 0 ? ' + Batterie' : ''), nf(r.pvKwp) + ' kWp' + (r.batKwh > 0 ? ' / ' + nf(r.batKwh) + ' kWh' : ''), nf(r.kw.pvErtragMwh) + ' MWh Strom', null);
    }
    erzHtml += '</div>';

    card.innerHTML =
      '<div class="opt-karte-kopf"><span class="opt-karte-rang">' + (idx + 1) + '</span>' +
        '<span class="opt-karte-titel">' + escHtml(titel) + '</span>' + eeBadge + '</div>' +
      kpiHtml +
      erzHtml +
      '<div class="opt-karte-fuss"><button class="btn-secondary" data-click="_optVarianteUebernehmen(window._optLastResults[' + idx + '], this)">Als Variante \u00fcbernehmen</button></div>';
    resDiv.appendChild(card);
  });

  // Ergebnis-Objekte für "Als Variante übernehmen" bereitstellen
  // Konvertiere Worker-Ergebnisse in das erwartete Format
  window._optLastResults = top3.map(r => ({
    keys: r.keys, config: r.config, pvKwp: r.pvKwp, batKwh: r.batKwh,
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
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'font-size:9px;color:var(--muted);text-align:center;margin-top:8px;';
  infoDiv.textContent = 'Berechnung abgeschlossen in ' + timeLabel + ' (' + (grobResults?.length || 0) + ' Konfigurationen getestet)';
  resDiv.appendChild(infoDiv);

  window._optCachedPvProfile = null;
  _optFinished();
}
