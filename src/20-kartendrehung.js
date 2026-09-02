// ── 20-kartendrehung.js — VERSUCH: die Leaflet-Arbeitskarte drehen ──────────
// Gegenstück zur Plandrehung in 18-liegenschaftsbilder.js: dort wird nur das
// gezeichnete Blatt gedreht, hier die echte Karte, auf der geplant wird — damit
// eine schräg liegende Liegenschaft (Hauptachse nicht Nord–Süd) schon während
// der Planung gerade steht.
//
// Umgesetzt mit dem Plugin `leaflet-rotate` (in index.html geladen, im
// Einzeldatei-Build eingebettet). Das Plugin ersetzt eine Reihe von
// L.Map-Methoden (containerPointToLayerPoint, getBounds, _initPanes …), delegiert
// aber in JEDER davon an das Original zurück, solange `map.options.rotate`
// falsch ist. Deshalb ist dieser Versuch bewusst **standardmäßig aus** und muss
// pro Arbeitsplatz eingeschaltet werden:
//
//   • Der Schalter liegt in localStorage (KD_AKTIV_KEY) und wird NUR beim
//     Anlegen der Karte gelesen (02b-gebaeude.js) — `options.rotate` lässt sich
//     nachträglich nicht umstellen, die Panes werden einmalig aufgebaut. Ein-
//     und Ausschalten braucht daher einen Seiten-Neustart.
//   • Ist er aus, verhält sich die App exakt wie vorher: das Plugin ist zwar
//     geladen, aber jede seiner Überschreibungen fällt auf die Originalmethode
//     zurück.
//
// Bewusst OHNE Imports aus dem App-Kern (dieses Modul wird von 02b-gebaeude.js
// importiert und muss ein Blatt im Importgraph bleiben, sonst wächst der
// Altkern-Zyklus in tests/import-architecture.test.js). Alles Weitere über
// window.* zur Laufzeit.

const KD_AKTIV_KEY = 'kartendrehung.aktiv';
const KD_WINKEL_KEY = 'kartendrehung.winkel';

/**
 * ⚠ Fehlende Stelle im Plugin, hier nachgerüstet.
 *
 * `leaflet-rotate` hängt in `_initPanes()` nur die SECHS Standard-Panes in den
 * Dreh-Container (tilePane/overlayPane drehen mit, shadow/marker/tooltip/popup
 * bleiben aufrecht). Seine eigene `createPane`-Überschreibung, die alle weiteren
 * Panes ebenfalls in den rotatePane hängen würde, ist im Paket auskommentiert
 * (dist/leaflet-rotate-src.js). Eigene Panes der App landen deshalb über
 * Leaflets Standardverhalten im `mapPane` — also NEBEN dem Dreh-Container.
 *
 * Betroffen sind genau die Ebenen, die Geometrie zeigen:
 *   • `netzPane`     — Wärmeleitungen + Stromkabel (02b-gebaeude.js)
 *   • `pvPane`       — PV-Flächen und Modulraster (03a-erzeuger.js, 03c-gebaeude-io.js)
 *   • `bulkBoxPane`  — Auswahlrahmen (14d-selektion.js)
 *
 * Ohne diesen Patch drehen sich Kacheln und Gebäude, das Netz aber nicht — es
 * liegt dann schräg über den Gebäuden statt in den Straßen.
 *
 * Der Patch greift NUR bei gedrehter Karte und nur für Panes ohne ausdrücklich
 * angegebenen Eltern-Container: die Aufrufe aus `_initPanes()` übergeben ihren
 * Container selbst und laufen unverändert durch.
 */
