// ── lib/vergleichswerte-nwg.js — Vergleichswerte Wärme für Nichtwohngebäude ──
// Quelle: Bekanntmachung der Regeln für Energieverbrauchswerte und der Vergleichswerte im Nichtwohngebäudebestand
// vom 15. April 2021 (BMWi/BMI, Bundesanzeiger), Anlage 1 Tabelle 1 und Nummern 4 und 6.3.
//
// Vergleichswert Wärme = TEK Heizung × Größenfaktor f(A_NGF) + TEK Warmwasser (bei zentraler Warmwasserbereitung).
// Die TEK Heizung bilden laut Nummer 6.1 „einen energetischen Standard ab, der im Grundsatz einer für einen Altbau
// guten Energieaufwandsklasse entspricht“. Bezug: Nettogrundfläche (Energiebezugsfläche); ist nur die BGF bekannt,
// gilt A_NGF = 0,85 × BGF (Nummer 4). Die Werte sind auf den Referenzstandort Potsdam witterungsbereinigt.
// Kühlung und Be-/Entfeuchtung (Spalten 7a/7c) bleiben unberücksichtigt.

export const NWG_QUELLE = 'Bekanntmachung der Regeln für Energieverbrauchswerte und der Vergleichswerte im Nichtwohngebäudebestand vom 15. April 2021';
export const NWG_NGF_JE_BGF = 0.85;

/** Lfd.-Nr. → [Gebäudekategorie, TEK Heizung, TEK Warmwasser] in kWh/(m²·a), Anlage 1 Tabelle 1 Spalten 2–4. */
export const NWG_TEK = Object.freeze({
  1: ['Verwaltungsgebäude (allgemein)', 48.5, 6.9], 2: ['Parlaments- und Gerichtsgebäude', 49.9, 6.8], 3: ['Ministerien u. Ämter u. Behörden', 48.3, 7.4],
  4: ['Polizeidienstgebäude', 52.4, 7.4], 5: ['Gebäude für öffentliche Bereitschaftsdienste', 51.6, 10.2], 6: ['Feuerwehrdienstgebäude', 50.8, 7.1],
  7: ['Bürogebäude', 49.0, 8.1], 8: ['Bürogebäude – überwiegend Großraumbüros', 47.4, 12.8], 9: ['Bankgebäude', 48.0, 6.4],
  10: ['Hochschule und Forschung (allgemein)', 66.5, 6.7], 11: ['Gebäude für Lehre', 57.2, 5.6], 12: ['Institute für Lehre und Forschung', 65.0, 7.6],
  13: ['Gebäude für Forschung ohne Lehre', 87.8, 7.4], 14: ['Laborgebäude', 82.8, 8.0], 15: ['Gesundheitswesen (allgemein)', 55.7, 15.3],
  16: ['Krankenhäuser (ohne Forschung und Lehre)', 64.1, 40.8], 17: ['Krankenhäuser & teilstationäre Versorgung', 61.7, 33.6],
  18: ['Medizinische Einrichtungen für nicht stationäre Versorgung', 51.2, 8.6], 19: ['Gebäude für Reha, Kur und Genesung', 59.4, 22.1],
  20: ['Bildungseinrichtungen (allgemein)', 49.7, 19.5], 21: ['Schulen', 49.3, 22.4], 22: ['Kinderbetreuungseinrichtungen', 50.4, 17.3],
  23: ['Kultureinrichtungen (allgemein)', 55.9, 7.5], 24: ['Bibliotheken/Archive', 49.0, 5.0], 25: ['Ausstellungsgebäude', 57.6, 7.7],
  26: ['Veranstaltungsgebäude', 58.4, 9.1], 27: ['Gemeinschafts-/Gemeindehäuser', 63.6, 10.0], 28: ['Opern/Theater', 58.8, 7.6],
  29: ['Sporteinrichtungen (allgemein)', 65.5, 27.3], 30: ['Sporthallen', 68.6, 22.0], 31: ['Fitnessstudios', 60.6, 62.2], 32: ['Schwimmhallen', 63.8, 24.7],
  33: ['Gebäude für Sportaußenanlagen', 75.2, 22.5], 34: ['Verpflegungseinrichtungen (allgemein)', 75.9, 77.7], 35: ['Beherbergungsstätten (allgemein)', 52.1, 86.0],
  36: ['Hotels/Pensionen', 51.2, 89.1], 37: ['Jugendherbergen u. Ferienhäuser', 63.4, 50.9], 38: ['Gaststätten', 77.8, 79.0], 39: ['Mensen u. Kantinen', 67.0, 67.3],
  40: ['Gewerbliche und industrielle Gebäude (allgemein)', 38.7, 12.6], 41: ['Gewerbliche und industrielle Gebäude – schwere Arbeit, stehende Tätigkeit', 37.8, 20.0],
  42: ['Gewerbliche und industrielle Gebäude – Mischung aus leichter u. schwerer Arbeit', 36.0, 24.2],
  43: ['Gewerbliche und industrielle Gebäude – leichte Arbeit, überwiegend sitzende Tätigkeit', 38.1, 19.8], 44: ['Gebäude für Lagerung', 38.1, 19.3],
  45: ['Verkaufsstätten (allgemein)', 47.9, 7.6], 46: ['Kaufhäuser', 45.9, 6.4], 47: ['Kaufhauszentren/Einkaufszentren', 47.3, 11.1], 48: ['Märkte', 48.7, 6.2],
  49: ['Märkte mit sehr hohem Anteil von Kühlung für Lebensmittel', 48.7, 6.2], 50: ['Läden', 46.8, 6.4], 51: ['Läden mit sehr hohem Anteil von Kühlung für Lebensmittel', 46.8, 6.4],
  52: ['Fernmeldetechnik', 38.4, 4.0],
});

