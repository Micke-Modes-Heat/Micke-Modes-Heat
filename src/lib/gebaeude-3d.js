// ── lib/gebaeude-3d.js — Gebäude → GeoJSON für die 3D-Ansicht ───────────────
// Reiner Datenteil von 32-3d-ansicht.js, ohne DOM und ohne MapLibre.
//
// Die 3D-Ansicht rechnet keine eigene Einfärbung: sie übernimmt die Farbe, die
// das Gebäude-Polygon auf der Leaflet-Arbeitskarte gerade hat. Damit gilt jeder
// Farbmodus der Karte (Wärme, Heizlast, Engpassjahr, PV-Modus, Blackout …)
// automatisch auch in 3D, ohne dass dessen Logik hier dupliziert wird.

/** Geschosshöhe für die Extrusion (m) — wie bei der Ableitung Höhe → Geschosse im OSM-Import. */
export const D3D_GESCHOSSHOEHE = 3;

/** Farbe für Gebäude ohne Kennwert (auf der Karte fast transparent). */
export const D3D_NEUTRAL = '#9aa3ad';

/** Füllfarbe, die auf der Karte für „kein Wert" steht, liegt unter dieser Deckkraft. */
const OHNE_WERT_DECKKRAFT = 0.15;

/**
 * CSS-Farbe ohne Alphakanal. `fill-extrusion-color` wertet Alpha nicht je
 * Gebäude aus — `rgba(79,195,247,0.08)` würde sonst als kräftiges Blau
 * erscheinen. Unbekannte Formate (Farbnamen) gehen unverändert durch.
 * @param {string} farbe
 * @returns {string}
 */
export function d3dDeckend(farbe) {
  const s = String(farbe || '').trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) return `rgb(${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])})`;
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7);
  if (/^#[0-9a-f]{4}$/i.test(s)) return s.slice(0, 4);
  return s || D3D_NEUTRAL;
}

/**
 * Ringe eines Gebäudes als GeoJSON-Koordinaten ([lng, lat], geschlossen).
 * `g.polygon` ist eine Leaflet-Liste [lat, lng] — einfach oder mit Löchern
 * (Liste von Ringen).
 * @param {any} polygon
 * @returns {number[][][] | null}
 */
export function d3dRinge(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return null;
  const istPunkt = p => Array.isArray(p) ? typeof p[0] === 'number' : (p && typeof p.lat === 'number');
  const ringe = istPunkt(polygon[0]) ? [polygon] : polygon;
  const out = [];
  for (const ring of ringe) {
    if (!Array.isArray(ring)) continue;
    const pts = ring
      .map(p => Array.isArray(p) ? [+p[1], +p[0]] : [+p.lng, +p.lat])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 3) continue;
    const a = pts[0], z = pts[pts.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) pts.push([a[0], a[1]]);
    out.push(pts);
  }
  return out.length ? out : null;
}

/** Farbklassen nach Baujahr (gleiche Grenzen wie die Gebäudetypologie). */
export const D3D_BAUJAHR_KLASSEN = [
  { bis: 1918, farbe: '#7b3294', label: 'vor 1919' },
  { bis: 1948, farbe: '#c2a5cf', label: '1919–1948' },
  { bis: 1977, farbe: '#f7d8a8', label: '1949–1977' },
  { bis: 1994, farbe: '#e08214', label: '1978–1994' },
  { bis: 2009, farbe: '#5aae61', label: '1995–2009' },
  { bis: Infinity, farbe: '#1b7837', label: 'ab 2010' },
];

/** @param {any} baujahr @returns {string} */
export function d3dBaujahrFarbe(baujahr) {
  const j = parseInt(baujahr, 10);
  if (!Number.isFinite(j) || j < 1000) return D3D_NEUTRAL;
  return (D3D_BAUJAHR_KLASSEN.find(k => j <= k.bis) || D3D_BAUJAHR_KLASSEN[D3D_BAUJAHR_KLASSEN.length - 1]).farbe;
}