if (typeof L !== 'undefined' && !L.Map.prototype.__kdCreatePanePatched) {
  const createPaneOriginal = L.Map.prototype.createPane;
  // Panes, die bewusst NICHT mitdrehen (Symbole/Beschriftungen sollen aufrecht
  // bleiben) bzw. die Dreh-Container selbst.
  const KD_OHNE_DREHUNG = new Set([
    'mapPane', 'rotatePane', 'norotatePane', 'shadowPane', 'markerPane', 'tooltipPane', 'popupPane',
  ]);
  L.Map.prototype.createPane = function(name, container) {
    if (!this._rotate || container || !this._rotatePane || KD_OHNE_DREHUNG.has(name)) {
      return createPaneOriginal.call(this, name, container);
    }
    return createPaneOriginal.call(this, name, this._rotatePane);
  };
  L.Map.prototype.__kdCreatePanePatched = true;
}

function kdLies(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; }
  catch (e) { void e; return fallback; }
}
function kdSchreib(key, wert) {
  try { localStorage.setItem(key, String(wert)); } catch (e) { void e; }
}

/** Auf ±180 normierter, ganzzahliger Winkel — oder null, wenn unbrauchbar. */
function kdWinkelWert(val) {
  let n = Math.round(parseFloat(val));
  if (!isFinite(n)) return null;
  n = ((n % 360) + 360) % 360;
  return n > 180 ? n - 360 : n;
}

/** Ist der Versuch für diesen Arbeitsplatz eingeschaltet? (gespeicherter Wunsch) */
export function kdVersuchGewuenscht() {
  return kdLies(KD_AKTIV_KEY, '0') === '1';
}

/** Zuletzt eingestellter Drehwinkel (Grad, im Uhrzeigersinn wie beim Lageplan). */
export function kdGespeicherterWinkel() {
  return kdWinkelWert(kdLies(KD_WINKEL_KEY, '0')) || 0;
}

/**
 * Karten-Optionen für `L.map(...)` in 02b-gebaeude.js. Die drei zusätzlichen
 * Handler des Plugins sind absichtlich AUS: `rotateControl` würde ein eigenes
 * Kompass-Bedienelement in die Karte legen (das u. a. im Kartenscreenshot
 * mitlanden würde), `shiftKeyRotate` und `touchRotate` würden Umschalt+Mausrad
 * bzw. Zwei-Finger-Gesten belegen — beides in dieser App bereits vergeben bzw.
 * zu leicht versehentlich auszulösen. Gedreht wird ausschließlich über das
 * Bedienfeld unter „Ansicht".
 */
export function kdMapOptionen() {
  const an = kdVersuchGewuenscht();
  return {
    rotate: an,
    bearing: an ? kdGespeicherterWinkel() : 0,
    rotateControl: false,
    shiftKeyRotate: false,
    touchRotate: false,
  };
}

/** Läuft die Drehung auf der AKTUELLEN Karte (nicht nur gespeichert)? */
export function kdAktiv() {
  return !!(window.map && window.map.options && window.map.options.rotate
    && typeof window.map.setBearing === 'function');
}

/** Aktueller Kartenwinkel, auf ±180 normiert (0, wenn der Versuch aus ist). */
export function kdWinkel() {
  if (!kdAktiv()) return 0;
  return kdWinkelWert(window.map.getBearing()) || 0;
}

/**
 * Sichtbarer Kartenausschnitt in derselben Lesart, die der Vektor-Lageplan
 * verwendet: Mitte + Spannweiten der (ggf. gedrehten) Fläche, NICHT das
 * Nord-oben-Hüllrechteck. Aus Kartenmitte, Zoomstufe und Fenstergröße gerechnet
 * statt aus `map.getBounds()` — das liefert bei gedrehter Karte die Hülle der
 * vier gedrehten Ecken und wäre damit deutlich zu groß.
 */
export function kdSichtAusschnitt() {
  const map = window.map;
  if (!map || typeof map.getCenter !== 'function') return null;
  const c = map.getCenter(), size = map.getSize();
  // Meter je Bildschirmpixel auf dieser Zoomstufe und Breite (Web-Mercator)
  const mpp = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);
  const halbBreiteM = size.x / 2 * mpp, halbHoeheM = size.y / 2 * mpp;
  const R = 6371000;
  const dLat = halbHoeheM / R * (180 / Math.PI);
  const dLng = halbBreiteM / (R * Math.cos(c.lat * Math.PI / 180)) * (180 / Math.PI);
  return { south: c.lat - dLat, north: c.lat + dLat, west: c.lng - dLng, east: c.lng + dLng };
}

