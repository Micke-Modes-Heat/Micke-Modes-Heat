// ── 13u-wind-restriktion.js — Karten-Layer für die Windanalyse ───────────────
// Drei umschaltbare Overlays über der bestehenden Leaflet-Karte:
//   1. Restriktionsflächen aus OpenStreetMap (Straßen, Bahntrassen, Freileitungen)
//      — je Objekt mit einem Abstands-Puffer als rote Ausschlusszone gezeichnet UND
//      als Ausschluss in die Eignungsfläche/Platzierung eingerechnet (13s).
//   2. Schutzgebiete als amtlicher WMS-Referenzlayer (BfN-Geodienste) — reine Anzeige.
//   3. Windressource-Overlay (z.B. Global Wind Atlas) als konfigurierbarer Kachel-/WMS-
//      Layer mit Deckkraft-Regler — reine Anzeige, Quelle per URL hinterlegbar.
//
// Alles ist Screening-Unterstützung: die Abstände sind Faustwerte (Land-/Einzelfall-
// abhängig), die Layer ersetzen keine fachrechtliche Prüfung.

import { map } from './02b-gebaeude.js';
import { _overpassFetchWithRetry } from './03b-netz.js';
import { ASSETS } from './13a-assets-core.js';
import { _WINDA_KLASSEN } from './13t-wind-analyse.js';

// ── Restriktions-Kategorien: OSM-Filter, Farbe ───────────────────────────────
// Die Abstände sind HÖHENABHÄNGIG (Kipphöhe = Nabenhöhe + Rotor/2) bzw. rotorabhängig
// und werden aus einer Referenzanlage abgeleitet — im Panel editierbar (Faustwerte,
// Land-/Einzelfallabhängig):
//   • Straße: Kipphöhe (Umsturz-/Rotorblattwurf-Abstand; Anbauverbotszone bleibt Einzelfall)
//   • Bahn:   Kipphöhe (DB-Schutzstreifen kann höher liegen)
//   • Freileitung: 1× Rotordurchmesser (mit Schwingungsschutz; ohne: 3× Ø)
const _RESTRIKT_CFG = {
  gebaeude: { label: 'Gebäude / Wohnbebauung',                 color: '#42a5f5',
              overpass: 'way["building"]', flaeche: true },
  strasse:  { label: 'Straßen (Autobahn/Bundes-/Landstraße)', color: '#ff7043',
              overpass: 'way["highway"~"^(motorway|trunk|primary|secondary)$"]' },
  bahn:     { label: 'Bahntrassen',                            color: '#ab47bc',
              overpass: 'way["railway"="rail"]' },
  leitung:  { label: 'Hochspannungs-Freileitungen',           color: '#ffca28',
              overpass: 'way["power"="line"]' },
};

// Feste Standard-Quelle für das Windressource-Overlay: Global Wind Atlas (DTU, CC BY 4.0),
// mittlere Windgeschwindigkeit auf 100 m, ~250-m-Raster. Der GWA-titiler liefert die
// COGs auf Anfrage als PNG (rescale = Skala in m/s, colormap = Farbverlauf) und sendet
// „Access-Control-Allow-Origin: *", lädt also auch aus dem Browser/file://.
// Andere Höhen: ws_mean_hgt{10|50|100|150|200}m. Über „⚙ Quelle" jederzeit überschreibbar.
const GWA_DEFAULT_URL =
  'https://tiles-stag.ramtt.xyz/titiler/gwa4_3857/ws_mean_hgt100m/tiles/WebMercatorQuad/{z}/{x}/{y}.png?rescale=3,11&colormap_name=turbo';

// Referenz-Geometrie für die Abstandsableitung (aus der größten Windanlage im Projekt,
// sonst Defaults). Kipphöhe = Nabenhöhe + Rotor/2.
function _defaultRestriktRef() {
  let kip = 0, rot = 0;
  for (const a of (ASSETS.items || [])) {
    if (a.type !== 'Wind') continue;
    const p = a.props || {};
    const rd = parseFloat(p.rotordurchmesserM) || 0;
    const nh = parseFloat(p.nabenhoheM) || 0;
    if (rd > rot) rot = rd;
    if (nh + rd / 2 > kip) kip = nh + rd / 2;
  }
  return { gesamthoehe: kip > 0 ? Math.round(kip) : 180, rotorD: rot > 0 ? Math.round(rot) : 120 };
}
function _setbacksFromRef(ref) {
  return {
    gebaeude: Math.round(ref.gesamthoehe),   // Kipphöhe als Minimum — Wohnbebauung braucht i.d.R. mehr (Immissionsschutz)
    strasse:  Math.round(ref.gesamthoehe),   // Kipphöhe
    bahn:     Math.round(ref.gesamthoehe),   // Kipphöhe
    leitung:  Math.round(ref.rotorD),        // 1× Rotor-Ø
  };
}

