// Datenqualität: Plausibilitätshinweise zu Kernparametern auf der Projektseite und am Feld,
// dazu „Beispielprojekt öffnen“. Die Bereiche stehen in lib/plausibilitaet.js.
// Hängt sich selbst in die Projektseite (src/49) ein — dort ist nichts umzubauen.
import { PLAUSI_PARAMETER, pruefeGebaeude, pruefeParameter } from './lib/plausibilitaet.js';
import { bhkw, fliessgewaesser, gasKessel, gebaeude, geoThermie, heizhackschnitzel, heizoelKessel, lwWp, pelletsKessel, stromkessel } from './01-globals-varianten.js';
import MUSTERPROJEKT_TEXT from '../data/demo_projekt.json?raw';

// Korrekturen aus dem letzten Projektimport (bleiben bis zum nächsten Laden sichtbar)
let _korrekturen = [];
let _letzte = [];
let _timer = 0;

const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _ic = (id, cls = 'ui-i') => `<svg class="${cls}"><use href="#ui-i-${id}"/></svg>`;

function _aktiveErzeuger() {
  const an = new Set();
  const paare = { gasKessel, heizoelKessel, pelletsKessel, heizhackschnitzel, bhkw, stromkessel, lwWp, geoThermie, fliessgewaesser };
  for (const [k, v] of Object.entries(paare)) if (v) an.add(k);
  return an;
}

/** Alle Hinweise: Importkorrekturen, Kernparameter, Gebäude. */
export function dqHinweise() {
  const werte = {};
  for (const p of PLAUSI_PARAMETER) {
    const el = document.getElementById(p.id);
    if (el) werte[p.id] = el.value;
  }
  const geb = Array.isArray(gebaeude) ? gebaeude : [];
  const param = pruefeParameter(werte, _aktiveErzeuger());
  // Ein Feld, das beim Laden korrigiert wurde und jetzt plausibel ist, nur einmal nennen
  return [..._korrekturen, ...param, ...pruefeGebaeude(geb)];
}

// ── Am Feld ────────────────────────────────────────────────────────────
function _feldMarkieren(hinweise) {
  const proFeld = new Map();
  hinweise.filter(h => h.stufe !== 'korrigiert' && !h.gebId).forEach(h => proFeld.set(h.id, h));
  for (const p of PLAUSI_PARAMETER) {
    let el = document.getElementById(p.id);
    if (!el) continue;
    // Versteckte Rechenfelder (JAZ): Markierung an der sichtbaren Anzeige
    if (el.type === 'hidden') el = document.getElementById(p.id + '-display') || null;
    if (!el) continue;
    const h = proFeld.get(p.id);
    const warn = h?.stufe === 'warnung';
    el.classList.toggle('dq-auffaellig', warn);
    let notiz = el.parentElement?.querySelector(`:scope > .dq-feldhinweis[data-dq="${p.id}"]`);
    if (warn) {
      if (!notiz) {
        notiz = document.createElement('div');
        notiz.className = 'dq-feldhinweis';
        notiz.dataset.dq = p.id;
        el.insertAdjacentElement('afterend', notiz);
      }
      notiz.textContent = `Bitte prüfen: ${h.text}`;
      el.setAttribute('aria-invalid', 'true');
    } else {
      notiz?.remove();
      el.removeAttribute('aria-invalid');
    }
  }
}

