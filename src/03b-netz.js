// ── 03b-netz.js — Netzplanung (Geothermie, Polygon-Zeichnen, Panel-Mgmt, OSM, Netzgraph, Strang-Report, Rohr-BOM) ──
// ── Geothermie-Sondenfeld ────────────────────────────────────────────────────
import { areaPolygon, gebaeude, globalYear, isDrawingTrasse, isExcluded, isPlacingLwWp, stromEmF, stromEmFLZ } from './01-globals-varianten.js';

let netzVisible = true;
let netzMotionless = false;
let netzFlowArrowLayer = null;
let netzFlowArrowEventsBound = false;
export let netzEditMode = false;
export let netzRewireMode = false;
let netzRewireMarkers = [];
let netzRewirePreview = null;
import { getNetzVBH, updateNetzColorLegend } from './02a-netz-physik.js';
import { attachPolygonLayer, getComputedStats, map } from './02b-gebaeude.js';
import { clearArea, polygonAreaM2, toggleDrawTrasse, togglePlaceLwWp, updateViz } from './02c-karte-werkzeuge.js';
import { drillSvg, redrawErzeugerIcons, redrawVerbindungslinien } from './03a-erzeuger.js';
import { drawChart, hideHint, renderList, showHint, detectRoofAzimutFromPolygon } from './03c-gebaeude-io.js';
import { _hideForDraw, _restoreAfterDraw, autoAssignEdgeCosts } from './04a-ui-panels.js';
import { glLastgangKw } from './06a-gbi-lastgang.js';
import { readNum } from './lib/util.js';
import { validateRadialHeatGraph } from './lib/waerme-graph-validation.js';
import { moBeiAktivierung, moBeiDeaktivierung, updateAllDeckungen } from './06c-dispatch-core.js';
import { syncErzeugerElektroAsset, removeErzeugerElektroAsset, moveErzeugerElektroAsset, updateErzeugerAssetProps } from './13p-erzeuger-assets.js';
import { areaEditMarkers, areaLatLngs, cacheVariantResults, currentMode, drawPoints, edgeKey, edgeWaypoints, fliessgewaesser, gasKessel, geoThermie, networkLocked, netzPruningMode, trassePoints, trasseSegments } from './01-globals-varianten.js';
import { addEdgeMidHandle, calcEdgeLength, clearEdgeGradient, drawEdgeGradient, getEdgeColor, getEdgeMidDisplayPt, getEdgeWaypoints, getKostenProM, getUWertForDN, getVFlowForDN, getWLD, getWLDColor, kostenSzenario, netzColorMode, removeEdgeWaypointMarkers, standardDNs } from './02a-netz-physik.js';
import { OSM_SKIP_TYPES, addGebaeude, osmNutzung } from './02b-gebaeude.js';
import { polygonCenter, redrawFliessgewaesser, redrawTrasse } from './02c-karte-werkzeuge.js';
import { beginInteraction, cancelInteraction, commitInteraction } from './lib/interaction-state.js';
import { redrawGasKessel } from './03a-erzeuger.js';
import { startAnimPipes, stopAnimPipes, updateTotals } from './03c-gebaeude-io.js';
import { closeEdgePopup, setLeftTab, showEdgePopup, toggleEdgePruned } from './04a-ui-panels.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { setEdgeStartId, setNetzEdges, setNetworkLocked, setSelectedId, setSelectedStrandId, set_batchImporting } from './01-globals-varianten.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { selectedStrandId } from './01-globals-varianten.js';

export function toggleGeoPanel() {
  const p = document.getElementById('geo-panel');
  const btn = document.getElementById('btn-geo-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) {
    p.classList.add('visible'); btn.classList.add('active');
    // 30%-Standardleistung wenn noch kein Wert eingetragen
    if (!document.getElementById('geo-heizlast').value) _setDefault30Pct('geo-heizlast');
    geoUpdateQperm(); calcGeoThermie();
  }
}

export function geoUseNetworkValues() {
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  const lastKw = window.calculatedLoad && window.calculatedLoad[zId] ? window.calculatedLoad[zId] : 0;
  const connectedIds = new Set(window.netzEdges.flatMap(e => [e.u, e.v]));
  const verbrauchMWh = gebaeude.filter(g => connectedIds.has(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const lossAnnual = window.netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0);
  const erzeugungMWh = verbrauchMWh + lossAnnual * 8.76;
  if (lastKw > 0) document.getElementById('geo-heizlast').value = Math.round(lastKw);
  if (erzeugungMWh > 0) document.getElementById('geo-waerme').value = Math.round(erzeugungMWh);
  calcGeoThermie();
}

// Wärmeleitfähigkeit λ (W/mK) → spez. Entzugsleistung q (W/m)
// Stützpunkte aus Liegenschaftsrechner-Korrelation (drei lineare Segmente):
//   λ 1–2: Δq = 11.8/λ-Einheit  (Steigung 11.8)
//   λ 2–3: Δq =  9.4/λ-Einheit  (Steigung  9.4)
//   λ 3–4: Δq =  7.7/λ-Einheit  (Steigung  7.7)
export function geoLambdaToQperm(lambda) {
  const pts = [[1.0, 19.6], [2.0, 31.4], [3.0, 40.8], [4.0, 48.5]];
  if (lambda <= pts[0][0]) return pts[0][1];
  if (lambda >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (lambda <= pts[i][0]) {
      const t = (lambda - pts[i-1][0]) / (pts[i][0] - pts[i-1][0]);
      return Math.round((pts[i-1][1] + t * (pts[i][1] - pts[i-1][1])) * 10) / 10;
    }
  }
  return pts[pts.length - 1][1];
}
export function geoUpdateQperm() {
  const lambda = parseFloat(document.getElementById('geo-lambda')?.value) || 2.0;
  const q = geoLambdaToQperm(lambda);
  const el = document.getElementById('geo-q-perm');
  if (el) el.value = q;
}

// 30%-Standard-Leistung: setzt Eingabefeld auf 30% der Netz-Normlast
export function _setDefault30Pct(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  // 1. Versuch: Summe aus Gebäude-Normlast
  let normKw = 0;
  if (typeof gebaeude !== 'undefined') {
    gebaeude.forEach(g => {
      if (typeof isExcluded === 'function' && isExcluded(g.id)) return;
      const stats = typeof getComputedStats === 'function'
        ? getComputedStats(g, globalYear) : { heizlast: parseFloat(g.heizlast) || 0 };
      normKw += stats.heizlast || 0;
    });
  }
  // 2. Fallback: Peak des hochgeladenen Lastgangs
  if (normKw <= 10 && typeof glLastgangKw !== 'undefined' && glLastgangKw) {
    for (let i = 0; i < glLastgangKw.length; i++) if (glLastgangKw[i] > normKw) normKw = glLastgangKw[i];
  }
  // 3. Fallback: CalcEngine-State Spitzenlast
  if (normKw <= 10 && window.systemState?.lastgangKw) {
    for (const v of window.systemState.lastgangKw) if (v > normKw) normKw = v;
  }
  if (normKw > 10) el.value = Math.round(normKw * 0.30);
}

export let _geoDispatchTimer = null;
export function _geoTriggerDispatch() {
  clearTimeout(_geoDispatchTimer);
  _geoDispatchTimer = setTimeout(() => {
    if (typeof updateAllDeckungen === 'function') updateAllDeckungen();
  }, 400);
}

export function calcGeoThermie() {
  const heizlastKw = parseFloat(document.getElementById('geo-heizlast').value) || 0;
  const waermeJahr = parseFloat(document.getElementById('geo-waerme').value) || 0;
  const tiefe  = Math.min(400, Math.max(30,  parseFloat(document.getElementById('geo-tiefe').value)  || 100));
  const qPerM  = Math.min(60,  Math.max(10,  parseFloat(document.getElementById('geo-q-perm').value) || 31));
  const abstand = Math.min(15, Math.max(6,   parseFloat(document.getElementById('geo-abstand').value) || 10));
  // JS-Objekt immer mit DOM-Werten synchronisieren (wichtig nach State-Restore)
  if (window.geoThermie) { window.geoThermie.abstand = abstand; window.geoThermie.tiefe = tiefe; }
  // JAZ für Sondendimensionierung: echte JAZ aus Dispatch wenn vorhanden, sonst Carnot-Schätzung
  const guetegrad = parseFloat(document.getElementById('geo-guetegrad')?.value) || 0.50;
  const tVlK = 35 + 273.15;
  const tQK  = 10 + 273.15; // mittlere Erdreichtemperatur Deutschland
  const jazCarnot = Math.max(2, Math.min(8, (tVlK / (tVlK - tQK)) * guetegrad));
  const en  = window._dispatchEnergy?.['geo'];
  const jaz = (en && en.elMwh > 0) ? en.waermeMwh / en.elMwh : jazCarnot;
  const jazEl = document.getElementById('geo-jaz');
  if (jazEl) jazEl.value = jaz.toFixed(2);
  // Display: nur nach Dispatch einen Wert zeigen (vorher —)
  const jazDisp = document.getElementById('geo-jaz-display');
  if (jazDisp && en && en.elMwh > 0) jazDisp.textContent = jaz.toFixed(2) + ' (stundenscharf)';
  if (heizlastKw <= 0) {
    ['geo-r-sonden','geo-r-feld','geo-r-flaeche','geo-r-length','geo-r-strom','geo-r-erde'].forEach(id => { document.getElementById(id).textContent = '—'; });
    const hinwEl2 = document.getElementById('geo-r-hinweis'); const hinwLbl2 = document.getElementById('geo-r-hinweis-lbl');
    if (hinwEl2) hinwEl2.style.display = 'none'; if (hinwLbl2) hinwLbl2.style.display = 'none';
    const effEl = document.getElementById('geo-leistung-eff');
    if (effEl) effEl.value = 0;
    return;
  }
  // ── Kriterium 1: Leistung (Spitzenlast) ──────────────────────────────────
  const erdwaerme_kw = heizlastKw * (jaz - 1) / jaz;
  const pro_sonde_kw = qPerM * tiefe / 1000;             // kW Entzug je Sonde
  const n_leistung   = Math.max(1, Math.ceil(erdwaerme_kw / pro_sonde_kw));

  // ── Kriterium 2: Energie (VDI 4640 — angepasst auf 2100 VBH/a) ───────────
  // Max. Jahresentzug je Sonde = q_spez [W/m] × tiefe [m] × 2100 h/a / 1000
  const VBH_VDI = 2100;
  const maxEntzugProSonde_kwh = qPerM * tiefe / 1000 * VBH_VDI;
  let n_energie = 1;
  if (waermeJahr > 0) {
    const erdwaerme_kwh = waermeJahr * 1000 * (jaz - 1) / jaz; // kWh/a Erdwärme
    n_energie = Math.max(1, Math.ceil(erdwaerme_kwh / maxEntzugProSonde_kwh));
  }

  const n_sonden    = Math.max(n_leistung, n_energie);
  const limitGrund  = n_energie > n_leistung ? 'Energie' : 'Leistung'; // für Hinweis

  // ── Quadratische Grundfläche: ceil(√n) × ceil(√n) ─────────────────────────
  const side   = Math.ceil(Math.sqrt(n_sonden));  // Sonden je Seite
  const cols   = side;
  const rows   = side;
  const breite = cols * abstand;
  const laenge = rows * abstand;
  const flaeche = breite * laenge;
  const totalLength = n_sonden * tiefe;
  const strom = waermeJahr > 0 ? waermeJahr / jaz : null;
  const erde  = waermeJahr > 0 ? waermeJahr * (jaz - 1) / jaz : null;
  document.getElementById('geo-r-sonden').textContent =
    `${n_sonden} (${side}×${side}) — limitiert durch ${limitGrund}`;
  document.getElementById('geo-r-feld').textContent = `${breite.toFixed(0)} × ${laenge.toFixed(0)} m`;
  document.getElementById('geo-r-flaeche').textContent = `${flaeche.toFixed(0)} m²`;
  document.getElementById('geo-r-length').textContent = `${totalLength.toFixed(0)} m`;
  const co2Geo   = strom ? strom * stromEmF   / 1000 : null;
  const co2GeoLZ = strom ? strom * stromEmFLZ / 1000 : null;
  document.getElementById('geo-r-strom').textContent = strom ? `${strom.toFixed(0)} MWh/a` : '—';
  document.getElementById('geo-r-erde').textContent = erde ? `${erde.toFixed(0)} MWh/a` : '—';
  document.getElementById('geo-r-co2').textContent = co2Geo ? `${co2Geo.toFixed(1)} t/a (2026) · ${co2GeoLZ.toFixed(1)} t/a (Ø 2030–50)` : '—';

  if (window.geoThermie) {
    window.geoThermie.reqFlaeche = flaeche; // Automatisch berechnete Sollfläche für Farbfeedback beim Ziehen
    const manL = parseFloat(document.getElementById('geo-man-laenge')?.value) || 0;
    const manB = parseFloat(document.getElementById('geo-man-breite')?.value) || 0;
    const hinwEl = document.getElementById('geo-r-hinweis');
    const hinwLbl = document.getElementById('geo-r-hinweis-lbl');
    if (manL > 0 && manB > 0) {
      const mCols = Math.max(1, Math.floor(manB / abstand));
      const mRows = Math.max(1, Math.floor(manL / abstand));
      const n_actual = mCols * mRows;
      const fits = n_actual >= n_sonden;
      // Ergebnisse auf Basis der tatsächlich passenden Sonden neu berechnen
      const totalLengthMan = n_actual * tiefe;
      const erdeMan  = n_actual * maxEntzugProSonde_kwh * (jaz - 1) / jaz;
      const stromMan = erdeMan / (jaz - 1);
      // Effektive Leistung aus tatsächlicher Feldgröße
      const leistungKwEff = jaz > 1 ? n_actual * pro_sonde_kw * jaz / (jaz - 1) : heizlastKw;
      document.getElementById('geo-r-sonden').textContent =
        `${n_actual} (${mCols}×${mRows}) ✏ — VDI mind. ${n_sonden} ${fits ? '✓' : '⚠'} · ${Math.round(leistungKwEff)} kW`;
      document.getElementById('geo-r-feld').textContent = `${manB.toFixed(0)} × ${manL.toFixed(0)} m ✏`;
      document.getElementById('geo-r-flaeche').textContent = `${(manL * manB).toFixed(0)} m²`;
      document.getElementById('geo-r-length').textContent = `${totalLengthMan.toFixed(0)} m`;
      document.getElementById('geo-r-strom').textContent = `${stromMan.toFixed(0)} MWh/a (max.)`;
      document.getElementById('geo-r-erde').textContent = `${erdeMan.toFixed(0)} MWh/a (max.)`;
      // Heizlast- und Wärmeabgabe-Felder sofort mit Feldkapazität befüllen
      document.getElementById('geo-heizlast').value = Math.round(leistungKwEff);
      const maxWaermeMwh = n_actual * maxEntzugProSonde_kwh / 1000;
      const waermeEl = document.getElementById('geo-waerme');
      if (waermeEl) waermeEl.value = Math.round(maxWaermeMwh);
      // Limitierender Faktor anzeigen
      if (hinwLbl) { hinwLbl.style.display = ''; hinwLbl.textContent = 'Begrenzung'; }
      if (hinwEl) {
        const isEnergie = n_energie > n_leistung;
        hinwEl.style.display = '';
        hinwEl.style.color = isEnergie ? '#ff9800' : '#4caf50';
        hinwEl.textContent = `${limitGrund}-begrenzt · Feld ${fits ? '✓' : '⚠'} (${n_actual} von mind. ${n_sonden})`;
      }
      Object.assign(window.geoThermie, { n_sonden: n_actual, cols: mCols, rows: mRows, abstand, tiefe, flaeche: manL * manB, breite: manB, laenge: manL });
      const effEl = document.getElementById('geo-leistung-eff');
      if (effEl) effEl.value = leistungKwEff.toFixed(1);
    } else {
      // Auto-Modus: limitierenden Faktor anzeigen
      if (hinwLbl) { hinwLbl.style.display = ''; hinwLbl.textContent = 'Begrenzung'; }
      if (hinwEl) {
        const isEnergie = n_energie > n_leistung;
        hinwEl.style.display = '';
        hinwEl.style.color = isEnergie ? '#ff9800' : '#4caf50';
        hinwEl.textContent = `${limitGrund}-begrenzt (${n_leistung} Leistung / ${n_energie} Energie Sonden)`;
      }
      Object.assign(window.geoThermie, { n_sonden, cols, rows, abstand, tiefe, flaeche, breite, laenge,
        reqFlaeche: flaeche }); // Sollfläche = Quadrat für Farbfeedback
      const effEl = document.getElementById('geo-leistung-eff');
      if (effEl) effEl.value = heizlastKw;
    }
    redrawGeo();
    // _geoNoReentry: gesetzt, wenn calcGeoThermie aus dem Dispatch-Ergebnis kommt —
    // dann NICHT erneut den Dispatch anstoßen (sonst Endlos-Loop + Layer-Leak).
    if (!window._wirtRefreshing && !window._geoNoReentry) _geoTriggerDispatch();
    updateErzeugerAssetProps('geo');
  } else {
    // geoThermie nicht gesetzt — trotzdem leistung-eff aktualisieren
    const effEl = document.getElementById('geo-leistung-eff');
    if (effEl) effEl.value = heizlastKw;
  }
}

export function togglePlaceGeo() {
  window.isPlacingGeo = !window.isPlacingGeo;
  const btn = document.getElementById('btn-place-geo');
  if (window.isPlacingGeo) {
    beginInteraction({id:'place-geothermal',label:'Sondenfeld platzieren',hint:'Position auf der Karte anklicken.',cancel:()=>{ if (window.isPlacingGeo) togglePlaceGeo(); }});
    btn.textContent = 'Klicke auf Karte…';
    btn.style.borderColor = '#4caf50';
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    showHint('Klicke auf die Karte, um das Sondenfeld zu platzieren.');
    document.getElementById('geo-panel').classList.remove('visible');
    document.getElementById('btn-geo-toggle')?.classList.remove('active');
  } else {
    cancelInteraction('place-geothermal');
    btn.textContent = 'Auf Karte platzieren';
    btn.style.borderColor = '';
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
  }
}

export function placeGeoAt(latlng) {
  commitInteraction('place-geothermal');
  if (!window.geoLayerGroup) window.geoLayerGroup = L.layerGroup().addTo(map);
  const jaz = parseFloat(document.getElementById('geo-jaz').value) || 4.5;
  const tiefe = parseFloat(document.getElementById('geo-tiefe').value) || 100;
  const abstand = parseFloat(document.getElementById('geo-abstand').value) || 10;
  document.getElementById('geo-man-laenge').value = '';
  document.getElementById('geo-man-breite').value = '';
  window.geoThermie = { lat: latlng.lat, lng: latlng.lng, n_sonden: 0, cols: 1, rows: 1, abstand, tiefe, flaeche: 0, breite: 0, laenge: 0 };
  moBeiAktivierung('geo');
  calcGeoThermie();
  syncErzeugerElektroAsset('geo');
  document.getElementById('btn-place-geo').textContent = 'Position verschieben';
  redrawErzeugerIcons();
}

export function redrawGeo() {
  if (!window.geoLayerGroup) return;
  window.geoLayerGroup.clearLayers();
  if (!window.geoThermie || !window.geoThermie.n_sonden || window.geoThermie.lat == null || window.geoThermie.lng == null) return;
  const center = L.latLng(window.geoThermie.lat, window.geoThermie.lng);
  const { cols, rows, abstand, n_sonden, breite, laenge } = window.geoThermie;
  const latPerM = 1 / 111320;
  const lngPerM = 1 / (111320 * Math.cos(center.lat * Math.PI / 180));
  // Mutable bounds – werden von Griffn live aktualisiert
  const sw = { lat: center.lat - laenge / 2 * latPerM, lng: center.lng - breite / 2 * lngPerM };
  const ne = { lat: center.lat + laenge / 2 * latPerM, lng: center.lng + breite / 2 * lngPerM };
  const reqF = window.geoThermie.reqFlaeche || laenge * breite;
  const tol = 0.08; // 8 % Toleranz
  function actF() { return ((ne.lat - sw.lat) / latPerM) * ((ne.lng - sw.lng) / lngPerM); }
  function fb(aF) {
    if (aF < reqF * (1 - tol)) return { c: '#ef5350', o: 0.30 }; // zu klein → Rot
    if (aF > reqF * (1 + tol)) return { c: '#66bb6a', o: 0.22 }; // zu groß → Grün
    return { c: '#795548', o: 0.15 };
  }
  const f0 = fb(actF());
  const rect = L.rectangle([sw, ne], { color: '#795548', weight: 2, fillColor: f0.c, fillOpacity: f0.o, dashArray: '6,4' })
    .bindTooltip(`${n_sonden} Sonden · ${(laenge * breite).toFixed(0)} m² · ${geoThermie.tiefe} m tief`, { sticky: true })
    .addTo(window.geoLayerGroup);
  // Bohrlöcher – immer anzeigen, Canvas-Renderer für Performance bei großen Feldern
  {
    const oLat = center.lat - (rows - 1) * abstand / 2 * latPerM;
    const oLng = center.lng - (cols - 1) * abstand / 2 * lngPerM;
    // Visuelle Parameter skalieren: bei sehr vielen Sonden kleiner + transparenter
    const r   = n_sonden > 800 ? abstand * 0.25 : n_sonden > 300 ? abstand * 0.35 : abstand * 0.45;
    const wt  = n_sonden > 300 ? 0 : 1;
    const fop = n_sonden > 800 ? 0.55 : 0.75;
    // Renderer einmalig wiederverwenden — sonst bleibt pro redrawGeo ein verwaister
    // L.canvas auf der Karte zurück (clearLayers räumt nur die Gruppe) → Layer-Leak.
    if (!window._geoCanvasRenderer) window._geoCanvasRenderer = L.canvas({ padding: 0.5 });
    const renderer = window._geoCanvasRenderer;
    let cnt = 0;
    for (let row = 0; row < rows && cnt < n_sonden; row++)
      for (let col = 0; col < cols && cnt < n_sonden; col++) {
        L.circle(L.latLng(oLat + row * abstand * latPerM, oLng + col * abstand * lngPerM),
          { radius: r, color: '#4e342e', fillColor: '#a1887f', fillOpacity: fop, weight: wt, renderer }).addTo(window.geoLayerGroup);
        cnt++;
      }
  }
  // Größen-Anfasser (weiße Quadrate) entfernt — wirkten unruhig (analog LW-WP).
  // Fläche skaliert automatisch aus der Sondenzahl; manuelle Maße über die Felder
  // „Länge/Breite manuell" im Geothermie-Panel.
  // Zentrum verschieben
  const geoIcon = L.divIcon({ className: '', html: '<div style="width:26px;height:26px;background:rgba(121,85,72,0.35);border:2px solid #795548;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;">' + drillSvg('#a1887f',14,20) + '</div>', iconSize: [26,26], iconAnchor: [13,13] });
  L.marker(center, { draggable: true, icon: geoIcon, zIndexOffset: 1000 }).addTo(window.geoLayerGroup)
    .on('dragend', function() { window.geoThermie.lat = this.getLatLng().lat; window.geoThermie.lng = this.getLatLng().lng; redrawGeo(); moveErzeugerElektroAsset('geo'); });
  if (!map.hasLayer(window.geoLayerGroup)) window.geoLayerGroup.addTo(map);
  redrawVerbindungslinien();
}

export function setGeoVisible(visible) {
  if (!window.geoLayerGroup) return;
  if (visible) { if (!map.hasLayer(window.geoLayerGroup)) window.geoLayerGroup.addTo(map); }
  else { if (map.hasLayer(window.geoLayerGroup)) map.removeLayer(window.geoLayerGroup); }
}

export function clearGeo() {
  window.geoThermie = null;
  moBeiDeaktivierung('geo');
  removeErzeugerElektroAsset('geo');
  if (window.geoLayerGroup) window.geoLayerGroup.clearLayers();
  document.getElementById('btn-place-geo').textContent = 'Auf Karte platzieren';
  // Manuelle Maße zurücksetzen damit sie nicht in andere Varianten bluten
  document.getElementById('geo-man-laenge').value = '';
  document.getElementById('geo-man-breite').value = '';
  redrawErzeugerIcons();
}

export function startDraw(id){
  clearArea(); cancelDraw();
  beginInteraction({id:'draw-generator-area',label:'Anlagenfläche zeichnen',hint:'Eckpunkte setzen und Startpunkt zum Abschließen anklicken.',cancel:cancelDraw});
  window.drawingId=id; window.drawPoints=[];
  showHint('Eckpunkte anklicken · Am Ende Startpunkt (rot) anklicken · Rechtsklick = Zurück');
  _hideForDraw();
  map.getContainer().style.cursor='crosshair';
  setSelectedId(id); renderList();
}

export function cancelDraw(){
  if(window.drawPolyline){map.removeLayer(window.drawPolyline);window.drawPolyline=null;}
  if(window.drawStartMarker){map.removeLayer(window.drawStartMarker);window.drawStartMarker=null;}
  window.drawingId=null;window.drawPoints=[];
  map.getContainer().style.cursor='';hideHint();
  _restoreAfterDraw();
  cancelInteraction('draw-generator-area');
}

export function finishDraw(){
  if(window.drawPoints.length < 3) return;
  commitInteraction('draw-generator-area');
  const id=window.drawingId,pts=[...(window.drawPoints||drawPoints)];
  cancelDraw();
  const g=(window.gebaeude||gebaeude).find(x=>x.id===id);if(!g) return;
  g.polygon=pts;
  g.flaeche=polygonAreaM2(pts);
  attachPolygonLayer(g);

  // Bestandsnetz: neu gezeichnetes Gebäude automatisch per Lotpunkt-Stich anschließen
  if (networkLocked && window.netzEdges && window.netzEdges.length) {
    try { connectGebToNearestPipe(g); } catch(e) { console.warn('connectGebToNearestPipe:', e); }
  }

  if(g.flaeche > 0) {
    if(g.waerme) g.spez = Math.round(parseFloat(g.waerme)*1000/g.flaeche*10)/10;
    if(g.heizlast) g.spezHeizlast = Math.round(parseFloat(g.heizlast)*1000/g.flaeche*10)/10;
  }

  // Unified Asset-System: Auto-Create UV + Verbraucher + PV (opt-in)
  if (typeof window.autoCreateBuildingAssets === 'function') {
    try { window.autoCreateBuildingAssets(g); } catch(e) { console.warn('autoCreateBuildingAssets:', e); }
  }

  renderList();updateViz();
}

export function hidePanels(){
  document.getElementById('osm-panel').classList.remove('visible');
  document.getElementById('netz-panel').classList.remove('visible');
  document.getElementById('kennwerte-panel').classList.remove('visible');
  document.getElementById('fliessgewaesser-panel').classList.remove('visible');
  document.getElementById('lwwp-panel').classList.remove('visible');
  document.getElementById('gaskessel-panel').classList.remove('visible');
  document.getElementById('heizoel-panel').classList.remove('visible');
  document.getElementById('pellets-panel').classList.remove('visible');
  document.getElementById('hhs-panel').classList.remove('visible');
  document.getElementById('fernwaerme-panel').classList.remove('visible');
  document.getElementById('geo-panel').classList.remove('visible');
  document.getElementById('area-edit-panel').classList.remove('visible');
  document.getElementById('chart-panel').classList.remove('visible');
  document.getElementById('overlay-panel').classList.remove('visible');
  document.getElementById('btn-netz-toggle').classList.remove('active');
  document.getElementById('btn-kennwerte-toggle').classList.remove('active');
  document.getElementById('btn-fliessgewaesser-toggle').classList.remove('active');
  document.getElementById('btn-lwwp-toggle').classList.remove('active');
  document.getElementById('btn-gaskessel-toggle').classList.remove('active');
  document.getElementById('btn-heizoel-toggle').classList.remove('active');
  document.getElementById('btn-pellets-toggle').classList.remove('active');
  document.getElementById('btn-hhs-toggle').classList.remove('active');
  document.getElementById('btn-fernwaerme-toggle').classList.remove('active');
  document.getElementById('btn-geo-toggle').classList.remove('active');
  document.getElementById('btn-chart-toggle').classList.remove('active');
  document.getElementById('btn-overlay-toggle').classList.remove('active');
  document.getElementById('grundlagen-panel').classList.remove('visible');
  document.getElementById('btn-grundlagen-toggle').classList.remove('active');
  document.getElementById('analyse-panel').classList.remove('visible');
  document.getElementById('btn-analyse-toggle').classList.remove('active');
  document.getElementById('wirtschaft-panel').classList.remove('visible');
  document.getElementById('btn-wirtschaft-toggle').classList.remove('active');
  document.getElementById('strom-panel')?.classList.remove('visible');
  document.getElementById('btn-strom-toggle')?.classList.remove('active');
  const _tsP = document.getElementById('therm-speicher-panel');
  if (_tsP) _tsP.style.display = 'none';
  const _stP = document.getElementById('solarthermie-panel');
  if (_stP) { _stP.classList.remove('visible'); _stP.style.display = 'none'; }
  document.getElementById('btn-solarthermie-toggle')?.classList.remove('active');
  document.getElementById('bhkw-panel')?.classList.remove('visible');
  document.getElementById('btn-bhkw-toggle')?.classList.remove('active');
  document.getElementById('stromkessel-panel')?.classList.remove('visible');
  document.getElementById('btn-stromkessel-toggle')?.classList.remove('active');
  document.getElementById('geb-pv-panel')?.classList.remove('visible');
  document.getElementById('btn-geb-pv-toggle')?.classList.remove('active');
  document.getElementById('ff-pv-panel')?.classList.remove('visible');
  document.getElementById('btn-ff-pv-toggle')?.classList.remove('active');
  document.getElementById('pv-panel')?.classList.remove('visible');
  document.getElementById('batterie-panel')?.classList.remove('visible');
  if (isPlacingLwWp) togglePlaceLwWp();
  if (window.isPlacingGeo) { window.isPlacingGeo = false; map.getContainer().style.cursor = ''; }
  if (window.isPlacingPellets) { window.isPlacingPellets = false; map.getContainer().style.cursor = ''; }
  if (window.isPlacingHhs) { window.isPlacingHhs = false; map.getContainer().style.cursor = ''; }
  if (window.isPlacingFernwaerme) { window.isPlacingFernwaerme = false; map.getContainer().style.cursor = ''; }
  // Overlay fixieren, sobald das Panel geschlossen wird (nicht während der Referenzpunkt-Modus läuft).
  if (!window._ovRef) setOverlayLocked(true);
  _restoreAfterDraw();
}

export function toggleOverlayPanel() {
  const p = document.getElementById('overlay-panel');
  const btn = document.getElementById('btn-overlay-toggle');
  if(p.classList.contains('visible')){
    p.classList.remove('visible');
    btn.classList.remove('active');
    setOverlayLocked(true);          // Panel zu → aktiver Plan fixiert
    _renderOverlays();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    // Beim Öffnen einen sichtbaren Plan zum Bearbeiten aktivieren (den aktiven, sonst den letzten).
    const list = window.overlays || [];
    const act = _overlayById(window._activeOverlayId);
    if (act && act.visible) setActiveOverlay(act.id);
    else {
      const last = [...list].reverse().find(o => o.visible);
      if (last) setActiveOverlay(last.id);
      else _renderOverlays();
    }
  }
}

export function showOsmPanel(){
  if(areaPolygon) { showAreaEditPanel(); return; }
  hidePanels();
  document.getElementById('osm-panel').classList.add('visible');
}

export function showAreaEditPanel(){
  hidePanels();
  document.getElementById('area-edit-panel').classList.add('visible');
}

export function toggleChartPanel(){
  const p = document.getElementById('chart-panel');
  const btn = document.getElementById('btn-chart-toggle');
  if(p.classList.contains('visible')){
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    drawChart();
  }
}

export function toggleNetzPanel(){
  const p = document.getElementById('netz-panel');
  const btn = document.getElementById('btn-netz-toggle');
  if(p.classList.contains('visible')){
    p.classList.remove('visible');
    btn.classList.remove('active');
    if(window.isDrawingEdge) toggleDrawEdge();
    if(isDrawingTrasse) toggleDrawTrasse();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    updateRohrListe();
    updateNetzColorLegend();
  }
}

export function openNetzWorkspace(mode = 'edit') {
  const workspace = document.getElementById('netz-workspace');
  const createArea = document.getElementById('netz-workspace-create');
  const editArea = document.getElementById('netz-workspace-edit');
  const centralArea = document.getElementById('netz-workspace-central');
  const settingsArea = document.getElementById('netz-workspace-settings');
  const settingsContent = document.getElementById('netz-settings-content');
  const centralControl = document.getElementById('netz-central-control');
  const createMenu = document.getElementById('netz-create-menu');
  if (!workspace || !createArea || !editArea) return false;
  setLeftTab('netz');
  document.getElementById('left-panel')?.classList.remove('collapsed');
  document.getElementById('netz-panel')?.classList.remove('visible');
  document.getElementById('btn-netz-toggle')?.classList.remove('active');
  const netzOverview = document.getElementById('lp-netz-waerme');
  if (netzOverview) netzOverview.hidden = true;
  workspace.hidden = false;
  createArea.hidden = mode !== 'create';
  editArea.hidden = mode !== 'edit';
  document.getElementById('netz-workspace-title').textContent = mode === 'create'
    ? 'Wärmenetz erstellen' : 'Wärmenetz bearbeiten';
  document.getElementById('netz-workspace-subtitle').textContent = mode === 'create'
    ? 'Aufbau und Netzstruktur festlegen' : 'Anschlüsse und Leitungen auf der Karte anpassen';
  if (settingsArea && settingsContent) settingsArea.appendChild(settingsContent);
  if (centralArea && centralControl) centralArea.appendChild(centralControl);
  if (mode === 'create' && createMenu) {
    createArea.appendChild(createMenu);
    createMenu.hidden = false;
  }
  window._syncNetworkLockUI?.();
  workspace.scrollIntoView({behavior:'smooth',block:'start'});
  return true;
}

export function closeNetzWorkspace() {
  const workspace = document.getElementById('netz-workspace');
  const createMenu = document.getElementById('netz-create-menu');
  const settingsContent = document.getElementById('netz-settings-content');
  const centralControl = document.getElementById('netz-central-control');
  const netzPanel = document.getElementById('netz-panel');
  if (centralControl && settingsContent) settingsContent.prepend(centralControl);
  if (settingsContent && netzPanel) netzPanel.appendChild(settingsContent);
  const originalShell = settingsContent?.querySelector('.netz-create-shell');
  if (createMenu && originalShell) {
    originalShell.appendChild(createMenu);
    createMenu.hidden = true;
  }
  setNetzEditMode(false);
  setNetzRewireMode(false);
  if (window.isDrawingEdge) toggleDrawEdge();
  if (workspace) workspace.hidden = true;
  const netzOverview = document.getElementById('lp-netz-waerme');
  if (netzOverview) netzOverview.hidden = false;
  return true;
}

export function loadOverlay(input) {
  if (!input.files || !input.files.length) return;
  Array.from(input.files).forEach(file => {
    const name = file.name.replace(/\.[^.]+$/, '');
    const pid = _addOverlayPending(name);   // Lade-Anzeige in der Liste
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      loadOverlayFromPdf(file, name, pid);
    } else {
      const reader = new FileReader();
      reader.onload = function(e) {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onload = function() { _removeOverlayPending(pid); setupOverlayOnMap(dataUrl, img.width, img.height, name); };
        img.onerror = function() { _removeOverlayPending(pid); showHint('Bild konnte nicht geladen werden: ' + name); };
        img.src = dataUrl;
      };
      reader.onerror = function() { _removeOverlayPending(pid); showHint('Datei konnte nicht gelesen werden: ' + name); };
      reader.readAsDataURL(file);
    }
  });
  input.value = '';   // erlaubt erneutes Laden derselben Datei
}

