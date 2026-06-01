// ── 13m-kompaktstation.js — Kompaktstation (Gebäude + Assets) platzieren ──

import { map, addGebaeude } from './02b-gebaeude.js';
import { createAsset } from './13a-assets-core.js';
import { drawAssetMarker, setAssetLayerVisible } from './13b-assets-render.js';
import { addStromEdge, recalcStromNetz } from './05b-stromnetz.js';
import { showHint } from './03c-gebaeude-io.js';

// ── Standard-Leistungen ───────────────────────────────────────────────────────
const TRAFO_KVA = [100, 160, 250, 315, 400, 500, 630, 800, 1000, 1250];

// ── Konfigurationspresets ─────────────────────────────────────────────────────
const PRESETS = {
  einfach: {
    label: 'Einfachstation',
    desc: 'SA + 1× Trafo + NSHV',
    widthM: 3.5, heightM: 9.0,
  },
  doppel: {
    label: 'Doppelstation',
    desc: 'SA + 2× Trafo + NSHV',
    widthM: 5.0, heightM: 11.0,
  },
  einspeise: {
    label: 'Einspeise-Station (PV/Wind)',
    desc: 'SA + 1× Trafo (Einspeisung) + NSHV',
    widthM: 3.5, heightM: 9.0,
  },
  mitUV: {
    label: 'Station mit UV',
    desc: 'SA + 1× Trafo + NSHV + UV',
    widthM: 4.0, heightM: 9.5,
  },
};

// ── Geo-Hilfsfunktionen ───────────────────────────────────────────────────────

// Positionen innerhalb des Gebäudes: 65 % der Gebäudehöhe, N-S verteilt
function _positions(lat, lng, count, heightM) {
  const span = heightM * 0.65;
  const spacingM = count > 1 ? span / (count - 1) : 0;
  const dLatPerM = 1 / 111320;
  return Array.from({ length: count }, (_, i) => {
    const offsetM = (i - (count - 1) / 2) * spacingM;
    return { lat: lat + offsetM * dLatPerM, lng };
  });
}

