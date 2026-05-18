import { map } from './02b-gebaeude.js';
import { clearFliessgewaesser, clearLwWp, redrawFliessgewaesser, redrawLwWp, updateFliessgewaesserVisibility, updateLwWpDisplay, updateLwWpVisibility, updateViz } from './02c-karte-werkzeuge.js';
import { calcVerdraengungEmF, clearBhkw, clearFernwaerme, clearGasKessel, clearHeizoelKessel, clearHhs, clearPellets, clearStromkessel, redrawErzeugerIcons, redrawFernwaerme, redrawHhs, redrawPellets, updateBhkwDisplay, updateFernwaermeDisplay, updateGasKesselDisplay, updateHeizoelDisplay, updateHhsDisplay, updatePelletsDisplay, updateStromkesselDisplay } from './03a-erzeuger.js';
import { calcGeoThermie, clearGeo, recalcNetz, redrawGeo, syncVLTemps } from './03b-netz.js';
import { escHtml, renderList, updateTotals } from './03c-gebaeude-io.js';
import { currentViewMode, setViewMode } from './04a-ui-panels.js';
import { _attachSTLayer, clearSolarthermie, clearThermSpeicher, updateSolarthermieDisplay, updateThermSpeicherDisplay } from './06b-gl-berechnen.js';
import { isErzeugerAktiv, updateAllDeckungen } from './06c-dispatch-core.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { KOSTENKOMP_DEFAULTS } from './config/kostenkomponenten-cfg.js';

export let gebaeude = [];
export const _expandedIds = new Set(); // tracks which building cards are expanded
export let _vizTimer = null;
export function updateVizDebounced() { clearTimeout(_vizTimer); _vizTimer = setTimeout(updateViz, 80); }
export let currentMode = 'waerme';
export let currentViz  = 'circle';
export let drawingId   = null;
export let drawPoints  = [];
export let drawPolyline= null;
export let drawStartMarker = null;
export let selectedId  = null;
export let idCounter   = 1;

export const R_MIN = 4, R_MAX = 54;

export let globalYear  = 2026;
export let networkLocked = true; 

export let areaDrawing  = false;
export let areaPoints   = [];
export let areaPolyline = null;
export let areaPolygon  = null;
export let areaLatLngs  = null;
export let areaStartMarker = null;
export let areaEditMarkers = [];

export let netzEdges = [];
export let calculatedLoad = {};
export let edgeWaypoints = {};
export function edgeKey(u, v) { return `${Math.min(u,v)}_${Math.max(u,v)}`; }
export let isDrawingEdge = false;
export let edgeStartId = null;
export let selectedStrandId = null;
export let netzPruningMode = false;

// ── Stromnetz state ──────────────────────────────────────────────────────
export let stromEdges = [];
export let stromNodes = [];
export let stromNextId = 20000; // IDs: NAP=20000+, Trafo=21000+, NSHV=22000+, Gebäude nutzen gebId
export let isPlacingStromNode = null; // null | 'nap' | 'trafo' | 'nshv'
export let isDrawingStromEdge = false;
export let stromEdgeStartId = null;
export let stromNetzVisible = true;
export let stromColorMode = 'auslastung'; // auslastung | spannungsfall | leistung | richtung
export let stromNetzSubTab = 'waerme'; // 'waerme' | 'strom'

// Kabeltypen (VDE 0298-4, Verlegeart D — Erdverlegung, 4-adrig)
// KABEL_TYPEN, TRAFO_GROESSEN → config/netz-kosten.js (wird vorher geladen)

export let isDrawingTrasse = false;
export let trassePoints = [];
export let trassePolyline = null;
export let trasseEditMarkers = [];
// Mehrstrang-Trasse: Array von Segmenten [{points: [idx1, idx2, ...]}]
// Jedes Segment verbindet aufeinanderfolgende trassePoints-Indizes
export let trasseSegments = []; // [{start, end}] — Bereiche in trassePoints
export let trasseCurrentSegStart = 0; // Index in trassePoints wo aktuelles Segment beginnt
export let trasseDetached = false; // true = Strang losgelöst, warte auf Wiedereinstieg

export let fliessgewaesser = null;
export let fliessgewaesserLayerGroup = null;
export let fliessgewaesserVisible = true;
export let isDrawingRiver = false;
export let riverPoints = [];
export let riverDrawPolyline = null;
export let riverEditMarkers = [];

export let lwWp = null;
export let lwWpLayerGroup = null;
export let lwWpSchallLayerGroup = null;
export let lwWpVisible = true;
export let lwWpSchallVisible = true;
export let isPlacingLwWp = false;
export let netzVisible = true;
export let gebVisible = true;
export let labelsVisible = false;
export let _batchImporting = false; // unterdrückt teure Recalcs während OSM-Massenimport
export let geoThermie = null;
export let geoLayerGroup = null;
export let isPlacingGeo = false;
export let stromEmF = 363;   // g CO₂eq/kWh Strom aktuell (UBA 2024)
export let stromEmFLZ = 72;  // g CO₂eq/kWh Strom Ø 2030–2050 (iinas 2025, NECP-Szenario)

// Live-Reader für EmFs: liest immer den aktuellen DOM-Wert. Fallback: Module-Variable.
// Wichtig, weil DOM-Änderungen (data-change in HTML) nur window-Globals mutieren,
// aber nicht die Modul-let-Bindings — Importer würden sonst veralteten Wert sehen.
export function getStromEmF() {
  const el = document.getElementById('strom-emf');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) && v >= 0 ? v : stromEmF;
}
export function getGasEmF() {
  const el = document.getElementById('gas-emf');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) && v >= 0 ? v : gasEmF;
}
export function getHeizoelEmF() {
  const el = document.getElementById('heizoel-emf');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) && v >= 0 ? v : heizoelEmF;
}
export function getPelletsEmF() {
  const el = document.getElementById('pellets-emf');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) && v >= 0 ? v : pelletsEmF;
}
export function getHhsEmF() {
  const el = document.getElementById('hhs-emf');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) && v >= 0 ? v : hhsEmF;
}
export function getFernwaermeEmF() {
  const el = document.getElementById('fernwaerme-emf');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) && v >= 0 ? v : fernwaermeEmF;
}
export let bhkwCo2Gutschrift = true;   // Toggle: BHKW-Strom verdrängt Netzstrom
export let pvCo2Gutschrift = true;     // Toggle: PV-Einspeisung verdrängt Netzstrom
export const GEG_VERDRAENGUNG_RATIO = 860 / 560; // GEG Anlage 9: Verdrängungsstrommix/Netzbezug
export let gasKessel    = null;
export let stromkessel  = null;
export let solarthermieAktiv = false;  // Solarthermie-Kollektoren
export let thermSpeicherAktiv = false; // Thermischer Wärmespeicher
export let freiflaechen = [];
export let ffCounter    = 1;
export let ffDrawId     = null;
export let ffDrawPoints = [];
export let ffDrawPolyline   = null;
export let ffDrawStartMarker = null;
// Mirror auf window — andere Module (03a, 02c) lesen/schreiben Skalar-Reassigns über window.X,
// weil ES-Module Reassign auf importierten let-Bindings nicht erlauben (Live-Binding-Bug im Dev-Modus).
// Build-Modus (Concat) ist davon nicht betroffen, aber Vite-Dev-Server schon.
window.ffCounter = ffCounter;
window.ffDrawId = ffDrawId;
window.ffDrawPoints = ffDrawPoints;
window.ffDrawPolyline = ffDrawPolyline;
window.ffDrawStartMarker = ffDrawStartMarker;
window.freiflaechen = freiflaechen;
export let bhkw      = null;
export let erzeugerIconLayerGroup = null;
export let gasEmF = 240; // g CO₂eq/kWh Erdgas (GEG Anlage 9, inkl. Vorkette)
export let heizoelKessel = null;
export let heizoelEmF = 310; // g CO₂eq/kWh Heizöl EL (GEG Anlage 9)
export let pelletsKessel = null;
export let pelletsLayerGroup = null;
export let pelletsEmF = 20; // g CO₂eq/kWh Holzpellets (GEG Anlage 9, biogen)
export let fernwaermeEmF = 180; // g CO₂eq/kWh Fernwärme (GEG Anlage 9, Gas-KWK ≥70%, Standardwert)
export let isPlacingPellets = false;
export let heizhackschnitzel = null;
export let hhsLayerGroup = null;
export let hhsEmF = 20; // g CO₂eq/kWh Holzhackschnitzel (GEG Anlage 9, biogen)
export let isPlacingHhs = false;
// Primärenergiefaktoren fp (nicht-erneuerbar) – GEG Anlage 4 (2024)
export let pefStrom = 1.8;       // Strom Netz-Mix
export let pefWP = 1.2;          // Strom für Wärmepumpen ≥ 500 kW el. (GEG Anlage 4)
export let pefGas = 1.1;         // Erdgas
export let pefHeizoel = 1.1;     // Heizöl EL
export let pefPellets = 0.2;     // Holzpellets
export let pefHhs = 0.2;         // Holzhackschnitzel
export let pefFernwaerme = 0.3;  // Fernwärme (Mindestwert GEG)
export const PEF_KAPPUNG = 0.3;  // Kappungsgrenze GEG Anlage 4 – fP = Math.max(berechnet, PEF_KAPPUNG)
export let fernwaerme = null;
export let fernwaermeLayerGroup = null;
export let isPlacingFernwaerme = false;
export let verbindungsLayerGroup = null;

