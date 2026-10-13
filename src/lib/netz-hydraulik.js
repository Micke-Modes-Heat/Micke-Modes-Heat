// ── lib/netz-hydraulik.js — Rohrhydraulik und Netzpumpe des Wärmenetzes (DOM-frei) ──
// Gemeinsame Rechnung für Netzberechnung, Netzoptimierung, Einfärbung, Verbindungsleitungen und Pumpenstrom.

/**
 * Stahl-Mediumrohre von Kunststoffmantelrohren (KMR): Außendurchmesser nach DIN EN 253 und Wanddicke der
 * Standardreihe der Hersteller (nicht kleiner als die Mindestwanddicke nach DIN EN 253), je DN [da mm, s mm].
 * Die Nennweite ist nur eine Kennzahl: Der Innendurchmesser liegt bei kleinen Nennweiten über der Nennweite
 * (DN 25: 27,3 mm, DN 50: 53,9 mm, DN 100: 107,1 mm), ab DN 350 darunter (DN 500: 495,4 mm).
 */
export const KMR_STAHLROHR = Object.freeze({
  15: [21.3, 2.6], 20: [26.9, 2.6], 25: [33.7, 3.2], 32: [42.4, 3.2], 40: [48.3, 3.2], 50: [60.3, 3.2],
  65: [76.1, 3.2], 80: [88.9, 3.2], 100: [114.3, 3.6], 125: [139.7, 3.6], 150: [168.3, 4.0], 200: [219.1, 4.5],
  250: [273.0, 5.0], 300: [323.9, 5.6], 350: [355.6, 5.6], 400: [406.4, 6.3], 450: [457.0, 6.3], 500: [508.0, 6.3],
  600: [610.0, 7.1], 700: [711.0, 8.0], 800: [813.0, 8.8],
});

/** Innendurchmesser in m; Nennweiten außerhalb der Tabelle: DN als Näherung. */
export function rohrInnenM(dn) {
  const r = KMR_STAHLROHR[Number(dn)];
  return r ? (r[0] - 2 * r[1]) / 1000 : (Number(dn) || 0) / 1000;
}

/** Freier Querschnitt in m². */
export function rohrQuerschnittM2(dn) {
  const d = rohrInnenM(dn);
  return Math.PI * d * d / 4;
}

export const CP_WASSER = 4.184;        // kJ/(kg·K)
export const ROHR_RAUIGKEIT_M = 0.00005; // Stahl, betriebsbedingt (0,05 mm)
const G = 9.81;

/**
 * Stoffwerte von Wasser bei tC (°C, 0–150): Dichte nach Thiesen (kg/m³), dynamische Viskosität nach Vogel (Pa·s),
 * kinematische Viskosität (m²/s). 70 °C: 977,8 kg/m³ und 4,10·10⁻⁷ m²/s; 40 °C: 992,2 kg/m³ und 6,57·10⁻⁷ m²/s.
 */
export function wasserStoffwerte(tC) {
  const t = Math.max(0, Math.min(150, Number.isFinite(tC) ? tC : 70));
  const rho = 1000 * (1 - (t + 288.9414) / (508929.2 * (t + 68.12963)) * (t - 3.9863) ** 2);
  const eta = 2.414e-5 * 10 ** (247.8 / (t + 273.15 - 140));
  return { rho, eta, nu: eta / rho, t };
}

/**
 * Hydraulik einer Leitung (je Rohr): Massenstrom kg/s, Nennweite → Geschwindigkeit m/s, Druckgefälle Pa/m
 * (Darcy-Weisbach, Reibungszahl laminar 64/Re, turbulent nach Swamee-Jain).
 */
