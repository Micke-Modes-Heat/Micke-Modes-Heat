// ── lib/lastgang-kennwerte.js — Kennwerte eines stündlichen Lastgangs (DOM-frei) ──
// Für die Quartier-Sonde und andere Teil-Lastgänge: Jahresmenge, Spitze, Vollbenutzungsstunden,
// Monatswerte, Dauerlinie und mittlere Tagesgänge.

export const MONAT_START_H = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];

/** Grundkennwerte: MWh/a, Spitze kW (und Stunde), Vollbenutzungsstunden, Sommer-Grundlast. */
export function lastgangKennwerte(kw) {
  const n = kw?.length || 0;
  let summe = 0, spitze = 0, spitzeH = 0;
  for (let i = 0; i < n; i++) { const v = kw[i] || 0; summe += v; if (v > spitze) { spitze = v; spitzeH = i; } }
  // Sommer-Grundlast: Mittel Juni–August
  let s = 0, z = 0;
  for (let i = MONAT_START_H[5]; i < Math.min(n, MONAT_START_H[8]); i++) { s += kw[i] || 0; z++; }
  return { mwh: summe / 1000, spitzeKw: spitze, spitzeStunde: spitzeH, vbh: spitze > 0 ? summe / spitze : 0, sommerKw: z ? s / z : 0 };
}

/** Monatswerte in MWh. */
export function lastgangMonate(kw) {
  const out = new Array(12).fill(0);
  for (let m = 0; m < 12; m++) for (let i = MONAT_START_H[m]; i < Math.min(kw.length, MONAT_START_H[m + 1]); i++) out[m] += (kw[i] || 0) / 1000;
  return out;
}

/** Jahresdauerlinie (absteigend sortiert). */
export function dauerlinie(kw) {
  return Float32Array.from(kw).sort((a, b) => b - a);
}

/**
 * Mittlerer Tagesgang (24 Werte, kW) für die angegebenen Monate (0–11), getrennt nach Werktag/Wochenende.
 * @param {number} jahr für den Wochentag des 1. Januars
 */
export function typtag(kw, monate, jahr, wochenende = false) {
  const ersterTag = new Date(Date.UTC(Number(jahr) || 2026, 0, 1)).getUTCDay();
  const summe = new Array(24).fill(0), anzahl = new Array(24).fill(0);
  for (const m of monate) {
    for (let i = MONAT_START_H[m]; i < Math.min(kw.length, MONAT_START_H[m + 1]); i++) {
      const tag = Math.floor(i / 24), wt = (ersterTag + tag) % 7;
      const istWe = wt === 0 || wt === 6;
      if (istWe !== wochenende) continue;
      summe[i % 24] += kw[i] || 0; anzahl[i % 24]++;
    }
  }
  return summe.map((s, h) => (anzahl[h] ? s / anzahl[h] : 0));
}

/** Gleichzeitigkeit: Spitze des Summenlastgangs / Summe der Einzelspitzen (bzw. Heizlasten). */
export function gleichzeitigkeit(spitzeSummeKw, summeEinzelKw) {
  return summeEinzelKw > 0 ? Math.min(1, spitzeSummeKw / summeEinzelKw) : null;
}
