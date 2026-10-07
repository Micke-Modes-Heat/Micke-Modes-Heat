// @ts-check
// ── Netz-Kostentabellen ──────────────────────────────────────────────────
// KMR-Rohrkosten (€/m Trasse, inkl. Tiefbau) nach DN und Kostenszenario
// Quelle: AGFW/FW 510, Preisniveau 2024
export const KMR_KOSTEN = {
  //  DN: [niedrig, mittel, hoch]
  15:  [1420, 1636, 2034],
  20:  [1479, 1704, 2118],
  25:  [1537, 1771, 2202],
  32:  [1620, 1866, 2319],
  40:  [1714, 1974, 2454],
  50:  [1831, 2110, 2622],
  65:  [2007, 2313, 2874],
  80:  [2183, 2516, 3127],
  100: [2418, 2786, 3463],
  125: [2712, 3125, 3883],
  150: [3005, 3463, 4304],
  200: [3592, 4139, 5145],
  250: [4179, 4816, 5985],
  300: [4767, 5492, 6826],
  350: [5941, 6808, 8792],
  400: [7115, 8123, 10758],
  450: [8289, 9439, 12723],
  500: [9464, 10754, 14689],
  600: [11812, 13385, 18620],
  700: [14161, 16016, 22552],
  800: [16509, 18647, 26483],
};

// Kabeltypen für Stromnetz-Dimensionierung
// rhoOhmMm2pM: spezifischer Widerstand bei 20°C (Ω·mm²/m), IEC 60228
// alphaK:      Temperaturkoeffizient des Widerstands (1/K), IEC 60228
// xMuOhmPerM:  Reaktanzbelag (μΩ/m) je Querschnitt für Erdkabel 0,6/1 kV, DIN VDE 0276-620
// gruppe:      'ns' (NS-Erdkabel, Neubau) · 'ns-bestand' (Papier-Massekabel, nur Bestand)
//              · 'freileitung' · 'installation' (Gebäudeleitungen) · 'ms' (Mittelspannung)
// alternative: wird bei Engpässen als Ertüchtigungsmaterial angeboten
// Iz-Werte sind Richtwerte für Erdverlegung/EVU-Last (Freileitung: in Luft, 30 °C;
// Installation: Verlegeart C) — sie ersetzen keine Auslegung nach Herstellerdaten.
const _AL = { material: 'Al', rhoOhmMm2pM: 0.0286, alphaK: 0.00403 };
const _CU = { material: 'Cu', rhoOhmMm2pM: 0.0175, alphaK: 0.00393 };

