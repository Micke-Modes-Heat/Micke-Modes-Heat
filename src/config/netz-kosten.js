// ── Netz-Kostentabellen ──────────────────────────────────────────────────
// KMR-Rohrkosten (€/m Trasse, inkl. Tiefbau) nach DN und Kostenszenario
// Quelle: AGFW/FW 510, Preisniveau 2024
const KMR_KOSTEN = {
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
const KABEL_TYPEN = {
  NYY: {
    label: 'NYY (Kupfer)', material: 'Cu', rhoOhmMm2pM: 0.0175,
    sections: [
      { mm2: 16,  Iz: 91,  eurM: 12 },
      { mm2: 25,  Iz: 119, eurM: 16 },
      { mm2: 35,  Iz: 140, eurM: 20 },
      { mm2: 50,  Iz: 167, eurM: 28 },
      { mm2: 70,  Iz: 207, eurM: 35 },
      { mm2: 95,  Iz: 242, eurM: 45 },
      { mm2: 120, Iz: 275, eurM: 55 },
      { mm2: 150, Iz: 310, eurM: 65 },
      { mm2: 185, Iz: 353, eurM: 80 },
      { mm2: 240, Iz: 405, eurM: 100 },
    ]
  },
  NAYY: {
    label: 'NAYY (Aluminium)', material: 'Al', rhoOhmMm2pM: 0.0286,
    sections: [
      { mm2: 35,  Iz: 110, eurM: 10 },
      { mm2: 50,  Iz: 128, eurM: 14 },
      { mm2: 70,  Iz: 158, eurM: 18 },
      { mm2: 95,  Iz: 186, eurM: 24 },
      { mm2: 120, Iz: 212, eurM: 30 },
      { mm2: 150, Iz: 240, eurM: 38 },
      { mm2: 185, Iz: 274, eurM: 48 },
      { mm2: 240, Iz: 314, eurM: 60 },
    ]
  }
};

// Standard-Trafogrößen (kVA)
const TRAFO_GROESSEN = [250, 400, 630, 1000, 1600, 2500];
