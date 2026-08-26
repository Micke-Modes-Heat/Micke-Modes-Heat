// ── 15-plan-digitalisierer.js — Bestandsplan als Eingabefläche ──────────────
//
// Papier-Einlinienpläne (Bild/PDF) sind schematisch, nicht maßstäblich. Sie
// liefern genau drei Dinge, die beim Bestandsaufbau die Arbeit machen:
//   • Topologie      — wer hängt an wem
//   • Kabelangaben   — Typ + Querschnitt ("NYY-J 5x70"), teils Länge
//   • Bezeichnungen  — "Gebäude 13", "Station IV", "KV 50"
//
// Geometrie liefern sie NICHT — und brauchen sie auch nicht zu: addStromEdge()
// routet selbst über die Trassen und rechnet die Länge. Deshalb ist der Plan
// hier kein Hintergrundbild einer Ausgabe, sondern eine Eingabefläche:
// Gebäude bzw. Betriebsmittel auf dem Plan verorten, Kabel dazwischen ziehen.
// „Übernehmen" materialisiert daraus Assets + stromEdges auf der Karte.
//
// Der Plan bleibt danach als Checkliste erhalten (grün = übernommen), damit
// beim Nacharbeiten großer Bestandspläne nichts doppelt oder gar nicht landet.
//
// Bewusst NICHT: ein Overlay hinter dem Einlinienschema (13f-sld.js). Dessen
// Knotenpositionen berechnet _sldLayout() bei jedem Render neu — ein Bild
// dahinter läge nach dem nächsten sldRefresh() woanders.

import { map } from './02b-gebaeude.js';
import { polygonCenter } from './02c-karte-werkzeuge.js';
import { showHint, flyTo } from './03c-gebaeude-io.js';
import { ASSETS, ASSET_CFG, TYPE_RANK, createAsset, getAssetsForBuilding } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets } from './13b-assets-render.js';
import { renderSidebarAssetList } from './13e-assets-inspector.js';
import { addStromEdge, recalcStromNetz, epPrompt } from './05b-stromnetz.js';
import { KABEL_TYPEN } from './config/netz-kosten.js';
import { runPlanningTransaction } from './lib/planning-transaction.js';
import { parseKabelLabel } from './lib/kabel-label.js';
import { SCHICHT } from './lib/schichten.js';

const PANEL_ID = 'plandigi-panel';
const MAP_ID   = 'plandigi-map';

// Typen, die auf einem NS-/MS-Bestandsplan als Kästchen auftauchen
const NODE_TYPES = ['NAP', 'Schaltanlage', 'Trafo', 'NSHV', 'UV', 'KVS', 'Verbraucher', 'Lade', 'PV', 'Batterie', 'Nsa'];

// 'fehlt' ist kein unfertiger Eintrag, sondern ein BEFUND: der Plan kennt das
// Objekt, die Karte nicht. Deshalb eigene Farbe — sonst geht die Aussage im
// Grau der noch nicht bearbeiteten Einträge unter.
const STATUS_COL = { ok: '#4caf50', bereit: '#f9a825', offen: '#90a4ae', fehlt: '#ef5350' };

// Auswahlfarbe: Weiß war auf weißem Planpapier unsichtbar. Magenta kommt auf
// Bestandsplänen praktisch nie vor (dort dominieren Rot, Grün, Cyan, Schwarz)
// und steht mit dunklem Unterzug auf hellem wie auf dunklem Untergrund.
const SEL_COL = '#e91e63';

// ── Zustand ─────────────────────────────────────────────────────────────────
// plan:  { name, url, w, h }            — Bilddaten + Pixelmaße
// nodes: { id, x, y, art, label, assetType, linkKind:'a'|'g'|null, linkId, assetId }
//        art 'komponente' — ein einzelnes Betriebsmittel (Station, KV, Trafo …)
//        art 'gebaeude'   — ein ganzes Gebäude samt seiner Anlagen; linkId ist
//                           die Gebäude-ID, anschlussAssetId die Anlage, an der
//                           die Kabel landen (netzseitigste, überschreibbar)
// links: { id, a, b, label, cableType, crossSection, nParallel, lengthM, msLevel, edgeId }
// abgehakt: Karteneinträge, die bewusst nicht im Plan stehen — Schlüssel
// 'g:<id>' bzw. 'a:<id>', Wert ist der Grund. Ohne dieses Abhaken brächte der
// Abgleich bei jeder Sitzung dieselben Zeilen und würde irgendwann ignoriert.
export const PD = { plan: null, nodes: [], links: [], seq: 1, gebGroesse: 1, abgehakt: {} };

let _map = null, _imgLayer = null, _marks = null;
let _mode = 'ansehen';
let _sel = null;        // { kind:'node'|'link', id }
let _pendingA = null;   // erster Knoten im Kabel-Modus
let _pendingPts = [];   // Stützpunkte der laufenden Kabelzeichnung (Bildpixel)
let _pendingSetzen = null; // { art:'gebaeude'|'asset', obj } — wartet auf den Platzierungsklick
let _seite = 'plan';       // Seitenspalte: 'plan' | 'abgleich'
let _refZoom = null;    // Zoomstufe der Einpassung: dort entspricht Größe 100 %
let _ro = null;

const _esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _node = id => PD.nodes.find(n => n.id === id) || null;
const _link = id => PD.links.find(l => l.id === id) || null;

// Bildpixel ⇄ CRS.Simple-Koordinaten. Das Bild liegt zwischen [0,0] und [h,w];
// Leaflet zählt lat nach oben, Bildpixel zählen y nach unten.
const _ll = (x, y) => L.latLng((PD.plan?.h || 0) - y, x);
const _xy = ll => ({ x: ll.lng, y: (PD.plan?.h || 0) - ll.lat });

// ── Kabel-Label parsen ──────────────────────────────────────────────────────
// Der eigentliche Parser liegt DOM-frei in lib/kabel-label.js (dort auch die
// unterstützten Schreibweisen); hier nur als window-Funktion durchgereicht,
// damit er sich aus der Konsole/aus Tests der UI heraus prüfen lässt.
export const pdParseKabelLabel = parseKabelLabel;

// ── Symbolgröße: an den Plan gekoppelt ─────────────────────────────
// Die Kombination aus L.CRS.Simple und einem divIcon hält Marker in Bildschirm-
// pixeln fest: der Plan zoomt, die Kästen nicht. Auf einem Bestandsplan gehören
// sie aber über die gezeichneten Kästchen — also werden sie mitskaliert.
// Bei CRS.Simple entspricht eine Zoomstufe genau Faktor 2; Bezugspunkt ist die
// Zoomstufe, auf die der Plan beim Laden eingepasst wurde (dort = 100 %).
function _symbolFaktorBasis() {
  const g = PD.gebGroesse || 1;
  if (!_map || _refZoom == null) return g;
  const k = g * Math.pow(2, _map.getZoom() - _refZoom);
  // Grenzen, damit ein extremer Zoom die Symbole weder verschwinden lässt
  // noch den halben Plan zukleistert
  return Math.max(0.15, Math.min(10, k));
}

const _begrenzeSkala = s => Math.max(0.25, Math.min(6, Number.isFinite(s) ? s : 1));

// Gesamtfaktor eines Eintrags: gemeinsame Größe mal eigener Anteil. Auf einem
// Bestandsplan sind die Kästchen unterschiedlich groß — eine Trafostation misst
// mehr als ein Kabelverteiler —, deshalb lässt sich jeder Eintrag einzeln
// nachziehen, ohne die gemeinsame Einstellung anzurühren.
function _symbolFaktor(n) {
  return _symbolFaktorBasis() * _begrenzeSkala(n?.skala ?? 1);
}

/** Symbolgröße stufenweise ändern (richtung -1/+1) oder mit 0 zurücksetzen. */
export function pdGroesse(richtung) {
  const g = PD.gebGroesse || 1;
  PD.gebGroesse = richtung === 0 ? 1 : Math.max(0.3, Math.min(4, g * Math.pow(1.25, richtung)));
  _zeigeGroesse();
  _renderMarks();
}

/** Größe nur des ausgewählten Eintrags ändern (richtung -1/+1, 0 = zurücksetzen). */
export function pdNodeGroesse(richtung) {
  const n = _node(_sel?.id);
  if (!n) return;
  n.skala = richtung === 0 ? 1 : _begrenzeSkala((n.skala ?? 1) * Math.pow(1.25, richtung));
  _renderAll();
}

function _zeigeGroesse() {
  const el = document.getElementById('pd-groesse-wert');
  if (el) el.textContent = Math.round((PD.gebGroesse || 1) * 100) + '\u2009%';
}

