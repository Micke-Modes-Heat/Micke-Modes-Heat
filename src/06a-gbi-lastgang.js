// ── 06a-gbi-lastgang.js — CSV-Import, Lastgang-UI, Klimadaten ──
// ── Globaler Systemzustand ────────────────────────────────────────────────
import { gebaeude } from './01-globals-varianten.js';
import { calcAutoEnergy, getNutzungstypen } from './02b-gebaeude.js';
import { hidePanels, recalcNetz } from './03b-netz.js';
import { map } from './02b-gebaeude.js';
import { polygonCenter, updateViz } from './02c-karte-werkzeuge.js';
import { escHtml, renderList, updateTotals } from './03c-gebaeude-io.js';
import { glBerechnenDebounced, glKannBerechnen } from './06b-gl-berechnen.js';
import { saCurrentTab, saSetTab } from './07a-analysis-charts.js';
import { calcWirtschaftPanel } from './07b-analysis-economics.js';
import { CalcEngine } from './08-calc-engine.js';
import { normalizeHourlyYear } from './lib/time-series.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { glBerechnenAuto } from './06b-gl-berechnen.js';
import { BWP_KLIMA_META, BWP_KLIMA_PLZ } from './data/bwp-klima-plz.js';

window.systemState  = null; // wird nach glBerechnen() befüllt
window.elQuartierH  = null; // Float32Array[8760] — stündl. Stromlastgang Quartier (ohne WP)
window._wpElHourly  = null; // Float32Array[8760] — stündl. WP-Stromverbrauch (Summe alle WPs)
window._skElHourly  = null; // Float32Array[8760] — stündl. Stromkessel-Stromverbrauch
window.elPvH         = null; // Float32Array[8760] — stündl. PV-Erzeugung (Upload oder synthetisch)
window.elPvMeta      = null; // Herkunft/Qualität eines hochgeladenen PV-Profils
window._bhkwElHourly = null; // Float32Array[8760] — stündl. BHKW-Stromerzeugung

// Globale Monatsgrenzen (stündlich, 365-Tage-Jahr ohne Schalttag)
export const GL_MONTH_START = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
export const GL_MONTH_HOURS = [744,672,744,720,744,720,744,744,720,744,720,744];

// ══════════════════════════════════════════════════════════════════════════
// ── Gebäudeliste CSV-Import (Click-to-Assign) ───────────────────────────
// ══════════════════════════════════════════════════════════════════════════

export let gbiData = [];        // parsed CSV rows as objects
export let gbiColumns = {};     // {name:colIdx, nutzung:colIdx, baujahr:colIdx, zustand:colIdx, flaeche:colIdx}
export let gbiHeaders = [];     // raw CSV headers
export let gbiRawRows = [];     // raw CSV rows (arrays)
export let gbiMatches = [];     // [{csvIdx, gebId, score, status:'auto'|'manual'|'rejected'}]

export function openGebListImport() {
  const p = document.getElementById('geb-import-panel');
  p.classList.add('visible');
  p.style.display = 'flex';
  p.style.flexDirection = 'column';
  gbiReset();
}

export function gbiClose() {
  var p = document.getElementById('geb-import-panel');
  p.classList.remove('visible');
  p.style.display = '';
  gbiDetachMapDropTargets();
  updateViz();
}

export function _gbiDownloadVorlage() {
  const csv = 'Gebäudenummer;Bezeichnung;Nutzung;Baujahr;Zustand;Fläche m²;Stockwerke;Wärmeverbrauch MWh/a;Heizlast kW;Stromverbrauch MWh/a;Abrissjahr\n'
    + '12;Rathaus;Büro;1968;B;2400;3;180;95;40;\n'
    + 'IV-a;Grundschule Am Park;Schule;1975;C;1800;2;;;;\n'
    + 'B7;MFH Bergstraße 12;MFH;1958;B;620;4;;;;2035\n';
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'Gebäudeliste_Vorlage.csv'; a.click();
  URL.revokeObjectURL(url);
}

export function gbiReset() {
  gbiData = []; gbiColumns = {}; gbiHeaders = []; gbiRawRows = []; gbiMatches = [];
  document.getElementById('gbi-step-upload').style.display = '';
  document.getElementById('gbi-step-mapping').style.display = 'none';
  document.getElementById('gbi-step-results').style.display = 'none';
  document.getElementById('gbi-file-info').textContent = '';
  document.getElementById('gbi-file-input').value = '';
}

// ── Step 1: File Parse ──────────────────────────────────────────────────
export function gbiFileSelected(file) {
  if (!file) return;
  document.getElementById('gbi-file-info').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const sep = text.indexOf(';') !== -1 ? ';' : ',';
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('CSV enthält keine Daten.'); return; }
    gbiHeaders = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
    gbiRawRows = lines.slice(1).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    gbiAutoMapColumns();
    gbiShowMapping();
  };
  reader.readAsText(file, 'UTF-8');
}

export function gbiAutoMapColumns() {
  gbiColumns = { name: -1, gebaeudenummer: -1, nutzung: -1, baujahr: -1, zustand: -1, flaeche: -1, stockwerke: -1, waerme: -1, heizlast: -1, strom: -1, abrissjahr: -1 };
  gbiHeaders.forEach(function(h, i) {
    var hl = h.toLowerCase();
    if (gbiColumns.gebaeudenummer === -1 && /(gebäudenummer|gebaeudenummer|geb\.?\s*-?\s*nr\.?|objektnummer|liegenschaftsnummer|\bnr\.?\b)/i.test(hl)) gbiColumns.gebaeudenummer = i;
    // Header, die bereits als Nummer erkannt wurden, nicht zusätzlich als Bezeichnung werten.
    if (gbiColumns.name === -1 && !/nummer|\bnr\.?\b/i.test(hl) && /(bezeichnung|name|gebäude|objekt|liegenschaft)/i.test(hl)) gbiColumns.name = i;
    if (gbiColumns.nutzung === -1 && /(nutzung|funktion|typ|art|kategorie)/i.test(hl)) gbiColumns.nutzung = i;
    if (gbiColumns.baujahr === -1 && /(baujahr|bj|erricht)/i.test(hl)) gbiColumns.baujahr = i;
    if (gbiColumns.abrissjahr === -1 && /(abrissjahr|abriss)/i.test(hl)) gbiColumns.abrissjahr = i;
    if (gbiColumns.zustand === -1 && /(zustand|kondition|qualität|baulich|zustandsklasse)/i.test(hl)) gbiColumns.zustand = i;
    if (gbiColumns.flaeche === -1 && /(fläche|flaeche|bgf|ngf|nuf|m²|qm|area)/i.test(hl)) gbiColumns.flaeche = i;
    if (gbiColumns.stockwerke === -1 && /(stockwerke|geschosse|etagen)/i.test(hl)) gbiColumns.stockwerke = i;
    if (gbiColumns.waerme === -1 && /(wärmeverbrauch|waermeverbrauch|wärme\s*mwh|waerme\s*mwh|heizenergie)/i.test(hl)) gbiColumns.waerme = i;
    if (gbiColumns.heizlast === -1 && /(heizlast)/i.test(hl)) gbiColumns.heizlast = i;
    if (gbiColumns.strom === -1 && /(stromverbrauch|strombedarf|strom\s*mwh)/i.test(hl)) gbiColumns.strom = i;
  });
}

