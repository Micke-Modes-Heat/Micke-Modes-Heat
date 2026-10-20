// ── 52-fenster-dock.js — Fenster rechts andocken statt über der Karte schweben ──
//
// Die rechte Spalte (Gebäude-/Elektro-Liste, #sidebar) wird zum Arbeitsbereich mit Reitern:
//   [Liste] [Netzanalyse ×] [Engpässe ×] …   «
// Jedes geöffnete .float-panel wird dort als Reiter eingehängt; die Karte wird entsprechend
// schmaler (ResizeObserver → map.invalidateSize). Nichts liegt mehr über der Karte.
//
// Regeln:
//   - Gilt nur in der Oberfläche LKEBw, auf breiten Bildschirmen, ohne Zweitbildschirm-Dock (16)
//     und nur, solange die Karte zu sehen ist. Sonst verhalten sich Fenster wie bisher.
//   - Fenster bleiben, wo sie im DOM herkommen, nur für die Dauer des Andockens wandern sie in
//     #ui-dock-inhalt (Heimat in p._dockHeim). Wer sie versteckt, einbettet (inline-mode) oder
//     an der Kopfzeile herauszieht (.dragging), bekommt sie zurück.
//   - Breite je Fenster einstellbar (Griff am linken Rand), gemerkt in localStorage micke.ui.dock.
//   - Ein Fenster mit data-kein-dock bleibt schwebend.
//   - Werkzeugflächen (WERKZEUGE) sind keine .float-panel, docken aber genauso an. Sie werden
//     von ihren Modulen per id gefunden (neu zeichnen, entfernen) — der Ort im DOM ist egal.
//   - Öffnet sich der Asset-Inspektor (steckt in der Liste, Reiter Elektro), springt die Spalte
//     auf „Liste“, sonst bliebe er hinter einem Fenster-Reiter verborgen.

const SPEICHER = 'micke.ui.dock';
const BREITE_STANDARD = 460;
const BREITE_MIN = 320;
const KARTE_MIN = 360;          // so viel Karte bleibt mindestens sichtbar
const MIN_BILDSCHIRM = 1000;    // darunter keine Spalte (Tablet: Fenster wie bisher)
// Dialoge gehören zu keiner Stelle der Karte (Einstellungen, Import, Export): sie erscheinen
// mittig als Dialogfenster (lkebw.css §15) statt als Reiter neben der Karte.
const DIALOGE = ['privacy-panel', 'diagnostics-panel', 'geb-import-panel', 'status-panel', 'feldapp-panel', 'resilienz-abfrage-panel'];
// Werkzeugflächen mit eigener fester Lage (app.css/lkebw.css §8). offen: Standard = im DOM;
// die Schaltbilder schalten über .visible und verlassen die Spalte im Vollbild.
const _schemaOffen = p => p.classList.contains('visible') && !p.classList.contains('sld-fullscreen');
const WERKZEUGE = {
  'blackout-modus-panel': { titel: 'Blackout-Modus', zu: () => window.blackoutModusStop?.() },
  'pv-modus-panel':       { titel: 'PV-Modus', zu: () => window.pvModusStop?.() },
  'baum-panel':           { titel: 'Bäume', zu: () => window.baumPanelToggle?.() },
  'grundriss-panel':      { titel: 'Grundrisse prüfen', zu: () => window.grundrissPanelToggle?.() },
  'sld-panel':            { titel: 'Einlinienschema', zu: () => window.sldToggle?.(), offen: _schemaOffen, breite: 600, neu: () => window.sldRefresh?.() },
  'ws-panel':             { titel: 'Wärmeschema', zu: () => window.wsToggle?.(), offen: _schemaOffen, breite: 600, neu: () => window.wsRender?.() },
};
const INSPEKTOR_ID = 'sb-asset-inspector-slot';
const ZENTRALANSICHTEN = ['center-analyse-view', 'center-gebaeude-view', 'center-optimierung-view', 'center-vergleich-view', 'center-live-view'];

let _rechts = null, _leiste = null, _inhalt = null, _griff = null;
let _reiter = [];               // ids der angedockten Fenster in Öffnungsreihenfolge
let _aktiv = 'liste';           // 'liste' oder id eines Fensters
let _eingeklappt = false;
let _breiten = {};
let _geplant = 0;
let _inspektorWarOffen = false;

