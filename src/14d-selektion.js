// ── 14d-selektion.js — Asset-Selektion + Elektro-Bulk-Bar ────────────────────
// M5: assetSelection-State; Shift+Click + Box-Selektion auf Karte;
//     Checkboxen in Sidebar; schwebende Bulk-Bar mit Sammelaktionen.

import { ASSETS, ASSET_CFG, TYPE_RANK } from './13a-assets-core.js';
import { phasen, massnahmeJahr, setPhasen } from './01-globals-varianten.js';
import { MASSN_VORLAGEN, MASSN_VORLAGEN_REIHENFOLGE } from './config/massnahmen-vorlagen.js';
import { redrawAllAssets } from './13b-assets-render.js';

// ── Selektions-State ──────────────────────────────────────────────────────────

// Stabile Referenz — wird immer mutiert (clear/add), nie ersetzt, damit window.assetSelection
// (und alle Marker-Render-Pfade) immer dasselbe, aktuelle Set sehen.
export const assetSelection = new Set();
export let bulkModeActive  = false;

// Live-Getter für andere Module (z. B. Marker-Rendering in 13b) — eine reassignte
// `export let`-Variable würde auf window.* veralten, eine Funktion liest immer aktuell.
export function isBulkModeActive() { return bulkModeActive; }

export function selToggle(id) {
  if (assetSelection.has(id)) assetSelection.delete(id);
  else assetSelection.add(id);
  _afterSelChange();
}

export function selAdd(id) {
  assetSelection.add(id);
  _afterSelChange();
}

export function selRemove(id) {
  assetSelection.delete(id);
  _afterSelChange();
}

export function selSet(ids) {
  assetSelection.clear();
  for (const id of ids) assetSelection.add(id);
  _afterSelChange();
}

export function selClear() {
  assetSelection.clear();
  _afterSelChange();
}

// ── Bulk-Modus ────────────────────────────────────────────────────────────────

// Vorheriger Sichtbarkeits-Zustand der Elektro-Asset-Ebene (zum Wiederherstellen).
let _prevAssetLayerVisible = null;

export function selToggleBulkMode() {
  bulkModeActive = !bulkModeActive;
  if (!bulkModeActive) {
    assetSelection.clear(); // Selektion beim Deaktivieren leeren
  }
  _applyBulkModeView();
  _refreshDimming();
  _updateBulkModeToggleBtn();
  selRenderBulkBar();
}

export function selSetBulkMode(active) {
  if (bulkModeActive === active) return;
  bulkModeActive = active;
  if (!active) assetSelection.clear();
  _applyBulkModeView();
  _refreshDimming();
  _updateBulkModeToggleBtn();
  selRenderBulkBar();
}

// Erzwingt im Bulk-Modus die Sichtbarkeit der Elektro-Asset-Ebene (sonst keine Marker
// zum Anklicken) und reduziert die Karte per CSS-Isolation. Beim Verlassen wird der
// vorherige Ansicht-Zustand wiederhergestellt.
function _applyBulkModeView() {
  if (bulkModeActive) {
    // Vorherigen Zustand merken und Asset-Ebene einschalten
    if (_prevAssetLayerVisible === null && typeof window.isAssetLayerVisible === 'function') {
      _prevAssetLayerVisible = window.isAssetLayerVisible();
    }
    if (typeof window.setAssetLayerVisible === 'function') window.setAssetLayerVisible(true);
    const cb = document.getElementById('el-assets-visible');
    if (cb) cb.checked = true;
  } else if (_prevAssetLayerVisible !== null) {
    // Vorherigen Zustand wiederherstellen
    if (typeof window.setAssetLayerVisible === 'function') window.setAssetLayerVisible(_prevAssetLayerVisible);
    const cb = document.getElementById('el-assets-visible');
    if (cb) cb.checked = _prevAssetLayerVisible;
    _prevAssetLayerVisible = null;
  }

  // Karte auf Elektro-Assets reduzieren (CSS-Isolation via .bulk-isolate)
  const mapEl = window._appLeafletMap?.getContainer?.();
  if (mapEl) mapEl.classList.toggle('bulk-isolate', bulkModeActive);
}

