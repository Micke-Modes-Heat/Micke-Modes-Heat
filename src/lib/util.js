// @ts-check
// ── Allgemeine Hilfsfunktionen ────────────────────────────────────────────

/**
 * Liest ein numerisches Input-Feld, clampt auf [min, max] und gibt bei
 * ungültigem Wert den Fallback zurück.
 * @param {string} id       - Element-ID
 * @param {number} fallback - Wert bei leerem/ungültigem Input
 * @param {number} [min]    - Untere Grenze (inklusiv), Default -Infinity
 * @param {number} [max]    - Obere Grenze (inklusiv), Default +Infinity
 * @returns {number}
 */
export function readNum(id, fallback, min = -Infinity, max = Infinity) {
  const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  const raw = parseFloat(el?.value ?? '');
  const val = isFinite(raw) ? raw : fallback;
  return Math.max(min, Math.min(max, val));
}

/**
 * Clampt einen bereits geparsten Wert auf [min, max].
 * Bei NaN/Infinity wird min zurückgegeben.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampNum(val, min, max) {
  if (!isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}