// ── Panel-Gerüst ────────────────────────────────────────────────────────────
// Standard ist die Vollbild-Arbeitsfläche: Bestandspläne sind großformatig, und
// beim Nachziehen von Kabeln zählt jeder Pixel. Der Fenstermodus (⤡) bleibt für
// den Fall, dass man den Plan neben der Karte braucht — er ist verschiebbar und
// in der Größe ziehbar wie die übrigen Panels.
function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'pd-panel pd-fullscreen';
  panel.innerHTML = `
    <div class="pd-head" onmousedown="pdHeadDrag(event)">
      <span class="pd-title">📐 Bestandsplan digitalisieren</span>
      <span id="pd-fortschritt" class="pd-progress">kein Plan geladen</span>
      <span style="flex:1"></span>
      <button class="pd-head-btn" id="pd-btn-fs" data-click="pdToggleFullscreen()"
              title="Zwischen Vollbild und verschiebbarem Fenster wechseln">⤡ Fenster</button>
      <button class="pd-head-btn pd-head-close" data-click="pdTogglePanel()"
              title="Schließen — Plan und Markierungen bleiben erhalten">✕ Schließen</button>
    </div>
    <div class="pd-toolbar">
      <label class="pd-file-btn" title="Bild (PNG/JPG) oder PDF-Seite des Bestandsplans laden">
        📂 Plan laden
        <input type="file" accept="image/png,image/jpeg,application/pdf"
               data-change="pdLoadPlan(this)" hidden/>
      </label>
      <span class="pd-suche-wrap">
        <input id="pd-suche" class="pd-suche" type="text" autocomplete="off"
               placeholder="🔎 Gebäude suchen (Nr. oder Name)…"
               title="Gebäude der Liegenschaft suchen und samt seiner Anlagen auf den Plan setzen"
               data-input="pdSuche(this.value)" data-keydown="pdSucheTaste(event)"/>
        <div id="pd-suche-res" class="pd-suche-res"></div>
      </span>
      <span class="pd-modes">
        <button class="pd-mode" data-mode="ansehen"  data-click="pdSetMode('ansehen')"  title="Nur ansehen: zoomen, verschieben, Einträge auswählen">🖱 Ansehen</button>
        <button class="pd-mode" data-mode="knoten"   data-click="pdSetMode('knoten')"   title="Klick auf ein Kästchen im Plan legt ein einzelnes Betriebsmittel an">⊕ Knoten</button>
        <button class="pd-mode" data-mode="kabel"    data-click="pdSetMode('kabel')"    title="Zwei Einträge nacheinander anklicken → Kabel">⟋ Kabel</button>
        <button class="pd-mode" data-mode="text"     data-click="pdSetMode('text')"     title="Beschriftungen aus dem PDF anzeigen und per Klick übernehmen">Aa Text</button>
        <button class="pd-mode" data-mode="loeschen" data-click="pdSetMode('loeschen')" title="Eintrag oder Kabel im Plan anklicken → entfernen">✕ Löschen</button>
      </span>
      <span class="pd-groesse" title="Größe der Einträge auf dem Plan. Sie zoomen mit dem Plan mit — 100 % entspricht der Einpassung beim Laden.">
        <button class="pd-head-btn" data-click="pdGroesse(-1)" title="Symbole kleiner">−</button>
        <span id="pd-groesse-wert" data-click="pdGroesse(0)" title="Auf 100 % zurücksetzen">100\u2009%</span>
        <button class="pd-head-btn" data-click="pdGroesse(1)" title="Symbole größer">+</button>
      </span>
      <span class="pd-modehint" id="pd-modehint"></span>
    </div>
    <div class="pd-body">
      <div id="${MAP_ID}" class="pd-map"></div>
      <div class="pd-side">
        <div id="pd-form" class="pd-form"></div>
        <div class="pd-tabs">
          <button class="pd-tab active" data-tab="plan" data-click="pdSeite('plan')"
                  title="Was im Plan markiert ist">Plan</button>
          <button class="pd-tab" data-tab="abgleich" data-click="pdSeite('abgleich')"
                  title="Was auf der Karte steht, aber noch in keinem Plan-Eintrag vorkommt">Abgleich <span id="pd-tab-zahl" class="pd-tab-zahl"></span></button>
        </div>
        <div id="pd-list" class="pd-list"></div>
        <div class="pd-actions">
          <button class="lp-tool-btn" data-click="pdApply()"
                  style="border-color:#66bb6a;color:#66bb6a;justify-content:center;"
                  title="Verknüpfte Einträge und fertige Kabel auf der Karte anlegen">▶ In Karte übernehmen</button>
          <button class="lp-tool-btn" data-click="pdClear()"
                  style="border-color:#e57373;color:#e57373;justify-content:center;"
                  title="Plan samt aller Markierungen verwerfen (angelegte Assets bleiben)">✕ Plan verwerfen</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(panel);
  return panel;
}

function _istOffen() {
  return !!document.getElementById(PANEL_ID)?.classList.contains('visible');
}

export function pdTogglePanel() {
  const panel = _ensurePanel();
  const offen = panel.classList.toggle('visible');
  // Im Vollbild darf die Seite darunter nicht mitscrollen (vgl. sldToggleFullscreen)
  document.body.style.overflow = (offen && panel.classList.contains('pd-fullscreen')) ? 'hidden' : '';
  document.getElementById('btn-pd-toggle')?.classList.toggle('active', offen);
  if (!offen) return;
  _ensureMap();
  pdSetMode(_mode);
  _renderAll();
  setTimeout(() => _map?.invalidateSize(), 60);
}

export function pdToggleFullscreen() {
  const panel = _ensurePanel();
  const voll = panel.classList.toggle('pd-fullscreen');
  const btn = document.getElementById('pd-btn-fs');
  if (btn) btn.innerHTML = voll ? '⤡ Fenster' : '⤢ Vollbild';
  if (voll) {
    // Positionsangaben aus dem Ziehen im Fenstermodus zurücknehmen
    panel.style.left = ''; panel.style.top = ''; panel.style.transform = '';
    panel.style.width = ''; panel.style.height = '';
    panel.classList.remove('dragging');
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
  setTimeout(() => _map?.invalidateSize(), 80);
}

// Kopfzeile zieht das Fenster — im Vollbild gibt es nichts zu verschieben.
export function pdHeadDrag(ev) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel || panel.classList.contains('pd-fullscreen')) return;
  if (ev.target.closest('button')) return;
  if (typeof window.startDrag === 'function') window.startDrag(ev, PANEL_ID);
}

// ── Leaflet auf Bildkoordinaten (CRS.Simple) ────────────────────────────────
function _ensureMap() {
  if (_map) return _map;
  const div = document.getElementById(MAP_ID);
  if (!div) return null;
  _map = L.map(div, {
    crs: L.CRS.Simple, minZoom: -6, maxZoom: 6, zoomSnap: 0.25,
    attributionControl: false, zoomControl: true,
  });
  _map.setView([0, 0], 0);
  _marks = L.layerGroup().addTo(_map);
  _map.on('click', _onMapClick);
  // Die Textebene wird nur fuer den sichtbaren Ausschnitt gezeichnet und muss
  // deshalb nach jedem Verschieben/Zoomen neu bestimmt werden.
  // Nach jedem Zoom neu zeichnen: die Symbole hängen an der Zoomstufe, und die
  // Textebene wird nur für den sichtbaren Ausschnitt aufgebaut.
  _map.on('zoomend', () => _renderMarks());
  _map.on('moveend', () => { if (_mode === 'text') _renderMarks(); });

  // Fenstermodus ist in der Größe ziehbar, Vollbild folgt dem Viewport —
  // Leaflet muss beides mitbekommen
  const panel = document.getElementById(PANEL_ID);
  if (panel && typeof ResizeObserver === 'function') {
    _ro = new ResizeObserver(() => _map && _map.invalidateSize());
    _ro.observe(panel);
  }
  if (PD.plan) _showPlanLayer();
  return _map;
}

function _showPlanLayer() {
  if (!_map || !PD.plan) return;
  if (_imgLayer) { _imgLayer.remove(); _imgLayer = null; }
  const bounds = [[0, 0], [PD.plan.h, PD.plan.w]];
  _imgLayer = L.imageOverlay(PD.plan.url, bounds, { interactive: false }).addTo(_map);
  _imgLayer.bringToBack();
  _map.setMaxBounds(L.latLngBounds(bounds).pad(0.5));
  _map.fitBounds(bounds);
  // Einpassungszoom als 100 %-Bezug merken: unabhängig von der Plangröße
  // sehen die Symbole beim Laden immer gleich aus.
  _refZoom = _map.getZoom();
}

// ── Plan laden (Bild oder PDF-Seite) ────────────────────────────────────────
export function pdLoadPlan(input) {
  const file = input?.files?.[0];
  input.value = '';
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) _loadPdf(file, name);
  else _loadImage(file, name);
}

function _loadImage(file, name) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => _setPlan(e.target.result, img.width, img.height, name);
    img.onerror = () => showHint('⚠ Bild konnte nicht gelesen werden: ' + name);
    img.src = e.target.result;
  };
  reader.onerror = () => showHint('⚠ Datei konnte nicht gelesen werden: ' + name);
  reader.readAsDataURL(file);
}

async function _loadPdf(file, name) {
  try {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      if (window.__PDF_WORKER_CODE__) {
        window._pdfWorkerBlobUrl = window._pdfWorkerBlobUrl
          || URL.createObjectURL(new Blob([window.__PDF_WORKER_CODE__], { type: 'text/javascript' }));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = window._pdfWorkerBlobUrl;
      } else {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs';
      }
    }
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    let pageNr = 1;
    if (pdf.numPages > 1) {
      const eingabe = await epPrompt('Seite wählen',
        `Das PDF hat ${pdf.numPages} Seiten. Welche enthält den Einlinienplan?`, '1',
        { type: 'number', okText: 'Laden' });
      if (eingabe == null) return;
      pageNr = Math.min(pdf.numPages, Math.max(1, parseInt(eingabe) || 1));
    }
    const page = await pdf.getPage(pageNr);
    // Skalierung 2.5: genug Schärfe zum Ablesen der Kabelbeschriftung, aber
    // deutlich kleiner in der Projektdatei als die 3.0 der Karten-Overlays.
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    // Zeitgrenze: pdf.js bleibt beim Rendern endlos haengen, wenn ein PDF eine
    // Standardschrift (Helvetica, Times) nur referenziert statt einzubetten --
    // die Schriftdaten liegen im Offline-Build nicht bereit, und das Promise
    // wird nie erfuellt. Ohne Grenze bliebe nur eine stumm haengende Ladeanzeige.
    const fertig = await Promise.race([
      page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise.then(() => true),
      new Promise(r => setTimeout(() => r(false), 25000)),
    ]);
    if (!fertig) {
      showHint('⚠ PDF konnte nicht gezeichnet werden: ' + name
        + ' — vermutlich sind die Schriften nicht eingebettet. Plan als PNG/JPG exportieren oder mit eingebetteten Schriften neu ausgeben.');
      return;
    }
    _setPlan(canvas.toDataURL('image/png'), canvas.width, canvas.height,
      pdf.numPages > 1 ? `${name} (S. ${pageNr})` : name,
      await _leseTextebene(page, viewport));
  } catch (e) {
    console.error('Plan-PDF fehlgeschlagen:', e);
    showHint('⚠ PDF konnte nicht geladen werden: ' + name);
  }
}

// Beschriftungen eines PDFs mit ihrer Position im gerenderten Bild. Anders als
// bei einem Scan steht der Text hier als echte Zeichenkette im Dokument — kein
// OCR nötig. Gespeichert wird nur der Ankerpunkt (Grundlinienanfang), nicht die
// Textbox: Kabelbeschriftungen stehen oft schräg an der Leitung, und ein
// achsenparalleles Rechteck wäre dafür die falsche Näherung.
async function _leseTextebene(page, viewport) {
  try {
    const tc = await page.getTextContent();
    const roh = (tc.items || [])
      .filter(it => typeof it.str === 'string' && it.str.trim())
      .map(it => {
        const m = window.pdfjsLib.Util.transform(viewport.transform, it.transform);
        return { x: Math.round(m[4]), y: Math.round(m[5]), str: it.str.trim() };
      });
    // pdf.js zerlegt eine Beschriftung gern in mehrere Fragmente ("NYY-J ",
    // "5x70"). Was auf derselben Grundlinie dicht beieinander steht, wieder
    // zusammensetzen — sonst parst keine einzige Kabelangabe.
    roh.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    const zusammen = [];
    for (const t of roh) {
      const letzt = zusammen[zusammen.length - 1];
      if (letzt && Math.abs(letzt.y - t.y) <= 2 && t.x - letzt.xEnde <= 14) {
        letzt.str += (t.x - letzt.xEnde > 2 ? ' ' : '') + t.str;
        letzt.xEnde = t.x + t.str.length * 5;
        continue;
      }
      zusammen.push({ x: t.x, y: t.y, str: t.str, xEnde: t.x + t.str.length * 5 });
    }
    return zusammen.map(t => ({ x: t.x, y: t.y, str: t.str }));
  } catch (e) {
    console.warn('Textebene des PDFs nicht lesbar:', e);
    return [];
  }
}

function _setPlan(url, w, h, name, texts) {
  const hatMarken = PD.nodes.length > 0 || PD.links.length > 0;
  PD.plan = { name, url, w, h, texts: Array.isArray(texts) ? texts : [] };
  if (!hatMarken) { PD.nodes = []; PD.links = []; PD.seq = 1; }
  _sel = null; _pendingA = null; _pendingSetzen = null;
  _ensureMap();
  _showPlanLayer();
  _renderAll();
  showHint(hatMarken
    ? `Plan „${name}" ersetzt — vorhandene Markierungen bleiben erhalten.`
    : `Plan „${name}" geladen${PD.plan.texts.length ? ` — ${PD.plan.texts.length} Beschriftungen aus dem PDF gelesen, Kabelangaben werden automatisch übernommen` : ''}.`);
}

export function pdClear() {
  PD.plan = null; PD.nodes = []; PD.links = []; PD.seq = 1; PD.gebGroesse = 1; PD.abgehakt = {};
  _sel = null; _pendingA = null; _pendingSetzen = null;
  if (_imgLayer) { _imgLayer.remove(); _imgLayer = null; }
  _marks?.clearLayers();
  _zeigeGroesse();
  _renderAll();
}

// ── Modi ────────────────────────────────────────────────────────────────────
const MODE_HINWEIS = {
  ansehen:  'Ziehen verschiebt den Plan, Mausrad zoomt. Einträge lassen sich an die richtige Stelle ziehen.',
  knoten:   'Klick auf ein Kästchen legt ein einzelnes Betriebsmittel an — ganze Gebäude besser über das Suchfeld.',
  kabel:    'Ersten Eintrag anklicken, dann den zweiten. Klicks dazwischen setzen Stützpunkte entlang der Planlinie.',
  text:     'Beschriftungen aus dem PDF: Klick übernimmt den Text in den ausgewählten Eintrag bzw. das Kabel.',
  loeschen: 'Klick auf Eintrag oder Kabel entfernt ihn aus dem Plan (nicht von der Karte).',
};

