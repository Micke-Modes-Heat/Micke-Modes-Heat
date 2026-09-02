// ── 04a-ui-panels.js — Gebäude-Daten, Bulk-Edit, Filter, Panels, Layout, LP-KPIs, Analyse-Scaffold ──
// NUTZUNG_DEFAULTS → src/config/erzeuger-cfg.js

import { _getEtaMap, activeVariantId, areaPolygon, currentMode, gasEmF, gebaeude, globalYear, netzEdges, networkLocked, variantResults } from './01-globals-varianten.js';
import { getWLD } from './02a-netz-physik.js';
import { _invalidateStats, getComputedStats, getNutzungstypen, map } from './02b-gebaeude.js';
import { setGebVisible, setMode, setSchallVisible, updateViz } from './02c-karte-werkzeuge.js';
import { hidePanels, recalcNetz, setNetzVisible } from './03b-netz.js';
import { renderList, updateTotals } from './03c-gebaeude-io.js';
import { _renderEmissionenTab, refreshVergleichView, renderAnalyseDispatch } from './04b-emissionen-3d.js';
import { setStromNetzVisible } from './05b-stromnetz.js';
import { buildPalette } from './13c-assets-ui.js';
import { buildElektroPanel, renderGekoppelteStatus } from './13n-elektro-panel.js';
import { setAssetLayerVisible } from './13b-assets-render.js';
import { saSetTab } from './07a-analysis-charts.js';
import { calcWirtschaftPanel } from './07b-analysis-economics.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { _optPopulateYearSelect, _optUpdateEstimate } from './10a-optimizer-core.js';
import { _liveStopPlay, _onHourSlider, _setHourlyModeActive } from './10b-hourly-live.js';
import { autoGkResult, meritOrderKeys } from './06c-dispatch-core.js';
import { ERZEUGER_CFG, NUTZUNG_DEFAULTS } from './config/erzeuger-cfg.js';
import { KMR_KOSTEN } from './config/netz-kosten.js';
import { napBuildAnalyseSection, napShowSection } from './13o-nap-analyse.js';
import { knaBuildAnalyseSection, knaShowSection } from './13r-knotenpunkt-analyse.js';
import { pvaBuildAnalyseSection, pvaShowSection, resBuildAnalyseSection, resShowSection } from './09d-pv-analyse.js';
import { ggBuildAnalyseSection, ggShowSection } from './17-gutachten-grafik.js';
import { lbBuildAnalyseSection, lbShowSection } from './18-liegenschaftsbilder.js';
import { ausbauShow } from './14e-ausbauplaner-ui.js';
import { fernwaermeEmF, heizoelEmF, hhsEmF, pelletsEmF, stromEmF } from './01-globals-varianten.js';
import { getWLDColor } from './02a-netz-physik.js';
import { OVERPASS_ENDPOINTS, updateRohrListe } from './03b-netz.js';
import { _buildProjectData, _loadProject, hideHint, showHint } from './03c-gebaeude-io.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { netzPruningMode, setNetzPruningMode } from './01-globals-varianten.js';
import { loadLatestAutosave, saveAutosaveProject } from './lib/autosave-store.js';
import { appLifecycle } from './lib/lifecycle.js';
import { beginInteraction, cancelInteraction } from './lib/interaction-state.js';
import { getBuildingHeatProfileMeta } from './lib/building-heat-profiles.js';

export function setNutzung(id, nutzung) {
  const g = gebaeude.find(x => x.id === id);
  if (!g) return;
  g.nutzung = nutzung;
  _invalidateStats();
  const def = NUTZUNG_DEFAULTS[nutzung];
  if (def && !g.spez && !g.waerme) {
    // Only prefill if fields are empty
    g.spez = def.spez;
    const elSpez = document.querySelector(`[data-spez="${id}"]`);
    if (elSpez) { elSpez.value = def.spez; elSpez.style.color = '#f9a825'; }
    if (g.flaeche) {
      const nf = g.flaeche * (g.stockwerke || 1) * 0.8;
      g.waerme = Math.round(def.spez * nf / 1000 * 10) / 10;
      const elW = document.querySelector(`[data-waerme="${id}"]`);
      if (elW) { elW.value = g.waerme; elW.style.color = '#f9a825'; }
    }
    if (!g.spezHeizlast) {
      g.spezHeizlast = def.spezHL;
      const elHL = document.querySelector(`[data-spezhl="${id}"]`);
      if (elHL) { elHL.value = def.spezHL; elHL.style.color = '#f9a825'; }
      if (g.flaeche) {
        const nf = g.flaeche * (g.stockwerke || 1) * 0.8;
        g.heizlast = Math.round(def.spezHL * nf / 1000 * 10) / 10;
        const elH = document.querySelector(`[data-heizlast="${id}"]`);
        if (elH) { elH.value = g.heizlast; elH.style.color = '#f9a825'; }
      }
    }
  }
  updateViz(); updateTotals();
  window.glBerechnenDebounced?.(500);
}

// ── Gebäude-Auswahl & Massenbearbeitung ──────────────────────────────
export function toggleSelect(id, checked) {
  const g = gebaeude.find(x => x.id === id);
  if (g) g.selected = checked;
  updateBulkBar();
}

export function updateBulkBar() {
  const sel = gebaeude.filter(g => g.selected);
  const bar = document.getElementById('bulk-bar');
  const lbl = document.getElementById('bulk-lbl');
  const nutzungSelect = document.getElementById('bulk-nutzung');
  if (nutzungSelect && nutzungSelect.options.length !== getNutzungstypen().length + 1) {
    const current = nutzungSelect.value;
    nutzungSelect.innerHTML = '<option value="">Nutzung beibehalten</option>' +
      getNutzungstypen().map(type =>
        `<option value="${type.id}">${type.label} · ${type.gruppe}</option>`).join('');
    nutzungSelect.value = current;
  }
  if (sel.length > 0) {
    bar.classList.add('visible');
    lbl.textContent = sel.length + ' ausgewählt';
  } else {
    bar.classList.remove('visible');
  }
}

export function applyBulk() {
  const nutzung = document.getElementById('bulk-nutzung').value;
  const spez   = document.getElementById('bulk-spez').value;
  const waerme = document.getElementById('bulk-waerme').value;
  const hl     = document.getElementById('bulk-hl').value;
  gebaeude.filter(g => g.selected).forEach(g => {
    if (nutzung) {
      g.nutzung = nutzung;
      _invalidateStats();
    }
    if (spez) {
      g.spez = parseFloat(spez);
      if (g.flaeche) g.waerme = Math.round(g.flaeche * parseFloat(spez) / 1000 * 10) / 10;
    } else if (waerme) {
      g.waerme = parseFloat(waerme);
      if (g.flaeche) g.spez = Math.round(g.waerme * 1000 / g.flaeche * 10) / 10;
    }
    if (hl) {
      g.heizlast = parseFloat(hl);
      if (g.flaeche) g.spezHeizlast = Math.round(g.heizlast * 1000 / g.flaeche * 10) / 10;
    }
  });
  document.getElementById('bulk-nutzung').value = '';
  document.getElementById('bulk-spez').value = '';
  document.getElementById('bulk-waerme').value = '';
  document.getElementById('bulk-hl').value = '';
  renderList(); updateViz(); updateTotals(); recalcNetz();
}

export function clearSelection() {
  gebaeude.forEach(g => g.selected = false);
  renderList();
  updateBulkBar();
  if (currentViewMode === 'gebaeude') renderGebaeudeOverview();
}

// ── Tabellarische Gebäudeübersicht ──────────────────────────────────────────
let gebTableFilter = '';
let gebTableSort = {key:'name',direction:1};

function _gebTableEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[character]);
}

function _gebUsageLabel(g) {
  return NUTZUNG_DEFAULTS[g.nutzung]?.label ||
    getNutzungstypen().find(type => type.id === g.nutzung)?.label ||
    g.nutzung || 'Nicht zugeordnet';
}

function _gebTableValue(g,key) {
  if (key === 'name') return g.name || '';
  if (key === 'gebaeudenummer') return g.gebaeudenummer || '';
  if (key === 'nutzung') return _gebUsageLabel(g);
  if (key === 'nutzflaeche') return (Number(g.flaeche) || 0) * (Number(g.stockwerke) || 1) * 0.8;
  if (key === 'quelle') return g.importSourceName || '';
  if (key === 'status') return getComputedStats(g,globalYear).status || '';
  return Number(g[key]) || 0;
}

function _filteredSortedBuildings() {
  const needle = gebTableFilter.toLowerCase().trim();
  return gebaeude.filter(g => !needle ||
    (g.name || '').toLowerCase().includes(needle) ||
    (g.gebaeudenummer || '').toLowerCase().includes(needle) ||
    _gebUsageLabel(g).toLowerCase().includes(needle) ||
    (g.importSourceName || '').toLowerCase().includes(needle)
  ).sort((a,b) => {
    const av = _gebTableValue(a,gebTableSort.key);
    const bv = _gebTableValue(b,gebTableSort.key);
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv),'de',{numeric:true}) * gebTableSort.direction;
    }
    return (av - bv) * gebTableSort.direction;
  });
}

export function setGebaeudeTableFilter(value) {
  gebTableFilter = value || '';
  renderGebaeudeOverview();
}

export function sortGebaeudeTable(key) {
  gebTableSort = gebTableSort.key === key
    ? {key,direction:gebTableSort.direction * -1}
    : {key,direction:1};
  renderGebaeudeOverview();
}

export function toggleGebaeudeTableSelection(id,checked) {
  const building = gebaeude.find(g => g.id === id);
  if (building) building.selected = !!checked;
  updateBulkBar();
  renderGebaeudeOverview();
}

export function toggleAllGebaeudeTable(checked) {
  _filteredSortedBuildings().forEach(g => { g.selected = !!checked; });
  updateBulkBar();
  renderGebaeudeOverview();
}

export function updateGebaeudeTableField(id,field,value) {
  if (field === 'name') window.renameGebaeude?.(id,value);
  else if (field === 'nutzung') setNutzung(id,value);
  else window.updateField?.(id,field,value);
  renderList();
  renderGebaeudeOverview();
}

export function applyGebaeudeTableBulk() {
  const selected = gebaeude.filter(g => g.selected);
  if (!selected.length) return;
  const usage = document.getElementById('geb-bulk-nutzung')?.value || '';
  const constructionYear = document.getElementById('geb-bulk-baujahr')?.value || '';
  const floors = document.getElementById('geb-bulk-stockwerke')?.value || '';
  if (!usage && !constructionYear && !floors) {
    showHint('Bitte mindestens einen Wert für die Sammeländerung eingeben.',3500);
    return;
  }
  selected.forEach(g => {
    if (usage) g.nutzung = usage;
    if (constructionYear) window.updateField?.(g.id,'baujahr',constructionYear,{defer:true});
    if (floors) window.updateField?.(g.id,'stockwerke',floors,{defer:true});
  });
  _invalidateStats();
  renderList();
  updateViz();
  updateTotals();
  recalcNetz();
  window.glBerechnenDebounced?.(500);
  showHint(`✓ ${selected.length} Gebäude gemeinsam aktualisiert.`,3000);
  renderGebaeudeOverview();
}

