// ── lib/pv-ertrag.js — Ertragsfaktor einer Dachfläche nach Ausrichtung UND Neigung ─
// Reiner Rechenteil (ohne DOM), genutzt von 03c getPvKorrFaktor und der Nordregel
// im PV-Modus (25).
//
// Faktor = Jahresertrag relativ zum Optimum (Süd, ~30–35°), Richtwerte Mitte
// Deutschland (~48–52° N, Größenordnung PVGIS / Einstrahlungsdiagramme).
// Ausrichtung und Neigung hängen zusammen: je steiler die Fläche, desto stärker
// wirkt die Abweichung von Süd; bei 0° ist die Ausrichtung egal. Das frühere
// Produkt „Azimutfaktor × Neigungsfaktor" bewertete flache Norddächer zu schlecht
// (Nord 15°: 0,58 statt ~0,77) und steile zu gut (Nord 45°: 0,58 statt ~0,52).

/** Abweichung von Süd (Spalten, Grad) — 0 = Süd, 90 = Ost/West, 180 = Nord. */
export const PV_ERTRAG_ABWEICHUNG = [0, 30, 60, 90, 120, 150, 180];
/** Neigung (Zeilen, Grad). */
export const PV_ERTRAG_NEIGUNG = [0, 15, 30, 45, 60, 75, 90];
/** Ertragsfaktoren je Neigung (Zeile) × Abweichung von Süd (Spalte). */
export const PV_ERTRAG_TABELLE = [
  [0.87, 0.87, 0.87, 0.87, 0.87, 0.87, 0.87],
  [0.96, 0.95, 0.93, 0.88, 0.83, 0.79, 0.77],
  [1.00, 0.98, 0.93, 0.84, 0.74, 0.67, 0.64],
  [0.98, 0.96, 0.90, 0.78, 0.65, 0.56, 0.52],
  [0.91, 0.89, 0.83, 0.70, 0.57, 0.46, 0.41],
  [0.80, 0.78, 0.72, 0.61, 0.48, 0.37, 0.33],
  [0.67, 0.66, 0.60, 0.51, 0.39, 0.29, 0.26],
];

/** Abweichung eines Azimuts (0 = Nord, 180 = Süd) von Süd, 0…180°. */
export function abweichungVonSued(azimut) {
  const a = (((Number(azimut) || 0) % 360) + 360) % 360;
  return Math.abs(a - 180);
}

/** Stützstelle + Anteil für lineare Interpolation in einer aufsteigenden Achse. */
function _stelle(achse, x) {
  if (x <= achse[0]) return [0, 0];
  const n = achse.length - 1;
  if (x >= achse[n]) return [n - 1, 1];
  let i = 0;
  while (x > achse[i + 1]) i++;
  return [i, (x - achse[i]) / (achse[i + 1] - achse[i])];
}

/**
 * Ertragsfaktor einer geneigten Fläche (bilinear in der Tabelle, ungerundet).
 * @param {number} azimut Grad, 0 = Nord, 90 = Ost, 180 = Süd, 270 = West
 * @param {number} neigung Grad, 0 = waagrecht … 90 = senkrecht
 * @returns {number} 0…1
 */
export function pvErtragsfaktor(azimut, neigung) {
  const [z, tz] = _stelle(PV_ERTRAG_NEIGUNG, Math.max(0, Math.min(90, Number(neigung) || 0)));
  const [s, ts] = _stelle(PV_ERTRAG_ABWEICHUNG, abweichungVonSued(azimut));
  const T = PV_ERTRAG_TABELLE;
  const oben  = T[z][s]     + ts * (T[z][s + 1]     - T[z][s]);
  const unten = T[z + 1][s] + ts * (T[z + 1][s + 1] - T[z + 1][s]);
  return oben + tz * (unten - oben);
}

/** Liegt eine geneigte Fläche unter der Ertragsschwelle (Prozent, z. B. 75)? */
export function pvUnterSchwelle(azimut, neigung, schwelleProzent) {
  return pvErtragsfaktor(azimut, neigung) * 100 < schwelleProzent - 1e-9;
}

/**
 * Halber Öffnungswinkel um Nord, in dem eine Fläche dieser Neigung unter der
 * Schwelle liegt — nur zur Anzeige („bei 35° etwa ±70° um Nord").
 * @returns {number|null} Grad (0…180), null = bei dieser Neigung nirgends darunter
 */
export function pvNordSektorBei(neigung, schwelleProzent) {
  if (!pvUnterSchwelle(0, neigung, schwelleProzent)) return null;
  if (pvUnterSchwelle(180, neigung, schwelleProzent)) return 180;
  // Faktor steigt von Nord (Azimut 0) nach Süd (180) monoton → Bisektion
  let lo = 0, hi = 180;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (pvUnterSchwelle(mid, neigung, schwelleProzent)) lo = mid; else hi = mid;
  }
  return lo;
}

// ── Flachdach-Aufständerung ──────────────────────────────────────────────────

/** Neigung der Ost-West-Aufständerung (Grad) — üblich 10°. */
export const PV_FLACH_OW_NEIGUNG = 10;

/**
 * Flächenausnutzung (GCR, Prozent auf 5 gerundet) einer Süd-Aufständerung, bei
 * der sich die Reihen zur Wintersonnenwende mittags nicht verschatten:
 * GCR = 1 / (cos t + sin t / tan h), h = 90° − Breite − 23,44°.
 * 30° → 40 % (bisheriger Standard), 15° → 55 %.
 */
export function pvGcrSued(neigung, breite = 48.5) {
  const t = Math.max(0, Math.min(60, Number(neigung) || 0)) * Math.PI / 180;
  const h = Math.max(5, 90 - breite - 23.44) * Math.PI / 180;
  const gcr = 1 / (Math.cos(t) + Math.sin(t) / Math.tan(h));
  return Math.max(5, Math.min(95, Math.floor(gcr * 100 / 5) * 5));
}

/** Ertragsfaktor einer Flachdach-Aufständerung: Süd mit `neigungSued`, Ost-West 10° (Mittel beider Seiten). */
export function pvFlachErtragsfaktor(ausrichtung, neigungSued = 15) {
  return ausrichtung === 'ostwest'
    ? (pvErtragsfaktor(90, PV_FLACH_OW_NEIGUNG) + pvErtragsfaktor(270, PV_FLACH_OW_NEIGUNG)) / 2
    : pvErtragsfaktor(180, neigungSued);
}
