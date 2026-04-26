// ── 17c-fotos-ui.js — Foto-UI: File-Picker, Galerie, Lightbox, Toast ────────
// Nutzt 17a (Storage) + 17b (Compression).
//
// Public:
//   openFotoPanel(parentType, parentId, parentName?)
//     parentType: 'asset' | 'gebaeude'
//     Öffnet ein Overlay-Panel mit Galerie + Upload-Button für das Objekt.
//   addPhotoToParent(parentType, parentId, file)
//     Programmatisch: Foto hinzufügen (für Drop-Handler etc.)
//   getStorageStatusBadge() — kleines HTML-Badge für UI-Anzeige
//   updateStorageStatusBadge() — re-rendert das Badge

import { savePhoto, getPhoto, deletePhoto, getStorageStatus,
         photoUid, onStorageChange, listPhotos } from './17a-fotos-storage.js';
import { compressImage, fmtBytes } from './17b-fotos-compress.js';

// ── Toast für Reminder ──────────────────────────────────────────────────────
let _ungespeichertCount = 0;          // seit letztem manuellen Speichern
const REMINDER_EVERY = 5;              // alle 5 Fotos

function showToast(text, opts = {}) {
  const id = 'foto-toast';
  const old = document.getElementById(id); if (old) old.remove();
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${opts.bg||'#1a2535'};color:${opts.color||'#cfd'};padding:10px 18px;
    border:1px solid ${opts.accent||'#4fc3f7'};border-radius:8px;font-size:12px;
    box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:10001;font-family:'DM Sans',sans-serif;
    display:flex;align-items:center;gap:12px;`;
  el.innerHTML = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), opts.duration || 4500);
  return el;
}

// ── parentRef → Asset/Gebäude-Objekt finden ─────────────────────────────────
function getParent(parentType, parentId) {
  if (parentType === 'asset') {
    return (window.ASSETS?.items || []).find(a => a.id === parentId) || null;
  }
  if (parentType === 'gebaeude') {
    return (window.gebaeude || []).find(g => String(g.id) === String(parentId)) || null;
  }
  return null;
}

function getParentName(parent, parentType) {
  if (!parent) return '?';
  return parentType === 'asset' ? (parent.name || parent.id) : (parent.name || `Gebäude ${parent.id}`);
}

// ════════════════════════════════════════════════════════════════════════════
// FOTO HINZUFÜGEN (programmatisch oder über File-Input)
// ════════════════════════════════════════════════════════════════════════════
export async function addPhotoToParent(parentType, parentId, file) {
  const parent = getParent(parentType, parentId);
  if (!parent) throw new Error('Asset/Gebäude nicht gefunden: ' + parentType + ':' + parentId);
  if (!parent.photoIds) parent.photoIds = [];

  // Komprimieren
  let compressed;
  try {
    compressed = await compressImage(file);
  } catch (e) {
    showToast(`❌ Kompression fehlgeschlagen: ${e.message}`, { accent:'#ef5350', color:'#ff8' });
    throw e;
  }

  const id = photoUid();
  const meta = {
    parentType, parentId,
    filename:      file.name || 'photo.jpg',
    originalSize:  compressed.originalSize,
    compressedSize: compressed.blob.size,
    width:         compressed.width,
    height:        compressed.height,
  };

  try {
    await savePhoto(id, compressed.blob, meta);
  } catch (e) {
    showToast(`❌ Speichern fehlgeschlagen: ${e.message}`, { accent:'#ef5350', color:'#ff8', duration: 7000 });
    throw e;
  }

  parent.photoIds.push(id);

  // Reminder hochzählen
  _ungespeichertCount++;
  if (_ungespeichertCount % REMINDER_EVERY === 0) {
    showToast(
      `💾 ${_ungespeichertCount} neue Fotos seit letztem Speichern. <button id="foto-toast-save"
       style="background:#4fc3f7;border:none;color:#000;padding:3px 10px;border-radius:4px;
       cursor:pointer;font-weight:600;">Jetzt speichern</button>`,
      { duration: 8000 });
    setTimeout(() => {
      document.getElementById('foto-toast-save')?.addEventListener('click', () => {
        if (typeof window.exportJSON === 'function') {
          window.exportJSON();
          _ungespeichertCount = 0;
          document.getElementById('foto-toast')?.remove();
        }
      });
    }, 50);
  }

  updateStorageStatusBadge();
  return id;
}

// ── Beim manuellen Speichern (exportJSON) Reminder zurücksetzen — von extern aufrufbar
export function resetUngespeichertReminder() { _ungespeichertCount = 0; }

