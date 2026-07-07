// ── 13m-kompaktstation.js — Standardgebäude (Gebäude + Elektro-Assets) platzieren ──
// Trafostationen (kompakt/begehbar), Übergabestation, Batteriespeicher, NEA,
// Energiezentrale, Ladepark — je ein Gebäude-Polygon plus fertig verkabelte Assets.

import { map, addGebaeude } from './02b-gebaeude.js';
import { createAsset } from './13a-assets-core.js';
import { drawAssetMarker, setAssetLayerVisible } from './13b-assets-render.js';
import { addStromEdge, recalcStromNetz } from './05b-stromnetz.js';
import { showHint } from './03c-gebaeude-io.js';

// ── Standard-Leistungen ───────────────────────────────────────────────────────
const TRAFO_KVA = [100, 160, 250, 315, 400, 500, 630, 800, 1000, 1250];

// ── Konfigurationspresets ─────────────────────────────────────────────────────
// gruppe: Überschrift im Auswahl-Dialog. params: kontextabhängige Eingabefelder —
// 'kva' rendert die Trafo-Leistungsauswahl, alles andere ein Zahlenfeld.
const P_KVA = { key: 'kva', label: 'Trafo-Leistung', typ: 'kva', default: 630 };

const PRESETS = {
  einfach: {
    label: 'Einfachstation',
    desc: 'SA + 1× Trafo + NSHV',
    widthM: 3.5, heightM: 9.0,
    gruppe: 'Trafostationen (kompakt)', params: [P_KVA],
  },
  doppel: {
    label: 'Doppelstation',
    desc: 'SA + 2× Trafo + NSHV',
    widthM: 5.0, heightM: 11.0,
    gruppe: 'Trafostationen (kompakt)', params: [P_KVA],
  },
  einspeise: {
    label: 'Einspeise-Station (PV/Wind)',
    desc: 'SA + 1× Trafo (Einspeisung) + NSHV',
    widthM: 3.5, heightM: 9.0,
    gruppe: 'Trafostationen (kompakt)', params: [P_KVA],
  },
  mitUV: {
    label: 'Station mit UV',
    desc: 'SA + 1× Trafo + NSHV + UV',
    widthM: 4.0, heightM: 9.5,
    gruppe: 'Trafostationen (kompakt)', params: [P_KVA],
  },
  // Begehbare Stationen: eigenes Stationsgebäude mit Bedienraum — deutlich größere
  // Grundfläche als die Kompakt-Presets, gleiche elektrische Struktur.
  begehbar: {
    label: 'Trafostation (begehbar)',
    desc: 'SA + 1× Trafo + NSHV · Bedienraum',
    widthM: 6.0, heightM: 12.0,
    gebName: 'Trafostation',
    gruppe: 'Trafostationen (begehbar)', params: [P_KVA],
  },
  begehbarDoppel: {
    label: 'Doppel-Trafostation (begehbar)',
    desc: 'SA + 2× Trafo + NSHV · Bedienraum',
    widthM: 7.5, heightM: 14.0,
    gebName: 'Trafostation',
    gruppe: 'Trafostationen (begehbar)', params: [P_KVA],
  },
  uebergabe: {
    label: 'Übergabestation / NAP (begehbar)',
    desc: 'NAP + SA, wahlweise + Trafos + NSHV',
    widthM: 6.0, heightM: 10.0,
    gebName: 'Übergabestation',
    gruppe: 'Trafostationen (begehbar)',
    params: [
      { key: 'anzahlTrafos', label: 'Anz. Trafos (0 = ohne)', typ: 'num', default: 0, step: 1 },
      P_KVA,
    ],
  },
  // Weitere Standardgebäude mit typischer Elektro-Ausstattung
  batterie: {
    label: 'Batteriespeicher-Container',
    desc: 'Batterie, wahlweise + eigener Trafo · Anschluss an bestehende NSHV',
    widthM: 2.44, heightM: 12.19,   // Default 40-ft-Container, per Parameter änderbar
    gebName: 'Batteriespeicher',
    gruppe: 'Weitere Standardgebäude',
    params: [
      { key: 'kapazitaetKWh', label: 'Kapazität (kWh)', typ: 'num', default: 1000, step: 50 },
      { key: 'leistungKW',    label: 'Leistung (kW)',   typ: 'num', default: 500,  step: 25 },
      { key: 'container',     label: 'Containergröße',  typ: 'container', default: 'c40' },
      { key: 'kva',           label: 'Eigener Trafo',   typ: 'kvaOhne', default: 0 },
    ],
  },
  nea: {
    label: 'Netzersatzanlage (NEA-Container)',
    desc: 'Notstromaggregat · Anschluss an bestehende NSHV',
    widthM: 2.44, heightM: 6.06,    // Default 20-ft-Container, per Parameter änderbar
    gebName: 'NEA',
    gruppe: 'Weitere Standardgebäude',
    params: [
      { key: 'leistungKW', label: 'Leistung (kW)',  typ: 'num', default: 250, step: 25 },
      { key: 'autonomieH', label: 'Autonomie (h)',  typ: 'num', default: 24,  step: 1 },
      { key: 'container',  label: 'Containergröße', typ: 'container', default: 'c20' },
    ],
  },
  zentrale: {
    label: 'Energiezentrale (KWK)',
    desc: 'NSHV + KWK-Anlage (BHKW)',
    widthM: 8.0, heightM: 12.0,
    gebName: 'Energiezentrale',
    gruppe: 'Weitere Standardgebäude',
    params: [
      { key: 'leistungElKW', label: 'El. Leistung (kW)', typ: 'num', default: 200, step: 25 },
    ],
  },
  ladepark: {
    label: 'Ladepark-Station',
    desc: 'SA + Trafo + NSHV + Ladeinfrastruktur',
    widthM: 5.0, heightM: 11.0,
    gebName: 'Ladepark',
    gruppe: 'Weitere Standardgebäude',
    params: [
      P_KVA,
      { key: 'anzahlPunkte',       label: 'Anz. Ladepunkte', typ: 'num', default: 8,  step: 1 },
      { key: 'leistungProPunktKW', label: 'kW je Punkt',     typ: 'num', default: 22, step: 1 },
    ],
  },
};