// Amtlicher Schutzgebiete-WMS (BfN). Layer-Namen/URL zentral hinterlegt und leicht
// anpassbar, falls sich der Dienst ändert.
// Layer-Namen exakt wie in der BfN-GetCapabilities (ein falscher Name lässt die ganze
// GetMap-Antwort per ServiceException scheitern → „antwortet nicht"). Verfügbar wären u.a.
// auch Naturparke, Landschaftsschutzgebiete, Nationale_Naturmonumente.
const _SCHUTZ_WMS_URL   = 'https://geodienste.bfn.de/ogc/wms/schutzgebiet';
const _SCHUTZ_WMS_LAYERS = 'Nationalparke,Naturschutzgebiete,Biosphaerenreservate,Vogelschutzgebiete,Fauna_Flora_Habitat_Gebiete';

// ── State ────────────────────────────────────────────────────────────────────
let _restriktLayer = null;       // L.featureGroup mit Linien + Pufferpolygonen
let _restriktRings = [];         // Pufferpolygone als {lat,lng}[] — Ausschluss für 13s
let _restriktStatus = '';
let _restriktLoading = false;
let _restriktRef = null;         // { gesamthoehe, rotorD } — lazy aus Projekt abgeleitet
let _restriktSetbacks = null;    // { strasse, bahn, leitung } — aus Referenz abgeleitet
let _restriktTypId = null;       // gewählter Windradtyp (_WINDA_KLASSEN.id) oder null = manuell

// Referenz + Abstände lazy initialisieren (erst wenn das Panel gerendert wird und die
// Assets feststehen). Danach bleiben manuelle Overrides erhalten.
function _ensureRestriktInit() {
  if (!_restriktRef) {
    _restriktRef = _defaultRestriktRef();
    _restriktSetbacks = _setbacksFromRef(_restriktRef);
  }
}

let _schutzLayer = null;
let _gwaLayer = null;
let _gwaUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('windGwaUrl')) || GWA_DEFAULT_URL || null;
let _gwaOpacity = 0.6;
// Hover-Wert (zonale Statistik am Cursor) — nur für GWA-titiler-Quellen aktiv
let _gwaStatsUrl = null;
let _gwaHoverTip = null;
let _gwaHoverTimer = null;
let _gwaHoverAbort = null;
let _gwaHoverSeq = 0;

function _rerender() { if (typeof window.windaRenderPanel === 'function') window.windaRenderPanel(); }

// Bounding-Box (s,w,n,e) aus dem maßgeblichen Gebiet (Windgebiet > Plangebiet)
function _gebietBounds() {
  const poly = window.windGebietPolygon || window.areaPolygon;
  if (poly && typeof poly.getBounds === 'function') {
    const b = poly.getBounds();
    if (b && b.isValid && b.isValid()) return b;
  }
  return null;
}

// ── Puffer eines Liniensegments zu einem Rechteck-Ring (Abstand s in Metern) ──
// Der Puffer wird längs und quer um s erweitert → aneinandergereihte Rechtecke bilden
// einen Korridor. Grobe, aber robuste Näherung (kein exaktes Offsetting).
function _bufferSegmentRing(a, b, s) {
  const midLat = (a.lat + b.lat) / 2;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((midLat * Math.PI) / 180);
  const ax = a.lng * mPerLng, ay = a.lat * mPerLat;
  const bx = b.lng * mPerLng, by = b.lat * mPerLat;
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const px = -dy, py = dx;          // Quer-Richtung
  const ex = dx * s, ey = dy * s;   // Längs-Verlängerung
  const ox = px * s, oy = py * s;   // Quer-Offset
  const cM = [
    [ax - ex + ox, ay - ey + oy],
    [bx + ex + ox, by + ey + oy],
    [bx + ex - ox, by + ey - oy],
    [ax - ex - ox, ay - ey - oy],
  ];
  return cM.map(([x, y]) => ({ lat: y / mPerLat, lng: x / mPerLng }));
}

