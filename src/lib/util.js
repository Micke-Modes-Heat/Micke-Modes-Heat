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

let idFallbackCounter = 0;

/**
 * Erzeugt eine praktisch kollisionsfreie ID. Der monotone Fallback ist für
 * ältere/file:-Browser gedacht, in denen crypto.randomUUID nicht existiert.
 * @param {string} prefix
 * @returns {string}
 */
export function createId(prefix) {
  const safePrefix = String(prefix || 'id').replace(/[^a-zA-Z0-9_-]/g, '_');
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${safePrefix}_${uuid}`;
  idFallbackCounter += 1;
  return `${safePrefix}_${Date.now().toString(36)}_${idFallbackCounter.toString(36)}`;
}