// Rechteck um den Mittelpunkt (lat/lng) mit Breite/Höhe in Metern
function _makeRect(lat, lng, widthM, heightM) {
  const dLat = (heightM / 2) / 111320;
  const dLng = (widthM  / 2) / (111320 * Math.cos(lat * Math.PI / 180));
  return [
    L.latLng(lat + dLat, lng - dLng), // NW
    L.latLng(lat + dLat, lng + dLng), // NO
    L.latLng(lat - dLat, lng + dLng), // SO
    L.latLng(lat - dLat, lng - dLng), // SW
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
let _keyHandler = null;

function _deactivate() {
  if (_mapClick)   { map.off('click', _mapClick); _mapClick = null; }
  if (_keyHandler) { document.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  map.getContainer().style.cursor = '';
  _pending = null;
}

function _activate(config) {
  _deactivate();
  _pending = config;
  map.getContainer().style.cursor = 'crosshair';
  showHint('Klicken um Kompaktstation zu platzieren · Esc = Abbrechen');

  _mapClick = (e) => { if (_pending) _place(e.latlng, _pending); };
  map.on('click', _mapClick);

  _keyHandler = (ev) => {
    if (ev.key === 'Escape') {
      _deactivate();
      if (typeof window.hideHint === 'function') window.hideHint();
    }
  };
  document.addEventListener('keydown', _keyHandler);
}

// ── Platzierung ───────────────────────────────────────────────────────────────
function _place(latlng, config) {
  const { preset, kva } = config;
  const p = PRESETS[preset];
  if (!p) return;

  setAssetLayerVisible(true);

  const polygon = _makeRect(latlng.lat, latlng.lng, p.widthM, p.heightM);
  const idx = (window.gebaeude || []).filter(g => g.fromKompakt).length + 1;

  const g = addGebaeude({
    name: `Kompaktstation ${idx}`,
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

  if (preset === 'einfach') {
    const [pSa, pTrafo, pNshv] = _positions(clat, clng, 3, p.heightM);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '6' }, `NSHV ${idx}`);
    created = [sa, trafo, nshv];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);

  } else if (preset === 'doppel') {
    const [pSa, pT1, pT2, pNshv] = _positions(clat, clng, 4, p.heightM);
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
    const [pSa, pTrafo, pNshv] = _positions(clat, clng, 3, p.heightM);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4', netzart: 'erzeugung' }, `Trafo ${idx} (Einsp.)`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '6', netzart: 'erzeugung' }, `NSHV ${idx} (Einsp.)`);
    created = [sa, trafo, nshv];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);

  } else if (preset === 'mitUV') {
    const [pSa, pTrafo, pNshv, pUv] = _positions(clat, clng, 4, p.heightM);
    const sa    = _asset('Schaltanlage', pSa.lat,    pSa.lng,    bid, { felder: '1' }, `Schaltanlage ${idx}`);
    const trafo = _asset('Trafo',        pTrafo.lat, pTrafo.lng, bid, { leistungKVA: String(kva), ukProzent: '4' }, `Trafo ${idx}`);
    const nshv  = _asset('NSHV',         pNshv.lat,  pNshv.lng,  bid, { nennstromA: String(I_ns), abgaenge: '6' }, `NSHV ${idx}`);
    const uv    = _asset('UV',           pUv.lat,    pUv.lng,    bid, { nennstromA: '250', abgaenge: '4' }, `UV ${idx}`);
    created = [sa, trafo, nshv, uv];
    _edgeMS(sa, trafo);
    _edge(trafo, nshv);
    _edge(nshv, uv);
  }

  recalcStromNetz();
  showHint(`✓ ${p.label} platziert — ${kva} kVA, ${created.length} Assets. Esc = Fertig`);
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

  const presetOpts = Object.entries(PRESETS).map(([key, p]) =>
    `<option value="${key}">${p.label} — ${p.desc} (${p.widthM}×${p.heightM} m)</option>`
  ).join('');

  const kvaOpts = TRAFO_KVA.map(k =>
    `<option value="${k}"${k === 630 ? ' selected' : ''}>${k} kVA</option>`
  ).join('');

  modal.innerHTML = `
    <div class="ep-modal-title">Kompaktstation platzieren</div>
    <div class="ep-modal-body" style="line-height:1.7;">
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;color:#90a4ae;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">Konfiguration</div>
        <select id="ks-preset" style="width:100%;padding:5px 8px;background:#1a2035;color:#cfd8dc;border:1px solid #37475a;border-radius:4px;font-size:12px;">${presetOpts}</select>
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;color:#90a4ae;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">Trafo-Leistung</div>
        <select id="ks-kva" style="width:100%;padding:5px 8px;background:#1a2035;color:#cfd8dc;border:1px solid #37475a;border-radius:4px;font-size:12px;">${kvaOpts}</select>
      </div>
      <div style="font-size:10px;color:#546e7a;background:#0d1117;border-radius:4px;padding:7px 9px;border:1px solid #1e2540;">
        Klicke nach OK auf die Karte um die Station zu platzieren.<br>
        Mehrere Stationen hintereinander möglich · <b>Esc</b> oder erneut auf den Button klicken zum Beenden.
      </div>
    </div>
    <div class="ep-modal-btns">
      <button class="ep-modal-btn" id="ks-cancel">Abbrechen</button>
      <button class="ep-modal-btn primary" id="ks-ok">OK — platzieren</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  modal.querySelector('#ks-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  modal.querySelector('#ks-ok').onclick = () => {
    const preset = modal.querySelector('#ks-preset').value;
    const kva    = parseInt(modal.querySelector('#ks-kva').value);
    close();
    _activate({ preset, kva });
  };
}
