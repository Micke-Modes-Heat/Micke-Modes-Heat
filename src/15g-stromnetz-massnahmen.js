// ── 15g-stromnetz-massnahmen.js — Maßnahmen + Lebenszyklus-Synchronisation ──
// Portiert aus Standalone-Elektroteil:
//   - Maßnahmen-CRUD (Inspector ~9514–9839)
//   - elSyncBuildingToAssets (~11688)
//   - elRenderMaßnahmenplan-Datenpfad (~11526) → ohne UI
//
// Maßnahmen-Schema (auf Asset.massnahmen[] und Leitung.massnahmen[]):
//   { jahr, typ, eigenschaft, wertNeu, sim, kosten, notiz }
//     typ:        'Austausch' setzt baujahr neu | 'Modifikation' nur Property-Update
//     eigenschaft: Property-Key (z.B. 'leistungKW', 'qs', 'parallelCount')
//     wertNeu:    neuer Wert (string/number)
//     sim:        bool — simulationsrelevant (false = nur dokumentarisch)
//     kosten:     €
//     notiz:      Freitext
//
// Effektiv-Werte werden in 14b berechnet (getEffectiveAssetProps/getEffectiveLeitungQs).

import { ASSETS, getAsset } from './13a-assets-core.js';
import { listStromLeitungen } from './14b-stromnetz-state.js';
import { MASSNAHMEN_SIM_PROPS } from './14a-stromnetz-config.js';
import { getMergedAssets, getMergedStromLeitungen } from './15e-stromnetz-szenarien.js';
import { drawLeitung, leitungInheritLifecycle } from './15a-stromnetz-render.js';
import { drawAssetMarker } from './13b-assets-render.js';

function massnahmeUid() { return 'm_' + Math.random().toString(36).slice(2, 9); }

// ════════════════════════════════════════════════════════════════════════════
// CRUD — Asset-Maßnahmen
// ════════════════════════════════════════════════════════════════════════════
export function addAssetMassnahme(assetId, massnahme) {
  const a = getAsset(assetId);
  if (!a) return null;
  if (!a.massnahmen) a.massnahmen = [];
  const m = normalizeMassnahme(massnahme);
  a.massnahmen.push(m);
  return m;
}

export function updateAssetMassnahme(assetId, massnahmeId, patch) {
  const a = getAsset(assetId);
  if (!a || !a.massnahmen) return null;
  const m = a.massnahmen.find(x => x.id === massnahmeId);
  if (!m) return null;
  Object.assign(m, normalizeMassnahme({ ...m, ...patch }));
  return m;
}

