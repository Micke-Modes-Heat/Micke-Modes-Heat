// @ts-check
// ── 16-dual-screen.js — Zwei-Bildschirm-/Breitbild-Modus ───────────────────
//
// Idee: Das Browserfenster wird über beide Monitore aufgezogen. Ohne weitere
// Hilfe schweben die Float-Panels dann mitten auf der Monitorkante. Dieser
// Modus teilt die App deshalb selbst: Karte links (Monitor 1), ein Dock für
// die Panels rechts (Monitor 2), Trennlinie auf der Bezel.
//
// Die Panels bleiben dabei dieselben DOM-Knoten — sie wandern nur in das Dock
// und kehren beim Verlassen des Modus an ihren ursprünglichen Platz zurück
// (gleiches Muster wie _embedPanelInline/_restoreInlinePanels in 04a).

const SPLIT_KEY  = 'micke-dual-split';
const ACTIVE_KEY = 'micke-dual-active';
const MIN_DOCK = 320;   // px, schmaler wird das Dock unbrauchbar
const MIN_MAP  = 420;   // px, so viel Karte muss links bleiben

// Karten-nahe bzw. modale Panels bleiben immer auf Monitor 1.
const NO_DOCK = new Set(['privacy-panel', 'diagnostics-panel', 'geb-import-panel', 'area-edit-panel']);

let active    = false;
let dock      = null;
let dockBody  = null;
let dockHint  = null;
let splitter  = null;
let observer  = null;
let dockWidth = 0;
let syncing   = false;
let syncQueued = false;
/** Panels, die der Nutzer bewusst auf der Karte belassen hat. @type {Set<string>} */
const pinned = new Set();

/* ── Helfer ──────────────────────────────────────────────────────────── */

// Bewusst über window: die Karte wird in 02b als window._appLeafletMap
// zwischengespeichert, ein importiertes Binding wäre nach HMR veraltet.
function getMap() { return window._appLeafletMap || null; }

function refreshMap(delay = 180) {
  setTimeout(() => { try { getMap()?.invalidateSize(); } catch { /* Karte noch nicht bereit */ } }, delay);
}

function allPanels() { return /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.float-panel')]); }

function isVisible(el) { return el.isConnected && getComputedStyle(el).display !== 'none'; }

function isDockable(el) { return !NO_DOCK.has(el.id) && !el.classList.contains('inline-mode'); }

/** Fensterdekoration links/rechts, um screenX in Client-Koordinaten zu übersetzen. */
function frameOffset() { return Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2)); }

/** Breite der übrigen festen Spalten in .main (Seitenleisten + Splitter). */
function railWidth() {
  let w = splitter ? splitter.getBoundingClientRect().width : 0;
  for (const id of ['left-panel', 'sidebar']) {
    const el = document.getElementById(id);
    if (el && getComputedStyle(el).display !== 'none') w += el.getBoundingClientRect().width;
  }
  return w;
}

function clampDock(w) {
  const max = Math.max(MIN_DOCK, window.innerWidth - railWidth() - MIN_MAP);
  return Math.min(Math.max(Math.round(w), MIN_DOCK), max);
}

/**
 * Schätzt, wo die Bildschirmgrenze im Fenster liegt. Bei zwei gleich breiten
 * Monitoren ist screen.availWidth genau die Bezel; sonst greift 50 %.
 */
function guessDockWidth() {
  const stored = Number(localStorage.getItem(SPLIT_KEY));
  if (Number.isFinite(stored) && stored >= MIN_DOCK) return clampDock(stored);
  const boundary = screen.availWidth - window.screenX - frameOffset();
  const guess = window.innerWidth - boundary;
  if (boundary > MIN_MAP && guess > MIN_DOCK) return clampDock(guess);
  return clampDock(window.innerWidth / 2);
}

function setDockWidth(w, persist = true) {
  dockWidth = clampDock(w);
  if (dock) dock.style.width = dockWidth + 'px';
  if (persist) { try { localStorage.setItem(SPLIT_KEY, String(dockWidth)); } catch { /* Storage gesperrt */ } }
  updateHint();
  refreshMap(60);
}

/** Warnt, wenn das Fenster gar nicht über zwei Bildschirme reicht. */
function updateHint() {
  if (!dockHint) return;
  const spansTwo = window.innerWidth > screen.availWidth * 1.3;
  dockHint.classList.toggle('visible', !spansTwo);
  if (!spansTwo) {
    dockHint.textContent = 'Das Fenster scheint nur auf einem Bildschirm zu liegen. '
      + 'Maximieren füllt unter Windows immer nur einen Monitor — das Fenster stattdessen wiederherstellen '
      + 'und an den Rändern über beide Monitore aufziehen. (Auf einem Ultrawide-Monitor kann der Hinweis '
      + 'ignoriert werden.)';
  }
}

