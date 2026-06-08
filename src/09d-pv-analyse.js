// ── 09d-pv-analyse.js — PV-Analyse: Varianten, NAP, Batterieoptimierung, Infrastruktur ──
// Eigenständiges Modul — kein Eingriff in bestehende 09a–09c, 10a–10d.
// Nutzt window.elQuartierH15 (15-min nativ) wenn vorhanden, sonst window.elQuartierH (8760h).

import { freiflaechen, gebaeude } from './01-globals-varianten.js';
import { calcFFKwp } from './03a-erzeuger.js';
import { calcGebKwp } from './03c-gebaeude-io.js';
import { CalcEngine } from './08-calc-engine.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { OPT_INVEST_DEFAULT, OPT_IH, OPT_NUTZUNG } from './config/optimizer-defaults.js';
import { ASSETS } from './13a-assets-core.js';

// ══════════════════════════════════════════════════════════════════════════════
// KONSTANTEN
// ══════════════════════════════════════════════════════════════════════════════

// Infrastruktur-Kostenstufen (konfigurierbar, Defaults basierend auf DE-Markt 2024)
export const PV_INFRA_STUFEN = [
  { id: 'xs', label: '< 30 kWp', bisKwp: 30, items: [
    { id: 'anschluss', label: 'Netzanmeldung / Anschluss', investEUR: 500, aktiv: true },
  ]},
  { id: 's', label: '30–100 kWp', bisKwp: 100, items: [
    { id: 'nvp',      label: 'Netzverträglichkeitsprüfung', investEUR: 1500, aktiv: true },
    { id: 'anschluss',label: 'Netzanschluss pauschal',       investEUR: 2000, aktiv: true },
    { id: 'schutz',   label: 'NA-Schutz / Entkupplungsschutz', investEUR: 1000, aktiv: true },
  ]},
  { id: 'm', label: '100–500 kWp (EZA)', bisKwp: 500, items: [
    { id: 'eza',       label: 'EZA-Regler inkl. Fernwirk',  investEUR: 8000,  aktiv: true },
    { id: 'anschluss', label: 'Netzanschluss + Prüfung',    investEUR: 4000,  aktiv: true },
    { id: 'dv_fee',    label: 'Direktvermarktung (0,3 ct/kWh)', investEUR: 0, aktiv: true, perKwh: 0.003 },
  ]},
  { id: 'l', label: '500–2.000 kWp (MS-Anschluss)', bisKwp: 2000, items: [
    { id: 'eza',       label: 'EZA-Regler',                  investEUR: 12000, aktiv: true },
    { id: 'trafo',     label: 'Trafo NS/MS (630 kVA)',        investEUR: 45000, aktiv: true },
    { id: 'kabel_ms',  label: 'MS-Kabeltrasse (100 m)',       investEUR: 40000, aktiv: true },
    { id: 'dv_fee',    label: 'Direktvermarktung (0,3 ct/kWh)', investEUR: 0,  aktiv: true, perKwh: 0.003 },
  ]},
  { id: 'xl', label: '> 2.000 kWp (Übergabestation)', bisKwp: Infinity, items: [
    { id: 'eza',  label: 'EZA-Regler / Leitwarte',    investEUR: 18000,  aktiv: true },
    { id: 'ues',  label: 'Übergabestation (komplett)', investEUR: 150000, aktiv: true },
    { id: 'dv_fee', label: 'Direktvermarktung (0,3 ct/kWh)', investEUR: 0, aktiv: true, perKwh: 0.003 },
  ]},
];

// Varianten-Definitionen (auto-berechnet)
const PV_VARIANTEN_AUTO = [
  { id: 'minimal',        label: 'Minimal',             farbe: '#78909c', icon: '▽', batStrategie: 'none'  },
  { id: 'ev-opt',         label: 'EV-Optimiert',        farbe: '#42a5f5', icon: '⊙', batStrategie: 'ev'    },
  { id: 'max-pv',         label: 'Max PV',              farbe: '#fdd835', icon: '△', batStrategie: 'none'  },
  { id: 'max-pv-bat-ev',  label: 'Max PV + Bat (EV)',   farbe: '#66bb6a', icon: '▲', batStrategie: 'ev'    },
  { id: 'max-pv-bat-spot',label: 'Max PV + Bat (Spot)', farbe: '#ab47bc', icon: '★', batStrategie: 'spot'  },
];

// ══════════════════════════════════════════════════════════════════════════════
// MODUL-STATE
// ══════════════════════════════════════════════════════════════════════════════
window._pvAnalyse = window._pvAnalyse || {
  infraKonfig: null,          // überschriebene Infra-Kosten (null = Defaults)
  mehrkosten: { investEUR: 0, label: '', jaehrlichEUR: 0 }, // Mehrkostenprinzip
  erzNetzAktiv: false,
  erzNetz: { laengeM: 0, preisPrM: 250, typKabel: 'NS', schutzEUR: 5000 },
  customVarianten: [],        // { id, label, pvKwp, batKwh }
  spotPreise: null,           // Float32Array[N] in ct/kWh (null = nicht geladen)
  spotJahr: null,
  spotStatus: 'nicht geladen',
  napMaxEinspKw: 0,           // 0 = unbegrenzt
  napMaxBezugKw: 0,           // 0 = unbegrenzt
  pvMaxKwpOverride: 0,        // 0 = aus Assets berechnen
  ergebnisse: [],             // berechnete Varianten-Ergebnisse
  berechnet: false,
};

// ══════════════════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN
// ══════════════════════════════════════════════════════════════════════════════

function annF(z, n) {
  if (!z || z <= 0) return n > 0 ? 1 / n : 1;
  return z * Math.pow(1 + z, n) / (Math.pow(1 + z, n) - 1);
}

/** Gibt den nativen Lastgang zurück: 15-min wenn verfügbar, sonst stündlich */
function pvGetDemandH() {
  return window.elQuartierH15 || window.elQuartierH || null;
}

/** Länge des Lastgangs */
function pvGetN() {
  const d = pvGetDemandH();
  return d ? d.length : 8760;
}

/** Zeitschritt in Stunden — robust gegen Schaltjahre (35.136 / 8.784 Werte) */
function pvGetDt() {
  return pvGetN() > 8784 ? 0.25 : 1.0;
}

/**
 * PV-Profil exakt auf die Länge des Lastgangs gebracht.
 * Stundenbasis: 8.760 Werte → direkt verwenden (Schaltjahrsüberhang = 0).
 * 15-min: jeden Stundenwert in 4 gleiche Slots;
 *         Schaltjahr (35.136) enthält 24 h mehr → letzte 96 Slots bleiben 0.
 */
function pvGetPvProfile() {
  const N = pvGetN();
  const h = makePvProfile8760();          // immer 8.760 Stunden

  if (N <= 8760) return h;

  const m = new Float32Array(N);          // auf exakte Lastgang-Länge
  if (N <= 8784) {
    // Stündlich + Schaltjahr: erste 8.760 Stunden aus Profil, Rest 0
    for (let i = 0; i < 8760; i++) m[i] = h[i];
  } else {
    // 15-min (Normal- oder Schaltjahr): 8.760 × 4 = 35.040 Slots belegen
    for (let i = 0; i < 8760; i++) {
      m[i*4] = m[i*4+1] = m[i*4+2] = m[i*4+3] = h[i];
    }
    // Slots 35.040–35.135 bei Schaltjahr bleiben 0 (kein Ertrag letzter Tag)
  }
  return m;
}

/** Maximale PV-Leistung aus allen Quellen (kWp):
 *  Elektro-PV-Assets (13a) + Gebäude-PV + Freiflächen-PV + Strom-Panel-Eingabe */
function pvGetMaxKwpFromAssets() {
  if (window._pvAnalyse.pvMaxKwpOverride > 0) return window._pvAnalyse.pvMaxKwpOverride;

  // 1. Elektro-Assets vom Typ 'PV' (ASSETS.items aus 13a-assets-core.js)
  const assetKwp = (ASSETS?.items || [])
    .filter(a => a.type === 'PV')
    .reduce((s, a) => s + (parseFloat(a.props?.leistungKWp) || 0), 0);

  // 2. Gebäude-integrierte PV (Wärme-Modul)
  const gebKwp = gebaeude.reduce((s, g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0);

  // 3. Freiflächen-PV (Wärme-Modul)
  const ffKwp = freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);

  // 4. Manuelle Eingabe im Strom-Panel
  const manual = parseFloat(document.getElementById('pv-kwp')?.value) || 0;

  return assetKwp + gebKwp + ffKwp + manual;
}

