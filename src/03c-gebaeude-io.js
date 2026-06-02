// ── 03c-gebaeude-io.js — Gebäude-UI, Totals, Chart, Gebäude-PV, Rendering, Projekt-Import/Export, Animation ──
import { _expandedIds, globalYear, isExcluded, selectedId, stromEdges } from './01-globals-varianten.js';
import { getColor, getColorRange, getColorVal, getComputedStats, getGebStromMwh, highlightCard, map,
         getNutzungstypen, getNutzungstypById, isBuiltinNutzungstyp, NUTZUNGSTYPEN_CUSTOM } from './02b-gebaeude.js';
import { hidePanels, populateZentraleSelect } from './03b-netz.js';
import { updateLpGebietStatus, updatePrintLegend } from './04a-ui-panels.js';
import { glGetGesamtMwh, glGetMonatswerte, glLastgangKw } from './06a-gbi-lastgang.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { ASSETS, ASSET_CFG, getAssetStatus, getAssetsForBuilding, createAsset, clearAssets } from './13a-assets-core.js';
import { drawAssetMarker, redrawAllAssets } from './13b-assets-render.js';
import { ELSLP_CUSTOM, ELSLP_WPM2, getElSlpProfiles, getElSlpGruppen, getElSlpById } from './13k-elslp-registry.js';

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