// Stromkennzahl-Faktor für die Energiezentrale: th. Leistung ≈ 1,6 × el. Leistung
const KWK_TH_FAKTOR = 1.6;

// ISO-Standard-Containergrößen (Außenmaße) für NEA-/Batterie-Container
const CONTAINERS = {
  c10: { label: '10 ft (2,99 × 2,44 m)',  widthM: 2.44, heightM: 2.99 },
  c20: { label: '20 ft (6,06 × 2,44 m)',  widthM: 2.44, heightM: 6.06 },
  c40: { label: '40 ft (12,19 × 2,44 m)', widthM: 2.44, heightM: 12.19 },
};

// Effektive Gebäudemaße: Containergröße aus den Parametern schlägt die Preset-Maße
function _presetDims(p, vals) {
  const c = CONTAINERS[vals.container];
  return c ? { widthM: c.widthM, heightM: c.heightM } : { widthM: p.widthM, heightM: p.heightM };
}

// ── Vorschauzeile: welche Assets entstehen, in welcher Kette ─────────────────
function _previewText(key, vals) {
  const p = PRESETS[key];
  const kva = parseInt(vals.kva) || 630;
  const nT  = parseInt(vals.anzahlTrafos) || 0;
  const batTrafo = parseInt(vals.kva) > 0;
  const chain = {
    einfach:        `⊞ SA → 🔁 Trafo ${kva} kVA → 🗄 NSHV`,
    doppel:         `⊞ SA → 🔁 2× Trafo ${kva} kVA → 🗄 NSHV`,
    einspeise:      `⊞ SA → 🔁 Trafo ${kva} kVA (Einspeisung) → 🗄 NSHV`,
    mitUV:          `⊞ SA → 🔁 Trafo ${kva} kVA → 🗄 NSHV → 📦 UV`,
    begehbar:       `⊞ SA → 🔁 Trafo ${kva} kVA → 🗄 NSHV`,
    begehbarDoppel: `⊞ SA → 🔁 2× Trafo ${kva} kVA → 🗄 NSHV`,
    uebergabe:      `⚡ NAP → ⊞ SA${nT > 0 ? ` → 🔁 ${nT}× Trafo ${kva} kVA → 🗄 NSHV` : ' (ohne Trafo)'}`,
    batterie:       `${batTrafo ? `🔁 Trafo ${kva} kVA → ` : ''}🔋 Batterie ${vals.kapazitaetKWh || 1000} kWh / ${vals.leistungKW || 500} kW · Anschluss an bestehende NSHV`,
    nea:            `⚙ NEA ${vals.leistungKW || 250} kW · ${vals.autonomieH || 24} h · Anschluss an bestehende NSHV`,
    zentrale:       `🗄 NSHV → 🔥 BHKW ${vals.leistungElKW || 200} kW el / ${Math.round((vals.leistungElKW || 200) * KWK_TH_FAKTOR)} kW th`,
    ladepark:       `⊞ SA → 🔁 Trafo ${kva} kVA → 🗄 NSHV → 🔌 ${vals.anzahlPunkte || 8}× ${vals.leistungProPunktKW || 22} kW`,
  }[key] || '';
  const dims = _presetDims(p, vals);
  return `${chain} · ${dims.widthM} × ${dims.heightM} m`;
}

