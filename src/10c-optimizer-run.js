// ── 10c-optimizer-run.js — Optimierung starten/abbrechen, Worker-Orchestrierung, Ergebnis-Rendering ──

function runOptimierung() {
  if (_optRunning) { _optAbbrechen(); return; }
  _optAborted = false;
  _optRunning = true;
  const btn = document.getElementById('btn-opt-start');
  if (btn) {
    btn.setAttribute('data-running', '1');
    btn.innerHTML = '&#x2716; Berechnung abbrechen';
  }
  const resDiv = document.getElementById('opt-result-list');
  resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Berechne&#x2026;</div>';

  // Versuche Web Worker, Fallback auf Main-Thread
  try {
    _runOptWorker(resDiv);
  } catch (e) {
    console.warn('Web Worker nicht verfügbar, Fallback auf Main-Thread:', e);
    setTimeout(() => _doRunOptimierung(resDiv), 30);
  }
}

function _optAbbrechen() {
  _optAborted = true;
  if (_optWorker) { _optWorker.terminate(); _optWorker = null; }
  for (const w of _optWorkers) { try { w.terminate(); } catch(e) {} }
  _optWorkers = [];
  _optFinished();
  const resDiv = document.getElementById('opt-result-list');
  if (resDiv) resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Abgebrochen.</div>';
}

function _optFinished() {
  _optRunning = false;
  _optWorker = null;
  _optWorkers = [];
  const btn = document.getElementById('btn-opt-start');
  if (btn) {
    btn.removeAttribute('data-running');
    btn.innerHTML = '&#x26A1; Optimalvarianten berechnen';
    btn.disabled = false;
  }
}

