// @ts-check
// ── Kabelbeschriftungen von Bestandsplänen lesen ────────────────────────────
// Auf Papier-Einlinienplänen steht das Kabel als ein einziger String an der
// Leitung: "NYY-J 5x70", "NAYY-J 4x240", "3x NA2XS2Y 1x185". Daraus werden
// Typ, Querschnitt und Anzahl paralleler Systeme gelesen — die Felder, die
// eine stromEdge zur Auslegung braucht.
//
// DOM-frei gehalten, damit der Parser unabhängig vom Digitalisierer
// (15-plan-digitalisierer.js) getestet werden kann.

import { KABEL_TYPEN } from '../config/netz-kosten.js';

// Typkürzel, die real auf Plänen vorkommen. Reihenfolge egal (Wortgrenzen),
// aber die längeren MS-Kürzel stehen vorn, damit sie nicht von NYY „angebissen" werden.
const TYP_RX = /\b(NA2XS2Y|N2XS2Y|NAYCWY|NYCWY|NAYY|NYY|NYM)\b/i;

// Zahlengruppe: "5x70" (Adern × mm²) oder "3x1x185" (Systeme × Adern × mm²)
const GRUPPE_RX = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i;

// Vorangestellter Systemzähler: "3x NA2XS2Y …" — nur wenn danach ein Buchstabe folgt,
// sonst wäre "5x70" fälschlich eine Systemangabe.
const LEAD_RX = /^\s*(\d+)\s*[x×]\s+(?=[A-Za-z])/;

/**
 * @typedef {object} KabelLabel
 * @property {string|null} cableType     Typkürzel in Großschreibung, z. B. 'NYY'
 * @property {number} crossSection       Querschnitt je Ader in mm² (0 = unbekannt)
 * @property {number} nParallel          Anzahl paralleler Systeme (≥ 1)
 * @property {number|null} adern         Aderzahl laut Beschriftung
 * @property {boolean} msLevel           Mittelspannungskabel (…2XS2Y)
 * @property {boolean} bekannt           Typ UND Querschnitt in KABEL_TYPEN vorhanden
 */

/**
 * Liest eine Kabelbeschriftung. Gibt null zurück, wenn weder Typ noch
 * Querschnittsangabe erkennbar sind.
 * @param {unknown} text
 * @returns {KabelLabel|null}
 */
export function parseKabelLabel(text) {
  const s = String(text ?? '').replace(/,/g, '.').trim();
  if (!s) return null;

  const tm = s.match(TYP_RX);
  const cableType = tm ? tm[1].toUpperCase() : null;

  const lead = s.match(LEAD_RX);

  // Typbezeichnung entfernen, bevor nach Zahlen gesucht wird — sonst würden die
  // Ziffern in "NA2XS2Y" als Querschnittsangabe missverstanden.
  const rest = tm ? s.replace(tm[0], ' ') : s;
  const gm = rest.match(GRUPPE_RX);

  if (!cableType && !gm) return null;

  let nParallel = lead ? parseInt(lead[1], 10) : 1;
  let adern = null;
  let crossSection = 0;

  if (gm) {
    if (gm[3] != null) {
      nParallel    = parseInt(gm[1], 10) || nParallel;
      adern        = parseFloat(gm[2]);
      crossSection = parseFloat(gm[3]);
    } else {
      adern        = parseFloat(gm[1]);
      crossSection = parseFloat(gm[2]);
    }
  }

  const msLevel = !!cableType && /2XS2Y$/.test(cableType);
  // KABEL_TYPEN ist ein Literal-Objekt; der Typschlüssel kommt aus dem Text.
  const katalog = /** @type {Record<string, {sections: Array<{mm2: number}>}>} */ (KABEL_TYPEN);
  const typCfg = cableType ? katalog[cableType] : null;

  return {
    cableType,
    crossSection,
    nParallel: Math.max(1, nParallel || 1),
    adern,
    msLevel,
    bekannt: !!(typCfg && typCfg.sections.some(x => x.mm2 === crossSection)),
  };
}
