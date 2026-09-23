// @ts-check
// Felddaten aus der Feldapp: sichern, wiederherstellen und beim Einlesen
// zusammenführen. DOM-frei, damit die Regeln getestet werden können.
//
// Felder am Objekt (Gebäude, Elektro-Asset, Erzeuger):
//   feldStatus      'offen' | 'besucht' | 'erledigt'
//   feldNotizen     Freitext
//   feldDaten       { heizung, heizungBaujahr, leistungKw, baujahr, verbrauch,
//                     zaehlerstand, zaehlerDatum } – vor Ort abgelesen
//   feldCheckliste  { profil, erfuellt, gesamt, fehlend[] } – Stand laut Feldapp
//   feldVorgemerkt  im Büro gesetzt: „bei der Begehung ansehen"
//   feldFotos       [{ name, dataUrl, kategorie? }]
//   feldSteckbrief  Stations-Steckbrief (lib/station-steckbrief.js): am Stationsgebäude
//                   { werte, zustand, notiz, maengel[], erfasstAm }, an jedem Asset
//                   { werte, zustand, notiz, erfasstAm }

import { MANGEL_PRIORITAETEN, ZUSTAND_STUFEN } from './station-steckbrief.js';

export const FELD_KEYS = /** @type {const} */ (['feldStatus', 'feldNotizen', 'feldDaten', 'feldVorgemerkt', 'feldFotos', 'feldCheckliste', 'feldSteckbrief']);
export const FELDDATEN_KEYS = /** @type {const} */ (['heizung', 'heizungBaujahr', 'leistungKw', 'baujahr', 'verbrauch', 'zaehlerstand', 'zaehlerDatum']);
/** Beschriftungen für die Anzeige in der Büro-App (gleiche Reihenfolge wie in der Feldapp) */
export const FELDDATEN_LABELS = {
  heizung: 'Heizung heute', heizungBaujahr: 'Baujahr Heizung', leistungKw: 'Leistung (Typenschild) kW',
  baujahr: 'Baujahr Gebäude (vor Ort)', verbrauch: 'Jahresverbrauch kWh/a', zaehlerstand: 'Zählerstand', zaehlerDatum: 'Abgelesen am',
};
export const FOTO_KATEGORIEN = /** @type {Record<string, string>} */ ({
  fassade: 'Fassade', heizraum: 'Heizraum', typenschild: 'Typenschild', zaehler: 'Zähler', mangel: 'Mangel', sonstiges: 'Sonstiges',
  // Foto-Plätze der Stationsakte (Trafostationen)
  uebersicht: 'Übersicht Station', tueren: 'Türen / Zugang', innen: 'Innenraum', gesamt: 'Gesamtansicht',
  plan: 'Übersichtsplan', messgeraete: 'Messgeräte', abgaenge: 'Abgänge', uebergabe: 'Übergabe',
});
export const FELD_STATUS = /** @type {const} */ (['offen', 'besucht', 'erledigt']);
const MAX_FELDWERT = 200;

/** @param {unknown} v @returns {v is Record<string, any>} */
function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/** Nur bekannte Schlüssel, nur Text, gekürzt. @param {unknown} roh @returns {Record<string, string>} */
export function sauberFeldDaten(roh) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isObject(roh)) return out;
  for (const k of FELDDATEN_KEYS) {
    const v = roh[k];
    if (v != null && String(v).trim()) out[k] = String(v).trim().slice(0, MAX_FELDWERT);
  }
  return out;
}

/** @param {unknown} fotos @returns {{name: string, dataUrl: string, kategorie?: string}[]} */
function sauberFotos(fotos) {
  if (!Array.isArray(fotos)) return [];
  return fotos
    .filter(f => isObject(f) && typeof f.dataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(f.dataUrl))
    .map(f => ({
      name: String(f.name || 'foto.jpg').slice(0, 120),
      dataUrl: f.dataUrl,
      ...(FOTO_KATEGORIEN[f.kategorie] ? { kategorie: f.kategorie } : {}),
    }));
}

/** @param {unknown} roh */
export function sauberCheckliste(roh) {
  if (!isObject(roh)) return null;
  const gesamt = Math.trunc(Number(roh.gesamt));
  const erfuellt = Math.trunc(Number(roh.erfuellt));
  if (!Number.isFinite(gesamt) || !Number.isFinite(erfuellt) || gesamt <= 0 || gesamt > 50 || erfuellt < 0 || erfuellt > gesamt) return null;
  return {
    profil: String(roh.profil || '').slice(0, 40),
    erfuellt, gesamt,
    fehlend: Array.isArray(roh.fehlend) ? roh.fehlend.slice(0, 50).map(x => String(x).slice(0, 80)) : [],
  };
}

const ZUSTAENDE = new Set(ZUSTAND_STUFEN.map(z => z.key));
const PRIOS = new Set(MANGEL_PRIORITAETEN.map(p => p.key));
/** @param {unknown} v @param {number} max */
const text = (v, max) => (v == null ? '' : String(v)).slice(0, max);

