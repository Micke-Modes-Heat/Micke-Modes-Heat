// ── 13q-wind-ertrag.js — Windertrags-Schätzung (Weibull-Windverteilung × generische Leistungskurve) ──
// Vereinfachtes Modell ohne Herstellerkennlinie: kubischer Anstieg zwischen Einschalt- und Nennwind,
// Nennleistung dazwischen, 0 unter Einschalt-/über Abschaltwind. Für Genehmigungsunterlagen ist die
// reale Leistungskurve des Herstellers sowie ein Standortwindgutachten heranzuziehen.

import { GL_MONTH_HOURS } from './06a-gbi-lastgang.js';
import { ASSETS, getAssetStatus } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';

// Lanczos-Näherung der Gammafunktion (g=7, n=9) — Standardkoeffizienten
const _LANCZOS_G = 7;
const _LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];

function gammaFn(x) {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  x -= 1;
  let a = _LANCZOS_C[0];
  const t = x + _LANCZOS_G + 0.5;
  for (let i = 1; i < _LANCZOS_G + 2; i++) a += _LANCZOS_C[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

export function weibullScaleFromMean(vMean, k = 2) {
  return vMean / gammaFn(1 + 1 / k);
}

function weibullPdf(v, A, k) {
  if (v <= 0 || A <= 0) return 0;
  return (k / A) * Math.pow(v / A, k - 1) * Math.exp(-Math.pow(v / A, k));
}

export function turbinePowerKw(v, { ratedKw, cutIn, ratedWind, cutOut }) {
  if (v < cutIn || v > cutOut) return 0;
  if (v >= ratedWind) return ratedKw;
  const num = Math.pow(v, 3) - Math.pow(cutIn, 3);
  const den = Math.pow(ratedWind, 3) - Math.pow(cutIn, 3);
  if (den <= 0) return 0;
  return ratedKw * Math.max(0, Math.min(1, num / den));
}

// vMean: mittlere Windgeschwindigkeit auf Nabenhöhe (m/s); k: Weibull-Formfaktor (2 = Rayleigh, üblicher Default)
export function computeWindYield({ vMean, k = 2, ratedKw, cutIn, ratedWind, cutOut, rotorDiameterM }) {
  const empty = { annualMWh: 0, volllaststundenH: 0, kapazitaetsfaktorPct: 0, spezFlaecheWm2: 0, weibullA: 0 };
  if (!(vMean > 0) || !(ratedKw > 0) || !(ratedWind > cutIn) || !(cutOut > ratedWind)) return empty;

  const A = weibullScaleFromMean(vMean, k);
  const dv = 0.1;
  const vMax = Math.max(cutOut + 5, 40);
  let kwMeanWeighted = 0; // ∫ f(v) · P(v) dv  → mittlere Leistung [kW]
  for (let v = dv / 2; v < vMax; v += dv) {
    kwMeanWeighted += weibullPdf(v, A, k) * turbinePowerKw(v, { ratedKw, cutIn, ratedWind, cutOut }) * dv;
  }
  const annualKWh = kwMeanWeighted * 8760;
  const volllaststundenH = annualKWh / ratedKw;
  const kapazitaetsfaktorPct = (volllaststundenH / 8760) * 100;
  const rotorFlaeche = rotorDiameterM > 0 ? Math.PI * Math.pow(rotorDiameterM / 2, 2) : 0;
  const spezFlaecheWm2 = rotorFlaeche > 0 ? (ratedKw * 1000) / rotorFlaeche : 0;

  return { annualMWh: annualKWh / 1000, volllaststundenH, kapazitaetsfaktorPct, spezFlaecheWm2, weibullA: A };
}

// Grobe Schallleistungspegel-Schätzung aus der Nennleistung — Kleinwindanlagen ~90 dB(A),
// große Windenergieanlagen gedeckelt bei ~107 dB(A) (typische Herstellerangaben-Bandbreite).
// Überschreibbarer Startwert, kein Ersatz für eine Herstellerangabe/Schallgutachten.
export function calcWindLwaAuto(kw) {
  const x = Math.max(kw, 1);
  const raw = 82 + 7 * Math.log10(x);
  return Math.round(Math.min(107, Math.max(90, raw)));
}

// ── Szenarien-Vergleich: 50-m-Genehmigung · Bedarfsgerecht · Maximal möglich ──
// Alle drei Szenarien übernehmen Windkennlinie (Ein-/Nenn-/Abschaltwind) und
// spezifische Flächenleistung (kW je m² Rotorfläche) der aktuell konfigurierten
// Anlage — nur Rotordurchmesser/Nennleistung/Nabenhöhe werden je Szenario variiert.
// Windgeschwindigkeit bei abweichender Nabenhöhe wird über das Hellmann-Potenzgesetz
// aus der Referenzhöhe hochgerechnet.
export function computeWindScenarios(cfg) {
  const {
    nabenhoheM, rotorDurchmesserM, ratedKw, cutIn, ratedWind, cutOut,
    vMean, k = 2, hellmannAlpha = 0.2,
    zielJahresbedarfMWh = null,
    maxRadiusM = null, abstandMultiplikator = 5,
    marktMaxKw = 6000, marktMaxD = 162,
  } = cfg;

  const specWm2 = ratedKw > 0 && rotorDurchmesserM > 0
    ? (ratedKw * 1000) / (Math.PI * Math.pow(rotorDurchmesserM / 2, 2))
    : 300;

  const kwForDiameter = D => specWm2 * Math.PI * Math.pow(D / 2, 2) / 1000;
  const diameterForKw = kw => 2 * Math.sqrt((kw * 1000 / specWm2) / Math.PI);
  const vAtHeight = h => (nabenhoheM > 0 && vMean > 0 && h > 0)
    ? vMean * Math.pow(h / nabenhoheM, hellmannAlpha)
    : vMean;

  function scenario(label, D, kw, h) {
    const v = vAtHeight(h);
    const y = computeWindYield({ vMean: v, k, ratedKw: kw, cutIn, ratedWind, cutOut, rotorDiameterM: D });
    return { label, rotorDurchmesserM: D, ratedKw: kw, nabenhoheM: h, gesamthoeheM: h + D / 2, vHubMs: v, ...y };
  }

  // 1) 50-m-Szenario: gleicher Rotor, Nabenhöhe auf zulässiges Maximum gekappt
  const maxNabe50 = Math.max(1, 50 - rotorDurchmesserM / 2);
  const h50 = Math.min(nabenhoheM, maxNabe50) || maxNabe50;
  const scen50 = scenario('≤ 50 m Gesamthöhe', rotorDurchmesserM, ratedKw, h50);
  scen50.bereitsErfuellt = (nabenhoheM + rotorDurchmesserM / 2) <= 50;

  // 2) Bedarfsgerecht: Leistung so skaliert, dass Jahresertrag ≈ Jahresbedarf
  //    (Ertrag skaliert linear mit der Nennleistung bei gleicher Kennlinienform)
  let scenBedarf = null;
  if (zielJahresbedarfMWh > 0) {
    const refY = computeWindYield({ vMean, k, ratedKw, cutIn, ratedWind, cutOut, rotorDiameterM: rotorDurchmesserM });
    const kwNeeded = refY.annualMWh > 0 ? ratedKw * (zielJahresbedarfMWh / refY.annualMWh) : ratedKw;
    scenBedarf = scenario('Bedarfsgerecht (Liegenschaft)', diameterForKw(kwNeeded), kwNeeded, nabenhoheM);
  }

  // 3) Maximal möglich: Minimum aus Flächenlimit (Abstand zur Plangebietsgrenze,
  //    aus Faustregel-Multiplikator zurückgerechnet) und Marktobergrenze
  const kwFromMarkt = Math.min(marktMaxKw, kwForDiameter(marktMaxD));
  let kwMax = kwFromMarkt;
  let flaechenlimitiert = false;
  if (maxRadiusM > 0 && abstandMultiplikator > 0) {
    const dFromFlaeche  = maxRadiusM / abstandMultiplikator;
    const kwFromFlaeche = kwForDiameter(dFromFlaeche);
    if (kwFromFlaeche < kwMax) { kwMax = kwFromFlaeche; flaechenlimitiert = true; }
  }
  const scenMax = scenario('Maximal möglich', diameterForKw(kwMax), kwMax, nabenhoheM);
  scenMax.flaechenlimitiert = flaechenlimitiert;

  return { scen50, scenBedarf, scenMax, specWm2 };
}

// ── Synthetisches 8760h-Erzeugungsprofil ────────────────────────────────────
// Wind hat (anders als PV) keinen deterministischen Tagesgang — die Erzeugung wird
// über einen autokorrelierten Gauß-Prozess (AR(1), bildet mehrstündige Flauten/
// Windphasen nach) simuliert, dessen Quantile per Weibull-Verteilung in Windge-
// schwindigkeiten übersetzt werden ("Gaussian-Copula"-Technik). Eine monatliche
// Skalierung bildet die für Deutschland typische Winter/Sommer-Windsaisonalität ab.
// Das Ergebnis wird auf den analytisch erwarteten Jahresertrag (computeWindYield)
// normiert, damit Profil-Summe und angezeigter Jahresertrag konsistent bleiben.

// Deterministischer 32-bit-PRNG (mulberry32) — Profil bleibt über Reloads stabil,
// solange sich Asset-ID und Parameter nicht ändern.
function _mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _hashSeed(str) {
  let h = 0;
  const s = String(str ?? 'wind');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
// Standardnormal-CDF (Abramowitz-Stegun-Näherung)
function _stdNormalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}
function _gaussian(rng) {
  const u1 = Math.max(rng(), 1e-9), u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Monatliche Wind-Saisonalität Deutschland (Jan..Dez, ~normiert, höher im Winterhalbjahr)
const _WIND_MONTH_RAW = [1.20, 1.15, 1.10, 1.00, 0.85, 0.80, 0.80, 0.82, 0.90, 1.05, 1.15, 1.20];

export function makeWindProfile8760({
  vMean, k = 2, ratedKw, cutIn, ratedWind, cutOut,
  persistence = 0.85, seedStr = 'wind',
}) {
  const N = 8760;
  const result = new Float32Array(N);
  if (!(vMean > 0) || !(ratedKw > 0) || !(ratedWind > cutIn) || !(cutOut > ratedWind)) return result;

  // Stunden-gewichteter Mittelwert der Monatsfaktoren auf 1 normieren (Jahresmittel bleibt vMean)
  let wSum = 0, hSum = 0;
  for (let m = 0; m < 12; m++) { wSum += _WIND_MONTH_RAW[m] * GL_MONTH_HOURS[m]; hSum += GL_MONTH_HOURS[m]; }
  const norm = wSum / hSum;
  const monthFactor = _WIND_MONTH_RAW.map(f => f / norm);

  const rng = _mulberry32(_hashSeed(seedStr));
  let z = 0, ptr = 0;
  for (let m = 0; m < 12 && ptr < N; m++) {
    const Am = weibullScaleFromMean(vMean * monthFactor[m], k);
    for (let h = 0; h < GL_MONTH_HOURS[m] && ptr < N; h++, ptr++) {
      z = persistence * z + Math.sqrt(1 - persistence * persistence) * _gaussian(rng);
      const u = _stdNormalCdf(z);
      const v = Am * Math.pow(-Math.log(Math.max(1 - u, 1e-9)), 1 / k);
      result[ptr] = turbinePowerKw(v, { ratedKw, cutIn, ratedWind, cutOut });
    }
  }

  // Auf analytischen Jahresertrag normieren (Kappung auf Nennleistung, da nicht überschreitbar)
  const targetKWh = computeWindYield({ vMean, k, ratedKw, cutIn, ratedWind, cutOut, rotorDiameterM: 0 }).annualMWh * 1000;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += result[i];
  if (sum > 0 && targetKWh > 0) {
    const scale = targetKWh / sum;
    for (let i = 0; i < N; i++) result[i] = Math.min(ratedKw, result[i] * scale);
  }
  return result;
}

// ── Standort-Winddaten (Open-Meteo / ERA5-Reanalyse) ─────────────────────────
// Einmal pro Liegenschaft geladen (alle Anlagen teilen sich denselben Standortwind).
// Liefert Mittelwind + Weibull-k + standortspezifisches Hellmann-α (aus 10m/100m-Paar)
// sowie eine reale 8760h-Windreihe auf 100 m für die Profilerzeugung.
// ERA5 ist ein ~25-km-Raster-Reanalysemodell: gut fürs Screening, ersetzt kein
// Standortwindgutachten (lokale Effekte wie Waldkanten/Kuppen fehlen).
export const WIND_SITE = { data: null };

export function getWindSiteData() { return WIND_SITE.data; }

export async function fetchWindSiteData(lat, lng, nYears = 3) {
  const endYear   = new Date().getFullYear() - 1;             // letztes komplettes Jahr
  const startYear = endYear - Math.min(5, Math.max(1, nYears)) + 1;
  const url = 'https://archive-api.open-meteo.com/v1/archive'
    + `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + `&start_date=${startYear}-01-01&end_date=${endYear}-12-31`
    + `&hourly=wind_speed_10m,wind_speed_100m&wind_speed_unit=ms&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const d    = await res.json();
  const time = d.hourly?.time            || [];
  const v10  = d.hourly?.wind_speed_10m  || [];
  const v100 = d.hourly?.wind_speed_100m || [];

  let s100 = 0, s10 = 0, sq = 0, n = 0;
  for (let i = 0; i < v100.length; i++) {
    const a = v100[i], b = v10[i];
    if (a == null || b == null) continue;
    s100 += a; s10 += b; sq += a * a; n++;
  }
  if (n < 8000) throw new Error(`Zu wenige Datenpunkte (${n})`);

  const vMean100 = s100 / n;
  const vMean10  = s10 / n;
  const sd       = Math.sqrt(Math.max(0, sq / n - vMean100 * vMean100));
  // Weibull-Formfaktor per Momentenmethode; Hellmann-α aus dem 10m/100m-Mittelwert-Paar
  const weibullK = Math.min(4, Math.max(1.2, Math.pow(sd / vMean100, -1.086)));
  const alpha    = Math.min(0.45, Math.max(0.10, Math.log(vMean100 / Math.max(vMean10, 0.1)) / Math.log(10)));

  // Reale Stundenreihe (100 m) des letzten kompletten Jahres — 29. Februar wird
  // verworfen, damit die Reihe exakt 8.760 Werte hat (Konvention aller Profile im Tool).
  const stunden100 = new Float32Array(8760);
  const yearPrefix = String(endYear), skipPrefix = `${endYear}-02-29`;
  let ptr = 0;
  for (let i = 0; i < time.length && ptr < 8760; i++) {
    const ts = time[i];
    if (!ts.startsWith(yearPrefix) || ts.startsWith(skipPrefix)) continue;
    stunden100[ptr++] = v100[i] ?? 0;
  }

  WIND_SITE.data = {
    lat, lng, startYear, endYear, profilJahr: endYear,
    vMean100, vMean10, weibullK, alpha, stunden100,
    geladen: new Date().toISOString(),
  };
  return WIND_SITE.data;
}

// Mittelwind auf beliebiger Nabenhöhe aus den Standortdaten (Hellmann ab 100-m-Referenz)
export function windSiteVAtHeight(hubM) {
  const s = WIND_SITE.data;
  if (!s || !(hubM > 0)) return null;
  return s.vMean100 * Math.pow(hubM / 100, s.alpha);
}

// Projekt-Persistierung (Aufruf über window-Bridge aus 03c-gebaeude-io.js).
// Stundenwerte auf 2 Nachkommastellen gerundet — halbiert die JSON-Größe (~60 KB).
export function windSiteSerialize() {
  const s = WIND_SITE.data;
  if (!s) return null;
  return { ...s, stunden100: Array.from(s.stunden100, v => Math.round(v * 100) / 100) };
}
export function windSiteRestore(obj) {
  if (!obj || !Array.isArray(obj.stunden100) || obj.stunden100.length !== 8760) {
    WIND_SITE.data = null;
    return;
  }
  WIND_SITE.data = { ...obj, stunden100: Float32Array.from(obj.stunden100) };
}

// ── Kanonisches Erzeugungsprofil je Anlage ───────────────────────────────────
// Einzige Quelle der Wahrheit für alle Analysen (Inspector-Chart, NAP-, PV-,
// Knotenpunkt-Analyse): reale ERA5-Stundenreihe wenn Standortdaten geladen sind
// (auf Nabenhöhe extrapoliert, durch die Leistungskurve geschickt), sonst das
// synthetische Weibull-Profil. Defaults identisch mit dem Inspector-Formular.
export function windProfileForAsset(asset) {
  const p = asset.props || {};
  const curve = {
    ratedKw:   parseFloat(p.leistungKW)      || 500,
    cutIn:     parseFloat(p.einschaltwindMs) || 3,
    ratedWind: parseFloat(p.nennwindMs)      || 12,
    cutOut:    parseFloat(p.abschaltwindMs)  || 25,
  };
  const site = WIND_SITE.data;
  if (site?.stunden100?.length === 8760) {
    const hubM = parseFloat(p.nabenhoheM) || 100;
    const f    = Math.pow(hubM / 100, site.alpha);
    const out  = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) out[t] = turbinePowerKw(site.stunden100[t] * f, curve);
    return out;
  }
  return makeWindProfile8760({
    vMean: parseFloat(p.mittlereWindMs) || 6.0,
    k:     parseFloat(p.weibullK)       || 2,
    ...curve,
    seedStr: asset.id,
  });
}

// ── Aggregiertes Windkraft-Erzeugungsprofil über alle aktiven Anlagen ───────
// Analog zu window._bhkwElHourly — Summe für Netz-/Speicher-/PV-Analyse-Betrachtungen.
export function computeWindElHourly() {
  const out = new Float32Array(8760);
  let any = false;
  for (const a of (ASSETS.items || [])) {
    if (a.type !== 'Wind') continue;
    if (getAssetStatus(a, globalYear) !== 'active') continue;
    const profile = windProfileForAsset(a);
    for (let t = 0; t < 8760; t++) out[t] += profile[t];
    any = true;
  }
  return any ? out : null;
}

// Kennzahlen für Anzeige (Anzahl aktiver Anlagen, installierte Leistung, Jahressumme).
export function getWindAssetsSummary() {
  const items = (ASSETS.items || []).filter(a => a.type === 'Wind' && getAssetStatus(a, globalYear) === 'active');
  const kw = items.reduce((s, a) => s + (parseFloat(a.props?.leistungKW) || 500), 0);
  const arr = computeWindElHourly();
  let mwh = 0;
  if (arr) { for (let i = 0; i < arr.length; i++) mwh += arr[i]; mwh /= 1000; }
  return { count: items.length, kw, mwh };
}

// Window-Bridge für Projekt-Speichern/-Laden (03c-gebaeude-io.js) — dort kein
// ESM-Import auf dieses Modul, gleiches Muster wie napGetEndausbauLastgang u.a.
setTimeout(() => {
  window.windSiteSerialize = windSiteSerialize;
  window.windSiteRestore   = windSiteRestore;
  window.getWindSiteData   = getWindSiteData;
}, 0);
