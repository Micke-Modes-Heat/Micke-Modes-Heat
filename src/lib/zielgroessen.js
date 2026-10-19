// @ts-check
// Zielgrößen je Erzeuger im Erzeugerfenster („Für 100 % Jahresenergie / Heizleistung"): Welche Leistung bräuchte
// dieser Erzeuger, damit neben den übrigen gewählten Erzeugern für den automatischen Spitzenkessel keine Restwärme
// bzw. keine Restspitze bleibt? Jede Zielgröße kostet rund 17 volle Jahressimulationen. Deshalb ist die Suche ein
// Generator: Er gibt nach jeder Simulation die Kontrolle ab, damit der Aufrufer sie in kleinen Stücken rechnen
// kann, ohne die Oberfläche anzuhalten (06c-dispatch-core.js). Ergebnis und Rechenweg sind dieselben wie zuvor.

/**
 * @typedef {{ key: string, leistKw: number }} Erzeuger
 * @typedef {{ autoGkKwh: number, autoGkPeakKw: number }} RestErgebnis
 * @typedef {{ energyTargetKw: number|null, powerTargetKw: number|null }} Zielgroesse
 */

/**
 * Kleinste Leistung, bei der der Restwert (autoGkKwh oder autoGkPeakKw) unter der Toleranz bleibt:
 * erst verdoppeln bis es reicht (höchstens bis 20 × Spitzenlast), dann 14 Halbierungsschritte.
 * @param {(kw: number) => Generator<void, RestErgebnis, void>} wert
 * @param {'autoGkKwh'|'autoGkPeakKw'} feld
 * @returns {Generator<void, number|null, void>}
 */
function* _benoetigt(wert, feld, toleranz, startKw, spitzenlastKw) {
  let upper = Math.max(1, startKw || 0);
  const hardLimit = Math.max(upper, spitzenlastKw * 20);
  while ((yield* wert(upper))[feld] > toleranz && upper < hardLimit) upper = Math.min(hardLimit, upper * 2);
  if ((yield* wert(upper))[feld] > toleranz) return null;
  let lower = 0;
  for (let i = 0; i < 14; i++) {
    const middle = (lower + upper) / 2;
    if ((yield* wert(middle))[feld] <= toleranz) upper = middle;
    else lower = middle;
  }
  return upper;
}

/**
 * Zielgrößen für alle Erzeuger in `keys`. `dispatch(erzList)` rechnet ein Jahr mit der übergebenen Erzeugerliste
 * (alle übrigen Eingaben fest) und liefert mindestens autoGkKwh und autoGkPeakKw.
 * @param {{ erzList: Erzeuger[], keys: string[], gesamtKwh: number, spitzenlastKw: number,
 *           dispatch: (erzList: Erzeuger[]) => RestErgebnis }} p
 * @returns {Generator<void, Record<string, Zielgroesse>, void>}
 */
export function* zielgroessenSuche({ erzList, keys, gesamtKwh, spitzenlastKw, dispatch }) {
  /** @type {Record<string, Zielgroesse>} */
  const out = {};
  for (const key of keys) {
    const idx = erzList.findIndex(e => e.key === key);
    if (idx < 0) continue;
    const current = erzList[idx];
    /** @type {Map<string, RestErgebnis>} */
    const cache = new Map();
    /** @param {number} kw @returns {Generator<void, RestErgebnis, void>} */
    const wert = function* (kw) {
      const k = kw.toFixed(6);
      const alt = cache.get(k);
      if (alt) return alt;
      const trial = erzList.filter(e => e.key !== key).map(e => ({ ...e }));
      trial.splice(idx, 0, { ...current, leistKw: kw });
      const r = dispatch(trial);
      const rest = { autoGkKwh: r.autoGkKwh, autoGkPeakKw: r.autoGkPeakKw };
      cache.set(k, rest);
      yield;
      return rest;
    };
    const energyTargetKw = yield* _benoetigt(wert, 'autoGkKwh', Math.max(1, gesamtKwh * .0001), current.leistKw, spitzenlastKw);
    const powerTargetKw = yield* _benoetigt(wert, 'autoGkPeakKw', Math.max(.1, spitzenlastKw * .0001), current.leistKw, spitzenlastKw);
    out[key] = { energyTargetKw, powerTargetKw };
  }
  return out;
}

/** Generator am Stück zu Ende rechnen (Tests, oder wenn kein Zeitgeber da ist). */
export function zuEnde(gen) {
  let s;
  do s = gen.next(); while (!s.done);
  return s.value;
}

/** Billiger Fingerabdruck einer Stundenreihe (Länge, Summe, gewichtete Summe) — erkennt jede inhaltliche Änderung praktisch sicher. */
export function reihenAbdruck(a) {
  if (!a) return '-';
  let s = 0, w = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; w += a[i] * ((i % 97) + 1); }
  return `${a.length}:${s}:${w}`;
}

/**
 * Wiederverwendbare Ergebnisse je Eingangsstand: Die meisten Neuberechnungen (Netz verschoben, Panel geöffnet,
 * Jahr zurückgestellt) ändern an den Eingaben der Zielgrößen nichts. Hält die letzten `max` Stände.
 */
export function erstelleZielCache(max = 8) {
  /** @type {Map<string, Record<string, Zielgroesse>>} */
  const m = new Map();
  return {
    get: (/** @type {string} */ sig) => m.get(sig),
    set(/** @type {string} */ sig, /** @type {Record<string, Zielgroesse>} */ wert) {
      m.delete(sig);
      m.set(sig, wert);
      while (m.size > max) m.delete(m.keys().next().value);
    },
    get size() { return m.size; },
  };
}
