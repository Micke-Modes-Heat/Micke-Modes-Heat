// ── 15a-stromnetz-render.js — Leaflet-Darstellung für Trassen + Leitungen ──
// Portiert aus Standalone-Elektroteil (elDrawTrasse/elDrawLeitung/elOffsetRoute,
// Init aus elInit).
// Zeichnet nur — keine Interaktion (Modus, Klick-Handler für Zeichnen etc.
// kommen in Phase 3.2b). Keine Rechenergebnis-Farben (kommt in 3.2c).

import { map } from './02b-gebaeude.js';
import { globalYear } from './01-globals-varianten.js';
import { ASSETS, getAssetStatus } from './13a-assets-core.js';
import { STROMNETZ, listStromLeitungen } from './14b-stromnetz-state.js';
import { ptDist } from './14c-stromnetz-graph.js';

let _stromnetzLayerVisible = true;

// ── Init: LayerGroups anlegen und (falls sichtbar) auf Karte legen ─────────
function ensureLayers() {
  if (!STROMNETZ.grpTrasse)  STROMNETZ.grpTrasse  = L.layerGroup();
  if (!STROMNETZ.grpLeitung) STROMNETZ.grpLeitung = L.layerGroup();
  applyLayerVisibility();
}

function applyLayerVisibility() {
  if (!STROMNETZ.grpTrasse || !STROMNETZ.grpLeitung) return;
  if (_stromnetzLayerVisible) {
    STROMNETZ.grpTrasse.addTo(map);
    STROMNETZ.grpLeitung.addTo(map);
  } else {
    STROMNETZ.grpTrasse.remove();
    STROMNETZ.grpLeitung.remove();
  }
}

// ── Trasse zeichnen ─────────────────────────────────────────────────────────
export function drawTrasse(tr) {
  ensureLayers();
  if (!tr.pts || tr.pts.length < 2) return;
  if (tr._poly) STROMNETZ.grpTrasse.removeLayer(tr._poly);
  tr._poly = L.polyline(tr.pts, {
    color: '#00bcd4', weight: 2.5, dashArray: '10 5', opacity: 0.9,
  });
  tr._poly.bindTooltip('Stromtrasse', { sticky: true, opacity: 0.8 });
  STROMNETZ.grpTrasse.addLayer(tr._poly);
}

// ── Parallele Leitungen senkrecht versetzen ─────────────────────────────────
// Verschiebt Route um d_m Meter senkrecht zur Gesamtrichtung A→B.
export function offsetRoute(route, offsetIndex, totalParallel) {
  if (totalParallel <= 1 || route.length < 2) return route;
  const OFFSET_M = 4;  // Meter Abstand zwischen je zwei Parallelleitungen
  const d_m = (offsetIndex - (totalParallel - 1) / 2) * OFFSET_M;
  if (Math.abs(d_m) < 0.001) return route;

  const ptA = route[0], ptB = route[route.length - 1];
  const latA = Array.isArray(ptA) ? ptA[0] : ptA.lat;
  const lngA = Array.isArray(ptA) ? ptA[1] : ptA.lng;
  const latB = Array.isArray(ptB) ? ptB[0] : ptB.lat;
  const lngB = Array.isArray(ptB) ? ptB[1] : ptB.lng;
  const avgLat = (latA + latB) / 2;
  const cosLat = Math.cos(avgLat * Math.PI / 180);

  const dx_m  = (lngB - lngA) * 111320 * cosLat;
  const dy_m  = (latB - latA) * 111320;
  const len_m = Math.sqrt(dx_m * dx_m + dy_m * dy_m);
  if (len_m < 0.001) return route;

  const delta_lat = (-dx_m / len_m) * d_m / 111320;
  const delta_lng = ( dy_m / len_m) * d_m / (111320 * cosLat);

  return route.map(pt => [
    (Array.isArray(pt) ? pt[0] : pt.lat) + delta_lat,
    (Array.isArray(pt) ? pt[1] : pt.lng) + delta_lng,
  ]);
}

// ── Ebene (MS/NS) bestimmen ─────────────────────────────────────────────────
// MS = Verbindung zwischen 2 Hochspannungs-Komponenten (NAP/Schaltanlage/Trafo),
// außer Trafo↔Trafo (das wäre NS-Seite). Sonst NS.
function bestimmeEbene(lt) {
  if (lt.ebene) return lt.ebene;
  const a = ASSETS.items.find(x => x.id === lt.aId);
  const b = ASSETS.items.find(x => x.id === lt.bId);
  const msTypes = new Set(['NAP', 'Schaltanlage', 'Trafo']);
  const autoMS  = msTypes.has(a?.type) && msTypes.has(b?.type)
               && !(a?.type === 'Trafo' && b?.type === 'Trafo');
  return autoMS ? 'MS' : 'NS';
}