// ── OSM-Restriktionsdaten laden + zeichnen ───────────────────────────────────
window.windRestriktLoad = async function () {
  if (_restriktLoading) return;
  _ensureRestriktInit();
  const b = _gebietBounds();
  if (!b) {
    _restriktStatus = '⚠ Kein Wind-/Plangebiet gezeichnet — oben ein Gebiet festlegen.';
    _rerender();
    return;
  }
  // Abstände aus den (ggf. manuell überschriebenen) Panel-Feldern übernehmen
  for (const key of Object.keys(_RESTRIKT_CFG)) {
    const v = parseFloat(document.getElementById('winrx-' + key)?.value);
    if (v > 0) _restriktSetbacks[key] = v;
  }

  const s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
  const bbox = `${s},${w},${n},${e}`;
  const parts = Object.values(_RESTRIKT_CFG).map(c => `${c.overpass}(${bbox});`).join('\n  ');
  const query = `[out:json][timeout:25];\n(\n  ${parts}\n);\nout geom;`;

  _restriktLoading = true;
  _restriktStatus = '⏳ Lade Infrastruktur aus OpenStreetMap …';
  _rerender();

  let data = null;
  try { data = await _overpassFetchWithRetry(query); }
  catch (err) { _restriktStatus = '✗ OSM-Abruf fehlgeschlagen: ' + err.message; }

  _restriktLoading = false;
  if (!data || !data.elements) {
    _restriktStatus = _restriktStatus.startsWith('✗') ? _restriktStatus : '✗ Keine OSM-Daten erhalten (offline?).';
    _rerender();
    return;
  }
  _drawRestrikt(data.elements);
  _rerender();
  // Eignungsflächen/Platzierung neu rechnen, damit die Ausschlüsse einfließen
  if (typeof window.refreshWindEignungAll === 'function') window.refreshWindEignungAll();
};

function _catForElement(tags) {
  if (!tags) return null;
  if (tags.building) return 'gebaeude';
  if (tags.highway)  return 'strasse';
  if (tags.railway)  return 'bahn';
  if (tags.power)    return 'leitung';
  return null;
}

// Kreisförmiger Puffer-Ring (n-Eck) um einen Punkt — für Gebäude (Fläche statt Linie).
function _circleRing(lat, lng, radiusM, n = 16) {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push({ lat: lat + (radiusM * Math.sin(a)) / mPerLat, lng: lng + (radiusM * Math.cos(a)) / mPerLng });
  }
  return ring;
}

function _drawRestrikt(elements) {
  if (_restriktLayer) { map.removeLayer(_restriktLayer); _restriktLayer = null; }
  _restriktRings = [];
  const group = L.featureGroup();
  const counts = { gebaeude: 0, strasse: 0, bahn: 0, leitung: 0 };

  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const cat = _catForElement(el.tags);
    if (!cat) continue;
    const cfg = _RESTRIKT_CFG[cat];
    const setback = _restriktSetbacks[cat] || 100;
    const pts = el.geometry.map(g => ({ lat: g.lat, lng: g.lon }));
    counts[cat]++;

    if (cfg.flaeche) {
      // Gebäude: Grundriss + kreisförmige Puffer-Zone (Schwerpunkt + Gebäuderadius + Abstand)
      let sLat = 0, sLng = 0;
      for (const p of pts) { sLat += p.lat; sLng += p.lng; }
      const cLat = sLat / pts.length, cLng = sLng / pts.length;
      const mPerLng = 111320 * Math.cos((cLat * Math.PI) / 180);
      let bR = 0;
      for (const p of pts) {
        const dy = (p.lat - cLat) * 111320, dx = (p.lng - cLng) * mPerLng;
        bR = Math.max(bR, Math.hypot(dx, dy));
      }
      const ring = _circleRing(cLat, cLng, bR + setback);
      _restriktRings.push(ring);
      L.polygon(ring.map(p => [p.lat, p.lng]), {
        color: cfg.color, weight: 0, fillColor: cfg.color, fillOpacity: 0.14, interactive: false,
      }).addTo(group);
      L.polygon(pts.map(p => [p.lat, p.lng]), {
        color: cfg.color, weight: 1, opacity: 0.7, fill: false, interactive: false,
      }).addTo(group);
      continue;
    }

    // Linien-Infrastruktur: Mittellinie + Puffer-Korridor je Segment
    L.polyline(pts.map(p => [p.lat, p.lng]), { color: cfg.color, weight: 2, opacity: 0.7, interactive: false }).addTo(group);
    for (let i = 0; i < pts.length - 1; i++) {
      const ring = _bufferSegmentRing(pts[i], pts[i + 1], setback);
      _restriktRings.push(ring);
      L.polygon(ring.map(p => [p.lat, p.lng]), {
        color: cfg.color, weight: 0, fillColor: cfg.color, fillOpacity: 0.16, interactive: false,
      }).addTo(group);
    }
  }

  group.addTo(map);
  _restriktLayer = group;
  const total = counts.gebaeude + counts.strasse + counts.bahn + counts.leitung;
  _restriktStatus = total
    ? `✓ ${total} Objekte: ${counts.gebaeude}× Gebäude · ${counts.strasse}× Straße · ${counts.bahn}× Bahn · ${counts.leitung}× Leitung`
    : 'Keine Gebäude/Straßen/Bahn/Leitungen im Gebiet gefunden.';
}

