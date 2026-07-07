// ── 03c-gebaeude-io.js — Gebäude-UI, Totals, Chart, Gebäude-PV, Rendering, Projekt-Import/Export, Animation ──
import { _captureVariantenKernzustand, _expandedIds, _restoreVariantenKernzustand, globalYear, isExcluded, selectedId, stromEdges } from './01-globals-varianten.js';
import { getColor, getColorRange, getColorVal, getComputedStats, getGebStromMwh, highlightCard, map,
         getNutzungstypen, getNutzungstypById, isBuiltinNutzungstyp, NUTZUNGSTYPEN_CUSTOM } from './02b-gebaeude.js';
import { hidePanels, populateZentraleSelect } from './03b-netz.js';
import { updateLpGebietStatus, updatePrintLegend } from './04a-ui-panels.js';
import { glGetGesamtMwh, glGetMonatswerte, glLastgangKw } from './06a-gbi-lastgang.js';
import { isErzeugerAktiv, meritOrderKeys, setMeritOrderKeys } from './06c-dispatch-core.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { ASSETS, ASSET_CFG, getAssetStatus, getAssetsForBuilding, createAsset, deleteAsset, clearAssets } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets } from './13b-assets-render.js';
import { ELSLP_CUSTOM, ELSLP_WPM2, getElSlpProfiles, getElSlpGruppen, getElSlpById, getElSlpWpm2, showElSlpModal } from './13k-elslp-registry.js';
import { activeVariantId, edgeKey, freiflaechen, lwWp, lwWpVisible, networkLocked, netzEdges, renderVariantenBar, stromNetzVisible, stromNodes, updateVariantBanner } from './01-globals-varianten.js';
import { _invalidateStats, addGebaeude, toggleNetworkLock, ensureSatellite, setGlobalYear } from './02b-gebaeude.js';
import { clearFliessgewaesser, clearLwWp, clearTrasse, polygonAreaM2, polygonCenter, redrawFliessgewaesser, redrawLwWp, redrawTrasse, updateFliessgewaesserVisibility, updateLwWpDisplay, updateLwWpVisibility, updateViz } from './02c-karte-werkzeuge.js';
import { attachFFLayer, clearFernwaerme, clearGasKessel, clearHeizoelKessel, clearHhs, clearPellets, clearStromkessel, redrawErzeugerIcons, redrawFernwaerme, redrawGasKessel, redrawHeizoelKessel, redrawHhs, redrawPellets, renderFFPanel, updateBhkwDisplay, updateFernwaermeDisplay, updateGasKesselDisplay, updateHeizoelDisplay, updateHhsDisplay, updatePelletsDisplay, updateStromkesselDisplay } from './03a-erzeuger.js';
import { addNetzEdge, autoGenerateNetz, calcGeoThermie, clearNetz, recalcNetz, redrawGeo, syncVLTemps } from './03b-netz.js';
import { applyEdgePrunedStyle, updatePruningSummary } from './04a-ui-panels.js';
import { addStromEdge, addStromNode, clearStromNetz, recalcStromNetz, stromNodeClick } from './05b-stromnetz.js';
import { _attachSTLayer, clearSolarthermie, clearThermSpeicher, glBerechnenDebounced, updateSolarthermieDisplay, updateThermSpeicherDisplay } from './06b-gl-berechnen.js';
import { moBeiAktivierung } from './06c-dispatch-core.js';
import { _onStrompreisChange } from './09a-pv-profile.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { bhkw, edgeWaypoints, fernwaerme, fernwaermeEmF, ffCounter, fliessgewaesser, fliessgewaesserVisible, gasEmF, gasKessel, geoLayerGroup, geoThermie, heizhackschnitzel, heizoelEmF, heizoelKessel, hhsEmF, idCounter, pefFernwaerme, pefGas, pefHeizoel, pefHhs, pefPellets, pefStrom, pefWP, pelletsEmF, pelletsKessel, setBhkw, setEdgeWaypoints, setFernwaerme, setFernwaermeEmF, setFfCounter, setFliessgewaesser, setGasEmF, setGasKessel, setGeoLayerGroup, setGeoThermie, setHeizhackschnitzel, setHeizoelEmF, setHeizoelKessel, setHhsEmF, setIdCounter, setPefFernwaerme, setPefGas, setPefHeizoel, setPefHhs, setPefPellets, setPefStrom, setPefWP, setPelletsEmF, setPelletsKessel, setSolarthermieAktiv, setStromEmF, setStromEmFLZ, setStromkessel, setThermSpeicherAktiv, setTrasseCurrentSegStart, setTrassePoints, setTrasseSegments, set_batchImporting, solarthermieAktiv, stromEmF, stromEmFLZ, stromkessel, thermSpeicherAktiv, trassePoints, trasseSegments } from './01-globals-varianten.js';
import { kostenSzenario, setKostenSzenario } from './02a-netz-physik.js';
import { setFliessgewaesserVisible } from './02c-karte-werkzeuge.js';

export function updateTotals(){
  let tw=0, th=0;
  window.gebaeude.forEach(g=>{
    if (isExcluded(g.id)) return;
    const stats = getComputedStats(g, globalYear);
    tw += stats.waerme;
    th += stats.heizlast;
  });
  document.getElementById('tot-waerme').textContent=tw?tw.toLocaleString('de-DE',{maximumFractionDigits:1}):'—';
  document.getElementById('tc-waerme').title='Summe Wärmebedarf aller Gebäude (ohne Netzverluste)';
  document.getElementById('tot-hl').textContent=th?Math.round(th).toLocaleString('de-DE'):'—';
  document.getElementById('tot-hl-lbl').textContent='Heizlast (kW)';
  document.getElementById('tc-hl').title='Summe der Gebäude-Normheizlasten (DIN 12831).\nWird für Rohrdimensionierung im Netz verwendet.';
  // Strom-Totals
  let ts=0, tsl=0;
  if (window.elQuartierH) {
    for (let i=0;i<8760;i++) { ts += window.elQuartierH[i]; if (window.elQuartierH[i] > tsl) tsl = window.elQuartierH[i]; }
    ts /= 1000;
  } else {
    window.gebaeude.forEach(g => { if (!isExcluded(g.id)) ts += getGebStromMwh(g); });
    if (ts > 0) tsl = ts * 1000 / 2500; // Schätzung ~2500 VBH
  }
  document.getElementById('tot-strom').textContent=ts>0?ts.toLocaleString('de-DE',{maximumFractionDigits:1}):'—';
  document.getElementById('tot-stromlast').textContent=tsl>0?Math.round(tsl).toLocaleString('de-DE'):'—';
  document.getElementById('geb-count').textContent=window.gebaeude.length;

  // Quellenübersicht
  const srcEl = document.getElementById('tot-sources');
  if (srcEl) {
    const ss = window.systemState;
    const hatLg = typeof glLastgangKw !== 'undefined' && !!glLastgangKw;
    const hatMonat = typeof glGetMonatswerte === 'function' && glGetMonatswerte().some(v => v !== null);
    const hatGesamt = typeof glGetGesamtMwh === 'function' && glGetGesamtMwh() > 0;
    let wSrc = '—';
    if (hatLg) wSrc = 'Lastgang';
    else if (hatMonat && hatGesamt) wSrc = 'Gesamt + Monate';
    else if (hatMonat) wSrc = 'Monatswerte';
    else if (hatGesamt) wSrc = 'Gesamtwert';
    else if (tw > 0) wSrc = 'Gebäudedaten';

    let sSrc = '—';
    if (window.elQuartierH) sSrc = 'Lastgang';
    else if (parseFloat(document.getElementById('strom-quartier-mwh')?.value) > 0) sSrc = 'Gesamtwert';
    else if (ts > 0) sSrc = 'Gebäudedaten';

    const pvKwp = parseFloat(document.getElementById('pv-kwp')?.value) || 0;
    let pvSrc = '—';
    if (pvKwp > 0) pvSrc = pvKwp.toLocaleString('de-DE',{maximumFractionDigits:1}) + ' kWp';

    const dot = (color) => '<span class="src-dot" style="background:' + color + '"></span>';
    srcEl.innerHTML =
      '<span class="src-tag">' + dot('var(--accent)') + 'Wärme: ' + wSrc + '</span>' +
      '<span class="src-tag">' + dot('#ffd54f') + 'Strom: ' + sSrc + '</span>' +
      '<span class="src-tag">' + dot('#66bb6a') + 'PV: ' + pvSrc + '</span>';
  }

  updatePrintLegend();
}

export function cardDotColor(g){
  const [cMin,cMax]=getColorRange();
  return getColor(getColorVal(g),cMin,cMax);
}

export function drawChart() {
  const container = document.getElementById('svg-chart-container');
  if (!container) return;

  const years = [];
  for (let y = 2026; y <= 2050; y++) years.push(y);

  // Wärme MIT Sanierungen (aktuell)
  const waerme = years.map(y => {
    let s = 0; window.gebaeude.forEach(g => { s += getComputedStats(g, y).waerme; }); return s;
  });
  // Wärme OHNE Sanierungen (Vergleich)
  const waermeOhne = years.map(y => {
    let s = 0;
    window.gebaeude.forEach(g => {
      const saved = g.sanierungen; g.sanierungen = [];
      s += getComputedStats(g, y).waerme;
      g.sanierungen = saved;
    });
    return s;
  });
  // Heizlast MIT Sanierungen
  const hl = years.map(y => {
    let s = 0; window.gebaeude.forEach(g => { s += getComputedStats(g, y).heizlast; }); return s;
  });

  const maxW  = Math.max(...waerme, ...waermeOhne, 1);
  const maxHL = Math.max(...hl, 1);

  const w = Math.max(container.clientWidth, 300);
  const h = Math.max(container.clientHeight, 180);
  const padL = 42, padR = 42, padT = 18, padB = 28;
  const cw = w - padL - padR;
  const ch = h - padT - padB;

  function xp(i) { return padL + (i / (years.length - 1)) * cw; }
  function ypW(v) { return padT + ch - (v / maxW) * ch; }
  function ypHL(v) { return padT + ch - (v / maxHL) * ch; }

  const ptsW     = years.map((_,i) => `${xp(i)},${ypW(waerme[i])}`).join(' ');
  const ptsWohne = years.map((_,i) => `${xp(i)},${ypW(waermeOhne[i])}`).join(' ');
  const ptsHL    = years.map((_,i) => `${xp(i)},${ypHL(hl[i])}`).join(' ');

  // Year marker
  const yi = years.indexOf(globalYear);
  const xCur = xp(yi >= 0 ? yi : 0);

  // Grid lines (4 horizontal)
  let grid = '';
  for (let t = 0; t <= 4; t++) {
    const yg = padT + (t / 4) * ch;
    const vW = Math.round(maxW * (1 - t / 4));
    grid += `<line x1="${padL}" y1="${yg}" x2="${w-padR}" y2="${yg}" stroke="#2a3050" stroke-width="0.5"/>`;
    grid += `<text x="${padL-4}" y="${yg+3}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace" text-anchor="end">${vW}</text>`;
    const vHL = Math.round(maxHL * (1 - t / 4));
    grid += `<text x="${w-padR+4}" y="${yg+3}" fill="#f9a825" font-size="8" font-family="DM Mono,monospace" text-anchor="start" opacity="0.7">${vHL}</text>`;
  }

  // Area fill under waerme line
  const areaW = `${ptsW} ${xp(years.length-1)},${padT+ch} ${xp(0)},${padT+ch}`;

  let html = `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" style="overflow:visible">
    ${grid}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+ch}" stroke="#2a3050" stroke-width="1"/>
    <line x1="${padL}" y1="${padT+ch}" x2="${w-padR}" y2="${padT+ch}" stroke="#2a3050" stroke-width="1"/>
    <line x1="${w-padR}" y1="${padT}" x2="${w-padR}" y2="${padT+ch}" stroke="#2a3050" stroke-width="1" opacity="0.4"/>

    <!-- Vergleich ohne Sanierung -->
    <polyline points="${ptsWohne}" fill="none" stroke="#e53935" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.5"/>

    <!-- Area fill Wärme -->
    <polygon points="${areaW}" fill="#4caf50" opacity="0.07"/>

    <!-- Wärme MIT Sanierung -->
    <polyline points="${ptsW}" fill="none" stroke="#4caf50" stroke-width="2"/>

    <!-- Heizlast (rechte Achse) -->
    <polyline points="${ptsHL}" fill="none" stroke="#f9a825" stroke-width="1.5" stroke-dasharray="7 3" opacity="0.8"/>

    <!-- Aktuelles Jahr -->
    <line x1="${xCur}" y1="${padT}" x2="${xCur}" y2="${padT+ch}" stroke="#4fc3f7" stroke-width="1" stroke-dasharray="4 3" opacity="0.6"/>
    <text x="${xCur}" y="${padT-4}" fill="#4fc3f7" font-size="8" font-family="DM Mono,monospace" text-anchor="middle">${globalYear}</text>

    <!-- X-Achse Labels -->
    <text x="${padL}" y="${padT+ch+12}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace">2026</text>
    <text x="${xp(13)}" y="${padT+ch+12}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace" text-anchor="middle">2037</text>
    <text x="${w-padR}" y="${padT+ch+12}" fill="#7a8099" font-size="8" font-family="DM Mono,monospace" text-anchor="end">2050</text>

    <!-- Achsenbeschriftungen -->
    <text x="${padL-2}" y="${padT-6}" fill="#4caf50" font-size="8" font-family="DM Sans,sans-serif">MWh/a</text>
    <text x="${w-padR+2}" y="${padT-6}" fill="#f9a825" font-size="8" font-family="DM Sans,sans-serif" opacity="0.8">kW</text>

    <!-- Legende -->
    <line x1="${padL}" y1="${padT+ch+22}" x2="${padL+18}" y2="${padT+ch+22}" stroke="#4caf50" stroke-width="2"/>
    <text x="${padL+21}" y="${padT+ch+25}" fill="#7a8099" font-size="8" font-family="DM Sans,sans-serif">Wärme (mit San.)</text>
    <line x1="${padL+105}" y1="${padT+ch+22}" x2="${padL+123}" y2="${padT+ch+22}" stroke="#e53935" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.7"/>
    <text x="${padL+126}" y="${padT+ch+25}" fill="#7a8099" font-size="8" font-family="DM Sans,sans-serif">ohne San.</text>
    <line x1="${padL+185}" y1="${padT+ch+22}" x2="${padL+203}" y2="${padT+ch+22}" stroke="#f9a825" stroke-width="1.5" stroke-dasharray="7 3" opacity="0.8"/>
    <text x="${padL+206}" y="${padT+ch+25}" fill="#7a8099" font-size="8" font-family="DM Sans,sans-serif">Heizlast</text>
  </svg>`;

  container.innerHTML = html;
}

window.addEventListener('resize', () => {
    if (document.getElementById('chart-panel').classList.contains('visible')) drawChart();
    if (typeof map !== 'undefined') setTimeout(() => map.invalidateSize(), 100);
});