function _runOptWorker(resDiv) {
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
  const params = {
    pStrom: parseFloat(document.getElementById('wirt-p-strom')?.value) || 30,
    pGas: parseFloat(document.getElementById('wirt-p-gas')?.value) || 10,
    pPk: parseFloat(document.getElementById('wirt-p-pk')?.value) || 7,
    pHhs: parseFloat(document.getElementById('wirt-p-hhs')?.value) || 4,
    pHko: parseFloat(document.getElementById('wirt-p-hko')?.value) || 9.5,
    pFw: parseFloat(document.getElementById('wirt-p-fw')?.value) || 8,
    pEinsp: parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8,
    pBhkwEinsp: parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8,
    pBhkwKwkE: parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8,
    pBhkwKwkEig: parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4,
    zinssatz: (parseFloat(document.getElementById('wirt-zins')?.value) || 2.7) / 100,
  };

  // Quartier-Strom (gleiche Kaskade wie calcStromPanel)
  const quartierH = new Float32Array(8760);
  if (window.elQuartierH) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window.elQuartierH[t];
  } else if (window._elQuartierFromGeb) {
    for (let t = 0; t < 8760; t++) quartierH[t] = window._elQuartierFromGeb[t];
  } else {
    // Fallback: Manuelle Eingabe oder SLP aus Gebäudedaten
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

  // ── Hilfsfunktion: Worker mit Daten-Kopie starten ──
  function createAndSendWorker(mode, extraPayload) {
    const w = new Worker(blobUrl);
    const lastgang = new Float32Array(_optScaledLastgang || ss.lastgangKw);
    const tempArr = new Float32Array(ss.tempH);
    const vlArr = new Float32Array(ss.vlH);
    const pvArr = pvProfile ? new Float32Array(pvProfile) : null;
    const stArr = stNormProfile ? new Float32Array(stNormProfile) : null;
    const qArr = new Float32Array(quartierH);
    const transferList = [lastgang.buffer, tempArr.buffer, vlArr.buffer, qArr.buffer];
    if (pvArr) transferList.push(pvArr.buffer);
    if (stArr) transferList.push(stArr.buffer);
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
  function updateProgress(phase) {
    const totalPct = Math.round(workerProgress.reduce((s, v) => s + v, 0) / numWorkers);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const nwLabel = numWorkers > 1 ? ' \u00b7 ' + numWorkers + ' Kerne' : '';
    resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;font-size:10px;">' + phase + ': ' + totalPct + '% \u00b7 ' + elapsed + 's' + nwLabel + '</div>';
  }

  // ── Single Worker (Fallback für 1 Kern) ──
  if (numWorkers <= 1) {
    const worker = createAndSendWorker('full', { workerIdx: 0, numWorkers: 1 });
    _optWorker = worker;
    _optWorkers = [worker];
    worker.onmessage = function(e) {
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[0] = msg.pct;
        updateProgress(msg.phase);
      } else if (msg.type === 'done') {
        window._optGrobResults = msg.grobResults;
        _renderWorkerResults(msg.topFein, msg.grobResults, resDiv, startTime, params);
      }
    };
    worker.onerror = function(e) {
      console.error('OptWorker Error:', e);
      _optWorker = null; _optWorkers = [];
      resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Worker-Fehler, Fallback&#x2026;</div>';
      setTimeout(() => _doRunOptimierung(resDiv), 30);
    };
    URL.revokeObjectURL(blobUrl);
    return;
  }

  // ── Multi-Worker: Phase 1 — Grobsuche parallelisiert ──
  console.log('[OPT] Multi-Worker Grobsuche mit', numWorkers, 'Kernen');
  let allGrobResults = [];
  let grobWorkersFinished = 0;
  let hadError = false;
  _optWorkers = [];

  for (let i = 0; i < numWorkers; i++) {
    const w = createAndSendWorker('grob', { workerIdx: i, numWorkers });
    _optWorkers.push(w);

    w.onmessage = function(e) {
      if (_optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[msg.workerIdx || i] = msg.pct;
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
      console.error('OptWorker', i, 'Error:', e);
      if (!hadError) {
        hadError = true;
        for (const wk of _optWorkers) { try { wk.terminate(); } catch(ex) {} }
        _optWorker = null; _optWorkers = [];
        resDiv.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Worker-Fehler, Fallback&#x2026;</div>';
        setTimeout(() => _doRunOptimierung(resDiv), 30);
      }
    };
  }
  URL.revokeObjectURL(blobUrl);

  // ── Multi-Worker: Phase 2 — Feinsuche mit einem Worker ──
  function _startFeinPhase() {
    if (_optAborted) return;
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
    const fLastgang = new Float32Array(_optScaledLastgang || ss.lastgangKw);
    const fTempArr = new Float32Array(ss.tempH);
    const fVlArr = new Float32Array(ss.vlH);
    const fPvArr = pvProfile ? new Float32Array(pvProfile) : null;
    const fStArr = stNormProfile ? new Float32Array(stNormProfile) : null;
    const fQArr = new Float32Array(quartierH);
    const fTransferList = [fLastgang.buffer, fTempArr.buffer, fVlArr.buffer, fQArr.buffer];
    if (fPvArr) fTransferList.push(fPvArr.buffer);
    if (fStArr) fTransferList.push(fStArr.buffer);
    feinWorker.postMessage({
      ...basePayload, mode: 'fein', workerIdx: 0, numWorkers: 1, topNGrob,
      lastgangKw: fLastgang, tempH: fTempArr, vlH: fVlArr,
      pvProfile: fPvArr, stNormProfile: fStArr, quartierH: fQArr,
    }, fTransferList);
    _optWorker = feinWorker;
    _optWorkers = [feinWorker];
    URL.revokeObjectURL(url2);

    feinWorker.onmessage = function(e) {
      if (_optAborted) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        workerProgress[0] = msg.pct;
        updateProgress('Feinsuche');
      } else if (msg.type === 'done') {
        _renderWorkerResults(msg.topFein, window._optGrobResults, resDiv, startTime, params);
      }
    };

    feinWorker.onerror = function(e) {
      console.error('Fein-Worker Error:', e);
      _optFinished();
      resDiv.innerHTML = '<div style="color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;font-size:10px;">Feinsuche fehlgeschlagen.</div>';
    };
  }
}

