// ── 02b-gebaeude.js — Karte-Init, Gebäude-CRUD, Energie, OSM, Rendering ──

import { R_MIN, currentMode, isExcluded, updateVizDebounced } from './01-globals-varianten.js';
import { lerpColor } from './02a-netz-physik.js';
import { polygonAreaM2, polygonCenter, selectFromMap, updateViz } from './02c-karte-werkzeuge.js';
import { hidePanels, populateZentraleSelect, recalcNetz, startDraw } from './03b-netz.js';
import { _gebLabelHtml, cardDotColor, drawChart, renderList, updateTotals } from './03c-gebaeude-io.js';
import { glBerechnenDebounced } from './06b-gl-berechnen.js';
import { updateAllDeckungen } from './06c-dispatch-core.js';
import { calcWirtschaftPanel } from './07b-analysis-economics.js';

// Guard against HMR re-init: reuse cached instance if container is already initialized
export const map = window._appLeafletMap || (() => {
  const m = L.map('map',{zoomControl:true}).setView([52.0816,8.0034],15);
  window._appLeafletMap = m;
  return m;
})();
export const osmTile = window._appOsmTile || (() => {
  const t = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:21});
  window._appOsmTile = t;
  return t;
})();
export const esriTile = window._appEsriTile || (() => {
  const t = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:21});
  window._appEsriTile = t;
  return t;
})();
if (!map.hasLayer(osmTile)) osmTile.addTo(map);
// Custom Pane für Netzleitungen — über den Kreisen (overlayPane z=400, netzPane z=450)
if (!map.getPane('netzPane')) {
  map.createPane('netzPane');
  map.getPane('netzPane').style.zIndex = 450;
}
// Invalidate map size after left panel renders (flex layout needs recalc)
setTimeout(() => map.invalidateSize(), 300);
setTimeout(() => map.invalidateSize(), 1000);
window.fliessgewaesserLayerGroup = L.layerGroup();
window.lwWpLayerGroup = L.layerGroup();
window.lwWpSchallLayerGroup = L.layerGroup();
window.erzeugerIconLayerGroup = L.layerGroup();
export let currentTile = 'osm';
export function toggleTile(){
  if(currentTile==='osm'){ map.removeLayer(osmTile); esriTile.addTo(map); currentTile='esri'; document.getElementById('btn-tile').textContent='🗺 OSM'; }
  else { map.removeLayer(esriTile); osmTile.addTo(map); currentTile='osm'; document.getElementById('btn-tile').textContent='🛰 Satellit'; }
}

// ── Farbschemata ──────────────────────────────────────────────────────────
export const THEMES = [
  { name: 'Ocker & Salbei',   bg:'#12110e', surface:'#1c1a15', surface2:'#24221b', border:'#3a3528', text:'#ece8df', muted:'#9a9080', accent:'#d4a855' },
  { name: 'Ozean',            bg:'#0f1117', surface:'#181c27', surface2:'#1f2435', border:'#2a3050', text:'#e8eaf0', muted:'#7a8099', accent:'#4fc3f7' },
  { name: 'Wald',             bg:'#0e1210', surface:'#161e19', surface2:'#1c2820', border:'#2a3e2f', text:'#e4ebe6', muted:'#7a9480', accent:'#81c784' },
  { name: 'Terrakotta',       bg:'#120f0e', surface:'#1e1916', surface2:'#28211d', border:'#3e332c', text:'#ebe5e0', muted:'#998880', accent:'#c47a5a' },
  { name: 'Lavendel',         bg:'#100f14', surface:'#1a1821', surface2:'#22202c', border:'#332e45', text:'#e8e6f0', muted:'#8580a0', accent:'#b39ddb' },
  { name: 'Magenta',          bg:'#130e12', surface:'#1e1620', surface2:'#281e2a', border:'#40303e', text:'#f0e6ee', muted:'#a07898', accent:'#e91e90' },
  { name: 'Ros\u00e9gold',    bg:'#13100e', surface:'#1e1915', surface2:'#28211c', border:'#3e3330', text:'#ede6e2', muted:'#a08e85', accent:'#e8a090' },
  { name: 'Bernstein',        bg:'#111008', surface:'#1c1a10', surface2:'#252218', border:'#3a3520', text:'#ede8d8', muted:'#98906a', accent:'#f5a623' },
  { name: 'Nordlicht',        bg:'#0c1210', surface:'#141e1c', surface2:'#1a2826', border:'#283e38', text:'#e2ebe8', muted:'#70a090', accent:'#4dd0b8' },
  { name: 'Mitternacht',      bg:'#0a0c14', surface:'#121520', surface2:'#181c2c', border:'#252a42', text:'#e0e4f0', muted:'#6a7099', accent:'#7c8cf0' },
];
export let currentThemeIdx = 0;

export function cycleTheme() {
  currentThemeIdx = (currentThemeIdx + 1) % THEMES.length;
  applyTheme(THEMES[currentThemeIdx]);
}

export function applyTheme(t) {
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg);
  r.setProperty('--surface', t.surface);
  r.setProperty('--surface2', t.surface2);
  r.setProperty('--border', t.border);
  r.setProperty('--text', t.text);
  r.setProperty('--muted', t.muted);
  r.setProperty('--accent', t.accent);
  document.getElementById('btn-theme').title = t.name;
}

document.getElementById('map').addEventListener('contextmenu', e => e.preventDefault());

export function setGlobalYear(val) {
  window.globalYear = parseInt(val);
  document.getElementById('year-display').textContent = window.globalYear;
  // Lastgang für das Betrachtungsjahr skalieren (Abriss/Neubau/Sanierung)
  if (window._basisLastgangKw) _rescaleLastgangForYear(window.globalYear);
  updateViz();
  updateTotals();
  recalcNetz();
  renderList();
  if (document.getElementById('chart-panel').classList.contains('visible')) {
    drawChart();
  }
}

export function toggleNetworkLock() {
  window.networkLocked = !window.networkLocked;
  _syncNetworkLockUI();
  recalcNetz();
  if (typeof calcWirtschaftPanel === 'function') calcWirtschaftPanel();
}
export function _syncNetworkLockUI() {
  // Left-Panel Button
  const btn = document.getElementById('lp-btn-lock');
  if (btn) {
    if (window.networkLocked) {
      btn.innerHTML = '🔒 Bestandsnetz';
      btn.style.borderColor = '#4caf50';
      btn.style.color = '#4caf50';
      btn.style.background = 'rgba(76, 175, 80, 0.1)';
    } else {
      btn.innerHTML = '🔓 Neubaunetz';
      btn.style.borderColor = 'var(--border)';
      btn.style.color = 'var(--muted)';
      btn.style.background = 'transparent';
    }
  }
  // Float-Panel Button
  const btn2 = document.getElementById('btn-lock-netz');
  if (btn2) {
    if (window.networkLocked) {
      btn2.innerHTML = '🔒 Bestandsnetz';
      btn2.style.borderColor = '#4caf50';
      btn2.style.color = '#4caf50';
      btn2.style.background = 'rgba(76, 175, 80, 0.1)';
    } else {
      btn2.innerHTML = '🔓 Neubaunetz (Planung)';
      btn2.style.borderColor = 'var(--border)';
      btn2.style.color = 'var(--muted)';
      btn2.style.background = 'transparent';
    }
  }
  const opts = document.getElementById('netz-bestand-options');
  if (opts) opts.style.display = window.networkLocked ? '' : 'none';
}

