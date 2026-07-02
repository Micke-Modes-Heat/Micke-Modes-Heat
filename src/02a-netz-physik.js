// ── 02a-netz-physik.js — Rohrphysik, Wärmeverlust, Farbschemata, Legende ──
// ─────────────────────────────────────────────────────────────────────────────

import { edgeKey, edgeWaypoints, netzVisible, selectedStrandId } from './01-globals-varianten.js';
import { map } from './02b-gebaeude.js';
import { recalcNetz } from './03b-netz.js';
import { KMR_KOSTEN } from './config/netz-kosten.js';

export let overlayLayer = null;

export const standardDNs = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800];

// KMR_KOSTEN → config/netz-kosten.js (wird vorher geladen)

export let kostenSzenario = 'mittel'; // 'niedrig' | 'mittel' | 'hoch'
export function setKostenSzenario(v) { kostenSzenario = v; }
export let netzColorMode = 'wld'; // 'wld' | 'temp' | 'dn' | 'auslastung' | 'abkuehlung'

export function getKostenProM(dn, edgeKlasse) {
  const row = KMR_KOSTEN[dn];
  if (!row) return 0;
  const klass = edgeKlasse || kostenSzenario;
  const idx = {niedrig: 0, mittel: 1, hoch: 2}[klass] ?? 1;
  return row[idx];
}

// ── Physikalisch korrekte Hilfsfunktionen ─────────────────────────────────

// U-Wert abhängig von DN (Typische KMR-Werte, W/(m·K) für VL+RL gesamt)
// Quelle: Nussbaumer/AGFW, preinsulated KMR pipes
export function getUWertForDN(dn, baseU) {
  // baseU ist der User-Eingabewert (Referenz für DN100)
  // Skalierung: kleinere Rohre → schlechterer U-Wert, größere → besserer
  const ref = baseU || 0.25;
  const DN_U_FACTORS = {
    15: 1.6, 20: 1.5, 25: 1.4, 32: 1.3, 40: 1.2, 50: 1.15,
    65: 1.08, 80: 1.04, 100: 1.0, 125: 0.92, 150: 0.85,
    200: 0.75, 250: 0.68, 300: 0.62, 350: 0.58, 400: 0.55,
    450: 0.52, 500: 0.50, 600: 0.46, 700: 0.43, 800: 0.40
  };
  const factor = DN_U_FACTORS[dn] || 1.0;
  return ref * factor;
}

// Empfohlene Fließgeschwindigkeit abhängig von DN (m/s)
// Kleine Rohre: langsamer (Geräusch, Druckverlust), große: schneller
export function getVFlowForDN(dn, baseV) {
  const ref = baseV || 1.0;
  if (dn <= 25)  return ref * 0.5;
  if (dn <= 40)  return ref * 0.6;
  if (dn <= 65)  return ref * 0.75;
  if (dn <= 100) return ref * 0.9;
  if (dn <= 200) return ref * 1.0;
  if (dn <= 400) return ref * 1.2;
  return ref * 1.5;  // DN450+
}

// Echte Polyline-Länge berechnen (mit Waypoints)
export function calcEdgeLength(e) {
  const pts = e.layer ? e.layer.getLatLngs() : null;
  if (!pts || pts.length < 2) return e._straightLength || 0;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += pts[i - 1].distanceTo(pts[i]);
  }
  return len;
}

// Vollbenutzungsstunden für die WLD-Bewertung: nach der Grundlagenberechnung
// die echten VBH aus dem Lastgang (Jahresenergie / Spitzenlast), sonst
// konservativ 1800 h/a als Vorab-Schätzung.
export function getNetzVBH() {
  const ss = window.systemState;
  if (ss && ss.pMaxKw > 0 && ss.gesamtMwhMitNV > 0) {
    return (ss.gesamtMwhMitNV * 1000) / ss.pMaxKw;
  }
  return 1800;
}