/* ── Bedienfeld (im „Ansicht"-Panel, Container #kd-panel aus index.html) ──── */

let _kdAchse = null;    // null | { p1: {lat,lng}|null, handler }
let _kdHinweis = '';

const KD_BTN = 'padding:4px 9px;border-radius:12px;border:1px solid rgba(255,255,255,.14);'
  + 'background:transparent;color:var(--muted);font-family:inherit;font-size:10px;cursor:pointer;white-space:nowrap;';

function kdSchnellBtn(v, label, aktuell) {
  const an = aktuell === v;
  return `<button data-click="kdSetWinkel(${v})" title="Karte auf ${v}° drehen"
    style="${KD_BTN}${an ? 'border-color:#ba68c8;background:rgba(186,104,200,.16);color:#ce93d8;' : ''}">${label}</button>`;
}

export function kdRenderPanel() {
  const el = document.getElementById('kd-panel');
  if (!el) return;
  const gewuenscht = kdVersuchGewuenscht();
  const laeuft = kdAktiv();
  const w = laeuft ? kdWinkel() : kdGespeicherterWinkel();

  let html = `<label class="ebp-row" title="Dreht die Arbeitskarte selbst. Versuchsfunktion — schaltet erst nach einem Neustart der Seite um, weil Leaflet die Kartenebenen nur beim Anlegen aufbaut.">
    <input type="checkbox" class="ebp-cb" ${gewuenscht ? 'checked' : ''} data-change="kdSetVersuch(this.checked)">Drehbare Karte (Versuch)</label>`;

  if (gewuenscht !== laeuft) {
    html += `<div style="font-size:10px;color:#ffcc80;margin:4px 0 6px;line-height:1.35;">
      ${gewuenscht ? 'Wird nach einem Neustart der Seite aktiv.' : 'Bleibt bis zum Neustart der Seite aktiv.'}
      <button data-click="kdNeuLaden()" style="${KD_BTN}margin-left:4px;">Jetzt neu laden</button></div>`;
  }

  if (laeuft) {
    html += `
    <div style="display:flex;align-items:center;gap:6px;margin:6px 0 4px;">
      <input type="range" min="-180" max="180" step="1" value="${w}" style="flex:1;min-width:80px;"
        data-input="kdWinkelVorschau(this.value)" data-change="kdSetWinkel(this.value)">
      <input id="kd-winkel-zahl" type="number" min="-180" max="180" step="1" value="${w}"
        data-change="kdSetWinkel(this.value)"
        style="width:52px;padding:3px 4px;border-radius:4px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--text,#e8eaed);font-family:inherit;font-size:10px;">
      <span style="font-size:10px;color:var(--muted);">°</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;">
      ${kdSchnellBtn(0, 'Nord oben', w)}${kdSchnellBtn(-45, '−45°', w)}${kdSchnellBtn(-90, '−90°', w)}${kdSchnellBtn(45, '+45°', w)}${kdSchnellBtn(90, '+90°', w)}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;">
      ${_kdAchse
        ? `<button data-click="kdAbbrechenAchse()" style="${KD_BTN}border-color:rgba(239,83,80,.4);color:#ef5350;">Achsenwahl abbrechen</button>`
        : `<button data-click="kdStartAchse()" title="Zwei Punkte auf der Karte anklicken (z. B. Anfang und Ende der Hauptstraße) — die Karte dreht sich so, dass diese Achse senkrecht steht. Dieses Panel schließt sich dafür; die Anleitung steht dann in der Hinweiszeile." style="${KD_BTN}">📐 An Achse ausrichten</button>`}
      <button data-click="kdAnLageplan()" title="Denselben Winkel wie der Vektor-Lageplan in „Liegenschaftsbilder“ verwenden" style="${KD_BTN}">↔ Wie Lageplan</button>
    </div>`;
  }

  if (_kdHinweis) html += `<div style="font-size:10px;color:#ffcc80;margin-top:5px;line-height:1.35;">${_kdHinweis}</div>`;
  el.innerHTML = html;
}

