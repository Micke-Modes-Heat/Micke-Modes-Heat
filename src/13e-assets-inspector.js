// ── 13e-assets-inspector.js — Editor-Panel für selektiertes Asset ──────────

import { createId } from './lib/util.js';

// Persistiert den Einklapp-Zustand der Sektionen innerhalb einer Session
const _sectionCollapsed = {};
// Persistiert den Einklapp-Zustand der Asset-Gruppen in der Hauptliste
const _groupCollapsed = {};

function wireSectionToggles(panel) {
  panel.querySelectorAll('.ins-section-header[data-target]').forEach(hdr => {
    const targetId = hdr.dataset.target;
    const content  = panel.querySelector('#' + targetId);
    if (!content) return;
    // Gespeicherten Zustand wiederherstellen
    if (_sectionCollapsed[targetId]) {
      hdr.classList.add('is-collapsed');
      content.classList.add('is-collapsed');
    }
    hdr.addEventListener('click', () => {
      const nowCollapsed = hdr.classList.toggle('is-collapsed');
      content.classList.toggle('is-collapsed', nowCollapsed);
      _sectionCollapsed[targetId] = nowCollapsed;
    });
  });
}

import { ASSETS, ASSET_CFG, ASSET_PROPS_SCHEMA, TYPE_RANK, getAssetStatus, getAsset, deleteAsset, computeTwwKw, TWW_DEFAULTS } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets, updateLadeParking, zoomToWindEignungsflaeche } from './13b-assets-render.js';
import { openSlpEditor } from './13i-slp-editor.js';
import { globalYear } from './01-globals-varianten.js';
import { makePvProfile8760, _PV_SPEZ_DEFAULT } from './09a-pv-profile.js';
import { getElSlpProfiles, getElSlpGruppen } from './13k-elslp-registry.js';
import { computeWindYield, calcWindLwaAuto, computeWindScenarios, windProfileForAsset, getWindSiteData } from './13q-wind-ertrag.js';
import { toggleDrawWindGebiet, clearWindGebiet } from './02c-karte-werkzeuge.js';
import { SCHICHT_META, SCHICHT_REIHENFOLGE, normSchicht } from './lib/schichten.js';

// Inspector-Slot sitzt im Elektro-Tab der rechten Sidebar
function getPanel() { return document.getElementById('sb-asset-inspector-slot'); }

export function openAssetInspector(asset) {
  if (!asset) return;
  ASSETS.selectedId = asset.id;
  redrawAllAssets();
  const panel = getPanel();
  if (!panel) return;
  // Rechte Sidebar: zum Elektro-Tab wechseln
  if (typeof window.setSidebarTab === 'function') window.setSidebarTab('elektro');
  // Inspector anzeigen, Liste ausblenden
  const listEl = document.getElementById('sb-asset-list');
  if (listEl) listEl.style.display = 'none';
  panel.style.display = 'flex';
  renderInspector(asset);
}

export function closeAssetInspector() {
  const panel = getPanel();
  if (panel) panel.style.display = 'none';
  ASSETS.selectedId = null;
  redrawAllAssets();
  // Asset-Liste wieder einblenden und aktualisieren
  const listEl = document.getElementById('sb-asset-list');
  if (listEl) listEl.style.display = '';
  renderSidebarAssetList();
}

// ── Asset-Liste (alle Assets nach Typ gruppiert) ────────────────────────────
export function renderSidebarAssetList() {
  const container = document.getElementById('sb-asset-list');
  if (!container) return;

  const items = ASSETS.items;
  const edges = window.stromEdges || [];

  // Zähler-Badge
  const countEl = document.getElementById('sb-asset-count');
  if (countEl) countEl.textContent = items.length;

  if (items.length === 0 && edges.length === 0) {
    container.innerHTML = `<div class="sb-asset-empty">
      <div style="font-size:20px;margin-bottom:6px;">⚡</div>
      <div>Noch keine Komponenten platziert.</div>
      <div style="margin-top:4px;font-size:9px;opacity:.6;">⚡-Tab links → Komponenten platzieren</div>
    </div>`;
    return;
  }

  // Nach Typ gruppieren, Typen nach TYPE_RANK sortieren
  const byType = new Map();
  for (const a of items) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
  }
  const sortedTypes = [...byType.keys()].sort((a, b) =>
    (TYPE_RANK[a] ?? 99) - (TYPE_RANK[b] ?? 99)
  );

  let html = '';
  for (const type of sortedTypes) {
    const cfg = ASSET_CFG[type];
    const typeItems = byType.get(type);
    const rows = typeItems.map(a => {
      const status  = getAssetStatus(a, globalYear);
      const opacity = status === 'active' ? 1 : 0.45;
      const hasPending = (a.massnahmen || []).some(m => m.status === 'geplant');
      const pendingDot = hasPending
        ? `<span class="sb-asset-pending-dot" title="Offene Maßnahmen"></span>`
        : '';
      const isSel   = window.assetSelection?.has(a.id);
      const sel     = (ASSETS.selectedId === a.id ? ' selected' : '') + (isSel ? ' asset-bulk-selected' : '');
      const checked = isSel ? ' checked' : '';
      return `<div class="sb-asset-row${sel}" data-asset-id="${a.id}">
        <input type="checkbox" class="sb-asset-cb"${checked} onclick="event.stopPropagation();selToggle('${a.id}')" title="Auswählen" style="flex-shrink:0;cursor:pointer;accent-color:var(--accent,#2196F3);">
        <span class="sb-asset-row-icon" style="background:${cfg.color};opacity:${opacity};">${cfg.icon}</span>
        <span class="sb-asset-row-name">${esc(a.name)}</span>
        ${pendingDot}
        <button onclick="event.stopPropagation();toggleVormerkenAsset('${a.id}')" title="${a.feldVorgemerkt ? 'Vorgemerkt' : 'Vormerken'}" style="background:none;border:none;cursor:pointer;font-size:${a.feldVorgemerkt ? 13 : 11}px;color:${a.feldVorgemerkt ? '#f59e0b' : '#666'};padding:0 2px;margin-left:auto;line-height:1;flex-shrink:0;">★</button>
        <span class="sb-asset-row-status sb-asset-row-status-${status}"></span>
      </div>`;
    }).join('');
    const collapsed = !!_groupCollapsed[type];
    html += `<div class="sb-asset-group">
      <div class="sb-asset-group-hdr${collapsed ? ' is-collapsed' : ''}" data-group-type="${type}">
        <span class="sb-asset-group-icon" style="color:${cfg.color};">${cfg.icon}</span>
        <span class="sb-asset-group-label">${cfg.label}</span>
        <span class="sb-asset-group-count">${typeItems.length}</span>
        <span class="sb-asset-group-chevron">▾</span>
      </div>
      <div class="sb-asset-group-rows${collapsed ? ' is-collapsed' : ''}">
        ${rows}
      </div>
    </div>`;
  }

  // Kabel-Sektion
  if (edges.length > 0) {
    const cableRows = edges.map((e, idx) => {
      const np    = e.nParallel > 1 ? `${e.nParallel}× ` : '';
      const label = `${np}${e.cableType || 'NAYY'} ${e.crossSection || '?'} mm²`;
      const lenStr = e.lengthM ? ` · ${Math.round(e.lengthM)} m` : '';
      const ausl  = e.auslastungPct || 0;
      const dot   = ausl < 80 ? '#4caf50' : ausl < 100 ? '#f9a825' : '#e53935';
      return `<div class="sb-asset-row" data-edge-idx="${idx}">
        <span class="sb-asset-row-icon" style="background:#3a3a3a;color:#fdd835;font-size:11px;">━</span>
        <span class="sb-asset-row-name">${esc(label)}${esc(lenStr)}</span>
        <span style="width:6px;height:6px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
      </div>`;
    }).join('');
    const collapsed = !!_groupCollapsed['_cables'];
    html += `<div class="sb-asset-group">
      <div class="sb-asset-group-hdr${collapsed ? ' is-collapsed' : ''}" data-group-type="_cables">
        <span class="sb-asset-group-icon" style="color:#fdd835;">━</span>
        <span class="sb-asset-group-label">Kabel</span>
        <span class="sb-asset-group-count">${edges.length}</span>
        <span class="sb-asset-group-chevron">▾</span>
      </div>
      <div class="sb-asset-group-rows${collapsed ? ' is-collapsed' : ''}">
        ${cableRows}
      </div>
    </div>`;
  }

  container.innerHTML = html;

  // Gruppen einklappen/ausklappen
  container.querySelectorAll('.sb-asset-group-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const type = hdr.dataset.groupType;
      const rows = hdr.nextElementSibling;
      const nowCollapsed = hdr.classList.toggle('is-collapsed');
      rows.classList.toggle('is-collapsed', nowCollapsed);
      _groupCollapsed[type] = nowCollapsed;
    });
  });

  // Klick-Handler: Assets
  container.querySelectorAll('.sb-asset-row[data-asset-id]').forEach(row => {
    row.addEventListener('click', () => {
      const a = ASSETS.items.find(x => x.id === row.dataset.assetId);
      if (a) openAssetInspector(a);
    });
  });

  // Klick-Handler: Kabel → öffnet Kabel-Inspector-Modal
  container.querySelectorAll('.sb-asset-row[data-edge-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const idx  = parseInt(row.dataset.edgeIdx);
      const edge = (window.stromEdges || [])[idx];
      if (edge && typeof window.openCableInspector === 'function') window.openCableInspector(edge);
    });
  });
}

// ── Hilfsfunktionen für Formular-Felder ─────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// Planungsschicht nachträglich korrigierbar machen — im falschen Eingabemodus
// angelegte Objekte sollen billig zu berichtigen sein, sonst arbeitet man
// gegen den Modus statt mit ihm.
function buildSchichtSelect(asset) {
  const cur = normSchicht(asset.schicht);
  const opts = SCHICHT_REIHENFOLGE.map(s =>
    `<option value="${s}"${s === cur ? ' selected' : ''}>${SCHICHT_META[s].icon} ${SCHICHT_META[s].label}</option>`
  ).join('');
  return `<div class="ins-field-group">
    <label class="ins-field-label" title="${SCHICHT_META[cur].hinweis}">Planungsschicht</label>
    <select class="ins-field-input" data-field="schicht"
      style="border-left:3px solid ${SCHICHT_META[cur].farbe};">${opts}</select>
  </div>`;
}

