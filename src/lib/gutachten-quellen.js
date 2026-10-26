// @ts-check
// ── gutachten-quellen.js — Herkunft der Gutachten-Abbildungen in der Auswertung ──
//
// Für „Gutachten neben der Auswertung“ (src/21): Zu einer Abbildung, Tabelle oder einem berechneten
// Textbaustein (figurId aus dem Katalog in src/17) der Abschnitt der Seitennavigation (src/49), in dem
// man die Zahlen dahinter nachsieht. Schlüssel wie dort: Analyse-Abschnitt oder v:-Ansicht.
//
// Erste passende Regel gewinnt. Ohne Treffer kein Sprung: Potenzial- und Einleitungstexte rechnen
// nichts; Resilienz liegt in Planung › Strom (Blackout-Modus), nicht in der Auswertung. Gelbe
// Platzhalter haben bewusst keinen Eintrag — sie stehen gerade für Angaben, die das Tool nicht kennt.

/** Abschnitt → Titel, wie ihn die Seitennavigation zeigt. */
export const GQ_ABSCHNITTE = /** @type {Record<string, string>} */ ({
  waerme: 'Lastgang und Dauerlinie',
  strom: 'Strombilanz',
  nap: 'Netzanschluss-Lastgang',
  netzanschluss: 'Netzanschluss',
  ergebnisblatt: 'Ergebnisblatt Elektro',
  pva: 'Photovoltaik',
  wirtschaft: 'Wirtschaftlichkeit',
  emissionen: 'Emissionen',
  ausbauplaner: 'Maßnahmen und Fahrplan',
  'v:vergleich': 'Variantenvergleich',
  'v:gebaeude': 'Gebäudeauswertung',
});

/** @type {Array<[RegExp, string]>} */
const REGELN = [
  [/^gebaeude-/, 'v:gebaeude'],
  [/^(lastgang-strom|monatsbilanz-strom|stromdaten-)/, 'strom'],
  [/^(va-emissionen|va-klima|verbrauch-co2)/, 'emissionen'],
  [/^(lastgang-|verbrauch-|ist-erzeuger-|waerme-ist-|waerme-wea-)/, 'waerme'],
  [/^(bedarf-|anschlussleistung-entwicklung)/, 'nap'],
  [/^netzanschluss-/, 'netzanschluss'],
  [/^(netz-|ms-kabel-|trafostationen|erzeugung-ist|notstrom-ist|elektro-|fazit-elektro-)/, 'ergebnisblatt'],
  [/^pv-(?!resilienz)/, 'pva'],
  [/^(kosten-|fazit-fahrplan)/, 'ausbauplaner'],
  [/^(va-kosten|va-sensitivitaet|va-pv|waerme-wirtschaft)/, 'wirtschaft'],
  [/^(va-|waerme-varianten)/, 'v:vergleich'],
];

/**
 * Abschnitt der Auswertung, aus dem eine Abbildung stammt.
 * @param {string} figurId
 * @returns {{ key: string, titel: string } | null}
 */
export function gqQuelle(figurId) {
  const id = String(figurId || '');
  for (const [re, key] of REGELN) if (re.test(id)) return { key, titel: GQ_ABSCHNITTE[key] };
  return null;
}