export function getWLD(edge) {
  // Wärmeliniendichte in MWh/(m·a) = Jahreswärme der angeschlossenen Abnehmer / Trassenlänge
  const VBH = getNetzVBH();
  if (!edge.length || edge.length <= 0) return 0;
  const waerme_mwh = ((edge.loadRaw || edge.load) * VBH) / 1000; // kW * h / 1000 = MWh
  return waerme_mwh / edge.length;
}

export function getWLDColor(wld) {
  // < 0.5: rot, 0.5-1.0: orange, 1.0-2.0: gelb, > 2.0: grün
  if (wld <= 0) return '#999';
  if (wld < 0.5) return '#e53935';
  if (wld < 1.0) return '#f9a825';
  if (wld < 2.0) return '#8bc34a';
  return '#4caf50';
}

export function setNetzColorMode(mode) {
  netzColorMode = mode;
  document.querySelectorAll('#netz-color-toggle .viz-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('ncbtn-' + mode);
  if (btn) btn.classList.add('active');
  // Left-panel Einfärbung buttons
  document.querySelectorAll('#lp-netz-viz .lp-tool-btn').forEach(b => {
    const isActive = b.getAttribute('onclick')?.includes("'" + mode + "'");
    b.style.background = isActive ? 'rgba(79,195,247,0.15)' : '';
    b.style.borderColor = isActive ? 'var(--accent)' : '';
    b.style.color = isActive ? 'var(--accent)' : '';
  });
  recalcNetz();
}

export function getEdgeColor(e, vlTemp, dt, vFlow) {
  if (!e.load || e.load <= 0) return '#555';

  const cp = 4.184;
  const actualArea = Math.PI * Math.pow((e.dn / 1000) / 2, 2);
  const mDot = e.load / (cp * dt);
  const maxMDot = actualArea * vFlow * 1000;
  const maxLoad = maxMDot * cp * dt;
  const auslastung = (e.load / maxLoad) * 100;

  switch (netzColorMode) {
    case 'wld': {
      return getWLDColor(getWLD(e));
    }
    case 'temp': {
      const t = e.tempOut ?? vlTemp;
      return tempToColor(t, vlTemp);
    }
    case 'dn': {
      // DN-Farbskala: klein=grün, groß=rot (größere DN = höhere Kosten)
      const maxDN = 800;
      const t = Math.min(1, e.dn / maxDN);
      // grün → gelb → rot
      if (t < 0.2) return '#4caf50';
      if (t < 0.4) return '#8bc34a';
      if (t < 0.6) return '#f9a825';
      if (t < 0.8) return '#ef6c00';
      return '#e53935';
    }
    case 'auslastung': {
      // < 30% unterausgelastet (blau), 30-80% gut (grün), 80-100% hoch (orange), > 100% überlastet (rot)
      if (auslastung > 100) return '#e53935';
      if (auslastung > 80)  return '#f9a825';
      if (auslastung > 30)  return '#4caf50';
      return '#4fc3f7'; // unterausgelastet
    }
    case 'abkuehlung': {
      const drop = (e.tempIn ?? vlTemp) - (e.tempOut ?? vlTemp);
      if (drop < 0.5) return '#4caf50';
      if (drop < 2.0) return '#8bc34a';
      if (drop < 5.0) return '#f9a825';
      return '#e53935';
    }
    case 'verlust': {
      if (!(e.loadRaw || e.load) || !e.lossKW) return '#555';
      const pct = (e.lossKW / (e.loadRaw || e.load)) * 100;
      const t = Math.max(0, Math.min(1, pct / 10));
      return t < 0.5 ? lerpColor('#4caf50','#f9a825', t*2) : lerpColor('#f9a825','#e53935', (t-0.5)*2);
    }
    case 'subtree': {
      // Subtree-WLD: Wirtschaftlichkeit des gesamten Strangs ab hier
      const swld = e.subtreeWLD || 0;
      if (swld <= 0) return '#999';
      if (swld < 0.5) return '#e53935';       // unwirtschaftlich
      if (swld < 1.0) return '#f9a825';       // grenzwertig
      if (swld < 1.5) return '#c0ca33';       // ok
      if (swld < 2.0) return '#8bc34a';       // wirtschaftlich
      return '#4caf50';                        // sehr wirtschaftlich
    }
    case 'netzkosten': {
      // Netzkosten-Zuschlag €/MWh: niedrig=grün, hoch=rot
      const z = e._strangNetzZuschlag || 0;
      if (z <= 5)  return '#4caf50';   // sehr günstig
      if (z <= 15) return '#8bc34a';   // günstig
      if (z <= 30) return '#f9a825';   // moderat
      if (z <= 60) return '#ef6c00';   // teuer
      return '#e53935';                // sehr teuer
    }
    case 'druck': {
      // Druckverlust Pa/m: <100 grün, 100-200 gelb, 200-300 orange, >300 rot
      const dp = e.dpPerM || 0;
      if (dp < 100) return '#4caf50';
      if (dp < 200) return '#8bc34a';
      if (dp < 300) return '#f9a825';
      if (dp < 400) return '#ef6c00';
      return '#e53935';
    }
    case 'geschw': {
      // Fließgeschwindigkeit m/s: <0.5 blau (langsam), 0.5-1.0 grün, 1.0-1.5 gelb, >1.5 rot (zu schnell)
      const v = e._vActual || 0;
      if (v < 0.3) return '#4fc3f7';  // sehr langsam
      if (v < 0.7) return '#4caf50';  // gut
      if (v < 1.2) return '#8bc34a';  // normal
      if (v < 1.8) return '#f9a825';  // hoch
      return '#e53935';               // zu schnell
    }
    default: return getWLDColor(getWLD(e));
  }
}

export function lerpColor(c1, c2, t) {
  const r1=parseInt(c1.slice(1,3),16), g1=parseInt(c1.slice(3,5),16), b1=parseInt(c1.slice(5,7),16);
  const r2=parseInt(c2.slice(1,3),16), g2=parseInt(c2.slice(3,5),16), b2=parseInt(c2.slice(5,7),16);
  const r=Math.round(r1+t*(r2-r1)), g=Math.round(g1+t*(g2-g1)), b=Math.round(b1+t*(b2-b1));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export function tempToColor(t, vlTemp) {
  return lerpColor('#4caf50', '#e53935', Math.max(0, Math.min(1, (vlTemp - t) / 15)));
}

export function interpolateAlongPts(pts, t) {
  const dists = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = pts[i-1].distanceTo(pts[i]); dists.push(d); total += d; }
  if (total === 0) return pts[0];
  let target = t * total, acc = 0;
  for (let i = 0; i < dists.length; i++) {
    if (acc + dists[i] >= target || i === dists.length - 1) {
      const localT = dists[i] > 0 ? Math.min(1, (target - acc) / dists[i]) : 0;
      return L.latLng(pts[i].lat + localT*(pts[i+1].lat-pts[i].lat), pts[i].lng + localT*(pts[i+1].lng-pts[i].lng));
    }
    acc += dists[i];
  }
  return pts[pts.length - 1];
}

export function getEdgeMidDisplayPt(e) {
  const pts = e.layer.getLatLngs();
  if (!pts || pts.length < 2) return e.uNode ? e.uNode.pt : L.latLng(0,0);
  return interpolateAlongPts(pts, 0.5);
}

export function clearEdgeGradient(e) {
  if (!e.segLayers) { e.segLayers = []; return; }
  e.segLayers.forEach(s => { if (map.hasLayer(s)) map.removeLayer(s); });
  e.segLayers = [];
  e.layer.setStyle({opacity: 0.8});
}

export function drawEdgeGradient(e, vlTemp, dt, vFlow) {
  clearEdgeGradient(e);
  const pts = e.layer.getLatLngs();
  if (!pts || pts.length < 2 || !e.load || e.load <= 0) return;
  const tIn = e.tempIn ?? vlTemp;
  const tOut = e.tempOut ?? vlTemp;
  const N = 12;
  const w = Math.max(1.5, Math.min(5, 1 + e.dn / 50));
  const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
  for (let i = 0; i < N; i++) {
    const t0 = i/N, t1 = (i+1)/N, tMid = (t0+t1)/2;
    const p0 = interpolateAlongPts(pts, t0);
    const p1 = interpolateAlongPts(pts, t1);
    let col;
    if (netzColorMode === 'temp') {
      col = tempToColor(tIn + tMid*(tOut-tIn), vlTemp);
    } else {
      const drop = (tIn - tOut) * tMid;
      col = drop < 0.5 ? '#4caf50' : drop < 2.0 ? '#8bc34a' : drop < 5.0 ? '#f9a825' : '#e53935';
    }
    const seg = L.polyline([p0, p1], {color: col, weight: dim ? 2 : w, opacity: dim ? 0.2 : 0.85, interactive: false});
    if (netzVisible) seg.addTo(map);
    e.segLayers.push(seg);
  }
  e.layer.setStyle({opacity: 0});
}

export function addEdgeMidHandle(edgeObj) {
  const icon = L.divIcon({className:'netz-mid-handle', html:'', iconSize:[8,8], iconAnchor:[4,4]});
  const midPt = getEdgeMidDisplayPt(edgeObj);
  edgeObj.midMarker = L.marker(midPt, {draggable: true, icon, zIndexOffset: 1500});
  if (netzVisible) edgeObj.midMarker.addTo(map);
  edgeObj.midMarker.on('drag', function() {
    edgeObj.waypoint = this.getLatLng();
    edgeWaypoints[edgeKey(edgeObj.u, edgeObj.v)] = {lat: edgeObj.waypoint.lat, lng: edgeObj.waypoint.lng};
    const ll = edgeObj.layer.getLatLngs();
    const start = ll[0], end = ll[ll.length-1];
    edgeObj.layer.setLatLngs([start, edgeObj.waypoint, end]);
    if (edgeObj.hitLayer) edgeObj.hitLayer.setLatLngs([start, edgeObj.waypoint, end]);
    if (edgeObj.segLayers && edgeObj.segLayers.length > 0) {
      const vlTemp = parseFloat(document.getElementById('netz-vl').value)||90;
      const rlTemp = parseFloat(document.getElementById('netz-rl').value)||60;
      const dt = Math.max(1, vlTemp-rlTemp);
      const vFlow = parseFloat(document.getElementById('netz-v').value)||1.0;
      drawEdgeGradient(edgeObj, vlTemp, dt, vFlow);
    }
  });
  edgeObj.midMarker.on('dblclick', function(ev) {
    L.DomEvent.stopPropagation(ev);
    edgeObj.waypoint = null;
    delete edgeWaypoints[edgeKey(edgeObj.u, edgeObj.v)];
    const ll = edgeObj.layer.getLatLngs();
    const start = ll[0], end = ll[ll.length-1];
    edgeObj.layer.setLatLngs([start, end]);
    if (edgeObj.hitLayer) edgeObj.hitLayer.setLatLngs([start, end]);
    recalcNetz();
  });
  edgeObj.midMarker.on('dragend', function() { recalcNetz(); });
}

export function updateNetzColorLegend() {
  const el = document.getElementById('netz-color-legend');
  if (!el) return;

  const legends = {
    wld: [
      ['#e53935', '< 0,5 MWh/(m·a)', 'unwirtschaftlich'],
      ['#f9a825', '0,5 – 1,0',        'grenzwertig'],
      ['#8bc34a', '1,0 – 2,0',        'wirtschaftlich'],
      ['#4caf50', '≥ 2,0',            'sehr wirtschaftlich'],
    ],
    temp: (() => {
      const vl = parseFloat(document.getElementById('netz-vl')?.value) || 90;
      return [
        ['#4caf50', `${vl} °C`,       'optimal (Vorlauf)'],
        ['#8bc34a', `${vl-5} °C`,     'leicht abgekühlt'],
        ['#f9a825', `${vl-10} °C`,    'stark abgekühlt'],
        ['#e53935', `≤ ${vl-15} °C`,  'kritisch'],
      ];
    })(),
    dn: [
      ['#4caf50', 'DN 15 – 50',   'klein'],
      ['#8bc34a', 'DN 65 – 125',  'mittel'],
      ['#f9a825', 'DN 150 – 300', 'groß'],
      ['#e53935', 'DN 350+',      'sehr groß'],
    ],
    auslastung: [
      ['#4fc3f7', '< 30 %',    'unterausgelastet'],
      ['#4caf50', '30 – 80 %', 'gut ausgelastet'],
      ['#f9a825', '80 – 100 %','hoch ausgelastet'],
      ['#e53935', '> 100 %',   'überlastet'],
    ],
    abkuehlung: [
      ['#4caf50', '< 0,5 K', 'vernachlässigbar'],
      ['#8bc34a', '0,5 – 2 K','gering'],
      ['#f9a825', '2 – 5 K',  'mittel'],
      ['#e53935', '> 5 K',    'hoch'],
    ],
    verlust: [
      ['#4caf50', '< 2,5 %',   'sehr gering'],
      ['#8bc34a', '2,5 – 5 %', 'gering'],
      ['#f9a825', '5 – 7,5 %', 'mittel'],
      ['#e53935', '> 7,5 %',   'hoch'],
    ],
    subtree: [
      ['#e53935', '< 0,5',     'unwirtschaftlich — Abtrennung prüfen'],
      ['#f9a825', '0,5 – 1,0', 'grenzwertig'],
      ['#c0ca33', '1,0 – 1,5', 'ausreichend'],
      ['#8bc34a', '1,5 – 2,0', 'wirtschaftlich'],
      ['#4caf50', '≥ 2,0',     'sehr wirtschaftlich'],
    ],
    netzkosten: [
      ['#4caf50', '≤ 5 €/MWh',     'sehr günstig'],
      ['#8bc34a', '5 – 15 €/MWh',  'günstig'],
      ['#f9a825', '15 – 30 €/MWh', 'moderat'],
      ['#ef6c00', '30 – 60 €/MWh', 'teuer — Wirtschaftlichkeit prüfen'],
      ['#e53935', '> 60 €/MWh',    'sehr teuer — Abtrennung prüfen'],
    ],
    druck: [
      ['#4caf50', '< 100 Pa/m',     'gering'],
      ['#8bc34a', '100 – 200 Pa/m', 'normal'],
      ['#f9a825', '200 – 300 Pa/m', 'erhöht'],
      ['#ef6c00', '300 – 400 Pa/m', 'hoch'],
      ['#e53935', '> 400 Pa/m',     'kritisch — DN prüfen'],
    ],
    geschw: [
      ['#4fc3f7', '< 0,3 m/s',     'sehr langsam'],
      ['#4caf50', '0,3 – 0,7 m/s', 'gut'],
      ['#8bc34a', '0,7 – 1,2 m/s', 'normal'],
      ['#f9a825', '1,2 – 1,8 m/s', 'hoch'],
      ['#e53935', '> 1,8 m/s',     'zu schnell — Geräusch/Erosion'],
    ],
  };

  const items = legends[netzColorMode] || [];
  el.innerHTML = items.map(([color, range, label]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;margin-bottom:2px;">
      <span style="width:20px;height:4px;background:${color};border-radius:2px;display:inline-block;flex-shrink:0"></span>
      <span style="color:${color}">${range}</span>
      <span style="color:var(--muted);font-size:9px">${label}</span>
    </span>`
  ).join('');
}
