// ── 09d-pv-analyse.js — PV-Analyse: Varianten, NAP, Batterieoptimierung, Infrastruktur ──
// Eigenständiges Modul — kein Eingriff in bestehende 09a–09c, 10a–10d.
// Nutzt window.elQuartierH15 (15-min nativ) wenn vorhanden, sonst window.elQuartierH (8760h).

import { freiflaechen, gebaeude, globalYear } from './01-globals-varianten.js';
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

// ── Kanonisches 5-Varianten-Schema ────────────────────────────────────────────
// Jede Variante beantwortet GENAU EINE Stakeholder-Frage. Die Texte werden im Tool
// als "Lesehilfe" angezeigt, damit Herleitung und Bewertung selbsterklärend sind.
const PV_VARIANTEN_INFO = {
  'minimal': {
    label: 'Minimal',            farbe: '#78909c', icon: '▽',
    frage:     'Was ist der günstigste Einstieg?',
    ziel:      'Minimale Investition, regulatorisch einfach',
    herleitung:'PV knapp unter 100 kWp — bleibt unter der Direktvermarktungs- und EZA-Reglerpflicht und damit in der günstigsten Netzanschlussstufe.',
    bewertung: 'Referenzpunkt mit niedrigster Investition. Lässt den Großteil des Dachpotenzials und der möglichen Erlöse ungenutzt.',
  },
  'ev-opt': {
    label: 'Eigenverbrauchs-optimiert', farbe: '#42a5f5', icon: '⊙',
    frage:     'Welche Größe verbraucht das Quartier selbst?',
    ziel:      'Höchste Eigenverbrauchsquote, kaum Einspeisung',
    herleitung:'PV so groß, dass fast die gesamte Erzeugung direkt vor Ort verbraucht wird; kleine Batterie schiebt Mittags-Überschuss in die Abendlast.',
    bewertung: 'Geringstes Netz- und Marktrisiko, sehr hohe Eigenverbrauchsquote — aber bewusst kleine Anlage mit geringem Gesamtertrag.',
  },
  'wirt-opt': {
    label: 'Wirtschaftlich optimiert', farbe: '#66bb6a', icon: '◆',
    frage:     'Was bringt den höchsten Jahresüberschuss?',
    ziel:      'Beste Wirtschaftlichkeit (max. Netto-Erlös/a)',
    herleitung:'PV- und Batteriegröße werden gemeinsam variiert; gewählt wird die Kombination mit dem höchsten jährlichen Netto-Überschuss (Erlöse minus alle Jahreskosten inkl. Infrastruktur).',
    bewertung: 'Betriebswirtschaftlich beste Variante. Etwas Abregelung wird bewusst hingenommen, weil ihre Vermeidung teurer wäre als der entgangene Erlös.',
  },
  'autarkie': {
    label: 'Autarkie-optimiert', farbe: '#4fc3f7', icon: '⬢',
    frage:     'Wie unabhängig vom Netz geht es maximal?',
    ziel:      'Technisch maximaler Autarkiegrad',
    herleitung:'Volle PV-Leistung plus so viel Batterie, bis der Autarkiegrad nicht mehr nennenswert steigt (technische Sättigung).',
    bewertung: 'Höchste Versorgungssicherheit, aber teuer (große Batterie). Zeigt die technische Obergrenze — meist nicht wirtschaftlich.',
  },
  'max-pv': {
    label: 'Maximaler PV-Ausbau', farbe: '#fdd835', icon: '△',
    frage:     'Wie viel PV passt maximal auf die Flächen?',
    ziel:      'Maximaler Stromertrag / Klimabeitrag',
    herleitung:'Gesamtes verfügbares PV-Potenzial aller Anlagen — bewusst ohne Speicher, um das reine Dachpotenzial zu zeigen.',
    bewertung: 'Maximaler Klimabeitrag und Ertrag, erfordert aber die höchste Netzanschluss-Infrastruktur; ohne Speicher wird ein Teil am Einspeiselimit abgeregelt.',
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// MODUL-STATE
// ══════════════════════════════════════════════════════════════════════════════
window._pvAnalyse = window._pvAnalyse || {
  infraKonfig: null,          // überschriebene Infra-Kosten (null = Defaults)
  mehrkosten: { investEUR: 0, label: '', jaehrlichEUR: 0 }, // Mehrkostenprinzip
  erzNetzAktiv: false,
  erzNetz: { laengeM: 0, preisPrM: 250, typKabel: 'NS', schutzEUR: 5000 },
  skKVA: 0,            // Kurzschlussleistung S_k″ am NAP (kVA); 0 = unbekannt → nur Leistungskriterium
  uBudgetPct: 3,       // zulässige Spannungsanhebung durch Einspeisung (VDE-AR-N 4105: 3 % NS, 4110: 2 % MS)
  spotPreise: null,           // Float32Array[N] in ct/kWh (null = nicht geladen)
  spotJahr: null,
  spotStatus: 'nicht geladen',
  napMaxEinspKw: 0,           // 0 = unbegrenzt
  napMaxBezugKw: 0,           // 0 = unbegrenzt
  pvMaxKwpOverride: 0,        // 0 = aus Assets berechnen
  demandMode: 'basis',        // 'basis' = nur Strom-Lastgang | 'gesamt' = + WP + SK | 'endausbau' = NAP-Endausbau-Lastgang
  endausbauJahr: new Date().getFullYear() + 15, // Zieljahr für Endausbau-Lastgang
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

/**
 * Gibt den Lastgang zurück:
 * - 'basis': nur hochgeladener Strom-Lastgang
 * - 'gesamt': Strom + Wärmepumpen (_wpElHourly) + Stromkessel (_skElHourly)
 *
 * Bei 15-min-Basislast werden stündliche WP/SK-Werte 4× wiederholt (kW = gleich pro 15-min-Step).
 */
function pvGetDemandH() {
  const mode  = window._pvAnalyse?.demandMode || 'basis';
  const b15   = window.elQuartierH15;
  const b1h   = window.elQuartierH;
  const wpH   = window._wpElHourly;
  const skH   = window._skElHourly;

  // Endausbau-Modus: gemessener Lastgang + NAP-Maßnahmen (Neubau/Abriss) bis Zieljahr
  if (mode === 'endausbau') {
    const jahr = window._pvAnalyse?.endausbauJahr;
    const result = window.napGetEndausbauLastgang?.(jahr);
    if (result?.arr) return result.arr;
    return b15 || b1h || null; // Fallback auf Basis, falls keine NAP-Messung/Maßnahmen vorhanden
  }

  // Im Basis-Modus oder wenn keine Zusatzdaten vorhanden: nativen Lastgang zurückgeben
  if (mode === 'basis' || (!wpH && !skH)) return b15 || b1h || null;

  // Gesamt-Modus: Basis + WP + SK addieren
  if (b15) {
    const N = b15.length;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const h = Math.floor(i / 4);
      out[i] = b15[i]
        + (wpH && h < wpH.length ? wpH[h] : 0)
        + (skH && h < skH.length ? skH[h] : 0);
    }
    return out;
  }
  if (b1h) {
    const N = b1h.length;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = b1h[i]
        + (wpH && i < wpH.length ? wpH[i] : 0)
        + (skH && i < skH.length ? skH[i] : 0);
    }
    return out;
  }
  return null;
}

/** Jahressumme eines Float32Array in MWh (für Statusanzeige) */
function _pvArrMwh(arr) {
  if (!arr) return 0;
  let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];
  // arr enthält kW-Werte (kWh/h stündlich); Zeitschritt = 1h → MWh = sum/1000
  // Bei 15-min-Daten: sum × 0.25 / 1000, aber wpH/skH sind stets stündlich
  return s / 1000;
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
  // null = kein Limit; 0 = tatsächlich 0 kW; positiv = Limit in kW
  const maxEinsp  = (napParams.maxEinspeisKw != null) ? napParams.maxEinspeisKw : Infinity;
  const maxBezug  = (napParams.maxBezugKw    != null) ? napParams.maxBezugKw    : Infinity;
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
  let maxEinspeiseKw = 0, einspeiseStunden = 0;  // Rückspeise-Spitze & -Dauer am NAP
  const batSocArr = new Float32Array(N);
  const deckungArr = new Float32Array(N);  // Anteil des Bedarfs gedeckt durch PV+Batterie (0..1), je Zeitschritt

  for (let t = 0; t < N; t++) {
    const dem    = demandH[t];
    const pvGen  = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const spot   = (spotH && t < spotH.length) ? spotH[t] : avgSpot;

    // 1. Direkter Eigenverbrauch
    const dsc = Math.min(pvGen, dem);
    let rDem  = dem  - dsc;
    let rGen  = pvGen - dsc;

    // spot-dyn: Bei negativen/null Börsenpreisen Einspeisung sperren (effektives Limit = 0)
    const effMaxEinsp = (batStrategie === 'spot-dyn' && spot <= 0) ? 0 : maxEinsp;

    // 2. Einspeisebegrenzung: Überschuss über effektives NAP-Limit → Batterie zwingen
    if (rGen > effMaxEinsp && batKwh > 0) {
      const mustStore = rGen - effMaxEinsp;
      const cPow  = Math.min(mustStore, batLeistKw);
      const cEkwh = Math.min(cPow * dt, (batKwh - soc) / ETA);
      soc += cEkwh * ETA; batVerlustMwh += cEkwh * (1 - ETA);
      rGen -= cEkwh / dt;
    }
    // Abregelung: was über effektives Limit bleibt → Curtailment
    if (rGen > effMaxEinsp) {
      curtailMwh += (rGen - effMaxEinsp) * dt / 1000;
      rGen = effMaxEinsp;
    }

    // 3. Batterie laden für EIGENVERBRAUCH (restlicher Überschuss unterhalb Limit).
    //    Gilt für EV, Spot UND spot-dyn: der vermiedene Netzbezug (~30 ct) ist der
    //    dominante Nutzen — höher als die Einspeisung (~8 ct). Daher hat Speichern
    //    für die spätere Last Vorrang vor dem Einspeisen; erst der Rest wird gespeist.
    if (rGen > 0 && batKwh > 0 &&
        (batStrategie === 'ev' || batStrategie === 'spot' || batStrategie === 'spot-dyn')) {
      const cPow  = Math.min(rGen, batLeistKw);
      const cEkwh = Math.min(cPow * dt, (batKwh - soc) / ETA);
      soc  += cEkwh * ETA; batVerlustMwh += cEkwh * (1 - ETA);
      rGen -= cEkwh / dt;
    }

    // 4. Batterie entladen für Eigenverbrauch — EV, Spot und spot-dyn
    if (rDem > 0 && batKwh > 0 && soc > 0 &&
        (batStrategie === 'ev' || batStrategie === 'spot' || batStrategie === 'spot-dyn')) {
      const dPow  = Math.min(rDem, batLeistKw);
      const dEkwh = Math.min(dPow * dt, soc * ETA);
      soc  -= dEkwh / ETA; batVerlustMwh += (dEkwh / ETA - dEkwh);
      rDem -= dEkwh / dt;
    }

    // Deckungsgrad dieser Stunde (vor Netzbezugs-Kappung in Schritt 6, denn die
    // betrifft nur das KPI "ungedeckter Bedarf", nicht den Autarkiegrad).
    deckungArr[t] = dem > 0 ? Math.max(0, Math.min(1, (dem - rDem) / dem)) : 1;

    // 5a. Spot-Arbitrage ('spot'): Zusatz-Einspeisung wenn Preis ≥ 150% Ø.
    //     SOC-Reserve 15% sichern, damit abends Eigenverbrauch gedeckt bleibt.
    if (batStrategie === 'spot' && rDem === 0 && spot > avgSpot * 1.5) {
      const reserve = batKwh * 0.15;
      if (soc > reserve) {
        const dPow  = Math.min(batLeistKw, maxEinsp - rGen);
        if (dPow > 0) {
          const dEkwh = Math.min(dPow * dt, (soc - reserve) * ETA);
          soc  -= dEkwh / ETA;
          rGen += dEkwh / dt;
        }
      }
    }
    // 5b. spot-dyn — Abregelungs-/Arbitrage-Entladung mit dem REST:
    //     Nur eine fast volle Batterie (>85% SOC) wird bei positivem Preis bis auf
    //     eine Eigenverbrauchs-Reserve (50%) zur Einspeisung entladen. Das schafft
    //     Platz für das nächste Niedrigpreis-/Überlauf-Fenster (Abregelungsvermeidung),
    //     ohne den Eigenverbrauchs-Vorrat anzutasten. Greift erst nahe Vollladung →
    //     kein Lade-/Entlade-Wash mit Schritt 3.
    if (batStrategie === 'spot-dyn' && rDem === 0 && spot > 0 && soc > batKwh * 0.85) {
      const reserve = batKwh * 0.5;
      const dPow    = Math.min(batLeistKw, maxEinsp - rGen);
      if (dPow > 0) {
        const dEkwh = Math.min(dPow * dt, (soc - reserve) * ETA);
        if (dEkwh > 0) {
          soc  -= dEkwh / ETA; batVerlustMwh += (dEkwh / ETA - dEkwh);
          rGen += dEkwh / dt;
        }
      }
    }

    // 6. Netzbezug begrenzen (Überschuss über maxBezug → ungedeckter Bedarf, KPI)
    if (rDem > maxBezug) rDem = maxBezug;

    // Energiebilanz
    const evStep = (dsc + (dem - dsc - rDem));  // kW gedeckt durch Eigen
    eigenMwh     += evStep * dt / 1000;
    einspeiseMwh += rGen   * dt / 1000;
    netzbezugMwh += rDem   * dt / 1000;
    if (rGen > maxEinspeiseKw) maxEinspeiseKw = rGen;     // Rückspeise-Spitze (kW)
    if (rGen > 0.5)            einspeiseStunden += dt;     // Rückspeise-Dauer (h/a)
    // Spot-gewichteter Einspeisung-Erlös (ct/kWh → €: × dt/1000 × /100)
    if (spotH && t < spotH.length) {
      spotRevenue += rGen * dt / 1000 * spotH[t] / 100;
    }
    batSocArr[t] = soc;
  }

  // batVerlustMwh wird oben in kWh akkumuliert → hier auf MWh normieren (Konsistenz)
  return { eigenMwh, einspeiseMwh, netzbezugMwh, curtailMwh, batVerlustMwh: batVerlustMwh / 1000,
           maxEinspeiseKw, einspeiseStunden, batSocArr, deckungArr, spotRevenue };
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
function pvOptBat(pvKwp, demandH, pvProfile, napParams, strategie, spotH, params, minBatKwh = 0) {
  const { pStrom, pEinsp, batInvestPerKwh, zins, batLife } = params;
  const annBat = annF(zins, batLife || 15); // Annuitätenfaktor Batterie

  // Suchraum: spot-dyn braucht größeren Puffer (muss neg. Preis-Fenster von mehreren Stunden puffern)
  const maxBat = strategie === 'spot-dyn'
    ? Math.min(pvKwp * 8, 30000)   // spot-dyn: bis 8× kWp oder 30 MWh
    : Math.min(pvKwp * 2, 10000);  // EV/Spot:  bis 2× kWp oder 10 MWh
  const baseSteps = strategie === 'spot-dyn'
    ? [0, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000]
    : [0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
  const steps  = baseSteps.filter(v => v <= maxBat + 1);
  if (!steps.includes(Math.round(maxBat))) steps.push(Math.round(maxBat));

  // Für Spot/spot-dyn: Starte Suche ab minBatKwh (EV-Basisgröße), sodass Spot nie kleiner als EV.
  const baseSpotH = (strategie === 'spot' || strategie === 'spot-dyn') ? spotH : null;
  let prevSim  = pvNapSim(pvKwp, minBatKwh, demandH, pvProfile, napParams,
                           minBatKwh > 0 ? strategie : 'none', minBatKwh > 0 ? baseSpotH : null);
  let prevBat  = minBatKwh, prevAnnKost = 0;
  let bestBat  = minBatKwh;

  for (let i = 1; i < steps.length; i++) {
    const batKwh = steps[i];
    if (batKwh <= minBatKwh) continue; // schon in der Basis enthalten
    const sim    = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strategie, spotH);

    // Marginaler Nutzen — strategie-abhängig
    const deltaEigen = (sim.eigenMwh - prevSim.eigenMwh) * pStrom * 10;        // €/a EV-Ersparnis
    const deltaCurt  = (prevSim.curtailMwh - sim.curtailMwh) * pEinsp * 10;    // €/a vermiedene Abregelung
    let marginalNutzen;
    if (strategie === 'spot' && spotH) {
      // Spot: Nutzen = ΔSpot-Erlös (Arbitrage) + ΔEigenverbrauch + vermiedene Abregelung
      const deltaSpot = (sim.spotRevenue - (prevSim.spotRevenue || 0));
      marginalNutzen = deltaSpot + deltaEigen + deltaCurt;
    } else if (strategie === 'spot-dyn' && spotH) {
      // spot-dyn: Spot-Erlös umfasst schon die vermiedene Abregelung → kein deltaCurt extra
      const deltaSpot = (sim.spotRevenue - (prevSim.spotRevenue || 0));
      marginalNutzen = deltaSpot + deltaEigen;
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

/**
 * EIGENVERBRAUCHS-OPTIMUM (quotenbasiert) — größte PV-Leistung, bei der die
 * Eigenverbrauchsquote noch ≥ minQuote bleibt (fast alles wird selbst verbraucht).
 * Bewusst ohne Batterie gerechnet → klar abgegrenzt von der wirtschaftlichen Optimierung.
 */
function pvCalcEvQuoteKwp(demandH, pvProfile, napParams, minQuote = 90) {
  const spez   = pvGetSpez();
  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  let best = 10;
  for (let kwp = 10; kwp <= maxKwp; kwp += (kwp < 100 ? 10 : kwp < 500 ? 25 : 50)) {
    const sim = pvNapSim(kwp, 0, demandH, pvProfile, napParams, 'none', null);
    const ert = kwp * spez / 1000;
    const q   = ert > 0 ? sim.eigenMwh / ert * 100 : 0;
    if (q < minQuote) break;
    best = kwp;
  }
  return best;
}

/** Gesamter Jahres-Strombedarf des aktiven Lastgangs in MWh/a. */
function pvGesamtBedarfMwh() {
  const d = pvGetDemandH();
  if (!d) return 0;
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i];
  return s * pvGetDt() / 1000;
}

/**
 * WIRTSCHAFTLICHES OPTIMUM — gemeinsame (PV × Batterie)-Optimierung.
 *
 * Statt PV auf "max" zu fixieren und nur die Batterie zu suchen, wird die
 * PV-Größe in Stufen durchlaufen; je Stufe wird die wirtschaftlich beste
 * Batterie via pvOptBat ermittelt und die Kombination mit dem HÖCHSTEN
 * jährlichen Netto-Überschuss (gesamtErloes − gesamtJk) gewählt.
 *
 * Hinweis: Selektiert wird über den Netto-Jahresüberschuss, NICHT über die
 * statische Amortisationsquote — letztere bevorzugt fälschlich Kleinstanlagen.
 * Die Amortisation bleibt aber als KPI in der Tabelle erhalten.
 *
 * @returns {{ pvKwp:number, batKwh:number, strategie:string }}
 */
function pvCalcWirtschaftOptimum(demandH, pvProfile, napParams, params, spotH, maxKwp) {
  const spez = pvGetSpez();
  const strat = spotH ? 'spot-dyn' : 'ev';

  // PV-Stützstellen: fein bei kleinen Anlagen, gröber bei großen
  const steps = [];
  for (let k = 50; k <= maxKwp; k += (k < 200 ? 25 : k < 1000 ? 100 : 250)) steps.push(k);
  if (steps.length === 0 || steps[steps.length - 1] !== Math.round(maxKwp)) steps.push(Math.round(maxKwp));

  let best = null;
  for (const kwp of steps) {
    if (kwp <= 0) continue;
    const bat       = pvOptBat(kwp, demandH, pvProfile, napParams, strat, spotH, params);
    const ertragMwh = kwp * spez / 1000;
    const useStrat  = bat > 0 ? strat : 'none';
    const sim       = pvNapSim(kwp, bat, demandH, pvProfile, napParams, useStrat, spotH);
    const wirt      = pvWirtschaft(kwp, bat, sim, ertragMwh, params, useStrat);
    // Ziel: maximaler Jahres-Netto-Überschuss = minimales nettoJk (negativ = Gewinn)
    const score = wirt.nettoJk;
    if (!best || score < best.score) best = { pvKwp: kwp, batKwh: bat, strategie: useStrat, score };
  }
  return best || { pvKwp: 99, batKwh: 0, strategie: 'none' };
}

/**
 * AUTARKIE-OPTIMUM (technisch) — volle PV, Batterie bis zur Autarkie-Sättigung.
 *
 * Batterie wird in Stufen vergrößert, bis der marginale Autarkie-Zuwachs unter
 * 0,3 %-Punkte je zusätzlichen 1.000 kWh fällt (technische Sättigung) oder die
 * Obergrenze erreicht ist. Strategie 'ev' maximiert den Eigenverbrauch.
 *
 * @returns {{ pvKwp:number, batKwh:number, strategie:string }}
 */
function pvCalcAutarkieMax(maxKwp, demandH, pvProfile, napParams) {
  const bedarfMwh = pvGesamtBedarfMwh();
  const autOf = (sim) => bedarfMwh > 0 ? (1 - sim.netzbezugMwh / bedarfMwh) * 100 : 0;

  const cap   = Math.min(maxKwp * 10, 50000);
  const steps = [0, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000]
                  .filter(b => b <= cap + 1);

  let bestBat = 0;
  let prevAut = autOf(pvNapSim(maxKwp, 0, demandH, pvProfile, napParams, 'none', null));
  let prevBat = 0;

  for (let i = 1; i < steps.length; i++) {
    const bat = steps[i];
    const sim = pvNapSim(maxKwp, bat, demandH, pvProfile, napParams, 'ev', null);
    const aut = autOf(sim);
    const marg = (aut - prevAut) / ((bat - prevBat) / 1000); // %-Punkte je 1.000 kWh
    if (marg < 0.3) break;        // Sättigung erreicht
    bestBat = bat; prevAut = aut; prevBat = bat;
  }
  return { pvKwp: maxKwp, batKwh: bestBat, strategie: bestBat > 0 ? 'ev' : 'none' };
}

// ══════════════════════════════════════════════════════════════════════════════
// RÜCKSPEISE- & ERZEUGUNGSNETZ-BEURTEILUNG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * RÜCKSPEISE-ANALYSE — physikalisch belastbare Größe für den Erzeugungsnetz-Bedarf.
 *
 * Nicht "Jahres-Erzeugung > Verbrauch" (irreführend), sondern die GLEICHZEITIGE
 * Rückspeiseleistung am NAP: P_res(t) = Erzeugung − Last, die Batterie schert die
 * Spitze. Simuliert OHNE Einspeiselimit (reine 'ev'-Eigenverbrauchslogik), um die
 * tatsächlich benötigte Anschlusskapazität zu ermitteln (nicht die künstlich
 * gekappte). Arbitrage-Entladung ins Netz bleibt außen vor (würde die Spitze
 * scheinbar erhöhen) → konservative, ehrliche Kapazitätsaussage.
 *
 * @returns {{ maxKw:number, stunden:number, energieMwh:number }}
 */
function pvRueckAnalyse(pvKwp, batKwh, demandH, pvProfile) {
  const strat = batKwh > 0 ? 'ev' : 'none';
  const sim = pvNapSim(pvKwp, batKwh, demandH, pvProfile,
                       { maxEinspeisKw: null, maxBezugKw: null }, strat, null);
  return { maxKw: sim.maxEinspeiseKw, stunden: sim.einspeiseStunden, energieMwh: sim.einspeiseMwh };
}

/**
 * Ampel-Beurteilung des Erzeugungsnetz-/MS-Anschluss-Bedarfs aus der Rückspeisespitze.
 * Das jeweils schärfere von zwei harten Kriterien zählt:
 *  - Spannungsband:  Δu ≈ 100 · P_rück / S_k″  (Screening, cos φ ≈ 1) gegen uBudgetPct.
 *  - Anschlusskapazität: P_rück / vorhandene Einspeise-Anschlussleistung (NAP-Limit).
 *
 * @returns {{ ampel:'gruen'|'gelb'|'rot'|'na', deltaU:number|null, capRatio:number|null, text:string }}
 */
function pvRueckBewertung(maxKw, skKVA, anschlussKw, uBudgetPct) {
  const deltaU   = skKVA > 0 ? 100 * maxKw / skKVA : null;
  const capRatio = (anschlussKw && anschlussKw > 0) ? maxKw / anschlussKw : null;
  if (deltaU == null && capRatio == null) {
    return { ampel: 'na', deltaU, capRatio, text: 'S_k″ oder Anschlussgrenze eingeben' };
  }
  let level = 0;                       // 0 grün · 1 gelb · 2 rot
  const grunde = [];
  if (deltaU != null) {
    if      (deltaU > uBudgetPct)       { level = Math.max(level, 2); grunde.push(`Δu ${deltaU.toFixed(1)} % > ${uBudgetPct} %`); }
    else if (deltaU > uBudgetPct * 2/3) { level = Math.max(level, 1); grunde.push(`Δu ${deltaU.toFixed(1)} %`); }
    else                                  grunde.push(`Δu ${deltaU.toFixed(1)} %`);
  }
  if (capRatio != null) {
    if      (capRatio > 1.0) { level = Math.max(level, 2); grunde.push(`Spitze ${(capRatio*100).toFixed(0)} % > Anschluss`); }
    else if (capRatio > 0.7) { level = Math.max(level, 1); grunde.push(`Spitze ${(capRatio*100).toFixed(0)} % des Anschlusses`); }
  }
  const ampel = level === 2 ? 'rot' : level === 1 ? 'gelb' : 'gruen';
  return { ampel, deltaU, capRatio, text: grunde.join(' · ') };
}

// ══════════════════════════════════════════════════════════════════════════════
// WIRTSCHAFTLICHKEIT
// ══════════════════════════════════════════════════════════════════════════════

function pvWirtschaft(pvKwp, batKwh, simResult, pvErtragMwh, params, strategie) {
  const { pStrom, pEinsp, pvInvestPerKwp, batInvestPerKwh, zins, pvLife, batLife } = params;

  const pvInvest  = pvKwp  * pvInvestPerKwp;
  const batInvest = batKwh * batInvestPerKwh;
  const infra     = pvInfraKosten(pvKwp, pvErtragMwh);

  const annPv  = annF(zins, pvLife  || 20);
  const annBat = annF(zins, batLife || 15);

  const pvJk   = pvInvest  * (annPv  + (OPT_IH.pv  || 0.01));
  const batJk  = batInvest * (annBat + (OPT_IH.bat || 0.01));
  const infJk  = infra.investEUR * annF(zins, 20) + infra.jaehrlichEUR;

  const eigenErsparnis = simResult.eigenMwh * pStrom * 10; // €/a
  // spot/spot-dyn: tatsächliche Markterlöse statt Flatrate-Preis verwenden
  const useSpotRev     = (strategie === 'spot' || strategie === 'spot-dyn') && simResult.spotRevenue;
  const einspeisErloes = useSpotRev
    ? simResult.spotRevenue                      // €/a aus Börsenpreisen
    : simResult.einspeiseMwh * pEinsp * 10;     // €/a Flatrate
  const abregelVerlust = simResult.curtailMwh * pEinsp * 10; // €/a entgangener Erlös

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

/**
 * Findet die Batteriegröße, die Abregelung auf ein Minimum reduziert.
 *
 * Zielschwelle: < 1% der Basis-Abregelung (relativ) ODER < 1 MWh/a (absolut).
 * Wird die Schwelle nicht erreicht, wird trotzdem das beste gefundene Ergebnis
 * zurückgegeben (kein null mehr) — damit erscheint die Variante immer, solange
 * eine Batterie die Abregelung spürbar senkt.
 *
 * Hintergrund: Bei großen Anlagen mit engem Einspeiselimit (z.B. 3.900 kWp / 500 kW)
 * kann echte Null-Abregelung physikalisch unmöglich sein, weil Sommer-Serien von
 * 10+ Sonnentagen selbst eine 100-MWh-Batterie füllen. Dann zeigt die Variante die
 * bestmögliche Reduktion und wird als "min. Abr." statt "0-Abr." beschriftet.
 *
 * @returns {{ batKwh: number, curtailMwh: number, isZero: boolean }}
 */
/**
 * spotH optional: wenn übergeben, wird Strategie 'spot-dyn' verwendet.
 * spot-dyn entlädt die Batterie aktiv bei positiven Börsenpreisen → viel effizientere
 * Abregelungsreduktion als 'ev' (Batterie füllt sich nicht dauerhaft im Sommer).
 */
function pvFindNullAbrBat(pvKwp, demandH, pvProfile, napParams, spotH) {
  const strategie = spotH ? 'spot-dyn' : 'ev';

  // Schnell-Check: gibt es überhaupt nennenswerte Abregelung ohne Batterie?
  const simBase = pvNapSim(pvKwp, 0, demandH, pvProfile, napParams, 'none', null);
  if (simBase.curtailMwh < 1.0) return { batKwh: 0, curtailMwh: simBase.curtailMwh, isZero: true };

  // Zielschwelle: 1% der Basis-Abregelung, mindestens 1 MWh
  const threshold = Math.max(1.0, simBase.curtailMwh * 0.01);

  // Suchraum: steigende Stufen bis 100.000 kWh
  const steps = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000,
                 30000, 50000, 75000, 100000];

  let bestBat = 0, bestCurtail = simBase.curtailMwh;
  for (const batKwh of steps) {
    const sim = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strategie, spotH || null);
    if (sim.curtailMwh < bestCurtail) {
      bestBat     = batKwh;
      bestCurtail = sim.curtailMwh;
    }
    if (bestCurtail <= threshold) break; // Zielschwelle erreicht → fertig
  }
  return {
    batKwh:     bestBat,
    curtailMwh: bestCurtail,
    isZero:     bestCurtail <= threshold,
  };
}

export function pvBerechneAlle() {
  const state    = window._pvAnalyse;
  const demandH  = pvGetDemandH();
  if (!demandH) {
    alert('Kein Stromlastgang vorhanden. Bitte zuerst in ⚡ Strom-Grundlagen hochladen.');
    return;
  }

  const pvProfile  = pvGetPvProfile();
  const maxKwp     = pvGetMaxKwpFromAssets();
  // NAP-Grenzen (null = kein Limit, Zahl = Limit in kW).
  // Priorität: PVA-Panel-Feld (was der Nutzer HIER editiert) → Strom-Grundlagen-DOM →
  // window-Global → State. In den PVA-Feldern bedeutet 0 = kein Limit (null).
  // Wichtig: das PVA-Feld zuerst lesen, sonst überschreibt das beim ersten Lauf
  // gesetzte window-Global spätere Änderungen der Einspeisegrenze (Recalc-Bug).
  function _readNap(pvaId, stromId, winGlobal, stateVal) {
    const pvaEl = document.getElementById(pvaId);
    if (pvaEl && pvaEl.value !== '') { const v = parseFloat(pvaEl.value) || 0; return v > 0 ? v : null; }
    const stromEl = document.getElementById(stromId);
    if (stromEl && stromEl.value !== '') { const v = parseFloat(stromEl.value); return v > 0 ? v : null; }
    if (winGlobal != null) return winGlobal;
    return stateVal > 0 ? stateVal : null;
  }
  const _napEinsp = _readNap('pva-nap-einsp', 'strom-nap-einsp-kw', window.elNapMaxEinspKw, state.napMaxEinspKw);
  const _napBezug = _readNap('pva-nap-bezug', 'strom-nap-bezug-kw', window.elNapMaxBezugKw, state.napMaxBezugKw);
  // Sync window-Globals damit napAktiv-Check in renderVariantenTabelle korrekt ist
  window.elNapMaxEinspKw = _napEinsp;
  window.elNapMaxBezugKw = _napBezug;
  const napParams  = { maxEinspeisKw: _napEinsp, maxBezugKw: _napBezug };
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

  const spez = pvGetSpez();

  // ── Hilfsfunktion: eine kanonische Variante berechnen und pushen ──
  function berechne(id, pvKwp, batKwh, strategie, labelSuffix) {
    if (pvKwp <= 0) return;
    const info = PV_VARIANTEN_INFO[id];
    const ertragMwh = pvKwp * spez / 1000;
    const sim  = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strategie, spotH);
    const wirt = pvWirtschaft(pvKwp, batKwh, sim, ertragMwh, params, strategie);
    ergebnisse.push({
      id, label: info.label + (labelSuffix || ''), farbe: info.farbe, icon: info.icon, info,
      pvKwp, batKwh, strategie, ertragMwh, sim, wirt,
    });
  }

  // ═══ 1) MINIMAL — schwellen-optimiert, knapp unter 100 kWp ═══════════════════
  berechne('minimal', Math.min(99, maxKwp || 99), 0, 'none');

  // ═══ 2) EIGENVERBRAUCHS-OPTIMIERT — größte PV mit ≥90 % Eigenverbrauch + EV-Batterie
  const evKwp = pvCalcEvQuoteKwp(demandH, pvProfile, napParams, 90);
  const evBat = pvOptBat(evKwp, demandH, pvProfile, napParams, 'ev', null, params);
  berechne('ev-opt', evKwp, evBat, evBat > 0 ? 'ev' : 'none');

  // ═══ 3) WIRTSCHAFTLICH OPTIMIERT — gemeinsame (PV × Batterie)-Optimierung ═════
  if (maxKwp > 0) {
    const wo = pvCalcWirtschaftOptimum(demandH, pvProfile, napParams, params, spotH, maxKwp);
    berechne('wirt-opt', wo.pvKwp, wo.batKwh, wo.strategie);
  }

  // ═══ 4) AUTARKIE-OPTIMIERT — volle PV + Batterie bis zur Sättigung ═══════════
  if (maxKwp > 0) {
    const ao = pvCalcAutarkieMax(maxKwp, demandH, pvProfile, napParams);
    berechne('autarkie', ao.pvKwp, ao.batKwh, ao.strategie);
  }

  // ═══ 5) MAXIMALER PV-AUSBAU — reines Dachpotenzial OHNE Speicher ═════════════
  //     Der für ~0 Abregelung nötige Speicher liegt oft im zweistelligen MWh-Bereich
  //     und ist wirtschaftlich nicht darstellbar — er wird daher NICHT als Auslegung
  //     gebaut (kein €-Mio-Ausreißer in Scatter/Tabelle), sondern nur als Hinweis in
  //     der Lesehilfe gezeigt. Die Abregelung selbst erscheint als KPI.
  if (maxKwp > 0) {
    let nullAbrHinweis = '';
    if (napParams.maxEinspeisKw != null && napParams.maxEinspeisKw > 0) {
      const simNoBat = pvNapSim(maxKwp, 0, demandH, pvProfile, napParams, 'none', null);
      if (simNoBat.curtailMwh > 1) {
        const techAbr = pvFindNullAbrBat(maxKwp, demandH, pvProfile, napParams, spotH);
        if (techAbr.batKwh > 0) {
          nullAbrHinweis = techAbr.isZero
            ? `Für ~0 Abregelung wären ≈ ${(techAbr.batKwh / 1000).toFixed(1)} MWh Speicher nötig — wirtschaftlich nicht darstellbar.`
            : `Selbst ${(techAbr.batKwh / 1000).toFixed(0)} MWh Speicher senken die Abregelung nur auf ${techAbr.curtailMwh.toFixed(0)} MWh/a — Vollnutzung physikalisch nicht erreichbar.`;
        }
      }
    }
    berechne('max-pv', maxKwp, 0, 'none');
    const eMaxPv = ergebnisse[ergebnisse.length - 1];
    if (eMaxPv && nullAbrHinweis) eMaxPv.hinweis = nullAbrHinweis;
  }

  // ── Rückspeise- & Erzeugungsnetz-Beurteilung je Variante ──
  const skKVA      = parseFloat(document.getElementById('pva-sk')?.value) || state.skKVA || 0;
  const uBudgetPct = state.uBudgetPct || 3;
  state.skKVA = skKVA;
  for (const e of ergebnisse) {
    const r   = pvRueckAnalyse(e.pvKwp, e.batKwh, demandH, pvProfile);
    const bew = pvRueckBewertung(r.maxKw, skKVA, _napEinsp, uBudgetPct);
    e.rueck = { ...r, ...bew, anschlussKw: _napEinsp, skKVA, uBudgetPct };
  }

  state.ergebnisse = ergebnisse;
  state.berechnet  = true;
  state.lastParams = params;
  _pvFsArgs = { demandH, pvProfile, napParams, params };
  renderVariantenTabelle(ergebnisse);
  renderMethodik(ergebnisse);
  renderRechenweg(ergebnisse);
  renderOptSurface3D(demandH, pvProfile, napParams, params, ergebnisse);
  renderGrenznutzenChart(demandH, pvProfile, napParams, params, ergebnisse);
  renderEvKurve(demandH, pvProfile, napParams, params, ergebnisse);
  renderBilanzChart(ergebnisse);
  renderScatterChart(ergebnisse);
  renderRueckAmpel(ergebnisse);
  renderEnergieFluss(demandH, pvProfile, napParams, params, ergebnisse);
  renderAutarkieHeatmap(ergebnisse);
  renderSensitivitaet(ergebnisse);
  renderResilienz(ergebnisse);
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
    btn.title = 'PV-Analyse: Varianten- und Wirtschaftlichkeitsvergleich für PV-Anlagen — Eigenverbrauch, Einspeisung, Batterieoptimierung und Netzanschluss-Infrastruktur.';
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

// Wird nach Upload/Löschen des Strom-Lastgangs (auch über den Upload-Button hier im
// PVA-Panel) aufgerufen, damit Status-Zeilen, Buttons usw. aktualisiert werden.
window._pvaRefreshIfVisible = function _pvaRefreshIfVisible() {
  const wrap = document.getElementById('analyse-pva-wrap');
  if (wrap && wrap.style.display !== 'none') _pvInitInWrap(wrap);
};

// Spannungsebene-Auswahl liefert nur einen Richtwert für S_k″ — abhängig vom
// vorgelagerten Netz (Trafo, Leitungslänge), nicht von der Anschlussleistung.
window.pvSpannungsebeneChanged = function pvSpannungsebeneChanged(ebene) {
  const richtwerte = { ns: 500, ms: 10000 };
  const sk = richtwerte[ebene];
  if (sk == null) return;
  const el = document.getElementById('pva-sk');
  if (el) el.value = sk;
  window._pvAnalyse.skKVA = sk;
};

function _pvBuildPanelHtml() {
  return `
<div style="padding:20px 24px;">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:10px;">
    <div>
      <div style="font-size:13px;font-weight:600;color:var(--text);letter-spacing:.10em;text-transform:uppercase;">PV-Ausbauanalyse</div>
      <div style="font-size:9px;color:var(--muted);letter-spacing:.03em;margin-top:2px;">Variantenstudie · Wirtschaftlichkeit · Netzintegration</div>
    </div>
    <button class="btn-secondary" data-click="setViewMode('karte')" style="font-size:11px;">← Zurück zur Karte</button>
  </div>

  <!-- Steuer-Deck: ein großer strukturierter Container statt vieler kleiner Karten -->
  <div class="pva-controls" style="display:flex;flex-direction:column;gap:12px;">

    <!-- Abschnitt 1: Stromlast-Basis & Strompreise -->
    ${(() => {
      const mode   = window._pvAnalyse.demandMode || 'basis';
      const hasBase = !!(window.elQuartierH15 || window.elQuartierH);
      const hasWP  = !!(window._wpElHourly || window._skElHourly);

      const baseInfo = (() => {
        const a = window.elQuartierH15 || window.elQuartierH;
        if (!a) return null;
        let s = 0; for (let i = 0; i < a.length; i++) s += a[i];
        const mwh = (s * (a.length > 9000 ? 0.25 : 1) / 1000).toFixed(0);
        const filename = window.elQuartierFilename;
        const resLbl = window.elQuartierResolution === 15
          ? `15-min · ${a.length.toLocaleString('de-DE')} Werte`
          : `stündlich · ${a.length.toLocaleString('de-DE')} Werte`;
        return { mwh, filename, resLbl };
      })();
      const wpMwh = _pvArrMwh(window._wpElHourly).toFixed(0);
      const skMwh = _pvArrMwh(window._skElHourly).toFixed(0);

      const btnStyle = (active) =>
        `flex:1;padding:4px 6px;border-radius:3px;cursor:pointer;font-size:9px;font-weight:600;border:1px solid var(--border);` +
        (active ? 'background:#fdd835;color:#000;' : 'background:var(--surface);color:var(--text);');

      // Planungsjahr (Endausbau-Zieljahr) als Slider; Vorschau zeigt Anzahl Maßnahmen bis Zieljahr
      const curYear = globalYear || new Date().getFullYear();
      const endausbauJahr = window._pvAnalyse.endausbauJahr || (curYear + 15);
      const hasNapMessung = !!window.napHasMeasuredData?.();
      const endausbauPreview = hasNapMessung ? window.napGetEndausbauLastgang?.(endausbauJahr) : null;

      const endausbauZeile = mode === 'endausbau'
        ? (endausbauPreview
            ? `<div style="font-size:8px;color:var(--muted);line-height:1.6;margin-top:4px;">Endausbau ${endausbauPreview.jahr}: <b style="color:var(--text)">${endausbauPreview.nNeubau} Neubau · ${endausbauPreview.nAbriss} Abriss</b></div>`
            : `<div style="font-size:8px;color:#ef9a9a;line-height:1.6;margin-top:4px;">Keine NAP-Messung/Maßnahmen → Fallback auf Strom-Lastgang</div>`)
        : '';

      const spotInfo = window.elSpotPreiseH
        ? `${window.elSpotPreiseFilename || '?'} · Ø ${(window.elSpotPreiseH.reduce((s,v)=>s+v,0)/window.elSpotPreiseH.length).toFixed(1)} ct/kWh · ${window.elSpotPreiseH.length.toLocaleString('de-DE')} Werte`
        : null;

      return `
      <div style="background:var(--surface2);border-radius:7px;padding:12px 14px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
          Stromlast-Basis &amp; Strompreise
          <span class="htip" data-tip="Welche Lasten werden für die PV-Simulation verwendet?&#10;· Nur Strom: hochgeladener Quartierlastgang&#10;· + Wärmepumpen: addiert WP- &amp; Stromkessel-Strom aus Wärmesimulation&#10;· Endausbau: NAP-Messung + Neubau-/Abriss-Maßnahmen aus der NAP-Analyse bis zum Planungsjahr">?</span>
        </div>
        <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px;">

          <!-- Lastgang-Upload & Modus -->
          <div>
            <div id="pva-strom-upload-area" data-click="document.getElementById('pva-strom-file-input').click()"
              style="border:1px dashed var(--border);border-radius:6px;padding:7px 10px;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;gap:8px;transition:.15s;"
              onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
              <span style="font-size:14px;">📂</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:9px;color:var(--muted);">Strom-Lastgang CSV hochladen — 15-min oder Stunden (kW)</div>
                <div style="font-size:9px;margin-top:2px;color:${hasBase?'var(--text)':'#ef9a9a'};">
                  ${hasBase
                    ? `${baseInfo.filename ? baseInfo.filename + ' · ' : ''}${baseInfo.mwh} MWh/a · ${baseInfo.resLbl}`
                    : 'nicht geladen'}
                </div>
              </div>
            </div>
            <input type="file" id="pva-strom-file-input" accept=".csv,.txt" style="display:none;" data-change="stromFileSelected(this.files[0])"/>

            <div style="display:flex;gap:4px;margin-bottom:6px;">
              <button id="pva-dm-basis" data-pva-dm="basis" style="${btnStyle(mode==='basis')}">Nur Strom</button>
              <button id="pva-dm-gesamt" data-pva-dm="gesamt"
                style="${btnStyle(mode==='gesamt')}${!hasWP ? 'opacity:0.4;cursor:default;' : ''}"
                ${!hasWP ? 'disabled' : ''}>+ Wärmepumpen</button>
              <button id="pva-dm-endausbau" data-pva-dm="endausbau"
                style="${btnStyle(mode==='endausbau')}${!hasNapMessung ? 'opacity:0.4;cursor:default;' : ''}"
                ${!hasNapMessung ? 'disabled' : ''}>Endausbau</button>
            </div>

            <div style="display:flex;align-items:center;gap:8px;${mode==='endausbau'?'':'opacity:0.5;'}">
              <span style="font-size:9px;color:var(--muted);white-space:nowrap;">Planungsjahr:</span>
              <input id="pva-endausbau-jahr" type="range" value="${endausbauJahr}" min="${curYear}" max="2060" step="1"
                style="flex:1;accent-color:#fdd835;"
                ${mode==='endausbau' ? '' : 'disabled'}
                data-input="document.getElementById('pva-endausbau-jahr-val').textContent=this.value;window._pvAnalyse.endausbauJahr=parseInt(this.value)||window._pvAnalyse.endausbauJahr;window._pvAnalyse.berechnet=false;"/>
              <span id="pva-endausbau-jahr-val" style="font-size:10px;color:var(--text);font-family:'DM Mono',monospace;min-width:34px;text-align:right;">${endausbauJahr}</span>
            </div>

            <div style="font-size:8px;color:var(--muted);line-height:1.6;margin-top:6px;">
              ${hasWP
                ? `Wärmepumpen: <b style="color:var(--text)">${wpMwh} MWh/a</b>` +
                  (window._skElHourly ? ` · Stromkessel: <b style="color:var(--text)">${skMwh} MWh/a</b>` : '')
                : `<span style="color:#607d8b;">WP / SK: — (Wärmesimulation ausführen)</span>`}
            </div>
            ${endausbauZeile}
          </div>

          <!-- Spot-Preise & Strompreise -->
          <div>
            <div id="pva-spot-upload-area" data-click="document.getElementById('pva-spot-file-input').click()"
              style="border:1px dashed var(--border);border-radius:6px;padding:7px 10px;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;gap:8px;transition:.15s;"
              onmouseenter="this.style.borderColor='#ab47bc'" onmouseleave="this.style.borderColor='var(--border)'">
              <span style="font-size:14px;">💹</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:9px;color:var(--muted);">Spot-Preise CSV (EPEX DE, SMARD/ENTSO-E)</div>
                <div id="pva-spot-status" style="font-size:9px;margin-top:2px;color:${spotInfo ? '#ab47bc' : 'var(--muted)'};">
                  ${spotInfo || 'nicht geladen'}
                </div>
              </div>
            </div>
            <input type="file" id="pva-spot-file-input" accept=".csv,.txt" style="display:none;" data-change="spotPreisFileSelected(this.files[0])"/>
            <div style="font-size:8px;color:#607d8b;">Wenn vorhanden, rechnen 'Wirtschaftlich optimiert' und 'Max PV' mit Börsenerlösen statt fester Einspeisevergütung.</div>

            <div style="display:flex;flex-direction:column;gap:5px;font-size:10px;margin-top:10px;">
              ${_pvWirtInput('pva-p-strom', 'Strombezugspreis (ct/kWh)', 30)}
              ${_pvWirtInput('pva-p-einsp', 'Einspeisevergütung (ct/kWh)', 8)}
            </div>
          </div>

        </div>
      </div>`;
    })()}

    <!-- Abschnitt 2: NAP-Parameter & PV-Parameter -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

      <!-- NAP-Parameter -->
      <div style="background:var(--surface2);border-radius:7px;padding:12px 14px;border:1px solid var(--border);">
        <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
          Netzanschlusspunkt (NAP)
          <span class="htip" data-tip="Grenzen am Netzanschlusspunkt. 0 = unbegrenzt. Einspeisebegrenzung aktiviert Abregelungs-KPI und erzwingt Batterie-Pufferung. Verknüpft mit den NAP-Grenzen in ⚡ Strom-Grundlagen.">?</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;">
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Max. Einspeisung (kW)</div>
            <input id="pva-nap-einsp" type="number" value="0" min="0" step="10"
              style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
              data-change="window._pvAnalyse.napMaxEinspKw=parseFloat(this.value)||0;window.elNapMaxEinspKw=window._pvAnalyse.napMaxEinspKw||null;(document.getElementById('strom-nap-einsp-kw')||{}).value=this.value"
              title="0 = kein Limit · verknüpft mit ⚡ Strom-Grundlagen"/>
          </div>
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Max. Bezug (kW)</div>
            <input id="pva-nap-bezug" type="number" value="0" min="0" step="10"
              style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
              data-change="window._pvAnalyse.napMaxBezugKw=parseFloat(this.value)||0;window.elNapMaxBezugKw=window._pvAnalyse.napMaxBezugKw||null;(document.getElementById('strom-nap-bezug-kw')||{}).value=this.value"
              title="0 = kein Limit · verknüpft mit ⚡ Strom-Grundlagen"/>
          </div>
        </div>
        <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
          <div style="font-size:9px;font-weight:600;color:var(--text);margin-bottom:6px;">
            Netzstärke (für Rückspeise-Bewertung)
            <span class="htip" data-tip="Kurzschlussleistung S_k″ am NAP (aus VNB-Netzauskunft). Damit wird die Spannungsanhebung Δu ≈ 100·P_rückspeise/S_k″ je Variante abgeschätzt (VDE-AR-N 4105: 3 % Budget). 0 = unbekannt → nur das Leistungskriterium (Spitze vs. Max. Einspeisung) wird genutzt.">?</span>
          </div>
          <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Spannungsebene (Richtwert für S_k″)</div>
          <select id="pva-spannungsebene"
            style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;margin-bottom:6px;"
            data-change="pvSpannungsebeneChanged(this.value)">
            <option value="">– wählen (nur Richtwert) –</option>
            <option value="ns">Niederspannung NS (0,4 kV) — ~500 kVA</option>
            <option value="ms">Mittelspannung MS (10/20 kV) — ~10.000 kVA</option>
          </select>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;">
            <div>
              <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">S_k″ (kVA)</div>
              <input id="pva-sk" type="number" value="0" min="0" step="100"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
                data-change="window._pvAnalyse.skKVA=parseFloat(this.value)||0"
                title="Kurzschlussleistung am NAP; 0 = unbekannt"/>
            </div>
            <div>
              <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Δu-Budget (%)</div>
              <input id="pva-ubudget" type="number" value="3" min="1" max="10" step="0.5"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
                data-change="window._pvAnalyse.uBudgetPct=parseFloat(this.value)||3"
                title="Zulässige Spannungsanhebung: 3 % NS (4105), 2 % MS (4110)"/>
            </div>
          </div>
          <div style="font-size:8px;color:#607d8b;margin-top:4px;">S_k″ hängt vom vorgelagerten Netz (Trafo, Leitungslänge) ab, nicht von der eigenen Anschlussleistung — die Spannungsebene liefert nur einen groben Richtwert. Bei VNB-Netzauskunft bitte überschreiben.</div>
        </div>
      </div>

      <!-- PV-Parameter -->
      <div style="background:var(--surface2);border-radius:7px;padding:12px 14px;border:1px solid var(--border);">
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

    </div>

    <!-- Abschnitt 3: Infrastruktur -->
    <div style="background:var(--surface2);border-radius:7px;padding:12px 14px;border:1px solid var(--border);">
      <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
        Infrastrukturkosten
        <span class="htip" data-tip="Netzanschluss und Zusatzkosten je PV-Leistungsstufe — Werte editierbar. Werden automatisch der Variante zugeordnet.">?</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
        <div id="pva-infra-stufen" style="font-size:9px;"></div>

        <div>
          <!-- Erzeugungsnetz -->
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:9px;color:var(--text);margin-bottom:6px;">
            <input type="checkbox" id="pva-erznetz-aktiv"
              data-change="window._pvAnalyse.erzNetzAktiv=this.checked;document.getElementById('pva-erznetz-detail').style.display=this.checked?'grid':'none'"
              style="accent-color:#fdd835;">
            Erzeugungsnetz (dediziert)
          </label>
          <div id="pva-erznetz-detail" style="display:none;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px;">
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
          <!-- Mehrkostenprinzip -->
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
    </div>

    <!-- Abschnitt 4: Wirtschaftsparameter -->
    <div style="background:var(--surface2);border-radius:7px;padding:12px 14px;border:1px solid var(--border);">
      <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">Wirtschaftsparameter</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:10px;">
        ${_pvWirtInput('pva-pv-invest', 'PV-Invest (€/kWp)', OPT_INVEST_DEFAULT.pv)}
        ${_pvWirtInput('pva-bat-invest','Bat-Invest (€/kWh)', OPT_INVEST_DEFAULT.bat)}
        ${_pvWirtInput('pva-zins',      'Zinssatz (%)', 3.5)}
        ${_pvWirtInput('pva-pv-life',   'PV-Nutzungsdauer (a)', 20)}
        ${_pvWirtInput('pva-bat-life',  'Bat-Nutzungsdauer (a)', 15)}
      </div>
    </div>

  </div>

  <!-- Berechnen: volle Breite -->
  <button class="btn-confirm" id="pva-btn-berechnen"
    style="width:100%;padding:11px;font-size:12px;margin-top:14px;letter-spacing:.04em;"
    data-click="pvBerechneAlle()">
    Varianten berechnen
  </button>

  <!-- ═══ ERGEBNISSE: volle Breite ════════════════════════════════════════ -->
  <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:16px;">

    <!-- Tabelle -->
    <div id="pva-result-tabelle" style="margin-bottom:20px;overflow-x:auto;">
      <div style="color:var(--muted);font-size:10px;text-align:center;padding:40px 0;">
        ${(() => {
          const hasBase = !!(window.elQuartierH15 || window.elQuartierH);
          if (!hasBase) return 'Lastgang hochladen (⚡ Strom-Grundlagen) und dann berechnen.';
          const mode  = window._pvAnalyse.demandMode || 'basis';
          const hasWP = !!(window._wpElHourly || window._skElHourly);
          if (mode === 'gesamt' && hasWP) {
            const wpMwh = _pvArrMwh(window._wpElHourly).toFixed(0);
            const skMwh = _pvArrMwh(window._skElHourly).toFixed(0);
            return `✓ Gesamt-Lastgang aktiv (Strom + WP ${wpMwh} MWh/a + SK ${skMwh} MWh/a) — Varianten berechnen klicken ↓`;
          }
          return '✓ Strom-Lastgang geladen — Varianten berechnen klicken ↓';
        })()}
      </div>
    </div>

    <!-- Lesehilfe: So entstehen die Varianten -->
    <div id="pva-methodik" style="margin-bottom:20px;"></div>

    <!-- Rechenweg: vollständige Herleitung der Wirtschaftlichkeit je Variante -->
    <div id="pva-rechenweg" style="margin-bottom:22px;"></div>

    <!-- Abb. 1 — 3D-Optimierungsfläche: PV × Batterie -->
    <div id="pva-chart-heatmap" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 2 — Ausbau-Grenznutzen -->
    <div id="pva-chart-grenznutzen" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 3 — Eigenverbrauchsquote -->
    <div id="pva-ev-kurve" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 4 — Energiebilanz (gruppierte Vertikalbalken) -->
    <div id="pva-chart-bilanz" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 5 — Investition vs. Amortisation -->
    <div id="pva-chart-scatter" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 6 — Rückspeise- & Erzeugungsnetz-Bewertung -->
    <div id="pva-chart-rueck" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 7 — Interaktives Energieflussdiagramm -->
    <div id="pva-chart-fluss" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 8 — Autarkie-Heatmap (Jahresverlauf) -->
    <div id="pva-chart-autarkie-heatmap" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 9 — Sensitivitätsanalyse (Tornado) -->
    <div id="pva-chart-sensitivitaet" style="margin-bottom:22px;overflow:hidden;"></div>

    <!-- Abb. 10 — Resilienz / Blackout-Analyse -->
    <div id="pva-chart-resilienz" style="margin-bottom:8px;overflow:hidden;"></div>

  </div>
</div>`;
}

// ── Lesehilfe: So entstehen die Varianten & wie man sie bewertet ──────────────

function renderMethodik(varianten) {
  const el = document.getElementById('pva-methodik');
  if (!el || !varianten?.length) return;

  // Nur kanonische Varianten (mit info.frage) in der Lesehilfe zeigen
  const kanon = varianten.filter(v => v.info && v.info.frage);

  const cards = kanon.map(v => {
    const w = v.wirt;
    const kennIcon = (txt, val, col) =>
      `<span style="color:var(--muted);">${txt}</span> <b style="color:${col};">${val}</b>`;
    return `
    <div style="background:var(--surface2);border:1px solid var(--border);border-left:3px solid ${v.farbe};border-radius:7px;padding:10px 12px;">
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:5px;">
        <span style="color:${v.farbe};font-size:13px;">${v.icon}</span>
        <span style="font-size:11px;font-weight:700;color:var(--text);">${v.label}</span>
      </div>
      <div style="font-size:9px;color:${v.farbe};font-weight:600;margin-bottom:6px;">${v.info.frage}</div>
      <div style="font-size:9px;color:var(--muted);line-height:1.55;margin-bottom:5px;">
        <b style="color:#90a4ae;">So entsteht sie:</b> ${v.info.herleitung}
      </div>
      <div style="font-size:9px;color:var(--muted);line-height:1.55;margin-bottom:7px;">
        <b style="color:#90a4ae;">So bewerten:</b> ${v.info.bewertung}${v.hinweis ? ` <span style="color:#ffb74d;">${v.hinweis}</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:9px;border-top:1px solid var(--border);padding-top:6px;">
        ${kennIcon('☀', v.pvKwp.toLocaleString('de-DE') + ' kWp', '#fdd835')}
        ${kennIcon('🔋', v.batKwh > 0 ? v.batKwh.toLocaleString('de-DE') + ' kWh' : '—', '#80deea')}
        ${kennIcon('EV', w.pvEigenQuote.toFixed(0) + ' %', '#a5d6a7')}
        ${kennIcon('Aut', w.autarkie.toFixed(0) + ' %', '#4fc3f7')}
        ${kennIcon('Amort', isFinite(w.amort) ? w.amort.toFixed(1) + ' a' : '> 20 a', '#ce93d8')}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
  <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:8px;">
    Lesehilfe — wie die Varianten entstehen und worauf der jeweilige Stakeholder schaut
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
    ${cards}
  </div>`;
}

// ── Rechenweg: vollständige, nachvollziehbare Wirtschaftlichkeits-Herleitung ───
// Spiegelt Anhang B von docs/PV-Batterie-Auslegung-Grundlagen.md mit Live-Zahlen.

function renderRechenweg(varianten) {
  const el = document.getElementById('pva-rechenweg');
  if (!el || !varianten?.length) return;

  const p = window._pvAnalyse.lastParams;
  if (!p) { el.innerHTML = ''; return; }

  // Auswahl-Variante (Default: wirtschaftlich optimiert)
  const selId = window._pvAnalyse._rechenwegId
    || varianten.find(v => v.id === 'wirt-opt')?.id || varianten[0].id;
  const v = varianten.find(x => x.id === selId) || varianten[0];
  const w = v.wirt, s = v.sim;

  const aPv  = annF(p.zins, p.pvLife  || 20);
  const aBat = annF(p.zins, p.batLife || 15);
  const aInf = annF(p.zins, 20);
  const ihPv = (OPT_IH.pv ?? 0.01), ihBat = (OPT_IH.bat ?? 0.01);
  const genutztMwh = s.eigenMwh + s.einspeiseMwh;
  const lcoe = genutztMwh > 0 ? w.gesamtJk / (genutztMwh * 1000) : 0;
  const useSpot = (v.strategie === 'spot' || v.strategie === 'spot-dyn') && s.spotRevenue;
  const spread  = (p.pStrom - p.pEinsp) / 100;                  // €/kWh
  const beKwh   = (v.batKwh > 0 && spread > 0) ? w.batJk / spread : null;  // Break-even kWh/a

  const e   = n => Math.round(n).toLocaleString('de-DE') + ' €';
  const ea  = n => Math.round(n).toLocaleString('de-DE') + ' €/a';
  const mwh = n => (Math.round(n * 10) / 10).toLocaleString('de-DE') + ' MWh';
  const num = (n, d=2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  // Zeile: Bezeichnung | Formel/Herleitung | Wert
  const row = (label, formel, wert, strong) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:3px 8px 3px 0;color:${strong ? 'var(--text)' : 'var(--muted)'};white-space:nowrap;${strong ? 'font-weight:600;' : ''}">${label}</td>
      <td style="padding:3px 8px;color:#607d8b;font-family:'DM Mono',monospace;font-size:8.5px;">${formel}</td>
      <td style="padding:3px 0;text-align:right;font-family:'DM Mono',monospace;color:${strong ? '#a5d6a7' : 'var(--text)'};${strong ? 'font-weight:700;' : ''}white-space:nowrap;">${wert}</td>
    </tr>`;
  const block = (titel, rows) => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:10px 12px;">
      <div style="font-size:9px;font-weight:700;color:var(--text);letter-spacing:.04em;text-transform:uppercase;margin-bottom:5px;">${titel}</div>
      <table style="width:100%;border-collapse:collapse;font-size:9px;">${rows}</table>
    </div>`;

  const options = varianten.map(x =>
    `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>${x.icon} ${x.label}</option>`).join('');

  const blkEnergie = block('Energie & Kennzahlen (aus Simulation)',
    row('PV-Ertrag',      `${Math.round(v.pvKwp)} kWp · ${pvGetSpez()} kWh/kWp`, mwh(v.ertragMwh)) +
    row('Eigenverbrauch', '→ deckt Bedarf', mwh(s.eigenMwh)) +
    row('Einspeisung',    '→ ins Netz', mwh(s.einspeiseMwh)) +
    row('Abregelung',     '→ verworfen', mwh(s.curtailMwh)) +
    row('Netzbezug',      'Bedarf − Eigenverbrauch', mwh(s.netzbezugMwh)) +
    row('Eigenverbrauchsquote', 'E_eigen / E_pv', num(w.pvEigenQuote, 0) + ' %', true) +
    row('Autarkiegrad',   'E_eigen / E_bedarf', num(w.autarkie, 0) + ' %', true));

  const blkInvest = block('Investition',
    row('PV',    `${Math.round(v.pvKwp)} kWp · ${p.pvInvestPerKwp} €/kWp`, e(w.pvInvest)) +
    (v.batKwh > 0 ? row('Batterie', `${Math.round(v.batKwh)} kWh · ${p.batInvestPerKwh} €/kWh`, e(w.batInvest)) : '') +
    row('Infrastruktur', w.infraLabel, e(w.infraInvest)) +
    row('Summe', 'I_gesamt', e(w.investGes), true));

  const blkJk = block('Jahreskosten (Annuität + Instandhaltung)',
    row('Annuitätenfaktoren', `a(${num(p.zins*100,1)} %, ${p.pvLife}a)=${num(aPv,4)} · a(…,${p.batLife}a)=${num(aBat,4)}`, '') +
    row('PV',    `${e(w.pvInvest)} · (${num(aPv,4)}+${num(ihPv,2)})`, ea(w.pvJk)) +
    (v.batKwh > 0 ? row('Batterie', `${e(w.batInvest)} · (${num(aBat,4)}+${num(ihBat,2)})`, ea(w.batJk)) : '') +
    row('Infrastruktur', `${e(w.infraInvest)} · ${num(aInf,4)}`, ea(w.infJk)) +
    row('Summe', 'JK_gesamt', ea(w.gesamtJk), true));

  const blkErloes = block('Erlöse & Ersparnisse',
    row('Eigenverbrauchs-Ersparnis', `${mwh(s.eigenMwh)} · ${p.pStrom} ct`, ea(w.eigenErsparnis)) +
    row('Einspeiseerlös', useSpot ? `Σ E_einsp(t) · Spotpreis(t)` : `${mwh(s.einspeiseMwh)} · ${p.pEinsp} ct`, ea(w.einspeisErloes)) +
    row('Summe', 'Erlöse_gesamt', ea(w.gesamtErloes), true));

  const blkErgebnis = block('Ergebnis',
    row('Netto-Jahresüberschuss', 'Erlöse − Jahreskosten', ea(-w.nettoJk), true) +
    row('Amortisation (statisch)', 'I_gesamt / Erlöse', isFinite(w.amort) ? num(w.amort, 1) + ' a' : '> 20 a') +
    row('Stromgestehungskosten', `JK_gesamt / ${mwh(genutztMwh)}`, num(lcoe * 100, 1) + ' ct/kWh') +
    (beKwh != null ? row('Batterie-Break-even', `JK_Bat / (${p.pStrom}−${p.pEinsp}) ct`,
      mwh(beKwh / 1000) + '/a · ' + num(beKwh / v.batKwh, 0) + ' Zyklen') : ''));

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Rechenweg — Nachvollziehbarkeit
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">jede Zahl mit Formel; entspricht Anhang B der Grundlagen-Doku</span>
    </span>
    <label style="font-size:9px;color:var(--muted);">Variante:
      <select id="pva-rw-sel" style="margin-left:4px;padding:2px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:9px;">${options}</select>
    </label>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;align-items:start;">
    ${blkEnergie}${blkInvest}${blkJk}${blkErloes}
    <div style="grid-column:1/-1;">${blkErgebnis}</div>
  </div>`;

  const sel = el.querySelector('#pva-rw-sel');
  if (sel) sel.addEventListener('change', ev => {
    window._pvAnalyse._rechenwegId = ev.target.value;
    renderRechenweg(varianten);
  });
}

// ── 2D-Optimierungsfläche: Jahres-Netto-Überschuss über (PV × Batterie) ───────
// Visualisiert die gemeinsame Optimierung als Falschfarben-Heatmap. Für jede
// Kombination aus PV-Leistung und Batteriekapazität wird der jährliche Netto-
// Überschuss simuliert; Optimum (✕) und Lage aller Varianten (○) sind markiert.

/** Viridis-Approximation (perzeptuell gleichabständig) für wissenschaftliche Falschfarben. */
function _viridis(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00,  68,   1,  84], [0.25,  59,  82, 139], [0.50,  33, 144, 141],
    [0.75,  93, 200,  99], [1.00, 253, 231,  37],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      return `rgb(${Math.round(a[1] + f * (b[1] - a[1]))},${Math.round(a[2] + f * (b[2] - a[2]))},${Math.round(a[3] + f * (b[3] - a[3]))})`;
    }
  }
  return 'rgb(253,231,37)';
}

function renderOptHeatmap(demandH, pvProfile, napParams, params, varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-heatmap');
  if (!el) return;

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const spez   = pvGetSpez();
  const spotH  = window.elSpotPreiseH || window._pvAnalyse.spotPreise || null;

  // Achsenbereiche: Batterie-Obergrenze an den Varianten orientieren
  const kanon  = (varianten || []).filter(v => v.info && v.info.frage);
  const varBat = Math.max(0, ...kanon.map(v => v.batKwh));
  const batMax = Math.min(Math.max(1500, Math.round(varBat * 1.3 / 500) * 500), 12000);

  const nx = 14, ny = 11;
  const kwpAt = i => (i / (nx - 1)) * maxKwp;
  const batAt = j => (j / (ny - 1)) * batMax;

  // Zielgröße je Zelle: Jahres-Netto-Überschuss (€/a) = −nettoJk
  const cells = [];
  let vMin = Infinity, vMax = -Infinity, optCell = null;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const kwp = kwpAt(i), bat = batAt(j);
      if (kwp <= 0) { cells.push({ i, j, kwp, bat, val: null }); continue; }
      const strat = bat > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';
      const sim   = pvNapSim(kwp, bat, demandH, pvProfile, napParams, strat, spotH);
      const wirt  = pvWirtschaft(kwp, bat, sim, kwp * spez / 1000, params, strat);
      const val   = -wirt.nettoJk;
      cells.push({ i, j, kwp, bat, val });
      if (val < vMin) vMin = val;
      if (val > vMax) vMax = val;
      if (!optCell || val > optCell.val) optCell = { i, j, kwp, bat, val };
    }
  }

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(420, elW - 4);
  const H   = overrideEl ? 460 : 300;
  const PL = 58, PT = 18, PR = 86, PB = 40;
  const cW = W - PL - PR, cH = H - PT - PB;
  const cellW = cW / nx, cellH = cH / ny;
  const px = i => PL + i * cellW;
  const py = j => PT + cH - (j + 1) * cellH;          // j=0 (bat=0) unten
  const xCont = kwp => PL + (kwp / maxKwp) * cW;
  const yCont = bat => PT + cH - (Math.min(bat, batMax) / batMax) * cH;

  const rects = cells.map(c => {
    const fill = c.val == null ? '#1a2030' : _viridis(vMax > vMin ? (c.val - vMin) / (vMax - vMin) : 0.5);
    return `<rect x="${px(c.i).toFixed(1)}" y="${py(c.j).toFixed(1)}" width="${(cellW + 0.6).toFixed(1)}" height="${(cellH + 0.6).toFixed(1)}" fill="${fill}"/>`;
  }).join('');

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f =>
    `<text x="${(PL + f * cW).toFixed(1)}" y="${PT + cH + 14}" text-anchor="middle" fill="#90a4ae" font-size="8">${Math.round(f * maxKwp)}</text>`).join('');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const bat = f * batMax;
    return `<text x="${PL - 6}" y="${(PT + cH - f * cH + 3).toFixed(1)}" text-anchor="end" fill="#90a4ae" font-size="8">${(bat / 1000).toFixed(bat < 1000 && bat > 0 ? 1 : 0)}</text>`;
  }).join('');

  const legX = PL + cW + 18, legW = 12;
  const legStops = [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => `<stop offset="${(t * 100).toFixed(0)}%" stop-color="${_viridis(t)}"/>`).join('');

  const varMarks = kanon.map(v => {
    const x = xCont(v.pvKwp).toFixed(1), y = yCont(v.batKwh).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#fff" stroke-width="1.5"/>
      <circle cx="${x}" cy="${y}" r="2.5" fill="${v.farbe}"/>
      <text x="${x}" y="${(parseFloat(y) - 8).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="8" font-weight="700" style="paint-order:stroke;stroke:#000;stroke-width:2.5px;">${v.icon}</text>`;
  }).join('');

  const optXn = xCont(optCell.kwp), optYn = yCont(optCell.bat);

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 1 — 2D-Optimierung: Jahresüberschuss über PV-Leistung × Batteriekapazität
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Falschfarben = Netto-Überschuss €/a · ○ = Varianten · ✕ = Optimum</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="heatmap" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;cursor:crosshair;">
    <defs><linearGradient id="pva-heat-leg" x1="0" y1="1" x2="0" y2="0">${legStops}</linearGradient></defs>
    ${rects}
    <rect x="${PL}" y="${PT}" width="${cW.toFixed(1)}" height="${cH.toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    ${xTicks}${yTicks}
    <text x="${(PL + cW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="#90a4ae" font-size="9">PV-Leistung (kWp)</text>
    <text x="13" y="${(PT + cH / 2).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="9" transform="rotate(-90,13,${(PT + cH / 2).toFixed(1)})">Batterie (MWh)</text>
    <line x1="${(optXn - 6).toFixed(1)}" y1="${optYn.toFixed(1)}" x2="${(optXn + 6).toFixed(1)}" y2="${optYn.toFixed(1)}" stroke="#fff" stroke-width="1.5"/>
    <line x1="${optXn.toFixed(1)}" y1="${(optYn - 6).toFixed(1)}" x2="${optXn.toFixed(1)}" y2="${(optYn + 6).toFixed(1)}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="${optXn.toFixed(1)}" cy="${optYn.toFixed(1)}" r="7" fill="none" stroke="#fff" stroke-width="1.5"/>
    ${varMarks}
    <rect x="${legX.toFixed(1)}" y="${PT}" width="${legW}" height="${cH.toFixed(1)}" fill="url(#pva-heat-leg)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>
    <text x="${(legX + legW + 3).toFixed(1)}" y="${PT + 6}" fill="#90a4ae" font-size="8">${(vMax / 1000).toFixed(0)}k</text>
    <text x="${(legX + legW + 3).toFixed(1)}" y="${(PT + cH).toFixed(1)}" fill="#90a4ae" font-size="8">${(vMin / 1000).toFixed(0)}k</text>
    <text x="${(legX + legW + 3).toFixed(1)}" y="${(PT + cH + 12).toFixed(1)}" fill="#607d8b" font-size="7">€/a</text>
  </svg>`;

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const lx = ev.clientX - r.left, ly = ev.clientY - r.top;
    if (lx < PL || lx > PL + cW || ly < PT || ly > PT + cH) { _pvHideTT(); return; }
    const i = Math.min(nx - 1, Math.max(0, Math.floor((lx - PL) / cellW)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((PT + cH - ly) / cellH)));
    const c = cells.find(cc => cc.i === i && cc.j === j);
    if (!c) { _pvHideTT(); return; }
    const isOpt = c.i === optCell.i && c.j === optCell.j;
    _pvShowTT(ev,
      `<strong style="color:#fdd835">${Math.round(c.kwp).toLocaleString('de-DE')} kWp</strong> · <strong style="color:#80deea">${Math.round(c.bat).toLocaleString('de-DE')} kWh</strong>` +
      (c.val == null ? '<br><span style="color:#90a4ae">—</span>'
        : `<br>Netto-Überschuss: <strong style="color:${c.val >= 0 ? '#a5d6a7' : '#ef9a9a'}">${(c.val / 1000).toFixed(1)} k€/a</strong>` +
          (isOpt ? '<br><span style="color:#fff">✕ Optimum</span>' : ''))
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  const fsBtn = el.querySelector('[data-pva-fs="heatmap"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('2D-Optimierung: Jahresüberschuss über PV × Batterie', cnt =>
      renderOptHeatmap(_pvFsArgs.demandH, _pvFsArgs.pvProfile, _pvFsArgs.napParams, _pvFsArgs.params, window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

// ── Abb. 1 — drehbare 3D-Optimierungsfläche (Canvas) ──────────────────────────
// Echte 3D-Oberfläche: X = PV-Leistung, Y = Batteriekapazität, Z = Jahres-Netto-
// Überschuss. Per Maus drehbar; Varianten und Optimum als Marker auf der Fläche.

function renderOptSurface3D(demandH, pvProfile, napParams, params, varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-heatmap');
  if (!el) return;

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const spez   = pvGetSpez();
  const spotH  = window.elSpotPreiseH || window._pvAnalyse.spotPreise || null;

  const kanon  = (varianten || []).filter(v => v.info && v.info.frage);
  const varBat = Math.max(0, ...kanon.map(v => v.batKwh));
  const batMax = Math.min(Math.max(1500, Math.round(varBat * 1.3 / 500) * 500), 12000);

  // Gitter berechnen (einmalig) — Z = −nettoJk (€/a)
  const nx = 16, ny = 12;
  const grid = [];               // grid[j][i] = surplus €/a
  let vMin = Infinity, vMax = -Infinity, opt = null;
  for (let j = 0; j < ny; j++) {
    grid[j] = [];
    for (let i = 0; i < nx; i++) {
      const kwp = (i / (nx - 1)) * maxKwp;
      const bat = (j / (ny - 1)) * batMax;
      const strat = bat > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';
      const sim   = pvNapSim(kwp, bat, demandH, pvProfile, napParams, strat, spotH);
      const val   = -pvWirtschaft(kwp, bat, sim, kwp * spez / 1000, params, strat).nettoJk;
      grid[j][i] = val;
      if (val < vMin) vMin = val;
      if (val > vMax) vMax = val;
      if (!opt || val > opt.val) opt = { i, j, kwp, bat, val };
    }
  }
  const span = (vMax - vMin) || 1;
  const tOf  = val => (val - vMin) / span;          // 0..1 Höhe

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(440, elW - 4);
  const H   = overrideEl ? 520 : 340;

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 1 — 3D-Optimierung: Jahresüberschuss über PV-Leistung × Batteriekapazität
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">ziehen zum Drehen · Scrollen zoomt · ○ Varianten · ✕ Optimum</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="surf" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <canvas style="display:block;width:${W}px;height:${H}px;cursor:grab;touch-action:none;"></canvas>`;

  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Ansicht-Zustand
  let az = -0.78, elev = 0.62, zoom = 1;
  const cx = W / 2, cy = H * 0.60;
  const baseScale = Math.min(W, H) * 0.40;
  const zSpan = 0.85;

  function project(mx, my, mz) {
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(elev), se = Math.sin(elev);
    const x1 = mx * ca - my * sa;
    const y1 = mx * sa + my * ca;
    const yp = y1 * ce - mz * se;          // Tiefe
    const zp = y1 * se + mz * ce;          // vertikal (oben)
    const s  = baseScale * zoom;
    return { sx: cx + x1 * s, sy: cy - zp * s, depth: yp };
  }
  // Gitterkoordinaten → Modellraum [-1..1] × [-1..1], Höhe 0..zSpan
  const MX = i => (i / (nx - 1)) * 2 - 1;
  const MY = j => (j / (ny - 1)) * 2 - 1;
  const MZ = val => tOf(val) * zSpan;

  function shade(hex, f) {
    const m = hex.match(/\d+/g); if (!m) return hex;
    return `rgb(${Math.round(m[0]*f)},${Math.round(m[1]*f)},${Math.round(m[2]*f)})`;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Bodenrahmen (4 Ecken bei z=0)
    const fc = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => project(x, y, 0));
    ctx.beginPath();
    fc.forEach((p, k) => { k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();

    // Quads sammeln + nach Tiefe sortieren (hinten zuerst)
    const quads = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const p00 = project(MX(i),   MY(j),   MZ(grid[j][i]));
        const p10 = project(MX(i+1), MY(j),   MZ(grid[j][i+1]));
        const p11 = project(MX(i+1), MY(j+1), MZ(grid[j+1][i+1]));
        const p01 = project(MX(i),   MY(j+1), MZ(grid[j+1][i]));
        const tAvg = (tOf(grid[j][i]) + tOf(grid[j][i+1]) + tOf(grid[j+1][i+1]) + tOf(grid[j+1][i])) / 4;
        const depth = (p00.depth + p10.depth + p11.depth + p01.depth) / 4;
        quads.push({ p00, p10, p11, p01, tAvg, depth });
      }
    }
    quads.sort((a, b) => b.depth - a.depth);

    for (const q of quads) {
      ctx.beginPath();
      ctx.moveTo(q.p00.sx, q.p00.sy);
      ctx.lineTo(q.p10.sx, q.p10.sy);
      ctx.lineTo(q.p11.sx, q.p11.sy);
      ctx.lineTo(q.p01.sx, q.p01.sy);
      ctx.closePath();
      const base = _viridis(q.tAvg);
      // leichte Höhen-Schattierung für Plastizität
      ctx.fillStyle = shade(base, 0.72 + 0.28 * q.tAvg);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.5; ctx.stroke();
    }

    // Z-Achse (vertikale Kante hinten-links) mit Ticks
    const zc0 = project(-1, 1, 0), zc1 = project(-1, 1, zSpan);
    ctx.beginPath(); ctx.moveTo(zc0.sx, zc0.sy); ctx.lineTo(zc1.sx, zc1.sy);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#90a4ae'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`${(vMax/1000).toFixed(0)}k €/a`, zc1.sx - 4, zc1.sy + 3);
    ctx.fillText(`${(vMin/1000).toFixed(0)}k`, zc0.sx - 4, zc0.sy + 3);

    // Achsenbeschriftung Boden
    const pvMid = project(0, -1, 0), batMid = project(1, 0, 0);
    ctx.fillStyle = '#b0bec5'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('PV-Leistung →', pvMid.sx, pvMid.sy + 16);
    ctx.save(); ctx.translate(batMid.sx + 22, batMid.sy);
    ctx.fillText('Batterie →', 0, 0); ctx.restore();
    // Eck-Ticks
    ctx.font = '8px sans-serif'; ctx.fillStyle = '#78909c';
    const c0 = project(-1,-1,0), cX = project(1,-1,0), cY = project(1,1,0);
    ctx.fillText('0', c0.sx, c0.sy + 14);
    ctx.fillText(`${Math.round(maxKwp)} kWp`, cX.sx, cX.sy + 14);
    ctx.fillText(`${(batMax/1000).toFixed(batMax<1000?1:0)} MWh`, cY.sx + 4, cY.sy + 4);

    // Optimum-Stiel + Marker
    const drawMarker = (mx, my, val, color, icon, isOpt) => {
      const base = project(mx, my, 0), top = project(mx, my, MZ(val));
      ctx.beginPath(); ctx.moveTo(base.sx, base.sy); ctx.lineTo(top.sx, top.sy);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      if (isOpt) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(top.sx-5, top.sy-5); ctx.lineTo(top.sx+5, top.sy+5);
        ctx.moveTo(top.sx+5, top.sy-5); ctx.lineTo(top.sx-5, top.sy+5); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(top.sx, top.sy, 4.5, 0, 7); ctx.fillStyle = color;
        ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(icon, top.sx, top.sy - 8);
      }
    };
    // Varianten zuerst, Optimum oben drauf
    kanon.forEach(v => {
      const val = Math.max(vMin, Math.min(vMax, -v.wirt.nettoJk));
      drawMarker((v.pvKwp / maxKwp) * 2 - 1, (Math.min(v.batKwh, batMax) / batMax) * 2 - 1, val, v.farbe, v.icon, false);
    });
    drawMarker(MX(opt.i), MY(opt.j), opt.val, '#fff', '', true);
  }

  draw();

  // Interaktion: Drehen per Drag, Zoom per Wheel
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { dragging = false; if (canvas) canvas.style.cursor = 'grab'; });
  canvas.addEventListener('mousemove', e => {
    if (!dragging) return;
    az   += (e.clientX - lastX) * 0.01;
    elev += (e.clientY - lastY) * 0.008;
    elev = Math.max(0.08, Math.min(1.35, elev));
    lastX = e.clientX; lastY = e.clientY;
    draw();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom = Math.max(0.6, Math.min(2.2, zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
    draw();
  }, { passive: false });

  const fsBtn = el.querySelector('[data-pva-fs="surf"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('3D-Optimierung: Jahresüberschuss über PV × Batterie', cnt =>
      renderOptSurface3D(_pvFsArgs.demandH, _pvFsArgs.pvProfile, _pvFsArgs.napParams, _pvFsArgs.params, window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

// ── Grenznutzen-Kurve: lohnt der nächste PV-Ausbauschritt seine Kosten? ────────
// Zeigt den jährlichen Netto-Überschuss (Erlöse − alle Jahreskosten inkl. Infra)
// als Funktion der PV-Größe (ohne Batterie). Wo die Kurve kippt, kostet weiterer
// PV-Ausbau mehr als er bringt; Infrastrukturstufen erzeugen sichtbare Sprünge.

function renderGrenznutzenChart(demandH, pvProfile, napParams, params, varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-grenznutzen');
  if (!el) return;

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const spez   = pvGetSpez();
  const steps  = [];
  for (let k = 0; k <= maxKwp; k += Math.max(5, Math.round(maxKwp / 50))) steps.push(k);
  if (steps[steps.length - 1] !== Math.round(maxKwp)) steps.push(Math.round(maxKwp));

  // Netto-Jahresüberschuss je kWp (ohne Batterie)
  const data = steps.map(kwp => {
    if (kwp <= 0) return { kwp, netto: 0, infra: 0 };
    const sim  = pvNapSim(kwp, 0, demandH, pvProfile, napParams, 'none', null);
    const wirt = pvWirtschaft(kwp, 0, sim, kwp * spez / 1000, params, 'none');
    return { kwp, netto: -wirt.nettoJk, infra: wirt.infraInvest }; // netto>0 = Gewinn/a
  });

  const nettoVals = data.map(d => d.netto);
  const yMax = Math.max(1000, ...nettoVals);
  const yMin = Math.min(0, ...nettoVals);

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(400, elW - 4);
  const H   = overrideEl ? 440 : 300;
  const PL = 58, PT = 16, PR = 20, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;
  const xS = v => PL + (v / maxKwp) * cW;
  const yS = v => PT + cH - ((v - yMin) / (yMax - yMin)) * cH;

  const nettoPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xS(d.kwp).toFixed(1)},${yS(d.netto).toFixed(1)}`).join(' ');

  // Optimum = Maximum der Netto-Kurve
  const optIdx = nettoVals.indexOf(Math.max(...nettoVals));
  const optKwp = data[optIdx].kwp;

  // Infrastruktur-Stufengrenzen als vertikale Marker
  const infraGrenzen = PV_INFRA_STUFEN.filter(s => isFinite(s.bisKwp) && s.bisKwp < maxKwp).map(s => s.bisKwp);

  const yZero = yS(0).toFixed(1);

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 2 — Ausbau-Grenznutzen: Jahresüberschuss je PV-Größe <span style="color:var(--muted);font-weight:400;">(ohne Speicher)</span>
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">wo die Kurve kippt, kostet weiterer Ausbau mehr als er bringt · Sprünge = Infrastrukturstufen · ein Speicher verschiebt das Optimum nach rechts</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="grenz" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;cursor:crosshair;">
    ${[0, 0.25, 0.5, 0.75, 1].map(f => {
      const val = yMin + f * (yMax - yMin);
      const y = yS(val).toFixed(1);
      return `<line x1="${PL}" y1="${y}" x2="${PL + cW}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PL - 5}" y="${(parseFloat(y) + 3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="8">${(val / 1000).toFixed(0)}k</text>`;
    }).join('')}
    <line x1="${PL}" y1="${yZero}" x2="${PL + cW}" y2="${yZero}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    ${infraGrenzen.map(g => `
      <line x1="${xS(g).toFixed(1)}" y1="${PT}" x2="${xS(g).toFixed(1)}" y2="${PT + cH}" stroke="#ff8a65" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>
      <text x="${xS(g).toFixed(1)}" y="${PT + 9}" text-anchor="middle" fill="#ff8a65" font-size="7" opacity="0.8">${g} kWp</text>
    `).join('')}
    ${[0, Math.round(maxKwp * 0.25), Math.round(maxKwp * 0.5), Math.round(maxKwp * 0.75), maxKwp].map(v => `
      <text x="${xS(v).toFixed(1)}" y="${PT + cH + 14}" text-anchor="middle" fill="#607d8b" font-size="8">${v}</text>
    `).join('')}
    <text x="${PL + cW / 2}" y="${H - 3}" text-anchor="middle" fill="#607d8b" font-size="9">PV-Leistung (kWp)</text>
    <text x="11" y="${PT + cH / 2}" text-anchor="middle" fill="#607d8b" font-size="9" transform="rotate(-90,11,${PT + cH / 2})">Netto-Überschuss (€/a)</text>
    <path d="${nettoPath}" fill="none" stroke="#66bb6a" stroke-width="2.5"/>
    <line x1="${xS(optKwp).toFixed(1)}" y1="${PT}" x2="${xS(optKwp).toFixed(1)}" y2="${PT + cH}" stroke="#66bb6a" stroke-width="1" stroke-dasharray="3,2" opacity="0.8"/>
    <text x="${Math.min(xS(optKwp) + 4, W - 80)}" y="${PT + 20}" fill="#66bb6a" font-size="9" font-weight="600">Optimum ≈ ${optKwp.toLocaleString('de-DE')} kWp</text>
    ${(varianten || []).filter(v => v.info && v.info.frage).map(v => {
      const d = data.reduce((b, c) => Math.abs(c.kwp - v.pvKwp) < Math.abs(b.kwp - v.pvKwp) ? c : b);
      const x = xS(v.pvKwp).toFixed(1), y = yS(d.netto).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="5" fill="${v.farbe}" stroke="#000" stroke-width="1" opacity="0.9"/>
        <text x="${x}" y="${(parseFloat(y) - 8).toFixed(1)}" text-anchor="middle" fill="${v.farbe}" font-size="9" font-weight="600">${v.icon}</text>`;
    }).join('')}
    <line id="pva-grenz-xhair" x1="-2" y1="${PT}" x2="-2" y2="${PT + cH}" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="3,2"/>
  </svg>`;

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const lx = ev.clientX - r.left;
    if (lx < PL || lx > PL + cW) { _pvHideTT(); return; }
    const kwpHit = (lx - PL) / cW * maxKwp;
    const d = data.reduce((b, c) => Math.abs(c.kwp - kwpHit) < Math.abs(b.kwp - kwpHit) ? c : b);
    const xhair = el.querySelector('#pva-grenz-xhair');
    if (xhair) { xhair.setAttribute('x1', xS(d.kwp).toFixed(1)); xhair.setAttribute('x2', xS(d.kwp).toFixed(1)); }
    const varHit = (varianten || []).find(v => v.info && v.info.frage && Math.abs(v.pvKwp - d.kwp) < maxKwp * 0.04);
    const varLine = varHit ? `<br><span style="color:${varHit.farbe};font-weight:700">${varHit.icon} ${varHit.label}</span>` : '';
    _pvShowTT(ev,
      `<strong style="color:#fdd835">${d.kwp.toLocaleString('de-DE')} kWp</strong>${varLine}` +
      `<br><span style="color:#66bb6a">●</span> Netto-Überschuss: <strong>${(d.netto / 1000).toFixed(1)} k€/a</strong>` +
      `<br><span style="color:#ff8a65">●</span> Infrastruktur: <strong>${(d.infra / 1000).toFixed(0)} k€</strong> Invest`
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  const fsBtn = el.querySelector('[data-pva-fs="grenz"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Ausbau-Grenznutzen — Jahresüberschuss je PV-Größe', cnt =>
      renderGrenznutzenChart(_pvFsArgs.demandH, _pvFsArgs.pvProfile, _pvFsArgs.napParams, _pvFsArgs.params, window._pvAnalyse.ergebnisse, cnt)
    )
  );
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

  // Stromlast-Basis Buttons (data-pva-dm)
  document.querySelectorAll('[data-pva-dm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.pvaDm;
      if (btn.disabled) return;
      window._pvAnalyse.demandMode = mode;
      window._pvAnalyse.berechnet  = false; // Ergebnisse invalidieren
      // Panel komplett neu rendern (Zieljahr-Input-Status + Endausbau-Vorschau aktualisieren)
      const wrap = document.getElementById('analyse-pva-wrap');
      if (wrap) _pvInitInWrap(wrap);
    });
  });
}

function _pvSyncFromState() {
  const s = window._pvAnalyse;
  // Globale NAP-Grenzen aus Strom-Grundlagen übernehmen (wenn lokal noch 0)
  if (!s.napMaxEinspKw && window.elNapMaxEinspKw) s.napMaxEinspKw = window.elNapMaxEinspKw;
  if (!s.napMaxBezugKw && window.elNapMaxBezugKw) s.napMaxBezugKw = window.elNapMaxBezugKw;
  const set  = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  const setC = (id, v) => { const e = document.getElementById(id); if (e) e.checked = v; };
  set('pva-nap-einsp',          s.napMaxEinspKw  || 0);
  set('pva-nap-bezug',          s.napMaxBezugKw  || 0);
  set('pva-sk',                 s.skKVA || 0);
  set('pva-ubudget',            s.uBudgetPct || 3);
  set('pva-max-kwp',            s.pvMaxKwpOverride || 0);
  set('pva-endausbau-jahr',     s.endausbauJahr || ((globalYear || new Date().getFullYear()) + 15));
  const jahrVal = document.getElementById('pva-endausbau-jahr-val');
  if (jahrVal) jahrVal.textContent = s.endausbauJahr || ((globalYear || new Date().getFullYear()) + 15);
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
  // Stromlast-Basis: aktiven Button setzen
  const dm = s.demandMode || 'basis';
  document.querySelectorAll('[data-pva-dm]').forEach(b => {
    const active = b.dataset.pvaDm === dm;
    b.style.background = active ? '#fdd835' : 'var(--surface)';
    b.style.color      = active ? '#000'    : 'var(--text)';
  });
  // Ergebnisse wieder anzeigen wenn bereits berechnet
  if (s.berechnet && s.ergebnisse?.length) {
    renderVariantenTabelle(s.ergebnisse);
    renderMethodik(s.ergebnisse);
    renderRechenweg(s.ergebnisse);
    renderBilanzChart(s.ergebnisse);
    renderScatterChart(s.ergebnisse);
    renderRueckAmpel(s.ergebnisse);
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
      const prm = { pStrom, pEinsp, pvInvestPerKwp: pvInv, batInvestPerKwh: batInv, zins, pvLife, batLife };
      _pvFsArgs = { demandH: d, pvProfile: p, napParams: np, params: prm };
      renderEvKurve(d, p, np, prm, s.ergebnisse);
      renderOptSurface3D(d, p, np, prm, s.ergebnisse);
      renderGrenznutzenChart(d, p, np, prm, s.ergebnisse);
      renderEnergieFluss(d, p, np, prm, s.ergebnisse);
      renderAutarkieHeatmap(s.ergebnisse);
      renderSensitivitaet(s.ergebnisse);
      renderResilienz(s.ergebnisse);
    }
  }
}

// Liefert die (ggf. benutzerdefinierten) Kostenpositionen einer Infrastruktur-Stufe.
// Beim ersten Zugriff wird eine editierbare Kopie der Default-Items angelegt.
function _pvInfraItems(stufeId) {
  const state = window._pvAnalyse;
  if (!state.infraKonfig) state.infraKonfig = {};
  if (!state.infraKonfig[stufeId]) {
    const stufe = PV_INFRA_STUFEN.find(s => s.id === stufeId);
    state.infraKonfig[stufeId] = stufe.items.map(i => ({ ...i }));
  }
  return state.infraKonfig[stufeId];
}

function _pvRenderInfraStufen() {
  const el = document.getElementById('pva-infra-stufen');
  if (!el) return;
  el.innerHTML = PV_INFRA_STUFEN.map(stufe => {
    const items = _pvInfraItems(stufe.id);
    const rows = items.map((item, idx) => `
      <div style="display:flex;align-items:center;gap:6px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <label style="flex:1;display:flex;align-items:center;gap:5px;color:var(--muted);font-size:8px;cursor:pointer;min-width:0;">
          <input type="checkbox" ${item.aktiv ? 'checked' : ''} style="accent-color:#fdd835;flex-shrink:0;"
            data-change="window._pvAnalyse.infraKonfig['${stufe.id}'][${idx}].aktiv=this.checked"/>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.label}</span>
        </label>
        <input type="number" value="${item.investEUR || 0}" min="0" step="100"
          style="width:72px;flex-shrink:0;padding:2px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:8px;text-align:right;"
          data-change="window._pvAnalyse.infraKonfig['${stufe.id}'][${idx}].investEUR=parseFloat(this.value)||0"/>
        <span style="font-size:8px;color:var(--muted);flex-shrink:0;">€${item.perKwh ? ` +${(item.perKwh * 100).toFixed(1)}ct/kWh` : ''}</span>
      </div>`).join('');
    return `<div style="margin-bottom:6px;">
      <div style="font-size:9px;font-weight:600;color:var(--text);margin-bottom:2px;">${stufe.label}</div>
      ${rows}
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

  const napAktiv = window.elNapMaxEinspKw != null || window._pvAnalyse.napMaxEinspKw > 0;
  const fmt  = (v, dez=0) => typeof v === 'number' ? v.toFixed(dez).replace('.', ',') : '—';
  const fmtK = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(0).replace('.', ',') + ' k€' : Math.round(v) + ' €';
  const pct  = v => fmt(v, 1) + ' %';

  // Hervorhebung: die wirtschaftlich optimierte Variante (höchster Netto-Jahresüberschuss).
  // Fallback (z.B. nur Custom-Varianten): niedrigste Amortisation.
  const hasWirtOpt = varianten.some(v => v.id === 'wirt-opt');
  const bestAmort  = Math.min(...varianten.map(v => v.wirt.amort).filter(a => isFinite(a)));

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
        <th style="padding:3px 5px;color:${napAktiv ? '#ef9a9a' : '#546e7a'};" title="Abgeregelte Energie (nur bei aktiver NAP-Einspeisebegrenzung)">Abr&nbsp;%</th>
        <th style="padding:3px 5px;color:${napAktiv ? '#ef9a9a' : '#546e7a'};" title="Abgeregelte Energie in MWh/a">Abr&nbsp;MWh</th>
        <th style="padding:3px 5px;">Invest</th>
        <th style="padding:3px 5px;">Infra</th>
        <th style="padding:3px 5px;">Erlös/a</th>
        <th style="padding:3px 5px;" title="Jährlicher Netto-Überschuss = Erlöse − alle Jahreskosten (inkl. Infrastruktur). Höher = besser — Auswahlkriterium der wirtschaftlich optimierten Variante.">Überschuss/a</th>
        <th style="padding:3px 5px;">Amort</th>
      </tr>
    </thead>
    <tbody>`;

  for (const v of varianten) {
    const w = v.wirt;
    const isKomp = hasWirtOpt ? v.id === 'wirt-opt' : (w.amort === bestAmort);
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
        <td style="text-align:right;padding:4px 5px;color:${abregelColor};" title="${napAktiv ? 'Abregelung durch NAP-Limit' : 'Kein NAP-Limit gesetzt'}">
          ${napAktiv && w.curtailQuote > 0 ? pct(w.curtailQuote) : napAktiv ? '0,0 %' : '—'}</td>
        <td style="text-align:right;padding:4px 5px;color:${abregelColor};">
          ${napAktiv && v.sim.curtailMwh > 0 ? fmt(v.sim.curtailMwh, 1) : napAktiv ? '0' : '—'}</td>
        <td style="text-align:right;padding:4px 5px;color:#ce93d8;">${fmtK(w.investGes)}</td>
        <td style="text-align:right;padding:4px 5px;color:#ff8a65;">${fmtK(w.infraInvest)} <span style="color:var(--muted);font-size:7px;">${w.infraLabel.split(' ')[0]}</span></td>
        <td style="text-align:right;padding:4px 5px;color:#a5d6a7;">${fmtK(w.gesamtErloes)}</td>
        <td style="text-align:right;padding:4px 5px;font-weight:600;color:${(-w.nettoJk) >= 0 ? '#66bb6a' : '#ef9a9a'};">${fmtK(-w.nettoJk)}</td>
        <td style="text-align:right;padding:4px 5px;font-weight:600;color:${isKomp ? '#66bb6a' : 'var(--text)'};">${isFinite(w.amort) ? fmt(w.amort, 1) + ' a' : '> 20 a'}</td>
      </tr>`;
  }

  html += `</tbody></table></div>`;

  // Legende NAP-Hinweis
  html += `<div style="margin-top:6px;font-size:9px;color:var(--muted);">
    ${napAktiv
      ? `<span style="color:#ef9a9a;">Abr %</span> / <span style="color:#ef9a9a;">Abr MWh</span> = Abregelungsverluste durch NAP-Einspeisebegrenzung`
      : `<span style="color:#546e7a;">Abr %/MWh</span> = kein NAP-Limit gesetzt — in ⚡ Strom-Grundlagen oder oben eingeben`}
  </div>`;

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