// ── Leitung zeichnen ────────────────────────────────────────────────────────
// _noParallelUpdate=true vermeidet Endlosrekursion bei parallelen Leitungen.
export function drawLeitung(lt, _noParallelUpdate) {
  ensureLayers();
  if (!lt.route || lt.route.length < 2) return;
  if (lt._poly) STROMNETZ.grpLeitung.removeLayer(lt._poly);

  const status  = getAssetStatus(lt, globalYear);
  const opacity = status === 'active' ? 1 : 0.3;
  const dash    = status === 'planned' ? '4 4'
                : status === 'demolished' ? '2 6' : null;

  const ebene = bestimmeEbene(lt);
  // Farbe: MS = orange, NS = blau (Szenario-Farben kommen in Phase 3.3)
  const color = ebene === 'MS' ? '#f9a825' : '#4fc3f7';

  // Länge aus Original-Route (nicht aus versetzter)
  let laenge = 0;
  for (let i = 1; i < lt.route.length; i++) laenge += ptDist(lt.route[i-1], lt.route[i]);
  if (!lt._result) lt._result = {};
  lt._result.laengeM = laenge;

  // Parallel-Index: alle Leitungen zwischen denselben Assets (beide Richtungen)
  const parallels = listStromLeitungen().filter(l =>
    (l.aId === lt.aId && l.bId === lt.bId) ||
    (l.aId === lt.bId && l.bId === lt.aId));
  parallels.sort((a, b) => a.id < b.id ? -1 : 1);
  const offsetIdx = parallels.findIndex(l => l.id === lt.id);
  const drawRoute = offsetRoute(lt.route, offsetIdx, parallels.length);

  const weight = ebene === 'MS' ? 3.5 : 2.5;
  lt._poly = L.polyline(drawRoute, { color, weight, opacity, dashArray: dash });
  const ebeneLabel = ebene === 'MS' ? ' [MS]' : '';
  lt._poly.bindTooltip(
    `<b>Leitung${ebeneLabel}</b><br>${lt.qs} mm² × ${lt.parallelCount}<br>${Math.round(laenge)} m`,
    { sticky: true, opacity: 0.9 });
  STROMNETZ.grpLeitung.addLayer(lt._poly);

  // Alle anderen parallelen Leitungen neu zeichnen, damit deren Offset stimmt
  if (!_noParallelUpdate) {
    parallels.filter(l => l.id !== lt.id).forEach(pl => drawLeitung(pl, true));
  }
}

// ── Lebenszyklus einer Leitung aus ihren Endpunkten ableiten ────────────────
// Baujahr   = spätestes der beiden Endpunkt-Baujahre
// Abrissjahr = frühestes der beiden Endpunkt-Abrissjahre
export function leitungInheritLifecycle(lt) {
  const a = ASSETS.items.find(x => x.id === lt.aId);
  const b = ASSETS.items.find(x => x.id === lt.bId);
  const bjs = [a?.baujahr,    b?.baujahr   ].filter(Boolean).map(Number);
  const ajs = [a?.abrissjahr, b?.abrissjahr].filter(Boolean).map(Number);
  lt.baujahr    = bjs.length ? Math.max(...bjs) : null;
  lt.abrissjahr = ajs.length ? Math.min(...ajs) : null;
}

// ── Redraw-API ──────────────────────────────────────────────────────────────
export function redrawAllTrassen() {
  ensureLayers();
  STROMNETZ.grpTrasse.clearLayers();
  for (const tr of STROMNETZ.trassen) tr._poly = null;
  for (const tr of STROMNETZ.trassen) drawTrasse(tr);
}

export function redrawAllStromLeitungen() {
  ensureLayers();
  STROMNETZ.grpLeitung.clearLayers();
  const leitungen = listStromLeitungen();
  for (const lt of leitungen) lt._poly = null;
  for (const lt of leitungen) drawLeitung(lt, true);  // _noParallelUpdate: wir zeichnen eh alle
}

export function redrawAllStromnetz() {
  redrawAllTrassen();
  redrawAllStromLeitungen();
}

// ── Sichtbarkeit ────────────────────────────────────────────────────────────
export function setStromnetzVisible(visible) {
  _stromnetzLayerVisible = !!visible;
  ensureLayers();
  applyLayerVisibility();
}

export function isStromnetzVisible() {
  return _stromnetzLayerVisible;
}

// ── Initial-Setup (nach map-Init, einmalig) ─────────────────────────────────
setTimeout(() => { ensureLayers(); }, 0);
