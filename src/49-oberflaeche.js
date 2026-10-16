// ── 49-oberflaeche.js — Rahmen der Oberfläche (LKEBw) ──────────────────────
//
// Fünf Arbeitsschritte (Projekt · Bestand · Planung · Auswertung · Gutachten) in der
// Prozessleiste. Jeder Schritt schaltet über die vorhandenen Funktionen (setViewMode,
// setLeftTab, setAnalyseSection) auf die passende Ansicht — die Fachmodule bleiben
// unverändert. Dazu: Seitennavigation für Auswertung/Gutachten, Projektseite,
// Befehlssuche (Strg K) und Statuspunkte je Schritt.
//
// Präfix: ui… · Zustand im localStorage unter 'micke.ui'

import { LKEBW_LOGO_HELL } from './config/lkebw-logo.js';

const _KEY = 'micke.ui';
const _ui = { schritt: 'projekt', sparte: 'waerme', waermeTab: 'netz', abschnitt: { auswertung: 'uebersicht', gutachten: 'ggrafik' } };
try { Object.assign(_ui, JSON.parse(localStorage.getItem(_KEY) || '{}')); } catch (e) { /* ohne Speicher weiter */ }
const _merken = () => { try { localStorage.setItem(_KEY, JSON.stringify(_ui)); } catch (e) { /* optional */ } };