// ── Geo-Hilfsfunktionen ───────────────────────────────────────────────────────

// Meter-Offset (x nach Ost, y nach Nord) um rotDeg (im Uhrzeigersinn) gedreht → LatLng
function _offsetLL(lat, lng, xM, yM, rotDeg = 0) {
  const r  = (rotDeg * Math.PI) / 180;
  const rx = xM * Math.cos(r) + yM * Math.sin(r);
  const ry = -xM * Math.sin(r) + yM * Math.cos(r);
  return L.latLng(lat + ry / 111320, lng + rx / (111320 * Math.cos(lat * Math.PI / 180)));
}

// Positionen innerhalb des Gebäudes: 65 % der Gebäudehöhe, entlang der (gedrehten) Längsachse
function _positions(lat, lng, count, heightM, rotDeg = 0) {
  const span = heightM * 0.65;
  const spacingM = count > 1 ? span / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => {
    const offsetM = (i - (count - 1) / 2) * spacingM;
    const ll = _offsetLL(lat, lng, 0, offsetM, rotDeg);
    return { lat: ll.lat, lng: ll.lng };
  });
}

// Rechteck um den Mittelpunkt (lat/lng) mit Breite/Höhe in Metern, um rotDeg gedreht
function _makeRect(lat, lng, widthM, heightM, rotDeg = 0) {
  const w = widthM / 2, h = heightM / 2;
  return [
    _offsetLL(lat, lng, -w,  h, rotDeg), // NW
    _offsetLL(lat, lng,  w,  h, rotDeg), // NO
    _offsetLL(lat, lng,  w, -h, rotDeg), // SO
    _offsetLL(lat, lng, -w, -h, rotDeg), // SW
  ];
}

// ── Asset-Hilfsfunktionen ─────────────────────────────────────────────────────

function _asset(type, lat, lng, buildingId, props, name) {
  const a = createAsset(type, lat, lng, { buildingId });
  a.props = { ...a.props, ...props };
  a.name = name;
  drawAssetMarker(a);
  return a;
}

function _edge(a, b) {
  return addStromEdge(a.id, b.id);
}

function _edgeMS(a, b) {
  const e = addStromEdge(a.id, b.id);
  if (e) e.msLevel = true;
  return e;
}

// ── Platzierungs-State ────────────────────────────────────────────────────────
let _pending = null;
let _mapClick = null;
let _mapMove = null;
let _keyHandler = null;
let _ghostLayer = null;   // Vorschau-Rechteck unter dem Cursor
let _rotDeg = 0;          // aktuelle Drehung (bleibt über mehrere Platzierungen erhalten)
let _lastLL = null;       // letzte Mausposition (für Neuzeichnen beim Drehen)

