// ── 03a-erzeuger.js — Erzeuger-Panels (Freiflächen-PV, BHKW, Stromkessel, Gaskessel, Heizöl, Pellets, HHS, Fernwärme, Verbindungslinien) ──
// ── Freiflächen-PV ───────────────────────────────────────────────────────────

import { map } from './02b-gebaeude.js';
import { hidePanels } from './03b-netz.js';
import { _pvWpM2Global } from './03c-gebaeude-io.js';
import { stromEmF } from './01-globals-varianten.js';
import { autoGkResult, meritOrderKeys } from './06c-dispatch-core.js';
import { syncErzeugerElektroAsset, removeErzeugerElektroAsset, updateErzeugerAssetProps } from './13p-erzeuger-assets.js';
import { ASSETS, createAsset, deleteAsset } from './13a-assets-core.js';
import { redrawAllAssets, isAssetLayerVisible } from './13b-assets-render.js';
import { GEG_VERDRAENGUNG_RATIO, bhkwCo2Gutschrift, cacheVariantResults, calculatedLoad, ffDrawId, ffDrawPoints, fliessgewaesser, gasEmF, gebaeude, geoThermie, heizoelEmF, hhsEmF, isExcluded, lwWp, netzEdges, pelletsEmF, solarthermieAktiv } from './01-globals-varianten.js';
import { closestPointOnPolyline, polygonAreaM2, polygonCenter, updateFliessgewaesserData, updateLwWpDisplay } from './02c-karte-werkzeuge.js';
import { _setDefault30Pct, calcGeoThermie } from './03b-netz.js';
import { escHtml, hideHint, showHint } from './03c-gebaeude-io.js';
import { _hideForDraw } from './04a-ui-panels.js';
import { _quelleTemp, isErzeugerAktiv, moBeiAktivierung, moBeiDeaktivierung } from './06c-dispatch-core.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { fernwaermeLayerGroup, ffCounter, freiflaechen, gasKessel, heizhackschnitzel, heizoelKessel, hhsLayerGroup, pelletsKessel, pelletsLayerGroup, setFernwaermeEmF, setFernwaermeLayerGroup, setFfCounter, setFfDrawId, setFfDrawPoints, setFreiflaechen, setGasKessel, setHeizhackschnitzel, setHeizoelKessel, setHhsLayerGroup, setIsPlacingFernwaerme, setIsPlacingHhs, setIsPlacingPellets, setPefFernwaerme, setPelletsKessel, setPelletsLayerGroup } from './01-globals-varianten.js';

// ── Freiflächen-PV ↔ PV-Asset Verknüpfung ────────────────────────────────────
function _ffCentroid(polygon) {
  if (!polygon?.length) return null;
  const lats = polygon.map(p => p.lat ?? p[0]);
  const lngs = polygon.map(p => p.lng ?? p[1]);
  return { lat: lats.reduce((a, b) => a + b) / lats.length,
           lng: lngs.reduce((a, b) => a + b) / lngs.length };
}

function _ffPvProps(ff) {
  const isOW = (ff.ausrichtung === 'ostwest');
  return {
    leistungKWp: parseFloat(calcFFKwp(ff).toFixed(1)),
    ausrichtung: ff.ausrichtung || 'sued',
    pvSpez:      isOW ? 950 : 1050,
  };
}

function _createFFPvAsset(ff) {
  const pos = _ffCentroid(ff.polygon);
  if (!pos) return;
  const asset = createAsset('PV', pos.lat, pos.lng, {
    name: ff.name,
    props: _ffPvProps(ff),
  });
  if (asset) asset.linkedFF = ff.id;
  if (isAssetLayerVisible()) redrawAllAssets();
}

function _updateFFPvAsset(ff) {
  const a = ASSETS.items.find(x => x.linkedFF === ff.id);
  if (!a) return;
  a.name = ff.name;
  Object.assign(a.props, _ffPvProps(ff));
  a._pvProfile = null; // Profil-Cache invalidieren
  const pos = _ffCentroid(ff.polygon);
  if (pos) { a.lat = pos.lat; a.lng = pos.lng; if (a._marker?.setLatLng) a._marker.setLatLng([pos.lat, pos.lng]); }
}

function _removeFFPvAsset(ffId) {
  const a = ASSETS.items.find(x => x.linkedFF === ffId);
  if (!a) return;
  deleteAsset(a.id);
  if (isAssetLayerVisible()) redrawAllAssets();
}

export function toggleFFPvPanel() {
  // Läuft schon eine Zeichnung → Klick bricht ab (Toggle-Verhalten)
  if (ffDrawId !== null) { cancelDrawFF(); return; }
  // Elektro-Tab öffnen (dort liegen Liste + Ausrichtung Süd/Ost-West) und
  // direkt das Flächen-Zeichnen starten — Fläche abklicken verortet die PV.
  if (typeof window.setLeftTab === 'function') {
    window.setLeftTab('elektro');
    setTimeout(() => {
      const sec = document.getElementById('el-sec-netz');
      if (sec && sec.style.display === 'none' && typeof window.toggleSection === 'function') {
        window.toggleSection('el-sec-netz');
      }
      renderFFPanel();
    }, 120);
  }
  startDrawFF();
}

// Standard-Bodenbedeckung (GCR) für Freiflächen je Ausrichtung:
//  Süd  ~40 % (Reihenabstand gegen Selbstverschattung)
//  Ost-West ~85 % (Rücken-an-Rücken-Aufständerung, dichter belegbar)
export const FF_GCR_SUED    = 40;
export const FF_GCR_OSTWEST = 85;
export function ffGcrDefault(ff) {
  return ff && ff.ausrichtung === 'ostwest' ? FF_GCR_OSTWEST : FF_GCR_SUED;
}

export function calcFFKwp(ff) {
  const fl  = parseFloat(ff.flaeche) || 0;
  const gcr = (ff.gcr !== undefined ? ff.gcr : ffGcrDefault(ff)) / 100;
  return fl * gcr * _pvWpM2Global() / 1000;
}

export function attachFFLayer(ff) {
  if (ff.polygonLayer)    map.removeLayer(ff.polygonLayer);
  if (ff.moduleSvgLayer) { map.removeLayer(ff.moduleSvgLayer); ff.moduleSvgLayer = null; }

  // Yellow border + light transparent yellow fill
  ff.polygonLayer = L.polygon(ff.polygon, {
    color: 'rgba(255,213,79,0.85)', weight: 2,
    fillColor: 'rgba(255,213,79,0.18)', fillOpacity: 1
  }).addTo(map);
  ff.polygonLayer.on('click', () => {
    toggleFFPvPanel();
  });

  ff._pvModCount = 0;
  if (ff.polygon.length < 3) return;

  // Reale Module über die gemeinsame Platzierungs-Engine (wie Gebäudedächer).
  // Freifläche = ebene Aufständerung → Flachdach-Modus, Reihenabstand aus GCR.
  // ausrichtung steuert das Modulmuster (Süd-Reihen vs. Ost-West-Paare).
  const gcr = (ff.gcr !== undefined ? ff.gcr : ffGcrDefault(ff)) / 100;
  const mb  = parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1;
  const ml  = parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7;
  if (typeof window.placePvModules !== 'function' || typeof window.buildPvModuleOverlay !== 'function') return;
  const res = window.placePvModules([ff.polygon], [], { pitched: false, coverage: gcr, ausrichtung: ff.ausrichtung, moduleW: mb, moduleL: ml });
  ff._pvModCount = res.count;          // Modulanzahl für Panel-/Asset-Anzeige
  const ov  = window.buildPvModuleOverlay(res);
  if (!ov) return;
  ff.moduleSvgLayer = L.svgOverlay(ov.svgEl, ov.bounds, { opacity: 1, interactive: false, zIndex: 201 }).addTo(map);
}