/**
 * Gebäudeliste → FeatureCollection für den Extrusions-Layer.
 *
 * `art` je Gebäude:
 *   • 'auswahl' — im Eigenschaften-Panel gewählt
 *   • 'geist'   — im gewählten Jahr geplant/abgerissen oder aus der Berechnung
 *                 ausgeschlossen (wird halbtransparent gezeichnet)
 *   • 'aktiv'   — alles andere
 *
 * @param {any[]} gebaeude
 * @param {{ status?: (g:any)=>string, ausgeschlossen?: (id:any)=>boolean,
 *           ausgewaehltId?: any, geschosshoehe?: number }} [opt]
 */
export function d3dFeatures(gebaeude, opt = {}) {
  const gh = opt.geschosshoehe > 0 ? opt.geschosshoehe : D3D_GESCHOSSHOEHE;
  const features = [];
  for (const g of gebaeude || []) {
    if (!g) continue;
    const ringe = d3dRinge(g.polygon);
    if (!ringe) continue;
    const geschosse = Math.max(1, Math.min(60, parseInt(g.stockwerke, 10) || 1));

    let status = '';
    try { status = opt.status ? String(opt.status(g) || '') : ''; } catch (e) { void e; }
    let raus = false;
    try { raus = !!(opt.ausgeschlossen && opt.ausgeschlossen(g.id)); } catch (e) { void e; }

    const stil = g.polygonLayer && g.polygonLayer.options ? g.polygonLayer.options : null;
    const ohneWert = !stil || !(Number(stil.fillOpacity) >= OHNE_WERT_DECKKRAFT);
    const farbe = ohneWert ? D3D_NEUTRAL : d3dDeckend(stil.fillColor);

    const art = g.id === opt.ausgewaehltId ? 'auswahl'
      : (raus || status === 'geplant' || status === 'abgerissen') ? 'geist' : 'aktiv';

    features.push({
      type: 'Feature',
      id: typeof g.id === 'number' ? g.id : undefined,
      properties: {
        gid: g.id,
        name: String(g.name || `Gebäude ${g.id}`),
        geschosse,
        hoehe: geschosse * gh,
        baujahr: parseInt(g.baujahr, 10) || null,
        nutzung: String(g.nutzung || ''),
        status: raus ? 'ausgeschlossen' : status,
        art,
        farbe,
        farbeBaujahr: d3dBaujahrFarbe(g.baujahr),
      },
      geometry: { type: 'Polygon', coordinates: ringe },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Mittelpunkt + Ausdehnung aller Gebäude (für „Auf Gebäude zoomen").
 * @param {{features: any[]}} fc
 * @returns {[[number, number], [number, number]] | null} [[west, süd], [ost, nord]]
 */
export function d3dGrenzen(fc) {
  let w = Infinity, s = Infinity, o = -Infinity, n = -Infinity;
  for (const f of fc?.features || []) {
    for (const ring of f.geometry?.coordinates || []) {
      for (const [x, y] of ring) {
        if (x < w) w = x; if (x > o) o = x;
        if (y < s) s = y; if (y > n) n = y;
      }
    }
  }
  return Number.isFinite(w) ? [[w, s], [o, n]] : null;
}

/**
 * Leaflet-Zoom (256-px-Kacheln) ↔ MapLibre-Zoom (512-px-Kacheln): gleicher
 * Maßstab heißt eine Stufe Unterschied.
 */
export const d3dZoomAusLeaflet = z => Math.max(0, (Number(z) || 0) - 1);
export const d3dZoomNachLeaflet = z => (Number(z) || 0) + 1;

/**
 * Drehung der Arbeitskarte (leaflet-rotate, Grad im Uhrzeigersinn) → MapLibre-
 * `bearing` (Blickrichtung, im Uhrzeigersinn von Nord). Dreht die Karte nach
 * rechts, schaut die Kamera nach links — daher das Vorzeichen.
 */
export const d3dBearingAusKartendrehung = w => {
  const b = -(Number(w) || 0);
  return b === 0 ? 0 : b;   // kein -0
};

/**
 * Leaflet-Kachel-URL → Liste für eine MapLibre-Rasterquelle ({s} aufgelöst).
 * @param {string} url
 * @param {string|string[]} [subdomains]
 */
export function d3dKachelUrls(url, subdomains) {
  const u = String(url || '');
  if (!u.includes('{s}')) return [u];
  const subs = Array.isArray(subdomains) ? subdomains : String(subdomains || 'abc').split('');
  return subs.map(s => u.replace('{s}', s));
}