const _esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function _laden() {
  try {
    const d = JSON.parse(localStorage.getItem(SPEICHER) || '{}');
    _breiten = d.breiten && typeof d.breiten === 'object' ? d.breiten : {};
    _eingeklappt = !!d.eingeklappt;
  } catch { _breiten = {}; }
}
function _merken() {
  try { localStorage.setItem(SPEICHER, JSON.stringify({ breiten: _breiten, eingeklappt: _eingeklappt })); } catch { /* privat/gesperrt */ }
}

/* ── Wann wird angedockt? ───────────────────────────────────────────────── */
/**
 * 'karte' — Karte sichtbar: offene Fenster docken an.
 * 'seite' — eine Seite (Auswertung, Gutachten, Projekt …) liegt über Karte und Spalte: Angedockte
 *           bleiben verdeckt in der Spalte und sind beim Zurück zur Karte wieder da; neu geöffnete
 *           docken erst dann an. (Früher wurden sie hier freigegeben und schwebten über der Seite.)
 * 'aus'   — keine Spalte (alte Oberfläche, Zweitbildschirm, schmaler Bildschirm): alles freigeben.
 */
function _dockZustand() {
  if (!_rechts || !document.body.classList.contains('ui-lkebw')) return 'aus';
  if (document.documentElement.dataset.dualScreen === 'on') return 'aus';
  if (window.innerWidth < MIN_BILDSCHIRM) return 'aus';
  if (ZENTRALANSICHTEN.some(id => { const v = document.getElementById(id); return v && v.style.display && v.style.display !== 'none'; })) return 'seite';
  const projekt = document.getElementById('center-projekt-view');
  if (projekt && !projekt.hidden) return 'seite';
  return 'karte';
}

/** Sichtbar ist ein Fenster über .visible oder (manche Module) über style.display;
 *  eine Werkzeugfläche, solange sie im DOM steht (oder nach ihrer eigenen Regel). */
function _offen(p) {
  const wz = WERKZEUGE[p.id];
  if (wz) return wz.offen ? wz.offen(p) : p.isConnected && !p.hidden;
  const d = p.style.display;
  return d ? d !== 'none' : p.classList.contains('visible');
}

function _andockbar(p) {
  return _offen(p) && !p.hasAttribute('data-kein-dock')
    && !p.classList.contains('inline-mode') && !p.classList.contains('dock-mode') && !p.classList.contains('dragging');
}

/* ── Andocken / Zurückgeben ─────────────────────────────────────────────── */
function _andocken(p) {
  if (p.parentElement !== _inhalt) {
    p._dockHeim = { parent: p.parentElement, next: p.nextElementSibling };
    // Startbreite: was das Modul für sein Fenster vorsieht (z. B. 660 px Engpässe), höchstens 720 px
    const w = WERKZEUGE[p.id]?.breite || (/^\d+px$/.test(p.style.width) ? parseInt(p.style.width, 10) : 0);
    if (w > BREITE_STANDARD) p._dockStandard = Math.min(720, w);
    _inhalt.appendChild(p);
    // Schaltbilder zeichnen sich für ihre neue Breite neu
    if (WERKZEUGE[p.id]?.neu) setTimeout(() => { try { WERKZEUGE[p.id].neu(); } catch { /* Modul noch nicht bereit */ } }, 60);
  }
  p.classList.add('im-dock');
  if (p.classList.contains('minimized')) p.classList.remove('minimized');
  if (!_reiter.includes(p.id)) { _reiter.push(p.id); _aktiv = p.id; _eingeklappt = false; }
}

function _zurueck(p, { umziehen = true } = {}) {
  p.classList.remove('im-dock', 'dock-aktiv');
  _reiter = _reiter.filter(id => id !== p.id);
  if (_aktiv === p.id) _aktiv = _reiter[_reiter.length - 1] || 'liste';
  if (!umziehen || p.parentElement !== _inhalt) return;
  const h = p._dockHeim;
  if (h?.parent?.isConnected) {
    if (h.next && h.next.parentElement === h.parent) h.parent.insertBefore(p, h.next);
    else h.parent.appendChild(p);
  } else document.body.appendChild(p);
}

