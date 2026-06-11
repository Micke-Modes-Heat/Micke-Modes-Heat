// ── 13o-nap-analyse.js — NAP-Lastgang-Analyse (portiert aus Energiekarte1.1(6).html) ──
// Vollbild-Analyse für Netzanschlusspunkte:
//   • CSV-Import (Semikolon, Datum/Zeit + kW) mit Drag & Drop
//   • Synthetische Berechnung aus Asset-Profilen
//   • 4 Charts: Jahresgang / Jahresdauerlinie / Tagesgang / Jahres-Heatmap
//   • Lastentwicklungs-Balkendiagramm (Bestand + Maßnahmen bis 2050)
//   • PDF-Export

import { ASSETS, getAssetStatus } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';
import { getSlpProfile } from './02b-gebaeude.js';
import { makePvProfile8760 } from './09a-pv-profile.js';
import { getElSlpProfiles } from './13k-elslp-registry.js';

// ── Modulzustand ─────────────────────────────────────────────────────────────
const _N = {
  data:            null,   // geladene CSV-Daten { raw, stats, filename, year }
  synthData:       null,   // synthetisch berechnete Daten
  baseMeasuredData:null,   // Basis-Messdaten (für Lastentwicklung)
  topSeriesMode:   'gemessen',  // 'gemessen' | 'synthetisch' | 'messungPlusProfil'
  chartMode:       'zeitreihe', // 'zeitreihe' | 'dauerlinie' | 'tagesgang' | 'heatmap'
  zeitMonth:       null,   // null = ganzes Jahr, 0-11 = Monat
  massnahmen:      null,   // Array von Maßnahmen
  selectedNapId:   null,   // ausgewählter NAP für synthetische Analyse
  capacityKW:      null,   // NAP-Anschlussleistung kW
  gzf:             1.0,    // Gleichzeitigkeitsfaktor
  kalibrierFactors: null,  // Nutzungstyp-Faktoren für Kalibrierung (null = Defaults)
};

// TYPE_RANK für BFS (niedriger = versorgungsseitig)
const TYPE_RANK = {
  NAP:0, Schaltanlage:1, Trafo:2, NSHV:3, UV:4,
  Verbraucher:5, WP:5, Lade:5, Nsa:5, KWK:5, Wind:6, PV:6, Batterie:6, Reserve:7
};

// ── Profil-Richtung & Zeitreihen-Lookup (Modul-Ebene) ────────────────────────
function profileDirection(asset) {
  if (!asset) return 'bezug';
  if (['WP','Verbraucher','Lade','Nsa'].includes(asset.type)) return 'bezug';
  if (asset.type === 'PV') return 'einspeisung';
  if (asset.type === 'Batterie') {
    const ep = asset.props || {};
    return (ep.betriebsmodus || 'einspeisung') === 'verbraucher' ? 'bezug' : 'einspeisung';
  }
  return asset.profil?.typ === 'einspeisung' ? 'einspeisung' : 'bezug';
}

function profilAt(profil, tsMs) {
  if (!profil?.werte?.length) return 0;
  const tsDate  = new Date(tsMs);
  const tsStart = +new Date(tsDate.getFullYear(), 0, 1);
  const tsDur   = +new Date(tsDate.getFullYear()+1, 0, 1) - tsStart;
  if (!isFinite(tsDur) || tsDur <= 0) return 0;
  let p = ((+tsMs - tsStart) / tsDur);
  p = ((p % 1) + 1) % 1;
  const idx = Math.min(profil.werte.length-1, Math.floor(p * profil.werte.length));
  const raw = profil.werte[idx] ?? 0;
  return profil.invertSign ? -raw : raw;
}

// ── Profil-Helfer ────────────────────────────────────────────────────────────
// PV-Profile-Cache (verhindert wiederholtes Berechnen der 8760-Arrays)
const _napPvProfileCache = new Map();
function _getPvProfile(ausrichtung) {
  if (!_napPvProfileCache.has(ausrichtung)) {
    _napPvProfileCache.set(ausrichtung, makePvProfile8760(ausrichtung));
  }
  return _napPvProfileCache.get(ausrichtung);
}

// Stunden-des-Jahres-Index aus einem Timestamp (0 = 1. Jan 00:00 Uhr)
function _tsToHoy(tsMs) {
  const d = new Date(tsMs);
  const jan1 = +new Date(d.getFullYear(), 0, 1);
  return Math.min(8759, Math.max(0, Math.floor((tsMs - jan1) / 3_600_000)));
}

/**
 * Erstellt einen Profil-Descriptor für ein Asset.
 * Priorität: 1) importiertes Zeitreihen-Profil  2) BDEW-SLP  3) PV-Solarprofil
 * Gibt null zurück wenn kein Profil → statischer Fallback im Aufrufer.
 *
 * mode='custom'  → { mode, asset, dir, gzf }          profilAt() für jeden Timestamp
 * mode='slp'     → { mode, slp, scale }               P_h = slp[hoy] * scale
 * mode='pv'      → { mode, pvProf, scale }            P_h = pvProf[hoy] * scale (Einspeisung)
 */
function _napBuildProfileDescriptor(asset, gzf) {
  const p = asset.props || {};

  // 1. Importiertes Zeitreihen-Profil (höchste Priorität)
  if (asset.profil?.werte?.length > 0) {
    return { mode: 'custom', asset, dir: profileDirection(asset), gzf };
  }

  // 2. BDEW-SLP: z.B. Verbraucher mit slpTyp='H0'
  // Typ-basierter Fallback falls slpTyp nie explizit gesetzt wurde
  // (Inspector öffnen schreibt Default jetzt direkt in props, aber für ältere Assets)
  const SLP_DEFAULTS = { Verbraucher: 'G0', Lade: 'G3' };
  const slpTyp = p.slpTyp || SLP_DEFAULTS[asset.type] || null;
  if (slpTyp) {
    const slp = getSlpProfile(slpTyp);
    if (slp?.length >= 8760) {
      const kw = parseFloat(p.leistungKW) ||
        ((parseFloat(p.anzahlPunkte) || 1) * (parseFloat(p.leistungProPunktKW) || 0)) || 0;
      if (kw > 0) {
        // Peak-Normierung: leistungKW = Anschlussleistung (Maximalwert).
        // P_h = slp[hoy] / slp_peak * kw  →  P_max = kw (nie mehr als Anschlussleistung)
        let slpPeak = 0;
        for (let i = 0; i < slp.length; i++) if (slp[i] > slpPeak) slpPeak = slp[i];
        if (slpPeak > 0) return { mode: 'slp', slp, scale: (kw / slpPeak) * gzf };
      }
    }
  }

  // 3. PV → synthetisches Solarprofil
  if (asset.type === 'PV') {
    const kWp = parseFloat(p.leistungKWp) || 0;
    if (kWp > 0) {
      const ausrichtung = p.ausrichtung || 'sued';
      const pvProf = _getPvProfile(ausrichtung);
      // Peak-Normierung: leistungKWp = Maximal-Einspeisung
      // P_h = pvProf[hoy] / pvProf_peak * kWp  →  P_max = kWp
      let pvPeak = 0;
      for (let i = 0; i < pvProf.length; i++) if (pvProf[i] > pvPeak) pvPeak = pvProf[i];
      if (pvPeak > 0) return { mode: 'pv', pvProf, scale: (kWp / pvPeak) * gzf };
    }
  }

  return null; // kein Profil → statisch im Aufrufer
}

/**
 * Bewertet einen Profil-Descriptor für einen bestimmten Zeitpunkt.
 * Gibt { bezugKW, einspKW } zurück oder null wenn kein Profil.
 */
function _napEvalDescriptor(desc, tsMs) {
  if (!desc) return null;
  const hoy = _tsToHoy(tsMs);

  if (desc.mode === 'custom') {
    const val = profilAt(desc.asset.profil, tsMs) * desc.gzf;
    const mag = Math.abs(val);
    return desc.dir === 'bezug'
      ? { bezugKW: mag, einspKW: 0 }
      : { bezugKW: 0, einspKW: mag };
  }
  if (desc.mode === 'slp') {
    const v = desc.slp[Math.min(hoy, desc.slp.length - 1)] * desc.scale;
    return { bezugKW: Math.max(0, v), einspKW: 0 };
  }
  if (desc.mode === 'pv') {
    const v = desc.pvProf[Math.min(hoy, desc.pvProf.length - 1)] * desc.scale;
    return { bezugKW: 0, einspKW: Math.max(0, v) };
  }
  return null;
}

// ── Panel-Injection ──────────────────────────────────────────────────────────
export function napBuildAnalyseSection() {
  // Tab-Button einfügen (idempotent)
  const tabBar = document.getElementById('analyse-view-tabs');
  if (tabBar && !tabBar.querySelector('[data-section="nap"]')) {
    const btn = document.createElement('button');
    btn.className = 'analyse-section-tab';
    btn.dataset.section = 'nap';
    btn.dataset.click = "setAnalyseSection('nap')";
    btn.textContent = 'NAP-Lastgang';
    btn.title = 'NAP-Lastgang-Analyse: zeitlicher Verlauf von Bezug und Einspeisung am Netzanknüpfungspunkt — Jahresdauerlinie, Spitzenlasten und Gleichzeitigkeit über alle Verbraucher/Erzeuger.';
    tabBar.appendChild(btn);
    // data-click delegation
    btn.addEventListener('click', () => {
      if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('nap');
    });
  }

  // Content-Div einfügen (idempotent)
  let wrap = document.getElementById('analyse-nap-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'analyse-nap-wrap';
    wrap.style.display = 'none';
    wrap.innerHTML = `
<div id="nap-fullscreen-inner" style="display:flex;flex-direction:row;height:calc(100vh - 160px);min-height:400px;gap:0;background:#0f0f1a;border-radius:8px;overflow:hidden;">
  <!-- Sidebar -->
  <div id="nap-sidebar" style="width:300px;overflow-y:auto;flex-shrink:0;border-right:1px solid rgba(38,166,154,.15);padding:10px 10px 16px;background:#0f0f1a;"></div>
  <!-- Main -->
  <div style="flex:1;display:flex;flex-direction:column;min-width:0;background:#0f0f1a;">
    <!-- Oberer Bereich: Chart-Tabs + Canvas -->
    <div id="nap-main-top" style="flex:3;display:flex;flex-direction:column;padding:10px 14px 6px;overflow:hidden;min-height:0;"></div>
    <!-- Unterer Bereich: Lastentwicklung -->
    <div id="nap-main-bot" style="flex:2;display:flex;flex-direction:column;padding:6px 14px 10px;overflow:hidden;min-height:0;border-top:1px solid rgba(38,166,154,.1);"></div>
  </div>
</div>`;
    const analyseView = document.getElementById('center-analyse-view');
    if (analyseView) analyseView.appendChild(wrap);
  }
}

export function napShowSection(visible) {
  const wrap = document.getElementById('analyse-nap-wrap');
  if (!wrap) return;
  wrap.style.display = visible ? '' : 'none';
  if (visible) {
    // Auto-Feed aus Strom-Grundlagen wenn kein eigener Upload vorhanden
    if (!_N.data && !_N.manuallyRemoved && window.elQuartierH15) {
      napLoadFromStromGrundlagen();
      return; // napRenderPanel wird intern aufgerufen
    }
    napRenderPanel();
  }
}

/**
 * Konvertiert window.elQuartierH15 (Float32Array aus Strom-Grundlagen) in das
 * NAP-Datenformat {raw: [{ts: Date, kw: number}]} und lädt es in die Analyse.
 */
export function napLoadFromStromGrundlagen() {
  const arr = window.elQuartierH15 || window.elQuartierH;
  if (!arr || arr.length < 100) return false;

  const filename  = window.elQuartierFilename  || 'Strom-Grundlagen';
  const startDate = window.elQuartierStartDate || new Date(new Date().getFullYear(), 0, 1);
  const dtMin     = arr.length > 10000 ? 15 : 60; // Intervall in Minuten
  const startMs   = startDate.getTime();

  const raw = [];
  for (let i = 0; i < arr.length; i++) {
    raw.push({ ts: new Date(startMs + i * dtMin * 60000), kw: arr[i] });
  }

  const result = { raw, filename, year: startDate.getFullYear(), fromStromGrundlagen: true };
  result.stats = napCalcStats(result.raw);

  _N.data             = result;
  _N.baseMeasuredData = result;
  _N.manuallyRemoved  = false;
  _N.topSeriesMode    = 'gemessen';
  _N.chartMode        = 'zeitreihe';
  _N.zeitMonth        = null;
  napBuildMassnahmen();
  napRenderPanel();
  return true;
}

// Wird von stromFileSelected / stromClear aufgerufen (kein direkter Import nötig)
window.napOnStromGrundlagenChanged = function() {
  if (!_N.manuallyRemoved || window.elQuartierH15) {
    // Bei neuem Upload immer aktualisieren; bei Löschen nur wenn Daten aus SG kamen
    if (_N.data?.fromStromGrundlagen || !_N.data) {
      if (window.elQuartierH15) {
        napLoadFromStromGrundlagen();
      } else if (_N.data?.fromStromGrundlagen) {
        // Strom-Grundlagen gelöscht → NAP-Daten zurücksetzen
        _N.data = null; _N.baseMeasuredData = null; _N.massnahmen = null;
        _N.topSeriesMode = 'gemessen';
        const wrap = document.getElementById('analyse-nap-wrap');
        if (wrap?.style.display !== 'none') napRenderPanel();
      }
    }
  }
};

// ── Daten-Helfer ─────────────────────────────────────────────────────────────
function _allAssets() { return ASSETS.items || []; }
function _yr() { return globalYear || new Date().getFullYear(); }
function _hint(msg) { if (typeof window.showHint === 'function') window.showHint(msg); }

function _napGetTopSeriesMode() {
  const mode      = _N.topSeriesMode;
  const hasMeas   = !!_N.data;
  const hasSynth  = !!_N.synthData;
  const hasOverlay= !!(hasMeas && _N.synthData?.isOverlay);
  if (mode === 'messungPlusProfil') {
    if (hasOverlay) return 'messungPlusProfil';
    if (hasMeas) return 'gemessen';
    return hasSynth ? 'synthetisch' : 'gemessen';
  }
  if (mode === 'synthetisch') {
    if (hasSynth) return 'synthetisch';
    return hasMeas ? 'gemessen' : 'synthetisch';
  }
  if (hasMeas) return 'gemessen';
  if (hasSynth) return 'synthetisch';
  return 'gemessen';
}

function _activeTopData() {
  const mode = _napGetTopSeriesMode();
  if (mode === 'messungPlusProfil') return _N.synthData || _N.data || null;
  if (mode === 'synthetisch')       return _N.synthData || _N.data || null;
  return _N.data || _N.synthData || null;
}
function _activeBottomBaseData() {
  if (_N.baseMeasuredData) return _N.baseMeasuredData;
  if (_N.data) return _N.data;
  if (_N.synthData && !_N.synthData.isOverlay) return _N.synthData;
  return null;
}
function _activeData() { return _activeTopData(); }

