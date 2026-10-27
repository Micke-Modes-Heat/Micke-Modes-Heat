// ── lib/pv-abschlaege.js — vom technischen zum realisierbaren PV-Potenzial ────
// Reiner Rechenteil (ohne DOM), genutzt von 03c calcGebKwp, dem PV-Modus (25)
// und dem Gutachten (17).
//
// Die Modulplatzierung liefert das TECHNISCHE Potenzial: was geometrisch nach
// Rand, Gängen, Sperrflächen und Ertragsschwelle auf das Dach passt. Davon gehen
// zwei Abschläge ab:
//   • Hindernisse (pauschal): Lichtkuppeln, RWA, Lüfter, Technikaufbauten,
//     Gauben, Dachfenster, Schornsteine — solange sie nicht als Sperrflächen
//     erfasst sind (Haken „Hindernisse erfasst" am Gebäude). Flach- und Schräg-
//     flächen getrennt, anteilig nach Modulen.
//   • Kennzeichen des Gebäudes (Denkmalschutz, Statik, Dachzustand): je
//     Kennzeichen ein Abschlag in Prozent, 100 % = Dach fällt heraus.
// Ergebnis ist das REALISIERBARE Potenzial; das WIRTSCHAFTLICHE zählt davon nur
// Anlagen ab einer Mindestgröße.

/** Kennzeichen am Gebäude (g.pvKennzeichen = { schluessel: true }) mit Standard-Abschlag in %. */
export const PV_KENNZEICHEN = [
  { key: 'denkmal', label: 'Denkmalschutz', kurz: 'Denkmal', std: 100,
    titel: 'Baudenkmal oder Ensembleschutz: PV nur mit denkmalrechtlicher Erlaubnis, häufig nicht oder nur eingeschränkt möglich.' },
  { key: 'statik', label: 'Statik kritisch', kurz: 'Statik', std: 100,
    titel: 'Tragreserve des Dachs reicht voraussichtlich nicht (z. B. leichte Hallendächer, Trapezblech) oder ist ungeklärt und kritisch.' },
  { key: 'dachSanierung', label: 'Dach sanierungsbedürftig', kurz: 'Sanierung', std: 0,
    titel: 'Dachhaut oder Abdichtung sollte vor der PV erneuert werden — Potenzial bleibt, Kosten und Zeitpunkt hängen an der Sanierung.' },
];

/** Standardwerte der Abschlagsregeln (Prozent bzw. kWp). */
export const PV_ABSCHLAG_STANDARD = { hindernisFlach: 20, hindernisSchraeg: 10, minAnlageKwp: 5 };

const _pct = (x, std) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : std;
};

/**
 * Regeln aus der Vorgabe des PV-Modus (pvModusVorgabe) lesen, fehlende mit Standard.
 * @returns {{hindernisFlach:number, hindernisSchraeg:number, minAnlageKwp:number, kennzeichen:Record<string,number>}}
 */
export function pvAbschlagRegeln(v = {}) {
  const kz = {};
  for (const k of PV_KENNZEICHEN) kz[k.key] = _pct(v.kennzeichen?.[k.key], k.std);
  const min = parseFloat(v.minAnlageKwp);
  return {
    hindernisFlach: _pct(v.hindernisFlach, PV_ABSCHLAG_STANDARD.hindernisFlach),
    hindernisSchraeg: _pct(v.hindernisSchraeg, PV_ABSCHLAG_STANDARD.hindernisSchraeg),
    minAnlageKwp: Number.isFinite(min) ? Math.max(0, min) : PV_ABSCHLAG_STANDARD.minAnlageKwp,
    kennzeichen: kz,
  };
}

/** Gesetzte Kennzeichen eines Gebäudes (Schlüssel in der Reihenfolge von PV_KENNZEICHEN). */
export function pvKennzeichenAktiv(g) {
  const k = g?.pvKennzeichen;
  return k ? PV_KENNZEICHEN.filter(x => k[x.key]).map(x => x.key) : [];
}

/**
 * Abschlagsfaktor eines Gebäudes.
 * @param {{flachAnteil:number, hindernisseErfasst?:boolean, kennzeichen?:string[], mitHindernis?:boolean}} p
 *   flachAnteil: Anteil der Module auf flachen/aufgeständerten Flächen (0…1);
 *   mitHindernis: false = pauschale Anlage ohne Belegung (Dachanteil enthält Hindernisse schon)
 * @param {ReturnType<typeof pvAbschlagRegeln>} r
 * @returns {{faktor:number, hindernis:number, kennzeichen:number}} Abschläge als Anteil 0…1
 */
export function pvAbschlag(p, r) {
  const fa = Math.max(0, Math.min(1, p.flachAnteil || 0));
  const hindernis = p.mitHindernis === false || p.hindernisseErfasst ? 0
    : (fa * r.hindernisFlach + (1 - fa) * r.hindernisSchraeg) / 100;
  let rest = 1;
  for (const k of p.kennzeichen || []) rest *= 1 - (r.kennzeichen[k] ?? 0) / 100;
  const kennzeichen = 1 - rest;
  return { faktor: (1 - hindernis) * (1 - kennzeichen), hindernis, kennzeichen };
}

/**
 * Potenzialstufen über Gebäude.
 * @param {{kwpTech:number, faktor:number, hindernis:number, kennzeichen:string[]}[]} items
 * @param {{minAnlageKwp:number}} r
 * @returns {{technisch:number, ohneHindernis:number, realisierbar:number, wirtschaftlich:number,
 *   daecher:number, ausgeschlossen:number, zuKlein:number, jeKennzeichen:Record<string,{n:number, kwp:number}>}}
 *   ohneHindernis = technisch abzüglich Hindernisse (vor Kennzeichen);
 *   jeKennzeichen: betroffene Dächer und deren technisches kWp
 */
export function pvPotenzialStufen(items, r) {
  const out = { technisch: 0, ohneHindernis: 0, realisierbar: 0, wirtschaftlich: 0,
    daecher: 0, ausgeschlossen: 0, zuKlein: 0, jeKennzeichen: {} };
  for (const it of items) {
    const t = Math.max(0, it.kwpTech || 0);
    if (!(t > 0)) continue;
    out.daecher++;
    out.technisch += t;
    out.ohneHindernis += t * (1 - (it.hindernis || 0));
    const real = t * (it.faktor ?? 1);
    out.realisierbar += real;
    if (!(real > 1e-9)) out.ausgeschlossen++;
    else if (real + 1e-9 >= r.minAnlageKwp) out.wirtschaftlich += real;
    else out.zuKlein++;
    for (const k of it.kennzeichen || []) {
      const z = out.jeKennzeichen[k] || (out.jeKennzeichen[k] = { n: 0, kwp: 0 });
      z.n++; z.kwp += t;
    }
  }
  return out;
}