/**
 * Stations-Steckbrief: nur Text, bekannte Stufen, begrenzte Längen.
 * @param {unknown} roh
 * @returns {null | {version:number, werte:Record<string,string>, zustand:string, notiz:string, erfasstAm:string|null, maengel?:any[]}}
 */
export function sauberSteckbrief(roh) {
  if (!isObject(roh)) return null;
  /** @type {Record<string, string>} */
  const werte = {};
  if (isObject(roh.werte)) {
    for (const [k, v] of Object.entries(roh.werte).slice(0, 80)) {
      if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) && v != null && String(v).trim()) werte[k] = text(v, 500);
    }
  }
  const zustand = ZUSTAENDE.has(roh.zustand) ? roh.zustand : '';
  const notiz = text(roh.notiz, 4000);
  const maengel = Array.isArray(roh.maengel)
    ? roh.maengel.filter(m => isObject(m) && String(m.text || '').trim()).slice(0, 100).map(m => ({
      id: text(m.id, 60), text: text(m.text, 1000), prio: PRIOS.has(m.prio) ? m.prio : 'hinweis',
      bezug: text(m.bezug, 80), bezugName: text(m.bezugName, 120), erfasstAm: text(m.erfasstAm, 40),
    }))
    : null;
  if (!Object.keys(werte).length && !zustand && !notiz.trim() && !maengel?.length) return null;
  return {
    version: Number(roh.version) || 1, werte, zustand, notiz,
    erfasstAm: typeof roh.erfasstAm === 'string' ? roh.erfasstAm.slice(0, 40) : null,
    ...(maengel ? { maengel } : {}),
  };
}

/** Nur die gesetzten Feldwerte eines Objekts (leer → null). @param {Record<string, any>} obj */
export function pickFeldwerte(obj) {
  /** @type {Record<string, any>} */
  const out = {};
  if (FELD_STATUS.includes(obj.feldStatus)) out.feldStatus = obj.feldStatus;
  if (typeof obj.feldNotizen === 'string' && obj.feldNotizen.trim()) out.feldNotizen = obj.feldNotizen;
  const daten = sauberFeldDaten(obj.feldDaten);
  if (Object.keys(daten).length) out.feldDaten = daten;
  if (obj.feldVorgemerkt === true) out.feldVorgemerkt = true;
  const fotos = sauberFotos(obj.feldFotos);
  if (fotos.length) out.feldFotos = fotos;
  const cl = sauberCheckliste(obj.feldCheckliste);
  if (cl) out.feldCheckliste = cl;
  const stb = sauberSteckbrief(obj.feldSteckbrief);
  if (stb) out.feldSteckbrief = stb;
  return Object.keys(out).length ? out : null;
}

/**
 * Abschnitt `felddaten` für die Projektdatei.
 * @param {{gebaeude?: any[], assets?: any[], erzeuger?: Record<string, any>}} quellen
 */
export function captureFelddaten({ gebaeude = [], assets = [], erzeuger = {} }) {
  /** @param {any[]} liste */
  const ausListe = liste => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const o of liste || []) {
      if (!o || o.id == null) continue;
      const w = pickFeldwerte(o);
      if (w) out[String(o.id)] = w;
    }
    return out;
  };
  /** @type {Record<string, any>} */
  const erz = {};
  for (const [key, o] of Object.entries(erzeuger || {})) {
    if (!o) continue;
    const w = pickFeldwerte(o);
    if (w) erz[key] = w;
  }
  return { version: 1, gebaeude: ausListe(gebaeude), assets: ausListe(assets), erzeuger: erz };
}

/**
 * Stellt gesicherte Felddaten an den frisch geladenen Objekten wieder her.
 * @param {unknown} abschnitt
 * @param {{gebaeude?: any[], assets?: any[], erzeuger?: Record<string, any>}} ziele
 * @returns {number} Anzahl Objekte mit Felddaten
 */
export function applyFelddaten(abschnitt, { gebaeude = [], assets = [], erzeuger = {} }) {
  if (!isObject(abschnitt)) return 0;
  let n = 0;
  /** @param {any} ziel @param {unknown} werte */
  const setze = (ziel, werte) => {
    if (!ziel || !isObject(werte)) return;
    const w = pickFeldwerte(werte);
    if (!w) return;
    Object.assign(ziel, w);
    n++;
  };
  /** @param {any[]} liste @param {unknown} teil */
  const ausListe = (liste, teil) => {
    if (!isObject(teil)) return;
    const byId = new Map((liste || []).map(o => [String(o.id), o]));
    for (const [id, werte] of Object.entries(teil)) setze(byId.get(id), werte);
  };
  ausListe(gebaeude, abschnitt.gebaeude);
  ausListe(assets, abschnitt.assets);
  if (isObject(abschnitt.erzeuger)) {
    for (const [key, werte] of Object.entries(abschnitt.erzeuger)) setze(erzeuger?.[key], werte);
  }
  return n;
}

