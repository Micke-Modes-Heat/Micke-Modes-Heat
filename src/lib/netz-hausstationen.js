// ── lib/netz-hausstationen.js — Investition der Hausübergabestationen (DOM-frei) ──
// Staffelung je Station nach der Anschlussleistung (Normheizlast des Gebäudes), Richtwerte 2024:
// < 30 kW 5.000 €, < 100 kW 8.000 €, < 300 kW 12.000 €, ab 300 kW 15.000 €.

/** Investition einer Hausübergabestation in € für die Anschlussleistung kw. */
export function huestEurJeStation(kw) {
  return kw < 30 ? 5000 : kw < 100 ? 8000 : kw < 300 ? 12000 : 15000;
}

/** Investition aller Hausübergabestationen in € (Liste der Anschlussleistungen in kW, je Gebäude). */
export function huestInvestEur(anschlussKw) {
  return (anschlussKw || []).reduce((s, kw) => s + (kw > 0 ? huestEurJeStation(kw) : 0), 0);
}
