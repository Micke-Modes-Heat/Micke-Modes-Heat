// ── lib/gebaeude-analyse.js — Kennwerte und Gruppierungen für die Gebäudeanalyse (DOM-frei) ──
// Eingabe je Gebäude: Stammdaten (g) und berechnete Werte im Betrachtungsjahr (st aus getComputedStats).

/** Baualtersklassen (Gebäudetypologie Deutschland). */
export const BAUALTERSKLASSEN = [
  [1918, 'bis 1918'], [1948, '1919–1948'], [1957, '1949–1957'], [1968, '1958–1968'], [1978, '1969–1978'],
  [1983, '1979–1983'], [1994, '1984–1994'], [2001, '1995–2001'], [2009, '2002–2009'], [2015, '2010–2015'], [Infinity, 'ab 2016'],
];

export function baualtersklasse(baujahr) {
  const j = Number(baujahr);
  if (!(j > 1000)) return 'unbekannt';
  for (const [bis, name] of BAUALTERSKLASSEN) if (j <= bis) return name;
  return 'unbekannt';
}

const GROESSEN = [[250, 'bis 250 m²'], [500, '250–500 m²'], [1000, '500–1.000 m²'], [2500, '1.000–2.500 m²'], [5000, '2.500–5.000 m²'], [Infinity, 'über 5.000 m²']];
export function groessenklasse(m2) {
  if (!(m2 > 0)) return 'unbekannt';
  for (const [bis, name] of GROESSEN) if (m2 <= bis) return name;
  return 'unbekannt';
}

/** Nutzfläche wie in der Gebäudetabelle: Grundfläche × Geschosse × 0,8. */
export function nutzflaeche(g) {
  return (Number(g.flaeche) || 0) * (Number(g.stockwerke) || 1) * 0.8;
}

/**
 * Kennwerte. wert(g, st, ctx) → Zahl oder NaN; gewicht: Bezugsgröße für flächengewichtete Mittel (spez. Werte).
 * summierbar: Summen sind sinnvoll (absolute Werte).
 */
export const GA_KENNWERTE = {
  spezWaerme: { label: 'Spez. Wärmeverbrauch', einheit: 'kWh/m²a', wert: (g, st) => { const a = nutzflaeche(g); return a > 0 && st.waerme > 0 ? st.waerme * 1000 / a : NaN; }, gewicht: g => nutzflaeche(g) },
  spezHeizlast: { label: 'Spez. Heizlast', einheit: 'W/m²', wert: (g, st) => { const a = nutzflaeche(g); return a > 0 && st.heizlast > 0 ? st.heizlast * 1000 / a : NaN; }, gewicht: g => nutzflaeche(g) },
  waerme: { label: 'Wärmeverbrauch', einheit: 'MWh/a', wert: (g, st) => st.waerme > 0 ? st.waerme : NaN, summierbar: true },
  heizlast: { label: 'Heizlast', einheit: 'kW', wert: (g, st) => st.heizlast > 0 ? st.heizlast : NaN, summierbar: true },
  vbh: { label: 'Vollbenutzungsstunden', einheit: 'h/a', wert: (g, st) => st.waerme > 0 && st.heizlast > 0 ? st.waerme * 1000 / st.heizlast : NaN, gewicht: (g, st) => st.heizlast || 0 },
  flaeche: { label: 'Nutzfläche', einheit: 'm²', wert: g => { const a = nutzflaeche(g); return a > 0 ? a : NaN; }, summierbar: true },
  baujahr: { label: 'Baujahr', einheit: '', wert: g => Number(g.baujahr) > 1000 ? Number(g.baujahr) : NaN },
  vergleich: { label: 'Verbrauch / Vergleichswert', einheit: '%', wert: (g, st, ctx) => {
    const v = ctx?.vergleichswert?.(g);
    const a = nutzflaeche(g);
    return v > 0 && a > 0 && st.waerme > 0 ? st.waerme * 1000 / a / v * 100 : NaN;
  }, gewicht: g => nutzflaeche(g) },
};

