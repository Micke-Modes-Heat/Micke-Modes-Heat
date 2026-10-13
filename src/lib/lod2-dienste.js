// @ts-check
// ── lib/lod2-dienste.js — LoD2 automatisch von den Landesdiensten holen ───────
//
// Drei Länder bieten ihre LoD2-Gebäudemodelle so an, dass der Browser sie für
// einen Kartenausschnitt direkt abrufen kann (geprüft 12.10.2026, alle mit CORS):
//   nw  OGC API Features ogc-api.nrw.de/3dg — CityGML 1.0, Koordinaten CRS84
//       (lon lat h), Folgeseiten über den Link-Header rel="next"
//   ni  STAC-Kachelsuche lod.stac.lgln.niedersachsen.de → 1-km-Kacheln als
//       CityGML (UTM 32) im Objektspeicher
//   bw  INSPIRE-WFS des LGL — CityGML 2.0, BBOX nur in EPSG:25832, Seiten über
//       STARTINDEX/COUNT
// Bayern (keine CORS-Freigabe), Hamburg (nur Gesamtdatensatz), Hessen/Saarland
// (INSPIRE-Schema ohne Dachflächen) u. a. bleiben beim Datei-Import (37).
//
// Rein, ohne fetch: nur Dienstwahl, Ausschnitte und Adressen — testbar.
// Der Abruf selbst liegt in 37-lod2-import.js.

import { wgs84NachUtm } from './lod2-citygml.js';

/** @typedef {{ id:'nw'|'ni'|'bw', name:string, quelle:string }} Lod2Dienst */

/** @type {Record<string, Lod2Dienst>} */
export const LOD2_DIENSTE = Object.freeze({
  nw: { id: 'nw', name: 'NRW', quelle: 'Geobasis NRW (OGC API, dl-de/zero-2-0)' },
  ni: { id: 'ni', name: 'Niedersachsen', quelle: 'LGLN OpenGeoData (STAC)' },
  bw: { id: 'bw', name: 'Baden-Württemberg', quelle: 'LGL BW (INSPIRE-WFS, dl-de/by-2-0)' },
});

/** Dienst für ein Bundesland oder null. */
export function lod2Dienst(bl) {
  return (bl && LOD2_DIENSTE[bl]) || null;
}

/** Seitengröße je Anfrage (NRW, BW). */
export const LOD2_SEITE = 2000;

/**
 * Ausschnitt [süd, west, nord, ost] in Teilstücke von höchstens kanteM Kantenlänge
 * — große Liegenschaften würden sonst als eine 100-MB-Antwort kommen.
 * @param {number[]} bbox
 * @param {number} [kanteM]
 * @returns {number[][]}
 */
export function lod2Teilstuecke(bbox, kanteM = 700) {
  const [s, w, n, e] = bbox;
  if (![s, w, n, e].every(Number.isFinite) || n <= s || e <= w) return [];
  const hoeheM = (n - s) * 111320;
  const breiteM = (e - w) * 111320 * Math.cos((s + n) / 2 * Math.PI / 180);
  const ny = Math.max(1, Math.ceil(hoeheM / kanteM)), nx = Math.max(1, Math.ceil(breiteM / kanteM));
  const out = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      out.push([s + (n - s) * iy / ny, w + (e - w) * ix / nx, s + (n - s) * (iy + 1) / ny, w + (e - w) * (ix + 1) / nx]);
    }
  }
  return out;
}

/**
 * Ausschnitt um Gebäudegrundrisse (± randM).
 * @param {Array<{polygon:{lat:number,lng:number}[]}>} gebs
 * @returns {number[]|null} [süd, west, nord, ost]
 */
export function lod2Ausschnitt(gebs, randM = 20) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const g of gebs || []) for (const p of g.polygon || []) {
    if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng;
  }
  if (n < s) return null;
  const dLat = randM / 111320, dLng = randM / (111320 * Math.cos((s + n) / 2 * Math.PI / 180));
  return [s - dLat, w - dLng, n + dLat, e + dLng];
}

const _f = v => v.toFixed(6);

/** NRW: erste Seite für ein Teilstück (Folgeseiten aus dem Link-Header). */
export function lod2NrwUrl(t) {
  return `https://ogc-api.nrw.de/3dg/v1/collections/building/items?f=citygml&limit=${LOD2_SEITE}`
    + `&bbox=${_f(t[1])},${_f(t[0])},${_f(t[3])},${_f(t[2])}`;
}

/** Link-Header → URL mit rel="next" oder null. */
export function lod2NaechsteSeite(linkHeader) {
  for (const teil of String(linkHeader || '').split(/,(?=\s*<)/)) {
    const m = teil.match(/<([^>]+)>\s*;(.*)$/);
    if (m && /rel\s*=\s*"?next"?/i.test(m[2])) return m[1];
  }
  return null;
}

/** Niedersachsen: STAC-Suche nach den Kacheln, die den Ausschnitt berühren. */
export function lod2NiSucheUrl(bbox) {
  return `https://lod.stac.lgln.niedersachsen.de/search?collections=lod2&limit=200`
    + `&bbox=${_f(bbox[1])},${_f(bbox[0])},${_f(bbox[3])},${_f(bbox[2])}`;
}

/**
 * Niedersachsen: Kachel-Adressen (CityGML) aus der STAC-Antwort.
 * @param {any} stac
 * @returns {{id:string, url:string}[]}
 */
export function lod2NiKacheln(stac) {
  const out = [];
  for (const f of stac?.features || []) {
    const a = f.assets?.['lod2-gml'] || Object.values(f.assets || {}).find(x => /gml|xml/i.test(x?.type || '') || /\.gml$/i.test(x?.href || ''));
    if (a?.href) out.push({ id: String(f.id || a.href), url: a.href });
  }
  return out;
}

/** BW: eine Seite des WFS für ein Teilstück (BBOX in UTM 32). */
export function lod2BwUrl(t, start = 0) {
  const a = wgs84NachUtm(t[0], t[1], 32), b = wgs84NachUtm(t[2], t[3], 32);
  const c = wgs84NachUtm(t[0], t[3], 32), d = wgs84NachUtm(t[2], t[1], 32);
  const E0 = Math.floor(Math.min(a.E, d.E)), E1 = Math.ceil(Math.max(b.E, c.E));
  const N0 = Math.floor(Math.min(a.N, c.N)), N1 = Math.ceil(Math.max(b.N, d.N));
  return 'https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Gebauede_3D_LoD2?SERVICE=WFS&VERSION=2.0.0'
    + `&REQUEST=GetFeature&TYPENAMES=bldg:Building&COUNT=${LOD2_SEITE}&STARTINDEX=${start}`
    + `&BBOX=${E0},${N0},${E1},${N1},urn:ogc:def:crs:EPSG::25832`;
}

/** WFS-Antwort: { zurueck, gesamt } aus numberReturned/numberMatched. */
export function lod2WfsZahlen(text) {
  const kopf = String(text || '').slice(0, 4000);
  const r = kopf.match(/numberReturned\s*=\s*"(\d+)"/), m = kopf.match(/numberMatched\s*=\s*"(\d+|unknown)"/);
  return { zurueck: r ? +r[1] : null, gesamt: m && m[1] !== 'unknown' ? +m[1] : null };
}