export function startDrawFF() {
  cancelDrawFF();
  setFfDrawId(ffCounter);
  setFfCounter(ffCounter + 1);
  setFfDrawPoints([]);
  showHint('Eckpunkte anklicken · Startpunkt (rot) erneut anklicken zum Abschließen · Rechtsklick = Zurück');
  map.getContainer().style.cursor = 'crosshair';
  const d2 = document.getElementById('el-btn-ff-draw');   if (d2) d2.style.display = 'none';
  const c2 = document.getElementById('el-btn-ff-cancel'); if (c2) c2.style.display = '';
}

export function cancelDrawFF() {
  const _fpl = window.ffDrawPolyline; if (_fpl) { map.removeLayer(_fpl); window.ffDrawPolyline = null; }
  const _fsm = window.ffDrawStartMarker; if (_fsm) { map.removeLayer(_fsm); window.ffDrawStartMarker = null; }
  setFfDrawId(null); setFfDrawPoints([]);
  map.getContainer().style.cursor = '';
  hideHint();
  const d2 = document.getElementById('el-btn-ff-draw');   if (d2) d2.style.display = '';
  const c2 = document.getElementById('el-btn-ff-cancel'); if (c2) c2.style.display = 'none';
}

export function finishDrawFF() {
  if (ffDrawPoints.length < 3) return;
  const id = ffDrawId;
  const pts = [...ffDrawPoints];
  cancelDrawFF();
  const ff = {
    id, name: `Freifläche ${id}`,
    polygon: pts, polygonLayer: null,
    flaeche: polygonAreaM2(pts),
    ausrichtung: 'sued',
    gcr: FF_GCR_SUED,
  };
  freiflaechen.push(ff);
  attachFFLayer(ff);
  _createFFPvAsset(ff);
  renderFFPanel();
  calcStromPanel();
  redrawVerbindungslinien();
}

export function removeFreiflaeche(id) {
  const ff = freiflaechen.find(f => f.id === id);
  if (!ff) return;
  _removeFFPvAsset(id);
  if (ff.polygonLayer)    map.removeLayer(ff.polygonLayer);
  if (ff.moduleSvgLayer)  map.removeLayer(ff.moduleSvgLayer);
  setFreiflaechen(freiflaechen.filter(f => f.id !== id));
  renderFFPanel();
  calcStromPanel();
  redrawVerbindungslinien();
}

export function updateFF(id, field, val) {
  const ff = freiflaechen.find(f => f.id === id);
  if (!ff) return;
  if (field === 'gcr') { ff.gcr = parseFloat(val) || ffGcrDefault(ff); ff._gcrManual = true; }
  else if (field === 'ausrichtung') {
    ff.ausrichtung = val;
    if (!ff._gcrManual) ff.gcr = ffGcrDefault(ff);   // Default-Dichte je Ausrichtung mitziehen
  }
  else if (field === 'name') ff.name = val;
  if (field === 'gcr' || field === 'ausrichtung') attachFFLayer(ff);
  _updateFFPvAsset(ff);
  renderFFPanel();
  calcStromPanel();
}

export function renderFFPanel() {
  const eListEl  = document.getElementById('el-ff-list');
  const eTotalEl = document.getElementById('el-ff-total');
  if (!eListEl) return;

  if (freiflaechen.length === 0) {
    eListEl.innerHTML = '<div style="font-size:10px;color:var(--muted);text-align:center;padding:8px 0;">Noch keine Freifläche gezeichnet.</div>';
    if (eTotalEl) eTotalEl.style.display = 'none';
    return;
  }

  const pvSpez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  let totalKwp = 0;

  const itemsHtml = freiflaechen.map(ff => {
    const kwp = calcFFKwp(ff);
    totalKwp += kwp;
    const fl = ff.flaeche ? (ff.flaeche / 10000).toFixed(2) + ' ha' : '—';
    return `<div style="padding:7px 8px;background:var(--bg);border-radius:5px;border:1px solid rgba(255,213,79,0.2);font-size:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
        <input class="inp-field" type="text" value="${escHtml(ff.name)}" style="flex:1;font-size:10px;"
          data-input="updateFF(${ff.id},'name',this.value)"/>
        <button class="btn-xs red" data-click="removeFreiflaeche(${ff.id})" title="Entfernen">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px;">
        <div class="inp-group">
          <div class="inp-label" title="Ground Coverage Ratio: Anteil der Modulfläche an der Gesamtfläche">GCR (% Bodenbedeckung)</div>
          <input class="inp-field" type="number" value="${ff.gcr !== undefined ? ff.gcr : ffGcrDefault(ff)}" min="5" max="95" step="5"
            data-input="updateFF(${ff.id},'gcr',this.value)"/>
        </div>
        <div class="inp-group">
          <div class="inp-label">Ausrichtung</div>
          <select class="inp-field" data-change="updateFF(${ff.id},'ausrichtung',this.value)">
            <option value="sued" ${ff.ausrichtung==='sued'?'selected':''}>Süd</option>
            <option value="ostwest" ${ff.ausrichtung==='ostwest'?'selected':''}>Ost-West</option>
          </select>
        </div>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">${((ff.gcr !== undefined ? ff.gcr : ffGcrDefault(ff)) / 100 * _pvWpM2Global()).toFixed(0)} Wp/m² Gesamtfläche (= ${(ff.gcr !== undefined ? ff.gcr : ffGcrDefault(ff))}% × ${_pvWpM2Global().toFixed(0)} Wp/m² Modulleistung)</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-family:'DM Mono',monospace;">
        <span style="color:var(--muted)">Fläche</span><span style="color:var(--text)">${fl}</span>
        ${ff._pvModCount ? `<span style="color:var(--muted)">Module</span><span style="color:var(--text)">${ff._pvModCount.toLocaleString('de-DE')}</span>` : ''}
        <span style="color:var(--muted)">Leistung</span><span style="color:#ffd54f;">${kwp.toFixed(1)} kWp</span>
      </div>
    </div>`;
  }).join('');

  eListEl.innerHTML = itemsHtml;

  const showTotal = freiflaechen.length > 1;
  const totMwh = totalKwp * pvSpez / 1000;
  const kwpTxt = totalKwp.toFixed(1) + ' kWp';
  const mwhTxt = totMwh.toFixed(0) + ' MWh/a';

  if (eTotalEl) {
    eTotalEl.style.display = showTotal ? 'grid' : 'none';
    const k = document.getElementById('el-ff-total-kwp'); if (k) k.textContent = kwpTxt;
    const m = document.getElementById('el-ff-total-mwh'); if (m) m.textContent = mwhTxt;
  }
}

// ── BHKW / KWK ───────────────────────────────────────────────────────────────
export function toggleBhkwPanel() {
  const p   = document.getElementById('bhkw-panel');
  const btn = document.getElementById('btn-bhkw-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (window.bhkw) {
      document.getElementById('bhkw-data-section').style.display = 'block';
      updateBhkwDisplay();
    } else {
      document.getElementById('bhkw-data-section').style.display = 'none';
    }
  }
}

export function activateBhkw() {
  const leistTh = Math.max(1, parseFloat(document.getElementById('bhkw-leistung-th').value) || 100);
  window.bhkw = { leistungThKw: leistTh };
  document.getElementById('bhkw-data-section').style.display = 'block';
  document.getElementById('btn-activate-bhkw').style.display = 'none';
  moBeiAktivierung('bhkw');
  redrawErzeugerIcons();
  updateBhkwDisplay();
  syncErzeugerElektroAsset('bhkw');
}

