// ── 02c-karte-werkzeuge.js — Zeichenwerkzeuge, Trasse, Fließgewässer, LWWP, Wirtschaftlichkeit ──
import { R_MIN, _expandedIds, calculatedLoad, drawPoints, drawingId, fernwaerme, ffDrawId, ffDrawPoints, fliessgewaesserLayerGroup, gebaeude, globalYear, heizhackschnitzel, isDrawingEdge, isDrawingStromEdge, isExcluded, netzEdges, pelletsKessel, stromEmF, stromEmFLZ } from './01-globals-varianten.js';
import { getColor, getColorRange, getColorVal, getComputedStats, getEffectiveRMax, getSizeRange, getSizeVal, highlightCard, map, renameGebaeude } from './02b-gebaeude.js';
import { cancelDrawFF, finishDrawFF, redrawErzeugerIcons, redrawFernwaerme, redrawHhs, redrawPellets, redrawVerbindungslinien, windSvg } from './03a-erzeuger.js';
import { _setDefault30Pct, addNetzEdge, autoGenerateNetz, cancelDraw, confirmAutoGenerateNetz, confirmManualWaermeNetzFromTrasse, createStreetOrientedWaermeNetz, finishDraw, hidePanels, placeGeoAt, recalcNetz, showAreaEditPanel, toggleDrawEdge, updateNetzStrandVisibility } from './03b-netz.js';
import { _rerenderCard, hideHint, renderList, showHint, updateTotals } from './03c-gebaeude-io.js';
import { _hideForDraw, _restoreAfterDraw, updateLpGebietStatus } from './04a-ui-panels.js';
import { setNetzSubTab, stromNodeClick } from './05b-stromnetz.js';
import { gbiManualMode, gbiManualSelectGeb } from './06a-gbi-lastgang.js';
import { moBeiAktivierung, moBeiDeaktivierung } from './06c-dispatch-core.js';
import { syncErzeugerElektroAsset, removeErzeugerElektroAsset, moveErzeugerElektroAsset, updateErzeugerAssetProps } from './13p-erzeuger-assets.js';
import { lwWp, setIsDrawingTrasse, setSelectedId, setTrasseCurrentSegStart, setTrasseDetached, setTrasseEditMarkers, setTrassePoints, setTrassePolyline, setTrasseSegments, trasseSegments } from './01-globals-varianten.js';
import { _gebLabelHtml, escHtml } from './03c-gebaeude-io.js';
import { cancelDrawStromEdge } from './05b-stromnetz.js';
import { beginInteraction, cancelInteraction, commitInteraction } from './lib/interaction-state.js';
import { createLifecycleScope } from './lib/lifecycle.js';

/** @type {import('./lib/lifecycle.js').LifecycleScope|null} */
let areaDrawLifecycle = null;
/** @type {import('./lib/lifecycle.js').LifecycleScope|null} */
let windAreaDrawLifecycle = null;
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { _setFliessgewaesserVisible } from './01-globals-varianten.js';

let trasseRedoPoints = [];

function snapManualWaermePoint(latlng) {
  if (!window._manualWaermeNetzDrawing) return latlng;
  const click = map.latLngToContainerPoint(latlng);
  let best = null;
  gebaeude.forEach(g => {
    if (!g.polygon?.length) return;
    const center = polygonCenter(g.polygon);
    const distancePx = click.distanceTo(map.latLngToContainerPoint(center));
    if (distancePx <= 24 && (!best || distancePx < best.distancePx)) {
      best = {center, distancePx, gebaeude: g};
    }
  });
  if (!best) return latlng;
  showHint(`An „${best.gebaeude.name || `Gebäude ${best.gebaeude.id}`}“ eingerastet.`, 1800);
  return L.latLng(best.center.lat, best.center.lng);
}

export function undoTrassePoint() {
  if (!window.isDrawingTrasse || window.trassePoints.length <= window.trasseCurrentSegStart) return false;
  trasseRedoPoints.push(window.trassePoints.pop());
  redrawTrasse();
  showHint('Letzten Trassenpunkt zurückgenommen. Strg/Cmd+Umschalt+Z stellt ihn wieder her.', 3500);
  return true;
}

export function redoTrassePoint() {
  if (!window.isDrawingTrasse || trasseRedoPoints.length === 0) return false;
  window.trassePoints.push(trasseRedoPoints.pop());
  redrawTrasse();
  showHint('Trassenpunkt wiederhergestellt.', 2500);
  return true;
}

export function polygonCenter(coords){
  let lat=0,lng=0,n=coords.length;
  coords.forEach(c=>{ lat+=c.lat; lng+=c.lng; });
  return L.latLng(lat/n,lng/n);
}

/** Polyline um offsetMeter senkrecht verschieben (negativ = links, positiv = rechts). Für Tripellinie. */
export function offsetPolyline(pts, offsetMeters) {
  if (!pts || pts.length < 2) return pts;
  const R = 6371000;
  const toRad = Math.PI / 180;
  function bearing(A, B) {
    const dLon = (B.lng - A.lng) * toRad;
    const lat1 = A.lat * toRad, lat2 = B.lat * toRad;
    const x = Math.cos(lat2) * Math.sin(dLon);
    const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.atan2(x, y) / toRad;
  }
  function pointAt(lat, lng, brngDeg, d) {
    const brng = brngDeg * toRad, latR = lat * toRad, lngR = lng * toRad;
    const lat2 = Math.asin(Math.sin(latR) * Math.cos(d / R) + Math.cos(latR) * Math.sin(d / R) * Math.cos(brng));
    const lng2 = lngR + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(latR), Math.cos(d / R) - Math.sin(latR) * Math.sin(lat2));
    return L.latLng(lat2 / toRad, lng2 / toRad);
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    let brng;
    if (i === 0) brng = bearing(pts[0], pts[1]);
    else if (i === pts.length - 1) brng = bearing(pts[pts.length - 2], pts[pts.length - 1]);
    else brng = bearing(pts[i - 1], pts[i + 1]);
    const perp = offsetMeters < 0 ? brng - 90 : brng + 90;
    out.push(pointAt(pts[i].lat, pts[i].lng, perp, Math.abs(offsetMeters)));
  }
  return out;
}

/** Leichten Sinusverlauf in die Polyline legen (amplitudeM in Meter, numWaves = Anzahl Wellen über die Länge). */
export function sinusWobblePolyline(pts, amplitudeM, numWaves) {
  if (!pts || pts.length < 2 || amplitudeM <= 0) return pts;
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dists = [0];
  for (let i = 1; i < pts.length; i++) dists.push(dists[i - 1] + pts[i - 1].distanceTo(pts[i]));
  const total = dists[dists.length - 1];
  if (total <= 0) return pts;
  function bearing(A, B) {
    const dLon = (B.lng - A.lng) * toRad;
    const lat1 = A.lat * toRad, lat2 = B.lat * toRad;
    const x = Math.cos(lat2) * Math.sin(dLon);
    const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.atan2(x, y) / toRad;
  }
  function pointAt(lat, lng, brngDeg, d) {
    const brng = brngDeg * toRad, latR = lat * toRad, lngR = lng * toRad;
    const lat2 = Math.asin(Math.sin(latR) * Math.cos(d / R) + Math.cos(latR) * Math.sin(d / R) * Math.cos(brng));
    const lng2 = lngR + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(latR), Math.cos(d / R) - Math.sin(latR) * Math.sin(lat2));
    return L.latLng(lat2 / toRad, lng2 / toRad);
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const s = dists[i] / total;
    const wobble = amplitudeM * Math.sin(2 * Math.PI * numWaves * s);
    let brng;
    if (i === 0) brng = bearing(pts[0], pts[1]);
    else if (i === pts.length - 1) brng = bearing(pts[pts.length - 2], pts[pts.length - 1]);
    else brng = bearing(pts[i - 1], pts[i + 1]);
    const perp = wobble >= 0 ? brng + 90 : brng - 90;
    out.push(pointAt(pts[i].lat, pts[i].lng, perp, Math.abs(wobble)));
  }
  return out;
}

/** Nächster Punkt auf der Polyline (Fluss) zum Zielpunkt (z. B. Heizzentrale). Kürzeste Verbindung. */
export function closestPointOnPolyline(pts, targetLngLat) {
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) return pts[0];
  const target = L.latLng(targetLngLat);
  let bestPoint = pts[0];
  let bestDist = target.distanceTo(bestPoint);
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const dLat = B.lat - A.lat, dLng = B.lng - A.lng;
    const denom = dLat * dLat + dLng * dLng;
    let t = denom === 0 ? 0 : ((target.lat - A.lat) * dLat + (target.lng - A.lng) * dLng) / denom;
    t = Math.max(0, Math.min(1, t));
    const closest = L.latLng(A.lat + t * dLat, A.lng + t * dLng);
    const d = target.distanceTo(closest);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = closest;
    }
  }
  const dLast = target.distanceTo(pts[pts.length - 1]);
  if (dLast < bestDist) bestPoint = pts[pts.length - 1];
  return bestPoint;
}


export function polygonAreaM2(coords){
  if(!coords||coords.length<3) return null;
  const R=6371000;
  const latRef=coords[0].lat*Math.PI/180;
  const pts=coords.map(c=>({
    x:c.lng*Math.PI/180*R*Math.cos(latRef),
    y:c.lat*Math.PI/180*R
  }));
  let area=0;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    area+=pts[j].x*pts[i].y - pts[i].x*pts[j].y;
  }
  return Math.abs(area/2);
}