export function _renderCompactRow(g, stats, isExpanded) {
  const dot = cardDotColor(g);
  const nutzungLabel = {efh:'EFH',mfh:'MFH',ghd:'GHD',schule:'Schule',buero:'Büro',industrie:'Ind.',oeffentlich:'Öff.'}[g.nutzung] || '—';
  const waermeStr = stats.waerme > 0 ? Math.round(stats.waerme).toLocaleString('de-DE') : '—';
  const hlStr = stats.heizlast > 0 ? Math.round(stats.heizlast).toLocaleString('de-DE') : '—';
  const statusColor = stats.status==='abgerissen'?'#e53935':stats.status==='saniert'?'#4caf50':stats.status==='geplant'?'#f9a825':'transparent';
  const badgeClass = g.polygon ? (g.fromOsm ? 'osm' : 'ok') : '';
  const badgeText = g.polygon ? (g.fromOsm ? 'OSM' : '✓') : '–';
  return `<div class="geb-compact-row" data-click="toggleGebExpand(${g.id})">
    <div style="display:flex;align-items:center;gap:5px;width:100%;">
      <input type="checkbox" style="flex-shrink:0;accent-color:var(--accent);cursor:pointer;" ${g.selected?'checked':''} data-change="toggleSelect(${g.id},this.checked)" data-click="event.stopPropagation()" title="Auswählen"/>
      <div class="geb-color-dot" data-dot="${g.id}" style="background:${dot};flex-shrink:0;"></div>
      <span class="geb-compact-name">${escHtml(g.name)}</span>
      <span style="font-size:9px;color:var(--muted);flex-shrink:0;">${isExpanded?'▲':'▼'}</span>
    </div>
    <div style="display:flex;align-items:center;gap:4px;padding-left:28px;margin-top:1px;">
      <button data-click="event.stopPropagation();toggleVormerkenGeb(${g.id})" title="${g.feldVorgemerkt ? 'Vorgemerkt – klicken zum Entfernen' : 'Für Feldbegehung vormerken'}" style="background:none;border:none;cursor:pointer;font-size:${g.feldVorgemerkt ? '13' : '11'}px;color:${g.feldVorgemerkt ? '#f59e0b' : '#666'};padding:0 2px;margin-right:2px;line-height:1;flex-shrink:0;">★</button>
      <span style="font-size:9px;color:var(--muted);min-width:28px;flex-shrink:0;">${nutzungLabel}</span>
      <span class="geb-compact-val geb-cv-waerme-${g.id}" style="color:var(--accent)">${waermeStr}</span>
      <span class="geb-compact-unit">MWh</span>
      <span class="geb-compact-val geb-cv-hl-${g.id}" style="color:#f9a825">${hlStr}</span>
      <span class="geb-compact-unit">kW</span>
      <div class="geb-badge ${badgeClass}" style="font-size:8px;padding:1px 3px;margin-left:auto;">${badgeText}</div>
      ${statusColor!=='transparent'?`<span style="width:5px;height:5px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>`:''}
      ${g.feldStatus==='erledigt'?`<span style="font-size:9px;flex-shrink:0;" title="Feldbefund: Erledigt">✅</span>`:g.feldStatus==='besucht'?`<span style="font-size:9px;flex-shrink:0;" title="Feldbefund: Besucht">👁</span>`:''}
    </div>
  </div>`;
}

export function _pvWpM2Global() {
  const b  = parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1;
  const l  = parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7;
  const wp = parseFloat(document.getElementById('pv-modul-wp')?.value)     || 450;
  return wp / (b * l);
}

// Gebäude im Flächen-Modus mit mindestens einer Belegungsfläche?
export function _hasBelegung(g) {
  return !!(g.pvFlaechen && g.pvFlaechen.some(f => f.typ === 'belegung'));
}

// Netto-Belegungsfläche (m²) = Σ Belegungsflächen − Σ Sperrflächen, ≥ 0.
// Vereinfachung: Sperrflächen werden flächengleich abgezogen (sollten innerhalb
// der Belegung liegen) — keine echte Polygon-Verschneidung.
export function pvNettoFlaeche(g) {
  if (!g.pvFlaechen) return 0;
  let bel = 0, sperr = 0;
  for (const f of g.pvFlaechen) {
    if (f.typ === 'sperr') sperr += f.flaeche || 0;
    else bel += f.flaeche || 0;
  }
  return Math.max(0, bel - sperr);
}

export function calcGebKwp(g) {
  // Flächen-Modus (Phase 1+2): kWp aus der TATSÄCHLICH platzierten Modulanzahl
  // (reale Module über Belegung, Sperrflächen ausgespart) × Modul-Wp. PV-Sol-Stil,
  // ersetzt die Dachanteil-Pauschale. Platzierung ist gecacht (getGebPvModules).
  if (g.pvModus === 'flaechen' && _hasBelegung(g)) {
    const wp = parseFloat(document.getElementById('pv-modul-wp')?.value) || 450;
    return getGebPvModules(g).count * wp / 1000;
  }
  const fl = parseFloat(g.flaeche) || 0;
  return fl * (g.pvDachanteil || 30) / 100 * _pvWpM2Global() / 1000;
}

// ── Dach-Hilfsfunktionen ─────────────────────────────────────────────────────
export function getDachDefaultNeigung(dachform) {
  return { flach: 5, sattel: 35, walm: 30, pult: 15 }[dachform] || 35;
}

// Korrekturfaktor für PV-Ertrag basierend auf Azimut + Neigung
// Azimut: 0=Nord, 90=Ost, 180=Süd, 270=West
// Referenzwerte nach PVGIS/DIN EN 15316 für Mitteleuropa
export function getPvKorrFaktor(g) {
  const dachform = g.dachform || 'sattel';

  // Flachdach: Süd-Aufständerung (30°) → optimal; Ost-West liegt real bei ~90% des
  // Süd-Ertrags (zwei Halbfelder je ~15° Neigung, Ost/West-Ausrichtung).
  if (dachform === 'flach') return g.pvFlAusrichtung === 'ostwest' ? 0.90 : 1.0;

  const azimut  = g.dachAzimut  ?? 180;
  const neigung = g.dachNeigung ?? getDachDefaultNeigung(dachform);

  // Azimut-Faktor: Abweichung von Süd (180°)
  const dev = Math.min(Math.abs(azimut - 180), 360 - Math.abs(azimut - 180));
  // Stützwerte: 0°→1.00, 45°→0.96, 90°→0.84, 135°→0.70, 180°→0.60
  const azSteps = [[0,1.0],[45,0.96],[90,0.84],[135,0.70],[180,0.60]];
  let azFak = 0.60;
  for (let i = 0; i < azSteps.length - 1; i++) {
    if (dev >= azSteps[i][0] && dev <= azSteps[i+1][0]) {
      const t = (dev - azSteps[i][0]) / (azSteps[i+1][0] - azSteps[i][0]);
      azFak = azSteps[i][1] + t * (azSteps[i+1][1] - azSteps[i][1]);
      break;
    }
  }

  // Neigungsfaktor: optimal ~30°
  // Stützwerte: 0°→0.87, 15°→0.97, 30°→1.00, 45°→0.97, 60°→0.88, 75°→0.75
  const tSteps = [[0,0.87],[15,0.97],[30,1.00],[45,0.97],[60,0.88],[75,0.75]];
  let tFak = 0.87;
  const clampN = Math.max(0, Math.min(75, neigung));
  for (let i = 0; i < tSteps.length - 1; i++) {
    if (clampN >= tSteps[i][0] && clampN <= tSteps[i+1][0]) {
      const t = (clampN - tSteps[i][0]) / (tSteps[i+1][0] - tSteps[i][0]);
      tFak = tSteps[i][1] + t * (tSteps[i+1][1] - tSteps[i][1]);
      break;
    }
  }

  return Math.round(azFak * tFak * 100) / 100;
}

// kWp mit Ertragskorrekturfaktor
export function calcGebKwpKorr(g) {
  // Satteldach im Flächen-Modus (Phase 4): Ertragsfaktor anteilig aus beiden
  // Dachhälften (Azimut A / A+180), gewichtet nach Modulanzahl je Seite.
  if (g.pvModus === 'flaechen' && _hasBelegung(g) && g.dachform === 'sattel') {
    return calcGebKwp(g) * _gebSattelKorrFaktor(g);
  }
  // getPvKorrFaktor liefert für Flachdach 1,0; für übrige Schrägdächer den Azimut/
  // Neigungs-Ertragsfaktor. Gilt einheitlich für Pauschal- und Flächen-Modus.
  return calcGebKwp(g) * getPvKorrFaktor(g);
}

// Azimut der wahrscheinlichen Südseite aus dem längsten Polygon-Segment ermitteln
export function detectRoofAzimutFromPolygon(polygon) {
  if (!polygon || polygon.length < 2) return null;
  let maxLen = -1, ridgeAngleDeg = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],           b = polygon[(i + 1) % polygon.length];
    const lat1 = a.lat ?? a[0],    lng1 = a.lng ?? a[1];
    const lat2 = b.lat ?? b[0],    lng2 = b.lng ?? b[1];
    const dLat = (lat2 - lat1) * 111320;
    const dLng = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    const len  = Math.sqrt(dLat * dLat + dLng * dLng);
    if (len > maxLen) {
      maxLen = len;
      // Winkel von Nord im Uhrzeigersinn (0–180°, da Firstrichtung symmetrisch)
      ridgeAngleDeg = ((Math.atan2(dLng, dLat) * 180 / Math.PI) % 180 + 180) % 180;
    }
  }
  // First läuft entlang ridgeAngleDeg → Südhang ist senkrecht dazu
  const faceA = (ridgeAngleDeg + 90) % 360;
  const faceB = (ridgeAngleDeg - 90 + 360) % 360;
  const devA  = Math.min(Math.abs(faceA - 180), 360 - Math.abs(faceA - 180));
  const devB  = Math.min(Math.abs(faceB - 180), 360 - Math.abs(faceB - 180));
  return Math.round(devA <= devB ? faceA : faceB);
}

// ── Elektro-Assets eines Gebäudes (einklappbare Sektion) ────────────────────
if (!window._gebElektroCollapsed) window._gebElektroCollapsed = {};

// ── Inline-Hilfsfunktion: SLP-Dropdown-Options für Verbraucher ──────────────
function _buildVerbrSlpOptions(currentSlp) {
  const profs   = getElSlpProfiles();
  const gruppen = getElSlpGruppen();
  return gruppen.map(grp => {
    const opts = profs.filter(p => p.gruppe === grp).map(p =>
      `<option value="${p.id}"${p.id === currentSlp ? ' selected' : ''}>${p.id} — ${p.label}</option>`
    ).join('');
    return `<optgroup label="${grp}">${opts}</optgroup>`;
  }).join('');
}

function buildGebElektroSection(g) {
  const assets = getAssetsForBuilding(g.id);
  const count  = assets.length;
  // Standard: eingeklappt — isOpen nur wenn explizit auf true gesetzt
  const isOpen = window._gebElektroCollapsed[g.id] === true;

  // Modulanzahl aus gezeichneten Belegungsflächen (nur im Flächen-Modus)
  const gebModCount = (g.pvModus === 'flaechen' && _hasBelegung(g)) ? getGebPvModules(g).count : 0;

  let rows = '';
  if (count === 0) {
    rows = `<div class="geb-elektro-empty">Keine Elektro-Assets zugeordnet</div>`;
  } else {
    rows = assets.map(a => {
      const cfg    = ASSET_CFG[a.type] || { icon: '⚡', color: '#aaa', label: a.type };
      const status = getAssetStatus(a, window.globalYear ?? new Date().getFullYear());

      // Kennzahl ersetzt den Status-Punkt wenn vorhanden
      let rightIndicator;
      if (a.type === 'Verbraucher' && a.props?.leistungKW != null) {
        rightIndicator = `<span class="geb-elektro-metric" style="color:#4fc3f7;">${(+a.props.leistungKW).toLocaleString('de-DE',{maximumFractionDigits:1})} kW</span>`;
      } else if (a.type === 'PV' && a.props?.leistungKWp != null) {
        const modTxt = gebModCount ? `<span class="geb-elektro-metric" style="color:var(--muted);font-size:9px;margin-right:4px;">${gebModCount.toLocaleString('de-DE')} Mod.</span>` : '';
        rightIndicator = `${modTxt}<span class="geb-elektro-metric" style="color:#ffd54f;">${(+a.props.leistungKWp).toLocaleString('de-DE',{maximumFractionDigits:1})} kWp</span>`;
      } else if (a.props?.leistungKVA != null) {
        rightIndicator = `<span class="geb-elektro-metric">${(+a.props.leistungKVA).toLocaleString('de-DE',{maximumFractionDigits:0})} kVA</span>`;
      } else {
        rightIndicator = `<span class="geb-elektro-status geb-elektro-status-${status}"></span>`;
      }

      return `<div class="geb-elektro-row" data-click="openAssetFromGeb('${a.id}')" title="${cfg.label}">
        <span class="geb-elektro-icon" style="background:${cfg.color};">${cfg.icon}</span>
        <span class="geb-elektro-name">${escHtml(a.name)}</span>
        ${rightIndicator}
      </div>`;
    }).join('');
  }

  return `
    <div class="geb-elektro-section">
      <div class="geb-elektro-hdr" data-click="toggleGebElektro(${g.id})">
        <span class="geb-elektro-hdr-icon">⚡</span>
        <span class="geb-elektro-hdr-label">Elektro-Assets</span>
        <span class="geb-elektro-hdr-count">${count}</span>
        <span class="geb-elektro-chevron${isOpen ? '' : ' rotated'}">▾</span>
      </div>
      <div class="geb-elektro-rows" id="geb-elektro-rows-${g.id}"${isOpen ? '' : ' style="display:none;"'}>
        ${rows}
        <div class="geb-elektro-dach-sub">
          ${buildDachSection(g, { showPvBtn: true })}
        </div>
        <div class="geb-elektro-dach-sub">
          ${buildGebVerbraucherSection(g)}
        </div>
      </div>
    </div>`;
}

window.toggleGebElektro = function(gId) {
  // true = open, false/undefined = closed (default)
  const wasOpen = window._gebElektroCollapsed[gId] === true;
  window._gebElektroCollapsed[gId] = !wasOpen;
  const rows    = document.getElementById(`geb-elektro-rows-${gId}`);
  const chevron = rows?.previousElementSibling?.querySelector('.geb-elektro-chevron');
  if (!rows) return;
  rows.style.display = !wasOpen ? '' : 'none';
  chevron?.classList.toggle('rotated', wasOpen); // rotated = closed
};

window.openAssetFromGeb = function(assetId) {
  if (typeof window.openAssetInspector === 'function') {
    const a = (window.ASSETS?.items || []).find(x => x.id === assetId);
    if (a) window.openAssetInspector(a);
  }
};

// Programmatischer Asset-Props-Update (für externe Aufrufer)
window.updateVerbrAssetProp = function(assetId, field, value, gId) {
  const asset = (window.ASSETS?.items || []).find(a => a.id === assetId);
  if (!asset) return;
  if (!asset.props) asset.props = {};
  if (field === 'leistungKW') {
    const v = parseFloat(value);
    asset.props.leistungKW = isNaN(v) ? null : v;
  } else {
    asset.props[field] = value;
  }
  if (gId != null) _rerenderCard(gId);
};

// ── Leistungsschätzung-Sektion (eigener Reiter, default eingeklappt) ────────
if (!window._gebVerbrOpen) window._gebVerbrOpen = {};

function buildGebVerbraucherSection(g) {
  const assets  = getAssetsForBuilding(g.id);
  const verbr   = assets.find(a => a.type === 'Verbraucher');
  const isOpen  = window._gebVerbrOpen[g.id] !== false; // default: ausgeklappt

  const slpTyp  = verbr?.props?.slpTyp || 'G0';
  const existKw = verbr?.props?.leistungKW;
  const fl      = parseFloat(g.flaeche) || 0;
  const wpm2    = getElSlpWpm2(slpTyp);
  const autoKw  = fl > 0 ? Math.round(fl * wpm2 / 1000 * 10) / 10 : null;
  const dispKw  = existKw != null ? existKw : (autoKw ?? '');
  const badge   = existKw != null
    ? existKw + ' kW'
    : autoKw != null ? '~' + autoKw + ' kW' : '—';

  return `
    <div class="geb-dach-section" style="border-top-color:#4fc3f7;">
      <div class="geb-dach-hdr" data-click="toggleGebVerbr(${g.id})">
        <span class="geb-dach-hdr-icon" style="color:#4fc3f7;">⚡</span>
        <span class="geb-dach-hdr-label">Leistungsschätzung</span>
        <span class="geb-dach-kwp-badge" id="geb-verbr-badge-${g.id}" style="color:#4fc3f7;">${badge}</span>
        <span class="geb-dach-chevron${isOpen ? '' : ' rotated'}">▾</span>
      </div>
      <div class="geb-dach-rows" id="geb-verbr-rows-${g.id}"${isOpen ? '' : ' style="display:none;"'}>
        <div style="display:grid;grid-template-columns:1fr 84px;gap:5px;margin-top:4px;">
          <div class="inp-group">
            <div class="inp-label">BDEW-Lastprofil</div>
            <select class="inp-field" id="geb-verbr-slp-${g.id}"
              data-change="updateGebVerbrSlp(${g.id},this.value)">
              ${_buildVerbrSlpOptions(slpTyp)}
            </select>
          </div>
          <div class="inp-group">
            <div class="inp-label">Leistung (kW)</div>
            <input class="inp-field" type="number" step="0.1"
              id="geb-verbr-kw-${g.id}"
              value="${escVal(dispKw)}" placeholder="—"/>
          </div>
        </div>
        ${fl > 0
          ? `<div id="geb-verbr-formel-${g.id}" style="font-size:9px;color:var(--muted);margin-top:2px;font-family:'DM Mono',monospace;">
               ↳ ${Math.round(fl)} m² × <a data-click="openElSlpManager(${g.id})" title="W/m²-Annahmen verwalten / Profile hinzufügen" style="color:#4fc3f7;cursor:pointer;text-decoration:underline dotted;">${wpm2} W/m²</a> ÷ 1000 = ${autoKw} kW (${slpTyp})
             </div>`
          : `<div id="geb-verbr-formel-${g.id}" style="font-size:9px;color:rgba(249,168,37,.7);margin-top:2px;">↳ Keine Fläche — manuelle Eingabe (<a data-click="openElSlpManager(${g.id})" style="color:#4fc3f7;cursor:pointer;text-decoration:underline dotted;">W/m² verwalten</a>)</div>`}
        ${verbr
          ? `<button class="btn-xs" data-click="overwriteVerbrAsset(${g.id})"
               style="width:100%;margin-top:6px;display:flex;justify-content:center;gap:4px;border-color:#4fc3f7;color:#4fc3f7;">
               ⚡ SLP + kW → Verbraucher-Asset überschreiben
             </button>`
          : `<div style="font-size:9px;color:rgba(249,168,37,.7);margin-top:5px;">⚠ Kein Verbraucher-Asset vorhanden</div>`}
      </div>
    </div>`;
}

window.toggleGebVerbr = function(gId) {
  if (!window._gebVerbrOpen) window._gebVerbrOpen = {};
  const wasOpen = window._gebVerbrOpen[gId] !== false; // default open
  window._gebVerbrOpen[gId] = !wasOpen;
  const rows    = document.getElementById(`geb-verbr-rows-${gId}`);
  const chevron = rows?.previousElementSibling?.querySelector('.geb-dach-chevron');
  if (!rows) return;
  rows.style.display = wasOpen ? 'none' : '';
  chevron?.classList.toggle('rotated', wasOpen); // rotated = closed
};

// Wenn SLP im Leistungsschätzung-Reiter ändert: kW-Schätzung, Formel & Badge live aktualisieren
window.updateGebVerbrSlp = function(gId, slpId) {
  const g   = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  const fl     = parseFloat(g.flaeche) || 0;
  const wpm2   = getElSlpWpm2(slpId);
  const autoKw = fl > 0 ? Math.round(fl * wpm2 / 1000 * 10) / 10 : null;
  const kwInp  = document.getElementById(`geb-verbr-kw-${gId}`);
  if (kwInp && autoKw != null) kwInp.value = autoKw;
  // Formel-Zeile live nachziehen
  const formel = document.getElementById(`geb-verbr-formel-${gId}`);
  if (formel && fl > 0) {
    formel.innerHTML = `↳ ${Math.round(fl)} m² × <a data-click="openElSlpManager(${gId})" title="W/m²-Annahmen verwalten / Profile hinzufügen" style="color:#4fc3f7;cursor:pointer;text-decoration:underline dotted;">${wpm2} W/m²</a> ÷ 1000 = ${autoKw} kW (${slpId})`;
  }
  // Badge live nachziehen (zeigt die aktuelle Schätzung)
  const badge = document.getElementById(`geb-verbr-badge-${gId}`);
  if (badge && autoKw != null) badge.textContent = '~' + autoKw + ' kW';
};

// W/m²-Annahmen verwalten — öffnet das SLP-Registry-Modal; nach Schließen Karte neu rendern,
// damit geänderte W/m²-Werte in Schätzung, Formel & Badge durchschlagen.
window.openElSlpManager = function(gId) {
  showElSlpModal(() => { if (gId != null) _rerenderCard(gId); });
};

// Werte aus Leistungsschätzung in Verbraucher-Asset schreiben
window.overwriteVerbrAsset = function(gId) {
  const verbr = getAssetsForBuilding(gId).find(a => a.type === 'Verbraucher');
  if (!verbr) { alert('Kein Verbraucher-Asset für dieses Gebäude gefunden.'); return; }
  const slpSel = document.getElementById(`geb-verbr-slp-${gId}`);
  const kwInp  = document.getElementById(`geb-verbr-kw-${gId}`);
  const slp    = slpSel?.value || 'G0';
  const kw     = parseFloat(kwInp?.value);
  if (!verbr.props) verbr.props = {};
  verbr.props.slpTyp    = slp;
  verbr.props.leistungKW = isNaN(kw) ? null : kw;
  _rerenderCard(gId);
};

// Berechnetes kWp (Dach & PV) in PV-Asset schreiben (inkl. Ausrichtung + Spez)
window.overwritePvAsset = function(gId) {
  const g  = window.gebaeude?.find(x => x.id === gId);
  const pv = getAssetsForBuilding(gId).find(a => a.type === 'PV');
  if (!pv || !g) { alert('Kein PV-Asset für dieses Gebäude gefunden.'); return; }
  const kwp = calcGebKwpKorr(g);
  if (!pv.props) pv.props = {};
  pv.props.leistungKWp = Math.round(kwp * 10) / 10;
  // Ausrichtung ableiten: Flachdach nach pvFlAusrichtung, Satteldach nach First-Richtung
  let aus = 'sued';
  if (g.dachform === 'sattel') {
    const A = g.dachAzimut ?? 180;
    const devEW = Math.min(Math.abs(A - 90), Math.abs(A - 270));
    aus = devEW <= 45 ? 'ostwest' : 'sued';
  } else if (!g.dachform || g.dachform === 'flach') {
    aus = g.pvFlAusrichtung === 'ostwest' ? 'ostwest' : 'sued';
  }
  pv.props.ausrichtung = aus;
  pv.props.pvSpez      = aus === 'ostwest' ? 950 : 1050;
  _rerenderCard(gId);
};

// ══════════════════════════════════════════════════════════════════════════════
// PV-ÜBERSICHT — Abgleich „gezeichnete Fläche" ↔ „kWp im PV-Asset"
// Fängt den häufigen Bruch ab: Belegungsfläche gezeichnet (Module platziert), aber
// das kWp nie ins PV-Asset übernommen → Anlage zählt in keiner Analyse mit.
// ══════════════════════════════════════════════════════════════════════════════
let _pvuPanelOpen = false;

// Bestandsaufnahme aller Dach-PV-Gebäude + Freiflächen.
function _pvuScan() {
  const gs = window.gebaeude || [];
  const dach = [];
  for (const g of gs) {
    const hasBel   = _hasBelegung(g);
    const pv       = getAssetsForBuilding(g.id).find(a => a.type === 'PV');
    const assetKwp = pv ? (parseFloat(pv.props?.leistungKWp) || 0) : null;
    if (!hasBel && assetKwp == null) continue;            // weder Fläche noch Asset
    const mods  = hasBel ? getGebPvModules(g).count : 0;
    const drawn = hasBel ? (calcGebKwpKorr(g) || 0) : 0;
    let status;
    if      (hasBel && pv == null)                              status = 'fehlt';
    else if (hasBel && Math.abs((assetKwp || 0) - drawn) > 0.5) status = 'abweichend';
    else if (!hasBel && assetKwp != null)                       status = 'assetOhneFlaeche';
    else                                                        status = 'ok';
    dach.push({ id: g.id, name: g.name || ('#' + g.id), modus: g.pvModus || 'dachanteil',
                hasBel, mods, drawn: Math.round(drawn * 10) / 10, assetKwp, status });
  }
  const frei = (window.freiflaechen || []).map((ff, i) => ({
    name: ff.name || ('Freifläche ' + (i + 1)),
    mods: ff._pvModCount || 0,
    kwp:  Math.round((parseFloat(ff.leistungKWp) || 0) * 10) / 10,
  }));
  return { dach, frei };
}

// Fehlendes PV-Asset für ein Gebäude im Polygon-Schwerpunkt anlegen.
function _pvuEnsurePvAsset(g) {
  let pv = getAssetsForBuilding(g.id).find(a => a.type === 'PV');
  if (!pv && g.polygon && g.polygon.length >= 3) {
    const c = polygonCenter(g.polygon);
    pv = createAsset('PV', c.lat, c.lng, { buildingId: g.id, name: 'PV ' + (g.name || g.id), props: {} });
  }
  return pv;
}

// Ein Gebäude angleichen (Asset ggf. anlegen + kWp übernehmen).
window.pvuFixOne = function(gId) {
  const g = (window.gebaeude || []).find(x => x.id === gId);
  if (!g) return;
  if (!_pvuEnsurePvAsset(g)) { alert('Kein PV-Asset anlegbar (Gebäude ohne Polygon).'); return; }
  window.overwritePvAsset(gId);
  if (typeof recalcStromNetz === 'function') recalcStromNetz();
  if (typeof redrawAllAssets === 'function') redrawAllAssets();
  pvuRender();
};

// Gebäude auf der Karte fokussieren.
window.pvuFocus = function(gId) {
  if (typeof flyTo === 'function') flyTo(gId);
};

// Alle abweichenden/fehlenden Gebäude in einem Rutsch angleichen.
export function pvuUebernehmenAlle() {
  const todo = _pvuScan().dach.filter(d => d.status === 'fehlt' || d.status === 'abweichend');
  if (!todo.length) { alert('Alle gezeichneten PV-Flächen sind bereits als Leistung übernommen.'); return; }
  if (!confirm(`${todo.length} Gebäude angleichen?\nkWp aus der gezeichneten Fläche ins PV-Asset schreiben, fehlende PV-Assets anlegen.`)) return;
  let created = 0, updated = 0;
  for (const d of todo) {
    const g = (window.gebaeude || []).find(x => x.id === d.id);
    if (!g) continue;
    const had = !!getAssetsForBuilding(g.id).find(a => a.type === 'PV');
    if (!_pvuEnsurePvAsset(g)) continue;
    if (!had) created++;
    window.overwritePvAsset(g.id);
    updated++;
  }
  if (typeof recalcStromNetz === 'function') recalcStromNetz();
  if (typeof redrawAllAssets === 'function') redrawAllAssets();
  pvuRender();
  alert(`${updated} PV-Assets aktualisiert (${created} neu angelegt).`);
}

// PV-Assets ohne gezeichnete Belegungsfläche entfernen (Karteileichen aus
// gelöschten Flächen oder versehentlich angelegte Anlagen).
export function pvuLoescheAssetsOhneFlaeche() {
  const todo = _pvuScan().dach.filter(d => d.status === 'assetOhneFlaeche');
  if (!todo.length) { alert('Keine PV-Assets ohne gezeichnete Fläche vorhanden.'); return; }
  if (!confirm(`${todo.length} PV-Asset(s) ohne gezeichnete Fläche löschen?\nEs werden nur PV-Anlagen ohne Belegungsfläche entfernt — gezeichnete Flächen bleiben unberührt.`)) return;
  let del = 0;
  for (const d of todo) {
    const pv = getAssetsForBuilding(d.id).find(a => a.type === 'PV');
    if (pv && deleteAsset(pv.id)) del++;
  }
  if (typeof recalcStromNetz === 'function') recalcStromNetz();
  if (typeof redrawAllAssets === 'function') redrawAllAssets();
  pvuRender();
  alert(`${del} PV-Asset(s) ohne Fläche gelöscht.`);
}

export function pvuTogglePanel() {
  _pvuPanelOpen = !_pvuPanelOpen;
  const panel = document.getElementById('pv-uebersicht-panel');
  const btn   = document.getElementById('btn-pv-uebersicht-toggle');
  if (!panel) return;
  panel.style.display = _pvuPanelOpen ? 'block' : 'none';
  btn?.classList.toggle('active', _pvuPanelOpen);
  if (_pvuPanelOpen) pvuRender();
}

export function pvuRender() {
  const el = document.getElementById('pv-uebersicht-content');
  if (!el) return;
  const { dach, frei } = _pvuScan();
  const sumDrawn  = dach.reduce((s, d) => s + (d.drawn || 0), 0);
  const sumAsset  = dach.reduce((s, d) => s + (d.assetKwp || 0), 0);
  const sumFrei   = frei.reduce((s, f) => s + (f.kwp || 0), 0);
  const offen     = dach.filter(d => d.status === 'fehlt' || d.status === 'abweichend');
  const ohneFl    = dach.filter(d => d.status === 'assetOhneFlaeche');

  const STAT = {
    ok:               { txt: '✓ ok',          col: '#66bb6a' },
    abweichend:       { txt: '⚠ abweichend',   col: '#ffa726' },
    fehlt:            { txt: '⛔ kein Asset',   col: '#ef5350' },
    assetOhneFlaeche: { txt: 'ⓘ ohne Fläche',  col: '#90a4ae' },
  };
  const rowHtml = d => {
    const s = STAT[d.status] || STAT.ok;
    const act = (d.status === 'fehlt' || d.status === 'abweichend')
      ? `<button onclick="pvuFixOne(${d.id})" title="kWp übernehmen (Asset ggf. anlegen)"
           style="padding:1px 6px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:9px;
                  border:1px solid #ffd54f;color:#ffd54f;background:rgba(255,213,79,.08);">übernehmen</button>`
      : '';
    return `<div style="display:grid;grid-template-columns:1.4fr .5fr .6fr .6fr .9fr;gap:4px;align-items:center;
         padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:10px;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;color:#cfd8dc;"
            title="${d.name} — auf Karte zeigen" onclick="pvuFocus(${d.id})">${d.name}</span>
      <span style="text-align:right;color:var(--muted);">${d.mods || '—'}</span>
      <span style="text-align:right;color:#ffd54f;">${d.hasBel ? d.drawn.toLocaleString('de-DE') : '—'}</span>
      <span style="text-align:right;color:${d.assetKwp == null ? '#ef5350' : '#cfd8dc'};">${d.assetKwp == null ? '—' : d.assetKwp.toLocaleString('de-DE')}</span>
      <span style="text-align:right;color:${s.col};display:flex;gap:4px;justify-content:flex-end;align-items:center;">${s.txt}${act ? ' ' + act : ''}</span>
    </div>`;
  };

  el.innerHTML = `
  <div style="background:var(--surface2);border-radius:6px;padding:8px;margin-bottom:8px;
       display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center;">
    <div><div style="font-size:15px;font-weight:700;color:#ffd54f;">${sumDrawn.toFixed(0)}</div>
         <div style="font-size:9px;color:var(--muted);">kWp gezeichnet</div></div>
    <div><div style="font-size:15px;font-weight:700;color:#cfd8dc;">${sumAsset.toFixed(0)}</div>
         <div style="font-size:9px;color:var(--muted);">kWp in Assets</div></div>
    <div><div style="font-size:15px;font-weight:700;color:${offen.length ? '#ffa726' : '#66bb6a'};">${offen.length}</div>
         <div style="font-size:9px;color:var(--muted);">zu übernehmen</div></div>
  </div>
  ${offen.length ? `<button onclick="pvuUebernehmenAlle()"
      style="width:100%;padding:6px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:600;
             border:1px solid #ffd54f;color:#ffd54f;background:rgba(255,213,79,.08);margin-bottom:8px;">
      ☀ Alle ${offen.length} übernehmen (fehlende Assets anlegen)</button>` : ''}
  ${ohneFl.length ? `<button onclick="pvuLoescheAssetsOhneFlaeche()"
      title="PV-Assets entfernen, denen keine gezeichnete Belegungsfläche zugrunde liegt"
      style="width:100%;padding:6px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:600;
             border:1px solid #ef5350;color:#ef5350;background:rgba(239,83,80,.06);margin-bottom:8px;">
      🗑 ${ohneFl.length} PV-Asset(s) ohne Fläche löschen</button>` : ''}
  ${dach.length ? `
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px;">Dach-PV (${dach.length})</div>
    <div style="display:grid;grid-template-columns:1.4fr .5fr .6fr .6fr .9fr;gap:4px;font-size:9px;color:var(--muted);padding-bottom:2px;border-bottom:1px solid rgba(255,255,255,.1);">
      <span>Gebäude</span><span style="text-align:right;">Mod.</span><span style="text-align:right;">gez.</span><span style="text-align:right;">Asset</span><span style="text-align:right;">Status</span>
    </div>
    ${dach.map(rowHtml).join('')}` : '<div style="font-size:10px;color:var(--muted);">Keine Dach-PV-Flächen gezeichnet.</div>'}
  ${frei.length ? `
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:10px 0 2px;">Freiflächen-PV (${frei.length}) · Σ ${sumFrei.toFixed(0)} kWp</div>
    ${frei.map(f => `<div style="display:flex;justify-content:space-between;font-size:10px;color:#cfd8dc;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05);">
      <span>${f.name}</span><span style="color:#ffd54f;">${f.kwp.toLocaleString('de-DE')} kWp · ${f.mods} Mod.</span></div>`).join('')}` : ''}
  <div style="font-size:9px;color:var(--muted);margin-top:8px;line-height:1.4;">
    „gezeichnet" = kWp aus den platzierten Modulen · „Asset" = aktueller Wert im PV-Asset (treibt alle Analysen).
    Abweichungen entstehen, wenn nach dem Zeichnen „kWp übernehmen" vergessen wurde.
  </div>`;
}

