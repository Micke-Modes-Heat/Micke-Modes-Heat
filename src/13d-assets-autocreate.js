// ── 13d-assets-autocreate.js — Auto-Creation von Assets beim Gebäude-Zeichnen
// Beim Neuanlegen eines Gebäudes werden automatisch UV + Verbraucher + PV erzeugt.
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

const DEFAULT_TYPES = ['UV', 'Verbraucher', 'PV'];

export function autoCreateBuildingAssets(g, opts = {}) {
  if (!g || !g.polygon || g.polygon.length < 3) return [];

  // Keine Duplikate: wenn für dieses Gebäude bereits Assets existieren, nichts tun
  if (ASSETS.items.some(a => a.buildingId === g.id)) return [];

  const c = polygonCentroid(g.polygon);
  if (!c) return [];

  const base = {
    buildingId: g.id,
    baujahr:    g.baujahr    || null,
    abrissjahr: g.abrissjahr || null,
  };

  const created = [];
  for (const type of DEFAULT_TYPES) {
    const asset = createAsset(type, c.lat, c.lng, {
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
