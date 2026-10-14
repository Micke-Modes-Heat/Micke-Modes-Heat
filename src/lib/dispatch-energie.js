// ── lib/dispatch-energie.js — Kennwerte aus den Energiemengen der Einsatzplanung (DOM-frei) ──
// window._dispatchEnergy: je Erzeuger { waermeMwh (direkt an die Last), elMwh, ladeMwh (in den Speicher geladen),
// verworfenMwh, erzeugtMwh }, dazu '_thermSpeicher' { waermeMwh (an die Last entladen), geladenMwh, verlustMwh } und
// '_autoGk'. Die Summe aller waermeMwh (inkl. Speicher und Auto-Kessel) ist die gedeckte Last.
// Ältere Stände ohne ladeMwh/erzeugtMwh werden wie bisher gelesen (erzeugt = direkt).

/** Erneuerbare Wärmeerzeuger (Wärmepumpen mit Umweltwärme, Biomasse, Solarthermie). */
export const EE_WAERME_KEYS = Object.freeze(['lwwp', 'fg', 'geo', 'pellets', 'hhs', 'solarthermie']);

const zahl = v => (Number.isFinite(v) ? v : 0);

/** Insgesamt erzeugte Wärme eines Erzeugers in MWh (direkt + Speicherladung + verworfen). */
export function erzeugtMwh(en, key) {
  const e = en?.[key];
  if (!e) return 0;
  return Number.isFinite(e.erzeugtMwh) ? e.erzeugtMwh : zahl(e.waermeMwh) + zahl(e.ladeMwh) + zahl(e.verworfenMwh);
}

/** Jahresarbeitszahl einer Wärmepumpe: Σ erzeugte Wärme / Σ Strom (VDI 4650); null ohne Strom. */
export function jazAus(en, key) {
  const el = zahl(en?.[key]?.elMwh);
  return el > 0 ? erzeugtMwh(en, key) / el : null;
}

/** Gedeckte Last in MWh: alle Erzeuger direkt + Speicherentladung + Auto-Kessel. */
export function lastMwh(en) {
  return Object.values(en || {}).reduce((s, e) => s + zahl(e?.waermeMwh), 0);
}

/** Herkunft der Speicherwärme: Anteil je Erzeuger an der geladenen Wärme (Summe 1), leer ohne Ladung. */
export function speicherHerkunft(en) {
  const out = {};
  let summe = 0;
  for (const [k, e] of Object.entries(en || {})) {
    if (k === '_thermSpeicher') continue;
    const l = zahl(e?.ladeMwh);
    if (l > 0) { out[k] = l; summe += l; }
  }
  if (summe <= 0) return {};
  for (const k of Object.keys(out)) out[k] /= summe;
  return out;
}

/**
 * An die Last gelieferte Wärme je Erzeuger, die Speicherentladung anteilig nach Herkunft der Ladung zugeordnet
 * (Speicherverluste damit ebenfalls anteilig). Summe = gedeckte Last.
 */
export function waermeAnLastJeErzeuger(en) {
  const out = {};
  const herkunft = speicherHerkunft(en);
  const entladen = zahl(en?._thermSpeicher?.waermeMwh);
  for (const [k, e] of Object.entries(en || {})) {
    if (k === '_thermSpeicher') continue;
    out[k] = zahl(e?.waermeMwh) + entladen * (herkunft[k] || 0);
  }
  // Entladung ohne bekannte Herkunft (ältere Stände): als eigener Posten
  const zugeordnet = Object.values(herkunft).reduce((s, a) => s + a, 0);
  if (entladen > 0 && zugeordnet < 1e-9) out._thermSpeicher = entladen;
  return out;
}

/** EE-Anteil an der gedeckten Last in % (Speicherwärme nach Herkunft der Ladung). */
export function eeAnteilPct(en, eeKeys = EE_WAERME_KEYS) {
  const last = lastMwh(en);
  if (last <= 0) return 0;
  const jeErz = waermeAnLastJeErzeuger(en);
  const ee = eeKeys.reduce((s, k) => s + zahl(jeErz[k]), 0);
  return Math.min(100, ee / last * 100);
}