export function updateViz(){
  const [sMin,sMax]=getSizeRange();
  const [cMin,cMax]=getColorRange();
  const effRMax   = getEffectiveRMax();
  const fillOp    = effRMax <= 10 ? 0.55 : 0.65;
  const nGeb      = (window.gebaeude || gebaeude).filter(g => g.polygon).length;
  // Beschriftungen sind standardmäßig aus. Wer sie bewusst aktiviert, soll
  // sie auch in der Quartiersübersicht sehen; bei vielen Gebäuden bleibt die
  // Schwelle etwas höher, damit die Karte lesbar bleibt.
  const labelZoom = nGeb > 200 ? 17 : nGeb > 80 ? 16 : nGeb > 30 ? 15 : 14;
  const legendBar = document.getElementById('legend-bar');

  if (window.currentMode === 'waerme' || window.currentMode === 'spez') {
    document.getElementById('legend-color-title').textContent = 'Farbe = Spez. Verbrauch';
    document.getElementById('leg-min').textContent = '≤ 20';
    document.getElementById('leg-max').textContent = '≥ 250';
    legendBar.style.background = 'linear-gradient(90deg, #4caf50, #f9a825, #f44336, #640000)';
  } else if (window.currentMode === 'verlust') {
    document.getElementById('legend-color-title').textContent = 'Farbe = Zuger. Verlustanteil';
    document.getElementById('leg-min').textContent = '0 %';
    document.getElementById('leg-max').textContent = '≥ 20 %';
    legendBar.style.background = 'linear-gradient(90deg, #4caf50, #f9a825, #e53935)';
  } else if (window.currentMode === 'strom') {
    document.getElementById('legend-color-title').textContent = 'Farbe = Strombedarf';
    document.getElementById('leg-min').textContent = 'niedrig';
    document.getElementById('leg-max').textContent = 'hoch';
    legendBar.style.background = 'linear-gradient(90deg, #ffd54f, #ffa000, #e65100)';
  } else {
    document.getElementById('legend-color-title').textContent = 'Farbe = Heizlast';
    document.getElementById('leg-min').textContent = isFinite(cMin) ? cMin.toLocaleString('de-DE') : 'niedrig';
    document.getElementById('leg-max').textContent = isFinite(cMax) ? cMax.toLocaleString('de-DE') : 'hoch';
    legendBar.style.background = 'linear-gradient(90deg, #2e7d32, #8bc34a, #f9a825, #e65100, #b71c1c)';
  }

  const sizeModeName = {waerme:'Wärmeverbrauch',spez:'Spez. Verbrauch',heizlast:'Heizlast',verlust:'Zuger. Netzverlust',strom:'Strombedarf'}[window.currentMode];
  document.getElementById('legend-size-title').textContent=`Kreisgröße = ${sizeModeName}`;

  const legendCircles = document.getElementById('legend-circles');
  if(window.currentViz==='bar'){
    legendCircles.closest('.legend-row').querySelector('div:first-child').style.display='none';
    document.getElementById('legend-size-title').textContent=`Balkenhöhe = ${sizeModeName}`;
  } else {
    legendCircles.closest('.legend-row').querySelector('div:first-child').style.display='';
  }

  (window.gebaeude || gebaeude).forEach(g=>{
    const stats = getComputedStats(g, window.globalYear || globalYear);
    
    const excluded = isExcluded(g.id);
    if(g.polygonLayer){
      if (excluded) {
        g.polygonLayer.setStyle({fillColor:'#555', color:'#555', fillOpacity:0.08, dashArray:'6 4'});
      } else if (stats.status === 'geplant' || stats.status === 'abgerissen') {
         g.polygonLayer.setStyle({fillColor:'#555', color:'#555', fillOpacity:0.1, dashArray:'4 4'});
      } else {
         const cv=getColorVal(g);
         const col=getColor(cv,cMin,cMax);
         const showSource = !!window.buildingSourceOutlines && !!g.importSourceColor;
         g.polygonLayer.setStyle({
           fillColor:col,
           color:showSource ? g.importSourceColor : (g.fromOsm?'rgba(206,147,216,0.4)':'rgba(79,195,247,0.4)'),
           weight:showSource ? 2.2 : 1.2,
           fillOpacity:cv?0.55:0.08,
           dashArray:showSource ? '4 3' : '',
         });
      }
      // Heizzentrale hervorheben
      const hzId = parseInt(document.getElementById('netz-zentrale')?.value);
      if (g.id === hzId && !excluded) {
        g.polygonLayer.setStyle({ color: '#ff8f00', weight: 2.5, fillColor: '#ff8f00', fillOpacity: 0.12, dashArray: '' });
        if (g.hzLabelMarker) { map.removeLayer(g.hzLabelMarker); g.hzLabelMarker = null; }
        if (g.polygon) {
          const c = polygonCenter(g.polygon);
          g.hzLabelMarker = L.marker(c, {
            icon: L.divIcon({ className:'', html:'<div style="background:rgba(255,143,0,0.85);color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;white-space:nowrap;pointer-events:none;letter-spacing:0.5px;">HZ</div>', iconAnchor:[10,8] }),
            interactive: false, zIndexOffset: 100
          }).addTo(map);
        }
      } else {
        if (g.hzLabelMarker) { map.removeLayer(g.hzLabelMarker); g.hzLabelMarker = null; }
      }
    }

    // Solaranlagen mit dem Gebäude ausgrauen, wenn abgerissen/geplant.
    if (typeof window.applyGebPvDimming === 'function') window.applyGebPvDimming(g, stats.status);

    if(g.circleMarker){ map.removeLayer(g.circleMarker); g.circleMarker=null; }
    if(g.labelMarker) { map.removeLayer(g.labelMarker);  g.labelMarker=null; }

    if(!g.polygon) return;
    const center=polygonCenter(g.polygon);

    if (window.gebVisible && !excluded && stats.status !== 'geplant' && stats.status !== 'abgerissen') {
        const sv=getSizeVal(g);
        const cv2=getColorVal(g);
        const col=getColor(cv2,cMin,cMax);

        if(window.currentViz==='circle' && sv){
          // r ∝ √sv → Fläche ∝ sv → doppelter Verbrauch = doppelte Kreisfläche
          const r = Math.max(R_MIN, Math.round(effRMax * Math.sqrt(sv / sMax)));
          g.circleMarker=L.circleMarker(center,{
            radius:r, color:'rgba(255,255,255,0.7)', weight:1.5,
            fillColor:col, fillOpacity:fillOp
          });
          g.circleMarker.setStyle({ fillColor: col, fillOpacity: fillOp });
          g.circleMarker.bindTooltip(()=>buildTooltip(g),{sticky:true,className:'geb-tooltip'});
          g.circleMarker.on('click',()=>{ selectFromMap(g.id); });
          g.circleMarker.addTo(map);
        }

        if(window.currentViz==='bar' && sv){
          const t=sMax>sMin?(sv-sMin)/(sMax-sMin):0;
          const barH=Math.max(8,Math.round(8+t*52));
          const barW=14;
          const svgH=barH+6;
          const svg=`<svg width="${barW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="${svgH-barH-1}" width="${barW-2}" height="${barH}" rx="2"
              fill="${col}" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" opacity="0.9"/>
          </svg>`;
          const icon=L.divIcon({html:svg,className:'',iconAnchor:[barW/2,svgH],iconSize:[barW,svgH]});
          g.circleMarker=L.marker(center,{icon});
          g.circleMarker.bindTooltip(()=>buildTooltip(g),{sticky:true,className:'geb-tooltip'});
          g.circleMarker.on('click',()=>{ selectFromMap(g.id); });
          g.circleMarker.addTo(map);
        }
    }

    if(window.labelsVisible && map.getZoom() >= labelZoom) buildMapLabel(g,center, stats.status);
  });
}

export function buildMapLabel(g,center, status){
  const opacity = (status === 'geplant' || status === 'abgerissen') ? '0.3' : '1';
  const icon=L.divIcon({
    className:'geb-label',
    html:`<div class="geb-label-inner" id="lbl-${g.id}"
      style="opacity:${opacity}"
      data-click="selectFromMap(${g.id})"
      ondblclick="startMapRename(${g.id})"
      title="Doppelklick zum Umbenennen"
    >${_gebLabelHtml(g)}</div>`,
    iconAnchor:[0,0]
  });
  g.labelMarker=L.marker(center,{icon,interactive:true,zIndexOffset:500}).addTo(map);
}

export function selectFromMap(id){
  // Gebäudeliste-Import: bidirektionale manuelle Zuordnung
  if(gbiManualMode && typeof gbiManualSelectGeb === 'function') {
    if(gbiManualSelectGeb(id)) return;
  }
  // Stromnetz Kabel-Zeichenmodus: Gebäude als Strom-Knoten
  if(isDrawingStromEdge && typeof stromNodeClick === 'function') {
    if(stromNodeClick(id)) return;
  }
  if(isDrawingEdge){
    if(window.edgeStartId === null){ window.edgeStartId = id; showHint('Zweites Gebäude anklicken.'); }
    else { if(window.edgeStartId !== id){ addNetzEdge(window.edgeStartId, id); recalcNetz(); } window.edgeStartId = null; showHint('Nächstes Gebäude anklicken oder Tool beenden.'); }
    return;
  }
  setSelectedId(id);
  window.updateSperrVisibility?.();
  _expandedIds.add(id);
  // Rechte Sidebar auf den Gebäude-Tab schalten, damit die Eigenschaften des
  // angeklickten Gebäudes immer sichtbar werden — unabhängig vom linken Tab und
  // davon, ob das Gebäude ein Elektro-Asset hat. (Bisher nur im Elektro-Tab, dadurch
  // sprangen Gebäude OHNE Asset nicht in die Eigenschaften, wenn die Sidebar auf
  // „Elektro" stand.) Asset-Marker öffnen danach ggf. den Inspector und schalten
  // selbst wieder auf „elektro".
  if (typeof window.setSidebarTab === 'function') {
    const _sbActive = document.querySelector('.sb-tab-body.active')?.id;
    if (_sbActive && _sbActive !== 'sb-tab-gebaeude') window.setSidebarTab('gebaeude');
  }
  _rerenderCard(id);
  highlightCard(id);
  const el = document.getElementById('card-'+id);
  if(el) el.scrollIntoView({behavior:'smooth', block:'nearest'});
}

export function startMapRename(id){
  const el=document.getElementById('lbl-'+id);
  if(!el) return;
  el.contentEditable='true'; el.focus();
  const range=document.createRange();range.selectNodeContents(el);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  el.onblur=()=>{ el.contentEditable='false'; renameGebaeude(id,el.textContent.trim()||`Gebäude ${id}`); renderList(); };
  el.onkeydown=e=>{ if(e.key==='Enter'){e.preventDefault();el.blur();} if(e.key==='Escape'){el.contentEditable='false';} };
}

export function buildTooltip(g){
  const stats = getComputedStats(g, globalYear);
  const lines=[`<span style="font-weight:normal;color:var(--accent)">${escHtml(g.name)}</span>`];

  if (stats.status === 'geplant') lines.push(`<span style="color:#f9a825;font-size:10px">Geplanter Neubau (${g.baujahr})</span>`);
  if (stats.status === 'abgerissen') lines.push(`<span style="color:#e53935;font-size:10px">Abgerissen (${g.abrissjahr})</span>`);
  if (stats.status === 'saniert') lines.push(`<span style="color:#4caf50;font-size:10px">Saniert</span>`);
  if(g.fromOsm) lines.push(`<span style="color:#ce93d8;font-size:10px">● OSM</span>`);

  if (stats.status !== 'geplant' && stats.status !== 'abgerissen') {
    if (window.currentMode === 'strom') {
      // ── Strom-Modus: elektrische Kennwerte ───────────────────────────────
      const fl = parseFloat(g.flaeche) || 0;
      if (g.elMwh > 0) {
        lines.push(`⚡ Strom: <span style="font-weight:normal;color:#ffd54f">${g.elMwh.toLocaleString('de-DE',{maximumFractionDigits:1})} MWh/a</span>`);
        if (fl > 0) {
          const spezEl = g.elMwh * 1000 / fl;
          lines.push(`Spez.: <span style="font-weight:normal">${spezEl.toLocaleString('de-DE',{maximumFractionDigits:0})} kWh/m²a</span>`);
        }
      } else {
        lines.push(`<i style="color:#666">Kein Stromlastgang definiert</i>`);
        if (fl > 0) lines.push(`Fläche: <span style="font-weight:normal">${fl.toLocaleString('de-DE',{maximumFractionDigits:0})} m²</span>`);
      }
      // WP-Strom-Anteil aus Dispatch (falls vorhanden)
      const en  = window._dispatchEnergy || {};
      const WP_KEYS = ['lwwp','fg','geo'];
      const wpMwhTotal = WP_KEYS.reduce((s,k)=>s+((en[k]||{}).elMwh||0),0);
      if (wpMwhTotal > 0 && g.elMwh > 0) {
        // WP-Strom proportional zur Fläche schätzen
        const gesamtFlaeche = gebaeude.reduce((s,gb)=>s+(parseFloat(gb.flaeche)||0),0);
        if (gesamtFlaeche > 0 && fl > 0) {
          const wpAnteil = wpMwhTotal * fl / gesamtFlaeche;
          lines.push(`davon WP: <span style="font-weight:normal;color:#ffd54f">${wpAnteil.toLocaleString('de-DE',{maximumFractionDigits:1})} MWh/a</span>`);
        }
      }
    } else {
      // ── Wärme-/Normal-Modi ───────────────────────────────────────────────
      if(stats.waerme)   lines.push(`Wärme: <span style="font-weight:normal">${stats.waerme.toLocaleString('de-DE',{maximumFractionDigits:1})} MWh/a</span>`);
      if(stats.spez)     lines.push(`Spez.: <span style="font-weight:normal">${stats.spez.toLocaleString('de-DE',{maximumFractionDigits:1})} kWh/m²a</span>`);
      if(stats.heizlast) lines.push(`Heizlast: <span style="font-weight:normal">${stats.heizlast.toLocaleString('de-DE',{maximumFractionDigits:1})} kW</span>`);
      if(stats.spezHeizlast) lines.push(`Spez. HL: <span style="font-weight:normal">${stats.spezHeizlast.toLocaleString('de-DE',{maximumFractionDigits:1})} W/m²</span>`);
      if(!stats.waerme&&!stats.spez&&!stats.heizlast) lines.push(`<i style="color:#666">Noch keine Werte</i>`);
      if (g.tempIn !== undefined && g.tempIn !== null) {
        lines.push(`<div style="border-top:1px solid var(--border); margin:4px 0; padding-top:4px;"></div>`);
        lines.push(`Netz-Ankunft: <span style="font-weight:normal; color:#e53935">${g.tempIn.toFixed(1)} °C</span>`);
      }
      if (g.netzVerlustKW !== null && g.netzVerlustKW !== undefined) {
        const ratioCol = g.netzVerlustRatioPct < 5 ? '#4caf50' : g.netzVerlustRatioPct < 10 ? '#f9a825' : '#e53935';
        if (!g.tempIn) lines.push(`<div style="border-top:1px solid var(--border); margin:4px 0; padding-top:4px;"></div>`);
        lines.push(`Zuger. Verlust: <span style="font-weight:normal">${g.netzVerlustKW.toFixed(1)} kW → ${g.netzVerlustJahrMWh.toLocaleString('de-DE')} MWh/a</span>`);
        if (g.netzVerlustRatioPct != null) lines.push(`Anteil Verbrauch: <span style="font-weight:normal;color:${ratioCol}">${g.netzVerlustRatioPct.toFixed(1)} %</span>`);
      }
    }
  }

  return lines.join('<br>');
}

