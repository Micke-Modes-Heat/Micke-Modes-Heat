// @ts-check
// ── 54-checkliste-fenster.js — Elektro-Checkliste als Begleitfenster (2. Bildschirm) ──
//
// Ein eigenes Browserfenster (window.open), das man auf den zweiten Bildschirm legt. Es folgt
// der Stelle, an der im Tool gearbeitet wird: Arbeitsschritt, Strom-Reiter, Auswertungsseite,
// offenes Fenster, ausgewähltes Asset (Marken siehe lib/elektro-checkliste.js). Oben stehen
// die Aufgaben dieser Stelle mit Status und Notiz, darunter alle Phasen.
//
// Das Fenster hat kein eigenes Skript: dieses Modul schreibt sein DOM und hört auf seine
// Ereignisse (gleicher Ursprung, about:blank). Lädt das Tool neu, ist die Verbindung weg — der
// Menüpunkt holt dasselbe Fenster (gleicher Name) wieder und zeichnet es neu.
//
// Gespeichert wird im Projekt (elektroCheckliste, 03c über window.ecCaptureState/ecRestoreState),
// also je Liegenschaft und mit der Autosicherung.

import { EC_PHASEN, EC_STATUS, EC_ADRESSATEN, EC_PUNKTE, ecPassend, ecOrtMarken, ecNormalisieren, ecStatus, ecZaehle, ecNaechste, ecKapitelHinweise,
  ecAdressat, ecRueckfragen, ecRueckfragenText, ecRueckfragenCsv, ecUebersicht } from './lib/elektro-checkliste.js';
import { gebaeude, stromEdges, varianten, gutachtenVariante, variantenName } from './01-globals-varianten.js';
import { ASSETS } from './13a-assets-core.js';
import { ssStationsGebaeude } from './lib/stations-steckbrief.js';

const FENSTER_NAME = 'mmh-elektro-checkliste';
const LAGE_KEY = 'micke.ec.lage';
const FOLGEN_KEY = 'micke.ec.folgen';
const TAKT_MS = 700;

/** @type {{ v: number, punkte: Record<string, { s: string, n: string, t?: number }> }} */
let _stand = ecNormalisieren(null);
/** @type {Window|null} */
let _win = null;
let _takt = 0;
let _taktZaehler = 0;
let _ortSchluessel = '';
let _marken = /** @type {string[]} */ ([]);
let _folgen = (() => { try { return localStorage.getItem(FOLGEN_KEY) !== '0'; } catch (e) { return true; } })();
let _nurOffen = false;
let _ortTextAktuell = '';
let _spaeter = false;     // Neuzeichnen aufgeschoben, weil gerade eine Notiz getippt wird
/** @type {string|null} */
let _angeheftet = null;   // per „Bearbeiten“ nach oben geholte Aufgabe
let _rueckfragenAuf = false;   // Ansicht „Rückfragen“ statt „Hier gerade“
const _offenePhasen = new Set();
const _notizTimer = /** @type {Record<string, any>} */ ({});

// Fenster, deren Aufgaben die Liste kennt — nur diese werden je Takt abgefragt.
const _PANEL_IDS = [...new Set(EC_PHASEN.flatMap(ph => ph.punkte.flatMap(p => (p.orte || []).filter(o => o.startsWith('p:')).map(o => o.slice(2)))))];