function _updateBulkModeToggleBtn() {
  const btn  = document.getElementById('bulk-mode-toggle');
  const list = document.getElementById('sb-asset-list');
  if (btn) {
    btn.textContent       = bulkModeActive ? '◉ Bulk-Modus AN' : '◎ Bulk-Modus';
    btn.style.background  = bulkModeActive ? 'rgba(33,150,243,.22)' : '';
    btn.style.color       = bulkModeActive ? '#4fc3f7' : '';
    btn.style.borderColor = bulkModeActive ? '#4fc3f7' : '';
  }
  if (list) list.classList.toggle('bulk-active', bulkModeActive);
}

// ── Dimming: nicht-selektierte Marker ausgrauen (wie „abgerissen") ────────────
// Arbeitet auf der Marker-Wrapper-Ebene (.leaflet-marker-icon), damit es auch für
// gebäudegruppierte Chip-Marker funktioniert (mehrere Assets teilen einen Marker).
// Ein Marker gilt als selektiert, sobald mindestens eines seiner Assets selektiert ist.

function _refreshDimming() {
  const iconHasSel = new Map(); // markerIcon-Element → ob ein Asset darauf selektiert ist
  for (const a of ASSETS.items) {
    const icon = a._marker?._icon;
    if (!icon) continue;
    if (!iconHasSel.has(icon)) iconHasSel.set(icon, false);
    if (assetSelection.has(a.id)) iconHasSel.set(icon, true);
  }
  for (const [icon, hasSel] of iconHasSel) {
    icon.classList.toggle('asset-bulk-dimmed', bulkModeActive && !hasSel);
  }
}

export function selRefreshMarkerDim() {
  _refreshDimming();
}

export function selHas(id) {
  return assetSelection.has(id);
}

export function selGetAssets() {
  return ASSETS.items.filter(a => assetSelection.has(a.id));
}

// Aus Merit-Order-Ergebnis füllen (window._lastMeritOrderResult, gesetzt von pvRunMeritOrder)
export function selFromMeritOrderTier(tier) {
  const result = window._lastMeritOrderResult;
  if (!result?.ranking) {
    console.warn('selFromMeritOrderTier: kein Merit-Order-Ergebnis (pvRunMeritOrder() zuerst aufrufen)');
    return;
  }
  const ids = result.ranking
    .filter(r => r.tier === tier && r.kandidat?.refId)
    .map(r => r.kandidat.refId);
  selSet(ids);
}

// ── Topologie-Filter: Assets hinter einem Objekt selektieren ──────────────────
// Baut denselben gerichteten Eltern-Kind-Baum wie das SLD (13f): jeder Knoten hat
// genau ein Elternteil. Damit bleibt die Auswahl strikt im Teilbaum unter der Wurzel
// und läuft nicht über gleichrangige Kanten (z. B. NSHV↔NSHV) in Nachbarzweige.
function _buildTopologyTree() {
  const assetMap = new Map(ASSETS.items.map(a => [a.id, a]));
  const edges = (window.stromEdges || []).filter(e => assetMap.has(e.u) && assetMap.has(e.v));
  const children = new Map(ASSETS.items.map(a => [a.id, []]));
  const parentOf = new Map();

  const link = (srcId, snkId) => {
    if (parentOf.has(snkId)) return;            // genau ein Elternteil (erste Zuweisung gewinnt)
    parentOf.set(snkId, srcId);
    if (!children.get(srcId).includes(snkId)) children.get(srcId).push(snkId);
  };

  // Pass 1: Kanten mit unterschiedlichem Rang → klare Hierarchie (niedriger Rang = Elternteil)
  for (const e of edges) {
    const rA = TYPE_RANK[assetMap.get(e.u).type] ?? 6;
    const rB = TYPE_RANK[assetMap.get(e.v).type] ?? 6;
    if (rA === rB) continue;
    const [srcId, snkId] = rA < rB ? [e.u, e.v] : [e.v, e.u];
    link(srcId, snkId);
  }
  // Pass 2: gleichrangige Kanten → Richtung anhand bereits etablierter Elternschaft
  for (const e of edges) {
    const rA = TYPE_RANK[assetMap.get(e.u).type] ?? 6;
    const rB = TYPE_RANK[assetMap.get(e.v).type] ?? 6;
    if (rA !== rB) continue;
    const aHasParent = parentOf.has(e.u);
    const bHasParent = parentOf.has(e.v);
    if      ( aHasParent && !bHasParent) link(e.u, e.v);
    else if (!aHasParent &&  bHasParent) link(e.v, e.u);
  }
  return { children, assetMap };
}

