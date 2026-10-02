// ── lib/osm-dach.js — OSM-Dachtags → Dachangaben des Tools ─────────────────
// Übersetzt die Simple-3D-Buildings-Tags eines OSM-Gebäudes in die Felder, mit
// denen PV-Platzierung, Ertrag und 3D-Ansicht rechnen:
//   roof:shape        → dachform  ('flach' | 'sattel' | 'walm' | 'pult')
//   roof:angle        → dachNeigung (Grad)
//   roof:direction    → dachAzimut  (Grad; Richtung, in die die Dachfläche
//                       abfällt — entspricht der Falllinie der Vorderseite)
//   roof:orientation  → quer (First quer statt längs zur Gebäudeachse)
// Formen ohne Gegenstück (Kuppel, Zwiebel, Kegel …) bleiben unbelegt — dann
// gelten weiter die Vorgaben des Tools.

/** roof:shape → Dachform des Tools (null = keine sinnvolle Entsprechung). */
export const OSM_DACHFORM = {
  flat: 'flach',
  gabled: 'sattel',
  saltbox: 'sattel',          // ungleich lange Satteldachseiten
  gambrel: 'sattel',          // Mansard-Satteldach (zweifach geknickt)
  round: 'sattel',            // Tonnendach ≈ Sattel mit gleicher Firstrichtung
  'double_saltbox': 'sattel',
  hipped: 'walm',
  'half-hipped': 'walm',
  half_hipped: 'walm',
  side_hipped: 'walm',
  mansard: 'walm',            // Mansard-Walmdach (an allen Seiten geknickt)
  pyramidal: 'walm',          // Zeltdach = Walm auf quadratischem Grundriss
  skillion: 'pult',
  lean_to: 'pult',
};

const HIMMELSRICHTUNG = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  // deutsche Kürzel kommen in OSM gelegentlich vor
  O: 90, NO: 45, SO: 135, NNO: 22.5, ONO: 67.5, OSO: 112.5, SSO: 157.5, WNO: 292.5,
};

/** roof:direction → Grad 0…359 oder null. Versteht Zahlen und Himmelsrichtungen. */
export function osmRichtung(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (HIMMELSRICHTUNG[s] != null) return Math.round(HIMMELSRICHTUNG[s]) % 360;
  const n = parseFloat(s.replace(',', '.'));
  if (!isFinite(n)) return null;
  return Math.round(((n % 360) + 360) % 360);
}

/** roof:angle → Grad (0 < x ≤ 75) oder null. */
export function osmNeigung(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(',', '.'));
  return isFinite(n) && n > 0 && n <= 75 ? Math.round(n * 10) / 10 : null;
}

/**
 * Dachangaben aus den Tags eines OSM-Gebäudes.
 * @param {Record<string,string>} tags
 * @returns {{dachform:string|null, neigung:number|null, azimut:number|null, quer:boolean}}
 */
export function osmDachAusTags(tags) {
  const t = tags || {};
  const shape = String(t['roof:shape'] || '').trim().toLowerCase();
  const dachform = OSM_DACHFORM[shape] || null;
  const quer = String(t['roof:orientation'] || '').trim().toLowerCase() === 'across';
  if (!dachform) return { dachform: null, neigung: null, azimut: null, quer: false };
  return {
    dachform,
    neigung: dachform === 'flach' ? null : osmNeigung(t['roof:angle']),
    azimut: dachform === 'flach' ? null : osmRichtung(t['roof:direction']),
    quer,
  };
}

/**
 * Azimut für einen QUER zur Längsachse laufenden First. `azLaengs` ist der
 * Azimut aus detectRoofAzimutFromPolygon (First entlang der längsten Kante);
 * quer dazu fallen die Dachflächen entlang der Längsachse ab, also ±90° —
 * genommen wird die Seite näher an Süd, wie bei der Längsermittlung.
 * @param {number|null} azLaengs
 */
export function osmQuerAzimut(azLaengs) {
  if (azLaengs == null || !isFinite(azLaengs)) return null;
  const a = ((azLaengs + 90) % 360 + 360) % 360, b = ((azLaengs - 90) % 360 + 360) % 360;
  const abw = x => Math.min(Math.abs(x - 180), 360 - Math.abs(x - 180));
  return Math.round(abw(a) <= abw(b) ? a : b);
}

/* ── Zuordnung OSM-Dach → vorhandene Gebäude (z. B. aus dem ALKIS-WFS) ──── */
// Die amtlichen WFS-Dienste liefern keine Dachform. Die Grundrisse sind aber
// meist dieselben Gebäude wie in OSM — zugeordnet wird, wenn der Schwerpunkt
// jedes Polygons im jeweils anderen liegt (beidseitig, damit ein großes OSM-
// Gebäude nicht die kleinen Nebengebäude daneben „einfängt").

function _punktImPolygon(p, poly) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat)
        && p.lng < (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng) innen = !innen;
  }
  return innen;
}

function _schwerpunkt(poly) {
  let lat = 0, lng = 0;
  for (const p of poly) { lat += p.lat; lng += p.lng; }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

/**
 * Overpass-Ergebnis (`out tags geom;`) → OSM-Gebäude mit Dachangabe.
 * @returns {{poly:{lat:number,lng:number}[], c:{lat:number,lng:number}, dach:ReturnType<typeof osmDachAusTags>}[]}
 */
export function osmDachGebaeude(data) {
  const out = [];
  for (const el of data?.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 4) continue;
    const dach = osmDachAusTags(el.tags);
    if (!dach.dachform) continue;
    const poly = el.geometry.map(p => ({ lat: p.lat, lng: p.lon }));
    const a = poly[0], z = poly[poly.length - 1];
    if (a.lat === z.lat && a.lng === z.lng) poly.pop();   // geschlossener Ring → Schwerpunkt ohne Doppelpunkt
    out.push({ poly, c: _schwerpunkt(poly), dach });
  }
  return out;
}

/**
 * Ordnet OSM-Dachangaben vorhandenen Gebäuden zu.
 * @param {{id:any, polygon:{lat:number,lng:number}[]}[]} gebaeude nur die Kandidaten
 * @param {ReturnType<typeof osmDachGebaeude>} osm
 * @returns {{id:any, dach:ReturnType<typeof osmDachAusTags>}[]}
 */
export function osmDachZuordnen(gebaeude, osm) {
  const treffer = [];
  for (const g of gebaeude || []) {
    if (!g || !Array.isArray(g.polygon) || g.polygon.length < 3) continue;
    const c = _schwerpunkt(g.polygon);
    const o = osm.find(x => _punktImPolygon(c, x.poly) && _punktImPolygon(x.c, g.polygon));
    if (o) treffer.push({ id: g.id, dach: o.dach });
  }
  return treffer;
}