export function updateBhkwDisplay() {
  if (!window.bhkw) return;
  window.bhkw.leistungThKw = Math.max(1, parseFloat(document.getElementById('bhkw-leistung-th').value) || 100);
  const sigma    = parseFloat(document.getElementById('bhkw-skz').value) || 0.45;
  const etaGes   = parseFloat(document.getElementById('bhkw-eta').value) || 88;
  const gaspreis = parseFloat(document.getElementById('wirt-p-gas')?.value) || 10;
  const leistEl  = window.bhkw.leistungThKw * sigma;
  const etaTh    = (1 + sigma) > 0 ? (etaGes / 100) / (1 + sigma) : 0.4;
  const waerme   = parseFloat(document.getElementById('bhkw-waerme').value) || 0;
  const elMwh    = waerme * sigma;
  const gasverbrauch = waerme > 0 ? waerme / etaTh : 0;
  const gaskosten    = gasverbrauch * gaspreis * 10;
  // BHKW Stromerlös differenziert: Eigenverbrauch (vermiedene Bezugskosten + KWK) + Einspeisung (Baseload + KWK)
  const bezugspreis  = parseFloat(document.getElementById('strom-preis-bezug')?.value) || 35;
  const bhkwPreisEinsp = parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8;
  const kwkEinsp     = parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8;
  const kwkEigen     = parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4;
  // Anteil Eigenverbrauch aus Strom-Bilanz (falls verfügbar), sonst Schätzung 60%
  const bilanz = window._stromBilanz || {};
  const _bhkwBilanzVorhanden = bilanz.bhkwEigenMwh > 0 || bilanz.bhkwEinspMwh > 0;
  const bhkwEigAnteil = _bhkwBilanzVorhanden
    ? bilanz.bhkwEigenMwh / (bilanz.bhkwEigenMwh + bilanz.bhkwEinspMwh)
    : 0.6;
  const eigenMwh = elMwh * bhkwEigAnteil;
  const einspMwh = elMwh * (1 - bhkwEigAnteil);
  const stromerloes  = eigenMwh * (bezugspreis + kwkEigen) * 10 + einspMwh * (bhkwPreisEinsp + kwkEinsp) * 10;
  const co2          = gasverbrauch > 0 ? gasverbrauch * gasEmF / 1000 : 0;
  const vEmF = calcVerdraengungEmF();
  const co2gutschrift = bhkwCo2Gutschrift && elMwh > 0 ? elMwh * vEmF / 1000 : 0;
  const co2netto = co2 - co2gutschrift;
  document.getElementById('bhkw-lel-disp').textContent  = leistEl.toFixed(1) + ' kW_el';
  document.getElementById('bhkw-wm-disp').textContent   = waerme > 0 ? waerme.toFixed(0) + ' MWh/a' : '—';
  document.getElementById('bhkw-el-disp').textContent   = waerme > 0 ? elMwh.toFixed(0) + ' MWh/a' : '—';
  document.getElementById('bhkw-gas-disp').textContent  = waerme > 0 ? gasverbrauch.toFixed(0) + ' MWh/a' : '—';
  document.getElementById('bhkw-gk-disp').textContent   = waerme > 0 ? gaskosten.toLocaleString('de-DE', {maximumFractionDigits:0}) + ' €/a' : '—';
  document.getElementById('bhkw-erl-disp').textContent  = waerme > 0 ? stromerloes.toLocaleString('de-DE', {maximumFractionDigits:0}) + ' €/a' + (_bhkwBilanzVorhanden ? '' : ' (Schätzung 60/40)') : '—';
  document.getElementById('bhkw-co2-disp').textContent  = waerme > 0
    ? `${co2.toFixed(1)} t/a (fossil)${co2gutschrift > 0 ? ` − ${co2gutschrift.toFixed(1)} Gutschrift = ${co2netto.toFixed(1)} netto` : ''}`
    : '—';
  window._bhkwCo2Netto = { co2, co2gutschrift, co2netto };
  updateErzeugerAssetProps('bhkw');
  cacheVariantResults();
}

export function clearBhkw() {
  window.bhkw = null;
  window._bhkwElHourly = null;
  moBeiDeaktivierung('bhkw');
  removeErzeugerElektroAsset('bhkw');
  redrawErzeugerIcons();
  document.getElementById('bhkw-data-section').style.display = 'none';
  const btn = document.getElementById('btn-activate-bhkw');
  if (btn) btn.style.display = '';
  cacheVariantResults();
}

// ── Stromheizkessel ───────────────────────────────────────────────────────────
export function toggleStromkesselPanel() {
  const p   = document.getElementById('stromkessel-panel');
  const btn = document.getElementById('btn-stromkessel-toggle');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
  btn.classList.add('active');
}

export function activateStromkessel() {
  const leistKw = Math.max(1, parseFloat(document.getElementById('sk-leistung').value) || 200);
  window.stromkessel = { leistungKw: leistKw };
  document.getElementById('stromkessel-data-section').style.display = 'block';
  document.getElementById('btn-activate-stromkessel').style.display = 'none';
  moBeiAktivierung('stromkessel');
  redrawErzeugerIcons();
  updateStromkesselDisplay();
  syncErzeugerElektroAsset('stromkessel');
}

export function updateStromkesselDisplay() {
  if (!window.stromkessel) return;
  window.stromkessel.leistungKw = Math.max(1, parseFloat(document.getElementById('sk-leistung').value) || 200);
  const eta        = (parseFloat(document.getElementById('sk-eta').value) || 99) / 100;
  const strompreis = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
  const waerme     = parseFloat(document.getElementById('sk-waerme').value) || 0;
  const stromMwh   = waerme > 0 ? waerme / eta : 0;
  const stromkosten = stromMwh * strompreis * 10; // ct/kWh × MWh × 10 = €
  const co2        = stromMwh > 0 ? stromMwh * stromEmF / 1000 : 0; // t CO₂/a

  const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setT('sk-stromverbrauch', waerme > 0 ? stromMwh.toFixed(1) + ' MWh/a' : '—');
  setT('sk-stromkosten',    waerme > 0 ? (stromkosten / 1000).toFixed(1) + ' T€/a' : '—');
  setT('sk-co2',            waerme > 0 ? co2.toFixed(1) + ' t/a' : '—');
  updateErzeugerAssetProps('stromkessel');
  cacheVariantResults();
}

export function clearStromkessel() {
  window.stromkessel = null;
  window._skElHourly = null;
  moBeiDeaktivierung('stromkessel');
  removeErzeugerElektroAsset('stromkessel');
  redrawErzeugerIcons();
  document.getElementById('stromkessel-data-section').style.display = 'none';
  const btn = document.getElementById('btn-activate-stromkessel');
  if (btn) btn.style.display = '';
  cacheVariantResults();
}

// ── Gaskessel ────────────────────────────────────────────────────────────────
export function toggleGasKesselPanel() {
  const p = document.getElementById('gaskessel-panel');
  const btn = document.getElementById('btn-gaskessel-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (gasKessel) {
      document.getElementById('gaskessel-data-section').style.display = 'block';
      updateGasKesselDisplay();
    } else {
      document.getElementById('gaskessel-data-section').style.display = 'none';
    }
  }
}

export function activateGasKessel() {
  _setDefault30Pct('gk-leistung');
  const leistung = Math.max(1, parseFloat(document.getElementById('gk-leistung').value) || 500);
  setGasKessel({ leistungKw: leistung });
  document.getElementById('gaskessel-data-section').style.display = 'block';
  document.getElementById('btn-activate-gaskessel').style.display = 'none';
  moBeiAktivierung('gaskessel');
  redrawGasKessel();
  updateGasKesselDisplay();
}