// ── Nutzungstypen-Dropdown & Modal ──────────────────────────────────────────
function _buildNutzungOptions(current) {
  const typen = getNutzungstypen();
  // Nach Gruppe sortiert
  const gruppen = [...new Set(typen.map(t => t.gruppe))];
  return gruppen.map(g => {
    const items = typen.filter(t => t.gruppe === g);
    return `<optgroup label="${g}">
      ${items.map(t =>
        `<option value="${t.id}"${current === t.id ? ' selected' : ''}>${t.label}</option>`
      ).join('')}
    </optgroup>`;
  }).join('');
}

// Dynamisch aus Registry — wird beim Rendern aufgerufen, erfasst auch zukünftige Profile
function _slpOpts(currentSlp) {
  return getElSlpProfiles().map(p =>
    `<option value="${p.id}"${(currentSlp||'G0')===p.id?' selected':''}>${p.id} — ${p.label}</option>`
  ).join('');
}

window.showNutzungstypenModal = function() {
  document.getElementById('nutzungstypen-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'nutzungstypen-modal';
  modal.className = 'ep-modal-overlay';
  modal.innerHTML = _renderNutzungstypenModal();
  document.body.appendChild(modal);

  _wireNutzungstypenModal(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
};

function _renderNutzungstypenModal(editId = null, formData = null) {
  const typen   = getNutzungstypen();
  const builtin = typen.filter(t => isBuiltinNutzungstyp(t.id));
  const custom  = typen.filter(t => !isBuiltinNutzungstyp(t.id));

  const rowHtml = (t, editable) => `
    <tr data-nt-id="${t.id}">
      <td style="color:var(--muted);font-family:'DM Mono',monospace;">${t.id}</td>
      <td>${escHtml(t.label)}</td>
      <td>${escHtml(t.gruppe)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">${t.spezStrom}</td>
      <td style="text-align:center;">${t.slp}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;">${t.vbh}</td>
      <td style="white-space:nowrap;">
        ${editable
          ? `<button class="btn-xs nt-edit-btn" data-nt-id="${t.id}" title="Bearbeiten">✎</button>
             <button class="btn-xs red nt-del-btn" data-nt-id="${t.id}" title="Löschen">🗑</button>`
          : `<span style="font-size:9px;color:var(--muted);">Standard</span>`}
      </td>
    </tr>`;

  const formHtml = (data = {}) => `
    <tr id="nt-form-row">
      <td><input class="inp-field" id="nt-f-id"    value="${escHtml(data.id||'')}"    placeholder="bw_kaserne" style="width:100%;font-size:10px;" ${data.id && isBuiltinNutzungstyp(data.id) ? 'readonly' : ''}></td>
      <td><input class="inp-field" id="nt-f-label" value="${escHtml(data.label||'')}" placeholder="Kaserne (BW)" style="width:100%;font-size:10px;"></td>
      <td><input class="inp-field" id="nt-f-gruppe" value="${escHtml(data.gruppe||'')}" placeholder="Bundeswehr" style="width:100%;font-size:10px;"></td>
      <td><input class="inp-field" id="nt-f-spez"  value="${data.spezStrom??''}"      placeholder="55" type="number" style="width:60px;font-size:10px;"></td>
      <td><select class="inp-field" id="nt-f-slp" style="font-size:10px;padding:2px 4px;">
        ${_slpOpts(data.slp)}
      </select></td>
      <td><input class="inp-field" id="nt-f-vbh"   value="${data.vbh??''}"           placeholder="2500" type="number" style="width:60px;font-size:10px;"></td>
      <td style="white-space:nowrap;">
        <button class="btn-xs green" id="nt-save-btn">✓</button>
        <button class="btn-xs" id="nt-cancel-btn">✕</button>
      </td>
    </tr>`;

  return `<div class="ep-modal" style="min-width:560px;max-width:700px;">
    <div class="ep-modal-title">⚙ Nutzungstypen verwalten</div>
    <div style="overflow-y:auto;max-height:420px;">
      <table class="nt-table" id="nt-table">
        <thead><tr>
          <th>Kennung</th><th>Bezeichnung</th><th>Gruppe</th>
          <th class="r">kWh/m²a</th><th style="text-align:center;">SLP</th>
          <th class="r">Vh/a</th><th></th>
        </tr></thead>
        <tbody id="nt-tbody">
          <tr class="nt-section-hdr"><td colspan="7">Standard-Typen</td></tr>
          ${builtin.map(t => rowHtml(t, false)).join('')}
          <tr class="nt-section-hdr"><td colspan="7">Eigene Typen</td></tr>
          ${custom.map(t => rowHtml(t, true)).join('')}
          ${custom.length === 0 ? `<tr><td colspan="7" class="nt-empty">Keine eigenen Typen angelegt.</td></tr>` : ''}
          ${editId ? formHtml(formData) : ''}
        </tbody>
      </table>
    </div>
    <div class="ep-modal-btns" style="margin-top:10px;justify-content:space-between;">
      <button class="ep-modal-btn" id="nt-add-btn">+ Neuen Typ</button>
      <button class="ep-modal-btn primary" id="nt-close-btn">Schließen</button>
    </div>
  </div>`;
}

function _wireNutzungstypenModal(modal) {
  const refresh = (editId, formData) => {
    modal.innerHTML = _renderNutzungstypenModal(editId, formData);
    _wireNutzungstypenModal(modal);
  };

  modal.querySelector('#nt-close-btn')?.addEventListener('click', () => modal.remove());

  modal.querySelector('#nt-add-btn')?.addEventListener('click', () =>
    refresh('__new__', { id:'', label:'', gruppe:'', spezStrom:'', slp:'G0', vbh:'' }));

  modal.querySelectorAll('.nt-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = getNutzungstypById(btn.dataset.ntId);
      if (t) refresh(t.id, { ...t });
    });
  });

  modal.querySelectorAll('.nt-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = NUTZUNGSTYPEN_CUSTOM.findIndex(t => t.id === btn.dataset.ntId);
      if (idx >= 0) NUTZUNGSTYPEN_CUSTOM.splice(idx, 1);
      refresh();
      renderList(); // Dropdowns in Karten aktualisieren
    });
  });

  modal.querySelector('#nt-save-btn')?.addEventListener('click', () => {
    const id     = modal.querySelector('#nt-f-id')?.value.trim().replace(/\s+/g,'_');
    const label  = modal.querySelector('#nt-f-label')?.value.trim();
    const gruppe = modal.querySelector('#nt-f-gruppe')?.value.trim() || 'Eigene';
    const spez   = parseFloat(modal.querySelector('#nt-f-spez')?.value);
    const slp    = modal.querySelector('#nt-f-slp')?.value;
    const vbh    = parseInt(modal.querySelector('#nt-f-vbh')?.value);

    if (!id || !label || isNaN(spez) || isNaN(vbh)) {
      alert('Bitte alle Felder ausfüllen (Kennung, Bezeichnung, kWh/m²a, Vh/a).'); return;
    }
    if (isBuiltinNutzungstyp(id)) { alert('Diese Kennung ist ein Standard-Typ und kann nicht überschrieben werden.'); return; }

    const existing = NUTZUNGSTYPEN_CUSTOM.findIndex(t => t.id === id);
    const entry = { id, label, gruppe, spezStrom: spez, slp, vbh };
    if (existing >= 0) NUTZUNGSTYPEN_CUSTOM[existing] = entry;
    else NUTZUNGSTYPEN_CUSTOM.push(entry);

    refresh();
    renderList();
  });

  modal.querySelector('#nt-cancel-btn')?.addEventListener('click', () => refresh());
}

// ── Dach & PV Sektion im Gebäude-Panel (eingeklappt) ────────────────────────
if (!window._gebDachCollapsed) window._gebDachCollapsed = {};

const DACHFORM_LABELS = { flach: 'Flachdach', sattel: 'Satteldach', walm: 'Walmdach', pult: 'Pultdach' };
const AZIMUT_HINT = '0°=Nord · 90°=Ost · 180°=Süd · 270°=West';