window.windRestriktToggle = function () {
  if (!_restriktLayer) return;
  if (map.hasLayer(_restriktLayer)) map.removeLayer(_restriktLayer);
  else _restriktLayer.addTo(map);
  _rerender();
};

window.windRestriktClear = function () {
  if (_restriktLayer) { map.removeLayer(_restriktLayer); _restriktLayer = null; }
  _restriktRings = [];
  _restriktStatus = '';
  _rerender();
  if (typeof window.refreshWindEignungAll === 'function') window.refreshWindEignungAll();
};

// Windradtyp wählen → Gesamthöhe (Kipphöhe = Nabenhöhe + Rotor/2) und Rotor-Ø aus der
// Klasse übernehmen und die Abstände daraus ableiten.
window.windRestriktSelectTyp = function (id) {
  _ensureRestriktInit();
  if (!id) { _restriktTypId = null; _rerender(); return; }
  const k = _WINDA_KLASSEN.find(x => x.id === id);
  if (!k) return;
  _restriktTypId = id;
  _restriktRef = { gesamthoehe: Math.round(k.nabenhoehe + k.rotorD / 2), rotorD: Math.round(k.rotorD) };
  _restriktSetbacks = _setbacksFromRef(_restriktRef);
  _rerender();
};

// Abstände aus Referenz-Gesamthöhe (Kipphöhe) + Rotor-Ø neu ableiten und die
// Abstandsfelder überschreiben. Manuelles Ändern hebt die Typ-Bindung auf.
window.windRestriktDeriveSetbacks = function () {
  _ensureRestriktInit();
  const h = parseFloat(document.getElementById('winrx-hoehe')?.value);
  const r = parseFloat(document.getElementById('winrx-rotor')?.value);
  if (h > 0) _restriktRef.gesamthoehe = h;
  if (r > 0) _restriktRef.rotorD = r;
  _restriktTypId = null; // manuell
  _restriktSetbacks = _setbacksFromRef(_restriktRef);
  _rerender();
};

// Für 13s/13b/13t: Pufferpolygone als Ausschluss (nur wenn Layer geladen & sichtbar)
export function getWindRestriktRings() {
  if (!_restriktLayer || !map.hasLayer(_restriktLayer)) return [];
  return _restriktRings;
}

// ── Schutzgebiete-WMS (BfN) ──────────────────────────────────────────────────
window.windSchutzToggle = function () {
  if (_schutzLayer) {
    map.removeLayer(_schutzLayer);
    _schutzLayer = null;
    _rerender();
    return;
  }
  _schutzLayer = L.tileLayer.wms(_SCHUTZ_WMS_URL, {
    layers: _SCHUTZ_WMS_LAYERS, format: 'image/png', transparent: true,
    opacity: 0.5, version: '1.3.0', attribution: '© BfN', pane: 'overlayPane',
  });
  _schutzLayer.on('tileerror', () => {
    _restriktStatus = '⚠ Schutzgebiete-WMS antwortet nicht (Dienst/Layer-Name prüfen).';
    _rerender();
  });
  _schutzLayer.addTo(map);
  _rerender();
};