/* ── Dock aufbauen / abbauen ─────────────────────────────────────────── */

function buildDock() {
  const main = document.querySelector('.main');
  if (!main) return false;

  splitter = document.createElement('div');
  splitter.id = 'dual-splitter';
  splitter.title = 'Trennlinie auf die Monitorkante ziehen';
  splitter.addEventListener('pointerdown', onSplitStart);

  dock = document.createElement('aside');
  dock.id = 'dual-dock';
  dock.setAttribute('aria-label', 'Panel-Dock zweiter Bildschirm');

  const head = document.createElement('div');
  head.className = 'dd-head';
  const title = document.createElement('span');
  title.className = 'dd-title';
  title.textContent = 'Zweiter Bildschirm';
  const btnAuto = document.createElement('button');
  btnAuto.className = 'dd-btn';
  btnAuto.textContent = '⌖';
  btnAuto.title = 'Bildschirmgrenze automatisch erkennen (nur in der gehosteten Version)';
  btnAuto.addEventListener('click', () => { dsAutoDetectSplit(); });
  const btnClose = document.createElement('button');
  btnClose.className = 'dd-btn';
  btnClose.textContent = '✕';
  btnClose.title = 'Zwei-Bildschirm-Modus beenden';
  btnClose.addEventListener('click', () => toggleDualScreen(false));
  head.append(title, btnAuto, btnClose);

  dockHint = document.createElement('div');
  dockHint.className = 'dd-hint';

  dockBody = document.createElement('div');
  dockBody.className = 'dd-body';
  dockBody.id = 'dual-dock-body';

  dock.append(head, dockHint, dockBody);
  main.append(splitter, dock);

  // Panel-Drag im Dock unterbinden (die inline-onmousedown-Handler sollen dort
  // nicht greifen); der Schließen-Klick bleibt davon unberührt.
  dock.addEventListener('mousedown', ev => {
    if (/** @type {HTMLElement} */ (ev.target).closest?.('.panel-drag-handle')) ev.stopPropagation();
  }, true);
  return true;
}

function removeDock() {
  splitter?.remove();
  dock?.remove();
  splitter = dock = dockBody = dockHint = null;
}

/* ── Panels andocken / zurückgeben ───────────────────────────────────── */

function dockPanel(el) {
  if (el._dsDocked || !dockBody) return;
  el._dsOrigParent = el.parentElement;
  el._dsOrigNext   = el.nextElementSibling;
  el._dsDocked = true;
  el.classList.add('dock-mode');
  dockBody.appendChild(el);
  updateDockButton(el);
}

function undockPanel(el) {
  if (!el._dsDocked) return;
  el._dsDocked = false;
  el.classList.remove('dock-mode');
  const parent = el._dsOrigParent;
  const next   = el._dsOrigNext;
  if (parent?.isConnected) {
    if (next && next.parentElement === parent) parent.insertBefore(el, next);
    else parent.appendChild(el);
  }
  el._dsOrigParent = null;
  el._dsOrigNext = null;
  updateDockButton(el);
}

/** Kleiner Umschalter im Panel-Kopf: Dock ⇆ Karte. */
function updateDockButton(el) {
  const handle = el.querySelector('.panel-drag-handle');
  if (!handle) return;
  let btn = handle.querySelector('.dd-dockbtn');
  if (!active) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement('span');
    btn.className = 'dd-dockbtn';
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (el._dsDocked) { pinned.add(el.id); undockPanel(el); }
      else { pinned.delete(el.id); dockPanel(el); }
      refreshMap(0);
    });
    handle.insertBefore(btn, handle.firstChild);
  }
  btn.textContent = el._dsDocked ? '⇱' : '⇲';
  btn.title = el._dsDocked ? 'Panel zurück auf die Karte' : 'Panel auf den zweiten Bildschirm';
}

