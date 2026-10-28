// ── Stromlast je Gebäude schätzen (Reiter Planung › Strom › Verbrauch) ────────
// Reine Rechnung ohne DOM/Globals. Zwei Wege zur Leistung des Verbraucher-Assets:
//   energie: Jahresenergie (Zähler oder spezStrom × NGF) ÷ Vollbenutzungsstunden
//            des Nutzungstyps — Leistung folgt aus der Energie (Standard)
//   flaeche: Grundfläche × W/m² des BDEW-Profils (alter Weg der Gebäudekarte)
// Beide Werte werden immer berechnet, damit der Reiter die Abweichung zeigen kann.

export const LAST_METHODEN = {
  energie: { label: 'Energie ÷ Vollbenutzungsstunden', kurz: 'Energie ÷ Vbh',
    text: 'Jahresverbrauch (Zähler, sonst Kennwert × Nutzfläche) geteilt durch die Vollbenutzungsstunden des Nutzungstyps.' },
  flaeche: { label: 'Grundfläche × W/m²', kurz: 'Fläche × W/m²',
    text: 'Grundfläche mal Leistungskennwert des Lastprofils (ohne Geschosse, ohne Bezug zum Jahresverbrauch).' },
};
export const LAST_METHODE_STANDARD = 'energie';

// Leistungsquelle am Verbraucher-Asset (props.leistungQuelle)
export const LAST_QUELLEN = {
  schaetzung: 'Schätzung',
  hand:       'von Hand',
  kalibriert: 'kalibriert (NAP)',
};

const _r1 = x => Math.round(x * 10) / 10;

/**
 * @param {object} e
 * @param {number} e.energieMwh       Jahresverbrauch MWh/a (0 = unbekannt)
 * @param {boolean} [e.zaehler]       Energie stammt aus einem eingetragenen Verbrauch
 * @param {number} e.grundflaecheM2
 * @param {number} e.vbh              Vollbenutzungsstunden h/a
 * @param {number} e.wpm2             Leistungskennwert W/m² des Profils
 * @param {string} [e.methode]
 */
export function lastSchaetzen({ energieMwh, zaehler = false, grundflaecheM2, vbh, wpm2, methode = LAST_METHODE_STANDARD }) {
  const E = Number(energieMwh) > 0 ? Number(energieMwh) : 0;
  const h = Number(vbh) > 0 ? Number(vbh) : 0;
  const fl = Number(grundflaecheM2) > 0 ? Number(grundflaecheM2) : 0;
  const w = Number(wpm2) > 0 ? Number(wpm2) : 0;
  const kwEnergie = E > 0 && h > 0 ? _r1(E * 1000 / h) : null;
  const kwFlaeche = fl > 0 && w > 0 ? _r1(fl * w / 1000) : null;
  const m = LAST_METHODEN[methode] ? methode : LAST_METHODE_STANDARD;
  // Fehlt der gewählte Weg (z. B. keine Energie), greift der andere
  const kw = m === 'energie' ? (kwEnergie ?? kwFlaeche) : (kwFlaeche ?? kwEnergie);
  const ersatz = kw != null && (m === 'energie' ? kwEnergie == null : kwFlaeche == null);
  return {
    energieMwh: E || null,
    energieQuelle: E ? (zaehler ? 'zaehler' : 'kennwert') : null,
    kwEnergie, kwFlaeche, kw, methode: m, ersatz,
    // Verhältnis der beiden Wege (> 1: Fläche × W/m² liegt höher)
    faktor: kwEnergie && kwFlaeche ? kwFlaeche / kwEnergie : null,
  };
}

/**
 * Wie ein Verbraucher im Stundenlastgang (NAP-, Knotenpunkt-Analyse) skaliert wird.
 *   'energie': Profil (Summe 1) × Jahresenergie — der Lastgang trägt genau den
 *              geschätzten bzw. gezählten Jahresverbrauch des Gebäudes. Kein GZF:
 *              ein Standardlastprofil ist schon ein durchmischter Verlauf.
 *   'spitze':  Profil ÷ Profilspitze × leistungKW — für bewusst gesetzte Leistungen
 *              (von Hand, an der NAP-Messung kalibriert) und ohne bekannte Energie.
 * Schätzwerte und Werte ohne Quellangabe folgen der Energie, sobald sie bekannt ist.
 * @param {{quelle?:string|null, energieKwh?:number|null, leistungKw?:number|null}} e
 * @returns {'energie'|'spitze'|null}
 */
export function verbraucherSkalierung({ quelle, energieKwh, leistungKw }) {
  const E = Number(energieKwh) > 0, P = Number(leistungKw) > 0;
  if (P && (quelle === 'hand' || quelle === 'kalibriert')) return 'spitze';
  if (E) return 'energie';
  return P ? 'spitze' : null;
}

/** Gleich, wenn höchstens 0,1 kW bzw. 2 % auseinander. */
export function lastGleich(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(0.1, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * Zustand eines Gebäudes im Reiter.
 * 'kein-asset' · 'leer' (Asset ohne kW) · 'gleich' · 'abweichend' · 'geschuetzt' (hand/kalibriert, abweichend)
 */
export function lastZustand({ hatAsset, assetKw, quelle, schaetzKw }) {
  if (!hatAsset) return 'kein-asset';
  if (!(Number(assetKw) > 0)) return 'leer';
  if (schaetzKw == null || lastGleich(Number(assetKw), schaetzKw)) return 'gleich';
  return quelle === 'hand' || quelle === 'kalibriert' ? 'geschuetzt' : 'abweichend';
}

/**
 * Welche Gebäude eine Übernahme ändert.
 *   umfang 'leer':      nur Verbraucher ohne Leistung
 *   umfang 'schaetzung': zusätzlich abweichende, die aus einer Schätzung stammen
 *                        (Quelle 'schaetzung' oder unbekannt bei älteren Projekten)
 *   umfang 'alle':      auch von Hand gesetzte und kalibrierte Werte
 * @param {{zustand:string, quelle?:string}} z
 */
export function lastWirdUebernommen(z, umfang) {
  if (z.zustand === 'kein-asset' || z.zustand === 'gleich') return false;
  if (z.zustand === 'leer') return true;
  if (umfang === 'alle') return true;
  if (umfang === 'schaetzung') return z.zustand === 'abweichend';
  return false;
}