// ── Windressource-Overlay (Global Wind Atlas o.ä.) ───────────────────────────
// Standard: GWA-titiler (s. GWA_DEFAULT_URL). Für GWA-titiler-Quellen wird zusätzlich
// der Rasterwert am Cursor per zonaler Statistik (/statistics-POST) als Tooltip gezeigt.
window.windGwaToggle = function () {
  if (_gwaLayer) {
    map.removeLayer(_gwaLayer);
    _gwaLayer = null;
    _gwaDisableHover();
    _rerender();
    return;
  }
  if (!_gwaUrl) {
    // Kein Prompt mehr — die feste Quelle wird einmalig über „⚙ Quelle" gesetzt und
    // in localStorage gemerkt (bleibt danach über Reloads hinweg fest hinterlegt).
    _restriktStatus = 'ℹ Keine Windressource-Quelle hinterlegt — mit „⚙ Quelle" eine XYZ-/WMS-URL setzen (wird dauerhaft gemerkt).';
    _rerender();
    return;
  }
  try {
    const isGwa = /ramtt|globalwindatlas/.test(_gwaUrl);
    const attribution = isGwa ? 'Global Wind Atlas © DTU (CC BY 4.0)' : 'Windressource';
    if (/\{z\}|\{x\}|\{y\}/.test(_gwaUrl)) {
      // GWA-Raster ist ~250 m — ab z12 hochskalieren statt leere Detail-Kacheln anzufragen.
      _gwaLayer = L.tileLayer(_gwaUrl, { opacity: _gwaOpacity, maxZoom: 21, maxNativeZoom: isGwa ? 12 : undefined, attribution });
    } else {
      _gwaLayer = L.tileLayer.wms(_gwaUrl, { format: 'image/png', transparent: true, opacity: _gwaOpacity, attribution });
    }
    _gwaLayer.on('tileerror', () => {
      _restriktStatus = '⚠ Windressource-Kachelquelle antwortet nicht (URL prüfen).';
      _rerender();
    });
    _gwaLayer.addTo(map);
    _gwaEnableHover();
  } catch (e) {
    alert('Kachelquelle konnte nicht geladen werden: ' + e.message);
    _gwaLayer = null;
  }
  _rerender();
};

// ── Hover-Wert am Cursor (nur GWA-titiler) ───────────────────────────────────
// Aus der Kachel-URL die zonale-Statistik-URL ableiten: …/<layer>/tiles/…  →  …/<layer>/statistics
function _deriveGwaStatsUrl(tileUrl) {
  if (!tileUrl || !/ramtt|titiler/.test(tileUrl)) return null;
  const i = tileUrl.indexOf('/tiles/');
  return i > 0 ? tileUrl.slice(0, i) + '/statistics' : null;
}

function _gwaEnableHover() {
  _gwaStatsUrl = _deriveGwaStatsUrl(_gwaUrl);
  if (!_gwaStatsUrl) return;
  map.on('mousemove', _gwaOnMove);
  map.on('mouseout', _gwaHideTip);
}

function _gwaDisableHover() {
  map.off('mousemove', _gwaOnMove);
  map.off('mouseout', _gwaHideTip);
  clearTimeout(_gwaHoverTimer);
  if (_gwaHoverAbort) { try { _gwaHoverAbort.abort(); } catch (e) {} _gwaHoverAbort = null; }
  _gwaHideTip();
  _gwaStatsUrl = null;
}

function _gwaHideTip() {
  if (_gwaHoverTip) { map.removeLayer(_gwaHoverTip); _gwaHoverTip = null; }
}

function _gwaOnMove(e) {
  if (!_gwaStatsUrl) return;
  const ll = e.latlng;
  if (!_gwaHoverTip) {
    _gwaHoverTip = L.tooltip({ direction: 'right', offset: [14, 0], opacity: 0.95, className: 'gwa-hover-tip' });
  }
  _gwaHoverTip.setLatLng(ll).setContent('💨 …').addTo(map);
  clearTimeout(_gwaHoverTimer);
  _gwaHoverTimer = setTimeout(() => _gwaFetchValue(ll), 160);
}