const _esc = (/** @type {any} */ s) => String(s ?? '').replace(/[&<>"']/g, c => /** @type {any} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── Projekt ────────────────────────────────────────────────────────────
export function ecCaptureState() { return ecNormalisieren(_stand); }

export function ecRestoreState(/** @type {any} */ daten) {
  _stand = ecNormalisieren(daten);
  _zeichnen(true);
}

function _setze(/** @type {string} */ id, /** @type {{ s?: string, n?: string, a?: string }} */ teil) {
  const alt = _stand.punkte[id] || { s: 'offen', n: '' };
  const neu = { ...alt, ...teil, t: Date.now() };
  if (neu.s === 'offen' && !neu.n) delete _stand.punkte[id];
  else _stand.punkte[id] = neu;
  // Projektseite zeigt den Stand der Liste (49) — nachziehen, wenn sie gerade zu sehen ist
  if (document.body.classList.contains('ui-schritt-projekt')) { try { /** @type {any} */ (window).uiProjektseiteRendern?.(); } catch (e) { /* Seite baut sich beim nächsten Besuch */ } }
}

// ── Für die Projektseite (49) ──────────────────────────────────────────
/** Kurzstand der Liste samt Stand aus dem Tool (Fortschritt je Phase, Rückfragen, nächste Aufgabe). */
export function ecProjektStand() { return ecUebersicht(_stand, _toolStand()); }

/** Sprung an die Stelle einer Aufgabe im Tool (Knopf „Erledigen“ der Projektseite). */
export function ecImToolOeffnen(/** @type {string} */ id) { _imToolOeffnen(id); }

/** Liste öffnen, Phase aufklappen und ihre erste offene Aufgabe oben zeigen (Projektseite › Phase). */
export function ecPhaseZeigen(/** @type {string} */ phaseId) {
  const ph = EC_PHASEN.find(x => x.id === phaseId);
  if (!ph) return;
  _offenePhasen.add(ph.id);
  _rueckfragenAuf = false;
  _angeheftet = (ph.punkte.find(p => !['erledigt', 'entfaellt'].includes(ecStatus(_stand, p.id))) || ph.punkte[0]).id;
  ecFensterOeffnen();
  _zeichnen(true);
}

/** Liste öffnen und gleich die Rückfragen zeigen. */
export function ecRueckfragenZeigen() {
  _rueckfragenAuf = true;
  ecFensterOeffnen();
  _zeichnen(false);
}

// ── Stand aus dem Tool ─────────────────────────────────────────────────
// Was das Tool selbst über eine Aufgabe weiß, als Hinweis neben dem Status. Der Status bleibt
// Sache des Nutzers — nichts wird automatisch abgehakt. stufe: ok · offen · veraltet · leer.
// Quelle ist zuerst die Projekt-Checkliste (49 uiCheckliste), dazu Zählungen am Netzmodell.

/** @typedef {{ stufe: string, text: string }} ToolHinweis */
let _toolCache = { t: 0, /** @type {Record<string, ToolHinweis>} */ werte: {} };

/** @returns {Record<string, ToolHinweis>} */
function _toolStand(frisch = false) {
  if (!frisch && Date.now() - _toolCache.t < 2000) return _toolCache.werte;
  const w = /** @type {any} */ (window);
  /** @type {Record<string, ToolHinweis>} */
  const h = {};
  const versuch = (/** @type {() => void} */ fn) => { try { fn(); } catch (e) { /* Prüfung optional */ } };
  const setze = (/** @type {string} */ id, /** @type {string} */ stufe, /** @type {string} */ text) => { h[id] = { stufe, text }; };

  // Projekt-Checkliste (Projektseite) — gleiche Prüfungen, gleiche Texte
  versuch(() => {
    const ck = new Map((w.uiCheckliste?.() || []).flatMap((/** @type {any} */ g) => g.punkte).map((/** @type {any} */ p) => [p.id, p]));
    const von = (/** @type {string} */ quelle, /** @type {string[]} */ ziele) => {
      const p = ck.get(quelle);
      if (p) ziele.forEach(z => setze(z, p.stufe, p.text));
    };
    const name = ck.get('name'), we = ck.get('we');
    if (name && we) setze('g-name', name.stufe === 'ok' && we.stufe === 'ok' ? 'ok' : 'offen', `Name: ${name.text} · WE-Nr.: ${we.text}`);
    von('gebaeude', ['g-plangebiet']);
    von('namen', ['g-benennen']);
    von('stromlast', ['v-autofill']);
    von('referenz', ['v-referenz']);
    von('stromnetz', ['n-kabel']);
    von('bestandpruefung', ['n-pruefen']);
    von('anschluss', ['a-grenzen', 'u-vertrag']);
    von('entscheidung', ['w-massnahmen']);
    von('pv', ['w-belegen']);
    von('stromErg', ['r-rechnen', 'i-rechnen']);
    von('gutachten', ['z-editor']);
  });

  // Zählungen am Netzmodell
  versuch(() => {
    /** @type {any[]} */
    const items = ASSETS.items || [];
    const n =(/** @type {string} */ typ) => items.filter((/** @type {any} */ a) => a.type === typ).length;
    const nNap = n('NAP'), nTrafo = n('Trafo'), nNshv = n('NSHV'), nUv = n('UV'), nKvs = n('KVS');
    setze('n-nap', nNap ? 'ok' : 'offen', nNap ? `${nNap} NAP gesetzt` : 'Noch kein NAP im Netz');
    setze('n-stationen', nTrafo ? 'ok' : 'offen', nTrafo ? `${nTrafo} ${nTrafo === 1 ? 'Trafo' : 'Trafos'} im Netz` : 'Noch kein Trafo im Netz');
    setze('n-verteiler', nNshv ? 'ok' : 'offen', `${nNshv} NSHV · ${nUv} UV · ${nKvs} KVS`);
    const erz = [['PV', n('PV')], ['KWK', n('KWK')], ['Batterie', n('Batterie')], ['Wind', n('Wind')]].filter(([, z]) => z);
    setze('i-erzeugung', erz.length ? 'ok' : 'leer', erz.length ? erz.map(([t, z]) => `${z} ${t}`).join(' · ') : 'Keine Erzeugungsanlagen im Netz');
    const nNsa = n('Nsa');
    setze('i-nea', nNsa ? 'ok' : 'leer', nNsa ? `${nNsa} Notstromaggregat${nNsa === 1 ? '' : 'e'} im Netz` : 'Kein Notstromaggregat im Netz');
    const nBat = n('Batterie');
    setze('w-speicher', nBat ? 'ok' : 'leer', nBat ? `${nBat} Batteriespeicher im Netz` : 'Kein Batteriespeicher im Netz');
    const nLade = n('Lade');
    ['p-lade', 'w-lade'].forEach(id => setze(id, nLade ? 'ok' : 'leer', nLade ? `${nLade} Ladeinfrastruktur-Punkt${nLade === 1 ? '' : 'e'} im Netz` : 'Keine Ladeinfrastruktur im Netz'));
    const nWind = n('Wind');
    if (nWind) setze('w-wind', 'ok', `${nWind} Windkraftanlage${nWind === 1 ? '' : 'n'} im Netz`);
    const stationen = ssStationsGebaeude(items, gebaeude);
    const mitSb = stationen.filter(g => g.stationSteckbrief && Object.keys(g.stationSteckbrief).length).length;
    if (stationen.length) setze('n-steckbrief', mitSb === stationen.length ? 'ok' : 'offen', `${mitSb} von ${stationen.length} Stationen mit Steckbrief`);
  });

  // Varianten, Notstrom, Resilienz, Datenqualität
  versuch(() => {
    const nVar = varianten.length;
    setze('w-anlegen', nVar ? 'ok' : 'offen', nVar ? `Hauptplan + ${nVar} Variante${nVar === 1 ? '' : 'n'}` : 'Nur der Hauptplan, noch keine Variante');
    setze('b-empfehlung', gutachtenVariante ? 'ok' : 'offen', gutachtenVariante ? `★ ${variantenName(gutachtenVariante)}` : 'Noch keine Variante mit ★ markiert');
  });
  versuch(() => {
    const nGeb = gebaeude.length;
    const nKl = gebaeude.filter((/** @type {any} */ g) => g.notstrom?.klasse).length;
    if (nGeb) setze('s-klassen', nKl ? 'ok' : 'offen', `${nKl} von ${nGeb} Gebäuden mit Notstromklasse`);
  });
  versuch(() => {
    const ra = w.raZustand?.();
    if (ra) setze('s-einlesen', ra.daten ? 'ok' : 'offen', ra.daten ? `Abfrage eingelesen${ra.quelle ? ' (' + ra.quelle + ')' : ''}` : 'Noch keine ausgefüllte Abfrage eingelesen');
  });
  // Messjahre, Kabeldaten, Rechenergebnisse
  versuch(() => {
    const mj = w.sgMjDaten?.();
    if (mj) {
      const n = (mj.jahre || []).length;
      setze('v-messjahre', n ? 'ok' : 'offen', n ? `${n} Messjahr${n === 1 ? '' : 'e'} geladen${mj.referenzId ? ', Referenzjahr gewählt' : ', noch kein Referenzjahr'}` : 'Noch kein Messjahr geladen');
      if (n) setze('v-jahresvergleich', n > 1 ? 'ok' : 'leer', n > 1 ? `${n} Jahre zum Vergleich` : 'Nur ein Messjahr — kein Vergleich möglich');
    }
  });
  versuch(() => {
    /** @type {any[]} */
    const kabel = Array.isArray(stromEdges) ? stromEdges : [];
    if (!kabel.length) return;
    const ohneQs = kabel.filter(e => !e?.autoSized && !(Number(e?.crossSection) > 0)).length;
    const geschaetzt = kabel.filter(e => e?.qsGeschaetzt).length;
    const ohneBj = kabel.filter(e => !e?.baujahr).length;
    const teile = [ohneQs && `${ohneQs} ohne Querschnitt`, geschaetzt && `${geschaetzt} mit geschätztem Querschnitt`, ohneBj && `${ohneBj} ohne Baujahr`].filter(Boolean);
    setze('n-kabeldaten', ohneQs ? 'veraltet' : teile.length ? 'offen' : 'ok', teile.length ? `${kabel.length} Kabel: ${teile.join(' · ')}` : `Alle ${kabel.length} Kabel mit Querschnitt und Baujahr`);
    const gerechnet = kabel.filter(e => Number.isFinite(e?.auslastungPct));
    if (gerechnet.length) {
      const ueber = gerechnet.filter(e => e.auslastungPct > 100).length;
      setze('r-karte', ueber ? 'veraltet' : 'ok', ueber ? `${ueber} Kabel über 100 % ausgelastet` : `Kein Kabel über 100 % (höchstens ${Math.round(Math.max(...gerechnet.map(e => e.auslastungPct)))} %)`);
    }
  });
  versuch(() => {
    /** @type {any[]} */
    const trafos = (ASSETS.items || []).filter((/** @type {any} */ a) => a.type === 'Trafo' && a._calcVerbrauchKw !== undefined && a._calcPeakLoadPct != null);
    if (!trafos.length) return;
    const max = Math.max(...trafos.map((/** @type {any} */ a) => Number(a._calcPeakLoadPct) || 0));
    setze('i-trafo', max > 100 ? 'veraltet' : 'ok', `Höchste Trafo-Auslastung ${Math.round(max)} %${max > 100 ? ' — überlastet' : ''}`);
  });
  versuch(() => {
    const e = w.engpassLetztesErgebnis?.();
    setze('r-engpass', e ? 'ok' : 'offen', e ? 'Engpass-Analyse in dieser Sitzung gerechnet' : 'Engpass-Analyse in dieser Sitzung noch nicht gerechnet');
  });
  // Kapitelstand im Gutachten
  versuch(() => {
    const ks = w.gutKapitelStand?.();
    if (!ks) return;
    Object.assign(h, ecKapitelHinweise(ks));
    const nSt = ssStationsGebaeude(ASSETS.items || [], gebaeude).length;
    if (nSt) setze('z-anlagen', ks.stationsAnlagen >= nSt ? 'ok' : 'offen', `${ks.stationsAnlagen} von ${nSt} Stationen als Anlage`);
  });
  versuch(() => {
    const dq = w.dqHinweise?.();
    if (Array.isArray(dq)) {
      const nW = dq.filter((/** @type {any} */ x) => x.stufe === 'warnung').length;
      setze('g-qualitaet', nW ? 'offen' : 'ok', nW ? `${nW} auffällige Werte` : 'Keine auffälligen Werte');
    }
  });

  _toolCache = { t: Date.now(), werte: h };
  return h;
}

// ── Im Tool öffnen ─────────────────────────────────────────────────────
// Je Aufgabe der Sprung an die Stelle, wo sie erledigt wird. Fenster nur öffnen, nie schließen:
// die Umschalter (…Toggle) werden nur gerufen, wenn das Fenster noch zu ist.
const _w = () => /** @type {any} */ (window);
const _strom = (/** @type {string} */ tab) => () => { _w().uiSchritt?.('planung', { sparte: 'strom' }); _w().elTab?.(tab); };
const _seite = (/** @type {string} */ schritt, /** @type {string} */ key) => () => _w().uiGeheZu?.(schritt, key);
const _fenster = (/** @type {string} */ id, /** @type {string} */ umschalter, /** @type {(() => void)|null} */ vorher = null) => () => {
  vorher?.();
  if (!_sichtbar(document.getElementById(id))) _w()[umschalter]?.();
};
const _asset = (/** @type {string} */ typ, /** @type {string} */ tab = 'netz') => () => {
  _strom(tab)();
  const a = (ASSETS.items || []).find((/** @type {any} */ x) => x.type === typ);
  if (a) _w().openAssetInspector?.(a);
  else _w().showHint?.(`Noch kein ${typ} im Netz — im Reiter setzen.`, 4000);
};
const _bestandTabelle = () => _w().uiGebaeudetabelle?.(true);
const _gutachten = _seite('gutachten', 'ggrafik');
const _grundlagen = _fenster('strom-panel', 'toggleStromPanel', _strom('netz'));
const _blackout = () => { _strom('pruefen')(); if (!_w().blackoutModusAktiv) _w().blackoutModusStart?.(); };
const _resilienz = _fenster('resilienz-abfrage-panel', 'raPanelToggle', _strom('pruefen'));

/** @type {Record<string, () => void>} */
const _AKTIONEN = {
  'u-plan': _fenster('plandigi-panel', 'pdTogglePanel', _strom('netz')),
  'u-lastgang': _grundlagen, 'u-bhkw': _grundlagen,
  'u-vertrag': _asset('NAP'), 'u-stationen': _asset('Trafo'), 'u-nea': _strom('erzeugung'),
  'u-entwicklung': _bestandTabelle, 'u-lade': _asset('Lade'),
  'u-begehung': _fenster('feldapp-panel', 'toggleFeldappPanel'),
  'g-name': () => { _w().uiSchritt?.('projekt'); const f = document.getElementById('pd-kaserne-name'); f?.focus(); f?.scrollIntoView({ block: 'center' }); },
  'g-plangebiet': () => _w().uiSchritt?.('bestand'),
  'g-ladestatus': _fenster('lade-status-panel', 'ladeStatusToggle'),
  'g-benennen': _bestandTabelle,
  'g-grundriss': _fenster('grundriss-panel', 'grundrissPanelToggle', () => _w().uiSchritt?.('bestand')),
  'g-excel': () => _w().uiSchritt?.('projekt'), 'g-qualitaet': () => _w().uiSchritt?.('projekt'),
  'v-messjahre': _grundlagen, 'v-referenz': _grundlagen, 'v-jahresvergleich': _grundlagen,
  'v-autofill': () => _w().showAutofillWizard?.(), 'v-profile': _bestandTabelle,
  'v-abgleich': _seite('auswertung', 'strom'),
  'n-trassen': _strom('netz'), 'n-digital': _fenster('plandigi-panel', 'pdTogglePanel', _strom('netz')),
  'n-nap': _asset('NAP'), 'n-stationen': _strom('netz'), 'n-betriebsart': _asset('Trafo'),
  'n-verteiler': _strom('netz'), 'n-kabel': _strom('netz'), 'n-kabeldaten': _strom('netz'),
  'n-steckbrief': () => {
    const st = ssStationsGebaeude(ASSETS.items || [], gebaeude);
    if (!st.length) { _strom('netz')(); _w().showHint?.('Noch keine Station im Netz.', 4000); return; }
    const ohne = st.find(g => !g.stationSteckbrief || !Object.keys(g.stationSteckbrief).length) || st[0];
    _w().openStationsSteckbrief?.(ohne.id);
  },
  'n-pruefen': _fenster('bestand-panel', 'bestandPanelToggle', _strom('pruefen')),
  'n-sld': _fenster('sld-panel', 'sldToggle', _strom('pruefen')),
  'a-grenzen': _asset('NAP'), 'a-lastgang': _seite('auswertung', 'nap'),
  'a-modul': _seite('auswertung', 'netzanschluss'), 'a-uw': _seite('auswertung', 'netzanschluss'),
  'i-erzeugung': _strom('erzeugung'), 'i-kopplung': _strom('erzeugung'), 'i-nea': _strom('erzeugung'),
  'i-rechnen': _strom('berechnen'), 'i-trafo': _strom('berechnen'),
  'p-bestand': _bestandTabelle,
  'p-waerme': () => { _w().uiSchritt?.('planung', { sparte: 'waerme' }); _w().uiWaermeTab?.('erzeuger'); },
  'p-lade': _asset('Lade'), 'p-ergebnis': _seite('gutachten', 'ggrafik'),
  'w-anlegen': _fenster('var-menu', 'variantenMenuToggle'), 'w-massnahmen': _strom('netz'),
  'w-dachdaten': _strom('pv'), 'w-regeln': _strom('pv'), 'w-belegen': _strom('pv'), 'w-ff': _strom('pv'),
  'w-staende': _strom('pv'), 'w-pvpruefen': _strom('pv'),
  'w-baeume': _fenster('baum-panel', 'baumBearbeitenToggle'),
  'w-pva': _seite('auswertung', 'pva'), 'w-netzaufnahme': _seite('auswertung', 'pva'),
  'w-netzstrategie': _seite('auswertung', 'pva'), 'w-autarkie': _seite('auswertung', 'pva'),
  'w-speicher': _strom('erzeugung'),
  'w-wind': _fenster('windanalyse-panel', 'windaTogglePanel', _strom('erzeugung')),
  'w-trafo': _fenster('netzanalyse-panel', 'naTogglePanel', _strom('pruefen')),
  'w-nea': _blackout, 'w-lade': _asset('Lade'),
  'r-annahmen': _strom('berechnen'), 'r-kosten': _strom('berechnen'), 'r-rechnen': _strom('berechnen'), 'r-karte': _strom('berechnen'),
  'r-netzanalyse': _fenster('netzanalyse-panel', 'naTogglePanel', _strom('pruefen')),
  'r-kna': _seite('auswertung', 'kna'),
  'r-engpass': _fenster('engpass-panel', 'engpassPanelToggle', _strom('pruefen')),
  'r-schwelle': _fenster('schwellen-panel', 'schwellenPanelToggle', _strom('pruefen')),
  'r-ergebnisblatt': _seite('auswertung', 'f:ergebnisblatt'), 'r-bilanz': _seite('auswertung', 'strom'),
  'b-vergleich': _seite('auswertung', 'v:vergleich'), 'b-wirtschaft': _seite('auswertung', 'wirtschaft'),
  'b-matrix': _gutachten, 'b-empfehlung': _fenster('var-menu', 'variantenMenuToggle'),
  'b-fahrplan': _seite('auswertung', 'ausbauplaner'), 'b-invest': () => _w().showInvestitionsplan?.(),
  's-abfrage': _resilienz, 's-einlesen': _resilienz,
  's-klassen': _blackout, 's-sz1': _blackout, 's-sz2': _blackout, 's-sz3': _blackout, 's-gegen': _gutachten,
  'ga-ziele': _gutachten, 'ga-eza': _gutachten,
  'z-editor': _gutachten, 'z-grafiken': _gutachten, 'z-bilder': _seite('gutachten', 'liegenschaftsbilder'),
  'z-anlagen': _gutachten, 'z-fazit': _gutachten, 'z-luecken': _gutachten, 'z-widerspruch': _gutachten,
  'z-stil': _gutachten, 'z-export': _gutachten,
  'z-sichern': () => _w().uiMenuUmschalten?.('ui-proj-menu'),
};

/** Ids ohne Sprungziel (für die Prüfung im Browser). */
export function ecOhneAktion() { return EC_PHASEN.flatMap(ph => ph.punkte).map(p => p.id).filter(id => !_AKTIONEN[id]); }

function _imToolOeffnen(/** @type {string} */ id) {
  const fn = _AKTIONEN[id];
  if (!fn) return;
  try { fn(); } catch (e) { console.error(e); }
  try { window.focus(); } catch (e) { /* Browser lässt das Fenster nicht nach vorn */ }
}

// ── Stelle im Tool ermitteln ───────────────────────────────────────────
function _sichtbar(/** @type {Element|null} */ el) {
  if (!el || !el.isConnected || el.hasAttribute('hidden')) return false;
  const st = getComputedStyle(el);
  return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0;
}

function _ortLesen() {
  const w = /** @type {any} */ (window);
  const ui = typeof w.uiOrt === 'function' ? w.uiOrt() : {};
  const panels = _PANEL_IDS.filter(id => _sichtbar(document.getElementById(id)));
  let assetTyp = '';
  const sel = w.ASSETS?.selectedId;
  if (sel != null && _sichtbar(document.getElementById('sb-asset-inspector-slot'))) {
    assetTyp = (w.ASSETS.items || []).find((/** @type {any} */ a) => a.id === sel)?.type || '';
  }
  return { ...ui, elTab: typeof w.elTabAktiv === 'function' ? w.elTabAktiv() : '', panels, assetTyp };
}

/** Lesbare Beschreibung der Stelle, z. B. „Planung › Strom › Netz · Fenster Netzanalyse“. */
function _ortText(/** @type {any} */ o) {
  const w = /** @type {any} */ (window);
  const teile = [];
  const schritt = (w.UI_SCHRITTE || []).find((/** @type {any} */ s) => s.id === o.schritt)?.titel || o.schritt || '';
  if (schritt) teile.push(schritt);
  if (o.schritt === 'planung') {
    if (o.sparte === 'strom') teile.push('Strom', (w.EL_TABS || []).find((/** @type {any} */ t) => t.id === o.elTab)?.titel || o.elTab);
    else teile.push('Wärme');
  } else if (o.schritt === 'bestand' && o.bestandAnsicht === 'tabelle') teile.push('Tabelle');
  else if ((o.schritt === 'auswertung' || o.schritt === 'gutachten') && o.abschnitt) {
    const t = document.querySelector('#ui-seitentitel h1')?.textContent?.trim();
    if (t) teile.push(t);
  }
  let text = teile.filter(Boolean).join(' › ');
  const zusatz = o.panels.map((/** @type {string} */ id) => {
    const el = document.getElementById(id);
    const kopf = (el?.querySelector('.panel-drag-handle > span:first-child') || el?.querySelector('h1, h2, h3, h4, header b'))?.textContent?.trim();
    return (kopf || el?.getAttribute('aria-label') || id).replace(/\s+/g, ' ').slice(0, 40);
  });
  if (o.assetTyp) zusatz.push('Inspektor ' + o.assetTyp);
  if (zusatz.length) text += ' · ' + zusatz.join(' · ');
  return text;
}

function _tick() {
  if (!_win || _win.closed) { _beenden(); return; }
  // Eingebettet (Reiter im Auswertungsfenster, src/55): screenX/outerWidth gehören dem umgebenden Fenster
  if (_win.top === _win) try { localStorage.setItem(LAGE_KEY, JSON.stringify({ x: _win.screenX, y: _win.screenY, b: _win.outerWidth, h: _win.outerHeight })); } catch (e) { /* ohne Speicher */ }
  // Stand aus dem Tool alle ~5 s neu lesen; geänderte Hinweise sofort zeigen
  if (++_taktZaehler % 7 === 0) {
    const alt = JSON.stringify(_toolCache.werte);
    if (JSON.stringify(_toolStand(true)) !== alt) _zeichnen(false);
  }
  const o = _ortLesen();
  const marken = ecOrtMarken(o);
  const schluessel = marken.join('|');
  if (schluessel === _ortSchluessel) return;
  _ortSchluessel = schluessel;
  _marken = marken;
  _ortTextAktuell = _ortText(o);
  if (_folgen) _zeichnen(false, true);
}

function _beenden() {
  if (_takt) clearInterval(_takt);
  _takt = 0; _win = null; _ortSchluessel = '';
}

// ── Fenster öffnen ─────────────────────────────────────────────────────
// Erst öffnen (synchron, sonst blockt der Browser das Pop-up), dann beim allerersten Mal auf
// einen anderen Bildschirm schieben (Window Management API, fragt einmal nach Erlaubnis).
// Danach merkt sich das Tool die Lage, die man dem Fenster gegeben hat.
export function ecFensterOeffnen() {
  // Ist das Auswertungsfenster (src/55) offen, kommt die Liste dort als Reiter — kein weiteres Fenster
  if (/** @type {any} */ (window).afAktiv?.()) { /** @type {any} */ (window).afCheckliste?.(); return; }
  if (_win && !_win.closed) { _win.focus(); return; }
  let l = null;
  try { l = JSON.parse(localStorage.getItem(LAGE_KEY) || 'null'); } catch (e) { /* ohne Speicher */ }
  const gemerkt = !!l;
  l = l || { x: Math.max(0, window.screenX + window.outerWidth - 540), y: window.screenY + 40, b: 520, h: Math.min(900, screen.availHeight - 80) };
  const w = window.open('', FENSTER_NAME, `popup=yes,left=${Math.round(l.x)},top=${Math.round(l.y)},width=${Math.round(l.b)},height=${Math.round(l.h)}`);
  if (!w) { /** @type {any} */ (window).showHint?.('Das Fenster wurde vom Browser blockiert. Pop-ups für dieses Tool erlauben.', 6000); return; }
  ecVerbinden(w);
  w.focus();
  if (!gemerkt) _aufAnderenBildschirm(w);
}

async function _aufAnderenBildschirm(/** @type {Window} */ w) {
  const ww = /** @type {any} */ (window);
  if (typeof ww.getScreenDetails !== 'function') return;
  try {
    const d = await ww.getScreenDetails();
    const anderer = d.screens.find((/** @type {any} */ s) => s !== d.currentScreen);
    if (!anderer || w.closed) return;
    const b = Math.min(560, anderer.availWidth);
    w.moveTo(anderer.availLeft + anderer.availWidth - b, anderer.availTop);
    w.resizeTo(b, anderer.availHeight);
  } catch (e) { /* Erlaubnis verweigert oder nur ein Bildschirm — Fenster bleibt, wo es ist */ }
}

/** Seitengerüst + Stil ins Fenster schreiben (oder ein vorhandenes wiederverwenden). */
function _geruest(/** @type {Window} */ w) {
  const doc = w.document;
  if (!doc.getElementById('ec-root')) {
    doc.open();
    doc.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Elektro-Checkliste</title>
      <style id="ec-fonts"></style><style>${_CSS}</style></head><body><div id="ec-getrennt" hidden></div><div id="ec-root"></div></body></html>`);
    doc.close();
    // Wache als Element einsetzen, nicht als Text: ein schließendes Skript-Tag im Quelltext
    // beendet im Einzeldatei-Build das umgebende Skript.
    const s = doc.createElement('script');
    s.textContent = _WACHE;
    doc.body.appendChild(s);
  }
  // Ereignisse hängen am Wurzelknoten. Nach einem Neuladen des Tools wird er ersetzt — damit
  // verschwinden die Zuhörer des alten Ladestands, die sonst mit veraltetem Zustand weiterliefen.
  const alt = /** @type {any} */ (doc.getElementById('ec-root'));
  if (alt && alt._ecLadung !== _LADUNG) {
    const root = /** @type {any} */ (doc.createElement('div'));
    root.id = 'ec-root';
    root._ecLadung = _LADUNG;
    alt.replaceWith(root);
    root.addEventListener('click', _klick);
    root.addEventListener('change', _aenderung);
    root.addEventListener('input', _eingabe);
    root.addEventListener('toggle', _aufzu, true);
  }
  // Schriften des Tools mitnehmen (lokale @font-face-Regeln)
  try {
    const regeln = [];
    for (const sh of [...document.styleSheets]) {
      try { for (const r of [...sh.cssRules]) if (r.constructor.name === 'CSSFontFaceRule') regeln.push(r.cssText); } catch (e) { /* fremdes Stylesheet */ }
    }
    const f = doc.getElementById('ec-fonts'); if (f) f.textContent = regeln.join('\n');
  } catch (e) { /* ohne Schriften */ }
}

// Kennung dieses Ladestands des Tools (neu bei jedem Neuladen).
const _LADUNG = Math.random();

// Kleines Skript im Fenster selbst: es überlebt ein Neuladen des Tools, weil es im Fenster läuft.
// window.opener bleibt derselbe Reiter — sobald dort ecVerbinden wieder existiert, meldet es sich an.
const _WACHE = `(function () {
  var hinweis = function (t) { var b = document.getElementById('ec-getrennt'); if (!b) return; b.hidden = !t; b.textContent = t || ''; };
  setInterval(function () {
    var o = window.opener || (window.parent !== window ? window.parent.opener : null);
    if (!o || o.closed) { hinweis('Das Tool ist geschlossen. Nach dem Öffnen: Hilfe › Elektro-Checkliste (2. Bildschirm).'); return; }
    try {
      if (typeof o.ecVerbinden !== 'function') { hinweis('Das Tool lädt neu … die Liste verbindet sich gleich wieder.'); return; }
      if (!o.ecIstVerbunden(window)) o.ecVerbinden(window);
      hinweis('');
    } catch (e) { hinweis('Keine Verbindung zum Tool. Im Tool: Hilfe › Elektro-Checkliste (2. Bildschirm).'); }
  }, 1500);
})();`;

/** Ist dieses Fenster mit diesem Ladestand des Tools verbunden? (vom Fenster aus gefragt) */
export function ecIstVerbunden(/** @type {Window} */ w) { return _win === w && !!_takt; }

/**
 * Liste in ein eingebettetes Fenster (iframe, Reiter im Auswertungsfenster src/55) zeichnen. Ein
 * offenes eigenes Checklisten-Fenster wird geschlossen — sonst holten sich beide abwechselnd die Verbindung.
 */
export function ecEinbetten(/** @type {Window} */ w) {
  if (_win && _win !== w && !_win.closed && _win.top === _win) { try { _win.close(); } catch (e) { /* schon zu */ } }
  ecVerbinden(w);
}

/** Fenster (wieder) an diesen Ladestand hängen: Gerüst, Zuhörer, Takt, neu zeichnen. */
export function ecVerbinden(/** @type {Window} */ w) {
  if (!w || w.closed) return;
  _win = w;
  _geruest(w);
  _ortSchluessel = '';
  _toolCache.t = 0;
  _tick();
  _zeichnen(true);
  if (_takt) clearInterval(_takt);
  _takt = /** @type {any} */ (setInterval(_tick, TAKT_MS));
}

// Farben und Schrift kommen vom Tool (hell/dunkel), Werte je Zeichnen übernommen.
const _TOKENS = ['--bg', '--surface', '--surface-2', '--text', '--muted', '--faint', '--border', '--line-2', '--brand', '--brand-weak', '--on-brand',
  '--ok', '--ok-bg', '--warn', '--warn-bg', '--crit', '--crit-bg', '--info', '--info-bg', '--focus', '--font-ui', '--font-mono', '--font-num', '--r'];

function _themaUebernehmen(/** @type {Document} */ doc) {
  const cs = getComputedStyle(document.documentElement);
  const root = doc.documentElement;
  for (const t of _TOKENS) { const v = cs.getPropertyValue(t); if (v) root.style.setProperty(t, v.trim()); }
  root.style.colorScheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

// ── Zeichnen ───────────────────────────────────────────────────────────
function _statusKnoepfe(/** @type {string} */ id, /** @type {string} */ s) {
  return `<div class="ec-seg" role="group" aria-label="Status">${EC_STATUS.map(x =>
    `<button type="button" data-status="${x.id}" data-id="${id}" class="st-${x.id}" aria-pressed="${x.id === s}">${x.titel}</button>`).join('')}</div>`;
}

const _TOOL_WORT = /** @type {Record<string, string>} */ ({ ok: ' erfüllt', offen: ' offen', veraltet: ' veraltet', leer: '' });

/** Hinweiszeile „Im Tool: …“, bei erfülltem Stand mit Knopf zum Übernehmen. */
function _toolZeile(/** @type {string} */ id, /** @type {string} */ s) {
  const t = _toolStand()[id];
  if (!t) return '';
  const uebernehmen = t.stufe === 'ok' && s !== 'erledigt' && s !== 'entfaellt'
    ? ` <button type="button" class="ec-mini" data-status="erledigt" data-id="${id}">Als erledigt markieren</button>` : '';
  return `<div class="ec-tool tl-${t.stufe}"><span class="ec-punkt"></span><span><b>Im Tool:</b> ${_esc(t.text)}</span>${uebernehmen}</div>`;
}

function _karte(/** @type {any} */ p) {
  const e = _stand.punkte[p.id];
  const s = e?.s || 'offen';
  return `<article class="ec-karte st-${s}" data-punkt="${p.id}">
    <div class="ec-kt"><b>${_esc(p.t)}</b>${p.kap ? `<span class="ec-chip">Kap. ${_esc(p.kap)}</span>` : ''}${p.opt ? '<span class="ec-chip opt">optional</span>' : ''}${p.ext ? '<span class="ec-chip ext">außerhalb des Tools</span>' : ''}</div>
    ${p.wo ? `<div class="ec-wo">${_esc(p.wo)}</div>` : ''}
    <div class="ec-ok"><span>Fertig, wenn:</span> ${_esc(p.ok)}</div>
    ${_toolZeile(p.id, s)}
    <div class="ec-aktionen">${_statusKnoepfe(p.id, s)}${_AKTIONEN[p.id] ? `<button type="button" class="ec-mini ec-hin" data-oeffnen="${p.id}" title="Die Stelle im Hauptfenster öffnen">Im Tool öffnen ↗</button>` : ''}</div>
    ${s === 'klaeren' ? _adressatWahl(p) : ''}
    <textarea class="ec-notiz" data-notiz="${p.id}" rows="2" placeholder="${s === 'klaeren' ? 'Frage, so wie sie in der Rückfragenliste stehen soll …' : 'Notiz: Quelle, offene Frage, Ansprechpartner …'}">${_esc(e?.n || '')}</textarea>
  </article>`;
}

function _adressatWahl(/** @type {any} */ p) {
  const a = ecAdressat(_stand, p);
  return `<label class="ec-adr">Rückfrage an
    <select data-adressat="${p.id}">${EC_ADRESSATEN.map(x => `<option value="${x.id}"${x.id === a ? ' selected' : ''}>${x.titel}</option>`).join('')}</select></label>`;
}

/** Ansicht „Rückfragen“: alle Aufgaben mit Status „Klären“ nach Adressat, zum Kopieren oder als CSV. */
function _rueckfragenHtml() {
  const gruppen = ecRueckfragen(_stand);
  const n = gruppen.reduce((s, g) => s + g.eintraege.length, 0);
  const kopf = `<div class="ec-hier-kopf"><span>Rückfragen</span><b>${n ? `${n} offene Frage${n === 1 ? '' : 'n'}` : 'keine'}</b>
    <button type="button" class="ec-mini" data-rf="zu">Zurück zur Liste</button></div>`;
  if (!n) return `<section class="ec-hier">${kopf}<p class="ec-leer">Noch keine Aufgabe mit Status „Klären“. Setze bei einer Aufgabe „Klären“, wähle den Adressaten und schreib die Frage in die Notiz.</p></section>`;
  return `<section class="ec-hier">${kopf}
    <div class="ec-aktionen"><button type="button" class="ec-mini" data-rf="kopieren">Als Text kopieren</button>
      <button type="button" class="ec-mini" data-rf="csv">Als CSV speichern (Excel)</button><span class="ec-rf-meldung" id="ec-rf-meldung"></span></div>
    ${gruppen.map(g => `<div class="ec-rf-grp"><h3>An: ${_esc(g.titel)} <small>${g.eintraege.length}</small></h3><ol>${g.eintraege.map(e => `<li>
        <div><b>${_esc(e.t)}</b>${e.kap ? ` <span class="ec-chip">Kap. ${_esc(e.kap)}</span>` : ''}</div>
        ${e.n ? `<div class="ec-rf-frage">${_esc(e.n)}</div>` : '<div class="ec-rf-frage leer">Noch keine Frage formuliert</div>'}
        <div class="ec-zk"><button type="button" class="ec-mini" data-zeige="${e.id}">Bearbeiten</button><button type="button" class="ec-mini" data-status="erledigt" data-id="${e.id}">Geklärt</button></div>
      </li>`).join('')}</ol></div>`).join('')}
    <textarea class="ec-rf-text" id="ec-rf-text" readonly rows="6" aria-label="Rückfragen als Text">${_esc(ecRueckfragenText(gruppen, _liegenschaftName()))}</textarea>
  </section>`;
}

const _liegenschaftName = () => (/** @type {any} */ (window).getProjektName?.() || '').trim();

/** Kopieren und CSV laufen im Fenster selbst (Zwischenablage und Download gehören zu seinem Dokument). */
function _rueckfragenAktion(/** @type {string} */ was) {
  const w = _win;
  if (!w || w.closed) return;
  const doc = w.document;
  const meldung = (/** @type {string} */ t) => { const m = doc.getElementById('ec-rf-meldung'); if (m) m.textContent = t; };
  const gruppen = ecRueckfragen(_stand);
  if (was === 'kopieren') {
    const text = ecRueckfragenText(gruppen, _liegenschaftName());
    const zurueck = () => {   // ohne Zwischenablage-Recht: Text markieren, Strg C bleibt dem Nutzer
      const ta = /** @type {HTMLTextAreaElement|null} */ (doc.getElementById('ec-rf-text'));
      ta?.focus(); ta?.select();
      let ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { /* älterer Weg nicht erlaubt */ }
      meldung(ok ? 'Kopiert' : 'Text unten markiert — mit Strg C kopieren');
    };
    const cb = w.navigator.clipboard;
    if (cb?.writeText) cb.writeText(text).then(() => meldung('Kopiert — z. B. in eine E-Mail einfügen'), zurueck);
    else zurueck();
  } else if (was === 'csv') {
    const name = (_liegenschaftName() || 'Liegenschaft').replace(/[\\/:*?"<>|]+/g, '_');
    const blob = new (/** @type {any} */ (w)).Blob(['\ufeff' + ecRueckfragenCsv(gruppen)], { type: 'text/csv;charset=utf-8' });
    const a = doc.createElement('a');
    a.href = (/** @type {any} */ (w)).URL.createObjectURL(blob);
    a.download = `Rueckfragen_Elektro_${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => (/** @type {any} */ (w)).URL.revokeObjectURL(a.href), 2000);
    meldung('CSV gespeichert');
  }
}

function _zeile(/** @type {any} */ p) {
  const e = _stand.punkte[p.id];
  const s = e?.s || 'offen';
  const t = _toolStand()[p.id];
  return `<li class="ec-zeile st-${s}" data-punkt="${p.id}">
    <select data-status-wahl="${p.id}" aria-label="Status: ${_esc(p.t)}">${EC_STATUS.map(x => `<option value="${x.id}"${x.id === s ? ' selected' : ''}>${x.titel}</option>`).join('')}</select>
    <div class="ec-zt"><span>${t ? `<i class="ec-punkt tl-${t.stufe}" title="Im Tool${_TOOL_WORT[t.stufe] || ''}: ${_esc(t.text)}"></i>` : ''}${_esc(p.t)}${p.opt ? ' <em>optional</em>' : ''}</span>${e?.n ? `<small title="${_esc(e.n)}">✎ ${_esc(e.n.length > 70 ? e.n.slice(0, 70) + '…' : e.n)}</small>` : ''}</div>
    <div class="ec-zk">${_AKTIONEN[p.id] ? `<button type="button" class="ec-mini" data-oeffnen="${p.id}" title="Die Stelle im Hauptfenster öffnen">↗</button>` : ''}<button type="button" class="ec-mini" data-zeige="${p.id}" title="Oben mit Notiz bearbeiten">Bearbeiten</button></div>
  </li>`;
}

/**
 * @param {boolean} [alles]  auch die Phasenliste neu (sonst nur Kopf + „Hier gerade“)
 * @param {boolean} [ortWechsel]  nach einem Ortswechsel: angeheftete Aufgabe lösen, nach oben scrollen
 */
function _zeichnen(alles = true, ortWechsel = false) {
  const w = _win;
  if (!w || w.closed) return;
  const doc = w.document;
  const root = doc.getElementById('ec-root');
  if (!root) return;
  // Nicht unter dem Tippen neu zeichnen
  if (doc.activeElement?.matches?.('textarea.ec-notiz')) { _spaeter = true; return; }
  _spaeter = false;
  if (ortWechsel) _angeheftet = null;
  _themaUebernehmen(doc);

  const name = (/** @type {any} */ (window).getProjektName?.() || '').trim() || 'Liegenschaft ohne Namen';
  let f = 0, g = 0;
  for (const ph of EC_PHASEN) { const z = ecZaehle(_stand, ph.punkte); f += z.fertig; g += z.gesamt; }
  const { punkte: hier } = ecPassend(_marken);
  const zeigen = _angeheftet ? [EC_PHASEN.flatMap(ph => ph.punkte).find(p => p.id === _angeheftet)].filter(Boolean) : hier;
  const naechste = ecNaechste(_stand);

  const kopf = `<header class="ec-kopf">
      <div class="ec-titel"><small>Elektro-Checkliste</small><b>${_esc(name)}</b></div>
      <div class="ec-fs"><div class="ec-balken"><i style="width:${g ? (100 * f / g).toFixed(1) : 0}%"></i></div><span>${f} / ${g}</span></div>
      <div class="ec-schalter">
        <label><input type="checkbox" id="ec-folgen"${_folgen ? ' checked' : ''}> Stelle im Tool folgen</label>
        <label><input type="checkbox" id="ec-nuroffen"${_nurOffen ? ' checked' : ''}> Nur offene</label>
        <button type="button" class="ec-mini ec-rf-knopf" data-rf="${_rueckfragenAuf ? 'zu' : 'auf'}" aria-pressed="${_rueckfragenAuf}">Rückfragen (${EC_PUNKTE.filter(p => ecStatus(_stand, p.id) === 'klaeren').length})</button>
      </div>
    </header>`;

  const hierHtml = _rueckfragenAuf && !_angeheftet ? _rueckfragenHtml() : `<section class="ec-hier">
      <div class="ec-hier-kopf"><span>${_angeheftet ? 'Ausgewählt' : 'Hier gerade'}</span><b>${_esc(_angeheftet ? 'aus der Liste' : (_ortTextAktuell || '—'))}</b>
        ${_angeheftet ? '<button type="button" class="ec-mini" data-loesen="1">Zur Stelle im Tool</button>' : ''}</div>
      ${zeigen.length ? zeigen.map(_karte).join('')
        : `<p class="ec-leer">Zu dieser Stelle gehört keine Aufgabe.${naechste ? ` Nächste offene Pflichtaufgabe: <b>${_esc(naechste.t)}</b>${naechste.wo ? ` (${_esc(naechste.wo)})` : ''}. <button type="button" class="ec-mini" data-zeige="${naechste.id}">Bearbeiten</button>` : ' Alle Pflichtaufgaben sind erledigt.'}</p>`}
    </section>`;

  const hierIds = new Set(hier.map(p => p.phase));
  const liste = `<section class="ec-alle"><h2>Alle Phasen</h2>${EC_PHASEN.map((ph, i) => {
      const z = ecZaehle(_stand, ph.punkte);
      const sichtbar = ph.punkte.filter(p => !_nurOffen || !['erledigt', 'entfaellt'].includes(ecStatus(_stand, p.id)));
      const offen = _offenePhasen.has(ph.id) || (!_angeheftet && hierIds.has(ph.id));
      return `<details data-phase="${ph.id}"${offen ? ' open' : ''}><summary><span class="ec-nr">${String(i).padStart(2, '0')}</span><span>${_esc(ph.titel)}</span><span class="ec-z${z.fertig === z.gesamt ? ' fertig' : ''}">${z.fertig}/${z.gesamt}</span></summary>
        <ul>${sichtbar.length ? sichtbar.map(_zeile).join('') : '<li class="ec-leer">Alles erledigt.</li>'}</ul></details>`;
    }).join('')}</section>`;

  if (alles || !doc.getElementById('ec-hier-ort')) {
    root.innerHTML = `${kopf}<div id="ec-hier-ort">${hierHtml}</div>${liste}`;
  } else {
    const k = root.querySelector('.ec-kopf'); if (k) k.outerHTML = kopf;
    const h = doc.getElementById('ec-hier-ort'); if (h) h.innerHTML = hierHtml;
    const a = root.querySelector('.ec-alle'); if (a) a.outerHTML = liste;
  }
  doc.title = `Checkliste · ${name}`;
  if (ortWechsel) w.scrollTo({ top: 0 });
}

// ── Ereignisse im Fenster ──────────────────────────────────────────────
function _klick(/** @type {Event} */ ev) {
  const t = /** @type {HTMLElement} */ (ev.target).closest?.('button');
  if (!t) return;
  if (t.dataset.status) {
    _setze(t.dataset.id || '', { s: t.dataset.status });
    _zeichnen(false);
  } else if (t.dataset.oeffnen) {
    _imToolOeffnen(t.dataset.oeffnen);
  } else if (t.dataset.zeige) {
    _angeheftet = t.dataset.zeige;
    _zeichnen(false);
    _win?.scrollTo({ top: 0 });
  } else if (t.dataset.loesen) {
    _angeheftet = null;
    _zeichnen(false);
  } else if (t.dataset.rf === 'auf' || t.dataset.rf === 'zu') {
    _rueckfragenAuf = t.dataset.rf === 'auf';
    _angeheftet = null;
    _zeichnen(false);
    _win?.scrollTo({ top: 0 });
  } else if (t.dataset.rf) {
    _rueckfragenAktion(t.dataset.rf);
  }
}

function _aenderung(/** @type {Event} */ ev) {
  const t = /** @type {HTMLInputElement} */ (ev.target);
  if (t.dataset.statusWahl) { _setze(t.dataset.statusWahl, { s: t.value }); _zeichnen(false); }
  else if (t.dataset.adressat) { _setze(t.dataset.adressat, { a: t.value }); _zeichnen(false); }
  else if (t.id === 'ec-folgen') {
    _folgen = t.checked;
    try { localStorage.setItem(FOLGEN_KEY, _folgen ? '1' : '0'); } catch (e) { /* ohne Speicher */ }
    if (_folgen) { _ortSchluessel = ''; _tick(); }
  } else if (t.id === 'ec-nuroffen') { _nurOffen = t.checked; _zeichnen(false); }
}

function _eingabe(/** @type {Event} */ ev) {
  const t = /** @type {HTMLTextAreaElement} */ (ev.target);
  const id = t.dataset?.notiz;
  if (!id) return;
  clearTimeout(_notizTimer[id]);
  _notizTimer[id] = setTimeout(() => _setze(id, { n: t.value }), 400);
  // Beim Verlassen des Feldes nachzeichnen, was während des Tippens liegen blieb
  t.onblur = () => { clearTimeout(_notizTimer[id]); _setze(id, { n: t.value }); setTimeout(() => _zeichnen(false), 0); };
}

function _aufzu(/** @type {Event} */ ev) {
  const d = /** @type {HTMLDetailsElement} */ (ev.target);
  if (!d.dataset?.phase) return;
  if (d.open) _offenePhasen.add(d.dataset.phase); else _offenePhasen.delete(d.dataset.phase);
}

const _CSS = `
:root{--bg:#f4f6f7;--surface:#fff;--surface-2:#f0f3f4;--text:#1b2629;--muted:#5d6b6f;--border:#d5dde0;--brand:#0d5f70;--brand-weak:#e1eef1;--on-brand:#fff;
  --ok:#2f7d4a;--ok-bg:#e4f2e8;--warn:#9a6a00;--warn-bg:#fbf1d6;--crit:#b3261e;--crit-bg:#fbe5e3;--info:#1f5fa8;--info-bg:#e3eefb;--focus:#0d5f70;--r:6px;
  --font-ui:"Segoe UI",system-ui,sans-serif;--font-mono:ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:13.5px/1.45 var(--font-ui)}
button,select,textarea,input{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
#ec-root{display:grid;gap:14px;padding:12px 14px 40px}
#ec-getrennt{position:sticky;top:0;z-index:3;padding:8px 14px;background:var(--warn-bg);color:var(--warn);font-weight:600;border-bottom:1px solid var(--border)}
.ec-kopf{position:sticky;top:0;z-index:2;display:grid;gap:6px;background:var(--bg);padding:6px 0 8px;border-bottom:1px solid var(--border)}
.ec-titel small{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ec-titel b{font-size:16px}
.ec-fs{display:flex;align-items:center;gap:8px}
.ec-balken{flex:1;height:7px;border-radius:4px;background:var(--border);overflow:hidden}
.ec-balken i{display:block;height:100%;background:var(--ok)}
.ec-fs span{font-family:var(--font-mono);font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted)}
.ec-schalter{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--muted)}
.ec-schalter label{display:inline-flex;gap:5px;align-items:center;cursor:pointer}
.ec-hier{display:grid;gap:8px}
.ec-hier-kopf{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
.ec-hier-kopf span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--brand);font-weight:600}
.ec-hier-kopf b{font-weight:600}
.ec-karte{display:grid;gap:6px;background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:var(--r);padding:10px 12px}
.ec-karte.st-arbeit{border-left-color:var(--info)} .ec-karte.st-klaeren{border-left-color:var(--warn)}
.ec-karte.st-erledigt{border-left-color:var(--ok)} .ec-karte.st-entfaellt{border-left-color:var(--muted);opacity:.85}
.ec-kt{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
.ec-chip{font-family:var(--font-mono);font-size:11px;padding:0 5px;border-radius:4px;background:var(--brand-weak);color:var(--brand);white-space:nowrap}
.ec-chip.opt{background:var(--warn-bg);color:var(--warn)} .ec-chip.ext{background:transparent;border:1px solid var(--border);color:var(--muted)}
.ec-wo{font-family:var(--font-mono);font-size:12px;color:var(--brand)}
.ec-ok{font-size:12.5px;color:var(--muted)} .ec-ok span{color:var(--text);font-weight:600}
.ec-seg{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--border);border-radius:var(--r);overflow:hidden;width:max-content;max-width:100%}
.ec-seg button{border:0;border-left:1px solid var(--border);background:var(--surface);padding:4px 9px;font-size:12.5px;cursor:pointer}
.ec-seg button:first-child{border-left:0}
.ec-seg button:hover{background:var(--surface-2)}
.ec-seg button[aria-pressed="true"]{font-weight:600}
.ec-seg button.st-offen[aria-pressed="true"]{background:var(--surface-2)}
.ec-seg button.st-arbeit[aria-pressed="true"]{background:var(--info-bg);color:var(--info)}
.ec-seg button.st-klaeren[aria-pressed="true"]{background:var(--warn-bg);color:var(--warn)}
.ec-seg button.st-erledigt[aria-pressed="true"]{background:var(--ok-bg);color:var(--ok)}
.ec-seg button.st-entfaellt[aria-pressed="true"]{background:var(--surface-2);color:var(--muted);text-decoration:line-through}
.ec-aktionen{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.ec-adr{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12.5px;color:var(--warn);font-weight:600}
.ec-adr select{padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-weight:400;color:var(--text)}
.ec-rf-knopf{margin-left:auto} .ec-rf-knopf[aria-pressed="true"]{background:var(--warn-bg);color:var(--warn);border-color:var(--warn)}
.ec-rf-meldung{font-size:12px;color:var(--ok)}
.ec-rf-grp{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:8px 12px}
.ec-rf-grp h3{margin:0 0 4px;font-size:13px} .ec-rf-grp h3 small{font-family:var(--font-mono);color:var(--muted);font-weight:400}
.ec-rf-grp ol{margin:0;padding-left:20px;display:grid;gap:8px}
.ec-rf-frage{font-size:12.5px;white-space:pre-wrap;color:var(--text)} .ec-rf-frage.leer{color:var(--muted);font-style:italic}
.ec-rf-text{width:100%;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:var(--r);background:var(--surface-2);font-family:var(--font-mono);font-size:12px}
.ec-hin{margin-left:auto}
.ec-tool{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12.5px;padding:4px 8px;border-radius:var(--r);background:var(--surface-2)}
.ec-tool b{font-weight:600}
.ec-punkt{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
i.ec-punkt{margin-right:6px;vertical-align:1px}
.tl-ok .ec-punkt,i.ec-punkt.tl-ok{background:var(--ok)} .ec-tool.tl-ok{background:var(--ok-bg)}
.tl-offen .ec-punkt,i.ec-punkt.tl-offen{background:var(--warn)} .ec-tool.tl-offen{background:var(--warn-bg)}
.tl-veraltet .ec-punkt,i.ec-punkt.tl-veraltet{background:var(--crit)} .ec-tool.tl-veraltet{background:var(--crit-bg)}
.ec-zk{display:flex;gap:4px}
.ec-notiz{width:100%;min-height:52px;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:var(--r);background:var(--surface-2)}
.ec-leer{margin:0;padding:10px 12px;background:var(--surface);border:1px dashed var(--border);border-radius:var(--r);color:var(--muted)}
.ec-alle h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:6px 0}
details{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px}
summary{display:grid;grid-template-columns:24px 1fr auto;gap:6px;padding:7px 10px;cursor:pointer;font-weight:600}
.ec-nr,.ec-z{font-family:var(--font-mono);font-size:12px;color:var(--muted);font-weight:400}
.ec-z.fertig{color:var(--ok)}
details ul{list-style:none;margin:0;padding:0 0 4px}
.ec-zeile{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:8px;align-items:start;padding:6px 10px;border-top:1px solid var(--border)}
.ec-zeile select{width:100%;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-size:12px}
.ec-zeile.st-erledigt .ec-zt span,.ec-zeile.st-entfaellt .ec-zt span{color:var(--muted);text-decoration:line-through}
.ec-zeile.st-arbeit select{color:var(--info)} .ec-zeile.st-klaeren select{color:var(--warn)} .ec-zeile.st-erledigt select{color:var(--ok)}
.ec-zt{display:grid;gap:2px;min-width:0}
.ec-zt em{font-style:normal;font-size:11px;color:var(--warn)}
.ec-zt small{color:var(--brand);font-size:12px;overflow-wrap:anywhere}
.ec-mini{border:1px solid var(--border);background:var(--surface);border-radius:4px;padding:2px 7px;font-size:12px;cursor:pointer;white-space:nowrap}
.ec-mini:hover{border-color:var(--brand)}
`;
