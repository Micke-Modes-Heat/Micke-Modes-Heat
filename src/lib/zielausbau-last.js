// ── lib/zielausbau-last.js — Stromlastgang im Zielausbau ──
//
// Grundlage der PV-Analyse (09d): Gerechnet wird gegen den Zustand nach der
// Elektrifizierung, nicht gegen die Messung allein. Der Zielausbau-Lastgang ist
//
//   Messung (Referenzjahr)
//   + Gebäudezubau − Rückbau     (Verbraucher mit Bau-/Abrissjahr nach dem Messjahr)
//   + Wärmekonzept               (neue Wärmepumpen/Stromkessel, Stundenwerte der Wärmeberechnung)
//   + Ladeinfrastruktur          (neue Ladepunkte mit ihrem Ladeprofil)
//
// dieselben Maßnahmen und Stufen wie die Bedarfsprognose (lib/bedarfsprognose.js,
// Gutachten 5.3.1–5.3.3) — die Stundenwerte je Baustein liefert die NAP-Analyse (13o).
// Hier wird nur zusammengesetzt, auf die Länge des Lastgangs gebracht und bilanziert.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.

/** Bausteine des Zielausbaus in Gutachten-Reihenfolge (Schlüssel wie BP_STUFEN + 'sonstige'). */
export const ZL_BAUSTEINE = [
  { key: 'gebaeude', label: 'Gebäudezubau und Rückbau' },
  { key: 'waerme',   label: 'Wärmekonzept (Wärmepumpen, Stromkessel)' },
  { key: 'lade',     label: 'Ladeinfrastruktur' },
  { key: 'sonstige', label: 'Sonstige Verbraucher' },
];

/**
 * Monatsanteile des Heizstroms einer Wärmepumpe (Raumwärme + Warmwasser, Summe 1).
 * Nur Ersatz, wenn die Wärmeberechnung für die Anlage keine Stundenwerte hat —
 * vorher lief eine Wärmepumpe ohne Profil rechnerisch das ganze Jahr mit voller Leistung.
 */
export const ZL_WP_MONATSANTEIL = [0.17, 0.15, 0.13, 0.08, 0.04, 0.02, 0.015, 0.015, 0.03, 0.07, 0.12, 0.16];
const MONATSTAGE = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Vollaststunden des Ersatzprofils (elektrisch, Heizbetrieb einer WP im Gebäudebestand). */
export const ZL_WP_VOLLASTSTUNDEN = 2000;

/**
 * Ersatz-Stundenprofil einer Wärmepumpe ohne eigene Stundenwerte: Jahresenergie
 * = kw × Vollaststunden, verteilt nach Monatsanteilen, innerhalb eines Monats
 * gleichmäßig. Die Spitze bleibt dabei unter der Nennleistung.
 * @returns {Float32Array} 8.760 Stundenwerte in kW
 */
export function zlWpErsatzProfil(kw, vollaststunden = ZL_WP_VOLLASTSTUNDEN) {
  const out = new Float32Array(8760);
  if (!(kw > 0)) return out;
  const jahr = kw * vollaststunden;
  let h = 0;
  for (let m = 0; m < 12; m++) {
    const stunden = MONATSTAGE[m] * 24;
    const p = Math.min(kw, jahr * ZL_WP_MONATSANTEIL[m] / stunden);
    for (let i = 0; i < stunden; i++) out[h++] = p;
  }
  return out;
}

/**
 * Stundenreihe (8.760 Werte) auf die Länge eines Lastgangs bringen:
 * stündlich direkt, 15-min je Stunde viermal; ein Schaltjahrstag am Ende
 * wiederholt den letzten Tag (bei Lasten besser als 0 — die Last fällt nicht weg).
 */
export function zlAufLaenge(h, N) {
  const out = new Float32Array(N);
  if (!h?.length) return out;
  const n = Math.min(8760, h.length);
  const proStunde = N > 8784 ? 4 : 1;
  for (let i = 0; i < N; i++) {
    let s = Math.floor(i / proStunde);
    if (s >= n) s -= 24 * Math.ceil((s - n + 1) / 24);   // Überhang: letzter Tag
    out[i] = s >= 0 ? (h[s] || 0) : 0;
  }
  return out;
}

/** Energie einer Leistungsreihe in MWh. */
export function zlMwh(arr, dt) {
  let s = 0;
  for (let i = 0; i < (arr?.length || 0); i++) s += arr[i];
  return s * dt / 1000;
}

/**
 * Zielausbau-Lastgang aus Messung und Bausteinen.
 * basis: Lastgang (kW je Zeitschritt, Länge N), dt: Zeitschritt in h.
 * beitraege: { gebaeude?, waerme?, lade?, sonstige? } — Stundenreihen (8.760, kW, mit Vorzeichen:
 *   Rückbau negativ). Fehlende Bausteine zählen 0.
 * Negative Summen (Rückbau größer als die Restlast) werden auf 0 gekappt — die PV-Simulation
 * kennt keine negative Last; die gekappte Energie wird ausgewiesen.
 * @returns {{ arr: Float32Array, basisMwh, summeMwh, gekapptMwh,
 *             bilanz: [{ key, label, mwh, spitzeKw }] }}
 */
export function zlZusammensetzen(basis, beitraege = {}, { dt = 1 } = {}) {
  const N = basis?.length || 0;
  const arr = new Float32Array(N);
  for (let i = 0; i < N; i++) arr[i] = basis[i] || 0;
  const bilanz = [];
  for (const b of ZL_BAUSTEINE) {
    const h = beitraege[b.key];
    if (!h?.length) continue;
    const r = zlAufLaenge(h, N);
    let spitze = 0, summe = 0;
    for (let i = 0; i < N; i++) {
      arr[i] += r[i];
      summe += r[i];
      if (Math.abs(r[i]) > Math.abs(spitze)) spitze = r[i];
    }
    if (Math.abs(summe) < 1e-9) continue;
    bilanz.push({ key: b.key, label: b.label, mwh: summe * dt / 1000, spitzeKw: spitze });
  }
  let gekappt = 0;
  for (let i = 0; i < N; i++) if (arr[i] < 0) { gekappt -= arr[i]; arr[i] = 0; }
  return {
    arr, bilanz,
    basisMwh: zlMwh(basis, dt),
    summeMwh: zlMwh(arr, dt),
    gekapptMwh: gekappt * dt / 1000,
  };
}
