// ── lib/pv-bestand-ausbau.js — PV-Ausbau im Bestand: wann reißt welche Grenze? ──
//
// Die Variantenansicht (Abb. 6) beantwortete nur „rot oder grün" für fünf feste
// Auslegungen. Die Frage des Netzplaners ist eine andere: Wie belastet der
// PV-Ausbau den Bestand NACH UND NACH, und an welcher Stelle wird welche
// Ertüchtigung fällig? Dieses Modul liefert dafür die Treppe:
//
//   Rückspeisespitze P_rück(kWp)  ──►  gegen jede Bestandsgrenze
//     • Trafo (Summe der Bestandstrafos × Rückspeisefaktor)
//     • NAP-Einspeisezusage (vorgelagerter Netzbetreiber)
//     • Spannungsband  S_zul = Δu_zul · S_k″  (Screening, cos φ ≈ 1)
//
// und für einen Ausbaustand die Auslastung je Grenze, die fälligen Maßnahmen
// und zwei Lösungswege im Kostenvergleich:
//   bestand — jede gerissene Grenze einzeln ertüchtigen
//   hybrid  — den Bestand bis zur ersten Grenze ausnutzen, den Rest über ein
//             eigenes Erzeugungsnetz abführen (Sprungkostenblock)
//
// Die Kostensätze kommen aus lib/netz-schwellen.js, damit die Schwellentreppe
// (13z) und diese Ansicht dieselben Zahlen verwenden. Importiert nur Libs,
// kein DOM → direkt testbar.

import { SCHWELLEN_KOSTEN, TRAFO_RUECK_FAKTOR } from './netz-schwellen.js';

/** Ab dieser Auslastung gilt eine Grenze als „eng" (Vorwarnung). */
export const AUSLASTUNG_ENG = 0.7;

const _rund = n => Math.round(n);

/**
 * Die Grenzen des Bestands, aufsteigend nach tragbarer Rückspeiseleistung.
 * Unbekannte Grenzen (0/leer) fallen weg — lieber keine Aussage als eine
 * erfundene.
 *
 * @param {{ trafoKva?:number, napKw?:number|null, skKva?:number, uBudgetPct?:number }} e
 * @returns {Array<{ id:'trafo'|'nap'|'du', label:string, kurz:string, kapKw:number, loesung:string }>}
 */
export function bestandsGrenzen({ trafoKva = 0, napKw = null, skKva = 0, uBudgetPct = 3 } = {}) {
  const g = [];
  if (trafoKva > 0) {
    g.push({
      id: 'trafo', label: 'Trafoleistung Bestand', kurz: 'Trafo',
      kapKw: trafoKva * TRAFO_RUECK_FAKTOR, kva: trafoKva,
      loesung: 'Trafo verstärken bzw. zusätzlichen Trafo setzen',
    });
  }
  if (napKw != null && napKw > 0) {
    g.push({
      id: 'nap', label: 'Einspeisezusage NAP', kurz: 'NAP',
      kapKw: napKw,
      loesung: 'Höhere Einspeisezusage beim Netzbetreiber beantragen',
    });
  }
  if (skKva > 0 && uBudgetPct > 0) {
    g.push({
      id: 'du', label: `Spannungsband (Δu ${uBudgetPct} %)`, kurz: 'Δu',
      kapKw: uBudgetPct / 100 * skKva,
      loesung: 'Eigenes Erzeugungsnetz bzw. verstärkte MS-Anbindung',
    });
  }
  return g.sort((a, b) => a.kapKw - b.kapKw);
}

/**
 * Auslastung einer Grenze bei gegebener Rückspeisespitze.
 * @returns {{ quote:number, reserveKw:number, stufe:'frei'|'eng'|'ueber' }}
 */
export function auslastung(rueckKw, grenze) {
  const quote = grenze.kapKw > 0 ? rueckKw / grenze.kapKw : 0;
  const stufe = quote > 1 ? 'ueber' : quote >= AUSLASTUNG_ENG ? 'eng' : 'frei';
  return { quote, reserveKw: grenze.kapKw - rueckKw, stufe };
}

/**
 * Maßnahme und Kosten, um eine gerissene Grenze zu ertüchtigen.
 * null, solange die Grenze trägt.
 */
