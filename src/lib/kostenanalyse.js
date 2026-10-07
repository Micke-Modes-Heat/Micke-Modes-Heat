// ── lib/kostenanalyse.js — Auswertung der Wirtschaftlichkeit: Kosten je Erzeuger und Kostentreiber ──
// DOM-frei. Arbeitet auf denselben Zahlen wie die Bausteintabelle (VDI 2067): Investitionsbausteine mit Annuität,
// Instandhaltung, Wartung und Bedienung, Energiekosten und CO₂-Kosten je Erzeuger, erzeugte Wärme je Erzeuger.

/** Investitionsbaustein → Erzeuger (alles andere ist gemeinsame Infrastruktur, Nebenkosten werden umgelegt). */
export const BAUSTEIN_ERZEUGER = Object.freeze({
  lwwp: 'lwwp', fg: 'fg', fg_entnahme: 'fg', geo_wp: 'geo', geo_sonden: 'geo',
  pk: 'pellets', pk_lager: 'pellets', hhs: 'hhs', hhs_kessel: 'hhs', hhs_lager: 'hhs',
  hko: 'heizoel', gk: 'gaskessel', gk_auto: '_autoGk',
  bhkw: 'bhkw', bhkw_agg: 'bhkw', bhkw_hydr: 'bhkw',
  sk: 'stromkessel', stromkessel: 'stromkessel', solarthermie: 'solarthermie', fw_pumpe: 'fernwaerme',
});
/** Nebenkosten in Prozent der Basisinvestition. */
export const NEBENKOSTEN_IDS = Object.freeze(['bauteil', 'hydr_elt', 'planung', 'unvorg']);

/** Annuitätenfaktor für Zins z (Prozent) und Nutzungsdauer n (Jahre). */
export function annuitaet(zinsPct, n) {
  if (!(n > 0)) return 0;
  const z = zinsPct / 100;
  return z > 0 ? z * (1 + z) ** n / ((1 + z) ** n - 1) : 1 / n;
}

/** Jahreskosten eines Bausteins, aufgeteilt in Kapital (Annuität) und Betrieb (Instandhaltung, Wartung, Bedienung). */
export function bausteinJahreskosten(b, zinsPct, lohn) {
  // wie die Bausteintabelle: ohne Nutzungsdauer (n = 0) nur Bedienung
  const mitInvest = (b.n || 0) > 0;
  const kapital = mitInvest ? (b.invest || 0) * annuitaet(zinsPct, b.n) : 0;
  const betrieb = (mitInvest ? (b.invest || 0) * ((b.inst || 0) + (b.wart || 0)) / 100 : 0) + (b.bedien || 0) * lohn;
  return { kapital, betrieb };
}

/**
 * Kosten je Erzeuger. o: { bausteine: [{ id, invest, n, inst, wart, bedien }], zinsPct, lohn,
 *   energie: { key: €/a }, co2: { key: €/a }, waerme: { key: MWh/a }, leistungKw: { key: kW }, gesamtMwh }.
 * Nebenkosten werden im Verhältnis der Investition auf Erzeuger und gemeinsame Infrastruktur umgelegt.
 * Ergebnis: { erzeuger: [{ key, mwh, anteil, vbh, kapital, betrieb, energie, co2, summe, ctKwh }] (teuerste kWh zuerst),
 *   gemeinsam: { kapital, betrieb, summe, ctKwh } (bezogen auf die gesamte Wärme) }.
 */