function kdSag(text) { _kdHinweis = text || ''; kdRenderPanel(); }

/* ── Bedienhandler ────────────────────────────────────────────────────────── */

window.kdSetVersuch = (on) => {
  kdSchreib(KD_AKTIV_KEY, on ? '1' : '0');
  _kdHinweis = '';
  kdRenderPanel();
};
window.kdNeuLaden = () => { location.reload(); };

/** Winkel setzen (Karte drehen + merken). */
window.kdSetWinkel = (val) => {
  const w = kdWinkelWert(val);
  if (w == null || !kdAktiv()) return;
  window.map.setBearing(w);
  kdSchreib(KD_WINKEL_KEY, w);
  _kdHinweis = '';   // alte Meldung (z. B. der Achsenwahl) gehört nicht zu einem neuen Winkel
  kdRenderPanel();
};
/**
 * Live-Vorschau beim Ziehen am Regler: dreht die Karte, baut aber das Bedienfeld
 * NICHT neu auf — ein innerHTML-Neuaufbau würde dem Regler mitten in der
 * Mausbewegung den Fokus entziehen (gleiche Falle wie beim Lageplan-Regler).
 */
window.kdWinkelVorschau = (val) => {
  const w = kdWinkelWert(val);
  if (w == null || !kdAktiv() || w === kdWinkel()) return;
  window.map.setBearing(w);
  kdSchreib(KD_WINKEL_KEY, w);
  const zahl = document.getElementById('kd-winkel-zahl');
  if (zahl) zahl.value = w;
};

/** Winkel des Vektor-Lageplans übernehmen (gleiche Vorzeichen-Konvention). */
window.kdAnLageplan = () => {
  const w = typeof window.lpAktuelleDrehung === 'function' ? window.lpAktuelleDrehung() : 0;
  window.kdSetWinkel(w);
  kdSag(`Karte auf die Drehung des Lageplans gesetzt (${w > 0 ? '+' : ''}${w}°).`);
};

/**
 * Zwei Klicks auf die Karte legen die Achse fest, die senkrecht stehen soll.
 *
 * Drei Dinge, die hier nicht offensichtlich sind:
 *
 * 1) Das „Ansicht"-Panel, in dem der Knopf sitzt, liegt über einem
 *    bildschirmfüllenden Backdrop (`#ebenen-backdrop`, index.html). Solange der
 *    da ist, landet JEDER Kartenklick auf dem Backdrop, der nur das Panel
 *    schließt — die Karte bekommt nichts davon mit. Deshalb wird das Panel beim
 *    Start der Achsenwahl selbst geschlossen und die Anleitung stattdessen über
 *    die normale Hinweiszeile der App (`showHint`) angezeigt.
 * 2) Gehört wird auf dem Karten-Container in der CAPTURE-Phase, nicht über
 *    `map.on('click')`: Leaflet liefert Klicks auf Gebäude-Polygone oder
 *    Asset-Marker gar nicht erst als Kartenklick aus, und genau solche Punkte
 *    will man beim Ausrichten oft treffen. `stopPropagation()` hält den Klick
 *    zugleich von den übrigen Werkzeugen der App fern (kein versehentliches
 *    Auswählen/Abwählen während der Achsenwahl).
 * 3) Ein Ziehen der Karte endet ebenfalls mit einem `click`-Ereignis. Über die
 *    beim Mausdruck gemerkte Position wird alles mit mehr als 4 px Weg als
 *    Verschieben gewertet und ignoriert — Verschieben bleibt also möglich.
 */