const _esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const _ic = (id, cls = 'ui-i') => `<svg class="${cls}"><use href="#ui-i-${id}"/></svg>`;
// Emojis und Pfeil-Präfixe aus alten Beschriftungen entfernen
export const uiLabel = t => String(t || '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
  .replace(/^[\s⬡↓↑⇄⊞⋯＋+✕↻↶⚙€·•▶◀▼]+/u, '')
  .replace(/&shy;|­/g, '')
  .replace(/\s+/g, ' ').trim();

// ── Schritte ───────────────────────────────────────────────────────────
export const UI_SCHRITTE = [
  { id: 'projekt',    titel: 'Projekt',    layout: 'seite' },
  { id: 'bestand',    titel: 'Bestand',    layout: 'karte' },
  { id: 'planung',    titel: 'Planung',    layout: 'karte' },
  { id: 'auswertung', titel: 'Auswertung', layout: 'nav' },
  { id: 'gutachten',  titel: 'Gutachten',  layout: 'nav' },
];

// Zuordnung der Analyse-Abschnitte (data-section der Reiter in #analyse-view-tabs)
const _ABSCHNITTE = {
  uebersicht:          { schritt: 'auswertung', gruppe: '',             titel: 'Übersicht' },
  waerme:              { schritt: 'auswertung', gruppe: 'Wärme',        titel: 'Lastgang und Dauerlinie' },
  strom:               { schritt: 'auswertung', gruppe: 'Strom',        titel: 'Strombilanz' },
  nap:                 { schritt: 'auswertung', gruppe: 'Strom',        titel: 'Netzanschluss-Lastgang' },
  kna:                 { schritt: 'auswertung', gruppe: 'Strom',        titel: 'Knotenpunkt-Analyse' },
  pva:                 { schritt: 'auswertung', gruppe: 'Strom',        titel: 'Photovoltaik' },
  wirtschaft:          { schritt: 'auswertung', gruppe: 'Übergreifend', titel: 'Wirtschaftlichkeit' },
  emissionen:          { schritt: 'auswertung', gruppe: 'Übergreifend', titel: 'Emissionen' },
  ausbauplaner:        { schritt: 'auswertung', gruppe: 'Übergreifend', titel: 'Maßnahmen und Fahrplan' },
  ggrafik:             { schritt: 'gutachten',  gruppe: '',             titel: 'Gutachten' },
  liegenschaftsbilder: { schritt: 'gutachten',  gruppe: '',             titel: 'Liegenschaftsbilder' },
};
// Einträge, die keine Analyse-Abschnitte sind (eigene Ansichten oder Fenster)
const _EXTRA = {
  auswertung: [
    // Kartenbezogene Auswertungen (Netzanalyse, Engpässe, Blackout …) bleiben in Planung › Strom,
    // weil sie die Karte einfärben; über die Befehlssuche sind sie von überall erreichbar.
    { key: 'v:optimierung', gruppe: 'Wärme', titel: 'Optimierung der Erzeugung', los: () => _ansicht('optimierung') },
    { key: 'f:sankey', gruppe: 'Wärme', titel: 'Energieflüsse (Sankey)', los: () => window.showSankey?.(), fenster: true },
    { key: 'v:vergleich', gruppe: 'Übergreifend', titel: 'Variantenvergleich', los: () => _ansicht('vergleich') },
    { key: 'v:gebaeude', gruppe: 'Übergreifend', titel: 'Gebäudeauswertung', los: () => _ansicht('gebaeude') },
  ],
  gutachten: [
    { key: 'f:ergebnisblatt', gruppe: 'Anlagen und Blätter', titel: 'Ergebnisblatt Elektro', los: () => window.ergebnisblattToggle?.(), fenster: true },
    { key: 'f:steckbriefe', gruppe: 'Anlagen und Blätter', titel: 'Investitionsplan', los: () => window.showInvestitionsplan?.(), fenster: true },
    { key: 'a:bericht', gruppe: 'Exporte', titel: 'Projektbericht erstellen', los: () => window.openProjectReportWizard?.(), aktion: true },
    { key: 'a:massnahmen', gruppe: 'Exporte', titel: 'Maßnahmenbericht (PDF)', los: () => window.exportMassnahmenPDF?.(), aktion: true },
    { key: 'a:digest', gruppe: 'Exporte', titel: 'Kennzahlen-Digest (Markdown)', los: () => window.exportGutachtenDigest?.(), aktion: true },
    { key: 'a:dispatch', gruppe: 'Exporte', titel: 'Einsatzplanung als CSV', los: () => window.exportDispatchCSV?.(), aktion: true },
    { key: 'a:gebcsv', gruppe: 'Exporte', titel: 'Gebäudeliste als CSV', los: () => window.exportGebaeudeCSV?.(), aktion: true },
  ],
};

function _ansicht(mode) {
  window.setViewMode?.(mode);
  _ui.abschnitt[_ui.schritt] = 'v:' + mode;
  _merken();
  _navRendern();
}

// ── Schritt wechseln ───────────────────────────────────────────────────
export function uiSchritt(id, opt = {}) {
  const s = UI_SCHRITTE.find(x => x.id === id) || UI_SCHRITTE[0];
  _ui.schritt = s.id;
  if (opt.sparte) _ui.sparte = opt.sparte;
  _merken();
  const body = document.body;
  UI_SCHRITTE.forEach(x => body.classList.toggle('ui-schritt-' + x.id, x.id === s.id));
  body.dataset.uiLayout = s.layout;
  body.dataset.uiAktSparte = _ui.sparte;
  document.getElementById('center-projekt-view')?.toggleAttribute('hidden', s.id !== 'projekt');

  if (s.id === 'projekt') {
    window.setViewMode?.('karte');
    uiProjektseiteRendern();
  } else if (s.id === 'bestand') {
    window.setViewMode?.(_ui.bestandAnsicht === 'tabelle' ? 'gebaeude' : 'karte');
    window.setLeftTab?.('gebiet');
  } else if (s.id === 'planung') {
    window.setViewMode?.('karte');
    if (_ui.sparte === 'strom') window.setLeftTab?.('elektro');
    else window.setLeftTab?.(_ui.waermeTab === 'erzeuger' ? 'erzeuger' : 'netz');
  } else {
    const ab = _ui.abschnitt[s.id] || (s.id === 'gutachten' ? 'ggrafik' : 'uebersicht');
    _abschnittOeffnen(ab, true);
  }
  _lpKopfRendern();
  _schritteRendern();
  _navRendern();
  setTimeout(() => window.map?.invalidateSize?.(), 120);
}

function _abschnittOeffnen(key, still) {
  if (key.startsWith('v:')) { _ansicht(key.slice(2)); return; }
  const eintrag = [..._EXTRA.auswertung, ..._EXTRA.gutachten].find(e => e.key === key);
  if (eintrag) {
    if (eintrag.fenster || eintrag.aktion) {
      if (!still) eintrag.los();
      if (still) { window.setViewMode?.('analyse'); window.setAnalyseSection?.(_ui.schritt === 'gutachten' ? 'ggrafik' : 'uebersicht'); }
      return;
    }
    eintrag.los(); return;
  }
  window.setViewMode?.('analyse');
  window.setAnalyseSection?.(key);
  _ui.abschnitt[_ui.schritt] = key;
  document.body.dataset.uiAktAbschnitt = key;
  _merken();
  _navRendern();
}

// ── Prozessleiste ──────────────────────────────────────────────────────
function _schritteRendern() {
  const box = document.getElementById('ui-steps');
  if (!box) return;
  const st = uiSchrittStatus();
  box.innerHTML = UI_SCHRITTE.map((s, i) => {
    const z = st[s.id] || { stufe: 'leer', text: '' };
    const aktiv = s.id === _ui.schritt;
    const nr = z.stufe === 'ok' && !aktiv ? _ic('check', 'ui-i ui-i-sm') : String(i + 1);
    return `<button class="ui-step" type="button" data-ui-schritt="${s.id}" data-stufe="${z.stufe}" aria-current="${aktiv}">
      <span class="ui-step-nr">${nr}</span><b>${s.titel}</b><small>${_esc(z.text)}</small></button>`;
  }).join('');
}

// Status je Schritt aus dem Datenstand (leer · offen · ok). Bewusst einfach und schnell.
export function uiSchrittStatus() {
  const geb = Array.isArray(window.gebaeude) ? window.gebaeude : [];
  const name = (window.getProjektName?.() || '').trim();
  const assets = Array.isArray(window.assets) ? window.assets.length : 0;
  const erz = typeof window.isErzeugerAktiv === 'function' && Array.isArray(window.meritOrderKeys)
    ? window.meritOrderKeys.filter(k => window.isErzeugerAktiv(k)).length : 0;
  const netzKm = (window.trasseSegments || []).length;
  const ss = window.systemState;
  const kap = window._gutStatus?.() || null;
  return {
    projekt: name ? { stufe: 'ok', text: 'Stammdaten erfasst' } : { stufe: 'offen', text: 'Name fehlt' },
    bestand: geb.length ? { stufe: 'ok', text: `${geb.length.toLocaleString('de-DE')} Gebäude` } : { stufe: 'leer', text: 'Gebäude laden' },
    planung: (erz || netzKm || assets) ? { stufe: 'ok', text: [erz ? `${erz} Erzeuger` : '', assets ? `${assets} Elektro-Objekte` : ''].filter(Boolean).join(' · ') || 'Netz angelegt' }
      : { stufe: geb.length ? 'offen' : 'leer', text: 'noch nichts geplant' },
    auswertung: ss && (ss.gesamtMwhMitNV || ss.nutzwaermeMwh) ? { stufe: 'ok', text: 'Ergebnisse liegen vor' } : { stufe: 'leer', text: 'noch nicht gerechnet' },
    gutachten: kap ? { stufe: kap.fertig ? 'ok' : 'offen', text: kap.text } : { stufe: 'leer', text: 'Gliederung anlegen' },
  };
}

// ── Kopf des linken Arbeitsbereichs ────────────────────────────────────
function _lpKopfRendern() {
  const kopf = document.getElementById('ui-lp-kopf');
  if (!kopf) return;
  if (_ui.schritt === 'bestand') {
    const tab = _ui.bestandAnsicht === 'tabelle';
    kopf.innerHTML = `<div class="ui-lp-titel"><h2>Bestand</h2>
      <div class="ui-seg" role="group" aria-label="Ansicht">
        <button type="button" data-ui-bestand="karte" aria-pressed="${!tab}">Karte</button>
        <button type="button" data-ui-bestand="tabelle" aria-pressed="${tab}">Tabelle</button></div></div>`;
  } else if (_ui.schritt === 'planung') {
    const sp = _ui.sparte;
    const reiter = sp === 'waerme'
      ? `<div class="ui-tabs" role="tablist">
          <button type="button" role="tab" data-ui-waerme="netz" aria-selected="${_ui.waermeTab !== 'erzeuger'}">Wärmenetz</button>
          <button type="button" role="tab" data-ui-waerme="erzeuger" aria-selected="${_ui.waermeTab === 'erzeuger'}">Erzeugung und Speicher</button></div>`
      : '';
    kopf.innerHTML = `<div class="ui-lp-titel"><h2>Planung</h2>
      <div class="ui-seg" role="group" aria-label="Sparte">
        <button type="button" data-ui-sparte="waerme" aria-pressed="${sp === 'waerme'}">Wärme</button>
        <button type="button" data-ui-sparte="strom" aria-pressed="${sp === 'strom'}">Strom</button></div></div>${reiter}`;
  } else kopf.innerHTML = '';
}

// ── Seitennavigation (Auswertung, Gutachten) ───────────────────────────
function _navEintraege(schritt) {
  const out = [];
  document.querySelectorAll('#analyse-view-tabs .analyse-section-tab').forEach(btn => {
    const key = btn.dataset.section;
    const def = _ABSCHNITTE[key] || { schritt: 'auswertung', gruppe: 'Weitere', titel: uiLabel(btn.textContent) };
    if (def.schritt !== schritt) return;
    out.push({ key, gruppe: def.gruppe, titel: def.titel, tip: btn.title || '' });
  });
  (_EXTRA[schritt] || []).forEach(e => out.push(e));
  const reihenfolge = schritt === 'gutachten' ? ['', 'Anlagen und Blätter', 'Exporte'] : ['', 'Wärme', 'Strom', 'Übergreifend', 'Weitere'];
  out.sort((a, b) => reihenfolge.indexOf(a.gruppe) - reihenfolge.indexOf(b.gruppe));
  return out;
}

function _navRendern() {
  const nav = document.getElementById('ui-seitennav');
  if (!nav) return;
  if (!['auswertung', 'gutachten'].includes(_ui.schritt)) { nav.innerHTML = ''; return; }
  const aktiv = _ui.abschnitt[_ui.schritt];
  let gruppe = null, h = `<div class="ui-nav-titel">${_ui.schritt === 'gutachten' ? 'Gutachten' : 'Auswertung'}</div>`;
  for (const e of _navEintraege(_ui.schritt)) {
    if (e.gruppe !== gruppe) { gruppe = e.gruppe; if (gruppe) h += `<div class="ui-nav-grp">${_esc(gruppe)}</div>`; }
    const zusatz = e.fenster ? _ic('chev', 'ui-i ui-i-sm ui-nav-fenster') : e.aktion ? _ic('export', 'ui-i ui-i-sm ui-nav-fenster') : '';
    h += `<button type="button" class="ui-nav-it" data-ui-abschnitt="${e.key}" aria-current="${e.key === aktiv}" title="${_esc(e.tip || (e.fenster ? 'Öffnet ein Fenster' : e.aktion ? 'Erzeugt eine Datei' : ''))}"><span>${_esc(e.titel)}</span>${zusatz}</button>`;
  }
  nav.innerHTML = h;
  const titel = document.getElementById('ui-seitentitel');
  if (titel) {
    const e = _navEintraege(_ui.schritt).find(x => x.key === aktiv);
    titel.innerHTML = `<span class="ui-eyebrow">${_ui.schritt === 'gutachten' ? 'Gutachten' : 'Auswertung'}${e?.gruppe ? ' · ' + _esc(e.gruppe) : ''}</span><h1>${_esc(e?.titel || '')}</h1>`;
  }
}

// ── Projektseite ───────────────────────────────────────────────────────
export function uiProjektseiteRendern() {
  const v = document.getElementById('center-projekt-view');
  if (!v) return;
  const st = uiSchrittStatus();
  const name = (window.getProjektName?.() || '').trim();
  const geb = Array.isArray(window.gebaeude) ? window.gebaeude : [];
  const naechster = UI_SCHRITTE.find(s => st[s.id]?.stufe !== 'ok');
  const zeile = (stufe, titel, text, sprung) => `<div class="ui-ck" data-stufe="${stufe}">
      <span class="ui-ck-ic">${_ic(stufe === 'ok' ? 'check' : stufe === 'offen' ? 'alert' : 'circle', 'ui-i ui-i-sm')}</span>
      <span class="ui-ck-t"><b>${_esc(titel)}</b><small>${_esc(text)}</small></span>
      ${sprung ? `<button type="button" class="btn-secondary ui-ck-btn" data-ui-sprung="${sprung}">Öffnen</button>` : '<span></span>'}</div>`;
  v.querySelector('#ui-projekt-kopf').innerHTML = `
    <div><span class="ui-eyebrow">Projekt</span><h1>${_esc(name || 'Unbenanntes Projekt')}</h1>
      <p>${geb.length ? `${geb.length.toLocaleString('de-DE')} Gebäude im Plangebiet` : 'Noch keine Gebäude geladen'}</p></div>`;
  v.querySelector('#ui-projekt-stand').innerHTML = `
    ${naechster ? `<div class="ui-next">${_ic('arrow')}<div><b>Nächster Schritt: ${_esc(naechster.titel)}</b><small>${_esc(st[naechster.id].text)}</small></div>
      ${naechster.id === 'projekt'
        ? '<button type="button" class="btn-confirm" data-ui-fokus="pd-kaserne-name">Namen eintragen</button>'
        : `<button type="button" class="btn-confirm" data-ui-sprung="${naechster.id}">Weiter zu ${_esc(naechster.titel)}</button>`}</div>` : ''}
    ${UI_SCHRITTE.map(s => zeile(st[s.id].stufe, s.titel, st[s.id].text, s.id === 'projekt' ? null : s.id)).join('')}`;
}

// ── Befehlssuche (Strg K) ──────────────────────────────────────────────
// Liest die Knöpfe der Arbeitsbereiche ein; neue Funktionen sind damit automatisch auffindbar.
const _QUELLEN = [
  { sel: '#lp-gebiet', schritt: 'bestand', ort: 'Bestand' },
  { sel: '#lp-netz', schritt: 'planung', sparte: 'waerme', waermeTab: 'netz', ort: 'Planung · Wärmenetz' },
  { sel: '#lp-erzeuger', schritt: 'planung', sparte: 'waerme', waermeTab: 'erzeuger', ort: 'Planung · Erzeugung' },
  { sel: '#lp-elektro', schritt: 'planung', sparte: 'strom', ort: 'Planung · Strom' },
  { sel: '#ui-proj-menu', ort: 'Projektdatei' },
  { sel: '#mehr-menu', ort: 'Hilfe und Einstellungen' },
  { sel: '#ebenen-panel', schritt: null, ort: 'Kartenebenen' },
];
let _palTreffer = [], _palSel = 0;

function _palIndex() {
  if (!document.querySelector('#lp-elektro button')) { try { window.buildElektroPanel?.(); } catch (e) { /* Panel baut sich beim ersten Öffnen */ } }
  const liste = [], gesehen = new Set();
  for (const q of _QUELLEN) {
    document.querySelectorAll(`${q.sel} button, ${q.sel} [data-click]`).forEach(el => {
      if (el.tagName === 'INPUT' || el.closest('[hidden]:not(#ui-proj-menu)') && !el.closest('#ui-proj-menu')) return;
      const icon = el.querySelector('.asset-palette-btn-icon');
      const text = uiLabel(icon ? el.textContent.replace(icon.textContent, '') : el.textContent);
      if (text.length < 3 || /^[\d\s.,%–-]+$/.test(text)) return;
      const k = q.ort + '|' + text;
      if (gesehen.has(k)) return; gesehen.add(k);
      liste.push({ text, ort: q.ort, tip: el.title || '', los: () => { if (q.schritt) uiSchritt(q.schritt, { sparte: q.sparte }); if (q.waermeTab) uiWaermeTab(q.waermeTab); setTimeout(() => el.click(), 60); } });
    });
  }
  for (const s of ['auswertung', 'gutachten']) {
    for (const e of _navEintraege(s)) {
      liste.push({ text: e.titel, ort: s === 'auswertung' ? 'Auswertung' : 'Gutachten', tip: e.tip || '', los: () => { uiSchritt(s); _abschnittOeffnen(e.key); } });
    }
  }
  UI_SCHRITTE.forEach(s => liste.push({ text: `${s.titel} öffnen`, ort: 'Arbeitsschritt', los: () => uiSchritt(s.id) }));
  return liste;
}
let _palListe = [];

export function uiBefehlssucheOeffnen() {
  const ov = document.getElementById('ui-pal');
  if (!ov) return;
  _palListe = _palIndex();
  ov.hidden = false;
  const inp = document.getElementById('ui-pal-input');
  inp.value = ''; _palSel = 0; _palRendern();
  setTimeout(() => inp.focus(), 0);
}
export function uiBefehlssucheSchliessen() { const ov = document.getElementById('ui-pal'); if (ov) ov.hidden = true; }

function _palRendern() {
  const q = (document.getElementById('ui-pal-input')?.value || '').trim().toLowerCase();
  const woerter = q.split(/\s+/).filter(Boolean);
  // Rangfolge: Name beginnt mit der Eingabe > Name enthält sie > nur Ort oder Beschreibung
  const rang = e => { const t = e.text.toLowerCase(); return t.startsWith(q) ? 0 : woerter.every(w => t.includes(w)) ? 1 : 2; };
  _palTreffer = _palListe
    .filter(e => { const h = (e.text + ' ' + e.ort + ' ' + e.tip).toLowerCase(); return woerter.every(w => h.includes(w)); })
    .map((e, i) => ({ e, r: q ? rang(e) : 0, i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.e).slice(0, 60);
  _palSel = Math.min(_palSel, Math.max(_palTreffer.length - 1, 0));
  const box = document.getElementById('ui-pal-liste');
  if (!box) return;
  if (!_palTreffer.length) { box.innerHTML = '<div class="ui-pal-leer">Keine Funktion gefunden. Anders formulieren, z. B. „Kabel“, „Excel“ oder „Netzanschluss“.</div>'; return; }
  let ort = null, h = '';
  _palTreffer.forEach((e, i) => {
    if (!q && e.ort !== ort) { ort = e.ort; h += `<div class="ui-pal-grp">${_esc(ort)}</div>`; }
    h += `<button type="button" class="ui-pal-it${i === _palSel ? ' act' : ''}" data-ui-pal="${i}" title="${_esc(e.tip)}">${_ic('arrow', 'ui-i ui-i-sm')}<span>${_esc(e.text)}</span>${q ? `<small class="ui-pal-ort">${_esc(e.ort)}</small>` : ''}</button>`;
  });
  box.innerHTML = h;
  box.querySelector('.act')?.scrollIntoView({ block: 'nearest' });
}
function _palAusfuehren(i) { const e = _palTreffer[i]; if (!e) return; uiBefehlssucheSchliessen(); e.los(); }

// ── Menüs ──────────────────────────────────────────────────────────────
export function uiMenuUmschalten(id) {
  const m = document.getElementById(id);
  if (!m) return;
  const auf = m.hidden;
  document.querySelectorAll('.ui-menu[id]').forEach(x => { if (x.id !== 'mehr-menu') x.hidden = true; });
  m.hidden = !auf;
}

/** Bestand: zwischen Karte und Gebäudetabelle wechseln (Tabelle lässt die Arbeitsliste stehen). */
export function uiGebaeudetabelle(an = true) {
  _ui.bestandAnsicht = an ? 'tabelle' : 'karte';
  _merken();
  if (_ui.schritt !== 'bestand') { uiSchritt('bestand'); return; }
  window.setViewMode?.(an ? 'gebaeude' : 'karte');
  _lpKopfRendern();
}

export function uiWaermeTab(tab) {
  _ui.waermeTab = tab === 'erzeuger' ? 'erzeuger' : 'netz';
  _merken();
  window.setLeftTab?.(_ui.waermeTab);
  _lpKopfRendern();
}

// ── Aufbau ─────────────────────────────────────────────────────────────
function _aufbau() {
  const main = document.querySelector('.main');
  const lp = document.getElementById('left-panel');
  if (!main || !lp) return false;

  // Kopf im linken Arbeitsbereich (ersetzt Titelzeile und Reiter)
  if (!document.getElementById('ui-lp-kopf')) {
    const kopf = document.createElement('div');
    kopf.id = 'ui-lp-kopf'; kopf.className = 'ui-lp-kopf';
    lp.insertBefore(kopf, lp.querySelector('.lp-body'));
  }
  // Seitennavigation
  if (!document.getElementById('ui-seitennav')) {
    const nav = document.createElement('aside');
    nav.id = 'ui-seitennav'; nav.className = 'ui-seitennav'; nav.setAttribute('aria-label', 'Bereiche');
    main.insertBefore(nav, main.firstChild);
  }
  // Projektseite
  if (!document.getElementById('center-projekt-view')) {
    const v = document.createElement('section');
    v.id = 'center-projekt-view'; v.className = 'ui-projektseite'; v.hidden = true;
    v.innerHTML = `<div class="ui-seite-in">
      <header class="ui-seite-kopf" id="ui-projekt-kopf"></header>
      <div class="ui-projekt-raster">
        <section class="ui-karte"><header><h4>Projektstand</h4></header><div id="ui-projekt-stand"></div></section>
        <div class="ui-stapel">
          <section class="ui-karte"><header><h4>Stammdaten</h4></header><div class="ui-karte-in" id="ui-projekt-stammdaten"></div></section>
          <section class="ui-karte"><header><h4>Projektweite Annahmen</h4></header><div class="ui-karte-in" id="ui-projekt-annahmen"></div></section>
        </div>
      </div></div>`;
    main.appendChild(v);
    // Stammdaten-Felder aus dem alten Gebiet-Reiter übernehmen (gleiche IDs, gleiche Handler)
    const ziel = v.querySelector('#ui-projekt-stammdaten');
    const felder = document.getElementById('ui-stammdaten-vorlage');
    if (felder) ziel.appendChild(felder);
    const ann = v.querySelector('#ui-projekt-annahmen');
    ann.innerHTML = `<p class="ui-text-muted">Emissionsfaktoren, Preise und Kostenansätze gelten für alle Varianten.</p>
      <div class="ui-knopfreihe"><button type="button" class="btn-secondary" data-click="toggleKennwertePanel()">Kennwerte bearbeiten</button>
      <button type="button" class="btn-secondary" data-click="toggleGrundlagenPanel()">Wärme-Grundlagen</button>
      <button type="button" class="btn-secondary" data-click="toggleStromPanel()">Strom-Grundlagen</button></div>`;
  }
  // Seitentitel über der Analyse-Ansicht (ersetzt die alte Überschrift „Systemanalyse“)
  const av = document.getElementById('center-analyse-view');
  if (av && !document.getElementById('ui-seitentitel')) {
    const t = document.createElement('header');
    t.id = 'ui-seitentitel'; t.className = 'ui-seitentitel';
    av.insertBefore(t, av.firstChild);
    [...av.querySelectorAll(':scope > div')].find(d => /Systemanalyse/.test(d.textContent) && d.querySelector('button'))?.style.setProperty('display', 'none', 'important');
  }
  // Kartenwerkzeuge (Adresssuche, Ebenen) in die Karte holen
  const tools = document.getElementById('ui-map-tools');
  const mapEl = document.getElementById('map');
  if (tools && mapEl && tools.parentElement !== mapEl) {
    mapEl.appendChild(tools);
    if (window.L?.DomEvent) { L.DomEvent.disableClickPropagation(tools); L.DomEvent.disableScrollPropagation(tools); }
  }
  // Befehlssuche
  if (!document.getElementById('ui-pal')) {
    const ov = document.createElement('div');
    ov.id = 'ui-pal'; ov.className = 'ui-pal-overlay'; ov.hidden = true;
    ov.innerHTML = `<div class="ui-pal" role="dialog" aria-label="Funktion suchen">
      <div class="ui-pal-in">${_ic('search')}<input id="ui-pal-input" type="text" autocomplete="off" placeholder="Was möchtest du tun? z. B. Kabel zeichnen, Excel, Netzanschluss"><kbd>Esc</kbd></div>
      <div class="ui-pal-liste" id="ui-pal-liste"></div>
      <div class="ui-pal-fuss"><span>↑ ↓ auswählen</span><span>Enter öffnen</span><span>Durchsucht alle Arbeitsbereiche</span></div></div>`;
    document.body.appendChild(ov);
  }
  return true;
}

function _ereignisse() {
  document.addEventListener('click', e => {
    const t = e.target;
    let x;
    if ((x = t.closest('button[data-ui-schritt]'))) { uiSchritt(x.dataset.uiSchritt); return; }
    if ((x = t.closest('button[data-ui-sprung]'))) { uiSchritt(x.dataset.uiSprung); return; }
    if ((x = t.closest('button[data-ui-fokus]'))) { const f = document.getElementById(x.dataset.uiFokus); f?.focus(); f?.scrollIntoView({ block: 'center' }); return; }
    if ((x = t.closest('button[data-ui-sparte]'))) { uiSchritt('planung', { sparte: x.dataset.uiSparte }); return; }
    if ((x = t.closest('button[data-ui-waerme]'))) { uiWaermeTab(x.dataset.uiWaerme); return; }
    if ((x = t.closest('button[data-ui-bestand]'))) { uiGebaeudetabelle(x.dataset.uiBestand === 'tabelle'); return; }
    if ((x = t.closest('button[data-ui-abschnitt]'))) { _abschnittOeffnen(x.dataset.uiAbschnitt); return; }
    if ((x = t.closest('button[data-ui-pal]'))) { _palAusfuehren(+x.dataset.uiPal); return; }
    if (t.id === 'ui-pal') { uiBefehlssucheSchliessen(); return; }
    // Menüs schließen bei Klick daneben
    if (!t.closest('.ui-proj-wrap')) document.querySelectorAll('.ui-menu[id]:not(#mehr-menu)').forEach(m => { m.hidden = true; });
    // Menüeintrag gewählt → Menü zu
    if (t.closest('#ui-proj-menu button')) document.getElementById('ui-proj-menu').hidden = true;
    if (t.closest('#mehr-menu button')) document.getElementById('mehr-menu').style.display = 'none';
  });
  document.getElementById('ui-pal-input')?.addEventListener('input', () => { _palSel = 0; _palRendern(); });
  document.addEventListener('keydown', e => {
    const strg = e.ctrlKey || e.metaKey;
    if (strg && e.key.toLowerCase() === 'k') { e.preventDefault(); const ov = document.getElementById('ui-pal'); ov && !ov.hidden ? uiBefehlssucheSchliessen() : uiBefehlssucheOeffnen(); return; }
    if (strg && e.key.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); window.saveProject?.(); return; }
    if (strg && e.key.toLowerCase() === 'o') { e.preventDefault(); window.openProjectFile?.(); return; }
    const ov = document.getElementById('ui-pal');
    if (!ov || ov.hidden) return;
    if (e.key === 'Escape') uiBefehlssucheSchliessen();
    else if (e.key === 'ArrowDown') { e.preventDefault(); _palSel = Math.min(_palSel + 1, _palTreffer.length - 1); _palRendern(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _palSel = Math.max(_palSel - 1, 0); _palRendern(); }
    else if (e.key === 'Enter') { e.preventDefault(); _palAusfuehren(_palSel); }
  });
  // Neue Analyse-Reiter (werden von Modulen nachträglich eingehängt) → Navigation nachziehen
  const tabs = document.getElementById('analyse-view-tabs');
  if (tabs) new MutationObserver(() => _navRendern()).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  // Aktiven Abschnitt mitführen, wenn ein Modul selbst umschaltet (z. B. Sprung in die PV-Analyse)
  const orig = window.setAnalyseSection;
  if (typeof orig === 'function' && !orig._ui) {
    const huelle = function (section) {
      const r = orig.apply(this, arguments);
      const def = _ABSCHNITTE[section];
      if (def && def.schritt !== _ui.schritt && document.body.dataset.uiLayout === 'nav') { _ui.schritt = def.schritt; _schritteRendern(); }
      if (def) { _ui.abschnitt[def.schritt] = section; _merken(); }
      document.body.dataset.uiAktAbschnitt = section;
      _navRendern();
      return r;
    };
    huelle._ui = true;
    window.setAnalyseSection = huelle;
  }
  // Status regelmäßig auffrischen (billig: zählt nur)
  setInterval(() => { _schritteRendern(); if (_ui.schritt === 'projekt') uiProjektseiteRendern(); }, 3000);
}

/** Umschalter hell/dunkel in der Kopfzeile: Symbol und Hinweis passend zum aktuellen Thema. */
function _themaKnopf() {
  const btn = document.getElementById('ui-thema-btn');
  if (!btn) return;
  const dunkel = document.documentElement.dataset.theme === 'dark';
  btn.innerHTML = _ic(dunkel ? 'sun' : 'moon');
  btn.title = dunkel ? 'Helle Darstellung einschalten' : 'Dunkle Darstellung einschalten';
  btn.setAttribute('aria-pressed', String(dunkel));
}

export function uiInit() {
  if (!_aufbau()) return;
  // LKEBw-Wortmarke: Programmrahmen ist in beiden Darstellungen dunkel → Fassung mit weißer Schrift
  const logo = document.getElementById('ui-logo');
  if (logo) logo.src = LKEBW_LOGO_HELL;
  _themaKnopf();
  new MutationObserver(_themaKnopf).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  _ereignisse();
  document.body.classList.add('ui-lkebw');
  uiSchritt(_ui.schritt || 'projekt');
}
