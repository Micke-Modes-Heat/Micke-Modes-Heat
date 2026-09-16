// ── 24-gefuehrter-modus.js — Geführter Modus (Strompfad) ────────────────────
//
// Erstanwender sehen heute im Elektro-Tab rund 96 Bedienelemente gleichzeitig.
// Der geführte Modus zeigt stattdessen je Schritt nur die Werkzeuge, die dort
// gebraucht werden, und prüft am Ende jedes Schritts, ob der Datenstand den
// nächsten trägt.
//
// Grundsätze:
//   • Der Modus ändert NUR die Sichtbarkeit — keine Daten, keine Rechnung.
//     Alles, was ein Schritt anbietet, ruft dieselben Funktionen auf wie der
//     Expertenmodus. Projektdateien bleiben unberührt.
//   • Der Zustand (Schritt, an/aus) liegt in localStorage, NICHT im Projekt:
//     sonst müsste er in die Feldlisten von captureStromNetzState und
//     _buildProjectData eingetragen werden und verschwände dort still.
//   • Die Tore sind weich: „Trotzdem weiter" ist immer möglich. Die Prüfungen
//     in Schritt 3 und 6 sind noch nie an echten Projektdaten gelaufen.
//
// Aufbau: Schrittleiste unter der Kopfleiste + Schrittkarte über dem linken
// Panel. Den Fokus macht _fokusAnwenden(): im linken Panel bleiben nur die
// Abschnitte stehen, die der Schritt in `zeigen` nennt.

import { SCHICHT, setAktiveSchicht } from './lib/schichten.js';
import { bestandPruefen } from './lib/bestand-check.js';
import { autoNetzVoraussetzungen } from './13l-autonetz.js';
import { ASSETS } from './13a-assets-core.js';
import { appLifecycle } from './lib/lifecycle.js';

const LS_KEY  = 'mmh-guide-v1';
const BAR_ID  = 'gm-bar';
const CARD_ID = 'gm-card';

let _an      = false;     // geführter Modus aktiv
let _idx     = 0;         // aktueller Schritt
let _expert  = false;     // Expertenmodus: Führung sichtbar, nichts ausgeblendet
let _manuell = new Set(); // Schritt-IDs, die der Anwender selbst bestätigt hat

// ── Hilfen für die Prüfungen ────────────────────────────────────────────────

const _geb    = () => window.gebaeude || [];
const _assets = () => ASSETS.items || [];
const _edges  = () => window.stromEdges || [];
const _feld   = (id) => (document.getElementById(id)?.value || '').trim();

/** Verbraucher-Asset eines Gebäudes mit hinterlegter Leistung. */
function _hatLast(g) {
  return _assets().some(a => a.type === 'Verbraucher' && a.buildingId === g.id
    && (Number(a.props?.leistungKW) > 0 || Number(a.leistungKW) > 0));
}

/**
 * Referenzjahr aus den Messjahren (23-messjahre-panel.js). Der Lastgang steht
 * als Float32Array in window.elQuartierH — Array.isArray() ist dafuer blind.
 */
function _hatReferenzjahr() { return Number(window.elQuartierH?.length) > 0; }

function _zeile(status, text, aktion = null) { return { status, text, aktion }; }

// ── Die Schritte ────────────────────────────────────────────────────────────
// tab/view/schicht werden beim Betreten gesetzt, `zeigen` filtert das Panel.

