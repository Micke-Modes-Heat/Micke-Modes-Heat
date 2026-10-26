// @ts-check
// ── 55-auswertung-fenster.js — Auswertung im eigenen Fenster (zweiter Bildschirm) ──
//
// Prototyp. Auswertung und Gutachten (#center-analyse-view mit der Seitennavigation) ziehen in
// ein eigenes Browserfenster, die Karte bleibt im Hauptfenster. Jedes Fenster lässt sich auf
// seinem Monitor maximieren — keine Monitorkante mitten in der App, gemischte Skalierung egal.
//
// Wie 54-checkliste-fenster: about:blank-Fenster ohne eigenes Skript, gleiche Herkunft. Anders
// als dort wird nichts nachgebaut: die vorhandenen DOM-Knoten ziehen um, samt ihrer Listener.
// Damit die Module sie weiter finden, sucht document.getElementById / querySelector(All) des
// Hauptfensters bei offenem Fenster auch dort (_umleitungAn). Die data-*-Handler (12) und die
// Navigationsklicks (49) hängen zusätzlich am Fenster-Dokument.
//
// Bekannte Grenzen: Dialoge und Hinweise, die Module an document.body hängen, erscheinen im
// Hauptfenster. Dokumentweite Listener anderer Module (z. B. Scroll-Verfolgung der PV-Analyse,
// Tastenkürzel) greifen im Fenster nicht.

import { inlineHandlerAnbinden } from './12-inline-handlers.js';
import { uiAuswertungsfenster, uiAuswertungsfensterNav, uiAuswertungsfensterSchritt, uiKlickAnbinden } from './49-oberflaeche.js';

const FENSTER_NAME = 'mmh-auswertung';
const LAGE_KEY = 'micke.af.lage';
const TAKT_MS = 1000;
// Was umzieht, und wohin im Fenster
const KNOTEN = [
  { id: 'ui-seitennav', ziel: '#af-spalte' },
  { id: 'center-analyse-view', ziel: '#af-haupt' },
  // Gutachten neben der Auswertung (21) — entsteht ggf. erst im Fenster, dann ohne Heimatplatz
  { id: 'gut-daneben', ziel: '#af-haupt' },
];

/** @type {Window|null} */
let _win = null;
/** @type {Document|null} */
let _doc = null;
let _takt = 0;
/** @type {Map<string, { parent: Node, next: Node|null }>} */
const _heim = new Map();
/** @type {MutationObserver|null} */
let _spiegel = null;

const _D = Document.prototype;

/** true, solange Auswertung und Gutachten im eigenen Fenster liegen. */
export function afAktiv() { return !!_doc; }

export function afFokus() { try { _win?.focus(); } catch (e) { /* Fenster schon zu */ } }

// ── Umleitung: Module suchen ihre Knoten weiter über document ──────────
function _umleitungAn() {
  const d = /** @type {any} */ (document);
  d.getElementById = (/** @type {string} */ id) => _D.getElementById.call(document, id) || _doc?.getElementById(id) || null;
  d.querySelector = (/** @type {string} */ sel) => _D.querySelector.call(document, sel) || _doc?.querySelector(sel) || null;
  d.querySelectorAll = (/** @type {string} */ sel) => {
    const hier = _D.querySelectorAll.call(document, sel);
    const dort = _doc?.querySelectorAll(sel);
    return dort && dort.length ? [...hier, ...dort] : hier;
  };
}

function _umleitungAus() {
  const d = /** @type {any} */ (document);
  delete d.getElementById; delete d.querySelector; delete d.querySelectorAll;
}

