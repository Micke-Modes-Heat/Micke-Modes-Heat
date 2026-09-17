// @ts-check
// ── lib/pv-pflicht.js — Rechenkern der landesrechtlichen PV-Pflicht ──────────
// DOM-frei; einzige Abhängigkeit ist die Datentabelle in config/pv-pflicht-laender.js.
// Die app-seitige Schicht (Variante, Panel, Prüfspalte) liegt in 09d-pv-analyse.js.
//
// Grundgedanke: Die Pflicht hängt am EINZELNEN Gebäude und an seinem Fall
// (Neubau / grundlegende Dachsanierung), nicht am Quartier. Deshalb rechnet
// dieser Kern gebäudescharf und liefert die Einzelfälle mit zurück — sie sind
// zugleich der Beleg für Panel und Gutachten.
//
// Was der Kern bewusst NICHT tut: auslegen. Wo ein Land keinen Flächenanteil
// nennt (NRW, SH, HE), liefert er keine Leistung und sagt warum. Ein stiller
// Default wäre hier der teuerste Fehler — er würde eine Zahl erfinden, auf die
// sich eine Baugenehmigung stützt.

import { EIGNUNG_PAUSCHAL_PCT, PV_PFLICHT } from '../config/pv-pflicht-laender.js';

/**
 * @typedef {import('../config/pv-pflicht-laender.js').PflichtRegel} PflichtRegel
 *
 * @typedef {object} PflichtGebaeude  Aufbereitetes Gebäude für den Rechenkern
 * @property {number|string} id
 * @property {string} [name]
 * @property {number} grundflaecheM2   Grundfläche (Fußabdruck) in m²
 * @property {number|null} [dachNeigung]
 * @property {boolean} [wohnen]        true = Wohngebäude
 * @property {number} [geeignetM2]     belegbare Fläche (Belegung − Sperrflächen); 0 = nicht gezeichnet
 * @property {number|null} [nutzflaecheM2]
 * @property {boolean} [neubau]
 * @property {boolean} [dachsanierung]
 * @property {number|null} [sanAnteilPct]  Anteil der sanierten Dachfläche in %
 * @property {number} [istKwp]        geplante PV-Leistung an diesem Gebäude
 * @property {''|'auto'|'neubau'|'dachsanierung'|'keine'} [pflichtFall]  Handeingabe am Gebäude
 *
 * @typedef {object} PflichtFall  Ergebnis je Gebäude
 * @property {number|string} id
 * @property {string} [name]
 * @property {boolean} pflichtig
 * @property {string|null} fall      'neubau' | 'dachsanierung' | 'angenommen'
 * @property {string} grund          Begründung, wenn nicht pflichtig
 * @property {number} dachM2
 * @property {number} bezugsM2
 * @property {number} sollM2
 * @property {number} kwp          Sollleistung nach Landesrecht
 * @property {number} istKwp       geplante Leistung am Gebäude
 * @property {number} deltaKwp     istKwp − kwp (negativ = Unterdeckung)
 * @property {boolean} erfuellt
 * @property {boolean} manuell     true = Fall per Hand gesetzt, nicht erkannt
 * @property {string} rechenweg    nachvollziehbare Ableitung der Sollleistung
 * @property {string[]} annahmen
 *
 * @typedef {object} PflichtOptionen
 * @property {number} [wpProM2]
 * @property {'auto'|'alle'|'aus'} [annahme]
 * @property {number} [eignungPauschalPct]
 *
 * @typedef {object} PflichtSumme
 * @property {string|null} landId
 * @property {PflichtRegel|null} regel
 * @property {boolean} aktiv         false = keine Prüfung (kein Land / ausgeschaltet)
 * @property {boolean} bezifferbar   false = Landesrecht nennt keinen Flächenanteil
 * @property {number} kwp
 * @property {number} istKwp       Summe der geplanten Leistung der Pflichtgebäude
 * @property {PflichtFall[]} faelle
 * @property {PflichtFall[]} ohneFall
 * @property {string[]} annahmen
 * @property {string} grund
 */

/** Toleranz der Pflichtprüfung in % — fängt Rundung im Anzeigepfad ab. */
export const PFLICHT_TOLERANZ_PCT = 0.5;

/** Rückfall-Dachneigung, wenn der Aufrufer keine übergibt (Vorgabe „Satteldach"
 *  wie getDachDefaultNeigung in 03c-gebaeude-io.js). */
