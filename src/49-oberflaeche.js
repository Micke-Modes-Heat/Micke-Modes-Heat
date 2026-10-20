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
import { activeVariantId, gebaeude, netzEdges, stromEdges, trassePoints, trasseSegments } from './01-globals-varianten.js';
import { isErzeugerAktiv, meritOrderKeys } from './06c-dispatch-core.js';
import { ASSETS } from './13a-assets-core.js';
import { gutStand } from './21-gutachten-editor.js';
import { bestandPruefen } from './lib/bestand-check.js';
import { SCHICHT } from './lib/schichten.js';

const _KEY = 'micke.ui';
const _ui = { schritt: 'projekt', sparte: 'waerme', waermeTab: 'netz', abschnitt: { auswertung: 'uebersicht', gutachten: 'ggrafik' } };
try { Object.assign(_ui, JSON.parse(localStorage.getItem(_KEY) || '{}')); } catch (e) { /* ohne Speicher weiter */ }
const _merken = () => { try { localStorage.setItem(_KEY, JSON.stringify(_ui)); } catch (e) { /* optional */ } };

const _esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const _ic = (id, cls = 'ui-i') => `<svg class="${cls}"><use href="#ui-i-${id}"/></svg>`;
// Emojis und Pfeil-Präfixe aus alten Beschriftungen entfernen
export const uiLabel = t => String(t || '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D}/gu, '')
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
  netzanschluss:       { schritt: 'auswertung', gruppe: 'Strom',        titel: 'Netzanschluss' },
  ergebnisblatt:       { schritt: 'auswertung', gruppe: 'Strom',        titel: 'Ergebnisblatt Elektro' },   // 53-fenster-seiten.js
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
    // Jede Funktion an genau einem Ort: Ergebnisblatt, Knotenanalyse und Variantenvergleich nur hier,
    // Maßnahmenbericht und Investitionsplan nur unter Gutachten. Planung › Strom › Prüfen verweist nur.
    { key: 'v:optimierung', gruppe: 'Wärme', titel: 'Optimierung der Erzeugung', los: () => _ansicht('optimierung') },
    { key: 'f:sankey', gruppe: 'Wärme', titel: 'Energieflüsse (Sankey)', los: () => window.showSankey?.(), fenster: true },
    { key: 'v:vergleich', gruppe: 'Übergreifend', titel: 'Variantenvergleich', los: () => _ansicht('vergleich'), tip: 'Varianten vergleichen: Kennzahlen und Planungsentscheidungen aller Varianten nebeneinander' },
    { key: 'v:gebaeude', gruppe: 'Übergreifend', titel: 'Gebäudeauswertung', los: () => _ansicht('gebaeude') },
  ],
  gutachten: [
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
  // Der PV-Modus ist der Reiter Planung › Strom › Photovoltaik — woanders hin = Modus aus
  if (window.pvModusAktiv && !(s.id === 'planung' && _ui.sparte === 'strom')) window.pvModusStop?.();
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
    if (_ui.sparte === 'strom') {
      window.setLeftTab?.('elektro');
      if (window.elTabAktiv?.() === 'pv') window.pvModusStart?.();
    }
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

/** Sprung an einen Eintrag der Seitennavigation, z. B. uiGeheZu('auswertung', 'kna') — für Verweise. */
export function uiGeheZu(schritt, key) {
  uiSchritt(schritt);
  if (key) _abschnittOeffnen(key);
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
    return `<button class="ui-step" type="button" data-ui-schritt="${s.id}" data-stufe="${z.stufe}" aria-current="${aktiv}"${z.detail ? ` title="${_esc(z.detail)}"` : ''}>
      <span class="ui-step-nr">${nr}</span><b>${s.titel}</b><small>${_esc(z.text)}</small></button>`;
  }).join('');
}

// Wärmeberechnung: systemState trägt keinen Stempel. Beim ersten Blick auf ein neues
// Ergebnis merken wir uns den Planungsstand; weicht er später ab → „veraltet“.
let _waermeStempel = { ss: null, sig: '' };
const _waermeSignatur = erzKeys => [activeVariantId ?? '-', erzKeys.join(','), gebaeude.length, trasseSegments.length, trassePoints.length].join('|');
const _seit = t => {
  const min = Math.round(Math.max(0, Date.now() - t) / 60000);
  return min < 1 ? 'gerade eben' : min < 60 ? `vor ${min} min` : `vor ${Math.round(min / 60)} h`;
};
const _STATIONEN = ['NAP', 'Trafo', 'NSHV', 'Schaltanlage'];