/** Aufschlüsselung der PV-Quellen für die Anzeige */
function pvGetAssetBreakdown() {
  const assetKwp = (ASSETS?.items || [])
    .filter(a => a.type === 'PV')
    .reduce((s, a) => s + (parseFloat(a.props?.leistungKWp) || 0), 0);
  const gebKwp   = gebaeude.reduce((s, g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0);
  const ffKwp    = freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);
  const manual   = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
  const assetN   = (ASSETS?.items || []).filter(a => a.type === 'PV').length;
  return { assetKwp, assetN, gebKwp, ffKwp, manual };
}

/** Spezifischer Ertrag (kWh/kWp/a) */
function pvGetSpez() {
  return parseFloat(document.getElementById('pv-spez')?.value) || 1000;
}

// ══════════════════════════════════════════════════════════════════════════════
// INFRASTRUKTUR-KOSTEN
// ══════════════════════════════════════════════════════════════════════════════

function pvInfraStufeFuer(kwp) {
  return PV_INFRA_STUFEN.find(s => kwp <= s.bisKwp) || PV_INFRA_STUFEN[PV_INFRA_STUFEN.length - 1];
}

/**
 * Gesamte Infrastrukturkosten für eine PV-Leistung.
 * Berücksichtigt: Stufenkosten, optionales Erzeugungsnetz, Mehrkostenprinzip.
 * @param {number} pvKwp
 * @param {number} pvErtragMwh - Jahresertrag für prozentuale Gebühren (DV-Fee etc.)
 * @returns {{ investEUR: number, jaehrlichEUR: number, stufeLabel: string, detail: string[] }}
 */
function pvInfraKosten(pvKwp, pvErtragMwh) {
  const stufe = pvInfraStufeFuer(pvKwp);
  const konfig = window._pvAnalyse.infraKonfig;
  const items = konfig?.[stufe.id] ?? stufe.items;

  let investEUR = 0, jaehrlichEUR = 0;
  const detail = [];

  for (const item of items) {
    if (!item.aktiv) continue;
    investEUR += item.investEUR || 0;
    if (item.perKwh) jaehrlichEUR += item.perKwh * pvErtragMwh * 10; // ct/kWh → €
    if ((item.investEUR || 0) > 0 || item.perKwh) {
      detail.push(item.label);
    }
  }

  // Erzeugungsnetz (optional)
  if (window._pvAnalyse.erzNetzAktiv) {
    const en = window._pvAnalyse.erzNetz;
    const kabelKosten = (en.laengeM || 0) * (en.preisPrM || 250);
    investEUR += kabelKosten + (en.schutzEUR || 5000);
    detail.push(`Erzeugungsnetz ${en.laengeM} m`);
  }

  // Mehrkostenprinzip (anteilige Kosten geteilter Infrastruktur)
  investEUR    += window._pvAnalyse.mehrkosten.investEUR  || 0;
  jaehrlichEUR += window._pvAnalyse.mehrkosten.jaehrlichEUR || 0;
  if (window._pvAnalyse.mehrkosten.investEUR > 0) detail.push('Mehrkosten: ' + window._pvAnalyse.mehrkosten.label);

  return { investEUR, jaehrlichEUR, stufeLabel: stufe.label, detail };
}

// ══════════════════════════════════════════════════════════════════════════════
// KERN-SIMULATION (NAP-aware, dt-generic)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Stündliche / 15-min PV-NAP-Simulation mit Batterie und optionaler Spot-Strategie.
 *
 * @param {number} pvKwp
 * @param {number} batKwh
 * @param {Float32Array} demandH   - Nachfrage-Profil in kW
 * @param {Float32Array} pvProfile - normiertes PV-Profil (kW / (kWp * kWh/kWp/a))
 * @param {object} napParams       - { maxEinspeisKw, maxBezugKw }
 * @param {string} batStrategie    - 'ev' | 'spot' | 'none'
 * @param {Float32Array|null} spotH - Spot-Preise ct/kWh (nur für 'spot')
 * @returns {object}
 */
function pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, batStrategie, spotH) {
  const N    = demandH.length;
  const dt   = N > 8784 ? 0.25 : 1.0;   // Schaltjahr (35.136) und Normaljahr (35.040)
  const spez = pvGetSpez();
  const maxEinsp  = (napParams.maxEinspeisKw  > 0) ? napParams.maxEinspeisKw  : Infinity;
  const maxBezug  = (napParams.maxBezugKw     > 0) ? napParams.maxBezugKw     : Infinity;
  const ETA       = 0.90;
  const batLeistKw = batKwh > 0 ? batKwh / 2 : 0; // C/2-Rate

  // Spot: Tagesdurchschnitt als Schwelle (nur wenn Spot-Strategie aktiv)
  let avgSpot = 0;
  if (batStrategie === 'spot' && spotH) {
    let sSum = 0;
    for (let t = 0; t < Math.min(N, spotH.length); t++) sSum += spotH[t];
    avgSpot = sSum / N;
  }

  let soc = 0;
  let eigenMwh = 0, einspeiseMwh = 0, netzbezugMwh = 0, curtailMwh = 0;
  let batVerlustMwh = 0, spotRevenue = 0;  // spotRevenue in € (ct/kWh × MWh / 10)
  const batSocArr = new Float32Array(N);

  for (let t = 0; t < N; t++) {
    const dem    = demandH[t];
    const pvGen  = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const spot   = (spotH && t < spotH.length) ? spotH[t] : avgSpot;

    // 1. Direkter Eigenverbrauch
    const dsc = Math.min(pvGen, dem);
    let rDem  = dem  - dsc;
    let rGen  = pvGen - dsc;

    // 2. Einspeisebegrenzung: Überschuss über NAP-Limit muss in Batterie
    if (rGen > maxEinsp && batKwh > 0) {
      const mustStore = rGen - maxEinsp;
      const cPow = Math.min(mustStore, batLeistKw);
      const cEkwh = Math.min(cPow * dt, (batKwh - soc) / ETA);
      soc += cEkwh * ETA; batVerlustMwh += cEkwh * (1 - ETA);
      rGen -= cEkwh / dt;
    }
    // Abregelung: was weiterhin über Limit → Curtailment
    if (rGen > maxEinsp) {
      curtailMwh += (rGen - maxEinsp) * dt / 1000;
      rGen = maxEinsp;
    }

    // 3. Batterie laden (restlicher Überschuss) — Strategie
    if (rGen > 0 && batKwh > 0) {
      let doCharge = false;
      if      (batStrategie === 'ev')   doCharge = true;
      else if (batStrategie === 'spot') doCharge = (spot <= avgSpot * 1.1); // laden wenn Preis niedrig
      if (doCharge) {
        const cPow  = Math.min(rGen, batLeistKw);
        const cEkwh = Math.min(cPow * dt, (batKwh - soc) / ETA);
        soc  += cEkwh * ETA; batVerlustMwh += cEkwh * (1 - ETA);
        rGen -= cEkwh / dt;
      }
    }

    // 4. Batterie entladen — Strategie
    if (rDem > 0 && batKwh > 0 && soc > 0) {
      let doDischarge = false;
      if      (batStrategie === 'ev')   doDischarge = true;
      else if (batStrategie === 'spot') doDischarge = (spot >= avgSpot * 0.9); // entladen wenn Preis OK
      if (doDischarge) {
        const dPow  = Math.min(rDem, batLeistKw);
        const dEkwh = Math.min(dPow * dt, soc * ETA);
        soc  -= dEkwh / ETA; batVerlustMwh += (dEkwh / ETA - dEkwh);
        rDem -= dEkwh / dt;
      }
    }

    // 5. Spot-Strategie: Zusatz-Einspeisung aus Batterie wenn Preis hoch
    if (batStrategie === 'spot' && rDem === 0 && soc > 0 && spot > avgSpot * 1.4) {
      const dPow  = Math.min(batLeistKw, maxEinsp - rGen);
      if (dPow > 0) {
        const dEkwh = Math.min(dPow * dt, soc * ETA);
        soc  -= dEkwh / ETA;
        rGen += dEkwh / dt;
      }
    }

    // 6. Netzbezug begrenzen (Überschuss über maxBezug → ungedeckter Bedarf, KPI)
    if (rDem > maxBezug) rDem = maxBezug;

    // Energiebilanz
    const evStep = (dsc + (dem - dsc - rDem));  // kW gedeckt durch Eigen
    eigenMwh     += evStep * dt / 1000;
    einspeiseMwh += rGen   * dt / 1000;
    netzbezugMwh += rDem   * dt / 1000;
    // Spot-gewichteter Einspeisung-Erlös (ct/kWh → €: × dt/1000 × /100)
    if (spotH && t < spotH.length) {
      spotRevenue += rGen * dt / 1000 * spotH[t] / 100;
    }
    batSocArr[t] = soc;
  }

  return { eigenMwh, einspeiseMwh, netzbezugMwh, curtailMwh, batVerlustMwh, batSocArr, spotRevenue };
}