// ── Chart-Interaktivität: Tooltip & Vollbild ─────────────────────────────

let _pvFsArgs = null;

let _pvTTel = null;
function _pvShowTT(ev, html) {
  if (!_pvTTel) {
    _pvTTel = document.createElement('div');
    _pvTTel.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;background:rgba(12,18,32,0.97);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;font-size:11px;color:#cfd8dc;box-shadow:0 4px 24px rgba(0,0,0,0.7);display:none;line-height:1.75;white-space:nowrap;';
    document.body.appendChild(_pvTTel);
  }
  _pvTTel.innerHTML = html;
  _pvTTel.style.display = 'block';
  const tw = _pvTTel.offsetWidth + 24, th = _pvTTel.offsetHeight + 12;
  _pvTTel.style.left = Math.min(ev.clientX + 16, window.innerWidth  - tw) + 'px';
  _pvTTel.style.top  = Math.min(ev.clientY + 16, window.innerHeight - th) + 'px';
}
function _pvHideTT() { if (_pvTTel) _pvTTel.style.display = 'none'; }

let _pvFsModal = null;
function _pvOpenFs(title, renderCb) {
  if (!_pvFsModal) {
    _pvFsModal = document.createElement('div');
    _pvFsModal.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(8,12,24,0.97);display:none;align-items:center;justify-content:center;flex-direction:column;';
    _pvFsModal.innerHTML =
      '<div style="position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">' +
      '<span id="pva-fs-ttl" style="font-size:13px;font-weight:600;color:#e0e0e0;"></span>' +
      '<span id="pva-fs-x" style="cursor:pointer;font-size:22px;color:#90a4ae;padding:4px 10px;line-height:1;user-select:none;">✕</span></div>' +
      '<div id="pva-fs-cnt" style="width:96vw;max-width:1600px;margin-top:56px;overflow:auto;padding:8px 0;"></div>';
    document.body.appendChild(_pvFsModal);
    _pvFsModal.querySelector('#pva-fs-x').onclick = () => { _pvFsModal.style.display = 'none'; _pvHideTT(); };
    _pvFsModal.addEventListener('click', e => { if (e.target === _pvFsModal) { _pvFsModal.style.display = 'none'; _pvHideTT(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _pvFsModal?.style.display !== 'none') { _pvFsModal.style.display = 'none'; _pvHideTT(); } });
  }
  _pvFsModal.querySelector('#pva-fs-ttl').textContent = title;
  const cnt = _pvFsModal.querySelector('#pva-fs-cnt');
  cnt.innerHTML = '';
  _pvFsModal.style.display = 'flex';
  requestAnimationFrame(() => renderCb(cnt));
}

// ── EV-Kurve: Eigenverbrauchsquote vs. PV-Größe ───────────────────────────

function renderEvKurve(demandH, pvProfile, napParams, params, varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-ev-kurve');
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

  const elW = el.getBoundingClientRect().width || 600;
  const W   = Math.max(400, elW - 4);
  const H   = overrideEl ? 420 : 300;
  const PL = 48, PT = 16, PR = 16, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;
  const xS = v => PL + (v / maxKwp) * cW;
  const yS = v => PT + cH - (v / 100) * cH;

  const evPath = evData.map((d, i) => `${i===0?'M':'L'}${xS(d.kwp).toFixed(1)},${yS(d.evQ).toFixed(1)}`).join(' ');
  const curtailPath = evData.filter(d => d.curtailQ > 0)
    .map((d, i) => `${i===0?'M':'L'}${xS(d.kwp).toFixed(1)},${yS(d.curtailQ).toFixed(1)}`).join(' ');
  const xMax = xS(maxKwp).toFixed(1);

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 3 — Eigenverbrauchsquote &amp; Abregelung je PV-Größe</span>
    ${overrideEl ? '' : '<button data-pva-fs="ev" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;cursor:crosshair;">
    ${[0,25,50,75,100].map(v => `
      <line x1="${PL}" y1="${yS(v).toFixed(1)}" x2="${PL+cW}" y2="${yS(v).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      <text x="${PL-5}" y="${(yS(v)+3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="9">${v}%</text>
    `).join('')}
    <line x1="${PL}" y1="${PT+cH}" x2="${PL+cW}" y2="${PT+cH}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    ${[0,Math.round(maxKwp*0.25),Math.round(maxKwp*0.5),Math.round(maxKwp*0.75),maxKwp].map(v => `
      <text x="${xS(v).toFixed(1)}" y="${PT+cH+14}" text-anchor="middle" fill="#607d8b" font-size="9">${v}</text>
    `).join('')}
    <text x="${PL+cW/2}" y="${H-2}" text-anchor="middle" fill="#607d8b" font-size="9">kWp</text>
    ${curtailPath ? `<path d="${curtailPath}" fill="none" stroke="#ef9a9a" stroke-width="1.5" stroke-dasharray="4,3"/>` : ''}
    <path d="${evPath}" fill="none" stroke="#42a5f5" stroke-width="2.5"/>
    <line x1="${xMax}" y1="${PT}" x2="${xMax}" y2="${(PT+cH).toFixed(1)}" stroke="#fdd835" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>
    <text x="${Math.min(parseFloat(xMax)+4, W-60)}" y="${PT+11}" fill="#fdd835" font-size="9">Max PV</text>
    <rect x="${PL+4}" y="${PT+2}" width="96" height="32" rx="3" fill="rgba(0,0,0,0.5)"/>
    <line x1="${PL+8}" y1="${PT+12}" x2="${PL+18}" y2="${PT+12}" stroke="#42a5f5" stroke-width="2.5"/>
    <text x="${PL+22}" y="${PT+15}" fill="#90a4ae" font-size="9">Eigenverbrauch</text>
    <line x1="${PL+8}" y1="${PT+24}" x2="${PL+18}" y2="${PT+24}" stroke="#ef9a9a" stroke-width="1.5" stroke-dasharray="4,3"/>
    <text x="${PL+22}" y="${PT+27}" fill="#90a4ae" font-size="9">Abregelung</text>
    ${(varianten || []).map(v => {
      const x = xS(v.pvKwp).toFixed(1);
      const y = yS(Math.min(v.wirt.pvEigenQuote, 100)).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="5" fill="${v.farbe}" stroke="#000" stroke-width="1" opacity="0.9"/>
        <text x="${x}" y="${parseFloat(y)-8}" text-anchor="middle" fill="${v.farbe}" font-size="8" font-weight="600">${v.icon}</text>`;
    }).join('')}
    <line id="pva-ev-xhair" x1="-2" y1="${PT}" x2="-2" y2="${PT+cH}" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="3,2"/>
  </svg>`;

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const lx = ev.clientX - r.left;
    if (lx < PL || lx > PL + cW) { _pvHideTT(); return; }
    const kwpHit = (lx - PL) / cW * maxKwp;
    const d = evData.reduce((b, c) => Math.abs(c.kwp - kwpHit) < Math.abs(b.kwp - kwpHit) ? c : b);
    const xhair = el.querySelector('#pva-ev-xhair');
    if (xhair) { xhair.setAttribute('x1', xS(d.kwp).toFixed(1)); xhair.setAttribute('x2', xS(d.kwp).toFixed(1)); }
    const varHit = (varianten || []).find(v => Math.abs(v.pvKwp - d.kwp) < maxKwp * 0.05);
    const varLine = varHit ? `<br><span style="color:${varHit.farbe};font-weight:700">${varHit.icon} ${varHit.label}</span>` : '';
    _pvShowTT(ev,
      `<strong style="color:#fdd835">${d.kwp.toLocaleString('de-DE')} kWp</strong>${varLine}` +
      `<br><span style="color:#42a5f5">●</span> EV-Quote: <strong>${d.evQ.toFixed(1)}&thinsp;%</strong>` +
      (d.curtailQ > 0.05 ? `<br><span style="color:#ef9a9a">●</span> Abregelung: <strong>${d.curtailQ.toFixed(1)}&thinsp;%</strong>` : '')
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  const fsBtn = el.querySelector('[data-pva-fs="ev"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Eigenverbrauchsquote & Abregelung je PV-Größe', cnt =>
      renderEvKurve(_pvFsArgs.demandH, _pvFsArgs.pvProfile, _pvFsArgs.napParams, _pvFsArgs.params, window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

// ── Abb. 4 — Energiebilanz: gruppierte Vertikalbalken je Variante ─────────────
// Drei Balken pro Variante:
//   B (Bedarf)   = gesamter Strombedarf
//   D (Deckung)  = Eigenverbrauch + Netzbezug   (deckt den Bedarf, gleiche Höhe)
//   P (PV-Verbl.)= Einspeisung + Abregelung      (Verbleib des PV-Überschusses)

function renderBilanzChart(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-bilanz');
  if (!el || !varianten?.length) return;

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(420, elW - 4);
  const H   = overrideEl ? 440 : 300;
  const PL = 50, PT = 28, PR = 16, PB = 48;
  const cW = W - PL - PR, cH = H - PT - PB;

  const COL = { ev:'#66bb6a', nb:'#ef5350', es:'#42a5f5', ct:'#ff9800', bedarf:'#78909c' };

  const rows = varianten.map(v => {
    const ev = v.sim.eigenMwh, nb = v.sim.netzbezugMwh;
    const es = v.sim.einspeiseMwh, ct = v.sim.curtailMwh || 0;
    return { v, ev, nb, es, ct, bedarf: ev + nb, pv: es + ct };
  });
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.bedarf, r.pv)));
  const yS = val => (PT + cH) - (val / maxVal) * cH;

  const n = rows.length;
  const groupW  = cW / n;
  const barW    = Math.min(38, groupW * 0.22);
  const innerGap = barW * 0.30;
  const trioW   = 3 * barW + 2 * innerGap;

  const seg = (x, valTop, valBot, color) => {
    const yTop = yS(valTop), yBot = yS(valBot), h = yBot - yTop;
    if (h < 0.4) return '';
    return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="0.92"/>`;
  };

  let bars = '', labels = '';
  rows.forEach((r, i) => {
    const gx = PL + i * groupW + (groupW - trioW) / 2;
    const x1 = gx, x2 = gx + barW + innerGap, x3 = gx + 2 * (barW + innerGap);
    bars += seg(x1, r.bedarf, 0, COL.bedarf);                 // Bedarf
    bars += seg(x2, r.ev, 0, COL.ev) + seg(x2, r.ev + r.nb, r.ev, COL.nb);   // Deckung
    bars += seg(x3, r.es, 0, COL.es) + seg(x3, r.es + r.ct, r.es, COL.ct);   // PV-Verbleib
    [['B', x1], ['D', x2], ['P', x3]].forEach(([t, xx]) =>
      labels += `<text x="${(xx + barW / 2).toFixed(1)}" y="${PT + cH + 12}" text-anchor="middle" fill="#607d8b" font-size="8">${t}</text>`);
    const nm = r.v.label.length > 18 ? r.v.label.slice(0, 17) + '…' : r.v.label;
    labels += `<text x="${(gx + trioW / 2).toFixed(1)}" y="${PT + cH + 28}" text-anchor="middle" fill="${r.v.farbe}" font-size="8" font-weight="600">${r.v.icon} ${nm}</text>`;
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const val = f * maxVal, y = yS(val);
    return `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
      <text x="${PL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="8">${val.toFixed(0)}</text>`;
  }).join('');

  const legendItems = [['Eigenverbrauch', COL.ev], ['Netzbezug', COL.nb], ['Einspeisung', COL.es], ['Abregelung', COL.ct], ['Bedarf', COL.bedarf]];
  let lx = PL;
  const legendSvg = legendItems.map(([t, c]) => {
    const s = `<rect x="${lx.toFixed(1)}" y="2" width="8" height="8" fill="${c}" opacity="0.92"/><text x="${(lx + 11).toFixed(1)}" y="10" fill="#90a4ae" font-size="8">${t}</text>`;
    lx += 20 + t.length * 5.4; return s;
  }).join('');

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 4 — Energiebilanz je Variante
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">B = Bedarf · D = Deckung (Eigenverbrauch + Netzbezug) · P = PV-Überschuss (Einspeisung + Abregelung)</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="bilanz" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;cursor:default;">
    ${legendSvg}
    ${yTicks}
    ${bars}
    <line x1="${PL}" y1="${(PT + cH).toFixed(1)}" x2="${PL + cW}" y2="${(PT + cH).toFixed(1)}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <text x="13" y="${(PT + cH / 2).toFixed(1)}" text-anchor="middle" fill="#607d8b" font-size="9" transform="rotate(-90,13,${(PT + cH / 2).toFixed(1)})">MWh/a</text>
    ${labels}
  </svg>`;

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const lx2 = ev.clientX - r.left;
    const i = Math.floor((lx2 - PL) / groupW);
    if (i < 0 || i >= rows.length || lx2 < PL) { _pvHideTT(); return; }
    const { v, ev: evM, nb, es, ct, bedarf, pv } = rows[i];
    const fmt = x => x.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' MWh';
    const aut = bedarf > 0 ? (evM / bedarf * 100).toFixed(0) : '0';
    const pvGen = evM + es + ct;
    _pvShowTT(ev,
      `<span style="color:${v.farbe};font-weight:700">${v.icon} ${v.label}</span><br>` +
      `<u>Bedarf</u>: <strong>${fmt(bedarf)}</strong><br>` +
      `<span style="color:${COL.ev}">■</span> Eigenverbrauch: <strong>${fmt(evM)}</strong> · Aut. ${aut}&thinsp;%<br>` +
      `<span style="color:${COL.nb}">■</span> Netzbezug: <strong>${fmt(nb)}</strong><br>` +
      `<u>PV-Überschuss</u>: <strong>${fmt(pv)}</strong>${pvGen > 0 ? ` (von ${fmt(pvGen)} Ertrag)` : ''}<br>` +
      `<span style="color:${COL.es}">■</span> Einspeisung: <strong>${fmt(es)}</strong><br>` +
      (ct > 0.5 ? `<span style="color:${COL.ct}">■</span> Abregelung: <strong>${fmt(ct)}</strong>` +
        (pvGen > 0 ? ` (${(ct / pvGen * 100).toFixed(0)}&thinsp;%)` : '') : `<span style="color:${COL.ct}">■</span> Abregelung: <strong>0 MWh</strong>`)
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  const fsBtn = el.querySelector('[data-pva-fs="bilanz"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Energiebilanz je Variante', cnt => renderBilanzChart(window._pvAnalyse.ergebnisse, cnt))
  );
}

// ── Scatter: Invest vs. Amortisation — zeigt wirtschaftliche Effizienz ──────

function renderScatterChart(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-scatter');
  if (!el || !varianten?.length) return;

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(400, elW - 4);
  const H   = overrideEl ? 440 : 300;
  const PL = 50, PT = 16, PR = 20, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;

  const maxInvest = Math.max(...varianten.map(v => v.wirt.investGes), 100000);
  const maxAmort  = Math.max(...varianten.map(v => isFinite(v.wirt.amort) ? v.wirt.amort : 25), 25);
  const xS = v => PL + (v / maxInvest) * cW;
  const yS = v => PT + cH - (v / maxAmort) * cH;

  const yGreen = yS(10).toFixed(1);
  const dotData = varianten.map(v => ({
    v,
    cx: xS(v.wirt.investGes),
    cy: yS(isFinite(v.wirt.amort) ? v.wirt.amort : maxAmort),
  }));

  const dots = dotData.map(({ v, cx, cy }) => `
    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${6 + v.wirt.autarkie / 20}" fill="${v.farbe}" stroke="#111" stroke-width="1.5" opacity="0.85"/>
    <text x="${cx.toFixed(1)}" y="${(cy-10).toFixed(1)}" text-anchor="middle" fill="${v.farbe}" font-size="9" font-weight="600">${v.icon}</text>
    <text x="${cx.toFixed(1)}" y="${(cy+14).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="7">${v.wirt.autarkie.toFixed(0)}% Aut</text>
  `).join('');

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 5 — Investition vs. Amortisation
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Kreisgröße = Autarkie % · je weiter links + unten, desto besser</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="scatter" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;cursor:default;">
    <rect x="${PL}" y="${yGreen}" width="${cW}" height="${(PT+cH-parseFloat(yGreen)).toFixed(1)}" fill="#66bb6a" opacity="0.05"/>
    <text x="${PL+4}" y="${parseFloat(yGreen)-3}" fill="#66bb6a" font-size="8" opacity="0.7">Amort. &lt; 10 a</text>
    ${[0,5,10,15,20,25].filter(v => v <= maxAmort+1).map(v => {
      const y = yS(v).toFixed(1);
      return `<line x1="${PL}" y1="${y}" x2="${PL+cW}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PL-4}" y="${(parseFloat(y)+3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="8">${v}a</text>`;
    }).join('')}
    ${[0,0.25,0.5,0.75,1].map(f => {
      const x = (PL + f * cW).toFixed(1);
      return `<line x1="${x}" y1="${PT}" x2="${x}" y2="${PT+cH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${x}" y="${PT+cH+12}" text-anchor="middle" fill="#607d8b" font-size="8">${(f*maxInvest/1000).toFixed(0)} k€</text>`;
    }).join('')}
    <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT+cH}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <line x1="${PL}" y1="${PT+cH}" x2="${PL+cW}" y2="${PT+cH}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <text x="${PL+cW/2}" y="${H-4}" text-anchor="middle" fill="#607d8b" font-size="9">Investition (k€)</text>
    <text x="10" y="${PT+cH/2}" text-anchor="middle" fill="#607d8b" font-size="9" transform="rotate(-90,10,${PT+cH/2})">Amortisation (a)</text>
    ${dots}
  </svg>`;

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const lx = ev.clientX - r.left, ly = ev.clientY - r.top;
    let nearest = null, minDist = Infinity;
    dotData.forEach(d => {
      const dist = Math.hypot(d.cx - lx, d.cy - ly);
      if (dist < minDist) { minDist = dist; nearest = d; }
    });
    if (!nearest || minDist > 80) { _pvHideTT(); return; }
    const v = nearest.v;
    const fmtK = n => (n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' k€';
    _pvShowTT(ev,
      `<span style="color:${v.farbe};font-weight:700">${v.icon} ${v.label}</span><br>` +
      `☀ ${v.pvKwp.toLocaleString('de-DE')} kWp${v.batKwh > 0 ? ` · 🔋 ${v.batKwh.toLocaleString('de-DE')} kWh` : ''}<br>` +
      `💰 Invest: <strong>${fmtK(v.wirt.investGes)}</strong> (Infra: ${fmtK(v.wirt.infraInvest)})<br>` +
      `⏱ Amortisation: <strong>${isFinite(v.wirt.amort) ? v.wirt.amort.toFixed(1) + ' a' : '> 25 a'}</strong><br>` +
      `🏠 Autarkie: <strong>${v.wirt.autarkie.toFixed(1)}&thinsp;%</strong> · EV-Quote: ${v.wirt.pvEigenQuote.toFixed(1)}&thinsp;%`
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  const fsBtn = el.querySelector('[data-pva-fs="scatter"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Invest vs. Amortisation', cnt => renderScatterChart(window._pvAnalyse.ergebnisse, cnt))
  );
}

// ── Abb. 6 — Rückspeise- & Erzeugungsnetz-Bewertung ───────────────────────────
// Horizontale Balken = Rückspeisespitze P_rück je Variante, eingefärbt nach Ampel.
// Senkrechte Marken: vorhandene Anschlussgrenze (rot) und spannungslimitierte
// Kapazität S_zul = Budget% · S_k″ (orange). Darüber ein Erzeugungsnetz-Verdikt.

const _AMPEL_COL = { gruen:'#66bb6a', gelb:'#ffb74d', rot:'#ef5350', na:'#78909c' };

function renderRueckAmpel(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-rueck');
  if (!el || !varianten?.length) return;

  const rows = varianten.filter(v => v.rueck);
  if (!rows.length) { el.innerHTML = ''; return; }

  const r0 = rows[0].rueck;
  const anschlussKw = r0.anschlussKw, skKVA = r0.skKVA, uBudget = r0.uBudgetPct;
  const sZul = skKVA > 0 ? uBudget / 100 * skKVA : null;   // spannungslimitierte Einspeiseleistung

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(440, elW - 4);
  const H   = overrideEl ? 60 + rows.length * 46 : 50 + rows.length * 34;
  const PL = 132, PT = 16, PR = 150, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB;
  const barH = Math.min(overrideEl ? 26 : 18, cH / rows.length - 6);
  const rowH = cH / rows.length;

  const maxVal = Math.max(...rows.map(v => v.rueck.maxKw), anschlussKw || 0, sZul || 0, 1) * 1.08;
  const xS = v => PL + (v / maxVal) * cW;

  // Verdikt-Banner
  const rot  = rows.filter(v => v.rueck.ampel === 'rot');
  const gelb = rows.filter(v => v.rueck.ampel === 'gelb');
  const na   = r0.ampel === 'na';
  let banner;
  if (na) {
    banner = `<div style="background:rgba(120,144,156,0.12);border-left:3px solid #78909c;padding:7px 10px;border-radius:5px;font-size:9px;color:var(--muted);">
      Für die Bewertung <b style="color:var(--text)">S_k″</b> (Netzauskunft des VNB) und/oder die <b style="color:var(--text)">Max. Einspeisung</b> oben eingeben.
      Beurteilt wird dann die Rückspeisespitze gegen Spannungsband (Δu) und Anschlusskapazität.</div>`;
  } else if (rot.length) {
    banner = `<div style="background:rgba(239,83,80,0.12);border-left:3px solid #ef5350;padding:7px 10px;border-radius:5px;font-size:9px;color:#ef9a9a;">
      <b>Netzanschluss-Verstärkung notwendig</b> für: <b style="color:#fff">${rot.map(v=>v.label).join(', ')}</b>.
      Die Rückspeisespitze überschreitet Spannungsband (Δu &gt; ${uBudget} %) bzw. Anschlusskapazität → größere Übergabestation/Trafo, eigene bzw. verstärkte Anschlussleitung zum MS-Netz und/oder internes Erzeugungsnetz. Abregelung oder Speicher allein lösen es nicht.</div>`;
  } else if (gelb.length) {
    banner = `<div style="background:rgba(255,183,77,0.12);border-left:3px solid #ffb74d;padding:7px 10px;border-radius:5px;font-size:9px;color:#ffcc80;">
      <b>Grenzfall</b> bei: <b style="color:#fff">${gelb.map(v=>v.label).join(', ')}</b>.
      Abregelung, NAP-Ertüchtigung und Erzeugungsnetz wirtschaftlich gegeneinander abwägen.</div>`;
  } else {
    banner = `<div style="background:rgba(102,187,106,0.12);border-left:3px solid #66bb6a;padding:7px 10px;border-radius:5px;font-size:9px;color:#a5d6a7;">
      <b>Kein Erzeugungsnetz erforderlich</b> — alle Varianten bleiben innerhalb von Spannungsband und Anschlusskapazität.</div>`;
  }

  const bars = rows.map((v, i) => {
    const rk = v.rueck;
    const y = PT + i * rowH + (rowH - barH) / 2;
    const col = _AMPEL_COL[rk.ampel] || '#78909c';
    const w = xS(rk.maxKw) - PL;
    const duTxt = rk.deltaU != null ? `Δu ${rk.deltaU.toFixed(1)} %` : 'Δu —';
    const dot = `<tspan fill="${col}">●</tspan>`;
    return `
      <text x="${PL-6}" y="${(y+barH/2+3).toFixed(1)}" text-anchor="end" fill="${v.farbe}" font-size="9" font-weight="600">${v.icon} ${v.label.length>15?v.label.slice(0,14)+'…':v.label}</text>
      <rect x="${PL}" y="${y.toFixed(1)}" width="${Math.max(1,w).toFixed(1)}" height="${barH}" fill="${col}" opacity="0.88" rx="2"/>
      <text x="${(PL+Math.max(1,w)+6).toFixed(1)}" y="${(y+barH/2-1).toFixed(1)}" fill="var(--text)" font-size="8.5" font-weight="600">${Math.round(rk.maxKw)} kW</text>
      <text x="${(PL+Math.max(1,w)+6).toFixed(1)}" y="${(y+barH/2+9).toFixed(1)}" fill="#90a4ae" font-size="7.5">${dot} ${duTxt} · ${Math.round(rk.stunden)} h/a</text>`;
  }).join('');

  const refLine = (val, color, label) => val == null ? '' : `
    <line x1="${xS(val).toFixed(1)}" y1="${PT-4}" x2="${xS(val).toFixed(1)}" y2="${(PT+cH).toFixed(1)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.85"/>
    <text x="${xS(val).toFixed(1)}" y="${PT-6}" text-anchor="middle" fill="${color}" font-size="8">${label} ${Math.round(val)} kW</text>`;

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 6 — Rückspeise- &amp; Erzeugungsnetz-Bewertung
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Rückspeisespitze am NAP (Batterie schert sie) gegen Spannungsband &amp; Anschlusskapazität</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="rueck" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <div style="margin-bottom:10px;">${banner}</div>
  <svg width="${W}" height="${H}" style="display:block;overflow:visible;">
    ${refLine(anschlussKw, '#ef5350', 'Anschluss')}
    ${refLine(sZul, '#ffb74d', 'Δu-Grenze')}
    ${bars}
    <line x1="${PL}" y1="${(PT+cH).toFixed(1)}" x2="${(PL+cW).toFixed(1)}" y2="${(PT+cH).toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
    ${[0,0.25,0.5,0.75,1].map(f=>`<text x="${(PL+f*cW).toFixed(1)}" y="${(PT+cH+12).toFixed(1)}" text-anchor="middle" fill="#607d8b" font-size="8">${Math.round(f*maxVal)}</text>`).join('')}
    <text x="${(PL+cW/2).toFixed(1)}" y="${(PT+cH+24).toFixed(1)}" text-anchor="middle" fill="#607d8b" font-size="8">Rückspeisespitze (kW)</text>
  </svg>
  <div style="font-size:8px;color:var(--muted);margin-top:4px;">
    Δu ≈ 100 · P_rück / S_k″ (Screening, cos φ ≈ 1) · Ampel: <span style="color:#66bb6a">grün</span> unkritisch · <span style="color:#ffb74d">gelb</span> Grenzfall · <span style="color:#ef5350">rot</span> Erzeugungsnetz/MS nötig
  </div>`;

  const fsBtn = el.querySelector('[data-pva-fs="rueck"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Rückspeise- & Erzeugungsnetz-Bewertung', cnt => renderRueckAmpel(window._pvAnalyse.ergebnisse, cnt)));
}