export function rohrHydraulik(massenstromKgS, dn, stoff = wasserStoffwerte(70), rauigkeitM = ROHR_RAUIGKEIT_M) {
  const d = rohrInnenM(dn);
  const flaeche = Math.PI * d * d / 4;
  if (!(d > 0) || !(massenstromKgS > 0)) return { velocity: 0, dpPerM: 0, reynolds: 0, lambda: 0, dInnen: d };
  const velocity = massenstromKgS / stoff.rho / flaeche;
  const reynolds = velocity * d / stoff.nu;
  const lambda = reynolds < 2300
    ? 64 / Math.max(reynolds, 100)
    : 0.25 / Math.log10(rauigkeitM / (3.7 * d) + 5.74 / reynolds ** 0.9) ** 2;
  return { velocity, dpPerM: lambda * stoff.rho * velocity * velocity / (2 * d), reynolds, lambda, dInnen: d };
}

/** Massenstrom kg/s aus Leistung kW und Spreizung K. */
export function massenstromKgS(lastKw, spreizungK) {
  return Math.max(0, lastKw) / (CP_WASSER * Math.max(1, spreizungK));
}

/** Übertragbare Leistung kW einer Nennweite bei Geschwindigkeit v (m/s) und Spreizung. */
export function rohrLeistungKw(dn, vMs, spreizungK, stoff = wasserStoffwerte(70)) {
  return rohrQuerschnittM2(dn) * vMs * stoff.rho * CP_WASSER * Math.max(1, spreizungK);
}

/** Förderhöhe in m aus Druck in Pa (H = Δp / (ρ·g)). */
export function foerderhoeheM(dpPa, stoff = wasserStoffwerte(70)) {
  return dpPa / (stoff.rho * G);
}

// Gesamtwirkungsgrad Netzpumpe (Motor × Hydraulik) über der hydraulischen Leistung, Hocheffizienzpumpen
// (Datenblattwerte üblicher Baureihen); stetig zwischen den Stützstellen (log. Leistungsachse).
const ETA_PUMPE = [[0.05, 0.25], [0.3, 0.40], [1, 0.55], [5, 0.65], [25, 0.73], [100, 0.78], [400, 0.82]];
export function pumpenWirkungsgrad(pHydKw) {
  const p = Math.max(1e-6, pHydKw);
  if (p <= ETA_PUMPE[0][0]) return ETA_PUMPE[0][1];
  for (let i = 1; i < ETA_PUMPE.length; i++) {
    const [p1, e1] = ETA_PUMPE[i];
    if (p <= p1) {
      const [p0, e0] = ETA_PUMPE[i - 1];
      return e0 + (e1 - e0) * (Math.log(p / p0) / Math.log(p1 / p0));
    }
  }
  return ETA_PUMPE[ETA_PUMPE.length - 1][1];
}

/** Netzpumpe: Volumenstrom aus Massenstrom, elektrische Leistung P = V̇·Δp/η. */
export function netzPumpe(massenstrom, dpPa, stoff = wasserStoffwerte(70)) {
  const vDot = Math.max(0, massenstrom) / stoff.rho;          // m³/s
  const pHydKw = vDot * Math.max(0, dpPa) / 1000;
  const eta = pumpenWirkungsgrad(pHydKw);
  return { vDotM3s: vDot, pHydKw, eta, pKw: pHydKw > 0 ? pHydKw / eta : 0, foerderhoeheM: foerderhoeheM(dpPa, stoff) };
}

/**
 * Äquivalente Volllaststunden der drehzahlgeregelten Netzpumpe aus dem Lastgang: Proportionalitätsgesetz
 * P ~ V̇³ ~ (Last/Auslegungslast)³, mindestens 10 % der Auslegungsleistung, solange das Netz läuft.
 * refKw = Last, für die die Pumpe ausgelegt ist (nie unter der Spitze des Lastgangs).
 */
export function pumpenVolllaststunden(lastgangKw, refKw = 0) {
  if (!lastgangKw?.length) return 0;
  let max = 0;
  for (let i = 0; i < lastgangKw.length; i++) if (lastgangKw[i] > max) max = lastgangKw[i];
  const ref = Math.max(max, Number(refKw) || 0);
  if (!(ref > 0)) return 0;
  let h = 0;
  for (let i = 0; i < lastgangKw.length; i++) { const x = lastgangKw[i] / ref; if (x > 0) h += Math.max(0.1, x * x * x); }
  return h;
}
