// ── 17a-fotos-storage.js — Foto-Speicher mit Auto-Detect ────────────────────
// Drei Backends, in Reihenfolge bevorzugt:
//   1. IndexedDB  — Firefox auf file:// + alle Browser auf http(s)/localhost
//                   Praktisch unbegrenzt (mehrere GB), echtes Auto-Save
//   2. localStorage — Edge/Chrome auf file:// (IndexedDB blockiert)
//                     Nur ~5–10 MB, reicht für ~20 komprimierte Fotos
//   3. RAM         — Letzter Fallback, lebt nur in der Tab-Session
//
// Public API (alle async, returnen Promise):
//   savePhoto(id, blob, meta)  — speichert ein Foto
//   getPhoto(id)               — { blob, meta } oder null
//   deletePhoto(id)            — true/false
//   listPhotos()               — Array von { id, meta }
//   getStorageStatus()         — { backend, available, used, limit, infoText }
//   onStorageChange(cb)        — Callback bei Änderungen (für UI-Updates)

const DB_NAME = 'energieplanung-fotos';
const DB_VERSION = 1;
const STORE = 'photos';
const LS_PREFIX = 'epfoto_';
const LS_INDEX_KEY = 'epfoto_index';

// Backends-Detection
let _backend = null;       // 'indexeddb' | 'localstorage' | 'ram'
let _dbPromise = null;
let _ramStore = new Map(); // id → { blob, meta }
let _changeListeners = [];

// ── Backend-Detection (lazy, einmalig) ──────────────────────────────────────
async function detectBackend() {
  if (_backend) return _backend;

  // 1) IndexedDB versuchen
  if (typeof indexedDB !== 'undefined') {
    try {
      await openDb();
      _backend = 'indexeddb';
      return _backend;
    } catch (e) {
      console.warn('IndexedDB nicht verfügbar:', e?.message || e);
    }
  }

  // 2) localStorage als Fallback
  try {
    if (typeof localStorage !== 'undefined') {
      // Schreibtest
      const testKey = '__epfoto_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      _backend = 'localstorage';
      return _backend;
    }
  } catch (e) {
    console.warn('localStorage nicht verfügbar:', e?.message || e);
  }

  // 3) Last resort: RAM
  _backend = 'ram';
  return _backend;
}

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror   = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = ev => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
  });
  return _dbPromise;
}

// ── Public: Speichern ───────────────────────────────────────────────────────
export async function savePhoto(id, blob, meta = {}) {
  const backend = await detectBackend();
  const record = {
    id, blob, meta: { ...meta, createdAt: meta.createdAt || Date.now() },
  };

  if (backend === 'indexeddb') {
    const db = await openDb();
    await idbPut(db, record);
  } else if (backend === 'localstorage') {
    // localStorage kann nur Strings → Blob → Base64 dataURL
    const dataUrl = await blobToDataUrl(blob);
    const lsRecord = { id, dataUrl, meta: record.meta };
    try {
      localStorage.setItem(LS_PREFIX + id, JSON.stringify(lsRecord));
      const idx = lsLoadIndex();
      if (!idx.includes(id)) { idx.push(id); lsSaveIndex(idx); }
    } catch (e) {
      // Quota überschritten → werfen, damit UI den User informiert
      throw new Error('localStorage voll — Auto-Save nicht möglich. Bitte manuell speichern.');
    }
  } else {
    _ramStore.set(id, record);
  }
  notifyChange();
  return id;
}

// ── Public: Laden ───────────────────────────────────────────────────────────
export async function getPhoto(id) {
  const backend = await detectBackend();
  if (backend === 'indexeddb') {
    const db = await openDb();
    const r = await idbGet(db, id);
    return r || null;
  }
  if (backend === 'localstorage') {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    try {
      const r = JSON.parse(raw);
      const blob = await dataUrlToBlob(r.dataUrl);
      return { id: r.id, blob, meta: r.meta };
    } catch { return null; }
  }
  return _ramStore.get(id) || null;
}

// ── Public: Löschen ─────────────────────────────────────────────────────────
export async function deletePhoto(id) {
  const backend = await detectBackend();
  let ok = false;
  if (backend === 'indexeddb') {
    const db = await openDb();
    await idbDelete(db, id);
    ok = true;
  } else if (backend === 'localstorage') {
    if (localStorage.getItem(LS_PREFIX + id) != null) {
      localStorage.removeItem(LS_PREFIX + id);
      const idx = lsLoadIndex().filter(x => x !== id);
      lsSaveIndex(idx);
      ok = true;
    }
  } else {
    ok = _ramStore.delete(id);
  }
  if (ok) notifyChange();
  return ok;
}

// ── Public: Meta aktualisieren (caption, notiz, ...) ───────────────────────
export async function updatePhotoMeta(id, patch) {
  const rec = await getPhoto(id);
  if (!rec) return false;
  const newMeta = { ...(rec.meta || {}), ...patch };
  await savePhoto(id, rec.blob, newMeta);
  return true;
}

