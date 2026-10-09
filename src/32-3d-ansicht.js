// ── 32-3d-ansicht.js — 3D-Ansicht der Gebäude (MapLibre GL) ─────────────────
// Eigene WebGL-Karte, die beim Öffnen deckungsgleich über die Leaflet-
// Arbeitskarte gelegt wird. Reine ANSICHT: bearbeitet wird weiter auf der
// Arbeitskarte; ein Klick auf ein Gebäude wählt es dort aus (Eigenschaften
// rechts), Änderungen kommen über den Haken am Ende von updateViz()
// (02c-karte-werkzeuge.js → window.d3dNachViz) sofort hier an.
//
// Höhe = Geschosse × 3 m. Farbe = aktuelle Polygonfarbe der Arbeitskarte, also
// derselbe Farbmodus wie dort (s. lib/gebaeude-3d.js).
//
// MapLibre (~1 MB) wird erst beim ersten Öffnen geladen: im Einzeldatei-Build
// liegt der Code als Text in window.__MAPLIBRE_JS__ (build-singlefile.mjs) und
// wird über eine Blob-URL ausgeführt — offline-fähig, ohne CDN. Im Vite-
// Entwicklungsmodus fehlt der Text, dann kommt dieselbe Version von unpkg.
//
// Bewusst OHNE Imports aus dem App-Kern (Blatt im Importgraph, vgl.
// tests/import-architecture.test.js) — alles Weitere über window.* zur Laufzeit.

import {
  d3dFeatures, d3dGrenzen, d3dZoomAusLeaflet, d3dZoomNachLeaflet,
  d3dBearingAusKartendrehung, d3dKachelUrls, D3D_BAUJAHR_KLASSEN, D3D_NEUTRAL,
} from './lib/gebaeude-3d.js';
import {
  d3dRahmen, d3dDachEbenen, d3dDachDreiecke, d3dModule, d3dSchattierung,
  d3dEbeneAusPunkten, d3dPolygon3dDreiecke, d3dDachHoehe,
} from './lib/dach-3d.js';
import { d3dNetzLinien, d3dStationen, D3D_STATIONEN } from './lib/netz-3d.js';
import { firstPeilungGrad } from './lib/gebaeude-geometrie.js';
import { baumOverpassLaden, baeumeAusOverpass, baumDreiecke, BAUM_FARBEN } from './lib/baeume-3d.js';
import { dachAusGrundrissGebaeude } from './lib/dach-grundriss.js';

const D3D_MAPLIBRE_VERSION = '5.24.0';   // nur für den CDN-Fallback im Dev-Modus
const D3D_NEIGUNG = 55;
const D3D_AUSWAHL = '#ff1493';           // wie die Auswahl auf der Arbeitskarte
const D3D_DACHFARBE = '#a4553f';         // Ziegel — hebt die PV-Module ab
const D3D_MODULFARBE = '#1f2d78';        // wie das Modulraster der Arbeitskarte
const D3D_GLAS = 0.35;                   // Deckkraft bei „Gebäude durchsichtig"
const D3D_DACH_MAX_HINDERNIS = 8;        // m Dachhöhe ohne LoD2 und ohne Flügel-Modell (schräger Grundriss)
// Module nach Verschattung (Jahresfaktor, 40-baeume.js)
const D3D_SCHATTEN = [
  { ab: 0.95, farbe: '#43a047', label: 'Verschattung unter 5 %' },
  { ab: 0.85, farbe: '#fdd835', label: '5–15 %' },
  { ab: 0.70, farbe: '#fb8c00', label: '15–30 %' },
  { ab: -1, farbe: '#e53935', label: 'über 30 %' },
];

/** @type {null | {el:HTMLElement, ml:any, ro:ResizeObserver|null, modus:string, faktor:number,
 *   sat:boolean, hoverId:any, popup:any, raf:number, daecher:string, module:boolean,
 *   schicht:any, stat:{daecher:number, module:number}}} */
let _d3d = null;
let _ladenPromise = null;
// Bäume: Schalter und Overpass-Antwort überleben das Schließen der Ansicht (Sitzung)
let _baumAn = false;
let _baumCache = null;   // {sig, data}

/* ── MapLibre nachladen ───────────────────────────────────────────────────── */

function d3dLadeMaplibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (_ladenPromise) return _ladenPromise;
  _ladenPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('d3d-maplibre-css')) {
      let css;
      if (typeof window.__MAPLIBRE_CSS__ === 'string') {
        css = document.createElement('style');
        css.textContent = window.__MAPLIBRE_CSS__;
      } else {
        css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = `https://unpkg.com/maplibre-gl@${D3D_MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
      }
      css.id = 'd3d-maplibre-css';
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    let blobUrl = null;
    if (typeof window.__MAPLIBRE_JS__ === 'string') {
      blobUrl = URL.createObjectURL(new Blob([window.__MAPLIBRE_JS__], { type: 'text/javascript' }));
      s.src = blobUrl;
    } else {
      s.src = `https://unpkg.com/maplibre-gl@${D3D_MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
    }
    s.onload = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (window.maplibregl) resolve(window.maplibregl);
      else { _ladenPromise = null; reject(new Error('MapLibre wurde geladen, ist aber nicht verfügbar.')); }
    };
    s.onerror = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      _ladenPromise = null;
      reject(new Error('MapLibre konnte nicht geladen werden (offline?).'));
    };
    document.head.appendChild(s);
  });
  return _ladenPromise;
}

/* ── Daten ────────────────────────────────────────────────────────────────── */

function d3dDaten() {
  const jahr = window.globalYear;
  return d3dFeatures(window.gebaeude || [], {
    status: g => (typeof window.getComputedStats === 'function' ? window.getComputedStats(g, jahr)?.status : ''),
    ausgeschlossen: id => (typeof window.isExcluded === 'function' ? window.isExcluded(id) : false),
    ausgewaehltId: window.selectedId,
  });
}

function d3dFarbe(modus) {
  const basis = modus === 'baujahr' ? ['get', 'farbeBaujahr']
    : modus === 'einheitlich' ? '#c9cdd3'
    : ['get', 'farbe'];
  return ['case',
    ['==', ['get', 'art'], 'auswahl'], D3D_AUSWAHL,
    ['boolean', ['feature-state', 'hover'], false], '#ffffff',
    basis];
}

/** Daten + Farben neu setzen (gebündelt auf den nächsten Frame). */
function d3dAktualisieren() {
  if (!_d3d || !_d3d.ml || _d3d.raf) return;
  _d3d.raf = requestAnimationFrame(() => {
    if (!_d3d) return;
    _d3d.raf = 0;
    const daten = d3dDaten();
    const src = _d3d.ml.getSource('d3d-geb');
    if (src) src.setData(daten);
    d3dSzeneSetzen(daten);
    d3dLegende();
  });
}

/* ── Dächer & PV-Module (eigene WebGL-Ebene) ──────────────────────────────── */
// MapLibre extrudiert nur Körper mit flacher Oberseite. Die Wände kommen daher
// weiter aus dem fill-extrusion-Layer (bis zur Traufe, mit Hover/Klick), Dach-
// flächen, Giebelwände und Module zeichnet eine eigene Custom-Layer-Ebene, die
// sich den Tiefenpuffer mit den Wänden teilt. Geometrie: lib/dach-3d.js.

/**
 * Hat das Gebäude echte Dachangaben? Neue Gebäude stehen pauschal auf
 * 'sattel'/35° — ohne diese Unterscheidung bekäme jede OSM-Halle ein riesiges
 * Satteldach. Als Angabe zählt alles, was jemand am Dach eingestellt hat.
 */
function d3dHatDachangabe(g) {
  return !!((g.pvFlaechen || []).some(f => f.typ === 'belegung')
    || g.dachQuelle                       // 'osm' (roof:shape) oder 'manuell'
    || g.dachNeigung != null
    || (g.dachform && g.dachform !== 'sattel')
    || g._pvDachformManuell
    || (g.dachAzimut != null && !g.dachAutoAzimut)
    || g.pvRidgeOverride
    || g.dachFlaechen?.length);
}

/**
 * Azimut für die Dachform (ring = Außenring [lng,lat]). Ohne PV-Belegung ist er reine Darstellung: fehlt er
 * oder wurde er früher automatisch (längste Einzelkante) ermittelt, kommt er
 * frisch aus der Längsachse des Grundrisses — sonst liefe der First bei schräg
 * stehenden Gebäuden mit der Vorgabe 180° quer von Ecke zu Ecke. Mit Belegung
 * gilt der gespeicherte Wert, weil die Module (03c) damit platziert sind.
 */