// Alle Assets im Teilbaum unter rootId (echte nachgelagerte Objekte).
function _bfsDownstreamAssets(rootId) {
  const { children, assetMap } = _buildTopologyTree();
  const visited = new Set([rootId]);
  const stack   = [...(children.get(rootId) || [])];
  const found   = [];
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const a = assetMap.get(id);
    if (a) found.push(a);
    for (const c of (children.get(id) || [])) if (!visited.has(c)) stack.push(c);
  }
  return found;
}

// Selektiert alle Assets vom Typ typeFilter ('' = alle), die hinter rootId hängen.
export function selFilterDownstream(rootId, typeFilter) {
  if (!rootId) return;
  const downstream = _bfsDownstreamAssets(rootId);
  const matches = typeFilter
    ? downstream.filter(a => a.type === typeFilter)
    : downstream;
  selSet(matches.map(a => a.id));
  return matches.length;
}

// Aus den Bulk-Bar-Dropdowns lesen und filtern (aufgerufen aus HTML).
export function selBulkFilterApply() {
  const rootId = document.getElementById('asset-bulk-filter-root')?.value || '';
  const typ    = document.getElementById('asset-bulk-filter-type')?.value || '';
  if (!rootId) {
    const msg = document.getElementById('bulk-confirm-msg');
    if (msg) {
      msg.textContent = '(Objekt wählen)';
      msg.style.display = 'inline';
      msg.style.color = 'var(--muted)';
      clearTimeout(msg._tid);
      msg._tid = setTimeout(() => { msg.style.display = 'none'; }, 2500);
    }
    return;
  }
  const n = selFilterDownstream(rootId, typ);
  const msg = document.getElementById('bulk-confirm-msg');
  if (msg) {
    msg.textContent = `${n} Objekt${n !== 1 ? 'e' : ''} selektiert`;
    msg.style.display = 'inline';
    msg.style.color = n > 0 ? '#4caf50' : 'var(--muted)';
    clearTimeout(msg._tid);
    msg._tid = setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
}

// ── Interner After-Change-Handler ─────────────────────────────────────────────

function _afterSelChange() {
  _refreshSelectedRings();
  _refreshDimming();
  selRenderBulkBar();
  // Sidebar-Liste refreshen (leichtgewichtig: nur Checkbox-State)
  _refreshSidebarCheckboxes();
}

// ── Marker-Ring-Update (ohne vollen Redraw) ───────────────────────────────────

function _applyRing(asset) {
  const el = asset._marker?._icon?.querySelector('.asset-marker');
  if (!el) return;
  if (assetSelection.has(asset.id)) el.classList.add('asset-selected');
  else el.classList.remove('asset-selected');
}

function _refreshSelectedRings() {
  for (const a of ASSETS.items) _applyRing(a);
}

export function selRefreshMarkerRing(asset) {
  _applyRing(asset);
}

// ── Sidebar-Checkboxen refresh (kein Re-Render der ganzen Liste) ──────────────

function _refreshSidebarCheckboxes() {
  const container = document.getElementById('sb-asset-list');
  if (!container) return;
  container.querySelectorAll('.sb-asset-cb').forEach(cb => {
    const id = cb.closest('[data-asset-id]')?.dataset.assetId;
    if (id) cb.checked = assetSelection.has(id);
  });
}

// ── Bulk-Bar ──────────────────────────────────────────────────────────────────

export function selRenderBulkBar() {
  const bar = document.getElementById('asset-bulk-bar');
  if (!bar) return;

  const selAssets = selGetAssets();
  const count     = selAssets.length;

  if (count === 0 && !bulkModeActive) {
    bar.style.display = 'none';
    return;
  }

  const totalKwp = selAssets.reduce((s, a) => {
    const kWp = parseFloat(a.props?.leistungKWp) || parseFloat(a.pvKwpCalc) || 0;
    return s + kWp;
  }, 0);
  const kwpLabel = totalKwp > 0
    ? ` · Σ ${totalKwp < 1000 ? totalKwp.toFixed(0) + ' kWp' : (totalKwp / 1000).toFixed(1) + ' MWp'}`
    : '';

  document.getElementById('asset-bulk-lbl').textContent =
    count === 0 ? 'Auswahl' : `${count} Asset${count > 1 ? 's' : ''}${kwpLabel}`;

  // Phasen-Dropdown befüllen
  const phSel = document.getElementById('asset-bulk-phase');
  if (phSel) {
    const curVal = phSel.value;
    phSel.innerHTML = '<option value="">— keine Änderung —</option>'
      + phasen.map(p => `<option value="${p.id}">${p.name} (${p.jahrVon})</option>`).join('');
    if (curVal) phSel.value = curVal;
  }

  // Maßnahmen-Dropdown befüllen (einmalig beim ersten Render)
  const maSel = document.getElementById('asset-bulk-massn');
  if (maSel && !maSel._filled) {
    maSel._filled = true;
    maSel.innerHTML = '<option value="">— keine Änderung —</option>'
      + MASSN_VORLAGEN_REIHENFOLGE.map(k =>
          `<option value="${k}">${MASSN_VORLAGEN[k].icon} ${MASSN_VORLAGEN[k].label}</option>`
        ).join('');
  }

  _fillFilterDropdowns();

  bar.style.display = 'block';
}

// Befüllt die Topologie-Filter-Dropdowns (Objekt + Typ).
function _fillFilterDropdowns() {
  // Objekt-Dropdown: Infrastruktur-Assets als mögliche Wurzel (NAP, Trafo, NSHV, UV, …)
  const rootSel = document.getElementById('asset-bulk-filter-root');
  if (rootSel) {
    const curVal = rootSel.value;
    const infra = ASSETS.items
      .filter(a => ASSET_CFG[a.type]?.kategorie === 'infrastruktur')
      .sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9)
                   || (a.name || '').localeCompare(b.name || ''));
    rootSel.innerHTML = '<option value="">— Objekt wählen —</option>'
      + infra.map(a => {
          const icon = ASSET_CFG[a.type]?.icon || '';
          return `<option value="${a.id}">${icon} ${a.name}</option>`;
        }).join('');
    if (curVal) rootSel.value = curVal;
  }

  // Typ-Dropdown: alle Typen, die aktuell unter den Assets vorkommen
  const typeSel = document.getElementById('asset-bulk-filter-type');
  if (typeSel) {
    const curVal = typeSel.value;
    const vorhandene = [...new Set(ASSETS.items.map(a => a.type))]
      .sort((a, b) => (TYPE_RANK[a] ?? 9) - (TYPE_RANK[b] ?? 9));
    typeSel.innerHTML = '<option value="">alle Typen</option>'
      + vorhandene.map(t => {
          const cfg = ASSET_CFG[t];
          return `<option value="${t}">${cfg?.icon || ''} ${cfg?.label || t}</option>`;
        }).join('');
    if (curVal) typeSel.value = curVal;
  }
}

