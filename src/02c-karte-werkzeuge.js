// ── 02c-karte-werkzeuge.js — Zeichenwerkzeuge, Trasse, Fließgewässer, LWWP, Wirtschaftlichkeit ──
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
  const nGeb      = gebaeude.filter(g => g.polygon).length;
  const labelZoom = nGeb > 200 ? 19 : nGeb > 80 ? 18 : nGeb > 30 ? 17 : 16;
  const legendBar = document.getElementById('legend-bar');

  if (currentMode === 'waerme' || currentMode === 'spez') {
    document.getElementById('legend-color-title').textContent = 'Farbe = Spez. Verbrauch';
    document.getElementById('leg-min').textContent = '≤ 20';
    document.getElementById('leg-max').textContent = '≥ 250';
    legendBar.style.background = 'linear-gradient(90deg, #4caf50, #f9a825, #f44336, #640000)';
  } else if (currentMode === 'verlust') {
    document.getElementById('legend-color-title').textContent = 'Farbe = Zuger. Verlustanteil';
    document.getElementById('leg-min').textContent = '0 %';
    document.getElementById('leg-max').textContent = '≥ 20 %';
    legendBar.style.background = 'linear-gradient(90deg, #4caf50, #f9a825, #e53935)';
  } else if (currentMode === 'strom') {
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

  const sizeModeName = {waerme:'Wärmeverbrauch',spez:'Spez. Verbrauch',heizlast:'Heizlast',verlust:'Zuger. Netzverlust',strom:'Strombedarf'}[currentMode];
  document.getElementById('legend-size-title').textContent=`Kreisgröße = ${sizeModeName}`;

  const legendCircles = document.getElementById('legend-circles');
  if(currentViz==='bar'){
    legendCircles.closest('.legend-row').querySelector('div:first-child').style.display='none';
    document.getElementById('legend-size-title').textContent=`Balkenhöhe = ${sizeModeName}`;
  } else {
    legendCircles.closest('.legend-row').querySelector('div:first-child').style.display='';
  }

  gebaeude.forEach(g=>{
    const stats = getComputedStats(g, globalYear);
    
    const excluded = isExcluded(g.id);
    if(g.polygonLayer){
      if (excluded) {
        g.polygonLayer.setStyle({fillColor:'#555', color:'#555', fillOpacity:0.08, dashArray:'6 4'});
      } else if (stats.status === 'geplant' || stats.status === 'abgerissen') {
         g.polygonLayer.setStyle({fillColor:'#555', color:'#555', fillOpacity:0.1, dashArray:'4 4'});
      } else {
         const cv=getColorVal(g);
         const col=getColor(cv,cMin,cMax);
         g.polygonLayer.setStyle({fillColor:col, color: g.fromOsm?'rgba(206,147,216,0.4)':'rgba(79,195,247,0.4)', fillOpacity:cv?0.55:0.08, dashArray:''});
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

    if(g.circleMarker){ map.removeLayer(g.circleMarker); g.circleMarker=null; }
    if(g.labelMarker) { map.removeLayer(g.labelMarker);  g.labelMarker=null; }

    if(!g.polygon) return;
    const center=polygonCenter(g.polygon);

    if (gebVisible && !excluded && stats.status !== 'geplant' && stats.status !== 'abgerissen') {
        const sv=getSizeVal(g);
        const cv2=getColorVal(g);
        const col=getColor(cv2,cMin,cMax);

        if(currentViz==='circle' && sv){
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

        if(currentViz==='bar' && sv){
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

    if(labelsVisible && map.getZoom() >= labelZoom) buildMapLabel(g,center, stats.status);
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
    if(edgeStartId === null){ edgeStartId = id; showHint('Zweites Gebäude anklicken.'); }
    else { if(edgeStartId !== id){ addNetzEdge(edgeStartId, id); recalcNetz(); } edgeStartId = null; showHint('Nächstes Gebäude anklicken oder Tool beenden.'); }
    return;
  }
  selectedId=id;
  _expandedIds.add(id);
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
    if (currentMode === 'strom') {
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
  currentViz=v;
  ['circle','bar','none'].forEach(x=>document.getElementById('vbtn-'+x).classList.toggle('active',x===v));
  updateViz();
}

export function setGebVisible(visible) {
  gebVisible = visible;
  updateViz();
}

export function setLabelsVisible(visible) {
  labelsVisible = visible;
  // Labels sofort entfernen wenn ausgeschaltet (nicht auf updateViz() warten)
  if (!visible) {
    gebaeude.forEach(g => {
      if (g.labelMarker) { map.removeLayer(g.labelMarker); g.labelMarker = null; }
    });
  }
  updateViz();
}

export function setMode(m){
  currentMode=m;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('btn-'+m).classList.add('active');
  updateNetzStrandVisibility();
  updateViz();updateTotals();
  // Netz-Sichtbarkeit dem Modus folgen lassen
  if (m === 'strom') {
    setNetzSubTab('strom'); // setzt stromNetzVisible=true, netzVisible=false
  } else {
    setNetzSubTab('waerme'); // setzt netzVisible=true, stromNetzVisible=false
  }
}

export function cleanupDrawAreaEvents() {
  map.off('click', onDrawAreaClick);
  map.off('contextmenu', onDrawAreaCancel);
  map.dragging.enable();
  map.doubleClickZoom.enable();
  map.getContainer().style.cursor = '';
  hideHint();
  _restoreAfterDraw();
}

export function clearArea() {
  if (areaPolygon) map.removeLayer(areaPolygon);
  if (areaPolyline) map.removeLayer(areaPolyline);
  if (areaStartMarker) map.removeLayer(areaStartMarker);
  areaEditMarkers.forEach(m => map.removeLayer(m));

  areaEditMarkers = [];
  areaPoints = [];
  areaLatLngs = null;
  areaDrawing = false;
  areaPolygon = null;
  areaPolyline = null;
  areaStartMarker = null;

  hidePanels();
  document.getElementById('btn-draw-area').classList.remove('active');
  cleanupDrawAreaEvents();
  if (typeof updateLpGebietStatus === 'function') updateLpGebietStatus();
}

export function lockArea() {
  areaEditMarkers.forEach(m => map.removeLayer(m));
  areaEditMarkers = [];
  hidePanels();
  if (typeof updateLpGebietStatus === 'function') updateLpGebietStatus();
}

export function toggleDrawArea() {
  if (areaDrawing || areaPolygon) { clearArea(); return; }

  // Andere Zeichenmodi abbrechen
  if (isDrawingTrasse) toggleDrawTrasse();
  if (isDrawingRiver) toggleDrawRiver();
  if (drawingId !== null) cancelDraw();
  if (ffDrawId !== null) cancelDrawFF();

  areaDrawing = true;
  areaPoints = [];
  document.getElementById('btn-draw-area').classList.add('active');
  showHint('Klicke für Eckpunkte auf die Karte. Den Startpunkt (rot) erneut anklicken zum Abschließen. Rechtsklick zum Widerrufen. ESC zum Abbrechen.');

  _hideForDraw();
  map.doubleClickZoom.disable();
  map.dragging.disable();
  map.getContainer().style.cursor = 'crosshair';
  // Sicherstellen, dass keine doppelten Listener entstehen
  map.off('click', onDrawAreaClick);
  map.off('contextmenu', onDrawAreaCancel);
  map.on('click', onDrawAreaClick);
  map.on('contextmenu', onDrawAreaCancel);
}

export function onDrawAreaClick(e) {
  if (!areaDrawing) return;

  // Klick auf Startmarker → Polygon abschließen (nicht als neuen Punkt werten)
  if (areaStartMarker && areaPoints.length >= 3) {
    const startLL = areaStartMarker.getLatLng();
    const d = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(startLL));
    if (d < 20) { finishAreaDraw(); return; }
  }

  if (areaPoints.length === 0) {
    const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
    areaStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
    areaStartMarker.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      finishAreaDraw();
    });
  }

  areaPoints.push(e.latlng);
  if (areaPolyline) map.removeLayer(areaPolyline);
  areaPolyline = L.polyline([...areaPoints], {color: '#ab47bc', weight: 2, dashArray: '8 4'}).addTo(map);
}

export function onDrawAreaCancel(e) {
  if (!areaDrawing) return;

  if (areaPoints.length > 0) {
    areaPoints.pop();
    if (areaPolyline) map.removeLayer(areaPolyline);

    if (areaPoints.length > 0) {
      areaPolyline = L.polyline([...areaPoints], {color: '#ab47bc', weight: 2, dashArray: '8 4'}).addTo(map);
    } else {
      if (areaStartMarker) { map.removeLayer(areaStartMarker); areaStartMarker = null; }
    }
  }
}

export function finishAreaDraw() {
  if (areaPoints.length < 3) return;
  areaLatLngs = [...areaPoints];
  areaDrawing = false;

  if (areaPolyline) map.removeLayer(areaPolyline);
  if (areaStartMarker) { map.removeLayer(areaStartMarker); areaStartMarker = null; }

  areaPolygon = L.polygon(areaLatLngs, {color: '#ab47bc', weight: 2, dashArray: '8 4', fillColor: '#ab47bc', fillOpacity: 0.08}).addTo(map);

  const editIcon = L.divIcon({className: 'area-edit-handle', html: '', iconSize: [12, 12]});
  areaLatLngs.forEach((latlng, index) => {
    let marker = L.marker(latlng, {draggable: true, icon: editIcon, zIndexOffset: 2000}).addTo(map);
    marker.on('drag', function(e) {
      areaLatLngs[index] = e.target.getLatLng();
      areaPolygon.setLatLngs(areaLatLngs);
    });
    areaEditMarkers.push(marker);
  });

  cleanupDrawAreaEvents();
  showAreaEditPanel();
}

map.on('click',e=>{
  if (isPlacingLwWp) { placeLwWpAt(e.latlng); return; }
  if (isPlacingGeo) {
    placeGeoAt(e.latlng);
    isPlacingGeo = false;
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
  if (isPlacingPellets) {
    if (pelletsKessel) { pelletsKessel.lat = e.latlng.lat; pelletsKessel.lng = e.latlng.lng; }
    isPlacingPellets = false;
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
  if (isPlacingHhs) {
    if (heizhackschnitzel) { heizhackschnitzel.lat = e.latlng.lat; heizhackschnitzel.lng = e.latlng.lng; }
    isPlacingHhs = false;
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
  if (isPlacingFernwaerme) {
    if (fernwaerme) { fernwaerme.lat = e.latlng.lat; fernwaerme.lng = e.latlng.lng; }
    isPlacingFernwaerme = false;
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
  if(isDrawingRiver) {
    riverPoints.push(e.latlng);
    redrawRiverDuringDraw();
    return;
  }
  if(isDrawingTrasse) {
    if (trasseDetached) {
      // Prüfen ob Klick nahe einem bestehenden Trasse-Punkt ist (Wiedereinstieg)
      let snapIdx = -1;
      let snapDist = Infinity;
      const clickPx = map.latLngToContainerPoint(e.latlng);
      for (let i = 0; i < trassePoints.length; i++) {
        const px = map.latLngToContainerPoint(trassePoints[i]);
        const d = clickPx.distanceTo(px);
        if (d < 20 && d < snapDist) { snapDist = d; snapIdx = i; }
      }
      if (snapIdx >= 0) {
        // Neuen Strang ab bestehendem Punkt starten
        trasseCurrentSegStart = trassePoints.length;
        trassePoints.push(L.latLng(trassePoints[snapIdx].lat, trassePoints[snapIdx].lng));
        showHint('Neuer Strang ab Abzweigung. Klicke weiter oder "Abschließen".');
      } else {
        // Neuen isolierten Strang beginnen
        trasseCurrentSegStart = trassePoints.length;
        trassePoints.push(e.latlng);
        showHint('Neuer Strang gestartet. Klicke weiter oder Rechtsklick = loslösen.');
      }
      trasseDetached = false;
    } else {
      trassePoints.push(e.latlng);
    }
    redrawTrasse();
    return;
  }
  if (ffDrawId !== null) {
    if (ffDrawPoints.length === 0) {
      const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
      ffDrawStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
      ffDrawStartMarker.on('click', (ev) => { L.DomEvent.stopPropagation(ev); finishDrawFF(); });
    }
    ffDrawPoints.push(e.latlng);
    if (ffDrawPolyline) map.removeLayer(ffDrawPolyline);
    ffDrawPolyline = L.polyline([...ffDrawPoints], {color:'#ffd54f', weight:2, dashArray:'6 4'}).addTo(map);
    return;
  }
  if(drawingId!==null){
    if(drawPoints.length === 0){
      const startIcon = L.divIcon({className: 'area-start-handle', html: '', iconSize: [14, 14]});
      drawStartMarker = L.marker(e.latlng, {icon: startIcon, zIndexOffset: 2000}).addTo(map);
      drawStartMarker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        finishDraw();
      });
    }
    drawPoints.push(e.latlng);
    if(drawPolyline) map.removeLayer(drawPolyline);
    drawPolyline=L.polyline([...drawPoints],{color:'#4fc3f7',weight:2,dashArray:'6 4'}).addTo(map);
    return;
  }
});

map.on('contextmenu', e => {
  if(isDrawingRiver && riverPoints.length > 0){
    riverPoints.pop();
    redrawRiverDuringDraw();
  } else if(isDrawingTrasse && trassePoints.length > 0){
    // Rechtsklick: aktuellen Strang loslösen
    if (trassePoints.length > trasseCurrentSegStart + 1) {
      trasseSegments.push({ start: trasseCurrentSegStart, end: trassePoints.length - 1 });
    } else if (trassePoints.length > trasseCurrentSegStart) {
      // Einzelner Punkt ohne Segment: entfernen
      trassePoints.pop();
    }
    trasseDetached = true;
    trasseCurrentSegStart = trassePoints.length;
    showHint('Strang losgelöst. Klicke auf einen bestehenden Trasse-Punkt zum Abzweigen, oder auf die Karte für neuen Strang.');
    redrawTrasse();
  } else if(drawingId !== null && drawPoints.length > 0){
    drawPoints.pop();
    if(drawPolyline) map.removeLayer(drawPolyline);
    if(drawPoints.length > 0) {
      drawPolyline = L.polyline([...drawPoints], {color: '#4fc3f7', weight: 2, dashArray: '6 4'}).addTo(map);
    } else {
      if(drawStartMarker) { map.removeLayer(drawStartMarker); drawStartMarker = null; }
    }
  } else if (ffDrawId !== null && ffDrawPoints.length > 0) {
    ffDrawPoints.pop();
    if (ffDrawPolyline) map.removeLayer(ffDrawPolyline);
    if (ffDrawPoints.length > 0) {
      ffDrawPolyline = L.polyline([...ffDrawPoints], {color:'#ffd54f', weight:2, dashArray:'6 4'}).addTo(map);
    } else {
      if (ffDrawStartMarker) { map.removeLayer(ffDrawStartMarker); ffDrawStartMarker = null; }
    }
  }
});

map.on('dblclick',e=>{
  L.DomEvent.stopPropagation(e);
  L.DomEvent.preventDefault(e);
  if(isDrawingRiver && riverPoints.length >= 2) { finishDrawRiver(); return; }
  if(isDrawingTrasse) { toggleDrawTrasse(); }
});

map.on('zoomend', function() {
  if (!isDrawingTrasse && (currentViz === 'circle' || currentViz === 'bar')) updateViz();
  if (fliessgewaesser) redrawFliessgewaesser();
});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if (areaDrawing) { clearArea(); return; }
    if (isPlacingLwWp) togglePlaceLwWp();
    if(isDrawingRiver) toggleDrawRiver();
    if(isDrawingTrasse) toggleDrawTrasse();
    cancelDraw();
    if(isDrawingEdge) toggleDrawEdge();
  }
  // Pfeiltasten: handled by new keyboard handler in live view section
});

export function toggleDrawTrasse() {
  isDrawingTrasse = !isDrawingTrasse;
  const btn = document.getElementById('btn-draw-trasse');
  if (isDrawingTrasse) {
    btn.classList.add('active');
    trasseDetached = false;
    showHint('Klicke, um Trassenknoten zu setzen. Rechtsklick = Strang loslösen.');
    showTrasseFinishBtn();
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
    if (trassePolyline) {
      if (Array.isArray(trassePolyline)) trassePolyline.forEach(p => p.setStyle({opacity: 0.25}));
      else trassePolyline.setStyle({opacity: 0.25});
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
    trasseCurrentSegStart = trassePoints.length;
  } else {
    btn.classList.remove('active');
    hideHint();
    hideTrasseFinishBtn();
    _restoreAfterDraw();
    // Verbrauchskreise wiederherstellen
    updateViz();
    map.getContainer().style.cursor = '';
    map.doubleClickZoom.enable();
    trasseDetached = false;
    // Aktuelles Segment abschließen
    if (trassePoints.length > trasseCurrentSegStart + 1) {
      trasseSegments.push({ start: trasseCurrentSegStart, end: trassePoints.length - 1 });
    } else if (trassePoints.length > trasseCurrentSegStart) {
      // Einzelner Punkt: entfernen
      trassePoints.pop();
    }
    if (trassePoints.length > 0) autoGenerateNetz();
  }
}

export function showTrasseFinishBtn() {
  let btn = document.getElementById('trasse-finish-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'trasse-finish-btn';
    btn.textContent = '✓ Trassenzeichnung abschließen';
    btn.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10000;padding:10px 20px;background:var(--accent);color:#000;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4);';
    btn.onmouseenter = () => btn.style.filter = 'brightness(1.15)';
    btn.onmouseleave = () => btn.style.filter = '';
    btn.onclick = () => { if (isDrawingTrasse) toggleDrawTrasse(); };
    document.body.appendChild(btn);
  }
  btn.style.display = 'block';
}

export function hideTrasseFinishBtn() {
  const btn = document.getElementById('trasse-finish-btn');
  if (btn) btn.style.display = 'none';
}

export function redrawTrasse() {
  // Multi-Segment Trasse: jedes Segment als eigene Polyline
  if (trassePolyline) {
    if (Array.isArray(trassePolyline)) trassePolyline.forEach(p => map.removeLayer(p));
    else map.removeLayer(trassePolyline);
  }
  trassePolyline = [];
  trasseEditMarkers.forEach(m => map.removeLayer(m));
  trasseEditMarkers = [];

  if (trassePoints.length === 0) return;

  // Alle abgeschlossenen Segmente zeichnen
  const allSegs = [...trasseSegments];
  // Plus das aktuell laufende Segment (falls im Zeichenmodus)
  if (trassePoints.length > trasseCurrentSegStart) {
    allSegs.push({ start: trasseCurrentSegStart, end: trassePoints.length - 1 });
  }

  allSegs.forEach(seg => {
    if (seg.end <= seg.start) return;
    const pts = [];
    for (let i = seg.start; i <= seg.end; i++) pts.push(trassePoints[i]);
    if (pts.length >= 2) {
      const pl = L.polyline(pts, { color: '#ff9800', weight: 14, opacity: 0.25, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      trassePolyline.push(pl);
    }
  });

  // Edit-Handles für alle Punkte — im detached-Modus größer als Snap-Ziele
  const handleSize = trasseDetached ? 14 : 8;
  const handleCls = trasseDetached ? 'trasse-snap-handle' : 'trasse-edit-handle';
  const icon = L.divIcon({ className: handleCls, html: '', iconSize: [handleSize, handleSize], iconAnchor: [handleSize/2, handleSize/2] });
  trassePoints.forEach((pt, idx) => {
    const m = L.marker(pt, { draggable: !trasseDetached, icon: icon, zIndexOffset: 2000 }).addTo(map);
    if (!trasseDetached) {
      m.on('drag', e => {
        trassePoints[idx] = e.target.getLatLng();
        redrawTrasse();
      });
      m.on('dragend', () => autoGenerateNetz());
    }
    trasseEditMarkers.push(m);
  });
}

export function clearTrasse() {
  trassePoints = [];
  trasseSegments = [];
  trasseCurrentSegStart = 0;
  trasseDetached = false;
  redrawTrasse();
  autoGenerateNetz();
}

export function toggleFliessgewaesserPanel() {
  const p = document.getElementById('fliessgewaesser-panel');
  const btn = document.getElementById('btn-fliessgewaesser-toggle');
  if (p.classList.contains('visible')) {
    p.classList.remove('visible');
    btn.classList.remove('active');
    if (isDrawingRiver) toggleDrawRiver();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (fliessgewaesser) {
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
  isDrawingRiver = !isDrawingRiver;
  const btn = document.getElementById('btn-draw-river');
  if (isDrawingRiver) {
    if (fliessgewaesser) clearFliessgewaesser();
    riverPoints = [];
    redrawRiverDuringDraw();
    btn.classList.add('active');
    btn.textContent = 'Fertig (oder Doppelklick auf Karte)';
    btn.onclick = function(){ tryFinishOrToggleRiver(); };
    showHint('Klicke Punkte für den Fluss. Doppelklick auf die Karte oder Button „Fertig” zum Beenden.');
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
  } else {
    btn.classList.remove('active');
    btn.textContent = 'Fluss zeichnen';
    btn.onclick = function(){ toggleDrawRiver(); };
    hideHint();
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
    map.doubleClickZoom.enable();
    if (riverDrawPolyline) { map.removeLayer(riverDrawPolyline); riverDrawPolyline = null; }
    riverEditMarkers.forEach(m => map.removeLayer(m));
    riverEditMarkers = [];
  }
}

export function tryFinishOrToggleRiver() {
  if (isDrawingRiver && riverPoints.length >= 2) {
    finishDrawRiver();
    document.getElementById('btn-draw-river').onclick = function(){ toggleDrawRiver(); };
    map.doubleClickZoom.enable();
  } else {
    toggleDrawRiver();
  }
}

export function redrawRiverDuringDraw() {
  if (riverDrawPolyline) map.removeLayer(riverDrawPolyline);
  riverEditMarkers.forEach(m => map.removeLayer(m));
  riverEditMarkers = [];
  if (riverPoints.length > 0) {
    riverDrawPolyline = L.polyline(riverPoints, {
      color: '#26a69a', weight: 14, opacity: 0.25, lineCap: 'round', lineJoin: 'round'
    }).addTo(map);
    const icon = L.divIcon({ className: 'fg-edit-handle', html: '', iconSize: [6, 6], iconAnchor: [3, 3] });
    riverPoints.forEach((pt, idx) => {
      const m = L.marker(pt, { draggable: true, icon: icon, zIndexOffset: 2000 }).addTo(map);
      m.on('drag', e => {
        riverPoints[idx] = e.target.getLatLng();
        riverDrawPolyline.setLatLngs(riverPoints);
      });
      riverEditMarkers.push(m);
    });
  } else {
    riverDrawPolyline = null;
  }
}

export function finishDrawRiver() {
  if (riverPoints.length < 2) return;
  const latlngs = riverPoints.map(p => ({ lat: p.lat, lng: p.lng }));
  const durchfluss = parseFloat(document.getElementById('fg-durchfluss').value) || 50;
  const leistung = parseFloat(document.getElementById('fg-leistung').value) || 200;
  const jaz = parseFloat(document.getElementById('fg-jaz').value) || 4.5;
  fliessgewaesser = { latlngs, durchflussLs: durchfluss, leistungKw: leistung, jaz, visible: fliessgewaesserVisible };
  moBeiAktivierung('fg');
  isDrawingRiver = false;
  riverPoints = [];
  if (riverDrawPolyline) { map.removeLayer(riverDrawPolyline); riverDrawPolyline = null; }
  riverEditMarkers.forEach(m => map.removeLayer(m));
  riverEditMarkers = [];
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
  if (!fliessgewaesserLayerGroup) return;
  fliessgewaesserLayerGroup.clearLayers();
  if (!fliessgewaesser || !fliessgewaesser.latlngs || fliessgewaesser.latlngs.length < 2) return;
  const pts = fliessgewaesser.latlngs.map(p => L.latLng(p.lat, p.lng));
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
      const layer = L.polyline(latLngs, { color: color, weight: 2.5, opacity: opacity }).addTo(fliessgewaesserLayerGroup);
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
        L.polyline([connectionPoint, center], { color: '#e53935', weight: 4, opacity: 0.9 }).addTo(fliessgewaesserLayerGroup);
      }
    }
  }
  const wpIcon = L.divIcon({ className: 'fg-wp-marker', html: '⚡', iconSize: [22, 22], iconAnchor: [11, 11] });
  L.marker(connectionPoint, { icon: wpIcon, title: 'Wärmepumpe Anschluss Heizzentrale' }).addTo(fliessgewaesserLayerGroup);
  /* Nach dem Zeichnen: verschiebbare Punkte – blau und klein (nur Fließgewässer) */
  const icon = L.divIcon({ className: 'fg-edit-handle', html: '', iconSize: [6, 6], iconAnchor: [3, 3] });
  pts.forEach((pt, idx) => {
    const m = L.marker(pt, { draggable: true, icon: icon, zIndexOffset: 2000 }).addTo(fliessgewaesserLayerGroup);
    m.on('drag', e => {
      fliessgewaesser.latlngs[idx] = { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng };
    });
    m.on('dragend', () => redrawFliessgewaesser());
  });
  if (fliessgewaesserVisible) {
    if (!map.hasLayer(fliessgewaesserLayerGroup)) fliessgewaesserLayerGroup.addTo(map);
  }
  updateFliessgewaesserAbkuehlungDisplay();
  redrawVerbindungslinien();
}

export function updateFliessgewaesserVisibility() {
  if (!fliessgewaesser) return;
  if (fliessgewaesserVisible) {
    if (!map.hasLayer(fliessgewaesserLayerGroup)) fliessgewaesserLayerGroup.addTo(map);
  } else {
    if (map.hasLayer(fliessgewaesserLayerGroup)) map.removeLayer(fliessgewaesserLayerGroup);
  }
}

export function setFliessgewaesserVisible(visible) {
  fliessgewaesserVisible = visible;
  updateFliessgewaesserVisibility();
}

export function getFliessgewaesserAbkuehlung() {
  const durchfluss = parseFloat(document.getElementById('fg-durchfluss')?.value) || fliessgewaesser?.durchflussLs || 50;
  const leistung = parseFloat(document.getElementById('fg-leistung')?.value) || fliessgewaesser?.leistungKw || 200;
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
  if (!fliessgewaesser) return;
  fliessgewaesser.durchflussLs = parseFloat(document.getElementById('fg-durchfluss').value) || 50;
  fliessgewaesser.leistungKw = parseFloat(document.getElementById('fg-leistung').value) || 200;
  fliessgewaesser.jaz = parseFloat(document.getElementById('fg-jaz').value) || 4.5;
  updateFliessgewaesserAbkuehlungDisplay();
  redrawFliessgewaesser();
  const waerme  = parseFloat(document.getElementById('fg-waerme').value) || 0;
  const fgJaz   = parseFloat(document.getElementById('fg-jaz').value) || 4.5;
  const fgCo2   = waerme > 0 ? waerme / fgJaz * stromEmF   / 1000 : null;
  const fgCo2LZ = waerme > 0 ? waerme / fgJaz * stromEmFLZ / 1000 : null;
  document.getElementById('fg-co2').textContent = fgCo2 ? `${fgCo2.toFixed(1)} t/a (2026) · ${fgCo2LZ.toFixed(1)} t/a (Ø 2030–50)` : '—';
}

export function clearFliessgewaesser() {
  fliessgewaesser = null;
  moBeiDeaktivierung('fg');
  if (fliessgewaesserLayerGroup) {
    fliessgewaesserLayerGroup.clearLayers();
    if (map.hasLayer(fliessgewaesserLayerGroup)) map.removeLayer(fliessgewaesserLayerGroup);
  }
  document.getElementById('fg-data-section').style.display = 'none';
  document.getElementById('fg-draw-section').style.display = 'block';
  document.getElementById('fg-visible').checked = true;
  fliessgewaesserVisible = true;
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
    if (isPlacingLwWp) togglePlaceLwWp();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    if (lwWp) {
      document.getElementById('lwwp-data-section').style.display = 'block';
      const plBtn = document.getElementById('btn-place-lwwp');
      if (plBtn && lwWp.lat != null) plBtn.textContent = 'Position verschieben';
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
  isPlacingLwWp = !isPlacingLwWp;
  const btn = document.getElementById('btn-place-lwwp');
  if (isPlacingLwWp) {
    btn.classList.add('active');
    btn.textContent = 'Klicken auf Karte zum Platzieren';
    showHint('Klicke auf die Karte, um die Luft-Wasser-Wärmepumpe zu platzieren.');
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    document.getElementById('lwwp-panel').classList.remove('visible');
    document.getElementById('btn-lwwp-toggle')?.classList.remove('active');
  } else {
    btn.classList.remove('active');
    btn.textContent = lwWp ? 'Position verschieben' : 'Auf Karte platzieren';
    hideHint();
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
  }
}

export function placeLwWpAt(latlng) {
  const leistung = parseFloat(document.getElementById('lwwp-leistung').value) || 12;
  const lwa = parseFloat(document.getElementById('lwwp-lwa').value) || 80;
  lwWp = { lat: latlng.lat, lng: latlng.lng, leistungKw: leistung, lwaDb: lwa, visible: lwWpVisible };
  document.getElementById('lwwp-man-laenge').value = '';
  document.getElementById('lwwp-man-breite').value = '';
  isPlacingLwWp = false;
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
  redrawLwWp();
  updateLwWpDisplay();
  updateLwWpVisibility();
  redrawErzeugerIcons();
}

export function redrawLwWp() {
  if (!lwWpLayerGroup) return;
  lwWpLayerGroup.clearLayers();
  if (!lwWp || lwWp.lat == null || lwWp.lng == null) return;
  const pt = L.latLng(lwWp.lat, lwWp.lng);
  const leistung = lwWp.leistungKw;
  const lwa = lwWp.lwaDb;
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
    .addTo(lwWpLayerGroup);
  lwWpSchallLayerGroup.clearLayers();
  const schallStufen = [55, 50, 45, 40, 35];
  const schallFarben = ['#b71c1c', '#e65100', '#f9a825', '#8bc34a', '#2e7d32'];
  for (let i = schallStufen.length - 1; i >= 0; i--) {
    const r = lwWpSchallRadiusM(lwa, schallStufen[i]);
    if (r > 0.5 && r < 500) {
      const circle = L.circle(pt, { radius: r, color: schallFarben[i], weight: 1.5, fillColor: schallFarben[i], fillOpacity: 0.12 }).addTo(lwWpSchallLayerGroup);
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
  // Griffe
  const hIco = cur => L.divIcon({ className: '', html: `<div style="width:10px;height:10px;background:#f5f5f5;border:2px solid #388e3c;border-radius:2px;cursor:${cur};box-shadow:0 1px 3px rgba(0,0,0,.6);"></div>`, iconSize: [10,10], iconAnchor: [5,5] });
  const cIco = cur => L.divIcon({ className: '', html: `<div style="width:12px;height:12px;background:#f1f8e9;border:2px solid #388e3c;border-radius:0;cursor:${cur};box-shadow:0 1px 3px rgba(0,0,0,.7);"></div>`, iconSize: [12,12], iconAnchor: [6,6] });
  const mLng = () => (sw.lng + ne.lng) / 2;
  const mLat = () => (sw.lat + ne.lat) / 2;
  function upRect() { rect.setBounds([L.latLng(sw.lat, sw.lng), L.latLng(ne.lat, ne.lng)]); const f = fb(actF()); rect.setStyle({ fillColor: f.c, fillOpacity: f.o }); }
  function done() {
    const aL = (ne.lat - sw.lat) / latPerM, aB = (ne.lng - sw.lng) / lngPerM;
    lwWp.lat = (sw.lat + ne.lat) / 2;
    lwWp.lng = (sw.lng + ne.lng) / 2;
    document.getElementById('lwwp-man-laenge').value = aL.toFixed(1);
    document.getElementById('lwwp-man-breite').value = aB.toFixed(1);
    updateLwWpDisplay();
    redrawLwWp();
  }
  // Seitengriffe: N S E W
  const nH = L.marker(L.latLng(ne.lat, mLng()), { draggable: true, icon: hIco('ns-resize'), zIndexOffset: 2000 }).addTo(lwWpLayerGroup);
  nH.on('drag', function() { const lat = this.getLatLng().lat; if (lat > sw.lat + 3 * latPerM) { ne.lat = lat; upRect(); } });
  nH.on('dragend', done);
  const sH = L.marker(L.latLng(sw.lat, mLng()), { draggable: true, icon: hIco('ns-resize'), zIndexOffset: 2000 }).addTo(lwWpLayerGroup);
  sH.on('drag', function() { const lat = this.getLatLng().lat; if (lat < ne.lat - 3 * latPerM) { sw.lat = lat; upRect(); } });
  sH.on('dragend', done);
  const eH = L.marker(L.latLng(mLat(), ne.lng), { draggable: true, icon: hIco('ew-resize'), zIndexOffset: 2000 }).addTo(lwWpLayerGroup);
  eH.on('drag', function() { const lng = this.getLatLng().lng; if (lng > sw.lng + 3 * lngPerM) { ne.lng = lng; upRect(); } });
  eH.on('dragend', done);
  const wH = L.marker(L.latLng(mLat(), sw.lng), { draggable: true, icon: hIco('ew-resize'), zIndexOffset: 2000 }).addTo(lwWpLayerGroup);
  wH.on('drag', function() { const lng = this.getLatLng().lng; if (lng < ne.lng - 3 * lngPerM) { sw.lng = lng; upRect(); } });
  wH.on('dragend', done);
  // Eckengriffe: NE NW SE SW
  const neH = L.marker(L.latLng(ne.lat, ne.lng), { draggable: true, icon: cIco('nesw-resize'), zIndexOffset: 2100 }).addTo(lwWpLayerGroup);
  neH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat > sw.lat + 3 * latPerM) ne.lat = ll.lat; if (ll.lng > sw.lng + 3 * lngPerM) ne.lng = ll.lng; upRect(); });
  neH.on('dragend', done);
  const nwH = L.marker(L.latLng(ne.lat, sw.lng), { draggable: true, icon: cIco('nwse-resize'), zIndexOffset: 2100 }).addTo(lwWpLayerGroup);
  nwH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat > sw.lat + 3 * latPerM) ne.lat = ll.lat; if (ll.lng < ne.lng - 3 * lngPerM) sw.lng = ll.lng; upRect(); });
  nwH.on('dragend', done);
  const seH = L.marker(L.latLng(sw.lat, ne.lng), { draggable: true, icon: cIco('nwse-resize'), zIndexOffset: 2100 }).addTo(lwWpLayerGroup);
  seH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat < ne.lat - 3 * latPerM) sw.lat = ll.lat; if (ll.lng > sw.lng + 3 * lngPerM) ne.lng = ll.lng; upRect(); });
  seH.on('dragend', done);
  const swH = L.marker(L.latLng(sw.lat, sw.lng), { draggable: true, icon: cIco('nesw-resize'), zIndexOffset: 2100 }).addTo(lwWpLayerGroup);
  swH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat < ne.lat - 3 * latPerM) sw.lat = ll.lat; if (ll.lng < ne.lng - 3 * lngPerM) sw.lng = ll.lng; upRect(); });
  swH.on('dragend', done);
  // Hauptmarker (Gerät verschieben) — groß genug um auch ohne Zoom greifbar zu sein
  const wpIcon = L.divIcon({ className: '', html: '<div style="width:32px;height:32px;background:rgba(56,142,60,0.5);border:2px solid #66bb6a;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 0 8px rgba(102,187,106,0.5);">' + windSvg('#c8e6c9',17,14) + '</div>', iconSize: [32,32], iconAnchor: [16,16] });
  const marker = L.marker(pt, { draggable: true, icon: wpIcon, title: 'Luft-Wasser-WP verschieben', zIndexOffset: 3000 }).addTo(lwWpLayerGroup);
  marker.on('dragend', function() {
    lwWp.lat = marker.getLatLng().lat;
    lwWp.lng = marker.getLatLng().lng;
    redrawLwWp();
  });
  updateLwWpVisibility();
  redrawVerbindungslinien();
}