function numField(id, key, label, dflt, opts = {}) {
  const p = opts.props || {};
  const val = p[key] !== undefined ? p[key] : dflt;
  const step = opts.step || 'any';
  const min  = opts.min  !== undefined ? `min="${opts.min}"` : '';
  return `<div class="ins-field-group">
    <label class="ins-field-label">${label}</label>
    <input class="ins-field-input" type="number" step="${step}" ${min}
      value="${val}" data-prop="${key}" data-id="${id}">
  </div>`;
}

function selectField(id, key, label, options, current) {
  const opts = options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return `<option value="${v}"${current === v ? ' selected' : ''}>${l}</option>`;
  }).join('');
  return `<div class="ins-field-group">
    <label class="ins-field-label">${label}</label>
    <select class="ins-field-input" data-prop="${key}" data-id="${id}">${opts}</select>
  </div>`;
}

function checkField(id, key, label, checked) {
  return `<label class="ins-check-row">
    <input type="checkbox" data-prop="${key}" data-id="${id}" ${checked ? 'checked' : ''}>
    <span>${label}</span>
  </label>`;
}

function row2(...fields) {
  return `<div class="ins-row-2">${fields.join('')}</div>`;
}
function row3(...fields) {
  return `<div class="ins-row-3">${fields.join('')}</div>`;
}

// ── Wind: Hilfsfunktionen für Szenarien-Vergleich ───────────────────────────
// Jahres-Strombedarf der Liegenschaft: bevorzugt Endausbau-Lastgang (Bestand +
// geplante Maßnahmen, wie NAP-/PV-Analyse ihn verwenden), sonst Basis-Lastgang.
export function _liegenschaftJahresbedarfMWh() {
  let arr = null;
  if (typeof window.napGetEndausbauLastgang === 'function') {
    const res = window.napGetEndausbauLastgang(globalYear);
    if (res?.arr) arr = res.arr;
  }
  if (!arr) arr = window.elQuartierH15 || window.elQuartierH || null;
  if (!arr || !arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  const dt = arr.length > 8784 ? 0.25 : 1.0;
  return (s * dt) / 1000;
}

// Kürzester Abstand eines Punkts zur Grenze des maßgeblichen Gebiets, in Metern.
// Bevorzugt das eigene Windgebiet (window.windGebietPolygon, meist größer/anders
// zugeschnitten als das allgemeine Plangebiet); Fallback: window.areaPolygon.
// Liefert null, wenn keines von beiden gezeichnet ist.
export function _distanceToPlangebietM(lat, lng) {
  const poly = window.windGebietPolygon || window.areaPolygon;
  if (!poly || typeof poly.getLatLngs !== 'function') return null;
  const rings = poly.getLatLngs();
  const ring = Array.isArray(rings[0]) ? rings[0] : rings;
  if (!ring || ring.length < 2) return null;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(lat * Math.PI / 180);
  const toXY = pt => [(pt.lng - lng) * mPerLng, (pt.lat - lat) * mPerLat];
  const pointSegDist = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? (-ax * dx - ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(cx, cy);
  };
  let minD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = toXY(ring[i]);
    const b = toXY(ring[(i + 1) % ring.length]);
    minD = Math.min(minD, pointSegDist(a[0], a[1], b[0], b[1]));
  }
  return Number.isFinite(minD) ? minD : null;
}

// Welches Gebiet die Eignungsflächen-/Abstandsberechnung gerade verwendet — Windgebiet
// (eigenes, ggf. größeres Zeichengebiet für die Standortanalyse) geht vor Plangebiet.
export function _activeGebietLabel() {
  if (window.windGebietPolygon) return 'Windgebiet';
  if (window.areaPolygon)       return 'Plangebiet';
  return null;
}

function _windGebietZeichnenBlock() {
  const has = !!window.windGebietPolygon;
  const drawing = !!window.windGebietDrawing;
  const label = _activeGebietLabel();
  return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0 4px;flex-wrap:wrap;">
    <button class="ins-link-btn" onclick="toggleDrawWindGebiet()" style="margin:0;">
      ${drawing ? '✎ Zeichnen läuft … (ESC zum Abbrechen)' : has ? '↺ Windgebiet neu zeichnen' : '🗺 Eigenes Windgebiet zeichnen'}
    </button>
    ${has ? `<button class="ins-link-btn" onclick="clearWindGebiet()" style="margin:0;color:#ef9a9a;">✕ löschen</button>` : ''}
  </div>
  <div style="font-size:8px;color:var(--muted);margin:-2px 0 6px;">
    ${has
      ? 'Eigenes Windgebiet aktiv — kann größer/anders als das allgemeine Plangebiet sein.'
      : window.areaPolygon
        ? 'Kein eigenes Windgebiet — nutzt aktuell das allgemeine Plangebiet.'
        : 'Kein Windgebiet und kein Plangebiet gezeichnet.'}
  </div>`;
}

function _windEignungsHinweis(asset) {
  const p = asset.props || {};
  if (p.eignungsflaecheVisible !== true) return '';
  const s = asset._eignungsStats;
  const gebiet = _activeGebietLabel() || 'Gebiet';
  if (!s) {
    return `<div style="font-size:9px;color:var(--muted);margin:-3px 0 4px;">Fläche wird berechnet …</div>`;
  }
  if (s.error === 'no-plangebiet') {
    return `<div style="font-size:9px;color:#f9a825;margin:-3px 0 4px;">⚠ Kein Windgebiet/Plangebiet gezeichnet — Button oben nutzen oder im Gebiet-Tab „Plangebiet / Bereich zeichnen".</div>`;
  }
  if (!s.cells || !s.cells.length) {
    return `<div style="font-size:9px;color:#f9a825;margin:-3px 0 4px;">Keine geeignete Fläche gefunden — ${gebiet} zu klein für ${s.radiusM.toFixed(0)} m Mindestabstand.</div>`;
  }
  const ha = (s.areaM2 / 10000).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const trunc = s.truncated ? ' (Raster unvollständig — Wert ist Untergrenze)' : '';
  return `<div style="font-size:9px;color:var(--muted);margin:-3px 0 2px;">≈ ${ha} ha geeignete Fläche im ${gebiet} (Raster ${s.gridStepM} m, Mindestabstand ${s.radiusM.toFixed(0)} m zu Grenze &amp; Gebäuden)${trunc}.</div>`
    + `<button class="ins-link-btn" onclick="zoomToWindEignungsflaeche()" style="margin:0 0 6px;">🔍 Zur Fläche zoomen</button>`;
}

function _windScenarioRow(s) {
  if (!s) return '';
  const gh = s.gesamthoeheM;
  const ghCol = gh <= 50 ? '#4caf50' : '#f9a825';
  return `<div style="display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);">
    <div style="font-size:10px;font-weight:700;color:var(--text);">${esc(s.label)}</div>
    <div style="font-size:10px;color:${ghCol};font-weight:700;">Gesamthöhe ${gh.toFixed(0)} m</div>
    <div style="font-size:9px;color:var(--muted);grid-column:1/3;">
      ${s.ratedKw.toFixed(0)} kW · Ø ${s.rotorDurchmesserM.toFixed(0)} m · Nabenhöhe ${s.nabenhoheM.toFixed(0)} m
      &nbsp;→&nbsp; <span style="color:#4dd0e1;">${s.annualMWh.toLocaleString('de-DE',{maximumFractionDigits:0})} MWh/a</span>
      · ${s.volllaststundenH.toFixed(0)} Vlh
    </div>
  </div>`;
}

