// ── 05a-export.js — CSV-Export, PDF-Report, Druckansicht ──
// ── Export: Dispatch CSV ──────────────────────────────────────────────────
import { gebaeude, globalYear, netzEdges } from './01-globals-varianten.js';
import { getComputedStats } from './02b-gebaeude.js';
import { updateLpMeritOrder, updateLpNetzSummary } from './04a-ui-panels.js';
import { updateLpStromSummary } from './05b-stromnetz.js';
import { DA_LABELS } from './07a-analysis-charts.js';
import { ASSETS, getAssetStatus, ASSET_PROPS_SCHEMA } from './13a-assets-core.js';

const ASSET_LABELS = {
  NAP: 'Netzanschlusspunkt', Trafo: 'Transformator', Schaltanlage: 'Schaltanlage',
  NSHV: 'NSHV', UV: 'Unterverteilung', KVS: 'KVS', Verbraucher: 'Verbraucher',
  WP: 'Wärmepumpe', PV: 'PV-Anlage', Batterie: 'Batteriespeicher',
  Lade: 'Ladeinfrastruktur', Nsa: 'Notstromaggregat', KWK: 'KWK-Anlage',
  Wind: 'Windkraftanlage', Reserve: 'Reserve',
};

export function exportDispatchCSV() {
  const keys = window._dispatchActiveKeys || [];
  const en   = window._dispatchEnergy || {};
  const hourly = window._dispatchHourly || {};
  if (!keys.length) { alert('Erst Dispatch berechnen.'); return; }

  const DA_L = typeof DA_LABELS !== 'undefined' ? DA_LABELS : {};
  let csv = 'Stunde;Monat';
  keys.forEach(k => csv += ';' + (DA_L[k] || k) + ' (kW)');
  csv += ';Gesamt (kW)';
  if (window.elQuartierH) csv += ';Quartier-Strom (kWh)';
  if (window.elPvH) csv += ';PV-Erzeugung (kWh)';
  csv += '\n';

  const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const mStarts = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
  for (let t = 0; t < 8760; t++) {
    let m = 0; for (let mi = 11; mi >= 0; mi--) { if (t >= mStarts[mi]) { m = mi; break; } }
    let row = `${t+1};${monthNames[m]}`;
    let sum = 0;
    keys.forEach(k => {
      const v = hourly[k] ? hourly[k][t] : 0;
      sum += v;
      row += ';' + v.toFixed(1).replace('.', ',');
    });
    row += ';' + sum.toFixed(1).replace('.', ',');
    if (window.elQuartierH) row += ';' + (window.elQuartierH[t] || 0).toFixed(2).replace('.', ',');
    if (window.elPvH) row += ';' + (window.elPvH[t] || 0).toFixed(2).replace('.', ',');
    csv += row + '\n';
  }

  // Summary rows
  csv += '\n;ZUSAMMENFASSUNG\n';
  csv += 'Erzeuger;Wärme (MWh/a);Strom (MWh/a);Anteil (%)\n';
  const totalMwh = keys.reduce((s, k) => s + ((en[k]||{}).waermeMwh || 0), 0);
  keys.forEach(k => {
    const e = en[k] || {};
    csv += `${DA_L[k]||k};${(e.waermeMwh||0).toFixed(1).replace('.',',')};${(e.elMwh||0).toFixed(1).replace('.',',')};${totalMwh>0?((e.waermeMwh||0)/totalMwh*100).toFixed(1).replace('.',','):'0'}\n`;
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dispatch_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

// ── Export: Gebäude CSV ──────────────────────────────────────────────────
export function exportGebaeudeCSV() {
  if (!gebaeude.length) { alert('Keine Gebäude vorhanden.'); return; }
  let csv = 'ID;Name;Nutzung;Fläche (m²);Baujahr;Zustand;Wärmebedarf (MWh/a);Heizlast (kW);Spez. Wärme (kWh/m²a);Spez. Heizlast (W/m²);Strom (MWh/a);PV aktiv;PV Dachanteil (%);Am Netz;Netzverluste (MWh/a)\n';
  const connectedIds = new Set(netzEdges.filter(e => !e.pruned).flatMap(e => [e.u, e.v]));
  gebaeude.forEach(g => {
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    csv += [
      g.id,
      '"' + (g.name || '').replace(/"/g, '""') + '"',
      g.nutzung || '',
      (g.flaeche || ''),
      (g.baujahr || ''),
      (g.zustand || ''),
      (st.waerme || g.waerme || '').toString().replace('.', ','),
      (st.heizlast || g.heizlast || '').toString().replace('.', ','),
      (st.spez || g.spez || '').toString().replace('.', ','),
      (st.spezHeizlast || g.spezHeizlast || '').toString().replace('.', ','),
      (typeof getGebStromMwh === 'function' ? getGebStromMwh(g).toFixed(2).replace('.', ',') : ''),
      g.pvAktiv ? 'Ja' : 'Nein',
      g.pvDachanteil || 30,
      connectedIds.has(g.id) ? 'Ja' : 'Nein',
      (g.netzVerlustJahrMWh || 0).toFixed(2).replace('.', ','),
    ].join(';') + '\n';
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gebaeude_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

// ── Export: PDF Bericht (Transformationsplan-Stil) ──────────────────────
async function exportPDFReport() {
  const keys = window._dispatchActiveKeys || [];
  const en   = window._dispatchEnergy || {};
  const DA_L = typeof DA_LABELS !== 'undefined' ? DA_LABELS : {};
  const fmt  = v => Number(Math.round(v)).toLocaleString('de-DE');
  const fmtD = (v, d) => Number(v).toLocaleString('de-DE', {minimumFractionDigits:d, maximumFractionDigits:d});
  let figNr = 0, tabNr = 0;
  const fig = caption => '<div class="fig-caption">Abbildung ' + (++figNr) + ': ' + caption + '</div>';
  const tab = caption => '<div class="tab-caption">Tabelle ' + (++tabNr) + ': ' + caption + '</div>';

  // ── Daten sammeln ─────────────────────────────────────────────
  const totalMwh = keys.reduce((s, k) => s + ((en[k]||{}).waermeMwh || 0), 0);
  const connectedIds = new Set((Array.isArray(netzEdges) ? netzEdges : []).filter(e => !e.pruned).flatMap(e => [e.u, e.v]));
  const nGeb = gebaeude.length;
  const nAngeschlossen = gebaeude.filter(g => connectedIds.has(g.id)).length;
  const wgkVal = window._lastWgk ? window._lastWgk.toFixed(1) : '\u2014';
  const activeNetz = (Array.isArray(netzEdges) ? netzEdges : []).filter(e => !e.pruned);
  const trasseLaenge = Math.round(activeNetz.reduce((s, e) => s + (e.length || 0), 0));
  const totalLossMwh = activeNetz.reduce((s, e) => s + (e.lossKW_annual || 0), 0) * 8.76;
  const verlustPct = totalMwh > 0 ? (totalLossMwh / totalMwh * 100) : 0;
  const gesamtFlaeche = gebaeude.reduce((s,g) => s + (parseFloat(g.flaeche)||0), 0);
  const gesamtHeizlast = gebaeude.reduce((s,g) => s + (parseFloat(typeof getComputedStats === 'function' ? getComputedStats(g, globalYear).heizlast : g.heizlast)||0), 0);
  const sd = window._sankeyData || {};
  const eeAnteil = window._lastEeAnteil;
  const co2Gesamt = document.getElementById('co2-bilanz-gesamt')?.textContent || '\u2014';
  const vlTemp = parseFloat(document.getElementById('netz-vl')?.value) || 90;
  const rlTemp = parseFloat(document.getElementById('netz-rl')?.value) || 60;
  const datum = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });
  const zeit = new Date().toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
  const varName = activeVariantId ? (varianten.find(v => v.id === activeVariantId)?.name || 'Variante') : 'Basisdaten';

  // ── Canvas-Bilder exportieren ─────────────────────────────────
  let mapImg = '';
  try {
    if (typeof html2canvas !== 'undefined') {
      const mapEl = document.getElementById('map');
      if (mapEl) {
        const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: '#1a1a2e' });
        mapImg = canvas.toDataURL('image/png');
      }
    }
  } catch(e) { console.warn('Kartenexport fehlgeschlagen:', e); }

  const canvasIds = ['sankey-canvas','da-canvas','da-canvas-jdl','da-canvas-woche','strom-monats-canvas','strom-jdl-canvas',
    'ep-hourly-canvas','ep-monthly-canvas','av-lastgang-canvas','av-jdl-canvas','gl-split-canvas','em-stunden-canvas','em-monat-canvas'];
  const cImg = {};
  canvasIds.forEach(id => {
    try { const c = document.getElementById(id); if (c && c.width > 0) cImg[id] = c.toDataURL('image/png'); } catch(e) {}
  });

  // ── Wirtschaftlichkeit-Tabelle ────────────────────────────────
  const wirtEl = document.getElementById('wirt-table-wrap');
  const wirtHtml = wirtEl ? wirtEl.innerHTML : '';
  const investGes = window._lastInvestGes || 0;
  const jkGes = window._lastJkGes || 0;

  // ── Stromnetz-Daten ───────────────────────────────────────────
  const stromKpis = window._stromNetzKpis || {};
  const stromTrasseLaenge = stromEdges ? Math.round(stromEdges.reduce((s, e) => s + (e.lengthM || 0), 0)) : 0;
  const hatStromNetz = stromEdges && stromEdges.length > 0;
  const hatStromBilanz = sd.pvMwh > 0 || sd.bhkwStromMwh > 0 || (sd.netzbezugMwh||0) > 0;

  // ══════════════════════════════════════════════════════════════
  // HTML aufbauen
  // ══════════════════════════════════════════════════════════════
  var h = '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">';
  h += '<title>Transformationsplan \u2014 ' + varName + '</title>';
  h += '<s' + 'tyle>';

  // ── CSS: GERTEC-inspiriertes Styling ──────────────────────────
  h += '@page{margin:20mm 18mm;size:A4}';
  h += '@media print{.page-break{page-break-before:always}.no-print{display:none!important}.toc a{color:#1a1a2e!important}}';
  h += ':root{--blue:#0055a0;--blue-light:#e8f0fa;--blue-dark:#003366;--red:#c0392b;--gray:#5a6a7a;--gray-light:#95a5b5;--border:#d5dde5}';
  h += 'body{font-family:"Segoe UI",system-ui,"Helvetica Neue",Arial,sans-serif;font-size:10pt;color:#1a1a2e;line-height:1.6;max-width:720px;margin:0 auto;padding:12mm 0}';

  // Headings
  h += 'h1{font-size:24pt;color:var(--blue-dark);margin:0 0 6px;font-weight:700;letter-spacing:-0.01em}';
  h += 'h2{font-size:14pt;color:var(--blue);margin:28px 0 10px;padding-bottom:5px;border-bottom:2.5px solid var(--blue);font-weight:700}';
  h += 'h3{font-size:11pt;color:var(--blue-dark);margin:18px 0 6px;font-weight:600}';
  h += 'h4{font-size:10pt;color:var(--gray);margin:12px 0 4px;font-weight:600}';

  // Tables
  h += 'table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:9pt}';
  h += 'th,td{border:1px solid var(--border);padding:4px 8px}';
  h += 'th{background:var(--blue-light);font-weight:600;text-align:left;color:var(--blue-dark);font-size:8.5pt}';
  h += 'td{color:#1a1a2e}';
  h += 'tr:nth-child(even) td{background:#f8fafc}';
  h += 'td.r,th.r{text-align:right}';
  h += 'td.c,th.c{text-align:center}';

  // KPI tiles
  h += '.kpi-row{display:flex;gap:10px;margin:14px 0;flex-wrap:wrap}';
  h += '.kpi{flex:1;min-width:120px;border:1.5px solid var(--border);border-radius:8px;padding:12px 10px;text-align:center;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)}';
  h += '.kpi-val{font-size:20pt;font-weight:700;color:var(--blue);line-height:1.2}';
  h += '.kpi-label{font-size:7.5pt;color:var(--gray-light);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}';
  h += '.kpi-unit{font-size:9pt;color:var(--gray);font-weight:400}';
  h += '.kpi.accent .kpi-val{color:var(--red)}';

  // Figure / Table captions
  h += '.fig-caption,.tab-caption{font-size:8.5pt;color:var(--gray);font-style:italic;margin:4px 0 12px;text-align:center}';
  h += '.tab-caption{text-align:left;margin:2px 0 2px}';

  // Chart images
  h += '.chart-img{max-width:100%;height:auto;margin:6px 0;border:1px solid var(--border);border-radius:4px}';

  // Deckblatt
  h += '.deckblatt{text-align:center;padding:80px 0 40px;min-height:85vh;display:flex;flex-direction:column;justify-content:center;align-items:center}';
  h += '.deck-logo{font-size:11pt;color:var(--blue);text-transform:uppercase;letter-spacing:.2em;margin-bottom:30px;font-weight:600}';
  h += '.deck-title{font-size:28pt;color:var(--blue-dark);font-weight:700;margin-bottom:8px;letter-spacing:-0.01em}';
  h += '.deck-sub{font-size:14pt;color:var(--gray);margin-bottom:40px;font-weight:400}';
  h += '.deck-info{display:inline-block;border-top:2px solid var(--blue);padding-top:16px;font-size:10pt;color:var(--gray);line-height:1.8;text-align:left}';
  h += '.deck-info strong{color:var(--blue-dark)}';

  // TOC
  h += '.toc{margin:20px 0}';
  h += '.toc-item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted var(--border);font-size:10pt;color:#1a1a2e}';
  h += '.toc-item.sub{padding-left:20px;font-size:9.5pt;color:var(--gray)}';
  h += '.toc a{text-decoration:none;color:var(--blue)}';

  // Section intro text
  h += '.intro{font-size:10pt;color:var(--gray);margin-bottom:12px;line-height:1.65}';

  // Param grid (for generator details)
  h += '.param-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 16px;font-size:9pt;margin:6px 0 12px}';
  h += '.param-grid .lbl{color:var(--gray)}';
  h += '.param-grid .val{font-weight:600;color:var(--blue-dark);text-align:right}';

  // Footer
  h += '.report-footer{margin-top:40px;font-size:7.5pt;color:var(--gray-light);border-top:1px solid var(--border);padding-top:8px;text-align:center;line-height:1.5}';

  // Impressum
  h += '.impressum{font-size:9pt;color:var(--gray);line-height:1.7;margin-top:30px}';
  h += '.impressum strong{color:var(--blue-dark)}';

  h += '</s' + 'tyle></head><body>';

  // ════════════════════════════════════════════════════════════════
  // DECKBLATT
  // ════════════════════════════════════════════════════════════════
  h += '<div class="deckblatt">';
  h += '<div class="deck-logo">Energetisches Quartierskonzept</div>';
  h += '<div class="deck-title">Transformationsplan</div>';
  h += '<div class="deck-sub">W\u00e4rme- und Stromversorgungskonzept \u00b7 ' + varName + '</div>';
  if (mapImg) {
    h += '<img src="' + mapImg + '" style="max-width:85%;max-height:280px;border:2px solid var(--border);border-radius:8px;margin:20px 0;object-fit:cover;"/>';
    h += fig('Lageplan des Quartiers');
  }
  h += '<div class="deck-info">';
  h += '<strong>Betrachtungsjahr:</strong> ' + (globalYear || '\u2014') + '<br>';
  h += '<strong>Erstellt:</strong> ' + datum + ', ' + zeit + '<br>';
  h += '<strong>Variante:</strong> ' + varName + '<br>';
  h += '<strong>Geb\u00e4ude:</strong> ' + nGeb + ' \u00b7 <strong>Gesamtfl\u00e4che:</strong> ' + fmt(gesamtFlaeche) + ' m\u00b2<br>';
  h += '<strong>W\u00e4rmebedarf:</strong> ' + fmt(totalMwh) + ' MWh/a \u00b7 <strong>Heizlast:</strong> ' + fmt(gesamtHeizlast) + ' kW';
  h += '</div></div>';

  // ════════════════════════════════════════════════════════════════
  // INHALTSVERZEICHNIS
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<h2>Inhaltsverzeichnis</h2>';
  h += '<div class="toc">';
  const tocItems = [
    ['1', 'Quartier\u00fcbersicht und Geb\u00e4udedaten'],
    ['2', 'Erzeugerpark und Anlagenkonzept'],
    ['3', 'Dispatch-Simulation und Lastgang'],
    ['4', 'W\u00e4rmenetz'],
  ];
  if (hatStromNetz) tocItems.push(['5', 'Stromnetz']);
  if (hatStromBilanz) tocItems.push(['6', 'Strombilanz und Eigenversorgung']);
  tocItems.push(['7', 'Wirtschaftlichkeit']);
  tocItems.push(['8', '\u00d6kologie und CO\u2082-Bilanz']);
  if (cImg['sankey-canvas']) tocItems.push(['9', 'Energieflussdiagramm']);
  if (Object.keys(variantResults).length > 1) tocItems.push(['10', 'Variantenvergleich']);
  tocItems.forEach(t => { h += '<div class="toc-item"><span>' + t[0] + '. ' + t[1] + '</span></div>'; });
  h += '</div>';

  // ════════════════════════════════════════════════════════════════
  // 1. QUARTIERSÜBERSICHT
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<h2>1. Quartier\u00fcbersicht und Geb\u00e4udedaten</h2>';
  h += '<div class="intro">Das Planungsgebiet umfasst ' + nGeb + ' Geb\u00e4ude mit einer Gesamtfl\u00e4che von ' +
    fmt(gesamtFlaeche) + ' m\u00b2. Der j\u00e4hrliche W\u00e4rmebedarf betr\u00e4gt ' + fmt(totalMwh) + ' MWh, ' +
    'davon sind ' + nAngeschlossen + ' Geb\u00e4ude an das W\u00e4rmenetz angeschlossen.</div>';

  h += '<div class="kpi-row">';
  h += '<div class="kpi"><div class="kpi-val">' + nGeb + '</div><div class="kpi-label">Geb\u00e4ude</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + fmt(gesamtFlaeche) + '<span class="kpi-unit"> m\u00b2</span></div><div class="kpi-label">Gesamtfl\u00e4che</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + fmt(totalMwh) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">W\u00e4rmebedarf</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + fmt(gesamtHeizlast) + '<span class="kpi-unit"> kW</span></div><div class="kpi-label">Heizlast</div></div>';
  h += '</div>';

  // Gebäudeliste
  h += '<h3>1.1 Geb\u00e4udeliste</h3>';
  h += tab('Geb\u00e4ude im Planungsgebiet');
  h += '<table><thead><tr><th>Nr.</th><th>Geb\u00e4ude</th><th>Nutzung</th><th>Baujahr</th><th class="r">Fl\u00e4che m\u00b2</th><th class="r">W\u00e4rme MWh/a</th><th class="r">kWh/m\u00b2a</th><th class="c">Netz</th></tr></thead><tbody>';
  gebaeude.forEach((g, i) => {
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    const w = st.waerme || g.waerme || 0;
    const fl = g.flaeche || 0;
    const spez = fl > 0 ? (w * 1000 / fl).toFixed(0) : '\u2014';
    h += '<tr><td>' + (i+1) + '</td><td>' + (g.name || 'Geb. ' + g.id) + '</td><td>' + (g.nutzung || '\u2014') +
      '</td><td class="c">' + (g.baujahr || '\u2014') +
      '</td><td class="r">' + (fl > 0 ? fmt(fl) : '\u2014') +
      '</td><td class="r">' + (w > 0 ? fmtD(w, 1) : '\u2014') +
      '</td><td class="r">' + spez +
      '</td><td class="c">' + (connectedIds.has(g.id) ? '\u2713' : '\u2014') + '</td></tr>';
  });
  h += '</tbody></table>';

  // Nutzungsverteilung
  const nutzungen = {};
  gebaeude.forEach(g => {
    const n = g.nutzung || 'Unbekannt';
    if (!nutzungen[n]) nutzungen[n] = { count: 0, fl: 0, w: 0 };
    nutzungen[n].count++;
    nutzungen[n].fl += parseFloat(g.flaeche) || 0;
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    nutzungen[n].w += st.waerme || parseFloat(g.waerme) || 0;
  });
  if (Object.keys(nutzungen).length > 1) {
    h += '<h3>1.2 Nutzungsverteilung</h3>';
    h += tab('Aggregation nach Nutzungstyp');
    h += '<table><thead><tr><th>Nutzung</th><th class="r">Anzahl</th><th class="r">Fl\u00e4che m\u00b2</th><th class="r">W\u00e4rme MWh/a</th><th class="r">Anteil %</th></tr></thead><tbody>';
    Object.keys(nutzungen).sort().forEach(n => {
      const d = nutzungen[n];
      h += '<tr><td>' + n + '</td><td class="r">' + d.count + '</td><td class="r">' + fmt(d.fl) +
        '</td><td class="r">' + fmtD(d.w, 1) + '</td><td class="r">' + (totalMwh > 0 ? fmtD(d.w/totalMwh*100, 1) : '\u2014') + '</td></tr>';
    });
    h += '</tbody></table>';
  }

  // ════════════════════════════════════════════════════════════════
  // 2. ERZEUGERPARK
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<h2>2. Erzeugerpark und Anlagenkonzept</h2>';
  h += '<div class="intro">Das Versorgungskonzept setzt ' + keys.length + ' Erzeuger' + (keys.length !== 1 ? ' ' : '') +
    'ein. Die Gesamtw\u00e4rmeerzeugung betr\u00e4gt ' + fmt(totalMwh) + ' MWh/a' +
    (eeAnteil != null ? ' bei einem EE-Anteil von ' + fmtD(eeAnteil, 1) + ' %' : '') + '.</div>';

  // Merit-Order / Rangfolge
  h += '<h3>2.1 Erzeugermix und Rangfolge</h3>';
  h += tab('Erzeuger\u00fcbersicht');
  h += '<table><thead><tr><th>Rang</th><th>Erzeuger</th><th class="r">Leistung kW</th><th class="r">W\u00e4rme MWh/a</th><th class="r">Strom MWh/a</th><th class="r">Anteil %</th></tr></thead><tbody>';
  keys.forEach((k, i) => {
    const e = en[k] || {};
    const w = e.waermeMwh || 0, el = e.elMwh || 0;
    const cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG[k] : null;
    const kw = cfg?.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0;
    h += '<tr><td class="c">' + (i+1) + '</td><td>' + (DA_L[k]||k) + '</td><td class="r">' + (kw > 0 ? fmt(kw) : '\u2014') +
      '</td><td class="r">' + fmtD(w, 1) + '</td><td class="r">' + (el > 0 ? fmtD(el, 1) : '\u2014') +
      '</td><td class="r">' + (totalMwh > 0 ? fmtD(w/totalMwh*100, 1) : '\u2014') + '</td></tr>';
  });
  h += '</tbody></table>';

  // Erzeuger-Detailblätter
  h += '<h3>2.2 Anlagenparameter</h3>';
  keys.forEach(k => {
    const e = en[k] || {};
    const cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG[k] : null;
    if (!cfg) return;
    const kw = cfg.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0;
    if (kw <= 0) return;
    h += '<h4>' + (DA_L[k] || k) + '</h4>';
    h += '<div class="param-grid">';
    h += '<span class="lbl">Nennleistung:</span><span class="val">' + fmtD(kw, 0) + ' kW</span>';
    h += '<span class="lbl">W\u00e4rmeerzeugung:</span><span class="val">' + fmtD(e.waermeMwh||0, 1) + ' MWh/a</span>';
    if (e.elMwh) { h += '<span class="lbl">Stromerzeugung:</span><span class="val">' + fmtD(e.elMwh, 1) + ' MWh/a</span>'; }
    const vbs = kw > 0 ? ((e.waermeMwh||0) * 1000 / (kw * 8760) * 100) : 0;
    h += '<span class="lbl">Vollbenutzungsstunden:</span><span class="val">' + (kw > 0 ? fmt((e.waermeMwh||0)*1000/kw) + ' h/a' : '\u2014') + '</span>';
    h += '<span class="lbl">Auslastung:</span><span class="val">' + fmtD(vbs, 1) + ' %</span>';
    h += '<span class="lbl">Deckungsanteil:</span><span class="val">' + (totalMwh > 0 ? fmtD((e.waermeMwh||0)/totalMwh*100, 1) + ' %' : '\u2014') + '</span>';
    // Typ-spezifische Parameter
    if (k === 'lwwp' || k === 'fg' || k === 'geo') {
      const jazId = k === 'lwwp' ? 'lwwp-jaz' : k === 'fg' ? 'fg-jaz' : 'geo-jaz';
      const jaz = parseFloat(document.getElementById(jazId)?.value) || 0;
      if (jaz > 0) h += '<span class="lbl">JAZ:</span><span class="val">' + fmtD(jaz, 1) + '</span>';
    }
    if (k === 'gaskessel' || k === 'gk') {
      const eta = document.getElementById('gk-eta')?.value;
      if (eta) h += '<span class="lbl">Wirkungsgrad:</span><span class="val">' + eta + ' %</span>';
    }
    if (k === 'bhkw') {
      const skz = document.getElementById('bhkw-skz')?.value;
      const eta = document.getElementById('bhkw-eta')?.value;
      if (skz) h += '<span class="lbl">Stromkennzahl:</span><span class="val">' + skz + '</span>';
      if (eta) h += '<span class="lbl">Gesamtwirkungsgrad:</span><span class="val">' + eta + ' %</span>';
    }
    h += '</div>';
  });

  // Heizkurve
  const vl5 = parseFloat(document.getElementById('gl-vl5')?.value);
  const vl15 = parseFloat(document.getElementById('gl-vl15')?.value);
  if (vl5 && vl15) {
    h += '<h3>2.3 Heizkurve</h3>';
    h += '<div class="param-grid">';
    h += '<span class="lbl">Vorlauf bei -5 \u00b0C:</span><span class="val">' + fmtD(vl5, 0) + ' \u00b0C</span>';
    h += '<span class="lbl">Vorlauf bei +15 \u00b0C:</span><span class="val">' + fmtD(vl15, 0) + ' \u00b0C</span>';
    h += '<span class="lbl">Netzvorlauf:</span><span class="val">' + fmtD(vlTemp, 0) + ' \u00b0C</span>';
    h += '<span class="lbl">Netzr\u00fccklauf:</span><span class="val">' + fmtD(rlTemp, 0) + ' \u00b0C</span>';
    h += '</div>';
    if (cImg['gl-split-canvas']) {
      h += '<img class="chart-img" src="' + cImg['gl-split-canvas'] + '"/>';
      h += fig('Heizkurve und Lastaufteilung');
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 3. DISPATCH-SIMULATION
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<h2>3. Dispatch-Simulation und Lastgang</h2>';
  h += '<div class="intro">Die st\u00fcndliche Einsatzsimulation (Dispatch) ordnet die Erzeuger nach der Merit-Order zu ' +
    'und berechnet den 8.760-h-Betrieb. Die folgenden Diagramme zeigen den gestapelten W\u00e4rmelastgang, ' +
    'die Jahresdauerlinie und die Auslegungswoche.</div>';

  // KPI-Leiste
  h += '<div class="kpi-row">';
  h += '<div class="kpi"><div class="kpi-val">' + fmt(totalMwh) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">Erzeugung</div></div>';
  if (eeAnteil != null) h += '<div class="kpi' + (eeAnteil >= 65 ? '' : ' accent') + '"><div class="kpi-val">' + fmtD(eeAnteil, 1) + '<span class="kpi-unit"> %</span></div><div class="kpi-label">EE-Anteil</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + wgkVal + '<span class="kpi-unit"> ct/kWh</span></div><div class="kpi-label">WGK</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + co2Gesamt + '</div><div class="kpi-label">CO\u2082</div></div>';
  h += '</div>';

  // Dispatch Lastgang
  if (cImg['da-canvas'] || cImg['av-lastgang-canvas']) {
    h += '<h3>3.1 Gestapelter W\u00e4rmelastgang (8.760 h)</h3>';
    const lgImg = cImg['da-canvas'] || cImg['av-lastgang-canvas'];
    h += '<img class="chart-img" src="' + lgImg + '"/>';
    h += fig('Gestapelter W\u00e4rmelastgang aller Erzeuger');
  }

  // Jahresdauerlinie
  if (cImg['da-canvas-jdl'] || cImg['av-jdl-canvas']) {
    h += '<h3>3.2 Jahresdauerlinie</h3>';
    const jdlImg = cImg['da-canvas-jdl'] || cImg['av-jdl-canvas'];
    h += '<img class="chart-img" src="' + jdlImg + '"/>';
    h += fig('Geordnete Jahresdauerlinie der W\u00e4rmeerzeugung');
  }

  // Auslegungswoche
  if (cImg['da-canvas-woche']) {
    h += '<h3>3.3 Auslegungswoche (k\u00e4lteste Woche)</h3>';
    h += '<img class="chart-img" src="' + cImg['da-canvas-woche'] + '"/>';
    h += fig('Lastprofil der Auslegungswoche (168 h)');
  }

  // Monatsübersicht
  if (cImg['ep-monthly-canvas']) {
    h += '<h3>3.4 Monatliche Erzeugung</h3>';
    h += '<img class="chart-img" src="' + cImg['ep-monthly-canvas'] + '"/>';
    h += fig('Monatliche W\u00e4rmeerzeugung nach Erzeuger');
  }

  // ════════════════════════════════════════════════════════════════
  // 4. WÄRMENETZ
  // ════════════════════════════════════════════════════════════════
  if (activeNetz.length > 0) {
    h += '<div class="page-break"></div>';
    h += '<h2>4. W\u00e4rmenetz</h2>';
    h += '<div class="intro">Das W\u00e4rmenetz verbindet ' + nAngeschlossen + ' von ' + nGeb + ' Geb\u00e4uden \u00fcber eine ' +
      'Trassenl\u00e4nge von ' + fmt(trasseLaenge) + ' m. Die Netztemperaturen betragen ' + fmtD(vlTemp,0) + '/' + fmtD(rlTemp,0) + ' \u00b0C (VL/RL).</div>';

    h += '<div class="kpi-row">';
    h += '<div class="kpi"><div class="kpi-val">' + fmt(trasseLaenge) + '<span class="kpi-unit"> m</span></div><div class="kpi-label">Trassenl\u00e4nge</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + fmtD(totalLossMwh, 1) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">Netzverluste</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + fmtD(verlustPct, 1) + '<span class="kpi-unit"> %</span></div><div class="kpi-label">Verlustanteil</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + nAngeschlossen + '/' + nGeb + '</div><div class="kpi-label">Anschlussgrad</div></div>';
    h += '</div>';

    h += '<div class="param-grid">';
    h += '<span class="lbl">Vorlauftemperatur:</span><span class="val">' + fmtD(vlTemp, 0) + ' \u00b0C</span>';
    h += '<span class="lbl">R\u00fccklauftemperatur:</span><span class="val">' + fmtD(rlTemp, 0) + ' \u00b0C</span>';
    const vFlow = parseFloat(document.getElementById('netz-v')?.value) || 0;
    if (vFlow > 0) h += '<span class="lbl">Flie\u00dfgeschwindigkeit:</span><span class="val">' + fmtD(vFlow, 1) + ' m/s</span>';
    h += '</div>';

    // Rohrleitungsquerschnitte
    const dnCounts = {};
    activeNetz.forEach(e => { const dn = e.dn || '?'; dnCounts[dn] = (dnCounts[dn]||0) + (e.length||0); });
    h += '<h3>4.1 Rohrleitungsquerschnitte</h3>';
    h += tab('Leitungsl\u00e4ngen nach Nennweite');
    h += '<table><thead><tr><th>Nennweite</th><th class="r">L\u00e4nge m</th><th class="r">Anteil %</th></tr></thead><tbody>';
    Object.keys(dnCounts).sort((a,b) => parseFloat(a)-parseFloat(b)).forEach(dn => {
      h += '<tr><td>DN ' + dn + '</td><td class="r">' + fmt(dnCounts[dn]) + '</td><td class="r">' + fmtD(dnCounts[dn]/trasseLaenge*100, 1) + '</td></tr>';
    });
    h += '</tbody></table>';
  }

  // ════════════════════════════════════════════════════════════════
  // 5. STROMNETZ
  // ════════════════════════════════════════════════════════════════
  if (hatStromNetz) {
    h += '<div class="page-break"></div>';
    h += '<h2>5. Stromnetz</h2>';
    const trafos = stromNodes.filter(n => n.type === 'trafo');
    const nAnschluss = stromNodes.filter(n => n.type === 'geb').length;
    h += '<div class="intro">Das elektrische Verteilnetz umfasst ' + fmt(stromTrasseLaenge) + ' m Kabell\u00e4nge mit ' +
      trafos.length + ' Trafostation' + (trafos.length !== 1 ? 'en' : '') + ' und ' + nAnschluss + ' Geb\u00e4udeanschl\u00fcssen.</div>';

    h += '<div class="kpi-row">';
    h += '<div class="kpi"><div class="kpi-val">' + fmt(stromTrasseLaenge) + '<span class="kpi-unit"> m</span></div><div class="kpi-label">Kabell\u00e4nge</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + trafos.length + '</div><div class="kpi-label">Trafostationen</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + fmtD(stromKpis.maxDeltaU||0, 1) + '<span class="kpi-unit"> %</span></div><div class="kpi-label">Max. \u0394U</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + nAnschluss + '</div><div class="kpi-label">Anschl\u00fcsse</div></div>';
    h += '</div>';

    // Kabelquerschnitte
    if (stromEdges.length > 0) {
      const mmCounts = {};
      stromEdges.forEach(e => { const mm = (e.crossSection || '?') + ' mm\u00b2'; mmCounts[mm] = (mmCounts[mm]||0) + (e.lengthM||0); });
      h += '<h3>5.1 Kabelquerschnitte</h3>';
      h += tab('Kabell\u00e4ngen nach Querschnitt');
      h += '<table><thead><tr><th>Querschnitt</th><th class="r">L\u00e4nge m</th><th class="r">Anteil %</th></tr></thead><tbody>';
      Object.keys(mmCounts).sort().forEach(mm => {
        h += '<tr><td>' + mm + '</td><td class="r">' + fmt(mmCounts[mm]) + '</td><td class="r">' + (stromTrasseLaenge > 0 ? fmtD(mmCounts[mm]/stromTrasseLaenge*100, 1) : '\u2014') + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    // Trafostationen
    if (trafos.length > 0) {
      h += '<h3>5.2 Trafostationen</h3>';
      h += tab('Trafostationen im Netzgebiet');
      h += '<table><thead><tr><th>Trafo</th><th class="r">Nennleistung kVA</th><th class="r">Last kW</th><th class="r">Auslastung %</th></tr></thead><tbody>';
      trafos.forEach(t => {
        const ausl = t.ratedKva > 0 && t.peakLoadKw ? (t.peakLoadKw / t.ratedKva * 100) : 0;
        h += '<tr><td>' + (t.label || 'Trafo ' + t.id) + '</td><td class="r">' + (t.ratedKva || '\u2014') +
          '</td><td class="r">' + (t.peakLoadKw ? fmtD(t.peakLoadKw, 1) : '\u2014') +
          '</td><td class="r">' + (ausl > 0 ? fmtD(ausl, 1) : '\u2014') + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    // Stromnetz-Kosten
    const snKosten = window._stromNetzKosten || {};
    if (snKosten.investGes > 0) {
      h += '<h3>5.3 Stromnetz-Kosten</h3>';
      h += '<div class="param-grid">';
      h += '<span class="lbl">Kabel-Invest:</span><span class="val">' + fmt(snKosten.kabelInvest||0) + ' \u20ac</span>';
      h += '<span class="lbl">Tiefbau:</span><span class="val">' + fmt(snKosten.tiefbau||0) + ' \u20ac</span>';
      h += '<span class="lbl">Trafo-Invest:</span><span class="val">' + fmt(snKosten.trafoInvest||0) + ' \u20ac</span>';
      h += '<span class="lbl">NAP-Pauschale:</span><span class="val">' + fmt(snKosten.napInvest||0) + ' \u20ac</span>';
      h += '<span class="lbl"><strong>Invest Gesamt:</strong></span><span class="val"><strong>' + fmt(snKosten.investGes) + ' \u20ac</strong></span>';
      if (snKosten.annuitaet) h += '<span class="lbl">Annuit\u00e4t:</span><span class="val">' + fmt(snKosten.annuitaet) + ' \u20ac/a</span>';
      h += '</div>';
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 6. STROMBILANZ
  // ════════════════════════════════════════════════════════════════
  if (hatStromBilanz) {
    h += '<div class="page-break"></div>';
    h += '<h2>6. Strombilanz und Eigenversorgung</h2>';

    h += '<div class="kpi-row">';
    if (sd.pvMwh > 0) h += '<div class="kpi"><div class="kpi-val">' + fmt(sd.pvMwh) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">PV-Erzeugung</div></div>';
    if (sd.bhkwStromMwh > 0) h += '<div class="kpi"><div class="kpi-val">' + fmt(sd.bhkwStromMwh) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">BHKW-Strom</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + fmt(sd.eigenverbrauchMwh||0) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">Eigenverbrauch</div></div>';
    h += '<div class="kpi"><div class="kpi-val">' + fmt(sd.netzbezugMwh||0) + '<span class="kpi-unit"> MWh/a</span></div><div class="kpi-label">Netzbezug</div></div>';
    h += '</div>';

    if (sd.pvEigenMwh || sd.bhkwEigenMwh) {
      h += '<h3>Aufschl\u00fcsselung Eigenverbrauch / Einspeisung</h3>';
      h += tab('Eigenverbrauch und Einspeisung');
      h += '<table><thead><tr><th>Quelle</th><th class="r">Erzeugung MWh/a</th><th class="r">Eigenverbrauch MWh/a</th><th class="r">Einspeisung MWh/a</th><th class="r">Eigenverbrauchsquote %</th></tr></thead><tbody>';
      if (sd.pvMwh > 0) {
        const evq = sd.pvMwh > 0 ? ((sd.pvEigenMwh||0)/sd.pvMwh*100) : 0;
        h += '<tr><td>Photovoltaik</td><td class="r">' + fmtD(sd.pvMwh, 1) + '</td><td class="r">' + fmtD(sd.pvEigenMwh||0, 1) + '</td><td class="r">' + fmtD(sd.pvEinspMwh||0, 1) + '</td><td class="r">' + fmtD(evq, 1) + '</td></tr>';
      }
      if (sd.bhkwStromMwh > 0) {
        const evq = sd.bhkwStromMwh > 0 ? ((sd.bhkwEigenMwh||0)/sd.bhkwStromMwh*100) : 0;
        h += '<tr><td>BHKW/KWK</td><td class="r">' + fmtD(sd.bhkwStromMwh, 1) + '</td><td class="r">' + fmtD(sd.bhkwEigenMwh||0, 1) + '</td><td class="r">' + fmtD(sd.bhkwEinspMwh||0, 1) + '</td><td class="r">' + fmtD(evq, 1) + '</td></tr>';
      }
      h += '</tbody></table>';
    }

    // Strom-Charts
    if (cImg['strom-monats-canvas']) {
      h += '<h3>Monatliche Strombilanz</h3>';
      h += '<img class="chart-img" src="' + cImg['strom-monats-canvas'] + '"/>';
      h += fig('Monatliche Stromerzeugung und -verbrauch');
    }
    if (cImg['strom-jdl-canvas']) {
      h += '<img class="chart-img" src="' + cImg['strom-jdl-canvas'] + '"/>';
      h += fig('Strom-Jahresdauerlinie');
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 7. WIRTSCHAFTLICHKEIT
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<h2>7. Wirtschaftlichkeit</h2>';
  h += '<div class="intro">Die Wirtschaftlichkeitsberechnung erfolgt nach VDI 2067 (Annuit\u00e4tenmethode). ' +
    'Dargestellt sind die kapitalgebundenen, bedarfsgebundenen und betriebsgebundenen Kosten sowie die resultierenden W\u00e4rmegestehungskosten (WGK).</div>';

  h += '<div class="kpi-row">';
  h += '<div class="kpi accent"><div class="kpi-val">' + wgkVal + '<span class="kpi-unit"> ct/kWh</span></div><div class="kpi-label">W\u00e4rmegestehungskosten</div></div>';
  if (investGes > 0) h += '<div class="kpi"><div class="kpi-val">' + fmt(investGes) + '<span class="kpi-unit"> \u20ac</span></div><div class="kpi-label">Investition gesamt</div></div>';
  if (jkGes > 0) h += '<div class="kpi"><div class="kpi-val">' + fmt(jkGes) + '<span class="kpi-unit"> \u20ac/a</span></div><div class="kpi-label">Jahreskosten</div></div>';
  h += '</div>';

  if (wirtHtml) {
    h += '<h3>7.1 Kostenaufstellung nach VDI 2067</h3>';
    h += '<div style="font-size:9pt;">' + wirtHtml + '</div>';
  }

  // ════════════════════════════════════════════════════════════════
  // 8. ÖKOLOGIE / CO₂
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<h2>8. \u00d6kologie und CO\u2082-Bilanz</h2>';
  const co2BiEl = document.getElementById('co2-bilanz-wrap');
  if (co2BiEl) {
    h += '<div style="font-size:10pt;">' + co2BiEl.innerHTML + '</div>';
  } else {
    h += '<div class="intro">CO\u2082-Emissionen gesamt: ' + co2Gesamt + '</div>';
  }

  // Emissionsdiagramme
  if (cImg['em-stunden-canvas']) {
    h += '<h3>8.1 St\u00fcndliche Emissionen</h3>';
    h += '<img class="chart-img" src="' + cImg['em-stunden-canvas'] + '"/>';
    h += fig('St\u00fcndliche CO\u2082-Emissionen');
  }
  if (cImg['em-monat-canvas']) {
    h += '<h3>8.2 Monatliche Emissionen</h3>';
    h += '<img class="chart-img" src="' + cImg['em-monat-canvas'] + '"/>';
    h += fig('Monatliche CO\u2082-Emissionen nach Erzeuger');
  }

  // ════════════════════════════════════════════════════════════════
  // 9. SANKEY
  // ════════════════════════════════════════════════════════════════
  if (cImg['sankey-canvas']) {
    h += '<div class="page-break"></div>';
    h += '<h2>9. Energieflussdiagramm</h2>';
    h += '<div class="intro">Das Sankey-Diagramm zeigt die Energiefl\u00fcsse von der Erzeugung \u00fcber die Verteilung bis zum Verbrauch.</div>';
    h += '<img class="chart-img" src="' + cImg['sankey-canvas'] + '" style="max-height:400px;"/>';
    h += fig('Sankey-Diagramm der Energiefl\u00fcsse');
  }

  // ════════════════════════════════════════════════════════════════
  // 10. VARIANTENVERGLEICH
  // ════════════════════════════════════════════════════════════════
  const vrKeys = Object.keys(variantResults);
  if (vrKeys.length > 1) {
    h += '<div class="page-break"></div>';
    h += '<h2>10. Variantenvergleich</h2>';
    h += '<div class="intro">Es wurden ' + vrKeys.length + ' Varianten untersucht. Die folgende Tabelle zeigt die wesentlichen Kennwerte im Vergleich.</div>';

    h += tab('Variantenvergleich \u2014 Kennwerte');
    h += '<table><thead><tr><th>Kennwert</th>';
    vrKeys.forEach(k => { h += '<th class="r">' + (variantResults[k].label || k) + '</th>'; });
    h += '</tr></thead><tbody>';

    const rows = [
      ['Geb\u00e4udebedarf MWh/a', k => fmtD(variantResults[k].geb\u00e4udebedarf||0, 0)],
      ['Erzeugung MWh/a', k => fmtD(variantResults[k].erzeugung||0, 0)],
      ['Netzverluste MWh/a', k => fmtD(variantResults[k].netzverluste||0, 1)],
      ['Netzverluste %', k => fmtD(variantResults[k].netzverlustePct||0, 1)],
      ['VL/RL \u00b0C', k => fmtD(variantResults[k].vlTemp||0, 0) + '/' + fmtD(variantResults[k].rlTemp||0, 0)],
      ['EE-Anteil %', k => variantResults[k].eeAnteil != null ? fmtD(variantResults[k].eeAnteil, 1) : '\u2014'],
      ['WGK', k => variantResults[k].wgkText || '\u2014'],
      ['Investition \u20ac', k => variantResults[k].investGes ? fmt(variantResults[k].investGes) : '\u2014'],
      ['Jahreskosten \u20ac/a', k => variantResults[k].jkGes ? fmt(variantResults[k].jkGes) : '\u2014'],
      ['CO\u2082 t/a', k => variantResults[k].co2GesH > 0 ? fmtD(variantResults[k].co2GesH, 1) : '\u2014'],
    ];
    rows.forEach(r => {
      h += '<tr><td>' + r[0] + '</td>';
      vrKeys.forEach(k => { h += '<td class="r">' + r[1](k) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table>';

    // Erzeuger pro Variante
    h += '<h3>Erzeugerpark je Variante</h3>';
    vrKeys.forEach(k => {
      const v = variantResults[k];
      if (!v.erzeuger || v.erzeuger.length === 0) return;
      h += '<h4>' + (v.label || k) + '</h4>';
      h += '<table><thead><tr><th>Erzeuger</th><th class="r">Leistung kW</th><th class="r">CO\u2082</th></tr></thead><tbody>';
      v.erzeuger.forEach(e => {
        h += '<tr><td>' + e.typ + '</td><td class="r">' + (e.leistungKw ? fmt(e.leistungKw) : '\u2014') + '</td><td class="r">' + (e.co2 || '\u2014') + '</td></tr>';
      });
      h += '</tbody></table>';
    });
  }

  // ════════════════════════════════════════════════════════════════
  // IMPRESSUM & FOOTER
  // ════════════════════════════════════════════════════════════════
  h += '<div class="page-break"></div>';
  h += '<div class="impressum">';
  h += '<h2 style="border-bottom-color:var(--gray-light);">Impressum</h2>';
  h += '<p>Dieser Bericht wurde automatisch generiert mit dem <strong>Energieplanungs-Tool</strong>.</p>';
  h += '<p><strong>Betrachtungsjahr:</strong> ' + (globalYear || '\u2014') + '<br>';
  h += '<strong>Variante:</strong> ' + varName + '<br>';
  h += '<strong>Erstellt am:</strong> ' + datum + ', ' + zeit + '</p>';
  h += '<p style="font-size:8pt;color:var(--gray-light);margin-top:20px;">';
  h += 'Alle Angaben basieren auf den zum Zeitpunkt der Erstellung im Tool hinterlegten Eingabedaten. ';
  h += 'Die Ergebnisse dienen der Orientierung und ersetzen keine detaillierte Fachplanung.</p>';
  h += '</div>';

  h += '<div class="report-footer">';
  h += 'Energieplanungs-Tool \u00b7 Transformationsplan \u00b7 ' + varName + ' \u00b7 ' + datum;
  h += '</div>';

  // Abbildungs- und Tabellenverzeichnis als Metadaten
  h += '<div class="report-footer" style="margin-top:8px;">';
  h += figNr + ' Abbildung' + (figNr !== 1 ? 'en' : '') + ' \u00b7 ' + tabNr + ' Tabelle' + (tabNr !== 1 ? 'n' : '');
  h += '</div>';

  h += '</body></html>';

  // ── Ausgabe ───────────────────────────────────────────────────
  var printWin = window.open('', '_blank');
  if (!printWin) { alert('Pop-up blockiert \u2014 bitte Pop-ups f\u00fcr diese Seite erlauben.'); return; }
  printWin.document.write(h);
  printWin.document.close();
  setTimeout(function() { printWin.print(); }, 800);
}

// ── Export: Maßnahmenbericht PDF ──────────────────────────────────────────
export function exportMassnahmenPDF() {
  const yr = globalYear ?? new Date().getFullYear();
  const allAssets = ASSETS.items || [];
  const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  const fmt2 = v => Number(v).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const ASSET_LABELS = {
    NAP: 'Netzanschlusspunkt', Trafo: 'Transformator', Schaltanlage: 'Schaltanlage',
    NSHV: 'Niederspannungshauptverteilung', UV: 'Unterverteilung',
    Verbraucher: 'Verbraucher', WP: 'Wärmepumpe', PV: 'PV-Anlage',
    Batterie: 'Batteriespeicher', Lade: 'Ladeinfrastruktur', Nsa: 'Nsa',
    KWK: 'KWK-Anlage', Wind: 'Windkraftanlage',
  };

  const MASSN_STATUS_LABEL = { geplant: 'Geplant', beauftragt: 'Beauftragt', umgesetzt: 'Umgesetzt' };

  // Groupierung Maßnahmen nach Jahr
  const byYear = {};
  let grandTotal = 0;
  allAssets.forEach(a => {
    (a.massnahmen || []).forEach(m => {
      const j = m.jahr || 'Ohne Jahr';
      if (!byYear[j]) byYear[j] = [];
      byYear[j].push({ asset: a, m });
      grandTotal += parseFloat(m.kosten) || 0;
    });
  });

  let h = '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">';
  h += '<title>Maßnahmenbericht — ' + datum + '</title>';
  h += '<style>';
  h += '@page{margin:18mm 16mm;size:A4}';
  h += '@media print{.no-print{display:none}}';
  h += 'body{font-family:"Segoe UI",system-ui,Arial,sans-serif;font-size:10pt;color:#1a1a2e;line-height:1.5;max-width:720px;margin:0 auto;padding:10mm 0}';
  h += 'h1{font-size:18pt;color:#0055a0;margin:0 0 4px}';
  h += '.subtitle{font-size:10pt;color:#546e7a;margin:0 0 20px}';
  h += 'h2{font-size:13pt;color:#0055a0;border-bottom:2px solid #0055a0;padding-bottom:3px;margin:24px 0 12px}';
  h += 'h3{font-size:11pt;color:#263238;margin:16px 0 6px}';
  h += 'table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:9pt}';
  h += 'th{background:#0055a0;color:#fff;padding:5px 8px;text-align:left;font-weight:600}';
  h += 'td{padding:4px 8px;border-bottom:1px solid #e0e0e0;vertical-align:top}';
  h += 'tr:nth-child(even) td{background:#f5f8fc}';
  h += '.r{text-align:right}';
  h += '.status-geplant{color:#1565c0;font-weight:500}';
  h += '.status-beauftragt{color:#e65100;font-weight:500}';
  h += '.status-umgesetzt{color:#2e7d32;font-weight:500}';
  h += '.kpi-row{display:flex;gap:16px;margin:16px 0}';
  h += '.kpi{background:#f5f8fc;border:1px solid #d5dde5;border-radius:6px;padding:10px 16px;flex:1;text-align:center}';
  h += '.kpi-val{font-size:18pt;font-weight:700;color:#0055a0}';
  h += '.kpi-label{font-size:8pt;color:#546e7a;margin-top:2px}';
  h += '.year-header{background:#e8f0fa;font-weight:700;color:#0055a0;font-size:10pt}';
  h += '.year-total{background:#fff3e0;font-weight:700}';
  h += '.grand-total{background:#0055a0;color:#fff;font-weight:700}';
  h += '.no-massn{color:#9e9e9e;font-style:italic;padding:6px 8px}';
  h += '.asset-spec{font-size:8pt;color:#546e7a}';
  h += '</style></head><body>';

  h += '<h1>Maßnahmenbericht Elektro</h1>';
  h += '<div class="subtitle">Stand: ' + datum + '  ·  Planungsjahr: ' + yr + '</div>';

  // KPI-Zeile
  const assetsWithMassn = allAssets.filter(a => (a.massnahmen || []).length > 0);
  const allMassn = allAssets.flatMap(a => a.massnahmen || []);
  h += '<div class="kpi-row">';
  h += '<div class="kpi"><div class="kpi-val">' + allAssets.length + '</div><div class="kpi-label">Assets gesamt</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + assetsWithMassn.length + '</div><div class="kpi-label">Assets mit Maßnahmen</div></div>';
  h += '<div class="kpi"><div class="kpi-val">' + allMassn.length + '</div><div class="kpi-label">Maßnahmen gesamt</div></div>';
  h += '<div class="kpi"><div class="kpi-val" style="font-size:13pt">' + fmt2(grandTotal) + ' €</div><div class="kpi-label">Gesamtkosten</div></div>';
  h += '</div>';

  // 1. Komponentenliste
  h += '<h2>1. Komponentenliste</h2>';
  h += '<table><thead><tr><th>Name</th><th>Typ</th><th>Baujahr</th><th>Status ' + yr + '</th><th class="r">Maßnahmen</th></tr></thead><tbody>';
  for (const a of allAssets) {
    const status = getAssetStatus(a, yr);
    const statusTxt = status === 'active' ? 'Aktiv' : status === 'planned' ? 'Geplant' : 'Abgerissen';
    const statusCol = status === 'active' ? '#2e7d32' : status === 'planned' ? '#1565c0' : '#9e9e9e';
    const specParts = [];
    const p = a.props || {};
    if (a.type === 'Trafo') specParts.push((p.leistungKVA || 630) + ' kVA');
    if (a.type === 'Verbraucher' || a.type === 'WP') specParts.push((p.leistungKW || 10) + ' kW');
    if (a.type === 'PV') specParts.push((p.leistungKWp || 10) + ' kWp');
    if (a.type === 'Lade') specParts.push((p.anzahlPunkte || 4) + '×' + (p.leistungProPunktKW || 22) + ' kW');
    if (a.type === 'NSHV' || a.type === 'UV') specParts.push((p.nennstromA || 400) + ' A');
    const specStr = specParts.length ? ' <span class="asset-spec">(' + specParts.join(', ') + ')</span>' : '';
    h += '<tr><td>' + (a.name || a.id) + '</td><td>' + (ASSET_LABELS[a.type] || a.type) + specStr + '</td>';
    h += '<td>' + (a.baujahr || '—') + '</td>';
    h += '<td style="color:' + statusCol + '">' + statusTxt + '</td>';
    h += '<td class="r">' + (a.massnahmen?.length || 0) + '</td></tr>';
  }
  h += '</tbody></table>';

  // 2. Maßnahmen nach Asset
  h += '<h2>2. Maßnahmen je Asset</h2>';
  const assetsWithAny = allAssets.filter(a => (a.massnahmen || []).length > 0);
  if (assetsWithAny.length === 0) {
    h += '<p class="no-massn">Keine Maßnahmen erfasst.</p>';
  } else {
    for (const a of assetsWithAny) {
      h += '<h3>' + (a.name || a.id) + ' <span style="font-size:9pt;color:#546e7a;font-weight:400">— ' + (ASSET_LABELS[a.type] || a.type) + '</span></h3>';
      h += '<table><thead><tr><th>Titel</th><th>Beschreibung</th><th>Jahr</th><th>Status</th><th class="r">Kosten €</th></tr></thead><tbody>';
      for (const m of a.massnahmen) {
        const sc = 'status-' + (m.status || 'geplant');
        h += '<tr><td>' + (m.titel || '—') + '</td><td>' + (m.beschreibung || '') + '</td>';
        h += '<td>' + (m.jahr || '—') + '</td>';
        h += '<td class="' + sc + '">' + (MASSN_STATUS_LABEL[m.status] || m.status || 'Geplant') + '</td>';
        h += '<td class="r">' + (m.kosten ? fmt2(m.kosten) : '—') + '</td></tr>';
      }
      h += '</tbody></table>';
    }
  }

  // 3. Investitionsplan nach Jahr
  h += '<h2>3. Investitionsplan</h2>';
  const sortedYears = Object.keys(byYear).sort((a, b) => {
    if (a === 'Ohne Jahr') return 1;
    if (b === 'Ohne Jahr') return -1;
    return parseInt(a) - parseInt(b);
  });
  if (sortedYears.length === 0) {
    h += '<p class="no-massn">Keine Maßnahmen für den Investitionsplan vorhanden.</p>';
  } else {
    h += '<table><thead><tr><th>Jahr</th><th>Asset</th><th>Maßnahme</th><th>Status</th><th class="r">Kosten €</th></tr></thead><tbody>';
    for (const yr2 of sortedYears) {
      let yearSum = 0;
      const rows = byYear[yr2];
      h += '<tr class="year-header"><td colspan="5">' + yr2 + '</td></tr>';
      for (const { asset, m } of rows) {
        yearSum += parseFloat(m.kosten) || 0;
        const sc = 'status-' + (m.status || 'geplant');
        h += '<tr><td></td><td>' + (asset.name || asset.id) + '</td><td>' + (m.titel || '—') + '</td>';
        h += '<td class="' + sc + '">' + (MASSN_STATUS_LABEL[m.status] || 'Geplant') + '</td>';
        h += '<td class="r">' + (m.kosten ? fmt2(m.kosten) : '—') + '</td></tr>';
      }
      h += '<tr class="year-total"><td></td><td colspan="3">Summe ' + yr2 + '</td><td class="r">' + fmt2(yearSum) + ' €</td></tr>';
    }
    h += '<tr class="grand-total"><td colspan="4">Gesamtinvestition</td><td class="r">' + fmt2(grandTotal) + ' €</td></tr>';
    h += '</tbody></table>';
  }

  h += '</body></html>';

  const printWin = window.open('', '_blank');
  if (!printWin) { alert('Pop-up blockiert — bitte Pop-ups für diese Seite erlauben.'); return; }
  printWin.document.write(h);
  printWin.document.close();
  setTimeout(() => printWin.print(), 800);
}

// ── Export: Elektro XLSX (Komponenten + Kabel) ──────────────────────────────
export async function exportElektroXLSX() {
  // SheetJS dynamisch laden falls noch nicht vorhanden
  if (typeof window.XLSX === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('SheetJS konnte nicht geladen werden.'));
      document.head.appendChild(s);
    }).catch(e => { alert(e.message); throw e; });
  }
  const XLSXLib = window.XLSX;
  const yr = globalYear ?? new Date().getFullYear();
  const allAssets = ASSETS.items || [];
  const allEdges = window.stromEdges || [];

  const ASSET_LABELS = {
    NAP: 'Netzanschlusspunkt', Trafo: 'Transformator', Schaltanlage: 'Schaltanlage',
    NSHV: 'NSHV', UV: 'Unterverteilung', Verbraucher: 'Verbraucher',
    WP: 'Wärmepumpe', PV: 'PV-Anlage', Batterie: 'Batteriespeicher',
    Lade: 'Ladeinfrastruktur', Nsa: 'Nsa', KWK: 'KWK-Anlage', Wind: 'Windkraftanlage',
  };

  // Sheet 1: Komponenten
  const kompRows = [['Name', 'Typ', 'Baujahr', 'Abrissjahr', 'Status ' + yr, 'Leistung kW/kVA', 'Maßnahmen (Anzahl)', 'Investition (€)']];
  for (const a of allAssets) {
    const p = a.props || {};
    const status = getAssetStatus(a, yr);
    const statusTxt = status === 'active' ? 'Aktiv' : status === 'planned' ? 'Geplant' : 'Abgerissen';
    let leistung = '';
    if (a.type === 'Trafo') leistung = (p.leistungKVA || 630) + ' kVA';
    else if (a.type === 'Verbraucher' || a.type === 'WP' || a.type === 'Nsa' || a.type === 'KWK' || a.type === 'Wind') leistung = (p.leistungKW || p.leistungElKW || 0) + ' kW';
    else if (a.type === 'PV') leistung = (p.leistungKWp || 0) + ' kWp';
    else if (a.type === 'Lade') leistung = ((p.anzahlPunkte || 4) * (p.leistungProPunktKW || 22)) + ' kW';
    else if (a.type === 'NSHV' || a.type === 'UV') leistung = (p.nennstromA || 400) + ' A';
    const totalKosten = (a.massnahmen || []).reduce((s, m) => s + (parseFloat(m.kosten) || 0), 0);
    kompRows.push([a.name || a.id, ASSET_LABELS[a.type] || a.type, a.baujahr || '', a.abrissjahr || '', statusTxt, leistung, (a.massnahmen || []).length, totalKosten || '']);
  }

  // Sheet 2: Kabel
  const kabelRows = [['Von', 'Nach', 'Typ', 'Querschnitt mm²', 'Länge m', 'Parallelkabel', 'Sicherung A', 'Strom A', 'Auslastung %', 'Spannungsfall %', 'Fluss kW']];
  const assetMap = new Map(allAssets.map(a => [a.id, a]));
  for (const e of allEdges) {
    const uName = assetMap.get(e.u)?.name || e.u;
    const vName = assetMap.get(e.v)?.name || e.v;
    kabelRows.push([
      uName, vName, e.cableType || 'NAYY',
      e.crossSection || '', Math.round(e.lengthM || 0),
      e.nParallel || 1, e.fuseA || '',
      e.peakCurrentA != null ? +e.peakCurrentA.toFixed(1) : '',
      e.auslastungPct != null ? +e.auslastungPct.toFixed(1) : '',
      e.deltaUPct != null ? +e.deltaUPct.toFixed(2) : '',
      e.peakFlowKw != null ? +e.peakFlowKw.toFixed(1) : '',
    ]);
  }

  // Sheet 3: Maßnahmen
  const massnRows = [['Asset', 'Typ', 'Titel', 'Beschreibung', 'Jahr', 'Status', 'Kosten €']];
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      massnRows.push([a.name || a.id, ASSET_LABELS[a.type] || a.type, m.titel || '', m.beschreibung || '', m.jahr || '', m.status || 'geplant', parseFloat(m.kosten) || 0]);
    }
  }

  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(kompRows), 'Komponenten');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(kabelRows), 'Kabel');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(massnRows), 'Maßnahmen');

  const fname = 'Elektroplanung_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSXLib.writeFile(wb, fname);
}

// ── Export: Vollständiger XLSX (Gebäude + Assets + Kabel + Maßnahmen + Beziehungen) ──
export async function exportVollstaendigXLSX() {
  if (typeof window.XLSX === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('SheetJS konnte nicht geladen werden.'));
      document.head.appendChild(s);
    }).catch(e => { alert(e.message); throw e; });
  }
  const XLSXLib = window.XLSX;
  const yr = globalYear ?? new Date().getFullYear();
  const allGebaeude = window.gebaeude || [];
  const allAssets = ASSETS.items || [];
  const allEdges = window.stromEdges || [];

  const gebMap = new Map(allGebaeude.map(g => [g.id, g]));

  // Sheet 1: Gebäude
  const gebRows = [['ID', 'Name', 'Nutzung', 'Fläche (m²)', 'Baujahr', 'Abrissjahr', 'Zustand',
    'Wärmebedarf (MWh/a)', 'Heizlast (kW)', 'Spez. Wärme (kWh/m²a)',
    'Strom (MWh/a)', 'PV aktiv', 'PV Dachanteil (%)']];
  for (const g of allGebaeude) {
    gebRows.push([
      g.id, g.name || '', g.nutzung || '',
      g.flaeche != null ? +parseFloat(g.flaeche).toFixed(0) : '',
      g.baujahr || '', g.abrissjahr || '', g.zustand || '',
      g.waerme != null ? +parseFloat(g.waerme).toFixed(2) : '',
      g.heizlast != null ? +parseFloat(g.heizlast).toFixed(1) : '',
      g.spez != null ? +parseFloat(g.spez).toFixed(0) : '',
      g.strom != null && g.strom !== '' ? +parseFloat(g.strom).toFixed(2) : '',
      g.pvAktiv ? 'ja' : 'nein',
      g.pvDachanteil || 30,
    ]);
  }

  // Sheet 2: Assets
  const assetsRows = [['ID', 'Name', 'Typ', 'Gebäude', 'Baujahr', 'Abrissjahr',
    'Status ' + yr, 'Leistung kW/kVA', 'Maßnahmen (Anzahl)', 'Investition (€)']];
  const assetMap = new Map(allAssets.map(a => [a.id, a]));
  for (const a of allAssets) {
    const p = a.props || {};
    const status = getAssetStatus(a, yr);
    const statusTxt = status === 'active' ? 'Aktiv' : status === 'planned' ? 'Geplant' : 'Abgerissen';
    let leistung = '';
    if (a.type === 'Trafo') leistung = (p.leistungKVA || 630) + ' kVA';
    else if (['Verbraucher', 'WP', 'Nsa', 'KWK', 'Wind'].includes(a.type)) leistung = (p.leistungKW || p.leistungElKW || 0) + ' kW';
    else if (a.type === 'PV') leistung = (p.leistungKWp || 0) + ' kWp';
    else if (a.type === 'Lade') leistung = ((p.anzahlPunkte || 4) * (p.leistungProPunktKW || 22)) + ' kW';
    else if (['NSHV', 'UV', 'KVS', 'Schaltanlage'].includes(a.type)) leistung = (p.nennstromA || 400) + ' A';
    const totalKosten = (a.massnahmen || []).reduce((s, m) => s + (parseFloat(m.kosten) || 0), 0);
    const gebName = a.buildingId != null ? (gebMap.get(a.buildingId)?.name || a.buildingId) : '';
    assetsRows.push([a.id, a.name || a.id, ASSET_LABELS[a.type] || a.type, gebName,
      a.baujahr || '', a.abrissjahr || '', statusTxt, leistung,
      (a.massnahmen || []).length, totalKosten || '']);
  }

  // Sheet 3: Kabel
  const kabelRows = [['Von-ID', 'Nach-ID', 'Von', 'Nach', 'Typ', 'Querschnitt mm²',
    'Länge m', 'Parallelkabel', 'Sicherung A', 'Strom A', 'Auslastung %', 'Spannungsfall %', 'Fluss kW']];
  for (const e of allEdges) {
    const uName = assetMap.get(e.u)?.name || e.u;
    const vName = assetMap.get(e.v)?.name || e.v;
    kabelRows.push([
      e.u, e.v, uName, vName, e.cableType || 'NAYY',
      e.crossSection || '', Math.round(e.lengthM || 0),
      e.nParallel || 1, e.fuseA || '',
      e.peakCurrentA != null ? +e.peakCurrentA.toFixed(1) : '',
      e.auslastungPct != null ? +e.auslastungPct.toFixed(1) : '',
      e.deltaUPct != null ? +e.deltaUPct.toFixed(2) : '',
      e.peakFlowKw != null ? +e.peakFlowKw.toFixed(1) : '',
    ]);
  }

  // Sheet 4: Maßnahmen
  const massnRows = [['Asset-ID', 'Asset', 'Typ', 'Titel', 'Beschreibung', 'Jahr', 'Status', 'Kosten €']];
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      massnRows.push([a.id, a.name || a.id, ASSET_LABELS[a.type] || a.type,
        m.titel || '', m.beschreibung || '', m.jahr || '', m.status || 'geplant', parseFloat(m.kosten) || 0]);
    }
  }

  // Sheet 5: Beziehungen (Übersicht, nur Referenz)
  const bezRows = [['Asset-ID', 'Asset-Name', 'Typ', 'Gebäude-ID', 'Gebäude-Name', 'Verbunden mit (IDs)']];
  for (const a of allAssets) {
    const connectedIds = allEdges
      .filter(e => e.u === a.id || e.v === a.id)
      .map(e => e.u === a.id ? e.v : e.u)
      .join(', ');
    const gebName = a.buildingId != null ? (gebMap.get(a.buildingId)?.name || '') : '';
    bezRows.push([a.id, a.name || a.id, ASSET_LABELS[a.type] || a.type,
      a.buildingId || '', gebName, connectedIds]);
  }

  // ── Übersichtsblatt: Kennzahlen ──────────────────────────────────────────
  const totalFlaeche  = allGebaeude.reduce((s, g) => s + (parseFloat(g.flaeche)  || 0), 0);
  const totalWaerme   = allGebaeude.reduce((s, g) => s + (parseFloat(g.waerme)   || 0), 0);
  const totalHeizlast = allGebaeude.reduce((s, g) => s + (parseFloat(g.heizlast) || 0), 0);
  const totalStrom    = allGebaeude.reduce((s, g) => s + (parseFloat(g.strom)    || 0), 0);
  const totalKabelLaenge = allEdges.reduce((s, e) => s + (e.lengthM || 0), 0);

  // Assets: je Typ Anzahl + Investition
  const typStats = {};
  for (const a of allAssets) {
    if (!typStats[a.type]) typStats[a.type] = { count: 0, invest: 0 };
    typStats[a.type].count++;
    typStats[a.type].invest += (a.massnahmen || []).reduce((s, m) => s + (parseFloat(m.kosten) || 0), 0);
  }

  // Maßnahmen: je Status Anzahl + Kosten
  const massnStats = { geplant: { n: 0, k: 0 }, beauftragt: { n: 0, k: 0 }, umgesetzt: { n: 0, k: 0 } };
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      const s = massnStats[m.status] || massnStats.geplant;
      s.n++;
      s.k += parseFloat(m.kosten) || 0;
    }
  }
  const massnGesamt = { n: 0, k: 0 };
  for (const s of Object.values(massnStats)) { massnGesamt.n += s.n; massnGesamt.k += s.k; }

  const fmt1 = v => +v.toFixed(1);
  const fmt0 = v => Math.round(v);

  const ueRows = [
    ['Energieplanung – Übersicht'],
    [],
    ['Exportiert am', new Date().toLocaleDateString('de-DE')],
    ['Planungsjahr',  yr],
    [],
    ['GEBÄUDE', '', ''],
    ['Kenngröße', 'Wert', 'Einheit'],
    ['Anzahl Gebäude',           allGebaeude.length,       ''],
    ['Gesamtfläche',             fmt0(totalFlaeche),        'm²'],
    ['Wärmebedarf gesamt',       fmt1(totalWaerme),         'MWh/a'],
    ['Heizlast gesamt',          fmt1(totalHeizlast),       'kW'],
    ['Strombedarf gesamt',       fmt1(totalStrom),          'MWh/a'],
    [],
    ['ELEKTRISCHE ANLAGEN', '', ''],
    ['Typ', 'Anzahl', 'Investition (€)'],
    ...Object.entries(typStats).map(([t, s]) => [ASSET_LABELS[t] || t, s.count, fmt0(s.invest)]),
    ['Gesamt', allAssets.length, fmt0(Object.values(typStats).reduce((s, x) => s + x.invest, 0))],
    [],
    ['KABEL / LEITUNGEN', '', ''],
    ['Kenngröße', 'Wert', 'Einheit'],
    ['Anzahl Kabel',   allEdges.length,         ''],
    ['Gesamtlänge',    fmt0(totalKabelLaenge),   'm'],
    [],
    ['MASSNAHMEN', '', ''],
    ['Status', 'Anzahl', 'Kosten (€)'],
    ['Geplant',     massnStats.geplant.n,     fmt0(massnStats.geplant.k)],
    ['Beauftragt',  massnStats.beauftragt.n,  fmt0(massnStats.beauftragt.k)],
    ['Umgesetzt',   massnStats.umgesetzt.n,   fmt0(massnStats.umgesetzt.k)],
    ['Gesamt',      massnGesamt.n,            fmt0(massnGesamt.k)],
  ];

  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(ueRows),     'Übersicht');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(gebRows),    'Gebäude');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(assetsRows), 'Assets');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(kabelRows),  'Kabel');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(massnRows),  'Maßnahmen');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(bezRows),    'Beziehungen');

  // ── Typ-spezifische Reiter (nur wenn Assets dieses Typs vorhanden) ──────────
  for (const [type, schemaDefs] of Object.entries(ASSET_PROPS_SCHEMA)) {
    const typeAssets = allAssets.filter(a => a.type === type);
    if (!typeAssets.length || !schemaDefs.length) continue;
    const propKeys   = schemaDefs.map(d => d.key);
    const propLabels = schemaDefs.map(d => d.label);
    const header = ['ID', 'Name', 'Gebäude', 'Baujahr', 'Abrissjahr', 'Status ' + yr, ...propLabels];
    const rows = [header];
    for (const a of typeAssets) {
      const p = a.props || {};
      const status = getAssetStatus(a, yr);
      const statusTxt = status === 'active' ? 'Aktiv' : status === 'planned' ? 'Geplant' : 'Abgerissen';
      const gebName = a.buildingId != null ? (gebMap.get(a.buildingId)?.name || a.buildingId) : '';
      rows.push([
        a.id, a.name || a.id, gebName,
        a.baujahr || '', a.abrissjahr || '', statusTxt,
        ...propKeys.map(k => p[k] != null ? p[k] : ''),
      ]);
    }
    XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(rows),
      (ASSET_LABELS[type] || type).slice(0, 31));
  }

  const fname = 'Vollexport_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSXLib.writeFile(wb, fname);
}