export function setViz(v){
  window.currentViz=v;
  ['circle','bar','none'].forEach(x=>document.getElementById('vbtn-'+x).classList.toggle('active',x===v));
  updateViz();
}

export function setGebVisible(visible) {
  window.gebVisible = visible;
  updateViz();
}

export function setLabelsVisible(visible) {
  window.labelsVisible = visible;
  // Labels sofort entfernen wenn ausgeschaltet (nicht auf updateViz() warten)
  if (!visible) {
    gebaeude.forEach(g => {
      if (g.labelMarker) { map.removeLayer(g.labelMarker); g.labelMarker = null; }
    });
  }
  updateViz();
}

export function setMode(m){
  window.currentMode=m;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('btn-'+m)?.classList.add('active');
  // "Ansicht ▾"-Menübutton zeigt die aktive Nischenansicht an (und schließt das Menü)
  const _nischenLabel = { spez: 'Spez. Wärmebedarf', heizlast: 'Heizlast', verlust: 'Netzverlust' };
  const amBtn = document.getElementById('btn-ansicht-menu');
  if (amBtn) {
    amBtn.textContent = (_nischenLabel[m] || 'Ansicht') + ' ▾';
    amBtn.classList.toggle('active', !!_nischenLabel[m]);
  }
  const amMenu = document.getElementById('ansicht-menu');
  if (amMenu) amMenu.style.display = 'none';
  updateNetzStrandVisibility();
  updateViz();updateTotals();
  // Sidebar mitführen — Karte=Strom und Arbeitsbereich=Elektro sind dieselbe Sicht.
  // setLeftTab() setzt dabei auch die Netz-Sichtbarkeit (Wärme- vs. Stromnetz).
  const elektroAktiv = document.querySelector('#lp-tabs .lp-tab[data-tab="elektro"]')?.classList.contains('active');
  if (m === 'strom') {
    if (!elektroAktiv && typeof window.setLeftTab === 'function') window.setLeftTab('elektro');
  } else {
    if (elektroAktiv && typeof window.setLeftTab === 'function') window.setLeftTab(window._lastWaermeTab || 'erzeuger');
  }
}

// ── "⋯ Mehr"-Menü in der Kopfleiste (Feldapp, Farbschema, Satellit, Hilfe …) ──
export function toggleMehrMenu() {
  const menu = document.getElementById('mehr-menu');
  if (!menu) return;
  const offen = menu.style.display !== 'none';
  menu.style.display = offen ? 'none' : 'flex';
  if (!offen && !window._mehrMenuCloser) {
    window._mehrMenuCloser = true;
    // Klick außerhalb schließt das Menü
    document.addEventListener('click', (e) => {
      const m = document.getElementById('mehr-menu');
      if (m && m.style.display !== 'none'
        && !e.target.closest('#mehr-menu')
        && !e.target.closest('#btn-mehr-menu')) m.style.display = 'none';
    });
  }
}

// ── "Ansicht ▾"-Menü in der Kontextleiste (Nischenansichten + Gebäude-Symbole) ──
export function toggleAnsichtMenu() {
  const menu = document.getElementById('ansicht-menu');
  if (!menu) return;
  const offen = menu.style.display !== 'none';
  if (!offen) {
    // position:fixed unter dem Button — die Kontextleiste clippt absolute
    // Kinder wegen overflow-x:auto, fixed entkommt dem Scroll-Container
    const btn = document.getElementById('btn-ansicht-menu');
    if (btn) {
      const r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 215)) + 'px';
    }
  }
  menu.style.display = offen ? 'none' : 'block';
  if (!offen && !window._ansichtMenuCloser) {
    window._ansichtMenuCloser = true;
    // Klick außerhalb schließt das Menü
    document.addEventListener('click', (e) => {
      const m = document.getElementById('ansicht-menu');
      if (m && m.style.display !== 'none'
        && !e.target.closest('#ansicht-menu')
        && !e.target.closest('#btn-ansicht-menu')) m.style.display = 'none';
    });
  }
}

export function cleanupDrawAreaEvents() {
  areaDrawLifecycle?.dispose();
  areaDrawLifecycle = null;
  map.dragging.enable();
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  hideHint();
  _restoreAfterDraw();
}

export function clearArea() {
  if (window.areaPolygon) map.removeLayer(window.areaPolygon);
  if (window.areaPolyline) map.removeLayer(window.areaPolyline);
  if (window.areaStartMarker) map.removeLayer(window.areaStartMarker);
  window.areaEditMarkers.forEach(m => map.removeLayer(m));

  window.areaEditMarkers = [];
  window.areaPoints = [];
  window.areaLatLngs = null;
  window.areaDrawing = false;
  window.areaPolygon = null;
  window.areaPolyline = null;
  window.areaStartMarker = null;

  hidePanels();
  document.getElementById('btn-draw-area').classList.remove('active');
  cleanupDrawAreaEvents();
  if (typeof updateLpGebietStatus === 'function') updateLpGebietStatus();
}

export function lockArea() {
  window.areaEditMarkers.forEach(m => map.removeLayer(m));
  window.areaEditMarkers = [];
  hidePanels();
  if (typeof updateLpGebietStatus === 'function') updateLpGebietStatus();
}

export function toggleDrawArea() {
  if (window.areaDrawing || window.areaPolygon) { clearArea(); return; }
  beginInteraction({id:'draw-area',label:'Plangebiet zeichnen',hint:'Eckpunkte setzen, Startpunkt schließt die Fläche.',cancel:clearArea});

  window.areaDrawing = true;
  window.areaPoints = [];
  document.getElementById('btn-draw-area').classList.add('active');
  showHint('Klicke für Eckpunkte auf die Karte. Den Startpunkt (rot) erneut anklicken zum Abschließen. Rechtsklick zum Widerrufen. ESC zum Abbrechen.');

  _hideForDraw();
  map.doubleClickZoom.disable();
  map.dragging.disable();
  map.getContainer().style.cursor = 'crosshair';
  areaDrawLifecycle?.dispose();
  areaDrawLifecycle = createLifecycleScope('draw-area');
  areaDrawLifecycle.mapOn(map,'click',onDrawAreaClick);
  areaDrawLifecycle.mapOn(map,'contextmenu',onDrawAreaCancel);
}

export function onDrawAreaClick(e) {
  if (!window.areaDrawing) return;

  // Klick auf Startmarker → Polygon abschließen (nicht als neuen Punkt werten)
  if (window.areaStartMarker && window.areaPoints.length >= 3) {
    const startLL = window.areaStartMarker.getLatLng();
    const d = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(startLL));
    if (d < 20) { finishAreaDraw(); return; }
  }

  if (window.areaPoints.length === 0) {
    const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
    window.areaStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
    window.areaStartMarker.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      finishAreaDraw();
    });
  }

  window.areaPoints.push(e.latlng);
  if (window.areaPolyline) map.removeLayer(window.areaPolyline);
  window.areaPolyline = L.polyline([...window.areaPoints], {color: '#ab47bc', weight: 2, dashArray: '8 4'}).addTo(map);
}

export function onDrawAreaCancel(e) {
  if (!window.areaDrawing) return;

  if (window.areaPoints.length > 0) {
    window.areaPoints.pop();
    if (window.areaPolyline) map.removeLayer(window.areaPolyline);

    if (window.areaPoints.length > 0) {
      window.areaPolyline = L.polyline([...window.areaPoints], {color: '#ab47bc', weight: 2, dashArray: '8 4'}).addTo(map);
    } else {
      if (window.areaStartMarker) { map.removeLayer(window.areaStartMarker); window.areaStartMarker = null; }
    }
  }
}

export function finishAreaDraw() {
  if (window.areaPoints.length < 3) return;
  window.areaLatLngs = [...window.areaPoints];
  window.areaDrawing = false;
  commitInteraction('draw-area');

  if (window.areaPolyline) map.removeLayer(window.areaPolyline);
  if (window.areaStartMarker) { map.removeLayer(window.areaStartMarker); window.areaStartMarker = null; }

  window.areaPolygon = L.polygon(window.areaLatLngs, {color: '#ab47bc', weight: 2, dashArray: '8 4', fillColor: '#ab47bc', fillOpacity: 0.08}).addTo(map);

  const editIcon = L.divIcon({className: 'area-edit-handle', html: '', iconSize: [12, 12]});
  window.areaLatLngs.forEach((latlng, index) => {
    let marker = L.marker(latlng, {draggable: true, icon: editIcon, zIndexOffset: 2000}).addTo(map);
    marker.on('drag', function(e) {
      window.areaLatLngs[index] = e.target.getLatLng();
      window.areaPolygon.setLatLngs(window.areaLatLngs);
    });
    window.areaEditMarkers.push(marker);
  });

  cleanupDrawAreaEvents();
  showAreaEditPanel();
}

// ── Windgebiet: eigenständiges Zeichengebiet für die Windkraft-Standortanalyse ──
// Unabhängig vom allgemeinen Plangebiet (window.areaPolygon) — kann größer/anders
// zugeschnitten sein (z.B. gesamte Liegenschaft für die Abstandsprüfung, während das
// Plangebiet nur den Baubereich meint). Wird von der Eignungsflächen-Berechnung in
// 13b-assets-render.js bevorzugt genutzt, wenn vorhanden (sonst Fallback auf areaPolygon).
export function cleanupDrawWindGebietEvents() {
  windAreaDrawLifecycle?.dispose();
  windAreaDrawLifecycle = null;
  window.windGebietDrawing = false;
  map.dragging.enable();
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  hideHint();
  _restoreAfterDraw();
}

export function clearWindGebiet() {
  if (window.windGebietPolygon) map.removeLayer(window.windGebietPolygon);
  if (window.windGebietPolyline) map.removeLayer(window.windGebietPolyline);
  if (window.windGebietStartMarker) map.removeLayer(window.windGebietStartMarker);
  (window.windGebietEditMarkers || []).forEach(m => map.removeLayer(m));

  window.windGebietEditMarkers = [];
  window.windGebietPoints = [];
  window.windGebietLatLngs = null;
  window.windGebietDrawing = false;
  window.windGebietPolygon = null;
  window.windGebietPolyline = null;
  window.windGebietStartMarker = null;

  cleanupDrawWindGebietEvents();
  if (typeof window._onWindGebietChanged === 'function') window._onWindGebietChanged();
}

export function toggleDrawWindGebiet() {
  if (window.windGebietDrawing || window.windGebietPolygon) { clearWindGebiet(); return; }
  beginInteraction({id:'draw-wind-area',label:'Windgebiet zeichnen',hint:'Eckpunkte setzen, Startpunkt schließt die Fläche.',cancel:clearWindGebiet});

  window.windGebietDrawing = true;
  window.windGebietPoints = [];
  showHint('Windgebiet zeichnen: Klicke für Eckpunkte auf die Karte. Startpunkt (rot) erneut anklicken zum Abschließen. Rechtsklick zum Widerrufen. ESC zum Abbrechen.');

  _hideForDraw();
  map.doubleClickZoom.disable();
  map.dragging.disable();
  map.getContainer().style.cursor = 'crosshair';
  windAreaDrawLifecycle?.dispose();
  windAreaDrawLifecycle = createLifecycleScope('draw-wind-area');
  windAreaDrawLifecycle.mapOn(map,'click',onDrawWindGebietClick);
  windAreaDrawLifecycle.mapOn(map,'contextmenu',onDrawWindGebietCancel);
}

export function onDrawWindGebietClick(e) {
  if (!window.windGebietDrawing) return;

  if (window.windGebietStartMarker && window.windGebietPoints.length >= 3) {
    const startLL = window.windGebietStartMarker.getLatLng();
    const d = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(startLL));
    if (d < 20) { finishWindGebietDraw(); return; }
  }

  if (window.windGebietPoints.length === 0) {
    const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
    window.windGebietStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
    window.windGebietStartMarker.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      finishWindGebietDraw();
    });
  }

  window.windGebietPoints.push(e.latlng);
  if (window.windGebietPolyline) map.removeLayer(window.windGebietPolyline);
  window.windGebietPolyline = L.polyline([...window.windGebietPoints], {color: '#4dd0e1', weight: 2, dashArray: '8 4'}).addTo(map);
}

export function onDrawWindGebietCancel(e) {
  if (!window.windGebietDrawing) return;

  if (window.windGebietPoints.length > 0) {
    window.windGebietPoints.pop();
    if (window.windGebietPolyline) map.removeLayer(window.windGebietPolyline);

    if (window.windGebietPoints.length > 0) {
      window.windGebietPolyline = L.polyline([...window.windGebietPoints], {color: '#4dd0e1', weight: 2, dashArray: '8 4'}).addTo(map);
    } else if (window.windGebietStartMarker) {
      map.removeLayer(window.windGebietStartMarker);
      window.windGebietStartMarker = null;
    }
  }
}