// ── Step 2: Column Mapping UI ───────────────────────────────────────────
export function gbiShowMapping() {
  document.getElementById('gbi-step-upload').style.display = 'none';
  document.getElementById('gbi-step-mapping').style.display = '';
  // Preview table
  var prev = '<table style="width:100%;border-collapse:collapse;font-family:\'DM Mono\',monospace;">';
  prev += '<tr>' + gbiHeaders.map(function(h) { return '<th style="padding:2px 5px;border-bottom:1px solid var(--border);color:var(--accent);text-align:left;white-space:nowrap;">' + escHtml(h) + '</th>'; }).join('') + '</tr>';
  gbiRawRows.slice(0, 4).forEach(function(row) {
    prev += '<tr>' + row.map(function(c) { return '<td style="padding:2px 5px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap;">' + escHtml(c) + '</td>'; }).join('') + '</tr>';
  });
  prev += '</table>';
  document.getElementById('gbi-preview').innerHTML = prev;
  // Column dropdowns
  var fields = [
    { key: 'name', label: 'Bezeichnung' },
    { key: 'gebaeudenummer', label: 'Gebäudenummer' },
    { key: 'nutzung', label: 'Nutzung' },
    { key: 'baujahr', label: 'Baujahr' },
    { key: 'zustand', label: 'Zustand (A/B/C)' },
    { key: 'flaeche', label: 'Fläche m²' },
    { key: 'stockwerke', label: 'Stockwerke' },
    { key: 'waerme', label: 'Wärmeverbrauch MWh/a' },
    { key: 'heizlast', label: 'Heizlast kW' },
    { key: 'strom', label: 'Stromverbrauch MWh/a' },
    { key: 'abrissjahr', label: 'Abrissjahr' }
  ];
  var opts = '<option value="-1">— nicht zuordnen —</option>' + gbiHeaders.map(function(h, i) {
    return '<option value="' + i + '">' + escHtml(h) + '</option>';
  }).join('');
  var html = '';
  fields.forEach(function(f) {
    html += '<div class="inp-group"><label class="inp-label">' + f.label + '</label>'
      + '<select class="inp-field" id="gbi-col-' + f.key + '" data-change="gbiColumns[\'' + f.key + '\']=parseInt(this.value)">'
      + opts.replace('value="' + gbiColumns[f.key] + '"', 'value="' + gbiColumns[f.key] + '" selected')
      + '</select></div>';
  });
  document.getElementById('gbi-col-mapping').innerHTML = html;
}

export function gbiBackToUpload() {
  document.getElementById('gbi-step-mapping').style.display = 'none';
  document.getElementById('gbi-step-upload').style.display = '';
}

// ── Step 3: Auto-Matching ───────────────────────────────────────────────
export function gbiStartMatching() {
  // Build CSV data objects
  var num = function(v) { return parseFloat((v || '').replace(/\./g, '').replace(',', '.')) || 0; };
  gbiData = gbiRawRows.map(function(row, idx) {
    return {
      idx: idx,
      name: gbiColumns.name >= 0 ? (row[gbiColumns.name] || '') : '',
      gebaeudenummer: gbiColumns.gebaeudenummer >= 0 ? (row[gbiColumns.gebaeudenummer] || '').trim() : '',
      nutzung: gbiColumns.nutzung >= 0 ? (row[gbiColumns.nutzung] || '') : '',
      baujahr: gbiColumns.baujahr >= 0 ? parseInt(row[gbiColumns.baujahr]) || 0 : 0,
      zustand: gbiColumns.zustand >= 0 ? (row[gbiColumns.zustand] || '').toUpperCase().trim() : '',
      flaeche: gbiColumns.flaeche >= 0 ? num(row[gbiColumns.flaeche]) : 0,
      stockwerke: gbiColumns.stockwerke >= 0 ? parseInt(row[gbiColumns.stockwerke]) || 0 : 0,
      waerme: gbiColumns.waerme >= 0 ? num(row[gbiColumns.waerme]) : 0,
      heizlast: gbiColumns.heizlast >= 0 ? num(row[gbiColumns.heizlast]) : 0,
      strom: gbiColumns.strom >= 0 ? num(row[gbiColumns.strom]) : 0,
      abrissjahr: gbiColumns.abrissjahr >= 0 ? parseInt(row[gbiColumns.abrissjahr]) || 0 : 0
    };
  }).filter(function(d) { return d.name || d.flaeche > 0; }); // filter empty rows

  // Score each CSV row against each gebaeude
  var usedGeb = {};
  gbiMatches = [];
  gbiData.forEach(function(csvRow) {
    var bestScore = -1, bestGebId = null;
    gebaeude.forEach(function(g) {
      if (usedGeb[g.id]) return;
      var score = gbiCalcScore(csvRow, g);
      if (score > bestScore) { bestScore = score; bestGebId = g.id; }
    });
    var status = 'unmatched';
    if (bestScore >= 70) status = 'auto';
    else if (bestScore >= 40) status = 'unsicher';
    gbiMatches.push({ csvIdx: csvRow.idx, gebId: bestGebId, score: bestScore, status: status });
    if (status === 'auto') usedGeb[bestGebId] = true;
  });
  gbiShowResults();
}

export function gbiCalcScore(csvRow, g) {
  // Exakte Gebäudenummer ist ein Primärschlüssel-Treffer — schlägt jede Fuzzy-Bewertung.
  if (csvRow.gebaeudenummer && g.gebaeudenummer &&
      csvRow.gebaeudenummer.toLowerCase() === String(g.gebaeudenummer).toLowerCase().trim()) {
    return 100;
  }
  var score = 0, factors = 0;
  // Fläche (max 40 points)
  if (csvRow.flaeche > 0 && g.flaeche > 0) {
    var ratio = Math.min(csvRow.flaeche, g.flaeche) / Math.max(csvRow.flaeche, g.flaeche);
    score += ratio * 40;
    factors += 40;
  }
  // Nutzung (max 25 points)
  if (csvRow.nutzung) {
    var csvNutz = gbiMapNutzung(csvRow.nutzung);
    if (csvNutz && g.nutzung && csvNutz === g.nutzung) {
      score += 25;
    }
    factors += 25;
  }
  // Baujahr (max 20 points)
  if (csvRow.baujahr > 1800 && g.baujahr > 1800) {
    var diff = Math.abs(csvRow.baujahr - g.baujahr);
    score += Math.max(0, 20 - diff * 2);
    factors += 20;
  }
  // Name similarity (max 15 points)
  if (csvRow.name && g.name) {
    var sim = gbiStringSimilarity(csvRow.name.toLowerCase(), g.name.toLowerCase());
    score += sim * 15;
    factors += 15;
  }
  return factors > 0 ? Math.round(score / factors * 100) : 0;
}

export function gbiStringSimilarity(a, b) {
  if (a === b) return 1;
  var longer = a.length > b.length ? a : b;
  var shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  // Check if one contains the other
  if (longer.indexOf(shorter) !== -1) return 0.8;
  // Simple bigram overlap
  function bigrams(s) { var b = []; for (var i = 0; i < s.length - 1; i++) b.push(s.substring(i, i + 2)); return b; }
  var bg1 = bigrams(a), bg2 = bigrams(b);
  var set2 = new Set(bg2);
  var hits = bg1.filter(function(b) { return set2.has(b); }).length;
  return (2.0 * hits) / (bg1.length + bg2.length);
}

// Ordnet einen freien Nutzungs-Text (aus der CSV) einer Nutzungstyp-ID zu — geprüft
// gegen das vollständige Register (eingebaute + projekteigene Typen), mit ein paar
// gängigen Kurzformen als Fallback, falls der Text nicht im Label vorkommt.
export function gbiMapNutzung(raw) {
  if (!raw) return '';
  var r = raw.toLowerCase().trim();
  var types = getNutzungstypen();
  var byId = types.find(function(t) { return t.id === r; });
  if (byId) return byId.id;
  var byLabel = types.find(function(t) { return t.label.toLowerCase() === r; });
  if (byLabel) return byLabel.id;
  var byPartial = types.find(function(t) {
    var l = t.label.toLowerCase();
    return l.indexOf(r) !== -1 || r.indexOf(l) !== -1;
  });
  if (byPartial) return byPartial.id;
  if (/^efh$|einfam|einf\.|1.?fam/.test(r)) return 'efh';
  if (/^mfh$|mehrfam|mehrf\.|wohnung/.test(r)) return 'mfh';
  if (/ghd|gewerbe|handel|laden|dienstl/.test(r)) return 'ghd';
  if (/kita|kindergarten/.test(r)) return 'kita';
  if (/^schule$|grundschule|gesamtschule|realschule/.test(r)) return 'schule';
  if (/büro|buero|office/.test(r)) return 'buero';
  if (/industrie|produktion|fabrik/.test(r)) return 'industrie';
  if (/rathaus|verwaltung/.test(r)) return 'verwaltung';
  if (/öffentl|oeffentl|gemeinde/.test(r)) return 'oeffentlich';
  return '';
}