// ── Public: Liste ───────────────────────────────────────────────────────────
export async function listPhotos() {
  const backend = await detectBackend();
  if (backend === 'indexeddb') {
    const db = await openDb();
    const all = await idbGetAll(db);
    return all.map(r => ({ id: r.id, meta: r.meta }));
  }
  if (backend === 'localstorage') {
    const idx = lsLoadIndex();
    return idx.map(id => {
      const raw = localStorage.getItem(LS_PREFIX + id);
      if (!raw) return null;
      try { const r = JSON.parse(raw); return { id, meta: r.meta }; } catch { return null; }
    }).filter(Boolean);
  }
  return [..._ramStore.values()].map(r => ({ id: r.id, meta: r.meta }));
}

// ── Public: Status für UI-Anzeige ──────────────────────────────────────────
export async function getStorageStatus() {
  const backend = await detectBackend();
  const photos = await listPhotos();
  const count = photos.length;
  let used = 0, limit = null, infoText = '', available = true;

  if (backend === 'indexeddb') {
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        used = est.usage || 0; limit = est.quota || null;
      } catch {}
    }
    infoText = `💾 Auto-Save aktiv (IndexedDB) · ${count} Foto${count===1?'':'s'}`;
  } else if (backend === 'localstorage') {
    // Geschätzt: alle Werte mit Foto-Prefix summieren
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) used += (localStorage.getItem(k) || '').length * 2;  // UTF-16
    }
    limit = 5 * 1024 * 1024;  // konservative 5 MB
    const usedMb = (used / 1024 / 1024).toFixed(1);
    const limitMb = (limit / 1024 / 1024).toFixed(0);
    infoText = `⚠️ Eingeschränkter Speicher (localStorage) · ${count} Foto${count===1?'':'s'} · ${usedMb}/${limitMb} MB`;
    available = used < limit * 0.9;
  } else {
    infoText = `❌ Kein Auto-Save · ${count} Foto${count===1?'':'s'} (RAM, weg beim Reload)`;
    available = true;  // RAM ist unbegrenzt im Sinne von Speichern
  }
  return { backend, available, used, limit, count, infoText };
}

// ── Public: Change-Listener (für UI-Refresh) ────────────────────────────────
export function onStorageChange(cb) {
  _changeListeners.push(cb);
  return () => { _changeListeners = _changeListeners.filter(c => c !== cb); };
}

function notifyChange() {
  for (const cb of _changeListeners) {
    try { cb(); } catch (e) { console.error('Foto-Storage-Listener-Fehler:', e); }
  }
}

// ── Public: Komplett leeren (z.B. beim Projekt-Laden) ──────────────────────
export async function clearAllPhotos() {
  const backend = await detectBackend();
  if (backend === 'indexeddb') {
    const db = await openDb();
    await idbClear(db);
  } else if (backend === 'localstorage') {
    const idx = lsLoadIndex();
    for (const id of idx) localStorage.removeItem(LS_PREFIX + id);
    lsSaveIndex([]);
  } else {
    _ramStore.clear();
  }
  notifyChange();
}

// ── Public: Bulk-Import (z.B. aus Projekt-JSON) ────────────────────────────
// Photos = [{id, dataUrl, meta}] (Base64, wie im JSON-Export)
export async function importPhotosFromProject(photos) {
  if (!Array.isArray(photos)) return 0;
  let n = 0;
  for (const p of photos) {
    if (!p || !p.id || !p.dataUrl) continue;
    try {
      const blob = await dataUrlToBlob(p.dataUrl);
      await savePhoto(p.id, blob, p.meta || {});
      n++;
    } catch (e) {
      console.warn('Foto-Import fehlgeschlagen für id=' + p.id, e);
    }
  }
  return n;
}

// ── Public: Bulk-Export (für Projekt-JSON) ─────────────────────────────────
// Liefert Array [{id, dataUrl, meta}] mit Base64 — direkt in JSON serialisierbar
export async function exportPhotosForProject() {
  const list = await listPhotos();
  const out = [];
  for (const { id } of list) {
    const r = await getPhoto(id);
    if (!r) continue;
    try {
      out.push({ id, dataUrl: await blobToDataUrl(r.blob), meta: r.meta });
    } catch (e) {
      console.warn('Foto-Export fehlgeschlagen für id=' + id, e);
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// IndexedDB-Helper (Promise-Wrapper)
// ════════════════════════════════════════════════════════════════════════════
function idbPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
function idbGet(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}
function idbDelete(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
function idbClear(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── localStorage-Helper ─────────────────────────────────────────────────────
function lsLoadIndex() {
  try { return JSON.parse(localStorage.getItem(LS_INDEX_KEY) || '[]'); }
  catch { return []; }
}
function lsSaveIndex(arr) {
  localStorage.setItem(LS_INDEX_KEY, JSON.stringify(arr));
}

// ── Blob ↔ DataURL ─────────────────────────────────────────────────────────
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

// ── Public: ID-Generator ───────────────────────────────────────────────────
export function photoUid() { return 'p_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