async function loadOverlayFromPdf(file, name, pid) {
  try {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      if (window.__PDF_WORKER_CODE__) {
        window._pdfWorkerBlobUrl = window._pdfWorkerBlobUrl || URL.createObjectURL(new Blob([window.__PDF_WORKER_CODE__], {type:'text/javascript'}));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = window._pdfWorkerBlobUrl;
      } else {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs';
      }
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    _removeOverlayPending(pid);
    setupOverlayOnMap(canvas.toDataURL('image/png'), canvas.width, canvas.height, name);
  } catch (e) {
    console.error('PDF-Overlay fehlgeschlagen:', e);
    _removeOverlayPending(pid);
    showHint('PDF konnte nicht geladen werden: ' + name);
  }
}

// Neuen Plan als Overlay hinzufügen (mehrere Pläne werden in window.overlays gesammelt).
export function setupOverlayOnMap(url, w, h, name) {
  if (!window.overlays) window.overlays = [];
  if (!window._overlayCounter) window._overlayCounter = 1;
  const center = map.getCenter();
  const offsetLat = 0.003;
  const ratio = (w && h) ? w / h : 1;
  const offsetLng = offsetLat * ratio;
  const corners = [
    { lat: center.lat + offsetLat, lng: center.lng - offsetLng }, // NW
    { lat: center.lat + offsetLat, lng: center.lng + offsetLng }, // NE
    { lat: center.lat - offsetLat, lng: center.lng - offsetLng }, // SW
    { lat: center.lat - offsetLat, lng: center.lng + offsetLng }, // SE
  ];
  const ov = {
    id: window._overlayCounter++,
    name: name || `Plan ${window.overlays.length + 1}`,
    url, w, h, corners, opacity: 0.5, visible: true, layer: null,
  };
  window.overlays.push(ov);
  _createOverlayLayer(ov);
  setActiveOverlay(ov.id);
  showHint('Neuer Plan hinzugefügt. Über die Eck-/Kantengriffe ausrichten oder „Über Referenzpunkte ausrichten". Beim Schließen des Panels werden alle Pläne fixiert.');
}

// corners = [TL, TR, BL, BR] (Reihenfolge von Leaflet.DistortableImage). Kantenpaare: oben, rechts, unten, links.
const _OVERLAY_EDGE_PAIRS = [[0, 1], [1, 3], [3, 2], [2, 0]];

function _overlayEdgeMidpoint(corners, pair) {
  const a = corners[pair[0]], b = corners[pair[1]];
  return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
}

function createOverlayEdgeHandles() {
  removeOverlayEdgeHandles();
  const layer = window.overlayLayer;
  if (!layer) return;
  const icon = L.divIcon({ className: 'overlay-edge-handle', iconSize: [12, 12] });
  window.overlayEdgeMarkers = _OVERLAY_EDGE_PAIRS.map(pair => {
    const marker = L.marker(_overlayEdgeMidpoint(layer.getCorners(), pair), {
      draggable: true, icon, zIndexOffset: 3100
    }).addTo(map);
    let lastLatLng = marker.getLatLng();
    marker.on('dragstart', () => { window._overlayEdgeDragging = marker; });
    marker.on('drag', () => {
      const cur = marker.getLatLng();
      const dLat = cur.lat - lastLatLng.lat;
      const dLng = cur.lng - lastLatLng.lng;
      lastLatLng = cur;
      const newCorners = layer.getCorners().slice();
      pair.forEach(i => { newCorners[i] = L.latLng(newCorners[i].lat + dLat, newCorners[i].lng + dLng); });
      layer.setCorners(newCorners);
    });
    marker.on('dragend', () => { window._overlayEdgeDragging = null; });
    return marker;
  });
}

function repositionOverlayEdgeHandles() {
  const layer = window.overlayLayer;
  if (!window.overlayEdgeMarkers || !layer) return;
  const corners = layer.getCorners();
  window.overlayEdgeMarkers.forEach((marker, idx) => {
    if (marker === window._overlayEdgeDragging) return;
    marker.setLatLng(_overlayEdgeMidpoint(corners, _OVERLAY_EDGE_PAIRS[idx]));
  });
}

function removeOverlayEdgeHandles() {
  if (window.overlayEdgeMarkers) {
    window.overlayEdgeMarkers.forEach(m => map.removeLayer(m));
    window.overlayEdgeMarkers = null;
  }
}

export function changeOverlayOpacity(val) {   // wirkt auf den aktiven Plan (Alt-Kompatibilität)
  if (window.overlayLayer) window.overlayLayer.setOpacity(val);
}

// ── Mehrere Pläne verwalten ──────────────────────────────────────────────────
function _overlayById(id) { return (window.overlays || []).find(o => o.id === id); }
function _activeOverlay() { return _overlayById(window._activeOverlayId); }

// Bild eines nicht-aktiven Overlays klick-transparent + ohne Editiergriffe.
// Wichtig: editing.disable() allein reicht nicht — die DistortableImage-Lib
// bindet beim Hinzufügen zusätzlich ein eigenes L.Draggable auf das <img>
// (layer.editing.dragging), das per pointer-events wieder aktiv geschaltet
// wird und unabhängig vom Editier-/Handle-Status Drags entgegennimmt. Ohne
// explizites disable() hier lässt sich der Plan trotz "gesperrt" verschieben.
function _lockLayer(layer) {
  if (!layer) return;
  try { layer.editing.disable(); } catch (e) {}
  try { layer.editing.dragging.disable(); } catch (e) {}
  const el = layer.getElement && layer.getElement();
  if (el) el.style.pointerEvents = 'none';
}

// Live-Eckpunkte des Layers in den Overlay-Eintrag zurückschreiben, damit
// Ausrichtung (Drag, Referenzpunkte, Rotate/Distort) das Ausblenden überlebt —
// ov.layer wird beim Verstecken zerstört, ov.corners bleibt bestehen.
function _syncOverlayCorners(ov) {
  if (!ov || !ov.layer) return;
  ov.corners = ov.layer.getCorners().map(c => ({ lat: c.lat, lng: c.lng }));
}

// DistortableImage-Layer für einen Overlay-Eintrag (neu) erzeugen – initial gesperrt.
function _createOverlayLayer(ov) {
  if (ov.layer) { map.removeLayer(ov.layer); ov.layer = null; }
  if (!ov.visible) return;
  const corners = ov.corners.map(c => L.latLng(c.lat, c.lng));
  // editable:false — sonst aktiviert die Lib beim Bild-Load intern automatisch ihr
  // eigenes editing.dragging (unabhängig von unserem lock()-Aufruf), wodurch sich
  // frisch geladene/erzeugte Pläne trotz geschlossenem Overlay-Panel verschieben ließen.
  ov.layer = L.distortableImageOverlay(ov.url, { corners, opacity: ov.opacity, editable: false }).addTo(map);
  ov.layer.on('update', () => { _syncOverlayCorners(ov); repositionOverlayEdgeHandles(); });
  const lock = () => _lockLayer(ov.layer);
  ov.layer.on('load', lock);
  lock();
}

// Genau einen Plan zum Bearbeiten aktivieren; alle anderen sperren.
export function setActiveOverlay(id) {
  const prev = _activeOverlay();
  if (prev && prev.id !== id && prev.layer) { window.overlayLayer = prev.layer; setOverlayLocked(true); }
  window._activeOverlayId = id;
  const act = _overlayById(id);
  window.overlayLayer = act && act.layer ? act.layer : null;
  (window.overlays || []).forEach(ov => { if (ov !== act && ov.layer) _lockLayer(ov.layer); });
  const panelOpen = document.getElementById('overlay-panel')?.classList.contains('visible');
  if (act && act.layer && act.visible && panelOpen && !window._ovRef) setOverlayLocked(false);
  _renderOverlays();
}

export function toggleOverlayVisible(id) {
  const ov = _overlayById(id); if (!ov) return;
  ov.visible = !ov.visible;
  if (ov.visible) {
    _createOverlayLayer(ov);
    if (ov.id === window._activeOverlayId) setActiveOverlay(ov.id);
  } else {
    if (ov.id === window._activeOverlayId) { removeOverlayEdgeHandles(); window.overlayLayer = null; }
    _syncOverlayCorners(ov);   // Ausrichtung sichern, bevor der Layer verschwindet
    if (ov.layer) { map.removeLayer(ov.layer); ov.layer = null; }
  }
  _renderOverlays();
}

export function changeOverlayItemOpacity(id, val) {
  const ov = _overlayById(id); if (!ov) return;
  ov.opacity = parseFloat(val);
  if (ov.layer) ov.layer.setOpacity(ov.opacity);
}

export function renameOverlay(id, name) { const ov = _overlayById(id); if (ov) ov.name = name; }

export function removeOverlayItem(id) {
  const idx = (window.overlays || []).findIndex(o => o.id === id);
  if (idx < 0) return;
  const ov = window.overlays[idx];
  if (ov.id === window._activeOverlayId) {
    if (window._ovRef) _ovRefCancel();
    removeOverlayEdgeHandles();
    window.overlayLayer = null; window._activeOverlayId = null;
  }
  if (ov.layer) map.removeLayer(ov.layer);
  window.overlays.splice(idx, 1);
  _renderOverlays();
}

export function clearAllOverlays() {
  if (window._ovRef) _ovRefCancel();
  removeOverlayEdgeHandles();
  (window.overlays || []).forEach(ov => { if (ov.layer) map.removeLayer(ov.layer); });
  window.overlays = [];
  window.overlayLayer = null;
  window._activeOverlayId = null;
  _renderOverlays();
  const fileInput = document.getElementById('overlay-file');
  if (fileInput) fileInput.value = '';
}

// Alle Pläne fürs Projekt-Speichern serialisieren (Corners live aus dem Layer lesen).
export function serializeOverlays() {
  return (window.overlays || []).map(ov => {
    const cs = (ov.layer ? ov.layer.getCorners() : ov.corners).map(c => ({ lat: c.lat, lng: c.lng }));
    return { name: ov.name, url: ov.url, w: ov.w, h: ov.h, corners: cs, opacity: ov.opacity, visible: ov.visible };
  });
}

// Pläne aus einem geladenen Projekt wiederherstellen.
export function loadOverlays(arr) {
  clearAllOverlays();
  if (!window._overlayCounter) window._overlayCounter = 1;
  (arr || []).forEach(o => {
    if (!o || !o.url || !Array.isArray(o.corners) || o.corners.length !== 4) return;
    const ov = {
      id: window._overlayCounter++, name: o.name || 'Plan', url: o.url, w: o.w, h: o.h,
      corners: o.corners, opacity: o.opacity ?? 0.5, visible: o.visible !== false, layer: null,
    };
    window.overlays.push(ov);
    _createOverlayLayer(ov);
  });
  _renderOverlays();
}

// Lade-Anzeige: Platzhalter, solange eine Datei (v.a. PDF) noch verarbeitet wird.
function _addOverlayPending(name) {
  if (!window._overlayPending) window._overlayPending = [];
  if (!window._overlayPendCounter) window._overlayPendCounter = 1;
  const id = window._overlayPendCounter++;
  window._overlayPending.push({ id, name });
  _renderOverlays();
  return id;
}
function _removeOverlayPending(id) {
  if (!window._overlayPending) return;
  window._overlayPending = window._overlayPending.filter(p => p.id !== id);
  _renderOverlays();
}

// Plan-Liste im Overlay-Panel rendern.
function _renderOverlays() {
  const box = document.getElementById('overlay-list');
  if (!box) return;
  const list = window.overlays || [];
  const pending = window._overlayPending || [];
  const pendHtml = pending.map(p => `<div style="display:flex;align-items:center;gap:8px;border:1px dashed rgba(206,147,216,0.5);border-radius:7px;padding:8px;margin-bottom:6px;background:rgba(206,147,216,0.06);">
      <span style="display:inline-block;width:12px;height:12px;border:2px solid #ce93d8;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;flex:0 0 auto;"></span>
      <span style="font-size:12px;color:#ce93d8;">${(p.name || 'Plan').replace(/</g, '&lt;')} — wird geladen…</span>
    </div>`).join('');
  if (!list.length && !pending.length) {
    box.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 2px;">Noch keine Pläne geladen.</div>';
    return;
  }
  box.innerHTML = pendHtml + list.map(ov => {
    const isActive = ov.id === window._activeOverlayId;
    const eye = ov.visible ? '👁' : '🚫';
    const safeName = (ov.name || '').replace(/"/g, '&quot;');
    return `<div style="border:1px solid ${isActive ? '#ce93d8' : 'rgba(255,255,255,0.12)'};border-radius:7px;padding:7px 8px;margin-bottom:6px;background:rgba(255,255,255,0.03);">
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="btn-xs" title="Ein-/Ausblenden" data-click="toggleOverlayVisible(${ov.id})" style="flex:0 0 auto;opacity:${ov.visible ? 1 : 0.5};">${eye}</button>
        <input type="text" value="${safeName}" data-change="renameOverlay(${ov.id}, this.value)" style="flex:1;min-width:0;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.15);color:var(--fg);font-size:12px;padding:2px 0;"/>
        <button class="btn-xs" title="Plan löschen" data-click="removeOverlayItem(${ov.id})" style="flex:0 0 auto;color:#e57373;">🗑</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:5px;">
        <button class="btn-xs" data-click="setActiveOverlay(${ov.id})" style="flex:0 0 auto;${isActive ? 'border-color:#ce93d8;color:#ce93d8;' : ''}" ${ov.visible ? '' : 'disabled'}>${isActive ? '✏️ aktiv' : 'Bearbeiten'}</button>
        <input type="range" min="0.1" max="1" step="0.05" value="${ov.opacity}" data-input="changeOverlayItemOpacity(${ov.id}, this.value)" style="flex:1;" title="Deckkraft"/>
      </div>
    </div>`;
  }).join('');
}

// Plan-Overlay fixieren (locked=true) oder wieder editierbar machen (locked=false).
// Fixiert: keine Editier-/Kantengriffe, Bild klick-transparent → Karte bleibt bedienbar.
export function setOverlayLocked(locked) {
  const layer = window.overlayLayer;
  if (!layer) return;
  window._overlayLocked = !!locked;
  const imgEl = layer.getElement && layer.getElement();
  if (locked) {
    removeOverlayEdgeHandles();
    try { layer.editing.disable(); } catch (e) {}
    try { layer.editing.dragging.disable(); } catch (e) {}
    if (imgEl) imgEl.style.pointerEvents = 'none';
  } else {
    try { layer.editing.enable(); } catch (e) {}
    try { layer.editing.dragging.enable(); } catch (e) {}
    createOverlayEdgeHandles();
    if (imgEl) imgEl.style.pointerEvents = '';
  }
}

export function clearOverlay() { clearAllOverlays(); }   // alle Pläne entfernen

// ── Plan über Referenzpunkte (Passpunkte) ausrichten ─────────────────────────
// Der Nutzer klickt paarweise: erst ein Merkmal auf dem PLAN, dann dieselbe
// Stelle auf der KARTE. Aus 2 Paaren wird eine Ähnlichkeits- (drehen + gleichmäßig
// skalieren), aus 3+ Paaren eine Affintransformation berechnet und auf die 4
// Eckpunkte des Overlays angewandt. Gerechnet wird im projizierten CRS-Raum
// (Web-Mercator), damit Drehung/Skalierung metrisch stimmen.

function _ovProj(latlng) { const p = map.options.crs.project(latlng); return { x: p.x, y: p.y }; }
function _ovUnproj(pt)   { return map.options.crs.unproject(L.point(pt.x, pt.y)); }

function _ovSolveN(A, b) {
  // Gauß-Elimination mit Teilpivotisierung für ein n×n-System; null bei (nahezu)
  // singulärer Matrix.
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((r, i) => r[n] / r[i]);   // nach voller Gauß-Jordan-Elimination: Pivot von Zeile i steht an Spalte i
}

function _ovMul3(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}

function _ovInv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-15) return null;
  const id = 1 / det;
  return [
    [(e * i - f * h) * id, (c * h - b * i) * id, (b * f - c * e) * id],
    [(f * g - d * i) * id, (a * i - c * g) * id, (c * d - a * f) * id],
    [(d * h - e * g) * id, (b * g - a * h) * id, (a * e - b * d) * id],
  ];
}

// Hartley-Normalisierung: verschiebt in den Schwerpunkt und skaliert auf mittleren
// Abstand √2 → konditioniert die (sonst mit Mercator-Metern schlecht gestellten)
// Homographie-Normalgleichungen. Gibt T (Original→normalisiert) und norm. Punkte.
function _ovNormalize(pts) {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - cx, p.y - cy);
  d /= n;
  const s = d > 1e-9 ? Math.SQRT2 / d : 1;
  return {
    T: [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]],
    pts: pts.map(p => ({ x: (p.x - cx) * s, y: (p.y - cy) * s })),
  };
}

function _ovFitSimilarity(src, dst) {
  // X = a·x − b·y + tx ; Y = b·x + a·y + ty  (Rotation + gleichmäßige Skalierung)
  const n = src.length;
  let mx = 0, my = 0, Mx = 0, My = 0;
  for (let i = 0; i < n; i++) { mx += src[i].x; my += src[i].y; Mx += dst[i].x; My += dst[i].y; }
  mx /= n; my /= n; Mx /= n; My /= n;
  let aNum = 0, bNum = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i].x - mx, y = src[i].y - my, X = dst[i].x - Mx, Y = dst[i].y - My;
    aNum += x * X + y * Y;
    bNum += x * Y - y * X;
    den  += x * x + y * y;
  }
  if (den < 1e-6) return null;                 // Quellpunkte fallen zusammen
  const a = aNum / den, b = bNum / den;
  const tx = Mx - (a * mx - b * my);
  const ty = My - (b * mx + a * my);
  return p => ({ x: a * p.x - b * p.y + tx, y: b * p.x + a * p.y + ty });
}

function _ovFitAffine(src, dst) {
  // X = a·x + b·y + c ; Y = d·x + e·y + f  (Least-Squares über Normalgleichungen)
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0; const n = src.length;
  const bX = [0, 0, 0], bY = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = src[i].x, y = src[i].y, X = dst[i].x, Y = dst[i].y;
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y;
    bX[0] += x * X; bX[1] += y * X; bX[2] += X;
    bY[0] += x * Y; bY[1] += y * Y; bY[2] += Y;
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const cx = _ovSolveN(A, bX), cy = _ovSolveN(A, bY);
  if (!cx || !cy) return null;                 // kollineare Punkte
  return p => ({ x: cx[0] * p.x + cx[1] * p.y + cx[2], y: cy[0] * p.x + cy[1] * p.y + cy[2] });
}

