// ── 03b-netz.js — Netzplanung (Geothermie, Polygon-Zeichnen, Panel-Mgmt, OSM, Netzgraph, Strang-Report, Rohr-BOM) ──
// ── Geothermie-Sondenfeld ────────────────────────────────────────────────────
import { areaPolygon, gebaeude, globalYear, isDrawingTrasse, isExcluded, isPlacingLwWp, stromEmF, stromEmFLZ } from './01-globals-varianten.js';

let netzVisible = true;
import { getNetzVBH, updateNetzColorLegend } from './02a-netz-physik.js';
import { attachPolygonLayer, getComputedStats, map } from './02b-gebaeude.js';
import { clearArea, polygonAreaM2, toggleDrawTrasse, togglePlaceLwWp, updateViz } from './02c-karte-werkzeuge.js';
import { drillSvg, redrawErzeugerIcons, redrawVerbindungslinien } from './03a-erzeuger.js';
import { drawChart, hideHint, renderList, showHint, detectRoofAzimutFromPolygon } from './03c-gebaeude-io.js';
import { _hideForDraw, _restoreAfterDraw, autoAssignEdgeCosts } from './04a-ui-panels.js';
import { glLastgangKw } from './06a-gbi-lastgang.js';
import { readNum } from './lib/util.js';
import { moBeiAktivierung, moBeiDeaktivierung, updateAllDeckungen } from './06c-dispatch-core.js';
import { syncErzeugerElektroAsset, removeErzeugerElektroAsset, moveErzeugerElektroAsset, updateErzeugerAssetProps } from './13p-erzeuger-assets.js';
import { areaEditMarkers, areaLatLngs, cacheVariantResults, currentMode, drawPoints, edgeKey, edgeWaypoints, fliessgewaesser, gasKessel, geoThermie, networkLocked, netzPruningMode, trassePoints, trassePolyline, trasseSegments } from './01-globals-varianten.js';
import { addEdgeMidHandle, calcEdgeLength, clearEdgeGradient, drawEdgeGradient, getEdgeColor, getEdgeMidDisplayPt, getKostenProM, getUWertForDN, getVFlowForDN, getWLD, getWLDColor, kostenSzenario, netzColorMode, standardDNs } from './02a-netz-physik.js';
import { OSM_SKIP_TYPES, addGebaeude, osmNutzung } from './02b-gebaeude.js';
import { polygonCenter, redrawFliessgewaesser } from './02c-karte-werkzeuge.js';
import { redrawGasKessel } from './03a-erzeuger.js';
import { startAnimPipes, stopAnimPipes, updateTotals } from './03c-gebaeude-io.js';
import { closeEdgePopup, showEdgePopup, toggleEdgePruned } from './04a-ui-panels.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { setEdgeStartId, setSelectedStrandId, set_batchImporting } from './01-globals-varianten.js';
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
    btn.textContent = 'Klicke auf Karte…';
    btn.style.borderColor = '#4caf50';
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    showHint('Klicke auf die Karte, um das Sondenfeld zu platzieren.');
    document.getElementById('geo-panel').classList.remove('visible');
    document.getElementById('btn-geo-toggle')?.classList.remove('active');
  } else {
    btn.textContent = 'Auf Karte platzieren';
    btn.style.borderColor = '';
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
  }
}

export function placeGeoAt(latlng) {
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
  window.drawingId=id; window.drawPoints=[];
  showHint('Eckpunkte anklicken · Am Ende Startpunkt (rot) anklicken · Rechtsklick = Zurück');
  _hideForDraw();
  map.getContainer().style.cursor='crosshair';
  window.selectedId=id; renderList();
}

export function cancelDraw(){
  if(window.drawPolyline){map.removeLayer(window.drawPolyline);window.drawPolyline=null;}
  if(window.drawStartMarker){map.removeLayer(window.drawStartMarker);window.drawStartMarker=null;}
  window.drawingId=null;window.drawPoints=[];
  map.getContainer().style.cursor='';hideHint();
  _restoreAfterDraw();
}