export function finishWindGebietDraw() {
  if (window.windGebietPoints.length < 3) return;
  window.windGebietLatLngs = [...window.windGebietPoints];
  window.windGebietDrawing = false;
  commitInteraction('draw-wind-area');

  if (window.windGebietPolyline) map.removeLayer(window.windGebietPolyline);
  if (window.windGebietStartMarker) { map.removeLayer(window.windGebietStartMarker); window.windGebietStartMarker = null; }

  window.windGebietPolygon = L.polygon(window.windGebietLatLngs, {color: '#4dd0e1', weight: 2, dashArray: '8 4', fillColor: '#4dd0e1', fillOpacity: 0.06}).addTo(map);

  const editIcon = L.divIcon({className: 'area-edit-handle', html: '', iconSize: [12, 12]});
  window.windGebietEditMarkers = [];
  window.windGebietLatLngs.forEach((latlng, index) => {
    const marker = L.marker(latlng, {draggable: true, icon: editIcon, zIndexOffset: 2000}).addTo(map);
    marker.on('drag', function(e) {
      window.windGebietLatLngs[index] = e.target.getLatLng();
      window.windGebietPolygon.setLatLngs(window.windGebietLatLngs);
    });
    marker.on('dragend', () => { if (typeof window._onWindGebietChanged === 'function') window._onWindGebietChanged(); });
    window.windGebietEditMarkers.push(marker);
  });

  cleanupDrawWindGebietEvents();
  if (typeof window._onWindGebietChanged === 'function') window._onWindGebietChanged();
}

setTimeout(() => {
map.on('click',e=>{
  if (window.isPlacingLwWp) { placeLwWpAt(e.latlng); return; }
  if (window.isPlacingGeo) {
    commitInteraction('place-geothermal');
    placeGeoAt(e.latlng);
    window.isPlacingGeo = false;
    const btn = document.getElementById('btn-place-geo');
    if (btn) { btn.textContent = 'Auf Karte platzieren'; btn.style.borderColor = ''; }
    map.getContainer().style.cursor = '';
    _restoreAfterDraw();
    // Panel nach Platzierung wieder einblenden
    hidePanels();
    document.getElementById('geo-panel').classList.add('visible');
    const geoBtn = document.getElementById('btn-geo-toggle');
    if (geoBtn) geoBtn.classList.add('active');
    return;
  }
  if (window.isPlacingPellets) {
    commitInteraction('place-pellet-storage');
    if (pelletsKessel) { pelletsKessel.lat = e.latlng.lat; pelletsKessel.lng = e.latlng.lng; }
    window.isPlacingPellets = false;
    map.getContainer().style.cursor = '';
    _restoreAfterDraw();
    const btn = document.getElementById('btn-place-pellets');
    if (btn) btn.textContent = 'Lager verschieben / entfernen';
    redrawPellets();
    // Panel nach Platzierung wieder einblenden
    hidePanels();
    document.getElementById('pellets-panel').classList.add('visible');
    const pBtn = document.getElementById('btn-pellets-toggle');
    if (pBtn) pBtn.classList.add('active');
    return;
  }
  if (window.isPlacingHhs) {
    commitInteraction('place-wood-storage');
    if (heizhackschnitzel) { heizhackschnitzel.lat = e.latlng.lat; heizhackschnitzel.lng = e.latlng.lng; }
    window.isPlacingHhs = false;
    map.getContainer().style.cursor = '';
    _restoreAfterDraw();
    const btn = document.getElementById('btn-place-hhs');
    if (btn) btn.textContent = 'Lager verschieben / entfernen';
    redrawHhs();
    // Panel nach Platzierung wieder einblenden
    hidePanels();
    document.getElementById('hhs-panel').classList.add('visible');
    const hBtn = document.getElementById('btn-hhs-toggle');
    if (hBtn) hBtn.classList.add('active');
    return;
  }
  if (window.isPlacingFernwaerme) {
    commitInteraction('place-district-heat');
    if (fernwaerme) { fernwaerme.lat = e.latlng.lat; fernwaerme.lng = e.latlng.lng; }
    window.isPlacingFernwaerme = false;
    map.getContainer().style.cursor = '';
    _restoreAfterDraw();
    const btn = document.getElementById('btn-place-fw');
    if (btn) btn.textContent = 'Einspeisepunkt verschieben / entfernen';
    redrawFernwaerme();
    // Panel nach Platzierung wieder einblenden
    hidePanels();
    document.getElementById('fernwaerme-panel').classList.add('visible');
    const fwBtn = document.getElementById('btn-fernwaerme-toggle');
    if (fwBtn) fwBtn.classList.add('active');
    return;
  }
  if(window.isDrawingRiver) {
    window.riverPoints.push(e.latlng);
    redrawRiverDuringDraw();
    return;
  }
  if(window.isDrawingTrasse) {
    trasseRedoPoints = [];
    const clickedLatLng = snapManualWaermePoint(e.latlng);
    if (window.trasseDetached) {
      // Erst auf vorhandene Knoten, danach auch auf die nächstgelegene Linie
      // einrasten. So kann ein Abzweig mitten aus einer Trasse beginnen.
      let snapIdx = -1;
      let snapDist = Infinity;
      let snapLatLng = null;
      const clickPx = map.latLngToContainerPoint(clickedLatLng);
      for (let i = 0; i < window.trassePoints.length; i++) {
        const px = map.latLngToContainerPoint(window.trassePoints[i]);
        const d = clickPx.distanceTo(px);
        if (d < 6 && d < snapDist) { snapDist = d; snapIdx = i; snapLatLng = window.trassePoints[i]; }
      }
      if (snapIdx < 0) {
        for (const seg of window.trasseSegments) {
          for (let i = seg.start; i < seg.end; i++) {
            const a = map.latLngToContainerPoint(window.trassePoints[i]);
            const b = map.latLngToContainerPoint(window.trassePoints[i + 1]);
            const dx = b.x - a.x, dy = b.y - a.y;
            const den = dx * dx + dy * dy;
            const t = den ? Math.max(0, Math.min(1, ((clickPx.x-a.x)*dx + (clickPx.y-a.y)*dy) / den)) : 0;
            const projected = L.point(a.x + t*dx, a.y + t*dy);
            const d = clickPx.distanceTo(projected);
            if (d < 20 && d < snapDist) { snapDist = d; snapLatLng = map.containerPointToLatLng(projected); }
          }
        }
      }
      if (snapLatLng) {
        // Neuen Strang ab bestehendem Punkt starten
        setTrasseCurrentSegStart(window.trassePoints.length);
        window.trassePoints.push(L.latLng(snapLatLng.lat, snapLatLng.lng));
        showHint('Neuer Strang ab Abzweigung. Klicke weiter oder "Abschließen".');
      } else {
        // Neuen isolierten Strang beginnen
        setTrasseCurrentSegStart(window.trassePoints.length);
        window.trassePoints.push(clickedLatLng);
        showHint('Neuer Strang gestartet. Klicke weiter oder Rechtsklick = loslösen.');
      }
      setTrasseDetached(false);
    } else {
      window.trassePoints.push(clickedLatLng);
    }
    redrawTrasse();
    return;
  }
  if (window.gebFirstDraw) {
    const st = window.gebFirstDraw;
    st.points.push(e.latlng);
    if (st.polyline) map.removeLayer(st.polyline);
    st.polyline = L.polyline([...st.points], {color: '#ffd54f', weight: 2, dashArray: '4 4'}).addTo(map);
    if (st.points.length >= 2) window.finishGebFirstDraw && window.finishGebFirstDraw();
    return;
  }
  if (window.gebPvDraw) {
    const st = window.gebPvDraw;
    const col = st.typ === 'sperr' ? '#e53935' : '#ffd54f';
    if (st.points.length === 0) {
      const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
      st.startMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
      st.startMarker.on('click', (ev) => { L.DomEvent.stopPropagation(ev); window.finishGebPvDraw && window.finishGebPvDraw(); });
    }
    st.points.push(e.latlng);
    if (st.polyline) map.removeLayer(st.polyline);
    st.polyline = L.polyline([...st.points], {color: col, weight: 2, dashArray: '6 4'}).addTo(map);
    return;
  }
  if (ffDrawId !== null) {
    if (ffDrawPoints.length === 0) {
      const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
      window.ffDrawStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
      window.ffDrawStartMarker.on('click', (ev) => { L.DomEvent.stopPropagation(ev); finishDrawFF(); });
    }
    ffDrawPoints.push(e.latlng);
    if (window.ffDrawPolyline) map.removeLayer(window.ffDrawPolyline);
    window.ffDrawPolyline = L.polyline([...ffDrawPoints], {color:'#ffd54f', weight:2, dashArray:'6 4'}).addTo(map);
    return;
  }
  if((window.drawingId ?? drawingId) !== null){
    const _drawPts = window.drawPoints || drawPoints;
    if(_drawPts.length === 0){
      const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
      window.drawStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
      window.drawStartMarker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        finishDraw();
      });
    }
    _drawPts.push(e.latlng);
    if(window.drawPolyline) map.removeLayer(window.drawPolyline);
    window.drawPolyline=L.polyline([..._drawPts],{color:'#4fc3f7',weight:2,dashArray:'6 4'}).addTo(map);
    return;
  }
});

map.on('contextmenu', e => {
  if(window.isDrawingRiver && window.riverPoints.length > 0){
    window.riverPoints.pop();
    redrawRiverDuringDraw();
  } else if(window.isDrawingTrasse && window.trassePoints.length > window.trasseCurrentSegStart){
    // Einheitliche Zeichenlogik: Rechtsklick nimmt den letzten Punkt zurück.
    undoTrassePoint();
  } else if((window.drawingId ?? drawingId) !== null && (window.drawPoints || drawPoints).length > 0){
    const _drawPts = window.drawPoints || drawPoints;
    _drawPts.pop();
    if(window.drawPolyline) map.removeLayer(window.drawPolyline);
    if(_drawPts.length > 0) {
      window.drawPolyline = L.polyline([..._drawPts], {color: '#4fc3f7', weight: 2, dashArray: '6 4'}).addTo(map);
    } else {
      if(window.drawStartMarker) { map.removeLayer(window.drawStartMarker); window.drawStartMarker = null; }
    }
  } else if (ffDrawId !== null && ffDrawPoints.length > 0) {
    ffDrawPoints.pop();
    if (window.ffDrawPolyline) map.removeLayer(window.ffDrawPolyline);
    if (ffDrawPoints.length > 0) {
      window.ffDrawPolyline = L.polyline([...ffDrawPoints], {color:'#ffd54f', weight:2, dashArray:'6 4'}).addTo(map);
    } else {
      if (window.ffDrawStartMarker) { map.removeLayer(window.ffDrawStartMarker); window.ffDrawStartMarker = null; }
    }
  } else if (window.gebPvDraw && window.gebPvDraw.points.length > 0) {
    const st = window.gebPvDraw;
    const col = st.typ === 'sperr' ? '#e53935' : '#ffd54f';
    st.points.pop();
    if (st.polyline) map.removeLayer(st.polyline);
    if (st.points.length > 0) {
      st.polyline = L.polyline([...st.points], {color: col, weight: 2, dashArray: '6 4'}).addTo(map);
    } else if (st.startMarker) {
      map.removeLayer(st.startMarker); st.startMarker = null;
    }
  }
});

map.on('dblclick',e=>{
  L.DomEvent.stopPropagation(e);
  L.DomEvent.preventDefault(e);
  if(window.isDrawingRiver && window.riverPoints.length >= 2) { finishDrawRiver(); return; }
  if(window.isDrawingTrasse) { toggleDrawTrasse(); }
});

map.on('zoomend', function() {
  if (!window.isDrawingTrasse &&
      (window.currentViz === 'circle' || window.currentViz === 'bar' || window.labelsVisible)) updateViz();
  if (window.fliessgewaesser) redrawFliessgewaesser();
});

document.addEventListener('keydown',e=>{
  if (window.isDrawingTrasse && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoTrassePoint();
    else undoTrassePoint();
    return;
  }
  if(e.key==='Escape'){
    if (window.gebFirstDraw) { window.cancelGebFirstDraw && window.cancelGebFirstDraw(); return; }
    if (window.gebPvDraw) { window.cancelGebPvDraw && window.cancelGebPvDraw(); return; }
    if (window.areaDrawing) { clearArea(); return; }
    if (window.windGebietDrawing) { clearWindGebiet(); return; }
    if (window.isPlacingLwWp) togglePlaceLwWp();
    if(window.isDrawingRiver) toggleDrawRiver();
    if(window.isDrawingTrasse) toggleDrawTrasse();
    cancelDraw();
    if(isDrawingEdge) toggleDrawEdge();
  }
  // Pfeiltasten: handled by new keyboard handler in live view section
});
}, 0);