function d3dAzimut(g, ring) {
  const belegt = (g.pvFlaechen || []).some(f => f.typ === 'belegung');
  if (belegt || (g.dachAzimut != null && (!g.dachAutoAzimut || g.dachQuelle))) return g.dachAzimut;
  const first = firstPeilungGrad(ring.map(([lng, lat]) => ({ lat, lng })));
  if (first == null) return g.dachAzimut;
  // Dachfläche senkrecht zum First, die Seite näher an Süd (wie detectRoofAzimutFromPolygon)
  const a = (first + 90) % 360, b = (first + 270) % 360;
  return Math.abs(a - 180) <= Math.abs(b - 180) ? a : b;
}

function _imRing(x, y, ring) {
  let innen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) innen = !innen;
  }
  return innen;
}

/**
 * LoD2-Dach (37-lod2-import): echte Dachflächen und Giebelwände als Dreiecke,
 * dazu die Ebene je Dachfläche für die Modulhöhe. Punkte [lat,lng,h] → lokal.
 */
function d3dLod2Geometrie(g, rahmen, traufe) {
  // Aus dem Grundriss berechnete Dächer sitzen auf der aktuellen Wandhöhe
  // (Geschosse × 3 m) — die kann sich seit der Berechnung geändert haben
  const dz = g.dachLod2?.quelle === 'grundriss' ? traufe - (g.dachLod2.traufeM || traufe) : 0;
  const lok = q => { const [x, y] = rahmen.nachXY(q[1], q[0]); return [x, y, q[2] + dz]; };
  const dach = [], wand = [], ebenen = [];
  for (const f of g.dachFlaechen || []) {
    if (!Array.isArray(f.punkte) || f.punkte.length < 3) continue;
    const pts = f.punkte.map(lok);
    dach.push(...d3dPolygon3dDreiecke(pts));
    const e = d3dEbeneAusPunkten(pts);
    if (e) ebenen.push({ ...e, ring: pts, schraeg: !(f.neigung < 10) });
  }
  for (const w of g.dachLod2?.waende || []) if (w.length >= 3) wand.push(...d3dPolygon3dDreiecke(w.map(lok)));
  const ebeneBei = (x, y) => {
    let best = null, bestZ = -Infinity;
    for (const e of ebenen) {
      if (!_imRing(x, y, e.ring)) continue;
      const z = e.a * x + e.b * y + e.c;
      if (z > bestZ) { bestZ = z; best = e; }
    }
    return best;
  };
  return { dach, wand, ebeneBei };
}

/* ── Flügel-Modell für Gebäude ohne Dachflächen ───────────────────────────────
 * Ohne LoD2/berechnete Dachflächen legt das Ebenenmodell EIN Satteldach über den
 * ganzen Grundriss — bei verwinkelten Gebäuden (L, U, Kamm) ein Riesendach. Für
 * Darstellung und Verschattung nimmt die Ansicht dann das Flügel-Modell
 * (lib/dach-grundriss), ohne die Gebäudedaten zu ändern. Zwischengespeichert je
 * Grundriss und Dachangaben. */
const _fluegelCache = new Map();

/** Gebäude mit Flügel-Dachflächen (Kopie) oder null (flach, schon Dachflächen, schräger Grundriss). */
export function d3dFluegelGebaeude(g) {
  if (!g || g.dachFlaechen?.length || !['sattel', 'walm'].includes(g.dachform || 'sattel')) return null;
  const p = g.polygon;
  if (!Array.isArray(p) || p.length < 4 || typeof p[0]?.lat !== 'number') return null;
  const sig = [p.length, p[0].lat, p[0].lng, p[p.length >> 1].lat, p[p.length >> 1].lng, g.dachform, g.dachNeigung,
    g.dachAutoAzimut ? '' : g.dachAzimut, g.stockwerke].join('|');
  let d = _fluegelCache.get(sig);
  if (d === undefined) {
    try { d = dachAusGrundrissGebaeude(g); } catch (e) { d = null; }
    // Ein einzelner Flügel ist das bisherige Satteldach — dafür kein Umweg
    if (d && d.fluegel < 2) d = null;
    if (_fluegelCache.size > 2000) _fluegelCache.clear();
    _fluegelCache.set(sig, d);
  }
  return d ? { ...g, dachFlaechen: d.dachFlaechen, dachLod2: d.lod2 } : null;
}

/**
 * Gebäude als 3D-Modell für Rechnungen außerhalb der Ansicht (Verschattung,
 * 40-baeume.js) — dieselbe Geometrie, die die Ansicht zeichnet: Wand bis zur
 * Traufe, Dach aus den PV-Angaben (ohne Angabe flach, wie „Dächer mit Angaben
 * formen"), Module auf der Dachhaut bzw. aufgeständert.
 * @param {any} g
 * @param {number[]} [modulIdx] Indizes in getGebPvModules(g).modules, deren Lage gebraucht wird
 * @returns {null | {ring:number[][], traufe:number, first:number, hoehe:number,
 *   module:{idx:number, ecken:number[][]}[]}}  ring/ecken in [lng, lat(, z)];
 *   hoehe = wirksame Höhe als Hindernis (Traufe + halbe Dachhöhe)
 */
export function d3dGebaeudeModell(g, modulIdx = []) {
  const f = d3dFeatures([g]).features[0];
  if (!f) return null;
  const ringe = f.geometry.coordinates;
  const ring = ringe[0].slice(0, -1);
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const rahmen = d3dRahmen(sx / ring.length, sy / ring.length);
  const pts = ring.map(([lng, lat]) => rahmen.nachXY(lng, lat));
  const traufe = f.properties.hoehe;
  const echteForm = g.dachform || 'sattel';
  const form = d3dHatDachangabe(g) && ringe.length === 1 ? echteForm : 'flach';
  const lod2 = g.dachFlaechen?.length ? d3dLod2Geometrie(g, rahmen, traufe) : null;
  const ebenen = lod2 ? [{ a: 0, b: 0, c: traufe }] : d3dDachEbenen(form, pts, {
    azimut: d3dAzimut(g, ring), neigung: g.dachNeigung, traufe,
    first: g.pvRidgeOverride ? rahmen.nachXY(g.pvRidgeOverride.lng, g.pvRidgeOverride.lat) : null,
  });
  let first = traufe;
  if (lod2) { for (const t of lod2.dach) for (const q of t) first = Math.max(first, q[2]); }
  else for (const [x, y] of [...pts, [0, 0]]) first = Math.max(first, d3dDachHoehe(ebenen, x, y));

  const module = [];
  if (modulIdx.length && typeof window.getGebPvModules === 'function') {
    let res = null;
    try { res = window.getGebPvModules(g); } catch (e) { void e; }
    const opt = lod2 ? { ebenen, ebeneBei: lod2.ebeneBei, schraeg: false }
      : { ebenen, schraeg: echteForm !== 'flach' && form !== 'flach' };
    for (const idx of modulIdx) {
      const m = res?.modules?.[idx];
      if (!m) continue;
      const q = d3dModule({ bbox: res.bbox, modules: [m] }, rahmen, opt)[0];
      if (q) module.push({ idx, ecken: q.map(([x, y, z]) => [...rahmen.nachLL(x, y), z]) });
    }
  }
  // Als Hindernis: Traufe + halbe Dachhöhe. Ohne Dachflächen kommt die Firsthöhe
  // bei verwinkelten Grundrissen aus dem Flügel-Modell (statt eines Riesendachs
  // über den ganzen Grundriss); greift es nicht (schräge Kanten), höchstens 8 m.
  let dachH = first - traufe;
  if (!lod2 && form !== 'flach') {
    const fg = d3dFluegelGebaeude(g);
    dachH = fg ? Math.max(0, fg.dachLod2.firstM - fg.dachLod2.traufeM) : Math.min(dachH, D3D_DACH_MAX_HINDERNIS);
  }
  return { ring, traufe, first, hoehe: traufe + dachH / 2, module };
}

let _farbCtx = null;
/** CSS-Farbe → [r,g,b] 0…1 (über die Canvas-Normalisierung, versteht jedes Format). */
function d3dRgb(css) {
  if (!_farbCtx) _farbCtx = document.createElement('canvas').getContext('2d');
  _farbCtx.fillStyle = '#000';
  _farbCtx.fillStyle = css || '#000';
  const s = String(_farbCtx.fillStyle);
  if (s[0] === '#') return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
  const m = s.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
}

const _ffCache = new Map();   // Freiflächen-Modulraster (kann groß werden) nach Signatur