// ── Sammelaktionen ────────────────────────────────────────────────────────────

/**
 * Weist jedem selektierten Asset eine Phase zu.
 * Sucht eine vorhandene Bau-Maßnahme oder legt eine neue an.
 */
export function selApplyPhase(phaseId) {
  if (!phaseId) return;
  for (const a of selGetAssets()) {
    if (!a.massnahmen) a.massnahmen = [];
    let bau = a.massnahmen.find(m => m.typ === 'Bau');
    if (bau) {
      bau.phaseId = phaseId;
      bau.jahr    = null; // Phase überschreibt explizites Jahr
    } else {
      a.massnahmen.push({
        id:        'bau_' + a.id + '_' + Date.now(),
        typ:       'Bau',
        titel:     'PV-Anlage',
        kosten:    0,
        status:    'geplant',
        phaseId,
        jahr:      null,
        dependsOn: [],
        newProps:  {},
      });
    }
  }
  _bulkDone('Phase zugewiesen');
}

/**
 * Legt je selektiertem Asset eine neue Maßnahme aus der Vorlage an.
 */
export function selApplyMassnahmeVorlage(typKey) {
  if (!typKey || !MASSN_VORLAGEN[typKey]) return;
  const vorl = MASSN_VORLAGEN[typKey];
  for (const a of selGetAssets()) {
    if (!a.massnahmen) a.massnahmen = [];
    a.massnahmen.push({
      id:        typKey + '_' + a.id + '_' + Date.now(),
      typ:       typKey,
      titel:     vorl.label,
      kosten:    vorl.kostenRichtwert || 0,
      status:    'geplant',
      phaseId:   null,
      jahr:      null,
      dependsOn: [],
      newProps:  {},
    });
  }
  _bulkDone('Maßnahmen angelegt');
}