// ── Step 3: Results UI ──────────────────────────────────────────────────
export function gbiShowResults() {
  document.getElementById('gbi-step-mapping').style.display = 'none';
  document.getElementById('gbi-step-results').style.display = '';
  var autoCount = gbiMatches.filter(function(m) { return m.status === 'auto'; }).length;
  var unsicherCount = gbiMatches.filter(function(m) { return m.status === 'unsicher'; }).length;
  var unmatchedCount = gbiMatches.filter(function(m) { return m.status === 'unmatched'; }).length;
  document.getElementById('gbi-match-summary').innerHTML =
    '<span style="color:#66bb6a;">● ' + autoCount + ' sicher</span> · '
    + '<span style="color:#f9a825;">● ' + unsicherCount + ' unsicher</span> · '
    + '<span style="color:#e53935;">● ' + unmatchedCount + ' ohne Treffer</span> · '
    + 'Gesamt: ' + gbiMatches.length + ' Zeilen → ' + gebaeude.length + ' Gebäude auf Karte';
  gbiRenderMatchTable();
  gbiAttachMapDropTargets();
  gbiHighlightAll();
}

export function gbiRenderMatchTable() {
  var html = '<table style="width:100%;border-collapse:collapse;font-size:10px;">';
  html += '<tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 5px;color:var(--muted);">CSV-Zeile</th><th style="text-align:left;padding:3px 5px;color:var(--muted);">→ Kartengebäude</th><th style="padding:3px 5px;color:var(--muted);">Score</th><th style="padding:3px 5px;color:var(--muted);">Aktion</th></tr>';
  gbiMatches.forEach(function(m, i) {
    var csvRow = gbiData.find(function(d) { return d.idx === m.csvIdx; });
    var geb = m.gebId != null ? gebaeude.find(function(g) { return g.id === m.gebId; }) : null;
    var color = m.status === 'auto' ? '#66bb6a' : m.status === 'unsicher' ? '#f9a825' : '#e53935';
    var sel = gbiSelectedCsvIdx === m.csvIdx;
    var bg = sel ? 'rgba(0,229,255,0.12)' : m.status === 'rejected' ? 'rgba(229,57,53,0.06)' : 'transparent';
    var border = sel ? '1px solid #00e5ff' : '1px solid transparent';
    var csvLabel = csvRow ? (csvRow.gebaeudenummer ? escHtml(csvRow.gebaeudenummer) + ' · ' : '') + escHtml(csvRow.name || ('Zeile ' + (csvRow.idx + 2))) + (csvRow.flaeche ? ' (' + csvRow.flaeche + ' m²)' : '') : '?';
    var gebLabel = geb ? (geb.gebaeudenummer ? escHtml(geb.gebaeudenummer) + ' · ' : '') + escHtml(geb.name) + (geb.flaeche ? ' (' + Math.round(geb.flaeche) + ' m²)' : '') : '<span style="color:var(--muted);">—</span>';
    var scoreStr = m.score >= 0 ? m.score + '%' : '—';
    // Ganze Zeile ist per Drag & Drop auf ein Gebäude auf der Karte ziehbar —
    // auch bei bereits (automatisch) zugeordneten Zeilen, um Fehlzuordnungen zu korrigieren.
    // Klick auf die Zeile hebt das zugehörige Gebäude zusätzlich auf der Karte hervor.
    html += '<tr draggable="true" ondragstart="gbiDragStart(event,' + m.csvIdx + ')" data-click="gbiSelectRow(' + m.csvIdx + ')" style="cursor:grab;border:' + border + ';border-bottom-color:rgba(255,255,255,.04);background:' + bg + ';">';
    html += '<td style="padding:3px 5px;">' + csvLabel + '</td>';
    html += '<td style="padding:3px 5px;">' + gebLabel + '</td>';
    html += '<td style="padding:3px 5px;text-align:center;color:' + color + ';">' + scoreStr + '</td>';
    html += '<td style="padding:3px 5px;text-align:center;">';
    if (m.status === 'rejected') {
      html += '<button data-click="gbiUnreject(' + i + ')" style="font-size:9px;padding:1px 6px;border:1px solid var(--border);background:transparent;color:var(--muted);border-radius:4px;cursor:pointer;">↩</button>';
    } else if (m.status === 'auto' || m.status === 'unsicher') {
      html += '<button data-click="gbiReject(' + i + ')" style="font-size:9px;padding:1px 6px;border:1px solid #e53935;background:transparent;color:#e53935;border-radius:4px;cursor:pointer;">✕</button>';
    }
    html += '</td></tr>';
  });
  html += '</table>';
  document.getElementById('gbi-match-table').innerHTML = html;
}

// Zeile angeklickt: Gebäude zusätzlich zur Status-Farbe auf der Karte hervorheben
// und dorthin schwenken — hilft bei vielen Gebäuden, das richtige zu finden.
let gbiSelectedCsvIdx = null;
export function gbiSelectRow(csvIdx) {
  gbiSelectedCsvIdx = csvIdx;
  gbiRenderMatchTable();
  gbiHighlightAll();
  var m = gbiMatches.find(function(m) { return m.csvIdx === csvIdx; });
  var geb = m && m.gebId != null ? gebaeude.find(function(g) { return g.id === m.gebId; }) : null;
  if (geb && geb.polygonLayer) {
    geb.polygonLayer.setStyle({ color: '#00e5ff', weight: 6 });
    geb.polygonLayer.bringToFront();
    if (geb.polygon && geb.polygon.length) map.panTo(polygonCenter(geb.polygon));
  }
}

export function gbiReject(idx) { gbiMatches[idx].status = 'rejected'; gbiRenderMatchTable(); gbiHighlightAll(); }
export function gbiUnreject(idx) {
  var m = gbiMatches[idx];
  m.status = m.score >= 70 ? 'auto' : m.score >= 40 ? 'unsicher' : 'unmatched';
  gbiRenderMatchTable();
  gbiHighlightAll();
}

export function gbiBackToMapping() {
  document.getElementById('gbi-step-results').style.display = 'none';
  document.getElementById('gbi-step-mapping').style.display = '';
  gbiDetachMapDropTargets();
  updateViz();
}

// ── Apply Matches ───────────────────────────────────────────────────────
// Nach Übernahme von CSV-Verbräuchen in Gebäude alles auffrischen.
// (Ersetzt die Aufrufe von _gbiRefreshAll(), das nie existierte — der
//  Abgleich crashte beim Übernehmen mit ReferenceError.)
function _gbiRefreshAll() {
  updateTotals();
  updateViz();
  recalcNetz();
  glBerechnenAuto();
}

export function gbiApplyMatches() {
  var applied = 0;
  gbiMatches.forEach(function(m) {
    if (m.status !== 'auto' && m.status !== 'unsicher') return;
    if (m.status === 'rejected') return;
    var csvRow = gbiData.find(function(d) { return d.idx === m.csvIdx; });
    var geb = m.gebId != null ? gebaeude.find(function(g) { return g.id === m.gebId; }) : null;
    if (!csvRow || !geb) return;
    gbiApplyToGeb(csvRow, geb);
    m.status = 'applied';
    applied++;
  });
  renderList();
  _gbiRefreshAll();
  var remaining = gbiMatches.filter(function(m) { return m.status === 'unmatched' || m.status === 'rejected'; }).length;
  if (remaining > 0) {
    alert(applied + ' Zuordnungen übernommen.\n' + remaining + ' Zeilen noch nicht zugeordnet — zieh sie einzeln auf das passende Gebäude auf der Karte.');
    gbiShowResults();
  } else {
    alert(applied + ' Zuordnungen übernommen. Alle Zeilen zugeordnet!');
    gbiClose();
  }
}

