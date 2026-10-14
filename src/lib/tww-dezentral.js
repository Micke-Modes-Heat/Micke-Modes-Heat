// ── lib/tww-dezentral.js — Trinkwarmwasser dezentral, Wärmenetz im Sommer aus (DOM-frei) ──
// Wird das Trinkwarmwasser in den Gebäuden erzeugt (z. B. elektrische Durchlauferhitzer), liefert das Netz nur
// Raumwärme und kann außerhalb der Heizperiode abgeschaltet werden: dann weder Wärmelieferung noch Netzverluste.

/**
 * Netzbetrieb je Stunde: Heiztag, wenn das gleitende Mittel der Tagesmitteltemperaturen (dieser und die
 * vorangehenden tage−1 Tage) die Heizgrenze nicht überschreitet. Ergebnis: Uint8Array (1 = Netz in Betrieb).
 * @param {ArrayLike<number>} tempH stündliche Außentemperatur
 * @param {number} heizgrenze °C (Tagesmittel)
 * @param {number} tage Länge des gleitenden Mittels (Trägheit gegen kurzes Ein-/Ausschalten)
 */
export function netzBetriebStunden(tempH, heizgrenze = 15, tage = 3) {
  const n = tempH.length;
  const anzahlTage = Math.ceil(n / 24);
  const tagMittel = new Float64Array(anzahlTage);
  for (let d = 0; d < anzahlTage; d++) {
    let s = 0, k = 0;
    for (let h = d * 24; h < Math.min(n, d * 24 + 24); h++) { s += Number(tempH[h]) || 0; k++; }
    tagMittel[d] = k ? s / k : 0;
  }
  const an = new Uint8Array(n);
  const t = Math.max(1, Math.round(tage));
  for (let d = 0; d < anzahlTage; d++) {
    let s = 0, k = 0;
    for (let j = Math.max(0, d - t + 1); j <= d; j++) { s += tagMittel[j]; k++; }
    const heiztag = s / k <= heizgrenze ? 1 : 0;
    for (let h = d * 24; h < Math.min(n, d * 24 + 24); h++) an[h] = heiztag;
  }
  return an;
}

/**
 * Raumwärme auf die Betriebsstunden legen: außerhalb null, die Jahresmenge bleibt erhalten (die wenigen
 * Heizstunden außerhalb der Heizperiode werden anteilig auf die Betriebsstunden verteilt).
 * @returns {{ kw: Float32Array, verschobenMwh: number }}
 */
export function raumwaermeImBetrieb(raumKw, an) {
  let gesamt = 0, imBetrieb = 0;
  for (let h = 0; h < raumKw.length; h++) { gesamt += raumKw[h]; if (an[h]) imBetrieb += raumKw[h]; }
  const kw = new Float32Array(raumKw.length);
  if (!(imBetrieb > 0)) return { kw, verschobenMwh: 0 };
  const f = gesamt / imBetrieb;
  for (let h = 0; h < raumKw.length; h++) kw[h] = an[h] ? raumKw[h] * f : 0;
  return { kw, verschobenMwh: (gesamt - imBetrieb) / 1000 };
}

/**
 * Gemessener oder vorgegebener Lastgang (inkl. TWW und Netzverluste) → nur Raumwärme im Netzbetrieb.
 * Der TWW-Sockel ist die Sommergrundlast abzüglich der Netzverluste (verlustKw konstant je Betriebsstunde).
 * @returns {{ raumKw: Float32Array, twwKw: number }}
 */
export function raumwaermeAusLastgang(lastgangKw, sommerGrundlastKw, verlustKw) {
  const twwKw = Math.max(0, (sommerGrundlastKw || 0) - (verlustKw || 0));
  const raumKw = new Float32Array(lastgangKw.length);
  for (let h = 0; h < lastgangKw.length; h++) raumKw[h] = Math.max(0, lastgangKw[h] - twwKw - (verlustKw || 0));
  return { raumKw, twwKw };
}