export function _invalidateStats() { /* no-op: cache removed */ }

export function getComputedStats(g, year) {
  let waerme = parseFloat(g.waerme) || 0;
  let spez = parseFloat(g.spez) || 0;
  let heizlast = parseFloat(g.heizlast) || 0;
  let spezHeizlast = parseFloat(g.spezHeizlast) || 0;

  const baujahr = g.baujahr ? parseInt(g.baujahr) : 1900;
  const abrissjahr = g.abrissjahr ? parseInt(g.abrissjahr) : 9999;

  let status = 'bestand';
  if (year < baujahr) status = 'geplant';
  if (year >= abrissjahr) status = 'abgerissen';

  if (status !== 'bestand') {
    return { waerme: 0, spez: 0, heizlast: 0, spezHeizlast: 0, status };
  }

  let currentSpez = spez;
  let activeSanierung = null;

  if (g.sanierungen && g.sanierungen.length > 0) {
    g.sanierungen.forEach(s => {
      if (s.jahr <= year) {
        if (!activeSanierung || s.jahr > activeSanierung.jahr) activeSanierung = s;
      }
    });
  }

  if (activeSanierung && spez > 0) {
    const ratio = activeSanierung.zielSpez / spez;
    currentSpez = activeSanierung.zielSpez;
    waerme = waerme * ratio;
    heizlast = heizlast * ratio;
    spezHeizlast = spezHeizlast * ratio;
    status = 'saniert';
  }

  return { waerme, spez: currentSpez, heizlast, spezHeizlast, status };
}

// ── Jahresweise Lastgang-Skalierung ──────────────────────────────────────
// Wenn sich das Betrachtungsjahr ändert, wird der Basis-Lastgang proportional
// skaliert: Gebäude die abgerissen/geplant/saniert sind verändern den Wärmebedarf.
// Netzverluste skalieren proportional mit (weniger Wärme → weniger Verluste).
export function _rescaleLastgangForYear(year) {
  const ss = window.systemState;
  if (!ss || !window._basisLastgangKw || !window._basisGebWaermeSumme) return;
  if (year === window._basisYear) {
    // Zurück zum Originalzustand
    ss.lastgangKw = new Float32Array(window._basisLastgangKw);
    ss.gesamtMwhMitNV = ss.lastgangKw.reduce((a, b) => a + b, 0) / 1000;
    ss.pMaxKw = Math.max(...ss.lastgangKw);
    ss.jahresdauerlinie = Float32Array.from(ss.lastgangKw).sort((a, b) => b - a);
    _updateLastgangScaleInfo(1.0, year, 0, 0, 0);
    updateAllDeckungen();
    return;
  }

  // Gebäude-Wärmesumme im Zieljahr berechnen
  const basisSumme = window._basisGebWaermeSumme;
  if (basisSumme < 0.1) return; // keine Gebäudedaten → keine Skalierung möglich

  let zielSumme = 0;
  let nAbgerissen = 0, nNeu = 0, nSaniert = 0;
  for (const g of window.gebaeude) {
    const stBasis = getComputedStats(g, window._basisYear);
    const stZiel  = getComputedStats(g, year);
    zielSumme += (stZiel.waerme || 0);
    if (stBasis.status === 'bestand' && stZiel.status === 'abgerissen') nAbgerissen++;
    if (stBasis.status === 'geplant' && stZiel.status === 'bestand') nNeu++;
    if (stZiel.status === 'saniert' && stBasis.status !== 'saniert') nSaniert++;
  }

  const faktor = basisSumme > 0.1 ? zielSumme / basisSumme : 1.0;

  // Lastgang skalieren
  const basis = window._basisLastgangKw;
  const skaliert = new Float32Array(basis.length);
  for (let i = 0; i < basis.length; i++) skaliert[i] = basis[i] * faktor;

  ss.lastgangKw = skaliert;
  ss.gesamtMwhMitNV = skaliert.reduce((a, b) => a + b, 0) / 1000;
  ss.pMaxKw = Math.max(...skaliert);
  ss.jahresdauerlinie = Float32Array.from(skaliert).sort((a, b) => b - a);

  _updateLastgangScaleInfo(faktor, year, nAbgerissen, nNeu, nSaniert);

  // Dispatch mit neuem Lastgang neu berechnen
  updateAllDeckungen();
}

export function _updateLastgangScaleInfo(faktor, year, nAbgerissen, nNeu, nSaniert) {
  let el = document.getElementById('lastgang-scale-info');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lastgang-scale-info';
    el.style.cssText = 'font-size:9px;padding:4px 8px;border-radius:4px;margin-top:4px;font-family:"DM Mono",monospace;';
    const container = document.getElementById('gl-status-text')?.parentElement;
    if (container) container.appendChild(el);
  }
  if (Math.abs(faktor - 1.0) < 0.001) {
    el.style.display = 'none';
    return;
  }
  const pct = ((faktor - 1) * 100);
  const sign = pct > 0 ? '+' : '';
  const color = pct < 0 ? '#ef9a9a' : '#a5d6a7';
  const details = [];
  if (nAbgerissen > 0) details.push(nAbgerissen + ' abgerissen');
  if (nNeu > 0) details.push(nNeu + ' neu');
  if (nSaniert > 0) details.push(nSaniert + ' saniert');
  el.style.display = '';
  el.style.background = pct < 0 ? 'rgba(229,57,53,0.08)' : 'rgba(76,175,80,0.08)';
  el.style.border = '1px solid ' + (pct < 0 ? 'rgba(229,57,53,0.2)' : 'rgba(76,175,80,0.2)');
  el.innerHTML = '<span style="color:' + color + ';">' + year + ': Lastgang ' + sign + pct.toFixed(1) + '% gg. ' + window._basisYear + '</span>'
    + (details.length ? ' <span style="color:var(--muted);">(' + details.join(', ') + ')</span>' : '')
    + ' <span style="color:var(--muted);">[Faktor ' + faktor.toFixed(3) + ']</span>';
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