export const GUIDE_STEPS = [
  {
    id: 'liegenschaft', titel: 'Liegenschaft anlegen', kurz: 'Liegenschaft',
    ziel: 'Wo und was ist das Projekt?',
    text: 'Suche die Liegenschaft, zieh das Plangebiet auf und lade die Gebäude. Die Projektdaten tragen später das Deckblatt des Gutachtens.',
    tab: 'gebiet', view: 'karte',
    gruppen: [
      { label: 'Gebiet', aktionen: [
        { label: '⬡ Plangebiet zeichnen', click: 'toggleDrawArea()', pri: true },
        { label: '↓ Gebäude aus OSM laden', click: 'showOsmPanel()' },
        { label: '🛰 Satellit', click: 'toggleTile()' },
      ] },
    ],
    pruefe() {
      const n = _geb().length;
      const name = _feld('pd-kaserne-name');
      const we   = _feld('pd-we-nummer');
      return {
        ok: n > 0 && !!name && !!we,
        zeilen: [
          _zeile(n > 0 ? 'ok' : 'offen', n > 0 ? `${n} Gebäude geladen` : 'Noch keine Gebäude'),
          _zeile(name ? 'ok' : 'offen', name ? `Liegenschaft: ${name}` : 'Name der Kaserne fehlt'),
          _zeile(we ? 'ok' : 'offen', we ? `WE-Nummer: ${we}` : 'WE-Nummer fehlt'),
        ],
      };
    },
  },
  {
    id: 'verbrauch', titel: 'Gebäude & Verbrauch', kurz: 'Verbrauch',
    ziel: 'Welche Last hängt am Netz, und stimmt jeder Grundriss?',
    text: 'Prüfe die importierten Gebäude am Grundriss, benenne sie und setze den Nutzungstyp. Das Auto-Befüllen liefert danach einen Schätzwert je Gebäude; der Abgleich gegen den gemessenen Lastgang folgt in Schritt 4.',
    tab: 'gebiet', view: 'karte',
    gruppen: [
      { label: 'Gebäude prüfen', aktionen: [
        { label: '🏢 Gebäudeliste öffnen', click: "setViewMode('gebaeude')", pri: true },
        { label: '📋 Gebäudeliste importieren (CSV)', click: 'openGebListImport()' },
      ] },
      { label: 'Verbrauch', aktionen: [
        { label: '✦ Auto-Befüllen (Verbrauch & PV)', click: 'showAutofillWizard()' },
        { label: '⚡ Strom-Grundlagen: Messjahre', click: 'toggleStromPanel()' },
      ] },
    ],
    pruefe() {
      const g = _geb();
      const ohneName = g.filter(x => !String(x.name || '').trim()).length;
      const ohneLast = g.filter(x => !_hatLast(x)).length;
      const ref = _hatReferenzjahr();
      return {
        ok: g.length > 0 && ohneName === 0 && ohneLast === 0 && ref,
        zeilen: g.length === 0 ? [
          _zeile('offen', 'Noch keine Gebäude geladen — zurück zu Schritt 1'),
          _zeile(ref ? 'ok' : 'offen', ref ? 'Referenzjahr gewählt' : 'Kein Referenz-Lastgang gewählt'),
        ] : [
          _zeile(ohneName === 0 ? 'ok' : 'warn',
            ohneName === 0 ? `Alle ${g.length} Gebäude benannt` : `${ohneName} von ${g.length} Gebäuden ohne Namen`),
          _zeile(ohneLast === 0 ? 'ok' : 'warn',
            ohneLast === 0 ? 'Alle Gebäude mit Verbrauchswert' : `${ohneLast} von ${g.length} Gebäuden ohne Verbraucher`),
          _zeile(ref ? 'ok' : 'offen', ref ? 'Referenzjahr gewählt' : 'Kein Referenz-Lastgang gewählt'),
        ],
        hinweis: 'Ob ein Grundriss wirklich gesichtet wurde, kann das Tool nicht sehen — das bleibt dein Urteil.',
      };
    },
  },
  {
    id: 'bestand', titel: 'Bestandsnetz erfassen', kurz: 'Bestandsnetz',
    ziel: 'Wie ist das Netz heute gebaut?',
    text: 'Zwei Wege führen zum Ziel: den Bestandsplan digitalisieren oder das Netz automatisch erzeugen — dafür zuerst die Trassen aus den OSM-Straßen laden. Oder beides: erst automatisch erzeugen, dann am Plan nachziehen. Alles, was du hier anlegst, landet in der Schicht Bestand.',
    tab: 'elektro', view: 'karte', schicht: SCHICHT.BESTAND,
    zeigen: ['el-sec-netz'],
    gruppen: [
      { label: 'Weg wählen',
        // Ohne NAP, Schaltanlage und Trafo kann das Auto-Netz nichts verdrahten.
        // Das soll man sehen, bevor man den Dialog öffnet.
        hinweis: () => {
          const v = autoNetzVoraussetzungen();
          return v.ok ? null : `Automatisch erzeugen geht erst, wenn auf der Karte liegt: ${v.fehlt.join(', ')}. Über die Komponenten-Palette unten setzen.`;
        },
        aktionen: [
        { label: '📐 Bestandsplan digitalisieren', click: 'pdTogglePanel()', pri: true },
        { label: '↓ Trassen aus OSM-Straßen laden', click: 'loadAndAdoptOsmStrassen()' },
        { label: '⚡ Netz automatisch erzeugen', click: 'showAutoNetzDialog()' },
      ] },
      { label: 'Trassen & Kabel', aktionen: [
        { label: 'Trasse zeichnen', click: "toggleDrawTrasse('strom')" },
        { label: 'Kabel ziehen', click: 'startDrawStromEdge()' },
        { label: 'Einlinienschema', click: 'sldToggle()' },
      ] },
      { label: 'Prüfen', aktionen: [
        { label: '🔍 Bestand prüfen (Details)', click: 'bestandPruefenUndZeigen()' },
      ] },
    ],
    pruefe() {
      const r = bestandPruefen({
        assets: _assets(), edges: _edges(), gebaeude: _geb(),
        heute: new Date().getFullYear(),
      });
      const topo = r.reifegrad.find(s => s.id === 'topologie');
      const lauf = r.reifegrad.find(s => s.id === 'lastfluss');
      return {
        ok: r.zaehler.fehler === 0 && !!topo?.erfuellt,
        zeilen: [
          _zeile(r.zaehler.fehler === 0 ? 'ok' : 'offen',
            r.zaehler.fehler === 0 ? 'Keine Fehler in der Bestandsprüfung' : `${r.zaehler.fehler} Fehler`,
            r.zaehler.fehler ? { label: 'zeigen', click: 'bestandPruefenUndZeigen()' } : null),
          _zeile(r.zaehler.warnung === 0 ? 'ok' : 'warn',
            `${r.zaehler.warnung} Warnungen, ${r.zaehler.hinweis} Hinweise`),
          _zeile(topo?.erfuellt ? 'ok' : 'offen',
            topo?.erfuellt ? 'Netzstruktur trägt das Screening' : `Netzstruktur: ${topo?.fehlt || 'unvollständig'}`),
          _zeile(lauf?.erfuellt ? 'ok' : 'warn',
            lauf?.erfuellt ? 'Lastfluss & Spannungsfall belastbar'
                           : `Engpass-Analyse noch nicht belastbar: ${lauf?.fehlt || ''}`),
        ],
      };
    },
  },
  {
    id: 'anschluss', titel: 'Netzanschluss & Abgleich', kurz: 'Anschluss',
    ziel: 'Was darf der Anschlusspunkt, und stimmen die geschätzten Lasten?',
    text: 'Drei Dinge, der Reihe nach: 1. Den gemessenen Lastgang ansehen — Peak und Grundlast plausibel? 2. Die Grenzen am Netzanschluss eintragen (Max. Bezug und Einspeisung laut Netzanschlussvertrag). 3. Die Bestandskalibrierung starten: Sie verteilt den gemessenen Peak nach Nutzfläche mal Nutzungstyp-Faktor auf die Verbraucher und ersetzt damit die Schätzwerte aus Schritt 2.',
    tab: 'elektro', view: 'analyse', analyse: 'nap',
    zeigen: [],
    gruppen: [
      { label: '1 · Messung ansehen', aktionen: [
        { label: '📈 NAP-Lastgang', click: "setAnalyseSection('nap')", pri: true },
      ] },
      { label: '2 · Grenzen eintragen', aktionen: [
        { label: '🔌 Netzanschluss-Angaben', click: 'sgNaOeffnen()' },
      ] },
      { label: '3 · Lasten abgleichen', aktionen: [
        { label: '🔧 Bestandskalibrierung starten', click: 'napShowKalibrierungDialog()' },
      ] },
    ],
    pruefe() {
      const ref   = _hatReferenzjahr();
      const limit = Number(window.elNapMaxEinspKw) > 0 || Number(_feld('strom-nap-einsp-kw')) > 0;
      const bezug = Number(window.elNapMaxBezugKw) > 0 || Number(_feld('strom-nap-bezug-kw')) > 0;
      const nap   = _assets().some(a => a.type === 'NAP');
      return {
        ok: ref && limit,
        zeilen: [
          _zeile(ref ? 'ok' : 'offen', ref ? 'Referenzjahr liegt vor' : 'Kein Referenz-Lastgang'),
          _zeile(nap ? 'ok' : 'warn', nap ? 'NAP im Netz vorhanden' : 'Kein NAP gesetzt — ohne ihn keine Kalibrierung'),
          _zeile(bezug ? 'ok' : 'warn', bezug ? 'Max. Bezug hinterlegt' : 'Max. Bezug am NAP nicht hinterlegt'),
          _zeile(limit ? 'ok' : 'offen', limit ? 'Einspeiselimit gesetzt' : 'Einspeiselimit fehlt'),
        ],
      };
    },
  },
  {
    id: 'varianten', titel: 'Entwicklung & Varianten', kurz: 'Varianten',
    ziel: 'Was kommt ohnehin, und was wird in dieser Variante entschieden?',
    text: 'Neue Anlagen landen jetzt in der Entscheidungsschicht der aktiven Variante. Für PV gibt es zwei Wege: am Gebäude über „Dach & PV" (Dachform, Belegungs- und Sperrflächen — daraus kommt die kWp) oder als eigenes PV-Asset auf der Karte, das du selbst befüllst oder per Auto-Befüllen zuweist.',
    tab: 'elektro', view: 'karte', schicht: SCHICHT.ENTSCHEIDUNG,
    zeigen: ['el-sec-anlagen'],
    gruppen: [
      { label: 'Variante', aktionen: [
        { label: '+ Variante anlegen', click: 'addVariante()' },
      ] },
      { label: 'PV am Gebäude',
        hinweis: 'Der übliche Weg: Gebäude in der Liste anklicken → Elektro-Assets → Dach & PV. Dachform, Belegungs- und Sperrflächen ergeben die kWp.',
        aktionen: [
          { label: '🏢 Gebäudeliste öffnen', click: 'guideSeitenleisteOeffnen()', pri: true },
          { label: '✦ Auto-Befüllen (Verbrauch & PV)', click: 'showAutofillWizard()' },
        ] },
      { label: 'Einzelne Anlagen setzen', aktionen: [
        { label: '☀ PV-Asset auf die Karte', click: "setPendingType('PV')" },
        { label: '☀ Freifläche zeichnen', click: 'startDrawFF()' },
        { label: '🔋 Batterie-Asset auf die Karte', click: "setPendingType('Batterie')" },
      ] },
      { label: 'Auslegung', aktionen: [
        { label: '📊 PV-Analyse', click: "setAnalyseSection('pva')" },
        { label: '☀ PV-Übersicht', click: 'pvuTogglePanel()' },
      ] },
    ],
    pruefe() {
      const n = [..._assets(), ..._edges()].filter(o => o?.schicht === SCHICHT.ENTSCHEIDUNG).length;
      return {
        ok: n > 0,
        zeilen: [
          _zeile(n > 0 ? 'ok' : 'offen',
            n > 0 ? `${n} geplante Objekte in der Entscheidungsschicht` : 'Noch nichts in der Entscheidungsschicht'),
        ],
        hinweis: 'Die PV-Analyse rechnet live und speichert ihr Ergebnis nicht im Projekt — die gewählte Auslegung von Hand als Anlage eintragen.',
      };
    },
  },
  {
    id: 'pruefen', titel: 'Netz rechnen & prüfen', kurz: 'Netz prüfen',
    ziel: 'Trägt das Netz die Varianten?',
    text: 'Erst rechnen, dann screenen: Die Schwellentreppe prüft Trafos und Einspeisepunkt. „Im Rahmen" heißt dort nicht „nichts zu tun" — die Kabel prüft erst der Engpass-Fahrplan.',
    tab: 'elektro', view: 'karte',
    zeigen: ['el-sec-calc'],
    gruppen: [
      { label: 'Rechnen', aktionen: [
        { label: '⚡ Elektroberechnung starten', click: 'elCalcAssets()', pri: true },
      ] },
      { label: 'Screening', aktionen: [
        { label: '📶 Schwellentreppe', click: 'schwellenPanelToggle()' },
        { label: '⏱ Engpass-Fahrplan', click: 'engpassPanelToggle()' },
        { label: '🔍 Netzanalyse', click: 'naTogglePanel()' },
      ] },
    ],
    pruefe() {
      const stand = window._elErgebnisStand;
      const gerechnet = _edges().some(e => e._calcJahr != null);
      return {
        ok: !!stand || gerechnet,
        zeilen: [
          _zeile(stand || gerechnet ? 'ok' : 'offen',
            stand || gerechnet ? 'Elektroberechnung liegt vor' : 'Noch nicht gerechnet'),
          _zeile('warn', 'Screening je Variante durchsehen — das Fazit steht im Panel der Schwellentreppe',
            { label: 'öffnen', click: 'schwellenPanelToggle()' }),
        ],
      };
    },
  },
  {
    id: 'ergebnisse', titel: 'Ergebnisse & Vergleich', kurz: 'Ergebnisse',
    ziel: 'Was folgt daraus?',
    text: 'Drei Blickwinkel: das Ergebnis je Variante, die Planungsvarianten nebeneinander und die PV-Auslegung mit ihren fünf festen Varianten.',
    tab: 'elektro', view: 'karte',
    zeigen: ['el-sec-auswerten'],
    manuell: 'Ergebnisse gesichtet',
    gruppen: [
      { label: 'Je Variante', aktionen: [
        { label: '📄 Ergebnisblatt', click: 'ergebnisblattToggle()', pri: true },
        { label: '💶 Investitionsplan', click: 'showInvestitionsplan()' },
      ] },
      { label: 'Nebeneinander', aktionen: [
        { label: '⇄ Varianten vergleichen', click: 'variantenVergleichToggle()' },
        { label: '📊 PV-Analyse', click: "setAnalyseSection('pva')" },
        { label: '⚡ Analyse: Strom', click: "setAnalyseSection('strom')" },
      ] },
    ],
  },
  {
    id: 'gutachten', titel: 'Gutachten', kurz: 'Gutachten',
    ziel: 'Ins Dokument bringen',
    text: 'Abbildungen und Text stehen im Gutachten-Reiter, die Bilder der Liegenschaft daneben. Am Ende das Projekt sichern.',
    tab: 'elektro', view: 'analyse', analyse: 'ggrafik',
    zeigen: [],
    manuell: 'Gutachten exportiert',
    gruppen: [
      { label: 'Dokument', aktionen: [
        { label: '📝 Gutachten', click: "setAnalyseSection('ggrafik')", pri: true },
        { label: '🗺️ Liegenschaftsbilder', click: "setAnalyseSection('liegenschaftsbilder')" },
        { label: '📝 Kennzahlen-Digest', click: 'exportGutachtenDigest()' },
      ] },
      { label: 'Sichern', aktionen: [
        { label: '💾 Projekt speichern', click: 'saveProject()' },
      ] },
    ],
  },
];