/** Modulmaße wie in 03c/03a (Eingabefelder der PV-Parameter). */
function d3dModulMasse() {
  return {
    mb: parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1,
    ml: parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7,
  };
}

/**
 * Alle Dreiecke der Szene als Float32Array [x,y,z,r,g,b]* relativ zu einem
 * Bezugspunkt (Mercator). Relativ, weil absolute Mercator-Koordinaten in
 * float32 auf Gebäudeebene nur ~2 m genau wären.
 */
function d3dSzeneBauen(daten) {
  const ml = window.maplibregl;
  const stat = { daecher: 0, module: 0 };
  const b = d3dGrenzen(daten);
  if (!ml || !_d3d) return { daten: new Float32Array(0), ursprung: null, stat };
  const mitte = b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : [10, 51];
  const ursprung = ml.MercatorCoordinate.fromLngLat(mitte, 0);
  const faktor = _d3d.faktor;
  const werte = [];
  const dreieck = (rahmen, t, rgb) => {
    const s = d3dSchattierung(t);
    for (const [x, y, z] of t) {
      const [lng, lat] = rahmen.nachLL(x, y);
      const mc = ml.MercatorCoordinate.fromLngLat([lng, lat], z * faktor);
      werte.push(mc.x - ursprung.x, mc.y - ursprung.y, mc.z - ursprung.z, rgb[0] * s, rgb[1] * s, rgb[2] * s);
    }
  };
  const viereck = (rahmen, q, rgb) => { dreieck(rahmen, [q[0], q[1], q[2]], rgb); dreieck(rahmen, [q[0], q[2], q[3]], rgb); };

  const dachRgb = d3dRgb(D3D_DACHFARBE), modulRgb = d3dRgb(D3D_MODULFARBE), auswahlRgb = d3dRgb(D3D_AUSWAHL);
  const schattenRgbs = D3D_SCHATTEN.map(k => d3dRgb(k.farbe));
  const schattenRgb = f => schattenRgbs[Math.max(0, D3D_SCHATTEN.findIndex(k => f >= k.ab))];
  const nachGid = new Map(daten.features.map(f => [f.properties.gid, f]));
  for (const g of window.gebaeude || []) {
    const f = nachGid.get(g?.id);
    if (!f || f.properties.art === 'geist') continue;
    const ringe = f.geometry.coordinates;
    const ring = ringe[0].slice(0, -1);
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    const rahmen = d3dRahmen(sx / ring.length, sy / ring.length);
    const pts = ring.map(([lng, lat]) => rahmen.nachXY(lng, lat));
    const traufe = f.properties.hoehe;
    const echteForm = g.dachform || 'sattel';
    const zeigen = _d3d.daecher === 'alle' || (_d3d.daecher === 'angaben' && d3dHatDachangabe(g));
    // Höfe (Löcher) würde das Ebenenmodell überdachen → dort flach lassen
    const form = zeigen && ringe.length === 1 ? echteForm : 'flach';
    // LoD2-Dachflächen vorhanden → das echte Dach statt des Ebenenmodells. Verwinkelte
    // Grundrisse ohne Dachflächen als Flügel — aber nur unbelegt: belegte Dächer zeigen
    // das Dach, auf dem die Module platziert sind.
    const belegt = (g.pvFlaechen || []).some(fl => fl.typ === 'belegung');
    const fluegel = zeigen && form !== 'flach' && !belegt ? d3dFluegelGebaeude(g) : null;
    const lod2 = zeigen && (g.dachFlaechen?.length || fluegel) ? d3dLod2Geometrie(fluegel || g, rahmen, traufe) : null;
    const ebenen = lod2 ? [{ a: 0, b: 0, c: traufe }] : d3dDachEbenen(form, pts, {
      azimut: d3dAzimut(g, ring), neigung: g.dachNeigung, traufe,
      first: g.pvRidgeOverride ? rahmen.nachXY(g.pvRidgeOverride.lng, g.pvRidgeOverride.lat) : null,
    });
    const istAuswahl = f.properties.art === 'auswahl';
    const wandRgb = () => istAuswahl ? auswahlRgb : d3dRgb(_d3d.modus === 'baujahr' ? f.properties.farbeBaujahr
      : _d3d.modus === 'einheitlich' ? '#c9cdd3' : f.properties.farbe);
    if (lod2) {
      const wRgb = wandRgb();
      for (const t of lod2.dach) dreieck(rahmen, t, istAuswahl ? auswahlRgb : dachRgb);
      for (const t of lod2.wand) dreieck(rahmen, t, wRgb);
      if (lod2.dach.length) stat.daecher++;
    } else if (form !== 'flach') {
      const { dach, wand } = d3dDachDreiecke(pts, ebenen, traufe);
      const wRgb = wandRgb();
      for (const t of dach) dreieck(rahmen, t, istAuswahl ? auswahlRgb : dachRgb);
      for (const t of wand) dreieck(rahmen, t, wRgb);
      if (dach.length) stat.daecher++;
    }
    if (_d3d.module && typeof window.getGebPvModules === 'function'
        && (g.pvFlaechen || []).some(fl => fl.typ === 'belegung')) {
      let res = null;
      try { res = window.getGebPvModules(g); } catch (e) { void e; }
      // Platziert wurde für die ECHTE Dachform (Schrägdach: auf der Dachhaut,
      // flach: aufgeständert) — so werden die Module auch dargestellt.
      const opt = lod2
        ? { ebenen, ebeneBei: lod2.ebeneBei, schraeg: false }
        : { ebenen, schraeg: echteForm !== 'flach' && form !== 'flach' };
      // Nach Verschattung färben (40-baeume.js): Faktor je Modul, Modul für Modul
      const schatten = _d3d.schatten && res?.modules && typeof window.pvVerschattungModulFaktoren === 'function'
        ? window.pvVerschattungModulFaktoren(g) : null;
      if (schatten) {
        res.modules.forEach((m, i) => {
          const q = d3dModule({ bbox: res.bbox, modules: [m] }, rahmen, opt)[0];
          if (!q) return;
          viereck(rahmen, q, schatten[i] != null ? schattenRgb(schatten[i]) : modulRgb);
          stat.module++;
        });
      } else {
        const quads = d3dModule(res, rahmen, opt);
        for (const q of quads) viereck(rahmen, q, modulRgb);
        stat.module += quads.length;
      }
    }
  }

  // Freiflächen-PV
  if (_d3d.module && typeof window.placePvModules === 'function') {
    const { mb, ml: mlen } = d3dModulMasse();
    for (const ff of window.freiflaechen || []) {
      if (!ff || !ff.polygon || ff.polygon.length < 3) continue;
      const gcrPct = ff.gcr !== undefined ? ff.gcr : (typeof window.ffGcrDefault === 'function' ? window.ffGcrDefault(ff) : 40);
      const sig = [ff.id, ff.polygon.length, ff.polygon[0].lat, ff.polygon[0].lng, gcrPct, ff.ausrichtung, mb, mlen].join('|');
      let res = _ffCache.get(sig);
      if (!res) {
        try {
          res = window.placePvModules([ff.polygon], [], { pitched: false, coverage: gcrPct / 100, ausrichtung: ff.ausrichtung, moduleW: mb, moduleL: mlen });
        } catch (e) { res = null; }
        _ffCache.set(sig, res);
      }
      const p0 = ff.polygon[0];
      const rahmen = d3dRahmen(p0.lng, p0.lat);
      const quads = d3dModule(res, rahmen, { boden: true, schraeg: false });
      for (const q of quads) viereck(rahmen, q, modulRgb);
      stat.module += quads.length;
    }
  }
  return { daten: new Float32Array(werte), ursprung, stat };
}

function d3dSzeneSetzen(daten) {
  if (!_d3d || !_d3d.schicht) return;
  let szene;
  try { szene = d3dSzeneBauen(daten || d3dDaten()); }
  catch (e) { console.warn('3D-Ansicht: Dächer/Module', e); return; }
  _d3d.stat = szene.stat;
  _d3d.schicht.setzen(szene.daten, szene.ursprung);
  const info = document.getElementById('d3d-dachinfo');
  if (info) info.textContent = d3dDachinfoText();
}

function d3dDachinfoText() {
  const s = _d3d?.stat;
  if (!s) return '';
  return `${s.daecher} Dächer geformt · ${s.module.toLocaleString('de-DE')} Module`;
}

/**
 * Custom Layer: zeichnet die vorbereiteten Dreiecke (Position + Farbe je Ecke).
 * mitGlas: folgt „Gebäude durchsichtig" (Dächer/Module ja, Bäume nein).
 */