export const KABEL_TYPEN = {
  NYY: {
    label: 'NYY (Kupfer)', ..._CU, gruppe: 'ns', alternative: true,
    sections: [
      { mm2: 16,  Iz: 91,  eurM: 12,  xMuOhmPerM: 95 },
      { mm2: 25,  Iz: 119, eurM: 16,  xMuOhmPerM: 90 },
      { mm2: 35,  Iz: 140, eurM: 20,  xMuOhmPerM: 88 },
      { mm2: 50,  Iz: 167, eurM: 28,  xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 207, eurM: 35,  xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 242, eurM: 45,  xMuOhmPerM: 82 },
      { mm2: 120, Iz: 275, eurM: 55,  xMuOhmPerM: 80 },
      { mm2: 150, Iz: 310, eurM: 65,  xMuOhmPerM: 79 },
      { mm2: 185, Iz: 353, eurM: 80,  xMuOhmPerM: 77 },
      { mm2: 240, Iz: 405, eurM: 100, xMuOhmPerM: 75 },
    ]
  },
  NAYY: {
    label: 'NAYY (Aluminium)', ..._AL, gruppe: 'ns', alternative: true,
    sections: [
      { mm2: 35,  Iz: 110, eurM: 10, xMuOhmPerM: 88 },
      { mm2: 50,  Iz: 128, eurM: 14, xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 158, eurM: 18, xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 186, eurM: 24, xMuOhmPerM: 82 },
      { mm2: 120, Iz: 212, eurM: 30, xMuOhmPerM: 80 },
      { mm2: 150, Iz: 240, eurM: 38, xMuOhmPerM: 79 },
      { mm2: 185, Iz: 274, eurM: 48, xMuOhmPerM: 77 },
      { mm2: 240, Iz: 314, eurM: 60, xMuOhmPerM: 75 },
    ]
  },
  // Mit konzentrischem Schutzleiter (Ceander) — Belastbarkeit wie NYY/NAYY,
  // im Verteilnetz der EVU weit verbreitet.
  NYCWY: {
    label: 'NYCWY (Kupfer, konz. Leiter)', ..._CU, gruppe: 'ns',
    sections: [
      { mm2: 16,  Iz: 91,  eurM: 14,  xMuOhmPerM: 95 },
      { mm2: 25,  Iz: 119, eurM: 19,  xMuOhmPerM: 90 },
      { mm2: 35,  Iz: 140, eurM: 23,  xMuOhmPerM: 88 },
      { mm2: 50,  Iz: 167, eurM: 32,  xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 207, eurM: 40,  xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 242, eurM: 52,  xMuOhmPerM: 82 },
      { mm2: 120, Iz: 275, eurM: 63,  xMuOhmPerM: 80 },
      { mm2: 150, Iz: 310, eurM: 75,  xMuOhmPerM: 79 },
      { mm2: 185, Iz: 353, eurM: 92,  xMuOhmPerM: 77 },
      { mm2: 240, Iz: 405, eurM: 115, xMuOhmPerM: 75 },
    ]
  },
  NAYCWY: {
    label: 'NAYCWY (Aluminium, konz. Leiter)', ..._AL, gruppe: 'ns',
    sections: [
      { mm2: 50,  Iz: 128, eurM: 16, xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 158, eurM: 21, xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 186, eurM: 28, xMuOhmPerM: 82 },
      { mm2: 120, Iz: 212, eurM: 35, xMuOhmPerM: 80 },
      { mm2: 150, Iz: 240, eurM: 44, xMuOhmPerM: 79 },
      { mm2: 185, Iz: 274, eurM: 55, xMuOhmPerM: 77 },
      { mm2: 240, Iz: 314, eurM: 69, xMuOhmPerM: 75 },
    ]
  },
  // VPE-isoliert (90 °C statt 70 °C Leitertemperatur) → rund 15 % mehr Belastbarkeit.
  N2XY: {
    label: 'N2XY (Kupfer, VPE)', ..._CU, gruppe: 'ns',
    sections: [
      { mm2: 16,  Iz: 105, eurM: 13,  xMuOhmPerM: 95 },
      { mm2: 25,  Iz: 137, eurM: 18,  xMuOhmPerM: 90 },
      { mm2: 35,  Iz: 161, eurM: 22,  xMuOhmPerM: 88 },
      { mm2: 50,  Iz: 192, eurM: 31,  xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 238, eurM: 39,  xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 278, eurM: 50,  xMuOhmPerM: 82 },
      { mm2: 120, Iz: 316, eurM: 61,  xMuOhmPerM: 80 },
      { mm2: 150, Iz: 357, eurM: 72,  xMuOhmPerM: 79 },
      { mm2: 185, Iz: 406, eurM: 88,  xMuOhmPerM: 77 },
      { mm2: 240, Iz: 466, eurM: 110, xMuOhmPerM: 75 },
    ]
  },
  NA2XY: {
    label: 'NA2XY (Aluminium, VPE)', ..._AL, gruppe: 'ns',
    sections: [
      { mm2: 35,  Iz: 127, eurM: 11, xMuOhmPerM: 88 },
      { mm2: 50,  Iz: 147, eurM: 15, xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 182, eurM: 20, xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 214, eurM: 26, xMuOhmPerM: 82 },
      { mm2: 120, Iz: 244, eurM: 33, xMuOhmPerM: 80 },
      { mm2: 150, Iz: 276, eurM: 42, xMuOhmPerM: 79 },
      { mm2: 185, Iz: 315, eurM: 53, xMuOhmPerM: 77 },
      { mm2: 240, Iz: 361, eurM: 66, xMuOhmPerM: 75 },
    ]
  },
  // Papier-Massekabel mit Bleimantel — in Altnetzen (Liegenschaften vor ~1975)
  // häufig, wird nicht mehr neu verlegt. Belastbarkeit ≈ PVC-Kabel gleichen Leiters.
  NKBA: {
    label: 'NKBA (Kupfer, Papier — Bestand)', ..._CU, gruppe: 'ns-bestand',
    sections: [
      { mm2: 25,  Iz: 119, eurM: 16,  xMuOhmPerM: 90 },
      { mm2: 35,  Iz: 140, eurM: 20,  xMuOhmPerM: 88 },
      { mm2: 50,  Iz: 167, eurM: 28,  xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 207, eurM: 35,  xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 242, eurM: 45,  xMuOhmPerM: 82 },
      { mm2: 120, Iz: 275, eurM: 55,  xMuOhmPerM: 80 },
      { mm2: 150, Iz: 310, eurM: 65,  xMuOhmPerM: 79 },
      { mm2: 185, Iz: 353, eurM: 80,  xMuOhmPerM: 77 },
      { mm2: 240, Iz: 405, eurM: 100, xMuOhmPerM: 75 },
    ]
  },
  NAKBA: {
    label: 'NAKBA (Aluminium, Papier — Bestand)', ..._AL, gruppe: 'ns-bestand',
    sections: [
      { mm2: 50,  Iz: 128, eurM: 14, xMuOhmPerM: 86 },
      { mm2: 70,  Iz: 158, eurM: 18, xMuOhmPerM: 84 },
      { mm2: 95,  Iz: 186, eurM: 24, xMuOhmPerM: 82 },
      { mm2: 120, Iz: 212, eurM: 30, xMuOhmPerM: 80 },
      { mm2: 150, Iz: 240, eurM: 38, xMuOhmPerM: 79 },
      { mm2: 185, Iz: 274, eurM: 48, xMuOhmPerM: 77 },
      { mm2: 240, Iz: 314, eurM: 60, xMuOhmPerM: 75 },
    ]
  },
  // Luftkabel (verdrillte NS-Freileitung). Iz in Luft, 30 °C.
  NFA2X: {
    label: 'NFA2X (Freileitung, Aluminium)', ..._AL, gruppe: 'freileitung',
    sections: [
      { mm2: 16,  Iz: 83,  eurM: 5,  xMuOhmPerM: 100 },
      { mm2: 25,  Iz: 107, eurM: 6,  xMuOhmPerM: 98 },
      { mm2: 35,  Iz: 138, eurM: 7,  xMuOhmPerM: 96 },
      { mm2: 50,  Iz: 165, eurM: 9,  xMuOhmPerM: 94 },
      { mm2: 70,  Iz: 205, eurM: 11, xMuOhmPerM: 92 },
      { mm2: 95,  Iz: 245, eurM: 14, xMuOhmPerM: 90 },
      { mm2: 120, Iz: 285, eurM: 17, xMuOhmPerM: 88 },
      { mm2: 150, Iz: 320, eurM: 20, xMuOhmPerM: 87 },
    ]
  },
  // Mantelleitung (Gebäudeinstallation, Unterverteilungen). Verlegeart C.
  NYM: {
    label: 'NYM (Mantelleitung, Kupfer)', ..._CU, gruppe: 'installation',
    sections: [
      { mm2: 1.5, Iz: 19,  eurM: 1.5, xMuOhmPerM: 115 },
      { mm2: 2.5, Iz: 27,  eurM: 2.2, xMuOhmPerM: 110 },
      { mm2: 4,   Iz: 36,  eurM: 3.5, xMuOhmPerM: 105 },
      { mm2: 6,   Iz: 46,  eurM: 5,   xMuOhmPerM: 100 },
      { mm2: 10,  Iz: 63,  eurM: 8,   xMuOhmPerM: 97 },
      { mm2: 16,  Iz: 85,  eurM: 12,  xMuOhmPerM: 95 },
      { mm2: 25,  Iz: 112, eurM: 18,  xMuOhmPerM: 90 },
      { mm2: 35,  Iz: 138, eurM: 24,  xMuOhmPerM: 88 },
    ]
  },
  // Mittelspannungs-Erdkabel (12/20 kV). Auf Bestandsplänen die Regel zwischen
  // Übergabe und Trafostationen ("3x NA2XS2Y 1x185"). Die Auslastungsrechnung
  // für msLevel-Kanten läuft über MS_I_MAX_A/MS_SECTIONS — diese Tabelle liefert
  // Bezeichnung, Widerstandsbelag und Kostenansatz (elCalcAssets/Investitionsplan).
  NA2XS2Y: {
    label: 'NA2XS2Y (MS-Erdkabel, Aluminium)', ..._AL, gruppe: 'ms', msKabel: true,
    sections: [
      { mm2: 35,  Iz: 140, eurM: 32,  xMuOhmPerM: 130 },
      { mm2: 50,  Iz: 175, eurM: 38,  xMuOhmPerM: 125 },
      { mm2: 70,  Iz: 220, eurM: 45,  xMuOhmPerM: 120 },
      { mm2: 95,  Iz: 260, eurM: 54,  xMuOhmPerM: 117 },
      { mm2: 120, Iz: 300, eurM: 63,  xMuOhmPerM: 114 },
      { mm2: 150, Iz: 340, eurM: 74,  xMuOhmPerM: 112 },
      { mm2: 185, Iz: 385, eurM: 88,  xMuOhmPerM: 110 },
      { mm2: 240, Iz: 445, eurM: 108, xMuOhmPerM: 107 },
    ]
  },
  N2XS2Y: {
    label: 'N2XS2Y (MS-Erdkabel, Kupfer)', ..._CU, gruppe: 'ms', msKabel: true,
    sections: [
      { mm2: 35,  Iz: 175, eurM: 55,  xMuOhmPerM: 130 },
      { mm2: 50,  Iz: 220, eurM: 65,  xMuOhmPerM: 125 },
      { mm2: 70,  Iz: 275, eurM: 80,  xMuOhmPerM: 120 },
      { mm2: 95,  Iz: 325, eurM: 98,  xMuOhmPerM: 117 },
      { mm2: 120, Iz: 375, eurM: 115, xMuOhmPerM: 114 },
      { mm2: 150, Iz: 425, eurM: 135, xMuOhmPerM: 112 },
      { mm2: 185, Iz: 480, eurM: 160, xMuOhmPerM: 110 },
      { mm2: 240, Iz: 555, eurM: 200, xMuOhmPerM: 107 },
    ]
  },
};