// ── Props-Formular je Typ ───────────────────────────────────────────────────
function buildPropsForm(asset) {
  const id = asset.id;
  const p  = asset.props || {};

  switch (asset.type) {
    case 'NAP':
      return row2(numField(id, 'spannungKV', 'Nennspannung (kV)', 20, {props:p, step:1, min:1}));

    case 'Schaltanlage':
      return row2(
        numField(id, 'felder',     'Anzahl Felder',  6,   {props:p, step:1, min:1}),
        numField(id, 'nennstromA', 'Nennstrom (A)',  630, {props:p, step:1})
      ) + checkField(id, 'trennstelle', 'Trennstelle (Schutzkonzept)', !!p.trennstelle);

    case 'Trafo': {
      const kvaOpts = [50,100,160,200,250,315,400,500,630,800,1000,1250,1600,2000]
        .map(v => ({ value: v, label: `${v} kVA` }));
      const curKva = parseFloat(p.leistungKVA) || 630;
      const netzartOpts = [
        { value: 'verbrauch',  label: 'Verbrauchsnetz (Standard)' },
        { value: 'erzeugung',  label: 'Erzeugungsnetz (Einspeisung)' },
      ];
      return row2(
        selectField(id, 'leistungKVA', 'Leistung (kVA)', kvaOpts, curKva),
        numField(id, 'ukProzent', 'UK (%)', 4, {props:p, step:0.1})
      ) + row2(
        selectField(id, 'netzart', 'Netzart', netzartOpts, p.netzart || 'verbrauch'),
        ''
      );
    }

    case 'NSHV':
    case 'UV': {
      const netzartOpts = [
        { value: 'verbrauch',  label: 'Verbrauchsnetz (Standard)' },
        { value: 'erzeugung',  label: 'Erzeugungsnetz (Einspeisung)' },
      ];
      return row2(
        numField(id, 'nennstromA', 'Nennstrom (A)', 400, {props:p, step:1}),
        numField(id, 'abgaenge',   'Abgänge',         4, {props:p, step:1, min:1})
      ) + row2(
        selectField(id, 'netzart', 'Netzart', netzartOpts, p.netzart || 'verbrauch'),
        ''
      );
    }

    case 'Verbraucher': {
      // Direkt in props schreiben, nicht nur visuell defaulten —
      // sonst bleibt slpTyp undefined und NAP-Analyse nutzt statischen Fallback
      if (!p.slpTyp) p.slpTyp = 'G0';
      const curSlp = p.slpTyp;
      // Dynamisch gruppiertes Select aus Registry — erfasst automatisch zukünftige Profile
      const slpSelectHtml = (() => {
        const profiles = getElSlpProfiles();
        const gruppen  = getElSlpGruppen();
        const optsHtml = gruppen.map(g => {
          const items = profiles.filter(pr => pr.gruppe === g).map(pr =>
            `<option value="${pr.id}"${pr.id === curSlp ? ' selected' : ''}>${pr.id} — ${pr.label}</option>`
          ).join('');
          return `<optgroup label="${g}">${items}</optgroup>`;
        }).join('');
        return `<div class="ins-field-group">
          <label class="ins-field-label">Lastprofil (SLP)</label>
          <select class="ins-field-input" data-prop="slpTyp" data-id="${id}">${optsHtml}</select>
        </div>`;
      })();
      return numField(id, 'leistungKW', 'Leistung (kW)', 10, {props:p})
        + slpSelectHtml
        + `<button class="ins-link-btn" data-slp-open="${curSlp}">Profil ansehen →</button>`;
    }

    case 'TWW': {
      const d = TWW_DEFAULTS;
      if (!p.eingabeModus) p.eingabeModus = d.eingabeModus;
      if (!p.geraet)       p.geraet       = d.geraet;
      const geb = (typeof window !== 'undefined' && window.gebaeude)
        ? window.gebaeude.find(g => g.id === asset.buildingId) : null;
      const res = computeTwwKw(p, geb);
      p.leistungKW = res.leistungKW;   // an NAP-/Ergebnis-Logik durchreichen

      const eingabeSel = selectField(id, 'eingabeModus', 'Bedarf über',
        [{value:'personen', label:'Personenzahl'}, {value:'energie', label:'TWW-Energie (kWh/a)'}],
        p.eingabeModus);
      const bedarfFields = p.eingabeModus === 'energie'
        ? numField(id, 'energieKwhA', 'TWW-Wärme gesamt (kWh/a)', d.energieKwhA, {props:p, step:100, min:0})
        : row2(
            numField(id, 'personen',      'Personen',        d.personen,      {props:p, step:1, min:0}),
            numField(id, 'kwhProPersonA', 'kWh/(Pers.·a)',   d.kwhProPersonA, {props:p, step:10, min:0})
          );
      const geraetSel = selectField(id, 'geraet', 'Nacherwärmung',
        [{value:'heizstab', label:'Heizstab (COP 1)'}, {value:'booster', label:'Booster-WP'}],
        p.geraet);
      const copField = p.geraet === 'booster'
        ? numField(id, 'copBooster', 'COP Booster', d.copBooster, {props:p, step:0.1, min:0.5})
        : '';
      const paramRow = row2(
        numField(id, 'zielTempC', 'Zieltemp. (°C)', d.zielTempC, {props:p, step:1, min:30}),
        numField(id, 'vbhTww',    'Vollben.-std (h/a)', d.vbhTww,  {props:p, step:50, min:100})
      );
      const hub = Math.max(0, res.ziel - res.tNet);
      const readout = `
        <div style="margin-top:8px;padding:7px 9px;background:rgba(186,104,206,0.10);border-left:2px solid #ba68c8;border-radius:4px;font-size:10px;line-height:1.5;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">VL am Gebäude${geb?'':' (global)'}</span><span>${res.tVl.toFixed(0)} °C → nutzbar ${res.tNet.toFixed(0)} °C</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Hub auf ${res.ziel.toFixed(0)} °C · Nacherw.-Anteil</span><span>${hub.toFixed(0)} K · ${(res.anteil*100).toFixed(0)} %</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">El. Energie</span><span>${Math.round(res.qNachEl).toLocaleString('de-DE')} kWh/a</span></div>
          <div style="display:flex;justify-content:space-between;margin-top:3px;border-top:1px solid var(--border);padding-top:3px;">
            <span style="font-weight:700;">El. Anschlussleistung</span><span style="font-weight:700;color:#ce93d8;font-size:13px;">${res.leistungKW.toFixed(1)} kW</span></div>
          ${res.anteil <= 0 ? `<div style="color:#66bb6a;margin-top:3px;">✓ Netz-VL erreicht Zieltemperatur — keine Nacherwärmung nötig.</div>` : ''}
        </div>`;
      return eingabeSel + bedarfFields + geraetSel + copField + paramRow + readout;
    }

    case 'WP':
    case 'Geo':
    case 'FG': {
      const linked = asset.linkedErzeuger
        ? `<div style="font-size:9px;color:#80cbc4;margin-bottom:4px;padding:3px 6px;background:rgba(128,203,196,0.1);border-radius:3px;">🔗 Aus dem Erzeuger-Tab synchronisiert</div>`
        : '';
      return linked + row2(
        numField(id, 'leistungThKW', 'Th. Leistung (kW)', 100, {props:p}),
        numField(id, 'leistungElKW', 'El. Bedarf (kW)',    40, {props:p})
      ) + numField(id, 'jaz', 'JAZ', 2.5, {props:p, step:0.1});
    }

    case 'PV': {
      const spezDefault = _PV_SPEZ_DEFAULT[p.ausrichtung || 'sued'] || 1050;
      return row2(
        numField(id, 'leistungKWp', 'Leistung (kWp)', 10,          {props:p}),
        numField(id, 'pvSpez',      'Ertrag (kWh/kWp·a)', spezDefault, {props:p})
      ) + selectField(id, 'ausrichtung', 'Ausrichtung',
        [{value:'sued', label:'Süd'}, {value:'ostwest', label:'Ost-West'}],
        p.ausrichtung || 'sued');
    }

    case 'Batterie': {
      const modus = p.betriebsmodus || 'einspeisung';
      return row2(
        numField(id, 'kapazitaetKWh', 'Kapazität (kWh)', 50, {props:p}),
        numField(id, 'leistungKW',    'Leistung (kW)',    25, {props:p})
      ) + `<div class="ins-field-group">
        <label class="ins-field-label">Betriebsmodus</label>
        <div class="ins-toggle-row">
          <button class="ins-toggle-btn${modus==='einspeisung'?' active-gen':''}"
            data-prop="betriebsmodus" data-val="einspeisung" data-id="${id}">⬇ Einspeisung</button>
          <button class="ins-toggle-btn${modus==='verbraucher'?' active-load':''}"
            data-prop="betriebsmodus" data-val="verbraucher" data-id="${id}">⬆ Verbraucher</button>
        </div>
      </div>`;
    }

    case 'Lade': {
      const rot  = parseFloat(p.rotation)           || 0;
      const gzf  = parseFloat(p.gleichzeitigFaktor) || 0.3;
      const pStd = (parseInt(p.anzahlPunkte)||8) * (parseFloat(p.leistungProPunktKW)||11) * gzf;
      return `
        <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Standard-Lader</div>
        ${row2(
          numField(id, 'anzahlPunkte',       'Anz. Punkte',     8,  {props:p, step:1, min:1}),
          numField(id, 'leistungProPunktKW', 'kW / Punkt',     11,  {props:p})
        )}
        ${numField(id, 'gleichzeitigFaktor', 'Gleichzeitigkeitsfaktor (0–1)', 0.3, {props:p, step:0.05, min:0})}
        <div style="padding:5px 8px;background:rgba(77,208,225,0.08);border-radius:4px;border-left:2px solid #4dd0e1;margin-top:6px;">
          <div style="font-size:9px;color:var(--muted);">Gleichzeitige Spitzenlast</div>
          <div style="font-size:13px;font-weight:700;color:#4dd0e1;" id="lade-peak-${id}">${pStd.toFixed(0)} kW</div>
        </div>
        <div class="ins-field-group" style="margin-top:8px;">
          <label class="ins-field-label">Drehung (°)</label>
          <div style="display:flex;align-items:center;gap:6px;">
            <input class="ins-field-input" type="range" min="0" max="360" step="1"
              value="${rot}" data-prop="rotation" data-id="${id}"
              style="flex:1;padding:0;height:22px;cursor:pointer;">
            <span id="lade-rot-val-${id}" style="min-width:30px;font-size:10px;text-align:right;color:var(--muted);">${Math.round(rot)}°</span>
          </div>
        </div>
      `;
    }

    case 'Nsa':
      return row2(
        numField(id, 'leistungKW',  'Leistung (kW)',   100, {props:p}),
        numField(id, 'autonomieH',  'Autonomie (h)',     8, {props:p, step:1})
      ) + selectField(id, 'kraftstoff', 'Kraftstoff',
          [{value:'Diesel',label:'Diesel'},{value:'Gas',label:'Gas'},{value:'HVO',label:'HVO (Biokraftstoff)'}],
          p.kraftstoff || 'Diesel');

    case 'Stromkessel': {
      const linked = asset.linkedErzeuger
        ? `<div style="font-size:9px;color:#80cbc4;margin-bottom:4px;padding:3px 6px;background:rgba(128,203,196,0.1);border-radius:3px;">🔗 Aus dem Erzeuger-Tab synchronisiert</div>`
        : '';
      return linked + numField(id, 'leistungKW', 'El. Leistung (kW)', 200, {props:p});
    }

    case 'KWK': {
      const linked = asset.linkedErzeuger
        ? `<div style="font-size:9px;color:#80cbc4;margin-bottom:4px;padding:3px 6px;background:rgba(128,203,196,0.1);border-radius:3px;">🔗 Aus dem Erzeuger-Tab synchronisiert</div>`
        : '';
      const brennstoff = p.brennstoff || 'Erdgas';
      return linked + row2(
        numField(id, 'leistungElKW',     'El. Leistung (kW)',       100, {props:p}),
        numField(id, 'leistungThKW',     'Th. Leistung (kW)',       160, {props:p})
      ) + row2(
        numField(id, 'wirkungsgradEl',   'El. Wirkungsgrad (%)',     35, {props:p}),
        numField(id, 'wirkungsgradGes',  'Gesamtwirkungsgrad (%)',   85, {props:p})
      ) + selectField(id, 'brennstoff', 'Brennstoff',
          ['Erdgas','Biogas','Wasserstoff','Heizöl'], brennstoff);
    }

    case 'Wind': {
      const ratedKw   = parseFloat(p.leistungKW)        || 500;
      const cutIn     = parseFloat(p.einschaltwindMs)   || 3;
      const ratedWind = parseFloat(p.nennwindMs)        || 12;
      const cutOut    = parseFloat(p.abschaltwindMs)    || 25;
      const rotorD    = parseFloat(p.rotordurchmesserM) || 60;
      const vMean     = parseFloat(p.mittlereWindMs)    || 6.0;
      const wK        = parseFloat(p.weibullK)          || 2.0;
      const mult      = parseFloat(p.abstandMultiplikator) || 5;
      const y = computeWindYield({ vMean, k: wK, ratedKw, cutIn, ratedWind, cutOut, rotorDiameterM: rotorD });
      const rotorFlaeche = Math.PI * Math.pow(rotorD / 2, 2);
      const specWarn = y.spezFlaecheWm2 > 0 && (y.spezFlaecheWm2 < 150 || y.spezFlaecheWm2 > 500)
        ? `<div style="font-size:9px;color:#f9a825;margin-top:4px;">⚠ Unübliches Verhältnis Leistung/Rotorfläche (${y.spezFlaecheWm2.toFixed(0)} W/m²) – Werte prüfen.</div>`
        : '';
      const zielJahresbedarfMWh = _liegenschaftJahresbedarfMWh();
      const maxRadiusM = _distanceToPlangebietM(asset.lat, asset.lng);
      const scen = computeWindScenarios({
        nabenhoheM: parseFloat(p.nabenhoheM) || 100, rotorDurchmesserM: rotorD,
        ratedKw, cutIn, ratedWind, cutOut, vMean, k: wK,
        hellmannAlpha: getWindSiteData()?.alpha ?? 0.2,
        zielJahresbedarfMWh, maxRadiusM, abstandMultiplikator: mult,
      });
      const flaechenHinweis = maxRadiusM == null
        ? 'Kein Plangebiet gezeichnet — nur Marktobergrenze berücksichtigt.'
        : scen.scenMax.flaechenlimitiert
          ? `Flächenlimitiert: ${maxRadiusM.toFixed(0)} m bis Plangebietsgrenze.`
          : 'Marktobergrenze limitiert (Fläche würde mehr zulassen).';
      const bedarfHinweis = zielJahresbedarfMWh > 0
        ? `Ziel: ${zielJahresbedarfMWh.toLocaleString('de-DE',{maximumFractionDigits:0})} MWh/a Liegenschaftsbedarf.`
        : 'Kein Strombedarf ermittelbar (kein Lastgang hinterlegt).';
      return row2(
        numField(id, 'leistungKW',         'Nennleistung (kW)',    500, {props:p}),
        numField(id, 'nabenhoheM',          'Nabenhöhe (m)',        100, {props:p, step:1})
      ) + row2(
        numField(id, 'rotordurchmesserM',  'Rotordurchmesser (m)',  60, {props:p, step:1}),
        numField(id, 'einschaltwindMs',    'Einschaltwind (m/s)',    3, {props:p, step:0.5})
      ) + row2(
        numField(id, 'nennwindMs',         'Nennwind (m/s)',         12, {props:p, step:0.5}),
        numField(id, 'abschaltwindMs',     'Abschaltwind (m/s)',     25, {props:p, step:0.5})
      ) + `<div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 3px;">Ertragsschätzung (Weibull)</div>`
        + row2(
          numField(id, 'mittlereWindMs', 'Ø Windgeschw. Nabenhöhe (m/s)', 6.0, {props:p, step:0.1, min:0}),
          numField(id, 'weibullK',       'Weibull-Formfaktor k',          2.0, {props:p, step:0.1, min:1})
        )
        + `<div class="ins-result-block" style="border-left-color:#4dd0e1;">
            <div class="ins-result-label">Jahresertrag (geschätzt)</div>
            <div class="ins-result-value" style="color:#4dd0e1;">${y.annualMWh.toLocaleString('de-DE',{maximumFractionDigits:1})} MWh/a</div>
            <div class="ins-result-sub">${y.volllaststundenH.toFixed(0)} Volllaststunden/a · Kapazitätsfaktor ${y.kapazitaetsfaktorPct.toFixed(0)} %</div>
            <div class="ins-result-sub">Spez. Flächenleistung: ${y.spezFlaecheWm2.toFixed(0)} W/m² (Rotorfläche ${rotorFlaeche.toFixed(0)} m²)</div>
          </div>`
        + specWarn
        + `<div style="font-size:9px;color:var(--muted);margin-top:6px;">Vereinfachte Schätzung: Weibull-Windverteilung × generische kubische Leistungskurve. Für Genehmigungsunterlagen reale Herstellerkurve + Standortwindgutachten verwenden.</div>`
        + `<div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 3px;">Abstände auf der Karte</div>`
        + numField(id, 'abstandMultiplikator', 'Planungsabstand: x-facher Rotordurchmesser', 5, {props:p, step:0.5, min:1})
        + `<div style="font-size:9px;color:var(--muted);margin:-4px 0 6px;">≈ ${(( parseFloat(p.abstandMultiplikator)||5) * rotorD).toFixed(0)} m Radius — Faustregel für Abstand zu Nachbaranlagen/Bebauung, ersetzt keine Einzelfallprüfung.</div>`
        + checkField(id, 'abstandVisible', 'Abstandsradius auf Karte anzeigen', p.abstandVisible !== false)
        + numField(id, 'windLwa', 'Schallleistungspegel Lwa (dB(A))', calcWindLwaAuto(ratedKw), {props:p, step:1})
        + checkField(id, 'laermVisible', 'Lärmringe auf Karte anzeigen', p.laermVisible === true)
        + checkField(id, 'eignungsflaecheVisible', 'Eignungsfläche auf Karte anzeigen', p.eignungsflaecheVisible === true)
        + _windGebietZeichnenBlock()
        + _windEignungsHinweis(asset)
        + `<div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 0;">Szenarien-Vergleich</div>`
        + `<div style="font-size:9px;color:var(--muted);margin:1px 0 2px;">Gleiche Windkennlinie &amp; spez. Flächenleistung wie oben — nur Größe/Höhe variiert.</div>`
        + _windScenarioRow(scen.scen50)
        + (scen.scenBedarf ? _windScenarioRow(scen.scenBedarf) : `<div style="font-size:9px;color:var(--muted);padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);">Bedarfsgerecht: ${bedarfHinweis}</div>`)
        + (scen.scenBedarf ? `<div style="font-size:9px;color:var(--muted);margin:-3px 0 4px;">${bedarfHinweis}</div>` : '')
        + _windScenarioRow(scen.scenMax)
        + `<div style="font-size:9px;color:var(--muted);margin:-3px 0 4px;">${flaechenHinweis}</div>`;
    }

    default:
      return `<div style="font-size:10px;color:var(--muted);">Keine weiteren Eigenschaften.</div>`;
  }
}