function d3dDachSchicht(id = 'd3d-daecher', mitGlas = true) {
  const VS = 'attribute vec3 a_pos; attribute vec3 a_col; uniform mat4 u_m; varying vec3 v_col;'
    + 'void main(){ v_col = a_col; gl_Position = u_m * vec4(a_pos, 1.0); }';
  const FS = 'precision mediump float; varying vec3 v_col; uniform float u_a;'
    + 'void main(){ gl_FragColor = vec4(v_col, u_a); }';
  return {
    id, type: 'custom', renderingMode: '3d',
    gl: null, prog: null, buf: null, n: 0, ursprung: null, karte: null,
    onAdd(karte, gl) {
      this.karte = karte; this.gl = gl;
      const sh = (typ, src) => {
        const s = gl.createShader(typ); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader');
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Programm');
      this.prog = p;
      this.aPos = gl.getAttribLocation(p, 'a_pos');
      this.aCol = gl.getAttribLocation(p, 'a_col');
      this.uM = gl.getUniformLocation(p, 'u_m');
      this.uA = gl.getUniformLocation(p, 'u_a');
      this.buf = gl.createBuffer();
      if (this._warten) { const w = this._warten; this._warten = null; this.setzen(w.daten, w.ursprung); }
    },
    setzen(daten, ursprung) {
      if (!this.gl) { this._warten = { daten, ursprung }; return; }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, daten, gl.STATIC_DRAW);
      this.n = daten.length / 6;
      this.ursprung = ursprung;
      this.karte?.triggerRepaint();
    },
    render(gl, opt) {
      if (!this.n || !this.ursprung) return;
      const m = opt?.defaultProjectionData?.mainMatrix || opt?.modelViewProjectionMatrix || opt;
      const { x: ox, y: oy, z: oz } = this.ursprung;
      // Matrix · Verschiebung(Ursprung) in double rechnen, erst dann auf float32
      const u = new Float32Array(16);
      for (let i = 0; i < 12; i++) u[i] = m[i];
      for (let r = 0; r < 4; r++) u[12 + r] = m[r] * ox + m[4 + r] * oy + m[8 + r] * oz + m[12 + r];
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(this.uM, false, u);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(this.aCol);
      gl.vertexAttribPointer(this.aCol, 3, gl.FLOAT, false, 24, 12);
      // Durchsichtig: mischen und den Tiefenpuffer nicht beschreiben, damit
      // dahinterliegende Dächer/Leitungen durchscheinen
      const a = mitGlas && _d3d?.glas ? D3D_GLAS : 1;
      gl.uniform1f(this.uA, a);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(a >= 1);
      gl.disable(gl.CULL_FACE);
      if (a < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      else gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, this.n);
    },
    onRemove(karte, gl) {
      if (this.buf) gl.deleteBuffer(this.buf);
      if (this.prog) gl.deleteProgram(this.prog);
      this.gl = null; this.buf = null; this.prog = null; this.n = 0;
    },
  };
}

/* ── Netze ────────────────────────────────────────────────────────────────── */

function d3dNetzDaten() {
  const lm = window.map;
  const sichtbar = l => !!(lm && typeof lm.hasLayer === 'function' && lm.hasLayer(l));
  const linien = d3dNetzLinien(window.netzEdges, window.stromEdges, sichtbar,
    { waerme: _d3d?.netzW !== false, strom: _d3d?.netzS !== false });
  const stationen = _d3d?.netzS !== false ? d3dStationen(window.ASSETS?.items)
    : { type: 'FeatureCollection', features: [] };
  return { linien, stationen };
}

/** Linienbreite: Kartenstärke × Zoomfaktor (+ Zuschlag für den Saum). */
function d3dLinienbreite(faktor, plus) {
  const w = k => ['+', ['*', ['get', 'breite'], k * faktor], plus];
  return ['interpolate', ['linear'], ['zoom'], 14, w(0.45), 17, w(0.9), 20, w(2.2)];
}

function d3dNetzinfoText() {
  const n = _d3d?.netzZahl;
  if (!n) return '';
  return `${n.waerme} Wärmeleitungen · ${n.strom} Kabel · ${n.stationen} Stationen`;
}

/** Netzdaten neu holen und nur bei Änderung an MapLibre geben. */
function d3dNetzAktualisieren() {
  const ml = _d3d?.ml;
  if (!ml || !ml.getSource('d3d-netz')) return;
  let netz;
  try { netz = d3dNetzDaten(); } catch (e) { console.warn('3D-Ansicht: Netze', e); return; }
  const sig = JSON.stringify(netz);
  if (sig === _d3d.netzSig) return;
  _d3d.netzSig = sig;
  ml.getSource('d3d-netz').setData(netz.linien);
  ml.getSource('d3d-stat').setData(netz.stationen);
  const fs = netz.linien.features;
  _d3d.netzZahl = { waerme: fs.filter(f => f.properties.art === 'waerme').length,
                    strom: fs.filter(f => f.properties.art === 'strom').length,
                    stationen: netz.stationen.features.length };
  const info = document.getElementById('d3d-netzinfo');
  if (info) info.textContent = d3dNetzinfoText();
}

/* ── Bäume ────────────────────────────────────────────────────────────────── */
// Hat das Projekt Bäume (40-baeume.js, window.baumListe), zeigt die Ansicht
// genau diese — dieselben, mit denen die Verschattung rechnet. Sonst eine reine
// Vorschau aus OpenStreetMap (Overpass, nichts wird gespeichert). Geometrie aus
// lib/baeume-3d.js, eigene WebGL-Ebene (ändert sich nicht mit updateViz, nur
// mit der Überhöhung und über d3dBaeumeNeu).

const D3D_BAUM_RAND = 150;     // m um die Gebäude
const D3D_BAUM_MAX_SEITE = 3000;  // m — größere Bestände: nur der sichtbare Ausschnitt

/** Ausschnitt für die Baumabfrage: alle Gebäude + Rand, sonst die aktuelle Ansicht. */
function d3dBaumBbox() {
  const g = d3dGrenzen(d3dDaten());
  let w, s, e, n;
  if (g) [[w, s], [e, n]] = g;
  const mMitte = ((s ?? 0) + (n ?? 0)) / 2;
  const kx = 111320 * Math.cos(mMitte * Math.PI / 180), ky = 111320;
  const zuGross = g && ((e - w) * kx > D3D_BAUM_MAX_SEITE || (n - s) * ky > D3D_BAUM_MAX_SEITE);
  if (!g || zuGross) {
    const b = _d3d?.ml?.getBounds?.();
    if (!b) return null;
    const c = b.getCenter();
    const hx = D3D_BAUM_MAX_SEITE / 2 / (111320 * Math.cos(c.lat * Math.PI / 180)), hy = D3D_BAUM_MAX_SEITE / 2 / ky;
    return { w: Math.max(b.getWest(), c.lng - hx), e: Math.min(b.getEast(), c.lng + hx),
             s: Math.max(b.getSouth(), c.lat - hy), n: Math.min(b.getNorth(), c.lat + hy) };
  }
  return { w: w - D3D_BAUM_RAND / kx, e: e + D3D_BAUM_RAND / kx, s: s - D3D_BAUM_RAND / ky, n: n + D3D_BAUM_RAND / ky };
}

/** Bäume des Projekts im Format von baeumeAusOverpass (oder null, wenn es keine gibt). */
function d3dProjektBaeume() {
  const liste = typeof window.baumListe === 'function' ? window.baumListe() : null;
  if (!liste?.length) return null;
  const bbox = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
  const zahl = { einzel: 0, reihe: 0, wald: 0, obst: 0, eigen: 0 };
  for (const b of liste) {
    bbox.w = Math.min(bbox.w, b.lng); bbox.e = Math.max(bbox.e, b.lng);
    bbox.s = Math.min(bbox.s, b.lat); bbox.n = Math.max(bbox.n, b.lat);
    zahl[b.quelle === 'osm' && zahl[b.osmTyp] != null ? b.osmTyp : 'eigen']++;
  }
  return { baeume: liste, zahl, ausgeduennt: false, bbox, ausProjekt: true };
}

/** Haken aus 40-baeume.js: Projektbäume haben sich geändert. */
export function d3dBaeumeNeu() {
  if (!_d3d) return;
  _d3d.baumErgebnis = null;
  _d3d.baumStatus = '';
  if (_baumAn) d3dBaeumeLaden();
  else d3dBaumInfo();
}