export function finishDraw(){
  if(window.drawPoints.length < 3) return;
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
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
function _lockLayer(layer) {
  if (!layer) return;
  try { layer.editing.disable(); } catch (e) {}
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
  ov.layer = L.distortableImageOverlay(ov.url, { corners, opacity: ov.opacity }).addTo(map);
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
    if (imgEl) imgEl.style.pointerEvents = 'none';
  } else {
    try { layer.editing.enable(); } catch (e) {}
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
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
var _overpassServerNames = ['overpass-api.de', 'kumi.systems', 'maps.mail.ru'];
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

export function autoGenerateNetz(){
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if(!zId || isNaN(zId)){
    showHint('⚠ Bitte zuerst eine Heizzentrale auswählen!', 5000);
    // Dropdown hervorheben
    const sel = document.getElementById('netz-zentrale');
    if (sel) { sel.style.borderColor = '#e53935'; sel.style.boxShadow = '0 0 8px rgba(229,57,53,0.4)'; sel.focus(); setTimeout(() => { sel.style.borderColor = ''; sel.style.boxShadow = ''; }, 4000); }
    return;
  }

  clearNetz();

  const nodes = gebaeude.filter(g => g.polygon && getComputedStats(g, globalYear).heizlast > 0);
  if(nodes.length < 2) {
    showHint('Es müssen mindestens zwei Gebäude mit Verbrauch gezeichnet sein.');
    return;
  }

  const allPts = nodes.map(g => {
    const stats = getComputedStats(g, globalYear);
    return { id: g.id, type: 'geb', pt: polygonCenter(g.polygon), load: stats.heizlast||0 };
  });

  let tIdCounter = 10000;
  const tNodes = trassePoints.map(pt => ({ id: tIdCounter++, type: 'trasse', pt: pt, load: 0 }));
  allPts.push(...tNodes);

  const possibleEdges = [];
  for(let i=0; i<allPts.length; i++){
    for(let j=i+1; j<allPts.length; j++){
      if(allPts[i].type === 'trasse' && allPts[j].type === 'trasse') continue; 
      possibleEdges.push({ u: allPts[i].id, v: allPts[j].id, uNode: allPts[i], vNode: allPts[j], dist: allPts[i].pt.distanceTo(allPts[j].pt) });
    }
  }

  possibleEdges.sort((a, b) => a.dist - b.dist);

  const parent = {};
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

  // Trasse-Knoten segmentweise verbinden (Multi-Branch-Unterstützung)
  const segs = trasseSegments.length > 0 ? trasseSegments : (tNodes.length > 1 ? [{start: 0, end: tNodes.length - 1}] : []);
  segs.forEach(seg => {
    for (let i = seg.start; i < seg.end; i++) {
      const ni = i, nj = i + 1;
      if (ni < tNodes.length && nj < tNodes.length) {
        union(tNodes[ni].id, tNodes[nj].id);
        mstEdges.push({ u: tNodes[ni].id, v: tNodes[nj].id, uNode: tNodes[ni], vNode: tNodes[nj] });
      }
    }
  });

  for(const edge of possibleEdges) {
    if(union(edge.u, edge.v)) {
      mstEdges.push(edge);
    }
  }

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
      map.removeLayer(layer);
      map.removeLayer(hitLayer);
      if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
      if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
      if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
      window.netzEdges = window.netzEdges.filter(x => x !== edgeObj);
      closeEdgePopup();
      recalcNetz();
    });
    window.netzEdges.push(edgeObj);
    addEdgeMidHandle(edgeObj);
  });

  applyWaypoints();
  recalcNetz();
  autoAssignEdgeCosts();
  // Haupttrasse nach Netzgenerierung ausblenden
  if (trassePolyline) {
    if (Array.isArray(trassePolyline)) trassePolyline.forEach(p => p.setStyle({opacity: 0}));
    else trassePolyline.setStyle({opacity: 0});
  }
}

export function addNetzEdge(u, v){
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
    map.removeLayer(layer);
    map.removeLayer(hitLayer);
    if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
    if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
    if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
    window.netzEdges = window.netzEdges.filter(e => e !== edgeObj);
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
    map.removeLayer(layer); map.removeLayer(hitLayer);
    if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
    if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
    if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
    window.netzEdges = window.netzEdges.filter(e => e !== edgeObj);
    closeEdgePopup(); recalcNetz();
  });
  window.netzEdges.push(edgeObj);
  addEdgeMidHandle(edgeObj);
  return edgeObj;
}