/**
 * Setzt den Status der zuletzt angelegten Maßnahme jedes selektierten Assets.
 */
export function selApplyStatus(status) {
  if (!status) return;
  for (const a of selGetAssets()) {
    const ms = a.massnahmen || [];
    if (ms.length === 0) continue;
    ms[ms.length - 1].status = status;
  }
  _bulkDone('Status gesetzt');
}

/**
 * Setzt ein explizites Jahr auf alle selektierten Assets' neueste Maßnahme.
 */
export function selApplyJahr(jahr) {
  const y = parseInt(jahr);
  if (!y || isNaN(y)) return;
  for (const a of selGetAssets()) {
    const ms = a.massnahmen || [];
    if (ms.length === 0) continue;
    ms[ms.length - 1].jahr = y;
    ms[ms.length - 1].phaseId = null;
  }
  _bulkDone('Jahr gesetzt');
}

function _bulkDone(msg) {
  // Reset Dropdown-Werte nach Aktion
  const phSel = document.getElementById('asset-bulk-phase');
  const maSel = document.getElementById('asset-bulk-massn');
  if (phSel) phSel.value = '';
  if (maSel) maSel.value = '';
  // Sidebar-Liste refreshen
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  console.info('[Bulk]', msg, '—', assetSelection.size, 'Assets');
}

// Neue Phase direkt aus der Bulk-Bar anlegen (gleiche Logik wie im Ausbauplaner)
// und im Phase-Dropdown gleich vorauswählen.
export function selBulkNeuePhase() {
  const maxR = phasen.reduce((m, p) => Math.max(m, +p.reihenfolge), -1);
  const lJ   = phasen.reduce((m, p) => Math.max(m, +p.jahrBis || 0), new Date().getFullYear());
  const id   = 'ph_' + Date.now();
  setPhasen([...phasen, {
    id, name: 'Phase ' + (phasen.length + 1),
    jahrVon: String(lJ + 1), jahrBis: String(lJ + 1),
    variantId: null, reihenfolge: maxR + 1,
  }]);
  selRenderBulkBar();
  const phSel = document.getElementById('asset-bulk-phase');
  if (phSel) phSel.value = id; // neue Phase vorauswählen
  // Ausbauplaner aktualisieren, falls geöffnet
  if (typeof window.ausbauRender === 'function'
      && document.getElementById('ausbauplaner-wrap')
      && document.getElementById('ausbauplaner-wrap').style.display !== 'none') {
    try { window.ausbauRender(); } catch (e) { /* ignore */ }
  }
}

