// ── lib/elektro-kosten.js — Gutachten 3.5: Investitionen und Jahreskosten der Elektro-Maßnahmen ──
// DOM- und importfrei. Jahreskosten nach VDI 2067 (vereinfacht): Investition × (Annuitätsfaktor aus
// Kalkulationszins und Nutzungsdauer + Instandhaltungssatz). Die Kennwerte sind Vorschlagswerte; sie
// werden im Gutachten-Reiter angepasst (17, gespeichert mit den Figur-Einstellungen der Kostentabelle).

export const EK_GRUPPEN = [
  { key: 'netzanschluss', label: 'Netzanschluss' },
  { key: 'netz',          label: 'Internes Stromnetz' },
  { key: 'pv',            label: 'PV und Batteriespeicher' },
  { key: 'notstrom',      label: 'Notstromversorgung' },
  { key: 'lade',          label: 'Ladeinfrastruktur' },
];

/** Arten mit eigener Nutzungsdauer/Instandhaltung (PV bringt ihre Jahreskosten aus der PV-Analyse mit). */
export const EK_ARTEN = [
  { key: 'netzanschluss', label: 'Netzanschluss' },
  { key: 'kabel',         label: 'Kabel' },
  { key: 'trafo',         label: 'Trafo' },
  { key: 'notstrom',      label: 'Notstromaggregat' },
  { key: 'lade',          label: 'Ladepunkte' },
];

/** Vorschlagswerte — durch Angebote des Netzbetreibers bzw. die Kostenschätzung der Fachplanung ersetzen. */
export const EK_VORGABEN = Object.freeze({
  zinsPct: 3.5,
  bkzEurKw: 100,               // Baukostenzuschuss je kW zusätzlicher Anschlussleistung
  anschlussPauschalEur: 0,     // Netzanschlusskosten des Netzbetreibers, pauschal
  ladepunktEur: 2500,          // Normalladepunkt (AC) inkl. Installation
  schnellladepunktEur: 60000,  // Schnellladepunkt (DC) inkl. Installation
  nutzungsdauer:     Object.freeze({ netzanschluss: 40, kabel: 40, trafo: 30, notstrom: 20, lade: 10 }),
  instandhaltungPct: Object.freeze({ netzanschluss: 0, kabel: 0.5, trafo: 0.5, notstrom: 1.5, lade: 2 }),
});

function zahl(x, vorgabe, min = 0, max = Infinity) {
  if (x == null || x === '') return vorgabe;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? n : vorgabe;
}

/** Gespeicherte bzw. eingegebene Kennwerte prüfen; fehlende oder unplausible Werte fallen auf die Vorgabe zurück. */
export function ekNormKennwerte(k) {
  const q = k && typeof k === 'object' ? k : {};
  const v = EK_VORGABEN;
  const je = (quelle, vorgabe, min, max) =>
    Object.fromEntries(Object.entries(vorgabe).map(([key, d]) => [key, zahl(quelle?.[key], d, min, max)]));
  return {
    zinsPct:              zahl(q.zinsPct, v.zinsPct, 0, 20),
    bkzEurKw:             zahl(q.bkzEurKw, v.bkzEurKw),
    anschlussPauschalEur: zahl(q.anschlussPauschalEur, v.anschlussPauschalEur),
    ladepunktEur:         zahl(q.ladepunktEur, v.ladepunktEur),
    schnellladepunktEur:  zahl(q.schnellladepunktEur, v.schnellladepunktEur),
    nutzungsdauer:        je(q.nutzungsdauer, v.nutzungsdauer, 1, 100),
    instandhaltungPct:    je(q.instandhaltungPct, v.instandhaltungPct, 0, 20),
  };
}

/** Annuitätsfaktor a = i·(1+i)^n / ((1+i)^n − 1); bei 0 % Zins 1/n. */
export function ekAnnuitaetsfaktor(zinsPct, jahre) {
  const i = (Number(zinsPct) || 0) / 100;
  const n = Math.max(1, Number(jahre) || 1);
  return i > 0 ? i * (1 + i) ** n / ((1 + i) ** n - 1) : 1 / n;
}

/** Jahreskosten einer Investition: Kapitaldienst (Annuität) + Instandhaltung. */
export function ekJahreskosten(investEur, zinsPct, jahre, instandhaltungPct = 0) {
  return (Number(investEur) || 0) * (ekAnnuitaetsfaktor(zinsPct, jahre) + (Number(instandhaltungPct) || 0) / 100);
}

const summe = werte => werte.reduce((a, v) => a + (Number(v) || 0), 0);

/**
 * Positionen [{ gruppe, art, label, umfang, investEur, jahr?, jahreskostenEur?, nutzungsdauer? }] auswerten.
 * `art` wählt Nutzungsdauer und Instandhaltung aus den Kennwerten, sofern die Position ihre Jahreskosten nicht
 * selbst mitbringt (PV aus der PV-Analyse). Positionen ohne Investition fallen weg.
 * Rückgabe: { kennwerte, positionen, gruppen[], summeInvestEur, summeJahreskostenEur, jahresreihe[], ohneJahrEur }
 */
export function ekAuswertung(positionen, kennwerte) {
  const k = ekNormKennwerte(kennwerte);
  const pos = (positionen || []).filter(p => p && Number(p.investEur) > 0).map(p => {
    const nd = Number(p.nutzungsdauer) || k.nutzungsdauer[p.art] || 20;
    const ih = k.instandhaltungPct[p.art] ?? 0;
    const jahr = Number.isFinite(Number(p.jahr)) && p.jahr !== null && p.jahr !== '' ? Number(p.jahr) : null;
    return {
      ...p, jahr, nutzungsdauer: nd,
      jahreskostenEur: Number.isFinite(p.jahreskostenEur) ? p.jahreskostenEur : ekJahreskosten(p.investEur, k.zinsPct, nd, ih),
    };
  });

  const gruppen = EK_GRUPPEN.map(g => {
    const ps = pos.filter(p => p.gruppe === g.key);
    return {
      ...g, positionen: ps,
      investEur: summe(ps.map(p => p.investEur)),
      jahreskostenEur: summe(ps.map(p => p.jahreskostenEur)),
      nutzungsdauern: [...new Set(ps.map(p => p.nutzungsdauer))].sort((a, b) => a - b),
      jahre: [...new Set(ps.map(p => p.jahr).filter(j => j != null))].sort((a, b) => a - b),
    };
  });

  const jahre = [...new Set(pos.map(p => p.jahr).filter(j => j != null))].sort((a, b) => a - b);
  const jahresreihe = jahre.map(jahr => ({
    jahr,
    ...Object.fromEntries(EK_GRUPPEN.map(g => [g.key, summe(pos.filter(p => p.gruppe === g.key && p.jahr === jahr).map(p => p.investEur))])),
  }));

  return {
    kennwerte: k,
    positionen: pos,
    gruppen,
    summeInvestEur: summe(pos.map(p => p.investEur)),
    summeJahreskostenEur: summe(pos.map(p => p.jahreskostenEur)),
    jahresreihe,
    ohneJahrEur: summe(pos.filter(p => p.jahr == null).map(p => p.investEur)),
  };
}