// ── Leistung eines Assets extrahieren (Hilfsfunktion) ───────────────────────
function _assetPower(a) {
  const ep = a.props || {};
  let loadKW = 0, genKW = 0;
  switch (a.type) {
    case 'Verbraucher': loadKW = parseFloat(ep.leistungKW)  || 0; break;
    case 'Lade':        loadKW = (parseInt(ep.anzahlPunkte)||1)*(parseFloat(ep.leistungProPunktKW)||11); break;
    case 'WP':          loadKW = parseFloat(ep.leistungKW)  || 0; break;
    case 'Nsa':         loadKW = parseFloat(ep.leistungKW)  || 0; break;
    case 'PV':          genKW  = parseFloat(ep.leistungKWp) || 0; break;
    case 'KWK':         genKW  = parseFloat(ep.leistungElKW)|| 0; break;
    case 'Wind':        genKW  = parseFloat(ep.leistungKW)  || 0; break;
    case 'Batterie':
      if ((ep.betriebsmodus||'einspeisung') === 'verbraucher')
        loadKW = parseFloat(ep.leistungKW)||0;
      else genKW = parseFloat(ep.leistungKW)||0;
      break;
  }
  if (a.profil?.werte?.length > 0) {
    const vals = a.profil.werte.map(v => a.profil.invertSign ? -v : v);
    const peak = Math.max(...vals);
    if (peak > 0) {
      if (loadKW > 0 || (genKW === 0 && ['PV','Wind','KWK'].includes(a.type)))         genKW  = peak;
      if (genKW  > 0 || (loadKW === 0 && ['Verbraucher','Lade','WP','Nsa'].includes(a.type))) loadKW = peak;
    }
  }
  return { loadKW, genKW };
}

// ── Maßnahmen aufbauen ───────────────────────────────────────────────────────
export function napBuildMassnahmen() {
  const dataYear = _N.baseMeasuredData?.year || _N.data?.year || _yr();
  const list = [];
  const CONSUMER_TYPES = ['Verbraucher','Lade','WP','Nsa','PV','KWK','Wind','Batterie'];

  for (const a of _allAssets()) {
    if (!CONSUMER_TYPES.includes(a.type)) continue;
    const bj = parseInt(a.baujahr)    || null;
    const aj = parseInt(a.abrissjahr) || null;
    const { loadKW, genKW } = _assetPower(a);

    // ── Neubau: Baujahr nach Datenjahr ──────────────────────────────────────
    if (bj && bj > dataYear) {
      list.push({
        id: a.id, name: a.name||a.type, type: a.type,
        loadKW, genKW, netKW: loadKW - genKW,
        baujahr: bj, abrissjahr: aj,
        isAbbruch: false,
        checked: (_N.massnahmen?.find(m => m.id === a.id && !m.isAbbruch)?.checked ?? true),
      });
    }

    // ── Abriss: Abrissjahr nach Datenjahr, Asset heute bereits vorhanden ────
    // → ab Abrissjahr reduziert es die Last am NAP (negativ)
    if (aj && aj > dataYear && (!bj || bj <= dataYear)) {
      if (loadKW > 0 || genKW > 0) {
        list.push({
          id: a.id + '__abr', assetId: a.id,
          name: a.name||a.type, type: a.type,
          loadKW, genKW, netKW: loadKW - genKW,
          baujahr: bj, abrissjahr: aj,
          isAbbruch: true,
          checked: (_N.massnahmen?.find(m => m.id === a.id + '__abr')?.checked ?? true),
        });
      }
    }
  }

  // Sortierung: Neubau nach Baujahr, Abriss nach Abrissjahr
  list.sort((a, b) => {
    const ya = a.isAbbruch ? (a.abrissjahr||9999) : (a.baujahr||9999);
    const yb = b.isAbbruch ? (b.abrissjahr||9999) : (b.baujahr||9999);
    return ya - yb;
  });
  _N.massnahmen = list;
}

export function napToggleMassnahme(id) {
  const m = _N.massnahmen?.find(x => x.id === id);
  if (!m) return;
  m.checked = !m.checked;
  if (_napRefreshOverlayIfNeeded()) { napRenderPanel(); return; }
  _napRedrawBottom(); _napRenderSidebar();
}

export function napToggleAllMassnahmen(checked) {
  (_N.massnahmen||[]).forEach(m => m.checked = !!checked);
  if (_napRefreshOverlayIfNeeded()) { napRenderPanel(); return; }
  _napRedrawBottom(); _napRenderSidebar();
}

// ── Lastentwicklung berechnen ────────────────────────────────────────────────
function _napCalcYearlyLoads() {
  const data     = _activeBottomBaseData();
  const basePeak = data?.stats?.peak || 0;
  const gzf      = _N.gzf;
  const list     = (_N.massnahmen||[]).filter(m => m.checked);
  if (!list.length && !basePeak) return [];

  const bauJahre = list.map(m => m.baujahr).filter(Boolean);
  const abrJahre = list.map(m => m.abrissjahr).filter(Boolean);
  const dataYear = data?.year || new Date().getFullYear();
  const minY = Math.min(dataYear, ...bauJahre.length ? bauJahre : [dataYear]);
  const maxY = Math.max(dataYear+5, ...bauJahre.length ? bauJahre : [dataYear], ...abrJahre.length ? abrJahre : [dataYear]);
  const endY = Math.min(maxY + 3, 2055);

  const rows = [];
  for (let yr = minY; yr <= endY; yr++) {
    let addLoad = 0, addGen = 0;
    for (const m of list) {
      if (m.isAbbruch) {
        // Ab Abrissjahr entfällt der Beitrag aus dem Bestand → negative Veränderung
        if (yr >= (m.abrissjahr || 9999)) {
          addLoad -= m.loadKW * gzf;
          addGen  -= m.genKW  * gzf;
        }
      } else {
        // Neubau: aktiv zwischen Baujahr und Abrissjahr
        const bj = m.baujahr    || 0;
        const aj = m.abrissjahr || 9999;
        if (yr < bj || yr >= aj) continue;
        addLoad += m.loadKW * gzf;
        addGen  += m.genKW  * gzf;
      }
    }
    rows.push({ year: yr, basePeak, addLoad, addGen, addNet: addLoad - addGen, total: basePeak + addLoad - addGen });
  }
  return rows;
}

// ── Öffentliche Setter ───────────────────────────────────────────────────────
export function napSetChartMode(mode) {
  _N.chartMode  = mode;
  _N.zeitMonth  = null;
  _napRenderMainTop();
}
export function napSetTopSeriesMode(mode) {
  _N.topSeriesMode = mode;
  if (mode === 'messungPlusProfil') _napRefreshOverlayIfNeeded(true);
  napRenderPanel();
}
export function napSetGzf(value) {
  _N.gzf = parseFloat(value) || 1.0;
  if (_napRefreshOverlayIfNeeded()) { napRenderPanel(); return; }
  _napRedrawBottom(); _napRenderSidebar();
}
export function napSetSelectedNap(id) {
  _N.selectedNapId = id;
  _napRenderSidebar();
}
export function napSetCapacity(v) {
  _N.capacityKW = parseFloat(v) || null;
  _napRedrawBottom();
}
export function napRemoveMeasuredData() {
  // Wenn Daten aus Strom-Grundlagen kamen: Auto-Reload verhindern bis neuer Upload
  if (_N.data?.fromStromGrundlagen) _N.manuallyRemoved = true;
  _N.data = null; _N.baseMeasuredData = null; _N.massnahmen = null;
  if (_N.synthData?.isOverlay) _N.synthData = null;
  _N.topSeriesMode = _N.synthData ? 'synthetisch' : 'gemessen';
  napRenderPanel();
}

// ── Overlay-Refresh ──────────────────────────────────────────────────────────
function _napRefreshOverlayIfNeeded(force = false) {
  if (!_N.data) return false;
  if (!force && _napGetTopSeriesMode() !== 'messungPlusProfil') return false;
  const result = napComputeSynthetic(_N.selectedNapId);
  if (!result || !result.isOverlay) {
    if (_N.synthData?.isOverlay) { _N.synthData = null; return true; }
    return false;
  }
  _N.synthData = result;
  return true;
}

// ── BFS downstream vom NAP ───────────────────────────────────────────────────
function _napBfsDownstream(napId) {
  const yr     = _yr();
  const assets = _allAssets().filter(a => getAssetStatus(a, yr) === 'active');
  const aMap   = new Map(assets.map(a => [a.id, a]));
  const adj    = new Map(assets.map(a => [a.id, []]));
  for (const e of (window.stromEdges || [])) {
    if (adj.has(e.u) && adj.has(e.v)) {
      adj.get(e.u).push(e.v);
      adj.get(e.v).push(e.u);
    }
  }
  if (!aMap.has(napId)) return [];
  const napRank = TYPE_RANK['NAP'] ?? 0;
  const visited = new Set([napId]);
  const queue   = [napId];
  const result  = [];
  while (queue.length) {
    const cur     = queue.shift();
    for (const nbId of (adj.get(cur) || [])) {
      if (visited.has(nbId)) continue;
      const nb     = aMap.get(nbId);
      const nbRank = TYPE_RANK[nb?.type] ?? 6;
      if (nbRank >= napRank) { visited.add(nbId); queue.push(nbId); result.push(nb); }
    }
  }
  return result.filter(a => a && ['Verbraucher','WP','PV','Lade','Batterie','KWK','Wind'].includes(a.type));
}

// ── Synthetische Berechnung ───────────────────────────────────────────────────
// forceBFS=true: Modus B (BFS) auch dann erzwingen wenn CSV geladen ist.
// Wird von napApplyKalibrierungMitProfil genutzt, weil Bestandsassets
// nicht in _N.massnahmen auftauchen (kein baujahr > dataYear).
export function napComputeSynthetic(napId, forceBFS = false) {
  const baseMeasured = _N.data;
  const gzf     = _N.gzf;
  const allA    = _allAssets();
  const refYear = baseMeasured?.year || _yr();

  if (!forceBFS && baseMeasured?.raw?.length > 0) {
    // ── Modus A: Messung + Maßnahmen überlagern ──────────────────────────────
    const checkedMass = (_N.massnahmen || []).filter(m => m.checked);
    if (!checkedMass.length) { _hint('Keine Maßnahmen ausgewählt.'); return null; }

    // Descriptor für jede Maßnahme vorberechnen
    // Bei Abriss-Einträgen (isAbbruch) assetId ≠ id → Lookup über assetId
    const entries = checkedMass.map(m => {
      const asset = allA.find(a => a.id === (m.assetId || m.id));
      const desc  = asset ? _napBuildProfileDescriptor(asset, gzf) : null;
      return { m, asset, desc };
    });

    // Statische Summe nur für Maßnahmen ohne Profil
    // Abriss-Einträge subtrahieren (Vorzeichen −1)
    let staticBezug = 0, staticEinsp = 0;
    for (const { m, desc } of entries) {
      if (!desc) {
        const sign = m.isAbbruch ? -1 : 1;
        staticBezug += (m.loadKW || 0) * gzf * sign;
        staticEinsp += (m.genKW  || 0) * gzf * sign;
      }
    }
    const dynEntries = entries.filter(e => !!e.desc);

    const raw = baseMeasured.raw.map(pt => {
      let addB = staticBezug, addE = staticEinsp;
      for (const { m, desc } of dynEntries) {
        const r = _napEvalDescriptor(desc, +pt.ts);
        if (r) {
          const sign = m.isAbbruch ? -1 : 1;
          addB += r.bezugKW * sign;
          addE += r.einspKW * sign;
        }
      }
      return { ts: pt.ts, kw: pt.kw + addB - addE };
    });

    const napName = napId ? (allA.find(a => a.id === napId)?.name || napId) : 'NAP';
    const profTypes = dynEntries.map(e =>
      e.desc.mode === 'custom' ? '⏱' : e.desc.mode === 'slp' ? '📊' : '☀'
    ).join('');
    return {
      raw, stats: napCalcStats(raw), year: baseMeasured.year,
      filename: `${napName} + ${checkedMass.length} Maßnahmen`,
      isSynthetic: true, isOverlay: true,
      sourceAssets: dynEntries.length,
      withStaticFallback: entries.length - dynEntries.length,
      profilTypes: profTypes,
    };

  } else {
    // ── Modus B: Rein synthetisch via BFS ────────────────────────────────────
    const consumers = _napBfsDownstream(napId);
    if (!consumers.length) {
      _hint('Keine nachgelagerten Assets gefunden. Bitte NAP im Stromnetz verschalten.');
      return null;
    }

    // Descriptor für jeden Consumer vorberechnen
    const entries = consumers.map(a => {
      const desc = _napBuildProfileDescriptor(a, gzf);
      return { a, desc };
    });

    const dynEntries = entries.filter(e => !!e.desc);

    // Statische Summe für Assets ohne Profil
    let staticBezug = 0, staticEinsp = 0;
    for (const { a, desc } of entries) {
      if (desc) continue;
      const p = a.props || {};
      if (['WP','Verbraucher'].includes(a.type)) staticBezug += parseFloat(p.leistungKW)||0;
      else if (a.type === 'Lade')     staticBezug += (parseFloat(p.anzahlPunkte)||1)*(parseFloat(p.leistungProPunktKW)||0);
      else if (a.type === 'Batterie') {
        if ((p.betriebsmodus||'einspeisung') === 'verbraucher') staticBezug += parseFloat(p.leistungKW)||0;
        else staticEinsp += parseFloat(p.leistungKW)||0;
      }
      // PV ohne Descriptor: sollte nicht vorkommen (kWp > 0 erzeugt immer einen descriptor)
    }

    if (!dynEntries.length && !staticBezug && !staticEinsp) {
      _hint('Keine Profile oder Leistungsdaten gefunden. Bitte Assets mit Leistung / SLP / Profil konfigurieren.');
      return null;
    }

    // Zeitgitter: Custom-Profil mit den meisten Einträgen als Referenz;
    // ohne custom → stündliches Jahresnetz für refYear
    const customRef = dynEntries
      .filter(e => e.desc.mode === 'custom')
      .reduce((best, e) => {
        const len = e.a.profil.werte.length;
        return (!best || len > best.a.profil.werte.length) ? e : best;
      }, null);

    const raw = [];
    if (customRef) {
      const rp         = customRef.a.profil;
      const startMs    = +new Date(rp.startTs);
      const intervalMs = (rp.intervalMin || 15) * 60_000;
      for (let i = 0; i < rp.werte.length; i++) {
        const tsMs = startMs + i * intervalMs;
        let bezug = staticBezug, einsp = staticEinsp;
        for (const { desc } of dynEntries) {
          const r = _napEvalDescriptor(desc, tsMs);
          if (r) { bezug += r.bezugKW; einsp += r.einspKW; }
        }
        raw.push({ ts: new Date(tsMs), kw: bezug - einsp });
      }
    } else {
      // Stündliches Gitter für das Referenzjahr
      const jan1Ms = +new Date(refYear, 0, 1);
      for (let h = 0; h < 8760; h++) {
        const tsMs = jan1Ms + h * 3_600_000;
        let bezug = staticBezug, einsp = staticEinsp;
        for (const { desc } of dynEntries) {
          const r = _napEvalDescriptor(desc, tsMs);
          if (r) { bezug += r.bezugKW; einsp += r.einspKW; }
        }
        raw.push({ ts: new Date(tsMs), kw: bezug - einsp });
      }
    }

    const napAsset = allA.find(a => a.id === napId);
    return {
      raw, stats: napCalcStats(raw), year: refYear,
      filename: `Synthetisch: ${napAsset?.name || napId}`,
      isSynthetic: true, isOverlay: false,
      sourceAssets: dynEntries.length,
      withStaticFallback: entries.length - dynEntries.length,
    };
  }
}