let trasseDrawDomain = 'waerme';
function cancelTrasseInteraction() {
  if (!window.isDrawingTrasse) return;
  window.trassePoints.splice(window.trasseCurrentSegStart);
  toggleDrawTrasse();
  window._manualWaermeNetzDrawing = false;
}
export function toggleDrawTrasse(domain) {
  if (!window.isDrawingTrasse && (domain === 'waerme' || domain === 'strom')) trasseDrawDomain = domain;
  setIsDrawingTrasse(!window.isDrawingTrasse);
  const buttons = document.querySelectorAll('.trasse-draw-btn');
  if (window.isDrawingTrasse) {
    const manualHeat = trasseDrawDomain === 'waerme' && window._manualWaermeNetzDrawing;
    beginInteraction({id:'draw-trasse',label:trasseDrawDomain === 'strom' ? 'Elektro-Korridor zeichnen' : manualHeat ? 'Wärmenetz vollständig manuell zeichnen' : 'Wärme-Haupttrasse zeichnen',hint:'Punkte setzen; neuer Strang erzeugt einen Abzweig.',cancel:cancelTrasseInteraction});
    trasseRedoPoints = [];
    // Trasse zum Bearbeiten sichtbar machen (Ansicht-Checkbox synchronisieren)
    window.trasseVisible = true;
    const _tcb = document.getElementById('el-trasse-visible');
    if (_tcb) _tcb.checked = true;
    // Andere Modi beenden
    if (window.isDrawingStromEdge && typeof cancelDrawStromEdge === 'function') cancelDrawStromEdge();
    if (typeof window.setPendingType === 'function' && window._pendingAssetType) window.setPendingType(window._pendingAssetType);
    buttons.forEach(btn => btn.classList.add('active'));
    setTrasseDetached(false);
    showHint(`${trasseDrawDomain === 'strom' ? 'Elektro-Korridor' : manualHeat ? 'Manuelles Wärmenetz' : 'Wärme-Haupttrasse'}: Punkte setzen. Rechtsklick = letzter Punkt zurück. „Neuer Strang“ startet einen Abzweig.${manualHeat ? ' Nahe Gebäude werden automatisch exakt eingerastet.' : ''}`);
    showTrasseFinishBtn();
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
    if (window.trassePolyline) {
      if (Array.isArray(window.trassePolyline)) window.trassePolyline.forEach(p => p.setStyle({opacity: 0.25}));
      else window.trassePolyline.setStyle({opacity: 0.25});
    }
    // Netz-Panel minimieren, damit die Karte sichtbar ist
    const netzPanel = document.getElementById('netz-panel');
    if (netzPanel && netzPanel.classList.contains('visible')) {
      // Direkt schließen statt toggleNetzPanel() — das würde isDrawingTrasse wieder abschalten
      netzPanel.classList.remove('visible');
      const btn = document.getElementById('btn-netz-toggle');
      if (btn) btn.classList.remove('active');
    }
    // Verbrauchskreise ausblenden für freie Sicht
    gebaeude.forEach(g => {
      if (g.circleMarker) { map.removeLayer(g.circleMarker); }
      if (g.labelMarker) { map.removeLayer(g.labelMarker); }
    });
    // Aktuelles Segment starten
    setTrasseCurrentSegStart(window.trassePoints.length);
    redrawTrasse();
  } else {
    commitInteraction('draw-trasse');
    trasseRedoPoints = [];
    buttons.forEach(btn => btn.classList.remove('active'));
    hideHint();
    hideTrasseFinishBtn();
    _restoreAfterDraw();
    // Verbrauchskreise wiederherstellen
    updateViz();
    map.getContainer().style.cursor = '';
    map.doubleClickZoom.enable();
    setTrasseDetached(false);
    // Aktuelles Segment abschließen
    if (window.trassePoints.length > window.trasseCurrentSegStart + 1) {
      window.trasseSegments.push({
        start:window.trasseCurrentSegStart,
        end:window.trassePoints.length - 1,
        domains:[trasseDrawDomain],
        manualNetwork:trasseDrawDomain === 'waerme' && !!window._manualWaermeNetzDrawing,
      });
    } else if (window.trassePoints.length > window.trasseCurrentSegStart) {
      // Einzelner Punkt: entfernen
      window.trassePoints.pop();
    }
    redrawTrasse();
    if (window.trassePoints.length > 0) showHint('✓ Trasse gespeichert. Das vorhandene Netz blieb unverändert. Mit „Auto-Netz“ bewusst neu erzeugen.', 7000);
    // Bestandskabel entlang neuer Trasse neu routen
    if (typeof window.updateStromEdgeGeometry === 'function') window.updateStromEdgeGeometry();
  }
}