// ══════════════════════════════════════════════════════════════════════════════
// BATTERIE-OPTIMIERUNG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Findet die optimale Batteriegröße per marginaler Amortisation.
 * Bricht ab wenn der marginale Nutzen (Ersparnisse/a) die marginalen Kapitalkosten unterschreitet.
 *
 * @param {number} pvKwp
 * @param {Float32Array} demandH
 * @param {Float32Array} pvProfile
 * @param {object} napParams
 * @param {string} strategie - 'ev' | 'spot'
 * @param {Float32Array|null} spotH
 * @param {object} params - { pStrom, pEinsp, batInvestPerKwh, zins, batLife }
 * @returns {number} optimale batKwh
 */
function pvOptBat(pvKwp, demandH, pvProfile, napParams, strategie, spotH, params) {
  const { pStrom, pEinsp, batInvestPerKwh, zins, batLife } = params;
  const annBat = annF(zins, batLife || 15); // Annuitätenfaktor Batterie

  // Schrittweite: logarithmisch bis 2× PV-kWp, max 10 MWh
  const maxBat = Math.min(pvKwp * 2, 10000);
  const steps  = [0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000]
    .filter(v => v <= maxBat + 1);
  if (!steps.includes(Math.round(maxBat))) steps.push(Math.round(maxBat));

  let prevSim  = pvNapSim(pvKwp, 0, demandH, pvProfile, napParams, 'none', null);
  let prevBat  = 0, prevAnnKost = 0;
  let bestBat  = 0;

  for (let i = 1; i < steps.length; i++) {
    const batKwh = steps[i];
    const sim    = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strategie, spotH);

    // Marginaler Nutzen — strategie-abhängig
    const deltaEigen = (sim.eigenMwh - prevSim.eigenMwh) * pStrom * 10;        // €/a EV-Ersparnis
    const deltaCurt  = (prevSim.curtailMwh - sim.curtailMwh) * pEinsp * 10;    // €/a vermiedene Abregelung
    let marginalNutzen;
    if (strategie === 'spot' && spotH) {
      // Spot: Nutzen = ΔSpot-Erlös (Arbitrage durch Zeitverschiebung) + ΔEigenverbrauch
      const deltaSpot = (sim.spotRevenue - (prevSim.spotRevenue || 0));         // €/a Spot-Arbitrage
      marginalNutzen = deltaSpot + deltaEigen + deltaCurt;
    } else {
      // EV: Nutzen = ΔEigenverbrauch + ΔEinspeisung (flat) + vermiedene Abregelung
      const deltaEinsp = (sim.einspeiseMwh - prevSim.einspeiseMwh) * pEinsp * 10;
      marginalNutzen = deltaEigen + deltaEinsp + deltaCurt;
    }

    // Marginale Kapitalkosten dieser Batteriestufe
    const deltaBatInvest = (batKwh - prevBat) * batInvestPerKwh;
    const deltaAnnKost   = deltaBatInvest * (annBat + (OPT_IH.bat || 0.01));

    // Abbruch wenn Nutzen < Kapitalkosten (marginal nicht mehr rentabel)
    if (marginalNutzen < deltaAnnKost * 0.9) break;

    bestBat  = batKwh;
    prevSim  = sim;
    prevBat  = batKwh;
    prevAnnKost = (batKwh * batInvestPerKwh) * (annBat + (OPT_IH.bat || 0.01));
  }

  return bestBat;
}

/**
 * Eigenverbrauchsoptimierte PV-Größe:
 * Erhöhe PV solange der marginale Eigenverbrauchszuwachs > Schwellwert (ct/kWh).
 */
function pvCalcEvOptKwp(demandH, pvProfile, napParams, params) {
  const { pStrom, pvInvestPerKwp, zins, pvLife } = params;
  const annPv = annF(zins, pvLife || 20);
  const maxKwp = pvGetMaxKwpFromAssets() || 500;

  const steps = [];
  for (let k = 10; k <= maxKwp; k += (k < 100 ? 10 : k < 500 ? 25 : 50)) steps.push(k);
  if (!steps.includes(Math.round(maxKwp))) steps.push(Math.round(maxKwp));

  let prevSim = pvNapSim(0, 0, demandH, pvProfile, napParams, 'none', null);
  let bestKwp = 0;

  for (const kwp of steps) {
    const sim = pvNapSim(kwp, 0, demandH, pvProfile, napParams, 'none', null);
    const delta = kwp - (bestKwp || 0);
    const deltaEigen = (sim.eigenMwh - prevSim.eigenMwh) * pStrom * 10; // €/a
    const deltaErtrag = pvGetSpez() * delta / 1000 * params.pEinsp * 10; // maximale Einspeisung-Option
    const deltaNutzen = deltaEigen + deltaErtrag * 0.3; // Einspeisung nur 30% gewichtet für EV-Opt

    const deltaPvInvest = delta * pvInvestPerKwp;
    const deltaAnnKost  = deltaPvInvest * (annPv + (OPT_IH.pv || 0.01));

    if (delta > 0 && deltaNutzen < deltaAnnKost * 0.8) break;

    bestKwp = kwp;
    prevSim = sim;
  }

  return Math.max(bestKwp, 10);
}

// ══════════════════════════════════════════════════════════════════════════════
// WIRTSCHAFTLICHKEIT
// ══════════════════════════════════════════════════════════════════════════════