export function removeAssetMassnahme(assetId, massnahmeId) {
  const a = getAsset(assetId);
  if (!a || !a.massnahmen) return false;
  const i = a.massnahmen.findIndex(x => x.id === massnahmeId);
  if (i < 0) return false;
  a.massnahmen.splice(i, 1);
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD — Leitungs-Maßnahmen
// ════════════════════════════════════════════════════════════════════════════
function getStromLeitung(leitungId) {
  return ASSETS.edges.find(e => e.id === leitungId && e.domain === 'strom') || null;
}

export function addLeitungMassnahme(leitungId, massnahme) {
  const lt = getStromLeitung(leitungId);
  if (!lt) return null;
  if (!lt.massnahmen) lt.massnahmen = [];
  const m = normalizeMassnahme(massnahme);
  lt.massnahmen.push(m);
  return m;
}

export function updateLeitungMassnahme(leitungId, massnahmeId, patch) {
  const lt = getStromLeitung(leitungId);
  if (!lt || !lt.massnahmen) return null;
  const m = lt.massnahmen.find(x => x.id === massnahmeId);
  if (!m) return null;
  Object.assign(m, normalizeMassnahme({ ...m, ...patch }));
  return m;
}

export function removeLeitungMassnahme(leitungId, massnahmeId) {
  const lt = getStromLeitung(leitungId);
  if (!lt || !lt.massnahmen) return false;
  const i = lt.massnahmen.findIndex(x => x.id === massnahmeId);
  if (i < 0) return false;
  lt.massnahmen.splice(i, 1);
  return true;
}

// ── Defaults setzen ─────────────────────────────────────────────────────────
function normalizeMassnahme(m) {
  return {
    id:          m.id          || massnahmeUid(),
    jahr:        parseInt(m.jahr) || new Date().getFullYear(),
    typ:         m.typ         || 'Modifikation',
    eigenschaft: m.eigenschaft || null,
    wertNeu:     m.wertNeu     ?? null,
    sim:         m.sim ?? true,
    kosten:      parseFloat(m.kosten) || 0,
    notiz:       m.notiz       || '',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GLOBALER MAßNAHMENPLAN (Datenpfad, ohne UI)
// ════════════════════════════════════════════════════════════════════════════
// Liefert flache, nach Jahr sortierte Liste:
//   [{ jahr, kategorie, objektId, objektName, typ, detail, sim, kosten, notiz }]
//
// kategorie ∈ { 'asset', 'leitung', 'gebaeude-sanierung', 'gebaeude-abriss' }
export function buildMassnahmenplan() {
  const entries = [];
  const allAssets    = getMergedAssets();
  const allLeitungen = getMergedStromLeitungen();
  const gebs = (typeof window !== 'undefined' && window.gebaeude) || [];

  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      const propCfg = MASSNAHMEN_SIM_PROPS[a.type] || [];
      const propLabel = propCfg.find(p => p.key === m.eigenschaft)?.label || m.eigenschaft || '';
      const detail = m.typ === 'Austausch'
        ? 'Austausch'
        : `${propLabel}: → ${m.wertNeu != null ? m.wertNeu : '–'}${m.sim ? '' : ' (dok.)'}`;
      entries.push({
        jahr: parseInt(m.jahr), kategorie: 'asset',
        objektId: a.id, objektName: a.name,
        typ: m.typ, detail, sim: !!m.sim, kosten: m.kosten || 0, notiz: m.notiz || '',
      });
    }
  }

  for (const lt of allLeitungen) {
    const aName = allAssets.find(a => a.id === lt.aId)?.name || '';
    const bName = allAssets.find(a => a.id === lt.bId)?.name || '';
    const ltName = `Leitung ${aName}–${bName}`;
    for (const m of (lt.massnahmen || [])) {
      const propCfg = MASSNAHMEN_SIM_PROPS['Leitung'] || [];
      const propLabel = propCfg.find(p => p.key === m.eigenschaft)?.label || m.eigenschaft || '';
      const detail = m.typ === 'Austausch'
        ? 'Austausch'
        : `${propLabel}: → ${m.wertNeu != null ? m.wertNeu : '–'}${m.sim ? '' : ' (dok.)'}`;
      entries.push({
        jahr: parseInt(m.jahr), kategorie: 'leitung',
        objektId: lt.id, objektName: ltName,
        typ: m.typ, detail, sim: !!m.sim, kosten: m.kosten || 0, notiz: m.notiz || '',
      });
    }
  }

  for (const g of gebs) {
    for (const s of (g.sanierungen || [])) {
      entries.push({
        jahr: parseInt(s.jahr), kategorie: 'gebaeude-sanierung',
        objektId: g.id, objektName: g.name,
        typ: 'Sanierung', detail: `Sanierung → ${s.zielSpez} kWh/m²a`,
        sim: true, kosten: 0, notiz: '',
      });
    }
    if (g.abrissjahr) {
      entries.push({
        jahr: parseInt(g.abrissjahr), kategorie: 'gebaeude-abriss',
        objektId: g.id, objektName: g.name,
        typ: 'Abriss', detail: 'Abriss',
        sim: true, kosten: 0, notiz: '',
      });
    }
  }

  entries.sort((a, b) => a.jahr - b.jahr || a.objektName.localeCompare(b.objektName));
  return entries;
}

// ════════════════════════════════════════════════════════════════════════════
// LEBENSZYKLUS-SYNCHRONISATION: Gebäude → Assets + Leitungen
// ════════════════════════════════════════════════════════════════════════════
// Wenn ein Gebäude Baujahr/Abrissjahr ändert, übernehmen alle verknüpften
// Assets und ihre Leitungen denselben Lebenszyklus.
// Re-Render passiert sofort, recalcStromnetz() muss extern getriggert werden.
export function syncBuildingToAssets(buildingId, baujahr, abrissjahr) {
  if (!buildingId) return { affectedAssets: 0, affectedLeitungen: 0 };
  const affected = ASSETS.items.filter(a => a.buildingId === buildingId);
  if (affected.length === 0) return { affectedAssets: 0, affectedLeitungen: 0 };

  for (const a of affected) {
    a.baujahr    = baujahr    ?? null;
    a.abrissjahr = abrissjahr ?? null;
    if (a._marker) drawAssetMarker(a);
  }
  // Leitungen, die verbundene Assets haben: Lebenszyklus neu ableiten
  const affIds = new Set(affected.map(a => a.id));
  const leitungen = listStromLeitungen();
  let nLt = 0;
  for (const lt of leitungen) {
    if (affIds.has(lt.aId) || affIds.has(lt.bId)) {
      leitungInheritLifecycle(lt);
      drawLeitung(lt);
      nLt++;
    }
  }
  return { affectedAssets: affected.length, affectedLeitungen: nLt };
}

// ════════════════════════════════════════════════════════════════════════════
// LASTENTWICKLUNG ÜBER JAHRE (für Investitionsplanung)
// ════════════════════════════════════════════════════════════════════════════
// Liefert für jedes Jahr im Bereich [startYr, endYr] eine Zeile mit
// assetCount/leitungCount (aktive zu dem Zeitpunkt).
// Kann pro Jahr auch recalcStromnetz aufrufen — aber default deaktiviert
// (teuer, Aufrufer entscheidet).
export function calcLastentwicklung(startYr, endYr, opts = {}) {
  const rows = [];
  const allAssets    = getMergedAssets();
  const allLeitungen = getMergedStromLeitungen();

  for (let yr = startYr; yr <= endYr; yr++) {
    const activeA = allAssets.filter(a => isActiveInYear(a, yr));
    const activeL = allLeitungen.filter(l => isActiveInYear(l, yr));
    rows.push({
      year: yr,
      assetCount:    activeA.length,
      leitungCount:  activeL.length,
      newAssets:     allAssets   .filter(a => parseInt(a.baujahr) === yr).length,
      removedAssets: allAssets   .filter(a => parseInt(a.abrissjahr) === yr).length,
      newLeitungen:  allLeitungen.filter(l => parseInt(l.baujahr) === yr).length,
      removedLeitungen: allLeitungen.filter(l => parseInt(l.abrissjahr) === yr).length,
    });
  }
  return rows;
}

function isActiveInYear(item, yr) {
  const bj = item.baujahr    ? parseInt(item.baujahr)    : null;
  const aj = item.abrissjahr ? parseInt(item.abrissjahr) : null;
  if (bj && yr < bj) return false;
  if (aj && yr >= aj) return false;
  return true;
}