function _renderWorkerResults(topFein, grobResults, resDiv, startTime, params) {
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
    card.style.cssText = 'background:var(--surface2);border-radius:8px;padding:12px 14px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.3);';

    const titel = r.keys.map(k => ERZEUGER_CFG[k]?.label || k).join(' + ')
      + (r.stM2 > 0 ? ' + ST ' + r.stM2 + ' m\u00b2' : '')
      + (r.tsVol > 0 ? ' + WS ' + r.tsVol + ' m\u00b3' : '')
      + (r.pvKwp > 0 ? ' + PV ' + r.pvKwp.toFixed(0) + ' kWp' : '')
      + (r.batKwh > 0 ? ' + Bat ' + r.batKwh.toFixed(0) + ' kWh' : '');

    const eeColor = r.kw.eeAnteil >= 65 ? '#81c784' : '#ef9a9a';
    const eeBadge = '<span style="background:' + eeColor + ';color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;">' + r.kw.eeAnteil.toFixed(0) + '% EE</span>';

    // ── Hauptzeile: WGK prominent + Sekundär-KPIs ──
    const totalInkST = (r.gesamtMwh || 0) + (r.stMwh || 0);

    let kpiHtml = '<div style="display:flex;align-items:stretch;gap:6px;margin:6px 0;">';
    // WGK groß links
    kpiHtml += '<div style="background:rgba(253,216,53,0.08);border:1px solid rgba(253,216,53,0.25);border-radius:6px;padding:6px 12px;text-align:center;min-width:80px;">'
      + '<div style="font-size:18px;font-weight:700;color:#fdd835;line-height:1.1;">' + r.kw.wgk.toFixed(1) + '</div>'
      + '<div style="font-size:8px;color:var(--muted);margin-top:1px;">ct/kWh</div></div>';
    // Sekundär-KPIs rechts
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

    // ── Erzeuger-Tabelle: Leistung, Energie, Anteil ──
    let erzHtml = '<div style="display:grid;grid-template-columns:auto repeat(3,1fr);gap:0 8px;font-size:9px;margin:4px 0;padding:4px 0;border-top:1px solid var(--border);">';
    // Header
    erzHtml += '<div style="color:var(--muted);font-size:8px;">Erzeuger</div>'
      + '<div style="color:var(--muted);font-size:8px;text-align:right;">Leistung</div>'
      + '<div style="color:var(--muted);font-size:8px;text-align:right;">Energie</div>'
      + '<div style="color:var(--muted);font-size:8px;text-align:right;">Anteil</div>';
    // Solarthermie
    if (r.stM2 > 0 && r.stMwh > 0) {
      const dckPct = totalInkST > 0 ? (r.stMwh / totalInkST * 100) : 0;
      erzHtml += '<div><span style="color:#ef6c00;">\u25CF</span> ST ' + r.stM2 + ' m\u00b2</div>'
        + '<div style="text-align:right;">\u2014</div>'
        + '<div style="text-align:right;">' + r.stMwh.toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
    }
    for (let ci = 0; ci < r.config.length; ci++) {
      const erz = r.config[ci];
      const waermeMwh = r.erzWaermeMwh ? r.erzWaermeMwh[ci] : 0;
      const col = ERZEUGER_CFG[erz.key]?.color || '#aaa';
      const dckPct = totalInkST > 0 ? (waermeMwh / totalInkST * 100) : 0;
      const displayKw = r.erzLeistKw ? r.erzLeistKw[ci] : erz.leistKw;
      erzHtml += '<div><span style="color:' + col + ';">\u25CF</span> ' + (ERZEUGER_CFG[erz.key]?.label || erz.key) + '</div>'
        + '<div style="text-align:right;">' + displayKw.toFixed(0) + ' kW</div>'
        + '<div style="text-align:right;">' + waermeMwh.toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
    }
    if (r.autoGkMwh > 0) {
      const dckPct = totalInkST > 0 ? (r.autoGkMwh / totalInkST * 100) : 0;
      erzHtml += '<div><span style="color:#78909c;">\u25CF</span> Backup-GK</div>'
        + '<div style="text-align:right;">\u2014</div>'
        + '<div style="text-align:right;">' + r.autoGkMwh.toFixed(0) + ' MWh</div>'
        + '<div style="text-align:right;font-weight:600;">' + dckPct.toFixed(0) + '%</div>';
    }
    // PV/Batterie
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

  // Ergebnis-Objekte für "Als Variante übernehmen" bereitstellen
  // Konvertiere Worker-Ergebnisse in das erwartete Format
  window._optLastResults = top3.map(r => ({
    keys: r.keys, config: r.config, pvKwp: r.pvKwp, batKwh: r.batKwh,
    stM2: r.stM2, stMwh: r.stMwh, tsVol: r.tsVol, kw: r.kw,
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