const NEIGUNG_RUECKFALL_GRAD = 35;

/**
 * Eine im GRUNDRISS gemessene Fläche auf die geneigte Dachhaut projizieren.
 *
 * Alle Flächen im Tool werden auf der Karte gemessen, sind also Grundriss-
 * projektionen: die Gebäude-Grundfläche ebenso wie die im PV-Modus gezeichneten
 * Belegungs- und Sperrflächen. Die echte Dachfläche ist um 1/cos(Neigung) größer.
 * Die Modulplatzierung rechnet dieselbe Projektion (03c: cellD = ml·cos(tilt)).
 *
 * @param {number} grundrissM2
 * @param {number|null|undefined} neigungGrad
 * @returns {number} m² Dachhaut
 */
export function projiziereAufDachflaeche(grundrissM2, neigungGrad) {
  const fl = Number(grundrissM2) || 0;
  if (fl <= 0) return 0;
  const n = Number.isFinite(Number(neigungGrad)) ? Number(neigungGrad) : NEIGUNG_RUECKFALL_GRAD;
  const clamped = Math.max(0, Math.min(75, n));   // >75° trägt kein Modulfeld mehr
  return fl / Math.cos(clamped * Math.PI / 180);
}

/**
 * Bruttodachfläche aus Gebäude-Grundfläche und Dachneigung.
 * Flachdach = Grundfläche; geneigtes Dach = Grundfläche / cos(Neigung).
 * @param {number} grundflaecheM2
 * @param {number|null|undefined} neigungGrad
 * @returns {number} m²
 */
export function dachflaecheBruttoM2(grundflaecheM2, neigungGrad) {
  return projiziereAufDachflaeche(grundflaecheM2, neigungGrad);
}

/**
 * Regelsatz eines Bundeslandes.
 * @param {string|null|undefined} landId Länderschlüssel wie in detectBundesland (z.B. 'bw')
 * @returns {PflichtRegel|null}
 */
export function pflichtRegel(landId) {
  return (landId && PV_PFLICHT[landId]) || null;
}

/**
 * Ein Gebäude gegen einen Landesregelsatz prüfen.
 *
 * @param {PflichtGebaeude} geb
 * @param {PflichtRegel|null} regel Eintrag aus PV_PFLICHT
 * @param {PflichtOptionen} [opt]
 * @returns {PflichtFall}
 */