window.kdStartAchse = () => {
  if (!kdAktiv() || _kdAchse) return;

  // Karte muss sichtbar sein — der Knopf ist auch aus anderen Ansichten erreichbar.
  const mapEl = window.map.getContainer();
  if (!mapEl.getBoundingClientRect().width && typeof window.setViewMode === 'function') {
    window.setViewMode('karte');
  }
  // Ansicht-Panel schließen (s. Punkt 1 oben)
  if (document.getElementById('ebenen-backdrop')?.style.display !== 'none'
      && typeof window.toggleEbenenPanel === 'function') {
    window.toggleEbenenPanel();
  }

  const zeigen = (text) => {
    kdSag(text);                                   // fürs Panel, wenn es wieder geöffnet wird
    window.showHint?.(text + '  ·  Abbrechen mit Esc', 0);
  };

  let start = null;
  const onDown = (evt) => { start = { x: evt.clientX, y: evt.clientY }; };
  const onClick = (evt) => {
    if (!_kdAchse) return;
    if (start && Math.hypot(evt.clientX - start.x, evt.clientY - start.y) > 4) return; // Verschieben
    evt.preventDefault();
    evt.stopPropagation();
    const ll = window.map.mouseEventToLatLng(evt);
    if (!_kdAchse.p1) {
      _kdAchse.p1 = ll;
      zeigen('📐 Zweiter Punkt der Achse: das andere Ende anklicken.');
      return;
    }
    const w = kdAchsenWinkel(_kdAchse.p1, ll);
    window.kdAbbrechenAchse();
    if (w == null) { window.showHint?.('Die beiden Punkte liegen zu dicht beieinander.', 4000); return; }
    window.kdSetWinkel(w);
    const meldung = `Karte an der gewählten Achse ausgerichtet (${w > 0 ? '+' : ''}${w}°).`;
    kdSag(meldung);
    window.showHint?.(meldung, 4000);
  };
  const onKey = (evt) => { if (evt.key === 'Escape') window.kdAbbrechenAchse(); };

  _kdAchse = { p1: null, mapEl, onDown, onClick, onKey, cursor: mapEl.style.cursor };
  mapEl.addEventListener('mousedown', onDown, true);
  mapEl.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey);
  mapEl.style.cursor = 'crosshair';
  zeigen('📐 Ersten Punkt der Achse auf der Karte anklicken (z. B. Anfang der Hauptstraße).');
};

window.kdAbbrechenAchse = () => {
  if (_kdAchse) {
    const { mapEl, onDown, onClick, onKey, cursor } = _kdAchse;
    mapEl.removeEventListener('mousedown', onDown, true);
    mapEl.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey);
    mapEl.style.cursor = cursor || '';
    _kdAchse = null;
    window.hideHint?.();
  }
  kdSag('');
};

/**
 * Drehwinkel, der die Achse A→B senkrecht stellt — identisch zu lpAchsenWinkel()
 * in 18-liegenschaftsbilder.js (bewusst dupliziert statt importiert: beide Module
 * sollen Blätter im Importgraph bleiben und keine gegenseitige Kante bekommen).
 */
function kdAchsenWinkel(a, b) {
  const R = 6371000;
  const latRef = (a.lat + b.lat) / 2 * Math.PI / 180;
  const du = (b.lng - a.lng) * Math.PI / 180 * R * Math.cos(latRef);   // nach Osten
  const dv = -(b.lat - a.lat) * Math.PI / 180 * R;                     // nach Süden
  if (Math.hypot(du, dv) < 1) return null;
  let deg = Math.atan2(du, dv) * 180 / Math.PI;
  if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
  return Math.round(deg);
}

// Bedienfeld einmal aufbauen, sobald das DOM steht. Das Modul wird sehr früh
// geladen (02b-gebaeude.js importiert es für die Karten-Optionen), im
// Vite-Dev-Modus also möglicherweise noch vor dem fertigen Body.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', kdRenderPanel, { once: true });
} else {
  kdRenderPanel();
}