// ── Maßnahmen-Hilfsfunktionen ────────────────────────────────────────────────
function massnahmeId() { return createId('m'); }

const MASSN_STATUS = {
  geplant:    { label: 'Geplant',   color: '#4fc3f7' },
  umgesetzt:  { label: 'Umgesetzt', color: '#4caf50' },
  abgelehnt:  { label: 'Abgelehnt', color: '#9e9e9e' },
};

const MASSN_TYP = {
  Sanierung:     { label: 'Sanierung',    icon: '🔧', hasNewProps: true  },
  Abriss:        { label: 'Abriss',       icon: '🏚', hasNewProps: false },
  Bau:           { label: 'Neubau/Bau',   icon: '🏗', hasNewProps: false },
  Ertuechtigung: { label: 'Ertüchtigung', icon: '⚡', hasNewProps: true  },
};

function _massnRowHtml(m) {
  const s = MASSN_STATUS[m.status] || MASSN_STATUS.geplant;
  const t = MASSN_TYP[m.typ]       || MASSN_TYP.Sonstiges;
  const kosten = m.kosten ? m.kosten.toLocaleString('de-DE') + ' €' : '—';
  return `<div class="ins-massn-row" data-m-id="${m.id}">
    <span class="ins-massn-dot" style="background:${s.color};" title="${s.label}"></span>
    <div class="ins-massn-info">
      <div class="ins-massn-titel">${t.icon} ${esc(m.titel || '—')}</div>
      <div class="ins-massn-meta">${m.jahr || '—'} · ${kosten} · <span class="ins-massn-typ-tag">${t.label}</span></div>
    </div>
    <button class="ins-massn-edit" data-m-id="${m.id}" title="Bearbeiten">✎</button>
    <button class="ins-massn-del"  data-m-id="${m.id}" title="Löschen">×</button>
  </div>`;
}

function buildMassnahmenSection(asset) {
  const list = (asset.massnahmen || []);
  const rows = list.map(_massnRowHtml).join('');

  const typOpts    = Object.entries(MASSN_TYP)
    .map(([v, t]) => `<option value="${v}">${t.icon} ${t.label}</option>`).join('');
  const statusOpts = Object.entries(MASSN_STATUS)
    .map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('');

  return `
    <div class="ins-massn-list" id="ins-massn-list-${asset.id}">${rows || '<div class="ins-massn-empty">Keine Maßnahmen</div>'}</div>
    <button class="ins-massn-add-btn" id="ins-massn-add-${asset.id}">+ Maßnahme hinzufügen</button>
    <div class="ins-massn-form" id="ins-massn-form-${asset.id}" style="display:none;">
      <input class="ins-field-input" type="text" id="mf-titel-${asset.id}" placeholder="Titel der Maßnahme">
      <div class="ins-row-2" style="margin-top:4px;">
        <input class="ins-field-input" type="number" id="mf-jahr-${asset.id}"   placeholder="Jahr">
        <input class="ins-field-input" type="number" id="mf-kosten-${asset.id}" placeholder="Kosten €" min="0">
      </div>
      <div class="ins-row-2" style="margin-top:4px;">
        <select class="ins-field-input" id="mf-typ-${asset.id}">${typOpts}</select>
        <select class="ins-field-input" id="mf-status-${asset.id}">${statusOpts}</select>
      </div>
      <div id="mf-newprops-${asset.id}" style="display:none;"></div>
      <div class="ins-massn-form-btns">
        <button class="ins-massn-form-cancel" id="mf-cancel-${asset.id}">Abbrechen</button>
        <button class="ins-massn-form-save"   id="mf-save-${asset.id}">Speichern</button>
      </div>
    </div>`;
}