export function gbiApplyToGeb(csvRow, geb) {
  if (csvRow.name) geb.name = csvRow.name;
  if (csvRow.gebaeudenummer) geb.gebaeudenummer = csvRow.gebaeudenummer;
  if (csvRow.nutzung) {
    var mapped = gbiMapNutzung(csvRow.nutzung);
    if (mapped) geb.nutzung = mapped;
  }
  if (csvRow.baujahr > 1800) geb.baujahr = csvRow.baujahr;
  if (csvRow.flaeche > 0) geb.flaeche = csvRow.flaeche;
  if (csvRow.zustand) {
    var z = csvRow.zustand.toUpperCase().trim();
    if (z === 'A' || z === 'B' || z === 'C') geb.zustand = z;
  }
  if (csvRow.stockwerke > 0) geb.stockwerke = csvRow.stockwerke;
  if (csvRow.abrissjahr > 1800) geb.abrissjahr = csvRow.abrissjahr;
  if (csvRow.strom > 0) geb.strom = csvRow.strom;
  // Wärme/Heizlast werden sonst automatisch aus Fläche+Baujahr+Nutzung berechnet
  // (calcAutoEnergy) — ein importierter Wert muss daher als "manuell" markiert
  // werden, sonst überschreibt die Auto-Berechnung ihn sofort wieder.
  if (csvRow.waerme > 0) { geb.waerme = csvRow.waerme; geb.waermeManual = true; }
  if (csvRow.heizlast > 0) { geb.heizlast = csvRow.heizlast; geb.heizlastManual = true; }
  // Recalc energy if possible
  if (typeof calcAutoEnergy === 'function') calcAutoEnergy(geb);
}

// Übernimmt eine CSV-Zeile in ein Gebäude und markiert die Zuordnung als erledigt.
// Funktioniert für jeden Status — so lässt sich auch eine bereits (automatisch)
// zugeordnete Zeile per Drag & Drop auf ein anderes Gebäude korrigieren.
function _gbiAssignCsvToGeb(csvIdx, gebId) {
  var m = gbiMatches.find(function(m) { return m.csvIdx === csvIdx; });
  if (!m) return false;
  var csvRow = gbiData.find(function(d) { return d.idx === csvIdx; });
  var geb = gebaeude.find(function(g) { return g.id === gebId; });
  if (!csvRow || !geb) return false;
  gbiApplyToGeb(csvRow, geb);
  m.status = 'applied';
  m.gebId = gebId;
  renderList(); _gbiRefreshAll();
  return true;
}

function _gbiAfterAssign() {
  gbiRenderMatchTable();
  gbiHighlightAll();
}

// ── Drag & Drop: Zeile auf ein Gebäude auf der Karte ziehen ─────────────

export function gbiDragStart(e, csvIdx) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(csvIdx));
}

// Findet die (nicht abgelehnte) Zeile, die auf dieses Gebäude zeigt — falls vorhanden.
function gbiMatchFor(gebId) {
  return gbiMatches.find(function(m) { return m.gebId === gebId && (m.status === 'applied' || m.status === 'auto' || m.status === 'unsicher'); });
}

function gbiUnassignedStyle(g) {
  if (g.polygonLayer) g.polygonLayer.setStyle({ color: '#ffb300', weight: 2, fillColor: '#ffb300', fillOpacity: 0.05, dashArray: '5 4' });
}

// "Sicher" (auto) — Vorschlag, noch nicht per "Zuordnungen übernehmen" bestätigt.
function gbiPendingAutoStyle(g) {
  if (g.polygonLayer) g.polygonLayer.setStyle({ color: '#66bb6a', weight: 2.5, fillColor: '#66bb6a', fillOpacity: 0.18, dashArray: '' });
}

// "Unsicher" — Vorschlag mit niedrigerer Konfidenz, ebenfalls noch nicht bestätigt.
function gbiPendingUnsicherStyle(g) {
  if (g.polygonLayer) g.polygonLayer.setStyle({ color: '#42a5f5', weight: 2.5, fillColor: '#42a5f5', fillOpacity: 0.18, dashArray: '' });
}

// Bereits übernommen/manuell zugeordnet — gleiche Hervorhebung wie bei der Gebäude-
// Auswahl im Eigenschaften-Panel (siehe selectedId-Highlight in 02c-karte-werkzeuge.js).
function gbiMatchedStyle(g) {
  if (g.polygonLayer) g.polygonLayer.setStyle({ color: '#ff1493', weight: 3.5, fillColor: '#ff1493', fillOpacity: 0.3, dashArray: '' });
}

function gbiRestyleOne(g) {
  if (!g.polygonLayer) return;
  var m = gbiMatchFor(g.id);
  if (!m) gbiUnassignedStyle(g);
  else if (m.status === 'applied') gbiMatchedStyle(g);
  else if (m.status === 'auto') gbiPendingAutoStyle(g);
  else gbiPendingUnsicherStyle(g);
}

// Färbt alle Gebäude auf der Karte ein: pink = übernommen, grün = sicherer Vorschlag,
// blau = unsicherer Vorschlag, gestrichelt amber = noch offen.
// Aktiv, solange die Ergebnistabelle des Imports sichtbar ist.
export function gbiHighlightAll() {
  gebaeude.forEach(gbiRestyleOne);
}

export function gbiAttachMapDropTargets() {
  gebaeude.forEach(function(g) {
    var el = g.polygonLayer && g.polygonLayer.getElement && g.polygonLayer.getElement();
    if (!el || g._gbiDropHandlers) return;
    var over = function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    var enter = function() { if (g.polygonLayer) g.polygonLayer.setStyle({ color: '#29b6f6', weight: 3.5, fillColor: '#29b6f6', fillOpacity: 0.2, dashArray: '' }); };
    var leave = function() { gbiRestyleOne(g); };
    var drop = function(e) {
      e.preventDefault();
      var csvIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (!isNaN(csvIdx) && _gbiAssignCsvToGeb(csvIdx, g.id)) _gbiAfterAssign();
    };
    el.addEventListener('dragover', over);
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    g._gbiDropHandlers = { over: over, enter: enter, leave: leave, drop: drop, el: el };
  });
}

export function gbiDetachMapDropTargets() {
  gebaeude.forEach(function(g) {
    var h = g._gbiDropHandlers;
    if (!h) return;
    h.el.removeEventListener('dragover', h.over);
    h.el.removeEventListener('dragenter', h.enter);
    h.el.removeEventListener('dragleave', h.leave);
    h.el.removeEventListener('drop', h.drop);
    g._gbiDropHandlers = null;
  });
}

// ── Interne GL-Variablen ──────────────────────────────────────────────────
export let glRawCsv = null;       // roher CSV-Text
export let glRawData = null;      // Float32Array nach Parse, original (8760/8784h)
export let glLastgangKw = null;   // Float32Array 8760h, aufbereitet (normiert)
export let glTimeSeriesMeta = null; // Intervall, Zeitzone, Quelle, Qualität, Transformationen
export let glColHeaders = [];     // Spaltenköpfe falls mehrspaltig