/** Gleicht Dock-Inhalt und Sichtbarkeit der Panels ab. */
function sync() {
  if (!active || syncing) return;
  syncing = true;
  try {
    for (const el of allPanels()) {
      if (!isDockable(el)) { if (el._dsDocked) undockPanel(el); continue; }
      const visible = isVisible(el);
      if (visible && !el._dsDocked && !pinned.has(el.id)) dockPanel(el);
      else if (!visible && el._dsDocked) undockPanel(el);
      else updateDockButton(el);
    }
    // Seitenleisten können zwischenzeitlich auf- oder zugeklappt worden sein.
    setDockWidth(dockWidth, false);
  } finally { syncing = false; }
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  // Bewusst setTimeout statt requestAnimationFrame: rAF ruht in Fenstern, die
  // gerade nichts rendern (minimiert, verdeckter Hintergrund-Tab) — Panels, die
  // dort geöffnet werden, blieben sonst bis zum nächsten Frame ungedockt.
  setTimeout(() => { syncQueued = false; sync(); }, 16);
}

/* ── Splitter ────────────────────────────────────────────────────────── */

function onSplitStart(ev) {
  ev.preventDefault();
  try { splitter?.setPointerCapture(ev.pointerId); } catch { /* ohne Capture reichen die window-Listener */ }
  document.body.style.userSelect = 'none';
  // Listener auf window, damit ein schneller Zug über die Karte nicht abreißt.
  const move = e => setDockWidth(window.innerWidth - e.clientX, false);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.style.userSelect = '';
    setDockWidth(dockWidth, true);
    refreshMap(0);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/* ── Öffentliche API ─────────────────────────────────────────────────── */

/**
 * Ermittelt die Bildschirmgrenze exakt über die Window-Management-API.
 * Braucht einen Secure Context (https/localhost) und eine Freigabe durch den
 * Nutzer — beim direkt geöffneten Single-File (file://) nicht verfügbar.
 */
export async function dsAutoDetectSplit() {
  if (!window.isSecureContext || typeof window.getScreenDetails !== 'function') {
    alert('Die automatische Erkennung braucht die gehostete Version (https).\n\n'
      + 'Hier bitte die Trennlinie mit der Maus auf die Monitorkante ziehen — '
      + 'die Position wird gespeichert.');
    return;
  }
  try {
    const details = await window.getScreenDetails();
    const winLeft  = window.screenX;
    const winRight = window.screenX + window.outerWidth;
    const edges = details.screens
      .map(s => s.left)
      .filter(x => x > winLeft + MIN_MAP && x < winRight - MIN_DOCK)
      .sort((a, b) => a - b);
    if (!edges.length) {
      alert('Innerhalb des Fensters liegt keine Bildschirmgrenze — '
        + 'reicht das Fenster wirklich über beide Monitore?');
      return;
    }
    setDockWidth(window.innerWidth - (edges[0] - winLeft - frameOffset()));
  } catch (err) {
    alert('Zugriff auf die Bildschirmanordnung nicht erlaubt: ' + (err?.message || err));
  }
}

/** @param {boolean} [force] */
export function toggleDualScreen(force) {
  const next = typeof force === 'boolean' ? force : !active;
  if (next === active) return;
  active = next;
  document.documentElement.dataset.dualScreen = active ? 'on' : '';

  if (active) {
    if (!buildDock()) { active = false; return; }
    setDockWidth(guessDockWidth(), false);
    pinned.clear();
    observer = new MutationObserver(muts => {
      if (syncing) return;
      for (const m of muts) {
        const t = /** @type {HTMLElement} */ (m.target);
        if (t.nodeType === 1 && t.classList?.contains('float-panel')) { scheduleSync(); return; }
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && /** @type {HTMLElement} */ (n).classList?.contains('float-panel')) {
            scheduleSync();
            return;
          }
        }
      }
    });
    // body statt .main: ein Teil der Panels hängt direkt im body.
    observer.observe(document.body,
      {subtree: true, attributes: true, attributeFilter: ['class', 'style'], childList: true});
    sync();
  } else {
    observer?.disconnect();
    observer = null;
    for (const el of allPanels()) undockPanel(el);
    for (const el of allPanels()) updateDockButton(el); // entfernt die Umschalter
    removeDock();
    pinned.clear();
  }

  try { localStorage.setItem(ACTIVE_KEY, active ? '1' : '0'); } catch { /* Storage gesperrt */ }
  const btn = document.getElementById('btn-dualscreen-toggle');
  if (btn) btn.classList.toggle('active', active);
  refreshMap();
}

export function dsInit() {
  window.addEventListener('resize', () => {
    if (!active) return;
    setDockWidth(dockWidth, false);
  });
  let restore = false;
  try { restore = localStorage.getItem(ACTIVE_KEY) === '1'; } catch { /* Storage gesperrt */ }
  if (restore) toggleDualScreen(true);
}

export function dsIsActive() { return active; }
