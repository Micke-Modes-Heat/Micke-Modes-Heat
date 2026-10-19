// ── lib/pv-netzkostenkurve.js — Netzkosten der PV-Analyse aus der Ausbautreppe ──
//
// Bis 10/2026 rechnete die PV-Analyse (09d) die Netzkosten pauschal nach kWp-Stufen
// (ab 500 kWp Trafo + MS-Trasse, ab 2 MWp Übergabestation) — unabhängig vom Netz.
// Jetzt kommt der Netzbau aus der Ausbautreppe der Netzaufnahme (28 / lib/pv-netzaufnahme-core):
//
//   0 … Bestandsnetz-Kapazität        0 €
//   Stufe k (Ertüchtigungen 1 … k)    kumulierte Investition der Treppe
//   darüber (Rest, im NS-Netz nicht   Erzeugungsnetz: eigene Station(en) mit MS-Abgang
//   anschließbar)                     (Kostenkatalog der Netzstrategie, 30)
//
// Die Kurve ist eine Treppe über der PV-Leistung: Bei x kWp gilt die kleinste Stufe,
// deren Kapazität x erreicht. Belegt wird in der Reihenfolge der Treppe (ertragsstärkste
// Dächer zuerst, Ertüchtigung mit den meisten kWp je Euro zuerst) — das ist zugleich
// der Ausbaupfad der PV-Analyse.
//
// Importfrei bis auf die reine Kostenrechnung der Netzstrategie, DOM-frei.

import { nsStationEur, nsTrafoGroesse, NS_TRAFO_GROESSEN } from './netzstrategie-core.js';

const EPS = 1e-6;

/**
 * Kurve aus der Zusammenfassung einer Ausbautreppe.
 * treppe: { basisKwp, potenzialKwp, schritte: [{ summeKwp, kumInvestEUR, label?, zuwachsKwp?, eurProKwp?, sammel? }] }
 * opts.rest: { investEUR, label } — Kosten, um den Rest (Potenzial über der letzten Stufe)
 *   anzuschließen; ohne Angabe gilt der Rest als nicht anschließbar.
 * @returns {{ potenzialKwp, endeKwp, restKwp, stufen: [{ stufe, bisKwp, investEUR, label, zuwachsKwp, eurProKwp, rest? }] }}
 */
export function pvnkAusTreppe(treppe, opts = {}) {
  const potenzialKwp = Math.max(0, +treppe?.potenzialKwp || 0);
  const stufen = [{ stufe: 0, bisKwp: Math.max(0, +treppe?.basisKwp || 0), investEUR: 0,
    label: 'Bestandsnetz', zuwachsKwp: Math.max(0, +treppe?.basisKwp || 0), eurProKwp: 0 }];
  (treppe?.schritte || []).forEach((s, i) => {
    const vor = stufen[stufen.length - 1];
    const bis = Math.max(vor.bisKwp, +s.summeKwp || 0);
    stufen.push({ stufe: i + 1, bisKwp: bis, investEUR: Math.max(vor.investEUR, +s.kumInvestEUR || 0),
      label: s.label || `Stufe ${i + 1}`, zuwachsKwp: bis - vor.bisKwp,
      eurProKwp: s.eurProKwp ?? (bis > vor.bisKwp ? ((+s.kumInvestEUR || 0) - vor.investEUR) / (bis - vor.bisKwp) : null),
      sammel: !!s.sammel });
  });
  const endeKwp = stufen[stufen.length - 1].bisKwp;
  const restKwp = Math.max(0, potenzialKwp - endeKwp);
  if (restKwp > 0.5 && opts.rest && Number.isFinite(+opts.rest.investEUR)) {
    const vor = stufen[stufen.length - 1];
    stufen.push({ stufe: stufen.length, bisKwp: potenzialKwp, investEUR: vor.investEUR + Math.max(0, +opts.rest.investEUR),
      label: opts.rest.label || 'Erzeugungsnetz', zuwachsKwp: restKwp,
      eurProKwp: Math.max(0, +opts.rest.investEUR) / restKwp, rest: true });
  }
  return { potenzialKwp, endeKwp, restKwp, stufen };
}

/**
 * Netzinvestition bei einer PV-Leistung.
 * faktor: rechnet die kWp der PV-Analyse in kWp des Netzmodells um (Potenzial Netzmodell ÷
 *   Potenzial Analyse) — beide zählen dieselben Dächer, aber nicht immer gleich (Freiflächen,
 *   ertragskorrigierte Leistung).
 * @returns {{ investEUR, stufe, label, anschliessbar: boolean, bisKwp }}
 */
export function pvnkKosten(kurve, kwp, faktor = 1) {
  const st = kurve?.stufen || [];
  if (!st.length) return { investEUR: 0, stufe: 0, label: '', anschliessbar: true, bisKwp: Infinity };
  const x = Math.max(0, +kwp || 0) * (faktor > 0 ? faktor : 1);
  for (const s of st) {
    if (x <= s.bisKwp + EPS + 0.5) return { investEUR: s.investEUR, stufe: s.stufe, label: s.label, anschliessbar: true, bisKwp: s.bisKwp, rest: !!s.rest };
  }
  const letzte = st[st.length - 1];
  return { investEUR: letzte.investEUR, stufe: letzte.stufe, label: letzte.label, anschliessbar: false, bisKwp: letzte.bisKwp, rest: !!letzte.rest };
}

/**
 * Grobe Kosten eines Erzeugungsnetzes für eine Einspeiseleistung: Kompaktstation(en)
 * passender Größe, MS-Abgangsfeld und MS-Trasse zum Netzanschlusspunkt.
 * katalog: nsKostenMischen(…) der Netzstrategie; laengeM: Trassenlänge (Luftlinie × Umweg schon enthalten).
 * @returns {{ investEUR, stationen, kva, text }}
 */
export function pvnkErzeugungsnetzEUR(einspKw, katalog, laengeM = 300) {
  if (!(einspKw > 0) || !katalog) return { investEUR: 0, stationen: 0, kva: 0, text: '' };
  const pf = 0.9;
  const groesste = NS_TRAFO_GROESSEN[NS_TRAFO_GROESSEN.length - 1];
  const stationen = Math.max(1, Math.ceil(einspKw / (groesste * pf)));
  const kva = nsTrafoGroesse(einspKw / stationen, pf) ?? groesste;
  const msEurM = (+katalog.msKabelEurM || 0) + (+katalog.msTiefbauEurM || 0);
  const investEUR = stationen * nsStationEur(katalog, kva) + (+katalog.msSchaltfeldEur || 0) + Math.max(0, laengeM) * msEurM;
  return { investEUR, stationen, kva,
    text: `${stationen > 1 ? stationen + ' × ' : ''}Station ${kva} kVA, MS-Abgang, ${Math.round(laengeM)} m MS-Trasse` };
}