// Wärme-Grundlagen sind projektbezogene Eingaben. Sie müssen beim Projektwechsel
// gemeinsam mit den Gebäuden wechseln; andernfalls rechnet ein altes Monatsprofil
// oder ein alter Upload unbemerkt mit der neu geladenen Liegenschaft weiter.
export function captureWaermeGrundlagen() {
  const value = id => document.getElementById(id)?.value ?? '';
  return {
    gesamtMwh:value('gl-gesamt'),
    monatswerte:Array.from({length:12},(_,i) => value(`gl-m${i}`)),
    stadt:value('gl-stadt'),
    plz:value('gl-plz'),
    klimajahr:value('gl-klimajahr'),
    normAussentemp:value('gl-norm-at'),
    netzverlustPct:value('gl-netzverlust'),
    vlMinus5:value('gl-vl5'),
    vl15:value('gl-vl15'),
    profil1:value('gl-profil1'),
    profil2:value('gl-profil2'),
    gewicht1:value('gl-gew1'),
    gewicht2:value('gl-gew2'),
    lastgangKw:glLastgangKw ? Array.from(glLastgangKw) : null,
    timeSeriesMeta:glTimeSeriesMeta ? structuredClone(glTimeSeriesMeta) : null,
  };
}

export function restoreWaermeGrundlagen(data) {
  const source = data && typeof data === 'object' ? data : {};
  const set = (id,value,fallback='') => {
    const element=document.getElementById(id);
    if (element) element.value=value ?? fallback;
  };
  set('gl-gesamt',source.gesamtMwh,'');
  for (let i=0;i<12;i++) set(`gl-m${i}`,source.monatswerte?.[i],'');
  set('gl-stadt',source.stadt,'Kassel');
  set('gl-klimajahr',source.klimajahr,'TMY');
  set('gl-plz',source.plz,'');
  if (source.plz && BWP_KLIMA_PLZ[String(source.plz)]) {
    glSetKlimaPlz(source.plz, false);
  } else if (source.normAussentemp !== '' && source.normAussentemp != null) {
    set('gl-norm-at',source.normAussentemp,'-12');
    set('netz-t-aussen',source.normAussentemp,'-12');
  } else {
    syncNormAussentemperatur(false);
  }
  set('gl-netzverlust',source.netzverlustPct,'10');
  set('gl-vl5',source.vlMinus5,'90');
  set('gl-vl15',source.vl15,'60');
  set('gl-profil1',source.profil1,'HEF33');
  set('gl-profil2',source.profil2,'');
  set('gl-gew1',source.gewicht1,'100');
  set('gl-gew2',source.gewicht2,'0');

  glRawCsv=null;
  glRawData=null;
  glColHeaders=[];
  glLastgangKw=Array.isArray(source.lastgangKw) && source.lastgangKw.length===8760
    ? Float32Array.from(source.lastgangKw)
    : null;
  glTimeSeriesMeta=glLastgangKw && source.timeSeriesMeta
    ? structuredClone(source.timeSeriesMeta)
    : null;

  glUpdateKlimaStatus();

  window.systemState=null;
  window._basisLastgangKw=null;
  window._basisGebWaermeSumme=null;
  window._dispatchLastgangKw=null;
  window._dispatchEnergy=null;
  window._dispatchHourly=null;
  window._dimLastgangKw=null;
  window._dimJdlSorted=null;

  document.getElementById('gl-upload-zone')?.classList.toggle('loaded',!!glLastgangKw);
  const info=document.getElementById('gl-upload-info');
  if (info) info.textContent=glLastgangKw
    ? `${source.timeSeriesMeta?.filename || 'Gespeicherter Lastgang'} · 8.760 Werte`
    : '';
  const preview=document.getElementById('gl-preview-wrap');
  if (preview) preview.style.display='none';
  const sum=document.getElementById('gl-monats-sum');
  if (sum) {
    const monthSum=glGetMonatswerte().reduce((total,current)=>total+(current||0),0);
    sum.textContent=monthSum>0 ? `${Math.round(monthSum).toLocaleString('de-DE')} MWh` : '—';
  }
  glUpdateStatus();
}

// ── Init ──────────────────────────────────────────────────────────────────
export function glInit() {
  // Stadtdropdown
  const sel = document.getElementById('gl-stadt');
  if (!sel) return; // kein DOM (z.B. Test-Umgebung)
  Object.keys(CalcEngine.STAEDTE).sort().forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    if (s === 'Kassel') o.selected = true;
    sel.appendChild(o);
  });
  // SigLinDe-Profile
  const profile = Object.keys(CalcEngine.SIGLINDE).sort();
  const sigLinDeLabels = {
    HEF:'Einfamilienhaus', HMF:'Mehrfamilienhaus',
    GMK:'Metall und Kfz', GHA:'Einzel- und Großhandel',
    GKO:'Gebietskörperschaften, Banken, Versicherungen',
    GBD:'Sonstige betriebliche Dienstleistungen',
    GGA:'Gaststätten', GBH:'Beherbergung',
    GWA:'Wäschereien und chemische Reinigungen',
    GGB:'Gartenbau', GBA:'Backstube', GPD:'Papier und Druck',
    GMF:'Haushaltsähnliches Gewerbe', GHD:'Gewerbe/Handel/Dienstleistung gesamt',
  };
  ['gl-profil1','gl-profil2'].forEach((id, idx) => {
    const ps = document.getElementById(id);
    if (idx === 1) {
      const none = document.createElement('option');
      none.value = ''; none.textContent = '— keines —';
      ps.appendChild(none);
    }
    profile.forEach(p => {
      const o = document.createElement('option');
      const type = p.substring(0, 3);
      const variant = p.substring(3);
      o.value = p;
      o.textContent = `${sigLinDeLabels[type] || type} · Variante ${variant} (${p})`;
      o.title = `${p}: ${sigLinDeLabels[type] || type}, SigLinDe-Ausprägung ${variant}`;
      // Standardwerte: Profil 1 = GBH34 (Unterkunft/Beherbergung), Profil 2 = GBD34 (Gebietskörperschaft)
      if (idx === 0 && p === 'GBH34') o.selected = true;
      if (idx === 1 && p === 'GBD34') o.selected = true;
      ps.appendChild(o);
    });
  });
  // Strg+V in Monatswerte-Tabelle
  document.getElementById('gl-m0').addEventListener('paste', glPasteMonatswerte);
  // Gewichtung explizit setzen (verhindert Browser-Autocomplete-Überschreibung)
  document.getElementById('gl-gew1').value = 50;
  document.getElementById('gl-gew2').value = 50;
  // Geo-Standardwerte explizit setzen (verhindert Browser-Autocomplete-Überschreibung)
  document.getElementById('geo-tiefe').value   = 100;
  document.getElementById('geo-abstand').value = 10;
  document.getElementById('geo-q-perm').value  = 31;
  document.getElementById('geo-lambda').value  = 2.0;
  if (document.getElementById('geo-guetegrad'))  document.getElementById('geo-guetegrad').value  = 0.50;
  if (document.getElementById('lwwp-guetegrad')) document.getElementById('lwwp-guetegrad').value = 0.42;
  if (document.getElementById('fg-guetegrad'))   document.getElementById('fg-guetegrad').value   = 0.50;
  glOnStadtChange();
}

export function glOnStadtChange() {
  const plz = document.getElementById('gl-plz')?.value;
  if (plz && BWP_KLIMA_PLZ[plz]) glSetKlimaPlz(plz, true);
  else syncNormAussentemperatur(true);
  glUpdateKlimaStatus();
  glBerechnenDebounced(600);
}