/** Abgleich: Zustand der Fenster → Reiter. Idempotent, wird gebündelt aufgerufen. */
function _abgleich() {
  _geplant = 0;
  if (!_rechts) return;
  const zustand = _dockZustand();
  // 1. Angedockte prüfen
  for (const p of [..._inhalt.children]) {
    if (zustand === 'aus' || !_andockbar(p)) {
      // Wer an der Kopfzeile herausgezogen wurde, darf beim nächsten Öffnen wieder andocken
      _zurueck(p);
    }
  }
  // Fenster, die woanders hin verschoben wurden (Einbetten, Zweitbildschirm), nur aus der Liste nehmen
  _reiter.filter(id => { const p = document.getElementById(id); return !p || p.parentElement !== _inhalt; })
    .forEach(id => { const p = document.getElementById(id); if (p) _zurueck(p, { umziehen: false }); else _reiter = _reiter.filter(x => x !== id); });
  // Dialoge kennzeichnen (manche Module legen ihr Fenster erst beim ersten Öffnen an)
  DIALOGE.forEach(id => {
    const p = document.getElementById(id);
    if (p && !p.hasAttribute('data-kein-dock')) { p.setAttribute('data-kein-dock', ''); p.classList.add('ui-dialog-fenster'); }
  });
  // 2. Neu geöffnete einhängen
  if (zustand === 'karte') {
    const kandidaten = [...document.querySelectorAll('.float-panel')]
      .concat(Object.keys(WERKZEUGE).map(id => document.getElementById(id)).filter(Boolean));
    kandidaten.forEach(p => {
      if (!p.id || p.parentElement === _inhalt || p.closest('#ui-rechts')) return;
      if (_andockbar(p)) _andocken(p);
    });
  }
  // Asset-Inspektor geht auf (Klick auf eine Anlage) → Liste nach vorn, er steckt dort
  const insp = document.getElementById(INSPEKTOR_ID);
  const inspOffen = !!insp && insp.style.display !== 'none' && insp.style.display !== '';
  if (inspOffen && !_inspektorWarOffen && _aktiv !== 'liste') { _aktiv = 'liste'; _eingeklappt = false; }
  _inspektorWarOffen = inspOffen;
  // Frei verschobene Kartenfenster gehören zur Karte: auf Seiten ausblenden, bei der Karte wieder zeigen.
  // (contains vor add/remove: beides schreibt das class-Attribut sonst immer neu → Abgleich ohne Ende)
  document.querySelectorAll('.float-panel.dragging').forEach(p => {
    const weg = zustand === 'seite' && !p.hasAttribute('data-kein-dock');
    if (weg !== p.classList.contains('ui-seite-verdeckt')) p.classList.toggle('ui-seite-verdeckt', weg);
  });
  // Einmal herausgezogene, inzwischen geschlossene Fenster docken beim nächsten Öffnen wieder an
  document.querySelectorAll('.float-panel.dragging[data-aus-dock]').forEach(p => {
    if (_offen(p)) return;
    p.classList.remove('dragging', 'ui-seite-verdeckt');
    p.removeAttribute('data-aus-dock');
    p.style.left = p.style.top = p.style.transform = '';
  });
  if (_aktiv !== 'liste' && !_reiter.includes(_aktiv)) _aktiv = _reiter[_reiter.length - 1] || 'liste';
  _darstellen();
}

// setTimeout statt requestAnimationFrame: rAF ruht in Hintergrund-Tabs, das Andocken soll trotzdem stimmen
function _planen() {
  if (!_geplant) _geplant = setTimeout(_abgleich, 0);
}

/* ── Darstellung ────────────────────────────────────────────────────────── */
function _titel(p) {
  if (WERKZEUGE[p.id]) return WERKZEUGE[p.id].titel;
  const h = p.querySelector('.panel-drag-handle');
  const el = h?.querySelector('b, strong, span:not(.drag-dots)') || h;
  let t = (el?.textContent || p.id).replace(/[✕×✖▾▸⠿]/g, ' ').trim();
  // Führende Symbole/Emojis weg, Länge begrenzen
  t = t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ');
  return t.length > 28 ? t.slice(0, 27) + '…' : (t || p.id);
}

function _maxBreite() {
  const links = document.getElementById('left-panel')?.getBoundingClientRect().width || 0;
  return Math.max(BREITE_MIN, window.innerWidth - links - KARTE_MIN);
}

function _breite(id) {
  const b = Number(_breiten[id]) || document.getElementById(id)?._dockStandard || BREITE_STANDARD;
  return Math.round(Math.min(_maxBreite(), Math.max(BREITE_MIN, b)));
}

