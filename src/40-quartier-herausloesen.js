// ── 40-quartier-herausloesen.js — Quartier aus der Liegenschaft als eigene Projektdatei ──
// Bereich auf der Karte umfahren (oder angehakte Gebäude nehmen) → neue Projektdatei nur mit diesen
// Gebäuden, den Trassen im Bereich und den allgemeinen Annahmen. Das geöffnete Projekt bleibt unverändert.

import { map } from './02b-gebaeude.js';
import { _buildProjectData, projektExportFilename, showHint } from './03c-gebaeude-io.js';
import { epPrompt } from './05b-stromnetz.js';
import { beginInteraction, cancelInteraction, commitInteraction } from './lib/interaction-state.js';
import { gebaeudeImBereich, quartierProjekt } from './lib/quartier-herausloesen.js';

const ID = 'quartier-bereich';
let _punkte = [];
let _ebene = null;
let _deckel = null;

/** Start: mit angehakten Gebäuden direkt zum Dialog, sonst Bereich auf der Karte umfahren. */
export function quartierHerausloesen() {
  const auswahl = (window.gebaeude || []).filter(g => g.selected).map(g => g.id);
  if (auswahl.length) return _dialog(auswahl, null);
  _zeichnenStarten();
}

function _zeichnenStarten() {
  _punkte = [];
  beginInteraction({
    id: ID, label: 'Quartier herauslösen',
    hint: 'Bereich umfahren: Eckpunkte klicken, Doppelklick oder Klick auf den ersten Punkt schließt',
    cancel: _zeichnenBeenden,
  });
  _ebene = L.layerGroup().addTo(map);
  map.doubleClickZoom.disable();
  // Durchsichtiger Deckel über den Kartenebenen: Klicks erreichen keine Gebäude; Ziehen und Zoomen
  // bubbeln zum Kartencontainer und funktionieren weiter
  _deckel = document.createElement('div');
  _deckel.className = 'qh-deckel';
  map.getContainer().appendChild(_deckel);
  map.on('click', _klick);
  map.on('dblclick', _doppelklick);
  map.on('mousemove', _bewegen);
}

function _zeichnenBeenden() {
  map.off('click', _klick);
  map.off('dblclick', _doppelklick);
  map.off('mousemove', _bewegen);
  map.doubleClickZoom.enable();
  _deckel?.remove(); _deckel = null;
  if (_ebene) { map.removeLayer(_ebene); _ebene = null; }
}

function _zeichnen(maus) {
  if (!_ebene) return;
  _ebene.clearLayers();
  const pts = maus ? [..._punkte, maus] : _punkte;
  if (pts.length >= 2) L.polygon(pts, { color: '#ffb300', weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(_ebene);
  _punkte.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 6 : 4, color: '#ffb300', fillColor: i === 0 ? '#ffb300' : '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(_ebene));
  // Vorschau: Gebäude im Bereich hervorheben
  if (pts.length >= 3) {
    const ids = new Set(gebaeudeImBereich(window.gebaeude, pts));
    for (const g of window.gebaeude || []) if (ids.has(g.id) && Array.isArray(g.polygon)) L.polygon(g.polygon, { color: '#ffb300', weight: 2, fillOpacity: 0.35, interactive: false }).addTo(_ebene);
  }
}

function _klick(e) {
  if (_punkte.length >= 3) {
    const erster = map.latLngToContainerPoint(_punkte[0]);
    if (erster.distanceTo(map.latLngToContainerPoint(e.latlng)) < 12) return _abschliessen();
  }
  _punkte.push(e.latlng);
  _zeichnen();
}
function _doppelklick() { if (_punkte.length >= 3) _abschliessen(); }
function _bewegen(e) { if (_punkte.length) _zeichnen(e.latlng); }

function _abschliessen() {
  // Doppelklick löst vorher zwei Klicks aus — doppelte Endpunkte entfernen
  const bereich = _punkte.filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 0.5).map(p => ({ lat: p.lat, lng: p.lng }));
  commitInteraction(ID);
  _zeichnenBeenden();
  if (bereich.length < 3) return;
  const ids = gebaeudeImBereich(window.gebaeude, bereich);
  if (!ids.length) { showHint('Im umfahrenen Bereich liegt kein Gebäude.', 4000); return; }
  _dialog(ids, bereich);
}

async function _dialog(ids, bereich) {
  const voll = _buildProjectData();
  const vorschau = quartierProjekt(voll, { gebIds: ids, bereich });
  const nf = v => Math.round(v).toLocaleString('de-DE');
  const i = vorschau.info;
  const text = `<div class="qh-info">
      <b>${i.gebaeude}</b> von ${voll.gebaeude.length} Gebäuden · ${nf(i.waermeMwh)} MWh/a · ${nf(i.heizlastKw)} kW
      ${i.trassen ? `· ${i.trassen} Trassenabschnitt${i.trassen === 1 ? '' : 'e'}` : ''}${i.freiflaechen ? ` · ${i.freiflaechen} Freifläche${i.freiflaechen === 1 ? '' : 'n'}` : ''}
    </div>
    <div class="qh-hinweis">Übernommen werden die Gebäude, Trassen und Freiflächen im Bereich sowie Klima, Netztemperaturen,
      Preise und PV-Annahmen. Wärmenetz, Erzeuger, Varianten, Verbrauchsdaten und Lastgang der Liegenschaft entfallen —
      das Quartier wird in der neuen Datei eigenständig geplant. Das geöffnete Projekt bleibt unverändert.</div>
    <label class="qh-label">Name des Quartiers</label>`;
  const name = await epPrompt('Quartier herauslösen', text, 'Quartier', { okText: 'Als neue Datei speichern' });
  if (name == null) return;
  const quelle = voll.projektStammdaten?.kaserneName || '';
  const { projekt } = quartierProjekt(voll, { gebIds: ids, bereich, name: name.trim(), quelle, datum: new Date().toISOString().slice(0, 10) });
  await _speichern(projekt, name.trim());
}

async function _speichern(projekt, name) {
  const datei = projektExportFilename(('Quartier_' + (name || 'Teil')).replace(/[^\wäöüÄÖÜß-]+/g, '_'), 'json');
  const blob = new Blob([JSON.stringify(projekt, null, 2)], { type: 'application/json' });
  window._qhLetzteDatei = { name: datei, projekt };   // für Tests und Nachvollziehbarkeit
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: datei, types: [{ description: 'Micke-Heat Projekt', accept: { 'application/json': ['.json'] } }] });
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      showHint(`✓ Quartier gespeichert: ${handle.name || datei} — zum Bearbeiten über „Öffnen“ laden.`, 5000);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = datei; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showHint(`✓ Quartier als ${datei} heruntergeladen — zum Bearbeiten über „Öffnen“ laden.`, 5000);
}

export function quartierHerausloesenAbbrechen() { cancelInteraction(ID); }
