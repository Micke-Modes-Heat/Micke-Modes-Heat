// @ts-check
// ── lib/bundeslaender.js — Bundesland aus Koordinaten ────────────────────────
// Grobe Bounding-Boxes; bei Überlappung gewinnt das erste Match, deshalb stehen
// die kleinen Stadtstaaten vorn. Genügt für die beiden Zwecke im Tool:
// WFS-Quelle wählen (03b-netz.js) und Landesrecht zuordnen (09d-pv-analyse.js).
// In Grenzlagen kann die Zuordnung danebenliegen — beide Aufrufer lassen sie
// deshalb überschreiben.
//
// Lag bis 2026-09 direkt in 03b-netz.js; hierher gezogen, damit die PV-Analyse
// sie ohne Import auf das Netz-Modul nutzen kann (und damit sie testbar ist).

/** [südlat, westlon, nordlat, ostlon] */
export const BUNDESLAND_BBOX = Object.freeze([
  { id: 'hb', bbox: [53.01, 8.48, 53.60, 8.99] },
  { id: 'hh', bbox: [53.39, 9.73, 53.74, 10.33] },
  { id: 'be', bbox: [52.33, 13.08, 52.68, 13.77] },
  { id: 'sl', bbox: [49.11, 6.35, 49.64, 7.41] },
  { id: 'sh', bbox: [53.35, 7.87, 55.06, 11.35] },
  { id: 'mv', bbox: [53.11, 10.59, 54.69, 14.41] },
  { id: 'ni', bbox: [51.29, 6.65, 53.89, 11.60] },
  { id: 'bb', bbox: [51.36, 11.26, 53.56, 14.77] },
  { id: 'st', bbox: [50.94, 10.56, 53.04, 13.19] },
  { id: 'nw', bbox: [50.32, 5.87, 52.53, 9.46] },
  { id: 'he', bbox: [49.39, 7.77, 51.66, 10.24] },
  { id: 'th', bbox: [50.20, 9.87, 51.65, 12.66] },
  { id: 'sn', bbox: [50.17, 11.87, 51.69, 15.04] },
  { id: 'rp', bbox: [48.97, 6.11, 50.94, 8.51] },
  { id: 'bw', bbox: [47.53, 7.51, 49.79, 10.50] },
  { id: 'by', bbox: [47.27, 8.98, 50.56, 13.84] },
]);

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {string|null} Länderschlüssel ('bw', 'by', …) oder null außerhalb DE
 */
export function detectBundesland(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const eintrag of BUNDESLAND_BBOX) {
    const b = eintrag.bbox;
    if (lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]) return eintrag.id;
  }
  return null;
}