// ════════════════════════════════════════════════════════════════════════════
// GALERIE-PANEL (Overlay)
// ════════════════════════════════════════════════════════════════════════════
export async function openFotoPanel(parentType, parentId, parentName) {
  const parent = getParent(parentType, parentId);
  if (!parent) {
    showToast(`Objekt nicht gefunden: ${parentType}:${parentId}`, { accent:'#ef5350', color:'#ff8' });
    return;
  }
  parent.photoIds = parent.photoIds || [];
  const name = parentName || getParentName(parent, parentType);

  closeFotoPanel();
  const status = await getStorageStatus();

  const el = document.createElement('div');
  el.id = 'foto-panel';
  el.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);
    width:680px;max-width:95vw;max-height:85vh;background:#0f1b2d;color:#cfd;
    border:2px solid #4fc3f7;border-radius:8px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:9999;
    display:flex;flex-direction:column;font-family:'DM Sans',sans-serif;`;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:#0b0e18;border-bottom:1px solid #4fc3f755;border-radius:6px 6px 0 0;">
      <div style="font-size:13px;font-weight:600;color:#4fc3f7;">📷 Fotos · ${escHtml(name)}</div>
      <button id="foto-panel-close" style="background:transparent;border:1px solid #555;
              border-radius:4px;color:#aaa;cursor:pointer;font-size:13px;padding:2px 9px;">✕</button>
    </div>
    <div style="padding:8px 12px;font-size:10px;color:#9aa;border-bottom:1px solid #1a2535;">
      ${escHtml(status.infoText)}
    </div>
    <div style="padding:10px 12px;border-bottom:1px solid #1a2535;">
      <label style="display:inline-block;background:#4fc3f7;color:#000;padding:6px 14px;
             border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">
        ➕ Foto hinzufügen
        <input type="file" accept="image/*" capture="environment" multiple
               id="foto-panel-input" style="display:none;"/>
      </label>
      <span style="margin-left:10px;font-size:9px;color:#7a8099;">
        Mobile: öffnet direkt die Kamera · Desktop: File-Picker · Mehrfach-Auswahl möglich
      </span>
    </div>
    <div id="foto-panel-grid" style="flex:1;overflow:auto;padding:12px;
         display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;"></div>
  `;
  document.body.appendChild(el);
  document.getElementById('foto-panel-close').addEventListener('click', closeFotoPanel);

  const input = document.getElementById('foto-panel-input');
  input.addEventListener('change', async (ev) => {
    const files = [...(ev.target.files || [])];
    if (!files.length) return;
    const grid = document.getElementById('foto-panel-grid');
    if (grid) grid.insertAdjacentHTML('afterbegin',
      `<div id="foto-uploading" style="grid-column:1/-1;color:#4fc3f7;font-size:11px;text-align:center;padding:8px;">
         ⏳ ${files.length} Foto${files.length===1?'':'s'} werden komprimiert &amp; gespeichert…
       </div>`);
    let added = 0, failed = 0;
    for (const f of files) {
      try { await addPhotoToParent(parentType, parentId, f); added++; }
      catch { failed++; }
    }
    document.getElementById('foto-uploading')?.remove();
    input.value = '';  // ermöglicht erneute Auswahl derselben Datei
    await renderFotoGrid(parent);
    if (failed > 0) {
      showToast(`⚠️ ${added} OK, ${failed} fehlgeschlagen`, { accent:'#f9a825' });
    }
  });

  await renderFotoGrid(parent);
}

export function closeFotoPanel() {
  document.getElementById('foto-panel')?.remove();
  document.getElementById('foto-lightbox')?.remove();
}