// ── Zustand ─────────────────────────────────────────────────────────────────

function _laden() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    _an      = !!s.an;
    _idx     = Math.min(Math.max(0, s.idx | 0), GUIDE_STEPS.length - 1);
    _expert  = !!s.expert;
    _manuell = new Set(Array.isArray(s.manuell) ? s.manuell : []);
  } catch { /* localStorage gesperrt — Standardwerte behalten */ }
}

function _sichern() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      an: _an, idx: _idx, expert: _expert, manuell: [..._manuell],
    }));
  } catch { /* nicht schlimm: der Modus ist dann nur nicht dauerhaft */ }
}

/** Prüfergebnis eines Schritts — inklusive manueller Bestätigung. */
export function guideStatus(i) {
  const step = GUIDE_STEPS[i];
  if (!step) return { ok: false, zeilen: [] };
  if (step.manuell) {
    const ok = _manuell.has(step.id);
    return { ok, zeilen: [_zeile(ok ? 'ok' : 'offen', ok ? step.manuell : 'Noch nicht bestätigt')], manuell: true };
  }
  try { return step.pruefe(); }
  catch (e) {
    console.warn('[Geführter Modus] Prüfung fehlgeschlagen:', step.id, e);
    return { ok: false, zeilen: [_zeile('warn', 'Prüfung nicht möglich')] };
  }
}