function _darstellen() {
  const hat = _reiter.length > 0;
  const body = document.body;
  body.classList.toggle('ui-dock-hat-reiter', hat);
  _rechts.classList.toggle('hat-reiter', hat);
  _rechts.classList.toggle('eingeklappt', hat && _eingeklappt);
  _rechts.dataset.aktiv = hat ? (_aktiv === 'liste' ? 'liste' : 'fenster') : 'liste';
  [..._inhalt.children].forEach(p => p.classList.toggle('dock-aktiv', p.id === _aktiv));
  _rechts.style.width = hat && !_eingeklappt && _aktiv !== 'liste' ? _breite(_aktiv) + 'px' : '';
  _karteAnpassen();
  if (!hat) { _leiste.innerHTML = ''; return; }
  const sb = document.getElementById('sidebar');
  const listeZu = sb?.classList.contains('collapsed');
  const reiter = [`<button type="button" class="ui-dock-r${_aktiv === 'liste' ? ' aktiv' : ''}" data-dock-reiter="liste" title="${listeZu ? 'Gebäude- und Anlagenliste einblenden' : 'Gebäude- und Anlagenliste'}"><span>Liste</span></button>`]
    .concat(_reiter.map(id => {
      const p = document.getElementById(id);
      const t = p ? _titel(p) : id;
      return `<button type="button" class="ui-dock-r${_aktiv === id ? ' aktiv' : ''}" data-dock-reiter="${_esc(id)}" title="${_esc(t)}"><span>${_esc(t)}</span><i data-dock-zu="${_esc(id)}" title="Schließen" aria-label="${_esc(t)} schließen">×</i></button>`;
    }));
  _leiste.innerHTML = `<div class="ui-dock-reiter" role="tablist">${reiter.join('')}</div>
    <button type="button" class="ui-dock-klapp" data-dock-klapp title="${_eingeklappt ? 'Spalte aufklappen' : 'Spalte einklappen — mehr Platz für die Karte'}" aria-label="${_eingeklappt ? 'Spalte aufklappen' : 'Spalte einklappen'}">${_eingeklappt ? '«' : '»'}</button>`;
}

/* ── Bedienung ──────────────────────────────────────────────────────────── */
function _schliessen(id) {
  const p = document.getElementById(id);
  if (!p) return;
  // Das eigene Schließen-Element des Fensters benutzen, damit Modulzustand (Knöpfe, Layer) stimmt
  if (WERKZEUGE[id]) { WERKZEUGE[id].zu(); _planen(); return; }
  const h = p.querySelector('.panel-drag-handle');
  const zu = h && [...h.querySelectorAll('button, span, a, i')].find(el => /^[✕×✖]$/.test(el.textContent.trim()));
  if (zu) zu.click();
  if (_offen(p)) { p.classList.remove('visible'); if (p.style.display) p.style.display = 'none'; }
  _planen();
}

function _klick(e) {
  const zu = e.target.closest('[data-dock-zu]');
  if (zu) { e.stopPropagation(); _schliessen(zu.dataset.dockZu); return; }
  if (e.target.closest('[data-dock-klapp]')) { _eingeklappt = !_eingeklappt; _merken(); _darstellen(); return; }
  const r = e.target.closest('[data-dock-reiter]');
  if (!r) return;
  _aktiv = r.dataset.dockReiter;
  if (_eingeklappt) { _eingeklappt = false; _merken(); }
  if (_aktiv === 'liste' && document.getElementById('sidebar')?.classList.contains('collapsed')) window.toggleSidebar?.();
  _darstellen();
}

/** Breite am linken Rand ziehen. */
function _griffStart(e) {
  if (_aktiv === 'liste' || _eingeklappt) return;
  e.preventDefault();
  const id = _aktiv;
  const x0 = e.clientX, b0 = _rechts.getBoundingClientRect().width;
  _rechts.classList.add('zieht');
  const bewegen = ev => {
    _breiten[id] = Math.min(_maxBreite(), Math.max(BREITE_MIN, b0 + (x0 - ev.clientX)));
    _rechts.style.width = Math.round(_breiten[id]) + 'px';
  };
  const ende = () => {
    document.removeEventListener('pointermove', bewegen);
    document.removeEventListener('pointerup', ende);
    _rechts.classList.remove('zieht');
    _merken();
    _karteAnpassen();
  };
  document.addEventListener('pointermove', bewegen);
  document.addEventListener('pointerup', ende);
}

/**
 * Kopfzeile eines angedockten Fensters: kein Verschieben im Dock. Wer sie deutlich nach links
 * zieht, löst das Fenster heraus und verschiebt es frei weiter (wie vorher).
 */