// ── Vergleich ────────────────────────────────────────────────────────────────
export let variantResults = {};
export function toggleVergleich() {
  setViewMode(currentViewMode === 'vergleich' ? 'karte' : 'vergleich');
}

export let _cacheVariantTimer = null;
export function cacheVariantResultsDebounced() {
  clearTimeout(_cacheVariantTimer);
  _cacheVariantTimer = setTimeout(cacheVariantResults, 80);
}

export function cacheVariantResults() {
  const key = activeVariantId || 'base';
  const connectedIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const netzVerbrauch = gebaeude.filter(g => connectedIds.has(g.id) && !isExcluded(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  // Fallback: wenn kein Netz gezeichnet, alle Gebäude zählen (wie im Dispatch)
  const alleVerbrauch = gebaeude.filter(g => !isExcluded(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const totalVerbrauch = netzVerbrauch > 0 ? netzVerbrauch : alleVerbrauch;
  const totalLoss = netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0) * 8.76;
  const totalErzeugung = totalVerbrauch + totalLoss;
  const vlTemp = parseFloat(document.getElementById('netz-vl').value) || 90;
  const rlTemp = parseFloat(document.getElementById('netz-rl').value) || 60;
  const erzeugerList = [];
  const co2Val = (waermeMwh, jaz) => waermeMwh > 0 ? (waermeMwh / jaz * stromEmF   / 1000).toFixed(1) + ' t/a' : '—';
  const co2LZVal = (waermeMwh, jaz) => waermeMwh > 0 ? (waermeMwh / jaz * stromEmFLZ / 1000).toFixed(1) + ' t/a' : '—';
  if (lwWp) { const w = parseFloat(document.getElementById('lwwp-waerme')?.value)||0; const j = parseFloat(document.getElementById('lwwp-jaz')?.value)||3;
    erzeugerList.push({ typ: 'LWWP', leistungKw: lwWp.leistungKw, wgk: '—', invest: 0, co2: co2Val(w,j), co2lz: co2LZVal(w,j) }); }
  if (geoThermie) { const w = parseFloat(document.getElementById('geo-waerme')?.value)||0; const j = parseFloat(document.getElementById('geo-jaz')?.value)||4.5;
    erzeugerList.push({ typ: 'Geothermie', leistungKw: parseFloat(document.getElementById('geo-heizlast')?.value)||0, wgk: '—', invest: 0, co2: co2Val(w,j), co2lz: co2LZVal(w,j) }); }
  if (fliessgewaesser) { const w = parseFloat(document.getElementById('fg-waerme')?.value)||0; const j = parseFloat(document.getElementById('fg-jaz')?.value)||4.5;
    erzeugerList.push({ typ: 'Fließgewässer-WP', leistungKw: fliessgewaesser.leistungKw, wgk: '—', invest: 0, co2: co2Val(w,j), co2lz: co2LZVal(w,j) }); }
  if (gasKessel) { const w = parseFloat(document.getElementById('gk-waerme')?.value)||0; const eta = parseFloat(document.getElementById('gk-eta')?.value)||92;
    const gkCo2 = w > 0 ? (w / (eta/100) * gasEmF / 1000).toFixed(1) + ' t/a (fossil)' : '—';
    erzeugerList.push({ typ: 'Gaskessel', leistungKw: gasKessel.leistungKw, wgk: '—', invest: 0, co2: gkCo2, co2lz: gkCo2 }); }
  else if (window._autoGkResult && window._autoGkResult.leistungKw > 0) {
    // Auto-GK (Spitzenlastkessel aus Dispatch-Residual) als Gaskessel eintragen
    const agk = window._autoGkResult;
    const eta = parseFloat(document.getElementById('gk-eta')?.value) || 92;
    const agkCo2 = agk.waermeMwh > 0 ? (agk.waermeMwh / (eta/100) * gasEmF / 1000).toFixed(1) + ' t/a (fossil)' : '—';
    erzeugerList.push({ typ: 'Gaskessel (Auto)', leistungKw: agk.leistungKw, waermeMwh: agk.waermeMwh, wgk: '—', invest: 0, co2: agkCo2, co2lz: agkCo2 });
  }
  if (bhkw) { const w = parseFloat(document.getElementById('bhkw-waerme')?.value)||0; const sigma = parseFloat(document.getElementById('bhkw-skz')?.value)||0.45; const etaGes = parseFloat(document.getElementById('bhkw-eta')?.value)||88; const etaTh = (1+sigma) > 0 ? (etaGes/100)/(1+sigma) : 0.4;
    const elMwhBhkw = w * sigma;
    const vEmF = calcVerdraengungEmF();
    const bhkwCo2fossil = w > 0 ? w / etaTh * gasEmF / 1000 : 0;
    const bhkwGutschrift = bhkwCo2Gutschrift && elMwhBhkw > 0 ? elMwhBhkw * vEmF / 1000 : 0;
    const bhkwCo2netto = bhkwCo2fossil - bhkwGutschrift;
    const bhkwCo2Str = w > 0 ? bhkwCo2netto.toFixed(1) + ' t/a' + (bhkwGutschrift > 0 ? ' (netto)' : ' (fossil)') : '—';
    erzeugerList.push({ typ: 'BHKW/KWK', leistungKw: bhkw.leistungThKw, wgk: '—', invest: 0, co2: bhkwCo2Str, co2lz: bhkwCo2Str, co2n: bhkwCo2netto, co2lzn: bhkwCo2netto }); }
  if (stromkessel) { const w = parseFloat(document.getElementById('sk-waerme')?.value)||0; const eta = (parseFloat(document.getElementById('sk-eta')?.value)||99)/100;
    const stromMwh = w > 0 ? w / eta : 0;
    const skCo2n  = stromMwh > 0 ? stromMwh * stromEmF   / 1000 : 0;
    const skCo2lzn = stromMwh > 0 ? stromMwh * stromEmFLZ / 1000 : 0;
    const skCo2  = skCo2n  > 0 ? skCo2n.toFixed(1)  + ' t/a' : '—';
    const skCo2lz = skCo2lzn > 0 ? skCo2lzn.toFixed(1) + ' t/a' : '—';
    erzeugerList.push({ typ: 'Stromkessel', leistungKw: stromkessel.leistungKw, wgk: '—', invest: 0, co2: skCo2, co2lz: skCo2lz, co2n: skCo2n, co2lzn: skCo2lzn }); }

  // Numerische CO₂-Werte aus erzeugerList extrahieren (für Summierung)
  // Felder co2n / co2lzn bereits bei Stromkessel, bei anderen rückwärts parsen
  const _parseTon = s => { if (!s || s === '—') return 0; const m = s.match(/^([\d.]+)/); return m ? parseFloat(m[1]) : 0; };
  const co2GesH  = erzeugerList.reduce((s, e) => s + (e.co2n  !== undefined ? e.co2n  : _parseTon(e.co2)),  0);
  const co2GesLZ = erzeugerList.reduce((s, e) => s + (e.co2lzn !== undefined ? e.co2lzn : _parseTon(e.co2lz)), 0);
  // Investition aus Wirtschaftlichkeits-Panel (globale Variable, gesetzt von calcWirtschaftPanel)
  const investGes = window._lastInvestGes || erzeugerList.reduce((s, e) => s + (e.invest || 0), 0);
  const jkGes = window._lastJkGes || 0;
  // WGK gesamt aus Wirtschafts-Panel (wenn vorhanden)
  const wgkGes = parseFloat(document.querySelector('#wirt-table-wrap .token')?.textContent) || null; // fallback — try via systemState
  const wgkText = window._lastWgk ? window._lastWgk.toFixed(1) + ' ct/kWh' : (wgkGes ? wgkGes.toFixed(1) + ' ct/kWh' : '—');

  const ausschlüsse = activeVariantId ? (varianten.find(v => v.id === activeVariantId)?.gebaeudeAusschlüsse?.length || 0) : 0;
  // WGK as number for comparison
  const wgkNum = window._lastWgk || wgkGes || null;
  // EE-Anteil direkt aus Dispatch-Daten berechnen
  const EE_KEYS_V = ['lwwp','fg','geo','pellets','hhs'];
  const dispEn = window._dispatchEnergy || {};
  let eeW = 0, gesW = 0;
  for (const k of Object.keys(dispEn)) { const w = dispEn[k]?.waermeMwh || 0; gesW += w; if (EE_KEYS_V.includes(k) || k === '_thermSpeicher') eeW += w; }
  const eeAnteil = gesW > 0 ? (eeW / gesW * 100) : null;
  // WP-Stromkosten (sum of all WP electricity * Strompreis)
  let stromkostenWp = null;
  const WP_KEYS_V = ['lwwp','fg','geo'];
  if (window._wpElHourly) {
    const wpElMWh = Array.from(window._wpElHourly).reduce((s, v) => s + v, 0) / 1000;
    const strompreis = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
    stromkostenWp = wpElMWh * strompreis * 10; // MWh * ct/kWh * 10 = €
  } else {
    // JDL-Modus: WP-Strom aus Dispatch-Energiedaten
    let wpElMwh = 0;
    WP_KEYS_V.forEach(k => { if (dispEn[k]?.elMwh) wpElMwh += dispEn[k].elMwh; });
    if (wpElMwh > 0) {
      const strompreis = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
      stromkostenWp = wpElMwh * strompreis * 10;
    }
  }
  // Phase 6: Aufteilung Kapital/Energie/CO₂/PV für Stacked-Bar im Vergleich-Tab
  const _ws = window._wirtschaftSummary?.totals || {};
  variantResults[key] = {
    label: activeVariantId ? (varianten.find(v => v.id === activeVariantId)?.name || '') : 'Basisdaten',
    gebäudebedarf: totalVerbrauch, netzverluste: totalLoss,
    netzverlustePct: totalErzeugung > 0 ? totalLoss / totalErzeugung * 100 : 0,
    erzeugung: totalErzeugung, vlTemp, rlTemp, erzeuger: erzeugerList, ausschlüsse,
    investGes, jkGes, co2GesH, co2GesLZ, wgkText, wgkNum, eeAnteil, stromkostenWp,
    kapitalJk: _ws.kapitalJk || 0,
    betriebJk: _ws.betriebJk || 0,
    energieJk: _ws.energieJk || 0,
    co2Jk:     _ws.co2Jk     || 0,
    pvJk:      _ws.pvJk      || 0,
  };
  if (typeof currentViewMode !== 'undefined' && currentViewMode === 'vergleich') renderVergleich();
}

export function refreshVergleich() {
  const originalId = activeVariantId;
  // Basis-Snapshot vor dem Durchlaufen retten, damit er nicht korrumpiert wird
  const savedBase = baseNetzSnapshot ? JSON.parse(JSON.stringify(baseNetzSnapshot)) : null;
  const savedBaseErz = baseErzeugerSnapshot ? JSON.parse(JSON.stringify(baseErzeugerSnapshot)) : null;
  const savedBaseKp = baseKostenSnapshot ? JSON.parse(JSON.stringify(baseKostenSnapshot)) : null;
  const savedBaseHidden = baseHiddenAutoSnapshot ? [...baseHiddenAutoSnapshot] : null;
  const savedBaseInvOv = baseInvOverridesSnapshot ? JSON.parse(JSON.stringify(baseInvOverridesSnapshot)) : null;
  const savedBaseVdiOv = baseVdiOverridesSnapshot ? JSON.parse(JSON.stringify(baseVdiOverridesSnapshot)) : null;
  ['base', ...varianten.map(v => v.id)].forEach(id => {
    activateVariant(id === 'base' ? null : id);
    cacheVariantResults();
  });
  // Basis-Snapshot wiederherstellen
  if (savedBase) baseNetzSnapshot = savedBase;
  if (savedBaseErz) baseErzeugerSnapshot = savedBaseErz;
  if (savedBaseKp) baseKostenSnapshot = savedBaseKp;
  if (savedBaseHidden) baseHiddenAutoSnapshot = savedBaseHidden;
  if (savedBaseInvOv) baseInvOverridesSnapshot = savedBaseInvOv;
  if (savedBaseVdiOv) baseVdiOverridesSnapshot = savedBaseVdiOv;
  activateVariant(originalId);
  renderVergleich();
}

export function renderVergleich() {
  const wrap = document.getElementById('vergleich-table-wrap');
  if (!wrap) return;
  const cols = ['base', ...varianten.map(v => v.id)];
  if (!variantResults['base']) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:20px 0;">Noch keine Daten. Bitte zuerst „Grundlage berechnen" ausführen, dann „↻ Alle aktualisieren" klicken.</div>';
    return;
  }
  const fmt = (v, unit='', digits=0) => (v != null && !isNaN(v) && v !== '') ? Number(v).toLocaleString('de-DE', {maximumFractionDigits:digits}) + (unit ? '\u00a0' + unit : '') : '—';
  const numVal = (r, fn) => { try { const s = fn(r); const n = parseFloat(String(s).replace(/[^\d,.-]/g,'').replace(',','.')); return isNaN(n) ? null : n; } catch(e) { return null; } };
  const rows = [
    { label: 'NETZ', header: true },
    { label: 'VL / RL', fn: r => r ? `${r.vlTemp}°C / ${r.rlTemp}°C` : '—' },
    { label: 'Gebäudebedarf', fn: r => r ? fmt(r.gebäudebedarf, 'MWh/a') : '—' },
    { label: 'Netzverluste', fn: r => r ? `${fmt(r.netzverluste, 'MWh/a')} (${fmt(r.netzverlustePct, '%', 1)})` : '—', numFn: r => r?.netzverlustePct, best: 'min' },
    { label: 'Zentrale erzeugt', fn: r => r ? fmt(r.erzeugung, 'MWh/a') : '—', bold: true },
    { label: 'Abgekoppelte Gebäude', fn: r => r ? (r.ausschlüsse > 0 ? r.ausschlüsse + ' Geb.' : '—') : '—' },
    { label: 'ERZEUGER', header: true },
    { label: 'Typ', fn: r => r?.erzeuger?.length ? r.erzeuger.map(e => e.typ).join(', ') : '—' },
    { label: 'Leistung', fn: r => r?.erzeuger?.length ? r.erzeuger.map(e => fmt(e.leistungKw, 'kW')).join(', ') : '—' },
    { label: 'EE-Anteil', fn: r => r?.eeAnteil != null ? fmt(r.eeAnteil, '%', 1) : '—', numFn: r => r?.eeAnteil, best: 'max', bold: true },
    { label: 'WIRTSCHAFTLICHKEIT', header: true },
    { label: 'Investition gesamt', fn: r => r?.investGes > 0 ? fmt(Math.round(r.investGes/1000), 'k€') : '—', numFn: r => r?.investGes, best: 'min', bold: true },
    { label: 'Jahreskosten gesamt', fn: r => r?.jkGes > 0 ? fmt(r.jkGes/1000, 'k€/a', 1) : '—', numFn: r => r?.jkGes, best: 'min' },
    { label: 'WGK System gesamt', fn: r => r?.wgkText || '—', numFn: r => r?.wgkNum, best: 'min', bold: true },
    { label: 'Stromkosten WP', fn: r => r?.stromkostenWp != null ? fmt(r.stromkostenWp, '€/a') : '—', numFn: r => r?.stromkostenWp, best: 'min' },
    { label: 'CO₂ EMISSIONEN', header: true },
    { label: 'CO₂ je Erzeuger (heute)', fn: r => r?.erzeuger?.length ? r.erzeuger.map(e => e.co2 || '—').join(', ') : '—' },
    { label: 'CO₂ gesamt (heute)', fn: r => r?.co2GesH > 0 ? fmt(r.co2GesH, 't/a', 1) : '—', numFn: r => r?.co2GesH, best: 'min', bold: true },
    { label: 'CO₂ je Erzeuger (Ø 2030–50)', fn: r => r?.erzeuger?.length ? r.erzeuger.map(e => e.co2lz || '—').join(', ') : '—' },
    { label: 'CO₂ gesamt (Ø 2030–50)', fn: r => r?.co2GesLZ > 0 ? fmt(r.co2GesLZ, 't/a', 1) : '—', numFn: r => r?.co2GesLZ, best: 'min', bold: true },
  ];

  // Determine best values per row for highlighting
  const bestIdx = {};
  rows.forEach((row, ri) => {
    if (row.header || !row.numFn || !row.best) return;
    let bestVal = null, bestIds = [];
    cols.forEach(id => {
      const r = variantResults[id];
      const v = r ? row.numFn(r) : null;
      if (v == null || isNaN(v) || v <= 0) return;
      if (bestVal === null || (row.best === 'min' ? v < bestVal : v > bestVal)) { bestVal = v; bestIds = [id]; }
      else if (v === bestVal) bestIds.push(id);
    });
    if (bestIds.length > 0 && bestIds.length < cols.length) bestIdx[ri] = new Set(bestIds);
  });

  const isActive = id => (id === 'base' && activeVariantId === null) || id === activeVariantId;
  const thBg = id => isActive(id) ? (id === 'base' ? '#4caf50' : 'var(--accent)') : 'var(--surface2)';
  const thFg = id => isActive(id) ? '#000' : 'var(--muted)';
  const onClick = id => id === 'base' ? `data-click="activateVariant(null);renderVergleich()"` : `data-click="activateVariant('${id}');renderVergleich()"`;
  let html = `<table class="vergleich-table"><thead><tr><th style="background:var(--surface2);">Kennwert</th>`;
  cols.forEach(id => {
    const r = variantResults[id];
    const lbl = r ? escHtml(r.label) : (id === 'base' ? 'Basisdaten' : '—');
    html += `<th class="clickable" data-variant-id="${id}" ${onClick(id)} style="background:${thBg(id)};color:${thFg(id)};" title="Klicken zum Aktivieren">${lbl}</th>`;
  });
  html += `</tr></thead><tbody>`;
  rows.forEach((row, ri) => {
    if (row.header) {
      html += `<tr><td colspan="${cols.length+1}" style="background:var(--surface2);color:var(--muted);font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:5px 12px;">${row.label}</td></tr>`;
      return;
    }
    html += `<tr><td>${row.label}</td>`;
    cols.forEach(id => {
      const r = variantResults[id];
      const val = r ? row.fn(r) : '—';
      const active = isActive(id);
      const isBest = bestIdx[ri] && bestIdx[ri].has(id);
      const style = `${active?'color:var(--accent);':''}${row.bold?'font-weight:bold;':''}${isBest?'color:#66bb6a;':''}`;
      html += `<td class="val-col" style="${style}">${val}${isBest?' ✓':''}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  // ── Phase 6: Stacked-Bar „Jährliche Kostenzusammensetzung" pro Variante ──
  const stackedBar = _renderVergleichStackedBar(cols);
  const finalHtml = stackedBar + html;

  wrap.innerHTML = finalHtml;
  // Also update the new vergleich-view container
  const newWrap = document.getElementById('vergleich-view-table-wrap');
  if (newWrap) newWrap.innerHTML = finalHtml;

  // Pareto-Diagramm rendern
  requestAnimationFrame(() => _renderParetoChart());
}

// Stacked-Bar wie in der Excel-Vorlage „Variantenvergleich":
// pro Variante eine Säule, 4 Blöcke (Kapital/Energie/CO₂/PV), spez. WGK als Label.
function _renderVergleichStackedBar(cols) {
  const data = cols.map(id => ({ id, r: variantResults[id] })).filter(x => x.r);
  if (!data.length) return '';
  const hasAnyTotals = data.some(x => (x.r.kapitalJk + x.r.energieJk + x.r.co2Jk + (x.r.pvJk || 0)) > 0);
  if (!hasAnyTotals) return '';

  const maxTotal = Math.max(...data.map(x => x.r.jkGes || 0)) * 1.15 || 1;
  const W = 70; // Säulenbreite (px)
  const GAP = 22;
  const PAD_L = 70, PAD_R = 12, PAD_T = 28, PAD_B = 64;
  const plotH = 280;
  const fullW = PAD_L + PAD_R + data.length * W + (data.length - 1) * GAP;

  const fmtK = v => v >= 1e6 ? (v/1e6).toLocaleString('de-DE',{maximumFractionDigits:2}) + ' M€' : Math.round(v/1000).toLocaleString('de-DE') + ' k€';
  const COL = { kapital: '#4dd0e1', betrieb: '#ab47bc', energie: '#f9a825', co2: '#e53935', pv: '#66bb6a' };

  let bars = '';
  data.forEach((x, i) => {
    const r = x.r;
    const x0 = PAD_L + i * (W + GAP);
    const blocks = [
      { key: 'Kapital',  val: r.kapitalJk || 0, color: COL.kapital },
      { key: 'Betrieb',  val: r.betriebJk || 0, color: COL.betrieb },
      { key: 'Energie',  val: r.energieJk || 0, color: COL.energie },
      { key: 'CO₂',      val: r.co2Jk     || 0, color: COL.co2 },
    ];
    if (r.pvJk) blocks.push({ key: 'PV/Batt', val: r.pvJk, color: COL.pv });
    let yTop = PAD_T + plotH;
    let total = 0;
    let segs = '';
    for (const b of blocks) {
      if (b.val <= 0) continue;
      const h = (b.val / maxTotal) * plotH;
      yTop -= h;
      segs += `<rect x="${x0}" y="${yTop.toFixed(1)}" width="${W}" height="${h.toFixed(1)}" fill="${b.color}"><title>${b.key}: ${fmtK(b.val)}</title></rect>`;
      total += b.val;
    }
    const wgkLbl = r.wgkText || (r.wgkNum != null ? r.wgkNum.toFixed(1) + ' ct/kWh' : '');
    const totalLbl = fmtK(total) + '/a';
    const x_mid = x0 + W/2;
    const y_top = yTop - 6;
    const isAct = (x.id === 'base' && activeVariantId === null) || x.id === activeVariantId;
    bars += segs;
    bars += `<text x="${x_mid}" y="${y_top}" text-anchor="middle" font-family="DM Mono, monospace" font-size="10" fill="${isAct ? 'var(--accent)' : 'var(--text)'}" font-weight="500">${wgkLbl}</text>`;
    bars += `<text x="${x_mid}" y="${(y_top - 12).toFixed(1)}" text-anchor="middle" font-family="DM Mono, monospace" font-size="9" fill="var(--muted)">${totalLbl}</text>`;
    // X-Label (Variantenname, isolated)
    const lbl = (r.label || x.id).slice(0, 18);
    bars += `<text x="${x_mid}" y="${PAD_T + plotH + 14}" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="10" fill="${isAct ? 'var(--accent)' : 'var(--text)'}" font-weight="${isAct?'500':'400'}">${escHtml(lbl)}</text>`;
  });

  // Y-Achse + Grid
  let axis = `<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T+plotH}" stroke="var(--border)" stroke-width="1"/>
              <line x1="${PAD_L}" y1="${PAD_T+plotH}" x2="${fullW-PAD_R}" y2="${PAD_T+plotH}" stroke="var(--border)" stroke-width="1"/>`;
  for (let g = 0; g <= 4; g++) {
    const v = maxTotal * g / 4;
    const y = PAD_T + plotH * (1 - g/4);
    axis += `<line x1="${PAD_L}" y1="${y}" x2="${fullW-PAD_R}" y2="${y}" stroke="var(--border)" stroke-width="0.5" opacity="0.4"/>`;
    axis += `<text x="${PAD_L-6}" y="${y+3}" text-anchor="end" font-family="DM Mono, monospace" font-size="9" fill="var(--muted)">${fmtK(v).replace('/a','')}</text>`;
  }

  // Legende
  const legendItems = [
    { key: 'Kapital',  color: COL.kapital },
    { key: 'Betrieb',  color: COL.betrieb },
    { key: 'Energie',  color: COL.energie },
    { key: 'CO₂',      color: COL.co2 },
    { key: 'PV/Batt.', color: COL.pv },
  ];
  const legendHtml = legendItems.map(it =>
    `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);"><span style="width:10px;height:10px;background:${it.color};border-radius:2px;"></span>${it.key}</span>`
  ).join('<span style="margin:0 6px;">·</span>');

  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:14px;overflow-x:auto;">
      <div style="font-size:10px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
        Jährliche Kostenzusammensetzung pro Variante
        <span style="float:right;color:var(--accent);text-transform:none;letter-spacing:0;font-style:italic;">Label oben: spez. WGK · darunter: Gesamtkosten/a</span>
      </div>
      <svg width="${fullW}" height="${PAD_T + plotH + PAD_B}" style="display:block;min-width:${fullW}px;">${axis}${bars}</svg>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;padding-left:${PAD_L}px;">
        ${legendHtml}
      </div>
    </div>
  `;
}

export function _renderParetoChart() {
  const canvas = document.getElementById('vergleich-pareto-canvas');
  const legendEl = document.getElementById('vergleich-pareto-legend');
  if (!canvas) return;

  // Daten sammeln: nur Varianten mit WGK + CO2
  const cols = ['base', ...varianten.map(v => v.id)];
  const points = [];
  cols.forEach(id => {
    const r = variantResults[id];
    if (!r || !r.wgkNum || r.wgkNum <= 0) return;
    const co2 = r.co2GesLZ > 0 ? r.co2GesLZ : r.co2GesH; // Bevorzugt LZ-Werte
    if (!co2 || co2 <= 0) return;
    const isActive = (id === 'base' && activeVariantId === null) || id === activeVariantId;
    points.push({ id, label: r.label, wgk: r.wgkNum, co2, invest: r.investGes || 0, isActive });
  });

  if (points.length < 1) {
    canvas.style.display = 'none';
    if (legendEl) legendEl.innerHTML = '<span style="color:var(--muted);">Mindestens 2 Varianten mit WGK + CO₂ nötig.</span>';
    return;
  }
  canvas.style.display = '';

  const _doDraw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth || canvas.parentElement?.clientWidth || 500;
    const H   = 240;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD = { l: 48, r: 30, t: 20, b: 36 };
    const iW  = W - PAD.l - PAD.r;
    const iH  = H - PAD.t - PAD.b;

    // Achsen-Bereich
    const wgkVals = points.map(p => p.wgk);
    const co2Vals = points.map(p => p.co2);
    const invVals = points.map(p => p.invest);
    const wgkMin = Math.min(...wgkVals) * 0.85, wgkMax = Math.max(...wgkVals) * 1.15;
    const co2Min = Math.min(...co2Vals) * 0.8,  co2Max = Math.max(...co2Vals) * 1.2;
    const invMin = Math.min(...invVals),         invMax = Math.max(...invVals) || 1;

    const xOf = wgk => PAD.l + (wgk - wgkMin) / (wgkMax - wgkMin) * iW;
    const yOf = co2 => PAD.t + iH - (co2 - co2Min) / (co2Max - co2Min) * iH;
    const rOf = inv => 6 + (invMax > invMin ? (inv - invMin) / (invMax - invMin) * 18 : 6);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.t + iH * i / 4;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + iW, y); ctx.stroke();
      const x = PAD.l + iW * i / 4;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + iH); ctx.stroke();
    }

    // Achsenbeschriftung Y (CO2)
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.font = '8px "DM Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = co2Min + (co2Max - co2Min) * (1 - i / 4);
      ctx.fillText(v.toFixed(1), PAD.l - 4, PAD.t + iH * i / 4 + 3);
    }
    ctx.save();
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.font = '8px sans-serif';
    ctx.translate(10, PAD.t + iH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('CO₂ [t/a]', 0, 0);
    ctx.restore();

    // Achsenbeschriftung X (WGK)
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.font = '8px "DM Mono", monospace';
    for (let i = 0; i <= 4; i++) {
      const v = wgkMin + (wgkMax - wgkMin) * i / 4;
      ctx.fillText(v.toFixed(1), PAD.l + iW * i / 4, H - PAD.b + 14);
    }
    ctx.font = '8px sans-serif';
    ctx.fillText('WGK [ct/kWh]', PAD.l + iW / 2, H - 4);

    // Pareto-Front berechnen (untere-linke Ecke = ideal → min WGK UND min CO2)
    const sorted = [...points].sort((a, b) => a.wgk - b.wgk);
    const front = [];
    let minCo2 = Infinity;
    sorted.forEach(p => {
      if (p.co2 <= minCo2) { front.push(p); minCo2 = p.co2; }
    });

    // Pareto-Front zeichnen
    if (front.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(102,187,106,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      front.forEach((p, i) => {
        const x = xOf(p.wgk), y = yOf(p.co2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Schattierter Bereich unter der Front
      ctx.beginPath();
      ctx.moveTo(xOf(front[0].wgk), yOf(front[0].co2));
      front.forEach(p => ctx.lineTo(xOf(p.wgk), yOf(p.co2)));
      ctx.lineTo(xOf(front[front.length - 1].wgk), PAD.t + iH);
      ctx.lineTo(PAD.l, PAD.t + iH);
      ctx.lineTo(PAD.l, yOf(front[0].co2));
      ctx.closePath();
      ctx.fillStyle = 'rgba(102,187,106,0.06)';
      ctx.fill();
    }

    // Varianten-Farben
    const VCOLORS = ['#4fc3f7','#ffd54f','#ff8a65','#ce93d8','#a5d6a7','#90a4ae','#f48fb1','#80cbc4'];

    // Punkte zeichnen
    points.forEach((p, i) => {
      const x = xOf(p.wgk);
      const y = yOf(p.co2);
      const r = rOf(p.invest);
      const color = p.id === 'base' ? '#4caf50' : VCOLORS[i % VCOLORS.length];

      // Kreis
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color + '44';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = p.isActive ? 2.5 : 1.5;
      ctx.stroke();

      // Aktive Variante: Highlight-Ring
      if (p.isActive) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color + '66';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = color;
      ctx.font = p.isActive ? 'bold 9px sans-serif' : '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      const labelX = x + r + 3;
      const labelY = y - 3;
      ctx.fillText(p.label, labelX, labelY);
    });

    // "Ideal"-Pfeil unten links
    ctx.fillStyle = 'rgba(102,187,106,0.4)';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('← ideal', PAD.l + 2, PAD.t + iH - 4);

    // Legende
    if (legendEl) {
      legendEl.innerHTML = points.map((p, i) => {
        const color = p.id === 'base' ? '#4caf50' : VCOLORS[i % VCOLORS.length];
        const invK = p.invest > 0 ? ' · ' + Math.round(p.invest / 1000) + ' k€ Invest' : '';
        return `<span style="display:inline-flex;align-items:center;gap:3px;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color}44;border:1.5px solid ${color};"></span>` +
          `<span style="color:var(--text);">${escHtml(p.label)}</span>` +
          `<span style="color:var(--muted);">${p.wgk.toFixed(1)} ct · ${p.co2.toFixed(1)} t${invK}</span></span>`;
      }).join('') +
        (front.length >= 2 ? `<span style="color:rgba(102,187,106,0.6);margin-left:6px;">- - - Pareto-Front</span>` : '');
    }
  };

  if (canvas.clientWidth > 10) _doDraw();
  else requestAnimationFrame(_doDraw);
}

// ── Zentrale ETA-Tabelle (liest Pellets/HHS aus DOM) ─────────────────────────
export function _getEtaMap() {
  return {
    gaskessel: (parseFloat(document.getElementById('gk-eta')?.value) || 92) / 100,
    heizoel: (parseFloat(document.getElementById('hko-eta')?.value) || 90) / 100,
    pellets: (parseFloat(document.getElementById('pk-eta')?.value) || 88) / 100,
    hhs: (parseFloat(document.getElementById('hhs-eta')?.value) || 85) / 100,
    _autoGk: 0.92, fernwaerme: 1.0
  };
}

// ── Varianten ────────────────────────────────────────────────────────────────
export let varianten = [];
export let activeVariantId = null;
export let baseNetzSnapshot = null;
export let baseErzeugerSnapshot = null;
export let baseKostenSnapshot = null;
export let baseHiddenAutoSnapshot = null;
export let baseInvOverridesSnapshot = null;
export let baseVdiOverridesSnapshot = null;

// ── Kostenpunkte (Investitionspositionen pro Variante, VDI 2067) ──
// Schema KostenPunkt = {
//   id:        string,   // unique innerhalb der Variante
//   typeKey:   string,   // ref auf KOSTENKOMP_DEFAULTS, z.B. 'wp_solewasser'
//   name?:     string,   // Override für Anzeigename
//   invest:    number,   // €
//   ndOverride?:   number,  // a   (Nutzungsdauer)
//   instOverride?: number,  // %   (Instandhaltung)
//   wartOverride?: number,  // %   (Wartung)
//   bedOverride?:  number,  // h/a (Bedienstunden)
//   note?:     string,   // freie Notiz / Quelle
// }
export let kostenpunkte = [];
export let hiddenAutoIds = [];   // ids von Auto-Bausteinen, die der User für die aktive Variante ausgeblendet hat
let _kpIdCounter = 1;
export function _newKpId() { return 'kp_' + Date.now().toString(36) + '_' + (_kpIdCounter++); }

// Capture/Apply für User-Kostenpunkte
export function captureKostenState() {
  return JSON.parse(JSON.stringify(kostenpunkte || []));
}
export function applyKostenState(state) {
  kostenpunkte = Array.isArray(state) ? JSON.parse(JSON.stringify(state)) : [];
}
// Capture/Apply für hidden Auto-IDs
export function captureHiddenAutoState() {
  return [...(hiddenAutoIds || [])];
}
export function applyHiddenAutoState(state) {
  hiddenAutoIds = Array.isArray(state) ? [...state] : [];
}
// Capture/Apply für VDI-Overrides aus dem alten Float-Panel (jetzt pro Variante)
export function captureOverridesState() {
  return {
    inv: { ...(window._wirtBausteineOverrides || {}) },
    vdi: JSON.parse(JSON.stringify(window._wirtVdiOverrides || {})),
  };
}
export function applyOverridesState(state) {
  window._wirtBausteineOverrides = (state && state.inv) ? { ...state.inv } : {};
  window._wirtVdiOverrides       = (state && state.vdi) ? JSON.parse(JSON.stringify(state.vdi)) : {};
}
// Factory für neuen Kostenpunkt aus typeKey + Invest. Override-Felder bleiben leer
// → Defaults aus KOSTENKOMP_DEFAULTS gelten.
export function createKostenPunkt({ typeKey, invest = 0, name, note }) {
  const def = KOSTENKOMP_DEFAULTS[typeKey] || {};
  return {
    id:      _newKpId(),
    typeKey,
    name:    name ?? def.name ?? '',
    invest:  Math.round(Number(invest) || 0),
    note:    note ?? '',
  };
}

// ── Public API für UI (07c) ──
export function getActiveKostenpunkte() { return kostenpunkte; }
export function getActiveHiddenAutoIds() { return hiddenAutoIds; }
export function addKostenpunkt(kp) {
  kostenpunkte.push(kp);
}
export function removeKostenpunkt(id) {
  const idx = kostenpunkte.findIndex(k => k.id === id);
  if (idx >= 0) kostenpunkte.splice(idx, 1);
}
export function updateKostenpunkt(id, patch) {
  const kp = kostenpunkte.find(k => k.id === id);
  if (kp) Object.assign(kp, patch);
}
export function hideAutoId(id) {
  if (!hiddenAutoIds.includes(id)) hiddenAutoIds.push(id);
}
export function unhideAutoId(id) {
  const idx = hiddenAutoIds.indexOf(id);
  if (idx >= 0) hiddenAutoIds.splice(idx, 1);
}

export function captureNetzState() {
  return {
    vl: document.getElementById('netz-vl').value,
    rl: document.getElementById('netz-rl').value,
    v: document.getElementById('netz-v').value,
    tAussen: document.getElementById('netz-t-aussen').value,
    tMittel: document.getElementById('netz-t-mittel').value,
    uWert: document.getElementById('netz-u-wert').value,
    gzfMethode: document.getElementById('netz-gzf-methode')?.value || 'richtwert',
    gzfManuell: parseFloat(document.getElementById('netz-gzf-manuell')?.value) || 0.6,
  };
}

export function applyNetzState(state) {
  if (!state) return;
  document.getElementById('netz-vl').value = state.vl ?? 90;
  document.getElementById('netz-rl').value = state.rl ?? 60;
  syncVLTemps('netz');
  document.getElementById('netz-v').value = state.v ?? 1.0;
  document.getElementById('netz-t-aussen').value = state.tAussen ?? -12;
  document.getElementById('netz-t-mittel').value = state.tMittel ?? 10;
  document.getElementById('netz-u-wert').value = state.uWert ?? 0.25;
  if (state.gzfMethode) {
    document.getElementById('netz-gzf-methode').value = state.gzfMethode;
    document.getElementById('netz-gzf-manuell-wrap').style.display = state.gzfMethode === 'manuell' ? '' : 'none';
  }
  if (state.gzfManuell != null) document.getElementById('netz-gzf-manuell').value = state.gzfManuell;
  // Netz-Topologie bleibt erhalten; Parameter-Neuberechnung per setTimeout
  // damit applyErzeugerState() zuerst vollständig abläuft
  setTimeout(() => { if (typeof netzEdges !== 'undefined' && netzEdges.length > 0) recalcNetz(); }, 50);
}

export function captureErzeugerState() {
  const lwEl = document.getElementById('lwwp-jaz');
  const lwWEl = document.getElementById('lwwp-waerme');
  return {
    lwWp: lwWp ? { ...lwWp,
      jaz: lwEl ? parseFloat(lwEl.value)||3.0 : 3.0,
      waerme: lwWEl ? lwWEl.value : '',
      minCop: document.getElementById('lwwp-min-cop')?.value || '',
      manLaenge: document.getElementById('lwwp-man-laenge')?.value || '',
      manBreite: document.getElementById('lwwp-man-breite')?.value || '',
    } : null,
    geoThermie: geoThermie ? {
      ...geoThermie,
      heizlast: document.getElementById('geo-heizlast').value,
      waerme: document.getElementById('geo-waerme').value,
      jaz: parseFloat(document.getElementById('geo-jaz').value) || 4.5,
      tiefe: parseFloat(document.getElementById('geo-tiefe').value) || 100,
      qPerM: parseFloat(document.getElementById('geo-q-perm').value) || 50,
      abstand: parseFloat(document.getElementById('geo-abstand').value) || 10,
      lambda: parseFloat(document.getElementById('geo-lambda').value) || 2.0,
      guetegrad: parseFloat(document.getElementById('geo-guetegrad').value) || 0.50,
      dtAbsenkung: parseFloat(document.getElementById('geo-dt-absenkung').value) || 0,
      manLaenge: document.getElementById('geo-man-laenge').value,
      manBreite: document.getElementById('geo-man-breite').value,
    } : null,
    fliessgewaesser: fliessgewaesser ? { ...fliessgewaesser,
      waerme: document.getElementById('fg-waerme').value,
    } : null,
    gasKessel: gasKessel ? {
      leistungKw: parseFloat(document.getElementById('gk-leistung').value) || 500,
      eta: document.getElementById('gk-eta').value,
      waerme: document.getElementById('gk-waerme').value,
    } : null,
    heizoelKessel: heizoelKessel ? {
      leistungKw: parseFloat(document.getElementById('hko-leistung').value) || 500,
      eta: document.getElementById('hko-eta').value,
      waerme: document.getElementById('hko-waerme').value,
    } : null,
    pelletsKessel: pelletsKessel ? {
      leistungKw: parseFloat(document.getElementById('pk-leistung').value) || 300,
      eta: document.getElementById('pk-eta').value,
      waerme: document.getElementById('pk-waerme').value,
      lat: pelletsKessel.lat,
      lng: pelletsKessel.lng,
    } : null,
    heizhackschnitzel: heizhackschnitzel ? {
      leistungKw: parseFloat(document.getElementById('hhs-leistung').value) || 400,
      eta: document.getElementById('hhs-eta').value,
      waerme: document.getElementById('hhs-waerme').value,
      lat: heizhackschnitzel.lat,
      lng: heizhackschnitzel.lng,
    } : null,
    fernwaerme: fernwaerme ? {
      leistungKw: parseFloat(document.getElementById('fw-leistung').value) || 500,
      waerme: document.getElementById('fw-waerme').value,
      co2f: document.getElementById('fw-co2f').value,
      pef: document.getElementById('fw-pef')?.value,
      lat: fernwaerme.lat,
      lng: fernwaerme.lng,
    } : null,
    bhkw: bhkw ? {
      leistungThKw: parseFloat(document.getElementById('bhkw-leistung-th').value) || 100,
      skz: document.getElementById('bhkw-skz').value,
      eta: document.getElementById('bhkw-eta').value,
      waerme: document.getElementById('bhkw-waerme').value,
    } : null,
    stromkessel: stromkessel ? {
      leistungKw: parseFloat(document.getElementById('sk-leistung').value) || 200,
      eta: document.getElementById('sk-eta').value,
      waerme: document.getElementById('sk-waerme').value,
    } : null,
    solarthermie: solarthermieAktiv ? { flaeche: parseFloat(document.getElementById('st-flaeche')?.value)||0, spez: parseFloat(document.getElementById('st-spez')?.value)||400, polygon: window._stPolygon || null } : null,
    waermespeicher: thermSpeicherAktiv ? { typ: document.getElementById('ts-typ')?.value||'puffer', volumen: parseFloat(document.getElementById('ts-volumen')?.value)||0, dt: parseFloat(document.getElementById('ts-dt')?.value)||40, verlust: parseFloat(document.getElementById('ts-verlust')?.value)||0.5, entladeKw: parseFloat(document.getElementById('ts-entlade-kw')?.value)||200 } : null,
    // Merit-Order und Wirtschaftlichkeits-Overrides mit sichern
    meritOrderKeys: [...window.meritOrderKeys],
    wirtVdiOverrides: JSON.parse(JSON.stringify(window._wirtVdiOverrides || {})),
    wirtBausteineOverrides: JSON.parse(JSON.stringify(window._wirtBausteineOverrides || {})),
  };
}

export function applyErzeugerState(state) {
  clearLwWp();
  clearGeo();
  clearFliessgewaesser();
  clearGasKessel();
  clearBhkw();
  clearStromkessel();
  clearHeizoelKessel();
  clearPellets();
  clearHhs();
  clearFernwaerme();
  clearSolarthermie();
  clearThermSpeicher();
  if (!state) return;
  if (state.lwWp && state.lwWp.lat != null) {
    lwWp = { lat: state.lwWp.lat, lng: state.lwWp.lng, leistungKw: state.lwWp.leistungKw || 12, lwaDb: state.lwWp.lwaDb || 80, visible: state.lwWp.visible !== false };
    lwWpVisible = lwWp.visible;
    document.getElementById('lwwp-visible').checked = lwWpVisible;
    document.getElementById('lwwp-leistung').value = lwWp.leistungKw;
    document.getElementById('lwwp-lwa').value = lwWp.lwaDb;
    if (state.lwWp.jaz) document.getElementById('lwwp-jaz').value = state.lwWp.jaz;
    if (state.lwWp.waerme) document.getElementById('lwwp-waerme').value = state.lwWp.waerme;
    if (state.lwWp.minCop) document.getElementById('lwwp-min-cop').value = state.lwWp.minCop;
    if (state.lwWp.manLaenge) document.getElementById('lwwp-man-laenge').value = state.lwWp.manLaenge;
    if (state.lwWp.manBreite) document.getElementById('lwwp-man-breite').value = state.lwWp.manBreite;
    document.getElementById('lwwp-data-section').style.display = 'block';
    redrawLwWp(); updateLwWpDisplay(); updateLwWpVisibility();
  }
  if (state.geoThermie && state.geoThermie.lat != null) {
    if (!geoLayerGroup) geoLayerGroup = L.layerGroup().addTo(map);
    geoThermie = { ...state.geoThermie };
    document.getElementById('geo-heizlast').value = state.geoThermie.heizlast || '';
    document.getElementById('geo-waerme').value = state.geoThermie.waerme || '';
    document.getElementById('geo-jaz').value = state.geoThermie.jaz || 4.5;
    document.getElementById('geo-tiefe').value = state.geoThermie.tiefe || 100;
    document.getElementById('geo-q-perm').value = Math.min(60, Math.max(10, state.geoThermie.qPerM || 31));
    document.getElementById('geo-abstand').value = Math.min(15, Math.max(6, state.geoThermie.abstand || 10));
    document.getElementById('geo-lambda').value = Math.min(5, Math.max(0.5, state.geoThermie.lambda || 2.0));
    document.getElementById('geo-guetegrad').value = Math.min(0.70, Math.max(0.20, state.geoThermie.guetegrad || 0.50));
    document.getElementById('geo-dt-absenkung').value = Math.min(15, Math.max(0, state.geoThermie.dtAbsenkung || 0));
    document.getElementById('geo-man-laenge').value = state.geoThermie.manLaenge || '';
    document.getElementById('geo-man-breite').value = state.geoThermie.manBreite || '';
    document.getElementById('btn-place-geo').textContent = 'Position verschieben';
    calcGeoThermie(); redrawGeo();
  }
  if (state.fliessgewaesser && state.fliessgewaesser.latlngs && state.fliessgewaesser.latlngs.length >= 2) {
    fliessgewaesser = { ...state.fliessgewaesser };
    fliessgewaesserVisible = fliessgewaesser.visible !== false;
    document.getElementById('fg-visible').checked = fliessgewaesserVisible;
    document.getElementById('fg-durchfluss').value = fliessgewaesser.durchflussLs;
    document.getElementById('fg-leistung').value = fliessgewaesser.leistungKw;
    document.getElementById('fg-jaz').value = fliessgewaesser.jaz;
    document.getElementById('fg-draw-section').style.display = 'none';
    document.getElementById('fg-data-section').style.display = 'block';
    if (state.fliessgewaesser.waerme) document.getElementById('fg-waerme').value = state.fliessgewaesser.waerme;
    redrawFliessgewaesser(); updateFliessgewaesserVisibility();
  }
  if (state.gasKessel) {
    gasKessel = { leistungKw: state.gasKessel.leistungKw || 500 };
    if (state.gasKessel.eta) document.getElementById('gk-eta').value = state.gasKessel.eta;
    if (state.gasKessel.waerme) document.getElementById('gk-waerme').value = state.gasKessel.waerme;
    document.getElementById('btn-activate-gaskessel').style.display = 'none';
    document.getElementById('gaskessel-data-section').style.display = 'block';
    updateGasKesselDisplay();
  }
  if (state.heizoelKessel) {
    heizoelKessel = { leistungKw: state.heizoelKessel.leistungKw || 500 };
    if (state.heizoelKessel.eta) document.getElementById('hko-eta').value = state.heizoelKessel.eta;
    if (state.heizoelKessel.waerme) document.getElementById('hko-waerme').value = state.heizoelKessel.waerme;
    document.getElementById('btn-activate-heizoel').style.display = 'none';
    document.getElementById('heizoel-data-section').style.display = 'block';
    updateHeizoelDisplay();
  }
  if (state.pelletsKessel) {
    pelletsKessel = { leistungKw: state.pelletsKessel.leistungKw || 300 };
    if (state.pelletsKessel.lat != null) { pelletsKessel.lat = state.pelletsKessel.lat; pelletsKessel.lng = state.pelletsKessel.lng; }
    if (state.pelletsKessel.eta) document.getElementById('pk-eta').value = state.pelletsKessel.eta;
    if (state.pelletsKessel.waerme) document.getElementById('pk-waerme').value = state.pelletsKessel.waerme;
    document.getElementById('btn-activate-pellets').style.display = 'none';
    document.getElementById('pellets-data-section').style.display = 'block';
    redrawPellets(); updatePelletsDisplay();
  }
  if (state.heizhackschnitzel) {
    heizhackschnitzel = { leistungKw: state.heizhackschnitzel.leistungKw || 400 };
    if (state.heizhackschnitzel.lat != null) { heizhackschnitzel.lat = state.heizhackschnitzel.lat; heizhackschnitzel.lng = state.heizhackschnitzel.lng; }
    if (state.heizhackschnitzel.eta) document.getElementById('hhs-eta').value = state.heizhackschnitzel.eta;
    if (state.heizhackschnitzel.waerme) document.getElementById('hhs-waerme').value = state.heizhackschnitzel.waerme;
    document.getElementById('btn-activate-hhs').style.display = 'none';
    document.getElementById('hhs-data-section').style.display = 'block';
    redrawHhs(); updateHhsDisplay();
  }
  if (state.fernwaerme) {
    fernwaerme = { leistungKw: state.fernwaerme.leistungKw || 500 };
    if (state.fernwaerme.lat != null) { fernwaerme.lat = state.fernwaerme.lat; fernwaerme.lng = state.fernwaerme.lng; }
    if (state.fernwaerme.waerme) document.getElementById('fw-waerme').value = state.fernwaerme.waerme;
    if (state.fernwaerme.co2f) document.getElementById('fw-co2f').value = state.fernwaerme.co2f;
    if (state.fernwaerme.pef) { const el = document.getElementById('fw-pef'); if (el) el.value = state.fernwaerme.pef; }
    document.getElementById('btn-activate-fernwaerme').style.display = 'none';
    document.getElementById('fernwaerme-data-section').style.display = 'block';
    redrawFernwaerme(); updateFernwaermeDisplay();
  }
  if (state.bhkw) {
    bhkw = { leistungThKw: state.bhkw.leistungThKw || 100 };
    document.getElementById('bhkw-leistung-th').value = bhkw.leistungThKw;
    if (state.bhkw.skz)     document.getElementById('bhkw-skz').value      = state.bhkw.skz;
    if (state.bhkw.eta)     document.getElementById('bhkw-eta').value      = state.bhkw.eta;
    if (state.bhkw.waerme)  document.getElementById('bhkw-waerme').value   = state.bhkw.waerme;
    document.getElementById('btn-activate-bhkw').style.display = 'none';
    document.getElementById('bhkw-data-section').style.display = 'block';
  }
  if (state.stromkessel) {
    stromkessel = { leistungKw: state.stromkessel.leistungKw || 200 };
    document.getElementById('sk-leistung').value = stromkessel.leistungKw;
    if (state.stromkessel.eta)    document.getElementById('sk-eta').value    = state.stromkessel.eta;
    if (state.stromkessel.waerme) document.getElementById('sk-waerme').value = state.stromkessel.waerme;
    document.getElementById('btn-activate-stromkessel').style.display = 'none';
    document.getElementById('stromkessel-data-section').style.display = 'block';
    updateStromkesselDisplay();
    updateBhkwDisplay();
  }
  if (state.solarthermie) {
    document.getElementById('st-flaeche').value = state.solarthermie.flaeche || 0;
    document.getElementById('st-spez').value = state.solarthermie.spez || 400;
    solarthermieAktiv = (state.solarthermie.flaeche || 0) > 0;
    if (state.solarthermie.polygon && state.solarthermie.polygon.length >= 3) {
      window._stPolygon = state.solarthermie.polygon;
      _attachSTLayer(state.solarthermie.polygon);
      const srcEl = document.getElementById('st-flaeche-src');
      if (srcEl) srcEl.textContent = '(aus Karte)';
    }
    updateSolarthermieDisplay();
    document.getElementById('solarthermie-panel').style.display = 'block';
  }
  if (state.waermespeicher) {
    document.getElementById('ts-typ').value = state.waermespeicher.typ || 'puffer';
    document.getElementById('ts-volumen').value = state.waermespeicher.volumen || 0;
    document.getElementById('ts-dt').value = state.waermespeicher.dt || 40;
    document.getElementById('ts-verlust').value = state.waermespeicher.verlust || 0.5;
    document.getElementById('ts-entlade-kw').value = state.waermespeicher.entladeKw || 200;
    thermSpeicherAktiv = (state.waermespeicher.volumen || 0) > 0;
    updateThermSpeicherDisplay();
    document.getElementById('therm-speicher-panel').style.display = 'block';
  }
  // Merit-Order wiederherstellen (clearXxx() hat sie via moBeiDeaktivierung() geleert)
  if (state && state.meritOrderKeys) {
    window.meritOrderKeys = state.meritOrderKeys.filter(k => isErzeugerAktiv(k));
  } else {
    // Fallback: aktive Erzeuger in Standard-Reihenfolge
    window.meritOrderKeys = Object.keys(ERZEUGER_CFG).filter(k => isErzeugerAktiv(k));
  }
  redrawErzeugerIcons(); // NACH Merit-Order-Wiederherstellung, damit Icons in gespeicherter Reihenfolge
  // Wirtschaftlichkeits-Overrides wiederherstellen
  window._wirtVdiOverrides       = JSON.parse(JSON.stringify(state?.wirtVdiOverrides       || {}));
  window._wirtBausteineOverrides = JSON.parse(JSON.stringify(state?.wirtBausteineOverrides || {}));
}

export function activateVariant(id) {
  // Aktuellen Zustand sichern
  if (activeVariantId === null) {
    baseNetzSnapshot = captureNetzState();
    baseErzeugerSnapshot = captureErzeugerState();
    baseKostenSnapshot = captureKostenState();
    baseHiddenAutoSnapshot = captureHiddenAutoState();
    const _ov = captureOverridesState();
    baseInvOverridesSnapshot = _ov.inv;
    baseVdiOverridesSnapshot = _ov.vdi;
  } else {
    const cur = varianten.find(v => v.id === activeVariantId);
    if (cur) {
      cur.netz = captureNetzState();
      cur.erzeuger = captureErzeugerState();
      cur.kostenpunkte = captureKostenState();
      cur.hiddenAutoIds = captureHiddenAutoState();
      const _ov = captureOverridesState();
      cur.invOverrides = _ov.inv;
      cur.vdiOverrides = _ov.vdi;
    }
  }
  // Neuen Zustand anwenden
  activeVariantId = id;
  if (id === null) {
    applyNetzState(baseNetzSnapshot);
    applyErzeugerState(baseErzeugerSnapshot);
    applyKostenState(baseKostenSnapshot);
    applyHiddenAutoState(baseHiddenAutoSnapshot);
    applyOverridesState({ inv: baseInvOverridesSnapshot, vdi: baseVdiOverridesSnapshot });
  } else {
    const target = varianten.find(v => v.id === id);
    if (!target) return;
    applyNetzState(target.netz);
    applyErzeugerState(target.erzeuger);
    applyKostenState(target.kostenpunkte || []);
    applyHiddenAutoState(target.hiddenAutoIds || []);
    applyOverridesState({ inv: target.invOverrides || {}, vdi: target.vdiOverrides || {} });
  }
  renderVariantenBar();
  updateVariantBanner();
  updateAllDeckungen();
  // Wirtschaft-Tab live aktualisieren, falls geöffnet
  if (currentViewMode === 'wirtschaft' && typeof window.refreshWirtschaftView === 'function') {
    window.refreshWirtschaftView();
  }
}

export function addVariante() {
  const name = prompt('Name der neuen Variante:', `Variante ${varianten.length + 1}`);
  if (!name) return;
  if (activeVariantId === null) {
    baseNetzSnapshot = captureNetzState();
    baseErzeugerSnapshot = captureErzeugerState();
    baseKostenSnapshot = captureKostenState();
    baseHiddenAutoSnapshot = captureHiddenAutoState();
    const _ov = captureOverridesState();
    baseInvOverridesSnapshot = _ov.inv;
    baseVdiOverridesSnapshot = _ov.vdi;
  }
  const id = 'v_' + Date.now();
  const _ov = captureOverridesState();
  varianten.push({
    id, name,
    netz: captureNetzState(),
    erzeuger: captureErzeugerState(),
    kostenpunkte: captureKostenState(),
    hiddenAutoIds: captureHiddenAutoState(),
    invOverrides: _ov.inv,
    vdiOverrides: _ov.vdi,
    gebaeudeAusschlüsse: [],
  });
  activeVariantId = id;
  renderVariantenBar();
  updateVariantBanner();
}

export function deleteVariante(id) {
  if (!confirm('Variante löschen?')) return;
  if (activeVariantId === id) activateVariant(null);
  varianten = varianten.filter(v => v.id !== id);
  renderVariantenBar();
}

export function renameVariante(id) {
  const v = varianten.find(x => x.id === id);
  if (!v) return;
  const name = prompt('Neuer Name:', v.name);
  if (name) { v.name = name; renderVariantenBar(); }
}

export function renderVariantenBar() {
  const pills = document.getElementById('var-pills');
  pills.innerHTML =
    `<span class="var-pill var-pill-base ${activeVariantId === null ? 'active' : ''}" data-click="activateVariant(null)">Basisdaten</span>` +
    varianten.map(v =>
      `<span class="var-pill ${activeVariantId === v.id ? 'active' : ''}" data-click="activateVariant('${v.id}')" ondblclick="renameVariante('${v.id}')" title="Doppelklick zum Umbenennen">${escHtml(v.name)}</span>` +
      `<span class="var-del-btn" data-click="deleteVariante('${v.id}')" title="Variante löschen">✕</span>`
    ).join('');
}

export function updateVariantBanner() {
  const banner = document.getElementById('variant-banner');
  if (!banner) return;
  if (activeVariantId === null) {
    banner.style.display = 'none';
  } else {
    const v = varianten.find(x => x.id === activeVariantId);
    document.getElementById('variant-banner-name').textContent = v ? v.name : '';
    banner.style.display = 'block';
  }
}
export function isExcluded(id) {
  if (activeVariantId === null) return false;
  const v = varianten.find(x => x.id === activeVariantId);
  return v ? (v.gebaeudeAusschlüsse || []).includes(id) : false;
}

export function toggleAusschluss(id) {
  if (activeVariantId === null) return;
  const v = varianten.find(x => x.id === activeVariantId);
  if (!v) return;
  if (!v.gebaeudeAusschlüsse) v.gebaeudeAusschlüsse = [];
  const idx = v.gebaeudeAusschlüsse.indexOf(id);
  if (idx >= 0) v.gebaeudeAusschlüsse.splice(idx, 1);
  else v.gebaeudeAusschlüsse.push(id);
  renderList(); updateViz(); updateTotals(); recalcNetz();
}
