// ── lib/netzanschluss.js — Netzanschluss-Stammdaten: Messverfahren-Vorschlag, kVA → kW ──
// DOM- und importfrei, damit es in Vitest direkt prüfbar ist. Die Oberfläche liegt in
// 22-netzanschluss-panel.js (⚡ Strom-Grundlagen › Netzanschluss), der Gutachtentext
// in 17-gutachten-grafik.js (Kapitel 3.1.1).

/** Auswahl Messverfahren — `wert` steht so im Gutachtentext („Die Messung erfolgt als …"). */
export const NA_MESSVERFAHREN = [
  { kurz: 'RLM', wert: 'registrierende Leistungsmessung (RLM)' },
  { kurz: 'SLP', wert: 'Arbeitsmessung nach Standardlastprofil (SLP)' },
];

/** Standardlastprofile gelten nach § 12 StromNZV für Entnahmen bis 100.000 kWh/a. */
export const NA_SLP_GRENZE_MWH = 100;

/** Zahleneingabe deutsch oder englisch → Zahl, null bei leer/ungültig („1.250,5" → 1250.5, „1.000" → 1000). */
export function naZahl(text) {
  let s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Leistungsangabe für den Fließtext: Zahl deutsch formatiert, sonst der Text wie eingegeben. */
export function naKvaText(kva) {
  const n = naZahl(kva);
  return n == null ? String(kva ?? '').trim() : n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

/**
 * Vorschlag fürs Messverfahren aus dem, was das Projekt über den Stromverbrauch weiß.
 *   lastgangAufloesung: 15 | 60 | null — Auflösung einer importierten Messdatei
 *   jahresMwh:          Jahresverbrauch, falls kein Lastgang vorliegt
 * → { kurz, wert, grund } | null
 */
export function naMessverfahrenVorschlag({ lastgangAufloesung = null, jahresMwh = null } = {}) {
  const [rlm, slp] = NA_MESSVERFAHREN;
  if (lastgangAufloesung === 15) return { ...rlm, grund: 'gemessener 15-min-Lastgang geladen – den liefert nur ein RLM-Zähler' };
  if (lastgangAufloesung === 60) return { ...rlm, grund: 'gemessener Stundenlastgang geladen – spricht für einen RLM-Zähler' };
  const mwh = Number(jahresMwh);
  if (!(mwh > 0)) return null;
  const text = mwh.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  return mwh > NA_SLP_GRENZE_MWH
    ? { ...rlm, grund: `Jahresverbrauch ${text} MWh über 100 MWh – Standardlastprofile gelten nur bis 100.000 kWh/a` }
    : { ...slp, grund: `Jahresverbrauch ${text} MWh bis 100 MWh – Standardlastprofil ist üblich` };
}