function buildDachSection(g, opts = {}) {
  const isOpen    = !window._gebDachCollapsed[g.id];
  const dachform  = g.dachform  || 'sattel';
  const azimut    = g.dachAzimut  ?? '';
  const neigung   = g.dachNeigung ?? '';
  const defNei    = getDachDefaultNeigung(dachform);
  const kwpBase   = calcGebKwp(g);
  const kwpKorr   = calcGebKwpKorr(g);
  // Anzeige-Faktor konsistent zur korrigierten kWp (deckt auch den Satteldach-
  // Zweiseiten-Mittelwert ab), Fallback auf den reinen Azimut/Neigungs-Faktor.
  const korrFak   = kwpBase > 0 ? kwpKorr / kwpBase : getPvKorrFaktor(g);
  const hasPoly   = !!(g.polygon && g.polygon.length >= 3);

  // Korrekturfaktor-Farbe
  const fakCol = korrFak >= 0.9 ? '#4caf50' : korrFak >= 0.75 ? '#f9a825' : '#e53935';

  const azimutField = `
    <div class="inp-group">
      <div class="inp-label" title="${AZIMUT_HINT}">Ausrichtung (°) <span style="opacity:.5;cursor:help;">ℹ</span></div>
      <div style="display:flex;gap:4px;">
        <input class="inp-field" type="number" min="0" max="359"
          value="${escVal(azimut)}" placeholder="${g.dachAutoAzimut ? 'auto' : '180'}"
          data-input="updateGebDach(${g.id},'dachAzimut',this.value)"
          style="flex:1;"/>
        ${hasPoly
          ? `<button class="btn-xs" title="Aus Polygon-Längsachse ermitteln"
               data-click="ermittleAzimut(${g.id})">🔄</button>`
          : ''}
      </div>
      ${g.dachAutoAzimut
        ? `<div style="font-size:8px;color:var(--muted);margin-top:2px;">↳ auto (Polygon)</div>`
        : ''}
    </div>`;

  const pvAsset = opts.showPvBtn
    ? getAssetsForBuilding(g.id).find(a => a.type === 'PV')
    : null;
  const pvOverwriteBtn = (pvAsset && kwpKorr > 0) ? `
    <button class="btn-xs" style="width:100%;margin-top:5px;display:flex;justify-content:center;gap:4px;border-color:#ffd54f;color:#ffd54f;"
      data-click="overwritePvAsset(${g.id})">
      ☀ ${kwpKorr.toFixed(1)} kWp → PV-Asset überschreiben
    </button>` : '';

  const modus = g.pvModus || 'pauschal';

  // ── Modus-Umschalter: Pauschal (Dachanteil) vs. Flächen zeichnen ──────────
  const modeToggle = `
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button class="btn-xs" style="flex:1;${modus==='pauschal'?'border-color:var(--accent);color:var(--accent);background:rgba(79,195,247,0.08);':''}"
        data-click="setGebPvModus(${g.id},'pauschal')">⊞ Pauschal</button>
      <button class="btn-xs" style="flex:1;${modus==='flaechen'?'border-color:#ffd54f;color:#ffd54f;background:rgba(255,213,79,0.08);':''}"
        data-click="setGebPvModus(${g.id},'flaechen')">✎ Flächen zeichnen</button>
    </div>`;

  // ── PAUSCHAL: Neigung + Dachanteil% + Basis/Faktor/Korr ───────────────────
  const pauschalUI = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:4px;">
      <div class="inp-group">
        <div class="inp-label">Neigung (°)</div>
        <input class="inp-field" type="number" min="0" max="75"
          value="${escVal(neigung)}" placeholder="${defNei}"
          data-input="updateGebDach(${g.id},'dachNeigung',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Dachanteil PV (%)</div>
        <input class="inp-field" type="number" min="5" max="100" step="5"
          value="${g.pvDachanteil || 30}"
          data-input="updateGebPv(${g.id},'pvDachanteil',this.value)"/>
      </div>
    </div>
    ${g.flaeche ? `
    <div class="geb-dach-kwp-row">
      <span>☀ Basis</span><span>${kwpBase.toFixed(1)} kWp</span>
      <span>Faktor</span>
      <span style="color:${fakCol};font-weight:600;">${(korrFak * 100).toFixed(0)} %</span>
      <span style="font-weight:600;">= Korr.</span>
      <span style="color:${fakCol};font-weight:600;">${kwpKorr.toFixed(1)} kWp</span>
    </div>
    ${pvOverwriteBtn}` : ''}`;

  // ── FLÄCHEN: Belegungs-/Sperrflächen zeichnen (Phase 1+2) ─────────────────
  const flGcr = g.pvFlGcr != null ? g.pvFlGcr : (g.pvFlAusrichtung === 'ostwest' ? 85 : 40);
  const flList = (g.pvFlaechen || []).map(fl => {
    const isB = fl.typ !== 'sperr';
    return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:2px 0;">
      <span style="color:${isB ? '#ffd54f' : '#e53935'};">${isB ? '☀' : '⛔'}</span>
      <span style="flex:1;">${isB ? 'Belegung' : 'Sperrfläche'}</span>
      <span style="font-family:'DM Mono',monospace;color:var(--muted);">${(fl.flaeche || 0).toFixed(0)} m²</span>
      <button class="btn-xs red" data-click="removeGebPvFlaeche(${g.id},${fl.id})" title="Entfernen">✕</button>
    </div>`;
  }).join('');
  const netto = pvNettoFlaeche(g);
  const _modRes  = (g.pvModus === 'flaechen' && _hasBelegung(g)) ? getGebPvModules(g) : null;
  const modCount = _modRes ? _modRes.count : 0;
  const isPitched = !!(g.dachform && g.dachform !== 'flach');
  const isSattel  = g.dachform === 'sattel';
  const splitTxt  = (isSattel && _modRes && _modRes.frontCount != null)
    ? ` · 2-seitig ${_modRes.frontCount}/${_modRes.backCount}` : '';
  const flBeleg = g.pvFlBelegung != null ? g.pvFlBelegung : 90;
  const usedNei = g.dachNeigung != null ? g.dachNeigung : defNei;

  // Steuerelemente je Dachform: Flachdach = GCR + Aufständerung · Schrägdach = Belegungsgrad
  const usedAz = g.dachAzimut ?? 180;
  const flaechenControls = isPitched ? `
    <div style="font-size:9px;color:var(--muted);margin-top:6px;">${isSattel ? 'Ganze Dachfläche zeichnen — wird automatisch am First in zwei Seiten (Azimut + Gegenseite) geteilt. ' : 'Dachfläche je Dachseite zeichnen. '}Module liegen parallel zum Dach; Grundriss wird mit 1/cos(Neigung) auf die echte Dachfläche projiziert. Rand (0,3 m) bleibt frei.</div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;">
      <div class="inp-group">
        <div class="inp-label" title="Anteil der Dachfläche, der mit Modulen belegt wird (Ränder/Rahmen abgezogen)">Belegungsgrad (%)</div>
        <div style="display:flex;align-items:center;gap:5px;padding:2px 0;">
          <input type="range" min="40" max="100" step="5" value="${flBeleg}"
            style="flex:1;cursor:pointer;accent-color:#ffd54f;height:4px;"
            oninput="this.nextElementSibling.textContent=this.value+'%'"
            data-change="updateGebPvFl(${g.id},'belegung',this.value)"/>
          <span style="min-width:30px;text-align:right;font-size:11px;color:#ffd54f;font-weight:600;">${flBeleg}%</span>
        </div>
      </div>
      <div class="inp-group">
        <div class="inp-label" title="Neigung der Dachfläche in Grad">Neigung (°)</div>
        <div style="display:flex;align-items:center;gap:5px;padding:2px 0;">
          <input type="range" min="5" max="75" step="5" value="${usedNei}"
            style="flex:1;cursor:pointer;accent-color:#80deea;height:4px;"
            oninput="this.nextElementSibling.textContent=this.value+'°'"
            data-change="updateGebDach(${g.id},'dachNeigung',this.value)"/>
          <span style="min-width:28px;text-align:right;font-size:11px;color:#80deea;font-weight:600;">${usedNei}°</span>
        </div>
      </div>
      <div class="inp-group">
        <div class="inp-label" title="Ausrichtung der Südseite in Grad (0=Nord, 180=Süd, 90=Ost)">Azimut (°)</div>
        <div style="display:flex;align-items:center;gap:5px;padding:2px 0;">
          <input type="range" min="0" max="355" step="5" value="${usedAz}"
            style="flex:1;cursor:pointer;accent-color:#ef9a9a;height:4px;"
            oninput="this.nextElementSibling.textContent=this.value+'°'"
            data-change="updateGebDach(${g.id},'dachAzimut',this.value)"/>
          <span style="min-width:28px;text-align:right;font-size:11px;color:#ef9a9a;font-weight:600;">${usedAz}°</span>
        </div>
      </div>
      ${isSattel ? `
      <div style="display:flex;align-items:center;gap:4px;">
        <button class="btn-xs" style="flex:1;" data-click="startGebFirstDraw(${g.id})" title="Firstlinie auf dem Satellitenbild nachzeichnen (2 Klicks) — nötig bei schiefen/asymmetrischen Grundrissen">📐 First neu zeichnen</button>
        ${g.pvRidgeOverride ? `<button class="btn-xs" data-click="resetGebFirst(${g.id})" title="First zurück auf automatische Mitte">↺</button>` : ''}
      </div>
      ${g.pvRidgeOverride ? '<div style="font-size:9px;color:#ffd54f;">First manuell gesetzt.</div>' : ''}` : ''}
    </div>` : `
    <div style="font-size:9px;color:var(--muted);margin-top:6px;">Belegbare Dachflächen zeichnen (Satellit), Sperrflächen für Kamine/Gauben/Verschattung abziehen. Rand (0,3 m) bleibt frei; Ost-West-Aufständerung rechnet mit ~90 % Ertragsfaktor.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;">
      <div class="inp-group">
        <div class="inp-label" title="Ground Coverage Ratio: Anteil Modulfläche an gezeichneter Fläche">GCR (% Belegung)</div>
        <div style="display:flex;align-items:center;gap:5px;padding:2px 0;">
          <input type="range" min="5" max="95" step="5" value="${flGcr}"
            style="flex:1;cursor:pointer;accent-color:#ffd54f;height:4px;"
            oninput="this.nextElementSibling.textContent=this.value+'%'"
            data-change="updateGebPvFl(${g.id},'gcr',this.value)"/>
          <span style="min-width:30px;text-align:right;font-size:11px;color:#ffd54f;font-weight:600;">${flGcr}%</span>
        </div>
      </div>
      <div class="inp-group">
        <div class="inp-label">Aufständerung</div>
        <select class="inp-field" data-change="updateGebPvFl(${g.id},'ausrichtung',this.value)">
          <option value="sued" ${g.pvFlAusrichtung!=='ostwest'?'selected':''}>Süd</option>
          <option value="ostwest" ${g.pvFlAusrichtung==='ostwest'?'selected':''}>Ost-West</option>
        </select>
      </div>
    </div>`;

  // Ergebnis-Zeile: Schrägdach zeigt Ertragsfaktor (Azimut/Neigung), Flachdach nicht (=1)
  const flResult = netto > 0 ? (isPitched ? `
    <div class="geb-dach-kwp-row">
      <span>${modCount} Mod.${splitTxt}</span><span>${kwpBase.toFixed(1)} kWp</span>
      <span>Faktor</span><span style="color:${fakCol};font-weight:600;">${(korrFak * 100).toFixed(0)} %</span>
      <span style="font-weight:600;">= Korr.</span><span style="color:${fakCol};font-weight:600;">${kwpKorr.toFixed(1)} kWp</span>
    </div>
    ${pvOverwriteBtn}` : `
    <div class="geb-dach-kwp-row">
      <span>${modCount} Module</span><span>${netto.toFixed(0)} m²</span>
      <span>GCR</span><span style="font-weight:600;">${flGcr} %</span>
      <span style="font-weight:600;">= PV</span><span style="color:#ffd54f;font-weight:600;">${kwpKorr.toFixed(1)} kWp</span>
    </div>
    ${pvOverwriteBtn}`) : '';

  const flaechenUI = `
    ${flaechenControls}
    <div style="display:flex;gap:4px;margin-top:5px;">
      <button class="btn-xs" style="flex:1;border-color:#ffd54f;color:#ffd54f;" data-click="startGebPvDraw(${g.id},'belegung')">☀ + Belegungsfläche</button>
      <button class="btn-xs red" style="flex:1;" data-click="startGebPvDraw(${g.id},'sperr')">⛔ + Sperrfläche</button>
    </div>
    ${flList ? `<div style="margin-top:6px;padding:5px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);">${flList}</div>` : '<div style="font-size:9px;color:var(--muted);margin-top:6px;text-align:center;">Noch keine Fläche gezeichnet.</div>'}
    ${flResult}`;

  return `
    <div class="geb-dach-section">
      <div class="geb-dach-hdr" data-click="toggleGebDach(${g.id})">
        <span class="geb-dach-hdr-icon">☀</span>
        <span class="geb-dach-hdr-label">Dach &amp; PV</span>
        <span class="geb-dach-kwp-badge">${kwpKorr > 0 ? kwpKorr.toFixed(1) + ' kWp' : '—'}</span>
        <span class="geb-dach-chevron${isOpen ? '' : ' rotated'}">▾</span>
      </div>
      <div class="geb-dach-rows" id="geb-dach-rows-${g.id}"${isOpen ? '' : ' style="display:none;"'}>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:4px;">
          <div class="inp-group">
            <div class="inp-label">Dachform</div>
            <select class="inp-field" data-change="updateGebDach(${g.id},'dachform',this.value)">
              ${Object.entries(DACHFORM_LABELS).map(([v,l]) =>
                `<option value="${v}"${dachform===v?' selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          ${azimutField}
        </div>
        ${modeToggle}
        ${modus === 'flaechen' ? flaechenUI : pauschalUI}
      </div>
    </div>`;
}

window.toggleGebDach = function(gId) {
  window._gebDachCollapsed[gId] = !window._gebDachCollapsed[gId];
  const rows    = document.getElementById(`geb-dach-rows-${gId}`);
  const chevron = rows?.previousElementSibling?.querySelector('.geb-dach-chevron');
  if (!rows) return;
  rows.style.display = window._gebDachCollapsed[gId] ? 'none' : '';
  chevron?.classList.toggle('rotated', !!window._gebDachCollapsed[gId]);
};

window.updateGebDach = function(gId, field, value) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  if (field === 'dachform') {
    g.dachform = value;
    g.dachAutoAzimut = false; // Manuelle Änderung löscht Auto-Flag
    if (value !== 'sattel') delete g.pvRidgeOverride; // First-Override nur für Satteldach relevant
  } else if (field === 'dachAzimut') {
    g.dachAzimut = value === '' ? null : parseFloat(value);
    g.dachAutoAzimut = false;
  } else if (field === 'dachNeigung') {
    g.dachNeigung = value === '' ? null : parseFloat(value);
  }
  // Im Flächen-Modus beeinflussen Dachform/Neigung/Azimut Platzierung, kWp UND Profil
  if (g.pvModus === 'flaechen' && _hasBelegung(g)) { redrawGebPvModules(g); calcStromPanel(); }
  _rerenderCard(gId);
};

window.ermittleAzimut = function(gId) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g?.polygon) return;
  const az = detectRoofAzimutFromPolygon(g.polygon);
  if (az === null) return;
  g.dachAzimut     = az;
  g.dachAutoAzimut = true;
  delete g.pvRidgeOverride; // zurück auf automatische Firstlage (Schwerpunkt)
  if (g.pvModus === 'flaechen' && _hasBelegung(g)) { redrawGebPvModules(g); calcStromPanel(); }
  _rerenderCard(gId);
};

// ══════════════════════════════════════════════════════════════════════════
// GEBÄUDE-PV FLÄCHENZEICHNUNG (Phase 1: Belegung · Phase 2: Sperrflächen)
// Vereinfachte PV-Sol-Logik: statt Dachanteil-Pauschale werden die tatsächlich
// belegbaren Dachflächen (und Sperrflächen für Kamine/Gauben/Verschattung)
// direkt in den Gebäudeumriss gezeichnet. Aktuell für Flachdächer ausgelegt.
// ══════════════════════════════════════════════════════════════════════════
const GEBPV_COLORS = {
  belegung: { border: 'rgba(255,213,79,0.9)',  fill: 'rgba(255,213,79,0.18)' },
  sperr:    { border: 'rgba(229,57,53,0.9)',   fill: 'rgba(229,57,53,0.22)'  },
};

// ── PV-Pane: alle Gebäude-PV-Layer landen in einem eigenen Leaflet-Pane ────────
// z-Index 401 = knapp über overlayPane (400) → PV-Module liegen über Gebäude-
// umrissen, aber unter Markern/Labels (markerPane 600).
function _ensurePvPane() {
  if (!map.getPane('pvPane')) {
    map.createPane('pvPane').style.zIndex = '401';
  }
}

// Belegungs-/Sperrfläche als Umriss auf der Karte rendern. Die eigentlichen
// Module werden gebäudeweit von redrawGebPvModules() platziert (PV-Sol-Stil).
export function attachGebPvLayer(g, fl) {
  if (fl.layer)   { map.removeLayer(fl.layer);   fl.layer = null; }
  if (fl.svgLayer){ map.removeLayer(fl.svgLayer); fl.svgLayer = null; }
  _ensurePvPane();
  const col = GEBPV_COLORS[fl.typ] || GEBPV_COLORS.belegung;
  fl.layer = L.polygon(fl.polygon, {
    color: col.border, weight: 2,
    fillColor: col.fill, fillOpacity: fl.typ === 'sperr' ? 1 : 0.6,
    dashArray: fl.typ === 'sperr' ? '4 3' : null,
    pane: 'pvPane',
  }).addTo(map);
  fl.layer.on('click', () => { if (typeof window.selectFromMap === 'function') window.selectFromMap(g.id); });
  // Sperrflächen initial unsichtbar — updateSperrVisibility zeigt sie beim selektierten Gebäude
  if (fl.typ === 'sperr') {
    fl.layer.setStyle({ opacity: 0, fillOpacity: 0 });
  }
  applyGebPvDimming(g);   // Belegungsfläche bei abgerissenem/geplantem Gebäude ausgrauen
}

// Sperrflächen je nach aktuellem window.selectedId ein-/ausblenden.
window.updateSperrVisibility = function() {
  const selId = window.selectedId;
  (window.gebaeude || []).forEach(g => {
    const isSel = g.id === selId;
    (g.pvFlaechen || []).forEach(fl => {
      if (fl.typ === 'sperr' && fl.layer) {
        fl.layer.setStyle(isSel
          ? { opacity: 0.9, fillOpacity: 1 }
          : { opacity: 0,   fillOpacity: 0 });
      }
    });
  });
};

// PV-Anlagen global ein-/ausblenden: Pane-Display toggeln statt jedes Layer einzeln.
// Freiflächen liegen außerhalb der pvPane und werden einzeln getoggelt.
export function setPvVisible(visible) {
  window.pvVisible = visible;
  window._pvLayerVisible = visible;
  _ensurePvPane();
  const pane = map.getPane('pvPane');
  if (pane) pane.style.display = visible ? '' : 'none';
  for (const ff of (window.freiflaechen || [])) {
    [ff.polygonLayer, ff.moduleSvgLayer].forEach(l => {
      if (!l) return;
      if (visible) { if (!map.hasLayer(l)) l.addTo(map); }
      else         { if ( map.hasLayer(l)) map.removeLayer(l); }
    });
  }
  // Sperrflächen-Opazität nach Wiedereinblenden korrekt setzen
  if (visible) window.updateSperrVisibility?.();
}
window.setPvVisible = setPvVisible;


// Halbebenen-Clip im metrischen XY-Raum: behält die Seite, auf der
// (p−a)·normal ≥ 0 gilt. Baustein für den Rand-Inset unten.
function _clipHalfPlaneXY(poly, a, normal) {
  const f = p => (p.x - a.x) * normal.x + (p.y - a.y) * normal.y;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const pa = poly[i], pb = poly[(i + 1) % poly.length];
    const fa = f(pa), fb = f(pb);
    if (fa >= 0) out.push(pa);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push({ x: pa.x + t * (pb.x - pa.x), y: pa.y + t * (pb.y - pa.y) });
    }
  }
  return out;
}

// Polygon um `dist` Meter nach innen versetzen (Randabstand für Modulraster,
// z. B. Wind-/Brandschutzzonen). Schneidet für jede Kante die inwärts verschobene
// Halbebene — exakt für konvexe Polygone, bei konkaven ggf. leicht konservativ
// (kappt Einbuchtungen etwas zu früh, nie zu spät → nie mehr Module als real passen).
function _insetPolygonXY(poly, dist) {
  if (!(dist > 0) || poly.length < 3) return poly;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  let result = poly;
  for (let i = 0; i < poly.length && result.length >= 3; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (!len) continue;
    let nx = -ey / len, ny = ex / len; // Normalenkandidat, senkrecht zur Kante
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; } // Richtung zum Schwerpunkt = innen
    result = _clipHalfPlaneXY(result, { x: a.x + nx * dist, y: a.y + ny * dist }, { x: nx, y: ny });
  }
  return result;
}

// ── Punkt-in-Polygon (Ray-Casting) im metrischen XY-Raum ────────────────────
function _pip(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Schwerpunkt eines lat/lng-Polygons (arithmetisches Mittel der Ecken). */
function _polyCentroidLL(poly) {
  let lat = 0, lng = 0;
  for (const p of poly) { lat += p.lat; lng += p.lng; }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

/**
 * Klippt ein lat/lng-Polygon an der Firstlinie (durch C, senkrecht zur Falllinie
 * = Azimut A). keepFront=true → Hälfte, die in Azimut-Richtung A liegt (Vorderseite);
 * false → Rückseite (A+180). Vorzeichenfunktion in (Ost,Süd)-Metrik:
 *   f(p) = sin(A)·(lng−Clng)·cosL + cos(A)·(lat−Clat)   (>0 ⇒ Vorderseite)
 * Sutherland-Hodgman-Halbebenen-Clip. Liefert [] wenn die Hälfte leer ist.
 */
function _clipPolyHalfPlane(poly, C, azimutDeg, cosL, keepFront) {
  const A  = azimutDeg * Math.PI / 180;
  const sgn = keepFront ? 1 : -1;
  const f  = p => sgn * (Math.sin(A) * (p.lng - C.lng) * cosL + Math.cos(A) * (p.lat - C.lat));
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) });
    }
  }
  return out;
}

/**
 * Generische PV-Modulplatzierung — für Gebäudedächer UND Freiflächen.
 * Platziert reale Module als Raster über die Belegungspolygone, spart die
 * Sperrpolygone geometrisch aus und liefert die Modul-Eckpunkte im metrischen
 * Frame (Ursprung = obere/linke Bbox-Ecke) plus Bbox fürs Overlay.
 *
 * @param {Array<Array<{lat,lng}>>} belPolys   Belegungspolygone (mind. 1)
 * @param {Array<Array<{lat,lng}>>} sperrPolys Sperrpolygone (können leer sein)
 * @param {object} opts  { pitched, coverage(0..1), azimutDeg, tiltDeg, moduleW, moduleL, max, frame }
 *   frame = optionaler gemeinsamer Bezugsrahmen {minLat,maxLat,minLng,maxLng} — nötig,
 *   damit mehrere Teilflächen (z. B. zwei Satteldach-Hälften) im selben Koordinaten-
 *   system liegen und in EIN Overlay gemischt werden können.
 * @returns {{ modules: Array<{pts:Array<{x,y}>, edge:[{x,y},{x,y}]}>, count:number, bbox:object|null }}
 */
export function placePvModules(belPolys, sperrPolys, opts = {}) {
  const bel   = (belPolys   || []).filter(p => p && p.length >= 3);
  const sperr = (sperrPolys || []).filter(p => p && p.length >= 3);
  if (!bel.length) return { modules: [], count: 0, bbox: null };

  const fr = opts.frame;
  const allPts = bel.flat();
  const maxLat = fr ? fr.maxLat : Math.max(...allPts.map(p => p.lat));
  const minLat = fr ? fr.minLat : Math.min(...allPts.map(p => p.lat));
  const maxLng = fr ? fr.maxLng : Math.max(...allPts.map(p => p.lng));
  const minLng = fr ? fr.minLng : Math.min(...allPts.map(p => p.lng));
  const latRef = (maxLat + minLat) / 2;
  const cosL   = Math.cos(latRef * Math.PI / 180);
  // metrische Projektion: Ursprung oben/links, y nach unten (SVG-konform)
  const toXY = p => ({ x: (p.lng - minLng) * 111320 * cosL, y: (maxLat - p.lat) * 111320 });
  // Randabstand: Belegungsfläche vor der Rasterung um `edgeInset` Meter nach innen
  // versetzen (Wind-/Brandschutzzonen, Montagerand) — Default 0,3 m.
  const edgeInset = opts.edgeInset != null ? opts.edgeInset : 0.3;
  const belXY   = bel.map(poly => _insetPolygonXY(poly.map(toXY), edgeInset)).filter(p => p.length >= 3);
  const sperrXY = sperr.map(poly => poly.map(toXY));
  if (!belXY.length) return { modules: [], count: 0, bbox: null };

  const mb  = opts.moduleW || 1.1;
  const ml  = opts.moduleL || 1.7;
  const gap = 0.02;

  // Raster-Parameter:
  //  theta = Drehwinkel, der das Rasterkoordinatensystem ausrichtet
  //  cellW × cellD = Modul-Zellgröße im (rotierten) Grundriss · pitchX/Y = Rasterabstände
  let theta, cellW, cellD, pitchX, pitchY;
  if (opts.pitched) {
    // Schrägdach: am First ausrichten (senkrecht zur Falllinie = Azimut). Module liegen
    // flach auf der Dachhaut → Falllinien-Maß per cos(Neigung) in den Grundriss projizieren;
    // kein Reihenabstand, nur Belegungsgrad (Rahmen/Ränder).
    const tilt  = (opts.tiltDeg  != null ? opts.tiltDeg  : 35) * Math.PI / 180;
    const az    = (opts.azimutDeg != null ? opts.azimutDeg : 180) * Math.PI / 180;
    const beleg = Math.max(opts.coverage || 0.9, 0.1);
    theta  = az;                          // rot: First → x-Achse, Falllinie → y-Achse
    cellW  = mb;                          // entlang First (Modulbreite, Hochformat)
    cellD  = ml * Math.cos(tilt);         // entlang Falllinie, in Grundriss projiziert
    pitchX = cellW + gap;
    pitchY = cellD / beleg;
  } else {
    // Flach/Freifläche: am ECHTEN Kompass ausrichten (nicht an der Polygonkante).
    // x = Ost, y = Süd (metrische Projektion). Daher:
    //   Süd      → theta 0    : Reihen laufen Ost-West, Reihenabstand nach Süden
    //   Ost-West → theta 90°  : Reihen laufen Nord-Süd, Paarabstand nach Osten
    theta = opts.ausrichtung === 'ostwest' ? Math.PI / 2 : 0;
    const gcr = Math.max(opts.coverage || 0.35, 0.05);
    cellW  = ml;                          // entlang Reihe (Modullänge)
    cellD  = mb;                          // Modultiefe (Richtung Reihen-/Paarabstand)
    pitchX = cellW + gap;
    pitchY = cellD / gcr;
  }

  const cT = Math.cos(theta), sT = Math.sin(theta);
  const rot   = p => ({ x:  p.x * cT + p.y * sT, y: -p.x * sT + p.y * cT }); // um -theta
  const unrot = p => ({ x:  p.x * cT - p.y * sT, y:  p.x * sT + p.y * cT }); // um +theta
  const belR   = belXY.map(poly => poly.map(rot));
  const sperrR = sperrXY.map(poly => poly.map(rot));

  // Bbox im rotierten Frame
  let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
  for (const poly of belR) for (const p of poly) {
    if (p.x < rMinX) rMinX = p.x; if (p.x > rMaxX) rMaxX = p.x;
    if (p.y < rMinY) rMinY = p.y; if (p.y > rMaxY) rMaxY = p.y;
  }

  // Ost-West (nur flach): Shimmer-Kante reihenweise wechseln → Rücken-an-Rücken-Optik
  const owAlternate = !opts.pitched && opts.ausrichtung === 'ostwest';

  const modules = [];
  const MAX = opts.max || 12000; // Sicherheitslimit gegen Extremfälle (Performance)
  let rowIdx = 0;
  for (let y = rMinY; y + cellD <= rMaxY + 1e-6 && modules.length < MAX; y += pitchY, rowIdx++) {
    const flipEdge = owAlternate && (rowIdx % 2 === 1);
    for (let x = rMinX; x + cellW <= rMaxX + 1e-6; x += pitchX) {
      const corners = [{ x, y }, { x: x + cellW, y }, { x: x + cellW, y: y + cellD }, { x, y: y + cellD }];
      const center  = { x: x + cellW / 2, y: y + cellD / 2 };
      // muss komplett in EINEM Belegungspolygon liegen
      if (!belR.some(poly => _pip(center, poly) && corners.every(c => _pip(c, poly)))) continue;
      // darf kein Sperrpolygon berühren
      if (sperrR.some(poly => _pip(center, poly) || corners.some(c => _pip(c, poly)))) continue;
      const pts  = corners.map(unrot);          // zurück in metrischen (nicht-rotierten) Frame
      // Shimmer-Kante: Süd = obere Kante; Ost-West = abwechselnd ober/unter (Paare)
      const edge = flipEdge ? [pts[3], pts[2]] : [pts[0], pts[1]];
      modules.push({ pts, edge });
    }
  }

  return {
    modules, count: modules.length,
    bbox: { minLat, maxLat, minLng, maxLng,
            Wm: (maxLng - minLng) * 111320 * cosL, Hm: (maxLat - minLat) * 111320 },
  };
}

// SVG-Overlay (svgEl + bounds) aus einem placePvModules-Ergebnis bauen; null wenn leer.
// Gemeinsam genutzt von Gebäude-Modulen und Freiflächen.
export function buildPvModuleOverlay(res) {
  if (!res || !res.bbox || !res.modules.length) return null;
  const { Wm, Hm, minLat, maxLat, minLng, maxLng } = res.bbox;
  if (Wm <= 0 || Hm <= 0) return null;
  const modFill  = 'rgba(26,35,126,0.85)';
  const cellLine = 'rgba(140,160,220,0.55)';
  const shimmer  = 'rgba(150,170,225,0.65)';
  let shapes = '';
  for (const m of res.modules) {
    const pts = m.pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    shapes += `<polygon points="${pts}" fill="${modFill}" stroke="${cellLine}" stroke-width="0.03"/>`;
    shapes += `<line x1="${m.edge[0].x.toFixed(2)}" y1="${m.edge[0].y.toFixed(2)}" x2="${m.edge[1].x.toFixed(2)}" y2="${m.edge[1].y.toFixed(2)}" stroke="${shimmer}" stroke-width="0.12"/>`;
  }
  // Firstlinie bei Satteldach-Split: gestrichelte Linie durch den Schwerpunkt, senkrecht zum Azimut
  if (res.ridgeLine) {
    const { cx, cy, azDeg } = res.ridgeLine;
    const azR  = azDeg * Math.PI / 180;
    // Firstrichtung in SVG (x=Ost, y=Süd): senkrecht zur Falllinie
    const rdx  = Math.cos(azR), rdy = Math.sin(azR);
    const ext  = Math.max(Wm, Hm) * 0.8;
    const x1   = (cx - rdx * ext).toFixed(2), y1 = (cy - rdy * ext).toFixed(2);
    const x2   = (cx + rdx * ext).toFixed(2), y2 = (cy + rdy * ext).toFixed(2);
    shapes += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,220,80,0.85)" stroke-width="0.25" stroke-dasharray="1.2,0.8"/>`;
  }
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${Wm.toFixed(2)} ${Hm.toFixed(2)}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  svgEl.style.overflow = 'hidden';
  svgEl.innerHTML = shapes;
  return { svgEl, bounds: [[minLat, minLng], [maxLat, maxLng]] };
}

