// ── 13d-assets-autocreate.js — Auto-Creation von Assets beim Gebäude-Zeichnen
// Beim Neuanlegen eines Gebäudes werden automatisch UV + Verbraucher erzeugt.
// Alle sitzen am Polygon-Schwerpunkt und werden als Gruppen-Marker dargestellt
// (siehe 13b-assets-render.js).

import { ASSETS, createAsset } from './13a-assets-core.js';
import { redrawAllAssets, isAssetLayerVisible } from './13b-assets-render.js';

function polygonCentroid(polygon) {
  if (!polygon || polygon.length < 1) return null;
  let lat = 0, lng = 0, n = 0;
  for (const p of polygon) {
    lat += (p.lat ?? p[0]);
    lng += (p.lng ?? p[1]);
    n++;
  }
  return n > 0 ? { lat: lat / n, lng: lng / n } : null;
}

// Gleichmäßig verteilte Positionen innerhalb des Gebäudepolygons
// Ausrichtung entlang der längeren Achse, 65 % der Ausdehnung genutzt.
function _positionsInBuilding(polygon, count) {
  const c = polygonCentroid(polygon);
  if (!c || count <= 1) return Array(count).fill(c || { lat: 0, lng: 0 });

  const lats = polygon.map(p => p.lat ?? p[0]);
  const lngs = polygon.map(p => p.lng ?? p[1]);
  const heightM = (Math.max(...lats) - Math.min(...lats)) * 111320;
  const cosLat  = Math.cos(c.lat * Math.PI / 180);
  const widthM  = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * cosLat;

  const useNS   = heightM >= widthM;
  const span    = Math.max(heightM, widthM) * 0.65;
  const spacing = span / (count - 1);

  const dLatPerM = 1 / 111320;
  const dLngPerM = 1 / (111320 * cosLat);

  return Array.from({ length: count }, (_, i) => {
    const offsetM = (i - (count - 1) / 2) * spacing;
    return {
      lat: c.lat + (useNS ? offsetM * dLatPerM : 0),
      lng: c.lng + (useNS ? 0 : offsetM * dLngPerM),
    };
  });
}

const DEFAULT_TYPES = ['UV', 'Verbraucher'];

export function autoCreateBuildingAssets(g, opts = {}) {
  if (!g || !g.polygon || g.polygon.length < 3) return [];

  // Keine Duplikate: wenn für dieses Gebäude bereits Assets existieren, nichts tun
  if (ASSETS.items.some(a => a.buildingId === g.id)) return [];

  const positions = _positionsInBuilding(g.polygon, DEFAULT_TYPES.length);
  const base = {
    buildingId: g.id,
    baujahr:    g.baujahr    || null,
    abrissjahr: g.abrissjahr || null,
  };

  const created = [];
  for (let i = 0; i < DEFAULT_TYPES.length; i++) {
    const type = DEFAULT_TYPES[i];
    const pos  = positions[i];
    const asset = createAsset(type, pos.lat, pos.lng, {
      ...base,
      name: `${type} ${g.name || g.id}`,
    });
    if (asset) created.push(asset);
  }
  // Marker nur zeichnen wenn Layer sichtbar — sonst erscheinen sie beim Tab-Wechsel
  if (created.length > 0 && isAssetLayerVisible()) redrawAllAssets();
  return created;
}

// No-Op — Positionen kommen jetzt aus dem Polygon-Schwerpunkt,
// das berechnet der Renderer beim Zeichnen selbst.
export function reflowAutoAssets() {}