function wireMassnahmen(panel, asset) {
  const aid = asset.id;
  let editingId = null;

  function refreshList() {
    const listEl = panel.querySelector(`#ins-massn-list-${aid}`);
    if (!listEl) return;
    const list = asset.massnahmen || [];
    listEl.innerHTML = list.length
      ? list.map(_massnRowHtml).join('')
      : '<div class="ins-massn-empty">Keine Maßnahmen</div>';
    bindRowButtons();
  }

  function updateNewPropsForm(typ) {
    const container = panel.querySelector(`#mf-newprops-${aid}`);
    if (!container) return;
    const typDef = MASSN_TYP[typ];
    if (!typDef?.hasNewProps) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    const schema = ASSET_PROPS_SCHEMA[asset.type] || [];
    if (schema.length === 0) {
      container.innerHTML = `<div class="ins-newprops-label">Keine editierbaren Parameter für diesen Typ.</div>`;
      container.style.display = '';
      return;
    }
    container.innerHTML = `<div class="ins-newprops-label">Ziel-Parameter (optional):</div>` +
      schema.map(s => `<div class="ins-field-group">
        <label class="ins-field-label">${s.label}</label>
        <input class="ins-field-input mf-newprop" type="text" data-prop="${s.key}" placeholder="${s.label}">
      </div>`).join('');
    container.style.display = '';
  }

  function openForm(m) {
    editingId = m ? m.id : null;
    const form = panel.querySelector(`#ins-massn-form-${aid}`);
    form.querySelector(`#mf-titel-${aid}`).value  = m?.titel  || '';
    form.querySelector(`#mf-jahr-${aid}`).value   = m?.jahr   || '';
    form.querySelector(`#mf-kosten-${aid}`).value = m?.kosten || '';
    form.querySelector(`#mf-typ-${aid}`).value    = m?.typ    || 'Sanierung';
    form.querySelector(`#mf-status-${aid}`).value = m?.status || 'geplant';
    updateNewPropsForm(m?.typ || 'Sanierung');
    // Gespeicherte Ziel-Props befüllen
    if (m?.newProps) {
      const container = panel.querySelector(`#mf-newprops-${aid}`);
      container?.querySelectorAll('.mf-newprop').forEach(inp => {
        const key = inp.dataset.prop;
        if (m.newProps[key] !== undefined) inp.value = m.newProps[key];
      });
    }
    form.style.display = '';
    form.querySelector(`#mf-titel-${aid}`).focus();
  }

  function closeForm() {
    editingId = null;
    panel.querySelector(`#ins-massn-form-${aid}`).style.display = 'none';
  }

  function saveForm() {
    const titel  = panel.querySelector(`#mf-titel-${aid}`).value.trim();
    if (!titel) return;
    const jahr   = parseInt(panel.querySelector(`#mf-jahr-${aid}`).value)    || null;
    const kosten = parseFloat(panel.querySelector(`#mf-kosten-${aid}`).value) || 0;
    const typ    = panel.querySelector(`#mf-typ-${aid}`).value;
    const status = panel.querySelector(`#mf-status-${aid}`).value;

    // Ziel-Parameter einsammeln
    const newProps = {};
    if (MASSN_TYP[typ]?.hasNewProps) {
      panel.querySelector(`#mf-newprops-${aid}`)?.querySelectorAll('.mf-newprop').forEach(inp => {
        const key = inp.dataset.prop;
        const v = inp.value.trim();
        if (v !== '') {
          const n = parseFloat(v);
          newProps[key] = isNaN(n) ? v : n;
        }
      });
    }

    if (!asset.massnahmen) asset.massnahmen = [];
    if (editingId) {
      const m = asset.massnahmen.find(x => x.id === editingId);
      if (m) Object.assign(m, { titel, jahr, kosten, typ, status, newProps });
      // dependsOn/phaseId werden durch das Board (M5+) gesetzt, hier nur als Default sichern
      if (!m.dependsOn) m.dependsOn = [];
      if (m.phaseId === undefined) m.phaseId = null;
    } else {
      asset.massnahmen.push({ id: massnahmeId(), titel, jahr, kosten, typ, status, newProps, dependsOn: [], phaseId: null });
    }
    closeForm();
    refreshList();
    drawAssetMarker(asset); // Marker-Badge aktualisieren
  }

  function bindRowButtons() {
    panel.querySelectorAll('.ins-massn-edit').forEach(btn => {
      btn.onclick = () => {
        const m = (asset.massnahmen || []).find(x => x.id === btn.dataset.mId);
        if (m) openForm(m);
      };
    });
    panel.querySelectorAll('.ins-massn-del').forEach(btn => {
      btn.onclick = () => {
        asset.massnahmen = (asset.massnahmen || []).filter(x => x.id !== btn.dataset.mId);
        refreshList();
        drawAssetMarker(asset); // Marker-Badge aktualisieren
      };
    });
  }

  panel.querySelector(`#ins-massn-add-${aid}`)?.addEventListener('click', () => openForm(null));
  panel.querySelector(`#mf-cancel-${aid}`)?.addEventListener('click',  closeForm);
  panel.querySelector(`#mf-save-${aid}`)?.addEventListener('click',    saveForm);
  panel.querySelector(`#mf-typ-${aid}`)?.addEventListener('change', e => updateNewPropsForm(e.target.value));
  panel.querySelector(`#ins-massn-form-${aid}`)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveForm();
    if (e.key === 'Escape') closeForm();
  });
  bindRowButtons();
}

// ── Investitionsplan ─────────────────────────────────────────────────────────
export function showInvestitionsplan() {
  const allAssets = (typeof window !== 'undefined' && window.ASSETS?.items)
    ? window.ASSETS.items
    : (typeof ASSETS !== 'undefined' ? ASSETS.items : []);

  const rows = [];
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      rows.push({ asset: a, m });
    }
  }

  if (rows.length === 0) {
    const overlay = document.createElement('div');
    overlay.className = 'ep-modal-overlay';
    overlay.innerHTML = `<div class="ep-modal">
      <div class="ep-modal-title">Investitionsplan</div>
      <div class="ep-modal-body">Keine Maßnahmen vorhanden.<br>Öffne eine Anlage oder Netzkomponente und füge Maßnahmen hinzu.</div>
      <div class="ep-modal-btns"><button class="ep-modal-btn primary" id="inv-close">Schließen</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#inv-close').onclick = () => document.body.removeChild(overlay);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) document.body.removeChild(overlay); });
    return;
  }

  rows.sort((a, b) => (a.m.jahr || 9999) - (b.m.jahr || 9999));

  // Jahres-Gruppen
  const byYear = new Map();
  for (const r of rows) {
    const y = r.m.jahr || '—';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }

  let tableHtml = '';
  let total = 0;
  for (const [year, yearRows] of byYear) {
    const yearTotal = yearRows.reduce((s, r) => s + (r.m.kosten || 0), 0);
    total += yearTotal;
    tableHtml += `<tr class="inv-year-header"><td colspan="5">${year}
      <span class="inv-year-total">${yearTotal.toLocaleString('de-DE')} €</span></td></tr>`;
    for (const r of yearRows) {
      const s = MASSN_STATUS[r.m.status] || MASSN_STATUS.geplant;
      const t = MASSN_TYP[r.m.typ]       || MASSN_TYP.Sonstiges;
      tableHtml += `<tr>
        <td><span class="ins-massn-dot" style="background:${s.color};display:inline-block;"></span> ${esc(r.asset.name)}</td>
        <td>${esc(r.m.titel || '—')}</td>
        <td style="font-size:9px;white-space:nowrap;">${t.icon} ${t.label}</td>
        <td class="inv-num">${r.m.kosten ? r.m.kosten.toLocaleString('de-DE') + ' €' : '—'}</td>
        <td><span style="color:${s.color};font-size:9px;">${s.label}</span></td>
      </tr>`;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'ep-modal-overlay';
  overlay.innerHTML = `<div class="ep-modal inv-modal">
    <div class="ep-modal-title">📋 Investitionsplan
      <span class="inv-total-badge">${total.toLocaleString('de-DE')} €</span>
    </div>
    <div class="inv-table-wrap">
      <table class="inv-table">
        <thead><tr><th>Anlage/Komponente</th><th>Maßnahme</th><th>Typ</th><th class="inv-num">Kosten</th><th>Status</th></tr></thead>
        <tbody>${tableHtml}</tbody>
      </table>
    </div>
    <div class="ep-modal-btns" style="margin-top:12px;">
      <button class="ep-modal-btn primary" id="inv-close">Schließen</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#inv-close').onclick = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', ev => { if (ev.target === overlay) document.body.removeChild(overlay); });
}

// ── Berechnungsergebnis-Block ────────────────────────────────────────────────
function buildResultBlock(asset) {
  const sn = (window.stromNodes || []).find(n => n.id === asset.id);
  if (!sn || sn._voltDropV == null) return '';
  const dU_pct = (sn._voltDropV / 400) * 100;
  const col = Math.abs(dU_pct) > 5 ? '#e53935' : Math.abs(dU_pct) > 3 ? '#f9a825' : '#4caf50';
  return `<div class="ins-result-block" style="border-left-color:${col};">
    <div class="ins-result-label">Kum. Spannungsfall ab Trafo</div>
    <div class="ins-result-value" style="color:${col};">${dU_pct.toFixed(2)} %</div>
    <div class="ins-result-sub">${sn._voltDropV.toFixed(1)} V &nbsp;(Grenze: 3 % / 5 %)</div>
  </div>`;
}