export function calcGebKwp(g) {
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

  // Flachdach: Aufständerung auf 30° Süd → immer optimal
  if (dachform === 'flach') return 1.0;

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
        rightIndicator = `<span class="geb-elektro-metric" style="color:#ffd54f;">${(+a.props.leistungKWp).toLocaleString('de-DE',{maximumFractionDigits:1})} kWp</span>`;
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
  const slpPr   = getElSlpById(slpTyp);
  const wpm2    = slpPr?.wpm2 ?? 20;
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
        <span class="geb-dach-kwp-badge" style="color:#4fc3f7;">${badge}</span>
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
          ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;font-family:'DM Mono',monospace;">
               ↳ ${Math.round(fl)} m² × ${wpm2} W/m² ÷ 1000 = ${autoKw} kW (${slpTyp})
             </div>`
          : `<div style="font-size:9px;color:rgba(249,168,37,.7);margin-top:2px;">↳ Keine Fläche — manuelle Eingabe</div>`}
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

// Wenn SLP im Leistungsschätzung-Reiter ändert: kW-Schätzung live aktualisieren
window.updateGebVerbrSlp = function(gId, slpId) {
  const g   = window.gebaeude?.find(x => x.id === gId);
  if (!g) return;
  const fl   = parseFloat(g.flaeche) || 0;
  const wpm2 = getElSlpById(slpId)?.wpm2 ?? 20;
  const autoKw = fl > 0 ? Math.round(fl * wpm2 / 1000 * 10) / 10 : null;
  const kwInp = document.getElementById(`geb-verbr-kw-${gId}`);
  if (kwInp && autoKw != null) kwInp.value = autoKw;
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

// Berechnetes kWp (Dach & PV) in PV-Asset schreiben
window.overwritePvAsset = function(gId) {
  const g  = window.gebaeude?.find(x => x.id === gId);
  const pv = getAssetsForBuilding(gId).find(a => a.type === 'PV');
  if (!pv || !g) { alert('Kein PV-Asset für dieses Gebäude gefunden.'); return; }
  const kwp = calcGebKwpKorr(g);
  if (!pv.props) pv.props = {};
  pv.props.leistungKWp = Math.round(kwp * 10) / 10;
  _rerenderCard(gId);
};

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

const SLP_OPTS = ['H0','G0','G1','G2','G3','G4','G5','G6','L0','L1','L2'];

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
        ${SLP_OPTS.map(s => `<option${(data.slp||'G0')===s?' selected':''}>${s}</option>`).join('')}
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
  const korrFak   = getPvKorrFaktor(g);
  const kwpBase   = calcGebKwp(g);
  const kwpKorr   = calcGebKwpKorr(g);
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
  const pvOverwriteBtn = (pvAsset && g.flaeche && kwpKorr > 0) ? `
    <button class="btn-xs" style="width:100%;margin-top:5px;display:flex;justify-content:center;gap:4px;border-color:#ffd54f;color:#ffd54f;"
      data-click="overwritePvAsset(${g.id})">
      ☀ ${kwpKorr.toFixed(1)} kWp → PV-Asset überschreiben
    </button>` : '';

  const pvPreview = g.flaeche ? `
    <div class="geb-dach-kwp-row">
      <span>☀ Basis</span><span>${kwpBase.toFixed(1)} kWp</span>
      <span>Faktor</span>
      <span style="color:${fakCol};font-weight:600;">${(korrFak * 100).toFixed(0)} %</span>
      <span style="font-weight:600;">= Korr.</span>
      <span style="color:${fakCol};font-weight:600;">${kwpKorr.toFixed(1)} kWp</span>
    </div>
    ${pvOverwriteBtn}` : '';

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
        ${pvPreview}
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
  } else if (field === 'dachAzimut') {
    g.dachAzimut = value === '' ? null : parseFloat(value);
    g.dachAutoAzimut = false;
  } else if (field === 'dachNeigung') {
    g.dachNeigung = value === '' ? null : parseFloat(value);
  }
  _rerenderCard(gId);
};

window.ermittleAzimut = function(gId) {
  const g = window.gebaeude?.find(x => x.id === gId);
  if (!g?.polygon) return;
  const az = detectRoofAzimutFromPolygon(g.polygon);
  if (az === null) return;
  g.dachAzimut     = az;
  g.dachAutoAzimut = true;
  _rerenderCard(gId);
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
    `<img src="${foto.dataUrl}" title="${escHtml(foto.name)}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="window.open(this.src)">`
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
    const stats = getComputedStats(g, globalYear);
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
    waermespeicher: thermSpeicherAktiv ? { typ: document.getElementById('ts-typ')?.value||'puffer', volumen: parseFloat(document.getElementById('ts-volumen')?.value)||0, dt: parseFloat(document.getElementById('ts-dt')?.value)||40, verlust: parseFloat(document.getElementById('ts-verlust')?.value)||0.5, entladeKw: parseFloat(document.getElementById('ts-entlade-kw')?.value)||200 } : null,
    freiflaechen: freiflaechen.map(ff => ({ id: ff.id, name: ff.name, polygon: ff.polygon, flaeche: ff.flaeche, gcr: ff.gcr, ausrichtung: ff.ausrichtung })),
    pvModul: { breite: document.getElementById('pv-modul-breite')?.value, laenge: document.getElementById('pv-modul-laenge')?.value, wp: document.getElementById('pv-modul-wp')?.value },
    pvPanel: { kwp: document.getElementById('pv-kwp')?.value, spez: document.getElementById('pv-spez')?.value, ausrichtung: document.getElementById('pv-ausrichtung')?.value, quartierMwh: document.getElementById('strom-quartier-mwh')?.value, strompreis: document.getElementById('strom-preis-bezug')?.value, einspeisung: document.getElementById('strom-preis-einsp')?.value, leistungspreis: document.getElementById('strom-leistungspreis')?.value },
    meritOrderKeys: [...window.meritOrderKeys],
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
    varianten: varianten,
    activeVariantId: activeVariantId,
    baseNetzSnapshot: baseNetzSnapshot,
    baseErzeugerSnapshot: baseErzeugerSnapshot,
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
            autoGenerated: e.autoGenerated || false, msLevel: e.msLevel || false, trennstelle: e.trennstelle || false
          }))
      };
    })(),
    customNutzungstypen: NUTZUNGSTYPEN_CUSTOM.map(t => ({ ...t })),
    customElSlpProfiles: ELSLP_CUSTOM.map(p => ({ ...p })),
    elSlpWpm2Overrides:  { ...ELSLP_WPM2 },
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
      idCounter = 1;

      if (project.gebaeude) {
         _batchImporting = true;
         try { project.gebaeude.forEach(g => {
            const newG = addGebaeude({ id: g.id, coords: g.polygon, name: g.name, fromOsm: g.fromOsm, osmId: g.osmId, skipAutoCreate: true });
            newG.waerme = g.waerme;
            newG.heizlast = g.heizlast;
            newG.spez = g.spez;
            newG.spezHeizlast = g.spezHeizlast;
            newG.flaeche = g.flaeche;
            newG.baujahr = g.baujahr;
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
            if (g.id >= idCounter) idCounter = g.id + 1;
         });
         } finally { _batchImporting = false; }
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
           kostenSzenario = project.netz.kostenSzenario;
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
         trassePoints = project.trasse.map(p => L.latLng(p.lat, p.lng));
         trasseSegments = project.trasseSegments || [];
         trasseCurrentSegStart = trassePoints.length;
         redrawTrasse();
      }

      edgeWaypoints = project.edgeWaypoints || {};
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
        fliessgewaesser = {
          latlngs: project.fliessgewaesser.latlngs,
          durchflussLs: project.fliessgewaesser.durchflussLs || 50,
          leistungKw: project.fliessgewaesser.leistungKw || 200,
          jaz: project.fliessgewaesser.jaz || 4.5,
          visible: project.fliessgewaesser.visible !== false
        };
        fliessgewaesserVisible = fliessgewaesser.visible;
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
        if (!geoLayerGroup) geoLayerGroup = L.layerGroup().addTo(map);
        geoThermie = { ...project.geoThermie };
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
        gasKessel = { leistungKw: project.gasKessel.leistungKw || 500 };
        document.getElementById('gk-leistung').value = gasKessel.leistungKw;
        if (project.gasKessel.eta)      document.getElementById('gk-eta').value      = project.gasKessel.eta;
        if (project.gasKessel.waerme)   document.getElementById('gk-waerme').value   = project.gasKessel.waerme;
        document.getElementById('btn-activate-gaskessel').style.display = 'none';
        document.getElementById('gaskessel-data-section').style.display = 'block';
        redrawGasKessel(); updateGasKesselDisplay();
      }
      if (project.heizoelKessel) {
        heizoelKessel = { leistungKw: project.heizoelKessel.leistungKw || 500 };
        document.getElementById('hko-leistung').value = heizoelKessel.leistungKw;
        if (project.heizoelKessel.eta)      document.getElementById('hko-eta').value      = project.heizoelKessel.eta;
        if (project.heizoelKessel.waerme)   document.getElementById('hko-waerme').value   = project.heizoelKessel.waerme;
        document.getElementById('btn-activate-heizoel').style.display = 'none';
        document.getElementById('heizoel-data-section').style.display = 'block';
        redrawHeizoelKessel(); updateHeizoelDisplay();
      }
      if (project.bhkw) {
        bhkw = { leistungThKw: project.bhkw.leistungThKw || 100 };
        document.getElementById('bhkw-leistung-th').value = bhkw.leistungThKw;
        if (project.bhkw.skz)     document.getElementById('bhkw-skz').value     = project.bhkw.skz;
        if (project.bhkw.eta)     document.getElementById('bhkw-eta').value     = project.bhkw.eta;
        if (project.bhkw.waerme)  document.getElementById('bhkw-waerme').value  = project.bhkw.waerme;
        document.getElementById('btn-activate-bhkw').style.display = 'none';
        document.getElementById('bhkw-data-section').style.display = 'block';
        moBeiAktivierung('bhkw'); updateBhkwDisplay();
      }
      if (project.stromkessel) {
        stromkessel = { leistungKw: project.stromkessel.leistungKw || 200 };
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
        solarthermieAktiv = (project.solarthermie.flaeche || 0) > 0;
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
        thermSpeicherAktiv = (project.waermespeicher.volumen || 0) > 0;
        updateThermSpeicherDisplay();
        document.getElementById('therm-speicher-panel').style.display = 'block';
      }
      if (project.freiflaechen && project.freiflaechen.length > 0) {
        project.freiflaechen.forEach(ff => {
          const obj = { id: ff.id, name: ff.name, polygon: ff.polygon, flaeche: ff.flaeche, gcr: ff.gcr !== undefined ? ff.gcr : 35, ausrichtung: ff.ausrichtung || 'sued' };
          freiflaechen.push(obj);
          if (obj.id >= ffCounter) ffCounter = obj.id + 1;
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
        window.meritOrderKeys = project.meritOrderKeys.filter(k => isErzeugerAktiv(k));
      }
      if (project.pelletsKessel) {
        pelletsKessel = { leistungKw: project.pelletsKessel.leistungKw || 300 };
        if (project.pelletsKessel.lat != null) { pelletsKessel.lat = project.pelletsKessel.lat; pelletsKessel.lng = project.pelletsKessel.lng; }
        if (project.pelletsKessel.eta) document.getElementById('pk-eta').value = project.pelletsKessel.eta;
        if (project.pelletsKessel.waerme) document.getElementById('pk-waerme').value = project.pelletsKessel.waerme;
        document.getElementById('btn-activate-pellets').style.display = 'none';
        document.getElementById('pellets-data-section').style.display = 'block';
        redrawPellets(); updatePelletsDisplay();
      }
      if (project.heizhackschnitzel) {
        heizhackschnitzel = { leistungKw: project.heizhackschnitzel.leistungKw || 400 };
        if (project.heizhackschnitzel.lat != null) { heizhackschnitzel.lat = project.heizhackschnitzel.lat; heizhackschnitzel.lng = project.heizhackschnitzel.lng; }
        if (project.heizhackschnitzel.eta) document.getElementById('hhs-eta').value = project.heizhackschnitzel.eta;
        if (project.heizhackschnitzel.waerme) document.getElementById('hhs-waerme').value = project.heizhackschnitzel.waerme;
        document.getElementById('btn-activate-hhs').style.display = 'none';
        document.getElementById('hhs-data-section').style.display = 'block';
        redrawHhs(); updateHhsDisplay();
      }
      if (project.fernwaerme) {
        fernwaerme = { leistungKw: project.fernwaerme.leistungKw || 500 };
        if (project.fernwaerme.lat != null) { fernwaerme.lat = project.fernwaerme.lat; fernwaerme.lng = project.fernwaerme.lng; }
        if (project.fernwaerme.waerme) document.getElementById('fw-waerme').value = project.fernwaerme.waerme;
        if (project.fernwaerme.co2f) document.getElementById('fw-co2f').value = project.fernwaerme.co2f;
        document.getElementById('btn-activate-fernwaerme').style.display = 'none';
        document.getElementById('fernwaerme-data-section').style.display = 'block';
        redrawFernwaerme(); updateFernwaermeDisplay();
      }
      // Emissionsfaktoren
      if (project.heizoelEmF) { heizoelEmF = project.heizoelEmF; document.getElementById('heizoel-emf').value = heizoelEmF; }
      if (project.gasEmF)     { gasEmF     = project.gasEmF;     document.getElementById('gas-emf').value      = gasEmF; }
      if (project.pelletsEmF)     { pelletsEmF     = project.pelletsEmF;     document.getElementById('pellets-emf').value      = pelletsEmF; }
      if (project.hhsEmF)         { hhsEmF         = project.hhsEmF;         document.getElementById('hhs-emf').value          = hhsEmF; }
      if (project.fernwaermeEmF)  { fernwaermeEmF  = project.fernwaermeEmF;  document.getElementById('fernwaerme-emf').value   = fernwaermeEmF; }
      if (project.stromEmF)   { stromEmF   = project.stromEmF;   document.getElementById('strom-emf').value    = stromEmF; }
      if (project.stromEmFLZ) { stromEmFLZ = project.stromEmFLZ; document.getElementById('strom-emf-lz').value = stromEmFLZ; }
      if (project.pefStrom      != null) { pefStrom      = project.pefStrom;      document.getElementById('pef-strom').value      = pefStrom; }
      if (project.pefWP         != null) { pefWP         = project.pefWP;         document.getElementById('pef-wp').value         = pefWP; }
      if (project.pefGas        != null) { pefGas        = project.pefGas;        document.getElementById('pef-gas').value        = pefGas; }
      if (project.pefHeizoel    != null) { pefHeizoel    = project.pefHeizoel;    document.getElementById('pef-heizoel').value    = pefHeizoel; }
      if (project.pefPellets    != null) { pefPellets    = project.pefPellets;    document.getElementById('pef-pellets').value    = pefPellets; }
      if (project.pefHhs        != null) { pefHhs        = project.pefHhs;        document.getElementById('pef-hhs').value        = pefHhs; }
      if (project.pefFernwaerme != null) { pefFernwaerme = project.pefFernwaerme; document.getElementById('pef-fernwaerme').value = pefFernwaerme; }
      // Wirtschaftlichkeits-Overrides wiederherstellen
      if (project.wirtBausteineOverrides) window._wirtBausteineOverrides = project.wirtBausteineOverrides;
      if (project.wirtVdiOverrides)       window._wirtVdiOverrides       = project.wirtVdiOverrides;
      // Varianten wiederherstellen
      varianten = project.varianten || [];
      baseNetzSnapshot = project.baseNetzSnapshot || null;
      baseErzeugerSnapshot = project.baseErzeugerSnapshot || null;
      activeVariantId = null; // Immer mit Basisdaten starten beim Laden
      renderVariantenBar();
      updateVariantBanner();

      // Stromnetz löschen, dann Elektro-Assets wiederherstellen
      // (drawAssetMarker registriert Assets als Strom-Knoten, addStromEdge braucht sie)
      clearStromNetz();
      if (project.elektroAssets && (project.elektroAssets.items || []).length > 0) {
        // Gespeicherte Assets laden — nur Datenobjekte erstellen, kein Marker-Zeichnen hier
        (project.elektroAssets.items || []).forEach(data => {
          createAsset(data.type, data.lat, data.lng, {
            id: data.id, name: data.name, buildingId: data.buildingId,
            _movedByUser: data._movedByUser || false,
            props: data.props || {}, baujahr: data.baujahr,
            abrissjahr: data.abrissjahr, massnahmen: data.massnahmen || []
          });
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
          project.stromNetz.nodes.forEach(n => {
            // Assets wurden bereits via redrawAllAssets() als stromNodes registriert (isAsset:true)
            // → nicht nochmal als plain addStromNode() erstellen (würde graue Duplikat-Marker erzeugen)
            if ((window.stromNodes || []).find(sn => sn.id === n.id && sn.isAsset)) return;
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
              if (edge.msLevel) {
                edge.layer?.setStyle({ color: '#ff9800', weight: 4, dashArray: null });
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

      redrawErzeugerIcons();
      _invalidateStats();
      renderList();
      updateViz();
      updateTotals();
      glBerechnenDebounced(800);
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
  idCounter = 1;
  gebaeudeArray.forEach(g => {
    const newG = addGebaeude({ id: g.id, coords: g.polygon, name: g.name || 'Gebäude ' + g.id, fromOsm: g.fromOsm || false, osmId: g.osmId || null, stockwerke: g.stockwerke != null ? g.stockwerke : 1, baujahr: g.baujahr || null });
    newG.waerme = g.waerme;
    newG.heizlast = g.heizlast;
    newG.spez = g.spez;
    newG.spezHeizlast = g.spezHeizlast;
    newG.flaeche = g.flaeche;
    newG.baujahr = g.baujahr;
    newG.abrissjahr = g.abrissjahr;
    newG.sanierungen = g.sanierungen || [];
    newG.nutzung = g.nutzung || '';
    if (g.id >= idCounter) idCounter = g.id + 1;
  });
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
  netzEdges.forEach(e => {
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
  stromEdges.forEach(e => {
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