const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export const REPORT_CHAPTERS = [
  {id:'summary', label:'Zusammenfassung'},
  {id:'quality', label:'Datengrundlage und Qualität'},
  {id:'buildings', label:'Gebäudebestand'},
  {id:'generation', label:'Wärmebedarf und Erzeugung'},
  {id:'network', label:'Wärmenetz'},
  {id:'economics', label:'Wirtschaftlichkeit'},
  {id:'emissions', label:'Ökologie und CO₂'},
  {id:'variants', label:'Variantenvergleich'},
  {id:'recommendations', label:'Fazit und nächste Schritte'},
];

function groupBuildings(buildings) {
  const groups = {};
  for (const building of buildings) {
    const key = building.nutzung || 'unbekannt';
    if (!groups[key]) groups[key] = {key, count:0, areaM2:0, heatMwh:0, peakKw:0};
    groups[key].count++;
    groups[key].areaM2 += num(building.areaM2);
    groups[key].heatMwh += num(building.heatMwh);
    groups[key].peakKw += num(building.peakKw);
  }
  return Object.values(groups).sort((a,b) => b.heatMwh - a.heatMwh);
}

export function buildProjectReportModel(input = {}) {
  const buildings = Array.isArray(input.buildings) ? input.buildings : [];
  const networkEdges = (Array.isArray(input.networkEdges) ? input.networkEdges : []).filter(edge => !edge.pruned);
  const generation = (Array.isArray(input.generation) ? input.generation : []).filter(item => num(item.heatMwh) > 0);
  const buildingIds = new Set(buildings.map(building => String(building.id)));
  const connectedIds = new Set(networkEdges.flatMap(edge => [String(edge.u), String(edge.v)]));
  const connectedBuildings = buildings.filter(building => connectedIds.has(String(building.id))).length;
  const totalAreaM2 = buildings.reduce((sum, building) => sum + num(building.areaM2), 0);
  const totalHeatMwh = buildings.reduce((sum, building) => sum + num(building.heatMwh), 0);
  const totalPeakKw = buildings.reduce((sum, building) => sum + num(building.peakKw), 0);
  const generationMwh = generation.reduce((sum, item) => sum + num(item.heatMwh), 0);
  const networkLengthM = networkEdges.reduce((sum, edge) => sum + num(edge.lengthM ?? edge.length), 0);
  const networkLossMwh = networkEdges.reduce((sum, edge) => sum + num(edge.lossMwh ?? (num(edge.lossKW_annual) * 8.76)), 0);
  const overloaded = networkEdges.filter(edge => num(edge.utilizationPct) > 100);
  const maxUtilizationPct = networkEdges.reduce((max, edge) => Math.max(max, num(edge.utilizationPct)), 0);
  const missing = {
    area:buildings.filter(building => num(building.areaM2) <= 0).length,
    year:buildings.filter(building => !num(building.year)).length,
    usage:buildings.filter(building => !building.nutzung || building.nutzung === 'unbekannt').length,
    heat:buildings.filter(building => num(building.heatMwh) <= 0).length,
  };
  const issues = [];
  if (!buildings.length) issues.push({level:'error', code:'no-buildings', text:'Es sind keine Gebäude im Projekt vorhanden.'});
  if (missing.area) issues.push({level:'warning', code:'missing-area', text:`Bei ${missing.area} Gebäuden fehlt eine belastbare Fläche.`});
  if (missing.year) issues.push({level:'warning', code:'missing-year', text:`Bei ${missing.year} Gebäuden fehlt das Baujahr.`});
  if (missing.usage) issues.push({level:'warning', code:'missing-usage', text:`Bei ${missing.usage} Gebäuden ist die Nutzung nicht eindeutig zugeordnet.`});
  if (missing.heat) issues.push({level:'warning', code:'missing-heat', text:`Bei ${missing.heat} Gebäuden fehlt ein Wärmebedarf.`});
  if (!generation.length) issues.push({level:'warning', code:'no-dispatch', text:'Es liegt noch keine berechnete Jahreserzeugung vor.'});
  const balanceDeltaMwh = generationMwh - totalHeatMwh;
  const balanceDeltaPct = totalHeatMwh > 0 ? balanceDeltaMwh / totalHeatMwh * 100 : 0;
  if (generationMwh > 0 && totalHeatMwh > 0 && Math.abs(balanceDeltaPct) > 15) {
    issues.push({level:'warning', code:'heat-balance', text:`Erzeugung und summierter Gebäudebedarf weichen um ${Math.abs(balanceDeltaPct).toFixed(1)} % voneinander ab. Netzverluste und Bilanzgrenzen sind zu prüfen.`});
  }
  if (networkEdges.length && connectedBuildings < buildings.length) {
    issues.push({level:'warning', code:'disconnected', text:`${buildings.length-connectedBuildings} Gebäude sind im Betrachtungsjahr nicht an das Wärmenetz angebunden.`});
  }
  if (overloaded.length) issues.push({level:'error', code:'overloaded', text:overloaded.length === 1
    ? 'Ein Leitungsabschnitt weist eine berechnete Auslastung über 100 % auf.'
    : `${overloaded.length} Leitungsabschnitte weisen eine berechnete Auslastung über 100 % auf.`});

  const errorCount = issues.filter(issue => issue.level === 'error').length;
  const warningCount = issues.filter(issue => issue.level === 'warning').length;
  const quality = errorCount ? 'kritisch' : warningCount ? 'prüfbedürftig' : 'plausibel';
  const findings = [];
  if (buildings.length) findings.push(`Im Betrachtungsjahr ${input.year || '—'} umfasst das Projekt ${buildings.length} Gebäude mit ${Math.round(totalAreaM2).toLocaleString('de-DE')} m² Fläche und ${Math.round(totalHeatMwh).toLocaleString('de-DE')} MWh/a Wärmebedarf.`);
  if (networkEdges.length) findings.push(`${connectedBuildings} von ${buildings.length} Gebäuden sind über rund ${Math.round(networkLengthM).toLocaleString('de-DE')} m Wärmeleitungen angebunden. Die berechneten Netzverluste betragen ${networkLossMwh.toLocaleString('de-DE',{maximumFractionDigits:1})} MWh/a.`);
  if (generationMwh > 0) findings.push(`Die simulierte Jahreswärmeerzeugung beträgt ${Math.round(generationMwh).toLocaleString('de-DE')} MWh/a und wird durch ${generation.length} aktive Erzeuger bereitgestellt.`);
  if (overloaded.length) findings.push(`Die höchste berechnete Leitungsauslastung liegt bei ${maxUtilizationPct.toLocaleString('de-DE',{maximumFractionDigits:1})} %. Die betroffenen Abschnitte müssen fachlich geprüft werden.`);

  const variants=(Array.isArray(input.variants)?input.variants:[]).map(variant=>({
    id:variant.id,
    label:variant.label || variant.id || 'Variante',
    heatMwh:num(variant.heatMwh),
    lossesMwh:num(variant.lossesMwh),
    investmentEur:num(variant.investmentEur),
    annualCostEur:num(variant.annualCostEur),
    heatCostCtKwh:num(variant.heatCostCtKwh),
    co2Tons:num(variant.co2Tons),
    renewablePct:num(variant.renewablePct),
  }));
  return {
    meta:{title:input.title || 'Automatischer Projektbericht', client:input.client || '', author:input.author || '', year:input.year || null, variantName:input.variantName || 'Basisdaten', createdAt:input.createdAt || new Date().toISOString()},
    buildings:{count:buildings.length, connected:connectedBuildings, totalAreaM2, totalHeatMwh, totalPeakKw, missing, groups:groupBuildings(buildings)},
    generation:{items:generation, totalMwh:generationMwh, balanceDeltaMwh, balanceDeltaPct},
    network:{exists:networkEdges.length>0, edgeCount:networkEdges.length, lengthM:networkLengthM, lossMwh:networkLossMwh, overloadedCount:overloaded.length, maxUtilizationPct, foreignNodeCount:[...connectedIds].filter(id => !buildingIds.has(id)).length},
    economics:{investmentEur:num(input.economics?.investmentEur), annualCostEur:num(input.economics?.annualCostEur), heatCostCtKwh:num(input.economics?.heatCostCtKwh)},
    emissions:{co2Tons:num(input.emissions?.co2Tons), renewablePct:num(input.emissions?.renewablePct)},
    variants,
    quality:{status:quality, errorCount, warningCount, issues},
    findings,
  };
}