// Überschriften der Typgruppen (Auswahllisten in Inspektor und Panel)
export const KABEL_GRUPPEN = {
  'ns':           'NS-Erdkabel',
  'ns-bestand':   'NS-Bestand (Papier-Masse)',
  'freileitung':  'Freileitung',
  'installation': 'Installation',
  'ms':           'Mittelspannung',
};

// Schreibvarianten auf Plänen → Katalogschlüssel. Elektrisch gleichwertig zum
// Zieltyp (andere Mantel-, Bewehrungs- oder Längswasserdicht-Ausführung).
// Kennbuchstaben nach DIN VDE 0276 / DIN VDE 0250.
export const KABEL_ALIASE = {
  'NA2XS(F)2Y': 'NA2XS2Y', 'NA2XSF2Y': 'NA2XS2Y', 'NA2XSY': 'NA2XS2Y', 'NA2XS2YRAA': 'NA2XS2Y',
  'N2XS(F)2Y':  'N2XS2Y',  'N2XSF2Y':  'N2XS2Y',  'N2XSY':  'N2XS2Y',
  'NYBY':   'NYY',    'NYKY':   'NYY',    'NYCY':    'NYCWY',
  'NAYBY':  'NAYY',   'NAYCY':  'NAYCWY',
  'N2X2Y':  'N2XY',   'N2XCY':  'N2XY',   'N2XCWY':  'N2XY',
  'NA2X2Y': 'NA2XY',  'NA2XCY': 'NA2XY',  'NA2XCWY': 'NA2XY',
  'NKBY':   'NKBA',   'NKLEY':  'NKBA',   'NEKBA':   'NKBA',
  'NAKBY':  'NAKBA',  'NAKLEY': 'NAKBA',
  'NHXMH':  'NYM',    'NHXHX':  'NYM',    'NYIF':    'NYM',
};

