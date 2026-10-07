// ── lib/vdi-bedien.js — Bedienaufwand von Erzeugern nach Anlagengröße ──
// DOM-frei. VDI 2067 nennt feste Stunden für typische Anlagengrößen (Kessel ~20 h/a, Wärmepumpe ~5 h/a). Für große
// Zentralen (mehrere MW) wäre das viel zu wenig; der Aufwand wächst mit der Leistung, aber unterproportional.
// Annahme: Richtwert gilt bis 100 kW, darüber × (P / 100 kW)^0,6 (z. B. 1 MW ×4, 10 MW ×16).

export const BEDIEN_REF_KW = 100;
export const BEDIEN_EXPONENT = 0.6;

/** Bedienstunden pro Jahr für einen Erzeuger mit Richtwert basisH (h/a) und Leistung kw. */
export function bedienStunden(basisH, kw) {
  return Math.round(basisH * Math.max(1, Math.pow((Number(kw) || 0) / BEDIEN_REF_KW, BEDIEN_EXPONENT)));
}
