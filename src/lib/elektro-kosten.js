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
  { key: 'verteilung',    label: 'Verteilung' },
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
  nutzungsdauer:     Object.freeze({ netzanschluss: 40, kabel: 40, trafo: 30, verteilung: 30, notstrom: 20, lade: 10 }),
  instandhaltungPct: Object.freeze({ netzanschluss: 0, kabel: 0.5, trafo: 0.5, verteilung: 1, notstrom: 1.5, lade: 2 }),
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

/**
 * Kostenpositionen des internen Netzes: geplante Maßnahmen vor Vorschlägen.
 * Was im Projekt als Maßnahme an Trafo, Verteilung oder Kabel steht, geht mit seinem Titel, Jahr und Betrag ein —
 * auch wenn die Engpass-Analyse heute etwas anderes vorschlagen würde. Nur Engpässe ohne geplante Maßnahme gehen
 * mit dem Vorschlag der Analyse ein (quelle 'vorschlag'), damit das Gutachten nicht lückenhaft wird.
 *
 * engpaesse: [{ id, label, bestand, ms, v: { art, label, investEUR, jahr, ungeloest } | null }]
 * geplant:   [{ objId, objIds?, objLabel, art: 'trafo'|'verteilung'|'kabel', m: { id, titel, kosten, jahr (aufgelöst), status } }]
 *            objIds: alle Betriebsmittel einer Maßnahme (Maßnahmenliste); sie deckt deren Engpässe ab und zählt einmal.
 * heute:     laufendes Jahr — umgesetzte Maßnahmen davor sind Bestand und keine Investition mehr.
 *
 * Rückgabe: { positionen (mit quelle und objId), offen: { bestand, ungeloest, ms, ohneKosten }, vorschlaege: [label],
 *            abweichend: [{ label, plan, vorschlag }] }
 */
export function ekNetzPositionen({ engpaesse = [], geplant = [], heute = new Date().getFullYear() } = {}) {
  const zaehlt = g => g?.m && g.m.status !== 'abgelehnt' && !(g.m.status === 'umgesetzt' && g.m.jahr != null && g.m.jahr < heute);
  const objIds = g => (Array.isArray(g.objIds) && g.objIds.length ? g.objIds : [g.objId]);
  const gueltig = geplant.filter(zaehlt);
  const plan = new Map();
  for (const g of gueltig) {
    for (const id of objIds(g)) {
      if (!plan.has(id)) plan.set(id, []);
      plan.get(id).push(g);
    }
  }
  const positionen = [], vorschlaege = [], abweichend = [];
  const offen = { bestand: 0, ungeloest: 0, ms: 0, ohneKosten: 0 };
  const verbucht = new Set();
  const ausPlan = g => {
    if (verbucht.has(g)) return;   // eine Maßnahme an mehreren Betriebsmitteln zählt einmal
    verbucht.add(g);
    const invest = Number(g.m.kosten) || 0;
    if (!(invest > 0)) offen.ohneKosten++;
    const ids = objIds(g);
    positionen.push({ gruppe: 'netz', art: g.art, label: `${g.objLabel}: ${g.m.titel || 'Maßnahme'}`, umfang: g.m.titel || '',
                      investEur: invest, jahr: g.m.jahr ?? null, quelle: 'plan', objId: ids[0], objIds: ids, massnahmeId: g.m.id });
  };

  for (const e of engpaesse) {
    const eigene = plan.get(e.id);
    if (eigene?.length) {
      eigene.forEach(ausPlan);
      const v = e.v;
      if (v && !v.ungeloest) {
        const summe = eigene.reduce((t, g) => t + (Number(g.m.kosten) || 0), 0);
        const jahre = eigene.map(g => g.m.jahr).filter(j => j != null);
        const jahr = jahre.length ? Math.min(...jahre) : null;
        if (Math.abs(summe - (Number(v.investEUR) || 0)) > 1 || (v.jahr != null && jahr !== v.jahr)) {
          abweichend.push({ label: e.label, plan: { investEur: summe, jahr }, vorschlag: { label: v.label, investEur: Number(v.investEUR) || 0, jahr: v.jahr ?? null } });
        }
      }
      continue;
    }
    if (e.bestand) { offen.bestand++; continue; }
    if (e.ms) { offen.ms++; continue; }
    if (!e.v) continue;
    if (e.v.ungeloest) { offen.ungeloest++; continue; }
    positionen.push({ gruppe: 'netz', art: e.v.art, label: `${e.label}: ${e.v.label}`, umfang: e.v.label,
                      investEur: Number(e.v.investEUR) || 0, jahr: e.v.jahr ?? null, quelle: 'vorschlag', objId: e.id, objIds: [e.id] });
    vorschlaege.push(e.label);
  }
  // Geplante Maßnahmen an Betriebsmitteln, die (nicht mehr) als Engpass erscheinen
  gueltig.forEach(ausPlan);
  return { positionen, offen, vorschlaege, abweichend };
}