export function glSetKlimaPlz(rawPlz, recalculate = true) {
  const input = document.getElementById('gl-plz');
  const status = document.getElementById('gl-plz-status');
  const plz = String(rawPlz ?? '').replace(/\D/g, '').slice(0, 5);
  if (input && input.value !== plz) input.value = plz;
  const values = BWP_KLIMA_PLZ[plz];
  if (!values) {
    if (status) {
      status.textContent = plz.length === 5
        ? 'Für diese PLZ weist die BWP-Karte keinen Wert aus'
        : 'Für PLZ-genaue DIN-Zuordnung';
      status.style.color = plz.length === 5 ? '#f9a825' : 'var(--muted)';
    }
    return false;
  }
  const [normAt, annualMean] = values;
  document.getElementById('gl-norm-at').value = normAt;
  document.getElementById('netz-t-aussen').value = normAt;
  const meanInput = document.getElementById('netz-t-mittel');
  if (meanInput) meanInput.value = annualMean;
  if (status) {
    status.textContent = `✓ offizieller PLZ-Wert · Stand ${BWP_KLIMA_META.retrievedAt}`;
    status.style.color = '#81c784';
  }
  const source = document.getElementById('gl-norm-source');
  if (source) source.textContent = 'BWP · DIN/TS 12831-1';
  if (recalculate) {
    recalcNetz();
    glBerechnenDebounced(300);
  }
  return true;
}

export function syncNormAussentemperatur(recalculate = false) {
  const s = document.getElementById('gl-stadt').value;
  const d = CalcEngine.STAEDTE[s];
  if (d) {
    const normAt = Number(d.tNorm);
    const grundlagen = document.getElementById('gl-norm-at');
    const netz = document.getElementById('netz-t-aussen');
    if (grundlagen) grundlagen.value = normAt;
    if (netz) netz.value = normAt;
    const source = document.getElementById('gl-norm-source');
    if (source) source.textContent = 'Standort-Näherung · Projekt-PLZ ergänzen';
    if (recalculate && typeof recalcNetz === 'function') recalcNetz();
  }
}

// ── DWD-Klimadaten laden (dynamisch via <script>) ─────────────────────────
export const _klimaLoaded = new Set(); // bereits geladene Städte

export function glJsFilename(stadtname) {
  return stadtname
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
    .replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue')
    .replace(/ /g,'_').replace(/\./g,'');
}

async function glLadeKlimaDaten(stadtname) {
  if (_klimaLoaded.has(stadtname)) return;
  if (window.KLIMA_DATA && window.KLIMA_DATA[stadtname]) { _klimaLoaded.add(stadtname); return; }
  // Im Single-File-Build existiert kein data/klima/-Verzeichnis → direkt false zurückgeben
  // (Aufrufer fällt auf TRY-Kassel-Fallback zurück; verhindert ERR_FILE_NOT_FOUND im Log)
  if (window._isSingleFileBuild) return false;
  const fname = `data/klima/${glJsFilename(stadtname)}.js`;
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = fname;
    s.onload  = () => { _klimaLoaded.add(stadtname); resolve(true); };
    s.onerror = () => { resolve(false); };
    document.head.appendChild(s);
  });
}

export function glDecodeKlimaB64(b64) {
  // base64 → gzip → Int16Array → Float32Array (÷10)
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes); writer.close();
  // synchron ist DecompressionStream nicht möglich → async
  return ds.readable;
}

// { tempH: Float32Array, fallback: bool }
export async function glGetTempH(stadtname, jahr) {
  const loaded = await glLadeKlimaDaten(stadtname);
  const data   = window.KLIMA_DATA?.[stadtname]?.[jahr];
  if (!data) {
    // Kein DWD-Datensatz → Fallback auf TRY Kassel (keine Kosinus-Synthese)
    const fallbackTemp = await CalcEngine.ladeTRYKassel();
    return { tempH: fallbackTemp, fallback: true };
  }

  // gzip-dekomprimieren (DecompressionStream, async)
  const b64 = data.replace(/\s/g,'');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const ds     = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes); writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) { const {done, value} = await reader.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const buf   = new Uint8Array(total);
  let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }

  const int16  = new Int16Array(buf.buffer);
  const result = new Float32Array(8760);
  for (let i = 0; i < 8760; i++) result[i] = int16[i] / 10;
  return { tempH: result, fallback: false };
}

export function glUpdateKlimaStatus(isFallback) {
  const stadt = document.getElementById('gl-stadt').value;
  const jahr  = document.getElementById('gl-klimajahr').value;
  const el    = document.getElementById('gl-klima-status');
  if (!el) return;
  if (isFallback) {
    el.textContent = `⚠ Keine DWD-Daten für ${stadt} – Fallback: TRY Kassel`;
    el.style.color = '#f9a825';
  } else {
    const verfuegbar = window.KLIMA_DATA?.[stadt]?.[jahr];
    if (verfuegbar) {
      el.textContent = `✓ DWD-Daten vorhanden`;
      el.style.color = '#81c784';
    } else {
      el.textContent = `⚠ Keine DWD-Daten – download_dwd_klima.py ausführen`;
      el.style.color = '#f9a825';
    }
  }
}

// ── Panel-Toggle ──────────────────────────────────────────────────────────
export function toggleGrundlagenPanel() {
  const p = document.getElementById('grundlagen-panel');
  const btn = document.getElementById('btn-grundlagen-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) { p.classList.add('visible'); btn.classList.add('active'); }
}

export function toggleAnalysePanel() {
  const p = document.getElementById('analyse-panel');
  const btn = document.getElementById('btn-analyse-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) {
    p.classList.add('visible');
    btn.classList.add('active');
    saSetTab(saCurrentTab || 'lastgang');
    // Lastgang synthetisieren falls noch nicht geschehen
    if (!window.systemState && glKannBerechnen()) glBerechnenDebounced(100);
  }
}

export function toggleWirtschaftPanel() {
  const p = document.getElementById('wirtschaft-panel');
  const btn = document.getElementById('btn-wirtschaft-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) {
    p.classList.add('visible');
    btn.classList.add('active');
    calcWirtschaftPanel();
  }
}

export function toggleStromPanel() {
  const p = document.getElementById('strom-panel');
  const btn = document.getElementById('btn-strom-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) {
    p.classList.add('visible');
    btn?.classList.add('active');
    calcStromPanel();
    if (!window.systemState && glKannBerechnen()) glBerechnenDebounced(100);
  }
}

// ── Monatswerte: Ctrl+V einfügen ─────────────────────────────────────────
export function glPasteMonatswerte(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text');
  // Werte extrahieren: Trenner Tab, Semikolon, Komma oder Zeilenumbruch
  const vals = text.split(/[\t\n\r;,]+/)
    .map(v => v.trim().replace(',', '.'))
    .filter(v => v !== '' && !isNaN(parseFloat(v)))
    .map(v => parseFloat(v))
    .slice(0, 12);
  vals.forEach((v, i) => {
    const el = document.getElementById('gl-m' + i);
    if (el) el.value = v;
  });
  glMonatChange();
}

export function glMonatChange() {
  const sum = glGetMonatswerte().reduce((a, b) => a + (b || 0), 0);
  const el = document.getElementById('gl-monats-sum');
  el.textContent = sum > 0 ? Math.round(sum).toLocaleString('de-DE') + ' MWh' : '—';
  glUpdateStatus();
}

export function glGetMonatswerte() {
  return Array.from({length: 12}, (_, i) => {
    const v = parseFloat(document.getElementById('gl-m' + i).value);
    return isNaN(v) ? null : v;
  });
}

export function glGetGesamtMwh() {
  return parseFloat(document.getElementById('gl-gesamt').value) || null;
}

// ── CSV Upload ────────────────────────────────────────────────────────────
export function glDragOver(e) { e.preventDefault(); document.getElementById('gl-upload-zone').classList.add('drag-over'); }
export function glDragLeave(e) { document.getElementById('gl-upload-zone').classList.remove('drag-over'); }
export function glDrop(e) {
  e.preventDefault();
  document.getElementById('gl-upload-zone').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) glFileSelected(f);
}

export function glFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    glRawCsv = ev.target.result;
    glDetectColumns(glRawCsv, file.name);
  };
  reader.readAsText(file, 'utf-8');
}