// ── Projektseite ───────────────────────────────────────────────────────
function _kartenAnlegen() {
  const stapel = document.querySelector('#center-projekt-view .ui-stapel');
  if (!stapel) return false;
  if (!document.getElementById('ui-projekt-dq')) {
    const s = document.createElement('section');
    s.className = 'ui-karte'; s.id = 'ui-projekt-dq-karte';
    s.innerHTML = '<header><h4>Datenqualität</h4><span class="dq-zaehler" id="ui-projekt-dq-zahl"></span></header><div id="ui-projekt-dq"></div>';
    stapel.appendChild(s);
  }
  if (!document.getElementById('ui-projekt-beispiel')) {
    const s = document.createElement('section');
    s.className = 'ui-karte'; s.id = 'ui-projekt-beispiel';
    s.innerHTML = `<header><h4>Beispielprojekt</h4></header><div class="ui-karte-in">
      <p class="ui-text-muted">Anonymisierte Liegenschaft mit Wärmenetz, Erzeugern, kleinem Stromnetz (Netzanschlusspunkt, Trafo) und Photovoltaik — zum Kennenlernen und Ausprobieren.</p>
      <div class="ui-knopfreihe"><button type="button" class="btn-secondary" data-click="dqBeispielprojektOeffnen()">${_ic('folder')}Beispielprojekt öffnen</button></div></div>`;
    stapel.appendChild(s);
  }
  return true;
}

const _STUFE_TEXT = { warnung: 'auffällig', fallback: 'Standardwert', korrigiert: 'beim Laden korrigiert' };

function _kartenRendern(hinweise) {
  if (!_kartenAnlegen()) return;
  const box = document.getElementById('ui-projekt-dq');
  const zahl = document.getElementById('ui-projekt-dq-zahl');
  const warn = hinweise.filter(h => h.stufe === 'warnung').length;
  if (zahl) {
    zahl.textContent = warn ? `${warn} auffällig` : hinweise.length ? 'Hinweise' : 'ohne Befund';
    zahl.dataset.stufe = warn ? 'warnung' : hinweise.length ? 'hinweis' : 'ok';
  }
  if (!hinweise.length) {
    box.innerHTML = `<div class="ui-ck" data-stufe="ok"><span class="ui-ck-ic">${_ic('check', 'ui-i ui-i-sm')}</span>
      <span class="ui-ck-t"><b>Keine auffälligen Werte</b><small>Wirkungsgrade, Arbeitszahlen, Emissionsfaktoren, Preise und spezifische Bedarfe liegen in plausiblen Bereichen.</small></span><span></span></div>`;
    return;
  }
  const rang = { warnung: 0, korrigiert: 1, fallback: 2 };
  const sortiert = [...hinweise].sort((a, b) => rang[a.stufe] - rang[b.stufe]);
  const max = 12;
  box.innerHTML = sortiert.slice(0, max).map((h, i) => {
    const stufe = h.stufe === 'warnung' ? 'veraltet' : h.stufe === 'korrigiert' ? 'offen' : '';
    const knopf = h.gebId != null
      ? `<button type="button" class="btn-secondary ui-ck-btn" data-dq-geb="${h.gebId}">Gebäude</button>`
      : h.stufe !== 'korrigiert' && h.id ? `<button type="button" class="btn-secondary ui-ck-btn" data-dq-feld="${_esc(h.id)}">Zum Feld</button>` : '<span></span>';
    return `<div class="ui-ck dq-ck" data-stufe="${stufe}" data-dq-i="${i}">
      <span class="ui-ck-ic">${_ic(h.stufe === 'fallback' ? 'info' : 'alert', 'ui-i ui-i-sm')}</span>
      <span class="ui-ck-t"><b>${_esc(h.label)} <em class="dq-stufe">${_STUFE_TEXT[h.stufe]}</em></b><small>${_esc(h.text)}${h.ort ? ` · ${_esc(h.ort)}` : ''}</small></span>${knopf}</div>`;
  }).join('') + (sortiert.length > max ? `<div class="ui-karte-in ui-text-muted">… und ${sortiert.length - max} weitere</div>` : '');
}

/** Prüft neu und aktualisiert Projektseite und Feldmarkierungen. */
export function dqAktualisieren() {
  clearTimeout(_timer);
  _letzte = dqHinweise();
  _feldMarkieren(_letzte);
  _kartenRendern(_letzte);
  return _letzte;
}

function _spaeter() { clearTimeout(_timer); _timer = setTimeout(dqAktualisieren, 250); }

