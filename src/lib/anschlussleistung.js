// Anschlussleistung eines Verbrauchers: nächsthöhere Anschlussklasse zur
// geschätzten Leistung inklusive Reserve. Ein von Hand eingetragener Wert hat
// immer Vorrang. Der automatische Wert wird NICHT in die Props geschrieben,
// sondern bei Bedarf aus der Leistung abgeleitet — so bleibt er bei geänderter
// Leistung aktuell und ist von einer Handeingabe unterscheidbar.

/** Übliche Anschlussgrößen in kW (NH-Sicherung 50…400 A bei 400 V), darüber kVA-Stufen. */
export const ANSCHLUSS_STUFEN_KW = [30, 43, 55, 69, 86, 110, 138, 172, 215, 276, 400, 630, 1000];

/** Mindestreserve auf die geschätzte Leistung. */
export const ANSCHLUSS_RESERVE = 0.20;

/** Nächsthöhere Stufe ≥ kw; oberhalb der Staffel auf 100 kW aufgerundet. */
export function anschlussKlasse(kw) {
  if (!(kw > 0)) return 0;
  const s = ANSCHLUSS_STUFEN_KW.find(x => x >= kw);
  return s ?? Math.ceil(kw / 100) * 100;
}

/** Automatische Anschlussleistung zur geschätzten Leistung (kW), 0 ohne Leistung. */
export function anschlussAuto(leistungKW) {
  const p = parseFloat(leistungKW);
  return p > 0 ? anschlussKlasse(p * (1 + ANSCHLUSS_RESERVE)) : 0;
}

/**
 * Wirksame Anschlussleistung eines Verbraucher-Props-Objekts.
 * @returns {{kw:number, auto:boolean}} auto = aus der Leistung abgeleitet
 */
export function anschlussWirksam(props) {
  const manuell = parseFloat(props?.anschlussleistungKW);
  if (manuell > 0) return { kw: manuell, auto: false };
  return { kw: anschlussAuto(props?.leistungKW), auto: true };
}