export function glDetectColumns(csv, filename) {
  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 10) { glSetUploadError('Zu wenige Zeilen in der Datei.'); return; }

  // Trennzeichen ermitteln
  const sep = lines[1].includes(';') ? ';' : lines[1].includes('\t') ? '\t' : ',';
  const firstDataLine = lines.find(l => /\d/.test(l));
  const cols = firstDataLine ? firstDataLine.split(sep).length : 1;

  if (cols === 1) {
    // Einspaltig → direkt parsen
    document.getElementById('gl-col-select-wrap').style.display = 'none';
    glColHeaders = [];
    glParseLastgang(csv, sep, 0);
  } else {
    // Mehrspaltig → Kopfzeile analysieren, Auswahl anbieten
    const headerLine = lines[0];
    const headers = headerLine.split(sep).map(h => h.trim().replace(/^["']|["']$/g, ''));
    glColHeaders = headers;
    const sel = document.getElementById('gl-col-select');
    sel.innerHTML = '';
    headers.forEach((h, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = `Spalte ${i+1}: ${h}`;
      // Auto-Select: erste Spalte die nach kW/Leistung aussieht
      if (/kw|leistung|wärme|waerme|last|power|heat/i.test(h)) o.selected = true;
      sel.appendChild(o);
    });
    document.getElementById('gl-col-select-wrap').style.display = 'block';
    glRawCsv = csv;
    glParseLastgang();
  }
}

export function glParseLastgang(csvOverride, sepOverride, colOverride) {
  const csv = csvOverride || glRawCsv;
  if (!csv) return;

  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '');
  const sep = sepOverride || (lines[1]?.includes(';') ? ';' : lines[1]?.includes('\t') ? '\t' : ',');
  const colIdx = colOverride !== undefined ? colOverride
    : parseInt(document.getElementById('gl-col-select').value) || 0;

  // Zahlenformat erkennen: Punkt als Tausendertrennzeichen (deutsch) oder Dezimalzeichen?
  // Heuristik: Wenn in den ersten gültigen Werten ein Muster "X.XXX" ohne Komma vorkommt
  // (genau 3 Stellen nach dem letzten Punkt) → Punkt ist Tausendertrenner
  function parseDeNumber(raw) {
    const s = (raw || '').trim().replace(/['"]/g, '');
    if (!s) return NaN;
    // Enthält Komma → deutsches Format: Punkt=Tausender, Komma=Dezimal
    if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    // Nur Punkt vorhanden: prüfen ob Tausendertrenner
    // Muster: optional Ziffern, dann (Punkt gefolgt von genau 3 Ziffern)+, optional Ende
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
    // Sonst: normales Dezimalkomma (englisch)
    return parseFloat(s);
  }

  // Zeilen mit Zahlen extrahieren
  const values = [];
  for (const line of lines) {
    const parts = line.split(sep);
    const v = parseDeNumber(parts[colIdx]);
    if (!isNaN(v)) values.push(v);
  }

  const n = values.length;
  if (n !== 8760 && n !== 8784) {
    glSetUploadError(`${n} Werte gefunden — erwartet werden genau 8760 (Normaljahr) oder 8784 (Schaltjahr). Fehlende Stunden werden nicht mehr still aufgefüllt.`);
    return;
  }
  const normalized = normalizeHourlyYear(values, {source: 'measured'});
  const arr = normalized.values;
  glTimeSeriesMeta = normalized.meta;

  glRawData = arr;
  glLastgangKw = arr;

  // UI aktualisieren
  const pMax = Math.max(...arr);
  const sumMwh = arr.reduce((a, b) => a + b, 0) / 1000;
  document.getElementById('gl-upload-zone').classList.add('loaded');
  document.getElementById('gl-upload-info').textContent =
    `${n} Messwerte · ${glTimeSeriesMeta.quality}${n === 8784 ? ' · 29. Februar kalenderkorrekt entfernt' : ''} · P_max ${Math.round(pMax).toLocaleString('de-DE')} kW · ${Math.round(sumMwh).toLocaleString('de-DE')} MWh/a`;

  glAutoNetzverlust(arr);
  glRenderPreview(arr, pMax);
  glBerechnenAuto();
}

// ── Energiesplit-Chart: Raumwärme / TWW / Netzverluste ────────────────────
export function glRenderSplit(lastgangKw, verlustPct) {
  const section = document.getElementById('gl-split-section');
  const canvas  = document.getElementById('gl-split-canvas');
  if (!section || !canvas || !lastgangKw || lastgangKw.length < 8760) return;

  section.style.display = '';
  canvas.width = canvas.offsetWidth || 500;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Monatsgrenzen (Tage, nicht-Schaltjahr)
  const MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const MLBL  = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const mStart = []; let acc = 0;
  MDAYS.forEach(d => { mStart.push(acc * 24); acc += d; });

  // Monatliche Gesamtenergie (kWh)
  const mTotal = new Array(12).fill(0);
  for (let m = 0; m < 12; m++) {
    const h0 = mStart[m], h1 = m < 11 ? mStart[m+1] : 8760;
    for (let h = h0; h < h1; h++) mTotal[m] += lastgangKw[h];
  }

  // TWW-Schätzung: Sommer-Monate (Jun=5,Jul=6,Aug=7) netto nach Verlusten
  // = verbleibende Last ohne Raumwärme → Trinkwarmwasser
  const vf = (verlustPct || 0) / 100;
  const summerNetKwh = (mTotal[5] + mTotal[6] + mTotal[7]) / 3 * (1 - vf);
  // Auf alle Monate gleich verteilt (TWW = konstante Jahreslast)
  const mTww = MDAYS.map(d => Math.min(summerNetKwh, mTotal[0])); // cap: nie mehr als Januarverbrauch

  // Netzverluste pro Monat
  const mVerlust = mTotal.map(e => e * vf);

  // Raumwärme = Rest
  const mRW = mTotal.map((e, i) => Math.max(0, e - mVerlust[i] - mTww[i]));

  const pMax = Math.max(...mTotal);
  if (pMax <= 0) return;

  const ML = 38, MB = 18, MT = 6, barGap = 2;
  const PW = W - ML, PH = H - MB - MT;
  const bw = Math.floor(PW / 12) - barGap;
  const scl = v => (v / pMax) * PH;

  // Hintergrund
  ctx.fillStyle = '#13151f';
  ctx.fillRect(0, 0, W, H);

  // Gitterlinien + Y-Labels
  ctx.font = '8px monospace';
  ctx.textAlign = 'right';
  [25, 50, 75, 100].forEach(pct => {
    const y = MT + PH - scl(pMax * pct / 100);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(Math.round(pMax * pct / 100 / 1000) + ' MWh', ML - 2, y + 3);
  });

  // Balken zeichnen
  for (let m = 0; m < 12; m++) {
    const x = ML + m * (bw + barGap);
    let y = MT + PH;

    // Netzverluste (unten, blaugrau)
    const hV = scl(mVerlust[m]);
    ctx.fillStyle = '#78909c';
    ctx.fillRect(x, Math.round(y - hV), bw, Math.max(1, Math.ceil(hV)));
    y -= hV;

    // Raumwärme (mitte, rot)
    const hR = scl(mRW[m]);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(x, Math.round(y - hR), bw, Math.max(1, Math.ceil(hR)));
    y -= hR;

    // TWW (oben, orange)
    const hT = scl(mTww[m]);
    ctx.fillStyle = '#ff8a65';
    ctx.fillRect(x, Math.round(y - hT), bw, Math.max(1, Math.ceil(hT)));

    // Monatslabel
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(MLBL[m], x + bw / 2, H - 3);
  }

  // Jahres-KPIs
  const totMwh   = mTotal.reduce((a,b)=>a+b,0) / 1000;
  const verlMwh  = mVerlust.reduce((a,b)=>a+b,0) / 1000;
  const twwMwh   = mTww.reduce((a,b)=>a+b,0) / 1000;
  const rwMwh    = mRW.reduce((a,b)=>a+b,0) / 1000;
  const kpi = document.getElementById('gl-split-kpi');
  if (kpi) {
    const fmt = v => Math.round(v).toLocaleString('de-DE');
    const pct = (v, t) => t > 0 ? ' (' + Math.round(v/t*100) + ' %)' : '';
    kpi.innerHTML =
      `<span style="color:#e53935;">Raumwärme: <b>${fmt(rwMwh)} MWh/a</b>${pct(rwMwh,totMwh)}</span>` +
      `<span style="color:#ff8a65;">TWW: <b>${fmt(twwMwh)} MWh/a</b>${pct(twwMwh,totMwh)} <span style="color:var(--muted);font-size:9px;">(Schätzung)</span></span>` +
      `<span style="color:#90a4ae;">Netzverluste: <b>${fmt(verlMwh)} MWh/a</b>${pct(verlMwh,totMwh)}</span>`;
  }
}

// ── Netzverlust-Autoberechnung aus sommerlicher Nacht-Grundlast ────────────
// Logik: Jun–Aug, 2–5 Uhr = keine Raumwärme → verbleibende Last = Netzverluste
// 10%-Quantil der Sommer-Nacht-Stunden = robuster Schätzer der Verlustniveau
export function glAutoNetzverlust(arr) {
  const n = arr.length;
  const jahresKwh = arr.reduce((a, b) => a + b, 0);
  if (jahresKwh <= 0) return;

  // Sommer-Nacht-Stunden sammeln: Tag 151–242 (Jun–Aug, 0-basiert), Stunde 2–5
  const vals = [];
  for (let h = 0; h < n; h++) {
    const day = Math.floor(h / 24);
    const hr  = h % 24;
    if (day >= 151 && day <= 242 && hr >= 2 && hr <= 5) vals.push(arr[h]);
  }
  if (vals.length < 10) return;

  // 10%-Quantil: robuster gegen einzelne Ausreißer (Messfehler, Spitzenlasten)
  vals.sort((a, b) => a - b);
  const grundlastKw = vals[Math.floor(vals.length * 0.10)];
  if (grundlastKw < 0) return;

  // Netzverlust-Anteil: Grundlast × 8760h / Jahresenergie
  const verlustPct = Math.max(1, Math.min(35, Math.round(grundlastKw * 8760 / jahresKwh * 100)));

  document.getElementById('gl-netzverlust').value = verlustPct;
  const hint = document.getElementById('gl-netzverlust-hint');
  if (hint) hint.textContent = `auto · ${Math.round(grundlastKw)} kW Grundlast`;
}

export function glSetUploadError(msg) {
  document.getElementById('gl-upload-info').textContent = '⚠ ' + msg;
  document.getElementById('gl-upload-zone').classList.remove('loaded');
  document.getElementById('gl-preview-wrap').style.display = 'none';
  glRawData = null; glLastgangKw = null; glTimeSeriesMeta = null;
  glUpdateStatus();
}

// ── Vorschau-SVG ──────────────────────────────────────────────────────────
export function glClearLastgang() {
  glRawCsv = null;
  glRawData = null;
  glLastgangKw = null;
  glTimeSeriesMeta = null;
  glColHeaders = [];
  document.getElementById('gl-upload-zone').classList.remove('loaded');
  document.getElementById('gl-upload-info').textContent = '';
  document.getElementById('gl-file-input').value = '';
  document.getElementById('gl-col-select-wrap').style.display = 'none';
  document.getElementById('gl-preview-wrap').style.display = 'none';
  glBerechnenAuto();
}

export function glRenderPreview(arr, pMax) {
  const W = 400, H = 60, pad = 2;
  const iW = W - pad * 2, iH = H - pad * 2;
  const n = arr.length;
  const step = Math.max(1, Math.floor(n / iW));

  // Jahresdauerlinie (sortiert)
  const sorted = Float32Array.from(arr).sort((a, b) => b - a);
  const pts = [];
  for (let x = 0; x < iW; x++) {
    const idx = Math.round(x * (n - 1) / iW);
    const y = pad + iH - (sorted[idx] / pMax) * iH;
    pts.push(`${pad + x},${y}`);
  }
  // Zeitverlauf (dünn, dahinter)
  const tpts = [];
  for (let x = 0; x < iW; x++) {
    const idx = Math.round(x * (n - 1) / iW);
    // Glättung: Mittelwert aus step Werten
    let sum = 0;
    for (let j = 0; j < step && idx + j < n; j++) sum += arr[idx + j];
    const v = sum / step;
    const y = pad + iH - (v / pMax) * iH;
    tpts.push(`${pad + x},${y}`);
  }

  const svgContent = `
    <polyline points="${tpts.join(' ')}" fill="none" stroke="#2a3050" stroke-width="1"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="#81c784" stroke-width="1.2"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${pad+iH}" stroke="#2a3050" stroke-width="0.5"/>
    <line x1="${pad}" y1="${pad+iH}" x2="${pad+iW}" y2="${pad+iH}" stroke="#2a3050" stroke-width="0.5"/>
    <text x="${pad+2}" y="${pad+8}" fill="#81c784" font-size="7">${Math.round(pMax)} kW</text>
    <text x="${pad+iW-2}" y="${pad+iH-2}" fill="#7a8099" font-size="7" text-anchor="end">Grün: Dauerlinie · Grau: Zeitverlauf</text>`;

  document.getElementById('gl-preview-svg').innerHTML = svgContent;
  document.getElementById('gl-preview-title').textContent =
    `Vorschau: ${Math.round(arr.reduce((a,b)=>a+b,0)/1000).toLocaleString('de-DE')} MWh/a`;
  document.getElementById('gl-preview-wrap').style.display = 'block';
}

// ── Status-Anzeige ────────────────────────────────────────────────────────
export function glUpdateStatus() {
  const hatLastgang = !!glLastgangKw;
  const monatswerte = glGetMonatswerte();
  const hatMonat = monatswerte.some(v => v !== null);
  const gesamt = glGetGesamtMwh();
  const monatSum = monatswerte.reduce((a, b) => a + (b || 0), 0);

  let fall = 0, text = '', color = 'empty';

  if (hatLastgang && !hatMonat) {
    fall = 1; text = 'Fall 1: Lastgang direkt'; color = 'ok';
  } else if (hatLastgang && hatMonat) {
    fall = 2; text = 'Fall 2: Lastgang + gleitende Monatsskalierung'; color = 'ok';
  } else if (!hatLastgang && hatMonat && (!gesamt || Math.abs(gesamt - monatSum) < 1)) {
    fall = 3; text = `Fall 3: Monatswerte → SigLinDe-Synthese (${Math.round(monatSum)} MWh/a)`; color = 'ok';
  } else if (!hatLastgang && hatMonat && gesamt && gesamt > monatSum + 1) {
    fall = 4; text = `Fall 4: Gesamtverbrauch (${Math.round(gesamt)} MWh) + Monatswerte als Floor`; color = 'ok';
  } else if (!hatLastgang && !hatMonat && gesamt) {
    fall = 5; text = `Fall 5: Reine SigLinDe-Synthese (${Math.round(gesamt)} MWh/a)`; color = 'ok';
  } else {
    text = 'Bitte Energiebedarf oder Lastgang eingeben.'; color = 'empty';
  }

  document.getElementById('gl-status-dot').className = `gl-status-dot ${color}`;
  document.getElementById('gl-status-text').textContent = text;
  const badge = document.getElementById('gl-fall-badge');
  if (fall > 0) {
    badge.style.display = ''; badge.textContent = `Fall ${fall}`;
  } else {
    badge.style.display = 'none';
  }

  // Irrelevante Sektionen ausblenden
  const slpSection = document.getElementById('gl-slp-section');
  const gesamtRow = document.getElementById('gl-gesamt-row');
  if (slpSection) slpSection.style.display = hatLastgang ? 'none' : '';
  if (gesamtRow) gesamtRow.style.display = hatLastgang ? 'none' : '';
}
