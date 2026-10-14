// ── lib/auslegung.js — Auslegungsspitze bei Normaußentemperatur (DOM-frei) ──
// Der Lastgang beruht auf einem Klimajahr (Testreferenzjahr) oder einem Messjahr. Dessen kältester Tag liegt meist
// deutlich über der Normaußentemperatur des Standorts (DIN/TS 12831-1), die Spitze des Lastgangs ist daher kleiner
// als die Leistung, die die Erzeuger im Auslegungsfall bereitstellen müssen. Die Auslegungsspitze ist:
//   aus Gebäudedaten  P = Σ Normheizlast × Gleichzeitigkeitsfaktor + Netzverlustleistung
//   sonst             P = P_max · (θ_i − θ_e,Norm) / (θ_i − θ_Spitzentag)   (lineare Extrapolation, θ_i = 22 °C)
// Sie ist nie kleiner als die Spitze des Lastgangs. Einsatzplanung und Energiemengen bleiben beim Klima-/Messjahr.

/** Bezugstemperatur der linearen Extrapolation (Innentemperatur, bei der die Heizlast null wird), °C. */
export const THETA_INNEN_HOCHRECHNUNG = 22;

/** Tagesmitteltemperaturen (365 Tage) aus Stundenwerten; null bei weniger als einem Jahr. */
export function tagesmittel365(tempH) {
  if (!tempH || tempH.length < 8760) return null;
  const tm = new Array(365);
  for (let d = 0; d < 365; d++) {
    let s = 0;
    for (let h = 0; h < 24; h++) s += tempH[d * 24 + h];
    tm[d] = s / 24;
  }
  return tm;
}

/** Vorlauftemperatur nach der Heizkurve (linear zwischen −5 °C und +15 °C, außerhalb konstant). */
export function vorlaufNachHeizkurve(T, vl5, vl15) {
  const lo = Math.min(vl5, vl15), hi = Math.max(vl5, vl15);
  return Math.max(lo, Math.min(hi, vl5 + (vl15 - vl5) * (T + 5) / 20));
}

/**
 * Spitze des Lastgangs und lineare Extrapolation auf die Normaußentemperatur.
 * tageT: 365 Tagesmitteltemperaturen des Jahres, zu dem der Lastgang gehört. Ergebnis { pMax, stunde, tag, tSpitze,
 * tMin, normAtC, pNorm } (pNorm NaN ohne Temperaturen) oder null ohne Jahreslastgang.
 */
export function spitzeHochrechnen(lastgangKw, tageT, normAtC) {
  if (!lastgangKw || lastgangKw.length < 8760) return null;
  let pMax = 0, stunde = 0;
  for (let h = 0; h < 8760; h++) if (lastgangKw[h] > pMax) { pMax = lastgangKw[h]; stunde = h; }
  const tag = Math.floor(stunde / 24);
  const hatT = Array.isArray(tageT) && tageT.length === 365;
  const tSpitze = hatT ? tageT[tag] : NaN;
  const tMin = hatT ? Math.min(...tageT) : NaN;
  const ok = v => typeof v === 'number' && Number.isFinite(v);
  let pNorm = NaN;
  if (ok(tSpitze) && ok(normAtC) && tSpitze < THETA_INNEN_HOCHRECHNUNG) {
    pNorm = normAtC < tSpitze
      ? pMax * (THETA_INNEN_HOCHRECHNUNG - normAtC) / (THETA_INNEN_HOCHRECHNUNG - tSpitze)
      : pMax;
  }
  return { pMax, stunde, tag, tSpitze, tMin, normAtC, pNorm };
}

/**
 * Auslegungsspitze.
 * e: { lastgangKw, tageT (365 Tagesmittel zum Lastgang), normAt, heizlastenKw (Normheizlasten oder null), glf, verlustKw }
 * Ergebnis: { kw, quelle ('heizlast' | 'hochrechnung' | 'lastgang'), lastgangKw, stunde, summeHeizlastKw, anzahl,
 *   glf, verlustKw, normAt, tSpitze, thetaInnen }
 */
export function auslegungsSpitze(e) {
  const lg = e.lastgangKw || [];
  let peak = 0, stunde = 0;
  for (let i = 0; i < lg.length; i++) if (lg[i] > peak) { peak = lg[i]; stunde = i; }
  const normAt = Number.isFinite(e.normAt) ? e.normAt : null;
  const out = { kw: peak, quelle: 'lastgang', lastgangKw: peak, stunde, summeHeizlastKw: 0, anzahl: 0,
    glf: null, verlustKw: 0, normAt, tSpitze: null, thetaInnen: THETA_INNEN_HOCHRECHNUNG };

  const hl = (e.heizlastenKw || []).filter(v => v > 0);
  if (hl.length) {
    const summe = hl.reduce((s, v) => s + v, 0);
    const glf = Number.isFinite(e.glf) && e.glf > 0 ? Math.min(1, e.glf) : 1;
    const verlustKw = Math.max(0, Number(e.verlustKw) || 0);
    Object.assign(out, { quelle: 'heizlast', summeHeizlastKw: summe, anzahl: hl.length, glf, verlustKw,
      kw: summe * glf + verlustKw });
  } else {
    const s = spitzeHochrechnen(lg, e.tageT, normAt);
    if (s && Number.isFinite(s.pNorm)) {
      out.tSpitze = s.tSpitze;
      if (s.pNorm > peak) { out.quelle = 'hochrechnung'; out.kw = s.pNorm; }
    }
  }
  out.kw = Math.max(out.kw, peak);
  return out;
}
