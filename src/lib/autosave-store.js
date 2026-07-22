// @ts-check
// Rotierender Autosave-Speicher. Große Projekte landen in IndexedDB statt im
// engen localStorage; drei Generationen schützen den letzten brauchbaren Stand.
const DB_NAME = 'micke-heat-autosave';
const STORE_NAME = 'snapshots';
const FALLBACK_KEY = 'energiekarte_autosave';
const MAX_GENERATIONS = 3;

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB nicht verfügbar')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, {keyPath: 'savedAt'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Autosave-Datenbank konnte nicht geöffnet werden'));
  });
}

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
function requestResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Autosave-Zugriff fehlgeschlagen'));
  });
}

/** @param {Record<string, any>} project @param {number} [savedAt] */
export function makeAutosaveSnapshot(project, savedAt = Date.now()) {
  return {savedAt, schemaVersion: project.version, project};
}

/** @param {Record<string, any>} project */
export async function saveAutosaveProject(project) {
  const snapshot = makeAutosaveSnapshot(structuredClone(project));
  try {
    const db = await openDb();
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    await requestResult(store.put(snapshot));
    const keys = await requestResult(store.getAllKeys());
    keys.sort((a, b) => Number(b) - Number(a));
    await Promise.all(keys.slice(MAX_GENERATIONS).map(key => requestResult(store.delete(key))));
    db.close();
    return snapshot;
  } catch (idbError) {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
      return snapshot;
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      const idbMessage = idbError instanceof Error ? idbError.message : String(idbError);
      throw new Error(`Autosave fehlgeschlagen: ${fallbackMessage || idbMessage}`);
    }
  }
}

export async function loadLatestAutosave() {
  try {
    const db = await openDb();
    const snapshots = await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    db.close();
    snapshots.sort((a, b) => Number(b.savedAt) - Number(a.savedAt));
    if (snapshots[0]) return snapshots[0];
  } catch { /* localStorage-Kompatibilitätsfallback folgt */ }
  const raw = localStorage.getItem(FALLBACK_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return parsed.project ? parsed : makeAutosaveSnapshot(parsed, 0);
}