function pvWirtschaft(pvKwp, batKwh, simResult, pvErtragMwh, params) {
  const { pStrom, pEinsp, pvInvestPerKwp, batInvestPerKwh, zins, pvLife, batLife } = params;

  const pvInvest  = pvKwp  * pvInvestPerKwp;
  const batInvest = batKwh * batInvestPerKwh;
  const infra     = pvInfraKosten(pvKwp, pvErtragMwh);

  const annPv  = annF(zins, pvLife  || 20);
  const annBat = annF(zins, batLife || 15);

  const pvJk   = pvInvest  * (annPv  + (OPT_IH.pv  || 0.01));
  const batJk  = batInvest * (annBat + (OPT_IH.bat || 0.01));
  const infJk  = infra.investEUR * annF(zins, 20) + infra.jaehrlichEUR;

  const eigenErsparnis   = simResult.eigenMwh    * pStrom * 10; // €/a
  const einspeisErloes   = simResult.einspeiseMwh * pEinsp * 10; // €/a
  const abregelVerlust   = simResult.curtailMwh  * pEinsp * 10;  // €/a entgangener Erlös

  const gesamtErloes = eigenErsparnis + einspeisErloes;
  const gesamtJk     = pvJk + batJk + infJk;
  const nettoJk      = gesamtJk - gesamtErloes;
  const investGes    = pvInvest + batInvest + infra.investEUR;
  const amort        = gesamtErloes > 0 ? investGes / gesamtErloes : Infinity;

  const pvEigenQuote = pvErtragMwh > 0 ? simResult.eigenMwh    / pvErtragMwh * 100 : 0;
  const gesamtBedarf = (() => { const d = pvGetDemandH(); if (!d) return 1; let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s * pvGetDt() / 1000; })();
  const autarkie     = gesamtBedarf > 0 ? (1 - simResult.netzbezugMwh / gesamtBedarf) * 100 : 0;
  const curtailQuote = pvErtragMwh  > 0 ? simResult.curtailMwh / pvErtragMwh * 100 : 0;

  return {
    pvInvest, batInvest, infraInvest: infra.investEUR, infraLabel: infra.stufeLabel,
    investGes, pvJk, batJk, infJk, gesamtJk, gesamtErloes, nettoJk,
    eigenErsparnis, einspeisErloes, abregelVerlust,
    pvEigenQuote, autarkie, curtailQuote, amort,
    infDetail: infra.detail,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SPOT-PREISE: Status aus window.elSpotPreiseH (Upload in ⚡ Strom-Grundlagen)
// ══════════════════════════════════════════════════════════════════════════════

// Wird von spotPreisFileSelected / spotPreisClear in 09a aufgerufen
window._pvUpdateSpotStatus = function _pvUpdateSpotStatus() {
  const el = document.getElementById('pva-spot-status');
  if (!el) return;
  const arr = window.elSpotPreiseH;
  if (!arr) {
    el.textContent = 'nicht geladen — in ⚡ Strom-Grundlagen hochladen';
    el.style.color = 'var(--muted)';
  } else {
    let sum = 0, pMax = -Infinity, pMin = Infinity;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (arr[i] > pMax) pMax = arr[i];
      if (arr[i] < pMin) pMin = arr[i];
    }
    const avg = sum / arr.length;
    el.textContent = `${window.elSpotPreiseFilename || '?'} · Ø ${avg.toFixed(1)} ct/kWh · ${pMin.toFixed(0)}–${pMax.toFixed(0)} ct`;
    el.style.color = '#ab47bc';
  }
};

// Legacy-Export (nicht mehr genutzt, schadet aber nicht)
export async function pvLadeSpotPreise() {
  window._pvUpdateSpotStatus?.();
}

// ══════════════════════════════════════════════════════════════════════════════
// VARIANTEN BERECHNEN
// ══════════════════════════════════════════════════════════════════════════════

export function pvBerechneAlle() {
  const state    = window._pvAnalyse;
  const demandH  = pvGetDemandH();
  if (!demandH) {
    alert('Kein Stromlastgang vorhanden. Bitte zuerst in ⚡ Strom-Grundlagen hochladen.');
    return;
  }

  const pvProfile  = pvGetPvProfile();
  const maxKwp     = pvGetMaxKwpFromAssets();
  const napParams  = { maxEinspeisKw: state.napMaxEinspKw, maxBezugKw: state.napMaxBezugKw };
  const spotH      = window.elSpotPreiseH || state.spotPreise;

  // Wirtschaftsparameter aus Panel
  const pStrom         = parseFloat(document.getElementById('pva-p-strom')?.value) || 30;
  const pEinsp         = parseFloat(document.getElementById('pva-p-einsp')?.value) || 8;
  const pvInvestPerKwp = parseFloat(document.getElementById('pva-pv-invest')?.value) || OPT_INVEST_DEFAULT.pv;
  const batInvestPerKwh= parseFloat(document.getElementById('pva-bat-invest')?.value)|| OPT_INVEST_DEFAULT.bat;
  const zins           = (parseFloat(document.getElementById('pva-zins')?.value) || 3.5) / 100;
  const pvLife         = parseFloat(document.getElementById('pva-pv-life')?.value) || 20;
  const batLife        = parseFloat(document.getElementById('pva-bat-life')?.value) || 15;

  const params = { pStrom, pEinsp, pvInvestPerKwp, batInvestPerKwh, zins, pvLife, batLife };

  const ergebnisse = [];

  // ── Hilfsfunktion: eine Variante berechnen und pushen ──
  function berechne(label, farbe, icon, pvKwp, batKwh, strategie) {
    if (pvKwp <= 0) return;
    const ertragMwh = pvKwp * pvGetSpez() / 1000;
    const sim  = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strategie, spotH);
    const wirt = pvWirtschaft(pvKwp, batKwh, sim, ertragMwh, params);
    ergebnisse.push({ label, farbe, icon, pvKwp, batKwh, strategie, ertragMwh, sim, wirt });
  }

  // ── Minimal 99 kWp ──
  berechne('Minimal (99 kWp)', '#78909c', '▽', 99, 0, 'none');

  // ── EV-Optimiert ──
  const evKwp = pvCalcEvOptKwp(demandH, pvProfile, napParams, params);
  const evBat = pvOptBat(evKwp, demandH, pvProfile, napParams, 'ev', null, params);
  berechne('EV-Optimiert', '#42a5f5', '⊙', evKwp, evBat, 'ev');

  // ── Max PV (ohne Batterie) ──
  berechne('Max PV', '#fdd835', '△', maxKwp, 0, 'none');

  // ── Max PV + Bat (EV) ──
  if (maxKwp > 0) {
    const batEv = pvOptBat(maxKwp, demandH, pvProfile, napParams, 'ev', null, params);
    berechne('Max PV + Bat (EV)', '#66bb6a', '▲', maxKwp, batEv, 'ev');
  }

  // ── Max PV + Bat (Spot) ──
  if (maxKwp > 0 && spotH) {
    const batSpot = pvOptBat(maxKwp, demandH, pvProfile, napParams, 'spot', spotH, params);
    berechne('Max PV + Bat (Spot)', '#ab47bc', '★', maxKwp, batSpot, 'spot');
  }

  // ── Benutzerdefinierte Varianten ──
  for (const cv of state.customVarianten) {
    berechne(cv.label, '#ff7043', '✎', cv.pvKwp, cv.batKwh, cv.batKwh > 0 ? 'ev' : 'none');
  }

  state.ergebnisse = ergebnisse;
  state.berechnet  = true;
  renderVariantenTabelle(ergebnisse);
  renderEvKurve(demandH, pvProfile, napParams, params, ergebnisse);
  renderBilanzChart(ergebnisse);
  renderScatterChart(ergebnisse);
  _pvUpdateBerechnenBtn(false);
}

// ══════════════════════════════════════════════════════════════════════════════
// ANALYSE-SECTION INJECTION (identisches Muster zu napBuildAnalyseSection)
// ══════════════════════════════════════════════════════════════════════════════

export function pvaBuildAnalyseSection() {
  // Tab-Button einfügen (idempotent)
  const tabBar = document.getElementById('analyse-view-tabs');
  if (tabBar && !tabBar.querySelector('[data-section="pva"]')) {
    const btn = document.createElement('button');
    btn.className    = 'analyse-section-tab';
    btn.dataset.section = 'pva';
    btn.textContent  = '☀ PV-Analyse';
    btn.addEventListener('click', () => {
      if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('pva');
    });
    tabBar.appendChild(btn);
  }

  // Content-Wrapper einmalig anlegen
  const existing = document.getElementById('analyse-pva-wrap');
  if (existing) return;

  // Einhängepunkt: identisch zu nap/kna (Geschwister-Element im centre-analyse-view)
  const analyseView = document.getElementById('center-analyse-view');
  if (!analyseView) return;

  const wrap = document.createElement('div');
  wrap.id = 'analyse-pva-wrap';
  wrap.style.display = 'none';
  analyseView.appendChild(wrap);
}

export function pvaShowSection(show) {
  const wrap = document.getElementById('analyse-pva-wrap');
  if (!wrap) return;
  wrap.style.display = show ? 'block' : 'none';
  if (show) {
    _pvInitInWrap(wrap); // rendert immer neu → liest aktuellen Zustand aus window.*
  }
}

function _pvInitInWrap(wrap) {
  // Immer neu rendern: Lastgang, Spot-Preise oder Assets können sich geändert haben.
  // Eingabewerte werden über _pvSyncFromState() wiederhergestellt.
  wrap.innerHTML = _pvBuildPanelHtml();
  _pvBindEvents();
  _pvSyncFromState();
}

// Legacy-Export (wird nicht mehr direkt gebraucht, schadet aber nicht)
export function initPvAnalyse() {
  pvaShowSection(true);
}