// ── Sammel-Anwenden: alle Felder auf einmal schreiben ─────────────────────────

export function selBulkApplyAll() {
  const phaseId   = document.getElementById('asset-bulk-phase')?.value || '';
  const massnKey  = document.getElementById('asset-bulk-massn')?.value || '';
  const status    = document.getElementById('asset-bulk-status')?.value || '';
  const bauJahr   = parseInt(document.getElementById('asset-bulk-bau-jahr')?.value || '');
  const abrissJahr = parseInt(document.getElementById('asset-bulk-abriss-jahr')?.value || '');

  let changed = 0;

  if (phaseId)    { selApplyPhase(phaseId);             changed++; }
  if (massnKey)   { selApplyMassnahmeVorlage(massnKey); changed++; }
  if (status)     { selApplyStatus(status);             changed++; }
  // Bau-/Abriss-Jahr überschreiben die Asset-Eigenschaften (Eigenschaftsfenster).
  // Liegt das Jahr in der ZUKUNFT (> aktuelles Jahr), ist es ein geplanter Vorgang
  // und wird zusätzlich als Maßnahme angelegt → erscheint im Ausbauplaner-Fahrplan.
  const curYear = new Date().getFullYear();
  if (!isNaN(bauJahr)) {
    for (const a of selGetAssets()) {
      a.baujahr = bauJahr;
      if (bauJahr > curYear) _ensureMassnahmeJahr(a, 'Bau', bauJahr);
    }
    changed++;
  }
  if (!isNaN(abrissJahr)) {
    for (const a of selGetAssets()) {
      a.abrissjahr = abrissJahr;
      if (abrissJahr > curYear) _ensureMassnahmeJahr(a, 'Abriss', abrissJahr);
    }
    changed++;
  }

  // Felder zurücksetzen
  const ids = ['asset-bulk-phase','asset-bulk-massn','asset-bulk-status'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const numIds = ['asset-bulk-bau-jahr','asset-bulk-abriss-jahr'];
  numIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Bestätigung anzeigen
  const msg = document.getElementById('bulk-confirm-msg');
  if (msg) {
    const n = assetSelection.size;
    msg.textContent = changed > 0
      ? `✓ ${n} Asset${n !== 1 ? 's' : ''} aktualisiert`
      : '(keine Felder ausgefüllt)';
    msg.style.display = 'inline';
    msg.style.color = changed > 0 ? '#4caf50' : 'var(--muted)';
    clearTimeout(msg._tid);
    msg._tid = setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }

  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  // Marker neu zeichnen — Bau-/Abrissjahr ändern den Lebenszyklus-Status (Sichtbarkeit/Stil).
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  _refreshDimming();
  selRenderBulkBar(); // Phase-Dropdown ggf. um neu angelegte Phasen aktualisieren
}

// Stellt sicher, dass das Asset eine Maßnahme des Typs hat und setzt ihr Jahr
// (vorhandene Maßnahme wird aktualisiert statt dupliziert). Für geplante Zukunfts-
// Bauten/-Abrisse, damit sie im Ausbauplaner-Fahrplan erscheinen.
function _ensureMassnahmeJahr(a, typ, jahr) {
  if (!a.massnahmen) a.massnahmen = [];
  const vorl = MASSN_VORLAGEN[typ];
  let m = a.massnahmen.find(x => x.typ === typ);
  if (!m) {
    m = {
      id:        typ + '_' + a.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      typ,
      titel:     vorl?.label ?? typ,
      kosten:    vorl?.kostenRichtwert ?? 0,
      status:    'geplant',
      phaseId:   null,
      jahr:      null,
      dependsOn: [],
      newProps:  {},
    };
    a.massnahmen.push(m);
  }
  m.jahr = jahr;
  // Maßnahme einer Phase zuordnen, die dieses Jahr abdeckt — existiert keine
  // passende Phase, wird eine neue angelegt (chronologisch einsortiert).
  const cur = m.phaseId ? phasen.find(p => p.id === m.phaseId) : null;
  const curDeckt = cur
    && jahr >= (parseInt(cur.jahrVon) || 0)
    && jahr <= (parseInt(cur.jahrBis) || 9999);
  if (!curDeckt) {
    const ph = _findOrCreatePhaseForJahr(jahr);
    if (ph) m.phaseId = ph.id;
  }
}

// Sucht eine Phase, deren Jahresbereich `jahr` enthält; legt sonst eine neue an
// und vergibt die Reihenfolge aller Phasen chronologisch nach jahrVon neu.
function _findOrCreatePhaseForJahr(jahr) {
  let ph = phasen.find(p => {
    const von = parseInt(p.jahrVon), bis = parseInt(p.jahrBis);
    return !isNaN(von) && !isNaN(bis) && jahr >= von && jahr <= bis;
  });
  if (ph) return ph;
  ph = {
    id:         'ph_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    name:       'Phase ' + (phasen.length + 1),
    jahrVon:    String(jahr),
    jahrBis:    String(jahr),
    variantId:  null,
    reihenfolge: 0,
  };
  const all = [...phasen, ph].sort((a, b) => (parseInt(a.jahrVon) || 0) - (parseInt(b.jahrVon) || 0));
  all.forEach((p, i) => { p.reihenfolge = i; });
  setPhasen(all);
  return ph;
}

// ── Box-Selektion auf Karte (Shift+Drag) ─────────────────────────────────────

export function selInitBoxSelect() {
  const m = window._appLeafletMap;
  if (!m || m._selBoxInited) return;
  m._selBoxInited = true;

  // Eigenes Pane für die Auswahlbox — bleibt im Bulk-Modus sichtbar (CSS-Isolation
  // blendet overlayPane aus, dieses Pane aber nicht).
  if (!m.getPane('bulkBoxPane')) {
    m.createPane('bulkBoxPane').style.zIndex = '460';
  }

  let startLl = null, rect = null, active = false;

  L.DomEvent.on(m.getContainer(), 'mousedown', e => {
    if (!e.shiftKey || e.button !== 0) return;
    active   = true;
    startLl  = m.mouseEventToLatLng(e);
    m.dragging.disable();
    L.DomEvent.preventDefault(e);
  });

  L.DomEvent.on(m.getContainer(), 'mousemove', e => {
    if (!active || !startLl) return;
    const curLl = m.mouseEventToLatLng(e);
    const bounds = L.latLngBounds(startLl, curLl);
    if (!rect) {
      rect = L.rectangle(bounds, {
        color: '#2196F3', weight: 1.5, fillOpacity: 0.07, interactive: false, pane: 'bulkBoxPane',
      }).addTo(m);
    } else {
      rect.setBounds(bounds);
    }
  });

  L.DomEvent.on(m.getContainer(), 'mouseup', e => {
    if (!active) return;
    active = false;
    m.dragging.enable();
    if (rect) {
      const bounds = rect.getBounds();
      rect.remove(); rect = null;
      // Optionaler Typ-Filter aus der Bulk-Bar: nur Assets dieses Typs im Bereich wählen.
      const typeFilter = document.getElementById('asset-bulk-filter-type')?.value || '';
      const ids = ASSETS.items
        .filter(a => a.lat != null && a.lng != null && bounds.contains([a.lat, a.lng]))
        .filter(a => !typeFilter || a.type === typeFilter)
        .map(a => a.id);
      if (ids.length > 0) {
        for (const id of ids) assetSelection.add(id);
        _afterSelChange();
      }
    }
    startLl = null;
  });

  // Rechtsklick auf der Karte löscht die Auswahl (nur im Bulk-Modus).
  m.on('contextmenu', e => {
    if (!bulkModeActive || assetSelection.size === 0) return;
    if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);
    selClear();
  });
}
