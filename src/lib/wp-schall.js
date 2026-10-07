// ── lib/wp-schall.js — Schallausbreitung der LW-WP-Außengeräte ──
// DOM-frei. Überschlägige Ausbreitungsrechnung in Anlehnung an DIN ISO 9613-2: jedes Außengerät ist eine
// Punktquelle über reflektierendem Boden (Halbraum, D_Ω = +3 dB), geometrische Ausbreitung und Luftabsorption;
// Boden-, Bewuchs- und Abschirmdämpfung bleiben unberücksichtigt (konservativ). Die Pegel aller Geräte werden
// energetisch addiert. Prüfung an den Herstellerangaben: L_WA 92 dB(A) → L_pA in 10 m = 64 dB(A).

/** Luftabsorption in dB/m (A-bewertet, mittlere Verhältnisse, ca. 500 Hz). */
export const LUFT_DB_JE_M = 0.002;

/** Schalldruckpegel einer Punktquelle (L_WA in dB(A)) in r Metern Abstand, Halbraum. */
export function schallPegel(lwa, r) {
  const d = Math.max(1, r);
  return lwa - 20 * Math.log10(d) - 11 + 3 - LUFT_DB_JE_M * d;
}

/** Energetische Summe mehrerer Pegel in dB. */
export function pegelSumme(pegel) {
  const s = pegel.reduce((a, l) => a + 10 ** (l / 10), 0);
  return s > 0 ? 10 * Math.log10(s) : -Infinity;
}

/** Schätzung der Schallleistung eines Außengeräts aus seiner Heizleistung (ohne Herstellerangabe). */
export function lwaSchaetzung(kw) {
  const x = Math.max(kw, 1);
  const roh = x <= 50 ? 47 + 12 * Math.log10(x) : 30 + 22 * Math.log10(x);
  return Math.round(Math.min(100, Math.max(45, roh)));
}

/**
 * Schallquellen einer Aufstellung (Ergebnis von wpAufstellung/wpAufstellungForm), gedreht um drehungGrad im
 * Uhrzeigersinn → [{ ost, nord, lwa }] in m relativ zur Flächenmitte.
 * lwaGesamt (optional): vorgegebener Gesamt-Schallleistungspegel, gleichmäßig auf die Geräte verteilt.
 */
export function wpSchallQuellen(auf, drehungGrad = 0, lwaGesamt = null) {
  const n = auf.geraete.length || 1;
  const jeGeraet = Number.isFinite(lwaGesamt) && lwaGesamt > 0
    ? lwaGesamt - 10 * Math.log10(n)
    : (auf.modul.lwa ?? lwaSchaetzung(auf.modul.kw));
  const w = (Number(drehungGrad) || 0) * Math.PI / 180, c = Math.cos(w), s = Math.sin(w);
  return auf.geraete.map(g => ({ ost: g.x * c + g.y * s, nord: -g.x * s + g.y * c, lwa: jeGeraet }));
}

/** Gesamt-Schallleistungspegel der Quellen. */
export function lwaGesamt(quellen) { return pegelSumme(quellen.map(q => q.lwa)); }

/** Pegel am Punkt (ost/nord in m relativ zur Flächenmitte). */
export function pegelAm(quellen, ost, nord) {
  return pegelSumme(quellen.map(q => schallPegel(q.lwa, Math.hypot(ost - q.ost, nord - q.nord))));
}

/**
 * Isophone: Linie gleichen Pegels als Polygon [{ ost, nord }] (Strahlen ab der Flächenmitte, Bisektion je Richtung).
 * Leeres Array, wenn der Pegel schon an der Fläche unterschritten wird.
 */
export function isophone(quellen, ziel, schritte = 72, maxM = 3000) {
  if (!quellen.length || pegelAm(quellen, 0, 0) < ziel) return [];
  const out = [];
  for (let i = 0; i < schritte; i++) {
    const a = 2 * Math.PI * i / schritte, dx = Math.sin(a), dy = Math.cos(a);
    if (pegelAm(quellen, dx * maxM, dy * maxM) >= ziel) return [];   // reicht über den Rechenbereich hinaus
    let lo = 0, hi = maxM;
    for (let k = 0; k < 40 && hi - lo > 0.05; k++) {
      const m = (lo + hi) / 2;
      if (pegelAm(quellen, dx * m, dy * m) >= ziel) lo = m; else hi = m;
    }
    out.push({ ost: dx * hi, nord: dy * hi });
  }
  return out;
}

/** Größter Abstand von der Flächenmitte, bis zu dem der Pegel ziel erreicht wird (0, wenn nie). */
export function isophonRadius(quellen, ziel) {
  const p = isophone(quellen, ziel);
  return p.length ? Math.max(...p.map(q => Math.hypot(q.ost, q.nord))) : 0;
}

/** Nächster Punkt eines Polygons [{ ost, nord }] zu (0, 0) — überschlägiger Immissionsort an der Fassade. */
export function naechsterFassadenpunkt(polygon) {
  let best = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.ost - a.ost, dy = b.nord - a.nord, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(a.ost * dx + a.nord * dy) / l2)) : 0;
    const p = { ost: a.ost + t * dx, nord: a.nord + t * dy };
    const d = Math.hypot(p.ost, p.nord);
    if (!best || d < best.d) best = { ...p, d };
  }
  return best;
}