function _pvBuildPanelHtml() {
  return `
<div style="padding:20px 24px;">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <span style="font-size:14px;color:#fdd835;letter-spacing:.04em;">☀ PV-Analyse</span>
    <button class="btn-secondary" data-click="setViewMode('karte')" style="font-size:11px;">← Zurück zur Karte</button>
  </div>

  <!-- Layout: 3 Spalten -->
  <div class="pva-layout" style="display:grid;grid-template-columns:270px 1fr 260px;gap:14px;align-items:start;">

    <!-- ═══ SPALTE 1: Eingaben ═══════════════════════════════════════════ -->
    <div style="display:flex;flex-direction:column;gap:10px;">

      <!-- NAP-Parameter -->
      <div style="background:var(--surface2);border-radius:7px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
          Netzanschlusspunkt (NAP)
          <span class="htip" data-tip="Grenzen am Netzanschlusspunkt. 0 = unbegrenzt. Einspeisebegrenzung aktiviert Abregelungs-KPI und erzwingt Batterie-Pufferung.">?</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;">
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Max. Einspeisung (kW)</div>
            <input id="pva-nap-einsp" type="number" value="0" min="0" step="10"
              style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
              data-change="window._pvAnalyse.napMaxEinspKw=parseFloat(this.value)||0"
              title="0 = kein Limit"/>
          </div>
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Max. Bezug (kW)</div>
            <input id="pva-nap-bezug" type="number" value="0" min="0" step="10"
              style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
              data-change="window._pvAnalyse.napMaxBezugKw=parseFloat(this.value)||0"
              title="0 = kein Limit"/>
          </div>
        </div>
      </div>

      <!-- PV-Parameter -->
      <div style="background:var(--surface2);border-radius:7px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
          PV-Parameter
          <span class="htip" data-tip="Max kWp aus Projekt: Summe aller PV-Anlagen (Gebäude-PV, Freiflächen, Strom-Panel kWp-Feld). 0 = kein PV im Projekt definiert → Max kWp manuell eingeben.">?</span>
        </div>
        ${(() => {
          const bd     = pvGetAssetBreakdown();
          const total  = bd.assetKwp + bd.gebKwp + bd.ffKwp + bd.manual;
          const parts  = [];
          if (bd.assetKwp > 0) parts.push(`Elektro-Assets (${bd.assetN}×): ${bd.assetKwp.toFixed(0)} kWp`);
          if (bd.gebKwp   > 0) parts.push(`Gebäude-PV: ${bd.gebKwp.toFixed(0)} kWp`);
          if (bd.ffKwp    > 0) parts.push(`Freifläche: ${bd.ffKwp.toFixed(0)} kWp`);
          if (bd.manual   > 0) parts.push(`Strom-Panel: ${bd.manual} kWp`);
          return `<div style="font-size:9px;color:var(--muted);margin-bottom:6px;">
            Max kWp aus Projekt-Assets:
            <span id="pva-asset-kwp" style="color:${total>0?'#fdd835':'#ef9a9a'};font-weight:600;">${total.toFixed(0)} kWp</span>
            ${parts.length
              ? `<span style="color:#607d8b;font-size:8px;"> (${parts.join(' · ')})</span>`
              : '<span style="color:#ef9a9a;font-size:8px;"> — PV-Assets im Elektro-Tab anlegen oder unten eingeben</span>'}
          </div>`;
        })()}
        <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Max kWp manuell überschreiben (0 = aus Projekt)</div>
        <input id="pva-max-kwp" type="number" value="${window._pvAnalyse.pvMaxKwpOverride||0}" min="0" step="10"
          style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;margin-bottom:4px;"
          data-change="window._pvAnalyse.pvMaxKwpOverride=parseFloat(this.value)||0"/>
      </div>

      <!-- Infrastruktur -->
      <div style="background:var(--surface2);border-radius:7px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
          Infrastrukturkosten
          <span class="htip" data-tip="Netzanschluss und Zusatzkosten je PV-Leistungsstufe. Werden automatisch der Variante zugeordnet.">?</span>
        </div>
        <div id="pva-infra-stufen" style="font-size:9px;"></div>
        <!-- Erzeugungsnetz -->
        <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:9px;color:var(--text);">
            <input type="checkbox" id="pva-erznetz-aktiv"
              data-change="window._pvAnalyse.erzNetzAktiv=this.checked;document.getElementById('pva-erznetz-detail').style.display=this.checked?'block':'none'"
              style="accent-color:#fdd835;">
            Erzeugungsnetz (dediziert)
          </label>
          <div id="pva-erznetz-detail" style="display:none;margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <div>
              <div style="font-size:8px;color:var(--muted);">Länge (m)</div>
              <input id="pva-erznetz-laenge" type="number" value="0" min="0" step="10"
                style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"
                data-change="window._pvAnalyse.erzNetz.laengeM=parseFloat(this.value)||0"/>
            </div>
            <div>
              <div style="font-size:8px;color:var(--muted);">€/m</div>
              <input id="pva-erznetz-preis" type="number" value="250" min="50" step="25"
                style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"
                data-change="window._pvAnalyse.erzNetz.preisPrM=parseFloat(this.value)||250"/>
            </div>
            <div style="grid-column:1/-1;">
              <div style="font-size:8px;color:var(--muted);">Übergabepunkt / Schutz (€)</div>
              <input id="pva-erznetz-schutz" type="number" value="5000" min="0" step="500"
                style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"
                data-change="window._pvAnalyse.erzNetz.schutzEUR=parseFloat(this.value)||5000"/>
            </div>
          </div>
        </div>
        <!-- Mehrkostenprinzip -->
        <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
          <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">
            Mehrkosten (geteilte Infrastruktur)
            <span class="htip" data-tip="Infrastruktur die sowieso ertüchtigt werden müsste, aber wegen PV anders dimensioniert wird: Differenzkosten eingeben.">?</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <div>
              <div style="font-size:8px;color:var(--muted);">Invest (€)</div>
              <input id="pva-mehrkosten-invest" type="number" value="0" min="0" step="1000"
                style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"
                data-change="window._pvAnalyse.mehrkosten.investEUR=parseFloat(this.value)||0"/>
            </div>
            <div>
              <div style="font-size:8px;color:var(--muted);">Jährlich (€/a)</div>
              <input id="pva-mehrkosten-jk" type="number" value="0" min="0" step="100"
                style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"
                data-change="window._pvAnalyse.mehrkosten.jaehrlichEUR=parseFloat(this.value)||0"/>
            </div>
          </div>
          <input id="pva-mehrkosten-label" type="text" placeholder="Beschreibung..."
            style="width:100%;margin-top:3px;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;box-sizing:border-box;"
            data-change="window._pvAnalyse.mehrkosten.label=this.value"/>
        </div>
      </div>

      <!-- Eigene Variante hinzufügen -->
      <div style="background:var(--surface2);border-radius:7px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">Eigene Variante</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">
          <div>
            <div style="font-size:8px;color:var(--muted);">kWp</div>
            <input id="pva-custom-kwp" type="number" value="" min="0" step="10"
              style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"/>
          </div>
          <div>
            <div style="font-size:8px;color:var(--muted);">Bat kWh</div>
            <input id="pva-custom-kwh" type="number" value="" min="0" step="10"
              style="width:100%;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;"/>
          </div>
        </div>
        <input id="pva-custom-label" type="text" placeholder="Bezeichnung..."
          style="width:100%;margin-bottom:4px;padding:3px 5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;box-sizing:border-box;"/>
        <button class="btn-secondary" style="width:100%;font-size:9px;padding:4px 0;"
          data-click="pvAddCustomVariante()">+ Variante hinzufügen</button>
        <div id="pva-custom-list" style="margin-top:6px;font-size:9px;"></div>
      </div>

      <!-- Berechnen -->
      <button class="btn-confirm" id="pva-btn-berechnen"
        style="width:100%;padding:10px;font-size:12px;"
        data-click="pvBerechneAlle()">
        ⚡ Varianten berechnen
      </button>
    </div>

    <!-- ═══ SPALTE 2+3 werden unten zusammengeführt → hier nur Platzhalter ══ -->
    <div style="display:none;"></div>

    <!-- ═══ SPALTE 3: Wirtschaftsparameter ═══════════════════════════════ -->
    <div style="display:flex;flex-direction:column;gap:10px;">

      <!-- Spot-Preise -->
      <div style="background:var(--surface2);border-radius:7px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:6px;">
          Spot-Preise (EPEX DE)
          <span class="htip" data-tip="Spot-Preise in ⚡ Strom-Grundlagen hochladen (SMARD, ENTSO-E o.ä.). Für die Variante 'Max PV + Bat (Spot)' erforderlich.">?</span>
        </div>
        <div id="pva-spot-status" style="font-size:9px;color:${window.elSpotPreiseH ? '#ab47bc' : 'var(--muted)'};">
          ${window.elSpotPreiseH
            ? `${window.elSpotPreiseFilename || '?'} · Ø ${(window.elSpotPreiseH.reduce((s,v)=>s+v,0)/window.elSpotPreiseH.length).toFixed(1)} ct/kWh`
            : 'nicht geladen — in ⚡ Strom-Grundlagen hochladen'}
        </div>
      </div>

      <!-- Invest + Wirtschaft -->
      <div style="background:var(--surface2);border-radius:7px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">Wirtschaftsparameter</div>
        <div style="display:flex;flex-direction:column;gap:5px;font-size:10px;">
          ${_pvWirtInput('pva-p-strom',   'Strombezugspreis (ct/kWh)', 30)}
          ${_pvWirtInput('pva-p-einsp',   'Einspeisevergütung (ct/kWh)', 8)}
          ${_pvWirtInput('pva-pv-invest', 'PV-Invest (€/kWp)', OPT_INVEST_DEFAULT.pv)}
          ${_pvWirtInput('pva-bat-invest','Bat-Invest (€/kWh)', OPT_INVEST_DEFAULT.bat)}
          ${_pvWirtInput('pva-zins',      'Zinssatz (%)', 3.5)}
          ${_pvWirtInput('pva-pv-life',   'PV-Nutzungsdauer (a)', 20)}
          ${_pvWirtInput('pva-bat-life',  'Bat-Nutzungsdauer (a)', 15)}
        </div>
      </div>

    </div>
  </div>

  <!-- ═══ ERGEBNISSE: volle Breite ════════════════════════════════════════ -->
  <div style="margin-top:16px;border-top:2px solid var(--border);padding-top:14px;">

    <!-- Tabelle -->
    <div id="pva-result-tabelle" style="margin-bottom:20px;overflow-x:auto;">
      <div style="color:var(--muted);font-size:10px;text-align:center;padding:40px 0;">
        ${(window.elQuartierH15 || window.elQuartierH)
          ? '✓ Lastgang geladen — Varianten berechnen klicken ↓'
          : 'Lastgang hochladen (⚡ Strom-Grundlagen) und dann berechnen.'}
      </div>
    </div>

    <!-- Charts 2-spaltig -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;">
      <div id="pva-ev-kurve" style="overflow:hidden;"></div>
      <div id="pva-chart-bilanz" style="overflow:hidden;"></div>
    </div>

    <!-- Scatter: Invest vs. Amortisation -->
    <div id="pva-chart-scatter" style="margin-top:16px;overflow:hidden;"></div>

  </div>
</div>`;
}