async function d3dBaeumeLaden() {
  const d3d = _d3d;
  if (!d3d || d3d.baumStatus === 'laedt') return;
  const projekt = d3dProjektBaeume();
  if (projekt) {
    d3d.baumErgebnis = projekt;
    d3d.baumStatus = 'fertig';
    d3dBaumSzeneSetzen();
    d3dBaumInfo();
    d3dLegende();
    return;
  }
  const bbox = d3dBaumBbox();
  if (!bbox) return;
  const sig = [bbox.s, bbox.w, bbox.n, bbox.e].map(v => v.toFixed(4)).join(',');
  let data = _baumCache?.sig === sig ? _baumCache.data : null;
  if (!data) {
    d3d.baumStatus = 'laedt';
    d3dBaumInfo();
    try {
      data = await baumOverpassLaden(bbox);
    } catch (e) {
      if (_d3d !== d3d) return;
      console.warn('3D-Ansicht: Bäume', e);
      d3d.baumStatus = 'fehler';
      d3dBaumInfo();
      return;
    }
    _baumCache = { sig, data };
    if (_d3d !== d3d) return;   // zwischenzeitlich geschlossen
  }
  // Gebäude bei jedem Laden neu ausnehmen (können sich seit der Abfrage geändert haben)
  const ausschluss = d3dDaten().features.map(f => f.geometry?.coordinates?.[0]).filter(Boolean);
  try {
    d3d.baumErgebnis = { ...baeumeAusOverpass(data, { bbox, ausschluss }), bbox };
    d3d.baumStatus = 'fertig';
  } catch (e) {
    console.warn('3D-Ansicht: Bäume', e);
    d3d.baumStatus = 'fehler';
  }
  d3dBaumSzeneSetzen();
  d3dBaumInfo();
  d3dLegende();
}

/** Baum-Dreiecke in die eigene Ebene (relativ zur Ausschnittsmitte, Überhöhung wie Gebäude). */
function d3dBaumSzeneSetzen() {
  const schicht = _d3d?.baumSchicht;
  const ml = window.maplibregl;
  if (!schicht || !ml) return;
  const erg = _baumAn ? _d3d.baumErgebnis : null;
  if (!erg || !erg.baeume.length) { schicht.setzen(new Float32Array(0), null); return; }
  const b = erg.bbox;
  const ursprung = ml.MercatorCoordinate.fromLngLat([(b.w + b.e) / 2, (b.s + b.n) / 2], 0);
  const faktor = _d3d.faktor;
  const rgb = { laub: d3dRgb(BAUM_FARBEN.laub), nadel: d3dRgb(BAUM_FARBEN.nadel), obst: d3dRgb(BAUM_FARBEN.obst) };
  const stammRgb = d3dRgb(BAUM_FARBEN.stamm);
  const werte = [];
  for (const baum of erg.baeume) {
    const mc = ml.MercatorCoordinate.fromLngLat([baum.lng, baum.lat], 0);
    const k = mc.meterInMercatorCoordinateUnits();
    const dx = mc.x - ursprung.x, dy = mc.y - ursprung.y;
    const { krone, stamm } = baumDreiecke(baum);
    const farbe = (rgb[baum.art] || rgb.laub).map(c => Math.min(1, c * (baum.ton || 1)));
    const ausgeben = (tris, f) => {
      for (const t of tris) {
        const s = d3dSchattierung(t);
        // Mercator-y wächst nach Süden
        for (const [x, y, z] of t) werte.push(dx + x * k, dy - y * k, z * faktor * k, f[0] * s, f[1] * s, f[2] * s);
      }
    };
    ausgeben(stamm, stammRgb);
    ausgeben(krone, farbe);
  }
  schicht.setzen(new Float32Array(werte), ursprung);
}

function d3dBaumInfoText() {
  if (!_d3d || !_baumAn) return '';
  if (_d3d.baumStatus === 'laedt') return 'Bäume werden aus OpenStreetMap geladen …';
  if (_d3d.baumStatus === 'fehler') return '⚠ OpenStreetMap nicht erreichbar (offline?) — Haken neu setzen zum Wiederholen.';
  const erg = _d3d.baumErgebnis;
  if (!erg) return '';
  if (!erg.baeume.length) return 'Im Umkreis sind in OSM keine Bäume erfasst.';
  const z = erg.zahl;
  const teile = [z.einzel && `${z.einzel} einzeln`, z.reihe && `${z.reihe} in Reihen`,
    z.wald && `${z.wald.toLocaleString('de-DE')} Wald`, z.obst && `${z.obst} Streuobst`,
    z.eigen && `${z.eigen} eigene`].filter(Boolean);
  return `${erg.baeume.length.toLocaleString('de-DE')} Bäume ${erg.ausProjekt ? 'aus dem Projekt' : 'aus OSM, nur Vorschau'} (${teile.join(' · ')})`
    + (erg.ausgeduennt ? ' · Flächen ausgedünnt' : '');
}

function d3dBaumInfo() {
  const el = document.getElementById('d3d-bauminfo');
  if (el) el.textContent = d3dBaumInfoText();
}

/* ── Oberfläche ───────────────────────────────────────────────────────────── */

const BTN = 'flex:1;padding:4px 6px;border-radius:5px;border:1px solid var(--border);background:var(--surface2);'
  + 'color:var(--text);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;';
const BTN_AN = 'background:var(--accent);border-color:var(--accent);color:#111;';

