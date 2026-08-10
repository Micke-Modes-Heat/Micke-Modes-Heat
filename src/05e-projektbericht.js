import { buildProjectReportModel, REPORT_CHAPTERS } from './lib/project-report.js';
import { activeVariantId, gebaeude, globalYear, netzEdges, varianten, variantResults } from './01-globals-varianten.js';

const usageLabels = {
  efh:'Einfamilienhaus', mfh:'Mehrfamilienhaus', ghd:'Gewerbe/Handel', gewerbe:'Gewerbe',
  schule:'Schule', buero:'Büro', industrie:'Industrie',
  oeffentlich:'Öffentliches Gebäude', wohnen:'Wohnen',
  krankenhaus:'Krankenhaus', hotel:'Hotel/Beherbergung', unbekannt:'Unbekannt',
  unterkunft:'Unterkunft / Gemeinschaftsunterkunft', wohnheim:'Wohnheim / Internat', kaserne:'Kaserne / Unterkunftsgebäude',
  pflegeheim:'Pflege- / Seniorenheim', kita:'Kindertagesstätte', hochschule:'Hochschule / Akademie',
  verwaltung:'Verwaltung / Rathaus', polizei:'Polizei / Sicherheitsdienst', feuerwehr:'Feuerwehr',
  rettungswache:'Rettungswache', justiz:'Gericht / Justiz / Vollzug', arztpraxis:'Arztpraxis / Ambulanz',
  sporthalle:'Sport- / Turnhalle', schwimmbad:'Schwimmbad', kultur:'Kultur- / Veranstaltungsgebäude',
  bibliothek:'Bibliothek / Archiv', sakral:'Sakralgebäude', kantine:'Kantine / Großküche',
  werkstatt:'Werkstatt / Instandhaltung', lager:'Lager / Depot', technik:'Technik- / Betriebsgebäude', labor:'Labor / Forschung',
};

const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt = (value, digits=0) => Number(value || 0).toLocaleString('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const money = value => Number(value || 0).toLocaleString('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0});

function parseDisplayedNumber(value) {
  const match = String(value || '').match(/-?[\d.]+(?:,\d+)?/);
  return match ? Number(match[0].replace(/\./g,'').replace(',','.')) || 0 : 0;
}

function collectReportInput(meta={}) {
  const year = Number(globalYear) || new Date().getFullYear();
  const buildings = (gebaeude || []).map(building => {
    const stats = typeof window.getComputedStats === 'function' ? window.getComputedStats(building, year) : {};
    return {
      id:building.id,
      name:building.name || `Gebäude ${building.id}`,
      nutzung:building.nutzung || 'unbekannt',
      year:Number(building.baujahr) || 0,
      areaM2:Number(building.flaeche) || 0,
      heatMwh:Number(stats.waerme ?? building.waerme) || 0,
      peakKw:Number(stats.heizlast ?? building.heizlast) || 0,
    };
  });
  const generation = Object.entries(window._dispatchEnergy || {}).map(([key,value]) => ({
    key,
    label:window.DA_LABELS?.[key] || window.ERZEUGER_CFG?.[key]?.label || key,
    heatMwh:Number(value?.waermeMwh) || 0,
    electricityMwh:Number(value?.elMwh) || 0,
  }));
  const activeVariant = (varianten || []).find(variant => variant.id === activeVariantId);
  const variantsData=Object.entries(variantResults || {}).map(([id,result])=>({
    id,
    label:result?.label || (id==='base'?'Basisdaten':id),
    heatMwh:result?.erzeugung,
    lossesMwh:result?.netzverluste,
    investmentEur:result?.investGes,
    annualCostEur:result?.jkGes,
    heatCostCtKwh:result?.wgkNum,
    co2Tons:result?.co2GesLZ || result?.co2GesH,
    renewablePct:result?.eeAnteil,
  }));
  return {
    title:meta.title,
    client:meta.client,
    author:meta.author,
    year,
    variantName:activeVariant?.name || 'Basisdaten',
    buildings,
    networkEdges:(netzEdges || []).map(edge => ({...edge,lengthM:edge.lengthM ?? edge.length})),
    generation,
    economics:{investmentEur:window._lastInvestGes,annualCostEur:window._lastJkGes,heatCostCtKwh:window._lastWgk},
    emissions:{co2Tons:parseDisplayedNumber(document.getElementById('co2-bilanz-gesamt')?.textContent),renewablePct:window._lastEeAnteil},
    variants:variantsData,
  };
}