export function showTrasseFinishBtn() {
  let bar = document.getElementById('trasse-editor-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'trasse-editor-bar';
    bar.setAttribute('role','toolbar');
    bar.setAttribute('aria-label','Wärme-Haupttrasse bearbeiten');
    bar.innerHTML = `
      <div class="trasse-editor-title"><strong>Wärme-Haupttrasse</strong><span>Stützpunkte ziehen · + zwischen Punkten fügt einen Knick ein</span></div>
      <button type="button" id="trasse-undo-btn" title="Letzten neuen Punkt zurücknehmen (Strg/Cmd+Z)">↶</button>
      <button type="button" id="trasse-redo-btn" title="Punkt wiederherstellen (Strg/Cmd+Umschalt+Z)">↷</button>
      <button type="button" id="trasse-branch-btn">⑂ Abzweig</button>
      <button type="button" id="trasse-finish-btn" class="primary">✓ Fertig</button>
      <button type="button" id="trasse-generate-btn" class="generate">⚙ Fertig & Netz erzeugen</button>
      <button type="button" id="trasse-cancel-btn" title="Aktuellen, noch nicht abgeschlossenen Strang verwerfen">Abbrechen</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#trasse-undo-btn').onclick = undoTrassePoint;
    bar.querySelector('#trasse-redo-btn').onclick = redoTrassePoint;
    bar.querySelector('#trasse-branch-btn').onclick = startNewTrasseBranch;
    bar.querySelector('#trasse-finish-btn').onclick = () => {
      const wasStreetHelper = !!window._streetHelperDrawing;
      const wasManualNetwork = !!window._manualWaermeNetzDrawing;
      if (window.isDrawingTrasse) toggleDrawTrasse();
      if (wasManualNetwork) {
        window._manualWaermeNetzDrawing = false;
        showHint('Manuelle Netzzeichnung gespeichert. Mit „Zeichnung als Netz übernehmen“ wird sie zum Wärmenetz.',6000);
      }
      if (wasStreetHelper) {
        window._streetHelperDrawing = false;
        showHint('Ergänzungsweg gespeichert. Über „Wärmenetz erstellen“ kann das Straßen-Netz neu berechnet werden.', 6000);
      }
    };
    bar.querySelector('#trasse-generate-btn').onclick = finishTrasseAndGenerateNetz;
    bar.querySelector('#trasse-cancel-btn').onclick = () => cancelInteraction('draw-trasse');
  }
  const manualHeat = !!window._manualWaermeNetzDrawing;
  const title = bar.querySelector('.trasse-editor-title strong');
  const subtitle = bar.querySelector('.trasse-editor-title span');
  const generate = bar.querySelector('#trasse-generate-btn');
  if (title) title.textContent = manualHeat ? 'Wärmenetz manuell' : 'Wärme-Haupttrasse';
  if (subtitle) subtitle.textContent = manualHeat
    ? 'Vom Einspeisepunkt bis zu jedem Gebäude zeichnen · Gebäude rasten ein'
    : 'Stützpunkte ziehen · + zwischen Punkten fügt einen Knick ein';
  if (generate) generate.textContent = manualHeat ? '✓ Zeichnung als Netz übernehmen' : '⚙ Fertig & Netz erzeugen';
  bar.style.display = 'flex';
}

export function finishTrasseAndGenerateNetz() {
  const manualHeat = !!window._manualWaermeNetzDrawing;
  if (window.isDrawingTrasse) toggleDrawTrasse();
  if (manualHeat) {
    window._manualWaermeNetzDrawing = false;
    confirmManualWaermeNetzFromTrasse();
    return;
  }
  if (window._streetHelperDrawing) {
    createStreetOrientedWaermeNetz();
    return;
  }
  confirmAutoGenerateNetz({
    strategy: 'trasse',
    trasseTreue: document.getElementById('netz-trassentreue')?.value ?? 80,
  });
}

export function startNewTrasseBranch() {
  if (!window.isDrawingTrasse) return;
  trasseRedoPoints = [];
  if (window.trassePoints.length > window.trasseCurrentSegStart + 1) {
    window.trasseSegments.push({
      start:window.trasseCurrentSegStart,
      end:window.trassePoints.length - 1,
      domains:[trasseDrawDomain],
      manualNetwork:trasseDrawDomain === 'waerme' && !!window._manualWaermeNetzDrawing,
    });
  } else if (window.trassePoints.length > window.trasseCurrentSegStart) window.trassePoints.pop();
  setTrasseCurrentSegStart(window.trassePoints.length);
  setTrasseDetached(true);
  redrawTrasse();
  showHint('Klicke auf einen vorhandenen Punkt oder direkt auf eine Trassenlinie, um dort abzuzweigen.');
}

export function hideTrasseFinishBtn() {
  const bar = document.getElementById('trasse-editor-bar');
  if (bar) bar.style.display = 'none';
}

function updateTrasseLinesDuringDrag() {
  if (!Array.isArray(window.trassePolyline)) return;
  window.trassePolyline.forEach(pl => {
    const seg = pl._trasseSegment;
    if (!seg) return;
    pl.setLatLngs(window.trassePoints.slice(seg.start, seg.end + 1));
  });
}

export function insertTrassePoint(segIdx, afterIndex, latlng) {
  const seg = window.trasseSegments[segIdx];
  if (!seg || afterIndex < seg.start || afterIndex >= seg.end) return false;
  const insertAt = afterIndex + 1;
  window.trassePoints.splice(insertAt, 0, L.latLng(latlng.lat, latlng.lng));
  window.trasseSegments.forEach((candidate, idx) => {
    if (idx === segIdx) candidate.end++;
    else if (candidate.start >= insertAt) { candidate.start++; candidate.end++; }
    else if (candidate.end >= insertAt) candidate.end++;
  });
  if (window.trasseCurrentSegStart >= insertAt) setTrasseCurrentSegStart(window.trasseCurrentSegStart + 1);
  redrawTrasse();
  return true;
}

export function redrawTrasse() {
  // Multi-Segment Trasse: jedes Segment als eigene Polyline
  if (window.trassePolyline) {
    if (Array.isArray(window.trassePolyline)) window.trassePolyline.forEach(p => map.removeLayer(p));
    else map.removeLayer(window.trassePolyline);
  }
  setTrassePolyline([]);
  window.trasseEditMarkers.forEach(m => map.removeLayer(m));
  setTrasseEditMarkers([]);

  // Trassen-Ebene ausblendbar (Ansicht-Panel). Default versteckt: undefined/false → nicht zeichnen.
  // Im Zeichenmodus wird trasseVisible erzwungen (siehe toggleDrawTrasse).
  if (!window.trasseVisible) return;

  if (window.trassePoints.length === 0) return;

  // Alle abgeschlossenen Segmente zeichnen
  const allSegs = [...trasseSegments];
  // Plus das aktuell laufende Segment (falls im Zeichenmodus)
  if (window.trassePoints.length > window.trasseCurrentSegStart) {
    allSegs.push({ start: window.trasseCurrentSegStart, end: window.trassePoints.length - 1 });
  }

  allSegs.forEach((seg, allSegIdx) => {
    if (window._streetHelperDrawing && seg.source === 'osm-street') return;
    if (seg.end <= seg.start) return;
    const pts = [];
    for (let i = seg.start; i <= seg.end; i++) pts.push(window.trassePoints[i]);
    if (pts.length >= 2) {
      const domains = seg.domains || ['waerme','strom'];
      const color = domains.includes('waerme') && domains.includes('strom') ? '#ab47bc'
        : domains.includes('strom') ? '#42a5f5' : '#ff9800';
      const pl = L.polyline(pts, { color, weight: 14, opacity: 0.25, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      pl._trasseSegment = seg;
      if (allSegIdx < window.trasseSegments.length) {
        pl.on('contextmenu', (e) => {
          L.DomEvent.stop(e);
          if (window.isDrawingTrasse) return;
          deleteTrasse(allSegIdx);
        });
      }
      window.trassePolyline.push(pl);
    }
  });

  // Stütz- und Pluspunkte gehören ausschließlich zum aktiven Zeichen- bzw.
  // Wiedereinstiegsmodus. Die gespeicherte Trasse kann als ruhige Orientierung
  // sichtbar bleiben, ohne nach „Fertig“ weiter wie ein Editor auszusehen.
  if (!window.isDrawingTrasse && !window.trasseDetached) return;

  // Edit-Handles für alle Punkte — im detached-Modus größer als Snap-Ziele
  const handleSize = window.trasseDetached ? 14 : 8;
  const handleCls = window.trasseDetached ? 'trasse-snap-handle' : 'trasse-edit-handle';
  const icon = L.divIcon({ className: handleCls, html: '', iconSize: [handleSize, handleSize], iconAnchor: [handleSize/2, handleSize/2] });
  // Automatisch übernommene OSM-Straßen können aus Tausenden Stützpunkten
  // bestehen. Sie sind Routinggrundlage, aber keine einzeln bearbeitbare
  // Haupttrasse und erhalten deshalb grundsätzlich keine Karten-Griffe.
  const editablePointIndices = new Set();
  window.trasseSegments.forEach(seg => {
    if (seg.source === 'osm-street') return;
    for (let idx = seg.start; idx <= seg.end; idx++) editablePointIndices.add(idx);
  });
  for (let idx = window.trasseCurrentSegStart; idx < window.trassePoints.length; idx++) editablePointIndices.add(idx);
  window.trassePoints.forEach((pt, idx) => {
    if (!editablePointIndices.has(idx)) return;
    const m = L.marker(pt, { draggable: !window.trasseDetached, icon: icon, zIndexOffset: 2000 }).addTo(map);
    if (!window.trasseDetached) {
      m.on('drag', e => {
        window.trassePoints[idx] = e.target.getLatLng();
        updateTrasseLinesDuringDrag();
      });
      m.on('dragend', () => {
        redrawTrasse();
        showHint('Trassenverlauf geändert. Mit „Fertig & Netz erzeugen“ werden die Wärmeleitungen neu daran angebunden.', 5000);
      });
    }
    window.trasseEditMarkers.push(m);
  });

  // Einfügegriffe zwischen Stützpunkten: realistische Kurven und Straßenverläufe
  // lassen sich so nachträglich verfeinern, ohne einen Strang neu zu zeichnen.
  if (!window.trasseDetached) {
    window.trasseSegments.forEach((seg, segIdx) => {
      if (seg.source === 'osm-street') return;
      for (let idx = seg.start; idx < seg.end; idx++) {
        const a = window.trassePoints[idx], b = window.trassePoints[idx + 1];
        if (!a || !b) continue;
        const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
        const icon = L.divIcon({className:'trasse-insert-handle',html:'+',iconSize:[18,18],iconAnchor:[9,9]});
        const marker = L.marker(mid,{icon,zIndexOffset:1900}).addTo(map);
        marker.on('click', event => {
          L.DomEvent.stopPropagation(event);
          insertTrassePoint(segIdx,idx,mid);
        });
        window.trasseEditMarkers.push(marker);
      }
    });
  }
}

// Trassen ein-/ausblenden (Ansicht-Panel). Default versteckt.
export function setTrasseVisible(visible) {
  window.trasseVisible = !!visible;
  redrawTrasse();
}

export function deleteTrasse(segIdx) {
  const seg = window.trasseSegments[segIdx];
  if (!seg) return;
  const count = seg.end - seg.start + 1;
  window.trassePoints.splice(seg.start, count);
  window.trasseSegments.splice(segIdx, 1);
  for (let i = segIdx; i < window.trasseSegments.length; i++) {
    window.trasseSegments[i].start -= count;
    window.trasseSegments[i].end   -= count;
  }
  if (window.trasseCurrentSegStart > seg.start) {
    setTrasseCurrentSegStart(Math.max(0, window.trasseCurrentSegStart - count));
  }
  redrawTrasse();
  if (typeof window.updateStromEdgeGeometry === 'function') window.updateStromEdgeGeometry();
}

export function clearTrasse() {
  setTrassePoints([]);
  setTrasseSegments([]);
  setTrasseCurrentSegStart(0);
  setTrasseDetached(false);
  redrawTrasse();
  showHint('Trasse gelöscht. Wärme- und Stromleitungen bleiben bis zur bewussten Neuberechnung erhalten.', 6000);
}

export function toggleFliessgewaesserPanel() {
  const p = document.getElementById('fliessgewaesser-panel');
  const btn = document.getElementById('btn-fliessgewaesser-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
    if (window.isDrawingRiver) toggleDrawRiver();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (window.fliessgewaesser) {
      document.getElementById('fg-draw-section').style.display = 'none';
      document.getElementById('fg-data-section').style.display = 'block';
      const fgEl = document.getElementById('fg-leistung');
      if (fgEl && parseFloat(fgEl.value) <= 200) _setDefault30Pct('fg-leistung');
      updateFliessgewaesserAbkuehlungDisplay();
    } else {
      document.getElementById('fg-draw-section').style.display = 'block';
      document.getElementById('fg-data-section').style.display = 'none';
    }
  }
}

export function toggleDrawRiver() {
  window.isDrawingRiver = !window.isDrawingRiver;
  const btn = document.getElementById('btn-draw-river');
  if (window.isDrawingRiver) {
    beginInteraction({id:'draw-river',label:'Flussverlauf zeichnen',hint:'Mindestens zwei Punkte setzen und anschließend fertigstellen.',cancel:()=>{
      window.riverPoints = [];
      if (window.isDrawingRiver) toggleDrawRiver();
    }});
    if (window.fliessgewaesser) clearFliessgewaesser();
    window.riverPoints = [];
    redrawRiverDuringDraw();
    btn.classList.add('active');
    btn.textContent = 'Fertig (oder Doppelklick auf Karte)';
    btn.onclick = function(){ tryFinishOrToggleRiver(); };
    showHint('Klicke Punkte für den Fluss. Doppelklick auf die Karte oder Button „Fertig” zum Beenden.');
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
  } else {
    commitInteraction('draw-river');
    btn.classList.remove('active');
    btn.textContent = 'Fluss zeichnen';
    btn.onclick = function(){ toggleDrawRiver(); };
    hideHint();
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
    map.doubleClickZoom.enable();
    if (window.riverDrawPolyline) { map.removeLayer(window.riverDrawPolyline); window.riverDrawPolyline = null; }
    window.riverEditMarkers.forEach(m => map.removeLayer(m));
    window.riverEditMarkers = [];
  }
}

export function tryFinishOrToggleRiver() {
  if (window.isDrawingRiver && window.riverPoints.length >= 2) {
    finishDrawRiver();
    document.getElementById('btn-draw-river').onclick = function(){ toggleDrawRiver(); };
    map.doubleClickZoom.enable();
  } else {
    toggleDrawRiver();
  }
}

export function redrawRiverDuringDraw() {
  if (window.riverDrawPolyline) map.removeLayer(window.riverDrawPolyline);
  window.riverEditMarkers.forEach(m => map.removeLayer(m));
  window.riverEditMarkers = [];
  if (window.riverPoints.length > 0) {
    window.riverDrawPolyline = L.polyline(window.riverPoints, {
      color: '#26a69a', weight: 14, opacity: 0.25, lineCap: 'round', lineJoin: 'round'
    }).addTo(map);
    const icon = L.divIcon({ className: 'fg-edit-handle', html: '', iconSize: [6, 6], iconAnchor: [3, 3] });
    window.riverPoints.forEach((pt, idx) => {
      const m = L.marker(pt, { draggable: true, icon: icon, zIndexOffset: 2000 }).addTo(map);
      m.on('drag', e => {
        window.riverPoints[idx] = e.target.getLatLng();
        window.riverDrawPolyline.setLatLngs(window.riverPoints);
      });
      window.riverEditMarkers.push(m);
    });
  } else {
    window.riverDrawPolyline = null;
  }
}

export function finishDrawRiver() {
  if (window.riverPoints.length < 2) return;
  commitInteraction('draw-river');
  const latlngs = window.riverPoints.map(p => ({ lat: p.lat, lng: p.lng }));
  const durchfluss = parseFloat(document.getElementById('fg-durchfluss').value) || 50;
  const leistung = parseFloat(document.getElementById('fg-leistung').value) || 200;
  const jaz = parseFloat(document.getElementById('fg-jaz').value) || 4.5;
  window.fliessgewaesser = { latlngs, durchflussLs: durchfluss, leistungKw: leistung, jaz, visible: window.fliessgewaesserVisible };
  moBeiAktivierung('fg');
  syncErzeugerElektroAsset('fg');
  window.isDrawingRiver = false;
  window.riverPoints = [];
  if (window.riverDrawPolyline) { map.removeLayer(window.riverDrawPolyline); window.riverDrawPolyline = null; }
  window.riverEditMarkers.forEach(m => map.removeLayer(m));
  window.riverEditMarkers = [];
  const drawBtn = document.getElementById('btn-draw-river');
  drawBtn.classList.remove('active');
  drawBtn.textContent = 'Fluss zeichnen';
  drawBtn.onclick = function(){ toggleDrawRiver(); };
  map.doubleClickZoom.enable();
  document.getElementById('fg-draw-section').style.display = 'none';
  document.getElementById('fg-data-section').style.display = 'block';
  hideHint();
  map.getContainer().style.cursor = '';
  redrawFliessgewaesser();
  updateFliessgewaesserAbkuehlungDisplay();
  updateFliessgewaesserVisibility();
  redrawErzeugerIcons();
}

export function redrawFliessgewaesser() {
  if (!window.fliessgewaesserLayerGroup) window.fliessgewaesserLayerGroup = L.layerGroup().addTo(map);
  window.fliessgewaesserLayerGroup.clearLayers();
  if (!window.fliessgewaesser || !window.fliessgewaesser.latlngs || window.fliessgewaesser.latlngs.length < 2) return;
  const pts = window.fliessgewaesser.latlngs.map(p => L.latLng(p.lat, p.lng));
  const warmPart = pts.length >= 2 ? [pts[0], pts[1]] : pts;
  const cooledPart = pts.length > 2 ? pts.slice(1) : [];
  const oberlaufColor = '#26a69a';
  const { colorHex: unterlaufColor } = getFliessgewaesserAbkuehlung();
  /* Abstand zoomabhängig: immer ca. 5 px zwischen den Linien, damit sie auch rausgezoomt einzeln erkennbar bleiben */
  const zoom = map.getZoom();
  const refLat = pts[0].lat;
  const metersPerPixel = (156543.03392 * Math.cos(refLat * Math.PI / 180)) / Math.pow(2, zoom);
  const RIVER_OFFSET_M = Math.max(2.5, 5 * metersPerPixel);
  const SINUS_AMPLITUDE_M = 1.9;
  const SINUS_WAVES = 10;
  function addTripleLine(part, color, opacity, pathClass) {
    if (part.length < 2) return;
    const left = sinusWobblePolyline(offsetPolyline(part, -RIVER_OFFSET_M), SINUS_AMPLITUDE_M, SINUS_WAVES);
    const right = sinusWobblePolyline(offsetPolyline(part, RIVER_OFFSET_M), SINUS_AMPLITUDE_M, SINUS_WAVES);
    const centerWobble = sinusWobblePolyline(part, SINUS_AMPLITUDE_M, SINUS_WAVES);
    const rows = [left, centerWobble, right];
    rows.forEach((latLngs, phase) => {
      const layer = L.polyline(latLngs, { color: color, weight: 2.5, opacity: opacity }).addTo(window.fliessgewaesserLayerGroup);
      const phaseClass = phase === 0 ? '' : ' phase-' + phase;
      function apply() {
        const el = layer.getElement && layer.getElement();
        if (!el) return;
        const path = el.tagName && el.tagName.toLowerCase() === 'path' ? el : el.querySelector('path');
        if (path) {
          path.classList.add(pathClass);
          if (phaseClass) path.classList.add('phase-' + phase);
        }
      }
      layer.on('add', function() { setTimeout(apply, 20); });
      setTimeout(apply, 20);
    });
  }
  if (warmPart.length >= 2) addTripleLine(warmPart, oberlaufColor, 0.95, 'river-flow-path');
  if (cooledPart.length >= 2) addTripleLine(cooledPart, unterlaufColor, 0.9, 'river-flow-cooled-path');
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  let connectionPoint = pts[0];
  if (zId && !isNaN(zId)) {
    const g = gebaeude.find(x => x.id === zId);
    if (g && g.polygon) {
      const center = polygonCenter(g.polygon);
      connectionPoint = closestPointOnPolyline(pts, center);
      if (connectionPoint) {
        L.polyline([connectionPoint, center], { color: '#e53935', weight: 4, opacity: 0.9 }).addTo(window.fliessgewaesserLayerGroup);
      }
    }
  }
  const wpIcon = L.divIcon({ className: 'fg-wp-marker', html: '⚡', iconSize: [22, 22], iconAnchor: [11, 11] });
  L.marker(connectionPoint, { icon: wpIcon, title: 'Wärmepumpe Anschluss Heizzentrale' }).addTo(window.fliessgewaesserLayerGroup);
  /* Nach dem Zeichnen: verschiebbare Punkte – blau und klein (nur Fließgewässer) */
  const icon = L.divIcon({ className: 'fg-edit-handle', html: '', iconSize: [6, 6], iconAnchor: [3, 3] });
  pts.forEach((pt, idx) => {
    const m = L.marker(pt, { draggable: true, icon: icon, zIndexOffset: 2000 }).addTo(window.fliessgewaesserLayerGroup);
    m.on('drag', e => {
      window.fliessgewaesser.latlngs[idx] = { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng };
    });
    m.on('dragend', () => redrawFliessgewaesser());
  });
  if (window.fliessgewaesserVisible) {
    if (!map.hasLayer(window.fliessgewaesserLayerGroup)) window.fliessgewaesserLayerGroup.addTo(map);
  }
  updateFliessgewaesserAbkuehlungDisplay();
  redrawVerbindungslinien();
}

export function updateFliessgewaesserVisibility() {
  if (!window.fliessgewaesser || !fliessgewaesserLayerGroup) return;
  if (window.fliessgewaesserVisible) {
    if (!map.hasLayer(window.fliessgewaesserLayerGroup)) window.fliessgewaesserLayerGroup.addTo(map);
  } else {
    if (map.hasLayer(window.fliessgewaesserLayerGroup)) map.removeLayer(window.fliessgewaesserLayerGroup);
  }
}

export function setFliessgewaesserVisible(visible) {
  _setFliessgewaesserVisible(visible); // Modul-Binding in 01-globals aktuell halten
  window.fliessgewaesserVisible = visible;
  updateFliessgewaesserVisibility();
}

export function getFliessgewaesserAbkuehlung() {
  const durchfluss = parseFloat(document.getElementById('fg-durchfluss')?.value) || window.fliessgewaesser?.durchflussLs || 50;
  const leistung = parseFloat(document.getElementById('fg-leistung')?.value) || window.fliessgewaesser?.leistungKw || 200;
  if (!durchfluss || durchfluss <= 0) return { deltaT: 0, colorHex: '#26a69a' };
  const cWater = 4.184;
  const deltaT = leistung / (durchfluss * cWater);
  const t = Math.min(1, deltaT / 2);
  const r = Math.round(38 + (129 - 38) * t);
  const g = Math.round(166 + (212 - 166) * t);
  const b = Math.round(154 + (250 - 154) * t);
  const colorHex = '#' + [r, g, b].map(x => ('0' + x.toString(16)).slice(-2)).join('');
  return { deltaT, colorHex };
}

export function updateFliessgewaesserAbkuehlungDisplay() {
  const el = document.getElementById('fg-abkuehlung-k');
  if (!el) return;
  const { deltaT } = getFliessgewaesserAbkuehlung();
  el.textContent = (Math.round(deltaT * 100) / 100).toFixed(2) + ' K';
}

export function updateFliessgewaesserData() {
  if (!window.fliessgewaesser) return;
  window.fliessgewaesser.durchflussLs = parseFloat(document.getElementById('fg-durchfluss').value) || 50;
  window.fliessgewaesser.leistungKw = parseFloat(document.getElementById('fg-leistung').value) || 200;
  window.fliessgewaesser.jaz = parseFloat(document.getElementById('fg-jaz').value) || 4.5;
  updateFliessgewaesserAbkuehlungDisplay();
  redrawFliessgewaesser();
  const waerme  = parseFloat(document.getElementById('fg-waerme').value) || 0;
  const fgJaz   = parseFloat(document.getElementById('fg-jaz').value) || 4.5;
  const fgCo2   = waerme > 0 ? waerme / fgJaz * stromEmF   / 1000 : null;
  const fgCo2LZ = waerme > 0 ? waerme / fgJaz * stromEmFLZ / 1000 : null;
  document.getElementById('fg-co2').textContent = fgCo2 ? `${fgCo2.toFixed(1)} t/a (2026) · ${fgCo2LZ.toFixed(1)} t/a (Ø 2030–50)` : '—';
  updateErzeugerAssetProps('fg');
}

export function clearFliessgewaesser() {
  window.fliessgewaesser = null;
  moBeiDeaktivierung('fg');
  removeErzeugerElektroAsset('fg');
  if (window.fliessgewaesserLayerGroup) {
    window.fliessgewaesserLayerGroup.clearLayers();
    if (map.hasLayer(window.fliessgewaesserLayerGroup)) map.removeLayer(window.fliessgewaesserLayerGroup);
  }
  document.getElementById('fg-data-section').style.display = 'none';
  document.getElementById('fg-draw-section').style.display = 'block';
  document.getElementById('fg-visible').checked = true;
  window.fliessgewaesserVisible = true;
  redrawErzeugerIcons();
}

/* ── Wirtschaftlichkeit ──────────────────────────────────────────────────── */
export function calcWirtschaftlichkeit(invest, nutzungJahre, zinsPct, betriebJahr, waermeMwh) {
  if (!invest || invest <= 0) return null;
  const i = zinsPct / 100;
  const n = nutzungJahre || 20;
  const annuityFactor = i > 0 ? i * Math.pow(1+i, n) / (Math.pow(1+i, n) - 1) : 1/n;
  const kapitalkosten = invest * annuityFactor;
  const jahreskosten = kapitalkosten + (betriebJahr || 0);
  const wgk = waermeMwh > 0 ? jahreskosten / waermeMwh / 10 : null; // ct/kWh
  return { kapitalkosten, jahreskosten, wgk };
}

// CO₂-Kostenanteil für einen Erzeuger (€/a)
// brennstoffMwh: Primärenergie- oder Stromeinsatz [MWh/a]
// emf: Emissionsfaktor [g CO₂/kWh]
// isFossil: true = Gas/Öl (immer berücksichtigt); false = Strom/Biomasse/FW (nur wenn Switch "alle ET")
export function _co2KostenET(brennstoffMwh, emf, isFossil) {
  const pCo2   = parseFloat(document.getElementById('wirt-p-co2')?.value) || 0;
  const alleET = document.getElementById('wirt-co2-alle')?.checked !== false;
  if (pCo2 <= 0 || (!isFossil && !alleET)) return 0;
  return brennstoffMwh * emf * pCo2 / 1000; // MWh × g/kWh × €/t / 1000 = €/a
}

export function updateWirtDisplay(prefix, result) {
  const kapEl = document.getElementById(prefix + '-wirt-kapital');
  const jahEl = document.getElementById(prefix + '-wirt-jahres');
  const wgkEl = document.getElementById(prefix + '-wirt-wgk');
  if (!kapEl) return;
  if (!result) { kapEl.textContent = '—'; jahEl.textContent = '—'; wgkEl.textContent = '—'; return; }
  kapEl.textContent = result.kapitalkosten.toLocaleString('de-DE', {maximumFractionDigits:0}) + ' €/a';
  jahEl.textContent = result.jahreskosten.toLocaleString('de-DE', {maximumFractionDigits:0}) + ' €/a';
  wgkEl.textContent = result.wgk != null ? result.wgk.toLocaleString('de-DE', {minimumFractionDigits:1, maximumFractionDigits:1}) + ' ct/kWh' : '—';
}

/* ── Luft-Wasser-Wärmepumpe: Platzbedarf + Schall Freifeld ───────────────── */
export function lwWpPlatzbedarfM2(leistungKw) {
  return Math.max(2, 2 + leistungKw * 0.35);
}
// Freifeld-Radius (ohne Gebäudedämpfung); Zusatzdämpfung wird punktbezogen bei der Tooltip-Berechnung berücksichtigt.
export function lwWpSchallRadiusM(lwaDb, zielDb) {
  if (lwaDb <= zielDb) return 0;
  return Math.pow(10, (lwaDb - 11 - zielDb) / 20);
}
export function toggleLwWpPanel() {
  const p = document.getElementById('lwwp-panel');
  const btn = document.getElementById('btn-lwwp-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
    if (window.isPlacingLwWp) togglePlaceLwWp();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (window.lwWp) {
      document.getElementById('lwwp-data-section').style.display = 'block';
      const plBtn = document.getElementById('btn-place-lwwp');
      if (plBtn && window.lwWp.lat != null) plBtn.textContent = 'Position verschieben';
      // 30%-Standardleistung wenn noch auf dem alten Mindestwert
      const lwEl = document.getElementById('lwwp-leistung');
      if (lwEl && parseFloat(lwEl.value) <= 12) _setDefault30Pct('lwwp-leistung');
      updateLwWpDisplay();
    } else {
      document.getElementById('lwwp-data-section').style.display = 'none';
    }
  }
}

export function togglePlaceLwWp() {
  window.isPlacingLwWp = !window.isPlacingLwWp;
  const btn = document.getElementById('btn-place-lwwp');
  if (window.isPlacingLwWp) {
    beginInteraction({id:'place-air-heat-pump',label:'Luft-Wärmepumpe platzieren',hint:'Position auf der Karte anklicken.',cancel:()=>{ if (window.isPlacingLwWp) togglePlaceLwWp(); }});
    btn.classList.add('active');
    btn.textContent = 'Klicken auf Karte zum Platzieren';
    showHint('Klicke auf die Karte, um die Luft-Wasser-Wärmepumpe zu platzieren.');
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    document.getElementById('lwwp-panel').classList.remove('visible');
    document.getElementById('btn-lwwp-toggle')?.classList.remove('active');
  } else {
    cancelInteraction('place-air-heat-pump');
    btn.classList.remove('active');
    btn.textContent = window.lwWp ? 'Position verschieben' : 'Auf Karte platzieren';
    hideHint();
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
  }
}

export function placeLwWpAt(latlng) {
  const leistung = parseFloat(document.getElementById('lwwp-leistung').value) || 12;
  const lwa = parseFloat(document.getElementById('lwwp-lwa').value) || 80;
  window.lwWp = { lat: latlng.lat, lng: latlng.lng, leistungKw: leistung, lwaDb: lwa, visible: window.lwWpVisible };
  document.getElementById('lwwp-man-laenge').value = '';
  document.getElementById('lwwp-man-breite').value = '';
  window.isPlacingLwWp = false;
  commitInteraction('place-air-heat-pump');
  document.getElementById('btn-place-lwwp').classList.remove('active');
  document.getElementById('btn-place-lwwp').textContent = 'Position verschieben';
  document.getElementById('lwwp-data-section').style.display = 'block';
  hideHint();
  map.getContainer().style.cursor = '';
  // Panel nach Platzierung wieder einblenden
  hidePanels();
  document.getElementById('lwwp-panel').classList.add('visible');
  document.getElementById('btn-lwwp-toggle')?.classList.add('active');
  moBeiAktivierung('lwwp');
  syncErzeugerElektroAsset('lwwp');
  window.lwWpVisible = true;
  window.lwWpSchallVisible = true;
  // Lazy-Init: falls LayerGroup nicht gesetzt, jetzt erstellen
  if (!window.lwWpLayerGroup)       window.lwWpLayerGroup = L.layerGroup().addTo(map);
  if (!window.lwWpSchallLayerGroup) window.lwWpSchallLayerGroup = L.layerGroup();
  redrawLwWp();
  updateLwWpDisplay();
  updateLwWpVisibility();
  redrawErzeugerIcons();
}

export function redrawLwWp() {
  // Lazy-Init falls nötig
  if (!window.lwWpLayerGroup)       window.lwWpLayerGroup = L.layerGroup().addTo(map);
  if (!window.lwWpSchallLayerGroup) window.lwWpSchallLayerGroup = L.layerGroup();
  window.lwWpLayerGroup.clearLayers();
  if (!window.lwWp || window.lwWp.lat == null || window.lwWp.lng == null) return;
  const pt = L.latLng(window.lwWp.lat, window.lwWp.lng);
  const leistung = window.lwWp.leistungKw;
  const lwa = window.lwWp.lwaDb;
  const platzM2 = lwWpPlatzbedarfM2(leistung);
  const rwAuto = Math.sqrt(platzM2);   // Quadratisch als Startwert
  const rlAuto = rwAuto;
  const manL = parseFloat(document.getElementById('lwwp-man-laenge')?.value) || 0;
  const manB = parseFloat(document.getElementById('lwwp-man-breite')?.value) || 0;
  const rl = manL > 0 ? manL : rlAuto;
  const rw = manB > 0 ? manB : rwAuto;
  const latPerM = 1 / 111320;
  const lngPerM = 1 / (111320 * Math.cos(pt.lat * Math.PI / 180));
  // Mutable bounds für Seitengriffe
  const sw = { lat: pt.lat - rl / 2 * latPerM, lng: pt.lng - rw / 2 * lngPerM };
  const ne = { lat: pt.lat + rl / 2 * latPerM, lng: pt.lng + rw / 2 * lngPerM };
  const reqF = platzM2;
  const tol = 0.08;
  function actF() { return ((ne.lat - sw.lat) / latPerM) * ((ne.lng - sw.lng) / lngPerM); }
  function fb(aF) {
    if (aF < reqF * (1 - tol)) return { c: '#ef5350', o: 0.30 };
    if (aF > reqF * (1 + tol)) return { c: '#66bb6a', o: 0.22 };
    return { c: '#388e3c', o: 0.20 };
  }
  const f0 = fb(actF());
  const rect = L.rectangle([sw, ne], { color: '#388e3c', weight: 2, fillColor: f0.c, fillOpacity: f0.o })
    .bindTooltip(`Platzbedarf: ${platzM2.toFixed(1)} m² min. · ${rl.toFixed(1)}×${rw.toFixed(1)} m`, {sticky:true})
    .addTo(window.lwWpLayerGroup);
  window.lwWpSchallLayerGroup.clearLayers();
  const schallStufen = [55, 50, 45, 40, 35];
  const schallFarben = ['#b71c1c', '#e65100', '#f9a825', '#8bc34a', '#2e7d32'];
  for (let i = schallStufen.length - 1; i >= 0; i--) {
    const r = lwWpSchallRadiusM(lwa, schallStufen[i]);
    if (r > 0.5 && r < 500) {
      const circle = L.circle(pt, { radius: r, color: schallFarben[i], weight: 1.5, fillColor: schallFarben[i], fillOpacity: 0.12 }).addTo(window.lwWpSchallLayerGroup);
      circle.bindTooltip('', {sticky: true, direction: 'top', opacity: 0.9});
      circle.on('mousemove', ev => {
        const d = pt.distanceTo(ev.latlng);
        if (d <= 0) return;
        const lpAtD = lwa - 11 - 20 * Math.log10(d);
        const tt = circle.getTooltip();
        if (!tt) return;
        tt.setContent(`<div class="lwwp-tooltip">Abstand: ${d.toFixed(1)} m<br>Pegel ≈ ${lpAtD.toFixed(1)} dB(A)</div>`);
        tt.setLatLng(ev.latlng);
        if (!map.hasLayer(tt)) circle.openTooltip(ev.latlng);
      });
    }
  }
  // Hinweis: Größen-Anfasser (weiße Quadrate) wurden entfernt — wirkten unruhig.
  // Die Fläche skaliert automatisch aus dem Platzbedarf; manuelle Maße weiterhin
  // über die Felder „Länge/Breite manuell" im LW-WP-Panel.
  // Hauptmarker (Gerät verschieben) — groß genug um auch ohne Zoom greifbar zu sein
  const wpIcon = L.divIcon({ className: '', html: '<div style="width:32px;height:32px;background:rgba(56,142,60,0.5);border:2px solid #66bb6a;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 0 8px rgba(102,187,106,0.5);">' + windSvg('#c8e6c9',17,14) + '</div>', iconSize: [32,32], iconAnchor: [16,16] });
  const marker = L.marker(pt, { draggable: true, icon: wpIcon, title: 'Luft-Wasser-WP verschieben', zIndexOffset: 3000 }).addTo(window.lwWpLayerGroup);
  marker.on('dragend', function() {
    window.lwWp.lat = marker.getLatLng().lat;
    window.lwWp.lng = marker.getLatLng().lng;
    redrawLwWp();
    moveErzeugerElektroAsset('lwwp');
  });
  updateLwWpVisibility();
  redrawVerbindungslinien();
}

export function updateLwWpDisplay() {
  if (!window.lwWp) return;
  const leistung = window.lwWp.leistungKw;
  const lwa = window.lwWp.lwaDb;
  const jaz = parseFloat(document.getElementById('lwwp-jaz').value) || 3.0;
  const waermeJahr = parseFloat(document.getElementById('lwwp-waerme').value) || 0;
  const platzM2 = lwWpPlatzbedarfM2(leistung);
  const rwAuto = Math.sqrt(platzM2);
  const rlAuto = rwAuto;
  const manL = parseFloat(document.getElementById('lwwp-man-laenge')?.value) || 0;
  const manB = parseFloat(document.getElementById('lwwp-man-breite')?.value) || 0;
  const rl = manL > 0 ? manL : rlAuto;
  const rw = manB > 0 ? manB : rwAuto;
  const manArea = manL > 0 && manB > 0 ? manL * manB : 0;
  document.getElementById('lwwp-platz').textContent = platzM2.toFixed(1) + ' m² (min.)';
  document.getElementById('lwwp-abm').textContent = `${rl.toFixed(1)} × ${rw.toFixed(1)} m${manL>0||manB>0?' ✏':''}`;
  const warnEl = document.getElementById('lwwp-flaeche-warn');
  if (warnEl) {
    if (manArea > 0 && manArea < platzM2) {
      warnEl.style.display = '';
      warnEl.textContent = `⚠ ${manArea.toFixed(0)} m² eingegeben, mind. ${platzM2.toFixed(0)} m² benötigt`;
    } else {
      warnEl.style.display = 'none';
    }
  }
  if (waermeJahr > 0) {
    const strom = waermeJahr / jaz;
    const luft = waermeJahr * (jaz - 1) / jaz;
    const co2    = strom * stromEmF   / 1000;
    const co2lz  = strom * stromEmFLZ / 1000;
    document.getElementById('lwwp-strom-lbl').style.display = '';
    document.getElementById('lwwp-strom').style.display = '';
    document.getElementById('lwwp-luft-lbl').style.display = '';
    document.getElementById('lwwp-luft').style.display = '';
    document.getElementById('lwwp-strom').textContent = strom.toFixed(0) + ' MWh/a';
    document.getElementById('lwwp-luft').textContent = luft.toFixed(0) + ' MWh/a';
    document.getElementById('lwwp-co2-lbl').style.display = '';
    document.getElementById('lwwp-co2').style.display = '';
    document.getElementById('lwwp-co2').textContent = `${co2.toFixed(1)} t/a (2026) · ${co2lz.toFixed(1)} t/a (Ø 2030–50)`;
  } else {
    ['lwwp-strom-lbl','lwwp-strom','lwwp-luft-lbl','lwwp-luft','lwwp-co2-lbl','lwwp-co2'].forEach(id => document.getElementById(id).style.display = 'none');
  }
  const schallRows = [55, 50, 45, 40, 35].map(lp => {
    const r = lwWpSchallRadiusM(lwa, lp);
    return '&lt; ' + lp + ' dB: ' + (r >= 500 ? '&gt;500' : r.toFixed(1)) + ' m';
  });
  document.getElementById('lwwp-schall-tabelle').innerHTML = schallRows.join('<br>');
  updateErzeugerAssetProps('lwwp');
}

export function calcLwaAuto(kw) {
  // LWA-Schätzung aus Leistung: basierend auf Herstellerdaten (Vaillant, Stiebel Eltron,
  // Viessmann, Daikin u.a.) und EU-Verordnung 813/2013 Ecodesign-Grenzwerten.
  // Zwei-Segment-Logarithmus: kleine Anlagen (≤50 kW) skalieren moderater,
  // große Anlagen (>50 kW) haben überproportional mehr Ventilatoren/Kompressoren.
  const x = Math.max(kw, 1);
  const raw = x <= 50
    ? 47 + 12 * Math.log10(x)   // Residential/klein-gewerblich
    : 30 + 22 * Math.log10(x);  // Groß-gewerblich/industriell
  return Math.round(Math.min(100, Math.max(45, raw)));
}

export function updateLwWpData() {
  if (!window.lwWp) return;
  window.lwWp.leistungKw = parseFloat(document.getElementById('lwwp-leistung').value) || 100;
  // LWA: nur auto-berechnen wenn noch auf Default (80) oder wenn Leistung geändert
  const lwaEl = document.getElementById('lwwp-lwa');
  if (lwaEl && !lwaEl._userEdited) {
    const autoLwa = calcLwaAuto(window.lwWp.leistungKw);
    lwaEl.value = autoLwa;
    lwaEl.title = `Auto: ${autoLwa} dB(A) bei ${lwWp.leistungKw} kW — überschreibbar`;
  }
  window.lwWp.lwaDb = parseFloat(document.getElementById('lwwp-lwa').value) || calcLwaAuto(window.lwWp.leistungKw);
  updateLwWpDisplay();
  redrawLwWp();
}

export function lwwpUseNetworkValues() {
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  const lastKw = calculatedLoad && calculatedLoad[zId] ? calculatedLoad[zId] : 0;
  const connectedIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const verbrauchMWh = gebaeude.filter(g => connectedIds.has(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const lossAnnual = netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0);
  const erzeugungMWh = verbrauchMWh + lossAnnual * 8.76;
  if (lastKw > 0) document.getElementById('lwwp-leistung').value = Math.round(lastKw);
  if (erzeugungMWh > 0) document.getElementById('lwwp-waerme').value = Math.round(erzeugungMWh);
  updateLwWpData();
}

export function setLwWpVisible(visible) {
  window.lwWpVisible = visible;
  updateLwWpVisibility();
}

export function updateLwWpVisibility() {
  if (!window.lwWp || !window.lwWpLayerGroup) return;
  if (!window.lwWpSchallLayerGroup) window.lwWpSchallLayerGroup = L.layerGroup();
  if (window.lwWpVisible) {
    if (!map.hasLayer(window.lwWpLayerGroup)) window.lwWpLayerGroup.addTo(map);
    if (window.lwWpSchallVisible) {
      if (!map.hasLayer(window.lwWpSchallLayerGroup)) window.lwWpSchallLayerGroup.addTo(map);
    } else {
      if (map.hasLayer(window.lwWpSchallLayerGroup)) map.removeLayer(window.lwWpSchallLayerGroup);
    }
  } else {
    if (map.hasLayer(window.lwWpLayerGroup)) map.removeLayer(window.lwWpLayerGroup);
    if (map.hasLayer(window.lwWpSchallLayerGroup)) map.removeLayer(window.lwWpSchallLayerGroup);
  }
}

export function setSchallVisible(visible) {
  window.lwWpSchallVisible = visible;
  updateLwWpVisibility();
}

export function clearLwWp() {
  window.lwWp = null;
  window.isPlacingLwWp = false;
  cancelInteraction('place-air-heat-pump');
  moBeiDeaktivierung('lwwp');
  removeErzeugerElektroAsset('lwwp');
  if (window.lwWpLayerGroup) {
    window.lwWpLayerGroup.clearLayers();
    if (map.hasLayer(window.lwWpLayerGroup)) map.removeLayer(window.lwWpLayerGroup);
  }
  if (window.lwWpSchallLayerGroup) {
    window.lwWpSchallLayerGroup.clearLayers();
    if (map.hasLayer(window.lwWpSchallLayerGroup)) map.removeLayer(window.lwWpSchallLayerGroup);
  }
  document.getElementById('lwwp-data-section').style.display = 'none';
  const placeButton = document.getElementById('btn-place-lwwp');
  if (placeButton) {
    placeButton.classList.remove('active');
    placeButton.textContent = 'Auf Karte platzieren';
  }
  map.getContainer().style.cursor = '';
  _restoreAfterDraw();
  document.getElementById('lwwp-visible').checked = true;
  document.getElementById('lwwp-schall-visible').checked = true;
  window.lwWpVisible = true;
  window.lwWpSchallVisible = true;
  redrawErzeugerIcons();
}

export function toggleKennwertePanel() {
  const p = document.getElementById('kennwerte-panel');
  const btn = document.getElementById('btn-kennwerte-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) { p.classList.add('visible'); btn.classList.add('active'); }
}