// Status je Schritt aus dem Datenstand (leer · offen · veraltet · ok). Bewusst einfach und schnell.
// text = kurz für die Prozessleiste, detail = ausführlich für Projektseite und Hinweis.
// Daten über die Modul-Bindings lesen: window.meritOrderKeys u. ä. sind für Nicht-globals-Module
// nach einem set…() veraltet, window.assets gibt es gar nicht (Anlagen liegen in ASSETS.items).
export function uiSchrittStatus() {
  const name = (window.getProjektName?.() || '').trim();
  const erzKeys = meritOrderKeys.filter(k => isErzeugerAktiv(k));
  const nErz = erzKeys.length, nStr = trasseSegments.length;
  // Strom: Netz erst ab Station oder Kabel — UV/Verbraucher legt das Tool je Gebäude selbst an.
  // PV zählt als Gebäude mit PV (Gebäudeangabe oder PV-Anlage).
  const strom = ASSETS.items.filter(a => a.domain === 'strom' || a.domain === 'hybrid');
  const nNap = strom.filter(a => a.type === 'NAP').length;
  const nStat = strom.filter(a => _STATIONEN.includes(a.type)).length;
  const nNetz = nStat + stromEdges.length;
  const pvGeb = new Set(gebaeude.filter(g => g.pvAktiv).map(g => String(g.id)));
  strom.forEach(a => { if (a.type === 'PV' && a.buildingId != null) pvGeb.add(String(a.buildingId)); });
  const nPv = pvGeb.size;

  // ── Planung ──
  const wKurz = nErz ? `${nErz} Erzeuger` : nStr ? 'Wärmenetz' : '';
  const sKurz = nNetz ? (nNap ? 'Stromnetz' : 'Stromnetz ohne NAP') : '';
  const pvKurz = nPv ? (nNetz ? 'PV' : 'PV ohne Stromnetz') : '';
  const wDet = nErz || nStr ? [nErz ? `${nErz} Erzeuger` : 'keine Erzeuger', nStr ? `Wärmenetz mit ${nStr} ${nStr === 1 ? 'Strang' : 'Strängen'}` : 'kein Wärmenetz'].join(', ') : 'offen';
  const sDet = nNetz || nPv ? [
    nNetz ? `${nStat} ${nStat === 1 ? 'Station' : 'Stationen'}, ${stromEdges.length} Kabel` : 'kein Stromnetz',
    nNetz ? (nNap ? `${nNap} NAP` : 'NAP fehlt') : '',
    nPv ? `PV auf ${nPv} ${nPv === 1 ? 'Gebäude' : 'Gebäuden'}` : '',
  ].filter(Boolean).join(', ') : 'offen';
  let planung;
  if (!wKurz && !sKurz && !pvKurz) planung = { stufe: gebaeude.length ? 'offen' : 'leer', text: 'noch nichts geplant' };
  else planung = {
    stufe: wKurz && sKurz && nNap ? 'ok' : 'offen',
    text: [wKurz || 'Wärme offen', sKurz || (pvKurz ? '' : 'Strom offen'), pvKurz].filter(Boolean).join(' · '),
  };
  planung.detail = planung.text === 'noch nichts geplant' ? planung.text : `Wärme: ${wDet} · Strom: ${sDet}`;

  // ── Auswertung: Wärme und Strom getrennt ──
  const ss = window.systemState;
  let wErg = 'offen';
  if (ss && (ss.gesamtMwhMitNV || ss.nutzwaermeMwh)) {
    const sig = _waermeSignatur(erzKeys);
    if (_waermeStempel.ss !== ss) _waermeStempel = { ss, sig };
    wErg = _waermeStempel.sig === sig ? 'gerechnet' : 'veraltet';
  }
  const el = window.elCalcStand?.() || null;   // null = in dieser Sitzung nicht gerechnet
  const sErg = !el ? 'offen' : el.frisch ? 'gerechnet' : 'veraltet';
  const erg = [wErg, sErg];
  const auswertung = {
    stufe: erg.includes('veraltet') ? 'veraltet' : erg.every(x => x === 'gerechnet') ? 'ok' : erg.includes('gerechnet') ? 'offen' : 'leer',
    text: wErg === 'offen' && sErg === 'offen' ? 'noch nicht gerechnet' : `Wärme ${wErg} · Strom ${sErg}`,
    waerme: wErg, strom: sErg,   // je Sparte für die Kennzahlen-Übersicht (51-kennzahlen.js)
  };
  auswertung.detail = [
    wErg === 'veraltet' ? 'Wärme: Planung seit der Berechnung geändert — neu berechnen' : `Wärme: ${wErg === 'gerechnet' ? 'Ergebnisse liegen vor' : 'noch nicht berechnet'}`,
    sErg === 'veraltet' ? `Strom: Netz oder Parameter seit der Berechnung (${_seit(el.t)}) geändert — neu berechnen`
      : sErg === 'gerechnet' ? `Strom: berechnet ${_seit(el.t)}` : 'Strom: Elektroberechnung in dieser Sitzung noch nicht gelaufen',
  ].join(' · ');

  const kap = gutStand();
  return {
    projekt: name ? { stufe: 'ok', text: 'Stammdaten erfasst' } : { stufe: 'offen', text: 'Name fehlt' },
    bestand: gebaeude.length ? { stufe: 'ok', text: `${gebaeude.length.toLocaleString('de-DE')} Gebäude` } : { stufe: 'leer', text: 'Gebäude laden' },
    planung,
    auswertung,
    gutachten: !kap ? { stufe: 'leer', text: 'Gliederung anlegen' }
      : { stufe: kap.leer ? 'offen' : 'ok', text: kap.leer ? `${kap.kapitel} Kapitel · ${kap.leer} ohne Inhalt` : `${kap.kapitel} Kapitel angelegt` },
  };
}