export function windSvg(col='white', w=16, h=13) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 16 13" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 2 Q5 0.5 9 2 Q13 3.5 15 2" stroke="${col}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <path d="M1 6.5 Q5 5 10 6.5 Q13 7.5 15 6.5" stroke="${col}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <path d="M1 11 Q5 9.5 9 11 Q12 12 14 11" stroke="${col}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Erdbohrer-SVG (Erdwärme-Symbol), Farbe über Parameter
export function drillSvg(col='white', w=14, h=20) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 14 20" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="0.5" width="12" height="2.5" rx="1.2" fill="${col}"/>
    <rect x="5.5" y="3" width="3" height="1.5" fill="${col}" opacity="0.9"/>
    <rect x="6" y="4.5" width="2" height="8.5" fill="${col}" opacity="0.9"/>
    <path d="M1.5 7 Q4 8.5 7 7.5 Q10 6.5 12.5 8" stroke="${col}" stroke-width="1.3" fill="none" opacity="0.6"/>
    <path d="M1.5 10.5 Q4 12 7 11 Q10 10 12.5 11.5" stroke="${col}" stroke-width="1.3" fill="none" opacity="0.6"/>
    <polygon points="4.5,13 9.5,13 7,19.5" fill="${col}"/>
  </svg>`;
}

export function calcVerdraengungEmF() {
  // Überschreibbarer Wert aus Input, sonst automatisch aus stromEmF × Ratio
  const override = parseFloat(document.getElementById('verdraengung-emf-override')?.value);
  return override > 0 ? override : Math.round(stromEmF * GEG_VERDRAENGUNG_RATIO);
}

export function updateAllEmF() {
  updateLwWpDisplay();
  calcGeoThermie();
  updateFliessgewaesserData();
  updateGasKesselDisplay();
  updateBhkwDisplay();
  updateStromkesselDisplay();
  updateHeizoelDisplay();
  updatePelletsDisplay();
  updateHhsDisplay();
  updateFernwaermeDisplay();
  cacheVariantResults();
  // Verdrängungsstrom Auto-Anzeige aktualisieren
  const vDisp = document.getElementById('verdraengung-emf-auto');
  if (vDisp) {
    const override = parseFloat(document.getElementById('verdraengung-emf-override')?.value);
    const auto = Math.round(stromEmF * GEG_VERDRAENGUNG_RATIO);
    vDisp.textContent = override > 0 ? `${override} (manuell)` : `${auto}`;
  }
}

export function _erzeugerIconData(key) {
  switch (key) {
    case 'lwwp':       return { icon: windSvg('white',15,12),   c:'#388e3c', label:'Luft-WP',     emoji:false };
    case 'fg':         return { icon: '〰',                      c:'#0277bd', label:'FG-WP',        emoji:true  };
    case 'geo':        return { icon: drillSvg('white',14,20),  c:'#795548', label:'Geo-WP',       emoji:false };
    case 'fernwaerme': return { icon: '🌡',                     c:'#c62828', label:'Fernwärme',    emoji:true  };
    case 'pellets':    return { icon: '🌾',                     c:'#e65100', label:'Pellets',      emoji:true  };
    case 'hhs':        return { icon: woodSvg('white',15,13),   c:'#5d4037', label:'HHS',          emoji:false };
    case 'heizoel':    return { icon: oilSvg('white',12,15),    c:'#37474f', label:'Heizöl',       emoji:false };
    case 'gaskessel':  return { icon: '🔥',                     c:'#546e7a', label:'Gaskessel',    emoji:true  };
    case 'bhkw':        return { icon: '⚡',  c:'#e65100', label:'BHKW/KWK',     emoji:true };
    case 'stromkessel': return { icon: '🔌', c:'#ff69b4', label:'Stromkessel',  emoji:true };
    default:            return { icon: '?',  c:'#555',    label: key,           emoji:true };
  }
}

export function redrawErzeugerIcons() {
  const el = document.getElementById('erzeuger-status');
  if (!el) return;

  // Erzeuger in Merit-Order (nur aktive)
  const ordered = meritOrderKeys.filter(k => isErzeugerAktiv(k));

  const badge = (n) =>
    `<span style="position:absolute;top:-5px;right:-5px;background:#fff;color:#111;` +
    `font-size:9px;font-weight:700;width:15px;height:15px;border-radius:50%;` +
    `display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.5);">${n}</span>`;

  const arrows = (key, i, total) => {
    const up = i > 0
      ? `<span class="mo-arrow mo-arrow-up" data-click="event.stopPropagation();moSwap('${key}',-1)" title="Priorität erhöhen">▲</span>` : '';
    const dn = i < total - 1
      ? `<span class="mo-arrow mo-arrow-dn" data-click="event.stopPropagation();moSwap('${key}',1)" title="Priorität verringern">▼</span>` : '';
    return up + dn;
  };

  const icons = ordered.map((key, i) => {
    const { icon, c, label, emoji } = _erzeugerIconData(key);
    const lk = parseFloat(document.getElementById(ERZEUGER_CFG[key]?.leistungId)?.value) || 0;
    const title = `${label}${lk > 0 ? ' · ' + lk + ' kW' : ''} · Priorität ${i + 1} · Klicken & auf anderen ziehen zum Umsortieren`;
    return `<div data-mokey="${key}" class="mo-icon-wrap"
      title="${title}"
      style="position:relative;width:34px;height:34px;border-radius:7px;background:${c};display:flex;align-items:center;justify-content:center;${emoji ? 'font-size:17px;' : ''}box-shadow:0 2px 5px rgba(0,0,0,.55);border:1.5px solid rgba(255,255,255,0.2);cursor:grab;user-select:none;"
      onmousedown="moMouseDown(event, '${key}')">
      ${icon}${badge(i + 1)}${arrows(key, i, ordered.length)}
    </div>`;
  }).join('');

  // Auto-GK: anzeigen wenn Wärmenetz existiert und noch Restbedarf vorhanden ist
  // (auch wenn ein manueller GK aktiv aber zu klein ist)
  let autoGkIcon = '';
  // _autoGkResult === false  → vollständig gedeckt, kein Icon
  // _autoGkResult === null   → noch keine Daten, Icon ohne Zahlen
  // _autoGkResult === {...}  → Residual bekannt, Icon mit Zahlen
  if (typeof netzEdges !== 'undefined' && netzEdges.length > 0
      && autoGkResult !== false) {
    const prio = ordered.length + 1;
    const agk  = autoGkResult;
    const tip  = agk
      ? `Spitzenlast-Backup (automatisch) · ${agk.leistungKw} kW · ${agk.deckungPct.toFixed(1)} % · ${Math.round(agk.waermeMwh).toLocaleString('de-DE')} MWh/a · Priorität ${prio}`
      : `Spitzenlast-Backup (automatisch) · Priorität ${prio} · Grundlagen berechnen für Details`;
    autoGkIcon = `<div title="${tip}"
      style="position:relative;width:34px;height:34px;border-radius:7px;background:#78909c;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 5px rgba(0,0,0,.55);border:1.5px dashed rgba(255,255,255,0.5);cursor:default;opacity:0.85;">
      🔥${badge(prio)}
    </div>`;
  }

  // Container nur ausblenden wenn weder konfigurierte Erzeuger noch Auto-GK
  if (!icons && !autoGkIcon) { el.innerHTML = ''; return; }

  el.innerHTML = `<div style="display:flex;gap:5px;background:rgba(18,18,18,0.72);padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(4px);pointer-events:auto;" title="Wärmeerzeuger · Klicken &amp; ziehen zum Umsortieren (Priorität 1 = Grundlast)">${icons}${autoGkIcon}</div>`;
}
// ── Erzeuger-Klick-Popup ─────────────────────────────────────────────────────
export let _epKey = null;

export function closeErzeugerPopup() {
  _epKey = null;
  const p = document.getElementById('erzeuger-popup');
  if (p) p.style.display = 'none';
}

