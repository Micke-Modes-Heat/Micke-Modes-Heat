// ── 13p-erzeuger-assets.js — Auto-Verknüpfung Wärmeerzeuger ↔ Elektroassets ──
// Wenn ein strombetriebener Wärmeerzeuger aktiviert (platziert) wird, entsteht
// automatisch ein passendes Elektroasset. Beim Löschen des Erzeugers wird es
// wieder entfernt. Werte (Leistung, JAZ, …) werden aus dem Erzeuger-Zustand
// übernommen. Das Property `linkedErzeuger` auf dem Asset verknüpft beide Seiten.

import { ASSETS, createAsset, deleteAsset } from './13a-assets-core.js';
import { redrawAllAssets, isAssetLayerVisible } from './13b-assets-render.js';
import { map } from './02b-gebaeude.js';

// Mapping erzeuger-key → Asset-Typ + Name
const ERZEUGER_ASSET_CFG = {
  lwwp:        { assetType: 'WP',          name: 'Luft-WP' },
  geo:         { assetType: 'Geo',         name: 'Geothermie-WP' },
  fg:          { assetType: 'FG',          name: 'Fließgew.-WP' },
  bhkw:        { assetType: 'KWK',         name: 'BHKW/KWK' },
  stromkessel: { assetType: 'Stromkessel', name: 'Stromkessel' },
};

// Gebäude-ID für das verknüpfte Asset ermitteln (Heizzentrale als Fallback)
function _buildingId() {
  const zentId = parseInt(document.getElementById('netz-zentrale')?.value);
  if (zentId && window.gebaeude?.find(x => x.id === zentId)) return zentId;
  return null;
}

// Koordinaten des Wärmeerzeugers ermitteln
function _coords(key) {
  if (key === 'lwwp' && window.lwWp?.lat != null)
    return { lat: window.lwWp.lat, lng: window.lwWp.lng };

  if (key === 'geo' && window.geoThermie?.lat != null)
    return { lat: window.geoThermie.lat, lng: window.geoThermie.lng };

  if (key === 'fg') {
    const pts = window.fliessgewaesser?.latlngs;
    if (pts?.length) {
      const mid = pts[Math.floor(pts.length / 2)];
      return { lat: mid.lat, lng: mid.lng };
    }
  }

  // Fallback: Heizzentrale (netz-zentrale)
  const zentId = parseInt(document.getElementById('netz-zentrale')?.value);
  if (zentId && window.gebaeude) {
    const g = window.gebaeude.find(x => x.id === zentId);
    if (g?.polygon?.length) {
      const lats = g.polygon.map(p => p.lat ?? p[0]);
      const lngs = g.polygon.map(p => p.lng ?? p[1]);
      return {
        lat: lats.reduce((a, b) => a + b) / lats.length,
        lng: lngs.reduce((a, b) => a + b) / lngs.length,
      };
    }
  }

  // Letzter Fallback: Kartenmitte
  if (map?.getCenter) {
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }
  return null;
}

// Props je Erzeuger-Typ berechnen
function _props(key) {
  switch (key) {
    case 'lwwp': {
      const pTh = window.lwWp?.leistungKw || parseFloat(document.getElementById('lwwp-leistung')?.value) || 12;
      // Dispatch schreibt berechnete JAZ zurück in lwwp-jaz → immer aktuellster Wert
      const jaz = parseFloat(document.getElementById('lwwp-jaz')?.value) || 3.0;
      return { leistungThKW: pTh, leistungElKW: Math.round(pTh / jaz), jaz };
    }
    case 'geo': {
      const pTh = window.geoThermie?.leistungKwEff
        || parseFloat(document.getElementById('geo-leistung-eff')?.value) || 100;
      // Dispatch schreibt berechnete JAZ zurück in geo-jaz → immer aktuellster Wert
      const jaz = parseFloat(document.getElementById('geo-jaz')?.value) || 4.5;
      return { leistungThKW: pTh, leistungElKW: Math.round(pTh / jaz), jaz };
    }
    case 'fg': {
      const pTh = window.fliessgewaesser?.leistungKw
        || parseFloat(document.getElementById('fg-leistung')?.value) || 100;
      const jaz = window.fliessgewaesser?.jaz
        || parseFloat(document.getElementById('fg-jaz')?.value) || 4.5;
      return { leistungThKW: pTh, leistungElKW: Math.round(pTh / jaz), jaz };
    }
    case 'bhkw': {
      const sigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      const pTh    = window.bhkw?.leistungThKw
        || parseFloat(document.getElementById('bhkw-leistung-th')?.value) || 100;
      const pEl    = Math.round(pTh * sigma);
      return {
        leistungElKW:   pEl,
        leistungThKW:   pTh,
        wirkungsgradEl: Math.round(sigma * 100),
        brennstoff:     'Erdgas',
      };
    }
    case 'stromkessel': {
      const pTh = window.stromkessel?.leistungKw
        || parseFloat(document.getElementById('sk-leistung')?.value) || 200;
      const eta = parseFloat(document.getElementById('sk-eta')?.value) || 99;
      return { leistungKW: Math.round(pTh * 100 / eta) };
    }
    default:
      return {};
  }
}

// Verknüpftes Asset suchen
function _findLinked(key) {
  return ASSETS.items.find(a => a.linkedErzeuger === key) || null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Erstellt oder aktualisiert das Elektroasset für einen strombetriebenen
 * Wärmeerzeuger. Aufzurufen nach jedem Aktivieren/Neu-Platzieren.
 */
export function syncErzeugerElektroAsset(key) {
  const cfg = ERZEUGER_ASSET_CFG[key];
  if (!cfg) return;

  const coords = _coords(key);
  if (!coords) return;

  const props = _props(key);

  const buildingId = _buildingId();
  const existing = _findLinked(key);
  if (existing) {
    // Position immer mitführen — Erzeuger ist die Positionsquelle
    existing.lat = coords.lat;
    existing.lng = coords.lng;
    if (existing._marker?.setLatLng) existing._marker.setLatLng([coords.lat, coords.lng]);
    if (!existing.buildingId && buildingId) existing.buildingId = buildingId;
    Object.assign(existing.props, props);
  } else {
    const asset = createAsset(cfg.assetType, coords.lat, coords.lng, {
      name: cfg.name,
      props,
      buildingId,
    });
    if (asset) asset.linkedErzeuger = key;
  }

  if (isAssetLayerVisible()) redrawAllAssets();
}

/**
 * Nur Props aktualisieren (kein Redraw). Für Update-Display-Funktionen,
 * damit bei jeder Parameteränderung die Werte frisch bleiben.
 */
export function updateErzeugerAssetProps(key) {
  const existing = _findLinked(key);
  if (!existing) return;
  Object.assign(existing.props, _props(key));
}

/**
 * Nur Position aktualisieren (kein Props-Rebuild, kein Redraw).
 * Aufzurufen aus Drag-End-Handlern der Wärmeerzeuger-Marker.
 */
export function moveErzeugerElektroAsset(key) {
  const a = _findLinked(key);
  if (!a) return;
  const coords = _coords(key);
  if (!coords) return;
  a.lat = coords.lat;
  a.lng = coords.lng;
  if (a._marker?.setLatLng) a._marker.setLatLng([coords.lat, coords.lng]);
}

/**
 * Entfernt das verknüpfte Elektroasset. Aufzurufen beim Löschen des Erzeugers.
 */
export function removeErzeugerElektroAsset(key) {
  const a = _findLinked(key);
  if (!a) return;
  deleteAsset(a.id);
  if (isAssetLayerVisible()) redrawAllAssets();
}