// ── Steuerung ───────────────────────────────────────────────────────────────

export function guideToggle() { if (_an) guideStop(); else guideStart(); }

/** Das linke Panel traegt die Schrittkarte — eingeklappt waere die Fuehrung unsichtbar. */
function _panelOeffnen() {
  const lp = document.getElementById('left-panel');
  if (!lp || !lp.classList.contains('collapsed')) return;
  // toggleLeftPanel() kippt einen Modulzustand, der dem DOM entgegenstehen
  // kann (initResponsiveLayout klappt beim Start zu). Darum bis zu zweimal.
  for (let i = 0; i < 2 && lp.classList.contains('collapsed'); i++) {
    try { window.toggleLeftPanel?.(); } catch { break; }
  }
}

/**
 * Rechte Seitenleiste öffnen: „Dach & PV" steht je Gebäude unter
 * Elektro-Assets in der Gebäudeliste, nicht in einem eigenen Panel.
 */
export function guideSeitenleisteOeffnen() {
  const sb = document.getElementById('sidebar');
  if (sb?.classList.contains('collapsed')) window.toggleSidebar?.();
  window.showHint?.('Gebäude in der Liste anklicken → Elektro-Assets → Dach & PV');
}

export function guideStart() {
  _an = true; _sichern();
  document.body.classList.add('gm-an');
  _panelOeffnen();
  guideGoTo(_idx, true);
}