// ── Checkliste (Projektseite) ──────────────────────────────────────────
// Ersetzt Leitfaden (src/11, Wärmepfad) und Geführten Modus (src/24, Strompfad): dieselben
// Prüfungen als eine Liste je Sparte, jeder Punkt mit Sprung an die Stelle, wo er erledigt wird.
// stufe: ok · offen · veraltet (= Fehler oder überholt) · leer (optional, nicht begonnen).
// optional: zählt nicht für „Nächster Schritt“.
const _strom = (...wohin) => () => { uiSchritt('planung', { sparte: 'strom' }); window.elTab?.(wohin[0]); wohin[1]?.(); };
const _CK_LOS = {
  name: () => { const f = document.getElementById('pd-kaserne-name'); f?.focus(); f?.scrollIntoView({ block: 'center' }); },
  we: () => { const f = document.getElementById('pd-we-nummer'); f?.focus(); f?.scrollIntoView({ block: 'center' }); },
  gebaeude: () => uiSchritt('bestand'),
  namen: () => uiGebaeudetabelle(true),
  waermebedarf: () => uiGebaeudetabelle(true),
  waermenetz: () => { uiSchritt('planung', { sparte: 'waerme' }); uiWaermeTab('netz'); },
  erzeuger: () => { uiSchritt('planung', { sparte: 'waerme' }); uiWaermeTab('erzeuger'); },
  waermeErg: () => { uiSchritt('auswertung'); _abschnittOeffnen('waerme'); },
  stromlast: () => window.showAutofillWizard?.(),
  referenz: () => window.toggleStromPanel?.(),
  stromnetz: _strom('netz'),
  bestandpruefung: _strom('pruefen', () => window.bestandPanelToggle?.()),
  anschluss: () => window.sgNaOeffnen?.(),
  entscheidung: _strom('erzeugung'),
  pv: _strom('pv'),
  stromErg: _strom('berechnen'),
  gutachten: () => uiSchritt('gutachten'),
};