/** Nach dem Projektimport (03c _loadProject): Korrekturen merken, prüfen, kurz melden. */
export function dqNachImport(korrekturen = []) {
  _korrekturen = Array.isArray(korrekturen) ? korrekturen.slice() : [];
  // Erzeuger-Anzeigen und JAZ werden teils erst nach dem Laden berechnet
  setTimeout(() => {
    const h = dqAktualisieren();
    const warn = h.filter(x => x.stufe === 'warnung').length;
    const korr = _korrekturen.length;
    if (warn || korr) {
      const teile = [];
      if (korr) teile.push(`${korr} Wert${korr === 1 ? '' : 'e'} beim Laden korrigiert`);
      if (warn) teile.push(`${warn} auffällig`);
      window.showHint?.(`Datenqualität: ${teile.join(', ')} — siehe Projektseite`, 7000);
    }
  }, 400);
}

/** Springt zum Eingabefeld: Fenster öffnen, Feld fokussieren. */
export function dqZumFeld(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const panel = el.closest('.float-panel');
  if (panel) {
    window.uiSchritt?.('planung');
    window.hidePanels?.();
    panel.classList.add('visible');
  }
  const ziel = el.type === 'hidden' ? document.getElementById(id + '-display') : el;
  setTimeout(() => { ziel?.scrollIntoView?.({ block: 'center' }); ziel?.focus?.(); }, 60);
}

function _zumGebaeude(id) {
  const g = (Array.isArray(gebaeude) ? gebaeude : []).find(x => Number(x.id) === Number(id));
  if (!g) return;
  window.uiSchritt?.('bestand');
  if (g.polygonLayer && window.map) window.map.fitBounds(g.polygonLayer.getBounds(), { maxZoom: 19 });
  window.selectFromMap?.(g.id);
}

/** Lädt das eingebaute Musterprojekt (data/demo_projekt.json). */
export async function dqBeispielprojektOeffnen(opt = {}) {
  const geb = Array.isArray(gebaeude) ? gebaeude : [];
  if (geb.length && !opt.ohneRueckfrage) {
    const text = 'Das Beispielprojekt ersetzt das geöffnete Projekt. Ungespeicherte Änderungen gehen verloren.';
    const ok = typeof window.epConfirm === 'function'
      ? await window.epConfirm('Beispielprojekt öffnen', text, { okText: 'Beispielprojekt öffnen' })
      : window.confirm(text);
    if (!ok) return false;
  }
  try {
    window._loadProject(JSON.parse(MUSTERPROJEKT_TEXT));
    const st = document.getElementById('project-file-status');
    if (st) st.textContent = 'Beispielprojekt (nicht gespeichert)';
    window.showHint?.('Beispielprojekt geladen — „Speichern unter …“ legt eine eigene Kopie an', 6000);
    window.uiProjektseiteRendern?.();
    return true;
  } catch (e) {
    console.error('Beispielprojekt konnte nicht geladen werden', e);
    window.showHint?.(`Beispielprojekt konnte nicht geladen werden: ${e.message}`, 8000);
    return false;
  }
}

/** Rohtext des Musterprojekts (für Tests und Diagnose). */
export function dqMusterprojektText() { return MUSTERPROJEKT_TEXT; }

export function dqInit() {
  const ids = new Set(PLAUSI_PARAMETER.map(p => p.id));
  const aufFeld = e => {
    const t = e.target;
    if (t && ids.has(t.id)) _spaeter();
  };
  document.addEventListener('input', aufFeld, true);
  document.addEventListener('change', aufFeld, true);
  document.addEventListener('click', e => {
    const f = e.target.closest?.('button[data-dq-feld]');
    if (f) { dqZumFeld(f.dataset.dqFeld); return; }
    const g = e.target.closest?.('button[data-dq-geb]');
    if (g) _zumGebaeude(g.dataset.dqGeb);
  });
  // Beim Öffnen der Projektseite frisch prüfen (Erzeuger können inzwischen dazugekommen sein)
  const v = document.getElementById('center-projekt-view');
  if (v) new MutationObserver(() => { if (!v.hidden) dqAktualisieren(); }).observe(v, { attributes: true, attributeFilter: ['hidden'] });
  dqAktualisieren();
}