// ── Import: Vollständiger XLSX ──────────────────────────────────────────────
export function importVollstaendigXLSX() {
  let inp = document.getElementById('_xlsxImportInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = '_xlsxImportInput';
    inp.accept = '.xlsx';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', _handleXlsxImport);
  }
  inp.value = '';
  inp.click();
}

async function _handleXlsxImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (typeof window.XLSX === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('SheetJS konnte nicht geladen werden.'));
      document.head.appendChild(s);
    }).catch(e => { alert(e.message); return; });
  }
  const XLSXLib = window.XLSX;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSXLib.read(e.target.result, { type: 'array' });
      let updGeb = 0, updAssets = 0, updKabel = 0, updMassn = 0;

      // ── Sheet "Gebäude": Namen + Felder überschreiben ──────────────
      const gebSheet = wb.Sheets['Gebäude'];
      if (gebSheet) {
        const rows = XLSXLib.utils.sheet_to_json(gebSheet, { header: 1 });
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row[0] == null) continue;
          const id = Number(row[0]);
          const g = (window.gebaeude || []).find(x => x.id === id);
          if (!g) continue;
          let changed = false;
          // Name
          const newName = row[1] != null ? String(row[1]).trim() : null;
          if (newName && newName !== g.name) {
            if (typeof window.renameGebaeude === 'function') window.renameGebaeude(id, newName);
            else g.name = newName;
            changed = true;
          }
          // Nutzung
          if (row[2] != null && String(row[2]).trim() && String(row[2]).trim() !== g.nutzung) {
            g.nutzung = String(row[2]).trim(); changed = true;
          }
          // Fläche
          if (row[3] != null && !isNaN(parseFloat(row[3])) && parseFloat(row[3]) > 0) {
            g.flaeche = parseFloat(row[3]); changed = true;
          }
          // Baujahr
          if (row[4] != null && !isNaN(parseInt(row[4])) && parseInt(row[4]) > 0) {
            g.baujahr = parseInt(row[4]); changed = true;
          }
          // Abrissjahr
          if (row[5] != null && String(row[5]).trim() !== '' && !isNaN(parseInt(row[5])) && parseInt(row[5]) > 0) {
            g.abrissjahr = parseInt(row[5]); changed = true;
          }
          // Zustand
          if (row[6] != null && String(row[6]).trim()) {
            g.zustand = String(row[6]).trim(); changed = true;
          }
          // Wärmebedarf
          if (row[7] != null && !isNaN(parseFloat(row[7]))) {
            g.waerme = parseFloat(row[7]); g.waermeManual = true; changed = true;
          }
          // Heizlast
          if (row[8] != null && !isNaN(parseFloat(row[8]))) {
            g.heizlast = parseFloat(row[8]); g.heizlastManual = true; changed = true;
          }
          // Strom
          if (row[10] != null && String(row[10]).trim() !== '' && !isNaN(parseFloat(row[10]))) {
            g.strom = String(parseFloat(row[10])); changed = true;
          }
          // PV aktiv
          if (row[11] != null) {
            const v = String(row[11]).toLowerCase().trim();
            if (v === 'ja' || v === 'true' || v === '1') { g.pvAktiv = true; changed = true; }
            else if (v === 'nein' || v === 'false' || v === '0') { g.pvAktiv = false; changed = true; }
          }
          // PV Dachanteil
          if (row[12] != null && !isNaN(parseFloat(row[12]))) {
            g.pvDachanteil = parseFloat(row[12]); changed = true;
          }
          if (changed) updGeb++;
        }
        if (typeof window.renderList === 'function') window.renderList();
      }

      // ── Sheet "Assets": Name, Baujahr, Abrissjahr überschreiben ────
      const assetsSheet = wb.Sheets['Assets'];
      if (assetsSheet) {
        const rows = XLSXLib.utils.sheet_to_json(assetsSheet, { header: 1 });
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row[0] == null) continue;
          const id = String(row[0]);
          const a = (ASSETS.items || []).find(x => x.id === id);
          if (!a) continue;
          let changed = false;
          if (row[1] != null && String(row[1]).trim() && String(row[1]).trim() !== a.name) {
            a.name = String(row[1]).trim(); changed = true;
          }
          if (row[4] != null && !isNaN(parseInt(row[4])) && parseInt(row[4]) > 0) {
            a.baujahr = parseInt(row[4]); changed = true;
          }
          if (row[5] != null && String(row[5]).trim() !== '' && !isNaN(parseInt(row[5])) && parseInt(row[5]) > 0) {
            a.abrissjahr = parseInt(row[5]); changed = true;
          }
          if (changed) updAssets++;
        }
        if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
      }

      // ── Sheet "Kabel": Kabeltyp, Querschnitt, Parallel, Sicherung ──
      const kabelSheet = wb.Sheets['Kabel'];
      if (kabelSheet) {
        const rows = XLSXLib.utils.sheet_to_json(kabelSheet, { header: 1 });
        const edgeArr = window.stromEdges || [];
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row[0] == null) continue;
          const uId = String(row[0]);
          const vId = String(row[1]);
          const edge = edgeArr.find(e => String(e.u) === uId && String(e.v) === vId)
                    || edgeArr.find(e => String(e.u) === vId && String(e.v) === uId);
          if (!edge) continue;
          let changed = false;
          if (row[4] != null && String(row[4]).trim()) { edge.cableType = String(row[4]).trim(); changed = true; }
          if (row[5] != null && !isNaN(parseFloat(row[5]))) { edge.crossSection = parseFloat(row[5]); edge.autoSized = false; changed = true; }
          if (row[7] != null && !isNaN(parseInt(row[7]))) { edge.nParallel = Math.max(1, parseInt(row[7])); changed = true; }
          if (row[8] != null && !isNaN(parseFloat(row[8]))) { edge.fuseA = parseFloat(row[8]); changed = true; }
          if (changed) updKabel++;
        }
      }

      // ── Sheet "Maßnahmen": Status, Kosten überschreiben ────────────
      const massnSheet = wb.Sheets['Maßnahmen'];
      if (massnSheet) {
        const rows = XLSXLib.utils.sheet_to_json(massnSheet, { header: 1 });
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row[0] == null) continue;
          const assetId = String(row[0]);
          const titel = String(row[3] || '').trim();
          const jahr = row[5] != null ? String(row[5]).trim() : '';
          const a = (ASSETS.items || []).find(x => x.id === assetId);
          if (!a) continue;
          const m = (a.massnahmen || []).find(x =>
            (x.titel || '').trim() === titel && String(x.jahr || '').trim() === jahr);
          if (!m) continue;
          let changed = false;
          if (row[6] != null && String(row[6]).trim()) { m.status = String(row[6]).trim(); changed = true; }
          if (row[7] != null && !isNaN(parseFloat(row[7]))) { m.kosten = parseFloat(row[7]); changed = true; }
          if (changed) updMassn++;
        }
      }

      // ── Typ-spezifische Reiter: Props überschreiben ─────────────────
      const updAssetIds = new Set();
      for (const [type, schemaDefs] of Object.entries(ASSET_PROPS_SCHEMA)) {
        if (!schemaDefs.length) continue;
        const sheetName = (ASSET_LABELS[type] || type).slice(0, 31);
        const typeSheet = wb.Sheets[sheetName];
        if (!typeSheet) continue;
        const rows = XLSXLib.utils.sheet_to_json(typeSheet, { header: 1 });
        if (rows.length < 2) continue;
        // Spalten 6+ → prop keys aus Schema (per Label-Abgleich mit Header)
        const header = rows[0] || [];
        const labelToKey = Object.fromEntries(schemaDefs.map(d => [d.label, d.key]));
        const colToProp = {};
        for (let c = 6; c < header.length; c++) {
          const k = labelToKey[header[c]];
          if (k) colToProp[c] = k;
        }
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row[0] == null) continue;
          const id = String(row[0]);
          const a = (ASSETS.items || []).find(x => x.id === id && x.type === type);
          if (!a) continue;
          if (!a.props) a.props = {};
          let changed = false;
          // Name
          if (row[1] != null && String(row[1]).trim() && String(row[1]).trim() !== a.name) {
            a.name = String(row[1]).trim(); changed = true;
          }
          // Baujahr
          if (row[3] != null && !isNaN(parseInt(row[3])) && parseInt(row[3]) > 0) {
            a.baujahr = parseInt(row[3]); changed = true;
          }
          // Abrissjahr
          if (row[4] != null && String(row[4]).trim() !== '' && !isNaN(parseInt(row[4])) && parseInt(row[4]) > 0) {
            a.abrissjahr = parseInt(row[4]); changed = true;
          }
          // Typ-spezifische Props
          for (const [col, propKey] of Object.entries(colToProp)) {
            const val = row[parseInt(col)];
            if (val != null && val !== '') {
              const num = parseFloat(val);
              a.props[propKey] = isNaN(num) ? String(val) : num;
              changed = true;
            }
          }
          if (changed) updAssetIds.add(id);
        }
      }
      updAssets += updAssetIds.size;
      if (updAssetIds.size && typeof window.redrawAllAssets === 'function') window.redrawAllAssets();

      const lines = [];
      if (updGeb) lines.push(`${updGeb} Gebäude`);
      if (updAssets) lines.push(`${updAssets} Assets`);
      if (updKabel) lines.push(`${updKabel} Kabel`);
      if (updMassn) lines.push(`${updMassn} Maßnahmen`);
      const msg = lines.length
        ? 'Import abgeschlossen: ' + lines.join(', ') + ' aktualisiert.'
        : 'Import abgeschlossen – keine Änderungen erkannt.';
      alert(msg);

      if (typeof window.glBerechnen === 'function') window.glBerechnen();

    } catch (err) {
      alert('Fehler beim Import: ' + err.message);
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// ── Hook into existing recalc to update left panel ───────────────
export const _origRecalcNetz = typeof recalcNetz !== 'undefined' ? recalcNetz : null;
// We'll hook updateLpNetzSummary after recalcNetz calls via a periodic check instead
setInterval(() => {
  updateLpNetzSummary();
  updateLpMeritOrder();
  updateLpStromSummary();
}, 2000);