function d3dPanelHtml() {
  const m = _d3d.modus, sat = _d3d.sat;
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
    <b style="font-size:12.5px;">🏙 3D-Ansicht</b>
    <button data-d3d="schliessen" title="Zurück zur Arbeitskarte" style="background:none;border:none;color:var(--muted);font-size:15px;cursor:pointer;line-height:1;">✕</button>
  </div>
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 3px;">Farbe</div>
  <select data-d3d="modus" style="width:100%;padding:4px 5px;border-radius:5px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:11px;">
    <option value="karte" ${m === 'karte' ? 'selected' : ''}>Wie Arbeitskarte</option>
    <option value="baujahr" ${m === 'baujahr' ? 'selected' : ''}>Baujahr</option>
    <option value="einheitlich" ${m === 'einheitlich' ? 'selected' : ''}>Einheitlich</option>
  </select>
  <div id="d3d-legende" style="margin-top:5px;"></div>
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:9px 0 3px;">Dächer &amp; PV</div>
  <select data-d3d="daecher" title="Dachform, Neigung und Azimut kommen aus den PV-Angaben des Gebäudes (Dach &amp; PV)" style="width:100%;padding:4px 5px;border-radius:5px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:11px;">
    <option value="angaben" ${_d3d.daecher === 'angaben' ? 'selected' : ''}>Dächer mit Angaben formen</option>
    <option value="alle" ${_d3d.daecher === 'alle' ? 'selected' : ''}>Alle Dächer (Vorgabe Satteldach 35°)</option>
    <option value="aus" ${_d3d.daecher === 'aus' ? 'selected' : ''}>Alle flach</option>
  </select>
  <label style="display:flex;align-items:center;gap:6px;margin-top:5px;font-size:11px;cursor:pointer;">
    <input type="checkbox" data-d3d="module" ${_d3d.module ? 'checked' : ''}>PV-Module (Dach &amp; Freifläche)</label>
  <label style="display:flex;align-items:center;gap:6px;margin-top:3px;font-size:11px;cursor:pointer;" title="Module nach dem gerechneten Verschattungsfaktor ihrer Dachfläche färben (PV-Modus → Bäume &amp; Verschattung). Nicht gerechnete Dächer bleiben blau.">
    <input type="checkbox" data-d3d="schatten" ${_d3d.schatten ? 'checked' : ''}>… nach Verschattung färben</label>
  <div id="d3d-dachinfo" style="font-size:10px;color:var(--muted);margin-top:3px;">${d3dDachinfoText()}</div>
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:9px 0 3px;">Netze</div>
  <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;" title="Farben wie auf der Karte (DN, Auslastung …); eine dort ausgeblendete Ebene fehlt auch hier">
    <input type="checkbox" data-d3d="netzW" ${_d3d.netzW ? 'checked' : ''}>Wärmenetz</label>
  <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;margin-top:3px;" title="Kabel wie auf der Karte, dazu freistehende Netzanschlusspunkte, Schaltanlagen, Trafostationen und Batteriespeicher">
    <input type="checkbox" data-d3d="netzS" ${_d3d.netzS ? 'checked' : ''}>Stromnetz &amp; Stationen</label>
  <div id="d3d-netzinfo" style="font-size:10px;color:var(--muted);margin-top:3px;">${d3dNetzinfoText()}</div>
  <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;margin-top:5px;" title="Gebäude, Dächer und Module halbtransparent — zeigt die Leitungen, die unter den Gebäuden verlaufen">
    <input type="checkbox" data-d3d="glas" ${_d3d.glas ? 'checked' : ''}>Gebäude durchsichtig</label>
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:9px 0 3px;">Umgebung</div>
  <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;" title="Die Bäume des Projekts (PV-Modus → Bäume &amp; Verschattung). Ohne Projektbäume eine Vorschau aus OpenStreetMap im Umkreis von 150 m um die Gebäude — die wird nicht gespeichert.">
    <input type="checkbox" data-d3d="baeume" ${_baumAn ? 'checked' : ''}>Bäume</label>
  <div id="d3d-bauminfo" style="font-size:10px;color:var(--muted);margin-top:3px;">${d3dBaumInfoText()}</div>
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:9px 0 3px;">Ansicht</div>
  <div style="display:flex;gap:3px;">
    <button data-d3d="2d" style="${BTN}" title="Senkrecht von oben">2D</button>
    <button data-d3d="3d" style="${BTN}" title="Geneigt">3D</button>
    <button data-d3d="links" style="${BTN}" title="45° nach links drehen">↺</button>
    <button data-d3d="rechts" style="${BTN}" title="45° nach rechts drehen">↻</button>
    <button data-d3d="alle" style="${BTN}" title="Alle Gebäude einpassen">⌖</button>
  </div>
  <div style="display:flex;gap:3px;margin-top:4px;">
    <button data-d3d="karte" style="${BTN}${sat ? '' : BTN_AN}">Karte</button>
    <button data-d3d="sat" style="${BTN}${sat ? BTN_AN : ''}">Satellit</button>
  </div>
  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:9px 0 3px;">
    Höhe überhöhen: <span id="d3d-faktor">${_d3d.faktor.toFixed(1).replace('.', ',')}</span>×</div>
  <input data-d3d="faktor" type="range" min="1" max="3" step="0.1" value="${_d3d.faktor}" style="width:100%;">
  <button data-d3d="png" style="${BTN}width:100%;margin-top:8px;">📷 Bild speichern (PNG)</button>
  <div style="font-size:10px;color:var(--muted);margin-top:8px;line-height:1.4;">
    Rechte Maustaste / Strg + Ziehen: neigen &amp; drehen.<br>Klick auf ein Gebäude öffnet seine Eigenschaften.<br>
    Wandhöhe = Geschosse × 3 m, Dach aus den PV-Angaben.</div>`;
}

function d3dLegende() {
  const el = document.getElementById('d3d-legende');
  if (!el || !_d3d) return;
  const zeile = (farbe, text) => `<div style="display:flex;align-items:center;gap:6px;font-size:10.5px;margin:1px 0;">
    <i style="width:12px;height:9px;border-radius:2px;background:${farbe};display:inline-block;flex-shrink:0;"></i>${text}</div>`;
  let html = '';
  if (_d3d.modus === 'karte') {
    // Legende der Arbeitskarte übernehmen (gleiche Farben)
    const titel = document.getElementById('legend-color-title')?.textContent || '';
    const bar = document.getElementById('legend-bar')?.style.background || '';
    const min = document.getElementById('leg-min')?.textContent || '';
    const max = document.getElementById('leg-max')?.textContent || '';
    if (bar) {
      html += `<div style="font-size:10.5px;color:var(--muted);">${titel}</div>
        <div style="height:7px;border-radius:3px;margin:2px 0;background:${bar};"></div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);"><span>${min}</span><span>${max}</span></div>`;
    }
    html += zeile(D3D_NEUTRAL, 'ohne Kennwert');
  } else if (_d3d.modus === 'baujahr') {
    html += D3D_BAUJAHR_KLASSEN.map(k => zeile(k.farbe, k.label)).join('') + zeile(D3D_NEUTRAL, 'unbekannt');
  }
  if (_d3d.daecher !== 'aus') html += zeile(D3D_DACHFARBE, 'Dachfläche');
  if (_d3d.module && !_d3d.schatten) html += zeile(D3D_MODULFARBE, 'PV-Module');
  if (_d3d.module && _d3d.schatten) html += D3D_SCHATTEN.map(k => zeile(k.farbe, 'Modul: ' + k.label)).join('') + zeile(D3D_MODULFARBE, 'Modul: nicht gerechnet');
  const bz = _baumAn && _d3d.baumErgebnis ? _d3d.baumErgebnis.baeume : null;
  if (bz?.length) {
    const arten = new Set(bz.map(b => b.art));
    if (arten.has('laub')) html += zeile(BAUM_FARBEN.laub, 'Laubbaum');
    if (arten.has('nadel')) html += zeile(BAUM_FARBEN.nadel, 'Nadelbaum');
    if (arten.has('obst')) html += zeile(BAUM_FARBEN.obst, 'Obstbaum (Streuobst)');
  }
  if (_d3d.netzW) html += zeile('#e53935', 'Wärmeleitung (Farbe wie Karte)');
  if (_d3d.netzS) html += zeile('#fdd835', 'Stromkabel, gestrichelt (Farbe wie Karte)');
  if (_d3d.netzS) html += zeile(D3D_STATIONEN.Trafo.farbe, 'Station (Trafo, Schaltanlage, NAP)');
  html += zeile('rgba(150,155,165,.45)', 'geplant / abgerissen / ausgeschlossen');
  html += zeile(D3D_AUSWAHL, 'ausgewählt');
  el.innerHTML = html;
}

function d3dKopfknopf(an) {
  const b = document.getElementById('btn-3d');
  if (!b) return;
  b.style.background = an ? '#4fc3f7' : '';
  b.style.color = an ? '#111' : '';
}

/**
 * „3D"-Knopf als Leaflet-Steuerelement unter den Zoom-Knöpfen — dort, wo man
 * ihn braucht, und ohne die ohnehin volle Kopfleiste zu verbreitern. Die
 * 3D-Ansicht legt sich über die Karte, ihr eigenes ✕ führt zurück.
 */
function d3dKartenknopf() {
  const lm = window._appLeafletMap || window.map;
  if (!lm || typeof L === 'undefined' || lm._d3dKnopf) return;
  const Knopf = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar leaflet-control-d3d');
      const a = L.DomUtil.create('a', '', box);
      a.id = 'btn-3d';
      a.href = '#';
      a.setAttribute('role', 'button');
      a.title = '3D-Ansicht der Gebäude (Höhe = Geschosse × 3 m, Farben wie auf der Karte)';
      a.setAttribute('aria-label', '3D-Ansicht öffnen');
      a.textContent = '3D';
      a.style.cssText = 'font-weight:700;font-size:11px;letter-spacing:.02em;';
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(a, 'click', ev => { L.DomEvent.preventDefault(ev); d3dUmschalten(); });
      return box;
    },
  });
  lm._d3dKnopf = new Knopf().addTo(lm);
}

/** Overlay deckungsgleich auf #map legen (beide Seitenpanels bleiben bedienbar). */
function d3dPositionieren() {
  const m = document.getElementById('map');
  if (!m || !_d3d) return;
  Object.assign(_d3d.el.style, {
    left: m.offsetLeft + 'px', top: m.offsetTop + 'px',
    width: m.offsetWidth + 'px', height: m.offsetHeight + 'px',
  });
  if (_d3d.ml) _d3d.ml.resize();
}

/* ── Öffnen / Schließen ───────────────────────────────────────────────────── */