export function showErzeugerPopup(key) {
  const hourly = window._dispatchHourly || {};
  const en     = window._dispatchEnergy || {};
  const ss     = window.systemState;
  const cfg    = ERZEUGER_CFG[key];
  if (!cfg || !hourly[key]) return;

  _epKey = key;
  const arr     = hourly[key];           // Float32Array 8760
  const color   = cfg.color || '#888';
  const label   = cfg.label || key;
  const { icon, c, emoji } = _erzeugerIconData(key);

  // KPIs
  let waermeMwh = (en[key]?.waermeMwh) ?? 0;
  const elMwh   = (en[key]?.elMwh) ?? 0;
  let peakKw = 0;
  let totalKwh = 0;
  for (let i = 0; i < arr.length; i++) {
    totalKwh += arr[i];
    if (arr[i] > peakKw) peakKw = arr[i];
  }
  waermeMwh = totalKwh / 1000;
  const gesamtMwh = ss?.gesamtMwhMitNV || 0;
  const deckPct   = gesamtMwh > 0 ? waermeMwh / gesamtMwh * 100 : 0;
  const vbh       = peakKw > 0 ? Math.round(totalKwh / peakKw) : 0;
  const jaz       = cfg.typ === 'wp' && elMwh > 0 ? (waermeMwh / elMwh).toFixed(2) : null;

  // DOM befüllen
  const epIcon = document.getElementById('ep-icon');
  epIcon.style.background = c;
  epIcon.innerHTML = emoji ? `<span style="font-size:14px;">${icon}</span>` : icon;

  document.getElementById('ep-title').textContent = label;

  const kpis = document.getElementById('ep-kpis');
  kpis.innerHTML = [
    `<span><b>${waermeMwh.toFixed(0)}</b> MWh/a</span>`,
    `<span><b>${deckPct.toFixed(1)}</b> %</span>`,
    `<span><b>${vbh.toLocaleString('de-DE')}</b> h/a</span>`,
    jaz ? `<span>JAZ <b>${jaz}</b></span>` : '',
    `<span><b>${Math.round(peakKw)}</b> kW</span>`,
  ].filter(Boolean).join('<span style="opacity:.3">·</span>');

  // Popup anzeigen
  const popup = document.getElementById('erzeuger-popup');
  popup.style.display = '';

  // Stundenprofil-Canvas
  requestAnimationFrame(() => {
    _epDrawHourly(key, arr, color);
    _epDrawMonthly(key, arr, color);
    const copSec = document.getElementById('ep-cop-section');
    if (cfg.typ === 'wp' && ss?.tempH) {
      copSec.style.display = '';
      _epDrawCop(key, arr, color, ss.tempH);
    } else {
      copSec.style.display = 'none';
    }
  });
}

export function _epDrawHourly(key, arr, color) {
  const cv  = document.getElementById('ep-hourly-canvas');
  if (!cv) return;
  const W   = cv.offsetWidth || 532;
  const H   = 80;
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, W, H);

  let pMax = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > pMax) pMax = arr[i];
  if (pMax <= 0) return;

  const n   = arr.length;
  const agg = Math.max(1, Math.round(n / W));
  ctx.fillStyle = color;
  for (let col = 0; col < W; col++) {
    const s = Math.floor(col * n / W);
    const e = Math.floor((col + 1) * n / W);
    let mx = 0;
    for (let i = s; i < e && i < n; i++) if (arr[i] > mx) mx = arr[i];
    const h = (mx / pMax) * H;
    if (h > 0.3) ctx.fillRect(col, H - h, 1, h);
  }

  // Monatstrennlinien
  const MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  let hAcc = 0;
  for (let m = 0; m < 11; m++) {
    hAcc += MDAYS[m] * 24;
    const x = Math.round(hAcc / n * W) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
}

export function _epDrawMonthly(key, arr, color) {
  const cv  = document.getElementById('ep-monthly-canvas');
  if (!cv) return;
  const W   = cv.offsetWidth || 532;
  const H   = 60;
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, W, H);

  const MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const MLBL  = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const mKwh  = new Array(12).fill(0);
  let h = 0;
  for (let m = 0; m < 12; m++) {
    const hrs = MDAYS[m] * 24;
    for (let i = 0; i < hrs && h < arr.length; i++, h++) mKwh[m] += arr[h];
  }
  const mMax  = Math.max(...mKwh);
  if (mMax <= 0) return;

  const barW  = Math.floor((W - 24) / 12);
  const gap   = Math.floor((W - 24 - barW * 12) / 11) || 1;
  ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let m = 0; m < 12; m++) {
    const x = 12 + m * (barW + gap);
    const bH = Math.max(1, (mKwh[m] / mMax) * (H - 14));
    ctx.fillStyle = color;
    ctx.fillRect(x, H - 14 - bH, barW, bH);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(MLBL[m], x + barW / 2, H - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(Math.round(mKwh[m] / 1000), x + barW / 2, H - 16 - bH);
  }
}

export function _epDrawCop(key, arr, color, tempH) {
  const cv  = document.getElementById('ep-cop-canvas');
  if (!cv) return;
  const W   = cv.offsetWidth || 532;
  const H   = 80;
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, W, H);

  // COP stündlich berechnen
  const ss  = window.systemState;
  const vlH = ss?.vlH;
  if (!vlH) return;

  let tMin = 30, tMax = -20;
  for (let i = 0; i < tempH.length; i++) {
    if (arr[i] > 0.01) { if (tempH[i] < tMin) tMin = tempH[i]; if (tempH[i] > tMax) tMax = tempH[i]; }
  }
  if (tMax <= tMin) { tMin -= 5; tMax += 5; }
  const tRange = tMax - tMin || 1;

  let copMin = 10, copMax = 0;
  const pts = [];
  const ggId = ERZEUGER_CFG[key]?.guetegradId;
  const ggV  = ggId ? parseFloat(document.getElementById(ggId)?.value) : NaN;
  const gg   = (!isNaN(ggV) && ggV > 0) ? ggV : (ERZEUGER_CFG[key]?.guetegrad || 0.5);
  for (let t = 0; t < arr.length; t += 3) { // jede 3. Stunde für Performance
    if (arr[t] < 0.01) continue;
    const vl  = (vlH[t] + 273.15);
    const tQ  = _quelleTemp ? _quelleTemp(key, tempH[t], t) : tempH[t];
    const tQK = tQ + 273.15;
    const hub = Math.max(vl - tQK, 0.1);
    const cop = (vl / hub) * gg;
    if (cop > 0 && cop < 15) {
      pts.push([tempH[t], cop]);
      if (cop < copMin) copMin = cop; if (cop > copMax) copMax = cop;
    }
  }
  if (pts.length === 0) return;
  copMin = Math.floor(copMin); copMax = Math.ceil(copMax) + 0.5;
  const copRange = copMax - copMin || 1;

  // Scatter
  ctx.fillStyle = color + 'aa';
  for (const [tx, cy] of pts) {
    const px = Math.round((tx - tMin) / tRange * (W - 30)) + 15;
    const py = Math.round((1 - (cy - copMin) / copRange) * (H - 16)) + 2;
    ctx.beginPath(); ctx.arc(px, py, 1.5, 0, 2 * Math.PI); ctx.fill();
  }

  // Achsenbeschriftung
  ctx.font = '9px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'left';  ctx.fillText(`COP ${copMax.toFixed(0)}`, 2, 10);
  ctx.textAlign = 'left';  ctx.fillText(`COP ${copMin.toFixed(0)}`, 2, H - 6);
  ctx.textAlign = 'left';  ctx.fillText(`${tMin.toFixed(0)}°C`, 14, H - 2);
  ctx.textAlign = 'right'; ctx.fillText(`${tMax.toFixed(0)}°C`, W - 2, H - 2);
}

export function redrawGasKessel() { redrawErzeugerIcons(); }

export function updateGasKesselDisplay() {
  if (!gasKessel) return;
  const waerme  = parseFloat(document.getElementById('gk-waerme').value) || 0;
  const eta     = parseFloat(document.getElementById('gk-eta').value) || 92;
  const gaspreis = parseFloat(document.getElementById('wirt-p-gas')?.value) || 10;
  if (waerme > 0) {
    const gasverbrauch = waerme / (eta / 100);
    const gaskosten    = gasverbrauch * gaspreis * 10; // MWh → kWh × ct → €
    const co2          = gasverbrauch * gasEmF / 1000; // t/a
    document.getElementById('gk-gasverbrauch').textContent = gasverbrauch.toFixed(0) + ' MWh/a';
    document.getElementById('gk-gaskosten').textContent    = gaskosten.toLocaleString('de-DE', {maximumFractionDigits:0}) + ' €/a';
    document.getElementById('gk-co2').textContent          = co2.toFixed(1) + ' t/a (fossil)';
  } else {
    document.getElementById('gk-gasverbrauch').textContent = '—';
    document.getElementById('gk-gaskosten').textContent    = '—';
    document.getElementById('gk-co2').textContent          = '—';
  }
}