export function updateLwWpDisplay() {
  if (!lwWp) return;
  const leistung = lwWp.leistungKw;
  const lwa = lwWp.lwaDb;
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
  if (!lwWp) return;
  lwWp.leistungKw = parseFloat(document.getElementById('lwwp-leistung').value) || 100;
  // LWA: nur auto-berechnen wenn noch auf Default (80) oder wenn Leistung geändert
  const lwaEl = document.getElementById('lwwp-lwa');
  if (lwaEl && !lwaEl._userEdited) {
    const autoLwa = calcLwaAuto(lwWp.leistungKw);
    lwaEl.value = autoLwa;
    lwaEl.title = `Auto: ${autoLwa} dB(A) bei ${lwWp.leistungKw} kW — überschreibbar`;
  }
  lwWp.lwaDb = parseFloat(document.getElementById('lwwp-lwa').value) || calcLwaAuto(lwWp.leistungKw);
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
  lwWpVisible = visible;
  updateLwWpVisibility();
}

export function updateLwWpVisibility() {
  if (!lwWp) return;
  if (lwWpVisible) {
    if (!map.hasLayer(lwWpLayerGroup)) lwWpLayerGroup.addTo(map);
    if (lwWpSchallVisible) {
      if (!map.hasLayer(lwWpSchallLayerGroup)) lwWpSchallLayerGroup.addTo(map);
    } else {
      if (map.hasLayer(lwWpSchallLayerGroup)) map.removeLayer(lwWpSchallLayerGroup);
    }
  } else {
    if (map.hasLayer(lwWpLayerGroup)) map.removeLayer(lwWpLayerGroup);
    if (map.hasLayer(lwWpSchallLayerGroup)) map.removeLayer(lwWpSchallLayerGroup);
  }
}

export function setSchallVisible(visible) {
  lwWpSchallVisible = visible;
  updateLwWpVisibility();
}

export function clearLwWp() {
  lwWp = null;
  moBeiDeaktivierung('lwwp');
  if (lwWpLayerGroup) {
    lwWpLayerGroup.clearLayers();
    if (map.hasLayer(lwWpLayerGroup)) map.removeLayer(lwWpLayerGroup);
  }
  if (lwWpSchallLayerGroup) {
    lwWpSchallLayerGroup.clearLayers();
    if (map.hasLayer(lwWpSchallLayerGroup)) map.removeLayer(lwWpSchallLayerGroup);
  }
  document.getElementById('lwwp-data-section').style.display = 'none';
  document.getElementById('lwwp-visible').checked = true;
  document.getElementById('lwwp-schall-visible').checked = true;
  lwWpVisible = true;
  lwWpSchallVisible = true;
  redrawErzeugerIcons();
}

export function toggleKennwertePanel() {
  const p = document.getElementById('kennwerte-panel');
  const btn = document.getElementById('btn-kennwerte-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) { p.classList.add('visible'); btn.classList.add('active'); }
}