export function getSpezColor(val) {
  const n = Number(val);
  if (val === null || val === undefined || isNaN(n)) return '#4a7a8a';
  if (n <= 20) return '#4caf50';
  if (n >= 250) {
    const over = Math.min(1, Math.max(0, (n - 250) / 250));
    const r = 249 - (249 - 100) * over;
    const g = 67 - (67 - 0) * over;
    const b = 54 - (54 - 0) * over;
    return rgbToHex(r, g, b);
  }
  const t = (n - 20) / (250 - 20);
  let r, g, b;
  if (t < 0.5) {
    const f = t * 2;
    r = 76 + (249 - 76) * f;
    g = 175 + (168 - 175) * f;
    b = 80 + (37 - 80) * f;
  } else {
    const f = (t - 0.5) * 2;
    r = 249 + (249 - 249) * f;
    g = 168 + (67 - 168) * f;
    b = 37 + (54 - 37) * f;
  }
  return rgbToHex(r, g, b);
}

export function getColor(val,min,max){
  if (currentMode === 'strom') {
    if (val === null || val === undefined || isNaN(Number(val)) || max === min) return '#3a2e00';
    const t = Math.max(0, Math.min(1, (Number(val) - min) / (max - min)));
    // Gelb → Amber → Dunkelorange (Gebäudeverbrauch)
    return t < 0.5 ? lerpColor('#ffd54f','#ffa000', t*2) : lerpColor('#ffa000','#e65100', (t-0.5)*2);
  }
  if (currentMode === 'spez' || currentMode === 'waerme') return getSpezColor(val);
  if (currentMode === 'verlust') {
    if (val === null || val === undefined) return '#4a7a8a';
    const t = Math.max(0, Math.min(1, val / 20));
    return t < 0.5 ? lerpColor('#4caf50','#f9a825', t*2) : lerpColor('#f9a825','#e53935', (t-0.5)*2);
  }
  const num = Number(val);
  if (val === null || val === undefined || isNaN(num) || max === min) return '#4a7a8a';
  const t = Math.max(0, Math.min(1, (num - min) / (max - min)));
  const stops = [[46,125,50],[139,195,74],[249,168,37],[230,81,0],[183,28,28]];
  const seg = t * (stops.length - 1), i = Math.floor(seg), f = seg - i;
  const a = stops[Math.min(i, 4)], b = stops[Math.min(i + 1, 4)];
  return rgbToHex(
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f
  );
}

export function getColorVal(g){
  const stats = getComputedStats(g, window.globalYear);
  if (stats.status === 'geplant' || stats.status === 'abgerissen') return null;
  if (currentMode === 'spez' || currentMode === 'waerme') {
    const v = stats.spez;
    return (v !== null && v !== undefined && !isNaN(Number(v))) ? Number(v) : null;
  }
  if (currentMode === 'verlust') return g.netzVerlustRatioPct ?? null;
  if (currentMode === 'strom')   return getGebStromMwh(g) || g.elMwh || null;
  return getModeVal(g);
}
export function getSizeVal(g){ return getModeVal(g); }

export function getModeVal(g){
  const stats = getComputedStats(g, window.globalYear);
  if (stats.status === 'geplant' || stats.status === 'abgerissen') return null;
  if(currentMode==='waerme')   return stats.waerme || null;
  if(currentMode==='spez')     return stats.spez || null;
  if(currentMode==='heizlast') return stats.heizlast || null;
  if(currentMode==='verlust')  return g.netzVerlustKW || null;
  if(currentMode==='strom')    return getGebStromMwh(g) || g.elMwh || null;
  return null;
}
export function getRange(arr){ if(!arr.length) return [0,1]; return [Math.min(...arr),Math.max(...arr)]; }
export function getSizeRange(){ return getRange(window.gebaeude.map(g=>getSizeVal(g)).filter(v=>v!==null)); }
export function getColorRange(){ return getRange(window.gebaeude.map(g=>getColorVal(g)).filter(v=>v!==null)); }

export function getRadius(val, max){
  if(!val||!max||max<=0) return R_MIN;
  const t = Math.sqrt(Math.max(0, val) / max);
  return Math.max(R_MIN, t * R_MAX);
}

// Bei Rauszoom verkleinern wir die Kreise, damit sie sich weniger überschneiden (Zoom 12 = klein, 17+ = volle Größe).
export function getZoomScale() {
  const z = map.getZoom();
  if (z >= 17) return 1;
  if (z <= 12) return 0.3;
  return 0.3 + (z - 12) / 5 * 0.7;
}

// Berechnet den maximalen Radius für den aktuellen Render-Durchlauf.
// Zoom skaliert R_MAX. Dichte-Cap (85 % des Median-NN-Abstands) verhindert
// totales Zudecken, erlaubt aber moderate Überlappung.
export function getEffectiveRMax() {
  const zs    = getZoomScale();
  let effRMax = Math.round(R_MAX * zs);

  const viz = window.gebaeude.filter(g => g.polygon && !isExcluded(g.id));
  if (viz.length >= 5) {
    const pts = viz.map(g => map.latLngToContainerPoint(polygonCenter(g.polygon)));
    const nnd = pts.map((p, i) => {
      let min = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
        if (d < min) min = d;
      }
      return min;
    }).sort((a, b) => a - b);
    const p50 = nnd[Math.floor(nnd.length * 0.5)];
    effRMax = Math.min(effRMax, Math.max(10, Math.round(p50 * 0.85)));
  }
  return effRMax;
}

export function nextGebName(nutzung) {
  const LABELS = { efh:'EFH', mfh:'MFH', ghd:'Gewerbe', schule:'Schule', buero:'Büro', industrie:'Industrie', oeffentlich:'Öffentlich' };
  const prefix = LABELS[nutzung] || 'Gebäude';
  const names = new Set(window.gebaeude.map(g => g.name));
  for (let i = 1; i < 10000; i++) {
    const candidate = prefix + ' ' + i;
    if (!names.has(candidate)) return candidate;
  }
  return prefix + ' ' + Date.now();
}

