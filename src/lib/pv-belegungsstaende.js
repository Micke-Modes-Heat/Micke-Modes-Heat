// ── lib/pv-belegungsstaende.js — Rechenkern der PV-Belegungsstände ──────────
//
// Ein Belegungsstand ist eine benannte Fassung der kompletten Dachbelegung:
// je Gebäude die PV-Felder (PV_BELEGUNG_FELDER, wie bei den Planungsvarianten),
// optional Dachangaben, die die Probebelegung gesetzt hat, und die Kennzahlen.
// Dieser Kern kennt weder Karte noch DOM — 38-pv-belegungsstaende.js zeichnet.
//
//   stand = { id, name, herkunft: 'auto'|'projekt'|'kopie', beschreibung, stand,
//             geb: { [gebId]: { felder, dach?, kwp, kwpKorr, module } },
//             netz?: { geprueft, vertraeglich, nurTrafo, jahr } }

import { PV_BELEGUNG_FELDER } from './varianten-regeln.js';

/** Dachangaben, die eine Probebelegung (25 pvmProbe) am Gebäude setzen würde. */
export const PVBS_DACH_FELDER = ['dachform', 'dachNeigung', 'dachAzimut'];

/** Gebäude ohne Belegung — so sieht ein Dach aus, das im Stand nicht vorkommt. */
export const PVBS_LEER = Object.freeze({ pvAktiv: false, pvFlaechen: [] });

const _LAUFZEIT = new Set(['layer', 'svgLayer', '_layer', 'marker']);
export function pvbsKlon(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(pvbsKlon);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (_LAUFZEIT.has(k) || typeof x === 'function') continue;
    out[k] = pvbsKlon(x);
  }
  return out;
}

/** PV-Felder eines Gebäudes (oder einer Rechenkopie) als Datenstand. */
export function pvbsFelder(g) {
  const e = {};
  for (const k of PV_BELEGUNG_FELDER) e[k] = pvbsKlon(g?.[k]);
  return e;
}

/** Summen eines Stands über die Gebäude, die es (noch) gibt. */
export function pvbsSummen(stand, gibtEs = null) {
  let kwp = 0, kwpKorr = 0, module = 0, daecher = 0;
  for (const [id, e] of Object.entries(stand?.geb || {})) {
    if (gibtEs && !gibtEs(id)) continue;
    daecher++;
    kwp += +e.kwp || 0;
    kwpKorr += +e.kwpKorr || 0;
    module += +e.module || 0;
  }
  return { daecher, kwp, kwpKorr, module };
}

/**
 * Vollständiger Plan zum Aktivieren: jedes Gebäude bekommt die Felder aus dem
 * Stand oder PVBS_LEER; dazu die Dachangaben der Probebelegung.
 * @param {any[]} gebaeude
 * @param {any} stand
 * @param {() => number} neueId  liefert frische Flächen-IDs (Karte braucht eindeutige)
 * @returns {{ belegung: Record<string, any>, dach: Map<any, any> }}
 */
export function pvbsPlan(gebaeude, stand, neueId) {
  const belegung = {};
  const dach = new Map();
  for (const g of gebaeude || []) {
    const e = stand?.geb?.[g.id] ?? stand?.geb?.[String(g.id)];
    if (!e) { belegung[g.id] = pvbsKlon(PVBS_LEER); continue; }
    const f = pvbsKlon(e.felder || {});
    if (Array.isArray(f.pvFlaechen) && neueId) for (const fl of f.pvFlaechen) fl.id = neueId();
    belegung[g.id] = f;
    if (e.dach && Object.keys(e.dach).length) dach.set(g.id, { ...e.dach });
  }
  return { belegung, dach };
}

/** Belegung ohne Flächen-IDs — die werden beim Aktivieren neu vergeben. */
function _normiert(felder) {
  const f = pvbsKlon(felder || {});
  if (Array.isArray(f.pvFlaechen)) for (const fl of f.pvFlaechen) delete fl.id;
  if (!f.pvAktiv && !(f.pvFlaechen || []).length) return null;
  return JSON.stringify(f);
}

/**
 * Entspricht die Belegung im Projekt dem Stand? `aktuell` = { [gebId]: felder }
 * nur der Gebäude MIT Belegung (wie pvbsAusProjekt sie erfasst).
 */
export function pvbsGleich(stand, aktuell) {
  const ids = new Set([...Object.keys(stand?.geb || {}), ...Object.keys(aktuell || {})].map(String));
  for (const id of ids) {
    const a = _normiert(stand?.geb?.[id]?.felder);
    const b = _normiert(aktuell?.[id]);
    if (a !== b) return false;
  }
  return true;
}

/**
 * Neuen Stand bauen.
 * @param {{ id:string, name:string, herkunft?:string, beschreibung?:string,
 *           eintraege: Record<string, {felder:any, dach?:any, kwp?:number, kwpKorr?:number, module?:number}>,
 *           netz?:any, stand?:string }} p
 */
export function pvbsNeu(p) {
  const geb = {};
  for (const [id, e] of Object.entries(p.eintraege || {})) {
    geb[id] = {
      felder: pvbsKlon(e.felder || {}),
      ...(e.dach && Object.keys(e.dach).length ? { dach: { ...e.dach } } : {}),
      kwp: Math.round((+e.kwp || 0) * 10) / 10,
      kwpKorr: Math.round((+e.kwpKorr || 0) * 10) / 10,
      module: Math.round(+e.module || 0),
    };
  }
  return {
    id: p.id, name: String(p.name || 'Belegungsstand').slice(0, 80),
    herkunft: p.herkunft || 'projekt', beschreibung: p.beschreibung || '',
    stand: p.stand || '', geb, netz: p.netz || null,
  };
}

/** Dachangaben der Probe, die vom Gebäude abweichen (nur die werden gespeichert). */
export function pvbsDachAbweichung(g, kopie) {
  const d = {};
  for (const k of PVBS_DACH_FELDER) {
    if (kopie?.[k] != null && kopie[k] !== g?.[k]) d[k] = kopie[k];
  }
  return d;
}

/**
 * Belegung im Projekt einem gespeicherten Stand zuordnen. Ein Stand liegt nur
 * dann „im Projekt", wenn die Dächer ihm genau entsprechen — sonst ist die
 * Belegung ein ungespeicherter Entwurf, der auf dem bisherigen Stand beruht
 * (`basisLoesen`: nach einem Variantenwechsel auf keinem).
 * @param {any[]} liste      gespeicherte Stände
 * @param {string|null} basisId  bisheriger Stand im Projekt
 * @param {Record<string, any>} aktuell  { [gebId]: felder } der belegten Gebäude
 * @returns {{ projektId: string|null, entwurf: boolean }}
 */
export function pvbsZuordnen(liste, basisId, aktuell, basisLoesen = false) {
  const basis = (liste || []).find(s => s.id === basisId) || null;
  if (basis && pvbsGleich(basis, aktuell)) return { projektId: basis.id, entwurf: false };
  const treffer = (liste || []).find(s => s !== basis && pvbsGleich(s, aktuell));
  if (treffer) return { projektId: treffer.id, entwurf: false };
  const projektId = basis && !basisLoesen ? basis.id : null;
  const leer = !Object.keys(aktuell || {}).length;
  return { projektId, entwurf: !(leer && !projektId) };
}