export function connectGebToNearestPipe(g){
  if (!g || !g.polygon || !networkLocked) return false;
  if (!window.netzEdges || window.netzEdges.length === 0) return false;
  if (window.netzEdges.some(e => e.u === g.id || e.v === g.id)) return false; // schon angeschlossen

  const gc = polygonCenter(g.polygon);

  // Nächstgelegene Leitung + Lotfußpunkt suchen (Projektion auf das Segment)
  let best = null;
  for (const e of window.netzEdges) {
    if (e.pruned || !e.uNode || !e.vNode || !e.uNode.pt || !e.vNode.pt) continue;
    const A = e.uNode.pt, B = e.vNode.pt;
    const dLat = B.lat - A.lat, dLng = B.lng - A.lng;
    const denom = dLat * dLat + dLng * dLng;
    let t = denom === 0 ? 0 : ((gc.lat - A.lat) * dLat + (gc.lng - A.lng) * dLng) / denom;
    t = Math.max(0, Math.min(1, t));
    const foot = L.latLng(A.lat + t * dLat, A.lng + t * dLng);
    const d = gc.distanceTo(foot);
    if (!best || d < best.d) best = { e, foot, d };
  }
  if (!best) return false;

  const E = best.e;
  const gNode = { id: g.id, type: 'geb', pt: gc, load: 0 };
  const SNAP = 8; // m — Lotpunkt liegt praktisch auf einem Endknoten → dort direkt anschließen
  const dToU = best.foot.distanceTo(E.uNode.pt);
  const dToV = best.foot.distanceTo(E.vNode.pt);

  if (dToU < SNAP || dToV < SNAP) {
    const target = dToU <= dToV ? E.uNode : E.vNode;
    _makeNetzEdge(target, gNode, 0);
  } else {
    // Leitung am Lotpunkt splitten (Teilstücke behalten DN) + Stich zum Gebäude
    const jNode = { id: _nextJunctionId(), type: 'junction', pt: best.foot, load: 0 };
    const dn = E.dn || 0;
    map.removeLayer(E.layer);
    if (E.hitLayer) map.removeLayer(E.hitLayer);
    if (E.midMarker) map.removeLayer(E.midMarker);
    if (E.warnMarker) map.removeLayer(E.warnMarker);
    if (E.segLayers) E.segLayers.forEach(s => map.removeLayer(s));
    window.netzEdges = window.netzEdges.filter(x => x !== E);
    _makeNetzEdge(E.uNode, jNode, dn);
    _makeNetzEdge(jNode, E.vNode, dn);
    _makeNetzEdge(jNode, gNode, 0); // Stich → neue DN wird in recalcNetz dimensioniert
  }
  recalcNetz();
  return true;
}

export function clearNetz(){
  window.netzEdges.forEach(e => {
    map.removeLayer(e.layer);
    if(e.hitLayer) map.removeLayer(e.hitLayer);
    if(e.midMarker) map.removeLayer(e.midMarker);
    if(e.warnMarker) map.removeLayer(e.warnMarker);
    if(e.segLayers) e.segLayers.forEach(s => { if(map.hasLayer(s)) map.removeLayer(s); });
  });
  window.netzEdges = [];
  setSelectedStrandId(null);
  const sel = document.getElementById('netz-strang');
  if (sel) sel.value = '';
  updateRohrListe();
  gebaeude.forEach(g => delete g.tempIn);
}

export function applyWaypoints() {
  window.netzEdges.forEach(e => {
    const wp = edgeWaypoints[edgeKey(e.u, e.v)];
    if (!wp) return;
    e.waypoint = L.latLng(wp.lat, wp.lng);
    const ll = e.layer.getLatLngs();
    e.layer.setLatLngs([ll[0], e.waypoint, ll[ll.length - 1]]);
    if (e.hitLayer) e.hitLayer.setLatLngs([ll[0], e.waypoint, ll[ll.length - 1]]);
    if (e.midMarker) e.midMarker.setLatLng(e.waypoint);
  });
}

export function abklemmenGebaeude(id) {
  const toRemove = window.netzEdges.filter(e => e.u === id || e.v === id);
  toRemove.forEach(e => {
    if (map.hasLayer(e.layer)) map.removeLayer(e.layer);
    if (e.hitLayer && map.hasLayer(e.hitLayer)) map.removeLayer(e.hitLayer);
    if (e.midMarker) map.removeLayer(e.midMarker);
    if (e.warnMarker) map.removeLayer(e.warnMarker);
    if (e.segLayers) e.segLayers.forEach(s => { if(map.hasLayer(s)) map.removeLayer(s); });
  });
  window.netzEdges = window.netzEdges.filter(e => e.u !== id && e.v !== id);
  closeEdgePopup();
  recalcNetz();
  renderList();
}