/** Gruppierungen: gruppe(g, st, ctx) → Bezeichnung. reihenfolge: feste Sortierung der Gruppen (sonst nach Wert). */
export const GA_GRUPPIERUNGEN = {
  nutzung: { label: 'Nutzung', gruppe: (g, st, ctx) => ctx?.nutzungLabel?.(g) || g.nutzung || 'nicht zugeordnet' },
  baualter: { label: 'Baualtersklasse', gruppe: g => baualtersklasse(g.baujahr), reihenfolge: [...BAUALTERSKLASSEN.map(b => b[1]), 'unbekannt'] },
  sanierung: { label: 'Sanierungsstand', gruppe: (g, st) => st.status === 'saniert' ? 'saniert' : 'unsaniert', reihenfolge: ['unsaniert', 'saniert'] },
  groesse: { label: 'Größenklasse (Nutzfläche)', gruppe: g => groessenklasse(nutzflaeche(g)), reihenfolge: [...GROESSEN.map(b => b[1]), 'unbekannt'] },
  geschosse: { label: 'Geschosse', gruppe: g => { const n = Number(g.stockwerke) || 1; return n >= 6 ? '6 und mehr' : String(n); }, reihenfolge: ['1', '2', '3', '4', '5', '6 und mehr'] },
  zustand: { label: 'Bauzustand', gruppe: (g, st, ctx) => ({ 1: '1 gut', 2: '2 mittel', 3: '3 schlecht' }[ctx?.zustand?.(g)] || 'unbekannt'), reihenfolge: ['1 gut', '2 mittel', '3 schlecht', 'unbekannt'] },
  quelle: { label: 'Datenquelle', gruppe: g => g.importSourceName || 'manuell/ohne' },
  alle: { label: 'Alle Gebäude', gruppe: () => 'alle Gebäude' },
};

/** Statistik einer Werteliste (optional gewichtet). */
export function gaStatistik(werte, gewichte = null) {
  const paare = werte.map((v, i) => [v, gewichte ? (Number(gewichte[i]) || 0) : 1]).filter(([v]) => Number.isFinite(v));
  const n = paare.length;
  if (!n) return { n: 0 };
  const s = paare.map(p => p[0]).sort((a, b) => a - b);
  const q = p => { const pos = (n - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
  const summe = s.reduce((a, b) => a + b, 0);
  const gw = paare.reduce((a, p) => a + p[1], 0);
  const gewMittel = gw > 0 ? paare.reduce((a, p) => a + p[0] * p[1], 0) / gw : summe / n;
  return { n, min: s[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: s[n - 1], mittel: summe / n, gewMittel, summe };
}

/**
 * Gruppiert die Gebäude nach einer Gruppierung und berechnet die Statistik des Kennwerts je Gruppe.
 * @param {{g:Object, st:Object}[]} items
 * @returns {{gruppen: {name:string, stat:Object, punkte:{g:Object, wert:number}[]}[], gesamt:Object}}
 */
export function gaAuswerten(items, kennwertKey, gruppierungKey, ctx = {}) {
  const kw = GA_KENNWERTE[kennwertKey] || GA_KENNWERTE.spezWaerme;
  const gr = GA_GRUPPIERUNGEN[gruppierungKey] || GA_GRUPPIERUNGEN.nutzung;
  const map = new Map();
  const alleW = [], alleG = [];
  for (const { g, st } of items) {
    const w = kw.wert(g, st, ctx);
    if (!Number.isFinite(w)) continue;
    const name = gr.gruppe(g, st, ctx);
    if (!map.has(name)) map.set(name, { name, punkte: [], gewichte: [] });
    const e = map.get(name);
    const gew = kw.gewicht ? kw.gewicht(g, st) : 1;
    e.punkte.push({ g, st, wert: w });
    e.gewichte.push(gew);
    alleW.push(w); alleG.push(gew);
  }
  let gruppen = [...map.values()].map(e => ({ name: e.name, punkte: e.punkte, stat: gaStatistik(e.punkte.map(p => p.wert), kw.gewicht ? e.gewichte : null) }));
  if (gr.reihenfolge) gruppen.sort((a, b) => gr.reihenfolge.indexOf(a.name) - gr.reihenfolge.indexOf(b.name));
  else gruppen.sort((a, b) => b.stat.median - a.stat.median);
  return { gruppen, gesamt: gaStatistik(alleW, kw.gewicht ? alleG : null), kennwert: kw, gruppierung: gr };
}

/** Kennzahl, die ein Balken je Gruppe zeigt: Summe (absolute Größen), sonst (flächen-)gewichtetes Mittel. */
export function gaBalkenwert(stat, kennwert, modus = 'auto') {
  if (!stat?.n) return 0;
  if (modus === 'median') return stat.median;
  if (modus === 'summe' || (modus === 'auto' && kennwert.summierbar)) return stat.summe;
  return stat.gewMittel;
}
