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
         photoUid, onStorageChange, listPhotos, updatePhotoMeta } from './17a-fotos-storage.js';
import { compressImage, fmtBytes } from './17b-fotos-compress.js';

// ── Modul-State ─────────────────────────────────────────────────────────────
let _ungespeichertCount = 0;          // seit letztem manuellen Speichern
const REMINDER_EVERY = 5;              // alle 5 Fotos
let _currentPanelParent = null;       // Parent des gerade offenen Foto-Panels

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
  _currentPanelParent = parent;
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
  _currentPanelParent = null;
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
      const caption = (rec.meta?.caption || '').trim();
      const hasNotiz = (rec.meta?.notiz || '').trim().length > 0;
      const labelText = caption || rec.meta?.filename || '';
      tile.innerHTML = `
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block;"/>
        ${hasNotiz ? `<div style="position:absolute;top:2px;left:2px;background:rgba(79,195,247,.9);
             color:#000;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;"
             title="Hat Notiz">📝</div>` : ''}
        <div style="position:absolute;bottom:0;left:0;right:0;padding:4px 6px;
             background:rgba(0,0,0,.75);font-size:9px;color:#cfd;
             white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
             title="${escHtml(labelText)}">
          ${labelText ? escHtml(labelText) : '<span style="color:#7a8099;font-style:italic;">(unbeschriftet)</span>'}
        </div>
        <button class="foto-del" data-pid="${pid}" style="position:absolute;top:2px;right:2px;
          background:rgba(239,83,80,.85);border:none;color:#fff;border-radius:50%;
          width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1;padding:0;
          display:none;" title="Löschen">✕</button>`;
      tile.addEventListener('mouseenter', () => tile.querySelector('.foto-del').style.display = '');
      tile.addEventListener('mouseleave', () => tile.querySelector('.foto-del').style.display = 'none');
      tile.querySelector('img').addEventListener('click', () => openLightbox(parent.photoIds, pid));
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
async function openLightbox(photoIds, currentId) {
  document.getElementById('foto-lightbox')?.remove();
  let idx = photoIds.indexOf(currentId);
  if (idx < 0) idx = 0;

  const overlay = document.createElement('div');
  overlay.id = 'foto-lightbox';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;
    display:flex;flex-direction:column;font-family:'DM Sans',sans-serif;color:#cfd;`;
  overlay.innerHTML = `
    <!-- Top-Bar mit Close + Counter -->
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 16px;background:rgba(0,0,0,.6);border-bottom:1px solid #2a3050;">
      <div id="foto-lb-counter" style="font-size:12px;color:#9aa;"></div>
      <button id="foto-lb-close" style="background:rgba(255,255,255,.1);border:1px solid #444;
        border-radius:6px;color:#fff;font-size:18px;padding:4px 12px;cursor:pointer;">✕</button>
    </div>
    <!-- Bild-Bereich mit Pfeilen -->
    <div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;
                overflow:hidden;padding:10px;">
      <button id="foto-lb-prev" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);
        background:rgba(255,255,255,.1);border:1px solid #444;border-radius:6px;
        color:#fff;font-size:24px;padding:8px 16px;cursor:pointer;z-index:1;">‹</button>
      <button id="foto-lb-next" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);
        background:rgba(255,255,255,.1);border:1px solid #444;border-radius:6px;
        color:#fff;font-size:24px;padding:8px 16px;cursor:pointer;z-index:1;">›</button>
      <img id="foto-lb-img" style="max-width:100%;max-height:100%;object-fit:contain;"/>
    </div>
    <!-- Bottom-Bar mit Caption + Notiz (editierbar) -->
    <div style="background:rgba(0,0,0,.85);border-top:1px solid #2a3050;padding:10px 16px;
                display:flex;flex-direction:column;gap:6px;max-height:35vh;overflow:auto;">
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-size:10px;color:#7a8099;text-transform:uppercase;
                      letter-spacing:.04em;min-width:80px;">Beschriftung</label>
        <input type="text" id="foto-lb-caption-input" placeholder="z.B. Zählerschrank Frontansicht"
          style="flex:1;background:#0f1b2d;border:1px solid #2a3050;color:#cfd;
                 padding:5px 8px;border-radius:4px;font-size:12px;font-family:inherit;"/>
      </div>
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <label style="font-size:10px;color:#7a8099;text-transform:uppercase;
                      letter-spacing:.04em;min-width:80px;padding-top:5px;">Notiz</label>
        <textarea id="foto-lb-notiz-input" rows="2" placeholder="Zusätzliche Beobachtungen, Maße, Auffälligkeiten…"
          style="flex:1;background:#0f1b2d;border:1px solid #2a3050;color:#cfd;
                 padding:5px 8px;border-radius:4px;font-size:12px;font-family:inherit;
                 resize:vertical;min-height:38px;"></textarea>
      </div>
      <div id="foto-lb-savestatus" style="font-size:9px;color:#7a8099;text-align:right;min-height:12px;"></div>
    </div>`;
  document.body.appendChild(overlay);

  let currentUrl = null;
  let currentRecMeta = null;

  async function showAt(i) {
    if (i < 0) i = photoIds.length - 1;
    if (i >= photoIds.length) i = 0;
    idx = i;
    const rec = await getPhoto(photoIds[idx]);
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    if (!rec) return;
    currentRecMeta = rec.meta || {};
    currentUrl = URL.createObjectURL(rec.blob);
    overlay.querySelector('#foto-lb-img').src = currentUrl;
    overlay.querySelector('#foto-lb-counter').textContent =
      `${idx+1}/${photoIds.length} · ${rec.meta?.filename || ''}`;
    overlay.querySelector('#foto-lb-caption-input').value = rec.meta?.caption || '';
    overlay.querySelector('#foto-lb-notiz-input').value = rec.meta?.notiz || '';
    overlay.querySelector('#foto-lb-savestatus').textContent = '';
  }
  await showAt(idx);

  // Auto-Save bei Blur (Caption + Notiz)
  function attachAutoSave(elId, field) {
    const inp = overlay.querySelector(elId);
    inp.addEventListener('blur', async () => {
      const newVal = inp.value;
      const oldVal = currentRecMeta?.[field] || '';
      if (newVal === oldVal) return;
      const status = overlay.querySelector('#foto-lb-savestatus');
      status.textContent = '⏳ wird gespeichert…';
      const ok = await updatePhotoMeta(photoIds[idx], { [field]: newVal });
      status.textContent = ok ? '✓ gespeichert' : '✗ Fehler';
      if (ok) currentRecMeta[field] = newVal;
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  }
  attachAutoSave('#foto-lb-caption-input', 'caption');
  attachAutoSave('#foto-lb-notiz-input',   'notiz');

  overlay.querySelector('#foto-lb-close').addEventListener('click', () => closeLightbox());
  overlay.querySelector('#foto-lb-prev').addEventListener('click',  () => showAt(idx - 1));
  overlay.querySelector('#foto-lb-next').addEventListener('click',  () => showAt(idx + 1));

  function closeLightbox() {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    // Galerie neu rendern, damit Caption-Änderungen sichtbar werden
    const parent = getCurrentLightboxParent();
    if (parent) renderFotoGrid(parent);
  }

  function onKey(e) {
    // ESC nur wenn KEIN Input gerade fokussiert ist
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
      // Im Input nur Pfeile ignorieren — sonst kann man nicht tippen
      return;
    }
    if (e.key === 'Escape')          closeLightbox();
    else if (e.key === 'ArrowLeft')  showAt(idx - 1);
    else if (e.key === 'ArrowRight') showAt(idx + 1);
  }
  document.addEventListener('keydown', onKey);
}

// Hilfe-Funktion: aktuellen Galerie-Parent für Re-Render bei Caption-Änderung
function getCurrentLightboxParent() { return _currentPanelParent; }

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