// ── Abb. 7 — Interaktives Energieflussdiagramm (Sankey) mit PV/Batterie-Slidern ─
// Zeigt für eine frei wählbare (PV × Batterie)-Kombination, wohin die Energie
// fließt. Varianten-Sprungmarken setzen beide Slider auf eine Variante; Ziehen der
// Slider zeigt live, wie sich Eigenverbrauch, Einspeisung, Abregelung verschieben.

function renderEnergieFluss(demandH, pvProfile, napParams, params, varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-fluss');
  if (!el) return;

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const spez   = pvGetSpez();
  const spotH  = window.elSpotPreiseH || window._pvAnalyse.spotPreise || null;
  const kanon  = (varianten || []).filter(v => v.info && v.info.frage);
  const varBat = Math.max(0, ...kanon.map(v => v.batKwh));
  const batMax = Math.min(Math.max(1500, Math.round(varBat * 1.3 / 500) * 500), 12000);

  // Startwerte: wirtschaftlich optimierte Variante (oder erste)
  const start = kanon.find(v => v.id === 'wirt-opt') || kanon[0] || { pvKwp: Math.round(maxKwp/2), batKwh: 0 };

  const COL = { ev:'#66bb6a', es:'#42a5f5', ct:'#ff9800', nb:'#ef5350', vl:'#78909c', pv:'#fdd835' };
  const pvStep  = 1;   // fein, damit Varianten-Sprungmarken exakt getroffen werden
  const batStep = 5;

  const chips = kanon.map(v =>
    `<button data-fluss-var="${v.pvKwp}|${v.batKwh}" title="${v.label}"
      style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid ${v.farbe};border-radius:10px;background:transparent;color:${v.farbe};font-size:9px;cursor:pointer;white-space:nowrap;">
      ${v.icon} ${Math.round(v.pvKwp)} kWp${v.batKwh>0?` · ${(v.batKwh/1000).toFixed(v.batKwh<1000?2:1)} MWh`:''}</button>`).join('');

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 7 — Energiefluss bei frei wählbarer Auslegung
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Slider ziehen oder Variante wählen — die Flüsse aktualisieren sich live</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="fluss" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:8px;align-items:center;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">PV-Leistung</span>
      <input id="pva-fluss-pv" type="range" min="0" max="${Math.round(maxKwp)}" step="${pvStep}" value="${Math.round(start.pvKwp)}" style="flex:1;accent-color:${COL.pv};">
      <span id="pva-fluss-pv-val" style="font-size:9px;color:${COL.pv};font-family:'DM Mono',monospace;width:62px;text-align:right;">${Math.round(start.pvKwp)} kWp</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">Batterie</span>
      <input id="pva-fluss-bat" type="range" min="0" max="${Math.round(batMax)}" step="${batStep}" value="${Math.round(start.batKwh)}" style="flex:1;accent-color:${COL.es};">
      <span id="pva-fluss-bat-val" style="font-size:9px;color:${COL.es};font-family:'DM Mono',monospace;width:62px;text-align:right;">${(start.batKwh/1000).toFixed(2)} MWh</span>
    </div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${chips}</div>
  <div id="pva-fluss-kpi" style="font-size:9px;color:var(--muted);margin-bottom:6px;"></div>
  <div id="pva-fluss-svg" style="overflow:hidden;"></div>`;

  const svgWrap = el.querySelector('#pva-fluss-svg');
  const pvIn  = el.querySelector('#pva-fluss-pv');
  const batIn = el.querySelector('#pva-fluss-bat');

  function drawSankey(pv, bat) {
    // Gleiche Strategie wie die Varianten/Tabelle: spot-dyn (falls Spotpreise) lädt
    // jetzt ebenfalls für den Eigenverbrauch → größere Batterie senkt Einspeisung UND
    // Netzbezug, konsistent zur Tabelle.
    const strat = bat > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';
    const ertrag = pv * spez / 1000;
    const sim  = pvNapSim(pv, bat, demandH, pvProfile, napParams, strat, spotH);
    const wirt = pvWirtschaft(pv, bat, sim, ertrag, params, strat);
    const eigen = sim.eigenMwh, einsp = sim.einspeiseMwh, curt = sim.curtailMwh || 0;
    const verl = sim.batVerlustMwh || 0, netz = sim.netzbezugMwh;
    const bedarf = eigen + netz;
    const pvSum  = eigen + einsp + curt + verl;       // ≈ Ertrag

    const W = Math.max(440, (svgWrap.getBoundingClientRect().width || 700) - 4);
    const H = overrideEl ? 360 : 260;
    const PT = 14, PB = 14;
    const cH = H - PT - PB;
    const xL = 70, barW = 16, xR = W - 150;
    const total = Math.max(pvSum + netz, 1);
    const gap = 10;
    const scale = (cH - 5 * gap) / total;             // 5 Lücken zwischen Bändern

    // Quell-Säule: PV (oben) + Netzbezug
    let yc = PT;
    const pvY = yc; const pvH = pvSum * scale; yc += pvH + gap;
    const nbY = yc; const nbH = netz * scale;
    // PV-Untersegmente (Reihenfolge: eigen, einspeise, curtail, verlust)
    let pc = pvY;
    const segEvS  = { y: pc, h: eigen * scale }; pc += segEvS.h;
    const segEsS  = { y: pc, h: einsp * scale }; pc += segEsS.h;
    const segCtS  = { y: pc, h: curt  * scale }; pc += segCtS.h;
    const segVlS  = { y: pc, h: verl  * scale };

    // Senken-Säule: Bedarf, Einspeisung, Abregelung, Verlust
    let yt = PT;
    const bedY = yt; const bedH = bedarf * scale; yt += bedH + gap;
    const esY  = yt; const esH = einsp * scale; yt += esH + (einsp>0?gap:0);
    const ctY  = yt; const ctH = curt  * scale; yt += ctH + (curt>0?gap:0);
    const vlY  = yt; const vlH = verl  * scale;
    // Bedarf-Untersegmente: eigen (oben) + netz
    const segEvT = { y: bedY, h: eigen * scale };
    const segNbT = { y: bedY + segEvT.h, h: netz * scale };

    const ribbon = (y0s, h_s, y0t, h_t, color) => {
      if (h_s < 0.3 && h_t < 0.3) return '';
      const x0 = xL + barW, x1 = xR, mx = (x0 + x1) / 2;
      const a0 = y0s, a1 = y0s + h_s, b0 = y0t, b1 = y0t + h_t;
      return `<path d="M${x0},${a0.toFixed(1)} C${mx},${a0.toFixed(1)} ${mx},${b0.toFixed(1)} ${x1},${b0.toFixed(1)} L${x1},${b1.toFixed(1)} C${mx},${b1.toFixed(1)} ${mx},${a1.toFixed(1)} ${x0},${a1.toFixed(1)} Z" fill="${color}" opacity="0.42"/>`;
    };
    const node = (x, y, h, color) => h > 0.3 ? `<rect x="${x}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${color}" rx="1.5"/>` : '';
    const lbl  = (x, y, h, txt, val, color, anchor) => h > 6 ? `<text x="${x}" y="${(y+h/2-2).toFixed(1)}" text-anchor="${anchor}" fill="${color}" font-size="9" font-weight="600">${txt}</text><text x="${x}" y="${(y+h/2+9).toFixed(1)}" text-anchor="${anchor}" fill="#90a4ae" font-size="8">${Math.round(val)} MWh</text>` : '';

    const fmt = n => Math.round(n).toLocaleString('de-DE');
    svgWrap.innerHTML = `
    <svg width="${W}" height="${H}" style="display:block;overflow:visible;">
      ${ribbon(segEvS.y, segEvS.h, segEvT.y, segEvT.h, COL.ev)}
      ${ribbon(segEsS.y, segEsS.h, esY, esH, COL.es)}
      ${ribbon(segCtS.y, segCtS.h, ctY, ctH, COL.ct)}
      ${ribbon(segVlS.y, segVlS.h, vlY, vlH, COL.vl)}
      ${ribbon(nbY, nbH, segNbT.y, segNbT.h, COL.nb)}
      ${node(xL, pvY, pvH, COL.pv)}
      ${node(xL, nbY, nbH, COL.nb)}
      ${node(xR, bedY, bedH, '#90a4ae')}
      ${node(xR, esY, esH, COL.es)}
      ${node(xR, ctY, ctH, COL.ct)}
      ${node(xR, vlY, vlH, COL.vl)}
      ${lbl(xL-6, pvY, pvH, 'PV-Erzeugung', pvSum, COL.pv, 'end')}
      ${lbl(xL-6, nbY, nbH, 'Netzbezug', netz, COL.nb, 'end')}
      ${lbl(xR+barW+6, bedY, bedH, 'Bedarf', bedarf, '#cfd8dc', 'start')}
      ${lbl(xR+barW+6, esY, esH, 'Einspeisung', einsp, COL.es, 'start')}
      ${lbl(xR+barW+6, ctY, ctH, 'Abregelung', curt, COL.ct, 'start')}
      ${lbl(xR+barW+6, vlY, vlH, 'Speicherverlust', verl, COL.vl, 'start')}
    </svg>`;

    // KPI-Zeile
    const kpi = el.querySelector('#pva-fluss-kpi');
    if (kpi) kpi.innerHTML =
      `<span style="color:${COL.ev}">EV-Quote ${wirt.pvEigenQuote.toFixed(0)} %</span> · ` +
      `<span style="color:#4fc3f7">Autarkie ${wirt.autarkie.toFixed(0)} %</span> · ` +
      `<span style="color:${COL.ct}">Abregelung ${curt.toFixed(0)} MWh</span> · ` +
      `<span style="color:${wirt.nettoJk<0?'#66bb6a':'#ef9a9a'}">Überschuss ${fmt(-wirt.nettoJk/1000)} k€/a</span> · ` +
      `<span style="color:var(--muted)">Amort. ${isFinite(wirt.amort)?wirt.amort.toFixed(1)+' a':'> 20 a'}</span>`;
  }

  function sync() {
    const pv = parseFloat(pvIn.value) || 0, bat = parseFloat(batIn.value) || 0;
    el.querySelector('#pva-fluss-pv-val').textContent = Math.round(pv) + ' kWp';
    el.querySelector('#pva-fluss-bat-val').textContent = (bat/1000).toFixed(2) + ' MWh';
    drawSankey(pv, bat);
  }
  pvIn.addEventListener('input', sync);
  batIn.addEventListener('input', sync);
  el.querySelectorAll('[data-fluss-var]').forEach(b => b.addEventListener('click', () => {
    const [p, q] = b.dataset.flussVar.split('|').map(parseFloat);
    pvIn.value = Math.round(p); batIn.value = Math.round(q); sync();
  }));
  sync();

  const fsBtn = el.querySelector('[data-pva-fs="fluss"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Energiefluss bei frei wählbarer Auslegung', cnt =>
      renderEnergieFluss(_pvFsArgs.demandH, _pvFsArgs.pvProfile, _pvFsArgs.napParams, _pvFsArgs.params, window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

// ── Abb. 8 — Autarkie-Heatmap: Jahresverlauf der Bedarfsdeckung durch PV + Speicher ─
// Tag (x) × Stunde (y), Farbe = Deckungsgrad je Stunde (grün = vollständig PV/Batterie,
// rot = vollständig Netzbezug). Variante per Tab wählbar.

const _PVAH_MONTH_DAYS  = [31,28,31,30,31,30,31,31,30,31,30,31];
const _PVAH_MONTH_NAMES = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

function _pvahDayToDate(dayIdx) {
  let m = 0, d = Math.max(0, Math.min(364, dayIdx));
  while (m < 11 && d >= _PVAH_MONTH_DAYS[m]) { d -= _PVAH_MONTH_DAYS[m]; m++; }
  return `${d + 1}. ${_PVAH_MONTH_NAMES[m]}`;
}

// Deckungsgrad (0..1) → Farbe: rot (0 %) → gelb (50 %) → grün (100 %)
function _pvahColor(v) {
  v = Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  let r, g, b;
  if (v < 0.5) {
    const t = v / 0.5;
    r = lerp(239, 255, t); g = lerp(83, 213, t); b = lerp(80, 79, t);
  } else {
    const t = (v - 0.5) / 0.5;
    r = lerp(255, 102, t); g = lerp(213, 187, t); b = lerp(79, 106, t);
  }
  return `rgb(${r},${g},${b})`;
}

// Stündlicher Deckungsgrad aus deckungArr (mittelt 15-min-Schritte falls nötig)
function _pvahHourly(deckungArr, dt) {
  if (dt === 1) return deckungArr;
  const stepsPerHour = Math.round(1 / dt);
  const nHours = Math.floor(deckungArr.length / stepsPerHour);
  const out = new Float32Array(nHours);
  for (let h = 0; h < nHours; h++) {
    let s = 0;
    for (let k = 0; k < stepsPerHour; k++) s += deckungArr[h * stepsPerHour + k];
    out[h] = s / stepsPerHour;
  }
  return out;
}

let _pvahVarId = null;
let _pvahPvKwp = null;
let _pvahBatKwh = null;

function renderAutarkieHeatmap(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-autarkie-heatmap');
  if (!el || !varianten?.length) return;

  const demandH   = _pvFsArgs?.demandH;
  const pvProfile = _pvFsArgs?.pvProfile;
  const napParams = _pvFsArgs?.napParams;
  if (!demandH || !pvProfile) { el.innerHTML = ''; return; }
  const spotH  = window.elSpotPreiseH || window._pvAnalyse.spotPreise || null;
  const kanon  = varianten.filter(v => v.info && v.info.frage);

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const varBat = Math.max(0, ...kanon.map(v => v.batKwh));
  const batMax = Math.min(Math.max(1500, Math.round(varBat * 1.3 / 500) * 500), 12000);
  const pvStep = 1, batStep = 5;
  const COL = { pv: '#fdd835', es: '#42a5f5' };

  // Startwerte: aktuell gewählte Variante (oder wirtschaftlich optimiert / erste)
  if (!_pvahVarId || !kanon.some(v => v.id === _pvahVarId)) {
    const start = kanon.find(v => v.id === 'autarkie') || kanon[0] || varianten[0];
    _pvahVarId  = start.id;
    _pvahPvKwp  = start.pvKwp;
    _pvahBatKwh = start.batKwh;
  }
  if (_pvahPvKwp == null || _pvahBatKwh == null) {
    const v = kanon.find(v => v.id === _pvahVarId) || varianten[0];
    _pvahPvKwp  = v.pvKwp;
    _pvahBatKwh = v.batKwh;
  }

  const dt = demandH.length > 8784 ? 0.25 : 1.0;

  // Tabs zur Varianten-Sprungmarke (setzen beide Slider auf die Variante)
  const tabs = kanon.map(v =>
    `<button data-pvah-var="${v.pvKwp}|${v.batKwh}" title="${v.label}"
      style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid ${v.farbe};border-radius:10px;background:transparent;color:${v.farbe};font-size:9px;cursor:pointer;white-space:nowrap;">
      ${v.icon} ${Math.round(v.pvKwp)} kWp${v.batKwh>0?` · ${(v.batKwh/1000).toFixed(v.batKwh<1000?2:1)} MWh`:''}</button>`).join('');

  const elW = el.getBoundingClientRect().width || 700;
  const W = Math.max(420, elW - 4);
  const H = overrideEl ? 360 : 220;

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:10px;flex-wrap:wrap;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 8 — Autarkie-Heatmap: Bedarfsdeckung durch PV + Speicher im Jahresverlauf
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Slider ziehen oder Variante wählen — die Heatmap aktualisiert sich live</span>
      <span id="pva-pvah-sub" style="display:block;font-size:8px;color:#a5d6a7;margin-top:2px;"></span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="autarkie-heatmap" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;flex-shrink:0;">⤢</button>'}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:8px;align-items:center;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">PV-Leistung</span>
      <input id="pva-pvah-pv" type="range" min="0" max="${Math.round(maxKwp)}" step="${pvStep}" value="${Math.round(_pvahPvKwp)}" style="flex:1;accent-color:${COL.pv};">
      <span id="pva-pvah-pv-val" style="font-size:9px;color:${COL.pv};font-family:'DM Mono',monospace;width:62px;text-align:right;">${Math.round(_pvahPvKwp)} kWp</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">Batterie</span>
      <input id="pva-pvah-bat" type="range" min="0" max="${Math.round(batMax)}" step="${batStep}" value="${Math.round(_pvahBatKwh)}" style="flex:1;accent-color:${COL.es};">
      <span id="pva-pvah-bat-val" style="font-size:9px;color:${COL.es};font-family:'DM Mono',monospace;width:62px;text-align:right;">${(_pvahBatKwh/1000).toFixed(2)} MWh</span>
    </div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${tabs}</div>
  <div id="pva-pvah-svg"></div>`;

  const svgWrap = el.querySelector('#pva-pvah-svg');
  const pvIn  = el.querySelector('#pva-pvah-pv');
  const batIn = el.querySelector('#pva-pvah-bat');
  const subEl = el.querySelector('#pva-pvah-sub');

  function draw(pv, bat) {
    const strat = bat > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';
    const sim    = pvNapSim(pv, bat, demandH, pvProfile, napParams, strat, spotH);
    const hourly = _pvahHourly(sim.deckungArr, dt);
    const nDays  = Math.floor(hourly.length / 24);

    const PL = 30, PT = 24, PR = 16, PB = 30;
    const cW = W - PL - PR, cH = H - PT - PB;
    const cellW = cW / nDays, cellH = cH / 24;

    // Zellen
    let cells = '';
    for (let d = 0; d < nDays; d++) {
      for (let h = 0; h < 24; h++) {
        const v = hourly[d * 24 + h] ?? 1;
        const x = PL + d * cellW, y = PT + h * cellH;
        cells += `<rect data-pvah-day="${d}" data-pvah-hour="${h}" data-pvah-val="${v.toFixed(4)}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellW + 0.3).toFixed(2)}" height="${(cellH + 0.3).toFixed(2)}" fill="${_pvahColor(v)}"/>`;
      }
    }

    // Monatsmarken
    let monthMarks = '';
    let cum = 0;
    for (let m = 0; m < 12; m++) {
      const x = PL + cum * cellW;
      const wMonth = _PVAH_MONTH_DAYS[m] * cellW;
      monthMarks += `<text x="${(x + wMonth / 2).toFixed(1)}" y="${(PT - 7).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="8">${_PVAH_MONTH_NAMES[m]}</text>`;
      if (m > 0) monthMarks += `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT + cH).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
      cum += _PVAH_MONTH_DAYS[m];
    }

    // Stundenmarken
    const hourMarks = [0, 6, 12, 18].map(h =>
      `<text x="${(PL - 5).toFixed(1)}" y="${(PT + h * cellH + cellH / 2 + 3).toFixed(1)}" text-anchor="end" fill="#90a4ae" font-size="8">${h}</text>`
    ).join('');

    // Legende: Farbverlauf
    const legW = 120, legH = 8;
    const legX = PL, legY = PT + cH + 16;
    const gradId = 'pvah-grad-' + (overrideEl ? 'fs' : 'm');
    const gradStops = `<stop offset="0%" stop-color="${_pvahColor(0)}"/><stop offset="50%" stop-color="${_pvahColor(0.5)}"/><stop offset="100%" stop-color="${_pvahColor(1)}"/>`;

    // Kennzahl: Anteil vollständig autarker Stunden
    let fullCount = 0;
    for (let i = 0; i < hourly.length; i++) if (hourly[i] >= 0.999) fullCount++;
    const fullPct = (fullCount / hourly.length * 100).toFixed(0);

    // Aktuelle Konfiguration einer kanonischen Variante zuordnen (für Label/Farbe)
    const match = kanon.find(v => v.pvKwp === pv && v.batKwh === bat);
    const farbe = match ? match.farbe : COL.pv;
    const label = match ? `${match.icon} ${match.label}` : 'Eigene Auslegung';
    if (subEl) subEl.textContent = `${fullPct} % der Stunden im Jahr vollständig autark (${label})`;

    svgWrap.innerHTML = `
    <svg width="${W}" height="${H + 24}" style="display:block;overflow:hidden;cursor:default;">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">${gradStops}</linearGradient></defs>
      ${monthMarks}
      ${hourMarks}
      ${cells}
      <rect x="${PL}" y="${(PT + cH + 1).toFixed(1)}" width="${cW.toFixed(1)}" height="${cH.toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
      <rect x="${legX}" y="${legY}" width="${legW}" height="${legH}" fill="url(#${gradId})" rx="2"/>
      <text x="${legX}" y="${(legY + legH + 10)}" fill="#90a4ae" font-size="8">0&thinsp;% gedeckt</text>
      <text x="${(legX + legW).toFixed(1)}" y="${(legY + legH + 10)}" text-anchor="end" fill="#90a4ae" font-size="8">100&thinsp;% gedeckt</text>
    </svg>`;

    const svg = svgWrap.querySelector('svg');
    svg.addEventListener('mousemove', ev => {
      const target = ev.target;
      if (!(target instanceof SVGRectElement) || target.dataset.pvahDay === undefined) { _pvHideTT(); return; }
      const day = +target.dataset.pvahDay, hour = +target.dataset.pvahHour, val = +target.dataset.pvahVal;
      _pvShowTT(ev,
        `<span style="color:${farbe};font-weight:700">${label}</span><br>` +
        `${_pvahDayToDate(day)}, ${hour}:00–${hour + 1}:00 Uhr<br>` +
        `Deckung: <strong>${(val * 100).toFixed(0)}&thinsp;%</strong> · Netzbezug: <strong>${(100 - val * 100).toFixed(0)}&thinsp;%</strong>`
      );
    });
    svg.addEventListener('mouseleave', _pvHideTT);
  }

  function sync() {
    const pv = parseFloat(pvIn.value) || 0, bat = parseFloat(batIn.value) || 0;
    _pvahPvKwp = pv; _pvahBatKwh = bat;
    el.querySelector('#pva-pvah-pv-val').textContent = Math.round(pv) + ' kWp';
    el.querySelector('#pva-pvah-bat-val').textContent = (bat/1000).toFixed(2) + ' MWh';
    draw(pv, bat);
  }
  pvIn.addEventListener('input', sync);
  batIn.addEventListener('input', sync);
  el.querySelectorAll('[data-pvah-var]').forEach(b => b.addEventListener('click', () => {
    const [p, q] = b.dataset.pvahVar.split('|').map(parseFloat);
    pvIn.value = Math.round(p); batIn.value = Math.round(q); sync();
  }));
  sync();

  const fsBtn = el.querySelector('[data-pva-fs="autarkie-heatmap"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Autarkie-Heatmap: Bedarfsdeckung durch PV + Speicher', cnt =>
      renderAutarkieHeatmap(window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

// ── Abb. 10 — Resilienz / Blackout-Analyse ──────────────────────────────────
// Frage: Wie autark ist die Anlage bei einem Netzausfall zum SCHLECHTESTEN
// Zeitpunkt? Inselbetrieb wird stündlich simuliert (Batterie startet voll, PV
// optional als Netzbildner, Generator deckt den Rest). Ergebnisse:
//   • Heatmap Tag×Stunde — wie viele Stunden Batterie+PV allein überbrücken,
//     wenn der Blackout zu diesem Zeitpunkt beginnt (dunkelrot = sofort am Limit).
//   • Worst-Case-Fenster im Detail — Lastdeckung (PV/Batterie/Generator), SOC,
//     benötigte Generator-Leistung und Sprit für die gewünschte Autarkie-Dauer.

// sfc = spez. Verbrauch bei VOLLLAST (l/kWh_el); idle = Leerlauf-Verbrauch als
// Anteil des Volllast-Verbrauchs. Teillast-Kennlinie (linear, branchenüblich):
//   l/h(P) = idle·Ff + (1−idle)·Ff·(P/Pnenn),  Ff = sfc·Pnenn  (Volllast-Rate l/h)
// Dadurch frisst ein auf die Spitzenlast ausgelegtes Aggregat bei Teillast
// deutlich mehr je kWh als der Volllast-Wert vermuten lässt (wet stacking).
const _PV_FUELS = {
  diesel: { label: 'Diesel',  sfc: 0.28, idle: 0.25, price: 1.70 },   // ~34 % Wirkungsgrad bei Volllast
  benzin: { label: 'Benzin',  sfc: 0.38, idle: 0.30, price: 1.85 },   // kleinere/ineffizientere Aggregate
  gas:    { label: 'Flüssiggas (LPG)', sfc: 0.50, idle: 0.25, price: 1.00 }, // geringere Energiedichte
};

// Kosten-Annahmen Resilienz (#7) — als Konstanten dokumentiert, leicht anpassbar.
const _PV_RES_COST = {
  gensetEurPerKw: 450,   // Diesel-Notstromaggregat inkl. Schaltung, €/kW (Richtwert)
  tankEurPerL:    1.50,  // doppelwandiger/aufgefangener Lagertank, € je Liter Volumen
  tankMargin:     1.15,  // Tank etwas größer als die reine Ereignis-Spritmenge
  meldeschwelleL: 1000,  // ab ~1000 l oberirdischer Diesellagerung: AwSV-Anzeige-/Auflagen
};

let _pvResVarId = null, _pvResPvKwp = null, _pvResBatKwh = null;
let _pvResDurH = null, _pvResPvOn = null, _pvResFuel = null, _pvResLoadFrac = null;
let _pvResGenMode = null;   // 'peak' (auf Spitzenlast) | 'buffer' (Generator lädt Batterie)
let _pvResUsable = null;    // nutzbare Batteriekapazität in % (Entladetiefe + Kälte-Derating)

// 15-min → stündlich mitteln (Leistungsgrößen)
function _pvResHourly(arr, dt) {
  if (dt === 1) return arr;
  const sph = Math.round(1 / dt), n = Math.floor(arr.length / sph);
  const out = new Float32Array(n);
  for (let h = 0; h < n; h++) { let s = 0; for (let k = 0; k < sph; k++) s += arr[h * sph + k]; out[h] = s / sph; }
  return out;
}

// Inselbetrieb ab Startstunde über durH Stunden. Batterie startet mit dem REALEN
// Ladestand initSoc (aus der Jahressimulation zum Ausfallzeitpunkt), Generator
// unbegrenzt. Liefert Überbrückungsdauer (Stunden bis Batterie+PV erstmals nicht
// reichen) und die Generator-Energie (kWh) zum Decken der Restlast.
function _pvResScan(loadH, pvH, batKwh, start, durH, nHours, initSoc, capFrac) {
  const ETA = 0.90, rate = batKwh > 0 ? batKwh / 2 : 0;
  const cap = batKwh * (capFrac ?? 1);            // nutzbare Kapazität (#5)
  let soc = Math.min(cap, initSoc), eGen = 0, bridge = durH, hit = false;
  for (let k = 0; k < durH; k++) {
    const t = (start + k) % nHours;
    const net = loadH[t] - pvH[t];
    if (net <= 0) {
      const c = Math.min(-net, rate, (cap - soc) / ETA);
      soc += c * ETA;
    } else {
      const fromBat = Math.min(net, rate, soc * ETA);
      soc -= fromBat / ETA;
      const resid = net - fromBat;
      if (resid > 0.001) { if (!hit) { bridge = k; hit = true; } eGen += resid; }
    }
  }
  return { bridge, eGen };
}

// Vollständige Insel-Simulation eines Fensters mit Generator und Treibstoff.
//  mode 'peak'   — Generator folgt der Last (deckt nur die Momentan-Restlast).
//                  Muss daher auf die Spitzenlast ausgelegt sein.
//  mode 'buffer' — Generator läuft zyklisch bei VOLLLAST (effizient) und lädt die
//                  Batterie mit; die Batterie puffert die Lastspitzen. Dadurch
//                  genügt ein Aggregat nahe der Durchschnittslast (#3).
// Liefert Energiebilanz, Treibstoff (Teillast-Kennlinie), Laufzeit, Schritt-Array.
function _pvResSim(loadEff, pvH, batKwh, genKw, start, durH, nHours, initSoc, fuel, mode, capFrac) {
  const ETA = 0.90, rate = batKwh > 0 ? batKwh / 2 : 0, cap = batKwh * (capFrac ?? 1);
  const Ff = fuel.sfc * genKw, idleRate = fuel.idle * Ff;   // l/h Voll-/Leerlauf
  let soc = Math.min(cap, initSoc);
  let eLoad = 0, ePv = 0, eBat = 0, eGen = 0, eUnmet = 0, liters = 0, genRunH = 0;
  const steps = [];
  for (let k = 0; k < durH; k++) {
    const t = (start + k) % nHours;
    const load = loadEff[t], pv = pvH[t];
    const pvToLoad = Math.min(pv, load);
    eLoad += load; ePv += pvToLoad;
    let bat = 0, gen = 0;
    const net = load - pv;
    if (net <= 0) {
      const c = Math.min(-net, rate, (cap - soc) / ETA); soc += c * ETA;
    } else {
      const batAvail = Math.min(rate, soc * ETA);
      if (mode === 'buffer' && genKw > 0) {
        // Generator deckt die Last und lädt die Batterie opportunistisch nach
        // (moduliert, max. genKw). Monoton: mehr genKw → nie mehr ungedeckte Last.
        const chargePot = Math.min(rate, (cap - soc) / ETA);   // kW, die die Batterie aufnehmen kann
        gen = Math.min(genKw, net + chargePot);
        const toLoad = Math.min(gen, net);
        const rem = net - toLoad;
        bat = Math.min(rem, batAvail); soc -= bat / ETA;
        if (rem - bat > 1e-6) eUnmet += rem - bat;
        const surplus = gen - toLoad;              // Generator-Überschuss lädt die Batterie
        if (surplus > 0) { const c = Math.min(surplus, chargePot); soc += c * ETA; }
        if (gen > 0.001) { liters += idleRate + (Ff - idleRate) * (gen / genKw); genRunH++; }
      } else if (mode === 'buffer') {              // genKw == 0 → reiner Batteriebetrieb
        bat = Math.min(net, batAvail); soc -= bat / ETA;
        if (net - bat > 1e-6) eUnmet += net - bat;
      } else {                                     // 'peak' — lastfolgend
        bat = Math.min(net, batAvail); soc -= bat / ETA;
        const resid = net - bat;
        gen = Math.min(resid, genKw);
        eUnmet += Math.max(0, resid - genKw);
        if (gen > 0.001 && genKw > 0) { liters += idleRate + (Ff - idleRate) * (gen / genKw); genRunH++; }
      }
    }
    eBat += bat; eGen += gen;
    steps.push({ t, load, pv: pvToLoad, bat, gen, soc });
  }
  return { eLoad, ePv, eBat, eGen, eUnmet, liters, genRunH, steps };
}

// Kleinste Generatorleistung (Batteriepuffer-Modus), die das Fenster vollständig
// deckt — Binärsuche zwischen 0 und der (immer ausreichenden) Spitzenlast.
function _pvResMinGen(loadEff, pvH, batKwh, start, durH, nHours, initSoc, fuel, peakLoad, capFrac) {
  if (batKwh <= 0) return peakLoad;                // ohne Puffer = Spitzenlast
  let lo = 0, hi = peakLoad;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const r = _pvResSim(loadEff, pvH, batKwh, mid, start, durH, nHours, initSoc, fuel, 'buffer', capFrac);
    if (r.eUnmet > 1e-3) lo = mid; else hi = mid;
  }
  return hi;
}

function renderResilienz(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-resilienz');
  if (!el || !varianten?.length) return;

  const demandH   = _pvFsArgs?.demandH;
  const pvProfile = _pvFsArgs?.pvProfile;
  const napParams = _pvFsArgs?.napParams || {};
  if (!demandH || !pvProfile) { el.innerHTML = ''; return; }
  const spotH = window.elSpotPreiseH || window._pvAnalyse?.spotPreise || null;
  const kanon = varianten.filter(v => v.info && v.info.frage);
  if (!kanon.length) { el.innerHTML = ''; return; }

  const spez = pvGetSpez();
  const dt   = demandH.length > 8784 ? 0.25 : 1.0;
  const loadH   = _pvResHourly(demandH, dt);
  const pvProfH = _pvResHourly(pvProfile, dt);
  const nHours  = Math.min(loadH.length, pvProfH.length);
  const nDays   = Math.floor(nHours / 24);

  // Startzustand
  if (!_pvResVarId || !kanon.some(v => v.id === _pvResVarId)) {
    const start = kanon.find(v => v.id === 'autarkie') || kanon[0];
    _pvResVarId = start.id; _pvResPvKwp = start.pvKwp; _pvResBatKwh = start.batKwh;
  }
  if (_pvResPvKwp  == null) _pvResPvKwp  = (kanon.find(v => v.id === _pvResVarId) || kanon[0]).pvKwp;
  if (_pvResBatKwh == null) _pvResBatKwh = (kanon.find(v => v.id === _pvResVarId) || kanon[0]).batKwh;
  if (_pvResDurH   == null) _pvResDurH = 24;
  if (_pvResPvOn   == null) _pvResPvOn = true;
  if (_pvResLoadFrac == null) _pvResLoadFrac = 100;
  if (_pvResUsable == null) _pvResUsable = 90;
  if (!_pvResGenMode) _pvResGenMode = 'peak';
  if (!_pvResFuel || !_PV_FUELS[_pvResFuel]) _pvResFuel = 'diesel';

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const varBat = Math.max(0, ...kanon.map(v => v.batKwh));
  const batMax = Math.min(Math.max(1500, Math.round(varBat * 1.3 / 500) * 500), 12000);
  const COL = { pv: '#fdd835', bat: '#42a5f5', gen: '#ff8f00', unmet: '#ef5350' };

  const DURS = [ [6,'6 h'], [12,'12 h'], [24,'24 h'], [48,'2 Tage'], [72,'3 Tage'], [168,'7 Tage'] ];

  const tabs = kanon.map(v =>
    `<button data-pvres-var="${v.pvKwp}|${v.batKwh}" title="${v.label}"
      style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid ${v.farbe};border-radius:10px;background:transparent;color:${v.farbe};font-size:9px;cursor:pointer;white-space:nowrap;">
      ${v.icon} ${Math.round(v.pvKwp)} kWp${v.batKwh>0?` · ${(v.batKwh/1000).toFixed(v.batKwh<1000?2:1)} MWh`:''}</button>`).join('');

  const durBtns = DURS.map(([h,lbl]) =>
    `<button data-pvres-dur="${h}" style="padding:2px 9px;border:1px solid ${h===_pvResDurH?'#ff8f00':'rgba(255,255,255,0.22)'};border-radius:10px;background:${h===_pvResDurH?'#ff8f00':'transparent'};color:${h===_pvResDurH?'#0a0e16':'#cfd8dc'};font-size:9px;cursor:pointer;font-weight:${h===_pvResDurH?'700':'400'};">${lbl}</button>`).join('');

  const fuelOpts = Object.entries(_PV_FUELS).map(([k,f]) =>
    `<option value="${k}" ${k===_pvResFuel?'selected':''}>${f.label}</option>`).join('');

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(440, elW - 4);
  const fmtEUR = n => Math.round(n).toLocaleString('de-DE');

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:10px;flex-wrap:wrap;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 10 — Resilienz: Autarkie bei Netzausfall zum schlechtesten Zeitpunkt
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Inselbetrieb simuliert — Batterie startet mit realem Ladestand (Jahressim.), Generator deckt die Restlast</span>
      <span id="pva-pvres-sub" style="display:block;font-size:8px;color:#ffcc80;margin-top:2px;"></span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="resilienz" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;flex-shrink:0;">⤢</button>'}
  </div>

  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
    <span style="font-size:9px;color:var(--muted);">Autark sein für</span>${durBtns}
    <label style="font-size:9px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;margin-left:6px;cursor:pointer;">
      <input id="pva-pvres-pvon" type="checkbox" ${_pvResPvOn?'checked':''} style="accent-color:${COL.pv};margin:0;"> PV im Inselbetrieb</label>
    <label style="font-size:9px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;margin-left:2px;">Aggregat
      <select id="pva-pvres-fuel" style="background:#11151d;color:#cfd8dc;border:1px solid rgba(255,255,255,0.2);border-radius:4px;font-size:9px;padding:1px 3px;">${fuelOpts}</select></label>
    <label style="font-size:9px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;margin-left:2px;"
      title="Spitzenlast: Generator deckt allein die höchste Last (batterieunabhängig). Batteriepuffer: Generator läuft effizient bei Volllast und lädt die Batterie mit → kleineres Aggregat genügt.">Dimensionierung
      <select id="pva-pvres-genmode" style="background:#11151d;color:#cfd8dc;border:1px solid rgba(255,255,255,0.2);border-radius:4px;font-size:9px;padding:1px 3px;">
        <option value="peak" ${_pvResGenMode==='peak'?'selected':''}>Spitzenlast</option>
        <option value="buffer" ${_pvResGenMode==='buffer'?'selected':''}>Batteriepuffer</option></select></label>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:8px;align-items:center;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">PV-Leistung</span>
      <input id="pva-pvres-pv" type="range" min="0" max="${Math.round(maxKwp)}" step="1" value="${Math.round(_pvResPvKwp)}" style="flex:1;accent-color:${COL.pv};">
      <span id="pva-pvres-pv-val" style="font-size:9px;color:${COL.pv};font-family:'DM Mono',monospace;width:62px;text-align:right;">${Math.round(_pvResPvKwp)} kWp</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">Batterie</span>
      <input id="pva-pvres-bat" type="range" min="0" max="${Math.round(batMax)}" step="5" value="${Math.round(_pvResBatKwh)}" style="flex:1;accent-color:${COL.bat};">
      <span id="pva-pvres-bat-val" style="font-size:9px;color:${COL.bat};font-family:'DM Mono',monospace;width:62px;text-align:right;">${(_pvResBatKwh/1000).toFixed(2)} MWh</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;" title="Im Inselbetrieb gedeckte Last als Anteil der Normallast (Notbetrieb = nur kritische Verbraucher)">
      <span style="font-size:9px;color:var(--muted);width:64px;">Notbetrieb</span>
      <input id="pva-pvres-load" type="range" min="10" max="100" step="5" value="${_pvResLoadFrac}" style="flex:1;accent-color:#ef9a9a;">
      <span id="pva-pvres-load-val" style="font-size:9px;color:#ef9a9a;font-family:'DM Mono',monospace;width:62px;text-align:right;">${_pvResLoadFrac} % Last</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;" title="Im Notfall tatsächlich nutzbarer Anteil der Nennkapazität — berücksichtigt Entladetiefe (DoD) und Kapazitätsverlust bei Kälte (Worst-Case = Winter)">
      <span style="font-size:9px;color:var(--muted);width:64px;">Nutzbare Kap.</span>
      <input id="pva-pvres-usable" type="range" min="50" max="100" step="5" value="${_pvResUsable}" style="flex:1;accent-color:#80cbc4;">
      <span id="pva-pvres-usable-val" style="font-size:9px;color:#80cbc4;font-family:'DM Mono',monospace;width:62px;text-align:right;">${_pvResUsable} %</span>
    </div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">${tabs}</div>

  <div id="pva-pvres-kpi" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
  <div id="pva-pvres-heat"></div>
  <div id="pva-pvres-detail" style="margin-top:8px;"></div>
  <div id="pva-pvres-tradeoff" style="margin-top:10px;"></div>`;

  const pvIn  = el.querySelector('#pva-pvres-pv');
  const batIn = el.querySelector('#pva-pvres-bat');
  const loadIn = el.querySelector('#pva-pvres-load');
  const subEl = el.querySelector('#pva-pvres-sub');
  const kpiEl = el.querySelector('#pva-pvres-kpi');
  const heatEl   = el.querySelector('#pva-pvres-heat');
  const detailEl = el.querySelector('#pva-pvres-detail');
  const tradeEl  = el.querySelector('#pva-pvres-tradeoff');

  function kpiCard(label, value, color) {
    return `<div style="flex:1;min-width:110px;background:#11151d;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 9px;">
      <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">${label}</div>
      <div style="font-size:14px;font-weight:700;color:${color};font-family:'DM Mono',monospace;">${value}</div></div>`;
  }

  function draw() {
    const pvKwp = parseFloat(pvIn.value) || 0;
    const batKwh = parseFloat(batIn.value) || 0;
    const durH = _pvResDurH;
    const pvOn = _pvResPvOn;
    const frac = _pvResLoadFrac / 100;
    const capFrac = _pvResUsable / 100;            // #5 nutzbare Batteriekapazität
    const fuel = _PV_FUELS[_pvResFuel];
    const ETA = 0.90;

    // PV-Leistungsprofil (kW) für diese Auslegung
    const pvH = new Float32Array(nHours);
    if (pvOn) for (let t = 0; t < nHours; t++) pvH[t] = pvProfH[t] * pvKwp * spez;
    // Im Inselbetrieb gedeckte Last (Notbetrieb = nur kritische Verbraucher)
    const loadEff = new Float32Array(nHours);
    for (let t = 0; t < nHours; t++) loadEff[t] = loadH[t] * frac;

    // #1 Realer Batterie-Ladestand bei Ausfall: aus der netzgekoppelten Jahres-
    //    simulation (Normalbetrieb) zum jeweiligen Startzeitpunkt übernommen.
    let socStart;
    if (batKwh > 0) {
      const strat = spotH ? 'spot-dyn' : 'ev';
      const yr = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strat, spotH);
      socStart = _pvResHourly(yr.batSocArr, dt);
    } else {
      socStart = new Float32Array(nHours);
    }
    const socAt = s => (socStart[s] ?? 0);

    // Scan: Überbrückungsdauer + Generator-Energie je Startstunde, Worst-Case = max. Generatorbedarf
    const bridgeArr = new Float32Array(nHours);
    let worstStart = 0, worstEGen = -1;
    for (let s = 0; s < nDays * 24; s++) {
      const r = _pvResScan(loadEff, pvH, batKwh, s, durH, nHours, socAt(s), capFrac);
      bridgeArr[s] = r.bridge;
      if (r.eGen > worstEGen) { worstEGen = r.eGen; worstStart = s; }
    }

    // Worst-Case-Fenster: Spitzenlast + Generatordimensionierung je nach Modus
    let peakLoad = 0;
    for (let k = 0; k < durH; k++) peakLoad = Math.max(peakLoad, loadEff[(worstStart + k) % nHours]);
    const initSoc = Math.min(batKwh * capFrac, socAt(worstStart));
    // #3 Batteriepuffer-Modus → kleinste ausreichende Generatorleistung
    const genKw = _pvResGenMode === 'buffer'
      ? _pvResMinGen(loadEff, pvH, batKwh, worstStart, durH, nHours, initSoc, fuel, peakLoad, capFrac)
      : peakLoad;
    const r = _pvResSim(loadEff, pvH, batKwh, genKw, worstStart, durH, nHours, initSoc, fuel, _pvResGenMode, capFrac);
    const { eLoad, ePv, eBat, eGen, eUnmet, liters, genRunH, steps } = r;
    const bridgeH = bridgeArr[worstStart] ?? durH;     // Überbrückung Batterie+PV allein
    const batAlt = eGen / ETA;            // Batterie-Mehrbedarf, um den Generator komplett zu ersetzen (kWh)
    const effSfc = eGen > 0 ? liters / eGen : 0;   // effektiver l/kWh inkl. Teillast
    const socStartPct = batKwh > 0 ? initSoc / batKwh * 100 : 0;

    // #7 Kosten der Resilienz-Auslegung
    const recGenKw   = Math.ceil(genKw * 1.2 / 5) * 5;          // Empfehlung inkl. 20 % Reserve
    const gensetCost = recGenKw * _PV_RES_COST.gensetEurPerKw;
    const tankL      = Math.ceil(liters * _PV_RES_COST.tankMargin / 50) * 50;
    const tankCost   = tankL * _PV_RES_COST.tankEurPerL;
    const fuelCost   = liters * fuel.price;
    const capexCost  = gensetCost + tankCost;
    const fmtK = v => v >= 10000 ? `${(v/1000).toFixed(0)} k€` : `${Math.round(v).toLocaleString('de-DE')} €`;

    // KPIs
    const dayIdx = Math.floor(worstStart / 24), hr = worstStart % 24;
    const endIdx = (worstStart + durH) % nHours, endDay = Math.floor(endIdx / 24), endHr = endIdx % 24;
    const genLabel = _pvResGenMode === 'buffer' ? 'Notstrom-Leistung (mit Puffer)' : 'Notstrom-Leistung (Spitze)';
    const hasGen = eGen > 0;
    kpiEl.innerHTML =
      kpiCard('Worst-Case-Start', `${_pvahDayToDate(dayIdx)}, ${hr}:00`, '#ffcc80') +
      kpiCard(genLabel, `${Math.ceil(genKw)} kW`, COL.gen) +
      kpiCard(`Sprit (${fuel.label})`, hasGen ? `${Math.ceil(liters).toLocaleString('de-DE')} l` : '0 l', COL.gen) +
      kpiCard('Überbrückung ohne Generator', bridgeH >= durH ? `> ${durH} h` : `${bridgeH} h`, bridgeH >= durH ? '#66bb6a' : COL.bat) +
      kpiCard('Energiebedarf im Fenster', `${(eLoad/1000).toFixed(2)} MWh`, '#cfd8dc') +
      // #7 Kosten-Karten
      kpiCard('Aggregat (Capex)', hasGen ? fmtK(gensetCost) : '–', '#a5d6a7') +
      kpiCard('Tankvolumen', hasGen ? `${tankL.toLocaleString('de-DE')} l` : '–', '#a5d6a7') +
      kpiCard('Resilienz-Capex', hasGen ? fmtK(capexCost) : '0 €', '#a5d6a7') +
      kpiCard('Spritkosten / Ereignis', hasGen ? fmtK(fuelCost) : '0 €', '#a5d6a7');

    subEl.innerHTML = `Schlechtestes ${durH}-h-Fenster: ${_pvahDayToDate(dayIdx)} ${hr}:00 → ${_pvahDayToDate(endDay)} ${endHr}:00`
      + ` · Batterie bei Ausfall ${socStartPct.toFixed(0)} % geladen · nutzbar ${_pvResUsable} %`
      + (frac < 1 ? ` · Notbetrieb ${_pvResLoadFrac} % der Last` : '')
      + (_pvResGenMode === 'buffer' ? ` · Generator lädt Batterie mit (Spitzenlast wäre ${Math.ceil(peakLoad)} kW)` : '')
      + ` · Deckung: PV ${(ePv/eLoad*100||0).toFixed(0)} % · Batterie ${(eBat/eLoad*100||0).toFixed(0)} % · Generator ${(eGen/eLoad*100||0).toFixed(0)} %`
      + (hasGen ? ` · Aggregat läuft ${genRunH} h, Ø ${effSfc.toFixed(2)} l/kWh` : '')
      + (hasGen ? ` · Empfehlung Aggregat ~${recGenKw} kW (inkl. 20 % Reserve)` : '')
      + (tankL > _PV_RES_COST.meldeschwelleL ? ` · ⚠ Tank > ${_PV_RES_COST.meldeschwelleL} l: AwSV-Anzeige/Auflagen beachten` : '')
      + (eUnmet > 0.01 ? ` · ⚠ ${(eUnmet/1000).toFixed(2)} MWh ungedeckt` : '')
      + ` · Annahmen: Aggregat ${_PV_RES_COST.gensetEurPerKw} €/kW · ${fuel.label} ${fuel.price.toFixed(2)} €/l · Tank ${_PV_RES_COST.tankEurPerL.toFixed(2)} €/l`;

    drawHeatmap(bridgeArr, durH, worstStart);
    drawDetail(steps, peakLoad, batKwh, durH, worstStart);
    // #6 Trade-off: Batteriegröße ↔ Generatorleistung ↔ Sprit im aktuellen Worst-Case-Fenster
    drawTradeoff(loadEff, pvH, worstStart, durH, peakLoad, batMax, batKwh, socStartPct / 100, fuel, capFrac);
  }

  function drawHeatmap(bridgeArr, durH, worstStart) {
    const H = overrideEl ? 230 : 170;
    const PL = 30, PT = 22, PR = 16, PB = 26;
    const cW = W - PL - PR, cH = H - PT - PB;
    const cellW = cW / nDays, cellH = cH / 24;
    let cells = '';
    for (let d = 0; d < nDays; d++) for (let h = 0; h < 24; h++) {
      const s = d * 24 + h, b = bridgeArr[s] ?? durH;
      const x = PL + d * cellW, y = PT + h * cellH;
      cells += `<rect data-pvres-day="${d}" data-pvres-hour="${h}" data-pvres-b="${b}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellW+0.3).toFixed(2)}" height="${(cellH+0.3).toFixed(2)}" fill="${_pvahColor(b/durH)}"/>`;
    }
    let monthMarks = '', cum = 0;
    for (let m = 0; m < 12; m++) {
      const x = PL + cum * cellW, wM = _PVAH_MONTH_DAYS[m] * cellW;
      monthMarks += `<text x="${(x+wM/2).toFixed(1)}" y="${(PT-6).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="8">${_PVAH_MONTH_NAMES[m]}</text>`;
      if (m > 0) monthMarks += `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT+cH).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
      cum += _PVAH_MONTH_DAYS[m];
    }
    const hourMarks = [0,6,12,18].map(h =>
      `<text x="${(PL-5).toFixed(1)}" y="${(PT+h*cellH+cellH/2+3).toFixed(1)}" text-anchor="end" fill="#90a4ae" font-size="8">${h}</text>`).join('');
    // Worst-Case-Markierung
    const wd = Math.floor(worstStart/24), wh = worstStart % 24;
    const wx = PL + wd*cellW, wy = PT + wh*cellH;
    const marker = `<rect x="${(wx-1).toFixed(1)}" y="${(wy-1).toFixed(1)}" width="${(cellW+2).toFixed(1)}" height="${(cellH+2).toFixed(1)}" fill="none" stroke="#fff" stroke-width="1.4"/>
      <text x="${Math.min(wx+4, W-PR-90).toFixed(1)}" y="${(wy<PT+cH/2 ? wy+cellH+10 : wy-3).toFixed(1)}" fill="#fff" font-size="8" font-weight="700">◀ Worst-Case</text>`;
    const legW = 130, legH = 8, legX = PL, legY = PT + cH + 14;
    const gradId = 'pvres-grad-' + (overrideEl ? 'fs' : 'm');
    heatEl.innerHTML = `
    <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Überbrückung Batterie+PV, wenn der Blackout zu diesem Zeitpunkt beginnt</div>
    <svg width="${W}" height="${H+18}" style="display:block;overflow:hidden;cursor:default;">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${_pvahColor(0)}"/><stop offset="50%" stop-color="${_pvahColor(0.5)}"/><stop offset="100%" stop-color="${_pvahColor(1)}"/></linearGradient></defs>
      ${monthMarks}${hourMarks}${cells}
      <rect x="${PL}" y="${(PT+cH+1).toFixed(1)}" width="${cW.toFixed(1)}" height="${cH.toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
      ${marker}
      <rect x="${legX}" y="${legY}" width="${legW}" height="${legH}" fill="url(#${gradId})" rx="2"/>
      <text x="${legX}" y="${(legY+legH+9)}" fill="#90a4ae" font-size="8">sofort am Limit</text>
      <text x="${(legX+legW).toFixed(1)}" y="${(legY+legH+9)}" text-anchor="end" fill="#90a4ae" font-size="8">≥ ${durH} h überbrückt</text>
    </svg>`;
    const svg = heatEl.querySelector('svg');
    svg.addEventListener('mousemove', ev => {
      const tg = ev.target;
      if (!(tg instanceof SVGRectElement) || tg.dataset.pvresDay === undefined) { _pvHideTT(); return; }
      const d = +tg.dataset.pvresDay, h = +tg.dataset.pvresHour, b = +tg.dataset.pvresB;
      _pvShowTT(ev, `Blackout-Start: ${_pvahDayToDate(d)}, ${h}:00 Uhr<br>überbrückbar (Batterie+PV): <strong>${b >= durH ? '≥ '+durH : b} h</strong>`);
    });
    svg.addEventListener('mouseleave', _pvHideTT);
  }

  function drawDetail(steps, peakLoad, batKwh, durH, worstStart) {
    const H = overrideEl ? 240 : 190;
    const PL = 38, PT = 14, PR = 40, PB = 28;
    const cW = W - PL - PR, cH = H - PT - PB;
    const n = steps.length, colW = cW / n;
    const yMax = peakLoad * 1.08 || 1;
    const yOf = kw => PT + cH - (kw / yMax) * cH;
    let bars = '';
    steps.forEach((s, i) => {
      const x = PL + i * colW;
      const hPv  = (s.pv  / yMax) * cH, hBat = (s.bat / yMax) * cH, hGen = (s.gen / yMax) * cH;
      let yb = PT + cH;
      const seg = (h, col) => { if (h <= 0) return ''; yb -= h; return `<rect x="${x.toFixed(2)}" y="${yb.toFixed(2)}" width="${(colW+0.4).toFixed(2)}" height="${h.toFixed(2)}" fill="${col}"/>`; };
      bars += `<g data-pvres-step="${i}">${seg(hPv,COL.pv)}${seg(hBat,COL.bat)}${seg(hGen,COL.gen)}</g>`;
    });
    // SOC-Linie (rechte Achse, 0..100 %)
    let socPts = '';
    if (batKwh > 0) socPts = steps.map((s, i) =>
      `${(PL + i*colW + colW/2).toFixed(1)},${(PT + cH - (s.soc/batKwh)*cH).toFixed(1)}`).join(' ');
    // Achsen
    const yticks = [0, 0.5, 1].map(f => {
      const y = yOf(yMax*f);
      return `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${(PL+cW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)"/>
        <text x="${(PL-4).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" fill="#90a4ae" font-size="8">${Math.round(yMax*f)}</text>`;
    }).join('');
    // Zeitmarken: ca. 6 Beschriftungen
    const stepLbl = Math.max(1, Math.round(durH / 6));
    let xmarks = '';
    for (let k = 0; k <= durH; k += stepLbl) {
      const x = PL + k*colW, gi = (worstStart + k) % nHours, gh = gi % 24;
      xmarks += `<text x="${x.toFixed(1)}" y="${(PT+cH+11).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="7.5">+${k}h</text>
        <text x="${x.toFixed(1)}" y="${(PT+cH+20).toFixed(1)}" text-anchor="middle" fill="#607d8b" font-size="7">${gh}:00</text>`;
    }
    const socLabel = batKwh > 0
      ? `<text x="${(PL+cW+4).toFixed(1)}" y="${(PT+8).toFixed(1)}" fill="${COL.bat}" font-size="8">SOC 100%</text>
         <text x="${(PL+cW+4).toFixed(1)}" y="${(PT+cH).toFixed(1)}" fill="${COL.bat}" font-size="8">0%</text>` : '';
    const legend = `
      <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;background:${COL.pv};border-radius:1px;"></span>PV</span>
      <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;background:${COL.bat};border-radius:1px;"></span>Batterie</span>
      <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;background:${COL.gen};border-radius:1px;"></span>Generator</span>
      <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:14px;height:2px;background:${COL.bat};"></span>Batterie-Ladestand</span>`;
    detailEl.innerHTML = `
    <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Worst-Case-Fenster im Detail — Lastdeckung je Stunde</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:8px;color:#cfd8dc;margin-bottom:3px;">${legend}</div>
    <svg width="${W}" height="${H}" style="display:block;overflow:visible;cursor:default;">
      ${yticks}${bars}
      ${socPts ? `<polyline points="${socPts}" fill="none" stroke="${COL.bat}" stroke-width="1.4" stroke-dasharray="3,2" opacity="0.9"/>` : ''}
      ${socLabel}${xmarks}
      <text x="${(PL-30).toFixed(1)}" y="${(PT+cH/2).toFixed(1)}" fill="#90a4ae" font-size="8" transform="rotate(-90 ${(PL-30).toFixed(1)} ${(PT+cH/2).toFixed(1)})" text-anchor="middle">Last (kW)</text>
    </svg>`;
    const svg = detailEl.querySelector('svg');
    svg.addEventListener('mousemove', ev => {
      const g = ev.target.closest?.('[data-pvres-step]');
      if (!g) { _pvHideTT(); return; }
      const s = steps[+g.dataset.pvresStep];
      _pvShowTT(ev,
        `+${+g.dataset.pvresStep} h (${s.t % 24}:00 Uhr)<br>` +
        `Last: <strong>${s.load.toFixed(1)} kW</strong><br>` +
        `<span style="color:${COL.pv}">PV ${s.pv.toFixed(1)}</span> · <span style="color:${COL.bat}">Batt ${s.bat.toFixed(1)}</span> · <span style="color:${COL.gen}">Gen ${s.gen.toFixed(1)}</span> kW<br>` +
        `Batterie-Ladestand: <strong>${batKwh>0?(s.soc/batKwh*100).toFixed(0):0} %</strong>`);
    });
    svg.addEventListener('mouseleave', _pvHideTT);
  }

  // #6 Trade-off-Kurve: wie tauscht man Batterie gegen Generatorleistung & Sprit?
  // Für das aktuelle Worst-Case-Fenster wird über Batteriegrößen iteriert; je
  // Punkt die kleinste ausreichende Generatorleistung (Batteriepuffer) + Sprit.
  function drawTradeoff(loadEff, pvH, worstStart, durH, peakLoad, batMax, batNow, socFrac, fuel, capFrac) {
    const N = 11;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const bk = batMax * i / (N - 1);
      const iSoc = bk * socFrac;          // gleicher Nominal-Ladestand wie aktueller Punkt
      const g = _pvResMinGen(loadEff, pvH, bk, worstStart, durH, nHours, iSoc, fuel, peakLoad, capFrac);
      const sim = _pvResSim(loadEff, pvH, bk, g, worstStart, durH, nHours, iSoc, fuel, 'buffer', capFrac);
      pts.push({ bat: bk, gen: g, liters: sim.liters });
    }
    const maxGen = Math.max(...pts.map(p => p.gen), 1);
    const maxLit = Math.max(...pts.map(p => p.liters), 1);
    const H = overrideEl ? 200 : 150;
    const PL = 40, PT = 12, PR = 46, PB = 30;
    const cW = W - PL - PR, cH = H - PT - PB;
    const xOf = b => PL + (batMax > 0 ? b / batMax : 0) * cW;
    const yGen = g => PT + cH - (g / maxGen) * cH;
    const yLit = l => PT + cH - (l / maxLit) * cH;
    const genLine = pts.map(p => `${xOf(p.bat).toFixed(1)},${yGen(p.gen).toFixed(1)}`).join(' ');
    const litLine = pts.map(p => `${xOf(p.bat).toFixed(1)},${yLit(p.liters).toFixed(1)}`).join(' ');
    const COLg = COL.gen, COLl = '#26c6da';
    let xticks = '';
    for (let i = 0; i <= 4; i++) {
      const b = batMax * i / 4, x = xOf(b);
      xticks += `<text x="${x.toFixed(1)}" y="${(PT+cH+11).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="7.5">${(b/1000).toFixed(1)}</text>`;
    }
    const dots = pts.map(p =>
      `<circle data-tobat="${p.bat.toFixed(0)}" data-togen="${p.gen.toFixed(1)}" data-tolit="${p.liters.toFixed(0)}" cx="${xOf(p.bat).toFixed(1)}" cy="${yGen(p.gen).toFixed(1)}" r="2.4" fill="${COLg}"/>`).join('');
    const dotsL = pts.map(p =>
      `<circle cx="${xOf(p.bat).toFixed(1)}" cy="${yLit(p.liters).toFixed(1)}" r="2.4" fill="${COLl}"/>`).join('');
    const nowX = xOf(batNow);
    const legend = `
      <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;height:2px;background:${COLg};"></span>nötige Generatorleistung (kW)</span>
      <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;height:2px;background:${COLl};"></span>Sprit im Fenster (l)</span>
      <span style="color:#90a4ae;">┊ aktuelle Batterie</span>`;
    tradeEl.innerHTML = `
    <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Trade-off im Worst-Case-Fenster — mehr Batterie senkt nötige Generatorleistung und Spritmenge (Batteriepuffer-Betrieb)</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:8px;color:#cfd8dc;margin-bottom:3px;">${legend}</div>
    <svg width="${W}" height="${H}" style="display:block;overflow:visible;cursor:default;">
      <line x1="${nowX.toFixed(1)}" y1="${PT}" x2="${nowX.toFixed(1)}" y2="${(PT+cH).toFixed(1)}" stroke="#fff" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>
      <polyline points="${genLine}" fill="none" stroke="${COLg}" stroke-width="1.6"/>
      <polyline points="${litLine}" fill="none" stroke="${COLl}" stroke-width="1.6"/>
      ${dots}${dotsL}
      <text x="${(PL-4).toFixed(1)}" y="${(PT+6).toFixed(1)}" text-anchor="end" fill="${COLg}" font-size="7.5">${Math.ceil(maxGen)}</text>
      <text x="${(PL-4).toFixed(1)}" y="${(PT+cH).toFixed(1)}" text-anchor="end" fill="${COLg}" font-size="7.5">0 kW</text>
      <text x="${(PL+cW+4).toFixed(1)}" y="${(PT+6).toFixed(1)}" fill="${COLl}" font-size="7.5">${Math.ceil(maxLit).toLocaleString('de-DE')}</text>
      <text x="${(PL+cW+4).toFixed(1)}" y="${(PT+cH).toFixed(1)}" fill="${COLl}" font-size="7.5">0 l</text>
      ${xticks}
      <text x="${(PL+cW/2).toFixed(1)}" y="${(PT+cH+24).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="8">Batteriekapazität (MWh)</text>
    </svg>`;
    const svg = tradeEl.querySelector('svg');
    svg.addEventListener('mousemove', ev => {
      const c = ev.target.closest?.('[data-tobat]');
      if (!c) { _pvHideTT(); return; }
      _pvShowTT(ev, `Batterie ${(+c.dataset.tobat/1000).toFixed(2)} MWh<br>` +
        `Generator: <strong>${Math.ceil(+c.dataset.togen)} kW</strong><br>` +
        `Sprit im Fenster: <strong>${(+c.dataset.tolit).toLocaleString('de-DE')} l</strong>`);
    });
    svg.addEventListener('mouseleave', _pvHideTT);
  }

  function sync() {
    _pvResPvKwp  = parseFloat(pvIn.value) || 0;
    _pvResBatKwh = parseFloat(batIn.value) || 0;
    el.querySelector('#pva-pvres-pv-val').textContent  = Math.round(_pvResPvKwp) + ' kWp';
    el.querySelector('#pva-pvres-bat-val').textContent = (_pvResBatKwh/1000).toFixed(2) + ' MWh';
    draw();
  }
  pvIn.addEventListener('input', sync);
  batIn.addEventListener('input', sync);
  loadIn.addEventListener('input', () => {
    _pvResLoadFrac = parseFloat(loadIn.value) || 100;
    el.querySelector('#pva-pvres-load-val').textContent = _pvResLoadFrac + ' % Last';
    draw();
  });
  el.querySelector('#pva-pvres-usable').addEventListener('input', e => {
    _pvResUsable = parseFloat(e.target.value) || 90;
    el.querySelector('#pva-pvres-usable-val').textContent = _pvResUsable + ' %';
    draw();
  });
  el.querySelector('#pva-pvres-pvon').addEventListener('change', e => { _pvResPvOn = e.target.checked; draw(); });
  el.querySelector('#pva-pvres-fuel').addEventListener('change', e => { _pvResFuel = e.target.value; draw(); });
  el.querySelector('#pva-pvres-genmode').addEventListener('change', e => { _pvResGenMode = e.target.value; draw(); });
  el.querySelectorAll('[data-pvres-dur]').forEach(b => b.addEventListener('click', () => {
    _pvResDurH = +b.dataset.pvresDur; renderResilienz(varianten, overrideEl);
  }));
  el.querySelectorAll('[data-pvres-var]').forEach(b => b.addEventListener('click', () => {
    const [p, q] = b.dataset.pvresVar.split('|').map(parseFloat);
    pvIn.value = Math.round(p); batIn.value = Math.round(q); sync();
  }));
  draw();

  const fsBtn = el.querySelector('[data-pva-fs="resilienz"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Resilienz: Autarkie bei Netzausfall', cnt =>
      renderResilienz(window._pvAnalyse.ergebnisse, cnt)));
}

// ── Abb. 9 — Sensitivitätsanalyse (Tornado) ─────────────────────────────────
// Zeigt für eine Referenz-Variante, wie stark der Jahresüberschuss (−nettoJk) auf
// Unsicherheit in den Wirtschaftsannahmen reagiert. Da bei fester Auslegung nur die
// Wirtschaftsrechnung (nicht die physikalische Simulation) von Preisen/Invest/Zins
// abhängt, wird die bereits berechnete sim der Variante wiederverwendet — sehr günstig.

let _pvSensVarId = null;

function renderSensitivitaet(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-sensitivitaet');
  if (!el || !varianten?.length) return;

  const baseParams = _pvFsArgs?.params;
  if (!baseParams) { el.innerHTML = ''; return; }

  const kanon = varianten.filter(v => v.info && v.info.frage);
  if (!kanon.length) { el.innerHTML = ''; return; }

  if (!_pvSensVarId || !kanon.some(v => v.id === _pvSensVarId)) {
    _pvSensVarId = (kanon.find(v => v.id === 'wirt-opt') || kanon[0]).id;
  }
  const v = kanon.find(x => x.id === _pvSensVarId) || kanon[0];

  // Überschuss (€/a) für gegebene (überschriebene) Parameter — sim bleibt konstant.
  const surplusFor = (overrides) => {
    const p = { ...baseParams, ...overrides };
    return -pvWirtschaft(v.pvKwp, v.batKwh, v.sim, v.ertragMwh, p, v.strategie).nettoJk;
  };
  const baseSurplus = surplusFor({});

  // Plausible Unsicherheitsbänder je Annahme (für Gutachten dokumentiert in der Achse).
  const bp = baseParams;
  let rows = [
    { key:'pStrom',          label:'Strombezugspreis', lo: bp.pStrom*0.7,  hi: bp.pStrom*1.3,  unit:' ct', dez:0 },
    { key:'pEinsp',          label:'Einspeisevergütung', lo: Math.max(0, bp.pEinsp*0.5), hi: bp.pEinsp*1.6, unit:' ct', dez:1 },
    { key:'pvInvestPerKwp',  label:'PV-Invest',          lo: bp.pvInvestPerKwp*0.75, hi: bp.pvInvestPerKwp*1.25, unit:' €/kWp', dez:0 },
    { key:'batInvestPerKwh', label:'Batterie-Invest',    lo: bp.batInvestPerKwh*0.7,  hi: bp.batInvestPerKwh*1.3, unit:' €/kWh', dez:0 },
    { key:'zins',            label:'Zinssatz',           lo: Math.max(0.005, bp.zins-0.02), hi: bp.zins+0.02, unit:' %', dez:1, isPct:true },
    { key:'pvLife',          label:'PV-Nutzungsdauer',   lo: Math.max(5, bp.pvLife-5), hi: bp.pvLife+5, unit:' a', dez:0 },
  ].map(r => {
    const sLo = surplusFor({ [r.key]: r.lo });
    const sHi = surplusFor({ [r.key]: r.hi });
    return { ...r, sLo, sHi, span: Math.abs(sHi - sLo) };
  }).filter(r => r.span > 1);                    // Annahmen ohne Wirkung (z.B. Bat-Invest bei Bat=0) weglassen
  rows.sort((a, b) => b.span - a.span);          // Tornado: größter Hebel oben

  if (!rows.length) { el.innerHTML = ''; return; }

  // Varianten-Sprungmarken (gleiche Optik wie Abb. 7/8)
  const chips = kanon.map(x =>
    `<button data-pvsens-var="${x.id}" title="${x.label}"
      style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border:1px solid ${x.farbe};border-radius:10px;
      background:${x.id===v.id?x.farbe:'transparent'};color:${x.id===v.id?'#0a0e16':x.farbe};font-size:9px;cursor:pointer;font-weight:600;white-space:nowrap;">
      ${x.icon} ${x.label}</button>`).join('');

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(440, elW - 4);
  const PL = 150, PR = 28, PT = 10, PB = 30;
  const barH = 22, gap = 12;
  const plotW = W - PL - PR;
  const H = PT + rows.length * (barH + gap) + PB;

  // Wertebereich x-Achse
  let dMin = baseSurplus, dMax = baseSurplus;
  for (const r of rows) { dMin = Math.min(dMin, r.sLo, r.sHi); dMax = Math.max(dMax, r.sLo, r.sHi); }
  const padd = (dMax - dMin) * 0.08 || 1000;
  dMin -= padd; dMax += padd;
  const xOf = val => PL + (val - dMin) / (dMax - dMin) * plotW;
  const xBase = xOf(baseSurplus);

  const COL_UP = '#66bb6a', COL_DN = '#ef5350';
  const fmtEUR = n => Math.round(n).toLocaleString('de-DE');

  // Achsen-Ticks (k€/a)
  const ticks = 4;
  let tickSvg = '';
  for (let i = 0; i <= ticks; i++) {
    const val = dMin + (dMax - dMin) * i / ticks;
    const x = xOf(val);
    tickSvg += `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(H-PB).toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
      <text x="${x.toFixed(1)}" y="${(H-PB+13).toFixed(1)}" text-anchor="middle" fill="#78909c" font-size="8">${(val/1000).toFixed(0)}k</text>`;
  }

  let bars = '';
  rows.forEach((r, i) => {
    const y = PT + i * (barH + gap);
    const loEnd = Math.min(r.sLo, r.sHi), hiEnd = Math.max(r.sLo, r.sHi);
    const xLo = xOf(loEnd), xHi = xOf(hiEnd);
    // roter (Downside, links der Basis) und grüner (Upside, rechts der Basis) Anteil
    const xSplit = Math.max(xLo, Math.min(xHi, xBase));
    const wDn = Math.max(0, xSplit - xLo), wUp = Math.max(0, xHi - xSplit);
    const valLo = r.isPct ? (r.lo*100).toFixed(r.dez) : r.lo.toFixed(r.dez);
    const valHi = r.isPct ? (r.hi*100).toFixed(r.dez) : r.hi.toFixed(r.dez);
    // Welcher Parameterwert gehört an welches Bar-Ende? (sLo gehört zu r.lo usw.)
    const leftIsLo  = r.sLo <= r.sHi;
    const leftTxt  = (leftIsLo ? valLo : valHi) + r.unit;
    const rightTxt = (leftIsLo ? valHi : valLo) + r.unit;
    bars += `
      <g data-pvsens-row="${i}" style="cursor:default;">
        <text x="${PL-10}" y="${(y+barH/2+3).toFixed(1)}" text-anchor="end" fill="#cfd8dc" font-size="9">${r.label}</text>
        <rect x="${xLo.toFixed(1)}" y="${y}" width="${wDn.toFixed(1)}" height="${barH}" fill="${COL_DN}" opacity="0.55"/>
        <rect x="${xSplit.toFixed(1)}" y="${y}" width="${wUp.toFixed(1)}" height="${barH}" fill="${COL_UP}" opacity="0.6"/>
        <rect x="${xLo.toFixed(1)}" y="${y}" width="${(xHi-xLo).toFixed(1)}" height="${barH}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>
        <text x="${(xLo-4).toFixed(1)}" y="${(y+barH/2+3).toFixed(1)}" text-anchor="end" fill="#90a4ae" font-size="7.5">${leftTxt}</text>
        <text x="${(xHi+4).toFixed(1)}" y="${(y+barH/2+3).toFixed(1)}" text-anchor="start" fill="#90a4ae" font-size="7.5">${rightTxt}</text>
      </g>`;
  });

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:10px;flex-wrap:wrap;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 9 — Sensitivitätsanalyse: Hebel auf den Jahresüberschuss
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">jede Annahme einzeln variiert, übrige auf Basiswert — längster Balken = größter Hebel</span>
      <span style="display:block;font-size:8px;color:#a5d6a7;margin-top:2px;">Referenz: ${v.icon} ${v.label} · Basis-Überschuss <b>${fmtEUR(baseSurplus)} €/a</b></span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="sensitivitaet" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;flex-shrink:0;">⤢</button>'}
  </div>
  <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">${chips}</div>
  <svg width="${W}" height="${H}" style="display:block;overflow:visible;">
    ${tickSvg}
    <line x1="${xBase.toFixed(1)}" y1="${PT}" x2="${xBase.toFixed(1)}" y2="${(H-PB).toFixed(1)}" stroke="#fdd835" stroke-width="1.2" stroke-dasharray="3,2"/>
    <text x="${xBase.toFixed(1)}" y="${(PT-1).toFixed(1)}" text-anchor="middle" fill="#fdd835" font-size="8">Basis</text>
    ${bars}
    <text x="${(PL+plotW/2).toFixed(1)}" y="${(H-2).toFixed(1)}" text-anchor="middle" fill="#90a4ae" font-size="8.5">Jahresüberschuss (k€/a) →</text>
  </svg>`;

  // Tooltip je Balken
  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const g = ev.target.closest?.('[data-pvsens-row]');
    if (!g) { _pvHideTT(); return; }
    const r = rows[+g.dataset.pvsensRow];
    const valLo = (r.isPct ? r.lo*100 : r.lo).toFixed(r.dez);
    const valHi = (r.isPct ? r.hi*100 : r.hi).toFixed(r.dez);
    _pvShowTT(ev,
      `<b style="color:#cfd8dc">${r.label}</b><br>` +
      `${valLo}${r.unit} → <b>${fmtEUR(r.sLo)} €/a</b><br>` +
      `${valHi}${r.unit} → <b>${fmtEUR(r.sHi)} €/a</b><br>` +
      `<span style="color:#90a4ae">Bandbreite: ${fmtEUR(r.span)} €/a</span>`
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  el.querySelectorAll('[data-pvsens-var]').forEach(b => b.addEventListener('click', () => {
    _pvSensVarId = b.dataset.pvsensVar;
    renderSensitivitaet(window._pvAnalyse.ergebnisse, overrideEl);
  }));

  const fsBtn = el.querySelector('[data-pva-fs="sensitivitaet"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Sensitivitätsanalyse: Hebel auf den Jahresüberschuss', cnt =>
      renderSensitivitaet(window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

function _pvUpdateBerechnenBtn(loading) {
  const btn = document.getElementById('pva-btn-berechnen');
  if (!btn) return;
  if (loading) {
    btn.textContent = 'Berechne …';
    btn.disabled = true;
  } else {
    btn.textContent = 'Varianten berechnen';
    btn.disabled = false;
  }
}

// Globale Exports für inline data-click/data-change Handler und setViewMode
window.initPvAnalyse          = initPvAnalyse;
window.pvBerechneAlle         = pvBerechneAlle;
// pvLadeSpotPreise nicht mehr nötig (Upload über Strom-Grundlagen)
window.pvGetMaxKwpFromAssets  = pvGetMaxKwpFromAssets;