export function pdSetMode(m) {
  _mode = m;
  _pendingA = null;
  _pendingPts = [];
  _pendingSetzen = null;   // ein Moduswechsel verwirft eine offene Platzierung
  document.querySelectorAll('#' + PANEL_ID + ' .pd-mode')
    .forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  const div = document.getElementById(MAP_ID);
  if (div) div.style.cursor = (m === 'ansehen') ? '' : 'crosshair';
  const hint = document.getElementById('pd-modehint');
  if (hint) {
    // Bildplaene (Scans, PNG/JPG) bringen keine Textebene mit -- das gehoert
    // gesagt, statt einen leeren Modus anzubieten.
    hint.textContent = (m === 'text' && PD.plan && !(PD.plan.texts || []).length)
      ? 'Dieser Plan enthaelt keine Textebene (nur PDF-Plaene bringen eine mit; Scans nicht).'
      : (MODE_HINWEIS[m] || '');
  }
  _renderMarks();
}

// Esc: erst die offene Gebäude-Platzierung, dann die begonnene Kabelverbindung,
// dann der Zeichenmodus. Das Panel bleibt bewusst offen, damit eine
// Fehlbedienung keine Arbeit kostet.
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || !_istOffen()) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (_pendingSetzen) { _pendingSetzen = null; pdSetMode(_mode); return; }
  if (_pendingPts.length) { _pendingPts.pop(); _renderAll(); return; }
  if (_pendingA) { _pendingA = null; _renderAll(); return; }
  if (_mode !== 'ansehen') pdSetMode('ansehen');
});

function _onMapClick(e) {
  if (!PD.plan) { showHint('⚠ Erst einen Plan laden.'); return; }
  const p = _xy(e.latlng);
  if (_pendingSetzen) {
    if (_pendingSetzen.art === 'asset') _setzeAssetKnoten(_pendingSetzen.obj, p);
    else if (_pendingSetzen.art === 'fehlend') _setzeFehlendesGebaeude(_pendingSetzen.obj, p);
    else _setzeGebaeudeKnoten(_pendingSetzen.obj, p);
    return;
  }
  if (_mode === 'kabel') {
    // Zwischen den beiden Einträgen gesetzte Klicks folgen der Linie im Plan.
    // Rein zeichnerisch — die Trasse auf der Karte kommt weiter aus dem Routing.
    if (_pendingA) { _pendingPts.push({ x: Math.round(p.x), y: Math.round(p.y) }); _renderAll(); }
    return;
  }
  if (_mode !== 'knoten') { _renderAll(); return; }
  const node = {
    id: 'pn' + (PD.seq++), x: Math.round(p.x), y: Math.round(p.y),
    art: 'komponente',
    label: _textNah(p, 60)?.str || '', assetType: 'Verbraucher', linkKind: null, linkId: null, assetId: null,
  };
  PD.nodes.push(node);
  _sel = { kind: 'node', id: node.id };
  _renderAll();
  setTimeout(() => document.getElementById('pd-f-label')?.focus(), 0);
}

// ── Gebäudesuche: ganzes Gebäude samt Anlagen auf den Plan setzen ───────────
// Auf dem Papierplan ist ein Kästchen fast immer ein GEBÄUDE, nicht ein
// einzelnes Betriebsmittel — und dieses Gebäude steht mitsamt Verbraucher, PV,
// UV usw. längst auf der Karte. Statt es Feld für Feld nachzubauen, sucht man
// es hier über Nummer oder Name und setzt es als Ganzes auf den Plan.

function _istGebKnoten(n) { return (n?.art || 'komponente') === 'gebaeude'; }

function _gebFuer(n) {
  return (window.gebaeude || []).find(g => String(g.id) === String(n.linkId)) || null;
}

// Anschlusspunkte eines Gebäudes, netzseitig zuerst: an einer NSHV/UV/KVS
// landet ein Kabel eher als am Verbraucher, an einer PV so gut wie nie.
function _anschlussKandidaten(gebId) {
  // Ohne Gebäude keine Kandidaten. Ungeprüft läme getAssetsForBuilding(null)
  // sämtliche freistehenden Anlagen zurück — die gehören hier nicht her.
  if (gebId == null) return [];
  return getAssetsForBuilding(gebId)
    .filter(a => a.domain === 'strom' || a.domain === 'hybrid')
    .sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9));
}

function _anschlussAsset(n) {
  if (n.anschlussAssetId) {
    const a = ASSETS.items.find(x => x.id === n.anschlussAssetId);
    if (a) return a;
  }
  return _anschlussKandidaten(n.linkId)[0] || null;
}

function _sucheGebaeude(s) {
  const rang = g => {
    const nr = String(g.gebaeudenummer || '').toLowerCase();
    const nm = String(g.name || '').toLowerCase();
    if (nr && nr === s) return 0;
    if (nr && nr.startsWith(s)) return 1;
    if (nm === s) return 2;
    if (nm.startsWith(s)) return 3;
    if (nm.includes(s)) return 4;
    if (nr && nr.includes(s)) return 5;
    return 99;
  };
  return (window.gebaeude || [])
    .map(g => ({ g, r: rang(g) }))
    .filter(x => x.r < 99)
    .sort((a, b) => a.r - b.r || String(a.g.name).localeCompare(String(b.g.name), 'de'))
    .slice(0, 8)
    .map(x => x.g);
}

function _sucheSchliessen() {
  const box = document.getElementById('pd-suche-res');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
}

export function pdSuche(q) {
  const box = document.getElementById('pd-suche-res');
  if (!box) return;
  const s = String(q || '').trim().toLowerCase();
  if (!s) { _sucheSchliessen(); return; }
  const gefunden = _sucheGebaeude(s);
  if (!gefunden.length) {
    // Kein Treffer ist selbst ein Befund: der Plan kennt ein Gebäude, die Karte
    // nicht. Statt in eine Sackgasse zu laufen, lässt es sich hier erfassen.
    box.innerHTML = `<div class="pd-suche-leer">Kein Gebäude auf der Karte gefunden</div>
      <div class="pd-suche-row" data-click="pdFehlendesGebaeude('${_esc(s).replace(/'/g, "\\'")}')">
        <span class="pd-suche-nr" style="color:#ef5350">+</span>
        <span class="pd-suche-name">„${_esc(q)}" als <b>fehlend</b> im Plan erfassen</span>
        <span class="pd-suche-meta">nicht auf der Karte</span>
      </div>`;
    box.style.display = 'block';
    return;
  }
  box.innerHTML = gefunden.map(g => {
    const n = _anschlussKandidaten(g.id).length;
    const drin = PD.nodes.some(x => _istGebKnoten(x) && String(x.linkId) === String(g.id));
    return `<div class="pd-suche-row${drin ? ' drin' : ''}" data-click="pdPlatziereGebaeude('${g.id}')">
      <span class="pd-suche-nr">${_esc(g.gebaeudenummer || '–')}</span>
      <span class="pd-suche-name">${_esc(g.name)}</span>
      <span class="pd-suche-meta">${drin ? 'schon im Plan' : (n ? n + ' Anlage' + (n === 1 ? '' : 'n') : 'ohne Anlagen')}</span>
    </div>`;
  }).join('');
  box.style.display = 'block';
}

export function pdSucheTaste(ev) {
  if (ev.key === 'Escape') { ev.target.value = ''; _sucheSchliessen(); ev.target.blur(); return; }
  if (ev.key !== 'Enter') return;
  document.querySelector('#pd-suche-res .pd-suche-row')?.click();
}

export function pdPlatziereGebaeude(id) {
  const g = (window.gebaeude || []).find(x => String(x.id) === String(id));
  if (!g) return;
  _sucheSchliessen();
  const vorhanden = PD.nodes.find(n => _istGebKnoten(n) && String(n.linkId) === String(g.id));
  if (vorhanden) {
    pdSelect('node', vorhanden.id);
    showHint(`„${g.name}" liegt bereits im Plan — der Eintrag ist jetzt ausgewählt.`);
    return;
  }
  if (!PD.plan) { showHint('⚠ Erst einen Plan laden.'); return; }
  pdSetMode('knoten');                        // setzt _pendingSetzen zurück …
  _pendingSetzen = { art: 'gebaeude', obj: g }; // … deshalb erst danach setzen
  const anz = _anschlussKandidaten(g.id).length;
  const hint = document.getElementById('pd-modehint');
  if (hint) {
    hint.innerHTML = `Klick in den Plan setzt <b>${_esc(g.name)}</b>`
      + (anz ? ` samt ${anz} Anlage${anz === 1 ? '' : 'n'}` : ' (Gebäude hat noch keine Anlagen)')
      + ' — Esc bricht ab.';
  }
}

/**
 * Gebäude nur im Plan erfassen — ohne Gegenstück auf der Karte.
 * Bewusst KEIN Eintrag in window.gebaeude: ein Gebäude ohne Grundriss hätte
 * keine Fläche, und calcAutoEnergy() rechnet den Wärmebedarf aus genau dieser
 * Fläche. Ein Platzhalter erzeugte also eine erfundene Wärmemenge, die still
 * in Netzauslegung und Wirtschaftlichkeit weiterliefe. Der Eintrag hier ist ein
 * Befund über den Bestand, kein Bestandsobjekt.
 */
export function pdFehlendesGebaeude(text) {
  if (!PD.plan) { showHint('⚠ Erst einen Plan laden.'); return; }
  const roh = String(text || '').trim();
  if (!roh) return;
  _sucheSchliessen();
  const nummer = roh.match(/(\d+)\s*$/)?.[1] || '';
  const name = /^\d+$/.test(roh) ? 'Gebäude ' + roh : roh;
  pdSetMode('knoten');
  _pendingSetzen = { art: 'fehlend', obj: { name, nummer } };
  const hint = document.getElementById('pd-modehint');
  if (hint) hint.innerHTML = `Klick in den Plan erfasst <b>${_esc(name)}</b> als <b>auf der Karte fehlend</b> — Esc bricht ab.`;
}

function _setzeFehlendesGebaeude(o, p) {
  const node = {
    id: 'pn' + (PD.seq++), x: Math.round(p.x), y: Math.round(p.y),
    art: 'gebaeude', fehlt: true,
    label: o.name, gebNummer: o.nummer,
    assetType: 'Verbraucher',
    linkKind: null, linkId: null, anschlussAssetId: null, assetId: null,
  };
  PD.nodes.push(node);
  _pendingSetzen = null;
  _sel = { kind: 'node', id: node.id };
  pdSetMode(_mode);
  _renderAll();
}

// Taucht das vermisste Gebäude inzwischen auf der Karte auf? Nummer zuerst,
// sonst der Name — dieselbe Logik wie beim Vorschlag aus der Plan-Beschriftung.
function _kartenTreffer(n) {
  if (!n.fehlt) return null;
  const list = window.gebaeude || [];
  const nr = String(n.gebNummer || '').trim();
  if (nr) {
    const t = list.find(g => String(g.gebaeudenummer || '').trim() === nr);
    if (t) return t;
  }
  return _rateGebaeude(n.label);
}

/** Erfasstes Fehl-Gebäude mit dem inzwischen gezeichneten Kartengebäude verbinden. */
export function pdVerknuepfeFehlend(nodeId) {
  const n = _node(nodeId);
  const g = n && _kartenTreffer(n);
  if (!g) { showHint('⚠ Auf der Karte gibt es (noch) kein passendes Gebäude.'); return; }
  const anschluss = _anschlussKandidaten(g.id)[0] || null;
  n.fehlt = false;
  n.linkKind = 'g';
  n.linkId = g.id;
  n.assetType = anschluss?.type || n.assetType || 'Verbraucher';
  n.anschlussAssetId = anschluss?.id || null;
  n.assetId = anschluss?.id || null;
  showHint(`„${n.label}" ist jetzt mit „${g.name}" auf der Karte verknüpft.`);
  _renderAll();
}