/**
 * Kabeltypen, mit denen ein überlastetes NS-Kabel ertüchtigt werden darf: die
 * Standard-Alternativen (alternative: true) plus der eigene Typ, sofern er ein
 * heute verlegtes NS-Erdkabel ist. Bestands-, MS-, Freileitungs- und
 * Installationstypen werden nie als Ausbaumaterial vorgeschlagen.
 * @param {string|null|undefined} cableType
 * @returns {Record<string, any>}
 */
export function kabelTypenFuerAusbau(cableType) {
  const alle = /** @type {Record<string, any>} */ (KABEL_TYPEN);
  /** @type {Record<string, any>} */
  const out = {};
  if (cableType && alle[cableType]?.gruppe === 'ns') out[cableType] = alle[cableType];
  for (const [k, v] of Object.entries(alle)) if (v.alternative) out[k] = v;
  return out;
}

/**
 * <option>-Liste der Kabeltypen, nach KABEL_GRUPPEN in <optgroup> gegliedert.
 * Ein gewählter Typ außerhalb der Gruppen wird trotzdem angeboten, damit ein
 * Bestandskabel beim Öffnen nicht still auf einen anderen Typ springt.
 * @param {string|null|undefined} selected
 * @param {string[]} [gruppen]  Teilmenge der Gruppen (Default: alle)
 * @returns {string}
 */
