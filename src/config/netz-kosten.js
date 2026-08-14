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
export const KABEL_TYPEN = {
  NYY: {
    label: 'NYY (Kupfer)', material: 'Cu', rhoOhmMm2pM: 0.0175, alphaK: 0.00393,
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
    label: 'NAYY (Aluminium)', material: 'Al', rhoOhmMm2pM: 0.0286, alphaK: 0.00403,
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
  }
};

// Standard-Trafogrößen (kVA)
export const TRAFO_GROESSEN = [250, 400, 630, 1000, 1600, 2500];

// MS-Kabel-Stromtragfähigkeit (A) nach Querschnitt (mm²), 20 kV Erdkabel Richtwerte
export const MS_I_MAX_A  = { 35: 140, 50: 175, 70: 220, 95: 260, 120: 300, 150: 340, 185: 385, 240: 445 };
export const MS_SECTIONS = [35, 50, 70, 95, 120, 150, 185, 240];