export function ertuechtigung(rueckKw, grenze, kosten = SCHWELLEN_KOSTEN) {
  const ueberKw = rueckKw - grenze.kapKw;
  if (!(ueberKw > 0)) return null;
  if (grenze.id === 'trafo') {
    const noetigKva = rueckKw / TRAFO_RUECK_FAKTOR;
    const zusatzKva = Math.max(0, noetigKva - grenze.kva);
    return {
      ueberKw, titel: `Trafo ${_rund(grenze.kva)} → ${Math.ceil(noetigKva)} kVA`,
      kostenEUR: _rund(zusatzKva * kosten.trafoEurProKVA),
    };
  }
  if (grenze.id === 'nap') {
    return {
      ueberKw, titel: `Einspeisezusage NAP +${_rund(ueberKw)} kW`,
      kostenEUR: _rund(ueberKw * kosten.napEurProKW),
      hinweis: 'Zusage des vorgelagerten Netzbetreibers nötig — nicht allein planbar.',
    };
  }
  // Spannungsband: mit Trafo und Zusage nicht lösbar — der Überschuss braucht
  // einen eigenen Weg ins MS-Netz.
  return {
    ueberKw, titel: `Erzeugungsnetz / MS-Anbindung für ${_rund(ueberKw)} kW`,
    kostenEUR: _rund(ueberKw * kosten.erzeugungsnetzEurProKW),
  };
}

/**
 * Ausbaustand auswerten: Auslastung je Grenze, fällige Maßnahmen und die
 * beiden Lösungswege.
 *
 * @param {number} rueckKw  Rückspeisespitze am NAP
 * @param {ReturnType<typeof bestandsGrenzen>} grenzen
 */
export function ausbauStand(rueckKw, grenzen, kosten = SCHWELLEN_KOSTEN) {
  const komponenten = grenzen.map(g => ({
    ...g, ...auslastung(rueckKw, g), massnahme: ertuechtigung(rueckKw, g, kosten),
  }));
  const massnahmen = komponenten.filter(k => k.massnahme);
  const bestandEUR = massnahmen.reduce((s, k) => s + k.massnahme.kostenEUR, 0);

  // Hybrid: die kleinste Grenze bestimmt, was der Bestand ohne Eingriff trägt
  const tragKw = grenzen.length ? grenzen[0].kapKw : Infinity;
  const restKw = Math.max(0, rueckKw - tragKw);
  const hybridEUR = _rund(restKw * kosten.erzeugungsnetzEurProKW);

  const stufe = komponenten.some(k => k.stufe === 'ueber') ? 'ueber'
              : komponenten.some(k => k.stufe === 'eng')   ? 'eng' : 'frei';
  const guenstiger = !massnahmen.length ? null
                   : (hybridEUR < bestandEUR ? 'hybrid' : 'bestand');

  return {
    rueckKw, komponenten, stufe,
    bindend: komponenten.find(k => k.stufe === 'ueber') || null,
    naechste: komponenten.find(k => k.stufe !== 'ueber') || null,
    wege: {
      bestand: { kostenEUR: bestandEUR, schritte: massnahmen.map(k => ({ id: k.id, ...k.massnahme })) },
      hybrid:  { kostenEUR: hybridEUR, tragKw: Number.isFinite(tragKw) ? tragKw : null, restKw },
    },
    guenstiger,
  };
}

/**
 * Erste PV-Leistung, bei der die Kurve einen Wert überschreitet (lineare
 * Interpolation zwischen den Stützstellen). null = wird im Bereich nie erreicht.
 *
 * @param {Array<{kwp:number, rueckKw:number}>} punkte  aufsteigend nach kwp
 */
export function kwpBeiRueck(punkte, schwelleKw) {
  if (!punkte?.length) return null;
  if (punkte[0].rueckKw > schwelleKw) return punkte[0].kwp;
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1], b = punkte[i];
    if (b.rueckKw > schwelleKw) {
      const d = b.rueckKw - a.rueckKw;
      const f = d > 0 ? (schwelleKw - a.rueckKw) / d : 1;
      return a.kwp + Math.max(0, Math.min(1, f)) * (b.kwp - a.kwp);
    }
  }
  return null;
}

/**
 * Die Ertüchtigungs-Treppe über den gesamten Ausbaupfad: je Grenze die
 * PV-Leistung, ab der sie eng wird und ab der sie reißt — in der Reihenfolge,
 * in der der Ausbau sie trifft.
 */
export function ausbauTreppe(punkte, grenzen) {
  return grenzen
    .map(g => ({
      ...g,
      engAbKwp: kwpBeiRueck(punkte, g.kapKw * AUSLASTUNG_ENG),
      abKwp:    kwpBeiRueck(punkte, g.kapKw),
    }))
    .sort((a, b) => (a.abKwp ?? Infinity) - (b.abKwp ?? Infinity) || a.kapKw - b.kapKw);
}
