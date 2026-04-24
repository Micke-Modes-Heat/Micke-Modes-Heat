// ── 14b-stromnetz-state.js — Strom-spezifischer State + Effektiv-Berechnung
// Portiert aus Standalone-Elektroteil (EL-State ~5055–5100 + Effektiv-Funktionen ~5115–5144).
// STROMNETZ ist getrennt von ASSETS, weil Trassen/Szenarien/MS-Ringe ausschließlich Strom betreffen.
// Leitungen selbst liegen in ASSETS.edges[] mit domain:'strom', damit Wärme später
// dieselbe Edge-Struktur nutzen kann.

import { ASSETS } from './13a-assets-core.js';

// ── Single Source of Truth für Strom-Netzplanung ───────────────────────────
export const STROMNETZ = {
  // Trassen = Pfade, denen Leitungen folgen können (Routing-Basis)
  trassen: [],   // {id, pts:[[lat,lng],...], _poly, _editMarkers:[]}

  // Draw-State für Karten-Werkzeuge (wird in 3.2 verdrahtet)
  mode:          null,   // 'trasse' | 'leitung' | null
  pendingType:   null,   // Asset-Typ aus Palette
  trDraw: { pts:[], poly:null, snapPt:null, snapMarker:null, previewLine:null },
  ltDraw: { startId:null },

  // Auswahl
  selectedKind: null,   // 'asset' | 'leitung'

  // Leaflet-LayerGroups (werden in 3.2 initialisiert)
  grpTrasse:  null,
  grpLeitung: null,

  // Letztes Berechnungsergebnis (wird in 3.2 befüllt)
  calcResult: null,
  voltageProfile: false,

  // Szenarien (Varianten für Was-wäre-wenn)
  szenarien:     [],    // [{id, name, farbe, assets, leitungen, removedAssets, removedLeitungen}]
  aktivSzenario: null,  // ID oder null = Bestand

  // MS-Netz-Analyse (Ringe im 20-kV-Bereich)
  msRings:          [], // Erkannte MS-Ringe
  _msRingLayer:     null,
  _msHoverOverride: null,

  // Lastprofil-Vorlagen (wiederverwendbar, projekt-weit)
  profileTemplates: [],

  // Heatmap-Einstellungen (in 3.6 genutzt)
  _heatmapActive:           false,
  _heatmapLayerVisibility:  { load: true, gen: true },
  _heatmapMode:             'relief',
  _heatmapShowContours:     true,
  _heatmapReliefCfg:        { kernelRadiusM: 90, gridPx: 10, minAlpha: 0.04, maxAlpha: 0.78 },
  _heatmapRefreshPending:   false,
};

// ── Effektiv-Werte: Maßnahmen bis zum Jahr `year` anwenden ──────────────────

// Asset-Props nach allen Maßnahmen ≤ year, inkl. Baujahr-Update bei 'Austausch'
export function getEffectiveAssetProps(a, year) {
  const props = Object.assign({}, a.props || {});
  let baujahr = a.baujahr;
  if (!a.massnahmen || !a.massnahmen.length) return { props, baujahr };

  const applied = a.massnahmen
    .filter(m => parseInt(m.jahr) <= year)
    .sort((x, y) => parseInt(x.jahr) - parseInt(y.jahr));

  for (const m of applied) {
    if (m.typ === 'Austausch') baujahr = parseInt(m.jahr);
    if (m.eigenschaft && m.wertNeu != null && m.wertNeu !== '') {
      props[m.eigenschaft] = m.wertNeu;
    }
  }
  return { props, baujahr };
}

// Leitungs-Querschnitt + Parallelkabel-Anzahl nach allen Maßnahmen ≤ year
export function getEffectiveLeitungQs(lt, year) {
  let qs = lt.qs || 50;
  let pc = lt.parallelCount || 1;
  if (!lt.massnahmen || !lt.massnahmen.length) return { qs, pc };

  const applied = lt.massnahmen
    .filter(m => parseInt(m.jahr) <= year)
    .sort((x, y) => parseInt(x.jahr) - parseInt(y.jahr));

  for (const m of applied) {
    if (m.eigenschaft === 'qs'            && m.wertNeu != null) qs = parseInt(m.wertNeu);
    if (m.eigenschaft === 'parallelCount' && m.wertNeu != null) pc = parseInt(m.wertNeu);
  }
  return { qs, pc };
}

// ── Trassen-CRUD ────────────────────────────────────────────────────────────
export function trassenUid() { return 'tr_' + Math.random().toString(36).slice(2, 9); }

export function createTrasse(pts, opts = {}) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const tr = {
    id:  opts.id || trassenUid(),
    pts: pts.map(p => [p[0], p[1]]),
    _poly: null,
    _editMarkers: [],
  };
  STROMNETZ.trassen.push(tr);
  return tr;
}

export function deleteTrasse(id) {
  const i = STROMNETZ.trassen.findIndex(t => t.id === id);
  if (i < 0) return false;
  const tr = STROMNETZ.trassen[i];
  if (tr._poly && tr._poly.remove) tr._poly.remove();
  for (const m of (tr._editMarkers || [])) { if (m && m.remove) m.remove(); }
  STROMNETZ.trassen.splice(i, 1);
  return true;
}

// ── Leitungen (Strom-Kanten in ASSETS.edges) ────────────────────────────────
// ASSETS.edges[] wird auch von zukünftigen Wärme-Leitungen genutzt; Strom-Filter via domain.
// createStromLeitung und Helper kapseln das Schema.

export function leitungUid() { return 'lt_' + Math.random().toString(36).slice(2, 9); }

export function listStromLeitungen() {
  return ASSETS.edges.filter(e => e.domain === 'strom');
}

export function createStromLeitung(aId, bId, opts = {}) {
  const edge = {
    id:            opts.id || leitungUid(),
    domain:        'strom',
    aId, bId,
    route:         opts.route         || [],
    qs:            opts.qs            || 50,
    parallelCount: opts.parallelCount || 1,
    baujahr:       opts.baujahr       || null,
    abrissjahr:    opts.abrissjahr    || null,
    massnahmen:    opts.massnahmen    || [],
    _poly:         null,
    _result:       null,
  };
  ASSETS.edges.push(edge);
  return edge;
}

export function deleteStromLeitung(id) {
  const i = ASSETS.edges.findIndex(e => e.id === id);
  if (i < 0) return false;
  const e = ASSETS.edges[i];
  if (e._poly && e._poly.remove) e._poly.remove();
  ASSETS.edges.splice(i, 1);
  return true;
}