export function guideStop() {
  _an = false; _sichern();
  document.body.classList.remove('gm-an', 'gm-fokus');
  _fokusLoesen();
  document.getElementById(BAR_ID)?.remove();
  document.getElementById(CARD_ID)?.remove();
}

/** Expertenmodus: Schrittleiste bleibt, aber nichts wird ausgeblendet. */
export function guideSetExpert(an) {
  _expert = an === undefined ? !_expert : !!an;
  _sichern();
  guideRender();
}

export function guideGoTo(i, sanft = false) {
  _idx = Math.min(Math.max(0, Number(i) || 0), GUIDE_STEPS.length - 1);
  _sichern();
  const step = GUIDE_STEPS[_idx];

  // Der Schritt stellt die Umgebung selbst ein — das ist der halbe Zweck.
  try {
    if (step.view && typeof window.setViewMode === 'function') window.setViewMode(step.view);
    if (step.analyse && typeof window.setAnalyseSection === 'function') window.setAnalyseSection(step.analyse);
    if (step.tab && typeof window.setLeftTab === 'function') window.setLeftTab(step.tab);
    if (step.schicht) { setAktiveSchicht(step.schicht); window.schichtBarRender?.(); }
  } catch (e) { console.warn('[Geführter Modus] Schrittwechsel:', e); }

  guideRender();
  // Ansichtswechsel und Panel-Animation brauchen einen Moment; danach steht
  // erst fest, ob die Karte andocken kann oder schweben muss.
  setTimeout(guideRender, 350);
  if (!sanft) document.getElementById(CARD_ID)?.scrollIntoView({ block: 'nearest' });
}