async function renderFotoGrid(parent) {
  const grid = document.getElementById('foto-panel-grid');
  if (!grid) return;
  const ids = parent.photoIds || [];
  if (ids.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;color:#7a8099;font-size:11px;text-align:center;padding:30px;">
      Noch keine Fotos. Klick „➕ Foto hinzufügen" oben.
    </div>`;
    return;
  }
  grid.innerHTML = '';
  for (const pid of ids) {
    const tile = document.createElement('div');
    tile.style.cssText = `position:relative;background:#0b0e18;border:1px solid #2a3050;
      border-radius:6px;overflow:hidden;aspect-ratio:1;cursor:pointer;`;
    tile.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
      width:100%;height:100%;color:#7a8099;font-size:9px;">⏳</div>`;
    grid.appendChild(tile);

    getPhoto(pid).then(rec => {
      if (!rec) {
        tile.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
          width:100%;height:100%;color:#ef5350;font-size:9px;">❌ weg</div>`;
        return;
      }
      const url = URL.createObjectURL(rec.blob);
      const sizeText = fmtBytes(rec.blob.size);
      tile.innerHTML = `
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block;"/>
        <div style="position:absolute;bottom:0;left:0;right:0;padding:3px 6px;
             background:rgba(0,0,0,.7);font-size:8px;color:#cfd;display:flex;justify-content:space-between;">
          <span>${escHtml(rec.meta?.filename || '')}</span><span>${sizeText}</span>
        </div>
        <button class="foto-del" data-pid="${pid}" style="position:absolute;top:2px;right:2px;
          background:rgba(239,83,80,.85);border:none;color:#fff;border-radius:50%;
          width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1;padding:0;
          display:none;" title="Löschen">✕</button>`;
      tile.addEventListener('mouseenter', () => tile.querySelector('.foto-del').style.display = '');
      tile.addEventListener('mouseleave', () => tile.querySelector('.foto-del').style.display = 'none');
      tile.querySelector('img').addEventListener('click', () => openLightbox(parent.photoIds, pid, rec.meta?.filename));
      tile.querySelector('.foto-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Foto wirklich löschen?')) return;
        await deletePhoto(pid);
        parent.photoIds = parent.photoIds.filter(x => x !== pid);
        URL.revokeObjectURL(url);
        await renderFotoGrid(parent);
      });
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LIGHTBOX (Vollbild-Ansicht)
// ════════════════════════════════════════════════════════════════════════════
async function openLightbox(photoIds, currentId, filename) {
  document.getElementById('foto-lightbox')?.remove();
  let idx = photoIds.indexOf(currentId);
  if (idx < 0) idx = 0;

  const overlay = document.createElement('div');
  overlay.id = 'foto-lightbox';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:'DM Sans',sans-serif;color:#cfd;`;
  overlay.innerHTML = `
    <button id="foto-lb-close" style="position:absolute;top:16px;right:16px;
      background:rgba(255,255,255,.1);border:1px solid #444;border-radius:6px;
      color:#fff;font-size:20px;padding:4px 12px;cursor:pointer;">✕</button>
    <button id="foto-lb-prev" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);
      background:rgba(255,255,255,.1);border:1px solid #444;border-radius:6px;
      color:#fff;font-size:24px;padding:8px 16px;cursor:pointer;">‹</button>
    <button id="foto-lb-next" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);
      background:rgba(255,255,255,.1);border:1px solid #444;border-radius:6px;
      color:#fff;font-size:24px;padding:8px 16px;cursor:pointer;">›</button>
    <img id="foto-lb-img" style="max-width:90vw;max-height:80vh;object-fit:contain;"/>
    <div id="foto-lb-caption" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,.7);padding:6px 14px;border-radius:6px;font-size:11px;color:#cfd;">
      ${escHtml(filename || '')} (${idx+1}/${photoIds.length})
    </div>`;
  document.body.appendChild(overlay);

  let currentUrl = null;
  async function showAt(i) {
    if (i < 0) i = photoIds.length - 1;
    if (i >= photoIds.length) i = 0;
    idx = i;
    const rec = await getPhoto(photoIds[idx]);
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    if (rec) {
      currentUrl = URL.createObjectURL(rec.blob);
      overlay.querySelector('#foto-lb-img').src = currentUrl;
      overlay.querySelector('#foto-lb-caption').textContent =
        (rec.meta?.filename || '') + ` (${idx+1}/${photoIds.length})`;
    }
  }
  await showAt(idx);

  overlay.querySelector('#foto-lb-close').addEventListener('click', () => { if(currentUrl) URL.revokeObjectURL(currentUrl); overlay.remove(); });
  overlay.querySelector('#foto-lb-prev').addEventListener('click',  () => showAt(idx - 1));
  overlay.querySelector('#foto-lb-next').addEventListener('click',  () => showAt(idx + 1));

  function onKey(e) {
    if (e.key === 'Escape')     { overlay.remove(); document.removeEventListener('keydown', onKey); }
    else if (e.key === 'ArrowLeft')  showAt(idx - 1);
    else if (e.key === 'ArrowRight') showAt(idx + 1);
  }
  document.addEventListener('keydown', onKey);
}

// ════════════════════════════════════════════════════════════════════════════
// STATUS-BADGE (kleines Anzeige-Element für UI)
// ════════════════════════════════════════════════════════════════════════════
export async function getStorageStatusBadge() {
  const s = await getStorageStatus();
  return `<div id="foto-storage-badge" title="${escHtml(s.infoText)}"
    style="font-size:9px;color:${s.available ? '#7a8099' : '#ef5350'};padding:2px 6px;
           border:1px solid ${s.available ? '#2a3050' : '#ef5350'};border-radius:4px;
           background:rgba(0,0,0,.2);display:inline-block;">${escHtml(s.infoText)}</div>`;
}

export async function updateStorageStatusBadge() {
  const placeholder = document.getElementById('foto-storage-badge-wrap');
  if (!placeholder) return;
  placeholder.innerHTML = await getStorageStatusBadge();
}

// Auto-Refresh Status-Badge bei Storage-Änderungen
setTimeout(() => onStorageChange(updateStorageStatusBadge), 0);

// ── Cleanup: orphan-Fotos beim Projekt-Laden entfernen ─────────────────────
// Wird von 03c._loadProject aufgerufen NACH Asset/Gebäude-Restore
export async function cleanupOrphanPhotos() {
  const refIds = new Set();
  for (const a of (window.ASSETS?.items || []))   for (const pid of (a.photoIds || [])) refIds.add(pid);
  for (const g of (window.gebaeude || []))         for (const pid of (g.photoIds || [])) refIds.add(pid);
  const all = await listPhotos();
  let removed = 0;
  for (const { id } of all) if (!refIds.has(id)) { await deletePhoto(id); removed++; }
  return removed;
}

// ── HTML-Escape ────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