// ── Gebäude-Zuordnung (editierbares Dropdown) ────────────────────────────────
function buildBuildingSelect(asset) {
  const buildings = (window.gebaeude || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const opts = buildings.map(g =>
    `<option value="${g.id}"${asset.buildingId === g.id ? ' selected' : ''}>${esc(g.name)}</option>`
  ).join('');
  return `<div class="ins-field-group">
    <label class="ins-field-label">🏢 Gebäude</label>
    <select class="ins-field-input" data-field="buildingId">
      <option value=""${!asset.buildingId ? ' selected' : ''}>— Frei (kein Gebäude)</option>
      ${opts}
    </select>
  </div>`;
}

// ── PV-Erzeugungsprofil ──────────────────────────────────────────────────────
function _buildPvProfileSection(assetId) {
  return `
    <div class="ins-section-header" data-target="ins-sec-pvprofil">
      <span class="asset-ins-section-title">☀ Erzeugungsprofil</span>
      <span class="ins-section-chevron">▾</span>
    </div>
    <div class="ins-section-content" id="ins-sec-pvprofil">
      <canvas id="pv-profile-canvas-${assetId}"
        style="width:100%;height:64px;border-radius:4px;display:block;
               background:rgba(255,255,255,0.04);margin-bottom:6px;"></canvas>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:10px;">
        <div><div style="color:var(--muted);font-size:9px;">Jahresertrag</div>
             <div id="pv-prof-annual-${assetId}"
               style="font-family:'DM Mono',monospace;color:#ffd54f;">—</div></div>
        <div><div style="color:var(--muted);font-size:9px;">Spez. Ertrag</div>
             <div id="pv-prof-spez-${assetId}"
               style="font-family:'DM Mono',monospace;color:#ffd54f;">—</div></div>
        <div><div style="color:var(--muted);font-size:9px;">Ausrichtung</div>
             <div id="pv-prof-aus-${assetId}"
               style="font-family:'DM Mono',monospace;color:var(--text);">—</div></div>
      </div>
    </div>`;
}

function _drawPvInspectorChart(panel, asset) {
  const p      = asset.props || {};
  const kwp    = parseFloat(p.leistungKWp) || 10;
  const aus    = p.ausrichtung || 'sued';
  const spez   = parseFloat(p.pvSpez) || (_PV_SPEZ_DEFAULT[aus] || 1050);
  const aid    = asset.id;

  // KPI-Labels setzen
  const annMwh = kwp * spez / 1000;
  const annEl  = panel.querySelector(`#pv-prof-annual-${aid}`);
  const spezEl = panel.querySelector(`#pv-prof-spez-${aid}`);
  const ausEl  = panel.querySelector(`#pv-prof-aus-${aid}`);
  if (annEl)  annEl.textContent  = annMwh.toFixed(1) + ' MWh/a';
  if (spezEl) spezEl.textContent = spez.toFixed(0) + ' kWh/kWp·a';
  if (ausEl)  ausEl.textContent  = aus === 'ostwest' ? 'Ost-West' : 'Süd';

  // Monatsprofil berechnen
  const profile = asset._pvProfile?.[aus] ?? (function() {
    const pr = makePvProfile8760(aus);
    if (!asset._pvProfile) asset._pvProfile = {};
    asset._pvProfile[aus] = pr;
    return pr;
  })();

  const MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const MLBL  = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const mKwh  = new Array(12).fill(0);
  let ptr = 0;
  for (let m = 0; m < 12; m++) {
    const hrs = MDAYS[m] * 24;
    for (let i = 0; i < hrs && ptr < profile.length; i++, ptr++) {
      mKwh[m] += profile[ptr] * kwp * spez;
    }
  }

  // Canvas zeichnen
  const cv = panel.querySelector(`#pv-profile-canvas-${aid}`);
  if (!cv) return;
  const W  = cv.offsetWidth || 260;
  const H  = 64;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, W, H);

  const mMax = Math.max(...mKwh);
  if (mMax <= 0) return;

  const barW = Math.floor((W - 24) / 12);
  const gap  = Math.max(1, Math.floor((W - 24 - barW * 12) / 11));

  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (let m = 0; m < 12; m++) {
    const x  = 12 + m * (barW + gap);
    const bH = Math.max(1, (mKwh[m] / mMax) * (H - 16));
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(x, H - 14 - bH, barW, bH);
    // Monatswert über dem Balken (nur wenn Platz)
    if (bH > 12) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(Math.round(mKwh[m] / 1000), x + barW / 2, H - 16 - bH + 10);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(MLBL[m], x + barW / 2, H - 2);
  }

  // Jahressumme rechts oben
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,213,79,0.7)';
  ctx.font = '9px sans-serif';
  ctx.fillText((mKwh.reduce((a,b) => a+b,0) / 1000).toFixed(0) + ' MWh', W - 4, 11);
}

// ── Wind-Erzeugungsprofil (synthetisches 8760h-Profil, siehe 13q-wind-ertrag.js) ──
function _buildWindProfileSection(assetId) {
  return `
    <div class="ins-section-header" data-target="ins-sec-windprofil">
      <span class="asset-ins-section-title">🌀 Erzeugungsprofil</span>
      <span class="ins-section-chevron">▾</span>
    </div>
    <div class="ins-section-content" id="ins-sec-windprofil">
      <canvas id="wind-profile-canvas-${assetId}"
        style="width:100%;height:64px;border-radius:4px;display:block;
               background:rgba(255,255,255,0.04);margin-bottom:6px;"></canvas>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:10px;">
        <div><div style="color:var(--muted);font-size:9px;">Jahresertrag</div>
             <div id="wind-prof-annual-${assetId}"
               style="font-family:'DM Mono',monospace;color:#4dd0e1;">—</div></div>
        <div><div style="color:var(--muted);font-size:9px;">Volllaststunden</div>
             <div id="wind-prof-vlh-${assetId}"
               style="font-family:'DM Mono',monospace;color:#4dd0e1;">—</div></div>
        <div><div style="color:var(--muted);font-size:9px;">Kapazitätsfaktor</div>
             <div id="wind-prof-kf-${assetId}"
               style="font-family:'DM Mono',monospace;color:var(--text);">—</div></div>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-top:4px;">${(() => {
        const s = getWindSiteData();
        return s
          ? `<span style="color:#4dd0e1;">🌐 Reale ERA5-Windreihe ${s.profilJahr}</span> (Ø ${s.vMean100.toFixed(1)} m/s @ 100 m, auf Nabenhöhe extrapoliert, α ${s.alpha.toFixed(2)}). Wird für alle Analysen verwendet.`
          : 'Synthetisch aus Weibull-Verteilung + Wind-Persistenz (AR(1)) — keine reale Wetterzeitreihe. Über die Windanalyse lassen sich echte Standortdaten (ERA5) laden.';
      })()}</div>
    </div>`;
}

function _drawWindInspectorChart(panel, asset) {
  const p = asset.props || {};
  const ratedKw   = parseFloat(p.leistungKW)        || 500;
  const aid       = asset.id;

  // Reale ERA5-Stundenreihe wenn Standortdaten geladen, sonst synthetisches Weibull-Profil
  const profile = windProfileForAsset(asset);
  let sumKwh = 0;
  for (let i = 0; i < profile.length; i++) sumKwh += profile[i];
  const annMwh = sumKwh / 1000;
  const vlh = ratedKw > 0 ? sumKwh / ratedKw : 0;
  const kf  = (vlh / 8760) * 100;

  const annEl = panel.querySelector(`#wind-prof-annual-${aid}`);
  const vlhEl = panel.querySelector(`#wind-prof-vlh-${aid}`);
  const kfEl  = panel.querySelector(`#wind-prof-kf-${aid}`);
  if (annEl) annEl.textContent = annMwh.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MWh/a';
  if (vlhEl) vlhEl.textContent = vlh.toFixed(0) + ' h/a';
  if (kfEl)  kfEl.textContent  = kf.toFixed(0) + ' %';

  const MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const MLBL  = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const mKwh  = new Array(12).fill(0);
  let ptr = 0;
  for (let m = 0; m < 12; m++) {
    const hrs = MDAYS[m] * 24;
    for (let i = 0; i < hrs && ptr < profile.length; i++, ptr++) mKwh[m] += profile[ptr];
  }

  const cv = panel.querySelector(`#wind-profile-canvas-${aid}`);
  if (!cv) return;
  const W = cv.offsetWidth || 260;
  const H = 64;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, W, H);

  const mMax = Math.max(...mKwh);
  if (mMax <= 0) return;

  const barW = Math.floor((W - 24) / 12);
  const gap  = Math.max(1, Math.floor((W - 24 - barW * 12) / 11));

  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (let m = 0; m < 12; m++) {
    const x  = 12 + m * (barW + gap);
    const bH = Math.max(1, (mKwh[m] / mMax) * (H - 16));
    ctx.fillStyle = '#4dd0e1';
    ctx.fillRect(x, H - 14 - bH, barW, bH);
    if (bH > 12) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(Math.round(mKwh[m] / 1000), x + barW / 2, H - 16 - bH + 10);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(MLBL[m], x + barW / 2, H - 2);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(77,208,225,0.7)';
  ctx.font = '9px sans-serif';
  ctx.fillText((mKwh.reduce((a,b) => a+b,0) / 1000).toFixed(0) + ' MWh', W - 4, 11);
}

// ── Lade-Asset: Zeitprofil (3-Szenario 24h-Canvas-Editor) ───────────────────

const LADE_DEFAULT_PROFIL = {
  WT: [0.06,0.05,0.05,0.05,0.06,0.10,0.30,0.65,0.85,0.70,0.55,0.50,0.45,0.45,0.55,0.70,0.80,0.95,0.90,0.75,0.55,0.35,0.20,0.10],
  Sa: [0.05,0.05,0.05,0.05,0.05,0.05,0.10,0.20,0.45,0.65,0.75,0.78,0.75,0.70,0.65,0.60,0.65,0.75,0.70,0.55,0.40,0.25,0.15,0.05],
  So: [0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.10,0.25,0.45,0.55,0.60,0.58,0.55,0.50,0.45,0.50,0.55,0.50,0.38,0.28,0.18,0.10,0.05],
};

function _buildLadeZeitprofilSection(id) {
  return `
    <div class="ins-section-header" data-target="ins-sec-zeitprofil-${id}">
      <span class="asset-ins-section-title">🕐 Zeitprofil</span>
      <span class="ins-section-chevron">▾</span>
    </div>
    <div class="ins-section-content" id="ins-sec-zeitprofil-${id}">
      <div class="lade-zp-tabs" id="lade-zp-tabs-${id}">
        <button class="lade-zp-tab active" data-tab="WT">Werktag</button>
        <button class="lade-zp-tab" data-tab="Sa">Samstag</button>
        <button class="lade-zp-tab" data-tab="So">Sonntag</button>
      </div>
      <canvas id="lade-zp-canvas-${id}"
        style="width:100%;height:80px;display:block;border-radius:4px;
               background:rgba(255,255,255,0.03);cursor:crosshair;
               margin-top:2px;touch-action:none;"></canvas>
      <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px;color:var(--muted);">
        <span id="lade-zp-avg-${id}">Ø —</span>
        <span id="lade-zp-max-${id}">Max —</span>
        <span id="lade-zp-kwh-${id}">— kWh/d</span>
      </div>
      <button class="ins-link-btn" id="lade-zp-reset-${id}" style="margin-top:4px;">↺ Standardprofil laden</button>
    </div>`;
}