export function pflichtGebaeude(geb, regel, opt = {}) {
  const wpProM2  = Number(opt.wpProM2) > 0 ? Number(opt.wpProM2) : 200;   // ~450 Wp auf 1,1 × 1,7 m
  const annahme  = opt.annahme || 'auto';
  const eignPct  = Number(opt.eignungPauschalPct) > 0 ? Number(opt.eignungPauschalPct) : EIGNUNG_PAUSCHAL_PCT;
  /** @type {string[]} */
  const annahmen = [];

  const dachM2 = dachflaecheBruttoM2(geb.grundflaecheM2, geb.dachNeigung);
  const istKwp = Number(geb.istKwp) > 0 ? Number(geb.istKwp) : 0;
  /** @param {string} grund @returns {PflichtFall} */
  const leer = (grund) => ({
    id: geb.id, name: geb.name, pflichtig: false, fall: null, grund,
    dachM2, bezugsM2: 0, sollM2: 0, kwp: 0, istKwp, deltaKwp: istKwp,
    erfuellt: true, manuell: false, rechenweg: '', annahmen,
  });

  if (!regel || !regel.pflicht) return leer('Land ohne PV-Pflicht');
  const sanierung = regel.sanierung || { gilt: false, abDachPct: 0 };

  // ── 1) Geltungsbereich ────────────────────────────────────────────────────
  if (regel.gilt === 'nichtwohn' && geb.wohnen) return leer('Wohngebäude — von der Pflicht ausgenommen');
  if (regel.gilt === 'landeseigen') {
    annahmen.push('Pflicht gilt nur für landeseigene Gebäude — hier als landeseigen angenommen.');
  }

  // ── 2) Auslösender Fall ───────────────────────────────────────────────────
  // Die Handeingabe am Gebäude schlägt alles andere — auch die Projekt-Einstellung
  // „alle Gebäude". Wer den Fall am Gebäude gesetzt hat, meint genau das.
  const handFall = geb.pflichtFall && geb.pflichtFall !== 'auto' ? geb.pflichtFall : null;
  if (handFall === 'keine') return leer('am Gebäude als nicht pflichtig gesetzt');

  let fall = null;
  let manuell = false;
  if (handFall) {
    fall = handFall;
    manuell = true;
  } else if (annahme === 'alle') {
    fall = 'angenommen';
    annahmen.push('Pflichtfall pauschal angenommen (Einstellung „alle Gebäude").');
  } else if (geb.neubau && regel.neubau) {
    fall = 'neubau';
  } else if (geb.dachsanierung && sanierung.gilt) {
    const schwelle = sanierung.abDachPct || 0;
    const anteil   = Number(geb.sanAnteilPct);
    if (!Number.isFinite(anteil)) {
      fall = 'dachsanierung';
      if (schwelle > 0) annahmen.push(`Umfang der Dachsanierung unbekannt — Schwelle ${schwelle} % der Dachfläche als erreicht angenommen.`);
    } else if (anteil >= schwelle) {
      fall = 'dachsanierung';
    } else {
      return leer(`Dachsanierung unter der Schwelle von ${schwelle} % der Dachfläche`);
    }
  }
  if (!fall) return leer('kein Neubau und keine Dachsanierung geplant');

  // ── 3) Schwellenwerte ─────────────────────────────────────────────────────
  const minDach = regel.minDachM2 || 0;
  if (minDach > 0 && dachM2 < minDach) {
    return leer(`Dachfläche ${dachM2.toFixed(0)} m² unter der Schwelle von ${minDach} m²`);
  }
  const nutz = Number(geb.nutzflaecheM2);
  const minNutz = regel.minNutzflaecheM2 || 0;
  if (minNutz > 0) {
    if (!Number.isFinite(nutz) || nutz <= 0) {
      annahmen.push(`Nutzfläche unbekannt — Schwelle von ${minNutz} m² als erreicht angenommen.`);
    } else if (nutz < minNutz) {
      return leer(`Nutzfläche ${nutz.toFixed(0)} m² unter der Schwelle von ${minNutz} m²`);
    }
  }

  // ── 4) Bezugsfläche nach Landesformulierung ───────────────────────────────
  let bezugsM2 = dachM2;
  if (regel.bezug === 'geeignet') {
    const geeignet = Number(geb.geeignetM2);
    if (Number.isFinite(geeignet) && geeignet > 0) {
      bezugsM2 = geeignet;
    } else {
      bezugsM2 = dachM2 * eignPct / 100;
      annahmen.push(`Keine Belegungsfläche gezeichnet — geeignete Fläche pauschal mit ${eignPct} % der Bruttodachfläche angesetzt.`);
    }
  }

  // ── 5) Sollfläche und Leistung ────────────────────────────────────────────
  // Kein Prozentsatz hinterlegt: Fall bleibt pflichtig, Leistung bleibt 0.
  // Die aufrufende Ebene macht daraus einen sichtbaren Hinweis statt einer Zahl.
  if (regel.anteilPct == null) {
    return {
      id: geb.id, name: geb.name, pflichtig: true, fall, grund: 'Flächenanteil im Landesrecht nicht beziffert',
      dachM2, bezugsM2, sollM2: 0, kwp: 0, istKwp, deltaKwp: istKwp,
      erfuellt: true, manuell, rechenweg: '', annahmen,
    };
  }

  const sollM2 = bezugsM2 * regel.anteilPct / 100;
  const kwp    = sollM2 * wpProM2 / 1000;
  /** @param {number} v @param {number} [d] */
  const nf = (v, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rechenweg = `${nf(bezugsM2)} m² ${bezugFlaechenName(regel)} × ${nf(regel.anteilPct)} % `
                  + `× ${nf(wpProM2)} W/m² = ${nf(kwp, 1)} kWp`;

  return {
    id: geb.id, name: geb.name, pflichtig: true, fall, grund: '',
    dachM2, bezugsM2, sollM2, kwp, istKwp,
    deltaKwp: istKwp - kwp,
    erfuellt: istKwp >= kwp * (1 - PFLICHT_TOLERANZ_PCT / 100),
    manuell, rechenweg, annahmen,
  };
}

/**
 * Klartextname der Bezugsfläche eines Landes — die unterschiedliche Bezugsfläche
 * ist der häufigste Grund für Abweichungen zwischen Soll und Auslegung.
 * @param {PflichtRegel|null} regel
 * @returns {string}
 */
export function bezugFlaechenName(regel) {
  if (regel?.bezug === 'geeignet') return 'geeignete Fläche';
  if (regel?.bezug === 'brutto')   return 'Bruttodachfläche';
  return 'Dachfläche';
}

/**
 * Dieselbe Bezeichnung nach Artikel („… % der …"), damit die Sätze in der
 * Oberfläche grammatisch aufgehen.
 * @param {PflichtRegel|null} regel
 * @returns {string}
 */
export function bezugFlaechenNameDekliniert(regel) {
  return regel?.bezug === 'geeignet' ? 'geeigneten Fläche' : bezugFlaechenName(regel);
}

/**
 * Pflichtleistung für eine Gebäudeliste summieren.
 *
 * @param {PflichtGebaeude[]} gebs Aufbereitete Gebäude (siehe pflichtGebaeude)
 * @param {string|null|undefined} landId
 * @param {PflichtOptionen} [opt]
 * @returns {PflichtSumme}
 */
export function pvPflichtSumme(gebs, landId, opt = {}) {
  const regel = pflichtRegel(landId);
  /** @type {PflichtSumme} */
  const basis = { landId: landId || null, regel, aktiv: false, bezifferbar: false, kwp: 0, istKwp: 0, faelle: [], ohneFall: [], annahmen: [], grund: '' };

  if (opt.annahme === 'aus') return { ...basis, grund: 'Pflichtprüfung ausgeschaltet' };
  if (!landId)        return { ...basis, grund: 'Kein Bundesland bestimmt' };
  if (!regel)         return { ...basis, grund: `Unbekanntes Bundesland „${landId}"` };
  if (!regel.pflicht) return { ...basis, aktiv: true, grund: `${regel.land}: keine landesrechtliche PV-Pflicht` };

  /** @type {PflichtFall[]} */ const faelle = [];
  /** @type {PflichtFall[]} */ const ohneFall = [];
  let kwp = 0, istKwp = 0;
  for (const g of (gebs || [])) {
    const r = pflichtGebaeude(g, regel, opt);
    if (r.pflichtig) { faelle.push(r); kwp += r.kwp; istKwp += r.istKwp; } else { ohneFall.push(r); }
  }

  // Annahmen einmalig, nicht je Gebäude — sonst steht dieselbe Zeile 40-mal im Bericht.
  const annahmen = [...new Set(faelle.flatMap(f => f.annahmen))];

  const bezifferbar = regel.anteilPct != null;
  let grund = '';
  if (!faelle.length) {
    grund = `${regel.land}: kein Gebäude im Projekt löst die Pflicht aus (Neubau oder grundlegende Dachsanierung).`;
  } else if (!bezifferbar) {
    grund = `${regel.land}: ${faelle.length} ${faelle.length === 1 ? 'Gebäude ist' : 'Gebäude sind'} pflichtig, `
          + `${regel.norm} nennt aber keinen Flächenanteil — keine Leistung berechenbar.`;
  }

  return { landId: landId || null, regel, aktiv: true, bezifferbar, kwp, istKwp, faelle, ohneFall, annahmen, grund };
}

/**
 * Eine Auslegung gegen die Pflichtleistung prüfen.
 * @param {number} pvKwp Leistung der zu prüfenden Variante
 * @param {{ aktiv?: boolean, bezifferbar?: boolean, kwp?: number }|null} pflicht Ergebnis von pvPflichtSumme
 * @returns {{ relevant: boolean, erfuellt: boolean, sollKwp: number, deltaKwp: number }}
 */
export function pflichtCheck(pvKwp, pflicht) {
  const soll = pflicht?.bezifferbar ? (pflicht.kwp || 0) : 0;
  if (!pflicht?.aktiv || !pflicht.bezifferbar || soll <= 0) {
    return { relevant: false, erfuellt: true, sollKwp: soll, deltaKwp: 0 };
  }
  const ist     = Number(pvKwp) || 0;
  const schwelle = soll * (1 - PFLICHT_TOLERANZ_PCT / 100);
  return {
    relevant: true,
    erfuellt: ist >= schwelle,
    sollKwp: soll,
    deltaKwp: ist - soll,
  };
}