function _ovFitHomography(src, dst) {
  // Projektive Transformation (Perspektiv-Entzerrung). Normalisierter DLT mit
  // fixiertem h₈=1 → 8×8-Least-Squares. H = Tdst⁻¹ · Hₙ · Tsrc.
  const N = src.length;
  const ns = _ovNormalize(src), nd = _ovNormalize(dst);
  const S = ns.pts, D = nd.pts;
  const A = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const bb = new Array(8).fill(0);
  const addRow = (row, rhs) => {
    for (let i = 0; i < 8; i++) {
      bb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) A[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < N; k++) {
    const x = S[k].x, y = S[k].y, X = D[k].x, Y = D[k].y;
    addRow([x, y, 1, 0, 0, 0, -x * X, -y * X], X);
    addRow([0, 0, 0, x, y, 1, -x * Y, -y * Y], Y);
  }
  const h = _ovSolveN(A, bb);
  if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const TdstInv = _ovInv3(nd.T);
  if (!TdstInv) return null;
  const H = _ovMul3(_ovMul3(TdstInv, Hn), ns.T);
  return p => {
    const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
    if (Math.abs(w) < 1e-12) return null;
    return {
      x: (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w,
      y: (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w,
    };
  };
}

// Passendes Verfahren nach Punktzahl wählen und Transformation liefern.
function _ovFitFor(pairs) {
  const src = pairs.map(p => _ovProj(p.src));
  const dst = pairs.map(p => _ovProj(p.dst));
  if (pairs.length >= 4) return { T: _ovFitHomography(src, dst), method: 'Projektiv (Perspektive)' };
  if (pairs.length >= 3) return { T: _ovFitAffine(src, dst), method: 'Affin (Skalierung x/y + Scherung)' };
  return { T: _ovFitSimilarity(src, dst), method: 'Ähnlichkeit (drehen + skalieren)' };
}

// Restfehler je Passpunkt in echten Metern (Ellipsoid-Abstand über map.distance).
function _ovResiduals(pairs, T) {
  return pairs.map(p => {
    const m = T(_ovProj(p.src));
    return m ? map.distance(_ovUnproj(m), p.dst) : Infinity;
  });
}

export function startOverlayReference() {
  if (!window.overlayLayer) { showHint('Bitte zuerst einen Plan laden bzw. in der Liste „Bearbeiten" wählen, bevor du ihn über Referenzpunkte ausrichtest.'); return; }
  if (window._ovRef) return;                   // läuft bereits

  // Editier-Griffe & Kantengriffe entfernen und Bild klick-transparent machen,
  // damit die Karten-Klicks durchkommen.
  try { window.overlayLayer.editing.disable(); } catch (e) {}
  removeOverlayEdgeHandles();
  const imgEl = window.overlayLayer.getElement && window.overlayLayer.getElement();
  if (imgEl) imgEl.style.pointerEvents = 'none';

  window._ovRef = { pairs: [], expecting: 'plan', tempSrc: null, tempMarker: null, markers: [], lines: [] };
  document.getElementById('overlay-panel')?.classList.remove('visible');
  map.on('click', _ovRefClick);
  _ovRefBuildControl();
  _ovRefUpdate();
}

function _ovRefMarker(latlng, label, kind) {
  const isPlan = kind === 'plan';
  const bg = isPlan ? '#ce93d8' : '#4dd0e1';
  const html = `<div style="width:22px;height:22px;border-radius:50%;background:${bg};border:2px solid #0a0e1a;`
    + `display:flex;align-items:center;justify-content:center;font:700 11px/1 'DM Sans',sans-serif;color:#0a0e1a;`
    + `box-shadow:0 1px 4px rgba(0,0,0,.5);">${label}</div>`;
  return L.marker(latlng, {
    icon: L.divIcon({ className: 'ov-ref-marker', html, iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, zIndexOffset: 3200,
  }).addTo(map);
}

function _ovRefClick(e) {
  const ref = window._ovRef;
  if (!ref) return;
  const n = ref.pairs.length + 1;
  if (ref.expecting === 'plan') {
    ref.tempSrc = e.latlng;
    ref.tempMarker = _ovRefMarker(e.latlng, n, 'plan');
    ref.expecting = 'map';
  } else {
    const srcLL = ref.tempSrc;
    const dstMarker = _ovRefMarker(e.latlng, n, 'map');
    const line = L.polyline([srcLL, e.latlng], {
      color: '#ce93d8', weight: 1.5, dashArray: '4 4', interactive: false,
    }).addTo(map);
    ref.pairs.push({ src: srcLL, dst: e.latlng });
    ref.markers.push(ref.tempMarker, dstMarker);
    ref.lines.push(line);
    ref.tempSrc = null; ref.tempMarker = null;
    ref.expecting = 'plan';
  }
  _ovRefUpdate();
}

export function _ovRefUndo() {
  const ref = window._ovRef;
  if (!ref) return;
  if (ref.expecting === 'map' && ref.tempMarker) {          // offenen Plan-Punkt zurücknehmen
    map.removeLayer(ref.tempMarker);
    ref.tempMarker = null; ref.tempSrc = null;
    ref.expecting = 'plan';
  } else if (ref.pairs.length) {                            // letztes vollständiges Paar zurücknehmen
    ref.pairs.pop();
    const dst = ref.markers.pop(); const src = ref.markers.pop();
    if (dst) map.removeLayer(dst);
    if (src) map.removeLayer(src);
    const ln = ref.lines.pop(); if (ln) map.removeLayer(ln);
  }
  _ovRefUpdate();
}

export function _ovRefApply() {
  const ref = window._ovRef;
  if (!ref || ref.pairs.length < 2) { showHint('Mindestens 2 Referenzpunkt-Paare nötig.'); return; }
  const { T, method } = _ovFitFor(ref.pairs);
  if (!T) { showHint('Punkte liegen zu dicht beieinander oder auf einer Linie — bitte weiter auseinander oder versetzt wählen.'); return; }
  const newCorners = window.overlayLayer.getCorners().map(c => _ovUnproj(T(_ovProj(c))));
  if (newCorners.some(c => !c || !isFinite(c.lat) || !isFinite(c.lng))) {
    showHint('Ausrichtung fehlgeschlagen — die Passpunkte ergeben keine gültige Transformation. Bitte Punkte prüfen.');
    return;
  }
  const res = _ovResiduals(ref.pairs, T);
  const maxR = Math.max(...res), meanR = res.reduce((a, b) => a + b, 0) / res.length;
  const n = ref.pairs.length;
  _ovRefTeardown();
  window.overlayLayer.setCorners(newCorners);
  setOverlayLocked(true);            // ausgerichtet → Plan sofort fixiert
  showHint(`Plan über ${n} Referenzpunkte ausgerichtet (${method}). `
    + `Passgenauigkeit: Ø ${meanR.toFixed(1)} m, max ${maxR.toFixed(1)} m. `
    + `Der Plan ist jetzt fixiert – zum Nachjustieren das Plan-Overlay-Panel erneut öffnen.`);
}

export function _ovRefCancel() {
  _ovRefTeardown();
  toggleOverlayPanel();              // zurück ins (editierbare) Overlay-Panel – entsperrt den Plan
  hideHint();
}

function _ovRefTeardown() {
  const ref = window._ovRef;
  if (!ref) return;
  map.off('click', _ovRefClick);
  ref.markers.forEach(m => map.removeLayer(m));
  ref.lines.forEach(l => map.removeLayer(l));
  if (ref.tempMarker) map.removeLayer(ref.tempMarker);
  document.getElementById('ov-ref-control')?.remove();
  window._ovRef = null;
}

function _ovRefBuildControl() {
  document.getElementById('ov-ref-control')?.remove();
  const box = document.createElement('div');
  box.id = 'ov-ref-control';
  box.style.cssText = 'position:absolute;top:70px;left:50%;transform:translateX(-50%);z-index:3300;'
    + 'background:rgba(16,20,34,.96);border:1.5px solid #ce93d8;border-radius:9px;padding:12px 14px;'
    + "min-width:300px;max-width:360px;font-family:'DM Sans',sans-serif;color:#e6e9f0;box-shadow:0 6px 24px rgba(0,0,0,.5);";
  box.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:#ce93d8;margin-bottom:6px;">🎯 Plan über Referenzpunkte ausrichten</div>
    <div id="ov-ref-hint" style="font-size:11px;line-height:1.45;color:#b9c0d4;margin-bottom:8px;"></div>
    <div id="ov-ref-status" style="font-size:11px;margin-bottom:10px;"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button id="ov-ref-apply" class="btn-secondary" style="flex:1;min-width:120px;">Ausrichten</button>
      <button id="ov-ref-undo"  class="btn-secondary" style="flex:0 0 auto;">↶ Zurück</button>
      <button id="ov-ref-cancel" class="btn-secondary" style="flex:0 0 auto;">Abbrechen</button>
    </div>`;
  (map.getContainer() || document.body).appendChild(box);
  box.querySelector('#ov-ref-apply').addEventListener('click', _ovRefApply);
  box.querySelector('#ov-ref-undo').addEventListener('click', _ovRefUndo);
  box.querySelector('#ov-ref-cancel').addEventListener('click', _ovRefCancel);
}

function _ovRefUpdate() {
  const ref = window._ovRef;
  if (!ref) return;
  const n = ref.pairs.length;
  const hintEl = document.getElementById('ov-ref-hint');
  const statEl = document.getElementById('ov-ref-status');
  const applyBtn = document.getElementById('ov-ref-apply');
  if (hintEl) {
    const tip = n === 1 ? ' — je weiter auseinander, desto genauer.'
      : n >= 3 ? ' — weitere Punkte erhöhen die Genauigkeit (überbestimmter Fit).' : '';
    hintEl.innerHTML = ref.expecting === 'plan'
      ? `Klicke Merkmal <b>Nr. ${n + 1} auf dem PLAN</b> (z.B. eine Gebäude-/Hallenecke).${tip}`
      : `Jetzt dieselbe Stelle <b>Nr. ${n + 1} auf der KARTE</b> anklicken.`;
  }
  if (statEl) {
    let html = `<span style="color:#4dd0e1;">${n}</span> vollständige${n === 1 ? 's' : ''} Punktepaar${n === 1 ? '' : 'e'}`;
    if (n >= 2) {
      const { T, method } = _ovFitFor(ref.pairs);
      html += ` · Verfahren: <b>${method}</b>`;
      if (T) {
        const res = _ovResiduals(ref.pairs, T);
        const maxR = Math.max(...res), meanR = res.reduce((a, b) => a + b, 0) / res.length;
        const worst = res.indexOf(maxR) + 1;
        // Bei minimaler Punktzahl (exakter Fit) sind Residuen ~0 → als Kontrolle markieren.
        const exact = (n === 2) || (n === 3) || (n === 4);
        const col = maxR > 3 ? '#ef9a9a' : '#a5d6a7';
        html += `<br><span style="color:#8891a8;">Passgenauigkeit (Vorschau):</span> `
          + `<span style="color:${col};">Ø ${meanR.toFixed(1)} m, max ${maxR.toFixed(1)} m`
          + `${maxR > 0.05 ? ` (Punkt ${worst})` : ''}</span>`
          + `${exact ? ' <span style="color:#8891a8;">— exakt bestimmt</span>' : ''}`;
      } else {
        html += `<br><span style="color:#ef9a9a;">Punkte kollinear/zu dicht — bitte versetzt wählen.</span>`;
      }
    } else {
      html += ' · min. 2 nötig';
    }
    statEl.innerHTML = html;
  }
  if (applyBtn) {
    applyBtn.disabled = n < 2;
    applyBtn.style.opacity = n < 2 ? '.45' : '1';
    applyBtn.style.cursor = n < 2 ? 'not-allowed' : 'pointer';
    applyBtn.textContent = n < 2 ? 'Ausrichten' : `Ausrichten (${n} Punkte)`;
  }
}

export function pointInPolygon(pt, poly) {
  let x = pt.lng, y = pt.lat;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    let xi = poly[i].lng, yi = poly[i].lat;
    let xj = poly[j].lng, yj = poly[j].lat;
    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Overpass-API — alle Server parallel anfragen, schnellste Antwort gewinnt
// ── WFS Gebäude-Import (amtliche Katasterdaten) ─────────────────────────────
// 13 von 16 Bundesländern haben kostenlose WFS-Dienste für Gebäudegrundrisse.
// Nur Bayern ist gesperrt → dort Overpass-Fallback.
var WFS_CONFIG = {
  // {id: {url, layer, srsName (optional, default EPSG:4326)}}
  nw: { url: 'https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht', layer: 'ave:GebaeudeBauwerk' },
  ni: { url: 'https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_einfach', layer: 'ave:GebaeudeBauwerk' },
  he: { url: 'https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/vereinf/wfs', layer: 'ave:GebaeudeBauwerk' },
  bw: { url: 'https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_LGL-BW_ALKIS', layer: 'nora:v_al_gebaeude' },
  be: { url: 'https://gdi.berlin.de/services/wfs/alkis_gebaeude', layer: 'alkis_gebaeude:gebaeude' },
  bb: { url: 'https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs', layer: 'ave:GebaeudeBauwerk' },
  sh: { url: 'https://service.gdi-sh.de/WFS_SH_ALKIS_vereinf_OpenGBD', layer: 'ave:GebaeudeBauwerk' },
  th: { url: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs', layer: 'ave:GebaeudeBauwerk' },
  sn: { url: 'https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs', layer: 'ave:GebaeudeBauwerk' },
  rp: { url: 'https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi', layer: 'ave:GebaeudeBauwerk' },
  mv: { url: 'https://www.geodaten-mv.de/dienste/alkis_wfs_einfach', layer: 'ave:GebaeudeBauwerk' },
  hh: { url: 'https://geodienste.hamburg.de/HH_WFS_INSPIRE_Gebaeude_2D_ALKIS', layer: 'bu-core2d:Building' },
  hb: { url: 'https://geodienste.bremen.de/wfs_alkis_hausumringe', layer: 'app:hausumringe' },
  st: { url: 'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_ALKIS_WFS_OpenData/guest', layer: 'ave:GebaeudeBauwerk' },
  sl: { url: 'https://geoportal.saarland.de/registry/wfs/414', layer: 'ALKIS_ALKIS_WFS_ohne_Eig:GebaeudeBauwerk' },
  // Bayern: kein freier WFS → null = Overpass-Fallback
  by: null
};

// Grobe Bounding-Boxes der Bundesländer [südlat, westlon, nordlat, ostlon]
// Bei Überlappung wird das erste Match verwendet; Sortierung: kleinere Stadtstaaten zuerst
var BUNDESLAND_BBOX = [
  { id: 'hb', bbox: [53.01, 8.48, 53.60, 8.99] },
  { id: 'hh', bbox: [53.39, 9.73, 53.74, 10.33] },
  { id: 'be', bbox: [52.33, 13.08, 52.68, 13.77] },
  { id: 'sl', bbox: [49.11, 6.35, 49.64, 7.41] },
  { id: 'sh', bbox: [53.35, 7.87, 55.06, 11.35] },
  { id: 'mv', bbox: [53.11, 10.59, 54.69, 14.41] },
  { id: 'ni', bbox: [51.29, 6.65, 53.89, 11.60] },
  { id: 'bb', bbox: [51.36, 11.26, 53.56, 14.77] },
  { id: 'st', bbox: [50.94, 10.56, 53.04, 13.19] },
  { id: 'nw', bbox: [50.32, 5.87, 52.53, 9.46] },
  { id: 'he', bbox: [49.39, 7.77, 51.66, 10.24] },
  { id: 'th', bbox: [50.20, 9.87, 51.65, 12.66] },
  { id: 'sn', bbox: [50.17, 11.87, 51.69, 15.04] },
  { id: 'rp', bbox: [48.97, 6.11, 50.94, 8.51] },
  { id: 'bw', bbox: [47.53, 7.51, 49.79, 10.50] },
  { id: 'by', bbox: [47.27, 8.98, 50.56, 13.84] },
];

export function _detectBundesland(lat, lon) {
  for (var i = 0; i < BUNDESLAND_BBOX.length; i++) {
    var b = BUNDESLAND_BBOX[i].bbox;
    if (lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]) {
      return BUNDESLAND_BBOX[i].id;
    }
  }
  return null;
}

function _wfsBuildUrl(cfg, bbox4326) {
  // bbox: [south, west, north, east] in EPSG:4326
  var params = [
    'service=WFS',
    'version=2.0.0',
    'request=GetFeature',
    'typeNames=' + encodeURIComponent(cfg.layer),
    'bbox=' + bbox4326.join(',') + ',EPSG:4326',
    'srsName=EPSG:4326',
    'count=10000'
  ];
  return cfg.url + '?' + params.join('&');
}

export function _wfsFetchBuildings(bbox4326) {
  var center = [(bbox4326[0] + bbox4326[2]) / 2, (bbox4326[1] + bbox4326[3]) / 2];
  var blId = _detectBundesland(center[0], center[1]);
  if (!blId || !WFS_CONFIG[blId]) return Promise.resolve(null); // Bayern oder Ausland

  var cfg = WFS_CONFIG[blId];
  var blName = blId.toUpperCase();
  showHint('⏳ Lade Gebäude vom Katasteramt (' + blName + ')…');

  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, 25000);
  var startTime = Date.now();

  // Sekundenzähler
  var ticker = setInterval(function() {
    var elapsed = Math.round((Date.now() - startTime) / 1000);
    showHint('⏳ Lade Gebäude vom Katasteramt (' + blName + ', ' + elapsed + 's)…');
  }, 1000);

  var url = _wfsBuildUrl(cfg, bbox4326);
  return fetch(url, { signal: ctrl.signal })
    .then(function(resp) {
      clearTimeout(timer); clearInterval(ticker);
      if (!resp.ok) throw new Error('WFS HTTP ' + resp.status);
      return resp.text();
    })
    .then(function(txt) {
      clearTimeout(timer); clearInterval(ticker);
      var geojson;
      // Manche Server liefern GeoJSON, die meisten GML
      if (txt.trim().startsWith('{')) {
        geojson = JSON.parse(txt);
      } else {
        geojson = _parseWfsGml(txt);
      }
      if (!geojson || !geojson.features || geojson.features.length === 0) return null;
      showHint('✓ ' + geojson.features.length + ' Gebäude vom Katasteramt (' + blName + ')');
      return geojson;
    })
    .catch(function(err) {
      clearTimeout(timer); clearInterval(ticker);
      console.warn('WFS-Fehler (' + blName + '):', err.message);
      return null; // Fallback auf Overpass
    });
}

function _parseWfsGml(xml) {
  // GML-Parser für ALKIS-vereinfacht WFS-Antworten
  var features = [];
  var parser = new DOMParser();
  var doc = parser.parseFromString(xml, 'text/xml');
  var members = doc.querySelectorAll('member, featureMember');
  members.forEach(function(member) {
    var posLists = member.querySelectorAll('posList');
    if (posLists.length === 0) return;

    // Alle Ringe des Gebäudes sammeln (MultiSurface)
    var rings = [];
    posLists.forEach(function(pl) {
      var text = pl.textContent.trim();
      var nums = text.split(/\s+/).map(Number);
      var ring = [];
      // EPSG:4326 axis order: lat lon lat lon ...
      for (var i = 0; i + 1 < nums.length; i += 2) {
        ring.push([nums[i + 1], nums[i]]); // [lon, lat] für GeoJSON
      }
      if (ring.length >= 3) rings.push(ring);
    });
    if (rings.length === 0) return;

    // Properties auslesen
    var props = {};
    var _txt = function(tag) {
      var el = member.querySelector(tag);
      return el ? el.textContent.trim() : '';
    };
    props.funktion = _txt('funktion');
    props.gebnutzbez = _txt('gebnutzbez');
    props.lagebeztxt = _txt('lagebeztxt');
    props.gfkzshh = _txt('gfkzshh');
    props.aktualit = _txt('aktualit');

    // GFK-Code aus gfkzshh extrahieren (Format: "31001_1000" → 1000)
    var gfkMatch = (props.gfkzshh || '').match(/_(\d+)/);
    if (gfkMatch) props.gebaeudefunktion = gfkMatch[1];

    features.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'Polygon', coordinates: [rings[0]] }
    });
    // Bei MultiSurface: weitere Ringe als separate Features
    for (var r = 1; r < rings.length; r++) {
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'Polygon', coordinates: [rings[r]] }
      });
    }
  });
  return { type: 'FeatureCollection', features: features };
}

export function parseWfsGeoJson(geojson, snapArea) {
  // Konvertiert WFS-GeoJSON in das gleiche Format wie parseOsmData
  var existingPolygons = new Set(gebaeude.filter(function(g) { return g.polygon; }).map(function(g) {
    // Einfacher Fingerprint: Schwerpunkt gerundet
    var c = g.polygon.reduce(function(s, p) { return { lat: s.lat + p.lat, lng: s.lng + p.lng }; }, { lat: 0, lng: 0 });
    return Math.round(c.lat / g.polygon.length * 1e5) + '_' + Math.round(c.lng / g.polygon.length * 1e5);
  }));

  var defaultBj = parseInt(document.getElementById('osm-default-baujahr')?.value) || 1970;
  var result = [];

  geojson.features.forEach(function(feat) {
    var geom = feat.geometry;
    if (!geom) return;
    // Polygon oder MultiPolygon
    var rings = [];
    if (geom.type === 'Polygon') {
      rings = [geom.coordinates[0]]; // Äußerer Ring
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(function(poly) { rings.push(poly[0]); });
    } else return;

    rings.forEach(function(ring) {
      if (!ring || ring.length < 3) return;
      // GeoJSON: [lon, lat] → Leaflet: {lat, lng}
      var coords = ring.map(function(c) { return { lat: c[1], lng: c[0] }; });

      // Fläche prüfen: zu kleine Polygone (<10 m²) überspringen (Garagen etc.)
      var area = polygonAreaM2(coords);
      if (area < 10) return;

      // Deduplizierung
      var sumLat = 0, sumLng = 0;
      coords.forEach(function(c) { sumLat += c.lat; sumLng += c.lng; });
      var fp = Math.round(sumLat / coords.length * 1e5) + '_' + Math.round(sumLng / coords.length * 1e5);
      if (existingPolygons.has(fp)) return;
      existingPolygons.add(fp);

      // Gebiet-Filter
      if (snapArea && snapArea.length >= 3) {
        var center = { lat: sumLat / coords.length, lng: sumLng / coords.length };
        if (!pointInPolygon(center, snapArea)) return;
      }

      // Gebäudefunktion aus WFS-Properties auslesen (ALKIS-Schlüssel)
      var props = feat.properties || {};
      var nutzung = _wfsNutzung(props);
      var stockwerke = parseInt(props.anzahlDerOberirdischenGeschosse || props.geschosszahl || props.stockwerke) || 1;

      result.push({
        coords: coords,
        name: props.name || props.lagebezeichnung || null,
        fromOsm: false,
        fromWfs: true,
        osmId: null,
        stockwerke: stockwerke,
        baujahr: parseInt(props.baujahr) || defaultBj,
        nutzung: nutzung
      });
    });
  });

  return result;
}

function _wfsNutzung(props) {
  // ALKIS Gebäudefunktion → Nutzungstyp
  // Schlüssel: GFK (Gebäudefunktion) vierstellig, z.B. 1000=Wohngebäude
  var gfk = parseInt(props.gebaeudefunktion || props.GFK || props.gebaeudeFunktion || '') || 0;
  var text = (props.funktion || props.gebaeudefunktionText || props.funktion_text || props.nutzung || '').toLowerCase();

  // GFK-Hauptgruppen (AdV ALKIS-Katalog)
  if (gfk >= 1000 && gfk < 1100) return 'efh'; // Wohngebäude (1000-1099)
  if (gfk >= 1100 && gfk < 1200) return 'mfh'; // Wohngebäude mit Mehrfachnutzung
  if (gfk >= 2000 && gfk < 2100) return 'buero'; // Bürogebäude
  if (gfk >= 2100 && gfk < 2200) return 'ghd';   // Handelsgebäude
  if (gfk >= 2200 && gfk < 2300) return 'ghd';   // Gebäude für Gewerbe/Industrie (klein)
  if (gfk >= 2300 && gfk < 2400) return 'industrie'; // Industriegebäude
  if (gfk >= 2400 && gfk < 2500) return 'ghd';   // Verkehrsgebäude
  if (gfk >= 2500 && gfk < 2600) return 'ghd';   // Gebäude für Versorgung
  if (gfk >= 3000 && gfk < 3100) return 'schule'; // Bildungsgebäude
  if (gfk >= 3100 && gfk < 3200) return 'oeffentlich'; // Krankenhaus/Gesundheit
  if (gfk >= 3200 && gfk < 3300) return 'oeffentlich'; // Kultur
  if (gfk >= 3400 && gfk < 3500) return 'oeffentlich'; // Kirche/Religion
  if (gfk >= 3500 && gfk < 3600) return 'oeffentlich'; // Sicherheit/Ordnung

  // Text-Fallback
  if (text.includes('wohn')) return text.includes('mehr') ? 'mfh' : 'efh';
  if (text.includes('schule') || text.includes('kinder')) return 'schule';
  if (text.includes('büro') || text.includes('verwalt')) return 'buero';
  if (text.includes('industrie') || text.includes('fabrik')) return 'industrie';
  if (text.includes('kirche') || text.includes('rathaus') || text.includes('kranken')) return 'oeffentlich';
  if (text.includes('handel') || text.includes('laden') || text.includes('gewerbe')) return 'ghd';
  return '';
}

// ── Baujahr-Anreicherung aus externen Quellen ───────────────────────────────
// Hamburg: OGC API Features mit Baualtersklasse pro Zone (ALKIS + Zensus 2022)
// NRW: Energieatlas WMS mit spez. Wärmebedarf pro Baublock → Baujahresklasse

// Baualtersklassen-String → mittleres Baujahr
function _parseHHBaualtersklasse(str) {
  if (!str) return null;
  // Format: "81.82% 1860-1918" → extrahiere Jahreszahlen
  var m = str.match(/(\d{4})\s*-\s*(\d{4})/);
  if (m) return Math.round((parseInt(m[1]) + parseInt(m[2])) / 2);
  if (str.indexOf('vor 1860') >= 0) return 1850;
  if (str.indexOf('nger als 2016') >= 0 || str.indexOf('nach 2015') >= 0) return 2018;
  // Einzeljahr
  var singleY = str.match(/(\d{4})/);
  if (singleY) return parseInt(singleY[1]);
  return null;
}

function _enrichBaujahrHamburg(bbox, buildings) {
  // bbox: [south, west, north, east]
  var url = 'https://api.hamburg.de/datasets/v1/gebaeudestruktur_kwp/collections/gebaeudestruktur/items'
    + '?f=json&limit=200&bbox=' + bbox[1] + ',' + bbox[0] + ',' + bbox[3] + ',' + bbox[2];

  return fetch(url, { signal: AbortSignal.timeout(15000) })
    .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
    .then(function(data) {
      if (!data.features || data.features.length === 0) return 0;

      // Polygone der Zonen vorbereiten (GeoJSON [lon,lat] → {lat,lng})
      var zones = data.features.map(function(f) {
        var props = f.properties || {};
        var bj = _parseHHBaualtersklasse(props.erste_baualtersklasse);
        if (!bj) return null;
        var coords = [];
        if (f.geometry && f.geometry.type === 'Polygon' && f.geometry.coordinates) {
          coords = f.geometry.coordinates[0].map(function(c) { return { lat: c[1], lng: c[0] }; });
        } else if (f.geometry && f.geometry.type === 'MultiPolygon') {
          coords = f.geometry.coordinates[0][0].map(function(c) { return { lat: c[1], lng: c[0] }; });
        }
        if (coords.length < 3) return null;
        return { baujahr: bj, polygon: coords, klasse: props.erste_baualtersklasse };
      }).filter(Boolean);

      if (zones.length === 0) return 0;

      // Für jedes Gebäude ohne echtes Baujahr: in welcher Zone liegt der Schwerpunkt?
      var enriched = 0;
      buildings.forEach(function(b) {
        if (b._hasOsmBj) return; // OSM-Baujahr hat Vorrang
        var cLat = 0, cLng = 0;
        b.coords.forEach(function(c) { cLat += c.lat; cLng += c.lng; });
        cLat /= b.coords.length; cLng /= b.coords.length;
        var pt = { lat: cLat, lng: cLng };

        for (var i = 0; i < zones.length; i++) {
          if (pointInPolygon(pt, zones[i].polygon)) {
            b.baujahr = zones[i].baujahr;
            b.baujährQuelle = 'HH-KWP (' + zones[i].klasse.replace(/^\d+(\.\d+)?%\s*/, '') + ')';
            enriched++;
            return;
          }
        }
      });
      return enriched;
    })
    .catch(function(err) {
      console.warn('Hamburg KWP Baujahr-Abfrage fehlgeschlagen:', err.message);
      return 0;
    });
}

// NRW Energieatlas: spez. Wärmebedarf → Baujahresklasse (Rückschluss über IWU-Typologie)
function _spezWaermeToBarujahr(spezKwh) {
  // Ungefähre Zuordnung: höherer spez. Bedarf = älteres Gebäude
  if (spezKwh > 200) return 1935;    // vor 1948 (unsanierter Altbau)
  if (spezKwh > 160) return 1960;    // 1949-1968
  if (spezKwh > 130) return 1975;    // 1969-1978
  if (spezKwh > 100) return 1988;    // 1979-1994
  if (spezKwh > 70)  return 2002;    // 1995-2009
  if (spezKwh > 40)  return 2014;    // 2010-2020 (EnEV)
  return 2020;                        // GEG/KfW
}

function _enrichBaujahrNRW(bbox, buildings) {
  // Energieatlas WMS GetFeatureInfo für den Mittelpunkt der Bounding Box
  // EPSG:25832 Transformation: vereinfacht über UTM Zone 32
  var centerLat = (bbox[0] + bbox[2]) / 2;
  var centerLng = (bbox[1] + bbox[3]) / 2;

  // Grobe Transformation WGS84 → UTM32N (EPSG:25832)
  var k0 = 0.9996, e = 0.00669438, a = 6378137;
  var lonRad = centerLng * Math.PI / 180, latRad = centerLat * Math.PI / 180;
  var N = a / Math.sqrt(1 - e * Math.sin(latRad) * Math.sin(latRad));
  var T = Math.tan(latRad) * Math.tan(latRad);
  var C = e * Math.cos(latRad) * Math.cos(latRad) / (1 - e);
  var A = Math.cos(latRad) * (lonRad - 9 * Math.PI / 180);
  var M = a * ((1 - e/4 - 3*e*e/64) * latRad - (3*e/8 + 3*e*e/32) * Math.sin(2*latRad) + (15*e*e/256) * Math.sin(4*latRad));
  var easting = k0 * N * (A + (1-T+C)*A*A*A/6) + 500000;
  var northing = k0 * (M + N * Math.tan(latRad) * (A*A/2 + (5-T+9*C+4*C*C)*A*A*A*A/24));

  // BBox für WMS (400m × 400m Fenster um den Mittelpunkt)
  var halfW = 200;
  var wmsBbox = (easting - halfW) + ',' + (northing - halfW) + ',' + (easting + halfW) + ',' + (northing + halfW);

  var url = 'https://www.wms.nrw.de/umwelt/energieatlas'
    + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo'
    + '&LAYERS=wk_raumwaermebedarf_baublock&QUERY_LAYERS=wk_raumwaermebedarf_baublock'
    + '&STYLES=&CRS=EPSG:25832&BBOX=' + wmsBbox
    + '&WIDTH=256&HEIGHT=256&I=128&J=128'
    + '&INFO_FORMAT=text/xml';

  return fetch(url, { signal: AbortSignal.timeout(10000) })
    .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.text(); })
    .then(function(txt) {
      // XML parsen — suche nach spezifisch_raumwaermebedarf_kwh_m2
      var match = txt.match(/raumwaermebedarf[^>]*>(\d+(?:\.\d+)?)</i);
      if (!match) return 0;
      var spezKwh = parseFloat(match[1]);
      if (isNaN(spezKwh) || spezKwh <= 0) return 0;

      var estimatedBj = _spezWaermeToBarujahr(spezKwh);
      var enriched = 0;

      buildings.forEach(function(b) {
        if (b._hasOsmBj || b.baujährQuelle) return;
        b.baujahr = estimatedBj;
        b.baujährQuelle = 'NRW-Energieatlas (' + Math.round(spezKwh) + ' kWh/m²)';
        enriched++;
      });
      return enriched;
    })
    .catch(function(err) {
      console.warn('NRW Energieatlas Baujahr-Abfrage fehlgeschlagen:', err.message);
      return 0;
    });
}

// Dispatcher: wählt die richtige Quelle nach Bundesland
function _enrichBaujahrFromSources(bbox, blId, buildings) {
  if (blId === 'hh') {
    showHint('🔍 Lade Baualtersklassen (Hamburg KWP)…');
    return _enrichBaujahrHamburg(bbox, buildings);
  }
  if (blId === 'nw') {
    showHint('🔍 Lade Wärmebedarf (NRW Energieatlas)…');
    return _enrichBaujahrNRW(bbox, buildings);
  }
  // Andere Bundesländer: aktuell keine externe Baujahr-Quelle
  return Promise.resolve(0);
}

// ── Overpass (Fallback für Bayern + Ausland) ─────────────────────────────────
export var OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
var _overpassServerNames = ['overpass-api.de', 'kumi.systems', 'private.coffee', 'maps.mail.ru'];
var _overpassCancelled = false;

function _overpassSingleAttempt(query) {
  var done = false;
  var controllers = [];
  var failures = 0;
  var serverStatus = OVERPASS_ENDPOINTS.map(function() { return 'wartet…'; });
  var total = OVERPASS_ENDPOINTS.length;

  function updateStatus(elapsed) {
    if (done) return;
    var lines = serverStatus.map(function(s, i) { return _overpassServerNames[i] + ': ' + s; });
    showHint('⏳ OSM-Laden (' + elapsed + 's)  —  ' + lines.join('  |  '));
  }

  return new Promise(function(resolve) {
    var startTime = Date.now();
    var ticker = setInterval(function() {
      if (done || _overpassCancelled) { clearInterval(ticker); return; }
      updateStatus(Math.round((Date.now() - startTime) / 1000));
    }, 500);

    OVERPASS_ENDPOINTS.forEach(function(endpoint, idx) {
      var ctrl = new AbortController();
      controllers.push(ctrl);
      serverStatus[idx] = '🔄';
      var timer = setTimeout(function() { ctrl.abort(); }, 20000);
      fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal
      }).then(function(resp) {
        clearTimeout(timer);
        if (done || _overpassCancelled) return;
        if (!resp.ok || resp.status === 429 || resp.status === 504) {
          serverStatus[idx] = '⚠ HTTP ' + resp.status;
          throw new Error('HTTP ' + resp.status);
        }
        serverStatus[idx] = '📥 Daten empfangen…';
        updateStatus(Math.round((Date.now() - startTime) / 1000));
        return resp.json();
      }).then(function(data) {
        if (done || _overpassCancelled || !data) return;
        if (!data.elements || data.elements.length === 0) {
          serverStatus[idx] = '⚠ leer';
          throw new Error('Leere Antwort');
        }
        serverStatus[idx] = '✓ ' + data.elements.length + ' Elemente';
        done = true;
        clearInterval(ticker);
        controllers.forEach(function(c) { try { c.abort(); } catch(e){} });
        resolve(data);
      }).catch(function(err) {
        clearTimeout(timer);
        if (!serverStatus[idx].startsWith('⚠')) serverStatus[idx] = '✗ ' + (err.name === 'AbortError' ? 'Timeout' : 'Fehler');
        failures++;
        if (failures >= total && !done) {
          done = true;
          clearInterval(ticker);
          resolve(null);
        }
      });
    });
  });
}

export function _overpassFetchWithRetry(query) {
  var MAX_RETRIES = 3;
  _overpassCancelled = false;

  return new Promise(function(resolve) {
    function attempt(retryNum) {
      if (_overpassCancelled) { resolve(null); return; }
      if (retryNum > 0) {
        showHint('🔁 Versuch ' + (retryNum + 1) + '/' + (MAX_RETRIES + 1) + ' — Server werden erneut angefragt…');
      }
      _overpassSingleAttempt(query).then(function(data) {
        if (_overpassCancelled) { resolve(null); return; }
        if (data) {
          resolve(data);
        } else if (retryNum < MAX_RETRIES) {
          var wait = 2 + retryNum * 2; // 2s, 4s, 6s Pause
          showHint('⚠ Alle Server fehlgeschlagen — neuer Versuch in ' + wait + 's… (Versuch ' + (retryNum + 1) + '/' + (MAX_RETRIES + 1) + ')');
          setTimeout(function() { attempt(retryNum + 1); }, wait * 1000);
        } else {
          showHint('⚠ OSM-Server nicht erreichbar nach ' + (MAX_RETRIES + 1) + ' Versuchen — bitte Gebiet verkleinern oder später erneut versuchen');
          setTimeout(hideHint, 8000);
          resolve(null);
        }
      });
    }
    attempt(0);
  });
}

export async function loadOsmBuildings(){
  // Snapshot the area polygon coords immediately before anything else runs,
  // so hidePanels() or async timing can't clear/mutate them underneath us.
  const snapArea = (areaLatLngs && areaLatLngs.length >= 3)
    ? areaLatLngs.map(p => L.latLng(p.lat, p.lng))
    : null;

  hidePanels();
  const btn=document.getElementById('osm-btn');
  btn.classList.add('loading');

  // BBox berechnen (für WFS und Overpass)
  let bbox;
  if(snapArea && snapArea.length >= 3){
    let minLat=90, maxLat=-90, minLng=180, maxLng=-180;
    snapArea.forEach(p => {
      if(p.lat < minLat) minLat = p.lat; if(p.lat > maxLat) maxLat = p.lat;
      if(p.lng < minLng) minLng = p.lng; if(p.lng > maxLng) maxLng = p.lng;
    });
    bbox = [minLat, minLng, maxLat, maxLng];
  } else {
    const b=map.getBounds();
    const maxSpan = 0.05;
    const cLat = b.getCenter().lat, cLng = b.getCenter().lng;
    const latSpan = Math.min((b.getNorth() - b.getSouth()) / 2, maxSpan);
    const lngSpan = Math.min((b.getEast() - b.getWest()) / 2, maxSpan);
    bbox=[cLat - latSpan, cLng - lngSpan, cLat + latSpan, cLng + lngSpan];
  }

  let toAdd = [];

  try{
    // ── 1. WFS versuchen (amtliches Kataster, schnell & zuverlässig) ──
    const wfsData = await _wfsFetchBuildings(bbox);
    if (wfsData && wfsData.features && wfsData.features.length > 0) {
      toAdd = parseWfsGeoJson(wfsData, snapArea);
    }

    // ── 2. Overpass-Fallback (Bayern, Ausland, oder WFS leer) ──
    if (toAdd.length === 0) {
      const blId = _detectBundesland((bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2);
      if (wfsData !== null) {
        showHint('⏳ WFS ohne Ergebnis — versuche OpenStreetMap…');
      }
      let polyFilter;
      if(snapArea && snapArea.length >= 3){
        polyFilter = snapArea.map(p => p.lat.toFixed(6) + ' ' + p.lng.toFixed(6)).join(' ');
      }
      const areaFilter = polyFilter
        ? `(poly:"${polyFilter}")`
        : `(${bbox.join(',')})`;
      const query=`[out:json][timeout:30];
(way["building"]${areaFilter};);
out body;>;out skel qt;`;

      const data = await _overpassFetchWithRetry(query);
      if (data) {
        toAdd = parseOsmData(data, snapArea);
      }
    }

    if(toAdd.length === 0){
      showHint('Keine neuen Gebäude gefunden');
      setTimeout(hideHint,3500);
      btn.classList.remove('loading');
      return;
    }

    // ── 3. Baujahr-Anreicherung aus externen Quellen (Hamburg KWP, NRW Energieatlas) ──
    const blIdForEnrich = _detectBundesland((bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2);
    try {
      const enrichedCount = await _enrichBaujahrFromSources(bbox, blIdForEnrich, toAdd);
      if (enrichedCount > 0) {
        showHint('✓ Baujahr für ' + enrichedCount + ' Gebäude angereichert — lade auf Karte…');
        await new Promise(r => setTimeout(r, 400));
      }
    } catch (e) { console.warn('Baujahr-Anreicherung übersprungen:', e.message); }

    // Gebäude in Häppchen einfügen — Polygone erscheinen batch-weise auf der Karte
    const CHUNK = 20;
    set_batchImporting(true);
    for(let i = 0; i < toAdd.length; i += CHUNK){
      toAdd.slice(i, i + CHUNK).forEach(opts => {
        const g = addGebaeude(opts);
        // Azimut der Südseite automatisch aus Polygon-Längsachse ableiten
        if (g && g.polygon && g.polygon.length >= 3) {
          const az = detectRoofAzimutFromPolygon(g.polygon);
          if (az !== null) { g.dachAzimut = az; g.dachAutoAzimut = true; }
        }
      });
      showHint(`OSM: ${Math.min(i + CHUNK, toAdd.length)} / ${toAdd.length} Gebäude…`);
      await new Promise(r => setTimeout(r, 0));
    }
    set_batchImporting(false);

    // Sofort Erfolgsmeldung + ausblenden
    showHint(`✓ ${toAdd.length} Gebäude geladen`);
    setTimeout(hideHint, 2000);

    // Einmalig alles aktualisieren
    renderList();
    updateViz();
    updateTotals();
    recalcNetz();
    populateZentraleSelect();

    // Plangebiet-Polygon + Eckpunkte ausblenden nach erfolgreichem Import
    if (areaPolygon) { map.removeLayer(areaPolygon); }
    areaEditMarkers.forEach(m => map.removeLayer(m));
  }catch(err){
    set_batchImporting(false);
    showHint('⚠ Fehler: '+err.message);setTimeout(hideHint,4000);console.error(err);
  }
  btn.classList.remove('loading');
  // Sicherheit: Hint spätestens nach 3s ausblenden falls er hängenbleibt
  setTimeout(function(){ const h=document.getElementById('hint'); if(h && !h.classList.contains('hidden') && (h.textContent.indexOf('geladen')>-1 || h.textContent.indexOf('Gebäude')>-1)) hideHint(); }, 3000);
}

export function parseOsmLevels(tags){
  const raw = tags['building:levels'] || tags.levels || '';
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  if(n > 0 && n < 100) return n;
  return null;
}

export function parseOsmHeight(tags){
  const raw = tags.height || '';
  const m = String(raw).match(/^(\d+(?:[.,]\d+)?)\s*m/i) || String(raw).match(/^(\d+(?:[.,]\d+)?)$/);
  if(m) return parseFloat(m[1].replace(',', '.')) || null;
  return null;
}

export function parseOsmBaujahr(tags){
  const raw = tags.start_date || tags['start_date:edtf'] || tags.construction_date || tags['construction:date'] || tags.year || '';
  const s = String(raw).trim();
  const y = s.length >= 4 ? parseInt(s.substring(0, 4), 10) : NaN;
  if(!isNaN(y) && y >= 1800 && y <= 2030) return y;
  return null;
}

// Gibt Array von Gebäude-Optionsobjekten zurück — keine Seiteneffekte.
export function parseOsmData(data, snapArea){
  const nodes={};
  data.elements.forEach(el=>{ if(el.type==='node') nodes[el.id]={lat:el.lat,lng:el.lon}; });
  const existingOsm=new Set(gebaeude.filter(g=>g.osmId).map(g=>g.osmId));
  const result=[];

  data.elements.forEach(el=>{
    if(el.type!=='way'||!el.tags?.building) return;
    if(existingOsm.has(el.id)) return;

    // Garagen, Schuppen etc. überspringen
    if(OSM_SKIP_TYPES.has((el.tags.building||'').toLowerCase())) return;

    const coords=el.nodes.map(nid=>nodes[nid]).filter(Boolean);
    if(coords.length<3) return;

    if(snapArea&&snapArea.length>=3){
      const center=polygonCenter(coords);
      if(!pointInPolygon(center, snapArea)) return;
    }

    const t=el.tags;
    let name=t.name||(t['addr:street']&&(t['addr:street']+(t['addr:housenumber']?' '+t['addr:housenumber']:'')).trim())||t.amenity||t['building:use']||t.shop||t.office||'';
    const nutzung = osmNutzung(t.building);
    if(!name) name = null; // wird in addGebaeude via nextGebName(nutzung) gesetzt

    let stockwerke = parseOsmLevels(t);
    let _stockwerkeFromData = stockwerke != null;
    if (stockwerke == null) {
      const heightM = parseOsmHeight(t);
      if (heightM != null) { stockwerke = Math.max(1, Math.round(heightM / 3)); _stockwerkeFromData = true; }
    }
    if (stockwerke == null) stockwerke = 1;

    // Baujahr aus OSM-Tags — null wenn unbekannt (wird später per Nachbarschaft gefüllt)
    const osmBj = parseOsmBaujahr(t);

    // Schwerpunkt für spätere Nachbarschaftssuche
    const sumLat = coords.reduce((s,c) => s + c.lat, 0);
    const sumLng = coords.reduce((s,c) => s + c.lng, 0);
    const cLat = sumLat / coords.length;
    const cLng = sumLng / coords.length;

    result.push({coords, name, fromOsm:true, osmId:el.id, stockwerke, _stockwerkeFromData,
                 baujahr: osmBj, _hasOsmBj: osmBj !== null, _lat: cLat, _lng: cLng, nutzung});
  });

  // ── Nachbarschaftsinferenz für Gebäude ohne Baujahr ─────────────────────────
  const defaultBj = parseInt(document.getElementById('osm-default-baujahr')?.value) || 1970;
  const withYear    = result.filter(b => b._hasOsmBj);
  const withoutYear = result.filter(b => !b._hasOsmBj);

  if (withYear.length >= 3) {
    // Max-Suchradius: ~400 m in Grad (~0.004°)
    const MAX_D2 = 0.004 * 0.004;
    const N = 5;

    withoutYear.forEach(b => {
      // Nächste N Nachbarn mit bekanntem Baujahr (nur innerhalb Suchradius)
      const nearby = [];
      for (const k of withYear) {
        const d2 = (k._lat - b._lat) ** 2 + (k._lng - b._lng) ** 2;
        if (d2 <= MAX_D2) nearby.push({d2, baujahr: k.baujahr});
      }
      if (nearby.length > 0) {
        nearby.sort((a, x) => a.d2 - x.d2);
        const years = nearby.slice(0, N).map(x => x.baujahr).sort((a, x) => a - x);
        b.baujahr = years[Math.floor(years.length / 2)]; // Median
      } else {
        b.baujahr = defaultBj; // kein Nachbar → Nutzer-Fallback
      }
    });
  } else {
    // Zu wenige Referenzgebäude → Fallback für alle
    withoutYear.forEach(b => { b.baujahr = defaultBj; });
  }

  // Hilfsfelder entfernen
  result.forEach(b => { delete b._hasOsmBj; delete b._lat; delete b._lng; });
  return result;
}

export function populateZentraleSelect(){
  const sel = document.getElementById('netz-zentrale');
  if(!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">-- bitte wählen --</option>';
  gebaeude.forEach(g => {
    if(g.polygon){
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      sel.appendChild(opt);
    }
  });
  // Wichtig: g.id ist Zahl, currentVal (Dropdown-Wert) ist String → als String vergleichen.
  // (Früher '==', durch ESLint-Umstellung auf '===' verschärft → Zentrale ging beim
  //  Neuzeichnen/renderList verloren, recalcNetz/autoGenerateNetz brachen ab.)
  if(currentVal && gebaeude.some(g => String(g.id) === currentVal)) {
    sel.value = currentVal;
  }
}

const WAERME_NETZ_BASISJAHR = 2026;

function _netzPlanningYears() {
  const years = new Set([WAERME_NETZ_BASISJAHR,globalYear]);
  gebaeude.forEach(g => {
    const events = [
      Number.parseInt(g.baujahr,10),
      Number.parseInt(g.abrissjahr,10),
      ...(g.sanierungen || []).map(item => Number.parseInt(item.jahr,10)),
    ].filter(Number.isFinite);
    events.forEach(year => {
      if (year < WAERME_NETZ_BASISJAHR) return;
      years.add(year);
      if (year > WAERME_NETZ_BASISJAHR) years.add(year - 1);
    });
  });
  return [...years].sort((a,b) => a-b);
}

function _maxBuildingLoad(g, years = _netzPlanningYears()) {
  return years.reduce((maximum,year) =>
    Math.max(maximum,getComputedStats(g,year).heizlast || 0),0);
}

// Vergleicht ausschließlich radiale Varianten desselben Kandidatengraphen.
// Damit bleibt die gewählte räumliche Planungsart maßgeblich; optimiert wird
// nur, welcher Ast an welcher Stelle an die Zentrale angebunden ist.
function _optimizeCentralBranches(treeEdges,possibleEdges,buildingNodes,zId,strategy) {
  const lifetimeYears = 20;
  const cp = 4.184;
  const rhoWater = 975;
  const nuWater = 0.000000415;
  const roughness = 0.00005;
  const vlTemp = readNum('netz-vl',90,20,150);
  const rlTemp = readNum('netz-rl',60,0,140);
  const dt = Math.max(1,vlTemp - rlTemp);
  const vFlow = readNum('netz-v',1,0.3,2);
  const dpMain = readNum('netz-dp-main',150,50,500);
  const dpService = readNum('netz-dp-service',250,50,500);
  const uBase = readNum('netz-u-wert',0.25,0.05,2);
  const soilMean = readNum('netz-t-mittel',10,-20,30);
  const meanPipeTemp = (vlTemp + rlTemp) / 2;
  const heatPrice = 80; // konservativer Fallback, solange keine belastbaren WGK vorliegen
  const electricityPrice = readNum('wirt-p-strom',35,0,200) / 100;
  const annualHours = Math.max(1,getNetzVBH() || 1800);
  const loadById = new Map(buildingNodes.map(node => [node.id,node.load || 0]));
  const requiredIds = new Set(buildingNodes.map(node => node.id));
  const edgeKeyOf = edge => String(edge.u) < String(edge.v)
    ? `${edge.u}:${edge.v}` : `${edge.v}:${edge.u}`;
  const centralDegree = edges => edges.reduce((sum,edge) =>
    sum + (edge.u === zId || edge.v === zId ? 1 : 0),0);
  const hydraulicsFor = (load,dn) => {
    const diameter = dn / 1000;
    const area = Math.PI * Math.pow(diameter / 2,2);
    const massFlow = load / (cp * dt);
    const velocity = (massFlow / rhoWater) / area;
    const reynolds = velocity * diameter / nuWater;
    const lambda = reynolds < 2300
      ? 64 / Math.max(reynolds,100)
      : 0.25 / Math.pow(Math.log10(roughness / (3.7 * diameter) + 5.74 / Math.pow(reynolds,0.9)),2);
    return {velocity,dpPerM:lambda * rhoWater * Math.pow(velocity,2) / (2 * diameter)};
  };
  const gzf = count => {
    const method = document.getElementById('netz-gzf-methode')?.value || 'richtwert';
    if (method === 'keine') return 1;
    if (method === 'manuell') return Math.max(0.1,Math.min(1,readNum('netz-gzf-manuell',0.6,0.1,1)));
    return Math.max(0.45,1 / Math.pow(Math.max(1,count),0.15));
  };
  const scoreTree = edges => {
    const adjacency = new Map();
    edges.forEach(edge => {
      if (!adjacency.has(edge.u)) adjacency.set(edge.u,[]);
      if (!adjacency.has(edge.v)) adjacency.set(edge.v,[]);
      adjacency.get(edge.u).push({to:edge.v,edge});
      adjacency.get(edge.v).push({to:edge.u,edge});
    });
    const parent = new Map([[zId,null]]);
    const parentEdge = new Map();
    const order = [zId];
    for (let i = 0; i < order.length; i++) {
      for (const item of adjacency.get(order[i]) || []) {
        if (item.to === parent.get(order[i])) continue;
        if (parent.has(item.to)) return {score:Infinity};
        parent.set(item.to,order[i]);
        parentEdge.set(item.to,item.edge);
        order.push(item.to);
      }
    }
    if ([...requiredIds].some(id => !parent.has(id))) return {score:Infinity};

    const loads = new Map(order.map(id => [id,loadById.get(id) || 0]));
    const consumers = new Map(order.map(id => [id,(loadById.get(id) || 0) > 0 ? 1 : 0]));
    const pathDp = new Map([[zId,0]]);
    const sized = new Map();
    for (let i = order.length - 1; i > 0; i--) {
      const id = order[i];
      const upstream = parent.get(id);
      const rawLoad = loads.get(id) || 0;
      const count = consumers.get(id) || 0;
      const designLoad = rawLoad * gzf(count);
      const edge = parentEdge.get(id);
      const houseConnection = count === 1 &&
        (edge.uNode?.type === 'geb' || edge.vNode?.type === 'geb');
      const dpLimit = houseConnection ? dpService : dpMain;
      const dn = standardDNs.find(candidate => {
        const hydraulic = hydraulicsFor(designLoad,candidate);
        return hydraulic.velocity <= getVFlowForDN(candidate,vFlow) &&
          hydraulic.dpPerM <= dpLimit;
      }) || standardDNs[standardDNs.length - 1];
      sized.set(id,{edge,dn,hydraulic:hydraulicsFor(designLoad,dn)});
      loads.set(upstream,(loads.get(upstream) || 0) + rawLoad);
      consumers.set(upstream,(consumers.get(upstream) || 0) + count);
    }

    let investment = 0;
    let lossMWhPerYear = 0;
    order.slice(1).forEach(id => {
      const sizedEdge = sized.get(id);
      const length = sizedEdge.edge.dist;
      investment += length * getKostenProM(sizedEdge.dn);
      lossMWhPerYear += getUWertForDN(sizedEdge.dn,uBase) * length *
        Math.max(0,meanPipeTemp - soilMean) / 1000 * 8.76;
      const upstream = parent.get(id);
      pathDp.set(id,(pathDp.get(upstream) || 0) +
        sizedEdge.hydraulic.dpPerM * length * 2);
    });
    const maxPathDp = Math.max(0,...[...requiredIds].map(id => pathDp.get(id) || 0)) + 50000;
    const rootLoad = loads.get(zId) || 0;
    const rootFlowM3s = (rootLoad / (cp * dt) / rhoWater);
    const hydraulicKW = rootFlowM3s * maxPathDp / 1000;
    const efficiency = hydraulicKW < 0.1 ? 0.25
      : hydraulicKW < 0.5 ? 0.4
      : hydraulicKW < 2 ? 0.55
      : hydraulicKW < 10 ? 0.65
      : hydraulicKW < 50 ? 0.73
      : hydraulicKW < 200 ? 0.78 : 0.82;
    const pumpKW = hydraulicKW / efficiency;
    const operating = lifetimeYears *
      (lossMWhPerYear * heatPrice + pumpKW * annualHours * electricityPrice);
    return {score:investment + operating,investment,operating,pumpKW,maxPathDp};
  };

  let current = [...treeEdges];
  const before = scoreTree(current);
  const centralCandidates = possibleEdges
    .filter(edge => edge.u === zId || edge.v === zId)
    .sort((a,b) => a.dist - b.dist)
    .slice(0,Math.min(16,possibleEdges.length));
  let swaps = 0;
  for (let pass = 0; pass < 4; pass++) {
    const currentKeys = new Set(current.map(edgeKeyOf));
    let best = null;
    for (const candidate of centralCandidates) {
      if (currentKeys.has(edgeKeyOf(candidate))) continue;
      const adjacency = new Map();
      current.forEach(edge => {
        if (!adjacency.has(edge.u)) adjacency.set(edge.u,[]);
        if (!adjacency.has(edge.v)) adjacency.set(edge.v,[]);
        adjacency.get(edge.u).push({to:edge.v,edge});
        adjacency.get(edge.v).push({to:edge.u,edge});
      });
      const queue = [candidate.u];
      const previous = new Map([[candidate.u,null]]);
      for (let i = 0; i < queue.length && !previous.has(candidate.v); i++) {
        for (const item of adjacency.get(queue[i]) || []) {
          if (previous.has(item.to)) continue;
          previous.set(item.to,{node:queue[i],edge:item.edge});
          queue.push(item.to);
        }
      }
      if (!previous.has(candidate.v)) continue;
      const cycleEdges = [];
      for (let node = candidate.v; node !== candidate.u;) {
        const step = previous.get(node);
        cycleEdges.push(step.edge);
        node = step.node;
      }
      for (const removed of cycleEdges) {
        const isBuildingToTrasse =
          (removed.uNode?.type === 'geb' && removed.vNode?.type === 'trasse') ||
          (removed.vNode?.type === 'geb' && removed.uNode?.type === 'trasse');
        // Die Anzahl direkter Trassenanschlüsse ist die sichtbare Wirkung des
        // Treue-Reglers. Der Kostenvergleich darf diese Nutzerentscheidung
        // deshalb nicht nachträglich wieder zurückdrehen.
        if (removed.forcedTrasse || isBuildingToTrasse ||
            removed.u === zId || removed.v === zId) continue;
        const trial = current.filter(edge => edge !== removed);
        trial.push(candidate);
        const result = scoreTree(trial);
        if (!Number.isFinite(result.score)) continue;
        if (!best || result.score < best.result.score) best = {trial,result};
      }
    }
    const currentResult = scoreTree(current);
    if (!best || best.result.score >= currentResult.score * 0.995) break;
    current = best.trial;
    swaps++;
  }
  const after = scoreTree(current);
  window._netzTopologyOptimization = {
    strategy,
    lifetimeYears,
    scoreBeforeEur:before.score,
    scoreAfterEur:after.score,
    centralBranchesBefore:centralDegree(treeEdges),
    centralBranchesAfter:centralDegree(current),
    swaps,
  };
  return current;
}

export function autoGenerateNetz(options = {}){
  const strategy = options.strategy || 'trasse';
  const loyalty = Math.max(0, Math.min(100, Number(options.trasseTreue ?? document.getElementById('netz-trassentreue')?.value ?? 80)));
  const loyaltyRatio = loyalty / 100;
  const trunkConnectionFactor = 1.8 - 1.6 * loyaltyRatio;
  const neighbourConnectionFactor = 0.4 + 1.6 * loyaltyRatio;
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if(!zId || isNaN(zId)){
    showHint('⚠ Bitte zuerst eine Heizzentrale auswählen!', 5000);
    // Dropdown hervorheben
    const sel = document.getElementById('netz-zentrale');
    if (sel) { sel.style.borderColor = '#e53935'; sel.style.boxShadow = '0 0 8px rgba(229,57,53,0.4)'; sel.focus(); setTimeout(() => { sel.style.borderColor = ''; sel.style.boxShadow = ''; }, 4000); }
    return;
  }

  clearNetz();

  const planningYears = _netzPlanningYears();
  const nodes = gebaeude.filter(g => {
    if (!g.polygon) return false;
    return networkLocked
      ? getComputedStats(g,WAERME_NETZ_BASISJAHR).heizlast > 0
      : _maxBuildingLoad(g,planningYears) > 0;
  });
  if(nodes.length < 2) {
    showHint('Es müssen mindestens zwei Gebäude mit Verbrauch gezeichnet sein.');
    return;
  }

  const allPts = nodes.map(g => {
    const load = networkLocked
      ? getComputedStats(g,WAERME_NETZ_BASISJAHR).heizlast || 0
      : _maxBuildingLoad(g,planningYears);
    return { id: g.id, type: 'geb', pt: polygonCenter(g.polygon), load };
  });

  const usedNodeIds = new Set(allPts.map(node => node.id));
  let tIdCounter = 10000;
  const nextTrasseNodeId = () => {
    while (usedNodeIds.has(tIdCounter)) tIdCounter++;
    const id = tIdCounter++;
    usedNodeIds.add(id);
    return id;
  };
  const useHeatTrasse = strategy !== 'quick';
  const heatSegments = useHeatTrasse
    ? trasseSegments.filter(seg => !seg.domains || seg.domains.includes('waerme'))
    : [];
  const heatPointIndices = new Set();
  if (useHeatTrasse && trasseSegments.length === 0) trassePoints.forEach((_, i) => heatPointIndices.add(i));
  else heatSegments.forEach(seg => { for (let i=seg.start; i<=seg.end; i++) heatPointIndices.add(i); });
  const sharedTrasseNodes = new Map();
  const getTrasseNode = pt => {
    const key = `${Number(pt.lat).toFixed(7)},${Number(pt.lng).toFixed(7)}`;
    if (!sharedTrasseNodes.has(key)) sharedTrasseNodes.set(key, { id: nextTrasseNodeId(), type: 'trasse', pt, load: 0 });
    return sharedTrasseNodes.get(key);
  };
  const tNodes = trassePoints.map((pt, index) => {
    if (!heatPointIndices.has(index)) return null;
    return getTrasseNode(pt);
  });

  const possibleEdges = [];
  const hasTrasse = sharedTrasseNodes.size > 0;
  if (hasTrasse) {
    // Gebäude nicht an die wenigen Zeichen-Stützpunkte hängen, sondern an den
    // geometrisch nächsten Punkt der Trassenlinie. Die dort entstehenden
    // Anschlussknoten teilen die Haupttrasse anschließend sauber auf.
    const projectionZoom = 18;
    const projectionsByLeg = new Map();
    const projectToLeg = (pt, a, b) => {
      const p = map.project(pt, projectionZoom);
      const pa = map.project(a, projectionZoom);
      const pb = map.project(b, projectionZoom);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const denominator = dx * dx + dy * dy;
      const t = denominator > 0
        ? Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / denominator))
        : 0;
      const projected = map.unproject(L.point(pa.x + t * dx, pa.y + t * dy), projectionZoom);
      return {pt: projected, t, dist: pt.distanceTo(projected)};
    };
    const buildingNodes = allPts.filter(n => n.type === 'geb');
    const nearestBuildingDistances = buildingNodes.map(building => {
      const distances = buildingNodes
        .filter(other => other.id !== building.id)
        .map(other => building.pt.distanceTo(other.pt));
      return distances.length ? Math.min(...distances) : 30;
    }).sort((a,b) => a-b);
    const medianBuildingDistance = nearestBuildingDistances.length
      ? nearestBuildingDistances[Math.floor(nearestBuildingDistances.length / 2)]
      : 30;
    const streetCoverageLimitM = Math.max(25,Math.min(60,medianBuildingDistance * 1.5));
    const streetLocalMaxM = Math.max(45,Math.min(140,medianBuildingDistance * 3));
    const roadProjectionByBuilding = new Map();

    for (const building of buildingNodes) {
      let best = null;
      heatSegments.forEach((seg, segIndex) => {
        for (let pointIndex = seg.start; pointIndex < seg.end; pointIndex++) {
          const a = trassePoints[pointIndex], b = trassePoints[pointIndex + 1];
          if (!a || !b) continue;
          const candidate = projectToLeg(building.pt, a, b);
          if (!best || candidate.dist < best.dist) best = {...candidate, segIndex, pointIndex};
        }
      });
      // Kompatibilität mit alten Projekten ohne explizite Segmentliste.
      if (!best && trasseSegments.length === 0) {
        for (let pointIndex = 0; pointIndex < trassePoints.length - 1; pointIndex++) {
          const candidate = projectToLeg(building.pt, trassePoints[pointIndex], trassePoints[pointIndex + 1]);
          if (!best || candidate.dist < best.dist) best = {...candidate, segIndex: 0, pointIndex};
        }
      }
      if (!best) continue;
      roadProjectionByBuilding.set(building.id,best);
    }

    // OSM ist auf privaten Liegenschaften oft nur teilweise vollständig.
    // Gebäude weit außerhalb des Straßengraphen werden deshalb zu lokalen
    // freien Gruppen zusammengefasst. Pro Gruppe erhält nur das straßennächste
    // Gebäude eine Übergangsleitung; der Rest wird lokal verbunden.
    const streetCoveredIds = new Set();
    const streetGatewayIds = new Set();
    const streetClusterByBuilding = new Map();
    if (strategy === 'street') {
      buildingNodes.forEach(building => {
        const projection = roadProjectionByBuilding.get(building.id);
        if (projection && projection.dist <= streetCoverageLimitM) streetCoveredIds.add(building.id);
      });
      const uncovered = buildingNodes.filter(building => !streetCoveredIds.has(building.id));
      const unassigned = new Set(uncovered.map(building => building.id));
      let clusterId = 0;
      while (unassigned.size) {
        const firstId = unassigned.values().next().value;
        const queue = [buildingNodes.find(building => building.id === firstId)];
        unassigned.delete(firstId);
        const cluster = [];
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index];
          if (!current) continue;
          cluster.push(current);
          uncovered.forEach(other => {
            if (!unassigned.has(other.id)) return;
            if (current.pt.distanceTo(other.pt) > streetLocalMaxM) return;
            unassigned.delete(other.id);
            queue.push(other);
          });
        }
        cluster.forEach(building => streetClusterByBuilding.set(building.id,clusterId));
        const gateway = cluster
          .filter(building => roadProjectionByBuilding.has(building.id))
          .sort((a,b) =>
            roadProjectionByBuilding.get(a.id).dist - roadProjectionByBuilding.get(b.id).dist)[0];
        if (gateway) streetGatewayIds.add(gateway.id);
        clusterId++;
      }
      window._streetRoutingDiagnostics = {
        coverageLimitM:streetCoverageLimitM,
        localMaxM:streetLocalMaxM,
        coveredBuildings:streetCoveredIds.size,
        uncoveredBuildings:uncovered.length,
        freeClusters:new Set(streetClusterByBuilding.values()).size,
        gatewayBuildings:streetGatewayIds.size,
      };
    } else {
      window._streetRoutingDiagnostics = null;
    }

    for (const building of buildingNodes) {
      const best = roadProjectionByBuilding.get(building.id);
      if (!best) continue;
      if (strategy === 'street' &&
          !streetCoveredIds.has(building.id) &&
          !streetGatewayIds.has(building.id)) continue;
      const junction = getTrasseNode(best.pt);
      const legKey = `${best.segIndex}:${best.pointIndex}`;
      if (!projectionsByLeg.has(legKey)) projectionsByLeg.set(legKey, []);
      projectionsByLeg.get(legKey).push({t: best.t, node: junction});
      possibleEdges.push({
        u: building.id, v: junction.id, uNode: building, vNode: junction,
        dist: best.dist,
        sortCost:best.dist * trunkConnectionFactor *
          (strategy === 'street' && streetGatewayIds.has(building.id) ? 1.2 : 1),
        streetGateway:strategy === 'street' && streetGatewayIds.has(building.id),
      });
    }

    // Lokale Verteilung: Gebäude dürfen sich über kurze Nachbarschaftskanten
    // sammeln. Der MST wählt daraus wenige Trassenanschlüsse statt eines
    // sternförmigen Einzelanschlusses jedes Gebäudes. Sechs Nachbarn reichen
    // für robuste Quartiersnetze, ohne die Kandidatenmenge quadratisch wachsen
    // zu lassen.
    const localEdgeKeys = new Set();
    for (const building of buildingNodes) {
      const neighbours = buildingNodes
        .filter(other => other.id !== building.id)
        .map(other => ({other, dist: building.pt.distanceTo(other.pt)}))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 6);
      for (const {other, dist} of neighbours) {
        if (strategy === 'street') {
          const buildingCovered = streetCoveredIds.has(building.id);
          const otherCovered = streetCoveredIds.has(other.id);
          const sameFreeCluster = !buildingCovered && !otherCovered &&
            streetClusterByBuilding.get(building.id) === streetClusterByBuilding.get(other.id);
          const shortCoveredPair = buildingCovered && otherCovered && dist <= Math.min(45,streetLocalMaxM);
          const shortTransition = buildingCovered !== otherCovered && dist <= streetCoverageLimitM;
          if (dist > streetLocalMaxM ||
              (!sameFreeCluster && !shortCoveredPair && !shortTransition)) continue;
        }
        const key = String(building.id) < String(other.id)
          ? `${building.id}:${other.id}` : `${other.id}:${building.id}`;
        if (localEdgeKeys.has(key)) continue;
        localEdgeKeys.add(key);
        possibleEdges.push({
          u: building.id, v: other.id, uNode: building, vNode: other,
          dist, sortCost: dist * neighbourConnectionFactor,
        });
      }
    }

    const segmentsForRouting = heatSegments.length > 0
      ? heatSegments
      : [{start: 0, end: trassePoints.length - 1}];
    segmentsForRouting.forEach((seg, segIndex) => {
      for (let pointIndex = seg.start; pointIndex < seg.end; pointIndex++) {
        const inserted = (projectionsByLeg.get(`${segIndex}:${pointIndex}`) || [])
          .sort((a, b) => a.t - b.t)
          .map(item => item.node);
        const sequence = [tNodes[pointIndex], ...inserted, tNodes[pointIndex + 1]].filter(Boolean);
        for (let i = 0; i < sequence.length - 1; i++) {
          if (sequence[i].id === sequence[i + 1].id) continue;
          possibleEdges.push({
            u: sequence[i].id, v: sequence[i + 1].id,
            uNode: sequence[i], vNode: sequence[i + 1],
            dist: sequence[i].pt.distanceTo(sequence[i + 1].pt),
            forcedTrasse: strategy !== 'street',
            streetRoad: strategy === 'street',
          });
        }
      }
    });
  } else {
    const buildings = allPts.filter(n => n.type === 'geb');
    for (let i=0; i<buildings.length; i++) for (let j=i+1; j<buildings.length; j++) {
      const dist = buildings[i].pt.distanceTo(buildings[j].pt);
      const directToCentral = buildings[i].id === zId || buildings[j].id === zId;
      possibleEdges.push({
        u:buildings[i].id, v:buildings[j].id, uNode:buildings[i], vNode:buildings[j], dist,
        sortCost: dist * (directToCentral ? trunkConnectionFactor : neighbourConnectionFactor),
      });
    }
  }

  const parent = {};
  allPts.push(...sharedTrasseNodes.values());
  allPts.forEach(n => parent[n.id] = n.id);
  function find(i) {
    if (parent[i] === i) return i;
    return parent[i] = find(parent[i]);
  }
  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
      return true;
    }
    return false;
  }

  const mstEdges = [];

  // Die gezeichnete Haupttrasse ist eine Planungsvorgabe und darf durch den
  // Minimalbaum nicht zugunsten einer vermeintlich kürzeren Abkürzung entfallen.
  const forcedEdges = possibleEdges.filter(edge => edge.forcedTrasse);
  const optionalEdges = possibleEdges.filter(edge => !edge.forcedTrasse)
    .sort((a, b) => (a.sortCost ?? a.dist) - (b.sortCost ?? b.dist));
  for (const edge of [...forcedEdges, ...optionalEdges]) {
    if(union(edge.u, edge.v)) {
      mstEdges.push(edge);
    }
  }

  if (strategy === 'street') {
    // Der OSM-Import enthält auch Straßenäste ohne versorgtes Gebäude. Diese
    // Blätter iterativ entfernen; übrig bleiben nur Straßenpfade, die echte
    // Gebäudeanschlüsse miteinander verbinden.
    let changed = true;
    while (changed) {
      changed = false;
      const degree = new Map();
      mstEdges.forEach(edge => {
        degree.set(edge.u, (degree.get(edge.u) || 0) + 1);
        degree.set(edge.v, (degree.get(edge.v) || 0) + 1);
      });
      for (let i = mstEdges.length - 1; i >= 0; i--) {
        const edge = mstEdges[i];
        const uLeaf = edge.uNode.type === 'trasse' && degree.get(edge.u) === 1;
        const vLeaf = edge.vNode.type === 'trasse' && degree.get(edge.v) === 1;
        if (!edge.streetRoad || (!uLeaf && !vLeaf)) continue;
        mstEdges.splice(i, 1);
        changed = true;
      }
    }
  }

  const optimizedEdges = _optimizeCentralBranches(
    mstEdges,possibleEdges,allPts.filter(node => node.type === 'geb'),zId,strategy
  );
  mstEdges.splice(0,mstEdges.length,...optimizedEdges);

  mstEdges.forEach(e => {
    const layer = L.polyline([e.uNode.pt, e.vNode.pt], {color: '#e53935', weight: 4, opacity: 0.8, pane: 'netzPane'});
    const hitLayer = L.polyline([e.uNode.pt, e.vNode.pt], {color: 'transparent', weight: 20, pane: 'netzPane'});
    if (netzVisible) { layer.addTo(map); hitLayer.addTo(map); }
    const edgeObj = {
        u: e.u, v: e.v, uNode: e.uNode, vNode: e.vNode,
        layer: layer, hitLayer: hitLayer, load: 0, dn: 0, length: e.uNode.pt.distanceTo(e.vNode.pt),
        waypoint: null, segLayers: [], warnMarker: null, midMarker: null
    };
    hitLayer.on('click', (ev) => {
      if (window.isDrawingEdge) return;
      showEdgePopup(edgeObj, ev.originalEvent);
      L.DomEvent.stopPropagation(ev);
    });
    hitLayer.on('contextmenu', () => {
      if (!ensureWaermeNetzStructureEditable()) return;
      map.removeLayer(layer);
      map.removeLayer(hitLayer);
      if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
      removeEdgeWaypointMarkers(edgeObj);
      if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
      if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
      setNetzEdges(window.netzEdges.filter(x => x !== edgeObj));
      closeEdgePopup();
      recalcNetz();
    });
    window.netzEdges.push(edgeObj);
    addEdgeMidHandle(edgeObj);
  });

  applyWaypoints();
  recalcNetz();
  // Ein Bestandsnetz bildet ausschließlich den Gebäudebestand im Basisjahr
  // ab. Bereits erfasste spätere Neubauten erhalten anschließend nur einen
  // zeitlich geschalteten Hausanschluss; die Bestandstrasse bleibt unverändert.
  if (networkLocked) {
    gebaeude
      .filter(g => g.polygon &&
        getComputedStats(g,WAERME_NETZ_BASISJAHR).heizlast <= 0 &&
        _maxBuildingLoad(g,planningYears) > 0)
      .sort((a,b) => (Number.parseInt(a.baujahr,10) || 9999) - (Number.parseInt(b.baujahr,10) || 9999))
      .forEach(g => connectGebToNearestPipe(g));
  } else {
    // Terminale Anschlüsse geplanter Neubauten folgen deren Lebenszeit. Ein
    // Gebäude, das als Durchgangspunkt für weitere Abnehmer dient, wird nicht
    // ausgeblendet, weil sonst der restliche Strang optisch unterbrochen wäre.
    const degree = new Map();
    window.netzEdges.forEach(edge => {
      degree.set(edge.u,(degree.get(edge.u) || 0) + 1);
      degree.set(edge.v,(degree.get(edge.v) || 0) + 1);
    });
    gebaeude.forEach(g => {
      const built = Number.parseInt(g.baujahr,10);
      if (!Number.isFinite(built) || built <= WAERME_NETZ_BASISJAHR || degree.get(g.id) !== 1) return;
      const edge = window.netzEdges.find(candidate => candidate.u === g.id || candidate.v === g.id);
      if (!edge) return;
      edge.visibleFromYear = built;
      edge.visibleUntilYear = Number.parseInt(g.abrissjahr,10) || null;
    });
    recalcNetz();
  }
  autoAssignEdgeCosts();
  // Nach der Erzeugung bewusst in eine ruhige Ergebnisansicht wechseln.
  setNetzRewireMode(false);
  setNetzEditMode(false);
  window.trasseVisible = false;
  const trasseCheckbox = document.getElementById('el-trasse-visible');
  if (trasseCheckbox) trasseCheckbox.checked = false;
  redrawTrasse();
  const streetInfo = strategy === 'street' && window._streetRoutingDiagnostics?.uncoveredBuildings > 0
    ? ` · ${window._streetRoutingDiagnostics.uncoveredBuildings} Gebäude in ${window._streetRoutingDiagnostics.freeClusters} OSM-Lücke${window._streetRoutingDiagnostics.freeClusters === 1 ? '' : 'n'} lokal ergänzt`
    : '';
  showHint(`✓ Wärmenetz erstellt: ${window.netzEdges.length} Leitungsabschnitte${streetInfo}.`, 4500);
}

export async function confirmAutoGenerateNetz(options = {}){
  const existing = window.netzEdges?.length || 0;
  if (existing > 0) {
    const message = `Das vorhandene Wärmenetz mit <strong>${existing} Leitungsabschnitten</strong> wird durch die neue Berechnung ersetzt.` +
      '<br><br><span style="color:var(--muted);font-size:10px">Gebäude, Haupttrasse und Konfiguration bleiben erhalten.</span>';
    const ok = typeof window.epConfirm === 'function'
      ? await window.epConfirm('Wärmenetz neu erstellen',message,{
          okText:'Netz ersetzen',cancelText:'Abbrechen',danger:true,
        })
      : window.confirm(`Das vorhandene Wärmenetz mit ${existing} Leitungsabschnitten wird ersetzt. Fortfahren?`);
    if (!ok) return false;
  }
  autoGenerateNetz(options);
  return true;
}

export function toggleNetzCreateMenu(force) {
  const menu = document.getElementById('netz-create-menu');
  const button = document.getElementById('btn-netz-create');
  if (!menu) return false;
  const open = typeof force === 'boolean' ? force : menu.hidden;
  menu.hidden = !open;
  button?.setAttribute('aria-expanded', String(open));
  return open;
}

export function updateTrassentreueLabel(value) {
  const numeric = Math.max(0, Math.min(100, Number(value) || 0));
  const output = document.getElementById('netz-trassentreue-output');
  const description = document.getElementById('netz-trassentreue-description');
  if (output) output.textContent = `${numeric}%`;
  if (description) description.textContent = numeric < 34
    ? 'Lokal gebündelt: kurze Verbindungen zwischen Nachbargebäuden'
    : numeric > 66
      ? 'Direkt angebunden: mehr Anschlüsse an Zentrale, Straße oder Haupttrasse'
      : 'Ausgewogen: lokale Gruppen mit gezielten direkten Anschlüssen';
}

export async function createQuickWaermeNetz() {
  toggleNetzCreateMenu(false);
  const created = await confirmAutoGenerateNetz({strategy: 'quick'});
  if (created) closeNetzWorkspace();
  return created;
}

export function startGuidedTrasseCreation() {
  window._streetHelperDrawing = false;
  toggleNetzCreateMenu(false);
  closeNetzWorkspace();
  if (!window.isDrawingTrasse) toggleDrawTrasse('waerme');
}

export function startStreetHelperDrawing() {
  window._streetHelperDrawing = true;
  toggleNetzCreateMenu(false);
  closeNetzWorkspace();
  if (!window.isDrawingTrasse) toggleDrawTrasse('waerme');
  showHint('Fehlenden Straßenverlauf zeichnen. Die OSM-Hilfslinien sind dabei ausgeblendet; das vorhandene Netz bleibt sichtbar.',6000);
}

export async function createStreetOrientedWaermeNetz() {
  const button = document.getElementById('btn-netz-create-street');
  const original = button?.textContent;
  const helperWorkflow = !!window._streetHelperDrawing;
  if (button) { button.disabled = true; button.textContent = 'Straßenzüge werden geladen …'; }
  try {
    if (typeof window.loadOsmStrassen !== 'function' || typeof window.adoptAllOsmStrassen !== 'function') {
      showHint('OSM-Straßenmodul ist nicht verfügbar.', 6000);
      return false;
    }
    await window.loadOsmStrassen();
    const adopted = window.adoptAllOsmStrassen('waerme');
    if (!adopted) {
      showHint('Keine geeigneten Straßenzüge im Planungsgebiet gefunden.', 6000);
      return false;
    }
    // Die OSM-Linien sind nur Berechnungsgrundlage. Der Vorschau-Layer würde
    // das fertige Wärmenetz gelb überlagern und wird daher vor der Erzeugung
    // entfernt; die übernommene Geometrie bleibt in der Trasse erhalten.
    window.clearOsmStrassen?.();
    toggleNetzCreateMenu(false);
    const created = await confirmAutoGenerateNetz({strategy: 'street'});
    if (created) closeNetzWorkspace();
    return created;
  } finally {
    if (helperWorkflow) {
      window._streetHelperDrawing = false;
      window.trasseVisible = false;
      const trasseCheckbox = document.getElementById('el-trasse-visible');
      if (trasseCheckbox) trasseCheckbox.checked = false;
      redrawTrasse();
    }
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

export function confirmClearNetz(){
  const existing = window.netzEdges?.length || 0;
  if (!existing) {
    clearNetz();
    return true;
  }
  if (!window.confirm(`Wirklich alle ${existing} Wärmeleitungen löschen?`)) return false;
  clearNetz();
  return true;
}

export function addNetzEdge(u, v, {force = false} = {}){
  if (!force && !ensureWaermeNetzStructureEditable()) return;
  const gU = gebaeude.find(g=>g.id===u);
  const gV = gebaeude.find(g=>g.id===v);
  if(!gU || !gV || !gU.polygon || !gV.polygon) return;
  const uLoad = getComputedStats(gU, globalYear).heizlast || 0;
  const vLoad = getComputedStats(gV, globalYear).heizlast || 0;
  if (uLoad === 0) { showHint(`"${gU.name}" hat keinen Verbrauch und kann nicht angeschlossen werden.`); return; }
  if (vLoad === 0) { showHint(`"${gV.name}" hat keinen Verbrauch und kann nicht angeschlossen werden.`); return; }

  if(window.netzEdges.some(e => (e.u===u&&e.v===v) || (e.u===v&&e.v===u))) return;

  const c1 = polygonCenter(gU.polygon);
  const c2 = polygonCenter(gV.polygon);
  const layer = L.polyline([c1, c2], {color: '#e53935', weight: 4, opacity: 0.8, pane: 'netzPane'});
  const hitLayer = L.polyline([c1, c2], {color: 'transparent', weight: 20, pane: 'netzPane'});
  if (netzVisible) { layer.addTo(map); hitLayer.addTo(map); }

  const uStats = getComputedStats(gU, globalYear);
  const vStats = getComputedStats(gV, globalYear);

  const edgeObj = {
    u: u, v: v,
    uNode: {id: u, type: 'geb', pt: c1, load: uStats.heizlast||0},
    vNode: {id: v, type: 'geb', pt: c2, load: vStats.heizlast||0},
    layer: layer, hitLayer: hitLayer, load: 0, dn: 0,
    _straightLength: c1.distanceTo(c2), length: c1.distanceTo(c2),
    waypoint: null, segLayers: [], warnMarker: null, midMarker: null
  };

  hitLayer.on('click', (ev) => {
    if (window.isDrawingEdge) return;
    if (netzPruningMode) { toggleEdgePruned(edgeObj); L.DomEvent.stopPropagation(ev); return; }
    showEdgePopup(edgeObj, ev.originalEvent);
    L.DomEvent.stopPropagation(ev);
  });
  hitLayer.on('contextmenu', () => {
    if (!ensureWaermeNetzStructureEditable()) return;
    map.removeLayer(layer);
    map.removeLayer(hitLayer);
    if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
    removeEdgeWaypointMarkers(edgeObj);
    if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
    if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
    setNetzEdges(window.netzEdges.filter(e => e !== edgeObj));
    closeEdgePopup();
    recalcNetz();
  });

  window.netzEdges.push(edgeObj);
  addEdgeMidHandle(edgeObj);
}

// ── Bestandsnetz: neu gezeichnetes Gebäude per Lotpunkt-Stich anschließen ──────
// Sucht die nächstgelegene Leitung, fügt am Lotfußpunkt einen Abzweig-Knoten ein
// (Leitung wird gesplittet und behält ihre DN) und legt einen Stich zum Gebäude.
// recalcNetz() prüft danach die Auslastung → gelbes ⚠-Dreieck bei Überlast.
// Hinweis: Abzweig-Knoten (id ≥ 20000) werden – wie Trasse-Knoten – derzeit nicht
// in der Projektdatei gespeichert (customEdges nur Gebäude↔Gebäude).
function _nextJunctionId(){
  let maxId = 19999;
  window.netzEdges.forEach(e => {
    if (e.uNode && e.uNode.type === 'junction' && e.u > maxId) maxId = e.u;
    if (e.vNode && e.vNode.type === 'junction' && e.v > maxId) maxId = e.v;
  });
  return maxId + 1;
}

// Baut ein vollwertiges Kanten-Objekt zwischen zwei beliebigen Knoten (geb/trasse/junction)
function _makeNetzEdge(uNode, vNode, dn){
  const layer    = L.polyline([uNode.pt, vNode.pt], {color: '#e53935', weight: 4, opacity: 0.8, pane: 'netzPane'});
  const hitLayer = L.polyline([uNode.pt, vNode.pt], {color: 'transparent', weight: 20, pane: 'netzPane'});
  if (netzVisible) { layer.addTo(map); hitLayer.addTo(map); }
  const edgeObj = {
    u: uNode.id, v: vNode.id, uNode, vNode,
    layer, hitLayer, load: 0, dn: dn || 0,
    _straightLength: uNode.pt.distanceTo(vNode.pt), length: uNode.pt.distanceTo(vNode.pt),
    waypoint: null, segLayers: [], warnMarker: null, midMarker: null
  };
  hitLayer.on('click', (ev) => {
    if (window.isDrawingEdge) return;
    if (netzPruningMode) { toggleEdgePruned(edgeObj); L.DomEvent.stopPropagation(ev); return; }
    showEdgePopup(edgeObj, ev.originalEvent);
    L.DomEvent.stopPropagation(ev);
  });
  hitLayer.on('contextmenu', () => {
    if (!ensureWaermeNetzStructureEditable()) return;
    map.removeLayer(layer); map.removeLayer(hitLayer);
    if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
    removeEdgeWaypointMarkers(edgeObj);
    if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
    if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
    setNetzEdges(window.netzEdges.filter(e => e !== edgeObj));
    closeEdgePopup(); recalcNetz();
  });
  window.netzEdges.push(edgeObj);
  addEdgeMidHandle(edgeObj);
  return edgeObj;
}

// Vollständiger, JSON-tauglicher Snapshot des Wärmenetz-Graphen. Anders als das
// historische customEdges-Format bleiben damit auch Trassen-/Abzweigknoten,
// Bestands-DN, Kostenklasse und manuell verschobene Leitungen erhalten.
export function captureWaermeNetzGraph(){
  const nodes = new Map();
  const remember = n => {
    if (!n || n.id == null || !n.pt) return;
    nodes.set(n.id, {
      id: n.id,
      type: n.type || 'junction',
      lat: Number(n.pt.lat),
      lng: Number(n.pt.lng),
      load: Number(n.load) || 0
    });
  };
  const edges = (window.netzEdges || []).map(e => {
    remember(e.uNode); remember(e.vNode);
    return {
      u: e.u, v: e.v,
      dn: Number(e.dn) || 0,
      ...(e.visibleFromYear != null && Number.isFinite(Number(e.visibleFromYear))
        ? {visibleFromYear:Number(e.visibleFromYear)} : {}),
      ...(e.visibleUntilYear != null && Number.isFinite(Number(e.visibleUntilYear))
        ? {visibleUntilYear:Number(e.visibleUntilYear)} : {}),
      pruned: e.pruned === true,
      kostKlasse: e.kostKlasse || null,
      kostOverride: e.kostOverride === true,
      waypoints: getEdgeWaypoints(e).map(point => ({lat: Number(point.lat), lng: Number(point.lng)})),
      waypoint: e.waypoint ? {lat: Number(e.waypoint.lat), lng: Number(e.waypoint.lng)} : null
    };
  });
  return { nodes: [...nodes.values()], edges };
}

// Stellt einen zuvor erfassten Graphen ohne automatische Neugenerierung wieder
// her. Gebäudeknoten werden bewusst an ihre aktuelle Polygonmitte gebunden;
// freie Trassen- und Abzweigknoten verwenden ihre gespeicherten Koordinaten.
export function applyWaermeNetzGraph(graph, {recalculate = true} = {}){
  clearNetz();
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return;

  const nodes = new Map();
  graph.nodes.forEach(data => {
    let pt = null;
    let load = Number(data.load) || 0;
    if (data.type === 'geb') {
      const g = gebaeude.find(item => item.id === data.id);
      if (!g?.polygon) return;
      pt = polygonCenter(g.polygon);
      load = getComputedStats(g, globalYear).heizlast || 0;
    } else {
      pt = L.latLng(Number(data.lat), Number(data.lng));
    }
    nodes.set(data.id, {id: data.id, type: data.type || 'junction', pt, load});
  });

  graph.edges.forEach(data => {
    const uNode = nodes.get(data.u), vNode = nodes.get(data.v);
    if (!uNode || !vNode) return;
    const edge = _makeNetzEdge(uNode, vNode, Number(data.dn) || 0);
    edge.pruned = data.pruned === true;
    edge.kostKlasse = data.kostKlasse || null;
    edge.kostOverride = data.kostOverride === true;
    edge.visibleFromYear = data.visibleFromYear == null ? null : Number(data.visibleFromYear);
    edge.visibleUntilYear = data.visibleUntilYear == null ? null : Number(data.visibleUntilYear);
    const storedWaypoints = Array.isArray(data.waypoints) ? data.waypoints : (data.waypoint ? [data.waypoint] : []);
    if (storedWaypoints.length) {
      edge.waypoints = storedWaypoints.map(point => L.latLng(Number(point.lat), Number(point.lng)));
      edge.waypoint = edge.waypoints[0] || null;
      edge.layer.setLatLngs([uNode.pt, ...edge.waypoints, vNode.pt]);
      edge.hitLayer?.setLatLngs([uNode.pt, ...edge.waypoints, vNode.pt]);
      if (edge.midMarker) map.removeLayer(edge.midMarker);
      removeEdgeWaypointMarkers(edge);
      addEdgeMidHandle(edge);
    }
  });
  if (recalculate) recalcNetz();
}

export function connectGebToNearestPipe(g){
  if (!g || !g.polygon || !networkLocked) return false;
  if (!window.netzEdges || window.netzEdges.length === 0) return false;
  if (window.netzEdges.some(e => e.u === g.id || e.v === g.id)) return false; // schon angeschlossen

  const gc = polygonCenter(g.polygon);

  // Nächstgelegenen Punkt auf dem vollständigen Leitungsverlauf suchen. Das
  // Bestandsnetz darf dabei weder begradigt noch neu dimensioniert werden.
  let best = null;
  for (const e of window.netzEdges) {
    if (e.pruned || e.visibleFromYear != null ||
        !e.uNode || !e.vNode || !e.uNode.pt || !e.vNode.pt) continue;
    const projection = _nearestPointOnNetzEdge(e,gc);
    if (!projection) continue;
    const distance = gc.distanceTo(projection.point);
    if (!best || distance < best.distance) best = {...projection,distance};
  }
  if (!best) return false;

  const E = best.edge;
  const gNode = { id: g.id, type: 'geb', pt: gc, load: 0 };
  const addBuildingConnection = targetNode => {
    const edge = _makeNetzEdge(targetNode,gNode,0);
    edge.visibleFromYear = Number.parseInt(g.baujahr,10) || null;
    edge.visibleUntilYear = Number.parseInt(g.abrissjahr,10) || null;
    return edge;
  };
  const SNAP = 8; // m — Lotpunkt liegt praktisch auf einem Endknoten → dort direkt anschließen
  const dToU = best.point.distanceTo(E.uNode.pt);
  const dToV = best.point.distanceTo(E.vNode.pt);

  if (dToU < SNAP || dToV < SNAP) {
    const target = dToU <= dToV ? E.uNode : E.vNode;
    addBuildingConnection(target);
  } else {
    // Die vorhandene Leitung wird am Abzweig nur topologisch geteilt. Beide
    // Teilstücke behalten DN, Kostenklasse und ihren bisherigen Linienverlauf.
    const jNode = { id: _nextJunctionId(), type: 'junction', pt: best.point, load: 0 };
    const dn = E.dn || 0;
    const sourceProps = {
      kostKlasse:E.kostKlasse || null,
      kostOverride:E.kostOverride === true,
      pruned:E.pruned === true,
    };
    const leftWaypoints = best.path.slice(1,best.index+1);
    const rightWaypoints = best.path.slice(best.index+1,-1);
    _removeNetzEdge(E);
    const left = _makeNetzEdge(E.uNode,jNode,dn);
    const right = _makeNetzEdge(jNode,E.vNode,dn);
    Object.assign(left,sourceProps); Object.assign(right,sourceProps);
    _applySplitWaypoints(left,leftWaypoints);
    _applySplitWaypoints(right,rightWaypoints);
    addBuildingConnection(jNode); // Stich → neue DN wird in recalcNetz dimensioniert
  }
  recalcNetz();
  return true;
}

export function clearNetz(){
  setNetzRewireMode(false);
  window.netzEdges.forEach(e => {
    map.removeLayer(e.layer);
    if(e.hitLayer) map.removeLayer(e.hitLayer);
    if(e.midMarker) map.removeLayer(e.midMarker);
    removeEdgeWaypointMarkers(e);
    if(e.warnMarker) map.removeLayer(e.warnMarker);
    if(e.segLayers) e.segLayers.forEach(s => { if(map.hasLayer(s)) map.removeLayer(s); });
  });
  setNetzEdges([]);
  window._netzAnnualLossMWh = null;
  setSelectedStrandId(null);
  const sel = document.getElementById('netz-strang');
  if (sel) sel.value = '';
  updateRohrListe();
  gebaeude.forEach(g => delete g.tempIn);
}

export function applyWaypoints() {
  window.netzEdges.forEach(e => {
    const stored = edgeWaypoints[edgeKey(e.u, e.v)];
    if (!stored) return;
    const points = Array.isArray(stored) ? stored : [stored];
    e.waypoints = points.map(wp => L.latLng(wp.lat, wp.lng));
    e.waypoint = e.waypoints[0] || null;
    const ll = e.layer.getLatLngs();
    e.layer.setLatLngs([ll[0], ...e.waypoints, ll[ll.length - 1]]);
    if (e.hitLayer) e.hitLayer.setLatLngs([ll[0], ...e.waypoints, ll[ll.length - 1]]);
    if (e.midMarker) { map.removeLayer(e.midMarker); removeEdgeWaypointMarkers(e); addEdgeMidHandle(e); }
  });
}

export function abklemmenGebaeude(id) {
  if (!ensureWaermeNetzStructureEditable()) return false;
  const toRemove = window.netzEdges.filter(e => e.u === id || e.v === id);
  toRemove.forEach(e => {
    if (map.hasLayer(e.layer)) map.removeLayer(e.layer);
    if (e.hitLayer && map.hasLayer(e.hitLayer)) map.removeLayer(e.hitLayer);
    if (e.midMarker) map.removeLayer(e.midMarker);
    removeEdgeWaypointMarkers(e);
    if (e.warnMarker) map.removeLayer(e.warnMarker);
    if (e.segLayers) e.segLayers.forEach(s => { if(map.hasLayer(s)) map.removeLayer(s); });
  });
  setNetzEdges(window.netzEdges.filter(e => e.u !== id && e.v !== id));
  closeEdgePopup();
  recalcNetz();
  renderList();
}

export function setNetzVisible(visible) {
  netzVisible = visible;
  window.netzEdges.forEach(e => {
    const layers = [e.layer, e.hitLayer, ...(e.segLayers||[])].filter(Boolean);
    layers.forEach(l => {
      if (visible && !e.temporallyHidden) { if (!map.hasLayer(l)) map.addLayer(l); }
      else { if (map.hasLayer(l)) map.removeLayer(l); }
    });
    const editLayers = [e.midMarker, ...(e.waypointMarkers||[])].filter(Boolean);
    editLayers.forEach(layer => {
      if (visible && netzEditMode && !e.temporallyHidden) { if (!map.hasLayer(layer)) map.addLayer(layer); }
      else if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    if (!visible || !netzEditMode) {
      if (e.warnMarker && map.hasLayer(e.warnMarker)) map.removeLayer(e.warnMarker);
    }
  });
  // Beide Checkboxen synchron halten
  const cb1 = document.getElementById('netz-visible');
  const cb2 = document.getElementById('netz-visible-ansicht');
  if (cb1) cb1.checked = visible;
  if (cb2) cb2.checked = visible;
  refreshNetzFlowArrows();
}

function _edgeFlowArrow(edge) {
  const latLngs = edge.layer?.getLatLngs?.() || [];
  if (latLngs.length < 2) return null;
  const points = latLngs.map(latLng => map.latLngToLayerPoint(latLng));
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const length = points[index - 1].distanceTo(points[index]);
    lengths.push(length);
    total += length;
  }
  if (total < 18) return null;
  let target = total / 2;
  for (let index = 0; index < lengths.length; index++) {
    if (target > lengths[index]) {
      target -= lengths[index];
      continue;
    }
    const start = points[index];
    const end = points[index + 1];
    const ratio = lengths[index] ? target / lengths[index] : 0;
    const point = L.point(
      start.x + (end.x - start.x) * ratio,
      start.y + (end.y - start.y) * ratio
    );
    return {
      latLng: map.layerPointToLatLng(point),
      angle: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
    };
  }
  return null;
}

export function refreshNetzFlowArrows() {
  if (!netzFlowArrowLayer) netzFlowArrowLayer = L.layerGroup();
  netzFlowArrowLayer.clearLayers();
  if (!netzMotionless || !netzVisible) {
    if (map.hasLayer(netzFlowArrowLayer)) map.removeLayer(netzFlowArrowLayer);
    return;
  }
  window.netzEdges.forEach(edge => {
    if (!(edge.load > 0) || edge.temporallyHidden || edge.pruned) return;
    const arrow = _edgeFlowArrow(edge);
    if (!arrow) return;
    const zoom = map.getZoom();
    const size = zoom <= 15 ? 7 : zoom <= 17 ? 8 : 10;
    const color = edge.layer?.options?.color || '#e53935';
    const icon = L.divIcon({
      className: 'netz-flow-arrow',
      html: `<svg style="--netz-arrow-angle:${arrow.angle}deg" width="${size}" height="${size}" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1.5 L7 5 L2 8.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      iconSize: [size,size],
      iconAnchor: [size / 2,size / 2]
    });
    L.marker(arrow.latLng, {icon, interactive:false, keyboard:false, zIndexOffset:800})
      .addTo(netzFlowArrowLayer);
  });
  if (!map.hasLayer(netzFlowArrowLayer)) netzFlowArrowLayer.addTo(map);
}

export function setNetzMotionless(enabled) {
  netzMotionless = !!enabled;
  const panelCheckbox = document.getElementById('netz-motionless');
  const layerCheckbox = document.getElementById('el-netz-motionless');
  if (panelCheckbox) panelCheckbox.checked = netzMotionless;
  if (layerCheckbox) layerCheckbox.checked = netzMotionless;
  if (netzMotionless) stopAnimPipes();
  else if (window.netzEdges.some(edge => edge.load > 0)) startAnimPipes();
  if (!netzFlowArrowEventsBound) {
    map.on('zoomend moveend', refreshNetzFlowArrows);
    netzFlowArrowEventsBound = true;
  }
  refreshNetzFlowArrows();
}

export function setNetzEditMode(enabled) {
  netzEditMode = !!enabled;
  if (netzEditMode) setNetzVisible(true);
  window.netzEdges.forEach(edge => {
    [edge.midMarker, ...(edge.waypointMarkers || [])].filter(Boolean).forEach(layer => {
      if (netzEditMode && netzVisible && !edge.temporallyHidden) { if (!map.hasLayer(layer)) map.addLayer(layer); }
      else if (map.hasLayer(layer)) map.removeLayer(layer);
    });
  });
  const button = document.getElementById('btn-netz-edit-mode');
  if (button) {
    button.classList.toggle('active', netzEditMode);
    const label = button.querySelector('strong');
    if (label) label.textContent = netzEditMode ? 'Leitungsbearbeitung beenden' : 'Leitungsverläufe bearbeiten';
    else button.textContent = netzEditMode ? 'Bearbeitung beenden' : 'Leitungsverläufe bearbeiten';
  }
  recalcNetz();
  if (netzEditMode) showHint('Bearbeitungsmodus: Leitungspunkt auf den gewünschten Straßenverlauf ziehen – der Abschnitt wird beim Loslassen neu geroutet. Doppelklick entfernt einen Knickpunkt.');
  else hideHint();
  return netzEditMode;
}

export function toggleNetzEditMode() {
  return setNetzEditMode(!netzEditMode);
}

function _removeNetzEdge(edge) {
  if (!edge) return;
  [edge.layer, edge.hitLayer, edge.midMarker, edge.warnMarker, ...(edge.waypointMarkers || []), ...(edge.segLayers || [])]
    .filter(Boolean).forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
  removeEdgeWaypointMarkers(edge);
  setNetzEdges(window.netzEdges.filter(candidate => candidate !== edge));
}

function _parentEdgeForBuilding(buildingId) {
  const centralId = parseInt(document.getElementById('netz-zentrale')?.value, 10);
  if (!centralId || buildingId === centralId) return null;
  const adjacency = new Map();
  window.netzEdges.filter(edge => !edge.pruned).forEach(edge => {
    if (!adjacency.has(edge.u)) adjacency.set(edge.u, []);
    if (!adjacency.has(edge.v)) adjacency.set(edge.v, []);
    adjacency.get(edge.u).push({id:edge.v,edge});
    adjacency.get(edge.v).push({id:edge.u,edge});
  });
  const visited = new Set([centralId]);
  const queue = [centralId];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const neighbour of adjacency.get(nodeId) || []) {
      if (visited.has(neighbour.id)) continue;
      if (neighbour.id === buildingId) return neighbour.edge;
      visited.add(neighbour.id);
      queue.push(neighbour.id);
    }
  }
  return null;
}