// Gebäude-Adapter: baut die placePvModules-Optionen aus dem Gebäude (Dachform etc.).
// Satteldach (Phase 4): jede Belegung wird am First in zwei Hälften (Azimut A / A+180)
// geteilt und seitenweise platziert → echte zweiseitige Dachoptik + Ertrag je Seite.
function _computeGebPvModules(g) {
  const bel   = (g.pvFlaechen || []).filter(f => f.typ === 'belegung' && f.polygon && f.polygon.length >= 3).map(f => f.polygon);
  const sperr = (g.pvFlaechen || []).filter(f => f.typ === 'sperr'    && f.polygon && f.polygon.length >= 3).map(f => f.polygon);
  const mb = parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1;
  const ml = parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7;
  const isPitched = !!(g.dachform && g.dachform !== 'flach');

  if (isPitched && g.dachform === 'sattel' && bel.length) {
    // ── First-Split: Belegung am First (durch den Schwerpunkt, senkrecht zum Azimut) teilen ──
    const A    = g.dachAzimut  != null ? g.dachAzimut  : 180;
    const tilt = g.dachNeigung != null ? g.dachNeigung : getDachDefaultNeigung('sattel');
    const beleg = (g.pvFlBelegung != null ? g.pvFlBelegung : 90) / 100;
    // Gemeinsamer Frame über die ganze Belegung (beide Hälften im selben Koordinatensystem)
    const allPts = bel.flat();
    const maxLat = Math.max(...allPts.map(p => p.lat)), minLat = Math.min(...allPts.map(p => p.lat));
    const maxLng = Math.max(...allPts.map(p => p.lng)), minLng = Math.min(...allPts.map(p => p.lng));
    const cosL   = Math.cos((maxLat + minLat) / 2 * Math.PI / 180);
    const frame  = { minLat, maxLat, minLng, maxLng };
    // Firstlinie: manuell gesetzter Punkt (First neu zeichnen) oder Schwerpunkt der
    // Belegung als Default; jede Belegung wird an dieser Linie geklippt.
    const C = g.pvRidgeOverride || _polyCentroidLL(allPts);
    const front = [], back = [];
    for (const poly of bel) {
      const fr = _clipPolyHalfPlane(poly, C, A, cosL, true);
      const bk = _clipPolyHalfPlane(poly, C, A, cosL, false);
      if (fr.length >= 3) front.push(fr);
      if (bk.length >= 3) back.push(bk);
    }
    const base = { pitched: true, tiltDeg: tilt, coverage: beleg, moduleW: mb, moduleL: ml, frame };
    const rF = placePvModules(front, sperr, { ...base, azimutDeg: A });
    const rB = placePvModules(back,  sperr, { ...base, azimutDeg: A + 180 });
    const bbox = (rF.bbox || rB.bbox);
    // Firstlinie: Schwerpunkt in SVG-Koordinaten für Overlay-Rendering
    let ridgeLine = null;
    if (bbox) {
      const { minLat: bMinLat, maxLat: bMaxLat, minLng: bMinLng } = bbox;
      const bCosL = Math.cos((bMinLat + bMaxLat) / 2 * Math.PI / 180);
      ridgeLine = {
        cx: (C.lng - bMinLng) * 111320 * bCosL,
        cy: (bMaxLat - C.lat) * 111320,
        azDeg: A,
      };
    }
    return {
      modules: rF.modules.concat(rB.modules),
      count: rF.count + rB.count,
      frontCount: rF.count, backCount: rB.count, splitAzimut: A,
      bbox, ridgeLine,
    };
  }

  const opts = isPitched
    ? { pitched: true,
        tiltDeg:   g.dachNeigung != null ? g.dachNeigung : getDachDefaultNeigung(g.dachform),
        azimutDeg: g.dachAzimut  != null ? g.dachAzimut  : 180,
        coverage: (g.pvFlBelegung != null ? g.pvFlBelegung : 90) / 100,
        moduleW: mb, moduleL: ml }
    : { pitched: false,
        coverage: (g.pvFlGcr != null ? g.pvFlGcr : (g.pvFlAusrichtung === 'ostwest' ? 85 : 40)) / 100,
        ausrichtung: g.pvFlAusrichtung || 'sued',
        moduleW: mb, moduleL: ml };
  return placePvModules(bel, sperr, opts);
}

// Signatur für den Platzierungs-Cache: Geometrie + alle placement-relevanten Parameter
// (Flachdach: GCR/Ausrichtung · Schrägdach: Dachform/Neigung/Azimut/Belegungsgrad) + Modulmaße.
function _gebPvSig(g) {
  const b = document.getElementById('pv-modul-breite')?.value;
  const l = document.getElementById('pv-modul-laenge')?.value;
  const fls = (g.pvFlaechen || []).map(f => `${f.id}:${f.typ}:${Math.round(f.flaeche || 0)}`).join(',');
  const ridge = g.pvRidgeOverride ? `${g.pvRidgeOverride.lat.toFixed(6)},${g.pvRidgeOverride.lng.toFixed(6)}` : '';
  return [fls, g.pvFlGcr, g.pvFlAusrichtung, g.pvFlBelegung,
          g.dachform, g.dachNeigung, g.dachAzimut, ridge, b, l].join('|');
}

// Satteldach-Ertragsfaktor: nach Modulanzahl gewichteter Mittelwert der beiden
// Dachhälften-Ausrichtungen (A vorne, A+180 hinten).
function _gebSattelKorrFaktor(g) {
  const res = getGebPvModules(g);
  const fc = res.frontCount || 0, bc = res.backCount || 0;
  const tot = fc + bc;
  if (tot <= 0) return getPvKorrFaktor(g);
  const A   = res.splitAzimut != null ? res.splitAzimut : (g.dachAzimut ?? 180);
  const nei = g.dachNeigung != null ? g.dachNeigung : getDachDefaultNeigung('sattel');
  const fF = getPvKorrFaktor({ dachform: 'sattel', dachAzimut: ((A % 360) + 360) % 360,       dachNeigung: nei });
  const fB = getPvKorrFaktor({ dachform: 'sattel', dachAzimut: (((A + 180) % 360) + 360) % 360, dachNeigung: nei });
  return (fc * fF + bc * fB) / tot;
}

// Gecachte Modulplatzierung — Quelle für Grafik UND kWp (Modulanzahl × Wp).
export function getGebPvModules(g) {
  const sig = _gebPvSig(g);
  if (g._pvModCache && g._pvModSig === sig) return g._pvModCache;
  const res = _computeGebPvModules(g);
  g._pvModCache = res; g._pvModSig = sig;
  return res;
}

// Reale Module als ein SVG-Overlay je Gebäude zeichnen (Sperrflächen ausgespart).
export function redrawGebPvModules(g) {
  getGebPvModules(g); // füllt/aktualisiert Cache + g._pvModSig
  // Unverändert (gleiche Signatur) und bereits gezeichnet → nichts tun
  if (g._pvModuleLayer && g._pvModuleDrawnSig === g._pvModSig) return;
  if (g._pvModuleLayer) { map.removeLayer(g._pvModuleLayer); g._pvModuleLayer = null; }
  g._pvModuleDrawnSig = g._pvModSig;
  const ov = buildPvModuleOverlay(g._pvModCache);
  if (!ov) return;
  _ensurePvPane();
  g._pvModuleLayer = L.svgOverlay(ov.svgEl, ov.bounds, { opacity: 1, interactive: false, pane: 'pvPane' }).addTo(map);
  applyGebPvDimming(g);   // neu gezeichnete Module ggf. sofort ausgrauen (abgerissen/geplant)
}

// Solaranlagen eines Gebäudes ausgrauen, wenn das Gebäude abgerissen (oder geplant)
// ist – analog zum ausgegrauten Gebäude-Umriss. status optional; sonst aus dem Jahr.
export function applyGebPvDimming(g, status) {
  if (status == null) status = getComputedStats(g, window.globalYear || globalYear).status;
  const dimmed = status === 'abgerissen' || status === 'geplant';
  if (g._pvModuleLayer && g._pvModuleLayer.setOpacity) g._pvModuleLayer.setOpacity(dimmed ? 0.22 : 1);
  (g.pvFlaechen || []).forEach(fl => {
    if (!fl.layer || fl.typ === 'sperr') return;   // Sperrflächen steuert updateSperrVisibility
    const col = GEBPV_COLORS[fl.typ] || GEBPV_COLORS.belegung;
    fl.layer.setStyle(dimmed
      ? { color: '#777', fillColor: '#777', opacity: 0.25, fillOpacity: 0.06 }
      : { color: col.border, fillColor: col.fill, opacity: 1, fillOpacity: 0.6, dashArray: null });
  });
}

// Alle Flächen + Module eines Gebäudes neu zeichnen.
export function redrawGebPvFlaechen(g) {
  (g.pvFlaechen || []).forEach(fl => attachGebPvLayer(g, fl));
  redrawGebPvModules(g);
}

window.setGebPvModus = function(gId, modus) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  g.pvModus = modus;
  if (modus === 'flaechen') {
    if (!g.pvFlaechen) g.pvFlaechen = [];
    if (g.pvFlGcr == null) g.pvFlGcr = g.pvFlAusrichtung === 'ostwest' ? 85 : 40;
    if (!g.pvFlAusrichtung) g.pvFlAusrichtung = 'sued';
    if (g.pvFlBelegung == null) g.pvFlBelegung = 90;
  }
  g.pvAktiv = modus === 'flaechen' ? _hasBelegung(g) : g.pvAktiv;
  _rerenderCard(gId);
  _updateGebLabelPv(gId);
  calcStromPanel();
  renderGebPvPanel();
};

window.startGebPvDraw = function(gId, typ) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  window.cancelGebPvDraw();
  // Aufs Gebäude zoomen + Satellitenansicht einschalten
  ensureSatellite();
  if (g.polygonLayer) { try { map.fitBounds(g.polygonLayer.getBounds(), { padding: [60, 60], maxZoom: 21 }); } catch(e) {} }
  window.gebPvDraw = { gId, typ, points: [], polyline: null, startMarker: null };
  map.getContainer().style.cursor = 'crosshair';
  showHint(typ === 'sperr'
    ? '⛔ Sperrfläche: Ecken anklicken · roten Startpunkt erneut klicken = abschließen · Rechtsklick = zurück · Esc = abbrechen'
    : '☀ Belegungsfläche: Ecken anklicken · roten Startpunkt erneut klicken = abschließen · Rechtsklick = zurück · Esc = abbrechen');
};

window.cancelGebPvDraw = function() {
  const st = window.gebPvDraw;
  if (st) {
    if (st.polyline)    map.removeLayer(st.polyline);
    if (st.startMarker) map.removeLayer(st.startMarker);
  }
  window.gebPvDraw = null;
  if (typeof map !== 'undefined') map.getContainer().style.cursor = '';
  hideHint();
};

// ── First manuell nachzeichnen (Satteldach) ─────────────────────────────────
// 2 Klicks auf die echte Firstlinie (Satellitenbild) statt Auto-Split am
// Flächen-Schwerpunkt. Legt nur die POSITION fest (pvRidgeOverride); die
// Richtung übernimmt weiterhin den Azimut-Regler (aus den 2 Punkten neu gesetzt).
window.startGebFirstDraw = function(gId) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  window.cancelGebPvDraw();
  window.cancelGebFirstDraw();
  ensureSatellite();
  if (g.polygonLayer) { try { map.fitBounds(g.polygonLayer.getBounds(), { padding: [60, 60], maxZoom: 21 }); } catch(e) {} }
  window.gebFirstDraw = { gId, points: [], polyline: null };
  map.getContainer().style.cursor = 'crosshair';
  showHint('📐 First: Anfangs- und Endpunkt der Firstlinie anklicken · Esc = abbrechen');
};

window.cancelGebFirstDraw = function() {
  const st = window.gebFirstDraw;
  if (st?.polyline) map.removeLayer(st.polyline);
  window.gebFirstDraw = null;
  if (typeof map !== 'undefined') map.getContainer().style.cursor = '';
  hideHint();
};

window.finishGebFirstDraw = function() {
  const st = window.gebFirstDraw;
  if (!st || st.points.length < 2) return;
  const [p1, p2] = st.points;
  const g = window.gebaeude?.find(x => x.id === st.gId);
  window.cancelGebFirstDraw();
  if (!g) return;
  const cosL  = Math.cos(((p1.lat + p2.lat) / 2) * Math.PI / 180);
  const dLat  = (p2.lat - p1.lat) * 111320;
  const dLng  = (p2.lng - p1.lng) * 111320 * cosL;
  // Firstrichtung (0–180°, da eine Linie keine Vorzugsrichtung hat) → Falllinie senkrecht dazu
  const ridgeAngle = ((Math.atan2(dLng, dLat) * 180 / Math.PI) % 180 + 180) % 180;
  const faceA = (ridgeAngle + 90) % 360;
  const faceB = (ridgeAngle - 90 + 360) % 360;
  const cur   = g.dachAzimut ?? 180;
  const devA  = Math.min(Math.abs(faceA - cur), 360 - Math.abs(faceA - cur));
  const devB  = Math.min(Math.abs(faceB - cur), 360 - Math.abs(faceB - cur));
  g.dachAzimut     = Math.round(devA <= devB ? faceA : faceB);
  g.dachAutoAzimut = false;
  g.pvRidgeOverride = { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 };
  redrawGebPvModules(g);
  _rerenderCard(g.id);
  _updateGebLabelPv(g.id);
  calcStromPanel();
  renderGebPvPanel();
};

window.resetGebFirst = function(gId) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g || !g.pvRidgeOverride) return;
  delete g.pvRidgeOverride;
  redrawGebPvModules(g);
  _rerenderCard(gId);
  calcStromPanel();
  renderGebPvPanel();
};

window.finishGebPvDraw = function() {
  const st = window.gebPvDraw;
  if (!st || st.points.length < 3) return;
  const g   = window.gebaeude?.find(x => x.id === st.gId);
  const pts = st.points.map(p => ({ lat: p.lat, lng: p.lng }));
  const typ = st.typ;
  window.cancelGebPvDraw();
  if (!g) return;
  if (!g.pvFlaechen) g.pvFlaechen = [];
  window._gebPvFlCounter = (window._gebPvFlCounter || 0) + 1;
  const fl = { id: window._gebPvFlCounter, typ, polygon: pts, flaeche: polygonAreaM2(pts) || 0, layer: null, svgLayer: null };
  g.pvFlaechen.push(fl);
  attachGebPvLayer(g, fl);
  redrawGebPvModules(g);   // Module neu platzieren (Belegung erweitert / Sperrfläche schneidet aus)
  g.pvModus = 'flaechen';
  if (_hasBelegung(g)) g.pvAktiv = true;
  _rerenderCard(g.id);
  _updateGebLabelPv(g.id);
  calcStromPanel();
  renderGebPvPanel();
};

window.removeGebPvFlaeche = function(gId, flId) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g || !g.pvFlaechen) return;
  const fl = g.pvFlaechen.find(f => f.id === flId);
  if (fl) { if (fl.layer) map.removeLayer(fl.layer); if (fl.svgLayer) map.removeLayer(fl.svgLayer); }
  g.pvFlaechen = g.pvFlaechen.filter(f => f.id !== flId);
  redrawGebPvModules(g);   // Module neu platzieren (Sperrfläche entfernt → Fläche wieder frei)
  if (!_hasBelegung(g)) g.pvAktiv = false;
  _rerenderCard(gId);
  _updateGebLabelPv(gId);
  calcStromPanel();
  renderGebPvPanel();
};

window.updateGebPvFl = function(gId, field, val) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  if (field === 'gcr') { g.pvFlGcr = parseFloat(val) || 35; g._pvFlGcrManual = true; }
  else if (field === 'belegung') { g.pvFlBelegung = Math.min(100, parseFloat(val) || 90); }
  else if (field === 'ausrichtung') {
    g.pvFlAusrichtung = val;
    if (!g._pvFlGcrManual) g.pvFlGcr = val === 'ostwest' ? 85 : 40;
  }
  redrawGebPvFlaechen(g);   // Modulmuster an neue Ausrichtung/GCR anpassen
  _rerenderCard(gId);
  calcStromPanel();
  renderGebPvPanel();
};

// Globale Modulmaße geändert → Gebäude- UND Freiflächen-Module + kWp neu rechnen.
window.onPvModulChange = function() {
  renderGebPvPanel();                                        // Modul-Info + Gebäude-Layouts
  (window.freiflaechen || []).forEach(ff => attachFFLayer(ff)); // Freiflächen-Layouts + Modulanzahl
  renderFFPanel();
  calcStromPanel();
};

export function _gebLabelHtml(g) {
  const pvBadge = g.pvAktiv ? '<span style="color:#ffd54f;font-size:9px;margin-left:3px;vertical-align:middle;">☀</span>' : '';
  return escHtml(g.name) + pvBadge;
}

export function _updateGebLabelPv(id) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g || !g.labelMarker) return;
  const el = g.labelMarker.getElement();
  if (!el) return;
  const inner = el.querySelector('.geb-label-inner');
  if (inner) inner.innerHTML = _gebLabelHtml(g);
}

export function updateGebPv(id, field, val) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  if (field === 'pvAktiv') g.pvAktiv = val;
  else if (field === 'pvDachanteil') g.pvDachanteil = parseFloat(val) || 30;
  _rerenderCard(id);
  _updateGebLabelPv(id);
  calcStromPanel();
  renderGebPvPanel();
}

export function toggleGebPvPanel() {
  const p   = document.getElementById('geb-pv-panel');
  const btn = document.getElementById('btn-geb-pv-toggle');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
  btn.classList.add('active');
  renderGebPvPanel();
}

export function gebPvAllenZuweisen() {
  const dach = parseFloat(document.getElementById('geb-pv-dachanteil')?.value) || 30;
  window.gebaeude.forEach(g => { g.pvDachanteil = dach; _rerenderCard(g.id); });
  renderGebPvPanel();
  calcStromPanel();
}

export function renderGebPvPanel() {
  const panel = document.getElementById('geb-pv-panel');
  if (!panel?.classList.contains('visible')) return;
  const list  = document.getElementById('geb-pv-list');
  const summe = document.getElementById('geb-pv-summe');
  if (!list) return;

  const pvSpez = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const wpM2   = _pvWpM2Global();
  const b      = parseFloat(document.getElementById('pv-modul-breite')?.value) || 1.1;
  const l      = parseFloat(document.getElementById('pv-modul-laenge')?.value) || 1.7;
  const wp     = parseFloat(document.getElementById('pv-modul-wp')?.value)     || 450;
  const mFlaeche = b * l;
  const infoEl = document.getElementById('pv-modul-info');
  if (infoEl) infoEl.textContent = `${b.toFixed(2)} × ${l.toFixed(2)} m = ${mFlaeche.toFixed(2)} m²/Modul → ${wpM2.toFixed(0)} Wp/m²`;

  // Modul-Layouts der Flächen-Gebäude an geänderte Modulmaße anpassen (Cache-Signatur prüft selbst)
  window.gebaeude.forEach(g => { if (g.pvModus === 'flaechen' && _hasBelegung(g)) redrawGebPvModules(g); });

  const mitFlaeche = window.gebaeude.filter(g => parseFloat(g.flaeche) > 0);

  if (mitFlaeche.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:6px 0;">Noch keine Gebäude mit Fläche vorhanden.</div>';
    summe.style.display = 'none';
    return;
  }

  // Tabellenkopf
  let html = `<div style="display:grid;grid-template-columns:auto 1fr 64px 50px;gap:4px 8px;align-items:center;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--border);">
    <span style="color:var(--muted)">PV</span>
    <span style="color:var(--muted)">Gebäude</span>
    <span style="color:var(--muted);text-align:right;">Dach%</span>
    <span style="color:var(--muted);text-align:right;">kWp</span>
  </div>`;

  let totalKwp = 0;
  mitFlaeche.forEach(g => {
    const kwp = calcGebKwp(g);
    if (g.pvAktiv) totalKwp += kwp;
    html += `<div style="display:grid;grid-template-columns:auto 1fr 64px 50px;gap:4px 8px;align-items:center;margin-bottom:3px;">
      <input type="checkbox" ${g.pvAktiv ? 'checked' : ''} style="cursor:pointer;"
        data-change="updateGebPv(${g.id},'pvAktiv',this.checked)"/>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(g.name)}">${escHtml(g.name)}</span>
      <input class="inp-field" type="number" value="${g.pvDachanteil || 30}" min="5" max="100" step="5"
        style="padding:2px 4px;font-size:9px;text-align:right;"
        data-input="updateGebPv(${g.id},'pvDachanteil',this.value)"/>
      <span style="text-align:right;font-family:'DM Mono',monospace;color:${g.pvAktiv ? '#ffd54f' : 'var(--muted)'};">${kwp.toFixed(1)}</span>
    </div>`;
  });
  list.innerHTML = html;

  // Summe
  if (totalKwp > 0) {
    const mwha = totalKwp * pvSpez / 1000;
    summe.style.display = 'block';
    summe.innerHTML = `<span style="color:var(--muted)">Gesamt aktiv</span><span style="color:#ffd54f;font-weight:bold;margin-left:auto;display:block;text-align:right;">${totalKwp.toFixed(1)} kWp · ${mwha.toFixed(0)} MWh/a</span>`;
    summe.style.display = 'flex';
    summe.style.justifyContent = 'space-between';
    summe.style.alignItems = 'center';
  } else {
    summe.style.display = 'none';
  }
}