export function kabelTypOptionen(selected, gruppen = Object.keys(KABEL_GRUPPEN)) {
  const alle = /** @type {Record<string, any>} */ (KABEL_TYPEN);
  const titel = /** @type {Record<string, string>} */ (KABEL_GRUPPEN);
  const opt = (/** @type {string} */ k) =>
    `<option value="${k}"${k === selected ? ' selected' : ''}>${alle[k].label}</option>`;
  let html = '';
  for (const g of gruppen) {
    const typen = Object.keys(alle).filter(k => alle[k].gruppe === g);
    if (typen.length) html += `<optgroup label="${titel[g] || g}">${typen.map(opt).join('')}</optgroup>`;
  }
  if (selected && alle[selected] && !gruppen.includes(alle[selected].gruppe)) html += opt(selected);
  return html;
}

// Standard-Trafogrößen (kVA)
export const TRAFO_GROESSEN = [250, 400, 630, 1000, 1600, 2500];

// MS-Kabel-Stromtragfähigkeit (A) nach Querschnitt (mm²), 20 kV Erdkabel Richtwerte
export const MS_I_MAX_A  = { 35: 140, 50: 175, 70: 220, 95: 260, 120: 300, 150: 340, 185: 385, 240: 445 };
export const MS_SECTIONS = [35, 50, 70, 95, 120, 150, 185, 240];
