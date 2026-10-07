// ── lib/slp-kalender.js — Tagtypen-Kalender für die Standardlastprofile ──────
//
// Liefert für jeden Tag eines Jahres den Tagtyp, mit dem ein SLP-Tagesgang
// gewählt wird: 'WT' (Werktag), 'Fr' (Freitag), 'Sa', 'So'.
//
// Regeln (Stand 10/2026):
// • Wochentag aus dem Kalenderjahr (statt fest verdrahtetem Versatz).
// • Bundeseinheitliche Feiertage zählen wie Sonntag (BDEW-Konvention).
//   Landesfeiertage (Fronleichnam, Allerheiligen, …) sind bewusst nicht
//   enthalten — die Profile werden vor dem Laden eines Projekts aufgebaut.
// • 24.12. und 31.12. zählen wie Samstag (BDEW), sofern nicht ohnehin Sonntag.
// • Bundeswehr-Profile (bw=true): Weihnachtsdienstbefreiung 24.12.–31.12.
//   zählt wie Sonntag.
// • Der Freitag ist nur ein eigener Tagtyp, wenn das Profil einen Freitags-
//   gang besitzt (mitFreitag=true) — sonst gilt er als Werktag.

/** Ostersonntag (gregorianisch, Anonymer Algorithmus) als [Monat 1–12, Tag]. */
export function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return [monat, tag];
}

/** Tag des Jahres (0 = 1. Januar) für Monat 1–12 und Tag. */
export function tagImJahr(jahr, monat, tag) {
  return Math.round((Date.UTC(jahr, monat - 1, tag) - Date.UTC(jahr, 0, 1)) / 86400000);
}

/** Bundeseinheitliche gesetzliche Feiertage als Set von Tagen im Jahr (0-basiert). */
export function bundesFeiertage(jahr) {
  const [om, ot] = ostersonntag(jahr);
  const ostern = tagImJahr(jahr, om, ot);
  return new Set([
    tagImJahr(jahr, 1, 1),     // Neujahr
    ostern - 2,                // Karfreitag
    ostern + 1,                // Ostermontag
    tagImJahr(jahr, 5, 1),     // Tag der Arbeit
    ostern + 39,               // Christi Himmelfahrt
    ostern + 50,               // Pfingstmontag
    tagImJahr(jahr, 10, 3),    // Tag der Deutschen Einheit
    tagImJahr(jahr, 12, 25),   // 1. Weihnachtstag
    tagImJahr(jahr, 12, 26),   // 2. Weihnachtstag
  ]);
}

/** Wochentag 0 = Montag … 6 = Sonntag. */
export function wochentag(jahr, doy) {
  return (new Date(Date.UTC(jahr, 0, 1 + doy)).getUTCDay() + 6) % 7;
}

const _cache = new Map();

/**
 * Tagtypen für 365 Tage eines Jahres.
 * @param {number} jahr
 * @param {{bw?:boolean, mitFreitag?:boolean}} [opt]
 * @returns {string[]} 'WT' | 'Fr' | 'Sa' | 'So' je Tag
 */
export function slpTagtypen(jahr, opt = {}) {
  const bw = !!opt.bw, mitFr = !!opt.mitFreitag;
  const key = `${jahr}|${bw ? 1 : 0}|${mitFr ? 1 : 0}`;
  if (_cache.has(key)) return _cache.get(key);
  const feiertage = bundesFeiertage(jahr);
  const heiligabend = tagImJahr(jahr, 12, 24), silvester = tagImJahr(jahr, 12, 31);
  const out = new Array(365);
  for (let doy = 0; doy < 365; doy++) {
    const wd = wochentag(jahr, doy);
    let dt = wd === 6 ? 'So' : wd === 5 ? 'Sa' : (wd === 4 && mitFr) ? 'Fr' : 'WT';
    if (feiertage.has(doy)) dt = 'So';
    else if (doy >= heiligabend && doy <= silvester) {
      if (bw) dt = 'So';
      else if ((doy === heiligabend || doy === silvester) && dt !== 'So') dt = 'Sa';
    }
    out[doy] = dt;
  }
  _cache.set(key, out);
  return out;
}