export function _renderExpandedPanel(g, stats) {
  const ausgeschlossen = isExcluded(g.id);
  let planItems = [];
  if (g.baujahr) planItems.push(`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0;"><span>Neubau ab ${g.baujahr}</span><span style="cursor:pointer;color:#e53935" data-click="clearPlan(${g.id}, 'neubau')">✕</span></div>`);
  if (g.sanierungen && g.sanierungen.length > 0) {
    g.sanierungen.forEach((s, idx) => {
      planItems.push(`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0;"><span>Sanierung ${s.jahr}: ${s.zielSpez} kWh/m²a</span><span style="cursor:pointer;color:#e53935" data-click="clearPlan(${g.id}, 'sanierung', ${idx})">✕</span></div>`);
    });
  }
  if (g.abrissjahr) planItems.push(`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0;"><span>Abriss im Jahr ${g.abrissjahr}</span><span style="cursor:pointer;color:#e53935" data-click="clearPlan(${g.id}, 'abriss')">✕</span></div>`);

  let infoLabel = '';
  if(stats.status === 'geplant') infoLabel = '<div style="color:#f9a825;font-size:10px;margin-bottom:5px;">Geplant</div>';
  else if(stats.status === 'abgerissen') infoLabel = '<div style="color:#e53935;font-size:10px;margin-bottom:5px;">Abgerissen</div>';
  else if(stats.status === 'saniert') infoLabel = `<div style="color:#4caf50;font-size:10px;margin-bottom:5px;">Saniert (${stats.spez.toLocaleString('de-DE',{maximumFractionDigits:1})} kWh/m²a)</div>`;

  const fW = window.systemState?.skalierFaktorW;
  const fH = window.systemState?.skalierFaktorH;
  let netzwertHtml = '';
  if (fW && (Math.abs(fW - 1) >= 0.01 || Math.abs((fH || fW) - 1) >= 0.01)) {
    const sW = g.waerme ? Math.round(g.waerme * fW) : null;
    const sH = g.heizlast ? (Math.round(parseFloat(g.heizlast) * (fH || fW) * 10) / 10) : null;
    if (sW || sH) {
      const parts = [];
      if (sW) parts.push(`${sW.toLocaleString('de-DE')} MWh/a`);
      if (sH) parts.push(`${sH.toLocaleString('de-DE')} kW`);
      netzwertHtml = `<div style="font-size:9px;color:#9fa8da;margin-top:3px;padding:2px 6px;background:rgba(63,81,181,0.12);border-radius:3px;border-left:2px solid #5c6bc0;">↑ Netzwert: ${parts.join(' · ')}</div>`;
    }
  }

  return `<div class="geb-expanded">
    ${infoLabel}
    <div style="margin-bottom:5px;">
      <input class="inp-field" type="text" placeholder="Bezeichnung…" value="${escHtml(g.name || '')}"
        style="width:100%;box-sizing:border-box;"
        data-input="renameGebaeude(${g.id},this.value)"/>
    </div>
    <div style="margin-bottom:5px;display:flex;gap:4px;">
      <select class="nutzung-select" style="flex:1;" data-change="setNutzung(${g.id},this.value)" title="Nutzungstyp">
        <option value="">Nutzungstyp…</option>
        ${_buildNutzungOptions(g.nutzung)}
      </select>
      <button class="btn-xs" title="Nutzungstypen verwalten" data-click="showNutzungstypenModal()" style="flex-shrink:0;padding:0 6px;">⚙</button>
    </div>
    <div class="geb-inputs" style="grid-template-columns: 1fr 1fr; row-gap: 6px; opacity: ${stats.status==='abgerissen'||stats.status==='geplant'?0.4:1}">
      <div class="inp-group">
        <div class="inp-label">Wärme MWh/a (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.waerme)}"
          data-waerme="${g.id}"
          data-input="updateField(${g.id},'waerme',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Spez. kWh/m²a (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.spez)}"
          data-spez="${g.id}"
          style="${g.flaeche && g.waerme ? 'color:#4caf50' : ''}"
          data-input="updateField(${g.id},'spez',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Heizlast kW (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.heizlast)}"
          data-heizlast="${g.id}"
          data-input="updateField(${g.id},'heizlast',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Spez. HL W/m² (Bestand)</div>
        <input class="inp-field" type="number" placeholder="—" value="${escVal(g.spezHeizlast)}"
          data-spezhl="${g.id}"
          style="${g.flaeche && g.heizlast ? 'color:#4caf50' : ''}"
          data-input="updateField(${g.id},'spezHeizlast',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Baujahr${g.baujährQuelle ? ' <span title="'+g.baujährQuelle+'" style="cursor:help;opacity:0.6;font-size:0.8em">ⓘ '+g.baujährQuelle.split('(')[0].trim()+'</span>' : ''}</div>
        <input class="inp-field" type="number" placeholder="z.B. 1980" value="${escVal(g.baujahr)}"
          data-input="updateField(${g.id},'baujahr',this.value)"/>
      </div>
      <div class="inp-group">
        <div class="inp-label">Stockwerke</div>
        <input class="inp-field" type="number" placeholder="1" value="${g.stockwerke || 1}"
          data-input="updateField(${g.id},'stockwerke',this.value)"/>
      </div>
      ${g.zustand ? `<div class="inp-group">
        <div class="inp-label">Zustand</div>
        <select class="inp-field" data-change="updateField(${g.id},'zustand',this.value)">
          <option value="">—</option>
          <option value="A" ${g.zustand==='A'?'selected':''}>A (gut)</option>
          <option value="B" ${g.zustand==='B'?'selected':''}>B (mittel)</option>
          <option value="C" ${g.zustand==='C'?'selected':''}>C (schlecht)</option>
        </select>
      </div>` : ''}
      <div class="inp-group" style="grid-column: 1 / -1;">
        <div class="inp-label">Fläche m² ${g.flaeche ? "(OSM)" : ""}</div>
        <input class="inp-field" type="number" placeholder="—"
          value="${g.flaeche ? Math.round(g.flaeche) : ''}"
          data-input="updateField(${g.id},'flaeche',this.value)"/>
      </div>
    </div>
    ${buildGebElektroSection(g)}
    ${netzwertHtml}
    ${g.netzVerlustKW != null ? `<div style="margin-top:6px;padding:5px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);font-size:10px;font-family:'DM Mono',monospace;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;">
      <span style="color:var(--muted)">Zuger. Verlust</span><span style="color:var(--text)">${g.netzVerlustKW.toFixed(1)} kW</span>
      ${g.netzVerlustJahrMWh != null ? `<span style="color:var(--muted)">Verlust/Jahr</span><span style="color:var(--text)">${g.netzVerlustJahrMWh.toLocaleString('de-DE')} MWh/a</span>` : ''}
      <span style="color:var(--muted)">Anteil Verbrauch</span><span style="color:${g.netzVerlustRatioPct < 5 ? '#4caf50' : g.netzVerlustRatioPct < 10 ? '#f9a825' : '#e53935'};font-weight:bold">${g.netzVerlustRatioPct.toFixed(1)} %</span>
    </div>` : ''}
    <div class="geb-actions">
      ${!g.polygon ? `<button class="btn-xs blue" data-click="startDraw(${g.id})">&#9998; Zeichnen</button>` : ''}
      ${g.polygon ? '<button class="btn-xs purple" data-click="flyTo(' + g.id + ')">&#8982;</button>' : ''}
      <button class="btn-xs" data-click="togglePlanPanel(${g.id})" title="Planung & Sanierung">🔧 Planen</button>
      <button class="btn-xs" data-click="startNetzEdgeFrom(${g.id})" title="Leitung von diesem Gebäude zeichnen" style="border-color:#e53935;color:#e53935;">⛕+</button>
      ${netzEdges.some(e => e.u === g.id || e.v === g.id) ? `<button class="btn-xs red" data-click="abklemmenGebaeude(${g.id})" title="Alle Netzleitungen entfernen">⛕✕</button>` : ''}
      <button class="btn-xs" data-click="removeGebaeude(${g.id})" title="Löschen" style="margin-left:auto">&#10005;</button>
    </div>
    ${activeVariantId !== null ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--border);">
      <button class="btn-xs ${ausgeschlossen ? 'green' : ''}" style="${ausgeschlossen ? '' : 'border-color:#f9a825;color:#f9a825;'}" data-click="toggleAusschluss(${g.id})">
        ${ausgeschlossen ? '↩ Wieder anschließen' : '⊗ In Variante abkoppeln'}
      </button>
    </div>` : ''}
    <div class="plan-panel" id="plan-${g.id}">
      <div style="font-size:10px; color:var(--accent); margin-bottom:8px;">Lebenszyklus & Sanierung</div>
      <select class="inp-field" style="margin-bottom:8px;" data-change="changePlanMode(${g.id}, this.value)">
        <option value="">Aktion wählen...</option>
        <option value="neubau">Neubau planen</option>
        <option value="sanierung">Sanierung planen</option>
        <option value="abriss">Abriss planen</option>
      </select>
      <div id="plan-mode-neubau-${g.id}" style="display:none; gap:5px; margin-bottom:8px; align-items:center;">
        <input type="number" id="inp-neubau-${g.id}" placeholder="Baujahr (z.B. 2030)" class="inp-field" style="flex:1">
        <button class="btn-xs green" data-click="savePlan(${g.id}, 'neubau')">Speichern</button>
      </div>
      <div id="plan-mode-sanierung-${g.id}" style="display:none; gap:5px; margin-bottom:8px; align-items:center;">
        <input type="number" id="inp-san-jahr-${g.id}" placeholder="Jahr" class="inp-field" style="width:45px; flex:1">
        <input type="number" id="inp-san-spez-${g.id}" placeholder="Ziel kWh/m²a" class="inp-field" style="width:85px; flex:1">
        <button class="btn-xs green" data-click="savePlan(${g.id}, 'sanierung')">Speichern</button>
      </div>
      <div id="plan-mode-abriss-${g.id}" style="display:none; gap:5px; margin-bottom:8px; align-items:center;">
        <input type="number" id="inp-abriss-${g.id}" placeholder="Abrissjahr" class="inp-field" style="flex:1">
        <button class="btn-xs red" data-click="savePlan(${g.id}, 'abriss')">Speichern</button>
      </div>
      <div id="san-list-${g.id}" style="margin-top:4px; font-size:11px; color:var(--text); display:flex; flex-direction:column; gap:2px;">
        ${planItems.join('')}
      </div>
    </div>
  </div>
  ${_renderFelddatenBlock(g)}`;
}