function _setzeGebaeudeKnoten(g, p) {
  const anschluss = _anschlussKandidaten(g.id)[0] || null;
  const node = {
    id: 'pn' + (PD.seq++), x: Math.round(p.x), y: Math.round(p.y),
    art: 'gebaeude',
    label: g.name,
    // Nur relevant, wenn das Gebäude noch gar keine Anlage hat — dann wird eine angelegt
    assetType: anschluss?.type || 'Verbraucher',
    linkKind: 'g', linkId: g.id,
    anschlussAssetId: anschluss?.id || null,
    // Anlage existiert bereits auf der Karte → nichts mehr zu übernehmen
    assetId: anschluss?.id || null,
  };
  PD.nodes.push(node);
  _pendingSetzen = null;
  _sel = { kind: 'node', id: node.id };
  pdSetMode(_mode);      // Modushinweis zurücksetzen
  _renderAll();
  const feld = document.getElementById('pd-suche');
  if (feld) { feld.value = ''; feld.focus(); }
}

// ── Beschriftungen aus dem Plan finden ───────────────────────────
function _dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// Abstand eines Punktes zur Strecke a–b (quadriert, spart die Wurzel)
function _dist2Segment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return _dist2(p.x, p.y, a.x, a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return _dist2(p.x, p.y, a.x + t * vx, a.y + t * vy);
}