/**
 * Plant, wie ein Datensatz aus der Feldapp in ein vorhandenes Objekt einfließt.
 * Verändert nichts; `patch` wird erst nach Bestätigung angewendet.
 *
 * Regeln — nichts, was schon da ist, geht verloren:
 *  - Leere Werte aus der Feldapp überschreiben nichts.
 *  - Notizen: Unterscheiden sie sich, werden beide behalten (angehängt).
 *  - Status: Ein Rückschritt (z. B. erledigt → offen) wird nicht übernommen.
 *  - Vor-Ort-Werte: Neue Werte ergänzen; abweichende Werte gelten als neuer
 *    Stand der Begehung und ersetzen den alten (als Konflikt gemeldet).
 *  - Fotos werden ergänzt, bereits vorhandene nicht doppelt angelegt.
 *  - Die Vormerkung gehört dem Büro und wird nicht aus der Feldapp gelesen.
 *  - Stations-Steckbrief: Der jüngere Erfassungsstand gilt; ein älterer Stand
 *    aus der Datei überschreibt einen neueren im Projekt nicht.
 *
 * @param {Record<string, any>} ziel
 * @param {Record<string, any>} quelle
 * @param {{name: string, dataUrl: string, kategorie?: string}[]} [fotos]
 * @param {{label?: string}} [opt]
 */
export function planFeldMerge(ziel, quelle, fotos = [], opt = {}) {
  /** @type {Record<string, any>} */
  const patch = {};
  /** @type {string[]} */
  const konflikte = [];
  let aenderungen = 0;

  const notizNeu = typeof quelle.feldNotizen === 'string' ? quelle.feldNotizen.trim() : '';
  const notizAlt = typeof ziel.feldNotizen === 'string' ? ziel.feldNotizen.trim() : '';
  if (notizNeu && notizNeu !== notizAlt) {
    if (!notizAlt || notizNeu.includes(notizAlt)) {
      patch.feldNotizen = notizNeu;
    } else if (!notizAlt.includes(notizNeu)) {
      patch.feldNotizen = `${notizAlt}\n\n— ${opt.label || 'Feldapp-Import'} —\n${notizNeu}`;
      konflikte.push('Notiz (beide Fassungen behalten)');
    }
    if (patch.feldNotizen !== undefined) aenderungen++;
  }

  if (FELD_STATUS.includes(quelle.feldStatus) && quelle.feldStatus !== ziel.feldStatus) {
    const rangAlt = FELD_STATUS.indexOf(ziel.feldStatus);
    const rangNeu = FELD_STATUS.indexOf(quelle.feldStatus);
    if (rangNeu >= rangAlt) { patch.feldStatus = quelle.feldStatus; aenderungen++; }
    else konflikte.push(`Status „${quelle.feldStatus}" nicht übernommen (bisher „${ziel.feldStatus}")`);
  }

  const datenNeu = sauberFeldDaten(quelle.feldDaten);
  const datenAlt = sauberFeldDaten(ziel.feldDaten);
  const datenMerge = { ...datenAlt };
  let datenGeaendert = false;
  for (const [k, v] of Object.entries(datenNeu)) {
    if (datenAlt[k] === v) continue;
    if (datenAlt[k]) konflikte.push(`${FELDDATEN_LABELS[/** @type {keyof typeof FELDDATEN_LABELS} */ (k)] || k}: „${datenAlt[k]}" → „${v}"`);
    datenMerge[k] = v;
    datenGeaendert = true;
  }
  if (datenGeaendert) { patch.feldDaten = datenMerge; aenderungen++; }

  const vorhanden = new Set(sauberFotos(ziel.feldFotos).map(f => f.dataUrl));
  const neueFotos = sauberFotos(fotos).filter(f => !vorhanden.has(f.dataUrl) && (vorhanden.add(f.dataUrl), true));
  if (neueFotos.length) {
    patch.feldFotos = [...sauberFotos(ziel.feldFotos), ...neueFotos];
    aenderungen++;
  }

  // Checkliste: immer der Stand der jüngsten Begehung
  const clNeu = sauberCheckliste(quelle.feldCheckliste);
  if (clNeu && JSON.stringify(clNeu) !== JSON.stringify(sauberCheckliste(ziel.feldCheckliste))) {
    patch.feldCheckliste = clNeu;
    aenderungen++;
  }

  const stbNeu = sauberSteckbrief(quelle.feldSteckbrief);
  const stbAlt = sauberSteckbrief(ziel.feldSteckbrief);
  if (stbNeu && JSON.stringify(stbNeu) !== JSON.stringify(stbAlt)) {
    if (stbAlt?.erfasstAm && stbNeu.erfasstAm && stbNeu.erfasstAm < stbAlt.erfasstAm) {
      konflikte.push('Steckbrief: älterer Stand nicht übernommen');
    } else {
      patch.feldSteckbrief = stbNeu;
      aenderungen++;
    }
  }

  return { patch, konflikte, aenderungen, neueFotos: neueFotos.length };
}