function _buildingSideNodes(buildingId, excludedEdge) {
  const adjacency = new Map();
  window.netzEdges.filter(edge => edge !== excludedEdge && !edge.pruned).forEach(edge => {
    if (!adjacency.has(edge.u)) adjacency.set(edge.u, []);
    if (!adjacency.has(edge.v)) adjacency.set(edge.v, []);
    adjacency.get(edge.u).push(edge.v);
    adjacency.get(edge.v).push(edge.u);
  });
  const visited = new Set([buildingId]);
  const queue = [buildingId];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const neighbour of adjacency.get(nodeId) || []) {
      if (!visited.has(neighbour)) { visited.add(neighbour); queue.push(neighbour); }
    }
  }
  return visited;
}

function _nearestPointOnNetzEdge(edge, latlng) {
  const points = [edge.uNode.pt, ...getEdgeWaypoints(edge), edge.vNode.pt];
  const cursor = map.latLngToLayerPoint(latlng);
  let best = null;
  for (let index = 0; index < points.length - 1; index++) {
    const a = map.latLngToLayerPoint(points[index]);
    const b = map.latLngToLayerPoint(points[index + 1]);
    const dx = b.x-a.x, dy = b.y-a.y;
    const denominator = dx*dx+dy*dy;
    const t = denominator ? Math.max(0,Math.min(1,((cursor.x-a.x)*dx+(cursor.y-a.y)*dy)/denominator)) : 0;
    const projected = L.point(a.x+t*dx,a.y+t*dy);
    const distancePx = cursor.distanceTo(projected);
    if (!best || distancePx < best.distancePx) {
      best = {edge,index,t,distancePx,point:map.layerPointToLatLng(projected),path:points};
    }
  }
  return best;
}