function _pvWirtInput(id, label, defVal) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;">
    <span style="color:var(--muted);font-size:9px;">${label}</span>
    <input id="${id}" type="number" value="${defVal}" min="0" step="0.1"
      style="width:80px;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:9px;text-align:right;"/>
  </div>`;
}

function _pvBindEvents() {
  // Infra-Stufen rendern
  _pvRenderInfraStufen();
  // Asset-kWp anzeigen
  const el = document.getElementById('pva-asset-kwp');
  if (el) el.textContent = pvGetMaxKwpFromAssets().toFixed(0) + ' kWp';
}

function _pvSyncFromState() {
  const s = window._pvAnalyse;
  const set  = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  const setC = (id, v) => { const e = document.getElementById(id); if (e) e.checked = v; };
  set('pva-nap-einsp',          s.napMaxEinspKw  || 0);
  set('pva-nap-bezug',          s.napMaxBezugKw  || 0);
  set('pva-max-kwp',            s.pvMaxKwpOverride || 0);
  set('pva-erznetz-laenge',     s.erzNetz.laengeM  || 0);
  set('pva-erznetz-preis',      s.erzNetz.preisPrM || 250);
  set('pva-erznetz-schutz',     s.erzNetz.schutzEUR || 5000);
  set('pva-mehrkosten-invest',  s.mehrkosten.investEUR    || 0);
  set('pva-mehrkosten-jk',      s.mehrkosten.jaehrlichEUR || 0);
  const lbl = document.getElementById('pva-mehrkosten-label');
  if (lbl) lbl.value = s.mehrkosten.label || '';
  setC('pva-erznetz-aktiv', s.erzNetzAktiv || false);
  const erzDetail = document.getElementById('pva-erznetz-detail');
  if (erzDetail) erzDetail.style.display = s.erzNetzAktiv ? 'grid' : 'none';
  // Ergebnisse wieder anzeigen wenn bereits berechnet
  if (s.berechnet && s.ergebnisse?.length) {
    renderVariantenTabelle(s.ergebnisse);
    const d = pvGetDemandH();
    if (d) {
      const p = pvGetPvProfile();
      const np = { maxEinspeisKw: s.napMaxEinspKw, maxBezugKw: s.napMaxBezugKw };
      const pStrom = parseFloat(document.getElementById('pva-p-strom')?.value) || 30;
      const pEinsp = parseFloat(document.getElementById('pva-p-einsp')?.value) || 8;
      const pvInv  = parseFloat(document.getElementById('pva-pv-invest')?.value) || OPT_INVEST_DEFAULT.pv;
      const batInv = parseFloat(document.getElementById('pva-bat-invest')?.value) || OPT_INVEST_DEFAULT.bat;
      const zins   = (parseFloat(document.getElementById('pva-zins')?.value) || 3.5) / 100;
      const pvLife = parseFloat(document.getElementById('pva-pv-life')?.value) || 20;
      const batLife= parseFloat(document.getElementById('pva-bat-life')?.value) || 15;
      renderEvKurve(d, p, np, { pStrom, pEinsp, pvInvestPerKwp: pvInv, batInvestPerKwh: batInv, zins, pvLife, batLife });
    }
  }
  // Custom-Varianten-Liste
  _pvRenderCustomList();
}

function _pvRenderInfraStufen() {
  const el = document.getElementById('pva-infra-stufen');
  if (!el) return;
  el.innerHTML = PV_INFRA_STUFEN.map(stufe => {
    const sumInvest = stufe.items.reduce((s, i) => s + (i.aktiv ? i.investEUR : 0), 0);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="color:var(--muted);font-size:8px;">${stufe.label}</span>
      <span style="color:var(--text);font-family:'DM Mono',monospace;font-size:8px;">${sumInvest > 0 ? sumInvest.toLocaleString('de-DE') + ' €' : '+'}</span>
    </div>`;
  }).join('');
}

// ── Vergleichstabelle ──────────────────────────────────────────────────────

function renderVariantenTabelle(varianten) {
  const el = document.getElementById('pva-result-tabelle');
  if (!el) return;
  if (!varianten || varianten.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:20px;text-align:center;">Keine Ergebnisse.</div>';
    return;
  }

  const napAktiv = window._pvAnalyse.napMaxEinspKw > 0;
  const fmt  = (v, dez=0) => typeof v === 'number' ? v.toFixed(dez).replace('.', ',') : '—';
  const fmtK = v => v >= 1000 ? (v / 1000).toFixed(0) + ' k€' : Math.round(v) + ' €';
  const pct  = v => fmt(v, 1) + ' %';

  // Finde bestes Amortisation-Ergebnis für Hervorhebung
  const bestAmort = Math.min(...varianten.map(v => v.wirt.amort).filter(a => isFinite(a)));

  let html = `
  <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">Varianten-Vergleich</div>
  <div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:9px;">
    <thead>
      <tr style="color:var(--muted);text-align:right;border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:3px 5px;white-space:nowrap;">Variante</th>
        <th style="padding:3px 5px;">kWp</th>
        <th style="padding:3px 5px;">Bat kWh</th>
        <th style="padding:3px 5px;">EV&nbsp;%</th>
        <th style="padding:3px 5px;">Aut&nbsp;%</th>
        ${napAktiv ? '<th style="padding:3px 5px;color:#ef9a9a;">Abr&nbsp;%</th>' : ''}
        <th style="padding:3px 5px;">Invest</th>
        <th style="padding:3px 5px;">Infra</th>
        <th style="padding:3px 5px;">Erlös/a</th>
        <th style="padding:3px 5px;">JK netto</th>
        <th style="padding:3px 5px;">Amort</th>
      </tr>
    </thead>
    <tbody>`;

  for (const v of varianten) {
    const w = v.wirt;
    const isKomp = w.amort === bestAmort;
    const abregelColor = v.sim.curtailMwh > 0 && (w.curtailQuote > 5) ? '#ef9a9a' : v.sim.curtailMwh > 0 ? '#ffd54f' : 'var(--muted)';
    const rowBg = isKomp ? 'rgba(102,187,106,0.07)' : 'transparent';

    html += `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);background:${rowBg};">
        <td style="padding:4px 5px;white-space:nowrap;">
          <span style="color:${v.farbe};font-size:11px;">${v.icon}</span>
          <span style="margin-left:4px;color:var(--text);">${v.label}</span>
          ${isKomp ? ' <span style="background:#66bb6a;color:#000;border-radius:2px;padding:0 3px;font-size:7px;font-weight:700;">BEST</span>' : ''}
        </td>
        <td style="text-align:right;padding:4px 5px;font-family:'DM Mono',monospace;color:#fdd835;">${fmt(v.pvKwp)}</td>
        <td style="text-align:right;padding:4px 5px;font-family:'DM Mono',monospace;color:#80deea;">${v.batKwh > 0 ? fmt(v.batKwh) : '—'}</td>
        <td style="text-align:right;padding:4px 5px;color:#a5d6a7;">${pct(w.pvEigenQuote)}</td>
        <td style="text-align:right;padding:4px 5px;color:#4fc3f7;">${pct(w.autarkie)}</td>
        ${napAktiv ? `<td style="text-align:right;padding:4px 5px;color:${abregelColor};">${w.curtailQuote > 0 ? pct(w.curtailQuote) : '—'}</td>` : ''}
        <td style="text-align:right;padding:4px 5px;color:#ce93d8;">${fmtK(w.investGes)}</td>
        <td style="text-align:right;padding:4px 5px;color:#ff8a65;">${fmtK(w.infraInvest)} <span style="color:var(--muted);font-size:7px;">${w.infraLabel.split(' ')[0]}</span></td>
        <td style="text-align:right;padding:4px 5px;color:#a5d6a7;">${fmtK(w.gesamtErloes)}</td>
        <td style="text-align:right;padding:4px 5px;color:${w.nettoJk < 0 ? '#66bb6a' : '#ef9a9a'};">${fmtK(w.nettoJk)}</td>
        <td style="text-align:right;padding:4px 5px;font-weight:600;color:${isKomp ? '#66bb6a' : 'var(--text)'};">${isFinite(w.amort) ? fmt(w.amort, 1) + ' a' : '> 20 a'}</td>
      </tr>`;
  }

  html += `</tbody></table></div>`;

  // Legende NAP-Hinweis
  if (napAktiv) {
    html += `<div style="margin-top:6px;font-size:9px;color:var(--muted);">
      <span style="color:#ef9a9a;">Abr %</span> = Abregelungsverluste (entgangener Erlös durch NAP-Einspeisebegrenzung)
    </div>`;
  }

  // Detail-Zeilen: Infra-Detail ausklappbar
  html += `<div style="margin-top:10px;">`;
  for (const v of varianten) {
    if (v.wirt.infDetail && v.wirt.infDetail.length > 0) {
      html += `<div style="font-size:8px;color:var(--muted);margin-bottom:2px;">
        <span style="color:${v.farbe};">${v.icon} ${v.label}:</span>
        Infra: ${v.wirt.infDetail.join(', ')} · ${v.wirt.infraInvest.toLocaleString('de-DE')} € Invest
      </div>`;
    }
  }
  html += `</div>`;

  el.innerHTML = html;
}

