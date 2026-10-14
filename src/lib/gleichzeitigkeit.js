// ── lib/gleichzeitigkeit.js — Gleichzeitigkeitsfaktor für Wärmenetze (DOM-frei) ──
// Formel nach Winter, Haslauer, Obernberger (2001), in der Fernwärmepraxis (AGFW) üblich:
//   GLF(n) = a + b / (1 + (n / c)^d),  a = 0,449677646, b = 0,551234688, c = 53,84382392, d = 1,762743268
// n = Anzahl der versorgten Abnehmer. GLF(1) ≈ 1, für große n → 0,45.

const A = 0.449677646, B = 0.551234688, C = 53.84382392, D = 1.762743268;

/** Gleichzeitigkeitsfaktor für n Abnehmer (1 bei n ≤ 1). */
export function glfWinter(n) {
  const k = Number(n) || 0;
  if (k <= 1) return 1;
  return Math.min(1, A + B / (1 + Math.pow(k / C, D)));
}