export function gasKesselUseNetworkValues() {
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  const lastKw = calculatedLoad && calculatedLoad[zId] ? calculatedLoad[zId] : 0;
  const connectedIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const verbrauchMWh = gebaeude.filter(g => connectedIds.has(g.id) && !isExcluded(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const lossAnnual = netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0);
  const erzeugungMWh = verbrauchMWh + lossAnnual * 8.76;
  if (lastKw > 0) { document.getElementById('gk-leistung').value = Math.round(lastKw); gasKessel.leistungKw = Math.round(lastKw); }
  if (erzeugungMWh > 0) document.getElementById('gk-waerme').value = Math.round(erzeugungMWh);
  updateGasKesselDisplay();
}

export function clearGasKessel() {
  setGasKessel(null);
  moBeiDeaktivierung('gaskessel');
  redrawErzeugerIcons();
  document.getElementById('gaskessel-data-section').style.display = 'none';
  const btn = document.getElementById('btn-activate-gaskessel');
  if (btn) btn.style.display = '';
}

// ── Heizölkessel ─────────────────────────────────────────────────────────────
export function toggleHeizoelPanel() {
  const p = document.getElementById('heizoel-panel');
  const btn = document.getElementById('btn-heizoel-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (heizoelKessel) {
      document.getElementById('heizoel-data-section').style.display = 'block';
      updateHeizoelDisplay();
    } else {
      document.getElementById('heizoel-data-section').style.display = 'none';
    }
  }
}

export function activateHeizoelKessel() {
  _setDefault30Pct('hko-leistung');
  const leistung = Math.max(1, parseFloat(document.getElementById('hko-leistung').value) || 500);
  setHeizoelKessel({ leistungKw: leistung });
  document.getElementById('heizoel-data-section').style.display = 'block';
  document.getElementById('btn-activate-heizoel').style.display = 'none';
  moBeiAktivierung('heizoel');
  redrawErzeugerIcons();
  updateHeizoelDisplay();
}

export function updateHeizoelDisplay() {
  const waerme = parseFloat(document.getElementById('hko-waerme').value) || 0;
  const eta = parseFloat(document.getElementById('hko-eta').value) || 91;
  const oelpreis = parseFloat(document.getElementById('wirt-p-hko')?.value) || 9.5;
  if (heizoelKessel) {
    heizoelKessel.leistungKw = Math.max(1, parseFloat(document.getElementById('hko-leistung').value) || 500);
  }
  if (waerme > 0) {
    const oelverbrauch = waerme / (eta / 100);
    const oelkosten = oelverbrauch * oelpreis * 10; // ct/kWh → €/MWh → €/a
    const co2 = oelverbrauch * heizoelEmF / 1000;
    document.getElementById('hko-r-verbrauch').textContent = oelverbrauch.toFixed(0) + ' MWh/a';
    document.getElementById('hko-r-kosten').textContent = oelkosten.toFixed(0) + ' €/a';
    document.getElementById('hko-r-co2').textContent = co2.toFixed(1) + ' t/a';
  } else {
    ['hko-r-verbrauch','hko-r-kosten','hko-r-co2'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '—'; });
  }
  cacheVariantResults();
}

export function clearHeizoelKessel() {
  setHeizoelKessel(null);
  document.getElementById('heizoel-data-section').style.display = 'none';
  document.getElementById('btn-activate-heizoel').style.display = '';
  moBeiDeaktivierung('heizoel');
  redrawErzeugerIcons();
  cacheVariantResults();
}

export function redrawHeizoelKessel() { redrawErzeugerIcons(); }

// ── Pelletskessel ─────────────────────────────────────────────────────────────
export function togglePelletsPanel() {
  const p = document.getElementById('pellets-panel');
  const btn = document.getElementById('btn-pellets-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (pelletsKessel) {
      document.getElementById('pellets-data-section').style.display = 'block';
      updatePelletsDisplay();
    } else {
      document.getElementById('pellets-data-section').style.display = 'none';
    }
  }
}

export function activatePellets() {
  _setDefault30Pct('pk-leistung');
  setPelletsKessel({ leistungKw: Math.max(1, parseFloat(document.getElementById('pk-leistung').value)||300) });
  document.getElementById('pellets-data-section').style.display = 'block';
  document.getElementById('btn-activate-pellets').style.display = 'none';
  moBeiAktivierung('pellets');
  redrawErzeugerIcons();
  updatePelletsDisplay();
}

export function updatePelletsDisplay() {
  if (!pelletsKessel) return;
  pelletsKessel.leistungKw = Math.max(1, parseFloat(document.getElementById('pk-leistung').value)||300);
  const waerme = parseFloat(document.getElementById('pk-waerme').value)||0;
  const eta = parseFloat(document.getElementById('pk-eta').value)||88;
  const preis = parseFloat(document.getElementById('wirt-p-pk')?.value) || 8;
  if (waerme > 0) {
    const verbrauchMWh = waerme / (eta/100);
    const verbrauchT = verbrauchMWh * 1000 / 4900;
    const kosten = verbrauchMWh * preis * 10; // ct/kWh × MWh × 10 = €/a
    const co2 = verbrauchMWh * pelletsEmF;
    const lagerFlaeche = (verbrauchT * 1000 / 650) / 3;
    document.getElementById('pk-r-verbrauch').textContent = verbrauchT.toFixed(1) + ' t/a';
    document.getElementById('pk-r-kosten').textContent = kosten.toFixed(0) + ' €/a';
    document.getElementById('pk-r-co2').textContent = (co2/1000).toFixed(2) + ' t/a';
    document.getElementById('pk-r-lager').textContent = lagerFlaeche.toFixed(0) + ' m²';
  } else {
    ['pk-r-verbrauch','pk-r-kosten','pk-r-co2','pk-r-lager'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
  }
  redrawPellets();
  cacheVariantResults();
}

export function clearPellets() {
  setPelletsKessel(null);
  if (pelletsLayerGroup) pelletsLayerGroup.clearLayers();
  document.getElementById('pellets-data-section').style.display = 'none';
  document.getElementById('btn-activate-pellets').style.display = '';
  document.getElementById('btn-place-pellets').textContent = 'Lager auf Karte platzieren';
  moBeiDeaktivierung('pellets');
  redrawErzeugerIcons();
  redrawVerbindungslinien();
  cacheVariantResults();
}

export function redrawPellets() {
  if (!pelletsLayerGroup) setPelletsLayerGroup(L.layerGroup().addTo(map));
  pelletsLayerGroup.clearLayers();
  if (!pelletsKessel || pelletsKessel.lat == null) { redrawVerbindungslinien(); return; }
  const center = L.latLng(pelletsKessel.lat, pelletsKessel.lng);
  const waerme = parseFloat(document.getElementById('pk-waerme').value)||0;
  const eta = parseFloat(document.getElementById('pk-eta').value)||88;
  let lagerFlaeche = 10;
  if (waerme > 0) {
    const verbrauchT = waerme / (eta/100) * 1000 / 4900;
    lagerFlaeche = Math.max(10, (verbrauchT * 1000 / 650) / 3);
  }
  const rl = Math.sqrt(lagerFlaeche * 1.5);
  const rw = lagerFlaeche / rl;
  const latPerM = 1/111320;
  const lngPerM = 1/(111320*Math.cos(center.lat*Math.PI/180));
  const sw = { lat: center.lat - rl/2*latPerM, lng: center.lng - rw/2*lngPerM };
  const ne = { lat: center.lat + rl/2*latPerM, lng: center.lng + rw/2*lngPerM };
  L.rectangle([sw, ne], { color:'#e65100', weight:2, fillColor:'#e65100', fillOpacity:0.2, dashArray:'6,4' })
    .bindTooltip(`Pellettlager · ${lagerFlaeche.toFixed(0)} m²`, {sticky:true})
    .addTo(pelletsLayerGroup);
  const pIcon = L.divIcon({ className:'', html:'<div style="width:22px;height:22px;background:rgba(230,81,0,0.35);border:2px solid #e65100;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;font-size:12px;">🌾</div>', iconSize:[22,22], iconAnchor:[11,11] });
  L.marker(center, { draggable:true, icon:pIcon }).addTo(pelletsLayerGroup)
    .on('dragend', function() { pelletsKessel.lat = this.getLatLng().lat; pelletsKessel.lng = this.getLatLng().lng; redrawPellets(); });
  redrawVerbindungslinien();
}

export function togglePlacePellets() {
  if (!pelletsKessel) return;
  if (pelletsKessel.lat != null) {
    delete pelletsKessel.lat; delete pelletsKessel.lng;
    if (pelletsLayerGroup) pelletsLayerGroup.clearLayers();
    redrawVerbindungslinien();
    document.getElementById('btn-place-pellets').textContent = 'Lager auf Karte platzieren';
  } else {
    setIsPlacingPellets(true);
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    showHint('Klicke auf die Karte, um das Pellettlager zu platzieren.');
    document.getElementById('btn-place-pellets').textContent = 'Klicke auf Karte…';
    document.getElementById('pellets-panel').classList.remove('visible');
    document.getElementById('btn-pellets-toggle')?.classList.remove('active');
  }
}

// ── Holzhackschnitzel ─────────────────────────────────────────────────────────
export function woodSvg(col='white', w=16, h=14) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 16 14" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="8" cy="11" rx="7" ry="2.5" fill="${col}" opacity="0.4"/>
    <rect x="1" y="4" width="14" height="5" rx="2.5" fill="${col}" opacity="0.9"/>
    <rect x="1" y="2" width="14" height="3.5" rx="2.5" fill="${col}"/>
    <line x1="5" y1="2" x2="5" y2="9.5" stroke="${col === 'white' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)'}" stroke-width="1"/>
    <line x1="11" y1="2" x2="11" y2="9.5" stroke="${col === 'white' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)'}" stroke-width="1"/>
  </svg>`;
}

export function oilSvg(col='white', w=14, h=18) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 14 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 1 Q11 6 11 11 A4 4 0 0 1 3 11 Q3 6 7 1Z" fill="${col}" opacity="0.95"/>
    <ellipse cx="7" cy="11.5" rx="2.5" ry="1.5" fill="white" opacity="0.25"/>
  </svg>`;
}