// ── Fenster ────────────────────────────────────────────────────────────
// Aufbau: Kopfzeile wie im Hauptfenster (ui-frame) mit dem Ansicht-Umschalter in der Mitte; darunter
// links die Spalte mit den Reitern Auswertung | Gutachten | Checkliste, rechts die Ansicht(en).
// Die Reiter wechseln nur die Liste, der Umschalter nur die Aufteilung, ein Listeneintrag den Inhalt.
const _CSS = `
html,body{height:100%;margin:0}
body.af-body{display:flex;flex-direction:column!important;overflow:hidden;background:var(--bg);color:var(--text)}
.af-kopf .af-proj{font-weight:600;font-size:14px;max-width:340px;overflow:hidden;text-overflow:ellipsis}
.af-kopf .af-proj:empty::before{content:'Unbenanntes Projekt';color:var(--on-frame-muted);font-weight:400}
.af-ansicht{position:absolute;left:50%;transform:translateX(-50%);display:inline-flex;gap:2px;padding:3px;border-radius:var(--r);background:var(--frame-2)}
.af-ansicht button{all:unset;cursor:pointer;display:flex;align-items:center;gap:7px;height:28px;padding:0 14px;border-radius:calc(var(--r) - 2px);font-size:13px;font-weight:600;color:var(--on-frame-muted)}
.af-ansicht button:hover{color:var(--on-frame)}
.af-ansicht button[aria-pressed="true"]{background:var(--on-frame);color:var(--frame)}
.af-hinweis{padding:6px 16px;font-size:12px;line-height:1.45;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border)}
.af-hinweis:empty{display:none}
#af-haupt{display:flex;flex:1;min-height:0}
#af-spalte{display:flex;flex-direction:column;flex:0 0 auto;width:var(--nav-w,240px);min-height:0;background:var(--surface);border-right:1px solid var(--border)}
#af-spalte #ui-seitennav{display:block!important;flex:1;width:auto;min-height:0;border-right:0}
#af-spalte .ui-nav-titel{display:none}
.af-reiter{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.af-reiter button{all:unset;flex:1;text-align:center;padding:9px 0 7px;font-size:12.5px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent}
.af-reiter button:hover{color:var(--text)}
.af-reiter button[aria-selected="true"]{color:var(--text);font-weight:700;border-bottom-color:var(--brand)}
#af-checkliste{flex:1;min-height:0;width:100%;border:0;display:none;background:var(--bg)}
#af-spalte.af-ck{width:400px}
#af-spalte.af-ck #ui-seitennav{display:none!important}
#af-spalte.af-ck #af-checkliste{display:block}
body.af-body #center-analyse-view{display:block!important;position:relative!important;inset:auto!important;flex:1;min-width:0;height:100%;box-sizing:border-box;z-index:auto}
body.af-body.gut-daneben #gut-daneben{display:flex!important;position:relative!important;inset:auto!important;flex:0 0 var(--gut-breite,980px);width:auto;height:100%}
body.af-body .gut-pin{display:none!important}
`;

const _SYM_EINZELN = '<svg class="ui-i" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/></svg>';
const _SYM_DANEBEN = '<svg class="ui-i" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/></svg>';