// ── EV-Kurve: Eigenverbrauchsquote vs. PV-Größe ───────────────────────────

function renderEvKurve(demandH, pvProfile, napParams, params, varianten) {
  const el = document.getElementById('pva-ev-kurve');
  if (!el) return;

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const steps = [];
  for (let k = 0; k <= maxKwp; k += Math.max(5, Math.round(maxKwp / 40))) steps.push(k);
  if (steps[steps.length-1] !== maxKwp) steps.push(maxKwp);

  const evData = steps.map(kwp => {
    if (kwp === 0) return { kwp, evQ: 0, curtailQ: 0 };
    const sim = pvNapSim(kwp, 0, demandH, pvProfile, napParams, 'none', null);
    const ert = kwp * pvGetSpez() / 1000;
    return {
      kwp,
      evQ: ert > 0 ? sim.eigenMwh / ert * 100 : 0,
      curtailQ: ert > 0 ? sim.curtailMwh / ert * 100 : 0,
    };
  });

  // Responsives SVG-Chart (volle Container-Breite)
  const elW  = el.getBoundingClientRect().width || 600;
  const W = Math.max(400, Math.min(900, elW - 4));
  const H = 180, PL = 42, PT = 14, PR = 14, PB = 32;
  const cW = W - PL - PR, cH = H - PT - PB;
  const xS = v => PL + (v / maxKwp) * cW;
  const yS = v => PT + cH - (v / 100) * cH;

  const evPath = evData.map((d, i) => `${i===0?'M':'L'}${xS(d.kwp).toFixed(1)},${yS(d.evQ).toFixed(1)}`).join(' ');
  const curtailPath = evData.filter(d => d.curtailQ > 0)
    .map((d, i) => `${i===0?'M':'L'}${xS(d.kwp).toFixed(1)},${yS(d.curtailQ).toFixed(1)}`).join(' ');

  const xMax = xS(maxKwp).toFixed(1);

  el.innerHTML = `
  <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
    Eigenverbrauchsquote &amp; Abregelung je PV-Größe
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;">
    <!-- Gitter -->
    ${[0,25,50,75,100].map(v => `
      <line x1="${PL}" y1="${yS(v).toFixed(1)}" x2="${PL+cW}" y2="${yS(v).toFixed(1)}"
        stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      <text x="${PL-5}" y="${(yS(v)+3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="9">${v}%</text>
    `).join('')}
    <!-- X-Achse Linie -->
    <line x1="${PL}" y1="${PT+cH}" x2="${PL+cW}" y2="${PT+cH}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <!-- X-Achse Labels -->
    ${[0, Math.round(maxKwp*0.25), Math.round(maxKwp*0.5), Math.round(maxKwp*0.75), maxKwp].map(v => `
      <text x="${xS(v).toFixed(1)}" y="${PT+cH+14}" text-anchor="middle" fill="#607d8b" font-size="9">${v}</text>
    `).join('')}
    <text x="${PL+cW/2}" y="${H-2}" text-anchor="middle" fill="#607d8b" font-size="9">kWp</text>

    <!-- Abregelung (rot gestrichelt) -->
    ${curtailPath ? `<path d="${curtailPath}" fill="none" stroke="#ef9a9a" stroke-width="1.5" stroke-dasharray="4,3"/>` : ''}
    <!-- EV-Kurve (blau) -->
    <path d="${evPath}" fill="none" stroke="#42a5f5" stroke-width="2.5"/>

    <!-- Max-PV Markierung -->
    <line x1="${xMax}" y1="${PT}" x2="${xMax}" y2="${(PT+cH).toFixed(1)}" stroke="#fdd835" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>
    <text x="${Math.min(parseFloat(xMax)+4, W-60)}" y="${PT+11}" fill="#fdd835" font-size="9">Max PV</text>

    <!-- Legende (oben links) -->
    <rect x="${PL+4}" y="${PT+2}" width="96" height="32" rx="3" fill="rgba(0,0,0,0.5)"/>
    <line x1="${PL+8}"  y1="${PT+12}" x2="${PL+18}" y2="${PT+12}" stroke="#42a5f5" stroke-width="2.5"/>
    <text x="${PL+22}" y="${PT+15}" fill="#90a4ae" font-size="9">Eigenverbrauch</text>
    <line x1="${PL+8}"  y1="${PT+24}" x2="${PL+18}" y2="${PT+24}" stroke="#ef9a9a" stroke-width="1.5" stroke-dasharray="4,3"/>
    <text x="${PL+22}" y="${PT+27}" fill="#90a4ae" font-size="9">Abregelung</text>

    <!-- Varianten-Marker auf der EV-Kurve -->
    ${(varianten || []).map(v => {
      const x = xS(v.pvKwp).toFixed(1);
      const evClipped = Math.min(v.wirt.pvEigenQuote, 100);
      const y = yS(evClipped).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="5" fill="${v.farbe}" stroke="#000" stroke-width="1" opacity="0.9"/>
        <text x="${x}" y="${parseFloat(y)-8}" text-anchor="middle" fill="${v.farbe}" font-size="8" font-weight="600">${v.icon}</text>`;
    }).join('')}
  </svg>`;
}

// ── Energie-Bilanz-Balken: Eigenverbrauch / Einspeisung / Netzbezug ────────

function renderBilanzChart(varianten) {
  const el = document.getElementById('pva-chart-bilanz');
  if (!el || !varianten?.length) return;

  const elW = el.getBoundingClientRect().width || 400;
  const W = Math.max(300, elW - 4);
  const barH = 22, gap = 6, PT = 14, PL = 110, PR = 10, PB = 20;
  const H = PT + varianten.length * (barH + gap) + PB;

  // Max-Wert für Skalierung (MWh)
  const maxVal = Math.max(...varianten.map(v => v.sim.eigenMwh + v.sim.einspeiseMwh + v.sim.netzbezugMwh));
  const cW = W - PL - PR;
  const xV = v => PL + (v / maxVal) * cW;

  const bars = varianten.map((v, i) => {
    const y = PT + i * (barH + gap);
    const ev = v.sim.eigenMwh, es = v.sim.einspeiseMwh, nb = v.sim.netzbezugMwh;
    const total = ev + es + nb;
    const wEv = total > 0 ? (ev / maxVal) * cW : 0;
    const wEs = total > 0 ? (es / maxVal) * cW : 0;
    const wNb = total > 0 ? (nb / maxVal) * cW : 0;
    return `
      <text x="${PL-4}" y="${y + barH/2 + 3}" text-anchor="end" fill="${v.farbe}" font-size="9" font-weight="600">${v.icon} ${v.label.length > 14 ? v.label.slice(0,13)+'…' : v.label}</text>
      <rect x="${PL}" y="${y}" width="${wEv.toFixed(1)}" height="${barH}" fill="#42a5f5" opacity="0.85"/>
      <rect x="${(PL+wEv).toFixed(1)}" y="${y}" width="${wEs.toFixed(1)}" height="${barH}" fill="#66bb6a" opacity="0.85"/>
      <rect x="${(PL+wEv+wEs).toFixed(1)}" y="${y}" width="${wNb.toFixed(1)}" height="${barH}" fill="#ef5350" opacity="0.6"/>
      <text x="${(PL+wEv/2).toFixed(1)}" y="${y+barH/2+3}" text-anchor="middle" fill="#000" font-size="8">${ev > 5 ? ev.toFixed(0)+' MWh' : ''}</text>
    `;
  }).join('');

  el.innerHTML = `
  <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">Energiebilanz je Variante</div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;">
    ${bars}
    <!-- X-Achse -->
    <line x1="${PL}" y1="${H-PB}" x2="${PL+cW}" y2="${H-PB}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    ${[0,0.25,0.5,0.75,1].map(f => {
      const x = (PL + f * cW).toFixed(1);
      return `<text x="${x}" y="${H-PB+10}" text-anchor="middle" fill="#607d8b" font-size="8">${(f*maxVal).toFixed(0)}</text>`;
    }).join('')}
    <text x="${PL+cW/2}" y="${H-2}" text-anchor="middle" fill="#607d8b" font-size="8">MWh/a</text>
    <!-- Legende -->
    <rect x="${PL}" y="2" width="8" height="8" fill="#42a5f5" opacity="0.85"/>
    <text x="${PL+11}" y="10" fill="#90a4ae" font-size="8">Eigenverbrauch</text>
    <rect x="${PL+80}" y="2" width="8" height="8" fill="#66bb6a" opacity="0.85"/>
    <text x="${PL+91}" y="10" fill="#90a4ae" font-size="8">Einspeisung</text>
    <rect x="${PL+150}" y="2" width="8" height="8" fill="#ef5350" opacity="0.6"/>
    <text x="${PL+161}" y="10" fill="#90a4ae" font-size="8">Netzbezug</text>
  </svg>`;
}

// ── Scatter: Invest vs. Amortisation — zeigt wirtschaftliche Effizienz ──────

function renderScatterChart(varianten) {
  const el = document.getElementById('pva-chart-scatter');
  if (!el || !varianten?.length) return;

  const elW = el.getBoundingClientRect().width || 700;
  const W = Math.max(400, elW - 4);
  const H = 200, PL = 50, PT = 16, PR = 20, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;

  const maxInvest = Math.max(...varianten.map(v => v.wirt.investGes), 100000);
  const maxAmort  = Math.max(...varianten.map(v => isFinite(v.wirt.amort) ? v.wirt.amort : 25), 25);
  const minAmort  = 0;

  const xS = v => PL + (v / maxInvest) * cW;
  const yS = v => PT + cH - ((v - minAmort) / (maxAmort - minAmort)) * cH;

  // Grüne Zone (amort < 10a)
  const yGreen = yS(10).toFixed(1);
  const dots = varianten.map(v => {
    const x = xS(v.wirt.investGes).toFixed(1);
    const amort = isFinite(v.wirt.amort) ? v.wirt.amort : maxAmort;
    const y = yS(amort).toFixed(1);
    const autPct = v.wirt.autarkie.toFixed(0);
    return `
      <circle cx="${x}" cy="${y}" r="${6 + v.wirt.autarkie / 20}" fill="${v.farbe}" stroke="#111" stroke-width="1.5" opacity="0.85"/>
      <text x="${x}" y="${parseFloat(y)-10}" text-anchor="middle" fill="${v.farbe}" font-size="9" font-weight="600">${v.icon}</text>
      <text x="${x}" y="${parseFloat(y)+14}" text-anchor="middle" fill="#90a4ae" font-size="7">${autPct}% Aut</text>
    `;
  }).join('');

  el.innerHTML = `
  <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
    Invest vs. Amortisation
    <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Kreisgroße = Autarkie % · je weiter links+unten, desto besser</span>
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;">
    <!-- Grüne Zone: Amortisation < 10a -->
    <rect x="${PL}" y="${yGreen}" width="${cW}" height="${(PT+cH-parseFloat(yGreen)).toFixed(1)}" fill="#66bb6a" opacity="0.05"/>
    <text x="${PL+4}" y="${parseFloat(yGreen)-3}" fill="#66bb6a" font-size="8" opacity="0.7">Amort. &lt; 10 a</text>
    <!-- Gitter Y -->
    ${[0,5,10,15,20,25].filter(v => v <= maxAmort+1).map(v => {
      const y = yS(v).toFixed(1);
      return `<line x1="${PL}" y1="${y}" x2="${PL+cW}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PL-4}" y="${(parseFloat(y)+3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="8">${v}a</text>`;
    }).join('')}
    <!-- Gitter X -->
    ${[0,0.25,0.5,0.75,1].map(f => {
      const x = (PL + f * cW).toFixed(1);
      const val = (f * maxInvest / 1000).toFixed(0);
      return `<line x1="${x}" y1="${PT}" x2="${x}" y2="${PT+cH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${x}" y="${PT+cH+12}" text-anchor="middle" fill="#607d8b" font-size="8">${val} k€</text>`;
    }).join('')}
    <!-- Achsen -->
    <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT+cH}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <line x1="${PL}" y1="${PT+cH}" x2="${PL+cW}" y2="${PT+cH}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <text x="${PL+cW/2}" y="${H-4}" text-anchor="middle" fill="#607d8b" font-size="9">Investition (k€)</text>
    <text x="10" y="${PT+cH/2}" text-anchor="middle" fill="#607d8b" font-size="9" transform="rotate(-90,10,${PT+cH/2})">Amortisation (a)</text>
    <!-- Punkte -->
    ${dots}
  </svg>`;
}

// ── Eigene Variante hinzufügen/entfernen ──────────────────────────────────

export function pvAddCustomVariante() {
  const kwp   = parseFloat(document.getElementById('pva-custom-kwp')?.value)   || 0;
  const kwh   = parseFloat(document.getElementById('pva-custom-kwh')?.value)   || 0;
  const label = document.getElementById('pva-custom-label')?.value?.trim() || `Eigene ${kwp} kWp`;
  if (kwp <= 0) { alert('Bitte kWp eingeben.'); return; }
  const id = 'c_' + Date.now();
  window._pvAnalyse.customVarianten.push({ id, label, pvKwp: kwp, batKwh: kwh });
  _pvRenderCustomList();
  document.getElementById('pva-custom-kwp').value = '';
  document.getElementById('pva-custom-kwh').value = '';
  document.getElementById('pva-custom-label').value = '';
}

export function pvRemoveCustomVariante(id) {
  window._pvAnalyse.customVarianten = window._pvAnalyse.customVarianten.filter(v => v.id !== id);
  _pvRenderCustomList();
}

function _pvRenderCustomList() {
  const el = document.getElementById('pva-custom-list');
  if (!el) return;
  el.innerHTML = window._pvAnalyse.customVarianten.map(v =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
       <span style="color:var(--text);">${v.label} · ${v.pvKwp} kWp${v.batKwh > 0 ? ' / ' + v.batKwh + ' kWh' : ''}</span>
       <button data-click="pvRemoveCustomVariante('${v.id}')" style="font-size:9px;padding:1px 5px;border:1px solid var(--border);border-radius:3px;background:transparent;color:var(--muted);cursor:pointer;">✕</button>
     </div>`
  ).join('');
}

function _pvUpdateBerechnenBtn(loading) {
  const btn = document.getElementById('pva-btn-berechnen');
  if (!btn) return;
  if (loading) {
    btn.textContent = '⏳ Berechne…';
    btn.disabled = true;
  } else {
    btn.textContent = '⚡ Varianten berechnen';
    btn.disabled = false;
  }
}

// Globale Exports für inline data-click/data-change Handler und setViewMode
window.initPvAnalyse          = initPvAnalyse;
window.pvBerechneAlle         = pvBerechneAlle;
window.pvAddCustomVariante    = pvAddCustomVariante;
window.pvRemoveCustomVariante = pvRemoveCustomVariante;
// pvLadeSpotPreise nicht mehr nötig (Upload über Strom-Grundlagen)
window.pvGetMaxKwpFromAssets  = pvGetMaxKwpFromAssets;