export function addGebaeude(opts={}){
  const id=opts.id || window.idCounter++;
  const g={id,name:opts.name || nextGebName(opts.nutzung),waerme:'',spez:'',heizlast:'',spezHeizlast:'',
           flaeche:null,stockwerke:opts.stockwerke!=null?opts.stockwerke:1,nutzung:opts.nutzung||'',
           polygon:null,polygonLayer:null,circleMarker:null,labelMarker:null,
           fromOsm:opts.fromOsm||false,fromWfs:opts.fromWfs||false,osmId:opts.osmId||null,
           baujahr: opts.baujahr!=null?opts.baujahr:null, baujährQuelle: opts.baujährQuelle||null,
           abrissjahr: null, sanierungen: [], selected: false,
           pvAktiv: false, pvDachanteil: opts.pvDachanteil ?? 30,
           strom: opts.strom || '', stromProfil: opts.stromProfil || 'auto', spezStrom: opts.spezStrom || '',
           dachform:      opts.dachform      || 'sattel',
           dachAzimut:    opts.dachAzimut    ?? null,
           dachNeigung:   opts.dachNeigung   ?? null,
           dachAutoAzimut: opts.dachAutoAzimut || false};
  window.gebaeude.push(g);
  if(opts.coords){
    g.polygon=opts.coords;
    g.flaeche=polygonAreaM2(opts.coords);
    attachPolygonLayer(g);
    if((g.fromOsm || g.fromWfs) && g.flaeche && g.flaeche > 0){
      if(!g.stockwerke) g.stockwerke = 1;
      if(!g.baujahr) g.baujahr = parseInt(document.getElementById('osm-default-baujahr')?.value) || 1970;
      if(calcAutoEnergy(g) && !_batchImporting){ updateViz(); updateTotals(); recalcNetz(); }
    }
  }
  if(!_batchImporting) renderList();
  if(!opts.coords) startDraw(id);
  if(!_batchImporting) updateViz();
  // Unified Asset-System: Auto-Create UV + Verbraucher + PV
  // Nur wenn NICHT beim Projekt-Laden (skipAutoCreate:true) — dann kommen Assets aus dem Speicherzustand
  if (opts.coords && !opts.skipAutoCreate && typeof window.autoCreateBuildingAssets === 'function') {
    try { window.autoCreateBuildingAssets(g); } catch(e) { console.warn('autoCreateBuildingAssets:', e); }
  }
  return g;
}

export function attachPolygonLayer(g){
  if(g.polygonLayer) map.removeLayer(g.polygonLayer);
  g.polygonLayer=L.polygon(g.polygon,{
    color:g.fromOsm?'rgba(206,147,216,0.4)':'rgba(79,195,247,0.4)',
    weight:1.2,fillColor:'rgba(79,195,247,0.08)',fillOpacity:1
  }).addTo(map);
  g.polygonLayer.on('click',()=>{ selectFromMap(g.id); });
  if (!_batchImporting) updateViz();
}

export function removeGebaeude(id){
  const g=window.gebaeude.find(x=>x.id===id);
  if(!g) return;
  if(g.polygonLayer) map.removeLayer(g.polygonLayer);
  if(g.circleMarker) map.removeLayer(g.circleMarker);
  if(g.labelMarker) map.removeLayer(g.labelMarker);
  window.gebaeude=window.gebaeude.filter(x=>x.id!==id);
  window.netzEdges = window.netzEdges.filter(e => {
    if(e.u === id || e.v === id){
      map.removeLayer(e.layer);
      if(e.hitLayer) map.removeLayer(e.hitLayer);
      if(e.midMarker) map.removeLayer(e.midMarker);
      if(e.warnMarker) map.removeLayer(e.warnMarker);
      if(e.segLayers) e.segLayers.forEach(s => map.removeLayer(s));
      return false;
    }
    return true;
  });
  // Stromnetz-Kanten für dieses Gebäude entfernen
  window.stromEdges = window.stromEdges.filter(e => {
    const uN = window.stromNodes.find(n => n.id === e.u);
    const vN = window.stromNodes.find(n => n.id === e.v);
    if ((uN && uN.type === 'geb' && uN.gebId === id) || (vN && vN.type === 'geb' && vN.gebId === id)) {
      if(e.layer) map.removeLayer(e.layer);
      if(e.hitLayer) map.removeLayer(e.hitLayer);
      if(e.arrowMarker) map.removeLayer(e.arrowMarker);
      return false;
    }
    return true;
  });
  window.stromNodes = window.stromNodes.filter(n => !(n.type === 'geb' && n.gebId === id));
  renderList(); updateViz(); recalcNetz();
}

export function clearOsmBuildings(){
  hidePanels();
  const osmGeb = window.gebaeude.filter(g=>g.fromOsm);
  osmGeb.forEach(g => {
    if(g.polygonLayer) map.removeLayer(g.polygonLayer);
    if(g.circleMarker) map.removeLayer(g.circleMarker);
    if(g.labelMarker) map.removeLayer(g.labelMarker);
    if(g.hzLabelMarker) map.removeLayer(g.hzLabelMarker);
  });
  const osmIds = new Set(osmGeb.map(g=>g.id));
  window.netzEdges = window.netzEdges.filter(e => {
    if(osmIds.has(e.u) || osmIds.has(e.v)){
      if(e.layer) map.removeLayer(e.layer);
      if(e.hitLayer) map.removeLayer(e.hitLayer);
      if(e.midMarker) map.removeLayer(e.midMarker);
      if(e.warnMarker) map.removeLayer(e.warnMarker);
      if(e.segLayers) e.segLayers.forEach(s => map.removeLayer(s));
      return false;
    }
    return true;
  });
  window.stromEdges = window.stromEdges.filter(e => {
    const uN = window.stromNodes.find(n => n.id === e.u);
    const vN = window.stromNodes.find(n => n.id === e.v);
    if ((uN && uN.type === 'geb' && osmIds.has(uN.gebId)) || (vN && vN.type === 'geb' && osmIds.has(vN.gebId))) {
      if(e.layer) map.removeLayer(e.layer);
      if(e.hitLayer) map.removeLayer(e.hitLayer);
      if(e.arrowMarker) map.removeLayer(e.arrowMarker);
      return false;
    }
    return true;
  });
  window.stromNodes = window.stromNodes.filter(n => !(n.type === 'geb' && osmIds.has(n.gebId)));
  window.gebaeude = window.gebaeude.filter(g => !g.fromOsm);
  renderList(); updateViz(); updateTotals(); recalcNetz();
}

// Spez. Endenergie Wärme (kWh/m²a Wohnfläche) nach Baujahr – MFH-Referenz.
// Quelle: IWU TABULA DE, Ist-Zustand ("Actual Building"), inkl. Warmwasser.
// ── IWU/TABULA Gebäudetypologie — spez. Wärmebedarf [kWh/m²a] ──────────────
// Quelle: IWU Deutsche Gebäudetypologie 2015, TABULA WebTool
// Zeilen: Baujahresklassen, Spalten: Gebäudetyp (unsanierter Zustand)
export const IWU_SPEZ_WAERME = {
  // [Baujahr-bis]: { efh, mfh, ghd, buero, schule, industrie, oeffentlich }
  1918: { efh: 260, mfh: 195, ghd: 145, buero: 130, schule: 155, industrie: 80, oeffentlich: 160 },
  1948: { efh: 230, mfh: 180, ghd: 135, buero: 120, schule: 140, industrie: 70, oeffentlich: 145 },
  1957: { efh: 215, mfh: 165, ghd: 125, buero: 110, schule: 130, industrie: 65, oeffentlich: 135 },
  1968: { efh: 200, mfh: 150, ghd: 115, buero: 100, schule: 120, industrie: 55, oeffentlich: 125 },
  1978: { efh: 180, mfh: 135, ghd: 105, buero: 90,  schule: 105, industrie: 50, oeffentlich: 110 },
  1986: { efh: 155, mfh: 115, ghd: 90,  buero: 75,  schule: 85,  industrie: 40, oeffentlich: 95 },
  1995: { efh: 130, mfh: 95,  ghd: 75,  buero: 60,  schule: 70,  industrie: 35, oeffentlich: 80 },
  2001: { efh: 100, mfh: 75,  ghd: 60,  buero: 50,  schule: 55,  industrie: 28, oeffentlich: 65 },
  2009: { efh: 75,  mfh: 55,  ghd: 48,  buero: 40,  schule: 42,  industrie: 22, oeffentlich: 50 },
  2015: { efh: 55,  mfh: 40,  ghd: 38,  buero: 32,  schule: 35,  industrie: 18, oeffentlich: 40 },
  9999: { efh: 35,  mfh: 28,  ghd: 30,  buero: 25,  schule: 28,  industrie: 15, oeffentlich: 32 },
};
var _iwuGrenzen = Object.keys(IWU_SPEZ_WAERME).map(Number).sort(function(a,b){return a-b;});