/** Nächste Beschriftung zu einem Punkt, innerhalb von radius Bildpixeln. */
function _textNah(p, radius, pruef) {
  const texts = PD.plan?.texts || [];
  let best = null, bestD = radius * radius;
  for (const t of texts) {
    if (pruef && !pruef(t.str)) continue;
    const d = _dist2(p.x, p.y, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Nächste Beschriftung zu einem Linienzug — Kabelangaben stehen an der Leitung. */
function _textNahLinie(pts, radius, pruef) {
  const texts = PD.plan?.texts || [];
  let best = null, bestD = radius * radius;
  for (const t of texts) {
    if (pruef && !pruef(t.str)) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = _dist2Segment(t, pts[i], pts[i + 1]);
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best;
}

/** Linienzug eines Kabels im Plan: Anfang, gesetzte Stützpunkte, Ende. */
function _linkPunkte(l, a, b) {
  return [{ x: a.x, y: a.y }, ...(l.points || []), { x: b.x, y: b.y }];
}

// Kabelangabe setzen und gleich auswerten — eine Stelle für Handeingabe und
// automatische Übernahme aus der Planbeschriftung.
function _setzeKabelLabel(l, text) {
  l.label = text;
  const p = pdParseKabelLabel(text);
  if (p) {
    l.cableType = p.cableType;
    l.crossSection = p.crossSection;
    l.nParallel = p.nParallel;
    l.msLevel = p.msLevel;
  } else {
    l.cableType = null; l.crossSection = 0; l.nParallel = 1; l.msLevel = false;
  }
}

// Angeklickte Beschriftung in den ausgewählten Eintrag übernehmen
function _textUebernehmen(t) {
  if (_sel?.kind === 'link') {
    const l = _link(_sel.id);
    if (l) { _setzeKabelLabel(l, t.str); showHint(`Kabelangabe „${t.str}" übernommen.`); _renderAll(); return; }
  }
  if (_sel?.kind === 'node') {
    const n = _node(_sel.id);
    if (n) { n.label = t.str; showHint(`Beschriftung „${t.str}" übernommen.`); _renderAll(); return; }
  }
  try {
    navigator.clipboard?.writeText(t.str);
    showHint(`„${t.str}" in die Zwischenablage kopiert — für die direkte Übernahme vorher einen Eintrag oder ein Kabel auswählen.`);
  } catch (e) {
    showHint(`„${t.str}" — erst einen Eintrag oder ein Kabel auswählen, dann die Beschriftung anklicken.`);
  }
}

// ── Abgleich Plan ↔ Karte ─────────────────────────────────────
// Der Fortschritt „Einträge 12/12" sagt nur, dass alles Übernommene übernommen
// ist — nicht, ob der Plan vollständig abgearbeitet wurde. Vierzig nie
// betrachtete Gebäude tauchen darin nicht auf. Deshalb wird beiden Richtungen
// nachgegangen.
//
// Geprüft wird nur die Schicht BESTAND: ein Bestandsplan KANN nichts anderes
// zeigen. Neubauten aus „Entwicklung" und alles aus „Planung" fehlen dort völlig
// zu Recht (siehe lib/schichten.js) — ohne diesen Filter bestünde die Liste
// größtenteils aus Fehlalarmen.
//
// Auf der Anlagenseite zählen nur Assets OHNE Gebäude: freistehende
// Infrastruktur (NAP, Schaltanlage, Kabelverteiler, Freiflächen-PV) taucht auf
// dem Plan als eigenes Kästchen auf. Die je Gebäude automatisch angelegten
// UV/Verbraucher würden die Liste dagegen nur zuschwemmen.

const _istBestand = o => !o?.schicht || o.schicht === SCHICHT.BESTAND;
const _abKey = (art, id) => `${art}:${id}`;

export function pdAbgleich() {
  const gebImPlan = new Set(PD.nodes.filter(n => n.linkKind === 'g').map(n => String(n.linkId)));
  const assetImPlan = new Set();
  for (const n of PD.nodes) {
    if (n.assetId) assetImPlan.add(n.assetId);
    if (n.anschlussAssetId) assetImPlan.add(n.anschlussAssetId);
    if (n.linkKind === 'a' && n.linkId) assetImPlan.add(n.linkId);
  }

  const offeneGeb = (window.gebaeude || [])
    .filter(g => _istBestand(g) && !gebImPlan.has(String(g.id)))
    .map(g => ({ art: 'g', id: g.id, name: g.name, zusatz: g.gebaeudenummer ? 'Nr. ' + g.gebaeudenummer : 'Gebäude' }));

  const offeneAssets = ASSETS.items
    .filter(a => (a.domain === 'strom' || a.domain === 'hybrid'))
    .filter(a => a.buildingId == null && _istBestand(a) && !assetImPlan.has(a.id))
    .map(a => ({ art: 'a', id: a.id, name: a.name, zusatz: ASSET_CFG[a.type]?.label || a.type }));

  const alle = [...offeneGeb, ...offeneAssets];
  const offen = alle.filter(o => !PD.abgehakt[_abKey(o.art, o.id)]);
  const abgehakt = alle.filter(o => PD.abgehakt[_abKey(o.art, o.id)])
    .map(o => ({ ...o, grund: PD.abgehakt[_abKey(o.art, o.id)] }));

  return {
    beidseitig: PD.nodes.filter(n => _statusNode(n) === 'ok'),
    // Unfertige Einträge (noch nicht verortet) und Befunde (Gebäude fehlt auf
    // der Karte) sind zweierlei und gehören getrennt gezählt.
    nurImPlan:  PD.nodes.filter(n => _statusNode(n) === 'offen'),
    fehlt:      PD.nodes.filter(n => _statusNode(n) === 'fehlt'),
    nurKarte:   offen,
    abgehakt,
  };
}

/**
 * Abgleich als Tabelle in die Zwischenablage — damit sich das Delta außerhalb
 * des Werkzeugs auswerten lässt (Tabellenkalkulation, Protokoll, Rückfrage an
 * den Betreiber). Tabulatorgetrennt, damit Einfügen direkt Spalten ergibt.
 */
export function pdAbgleichKopieren() {
  const ab = pdAbgleich();
  const zeilen = [['Kategorie', 'Bezeichnung', 'Nummer/Typ', 'Hinweis'].join('\t')];
  ab.fehlt.forEach(n => zeilen.push(['fehlt auf der Karte', n.label || '', n.gebNummer || '', 'nur im Plan erfasst'].join('\t')));
  ab.nurKarte.forEach(o => zeilen.push(['nur auf der Karte', o.name, o.zusatz, ''].join('\t')));
  ab.nurImPlan.forEach(n => zeilen.push(['im Plan, noch nicht verortet', n.label || '(ohne Bezeichnung)', '', ''].join('\t')));
  ab.abgehakt.forEach(o => zeilen.push(['bewusst nicht im Plan', o.name, o.zusatz, o.grund].join('\t')));
  const text = `Abgleich Plan ↔ Karte — ${PD.plan?.name || 'Plan'}\n`
    + `beidseitig: ${ab.beidseitig.length}\n\n` + zeilen.join('\n');
  try {
    navigator.clipboard?.writeText(text);
    showHint(`Abgleich kopiert — ${zeilen.length - 1} Zeile(n) in der Zwischenablage.`);
  } catch (e) {
    console.warn('Zwischenablage nicht verfügbar:', e);
    showHint('⚠ Zwischenablage nicht verfügbar.');
  }
}

/** Karteneintrag bewusst als „nicht im Plan" ablegen (mit Grund). */
export function pdAbhaken(art, id) {
  const key = _abKey(art, id);
  if (PD.abgehakt[key]) { delete PD.abgehakt[key]; _renderAll(); return; }
  epPrompt('Nicht im Plan',
    'Warum steht dieser Eintrag nicht auf dem Bestandsplan?',
    'nicht im Planausschnitt', { okText: 'Abhaken' }).then(grund => {
    if (grund == null) return;
    PD.abgehakt[key] = String(grund).trim() || 'nicht im Plan';
    _renderAll();
  });
}

/** Vorhandene Anlage ohne Gebäude auf den Plan setzen (wie pdPlatziereGebaeude). */
export function pdPlatziereAsset(id) {
  const a = ASSETS.items.find(x => x.id === id);
  if (!a) return;
  const vorhanden = PD.nodes.find(n => n.assetId === a.id || (n.linkKind === 'a' && n.linkId === a.id));
  if (vorhanden) { pdSelect('node', vorhanden.id); showHint(`„${a.name}" liegt bereits im Plan.`); return; }
  if (!PD.plan) { showHint('⚠ Erst einen Plan laden.'); return; }
  pdSetMode('knoten');
  _pendingSetzen = { art: 'asset', obj: a };
  const hint = document.getElementById('pd-modehint');
  if (hint) hint.innerHTML = `Klick in den Plan setzt <b>${_esc(a.name)}</b> (${_esc(ASSET_CFG[a.type]?.label || a.type)}) — Esc bricht ab.`;
}

function _setzeAssetKnoten(a, p) {
  const node = {
    id: 'pn' + (PD.seq++), x: Math.round(p.x), y: Math.round(p.y),
    art: 'komponente',
    label: a.name, assetType: a.type,
    linkKind: 'a', linkId: a.id, assetId: a.id,
  };
  PD.nodes.push(node);
  _pendingSetzen = null;
  _sel = { kind: 'node', id: node.id };
  pdSetMode(_mode);
  _renderAll();
}

/** Auf der Karte zeigen — im Vollbild vorher ins Fenster wechseln, sonst sieht man nichts. */
export function pdZeigeKarte(art, id) {
  const panel = document.getElementById(PANEL_ID);
  if (panel?.classList.contains('pd-fullscreen')) pdToggleFullscreen();
  if (art === 'g') { flyTo(Number.isNaN(Number(id)) ? id : Number(id)); return; }
  const a = ASSETS.items.find(x => x.id === id);
  if (a && a.lat != null) map.flyTo([a.lat, a.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
}

export function pdSeite(seite) {
  _seite = seite;
  document.querySelectorAll('#' + PANEL_ID + ' .pd-tab')
    .forEach(b => b.classList.toggle('active', b.dataset.tab === seite));
  _renderList();
}

// ── Markierungen zeichnen ───────────────────────────────────────────────────
function _statusNode(n) {
  if (n.assetId && ASSETS.items.some(a => a.id === n.assetId)) return 'ok';
  if (n.fehlt) return 'fehlt';
  if (n.linkKind) return 'bereit';
  return 'offen';
}

function _statusLink(l) {
  if (l.edgeId && (window.stromEdges || []).some(e => e.id === l.edgeId)) return 'ok';
  const a = _node(l.a), b = _node(l.b);
  // Nur übernehmbar, wenn BEIDE Enden ein Gegenstück auf der Karte haben —
  // ein als fehlend erfasstes Gebäude zählt ausdrücklich nicht dazu.
  const tragend = x => _statusNode(x) === 'ok' || _statusNode(x) === 'bereit';
  if (a && b && tragend(a) && tragend(b)) return 'bereit';
  return 'offen';
}

function _renderMarks() {
  if (!_marks) return;
  _marks.clearLayers();
  if (!PD.plan) return;

  for (const l of PD.links) {
    const a = _node(l.a), b = _node(l.b);
    if (!a || !b) continue;
    const st = _statusLink(l);
    const aktiv = _sel?.kind === 'link' && _sel.id === l.id;
    const punkte = _linkPunkte(l, a, b).map(p => _ll(p.x, p.y));
    if (aktiv) {
      // Dunkler Unterzug: die Auswahl muss auf hellem Planpapier ebenso stehen
      // wie auf dunklen Scans.
      _marks.addLayer(L.polyline(punkte, { color: '#10131a', weight: 9, opacity: 0.5, interactive: false }));
    }
    const line = L.polyline(punkte, {
      color: aktiv ? SEL_COL : STATUS_COL[st],
      weight: aktiv ? 5 : 3, opacity: 0.95,
      dashArray: l.msLevel ? null : '7,5', interactive: true,
    });
    line.bindTooltip(l.label || '(Kabel ohne Angabe)', { sticky: true, className: 'geb-tooltip' });
    line.on('click', ev => {
      L.DomEvent.stop(ev);
      if (_mode === 'loeschen') { PD.links = PD.links.filter(x => x.id !== l.id); _sel = null; }
      else _sel = { kind: 'link', id: l.id };
      _renderAll();
    });
    _marks.addLayer(line);

    // Stützpunkte des ausgewählten Kabels: ziehbar, Rechtsklick entfernt
    if (aktiv && (l.points || []).length) {
      l.points.forEach((wp, i) => {
        const h = L.marker(_ll(wp.x, wp.y), {
          icon: L.divIcon({ className: 'pd-wp-icon', html: '<div class="pd-wp"></div>', iconSize: [11, 11], iconAnchor: [5.5, 5.5] }),
          draggable: true, keyboard: false, zIndexOffset: 500,
        });
        h.on('dragend', () => { const q = _xy(h.getLatLng()); wp.x = Math.round(q.x); wp.y = Math.round(q.y); _renderAll(); });
        h.on('contextmenu', ev => { L.DomEvent.stop(ev); l.points.splice(i, 1); _renderAll(); });
        h.on('click', ev => L.DomEvent.stop(ev));
        _marks.addLayer(h);
      });
    }
  }

  // Laufende Kabelzeichnung: vom ersten Eintrag über die gesetzten Stützpunkte
  if (_pendingA) {
    const a = _node(_pendingA);
    if (a) {
      const vor = [{ x: a.x, y: a.y }, ..._pendingPts].map(p => _ll(p.x, p.y));
      if (vor.length > 1) {
        _marks.addLayer(L.polyline(vor, { color: SEL_COL, weight: 3, opacity: 0.85, dashArray: '4,4', interactive: false }));
      }
      _pendingPts.forEach(p => _marks.addLayer(L.marker(_ll(p.x, p.y), {
        icon: L.divIcon({ className: 'pd-wp-icon', html: '<div class="pd-wp offen"></div>', iconSize: [11, 11], iconAnchor: [5.5, 5.5] }),
        interactive: false, keyboard: false,
      })));
    }
  }

  // Textebene: nur im Text-Modus und nur im sichtbaren Ausschnitt — ein
  // Bestandsplan bringt schnell mehrere hundert Beschriftungen mit.
  if (_mode === 'text' && _map) {
    const b = _map.getBounds();
    (PD.plan.texts || [])
      .filter(t => b.contains(_ll(t.x, t.y)))
      .slice(0, 400)
      .forEach(t => {
        const kabel = !!pdParseKabelLabel(t.str);
        const mk = L.marker(_ll(t.x, t.y), {
          icon: L.divIcon({
            className: 'pd-text-icon',
            html: `<div class="pd-textmark${kabel ? ' kabel' : ''}">${_esc(t.str)}</div>`,
            iconSize: null,
          }),
          keyboard: false, zIndexOffset: 400,
        });
        mk.on('click', ev => { L.DomEvent.stop(ev); _textUebernehmen(t); });
        _marks.addLayer(mk);
      });
  }

  for (const n of PD.nodes) {
    const st = _statusNode(n);
    const aktiv = _sel?.kind === 'node' && _sel.id === n.id;
    const wartet = _pendingA === n.id;
    const icon = _istGebKnoten(n)
      ? _gebaeudeIcon(n, st, aktiv || wartet)
      : _komponentenIcon(n, st, aktiv || wartet);
    const mk = L.marker(_ll(n.x, n.y), { icon, draggable: _mode === 'ansehen', keyboard: false });
    mk.on('click', ev => {
      L.DomEvent.stop(ev);
      _onNodeClick(n);
    });
    mk.on('dragend', () => {
      const p = _xy(mk.getLatLng());
      n.x = Math.round(p.x); n.y = Math.round(p.y);
      _renderAll();
    });
    _marks.addLayer(mk);
    if (aktiv) _groessenGriff(n, mk);
  }
}

// Eckgriff zum Aufziehen des ausgewählten Eintrags — dieselbe Bedienung wie die
// Eckgriffe des Plan-Overlays auf der Karte. Der Griff sitzt an der unteren
// rechten Ecke des gezeichneten Kastens; dessen Maße stehen erst nach dem
// Einfügen fest und werden deshalb am eingefügten Element gemessen.
function _groessenGriff(n, mk) {
  if (!_map) return;
  const el = mk.getElement();
  const mess = el?.querySelector('.pd-geb') || el?.querySelector('.pd-node');
  const skalEl = el?.querySelector('.pd-geb') || el?.querySelector('.pd-node-wrap');
  if (!mess || !skalEl) return;
  const r = mess.getBoundingClientRect();
  const pxProPlan = Math.pow(2, _map.getZoom());          // CRS.Simple: 1 Planpixel = 2^zoom Bildschirmpixel
  const halbB = (r.width / 2) / pxProPlan;
  const halbH = (r.height / 2) / pxProPlan;
  if (!(halbB > 0)) return;

  const griff = L.marker(_ll(n.x + halbB, n.y + halbH), {
    icon: L.divIcon({ className: 'pd-gr-icon', html: '<div class="pd-gr"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }),
    draggable: true, keyboard: false, zIndexOffset: 700,
    title: 'Ziehen ändert die Größe dieses Eintrags',
  });
  let start = null;
  const ausZug = () => {
    const p = _xy(griff.getLatLng());
    return _begrenzeSkala(start.skala * (Math.abs(p.x - n.x) / start.halbB));
  };
  griff.on('dragstart', () => { start = { skala: n.skala ?? 1, halbB }; });
  griff.on('drag', () => {
    if (!start) return;
    // Live-Vorschau direkt am Element: ein Neuaufbau würde den gezogenen Griff
    // mitlöschen und den Zug abbrechen.
    const f = (_symbolFaktorBasis() * ausZug()).toFixed(3);
    skalEl.style.transform = skalEl.classList.contains('pd-geb')
      ? `translate(-50%,-50%) scale(${f})`
      : `scale(${f})`;
  });
  griff.on('dragend', () => {
    if (start) n.skala = ausZug();
    start = null;
    _renderAll();
  });
  griff.on('click', ev => L.DomEvent.stop(ev));
  _marks.addLayer(griff);
}

// Einzelnes Betriebsmittel: kleiner farbiger Punkt mit Typ-Symbol
function _komponentenIcon(n, st, hervor) {
  const cfg = ASSET_CFG[n.assetType] || {};
  const rand = hervor ? SEL_COL : 'rgba(0,0,0,.6)';
  const k = _symbolFaktor(n);
  return L.divIcon({
    className: 'pd-node-icon',
    html: `<div class="pd-node-wrap" style="transform:scale(${k.toFixed(3)});transform-origin:11px 11px;">
             <div class="pd-node" style="background:${STATUS_COL[st]};border-color:${rand};${hervor ? 'box-shadow:0 0 0 3px rgba(233,30,99,.45);' : ''}">
               <span>${cfg.icon || '◻'}</span>
             </div>
             <div class="pd-node-lbl">${_esc(n.label || '?')}</div>
           </div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

// Ganzes Gebäude: Kasten wie auf dem Papierplan, darunter die Anlagen als
// Symbolreihe. Der gewählte Anschlusspunkt ist hervorgehoben — dort landen die
// Kabel, die an diesem Kasten enden.
function _gebaeudeIcon(n, st, hervor) {
  if (n.fehlt) {
    return L.divIcon({
      className: 'pd-geb-icon',
      html: `<div class="pd-geb fehlt${hervor ? ' sel' : ''}" style="border-color:${STATUS_COL.fehlt};transform:translate(-50%,-50%) scale(${_symbolFaktor(n).toFixed(3)});">
               <span class="pd-geb-name">${_esc(n.label || 'Gebäude')}</span>
               <span class="pd-chips"><span class="pd-chips-leer">nicht auf der Karte</span></span>
             </div>`,
      iconSize: null,
    });
  }
  const kand = _anschlussKandidaten(n.linkId);
  const an = _anschlussAsset(n);
  const chips = kand.slice(0, 6).map(a => {
    const c = ASSET_CFG[a.type] || {};
    return `<span class="pd-chip${a.id === an?.id ? ' an' : ''}" style="color:${c.color || '#90a4ae'}"
             title="${_esc(a.name)}">${c.icon || '◻'}</span>`;
  }).join('');
  const mehr = kand.length > 6 ? `<span class="pd-chip pd-chip-mehr">+${kand.length - 6}</span>` : '';
  return L.divIcon({
    className: 'pd-geb-icon',
    html: `<div class="pd-geb${hervor ? ' sel' : ''}" style="border-color:${STATUS_COL[st]};transform:translate(-50%,-50%) scale(${_symbolFaktor(n).toFixed(3)});">
             <span class="pd-geb-name">${_esc(n.label || 'Gebäude')}</span>
             <span class="pd-chips">${chips || '<span class="pd-chips-leer">ohne Anlagen</span>'}${mehr}</span>
           </div>`,
    iconSize: null,
  });
}

function _onNodeClick(n) {
  if (_mode === 'loeschen') {
    PD.nodes = PD.nodes.filter(x => x.id !== n.id);
    PD.links = PD.links.filter(l => l.a !== n.id && l.b !== n.id);
    _sel = null; _renderAll(); return;
  }
  if (_mode === 'kabel') {
    if (!_pendingA) { _pendingA = n.id; _pendingPts = []; _renderAll(); return; }
    if (_pendingA === n.id) { _pendingA = null; _pendingPts = []; _renderAll(); return; }
    const schonDa = PD.links.some(l =>
      (l.a === _pendingA && l.b === n.id) || (l.a === n.id && l.b === _pendingA));
    if (schonDa) { showHint('⚠ Diese beiden Einträge sind im Plan bereits verbunden.'); _pendingA = null; _pendingPts = []; _renderAll(); return; }
    const link = {
      id: 'pl' + (PD.seq++), a: _pendingA, b: n.id, label: '',
      points: _pendingPts.slice(),
      cableType: null, crossSection: 0, nParallel: 1, lengthM: null, msLevel: false, edgeId: null,
    };
    // Beschriftung aus dem Plan: die nächste Angabe am gezeichneten Linienzug,
    // die sich als Kabeltyp lesen lässt. Spart bei PDF-Plänen das Abtippen.
    const startKnoten = _node(_pendingA);
    if (startKnoten) {
      const treffer = _textNahLinie(_linkPunkte(link, startKnoten, n), 90, s => !!pdParseKabelLabel(s));
      if (treffer) _setzeKabelLabel(link, treffer.str);
    }
    PD.links.push(link);
    _pendingA = null;
    _pendingPts = [];
    _sel = { kind: 'link', id: link.id };
    _renderAll();
    setTimeout(() => document.getElementById('pd-f-kabel')?.focus(), 0);
    return;
  }
  _sel = { kind: 'node', id: n.id };
  _renderAll();
}

export function pdSelect(kind, id) {
  _sel = { kind, id };
  const it = kind === 'node' ? _node(id) : _link(id);
  if (it && _map) {
    const ziel = kind === 'node' ? _ll(it.x, it.y) : (() => {
      const a = _node(it.a), b = _node(it.b);
      return a && b ? _ll((a.x + b.x) / 2, (a.y + b.y) / 2) : null;
    })();
    if (ziel) _map.panTo(ziel);
  }
  _renderAll();
}

// ── Formular für die Auswahl ────────────────────────────────────────────────
function _verortungOptions(n) {
  const belegt = new Set(PD.nodes.filter(x => x.id !== n.id && x.linkKind === 'a').map(x => x.linkId));
  const assets = ASSETS.items
    .filter(a => a.domain === 'strom' || a.domain === 'hybrid')
    .filter(a => !belegt.has(a.id))
    .map(a => `<option value="a:${a.id}"${n.linkKind === 'a' && n.linkId === a.id ? ' selected' : ''}>${_esc(a.name)} · ${_esc(ASSET_CFG[a.type]?.label || a.type)}</option>`)
    .join('');
  const geb = (window.gebaeude || [])
    .map(g => `<option value="g:${g.id}"${n.linkKind === 'g' && String(n.linkId) === String(g.id) ? ' selected' : ''}>${_esc(g.name)}${g.gebaeudenummer ? ' (Nr. ' + _esc(g.gebaeudenummer) + ')' : ''}</option>`)
    .join('');
  return `<option value=""${!n.linkKind ? ' selected' : ''}>— offen —</option>
    ${assets ? `<optgroup label="Vorhandene Anlage auf der Karte">${assets}</optgroup>` : ''}
    ${geb ? `<optgroup label="Gebäude → neue Anlage anlegen">${geb}</optgroup>` : ''}`;
}

function _renderForm() {
  const box = document.getElementById('pd-form');
  if (!box) return;
  if (!PD.plan) {
    box.innerHTML = `<div class="pd-hint">Noch kein Plan geladen.<br><br>
      <b>📂 Plan laden</b> öffnet ein Bild oder eine PDF-Seite des Bestands-Einlinienplans.
      Danach im <b>Suchfeld</b> ein Gebäude über Nummer oder Name suchen und samt seiner
      Anlagen auf den Plan setzen; im Modus <b>⟋ Kabel</b> die Verbindungen nachziehen.</div>`;
    return;
  }
  if (!_sel) {
    box.innerHTML = `<div class="pd-hint">Nichts ausgewählt.<br><br>
      <b>🔎 Suchfeld</b>: Gebäudenummer eintippen, Treffer wählen, in den Plan klicken.<br>
      Modus <b>⊕ Knoten</b>: einzelne Betriebsmittel (Station, KV) anlegen.<br>
      Modus <b>⟋ Kabel</b>: zwei Einträge nacheinander anklicken.<br>
      Modus <b>🖱 Ansehen</b>: Einträge lassen sich verschieben.</div>`;
    return;
  }

  // Nur im Plan erfasstes Gebäude: Befund, kein Bestandsobjekt
  if (_sel.kind === 'node' && _node(_sel.id)?.fehlt) {
    const n = _node(_sel.id);
    const treffer = _kartenTreffer(n);
    box.innerHTML = `
      <div class="pd-form-head"><span class="pd-dot" style="background:${STATUS_COL.fehlt}"></span> Fehlt auf der Karte</div>
      <label class="pd-lbl">Bezeichnung im Plan</label>
      <input id="pd-f-label" class="pd-in" type="text" value="${_esc(n.label)}"
             data-change="pdUpdateNode('label', this.value)"/>
      <label class="pd-lbl">Gebäudenummer</label>
      <input class="pd-in" type="text" value="${_esc(n.gebNummer || '')}"
             placeholder="z. B. 135"
             data-change="pdUpdateNode('gebNummer', this.value)"/>
      ${treffer
        ? `<div class="pd-ok">Auf der Karte gibt es jetzt „${_esc(treffer.name)}"
             <button class="pd-mini" data-click="pdVerknuepfeFehlend('${n.id}')">→ verknüpfen</button></div>`
        : `<div class="pd-warn">Wird nicht übernommen — der Eintrag hält nur fest, dass der Plan
             dieses Gebäude kennt und die Karte nicht. Sobald es auf der Karte gezeichnet ist,
             erscheint hier ein Verknüpfen-Knopf.</div>`}
      ${_groessenZeile(n)}
      <button class="pd-mini pd-del" data-click="pdDeleteSelected()">✕ Aus dem Plan entfernen</button>`;
    return;
  }

  // Gebäude-Eintrag: Anschlusspunkt statt Typ/Verortung
  if (_sel.kind === 'node' && _istGebKnoten(_node(_sel.id))) {
    const n = _node(_sel.id);
    const g = _gebFuer(n);
    const st = _statusNode(n);
    const kand = _anschlussKandidaten(n.linkId);
    const an = _anschlussAsset(n);
    const typen = NODE_TYPES
      .map(t => `<option value="${t}"${t === n.assetType ? ' selected' : ''}>${_esc(ASSET_CFG[t]?.label || t)}</option>`)
      .join('');
    const liste = kand.map(a => {
      const c = ASSET_CFG[a.type] || {};
      return `<div class="pd-anschluss${a.id === an?.id ? ' an' : ''}"
                   data-click="pdUpdateNode('anschluss','${a.id}')"
                   title="Kabel an diesem Kasten enden an dieser Anlage">
                <span style="color:${c.color || '#90a4ae'}">${c.icon || '◻'}</span>
                <span class="pd-anschluss-name">${_esc(a.name)}</span>
                <span class="pd-anschluss-typ">${_esc(c.label || a.type)}</span>
              </div>`;
    }).join('');
    box.innerHTML = `
      <div class="pd-form-head"><span class="pd-dot" style="background:${STATUS_COL[st]}"></span> Gebäude</div>
      <div class="pd-route">${_esc(g?.name || '(Gebäude gelöscht)')}${g?.gebaeudenummer ? ` <span style="color:var(--muted)">· Nr. ${_esc(g.gebaeudenummer)}</span>` : ''}</div>
      <label class="pd-lbl">Beschriftung im Plan</label>
      <input id="pd-f-label" class="pd-in" type="text" value="${_esc(n.label)}"
             data-change="pdUpdateNode('label', this.value)"/>
      <label class="pd-lbl">Anschlusspunkt — hier enden die Kabel</label>
      ${kand.length
        ? `<div class="pd-anschluss-liste">${liste}</div>`
        : `<div class="pd-warn">Dieses Gebäude hat noch keine Anlage. Beim Übernehmen wird eine angelegt:</div>
           <select class="pd-in" data-change="pdUpdateNode('assetType', this.value)">${typen}</select>`}
      ${_groessenZeile(n)}
      <button class="pd-mini" data-click="pdZeigeAufKarte('${n.id}')">→ auf Karte zeigen</button>
      <button class="pd-mini pd-del" data-click="pdDeleteSelected()">✕ Aus dem Plan entfernen</button>`;
    return;
  }

  if (_sel.kind === 'node') {
    const n = _node(_sel.id);
    if (!n) { _sel = null; return _renderForm(); }
    const typen = NODE_TYPES
      .map(t => `<option value="${t}"${t === n.assetType ? ' selected' : ''}>${_esc(ASSET_CFG[t]?.label || t)}</option>`)
      .join('');
    const st = _statusNode(n);
    const asset = n.assetId ? ASSETS.items.find(a => a.id === n.assetId) : null;
    box.innerHTML = `
      <div class="pd-form-head"><span class="pd-dot" style="background:${STATUS_COL[st]}"></span> Betriebsmittel</div>
      <label class="pd-lbl">Bezeichnung im Plan</label>
      <input id="pd-f-label" class="pd-in" type="text" value="${_esc(n.label)}"
             placeholder="z. B. Station IV, KV 50"
             data-change="pdUpdateNode('label', this.value)"/>
      <label class="pd-lbl">Komponententyp</label>
      <select class="pd-in" data-change="pdUpdateNode('assetType', this.value)">${typen}</select>
      <label class="pd-lbl">Verortung auf der Karte</label>
      <select class="pd-in" data-change="pdUpdateNode('verortung', this.value)">${_verortungOptions(n)}</select>
      ${asset ? `<div class="pd-ok">✔ übernommen als „${_esc(asset.name)}"
             <button class="pd-mini" data-click="pdZeigeAufKarte('${n.id}')">→ auf Karte zeigen</button></div>` : ''}
      ${!n.linkKind && !asset ? `<div class="pd-warn">Ohne Verortung wird dieser Eintrag nicht übernommen.</div>` : ''}
      ${_groessenZeile(n)}
      <button class="pd-mini pd-del" data-click="pdDeleteSelected()">✕ Aus dem Plan entfernen</button>`;
    return;
  }

  const l = _link(_sel.id);
  if (!l) { _sel = null; return _renderForm(); }
  const a = _node(l.a), b = _node(l.b);
  const st = _statusLink(l);
  const endA = _zielAsset(a), endB = _zielAsset(b);
  // Zwei Faelle, die eine Planlinie fast nie meint:
  //   gleiche Anlage  -- beide Eintraege landen auf demselben Asset; daraus
  //                      wuerde eine Kante von einem Knoten auf sich selbst
  //   gleiches Gebaeude -- addStromEdge setzt stationsintern, Laenge 0
  const gleicheAnlage = !!(endA && endB && endA.id === endB.id);
  const gleichesGeb = !gleicheAnlage && endA && endB && endA.buildingId != null
    && String(endA.buildingId) === String(endB.buildingId);
  const p = l.cableType || l.crossSection
    ? `${l.cableType || '?'} · ${l.crossSection || '?'} mm²${l.nParallel > 1 ? ` · ${l.nParallel} Systeme` : ''}${l.msLevel ? ' · MS' : ''}`
    : null;
  const unbekannt = l.cableType && !KABEL_TYPEN[l.cableType];
  box.innerHTML = `
    <div class="pd-form-head"><span class="pd-dot" style="background:${STATUS_COL[st]}"></span> Kabel</div>
    <div class="pd-route">${_esc(a?.label || '?')} <span style="color:var(--muted)">→</span> ${_esc(b?.label || '?')}</div>
    <div class="pd-enden">
      <span>${endA ? _esc(endA.name) + ' <i>' + _esc(ASSET_CFG[endA.type]?.label || endA.type) + '</i>' : '<i>noch keine Anlage</i>'}</span>
      <span class="pd-enden-pfeil">→</span>
      <span>${endB ? _esc(endB.name) + ' <i>' + _esc(ASSET_CFG[endB.type]?.label || endB.type) + '</i>' : '<i>noch keine Anlage</i>'}</span>
    </div>
    ${gleicheAnlage ? `<div class="pd-warn">Beide Enden zeigen auf <b>dieselbe Anlage</b> (${_esc(endA.name)}).
      Dieses Kabel wird nicht übernommen. Oben den Anschlusspunkt eines der beiden
      Kästen auf eine andere Anlage stellen — oder prüfen, ob beide Einträge
      versehentlich auf dasselbe Gebäude verortet sind.</div>` : ''}
    ${gleichesGeb ? `<div class="pd-warn">Beide Enden liegen in <b>${_esc((window.gebaeude || []).find(x => String(x.id) === String(endA.buildingId))?.name || 'demselben Gebäude')}</b>.
      Das Kabel wird stationsintern mit 0 m angelegt. Falls die Planlinie zwei verschiedene
      Gebäude verbindet, oben den Anschlusspunkt des jeweiligen Kastens prüfen.</div>` : ''}
    <label class="pd-lbl">Beschriftung aus dem Plan</label>
    <input id="pd-f-kabel" class="pd-in" type="text" value="${_esc(l.label)}"
           placeholder="z. B. NYY-J 5x70 oder 3x NA2XS2Y 1x185"
           data-change="pdUpdateLink('label', this.value)"/>
    ${p ? `<div class="pd-parsed">erkannt: ${_esc(p)}</div>` : `<div class="pd-warn">Noch keine Kabelangabe erkannt.</div>`}
    ${unbekannt ? `<div class="pd-warn">Typ „${_esc(l.cableType)}" ist nicht in der Kabeltabelle — Auslegung fällt auf NAYY zurück.</div>` : ''}
    <div class="pd-stuetz">
      <span>${(l.points || []).length} Stützpunkt${(l.points || []).length === 1 ? '' : 'e'} entlang der Planlinie</span>
      ${(l.points || []).length ? `<button class="pd-mini" data-click="pdUpdateLink('pointsClear','')">gerade ziehen</button>` : ''}
    </div>
    <label class="pd-lbl">Länge laut Plan (m, optional)</label>
    <input class="pd-in" type="number" min="0" step="1" value="${l.lengthM ?? ''}"
           placeholder="leer = aus Trassenrouting"
           data-change="pdUpdateLink('lengthM', this.value)"/>
    <button class="pd-mini pd-del" data-click="pdDeleteSelected()">✕ Kabel entfernen</button>`;
}

// An welcher Anlage landet ein Kabel, das an diesem Eintrag endet?
// Genau die Anlage, die pdApply() spaeter verwendet -- damit das Formular
// nicht etwas anderes anzeigt, als hinterher auf der Karte entsteht.
function _zielAsset(n) {
  if (!n) return null;
  if (n.assetId) {
    const a = ASSETS.items.find(x => x.id === n.assetId);
    if (a) return a;
  }
  if (_istGebKnoten(n)) return _anschlussAsset(n);
  if (n.linkKind === 'a') return ASSETS.items.find(x => x.id === n.linkId) || null;
  if (n.linkKind === 'g') return getAssetsForBuilding(n.linkId).find(a => a.type === n.assetType) || null;
  return null;
}

// Größenzeile im Formular — zum genauen Einstellen, wenn der Eckgriff zu grob ist
function _groessenZeile(n) {
  const p = Math.round(_begrenzeSkala(n.skala ?? 1) * 100);
  return `<div class="pd-stuetz">
    <span>Größe im Plan <span style="opacity:.7">(Eckgriff ziehen)</span></span>
    <span class="pd-groesse">
      <button class="pd-head-btn" data-click="pdNodeGroesse(-1)" title="kleiner">−</button>
      <span id="pd-node-groesse" data-click="pdNodeGroesse(0)" title="Auf 100 % zurücksetzen">${p}\u2009%</span>
      <button class="pd-head-btn" data-click="pdNodeGroesse(1)" title="größer">+</button>
    </span>
  </div>`;
}

// Gebäude anhand der Plan-Beschriftung vorschlagen ("Gebäude 13" → Nr. 13)
function _rateGebaeude(label) {
  const num = String(label || '').match(/(\d+)\s*$/)?.[1];
  if (!num) return null;
  const list = window.gebaeude || [];
  return list.find(g => String(g.gebaeudenummer || '').trim() === num)
      || list.find(g => String(g.name || '').match(/(\d+)\s*$/)?.[1] === num)
      || null;
}

export function pdUpdateNode(feld, wert) {
  const n = _node(_sel?.id);
  if (!n) return;
  if (feld === 'label') {
    n.label = wert;
    // Nur vorschlagen, solange nichts von Hand gewählt wurde
    if (!n.linkKind) {
      const g = _rateGebaeude(wert);
      if (g) { n.linkKind = 'g'; n.linkId = g.id; }
    }
  } else if (feld === 'gebNummer') {
    n.gebNummer = String(wert || '').trim();
  } else if (feld === 'assetType') {
    n.assetType = wert;
  } else if (feld === 'anschluss') {
    n.anschlussAssetId = wert || null;
    // Der Anschlusspunkt IST die übernommene Anlage — sonst zeigten Status und
    // später gezogene Kabel auf verschiedene Assets desselben Gebäudes.
    if (wert && ASSETS.items.some(a => a.id === wert)) n.assetId = wert;
  } else if (feld === 'verortung') {
    if (!wert) { n.linkKind = null; n.linkId = null; }
    else {
      const [k, id] = [wert.slice(0, 1), wert.slice(2)];
      n.linkKind = k;
      n.linkId = k === 'g' ? (Number.isNaN(Number(id)) ? id : Number(id)) : id;
      // Bei einer vorhandenen Anlage bestimmt deren Typ den Knotentyp
      if (k === 'a') {
        const a = ASSETS.items.find(x => x.id === n.linkId);
        if (a) { n.assetType = a.type; if (!n.label) n.label = a.name; }
      }
    }
  }
  _renderAll();
}

export function pdUpdateLink(feld, wert) {
  const l = _link(_sel?.id);
  if (!l) return;
  if (feld === 'label') {
    _setzeKabelLabel(l, wert);
  } else if (feld === 'pointsClear') {
    l.points = [];
  } else if (feld === 'lengthM') {
    const v = parseFloat(wert);
    l.lengthM = Number.isFinite(v) && v > 0 ? v : null;
  }
  _renderAll();
}

export function pdDeleteSelected() {
  if (!_sel) return;
  if (_sel.kind === 'node') {
    PD.nodes = PD.nodes.filter(x => x.id !== _sel.id);
    PD.links = PD.links.filter(l => l.a !== _sel.id && l.b !== _sel.id);
  } else {
    PD.links = PD.links.filter(x => x.id !== _sel.id);
  }
  _sel = null;
  _renderAll();
}

export function pdZeigeAufKarte(nodeId) {
  const n = _node(nodeId);
  if (!n) return;
  const a = n.assetId ? ASSETS.items.find(x => x.id === n.assetId) : null;
  if (a && a.lat != null) {
    map.flyTo([a.lat, a.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
    return;
  }
  // Gebäude-Eintrag ohne Anlage: wenigstens auf das Gebäude springen
  const g = _istGebKnoten(n) ? _gebFuer(n) : null;
  if (g) { flyTo(g.id); return; }
  showHint('⚠ Für diesen Eintrag gibt es (noch) keine Anlage auf der Karte.');
}

// ── Liste + Fortschritt ─────────────────────────────────────────────────────
function _renderList() {
  const box = document.getElementById('pd-list');
  if (!box) return;
  const ab = PD.plan ? pdAbgleich() : null;
  const zahl = document.getElementById('pd-tab-zahl');
  if (zahl) {
    zahl.textContent = ab && ab.nurKarte.length ? ab.nurKarte.length : '';
    zahl.className = 'pd-tab-zahl' + (ab && ab.nurKarte.length ? ' warn' : '');
  }
  if (!PD.plan) { box.innerHTML = ''; return; }
  if (_seite === 'abgleich') { _renderAbgleich(box, ab); return; }
  const zeile = (kind, id, st, txt, sub) => `
    <div class="pd-row${_sel?.kind === kind && _sel.id === id ? ' sel' : ''}" data-click="pdSelect('${kind}','${id}')">
      <span class="pd-dot" style="background:${STATUS_COL[st]}"></span>
      <span class="pd-row-txt">${_esc(txt)}</span>
      <span class="pd-row-sub">${_esc(sub)}</span>
    </div>`;
  const nodes = PD.nodes.map(n => {
    const anz = _istGebKnoten(n) ? _anschlussKandidaten(n.linkId).length : 0;
    const sub = _istGebKnoten(n)
      ? (anz ? `${anz} Anlage${anz === 1 ? '' : 'n'}` : 'ohne Anlagen')
      : (ASSET_CFG[n.assetType]?.label || n.assetType);
    return zeile('node', n.id, _statusNode(n), n.label || '(ohne Bezeichnung)', sub);
  }).join('');
  const links = PD.links.map(l => {
    const a = _node(l.a), b = _node(l.b);
    return zeile('link', l.id, _statusLink(l),
      `${a?.label || '?'} → ${b?.label || '?'}`, l.label || 'ohne Angabe');
  }).join('');
  box.innerHTML =
    `<div class="pd-list-head">Einträge (${PD.nodes.length})</div>${nodes || '<div class="pd-empty">—</div>'}
     <div class="pd-list-head">Kabel (${PD.links.length})</div>${links || '<div class="pd-empty">—</div>'}`;
}

// Zweite Richtung des Abgleichs: was steht auf der Karte, aber in keinem
// Plan-Eintrag? Diese Liste kann man nicht übersehen, indem man nicht hinschaut.
function _renderAbgleich(box, ab) {
  const zeile = o => {
    const setzen = o.art === 'g' ? `pdPlatziereGebaeude('${o.id}')` : `pdPlatziereAsset('${o.id}')`;
    return `<div class="pd-ab-row">
      <span class="pd-dot" style="background:${STATUS_COL.offen}"></span>
      <span class="pd-row-txt" title="${_esc(o.name)}">${_esc(o.name)}</span>
      <span class="pd-row-sub">${_esc(o.zusatz)}</span>
      <span class="pd-ab-akt">
        <button class="pd-mini" data-click="${setzen}" title="Im Plan gefunden — jetzt setzen">im Plan setzen</button>
        <button class="pd-mini" data-click="pdZeigeKarte('${o.art}','${o.id}')" title="Auf der Karte zeigen (wechselt ins Fenster)">→ Karte</button>
        <button class="pd-mini" data-click="pdAbhaken('${o.art}','${o.id}')" title="Steht bewusst nicht auf dem Plan">abhaken</button>
      </span>
    </div>`;
  };
  const abgehakt = o => `<div class="pd-ab-row erledigt">
      <span class="pd-dot" style="background:#546e7a"></span>
      <span class="pd-row-txt">${_esc(o.name)}</span>
      <span class="pd-row-sub">${_esc(o.grund)}</span>
      <span class="pd-ab-akt">
        <button class="pd-mini" data-click="pdAbhaken('${o.art}','${o.id}')" title="Abhaken rückgängig">↺</button>
      </span>
    </div>`;

  const offenPlan = ab.nurImPlan.length;
  const fehltZeile = n => {
    const treffer = _kartenTreffer(n);
    return `<div class="pd-ab-row">
      <span class="pd-dot" style="background:${STATUS_COL.fehlt}"></span>
      <span class="pd-row-txt">${_esc(n.label || '(ohne Bezeichnung)')}</span>
      <span class="pd-row-sub">${n.gebNummer ? 'Nr. ' + _esc(n.gebNummer) : 'ohne Nummer'}</span>
      <span class="pd-ab-akt">
        ${treffer ? `<button class="pd-mini" data-click="pdVerknuepfeFehlend('${n.id}')"
              title="Auf der Karte gefunden: ${_esc(treffer.name)}">→ verknüpfen</button>` : ''}
        <button class="pd-mini" data-click="pdSelect('node','${n.id}')">zeigen</button>
      </span>
    </div>`;
  };
  box.innerHTML = `
    <div class="pd-ab-kopf">
      <div><b>${ab.beidseitig.length}</b> beidseitig</div>
      <div class="${ab.fehlt.length ? 'fehl' : ''}"><b>${ab.fehlt.length}</b> fehlt auf der Karte</div>
      <div class="${ab.nurKarte.length ? 'warn' : ''}"><b>${ab.nurKarte.length}</b> nur auf der Karte</div>
      <div class="${offenPlan ? 'warn' : ''}"><b>${offenPlan}</b> noch nicht verortet</div>
    </div>
    <button class="pd-mini pd-ab-export" data-click="pdAbgleichKopieren()"
            title="Alle vier Körbe als Tabelle in die Zwischenablage">⧉ Abgleich als Tabelle kopieren</button>
    ${ab.fehlt.length ? `<div class="pd-list-head">Fehlt auf der Karte (${ab.fehlt.length})</div>
      ${ab.fehlt.map(fehltZeile).join('')}` : ''}
    ${offenPlan ? `<div class="pd-list-head">Im Plan, noch nicht verortet (${offenPlan})</div>
      ${ab.nurImPlan.map(n => `<div class="pd-row" data-click="pdSelect('node','${n.id}')">
          <span class="pd-dot" style="background:${STATUS_COL[_statusNode(n)]}"></span>
          <span class="pd-row-txt">${_esc(n.label || '(ohne Bezeichnung)')}</span>
          <span class="pd-row-sub">ohne Gegenstück</span></div>`).join('')}
      <div class="pd-ab-hinweis">Noch keiner Karte zugeordnet — über das Suchfeld verknüpfen,
        oder als <b>fehlend</b> erfassen, wenn es auf der Karte gar nicht existiert.</div>` : ''}
    <div class="pd-list-head">Nur auf der Karte (${ab.nurKarte.length})</div>
    ${ab.nurKarte.length
      ? ab.nurKarte.map(zeile).join('')
      : '<div class="pd-empty">— nichts offen</div>'}
    ${ab.abgehakt.length ? `<div class="pd-list-head">Bewusst nicht im Plan (${ab.abgehakt.length})</div>
      ${ab.abgehakt.map(abgehakt).join('')}` : ''}
    <div class="pd-ab-hinweis">„Fehlt auf der Karte" sind reine Befunde — sie legen bewusst kein
      Gebäude an: ohne Grundriss gäbe es keine Fläche, und der Wärmebedarf wird aus der Fläche
      gerechnet. Sobald das Gebäude auf der Karte gezeichnet ist, taucht hier „verknüpfen" auf.</div>
    <div class="pd-ab-hinweis">Geprüft wird nur die Schicht <b>Bestand</b> — Neubauten und
      Planungsobjekte fehlen auf einem Bestandsplan zu Recht. Anlagen zählen nur mit,
      wenn sie keinem Gebäude zugeordnet sind.</div>`;
}

function _renderFortschritt() {
  const el = document.getElementById('pd-fortschritt');
  if (!el) return;
  if (!PD.plan) { el.textContent = 'kein Plan geladen'; return; }
  const nOk = PD.nodes.filter(n => _statusNode(n) === 'ok').length;
  const lOk = PD.links.filter(l => _statusLink(l) === 'ok').length;
  // Die Kartenseite gehört dazu: ohne sie liest sich „12/12" wie „fertig",
  // obwohl vierzig Gebäude nie betrachtet wurden.
  const ab = pdAbgleich();
  el.innerHTML = `<b>${_esc(PD.plan.name)}</b> · Einträge ${nOk}/${PD.nodes.length} · Kabel ${lOk}/${PD.links.length}`
    + (ab.nurKarte.length ? ` · <span class="pd-offen">Karte: ${ab.nurKarte.length} nicht im Plan</span>` : ' · Karte vollständig')
    + (ab.fehlt.length ? ` · <span class="pd-fehl">${ab.fehlt.length} fehlt auf der Karte</span>` : '');
}

function _renderAll() {
  _renderMarks();
  _renderForm();
  _renderList();
  _renderFortschritt();
}

// ── Übernahme in Karte + Stromnetz ──────────────────────────────────────────
export function pdApply() {
  if (!PD.plan) { showHint('⚠ Erst einen Plan laden.'); return; }
  if (!PD.nodes.length) { showHint('⚠ Noch keine Einträge im Plan markiert.'); return; }

  const bericht = { assetsNeu: 0, assetsVerknuepft: 0, kabelNeu: 0, offeneKnoten: 0, offeneKabel: 0, selbstbezug: 0, fehlend: 0 };

  const mutate = () => {
    // 1 · Einträge → Assets
    for (const n of PD.nodes) {
      if (n.assetId && ASSETS.items.some(a => a.id === n.assetId)) continue;
      // Als fehlend erfasste Gebäude sind Befunde, keine anzulegenden Objekte.
      if (n.fehlt) { bericht.fehlend++; continue; }
      if (!n.linkKind) { bericht.offeneKnoten++; continue; }

      if (n.linkKind === 'a') {
        const a = ASSETS.items.find(x => x.id === n.linkId);
        if (!a) { bericht.offeneKnoten++; continue; }
        n.assetId = a.id;
        bericht.assetsVerknuepft++;
        continue;
      }

      const g = _gebFuer(n);
      if (!g || !g.polygon || g.polygon.length < 3) { bericht.offeneKnoten++; continue; }
      // Gebäude-Eintrag: der gewählte Anschlusspunkt (sonst die netzseitigste Anlage).
      // Betriebsmittel-Eintrag: eine gleichartige Anlage am Gebäude wiederverwenden
      // statt sie zu doppeln.
      const vorhanden = _istGebKnoten(n)
        ? _anschlussAsset(n)
        : getAssetsForBuilding(g.id).find(a => a.type === n.assetType);
      if (vorhanden) {
        n.assetId = vorhanden.id;
        if (_istGebKnoten(n)) n.anschlussAssetId = vorhanden.id;
        bericht.assetsVerknuepft++;
        continue;
      }
      const c = polygonCenter(g.polygon);
      const asset = createAsset(n.assetType, c.lat, c.lng, {
        buildingId: g.id,
        name: n.label || `${ASSET_CFG[n.assetType]?.label || n.assetType} ${g.name}`,
      });
      if (!asset) { bericht.offeneKnoten++; continue; }
      drawAssetMarker(asset);
      n.assetId = asset.id;
      if (_istGebKnoten(n)) n.anschlussAssetId = asset.id;
      bericht.assetsNeu++;
    }

    // 2 · Kabel → stromEdges (Geometrie kommt aus dem Trassenrouting)
    for (const l of PD.links) {
      if (l.edgeId && (window.stromEdges || []).some(e => e.id === l.edgeId)) continue;
      const a = _node(l.a), b = _node(l.b);
      if (!a?.assetId || !b?.assetId) { bericht.offeneKabel++; continue; }
      // Beide Eintraege auf derselben Anlage verortet: eine Kante von einem
      // Knoten auf sich selbst waere kaputte Netzstruktur (Laenge 0, Endlos-
      // schleife in jeder Baumtraversierung). Lieber offen lassen und melden.
      if (a.assetId === b.assetId) { bericht.selbstbezug++; continue; }
      const dup = (window.stromEdges || []).find(e =>
        (e.u === a.assetId && e.v === b.assetId) || (e.u === b.assetId && e.v === a.assetId));
      if (dup) { l.edgeId = dup.id; continue; }

      const edge = addStromEdge(a.assetId, b.assetId);
      if (!edge) { bericht.offeneKabel++; continue; }
      if (l.cableType && KABEL_TYPEN[l.cableType]) edge.cableType = l.cableType;
      if (l.crossSection > 0) {
        edge.crossSection = l.crossSection;
        // Bestandskabel sind gegeben — nicht automatisch mitwachsen lassen,
        // sonst verschwindet der Engpass, den der Bestand gerade beweist.
        edge.autoSized = false;
      }
      edge.nParallel = Math.max(1, l.nParallel || 1);
      if (l.msLevel) edge.msLevel = true;
      if (l.lengthM != null) edge.lengthM = l.lengthM;
      l.edgeId = edge.id;
      bericht.kabelNeu++;
    }
  };

  if (typeof runPlanningTransaction === 'function') runPlanningTransaction('Bestandsplan übernehmen', mutate);
  else mutate();

  redrawAllAssets();
  renderSidebarAssetList();
  recalcStromNetz();
  if (typeof window.updateStromEdgeVisuals === 'function') window.updateStromEdgeVisuals();
  if (typeof window.sldRefresh === 'function') window.sldRefresh();
  _renderAll();

  const teile = [];
  if (bericht.assetsNeu) teile.push(`${bericht.assetsNeu} Anlage(n) neu`);
  if (bericht.assetsVerknuepft) teile.push(`${bericht.assetsVerknuepft} verknüpft`);
  if (bericht.kabelNeu) teile.push(`${bericht.kabelNeu} Kabel`);
  const offen = [];
  if (bericht.offeneKnoten) offen.push(`${bericht.offeneKnoten} Eintrag/Einträge ohne Verortung`);
  if (bericht.offeneKabel) offen.push(`${bericht.offeneKabel} Kabel ohne beide Endpunkte`);
  if (bericht.selbstbezug) offen.push(`${bericht.selbstbezug} Kabel mit identischer Anlage an beiden Enden`);
  if (bericht.fehlend) offen.push(`${bericht.fehlend} Gebäude fehl${bericht.fehlend === 1 ? 't' : 'en'} auf der Karte`);
  showHint(
    (teile.length ? '✔ Übernommen: ' + teile.join(', ') + '.' : 'Nichts Neues zu übernehmen.')
    + (offen.length ? ' Offen: ' + offen.join(', ') + '.' : ''));
}

// ── Persistenz (Projektdatei) ───────────────────────────────────────────────
export function pdSerialize() {
  if (!PD.plan) return null;
  return {
    plan: { ...PD.plan },
    nodes: PD.nodes.map(n => ({ ...n })),
    links: PD.links.map(l => ({ ...l })),
    seq: PD.seq,
    gebGroesse: PD.gebGroesse || 1,
    abgehakt: { ...PD.abgehakt },
  };
}

export function pdDeserialize(data) {
  // Auch die Symbolgroesse zuruecksetzen: ohne das traegt ein Projekt ohne
  // Bestandsplan die Einstellung der vorigen Liegenschaft weiter.
  PD.plan = null; PD.nodes = []; PD.links = []; PD.seq = 1; PD.gebGroesse = 1; PD.abgehakt = {};
  _sel = null; _pendingA = null; _pendingSetzen = null;
  if (_imgLayer) { _imgLayer.remove(); _imgLayer = null; }
  if (data && data.plan && data.plan.url) {
    PD.plan = { ...data.plan };
    PD.nodes = Array.isArray(data.nodes) ? data.nodes.map(n => ({ ...n })) : [];
    PD.links = Array.isArray(data.links) ? data.links.map(l => ({ ...l })) : [];
    PD.seq = data.seq || (PD.nodes.length + PD.links.length + 1);
    PD.gebGroesse = Number.isFinite(data.gebGroesse) ? data.gebGroesse : 1;
    PD.abgehakt = (data.abgehakt && typeof data.abgehakt === 'object') ? { ...data.abgehakt } : {};
    if (_map) _showPlanLayer();
  } else {
    _marks?.clearLayers();
  }
  if (document.getElementById(PANEL_ID)) { _zeigeGroesse(); _renderAll(); }
}
