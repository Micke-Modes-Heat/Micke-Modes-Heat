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

// ── Iz-Korrekturfaktoren (IEC 60364-5-52) ───────────────────────────────────

/**
 * Temperaturgangkorrekturfaktor für Kabel-Iz.
 * Gilt für PVC-isolierte Kabel (tMax = 70 °C), Referenz 20 °C Bodentemperatur.
 * kT = √((tMax − tBoden) / (tMax − tRef))
 */
export function calcKizTemp(tBoden, tMax = 70, tRef = 20) {
  return Math.sqrt(Math.max(0, (tMax - tBoden) / (tMax - tRef)));
}

/** Häufungsfaktor für gebündelt verlegte Kabel (IEC 60364-5-52 Tabelle B.52.17). */
const _KG_TAB = [
  [1,1.00],[2,0.80],[3,0.70],[4,0.65],[5,0.60],
  [6,0.57],[7,0.54],[8,0.52],[9,0.50],[12,0.45],[16,0.41],[20,0.38],
];
export function calcKizGruppe(nKabel) {
  if (nKabel <= 1) return 1.0;
  for (let i = 0; i < _KG_TAB.length - 1; i++) {
    if (nKabel <= _KG_TAB[i + 1][0]) {
      const t = (nKabel - _KG_TAB[i][0]) / (_KG_TAB[i + 1][0] - _KG_TAB[i][0]);
      return _KG_TAB[i][1] + t * (_KG_TAB[i + 1][1] - _KG_TAB[i][1]);
    }
  }
  return _KG_TAB[_KG_TAB.length - 1][1];
}

/** Verlegeartfaktor relativ zur Referenz Erdverlegung direkt (D1). */
export const KIZ_VERLEGEART = { erde: 1.00, kanal: 0.87, luft: 1.20, rohr: 0.77 };

// ── Kurzschluss-Strom (IEC 60909) ───────────────────────────────────────────

/**
 * Anfangs-Kurzschlusswechselstrom Ik'' nach IEC 60909.
 * Ik'' = c · U / (√3 · |Zk|)
 * @param {number} U_V      Nennspannung [V]
 * @param {number} R_Ohm    Gesamtwiderstand NAP→Fehlerstelle [Ω]
 * @param {number} X_Ohm    Gesamtreaktanz [Ω]
 * @param {number} cFactor  Spannungsfaktor (1.05 = max, 0.95 = min, IEC 60909)
 * @returns {number}        Ik'' [A]
 */
export function calcIk(U_V, R_Ohm, X_Ohm, cFactor = 1.05) {
  const Zk = Math.sqrt(R_Ohm ** 2 + X_Ohm ** 2);
  if (Zk < 1e-9) return Infinity;
  return (cFactor * U_V) / (Math.sqrt(3) * Zk);
}

/**
 * Transformator-Kurzschlussimpedanz (NS-seitig) aus Leerlaufversuch-Daten.
 * uk_R ≈ 20 % von uk für Verteiltrafos (typisch uk_R = 0.8–1.2 %).
 * @param {number} ukPct   Kurzschlussspannung [%]
 * @param {number} Sn_kVA  Nennleistung [kVA]
 * @param {number} Un_V    Nennspannung NS-seitig [V]
 * @returns {{ R: number, X: number }}  Widerstands- und Reaktanzanteil [Ω]
 */
export function calcTrafoImpedanz(ukPct, Sn_kVA, Un_V) {
  const Zt  = (ukPct / 100) * (Un_V * Un_V) / (Sn_kVA * 1000);
  const Zt_R = Zt * 0.2;
  const Zt_X = Math.sqrt(Math.max(0, Zt * Zt - Zt_R * Zt_R));
  return { R: Zt_R, X: Zt_X };
}