export function getSpezNachBaujahr(baujahr, nutzung) {
  var y = parseInt(baujahr, 10) || 1970;
  var typ = nutzung || '';
  // IWU-Tabelle durchgehen
  for (var i = 0; i < _iwuGrenzen.length; i++) {
    if (y <= _iwuGrenzen[i]) {
      var row = IWU_SPEZ_WAERME[_iwuGrenzen[i]];
      return row[typ] || row.mfh; // MFH als Fallback wenn Nutzung unbekannt
    }
  }
  var last = IWU_SPEZ_WAERME[9999];
  return last[typ] || last.mfh;
}

// ── Stockwerk-Schätzung aus Gebäudetyp + Grundfläche ────────────────────────
// Wenn keine Stockwerkzahl aus Daten vorliegt, schätzen wir anhand von
// Gebäudetyp (GFK/Nutzung) und Grundfläche.
export function estimateStockwerke(nutzung, flaecheM2) {
  var f = flaecheM2 || 100;
  switch (nutzung) {
    case 'efh':    return f > 180 ? 1 : 2;          // großes EFH = Bungalow, sonst 2
    case 'mfh':    return f < 200 ? 3 : (f < 500 ? 4 : 5); // nach Grundfläche gestaffelt
    case 'buero':  return f < 300 ? 3 : 4;
    case 'schule': return 2;
    case 'industrie': return 1;
    case 'ghd':    return f < 200 ? 1 : 2;
    case 'oeffentlich': return f < 300 ? 2 : 3;
    default:       return f < 120 ? 2 : 1;           // unbekannt: kleines Gebäude = 2, groß = 1
  }
}

// ── Umfang eines Polygons [m] ────────────────────────────────────────────────
export function polygonPerimeterM(coords) {
  if (!coords || coords.length < 2) return 0;
  var perim = 0;
  for (var i = 0; i < coords.length; i++) {
    var a = coords[i], b = coords[(i + 1) % coords.length];
    // Haversine-Approximation (für kurze Distanzen reicht Equirectangular)
    var dlat = (b.lat - a.lat) * 111320;
    var dlng = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
    perim += Math.sqrt(dlat * dlat + dlng * dlng);
  }
  return perim;
}

// ── Gemeinsame Wandlänge mit Nachbargebäuden [m] ─────────────────────────────
// Erkennt geteilte Kanten (Reihenhaus, Doppelhaus) → reduziert Transmissionsverlust
export function sharedWallLength(g, allGebaeude) {
  if (!g.polygon || g.polygon.length < 3) return 0;
  var shared = 0;
  var SNAP = 0.000005; // ~0.5m Toleranz
  for (var gi = 0; gi < allGebaeude.length; gi++) {
    var other = allGebaeude[gi];
    if (other.id === g.id || !other.polygon || other.polygon.length < 3) continue;
    // Schneller Distanzcheck: Schwerpunkte > 50m auseinander → überspringen
    var cLat = g.polygon.reduce(function(s,p){return s+p.lat;},0)/g.polygon.length;
    var cLng = g.polygon.reduce(function(s,p){return s+p.lng;},0)/g.polygon.length;
    var oLat = other.polygon.reduce(function(s,p){return s+p.lat;},0)/other.polygon.length;
    var oLng = other.polygon.reduce(function(s,p){return s+p.lng;},0)/other.polygon.length;
    if (Math.abs(cLat-oLat) > 0.001 || Math.abs(cLng-oLng) > 0.001) continue;

    // Kanten vergleichen
    for (var i = 0; i < g.polygon.length; i++) {
      var a1 = g.polygon[i], a2 = g.polygon[(i+1) % g.polygon.length];
      for (var j = 0; j < other.polygon.length; j++) {
        var b1 = other.polygon[j], b2 = other.polygon[(j+1) % other.polygon.length];
        // Kante geteilt wenn Endpunkte übereinstimmen (in beliebiger Richtung)
        if ((Math.abs(a1.lat-b1.lat)<SNAP && Math.abs(a1.lng-b1.lng)<SNAP &&
             Math.abs(a2.lat-b2.lat)<SNAP && Math.abs(a2.lng-b2.lng)<SNAP) ||
            (Math.abs(a1.lat-b2.lat)<SNAP && Math.abs(a1.lng-b2.lng)<SNAP &&
             Math.abs(a2.lat-b1.lat)<SNAP && Math.abs(a2.lng-b1.lng)<SNAP)) {
          var dl = (a2.lat-a1.lat)*111320, dn = (a2.lng-a1.lng)*111320*Math.cos(a1.lat*Math.PI/180);
          shared += Math.sqrt(dl*dl + dn*dn);
        }
      }
    }
  }
  return shared;
}