export function setNetzVisible(visible) {
  netzVisible = visible;
  window.netzEdges.forEach(e => {
    const layers = [e.layer, e.hitLayer, e.midMarker, e.warnMarker, ...(e.segLayers||[])].filter(Boolean);
    layers.forEach(l => {
      if (visible) { if (!map.hasLayer(l)) map.addLayer(l); }
      else { if (map.hasLayer(l)) map.removeLayer(l); }
    });
  });
  // Beide Checkboxen synchron halten
  const cb1 = document.getElementById('netz-visible');
  const cb2 = document.getElementById('netz-visible-ansicht');
  if (cb1) cb1.checked = visible;
  if (cb2) cb2.checked = visible;
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
  const vFlow = parseFloat(document.getElementById('netz-v').value) || 1.0;

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
    if (e.pruned) { e.load = 0; e.loadRaw = 0; e.dn = 0; e.lossKW = 0; e.lossKW_annual = 0; return; }
    let uLoad = 0; if (e.uNode && e.uNode.type === 'geb') { const gu=gebMap.get(e.u); if(gu && !isExcluded(gu.id)) uLoad = getComputedStats(gu, globalYear).heizlast||0; }
    let vLoad = 0; if (e.vNode && e.vNode.type === 'geb') { const gv=gebMap.get(e.v); if(gv && !isExcluded(gv.id)) vLoad = getComputedStats(gv, globalYear).heizlast||0; }

    if(!nodeMap[e.u]) nodeMap[e.u] = { id: e.u, load: uLoad, adj: [] };
    if(!nodeMap[e.v]) nodeMap[e.v] = { id: e.v, load: vLoad, adj: [] };

    nodeMap[e.u].adj.push({ to: e.v, edge: e, ptTo: (e.vNode?e.vNode.pt:null) });
    nodeMap[e.v].adj.push({ to: e.u, edge: e, ptTo: (e.uNode?e.uNode.pt:null) });
  });

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
          const wpt = pInfo.e.waypoint;
          const newPts = wpt ? [ptP, wpt, ptC] : [ptP, ptC];
          pInfo.e.layer.setLatLngs(newPts);
          if(pInfo.e.hitLayer) pInfo.e.hitLayer.setLatLngs(newPts);
      }
      // Länge aktualisieren (echte Polyline-Länge inkl. Waypoints)
      pInfo.e.length = calcEdgeLength(pInfo.e);
    }
  }

  const cp = 4.184;
  // Rohr-Dimensionierung mit DN-abhängiger Fließgeschwindigkeit (2 Iterationen für Konvergenz)
  for (let iter = 0; iter < 2; iter++) {
    window.netzEdges.forEach(e => {
      if(e.load > 0){
        const vEff = e.dn > 0 ? getVFlowForDN(e.dn, vFlow) : vFlow;
        const mDot = e.load / (cp * dt);
        const reqArea = (mDot / 1000) / vEff;
        const reqDMm = Math.sqrt(4 * reqArea / Math.PI) * 1000;

        if (!networkLocked || e.dn === 0) {
            e.dn = standardDNs.find(dn => dn >= reqDMm) || standardDNs[standardDNs.length - 1];
        }
      } else {
        e.dn = 0;
      }
    });
  }

  // ── Druckverluste (Darcy-Weisbach vereinfacht mit R-Wert) ──────────────
  // R = Druckverlust pro Meter [Pa/m], abhängig von DN, Volumenstrom, Rauigkeit
  // Formel: R = (lambda * rho * v^2) / (2 * d_i)  mit lambda aus Moody (vereinfacht)
  const rhoWater = 975; // kg/m³ bei ~70°C
  const nuWater = 0.000000415; // kinematische Viskosität m²/s bei ~70°C
  const kRough = 0.00005; // Rohrrauhigkeit Stahl/KMR [m]

  window.netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      const dInner = (e.dn / 1000); // Innendurchmesser in m (DN ≈ Innendurchmesser bei KMR)
      const aInner = Math.PI * Math.pow(dInner / 2, 2);
      const vEff = getVFlowForDN(e.dn, vFlow);
      const mDot = e.load / (cp * dt); // kg/s
      const vActual = (mDot / rhoWater) / aInner; // tatsächliche Fließgeschwindigkeit m/s

      // Reynolds-Zahl
      const Re = vActual * dInner / nuWater;

      // Rohrreibungszahl lambda (Colebrook-White Näherung nach Swamee-Jain)
      let lambda;
      if (Re < 2300) {
        lambda = 64 / Math.max(Re, 100); // laminar
      } else {
        const term = kRough / (3.7 * dInner) + 5.74 / Math.pow(Re, 0.9);
        lambda = 0.25 / Math.pow(Math.log10(term), 2);
      }

      // Druckverlust pro Meter [Pa/m] — Vorlauf + Rücklauf = Faktor 2
      e.dpPerM = lambda * rhoWater * Math.pow(vActual, 2) / (2 * dInner); // Pa/m, eine Leitung
      e.dpTotal = e.dpPerM * e.length * 2; // Pa, VL+RL
      e._vActual = vActual;
      e._reynolds = Re;
      e._lambda = lambda;
    } else {
      e.dpPerM = 0;
      e.dpTotal = 0;
      e._vActual = 0;
      e._reynolds = 0;
      e._lambda = 0;
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
      pathDp += 30000; // 30 kPa Hausstation
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

    if(e.load > 0){
      const actualArea = Math.PI * Math.pow((e.dn / 1000) / 2, 2);
      const mDot = e.load / (cp * dt); 
      const actualVel = (mDot / 1000) / actualArea;
      const maxMDot = actualArea * vFlow * 1000;
      const maxLoad = maxMDot * cp * dt;
      const auslastung = (e.load / maxLoad) * 100;

      const wld = getWLD(e);
      const wldColor = getWLDColor(wld);
      const w = Math.max(1.5, Math.min(5, 1 + e.dn / 50));

      let pColor = getEdgeColor(e, vlTemp, dt, vFlow);
      if (networkLocked && auslastung > 110) pColor = '#f44336';

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
      if (networkLocked) {
        ttHtml += `Auslastung: ${auslastung.toFixed(1)} % · ${actualVel.toFixed(2)} m/s<br>`;
        ttHtml += `${_m}Kapazität: ${maxLoad.toFixed(0)} kW bei ${vFlow} m/s Auslegungsgeschwindigkeit${_me}<br>`;
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
          const dpColor = e.dpPerM < 100 ? '#4caf50' : e.dpPerM < 200 ? '#8bc34a' : e.dpPerM < 300 ? '#f9a825' : '#e53935';
          ttHtml += `Druckverlust: <span style="color:${dpColor}">${e.dpPerM.toFixed(0)} Pa/m</span> · ${(e.dpTotal/1000).toFixed(1)} kPa gesamt<br>`;
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

      targetLayer.bindTooltip(ttHtml, {sticky: true, className:'geb-tooltip'});

      // Gradient
      if (netzColorMode === 'temp' || netzColorMode === 'abkuehlung') {
        drawEdgeGradient(e, vlTemp, dt, vFlow);
      } else {
        clearEdgeGradient(e);
      }

      // Warndreieck bei Überlastung
      const showWarn = auslastung > 100;
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
      clearEdgeGradient(e);
      if (e.warnMarker) { map.removeLayer(e.warnMarker); e.warnMarker = null; }
      const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
      e.layer.setStyle({weight: 2, color: '#999', dashArray: '6, 4', opacity: dim ? 0.2 : 0.8});
      targetLayer.bindTooltip(`<span style="font-weight:normal">0 kW (inaktiv/Ringleitung)</span>`, {sticky: true, className:'geb-tooltip'});
    }

    // midMarker position aktualisieren (wenn kein manueller Waypoint)
    if (e.midMarker && !e.waypoint) {
      e.midMarker.setLatLng(getEdgeMidDisplayPt(e));
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
  // Pipe-Animation nur starten wenn aktive Kanten vorhanden
  if (window.netzEdges.some(e => e.load > 0)) startAnimPipes(); else stopAnimPipes();
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
  window.isDrawingEdge = !window.isDrawingEdge;
  const btn = document.getElementById('btn-draw-edge');
  if(window.isDrawingEdge){
    btn.classList.add('active');
    showHint('Klicke auf das erste Gebäude für die Leitung.');
    setEdgeStartId(null);
    map.getContainer().style.cursor='crosshair';
  } else {
    btn.classList.remove('active');
    hideHint();
    setEdgeStartId(null);
    map.getContainer().style.cursor='';
  }
}

export function startNetzEdgeFrom(id) {
  if (!window.isDrawingEdge) toggleDrawEdge();
  setEdgeStartId(id);
  showHint('Zweites Gebäude auf der Karte anklicken.');
}