function _applySplitWaypoints(edge, points) {
  edge.waypoints = points.map(point => L.latLng(point.lat,point.lng));
  edge.waypoint = edge.waypoints[0] || null;
  edge.layer.setLatLngs([edge.uNode.pt,...edge.waypoints,edge.vNode.pt]);
  edge.hitLayer?.setLatLngs([edge.uNode.pt,...edge.waypoints,edge.vNode.pt]);
  if (edge.midMarker) map.removeLayer(edge.midMarker);
  removeEdgeWaypointMarkers(edge);
  addEdgeMidHandle(edge);
}

export function rewireBuildingConnection(buildingId, targetEdge, targetPoint) {
  const building = gebaeude.find(item => item.id === buildingId);
  const parentEdge = _parentEdgeForBuilding(buildingId);
  if (!building?.polygon || !targetEdge || targetEdge === parentEdge || targetEdge.pruned) return false;
  const forbidden = parentEdge ? _buildingSideNodes(buildingId,parentEdge) : new Set();
  if (parentEdge && forbidden.has(targetEdge.u) && forbidden.has(targetEdge.v)) {
    showHint('Dieses Ziel liegt im nachgelagerten Teilnetz des Gebäudes.',3500);
    return false;
  }
  const snapshot = captureWaermeNetzGraph();
  const stats = getComputedStats(building,globalYear);
  const buildingNode = parentEdge
    ? (parentEdge.u === buildingId ? parentEdge.uNode : parentEdge.vNode)
    : {id:building.id,type:'geb',pt:polygonCenter(building.polygon),load:stats.heizlast || 0};
  const projection = _nearestPointOnNetzEdge(targetEdge,targetPoint);
  if (!projection) return false;
  const dn = targetEdge.dn || 0;
  const sourceProps = {kostKlasse:targetEdge.kostKlasse||null,kostOverride:targetEdge.kostOverride===true};
  if (parentEdge) _removeNetzEdge(parentEdge);
  const distanceU = projection.point.distanceTo(targetEdge.uNode.pt);
  const distanceV = projection.point.distanceTo(targetEdge.vNode.pt);
  if (distanceU < 5 || distanceV < 5) {
    _makeNetzEdge(distanceU <= distanceV ? targetEdge.uNode : targetEdge.vNode,buildingNode,0);
  } else {
    const junction = {id:_nextJunctionId(),type:'junction',pt:projection.point,load:0};
    const leftWaypoints = projection.path.slice(1,projection.index+1);
    const rightWaypoints = projection.path.slice(projection.index+1,-1);
    _removeNetzEdge(targetEdge);
    const left = _makeNetzEdge(targetEdge.uNode,junction,dn);
    const right = _makeNetzEdge(junction,targetEdge.vNode,dn);
    Object.assign(left,sourceProps); Object.assign(right,sourceProps);
    _applySplitWaypoints(left,leftWaypoints);
    _applySplitWaypoints(right,rightWaypoints);
    _makeNetzEdge(junction,buildingNode,0);
  }
  recalcNetz();
  if ((window._waermeNetzValidation?.cycleEdges || 0) > 0 ||
      (window._waermeNetzValidation?.disconnectedConsumerIds || []).includes(buildingId)) {
    applyWaermeNetzGraph(snapshot);
    showHint('Anschluss nicht geändert: Das Ziel würde eine ungültige Netzstruktur erzeugen.',4500);
    return false;
  }
  showHint(parentEdge
    ? `✓ Anschluss von „${building.name}“ umgehängt.`
    : `✓ „${building.name}“ an das Wärmenetz angeschlossen.`,3000);
  return true;
}