// ── Heizlast aus Hüllfläche (vereinfachtes DIN 12831) ───────────────────────
// Nutzt Geometrie (A/V-Verhältnis, gemeinsame Wände) statt pauschaler Volllaststunden
export function calcHeizlastFromGeometry(g, allGebaeude) {
  if (!g.polygon || !g.flaeche || !g.stockwerke) return null;
  var stockwerke = g.stockwerke;
  var geschosshoehe = 2.8; // m
  var nutzflaeche = g.flaeche * stockwerke * 0.8;

  // Hüllfläche berechnen
  var perimeter = polygonPerimeterM(g.polygon);
  var sharedWall = sharedWallLength(g, allGebaeude);
  var freeWall = Math.max(0, perimeter - sharedWall);

  var wandFlaeche = freeWall * stockwerke * geschosshoehe; // Außenwand ohne geteilte Wände
  var dachFlaeche = g.flaeche;                              // Dach ≈ Grundfläche
  var bodenFlaeche = g.flaeche;                             // Bodenplatte
  var sharedWandFlaeche = sharedWall * stockwerke * geschosshoehe;

  // U-Werte nach Baujahr [W/m²K] (vereinfacht, unsaniert)
  var bj = parseInt(g.baujahr) || 1970;
  var uWand, uDach, uBoden;
  if      (bj < 1958) { uWand = 1.5;  uDach = 1.0;  uBoden = 1.0; }
  else if (bj < 1979) { uWand = 1.2;  uDach = 0.7;  uBoden = 0.8; }
  else if (bj < 1995) { uWand = 0.7;  uDach = 0.4;  uBoden = 0.5; }
  else if (bj < 2009) { uWand = 0.35; uDach = 0.25; uBoden = 0.35; }
  else                 { uWand = 0.24; uDach = 0.20; uBoden = 0.30; }

  // Transmissionswärmeverlust [W/K]
  var HT = wandFlaeche * uWand
         + dachFlaeche * uDach
         + bodenFlaeche * uBoden * 0.5  // Erdreich: reduzierter Temperaturunterschied
         + sharedWandFlaeche * 0.05;    // Geteilte Wand: minimaler Verlust (Nachbar beheizt)

  // Lüftungswärmeverlust [W/K] (0.5 Luftwechsel/h)
  var volumen = nutzflaeche * geschosshoehe / 0.8; // Bruttovolumen
  var HV = 0.34 * 0.5 * volumen; // 0.34 Wh/(m³K) × Luftwechselrate × Volumen

  // Normheizlast [kW] bei ΔT = 35K (Auslegung: -12°C außen, 20°C innen, abzgl. interne Gewinne)
  var deltaT = 32; // etwas reduziert durch interne Gewinne
  var heizlastW = (HT + HV) * deltaT;
  return heizlastW / 1000; // kW
}

export function calcAutoEnergy(g) {
  if (!g.flaeche || !g.baujahr) return false;
  if (g.waermeManual || g.heizlastManual) return false;

  // Stockwerke schätzen wenn nicht vorhanden oder = 1 (WFS-Default)
  if (!g.stockwerke || (g.stockwerke === 1 && (g.fromWfs || g.fromOsm) && !g._stockwerkeFromData)) {
    g.stockwerke = estimateStockwerke(g.nutzung, g.flaeche);
  }

  var nutzflaeche = g.flaeche * g.stockwerke * 0.8;

  // IWU/TABULA: spez. Wärmebedarf differenziert nach Baujahr UND Gebäudetyp
  var spezBedarf = Math.round(getSpezNachBaujahr(g.baujahr, g.nutzung));

  var waermeKWh = nutzflaeche * spezBedarf;
  g.waerme = Math.round((waermeKWh / 1000) * 10) / 10;
  g.spez = spezBedarf;

  // Heizlast: geometriebasiert (Hüllfläche, U-Werte, gemeinsame Wände)
  var geomHeizlast = calcHeizlastFromGeometry(g, window.gebaeude || []);
  if (geomHeizlast && geomHeizlast > 0) {
    g.heizlast = Math.round(geomHeizlast * 10) / 10;
  } else {
    // Fallback: Volllaststunden-Methode
    g.heizlast = Math.round((waermeKWh / 2000) * 10) / 10;
  }
  g.spezHeizlast = nutzflaeche > 0 ? Math.round((g.heizlast * 1000 / nutzflaeche) * 10) / 10 : 0;
  return true;
}

// OSM building=* → nutzung (interne Kennung)
export function osmNutzung(buildingTag) {
  const t = (buildingTag || '').toLowerCase();
  if (['house','detached','semidetached_house','semi_detached','bungalow',
       'chalet','cottage','terrace','farmhouse','villa','manor'].includes(t)) return 'efh';
  if (['apartments','residential','dormitory','block','flat'].includes(t)) return 'mfh';
  if (['commercial','retail','supermarket','kiosk','shop','store'].includes(t)) return 'ghd';
  if (['office','bank'].includes(t)) return 'buero';
  if (['school','university','college','kindergarten','training'].includes(t)) return 'schule';
  if (['industrial','warehouse','factory','manufacture'].includes(t)) return 'industrie';
  if (['public','civic','hospital','government','fire_station','police',
       'sports_hall','church','cathedral','mosque','temple'].includes(t)) return 'oeffentlich';
  return '';
}

// OSM building-Tags die wir nicht als Wärmelast modellieren wollen
export const OSM_SKIP_TYPES = new Set([
  'garage','garages','carport','shed','hut','roof','bridge',
  'parking','container','service','greenhouse','storage_tank','tent','ruins'
]);


// ── Nutzungstypen-Register ───────────────────────────────────────────────────
// Eingebaute Typen (schreibgeschützt, immer vorhanden)
// vbh = Vollbenutzungsstunden/a → Spitzenlast kW = MWh*1000/vbh
const _NUTZUNGSTYPEN_BUILTIN = [
  { id:'efh',        label:'EFH',         gruppe:'Wohnen',      spezStrom:25, slp:'H0', vbh:2200 },
  { id:'mfh',        label:'MFH',         gruppe:'Wohnen',      spezStrom:20, slp:'H0', vbh:2200 },
  { id:'ghd',        label:'GHD',         gruppe:'Gewerbe',     spezStrom:45, slp:'G0', vbh:2500 },
  { id:'schule',     label:'Schule',      gruppe:'Öffentlich',  spezStrom:18, slp:'G1', vbh:1800 },
  { id:'buero',      label:'Büro',        gruppe:'Gewerbe',     spezStrom:35, slp:'G1', vbh:1800 },
  { id:'industrie',  label:'Industrie',   gruppe:'Industrie',   spezStrom:60, slp:'G0', vbh:2500 },
  { id:'oeffentlich',label:'Öffentlich',  gruppe:'Öffentlich',  spezStrom:25, slp:'G1', vbh:1800 },
];

// Custom-Typen — projekt-scoped, wird mit Projekt gespeichert/geladen
export let NUTZUNGSTYPEN_CUSTOM = [];

// Vollständiges Register: eingebaut + custom
export function getNutzungstypen() {
  return [..._NUTZUNGSTYPEN_BUILTIN, ...NUTZUNGSTYPEN_CUSTOM];
}
export function getNutzungstypById(id) {
  return getNutzungstypen().find(t => t.id === id) || null;
}
export function isBuiltinNutzungstyp(id) {
  return _NUTZUNGSTYPEN_BUILTIN.some(t => t.id === id);
}

// Rückwärtskompatible Lookup-Helfer
export const STROM_SPEZ_DEFAULTS = new Proxy({}, {
  get(_, id) {
    const t = getNutzungstypById(id);
    return t ? t.spezStrom : 25;
  }
});
export const STROM_PROFIL_MAP = new Proxy({}, {
  get(_, id) {
    const t = getNutzungstypById(id);
    return t ? t.slp : 'H0';
  }
});

