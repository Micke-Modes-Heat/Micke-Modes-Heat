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

const PANEL_ID = 'plandigi-panel';
const MAP_ID   = 'plandigi-map';

// Typen, die auf einem NS-/MS-Bestandsplan als Kästchen auftauchen
const NODE_TYPES = ['NAP', 'Schaltanlage', 'Trafo', 'NSHV', 'UV', 'KVS', 'Verbraucher', 'Lade', 'PV', 'Batterie', 'Nsa'];

const STATUS_COL = { ok: '#4caf50', bereit: '#f9a825', offen: '#90a4ae' };

// ── Zustand ─────────────────────────────────────────────────────────────────
// plan:  { name, url, w, h }            — Bilddaten + Pixelmaße
// nodes: { id, x, y, art, label, assetType, linkKind:'a'|'g'|null, linkId, assetId }
//        art 'komponente' — ein einzelnes Betriebsmittel (Station, KV, Trafo …)
//        art 'gebaeude'   — ein ganzes Gebäude samt seiner Anlagen; linkId ist
//                           die Gebäude-ID, anschlussAssetId die Anlage, an der
//                           die Kabel landen (netzseitigste, überschreibbar)
// links: { id, a, b, label, cableType, crossSection, nParallel, lengthM, msLevel, edgeId }
export const PD = { plan: null, nodes: [], links: [], seq: 1 };

let _map = null, _imgLayer = null, _marks = null;
let _mode = 'ansehen';
let _sel = null;        // { kind:'node'|'link', id }
let _pendingA = null;   // erster Knoten im Kabel-Modus
let _pendingGeb = null; // aus der Suche gewähltes Gebäude, wartet auf den Platzierungsklick
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
        <button class="pd-mode" data-mode="loeschen" data-click="pdSetMode('loeschen')" title="Eintrag oder Kabel im Plan anklicken → entfernen">✕ Löschen</button>
      </span>
      <span class="pd-modehint" id="pd-modehint"></span>
    </div>
    <div class="pd-body">
      <div id="${MAP_ID}" class="pd-map"></div>
      <div class="pd-side">
        <div id="pd-form" class="pd-form"></div>
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
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    _setPlan(canvas.toDataURL('image/png'), canvas.width, canvas.height,
      pdf.numPages > 1 ? `${name} (S. ${pageNr})` : name);
  } catch (e) {
    console.error('Plan-PDF fehlgeschlagen:', e);
    showHint('⚠ PDF konnte nicht geladen werden: ' + name);
  }
}

function _setPlan(url, w, h, name) {
  const hatMarken = PD.nodes.length > 0 || PD.links.length > 0;
  PD.plan = { name, url, w, h };
  if (!hatMarken) { PD.nodes = []; PD.links = []; PD.seq = 1; }
  _sel = null; _pendingA = null; _pendingGeb = null;
  _ensureMap();
  _showPlanLayer();
  _renderAll();
  showHint(hatMarken
    ? `Plan „${name}" ersetzt — vorhandene Markierungen bleiben erhalten.`
    : `Plan „${name}" geladen. Gebäude über das Suchfeld auf den Plan setzen oder im Modus „⊕ Knoten" einzelne Betriebsmittel anlegen.`);
}

export function pdClear() {
  PD.plan = null; PD.nodes = []; PD.links = []; PD.seq = 1;
  _sel = null; _pendingA = null; _pendingGeb = null;
  if (_imgLayer) { _imgLayer.remove(); _imgLayer = null; }
  _marks?.clearLayers();
  _renderAll();
}

// ── Modi ────────────────────────────────────────────────────────────────────
const MODE_HINWEIS = {
  ansehen:  'Ziehen verschiebt den Plan, Mausrad zoomt. Einträge lassen sich an die richtige Stelle ziehen.',
  knoten:   'Klick auf ein Kästchen legt ein einzelnes Betriebsmittel an — ganze Gebäude besser über das Suchfeld.',
  kabel:    'Ersten Eintrag anklicken, dann den zweiten. Esc bricht eine begonnene Verbindung ab.',
  loeschen: 'Klick auf Eintrag oder Kabel entfernt ihn aus dem Plan (nicht von der Karte).',
};

export function pdSetMode(m) {
  _mode = m;
  _pendingA = null;
  _pendingGeb = null;   // ein Moduswechsel verwirft eine offene Gebäude-Platzierung
  document.querySelectorAll('#' + PANEL_ID + ' .pd-mode')
    .forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  const div = document.getElementById(MAP_ID);
  if (div) div.style.cursor = (m === 'ansehen') ? '' : 'crosshair';
  const hint = document.getElementById('pd-modehint');
  if (hint) hint.textContent = MODE_HINWEIS[m] || '';
  _renderMarks();
}