export function guideNext() {
  if (_idx >= GUIDE_STEPS.length - 1) { guideRender(); return; }
  guideGoTo(_idx + 1);
}

export function guideBack() { if (_idx > 0) guideGoTo(_idx - 1); }

/** Manuelles Häkchen für Schritte ohne automatische Prüfung. */
export function guideBestaetigen(id) {
  if (_manuell.has(id)) _manuell.delete(id); else _manuell.add(id);
  _sichern();
  guideRender();
}

// ── Fokus: im linken Panel nur die Abschnitte des Schritts ──────────────────

function _fokusLoesen() {
  document.querySelectorAll('.gm-aus').forEach(el => {
    el.classList.remove('gm-aus');
    el.style.display = el.dataset.gmDisplay || '';
    delete el.dataset.gmDisplay;
  });
}

function _fokusAnwenden() {
  _fokusLoesen();
  if (!_an || _expert) return;
  const step = GUIDE_STEPS[_idx];
  if (!Array.isArray(step.zeigen)) return;   // kein Filter: Tab bleibt vollständig

  const panel = document.querySelector('.lp-content.active');
  if (!panel) return;
  const erlaubt = new Set(step.zeigen);

  [...panel.children].forEach(el => {
    // Eine Abschnitts-Überschrift gehört zu dem Block, den sie auf- und zuklappt.
    const ziel = el.dataset?.click?.match(/toggleSection\('([^']+)'\)/)?.[1];
    const sichtbar = (el.id && erlaubt.has(el.id)) || (ziel && erlaubt.has(ziel));
    if (sichtbar) return;
    el.dataset.gmDisplay = el.style.display || '';
    el.style.display = 'none';
    el.classList.add('gm-aus');
  });
}