export function getAutoStrom(g) {
  // Auto-Strom: spezStrom * Nutzfläche, oder Defaultwert * Nutzfläche
  if (g.strom && parseFloat(g.strom) > 0) return '';
  const fl = (g.flaeche || 0) * (g.stockwerke || 1) * 0.8;
  if (fl <= 0) return '';
  const spez = g.spezStrom ? parseFloat(g.spezStrom) : (STROM_SPEZ_DEFAULTS[g.nutzung || ''] || 25);
  return (spez * fl / 1000).toFixed(1);
}

export function getAutoSpezStrom(g) {
  if (g.spezStrom && parseFloat(g.spezStrom) > 0) return '';
  return STROM_SPEZ_DEFAULTS[g.nutzung || ''] || 25;
}

export function getGebStromMwh(g) {
  // Resolve actual strom MWh/a for a building (Nutzfläche = Grundfläche × Stockwerke × 0.8)
  if (g.strom && parseFloat(g.strom) > 0) return parseFloat(g.strom);
  const fl = (g.flaeche || 0) * (g.stockwerke || 1) * 0.8;
  if (fl <= 0) return 0;
  const spez = g.spezStrom ? parseFloat(g.spezStrom) : (STROM_SPEZ_DEFAULTS[g.nutzung || ''] || 25);
  return spez * fl / 1000;
}

export function getGebStromProfil(g) {
  if (g.stromProfil && g.stromProfil !== 'auto') return g.stromProfil;
  return STROM_PROFIL_MAP[g.nutzung || ''] || 'H0';
}

// Vollbenutzungsstunden aus Register → für Spitzenlast-Berechnung im Wizard
export function getGebVbh(g) {
  const t = getNutzungstypById(g.nutzung || '');
  return t ? t.vbh : 2200; // Fallback: Haushalt
}

// Generate normalized SLP hour profile (8760 values summing to 1.0)
export const _slpCache = {};
export function getSlpProfile(profilTyp) {
  if (_slpCache[profilTyp]) return _slpCache[profilTyp];
  const n = 8760;
  const profile = new Float32Array(n);
  // Simplified SLP approximation
  for (let h = 0; h < n; h++) {
    const dayOfYear = Math.floor(h / 24);
    const hourOfDay = h % 24;
    const month = [31,28,31,30,31,30,31,31,30,31,30,31];
    let m = 0, d = dayOfYear;
    while (m < 11 && d >= month[m]) { d -= month[m]; m++; }
    const dayOfWeek = (dayOfYear + 3) % 7; // 0=Mo, 6=So (2026 starts on Thursday → offset 3)
    const isWeekend = dayOfWeek >= 5;

    let baseLoad = 1.0;
    if (profilTyp === 'H0') {
      // Haushalt: morgens + abends Peaks, Winter höher
      const seasonal = 1.0 + 0.15 * Math.cos((m - 0.5) / 12 * 2 * Math.PI);
      const hourly = hourOfDay >= 6 && hourOfDay <= 8 ? 1.3 :
                     hourOfDay >= 17 && hourOfDay <= 21 ? 1.5 :
                     hourOfDay >= 23 || hourOfDay <= 5 ? 0.5 : 0.9;
      const weekendFactor = isWeekend ? 1.1 : 1.0;
      baseLoad = seasonal * hourly * weekendFactor;
    } else if (profilTyp === 'G0' || profilTyp === 'G1') {
      // Gewerbe: Werktag-lastig, 8-18 Uhr
      const seasonal = 1.0 + 0.05 * Math.cos((m - 0.5) / 12 * 2 * Math.PI);
      const hourly = hourOfDay >= 8 && hourOfDay <= 17 ? 1.5 :
                     hourOfDay >= 7 && hourOfDay <= 18 ? 1.2 : 0.3;
      const weekendFactor = isWeekend ? (profilTyp === 'G1' ? 0.2 : 0.4) : 1.0;
      baseLoad = seasonal * hourly * weekendFactor;
    } else if (profilTyp === 'G4') {
      // Laden: Öffnungszeiten
      const hourly = hourOfDay >= 9 && hourOfDay <= 19 ? 1.6 :
                     hourOfDay >= 8 && hourOfDay <= 20 ? 1.1 : 0.3;
      const weekendFactor = isWeekend ? (dayOfWeek === 6 ? 0.8 : 0.3) : 1.0;
      baseLoad = hourly * weekendFactor;
    } else if (profilTyp === 'L0') {
      // Landwirtschaft
      const seasonal = 1.0 + 0.2 * Math.cos((m - 6) / 12 * 2 * Math.PI);
      const hourly = hourOfDay >= 5 && hourOfDay <= 19 ? 1.3 : 0.6;
      baseLoad = seasonal * hourly;
    }
    profile[h] = baseLoad;
  }
  // Normalize to sum = 1.0
  let sum = 0;
  for (let i = 0; i < n; i++) sum += profile[i];
  if (sum > 0) for (let i = 0; i < n; i++) profile[i] /= sum;
  _slpCache[profilTyp] = profile;
  return profile;
}

// Aggregate gebäudescharfe Stromverbräuche to system-level array
export function aggregateGebStrom() {
  const n = 8760;
  const total = new Float32Array(n);
  let totalMWh = 0;
  (window.gebaeude || []).forEach(g => {
    if (isExcluded(g.id)) return;
    const mwh = getGebStromMwh(g);
    if (mwh <= 0) return;
    totalMWh += mwh;
    const profil = getSlpProfile(getGebStromProfil(g));
    // Scale: profil sums to 1.0, multiply by MWh * 1000 = kWh total, result in kW per hour
    const kwhTotal = mwh * 1000;
    for (let h = 0; h < n; h++) {
      total[h] += profil[h] * kwhTotal;
    }
  });
  return { hourly: total, totalMWh };
}