export function uiCheckliste() {
  const st = uiSchrittStatus();
  const geb = gebaeude, nGeb = geb.length;
  const assets = ASSETS.items;
  const strom = assets.filter(a => a.domain === 'strom' || a.domain === 'hybrid');
  const nStat = strom.filter(a => _STATIONEN.includes(a.type)).length;
  const nNap = strom.filter(a => a.type === 'NAP').length;
  const erzKeys = meritOrderKeys.filter(k => isErzeugerAktiv(k));
  const p = (id, stufe, titel, text, optional = false) => ({ id, stufe, titel, text, optional });
  const name = (window.getProjektName?.() || '').trim();
  const we = (document.getElementById('pd-we-nummer')?.value || '').trim();
  const ohneName = geb.filter(g => !String(g.name || '').trim()).length;

  const grundlagen = [
    p('name', name ? 'ok' : 'offen', 'Name der Liegenschaft', name || 'Trägt das Deckblatt des Gutachtens'),
    p('we', we ? 'ok' : 'offen', 'WE-Nummer', we || 'Fehlt noch'),
    p('gebaeude', nGeb ? 'ok' : 'offen', 'Plangebiet und Gebäude', nGeb ? `${nGeb.toLocaleString('de-DE')} Gebäude geladen` : 'Plangebiet zeichnen, Gebäude aus OSM laden'),
    p('namen', !nGeb ? 'leer' : ohneName ? 'offen' : 'ok', 'Gebäude benannt und geprüft',
      !nGeb ? 'Erst Gebäude laden' : ohneName ? `${ohneName} von ${nGeb} Gebäuden ohne Namen` : `Alle ${nGeb} Gebäude benannt`),
  ];

  // Wärme (Pfad des alten Leitfadens)
  const mitWaerme = geb.filter(g => parseFloat(g.waerme) > 0 || g.lastgangKw).length;
  const nNetz = netzEdges.length;
  const wErg = st.auswertung.waerme;
  const waerme = [
    p('waermebedarf', !nGeb ? 'leer' : mitWaerme ? 'ok' : 'offen', 'Wärmebedarf der Gebäude',
      !nGeb ? 'Erst Gebäude laden' : mitWaerme ? `${mitWaerme} von ${nGeb} Gebäuden mit Wärmebedarf` : 'Kein Gebäude mit Wärmebedarf'),
    p('waermenetz', nNetz ? 'ok' : 'offen', 'Wärmenetz', nNetz ? `${nNetz} Netzabschnitte` : 'Heizzentrale wählen, Netz erzeugen oder zeichnen'),
    p('erzeuger', erzKeys.length ? 'ok' : 'offen', 'Erzeuger und Speicher', erzKeys.length ? `${erzKeys.length} Erzeuger aktiv` : 'Grund- und Spitzenlast festlegen'),
    p('waermeErg', wErg === 'gerechnet' ? 'ok' : wErg === 'veraltet' ? 'veraltet' : 'offen', 'Wärme berechnet',
      wErg === 'gerechnet' ? 'Ergebnisse liegen vor' : wErg === 'veraltet' ? 'Planung seit der Berechnung geändert' : 'Rechnet, sobald Netz und Erzeuger da sind'),
  ];

  // Strom (Pfad des alten Geführten Modus)
  const mitLast = new Set(assets.filter(a => a.type === 'Verbraucher' && (Number(a.props?.leistungKW) > 0 || Number(a.leistungKW) > 0)).map(a => String(a.buildingId)));
  const nLast = geb.filter(g => mitLast.has(String(g.id))).length;
  const ref = Number(window.elQuartierH?.length) > 0;   // Float32Array — Array.isArray ist dafür blind
  const nNetzS = nStat + stromEdges.length;
  let best = null;
  if (nNetzS) { try { best = bestandPruefen({ assets, edges: stromEdges, gebaeude: geb, heute: new Date().getFullYear() }); } catch (e) { /* Prüfung optional */ } }
  const topo = best?.reifegrad?.find(s => s.id === 'topologie');
  const bezug = Number(window.elNapMaxBezugKw) > 0, einsp = Number(window.elNapMaxEinspKw) > 0;
  const nEnt = [...assets, ...stromEdges].filter(o => o?.schicht === SCHICHT.ENTSCHEIDUNG).length;
  const nPv = new Set([...geb.filter(g => g.pvAktiv).map(g => String(g.id)), ...strom.filter(a => a.type === 'PV').map(a => String(a.buildingId ?? a.id))]).size;
  const sErg = st.auswertung.strom;
  const anschlussFehlt = [!nNap && 'NAP', !bezug && 'max. Bezug', !einsp && 'Einspeiselimit'].filter(Boolean);
  const stromListe = [
    p('stromlast', !nGeb ? 'leer' : nLast === nGeb ? 'ok' : 'offen', 'Stromverbrauch der Gebäude',
      !nGeb ? 'Erst Gebäude laden' : nLast === nGeb ? `Alle ${nGeb} Gebäude mit Verbrauchswert` : `${nGeb - nLast} von ${nGeb} Gebäuden ohne Verbrauchswert — automatisch ermitteln`),
    p('referenz', ref ? 'ok' : 'offen', 'Gemessener Lastgang (Referenzjahr)', ref ? 'Referenzjahr gewählt' : 'Messjahr in den Strom-Grundlagen laden'),
    p('stromnetz', nNetzS ? 'ok' : 'offen', 'Bestandsnetz erfasst',
      nNetzS ? `${nStat} ${nStat === 1 ? 'Station' : 'Stationen'}, ${stromEdges.length} Kabel` : 'Bestandsplan digitalisieren oder Netz automatisch erzeugen'),
    p('bestandpruefung', !best ? 'leer' : best.zaehler.fehler ? 'veraltet' : topo && !topo.erfuellt ? 'offen' : 'ok', 'Bestand geprüft',
      !best ? 'Erst Netz erfassen' : best.zaehler.fehler ? `${best.zaehler.fehler} Fehler in der Bestandsprüfung`
        : topo && !topo.erfuellt ? `Netzstruktur: ${topo.fehlt || 'unvollständig'}` : `Keine Fehler · ${best.zaehler.warnung} Warnungen`),
    p('anschluss', anschlussFehlt.length ? 'offen' : 'ok', 'Netzanschluss und Grenzen',
      anschlussFehlt.length ? `Fehlt: ${anschlussFehlt.join(', ')}` : 'NAP, max. Bezug und Einspeiselimit hinterlegt'),
    p('entscheidung', nEnt ? 'ok' : 'offen', 'Geplante Maßnahmen der Variante',
      nEnt ? `${nEnt} geplante Objekte in der Variante` : 'Noch nichts in der Entscheidungsschicht'),
    p('pv', nPv ? 'ok' : 'leer', 'Photovoltaik', nPv ? `PV auf ${nPv} ${nPv === 1 ? 'Gebäude bzw. Fläche' : 'Gebäuden bzw. Flächen'}` : 'Dächer und Freiflächen belegen', true),
    p('stromErg', sErg === 'gerechnet' ? 'ok' : sErg === 'veraltet' ? 'veraltet' : 'offen', 'Netz berechnet',
      sErg === 'gerechnet' ? 'Elektroberechnung liegt vor' : sErg === 'veraltet' ? 'Netz oder Parameter seit der Berechnung geändert' : 'Elektroberechnung starten'),
  ];

  const g = st.gutachten;
  const gutachten = [p('gutachten', g.stufe, 'Gutachten', g.text)];
  return [
    { id: 'grundlagen', titel: 'Grundlagen', punkte: grundlagen },
    { id: 'waerme', titel: 'Wärme', punkte: waerme },
    { id: 'strom', titel: 'Strom', punkte: stromListe },
    { id: 'gutachten', titel: 'Gutachten', punkte: gutachten },
  ];
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
    const elAktiv = window.elTabAktiv?.() || 'netz';
    const reiter = sp === 'waerme'
      ? `<div class="ui-tabs" role="tablist">
          <button type="button" role="tab" data-ui-waerme="netz" aria-selected="${_ui.waermeTab !== 'erzeuger'}">Wärmenetz</button>
          <button type="button" role="tab" data-ui-waerme="erzeuger" aria-selected="${_ui.waermeTab === 'erzeuger'}">Erzeugung und Speicher</button></div>`
      : `<div class="ui-tabs" role="tablist">${(window.EL_TABS || []).map(t =>
          `<button type="button" role="tab" data-ui-strom="${t.id}" aria-selected="${t.id === elAktiv}">${t.titel}</button>`).join('')}</div>`;
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
  const name = (window.getProjektName?.() || '').trim();
  const geb = gebaeude;
  const liste = uiCheckliste();
  const alle = liste.flatMap(gr => gr.punkte.map(pk => ({ ...pk, gruppe: gr.titel })));
  const naechster = alle.find(pk => !pk.optional && pk.stufe !== 'ok' && pk.stufe !== 'leer');
  const zeile = pk => `<div class="ui-ck" data-stufe="${pk.stufe}">
      <span class="ui-ck-ic">${_ic(pk.stufe === 'ok' ? 'check' : pk.stufe === 'offen' || pk.stufe === 'veraltet' ? 'alert' : 'circle', 'ui-i ui-i-sm')}</span>
      <span class="ui-ck-t"><b>${_esc(pk.titel)}${pk.optional ? ' <em class="ui-ck-opt">optional</em>' : ''}</b><small>${_esc(pk.text)}</small></span>
      <button type="button" class="${pk.stufe === 'ok' ? 'ui-ck-link' : 'btn-secondary ui-ck-btn'}" data-ui-ck="${pk.id}">Öffnen</button></div>`;
  v.querySelector('#ui-projekt-kopf').innerHTML = `
    <div><span class="ui-eyebrow">Projekt</span><h1>${_esc(name || 'Unbenanntes Projekt')}</h1>
      <p>${geb.length ? `${geb.length.toLocaleString('de-DE')} Gebäude im Plangebiet` : 'Noch keine Gebäude geladen'}</p></div>`;
  v.querySelector('#ui-projekt-stand').innerHTML = `
    ${naechster ? `<div class="ui-next">${_ic('arrow')}<div><b>Nächster Schritt: ${_esc(naechster.titel)}</b><small>${_esc(naechster.gruppe)} · ${_esc(naechster.text)}</small></div>
      <button type="button" class="btn-confirm" data-ui-ck="${naechster.id}">Erledigen</button></div>`
      : `<div class="ui-next">${_ic('check')}<div><b>Alle Punkte erledigt</b><small>Gutachten prüfen und das Projekt speichern.</small></div></div>`}
    ${liste.map(gr => {
      const pflicht = gr.punkte.filter(pk => !pk.optional);
      const fertig = pflicht.filter(pk => pk.stufe === 'ok').length;
      return `<div class="ui-ck-grp"><span>${_esc(gr.titel)}</span><small>${fertig} von ${pflicht.length} erledigt</small></div>${gr.punkte.map(zeile).join('')}`;
    }).join('')}`;
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
      // Versteckt = nicht anbieten; ausgenommen das Projektmenü und die gerade nicht gewählten
      // Strom-Reiter (.el-pane) — die schaltet der Treffer unten selbst auf.
      const versteckt = el.closest('[hidden]');
      if (el.tagName === 'INPUT' || versteckt && !versteckt.matches('.el-pane') && !el.closest('#ui-proj-menu')) return;
      // Verweise auf den eigentlichen Ort und die wechselnden Knöpfe von „Nächster Schritt“ nicht
      // aufnehmen — die Funktion steht sonst doppelt in der Trefferliste.
      if (el.closest('.ui-verweis, #el-fuehrung')) return;
      const icon = el.querySelector('.asset-palette-btn-icon');
      // Aufgabenzeile: Titel (b) als Name, Kurzbeschreibung (small) nur als Suchtext
      const kopf = el.matches('.ui-aufgabe') ? el.querySelector('b') : null;
      const text = uiLabel(kopf ? kopf.textContent : icon ? el.textContent.replace(icon.textContent, '') : el.textContent);
      if (text.length < 3 || /^[\d\s.,%–-]+$/.test(text)) return;
      const k = q.ort + '|' + text;
      if (gesehen.has(k)) return; gesehen.add(k);
      liste.push({ text, ort: q.ort, tip: el.title || (kopf ? uiLabel(el.querySelector('small')?.textContent) : ''), los: () => {
        if (q.schritt) uiSchritt(q.schritt, { sparte: q.sparte });
        if (q.waermeTab) uiWaermeTab(q.waermeTab);
        const elReiter = el.closest('[data-el-tab]')?.dataset.elTab;
        if (elReiter) window.elTab?.(elReiter);
        setTimeout(() => el.click(), 60);
      } });
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

/** Kopf des Arbeitsbereichs neu zeichnen (z. B. wenn ein Fachmodul den Strom-Reiter wechselt). */
export function uiLpKopfAktualisieren() { _lpKopfRendern(); }

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
    if ((x = t.closest('button[data-ui-ck]'))) { _CK_LOS[x.dataset.uiCk]?.(); return; }
    if ((x = t.closest('button[data-ui-fokus]'))) { const f = document.getElementById(x.dataset.uiFokus); f?.focus(); f?.scrollIntoView({ block: 'center' }); return; }
    if ((x = t.closest('button[data-ui-sparte]'))) { uiSchritt('planung', { sparte: x.dataset.uiSparte }); return; }
    if ((x = t.closest('button[data-ui-waerme]'))) { uiWaermeTab(x.dataset.uiWaerme); return; }
    if ((x = t.closest('button[data-ui-strom]'))) { window.elTab?.(x.dataset.uiStrom); return; }
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