// ── Darstellung ─────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _barHtml() {
  const knoepfe = GUIDE_STEPS.map((s, i) => {
    const st = guideStatus(i);
    const klasse = i === _idx ? 'on' : (st.ok ? 'done' : 'fut');
    const marke  = st.ok && i !== _idx ? '✓' : String(i + 1);
    return `<button class="gm-st ${klasse}" data-click="guideGoTo(${i})" title="${_esc(s.ziel)}">
      <span class="gm-d">${marke}</span>${_esc(s.kurz || s.titel)}</button>`;
  }).join('<span class="gm-line"></span>');

  return `<div class="gm-steps">${knoepfe}</div>
    <label class="gm-expert" title="Alles einblenden — die Schrittleiste bleibt">
      <input type="checkbox" ${_expert ? 'checked' : ''} data-change="guideSetExpert(this.checked)"> Expertenmodus
    </label>
    <button class="gm-exit" data-click="guideStop()" title="Führung beenden">✕</button>`;
}

function _kartenHtml() {
  const step = GUIDE_STEPS[_idx];
  const st   = guideStatus(_idx);

  const gruppen = (step.gruppen || []).map(g => {
    const hinweis = typeof g.hinweis === 'function' ? g.hinweis() : g.hinweis;
    return `
    <div class="gm-group">
      <div class="gm-glabel">${_esc(g.label)}</div>
      ${g.aktionen.map(a => `<button class="gm-tool${a.pri ? ' pri' : ''}" data-click="${_esc(a.click)}">${_esc(a.label)}</button>`).join('')}
      ${hinweis ? `<div class="gm-ghint">${_esc(hinweis)}</div>` : ''}
    </div>`;
  }).join('');

  const zeilen = (st.zeilen || []).map(z => {
    const ic = z.status === 'ok' ? '✓' : z.status === 'warn' ? '!' : '○';
    const aktion = z.aktion
      ? `<button class="gm-mini" data-click="${_esc(z.aktion.click)}">${_esc(z.aktion.label)}</button>` : '';
    return `<div class="gm-row is-${z.status}"><span class="gm-ic">${ic}</span><span>${_esc(z.text)}</span>${aktion}</div>`;
  }).join('');

  const manuell = step.manuell ? `
    <label class="gm-check"><input type="checkbox" ${_manuell.has(step.id) ? 'checked' : ''}
      data-change="guideBestaetigen('${step.id}')"> ${_esc(step.manuell)}</label>` : '';

  const letzter = _idx === GUIDE_STEPS.length - 1;
  const weiter  = letzter ? 'Führung beenden' : `Weiter: ${_esc(GUIDE_STEPS[_idx + 1].titel)} →`;
  const klick   = letzter ? 'guideStop()' : 'guideNext()';

  return `
    <div class="gm-kicker">Schritt ${_idx + 1} von ${GUIDE_STEPS.length}</div>
    <h4 class="gm-titel">${_esc(step.titel)}</h4>
    <p class="gm-text">${_esc(step.text)}</p>
    ${step.schicht ? `<span class="gm-layer">Schicht: ${step.schicht === SCHICHT.BESTAND ? 'Bestand' : 'Entscheidung'} · automatisch</span>` : ''}
    ${gruppen}
    <div class="gm-gate">
      <div class="gm-gate-t">Prüfung vor dem nächsten Schritt</div>
      ${zeilen}
      ${manuell}
      ${st.hinweis ? `<div class="gm-hint">${_esc(st.hinweis)}</div>` : ''}
    </div>
    <div class="gm-foot">
      <div class="gm-nav">
        <button class="gm-back" data-click="guideBack()" ${_idx === 0 ? 'disabled' : ''}>← Zurück</button>
        <button class="gm-next${st.ok ? ' bereit' : ''}" data-click="${klick}">${weiter}</button>
      </div>
      ${st.ok || letzter ? '' : '<button class="gm-skip" data-click="guideNext()">Offene Punkte später klären und trotzdem weiter</button>'}
    </div>`;
}