export function updateField(id, field, val) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  _invalidateStats();

  if (field === 'flaeche') g.flaeche = val ? parseFloat(val) : null;
  else if (field === 'baujahr' || field === 'abrissjahr') g[field] = val ? parseInt(val) : null;
  else if (field === 'stockwerke') g.stockwerke = val ? parseInt(val) : 1;
  else g[field] = val;

  // Manuelle Eingabe merken → Auto-Berechnung sperren
  if (field === 'waerme') g.waermeManual = !!(val && parseFloat(val) > 0);
  if (field === 'heizlast') g.heizlastManual = !!(val && parseFloat(val) > 0);

  // Strom cross-calculation (Nutzfläche = Grundfläche × Stockwerke × 0.8)
  const _nfStrom = g.flaeche * (g.stockwerke || 1) * 0.8;
  if (field === 'strom' && _nfStrom > 0 && val && parseFloat(val) > 0) {
    g.spezStrom = Math.round(parseFloat(val) * 1000 / _nfStrom * 10) / 10;
  }
  if (field === 'spezStrom' && _nfStrom > 0 && val && parseFloat(val) > 0) {
    g.strom = (_nfStrom > 0 ? (parseFloat(val) * _nfStrom / 1000).toFixed(1) : '');
  }

  let autoCalculated = false;

  if (g.flaeche > 0) {
    if (['flaeche', 'baujahr', 'stockwerke'].includes(field)) {
      autoCalculated = calcAutoEnergy(g);

      if (autoCalculated) {
        const elW = document.querySelector(`[data-waerme="${g.id}"]`);
        if (elW) { elW.value = g.waerme; elW.style.color = '#4caf50'; }

        const elS = document.querySelector(`[data-spez="${g.id}"]`);
        if (elS) { elS.value = g.spez; elS.style.color = '#4caf50'; }

        const elH = document.querySelector(`[data-heizlast="${g.id}"]`);
        if (elH) { elH.value = g.heizlast; elH.style.color = '#4caf50'; }

        const elSH = document.querySelector(`[data-spezhl="${g.id}"]`);
        if (elSH) { elSH.value = g.spezHeizlast; elSH.style.color = '#4caf50'; }
      }
    }

    if (!autoCalculated) {
      if (field === 'waerme' || field === 'flaeche') {
        if (g.waerme && parseFloat(g.waerme) > 0) {
          g.spez = Math.round(parseFloat(g.waerme) * 1000 / g.flaeche * 10) / 10;
          const el = document.querySelector(`[data-spez="${g.id}"]`);
          if (el) { el.value = g.spez; el.style.color = '#4caf50'; }
        }
      }
      if (field === 'heizlast' || field === 'flaeche') {
        if (g.heizlast && parseFloat(g.heizlast) > 0) {
          g.spezHeizlast = Math.round(parseFloat(g.heizlast) * 1000 / g.flaeche * 10) / 10;
          const el = document.querySelector(`[data-spezhl="${g.id}"]`);
          if (el) { el.value = g.spezHeizlast; el.style.color = '#4caf50'; }
        }
      }
      if (field === 'spez' && g.spez) {
        g.waerme = Math.round(parseFloat(g.spez) * g.flaeche / 1000 * 10) / 10;
        const el = document.querySelector(`[data-waerme="${g.id}"]`);
        if (el) { el.value = g.waerme; el.style.color = '#4caf50'; }
      }
      if (field === 'spezHeizlast' && g.spezHeizlast) {
        g.heizlast = Math.round(parseFloat(g.spezHeizlast) * g.flaeche / 1000 * 10) / 10;
        const el = document.querySelector(`[data-heizlast="${g.id}"]`);
        if (el) { el.value = g.heizlast; el.style.color = '#4caf50'; }
      }
    }
  }

  const dot = document.querySelector('[data-dot="' + g.id + '"]');
  if (dot) dot.style.background = cardDotColor(g);

  // Update compact row summary stats without rebuilding the card
  const _cvW = document.querySelector(`.geb-cv-waerme-${id}`);
  const _cvH = document.querySelector(`.geb-cv-hl-${id}`);
  if (_cvW || _cvH) {
    const _cs = getComputedStats(g, window.globalYear);
    if (_cvW) _cvW.textContent = _cs.waerme > 0 ? Math.round(_cs.waerme).toLocaleString('de-DE') : '—';
    if (_cvH) _cvH.textContent = _cs.heizlast > 0 ? Math.round(_cs.heizlast).toLocaleString('de-DE') : '—';
  }

  updateVizDebounced();
  updateTotals();
  if (field === 'heizlast' || field === 'spezHeizlast' || autoCalculated) recalcNetz();
  if (document.getElementById('chart-panel').classList.contains('visible')) drawChart();
  if (['waerme','heizlast','flaeche','spez','spezHeizlast','baujahr','nutzung'].includes(field)) {
    glBerechnenDebounced(1500);
  }
}

export function renameGebaeude(id,name){
  const g=window.gebaeude.find(x=>x.id===id);
  if(!g) return;
  g.name=name;
  // Karten-Header sofort aktualisieren
  const nameSpan = document.querySelector(`#card-${id} .geb-compact-name`);
  if (nameSpan) nameSpan.textContent = name;
  // Karten-Label auf der Karte aktualisieren
  if(g.labelMarker){
    const el=g.labelMarker.getElement();
    if(el){ const inner=el.querySelector('.geb-label-inner'); if(inner) inner.innerHTML=_gebLabelHtml(g); }
  }
  populateZentraleSelect();
}

export function highlightCard(id) {
  window.selectedId = id;
  document.querySelectorAll('.geb-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('card-' + id);
  if (card) card.classList.add('selected');
}

export function togglePlanPanel(id){
  const p = document.getElementById('plan-'+id);
  if(p) p.classList.toggle('visible');
}

export function changePlanMode(id, mode) {
  document.getElementById(`plan-mode-neubau-${id}`).style.display = (mode === 'neubau') ? 'flex' : 'none';
  document.getElementById(`plan-mode-sanierung-${id}`).style.display = (mode === 'sanierung') ? 'flex' : 'none';
  document.getElementById(`plan-mode-abriss-${id}`).style.display = (mode === 'abriss') ? 'flex' : 'none';
}

export function savePlan(id, mode) {
  const g = window.gebaeude.find(x => x.id === id);
  if(!g) return;
  
  if (mode === 'neubau') {
    const val = document.getElementById(`inp-neubau-${id}`).value;
    if(val) g.baujahr = parseInt(val);
  } else if (mode === 'abriss') {
    const val = document.getElementById(`inp-abriss-${id}`).value;
    if(val) g.abrissjahr = parseInt(val);
  } else if (mode === 'sanierung') {
    const jahr = parseInt(document.getElementById(`inp-san-jahr-${id}`).value);
    const spez = parseFloat(document.getElementById(`inp-san-spez-${id}`).value);
    if(jahr && spez) {
      if(!g.sanierungen) g.sanierungen = [];
      g.sanierungen.push({jahr, zielSpez: spez});
      g.sanierungen.sort((a,b)=>a.jahr-b.jahr);
    }
  }
  
  _invalidateStats();
  renderList(); updateViz(); updateTotals(); recalcNetz();
}

export function clearPlan(id, type, idx) {
  const g = window.gebaeude.find(x => x.id === id);
  if(!g) return;
  if(type === 'neubau') g.baujahr = null;
  if(type === 'abriss') g.abrissjahr = null;
  if(type === 'sanierung') g.sanierungen.splice(idx, 1);
  _invalidateStats();
  renderList(); updateViz(); updateTotals(); recalcNetz();
}