async function _gwaFetchValue(ll) {
  if (!_gwaStatsUrl) return;
  const seq = ++_gwaHoverSeq;
  if (_gwaHoverAbort) { try { _gwaHoverAbort.abort(); } catch (e) {} }
  _gwaHoverAbort = new AbortController();
  const d = 0.0004; // ~45 m Halbkante — 1 Rasterzelle
  const gj = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
    [ll.lng - d, ll.lat - d], [ll.lng + d, ll.lat - d], [ll.lng + d, ll.lat + d], [ll.lng - d, ll.lat + d], [ll.lng - d, ll.lat - d],
  ]] } };
  try {
    const res = await fetch(_gwaStatsUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gj), signal: _gwaHoverAbort.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (seq !== _gwaHoverSeq || !_gwaHoverTip) return; // veraltet / Tooltip weg
    const mean = j?.properties?.statistics?.b1?.mean;
    _gwaHoverTip.setContent(
      (mean != null && isFinite(mean))
        ? `💨 <b>${mean.toFixed(1).replace('.', ',')} m/s</b> <span style="opacity:.7;">Ø 100 m</span>`
        : '💨 keine Daten');
  } catch (e) {
    if (e.name !== 'AbortError' && seq === _gwaHoverSeq && _gwaHoverTip) _gwaHoverTip.setContent('💨 —');
  }
}

window.windGwaSetUrl = function () {
  const inp = prompt(
    'Windressource-Kachelquelle (fester Link, wird gemerkt):\n' +
    '• XYZ-Kacheln mit {z}/{x}/{y}, oder\n' +
    '• WMS-Basis-URL (…?SERVICE=WMS…).\n\n' +
    'Hinweis: Global Wind Atlas bietet keinen Kachel-Dienst (nur GeoTIFF-Download).',
    _gwaUrl || 'https://');
  if (inp == null) return;
  _gwaUrl = inp.trim() || null;
  try {
    if (_gwaUrl) localStorage.setItem('windGwaUrl', _gwaUrl);
    else localStorage.removeItem('windGwaUrl');
  } catch (e) { /* localStorage nicht verfügbar — nur Session */ }
  if (_gwaLayer) { map.removeLayer(_gwaLayer); _gwaLayer = null; _gwaDisableHover(); }
  if (_gwaUrl) window.windGwaToggle();
  _rerender();
};

window.windGwaOpacity = function (v) {
  _gwaOpacity = Math.max(0, Math.min(1, parseFloat(v) || 0.6));
  if (_gwaLayer && _gwaLayer.setOpacity) _gwaLayer.setOpacity(_gwaOpacity);
};