export function guideRender() {
  if (!_an) return;

  // Schrittleiste: eigene Zeile unter der Kopfleiste, damit sie nicht mit den
  // Ansichts-Reitern um den Platz streitet.
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.className = 'gm-bar';
    document.querySelector('header')?.insertAdjacentElement('afterend', bar);
  }
  bar.innerHTML = _barHtml();

  // Schrittkarte über dem linken Panel, an der Stelle der Tab-Leiste.
  let card = document.getElementById(CARD_ID);
  if (!card) {
    card = document.createElement('div');
    card.id = CARD_ID;
    card.className = 'gm-card';
  }
  card.innerHTML = _kartenHtml();

  // In der Analyse-Ansicht gibt es kein linkes Panel — dort würde die Führung
  // sonst genau da verschwinden, wo gearbeitet wird. Also schwebt die Karte.
  const lp    = document.getElementById('left-panel');
  // Nicht die Panelbreite messen: die Schrittkarte steckt selbst im Panel und
  // beeinflusst dessen Breite — das schaukelt sich auf. Stattdessen die
  // Kartenansicht prüfen; in Analyse, Gebäudeliste & Co. gibt es kein Panel.
  const karte = document.getElementById('map');
  const kartenAnsicht = !!karte && !!karte.offsetParent && karte.offsetWidth > 0;
  const lpDa  = kartenAnsicht && !!lp && !lp.classList.contains('collapsed');
  const ziel  = lpDa ? (document.getElementById('lp-tabs') || lp) : document.body;
  card.classList.toggle('gm-float', !lpDa);
  if (card.parentElement !== ziel) {
    if (!lpDa) document.body.appendChild(card);
    else if (ziel.id === 'lp-tabs') ziel.insertAdjacentElement('afterend', card);
    else ziel.prepend(card);
  }

  document.body.classList.toggle('gm-fokus', !_expert);
  _fokusAnwenden();
}

// ── Start ───────────────────────────────────────────────────────────────────

export function guideInit() {
  _laden();
  if (!_an) return;
  guideStart();
  // initResponsiveLayout() laeuft ebenfalls beim Start und kann das linke
  // Panel danach zuklappen — dann waere die Schrittkarte unsichtbar.
  setTimeout(_panelOeffnen, 600);
}

// Tore und Schrittleiste aktuell halten, solange die Führung läuft.
appLifecycle.interval(() => { if (_an && document.getElementById(CARD_ID)) guideRender(); }, 4000);

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guideInit);
  else setTimeout(guideInit, 0);
}
