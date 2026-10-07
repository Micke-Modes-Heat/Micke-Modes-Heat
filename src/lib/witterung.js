// ── lib/witterung.js — Witterungsbereinigung über Gradtagzahlen (VDI 3807 / VDI 4710, G20/15) ──
// DOM- und netzfrei. Die Tagesmitteltemperaturen liefert der Aufrufer (Open-Meteo-Archiv, siehe 34-witterung.js).
//
// Gradtagzahl G20/15: Summe über alle Heiztage (Tagesmittel < 15 °C) von (20 °C − Tagesmittel).
// Bereinigungsfaktor f = G_Mittel / G_Messjahr. f > 1: Messjahr war wärmer als üblich → Verbrauch wird angehoben.
// Bereinigt wird nur der witterungsabhängige Anteil; die Sommergrundlast (Warmwasser, Netzverluste, Prozess)
// bleibt unverändert.

export const WB = Object.freeze({ tInnen: 20, tHeizgrenze: 15, standardJahre: 20 });

/** Gradtagzahl G20/15 aus Tagesmitteltemperaturen. */
export function gradtagzahl(tagesmittel, { tInnen = WB.tInnen, tHeizgrenze = WB.tHeizgrenze } = {}) {
  let g = 0;
  for (const t of tagesmittel) if (Number.isFinite(t) && t < tHeizgrenze) g += tInnen - t;
  return g;
}

/**
 * Gradtagzahlen je Jahr aus Datum/Temperatur-Reihen (ISO-Datum 'YYYY-MM-DD').
 * Nur vollständige Jahre (≥ 365 Werte) werden übernommen.
 */
export function gradtagzahlenJeJahr(daten, temperaturen, opt) {
  const jahre = new Map();
  for (let i = 0; i < daten.length; i++) {
    const j = Number(String(daten[i]).slice(0, 4));
    if (!jahre.has(j)) jahre.set(j, []);
    jahre.get(j).push(Number(temperaturen[i]));
  }
  const out = {};
  for (const [j, t] of jahre) if (t.filter(Number.isFinite).length >= 365) out[j] = gradtagzahl(t, opt);
  return out;
}

/**
 * Bereinigungsfaktor für ein Messjahr gegenüber dem Mittel der `jahre` Jahre davor (ohne das Messjahr).
 * Liefert { faktor, gMess, gMittel, vonJahr, bisJahr, anzahl } oder null, wenn Daten fehlen.
 */
export function wbFaktor(gJeJahr, messjahr, jahre = WB.standardJahre) {
  const gMess = gJeJahr[messjahr];
  const ref = Object.keys(gJeJahr).map(Number).filter(j => j < messjahr && j >= messjahr - jahre).sort((a, b) => a - b);
  if (!(gMess > 0) || ref.length < Math.min(5, jahre)) return null;
  const gMittel = ref.reduce((s, j) => s + gJeJahr[j], 0) / ref.length;
  return { faktor: gMittel / gMess, gMess, gMittel, vonJahr: ref[0], bisJahr: ref[ref.length - 1], anzahl: ref.length };
}

/** Sommergrundlast: 10-%-Quantil der Stundenwerte im Juli und August (Warmwasser, Netzverluste, Prozess). */
export function sommerGrundlast(lastgangKw) {
  const v = [];
  for (let h = 181 * 24; h < Math.min(lastgangKw.length, 243 * 24); h++) v.push(lastgangKw[h]);
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return Math.max(0, v[Math.floor(v.length * 0.1)]);
}

/** Mittlere Leistung im Juli und August (für die Aufteilung in Warmwasser und Netzverluste). */
export function sommerMittel(lastgangKw) {
  let s = 0, n = 0;
  for (let h = 181 * 24; h < Math.min(lastgangKw.length, 243 * 24); h++) { s += lastgangKw[h]; n++; }
  return n ? s / n : 0;
}

/** Lastgang bereinigen: Grundlast bleibt, der darüber liegende Anteil wird mit dem Faktor skaliert. */
export function wbKorrigiere(lastgangKw, faktor, grundlastKw = sommerGrundlast(lastgangKw)) {
  const out = new Float32Array(lastgangKw.length);
  for (let i = 0; i < lastgangKw.length; i++) {
    const p = lastgangKw[i];
    out[i] = p > grundlastKw ? grundlastKw + (p - grundlastKw) * faktor : p;
  }
  return out;
}
