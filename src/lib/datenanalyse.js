// ── lib/datenanalyse.js — Rechenbausteine der Datenanalyse (DOM-frei): Zeitachse, Aggregation, Statistik, Farben ──
// Stundenreihen haben 8760 Werte (Jahr ohne Schalttag, Stunde 0 = 1. Januar 0–1 Uhr).

export const MONATS_START_H = Object.freeze([0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760]);
export const MONATE = Object.freeze(['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']);
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Monat (0–11) der Jahresstunde t. */
export function monatAusStunde(t) {
  let m = 0;
  while (m < 11 && t >= MONATS_START_H[m + 1]) m++;
  return m;
}

/** Datum und Uhrzeit der Jahresstunde t als Text, z. B. „Mo 15.01. 08:00“ (Jahr beginnt montags). */
export function stundeAlsText(t, mitWochentag = true) {
  const h = Math.max(0, Math.min(8759, Math.floor(t)));
  const m = monatAusStunde(h);
  const tagImMonat = Math.floor((h - MONATS_START_H[m]) / 24) + 1;
  const uhr = String(h % 24).padStart(2, '0') + ':00';
  const wt = WOCHENTAGE[Math.floor(h / 24) % 7];
  return `${mitWochentag ? wt + ' ' : ''}${String(tagImMonat).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}. ${uhr}`;
}

/**
 * Werte einer Reihe im Zeitfenster [a, b) zu Pixel- bzw. Zeitklassen zusammenfassen: je Klasse Mittel, Minimum,
 * Maximum und Anzahl der gültigen Werte (maske[i] = 0 und nicht endliche Werte zählen nicht).
 */
export function klassieren(werte, a, b, klassen, maske = null) {
  const n = Math.max(1, Math.floor(klassen));
  const mittel = new Float64Array(n), min = new Float64Array(n).fill(Infinity), max = new Float64Array(n).fill(-Infinity);
  const anzahl = new Uint32Array(n);
  const breite = Math.max(1e-9, (b - a) / n);
  for (let t = Math.max(0, Math.floor(a)); t < Math.min(werte.length, Math.ceil(b)); t++) {
    const v = werte[t];
    if (!Number.isFinite(v) || (maske && !maske[t])) continue;
    const k = Math.min(n - 1, Math.floor((t - a) / breite));
    mittel[k] += v; anzahl[k]++;
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  for (let k = 0; k < n; k++) mittel[k] = anzahl[k] ? mittel[k] / anzahl[k] : NaN;
  return { mittel, min, max, anzahl };
}

/** Summe je Monat (z. B. kWh) über gültige Stunden. */
export function monatsSummen(werte, maske = null) {
  const s = new Float64Array(12);
  for (let t = 0; t < Math.min(8760, werte.length); t++) if (Number.isFinite(werte[t]) && (!maske || maske[t])) s[monatAusStunde(t)] += werte[t];
  return s;
}

/** Absteigend sortierte gültige Werte (Dauerlinie). */
export function dauerlinie(werte, maske = null) {
  const out = [];
  for (let t = 0; t < werte.length; t++) if (Number.isFinite(werte[t]) && (!maske || maske[t])) out.push(werte[t]);
  return Float64Array.from(out).sort().reverse();
}

/** Kennzahlen gültiger Werte: Anzahl, Summe, Mittel, Minimum, Maximum. */
export function statistik(werte, maske = null) {
  let n = 0, summe = 0, min = Infinity, max = -Infinity;
  for (let t = 0; t < werte.length; t++) {
    const v = werte[t];
    if (!Number.isFinite(v) || (maske && !maske[t])) continue;
    n++; summe += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { n, summe, mittel: n ? summe / n : NaN, min: n ? min : NaN, max: n ? max : NaN };
}

/** Quotient zweier Reihen je Stunde (z. B. COP = Wärme/Strom); NaN, wo der Nenner ≤ minNenner ist. */
export function quotient(zaehler, nenner, minNenner = 0.5) {
  const out = new Float32Array(zaehler.length);
  for (let t = 0; t < out.length; t++) out[t] = nenner[t] > minNenner ? zaehler[t] / nenner[t] : NaN;
  return out;
}

/** Glatter Farbverlauf (blau → türkis → grün → gelb → rot) für den Anteil u ∈ [0, 1], als 'rgb(r,g,b)'. */
export function farbeSkala(u) {
  const stuetz = [[49, 54, 149], [69, 117, 180], [116, 173, 209], [171, 217, 233], [254, 224, 144], [253, 174, 97], [244, 109, 67], [215, 48, 39]];
  const x = Math.max(0, Math.min(1, Number.isFinite(u) ? u : 0)) * (stuetz.length - 1);
  const i = Math.min(stuetz.length - 2, Math.floor(x)), f = x - i;
  const c = stuetz[i].map((v, k) => Math.round(v + (stuetz[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Runde Achsenschritte für den Bereich [lo, hi] (etwa ziel Schritte). */
export function achsenTicks(lo, hi, ziel = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
  const roh = (hi - lo) / ziel, p = Math.pow(10, Math.floor(Math.log10(roh)));
  const schritt = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= roh) || 10 * p;
  const out = [];
  for (let v = Math.ceil(lo / schritt) * schritt; v <= hi + 1e-9; v += schritt) out.push(Math.round(v / schritt) * schritt);
  return out;
}