export function napComputeSyntheticAndShow() {
  const napId = _N.selectedNapId;
  if (!_N.data && !napId) { _hint('Bitte zuerst einen NAP auswählen.'); return; }
  const result = napComputeSynthetic(napId);
  if (!result) return;
  _N.synthData     = result;
  _N.topSeriesMode = result.isOverlay ? 'messungPlusProfil' : 'synthetisch';
  napBuildMassnahmen();
  napRenderPanel();
}

// ── CSV-Import ───────────────────────────────────────────────────────────────
export function napDropFile(evt) {
  const file = evt.dataTransfer?.files?.[0];
  if (file) _napReadFile(file);
}
export function napLoadFile(input) {
  const file = input.files?.[0];
  if (file) _napReadFile(file);
}
function _napReadFile(file) {
  const reader = new FileReader();
  reader.onerror = () => alert('Fehler beim Lesen der Datei.');
  reader.onload  = e => {
    const result = napParseCSV(e.target.result, file.name);
    if (!result) {
      alert('CSV konnte nicht gelesen werden.\nFormat: Semikolon · Datum/Zeit + kW · mind. 10 Messwerte');
      return;
    }
    result.stats       = napCalcStats(result.raw);
    _N.data            = result;
    _N.baseMeasuredData= result;
    _N.topSeriesMode   = 'gemessen';
    _N.chartMode       = 'zeitreihe';
    _N.zeitMonth       = null;
    napBuildMassnahmen();
    napRenderPanel();
    _napShowImportPopup(result, file.name);
  };
  reader.readAsText(file, 'windows-1252');
}

