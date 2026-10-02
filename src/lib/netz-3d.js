// ── lib/netz-3d.js — Wärme- und Stromnetz für die 3D-Ansicht ───────────────
// Reiner Datenteil von 32-3d-ansicht.js (ohne DOM/MapLibre). Wie bei den
// Gebäuden rechnet die 3D-Ansicht keine eigene Einfärbung: Linienzug, Farbe und
// Strichstärke kommen aus den Leaflet-Polylinien der Arbeitskarte, damit jeder
// Netz-Farbmodus (DN, Auslastung, Engpassjahr …) auch in 3D gilt. Eine auf der
// Karte ausgeblendete Leitung (Ebene „Leitungen"/„Stromnetz" aus) fehlt auch hier.

import { d3dDeckend } from './gebaeude-3d.js';

/** Linienzug einer Leaflet-Polylinie als [lng, lat]-Liste (auch verschachtelt). */
function linienzug(layer) {
  let lls;
  try { lls = layer.getLatLngs(); } catch (e) { return null; }
  const flach = [];
  const sammeln = arr => {
    for (const p of arr || []) {
      if (Array.isArray(p)) sammeln(p);
      else if (p && isFinite(p.lat) && isFinite(p.lng)) flach.push([+p.lng, +p.lat]);
    }
  };
  sammeln(lls);
  // Stationsinterne Verbindungen (Trafo↔NSHV im selben Gebäude) haben Länge 0
  const [x0, y0] = flach[0] || [];
  if (flach.length < 2 || flach.every(([x, y]) => x === x0 && y === y0)) return null;
  return flach;
}

function sichtbareFarbe(layer) {
  const o = layer && layer.options;
  if (!o || !o.color || o.color === 'transparent' || o.opacity === 0) return null;
  return d3dDeckend(o.color);
}

/**
 * Leitungen beider Netze als LineStrings.
 * @param {any[]} netzEdges   Wärmenetz-Kanten ({layer, segLayers?, dn, length, load})
 * @param {any[]} stromEdges  Kabel ({layer, cableType, crossSection, nParallel, auslastungPct, lengthM})
 * @param {(layer:any)=>boolean} sichtbar  liegt die Polylinie gerade auf der Karte?
 * @param {{waerme?:boolean, strom?:boolean}} [an]
 */
export function d3dNetzLinien(netzEdges, stromEdges, sichtbar, an = {}) {
  const features = [];
  const linie = (layer, props) => {
    if (!layer || !sichtbar(layer)) return;
    const farbe = sichtbareFarbe(layer);
    const coords = linienzug(layer);
    if (!farbe || !coords) return;
    features.push({
      type: 'Feature',
      properties: { ...props, farbe, breite: Math.max(1, Math.min(12, +layer.options.weight || 3)) },
      geometry: { type: 'LineString', coordinates: coords },
    });
  };
  if (an.waerme !== false) {
    for (const e of netzEdges || []) {
      if (!e) continue;
      const info = `Wärmeleitung${e.dn ? ` DN ${e.dn}` : ''}${e.length ? ` · ${Math.round(e.length)} m` : ''}`
        + (e.load ? ` · ${Math.round(e.load)} kW` : '');
      // Farbverlauf: die Kante ist dann in Teilstücke mit eigener Farbe zerlegt
      const segs = (e.segLayers || []).filter(s => s && sichtbar(s));
      if (segs.length) segs.forEach(s => linie(s, { art: 'waerme', info }));
      else linie(e.layer, { art: 'waerme', info });
    }
  }
  if (an.strom !== false) {
    for (const e of stromEdges || []) {
      if (!e) continue;
      const qs = e.crossSection ? ` ${e.nParallel > 1 ? e.nParallel + '× ' : ''}${e.crossSection} mm²` : '';
      const info = `Kabel ${e.cableType || ''}${qs}`.trim()
        + (e.lengthM ? ` · ${Math.round(e.lengthM)} m` : '')
        + (isFinite(e.auslastungPct) && e.auslastungPct > 0 ? ` · ${Math.round(e.auslastungPct)} % Auslastung` : '');
      linie(e.layer, { art: 'strom', info });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Stationstypen, die als eigener Baukörper erscheinen (wenn freistehend). */
export const D3D_STATIONEN = {
  NAP:          { farbe: '#ab47bc', b: 2.0, t: 2.0, h: 1.6, label: 'Netzanschlusspunkt' },
  Schaltanlage: { farbe: '#7e57c2', b: 3.0, t: 2.5, h: 2.6, label: 'Schaltanlage' },
  Trafo:        { farbe: '#29b6f6', b: 3.2, t: 2.6, h: 2.6, label: 'Trafostation' },
  Batterie:     { farbe: '#66bb6a', b: 6.0, t: 2.5, h: 2.6, label: 'Batteriespeicher' },
};

/**
 * Freistehende Stationen (ohne Gebäudezuordnung) als kleine Quader-Grundrisse.
 * Assets in einem Gebäude liegen ohnehin in dessen Körper.
 * @param {any[]} assets ASSETS.items
 */
export function d3dStationen(assets) {
  const features = [];
  for (const a of assets || []) {
    const typ = D3D_STATIONEN[a?.type];
    if (!typ || a.buildingId || !isFinite(a.lat) || !isFinite(a.lng)) continue;
    const dLat = typ.t / 2 / 111320;
    const dLng = typ.b / 2 / (111320 * Math.cos(a.lat * Math.PI / 180));
    const ring = [[a.lng - dLng, a.lat - dLat], [a.lng + dLng, a.lat - dLat],
                  [a.lng + dLng, a.lat + dLat], [a.lng - dLng, a.lat + dLat], [a.lng - dLng, a.lat - dLat]];
    features.push({
      type: 'Feature',
      properties: { typ: a.type, farbe: typ.farbe, hoehe: typ.h, info: `${typ.label}${a.name ? ' · ' + a.name : ''}` },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}
