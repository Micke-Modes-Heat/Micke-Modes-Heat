// ── lib/elektro-formeln.js — Gemeinsame elektrische Berechnungsfunktionen ────
// Genutzt von: 05b-stromnetz.js, 13g-ms-ring.js

/**
 * Drehstrom-Strom aus Wirkleistung.
 * I = P / (√3 · U · cosφ)
 * @param {number} kW      Wirkleistung [kW]
 * @param {number} U_V     Nennspannung [V]
 * @param {number} cosPhi  Leistungsfaktor
 * @returns {number}       Strom [A]
 */
export function calcStrom(kW, U_V, cosPhi) {
  return (kW * 1000) / (Math.sqrt(3) * U_V * cosPhi);
}

/**
 * Relativer Spannungsfall nach DIN VDE 0276.
 * ΔU% = √3 · I · L · (R·cosφ + X·sinφ) / U × 100
 * @param {number} I_A      Strom [A]
 * @param {number} lenM     Leitungslänge [m]
 * @param {number} R_Ohm_m  Widerstandsbelag bei Betriebstemperatur [Ω/m]
 * @param {number} X_Ohm_m  Reaktanzbelag [Ω/m]
 * @param {number} U_V      Nennspannung [V]
 * @param {number} cosPhi   Leistungsfaktor
 * @returns {number}        ΔU [%]
 */
export function calcSpannungsfall(I_A, lenM, R_Ohm_m, X_Ohm_m, U_V, cosPhi) {
  const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
  return (Math.sqrt(3) * I_A * lenM * (R_Ohm_m * cosPhi + X_Ohm_m * sinPhi) / U_V) * 100;
}

/**
 * Widerstandsbelag bei Betriebstemperatur nach IEC 60228.
 * ρ(T) = ρ(20°C) · (1 + α · (T − 20))
 * @param {number} rho20   Spez. Widerstand bei 20 °C [Ω·mm²/m]
 * @param {number} alphaK  Temperaturkoeffizient [1/K]
 * @param {number} tLeiter Leitertemperatur [°C]
 * @returns {number}       Korrigierter spez. Widerstand [Ω·mm²/m]
 */
export function calcRhoKorr(rho20, alphaK, tLeiter) {
  return rho20 * (1 + alphaK * (tLeiter - 20));
}

// ── Gleichzeitigkeitsfaktor ──────────────────────────────────────────────────

const _GZF_DIN = [
  [1, 1.00], [2, 0.80], [3, 0.73], [4, 0.69], [5, 0.66],
  [6, 0.64], [7, 0.62], [8, 0.61], [9, 0.60], [10, 0.58],
  [15, 0.52], [20, 0.47], [30, 0.43], [50, 0.40], [100, 0.37], [200, 0.35],
];

/**
 * Gleichzeitigkeitsfaktor nach DIN 18015-1 (lineare Interpolation).
 * @param {number} n  Anzahl Verbraucher
 * @returns {number}  GZF ∈ (0, 1]
 */
export function gzfDIN18015(n) {
  if (n <= 1) return 1.0;
  for (let i = 0; i < _GZF_DIN.length - 1; i++) {
    if (n <= _GZF_DIN[i + 1][0]) {
      const t = (n - _GZF_DIN[i][0]) / (_GZF_DIN[i + 1][0] - _GZF_DIN[i][0]);
      return _GZF_DIN[i][1] + t * (_GZF_DIN[i + 1][1] - _GZF_DIN[i][1]);
    }
  }
  return _GZF_DIN[_GZF_DIN.length - 1][1];
}

/**
 * Gleichzeitigkeitsfaktor nach VDE-Potenzgesetz (g(n) = 1/n^0.4).
 * @param {number} n  Anzahl Verbraucher
 * @returns {number}  GZF ∈ [0.2, 1]
 */
export function gzfVDE(n) {
  if (n <= 1) return 1.0;
  return Math.max(0.2, 1.0 / Math.pow(n, 0.4));
}
