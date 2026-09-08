// ── 09d-pv-analyse.js — PV-Analyse: Varianten, NAP, Batterieoptimierung, Infrastruktur ──
// Eigenständiges Modul — kein Eingriff in bestehende 09a–09c, 10a–10d.
// Nutzt window.elQuartierH15 (15-min nativ) wenn vorhanden, sonst window.elQuartierH (8760h).

import { freiflaechen, gebaeude, globalYear, isExcluded, thermSpeicherAktiv } from './01-globals-varianten.js';
import { calcFFKwp } from './03a-erzeuger.js';
import { calcGebKwp, escHtml } from './03c-gebaeude-io.js';
import { getComputedStats, getNutzungstypById } from './02b-gebaeude.js';
import { getThermSpeicherParams } from './06b-gl-berechnen.js';
import { CalcEngine } from './08-calc-engine.js';
import { makePvProfile8760, makePvProfileEffective, pvGetEffectiveSpez, pvProfilKennwerte } from './09a-pv-profile.js';
import { OPT_INVEST_DEFAULT, OPT_IH, OPT_NUTZUNG } from './config/optimizer-defaults.js';
import { getEconomicScenario } from './config/economic-scenarios.js';
import { ASSETS } from './13a-assets-core.js';
import { computeWindElHourly, getWindAssetsSummary } from './13q-wind-ertrag.js';

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
  deckZu: { infra: true },    // eingeklappte Gruppen des Steuer-Decks (Infra: selten geändert)
  demandMode: 'basis',        // 'basis' = nur Strom-Lastgang | 'gesamt' = + WP + SK | 'endausbau' = NAP-Endausbau-Lastgang
  endausbauJahr: new Date().getFullYear() + 15, // Zieljahr für Endausbau-Lastgang
  ergebnisse: [],             // berechnete Varianten-Ergebnisse
  berechnet: false,
};

// ══════════════════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN
// ══════════════════════════════════════════════════════════════════════════════

// Cache fuer das auf Summe 1,0 normierte Upload-Profil (window.elPvH)
let _pvUploadNormCache = null, _pvUploadNormSig = null;

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
 * Basisprofil (8.760 h, normiert auf Jahressumme 1,0).
 *
 * Vorrang hat ein hochgeladenes Messprofil / PVGIS-Profil (window.elPvH, Upload
 * im ⚡ Strom-Panel). Es kommt in absoluten kWh/h für eine konkrete Anlage —
 * verwendet wird davon nur die FORM: auf Summe 1,0 normiert und in pvNapSim mit
 * kWp × spez. Ertrag skaliert. Damit bestimmt der Upload den zeitlichen Verlauf
 * (Spitzen, Schlechtwetterphasen), die Jahresmenge weiterhin der eingestellte
 * spezifische Ertrag — sonst müsste man beide Größen doppelt pflegen.
 *
 * Ohne Upload: synthetisches Profil aus Klarhimmel-Geometrie + Wetterstreuung
 * (siehe 09a-pv-profile.js).
 */
function _pvBasisProfil8760() {
  const up = window.elPvH;
  if (up && up.length >= 8760) {
    let summe = 0;
    for (let i = 0; i < 8760; i++) summe += up[i] || 0;
    if (summe > 0) {
      // Signatur aus Summe + Stuetzstellen: zwei verschiedene Profile mit zufaellig
      // gleicher Jahressumme sollen nicht denselben Cache-Eintrag treffen.
      const sig = '8760|' + summe.toFixed(3) + '|' + up[3000] + '|' + up[6000];
      if (_pvUploadNormCache && _pvUploadNormSig === sig) return _pvUploadNormCache;
      const out = new Float32Array(8760);
      for (let i = 0; i < 8760; i++) out[i] = (up[i] || 0) / summe;
      _pvUploadNormCache = out; _pvUploadNormSig = sig;
      return out;
    }
  }
  return makePvProfileEffective();
}

/** Herkunft des aktiven PV-Profils — für die Anzeige im Panel und im Gutachten. */
function pvGetProfilQuelle() {
  const up = window.elPvH;
  if (up && up.length >= 8760) {
    const meta = window.elPvMeta || {};
    const pvgis = meta.quality === 'modeled_external';
    return {
      id: pvgis ? 'pvgis' : 'upload',
      label: pvgis ? 'PVGIS-Stundenprofil' : 'Hochgeladenes Stundenprofil',
      detail: meta.filename || '',
      quelle: meta.source || 'Upload',
      geprueft: pvgis,
    };
  }
  return {
    id: 'synthetisch',
    label: 'Synthetisches Profil',
    detail: 'Klarhimmel-Geometrie + Wetterstreuung (fester Seed)',
    quelle: 'Interne Modellierung, 51° N',
    geprueft: false,
  };
}

/**
 * PV-Profil exakt auf die Länge des Lastgangs gebracht.
 * Stundenbasis: 8.760 Werte → direkt verwenden (Schaltjahrsüberhang = 0).
 * 15-min: jeden Stundenwert in 4 gleiche Slots;
 *         Schaltjahr (35.136) enthält 24 h mehr → letzte 96 Slots bleiben 0.
 */
function pvGetPvProfile() {
  const N = pvGetN();
  const h = _pvBasisProfil8760();         // immer 8.760 Stunden, Summe 1,0

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

// Wind-Profil (immer 8.760h, siehe computeWindElHourly) auf die Lastgang-Länge N gebracht —
// gleiche Resampling-Logik wie pvGetPvProfile, da windH sonst bei 15-min-Lastgängen ab
// Index 8760 undefined liefert und die gesamte Bilanz in pvNapSim mit NaN kontaminiert.
function _expandWindProfile(h, N) {
  if (!h) return null;
  if (N <= 8760) return h;
  const m = new Float32Array(N);
  if (N <= 8784) {
    for (let i = 0; i < 8760; i++) m[i] = h[i];
  } else {
    for (let i = 0; i < 8760; i++) {
      m[i*4] = m[i*4+1] = m[i*4+2] = m[i*4+3] = h[i];
    }
  }
  return m;
}

/** Gebäude, deren PV-Leistung bereits über ein verknüpftes Elektro-PV-Asset
 *  erfasst ist (die Quelle der Wahrheit für alle Analysen — siehe PV-Übersicht
 *  im Elektro-Tab). Für diese Gebäude darf calcGebKwp(g) NICHT zusätzlich
 *  gezählt werden — das wäre dieselbe Dachfläche ein zweites Mal. */
function _pvGebaeudeIdsMitAsset() {
  return new Set((ASSETS?.items || [])
    .filter(a => a.type === 'PV' && a.buildingId != null)
    .map(a => a.buildingId));
}

/** Maximale PV-Leistung aus allen Quellen (kWp):
 *  Elektro-PV-Assets (13a) + Gebäude-PV ohne eigenes Asset + Freiflächen-PV + Strom-Panel-Eingabe */
function pvGetMaxKwpFromAssets() {
  if (window._pvAnalyse.pvMaxKwpOverride > 0) return window._pvAnalyse.pvMaxKwpOverride;

  // 1. Elektro-Assets vom Typ 'PV' (ASSETS.items aus 13a-assets-core.js)
  const assetKwp = (ASSETS?.items || [])
    .filter(a => a.type === 'PV')
    .reduce((s, a) => s + (parseFloat(a.props?.leistungKWp) || 0), 0);

  // 2. Gebäude-integrierte PV (Wärme-Modul) — nur Gebäude OHNE eigenes PV-Asset,
  //    sonst würde dieselbe Dachfläche doppelt gezählt (Asset + Pauschale/Fläche).
  const mitAsset = _pvGebaeudeIdsMitAsset();
  const gebKwp = gebaeude.reduce((s, g) => s + (g.pvAktiv && !mitAsset.has(g.id) ? calcGebKwp(g) : 0), 0);

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
  const mitAsset = _pvGebaeudeIdsMitAsset();
  const gebKwp   = gebaeude.reduce((s, g) => s + (g.pvAktiv && !mitAsset.has(g.id) ? calcGebKwp(g) : 0), 0);
  const ffKwp    = freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);
  const manual   = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
  const assetN   = (ASSETS?.items || []).filter(a => a.type === 'PV').length;
  return { assetKwp, assetN, gebKwp, ffKwp, manual };
}

