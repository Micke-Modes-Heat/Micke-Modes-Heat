// ── 09b-pv-calc.js — calcStromPanel, Batterie, PV-Wirtschaftlichkeit ──
// ── Hauptberechnung Strom-Panel ───────────────────────────────────────────
export let _calcStromTimer = null;
export function calcStromPanelDebounced() { clearTimeout(_calcStromTimer); _calcStromTimer = setTimeout(calcStromPanel, 120); }
export function calcStromPanel() {
  if (calcStromPanel._updating) return;

  // PV-Invest auto-update bei Bedarf (Guard gegen Rekursion durch oninput)
  if (!calcStromPanel._updating && document.getElementById('pv-invest-auto')?.checked && typeof CalcEngine !== 'undefined') {
    const _kwpTotal = (parseFloat(document.getElementById('pv-kwp')?.value) || 0)
      + gebaeude.reduce((s, g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0)
      + freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);
    if (_kwpTotal > 0) {
      const autoVal = CalcEngine.getPvInvestPerKwp(_kwpTotal);
      const invEl = document.getElementById('opt-pv-invest');
      if (invEl && Math.abs(parseFloat(invEl.value) - autoVal) > 10) {
        calcStromPanel._updating = true;
        invEl.value = autoVal;
        calcStromPanel._updating = false;
      }
    }
  }

  // PV-Vergütung auto-update bei Teileinspeisung/Volleinspeisung (Guard gegen Rekursion)
  if (!calcStromPanel._updating) {
    const _pvModell = document.getElementById('pv-verg-modell')?.value;
    if (_pvModell === 'teil' || _pvModell === 'voll') {
      calcStromPanel._updating = true;
      onPvVergModellChange();
      calcStromPanel._updating = false;
    }
  }

  const en  = window._dispatchEnergy || {};
  const WP_KEYS = ['lwwp', 'fg', 'geo'];

  // WP-Strombedarf gesamt (aus Dispatch)
  const wpMwh = WP_KEYS.reduce((s, k) => s + ((en[k] || {}).elMwh || 0), 0);

  // Stromkessel-Verbrauch (aus Dispatch)
  const skMwh = (en['stromkessel'] || {}).elMwh || 0;

  // Quartier-Stromlastgang
  let quartierMwh = 0;
  if (window.elQuartierH) {
    // Priorität 1: Upload
    for (let i = 0; i < window.elQuartierH.length; i++) quartierMwh += window.elQuartierH[i];
    quartierMwh /= 1000;
  } else {
    // Priorität 2: Manuelle Jahressumme
    const manMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
    const synthInfoEl = document.getElementById('strom-quartier-synth-info');
    if (manMwh > 0) {
      quartierMwh = manMwh;
      if (synthInfoEl) synthInfoEl.textContent = '';
    } else {
      // Priorität 3: Gebäudescharfe Stromverbräuche (SLP-basiert)
      const gebStrom = typeof aggregateGebStrom === 'function' ? aggregateGebStrom() : null;
      if (gebStrom && gebStrom.totalMWh > 0) {
        quartierMwh = gebStrom.totalMWh;
        // Auto-populate elQuartierH for dispatch calculations
        window._elQuartierFromGeb = gebStrom.hourly;
        if (synthInfoEl) synthInfoEl.textContent =
          `↳ Aus Gebäudedaten aggregiert (${quartierMwh.toFixed(0)} MWh/a, ${gebaeude.filter(g => getGebStromMwh(g) > 0).length} Geb.) — Lastgang hochladen für genauere Werte`;
      } else {
        // Priorität 4: Pauschalwerte
        const SPEZ = { efh: 30, mfh: 20, rei: 20, kdg: 25, bue: 30, ghd: 40, ind: 60, sonder: 25 };
        quartierMwh = gebaeude.reduce((s, g) => {
          const fl  = parseFloat(g.flaeche) || 0;
          const typ = (g.typ || 'mfh').toLowerCase();
          const spez = SPEZ[typ] || SPEZ.mfh;
          return s + fl * spez / 1000;
        }, 0);
        if (synthInfoEl) synthInfoEl.textContent = quartierMwh > 0
          ? `↳ Pauschalwert aus Gebäudeflächen (${quartierMwh.toFixed(0)} MWh/a) — Strom je Gebäude eingeben oder Lastgang hochladen` : '';
      }
    }
  }

  // Stündliches Quartier-Strom-Profil sicherstellen (für Live-View)
  if (!window.elQuartierH && !window._elQuartierFromGeb && quartierMwh > 0) {
    const flat = new Float32Array(8760);
    const kwConst = quartierMwh * 1000 / 8760;
    for (let i = 0; i < 8760; i++) flat[i] = kwConst;
    window._elQuartierFromGeb = flat;
  }

  // PV-Erzeugung — Pauschal (Upload oder kWp) + Gebäude-PV
  const pvSpez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  let pvH = null;
  let pauschMwh = 0;

  if (window.elPvH) {
    pvH = new Float32Array(window.elPvH); // Kopie, damit Gebäude-PV sicher addierbar
    for (let t = 0; t < 8760; t++) pauschMwh += pvH[t]; pauschMwh /= 1000;
  } else {
    const kwp = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
    if (kwp > 0) {
      const profile = makePvProfile8760();
      pvH = new Float32Array(8760);
      for (let t = 0; t < 8760; t++) pvH[t] = profile[t] * kwp * pvSpez;
      pauschMwh = kwp * pvSpez / 1000;
    }
  }

  // Gebäude-PV
  const gebaeudeKwp = gebaeude.reduce((s, g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0);
  let gebPvMwh = 0;
  if (gebaeudeKwp > 0) {
    const profile = makePvProfile8760();
    if (!pvH) pvH = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) pvH[t] += profile[t] * gebaeudeKwp * pvSpez;
    gebPvMwh = gebaeudeKwp * pvSpez / 1000;
  }

  // Freiflächen-PV
  const ffKwp = freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);
  let ffPvMwh = 0;
  if (ffKwp > 0) {
    const profile = makePvProfile8760();
    if (!pvH) pvH = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) pvH[t] += profile[t] * ffKwp * pvSpez;
    ffPvMwh = ffKwp * pvSpez / 1000;
  }

  let pvMwh = pauschMwh + gebPvMwh + ffPvMwh;
  window._stromPvH = pvH; // für Fluss-Chart

  // BHKW-Stromerzeugung (aus Dispatch)
  const bhkwElHourly = window._bhkwElHourly;
  let bhkwMwh = 0;
  if (bhkwElHourly) {
    for (let t = 0; t < 8760; t++) bhkwMwh += bhkwElHourly[t];
    bhkwMwh /= 1000;
  } else {
    bhkwMwh = (window._dispatchEnergy?.bhkw?.elMwh) || 0;
  }

  // Batterieparameter (null = kein Speicher)
  const bat = getBatParams(); // { kapKwh, leistKw, eta } oder null

  // Stündliche Bilanz für Eigenverbrauch / Netzbezug / Einspeisung
  // Getrennt nach PV und BHKW für differenzierte Vergütung
  let eigenverbrauchMwh = 0, netzbezugMwh = 0, einspeisungMwh = 0;
  let pvEigenMwh = 0, pvEinspMwh = 0, bhkwEigenMwh = 0, bhkwEinspMwh = 0;
  let batLadeVerlustMwh = 0;
  // Aufschlüsselung Strom-Quellen pro Verbraucher (für Sankey)
  let pvToWp = 0, pvToSk = 0, pvToQuartier = 0;
  let bhkwToWp = 0, bhkwToSk = 0, bhkwToQuartier = 0;
  let netzToWp = 0, netzToSk = 0, netzToQuartier = 0;

  const gesamtMwh = wpMwh + skMwh + quartierMwh;
  const batSocArr = bat ? new Float32Array(8760) : null;
  if (pvH || bat || bhkwMwh > 0) {
    let soc = 0; // Batterieladezustand [kWh]
    for (let t = 0; t < 8760; t++) {
      // Nachfrage: WP + Stromkessel + Quartier
      let demand = (window._wpElHourly ? window._wpElHourly[t] : 0);
      demand += (window._skElHourly ? window._skElHourly[t] : (skMwh * 1000 / 8760));
      const qArr = window.elQuartierH || window._elQuartierFromGeb;
      demand += (qArr ? qArr[t] : (quartierMwh * 1000 / 8760));
      // Lokale Erzeugung: PV + BHKW (getrennt)
      const pvGen   = pvH ? pvH[t] : 0;
      const bhkwGen = bhkwElHourly ? bhkwElHourly[t] : (bhkwMwh > 0 ? bhkwMwh * 1000 / 8760 : 0);
      const gen = pvGen + bhkwGen;

      // 1. Direkter Eigenverbrauch — proportional nach Erzeugungsanteil PV/BHKW aufteilen
      const dsc  = Math.min(gen, demand);
      const pvFrac = gen > 0 ? pvGen / gen : 0;
      let rDem   = demand - dsc;  // verbleibende Nachfrage
      let rGen   = gen   - dsc;  // verbleibender Überschuss

      if (bat) {
        const kapKwh  = bat.kapKwh;
        const leistKw = bat.leistKw;
        const eta     = bat.eta;
        // 2. Laden: Überschuss → Batterie (begrenzt auf Leistung + freie Kapazität, mit Ladeverlusten)
        if (rGen > 0) {
          const c = Math.min(rGen, leistKw, (kapKwh - soc) / eta);
          soc  += c * eta;
          batLadeVerlustMwh += (c - c * eta) / 1000;
          rGen -= c;
        }
        // 3. Entladen: Batterie deckt Restbedarf (begrenzt auf Leistung + Ladezustand × η)
        if (rDem > 0) {
          const avail  = Math.min(soc * eta, rDem, leistKw * eta);
          soc  -= avail / eta;
          batLadeVerlustMwh += (avail / eta - avail) / 1000;
          rDem -= avail;
        }
      }

      // 4. PV-Überschuss nach Batterie → WP → thermischer Speicher
      const tss = window._thermSpeicherState;
      if (rGen > 0.1 && tss && tss.params && tss.socH) {
        const tsCap = tss.params.kapKwh;
        const curFree = Math.max(0, tsCap - tss.socH[t]);
        if (curFree > 0.1) {
          const wpList = tss.wpReservesH?.[t] || [];
          let restLade = Math.min(curFree, tss.params.entladeKw);
          let wpUsed = false;
          // Alle WPs nach COP absteigend (bereits sortiert), PV-Strom → WP → Speicher
          for (const wp of wpList) {
            if (rGen <= 0.1 || restLade <= 0.1 || wp.reserveKw <= 0.1 || wp.cop <= 0) break;
            const maxElKw = wp.reserveKw / wp.cop;
            const elUsed = Math.min(rGen, maxElKw);
            const thLade = Math.min(elUsed * wp.cop, restLade);
            if (thLade > 0.1) {
              const elActual = thLade / wp.cop;
              tss.socH[t] = Math.min(tsCap, tss.socH[t] + thLade);
              tss.ladeH[t] += thLade;
              tss.geladenGes += thLade;
              restLade -= thLade;
              rGen -= elActual;
              eigenverbrauchMwh += elActual / 1000;
              wpUsed = true;
            }
          }
          // Fallback: Stromkessel → Speicher (nur ohne WP)
          if (!wpUsed && rGen > 0.1 && restLade > 0.1) {
            const hatWP = ['lwwp','fg','geo'].some(k => (window._dispatchEnergy||{})[k]?.waermeMwh > 0);
            if (!hatWP && (window._dispatchEnergy||{})['stromkessel']) {
              const skFree = Math.max(0, tsCap - tss.socH[t]);
              const skLoad = Math.min(rGen, skFree, tss.params.entladeKw);
              if (skLoad > 0.1) {
                tss.socH[t] = Math.min(tsCap, tss.socH[t] + skLoad);
                tss.ladeH[t] += skLoad;
                tss.geladenGes += skLoad;
                rGen -= skLoad;
                eigenverbrauchMwh += skLoad / 1000;
              }
            }
          }
        }
      }

      const evThisH = (dsc + (demand - dsc - rDem)) / 1000; // Gesamt-EV direkt + Batterie
      eigenverbrauchMwh += evThisH;
      einspeisungMwh    += rGen / 1000;
      netzbezugMwh      += rDem / 1000;
      // Aufschlüsselung PV vs BHKW (proportional)
      pvEigenMwh   += evThisH * pvFrac;
      bhkwEigenMwh += evThisH * (1 - pvFrac);
      pvEinspMwh   += (rGen / 1000) * pvFrac;
      bhkwEinspMwh += (rGen / 1000) * (1 - pvFrac);
      // Aufschlüsselung: Wieviel Eigen-/Netzstrom geht an WP, SK, Quartier
      const wpD  = (window._wpElHourly ? window._wpElHourly[t] : 0);
      const skD  = (window._skElHourly ? window._skElHourly[t] : (skMwh * 1000 / 8760));
      const qD   = (qArr ? qArr[t] : (quartierMwh * 1000 / 8760));
      const evKw = demand - rDem; // gedeckt durch Eigen (PV+BHKW+Bat)
      const evFrac = demand > 0 ? evKw / demand : 0;
      pvToWp       += wpD * evFrac * pvFrac / 1000;
      pvToSk       += skD * evFrac * pvFrac / 1000;
      pvToQuartier += qD  * evFrac * pvFrac / 1000;
      bhkwToWp       += wpD * evFrac * (1 - pvFrac) / 1000;
      bhkwToSk       += skD * evFrac * (1 - pvFrac) / 1000;
      bhkwToQuartier += qD  * evFrac * (1 - pvFrac) / 1000;
      netzToWp       += wpD * (1 - evFrac) / 1000;
      netzToSk       += skD * (1 - evFrac) / 1000;
      netzToQuartier += qD  * (1 - evFrac) / 1000;
      if (batSocArr) batSocArr[t] = soc;
    }
  } else {
    // Weder PV noch Batterie — Vollbezug aus Netz
    netzbezugMwh      = gesamtMwh;
    eigenverbrauchMwh = 0;
    einspeisungMwh    = 0;
  }

  // Nur-Batterie ohne PV: Batterie allein verschiebt Last, spart kaum (Netz→Bat→Netz mit Verlust)
  // → wird korrekt durch die Simulation abgebildet (rDem bleibt unverändert wenn kein PV-Überschuss)

  // Quoten
  const eigenverbrauchQuote = pvMwh > 0 ? eigenverbrauchMwh / pvMwh * 100 : 0;
  const autarkieQuote = gesamtMwh > 0 ? (1 - netzbezugMwh / gesamtMwh) * 100 : 0;
  const wpAnteil = gesamtMwh > 0 ? (wpMwh / gesamtMwh * 100) : 0;

  // Stromkosten — differenziert nach PV und BHKW
  const preisB  = (parseFloat(document.getElementById('strom-preis-bezug')?.value) || 30) / 100;  // €/kWh
  const pvPreisE  = (parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8)  / 100;  // €/kWh PV-Einspeisung
  const bhkwPreisE = (parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8)  / 100;  // €/kWh BHKW-Einspeisung
  const bhkwKwkE   = (parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8)  / 100;  // €/kWh KWK-Zuschlag Einsp.
  const bhkwKwkEig = (parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4)  / 100;  // €/kWh KWK-Zuschlag Eigen.
  const preisLP = parseFloat(document.getElementById('strom-leistungspreis')?.value) || 0;         // €/kW/Mon
  const bezugskosten     = netzbezugMwh * 1000 * preisB;                  // €/a
  // PV-Erlöse: Einspeisung × Vergütungssatz
  const pvEinspeisungserloes = pvEinspMwh * 1000 * pvPreisE;              // €/a
  // PV-Eigenverbrauch: vermiedene Bezugskosten (= Bezugspreis)
  const pvEigenverbrauchErloes = pvEigenMwh * 1000 * preisB;              // €/a
  // BHKW-Erlöse: Einspeisung × Baseload + KWK-Zuschlag
  const bhkwEinspeisungserloes = bhkwEinspMwh * 1000 * (bhkwPreisE + bhkwKwkE);  // €/a
  // BHKW-Eigenverbrauch: vermiedene Bezugskosten + KWK-Zuschlag
  const bhkwEigenverbrauchErloes = bhkwEigenMwh * 1000 * (preisB + bhkwKwkEig);  // €/a
  // Gesamt-Erlös für Kompatibilität
  const einspeisungserloes = pvEinspeisungserloes + bhkwEinspeisungserloes;  // €/a
  // Globale Referenz für BHKW-Wirtschaftlichkeit
  window._bhkwStromErloes = bhkwEinspeisungserloes + bhkwEigenverbrauchErloes;
  window._pvStromErloes = pvEinspeisungserloes + pvEigenverbrauchErloes;
  window._stromBilanz = { pvEigenMwh, pvEinspMwh, bhkwEigenMwh, bhkwEinspMwh,
    pvToWp, pvToSk, pvToQuartier, bhkwToWp, bhkwToSk, bhkwToQuartier,
    netzToWp, netzToSk, netzToQuartier };
  // CO₂-Bilanz Strom (inkl. optionaler PV-Einspeisung-Gutschrift)
  const vEmF = calcVerdraengungEmF();
  const pvCo2GutschriftT = pvCo2Gutschrift && einspeisungMwh > 0 ? einspeisungMwh * vEmF / 1e3 : 0; // t CO₂/a — Einspeisung verdrängt Marginalstrom
  const pvEigenverbrauchCo2T = eigenverbrauchMwh * stromEmF / 1e3; // t CO₂/a — Eigenverbrauch vermeidet Netzbezug (Durchschnitt)
  const pvCo2GesT = pvCo2GutschriftT + pvEigenverbrauchCo2T; // t CO₂/a Gesamtvermeidung PV
  // Leistungspreis: monatliche Spitzenlast des Netzbezugs × €/kW/Mon × 12
  let leistungskosten = 0;
  if (preisLP > 0 && (pvH || bhkwMwh > 0 || bat)) {
    // Stündlichen Netzbezug berechnen — analog zur Bilanzschleife oben, aber nur Peak
    let socLP = 0;
    const monthPeak = new Array(12).fill(0);
    for (let t = 0; t < 8760; t++) {
      let demand = (window._wpElHourly ? window._wpElHourly[t] : 0);
      demand += (window._skElHourly ? window._skElHourly[t] : (skMwh * 1000 / 8760));
      const qArr2 = window.elQuartierH || window._elQuartierFromGeb;
      demand += (qArr2 ? qArr2[t] : (quartierMwh * 1000 / 8760));
      const pvGen   = pvH ? pvH[t] : 0;
      const bhkwGen = bhkwElHourly ? bhkwElHourly[t] : (bhkwMwh * 1000 / 8760);
      const gen = pvGen + bhkwGen;
      const dsc  = Math.min(gen, demand);
      let rDem   = demand - dsc;
      let rGen   = gen   - dsc;
      if (bat) {
        const { kapKwh, leistKw, eta } = bat;
        if (rGen > 0) { const c = Math.min(rGen, leistKw, kapKwh - socLP); socLP += c; }
        if (rDem > 0) { const avail = Math.min(socLP * eta, rDem, leistKw * eta); socLP -= avail / eta; rDem -= avail; }
      }
      const m = t < GL_MONTH_START[1] ? 0 : t < GL_MONTH_START[2] ? 1 : t < GL_MONTH_START[3] ? 2 :
                t < GL_MONTH_START[4] ? 3 : t < GL_MONTH_START[5] ? 4 : t < GL_MONTH_START[6] ? 5 :
                t < GL_MONTH_START[7] ? 6 : t < GL_MONTH_START[8] ? 7 : t < GL_MONTH_START[9] ? 8 :
                t < GL_MONTH_START[10] ? 9 : t < GL_MONTH_START[11] ? 10 : 11;
      if (rDem > monthPeak[m]) monthPeak[m] = rDem;
    }
    leistungskosten = monthPeak.reduce((s, p) => s + p, 0) * preisLP; // €/a
  } else if (preisLP > 0 && gesamtMwh > 0) {
    // Ohne Erzeugung: Spitzenlast schätzen aus Gesamtbedarf (grob 3× Durchschnittslast)
    const avgKw = gesamtMwh * 1000 / 8760;
    leistungskosten = avgKw * 3 * preisLP * 12;
  }
  const bhkwGesamtErloes = bhkwEinspeisungserloes + bhkwEigenverbrauchErloes;
  const stromkostenJahr  = bezugskosten + leistungskosten - einspeisungserloes - bhkwGesamtErloes;  // €/a Netto

  // Strombedarf proportional zur Fläche auf Gebäude verteilen
  const gesamtFlaeche = gebaeude.reduce((s, g) => s + (parseFloat(g.flaeche) || 0), 0);
  gebaeude.forEach(g => {
    const fl = parseFloat(g.flaeche) || 0;
    g.elMwh = (quartierMwh > 0 && gesamtFlaeche > 0) ? quartierMwh * fl / gesamtFlaeche : 0;
  });
  if (currentMode === 'strom') { updateNetzStrandVisibility(); updateViz(); }

  // Kennzahlen-Box
  const kpiWrap = document.getElementById('strom-kpis');
  if (kpiWrap) {
    const fmt = v => Number(Math.round(v)).toLocaleString('de-DE');
    const fmtK = v => (v >= 1000 ? (v/1000).toFixed(0) + ' T' : Math.round(v).toString());
    const kpi = (label, val, unit, color) => `
      <div style="background:var(--surface2);border-radius:5px;padding:7px 10px;">
        <div style="font-size:9px;color:var(--muted);margin-bottom:3px;">${label}</div>
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:${color||'var(--text)'}">
          ${val}&thinsp;<span style="font-size:9px;color:var(--muted);">${unit}</span>
        </div>
      </div>`;
    const hasPvOrBat = pvMwh > 0 || bat;
    kpiWrap.innerHTML =
      kpi('Gesamt-Strombedarf', gesamtMwh > 0 ? fmt(gesamtMwh) : '—', 'MWh/a', 'var(--text)') +
      kpi('davon WP-Anteil', gesamtMwh > 0 ? wpAnteil.toFixed(1) : '—', '%', '#ffd54f') +
      (gebPvMwh > 0 ? kpi('Gebäude-PV', `${gebaeudeKwp.toFixed(0)} kWp · ${fmt(gebPvMwh)} MWh/a`, '', '#ffd54f') : '') +
      (ffPvMwh > 0 ? kpi('Freiflächen-PV', `${ffKwp.toFixed(0)} kWp · ${fmt(ffPvMwh)} MWh/a`, '', '#ffd54f') : '') +
      (pvMwh > 0 ? kpi('PV-Erzeugung', fmt(pvMwh), 'MWh/a', '#66bb6a') : '') +
      (bhkwMwh > 0 ? kpi('BHKW-Strom', fmt(bhkwMwh), 'MWh/a', '#ff8f00') : '') +
      (bat ? kpi('Speicher', `${fmt(bat.kapKwh)} kWh / ${fmt(bat.leistKw)} kW`, '', '#80deea') : '') +
      (hasPvOrBat ? kpi('Eigenverbrauch', `${fmt(eigenverbrauchMwh)} (${eigenverbrauchQuote.toFixed(0)}%)`, 'MWh/a', '#a5d6a7') : '') +
      kpi('Netzbezug', gesamtMwh > 0 ? fmt(netzbezugMwh) : '—', 'MWh/a', '#90a4ae') +
      (pvMwh > 0 ? kpi('Einspeisung', fmt(einspeisungMwh), 'MWh/a', '#81c784') : '') +
      (hasPvOrBat ? kpi('Strom-Autarkie', autarkieQuote.toFixed(1), '%', '#4fc3f7') : '') +
      kpi('Bezugskosten', bezugskosten > 0 ? fmtK(bezugskosten) : '—', '€/a', '#ef9a9a') +
      (leistungskosten > 0 ? kpi('Leistungskosten', fmtK(leistungskosten), '€/a', '#ef9a9a') : '') +
      (pvEinspeisungserloes > 0 ? kpi('PV-Einspeisung', fmtK(pvEinspeisungserloes), '€/a', '#a5d6a7') : '') +
      (bhkwEinspeisungserloes + bhkwEigenverbrauchErloes > 0 ? kpi('BHKW-Stromerlös', fmtK(bhkwEinspeisungserloes + bhkwEigenverbrauchErloes), '€/a (inkl. KWK)', '#ff8f00') : '') +
      (pvCo2GesT > 0.1 ? kpi('CO₂-Vermeidung PV', pvCo2GesT.toFixed(1) + (pvCo2GutschriftT > 0 ? ` (davon ${pvCo2GutschriftT.toFixed(1)} t Einsp.)` : ''), 't/a', '#a5d6a7') : '') +
      kpi('Netto-Stromkosten', gesamtMwh > 0 ? fmtK(stromkostenJahr) : '—', '€/a', stromkostenJahr < 0 ? '#66bb6a' : 'var(--text)');
  }

  // PV-Wirtschaftlichkeit (einfache Payback-Rechnung)
  const pvWirtDiv = document.getElementById('strom-pv-wirt');
  if (pvWirtDiv) {
    const totalKwp = (parseFloat(document.getElementById('pv-kwp')?.value) || 0) + gebaeudeKwp + ffKwp;
    const pvInvest = parseFloat(document.getElementById('opt-pv-invest')?.value) || 1200; // €/kWp
    const pvLife   = parseFloat(document.getElementById('opt-pv-life')?.value) || 20;
    const zinssatz = (parseFloat(document.getElementById('opt-zinssatz')?.value) || 4) / 100;
    const omPct    = (parseFloat(document.getElementById('opt-om')?.value) || 1) / 100;
    if (totalKwp > 0 && pvMwh > 0) {
      const annF = (z, n) => z > 0 ? z * Math.pow(1+z,n) / (Math.pow(1+z,n)-1) : 1/n;
      const gesamtInvest   = totalKwp * pvInvest;
      const annuitaet      = gesamtInvest * (annF(zinssatz, pvLife) + omPct);
      // Jährlicher PV-Erlös: Einspeisungserlös + Eigenverbrauchsersparnis (nur PV-Anteil)
      const pvEigenErsp  = pvEigenMwh * 1000 * preisB;
      const erloesSumme  = pvEinspeisungserloes + pvEigenErsp;
      const payback      = erloesSumme > 0 ? gesamtInvest / erloesSumme : Infinity;
      const wgk          = pvMwh > 0 ? (annuitaet - erloesSumme) / pvMwh : 0; // €/MWh_el
      const fmtE = v => Number(Math.round(v)).toLocaleString('de-DE');
      pvWirtDiv.style.display = '';
      pvWirtDiv.innerHTML =
        `<div style="font-weight:600;color:var(--text);margin-bottom:5px;font-size:10px;">PV-Wirtschaftlichkeit (${totalKwp.toFixed(0)} kWp)</div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">` +
          `<div><div style="font-size:8px;color:var(--muted);">Investition</div><div style="font-family:'DM Mono',monospace;color:var(--text);font-size:11px;">${fmtE(gesamtInvest)} €</div></div>` +
          `<div><div style="font-size:8px;color:var(--muted);">Erlös/a</div><div style="font-family:'DM Mono',monospace;color:#a5d6a7;font-size:11px;">${fmtE(erloesSumme)} €</div></div>` +
          `<div><div style="font-size:8px;color:var(--muted);">Amortisation</div><div style="font-family:'DM Mono',monospace;color:${payback <= pvLife ? '#66bb6a' : '#ef9a9a'};font-size:11px;">${payback < Infinity ? payback.toFixed(1) + ' a' : '> ' + pvLife + ' a'}</div></div>` +
        `</div>` +
        `<div style="margin-top:4px;font-size:8px;color:var(--muted);">` +
          `PV-Eigenverbrauch ${fmtE(pvEigenErsp)} €/a · PV-Einspeisung ${fmtE(pvEinspeisungserloes)} €/a · ` +
          `Invest-Basis: ${pvInvest} €/kWp, ${pvLife} a, ${(zinssatz*100).toFixed(1)}% p.a.` +
        `</div>`;
    } else {
      pvWirtDiv.style.display = 'none';
    }
  }

  // Monatliche Aggregation
  const monthlyWp       = new Array(12).fill(0);
  const monthlyQuartier = new Array(12).fill(0);
  const monthlyPv       = new Array(12).fill(0);

  if (window._wpElHourly) {
    let m = 0;
    for (let t = 0; t < 8760; t++) {
      if (m < 11 && t >= GL_MONTH_START[m + 1]) m++;
      monthlyWp[m] += window._wpElHourly[t] / 1000;
    }
  } else if (wpMwh > 0) {
    GL_MONTH_HOURS.forEach((h, m) => { monthlyWp[m] = wpMwh * h / 8760; });
  }

  if (window.elQuartierH) {
    let m = 0;
    for (let t = 0; t < 8760; t++) {
      if (m < 11 && t >= GL_MONTH_START[m + 1]) m++;
      monthlyQuartier[m] += window.elQuartierH[t] / 1000;
    }
  } else if (quartierMwh > 0) {
    GL_MONTH_HOURS.forEach((h, m) => { monthlyQuartier[m] = quartierMwh * h / 8760; });
  }

  if (pvH) {
    let m = 0;
    for (let t = 0; t < 8760; t++) {
      if (m < 11 && t >= GL_MONTH_START[m + 1]) m++;
      monthlyPv[m] += pvH[t] / 1000;
    }
  }

  _stromRenderMonatsChart(monthlyQuartier, monthlyWp, monthlyPv);
  window._stromBatSocH = batSocArr;
  _stromRenderFlussChart(window._stromFlussWeek || 0);

  // Sankey-Daten setzen (für drawSankeyStrom)
  window._sankeyData = {
    pvMwh, netzbezugMwh, einspeisungMwh, eigenverbrauchMwh,
    wpMwh, skMwh, quartierMwh, bhkwStromMwh: bhkwMwh,
    pvEigenMwh, pvEinspMwh, bhkwEigenMwh, bhkwEinspMwh
  };
  if (_stromCurrentTab === 'sankey')   drawSankeyStrom();
  if (_stromCurrentTab === 'lastgang') _stromRenderLastgang();
}