function _drawGebaeudeHeatProfile(values) {
  const canvas=document.getElementById('geb-profile-canvas');
  if (!canvas || !values?.length) return;
  const ratio=Math.max(1,window.devicePixelRatio||1);
  const width=Math.max(600,canvas.clientWidth||860);
  const height=280;
  canvas.width=Math.round(width*ratio);
  canvas.height=Math.round(height*ratio);
  const ctx=canvas.getContext('2d');
  ctx.scale(ratio,ratio);
  const pad={left:48,right:14,top:16,bottom:30};
  const plotW=width-pad.left-pad.right,plotH=height-pad.top-pad.bottom;
  const daily=Array.from({length:365},(_,day)=>{
    let maximum=0;
    for (let hour=0;hour<24;hour++) maximum=Math.max(maximum,values[day*24+hour]||0);
    return maximum;
  });
  const maximum=Math.max(1,...daily);
  ctx.strokeStyle='rgba(255,255,255,.08)';
  ctx.fillStyle='#78909c';
  ctx.font='9px DM Mono, monospace';
  for (let line=0;line<=4;line++) {
    const y=pad.top+plotH*line/4;
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();
    ctx.fillText(`${Math.round(maximum*(1-line/4))} kW`,3,y+3);
  }
  const months=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const starts=[0,31,59,90,120,151,181,212,243,273,304,334];
  months.forEach((month,index)=>{
    const x=pad.left+starts[index]/364*plotW;
    ctx.fillText(month,x,height-10);
  });
  const gradient=ctx.createLinearGradient(0,pad.top,0,pad.top+plotH);
  gradient.addColorStop(0,'#29b6f6');
  gradient.addColorStop(1,'#66bb6a');
  ctx.strokeStyle=gradient;
  ctx.lineWidth=1.5;
  ctx.beginPath();
  daily.forEach((value,index)=>{
    const x=pad.left+index/(daily.length-1)*plotW;
    const y=pad.top+plotH*(1-value/maximum);
    if (index===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

export function showGebaeudeHeatProfile(id) {
  const building=gebaeude.find(item=>item.id===id);
  const dialog=document.getElementById('geb-profile-dialog');
  if (!building || !dialog) return;
  const profile=window._buildingHeatProfiles?.get?.(id);
  const defaultMeta=getBuildingHeatProfileMeta(building);
  document.getElementById('geb-profile-title').textContent=`Lastgang · ${building.name || `Gebäude ${id}`}`;
  document.getElementById('geb-profile-subtitle').textContent=
    `${defaultMeta.label} · SigLinDe ${defaultMeta.sigLinDe} · Betrachtungsjahr ${globalYear}`;
  const kpis=document.getElementById('geb-profile-kpis');
  const canvas=document.getElementById('geb-profile-canvas');
  if (!profile) {
    kpis.innerHTML='<div style="grid-column:1/-1"><strong>Noch nicht berechnet</strong><span>Bitte Wärme-Grundlagen einmal berechnen. Hochgeladene Gesamtlastgänge enthalten keine aufteilbaren Gebäudekurven.</span></div>';
    canvas.style.display='none';
  } else {
    const fullLoadHours=profile.meta.peakKw>0 ? profile.meta.annualMwh*1000/profile.meta.peakKw : 0;
    kpis.innerHTML=[
      [profile.meta.annualMwh.toLocaleString('de-DE',{maximumFractionDigits:1}),'Wärme MWh/a'],
      [profile.meta.peakKw.toLocaleString('de-DE',{maximumFractionDigits:1}),'Profilspitze kW'],
      [Math.round(fullLoadHours).toLocaleString('de-DE'),'Vollbenutzungsstunden'],
      [`${Math.round(profile.meta.baseShare*100)} %`,'Grundlastanteil'],
    ].map(([value,label])=>`<div><strong>${value}</strong><span>${label}</span></div>`).join('');
    if (profile.meta.peakConflictDays?.length) {
      kpis.innerHTML+=`<div style="grid-column:1/-1;border-color:rgba(239,83,80,.55);background:rgba(239,83,80,.08)">
        <strong style="color:#ef9a9a">${profile.meta.peakConflictDays.length} nicht auflösbare Tage</strong>
        <span>Tagesenergie überschreitet Heizlast × 24 h. Jahresenergie wurde nicht verändert; Gebäudedaten bitte prüfen.</span>
      </div>`;
    }
    canvas.style.display='';
    requestAnimationFrame(()=>_drawGebaeudeHeatProfile(profile.values));
  }
  if (typeof dialog.showModal==='function') dialog.showModal();
  else dialog.setAttribute('open','');
}

export function closeGebaeudeHeatProfile() {
  const dialog=document.getElementById('geb-profile-dialog');
  if (dialog?.open && typeof dialog.close==='function') dialog.close();
  else dialog?.removeAttribute('open');
}

function _renderGebOverviewAnalysis() {
  const active = gebaeude.map(g => ({g,stats:getComputedStats(g,globalYear)}))
    .filter(item => item.stats.status !== 'abgerissen' && item.stats.status !== 'geplant');
  const totals = active.reduce((sum,item) => {
    const floorArea = (Number(item.g.flaeche) || 0) * (Number(item.g.stockwerke) || 1) * 0.8;
    sum.area += floorArea;
    sum.heat += Number(item.stats.waerme) || 0;
    sum.load += Number(item.stats.heizlast) || 0;
    return sum;
  },{area:0,heat:0,load:0});
  const averageSpecific = totals.area > 0 ? totals.heat * 1000 / totals.area : 0;
  const kpis = document.getElementById('geb-overview-kpis');
  if (kpis) kpis.innerHTML = [
    [gebaeude.length.toLocaleString('de-DE'),'Gebäude gesamt'],
    [Math.round(totals.area).toLocaleString('de-DE'),'Nutzfläche m²'],
    [Math.round(totals.heat).toLocaleString('de-DE'),'Wärme MWh/a'],
    [Math.round(totals.load).toLocaleString('de-DE'),'Heizlast kW'],
    [averageSpecific.toLocaleString('de-DE',{maximumFractionDigits:1}),'Ø kWh/m²a'],
  ].map(([value,label]) => `<div class="geb-overview-kpi"><strong>${value}</strong><span>${label}</span></div>`).join('');

  const groups = new Map();
  active.forEach(({g,stats}) => {
    const label = _gebUsageLabel(g);
    if (!groups.has(label)) groups.set(label,{label,count:0,area:0,heat:0,load:0});
    const group = groups.get(label);
    group.count++;
    group.area += (Number(g.flaeche) || 0) * (Number(g.stockwerke) || 1) * 0.8;
    group.heat += Number(stats.waerme) || 0;
    group.load += Number(stats.heizlast) || 0;
  });
  const rows = [...groups.values()];
  const analysis = document.getElementById('geb-overview-analysis');
  if (!analysis) return;
  const card = (title,key,unit) => {
    const sorted = [...rows].sort((a,b) => b[key]-a[key]).slice(0,8);
    const maximum = Math.max(1,...sorted.map(row => row[key]));
    return `<div class="geb-analysis-card"><h3>${title}</h3>${sorted.map(row => `
      <div class="geb-analysis-row">
        <span title="${_gebTableEsc(row.label)}">${_gebTableEsc(row.label)}</span>
        <span class="geb-analysis-bar"><i style="width:${Math.max(2,row[key]/maximum*100)}%"></i></span>
        <em>${Math.round(row[key]).toLocaleString('de-DE')} ${unit}</em>
      </div>`).join('') || '<span style="color:var(--muted);font-size:9px;">Keine Daten</span>'}</div>`;
  };
  analysis.innerHTML =
    card('Wärmeverbrauch nach Nutzung','heat','MWh/a') +
    card('Nutzfläche nach Nutzung','area','m²') +
    card('Heizlast nach Nutzung','load','kW');
}

export function renderGebaeudeOverview() {
  const body = document.getElementById('geb-table-body');
  const head = document.getElementById('geb-table-head');
  if (!body || !head) return;
  _renderGebOverviewAnalysis();
  const rows = _filteredSortedBuildings();
  const selected = gebaeude.filter(g => g.selected);
  const allVisibleSelected = rows.length > 0 && rows.every(g => g.selected);
  const sortLabel = (key,label) => `${label}${gebTableSort.key === key ? (gebTableSort.direction > 0 ? ' ↑' : ' ↓') : ''}`;
  head.innerHTML = `<tr>
    <th class="no-sort"><input type="checkbox" ${allVisibleSelected ? 'checked' : ''}
      data-change="toggleAllGebaeudeTable(this.checked)" title="Alle sichtbaren auswählen"></th>
    <th data-click="sortGebaeudeTable('gebaeudenummer')">${sortLabel('gebaeudenummer','Nr.')}</th>
    <th data-click="sortGebaeudeTable('name')">${sortLabel('name','Gebäude')}</th>
    <th data-click="sortGebaeudeTable('nutzung')">${sortLabel('nutzung','Nutzung')}</th>
    <th data-click="sortGebaeudeTable('baujahr')">${sortLabel('baujahr','Baujahr')}</th>
    <th data-click="sortGebaeudeTable('stockwerke')">${sortLabel('stockwerke','Geschosse')}</th>
    <th data-click="sortGebaeudeTable('flaeche')">${sortLabel('flaeche','Grundfläche m²')}</th>
    <th data-click="sortGebaeudeTable('nutzflaeche')">${sortLabel('nutzflaeche','Nutzfläche m²')}</th>
    <th data-click="sortGebaeudeTable('waerme')">${sortLabel('waerme','Wärme MWh/a')}</th>
    <th data-click="sortGebaeudeTable('spez')">${sortLabel('spez','kWh/m²a')}</th>
    <th data-click="sortGebaeudeTable('heizlast')">${sortLabel('heizlast','Heizlast kW')}</th>
    <th class="no-sort">Lastprofil</th>
    <th data-click="sortGebaeudeTable('quelle')">${sortLabel('quelle','Quelle')}</th>
  </tr>`;
  const usageTypes = getNutzungstypen();
  body.innerHTML = rows.map(g => {
    const netFloorArea = (Number(g.flaeche) || 0) * (Number(g.stockwerke) || 1) * 0.8;
    const options = [
      ...(!usageTypes.some(type => type.id === g.nutzung) && g.nutzung
        ? [{id:g.nutzung,label:_gebUsageLabel(g)}] : []),
      ...usageTypes,
    ].map(type => `<option value="${_gebTableEsc(type.id)}" ${type.id === g.nutzung ? 'selected' : ''}>${_gebTableEsc(type.label)}</option>`).join('');
    return `<tr class="${g.selected ? 'selected' : ''}">
      <td><input type="checkbox" ${g.selected ? 'checked' : ''} data-change="toggleGebaeudeTableSelection(${g.id},this.checked)"></td>
      <td><input class="geb-table-num" style="width:56px" value="${_gebTableEsc(g.gebaeudenummer || '')}" data-change="updateGebaeudeTableField(${g.id},'gebaeudenummer',this.value)"></td>
      <td><input class="geb-table-name" value="${_gebTableEsc(g.name)}" data-change="updateGebaeudeTableField(${g.id},'name',this.value)"></td>
      <td><select data-change="updateGebaeudeTableField(${g.id},'nutzung',this.value)"><option value="">—</option>${options}</select></td>
      <td><input class="geb-table-num" type="number" value="${g.baujahr || ''}" data-change="updateGebaeudeTableField(${g.id},'baujahr',this.value)"></td>
      <td><input class="geb-table-num" type="number" min="1" max="50" value="${g.stockwerke || 1}" data-change="updateGebaeudeTableField(${g.id},'stockwerke',this.value)"></td>
      <td><input class="geb-table-num" type="number" min="0" value="${g.flaeche ? Math.round(g.flaeche) : ''}" data-change="updateGebaeudeTableField(${g.id},'flaeche',this.value)"></td>
      <td class="geb-table-num geb-table-readonly">${Math.round(netFloorArea).toLocaleString('de-DE')}</td>
      <td><input class="geb-table-num" type="number" min="0" step="0.1" value="${g.waerme ?? ''}" data-change="updateGebaeudeTableField(${g.id},'waerme',this.value)"></td>
      <td><input class="geb-table-num" type="number" min="0" step="0.1" value="${g.spez ?? ''}" data-change="updateGebaeudeTableField(${g.id},'spez',this.value)"></td>
      <td><input class="geb-table-num" type="number" min="0" step="0.1" value="${g.heizlast ?? ''}" data-change="updateGebaeudeTableField(${g.id},'heizlast',this.value)"></td>
      <td><button class="geb-profile-btn" data-click="showGebaeudeHeatProfile(${g.id})">${_gebTableEsc(getBuildingHeatProfileMeta(g).label)}</button></td>
      <td class="geb-table-readonly" title="${_gebTableEsc(g.importSourceName || '')}">${_gebTableEsc(g.importSourceName || '—')}</td>
    </tr>`;
  }).join('');
  const count = document.getElementById('geb-table-result-count');
  if (count) count.textContent = `${rows.length} von ${gebaeude.length} Gebäuden`;
  const bulk = document.getElementById('geb-table-bulk');
  if (bulk) {
    bulk.classList.toggle('visible',selected.length > 0);
    bulk.innerHTML = selected.length ? `
      <strong>${selected.length} ausgewählt</strong>
      <select id="geb-bulk-nutzung"><option value="">Nutzung beibehalten</option>${usageTypes.map(type =>
        `<option value="${_gebTableEsc(type.id)}">${_gebTableEsc(type.label)}</option>`).join('')}</select>
      <input id="geb-bulk-baujahr" type="number" min="1800" max="2100" placeholder="Baujahr beibehalten">
      <input id="geb-bulk-stockwerke" type="number" min="1" max="50" placeholder="Geschosse beibehalten">
      <button class="btn-secondary" data-click="applyGebaeudeTableBulk()">Auf Auswahl anwenden</button>
      <button class="btn-secondary" data-click="clearSelection()">Auswahl aufheben</button>` : '';
  }
}

// ── Gebäude-Filter ────────────────────────────────────────────────────
export let filterText = '';
export function filterList(val) {
  filterText = val.toLowerCase().trim();
  const sourceFilter = document.getElementById('geb-source-filter')?.value || '';
  const cards = document.querySelectorAll('#geb-list .geb-card');
  cards.forEach(card => {
    const id = parseInt(card.id.replace('card-', ''));
    const g = gebaeude.find(x => x.id === id);
    if (!g) return;
    const textMatch = !filterText
      || g.name.toLowerCase().includes(filterText)
      || (g.gebaeudenummer && g.gebaeudenummer.toLowerCase().includes(filterText))
      || (g.nutzung && (NUTZUNG_DEFAULTS[g.nutzung]?.label || g.nutzung).toLowerCase().includes(filterText))
      || (g.importSourceName && g.importSourceName.toLowerCase().includes(filterText));
    const sourceMatch = !sourceFilter || g.importSourceId === sourceFilter;
    card.style.display = textMatch && sourceMatch ? '' : 'none';
  });
}

// ── Adresssuche (Nominatim) ───────────────────────────────────────────
export let addrDebounce = null;
export let addrSelected = -1;
let addrRequest = null;

export function addrSearch(val) {
  clearTimeout(addrDebounce);
  const res = document.getElementById('addr-results');
  if (!val || val.trim().length < 3) {
    addrRequest?.abort();
    res.classList.remove('open');
    res.innerHTML = '';
    return;
  }
  res.innerHTML = '<div class="addr-result-item addr-result-status">Suche …</div>';
  res.classList.add('open');
  addrDebounce = setTimeout(async () => {
    addrRequest?.abort();
    addrRequest = new AbortController();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(val.trim())}`;
      const response = await fetch(url, {
        headers: {'Accept-Language': 'de'},
        signal: addrRequest.signal
      });
      if (!response.ok) throw new Error(`Adressdienst: HTTP ${response.status}`);
      const data = await response.json();
      res.innerHTML = '';
      if (!data.length) {
        res.innerHTML = '<div class="addr-result-item addr-result-status">Keine Ergebnisse</div>';
      } else {
        data.forEach((item, i) => {
          const div = document.createElement('div');
          div.className = 'addr-result-item';
          div.textContent = item.display_name;
          div.dataset.lat = item.lat;
          div.dataset.lon = item.lon;
          div.addEventListener('click', () => selectAddr(item));
          res.appendChild(div);
        });
      }
      addrSelected = -1;
      res.classList.add('open');
    } catch(e) {
      if (e.name === 'AbortError') return;
      console.error('Adresssuche fehlgeschlagen:', e);
      res.innerHTML = '<div class="addr-result-item addr-result-status">Adresssuche momentan nicht erreichbar</div>';
      res.classList.add('open');
    }
  }, 350);
}

export function selectAddr(item) {
  map.flyTo([parseFloat(item.lat), parseFloat(item.lon)], 17, {duration: 1.2});
  // Show a brief pulse marker
  const m = L.circleMarker([parseFloat(item.lat), parseFloat(item.lon)], {
    radius: 10, color: 'var(--accent)', fillColor: '#4fc3f7', fillOpacity: 0.5, weight: 2
  }).addTo(map);
  setTimeout(() => map.removeLayer(m), 3000);
  document.getElementById('addr-input').value = item.display_name.split(',')[0];
  const postcode = item.address?.postcode?.match(/\b\d{5}\b/)?.[0];
  if (postcode && typeof window.glSetKlimaPlz === 'function') window.glSetKlimaPlz(postcode);
  document.getElementById('addr-results').classList.remove('open');
}

export function addrSubmit() {
  const input=document.getElementById('addr-input');
  const result=document.querySelector('#addr-results .addr-result-item:not(.addr-result-status)');
  if(result){
    result.click();
    return true;
  }
  input?.focus();
  addrSearch(input?.value||'');
  return false;
}

export function addrKeydown(e) {
  const res = document.getElementById('addr-results');
  const items = res.querySelectorAll('.addr-result-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    addrSelected = Math.min(addrSelected + 1, items.length - 1);
    items.forEach((el, i) => el.style.background = i === addrSelected ? 'var(--surface2)' : '');
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    addrSelected = Math.max(addrSelected - 1, 0);
    items.forEach((el, i) => el.style.background = i === addrSelected ? 'var(--surface2)' : '');
    e.preventDefault();
  } else if (e.key === 'Enter') {
    const index = addrSelected >= 0 ? addrSelected : 0;
    if (!items[index].classList.contains('addr-result-status')) items[index].click();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    res.classList.remove('open');
  }
}

// Close addr dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.addr-search-wrap')) {
    document.getElementById('addr-results').classList.remove('open');
  }
});

// ── Autosave (LocalStorage) ───────────────────────────────────────────
let _latestAutosave = null;
export async function autosave() {
  try {
    _latestAutosave = await saveAutosaveProject(_buildProjectData());
    window._autosaveStatus = {ok: true, savedAt: _latestAutosave.savedAt};
  } catch(e) {
    window._autosaveStatus = {ok: false, error: e.message};
    console.error(e);
    /** @type {any} */ (window).reportDiagnostic?.({severity:'error',area:'Automatische Sicherung',message:e.message,action:'Projekt jetzt manuell exportieren und verfügbaren Browserspeicher prüfen.'});
    showHint('⚠ Automatische Sicherung fehlgeschlagen. Projekt bitte manuell speichern.', 8000);
  }
}
appLifecycle.interval(autosave, 30000);

// Restore autosave on load if no manual project loaded
export async function tryRestoreAutosave() {
  try {
    _latestAutosave = await loadLatestAutosave();
    if (!_latestAutosave) return;
    const project = _latestAutosave.project;
    if (!project.gebaeude || !project.gebaeude.length) return;
    const hint = document.getElementById('hint');
    hint.innerHTML = 'Autosave gefunden. <span style="color:var(--accent);cursor:pointer;text-decoration:underline" data-click="loadAutosave()">Wiederherstellen?</span> <span style="color:var(--muted);cursor:pointer;margin-left:8px;" data-click="document.getElementById(\'hint\').classList.add(\'hidden\');document.getElementById(\'hint\').style.pointerEvents=\'\';">✕</span>';
    hint.classList.remove('hidden');
    hint.style.pointerEvents = 'auto';
  } catch(e) {}
}

export async function loadAutosave() {
  try {
    const snapshot = _latestAutosave || await loadLatestAutosave();
    if (!snapshot) return;
    await _loadProject(snapshot.project);
    showHint('✓ Autosave wiederhergestellt.');
    setTimeout(hideHint, 3000);
  } catch(e) { showHint('Fehler beim Wiederherstellen.'); console.error(e); }
}

export async function restoreLatestAutosave() {
  try {
    const snapshot = await loadLatestAutosave();
    if (!snapshot?.project) {
      showHint('Keine automatische Sicherung vorhanden.', 4000);
      return;
    }
    if (gebaeude.length) {
      const savedAt = snapshot.savedAt
        ? new Date(snapshot.savedAt).toLocaleString('de-DE')
        : 'unbekannter Zeitpunkt';
      const confirmed = typeof window.epConfirm === 'function'
        ? await window.epConfirm(
          'Autosave wiederherstellen?',
          `Der aktuelle Projektstand wird durch die lokale Sicherung vom ${savedAt} ersetzt. Bitte speichere benötigte Änderungen vorher als Projektdatei.`,
          {okText:'Wiederherstellen'},
        )
        : window.confirm('Aktuellen Projektstand durch die letzte automatische Sicherung ersetzen?');
      if (!confirmed) return;
    }
    _latestAutosave = snapshot;
    await _loadProject(snapshot.project);
    showHint('✓ Autosave wiederhergestellt.', 4000);
  } catch(e) {
    showHint('Fehler beim Wiederherstellen des Autosaves.', 5000);
    console.error(e);
  }
}



// ── OSM Straßentyp → Kostenklasse ────────────────────────────────────
export const HIGHWAY_KOSTEN = {
  motorway:'hoch', trunk:'hoch', primary:'hoch', secondary:'hoch',
  tertiary:'mittel', residential:'mittel', living_street:'mittel',
  service:'niedrig', track:'niedrig', path:'niedrig', footway:'niedrig',
  cycleway:'niedrig', pedestrian:'niedrig', unclassified:'mittel',
};

let _aaecRunning = false;
async function queryOsmRoadType(latA, lngA, latB, lngB) {
  // Find the OSM way closest to the midpoint of the edge
  const midLat = (latA + latB) / 2;
  const midLng = (lngA + lngB) / 2;
  const delta = 0.0003;
  const bbox = `${midLat-delta},${midLng-delta},${midLat+delta},${midLng+delta}`;
  const q = `[out:json][timeout:5];way["highway"](${bbox});out tags 1;`;
  const resp = await fetch(OVERPASS_ENDPOINTS[0], {
    method: 'POST',
    body: 'data=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(6000)
  });
  // Harter Fehler (429/5xx) → werfen, damit der Aufrufer den Circuit-Breaker auslöst.
  if (!resp.ok) throw new Error('overpass ' + resp.status);
  const d = await resp.json();
  if (d && d.elements && d.elements.length > 0) {
    const hw = d.elements[0].tags?.highway || '';
    return HIGHWAY_KOSTEN[hw] || 'mittel';
  }
  return 'mittel'; // erfolgreich, aber keine Straße in der Nähe → Default
}

export async function autoAssignEdgeCosts() {
  // Straßentyp je Kante → Kostenklasse (Hintergrund, nach autoGenerateNetz).
  // Robust gegen Overpass-Ausfälle/Rate-Limits (429) und file://-CORS: früh
  // aufhören statt den Browser mit hunderten fehlschlagenden Requests zu fluten
  // (das machte ihn "brutal langsam", wenn der Hintergrund-Sturm weiterlief).
  if (_aaecRunning) return; // nur ein Lauf gleichzeitig — kein Request-Sturm bei Mehrfachauslösung
  // file:// (Doppelklick auf dist/index.html): Overpass ist per CORS chancenlos → gar nicht anfragen.
  const offline = typeof location === 'undefined' || location.protocol === 'file:' || location.origin === 'null';
  if (offline) {
    for (const e of netzEdges) if (!e.kostOverride && !e.kostKlasse) e.kostKlasse = 'mittel';
    updateRohrListe();
    return;
  }
  _aaecRunning = true;
  try {
    let fails = 0;
    for (const e of netzEdges) {
      if (e.kostOverride) continue; // manuelle Einstellung nicht überschreiben
      const uPt = e.uNode?.pt, vPt = e.vNode?.pt;
      if (!uPt || !vPt) continue;
      if (fails >= 2) { if (!e.kostKlasse) e.kostKlasse = 'mittel'; continue; } // Circuit-Breaker: Overpass nicht erreichbar
      try {
        e.kostKlasse = await queryOsmRoadType(uPt.lat, uPt.lng, vPt.lat, vPt.lng);
      } catch (_) {
        fails++;
        if (!e.kostKlasse) e.kostKlasse = 'mittel';
      }
    }
  } finally {
    _aaecRunning = false;
  }
  updateRohrListe();
}

// ── Edge popup ────────────────────────────────────────────────────────
export let activeEdgePopup = null;

export function showEdgePopup(e, mouseEvt) {
  const popup = document.getElementById('edge-popup');
  if (!popup) return;
  activeEdgePopup = e;

  const dnOptions = [0, 15,20,25,32,40,50,65,80,100,125,150,200,250,300,350,400,450,500,600,700,800]
    .map(dn => `<option value="${dn}" ${e.dn===dn?'selected':''}>${dn===0?'Auto':'DN '+dn}</option>`)
    .join('');

  const kostKlasse = e.kostKlasse || 'mittel';
  const kostAuto   = !e.kostOverride;
  popup.innerHTML = `
    <div class="edge-popup-title">
      <span style="color:var(--accent)">⛕ Leitungsabschnitt</span>
      <span class="edge-popup-close" data-click="closeEdgePopup()">✕</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <div>
        <div class="inp-label" style="margin-bottom:3px">Durchmesser</div>
        <select data-change="setEdgeDN(this.value)">${dnOptions}</select>
        <div style="font-size:9px;color:var(--muted);margin-top:2px">${e.dnOverride?'Manuell: DN '+e.dn:'Auto: DN '+e.dn}</div>
      </div>
      <div>
        <div class="inp-label" style="margin-bottom:3px">Kostenklasse</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;">
          <span class="cost-badge niedrig ${kostKlasse==='niedrig'?'':''}${kostAuto&&kostKlasse==='niedrig'?' auto':''}" 
            data-click="setEdgeKost('niedrig')" style="${kostKlasse==='niedrig'?'opacity:1':'opacity:.45'}">Niedrig</span>
          <span class="cost-badge mittel"
            data-click="setEdgeKost('mittel')" style="${kostKlasse==='mittel'?'opacity:1':'opacity:.45'}">Mittel</span>
          <span class="cost-badge hoch"
            data-click="setEdgeKost('hoch')" style="${kostKlasse==='hoch'?'opacity:1':'opacity:.45'}">Hoch</span>
        </div>
        <div style="font-size:9px;color:var(--muted);margin-top:3px">${kostAuto?'🔄 Auto (OSM)':'✏️ Manuell'}</div>
      </div>
    </div>
    <div style="font-size:10px;color:var(--muted);border-top:1px solid var(--border);padding-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:3px;">
      <span>Last: <span style="color:var(--text)">${(e.load||0).toFixed(1)} kW</span>${e._gzf < 1 ? ` <span style="color:var(--muted);font-size:9px">(GZF ${e._gzf.toFixed(2)})</span>` : ''}</span>
      <span>Länge: <span style="color:var(--text)">${Math.round(e.length||0)} m</span></span>
      <span>WLD: <span style="color:${getWLDColor(getWLD(e))}">${getWLD(e).toFixed(2)} MWh/(m·a)</span></span>
      <span>Kosten: <span style="color:#4fc3f7">${Math.round((getKostenProMKlasse(e.dn, e.kostKlasse||'mittel'))*(e.length||0)).toLocaleString('de-DE')} €</span></span>
    </div>
    ${e.buildingConflict ? `<div style="margin-top:7px;padding:6px 8px;border:1px solid rgba(249,168,37,.55);border-radius:5px;background:rgba(249,168,37,.1);color:#ffd180;font-size:9px;line-height:1.45;">
      ⚠ Automatischer Rückfall: Dieser Verlauf kreuzt einen Gebäudegrundriss. Das Netz wäre ohne diesen Abschnitt nicht vollständig verbunden. Bitte den Abschnitt bei Bedarf manuell umlegen.
    </div>` : ''}
    ${e.infoHtml ? `<div class="edge-popup-details">${e.infoHtml}</div>` : ''}
    <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;">
      <button data-click="toggleEdgePruned()" style="width:100%;padding:5px 8px;background:${e.pruned?'#1b3a2a':'rgba(249,168,37,0.12)'};border:1px solid ${e.pruned?'#4caf50':'#f9a825'};border-radius:4px;color:${e.pruned?'#4caf50':'#f9a825'};cursor:pointer;font-size:10px;font-family:'DM Mono',monospace;">
        ${e.pruned?'✓ Wieder anschließen':'✂ Abschnitt deaktivieren'}
      </button>
    </div>`;

  // Position near mouse, clamped to viewport
  const rect = document.getElementById('map').getBoundingClientRect();
  let px = mouseEvt.clientX - rect.left + 12;
  let py = mouseEvt.clientY - rect.top + 12;
  popup.style.display = 'block';
  const pw = popup.offsetWidth || 240;
  const ph = popup.offsetHeight || 160;
  if (px + pw > rect.width  - 10) px = mouseEvt.clientX - rect.left - pw - 12;
  if (py + ph > rect.height - 10) py = mouseEvt.clientY - rect.top  - ph - 12;
  popup.style.left = px + 'px';
  popup.style.top  = py + 'px';
}

export function closeEdgePopup() {
  const p = document.getElementById('edge-popup');
  if (p) p.style.display = 'none';
  activeEdgePopup = null;
}

export function setEdgeDN(val) {
  if (!activeEdgePopup) return;
  const dn = parseInt(val);
  activeEdgePopup.dnOverride = dn > 0;
  activeEdgePopup.dn = dn > 0 ? dn : 0;
  recalcNetz();
  if (activeEdgePopup) showEdgePopup(activeEdgePopup, {
    clientX: parseInt(document.getElementById('edge-popup').style.left) + document.getElementById('map').getBoundingClientRect().left,
    clientY: parseInt(document.getElementById('edge-popup').style.top)  + document.getElementById('map').getBoundingClientRect().top,
  });
}

export function setEdgeKost(klass) {
  if (!activeEdgePopup) return;
  activeEdgePopup.kostKlasse = klass;
  activeEdgePopup.kostOverride = true;
  recalcNetz();
  // Re-render popup in place
  const p = document.getElementById('edge-popup');
  const px = p.style.left; const py = p.style.top;
  showEdgePopup(activeEdgePopup, {
    clientX: parseInt(px) + document.getElementById('map').getBoundingClientRect().left,
    clientY: parseInt(py) + document.getElementById('map').getBoundingClientRect().top,
  });
  document.getElementById('edge-popup').style.left = px;
  document.getElementById('edge-popup').style.top  = py;
}

// ── Netz-Pruning ──────────────────────────────────────────────────────────
export function togglePruningMode() {
  setNetzPruningMode(!netzPruningMode);
  if (netzPruningMode) beginInteraction({id:'prune-heat-network',label:'Netzabschnitte ausschließen',hint:'Leitungen anklicken; Escape beendet den Modus.',cancel:()=>{ if (netzPruningMode) togglePruningMode(); }});
  else cancelInteraction('prune-heat-network');
  const btn = document.getElementById('btn-pruning-mode');
  const info = document.getElementById('pruning-info');
  if (btn) {
    btn.textContent = netzPruningMode ? '✂ Abschnitte ausschließen: An' : '✂ Abschnitte ausschließen: Aus';
    btn.style.borderColor = netzPruningMode ? '#f9a825' : 'var(--border)';
    btn.style.color = netzPruningMode ? '#f9a825' : '';
    btn.style.background = netzPruningMode ? 'rgba(249,168,37,0.08)' : '';
  }
  if (info) info.style.display = netzPruningMode ? 'block' : 'none';
  const lpBtn = document.getElementById('lp-btn-pruning');
  if (lpBtn) {
    lpBtn.style.borderColor = netzPruningMode ? '#f9a825' : 'var(--border)';
    lpBtn.style.color = netzPruningMode ? '#f9a825' : '';
    lpBtn.textContent = netzPruningMode ? '✂ Ausschließen (aktiv)' : '✂ Abschnitte ausschließen';
  }
  updatePruningSummary();
}

export function toggleEdgePruned(edge) {
  const e = edge || activeEdgePopup;
  if (!e) return;
  e.pruned = !e.pruned;
  applyEdgePrunedStyle(e);
  // Also prune downstream subtree if this edge is pruned
  if (e.pruned) pruneSubtree(e); else unpruneSubtree(e);
  recalcNetz();
  updatePruningSummary();
  // Re-render popup in place if visible
  if (activeEdgePopup === e) {
    const p = document.getElementById('edge-popup');
    if (p && p.style.display !== 'none') {
      const px = p.style.left; const py = p.style.top;
      showEdgePopup(e, {
        clientX: parseInt(px) + document.getElementById('map').getBoundingClientRect().left,
        clientY: parseInt(py) + document.getElementById('map').getBoundingClientRect().top,
      });
      p.style.left = px; p.style.top = py;
    }
  }
}

export function applyEdgePrunedStyle(e) {
  if (!e || !e.layer) return;
  if (e.pruned) {
    e.layer.setStyle({ dashArray: '8 6', opacity: 0.3, color: '#78909c' });
  } else {
    e.layer.setStyle({ dashArray: null, opacity: 0.8 });
    // Color will be restored by recalcNetz → updateNetzColors
  }
}

export function pruneSubtree(edge) {
  // Find which direction is "downstream" from zentrale and prune all edges in subtree
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if (!zId) return;
  const downstream = getDownstreamNodeId(edge, zId);
  if (downstream == null) return;
  const visited = new Set([downstream]);
  const queue = [downstream];
  while (queue.length > 0) {
    const curr = queue.shift();
    netzEdges.forEach(e => {
      if (e === edge || e.pruned) return;
      const other = e.u === curr ? e.v : (e.v === curr ? e.u : null);
      if (other != null && !visited.has(other)) {
        visited.add(other);
        e.pruned = true;
        applyEdgePrunedStyle(e);
        queue.push(other);
      }
    });
  }
}

export function unpruneSubtree(edge) {
  // Unprune all edges downstream of this edge
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if (!zId) return;
  const downstream = getDownstreamNodeId(edge, zId);
  if (downstream == null) return;
  const visited = new Set([downstream]);
  const queue = [downstream];
  while (queue.length > 0) {
    const curr = queue.shift();
    netzEdges.forEach(e => {
      if (e === edge) return;
      const other = e.u === curr ? e.v : (e.v === curr ? e.u : null);
      if (other != null && !visited.has(other)) {
        visited.add(other);
        e.pruned = false;
        applyEdgePrunedStyle(e);
        queue.push(other);
      }
    });
  }
}

export function getDownstreamNodeId(edge, zentraleId) {
  // BFS from zentrale to determine which side of the edge is downstream
  const visited = new Set([zentraleId]);
  const queue = [zentraleId];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const e of netzEdges) {
      if (e === edge || e.pruned) continue;
      const other = e.u === curr ? e.v : (e.v === curr ? e.u : null);
      if (other != null && !visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  // The node NOT reachable without this edge is downstream
  if (!visited.has(edge.u) && visited.has(edge.v)) return edge.u;
  if (!visited.has(edge.v) && visited.has(edge.u)) return edge.v;
  // If both reachable (cycle), pick the one further from zentrale
  return edge.v === zentraleId ? edge.u : edge.v;
}

export function updatePruningSummary() {
  const div = document.getElementById('pruning-summary');
  if (!div) return;
  const prunedEdges = netzEdges.filter(e => e.pruned);
  if (prunedEdges.length === 0) { div.style.display = 'none'; return; }
  div.style.display = 'block';
  const prunedLen = prunedEdges.reduce((s, e) => s + (e.length || 0), 0);
  const prunedGebIds = new Set();
  prunedEdges.forEach(e => { prunedGebIds.add(e.u); prunedGebIds.add(e.v); });
  // Remove nodes still connected via active edges
  const activeGebIds = new Set();
  netzEdges.filter(e => !e.pruned).forEach(e => { activeGebIds.add(e.u); activeGebIds.add(e.v); });
  const disconnected = [...prunedGebIds].filter(id => !activeGebIds.has(id));
  const disconnectedMWh = disconnected.reduce((s, id) => {
    const g = gebaeude.find(x => x.id === id);
    return s + (g ? (parseFloat(g.waerme) || 0) : 0);
  }, 0);
  div.innerHTML = `
    <div style="color:#f9a825;font-weight:bold;margin-bottom:3px;">✂ Pruning aktiv</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;">
      <span style="color:var(--muted)">Deaktiviert:</span><span>${prunedEdges.length} Abschnitte (${Math.round(prunedLen)} m)</span>
      <span style="color:var(--muted)">Abgeklemmt:</span><span>${disconnected.length} Gebäude (${disconnectedMWh.toFixed(0)} MWh/a)</span>
    </div>
    <button data-click="clearAllPruning()" style="margin-top:5px;width:100%;padding:3px 6px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--muted);cursor:pointer;font-size:9px;font-family:'DM Mono',monospace;">Pruning aufheben</button>`;
}

export function clearAllPruning() {
  netzEdges.forEach(e => { e.pruned = false; applyEdgePrunedStyle(e); });
  recalcNetz();
  updatePruningSummary();
}

// Close popup when clicking elsewhere on map
document.addEventListener('click', ev => {
  if (!ev.target.closest('#edge-popup') && !ev.target.closest('.leaflet-interactive')) {
    closeEdgePopup();
  }
});

export function getKostenProMKlasse(dn, klass) {
  const row = KMR_KOSTEN[dn];
  if (!row) return 0;
  return row[{niedrig:0,mittel:1,hoch:2}[klass]??1];
}

// ── Print legend update ───────────────────────────────────────────────
export function updatePrintLegend() {
  const tw = document.getElementById('tot-waerme')?.textContent || '—';
  const thl = document.getElementById('tot-hl')?.textContent || '—';
  const n  = gebaeude.length;
  const mode = {waerme:'Wärmeverbrauch',spez:'Spez. Verbrauch',heizlast:'Heizlast'}[currentMode];
  const el = id => document.getElementById(id);
  if(el('print-tot-w'))   el('print-tot-w').textContent   = tw;
  if(el('print-tot-hl'))  el('print-tot-hl').textContent  = thl;
  if(el('print-geb-n'))   el('print-geb-n').textContent   = n;
  if(el('print-mode-label')) el('print-mode-label').textContent = 'Modus: ' + mode;
  if(el('print-year-label')) el('print-year-label').textContent = 'Jahr: ' + globalYear;
}


// ── Draggable float panels ──────────────────────────────────────────
export function startDrag(e, panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  // Resolve current position: if still using transform centering, convert to absolute px
  if (!panel.classList.contains('dragging')) {
    const rect = panel.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top  = rect.top  + 'px';
    panel.style.transform = 'none';
    panel.classList.add('dragging');
  }

  const startX = e.clientX - panel.offsetLeft;
  const startY = e.clientY - panel.offsetTop;

  function onMove(ev) {
    let nx = ev.clientX - startX;
    let ny = ev.clientY - startY;
    nx = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  nx));
    ny = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ny));
    panel.style.left = nx + 'px';
    panel.style.top  = ny + 'px';
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  e.preventDefault();
}

setTimeout(() => {
  renderList();
  tryRestoreAutosave();
}, 0);

export function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  const collapsed = sb.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▶' : '◀';
  btn.style.right = collapsed ? '0' : `${Math.round(sb.getBoundingClientRect().width)}px`;
  const es = document.getElementById('erzeuger-status');
  if (es) es.style.right = collapsed ? '10px' : '350px';
  setTimeout(() => map.invalidateSize(), 210);
}

export function togglePanelMinimize(id) {
  const p = document.getElementById(id);
  if (!p) return;
  p.classList.toggle('minimized');
  const btn = p.querySelector('.panel-minimize-btn');
  if (btn) btn.textContent = p.classList.contains('minimized') ? '▸' : '▾';
}

document.querySelectorAll('.float-panel').forEach(panel => {
  const handle = panel.querySelector('.panel-drag-handle');
  if (!handle) return;
  const btn = document.createElement('button');
  btn.className = 'panel-minimize-btn';
  btn.textContent = '▾';
  btn.title = 'Minimieren';
  btn.onclick = e => { e.stopPropagation(); togglePanelMinimize(panel.id); };
  const dots = handle.querySelector('.drag-dots');
  handle.insertBefore(btn, dots || null);
});

// ══════════════════════════════════════════════════════════════════
// 3-ZONEN GUI: View-Mode · Left-Panel · Center-Views
// ══════════════════════════════════════════════════════════════════

export let currentViewMode = 'karte';

export function setViewMode(mode) {
  currentViewMode = mode;
  _setHourlyModeActive(mode === 'live');
  // Stop live play when leaving live view
  if (mode !== 'live' && typeof _liveStopPlay === 'function') _liveStopPlay();
  // Update header tabs
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  // Show/hide center views
  const gebaeudeView   = document.getElementById('center-gebaeude-view');
  const analyseView    = document.getElementById('center-analyse-view');
  const optimierungView = document.getElementById('center-optimierung-view');
  const vergleichView  = document.getElementById('center-vergleich-view');
  const liveView       = document.getElementById('center-live-view');
  const vergleichOld   = document.getElementById('vergleich-panel');
  if (gebaeudeView)    gebaeudeView.style.display    = mode === 'gebaeude'    ? 'block' : 'none';
  if (analyseView)     analyseView.style.display     = mode === 'analyse'     ? 'block' : 'none';
  if (optimierungView) optimierungView.style.display = mode === 'optimierung' ? 'block' : 'none';
  if (vergleichView)   vergleichView.style.display   = mode === 'vergleich'   ? 'block' : 'none';
  if (liveView)        liveView.style.display        = mode === 'live'        ? 'flex'  : 'none';
  if (vergleichOld) vergleichOld.style.display = 'none';
  // Inline-Panels zurücksetzen bevor Modus wechselt
  if (typeof _restoreInlinePanels === 'function') _restoreInlinePanels();
  // Hide floating panels when switching to analyse/vergleich/live
  if (mode !== 'karte') hidePanels();
  // Invalidate map when switching back
  if (mode === 'karte') setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 100);
  // Populate views
  if (mode === 'analyse') refreshAnalyseView();
  if (mode === 'gebaeude') renderGebaeudeOverview();
  if (mode === 'optimierung') {
    if (typeof _optPopulateYearSelect === 'function') _optPopulateYearSelect();
    if (typeof _optUpdateEstimate === 'function') _optUpdateEstimate();
  }
  if (mode === 'vergleich') refreshVergleichView();
  if (mode === 'live') {
    if (typeof window._tlHistoDrawn !== 'undefined') window._tlHistoDrawn = false; // Redraw histogram
    const slider = document.getElementById('live-slider');
    _onHourSlider(slider?.value || 0);
  }
}

// --- Auto-Hide Floating-Panels beim Zeichnen/Platzieren ---
export let _drawHiddenPanels = [];

export function _hideForDraw() {
  _drawHiddenPanels = [];
  document.querySelectorAll('.float-panel.visible').forEach(p => {
    _drawHiddenPanels.push(p.id);
    p.classList.remove('visible');
  });
}

export function _restoreAfterDraw() {
  _drawHiddenPanels.forEach(id => {
    const p = document.getElementById(id);
    if (p) p.classList.add('visible');
  });
  _drawHiddenPanels = [];
}

// Left Panel
export let leftPanelCollapsed = false;
export function toggleLeftPanel() {
  leftPanelCollapsed = !leftPanelCollapsed;
  const lp = document.getElementById('left-panel');
  const btn = document.getElementById('lp-toggle');
  lp.classList.toggle('collapsed', leftPanelCollapsed);
  btn.textContent = leftPanelCollapsed ? '▶' : '◀';
  btn.style.left = leftPanelCollapsed ? '0' : `${Math.round(lp.getBoundingClientRect().width)}px`;
  document.querySelector('.lp-collapse-btn').textContent = leftPanelCollapsed ? '▶' : '◀';
  setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 260);
}

/** Startlayout mit ausreichend freier Kartenfläche für Laptop und Tablet. */
export function initResponsiveLayout() {
  const width = window.innerWidth;
  const sidebar = document.getElementById('sidebar');
  const left = document.getElementById('left-panel');
  if (width <= 1100 && sidebar && !sidebar.classList.contains('collapsed')) toggleSidebar();
  if (width <= 760 && left && !left.classList.contains('collapsed')) toggleLeftPanel();
  document.documentElement.dataset.viewportClass = width <= 760 ? 'tablet-portrait' : width <= 1100 ? 'compact' : 'desktop';
}

// Auf-/Zugeklappte Abschnitte ueberleben den Reload. Geschrieben wird fuer
// JEDEN Abschnitt; angewendet nur dort, wo ein Panel getSectionState() beim
// Aufbau abfragt (aktuell das Elektro-Panel).
const _SECTION_STORE = 'micke.lp.sections';

function _readSectionStore() {
  try { return JSON.parse(localStorage.getItem(_SECTION_STORE) || '{}'); }
  catch (e) { return {}; }
}

// true = offen, false = zu, undefined = nie angefasst (Panel-Default gilt)
export function getSectionState(id) {
  const v = _readSectionStore()[id];
  return v === undefined ? undefined : !!v;
}

export function setSectionOpen(id, open) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = open ? '' : 'none';
  const arrow = document.getElementById(id + '-arrow');
  if (arrow) arrow.textContent = open ? '▼' : '▶';
}

export function toggleSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const hidden = el.style.display === 'none';
  setSectionOpen(id, hidden);
  try {
    const store = _readSectionStore();
    store[id] = hidden ? 1 : 0;
    localStorage.setItem(_SECTION_STORE, JSON.stringify(store));
  } catch (e) { /* privater Modus o.ae. — Persistenz ist optional */ }
}

let _prevGebVisible = null;
let _prevSchallVisible = null;

export function setLeftTab(tabId) {
  document.querySelectorAll('#lp-tabs .lp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('#left-panel .lp-content').forEach(c => c.classList.toggle('active', c.id === 'lp-' + tabId));
  const titles = { gebiet: 'Gebiet', netz: 'Netz', erzeuger: 'Erzeuger', elektro: 'Elektro', ergebnis: 'Ergebnis' };
  document.getElementById('lp-title').textContent = titles[tabId] || tabId;
  if (tabId === 'elektro') {
    setNetzVisible(false);
    setStromNetzVisible(true);
    buildElektroPanel();
    renderGekoppelteStatus(); // Status der gekoppelten Anlagen bei jedem Öffnen aktualisieren
    window.elPanelRefreshStatus?.(); // Netz / Rechnung / Zustand neu bewerten
    buildPalette();
    // Assets für alle Gebäude nacherstellen, die noch keines haben (Migration alter Projekte)
    if (typeof window.autoCreateBuildingAssets === 'function' && Array.isArray(window.gebaeude)) {
      window.gebaeude.forEach(g => {
        try { window.autoCreateBuildingAssets(g); } catch(e) {}
      });
    }
    // Alte Gebäude-Strom-Icons ausblenden — durch ASSET-Marker ersetzt
    (window.stromNodes || []).forEach(n => {
      if (n.type === 'geb' && n.marker) n.marker.setOpacity(0);
    });
    setAssetLayerVisible(true);
    // Gebäude-Symbole (Kreise/Balken) und Schallringe der Wärmepumpen ausblenden —
    // im Elektro-Arbeitsbereich lenken sie nur ab, ersetzt durch die Asset-Marker.
    if (_prevGebVisible === null) _prevGebVisible = window.gebVisible !== false;
    if (_prevSchallVisible === null) _prevSchallVisible = window.lwWpSchallVisible !== false;
    setGebVisible(false);
    setSchallVisible(false);
    const cbGeb = document.getElementById('el-geb-visible');
    if (cbGeb) cbGeb.checked = false;
    const cbSchall = document.getElementById('lwwp-schall-visible');
    if (cbSchall) cbSchall.checked = false;
    // Karten-Modus mitführen: Elektro-Arbeitsbereich = Strom-Ansicht
    if (window.currentMode !== 'strom') setMode('strom');
  } else {
    // Alte Gebäude-Strom-Icons wieder einblenden wenn Strom-Ansicht aktiv
    (window.stromNodes || []).forEach(n => {
      if (n.type === 'geb' && n.marker) n.marker.setOpacity(1);
    });
    setStromNetzVisible(false);
    setNetzVisible(true);
    setAssetLayerVisible(false);
    // Gebäude-Symbole und Schallringe auf den vorherigen Zustand zurücksetzen
    if (_prevGebVisible !== null) {
      setGebVisible(_prevGebVisible);
      const cbGeb = document.getElementById('el-geb-visible');
      if (cbGeb) cbGeb.checked = _prevGebVisible;
      _prevGebVisible = null;
    }
    if (_prevSchallVisible !== null) {
      setSchallVisible(_prevSchallVisible);
      const cbSchall = document.getElementById('lwwp-schall-visible');
      if (cbSchall) cbSchall.checked = _prevSchallVisible;
      _prevSchallVisible = null;
    }
    // Wärme-Arbeitsbereiche merken (für Rücksprung aus dem Strom-Modus)
    if (tabId !== 'ergebnis') window._lastWaermeTab = tabId;
    // Karten-Modus mitführen: zurück im Wärme-Bereich → Wärme-Einfärbung
    if (window.currentMode === 'strom' && tabId !== 'ergebnis') setMode('waerme');
  }
  setTimeout(function() { if (typeof map !== 'undefined') map.invalidateSize(); }, 100);
}
window.setLeftTab = setLeftTab;

// Rechte Sidebar: Tab-Umschalter (Gebäude ↔ Elektro)
export function setSidebarTab(tabId) {
  document.querySelectorAll('.sb-tab').forEach(t =>
    t.classList.toggle('active', t.id === `sb-tab-btn-${tabId}`)
  );
  document.querySelectorAll('.sb-tab-body').forEach(b =>
    b.classList.toggle('active', b.id === `sb-tab-${tabId}`)
  );
  // Bei Wechsel zu Elektro: Asset-Liste aktualisieren
  if (tabId === 'elektro' && typeof window.renderSidebarAssetList === 'function') {
    window.renderSidebarAssetList();
  }
}
window.setSidebarTab = setSidebarTab;

// initLeftPanel: erzeuger buttons are now native in HTML, no cloning needed

// Update left panel merit order summary
export function updateLpMeritOrder() {
  const container = document.getElementById('lp-merit-order');
  if (!container) return;
  const keys = meritOrderKeys;
  if (keys.length === 0) {
    container.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:4px;">Noch keine Erzeuger aktiv</div>';
    return;
  }
  const cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG : {};
  let html = '';
  keys.forEach((k, i) => {
    const c = cfg[k] || {};
    const color = c.color || 'var(--muted)';
    const label = c.label || k;
    html += '<div class="lp-mo-item" style="border-left-color:' + color + ';">'
      + '<span class="mo-prio">' + (i+1) + '.</span>'
      + '<span class="mo-name">' + label + '</span>'
      + '</div>';
  });
  // Auto-Gaskessel als letzten Eintrag
  if (typeof netzEdges !== 'undefined' && netzEdges.length > 0
      && autoGkResult !== false) {
    const prio = keys.length + 1;
    const agk = autoGkResult;
    let detail = '';
    if (agk) detail = ' · ' + Math.round(agk.waermeMwh).toLocaleString('de-DE') + ' MWh';
    html += '<div class="lp-mo-item" style="border-left-color:#78909c;border-left-style:dashed;opacity:0.75;">'
      + '<span class="mo-prio">' + prio + '.</span>'
      + '<span class="mo-name">Auto-Gaskessel' + detail + ' <span class="htip" data-tip="Virtueller Reservekessel: Zeigt, wie viel Leistung die installierten Erzeuger nicht abdecken können. Wenn dieser Wert > 0 ist, fehlt Erzeugerkapazität.">?</span></span>'
      + '</div>';
  }
  container.innerHTML = html;
}

// Update left panel netz summary
export function updateLpErgebnisKpis() {
  var set = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  if (!gebaeude || !gebaeude.length) {
    set('lp-kpi-waerme', '—'); set('lp-kpi-heizlast', '—'); set('lp-kpi-wgk', '—');
    set('lp-kpi-ee', '—'); set('lp-kpi-co2', '—'); set('lp-kpi-gebcount', '—');
    return;
  }
  var totalW = 0, totalHL = 0;
  gebaeude.forEach(function(g) {
    var st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    if (st.status === 'abgerissen') return;
    totalW += (st.waerme || parseFloat(g.waerme) || 0);
    totalHL += (st.heizlast || parseFloat(g.heizlast) || 0);
  });
  set('lp-kpi-waerme', totalW > 0 ? Math.round(totalW).toLocaleString('de-DE') : '—');
  set('lp-kpi-heizlast', totalHL > 0 ? Math.round(totalHL).toLocaleString('de-DE') : '—');
  set('lp-kpi-gebcount', gebaeude.length.toString());
  // WGK, EE, CO2 from footer status bar
  var wgkTxt = document.querySelector('#fs-wgk .fs-txt');
  var eeTxt = document.querySelector('#fs-ee .fs-txt');
  // Extract numeric parts: "WGK: 14,2 ct/kWh" → "14,2 ct/kWh"
  set('lp-kpi-wgk', wgkTxt ? wgkTxt.textContent.replace(/^[^:]*:\s*/, '') : '—');
  set('lp-kpi-ee', eeTxt ? eeTxt.textContent.replace(/^[^:]*:\s*/, '') : '—');
  // CO2 from dispatch results if available
  var co2Txt = document.querySelector('#fs-co2 .fs-txt');
  if (!co2Txt) {
    // Try to calc from variantResults
    var co2 = '—';
    if (typeof variantResults !== 'undefined' && variantResults[activeVariantId || '__base__']) {
      var r = variantResults[activeVariantId || '__base__'];
      if (r.co2) co2 = r.co2.toFixed(1) + ' t/a';
    }
    set('lp-kpi-co2', co2);
  } else {
    set('lp-kpi-co2', co2Txt.textContent.replace(/^[^:]*:\s*/, ''));
  }
}

export function updateLpStepProgress() {
  // Step 1: Gebiet — done when gebaeude exist
  var s1 = document.querySelector('#lp-gebiet .lp-step-num');
  var done1 = gebaeude && gebaeude.length > 0;
  // Step 2: Netz — done when netzEdges exist
  var s2 = document.querySelector('#lp-netz .lp-step-num');
  var done2 = typeof netzEdges !== 'undefined' && netzEdges.length > 0;
  // Step 3: Erzeuger — done when meritOrderKeys has active entries
  var s3 = document.querySelector('#lp-erzeuger .lp-step-num');
  var done3 = meritOrderKeys.length > 0;
  // Step 4: Ergebnis — done when dispatch has results
  var s4 = document.querySelector('#lp-ergebnis .lp-step-num');
  var done4 = window._dispatchEnergy && Object.keys(window._dispatchEnergy).length > 0;
  [[s1,done1],[s2,done2],[s3,done3],[s4,done4]].forEach(function(pair) {
    if (!pair[0]) return;
    if (pair[1]) {
      pair[0].textContent = '✓';
      pair[0].style.background = '#66bb6a';
    } else {
      // Restore original number
      var num = pair[0].getAttribute('data-num');
      if (num) { pair[0].textContent = num; pair[0].style.background = 'var(--accent)'; }
    }
  });
  // Also update tab indicators
  var tabs = document.querySelectorAll('#lp-tabs .lp-tab');
  var dones = [done1, done2, done3, done4];
  tabs.forEach(function(t, i) {
    if (i < dones.length) {
      var dot = t.querySelector('.lp-tab-done');
      if (dones[i] && !dot) {
        var d = document.createElement('span');
        d.className = 'lp-tab-done';
        d.style.cssText = 'display:inline-block;width:5px;height:5px;border-radius:50%;background:#66bb6a;margin-left:3px;vertical-align:middle;';
        t.appendChild(d);
      } else if (!dones[i] && dot) {
        dot.remove();
      }
    }
  });
}

export function updateLpGebietStatus() {
  var el = document.getElementById('lp-gebiet-status');
  if (!el) return;
  var parts = [];
  if (typeof areaPolygon !== 'undefined' && areaPolygon) {
    parts.push('<span style="color:#ce93d8;">✓ Bereich definiert</span>');
  }
  if (typeof gebaeude !== 'undefined' && gebaeude.length > 0) {
    parts.push(gebaeude.length + ' Gebäude geladen');
  }
  el.innerHTML = parts.length ? parts.join(' · ') : '';
}

export function updateLpNetzSummary() {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  var hint = document.getElementById('lp-netz-hint');
  if (typeof netzEdges === 'undefined' || !netzEdges.length) {
    if (hint) hint.style.display = '';
    setVal('lp-netz-laenge', '—');
    setVal('lp-netz-verluste', '—');
    setVal('lp-netz-verlust-pct', '—');
    setVal('lp-netz-wld', '—');
    setVal('lp-netz-geb', '—');
    setVal('lp-netz-locked', '—');
    return;
  }
  if (hint) hint.style.display = 'none';
  let totalLen = 0, totalLoss = 0;
  netzEdges.forEach(e => { totalLen += (e.length || 0); totalLoss += (e.lossKW_annual || 0); });
  const lossMWh = totalLoss * 8.76;
  const connIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const connGeb = gebaeude.filter(g => connIds.has(g.id));
  const totalW = connGeb.reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const wld = totalLen > 0 ? ((totalW + lossMWh) / (totalLen / 1000)).toFixed(1) : '—';
  const pct = (totalW + lossMWh) > 0 ? (lossMWh / (totalW + lossMWh) * 100).toFixed(1) + ' %' : '—';
  setVal('lp-netz-laenge', (totalLen).toFixed(0) + ' m');
  setVal('lp-netz-verluste', lossMWh.toFixed(1) + ' MWh/a');
  setVal('lp-netz-verlust-pct', pct);
  setVal('lp-netz-wld', wld + ' kWh/(m·a)');
  setVal('lp-netz-geb', connGeb.length + '');
  setVal('lp-netz-locked', typeof window.networkLocked !== 'undefined' && window.networkLocked ? 'Bestandsnetz' : 'Neubaunetz');

  // Druckverluste + Pumpe
  const pump = window._netzPumpe;
  if (pump && pump.kritPfadDp > 0) {
    setVal('lp-netz-dp', (pump.kritPfadDp / 1000).toFixed(1) + ' kPa (' + pump.foerderhoeheBar.toFixed(2) + ' bar)');
    setVal('lp-netz-foerderhoehe', pump.foerderhoeheMWS.toFixed(1) + ' mWS (' + pump.vDotGesamt.toFixed(1) + ' m³/h)');
    const pDisp = pump.pumpenLeistungKW < 1 ? (pump.pumpenLeistungKW * 1000).toFixed(0) + ' W' : pump.pumpenLeistungKW.toFixed(1) + ' kW';
    setVal('lp-netz-pumpe', pDisp + ' (η=' + Math.round(pump.etaPumpe * 100) + '%)');
    setVal('lp-netz-hydraulik', pump.bottleneckCount > 0
      ? pump.bottleneckCount + ' hydraulische Engpässe'
      : '✓ Grenzwerte eingehalten');
  } else {
    setVal('lp-netz-dp', '—');
    setVal('lp-netz-foerderhoehe', '—');
    setVal('lp-netz-pumpe', '—');
    setVal('lp-netz-hydraulik', '—');
  }
}

// ── Analyse Center View ──────────────────────────────────────────
export let analyseCurrentSection = 'uebersicht';
export let waermeCurrentTab = 'lastgang';

export function setAnalyseSection(section) {
  analyseCurrentSection = section;
  document.querySelectorAll('#analyse-view-tabs .analyse-section-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.section === section));
  refreshAnalyseView();
}

export function setWaermeTab(tab) {
  waermeCurrentTab = tab;
  document.querySelectorAll('#waerme-subtabs .analyse-sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  _renderWaermeTab();
}

export function _renderWaermeTab() {
  const container = document.getElementById('analyse-waerme-content');
  if (!container) return;
  // Eingebettetes Panel zurücksetzen und neu einbetten
  _restoreInlinePanels();
  _embedPanelInline('analyse-panel', container);
  // Im analyse-panel die eigene Tab-Leiste verstecken
  const panelTabRow = document.querySelector('#analyse-panel .sa-tab-row');
  if (panelTabRow) panelTabRow.style.display = 'none';
  // Nur Wärme-relevante Sub-Tabs zulassen (kein Optimierung)
  if (typeof saSetTab === 'function') saSetTab(waermeCurrentTab);
}

/* ── Inline-Panel-Helfer: Floating-Panels im Analyse-Modus einbetten ── */
export function _embedPanelInline(panelId, container) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Ursprüngliche Position merken
  if (!panel._origParent) {
    panel._origParent = panel.parentElement;
    panel._origNext   = panel.nextElementSibling;
  }
  container.appendChild(panel);
  panel.classList.add('inline-mode');
  panel.classList.add('visible');
  // Drag-Handle im Inline-Modus verstecken
  const dragHandle = panel.querySelector('.panel-drag-handle');
  if (dragHandle) dragHandle.style.display = 'none';
}
export function _restoreInlinePanels() {
  document.querySelectorAll('.float-panel.inline-mode').forEach(p => {
    p.classList.remove('inline-mode', 'visible');
    // Versteckte Elemente wiederherstellen
    const tabRow = p.querySelector('.sa-tab-row');
    if (tabRow) tabRow.style.display = '';
    const dragHandle = p.querySelector('.panel-drag-handle');
    if (dragHandle) dragHandle.style.display = '';
    p.querySelectorAll('.float-panel-close, button[data-click="hidePanels()"]').forEach(b => b.style.display = '');
    if (p._origParent) {
      if (p._origNext && p._origNext.parentElement === p._origParent) {
        p._origParent.insertBefore(p, p._origNext);
      } else {
        p._origParent.appendChild(p);
      }
    }
  });
}

export function refreshAnalyseView() {
  // Populate KPIs from footer-status or system state
  const ss = window.systemState;
  const setKpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  if (ss) {
    setKpi('av-kpi-waerme', Math.round(ss.gesamtMwhMitNV || ss.nutzwaermeMwh || 0).toLocaleString('de-DE'));
    setKpi('av-kpi-pmax', Math.round(ss.pMaxKw || 0).toLocaleString('de-DE'));
  } else {
    // Try from gebaeude
    const tw = gebaeude.reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
    const thl = gebaeude.reduce((s, g) => s + (parseFloat(g.heizlast) || 0), 0);
    setKpi('av-kpi-waerme', tw.toFixed(0));
    setKpi('av-kpi-pmax', thl.toFixed(0));
  }

  // WGK + EE from globals (zuverlässiger als DOM-Footer)
  setKpi('av-kpi-wgk', window._lastWgk ? window._lastWgk.toFixed(1) + ' ct' : '—');
  // EE-Anteil direkt berechnen
  const _eeKeys = ['lwwp','fg','geo','pellets','hhs'];
  const _den = window._dispatchEnergy || {};
  let _eeW = 0, _gesW = 0;
  for (const k of Object.keys(_den)) { const w = _den[k]?.waermeMwh || 0; _gesW += w; if (_eeKeys.includes(k) || k === '_thermSpeicher') _eeW += w; }
  setKpi('av-kpi-ee', _gesW > 0 ? (_eeW / _gesW * 100).toFixed(0) + ' %' : '—');

  // CO₂ direkt aus Dispatch-Daten berechnen
  const _co2Eta = _getEtaMap();
  const _co2Emf = { gaskessel:gasEmF, heizoel:heizoelEmF, pellets:pelletsEmF, hhs:hhsEmF,
    _autoGk:gasEmF, fernwaerme:fernwaermeEmF, lwwp:stromEmF, fg:stromEmF, geo:stromEmF, stromkessel:stromEmF, bhkw:gasEmF };
  let _co2Tot = 0;
  for (const k of Object.keys(_den)) {
    const e = _den[k]; if (!e) continue;
    const emf = _co2Emf[k] || 0;
    if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
      _co2Tot += (e.elMwh || 0) * emf / 1e3;
    } else if (k === 'bhkw') {
      const etaTh = ((parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100) / (1 + (parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45));
      _co2Tot += (e.waermeMwh || 0) / etaTh * emf / 1e3;
    } else if (_co2Eta[k]) {
      _co2Tot += (e.waermeMwh || 0) / _co2Eta[k] * emf / 1e3;
    }
  }
  setKpi('av-kpi-co2', _co2Tot > 0.01 ? _co2Tot.toFixed(1) : '—');

  // Render the active section
  const grid    = document.getElementById('analyse-dispatch-grid');
  const waerme  = document.getElementById('analyse-waerme-wrap');
  const emWrap  = document.getElementById('analyse-emissionen-wrap');
  const content = document.getElementById('analyse-section-content');
  if (!grid || !content || !waerme) return;

  // Tab-Buttons + Wrapper einmalig injizieren (idempotent)
  napBuildAnalyseSection();
  knaBuildAnalyseSection();
  pvaBuildAnalyseSection();
  resBuildAnalyseSection();
  ggBuildAnalyseSection();
  lbBuildAnalyseSection();

  // Alle inline-eingebetteten Panels zurücksetzen
  _restoreInlinePanels();

  // Alle Bereiche ausblenden
  grid.style.display    = 'none';
  waerme.style.display  = 'none';
  if (emWrap) emWrap.style.display = 'none';
  content.style.display = 'none';
  const napWrap = document.getElementById('analyse-nap-wrap');
  if (napWrap) napWrap.style.display = 'none';
  const knaWrap = document.getElementById('analyse-kna-wrap');
  if (knaWrap) knaWrap.style.display = 'none';
  const pvaWrap = document.getElementById('analyse-pva-wrap');
  if (pvaWrap) pvaWrap.style.display = 'none';
  const resWrap = document.getElementById('analyse-resilienz-wrap');
  if (resWrap) resWrap.style.display = 'none';
  const ausbWrap = document.getElementById('ausbauplaner-wrap');
  if (ausbWrap) ausbWrap.style.display = 'none';
  const ggWrap = document.getElementById('analyse-ggrafik-wrap');
  if (ggWrap) ggWrap.style.display = 'none';
  const lbWrap = document.getElementById('analyse-liegenschaftsbilder-wrap');
  if (lbWrap) lbWrap.style.display = 'none';

  if (analyseCurrentSection === 'uebersicht') {
    grid.style.display = 'grid';
    renderAnalyseDispatch();
  } else if (analyseCurrentSection === 'waerme') {
    waerme.style.display = 'block';
    _renderWaermeTab();
  } else if (analyseCurrentSection === 'wirtschaft') {
    content.style.display = '';
    _embedPanelInline('wirtschaft-panel', content);
    // Panel-eigene Tab-Leiste und Close-Button im Inline-Modus ausblenden
    const wp = document.getElementById('wirtschaft-panel');
    if (wp) wp.querySelectorAll('.float-panel-close, button[data-click="hidePanels()"]').forEach(b => b.style.display = 'none');
    if (typeof calcWirtschaftPanel === 'function') calcWirtschaftPanel();
  } else if (analyseCurrentSection === 'strom') {
    content.style.display = '';
    _embedPanelInline('strom-panel', content);
    const sp = document.getElementById('strom-panel');
    if (sp) sp.querySelectorAll('.float-panel-close, button[data-click="hidePanels()"]').forEach(b => b.style.display = 'none');
    if (typeof calcStromPanel === 'function') calcStromPanel();
  } else if (analyseCurrentSection === 'emissionen') {
    if (emWrap) { emWrap.style.display = 'block'; _renderEmissionenTab(); }
  } else if (analyseCurrentSection === 'nap') {
    napShowSection(true);
  } else if (analyseCurrentSection === 'kna') {
    knaShowSection(true);
  } else if (analyseCurrentSection === 'pva') {
    pvaShowSection(true);
  } else if (analyseCurrentSection === 'resilienz') {
    resShowSection(true);
  } else if (analyseCurrentSection === 'ggrafik') {
    ggShowSection(true);
  } else if (analyseCurrentSection === 'liegenschaftsbilder') {
    lbShowSection(true);
  } else if (analyseCurrentSection === 'ausbauplaner') {
    if (typeof ausbauShow === 'function') ausbauShow(true);
  }
}

// ── Ebenen-Panel ─────────────────────────────────────────────────────────────
let _ebpOpen = false;

export function toggleEbenenPanel() {
  _ebpOpen = !_ebpOpen;
  const panel   = document.getElementById('ebenen-panel');
  const backdrop = document.getElementById('ebenen-backdrop');
  if (!panel) return;
  panel.style.display    = _ebpOpen ? '' : 'none';
  if (backdrop) backdrop.style.display = _ebpOpen ? '' : 'none';
  if (_ebpOpen) _ebpSyncAll();
}

// Liest den aktuellen Zustand der bestehenden Gebiet-Tab-Checkboxen und synchronisiert den Panel
function _ebpSyncAll() {
  _ebpReadCb('el-geb-visible',      'cb-geb-visible');
  _ebpReadCb('el-labels-visible',   'cb-labels-visible');
  _ebpReadCb('el-netz-visible',     'cb-netz-visible');
  _ebpReadCb('el-satellit-visible', 'cb-satellit-visible');
  _ebpReadCb('el-assets-visible',   'cb-assets-visible');
  _ebpReadCb('el-stromnetz-visible','cb-stromnetz-visible');
  // Chart/Overlay/Viz haben keinen eigenen Quell-Checkbox — State separat halten
}

function _ebpReadCb(panelId, _srcId) {
  // Panel-Checkbox lesen — wird über data-change direkt synchron gehalten
  // Kein Quell-Checkbox nötig; Wert ist schon im Panel gespeichert
  void panelId;
}

// Synchronisiert einen bestehenden Gebiet-Tab-Checkbox (id = dessen id-Attribut)
window._ebpSync = function(srcId, checked) {
  // Quell-Checkbox (Gebiet-Tab) synchronisieren
  const src = document.getElementById(srcId);
  if (src && src.type === 'checkbox') src.checked = checked;
};

// Chart-Toggle
window._ebpChart = function(checked) {
  const panel = document.getElementById('chart-panel');
  const visible = panel?.classList.contains('visible') || false;
  if (visible !== checked && typeof window.toggleChartPanel === 'function') {
    window.toggleChartPanel();
  }
};

// Wärme-Visualisierungs-Toggle
window._ebpViz = function(checked) {
  const cbViz = document.getElementById('cb-viz-circles');
  if (cbViz) { cbViz.checked = checked; cbViz.dispatchEvent(new Event('change')); }
  if (typeof window.updateViz === 'function') window.updateViz();
};

// Standard-Ansicht nach dem Laden eines Projekts: Gebäudeumrisse, Kreise und
// PV-Anlagen sichtbar. Alle übrigen Daten-Ebenen aus.
// (Hintergrund/Satellit bleibt unverändert — Kartenwahl, keine Datenebene.)
window.applyDefaultViewOnLoad = function() {
  // Gebäude-Symbole → Kreise
  if (typeof window.setViz === 'function') window.setViz('circle');

  // Checkbox-Status + zugehörigen Setter setzen
  const setLayer = (cbId, on, fn) => {
    const cb = document.getElementById(cbId);
    if (cb) cb.checked = on;
    if (typeof fn === 'function') fn(on);
  };

  // Sichtbar: Gebäudeumrisse + PV-Anlagen
  setLayer('el-geb-visible', true, window.setGebVisible);
  setLayer('el-pv-visible',  true, window.setPvVisible);

  // Aus: Beschriftung, Wärmenetz-Leitungen, Trassen, Elektro-Assets, Stromnetz
  setLayer('el-labels-visible',    false, window.setLabelsVisible);
  setLayer('el-netz-visible',      false, window.setNetzVisible);
  setLayer('el-trasse-visible',    false, window.setTrasseVisible);
  setLayer('el-assets-visible',    false, window.setAssetLayerVisible);
  setLayer('el-stromnetz-visible', false, window.setStromNetzVisible);

  // An: Wärme-Visualisierung (eigener Mechanismus)
  const cbViz = document.getElementById('el-viz-circles');
  if (cbViz) cbViz.checked = true;
  if (typeof window._ebpViz === 'function') window._ebpViz(true);
};

// Satellit-Toggle
window._ebpSatellit = function(checked) {
  const cbSat = document.getElementById('cb-satellit');
  if (cbSat && cbSat.checked !== checked) {
    cbSat.checked = checked;
    cbSat.dispatchEvent(new Event('change'));
    return;
  }
  if (typeof window.toggleTile === 'function') window.toggleTile(checked);
};