export async function d3dOeffnen() {
  if (_d3d) return;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  // Die 3D-Ansicht liegt über der Karte — aus Analyse/Gebäude/… erst zurück zur Karte.
  const aktiverTab = document.querySelector('.view-tab.active')?.dataset.mode;
  if (aktiverTab && aktiverTab !== 'karte' && typeof window.setViewMode === 'function') window.setViewMode('karte');
  if (document.getElementById('ebenen-panel')?.style.display !== 'none'
      && typeof window.toggleEbenenPanel === 'function') window.toggleEbenenPanel();

  const el = document.createElement('div');
  el.id = 'd3d-view';
  el.style.cssText = 'position:absolute;z-index:550;background:var(--bg);overflow:hidden;';
  el.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;">3D-Ansicht wird geladen …</div>';
  mapEl.parentNode.appendChild(el);

  const lm = window.map;
  _d3d = {
    el, ml: null, ro: null, modus: 'karte', faktor: 1, hoverId: null, popup: null, raf: 0,
    sat: !!(lm && window.esriTile && lm.hasLayer(window.esriTile)),
    daecher: 'angaben', module: true, schicht: null, stat: { daecher: 0, module: 0 },
    netzW: true, netzS: true, netzSig: '', netzTimer: 0, netzZahl: null, glas: false,
    baumSchicht: null, baumStatus: '', baumErgebnis: null, schatten: false,
  };
  d3dPositionieren();
  if (typeof ResizeObserver === 'function') {
    _d3d.ro = new ResizeObserver(() => d3dPositionieren());
    _d3d.ro.observe(mapEl);
  }
  d3dKopfknopf(true);

  let ml;
  try {
    ml = await d3dLadeMaplibre();
  } catch (e) {
    if (!_d3d) return;
    el.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:var(--muted);font-size:12px;">
      <div>⚠ ${e.message}</div><button data-d3d="schliessen" style="${BTN}flex:none;">Zurück zur Karte</button></div>`;
    el.addEventListener('click', d3dKlickImPanel);
    return;
  }
  if (!_d3d || _d3d.el !== el) return;   // zwischenzeitlich geschlossen

  const osmUrl = window.osmTile?._url || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
  const esriUrl = window.esriTile?._url || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const daten = d3dDaten();
  const mitte = lm?.getCenter?.() || { lat: 51, lng: 10 };
  let drehung = 0;
  try { drehung = typeof window.kdWinkel === 'function' ? window.kdWinkel() : 0; } catch (e) { void e; }

  el.innerHTML = '<div id="d3d-karte" style="position:absolute;inset:0;"></div>'
    + '<div id="d3d-panel" style="position:absolute;top:10px;left:10px;width:236px;max-height:calc(100% - 20px);overflow:auto;'
    + 'background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:10px 12px;'
    + 'box-shadow:0 6px 22px rgba(0,0,0,.45);font-size:11.5px;color:var(--text);z-index:2;"></div>';
  const panel = el.querySelector('#d3d-panel');
  panel.innerHTML = d3dPanelHtml();
  panel.addEventListener('click', d3dKlickImPanel);
  panel.addEventListener('input', d3dEingabeImPanel);
  panel.addEventListener('change', d3dEingabeImPanel);

  const netz = d3dNetzDaten();
  const karte = new ml.Map({
    container: el.querySelector('#d3d-karte'),
    style: {
      version: 8,
      sources: {
        'd3d-osm': { type: 'raster', tiles: d3dKachelUrls(osmUrl, window.osmTile?.options?.subdomains), tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap-Mitwirkende' },
        'd3d-esri': { type: 'raster', tiles: d3dKachelUrls(esriUrl, window.esriTile?.options?.subdomains), tileSize: 256, maxzoom: 19, attribution: '© Esri' },
        'd3d-geb': { type: 'geojson', data: daten },
        'd3d-netz': { type: 'geojson', data: netz.linien },
        'd3d-stat': { type: 'geojson', data: netz.stationen },
      },
      layers: [
        { id: 'd3d-hg', type: 'background', paint: { 'background-color': '#1b1d22' } },
        { id: 'd3d-osm', type: 'raster', source: 'd3d-osm', layout: { visibility: _d3d.sat ? 'none' : 'visible' }, paint: { 'raster-saturation': -0.45 } },
        { id: 'd3d-esri', type: 'raster', source: 'd3d-esri', layout: { visibility: _d3d.sat ? 'visible' : 'none' } },
        // Leitungen liegen auf dem Gelände (unter den Gebäuden); dunkler Saum für Kontrast
        { id: 'd3d-netz-hof', type: 'line', source: 'd3d-netz', layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#0a0e1a', 'line-opacity': 0.5, 'line-width': d3dLinienbreite(1, 3) } },
        { id: 'd3d-netz-waerme', type: 'line', source: 'd3d-netz', filter: ['==', ['get', 'art'], 'waerme'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'farbe'], 'line-width': d3dLinienbreite(1, 0) } },
        { id: 'd3d-netz-strom', type: 'line', source: 'd3d-netz', filter: ['==', ['get', 'art'], 'strom'],
          layout: { 'line-join': 'round' },
          paint: { 'line-color': ['get', 'farbe'], 'line-width': d3dLinienbreite(1, 0), 'line-dasharray': [2, 1.2] } },
        { id: 'd3d-geist', type: 'fill-extrusion', source: 'd3d-geb', filter: ['==', ['get', 'art'], 'geist'],
          paint: { 'fill-extrusion-color': '#969ba5', 'fill-extrusion-height': ['get', 'hoehe'], 'fill-extrusion-opacity': 0.3 } },
        { id: 'd3d-geb', type: 'fill-extrusion', source: 'd3d-geb', filter: ['!=', ['get', 'art'], 'geist'],
          paint: { 'fill-extrusion-color': d3dFarbe('karte'), 'fill-extrusion-height': ['get', 'hoehe'],
                   'fill-extrusion-opacity': 0.93, 'fill-extrusion-vertical-gradient': true } },
        { id: 'd3d-stat', type: 'fill-extrusion', source: 'd3d-stat',
          paint: { 'fill-extrusion-color': ['get', 'farbe'], 'fill-extrusion-height': ['get', 'hoehe'], 'fill-extrusion-opacity': 0.95 } },
      ],
    },
    center: [mitte.lng, mitte.lat],
    zoom: d3dZoomAusLeaflet(lm?.getZoom?.() ?? 16),
    pitch: D3D_NEIGUNG,
    bearing: d3dBearingAusKartendrehung(drehung),
    maxPitch: 80,
    attributionControl: { compact: true },
  });
  _d3d.ml = karte;
  karte.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  karte.addControl(new ml.ScaleControl({ unit: 'metric' }), 'bottom-left');
  // Ebenen einrichten, sobald der Stil steht — NICHT erst bei 'load', das wartet
  // auf alle Hintergrundkacheln (bei langsamem Netz kämen Dächer sonst spät).
  const einrichten = () => {
    if (!_d3d || _d3d.ml !== karte || _d3d.schicht) return;
    try { karte.setLight({ anchor: 'map', position: [1.3, 210, 35], intensity: 0.45 }); } catch (e) { void e; }
    // Bäume vor den Dächern: undurchsichtig zuerst, dann die ggf. durchsichtigen Dächer
    _d3d.baumSchicht = d3dDachSchicht('d3d-baeume', false);
    karte.addLayer(_d3d.baumSchicht);
    _d3d.schicht = d3dDachSchicht();
    karte.addLayer(_d3d.schicht);
    d3dAnwenden();
    if (_baumAn) d3dBaeumeLaden();
  };
  if (karte.isStyleLoaded()) einrichten(); else karte.once('style.load', einrichten);
  karte.on('load', () => {
    einrichten();
    // Keine Gebäude im Blick (z. B. Karte stand woanders) → auf den Bestand springen
    const b = d3dGrenzen(daten);
    if (b && !karte.queryRenderedFeatures({ layers: ['d3d-geb', 'd3d-geist'] }).length) d3dAlleEinpassen(0);
  });
  karte.on('error', e => console.warn('3D-Ansicht:', e?.error?.message || e));

  // Hover + Tooltip
  _d3d.popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'd3d-popup' });
  const hoverAus = () => {
    if (_d3d?.hoverId != null) karte.setFeatureState({ source: 'd3d-geb', id: _d3d.hoverId }, { hover: false });
    if (_d3d) _d3d.hoverId = null;
  };
  // Ein gemeinsamer Hover für Gebäude, Stationen und Leitungen — Vorrang hat,
  // was oben liegt (Gebäude vor Station vor Leitung). Leitungen sind dünn, daher
  // mit ein paar Pixeln Fangbereich.
  const esc = typeof window.escHtml === 'function' ? window.escHtml : (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]));
  karte.on('mousemove', e => {
    if (!_d3d || !karte.getLayer('d3d-geb')) return;
    const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    const f = karte.queryRenderedFeatures(e.point, { layers: ['d3d-geb'] })[0];
    if (!f) {
      hoverAus();
      const n = karte.queryRenderedFeatures(box, { layers: ['d3d-stat', 'd3d-netz-waerme', 'd3d-netz-strom'] })
        .sort((a, b) => (a.layer.id === 'd3d-stat' ? 0 : 1) - (b.layer.id === 'd3d-stat' ? 0 : 1))[0];
      if (!n) { karte.getCanvas().style.cursor = ''; _d3d.popup?.remove(); return; }
      karte.getCanvas().style.cursor = 'default';
      _d3d.popup.setLngLat(e.lngLat).setHTML(esc(n.properties.info || '')).addTo(karte);
      return;
    }
    if (_d3d.hoverId !== f.id) {
      hoverAus();
      if (f.id != null) { _d3d.hoverId = f.id; karte.setFeatureState({ source: 'd3d-geb', id: f.id }, { hover: true }); }
    }
    karte.getCanvas().style.cursor = 'pointer';
    const p = f.properties;
    _d3d.popup.setLngLat(e.lngLat).setHTML(
      `<b>${esc(p.name)}</b><br>${p.geschosse} Geschoss${p.geschosse === 1 ? '' : 'e'} · ${p.hoehe} m`
      + (p.baujahr ? `<br>Baujahr ${p.baujahr}` : '')).addTo(karte);
  });
  karte.getCanvas().addEventListener('mouseleave', () => {
    hoverAus();
    karte.getCanvas().style.cursor = '';
    _d3d?.popup?.remove();
  });
  // Netze ändern sich auch ohne updateViz (Netzberechnung, Kabelauslegung,
  // Farbmodus der Leitungen) — solange die Ansicht offen ist, jede Sekunde abgleichen.
  _d3d.netzTimer = setInterval(() => d3dNetzAktualisieren(), 1000);
  // Klick = Gebäude auf der Arbeitskarte auswählen
  karte.on('click', e => {
    const f = karte.queryRenderedFeatures(e.point, { layers: ['d3d-geb', 'd3d-geist'] })[0];
    if (!f || typeof window.selectFromMap !== 'function') return;
    window.selectFromMap(f.properties.gid);
    d3dAktualisieren();
  });
}

export function d3dSchliessen() {
  if (!_d3d) return;
  const { el, ml, ro, raf, netzTimer } = _d3d;
  if (netzTimer) clearInterval(netzTimer);
  // Ausschnitt an die Arbeitskarte zurückgeben (Neigung/Drehung bleiben in 3D)
  if (ml && window.map?.setView) {
    try {
      const c = ml.getCenter();
      window.map.setView([c.lat, c.lng], Math.round(d3dZoomNachLeaflet(ml.getZoom())), { animate: false });
    } catch (e) { void e; }
  }
  if (raf) cancelAnimationFrame(raf);
  if (ro) ro.disconnect();
  try { ml?.remove(); } catch (e) { void e; }   // WebGL-Kontext freigeben
  el.remove();
  _d3d = null;
  d3dKopfknopf(false);
  setTimeout(() => window.map?.invalidateSize?.(), 50);
}

export function d3dUmschalten() {
  if (_d3d) d3dSchliessen(); else d3dOeffnen();
}

export function d3dIstOffen() { return !!_d3d; }

/** Die MapLibre-Karte der offenen 3D-Ansicht (oder null) — für Bildexporte/Prüfungen. */
export function d3dKarte() { return _d3d?.ml || null; }

/** Haken aus updateViz(): Farben/Status der Arbeitskarte übernehmen. */
export function d3dNachViz() {
  if (_d3d) d3dAktualisieren();
}

/* ── Bedienung ────────────────────────────────────────────────────────────── */

function d3dAnwenden() {
  const ml = _d3d?.ml;
  if (!ml || !ml.getLayer('d3d-geb')) return;
  const h = ['*', ['get', 'hoehe'], _d3d.faktor];
  ml.setPaintProperty('d3d-geb', 'fill-extrusion-color', d3dFarbe(_d3d.modus));
  ml.setPaintProperty('d3d-geb', 'fill-extrusion-height', h);
  ml.setPaintProperty('d3d-geb', 'fill-extrusion-opacity', _d3d.glas ? D3D_GLAS : 0.93);
  ml.setPaintProperty('d3d-geist', 'fill-extrusion-height', h);
  d3dSzeneSetzen();   // Dächer/Module: Farbe der Giebel und Überhöhung hängen mit dran
  d3dBaumSzeneSetzen();
  d3dNetzAktualisieren();
  d3dLegende();
}

function d3dAlleEinpassen(dauer = 900) {
  const ml = _d3d?.ml;
  const b = d3dGrenzen(d3dDaten());
  if (!ml || !b) return;
  ml.fitBounds(b, { padding: { top: 60, bottom: 60, left: 270, right: 60 }, pitch: ml.getPitch(), bearing: ml.getBearing(), duration: dauer, maxZoom: 18 });
}

function d3dHintergrund(sat) {
  const ml = _d3d?.ml;
  if (!ml) return;
  _d3d.sat = sat;
  ml.setLayoutProperty('d3d-osm', 'visibility', sat ? 'none' : 'visible');
  ml.setLayoutProperty('d3d-esri', 'visibility', sat ? 'visible' : 'none');
  const panel = document.getElementById('d3d-panel');
  if (panel) { panel.innerHTML = d3dPanelHtml(); d3dLegende(); }
}

function d3dPng() {
  const ml = _d3d?.ml;
  if (!ml) return;
  // Ohne preserveDrawingBuffer ist der Puffer nur im selben Frame lesbar —
  // deshalb im render-Ereignis eines frisch angestoßenen Frames auslesen.
  ml.once('render', () => {
    try {
      const a = document.createElement('a');
      a.download = `3d-ansicht-${new Date().toISOString().slice(0, 10)}.png`;
      a.href = ml.getCanvas().toDataURL('image/png');
      a.click();
    } catch (e) {
      window.showHint?.('Bild konnte nicht erzeugt werden: ' + (e?.message || e), 5000);
    }
  });
  ml.triggerRepaint();
}

function d3dKlickImPanel(ev) {
  const t = ev.target.closest('[data-d3d]');
  if (!t || !_d3d) return;
  const ml = _d3d.ml;
  switch (t.dataset.d3d) {
    case 'schliessen': d3dSchliessen(); break;
    case '2d': ml?.easeTo({ pitch: 0, bearing: 0, duration: 800 }); break;
    case '3d': ml?.easeTo({ pitch: D3D_NEIGUNG, duration: 800 }); break;
    case 'links': ml?.easeTo({ bearing: ml.getBearing() - 45, duration: 600 }); break;
    case 'rechts': ml?.easeTo({ bearing: ml.getBearing() + 45, duration: 600 }); break;
    case 'alle': d3dAlleEinpassen(); break;
    case 'karte': d3dHintergrund(false); break;
    case 'sat': d3dHintergrund(true); break;
    case 'png': d3dPng(); break;
  }
}

function d3dEingabeImPanel(ev) {
  const t = ev.target.closest('[data-d3d]');
  if (!t || !_d3d) return;
  if (t.dataset.d3d === 'modus') { _d3d.modus = t.value; d3dAnwenden(); }
  if (t.dataset.d3d === 'daecher') { _d3d.daecher = t.value; d3dAnwenden(); }
  if (t.dataset.d3d === 'module' && ev.type === 'change') { _d3d.module = !!t.checked; d3dAnwenden(); }
  if (t.dataset.d3d === 'schatten' && ev.type === 'change') { _d3d.schatten = !!t.checked; if (_d3d.schatten) _d3d.module = true; d3dAnwenden(); }
  if (t.dataset.d3d === 'glas' && ev.type === 'change') { _d3d.glas = !!t.checked; d3dAnwenden(); }
  if (t.dataset.d3d === 'baeume' && ev.type === 'change') {
    _baumAn = !!t.checked;
    if (_baumAn && (!_d3d.baumErgebnis || _d3d.baumStatus === 'fehler')) d3dBaeumeLaden();
    d3dBaumSzeneSetzen();
    d3dBaumInfo();
    d3dLegende();
  }
  if ((t.dataset.d3d === 'netzW' || t.dataset.d3d === 'netzS') && ev.type === 'change') {
    _d3d[t.dataset.d3d] = !!t.checked;
    d3dNetzAktualisieren();
    d3dLegende();
  }
  if (t.dataset.d3d === 'faktor') {
    _d3d.faktor = Math.max(1, Math.min(3, +t.value || 1));
    const z = document.getElementById('d3d-faktor');
    if (z) z.textContent = _d3d.faktor.toFixed(1).replace('.', ',');
    d3dAnwenden();
  }
}

// Für data-click im Kopf / Ansicht-Panel und den Haken in updateViz (Blatt-Modul:
// nicht auf die Export-Spiegelung in main.js verlassen).
window.d3dUmschalten = d3dUmschalten;
window.d3dNachViz = d3dNachViz;
window.d3dBaeumeNeu = d3dBaeumeNeu;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', d3dKartenknopf, { once: true });
} else {
  d3dKartenknopf();
}