function _wireLadeProps(panel, asset) {
  const id = asset.id;

  // Drehung: live update + Marker neu zeichnen
  const rotSlider = panel.querySelector(`[data-prop="rotation"][data-id="${id}"]`);
  const rotVal    = panel.querySelector(`#lade-rot-val-${id}`);
  if (rotSlider) {
    rotSlider.addEventListener('input', () => {
      const v = parseFloat(rotSlider.value) || 0;
      asset.props.rotation = v;
      if (rotVal) rotVal.textContent = Math.round(v) + '°';
      updateLadeParking(asset);  // nur Polygone neu — kein Marker-Flicker
    });
  }

  // Marker neu zeichnen wenn Stellplatzanzahl ändert
  const punkEl = panel.querySelector(`[data-prop="anzahlPunkte"][data-id="${id}"]`);
  if (punkEl) punkEl.addEventListener('change', () => drawAssetMarker(asset));

  // Spitzenlast-Anzeige live aktualisieren wenn Leistungsparameter sich ändern
  function _updatePeak() {
    const p    = asset.props;
    const gzf  = Math.min(1, Math.max(0, parseFloat(p.gleichzeitigFaktor) || 0.3));
    const pStd = (parseInt(p.anzahlPunkte)||8) * (parseFloat(p.leistungProPunktKW)||11) * gzf;
    const peakEl = panel.querySelector(`#lade-peak-${id}`);
    if (peakEl) peakEl.textContent = pStd.toFixed(0) + ' kW';
  }

  ['anzahlPunkte','leistungProPunktKW','gleichzeitigFaktor']
    .forEach(key => {
      const el = panel.querySelector(`[data-prop="${key}"][data-id="${id}"]`);
      if (el) el.addEventListener('change', _updatePeak);
    });
}