export function toggleHhsPanel() {
  const p = document.getElementById('hhs-panel');
  const btn = document.getElementById('btn-hhs-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (heizhackschnitzel) {
      document.getElementById('hhs-data-section').style.display = 'block';
      updateHhsDisplay();
    } else {
      document.getElementById('hhs-data-section').style.display = 'none';
    }
  }
}

export function activateHhs() {
  _setDefault30Pct('hhs-leistung');
  setHeizhackschnitzel({ leistungKw: Math.max(1, parseFloat(document.getElementById('hhs-leistung').value)||400) });
  document.getElementById('hhs-data-section').style.display = 'block';
  document.getElementById('btn-activate-hhs').style.display = 'none';
  moBeiAktivierung('hhs');
  redrawErzeugerIcons();
  updateHhsDisplay();
}

export function updateHhsDisplay() {
  if (!heizhackschnitzel) return;
  heizhackschnitzel.leistungKw = Math.max(1, parseFloat(document.getElementById('hhs-leistung').value)||400);
  const waerme = parseFloat(document.getElementById('hhs-waerme').value)||0;
  const eta = parseFloat(document.getElementById('hhs-eta').value)||85;
  const preis = parseFloat(document.getElementById('wirt-p-hhs')?.value) || 6; // ct/kWh
  if (waerme > 0) {
    const verbrauchMWh = waerme / (eta/100);
    const verbrauchT = verbrauchMWh * 1000 / 3200; // 3.2 kWh/kg
    const kosten = verbrauchMWh * preis * 10; // ct/kWh × MWh × 10 = €/a
    const co2 = verbrauchMWh * hhsEmF;
    const lagerFlaeche = (verbrauchT * 1000 / 250) / 5; // Schüttdichte 250 kg/m³, Höhe 5m
    document.getElementById('hhs-r-verbrauch').textContent = verbrauchT.toFixed(1) + ' t/a';
    document.getElementById('hhs-r-kosten').textContent = kosten.toFixed(0) + ' €/a';
    document.getElementById('hhs-r-co2').textContent = (co2/1000).toFixed(2) + ' t/a';
    document.getElementById('hhs-r-lager').textContent = lagerFlaeche.toFixed(0) + ' m²';
  } else {
    ['hhs-r-verbrauch','hhs-r-kosten','hhs-r-co2','hhs-r-lager'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
  }
  redrawHhs();
  cacheVariantResults();
}

export function clearHhs() {
  setHeizhackschnitzel(null);
  moBeiDeaktivierung('hhs');
  if (hhsLayerGroup) hhsLayerGroup.clearLayers();
  document.getElementById('hhs-data-section').style.display = 'none';
  document.getElementById('btn-activate-hhs').style.display = '';
  document.getElementById('btn-place-hhs').textContent = 'Lager auf Karte platzieren';
  redrawErzeugerIcons();
  redrawVerbindungslinien();
  cacheVariantResults();
}

export function redrawHhs() {
  if (!hhsLayerGroup) setHhsLayerGroup(L.layerGroup().addTo(map));
  hhsLayerGroup.clearLayers();
  if (!heizhackschnitzel || heizhackschnitzel.lat == null) { redrawVerbindungslinien(); return; }
  const center = L.latLng(heizhackschnitzel.lat, heizhackschnitzel.lng);
  const waerme = parseFloat(document.getElementById('hhs-waerme').value)||0;
  const eta = parseFloat(document.getElementById('hhs-eta').value)||85;
  let lagerFlaeche = 20;
  if (waerme > 0) {
    const verbrauchT = waerme / (eta/100) * 1000 / 3200;
    lagerFlaeche = Math.max(20, (verbrauchT * 1000 / 250) / 5);
  }
  const rl = Math.sqrt(lagerFlaeche * 1.5);
  const rw = lagerFlaeche / rl;
  const latPerM = 1/111320;
  const lngPerM = 1/(111320*Math.cos(center.lat*Math.PI/180));
  const sw = { lat: center.lat - rl/2*latPerM, lng: center.lng - rw/2*lngPerM };
  const ne = { lat: center.lat + rl/2*latPerM, lng: center.lng + rw/2*lngPerM };
  L.rectangle([sw, ne], { color:'#5d4037', weight:2, fillColor:'#5d4037', fillOpacity:0.2, dashArray:'6,4' })
    .bindTooltip(`HHS-Lager · ${lagerFlaeche.toFixed(0)} m²`, {sticky:true})
    .addTo(hhsLayerGroup);
  const hIcon = L.divIcon({ className:'', html:'<div style="width:22px;height:22px;background:rgba(93,64,55,0.35);border:2px solid #5d4037;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;font-size:12px;">🪵</div>', iconSize:[22,22], iconAnchor:[11,11] });
  L.marker(center, { draggable:true, icon:hIcon }).addTo(hhsLayerGroup)
    .on('dragend', function() { heizhackschnitzel.lat = this.getLatLng().lat; heizhackschnitzel.lng = this.getLatLng().lng; redrawHhs(); });
  redrawVerbindungslinien();
}

export function togglePlaceHhs() {
  if (!heizhackschnitzel) return;
  if (heizhackschnitzel.lat != null) {
    delete heizhackschnitzel.lat; delete heizhackschnitzel.lng;
    if (hhsLayerGroup) hhsLayerGroup.clearLayers();
    redrawVerbindungslinien();
    document.getElementById('btn-place-hhs').textContent = 'Lager auf Karte platzieren';
  } else {
    setIsPlacingHhs(true);
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    showHint('Klicke auf die Karte, um das HHS-Lager zu platzieren.');
    document.getElementById('btn-place-hhs').textContent = 'Klicke auf Karte…';
    document.getElementById('hhs-panel').classList.remove('visible');
    document.getElementById('btn-hhs-toggle')?.classList.remove('active');
  }
}

// ── Fernwärme ─────────────────────────────────────────────────────────────────
export function toggleFernwaermePanel() {
  const p = document.getElementById('fernwaerme-panel');
  const btn = document.getElementById('btn-fernwaerme-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (window.fernwaerme) {
      document.getElementById('fernwaerme-data-section').style.display = 'block';
      updateFernwaermeDisplay();
    } else {
      document.getElementById('fernwaerme-data-section').style.display = 'none';
    }
  }
}