function _geruest(/** @type {Window} */ w) {
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Auswertung</title></head>
    <body class="af-body">
    <header class="ui-frame af-kopf" id="af-kopf">
      <div class="ui-brand" title="LKEBw Energieplaner"><img class="ui-logo" id="af-logo" alt="LKEBw" height="26"><span class="ui-brand-sub">Energieplaner</span></div>
      <span class="af-proj" id="af-proj"></span>
      <div class="af-ansicht" role="group" aria-label="Ansicht">
        <button type="button" data-af="einzeln" title="Eine Seite über die ganze Breite">${_SYM_EINZELN}Eine Seite</button>
        <button type="button" data-af="daneben" title="Gutachten rechts, links frei durch die Auswertung blättern">${_SYM_DANEBEN}Gutachten daneben</button>
      </div>
      <div class="ui-frame-right">
        <button class="ui-fbtn" type="button" data-click="cycleTheme()" title="Hell / dunkel umschalten" aria-label="Darstellung hell oder dunkel"><svg class="ui-i"><use href="#ui-i-moon"/></svg></button>
        <button class="ui-fbtn ui-fbtn-txt" type="button" data-af="bildschirm" title="Fenster auf den anderen Bildschirm legen und dort ausfüllen"><svg class="ui-i"><use href="#ui-i-screen"/></svg>Anderer Bildschirm</button>
        <button class="ui-fbtn ui-fbtn-txt" type="button" data-af="zurueck" title="Fenster schließen — Auswertung und Gutachten wieder im Hauptfenster"><svg class="ui-i"><use href="#ui-i-x"/></svg>Zurück ins Hauptfenster</button>
      </div>
    </header>
    <div class="af-hinweis" id="af-hinweis"></div><div class="hint hidden" id="hint">–</div>
    <div id="af-haupt"><div id="af-spalte"><div class="af-reiter" role="tablist">
      <button type="button" role="tab" data-af-reiter="auswertung">Auswertung</button>
      <button type="button" role="tab" data-af-reiter="gutachten">Gutachten</button>
      <button type="button" role="tab" data-af-reiter="checkliste" title="Elektro-Checkliste mit Status und Notizen — folgt der Stelle, an der im Hauptfenster gearbeitet wird">Checkliste</button>
    </div></div></div></body></html>`);
  doc.close();
  // Stil des Tools übernehmen (im Build eingebettet, im Dev als Links — absolut, sonst lösen sie im Fenster falsch auf)
  for (const n of _D.querySelectorAll.call(document, 'style, link[rel="stylesheet"]')) {
    const k = /** @type {HTMLElement} */ (doc.importNode(n, true));
    if (n instanceof HTMLLinkElement) k.setAttribute('href', n.href);
    doc.head.appendChild(k);
  }
  const eigen = doc.createElement('style');
  eigen.textContent = _CSS;
  doc.head.appendChild(eigen);
  // Symbolsatz (<use href="#ui-i-…">) — Verweise gelten nur im eigenen Dokument
  for (const svg of _D.querySelectorAll.call(document, 'body > svg')) {
    if (svg.querySelector('symbol')) doc.body.insertBefore(doc.importNode(svg, true), doc.body.firstChild);
  }
  const logo = /** @type {HTMLImageElement|null} */ (_D.getElementById.call(document, 'ui-logo'));
  const afLogo = /** @type {HTMLImageElement|null} */ (doc.getElementById('af-logo'));
  if (logo && afLogo) afLogo.src = logo.src;
}

/** Thema und Zustandsklassen des Hauptfensters spiegeln (hell/dunkel, ui-lkebw, aktiver Abschnitt). */
function _spiegeln() {
  if (!_doc) return;
  const html = _doc.documentElement;
  for (const a of [...html.attributes]) if (!document.documentElement.hasAttribute(a.name)) html.removeAttribute(a.name);
  for (const a of [...document.documentElement.attributes]) html.setAttribute(a.name, a.value);
  const b = _doc.body;
  b.className = document.body.className.split(/\s+/).filter(c => c && !c.startsWith('ui-schritt-')).concat('af-body').join(' ');
  for (const k of Object.keys(b.dataset)) delete b.dataset[k];
  Object.assign(b.dataset, document.body.dataset);
  b.dataset.uiLayout = 'nav';
  _kopfAnzeigen();
}

/** Kopfzeile nachziehen: Projektname und welcher Ansicht-Knopf gedrückt ist. */
function _kopfAnzeigen() {
  if (!_doc) return;
  const daneben = document.body.classList.contains('gut-daneben');
  _doc.querySelectorAll('.af-ansicht [data-af]').forEach(b => b.setAttribute('aria-pressed',
    String((/** @type {HTMLElement} */ (b).dataset.af === 'daneben') === daneben)));
  const proj = _doc.getElementById('af-proj');
  const name = (/** @type {any} */ (window).getProjektName?.() || '').trim();
  if (proj && proj.textContent !== name) proj.textContent = name;
}

// ── Reiter der linken Spalte: Auswertung | Gutachten (Seitennavigation, 49) | Checkliste (54, iframe) ──
const REITER_KEY = 'micke.af.reiter';
/** @type {MutationObserver|null} */
let _navBeobachter = null;

function _reiter(/** @type {string} */ welcher) {
  const spalte = _doc?.getElementById('af-spalte');
  if (!_doc || !spalte) return;
  if (!['auswertung', 'gutachten', 'checkliste'].includes(welcher)) welcher = uiAuswertungsfensterSchritt() || 'auswertung';
  const ck = welcher === 'checkliste';
  spalte.classList.toggle('af-ck', ck);
  // Nur die Liste wechselt — was rechts zu sehen ist, bleibt
  if (!ck) uiAuswertungsfensterNav(welcher);
  _reiterAnzeigen();
  try { localStorage.setItem(REITER_KEY, welcher); } catch (e) { /* ohne Speicher */ }
  if (!ck) return;
  // Erst beim ersten Öffnen anlegen; 54 zeichnet hinein wie in sein eigenes Fenster
  let f = /** @type {HTMLIFrameElement|null} */ (_doc.getElementById('af-checkliste'));
  if (!f) {
    f = _doc.createElement('iframe');
    f.id = 'af-checkliste';
    f.title = 'Elektro-Checkliste';
    f.allow = 'clipboard-write';   // Rückfragen kopieren (54) — sonst kann navigator.clipboard im iframe scheitern
    spalte.appendChild(f);
  }
  if (f.contentWindow) /** @type {any} */ (window).ecEinbetten?.(f.contentWindow);
}

/** Markierten Reiter nachziehen — auch wenn das Hauptfenster die Liste umschaltet (Schritt Auswertung/Gutachten). */
function _reiterAnzeigen() {
  const spalte = _doc?.getElementById('af-spalte');
  if (!_doc || !spalte) return;
  const sel = spalte.classList.contains('af-ck') ? 'checkliste' : uiAuswertungsfensterSchritt();
  _doc.querySelectorAll('[data-af-reiter]').forEach(b => b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.afReiter === sel)));
}

/** Checkliste im Auswertungsfenster zeigen (54 ruft das, statt ein eigenes Fenster zu öffnen). */
export function afCheckliste() {
  if (!_doc) return;
  _reiter('checkliste');
  afFokus();
}

function _fensterKlick(/** @type {MouseEvent} */ e) {
  const r = /** @type {HTMLElement} */ (e.target).closest?.('[data-af-reiter]');
  if (r) { _reiter(/** @type {HTMLElement} */ (r).dataset.afReiter || 'auswertung'); return; }
  const x = /** @type {HTMLElement} */ (e.target).closest?.('[data-af]');
  if (!x) return;
  const w = /** @type {any} */ (window);
  const was = /** @type {HTMLElement} */ (x).dataset.af;
  if (was === 'zurueck') afSchliessen();
  else if (was === 'bildschirm' && _win) _aufAnderenBildschirm(_win, true);
  else if (was === 'daneben') w.gutDanebenSetzen?.(true);
  else if (was === 'einzeln' && w.gutDanebenAktiv?.()) w.gutDanebenSetzen?.(false, { still: true });
  _kopfAnzeigen();
}

function _tick() {
  if (!_win || _win.closed) { _zurueck(); return; }
  try { localStorage.setItem(LAGE_KEY, JSON.stringify({ x: _win.screenX, y: _win.screenY, b: _win.outerWidth, h: _win.outerHeight })); } catch (e) { /* ohne Speicher */ }
  const name = (/** @type {any} */ (window).getProjektName?.() || '').trim();
  const titel = `${uiAuswertungsfensterSchritt() === 'gutachten' ? 'Gutachten' : 'Auswertung'}${name ? ' – ' + name : ''}`;
  if (_doc && _doc.title !== titel) _doc.title = titel;
  _kopfAnzeigen();
}

// ── Dialoge, Rückfragen und Hinweise im Fenster, in dem gerade gearbeitet wird ──
// Aktiv ist das Fenster mit dem Fokus, im Zweifel das, in dem zuletzt geklickt oder getippt wurde.
// - alert/confirm/prompt: eigene Properties am window des Hauptfensters (bare Aufrufe treffen sie
//   mit), die bei aktivem Auswertungsfenster dessen Dialog öffnen. Beim Schließen wieder entfernt.
// - Overlays (Modaldialoge, Vollbild-Ansichten …), die Module an document.body hängen, landen über
//   eine eigene appendChild/append am body gleich im aktiven Fenster; einmal angelegte, später
//   wieder eingeblendete folgen beim Einblenden. epConfirm/epPrompt (05b) fragen afDialogBody,
//   showHint (03c) nimmt die Hinweisleiste aus afHinweisElement.
// - Inline-Handler (onclick, ondrop …) im Fenster laufen im Hauptfenster (dort liegen die Funktionen);
//   removeChild am body entfernt auch ein Overlay, das inzwischen im Fenster steht.

let _zuletzt = 'haupt';
/** @type {Record<string, any>} */
const _nativ = {};
/** @type {Set<HTMLElement>} */
const _dialoge = new Set();
/** @type {MutationObserver|null} */
let _dialogSicht = null;
const _N = Node.prototype;
// Nie umziehen: Hinweisleiste, Befehlssuche (Strg K nur im Hauptfenster), Leitfaden über der Karte
const _NIE = /^(hint|ui-pal|hilfe-)/;

/** Wird gerade im Auswertungsfenster gearbeitet? */
export function afImFenster() {
  if (!_doc || !_win || _win.closed) return false;
  try {
    if (_doc.hasFocus()) return true;
    if (document.hasFocus()) return false;
  } catch (e) { /* Fenster im Abbau */ }
  return _zuletzt === 'fenster';
}

/** body des Auswertungsfensters, wenn dort gearbeitet wird — sonst null (dann document.body nehmen). */
export function afDialogBody() { return afImFenster() ? /** @type {Document} */ (_doc).body : null; }

/** Hinweisleiste des Auswertungsfensters (für showHint, 03c) oder null. */
export function afHinweisElement() { return _doc?.getElementById('hint') || null; }

const _merkHaupt = () => { _zuletzt = 'haupt'; };
const _merkFenster = () => { _zuletzt = 'fenster'; };

/** Sieht das Element wie ein Dialog/Overlay aus? Auch vor dem Einhängen (dann nur Name und Inline-Stil). */
function _istDialog(/** @type {any} */ el) {
  if (!el || el.nodeType !== 1 || /^(SCRIPT|STYLE|LINK|INPUT|A|IFRAME)$/.test(el.tagName)) return false;
  if (_NIE.test(el.id || '') || el.classList.contains('float-panel')) return false;
  const name = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
  if (/overlay|modal|dialog|-bg\b|lightbox/i.test(name)) return true;
  const st = el.isConnected ? (el.ownerDocument.defaultView || window).getComputedStyle(el) : el.style;
  const null0 = (/** @type {string} */ v) => v === '0px' || v === '0';
  return st.position === 'fixed' && null0(st.top) && null0(st.left) && null0(st.right) && null0(st.bottom);
}

function _sichtbar(/** @type {HTMLElement} */ el) {
  if (el.hidden) return false;
  const v = el.ownerDocument.defaultView;
  return !!v && v.getComputedStyle(el).display !== 'none';
}

function _dialogVerfolgen(/** @type {HTMLElement} */ el) {
  if (_dialoge.has(el)) return;
  _dialoge.add(el);
  _dialogSicht?.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
}

/** Ein verfolgtes Overlay, das gerade zu sehen ist, ins aktive Fenster holen. */
function _dialogHinbringen(/** @type {HTMLElement} */ el) {
  if (!_doc || !el.isConnected || !_sichtbar(el)) return;
  const ziel = afImFenster() ? _doc.body : document.body;
  if (el.parentNode !== ziel) _N.appendChild.call(ziel, el);
}

// Ereignisse, deren Inline-Handler im Tool vorkommen (z. B. Ziehen im Ausbauplaner)
const _INLINE = ['click', 'dblclick', 'change', 'input', 'keydown', 'mouseover', 'mouseout', 'dragstart', 'dragover', 'dragleave', 'drop', 'dragend'];

/**
 * Inline-Handler im Fenster an eine Funktion des Hauptfensters binden — beim ersten Auftreten des
 * Ereignisses, in der Capture-Phase (also bevor der Handler selbst läuft). Im Fenster selbst fehlen
 * die Funktionen des Tools; this und event bleiben, wie sie sind.
 */
function _inlineBruecke(/** @type {Event} */ ev) {
  const attr = 'on' + ev.type, merk = '_afBruecke_' + ev.type;
  for (let el = /** @type {any} */ (ev.target); el && el.nodeType === 1; el = el.parentElement) {
    if (el[merk] || !el.hasAttribute(attr)) continue;
    el[merk] = true;
    try {
      const f = new Function('event', el.getAttribute(attr));
      el[attr] = function (/** @type {Event} */ e) { return f.call(this, e); };
    } catch (e) { /* ungültiger Handler — bleibt, wie er ist */ }
  }
}

function _dialogeAn() {
  const w = /** @type {any} */ (window);
  for (const k of ['alert', 'confirm', 'prompt']) {
    _nativ[k] = w[k];
    w[k] = (/** @type {any[]} */ ...a) => (afImFenster() ? /** @type {any} */ (_win)[k](...a) : _nativ[k].apply(window, a));
  }
  const b = /** @type {any} */ (document.body);
  b.appendChild = function (/** @type {any} */ n) {
    if (_istDialog(n)) {
      _dialogVerfolgen(n);
      if (afImFenster() && _doc) return _N.appendChild.call(_doc.body, n);
    }
    return _N.appendChild.call(this, n);
  };
  b.append = function (/** @type {any[]} */ ...nodes) {
    for (const n of nodes) b.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
  };
  b.removeChild = function (/** @type {any} */ n) {
    if (n?.parentNode && n.parentNode !== this) { n.remove(); return n; }
    return _N.removeChild.call(this, n);
  };
  _dialogSicht = new MutationObserver(recs => { for (const r of recs) _dialogHinbringen(/** @type {HTMLElement} */ (r.target)); });
  // Schon angelegte Overlays, die später wieder eingeblendet werden (z. B. Vollbild der PV-Analyse)
  for (const el of [...document.body.children]) if (_istDialog(el)) _dialogVerfolgen(/** @type {HTMLElement} */ (el));
  window.addEventListener('pointerdown', _merkHaupt, true);
  window.addEventListener('keydown', _merkHaupt, true);
  _win?.addEventListener('pointerdown', _merkFenster, true);
  _win?.addEventListener('keydown', _merkFenster, true);
  for (const t of _INLINE) _doc?.addEventListener(t, _inlineBruecke, true);
  // Auswertung ↔ Karte (57) auch im Fenster
  if (_doc) w.kbAnbinden?.(_doc);
}

function _dialogeAus() {
  const w = /** @type {any} */ (window);
  for (const k of Object.keys(_nativ)) { w[k] = _nativ[k]; delete _nativ[k]; }
  const b = /** @type {any} */ (document.body);
  delete b.appendChild; delete b.append; delete b.removeChild;
  _dialogSicht?.disconnect();
  _dialogSicht = null;
  // Was noch im Fenster steht, zurück — die Module halten es teils fest und blenden es später wieder ein
  for (const el of _dialoge) if (el.isConnected && el.ownerDocument !== document) _N.appendChild.call(document.body, el);
  _dialoge.clear();
  window.removeEventListener('pointerdown', _merkHaupt, true);
  window.removeEventListener('keydown', _merkHaupt, true);
  _zuletzt = 'haupt';
}

// ── Öffnen / Schließen ─────────────────────────────────────────────────
// Erst öffnen (synchron, sonst blockt der Browser das Pop-up), dann beim allerersten Mal auf den
// anderen Bildschirm schieben (Window Management API, nur gehostet; fragt einmal nach Erlaubnis).
export function afOeffnen() {
  if (_win && !_win.closed && _doc) { _win.focus(); return; }
  if (!_D.getElementById.call(document, 'ui-seitennav')) { /** @type {any} */ (window).showHint?.('Das Auswertungsfenster gibt es nur in der neuen Oberfläche.', 5000); return; }

  let l = null;
  try { l = JSON.parse(localStorage.getItem(LAGE_KEY) || 'null'); } catch (e) { /* ohne Speicher */ }
  const gemerkt = !!l;
  l = l || { x: window.screenX + window.outerWidth, y: window.screenY, b: Math.min(1400, screen.availWidth), h: screen.availHeight };
  const w = window.open('', FENSTER_NAME, `popup=yes,left=${Math.round(l.x)},top=${Math.round(l.y)},width=${Math.round(l.b)},height=${Math.round(l.h)}`);
  if (!w) { /** @type {any} */ (window).showHint?.('Das Fenster wurde vom Browser blockiert. Pop-ups für dieses Tool erlauben.', 6000); return; }

  _geruest(w);
  _win = w;
  _doc = w.document;
  _umleitungAn();
  inlineHandlerAnbinden(_doc);
  uiKlickAnbinden(_doc);
  _doc.addEventListener('click', _fensterKlick);
  _dialogeAn();

  for (const { id, ziel } of KNOTEN) {
    const el = _D.getElementById.call(document, id);
    const wohin = _doc.querySelector(ziel);
    if (!el || !el.parentNode || !wohin) continue;
    _heim.set(id, { parent: el.parentNode, next: el.nextSibling });
    wohin.appendChild(el);
  }
  _spiegeln();
  _spiegel = new MutationObserver(_spiegeln);
  _spiegel.observe(document.documentElement, { attributes: true });
  _spiegel.observe(document.body, { attributes: true });

  uiAuswertungsfenster(true);
  // Im Hauptfenster gilt die Analyse als geschlossen (52 dockt sonst nicht an); im Fenster erzwingt _CSS die Anzeige
  const av = _doc.getElementById('center-analyse-view');
  if (av) av.style.display = 'none';
  let reiter = '';
  try { reiter = localStorage.getItem(REITER_KEY) || ''; } catch (e) { /* ohne Speicher */ }
  _reiter(reiter === 'checkliste' ? reiter : '');
  const nav = _doc.getElementById('ui-seitennav');
  if (nav) { _navBeobachter = new MutationObserver(_reiterAnzeigen); _navBeobachter.observe(nav, { childList: true }); }
  const hinweis = _doc.getElementById('af-hinweis');
  if (hinweis && typeof (/** @type {any} */ (window).getScreenDetails) !== 'function') {
    hinweis.textContent = 'Fenster auf den zweiten Bildschirm ziehen und maximieren — die Lage wird gemerkt.';
  }

  // Fenster zu oder neu geladen → Inhalte zurück, solange sein Dokument noch lebt
  w.addEventListener('pagehide', () => { _zurueck(); setTimeout(() => { try { w.close(); } catch (e) { /* schon zu */ } }, 0); });
  if (_takt) clearInterval(_takt);
  _takt = /** @type {any} */ (setInterval(_tick, TAKT_MS));
  _tick();
  document.getElementById('btn-af-fenster')?.classList.add('active');
  w.focus();
  if (!gemerkt) _aufAnderenBildschirm(w, false);
}

/** Inhalte zurück ins Hauptfenster und Fenster schließen. */
export function afSchliessen() {
  const w = _win;
  _zurueck();
  try { w?.close(); } catch (e) { /* schon zu */ }
}

function _zurueck() {
  if (!_doc) return;
  if (_takt) clearInterval(_takt);
  _takt = 0;
  _spiegel?.disconnect();
  _spiegel = null;
  _navBeobachter?.disconnect();
  _navBeobachter = null;
  for (const { id } of KNOTEN) {
    const el = _doc.getElementById(id);
    const h = _heim.get(id);
    if (!el) continue;
    // Erst im Fenster entstanden (Gutachten daneben): hinter die Analyseansicht, wie es 21 anlegt
    if (!h) { _D.getElementById.call(document, 'center-analyse-view')?.after(el); continue; }
    if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(el, h.next);
    else h.parent.appendChild(el);
  }
  _heim.clear();
  _dialogeAus();
  _umleitungAus();
  _win = null;
  _doc = null;
  uiAuswertungsfenster(false);
  // Eingebettete Panels (Strom, Wirtschaftlichkeit …) an ihren Platz, wie beim Verlassen der Analyse
  /** @type {any} */ (window)._restoreInlinePanels?.();
  document.getElementById('btn-af-fenster')?.classList.remove('active');
}

/**
 * Fenster auf einen anderen Bildschirm legen und ihn ausfüllen.
 * @param {Window} w
 * @param {boolean} ausFenster  vom Knopf im Fenster: dessen Bildschirm ist „der aktuelle“, Hinweis bei Fehlschlag
 */
async function _aufAnderenBildschirm(w, ausFenster) {
  const quelle = /** @type {any} */ (ausFenster ? w : window);
  const hinweis = (/** @type {string} */ t) => { const h = _doc?.getElementById('af-hinweis'); if (h) h.textContent = t; };
  if (typeof quelle.getScreenDetails !== 'function') {
    if (ausFenster) hinweis('Automatisch geht das nur in der gehosteten Version. Fenster bitte von Hand hinüberziehen und maximieren.');
    return;
  }
  try {
    const d = await quelle.getScreenDetails();
    const anderer = d.screens.find((/** @type {any} */ s) => s !== d.currentScreen);
    if (!anderer) { if (ausFenster) hinweis('Es ist nur ein Bildschirm angeschlossen.'); return; }
    if (w.closed) return;
    w.moveTo(anderer.availLeft, anderer.availTop);
    w.resizeTo(anderer.availWidth, anderer.availHeight);
    hinweis('');
  } catch (e) {
    if (ausFenster) hinweis('Zugriff auf die Bildschirmanordnung nicht erlaubt: ' + (/** @type {any} */ (e)?.message || e));
  }
}

// Hauptfenster lädt neu oder schließt → Fenster mit schließen (seine Knoten gehören zu dieser Seite)
window.addEventListener('pagehide', () => { if (_win) { const w = _win; _zurueck(); try { w.close(); } catch (e) { /* egal */ } } });