async function captureMap(enabled) {
  if (!enabled || typeof window.html2canvas !== 'function') return '';
  const mapElement=document.getElementById('map');
  if (!mapElement) return '';
  try {
    const canvas=await window.html2canvas(mapElement,{useCORS:true,allowTaint:true,scale:1.5,logging:false,backgroundColor:'#eef2f5'});
    return canvas.toDataURL('image/jpeg',0.88);
  } catch (error) {
    console.warn('Projektbericht: Kartenabbildung konnte nicht erzeugt werden.',error);
    return '';
  }
}

function reportStyles() {
  return `@page{size:A4;margin:18mm 17mm}*{box-sizing:border-box}body{margin:0 auto;max-width:820px;padding:22px;font:10pt/1.55 Arial,sans-serif;color:#18232d;background:#fff}h1{font-size:28pt;color:#123d57;margin:0 0 8px}h2{font-size:15pt;color:#086788;border-bottom:2px solid #70b7cc;padding-bottom:5px;margin:28px 0 10px}h3{font-size:11pt;color:#123d57;margin:18px 0 6px}.cover{min-height:82vh;display:flex;flex-direction:column;justify-content:center}.subtitle{font-size:15pt;color:#58717f}.meta{margin-top:32px;padding-top:14px;border-top:2px solid #70b7cc;color:#58717f}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.kpi{border:1px solid #cbd9df;border-radius:7px;padding:10px;text-align:center}.kpi b{display:block;font-size:17pt;color:#086788}.kpi span{font-size:8pt;color:#6f818a}.quality{border-left:4px solid #e0a126;background:#fff8e5;padding:10px 14px;margin:12px 0}.quality.ok{border-color:#3d9970;background:#edf8f2}.quality.bad{border-color:#c84a4a;background:#fff0f0}.issue{margin:5px 0}.tag{display:inline-block;padding:2px 7px;border-radius:10px;background:#edf2f4;color:#49616e;font-size:8pt}table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:9pt}th,td{border:1px solid #d4dfe4;padding:5px 7px;text-align:left}th{background:#eaf2f5;color:#123d57}td.r,th.r{text-align:right}.map{width:100%;max-height:330px;object-fit:cover;border:1px solid #cbd9df;border-radius:6px}.editable{outline:none;border-radius:4px}.editable:hover{background:#fffbe8}.note{font-size:8pt;color:#71828b}.page-break{break-before:page}.chart{margin:12px 0 20px;padding:12px;border:1px solid #d4dfe4;border-radius:7px}.chart-row{display:grid;grid-template-columns:145px 1fr 85px;gap:8px;align-items:center;margin:6px 0;font-size:8.5pt}.chart-track{height:13px;background:#edf2f4;border-radius:8px;overflow:hidden}.chart-bar{height:100%;min-width:2px;background:linear-gradient(90deg,#1485a8,#70b7cc);border-radius:8px}.chart-val{text-align:right;color:#58717f}.toolbar{position:fixed;right:18px;bottom:18px;display:flex;gap:7px;z-index:10}.toolbar button{border:0;border-radius:6px;padding:9px 13px;background:#086788;color:#fff;cursor:pointer}.toolbar .secondary{background:#617884}@media print{body{padding:0}.toolbar,.edit-hint{display:none!important}.page-break{break-before:page}}`;
}

function barChart(items,labelKey,valueKey,unit) {
  const max=Math.max(...items.map(item=>Number(item[valueKey])||0),1);
  return `<div class="chart">${items.map(item=>`<div class="chart-row"><div>${esc(item[labelKey])}</div><div class="chart-track"><div class="chart-bar" style="width:${Math.max(0,(Number(item[valueKey])||0)/max*100)}%"></div></div><div class="chart-val">${fmt(item[valueKey],1)} ${unit}</div></div>`).join('')}</div>`;
}