function _hintText(config) {
  const label = PRESETS[config.preset]?.label || 'Standardgebäude';
  const rot = _rotDeg ? ` · ${_rotDeg}°` : '';
  return `Klicken um ${label} zu platzieren${rot} · R / Shift+R = drehen · Esc = Abbrechen`;
}

function _updateGhost() {
  if (!_pending || !_lastLL) return;
  const p = PRESETS[_pending.preset];
  if (!p) return;
  const dims = _presetDims(p, _pending.vals || {});
  const corners = _makeRect(_lastLL.lat, _lastLL.lng, dims.widthM, dims.heightM, _rotDeg);
  if (_ghostLayer) {
    _ghostLayer.setLatLngs(corners);
  } else {
    _ghostLayer = L.polygon(corners, {
      color: '#cf6679', fillColor: '#cf6679',
      weight: 1.5, opacity: 0.8, fillOpacity: 0.15,
      dashArray: '5 4', interactive: false,
    }).addTo(map);
  }
}

function _deactivate() {
  if (_mapClick)   { map.off('click', _mapClick); _mapClick = null; }
  if (_mapMove)    { map.off('mousemove', _mapMove); _mapMove = null; }
  if (_keyHandler) { document.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  if (_ghostLayer) { _ghostLayer.remove(); _ghostLayer = null; }
  map.getContainer().style.cursor = '';
  _pending = null;
  _lastLL = null;
}

function _activate(config) {
  _deactivate();
  _pending = config;
  map.getContainer().style.cursor = 'crosshair';
  showHint(_hintText(config));

  // Vorschau-Rechteck folgt der Maus (verschieben), R dreht in 15°-Schritten
  _mapMove = (e) => { _lastLL = e.latlng; _updateGhost(); };
  map.on('mousemove', _mapMove);

  _mapClick = (e) => { if (_pending) { _lastLL = e.latlng; _place(e.latlng, _pending); } };
  map.on('click', _mapClick);

  _keyHandler = (ev) => {
    if (ev.key === 'Escape') {
      _deactivate();
      if (typeof window.hideHint === 'function') window.hideHint();
      return;
    }
    if (ev.key === 'r' || ev.key === 'R') {
      ev.preventDefault();
      _rotDeg = ((_rotDeg + (ev.shiftKey ? -1 : 1)) % 360 + 360) % 360;
      _updateGhost();
      showHint(_hintText(config));
    }
  };
  document.addEventListener('keydown', _keyHandler);
}

// ── Platzierung ───────────────────────────────────────────────────────────────
function _place(latlng, config) {
  const { preset, vals = {} } = config;
  const kva = parseInt(vals.kva) || 630;
  const p = PRESETS[preset];
  if (!p) return;

  setAssetLayerVisible(true);

  const dims = _presetDims(p, vals);
  const polygon = _makeRect(latlng.lat, latlng.lng, dims.widthM, dims.heightM, _rotDeg);
  const idx = (window.gebaeude || []).filter(g => g.fromKompakt).length + 1;

  const g = addGebaeude({
    name: `${p.gebName || 'Kompaktstation'} ${idx}`,
    nutzung: '',
    coords: polygon,
    strom: '0', waerme: '0',
    skipAutoCreate: true,
  });
  g.fromKompakt = true;

  if (g.polygonLayer) {
    g.polygonLayer.setStyle({
      color: '#cf6679', fillColor: '#cf6679',
      weight: 2, opacity: 0.85, fillOpacity: 0.12,
    });
  }

  const I_ns = Math.round(kva * 1000 / (400 * Math.sqrt(3)));
  const bid  = g.id;
  const clat = latlng.lat, clng = latlng.lng;
  let created = [];

  if (preset === 'einfach' || preset === 'begehbar') {
    const [pSa, pTrafo, pNshv] = _positions(clat, clng, 3, dims.heightM, _rotDeg);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '6' }, `NSHV ${idx}`);
    created = [sa, trafo, nshv];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);

  } else if (preset === 'doppel' || preset === 'begehbarDoppel') {
    const [pSa, pT1, pT2, pNshv] = _positions(clat, clng, 4, dims.heightM, _rotDeg);
    const sa   = _asset('Schaltanlage', pSa.lat,   pSa.lng,   bid, { felder: '2' }, `Schaltanlage ${idx}`);
    const t1   = _asset('Trafo',        pT1.lat,   pT1.lng,   bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}a`);
    const t2   = _asset('Trafo',        pT2.lat,   pT2.lng,   bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}b`);
    const nshv = _asset('NSHV',         pNshv.lat, pNshv.lng, bid, { nennstromA: String(I_ns * 2), abgaenge: '10' }, `NSHV ${idx}`);
    created = [sa, t1, t2, nshv];
    _edgeMS(sa, t1);
    _edgeMS(sa, t2);
    _edge(t1, nshv);
    _edge(t2, nshv);

  } else if (preset === 'einspeise') {
    const [pSa, pTrafo, pNshv] = _positions(clat, clng, 3, dims.heightM, _rotDeg);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4', netzart: 'erzeugung' }, `Trafo ${idx} (Einsp.)`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '6', netzart: 'erzeugung' }, `NSHV ${idx} (Einsp.)`);
    created = [sa, trafo, nshv];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);

  } else if (preset === 'mitUV') {
    const [pSa, pTrafo, pNshv, pUv] = _positions(clat, clng, 4, dims.heightM, _rotDeg);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '6' }, `NSHV ${idx}`);
    const uv    = _asset('UV',           pUv.lat,    pUv.lng,    bid, { nennstromA: '250', abgaenge: '4' }, `UV ${idx}`);
    created = [sa, trafo, nshv, uv];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);
    _edge(nshv, uv);

  } else if (preset === 'uebergabe') {
    // MS-Übergabe: NAP + Schaltanlage, wahlweise + n Trafos + gemeinsame NSHV
    const nT = Math.max(0, parseInt(vals.anzahlTrafos) || 0);
    const pos = _positions(clat, clng, 2 + nT + (nT > 0 ? 1 : 0), dims.heightM, _rotDeg);
    const nap = _asset('NAP',          pos[0].lat, pos[0].lng, bid, {}, `NAP ${idx}`);
    const sa  = _asset('Schaltanlage', pos[1].lat, pos[1].lng, bid, { felder: String(Math.max(3, nT + 1)) }, `Schaltanlage ${idx}`);
    created = [nap, sa];
    _edgeMS(nap, sa);
    if (nT > 0) {
      const nshvPos = pos[2 + nT];
      const nshv = _asset('NSHV', nshvPos.lat, nshvPos.lng, bid, { nennstromA: String(I_ns * nT), abgaenge: String(Math.max(6, nT * 4)) }, `NSHV ${idx}`);
      const suffix = 'abcdefgh';
      for (let i = 0; i < nT; i++) {
        const t = _asset('Trafo', pos[2 + i].lat, pos[2 + i].lng, bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}${nT > 1 ? suffix[i] : ''}`);
        created.push(t);
        _edgeMS(sa, t);
        _edge(t, nshv);
      }
      created.push(nshv);
    }

  } else if (preset === 'batterie') {
    // Speicher-Container (ISO-Maße): Batterie, wahlweise + eigener Trafo —
    // keine eigene NSHV, der Anschluss erfolgt an eine bestehende NSHV/SA.
    const batKW = parseFloat(vals.leistungKW) || 500;
    const batTrafoKva = parseInt(vals.kva) || 0;
    if (batTrafoKva > 0) {
      const [pTrafo, pBat] = _positions(clat, clng, 2, dims.heightM, _rotDeg);
      const trafo = _asset('Trafo',    pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(batTrafoKva), ukProzent: '4' }, `Trafo ${idx}`);
      const bat   = _asset('Batterie', pBat.lat,   pBat.lng,   bid, { kapazitaetKWh: String(parseFloat(vals.kapazitaetKWh) || 1000), leistungKW: String(batKW) }, `Batterie ${idx}`);
      created = [trafo, bat];
      _edge(trafo, bat);
    } else {
      const bat = _asset('Batterie', clat, clng, bid, { kapazitaetKWh: String(parseFloat(vals.kapazitaetKWh) || 1000), leistungKW: String(batKW) }, `Batterie ${idx}`);
      created = [bat];
    }

  } else if (preset === 'nea') {
    // NEA-Container (ISO-Maße): nur das Aggregat — Anschluss an bestehende NSHV.
    const neaKW = parseFloat(vals.leistungKW) || 250;
    const nsa = _asset('Nsa', clat, clng, bid, { leistungKW: String(neaKW), autonomieH: String(parseFloat(vals.autonomieH) || 24), kraftstoff: 'Diesel' }, `NEA ${idx}`);
    created = [nsa];

  } else if (preset === 'zentrale') {
    // Energiezentrale: NSHV + KWK-Anlage (BHKW)
    const [pNshv, pKwk] = _positions(clat, clng, 2, dims.heightM, _rotDeg);
    const elKW = parseFloat(vals.leistungElKW) || 200;
    const nshv = _asset('NSHV', pNshv.lat, pNshv.lng, bid, { nennstromA: String(Math.round(elKW * 1000 / (400 * Math.sqrt(3)))), abgaenge: '4' }, `NSHV ${idx}`);
    const kwk  = _asset('KWK',  pKwk.lat,  pKwk.lng,  bid, { leistungElKW: String(elKW), leistungThKW: String(Math.round(elKW * KWK_TH_FAKTOR)), wirkungsgradEl: '35', wirkungsgradGes: '85', brennstoff: 'Erdgas' }, `BHKW ${idx}`);
    created = [nshv, kwk];
    _edge(nshv, kwk);

  } else if (preset === 'ladepark') {
    // MS-gespeister Ladepark: SA + Trafo + NSHV + Ladeinfrastruktur
    const [pSa, pTrafo, pNshv, pLade] = _positions(clat, clng, 4, dims.heightM, _rotDeg);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '4' }, `NSHV ${idx}`);
    const lade  = _asset('Lade',         pLade.lat,  pLade.lng,  bid, { anzahlPunkte: String(parseInt(vals.anzahlPunkte) || 8), leistungProPunktKW: String(parseFloat(vals.leistungProPunktKW) || 22), gleichzeitigFaktor: '0.5' }, `Ladepark ${idx}`);
    created = [sa, trafo, nshv, lade];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);
    _edge(nshv, lade);
  }

  recalcStromNetz();
  // kVA-Angabe nur bei Presets mit Trafo
  const hatTrafo = created.some(a => a.type === 'Trafo');
  const kvaTxt = hatTrafo ? `${kva} kVA, ` : '';
  showHint(`✓ ${p.label} platziert — ${kvaTxt}${created.length} Assets. Esc = Fertig`);
}

// ── Öffentliche API ───────────────────────────────────────────────────────────
export function showKompaktstationDialog() {
  // Toggle: bereits aktiv → abbrechen
  if (_pending) {
    _deactivate();
    if (typeof window.hideHint === 'function') window.hideHint();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'ep-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'ep-modal';

  // Presets nach Gruppe als <optgroup> sortiert
  const gruppen = [];
  for (const [key, p] of Object.entries(PRESETS)) {
    let grp = gruppen.find(g => g.label === p.gruppe);
    if (!grp) { grp = { label: p.gruppe, items: [] }; gruppen.push(grp); }
    grp.items.push([key, p]);
  }
  const presetOpts = gruppen.map(g =>
    `<optgroup label="${g.label}">` +
    g.items.map(([key, p]) => `<option value="${key}">${p.label} — ${p.desc}</option>`).join('') +
    `</optgroup>`
  ).join('');

  const selStyle = 'width:100%;padding:5px 8px;background:#1a2035;color:#cfd8dc;border:1px solid #37475a;border-radius:4px;font-size:12px;';

  modal.innerHTML = `
    <div class="ep-modal-title">Standardgebäude platzieren</div>
    <div class="ep-modal-body" style="line-height:1.7;">
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;color:#90a4ae;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">Gebäudetyp</div>
        <select id="ks-preset" style="${selStyle}">${presetOpts}</select>
      </div>
      <div id="ks-params" style="margin-bottom:12px;"></div>
      <div id="ks-preview" style="font-size:10px;color:#90a4ae;background:#0d1117;border-radius:4px;padding:7px 9px;border:1px solid #1e2540;margin-bottom:12px;"></div>
      <div style="font-size:10px;color:#546e7a;background:#0d1117;border-radius:4px;padding:7px 9px;border:1px solid #1e2540;">
        Klicke nach OK auf die Karte um das Gebäude zu platzieren.<br>
        Mehrere hintereinander möglich · <b>Esc</b> oder erneut auf den Button klicken zum Beenden.
      </div>
    </div>
    <div class="ep-modal-btns">
      <button class="ep-modal-btn" id="ks-cancel">Abbrechen</button>
      <button class="ep-modal-btn primary" id="ks-ok">OK — platzieren</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const presetSel = modal.querySelector('#ks-preset');
  const paramsEl  = modal.querySelector('#ks-params');
  const previewEl = modal.querySelector('#ks-preview');

  // Aktuelle Parameterwerte aus den Feldern lesen (fehlende → Defaults)
  const readVals = () => {
    const vals = {};
    for (const prm of PRESETS[presetSel.value].params) {
      const el = paramsEl.querySelector(`[data-key="${prm.key}"]`);
      vals[prm.key] = el ? el.value : prm.default;
    }
    return vals;
  };
  const updatePreview = () => { previewEl.innerHTML = _previewText(presetSel.value, readVals()); };

  // Parameterbereich kontextabhängig neu rendern (kVA-Auswahl nur bei Trafo-Presets)
  const renderParams = () => {
    const prms = PRESETS[presetSel.value].params;
    if (!prms.length) { paramsEl.innerHTML = ''; updatePreview(); return; }
    paramsEl.innerHTML = prms.map(prm => {
      let field;
      if (prm.typ === 'kva' || prm.typ === 'kvaOhne') {
        const ohne = prm.typ === 'kvaOhne' ? `<option value="0"${prm.default === 0 ? ' selected' : ''}>ohne (Anschluss NS-seitig)</option>` : '';
        field = `<select data-key="${prm.key}" style="${selStyle}">` + ohne +
          TRAFO_KVA.map(k => `<option value="${k}"${k === prm.default ? ' selected' : ''}>${k} kVA</option>`).join('') +
          `</select>`;
      } else if (prm.typ === 'container') {
        field = `<select data-key="${prm.key}" style="${selStyle}">` +
          Object.entries(CONTAINERS).map(([k, c]) => `<option value="${k}"${k === prm.default ? ' selected' : ''}>${c.label}</option>`).join('') +
          `</select>`;
      } else {
        field = `<input type="number" data-key="${prm.key}" value="${prm.default}" step="${prm.step || 1}" min="0" style="${selStyle}box-sizing:border-box;">`;
      }
      return `<div style="flex:1;min-width:110px;">
        <div style="font-size:11px;color:#90a4ae;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">${prm.label}</div>
        ${field}
      </div>`;
    }).join('');
    paramsEl.style.display = 'flex';
    paramsEl.style.gap = '8px';
    paramsEl.style.flexWrap = 'wrap';
    paramsEl.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', updatePreview));
    updatePreview();
  };
  presetSel.addEventListener('change', renderParams);
  renderParams();

  const close = () => document.body.removeChild(overlay);
  modal.querySelector('#ks-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  modal.querySelector('#ks-ok').onclick = () => {
    const preset = presetSel.value;
    const vals   = readVals();
    close();
    _activate({ preset, vals });
  };
}