function _renderFelddatenBlock(g) {
  if (!g.feldNotizen && !g.feldStatus && !g.feldFotos?.length) return '';

  const statusLabel = { offen:'📋 Offen', besucht:'👁 Besucht', erledigt:'✅ Erledigt' }[g.feldStatus] || '';
  const notizHtml = g.feldNotizen
    ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:6px 10px;border-radius:0 6px 6px 0;font-size:11px;white-space:pre-wrap;margin-bottom:6px;">${escHtml(g.feldNotizen)}</div>`
    : '';
  const fotoHtml = (g.feldFotos || []).map(foto =>
    `<img src="${foto.dataUrl}" title="${escHtml(foto.name)}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="openImageLightbox(this.src,this.title)">`
  ).join('');

  return `
  <div style="margin:6px 0 2px;padding:6px 8px;background:var(--surface2,#1e2433);border-radius:8px;border:1px solid #2a3352;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:10px;font-weight:700;color:var(--muted);">
      📱 FELDDATEN ${statusLabel ? '· ' + statusLabel : ''}
    </div>
    ${notizHtml}
    ${fotoHtml ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${fotoHtml}</div>` : ''}
  </div>`;
}

export function _rerenderCard(id) {
  const card = document.getElementById('card-' + id);
  if (!card) return;
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  const stats = getComputedStats(g, globalYear);
  const isExpanded = _expandedIds.has(id);
  const ausgeschlossen = isExcluded(g.id);
  const cls = ['geb-card'];
  if (g.polygon) cls.push(g.fromOsm ? 'osm' : 'drawn');
  if (selectedId === id) cls.push('selected');
  if (ausgeschlossen) cls.push('ausgeschlossen');
  card.className = cls.join(' ');
  card.innerHTML = _renderCompactRow(g, stats, isExpanded) +
                   (isExpanded ? _renderExpandedPanel(g, stats) : '');
}

export function toggleGebExpand(id) {
  if (_expandedIds.has(id)) {
    _expandedIds.delete(id);
  } else {
    _expandedIds.add(id);
  }
  highlightCard(id);
  _rerenderCard(id);
}

export function renderList(){
  populateZentraleSelect();
  if (typeof updateLpGebietStatus === 'function') updateLpGebietStatus();
  const el=document.getElementById('geb-list');el.innerHTML='';
  window.gebaeude.forEach(g=>{
    const stats = getComputedStats(g, window.globalYear || globalYear);
    const card=document.createElement('div');
    const ausgeschlossen = isExcluded(g.id);
    const cls=['geb-card'];
    if(g.polygon) cls.push(g.fromOsm?'osm':'drawn');
    if(selectedId===g.id) cls.push('selected');
    if(ausgeschlossen) cls.push('ausgeschlossen');
    card.className=cls.join(' ');
    card.id = 'card-' + g.id;
    const isExpanded = _expandedIds.has(g.id);
    card.innerHTML = _renderCompactRow(g, stats, isExpanded) +
                     (isExpanded ? _renderExpandedPanel(g, stats) : '');
    el.appendChild(card);
  });
  updateTotals();
}

export function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export function escVal(v){return v!=null&&v!==''?v:'';}
export function flyTo(id){const g=window.gebaeude.find(x=>x.id===id);if(g?.polygonLayer)map.flyToBounds(g.polygonLayer.getBounds(),{padding:[40,40]});}

// Kälteversorgung: UI-Eingaben (für Round-Trip) + berechnete Ergebnisse (für Bericht)
function _captureKaelte() {
  const v = (id) => document.getElementById(id)?.value;
  const c = (id) => !!document.getElementById(id)?.checked;
  const ks = window.kaelteState;
  const aktiv = c('kaelte-revwp-on') || c('kaelte-chiller-on');
  if (!aktiv && !ks) return null;
  return {
    eingabe: {
      lastMode: v('kaelte-last-mode'),
      mwh: v('kaelte-mwh'),
      nutzung: v('kaelte-nutzung'),
      spez: v('kaelte-spez'),
      flaeche: v('kaelte-flaeche'),
      kuehlgrenze: v('kaelte-kuehlgrenze'),
      kaltwasserVl: v('kaelte-kw-vl'),
      revwp: { on: c('kaelte-revwp-on'), quelle: v('kaelte-revwp-quelle'), guetegradK: v('kaelte-revwp-gg'),
               auto: c('kaelte-revwp-auto'), leistungKw: v('kaelte-revwp-kw'), freecool: c('kaelte-revwp-freecool') },
      chiller: { on: c('kaelte-chiller-on'), quelle: v('kaelte-chiller-quelle'), guetegradK: v('kaelte-chiller-gg'),
                 leistungKw: v('kaelte-chiller-kw'), freecool: c('kaelte-chiller-freecool') },
      freecoolDtMin: v('kaelte-freecool-dt'),
      freecoolEer: v('kaelte-freecool-eer'),
      investChillerEurKw: v('kaelte-invest-chiller'),
      investRevwpEurKw: v('kaelte-invest-revwp'),
      zins: v('kaelte-zins'),
    },
    ergebnis: ks ? {
      kaelteMwh: ks.kaelteTotMwh, stromMwh: ks.stromTotMwh, seer: ks.seerGesamt,
      peakKw: ks.peakKw, restMwh: ks.restMwh, freecoolMwh: ks.freecoolMwh,
      investEur: ks.invest, stromkostenEurA: ks.stromKostenEur,
      jahreskostenEurA: ks.jahreskostenEur, wgkKaelteCt: ks.wgkKaelteCt,
      co2TonnenA: ks.co2TonnenA, monthlyEer: ks.monthlyEer,
      erzeuger: ks.perErz,
    } : null,
  };
}

export function _buildProjectData() {
  return {
    version: 1,
    gebaeude: window.gebaeude.map(g => ({
      id: g.id, name: g.name, waerme: g.waerme, heizlast: g.heizlast, spez: g.spez, spezHeizlast: g.spezHeizlast,
      flaeche: g.flaeche, nutzung: g.nutzung, fromOsm: g.fromOsm, osmId: g.osmId, polygon: g.polygon,
      baujahr: g.baujahr, baujährQuelle: g.baujährQuelle || null, abrissjahr: g.abrissjahr, sanierungen: g.sanierungen,
      stockwerke: g.stockwerke || 1, waermeManual: g.waermeManual || false, heizlastManual: g.heizlastManual || false,
      pvAktiv: g.pvAktiv || false, pvDachanteil: g.pvDachanteil || 30, zustand: g.zustand || '',
      strom: g.strom || '', spezStrom: g.spezStrom || '', stromProfil: g.stromProfil || 'auto',
      dachform: g.dachform || 'sattel', dachAzimut: g.dachAzimut ?? null,
      dachNeigung: g.dachNeigung ?? null, dachAutoAzimut: g.dachAutoAzimut || false,
      pvRidgeOverride: g.pvRidgeOverride || null,
      pvModus: g.pvModus || 'pauschal', pvFlGcr: g.pvFlGcr ?? null, pvFlAusrichtung: g.pvFlAusrichtung || 'sued',
      pvFlBelegung: g.pvFlBelegung ?? null,
      pvFlaechen: (g.pvFlaechen || []).map(f => ({ id: f.id, typ: f.typ, polygon: f.polygon, flaeche: f.flaeche })),
    })),
    netz: {
      zentrale: document.getElementById('netz-zentrale').value,
      vl: document.getElementById('netz-vl').value,
      rl: document.getElementById('netz-rl').value,
      v: document.getElementById('netz-v').value,
      tAussen: document.getElementById('netz-t-aussen').value,
      tMittel: document.getElementById('netz-t-mittel').value,
      uWert: document.getElementById('netz-u-wert').value,
      planJahr: document.getElementById('netz-plan-jahr').value,
      planVl: document.getElementById('netz-plan-vl').value,
      planRl: document.getElementById('netz-plan-rl').value,
      isLocked: networkLocked,
      kostenSzenario: kostenSzenario,
      sanierung: window._netzSanierung || false,
      sanierungPct: parseFloat(document.getElementById('netz-sanierung-pct')?.value) || 40,
      gzfMethode: document.getElementById('netz-gzf-methode')?.value || 'richtwert',
      gzfManuell: parseFloat(document.getElementById('netz-gzf-manuell')?.value) || 0.6
    },
    trasse: trassePoints.map(p => ({lat: p.lat, lng: p.lng})),
    trasseSegments: trasseSegments,
    customEdges: netzEdges.filter(e => e.u < 10000 && e.v < 10000).map(e => ({u: e.u, v: e.v, pruned: e.pruned || false})),
    edgeWaypoints: edgeWaypoints,
    fliessgewaesser: fliessgewaesser ? { latlngs: fliessgewaesser.latlngs, durchflussLs: fliessgewaesser.durchflussLs, leistungKw: fliessgewaesser.leistungKw, jaz: fliessgewaesser.jaz, visible: fliessgewaesserVisible } : null,
    lwWp: lwWp ? { lat: lwWp.lat, lng: lwWp.lng, leistungKw: lwWp.leistungKw, lwaDb: lwWp.lwaDb, jaz: parseFloat(document.getElementById('lwwp-jaz').value)||3.0, waerme: document.getElementById('lwwp-waerme').value, minCop: document.getElementById('lwwp-min-cop')?.value || '', visible: lwWpVisible } : null,
    geoThermie: geoThermie ? { ...geoThermie, heizlast: document.getElementById('geo-heizlast').value, waerme: document.getElementById('geo-waerme').value, jaz: parseFloat(document.getElementById('geo-jaz').value)||4.5, tiefe: parseFloat(document.getElementById('geo-tiefe').value)||100, qPerM: parseFloat(document.getElementById('geo-q-perm').value)||50, abstand: parseFloat(document.getElementById('geo-abstand').value)||10, dtAbsenkung: parseFloat(document.getElementById('geo-dt-absenkung').value)||0 } : null,
    gasKessel: gasKessel ? { leistungKw: gasKessel.leistungKw, eta: document.getElementById('gk-eta').value, waerme: document.getElementById('gk-waerme').value } : null,
    heizoelKessel: heizoelKessel ? { leistungKw: heizoelKessel.leistungKw, eta: document.getElementById('hko-eta').value, waerme: document.getElementById('hko-waerme').value } : null,
    bhkw: bhkw ? { leistungThKw: parseFloat(document.getElementById('bhkw-leistung-th').value)||100, skz: document.getElementById('bhkw-skz').value, eta: document.getElementById('bhkw-eta').value, waerme: document.getElementById('bhkw-waerme').value } : null,
    stromkessel: stromkessel ? { leistungKw: parseFloat(document.getElementById('sk-leistung').value)||200, eta: document.getElementById('sk-eta').value, waerme: document.getElementById('sk-waerme').value } : null,
    solarthermie: solarthermieAktiv ? { flaeche: parseFloat(document.getElementById('st-flaeche')?.value)||0, spez: parseFloat(document.getElementById('st-spez')?.value)||400, polygon: window._stPolygon || null } : null,
    waermespeicher: thermSpeicherAktiv ? { typ: document.getElementById('ts-typ')?.value||'puffer', volumen: parseFloat(document.getElementById('ts-volumen')?.value)||0, dt: parseFloat(document.getElementById('ts-dt')?.value)||40, verlust: parseFloat(document.getElementById('ts-verlust')?.value)||0.5, entladeKw: parseFloat(document.getElementById('ts-entlade-kw')?.value)||200, ladeKw: parseFloat(document.getElementById('ts-lade-kw')?.value)||parseFloat(document.getElementById('ts-entlade-kw')?.value)||200 } : null,
    freiflaechen: freiflaechen.map(ff => ({ id: ff.id, name: ff.name, polygon: ff.polygon, flaeche: ff.flaeche, gcr: ff.gcr, ausrichtung: ff.ausrichtung })),
    pvModul: { breite: document.getElementById('pv-modul-breite')?.value, laenge: document.getElementById('pv-modul-laenge')?.value, wp: document.getElementById('pv-modul-wp')?.value },
    pvPanel: { kwp: document.getElementById('pv-kwp')?.value, spez: document.getElementById('pv-spez')?.value, ausrichtung: document.getElementById('pv-ausrichtung')?.value, quartierMwh: document.getElementById('strom-quartier-mwh')?.value, strompreis: document.getElementById('strom-preis-bezug')?.value, einspeisung: document.getElementById('strom-preis-einsp')?.value, leistungspreis: document.getElementById('strom-leistungspreis')?.value },
    meritOrderKeys: [...meritOrderKeys],
    kaelte: _captureKaelte(),
    pelletsKessel: pelletsKessel ? { leistungKw: pelletsKessel.leistungKw, eta: document.getElementById('pk-eta').value, waerme: document.getElementById('pk-waerme').value, lat: pelletsKessel.lat, lng: pelletsKessel.lng } : null,
    heizhackschnitzel: heizhackschnitzel ? { leistungKw: heizhackschnitzel.leistungKw, eta: document.getElementById('hhs-eta').value, waerme: document.getElementById('hhs-waerme').value, lat: heizhackschnitzel.lat, lng: heizhackschnitzel.lng } : null,
    fernwaerme: fernwaerme ? { leistungKw: fernwaerme.leistungKw, waerme: document.getElementById('fw-waerme').value, co2f: document.getElementById('fw-co2f').value, lat: fernwaerme.lat, lng: fernwaerme.lng } : null,
    heizoelEmF: heizoelEmF, gasEmF: gasEmF,
    pelletsEmF: pelletsEmF, hhsEmF: hhsEmF, fernwaermeEmF: fernwaermeEmF,
    stromEmF: stromEmF, stromEmFLZ: stromEmFLZ,
    pefStrom: pefStrom, pefWP: pefWP, pefGas: pefGas, pefHeizoel: pefHeizoel,
    pefPellets: pefPellets, pefHhs: pefHhs, pefFernwaerme: pefFernwaerme,
    wirtBausteineOverrides: window._wirtBausteineOverrides || {},
    wirtVdiOverrides: window._wirtVdiOverrides || {},
    ..._captureVariantenKernzustand(),
    stromNetz: {
      nodes: stromNodes.filter(n => n.type !== 'geb' && n.type !== 'erzeuger' && n.type !== 'junction').map(n => ({
        id: n.id, type: n.type, lat: n.lat, lng: n.lng, label: n.label,
        maxKva: n.maxKva, ratedKva: n.ratedKva, ukPct: n.ukPct
      })),
      edges: (() => {
        const assetIdSet = new Set(ASSETS.items.map(a => a.id));
        const skip = ['geb', 'erzeuger', 'junction'];
        return stromEdges.filter(e => {
          if (assetIdSet.has(e.u) && assetIdSet.has(e.v)) return false;
          const un = stromNodes.find(n => n.id === e.u);
          const vn = stromNodes.find(n => n.id === e.v);
          return (!un || !skip.includes(un.type)) || (!vn || !skip.includes(vn.type));
        }).map(e => ({ u: e.u, v: e.v, cableType: e.cableType, crossSection: e.crossSection, autoSized: e.autoSized, fuseA: e.fuseA || 0, nParallel: e.nParallel || 1 }));
      })(),
      kabelTyp: document.getElementById('strom-kabel-typ')?.value || 'NAYY'
    },
    elektroAssets: (() => {
      const assetIdSet = new Set(ASSETS.items.map(a => a.id));
      return {
        items: ASSETS.items.map(a => ({
          id: a.id, type: a.type, domain: a.domain,
          lat: a.lat, lng: a.lng, name: a.name,
          buildingId: a.buildingId, _movedByUser: a._movedByUser || false,
          linkedErzeuger: a.linkedErzeuger || null,
          linkedFF:       a.linkedFF       || null,
          props: { ...a.props },
          baujahr: a.baujahr, abrissjahr: a.abrissjahr,
          massnahmen: a.massnahmen || []
        })),
        edges: stromEdges
          .filter(e => assetIdSet.has(e.u) && assetIdSet.has(e.v))
          .map(e => ({
            id: e.id, u: e.u, v: e.v,
            cableType: e.cableType, crossSection: e.crossSection,
            autoSized: e.autoSized, lengthM: e.lengthM, fuseA: e.fuseA || 0, nParallel: e.nParallel || 1,
            autoGenerated: e.autoGenerated || false, msLevel: e.msLevel || false, trennstelle: e.trennstelle || false,
            baujahr: e.baujahr ?? null, abrissjahr: e.abrissjahr ?? null, massnahmen: e.massnahmen || []
          }))
      };
    })(),
    customNutzungstypen: NUTZUNGSTYPEN_CUSTOM.map(t => ({ ...t })),
    customElSlpProfiles: ELSLP_CUSTOM.map(p => ({ ...p })),
    elSlpWpm2Overrides:  { ...ELSLP_WPM2 },
    // ERA5-Standort-Winddaten (window-Bridge aus 13q-wind-ertrag.js) — einmal geladen,
    // sollen sie Reload/Offline-Nutzung überleben (~60 KB, Stundenwerte gerundet)
    windStandortDaten: (typeof window.windSiteSerialize === 'function' ? window.windSiteSerialize() : null),
    // Plan-Overlays (Hintergrundpläne) mit Bilddaten, Passlage, Deckkraft, Sichtbarkeit
    overlays: (typeof window.serializeOverlays === 'function' ? window.serializeOverlays() : []),
  };
}

export function exportJSON(){
  const project = _buildProjectData();
  const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='liegenschaft_projekt.json';a.click();
}

export function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const project = JSON.parse(e.target.result);
      _loadProject(project);
      showHint('Projekt erfolgreich geladen.');
      setTimeout(hideHint, 3000);
    } catch (err) {
      showHint('Fehler beim Laden der Datei.');
      console.error(err);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// Jahres-Slider (Kopfleiste) auf das älteste ECHTE Baujahr der Liegenschaft setzen —
// geschätzte/automatisch erzeugte Baujahre (g.baujährQuelle gesetzt) zählen nicht,
// da sie keine belastbare Untergrenze für den Betrachtungszeitraum liefern.
export function _initYearSliderFromBaujahr() {
  const slider = document.getElementById('year-slider');
  if (!slider) return;
  const echteBaujahre = (window.gebaeude || [])
    .filter(g => g.baujahr && !g.baujährQuelle)
    .map(g => parseInt(g.baujahr))
    .filter(y => !isNaN(y));
  if (!echteBaujahre.length) return;
  const minJahr = Math.min(...echteBaujahre);
  const spanne = parseInt(slider.max) - parseInt(slider.min) || 24;
  slider.min = minJahr;
  if (minJahr + spanne > parseInt(slider.max)) slider.max = minJahr + spanne;
  slider.value = minJahr;
  setGlobalYear(minJahr);
}

export function _loadProject(project) {
      window.gebaeude.forEach(g => {
        if(g.polygonLayer) map.removeLayer(g.polygonLayer);
        if(g.circleMarker) map.removeLayer(g.circleMarker);
        if(g.labelMarker) map.removeLayer(g.labelMarker);
      });
      window.gebaeude = [];
      clearNetz();
      clearTrasse();
      clearFliessgewaesser();
      clearLwWp();
      clearGasKessel();
      clearStromkessel();
      clearHeizoelKessel();
      clearPellets();
      clearHhs();
      clearFernwaerme();
      clearSolarthermie();
      clearThermSpeicher();
      clearAssets();
      setIdCounter(1);

      if (project.gebaeude) {
         set_batchImporting(true);
         try { project.gebaeude.forEach(g => {
            const newG = addGebaeude({ id: g.id, coords: g.polygon, name: g.name, fromOsm: g.fromOsm, osmId: g.osmId, skipAutoCreate: true });
            newG.waerme = g.waerme;
            newG.heizlast = g.heizlast;
            newG.spez = g.spez;
            newG.spezHeizlast = g.spezHeizlast;
            newG.flaeche = g.flaeche;
            newG.baujahr = g.baujahr;
            newG.baujährQuelle = g.baujährQuelle || null;
            newG.abrissjahr = g.abrissjahr;
            newG.sanierungen = g.sanierungen || [];
            newG.nutzung = g.nutzung || '';
            newG.stockwerke = g.stockwerke || 1;
            newG.waermeManual = g.waermeManual || false;
            newG.heizlastManual = g.heizlastManual || false;
            newG.strom = g.strom || '';
            newG.spezStrom = g.spezStrom || '';
            newG.stromProfil = g.stromProfil || 'auto';
            newG.pvAktiv = g.pvAktiv || false;
            newG.pvDachanteil = g.pvDachanteil || 30;
            newG.zustand = g.zustand || '';
            newG.dachform      = g.dachform      || 'sattel';
            newG.dachAzimut    = g.dachAzimut    ?? null;
            newG.dachNeigung   = g.dachNeigung   ?? null;
            newG.dachAutoAzimut = g.dachAutoAzimut || false;
            newG.pvRidgeOverride = g.pvRidgeOverride || null;
            // PV-Flächenzeichnung (Belegungs-/Sperrflächen) wiederherstellen
            newG.pvModus        = g.pvModus || 'pauschal';
            newG.pvFlGcr        = g.pvFlGcr ?? null;
            newG.pvFlAusrichtung = g.pvFlAusrichtung || 'sued';
            newG.pvFlBelegung   = g.pvFlBelegung ?? null;
            newG.pvFlaechen     = (g.pvFlaechen || []).map(f => ({ id: f.id, typ: f.typ, polygon: f.polygon, flaeche: f.flaeche, layer: null, svgLayer: null }));
            newG.pvFlaechen.forEach(f => {
              attachGebPvLayer(newG, f);
              if (f.id >= (window._gebPvFlCounter || 0)) window._gebPvFlCounter = f.id + 1;
            });
            redrawGebPvModules(newG);
            if (g.id >= idCounter) setIdCounter(g.id + 1);
         });
         } finally { set_batchImporting(false); }
      }

      if (project.netz) {
         document.getElementById('netz-vl').value = project.netz.vl || 90;
         document.getElementById('netz-rl').value = project.netz.rl || 60;
         syncVLTemps('netz');
         document.getElementById('netz-v').value = project.netz.v || 1.0;
         document.getElementById('netz-t-aussen').value = project.netz.tAussen ?? -12;
         document.getElementById('netz-t-mittel').value = project.netz.tMittel ?? 10;
         document.getElementById('netz-u-wert').value = project.netz.uWert || 0.25;
         if (project.netz.gzfMethode) {
           document.getElementById('netz-gzf-methode').value = project.netz.gzfMethode;
           document.getElementById('netz-gzf-manuell-wrap').style.display = project.netz.gzfMethode === 'manuell' ? '' : 'none';
         }
         if (project.netz.gzfManuell != null) document.getElementById('netz-gzf-manuell').value = project.netz.gzfManuell;
         document.getElementById('netz-plan-jahr').value = project.netz.planJahr || '';
         document.getElementById('netz-plan-vl').value = project.netz.planVl || '';
         document.getElementById('netz-plan-rl').value = project.netz.planRl || '';

         if (project.netz.kostenSzenario) {
           setKostenSzenario(project.netz.kostenSzenario);
           document.getElementById('kosten-szenario').value = kostenSzenario;
         }

         populateZentraleSelect();
         document.getElementById('netz-zentrale').value = project.netz.zentrale || '';

         if (project.netz.isLocked && !networkLocked) {
             toggleNetworkLock();
         } else if (!project.netz.isLocked && networkLocked) {
             toggleNetworkLock();
         }
         if (project.netz.sanierung) {
           window._netzSanierung = true;
           const cb = document.getElementById('netz-sanierung-toggle');
           if (cb) cb.checked = true;
           const det = document.getElementById('netz-sanierung-detail');
           if (det) det.style.display = 'flex';
         }
         if (project.netz.sanierungPct) {
           const inp = document.getElementById('netz-sanierung-pct');
           if (inp) inp.value = project.netz.sanierungPct;
         }
      }

      if (project.trasse && project.trasse.length > 0) {
         setTrassePoints(project.trasse.map(p => L.latLng(p.lat, p.lng)));
         setTrasseSegments(project.trasseSegments || []);
         setTrasseCurrentSegStart(trassePoints.length);
         redrawTrasse();
      }

      setEdgeWaypoints(project.edgeWaypoints || {});
      const _prunedMap = {};
      if (project.customEdges) {
         project.customEdges.forEach(e => { if (e.pruned) _prunedMap[edgeKey(e.u, e.v)] = true; });
         project.customEdges.forEach(e => addNetzEdge(e.u, e.v));
      }
      if (project.netz && project.netz.zentrale) {
         autoGenerateNetz();
      }
      // Restore pruned state
      if (Object.keys(_prunedMap).length > 0) {
        netzEdges.forEach(e => {
          if (_prunedMap[edgeKey(e.u, e.v)]) { e.pruned = true; applyEdgePrunedStyle(e); }
        });
        recalcNetz();
        updatePruningSummary();
      }

      if (project.fliessgewaesser && project.fliessgewaesser.latlngs && project.fliessgewaesser.latlngs.length >= 2) {
        setFliessgewaesser({
          latlngs: project.fliessgewaesser.latlngs,
          durchflussLs: project.fliessgewaesser.durchflussLs || 50,
          leistungKw: project.fliessgewaesser.leistungKw || 200,
          jaz: project.fliessgewaesser.jaz || 4.5,
          visible: project.fliessgewaesser.visible !== false
        });
        setFliessgewaesserVisible(fliessgewaesser.visible);
        document.getElementById('fg-visible').checked = fliessgewaesserVisible;
        document.getElementById('fg-durchfluss').value = fliessgewaesser.durchflussLs;
        document.getElementById('fg-leistung').value = fliessgewaesser.leistungKw;
        document.getElementById('fg-jaz').value = fliessgewaesser.jaz;
        document.getElementById('fg-draw-section').style.display = 'none';
        document.getElementById('fg-data-section').style.display = 'block';
        redrawFliessgewaesser();
        updateFliessgewaesserVisibility();
      }

    if (project.lwWp && project.lwWp.lat != null && project.lwWp.lng != null) {
        window.lwWp = { lat: project.lwWp.lat, lng: project.lwWp.lng, leistungKw: project.lwWp.leistungKw || 12, lwaDb: project.lwWp.lwaDb || 80, visible: project.lwWp.visible !== false };
        window.lwWpVisible = window.lwWp.visible !== false;
        document.getElementById('lwwp-visible').checked = lwWpVisible;
        document.getElementById('lwwp-leistung').value = lwWp.leistungKw;
        document.getElementById('lwwp-lwa').value = lwWp.lwaDb;
        if (project.lwWp.jaz) document.getElementById('lwwp-jaz').value = project.lwWp.jaz;
        if (project.lwWp.waerme) document.getElementById('lwwp-waerme').value = project.lwWp.waerme;
        if (project.lwWp.minCop) document.getElementById('lwwp-min-cop').value = project.lwWp.minCop;
        document.getElementById('lwwp-data-section').style.display = 'block';
        window.lwWpVisible = true; window.lwWpVisible = true; window.lwWpVisible = true; if (!window.lwWpLayerGroup) window.lwWpLayerGroup = L.layerGroup().addTo(map); redrawLwWp(); updateLwWpDisplay(); updateLwWpVisibility();
      }
      if (project.geoThermie && project.geoThermie.lat != null) {
        if (!geoLayerGroup) setGeoLayerGroup(L.layerGroup().addTo(map));
        setGeoThermie({ ...project.geoThermie });
        document.getElementById('geo-heizlast').value = project.geoThermie.heizlast || '';
        document.getElementById('geo-waerme').value = project.geoThermie.waerme || '';
        document.getElementById('geo-jaz').value = project.geoThermie.jaz || 4.5;
        document.getElementById('geo-tiefe').value = project.geoThermie.tiefe || 100;
        document.getElementById('geo-q-perm').value = Math.min(60, Math.max(10, project.geoThermie.qPerM || 31));
        document.getElementById('geo-abstand').value = Math.min(15, Math.max(6, project.geoThermie.abstand || 10));
        document.getElementById('geo-lambda').value = Math.min(5, Math.max(0.5, project.geoThermie.lambda || 2.0));
        document.getElementById('geo-guetegrad').value = Math.min(0.70, Math.max(0.20, project.geoThermie.guetegrad || 0.50));
        if (project.geoThermie.dtAbsenkung != null) document.getElementById('geo-dt-absenkung').value = project.geoThermie.dtAbsenkung;
        document.getElementById('btn-place-geo').textContent = 'Position verschieben';
        calcGeoThermie(); redrawGeo();
      }

      if (project.gasKessel) {
        setGasKessel({ leistungKw: project.gasKessel.leistungKw || 500 });
        document.getElementById('gk-leistung').value = gasKessel.leistungKw;
        if (project.gasKessel.eta)      document.getElementById('gk-eta').value      = project.gasKessel.eta;
        if (project.gasKessel.waerme)   document.getElementById('gk-waerme').value   = project.gasKessel.waerme;
        document.getElementById('btn-activate-gaskessel').style.display = 'none';
        document.getElementById('gaskessel-data-section').style.display = 'block';
        redrawGasKessel(); updateGasKesselDisplay();
      }
      if (project.heizoelKessel) {
        setHeizoelKessel({ leistungKw: project.heizoelKessel.leistungKw || 500 });
        document.getElementById('hko-leistung').value = heizoelKessel.leistungKw;
        if (project.heizoelKessel.eta)      document.getElementById('hko-eta').value      = project.heizoelKessel.eta;
        if (project.heizoelKessel.waerme)   document.getElementById('hko-waerme').value   = project.heizoelKessel.waerme;
        document.getElementById('btn-activate-heizoel').style.display = 'none';
        document.getElementById('heizoel-data-section').style.display = 'block';
        redrawHeizoelKessel(); updateHeizoelDisplay();
      }
      if (project.bhkw) {
        setBhkw({ leistungThKw: project.bhkw.leistungThKw || 100 });
        document.getElementById('bhkw-leistung-th').value = bhkw.leistungThKw;
        if (project.bhkw.skz)     document.getElementById('bhkw-skz').value     = project.bhkw.skz;
        if (project.bhkw.eta)     document.getElementById('bhkw-eta').value     = project.bhkw.eta;
        if (project.bhkw.waerme)  document.getElementById('bhkw-waerme').value  = project.bhkw.waerme;
        document.getElementById('btn-activate-bhkw').style.display = 'none';
        document.getElementById('bhkw-data-section').style.display = 'block';
        moBeiAktivierung('bhkw'); updateBhkwDisplay();
      }
      if (project.stromkessel) {
        setStromkessel({ leistungKw: project.stromkessel.leistungKw || 200 });
        document.getElementById('sk-leistung').value = stromkessel.leistungKw;
        if (project.stromkessel.eta)    document.getElementById('sk-eta').value    = project.stromkessel.eta;
        if (project.stromkessel.waerme) document.getElementById('sk-waerme').value = project.stromkessel.waerme;
        document.getElementById('btn-activate-stromkessel').style.display = 'none';
        document.getElementById('stromkessel-data-section').style.display = 'block';
        moBeiAktivierung('stromkessel'); updateStromkesselDisplay();
      }
      if (project.solarthermie) {
        document.getElementById('st-flaeche').value = project.solarthermie.flaeche || 0;
        document.getElementById('st-spez').value = project.solarthermie.spez || 400;
        setSolarthermieAktiv((project.solarthermie.flaeche || 0) > 0);
        if (project.solarthermie.polygon && project.solarthermie.polygon.length >= 3) {
          window._stPolygon = project.solarthermie.polygon;
          _attachSTLayer(project.solarthermie.polygon);
          const srcEl = document.getElementById('st-flaeche-src');
          if (srcEl) srcEl.textContent = '(aus Karte)';
        }
        updateSolarthermieDisplay();
        document.getElementById('solarthermie-panel').style.display = 'block';
      }
      if (project.waermespeicher) {
        document.getElementById('ts-typ').value = project.waermespeicher.typ || 'puffer';
        document.getElementById('ts-volumen').value = project.waermespeicher.volumen || 0;
        document.getElementById('ts-dt').value = project.waermespeicher.dt || 40;
        document.getElementById('ts-verlust').value = project.waermespeicher.verlust || 0.5;
        document.getElementById('ts-entlade-kw').value = project.waermespeicher.entladeKw || 200;
        document.getElementById('ts-lade-kw').value = project.waermespeicher.ladeKw || project.waermespeicher.entladeKw || 200;
        setThermSpeicherAktiv((project.waermespeicher.volumen || 0) > 0);
        updateThermSpeicherDisplay();
        document.getElementById('therm-speicher-panel').style.display = 'block';
      }
      if (project.kaelte?.eingabe) {
        const e = project.kaelte.eingabe;
        const sv = (id, val) => { const el = document.getElementById(id); if (el != null && val != null) el.value = val; };
        const sc = (id, val) => { const el = document.getElementById(id); if (el != null && val != null) el.checked = !!val; };
        sv('kaelte-last-mode', e.lastMode); sv('kaelte-mwh', e.mwh); sv('kaelte-nutzung', e.nutzung);
        sv('kaelte-spez', e.spez); sv('kaelte-flaeche', e.flaeche);
        sv('kaelte-kuehlgrenze', e.kuehlgrenze); sv('kaelte-kw-vl', e.kaltwasserVl);
        sc('kaelte-revwp-on', e.revwp?.on); sv('kaelte-revwp-quelle', e.revwp?.quelle);
        sv('kaelte-revwp-gg', e.revwp?.guetegradK); sc('kaelte-revwp-auto', e.revwp?.auto);
        sv('kaelte-revwp-kw', e.revwp?.leistungKw); sc('kaelte-revwp-freecool', e.revwp?.freecool);
        sc('kaelte-chiller-on', e.chiller?.on); sv('kaelte-chiller-quelle', e.chiller?.quelle);
        sv('kaelte-chiller-gg', e.chiller?.guetegradK); sv('kaelte-chiller-kw', e.chiller?.leistungKw);
        sc('kaelte-chiller-freecool', e.chiller?.freecool);
        sv('kaelte-freecool-dt', e.freecoolDtMin); sv('kaelte-freecool-eer', e.freecoolEer);
        sv('kaelte-invest-chiller', e.investChillerEurKw); sv('kaelte-invest-revwp', e.investRevwpEurKw);
        sv('kaelte-zins', e.zins);
        if (e.lastMode) { const el = document.getElementById('kaelte-last-direkt-wrap'); const fl = document.getElementById('kaelte-last-flaeche-wrap');
          if (el) el.style.display = e.lastMode === 'direkt' ? '' : 'none';
          if (fl) fl.style.display = e.lastMode === 'flaeche' ? '' : 'none'; }
        if ((e.revwp?.on) || (e.chiller?.on)) document.getElementById('kaelte-panel').style.display = 'block';
      }
      if (project.freiflaechen && project.freiflaechen.length > 0) {
        project.freiflaechen.forEach(ff => {
          const obj = { id: ff.id, name: ff.name, polygon: ff.polygon, flaeche: ff.flaeche, gcr: ff.gcr !== undefined ? ff.gcr : 35, ausrichtung: ff.ausrichtung || 'sued' };
          freiflaechen.push(obj);
          if (obj.id >= ffCounter) setFfCounter(obj.id + 1);
          attachFFLayer(obj);
        });
        renderFFPanel();
      }
      if (project.pvModul) {
        if (project.pvModul.breite) document.getElementById('pv-modul-breite').value = project.pvModul.breite;
        if (project.pvModul.laenge) document.getElementById('pv-modul-laenge').value = project.pvModul.laenge;
        if (project.pvModul.wp)     document.getElementById('pv-modul-wp').value     = project.pvModul.wp;
      }
      if (project.pvPanel) {
        if (project.pvPanel.kwp)          { const el = document.getElementById('pv-kwp');             if (el) el.value = project.pvPanel.kwp; }
        if (project.pvPanel.spez)         { const el = document.getElementById('pv-spez');            if (el) el.value = project.pvPanel.spez; }
        if (project.pvPanel.ausrichtung) { const el = document.getElementById('pv-ausrichtung');     if (el) el.value = project.pvPanel.ausrichtung; }
        if (project.pvPanel.quartierMwh)  { const el = document.getElementById('strom-quartier-mwh'); if (el) el.value = project.pvPanel.quartierMwh; }
        if (project.pvPanel.strompreis)   { const el = document.getElementById('strom-preis-bezug');  if (el) el.value = project.pvPanel.strompreis; _onStrompreisChange('strom-preis-bezug'); }
        if (project.pvPanel.einspeisung)   { const el = document.getElementById('strom-preis-einsp');    if (el) el.value = project.pvPanel.einspeisung; }
        if (project.pvPanel.leistungspreis){ const el = document.getElementById('strom-leistungspreis'); if (el) el.value = project.pvPanel.leistungspreis; }
      }
      if (project.meritOrderKeys) {
        setMeritOrderKeys(project.meritOrderKeys.filter(k => isErzeugerAktiv(k)));
      }
      if (project.pelletsKessel) {
        setPelletsKessel({ leistungKw: project.pelletsKessel.leistungKw || 300 });
        if (project.pelletsKessel.lat != null) { pelletsKessel.lat = project.pelletsKessel.lat; pelletsKessel.lng = project.pelletsKessel.lng; }
        if (project.pelletsKessel.eta) document.getElementById('pk-eta').value = project.pelletsKessel.eta;
        if (project.pelletsKessel.waerme) document.getElementById('pk-waerme').value = project.pelletsKessel.waerme;
        document.getElementById('btn-activate-pellets').style.display = 'none';
        document.getElementById('pellets-data-section').style.display = 'block';
        redrawPellets(); updatePelletsDisplay();
      }
      if (project.heizhackschnitzel) {
        setHeizhackschnitzel({ leistungKw: project.heizhackschnitzel.leistungKw || 400 });
        if (project.heizhackschnitzel.lat != null) { heizhackschnitzel.lat = project.heizhackschnitzel.lat; heizhackschnitzel.lng = project.heizhackschnitzel.lng; }
        if (project.heizhackschnitzel.eta) document.getElementById('hhs-eta').value = project.heizhackschnitzel.eta;
        if (project.heizhackschnitzel.waerme) document.getElementById('hhs-waerme').value = project.heizhackschnitzel.waerme;
        document.getElementById('btn-activate-hhs').style.display = 'none';
        document.getElementById('hhs-data-section').style.display = 'block';
        redrawHhs(); updateHhsDisplay();
      }
      if (project.fernwaerme) {
        setFernwaerme({ leistungKw: project.fernwaerme.leistungKw || 500 });
        if (project.fernwaerme.lat != null) { fernwaerme.lat = project.fernwaerme.lat; fernwaerme.lng = project.fernwaerme.lng; }
        if (project.fernwaerme.waerme) document.getElementById('fw-waerme').value = project.fernwaerme.waerme;
        if (project.fernwaerme.co2f) document.getElementById('fw-co2f').value = project.fernwaerme.co2f;
        document.getElementById('btn-activate-fernwaerme').style.display = 'none';
        document.getElementById('fernwaerme-data-section').style.display = 'block';
        redrawFernwaerme(); updateFernwaermeDisplay();
      }
      // Emissionsfaktoren
      if (project.heizoelEmF) { setHeizoelEmF(project.heizoelEmF); document.getElementById('heizoel-emf').value = heizoelEmF; }
      if (project.gasEmF)     { setGasEmF(project.gasEmF);     document.getElementById('gas-emf').value      = gasEmF; }
      if (project.pelletsEmF)     { setPelletsEmF(project.pelletsEmF);     document.getElementById('pellets-emf').value      = pelletsEmF; }
      if (project.hhsEmF)         { setHhsEmF(project.hhsEmF);         document.getElementById('hhs-emf').value          = hhsEmF; }
      if (project.fernwaermeEmF)  { setFernwaermeEmF(project.fernwaermeEmF);  document.getElementById('fernwaerme-emf').value   = fernwaermeEmF; }
      if (project.stromEmF)   { setStromEmF(project.stromEmF);   document.getElementById('strom-emf').value    = stromEmF; }
      if (project.stromEmFLZ) { setStromEmFLZ(project.stromEmFLZ); document.getElementById('strom-emf-lz').value = stromEmFLZ; }
      if (project.pefStrom      != null) { setPefStrom(project.pefStrom);      document.getElementById('pef-strom').value      = pefStrom; }
      if (project.pefWP         != null) { setPefWP(project.pefWP);         document.getElementById('pef-wp').value         = pefWP; }
      if (project.pefGas        != null) { setPefGas(project.pefGas);        document.getElementById('pef-gas').value        = pefGas; }
      if (project.pefHeizoel    != null) { setPefHeizoel(project.pefHeizoel);    document.getElementById('pef-heizoel').value    = pefHeizoel; }
      if (project.pefPellets    != null) { setPefPellets(project.pefPellets);    document.getElementById('pef-pellets').value    = pefPellets; }
      if (project.pefHhs        != null) { setPefHhs(project.pefHhs);        document.getElementById('pef-hhs').value        = pefHhs; }
      if (project.pefFernwaerme != null) { setPefFernwaerme(project.pefFernwaerme); document.getElementById('pef-fernwaerme').value = pefFernwaerme; }
      // Wirtschaftlichkeits-Overrides wiederherstellen
      if (project.wirtBausteineOverrides) window._wirtBausteineOverrides = project.wirtBausteineOverrides;
      if (project.wirtVdiOverrides)       window._wirtVdiOverrides       = project.wirtVdiOverrides;
      // Varianten wiederherstellen (immer mit Basisdaten starten beim Laden)
      _restoreVariantenKernzustand({
        varianten: project.varianten || [],
        activeVariantId: null,
        baseNetzSnapshot: project.baseNetzSnapshot || null,
        baseErzeugerSnapshot: project.baseErzeugerSnapshot || null,
        baseStromNetzSnapshot: project.baseStromNetzSnapshot || null,
        phasen: project.phasen || [],
      });
      renderVariantenBar();
      updateVariantBanner();

      // Stromnetz löschen, dann Elektro-Assets wiederherstellen
      // (drawAssetMarker registriert Assets als Strom-Knoten, addStromEdge braucht sie)
      clearStromNetz();
      if (project.elektroAssets && (project.elektroAssets.items || []).length > 0) {
        // Gespeicherte Assets laden — nur Datenobjekte erstellen, kein Marker-Zeichnen hier
        (project.elektroAssets.items || []).forEach(data => {
          const loaded = createAsset(data.type, data.lat, data.lng, {
            id: data.id, name: data.name, buildingId: data.buildingId,
            _movedByUser: data._movedByUser || false,
            props: data.props || {}, baujahr: data.baujahr,
            abrissjahr: data.abrissjahr, massnahmen: data.massnahmen || []
          });
          if (loaded && data.linkedErzeuger) loaded.linkedErzeuger = data.linkedErzeuger;
          if (loaded && data.linkedFF)       loaded.linkedFF       = data.linkedFF;
        });
      } else if (typeof window.autoCreateBuildingAssets === 'function' && Array.isArray(window.gebaeude)) {
        // Altes Projekt ohne gespeicherte Assets → jetzt einmalig auto-erstellen
        window.gebaeude.forEach(g => {
          try { window.autoCreateBuildingAssets(g); } catch(e) {}
        });
      }
      // Alle Asset-Marker sauber und einmalig neu zeichnen — bereinigt alle Layer-Duplikate
      redrawAllAssets();
      if (project.stromNetz) {
        if (project.stromNetz.kabelTyp) {
          const ktSel = document.getElementById('strom-kabel-typ');
          if (ktSel) ktSel.value = project.stromNetz.kabelTyp;
        }
        if (project.stromNetz.nodes) {
          // Asset-Typen, die NIE als „plain" Strom-Knoten existieren (immer ein Asset):
          // Erzeuger/Verbraucher/Speicher (PV, Wind, Batterie, Verbraucher, …).
          // Infrastruktur (NAP/Trafo/NSHV/UV/KVS) kann dagegen ein Plain-Knoten sein
          // (Auto-Netz, manuelles Zeichnen) → die nicht filtern.
          const _nonInfraAssetTypes = new Set(
            Object.entries(ASSET_CFG)
              .filter(([, cfg]) => cfg.domain !== 'waerme' && cfg.kategorie !== 'infrastruktur')
              .map(([k]) => k.toLowerCase())
          );
          project.stromNetz.nodes.forEach(n => {
            // Assets wurden bereits via redrawAllAssets() als stromNodes registriert (isAsset:true)
            // → nicht nochmal als plain addStromNode() erstellen (würde graue Duplikat-Marker erzeugen)
            if ((window.stromNodes || []).find(sn => sn.id === n.id && sn.isAsset)) return;
            // Verwaister Knoten eines gelöschten Erzeuger/Verbraucher-Assets (z. B. PV):
            // existiert kein Asset mehr mit dieser id → überspringen (sonst grauer Geister-Marker).
            if (_nonInfraAssetTypes.has((n.type || '').toLowerCase())
                && !ASSETS.items.some(a => a.id === n.id)) return;
            addStromNode(n.type, L.latLng(n.lat, n.lng), {
              id: n.id, label: n.label, maxKva: n.maxKva, ratedKva: n.ratedKva, ukPct: n.ukPct
            });
          });
        }
        // Gebäude-Strom-Knoten VOR Kantenwiederherstellung registrieren,
        // damit infra→geb Kanten nicht fehlschlagen (geb-Knoten müssen existieren)
        if (typeof window.gebaeude !== 'undefined') {
          window.gebaeude.forEach(g => {
            if (stromNodes.find(n => n.id === g.id && n.type === 'geb')) return;
            const stromMwh = typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : (parseFloat(g.strom) || 0);
            if (stromMwh <= 0) return;
            const center = g.polygon ? polygonCenter(g.polygon) : null;
            if (!center) return;
            const gebIcon = L.divIcon({ className: '', html: '<div class="strom-icon strom-icon-geb">⚡</div>', iconSize: [14, 14], iconAnchor: [7, 7] });
            const gebMarker = L.marker(center, { icon: gebIcon, interactive: true, zIndexOffset: 2000 });
            gebMarker.bindTooltip(function() {
              const n = stromNodes.find(sn => sn.id === g.id);
              let tt = '<b>' + g.name + '</b> (Strom)';
              if (n && n.peakLoadKw) tt += '<br>Last: ' + n.peakLoadKw.toFixed(1) + ' kW';
              if (n && n.annualMwh) tt += '<br>Verbrauch: ' + n.annualMwh.toFixed(1) + ' MWh/a';
              if (n && n.isProducer) tt += '<br><span style="color:#66bb6a">Einspeiser (PV)</span>';
              return tt;
            }, { sticky: true, className: 'geb-tooltip' });
            gebMarker.on('click', function() { stromNodeClick(g.id); });
            if (stromNetzVisible) gebMarker.addTo(map);
            stromNodes.push({
              id: g.id, type: 'geb', lat: center.lat, lng: center.lng,
              marker: gebMarker, label: g.name, peakLoadKw: 0, annualMwh: 0, isProducer: false
            });
          });
        }
        if (project.stromNetz.edges) {
          project.stromNetz.edges.forEach(se => {
            const edge = addStromEdge(se.u, se.v);
            if (edge) {
              edge.cableType = se.cableType || 'NAYY';
              edge.crossSection = se.crossSection || 0;
              edge.autoSized = se.autoSized !== false;
              edge.fuseA = se.fuseA || 0;
              edge.nParallel = se.nParallel || 1;
            }
          });
        }
        // Asset-Kanten (beide Endpunkte sind Assets) nach allen Knoten wiederherstellen
        if (project.elektroAssets) {
          (project.elektroAssets.edges || []).forEach(eData => {
            const edge = addStromEdge(eData.u, eData.v);
            if (edge) {
              if (eData.id) edge.id = eData.id;
              edge.cableType = eData.cableType || 'NAYY';
              edge.crossSection = eData.crossSection || 0;
              edge.autoSized = eData.autoSized !== false;
              edge.fuseA = eData.fuseA || 0;
              edge.nParallel = eData.nParallel || 1;
              edge.autoGenerated = eData.autoGenerated || false;
              edge.msLevel = eData.msLevel || edge.msLevel || false; // addStromEdge auto-detects; keep true if detected
              edge.trennstelle = eData.trennstelle || false;
              edge.massnahmen = eData.massnahmen || [];
              // Bau-/Abrissjahr werden ohnehin aus den Endpunkten neu abgeleitet;
              // gespeicherte Werte als Startwert übernehmen, falls vorhanden.
              if (eData.baujahr != null)    edge.baujahr    = eData.baujahr;
              if (eData.abrissjahr != null) edge.abrissjahr = eData.abrissjahr;
              if (edge.msLevel) {
                edge.layer?.setStyle({ color: '#7c4dff', weight: 4, dashArray: null });
              }
              if (edge.trennstelle) {
                edge.layer?.setStyle({ dashArray: '10,8', opacity: 0.5 });
              }
            }
          });
        }
        // MS-Migration: Kanten zwischen NAP/Schaltanlage nachträglich als MS markieren
        // (Kanten die vor der Auto-Erkennung gespeichert wurden haben msLevel:false)
        const MS_TYPES_RESTORE = new Set(['nap', 'schaltanlage']);
        (window.stromEdges || []).forEach(e => {
          const uN = window.stromNodes.find(n => n.id === e.u);
          const vN = window.stromNodes.find(n => n.id === e.v);
          if (!uN || !vN) return;
          const uT = (uN.type || '').toLowerCase();
          const vT = (vN.type || '').toLowerCase();
          if (MS_TYPES_RESTORE.has(uT) && MS_TYPES_RESTORE.has(vT) && !e.msLevel) {
            e.msLevel = true;
            e.layer?.setStyle({ color: '#7c4dff', weight: 4, opacity: 0.95, dashArray: '' });
            e.outlineLayer?.setStyle({ color: '#0a0e1a', weight: 7, opacity: 0.4, dashArray: '' });
          }
        });
        recalcStromNetz();
      }

      // Custom Nutzungstypen wiederherstellen
      if (Array.isArray(project.customNutzungstypen)) {
        NUTZUNGSTYPEN_CUSTOM.length = 0;
        project.customNutzungstypen.forEach(t => NUTZUNGSTYPEN_CUSTOM.push({ ...t }));
      }

      // Elektrische SLP-Profile wiederherstellen
      if (Array.isArray(project.customElSlpProfiles)) {
        ELSLP_CUSTOM.length = 0;
        project.customElSlpProfiles.forEach(p => ELSLP_CUSTOM.push({ ...p }));
      }
      if (project.elSlpWpm2Overrides && typeof project.elSlpWpm2Overrides === 'object') {
        Object.keys(ELSLP_WPM2).forEach(k => delete ELSLP_WPM2[k]);
        Object.assign(ELSLP_WPM2, project.elSlpWpm2Overrides);
      }

      // ERA5-Standort-Winddaten wiederherstellen — bzw. leeren, wenn das geladene
      // Projekt keine enthält (sonst blieben Daten der vorigen Liegenschaft aktiv)
      if (typeof window.windSiteRestore === 'function') {
        window.windSiteRestore(project.windStandortDaten || null);
      }

      // Plan-Overlays (Hintergrundpläne) wiederherstellen bzw. leeren
      if (typeof window.loadOverlays === 'function') window.loadOverlays(project.overlays || []);

      redrawErzeugerIcons();
      _initYearSliderFromBaujahr();
      _invalidateStats();
      renderList();
      updateViz();
      updateTotals();
      glBerechnenDebounced(800);

      // Standard-Ansicht: nur Gebäudeumrisse + PV (Symbole „Keine", übrige Ebenen aus)
      if (typeof window.applyDefaultViewOnLoad === 'function') window.applyDefaultViewOnLoad();

      // Auf die geladene Liegenschaft springen (Gesamt-Umriss aller Gebäude;
      // ersatzweise alle Asset-Positionen).
      try {
        const bounds = L.latLngBounds([]);
        (window.gebaeude || []).forEach(g => {
          if (g.polygonLayer) bounds.extend(g.polygonLayer.getBounds());
        });
        if (!bounds.isValid()) {
          (ASSETS.items || []).forEach(a => {
            if (a.lat != null && a.lng != null) bounds.extend([a.lat, a.lng]);
          });
        }
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 19 });
      } catch (e) { /* Karte bleibt auf aktueller Position */ }
}

export function loadGebaeudeFromParent(gebaeudeArray) {
  if (!Array.isArray(gebaeudeArray)) return;
  window.gebaeude.forEach(g => {
    if (g.polygonLayer) map.removeLayer(g.polygonLayer);
    if (g.circleMarker) map.removeLayer(g.circleMarker);
    if (g.labelMarker) map.removeLayer(g.labelMarker);
  });
  window.gebaeude = [];
  clearNetz();
  clearTrasse();
  setIdCounter(1);
  gebaeudeArray.forEach(g => {
    const newG = addGebaeude({ id: g.id, coords: g.polygon, name: g.name || 'Gebäude ' + g.id, fromOsm: g.fromOsm || false, osmId: g.osmId || null, stockwerke: g.stockwerke != null ? g.stockwerke : 1, baujahr: g.baujahr || null });
    newG.waerme = g.waerme;
    newG.heizlast = g.heizlast;
    newG.spez = g.spez;
    newG.spezHeizlast = g.spezHeizlast;
    newG.flaeche = g.flaeche;
    newG.baujahr = g.baujahr;
    newG.baujährQuelle = g.baujährQuelle || null;
    newG.abrissjahr = g.abrissjahr;
    newG.sanierungen = g.sanierungen || [];
    newG.nutzung = g.nutzung || '';
    if (g.id >= idCounter) setIdCounter(g.id + 1);
  });
  _initYearSliderFromBaujahr();
  _invalidateStats();
  renderList();
  updateViz();
  updateTotals();
  showHint('Gebäude aus Liegenschaftsrechner übernommen.');
  setTimeout(hideHint, 2500);
}

export function sendToLiegenschaftsrechner() {
  if (window.parent === window) return;
  const payload = window.gebaeude.map(g => ({
    id: g.id, name: g.name, waerme: g.waerme, heizlast: g.heizlast, spez: g.spez, spezHeizlast: g.spezHeizlast,
    flaeche: g.flaeche, nutzung: g.nutzung, fromOsm: g.fromOsm, osmId: g.osmId, polygon: g.polygon,
    baujahr: g.baujahr, abrissjahr: g.abrissjahr, sanierungen: g.sanierungen || [], stockwerke: g.stockwerke != null ? g.stockwerke : 1
  }));
  window.parent.postMessage({ type: 'ENERGIEKARTE_APPLY_GEBAEUDE', gebaeude: payload }, '*');
  showHint('An Liegenschaftsrechner gesendet.');
  setTimeout(hideHint, 2500);
}

(function initEnergiekarteIframe() {
  if (window.self === window.top) return;
  const btn = document.getElementById('btn-send-to-lr');
  if (btn) btn.style.display = 'block';
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'ENERGIEKARTE_LOAD_BUILDINGS') return;
    if (Array.isArray(e.data.gebaeude)) loadGebaeudeFromParent(e.data.gebaeude);
  });
  setTimeout(function() { window.parent.postMessage({ type: 'ENERGIEKARTE_READY' }, '*'); }, 800);
})();

export function showHint(msg){const h=document.getElementById('hint');h.textContent=msg;h.classList.remove('hidden');}
export function hideHint(){document.getElementById('hint').classList.add('hidden');}

export const sty=document.createElement('style');
sty.textContent=`.geb-tooltip{background:#0f1117;border:1px solid #2a3050;color:#e8eaf0;font-family:'DM Sans',sans-serif;font-size:12px;padding:5px 8px;border-radius:7px;box-shadow:0 6px 24px rgba(0,0,0,.6);font-weight:normal;line-height:1.5;}.geb-tooltip .leaflet-tooltip-tip{display:none;}`;
document.head.appendChild(sty);

export let dashOffset = 0;
export let _animPipesRunning = false;
export function animatePipes() {
  if (!_animPipesRunning) return;
  dashOffset -= 0.5;
  (window.netzEdges || netzEdges).forEach(e => {
    if(e.load > 0 && e.layer && e.layer._path) {
      e.layer._path.style.strokeDasharray = "12, 12";
      e.layer._path.style.strokeDashoffset = dashOffset + "px";
    }
  });
  requestAnimationFrame(animatePipes);
}
export function startAnimPipes() { if (!_animPipesRunning) { _animPipesRunning = true; animatePipes(); } }
export function stopAnimPipes()  { _animPipesRunning = false; }

export let stromDashOffset = 0;
export let _animStromRunning = false;
export function animateStromPipes() {
  if (!_animStromRunning) return;
  stromDashOffset -= 0.6;
  (window.stromEdges || stromEdges).forEach(e => {
    if (e._flowActive && e.layer && e.layer._path) {
      e.layer._path.style.strokeDashoffset = (stromDashOffset * e._flowDir) + 'px';
    }
  });
  requestAnimationFrame(animateStromPipes);
}
export function startAnimStrom() { if (!_animStromRunning) { _animStromRunning = true; animateStromPipes(); } }
export function stopAnimStrom()  { _animStromRunning = false; }

// ── Vormerken (Feldbegehung) ──────────────────────────────────────────────────
export function toggleVormerkenGeb(id) {
  const g = window.gebaeude.find(x => x.id === id);
  if (!g) return;
  g.feldVorgemerkt = !g.feldVorgemerkt;
  _rerenderCard(id);
}
window.toggleVormerkenGeb = toggleVormerkenGeb;