function renderIssues(model) {
  if (!model.quality.issues.length) return '<div class="quality ok"><strong>Datenstatus: plausibel</strong><div>Die automatischen Grundprüfungen haben keine Auffälligkeit erkannt.</div></div>';
  const cls=model.quality.errorCount?'bad':'';
  return `<div class="quality ${cls}"><strong>Datenstatus: ${esc(model.quality.status)}</strong>${model.quality.issues.map(issue=>`<div class="issue">${issue.level==='error'?'⛔':'⚠'} ${esc(issue.text)}</div>`).join('')}</div>`;
}

function buildReportHtml(model, options, mapImage) {
  const chapters=new Set(options.chapters);
  const section=(id,html)=>chapters.has(id)?html:'';
  const findings=model.findings.map(text=>`<li>${esc(text)}</li>`).join('');
  const groups=model.buildings.groups.map(group=>`<tr><td>${esc(usageLabels[group.key]||group.key)}</td><td class="r">${group.count}</td><td class="r">${fmt(group.areaM2)}</td><td class="r">${fmt(group.heatMwh,1)}</td><td class="r">${fmt(group.peakKw)}</td></tr>`).join('');
  const generators=model.generation.items.map(item=>`<tr><td>${esc(item.label)}</td><td class="r">${fmt(item.heatMwh,1)}</td><td class="r">${model.generation.totalMwh?fmt(item.heatMwh/model.generation.totalMwh*100,1):'—'}</td><td class="r">${item.electricityMwh?fmt(item.electricityMwh,1):'—'}</td></tr>`).join('');
  const reportDate=new Date(model.meta.createdAt).toLocaleDateString('de-DE');
  const qualityText=model.quality.status==='plausibel'?'Die Datengrundlage ist für eine erste Ergebnisbewertung plausibel.':model.quality.errorCount?'Vor einer belastbaren fachlichen Freigabe müssen die als kritisch gekennzeichneten Punkte geklärt werden.':'Die Ergebnisse sind nutzbar, die gekennzeichneten Annahmen sollten jedoch fachlich geprüft werden.';
  const recommendations=model.quality.issues.map(issue=>`<li>${esc(issue.text)}</li>`).join('') || '<li>Ergebnisse mit den Projektbeteiligten abstimmen und die gewählte Variante dokumentieren.</li>';
  const customSummary=options.customSummary || qualityText;
  const defaultConclusion=`Aus der automatischen Plausibilitätsprüfung ergeben sich folgende Punkte: ${model.quality.issues.map(issue=>issue.text).join(' ')} Die abschließende Bewertung und Empfehlung ist durch die fachlich verantwortliche Bearbeitung zu ergänzen.`;
  const customConclusion=options.customConclusion || defaultConclusion;
  const variantRows=model.variants.map(variant=>`<tr><td>${esc(variant.label)}</td><td class="r">${fmt(variant.heatMwh,1)}</td><td class="r">${fmt(variant.lossesMwh,1)}</td><td class="r">${variant.investmentEur?money(variant.investmentEur):'—'}</td><td class="r">${variant.annualCostEur?money(variant.annualCostEur):'—'}</td><td class="r">${variant.heatCostCtKwh?fmt(variant.heatCostCtKwh,1):'—'}</td><td class="r">${variant.co2Tons?fmt(variant.co2Tons,1):'—'}</td><td class="r">${variant.renewablePct?fmt(variant.renewablePct,1):'—'}</td></tr>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(model.meta.title)}</title><style>${reportStyles()}</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Drucken / PDF</button><button class="secondary" onclick="document.querySelectorAll('[contenteditable]').forEach(e=>e.removeAttribute('contenteditable'));this.parentElement.remove()">Bearbeitung abschließen</button></div>
  <div class="cover"><span class="tag">Automatisch erzeugter Ergebnisbericht</span><h1>${esc(model.meta.title)}</h1><div class="subtitle">${esc(model.meta.variantName)} · Betrachtungsjahr ${esc(model.meta.year||'—')}</div>${mapImage?`<img class="map" src="${mapImage}" alt="Projektkarte" style="margin-top:25px">`:''}<div class="meta">${model.meta.client?`<strong>Auftraggeber:</strong> ${esc(model.meta.client)}<br>`:''}${model.meta.author?`<strong>Bearbeitung:</strong> ${esc(model.meta.author)}<br>`:''}<strong>Erstellt:</strong> ${reportDate}<br><strong>Datenstatus:</strong> ${esc(model.quality.status)}</div></div>
  <div class="edit-hint note">Gelb hinterlegte Textbereiche können vor dem Drucken direkt bearbeitet werden.</div>
  ${section('summary',`<div class="page-break"></div><h2>1. Zusammenfassung</h2><div class="kpis"><div class="kpi"><b>${model.buildings.count}</b><span>Gebäude</span></div><div class="kpi"><b>${fmt(model.buildings.totalHeatMwh)}</b><span>MWh/a Wärmebedarf</span></div><div class="kpi"><b>${fmt(model.buildings.totalPeakKw)}</b><span>kW Heizlast</span></div><div class="kpi"><b>${model.network.exists?fmt(model.network.lengthM):'—'}</b><span>m Wärmenetz</span></div></div><ul>${findings}</ul><p id="report-custom-summary" class="editable" contenteditable="true">${esc(customSummary)}</p>`)}
  ${section('quality',`<h2>2. Datengrundlage und Qualität</h2>${renderIssues(model)}<table><tr><th>Prüfgröße</th><th class="r">Anzahl</th></tr><tr><td>Gebäude ohne Fläche</td><td class="r">${model.buildings.missing.area}</td></tr><tr><td>Gebäude ohne Baujahr</td><td class="r">${model.buildings.missing.year}</td></tr><tr><td>Gebäude ohne eindeutige Nutzung</td><td class="r">${model.buildings.missing.usage}</td></tr><tr><td>Gebäude ohne Wärmebedarf</td><td class="r">${model.buildings.missing.heat}</td></tr></table><p class="note">Die automatische Prüfung ersetzt keine fachliche Plausibilisierung. Berechnungsannahmen und Bilanzgrenzen sind vor einer externen Verwendung zu bestätigen.</p>`)}
  ${section('buildings',`<h2>3. Gebäudebestand</h2><p>Die erfasste Bruttogrundfläche beträgt ${fmt(model.buildings.totalAreaM2)} m². Der summierte Wärmebedarf liegt bei ${fmt(model.buildings.totalHeatMwh,1)} MWh/a.</p>${barChart(model.buildings.groups.map(group=>({...group,label:usageLabels[group.key]||group.key})),'label','heatMwh','MWh/a')}<table><thead><tr><th>Nutzung</th><th class="r">Gebäude</th><th class="r">Fläche m²</th><th class="r">Wärme MWh/a</th><th class="r">Heizlast kW</th></tr></thead><tbody>${groups||'<tr><td colspan="5">Keine Gebäudedaten vorhanden.</td></tr>'}</tbody></table>`)}
  ${section('generation',`<h2>4. Wärmebedarf und Erzeugung</h2><p>Die simulierte Erzeugung beträgt ${fmt(model.generation.totalMwh,1)} MWh/a. Gegenüber dem summierten Gebäudebedarf ergibt sich eine Differenz von ${fmt(model.generation.balanceDeltaMwh,1)} MWh/a (${fmt(model.generation.balanceDeltaPct,1)} %). Diese Differenz kann insbesondere Netzverluste und unterschiedliche Bilanzgrenzen enthalten.</p>${barChart(model.generation.items,'label','heatMwh','MWh/a')}<table><thead><tr><th>Erzeuger</th><th class="r">Wärme MWh/a</th><th class="r">Anteil %</th><th class="r">Strom MWh/a</th></tr></thead><tbody>${generators||'<tr><td colspan="4">Noch keine Dispatch-Ergebnisse vorhanden.</td></tr>'}</tbody></table>`)}
  ${section('network',`<h2>5. Wärmenetz</h2>${model.network.exists?`<div class="kpis"><div class="kpi"><b>${fmt(model.network.lengthM)}</b><span>m Leitung</span></div><div class="kpi"><b>${model.buildings.connected}/${model.buildings.count}</b><span>Gebäude angebunden</span></div><div class="kpi"><b>${fmt(model.network.lossMwh,1)}</b><span>MWh/a Verluste</span></div><div class="kpi"><b>${fmt(model.network.maxUtilizationPct,1)} %</b><span>max. Auslastung</span></div></div><p>${model.network.overloadedCount?(model.network.overloadedCount===1?'Ein Leitungsabschnitt liegt über 100 % Auslastung und ist zu prüfen.':`${model.network.overloadedCount} Leitungsabschnitte liegen über 100 % Auslastung und sind zu prüfen.`):'Es wurden keine Leitungsabschnitte mit einer Auslastung über 100 % erkannt.'}</p>`:'<p>Im betrachteten Projekt ist kein Wärmenetz aufgebaut.</p>'}`)}
  ${section('economics',`<h2>6. Wirtschaftlichkeit</h2><div class="kpis"><div class="kpi"><b>${model.economics.investmentEur?money(model.economics.investmentEur):'—'}</b><span>Investition</span></div><div class="kpi"><b>${model.economics.annualCostEur?money(model.economics.annualCostEur):'—'}</b><span>jährliche Kosten</span></div><div class="kpi"><b>${model.economics.heatCostCtKwh?fmt(model.economics.heatCostCtKwh,1):'—'}</b><span>ct/kWh Wärmegestehung</span></div></div><p class="editable" contenteditable="true">Die Wirtschaftlichkeitswerte beruhen auf den im Projekt hinterlegten Preis-, Investitions- und Finanzierungsannahmen.</p>`)}
  ${section('emissions',`<h2>7. Ökologie und CO₂</h2><div class="kpis"><div class="kpi"><b>${model.emissions.co2Tons?fmt(model.emissions.co2Tons,1):'—'}</b><span>t CO₂/a</span></div><div class="kpi"><b>${model.emissions.renewablePct?fmt(model.emissions.renewablePct,1):'—'}</b><span>% erneuerbare Wärme</span></div></div>`)}
  ${section('variants',`<h2>8. Variantenvergleich</h2>${model.variants.length?`${barChart(model.variants,'label','heatCostCtKwh','ct/kWh')}<table><thead><tr><th>Variante</th><th class="r">Wärme MWh/a</th><th class="r">Verluste MWh/a</th><th class="r">Invest</th><th class="r">Kosten/a</th><th class="r">WGK ct/kWh</th><th class="r">CO₂ t/a</th><th class="r">EE %</th></tr></thead><tbody>${variantRows}</tbody></table>`:'<p>Es wurden noch keine zwischengespeicherten Variantenergebnisse berechnet.</p>'}`)}
  ${section('recommendations',`<h2>9. Fazit und nächste Schritte</h2><div id="report-custom-conclusion" class="editable" contenteditable="true"><p>${esc(customConclusion)}</p>${options.customConclusion?'':`<ul>${recommendations}</ul>`}</div>`)}
  <hr><p class="note">Automatisch erstellt mit dem Energieplanungs-Tool · Variante ${esc(model.meta.variantName)} · Jahr ${esc(model.meta.year||'—')} · Datenstatus ${esc(model.quality.status)}</p></body></html>`;
}

export function closeProjectReportWizard() {
  document.getElementById('project-report-wizard')?.remove();
}

export async function generateProjectReport() {
  const modal=document.getElementById('project-report-wizard');
  if (!modal) return;
  const title=modal.querySelector('#pr-title')?.value.trim() || 'Energetischer Ergebnisbericht';
  const client=modal.querySelector('#pr-client')?.value.trim() || '';
  const author=modal.querySelector('#pr-author')?.value.trim() || '';
  const chapters=[...modal.querySelectorAll('[data-report-chapter]:checked')].map(input=>input.value);
  if (!chapters.length) {
    window.showHint?.('Bitte mindestens ein Berichtskapitel auswählen.');
    return;
  }
  const includeMap=!!modal.querySelector('#pr-map')?.checked;
  const previousDraft=window._projectReportDraft || {};
  window._projectReportDraft={
    title,client,author,chapters,includeMap,
    customSummary:previousDraft.customSummary || '',
    customConclusion:previousDraft.customConclusion || '',
  };
  const reportWindow=window.open('','_blank');
  if (!reportWindow) {
    window.showHint?.('Popup wurde blockiert. Bitte Popups für diese Seite erlauben.');
    return;
  }
  reportWindow.document.write('<p style="font-family:sans-serif;padding:30px">Bericht wird erstellt …</p>');
  const model=buildProjectReportModel(collectReportInput({title,client,author}));
  const mapImage=await captureMap(includeMap);
  reportWindow.document.open();
  reportWindow.document.write(buildReportHtml(model,{chapters,customSummary:window._projectReportDraft.customSummary,customConclusion:window._projectReportDraft.customConclusion},mapImage));
  reportWindow.document.close();
  const persistEditableTexts=()=>{
    window._projectReportDraft={
      ...(window._projectReportDraft||{}),
      customSummary:reportWindow.document.getElementById('report-custom-summary')?.innerText?.trim() || '',
      customConclusion:reportWindow.document.getElementById('report-custom-conclusion')?.innerText?.trim() || '',
    };
  };
  reportWindow.document.querySelectorAll('[contenteditable="true"]').forEach(element=>element.addEventListener('input',persistEditableTexts));
  reportWindow.addEventListener('beforeunload',persistEditableTexts);
  closeProjectReportWizard();
}

export function openProjectReportWizard() {
  closeProjectReportWizard();
  const draft=window._projectReportDraft || {};
  const projectName=document.querySelector('.header-projekt-name')?.textContent?.trim();
  const defaultTitle=projectName?`Energetischer Ergebnisbericht – ${projectName}`:'Energetischer Ergebnisbericht';
  const model=buildProjectReportModel(collectReportInput({title:draft.title||defaultTitle,client:draft.client||'',author:draft.author||''}));
  const selectedChapters=new Set(Array.isArray(draft.chapters)?draft.chapters:REPORT_CHAPTERS.map(chapter=>chapter.id));
  const overlay=document.createElement('div');
  overlay.id='project-report-wizard';
  overlay.className='ep-modal-overlay project-report-overlay';
  overlay.innerHTML=`<div class="ep-modal project-report-modal" role="dialog" aria-modal="true" aria-labelledby="project-report-title"><div class="project-report-head"><div><div class="ep-modal-title" id="project-report-title">📄 Automatischen Projektbericht erstellen</div><div class="project-report-sub">Geprüfte Projektdaten, nachvollziehbare Textbausteine und druckbare Vorschau</div></div><button class="project-report-close" data-click="closeProjectReportWizard()" aria-label="Schließen">×</button></div><div class="project-report-grid"><label>Berichtstitel<input class="ep-modal-input" id="pr-title" value="${esc(model.meta.title)}"></label><label>Auftraggeber<input class="ep-modal-input" id="pr-client" value="${esc(model.meta.client)}" placeholder="optional"></label><label>Bearbeitung<input class="ep-modal-input" id="pr-author" value="${esc(model.meta.author)}" placeholder="optional"></label><label class="project-report-map"><input type="checkbox" id="pr-map" ${draft.includeMap===false?'':'checked'}> Aktuellen Kartenausschnitt aufnehmen</label></div><div class="project-report-section-title">Kapitel</div><div class="project-report-chapters">${REPORT_CHAPTERS.map(chapter=>`<label><input type="checkbox" data-report-chapter value="${chapter.id}" ${selectedChapters.has(chapter.id)?'checked':''}> ${esc(chapter.label)}</label>`).join('')}</div><div class="project-report-section-title">Automatische Datenprüfung</div>${renderIssues(model)}<div class="project-report-draft-hint">Eigene Texte und Einstellungen werden beim nächsten Speichern in der Projektdatei gesichert.</div><div class="ep-modal-btns"><button class="ep-modal-btn" data-click="closeProjectReportWizard()">Abbrechen</button><button class="ep-modal-btn primary" data-click="generateProjectReport()">Vorschau erstellen</button></div></div>`;
  overlay.addEventListener('mousedown',event=>{if(event.target===overlay) closeProjectReportWizard();});
  document.body.appendChild(overlay);
  overlay.querySelector('#pr-title')?.focus();
}