export function activateFernwaerme() {
  window.fernwaerme = { leistungKw: Math.max(1, parseFloat(document.getElementById('fw-leistung').value)||500) };
  document.getElementById('fernwaerme-data-section').style.display = 'block';
  document.getElementById('btn-activate-fernwaerme').style.display = 'none';
  moBeiAktivierung('fernwaerme');
  redrawErzeugerIcons();
  updateFernwaermeDisplay();
}

export function updateFernwaermeDisplay() {
  if (!window.fernwaerme) return;
  window.fernwaerme.leistungKw = Math.max(1, parseFloat(document.getElementById('fw-leistung').value)||500);
  const waerme = parseFloat(document.getElementById('fw-waerme').value)||0;
  const preis = parseFloat(document.getElementById('wirt-p-fw')?.value) || 8;
  const co2f = parseFloat(document.getElementById('fw-co2f').value)||180;
  // Sync FW-Panel ↔ Kennwerte-Panel (CO₂-Faktor + PEF)
  const kennCo2 = document.getElementById('fernwaerme-emf');
  if (kennCo2 && parseFloat(kennCo2.value) !== co2f) { kennCo2.value = co2f; setFernwaermeEmF(co2f); }
  const fwPef = parseFloat(document.getElementById('fw-pef').value)||0.3;
  const kennPef = document.getElementById('pef-fernwaerme');
  if (kennPef && parseFloat(kennPef.value) !== fwPef) { kennPef.value = fwPef; setPefFernwaerme(fwPef); }
  if (waerme > 0) {
    const kosten = waerme * preis * 10;
    const co2 = waerme * co2f / 1000;
    document.getElementById('fw-r-kosten').textContent = kosten.toFixed(0) + ' €/a';
    document.getElementById('fw-r-co2').textContent = co2.toFixed(1) + ' t/a';
  } else {
    ['fw-r-kosten','fw-r-co2'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
  }
  cacheVariantResults();
}

export function clearFernwaerme() {
  window.fernwaerme = null;
  moBeiDeaktivierung('fernwaerme');
  if (fernwaermeLayerGroup) fernwaermeLayerGroup.clearLayers();
  document.getElementById('fernwaerme-data-section').style.display = 'none';
  document.getElementById('btn-activate-fernwaerme').style.display = '';
  document.getElementById('btn-place-fw').textContent = 'Einspeisepunkt auf Karte platzieren';
  redrawErzeugerIcons();
  redrawVerbindungslinien();
  cacheVariantResults();
}

export function redrawFernwaerme() {
  if (!fernwaermeLayerGroup) setFernwaermeLayerGroup(L.layerGroup().addTo(map));
  fernwaermeLayerGroup.clearLayers();
  if (!window.fernwaerme || window.fernwaerme.lat == null) { redrawVerbindungslinien(); return; }
  const fwIcon = L.divIcon({ className:'', html:'<div style="width:26px;height:26px;background:rgba(198,40,40,0.35);border:2px solid #c62828;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;font-size:14px;">🌡</div>', iconSize:[26,26], iconAnchor:[13,13] });
  L.marker(L.latLng(window.fernwaerme.lat, window.fernwaerme.lng), { draggable:true, icon:fwIcon, title:'Fernwärme-Einspeisepunkt' })
    .addTo(fernwaermeLayerGroup)
    .on('dragend', function() { window.fernwaerme.lat = this.getLatLng().lat; window.fernwaerme.lng = this.getLatLng().lng; redrawVerbindungslinien(); });
  redrawVerbindungslinien();
}

export function togglePlaceFernwaerme() {
  if (!window.fernwaerme) return;
  if (window.fernwaerme.lat != null) {
    delete window.fernwaerme.lat; delete window.fernwaerme.lng;
    if (fernwaermeLayerGroup) fernwaermeLayerGroup.clearLayers();
    redrawVerbindungslinien();
    document.getElementById('btn-place-fw').textContent = 'Einspeisepunkt auf Karte platzieren';
  } else {
    setIsPlacingFernwaerme(true);
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    showHint('Klicke auf die Karte, um den Fernwärme-Einspeisepunkt zu platzieren.');
    document.getElementById('btn-place-fw').textContent = 'Klicke auf Karte…';
    document.getElementById('fernwaerme-panel').classList.remove('visible');
    document.getElementById('btn-fernwaerme-toggle')?.classList.remove('active');
  }
}

// ── Verbindungslinien zur Heizzentrale ─────────────────────────────────────────
export function redrawVerbindungslinien() {
  if (!window.verbindungsLayerGroup) window.verbindungsLayerGroup = L.layerGroup().addTo(map);
  window.verbindungsLayerGroup.clearLayers();
  const zId = parseInt(document.getElementById('netz-zentrale')?.value);
  if (!zId || isNaN(zId)) return;
  const g = gebaeude.find(x => x.id === zId);
  if (!g || !g.polygon) return;
  const zentrale = polygonCenter(g.polygon);
  const lineStyle = { color: '#9e9e9e', weight: 1.5, dashArray: '8,6', opacity: 0.55 };
  if (geoThermie && geoThermie.lat != null)
    L.polyline([L.latLng(geoThermie.lat, geoThermie.lng), zentrale], lineStyle).addTo(window.verbindungsLayerGroup);
  if (lwWp && lwWp.lat != null)
    L.polyline([L.latLng(lwWp.lat, lwWp.lng), zentrale], lineStyle).addTo(window.verbindungsLayerGroup);
  if (fliessgewaesser && fliessgewaesser.latlngs && fliessgewaesser.latlngs.length >= 2) {
    const pts = fliessgewaesser.latlngs.map(p => L.latLng(p.lat, p.lng));
    const cp = closestPointOnPolyline(pts, zentrale);
    if (cp) L.polyline([cp, zentrale], lineStyle).addTo(window.verbindungsLayerGroup);
  }
  if (pelletsKessel && pelletsKessel.lat != null)
    L.polyline([L.latLng(pelletsKessel.lat, pelletsKessel.lng), zentrale], lineStyle).addTo(window.verbindungsLayerGroup);
  if (heizhackschnitzel && heizhackschnitzel.lat != null)
    L.polyline([L.latLng(heizhackschnitzel.lat, heizhackschnitzel.lng), zentrale], lineStyle).addTo(window.verbindungsLayerGroup);
  if (window.fernwaerme && window.fernwaerme.lat != null)
    L.polyline([L.latLng(window.fernwaerme.lat, window.fernwaerme.lng), zentrale], lineStyle).addTo(window.verbindungsLayerGroup);
  freiflaechen.forEach(ff => {
    if (ff.polygon && ff.polygon.length >= 3)
      L.polyline([polygonCenter(ff.polygon), zentrale],
        { color: '#ffd54f', weight: 1.5, dashArray: '8,6', opacity: 0.5 }).addTo(window.verbindungsLayerGroup);
  });
  // Solarthermie → Heizzentrale
  if (solarthermieAktiv && window._stPolygon && window._stPolygon.length >= 3) {
    const stCenter = polygonCenter(window._stPolygon);
    L.polyline([stCenter, zentrale],
      { color: '#ef6c00', weight: 1.5, dashArray: '8,6', opacity: 0.6 }).addTo(window.verbindungsLayerGroup);
  }
}