export function kostenJeErzeuger(o) {
  const { bausteine = [], zinsPct = 3.5, lohn = 45, energie = {}, co2 = {}, waerme = {}, leistungKw = {}, gesamtMwh = 0 } = o;
  const topf = new Map();   // key | '' (gemeinsam) → { kapital, betrieb, invest }
  const add = (k, kap, bet, inv) => {
    const t = topf.get(k) || { kapital: 0, betrieb: 0, invest: 0 };
    t.kapital += kap; t.betrieb += bet; t.invest += inv; topf.set(k, t);
  };
  let neben = { kapital: 0, betrieb: 0 };
  for (const b of bausteine) {
    const jk = bausteinJahreskosten(b, zinsPct, lohn);
    if (NEBENKOSTEN_IDS.includes(b.id)) { neben.kapital += jk.kapital; neben.betrieb += jk.betrieb; continue; }
    add(BAUSTEIN_ERZEUGER[b.id] || '', jk.kapital, jk.betrieb, b.invest || 0);
  }
  const investSumme = [...topf.values()].reduce((s, t) => s + t.invest, 0);
  for (const t of topf.values()) {
    const f = investSumme > 0 ? t.invest / investSumme : 0;
    t.kapital += neben.kapital * f; t.betrieb += neben.betrieb * f;
  }
  const keys = new Set([...topf.keys()].filter(Boolean));
  for (const k of [...Object.keys(energie), ...Object.keys(co2), ...Object.keys(waerme)]) if ((waerme[k] || 0) > 0.05) keys.add(k);
  const erzeuger = [...keys].map(key => {
    const t = topf.get(key) || { kapital: 0, betrieb: 0 };
    const mwh = waerme[key] || 0;
    const e = energie[key] || 0, c = co2[key] || 0;
    const summe = t.kapital + t.betrieb + e + c;
    return {
      key, mwh, anteil: gesamtMwh > 0 ? mwh / gesamtMwh * 100 : 0,
      vbh: (leistungKw[key] || 0) > 0 ? mwh * 1000 / leistungKw[key] : null,
      kapital: t.kapital, betrieb: t.betrieb, energie: e, co2: c, summe,
      ctKwh: mwh > 0.05 ? summe / mwh / 10 : null,
    };
  }).sort((a, b) => (b.ctKwh ?? -1) - (a.ctKwh ?? -1));
  const g = topf.get('') || { kapital: 0, betrieb: 0 };
  const gSumme = g.kapital + g.betrieb;
  return { erzeuger, gemeinsam: { kapital: g.kapital, betrieb: g.betrieb, summe: gSumme, ctKwh: gesamtMwh > 0 ? gSumme / gesamtMwh / 10 : 0 } };
}

/**
 * Kostentreiber: Wie stark ändern sich die Wärmegestehungskosten, wenn sich eine Größe ändert (alles andere fest)?
 * o: { bausteine, zinsPct, lohn, energieTraeger: { strom, gas, oel, biomasse, fw } (€/a je Energieträger, ohne Erlöse),
 *   co2Eur, gesamtMwh }. Ergebnis: [{ name, minusText, plusText, minus, plus }] in ct/kWh (Änderung gegenüber heute),
 *   nach Wirkung sortiert; Größen ohne Wirkung entfallen.
 */
export function kostentreiber(o) {
  const { bausteine = [], zinsPct = 3.5, lohn = 45, energieTraeger = {}, co2Eur = 0, gesamtMwh = 0 } = o;
  if (!(gesamtMwh > 0)) return [];
  const ct = eur => eur / gesamtMwh / 10;
  const kapitalBei = z => bausteine.reduce((s, b) => s + (b.invest || 0) * annuitaet(z, b.n || 0), 0);
  const investAnteil = bausteine.filter(b => (b.n || 0) > 0).reduce((s, b) => s + (b.invest || 0) * (annuitaet(zinsPct, b.n) + ((b.inst || 0) + (b.wart || 0)) / 100), 0);
  const bedien = bausteine.reduce((s, b) => s + (b.bedien || 0) * lohn, 0);
  const k0 = kapitalBei(zinsPct);
  const liste = [
    { name: 'Strompreis', minusText: '−20 %', plusText: '+20 %', basis: energieTraeger.strom, f: 0.2 },
    { name: 'Gaspreis', minusText: '−20 %', plusText: '+20 %', basis: energieTraeger.gas, f: 0.2 },
    { name: 'Heizölpreis', minusText: '−20 %', plusText: '+20 %', basis: energieTraeger.oel, f: 0.2 },
    { name: 'Biomassepreis', minusText: '−20 %', plusText: '+20 %', basis: energieTraeger.biomasse, f: 0.2 },
    { name: 'Fernwärmepreis', minusText: '−20 %', plusText: '+20 %', basis: energieTraeger.fw, f: 0.2 },
    { name: 'CO₂-Preis', minusText: '−50 %', plusText: '+50 %', basis: co2Eur, f: 0.5 },
    { name: 'Investition', minusText: '−20 %', plusText: '+20 %', basis: investAnteil, f: 0.2 },
    { name: 'Personalkosten', minusText: '−25 %', plusText: '+25 %', basis: bedien, f: 0.25 },
  ].filter(x => (x.basis || 0) > 1).map(x => ({ name: x.name, minusText: x.minusText, plusText: x.plusText, minus: -ct(x.basis * x.f), plus: ct(x.basis * x.f) }));
  if (k0 > 1) {
    liste.push({ name: 'Kalkulationszins', minusText: '−1 %-Pkt.', plusText: '+1 %-Pkt.',
      minus: ct(kapitalBei(Math.max(0, zinsPct - 1)) - k0), plus: ct(kapitalBei(zinsPct + 1) - k0) });
  }
  return liste.filter(x => Math.max(Math.abs(x.minus), Math.abs(x.plus)) >= 0.005)
    .sort((a, b) => (Math.abs(b.plus) + Math.abs(b.minus)) - (Math.abs(a.plus) + Math.abs(a.minus)));
}