// Esc: erst die offene Gebäude-Platzierung, dann die begonnene Kabelverbindung,
// dann der Zeichenmodus. Das Panel bleibt bewusst offen, damit eine
// Fehlbedienung keine Arbeit kostet.
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || !_istOffen()) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (_pendingGeb) { _pendingGeb = null; pdSetMode(_mode); return; }
  if (_pendingA) { _pendingA = null; _renderAll(); return; }
  if (_mode !== 'ansehen') pdSetMode('ansehen');
});

function _onMapClick(e) {
  if (!PD.plan) { showHint('⚠ Erst einen Plan laden.'); return; }
  const p = _xy(e.latlng);
  if (_pendingGeb) { _setzeGebaeudeKnoten(_pendingGeb, p); return; }
  if (_mode !== 'knoten') { if (_mode === 'kabel') _pendingA = null; _renderAll(); return; }
  const node = {
    id: 'pn' + (PD.seq++), x: Math.round(p.x), y: Math.round(p.y),
    art: 'komponente',
    label: '', assetType: 'Verbraucher', linkKind: null, linkId: null, assetId: null,
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
    box.innerHTML = '<div class="pd-suche-leer">Kein Gebäude gefunden</div>';
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
  pdSetMode('knoten');   // setzt _pendingGeb zurück …
  _pendingGeb = g;       // … deshalb erst danach setzen
  const anz = _anschlussKandidaten(g.id).length;
  const hint = document.getElementById('pd-modehint');
  if (hint) {
    hint.innerHTML = `Klick in den Plan setzt <b>${_esc(g.name)}</b>`
      + (anz ? ` samt ${anz} Anlage${anz === 1 ? '' : 'n'}` : ' (Gebäude hat noch keine Anlagen)')
      + ' — Esc bricht ab.';
  }
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
  _pendingGeb = null;
  _sel = { kind: 'node', id: node.id };
  pdSetMode(_mode);      // Modushinweis zurücksetzen
  _renderAll();
  const feld = document.getElementById('pd-suche');
  if (feld) { feld.value = ''; feld.focus(); }
}

// ── Markierungen zeichnen ───────────────────────────────────────────────────
function _statusNode(n) {
  if (n.assetId && ASSETS.items.some(a => a.id === n.assetId)) return 'ok';
  if (n.linkKind) return 'bereit';
  return 'offen';
}

function _statusLink(l) {
  if (l.edgeId && (window.stromEdges || []).some(e => e.id === l.edgeId)) return 'ok';
  const a = _node(l.a), b = _node(l.b);
  if (a && b && _statusNode(a) !== 'offen' && _statusNode(b) !== 'offen') return 'bereit';
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
    const line = L.polyline([_ll(a.x, a.y), _ll(b.x, b.y)], {
      color: aktiv ? '#ffffff' : STATUS_COL[st],
      weight: aktiv ? 5 : 3, opacity: 0.9,
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
  }
}

// Einzelnes Betriebsmittel: kleiner farbiger Punkt mit Typ-Symbol
function _komponentenIcon(n, st, hervor) {
  const cfg = ASSET_CFG[n.assetType] || {};
  const rand = hervor ? '#ffffff' : 'rgba(0,0,0,.6)';
  return L.divIcon({
    className: 'pd-node-icon',
    html: `<div class="pd-node" style="background:${STATUS_COL[st]};border-color:${rand};${hervor ? 'box-shadow:0 0 0 3px rgba(255,255,255,.35);' : ''}">
             <span>${cfg.icon || '◻'}</span>
           </div>
           <div class="pd-node-lbl">${_esc(n.label || '?')}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

// Ganzes Gebäude: Kasten wie auf dem Papierplan, darunter die Anlagen als
// Symbolreihe. Der gewählte Anschlusspunkt ist hervorgehoben — dort landen die
// Kabel, die an diesem Kasten enden.
function _gebaeudeIcon(n, st, hervor) {
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
    html: `<div class="pd-geb${hervor ? ' sel' : ''}" style="border-color:${STATUS_COL[st]}">
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
    if (!_pendingA) { _pendingA = n.id; _renderAll(); return; }
    if (_pendingA === n.id) { _pendingA = null; _renderAll(); return; }
    const schonDa = PD.links.some(l =>
      (l.a === _pendingA && l.b === n.id) || (l.a === n.id && l.b === _pendingA));
    if (schonDa) { showHint('⚠ Diese beiden Einträge sind im Plan bereits verbunden.'); _pendingA = null; _renderAll(); return; }
    const link = {
      id: 'pl' + (PD.seq++), a: _pendingA, b: n.id, label: '',
      cableType: null, crossSection: 0, nParallel: 1, lengthM: null, msLevel: false, edgeId: null,
    };
    PD.links.push(link);
    _pendingA = null;
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
      <button class="pd-mini pd-del" data-click="pdDeleteSelected()">✕ Aus dem Plan entfernen</button>`;
    return;
  }

  const l = _link(_sel.id);
  if (!l) { _sel = null; return _renderForm(); }
  const a = _node(l.a), b = _node(l.b);
  const st = _statusLink(l);
  const p = l.cableType || l.crossSection
    ? `${l.cableType || '?'} · ${l.crossSection || '?'} mm²${l.nParallel > 1 ? ` · ${l.nParallel} Systeme` : ''}${l.msLevel ? ' · MS' : ''}`
    : null;
  const unbekannt = l.cableType && !KABEL_TYPEN[l.cableType];
  box.innerHTML = `
    <div class="pd-form-head"><span class="pd-dot" style="background:${STATUS_COL[st]}"></span> Kabel</div>
    <div class="pd-route">${_esc(a?.label || '?')} <span style="color:var(--muted)">→</span> ${_esc(b?.label || '?')}</div>
    <label class="pd-lbl">Beschriftung aus dem Plan</label>
    <input id="pd-f-kabel" class="pd-in" type="text" value="${_esc(l.label)}"
           placeholder="z. B. NYY-J 5x70 oder 3x NA2XS2Y 1x185"
           data-change="pdUpdateLink('label', this.value)"/>
    ${p ? `<div class="pd-parsed">erkannt: ${_esc(p)}</div>` : `<div class="pd-warn">Noch keine Kabelangabe erkannt.</div>`}
    ${unbekannt ? `<div class="pd-warn">Typ „${_esc(l.cableType)}" ist nicht in der Kabeltabelle — Auslegung fällt auf NAYY zurück.</div>` : ''}
    <label class="pd-lbl">Länge laut Plan (m, optional)</label>
    <input class="pd-in" type="number" min="0" step="1" value="${l.lengthM ?? ''}"
           placeholder="leer = aus Trassenrouting"
           data-change="pdUpdateLink('lengthM', this.value)"/>
    <button class="pd-mini pd-del" data-click="pdDeleteSelected()">✕ Kabel entfernen</button>`;
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
    l.label = wert;
    const p = pdParseKabelLabel(wert);
    if (p) {
      l.cableType = p.cableType;
      l.crossSection = p.crossSection;
      l.nParallel = p.nParallel;
      l.msLevel = p.msLevel;
    } else {
      l.cableType = null; l.crossSection = 0; l.nParallel = 1; l.msLevel = false;
    }
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
  if (!PD.plan) { box.innerHTML = ''; return; }
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

function _renderFortschritt() {
  const el = document.getElementById('pd-fortschritt');
  if (!el) return;
  if (!PD.plan) { el.textContent = 'kein Plan geladen'; return; }
  const nOk = PD.nodes.filter(n => _statusNode(n) === 'ok').length;
  const lOk = PD.links.filter(l => _statusLink(l) === 'ok').length;
  el.innerHTML = `<b>${_esc(PD.plan.name)}</b> · Einträge ${nOk}/${PD.nodes.length} · Kabel ${lOk}/${PD.links.length} übernommen`;
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

  const bericht = { assetsNeu: 0, assetsVerknuepft: 0, kabelNeu: 0, offeneKnoten: 0, offeneKabel: 0 };

  const mutate = () => {
    // 1 · Einträge → Assets
    for (const n of PD.nodes) {
      if (n.assetId && ASSETS.items.some(a => a.id === n.assetId)) continue;
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
  };
}

export function pdDeserialize(data) {
  PD.plan = null; PD.nodes = []; PD.links = []; PD.seq = 1;
  _sel = null; _pendingA = null; _pendingGeb = null;
  if (_imgLayer) { _imgLayer.remove(); _imgLayer = null; }
  if (data && data.plan && data.plan.url) {
    PD.plan = { ...data.plan };
    PD.nodes = Array.isArray(data.nodes) ? data.nodes.map(n => ({ ...n })) : [];
    PD.links = Array.isArray(data.links) ? data.links.map(l => ({ ...l })) : [];
    PD.seq = data.seq || (PD.nodes.length + PD.links.length + 1);
    if (_map) _showPlanLayer();
  } else {
    _marks?.clearLayers();
  }
  if (document.getElementById(PANEL_ID)) _renderAll();
}