/** Spezifischer Ertrag (kWh/kWp/a) — effektiv aus dem Ausrichtungs-Mix gewichtet. */
function pvGetSpez() {
  return pvGetEffectiveSpez();
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
function pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, batStrategie, spotH, windScale = 1) {
  const N    = demandH.length;
  const dt   = N > 8784 ? 0.25 : 1.0;   // Schaltjahr (35.136) und Normaljahr (35.040)
  const spez = pvGetSpez();
  // Windkraft-Sockel: Erzeugung der konfigurierten Anlagen (13q-wind-ertrag.js), als
  // "must-take" neben PV. windScale (Default 1) skaliert den Sockel linear — für die
  // Wind-Ausbau-Exploration (Grenznutzen-Chart, Slider); zulässig, weil alle Anlagen
  // denselben Standortwind teilen. window._windElHourly ist nur gesetzt, wenn der Nutzer
  // "Windkraftanlagen einbeziehen" aktiviert hat. Immer 8.760h lang, daher
  // hier (wie das PV-Profil in pvGetPvProfile) auf die tatsächliche Lastgang-Auflösung
  // gebracht — sonst wird windH[t] bei 15-min-Lastgängen ab t=8760 undefined → NaN in der
  // gesamten Bilanz (data[optIdx] undefined-Crash in renderGrenznutzenChart war ein Symptom).
  const windH = _expandWindProfile(window._windElHourly, N);
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
  let windEigenMwh = 0, windEinspMwh = 0; // Anteil der Windkraft an Eigenverbrauch/Einspeisung (für getrennten Tarif)
  let batVerlustMwh = 0, spotRevenue = 0;  // spotRevenue in € (ct/kWh × MWh / 10)
  let maxEinspeiseKw = 0, einspeiseStunden = 0;  // Rückspeise-Spitze & -Dauer am NAP
  const batSocArr = new Float32Array(N);
  const deckungArr = new Float32Array(N);  // Anteil des Bedarfs gedeckt durch PV+Batterie (0..1), je Zeitschritt

  for (let t = 0; t < N; t++) {
    const dem     = demandH[t];
    const pvKw    = pvProfile ? pvProfile[t] * pvKwp * spez : 0;
    const windKw  = windH ? windH[t] * windScale : 0;
    const pvGen   = pvKw + windKw;
    // Anteil Wind an der momentanen Erzeugung — wird unten proportional auf Eigenverbrauch/
    // Einspeisung dieses Zeitschritts angewendet (gleiches Prinzip wie PV/BHKW-Split in calcStromPanel).
    const windFrac = pvGen > 0 ? windKw / pvGen : 0;
    const spot    = (spotH && t < spotH.length) ? spotH[t] : avgSpot;

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
    windEigenMwh += evStep * windFrac * dt / 1000;
    windEinspMwh += rGen   * windFrac * dt / 1000;
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
           maxEinspeiseKw, einspeiseStunden, batSocArr, deckungArr, spotRevenue,
           windEigenMwh, windEinspMwh };
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
function pvCalcEvQuoteKwp(demandH, pvProfile, napParams, minQuote = 90, spur = null) {
  const spez   = pvGetSpez();
  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  let best = 10;
  for (let kwp = 10; kwp <= maxKwp; kwp += (kwp < 100 ? 10 : kwp < 500 ? 25 : 50)) {
    const sim = pvNapSim(kwp, 0, demandH, pvProfile, napParams, 'none', null);
    const ert = kwp * spez / 1000;
    const q   = ert > 0 ? sim.eigenMwh / ert * 100 : 0;
    // Auch der Punkt, der das Kriterium reißt, wird protokolliert — er ist in der
    // Herleitungs-Grafik die Begründung für den Abbruch.
    if (spur) spur.push({ kwp, quote: q });
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
function pvCalcWirtschaftOptimum(demandH, pvProfile, napParams, params, spotH, maxKwp, spur = null) {
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
    if (spur) spur.push({ kwp, bat, ueber: -wirt.nettoJk });
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
function pvCalcAutarkieMax(maxKwp, demandH, pvProfile, napParams, spur = null) {
  const bedarfMwh = pvGesamtBedarfMwh();
  const autOf = (sim) => bedarfMwh > 0 ? (1 - sim.netzbezugMwh / bedarfMwh) * 100 : 0;

  const cap   = Math.min(maxKwp * 10, 50000);
  const steps = [0, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000]
                  .filter(b => b <= cap + 1);

  let bestBat = 0;
  let prevAut = autOf(pvNapSim(maxKwp, 0, demandH, pvProfile, napParams, 'none', null));
  let prevBat = 0;
  if (spur) spur.push({ bat: 0, aut: prevAut, marg: null });

  for (let i = 1; i < steps.length; i++) {
    const bat = steps[i];
    const sim = pvNapSim(maxKwp, bat, demandH, pvProfile, napParams, 'ev', null);
    const aut = autOf(sim);
    const marg = (aut - prevAut) / ((bat - prevBat) / 1000); // %-Punkte je 1.000 kWh
    if (spur) spur.push({ bat, aut, marg });
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

function pvWirtschaft(pvKwp, batKwh, simResult, pvErtragMwh, params, strategie, windKwOverride = null) {
  const { pStrom, pEinsp, pvInvestPerKwp, batInvestPerKwh, zins, pvLife, batLife } = params;

  const pvInvest  = pvKwp  * pvInvestPerKwp;
  const batInvest = batKwh * batInvestPerKwh;
  const infra     = pvInfraKosten(pvKwp, pvErtragMwh);

  const annPv  = annF(zins, pvLife  || 20);
  const annBat = annF(zins, batLife || 15);

  const pvJk   = pvInvest  * (annPv  + (OPT_IH.pv  || 0.01));
  const batJk  = batInvest * (annBat + (OPT_IH.bat || 0.01));
  const infJk  = infra.investEUR * annF(zins, 20) + infra.jaehrlichEUR;

  // Windkraft: Erlöse fließen über simResult ein — dann müssen auch die Kosten rein,
  // sonst ist der Netto-Überschuss systematisch geschönt. windKwOverride erlaubt der
  // Wind-Ausbau-Exploration (Grenznutzen/Slider) abweichende Leistungen; Default ist
  // die installierte Leistung aus params. IH-Satz 3 %/a (Wartung/Pacht höher als PV).
  const windKw     = windKwOverride != null ? windKwOverride : (params.windKwInstalled || 0);
  const windInvest = windKw * (params.windInvestPerKw || 0);
  const windJk     = windInvest * (annF(zins, 20) + 0.03);

  const eigenErsparnis = simResult.eigenMwh * pStrom * 10; // €/a — Quelle irrelevant, vermiedener Bezug kostet gleich viel
  // spot/spot-dyn: tatsächliche Markterlöse statt Flatrate-Preis verwenden
  const useSpotRev     = (strategie === 'spot' || strategie === 'spot-dyn') && simResult.spotRevenue;
  // Windkraft-Einspeisung: gemeinsamer PV-Satz oder eigener Wind-Tarif (params.windTarifModus/pWindEinsp,
  // aus der PV-Analyse-Oberfläche). Nur die Einspeisevergütung wird getrennt — die Eigenverbrauchs-
  // Ersparnis ist unabhängig von der Erzeugungsquelle (vermiedener Netzbezug zum selben Preis).
  const windEinspMwh       = simResult.windEinspMwh || 0;
  const pvEinspMwh         = Math.max(0, simResult.einspeiseMwh - windEinspMwh);
  const windGetrennt       = params.windTarifModus === 'getrennt' && windEinspMwh > 0;
  const pWindEinsp         = params.pWindEinsp != null ? params.pWindEinsp : pEinsp;
  const pvEinspeisErloes   = pvEinspMwh   * pEinsp * 10;
  const windEinspeisErloes = windEinspMwh * (windGetrennt ? pWindEinsp : pEinsp) * 10;
  const einspeisErloes = useSpotRev
    ? simResult.spotRevenue                      // €/a aus Börsenpreisen (PV + Wind gemeinsam, quellenunabhängig)
    : pvEinspeisErloes + windEinspeisErloes;      // €/a Flatrate, ggf. mit getrenntem Wind-Tarif
  const abregelVerlust = simResult.curtailMwh * pEinsp * 10; // €/a entgangener Erlös (vereinfacht: ein Satz, keine Quellentrennung bei Abregelung)

  const gesamtErloes = eigenErsparnis + einspeisErloes;
  const gesamtJk     = pvJk + batJk + infJk + windJk;
  const nettoJk      = gesamtJk - gesamtErloes;
  const investGes    = pvInvest + batInvest + infra.investEUR + windInvest;

  // ── Statische Amortisation ────────────────────────────────────────────────
  // Investition ÷ jährlicher RÜCKFLUSS, nicht ÷ Bruttoerlös: die laufenden
  // Betriebskosten (Instandhaltung, jährliche Infrastrukturgebühren, Wartung
  // Wind) mindern den Rückfluss und gehören abgezogen. Die frühere Division
  // durch den Bruttoerlös verkürzte die Amortisationszeit systematisch und
  // entsprach nicht der Definition der statischen Amortisationsrechnung.
  const betriebJk = pvInvest  * (OPT_IH.pv  || 0.01)
                  + batInvest * (OPT_IH.bat || 0.01)
                  + infra.jaehrlichEUR
                  + windInvest * 0.03;
  const rueckfluss = gesamtErloes - betriebJk;
  const amort      = rueckfluss > 0 ? investGes / rueckfluss : Infinity;

  // ── Kapitalwert (Barwert) ─────────────────────────────────────────────────
  // Wirtschaftlichkeitsuntersuchungen nach § 7 BHO erwarten die Kapitalwert-
  // methode. Vereinfachung: konstanter Jahresüberschuss über die PV-Nutzungs-
  // dauer, diskontiert mit dem Rentenbarwertfaktor (Kehrwert der Annuität).
  // Kein Preispfad — die Sensitivität deckt die Preisunsicherheit ab.
  const rbf         = 1 / annF(zins, pvLife || 20);
  const kapitalwert = -nettoJk * rbf;      // nettoJk < 0 = Überschuss

  // ── Stromgestehungskosten und CO₂-Minderung ───────────────────────────────
  // Bezugsgröße ist die tatsächlich genutzte Energie (Eigenverbrauch +
  // Einspeisung), also nach Abzug der Abregelung.
  const genutztMwh = simResult.eigenMwh + simResult.einspeiseMwh;
  const lcoeCt     = genutztMwh > 0 ? gesamtJk / (genutztMwh * 1000) * 100 : 0;
  const co2Faktor  = params.co2Faktor != null ? params.co2Faktor : 380;   // g/kWh
  const co2T       = genutztMwh * co2Faktor / 1000;                       // t/a

  // PV-eigene Kennzahl: Windanteil am Eigenverbrauch herausrechnen, sonst verzerrt Wind
  // (fließt zusätzlich in simResult.eigenMwh ein) die PV-Eigenverbrauchsquote nach oben (>100 %).
  // Kappung auf 100 %: Die Quellen-Zuordnung des Batterie-Eigenverbrauchs erfolgt je
  // Zeitschritt über den momentanen Erzeugungsmix — Lade-/Entladeverschiebung kann die
  // PV-Zuordnung dadurch um wenige Prozent überzeichnen (>100 % ist physikalisch sinnlos).
  const pvEigenQuote = pvErtragMwh > 0 ? Math.min(100, Math.max(0, simResult.eigenMwh - (simResult.windEigenMwh || 0)) / pvErtragMwh * 100) : 0;
  const gesamtBedarf = (() => { const d = pvGetDemandH(); if (!d) return 1; let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s * pvGetDt() / 1000; })();
  const autarkie     = gesamtBedarf > 0 ? (1 - simResult.netzbezugMwh / gesamtBedarf) * 100 : 0;
  const curtailQuote = pvErtragMwh  > 0 ? simResult.curtailMwh / pvErtragMwh * 100 : 0;

  return {
    pvInvest, batInvest, infraInvest: infra.investEUR, infraLabel: infra.stufeLabel,
    investGes, pvJk, batJk, infJk, gesamtJk, gesamtErloes, nettoJk,
    windKw, windInvest, windJk,
    eigenErsparnis, einspeisErloes, abregelVerlust,
    pvEinspeisErloes, windEinspeisErloes, windEinspMwh, pvEinspMwh, windGetrennt,
    pvEigenQuote, autarkie, curtailQuote, amort,
    betriebJk, rueckfluss, kapitalwert, lcoeCt, co2T, genutztMwh,
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
  const co2Faktor      = parseFloat(document.getElementById('pva-co2')?.value) || 380;

  // Windkraft: fixer Erzeugungssockel für die Simulation (window._windElHourly, siehe pvNapSim)
  // + Tarifwahl für die Einspeisevergütung (gemeinsam mit PV oder eigener Wind-Satz)
  // + Investkosten und installierte Leistung für die Wirtschaftlichkeit/Grenznutzen-Analyse.
  const windEnabled = document.getElementById('pva-wind-enable')?.checked === true;
  window._windElHourly = windEnabled ? computeWindElHourly() : null;
  const windTarifModus  = document.getElementById('pva-wind-tarif-modus')?.value || 'gemeinsam';
  const pWindEinsp      = parseFloat(document.getElementById('pva-wind-p-einsp')?.value) || 7.0;
  const windInvestPerKw = parseFloat(document.getElementById('pva-wind-invest')?.value) || 1800;
  window._pvAnalyse.windInvestPerKw = windInvestPerKw;   // Panel-Re-Render soll den Wert behalten
  const windKwInstalled = windEnabled ? getWindAssetsSummary().kw : 0;

  const params = { pStrom, pEinsp, pvInvestPerKwp, batInvestPerKwh, zins, pvLife, batLife, co2Faktor,
                   windTarifModus, pWindEinsp, windInvestPerKw, windKwInstalled };

  const ergebnisse = [];
  // Suchspuren der Optimierer — Grundlage der Ansicht „Herleitung"
  const spurEv = [], spurWirt = [], spurAut = [];

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
  const evKwp = pvCalcEvQuoteKwp(demandH, pvProfile, napParams, 90, spurEv);
  const evBat = pvOptBat(evKwp, demandH, pvProfile, napParams, 'ev', null, params);
  berechne('ev-opt', evKwp, evBat, evBat > 0 ? 'ev' : 'none');

  // ═══ 3) WIRTSCHAFTLICH OPTIMIERT — gemeinsame (PV × Batterie)-Optimierung ═════
  if (maxKwp > 0) {
    const wo = pvCalcWirtschaftOptimum(demandH, pvProfile, napParams, params, spotH, maxKwp, spurWirt);
    berechne('wirt-opt', wo.pvKwp, wo.batKwh, wo.strategie);
  }

  // ═══ 4) AUTARKIE-OPTIMIERT — volle PV + Batterie bis zur Sättigung ═══════════
  if (maxKwp > 0) {
    const ao = pvCalcAutarkieMax(maxKwp, demandH, pvProfile, napParams, spurAut);
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

  // ── Herleitung je Variante: Kriterium + Suchspur für die Grafik ─────────
  const eMin = ergebnisse.find(e => e.id === 'minimal');
  const eMax = ergebnisse.find(e => e.id === 'max-pv');
  const infraStufen = PV_INFRA_STUFEN.map(st => {
    const items = _pvInfraItems(st.id);
    return { bisKwp: st.bisKwp, label: st.label,
             invest: items.reduce((sum, it) => sum + (it.aktiv ? (it.investEUR || 0) : 0), 0) };
  });
  const idxMin = eMin ? infraStufen.findIndex(st => eMin.pvKwp <= st.bisKwp) : -1;
  const bd = pvGetAssetBreakdown();

  state.herleitung = {
    minimal: eMin ? {
      stufen: infraStufen,
      gewaehlt: eMin.pvKwp,
      gewaehltStufe:  idxMin >= 0 ? infraStufen[idxMin].label  : '',
      gewaehltInvest: idxMin >= 0 ? infraStufen[idxMin].invest : 0,
      naechsterInvest: idxMin >= 0 && infraStufen[idxMin + 1] ? infraStufen[idxMin + 1].invest : 0,
      grenzeKwp: 100,
    } : null,
    evOpt: spurEv.length ? { punkte: spurEv, schwelle: 90, gewaehlt: evKwp } : null,
    wirtOpt: spurWirt.length ? { punkte: spurWirt } : null,
    autarkie: spurAut.length > 1 ? {
      punkte: spurAut, schwelle: 0.3,
      gewaehlt: ergebnisse.find(e => e.id === 'autarkie')?.batKwh ?? 0,
    } : null,
    maxPv: eMax ? {
      // Bei gesetztem kWp-Override gibt es keine Quellen-Aufschlüsselung — dann
      // die vorgegebene Leistung als eine Position zeigen statt eines leeren Balkens.
      quellen: (bd.assetKwp + bd.gebKwp + bd.ffKwp + bd.manual) > 0
        ? [
            { label: 'Elektro-Assets',   kwp: bd.assetKwp },
            { label: 'Gebäude-PV',       kwp: bd.gebKwp },
            { label: 'Freifläche',       kwp: bd.ffKwp },
            { label: 'manuelle Eingabe', kwp: bd.manual },
          ]
        : [{ label: 'manuell vorgegeben', kwp: eMax.pvKwp }],
      bilanz: { eigen: eMax.sim.eigenMwh, einsp: eMax.sim.einspeiseMwh, abr: eMax.sim.curtailMwh },
      hinweis: eMax.hinweis || '',
    } : null,
  };

  state.ergebnisse = ergebnisse;
  state.berechnet  = true;
  state.stale      = false;
  state.lastParams = params;
  state.lastProfilQuelle = pvGetProfilQuelle();   // Herkunft mitprotokollieren
  state.standText = new Date().toLocaleString('de-DE', { day:'2-digit', month:'2-digit',
                     year:'numeric', hour:'2-digit', minute:'2-digit' });
  _pvApplyStaleUi();
  _pvFsArgs = { demandH, pvProfile, napParams, params };
  // Ergebnisse liegen vor: Leerhinweis ausblenden, alle Ansichten als neu zu
  // zeichnen markieren und nur die aktive rendern. Die uebrigen folgen beim
  // Umschalten — ein verstecktes Diagramm wuerde seine Breite als 0 messen.
  const leerHinweis = document.getElementById('pva-leer-hinweis');
  if (leerHinweis) leerHinweis.style.display = 'none';
  _pvaAlleDirty();
  _pvaRenderView();
  const infraSum = document.getElementById('pva-infra-summary');
  if (infraSum) infraSum.innerHTML = _pvaInfraSummary();
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

// ══════════════════════════════════════════════════════════════════════════════
// EIGENES ANALYSE-KAPITEL „🛡 Resilienz" — identisches Muster zu pvaBuildAnalyseSection.
// Die Blackout-/Inselbetrieb-Analyse (früher „Abb. 10" am Ende der PV-Analyse) bekommt
// so eigenen Platz für die genauere Betrachtung, statt am Ende der PV-Abbildungen
// unterzugehen. Rechnet auf den bereits in der PV-Analyse berechneten Varianten
// (window._pvAnalyse.ergebnisse) — dort zuerst „Varianten berechnen" nötig.
// ══════════════════════════════════════════════════════════════════════════════

export function resBuildAnalyseSection() {
  // Seit 09/2026 kein eigener Reiter mehr: die Resilienz-/Blackout-Analyse steht
  // wieder als Abb. 10 in der PV-Analyse. Sie rechnet auf genau denselben
  // Varianten (PV/Batterie je Auslegung) — der getrennte Reiter hat den
  // Zusammenhang zerrissen und verlangte einen zweiten Ort fuer dieselbe Frage.
  // Die Funktion bleibt exportiert, damit 04a-ui-panels.js unveraendert bleibt.
  const alterTab = document.querySelector('#analyse-view-tabs [data-section="resilienz"]');
  if (alterTab) alterTab.remove();
}

export function resShowSection(show) {
  if (!show) return;
  // Falls doch jemand das alte Kapitel anspringt: in die PV-Analyse umleiten.
  if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('pva');
  window.pvaSetView?.('abb10');
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

// ══════════════════════════════════════════════════════════════════════════════
// ERGEBNIS-ANSICHTEN — Register + Umschaltung
// ══════════════════════════════════════════════════════════════════════════════
// Bis 09/2026 standen Tabelle, Lesehilfe, Rechenweg und neun Abbildungen als eine
// Endlos-Spalte untereinander: kein Index, kein Sprung, und jeder Rechenlauf hat
// alle Diagramme neu gezeichnet. Jetzt gibt es links eine Ergebnis-Navigation und
// rechts genau eine Ansicht; gezeichnet wird erst beim Aufruf ("dirty"-Markierung).
// Nebeneffekt: Diagramme, die ihre Breite aus dem Container messen, bekommen sie
// jetzt immer korrekt — ein verstecktes Element misst 0.

const PVA_VIEWS = [
  { id:'tabelle',   gruppe:'ergebnis', label:'Varianten-Vergleich', el:'pva-result-tabelle',
    render:(v) => renderVariantenTabelle(v) },
  { id:'lesehilfe', gruppe:'ergebnis', label:'Lesehilfe',           el:'pva-methodik',
    render:(v) => renderMethodik(v) },
  { id:'herleitung', gruppe:'ergebnis', label:'Herleitung',        el:'pva-herleitung',
    render:(v) => renderHerleitung(v) },
  { id:'rechenweg', gruppe:'ergebnis', label:'Rechenweg',           el:'pva-rechenweg',
    render:(v) => renderRechenweg(v) },

  { id:'abb1',  gruppe:'abb', nr:1,  label:'Optimierungsfläche',   el:'pva-chart-heatmap',
    render:(v, a) => renderOptSurface3D(a.demandH, a.pvProfile, a.napParams, a.params, v) },
  { id:'abb2',  gruppe:'abb', nr:2,  label:'Ausbau-Grenznutzen',   el:'pva-chart-grenznutzen',
    render:(v, a) => { renderGrenznutzenChart(a.demandH, a.pvProfile, a.napParams, a.params, v);
                       renderWindGrenznutzenChart(a.demandH, a.pvProfile, a.napParams, a.params, v); } },
  { id:'abb3',  gruppe:'abb', nr:3,  label:'Eigenverbrauchsquote', el:'pva-ev-kurve',
    render:(v, a) => renderEvKurve(a.demandH, a.pvProfile, a.napParams, a.params, v) },
  { id:'abb4',  gruppe:'abb', nr:4,  label:'Energiebilanz',        el:'pva-chart-bilanz',
    render:(v) => renderBilanzChart(v) },
  { id:'abb5',  gruppe:'abb', nr:5,  label:'Invest / Amortisation', el:'pva-chart-scatter',
    render:(v) => renderScatterChart(v) },
  { id:'abb6',  gruppe:'abb', nr:6,  label:'Rückspeisung & Netz',  el:'pva-chart-rueck',
    render:(v) => renderRueckAmpel(v) },
  { id:'abb7',  gruppe:'abb', nr:7,  label:'Energiefluss',         el:'pva-chart-fluss',
    render:(v, a) => renderEnergieFluss(a.demandH, a.pvProfile, a.napParams, a.params, v) },
  { id:'abb8',  gruppe:'abb', nr:8,  label:'Autarkie-Jahresgang',  el:'pva-chart-autarkie-heatmap',
    render:(v) => renderAutarkieHeatmap(v) },
  { id:'abb9',  gruppe:'abb', nr:9,  label:'Sensitivität',         el:'pva-chart-sensitivitaet',
    render:(v) => renderSensitivitaet(v) },
  // Abb. 10 — Resilienz ist ab 09/2026 wieder Teil der PV-Analyse (war kurzzeitig
  // ein eigenes Analyse-Kapitel). Sie gehört fachlich zu den Varianten: sie rechnet
  // auf genau derselben PV/Batterie-Auslegung.
  { id:'abb10', gruppe:'abb', nr:10, label:'Resilienz / Blackout', el:'pva-chart-resilienz',
    render:(v) => renderResilienz(v) },

  { id:'annahmen', gruppe:'doku', label:'Annahmenblatt', el:'pva-annahmenblatt',
    render:(v) => renderAnnahmenblatt(v) },
];

let _pvaView = 'tabelle';
const _pvaDirty = new Set();

/** Alle Ansichten als neu-zu-zeichnen markieren (nach einem Rechenlauf). */
function _pvaAlleDirty() { PVA_VIEWS.forEach(v => _pvaDirty.add(v.id)); }

window.pvaSetView = function pvaSetView(id) {
  if (!PVA_VIEWS.some(v => v.id === id)) return;
  _pvaView = id;
  _pvaRenderView();
};

function _pvaRenderView() {
  const state = window._pvAnalyse;
  // Navigation hervorheben
  document.querySelectorAll('[data-pva-view]').forEach(b => {
    const an = b.dataset.pvaView === _pvaView;
    b.style.borderLeftColor = an ? 'var(--accent)' : 'transparent';
    b.style.background      = an ? 'rgba(212,168,85,0.09)' : 'transparent';
    b.style.color           = an ? 'var(--text)' : 'var(--muted)';
    b.style.fontWeight      = an ? '500' : '400';
  });
  // Container umschalten
  for (const v of PVA_VIEWS) {
    const el = document.getElementById(v.el);
    if (el) el.style.display = v.id === _pvaView ? 'block' : 'none';
  }
  // Das Wind-Ausbau-Diagramm (Abb. 2b) hat einen eigenen Container, gehört aber
  // zur Ansicht "Ausbau-Grenznutzen".
  const windEl = document.getElementById('pva-chart-wind-grenz');
  if (windEl) windEl.style.display = _pvaView === 'abb2' ? 'block' : 'none';
  // Aktive Ansicht zeichnen, wenn nötig
  const view = PVA_VIEWS.find(v => v.id === _pvaView);
  if (!view || !state?.berechnet || !state.ergebnisse?.length) return;
  if (!_pvaDirty.has(view.id)) return;
  const args = _pvFsArgs;
  if (view.gruppe === 'abb' && !args) return;
  view.render(state.ergebnisse, args);
  _pvaDirty.delete(view.id);
}

/** Navigations-Markup (links) */
function _pvaNavHtml() {
  const zeile = (v) => `
    <div data-pva-view="${v.id}" data-click="pvaSetView('${v.id}')"
      style="display:flex;align-items:center;gap:9px;padding:6px 14px;border-left:2px solid transparent;
             color:var(--muted);font-size:11px;cursor:pointer;user-select:none;">
      ${v.nr ? `<span style="font-family:'DM Mono',monospace;color:#78909c;width:22px;flex-shrink:0;">${v.nr}</span>` : ''}
      <span>${v.label}</span>
    </div>`;

  const erg = PVA_VIEWS.filter(v => v.gruppe === 'ergebnis').map(zeile).join('');
  const abb = PVA_VIEWS.filter(v => v.gruppe === 'abb').map(zeile).join('');
  const dok = PVA_VIEWS.filter(v => v.gruppe === 'doku').map(zeile).join('');

  return `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:12px 0;
              display:flex;flex-direction:column;gap:1px;align-self:start;position:sticky;top:0;">
    <div style="font-size:10px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;padding:0 14px 7px 14px;">Ergebnisse</div>
    ${erg}
    <div style="font-size:10px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;padding:13px 14px 5px 14px;border-top:1px solid var(--border);margin-top:8px;">Abbildungen</div>
    ${abb}
    <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px;">${dok}</div>
    <div style="padding:9px 14px 0 14px;font-size:10px;color:#78909c;line-height:1.5;">
      Nummerierung entspricht der<br>Abbildungsfolge im Gutachten.
    </div>
  </div>`;
}

// ── Datenbasis-Leiste: womit wird gerade gerechnet? ──────────────────────────
// Die vier Größen, an denen jedes Ergebnis hängt, immer sichtbar über der
// Auswertung — vorher musste man sie aus vier verschiedenen Panels zusammensuchen.
function _pvaDatenbasisHtml() {
  const karte = (punkt, titel, wert, zeilen, akzent) => `
    <div style="background:var(--surface2);border:1px solid var(--border);${akzent ? 'border-left:2px solid ' + akzent + ';' : ''}
                border-radius:7px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:7px;height:7px;border-radius:50%;background:${punkt};flex-shrink:0;"></span>
        <span style="font-size:10px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;">${titel}</span>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:14px;color:var(--text);">${wert}</div>
      <div style="font-size:10px;color:#78909c;line-height:1.45;">${zeilen}</div>
    </div>`;

  // 1 · Lastgang
  const a = window.elQuartierH15 || window.elQuartierH;
  let lastWert = '—', lastSub = '<span style="color:#ef9a9a;">nicht geladen — unten hochladen</span>', lastDot = '#ef5350';
  if (a) {
    let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i];
    const mwh = (sum * (a.length > 9000 ? 0.25 : 1) / 1000).toFixed(0);
    const modus = window._pvAnalyse.demandMode || 'basis';
    const modusTxt = modus === 'gesamt' ? '+ Wärmepumpen / Stromkessel'
                   : modus === 'endausbau' ? 'Endausbau ' + (window._pvAnalyse.endausbauJahr || '') : 'nur Strom';
    lastWert = mwh + ' MWh/a'; lastDot = '#66bb6a';
    lastSub = `${escHtml(window.elQuartierFilename || 'Lastgang')} · ${a.length > 9000 ? '15-min' : 'stündlich'} · ${a.length.toLocaleString('de-DE')} Werte<br>${modusTxt}`;
  }

  // 2 · Erzeugungsprofil
  const q = pvGetProfilQuelle();
  const spez = pvGetSpez();
  const kenn = pvProfilKennwerte(_pvBasisProfil8760(), spez);
  const maxKwp = pvGetMaxKwpFromAssets();
  const profWert = kenn.peakKwPerKwp.toLocaleString('de-DE', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' kW/kWp';
  const profSub = `${escHtml(q.label)}${q.detail ? ' · ' + escHtml(q.detail) : ''}<br>` +
    (maxKwp > 0 ? `Spitze bei ${maxKwp.toFixed(0)} kWp: <b style="color:var(--text)">${Math.round(kenn.peakKwPerKwp * maxKwp).toLocaleString('de-DE')} kW</b>` : 'kein PV-Potenzial erfasst');

  // 3 · Börsenpreise
  const spot = window.elSpotPreiseH;
  let spotWert = '—', spotSub = 'nicht geladen — feste Einspeisevergütung', spotDot = '#546e7a';
  if (spot) {
    let sum = 0; for (let i = 0; i < spot.length; i++) sum += spot[i];
    spotWert = 'Ø ' + (sum / spot.length).toFixed(1) + ' ct/kWh';
    spotDot = '#ab47bc';
    const passt = spot.length === pvGetN();
    spotSub = `${escHtml(window.elSpotPreiseFilename || 'Spot')} · ${spot.length.toLocaleString('de-DE')} Werte<br>` +
      (passt ? 'Auflösung passt zum Lastgang'
             : '<span style="color:#ffa726;">Auflösung weicht vom Lastgang ab</span>');
  }

  // 4 · Preisbasis
  const pStrom = parseFloat(document.getElementById('pva-p-strom')?.value);
  const pStromVal = isFinite(pStrom) ? pStrom : 30;
  const szenario = (() => { try { return getEconomicScenario()?.values?.stromCtKwh; } catch (e) { return null; } })();
  const abweichend = szenario != null && Math.abs(pStromVal - szenario) > 0.01;
  const preisSub = szenario != null
    ? (abweichend
        ? `<span style="color:#ffa726;">überschrieben — Szenario ${szenario.toLocaleString('de-DE', { minimumFractionDigits:1, maximumFractionDigits:1 })} ct/kWh</span>`
        : 'Projektszenario — unverändert')
    : 'Projektannahme';

  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:14px;">
    ${karte(lastDot, 'Stromlastgang', lastWert, lastSub)}
    ${karte('#d4a855', 'Erzeugungsprofil', profWert, profSub, '#d4a855')}
    ${karte(spotDot, 'Börsenpreise', spotWert, spotSub)}
    ${karte(abweichend ? '#ffa726' : '#66bb6a', 'Strombezugspreis',
            pStromVal.toLocaleString('de-DE', { minimumFractionDigits:1, maximumFractionDigits:1 }) + ' ct/kWh',
            preisSub, abweichend ? '#ffa726' : null)}
  </div>`;
}

// ── Annahmenblatt: alle Eingaben mit Herkunft, exportierbar ──────────────────
// Für das Gutachten braucht jede Zahl eine Quelle und einen Stand. Bisher musste
// man die Werte aus dem Bedienpanel abschreiben.
function renderAnnahmenblatt(varianten) {
  const el = document.getElementById('pva-annahmenblatt');
  if (!el) return;
  const s = window._pvAnalyse;
  const p = s.lastParams;
  if (!p) { el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:20px;">Erst „Varianten berechnen".</div>'; return; }

  const szenario = (() => { try { return getEconomicScenario()?.values; } catch (e) { return null; } })();
  const num = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits:d, maximumFractionDigits:d });

  const zeile = (k, v, quelle, abw) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:11.5px;color:${abw ? '#ffa726' : 'var(--text)'};">${k}</td>
      <td style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-family:'DM Mono',monospace;font-size:11.5px;text-align:right;color:${abw ? '#ffa726' : 'var(--text)'};white-space:nowrap;">${v}</td>
      <td style="padding:6px 0 6px 16px;border-bottom:1px solid rgba(255,255,255,.05);font-size:10.5px;color:${abw ? '#ffa726' : '#78909c'};">${quelle}</td>
    </tr>`;
  const kapitel = (t) => `<tr><td colspan="3" style="padding:14px 0 6px 0;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);">${t}</td></tr>`;

  const q    = pvGetProfilQuelle();
  const kenn = pvProfilKennwerte(_pvBasisProfil8760(), pvGetSpez());
  const bd   = pvGetAssetBreakdown();
  const dem  = pvGetDemandH();
  const bedarf = pvGesamtBedarfMwh();
  const modus = s.demandMode || 'basis';
  const napE = window.elNapMaxEinspKw, napB = window.elNapMaxBezugKw;
  const abwPreis = szenario && Math.abs(p.pStrom - szenario.stromCtKwh) > 0.01;
  const abwZins  = szenario && Math.abs(p.zins * 100 - szenario.kapitalzinsPct) > 0.01;
  const nAbw = (abwPreis ? 1 : 0) + (abwZins ? 1 : 0);

  const spot = window.elSpotPreiseH;

  el.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:16px 18px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px;">
      <div>
        <div style="font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;">Berechnungsannahmen</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;">Anlage zum Gutachten — alle Eingaben der PV-Ausbauanalyse mit Herkunft</div>
      </div>
      <button class="btn-secondary" data-click="pvaAnnahmenKopieren()" style="font-size:11px;">Als Text kopieren</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:6px;">
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:9px 12px;">
        <div style="font-size:10px;color:var(--muted);">Berechnungsstand</div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;">${s.standText || '—'}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:9px 12px;">
        <div style="font-size:10px;color:var(--muted);">Parametersatz</div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;">${szenario ? escHtml(getEconomicScenario().label || '—') : 'manuell'}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);${nAbw ? 'border-left:2px solid #ffa726;' : ''}border-radius:6px;padding:9px 12px;">
        <div style="font-size:10px;color:var(--muted);">Abweichungen vom Szenario</div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;color:${nAbw ? '#ffa726' : '#66bb6a'};">${nAbw} ${nAbw === 1 ? 'Position' : 'Positionen'}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:9px 12px;">
        <div style="font-size:10px;color:var(--muted);">Berechnete Varianten</div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;">${(varianten || []).length}</div>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;">
      ${kapitel('1 · Datenbasis')}
      ${zeile('Stromlastgang', dem ? num(bedarf) + ' MWh/a' : '—',
              dem ? `${escHtml(window.elQuartierFilename || 'Upload')} · ${pvGetDt() === 1 ? 'stündlich' : '15-min'}, ${pvGetN().toLocaleString('de-DE')} Werte` : 'nicht geladen')}
      ${zeile('Lastfall', modus === 'gesamt' ? 'Strom + Wärmepumpen' : modus === 'endausbau' ? 'Endausbau ' + (s.endausbauJahr || '') : 'nur Strom',
              modus === 'gesamt' ? 'inkl. WP-/Stromkesselstrom aus der Wärmesimulation'
              : modus === 'endausbau' ? 'NAP-Messung plus Neubau-/Abrissmaßnahmen bis zum Zieljahr'
              : 'gemessener Quartierlastgang ohne Zusatzlasten')}
      ${zeile('Erzeugungsprofil', escHtml(q.label), escHtml(q.quelle) + (q.detail ? ' · ' + escHtml(q.detail) : ''))}
      ${zeile('— Spitzenleistung', num(kenn.peakKwPerKwp, 2) + ' kW/kWp', 'ohne Wechselrichter-Kappung — konservative Obergrenze für die Netzbeurteilung')}
      ${zeile('— Spezifischer Ertrag', num(pvGetSpez()) + ' kWh/kWp·a', 'Ausrichtungs-Mix der erfassten Anlagen')}
      ${zeile('Börsenpreise', spot ? 'Ø ' + (Array.from(spot).reduce((x, y) => x + y, 0) / spot.length).toFixed(1) + ' ct/kWh' : 'nicht verwendet',
              spot ? `${escHtml(window.elSpotPreiseFilename || 'Upload')} · ${spot.length.toLocaleString('de-DE')} Werte` : 'feste Einspeisevergütung')}

      ${kapitel('2 · Wirtschaftliche Annahmen')}
      ${zeile('Strombezugspreis', num(p.pStrom, 1) + ' ct/kWh',
              abwPreis ? `manuell überschrieben — Szenariowert ${num(szenario.stromCtKwh, 1)} ct/kWh` : 'Projektszenario', abwPreis)}
      ${zeile('Einspeisevergütung', num(p.pEinsp, 1) + ' ct/kWh', 'Projektannahme, für alle Varianten gleich')}
      ${zeile('Kalkulationszins', num(p.zins * 100, 1) + ' %',
              abwZins ? `manuell überschrieben — Szenariowert ${num(szenario.kapitalzinsPct, 1)} %` : 'Projektszenario', abwZins)}
      ${zeile('PV-Investition', num(p.pvInvestPerKwp) + ' €/kWp', 'schlüsselfertig inkl. Montage')}
      ${zeile('Batterie-Investition', num(p.batInvestPerKwh) + ' €/kWh', 'inkl. Aufstellung und Anbindung')}
      ${zeile('Nutzungsdauer PV / Batterie', num(p.pvLife) + ' / ' + num(p.batLife) + ' a', 'Batterie-Ersatz über die kürzere Annuität abgebildet')}
      ${zeile('Instandhaltung', num((OPT_IH.pv || 0.01) * 100, 1) + ' % / ' + num((OPT_IH.bat || 0.01) * 100, 1) + ' %', 'PV / Batterie, bezogen auf die Investitionssumme')}
      ${zeile('CO₂-Verdrängungsfaktor', num(p.co2Faktor) + ' g/kWh', 'Strommix-Pfad, Mittel über die Nutzungsdauer')}

      ${kapitel('3 · Netzanschluss')}
      ${zeile('Max. Einspeiseleistung', napE ? num(napE) + ' kW' : 'unbegrenzt', napE ? 'Netzanschluss-Zusage / VNB-Auskunft' : 'keine Begrenzung gesetzt — Abregelung wird nicht ausgewiesen')}
      ${zeile('Max. Bezugsleistung', napB ? num(napB) + ' kW' : 'unbegrenzt', napB ? 'Netzanschluss-Zusage / VNB-Auskunft' : 'keine Begrenzung gesetzt')}
      ${zeile('Kurzschlussleistung S_k″', s.skKVA ? num(s.skKVA) + ' kVA' : 'unbekannt', s.skKVA ? 'VNB-Netzauskunft' : 'ohne S_k″ greift nur das Leistungskriterium')}
      ${zeile('Zulässige Spannungsanhebung', num(s.uBudgetPct || 3, 1) + ' %', 'VDE-AR-N 4105 (NS, 3 %) bzw. 4110 (MS, 2 %)')}

      ${kapitel('4 · Anlagenpotenzial')}
      ${zeile('Gesamtpotenzial', num(pvGetMaxKwpFromAssets()) + ' kWp', 'Summe aller Quellen, doppelte Erfassung ausgeschlossen')}
      ${bd.assetKwp > 0 ? zeile('— Elektro-Assets', num(bd.assetKwp) + ' kWp', bd.assetN + ' Anlagen, im Elektro-Tab einzeln erfasst') : ''}
      ${bd.gebKwp   > 0 ? zeile('— Gebäude-PV ohne Asset', num(bd.gebKwp) + ' kWp', 'Flächenmodell aus dem Wärme-Modul') : ''}
      ${bd.ffKwp    > 0 ? zeile('— Freifläche', num(bd.ffKwp) + ' kWp', 'Freiflächen-Abgrenzung') : ''}
      ${bd.manual   > 0 ? zeile('— Manuelle Eingabe', num(bd.manual) + ' kWp', 'Feld „kWp" im Strom-Panel — prüfen, ob gewollt', true) : ''}
    </table>

    <div style="margin-top:16px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Modellgrenzen</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:6px 20px;font-size:10.5px;color:var(--muted);line-height:1.55;">
        <div>Ein Wetterjahr; jahresübergreifende Ertragsschwankung von ±8 % nicht abgebildet.</div>
        <div>Wechselrichter-Kappung nicht modelliert — die Rückspeisespitze ist eine obere Abschätzung.</div>
        <div>Batterie-Kapazitätsalterung nicht abgebildet; Ersatz über die kürzere Annuität.</div>
        <div>Wärmepumpen und Ladeinfrastruktur als feste Last, nicht als steuerbare Flexibilität.</div>
        <div>Δu-Abschätzung als Screening bei cos φ ≈ 1; ersetzt keine Netzverträglichkeitsprüfung.</div>
        <div>Einspeisevergütung als ein Satz für alle Varianten, ohne EEG-Leistungsstaffel.</div>
        <div>Kapitalwert mit konstantem Jahresüberschuss, ohne Preissteigerungspfad.</div>
        <div>Keine PV-Degradation über die Nutzungsdauer.</div>
      </div>
    </div>
  </div>`;
}

/** Annahmenblatt als Klartext in die Zwischenablage — für die Gutachten-Anlage. */
window.pvaAnnahmenKopieren = function pvaAnnahmenKopieren() {
  const el = document.getElementById('pva-annahmenblatt');
  if (!el) return;
  const txt = el.innerText.replace(/\n{3,}/g, '\n\n');
  navigator.clipboard?.writeText(txt).then(
    () => alert('Annahmenblatt in die Zwischenablage kopiert.'),
    () => alert('Kopieren nicht möglich — Text bitte manuell markieren.'));
};

function _pvBuildPanelHtml() {
  return `
<div style="padding:18px 22px;">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px;">
    <div>
      <div style="font-size:15px;font-weight:600;color:var(--text);letter-spacing:.06em;text-transform:uppercase;">PV-Ausbauanalyse</div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px;">Variantenstudie · Wirtschaftlichkeit · Netzintegration &nbsp;·&nbsp; Kapitel 3.2.5 / 3.2.6</div>
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn-secondary" data-click="pvaSetView('annahmen')" style="font-size:11px;">Annahmenblatt</button>
      <button class="btn-secondary" data-click="setViewMode('karte')" style="font-size:11px;">← Zurück zur Karte</button>
    </div>
  </div>

  <!-- Datenbasis: womit wird gerechnet? -->
  <div id="pva-datenbasis">${_pvaDatenbasisHtml()}</div>

  <!-- Steuer-Deck, sortiert nach Änderungshäufigkeit -->
  <div class="pva-controls" style="display:flex;flex-direction:column;gap:12px;">

    <!-- ═══ 01 Wirtschaftliche Annahmen ═══ -->
    <div style="background:var(--surface2);border-radius:7px;padding:13px 15px;border:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);">01</span>
        <div style="font-size:12px;font-weight:600;color:var(--text);">Wirtschaftliche Annahmen</div>
        <span class="htip" data-tip="Preise, Zins und Nutzungsdauern. Grundlage ist das dokumentierte Projektszenario; Abweichungen werden im Annahmenblatt als „manuell überschrieben“ ausgewiesen.">?</span>
        ${(() => {
          try {
            const sc = getEconomicScenario();
            return `<div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
              <span style="font-size:10px;color:#78909c;">Grundlage</span>
              <span style="padding:2px 9px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-size:10px;font-family:'DM Mono',monospace;">${escHtml(sc.label || sc.id)}</span>
            </div>`;
          } catch (e) { return ''; }
        })()}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px;font-size:11px;">
        ${_pvWirtInput('pva-p-strom', 'Strombezugspreis (ct/kWh)', _pvSzenarioWert('stromCtKwh', 30))}
        ${_pvWirtInput('pva-p-einsp', 'Einspeisevergütung (ct/kWh)', 8)}
        ${_pvWirtInput('pva-zins',    'Kalkulationszins (%)', _pvSzenarioWert('kapitalzinsPct', 3.5))}
        ${_pvWirtInput('pva-pv-invest', 'PV-Invest (€/kWp)', OPT_INVEST_DEFAULT.pv)}
        ${_pvWirtInput('pva-bat-invest','Batterie-Invest (€/kWh)', OPT_INVEST_DEFAULT.bat)}
        ${_pvWirtInput('pva-pv-life',   'Nutzungsdauer PV (a)', 20)}
        ${_pvWirtInput('pva-bat-life',  'Nutzungsdauer Batterie (a)', 15)}
        ${_pvWirtInput('pva-co2',       'CO₂-Verdrängung (g/kWh)', 380)}
      </div>
    </div>

    <!-- ═══ 02 Lastgang · 03 Netzanschlusspunkt ═══ -->
    <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:12px;">

      <div style="background:var(--surface2);border-radius:7px;padding:13px 15px;border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);">02</span>
          <div style="font-size:12px;font-weight:600;color:var(--text);">Stromlastgang</div>
          <span class="htip" data-tip="Welche Lasten werden simuliert?&#10;· Nur Strom: hochgeladener Quartierlastgang&#10;· + Wärmepumpen: addiert WP- und Stromkesselstrom aus der Wärmesimulation&#10;· Endausbau: NAP-Messung plus Neubau-/Abrissmaßnahmen bis zum Planungsjahr">?</span>
        </div>
        ${(() => {
          const hasBase = !!(window.elQuartierH15 || window.elQuartierH);
          const hasWP   = !!(window._wpElHourly || window._skElHourly);
          const mode    = window._pvAnalyse.demandMode || 'basis';
          const hasNap  = !!window.napHasMeasuredData?.();
          const curYear = globalYear || new Date().getFullYear();
          const zj      = window._pvAnalyse.endausbauJahr || (curYear + 15);
          const btn = (id, label, aktiv, gesperrt) =>
            `<button data-pva-dm="${id}" ${gesperrt ? 'disabled' : ''}
              style="flex:1;padding:6px;border-radius:5px;cursor:${gesperrt ? 'default' : 'pointer'};font-size:11px;font-weight:500;
                     border:1px solid ${aktiv ? 'var(--accent)' : 'var(--border)'};
                     background:${aktiv ? 'var(--accent)' : 'var(--surface)'};color:${aktiv ? '#000' : 'var(--text)'};
                     ${gesperrt ? 'opacity:.4;' : ''}">${label}</button>`;
          return `
          <div id="pva-strom-upload-area" data-click="document.getElementById('pva-strom-file-input').click()"
            style="border:1px dashed var(--border);border-radius:6px;padding:8px 11px;cursor:pointer;margin-bottom:9px;display:flex;align-items:center;gap:9px;"
            onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
            <span style="font-size:15px;">📂</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:10.5px;color:var(--muted);">Strom-Lastgang CSV — 15-min oder Stunden (kW)</div>
              <div style="font-size:10.5px;margin-top:2px;color:${hasBase ? 'var(--text)' : '#ef9a9a'};">
                ${hasBase ? escHtml(window.elQuartierFilename || 'geladen') : 'nicht geladen'}</div>
            </div>
          </div>
          <input type="file" id="pva-strom-file-input" accept=".csv,.txt" style="display:none;" data-change="stromFileSelected(this.files[0])"/>
          <div style="display:flex;gap:5px;margin-bottom:8px;">
            ${btn('basis', 'Nur Strom', mode === 'basis', false)}
            ${btn('gesamt', '+ Wärmepumpen', mode === 'gesamt', !hasWP)}
            ${btn('endausbau', 'Endausbau', mode === 'endausbau', !hasNap)}
          </div>
          <div style="display:flex;align-items:center;gap:9px;${mode === 'endausbau' ? '' : 'opacity:.45;'}">
            <span style="font-size:10.5px;color:var(--muted);white-space:nowrap;">Planungsjahr</span>
            <input id="pva-endausbau-jahr" type="range" value="${zj}" min="${curYear}" max="2060" step="1"
              style="flex:1;accent-color:var(--accent);" ${mode === 'endausbau' ? '' : 'disabled'}
              data-input="document.getElementById('pva-endausbau-jahr-val').textContent=this.value;window._pvAnalyse.endausbauJahr=parseInt(this.value)||window._pvAnalyse.endausbauJahr;"/>
            <span id="pva-endausbau-jahr-val" style="font-size:11px;color:var(--text);font-family:'DM Mono',monospace;min-width:34px;text-align:right;">${zj}</span>
          </div>`;
        })()}
      </div>

      <div style="background:var(--surface2);border-radius:7px;padding:13px 15px;border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);">03</span>
          <div style="font-size:12px;font-weight:600;color:var(--text);">Netzanschlusspunkt</div>
          <span class="htip" data-tip="Grenzen am Netzanschlusspunkt (0 = unbegrenzt) und Netzstärke für die Rückspeise-Bewertung. S_k″ hängt vom vorgelagerten Netz ab, nicht von der eigenen Anschlussleistung.">?</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
          <div>
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:3px;">Max. Einspeisung (kW)</div>
            <input id="pva-nap-einsp" type="number" value="0" min="0" step="10"
              style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;"
              data-change="window._pvAnalyse.napMaxEinspKw=parseFloat(this.value)||0;window.elNapMaxEinspKw=window._pvAnalyse.napMaxEinspKw||null;(document.getElementById('strom-nap-einsp-kw')||{}).value=this.value"/>
          </div>
          <div>
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:3px;">Max. Bezug (kW)</div>
            <input id="pva-nap-bezug" type="number" value="0" min="0" step="10"
              style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;"
              data-change="window._pvAnalyse.napMaxBezugKw=parseFloat(this.value)||0;window.elNapMaxBezugKw=window._pvAnalyse.napMaxBezugKw||null;(document.getElementById('strom-nap-bezug-kw')||{}).value=this.value"/>
          </div>
          <div style="grid-column:1/-1;">
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:3px;">Spannungsebene (Richtwert für S_k″)</div>
            <select id="pva-spannungsebene" data-change="pvSpannungsebeneChanged(this.value)"
              style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;">
              <option value="">– wählen (nur Richtwert) –</option>
              <option value="ns">Niederspannung 0,4 kV — ~500 kVA</option>
              <option value="ms">Mittelspannung 10/20 kV — ~10.000 kVA</option>
            </select>
          </div>
          <div>
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:3px;">S_k″ (kVA)</div>
            <input id="pva-sk" type="number" value="0" min="0" step="100"
              style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;"
              data-change="window._pvAnalyse.skKVA=parseFloat(this.value)||0"/>
          </div>
          <div>
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:3px;">Δu-Budget (%)</div>
            <input id="pva-ubudget" type="number" value="3" min="1" max="10" step="0.5"
              style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;"
              data-change="window._pvAnalyse.uBudgetPct=parseFloat(this.value)||3"/>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ 04 Anlagenpotenzial · 05 Erzeugungsprofil ═══ -->
    <div style="display:grid;grid-template-columns:1fr 1.25fr;gap:12px;">

      <div style="background:var(--surface2);border-radius:7px;padding:13px 15px;border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);">04</span>
          <div style="font-size:12px;font-weight:600;color:var(--text);">Anlagenpotenzial</div>
          <span class="htip" data-tip="Summe aller PV-Quellen. Gebäude mit eigenem Elektro-Asset werden nicht zusätzlich pauschal gezählt — dieselbe Dachfläche darf nur einmal zählen.">?</span>
        </div>
        ${(() => {
          const bd = pvGetAssetBreakdown();
          const total = bd.assetKwp + bd.gebKwp + bd.ffKwp + bd.manual;
          const zeile = (label, wert, warn) => wert > 0
            ? `<div style="display:flex;justify-content:space-between;font-size:10.5px;padding:2px 0;color:${warn ? '#ef9a9a' : 'var(--muted)'};">
                 <span>${label}</span><span style="font-family:'DM Mono',monospace;color:${warn ? '#ef9a9a' : 'var(--text)'};">${wert.toFixed(0)} kWp</span></div>`
            : '';
          return `
          <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:8px;">
            <span id="pva-asset-kwp" style="font-family:'DM Mono',monospace;font-size:22px;color:${total > 0 ? '#fdd835' : '#ef9a9a'};">${total.toFixed(0)}</span>
            <span style="font-size:11px;color:var(--muted);">kWp maximal</span>
          </div>
          ${zeile(`Elektro-Assets (${bd.assetN}×)`, bd.assetKwp)}
          ${zeile('Gebäude-PV ohne Asset', bd.gebKwp)}
          ${zeile('Freifläche', bd.ffKwp)}
          ${zeile('Strom-Panel (manuell)', bd.manual, true)}
          <div style="font-size:10.5px;color:var(--muted);margin:8px 0 3px 0;">Manuell überschreiben (0 = aus Projekt)</div>
          <input id="pva-max-kwp" type="number" value="${window._pvAnalyse.pvMaxKwpOverride || 0}" min="0" step="10"
            style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;"
            data-change="window._pvAnalyse.pvMaxKwpOverride=parseFloat(this.value)||0"/>`;
        })()}
      </div>

      <div style="background:var(--surface2);border-radius:7px;padding:13px 15px;border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);">05</span>
          <div style="font-size:12px;font-weight:600;color:var(--text);">Erzeugungsprofil &amp; Börsenpreise</div>
          <span class="htip" data-tip="Der zeitliche Verlauf bestimmt Rückspeisespitze, Abregelung und Eigenverbrauchsquote. Ein hochgeladenes PVGIS-/Messprofil hat Vorrang vor dem synthetischen; die Jahresmenge kommt weiterhin aus dem spezifischen Ertrag.">?</span>
        </div>
        <div id="pva-profil-info" style="margin-bottom:10px;"></div>
        <div id="pva-spot-upload-area" data-click="document.getElementById('pva-spot-file-input').click()"
          style="border:1px dashed var(--border);border-radius:6px;padding:8px 11px;cursor:pointer;display:flex;align-items:center;gap:9px;"
          onmouseenter="this.style.borderColor='#ab47bc'" onmouseleave="this.style.borderColor='var(--border)'">
          <span style="font-size:15px;">💹</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10.5px;color:var(--muted);">Spot-Preise CSV (EPEX DE, SMARD/ENTSO-E)</div>
            <div id="pva-spot-status" style="font-size:10.5px;margin-top:2px;color:var(--muted);">nicht geladen</div>
          </div>
        </div>
        <input type="file" id="pva-spot-file-input" accept=".csv,.txt" style="display:none;" data-change="spotPreisFileSelected(this.files[0])"/>
        <div style="font-size:10px;color:#607d8b;margin-top:5px;">Mit Spot-Preisen rechnen „Wirtschaftlich optimiert" und „Max PV" mit Börsenerlösen statt fester Vergütung.</div>

        <div style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border);">
          ${(() => {
            const ws = getWindAssetsSummary();
            const an = window._pvAnalyse.windEnabled === true && ws.count > 0;
            const tm = window._pvAnalyse.windTarifModus || 'gemeinsam';
            return `
            <label style="display:flex;align-items:center;gap:7px;cursor:${ws.count > 0 ? 'pointer' : 'default'};font-size:11px;color:${ws.count > 0 ? 'var(--text)' : '#607d8b'};">
              <input type="checkbox" id="pva-wind-enable" ${an ? 'checked' : ''} ${ws.count === 0 ? 'disabled' : ''}
                data-change="window._pvAnalyse.windEnabled=this.checked;document.getElementById('pva-wind-detail').style.display=this.checked?'block':'none';"
                style="accent-color:#4dd0e1;">
              🌀 Windkraftanlagen einbeziehen
              ${ws.count > 0 ? `<span style="color:#4dd0e1;font-weight:500;">(${ws.count}× · ${ws.mwh.toFixed(0)} MWh/a)</span>`
                             : '<span style="font-size:10px;">— keine aktive Anlage im Projekt</span>'}
            </label>
            <div id="pva-wind-detail" style="display:${an ? 'block' : 'none'};margin-top:7px;padding-left:22px;">
              <select id="pva-wind-tarif-modus" data-change="window._pvAnalyse.windTarifModus=this.value;document.getElementById('pva-wind-p-einsp-row').style.display=this.value==='getrennt'?'block':'none';"
                style="width:100%;padding:5px 7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:11px;margin-bottom:7px;">
                <option value="gemeinsam" ${tm !== 'getrennt' ? 'selected' : ''}>Gemeinsam mit PV-Einspeisevergütung</option>
                <option value="getrennt" ${tm === 'getrennt' ? 'selected' : ''}>Getrennt — eigener Windkraft-Tarif</option>
              </select>
              <div id="pva-wind-p-einsp-row" style="display:${tm === 'getrennt' ? 'block' : 'none'};">
                ${_pvWirtInput('pva-wind-p-einsp', 'Wind-Einspeisevergütung (ct/kWh)', window._pvAnalyse.pWindEinsp ?? 7.0)}
              </div>
              ${_pvWirtInput('pva-wind-invest', 'Wind-Invest (€/kW)', window._pvAnalyse.windInvestPerKw ?? 1800)}
            </div>`;
          })()}
        </div>
      </div>
    </div>

    <!-- ═══ 06 Infrastruktur — einklappbar, weil selten geändert ═══ -->
    <div style="background:var(--surface2);border-radius:7px;padding:13px 15px;border:1px solid var(--border);">
      <div data-click="pvaDeckToggle('infra')" style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;"
           title="Ein- und ausklappen">
        <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);">06</span>
        <div style="font-size:12px;font-weight:600;color:var(--text);">Netzanschluss-Infrastruktur</div>
        <span class="htip" data-tip="Netzanschluss- und Zusatzkosten je PV-Leistungsstufe. Die Stufe wird jeder Variante automatisch nach ihrer PV-Leistung zugeordnet; alle Werte sind editierbar.">?</span>
        <span id="pva-infra-summary" style="margin-left:auto;font-size:10px;color:#78909c;">${_pvaInfraSummary()}</span>
        <span id="pva-infra-caret" style="color:#78909c;font-size:11px;width:12px;text-align:center;">${window._pvAnalyse.deckZu?.infra ? '▸' : '▾'}</span>
      </div>
      <div id="pva-infra-body" style="display:${window._pvAnalyse.deckZu?.infra ? 'none' : 'grid'};
           grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-top:10px;">
        <div id="pva-infra-stufen" style="font-size:10.5px;"></div>
        <div>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:11px;color:var(--text);margin-bottom:7px;">
            <input type="checkbox" id="pva-erznetz-aktiv" style="accent-color:#fdd835;"
              data-change="window._pvAnalyse.erzNetzAktiv=this.checked;document.getElementById('pva-erznetz-detail').style.display=this.checked?'grid':'none'">
            Erzeugungsnetz (dediziert)
          </label>
          <div id="pva-erznetz-detail" style="display:none;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:9px;">
            <div>
              <div style="font-size:10px;color:var(--muted);">Länge (m)</div>
              <input id="pva-erznetz-laenge" type="number" value="0" min="0" step="10"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10.5px;"
                data-change="window._pvAnalyse.erzNetz.laengeM=parseFloat(this.value)||0"/>
            </div>
            <div>
              <div style="font-size:10px;color:var(--muted);">€/m</div>
              <input id="pva-erznetz-preis" type="number" value="250" min="50" step="25"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10.5px;"
                data-change="window._pvAnalyse.erzNetz.preisPrM=parseFloat(this.value)||250"/>
            </div>
            <div style="grid-column:1/-1;">
              <div style="font-size:10px;color:var(--muted);">Übergabepunkt / Schutz (€)</div>
              <input id="pva-erznetz-schutz" type="number" value="5000" min="0" step="500"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10.5px;"
                data-change="window._pvAnalyse.erzNetz.schutzEUR=parseFloat(this.value)||5000"/>
            </div>
          </div>
          <div style="font-size:10.5px;color:var(--muted);margin-bottom:5px;">
            Mehrkosten (geteilte Infrastruktur)
            <span class="htip" data-tip="Infrastruktur, die ohnehin ertüchtigt werden müsste, wegen PV aber anders dimensioniert wird: nur die Differenzkosten eintragen.">?</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div>
              <div style="font-size:10px;color:var(--muted);">Invest (€)</div>
              <input id="pva-mehrkosten-invest" type="number" value="0" min="0" step="1000"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10.5px;"
                data-change="window._pvAnalyse.mehrkosten.investEUR=parseFloat(this.value)||0"/>
            </div>
            <div>
              <div style="font-size:10px;color:var(--muted);">Jährlich (€/a)</div>
              <input id="pva-mehrkosten-jk" type="number" value="0" min="0" step="100"
                style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10.5px;"
                data-change="window._pvAnalyse.mehrkosten.jaehrlichEUR=parseFloat(this.value)||0"/>
            </div>
          </div>
          <input id="pva-mehrkosten-label" type="text" placeholder="Beschreibung…"
            style="width:100%;margin-top:5px;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:10.5px;box-sizing:border-box;"
            data-change="window._pvAnalyse.mehrkosten.label=this.value"/>
        </div>
      </div>
    </div>
  </div>

  <!-- Hinweis: Eingaben haben sich seit der letzten Berechnung geändert -->
  <div id="pva-stale-hinweis" style="margin-top:12px;padding:9px 13px;border-radius:7px;
    background:rgba(255,167,38,0.10);border:1px solid #ffa726;border-left:3px solid #ffa726;
    font-size:11px;color:#ffb74d;display:none;align-items:center;gap:9px;">
    <span style="font-size:14px;">⚠</span>
    <span>Die Eingaben haben sich geändert — die Ergebnisse stammen noch aus der vorherigen
      Berechnung. <b>Varianten neu berechnen</b>, bevor Zahlen ins Gutachten übernommen werden.</span>
  </div>

  <button class="btn-confirm" id="pva-btn-berechnen"
    style="width:100%;padding:11px;font-size:12px;margin-top:12px;letter-spacing:.04em;"
    data-click="pvBerechneAlle()">Varianten berechnen</button>

  <!-- ═══ ERGEBNISSE: Navigation links, eine Ansicht rechts ═══ -->
  <div id="pva-ergebnisse" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px;
       display:grid;grid-template-columns:224px minmax(0,1fr);gap:18px;transition:opacity .15s;">
    ${_pvaNavHtml()}
    <div style="min-width:0;">
      <div id="pva-leer-hinweis" style="color:var(--muted);font-size:11px;text-align:center;padding:50px 0;">
        ${(() => {
          const hasBase = !!(window.elQuartierH15 || window.elQuartierH);
          if (!hasBase) return 'Lastgang oben hochladen und anschließend „Varianten berechnen".';
          return '✓ Lastgang geladen — jetzt „Varianten berechnen".';
        })()}
      </div>
      <div id="pva-result-tabelle"          style="display:none;"></div>
      <div id="pva-methodik"                style="display:none;"></div>
      <div id="pva-herleitung"              style="display:none;"></div>
      <div id="pva-rechenweg"               style="display:none;"></div>
      <div id="pva-chart-heatmap"           style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-grenznutzen"       style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-wind-grenz"        style="overflow:hidden;"></div>
      <div id="pva-ev-kurve"                style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-bilanz"            style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-scatter"           style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-rueck"             style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-fluss"             style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-autarkie-heatmap"  style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-sensitivitaet"     style="display:none;overflow:hidden;"></div>
      <div id="pva-chart-resilienz"         style="display:none;overflow:hidden;"></div>
      <div id="pva-annahmenblatt"           style="display:none;"></div>
    </div>
  </div>
</div>`;
}

/** Gruppe des Steuer-Decks ein-/ausklappen. Der Zustand liegt im Modul-State,
 *  damit er den Panel-Neuaufbau beim Tab-Wechsel überlebt. */
window.pvaDeckToggle = function pvaDeckToggle(key) {
  const s = window._pvAnalyse;
  if (!s.deckZu) s.deckZu = {};
  s.deckZu[key] = !s.deckZu[key];
  const body  = document.getElementById('pva-' + key + '-body');
  const caret = document.getElementById('pva-' + key + '-caret');
  if (body)  body.style.display = s.deckZu[key] ? 'none' : 'grid';
  if (caret) caret.textContent  = s.deckZu[key] ? '▸' : '▾';
};

/** Kurzfassung für die eingeklappte Kopfzeile: Summe der aktiven Stufenkosten
 *  und — sobald gerechnet wurde — die Stufe der hervorgehobenen Variante. */
function _pvaInfraSummary() {
  try {
    const stufen = PV_INFRA_STUFEN.map(st => {
      const items = _pvInfraItems(st.id);
      return { label: st.label, bisKwp: st.bisKwp,
               invest: items.reduce((sum, it) => sum + (it.aktiv ? (it.investEUR || 0) : 0), 0) };
    });
    const erg  = window._pvAnalyse.ergebnisse || [];
    const best = erg.find(e => e.id === 'wirt-opt') || erg[0];
    const teil = best ? stufen.find(st => best.pvKwp <= st.bisKwp) : null;
    const basis = stufen.length + ' Stufen · ' +
      Math.round(stufen.reduce((x, y) => x + y.invest, 0)).toLocaleString('de-DE') + ' € hinterlegt';
    return teil
      ? basis + ' · gewählte Variante: ' + escHtml(teil.label) + ' (' + Math.round(teil.invest).toLocaleString('de-DE') + ' €)'
      : basis;
  } catch (e) { return 'Kosten je PV-Leistungsstufe'; }
}

/** Wert aus dem dokumentierten Projektszenario, mit Rückfall auf den Default. */
function _pvSzenarioWert(key, fallback) {
  try {
    const v = getEconomicScenario()?.values?.[key];
    return (v != null && isFinite(v)) ? v : fallback;
  } catch (e) { return fallback; }
}

// ══════════════════════════════════════════════════════════════════════════════
// HERLEITUNG JE VARIANTE — die Optimierung sichtbar machen
// ══════════════════════════════════════════════════════════════════════════════
// Jede Variante entsteht aus GENAU EINEM Kriterium. Die Lesehilfe sagt das in
// Worten; für das Gutachten braucht es den Beleg. Gezeichnet wird deshalb nicht
// eine nachgerechnete Kurve, sondern die tatsächliche SUCHSPUR der Optimierung
// (state.herleitung, gefüllt während pvBerechneAlle) — inklusive des Punktes,
// an dem das Kriterium gerissen ist und die Suche abgebrochen hat.

/** Gemeinsames Achsenkreuz für die Herleitungs-Diagramme. */
function _hlAchsen(W, H, PL, PR, PT, PB, xTicks, yTicks, xLabel, yLabel) {
  let g = `<line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="var(--border)" stroke-width="1"/>
           <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="var(--border)" stroke-width="1"/>`;
  for (const t of xTicks) {
    g += `<line x1="${t.x.toFixed(1)}" y1="${PT}" x2="${t.x.toFixed(1)}" y2="${H - PB}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
          <text x="${t.x.toFixed(1)}" y="${H - PB + 13}" text-anchor="middle" fill="#78909c" font-size="9">${t.l}</text>`;
  }
  for (const t of yTicks) {
    g += `<line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W - PR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
          <text x="${PL - 6}" y="${(t.y + 3).toFixed(1)}" text-anchor="end" fill="#78909c" font-size="9">${t.l}</text>`;
  }
  g += `<text x="${((PL + W - PR) / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" fill="#607d8b" font-size="9">${xLabel}</text>`;
  g += `<text x="10" y="${(PT + 4).toFixed(1)}" fill="#607d8b" font-size="9">${yLabel}</text>`;
  return g;
}

/** Panel-Rahmen mit Titel, Kriterium und Ergebnissatz. */
function _hlPanel(v, kriterium, svg, fazit) {
  return `
  <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${v.farbe};
              border-radius:7px;padding:13px 15px;display:flex;flex-direction:column;gap:9px;min-width:0;">
    <div style="display:flex;align-items:baseline;gap:8px;">
      <span style="color:${v.farbe};font-size:13px;">${v.icon}</span>
      <span style="font-size:12px;font-weight:600;color:var(--text);">${escHtml(v.label)}</span>
    </div>
    <div style="font-size:10.5px;color:${v.farbe};">Kriterium: ${kriterium}</div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:6px 4px 2px 4px;">${svg}</div>
    <div style="font-size:10.5px;color:var(--muted);line-height:1.55;">${fazit}</div>
  </div>`;
}

function renderHerleitung(varianten) {
  const el = document.getElementById('pva-herleitung');
  if (!el || !varianten?.length) return;
  const H = window._pvAnalyse.herleitung;
  if (!H) { el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:20px;">Erst „Varianten berechnen".</div>'; return; }

  const gesamtW = el.getBoundingClientRect().width || 900;
  const zweiSpaltig = gesamtW > 760;
  const W = Math.max(300, Math.floor((zweiSpaltig ? (gesamtW - 12) / 2 : gesamtW) - 34));
  const HH = 190, PL = 46, PR = 14, PT = 12, PB = 26;
  const num = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const vOf = (id) => varianten.find(x => x.id === id);

  const panels = [];

  // ── 1 · Minimal: Schwellen ────────────────────────────────────────────────
  const vMin = vOf('minimal');
  if (vMin && H.minimal) {
    const d = H.minimal;
    // Die oberste Stufe ist nach oben offen (bisKwp = Infinity) — für die
    // Zeichnung auf einen endlichen Rand bringen, sonst kollabiert die log-Achse.
    const endlich = d.stufen.map(st => st.bisKwp).filter(isFinite);
    const letzte  = endlich.length ? endlich[endlich.length - 1] : 2000;
    const maxK    = Math.max(letzte * 2.5, d.gewaehlt * 3, 200);
    const bisX    = (st) => (isFinite(st.bisKwp) ? Math.min(st.bisKwp, maxK) : maxK);
    const lx = (k) => PL + (Math.log10(Math.max(10, Math.min(k, maxK))) - 1) / (Math.log10(maxK) - 1) * (W - PL - PR);
    // Die Stufen liegen zwischen einigen hundert und sechsstelligen Beträgen —
    // linear wäre alles unterhalb der letzten Stufe nicht mehr unterscheidbar.
    const maxE  = Math.max(...d.stufen.map(s => s.invest), 1000);
    const minE  = Math.max(100, Math.min(...d.stufen.map(s => s.invest).filter(v => v > 0), maxE));
    const lgLo  = Math.log10(minE / 2), lgHi = Math.log10(maxE * 1.4);
    const ly = (e) => HH - PB - (Math.log10(Math.max(minE / 2, e)) - lgLo) / (lgHi - lgLo) * (HH - PT - PB);

    // Treppenzug der Infrastruktur-Investition
    let pfad = '', vor = PL;
    d.stufen.forEach((st) => {
      const x2 = lx(bisX(st)), y = ly(st.invest);
      pfad += `M${vor.toFixed(1)} ${y.toFixed(1)} L${x2.toFixed(1)} ${y.toFixed(1)} `;
      vor = x2;
    });
    let stufen = '';
    d.stufen.forEach((st, i) => {
      if (i === 0) return;
      const x = lx(bisX(d.stufen[i - 1]));
      stufen += `<line x1="${x.toFixed(1)}" y1="${ly(d.stufen[i - 1].invest).toFixed(1)}" x2="${x.toFixed(1)}" y2="${ly(st.invest).toFixed(1)}" stroke="#ff8a65" stroke-width="1.6"/>`;
    });
    const xg = lx(d.gewaehlt), xgr = lx(d.grenzeKwp);
    const ticks = [10, 30, 100, 500, 2000, 5000].filter(t => t <= maxK).map(t => ({ x: lx(t), l: t >= 1000 ? num(t / 1000) + 'k' : String(t) }));
    const yT = [minE, Math.sqrt(minE * maxE), maxE].map(e =>
      ({ y: ly(e), l: e >= 1000 ? num(e / 1000) + 'k' : num(e) }));

    const svg = `<svg width="100%" viewBox="0 0 ${W} ${HH}" style="display:block;">
      ${_hlAchsen(W, HH, PL, PR, PT, PB, ticks, yT, 'PV-Leistung (kWp, log.)', '€ Infra (log.)')}
      <path d="${pfad}" fill="none" stroke="#ff8a65" stroke-width="2"/>
      ${stufen}
      <line x1="${xgr.toFixed(1)}" y1="${PT}" x2="${xgr.toFixed(1)}" y2="${HH - PB}" stroke="#ef5350" stroke-width="1.4" stroke-dasharray="4 3"/>
      <text x="${(xgr + 4).toFixed(1)}" y="${PT + 10}" fill="#ef5350" font-size="9">${num(d.grenzeKwp)} kWp: EZA-Regler + Direktvermarktung</text>
      <circle cx="${xg.toFixed(1)}" cy="${ly(d.gewaehltInvest).toFixed(1)}" r="4.5" fill="${vMin.farbe}" stroke="var(--bg)" stroke-width="1.5"/>
      <text x="${(xg - 4).toFixed(1)}" y="${(ly(d.gewaehltInvest) - 8).toFixed(1)}" text-anchor="end" fill="${vMin.farbe}" font-size="9.5">${num(d.gewaehlt)} kWp</text>
    </svg>`;

    panels.push(_hlPanel(vMin, 'letzte Stufe unterhalb der 100-kWp-Pflichtgrenze', svg,
      `Die Infrastrukturkosten springen an den Leistungsgrenzen. Bei <b style="color:var(--text)">${num(d.gewaehlt)} kWp</b> ` +
      `liegt die Anlage in der Stufe „${escHtml(d.gewaehltStufe)}" mit <b style="color:#ff8a65">${num(d.gewaehltInvest)} €</b> ` +
      `Netzanschlusskosten — der nächste Schritt kostet <b style="color:#ef5350">${num(d.naechsterInvest)} €</b> und bringt ` +
      `zusätzlich EZA-Regler und Direktvermarktungspflicht mit sich. Optimum heißt hier: günstigster Einstieg, nicht höchster Ertrag.`));
  }

  // ── 2 · Eigenverbrauchs-optimiert: Quotenschwelle ─────────────────────────
  const vEv = vOf('ev-opt');
  if (vEv && H.evOpt?.punkte?.length) {
    const d = H.evOpt, pts = d.punkte;
    const maxK = pts[pts.length - 1].kwp;
    // Die Quote bewegt sich nur im oberen Band — 0…100 % würde die Kurve zu
    // einer waagerechten Linie am oberen Rand zusammendrücken.
    const qMin = Math.max(0, Math.floor(Math.min(d.schwelle, ...pts.map(p => p.quote)) - 3));
    const x = (k) => PL + k / maxK * (W - PL - PR);
    const y = (q) => HH - PB - (q - qMin) / (100 - qMin) * (HH - PT - PB);
    const pfad = pts.map((p, i) => (i ? 'L' : 'M') + x(p.kwp).toFixed(1) + ' ' + y(p.quote).toFixed(1)).join(' ');
    const gew = pts.find(p => p.kwp === d.gewaehlt) || pts[0];
    const brk = pts.find(p => p.quote < d.schwelle);
    const ticks = [0, maxK / 2, maxK].map(k => ({ x: x(k), l: num(k) }));
    const yT = [qMin, d.schwelle, 100].map(q => ({ y: y(q), l: num(q) + '%' }));

    const svg = `<svg width="100%" viewBox="0 0 ${W} ${HH}" style="display:block;">
      ${_hlAchsen(W, HH, PL, PR, PT, PB, ticks, yT, 'PV-Leistung (kWp)', 'EV-Quote')}
      <line x1="${PL}" y1="${y(d.schwelle).toFixed(1)}" x2="${W - PR}" y2="${y(d.schwelle).toFixed(1)}" stroke="#ffa726" stroke-width="1.4" stroke-dasharray="4 3"/>
      <text x="${(PL + 5).toFixed(1)}" y="${(y(d.schwelle) + 12).toFixed(1)}" fill="#ffa726" font-size="9">Kriterium ${num(d.schwelle)} % Eigenverbrauch</text>
      <path d="${pfad}" fill="none" stroke="#a5d6a7" stroke-width="2"/>
      ${brk ? `<circle cx="${x(brk.kwp).toFixed(1)}" cy="${y(brk.quote).toFixed(1)}" r="3.5" fill="none" stroke="#ef5350" stroke-width="1.6"/>
               <text x="${(x(brk.kwp) - 6).toFixed(1)}" y="${(y(brk.quote) + 13).toFixed(1)}" text-anchor="end" fill="#ef5350" font-size="9">${num(brk.kwp)} kWp: ${num(brk.quote, 1)} % — gerissen</text>` : ''}
      <circle cx="${x(gew.kwp).toFixed(1)}" cy="${y(gew.quote).toFixed(1)}" r="4.5" fill="${vEv.farbe}" stroke="var(--bg)" stroke-width="1.5"/>
      <text x="${(x(gew.kwp) - 8).toFixed(1)}" y="${(y(gew.quote) - 9).toFixed(1)}" text-anchor="end" fill="${vEv.farbe}" font-size="9.5">${num(gew.kwp)} kWp · ${num(gew.quote, 1)} %</text>
    </svg>`;

    panels.push(_hlPanel(vEv, `größte Anlage mit Eigenverbrauchsquote ≥ ${num(d.schwelle)} %`, svg,
      `Die Eigenverbrauchsquote fällt mit jeder zusätzlichen Kilowattpeak, weil der Mittagsüberschuss wächst. ` +
      `<b style="color:var(--text)">${num(gew.kwp)} kWp</b> ist die letzte Stützstelle über der Schwelle` +
      (brk ? `; bei ${num(brk.kwp)} kWp sind es nur noch ${num(brk.quote, 1)} %.` : '.') +
      ` Optimum heißt hier: maximale Größe ohne nennenswerte Einspeisung — geringstes Netz- und Marktrisiko.`));
  }

  // ── 3 · Wirtschaftlich optimiert: Maximum des Jahresüberschusses ──────────
  const vWirt = vOf('wirt-opt');
  if (vWirt && H.wirtOpt?.punkte?.length) {
    const d = H.wirtOpt, pts = d.punkte;
    const maxK = pts[pts.length - 1].kwp;
    const uMin = Math.min(0, ...pts.map(p => p.ueber));
    const uMax = Math.max(...pts.map(p => p.ueber), 1);
    const x = (k) => PL + k / maxK * (W - PL - PR);
    const y = (u) => HH - PB - (u - uMin) / (uMax - uMin) * (HH - PT - PB);
    const flaeche = pts.map((p, i) => (i ? 'L' : 'M') + x(p.kwp).toFixed(1) + ' ' + y(p.ueber).toFixed(1)).join(' ') +
      ` L${x(maxK).toFixed(1)} ${y(uMin).toFixed(1)} L${x(pts[0].kwp).toFixed(1)} ${y(uMin).toFixed(1)} Z`;
    const linie = pts.map((p, i) => (i ? 'L' : 'M') + x(p.kwp).toFixed(1) + ' ' + y(p.ueber).toFixed(1)).join(' ');
    const best = pts.reduce((a, b) => (b.ueber > a.ueber ? b : a), pts[0]);
    const ticks = [0, maxK / 2, maxK].map(k => ({ x: x(k), l: num(k) }));
    const yT = [uMin, (uMin + uMax) / 2, uMax].map(u => ({ y: y(u), l: num(u / 1000) + 'k' }));

    const svg = `<svg width="100%" viewBox="0 0 ${W} ${HH}" style="display:block;">
      ${_hlAchsen(W, HH, PL, PR, PT, PB, ticks, yT, 'PV-Leistung (kWp), je Stufe mit optimaler Batterie', '€/a')}
      ${uMin < 0 ? `<line x1="${PL}" y1="${y(0).toFixed(1)}" x2="${W - PR}" y2="${y(0).toFixed(1)}" stroke="#546e7a" stroke-width="1"/>` : ''}
      <path d="${flaeche}" fill="#66bb6a" opacity=".14"/>
      <path d="${linie}" fill="none" stroke="#66bb6a" stroke-width="2"/>
      <line x1="${x(best.kwp).toFixed(1)}" y1="${PT}" x2="${x(best.kwp).toFixed(1)}" y2="${(HH - PB).toFixed(1)}" stroke="${vWirt.farbe}" stroke-width="1" stroke-dasharray="3 3"/>
      <circle cx="${x(best.kwp).toFixed(1)}" cy="${y(best.ueber).toFixed(1)}" r="4.5" fill="${vWirt.farbe}" stroke="var(--bg)" stroke-width="1.5"/>
      <text x="${(x(best.kwp) + 6).toFixed(1)}" y="${(y(best.ueber) - 7).toFixed(1)}" fill="${vWirt.farbe}" font-size="9.5">${num(best.kwp)} kWp / ${num(best.bat)} kWh · ${num(best.ueber / 1000)} k€/a</text>
    </svg>`;

    panels.push(_hlPanel(vWirt, 'höchster jährlicher Netto-Überschuss (PV × Batterie gemeinsam)', svg,
      `Für jede PV-Stufe wurde die wirtschaftlich beste Batteriegröße gesucht und die Kombination mit dem höchsten ` +
      `Jahresüberschuss gewählt: <b style="color:var(--text)">${num(best.kwp)} kWp mit ${num(best.bat)} kWh</b>. ` +
      `Die Kuppe ist flach — ${(() => {
        const nahe = pts.filter(p => p.ueber >= best.ueber * 0.95 && p.kwp < best.kwp);
        return nahe.length
          ? `schon ${num(nahe[0].kwp)} kWp erreichen 95 % des Überschusses. Das ist der Spielraum für nicht-wirtschaftliche Argumente.`
          : 'in der Nähe des Optimums kostet eine kleinere Anlage nur wenig Überschuss.';
      })()} Ausgewählt wird bewusst über den Überschuss, nicht über die Amortisation — die bevorzugt Kleinstanlagen.`));
  }

  // ── 4 · Autarkie-optimiert: Sättigung ─────────────────────────────────────
  const vAut = vOf('autarkie');
  if (vAut && H.autarkie?.punkte?.length > 1) {
    const d = H.autarkie, pts = d.punkte;
    const maxB = pts[pts.length - 1].bat || 1;
    const aMin = Math.min(...pts.map(p => p.aut));
    const aMax = Math.max(...pts.map(p => p.aut));
    const spanne = Math.max(1, aMax - aMin);
    const x = (b) => PL + b / maxB * (W - PL - PR);
    const y = (a) => HH - PB - (a - aMin) / spanne * (HH - PT - PB);
    const linie = pts.map((p, i) => (i ? 'L' : 'M') + x(p.bat).toFixed(1) + ' ' + y(p.aut).toFixed(1)).join(' ');
    const gew = pts.find(p => p.bat === d.gewaehlt) || pts[pts.length - 1];
    const stopp = pts.find(p => p.marg != null && p.marg < d.schwelle);
    const ticks = [0, maxB / 2, maxB].map(b => ({ x: x(b), l: num(b / 1000, 1) + ' MWh' }));
    const yT = [aMin, (aMin + aMax) / 2, aMax].map(a => ({ y: y(a), l: num(a, 1) + '%' }));

    // Balken für den marginalen Zuwachs je Stufe
    let balken = '';
    const margMax = Math.max(...pts.map(p => p.marg || 0), d.schwelle * 2);
    pts.forEach((p, i) => {
      if (p.marg == null || i === 0) return;
      const bx = x(pts[i - 1].bat), bw = Math.max(2, x(p.bat) - bx - 2);
      const bh = (p.marg / margMax) * (HH - PT - PB) * 0.45;
      balken += `<rect x="${bx.toFixed(1)}" y="${(HH - PB - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"
                  fill="${p.marg < d.schwelle ? '#ef5350' : '#4fc3f7'}" opacity=".3"/>`;
    });
    const ySchwelle = HH - PB - (d.schwelle / margMax) * (HH - PT - PB) * 0.45;

    const svg = `<svg width="100%" viewBox="0 0 ${W} ${HH}" style="display:block;">
      ${_hlAchsen(W, HH, PL, PR, PT, PB, ticks, yT, 'Batteriekapazität', 'Autarkie')}
      ${balken}
      <line x1="${PL}" y1="${ySchwelle.toFixed(1)}" x2="${W - PR}" y2="${ySchwelle.toFixed(1)}" stroke="#ffa726" stroke-width="1.2" stroke-dasharray="4 3"/>
      <text x="${W - PR}" y="${(ySchwelle - 4).toFixed(1)}" text-anchor="end" fill="#ffa726" font-size="9">Sättigung: ${num(d.schwelle, 1)} %-Punkte je MWh</text>
      <path d="${linie}" fill="none" stroke="#4fc3f7" stroke-width="2"/>
      ${stopp ? `<circle cx="${x(stopp.bat).toFixed(1)}" cy="${y(stopp.aut).toFixed(1)}" r="3.5" fill="none" stroke="#ef5350" stroke-width="1.6"/>` : ''}
      <circle cx="${x(gew.bat).toFixed(1)}" cy="${y(gew.aut).toFixed(1)}" r="4.5" fill="${vAut.farbe}" stroke="var(--bg)" stroke-width="1.5"/>
      <text x="${(x(gew.bat) - 6).toFixed(1)}" y="${(y(gew.aut) - 8).toFixed(1)}" text-anchor="end" fill="${vAut.farbe}" font-size="9.5">${num(gew.bat / 1000, 1)} MWh · ${num(gew.aut, 1)} %</text>
    </svg>`;

    panels.push(_hlPanel(vAut, 'Batterie bis zur technischen Sättigung des Autarkiegrads', svg,
      `Die Kurve flacht ab: jede weitere MWh Speicher bringt weniger Autarkie (blaue Balken = Zuwachs je Stufe). ` +
      `Abgebrochen wird, sobald der Zuwachs unter <b style="color:#ffa726">${num(d.schwelle, 1)} %-Punkte je MWh</b> fällt` +
      (stopp ? ` — das passiert bei ${num(stopp.bat / 1000, 1)} MWh (roter Balken).` : '.') +
      ` Gewählt: <b style="color:var(--text)">${num(gew.bat)} kWh</b> für ${num(gew.aut, 1)} % Autarkie. ` +
      `Das ist die technische Obergrenze, keine wirtschaftliche Empfehlung.`));
  }

  // ── 5 · Maximaler PV-Ausbau: Flächenpotenzial als Grenze ──────────────────
  const vMax = vOf('max-pv');
  if (vMax && H.maxPv) {
    const d = H.maxPv;
    const q = d.quellen.filter(x => x.kwp > 0);
    const gesamt = q.reduce((s, x) => s + x.kwp, 0) || 1;
    const bal = d.bilanz, balSum = bal.eigen + bal.einsp + bal.abr || 1;
    const BW = W - PL - PR, BH = 26;
    const farben = ['#fdd835', '#ffb74d', '#ff8a65', '#ef9a9a'];

    let s1 = '', xx = PL;
    q.forEach((x, i) => {
      const w = x.kwp / gesamt * BW;
      s1 += `<rect x="${xx.toFixed(1)}" y="${PT + 14}" width="${Math.max(1, w - 1).toFixed(1)}" height="${BH}" fill="${farben[i % farben.length]}" opacity=".85"/>`;
      if (w > 46) s1 += `<text x="${(xx + w / 2).toFixed(1)}" y="${PT + 14 + BH / 2 + 3.5}" text-anchor="middle" fill="#12110e" font-size="9">${num(x.kwp)}</text>`;
      xx += w;
    });

    let s2 = '', xy = PL;
    const teile = [
      { l: 'Eigenverbrauch', v: bal.eigen, c: '#a5d6a7' },
      { l: 'Einspeisung',    v: bal.einsp, c: '#42a5f5' },
      { l: 'Abregelung',     v: bal.abr,   c: '#ef5350' },
    ];
    teile.forEach(t => {
      const w = t.v / balSum * BW;
      if (w <= 0) return;
      s2 += `<rect x="${xy.toFixed(1)}" y="${PT + 74}" width="${Math.max(1, w - 1).toFixed(1)}" height="${BH}" fill="${t.c}" opacity=".85"/>`;
      if (w > 60) s2 += `<text x="${(xy + w / 2).toFixed(1)}" y="${PT + 74 + BH / 2 + 3.5}" text-anchor="middle" fill="#12110e" font-size="9">${num(t.v)} MWh</text>`;
      xy += w;
    });

    const svg = `<svg width="100%" viewBox="0 0 ${W} ${HH}" style="display:block;">
      <text x="${PL}" y="${PT + 8}" fill="#78909c" font-size="9">Flächenpotenzial — ${num(gesamt)} kWp gesamt</text>
      ${s1}
      <text x="${PL}" y="${PT + 68}" fill="#78909c" font-size="9">Verbleib der Erzeugung</text>
      ${s2}
      ${q.map((x, i) => `<g><rect x="${(PL + i * Math.min(150, BW / q.length)).toFixed(1)}" y="${HH - 30}" width="8" height="8" fill="${farben[i % farben.length]}"/>
        <text x="${(PL + i * Math.min(150, BW / q.length) + 12).toFixed(1)}" y="${HH - 23}" fill="#78909c" font-size="9">${escHtml(x.label)}</text></g>`).join('')}
    </svg>`;

    panels.push(_hlPanel(vMax, 'gesamtes verfügbares Flächenpotenzial, bewusst ohne Speicher', svg,
      `Hier begrenzt keine Optimierung, sondern die Fläche: <b style="color:var(--text)">${num(gesamt)} kWp</b> aus ` +
      `${q.map(x => escHtml(x.label) + ' ' + num(x.kwp)).join(' · ')} kWp. ` +
      `Vom Ertrag bleiben ${num(bal.eigen)} MWh vor Ort, ${num(bal.einsp)} MWh gehen ins Netz` +
      (bal.abr > 0.05 ? `, ${num(bal.abr, 1)} MWh gehen an der Einspeisegrenze verloren.` : '.') +
      (d.hinweis ? ` <span style="color:#ffb74d;">${escHtml(d.hinweis)}</span>` : '')));
  }

  el.innerHTML = `
  <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
    <div style="font-size:12px;font-weight:600;color:var(--text);">Herleitung der Varianten</div>
    <div style="font-size:10.5px;color:#78909c;">Je Variante das Kriterium, aus dem sie entsteht — gezeichnet aus der tatsächlichen Suchspur</div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(${zweiSpaltig ? 2 : 1},minmax(0,1fr));gap:12px;">
    ${panels.join('')}
  </div>
  <div style="margin-top:10px;font-size:10px;color:#78909c;line-height:1.55;">
    Die Punkte sind die tatsächlich ausgewerteten Stützstellen der jeweiligen Suche, nicht eine nachträglich geglättete Kurve.
    Wo eine Suche abgebrochen hat, ist der auslösende Punkt rot markiert.
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

  const windAktiv = (s.windEigenMwh || 0) + (s.windEinspMwh || 0) > 0.01;
  const blkEnergie = block('Energie & Kennzahlen (aus Simulation)',
    row('PV-Ertrag',      `${Math.round(v.pvKwp)} kWp · ${pvGetSpez()} kWh/kWp`, mwh(v.ertragMwh)) +
    (windAktiv ? row('davon Wind', `${mwh((s.windEigenMwh||0)+(s.windEinspMwh||0))} zusätzlich`, '↳ fester Sockel') : '') +
    row('Eigenverbrauch', '→ deckt Bedarf' + (windAktiv ? ' (PV + Wind)' : ''), mwh(s.eigenMwh)) +
    row('Einspeisung',    '→ ins Netz' + (windAktiv ? ' (PV + Wind)' : ''), mwh(s.einspeiseMwh)) +
    row('Abregelung',     '→ verworfen', mwh(s.curtailMwh)) +
    row('Netzbezug',      'Bedarf − Eigenverbrauch', mwh(s.netzbezugMwh)) +
    row('Eigenverbrauchsquote', windAktiv ? '(E_eigen − E_eigen,Wind) / E_pv' : 'E_eigen / E_pv', num(w.pvEigenQuote, 0) + ' %', true) +
    row('Autarkiegrad',   'E_eigen / E_bedarf', num(w.autarkie, 0) + ' %', true));

  const blkInvest = block('Investition',
    row('PV',    `${Math.round(v.pvKwp)} kWp · ${p.pvInvestPerKwp} €/kWp`, e(w.pvInvest)) +
    (v.batKwh > 0 ? row('Batterie', `${Math.round(v.batKwh)} kWh · ${p.batInvestPerKwh} €/kWh`, e(w.batInvest)) : '') +
    ((w.windKw || 0) > 0 ? row('Wind', `${Math.round(w.windKw)} kW · ${p.windInvestPerKw} €/kW`, e(w.windInvest)) : '') +
    row('Infrastruktur', w.infraLabel, e(w.infraInvest)) +
    row('Summe', 'I_gesamt', e(w.investGes), true));

  const blkJk = block('Jahreskosten (Annuität + Instandhaltung)',
    row('Annuitätenfaktoren', `a(${num(p.zins*100,1)} %, ${p.pvLife}a)=${num(aPv,4)} · a(…,${p.batLife}a)=${num(aBat,4)}`, '') +
    row('PV',    `${e(w.pvInvest)} · (${num(aPv,4)}+${num(ihPv,2)})`, ea(w.pvJk)) +
    (v.batKwh > 0 ? row('Batterie', `${e(w.batInvest)} · (${num(aBat,4)}+${num(ihBat,2)})`, ea(w.batJk)) : '') +
    ((w.windKw || 0) > 0 ? row('Wind', `${e(w.windInvest)} · (${num(aInf,4)}+0,03)`, ea(w.windJk)) : '') +
    row('Infrastruktur', `${e(w.infraInvest)} · ${num(aInf,4)}`, ea(w.infJk)) +
    row('Summe', 'JK_gesamt', ea(w.gesamtJk), true));

  const blkErloes = block('Erlöse & Ersparnisse',
    row('Eigenverbrauchs-Ersparnis', `${mwh(s.eigenMwh)} · ${p.pStrom} ct`, ea(w.eigenErsparnis)) +
    (useSpot
      ? row('Einspeiseerlös', `Σ E_einsp(t) · Spotpreis(t)`, ea(w.einspeisErloes))
      : w.windGetrennt
        ? row('Einspeiseerlös PV',   `${mwh(w.pvEinspMwh)} · ${p.pEinsp} ct`,     ea(w.pvEinspeisErloes)) +
          row('Einspeiseerlös Wind', `${mwh(w.windEinspMwh)} · ${p.pWindEinsp} ct`, ea(w.windEinspeisErloes))
        : row('Einspeiseerlös', `${mwh(s.einspeiseMwh)} · ${p.pEinsp} ct`, ea(w.einspeisErloes))
    ) +
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

  // Optimum = Maximum der Netto-Kurve (Fallback auf ersten Punkt, falls die Simulation
  // z.B. durch fehlerhafte Eingaben NaN liefert — Chart soll nie hart abstürzen)
  const optIdxRaw = nettoVals.indexOf(Math.max(...nettoVals));
  const optIdx = optIdxRaw >= 0 ? optIdxRaw : 0;
  const optKwp = data[optIdx]?.kwp ?? 0;

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

// ── Abb. 2b — Wind-Ausbau-Grenznutzen: wie viel Windleistung lohnt sich? ───────
// Spiegelbild von Abb. 2: PV & Batterie werden auf der wirtschaftlich optimierten
// Variante festgehalten, die Windleistung wird von 0 bis 2× der installierten
// Leistung skaliert (linear zulässig — alle Anlagen teilen denselben Standortwind).
// Netto-Überschuss enthält Wind-Investkosten (params.windInvestPerKw, IH 3 %/a).
function renderWindGrenznutzenChart(demandH, pvProfile, napParams, params, varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-wind-grenz');
  if (!el) return;

  const windKwInst = params.windKwInstalled || 0;
  if (!window._windElHourly || windKwInst <= 0) { el.innerHTML = ''; return; }

  const spez  = pvGetSpez();
  const spotH = window.elSpotPreiseH || window._pvAnalyse.spotPreise || null;
  const kanon = (varianten || []).filter(v => v.info && v.info.frage);
  const ref   = kanon.find(v => v.id === 'wirt-opt') || kanon[0] || { pvKwp: 0, batKwh: 0, strategie: 'none' };
  const strat = ref.batKwh > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';

  const maxKw = windKwInst * 2;
  const steps = [];
  const nStep = 24;
  for (let i = 0; i <= nStep; i++) steps.push((maxKw * i) / nStep);

  const data = steps.map(kw => {
    const scale = kw / windKwInst;
    const sim   = pvNapSim(ref.pvKwp, ref.batKwh, demandH, pvProfile, napParams, strat, spotH, scale);
    const wirt  = pvWirtschaft(ref.pvKwp, ref.batKwh, sim, ref.pvKwp * spez / 1000, params, strat, kw);
    return { kw, netto: -wirt.nettoJk };
  });

  const nettoVals = data.map(d => d.netto);
  const yMax = Math.max(1000, ...nettoVals);
  const yMin = Math.min(0, ...nettoVals);
  const optIdxRaw = nettoVals.indexOf(Math.max(...nettoVals));
  const optIdx = optIdxRaw >= 0 ? optIdxRaw : 0;
  const optKw  = data[optIdx]?.kw ?? 0;

  const elW = el.getBoundingClientRect().width || 700;
  const W = Math.max(400, elW - 4);
  const H = overrideEl ? 440 : 300;
  const PL = 58, PT = 16, PR = 20, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;
  const xS = v => PL + (v / maxKw) * cW;
  const yS = v => PT + cH - ((v - yMin) / (yMax - yMin)) * cH;
  const yZero = yS(0).toFixed(1);
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xS(d.kw).toFixed(1)},${yS(d.netto).toFixed(1)}`).join(' ');

  const instNetto = data.reduce((b, c) => Math.abs(c.kw - windKwInst) < Math.abs(b.kw - windKwInst) ? c : b).netto;
  const fmtKw = v => v >= 1000 ? (v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MW' : Math.round(v) + ' kW';

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 2b — Wind-Ausbau-Grenznutzen: Jahresüberschuss je Windleistung <span style="color:var(--muted);font-weight:400;">(PV/Batterie fix: ${ref.icon || ''} ${Math.round(ref.pvKwp)} kWp / ${(ref.batKwh / 1000).toFixed(1)} MWh)</span>
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Profilform bleibt gleich (gleicher Standortwind) · Kosten: ${params.windInvestPerKw} €/kW + 3 %/a IH · Wake-Verluste nicht berücksichtigt</span>
    </span>
    ${overrideEl ? '' : '<button data-pva-fs="wind-grenz" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;">⤢</button>'}
  </div>
  <svg width="${W}" height="${H}" style="display:block;overflow:hidden;cursor:crosshair;">
    ${[0, 0.25, 0.5, 0.75, 1].map(f => {
      const val = yMin + f * (yMax - yMin);
      const y = yS(val).toFixed(1);
      return `<line x1="${PL}" y1="${y}" x2="${PL + cW}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PL - 5}" y="${(parseFloat(y) + 3).toFixed(1)}" text-anchor="end" fill="#607d8b" font-size="8">${(val / 1000).toFixed(0)}k</text>`;
    }).join('')}
    <line x1="${PL}" y1="${yZero}" x2="${PL + cW}" y2="${yZero}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    ${[0, 0.25, 0.5, 0.75, 1].map(f => `
      <text x="${xS(f * maxKw).toFixed(1)}" y="${PT + cH + 14}" text-anchor="middle" fill="#607d8b" font-size="8">${fmtKw(f * maxKw)}</text>
    `).join('')}
    <text x="${PL + cW / 2}" y="${H - 3}" text-anchor="middle" fill="#607d8b" font-size="9">Windleistung (installiert: ${fmtKw(windKwInst)})</text>
    <text x="11" y="${PT + cH / 2}" text-anchor="middle" fill="#607d8b" font-size="9" transform="rotate(-90,11,${PT + cH / 2})">Netto-Überschuss (€/a)</text>
    <path d="${path}" fill="none" stroke="#4dd0e1" stroke-width="2.5"/>
    <line x1="${xS(windKwInst).toFixed(1)}" y1="${PT}" x2="${xS(windKwInst).toFixed(1)}" y2="${PT + cH}" stroke="#90a4ae" stroke-width="1" stroke-dasharray="2,3" opacity="0.7"/>
    <text x="${xS(windKwInst).toFixed(1)}" y="${PT + cH - 4}" text-anchor="middle" fill="#90a4ae" font-size="8">installiert</text>
    <line x1="${xS(optKw).toFixed(1)}" y1="${PT}" x2="${xS(optKw).toFixed(1)}" y2="${PT + cH}" stroke="#4dd0e1" stroke-width="1" stroke-dasharray="3,2" opacity="0.8"/>
    <text x="${Math.min(xS(optKw) + 4, W - 110)}" y="${PT + 20}" fill="#4dd0e1" font-size="9" font-weight="600">Optimum ≈ ${fmtKw(optKw)}</text>
    <line id="pva-windgrenz-xhair" x1="-2" y1="${PT}" x2="-2" y2="${PT + cH}" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="3,2"/>
  </svg>
  <div style="font-size:8px;color:#607d8b;margin-top:2px;">
    ${optKw > windKwInst * 1.05
      ? `Mehr Wind lohnt sich: Optimum bei ${fmtKw(optKw)} (+${(data[optIdx].netto - instNetto) >= 1000 ? ((data[optIdx].netto - instNetto) / 1000).toFixed(1) + ' k€/a' : Math.round(data[optIdx].netto - instNetto) + ' €/a'} gegenüber Bestand). Ob die Fläche das hergibt → Windanalyse-Platzierungsvorschläge.`
      : optKw < windKwInst * 0.95
        ? `Der aktuelle Windausbau (${fmtKw(windKwInst)}) liegt über dem wirtschaftlichen Optimum von ${fmtKw(optKw)} — mit diesen Kosten-/Tarif-Annahmen wäre weniger Wind rentabler.`
        : `Der aktuelle Windausbau (${fmtKw(windKwInst)}) liegt nahe am wirtschaftlichen Optimum.`}
  </div>`;

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const lx = ev.clientX - r.left;
    if (lx < PL || lx > PL + cW) { _pvHideTT(); return; }
    const kwHit = (lx - PL) / cW * maxKw;
    const d = data.reduce((b, c) => Math.abs(c.kw - kwHit) < Math.abs(b.kw - kwHit) ? c : b);
    const xhair = el.querySelector('#pva-windgrenz-xhair');
    if (xhair) { xhair.setAttribute('x1', xS(d.kw).toFixed(1)); xhair.setAttribute('x2', xS(d.kw).toFixed(1)); }
    _pvShowTT(ev,
      `<strong style="color:#4dd0e1">${fmtKw(d.kw)}</strong> Windleistung` +
      `<br><span style="color:#66bb6a">●</span> Netto-Überschuss: <strong>${(d.netto / 1000).toFixed(1)} k€/a</strong>` +
      `<br><span style="color:#90a4ae">●</span> ggü. Bestand: <strong>${((d.netto - instNetto) / 1000).toFixed(1)} k€/a</strong>`
    );
  });
  svg.addEventListener('mouseleave', _pvHideTT);

  const fsBtn = el.querySelector('[data-pva-fs="wind-grenz"]');
  if (fsBtn) fsBtn.addEventListener('click', () =>
    _pvOpenFs('Wind-Ausbau-Grenznutzen — Jahresüberschuss je Windleistung', cnt =>
      renderWindGrenznutzenChart(_pvFsArgs.demandH, _pvFsArgs.pvProfile, _pvFsArgs.napParams, _pvFsArgs.params, window._pvAnalyse.ergebnisse, cnt)
    )
  );
}

// ── Erzeugungsprofil: Herkunft und Plausibilitaet ─────────────────────────
// Der zeitliche Verlauf entscheidet ueber Rueckspeisespitze, Abregelung und
// Eigenverbrauchsquote. Deshalb wird hier offengelegt, WELCHES Profil rechnet
// und welche Spitzenleistung daraus folgt — die Zahl, die in Abb. 6 die
// Netzbeurteilung traegt.
function _pvProfilInfoHtml() {
  const q    = pvGetProfilQuelle();
  const spez = pvGetSpez();
  const k    = pvProfilKennwerte(_pvBasisProfil8760(), spez);
  const maxKwp = pvGetMaxKwpFromAssets();
  const farbe  = q.id === 'pvgis' ? '#66bb6a' : q.id === 'upload' ? '#4fc3f7' : '#90a4ae';
  const icon   = q.id === 'synthetisch' ? '〜' : '📈';

  const spitzeGes = maxKwp > 0
    ? `<div style="font-size:8px;color:var(--muted);margin-top:3px;">
         Bei ${maxKwp.toFixed(0)} kWp entspricht das einer Erzeugungsspitze von
         <b style="color:#fdd835;">${Math.round(k.peakKwPerKwp * maxKwp).toLocaleString('de-DE')} kW</b>
         — Bezugsgröße für Rückspeisung und Netzbeurteilung.</div>`
    : '';

  const upload = q.id === 'synthetisch'
    ? `<div id="pva-profil-upload" data-click="document.getElementById('pv-file-input').click()"
         style="border:1px dashed var(--border);border-radius:6px;padding:5px 8px;cursor:pointer;margin-top:6px;font-size:8px;color:var(--muted);"
         onmouseenter="this.style.borderColor='#66bb6a'" onmouseleave="this.style.borderColor='var(--border)'">
         📂 PVGIS-Stundenprofil hochladen — ersetzt das synthetische Profil für alle Varianten
       </div>`
    : `<div style="margin-top:6px;">
         <button data-click="pvClear()" style="background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:10px;padding:1px 8px;font-size:8px;cursor:pointer;">
           ✕ Profil entfernen (zurück zum synthetischen)</button>
       </div>`;

  return `
    <div style="font-size:9px;color:var(--text);display:flex;align-items:baseline;gap:5px;">
      <span style="color:${farbe};">${icon}</span>
      <b style="color:${farbe};">${escHtml(q.label)}</b>
      ${q.detail ? `<span style="color:var(--muted);font-size:8px;">${escHtml(q.detail)}</span>` : ''}
    </div>
    <div style="font-size:8px;color:var(--muted);margin-top:3px;line-height:1.5;">
      Quelle: ${escHtml(q.quelle)} · Spitze
      <b style="color:var(--text);">${k.peakKwPerKwp.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})} kW/kWp</b> ·
      ${Math.round(k.stundenMitErtrag).toLocaleString('de-DE')} Ertragsstunden/a
    </div>
    ${spitzeGes}
    ${upload}`;
}

/** Profil-Info neu zeichnen — wird nach Upload/Löschen aus 09a aufgerufen. */
window._pvaRefreshProfilInfo = function _pvaRefreshProfilInfo() {
  _pvUploadNormCache = null; _pvUploadNormSig = null;
  const el = document.getElementById('pva-profil-info');
  if (el) el.innerHTML = _pvProfilInfoHtml();
  _pvaRefreshDatenbasis();
  pvMarkStale();
};

// ── Ergebnisse als veraltet markieren ─────────────────────────────────────
// Die Ergebnistabelle, die Lesehilfe und der Rechenweg stammen aus einem
// Berechnungslauf mit festen Parametern (state.lastParams). Aendert der Nutzer
// danach eine Eingabe, wuerden Tabelle und Diagramme unterschiedliche Annahmen
// zeigen — im Gutachten der teuerste Fehlerpfad. Deshalb wird der Ergebnis-
// bereich abgeblendet und gesperrt, bis neu gerechnet wurde.
/**
 * Eingabewert merken. Das Panel wird bei jedem Tab-Wechsel komplett neu aus
 * _pvBuildPanelHtml aufgebaut; die Wirtschaftsparameter standen dort fest im
 * Markup und fielen dadurch auf ihre Defaults zurueck — waehrend gerechnet
 * weiter mit dem eingegebenen Wert wurde. Genau die Sorte stiller Abweichung,
 * die B1 verhindern soll.
 */
function _pvMerkeFeld(f) {
  if (!f || !f.id) return;                      // Infra-Stufen o. ae. haben keine id
  const s = window._pvAnalyse;
  if (!s.feldWerte) s.feldWerte = {};
  s.feldWerte[f.id] = f.type === 'checkbox' ? f.checked : f.value;
}

/** Gemerkte Eingabewerte nach einem Panel-Neuaufbau zurueckschreiben. */
function _pvFelderWiederherstellen() {
  const w = window._pvAnalyse.feldWerte;
  if (!w) return;
  for (const [id, val] of Object.entries(w)) {
    const f = document.getElementById(id);
    if (!f) continue;
    if (f.type === 'checkbox') f.checked = !!val; else f.value = val;
  }
}

function pvMarkStale() {
  const s = window._pvAnalyse;
  if (!s || !s.berechnet) return;          // noch nie gerechnet → nichts zu entwerten
  s.berechnet = false;
  s.stale = true;
  _pvApplyStaleUi();
}

/** Die Datenbasis-Leiste spiegelt Lastgang, Profil, Spot und Preis — nach jeder
 *  Eingabe neu zeichnen, damit sie nie eine überholte Lage zeigt. */
function _pvaRefreshDatenbasis() {
  const el = document.getElementById('pva-datenbasis');
  if (el) el.innerHTML = _pvaDatenbasisHtml();
}

function _pvApplyStaleUi() {
  const s = window._pvAnalyse;
  const stale = !!(s && s.stale && s.ergebnisse?.length);
  const hint = document.getElementById('pva-stale-hinweis');
  if (hint) hint.style.display = stale ? 'flex' : 'none';
  const res = document.getElementById('pva-ergebnisse');
  if (res) {
    res.style.opacity       = stale ? '0.45' : '1';
    res.style.pointerEvents = stale ? 'none' : '';
  }
  _pvUpdateBerechnenBtn(false);
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
  // Asset-kWp anzeigen (nur die Zahl — die Einheit steht daneben im Markup)
  const el = document.getElementById('pva-asset-kwp');
  if (el) el.textContent = pvGetMaxKwpFromAssets().toFixed(0);
  // Spot-Status-Zeile fuellen (wird sonst nur nach einem Upload aktualisiert)
  window._pvUpdateSpotStatus?.();

  // Profil-Herkunft anzeigen
  const pinfo = document.getElementById('pva-profil-info');
  if (pinfo) pinfo.innerHTML = _pvProfilInfoHtml();

  // Jede Eingabe im Steuer-Deck entwertet vorhandene Ergebnisse. Bewusst
  // delegiert statt an jedem Feld einzeln: so ist auch jedes spaeter
  // hinzugefuegte Feld automatisch erfasst (die Wirtschaftsparameter waren
  // genau deshalb nie angebunden).
  const deck = document.querySelector('.pva-controls');
  if (deck && !deck.dataset.staleBound) {
    deck.dataset.staleBound = '1';
    const onEdit = (ev) => {
      const f = ev.target.closest('input, select, textarea');
      if (!f) return;
      _pvMerkeFeld(f);
      _pvaRefreshDatenbasis();
      pvMarkStale();
    };
    deck.addEventListener('input',  onEdit);
    deck.addEventListener('change', onEdit);
  }
  _pvApplyStaleUi();

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
    b.style.background  = active ? 'var(--accent)' : 'var(--surface)';
    b.style.color       = active ? '#000'          : 'var(--text)';
    b.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
  });
  // Eingaben des Nutzers zurueckschreiben (das Panel-Markup traegt nur Defaults)
  _pvFelderWiederherstellen();
  _pvApplyStaleUi();

  // Ergebnisse wieder anzeigen wenn bereits berechnet
  if (s.berechnet && s.ergebnisse?.length) {
    const leerHinweis = document.getElementById('pva-leer-hinweis');
    if (leerHinweis) leerHinweis.style.display = 'none';
    const d = pvGetDemandH();
    // WICHTIG: mit den Parametern des letzten Berechnungslaufs rendern, nicht mit
    // den aktuellen DOM-Werten. Sonst zeigten Tabelle und Rechenweg (aus
    // s.ergebnisse) andere Annahmen als die frisch gezeichneten Diagramme.
    if (d && s.lastParams) {
      _pvFsArgs = {
        demandH: d,
        pvProfile: pvGetPvProfile(),
        napParams: { maxEinspeisKw: s.napMaxEinspKw, maxBezugKw: s.napMaxBezugKw },
        params: s.lastParams,
      };
    }
    _pvaAlleDirty();
  }
  _pvaRenderView();
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
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:20px;text-align:center;">Keine Ergebnisse.</div>';
    return;
  }

  const napAktiv = window.elNapMaxEinspKw != null || window._pvAnalyse.napMaxEinspKw > 0;
  const fmt  = (v, dez = 0) => typeof v === 'number' && isFinite(v)
    ? v.toLocaleString('de-DE', { minimumFractionDigits: dez, maximumFractionDigits: dez }) : '—';
  const fmtK = v => Math.abs(v) >= 1000
    ? (v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' k€'
    : Math.round(v).toLocaleString('de-DE') + ' €';
  const sgn  = v => (v >= 0 ? '+' : '−') + fmtK(Math.abs(v));

  const hasWirtOpt = varianten.some(v => v.id === 'wirt-opt');
  const bestAmort  = Math.min(...varianten.map(v => v.wirt.amort).filter(a => isFinite(a)));
  const windAktiv  = varianten.some(v => (v.wirt.windKw || 0) > 0);
  const p          = window._pvAnalyse.lastParams;

  const th = (label, tip, farbe) =>
    `<th style="padding:4px 6px;text-align:right;white-space:nowrap;${farbe ? 'color:' + farbe + ';' : ''}"${tip ? ` title="${tip}"` : ''}>${label}</th>`;

  let html = `
  <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:9px;">
    <div style="font-size:12px;font-weight:600;color:var(--text);">Varianten-Vergleich</div>
    <div style="font-size:10.5px;color:#78909c;">Auswahl über den höchsten Jahresüberschuss · fünf kanonische Varianten</div>
  </div>
  <div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--muted);text-align:right;border-bottom:1px solid var(--border);font-size:10px;">
        <th style="text-align:left;padding:4px 6px;white-space:nowrap;">Variante</th>
        ${th('kWp')}
        ${th('Bat&nbsp;kWh')}
        ${windAktiv ? th('Wind&nbsp;kW', 'Installierte Windkraftleistung — fester Sockel, in allen Varianten gleich') : ''}
        ${th('EV&nbsp;%', 'Eigenverbrauchsquote der PV-Erzeugung')}
        ${th('Aut&nbsp;%', 'Autarkiegrad: Anteil des Bedarfs aus eigener Erzeugung')}
        ${th('Abr&nbsp;MWh', 'Abgeregelte Energie — nur bei aktiver NAP-Einspeisebegrenzung', napAktiv ? '#ef9a9a' : '#546e7a')}
        ${th('Investition')}
        ${th('Überschuss/a', 'Erlöse minus alle Jahreskosten inkl. Kapitaldienst, Betrieb und Infrastruktur')}
        ${th('Amort.', 'Statisch: Investition ÷ jährlicher Rückfluss (Erlöse − laufende Betriebskosten)')}
        ${th('Kapitalwert', 'Barwert des Jahresüberschusses über die PV-Nutzungsdauer — die von § 7 BHO erwartete Kenngröße')}
        ${th('LCOE', 'Stromgestehungskosten: Jahreskosten ÷ genutzter Energie (nach Abregelung)')}
        ${th('CO₂&nbsp;t/a', 'Vermiedene Emissionen bei dem eingestellten Verdrängungsfaktor')}
        ${th('Netz', 'Rückspeise-Ampel: schärferes Kriterium aus Spannungsband und Anschlusskapazität')}
      </tr>
    </thead>
    <tbody>`;

  for (const v of varianten) {
    const w = v.wirt;
    const isKomp = hasWirtOpt ? v.id === 'wirt-opt' : (w.amort === bestAmort);
    const rowBg  = isKomp ? 'rgba(102,187,106,0.07)' : 'transparent';
    const abrCol = v.sim.curtailMwh > 0 && w.curtailQuote > 5 ? '#ef9a9a'
                 : v.sim.curtailMwh > 0 ? '#ffd54f' : 'var(--muted)';
    const ampel  = v.rueck?.ampel;
    const ampelFarbe = ampel === 'rot' ? '#ef5350' : ampel === 'gelb' ? '#ffa726'
                     : ampel === 'gruen' ? '#66bb6a' : '#546e7a';
    const ampelTip = v.rueck
      ? `Rückspeisespitze ${fmt(v.rueck.maxKw)} kW` +
        (v.rueck.deltaU != null ? ` · Δu ${fmt(v.rueck.deltaU, 2)} %` : '') +
        (v.rueck.text ? ` · ${v.rueck.text}` : '')
      : 'S_k″ oder Anschlussgrenze eingeben';
    const td = (inhalt, farbe, extra) =>
      `<td style="text-align:right;padding:6px;white-space:nowrap;font-family:'DM Mono',monospace;${farbe ? 'color:' + farbe + ';' : ''}${extra || ''}">${inhalt}</td>`;

    html += `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);background:${rowBg};">
        <td style="padding:6px;white-space:nowrap;">
          <span style="color:${v.farbe};font-size:12px;">${v.icon}</span>
          <span style="margin-left:5px;color:var(--text);${isKomp ? 'font-weight:600;' : ''}">${escHtml(v.label)}</span>
          ${isKomp ? ' <span style="background:#66bb6a;color:#000;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700;">BEST</span>' : ''}
        </td>
        ${td(fmt(v.pvKwp), '#fdd835')}
        ${td(v.batKwh > 0 ? fmt(v.batKwh) : '—', v.batKwh > 0 ? '#80deea' : '#546e7a')}
        ${windAktiv ? td((w.windKw || 0) > 0 ? fmt(w.windKw) : '—', '#4dd0e1') : ''}
        ${td(fmt(w.pvEigenQuote, 1), '#a5d6a7')}
        ${td(fmt(w.autarkie, 1), '#4fc3f7')}
        ${td(napAktiv ? fmt(v.sim.curtailMwh, 1) : '—', abrCol)}
        ${td(fmtK(w.investGes), '#ce93d8')}
        ${td(sgn(-w.nettoJk), (-w.nettoJk) >= 0 ? '#66bb6a' : '#ef5350', isKomp ? 'font-weight:600;' : '')}
        ${td(isFinite(w.amort) ? fmt(w.amort, 1) + ' a' : '> ' + fmt(p?.pvLife || 20) + ' a',
             isFinite(w.amort) && w.amort <= (p?.pvLife || 20) ? 'var(--text)' : '#ef5350')}
        ${td(sgn(w.kapitalwert), w.kapitalwert >= 0 ? '#66bb6a' : '#ef5350')}
        ${td(fmt(w.lcoeCt, 1) + ' ct', 'var(--text)')}
        ${td(fmt(w.co2T), '#a5d6a7')}
        <td style="text-align:center;padding:6px;" title="${ampelTip}">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${ampelFarbe};"></span>
        </td>
      </tr>`;
  }

  html += `</tbody></table></div>`;

  // Legende + Definitionen — im Gutachten muss jede Kennzahl definiert sein.
  html += `
  <div style="margin-top:9px;display:flex;flex-wrap:wrap;gap:14px;font-size:10.5px;color:#78909c;">
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#66bb6a;margin-right:5px;"></span>Rückspeisung netzverträglich</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffa726;margin-right:5px;"></span>Prüfung durch den VNB nötig</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef5350;margin-right:5px;"></span>Erzeugungsnetz / MS-Anschluss erforderlich</span>
    ${!napAktiv ? '<span style="color:#546e7a;">Abregelung: keine Einspeisegrenze gesetzt</span>' : ''}
    ${windAktiv ? '<span style="color:#4dd0e1;">Wind ist ein fester Sockel — in EV/Aut, Erlösen und Überschuss enthalten</span>' : ''}
  </div>
  <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:4px 20px;font-size:10px;color:#78909c;line-height:1.55;">
    <div><b style="color:var(--muted);">Überschuss/a</b> = Erlöse − alle Jahreskosten (Kapitaldienst, Betrieb, Infrastruktur).</div>
    <div><b style="color:var(--muted);">Amortisation</b> = Investition ÷ jährlicher Rückfluss (Erlöse − laufende Betriebskosten), statisch.</div>
    <div><b style="color:var(--muted);">Kapitalwert</b> = Barwert des Überschusses über ${fmt(p?.pvLife || 20)} a bei ${fmt((p?.zins || 0.035) * 100, 1)} % Zins.</div>
    <div><b style="color:var(--muted);">LCOE</b> = Jahreskosten ÷ genutzter Energie (Eigenverbrauch + Einspeisung).</div>
    <div><b style="color:var(--muted);">CO₂</b> = vermiedene Emissionen bei ${fmt(p?.co2Faktor || 380)} g/kWh Verdrängungsfaktor.</div>
    <div><b style="color:var(--muted);">Netz</b> = schärferes Kriterium aus Spannungsband Δu und Anschlusskapazität am NAP.</div>
  </div>`;

  // Infra-Detail je Variante
  const detail = varianten.filter(v => v.wirt.infDetail?.length);
  if (detail.length) {
    html += '<div style="margin-top:10px;font-size:10px;color:#78909c;">' + detail.map(v =>
      `<div style="margin-bottom:2px;"><span style="color:${v.farbe};">${v.icon} ${escHtml(v.label)}:</span> ` +
      `${escHtml(v.wirt.infDetail.join(', '))} · ${Math.round(v.wirt.infraInvest).toLocaleString('de-DE')} € Invest</div>`).join('') + '</div>';
  }

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

  const COL = { ev:'#66bb6a', nb:'#ef5350', es:'#42a5f5', ct:'#ff9800', bedarf:'#78909c', wd:'#4dd0e1' };

  // Wind-Anteile (pvNapSim: windEigenMwh/windEinspMwh) als eigene Segmente ausweisen,
  // damit PV- und Windbeitrag in Deckung und Überschuss unterscheidbar bleiben.
  const rows = varianten.map(v => {
    const ev = v.sim.eigenMwh, nb = v.sim.netzbezugMwh;
    const es = v.sim.einspeiseMwh, ct = v.sim.curtailMwh || 0;
    const wEv = Math.min(ev, v.sim.windEigenMwh || 0);
    const wEs = Math.min(es, v.sim.windEinspMwh || 0);
    return { v, ev, nb, es, ct, wEv, wEs, bedarf: ev + nb, pv: es + ct };
  });
  const windAktiv = rows.some(r => r.wEv + r.wEs > 0.01);
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
    // Deckung: PV-Eigenverbrauch · Wind-Eigenverbrauch · Netzbezug
    bars += seg(x2, r.ev - r.wEv, 0, COL.ev) + seg(x2, r.ev, r.ev - r.wEv, COL.wd)
          + seg(x2, r.ev + r.nb, r.ev, COL.nb);
    // Überschuss: PV-Einspeisung · Wind-Einspeisung · Abregelung
    bars += seg(x3, r.es - r.wEs, 0, COL.es) + seg(x3, r.es, r.es - r.wEs, COL.wd)
          + seg(x3, r.es + r.ct, r.es, COL.ct);
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

  const legendItems = [['Eigenverbrauch', COL.ev], ['Netzbezug', COL.nb], ['Einspeisung', COL.es],
    ...(windAktiv ? [['davon Wind', COL.wd]] : []), ['Abregelung', COL.ct], ['Bedarf', COL.bedarf]];
  let lx = PL;
  const legendSvg = legendItems.map(([t, c]) => {
    const s = `<rect x="${lx.toFixed(1)}" y="2" width="8" height="8" fill="${c}" opacity="0.92"/><text x="${(lx + 11).toFixed(1)}" y="10" fill="#90a4ae" font-size="8">${t}</text>`;
    lx += 20 + t.length * 5.4; return s;
  }).join('');

  el.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Abb. 4 — Energiebilanz je Variante
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">B = Bedarf · D = Deckung (Eigenverbrauch + Netzbezug) · P = ${windAktiv ? 'PV+Wind' : 'PV'}-Überschuss (Einspeisung + Abregelung)</span>
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
    const { v, ev: evM, nb, es, ct, wEv, wEs, bedarf, pv } = rows[i];
    const fmt = x => x.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' MWh';
    const aut = bedarf > 0 ? (evM / bedarf * 100).toFixed(0) : '0';
    const pvGen = evM + es + ct;
    _pvShowTT(ev,
      `<span style="color:${v.farbe};font-weight:700">${v.icon} ${v.label}</span><br>` +
      `<u>Bedarf</u>: <strong>${fmt(bedarf)}</strong><br>` +
      `<span style="color:${COL.ev}">■</span> Eigenverbrauch: <strong>${fmt(evM)}</strong> · Aut. ${aut}&thinsp;%` +
      (wEv > 0.5 ? ` <span style="color:${COL.wd}">(davon Wind ${fmt(wEv)})</span>` : '') + `<br>` +
      `<span style="color:${COL.nb}">■</span> Netzbezug: <strong>${fmt(nb)}</strong><br>` +
      `<u>${wEv + wEs > 0.01 ? 'PV+Wind' : 'PV'}-Überschuss</u>: <strong>${fmt(pv)}</strong>${pvGen > 0 ? ` (von ${fmt(pvGen)} Ertrag)` : ''}<br>` +
      `<span style="color:${COL.es}">■</span> Einspeisung: <strong>${fmt(es)}</strong>` +
      (wEs > 0.5 ? ` <span style="color:${COL.wd}">(davon Wind ${fmt(wEs)})</span>` : '') + `<br>` +
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
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Rückspeisespitze am NAP (Batterie schert sie) gegen Spannungsband &amp; Anschlusskapazität${varianten.some(v => (v.wirt?.windKw || 0) > 0) ? ' · inkl. Windkraft-Sockel' : ''}</span>
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

  const COL = { ev:'#66bb6a', es:'#42a5f5', ct:'#ff9800', nb:'#ef5350', vl:'#78909c', pv:'#fdd835', wd:'#4dd0e1' };
  const pvStep  = 1;   // fein, damit Varianten-Sprungmarken exakt getroffen werden
  const batStep = 5;

  // Wind-Slider nur wenn Windkraft in der Analyse aktiviert ist (skaliert den Sockel linear)
  const windKwInst = (window._windElHourly && params.windKwInstalled > 0) ? params.windKwInstalled : 0;
  const windMax    = windKwInst > 0 ? Math.round(windKwInst * 2) : 0;

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
    ${windKwInst > 0 ? `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">Wind</span>
      <input id="pva-fluss-wind" type="range" min="0" max="${windMax}" step="10" value="${Math.round(windKwInst)}" style="flex:1;accent-color:${COL.wd};">
      <span id="pva-fluss-wind-val" style="font-size:9px;color:${COL.wd};font-family:'DM Mono',monospace;width:62px;text-align:right;">${Math.round(windKwInst)} kW</span>
    </div>` : ''}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${chips}</div>
  <div id="pva-fluss-kpi" style="font-size:9px;color:var(--muted);margin-bottom:6px;"></div>
  <div id="pva-fluss-svg" style="overflow:hidden;"></div>`;

  const svgWrap = el.querySelector('#pva-fluss-svg');
  const pvIn   = el.querySelector('#pva-fluss-pv');
  const batIn  = el.querySelector('#pva-fluss-bat');
  const windIn = el.querySelector('#pva-fluss-wind');

  function drawSankey(pv, bat, windKw) {
    // Gleiche Strategie wie die Varianten/Tabelle: spot-dyn (falls Spotpreise) lädt
    // jetzt ebenfalls für den Eigenverbrauch → größere Batterie senkt Einspeisung UND
    // Netzbezug, konsistent zur Tabelle.
    const strat = bat > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';
    const ertrag = pv * spez / 1000;
    const windScale = windKwInst > 0 ? (windKw / windKwInst) : 1;
    const sim  = pvNapSim(pv, bat, demandH, pvProfile, napParams, strat, spotH, windScale);
    const wirt = pvWirtschaft(pv, bat, sim, ertrag, params, strat, windKwInst > 0 ? windKw : null);
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
      ${lbl(xL-6, pvY, pvH, (windKwInst > 0 && windKw > 0) ? 'PV + Wind' : 'PV-Erzeugung', pvSum, COL.pv, 'end')}
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
    const windKw = windIn ? (parseFloat(windIn.value) || 0) : windKwInst;
    el.querySelector('#pva-fluss-pv-val').textContent = Math.round(pv) + ' kWp';
    el.querySelector('#pva-fluss-bat-val').textContent = (bat/1000).toFixed(2) + ' MWh';
    if (windIn) el.querySelector('#pva-fluss-wind-val').textContent = Math.round(windKw) + ' kW';
    drawSankey(pv, bat, windKw);
  }
  pvIn.addEventListener('input', sync);
  batIn.addEventListener('input', sync);
  if (windIn) windIn.addEventListener('input', sync);
  el.querySelectorAll('[data-fluss-var]').forEach(b => b.addEventListener('click', () => {
    const [p, q] = b.dataset.flussVar.split('|').map(parseFloat);
    pvIn.value = Math.round(p); batIn.value = Math.round(q);
    if (windIn) windIn.value = Math.round(windKwInst);  // Varianten rechnen mit Bestand
    sync();
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
let _pvahWindKw = null;

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
  const COL = { pv: '#fdd835', es: '#42a5f5', wd: '#4dd0e1' };

  // Wind-Slider nur wenn Windkraft in der Analyse aktiviert ist
  const windKwInst = (window._windElHourly && (_pvFsArgs?.params?.windKwInstalled || 0) > 0)
    ? _pvFsArgs.params.windKwInstalled : 0;
  const windMax = windKwInst > 0 ? Math.round(windKwInst * 2) : 0;

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
  if (_pvahWindKw == null || windKwInst <= 0) _pvahWindKw = windKwInst;

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
    ${windKwInst > 0 ? `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:9px;color:var(--muted);width:64px;">Wind</span>
      <input id="pva-pvah-wind" type="range" min="0" max="${windMax}" step="10" value="${Math.round(_pvahWindKw)}" style="flex:1;accent-color:${COL.wd};">
      <span id="pva-pvah-wind-val" style="font-size:9px;color:${COL.wd};font-family:'DM Mono',monospace;width:62px;text-align:right;">${Math.round(_pvahWindKw)} kW</span>
    </div>` : ''}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${tabs}</div>
  <div id="pva-pvah-svg"></div>`;

  const svgWrap = el.querySelector('#pva-pvah-svg');
  const pvIn   = el.querySelector('#pva-pvah-pv');
  const batIn  = el.querySelector('#pva-pvah-bat');
  const windIn = el.querySelector('#pva-pvah-wind');
  const subEl = el.querySelector('#pva-pvah-sub');

  function draw(pv, bat, windKw) {
    const strat = bat > 0 ? (spotH ? 'spot-dyn' : 'ev') : 'none';
    const windScale = windKwInst > 0 ? ((windKw ?? windKwInst) / windKwInst) : 1;
    const sim    = pvNapSim(pv, bat, demandH, pvProfile, napParams, strat, spotH, windScale);
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
    const windKw = windIn ? (parseFloat(windIn.value) || 0) : windKwInst;
    _pvahPvKwp = pv; _pvahBatKwh = bat; _pvahWindKw = windKw;
    el.querySelector('#pva-pvah-pv-val').textContent = Math.round(pv) + ' kWp';
    el.querySelector('#pva-pvah-bat-val').textContent = (bat/1000).toFixed(2) + ' MWh';
    if (windIn) el.querySelector('#pva-pvah-wind-val').textContent = Math.round(windKw) + ' kW';
    draw(pv, bat, windKw);
  }
  pvIn.addEventListener('input', sync);
  batIn.addEventListener('input', sync);
  if (windIn) windIn.addEventListener('input', sync);
  el.querySelectorAll('[data-pvah-var]').forEach(b => b.addEventListener('click', () => {
    const [p, q] = b.dataset.pvahVar.split('|').map(parseFloat);
    pvIn.value = Math.round(p); batIn.value = Math.round(q);
    if (windIn) windIn.value = Math.round(windKwInst);  // Varianten rechnen mit Bestand
    sync();
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

// Bauschwere-Klassen für die Auskühlzeit-Abschätzung (wirksame Wärmespeicherfähigkeit
// der Gebäudemasse je m² Nutzfläche) — Anhaltswerte nach DIN EN ISO 13786, grob
// klassifiziert. "mittel" als Default für Mischbestand ohne bekannte Bauweise.
const _PV_RES_BAUSCHWERE = {
  leicht: { label: 'Leicht (Holz-/Trockenbau)',   whM2K: 40  },
  mittel: { label: 'Mittel (Massivbau üblich)',   whM2K: 90  },
  schwer: { label: 'Schwer (Beton/Stein massiv)', whM2K: 150 },
};
// Nutzungstyp-Gruppen (s. 02b-gebaeude.js), deren Gebäude bei Wärmeausfall als
// besonders kritisch gelten (Pflege, Gesundheit, Betreuung) — für die Hervorhebung
// in der Gebäudeliste.
const _PV_RES_KRIT_GRUPPEN = new Set(['Unterkunft und Pflege', 'Gesundheit', 'Bildung und Betreuung']);

let _pvResVarId = null, _pvResPvKwp = null, _pvResBatKwh = null;
let _pvResDurH = null, _pvResFuel = null, _pvResLoadFrac = null;
// Betriebsweise (welche Erzeuger im Inselbetrieb verfügbar sind):
//  'gen'        — nur Notstrom (klassisch, batterieunabhängig auf Spitzenlast)
//  'bat-gen'    — Speicher + Notstrom (Batterie puffert, Aggregat trägt Grundlast)
//  'pv-bat-gen' — PV + Speicher + Notstrom (volles Hybridsystem)
//  'pv-bat'     — nur PV + Speicher, ohne Notstrom (reine EE-Insel)
let _pvResMode = null;
let _pvResUsable = null;    // nutzbare Batteriekapazität in % (Entladetiefe + Kälte-Derating)
let _pvResSelStart = null;  // per Heatmap-Klick gewählter Ausfall-Start (null = Worst-Case)

// Betrachtete Versorgung im Resilienz-Kapitel: 'strom' (Blackout, s.o.) oder
// 'waerme' (Totalausfall der Wärmezentrale, s.u.) — gemeinsamer Reiter, siehe Aufgabe.
let _pvResEnergy      = 'strom';
let _pvResBauschwere  = 'mittel'; // Bauschwere-Annahme für die Auskühlzeit-Abschätzung
let _pvResTcrit       = 15;       // kritische Innenraumtemperatur (°C)
let _pvResSelStartW   = null;     // per Heatmap-Klick gewählter Ausfall-Start (Wärme, unabhängig von Strom)

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
// Einheitlicher Dispatch (Peak- wie Puffer-Modus): der Generator trägt die
// Grundlast und lädt die Batterie opportunistisch nach (moduliert, max. genKw);
// die Batterie kappt nur die Spitzen, die über die Generatorleistung gehen.
// Dadurch wird die Batterie für die Lastspitzen genutzt (Abend), nicht gierig
// schon nachts bei Grundlast leergezogen. Die Modi unterscheiden sich allein in
// der Generatorleistung genKw (Peak = Spitzenlast, Puffer = kleinste mögliche).
// Monoton in genKw: mehr Leistung → nie mehr ungedeckte Last.
// gen = Gesamtabgabe (Last + Laden, für Sprit); genLoad = nur last-deckend (Stapel).
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
    let bat = 0, gen = 0, genLoad = 0;
    const net = load - pv;
    if (net <= 0) {
      const c = Math.min(-net, rate, (cap - soc) / ETA); soc += c * ETA;
    } else {
      const batAvail = Math.min(rate, soc * ETA);
      const chargePot = Math.min(rate, (cap - soc) / ETA);   // kW, die die Batterie aufnehmen kann
      gen = Math.min(genKw, net + chargePot);                // Last + Nachladen, gedeckelt auf genKw
      genLoad = Math.min(gen, net);                          // davon last-deckend
      const rem = net - genLoad;
      bat = Math.min(rem, batAvail); soc -= bat / ETA;       // Batterie kappt die Spitze
      if (rem - bat > 1e-6) eUnmet += rem - bat;
      const surplus = gen - genLoad;                         // Generator-Überschuss lädt die Batterie
      if (surplus > 0) { const c = Math.min(surplus, chargePot); soc += c * ETA; }
      if (gen > 0.001 && genKw > 0) { liters += idleRate + (Ff - idleRate) * (gen / genKw); genRunH++; }
    }
    eBat += bat; eGen += gen;
    steps.push({ t, load, pv: pvToLoad, bat, gen, genLoad, soc });
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

function _pvResEnergyHeader(overrideEl) {
  const opts = [['strom', '⚡ Strom'], ['waerme', '🔥 Wärme']];
  const btns = opts.map(([k, lbl]) =>
    `<button data-pvres-energy="${k}" style="padding:2px 10px;border:1px solid ${k===_pvResEnergy?'#ff8f00':'rgba(255,255,255,0.22)'};border-radius:10px;background:${k===_pvResEnergy?'#ff8f00':'transparent'};color:${k===_pvResEnergy?'#0a0e16':'#cfd8dc'};font-size:9px;cursor:pointer;font-weight:${k===_pvResEnergy?'700':'400'};">${lbl}</button>`).join('');
  const fsBtn = overrideEl ? '' : '<button data-pva-fs="resilienz" title="Vollbild" style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.18);border-radius:4px;color:#90a4ae;font-size:12px;padding:1px 7px;line-height:1.6;margin-left:auto;">⤢</button>';
  return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
    <span style="font-size:9px;color:var(--muted);">Betrachtete Versorgung</span>${btns}${fsBtn}
  </div>`;
}
function _pvResWireEnergyHeader(el, varianten, overrideEl) {
  el.querySelectorAll('[data-pvres-energy]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.pvresEnergy === _pvResEnergy) return;
    _pvResEnergy = b.dataset.pvresEnergy;
    renderResilienz(varianten, overrideEl);
  }));
  const fsBtn = el.querySelector('[data-pva-fs="resilienz"]');
  if (fsBtn) fsBtn.addEventListener('click', () => {
    const titel = _pvResEnergy === 'waerme' ? 'Resilienz: Ausfall der Wärmeversorgung' : 'Resilienz: Autarkie bei Netzausfall';
    _pvOpenFs(titel, cnt => renderResilienz(window._pvAnalyse.ergebnisse, cnt));
  });
}

function renderResilienz(varianten, overrideEl) {
  const el = overrideEl || document.getElementById('pva-chart-resilienz');
  if (!el) return;
  const energyHeader = _pvResEnergyHeader(overrideEl);

  if (_pvResEnergy === 'waerme') {
    el.innerHTML = energyHeader + '<div id="pva-pvres-body"></div>';
    _pvResWireEnergyHeader(el, varianten, overrideEl);
    renderResilienzWaerme(el.querySelector('#pva-pvres-body'), overrideEl);
    return;
  }

  const hinweisKeineVarianten = () => {
    el.innerHTML = energyHeader + '<div style="font-size:10px;color:var(--muted);padding:8px 0;">Erst „Varianten berechnen" nutzen, um die elektrische Resilienz zu betrachten.</div>';
    _pvResWireEnergyHeader(el, varianten, overrideEl);
  };
  if (!varianten?.length) { hinweisKeineVarianten(); return; }

  const demandH   = _pvFsArgs?.demandH;
  const pvProfile = _pvFsArgs?.pvProfile;
  const napParams = _pvFsArgs?.napParams || {};
  if (!demandH || !pvProfile) { hinweisKeineVarianten(); return; }
  const spotH = window.elSpotPreiseH || window._pvAnalyse?.spotPreise || null;
  const kanon = varianten.filter(v => v.info && v.info.frage);
  if (!kanon.length) { hinweisKeineVarianten(); return; }

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
  if (!_pvResMode) _pvResMode = 'pv-bat-gen';
  if (_pvResLoadFrac == null) _pvResLoadFrac = 100;
  if (_pvResUsable == null) _pvResUsable = 90;
  if (!_pvResFuel || !_PV_FUELS[_pvResFuel]) _pvResFuel = 'diesel';

  // Aus der Betriebsweise abgeleitete Verfügbarkeiten
  const MODE_LBL = { 'gen':'Nur Notstrom', 'bat-gen':'Speicher + Notstrom', 'pv-bat-gen':'PV + Speicher + Notstrom', 'pv-bat':'Nur PV + Speicher' };
  const pvActive  = _pvResMode === 'pv-bat-gen' || _pvResMode === 'pv-bat';
  const batActive = _pvResMode !== 'gen';
  const genActive = _pvResMode !== 'pv-bat';

  const maxKwp = pvGetMaxKwpFromAssets() || 500;
  const varBat = Math.max(0, ...kanon.map(v => v.batKwh));
  const batMax = Math.min(Math.max(1500, Math.round(varBat * 1.3 / 500) * 500), 12000);
  const COL = { pv: '#fdd835', bat: '#42a5f5', gen: '#ff8f00', unmet: '#ef5350' };

  const DURS = [ [6,'6 h'], [12,'12 h'], [24,'24 h'], [48,'2 Tage'], [72,'3 Tage'], [168,'7 Tage'], [336,'14 Tage'] ];

  const tabs = kanon.map(v =>
    `<button data-pvres-var="${v.pvKwp}|${v.batKwh}" title="${v.label}"
      style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid ${v.farbe};border-radius:10px;background:transparent;color:${v.farbe};font-size:9px;cursor:pointer;white-space:nowrap;">
      ${v.icon} ${Math.round(v.pvKwp)} kWp${v.batKwh>0?` · ${(v.batKwh/1000).toFixed(v.batKwh<1000?2:1)} MWh`:''}</button>`).join('');

  const durBtns = DURS.map(([h,lbl]) =>
    `<button data-pvres-dur="${h}" style="padding:2px 9px;border:1px solid ${h===_pvResDurH?'#ff8f00':'rgba(255,255,255,0.22)'};border-radius:10px;background:${h===_pvResDurH?'#ff8f00':'transparent'};color:${h===_pvResDurH?'#0a0e16':'#cfd8dc'};font-size:9px;cursor:pointer;font-weight:${h===_pvResDurH?'700':'400'};">${lbl}</button>`).join('');

  const fuelOpts = Object.entries(_PV_FUELS).map(([k,f]) =>
    `<option value="${k}" ${k===_pvResFuel?'selected':''}>${f.label}</option>`).join('');

  const MODES = [['gen','Nur Notstrom'], ['bat-gen','Speicher + Notstrom'], ['pv-bat-gen','PV + Speicher + Notstrom'], ['pv-bat','Nur PV + Speicher']];
  const modeBtns = MODES.map(([m,lbl]) =>
    `<button data-pvres-mode="${m}" style="padding:2px 9px;border:1px solid ${m===_pvResMode?'#4fc3f7':'rgba(255,255,255,0.22)'};border-radius:10px;background:${m===_pvResMode?'#4fc3f7':'transparent'};color:${m===_pvResMode?'#0a0e16':'#cfd8dc'};font-size:9px;cursor:pointer;font-weight:${m===_pvResMode?'700':'400'};white-space:nowrap;">${lbl}</button>`).join('');

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(440, elW - 4);
  const fmtEUR = n => Math.round(n).toLocaleString('de-DE');

  el.innerHTML = energyHeader + `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:10px;flex-wrap:wrap;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Inselbetrieb-Simulation
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Batterie startet mit realem Ladestand (Jahressim.), Generator deckt die Restlast</span>
      <span id="pva-pvres-sub" style="display:block;font-size:8px;color:#ffcc80;margin-top:2px;"></span>
    </span>
  </div>

  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
    <span style="font-size:9px;color:var(--muted);">Betriebsweise</span>${modeBtns}
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
    <span style="font-size:9px;color:var(--muted);">Autark sein für</span>${durBtns}
    <label style="font-size:9px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;margin-left:6px;opacity:${genActive?1:0.4};">Aggregat
      <select id="pva-pvres-fuel" ${genActive?'':'disabled'} style="background:#11151d;color:#cfd8dc;border:1px solid rgba(255,255,255,0.2);border-radius:4px;font-size:9px;padding:1px 3px;">${fuelOpts}</select></label>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:8px;align-items:center;">
    <div style="display:flex;align-items:center;gap:8px;opacity:${pvActive?1:0.4};" title="${pvActive?'':'In dieser Betriebsweise ist PV im Inselbetrieb nicht aktiv'}">
      <span style="font-size:9px;color:var(--muted);width:64px;">PV-Leistung</span>
      <input id="pva-pvres-pv" type="range" min="0" max="${Math.round(maxKwp)}" step="1" value="${Math.round(_pvResPvKwp)}" ${pvActive?'':'disabled'} style="flex:1;accent-color:${COL.pv};">
      <span id="pva-pvres-pv-val" style="font-size:9px;color:${COL.pv};font-family:'DM Mono',monospace;width:62px;text-align:right;">${Math.round(_pvResPvKwp)} kWp</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;opacity:${batActive?1:0.4};" title="${batActive?'':'In dieser Betriebsweise ist kein Speicher vorhanden'}">
      <span style="font-size:9px;color:var(--muted);width:64px;">Batterie</span>
      <input id="pva-pvres-bat" type="range" min="0" max="${Math.round(batMax)}" step="5" value="${Math.round(_pvResBatKwh)}" ${batActive?'':'disabled'} style="flex:1;accent-color:${COL.bat};">
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
    const durH = _pvResDurH;
    const frac = _pvResLoadFrac / 100;
    const capFrac = _pvResUsable / 100;            // #5 nutzbare Batteriekapazität
    const fuel = _PV_FUELS[_pvResFuel];
    const ETA = 0.90;

    // Aus der Betriebsweise abgeleitete effektive Auslegung
    const pvKwp  = pvActive  ? (parseFloat(pvIn.value) || 0)  : 0;
    const batKwh = batActive ? (parseFloat(batIn.value) || 0) : 0;

    // PV-Leistungsprofil (kW) für diese Auslegung
    const pvH = new Float32Array(nHours);
    if (pvActive) for (let t = 0; t < nHours; t++) pvH[t] = pvProfH[t] * pvKwp * spez;
    // Im Inselbetrieb gedeckte Last (Notbetrieb = nur kritische Verbraucher)
    const loadEff = new Float32Array(nHours);
    for (let t = 0; t < nHours; t++) loadEff[t] = loadH[t] * frac;

    // Batterie-Ladestand bei Ausfall:
    //  • mit PV (#1): realer Stand aus der netzgekoppelten Jahressimulation
    //  • ohne PV: netzseitig vollgehalten → starte voll (Reserve)
    let socStart;
    if (batKwh > 0 && pvActive) {
      const strat = spotH ? 'spot-dyn' : 'ev';
      const yr = pvNapSim(pvKwp, batKwh, demandH, pvProfile, napParams, strat, spotH);
      socStart = _pvResHourly(yr.batSocArr, dt);
    } else if (batKwh > 0) {
      socStart = new Float32Array(nHours).fill(batKwh);
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

    // Gewählter Ausfall-Start: per Heatmap-Klick gesetzt, sonst Worst-Case
    const selStart = (_pvResSelStart != null && _pvResSelStart < nDays * 24) ? _pvResSelStart : worstStart;
    const isWorst  = selStart === worstStart;

    // Fenster des gewählten Starts: Spitzenlast + Generator je nach Betriebsweise
    let peakLoad = 0;
    for (let k = 0; k < durH; k++) peakLoad = Math.max(peakLoad, loadEff[(selStart + k) % nHours]);
    const socRaw  = socAt(selStart);
    const initSoc = Math.min(batKwh * capFrac, socRaw);
    // Generatorleistung: mit Speicher minimal (Batterie puffert), ohne = Spitzenlast,
    // ohne Notstrom = 0. _pvResMinGen liefert bei batKwh=0 die Spitzenlast.
    const genKw = genActive
      ? _pvResMinGen(loadEff, pvH, batKwh, selStart, durH, nHours, initSoc, fuel, peakLoad, capFrac)
      : 0;
    const r = _pvResSim(loadEff, pvH, batKwh, genKw, selStart, durH, nHours, initSoc, fuel, _pvResMode, capFrac);
    const { eLoad, ePv, eBat, eGen, eUnmet, liters, genRunH, steps } = r;
    const bridgeH = bridgeArr[selStart] ?? durH;       // Überbrückung Batterie+PV allein
    const effSfc = eGen > 0 ? liters / eGen : 0;       // effektiver l/kWh inkl. Teillast
    const socStartPct = batKwh > 0 ? Math.min(socRaw, batKwh) / batKwh * 100 : 0;

    // #7 Kosten der Resilienz-Auslegung
    const recGenKw   = Math.ceil(genKw * 1.2 / 5) * 5;          // Empfehlung inkl. 20 % Reserve
    const gensetCost = recGenKw * _PV_RES_COST.gensetEurPerKw;
    const tankL      = Math.ceil(liters * _PV_RES_COST.tankMargin / 50) * 50;
    const tankCost   = tankL * _PV_RES_COST.tankEurPerL;
    const fuelCost   = liters * fuel.price;
    const capexCost  = gensetCost + tankCost;
    const fmtK = v => v >= 10000 ? `${(v/1000).toFixed(0)} k€` : `${Math.round(v).toLocaleString('de-DE')} €`;

    // KPIs — gewählter Start + Worst-Case-Referenz bleibt erhalten
    const selDay = Math.floor(selStart / 24), selHr = selStart % 24;
    const wDay = Math.floor(worstStart / 24), wHr = worstStart % 24;
    const endIdx = (selStart + durH) % nHours, endDay = Math.floor(endIdx / 24), endHr = endIdx % 24;
    const hasGenset = genActive && genKw > 0.5;
    const covered = eLoad > 0 ? (ePv + eBat + eGen) / eLoad : 1;   // gedeckter Lastanteil
    const genCard = hasGenset
      ? kpiCard('Notstrom-Leistung', `${Math.ceil(genKw)} kW`, COL.gen)
      : kpiCard('Notstrom', 'keiner', '#90a4ae');
    kpiEl.innerHTML =
      kpiCard('Betriebsweise', MODE_LBL[_pvResMode], '#4fc3f7') +
      kpiCard('Gewählter Start' + (isWorst ? ' (Worst-Case)' : ''), `${_pvahDayToDate(selDay)}, ${selHr}:00`, isWorst ? '#ffcc80' : '#4fc3f7') +
      kpiCard('Worst-Case-Start', `${_pvahDayToDate(wDay)}, ${wHr}:00`, '#ffcc80') +
      genCard +
      kpiCard(`Sprit (${fuel.label})`, hasGenset ? `${Math.ceil(liters).toLocaleString('de-DE')} l` : '–', COL.gen) +
      kpiCard('Überbrückung ohne Generator', bridgeH >= durH ? `> ${durH} h` : `${bridgeH} h`, bridgeH >= durH ? '#66bb6a' : COL.bat) +
      (genActive
        ? kpiCard('Versorgungslücke', eUnmet > 0.5 ? `${(eUnmet/1000).toFixed(2)} MWh` : 'keine ✓', eUnmet > 0.5 ? COL.unmet : '#66bb6a')
        : kpiCard('Autark gedeckt', `${(covered*100).toFixed(0)} %`, covered > 0.999 ? '#66bb6a' : COL.unmet)) +
      kpiCard('Energiebedarf im Fenster', `${(eLoad/1000).toFixed(2)} MWh`, '#cfd8dc') +
      // #7 Kosten-Karten
      kpiCard('Aggregat (Capex)', hasGenset ? fmtK(gensetCost) : '–', '#a5d6a7') +
      kpiCard('Tankvolumen', hasGenset && tankL > 0 ? `${tankL.toLocaleString('de-DE')} l` : '–', '#a5d6a7') +
      kpiCard('Resilienz-Capex', hasGenset ? fmtK(capexCost) : '0 €', '#a5d6a7') +
      kpiCard('Spritkosten / Ereignis', hasGenset ? fmtK(fuelCost) : '0 €', '#a5d6a7');

    subEl.innerHTML = `<b style="color:#4fc3f7;">${MODE_LBL[_pvResMode]}</b> · ${isWorst ? 'Worst-Case' : 'gewähltes'} ${durH}-h-Fenster: ${_pvahDayToDate(selDay)} ${selHr}:00 → ${_pvahDayToDate(endDay)} ${endHr}:00`
      + (isWorst ? '' : ` · Worst-Case liegt bei ${_pvahDayToDate(wDay)} ${wHr}:00`)
      + (batKwh > 0 ? ` · Batterie bei Ausfall ${socStartPct.toFixed(0)} % geladen · nutzbar ${_pvResUsable} %` : '')
      + (frac < 1 ? ` · Notbetrieb ${_pvResLoadFrac} % der Last` : '')
      + ` · Deckung: PV ${(ePv/eLoad*100||0).toFixed(0)} % · Batterie ${(eBat/eLoad*100||0).toFixed(0)} % · Generator ${(eGen/eLoad*100||0).toFixed(0)} %`
      + (hasGenset ? ` · Aggregat läuft ${genRunH} h, Ø ${effSfc.toFixed(2)} l/kWh` : '')
      + (hasGenset && batActive ? ` · Spitzenlast-Reserve bei Batterieausfall: ${Math.ceil(peakLoad)} kW` : '')
      + (hasGenset ? ` · Empfehlung Aggregat ~${recGenKw} kW (inkl. 20 % Reserve)` : '')
      + (hasGenset && tankL > _PV_RES_COST.meldeschwelleL ? ` · ⚠ Tank > ${_PV_RES_COST.meldeschwelleL} l: AwSV-Anzeige/Auflagen beachten` : '')
      + (!genActive && eUnmet > 0.5 ? ` · ⚠ ${(eUnmet/1000).toFixed(2)} MWh nicht gedeckt — Fenster nicht durchgehend autark` : '')
      + (hasGenset ? ` · Annahmen: Aggregat ${_PV_RES_COST.gensetEurPerKw} €/kW · ${fuel.label} ${fuel.price.toFixed(2)} €/l · Tank ${_PV_RES_COST.tankEurPerL.toFixed(2)} €/l` : '');

    // Handoff an die Netzanalyse (Notstrom-Platzierung) + Gutachten-Grafik (Resilienz-
    // Zusammenfassung, src/17-gutachten-grafik.js): jeweils die zuletzt gezeichnete
    // Auslegung/Ergebnisse dieses Kapitels.
    window._pvResReco = {
      genKw: hasGenset ? recGenKw : 0, peakKW: Math.ceil(peakLoad),
      durH, kraftstoff: fuel.label, fuelId: _pvResFuel, mode: _pvResMode, ts: Date.now(),
      pvKwp, batKwh, bridgeH, isWorst, selStart, worstStart, nHours,
      liters, covered, eUnmet, eLoadMwh: eLoad / 1000,
      gensetCost, tankCost, tankL, fuelCost, capexCost,
    };

    drawHeatmap(bridgeArr, durH, worstStart, selStart, isWorst);
    drawDetail(steps, peakLoad, batKwh, durH, selStart, isWorst);
    // #6 Trade-off (nur sinnvoll, wenn ein Aggregat gegen Batterie getauscht werden kann)
    if (genActive) drawTradeoff(loadEff, pvH, selStart, durH, peakLoad, batMax, batKwh, socStartPct / 100, fuel, capFrac);
    else tradeEl.innerHTML = '';
  }

  function drawHeatmap(bridgeArr, durH, worstStart, selStart, isWorst) {
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
    // Markierung: Worst-Case (weiß, bleibt immer) + gewählter Start (cyan), falls verschoben
    const cellMark = (startIdx, stroke, label, dash) => {
      const md = Math.floor(startIdx/24), mh = startIdx % 24;
      const mx = PL + md*cellW, my = PT + mh*cellH;
      const labelX = Math.min(mx + 4, W - PR - 90), labelY = (my < PT + cH/2 ? my + cellH + 10 : my - 3);
      return `<rect x="${(mx-1).toFixed(1)}" y="${(my-1).toFixed(1)}" width="${(cellW+2).toFixed(1)}" height="${(cellH+2).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.6"${dash?` stroke-dasharray="${dash}"`:''}/>`
        + `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${stroke}" font-size="8" font-weight="700">${label}</text>`;
    };
    const marker = cellMark(worstStart, '#fff', '◀ Worst-Case')
      + (isWorst ? '' : cellMark(selStart, '#4fc3f7', '◀ gewählt', '2,1.5'));
    const legW = 130, legH = 8, legX = PL, legY = PT + cH + 14;
    const gradId = 'pvres-grad-' + (overrideEl ? 'fs' : 'm');
    heatEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;gap:8px;">
      <span style="font-size:8px;color:var(--muted);">Überbrückung Batterie+PV je Blackout-Start — <b style="color:#4fc3f7;">Zelle anklicken</b> verschiebt den Ausfall-Start</span>
      ${isWorst ? '' : '<button data-pvres-reset style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.22);border-radius:4px;color:#ffcc80;font-size:8px;padding:1px 7px;white-space:nowrap;">↺ Worst-Case</button>'}
    </div>
    <svg width="${W}" height="${H+18}" style="display:block;overflow:hidden;cursor:pointer;">
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
      _pvShowTT(ev, `Blackout-Start: ${_pvahDayToDate(d)}, ${h}:00 Uhr<br>überbrückbar (Batterie+PV): <strong>${b >= durH ? '≥ '+durH : b} h</strong><br><span style="color:#4fc3f7">Klicken, um dieses Fenster zu zeigen</span>`);
    });
    svg.addEventListener('mouseleave', _pvHideTT);
    svg.addEventListener('click', ev => {
      const tg = ev.target;
      if (!(tg instanceof SVGRectElement) || tg.dataset.pvresDay === undefined) return;
      _pvResSelStart = (+tg.dataset.pvresDay) * 24 + (+tg.dataset.pvresHour);
      _pvHideTT(); draw();
    });
    const resetBtn = heatEl.querySelector('[data-pvres-reset]');
    if (resetBtn) resetBtn.addEventListener('click', () => { _pvResSelStart = null; draw(); });
  }

  function drawDetail(steps, peakLoad, batKwh, durH, startIdx, isWorst) {
    const H = overrideEl ? 240 : 190;
    const PL = 38, PT = 14, PR = 40, PB = 28;
    const cW = W - PL - PR, cH = H - PT - PB;
    const n = steps.length, colW = cW / n;
    const yMax = peakLoad * 1.08 || 1;
    const yOf = kw => PT + cH - (kw / yMax) * cH;
    let bars = '';
    steps.forEach((s, i) => {
      const x = PL + i * colW;
      const hPv  = (s.pv  / yMax) * cH, hBat = (s.bat / yMax) * cH, hGen = (s.genLoad / yMax) * cH;
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
      const x = PL + k*colW, gi = (startIdx + k) % nHours, gh = gi % 24;
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
    <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">${isWorst ? 'Worst-Case-Fenster' : 'Gewähltes Fenster'} im Detail — Lastdeckung je Stunde (Start ${_pvahDayToDate(Math.floor(startIdx/24))}, ${startIdx%24}:00)</div>
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
        `<span style="color:${COL.pv}">PV ${s.pv.toFixed(1)}</span> · <span style="color:${COL.bat}">Batt ${s.bat.toFixed(1)}</span> · <span style="color:${COL.gen}">Gen ${s.genLoad.toFixed(1)}</span> kW (an Last)<br>` +
        (s.gen - s.genLoad > 0.5 ? `<span style="color:${COL.gen}">+ ${(s.gen-s.genLoad).toFixed(1)} kW lädt Batterie</span><br>` : '') +
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
    <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Trade-off im aktuellen Fenster — mehr Batterie senkt nötige Generatorleistung und Spritmenge (Batteriepuffer-Betrieb)</div>
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
  el.querySelector('#pva-pvres-fuel').addEventListener('change', e => { _pvResFuel = e.target.value; draw(); });
  el.querySelectorAll('[data-pvres-mode]').forEach(b => b.addEventListener('click', () => {
    _pvResMode = b.dataset.pvresMode; _pvResSelStart = null;   // Erzeuger geändert → Worst-Case neu
    renderResilienz(varianten, overrideEl);                    // Slider-Verfügbarkeit neu aufbauen
  }));
  el.querySelectorAll('[data-pvres-dur]').forEach(b => b.addEventListener('click', () => {
    _pvResDurH = +b.dataset.pvresDur; _pvResSelStart = null;   // Fensterlänge geändert → Worst-Case neu
    renderResilienz(varianten, overrideEl);
  }));
  el.querySelectorAll('[data-pvres-var]').forEach(b => b.addEventListener('click', () => {
    const [p, q] = b.dataset.pvresVar.split('|').map(parseFloat);
    _pvResSelStart = null;                                     // andere Auslegung → Worst-Case neu
    pvIn.value = Math.round(p); batIn.value = Math.round(q); sync();
  }));
  draw();
  _pvResWireEnergyHeader(el, varianten, overrideEl);
}

// ── Abb. 10b — Resilienz Wärme: Totalausfall der Wärmezentrale ─────────────
// Frage: Fallen ALLE Wärmeerzeuger gleichzeitig aus (Totalausfall der Heizzentrale),
// wie lange überbrückt allein der Pufferspeicher die Netzlast (Energiebilanz), und
// wie lange dauert es danach, bis die angeschlossenen Gebäude unter eine kritische
// Innentemperatur fallen (Auskühlzeit)?
//
// Auskühlzeit als vereinfachtes RC-Modell je Gebäude: τ = C / UA.
//   UA [kW/K]  = Normheizlast / (20 °C − Normaußentemperatur)   — aus der DIN-12831-Auslegung
//   C  [Wh/K]  = Bauschwere-Annahme [Wh/(m²K)] × Nutzfläche      — s. _PV_RES_BAUSCHWERE
// Nach Ablauf der Pufferstandzeit kühlt der Raum stündlich mit der realen Außen-
// temperatur (T_neu = T_außen + (T_alt − T_außen)·e^(−1/τ)) bis zur Schwelle _pvResTcrit.
function renderResilienzWaerme(el, overrideEl) {
  if (!el) return;
  const ss = window.systemState;
  if (!ss || !ss.lastgangKw?.length || !ss.tempH?.length) {
    el.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:8px 0;">Erst den Wärme-Lastgang berechnen, um die Ausfallsicherheit der Wärmeversorgung zu betrachten.</div>';
    return;
  }
  const loadH  = ss.lastgangKw;                 // kW, Netzlast inkl. Verluste
  const tempH  = ss.tempH;                      // °C, stündliche Außentemperatur
  const normAt = ss.normAussentemp ?? -12;      // Normaußentemperatur (DIN 12831)
  const nHours = Math.min(loadH.length, tempH.length);
  const nDays  = Math.floor(nHours / 24);

  const thSp        = thermSpeicherAktiv ? getThermSpeicherParams() : null;
  const hasSpeicher  = !!(thSp && thSp.kapKwh > 0);
  const socArr       = window._thermSpeicherState?.socH || null;

  // Gebäude im Bestand mit gültiger Heizlast/Fläche — bei Totalausfall der
  // Zentrale sind ALLE Gebäude am Netz betroffen (kein Teilnetz-Ausfall hier).
  const bList = gebaeude.map(g => {
    if (isExcluded(g.id)) return null;
    const st = getComputedStats(g, globalYear);
    if (st.status !== 'bestand' && st.status !== 'saniert') return null;
    const heizlast = st.heizlast, flaeche = parseFloat(g.flaeche) || 0;
    if (heizlast <= 0 || flaeche <= 0) return null;
    const nt = getNutzungstypById(g.nutzung);
    return {
      id: g.id, name: g.name || g.gebaeudenummer || `Gebäude ${g.id}`,
      heizlast, flaeche, nutzungLabel: nt?.label || '—',
      kritisch: !!(nt && _PV_RES_KRIT_GRUPPEN.has(nt.gruppe)),
    };
  }).filter(Boolean);

  const spezWk = _PV_RES_BAUSCHWERE[_pvResBauschwere].whM2K;
  bList.forEach(b => {
    const uaKw = b.heizlast / (20 - normAt);          // kW/K
    const cWh  = spezWk * b.flaeche;                  // Wh/K
    b.tau = uaKw > 0 ? cWh / (uaKw * 1000) : Infinity; // h
  });

  if (_pvResDurH == null) _pvResDurH = 24;
  const DURS_W = [ [6,'6 h'], [12,'12 h'], [24,'24 h'], [48,'2 Tage'], [72,'3 Tage'], [168,'7 Tage'], [336,'14 Tage'] ];
  const COOL_CAP_H = 720; // Auskühl-Horizont: max. 30 Tage weitersuchen

  // Pufferbilanz ab Startstunde über durH Stunden — Erzeuger liefern 0 (Totalausfall).
  function simBuffer(start, durH) {
    let soc = hasSpeicher ? Math.min(thSp.kapKwh, socArr ? (socArr[start % socArr.length] ?? thSp.kapKwh) : thSp.kapKwh) : 0;
    let total = 0, covered = 0, bridge = durH, hit = false;
    for (let k = 0; k < durH; k++) {
      const t = (start + k) % nHours, need = loadH[t];
      total += need;
      if (hasSpeicher && soc > 0) soc = Math.max(0, soc - soc * thSp.verlustRate);
      const avail = hasSpeicher ? Math.min(soc, thSp.entladeKw) : 0;
      const delivered = Math.min(need, avail);
      covered += delivered; soc -= delivered;
      if (delivered < need - 1e-6 && !hit) { bridge = k; hit = true; }
    }
    return { bridge, covered, total, unmet: total - covered };
  }

  // Auskühlzeit ab absoluter Stunde fromT (= Ausfallbeginn + Pufferstandzeit).
  function coolHours(tau, fromT) {
    if (!isFinite(tau) || tau <= 0) return 0;
    let T = 20;
    for (let k = 0; k < COOL_CAP_H; k++) {
      const Ta = tempH[(fromT + k) % nHours];
      T = Ta + (T - Ta) * Math.exp(-1 / tau);
      if (T <= _pvResTcrit) return k + 1;
    }
    return null; // nicht erreicht im Horizont
  }

  const elW = el.getBoundingClientRect().width || 700;
  const W   = Math.max(440, elW - 4);

  const bauBtns = Object.entries(_PV_RES_BAUSCHWERE).map(([k, b]) =>
    `<button data-pvresw-bau="${k}" style="padding:2px 9px;border:1px solid ${k===_pvResBauschwere?'#8d6e63':'rgba(255,255,255,0.22)'};border-radius:10px;background:${k===_pvResBauschwere?'#8d6e63':'transparent'};color:${k===_pvResBauschwere?'#0a0e16':'#cfd8dc'};font-size:9px;cursor:pointer;font-weight:${k===_pvResBauschwere?'700':'400'};white-space:nowrap;">${b.label}</button>`).join('');
  const durBtns = DURS_W.map(([h,lbl]) =>
    `<button data-pvresw-dur="${h}" style="padding:2px 9px;border:1px solid ${h===_pvResDurH?'#ff8f00':'rgba(255,255,255,0.22)'};border-radius:10px;background:${h===_pvResDurH?'#ff8f00':'transparent'};color:${h===_pvResDurH?'#0a0e16':'#cfd8dc'};font-size:9px;cursor:pointer;font-weight:${h===_pvResDurH?'700':'400'};">${lbl}</button>`).join('');

  el.innerHTML = `
  <div style="margin-bottom:8px;">
    <span style="font-size:10px;font-weight:600;color:var(--text);letter-spacing:.02em;">Totalausfall der Wärmezentrale
      <span style="font-size:8px;color:var(--muted);font-weight:400;margin-left:6px;">Alle Erzeuger fallen aus — nur der Pufferspeicher überbrückt, danach kühlen die Gebäude aus</span>
    </span>
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
    <span style="font-size:9px;color:var(--muted);">Angenommene Ausfalldauer</span>${durBtns}
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
    <span style="font-size:9px;color:var(--muted);">Bauschwere (Auskühlzeit)</span>${bauBtns}
    <label style="font-size:9px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-left:6px;">Kritische Innentemp.
      <input id="pva-pvresw-tcrit" type="range" min="5" max="18" step="1" value="${_pvResTcrit}" style="width:80px;accent-color:#ef9a9a;">
      <span id="pva-pvresw-tcrit-val" style="color:#ef9a9a;font-family:'DM Mono',monospace;">${_pvResTcrit} °C</span>
    </label>
  </div>
  <div id="pva-pvresw-kpi" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
  <div id="pva-pvresw-heat"></div>
  <div id="pva-pvresw-table" style="margin-top:10px;"></div>`;

  const kpiEl   = el.querySelector('#pva-pvresw-kpi');
  const heatEl  = el.querySelector('#pva-pvresw-heat');
  const tableEl = el.querySelector('#pva-pvresw-table');

  function kpiCard(label, value, color) {
    return `<div style="flex:1;min-width:120px;background:#11151d;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 9px;">
      <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">${label}</div>
      <div style="font-size:14px;font-weight:700;color:${color};font-family:'DM Mono',monospace;">${value}</div></div>`;
  }

  function draw() {
    const durH = _pvResDurH;

    const bridgeArr = new Float32Array(nDays * 24);
    let worstStart = 0, worstBridge = Infinity, worstUnmet = -1;
    for (let s = 0; s < nDays * 24; s++) {
      const r = simBuffer(s, durH);
      bridgeArr[s] = r.bridge;
      if (r.bridge < worstBridge || (r.bridge === worstBridge && r.unmet > worstUnmet)) {
        worstBridge = r.bridge; worstUnmet = r.unmet; worstStart = s;
      }
    }
    const selStart = (_pvResSelStartW != null && _pvResSelStartW < nDays * 24) ? _pvResSelStartW : worstStart;
    const isWorst  = selStart === worstStart;
    const rSel = simBuffer(selStart, durH);

    const buildings = bList.map(b => {
      const cool = coolHours(b.tau, selStart + rSel.bridge);
      return { ...b, totalH: cool == null ? null : rSel.bridge + cool };
    }).sort((a, b) => (a.totalH ?? Infinity) - (b.totalH ?? Infinity));
    const unterSchwelleInFenster = buildings.filter(b => b.totalH != null && b.totalH <= durH).length;
    const kritischBetroffen = buildings.filter(b => b.kritisch && b.totalH != null && b.totalH <= durH).length;

    const selDay = Math.floor(selStart / 24), selHr = selStart % 24;
    const wDay = Math.floor(worstStart / 24), wHr = worstStart % 24;
    const bridgeLabel = rSel.bridge >= durH ? `> ${durH} h` : `${rSel.bridge} h`;

    kpiEl.innerHTML =
      kpiCard('Gewählter Ausfall-Start' + (isWorst ? ' (Worst-Case)' : ''), `${_pvahDayToDate(selDay)}, ${selHr}:00`, isWorst ? '#ffcc80' : '#4fc3f7') +
      kpiCard('Worst-Case-Start', `${_pvahDayToDate(wDay)}, ${wHr}:00`, '#ffcc80') +
      kpiCard('Pufferstandzeit', hasSpeicher ? bridgeLabel : 'kein Puffer · 0 h', hasSpeicher ? '#80cbc4' : '#ef5350') +
      kpiCard('Energiebedarf im Fenster', `${(rSel.total/1000).toFixed(2)} MWh`, '#cfd8dc') +
      kpiCard('Davon durch Puffer gedeckt', `${(rSel.covered/1000).toFixed(2)} MWh`, '#80cbc4') +
      kpiCard('Ungedeckt', rSel.unmet > 0.5 ? `${(rSel.unmet/1000).toFixed(2)} MWh` : 'keine ✓', rSel.unmet > 0.5 ? '#ef5350' : '#66bb6a') +
      kpiCard('Betroffene Gebäude (Netz gesamt)', `${bList.length}`, '#cfd8dc') +
      kpiCard('Unter kritischer Temp. binnen Ausfalldauer', `${unterSchwelleInFenster}` + (kritischBetroffen > 0 ? ` (⚠ ${kritischBetroffen} kritisch)` : ''), unterSchwelleInFenster > 0 ? '#ef5350' : '#66bb6a');

    // Heatmap: Pufferstandzeit je möglichem Ausfall-Start im Jahr (wie Strom-Pendant)
    const H = overrideEl ? 230 : 170;
    const PL = 30, PT = 22, PR = 16, PB = 26;
    const cW = W - PL - PR, cH = H - PT - PB;
    const cellW = cW / nDays, cellH = cH / 24;
    let cells = '';
    for (let d = 0; d < nDays; d++) for (let h = 0; h < 24; h++) {
      const s = d * 24 + h, b = bridgeArr[s] ?? durH;
      const x = PL + d * cellW, y = PT + h * cellH;
      cells += `<rect data-pvresw-day="${d}" data-pvresw-hour="${h}" data-pvresw-b="${b}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellW+0.3).toFixed(2)}" height="${(cellH+0.3).toFixed(2)}" fill="${_pvahColor(b/durH)}"/>`;
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
    const cellMark = (startIdx, stroke, label, dash) => {
      const md = Math.floor(startIdx/24), mh = startIdx % 24;
      const mx = PL + md*cellW, my = PT + mh*cellH;
      const labelX = Math.min(mx + 4, W - PR - 90), labelY = (my < PT + cH/2 ? my + cellH + 10 : my - 3);
      return `<rect x="${(mx-1).toFixed(1)}" y="${(my-1).toFixed(1)}" width="${(cellW+2).toFixed(1)}" height="${(cellH+2).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.6"${dash?` stroke-dasharray="${dash}"`:''}/>`
        + `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${stroke}" font-size="8" font-weight="700">${label}</text>`;
    };
    const marker = cellMark(worstStart, '#fff', '◀ Worst-Case') + (isWorst ? '' : cellMark(selStart, '#4fc3f7', '◀ gewählt', '2,1.5'));
    const legW = 130, legH = 8, legX = PL, legY = PT + cH + 14;
    const gradId = 'pvresw-grad-' + (overrideEl ? 'fs' : 'm');
    heatEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;gap:8px;">
      <span style="font-size:8px;color:var(--muted);">Pufferstandzeit je Ausfall-Start — <b style="color:#4fc3f7;">Zelle anklicken</b> verschiebt den Ausfall-Start</span>
      ${isWorst ? '' : '<button data-pvresw-reset style="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.22);border-radius:4px;color:#ffcc80;font-size:8px;padding:1px 7px;white-space:nowrap;">↺ Worst-Case</button>'}
    </div>
    <svg width="${W}" height="${H+18}" style="display:block;overflow:hidden;cursor:pointer;">
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
      if (!(tg instanceof SVGRectElement) || tg.dataset.pvreswDay === undefined) { _pvHideTT(); return; }
      const d = +tg.dataset.pvreswDay, h = +tg.dataset.pvreswHour, b = +tg.dataset.pvreswB;
      _pvShowTT(ev, `Ausfall-Start: ${_pvahDayToDate(d)}, ${h}:00 Uhr<br>Pufferstandzeit: <strong>${b >= durH ? '≥ '+durH : b} h</strong><br><span style="color:#4fc3f7">Klicken, um dieses Fenster zu zeigen</span>`);
    });
    svg.addEventListener('mouseleave', _pvHideTT);
    svg.addEventListener('click', ev => {
      const tg = ev.target;
      if (!(tg instanceof SVGRectElement) || tg.dataset.pvreswDay === undefined) return;
      _pvResSelStartW = (+tg.dataset.pvreswDay) * 24 + (+tg.dataset.pvreswHour);
      _pvHideTT(); draw();
    });
    const resetBtn = heatEl.querySelector('[data-pvresw-reset]');
    if (resetBtn) resetBtn.addEventListener('click', () => { _pvResSelStartW = null; draw(); });

    // Gebäudeliste — nach Zeit bis kritischer Temperatur sortiert (kritischstes zuerst)
    const rows = buildings.map(b => {
      const warn = b.totalH != null && b.totalH <= durH;
      const timeLabel = b.totalH == null ? `> ${COOL_CAP_H} h` : `${b.totalH} h`;
      return `<tr style="${b.kritisch ? 'background:rgba(239,83,80,0.08);' : ''}">
        <td style="padding:3px 6px;">${b.kritisch ? '⚠ ' : ''}${escHtml(b.name)}</td>
        <td style="padding:3px 6px;color:var(--muted);">${escHtml(b.nutzungLabel)}</td>
        <td style="padding:3px 6px;text-align:right;">${Math.round(b.heizlast)} kW</td>
        <td style="padding:3px 6px;text-align:right;">${isFinite(b.tau) ? Math.round(b.tau) : '—'} h</td>
        <td style="padding:3px 6px;text-align:right;color:${warn?'#ef5350':'#66bb6a'};font-weight:${warn?700:400};">${timeLabel}</td>
      </tr>`;
    }).join('');
    tableEl.innerHTML = bList.length ? `
      <div style="font-size:8px;color:var(--muted);margin-bottom:4px;">Zeit bis kritische Temperatur = Pufferstandzeit + Auskühlzeit (τ = C/UA, Bauschwere „${_PV_RES_BAUSCHWERE[_pvResBauschwere].label}“, kritisch ab ${_pvResTcrit} °C) — rot markiert: Nutzungstyp Pflege/Gesundheit/Bildung.</div>
      <div style="max-height:260px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:9px;color:var(--text);">
          <thead style="position:sticky;top:0;background:#11151d;"><tr style="text-align:left;color:var(--muted);">
            <th style="padding:3px 6px;">Gebäude</th><th style="padding:3px 6px;">Nutzung</th>
            <th style="padding:3px 6px;text-align:right;">Heizlast</th><th style="padding:3px 6px;text-align:right;">τ</th>
            <th style="padding:3px 6px;text-align:right;">bis kritisch</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div style="font-size:9px;color:var(--muted);">Keine Gebäude mit Heizlast/Fläche im Bestand gefunden.</div>';

    window._pvResRecoWaerme = {
      hasSpeicher, bridgeH: rSel.bridge, durH, isWorst, selStart, worstStart, nHours,
      totalMwh: rSel.total/1000, coveredMwh: rSel.covered/1000, unmetMwh: rSel.unmet/1000,
      bauschwere: _pvResBauschwere, tcrit: _pvResTcrit, gebaeudeAnzahl: bList.length,
      unterSchwelleInFenster, kritischBetroffen, ts: Date.now(),
    };
  }

  el.querySelector('#pva-pvresw-tcrit').addEventListener('input', e => {
    _pvResTcrit = parseFloat(e.target.value) || 15;
    el.querySelector('#pva-pvresw-tcrit-val').textContent = _pvResTcrit + ' °C';
    draw();
  });
  el.querySelectorAll('[data-pvresw-bau]').forEach(b => b.addEventListener('click', () => {
    _pvResBauschwere = b.dataset.pvreswBau;
    renderResilienzWaerme(el, overrideEl);
  }));
  el.querySelectorAll('[data-pvresw-dur]').forEach(b => b.addEventListener('click', () => {
    _pvResDurH = +b.dataset.pvreswDur; _pvResSelStartW = null;
    renderResilienzWaerme(el, overrideEl);
  }));
  draw();
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
    return;
  }
  const s = window._pvAnalyse;
  btn.textContent = (s && s.stale && s.ergebnisse?.length)
    ? 'Varianten neu berechnen'
    : 'Varianten berechnen';
  btn.disabled = false;
}

// Globale Exports für inline data-click/data-change Handler und setViewMode
window.initPvAnalyse          = initPvAnalyse;
window.pvBerechneAlle         = pvBerechneAlle;
window.pvMarkStale            = pvMarkStale;
// pvLadeSpotPreise nicht mehr nötig (Upload über Strom-Grundlagen)
window.pvGetMaxKwpFromAssets  = pvGetMaxKwpFromAssets;