export function napParseCSV(text, filename) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 3) return null;
  const hdr  = lines[0].split(';').map(h => h.trim().replace(/['"]/g,''));
  const hdrl = hdr.map(h => h.toLowerCase().replace(/\s+/g,''));
  let dateCol=-1, timeCol=-1, tsCol=-1, valCol=-1;
  for (let i=0; i<hdrl.length; i++) {
    const h = hdrl[i];
    if (tsCol  <0 && (h.includes('timestamp')||h.includes('zeitstempel')||h==='ts'||h==='datetime')) tsCol=i;
    if (dateCol<0 && (h.includes('datum')||h==='date'||h==='dat'))                                    dateCol=i;
    if (timeCol<0 && (h==='zeit'||h==='time'||h==='uhrzeit') && !h.includes('datum'))                timeCol=i;
    if (valCol <0 && (h.includes('kw')||h.includes('leistung')||h.includes('wirkleistung')||
                      h==='p'||h==='wert'||h.includes('power')||h.includes('last')||h.includes('bezug')))
      valCol=i;
  }
  if (valCol<0) {
    const fd=lines[1].split(';');
    for (let i=fd.length-1;i>=0;i--) { if (!isNaN(parseFloat(fd[i].trim().replace(',','.')))) { valCol=i; break; } }
  }
  if (valCol<0) return null;
  const multiplier=(hdrl[valCol]||'').includes('mw')&&!(hdrl[valCol]||'').includes('kw')?1000:1;
  function parseTS(row) {
    let s='';
    if      (tsCol  >=0)                  s=(row[tsCol]||'').trim();
    else if (dateCol>=0&&timeCol>=0)      s=((row[dateCol]||'')+' '+(row[timeCol]||'')).trim();
    else if (dateCol>=0)                  s=(row[dateCol]||'').trim();
    else                                  s=((row[0]||'')+' '+(row[1]||'')).trim();
    s=s.replace(/['"]/g,'');
    let m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));
    return null;
  }
  const raw=[];
  for (let i=1;i<lines.length;i++) {
    const row=lines[i].split(';');
    if (row.length<=valCol) continue;
    const ts=parseTS(row);
    if (!ts||isNaN(ts.getTime())) continue;
    const kw=parseFloat((row[valCol]||'').trim().replace(/['"]/g,'').replace(',','.'))*multiplier;
    if (isNaN(kw)) continue;
    raw.push({ts,kw});
  }
  if (raw.length<10) return null;
  raw.sort((a,b)=>a.ts-b.ts);
  return {raw,filename,year:raw[0].ts.getFullYear()};
}

export function napCalcStats(raw) {
  const n=raw.length;
  let peak=-Infinity,sum=0;
  for (const d of raw) { if (d.kw>peak) peak=d.kw; sum+=d.kw; }
  const mean=sum/n, jahresenergie=sum*0.25;
  const benutzungsdauer=peak>0?jahresenergie/peak:0;
  const sorted=[...raw].map(d=>d.kw).sort((a,b)=>b-a);
  const grundlast=sorted[Math.floor(sorted.length*0.9)]||0;
  const lastfaktor=peak>0?mean/peak:0;
  const volllaststunden=benutzungsdauer;
  const ueberschreitungsstunden80=raw.filter(d=>d.kw>peak*0.8).length*0.25;
  const year=raw[0].ts.getFullYear();
  const yearStart=+new Date(year,0,1);

  // Tagesgang
  const slotSum=new Float64Array(96),slotN=new Int32Array(96);
  const slotSumWd=new Float64Array(96),slotNWd=new Int32Array(96);
  const slotSumWe=new Float64Array(96),slotNWe=new Int32Array(96);
  for (const d of raw) {
    const slot=d.ts.getHours()*4+Math.floor(d.ts.getMinutes()/15);
    if (slot<0||slot>=96) continue;
    slotSum[slot]+=d.kw; slotN[slot]++;
    const dow=d.ts.getDay();
    if (dow===0||dow===6) { slotSumWe[slot]+=d.kw; slotNWe[slot]++; }
    else                  { slotSumWd[slot]+=d.kw; slotNWd[slot]++; }
  }
  const avgAll=Array.from(slotSum).map((s,i)=>slotN[i]?s/slotN[i]:0);
  const avgWd =Array.from(slotSumWd).map((s,i)=>slotNWd[i]?s/slotNWd[i]:0);
  const avgWe =Array.from(slotSumWe).map((s,i)=>slotNWe[i]?s/slotNWe[i]:0);

  // Heatmap
  const hGrid=new Float32Array(365*96),hGridN=new Int16Array(365*96);
  for (const d of raw) {
    const day=Math.floor((+d.ts-yearStart)/86400000);
    const slot=d.ts.getHours()*4+Math.floor(d.ts.getMinutes()/15);
    if (day<0||day>=365||slot<0||slot>=96) continue;
    hGrid[day*96+slot]+=d.kw; hGridN[day*96+slot]++;
  }
  const heatmapGrid=new Float32Array(365*96);
  for (let i=0;i<hGrid.length;i++) if (hGridN[i]) heatmapGrid[i]=hGrid[i]/hGridN[i];

  // Stündlich aggregiert
  const hBuckets=new Array(8760).fill(null).map(()=>({sum:0,n:0}));
  for (const d of raw) {
    const hi=Math.floor((+d.ts-yearStart)/3600000);
    if (hi>=0&&hi<8760) { hBuckets[hi].sum+=d.kw; hBuckets[hi].n++; }
  }
  const hourlyAgg=hBuckets.map((b,i)=>({ts:new Date(yearStart+i*3600000),kw:b.n?b.sum/b.n:0}));

  const erwartetSlots=365*96;
  const fehlendSlots=Math.max(0,erwartetSlots-n);
  const datenvollstaendigkeit=Math.min(100,(n/erwartetSlots)*100);

  return {n,peak,mean,sum,jahresenergie,benutzungsdauer,sorted,avgAll,avgWd,avgWe,
          heatmapGrid,hourlyAgg,year,grundlast,lastfaktor,volllaststunden,
          ueberschreitungsstunden80,datenvollstaendigkeit,fehlendSlots};
}

// ── Import-Popup ─────────────────────────────────────────────────────────────
function _napShowImportPopup(result, filename) {
  const s=result.stats;
  const vollst=s.datenvollstaendigkeit;
  const qualCol=vollst>95?'#66bb6a':vollst>80?'#f9a825':'#ef5350';
  const qualText=vollst>95?'Sehr gut':vollst>80?'Gut':'Lückenhaft';
  const fmt=v=>v>=1000?`${(v/1000).toFixed(2)} MW`:`${v.toFixed(0)} kW`;
  const fmtE=v=>v>=1e6?`${(v/1e6).toFixed(2)} GWh`:`${(v/1e3).toFixed(1)} MWh`;
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML=`
<div style="background:#1a1a2e;border:1px solid #2a3a5a;border-radius:10px;padding:0;width:500px;max-width:95vw;box-shadow:0 8px 40px rgba(0,0,0,.8);font-family:sans-serif;overflow:hidden;">
  <div style="background:#0f1020;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a40;">
    <div><div style="font-size:14px;font-weight:700;color:#80cbc4;">📂 Import abgeschlossen</div>
    <div style="font-size:10px;color:#555;margin-top:2px;">${filename}</div></div>
    <button onclick="this.closest('[style*=fixed]').remove()"
      style="background:transparent;border:1px solid #333;border-radius:4px;color:#aaa;cursor:pointer;font-size:14px;padding:2px 8px;">✕</button>
  </div>
  <div style="padding:14px 18px;border-bottom:1px solid #2a2a40;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:8px;">Datenqualität</div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
      <div style="flex:1;height:8px;background:#1e1e30;border-radius:4px;overflow:hidden;">
        <div style="width:${vollst.toFixed(1)}%;height:100%;background:${qualCol};border-radius:4px;"></div></div>
      <span style="font-weight:700;color:${qualCol};">${vollst.toFixed(1)} % – ${qualText}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10px;">
      <div style="background:#1e1e30;border-radius:4px;padding:6px 8px;"><div style="color:#666;margin-bottom:2px;">Messwerte</div><div style="font-weight:700;color:#ccc;">${s.n.toLocaleString('de-DE')}</div></div>
      <div style="background:#1e1e30;border-radius:4px;padding:6px 8px;"><div style="color:#666;margin-bottom:2px;">Lücken</div><div style="font-weight:700;color:${s.fehlendSlots>0?'#f9a825':'#66bb6a'};">${s.fehlendSlots.toLocaleString('de-DE')} Slots</div></div>
      <div style="background:#1e1e30;border-radius:4px;padding:6px 8px;"><div style="color:#666;margin-bottom:2px;">Vollständigkeit</div><div style="font-weight:700;color:${qualCol};">${vollst.toFixed(1)} %</div></div>
    </div>
  </div>
  <div style="padding:14px 18px;border-bottom:1px solid #2a2a40;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:8px;">Kennzahlen</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;">
      ${[['Messjahr',`${s.year}`,'#aaa'],['Jahreshöchstlast',fmt(s.peak),'#ef5350'],['Grundlast',fmt(s.grundlast),'#80cbc4'],['Mittellast',fmt(s.mean),'#64b5f6'],['Lastfaktor',`${(s.lastfaktor*100).toFixed(1)} %`,'#ce93d8'],['Benutzungsdauer',`${Math.round(s.benutzungsdauer)} h`,'#ffa726'],['Jahresenergie',fmtE(s.jahresenergie),'#ffa726'],['>80%-Stunden',`${s.ueberschreitungsstunden80.toFixed(0)} h`,'#ef9a9a']]
      .map(([l,v,c])=>`<div style="background:#1e1e30;border-radius:4px;padding:6px 8px;display:flex;justify-content:space-between;"><span style="color:#555">${l}</span><span style="font-weight:700;color:${c}">${v}</span></div>`).join('')}
    </div>
  </div>
  <div style="padding:10px 18px;display:flex;justify-content:flex-end;">
    <button onclick="this.closest('[style*=fixed]').remove()"
      style="background:#1e4a3a;border:1px solid #26a69a;border-radius:5px;color:#80cbc4;cursor:pointer;font-size:11px;padding:6px 20px;font-weight:600;">OK</button>
  </div>
</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
}

// ── Haupt-Render ─────────────────────────────────────────────────────────────
export function napRenderPanel() {
  // Maßnahmen immer neu aufbauen (erhält checked-States, reagiert auf Asset-Änderungen)
  napBuildMassnahmen();

  const data = _activeTopData();
  const hdrInfo = document.getElementById('nap-hdr-info');
  if (hdrInfo && data) {
    const s = data.stats;
    hdrInfo.innerHTML = `${data.isSynthetic?'⚡':'📄'} <b style="color:#ccc">${data.filename}</b>
      &nbsp;·&nbsp; ${data.year} &nbsp;·&nbsp; ${s.peak.toFixed(0)} kW Peak`;
  } else if (hdrInfo) hdrInfo.innerHTML='';
  _napRenderSidebar();
  _napRenderMainTop();
  _napRenderMainBot();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function _napRenderSidebar() {
  const sb = document.getElementById('nap-sidebar');
  if (!sb) return;
  const csvData   = _N.data;
  const synthData = _N.synthData;
  const topMode   = _napGetTopSeriesMode();
  const data      = _activeTopData();
  const s         = data?.stats;
  const cap       = _N.capacityKW || '';
  const gzf       = _N.gzf;
  const list      = _N.massnahmen || [];
  const chk       = list.filter(m => m.checked);
  // Abriss-Einträge zählen negativ (reduzieren Last/Einspeisung)
  const totalAddLoad = chk.reduce((a,m) => a + (m.isAbbruch ? -m.loadKW : m.loadKW), 0) * gzf;
  const totalAddGen  = chk.reduce((a,m) => a + (m.isAbbruch ? -m.genKW  : m.genKW),  0) * gzf;
  const totalNet     = totalAddLoad - totalAddGen;

  // NAP-Selektor / Overlay-Info
  let napBlock = '';
  if (csvData) {
    // BFS-Synthese vorhanden? (source: nap-derived oder Bestandsprofile, isOverlay=false)
    const hasBfsSynth = !!(synthData && !synthData.isOverlay);
    napBlock = `
<div style="margin-bottom:10px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:4px;">Ansicht</div>
  <div style="display:flex;gap:3px;margin-bottom:6px;flex-wrap:wrap;">
    <button onclick="napSetTopSeriesMode('gemessen')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-size:9px;font-weight:600;min-width:60px;
      border:1px solid ${topMode==='gemessen'?'#26a69a':'#333'};
      background:${topMode==='gemessen'?'rgba(38,166,154,.12)':'transparent'};
      color:${topMode==='gemessen'?'#80cbc4':'#555'};">📄 Messung</button>
    ${hasBfsSynth?`<button onclick="napSetTopSeriesMode('synthetisch')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-size:9px;font-weight:600;min-width:60px;
      border:1px solid ${topMode==='synthetisch'?'#ef9a9a':'#333'};
      background:${topMode==='synthetisch'?'rgba(239,154,154,.12)':'transparent'};
      color:${topMode==='synthetisch'?'#ef9a9a':'#555'};">⚡ Synthetisch</button>`:''}
    <button onclick="napSetTopSeriesMode('messungPlusProfil')"
      style="flex:1;padding:4px;border-radius:4px;cursor:pointer;font-size:9px;font-weight:600;min-width:60px;
      border:1px solid ${topMode==='messungPlusProfil'?'#ab47bc':'#333'};
      background:${topMode==='messungPlusProfil'?'rgba(171,71,188,.12)':'transparent'};
      color:${topMode==='messungPlusProfil'?'#ce93d8':'#555'};">📊 + Maßnahmen</button>
  </div>
  ${hasBfsSynth && topMode==='synthetisch'?`<div style="font-size:9px;color:#ef9a9a;">⚡ ${synthData.sourceAssets} Assets · ${synthData.withStaticFallback} statisch — ${synthData.filename||''}</div>`:''}
  ${synthData?.isOverlay?`<div style="font-size:9px;color:#ab47bc;">✓ ${synthData.sourceAssets} Profile + ${synthData.withStaticFallback} statisch</div>`:''}
</div>`;
  } else {
    const yr2 = _yr();
    const naps = _allAssets().filter(a => a.type==='NAP' && getAssetStatus(a,yr2)==='active');
    const selId = _N.selectedNapId || '';
    const selNap = naps.find(n => n.id===selId);
    const profileCount = selNap ? _napBfsDownstream(selId).filter(a=>a.profil?.werte?.length>0).length : 0;
    napBlock = naps.length > 0 ? `
<div style="margin-bottom:10px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;">Synthetische Analyse</div>
  <select onchange="napSetSelectedNap(this.value)"
    style="width:100%;background:#1e1e30;border:1px solid #2a3a3a;border-radius:4px;color:#ccc;padding:5px 7px;font-size:10px;margin-bottom:5px;">
    <option value="">— NAP auswählen —</option>
    ${naps.map(n=>`<option value="${n.id}"${n.id===selId?' selected':''}>${n.name}</option>`).join('')}
  </select>
  ${selNap?`<button onclick="napComputeSyntheticAndShow()"
    style="width:100%;padding:5px;border:1px solid ${profileCount>0?'#ab47bc55':'#333'};border-radius:4px;
    background:transparent;color:${profileCount>0?'#ce93d8':'#555'};cursor:pointer;font-size:10px;font-weight:600;">
    ⚡ Synthetisch berechnen (${profileCount} Profile)</button>`:''}
</div>` : '';
  }

  // CSV-Import
  const importBlock = `
<div style="margin-bottom:10px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;">Gemessene Daten (CSV)</div>
  ${csvData?`
  <div style="background:#1e1e30;border-radius:5px;padding:7px 8px;font-size:10px;color:#aaa;">
    ${csvData.fromStromGrundlagen
      ? `<span style="color:#ffd54f;font-size:9px;font-weight:600;">⚡ Aus Strom-Grundlagen</span><br>`
      : `📄 `}${csvData.filename}<br>
    <span style="color:#666;">${csvData.year} · ${csvData.raw.length.toLocaleString('de')} Werte</span>
  </div>
  <button onclick="napRemoveMeasuredData()"
    style="margin-top:5px;width:100%;padding:4px;border:1px solid #ef535055;border-radius:4px;background:transparent;color:#ef5350;cursor:pointer;font-size:10px;">
    ${csvData.fromStromGrundlagen ? '↩ Strom-Grundlagen-Daten ausblenden' : '✕ Datei entfernen'}
  </button>
  `:`
  ${window.elQuartierH15 ? `
  <div style="background:#1e2030;border:1px solid #26a69a44;border-radius:5px;padding:7px 8px;font-size:10px;color:#aaa;margin-bottom:6px;">
    <span style="color:#ffd54f;font-size:9px;font-weight:600;">⚡ Strom-Grundlagen verfügbar</span><br>
    <span style="color:#666;">${window.elQuartierFilename || ''} · ${window.elQuartierH15.length.toLocaleString('de')} Werte</span>
  </div>
  <button onclick="napLoadFromStromGrundlagen()"
    style="width:100%;padding:6px;border:1px solid #26a69a55;border-radius:4px;background:#26a69a11;color:#26a69a;cursor:pointer;font-size:10px;margin-bottom:6px;">
    ↓ Jetzt laden
  </button>` : ''}
  <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 8px;
    border:1.5px dashed #2a3a3a;border-radius:6px;background:#141420;"
    ondragover="event.preventDefault();this.style.borderColor='#26a69a'"
    ondragleave="this.style.borderColor=''"
    ondrop="event.preventDefault();napDropFile(event)">
    <span style="font-size:18px;">📂</span>
    <span><div style="font-size:10px;color:#ccc;font-weight:600;">Eigene CSV laden</div>
    <div style="font-size:9px;color:#666;">Semikolon · Datum/Zeit + kW</div></span>
    <input type="file" accept=".csv,.txt" style="display:none" onchange="napLoadFile(this)">
  </label>`}
</div>`;

  // KPIs
  const kpiBlock = !s ? '' : `
<div style="margin-bottom:10px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;">
    Kennzahlen ${data?.isSynthetic?'(Synthetisch)':'Messjahr'}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
    ${[['#ef5350',s.peak.toFixed(0),'kW Peak-Last'],['#80cbc4',s.grundlast.toFixed(0),'kW Grundlast'],
       ['#64b5f6',s.mean.toFixed(0),'kW Mittellast'],['#ce93d8',(s.lastfaktor*100).toFixed(1)+' %','Lastfaktor'],
       ['#ffa726',Math.round(s.benutzungsdauer)+'','h Benutzungsdauer'],['#a5d6a7',Math.round(s.volllaststunden)+'','h Volllaststunden'],
       ['#ffa726',s.jahresenergie>=1e6?(s.jahresenergie/1e6).toFixed(2)+' GWh':(s.jahresenergie/1e3).toFixed(1)+' MWh','Jahresenergie'],
       ['#ef5350',s.ueberschreitungsstunden80.toFixed(0),'h > 80%-Stunden']]
    .map(([c,v,l])=>`<div style="background:#1e1e30;border-radius:4px;padding:5px 6px;text-align:center;">
      <div style="font-size:13px;font-weight:700;color:${c};">${v}</div>
      <div style="font-size:8px;color:#555;margin-top:1px;">${l}</div></div>`).join('')}
  </div>
</div>`;

  // NAP-Kapazität
  const napCapBlock = `
<div style="margin-bottom:10px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;">NAP-Anschlussleistung</div>
  <div style="background:#1e1e30;border-radius:5px;padding:7px 8px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <span style="font-size:10px;color:#aaa;">Aktuelle Kapazität:</span>
      <input type="number" value="${cap}" placeholder="kW" min="0" step="10"
        style="flex:1;background:#0f0f1a;border:1px solid #2a3a3a;border-radius:3px;color:#ccc;padding:3px 6px;font-size:10px;"
        oninput="napSetCapacity(this.value)">
      <span style="font-size:10px;color:#666;">kW</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <span style="font-size:10px;color:#aaa;">Gleichzeitigkeit:</span>
      <input type="number" value="${gzf}" min="0.1" max="1" step="0.05"
        style="width:55px;background:#0f0f1a;border:1px solid #2a3a3a;border-radius:3px;color:#ccc;padding:3px 6px;font-size:10px;"
        oninput="napSetGzf(this.value)">
    </div>
  </div>
</div>`;

  // Maßnahmen
  const typeIcon = {Verbraucher:'⚡',Lade:'🔌',WP:'♨',Nsa:'🏭',PV:'☀',Batterie:'🔋',KWK:'🔥',Wind:'🌀'};
  const massRows = list.map(m => {
    const isAbr  = !!m.isAbbruch;
    // Jahr-Spalte: Neubau → Baujahr, Abriss → Abrissjahr (rot)
    const yrVal  = isAbr ? m.abrissjahr : m.baujahr;
    const yrCell = yrVal
      ? `<span style="color:${isAbr?'#ef7373':'#666'}">${yrVal}</span>`
      : `<span style="color:#444">–</span>`;
    // Last-/Einspeise-Zellen: Neubau = positiv, Abriss = negativ (Farben invertiert)
    const loadCell = m.loadKW > 0
      ? `<span style="color:${isAbr?'#a5d6a7':'#ef9a9a'};font-weight:600;">${isAbr?'−':'+'}${(m.loadKW*gzf).toFixed(0)}</span>`
      : `<span style="color:#333">–</span>`;
    const genCell  = m.genKW  > 0
      ? `<span style="color:${isAbr?'#ef9a9a':'#a5d6a7'};font-weight:600;">${isAbr?'−':'−'}${(m.genKW*gzf).toFixed(0)}</span>`
      : `<span style="color:#333">–</span>`;
    const abrTag = isAbr
      ? `<span style="font-size:8px;background:#ef535022;color:#ef7373;border-radius:2px;padding:0 3px;margin-right:2px;">Abriss</span>`
      : '';
    return `<tr style="border-bottom:1px solid #1a1a28;${!m.checked?'opacity:.45':''}${isAbr?'background:rgba(239,83,80,.05);':''}">
      <td style="padding:3px 4px;"><input type="checkbox" ${m.checked?'checked':''} style="accent-color:#26a69a;cursor:pointer;" onchange="napToggleMassnahme('${m.id}')"></td>
      <td style="padding:3px 4px;font-size:10px;color:#aaa;max-width:85px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${m.name}">${typeIcon[m.type]||'▪'} ${abrTag}${m.name}</td>
      <td style="padding:3px 4px;text-align:right;font-size:10px;">${loadCell}</td>
      <td style="padding:3px 4px;text-align:right;font-size:10px;">${genCell}</td>
      <td style="padding:3px 4px;text-align:center;font-size:10px;">${yrCell}</td>
    </tr>`;
  }).join('');

  const massBlock = `
<div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;">Maßnahmen (${list.length})</div>
    <div style="display:flex;gap:4px;">
      <button onclick="napToggleAllMassnahmen(true)"
        style="padding:1px 6px;border:1px solid #2a3a3a;border-radius:3px;background:transparent;color:#80cbc4;font-size:9px;cursor:pointer;">alle ☑</button>
      <button onclick="napToggleAllMassnahmen(false)"
        style="padding:1px 6px;border:1px solid #2a3a3a;border-radius:3px;background:transparent;color:#666;font-size:9px;cursor:pointer;">keine</button>
    </div>
  </div>
  ${list.length===0
    ?'<div style="font-size:10px;color:#444;padding:8px 0;">Keine Assets mit Leistungsbeitrag gefunden.</div>'
    :`<div style="background:#141420;border-radius:5px;overflow:hidden;max-height:220px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid #222240;background:#1a1a2e;">
        <th style="padding:3px 4px;width:18px;"></th>
        <th style="padding:3px 4px;text-align:left;font-size:9px;color:#555;font-weight:normal;">Name</th>
        <th style="padding:3px 4px;text-align:right;font-size:9px;color:#ef9a9a;font-weight:normal;">⬆Bezug</th>
        <th style="padding:3px 4px;text-align:right;font-size:9px;color:#a5d6a7;font-weight:normal;">⬇Einsp.</th>
        <th style="padding:3px 4px;text-align:center;font-size:9px;color:#555;font-weight:normal;">Jahr</th>
      </tr></thead>
      <tbody>${massRows}</tbody>
    </table></div>
    <div style="margin-top:5px;background:#1e1e30;border-radius:4px;padding:5px 7px;font-size:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
        <span style="color:#777;">⬆ Verbrauch (GZF ${gzf.toFixed(2)})</span>
        <span style="color:#ef9a9a;font-weight:600;">+${totalAddLoad.toFixed(0)} kW</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#777;">⬇ Einspeisung</span>
        <span style="color:#a5d6a7;font-weight:600;">-${totalAddGen.toFixed(0)} kW</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid #2a2a3e;padding-top:3px;">
        <span style="color:#aaa;font-weight:600;">Netto NAP (${chk.length} aktiv)</span>
        <span style="color:${totalNet>0?'#ef5350':'#66bb6a'};font-weight:700;">${totalNet>0?'+':''}${totalNet.toFixed(0)} kW</span>
      </div>
    </div>`}
</div>`;

  const pdfBlock = !s ? '' : `
<div style="margin-top:10px;">
  <button onclick="napExportPDF()"
    style="width:100%;padding:7px;background:#1a2a4a;border:1px solid #2a4a7a;border-radius:5px;color:#82b1ff;cursor:pointer;font-size:10px;font-weight:600;letter-spacing:.03em;">
    📄 Analyse als PDF exportieren
  </button>
</div>`;

  // Kalibrierung — nur wenn CSV geladen und mindestens ein NAP im System
  const napCount = _allAssets().filter(a => a.type === 'NAP').length;
  const kalBlock = (csvData && napCount > 0) ? `
<div style="margin-bottom:10px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;">Bestandskalibrierung</div>
  <button onclick="napShowKalibrierungDialog()"
    style="width:100%;padding:5px 8px;border:1px solid #7b1fa255;border-radius:4px;background:transparent;color:#ce93d8;cursor:pointer;font-size:10px;font-weight:600;text-align:left;">
    🔧 leistungKW aus NAP-Profil zurückrechnen
  </button>
  <div style="font-size:9px;color:#444;margin-top:3px;line-height:1.4;">Verteilt NAP-Peak proportional nach Nutzfläche × Nutzungstyp-Faktor auf alle verknüpften Verbraucher.</div>
</div>` : '';

  sb.innerHTML = napBlock + importBlock + kpiBlock + napCapBlock + kalBlock + massBlock + pdfBlock;
}

// ── Oberer Chart-Bereich ──────────────────────────────────────────────────────
function _napRenderMainTop() {
  const top = document.getElementById('nap-main-top');
  if (!top) return;
  const mode = _N.chartMode;
  const tabSt = t => `flex:1;padding:5px 0;border-radius:4px;cursor:pointer;font-size:10px;border:1px solid;${mode===t
    ?'background:rgba(38,166,154,.18);color:#80cbc4;border-color:#26a69a;'
    :'background:transparent;color:#555;border-color:#222;'}`;
  const zm = _N.zeitMonth;
  const moBtn = (i, lbl) => `<button onclick="_napSetZeitMonth(${i})"
    style="padding:2px 7px;border:1px solid ${i===zm?'#26a69a':'#222'};border-radius:3px;
    background:${i===zm?'rgba(38,166,154,.18)':'transparent'};color:${i===zm?'#80cbc4':'#555'};font-size:9px;cursor:pointer;">${lbl}</button>`;
  const moBtns = mode==='zeitreihe'?`
<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:5px;">
  ${moBtn(null,'Jahr')}
  ${['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'].map((l,i)=>moBtn(i,l)).join('')}
</div>`:'';
  top.innerHTML=`
<div style="display:flex;gap:4px;flex-shrink:0;margin-bottom:6px;">
  <button onclick="napSetChartMode('zeitreihe')"  style="${tabSt('zeitreihe')}">Jahresgang</button>
  <button onclick="napSetChartMode('dauerlinie')" style="${tabSt('dauerlinie')}">Jahresdauerlinie</button>
  <button onclick="napSetChartMode('tagesgang')"  style="${tabSt('tagesgang')}">Tagesgang</button>
  <button onclick="napSetChartMode('heatmap')"    style="${tabSt('heatmap')}">Jahres-Heatmap</button>
</div>
${moBtns}
<div style="flex:1;min-height:0;border-radius:5px;overflow:hidden;background:#14141e;position:relative;">
  <canvas id="nap-chart-canvas" style="width:100%;height:100%;display:block;"></canvas>
  <div id="nap-chart-tooltip" style="display:none;position:absolute;pointer-events:none;
    background:#1a1a2e;border:1px solid #2a3a5a;border-radius:6px;padding:8px 10px;
    font-family:sans-serif;font-size:11px;color:#ccc;white-space:nowrap;
    box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:10;"></div>
</div>`;
  requestAnimationFrame(() => {
    const c=document.getElementById('nap-chart-canvas');
    if (!c) return;
    c.width=c.offsetWidth||800; c.height=c.offsetHeight||320;
    _napDrawChart();
    _napBindChartHover(c);
  });
}
window._napSetZeitMonth = function(i) { _N.zeitMonth=(i===_N.zeitMonth?null:i); _napRenderMainTop(); };

// ── Unterer Lastentwicklungs-Bereich ──────────────────────────────────────────
function _napRenderMainBot() {
  const bot=document.getElementById('nap-main-bot');
  if (!bot) return;
  bot.innerHTML=`
<div style="flex-shrink:0;margin-bottom:5px;display:flex;align-items:center;gap:10px;">
  <span style="font-size:11px;font-weight:600;color:#80cbc4;">Lastentwicklung am NAP</span>
  <span style="font-size:9px;color:#555;">Peak-Last je Jahr (Bestand + geplante Maßnahmen)</span>
</div>
<div style="flex:1;min-height:0;border-radius:5px;overflow:hidden;background:#14141e;position:relative;">
  <canvas id="nap-dev-canvas" style="width:100%;height:100%;display:block;"></canvas>
  <div id="nap-dev-tooltip" style="display:none;position:absolute;pointer-events:none;
    background:#1a1a2e;border:1px solid #2a3a5a;border-radius:6px;padding:8px 10px;
    font-family:sans-serif;font-size:11px;color:#ccc;white-space:nowrap;
    box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:10;"></div>
</div>`;
  requestAnimationFrame(() => {
    const c=document.getElementById('nap-dev-canvas');
    if (!c) return;
    c.width=c.offsetWidth||800; c.height=c.offsetHeight||180;
    _napDrawLastentwicklung(c.getContext('2d'),c.width,c.height);
    _napBindDevHover(c);
  });
}

function _napRedrawBottom() {
  requestAnimationFrame(() => {
    const c=document.getElementById('nap-dev-canvas');
    if (!c) return;
    c.width=c.offsetWidth||800; c.height=c.offsetHeight||180;
    _napDrawLastentwicklung(c.getContext('2d'),c.width,c.height);
  });
}

// ── Chart-Dispatch ────────────────────────────────────────────────────────────
function _napDrawChart() {
  const c=document.getElementById('nap-chart-canvas');
  if (!c) return;
  const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  const d=_activeTopData();
  if (!d?.stats) {
    ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='#333'; ctx.font='12px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Keine Daten geladen',c.width/2,c.height/2);
    return;
  }
  const mode=_N.chartMode;
  if      (mode==='zeitreihe')  _napDrawZeitreihe(ctx,c.width,c.height,d);
  else if (mode==='dauerlinie') _napDrawDauerlinie(ctx,c.width,c.height,d);
  else if (mode==='tagesgang')  _napDrawTagesgang(ctx,c.width,c.height,d);
  else if (mode==='heatmap')    _napDrawHeatmap(ctx,c.width,c.height,d);
}

// ── Gemeinsame Canvas-Helfer ──────────────────────────────────────────────────
function _napBg(ctx,w,h,m) {
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#202030'; ctx.fillRect(m.l,m.t,w-m.l-m.r,h-m.t-m.b);
  return {cw:w-m.l-m.r,ch:h-m.t-m.b};
}
function _napGridY(ctx,w,h,m,maxV) {
  const ch=h-m.t-m.b;
  ctx.font='9px sans-serif'; ctx.textAlign='right'; ctx.setLineDash([2,4]);
  for (let i=0;i<=4;i++) {
    const v=maxV*(4-i)/4, y=m.t+i/4*ch;
    ctx.strokeStyle='#2a2a3e'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(m.l,y); ctx.lineTo(w-m.r,y); ctx.stroke();
    ctx.fillStyle='#666';
    ctx.fillText(v>=1000?`${(v/1000).toFixed(1)}M`:v.toFixed(0),m.l-4,y+3);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle='#444'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(m.l,m.t); ctx.lineTo(m.l,m.t+ch); ctx.stroke();
}

// ── Jahresgang ────────────────────────────────────────────────────────────────
function _napDrawZeitreihe(ctx,w,h,data) {
  const s=data.stats,m={l:58,r:12,t:15,b:30};
  const selMonth=_N.zeitMonth;
  let pts;
  if (selMonth==null) { pts=s.hourlyAgg; }
  else {
    const yr=data.year,mS=+new Date(yr,selMonth,1),mE=+new Date(yr,selMonth+1,1);
    pts=data.raw.filter(d=>+d.ts>=mS&&+d.ts<mE);
  }
  if (!pts?.length) return;
  let maxV=0; for (const p of pts) if (p.kw>maxV) maxV=p.kw;
  maxV=Math.max(maxV*1.05,1);
  const {cw,ch}=_napBg(ctx,w,h,m); _napGridY(ctx,w,h,m,maxV);
  ctx.strokeStyle='#444'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(m.l,m.t+ch); ctx.lineTo(m.l+cw,m.t+ch); ctx.stroke();
  ctx.font='9px sans-serif'; ctx.fillStyle='#555'; ctx.textAlign='center';
  const yr=data.year;
  if (selMonth==null) {
    const ys=+new Date(yr,0,1),ye=+new Date(yr+1,0,1);
    const mo=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    for (let i=0;i<12;i++) {
      const ms=+new Date(yr,i,1),x=m.l+((ms-ys)/(ye-ys))*cw;
      ctx.beginPath(); ctx.moveTo(x,m.t+ch); ctx.lineTo(x,m.t+ch+3); ctx.stroke();
      ctx.fillText(mo[i],x+((+new Date(yr,i+1,1)-ms)/(ye-ys))*cw/2,m.t+ch+12);
    }
  } else {
    const mS=+new Date(yr,selMonth,1),span=+new Date(yr,selMonth+1,1)-mS;
    const days=new Date(yr,selMonth+1,0).getDate();
    for (let d=1;d<=days;d+=Math.max(1,Math.floor(days/10))) {
      const x=m.l+((+new Date(yr,selMonth,d)-mS)/span)*cw;
      ctx.beginPath(); ctx.moveTo(x,m.t+ch); ctx.lineTo(x,m.t+ch+3); ctx.stroke();
      ctx.fillText(d+'.',x,m.t+ch+12);
    }
  }
  const yOf=v=>m.t+(1-v/maxV)*ch;
  const step=Math.max(1,Math.floor(pts.length/cw));
  ctx.beginPath(); ctx.moveTo(m.l,m.t+ch);
  for (let i=0;i<pts.length;i+=step) ctx.lineTo(m.l+(i/pts.length)*cw,yOf(pts[i].kw||0));
  ctx.lineTo(m.l+cw,m.t+ch); ctx.closePath();
  ctx.fillStyle='rgba(38,166,154,0.15)'; ctx.fill();
  ctx.beginPath(); ctx.strokeStyle='#26a69a'; ctx.lineWidth=1.2;
  for (let i=0;i<pts.length;i+=step) {
    const x=m.l+(i/pts.length)*cw,y=yOf(pts[i].kw||0);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.font='9px sans-serif'; ctx.fillStyle='#ef5350'; ctx.textAlign='right';
  ctx.fillText(`Peak: ${maxV.toFixed(0)} kW`,m.l+cw-2,m.t+12);

  // NAP-Grenzen aus Strom-Grundlagen (null = kein Limit)
  const napEinsp = window.elNapMaxEinspKw ?? null;
  const napBez   = window.elNapMaxBezugKw ?? null;
  if (napBez != null && napBez <= maxV) {
    const yL = yOf(napBez);
    ctx.save(); ctx.setLineDash([6,3]); ctx.strokeStyle='#4fc3f7'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(m.l,yL); ctx.lineTo(m.l+cw,yL); ctx.stroke();
    ctx.setLineDash([]); ctx.font='9px sans-serif'; ctx.fillStyle='#4fc3f7'; ctx.textAlign='left';
    ctx.fillText(`NAP Bezug ${napBez.toFixed(0)} kW`,m.l+4,yL-3); ctx.restore();
  }
  if (napEinsp != null && napEinsp <= maxV) {
    const yL = yOf(napEinsp);
    ctx.save(); ctx.setLineDash([6,3]); ctx.strokeStyle='#ef9a9a'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(m.l,yL); ctx.lineTo(m.l+cw,yL); ctx.stroke();
    ctx.setLineDash([]); ctx.font='9px sans-serif'; ctx.fillStyle='#ef9a9a'; ctx.textAlign='right';
    ctx.fillText(`NAP Einsp. ${napEinsp.toFixed(0)} kW`,m.l+cw-2,yL-3); ctx.restore();
  }
}

// ── Jahresdauerlinie ──────────────────────────────────────────────────────────
function _napDrawDauerlinie(ctx,w,h,data) {
  const s=data.stats,m={l:52,r:10,t:15,b:28};
  const {cw,ch}=_napBg(ctx,w,h,m); _napGridY(ctx,w,h,m,s.peak);
  const totalH=s.sorted.length*0.25;
  ctx.strokeStyle='#444'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(m.l,m.t+ch); ctx.lineTo(m.l+cw,m.t+ch); ctx.stroke();
  ctx.font='9px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#666';
  [0,1000,2000,3000,4000,5000,6000,7000,8000,8760].filter(v=>v<=totalH+50).forEach(hv=>{
    const x=m.l+(hv/totalH)*cw;
    ctx.beginPath(); ctx.moveTo(x,m.t+ch); ctx.lineTo(x,m.t+ch+3); ctx.stroke();
    ctx.fillText(hv===0?'0':hv===8760?'8760h':`${hv}h`,x,m.t+ch+12);
  });
  const step=Math.max(1,Math.floor(s.sorted.length/cw));
  const yOf=v=>m.t+(1-v/s.peak)*ch;
  ctx.beginPath(); ctx.moveTo(m.l,m.t+ch);
  for (let i=0;i<s.sorted.length;i+=step) ctx.lineTo(m.l+(i/s.sorted.length)*cw,yOf(s.sorted[i]));
  ctx.lineTo(m.l+cw,m.t+ch); ctx.closePath();
  ctx.fillStyle='rgba(38,166,154,0.18)'; ctx.fill();
  ctx.beginPath(); ctx.strokeStyle='#26a69a'; ctx.lineWidth=1.5;
  for (let i=0;i<s.sorted.length;i+=step) {
    const x=m.l+(i/s.sorted.length)*cw,y=yOf(s.sorted[i]);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.stroke();
  // Spitze
  const yPeak=yOf(s.peak);
  ctx.setLineDash([5,3]); ctx.strokeStyle='rgba(239,83,80,0.7)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(m.l,yPeak); ctx.lineTo(m.l+cw,yPeak); ctx.stroke();
  ctx.setLineDash([]); ctx.font='9px sans-serif'; ctx.fillStyle='#ef5350'; ctx.textAlign='left';
  ctx.fillText(`Spitze ${s.peak.toFixed(0)} kW`,m.l+4,yPeak-3);
  // Grundlast
  const yGrund=yOf(s.grundlast);
  ctx.setLineDash([5,3]); ctx.strokeStyle='rgba(100,230,140,0.7)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(m.l,yGrund); ctx.lineTo(m.l+cw,yGrund); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle='#64e696'; ctx.textAlign='left';
  ctx.fillText(`Grundlast ${s.grundlast.toFixed(0)} kW`,m.l+4,yGrund-3);
  // Mittellast
  const yMean=yOf(s.mean);
  ctx.setLineDash([4,3]); ctx.strokeStyle='#546e7a'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(m.l,yMean); ctx.lineTo(m.l+cw,yMean); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle='#789'; ctx.textAlign='right';
  ctx.fillText(`Ø${s.mean.toFixed(0)}kW`,m.l+cw-2,yMean-3);
  // Benutzungsdauer
  const xTb=m.l+(s.benutzungsdauer/totalH)*cw;
  ctx.setLineDash([3,3]); ctx.strokeStyle='#78909c'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(xTb,m.t); ctx.lineTo(xTb,m.t+ch); ctx.stroke();
  ctx.setLineDash([]); ctx.textAlign='center'; ctx.fillStyle='#78909c'; ctx.font='8px sans-serif';
  ctx.fillText(`Tb=${Math.round(s.benutzungsdauer)}h`,xTb,m.t+9);

  // NAP-Grenzen aus Strom-Grundlagen (null = kein Limit)
  const napEinspD = window.elNapMaxEinspKw ?? null;
  const napBezD   = window.elNapMaxBezugKw ?? null;
  const yOfD = v => m.t+(1-v/s.peak)*ch;
  if (napBezD != null && napBezD <= s.peak) {
    const yL=yOfD(napBezD);
    ctx.save(); ctx.setLineDash([6,3]); ctx.strokeStyle='#4fc3f7'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(m.l,yL); ctx.lineTo(m.l+cw,yL); ctx.stroke();
    ctx.setLineDash([]); ctx.font='9px sans-serif'; ctx.fillStyle='#4fc3f7'; ctx.textAlign='left';
    ctx.fillText(`NAP Bezug ${napBezD.toFixed(0)} kW`,m.l+4,yL-3); ctx.restore();
  }
  if (napEinspD != null && napEinspD <= s.peak) {
    const yL=yOfD(napEinspD);
    ctx.save(); ctx.setLineDash([6,3]); ctx.strokeStyle='#ef9a9a'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(m.l,yL); ctx.lineTo(m.l+cw,yL); ctx.stroke();
    ctx.setLineDash([]); ctx.font='9px sans-serif'; ctx.fillStyle='#ef9a9a'; ctx.textAlign='right';
    ctx.fillText(`NAP Einsp. ${napEinspD.toFixed(0)} kW`,m.l+cw-2,yL-3); ctx.restore();
  }
}

// ── Tagesgang ─────────────────────────────────────────────────────────────────
function _napDrawTagesgang(ctx,w,h,data) {
  const s=data.stats,m={l:52,r:10,t:15,b:28};
  const {cw,ch}=_napBg(ctx,w,h,m); _napGridY(ctx,w,h,m,s.peak);
  ctx.strokeStyle='#444'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(m.l,m.t+ch); ctx.lineTo(m.l+cw,m.t+ch); ctx.stroke();
  ctx.font='9px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#666';
  for (let hr=0;hr<=24;hr+=3) {
    const x=m.l+(hr/24)*cw;
    ctx.beginPath(); ctx.moveTo(x,m.t+ch); ctx.lineTo(x,m.t+ch+3); ctx.stroke();
    ctx.fillText(`${hr}h`,x,m.t+ch+12);
  }
  const yOf=v=>m.t+(1-v/s.peak)*ch;
  ctx.beginPath(); ctx.moveTo(m.l,m.t+ch);
  for (let i=0;i<96;i++) ctx.lineTo(m.l+(i/96)*cw,yOf(s.avgAll[i]));
  ctx.lineTo(m.l+cw,m.t+ch); ctx.closePath();
  ctx.fillStyle='rgba(38,166,154,0.12)'; ctx.fill();
  const drawL=(prof,col,dash)=>{
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.strokeStyle=col; ctx.lineWidth=1.5;
    for (let i=0;i<96;i++) { const x=m.l+(i/96)*cw,y=yOf(prof[i]); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }
    ctx.stroke(); ctx.setLineDash([]);
  };
  drawL(s.avgWe,'#42a5f5',[5,3]);
  drawL(s.avgWd,'#66bb6a',null);
  drawL(s.avgAll,'#26a69a',null);
  const lg=[{c:'#26a69a',t:'Gesamt'},{c:'#66bb6a',t:'Werktag'},{c:'#42a5f5',t:'Wochenende'}];
  ctx.font='9px sans-serif'; ctx.textAlign='left';
  let lx=m.l+4;
  for (const {c,t} of lg) {
    ctx.fillStyle=c; ctx.fillRect(lx,m.t+4,10,6); lx+=12;
    ctx.fillStyle='#aaa'; ctx.fillText(t,lx,m.t+10); lx+=ctx.measureText(t).width+8;
  }
}

// ── Jahres-Heatmap ────────────────────────────────────────────────────────────
function _napDrawHeatmap(ctx,w,h,data) {
  const s=data.stats,m={l:32,r:5,t:5,b:16};
  const cw=w-m.l-m.r,ch=h-m.t-m.b;
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,w,h);
  const SLOTS=96; const cellW=cw/365,cellH=ch/SLOTS;
  let maxV=0; for (let i=0;i<s.heatmapGrid.length;i++) if (s.heatmapGrid[i]>maxV) maxV=s.heatmapGrid[i];
  for (let day=0;day<365;day++) for (let slot=0;slot<SLOTS;slot++) {
    const v=s.heatmapGrid[day*SLOTS+slot];
    ctx.fillStyle=_napHeatColor(maxV>0?v/maxV:0);
    ctx.fillRect(m.l+day*cellW,m.t+slot*cellH,Math.ceil(cellW)+0.5,Math.ceil(cellH)+0.5);
  }
  ctx.font='8px sans-serif'; ctx.textAlign='right'; ctx.fillStyle='#666';
  for (let hr=0;hr<24;hr+=6) ctx.fillText(`${hr}:00`,m.l-3,m.t+hr*4*cellH+4);
  const yr=s.year||new Date().getFullYear(),ys=+new Date(yr,0,1);
  const mo=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  ctx.textAlign='center';
  for (let i=0;i<12;i++) {
    const d0=Math.floor((+new Date(yr,i,1)-ys)/86400000);
    const dm=new Date(yr,i+1,0).getDate();
    ctx.fillText(mo[i],m.l+(d0+dm/2)*cellW,m.t+ch+12);
  }
}
function _napHeatColor(t) {
  const stops=[[0,[26,35,78]],[0.3,[0,150,136]],[0.6,[255,235,59]],[0.8,[255,152,0]],[1,[244,67,54]]];
  const v=Math.max(0,Math.min(1,t));
  for (let i=0;i<stops.length-1;i++) {
    const[t0,c0]=stops[i],[t1,c1]=stops[i+1];
    if (v>=t0&&v<=t1) {
      const f=(v-t0)/(t1-t0);
      return `rgb(${Math.round(c0[0]+f*(c1[0]-c0[0]))},${Math.round(c0[1]+f*(c1[1]-c0[1]))},${Math.round(c0[2]+f*(c1[2]-c0[2]))})`;
    }
  }
  return '#f44336';
}

// ── Lastentwicklung ───────────────────────────────────────────────────────────
function _napDrawLastentwicklung(ctx,w,h) {
  const rows=_napCalcYearlyLoads(); const cap=_N.capacityKW||null;
  const m={l:58,r:20,t:30,b:28};
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,w,h);
  if (!rows.length) {
    ctx.fillStyle='#333'; ctx.font='11px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Keine Maßnahmen / keine Messdaten',w/2,h/2); return;
  }
  const cw=w-m.l-m.r,ch=h-m.t-m.b;
  ctx.fillStyle='#1e1e2e'; ctx.fillRect(m.l,m.t,cw,ch);
  let maxY=0;
  for (const r of rows) {
    const bezug=r.basePeak+r.addLoad;
    if (bezug>maxY) maxY=bezug; if ((r.addGen||0)>maxY) maxY=r.addGen; if ((cap||0)>maxY) maxY=cap;
  }
  maxY=Math.max(maxY*1.1,1);
  _napGridY(ctx,w,h,m,maxY);
  const bSlot=cw/rows.length,bPair=Math.max(3,bSlot*0.72),bW=Math.max(1,bPair/2-1);
  for (let i=0;i<rows.length;i++) {
    const r=rows[i];
    const xL=m.l+i*bSlot+bSlot/2-bW-0.5,xR=m.l+i*bSlot+bSlot/2+0.5;
    const hBase=(r.basePeak/maxY)*ch;
    ctx.fillStyle='#2a3a5a'; ctx.fillRect(xL,m.t+ch-hBase,bW,hBase);
    if (r.addLoad>0) {
      const hAdd=(r.addLoad/maxY)*ch,overCap=cap&&(r.basePeak+r.addLoad)>cap;
      ctx.fillStyle=overCap?'rgba(239,83,80,0.85)':'rgba(255,138,60,0.80)';
      ctx.fillRect(xL,m.t+ch-hBase-hAdd,bW,hAdd);
    }
    if (r.addGen>0) {
      const hGen=(r.addGen/maxY)*ch;
      ctx.fillStyle='rgba(100,200,130,0.80)'; ctx.fillRect(xR,m.t+ch-hGen,bW,hGen);
    }
  }
  ctx.beginPath(); ctx.strokeStyle='rgba(130,200,255,0.95)'; ctx.lineWidth=1.8; ctx.setLineDash([]);
  for (let i=0;i<rows.length;i++) {
    const x=m.l+i*bSlot+bSlot/2-bW/2-0.5,y=m.t+(1-(rows[i].basePeak+rows[i].addLoad)/maxY)*ch;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.beginPath(); ctx.strokeStyle='rgba(100,230,140,0.95)'; ctx.lineWidth=1.8;
  for (let i=0;i<rows.length;i++) {
    const x=m.l+i*bSlot+bSlot/2+bW/2+0.5,y=m.t+(1-(rows[i].addGen||0)/maxY)*ch;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.font='9px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#555';
  const step=Math.max(1,Math.floor(rows.length/12));
  for (let i=0;i<rows.length;i+=step) ctx.fillText(rows[i].year,m.l+i*bSlot+bSlot/2,m.t+ch+12);
  if (cap&&cap>0) {
    const yCap=m.t+(1-cap/maxY)*ch;
    ctx.setLineDash([6,4]); ctx.strokeStyle='#ef5350'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(m.l,yCap); ctx.lineTo(m.l+cw,yCap); ctx.stroke();
    ctx.setLineDash([]); ctx.font='9px sans-serif'; ctx.fillStyle='#ef5350'; ctx.textAlign='right';
    ctx.fillText(`Kapazität ${cap} kW`,m.l+cw-2,yCap-3);
  }
  // Legende
  ctx.font='9px sans-serif'; ctx.textAlign='left';
  const lg=[{c:'#2a3a5a',t:'Bezug Bestand'},{c:'rgba(255,138,60,.80)',t:'+ Zubau Last'},{c:'rgba(100,200,130,.80)',t:'Einsp. Zubau'}];
  let lx=m.l+4;
  for (const e of lg) { ctx.fillStyle=e.c; ctx.fillRect(lx,m.t-15,9,7); lx+=11; ctx.fillStyle='#666'; ctx.fillText(e.t,lx,m.t-9); lx+=ctx.measureText(e.t).width+8; }
}

// ── Hover-Tooltips ────────────────────────────────────────────────────────────
function _napBindChartHover(canvas) {
  const tt=document.getElementById('nap-chart-tooltip');
  if (!tt) return;
  function showTT(e,html) {
    tt.innerHTML=html; tt.style.display='block';
    const rect=canvas.getBoundingClientRect();
    const ttW=tt.offsetWidth||220,ttH=tt.offsetHeight||120;
    const rawX=e.clientX-rect.left+14,rawY=e.clientY-rect.top-ttH/2;
    tt.style.left=(rawX+ttW>rect.width?rawX-ttW-28:rawX)+'px';
    tt.style.top=Math.max(4,Math.min(rawY,rect.height-ttH-4))+'px';
  }
  function ttRow(l,v,c){return`<div style="display:flex;justify-content:space-between;gap:16px;margin:2px 0;"><span style="color:#666">${l}</span><span style="font-weight:600;color:${c||'#ccc'}">${v}</span></div>`;}
  function ttHdr(t){return`<div style="font-size:12px;font-weight:700;color:#80cbc4;margin-bottom:5px;border-bottom:1px solid #2a3a5a;padding-bottom:4px;">${t}</div>`;}

  canvas.addEventListener('mousemove',e=>{
    const mode=_N.chartMode, data=_activeTopData();
    if (!data?.stats){tt.style.display='none';return;}
    const s=data.stats,rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(canvas.width/rect.width);
    const my=(e.clientY-rect.top)*(canvas.height/rect.height);
    const fmt=v=>v>=1000?`${(v/1000).toFixed(2)} MW`:`${v.toFixed(1)} kW`;

    if (mode==='dauerlinie') {
      const ML=52,MR=10,MT=15,MB=28;
      const cw=canvas.width-ML-MR,ch=canvas.height-MT-MB;
      if (mx<ML||mx>ML+cw||my<MT||my>MT+ch){tt.style.display='none';return;}
      const totalH=s.sorted.length*0.25,t=(mx-ML)/cw;
      const stunden=t*totalH,idx=Math.min(s.sorted.length-1,Math.floor(t*s.sorted.length));
      showTT(e,ttHdr(`Dauerlinie · ${stunden.toFixed(0)} h`)+ttRow('Leistung',fmt(s.sorted[idx]),'#26a69a')+ttRow('% von Spitzenlast',`${s.peak>0?(s.sorted[idx]/s.peak*100).toFixed(1):0} %`,'#80cbc4'));
      return;
    }
    if (mode==='tagesgang') {
      const ML=52,MR=10,MT=15,MB=28;
      const cw=canvas.width-ML-MR,ch=canvas.height-MT-MB;
      if (mx<ML||mx>ML+cw||my<MT||my>MT+ch){tt.style.display='none';return;}
      const slot=Math.min(95,Math.floor((mx-ML)/cw*96));
      const h2=Math.floor(slot/4),min2=(slot%4)*15;
      const zeitStr=`${String(h2).padStart(2,'0')}:${String(min2).padStart(2,'0')}`;
      showTT(e,ttHdr(`Tagesgang · ${zeitStr} Uhr`)+ttRow('Gesamt Ø',fmt(s.avgAll[slot]),'#26a69a')+ttRow('Werktag Ø',fmt(s.avgWd[slot]),'#66bb6a')+ttRow('Wochenende Ø',fmt(s.avgWe[slot]),'#42a5f5'));
      return;
    }
    if (mode==='heatmap'&&s.heatmapGrid) {
      const ML2=32,MR2=5,MT2=5,MB2=16;
      const cw2=canvas.width-ML2-MR2,ch2=canvas.height-MT2-MB2;
      if (mx<ML2||mx>ML2+cw2||my<MT2||my>MT2+ch2){tt.style.display='none';return;}
      const day=Math.floor((mx-ML2)/(cw2/365)),slot=Math.floor((my-MT2)/(ch2/96));
      if (day<0||day>=365||slot<0||slot>=96){tt.style.display='none';return;}
      const val=s.heatmapGrid[day*96+slot];
      const maxV=Math.max(...s.heatmapGrid);
      const yr2=data.year||new Date().getFullYear();
      const date=new Date(yr2,0,1+day);
      const wt=['So','Mo','Di','Mi','Do','Fr','Sa'];
      const mo=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
      const h2=Math.floor(slot/4),min2=(slot%4)*15;
      showTT(e,ttHdr(`${wt[date.getDay()]}, ${date.getDate()}. ${mo[date.getMonth()]} ${yr2}`)+ttRow('Uhrzeit',`${String(h2).padStart(2,'0')}:${String(min2).padStart(2,'0')} Uhr`,'#aaa')+ttRow('Leistung',fmt(val),_napHeatColor(maxV>0?val/maxV:0)));
      return;
    }
    // Zeitreihe
    if (mode==='zeitreihe') {
      const ML=58,MR=12,MT=15,MB=30,selMonth=_N.zeitMonth;
      let pts=s.hourlyAgg;
      if (selMonth!=null){const yr=data.year,mS=+new Date(yr,selMonth,1),mE=+new Date(yr,selMonth+1,1);pts=data.raw.filter(d=>+d.ts>=mS&&+d.ts<mE);}
      if (!pts?.length){tt.style.display='none';return;}
      const cw=canvas.width-ML-MR,ch=canvas.height-MT-MB;
      if (mx<ML||mx>ML+cw||my<MT||my>MT+ch){tt.style.display='none';return;}
      const idx=Math.min(pts.length-1,Math.floor((mx-ML)/cw*pts.length));
      const pt=pts[idx];
      const mo=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
      const dateStr=`${pt.ts.getDate()}. ${mo[pt.ts.getMonth()]} ${pt.ts.getFullYear()} ${String(pt.ts.getHours()).padStart(2,'0')}:00`;
      showTT(e,ttHdr(dateStr)+ttRow('Leistung',fmt(pt.kw),'#26a69a'));
      return;
    }
    tt.style.display='none';
  });
  canvas.addEventListener('mouseleave',()=>{tt.style.display='none';});
}

function _napBindDevHover(canvas) {
  const tt=document.getElementById('nap-dev-tooltip');
  if (!tt) return;
  canvas.addEventListener('mousemove',e=>{
    const rows=_napCalcYearlyLoads();
    if (!rows.length){tt.style.display='none';return;}
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(canvas.width/rect.width);
    const my=(e.clientY-rect.top)*(canvas.height/rect.height);
    const ML=58,MR=20,MT=30,MB=28;
    const cw=canvas.width-ML-MR,ch=canvas.height-MT-MB;
    if (mx<ML||mx>ML+cw||my<MT||my>MT+ch){tt.style.display='none';return;}
    const idx=Math.floor((mx-ML)/cw*rows.length);
    if (idx<0||idx>=rows.length){tt.style.display='none';return;}
    const r=rows[idx],cap=_N.capacityKW||null,gzf=_N.gzf;
    const bezugGes=r.basePeak+r.addLoad,overCap=cap&&bezugGes>cap;
    const fmt=v=>v>=1000?`${(v/1000).toFixed(2)} MW`:`${v.toFixed(0)} kW`;
    const row=(l,v,c)=>`<div style="display:flex;justify-content:space-between;gap:16px;margin:2px 0;"><span style="color:#666">${l}</span><span style="font-weight:600;color:${c}">${v}</span></div>`;
    let html=`<div style="font-size:12px;font-weight:700;color:#80cbc4;margin-bottom:6px;border-bottom:1px solid #2a3a5a;padding-bottom:4px;">${r.year}</div>`;
    html+=row('Bezug Bestand',fmt(r.basePeak),'#7ab2d4');
    if (r.addLoad>0) html+=row(`+ Zubau (GZF ${gzf.toFixed(2)})`,fmt(r.addLoad),'#ff8a3c');
    html+=`<div style="display:flex;justify-content:space-between;gap:16px;margin:3px 0;border-top:1px solid #2a2a40;padding-top:3px;"><span style="color:#aaa;font-weight:600;">Bezug gesamt</span><span style="font-weight:700;color:${overCap?'#ef5350':'rgba(130,200,255,.95)'};">${fmt(bezugGes)}${overCap?' ⚠':''}</span></div>`;
    if (r.addGen>0) html+=row('Einspeisung Zubau',fmt(r.addGen),'rgba(100,230,140,.95)');
    if (cap) { html+=row('NAP-Kapazität',fmt(cap),'#ef5350'); if (overCap) html+=`<div style="margin-top:4px;color:#ef5350;font-size:10px;">⚠ Überschreitung um ${fmt(bezugGes-cap)}</div>`; }
    tt.innerHTML=html; tt.style.display='block';
    const ttW=tt.offsetWidth||200,ttH=tt.offsetHeight||120;
    const rawX=e.clientX-rect.left+14,rawY=e.clientY-rect.top-ttH/2;
    tt.style.left=(rawX+ttW>rect.width?rawX-ttW-28:rawX)+'px';
    tt.style.top=Math.max(4,Math.min(rawY,rect.height-ttH-4))+'px';
  });
  canvas.addEventListener('mouseleave',()=>{tt.style.display='none';});
}

// ── PDF-Export ────────────────────────────────────────────────────────────────
export function napExportPDF() {
  const data=_activeData();
  if (!data?.stats){_hint('Keine Daten geladen.');return;}
  const s=data.stats,gzf=_N.gzf,cap=_N.capacityKW||null;
  const rows=_napCalcYearlyLoads(),chk=(_N.massnahmen||[]).filter(m=>m.checked);
  const CW=1200,CH=340,CH_HEAT=480,CH_DEV=220;
  function mc(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  const cZ=mc(CW,CH);_napDrawZeitreihe(cZ.getContext('2d'),CW,CH,data);
  const cD=mc(CW,CH);_napDrawDauerlinie(cD.getContext('2d'),CW,CH,data);
  const cT=mc(CW,CH);_napDrawTagesgang(cT.getContext('2d'),CW,CH,data);
  const cH=mc(CW,CH_HEAT);_napDrawHeatmap(cH.getContext('2d'),CW,CH_HEAT,data);
  const cDev=mc(CW,CH_DEV);_napDrawLastentwicklung(cDev.getContext('2d'),CW,CH_DEV);
  const fmt=v=>v>=1000?`${(v/1000).toFixed(2)} MW`:`${v.toFixed(0)} kW`;
  const fmtE=v=>v>=1e6?`${(v/1e6).toFixed(2)} GWh`:`${(v/1e3).toFixed(1)} MWh`;
  const now=new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const massTbl=chk.length===0?'<p style="color:#999;font-style:italic;">Keine Maßnahmen ausgewählt.</p>':`
<table style="width:100%;border-collapse:collapse;font-size:11px;">
  <thead><tr style="background:#f0f0f0;">
    <th style="padding:4px 6px;text-align:left;border:1px solid #ddd;">Name</th>
    <th style="padding:4px 6px;text-align:right;border:1px solid #ddd;">Bezug kW</th>
    <th style="padding:4px 6px;text-align:right;border:1px solid #ddd;">Einsp. kW</th>
    <th style="padding:4px 6px;text-align:center;border:1px solid #ddd;">Baujahr</th>
  </tr></thead><tbody>
  ${chk.map((m,i)=>`<tr style="background:${i%2?'#f9f9f9':'#fff'};">
    <td style="padding:3px 6px;border:1px solid #ddd;">${m.name}</td>
    <td style="padding:3px 6px;text-align:right;border:1px solid #ddd;">${m.loadKW>0?(m.loadKW*gzf).toFixed(0):'–'}</td>
    <td style="padding:3px 6px;text-align:right;border:1px solid #ddd;">${m.genKW>0?(m.genKW*gzf).toFixed(0):'–'}</td>
    <td style="padding:3px 6px;text-align:center;border:1px solid #ddd;">${m.baujahr||'–'}</td>
  </tr>`).join('')}
  </tbody></table>`;
  const html=`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>NAP Lastganganalyse – ${data.filename}</title>
<style>*{box-sizing:border-box;}body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:20px 28px;}
h1{font-size:18px;color:#1565c0;margin:0 0 4px;}h2{font-size:13px;color:#1565c0;margin:18px 0 6px;border-bottom:1.5px solid #1565c0;padding-bottom:3px;}
.meta{font-size:10px;color:#888;margin-bottom:16px;}.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;}
.kpi{background:#f5f7fa;border:1px solid #dde;border-radius:5px;padding:8px 10px;text-align:center;}
.kpi .v{font-size:16px;font-weight:700;color:#1565c0;}.kpi .l{font-size:9px;color:#888;margin-top:2px;}
img{width:100%;border:1px solid #ddd;border-radius:4px;margin-top:6px;}
@media print{body{padding:10px 14px;}button{display:none!important;}.pb{page-break-before:always;}}</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
  <div><h1>NAP Lastganganalyse</h1>
  <div class="meta">Datei: ${data.filename} · Messjahr: ${s.year} · Erstellt: ${now}</div></div>
  <button onclick="window.print()" style="padding:6px 16px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Drucken / PDF</button>
</div>
<h2>Kennzahlen Messjahr ${s.year}</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="v" style="color:#c62828">${fmt(s.peak)}</div><div class="l">Jahreshöchstlast</div></div>
  <div class="kpi"><div class="v" style="color:#00695c">${fmt(s.grundlast)}</div><div class="l">Grundlast (10%-Pz.)</div></div>
  <div class="kpi"><div class="v" style="color:#1565c0">${fmt(s.mean)}</div><div class="l">Mittellast</div></div>
  <div class="kpi"><div class="v" style="color:#6a1b9a">${(s.lastfaktor*100).toFixed(1)} %</div><div class="l">Lastfaktor</div></div>
  <div class="kpi"><div class="v" style="color:#e65100">${Math.round(s.benutzungsdauer)} h</div><div class="l">Benutzungsdauer</div></div>
  <div class="kpi"><div class="v" style="color:#2e7d32">${Math.round(s.volllaststunden)} h</div><div class="l">Volllaststunden</div></div>
  <div class="kpi"><div class="v" style="color:#e65100">${fmtE(s.jahresenergie)}</div><div class="l">Jahresenergie</div></div>
  <div class="kpi"><div class="v" style="color:#c62828">${s.ueberschreitungsstunden80.toFixed(0)} h</div><div class="l">&gt; 80 % Peak</div></div>
</div>
${cap?`<div style="background:#fff3cd;border:1px solid #f9a825;border-radius:4px;padding:6px 10px;font-size:11px;margin-bottom:12px;">NAP-Kapazität: <strong>${cap} kW</strong> · GZF: <strong>${gzf.toFixed(2)}</strong></div>`:''}
<h2>Jahresgang</h2><img src="${cZ.toDataURL()}" alt="Jahresgang">
<h2>Jahresdauerlinie</h2><img src="${cD.toDataURL()}" alt="Dauerlinie">
<div class="pb"></div>
<h2>Tagesgang</h2><img src="${cT.toDataURL()}" alt="Tagesgang">
<h2>Jahres-Heatmap</h2><img src="${cH.toDataURL()}" alt="Heatmap" style="image-rendering:pixelated;">
<div class="pb"></div>
<h2>Lastentwicklung</h2><img src="${cDev.toDataURL()}" alt="Lastentwicklung">
<h2>Maßnahmen (${chk.length} aktiv, GZF ${gzf.toFixed(2)})</h2>
${massTbl}
</body></html>`;
  const win=window.open('','_blank');
  win.document.write(html); win.document.close();
}

// ── Bestandskalibrierung ──────────────────────────────────────────────────────
// Schätzt leistungKW für Verbraucher-Assets proportional aus dem gemessenen NAP-Peak.
// Gewichtung: Nutzungstyp-Faktor × Nutzfläche (Grundfläche × Stockwerke × 0,8).
// Assets ohne Gebäudezuordnung (kein buildingId / keine Fläche) bleiben unverändert.

// Faktoren geben die relative spezifische Leistung (W/m²) je SLP-Typ an —
// bezogen auf H0 als Basis 1,0. Editierbar im Kalibrierungs-Dialog.
const _KAL_DEFAULT_FACTORS = {
  H0:  1.0,   // Haushalt
  G0:  1.8,   // Gewerbe allgemein
  G1:  1.8,   // Gewerbe werktags 8–18 h
  G2:  1.5,   // Gewerbe mit starkem Abendverbrauch
  G3:  2.2,   // Gewerbe durchlaufend
  G4:  2.5,   // Laden / Friseur
  G5:  2.0,   // Bäckerei mit Backstube
  G6:  1.5,   // Wochenendbetrieb
  L0:  1.0,   // Landwirtschaft allgemein
  L1:  1.2,   // Landwirtschaft mit Milchwirtschaft
  L2:  0.8,   // Sonstige Landwirtschaft
  BW0: 1.8,   // Bundeswehr allgemein
  BW1: 1.3,   // Unterkunft / Kaserne
  BW2: 2.0,   // Werkstatt / Instandhaltung
  BW3: 2.2,   // Kantine / Truppenverpflegung
};
// Kurzbezeichnungen für die Faktor-Anzeige im Dialog
const _KAL_SLP_LABELS = {
  H0: 'H0 – Haushalt',
  G0: 'G0 – Gewerbe allg.',
  G1: 'G1 – Gewerbe 8–18 h',
  G2: 'G2 – Gewerbe abends',
  G3: 'G3 – Dauerbetrieb',
  G4: 'G4 – Laden/Friseur',
  G5: 'G5 – Bäckerei',
  G6: 'G6 – Wochenende',
  L0: 'L0 – Landw. allg.',
  L1: 'L1 – Landw. Milch',
  L2: 'L2 – Sonstige Landw.',
  BW0:'BW0 – BW allg.',
  BW1:'BW1 – Kaserne',
  BW2:'BW2 – Werkstatt',
  BW3:'BW3 – Kantine',
};

function _kalGetFactors() { return _N.kalibrierFactors || _KAL_DEFAULT_FACTORS; }

function _napBuildKalibrierungEntries() {
  if (!_N.data?.stats) return null;
  const factors = _kalGetFactors();
  const napPeak = _N.data.stats.peak;

  // NAP ermitteln (ausgewählt oder einziger aktiver NAP)
  let napId = _N.selectedNapId;
  if (!napId) {
    const naps = _allAssets().filter(a => a.type === 'NAP' && getAssetStatus(a, _yr()) === 'active');
    if (naps.length === 1) napId = naps[0].id;
    if (!napId) return null;
  }

  // Verbraucher-Typen downstream des NAP ermitteln
  const consumers = _napBfsDownstream(napId)
    .filter(a => ['Verbraucher', 'WP', 'Lade'].includes(a.type));
  if (!consumers.length) return { napPeak, napId, entries: [], fixedEntries: [], fixedLoad: 0, availableKW: napPeak, totalWeight: 0 };

  const gebs = window.gebaeude || [];

  const all = consumers.map(asset => {
    const p = asset.props || {};
    const currentKW = asset.type === 'Lade'
      ? (parseInt(p.anzahlPunkte) || 1) * (parseFloat(p.leistungProPunktKW) || 11)
      : parseFloat(p.leistungKW) || 0;

    const building    = asset.buildingId ? gebs.find(g => g.id === asset.buildingId) : null;
    const gf          = parseFloat(building?.flaeche) || 0;
    const sw          = parseInt(building?.stockwerke) || 1;
    const nutzflaeche = Math.round(gf * sw * 0.8);
    // SLP-Typ aus Asset-Props (selbe Quelle wie Inspector + Profil-Berechnung)
    const SLP_ASSET_DEFAULTS = { Verbraucher: 'G0', Lade: 'G3', WP: 'H0' };
    const slpTyp      = (asset.props?.slpTyp) || SLP_ASSET_DEFAULTS[asset.type] || 'G0';
    const typeFactor  = factors[slpTyp] ?? 1.0;
    const weight      = nutzflaeche > 0 ? typeFactor * nutzflaeche : 0;

    return { asset, building, currentKW, nutzflaeche, slpTyp, typeFactor, weight, calibKW: 0 };
  });

  // Kalibrierbare (haben Gewicht) vs. Fest (kein Gebäude/keine Fläche)
  const calibEntries = all.filter(e => e.weight > 0);
  const fixedEntries = all.filter(e => e.weight === 0);
  const fixedLoad    = fixedEntries.reduce((s, e) => s + e.currentKW, 0);
  const availableKW  = Math.max(0, napPeak - fixedLoad);
  const totalWeight  = calibEntries.reduce((s, e) => s + e.weight, 0);

  if (totalWeight > 0) {
    for (const e of calibEntries) e.calibKW = Math.round(availableKW * e.weight / totalWeight);
  }
  for (const e of fixedEntries) e.calibKW = e.currentKW; // unverändert

  return { napPeak, napId, entries: calibEntries, fixedEntries, fixedLoad, availableKW, totalWeight };
}

// Hilfsfunktion: Tabellenzeilen für Dialog rendern
function _napKalTableRows(entries, fixedEntries) {
  const r = entries.map(e => `
<tr style="border-bottom:1px solid #1a1a28;">
  <td style="padding:3px 6px;font-size:10px;color:#ccc;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.asset.name}">${e.asset.name}</td>
  <td style="padding:3px 6px;font-size:10px;color:#888;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.building?.name||'–'}">${e.building?.name||'–'}</td>
  <td style="padding:3px 6px;font-size:10px;color:#80cbc4;font-weight:600;">${e.slpTyp||'–'}</td>
  <td style="padding:3px 6px;text-align:right;font-size:10px;color:#64b5f6;">${e.nutzflaeche>0?e.nutzflaeche.toLocaleString('de-DE'):'–'} m²</td>
  <td style="padding:3px 6px;text-align:right;font-size:10px;color:#ce93d8;">${e.typeFactor.toFixed(1)}</td>
  <td style="padding:3px 6px;text-align:right;font-size:10px;color:#555;">${e.currentKW.toFixed(0)}</td>
  <td style="padding:3px 6px;text-align:right;"><strong style="font-size:11px;color:#ef9a9a;">${e.calibKW}</strong> <span style="font-size:9px;color:#444;">kW</span></td>
</tr>`).join('');
  const f = fixedEntries.map(e => `
<tr style="border-bottom:1px solid #1a1a28;opacity:.45;">
  <td style="padding:3px 6px;font-size:10px;color:#888;" title="${e.asset.name}">${e.asset.name}</td>
  <td colspan="3" style="padding:3px 6px;font-size:9px;color:#555;font-style:italic;">kein Gebäude / keine Fläche → unverändert</td>
  <td style="padding:3px 6px;text-align:right;font-size:10px;color:#555;">–</td>
  <td style="padding:3px 6px;text-align:right;font-size:10px;color:#555;">${e.currentKW.toFixed(0)}</td>
  <td style="padding:3px 6px;text-align:right;font-size:10px;color:#555;">${e.currentKW.toFixed(0)} kW</td>
</tr>`).join('');
  return r + f;
}

export function napShowKalibrierungDialog() {
  if (!_N.data?.stats) { _hint('Bitte zuerst einen CSV-Lastgang laden.'); return; }
  const kal = _napBuildKalibrierungEntries();
  if (!kal) { _hint('Kein eindeutiger NAP gefunden – bitte NAP zuerst in der synthetischen Analyse auswählen.'); return; }
  window._napLastKal = kal;
  _napRenderKalDialog(kal);
}

function _napRenderKalDialog(kal) {
  document.getElementById('nap-kal-overlay')?.remove();
  const { napPeak, entries, fixedEntries, fixedLoad } = kal;
  const totalCalib  = entries.reduce((s, e) => s + e.calibKW, 0) + fixedLoad;
  const abw         = totalCalib - napPeak;
  const factors     = _kalGetFactors();
  const hasRows     = entries.length + fixedEntries.length > 0;

  // Dynamisch: alle registrierten Profile + Fallback-Faktor 1,5 für zukünftige Profile
  const factorInputs = getElSlpProfiles().map(p => {
    const k     = p.id;
    const val   = (factors[k] ?? _KAL_DEFAULT_FACTORS[k] ?? 1.5).toFixed(1);
    const label = (_KAL_SLP_LABELS[k] || `${k} – ${p.label}`).replace(/^[A-Z0-9]+ – /,'');
    return `
<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
  <span style="font-size:10px;color:#80cbc4;font-weight:600;width:26px;flex-shrink:0;">${k}</span>
  <input type="number" value="${val}" min="0.1" max="10" step="0.1"
    style="width:46px;background:#0f0f1a;border:1px solid #2a3a3a;border-radius:3px;color:#ccc;padding:2px 5px;font-size:10px;"
    oninput="napKalUpdateFactor('${k}',this.value)">
  <span style="font-size:9px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>
</div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'nap-kal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
<div style="background:#1a1a2e;border:1px solid #2a3a5a;border-radius:10px;width:790px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.8);font-family:sans-serif;overflow:hidden;">

  <!-- Header -->
  <div style="background:#0f1020;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a40;flex-shrink:0;">
    <div>
      <div style="font-size:13px;font-weight:700;color:#80cbc4;">🔧 Bestandskalibrierung</div>
      <div style="font-size:10px;color:#555;margin-top:2px;">NAP-Peak ${napPeak.toFixed(0)} kW proportional auf ${entries.length} Verbraucher zurückrechnen</div>
    </div>
    <button onclick="document.getElementById('nap-kal-overlay')?.remove()"
      style="background:transparent;border:1px solid #333;border-radius:4px;color:#aaa;cursor:pointer;font-size:14px;padding:2px 8px;">✕</button>
  </div>

  <!-- Bilanz + Faktoren -->
  <div style="display:flex;flex-shrink:0;border-bottom:1px solid #1a1a28;">
    <!-- KPIs -->
    <div style="flex:1;padding:10px 14px;background:#141420;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:6px;">Bilanz</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <div style="background:#1e1e30;border-radius:4px;padding:5px 8px;text-align:center;">
          <div style="font-weight:700;color:#ef5350;font-size:14px;">${napPeak.toFixed(0)} kW</div>
          <div style="color:#555;font-size:8px;">NAP-Peak (Messung)</div>
        </div>
        <div style="background:#1e1e30;border-radius:4px;padding:5px 8px;text-align:center;">
          <div id="nap-kal-kpi-sum" style="font-weight:700;color:${Math.abs(abw)<2?'#66bb6a':'#f9a825'};font-size:14px;">${totalCalib.toFixed(0)} kW</div>
          <div style="color:#555;font-size:8px;">Summe kalibriert</div>
        </div>
        <div style="background:#1e1e30;border-radius:4px;padding:5px 8px;text-align:center;">
          <div style="font-weight:700;color:#64b5f6;font-size:14px;">${entries.length}</div>
          <div style="color:#555;font-size:8px;">kalibrierbar</div>
        </div>
        <div style="background:#1e1e30;border-radius:4px;padding:5px 8px;text-align:center;">
          <div style="font-weight:700;color:#555;font-size:14px;">${fixedEntries.length}</div>
          <div style="color:#555;font-size:8px;">fix (kein Gebäude)</div>
        </div>
      </div>
      <div style="margin-top:7px;font-size:9px;color:#555;line-height:1.5;">
        Methode: Nutzfläche (GF × SW × 0,8) × Nutzungstyp-Faktor.<br>
        ${fixedEntries.length>0?`${fixedLoad.toFixed(0)} kW Festlast (${fixedEntries.length} Assets ohne Gebäude) werden vorab abgezogen.`:'Alle Consumer sind einem Gebäude zugeordnet.'}
      </div>
    </div>
    <!-- Faktoren-Editor -->
    <div style="width:200px;padding:10px 12px;border-left:1px solid #1a1a28;flex-shrink:0;background:#141420;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:6px;">Nutzungstyp-Faktoren</div>
      ${factorInputs}
      <div style="margin-top:6px;font-size:8px;color:#444;line-height:1.4;">Höherer Faktor → höherer Anteil an der NAP-Last.</div>
    </div>
  </div>

  <!-- Tabelle -->
  <div style="flex:1;overflow-y:auto;min-height:0;">
    ${!hasRows
      ? `<div style="padding:24px;text-align:center;color:#555;font-size:11px;">Keine kalibrierbaren Assets downstream des NAP gefunden.<br>
         <span style="color:#444;font-size:9px;">Assets müssen einem Gebäude mit Grundfläche zugeordnet sein und mit dem NAP im Stromnetz verbunden sein.</span></div>`
      : `<table style="width:100%;border-collapse:collapse;">
        <thead style="position:sticky;top:0;z-index:1;background:#1a1a2e;">
          <tr style="border-bottom:1px solid #222240;">
            <th style="padding:4px 6px;text-align:left;font-size:9px;color:#555;font-weight:normal;">Asset</th>
            <th style="padding:4px 6px;text-align:left;font-size:9px;color:#555;font-weight:normal;">Gebäude</th>
            <th style="padding:4px 6px;text-align:left;font-size:9px;color:#80cbc4;font-weight:normal;">SLP-Typ</th>
            <th style="padding:4px 6px;text-align:right;font-size:9px;color:#64b5f6;font-weight:normal;">Nutzfläche</th>
            <th style="padding:4px 6px;text-align:right;font-size:9px;color:#ce93d8;font-weight:normal;">Faktor</th>
            <th style="padding:4px 6px;text-align:right;font-size:9px;color:#555;font-weight:normal;">Aktuell kW</th>
            <th style="padding:4px 6px;text-align:right;font-size:9px;color:#ef9a9a;font-weight:normal;">→ Kalibriert</th>
          </tr>
        </thead>
        <tbody id="nap-kal-tbody">${_napKalTableRows(entries, fixedEntries)}</tbody>
      </table>`}
  </div>

  <!-- Footer -->
  <div style="padding:10px 18px;border-top:1px solid #1a1a28;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:#0f1020;">
    <div style="font-size:9px;color:#555;">Kalibrierte Werte werden in Asset-Props (leistungKW) geschrieben.</div>
    <div style="display:flex;gap:8px;">
      <button onclick="document.getElementById('nap-kal-overlay')?.remove()"
        style="padding:6px 16px;border:1px solid #333;border-radius:4px;background:transparent;color:#666;cursor:pointer;font-size:11px;">Abbrechen</button>
      ${entries.length>0?`
        <button onclick="napApplyKalibrierung()"
          style="padding:6px 14px;border:1px solid #2a4a4a;border-radius:4px;background:transparent;color:#80cbc4;cursor:pointer;font-size:11px;"
          title="Schreibt nur leistungKW in die Asset-Props">
          ✓ Nur kW übernehmen</button>
        <button onclick="napApplyKalibrierungMitProfil()"
          style="padding:6px 14px;border:1px solid #26a69a;border-radius:4px;background:rgba(38,166,154,.18);color:#80cbc4;cursor:pointer;font-size:11px;font-weight:600;"
          title="Schreibt leistungKW + überträgt das normierte NAP-Stundenprofil als Zeitreihe auf jeden Verbraucher, dann direkt synthetisch vergleichen">
          ✓ kW + NAP-Profil → Vergleich starten</button>`:''}
    </div>
  </div>
</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

export function napKalUpdateFactor(nutzung, value) {
  if (!_N.kalibrierFactors) _N.kalibrierFactors = { ..._KAL_DEFAULT_FACTORS };
  const v = parseFloat(value);
  if (isNaN(v) || v <= 0) return;
  _N.kalibrierFactors[nutzung] = v;

  const kal = _napBuildKalibrierungEntries();
  if (!kal) return;
  window._napLastKal = kal;

  // Tabelle und KPI aktualisieren — ohne Dialog neu zu rendern (Fokus bleibt im Input)
  const tbody = document.getElementById('nap-kal-tbody');
  if (tbody) tbody.innerHTML = _napKalTableRows(kal.entries, kal.fixedEntries);
  const kpiEl = document.getElementById('nap-kal-kpi-sum');
  if (kpiEl) {
    const total = kal.entries.reduce((s, e) => s + e.calibKW, 0) + kal.fixedLoad;
    kpiEl.textContent  = total.toFixed(0) + ' kW';
    kpiEl.style.color  = Math.abs(total - kal.napPeak) < 2 ? '#66bb6a' : '#f9a825';
  }
}

export function napApplyKalibrierung() {
  const kal = window._napLastKal;
  if (!kal) return;
  let count = 0;
  for (const e of kal.entries) {
    if (e.calibKW > 0) {
      if (!e.asset.props) e.asset.props = {};
      e.asset.props.leistungKW = e.calibKW;
      count++;
    }
  }
  document.getElementById('nap-kal-overlay')?.remove();
  window._napLastKal = null;
  _hint(`✓ ${count} Assets kalibriert — leistungKW aus NAP-Peak (${kal.napPeak.toFixed(0)} kW) zurückgerechnet.`);
  napBuildMassnahmen();
  napRenderPanel();
}

/**
 * Kalibrierung + NAP-Profil übertragen:
 *   1. Schreibt leistungKW (wie napApplyKalibrierung)
 *   2. Normiert das gemessene NAP-Stundenprofil (÷ Peak) und skaliert es
 *      mit dem kalibrierten kW-Anteil jedes Assets:
 *        asset.profil.werte[h] = hourlyNAP[h] × (calibKW / napPeak)
 *   3. Startet direkt die synthetische Berechnung → Overlay über der Messung.
 *
 * Erwartetes Ergebnis: synthetisch ≈ gemessen, wenn Σ calibKW ≈ napPeak.
 * Abweichungen zeigen, wo BDEW-Formfaktor und reales Profil voneinander abweichen.
 */
export function napApplyKalibrierungMitProfil() {
  const kal = window._napLastKal;
  if (!kal) return;
  const hourlyAgg = _N.data?.stats?.hourlyAgg;
  if (!hourlyAgg?.length) { _hint('Keine stündlichen Messwerte vorhanden — bitte CSV laden.'); return; }

  const { napPeak, napId, entries } = kal;
  const year = _N.data.stats.year;

  let kwCount = 0, profCount = 0;
  for (const e of entries) {
    if (e.calibKW <= 0) continue;

    // leistungKW schreiben
    if (!e.asset.props) e.asset.props = {};
    e.asset.props.leistungKW = e.calibKW;
    kwCount++;

    // Normiertes NAP-Stundenprofil auf dieses Asset skalieren:
    // werte[h] = napHourlyKW[h] × (calibKW / napPeak)
    // → profilAt() liest die Werte direkt als kW (custom-mode)
    const scale = e.calibKW / napPeak;
    e.asset.profil = {
      werte:       hourlyAgg.map(h => +(h.kw * scale).toFixed(3)),
      startTs:     new Date(year, 0, 1).toISOString(),
      intervalMin: 60,
      invertSign:  false,
      typ:         'bezug',
      source:      'nap-derived',  // Markierung: aus NAP zurückgerechnet
      napYear:     year,
    };
    profCount++;
  }

  document.getElementById('nap-kal-overlay')?.remove();
  window._napLastKal = null;

  _hint(`✓ ${kwCount} kW-Werte + ${profCount} NAP-Profile übertragen — starte synthetischen Vergleich …`);

  // NAP für synthetische Berechnung setzen (auto-detected napId aus Kalibrierung)
  if (napId) _N.selectedNapId = napId;

  // BFS-Synthese erzwingen (Modus B), auch wenn CSV geladen ist.
  // Bestandsassets sind nicht in _N.massnahmen → normaler napComputeSyntheticAndShow
  // würde Modus A nehmen und lautlos null zurückgeben.
  napBuildMassnahmen();
  const result = napComputeSynthetic(napId, true /* forceBFS */);
  if (result) {
    _N.synthData     = result;
    _N.topSeriesMode = 'synthetisch';
  }
  napRenderPanel();
}

// ── Window-Exports (für data-click / oninput) ────────────────────────────────
window.napSetChartMode          = napSetChartMode;
window.napSetTopSeriesMode      = napSetTopSeriesMode;
window.napSetGzf                = napSetGzf;
window.napSetSelectedNap        = napSetSelectedNap;
window.napSetCapacity           = napSetCapacity;
window.napRemoveMeasuredData    = napRemoveMeasuredData;
window.napToggleMassnahme       = napToggleMassnahme;
window.napToggleAllMassnahmen   = napToggleAllMassnahmen;
window.napDropFile                  = napDropFile;
window.napLoadFile                  = napLoadFile;
window.napLoadFromStromGrundlagen   = napLoadFromStromGrundlagen;
window.napComputeSyntheticAndShow = napComputeSyntheticAndShow;
window.napExportPDF             = napExportPDF;
window.napRenderPanel           = napRenderPanel;
window.napShowKalibrierungDialog    = napShowKalibrierungDialog;
window.napApplyKalibrierung         = napApplyKalibrierung;
window.napApplyKalibrierungMitProfil = napApplyKalibrierungMitProfil;
window.napKalUpdateFactor           = napKalUpdateFactor;