/** Nutzungstypen des Tools → Gebäudekategorie (Lfd.-Nr.). Wohngebäude (efh, mfh) fallen nicht unter die Bekanntmachung. */
export const NWG_ZUORDNUNG = Object.freeze({
  unterkunft: 37, kaserne: 37, wohnheim: 37, pflegeheim: 19, hotel: 36, kita: 22, schule: 21, hochschule: 10,
  verwaltung: 1, buero: 7, oeffentlich: 1, polizei: 4, feuerwehr: 6, rettungswache: 5, justiz: 2,
  krankenhaus: 16, arztpraxis: 18, sporthalle: 30, schwimmbad: 32, kultur: 26, bibliothek: 24, sakral: 27, kantine: 39,
  werkstatt: 41, lager: 44, technik: 40, labor: 14, ghd: 40, industrie: 40,
});

/** Umrechnungsfaktor TEK Heizung nach Gebäudegröße (Nummer 6.3.1). */
export function nwgGroessenfaktor(aNgf) {
  if (!(aNgf > 0)) return 1;
  if (aNgf <= 500) return 1.46;
  if (aNgf >= 50000) return 0.71;
  return 4.53 * aNgf ** -0.215 + 0.27;
}

/**
 * Vergleichswert Wärme eines Gebäudes.
 * g: { nutzung, waermeRef (Fallback bei eigenen Nutzungstypen), bgfM2, twwZentral (Standard true) }
 * Ergebnis: { nr, kategorie, tekH, tekWw, f, je NGF, je BGF } oder null, wenn keine Kategorie passt.
 */
export function nwgVergleichswert(g) {
  const nr = NWG_ZUORDNUNG[g.nutzung] ?? NWG_ZUORDNUNG[g.waermeRef];
  if (!nr) return null;
  const [kategorie, tekH, tekWw] = NWG_TEK[nr];
  const aNgf = (Number(g.bgfM2) || 0) * NWG_NGF_JE_BGF;
  const f = nwgGroessenfaktor(aNgf);
  const ww = g.twwZentral === false ? 0 : tekWw;
  const jeNgf = tekH * f + ww;
  return { nr, kategorie, tekH, tekWw: ww, f, jeNgf, jeBgf: jeNgf * NWG_NGF_JE_BGF };
}