function _wireZeitprofil(panel, asset) {
  const id = asset.id;

  // Default-Profil initialisieren falls noch nicht vorhanden
  if (!asset.props.zeitprofil) {
    asset.props.zeitprofil = {
      WT: [...LADE_DEFAULT_PROFIL.WT],
      Sa: [...LADE_DEFAULT_PROFIL.Sa],
      So: [...LADE_DEFAULT_PROFIL.So],
    };
  }

  let currentTab = 'WT';
  const canvas   = panel.querySelector(`#lade-zp-canvas-${id}`);
  if (!canvas) return;

  function getProfile() { return asset.props.zeitprofil[currentTab]; }

  function updateKpi() {
    const prof   = getProfile();
    const avg    = prof.reduce((a, b) => a + b, 0) / 24;
    const max    = Math.max(...prof);
    const gzf    = Math.min(1, Math.max(0, parseFloat(asset.props.gleichzeitigFaktor) || 0.3));
    const pStd   = (parseInt(asset.props.anzahlPunkte)||8) * (parseFloat(asset.props.leistungProPunktKW)||11) * gzf;
    const pSch   = (parseInt(asset.props.anzahlSchnell)||2) * (parseFloat(asset.props.leistungSchnellKW)||150);
    const kwhDay = avg * (pStd + pSch) * 24;
    const avgEl  = panel.querySelector(`#lade-zp-avg-${id}`);
    const maxEl  = panel.querySelector(`#lade-zp-max-${id}`);
    const kwhEl  = panel.querySelector(`#lade-zp-kwh-${id}`);
    if (avgEl)  avgEl.textContent  = `Ø ${Math.round(avg * 100)} %`;
    if (maxEl)  maxEl.textContent  = `Max ${Math.round(max * 100)} %`;
    if (kwhEl)  kwhEl.textContent  = `${kwhDay.toFixed(0)} kWh/d`;
  }

  function drawChart() {
    const W = canvas.offsetWidth || 240;
    const H = canvas.offsetHeight || 80;
    canvas.width  = W;
    canvas.height = H;
    const ctx  = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const prof  = getProfile();
    const barW  = W / 24;
    const GAP   = 1;
    const maxH  = H - 13;

    // Stunden-Labels (0, 6, 12, 18)
    ctx.font      = '8px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.textAlign = 'center';
    [0, 6, 12, 18].forEach(h => {
      ctx.fillText(h + 'h', h * barW + barW / 2, H - 2);
    });

    // Balken
    for (let h = 0; h < 24; h++) {
      const v  = prof[h];
      const bH = Math.max(1, Math.round(v * maxH));
      const x  = h * barW + GAP / 2;
      const bW = barW - GAP;
      const y  = maxH - bH;
      ctx.fillStyle = `rgba(77,208,225,${0.25 + v * 0.75})`;
      ctx.fillRect(Math.round(x), y, Math.ceil(bW), bH);
    }

    // Aktuell bearbeiteter Balken-Index markieren (Hover-Cursor-Hilfe)
    // Durchschnittslinie
    const avg  = prof.reduce((a, b) => a + b, 0) / 24;
    const avgY = maxH - Math.round(avg * maxH);
    ctx.strokeStyle = 'rgba(77,208,225,0.35)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, avgY);
    ctx.lineTo(W, avgY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function setBarAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x    = clientX - rect.left;
    const y    = clientY - rect.top;
    const bar  = Math.min(23, Math.max(0, Math.floor(x / (rect.width / 24))));
    const maxH = rect.height - 13;
    const val  = Math.min(1, Math.max(0, 1 - y / maxH));
    getProfile()[bar] = Math.round(val * 20) / 20; // auf 5 % runden
    drawChart();
    updateKpi();
  }

  let dragging = false;
  canvas.addEventListener('mousedown', e => { dragging = true; setBarAt(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove', e => {
    if (!dragging || e.buttons === 0) { dragging = false; return; }
    setBarAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseup',    () => { dragging = false; });
  canvas.addEventListener('mouseleave', () => { dragging = false; });
  canvas.addEventListener('touchstart', e => { dragging = true; setBarAt(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { if (!dragging) return; setBarAt(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend',   () => { dragging = false; });

  // Tab-Wechsel
  const tabs = panel.querySelector(`#lade-zp-tabs-${id}`);
  tabs?.querySelectorAll('.lade-zp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.lade-zp-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      drawChart();
      updateKpi();
    });
  });

  // Standardprofil zurücksetzen
  panel.querySelector(`#lade-zp-reset-${id}`)?.addEventListener('click', () => {
    asset.props.zeitprofil[currentTab] = [...LADE_DEFAULT_PROFIL[currentTab]];
    drawChart();
    updateKpi();
  });

  drawChart();
  updateKpi();
}

// ── Gemeinsamer Rumpf (floating panel + sidebar card) ────────────────────────
function buildBodyHtml(asset) {
  return `
    <div class="ins-field-group">
      <label class="ins-field-label">Name</label>
      <input class="ins-field-input" type="text" data-field="name" value="${esc(asset.name)}">
    </div>
    ${buildBuildingSelect(asset)}
    <div class="ins-row-2">
      <div class="ins-field-group">
        <label class="ins-field-label">Baujahr</label>
        <input class="ins-field-input" type="number" data-field="baujahr"
          value="${asset.baujahr ?? ''}" placeholder="—">
      </div>
      <div class="ins-field-group">
        <label class="ins-field-label">Abrissjahr</label>
        <input class="ins-field-input" type="number" data-field="abrissjahr"
          value="${asset.abrissjahr ?? ''}" placeholder="—">
      </div>
    </div>
    <div class="asset-ins-section-title">Eigenschaften</div>
    ${buildPropsForm(asset)}
    ${buildResultBlock(asset)}
    ${buildMassnahmenSection(asset)}
    <div class="ins-meta" style="margin-top:12px;">ID: ${asset.id} · ${asset.domain}</div>
    ${_renderAssetFelddaten(asset)}`;
}

// ── Haupt-Render (floating panel, für Rückwärtskompatibilität) ───────────────
function renderInspector(asset) {
  const panel = getPanel();
  if (!panel) return;
  const cfg = ASSET_CFG[asset.type];

  panel.innerHTML = `
    <button class="sb-asset-back-btn" id="sb-asset-back">← Alle Anlagen</button>
    <div class="asset-ins-header" style="background:${cfg.color};">
      <span class="asset-ins-icon">${cfg.icon}</span>
      <span class="asset-ins-title">${cfg.label}</span>
      <button onclick="toggleVormerkenAsset('${asset.id}')" title="${asset.feldVorgemerkt ? 'Vorgemerkt – klicken zum Entfernen' : 'Für Feldbegehung vormerken'}" style="background:none;border:none;cursor:pointer;margin-left:auto;font-size:${asset.feldVorgemerkt ? 16 : 13}px;color:${asset.feldVorgemerkt ? '#f59e0b' : '#888'};padding:0 6px;line-height:1;">★</button>
      <button onclick="openKnotenanalyseFor('${asset.id}')" title="Knotenpunkt-Analyse öffnen"
        style="background:rgba(0,0,0,0.25);border:1px solid rgba(79,195,247,0.45);border-radius:4px;
        cursor:pointer;color:#4fc3f7;padding:2px 7px;line-height:1;font-size:13px;margin-right:4px;">📈</button>
    </div>
    <div class="asset-ins-body">
      <div class="ins-field-group">
        <label class="ins-field-label">Name</label>
        <input class="ins-field-input" type="text" data-field="name" value="${esc(asset.name)}">
      </div>
      ${buildBuildingSelect(asset)}
      <div class="ins-row-2">
        <div class="ins-field-group">
          <label class="ins-field-label">Baujahr</label>
          <input class="ins-field-input" type="number" data-field="baujahr"
            value="${asset.baujahr ?? ''}" placeholder="—">
        </div>
        <div class="ins-field-group">
          <label class="ins-field-label">Abrissjahr</label>
          <input class="ins-field-input" type="number" data-field="abrissjahr"
            value="${asset.abrissjahr ?? ''}" placeholder="—">
        </div>
      </div>
      ${buildSchichtSelect(asset)}
      <div class="ins-section-header" data-target="ins-sec-eigenschaften">
        <span class="asset-ins-section-title">Eigenschaften</span>
        <span class="ins-section-chevron">▾</span>
      </div>
      <div class="ins-section-content" id="ins-sec-eigenschaften">
        ${buildPropsForm(asset)}
        ${buildResultBlock(asset)}
      </div>
      ${asset.type === 'PV'   ? _buildPvProfileSection(asset.id)      : ''}
      ${asset.type === 'Wind' ? _buildWindProfileSection(asset.id)    : ''}
      ${asset.type === 'Lade' ? _buildLadeZeitprofilSection(asset.id) : ''}
      <div class="ins-section-header" data-target="ins-sec-massnahmen">
        <span class="asset-ins-section-title">Maßnahmen</span>
        <span class="ins-section-chevron">▾</span>
      </div>
      <div class="ins-section-content" id="ins-sec-massnahmen">
        ${buildMassnahmenSection(asset)}
      </div>
      <div class="ins-meta" style="margin-top:12px;">ID: ${asset.id} · ${asset.domain}</div>
      ${_renderAssetFelddaten(asset)}
      <button class="asset-ins-delete" data-action="delete">🗑 Löschen</button>
    </div>
  `;

  panel.querySelector('#sb-asset-back')?.addEventListener('click', closeAssetInspector);
  wireSectionToggles(panel);
  wireEvents(panel, asset);
  wireMassnahmen(panel, asset);
  if (asset.type === 'PV') requestAnimationFrame(() => _drawPvInspectorChart(panel, asset));
  if (asset.type === 'Wind') requestAnimationFrame(() => _drawWindInspectorChart(panel, asset));
  if (asset.type === 'Lade') {
    _wireLadeProps(panel, asset);
    requestAnimationFrame(() => _wireZeitprofil(panel, asset));
  }
}

// ── Asset-Sidebar ─────────────────────────────────────────────────────────────
const TYPE_ORDER = ['NAP','Schaltanlage','Trafo','NSHV','UV','Verbraucher','Lade','TWW','PV','Wind','Batterie','WP','Geo','FG','KWK','Stromkessel','Nsa'];

export function renderAssetSidebar(filterText) {
  const container = document.getElementById('asset-sidebar-list');
  if (!container) return;

  // Zähler im Tab aktualisieren
  const cntEl = document.getElementById('asset-count');
  if (cntEl) cntEl.textContent = (ASSETS.items || []).length;

  const ft = (filterText ?? document.getElementById('asset-filter')?.value ?? '').toLowerCase();
  const items = (ASSETS.items || []).filter(a => !ft || (a.name || '').toLowerCase().includes(ft));

  // Nach Typ gruppieren
  const groups = {};
  for (const a of items) {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  }

  let html = '';
  for (const type of TYPE_ORDER) {
    if (!groups[type]) continue;
    const cfg = ASSET_CFG[type];
    const sorted = groups[type].slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    html += `<div class="asb-group">
      <div class="asb-group-hdr" style="border-left:3px solid ${cfg.color};">
        <span>${cfg.icon}</span>
        <span class="asb-group-lbl">${cfg.label}</span>
        <span class="asb-group-cnt">${sorted.length}</span>
      </div>`;
    for (const a of sorted) {
      const isOpen = ASSETS.selectedId === a.id;
      html += `<div class="asb-card${isOpen ? ' asb-open' : ''}" id="asb-card-${a.id}">
        <div class="asb-card-hdr" data-asid="${a.id}">
          <span class="asb-card-ico">${cfg.icon}</span>
          <span class="asb-card-name">${esc(a.name)}</span>
          <span class="asb-card-chev">${isOpen ? '▲' : '▼'}</span>
        </div>
        ${isOpen ? `<div class="asb-card-body">
          ${buildBodyHtml(a)}
          <button class="asb-card-del" data-asid="${a.id}">🗑 Löschen</button>
        </div>` : ''}
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html || '<div class="asb-empty">Keine Anlagen oder Netzkomponenten vorhanden.</div>';

  // Events für geöffnete Karte verdrahten
  if (ASSETS.selectedId) {
    const selAsset = (ASSETS.items || []).find(a => a.id === ASSETS.selectedId);
    const card = document.getElementById(`asb-card-${ASSETS.selectedId}`);
    if (selAsset && card) {
      wireEvents(card, selAsset);
      wireMassnahmen(card, selAsset);
      // Toggle-Buttons in Sidebar auch neu rendern
      card.querySelectorAll('.ins-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selAsset.props[btn.dataset.prop] = btn.dataset.val;
          renderAssetSidebar();
        });
      });
    }
  }

  // Karten-Header-Klick: auf-/zuklappen
  container.querySelectorAll('.asb-card-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const id = hdr.dataset.asid;
      ASSETS.selectedId = ASSETS.selectedId === id ? null : id;
      redrawAllAssets();
      renderAssetSidebar();
      if (ASSETS.selectedId) {
        const card = document.getElementById(`asb-card-${ASSETS.selectedId}`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  // Löschen-Buttons
  container.querySelectorAll('.asb-card-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const asset = (ASSETS.items || []).find(a => a.id === btn.dataset.asid);
      if (!asset) return;
      if (!confirm(`Anlage/Komponente „${asset.name}“ wirklich löschen?`)) return;
      if (typeof window.removeStromNode === 'function') window.removeStromNode(asset.id);
      deleteAsset(asset.id);
      redrawAllAssets();
      ASSETS.selectedId = null;
      renderAssetSidebar();
    });
  });
}

export function filterAssetSidebar(text) {
  renderAssetSidebar(text);
}

function wireEvents(panel, asset) {
  // Textfelder, Zahlenfelder, Gebäude-Zuweisung
  panel.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('change', () => {
      const f = inp.dataset.field;
      if (f === 'name') {
        asset.name = inp.value;
      } else if (f === 'baujahr' || f === 'abrissjahr') {
        asset[f] = inp.value === '' ? null : parseInt(inp.value);
        drawAssetMarker(asset);
      } else if (f === 'buildingId') {
        asset.buildingId = inp.value || null;
        redrawAllAssets();
      } else if (f === 'schicht') {
        asset.schicht = normSchicht(inp.value);
        renderInspector(asset);   // Farbmarkierung des Feldes mitziehen
        redrawAllAssets();
      }
    });
  });

  // Props: Zahlfelder und Selects
  panel.querySelectorAll('[data-prop][data-id]').forEach(el => {
    const key = el.dataset.prop;
    const handler = () => {
      if (el.type === 'checkbox') {
        asset.props[key] = el.checked;
      } else if (el.tagName === 'SELECT') {
        const rawVal = el.value;
        const numVal = parseFloat(rawVal);
        asset.props[key] = isNaN(numVal) ? rawVal : numVal;
      } else {
        const v = el.value === '' ? null : parseFloat(el.value);
        asset.props[key] = v;
      }
      // PV-Profil bei Props-Änderung neu zeichnen
      if (asset.type === 'PV' && ['leistungKWp','ausrichtung','pvSpez'].includes(key)) {
        asset._pvProfile = null; // Cache invalidieren
        _drawPvInspectorChart(panel, asset);
      }
      // TWW: Leistung hängt von mehreren Feldern + Netz-VL ab → Panel neu aufbauen
      if (asset.type === 'TWW') renderInspector(asset);
      // Wind: Ertragsschätzung hängt von mehreren Feldern ab → Panel neu aufbauen;
      // Abstands-/Lärmringe auf der Karte ebenfalls aktualisieren
      if (asset.type === 'Wind') { drawAssetMarker(asset); renderInspector(asset); }
    };
    el.addEventListener('change', handler);
  });

  // Toggle-Buttons (Batterie Betriebsmodus) — im floating panel: Panel neu rendern
  panel.querySelectorAll('.ins-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      asset.props[btn.dataset.prop] = btn.dataset.val;
      if (panel.id === 'asset-inspector') renderInspector(asset);
    });
  });

  // SLP-Profil-Viewer öffnen (liest slpTyp aus aktuellem Select-Wert)
  panel.querySelectorAll('[data-slp-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = panel.querySelector('[data-prop="slpTyp"]');
      const typ = sel ? sel.value : (btn.dataset.slpOpen || 'G0');
      openSlpEditor(typ);
    });
  });

  panel.querySelectorAll('[data-action="close"]').forEach(b =>
    b.addEventListener('click', closeAssetInspector));

  panel.querySelectorAll('[data-action="delete"]').forEach(b =>
    b.addEventListener('click', () => {
      if (typeof window.removeStromNode === 'function') window.removeStromNode(asset.id);
      deleteAsset(asset.id);
      redrawAllAssets();
      closeAssetInspector();
    }));
}

// Window-Bridge
setTimeout(() => {
  window.openAssetInspector     = openAssetInspector;
  window.closeAssetInspector    = closeAssetInspector;
  window.showInvestitionsplan   = showInvestitionsplan;
  window.renderSidebarAssetList = renderSidebarAssetList;
  window.renderAssetSidebar     = renderAssetSidebar;
  window.filterAssetSidebar     = filterAssetSidebar;
  window.zoomToWindEignungsflaeche = zoomToWindEignungsflaeche;
  window.toggleDrawWindGebiet = toggleDrawWindGebiet;
  window.clearWindGebiet      = clearWindGebiet;
  window._onWindGebietChanged = onWindGebietChanged;
}, 0);

// Windgebiet wurde gezeichnet/geändert/gelöscht: alle Wind-Assets (Abstands-/Lärmringe,
// Eignungsfläche) neu berechnen + offenen Inspector aktualisieren.
function onWindGebietChanged() {
  for (const a of (ASSETS.items || [])) {
    if (a.type === 'Wind') drawAssetMarker(a);
  }
  if (ASSETS.selectedId) {
    const sel = (ASSETS.items || []).find(a => a.id === ASSETS.selectedId);
    if (sel && sel.type === 'Wind') renderInspector(sel);
  }
}

// ── Vormerken Asset ───────────────────────────────────────────────────────────
export function toggleVormerkenAsset(id) {
  const a = ASSETS.items.find(x => x.id === id);
  if (!a) return;
  a.feldVorgemerkt = !a.feldVorgemerkt;
  renderSidebarAssetList();
  // Inspector neu rendern falls gerade offen
  const panel = document.getElementById('sb-asset-inspector-slot')?.querySelector('[data-asset-id="' + id + '"]');
  if (ASSETS.selectedId === id && typeof renderInspector === 'function') {
    renderInspector(a);
  }
}
window.toggleVormerkenAsset = toggleVormerkenAsset;

// ── Felddaten-Block im Asset-Inspector ───────────────────────────────────────
function _renderAssetFelddaten(a) {
  if (!a.feldNotizen && !a.feldStatus && !a.feldFotos?.length) return '';
  const labels = { offen: '📋 Offen', besucht: '👁 Besucht', erledigt: '✅ Erledigt' };
  const statusLabel = labels[a.feldStatus] || '';
  const notizHtml = a.feldNotizen
    ? '<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:6px 10px;border-radius:0 6px 6px 0;font-size:11px;color:#1a1a2e;white-space:pre-wrap;margin-bottom:6px;">' + esc(a.feldNotizen) + '</div>'
    : '';
  const fotoHtml = (a.feldFotos || []).map(foto =>
    '<img src="' + foto.dataUrl + '" title="' + esc(foto.name) + '" style="width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid #2a3352;" onclick="openImageLightbox(this.src,this.title)">'
  ).join('');
  return '<div style="margin:8px 0;padding:8px 10px;background:var(--surface2,#1e2433);border-radius:8px;border:1px solid #2a3352;">'
    + '<div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px;">📱 FELDDATEN' + (statusLabel ? ' · ' + statusLabel : '') + '</div>'
    + notizHtml
    + (fotoHtml ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">' + fotoHtml + '</div>' : '')
    + '</div>';
}