// ── Panel-Abschnitt (HTML) für die Windanalyse ───────────────────────────────
export function windRestriktBlock() {
  _ensureRestriktInit();
  const on = _restriktLayer && map.hasLayer(_restriktLayer);
  const setInputs = Object.entries(_RESTRIKT_CFG).map(([key, cfg]) => `
    <div>
      <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cfg.color};margin-right:3px;"></span>${cfg.label.split(' (')[0]} (m)
      </div>
      <input id="winrx-${key}" type="number" value="${_restriktSetbacks[key]}" min="0" step="10"
        style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"/>
    </div>`).join('');

  // Höhenabhängige Referenz: Windradtyp wählen → Kipphöhe + Rotor-Ø → Abstände.
  const typOpts = _WINDA_KLASSEN.map(k => {
    const gh = Math.round(k.nabenhoehe + k.rotorD / 2);
    return `<option value="${k.id}" ${_restriktTypId === k.id ? 'selected' : ''}>${k.label.split(' · ')[0]} · ${(k.ratedKw / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MW · ${gh} m Gesamthöhe</option>`;
  }).join('');
  const refInputs = `
    <div style="margin-bottom:6px;">
      <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Windradtyp (setzt Kipphöhe &amp; Rotor)</div>
      <select id="winrx-typ" onchange="windRestriktSelectTyp(this.value)"
        style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;">
        <option value="" ${_restriktTypId ? '' : 'selected'}>— manuell / aus Projekt —</option>
        ${typOpts}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
      <div>
        <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Gesamthöhe / Kipphöhe (m)</div>
        <input id="winrx-hoehe" type="number" value="${_restriktRef.gesamthoehe}" min="1" step="5"
          onchange="windRestriktDeriveSetbacks()"
          style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"/>
      </div>
      <div>
        <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Rotordurchmesser (m)</div>
        <input id="winrx-rotor" type="number" value="${_restriktRef.rotorD}" min="1" step="5"
          onchange="windRestriktDeriveSetbacks()"
          style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"/>
      </div>
    </div>`;

  const schutzOn = !!_schutzLayer;
  const gwaOn = !!_gwaLayer;

  return `
    <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px;">🗺 Karten-Layer</div>

    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:6px;">🚧 Restriktionsflächen (OpenStreetMap)</div>
      ${refInputs}
      <div style="font-size:8px;color:var(--muted);margin:-2px 0 4px;">↓ Abstände aus Höhe/Rotor abgeleitet (Gebäude/Straße/Bahn = Kipphöhe, Leitung = 1× Rotor-Ø) — manuell überschreibbar:</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">${setInputs}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <button class="ins-link-btn" onclick="windRestriktLoad()" ${_restriktLoading ? 'disabled' : ''} style="margin:0;">${_restriktLayer ? '↺ Neu laden' : '⬇ Laden & puffern'}</button>
        ${_restriktLayer ? `<button class="ins-link-btn" onclick="windRestriktToggle()" style="margin:0;">${on ? '👁 ausblenden' : '👁 einblenden'}</button>` : ''}
        ${_restriktLayer ? `<button class="ins-link-btn" onclick="windRestriktClear()" style="margin:0;color:#ef9a9a;">✕ löschen</button>` : ''}
      </div>
      ${_restriktStatus ? `<div style="font-size:9px;color:${_restriktStatus.startsWith('✓') ? '#4dd0e1' : _restriktStatus.startsWith('⏳') ? '#4dd0e1' : '#f9a825'};margin-top:5px;">${_restriktStatus}</div>` : ''}
      <div style="font-size:8px;color:#607d8b;margin-top:4px;">Abstände sind höhenabhängige Faustwerte (Land-/Einzelfallabhängig; Wohnbebauung braucht i.d.R. deutlich mehr als die Kipphöhe, Leitung ohne Schwingungsschutz bis 3× Rotor-Ø). Sichtbare Restriktionsflächen werden als Ausschluss in Eignungsfläche &amp; Platzierungsvorschläge eingerechnet.</div>
    </div>

    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;font-weight:600;color:var(--text);flex:1;">🌿 Schutzgebiete (BfN-WMS)</span>
        <button class="ins-link-btn" onclick="windSchutzToggle()" style="margin:0;">${schutzOn ? '👁 aus' : '👁 ein'}</button>
      </div>
      <div style="font-size:8px;color:#607d8b;margin-top:4px;">Amtliche Referenz: Nationalparke, NSG, Biosphärenreservate, FFH/Natura 2000, Vogelschutz. Reine Anzeige, keine Berechnung.</div>
    </div>

    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;font-weight:600;color:var(--text);flex:1;">💨 Windressource-Overlay</span>
        <button class="ins-link-btn" onclick="windGwaSetUrl()" style="margin:0;">⚙ Quelle</button>
        <button class="ins-link-btn" onclick="windGwaToggle()" style="margin:0;">${gwaOn ? '👁 aus' : '👁 ein'}</button>
      </div>
      ${gwaOn ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
        <span style="font-size:8px;color:var(--muted);">Deckkraft</span>
        <input type="range" min="0" max="1" step="0.05" value="${_gwaOpacity}" oninput="windGwaOpacity(this.value)" style="flex:1;"/>
      </div>` : ''}
      <div style="font-size:8px;color:#607d8b;margin-top:4px;">Vorbelegt: Global Wind Atlas — Ø Windgeschw. 100 m (~250-m-Raster, DTU, CC BY 4.0). Farbskala 3–11 m/s. Bei aktivem Overlay zeigt ein Cursor-Tooltip den Windwert am Punkt. Über „⚙ Quelle" auf andere Höhe/eigene XYZ-/WMS-URL änderbar.</div>
    </div>`;
}

// Window-Bridge (analog zu den übrigen Wind-Modulen)
setTimeout(() => {
  window.getWindRestriktRings = getWindRestriktRings;
  window.windRestriktBlock    = windRestriktBlock;
}, 0);