function _renderNetzRewireMarkers() {
  netzRewireMarkers.forEach(marker => map.removeLayer(marker));
  netzRewireMarkers = [];
  if (!netzRewireMode) return;
  const centralId = parseInt(document.getElementById('netz-zentrale')?.value,10);
  const icon = L.divIcon({className:'netz-rewire-handle',html:'↗',iconSize:[18,18],iconAnchor:[9,9]});
  gebaeude.filter(building => {
    if (building.id === centralId || !building.polygon || isExcluded(building.id)) return false;
    return getComputedStats(building,globalYear).heizlast > 0;
  }).forEach(building => {
    const origin = polygonCenter(building.polygon);
    const connected = Boolean(_parentEdgeForBuilding(building.id));
    const marker = L.marker(origin,{
      draggable:true,icon,zIndexOffset:2600,
      title:connected ? `Anschluss ${building.name} umhängen` : `${building.name} an das Netz anschließen`
    }).addTo(map);
    marker._netzBuildingId = building.id;
    marker.on('dragstart',() => {
      netzRewirePreview = L.polyline([origin,origin],{color:'#29b6f6',weight:2,dashArray:'5,4',interactive:false}).addTo(map);
    });
    marker.on('drag',event => netzRewirePreview?.setLatLngs([origin,event.target.getLatLng()]));
    marker.on('dragend',event => {
      if (netzRewirePreview) { map.removeLayer(netzRewirePreview); netzRewirePreview=null; }
      const parentEdge = _parentEdgeForBuilding(building.id);
      const forbidden = parentEdge ? _buildingSideNodes(building.id,parentEdge) : new Set();
      const candidates = window.netzEdges
        .filter(edge => !edge.pruned && !edge.temporallyHidden && edge !== parentEdge &&
          !(parentEdge && forbidden.has(edge.u) && forbidden.has(edge.v)))
        .map(edge => _nearestPointOnNetzEdge(edge,event.target.getLatLng()))
        .filter(Boolean).sort((a,b)=>a.distancePx-b.distancePx);
      const target = candidates[0];
      marker.setLatLng(origin);
      if (!target || target.distancePx > 35) {
        showHint('Kein Anschlussziel getroffen. Griff direkt auf eine Netzleitung ziehen.',3500);
        return;
      }
      if (rewireBuildingConnection(building.id,target.edge,target.point)) _renderNetzRewireMarkers();
    });
    netzRewireMarkers.push(marker);
  });
}