function _kopfMausdruck(e) {
  const h = e.target.closest('.panel-drag-handle');
  if (!h || e.button !== 0) return;
  e.stopPropagation();   // inline onmousedown="startDrag(…)" nicht im Dock auslösen
  if (e.target.closest('button, a, input, select, [data-click]')) return;
  e.preventDefault();    // sonst markiert das Ziehen nebenbei Text
  const p = h.parentElement;
  const x0 = e.clientX, y0 = e.clientY;
  const bewegen = ev => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 24) return;
    aufhoeren();
    _herausloesen(p, ev);
  };
  const aufhoeren = () => { document.removeEventListener('mousemove', bewegen); document.removeEventListener('mouseup', aufhoeren); };
  document.addEventListener('mousemove', bewegen);
  document.addEventListener('mouseup', aufhoeren);
}

function _herausloesen(p, ev) {
  const breite = Math.min(_breite(p.id), 640);
  p.classList.add('dragging');
  p.setAttribute('data-aus-dock', '');
  _zurueck(p);
  _darstellen();
  const bezug = p.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
  p.style.transform = 'none';
  p.style.left = Math.max(0, ev.clientX - bezug.left - Math.min(160, breite / 2)) + 'px';
  p.style.top = Math.max(0, ev.clientY - bezug.top - 16) + 'px';
  if (!p.style.width) p.style.width = breite + 'px';
  window.startDrag?.(ev, p.id);
}

/* ── Aufbau ─────────────────────────────────────────────────────────────── */
export function dockInit() {
  const sb = document.getElementById('sidebar');
  if (!sb || document.getElementById('ui-rechts')) return;
  _laden();
  _rechts = document.createElement('div');
  _rechts.id = 'ui-rechts';
  _rechts.className = 'ui-rechts';
  _rechts.innerHTML = '<div class="ui-dock-griff" title="Breite ziehen"></div><div class="ui-dock-leiste"></div><div id="ui-dock-inhalt" class="ui-dock-inhalt"></div>';
  sb.parentElement.insertBefore(_rechts, sb);
  _griff = _rechts.querySelector('.ui-dock-griff');
  _leiste = _rechts.querySelector('.ui-dock-leiste');
  _inhalt = _rechts.querySelector('#ui-dock-inhalt');
  _rechts.insertBefore(sb, _inhalt);

  _leiste.addEventListener('click', _klick);
  _griff.addEventListener('pointerdown', _griffStart);
  _inhalt.addEventListener('mousedown', _kopfMausdruck, true);

  // Fenster öffnen/schließen sich über class/style — nur relevante Änderungen zählen
  // (die Karte ändert beim Verschieben laufend Stile ihrer Kacheln).
  const relevant = t => t === document.body || t === document.documentElement
    || t.classList?.contains('float-panel') || t.id in WERKZEUGE || t.id === INSPEKTOR_ID
    || t.id === 'sidebar' || ZENTRALANSICHTEN.includes(t.id) || t.id === 'center-projekt-view';
  new MutationObserver(recs => { if (recs.some(r => relevant(r.target))) _planen(); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  new MutationObserver(_planen).observe(document.documentElement, { attributes: true, attributeFilter: ['data-dual-screen'] });
  // Fenster, die ein Modul erst beim ersten Öffnen anlegt
  new MutationObserver(recs => { if (recs.some(r => [...r.addedNodes].some(n => n.classList?.contains('float-panel') || n.id in WERKZEUGE))) _planen(); })
    .observe(document.body, { childList: true });
  // Werkzeugflächen entfernen sich beim Schließen selbst aus dem DOM (auch aus der Spalte)
  new MutationObserver(recs => { if (recs.some(r => r.removedNodes.length)) _planen(); })
    .observe(_inhalt, { childList: true });
  window.addEventListener('resize', _planen);

  // Karte an ihre neue Breite anpassen, auch wenn jemand anderes die Spalte verändert
  // (Liste ein-/ausklappen). Zusätzlich direkt nach jeder eigenen Änderung (_darstellen),
  // weil ResizeObserver in nicht sichtbaren Fenstern nicht feuert.
  const karte = document.getElementById('map');
  if (karte && typeof ResizeObserver === 'function') new ResizeObserver(_karteAnpassen).observe(karte);
  _abgleich();
}

let _karteTimer = 0;
function _karteAnpassen() {
  if (_karteTimer) return;
  _karteTimer = setTimeout(() => { _karteTimer = 0; window.map?.invalidateSize?.({ pan: false }); }, 30);
}

/** Für andere Module: ein angedocktes Fenster nach vorn holen. */
export function dockZeigen(id) {
  if (!_reiter.includes(id)) return false;
  _aktiv = id;
  _eingeklappt = false;
  _darstellen();
  return true;
}
