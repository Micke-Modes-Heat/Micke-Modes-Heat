// ── 15e-stromnetz-szenarien.js — Planungsszenarien als Delta auf Bestand ────
// Portiert aus Standalone-Elektroteil (~11890–12100).
//
// Datenmodell:
//   STROMNETZ.szenarien[]   = [{id, name, farbe, assets[], leitungen[],
//                               removedAssets[], removedLeitungen[]}]
//   STROMNETZ.aktivSzenario = null  →  reiner Bestand
//                          oder ID  →  Bestand + Szenario-Delta
//
// Bestand = ASSETS.items + listStromLeitungen()
// Aktives Szenario fügt eigene Items hinzu und maskiert removed-Items.
//
// Vereinfachungen vs Standalone:
//   - Keine Gebäude-Szenarien (gebaudeData/removedGebaeude) — gehören
//     ins Wärme-Modul, nicht hier.
//   - Keine UI (renderCtrlStrip, Pills, Popup) — kommt mit UI-Phase.
//   - Keine Side-Effects auf Marker/Leitungen beim Aktivieren —
//     Re-Render macht der Aufrufer (z.B. redrawAllStromnetz, recalcStromnetz).

import { ASSETS } from './13a-assets-core.js';
import { STROMNETZ, listStromLeitungen, leitungUid } from './14b-stromnetz-state.js';

// ── Farb-Palette für Szenarien ──────────────────────────────────────────────
export const SZ_FARBEN = ['#42a5f5', '#ef5350', '#66bb6a', '#ffa726',
                          '#ab47bc', '#26c6da', '#d4e157', '#ec407a'];

function szUid() { return 'sz_' + Math.random().toString(36).slice(2, 9); }

// ── CRUD ────────────────────────────────────────────────────────────────────
export function createSzenario(name) {
  const sz = {
    id:               szUid(),
    name:             name || `Szenario ${STROMNETZ.szenarien.length + 1}`,
    farbe:            SZ_FARBEN[STROMNETZ.szenarien.length % SZ_FARBEN.length],
    assets:           [],   // Asset-Objekte (gleiches Schema wie ASSETS.items)
    leitungen:        [],   // Leitungs-Objekte (gleiches Schema wie ASSETS.edges Strom)
    removedAssets:    [],   // IDs aus ASSETS.items, die im Szenario maskiert sind
    removedLeitungen: [],   // IDs aus Strom-Leitungen, die im Szenario maskiert sind
  };
  STROMNETZ.szenarien.push(sz);
  return sz;
}

export function activateSzenario(id) {
  STROMNETZ.aktivSzenario = id || null;
  return getActiveSzenario();
}

export function deleteSzenario(id) {
  if (STROMNETZ.aktivSzenario === id) STROMNETZ.aktivSzenario = null;
  const i = STROMNETZ.szenarien.findIndex(s => s.id === id);
  if (i >= 0) STROMNETZ.szenarien.splice(i, 1);
  return true;
}

export function getActiveSzenario() {
  if (!STROMNETZ.aktivSzenario) return null;
  return STROMNETZ.szenarien.find(s => s.id === STROMNETZ.aktivSzenario) || null;
}

export function listSzenarien() {
  return STROMNETZ.szenarien.slice();
}

// ── Merged-Listen für Simulation/Rendering ──────────────────────────────────
// Nutzen recalcStromnetz und SLD, damit das aktive Szenario automatisch wirkt.
export function getMergedAssets() {
  const sz = getActiveSzenario();
  if (!sz) return ASSETS.items;
  const removed = new Set(sz.removedAssets);
  return [...ASSETS.items.filter(a => !removed.has(a.id)), ...sz.assets];
}

export function getMergedStromLeitungen() {
  const sz = getActiveSzenario();
  const bestand = listStromLeitungen();
  if (!sz) return bestand;
  const removed = new Set(sz.removedLeitungen);
  return [...bestand.filter(l => !removed.has(l.id)), ...sz.leitungen];
}

// ── Element im aktiven Szenario maskieren / wiederherstellen ────────────────
export function removeFromSzenario(id, kind) {
  const sz = getActiveSzenario();
  if (!sz) return false;
  if (kind === 'asset') {
    if (!sz.removedAssets.includes(id)) sz.removedAssets.push(id);
    return true;
  }
  if (kind === 'leitung') {
    if (!sz.removedLeitungen.includes(id)) sz.removedLeitungen.push(id);
    return true;
  }
  return false;
}

export function restoreInSzenario(id, kind) {
  const sz = getActiveSzenario();
  if (!sz) return false;
  if (kind === 'asset') {
    sz.removedAssets = sz.removedAssets.filter(x => x !== id);
    return true;
  }
  if (kind === 'leitung') {
    sz.removedLeitungen = sz.removedLeitungen.filter(x => x !== id);
    return true;
  }
  return false;
}

// ── Element direkt zum aktiven Szenario hinzufügen ──────────────────────────
// (CRUD für Szenario-Inhalt; falls kein Szenario aktiv → Bestand)
export function createAssetInActiveSzenario(asset) {
  const sz = getActiveSzenario();
  if (!sz) {
    ASSETS.items.push(asset);
    return { container: 'bestand', asset };
  }
  asset._szId = sz.id;
  sz.assets.push(asset);
  return { container: 'szenario', szenarioId: sz.id, asset };
}

export function createLeitungInActiveSzenario(aId, bId, opts = {}) {
  const sz = getActiveSzenario();
  const lt = {
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
  if (!sz) {
    ASSETS.edges.push(lt);
    return { container: 'bestand', leitung: lt };
  }
  lt._szId = sz.id;
  sz.leitungen.push(lt);
  return { container: 'szenario', szenarioId: sz.id, leitung: lt };
}

// ── Statistik für UI/Pills ──────────────────────────────────────────────────
export function getSzenarioStats(sz) {
  if (!sz) return null;
  return {
    nAssets:    sz.assets.length,
    nLeitungen: sz.leitungen.length,
    nRemoved:   sz.removedAssets.length + sz.removedLeitungen.length,
  };
}