export function setNetzRewireMode(enabled) {
  netzRewireMode = !!enabled;
  if (netzRewireMode) {
    setNetzEditMode(false);
    setNetzVisible(true);
    showHint('Blauen Gebäudepunkt auf eine Netzleitung ziehen – zum Anschließen oder Umhängen.');
  } else hideHint();
  _renderNetzRewireMarkers();
  const button = document.getElementById('btn-netz-rewire-mode');
  if (button) {
    button.classList.toggle('active',netzRewireMode);
    const label = button.querySelector('strong');
    if (label) label.textContent = netzRewireMode ? 'Anschlussbearbeitung beenden' : 'Gebäude anschließen / umhängen';
    else button.textContent = netzRewireMode ? 'Anschlussbearbeitung beenden' : 'Gebäude anschließen / umhängen';
  }
  return netzRewireMode;
}

export function toggleNetzRewireMode() {
  return setNetzRewireMode(!netzRewireMode);
}

export function syncVLTemps(source) {
  if (source === 'netz') {
    document.getElementById('gl-vl5').value = document.getElementById('netz-vl').value;
    document.getElementById('gl-vl15').value = document.getElementById('netz-rl').value;
  } else {
    document.getElementById('netz-vl').value = document.getElementById('gl-vl5').value;
    document.getElementById('netz-rl').value = document.getElementById('gl-vl15').value;
  }
}

export function recalcNetz(){
  window._netzAnnualLossMWh = null;
  const gebMap = new Map(gebaeude.map(g => [g.id, g]));
  // Auto-GK neu berechnen wenn Netz entsteht oder sich ändert
  if (typeof updateAllDeckungen === 'function') updateAllDeckungen();
  gebaeude.forEach(g => delete g.tempIn);

  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if(!zId || isNaN(zId)) {
    gebaeude.forEach(g => { g.netzVerlustKW = null; g.netzVerlustRatioPct = null; g.netzVerlustJahrMWh = null; });
    updateStrandDropdown();
    updateRohrListe();
    return;
  }

  let vlTemp = parseFloat(document.getElementById('netz-vl').value) || 90;
  let rlTemp = parseFloat(document.getElementById('netz-rl').value) || 60;

  const planJahr = parseInt(document.getElementById('netz-plan-jahr').value);
  if (planJahr && globalYear >= planJahr) {
    vlTemp = parseFloat(document.getElementById('netz-plan-vl').value) || vlTemp;
    rlTemp = parseFloat(document.getElementById('netz-plan-rl').value) || rlTemp;
  }

  const dt = Math.max(1, vlTemp - rlTemp);
  const vFlow = readNum('netz-v', 1.0, 0.3, 2.0);
  const dpLimitMain = readNum('netz-dp-main', 150, 50, 500);
  const dpLimitService = readNum('netz-dp-service', 250, 50, 500);

  // Gleichzeitigkeitsfaktor (GZF) für Wärmenetz
  const wGzfMethode = document.getElementById('netz-gzf-methode')?.value || 'richtwert';
  const wGzfManuell = parseFloat(document.getElementById('netz-gzf-manuell')?.value) || 0.6;
  function _wGzf(nVerbraucher) {
    if (wGzfMethode === 'keine') return 1.0;
    if (wGzfMethode === 'manuell') return Math.max(0.1, Math.min(1.0, wGzfManuell));
    // Richtwert Wärme: 1/n^0.15 (AGFW-Näherung, flacher als Strom,
    // da Heizbedarf stark wetterkorreliert — bei Auslegungstemp. heizen fast alle)
    if (nVerbraucher <= 1) return 1.0;
    return Math.max(0.45, 1.0 / Math.pow(nVerbraucher, 0.15));
  }

  const nodeMap = {};
  const zGeb = gebMap.get(zId);
  if(zGeb) {
      nodeMap[zId] = { id: zId, load: getComputedStats(zGeb, globalYear).heizlast||0, adj: [] };
      zGeb.tempIn = vlTemp;
  }

  window.netzEdges.forEach(e => {
    // Deaktivieren schaltet den Abschnitt nur hydraulisch aus. Geometrie und
    // erfasster DN bleiben erhalten, damit ein Wiederanschließen den
    // modellierten Bestand nicht unbemerkt neu dimensioniert.
    if (e.pruned) { e.load = 0; e.loadRaw = 0; e.lossKW = 0; e.lossKW_annual = 0; return; }
    let uLoad = 0; if (e.uNode && e.uNode.type === 'geb') { const gu=gebMap.get(e.u); if(gu && !isExcluded(gu.id)) uLoad = getComputedStats(gu, globalYear).heizlast||0; }
    let vLoad = 0; if (e.vNode && e.vNode.type === 'geb') { const gv=gebMap.get(e.v); if(gv && !isExcluded(gv.id)) vLoad = getComputedStats(gv, globalYear).heizlast||0; }

    if(!nodeMap[e.u]) nodeMap[e.u] = { id: e.u, load: uLoad, adj: [] };
    if(!nodeMap[e.v]) nodeMap[e.v] = { id: e.v, load: vLoad, adj: [] };

    nodeMap[e.u].adj.push({ to: e.v, edge: e, ptTo: (e.vNode?e.vNode.pt:null) });
    nodeMap[e.v].adj.push({ to: e.u, edge: e, ptTo: (e.uNode?e.uNode.pt:null) });
  });

  const consumerIds = gebaeude
    .filter(g => g.id !== zId && !isExcluded(g.id) && getComputedStats(g, globalYear).heizlast > 0)
    .map(g => g.id);
  const topology = validateRadialHeatGraph(window.netzEdges, zId, consumerIds);
  window._waermeNetzValidation = {
    cycleEdges: topology.cycleEdgeIndexes.length,
    disconnectedConsumerIds: topology.disconnectedConsumerIds
  };
  window.netzEdges.forEach((edge, index) => {
    edge.notHydraulicallySolved = topology.cycleEdgeIndexes.includes(index);
    edge.disconnected = !edge.pruned && (!topology.reachable.has(edge.u) || !topology.reachable.has(edge.v));
    if (edge.notHydraulicallySolved) edge.layer?.setStyle({dashArray: '8,6', color: '#ab47bc'});
    else if (edge.disconnected) edge.layer?.setStyle({dashArray: '4,6', color: '#ff9800'});
  });
  const topologyWarning = document.getElementById('netz-topology-warning');
  if (topologyWarning) {
    const parts = [];
    if (topology.disconnectedConsumerIds.length) parts.push(`${topology.disconnectedConsumerIds.length} Verbraucher nicht mit der Zentrale verbunden`);
    if (topology.cycleEdgeIndexes.length) parts.push(`${topology.cycleEdgeIndexes.length} Ringkante(n) nicht hydraulisch gelöst`);
    topologyWarning.textContent = parts.length ? `⚠ ${parts.join(' · ')}` : '';
    topologyWarning.style.display = parts.length ? 'block' : 'none';
  }

  const order = [];
  const parentEdge = {};
  const visited = new Set([zId]);
  const queue = [zId];

  while(queue.length > 0){
    const curr = queue.shift();
    order.push(curr);
    if(nodeMap[curr]){
        nodeMap[curr].adj.forEach(neighbor => {
          if(!visited.has(neighbor.to)){
            visited.add(neighbor.to);
            parentEdge[neighbor.to] = { e: neighbor.edge, pNodeId: curr };
            queue.push(neighbor.to);
          }
        });
    }
  }

  const neighborsOfZ = nodeMap[zId] ? nodeMap[zId].adj.map(a => a.to).sort((a,b)=>a-b) : [];
  window.netzEdges.forEach(e => {
    if (e.u === zId || e.v === zId) {
      const other = e.u === zId ? e.v : e.u;
      e.strandId = Math.max(0, neighborsOfZ.indexOf(other));
    }
  });
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    const e = parentEdge[nodeId].e;
    if (e.strandId != null) return;
    const pNodeId = parentEdge[nodeId].pNodeId;
    e.strandId = (parentEdge[pNodeId] && parentEdge[pNodeId].e.strandId != null)
      ? parentEdge[pNodeId].e.strandId
      : 0;
  });
  window.netzEdges.forEach(e => { if (e.strandId == null) e.strandId = 0; });

  window.netzEdges.forEach(e => { e.load = 0; e.loadRaw = 0; e._nVerbraucher = 0; e._gzf = 1.0; });

  // Summierte Rohlasten und Verbraucheranzahl pro Knoten
  // calculatedLoad bleibt global zugänglich für lwwpUseNetworkValues etc.
  window.calculatedLoad = {};
  const nVerb = {};
  Object.keys(nodeMap).forEach(k => {
    window.calculatedLoad[k] = nodeMap[k].load;
    const isVerb = nodeMap[k].load > 0;
    nVerb[k] = isVerb ? 1 : 0;
  });

  for(let i = order.length - 1; i > 0; i--){
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if(pInfo){
      window.calculatedLoad[pInfo.pNodeId] += window.calculatedLoad[curr];
      nVerb[pInfo.pNodeId] += nVerb[curr];
      // Kante: Rohlast (Σ Normheizlast) und GZF-Last
      const nV = nVerb[curr];
      const raw = window.calculatedLoad[curr];
      const gzfVal = _wGzf(nV);
      pInfo.e.loadRaw = raw;
      pInfo.e.load = raw * gzfVal;
      pInfo.e._nVerbraucher = nV;
      pInfo.e._gzf = gzfVal;

      let ptP = null;
      let ptC = null;
      if(pInfo.e.u === pInfo.pNodeId) { ptP = pInfo.e.uNode?.pt; ptC = pInfo.e.vNode?.pt; }
      else { ptP = pInfo.e.vNode?.pt; ptC = pInfo.e.uNode?.pt; }

      if(!ptP || !ptC){
         const bP = gebMap.get(pInfo.pNodeId);
         const bC = gebMap.get(curr);
         if(bP&&bP.polygon) ptP = polygonCenter(bP.polygon);
         if(bC&&bC.polygon) ptC = polygonCenter(bC.polygon);
      }
      if(ptP && ptC) {
          const waypoints = getEdgeWaypoints(pInfo.e);
          const newPts = [ptP, ...waypoints, ptC];
          pInfo.e.layer.setLatLngs(newPts);
          if(pInfo.e.hitLayer) pInfo.e.hitLayer.setLatLngs(newPts);
      }
      // Länge aktualisieren (echte Polyline-Länge inkl. Waypoints)
      pInfo.e.length = calcEdgeLength(pInfo.e);
    }
  }

  // Auslegungsfall über den vollständigen Projektzeitraum. Neubaunetze
  // behalten damit ihre DN beim Jahreswechsel und sind für den jeweils
  // ungünstigsten zeitlichen Zustand dimensioniert. Beim Bestandsnetz wird
  // dieser Wert ausschließlich für neue, noch undimensionierte Anschlüsse
  // verwendet; erfasste DN werden nicht automatisch verändert.
  window.netzEdges.forEach(e => { e.designLoad = 0; e.designLoadRaw = 0; e.designYear = null; });
  _netzPlanningYears().forEach(year => {
    const yearLoad = {};
    const yearConsumers = {};
    Object.keys(nodeMap).forEach(id => {
      const g = gebMap.get(Number(id));
      const load = g && !isExcluded(g.id) ? getComputedStats(g,year).heizlast || 0 : 0;
      yearLoad[id] = load;
      yearConsumers[id] = load > 0 ? 1 : 0;
    });
    for (let i = order.length - 1; i > 0; i--) {
      const nodeId = order[i];
      const pInfo = parentEdge[nodeId];
      if (!pInfo) continue;
      const raw = yearLoad[nodeId] || 0;
      const count = yearConsumers[nodeId] || 0;
      const designLoad = raw * _wGzf(count);
      if (designLoad > pInfo.e.designLoad) {
        pInfo.e.designLoad = designLoad;
        pInfo.e.designLoadRaw = raw;
        pInfo.e.designYear = year;
      }
      yearLoad[pInfo.pNodeId] = (yearLoad[pInfo.pNodeId] || 0) + raw;
      yearConsumers[pInfo.pNodeId] = (yearConsumers[pInfo.pNodeId] || 0) + count;
    }
  });

  const cp = 4.184;
  const rhoWater = 975; // kg/m³ bei ~70°C
  const nuWater = 0.000000415; // kinematische Viskosität m²/s bei ~70°C
  const kRough = 0.00005; // Rohrrauhigkeit Stahl/KMR [m]
  const hydraulicsFor = (load,dn) => {
    const dInner = dn / 1000;
    const area = Math.PI * Math.pow(dInner / 2,2);
    const massFlow = load / (cp * dt);
    const velocity = (massFlow / rhoWater) / area;
    const reynolds = velocity * dInner / nuWater;
    const lambda = reynolds < 2300
      ? 64 / Math.max(reynolds,100)
      : 0.25 / Math.pow(Math.log10(kRough / (3.7 * dInner) + 5.74 / Math.pow(reynolds,0.9)),2);
    return {velocity,dpPerM:lambda * rhoWater * Math.pow(velocity,2) / (2 * dInner),reynolds,lambda};
  };
  // Rohr-Dimensionierung mit DN-abhängiger Fließgeschwindigkeit (2 Iterationen für Konvergenz)
  for (let iter = 0; iter < 2; iter++) {
    window.netzEdges.forEach(e => {
      if(e.load > 0){
        e.isHouseConnection = e._nVerbraucher === 1 &&
          (e.uNode?.type === 'geb' || e.vNode?.type === 'geb');
        e.dpLimit = e.isHouseConnection ? dpLimitService : dpLimitMain;

        if ((!networkLocked && !e.dnOverride) || e.dn === 0) {
            const sizingLoad = Math.max(e.load,e.designLoad || 0);
            e.dn = standardDNs.find(dn => {
              const candidate = hydraulicsFor(sizingLoad,dn);
              return candidate.velocity <= getVFlowForDN(dn,vFlow) && candidate.dpPerM <= e.dpLimit;
            }) || standardDNs[standardDNs.length - 1];
        }
      } else {
        // Zukünftig aktive Hausanschlüsse werden bereits für ihre spätere
        // Last dimensioniert, bleiben bis zum Baujahr aber unsichtbar.
        if (e.dn === 0 && e.designLoad > 0) {
          e.isHouseConnection = e._nVerbraucher <= 1 &&
            (e.uNode?.type === 'geb' || e.vNode?.type === 'geb');
          e.dpLimit = e.isHouseConnection ? dpLimitService : dpLimitMain;
          e.dn = standardDNs.find(dn => {
            const candidate = hydraulicsFor(e.designLoad,dn);
            return candidate.velocity <= getVFlowForDN(dn,vFlow) && candidate.dpPerM <= e.dpLimit;
          }) || standardDNs[standardDNs.length - 1];
        } else if (!networkLocked) {
          // Bei Neubaunetzen nie anhand des gerade inaktiven Jahres auf DN 0
          // zurückfallen; designLoad ist die maßgebliche Größe.
          e.dn = e.designLoad > 0 ? e.dn : 0;
        }
      }
    });
  }

  // ── Druckverluste (Darcy-Weisbach vereinfacht mit R-Wert) ──────────────
  // R = Druckverlust pro Meter [Pa/m], abhängig von DN, Volumenstrom, Rauigkeit
  // Formel: R = (lambda * rho * v^2) / (2 * d_i)  mit lambda aus Moody (vereinfacht)
  window.netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      const hydraulic = hydraulicsFor(e.load,e.dn);
      const vActual = hydraulic.velocity;
      e.dpPerM = hydraulic.dpPerM; // Pa/m, eine Leitung
      e.dpTotal = e.dpPerM * e.length * 2; // Pa, VL+RL
      e._vActual = vActual;
      e._reynolds = hydraulic.reynolds;
      e._lambda = hydraulic.lambda;
      e.dpExceeded = e.dpPerM > (e.dpLimit || dpLimitMain);
      e.velocityLimit = getVFlowForDN(e.dn,vFlow);
      e.velocityExceeded = e._vActual > e.velocityLimit;
      e.hydraulicBottleneck = e.dpExceeded || e.velocityExceeded;
    } else {
      e.dpPerM = 0;
      e.dpTotal = 0;
      e._vActual = 0;
      e._reynolds = 0;
      e._lambda = 0;
      e.dpExceeded = false;
      e.velocityExceeded = false;
      e.hydraulicBottleneck = false;
    }
  });

  // Kritischer Pfad: maximaler Druckverlust von Zentrale zu einem Abnehmer
  let maxPathDp = 0;
  let maxPathNode = null;
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    let pathDp = 0;
    let curr = nodeId;
    while (parentEdge[curr]) {
      pathDp += parentEdge[curr].e.dpTotal || 0;
      curr = parentEdge[curr].pNodeId;
    }
    // Hausstationsdruckverlust: ~30 kPa pro Übergabestation
    const bNode = gebMap.get(nodeId);
    if (bNode && nodeMap[nodeId] && nodeMap[nodeId].load > 0) {
      pathDp += 50000; // 50 kPa Hausstation / verfügbare Regelreserve
    }
    if (pathDp > maxPathDp) {
      maxPathDp = pathDp;
      maxPathNode = nodeId;
    }
  });

  // Pumpenparameter
  const foerderhoehePa = maxPathDp; // Pa
  const foerderhoeheMWS = foerderhoehePa / 9810; // mWS (Meter Wassersäule)
  const foerderhoeheBar = foerderhoehePa / 100000; // bar
  // Volumenstrom an der Zentrale (gesamter Netzvolumenstrom)
  const zentraleEdges = window.netzEdges.filter(e => e.u === zId || e.v === zId);
  const totalLoadKW = zentraleEdges.reduce((s, e) => s + (e.load || 0), 0);
  const mDotGesamt = totalLoadKW / (cp * dt); // kg/s
  const vDotGesamt = mDotGesamt / rhoWater; // m³/s
  // Pumpenleistung: P = (V̇ * Δp) / η_pumpe
  // Gesamtwirkungsgrad (Motor × Hydraulik × Mechanik) leistungsabhängig gestaffelt
  // Quellen: Wilo/Grundfos Datenblätter, Hocheffizienz-Nassläufer IE4/IE5
  const pHydraulisch = vDotGesamt * foerderhoehePa; // hydraulische Leistung [W]
  const pHydKW = pHydraulisch / 1000;
  let etaPumpe;
  if (pHydKW < 0.1)       etaPumpe = 0.25; // Kleinstpumpen (< 100 W hydr.)
  else if (pHydKW < 0.5)  etaPumpe = 0.40; // kleine Umwälzpumpen
  else if (pHydKW < 2)    etaPumpe = 0.55; // kleine Nahwärmenetze
  else if (pHydKW < 10)   etaPumpe = 0.65; // mittlere Netze
  else if (pHydKW < 50)   etaPumpe = 0.73; // größere Quartiere
  else if (pHydKW < 200)  etaPumpe = 0.78; // große Netze, optimaler Betriebspunkt
  else                     etaPumpe = 0.82; // Großpumpen (> 200 kW hydr.)

  const pumpenLeistungW = pHydraulisch / etaPumpe;
  const pumpenLeistungKW = pumpenLeistungW / 1000;

  // Ergebnisse am recalcNetz-Scope verfügbar machen
  window._netzPumpe = {
    kritPfadDp: foerderhoehePa,
    foerderhoeheMWS: foerderhoeheMWS,
    foerderhoeheBar: foerderhoeheBar,
    pumpenLeistungKW: pumpenLeistungKW,
    etaPumpe: etaPumpe,
    mDotGesamt: mDotGesamt,
    vDotGesamt: vDotGesamt * 3600, // m³/h
    maxPathNode: maxPathNode
    ,dpExceededCount: window.netzEdges.filter(edge => edge.dpExceeded).length
    ,bottleneckCount: window.netzEdges.filter(edge => edge.hydraulicBottleneck).length
  };

  // readNum statt parseFloat: parseFloat liefert bei leerem Feld NaN, und
  // `NaN ?? fallback` greift NICHT (NaN ist nicht nullish) → Verluste würden NaN
  const tMittel = readNum('netz-t-mittel', 10, -20, 30);
  // KMR liegt im Erdreich: Spitzenverluste gegen Winter-Erdreichtemperatur
  // (~3–5 °C in 0,8–1 m Tiefe), NICHT gegen die Auslegungs-Lufttemperatur (−12 °C) —
  // sonst werden die Verluste um ~25 % überschätzt.
  const tErdreich = readNum('netz-t-erdreich', 4, -20, 20);
  const uWertBase = parseFloat(document.getElementById('netz-u-wert').value) || 0.25;
  const tMeanPipe = (vlTemp + rlTemp) / 2;
  const deltaT = tMeanPipe - tErdreich;
  const deltaTMittel = tMeanPipe - tMittel;

  let totalLossKW = 0;
  window.netzEdges.forEach(e => {
    if (e.load > 0 && e.length > 0) {
      // DN-abhängiger U-Wert (größere Rohre besser gedämmt)
      const uWert = getUWertForDN(e.dn, uWertBase);
      e.lossKW = uWert * e.length * deltaT / 1000;
      e.lossKW_annual = uWert * e.length * deltaTMittel / 1000;
      e.lossPerM = uWert * deltaT;
      e._uWert = uWert;  // für Tooltip
      totalLossKW += e.lossKW;
    } else {
      e.lossKW = 0;
      e.lossKW_annual = 0;
      e.lossPerM = 0;
      e._uWert = 0;
    }
  });

  const totalLossKW_annual = window.netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0);
  const totalLossJahrMWh = totalLossKW_annual * 8.76;
  // Zentrale Verlustquelle für Lastgang und Kennzahlen. Sobald ein
  // berechnetes Netz existiert, ersetzt dieser leitungsgenaue Jahreswert den
  // pauschalen Prozentansatz aus den Wärme-Grundlagendaten.
  window._netzAnnualLossMWh = totalLossJahrMWh;
  const connectedIds = new Set(window.netzEdges.flatMap(e => [e.u, e.v]));
  const totalVerbrauchMWh = gebaeude.filter(g => connectedIds.has(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const totalErzeugungMWh = totalLossJahrMWh + totalVerbrauchMWh;
  const lossPct = totalVerbrauchMWh > 0 ? (totalLossJahrMWh / totalErzeugungMWh * 100).toFixed(1) : '—';
  const lossDisp = document.getElementById('netz-loss-display');
  if (lossDisp) lossDisp.textContent = `Netzverluste: ${totalLossKW.toFixed(1)} kW | ${totalLossJahrMWh.toFixed(0)} MWh/a (${lossPct} % der Erzeugung) | ΔT: ${deltaT.toFixed(0)} K`;
  const summaryDiv = document.getElementById('netz-summary');
  if (summaryDiv) {
    if (totalVerbrauchMWh > 0) {
      summaryDiv.style.display = 'grid';
      summaryDiv.innerHTML = `<span style="color:var(--muted)">Gebäudebedarf</span><span>${totalVerbrauchMWh.toFixed(0)} MWh/a</span><span style="color:var(--muted)">+ Netzverluste</span><span style="color:#f9a825">${totalLossJahrMWh.toFixed(0)} MWh/a</span><span style="color:var(--muted);border-top:1px solid var(--border);padding-top:3px;margin-top:2px">= Zentrale erzeugt</span><span style="color:var(--accent);font-weight:bold;border-top:1px solid var(--border);padding-top:3px;margin-top:2px">${totalErzeugungMWh.toFixed(0)} MWh/a</span>`;
    } else {
      summaryDiv.style.display = 'none';
    }
  }

  nodeMap[zId].tempIn = vlTemp;

  for(let i = 0; i < order.length; i++){
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if(pInfo){
      const edge = pInfo.e;
      const mDot = edge.load / (cp * dt); 
      let drop = 0;
      // lossKW umfasst VL+RL (U-Wert gilt für beide Leitungen) —
      // den Vorlauf kühlt nur der VL-Anteil (~50 %)
      if (mDot > 0.001) drop = (edge.lossKW * 0.5) / (mDot * cp);
      
      const rawTempOut = nodeMap[pInfo.pNodeId].tempIn - drop;
      edge.tempIn = nodeMap[pInfo.pNodeId].tempIn;
      edge.tempOut = rawTempOut;
      edge.thermischKritisch = rawTempOut < rlTemp;
      nodeMap[curr].tempIn = Math.max(rawTempOut, tErdreich);

      const bC = gebMap.get(curr);
      if(bC) bC.tempIn = nodeMap[curr].tempIn;
    }
  }

  // Per-Gebäude: zugerechnete Netzverluste (proportional nach Wärmestromanteil)
  gebaeude.forEach(g => { g.netzVerlustKW = null; g.netzVerlustRatioPct = null; g.netzVerlustJahrMWh = null; });
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    const g = gebMap.get(nodeId);
    if (!g) return;
    const bLoad = getComputedStats(g, globalYear).heizlast || 0;
    if (bLoad <= 0) return;
    let attributed = 0;
    let attributedAnnual = 0;
    let curr = nodeId;
    while (parentEdge[curr]) {
      const edge = parentEdge[curr].e;
      if (edge.loadRaw > 0 && edge.lossKW > 0) {
        const frac = bLoad / edge.loadRaw;
        attributed += edge.lossKW * frac;
        attributedAnnual += (edge.lossKW_annual || edge.lossKW) * frac;
      }
      curr = parentEdge[curr].pNodeId;
    }
    g.netzVerlustKW = Math.round(attributed * 100) / 100;
    g.netzVerlustJahrMWh = Math.round(attributedAnnual * 8.76 * 10) / 10;
    const waermeJahr = parseFloat(g.waerme) || 0;
    g.netzVerlustRatioPct = waermeJahr > 0 ? Math.round(g.netzVerlustJahrMWh / waermeJahr * 1000) / 10 : null;
  });

  // Kosten vorab berechnen (wird für Subtree-Analyse benötigt)
  window.netzEdges.forEach(e => {
    if ((e.load > 0 || e.loadRaw > 0) && e.dn > 0) {
      e.kosten = getKostenProM(e.dn, e.kostKlasse) * e.length;
    } else {
      e.kosten = 0;
    }
  });

  // ── Subtree-WLD + Wirtschaftlichkeit pro Kante ──────────────────────────
  // Für jede Kante: welche Wärme + Länge liegt im Subtree dahinter?
  const VBH = getNetzVBH(); // echte VBH aus Lastgang, Fallback 1800 h/a
  const subtreeLoad = {};   // nodeId → kW im Subtree (inkl. eigener Last)
  const subtreeLength = {}; // nodeId → Trassenmeter ab hier
  const subtreeKosten = {}; // nodeId → Investition im Subtree
  const subtreeLoss = {};   // nodeId → jährliche Verluste im Subtree (MWh)

  // Init: jeder Knoten = eigene Last
  Object.keys(nodeMap).forEach(k => {
    subtreeLoad[k] = nodeMap[k].load;
    subtreeLength[k] = 0;
    subtreeKosten[k] = 0;
    subtreeLoss[k] = 0;
  });

  // Rückwärts akkumulieren (Blätter → Wurzel)
  for (let i = order.length - 1; i > 0; i--) {
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if (!pInfo) continue;
    const edge = pInfo.e;
    const parent = pInfo.pNodeId;
    subtreeLoad[parent]   += subtreeLoad[curr];
    subtreeLength[parent] += subtreeLength[curr] + edge.length;
    subtreeKosten[parent] += subtreeKosten[curr] + (edge.kosten || 0);
    subtreeLoss[parent]   += subtreeLoss[curr] + (edge.lossKW_annual || 0) * 8.76;
  }

  // Auf Kanten übertragen: Subtree-Werte = Werte des Kindknotens
  window.netzEdges.forEach(e => { e.subtreeWLD = 0; e.subtreeKosten = 0; e.subtreeDeltaWGK = 0; e.subtreeConsumers = 0; e.subtreeWaermeMWh = 0; e.subtreeLength = 0; });
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    const edge = parentEdge[nodeId].e;
    const stLen = subtreeLength[nodeId] + edge.length;
    const stLoadKW = subtreeLoad[nodeId];
    const stWaerme = stLoadKW * VBH / 1000;
    edge.subtreeWLD = stLen > 0 ? stWaerme / stLen : 0;
    edge.subtreeKosten = subtreeKosten[nodeId] + (edge.kosten || 0);
    edge.subtreeWaermeMWh = stWaerme;
    edge.subtreeLength = stLen;
    edge.subtreeLoss = subtreeLoss[nodeId] + (edge.lossKW_annual || 0) * 8.76;
    // Verbraucher zählen
    let consumers = 0;
    const countSub = (nId) => {
      if (nId !== zId && nodeMap[nId] && nodeMap[nId].load > 0) consumers++;
      if (nodeMap[nId]) nodeMap[nId].adj.forEach(a => { if (parentEdge[a.to] && parentEdge[a.to].pNodeId === nId) countSub(a.to); });
    };
    countSub(nodeId);
    edge.subtreeConsumers = consumers;
  });

  // ── Strang-Netzkosten-Zuschlag (€/MWh) ─────────────────────────────────
  // "Was kostet es zusätzlich zur Erzeugung, diesen Strang über das Netz zu versorgen?"
  // Bestand (networkLocked): nur laufende Verlustkosten (Rohre sind schon bezahlt)
  // Neubau (!networkLocked): Rohr-Annuität + Verlustkosten
  const _netzZins = (parseFloat(document.getElementById('wirt-zins')?.value) || 2.7) / 100;
  const _netzN = 50;  // Nutzungsdauer Wärmenetz nach VDI 2067 (konsistent mit Wirtschaftlichkeits-Panel)
  const annFaktor = _netzZins > 0 ? _netzZins * Math.pow(1 + _netzZins, _netzN) / (Math.pow(1 + _netzZins, _netzN) - 1) : 1 / _netzN;
  // Erzeugungskosten an der Zentrale (€/MWh) – für Verlustbewertung
  const wgkZentraleEl = document.getElementById('fs-wgk');
  const wgkZentrale = parseFloat(wgkZentraleEl?.textContent) || 80;

  window.netzEdges.forEach(e => {
    if (e.subtreeWaermeMWh > 0) {
      const strangVerlustKosten = (e.subtreeLoss || 0) * wgkZentrale;  // MWh/a × €/MWh = €/a

      let strangJahrKosten;
      if (networkLocked) {
        // Bestandsnetz: Rohre bereits verlegt → nur Verlustkosten relevant
        strangJahrKosten = strangVerlustKosten;
      } else {
        // Neubaunetz: Rohr-Annuität + Verlustkosten
        const strangAnnuitaet = e.subtreeKosten * annFaktor;  // €/a
        strangJahrKosten = strangAnnuitaet + strangVerlustKosten;
      }

      e._strangNetzZuschlag = strangJahrKosten / e.subtreeWaermeMWh;  // €/MWh
      // Verlust-Ratio: Subtree-Verluste / Subtree-Wärmebedarf
      e._strangVerlustRatio = e.subtreeWaermeMWh > 0 ? (e.subtreeLoss || 0) / e.subtreeWaermeMWh : 0;
    } else {
      e._strangNetzZuschlag = 0;
      e._strangVerlustRatio = 0;
    }
  });

  window.netzEdges.forEach(e => {
    const targetLayer = e.hitLayer || e.layer;
    e.temporallyHidden = (e.visibleFromYear != null && globalYear < e.visibleFromYear) ||
      (e.visibleUntilYear != null && globalYear >= e.visibleUntilYear);

    if(e.load > 0){
      const actualArea = Math.PI * Math.pow((e.dn / 1000) / 2, 2);
      const mDot = e.load / (cp * dt); 
      const actualVel = (mDot / rhoWater) / actualArea;
      const allowedVelocity = e.velocityLimit || getVFlowForDN(e.dn,vFlow);
      const maxMDot = actualArea * allowedVelocity * rhoWater;
      const maxLoad = maxMDot * cp * dt;
      const auslastung = (e.load / maxLoad) * 100;
      e.utilizationPct = auslastung;

      const wld = getWLD(e);
      const wldColor = getWLDColor(wld);
      const w = Math.max(1.5, Math.min(5, 1 + e.dn / 50));

      let pColor = getEdgeColor(e, vlTemp, dt, vFlow);
      if (networkLocked && auslastung > 110) pColor = '#f44336';
      if (e.dpExceeded) pColor = '#f44336';

      const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
      e.layer.setStyle({weight: dim ? 2 : w, color: pColor, opacity: dim ? 0.2 : 0.8});

      // Kosten berechnen (per-edge override oder globales Szenario)
      const kostenProM = getKostenProM(e.dn, e.kostKlasse);
      const kostenGesamt = kostenProM * e.length;
      e.kosten = kostenGesamt;
      // Badge-Farbe für Kostenklasse
      const kBadgeColor = {niedrig:'#4caf50',mittel:'#4fc3f7',hoch:'#e53935'}[e.kostKlasse||kostenSzenario]||'#4fc3f7';

      const _m = '<span style="color:var(--muted);font-size:9px">';
      const _me = '</span>';
      const _sep = '<div style="border-top:1px solid #444;margin:5px 0 4px;padding-top:4px;">';
      const _grp = (icon, title) => `${_sep}<span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.04em">${icon} ${title}</span></div>`;

      // ── 1. LEITUNG ──
      let ttHtml = _grp('', 'Leitung');
      ttHtml += `KMR DN ${e.dn} · ${Math.round(e.length)} m<br>`;
      // Normheizlast (Summe aller Gebäude hinter diesem Abschnitt)
      if (wGzfMethode !== 'keine' && e._nVerbraucher > 1) {
        ttHtml += `Normheizlast (Σ ${e._nVerbraucher} Gebäude): ${e.loadRaw.toFixed(1)} kW<br>`;
        ttHtml += `Auslegungslast (GZF ${e._gzf.toFixed(2)}): <span style="font-weight:normal;color:var(--accent)">${e.load.toFixed(1)} kW</span><br>`;
        ttHtml += `${_m}GZF berücksichtigt, dass nie alle Gebäude gleichzeitig Volllast heizen${_me}<br>`;
      } else {
        ttHtml += `Last (Σ ${e._nVerbraucher} Gebäude): ${e.load.toFixed(1)} kW<br>`;
      }
      const utilizationColor = auslastung <= 80 ? '#4caf50' : auslastung <= 100 ? '#f9a825' : '#f44336';
      ttHtml += `Leitungsauslastung: <span style="color:${utilizationColor}">${auslastung.toFixed(1)} %</span> · ${actualVel.toFixed(2)} m/s<br>`;
      ttHtml += `${_m}Kapazität: ${maxLoad.toFixed(0)} kW bei ${allowedVelocity.toFixed(2)} m/s zulässiger Zielgeschwindigkeit${_me}<br>`;
      if (!networkLocked && e.designYear != null) {
        ttHtml += `${_m}Dimensioniert für ${e.designLoad.toFixed(1)} kW im maßgebenden Jahr ${e.designYear}${_me}<br>`;
      }
      if (networkLocked) {
        if (e.hydraulicBottleneck) {
          ttHtml += `<span style="color:#f44336">⚠ Hydraulischer Engpass im Bestandsnetz</span><br>`;
        }
      }

      // ── 2. THERMIK ──
      if (e.lossKW !== undefined && e.tempOut !== undefined) {
        ttHtml += _grp('', 'Wärmetransport');
        // Verluste dieses Abschnitts
        const lossJahrMwh = (e.lossKW_annual || e.lossKW) * 8.76;
        const lossPctEdge = e.loadRaw > 0 ? (e.lossKW / e.loadRaw * 100) : 0;
        ttHtml += `Wärmeverlust: ${e.lossKW.toFixed(1)} kW (${e.lossPerM.toFixed(1)} W/m)<br>`;
        ttHtml += `${_m}${lossJahrMwh.toFixed(1)} MWh/a gehen auf ${Math.round(e.length)} m durch die Rohrdämmung verloren (${lossPctEdge.toFixed(1)} % der transportierten Leistung)${_me}<br>`;
        // Temperatur
        ttHtml += `Temperatur: ${e.tempIn.toFixed(1)} → ${e.tempOut.toFixed(1)} °C (−${(e.tempIn - e.tempOut).toFixed(1)} K)<br>`;
        ttHtml += `${_m}Vorlauf kühlt auf dem Weg zum Verbraucher ab${_me}<br>`;
        if (e.thermischKritisch) {
          ttHtml += `<span style="color:#f44336;font-size:10px;">⚠ Ankunftstemperatur unter Rücklauf — Strang nicht versorgbar!</span><br>`;
        } else if (e.tempOut < 60) {
          ttHtml += `<span style="color:#f44336;font-size:10px;">⚠ Temp. unter 60 °C — Legionellengefahr</span><br>`;
        }
        // Druckverlust
        if (e.dpPerM > 0) {
          const dpRatio = e.dpPerM / (e.dpLimit || dpLimitMain);
          const dpColor = dpRatio <= 1 ? '#4caf50' : dpRatio <= 1.2 ? '#f9a825' : '#e53935';
          ttHtml += `Druckverlust: <span style="color:${dpColor}">${e.dpPerM.toFixed(0)} Pa/m</span> · Grenzwert ${Math.round(e.dpLimit || dpLimitMain)} Pa/m<br>`;
          ttHtml += `${_m}${e.isHouseConnection ? 'Hausanschluss' : 'Netzleitung'} · ${(e.dpTotal/1000).toFixed(1)} kPa für Vor- und Rücklauf${_me}<br>`;
          ttHtml += `${_m}Reibungsverlust im Rohr, bestimmt die benötigte Pumpenleistung${_me}<br>`;
        }
      }

      // ── 3. WIRTSCHAFTLICHKEIT ──
      ttHtml += _grp('', 'Wirtschaftlichkeit');
      ttHtml += `Kosten: ${kostenProM.toLocaleString('de-DE')} €/m (${kostenSzenario}) → <span style="color:#4fc3f7">${Math.round(kostenGesamt).toLocaleString('de-DE')} €</span><br>`;
      const wldLabel = wld < 0.5 ? '⚠ unwirtschaftlich' : wld < 1.0 ? 'grenzwertig' : wld < 2.0 ? 'wirtschaftlich' : '✓ sehr wirtschaftlich';
      ttHtml += `WLD: <span style="color:${wldColor}">${wld.toFixed(2)} MWh/(m·a)</span> — ${wldLabel}<br>`;
      ttHtml += `${_m}Wärmeliniendichte: transportierte Jahreswärme pro Meter Trasse${_me}<br>`;

      // ── 4. STRANG AB HIER ──
      if (e.subtreeWaermeMWh > 0) {
        const swldColor = getWLDColor(e.subtreeWLD);
        const verlustPct = (e._strangVerlustRatio * 100);
        const verlustColor = verlustPct < 5 ? '#4caf50' : verlustPct < 10 ? '#8bc34a' : verlustPct < 20 ? '#f9a825' : verlustPct < 40 ? '#ef6c00' : '#e53935';
        const nzColor = (e._strangNetzZuschlag || 0) <= 5 ? '#4caf50' : (e._strangNetzZuschlag || 0) <= 15 ? '#8bc34a' : (e._strangNetzZuschlag || 0) <= 30 ? '#f9a825' : (e._strangNetzZuschlag || 0) <= 60 ? '#ef6c00' : '#e53935';
        ttHtml += _grp('', `Strang ab hier${networkLocked ? ' (Bestand)' : ' (Neubau)'}`);
        ttHtml += `${e.subtreeConsumers} Verbraucher · ${Math.round(e.subtreeLength)} m · ${e.subtreeWaermeMWh.toFixed(0)} MWh/a<br>`;
        ttHtml += `Strang-WLD: <span style="color:${swldColor}">${e.subtreeWLD.toFixed(2)} MWh/(m·a)</span><br>`;
        ttHtml += `${_m}Wirtschaftlichkeit des gesamten Teilnetzes hinter diesem Punkt${_me}<br>`;
        ttHtml += `Verluste: <span style="color:${verlustColor}">${verlustPct.toFixed(1)} %</span> der Strang-Wärme<br>`;
        ttHtml += `${_m}Anteil der Wärme, der auf dem Weg zu den Verbrauchern verloren geht${_me}<br>`;
        if (!networkLocked) {
          ttHtml += `Investition: ${Math.round(e.subtreeKosten).toLocaleString('de-DE')} €<br>`;
        }
        ttHtml += `Netzkosten-Zuschlag: <span style="color:${nzColor}">${(e._strangNetzZuschlag || 0).toFixed(1)} €/MWh</span>`;
        if (networkLocked) {
          ttHtml += ` ${_m}(nur Verlustkosten)${_me}`;
        } else {
          ttHtml += `<br>${_m}Mehrkosten pro MWh durch Rohrbau (Annuität) + Wärmeverluste${_me}`;
        }
      }

      targetLayer.unbindTooltip();
      e.infoHtml = ttHtml;

      // Gradient
      if (netzColorMode === 'temp' || netzColorMode === 'abkuehlung') {
        drawEdgeGradient(e, vlTemp, dt, vFlow);
      } else {
        clearEdgeGradient(e);
      }

      // Warndreieck bei Überlastung
      const showWarn = netzEditMode && auslastung > 100;
      const midPt = getEdgeMidDisplayPt(e);
      if (showWarn) {
        if (!e.warnMarker) {
          const warnIcon = L.divIcon({className:'', html:'<div class="netz-warn-icon">⚠</div>', iconSize:[20,20], iconAnchor:[10,10]});
          e.warnMarker = L.marker(midPt, {icon: warnIcon, interactive: false, zIndexOffset: 2500});
          if (netzVisible) e.warnMarker.addTo(map);
        } else {
          e.warnMarker.setLatLng(midPt);
          if (netzVisible && !map.hasLayer(e.warnMarker)) e.warnMarker.addTo(map);
        }
      } else {
        if (e.warnMarker) { map.removeLayer(e.warnMarker); e.warnMarker = null; }
      }

    } else {
      e.utilizationPct = 0;
      clearEdgeGradient(e);
      if (e.warnMarker) { map.removeLayer(e.warnMarker); e.warnMarker = null; }
      const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
      e.layer.setStyle({weight: 2, color: '#999', dashArray: '6, 4', opacity: dim ? 0.2 : 0.8});
      targetLayer.unbindTooltip();
      e.infoHtml = '<span style="font-weight:normal">0 kW (inaktiv/Ringleitung)</span>';
    }

    // midMarker position aktualisieren (wenn kein manueller Waypoint)
    if (e.midMarker) {
      e.midMarker.setLatLng(getEdgeMidDisplayPt(e));
    }
    const temporalLayers = [e.layer,e.hitLayer,e.midMarker,e.warnMarker,
      ...(e.waypointMarkers || []),...(e.segLayers || [])].filter(Boolean);
    if (e.temporallyHidden || !netzVisible) {
      temporalLayers.forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
    } else {
      [e.layer,e.hitLayer,...(e.segLayers || [])].filter(Boolean).forEach(layer => {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      });
      if (netzEditMode) [e.midMarker,...(e.waypointMarkers || [])].filter(Boolean).forEach(layer => {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      });
    }
  });

  updateStrandDropdown();
  updateStrangReport();
  updateNetzColorLegend();
  updateRohrListe();
  if (currentMode === 'verlust') updateViz();
  if (fliessgewaesser) redrawFliessgewaesser();
  if (gasKessel) redrawGasKessel();
  cacheVariantResults();
  // Die bewegten Leitungsstriche visualisieren den Wärmefluss. Bearbeitungs-
  // punkte und Haupttrasse bleiben davon unabhängig in der ruhigen Ansicht aus.
  if (!netzMotionless && window.netzEdges.some(edge => edge.load > 0)) startAnimPipes();
  else stopAnimPipes();
  refreshNetzFlowArrows();
}

