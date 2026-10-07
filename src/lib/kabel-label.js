// @ts-check
// ── Kabelbeschriftungen von Bestandsplänen lesen ────────────────────────────
// Auf Papier-Einlinienplänen steht das Kabel als ein einziger String an der
// Leitung: "NYY-J 5x70", "NAYY-J 4x240", "3x NA2XS(F)2Y 1x185 12/20 kV". Daraus
// werden Typ, Querschnitt und Anzahl paralleler Systeme gelesen — die Felder,
// die eine stromEdge zur Auslegung braucht.
//
// DOM-frei gehalten, damit der Parser unabhängig vom Digitalisierer
// (15-plan-digitalisierer.js) getestet werden kann.

import { KABEL_TYPEN, KABEL_ALIASE } from '../config/netz-kosten.js';

// Typkürzel = alle Katalogschlüssel plus ihre Schreibvarianten (NA2XS(F)2Y, NYBY, …).
// Längste zuerst, damit "NA2XS(F)2Y" nicht als "NA2XS…" angebissen wird. Statt
// Wortgrenzen begrenzen Lookarounds auf Nicht-Alphanumerik — eine Wortgrenze
// versagt an der Klammer in "(F)"; so trifft "NYY" weder in "NAYY" noch neben "-J".
const _TYP_NAMEN = [...Object.keys(KABEL_TYPEN), ...Object.keys(KABEL_ALIASE)]
  .sort((a, b) => b.length - a.length)
  .map(t => t.replace(/[()]/g, '\\$&'));
const TYP_RX = new RegExp(`(?<![A-Z0-9])(${_TYP_NAMEN.join('|')})(?![A-Z0-9])`, 'i');

// Spannungsangabe "12/20 kV", "0,6/1kV", "10 kV" — maßgeblich ist der größere Wert.
const KV_RX = /(?:(\d+(?:\.\d+)?)\s*\/\s*)?(\d+(?:\.\d+)?)\s*kV\b/i;

// Zahlengruppe: "5x70" (Adern × mm²) oder "3x1x185" (Systeme × Adern × mm²)
const GRUPPE_RX = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i;

// Vorangestellter Systemzähler: "3x NA2XS2Y …" — nur wenn danach ein Buchstabe folgt,
// sonst wäre "5x70" fälschlich eine Systemangabe.
const LEAD_RX = /^\s*(\d+)\s*[x×]\s+(?=[A-Za-z])/;

/**
 * @typedef {object} KabelLabel
 * @property {string|null} cableType     Katalogschlüssel, z. B. 'NYY' (Schreibvarianten aufgelöst)
 * @property {string|null} typText       Typkürzel wie auf dem Plan, z. B. 'NA2XS(F)2Y'
 * @property {number} crossSection       Querschnitt je Ader in mm² (0 = unbekannt)
 * @property {number} nParallel          Anzahl paralleler Systeme (≥ 1)
 * @property {number|null} adern         Aderzahl laut Beschriftung
 * @property {boolean} msLevel           Mittelspannung (MS-Kabeltyp oder Spannungsangabe ≥ 3 kV)
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
  const typText = tm ? tm[1].toUpperCase() : null;
  const aliase = /** @type {Record<string, string>} */ (KABEL_ALIASE);
  const cableType = typText ? (aliase[typText] || typText) : null;

  const kv = s.match(KV_RX);
  const kvMax = kv ? parseFloat(kv[2]) : 0;

  const lead = s.match(LEAD_RX);

  // Typbezeichnung (und Spannungsangabe) entfernen, bevor nach Zahlen gesucht
  // wird — sonst würden die Ziffern in "NA2XS2Y" als Querschnitt missverstanden.
  let rest = tm ? s.replace(tm[0], ' ') : s;
  if (kv) rest = rest.replace(kv[0], ' ');
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

  // KABEL_TYPEN ist ein Literal-Objekt; der Typschlüssel kommt aus dem Text.
  const katalog = /** @type {Record<string, {sections: Array<{mm2: number}>, msKabel?: boolean}>} */ (KABEL_TYPEN);
  const typCfg = cableType ? katalog[cableType] : null;
  // Papier-Massekabel (NKBA, NAKBA) gibt es in NS und MS — dort entscheidet die Spannungsangabe.
  const msLevel = !!typCfg?.msKabel || kvMax >= 3;

  return {
    cableType,
    typText,
    crossSection,
    nParallel: Math.max(1, nParallel || 1),
    adern,
    msLevel,
    bekannt: !!(typCfg && typCfg.sections.some(x => x.mm2 === crossSection)),
  };
}