export function updateStrandDropdown() {
  const sel = document.getElementById('netz-strang');
  if (!sel) return;
  const strands = [...new Set(window.netzEdges.map(e => e.strandId).filter(id => id != null))].sort((a,b)=>a-b);
  const current = sel.value === '' ? null : parseInt(sel.value, 10);
  sel.innerHTML = '<option value="">Alle Stränge</option>' + strands.map(i => `<option value="${i}" ${current === i ? 'selected' : ''}>Strang ${i + 1}</option>`).join('');
}

export function updateStrangReport() {
  const el = document.getElementById('strang-report');
  if (!el) return;
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if (!zId || window.netzEdges.length === 0) { el.style.display = 'none'; return; }

  // Strang-Wurzelkanten finden (direkt an Zentrale angeschlossen)
  const wurzelKanten = window.netzEdges.filter(e => (e.u === zId || e.v === zId) && e.load > 0);
  if (wurzelKanten.length === 0) { el.style.display = 'none'; return; }

  // Strangdaten sammeln
  const straenge = wurzelKanten.map(e => {
    const verlustPct = e.subtreeWaermeMWh > 0 ? ((e.subtreeLoss || 0) / e.subtreeWaermeMWh * 100) : 0;
    const netzZuschlag = e._strangNetzZuschlag || 0;
    // Ampel: grün ≤15, gelb ≤40, rot >40 €/MWh
    let ampel = 'g';
    if (netzZuschlag > 40) ampel = 'r';
    else if (netzZuschlag > 15) ampel = 'y';
    return {
      id: e.strandId,
      waerme: e.subtreeWaermeMWh || 0,
      trasse: e.subtreeLength || 0,
      invest: e.subtreeKosten || 0,
      verlust: e.subtreeLoss || 0,
      verlustPct,
      zuschlag: netzZuschlag,
      consumers: e.subtreeConsumers || 0,
      wld: e.subtreeWLD || 0,
      ampel
    };
  }).sort((a, b) => a.id - b.id);

  const fmtD = (v, d) => v.toLocaleString('de-DE', {minimumFractionDigits: d, maximumFractionDigits: d});
  const ampelCol = {g:'#4caf50', y:'#ffa000', r:'#e53935'};
  const ampelTxt = {g:'wirtschaftlich', y:'grenzwertig', r:'unwirtschaftlich'};

  let h = '<div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:6px;">Strang-Bewertung</div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:9px;font-family:\'DM Mono\',monospace;">';
  h += '<thead><tr style="color:var(--muted);border-bottom:1px solid var(--border);">';
  h += '<th style="text-align:left;padding:2px 4px;font-weight:normal;"></th>';
  h += '<th style="text-align:left;padding:2px 3px;font-weight:normal;">Strang</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">Geb.</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">MWh/a</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">Trasse m</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">Verlust</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">€/MWh</th>';
  h += '</tr></thead><tbody>';

  straenge.forEach(s => {
    const col = ampelCol[s.ampel];
    const rowStyle = selectedStrandId === s.id ? 'background:rgba(255,255,255,0.05);' : '';
    h += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;${rowStyle}" `
       + `data-click="setSelectedStrandId(${s.id});document.getElementById('netz-strang').value='${s.id}';updateNetzStrandVisibility();" `
       + `title="${ampelTxt[s.ampel]}: ${fmtD(s.zuschlag,0)} €/MWh Netzkosten, ${fmtD(s.verlustPct,1)}% Verluste">`;
    h += `<td style="padding:3px 4px;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};"></span></td>`;
    h += `<td style="padding:3px 3px;color:var(--text);">${s.id + 1}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;">${s.consumers}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;">${fmtD(s.waerme, 0)}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;">${fmtD(s.trasse, 0)}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;color:${s.verlustPct > 15 ? '#e53935' : s.verlustPct > 8 ? '#ffa000' : 'var(--muted)'};">${fmtD(s.verlustPct, 1)}%</td>`;
    h += `<td style="padding:3px 3px;text-align:right;font-weight:600;color:${col};">${fmtD(s.zuschlag, 0)}</td>`;
    h += '</tr>';
  });

  // Gesamtzeile
  const totW = straenge.reduce((s, x) => s + x.waerme, 0);
  const totV = straenge.reduce((s, x) => s + x.verlust, 0);
  const totL = straenge.reduce((s, x) => s + x.trasse, 0);
  const totI = straenge.reduce((s, x) => s + x.invest, 0);
  const totVPct = totW > 0 ? totV / totW * 100 : 0;
  h += `<tr style="border-top:1px solid var(--border);color:var(--text);font-weight:600;">`;
  h += `<td colspan="2" style="padding:3px 4px;">Σ</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${straenge.reduce((s,x)=>s+x.consumers,0)}</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${fmtD(totW, 0)}</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${fmtD(totL, 0)}</td>`;
  h += `<td style="padding:3px 3px;text-align:right;color:${totVPct > 15 ? '#e53935' : totVPct > 8 ? '#ffa000' : 'var(--muted)'};">${fmtD(totVPct, 1)}%</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${fmtD(totI, 0)} €</td>`;
  h += '</tr>';

  h += '</tbody></table>';
  el.innerHTML = h;
  el.style.display = 'block';
}

export function updateNetzStrandVisibility() {
  const vlTemp = parseFloat(document.getElementById('netz-vl')?.value) || 90;
  const rlTemp = parseFloat(document.getElementById('netz-rl')?.value) || 60;
  const dt = Math.max(1, vlTemp - rlTemp);
  const vFlow = parseFloat(document.getElementById('netz-v')?.value) || 1.0;
  const stromMode = (currentMode === 'strom');
  window.netzEdges.forEach(e => {
    const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
    // Gleiche Dickenformel wie recalcNetz/drawEdgeGradient — sonst springt die
    // Liniendicke beim Moduswechsel Wärme↔Strom auf klobige Werte
    const w = Math.max(1.5, Math.min(5, 1 + (e.dn||0) / 50));
    if (e.segLayers && e.segLayers.length > 0) {
      e.segLayers.forEach(s => s.setStyle({opacity: stromMode ? 0.1 : (dim ? 0.2 : 0.85), weight: dim ? 2 : w}));
      e.layer.setStyle({opacity: 0});
    } else if (e.load > 0) {
      const pColor = stromMode ? '#546e7a' : getEdgeColor(e, vlTemp, dt, vFlow);
      e.layer.setStyle({weight: dim ? 2 : w, color: pColor, opacity: stromMode ? 0.15 : (dim ? 0.2 : 0.8)});
    } else {
      e.layer.setStyle({weight: 2, color: '#999', dashArray: '6, 4', opacity: stromMode ? 0.1 : (dim ? 0.2 : 0.8)});
    }
  });
}

export function updateRohrListe() {
  const container = document.getElementById('bom-container');
  const content = document.getElementById('bom-content');
  
  const rohre = {};
  let totalLength = 0;
  let totalKosten = 0;
  window.netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      if (!rohre[e.dn]) rohre[e.dn] = { length: 0, kosten: 0 };
      rohre[e.dn].length += e.length;
      const kEdge = getKostenProM(e.dn, e.kostKlasse) * e.length;
      rohre[e.dn].kosten += kEdge;
      totalLength += e.length;
      totalKosten += kEdge;
    }
  });

  if (Object.keys(rohre).length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Netz-WLD = Summe Verbraucher-Jahreswärme / Gesamttrassenlänge
  // (nicht Summe Kantenlast, da Stammleitung akkumulierte Last trägt)
  const connIds = new Set(window.netzEdges.flatMap(e => [e.u, e.v]));
  const totalConsumerKW = gebaeude.filter(g => connIds.has(g.id))
    .reduce((s, g) => s + (getComputedStats(g, globalYear).heizlast || 0), 0);
  const totalWaerme = totalConsumerKW * 1800 / 1000;
  const wldGesamt = totalLength > 0 ? totalWaerme / totalLength : 0;
  const wldColor = getWLDColor(wldGesamt);
  const szenarioLabel = {niedrig:'Niedrig',mittel:'Mittel',hoch:'Hoch'}[kostenSzenario];
  
  let html = `
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="flex:1;background:var(--surface2);border-radius:4px;padding:6px 8px;border:1px solid var(--border);">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Gesamtkosten (${szenarioLabel})</div>
        <div style="font-size:15px;font-family:'DM Mono',monospace;color:#4fc3f7;margin-top:2px">${Math.round(totalKosten).toLocaleString('de-DE')} €</div>
      </div>
      <div style="flex:1;background:var(--surface2);border-radius:4px;padding:6px 8px;border:1px solid var(--border);">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Ø WLD Gesamtnetz</div>
        <div style="font-size:15px;font-family:'DM Mono',monospace;color:${wldColor};margin-top:2px">${wldGesamt.toFixed(2)} MWh/(m·a)</div>
      </div>
    </div>
    <table class="bom-table">
      <thead><tr><th>DN (mm)</th><th>Länge (m)</th><th>€/m</th><th>Kosten (€)</th></tr></thead>
      <tbody>`;
  
  Object.keys(rohre).sort((a,b) => Number(a) - Number(b)).forEach(dn => {
    const r = rohre[dn];
    const euM = getKostenProM(Number(dn));
    html += `<tr>
      <td>KMR DN ${dn}</td>
      <td>${Math.round(r.length)}</td>
      <td>${euM.toLocaleString('de-DE')}</td>
      <td style="color:#4fc3f7">${Math.round(r.kosten).toLocaleString('de-DE')}</td>
    </tr>`;
  });
  
  html += `<tr>
    <th>Gesamt</th>
    <th>${Math.round(totalLength)}</th>
    <th>—</th>
    <th style="color:#4fc3f7">${Math.round(totalKosten).toLocaleString('de-DE')}</th>
  </tr>`;
  html += `</tbody></table>`;
  
  content.innerHTML = html;
}

export function exportRohreCSV() {
  const rohre = {};
  window.netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      if (!rohre[e.dn]) rohre[e.dn] = { length: 0, kosten: 0 };
      rohre[e.dn].length += e.length;
      rohre[e.dn].kosten += getKostenProM(e.dn) * e.length;
    }
  });
  
  let csvContent = `DN (mm);Laenge (m);Euro_pro_m (${kostenSzenario});Kosten (EUR)\n`;
  Object.keys(rohre).sort((a,b) => Number(a) - Number(b)).forEach(dn => {
    const r = rohre[dn];
    csvContent += `${dn};${Math.round(r.length)};${getKostenProM(Number(dn))};${Math.round(r.kosten)}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "rohrnetz_auszug.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function toggleDrawEdge(){
  if (!window.isDrawingEdge && !ensureWaermeNetzStructureEditable()) return false;
  window.isDrawingEdge = !window.isDrawingEdge;
  const btn = document.getElementById('btn-draw-edge');
  if(window.isDrawingEdge){
    beginInteraction({id:'draw-heat-edge',label:'Wärmeleitung verbinden',hint:'Ersten und zweiten Anschluss anklicken.',cancel:()=>{ if (window.isDrawingEdge) toggleDrawEdge(); }});
    btn.classList.add('active');
    showHint('Klicke auf das erste Gebäude für die Leitung.');
    setEdgeStartId(null);
    map.getContainer().style.cursor='crosshair';
  } else {
    cancelInteraction('draw-heat-edge');
    btn.classList.remove('active');
    hideHint();
    setEdgeStartId(null);
    map.getContainer().style.cursor='';
  }
  return window.isDrawingEdge;
}

export function startNetzEdgeFrom(id) {
  if (!window.isDrawingEdge) toggleDrawEdge();
  setEdgeStartId(id);
  showHint('Zweites Gebäude auf der Karte anklicken.');
}
export function ensureWaermeNetzStructureEditable() {
  return true;
}
