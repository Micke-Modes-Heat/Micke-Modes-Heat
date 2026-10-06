// ── 05a-export.js — CSV-Export, PDF-Report, Druckansicht ──
// ── Export: Dispatch CSV ──────────────────────────────────────────────────
import { activeVariantId, baseStromNetzSnapshot, gebaeude, globalYear, netzEdges, varianten, variantenName, aktiverVariantenName, updateVizDebounced } from './01-globals-varianten.js';
import { getComputedStats, updateField, calcAutoEnergy } from './02b-gebaeude.js';
import { updateLpMeritOrder, updateLpNetzSummary } from './04a-ui-panels.js';
import { updateLpStromSummary } from './05b-stromnetz.js';
import { DA_LABELS } from './07a-analysis-charts.js';
import { ASSETS, getAssetStatus, ASSET_PROPS_SCHEMA } from './13a-assets-core.js';
import { stromEdges, stromNodes, variantResults } from './01-globals-varianten.js';
import { getGebStromMwh } from './02b-gebaeude.js';
import { recalcNetz } from './03b-netz.js';
import { escHtml, renderList, projektExportFilename, getProjektName, updateTotals, updateGebPv } from './03c-gebaeude-io.js';
import { renderSidebarAssetList } from './13e-assets-inspector.js';
import { getElSlpProfiles } from './13k-elslp-registry.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { KABEL_TYPEN } from './config/netz-kosten.js';
import { parseKabelLabel } from './lib/kabel-label.js';
import { SCHICHT_META, normSchicht } from './lib/schichten.js';
import { normalisiereNotstrom } from './lib/resilienz-core.js';
import { createId } from './lib/util.js';
import { istLeer, xNum, xInt, xStr, xBool, janein, kopfIndex, zahlGeaendert, textGeaendert, xAuswahl,
  propZuZelle, zelleZuProp, propGeaendert, zielParameterText, zielParameterLesen, zielParameterGleich,
  GILT_ALLE, geltungText, geltungLesen } from './lib/xlsx-abgleich.js';
import { createCalculationManifest } from './lib/calculation-manifest.js';
import { getPvTariffProvenance } from './config/tariff-scenarios.js';
import { getEconomicScenarioProvenance } from './config/economic-scenarios.js';
import { syntheticPvProfileMeta } from './lib/pv-profile-import.js';
import { glTimeSeriesMeta } from './06a-gbi-lastgang.js';
import { appLifecycle } from './lib/lifecycle.js';

const ASSET_LABELS = {
  NAP: 'Netzanschlusspunkt', Trafo: 'Transformator', Schaltanlage: 'Schaltanlage',
  NSHV: 'NSHV', UV: 'Unterverteilung', KVS: 'KVS', Verbraucher: 'Verbraucher',
  WP: 'Wärmepumpe', PV: 'PV-Anlage', Batterie: 'Batteriespeicher', H2: 'Wasserstoffspeicher',
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
  a.download = projektExportFilename('dispatch', 'csv');
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
  a.download = projektExportFilename('gebaeude', 'csv');
  a.click();
}

// ── Export: Anonymisierter Gutachten-Digest (Markdown) ─────────────────────
// Liefert eine ANONYMISIERTE, aggregierte Datengrundlage als Markdown entlang der
// Gutachten-Gliederung (1–6). Gedacht als Vorlage für einen KI-gestützten
// Gutachten-Entwurf: die KI textet die Prosa, der Ingenieur korrigiert.
//   Anonymisiert  → keine Gebäudenamen, Adressen, Koordinaten, OSM-IDs.
//   Aggregiert    → Gebäude werden zu Nutzungs-/Baualtersklassen verdichtet.
//   Platzhalter   → [zu ergänzen: …] markiert Stellen für die fachliche Bewertung.
const _GUT_NUTZUNG_LABEL = {
  efh:'Einfamilienhaus', mfh:'Mehrfamilienhaus', ghd:'Gewerbe/Handel', gewerbe:'Gewerbe',
  schule:'Schule', buero:'Büro', industrie:'Industrie',
  oeffentlich:'Öffentliches Gebäude', wohnen:'Wohnen',
  krankenhaus:'Krankenhaus', hotel:'Hotel/Beherbergung', unbekannt:'Unbekannt',
  unterkunft:'Unterkunft / Gemeinschaftsunterkunft', wohnheim:'Wohnheim / Internat', kaserne:'Kaserne / Unterkunftsgebäude',
  pflegeheim:'Pflege- / Seniorenheim', kita:'Kindertagesstätte', hochschule:'Hochschule / Akademie',
  verwaltung:'Verwaltung / Rathaus', polizei:'Polizei / Sicherheitsdienst', feuerwehr:'Feuerwehr', rettungswache:'Rettungswache',
  justiz:'Gericht / Justiz / Vollzug', arztpraxis:'Arztpraxis / Ambulanz', sporthalle:'Sport- / Turnhalle',
  schwimmbad:'Schwimmbad', kultur:'Kultur- / Veranstaltungsgebäude', bibliothek:'Bibliothek / Archiv', sakral:'Sakralgebäude',
  kantine:'Kantine / Großküche', werkstatt:'Werkstatt / Instandhaltung', lager:'Lager / Depot',
  technik:'Technik- / Betriebsgebäude', labor:'Labor / Forschung',
};
function _gutBaualtersklasse(bj) {
  if (!bj || isNaN(bj)) return 'unbekannt';
  if (bj < 1919) return 'bis 1918';
  if (bj < 1949) return '1919–1948';
  if (bj < 1979) return '1949–1978';
  if (bj < 1995) return '1979–1994';
  if (bj < 2010) return '1995–2009';
  return 'ab 2010';
}

export function exportGutachtenDigest() {
  const fmt  = (v, d = 0) => Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct  = (a, b) => (b > 0 ? (a / b * 100) : 0);
  const geb  = Array.isArray(gebaeude) ? gebaeude : [];
  const jahr = globalYear || new Date().getFullYear();
  const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

  // ── Pro Gebäude: berechnete Kennzahlen einsammeln (ohne identifizierende Felder) ──
  const stats = geb.map(g => {
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    return {
      nutzung:  g.nutzung || 'unbekannt',
      flaeche:  parseFloat(g.flaeche) || 0,
      waerme:   parseFloat(st.waerme ?? g.waerme) || 0,
      heizlast: parseFloat(st.heizlast ?? g.heizlast) || 0,
      strom:    typeof getGebStromMwh === 'function' ? (getGebStromMwh(g) || 0) : (parseFloat(g.strom) || 0),
      baualter: _gutBaualtersklasse(parseInt(g.baujahr)),
      pvAktiv:  !!g.pvAktiv,
    };
  });
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const totFlaeche  = sum(stats, s => s.flaeche);
  const totWaerme   = sum(stats, s => s.waerme);
  const totHeizlast = sum(stats, s => s.heizlast);
  const totStrom    = sum(stats, s => s.strom);

  // ── Wärmenetz-Kennzahlen ──
  const edges = Array.isArray(netzEdges) ? netzEdges.filter(e => !e.pruned) : [];
  const trasseLaenge = Math.round(edges.reduce((s, e) => s + (e.length || 0), 0));
  const connectedIds = new Set(edges.flatMap(e => [e.u, e.v]));
  const nAngeschlossen = geb.filter(g => connectedIds.has(g.id)).length;
  const vl = document.getElementById('netz-vl')?.value || '—';
  const rl = document.getElementById('netz-rl')?.value || '—';

  // ── Aggregation ──
  const aggBy = (keyFn) => {
    const acc = {};
    stats.forEach(s => {
      const k = keyFn(s);
      if (!acc[k]) acc[k] = { count: 0, flaeche: 0, waerme: 0 };
      acc[k].count++; acc[k].flaeche += s.flaeche; acc[k].waerme += s.waerme;
    });
    return acc;
  };
  const byNutzung  = aggBy(s => s.nutzung);
  const byBaualter = aggBy(s => s.baualter);

  // ── Elektro-Assets aggregieren (anonym, ohne Koordinaten) ──
  const assets = (typeof ASSETS !== 'undefined' && Array.isArray(ASSETS.items)) ? ASSETS.items : [];
  const assetByType = {};
  assets.forEach(a => { assetByType[a.type] = (assetByType[a.type] || 0) + 1; });
  const trafoKva = assets.filter(a => a.type === 'Trafo').reduce((s, a) => s + (parseFloat(a.props?.leistungKVA) || 0), 0);
  const pvKwp    = assets.filter(a => a.type === 'PV').reduce((s, a) => s + (parseFloat(a.props?.leistungKWp) || 0), 0);
  const battKwh  = assets.filter(a => a.type === 'Batterie').reduce((s, a) => s + (parseFloat(a.props?.kapazitaetKWh) || 0), 0);

  // ── Varianten ──
  const vrKeys = (typeof variantResults !== 'undefined') ? Object.keys(variantResults) : [];

  // ════════════════════════════════════════════════════════════════════════
  // Markdown aufbauen
  // ════════════════════════════════════════════════════════════════════════
  let md = '';
  const L = (s = '') => { md += s + '\n'; };

  L('# Kennzahlen-Digest — anonymisierte Datengrundlage für den Gutachten-Entwurf');
  L('');
  L('> **Hinweis:** Diese Datei fasst die Projektkennzahlen anonymisiert (keine Gebäudenamen,');
  L('> Adressen, Koordinaten) und aggregiert zusammen, strukturiert entlang der Gutachten-');
  L('> Gliederung. Sie dient als Arbeitsgrundlage für den Gutachten-*Entwurf*: Zahlen unverändert');
  L('> übernehmen, keine Werte erfinden, offene Stellen mit `[zu ergänzen: …]` kennzeichnen.');
  L('');
  L(`*Betrachtungsjahr:* ${jahr}  ·  *Gebäude:* ${geb.length}  ·  *Stand:* ${today}`);
  L('');
  L('---');
  L('');

  // ── 1 EINLEITUNG ──
  L('## 1 Einleitung');
  L('');
  L('### 1.1 Ziele und Grundsätze');
  L('[zu ergänzen: Anlass, Zielsetzung und methodische Grundsätze des Gutachtens.]');
  L('');
  L('### 1.2 Liegenschaftsinformationen');
  L('');
  L(`Die Liegenschaft umfasst **${geb.length} Gebäude** mit einer Gesamtfläche von `
    + `**${fmt(totFlaeche)} m²**. Der jährliche Wärmebedarf beträgt **${fmt(totWaerme)} MWh/a**, `
    + `die Gesamtheizlast **${fmt(totHeizlast)} kW**, der Strombedarf **${fmt(totStrom, 1)} MWh/a**.`);
  L('');
  L('**Nutzungsstruktur:**');
  L('');
  L('| Nutzung | Anzahl | Fläche m² | Wärme MWh/a | Anteil Wärme % |');
  L('|---|---:|---:|---:|---:|');
  Object.keys(byNutzung).sort((a, b) => byNutzung[b].waerme - byNutzung[a].waerme).forEach(k => {
    const d = byNutzung[k];
    L(`| ${_GUT_NUTZUNG_LABEL[k] || k} | ${d.count} | ${fmt(d.flaeche)} | ${fmt(d.waerme, 1)} | ${fmt(pct(d.waerme, totWaerme), 1)} |`);
  });
  L('');
  L('**Baualtersstruktur:**');
  L('');
  L('| Baualtersklasse | Anzahl | Fläche m² | Wärme MWh/a |');
  L('|---|---:|---:|---:|');
  ['bis 1918', '1919–1948', '1949–1978', '1979–1994', '1995–2009', 'ab 2010', 'unbekannt'].forEach(k => {
    const d = byBaualter[k]; if (!d) return;
    L(`| ${k} | ${d.count} | ${fmt(d.flaeche)} | ${fmt(d.waerme, 1)} |`);
  });
  L('');
  L('[zu ergänzen: Bedeutung/Funktion der Liegenschaft, geplante Liegenschaftsentwicklung.]');
  L('');

  // ── 2 WÄRME ──
  L('## 2 Wärme');
  L('');
  L('### 2.1 Ist-Zustand');
  L('');
  L(`- Wärmebedarf gesamt: **${fmt(totWaerme)} MWh/a**`);
  L(`- Heizlast gesamt: **${fmt(totHeizlast)} kW**`);
  L(`- Spez. Wärmebedarf (Mittel): **${fmt(totFlaeche > 0 ? totWaerme * 1000 / totFlaeche : 0, 0)} kWh/m²a**`);
  L('');
  L('[zu ergänzen: Beschreibung der bestehenden Wärmeerzeugung, des Versorgungsnetzes und der Hausstationen.]');
  L('');
  L('### 2.2 Soll-Zustand (Wärmenetz)');
  L('');
  if (trasseLaenge > 0) {
    L(`- Trassenlänge (geplant/aktiv): **${fmt(trasseLaenge)} m**`);
    L(`- Anschlussgrad: **${nAngeschlossen} von ${geb.length} Gebäuden** (${fmt(pct(nAngeschlossen, geb.length), 0)} %)`);
    L(`- Netztemperaturen VL/RL: **${vl}/${rl} °C**`);
  } else {
    L('[zu ergänzen: Es ist noch kein Wärmenetz konfiguriert. Auslegung WEA, Versorgungsnetz, Hausstationen.]');
  }
  L('');
  L('### 2.3 Analyse möglicher Energiequellen und Technologien');
  L('[zu ergänzen: Energieträger/-quellen, Technologien, Energiespeicher.]');
  L('');
  L('### 2.4 Mögliche Varianten');
  L('');
  if (vrKeys.length) {
    vrKeys.forEach(k => {
      const v = variantResults[k];
      L(`**${v.label || k}**`);
      if (Array.isArray(v.erzeuger) && v.erzeuger.length) {
        L('');
        L('| Erzeuger | Leistung kW |');
        L('|---|---:|');
        v.erzeuger.forEach(e => L(`| ${e.typ} | ${e.leistungKw ? fmt(e.leistungKw) : '—'} |`));
        L('');
      } else {
        L('[zu ergänzen: Erzeugerzusammensetzung]');
        L('');
      }
    });
  } else {
    L('[zu ergänzen: Es wurden noch keine Varianten gerechnet — bitte im Tool Varianten anlegen und durchrechnen.]');
    L('');
  }
  L('### 2.5 Wirtschaftlichkeit');
  L('');
  if (vrKeys.length) {
    L('| Variante | WGK | Investition € | Jahreskosten €/a |');
    L('|---|---:|---:|---:|');
    vrKeys.forEach(k => {
      const v = variantResults[k];
      L(`| ${v.label || k} | ${v.wgkText || '—'} | ${v.investGes ? fmt(v.investGes) : '—'} | ${v.jkGes ? fmt(v.jkGes) : '—'} |`);
    });
    L('');
  } else {
    L('[zu ergänzen: Wirtschaftlichkeit nach VDI 2067 — liegt erst nach Variantenrechnung vor.]');
    L('');
  }
  L('### 2.6 Variantenvergleich und Empfehlung');
  L('');
  if (vrKeys.length) {
    L('| Kennwert | ' + vrKeys.map(k => variantResults[k].label || k).join(' | ') + ' |');
    L('|---|' + vrKeys.map(() => '---:').join('|') + '|');
    const vrows = [
      ['Gebäudebedarf MWh/a', k => fmt(variantResults[k].gebäudebedarf || 0, 0)],
      ['Erzeugung MWh/a',     k => fmt(variantResults[k].erzeugung || 0, 0)],
      ['Netzverluste %',      k => fmt(variantResults[k].netzverlustePct || 0, 1)],
      ['EE-Anteil %',         k => variantResults[k].eeAnteil != null ? fmt(variantResults[k].eeAnteil, 1) : '—'],
      ['WGK',                 k => variantResults[k].wgkText || '—'],
      ['Investition €',       k => variantResults[k].investGes ? fmt(variantResults[k].investGes) : '—'],
      ['Jahreskosten €/a',    k => variantResults[k].jkGes ? fmt(variantResults[k].jkGes) : '—'],
      ['CO₂ t/a',             k => variantResults[k].co2GesH > 0 ? fmt(variantResults[k].co2GesH, 1) : '—'],
    ];
    vrows.forEach(r => L('| ' + r[0] + ' | ' + vrKeys.map(k => r[1](k)).join(' | ') + ' |'));
    L('');
  }
  L('[zu ergänzen: Bewertung der Varianten (CO₂, Primärenergie, Wirtschaftlichkeit, Resilienz) und begründete Empfehlung.]');
  L('');

  // ── 3 ELEKTROTECHNIK ──
  L('## 3 Elektrotechnik');
  L('');
  L('### 3.1 Ist-Zustand');
  L('');
  L(`- Strombedarf gesamt: **${fmt(totStrom, 1)} MWh/a**`);
  if (Object.keys(assetByType).length) {
    L('- Erfasste Komponenten:');
    Object.keys(assetByType).sort().forEach(t => {
      L(`  - ${ASSET_LABELS[t] || t}: ${assetByType[t]}`);
    });
    if (trafoKva > 0) L(`- Installierte Trafoleistung: **${fmt(trafoKva)} kVA**`);
  } else {
    L('[zu ergänzen: Auswertung der Stromdaten, Liegenschaftsnetzanschluss, Stromnetz, Notstromversorgung.]');
  }
  L('');
  L('### 3.2 Soll-Zustand');
  L('');
  if (pvKwp > 0)   L(`- Geplante PV-Leistung: **${fmt(pvKwp)} kWp**`);
  if (battKwh > 0) L(`- Batteriespeicher: **${fmt(battKwh)} kWh**`);
  L('[zu ergänzen: Geplanter Gebäudebestand, Liegenschaftsanschluss, Stromnetz, Notstrom/Lastmanagement, PV & Speicher.]');
  L('');

  // ── 4–6 (überwiegend qualitativ) ──
  L('## 4 Gebäudeautomation');
  L('[zu ergänzen: Konzept Gebäudeautomation, Kommunikationsnetz.]');
  L('');
  L('## 5 Maßnahmen zur Steigerung der Resilienz');
  L('[zu ergänzen: Erläuterung Bewertungstool Resilienz, Bewertung der Resilienz.]');
  L('');
  L('## 6 Fazit und Handlungsempfehlung');
  L('[zu ergänzen: Handlungsempfehlung Wärmeversorgung und Elektrotechnik — kurz-, mittel-, langfristig.]');
  L('');
  L('---');
  L('');
  L(`*Automatisch erzeugt aus dem Energieplanungs-Tool · anonymisiert · ${today}*`);

  // ── Download ──
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kennzahlen-digest_anonym_' + new Date().toISOString().slice(0, 10) + '.md';
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
  const varName = activeVariantId ? (varianten.find(v => v.id === activeVariantId)?.name || 'Variante') : 'Hauptplan';

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
  const economicId = document.getElementById('wirt-szenario')?.value || 'manual';
  const manifest = createCalculationManifest({timeSeriesMeta: glTimeSeriesMeta, pvProfileMeta:window.elPvMeta || syntheticPvProfileMeta(), tariffMeta: getPvTariffProvenance(document.getElementById('pv-tarif-szenario')?.value), economicMeta: getEconomicScenarioProvenance(economicId, economicId === 'manual')});
  h += '<h3 style="margin-top:18px;">Berechnungsmanifest</h3>';
  h += '<p><strong>App-/Build-Version:</strong> ' + escHtml(manifest.appVersion) + (manifest.buildDate ? ' · ' + escHtml(manifest.buildDate) : '') + '<br>';
  h += '<strong>Manifestversion:</strong> ' + manifest.manifestVersion + '</p>';
  h += '<ul style="font-size:8pt;color:var(--gray-light);line-height:1.5;">';
  Object.values(manifest.models).forEach(model => { h += '<li><strong>' + escHtml(model.id) + ' v' + escHtml(model.version) + ':</strong> ' + escHtml(model.method) + '</li>'; });
  h += '</ul><p style="font-size:8pt;color:var(--gray-light);"><strong>Datenqualität Lastgang:</strong> ' + escHtml(manifest.dataQuality.heatLoadSeries?.quality || 'unbekannt') + '</p>';
  h += '<ul style="font-size:8pt;color:var(--gray-light);line-height:1.5;">';
  manifest.limitations.forEach(item => { h += '<li>' + escHtml(item) + '</li>'; });
  h += '</ul>';
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
    Batterie: 'Batteriespeicher', H2: 'Wasserstoffspeicher', Lade: 'Ladeinfrastruktur', Nsa: 'Nsa',
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

// ── Hilfsfunktion: Verbindungen-Sheet + verstecktes AssetListe-Sheet ─────────
function _buildVerbindungenSheets(XLSXLib, allAssets, allEdges, assetMap) {
  const assetNames  = allAssets.map(a => a.name || String(a.id));
  const KABEL_TYPES = Object.keys(KABEL_TYPEN);
  const MAX_ROWS    = 200;

  const verbRows = [['Von', 'Nach', 'Kabeltyp', 'Querschnitt mm²', 'Länge m (auto)']];
  for (const e of allEdges) {
    const uName = assetMap.get(e.u)?.name || String(e.u);
    const vName = assetMap.get(e.v)?.name || String(e.v);
    verbRows.push([uName, vName, e.cableType || 'NAYY', e.crossSection || '', '']);
  }
  while (verbRows.length <= MAX_ROWS) verbRows.push(['', '', 'NAYY', '', '']);

  const wsVerb = XLSXLib.utils.aoa_to_sheet(verbRows);
  wsVerb['E1'] = { v: 'Länge m (auto)', t: 's',
    c: [{ a: 'Tool', t: 'Leer lassen → wird beim Import aus Trassen-Routing berechnet.' }] };
  wsVerb['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 22 }];
  wsVerb['!dataValidations'] = [
    { type: 'list', sqref: `A2:A${MAX_ROWS + 1}`,
      formula1: `AssetListe!$A$1:$A$${assetNames.length || 1}`, showDropDown: false },
    { type: 'list', sqref: `B2:B${MAX_ROWS + 1}`,
      formula1: `AssetListe!$A$1:$A$${assetNames.length || 1}`, showDropDown: false },
    { type: 'list', sqref: `C2:C${MAX_ROWS + 1}`,
      formula1: `”${KABEL_TYPES.join(',')}”`, showDropDown: false },
  ];

  const wsAssetList = XLSXLib.utils.aoa_to_sheet(assetNames.length ? assetNames.map(n => [n]) : [['']]);
  wsAssetList['!cols'] = [{ wch: 25 }];

  return { wsVerb, wsAssetList };
}

// ── Varianten-Mitgliedschaft pro Elektroasset/-kabel ermitteln ──────────────
// Liefert eine Map id → ['Basisdaten', 'Variante 1', ...] — für jede Variante
// (inkl. "Basisdaten") wird geprüft, ob das Asset/Kabel in deren Stromnetz-"Ast"
// vorkommt. Die aktuell aktive Variante liegt live in ASSETS/stromEdges vor,
// alle anderen in ihrem gespeicherten stromnetz-Snapshot (bzw. baseStromNetzSnapshot
// für "Basisdaten", wenn diese gerade nicht aktiv ist).
function _buildVariantMembershipMap() {
  const BASE_NAME = 'Hauptplan';
  const membership = new Map(); // id -> Set<variantName>
  const add = (id, name) => {
    if (id == null) return;
    if (!membership.has(id)) membership.set(id, new Set());
    membership.get(id).add(name);
  };
  const addLiveState = (name) => {
    ASSETS.items.filter(a => a.domain === 'strom' || a.domain === 'hybrid').forEach(a => add(a.id, name));
    (window.stromEdges || []).forEach(e => add(e.id, name));
  };
  const addSnapshot = (state, name) => {
    if (!state) return;
    (state.items || []).forEach(it => add(it.id, name));
    (state.edges || []).forEach(e => add(e.id, name));
  };

  if (activeVariantId === null) addLiveState(BASE_NAME);
  else addSnapshot(baseStromNetzSnapshot, BASE_NAME);

  (varianten || []).forEach(v => {
    if (v.id === activeVariantId) addLiveState(v.name);
    else addSnapshot(v.stromnetz, v.name);
  });

  return membership;
}

function _variantMembershipLabel(membership, id) {
  const set = membership.get(id);
  if (!set || set.size === 0) return '';
  return [...set].join(', ');
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
    WP: 'Wärmepumpe', PV: 'PV-Anlage', Batterie: 'Batteriespeicher', H2: 'Wasserstoffspeicher',
    Lade: 'Ladeinfrastruktur', Nsa: 'Nsa', KWK: 'KWK-Anlage', Wind: 'Windkraftanlage',
  };

  // Varianten-Mitgliedschaft je Asset/Kabel ermitteln (für zusätzliche Spalte)
  const variantMembership = _buildVariantMembershipMap();

  // Sheet 1: Komponenten
  const kompRows = [['Name', 'Typ', 'Baujahr', 'Abrissjahr', 'Status ' + yr, 'Leistung kW/kVA', 'Maßnahmen (Anzahl)', 'Investition (€)', 'Varianten']];
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
    kompRows.push([a.name || a.id, ASSET_LABELS[a.type] || a.type, a.baujahr || '', a.abrissjahr || '', statusTxt, leistung, (a.massnahmen || []).length, totalKosten || '', _variantMembershipLabel(variantMembership, a.id)]);
  }

  // Sheet 2: Kabel
  const kabelRows = [['Von', 'Nach', 'Typ', 'Querschnitt mm²', 'Länge m', 'Parallelkabel', 'Sicherung A', 'Strom A', 'Auslastung %', 'Spannungsfall %', 'Fluss kW', 'Varianten']];
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
      _variantMembershipLabel(variantMembership, e.id),
    ]);
  }

  // Sheet 3: Maßnahmen
  const massnRows = [['Asset', 'Typ', 'Titel', 'Maßnahmentyp', 'Jahr', 'Status', 'Kosten €', 'Gilt für']];
  for (const a of allAssets) {
    for (const m of (a.massnahmen || [])) {
      massnRows.push([a.name || a.id, ASSET_LABELS[a.type] || a.type, m.titel || '', _MASSN_TYP_WERTE.Asset[m.typ] ?? m.typ ?? '',
        m.jahr || '', m.status || 'geplant', parseFloat(m.kosten) || 0, geltungText(m, variantenName)]);
    }
  }

  const { wsVerb, wsAssetList } = _buildVerbindungenSheets(XLSXLib, allAssets, allEdges, assetMap);

  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(kompRows), 'Komponenten');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(kabelRows), 'Kabel');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(massnRows), 'Maßnahmen');
  XLSXLib.utils.book_append_sheet(wb, wsVerb, 'Verbindungen');
  XLSXLib.utils.book_append_sheet(wb, wsAssetList, 'AssetListe');
  wb.Workbook = wb.Workbook || { Sheets: [] };
  while (wb.Workbook.Sheets.length < wb.SheetNames.length) wb.Workbook.Sheets.push({});
  wb.Workbook.Sheets[wb.SheetNames.indexOf('AssetListe')].Hidden = 1;

  const fname = 'Elektroplanung_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSXLib.writeFile(wb, fname);
}

// ── Excel-Vollexport: Spalten und Wertebereiche ──────────────────────────────
// Der Import liest Spalten über die Kopfzeile (nicht über die Position) — ältere
// Exporte bleiben lesbar, neue Spalten verschieben nichts. Übernommen wird nur,
// was vom Stand vor dem Import abweicht (lib/xlsx-abgleich.js).

async function _ladeSheetJS() {
  if (typeof window.XLSX !== 'undefined') return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('SheetJS konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

const _SCHICHT_WERTE       = Object.fromEntries(Object.entries(SCHICHT_META).map(([k, m]) => [k, m.label]));
const _ZUSTAND_WERTE       = { A: 'A', B: 'B', C: 'C' };
const _NOTSTROM_WERTE      = { A: 'A', B: 'B', C: 'C' };
const _DACHFORM_WERTE      = { flach: 'Flachdach', sattel: 'Satteldach', walm: 'Walmdach', pult: 'Pultdach' };
const _PV_MODUS_WERTE      = { pauschal: 'Pauschal', flaechen: 'Flächen' };
const _PV_AUSRICHTUNG      = { sued: 'Süd', ostwest: 'Ost-West' };
const _MASSN_STATUS_WERTE  = { geplant: 'geplant', umgesetzt: 'umgesetzt', abgelehnt: 'abgelehnt' };
const _MASSN_OBJEKT_WERTE  = { Asset: 'Asset', Kabel: 'Kabel', Gebaeude: 'Gebäude' };
// Maßnahmentypen wie in den Formularen von Asset- (13e) und Kabel-Inspektor (05b)
const _MASSN_TYP_WERTE = {
  Asset: { Sanierung: 'Sanierung', Abriss: 'Abriss', Bau: 'Neubau/Bau', Ertuechtigung: 'Ertüchtigung' },
  Kabel: { Verlegung: 'Neuverlegung', Ertuecht: 'Ertüchtigung', Austausch: 'Austausch', Rueckbau: 'Rückbau' },
};
// Ziel-Parameter von Kabel-Maßnahmen (Engpass-Ausbauplan, lib/engpass-core.js)
const _KABEL_ZIEL_DEFS = [
  { key: 'cableType',    label: 'Typ' },
  { key: 'crossSection', label: 'Querschnitt mm²' },
  { key: 'nParallel',    label: 'Parallelkabel' },
];

// Typ-Reiter: ASSET_PROPS_SCHEMA (13a) enthält die simulationsrelevanten Props
// und speist auch das „Ziel-Parameter"-Formular der Maßnahmen. Was nur der
// Inspektor (13e) zusätzlich pflegt, steht deshalb hier und nicht dort.
const _XLSX_PROPS_EXTRA = {
  Trafo:       [{ key: 'netzart', label: 'Netzart' }],
  NSHV:        [{ key: 'netzart', label: 'Netzart' }],
  UV:          [{ key: 'netzart', label: 'Netzart' }],
  Verbraucher: [{ key: 'slpTyp',  label: 'Lastprofil (SLP)' }],
  TWW:         [{ key: 'kwhProPersonA', label: 'kWh/(Pers.·a)' },
                { key: 'copBooster',    label: 'COP Booster' },
                { key: 'zielTempC',     label: 'Zieltemperatur (°C)' },
                { key: 'vbhTww',        label: 'Vollbenutzungsstunden (h/a)' }],
  KWK:         [{ key: 'wirkungsgradGes', label: 'Gesamtwirkungsgrad (%)' }],
  Lade:        [{ key: 'rotation', label: 'Drehung (°)' }],
  Wind:        [{ key: 'einschaltwindMs',        label: 'Einschaltwind (m/s)' },
                { key: 'nennwindMs',             label: 'Nennwind (m/s)' },
                { key: 'abschaltwindMs',         label: 'Abschaltwind (m/s)' },
                { key: 'mittlereWindMs',         label: 'Ø Windgeschw. Nabenhöhe (m/s)' },
                { key: 'weibullK',               label: 'Weibull-Formfaktor k' },
                { key: 'abstandMultiplikator',   label: 'Planungsabstand (x Rotordurchmesser)' },
                { key: 'windLwa',                label: 'Schallleistungspegel Lwa (dB(A))' },
                { key: 'abstandVisible',         label: 'Abstandsradius anzeigen' },
                { key: 'laermVisible',           label: 'Lärmringe anzeigen' },
                { key: 'eignungsflaecheVisible', label: 'Eignungsfläche anzeigen' }],
};
const _XLSX_AUSWAHL = {
  netzart:       { verbrauch: 'Verbrauchsnetz', erzeugung: 'Erzeugungsnetz' },
  ausrichtung:   { sued: 'Süd', ostwest: 'Ost-West' },
  eingabeModus:  { personen: 'Personenzahl', energie: 'TWW-Energie' },
  geraet:        { heizstab: 'Heizstab', booster: 'Booster-WP' },
  betriebsmodus: { einspeisung: 'Einspeisung', verbraucher: 'Verbraucher' },
  kraftstoff:    { Diesel: 'Diesel', Gas: 'Gas', HVO: 'HVO' },
  brennstoff:    Object.fromEntries(['Erdgas', 'Biogas', 'Biomethan', 'HVO', 'Pflanzenöl', 'Wasserstoff', 'Heizöl'].map(b => [b, b])),
};
const _XLSX_JANEIN = new Set(['trennstelle', 'abstandVisible', 'laermVisible', 'eignungsflaecheVisible']);
// Vom Tool berechnet — nur zur Information exportiert (TWW: computeTwwKw beim Öffnen des Inspektors)
const _XLSX_BERECHNET = { TWW: new Set(['leistungKW']) };

/** Spalten des Typ-Reiters: {key, label, art, werte?}. */
function _xlsxPropDefs(type) {
  return [...(ASSET_PROPS_SCHEMA[type] || []), ...(_XLSX_PROPS_EXTRA[type] || [])].map(d => {
    if (_XLSX_BERECHNET[type]?.has(d.key)) return { ...d, label: d.label + ' (berechnet)', art: 'berechnet' };
    if (d.key === 'slpTyp') return { ...d, art: 'auswahl', werte: Object.fromEntries(getElSlpProfiles().map(p => [p.id, p.id])) };
    if (_XLSX_AUSWAHL[d.key]) return { ...d, art: 'auswahl', werte: _XLSX_AUSWAHL[d.key] };
    return { ...d, art: _XLSX_JANEIN.has(d.key) ? 'janein' : 'zahl' };
  });
}

function _typReiterName(type) { return (ASSET_LABELS[type] || type).slice(0, 31); }

function _statusText(item, yr) {
  const s = getAssetStatus(item, yr);
  return s === 'active' ? 'Aktiv' : s === 'planned' ? 'Geplant' : 'Abgerissen';
}

function _zahl(v, stellen) {
  const n = parseFloat(v);
  return (v == null || v === '' || !isFinite(n)) ? '' : +n.toFixed(stellen);
}

function _variantenListe() {
  return [{ key: 'base', name: variantenName('base') }, ...(varianten || []).map(v => ({ key: v.id, name: v.name }))];
}

/** Alle Maßnahmen mit Objektbezug: Assets, Kabel, Gebäude (Cluster-Pakete). */
function _alleMassnahmen(allAssets, allEdges, allGebaeude, assetMap) {
  const liste = [];
  for (const a of allAssets) for (const m of (a.massnahmen || []))
    liste.push({ m, art: 'Asset', obj: a, objId: a.id, objName: a.name || a.id, objTyp: ASSET_LABELS[a.type] || a.type, zielDefs: ASSET_PROPS_SCHEMA[a.type] || [] });
  for (const e of allEdges) for (const m of (e.massnahmen || []))
    liste.push({ m, art: 'Kabel', obj: e, objId: e.id, objName: `${assetMap.get(e.u)?.name || e.u} → ${assetMap.get(e.v)?.name || e.v}`, objTyp: e.cableType || 'NAYY', zielDefs: _KABEL_ZIEL_DEFS });
  for (const g of allGebaeude) for (const m of (g.massnahmen || []))
    liste.push({ m, art: 'Gebaeude', obj: g, objId: g.id, objName: g.name || '', objTyp: g.nutzung || '', zielDefs: [] });
  return liste;
}

// ── Export: Vollständiger XLSX (Gebäude + Assets + Kabel + Maßnahmen + Beziehungen) ──
export async function exportVollstaendigXLSX() {
  let XLSXLib;
  try { XLSXLib = await _ladeSheetJS(); } catch (e) { alert(e.message); throw e; }
  const yr = globalYear ?? new Date().getFullYear();
  const allGebaeude = window.gebaeude || [];
  const allAssets = ASSETS.items || [];
  const allEdges = window.stromEdges || [];

  const gebMap = new Map(allGebaeude.map(g => [g.id, g]));
  const assetMap = new Map(allAssets.map(a => [a.id, a]));

  // Sheet: Gebäude
  const gebRows = [['ID', 'Name', 'Gebäudenummer', 'Nutzung', 'Fläche (m²)', 'Stockwerke',
    'Baujahr', 'Abrissjahr', 'Schicht', 'Zustand',
    'Wärmebedarf (MWh/a)', 'Heizlast (kW)', 'Spez. Wärme (kWh/m²a)', 'Spez. Heizlast (W/m²)',
    'Strom (MWh/a)', 'Spez. Strom (kWh/m²a)',
    'PV aktiv', 'PV Dachanteil (%)', 'PV-Modus', 'PV-Ausrichtung', 'PV-Belegung (%)', 'PV-GCR (%)', 'PV-Baujahr',
    'Dachform', 'Dachneigung (°)', 'Dachazimut (°)',
    'Notstromklasse', 'Notstrom Last B (%)', 'Notstrom eigenes NEA']];
  for (const g of allGebaeude) {
    const ns = normalisiereNotstrom(g.notstrom);
    gebRows.push([
      g.id, g.name || '', g.gebaeudenummer || '', g.nutzung || '',
      _zahl(g.flaeche, 0), g.stockwerke ?? 1,
      g.baujahr || '', g.abrissjahr || '', _SCHICHT_WERTE[normSchicht(g.schicht)], g.zustand || '',
      _zahl(g.waerme, 2), _zahl(g.heizlast, 1), _zahl(g.spez, 1), _zahl(g.spezHeizlast, 1),
      _zahl(g.strom, 2), _zahl(g.spezStrom, 1),
      janein(!!g.pvAktiv), g.pvDachanteil || 30,
      _PV_MODUS_WERTE[g.pvModus || 'flaechen'] || g.pvModus, _PV_AUSRICHTUNG[g.pvFlAusrichtung || 'sued'] || g.pvFlAusrichtung,
      g.pvFlBelegung ?? '', g.pvFlGcr ?? '', g.pvBaujahr ?? '',
      _DACHFORM_WERTE[g.dachform || 'sattel'] || g.dachform, _zahl(g.dachNeigung, 1), _zahl(g.dachAzimut, 1),
      ns?.klasse || '', ns?.lastPct ?? '', ns?.klasse === 'A' ? janein(ns.eigeneNea) : '',
    ]);
  }

  // Sheet: Assets
  const assetsRows = [['ID', 'Name', 'Typ', 'Gebäude', 'Baujahr', 'Abrissjahr', 'Schicht',
    'Status ' + yr, 'Leistung kW/kVA', 'Maßnahmen (Anzahl)', 'Investition (€)']];
  for (const a of allAssets) {
    const p = a.props || {};
    let leistung = '';
    if (a.type === 'Trafo') leistung = (p.leistungKVA || 630) + ' kVA';
    else if (['Verbraucher', 'WP', 'Nsa', 'KWK', 'Wind'].includes(a.type)) leistung = (p.leistungKW || p.leistungElKW || 0) + ' kW';
    else if (a.type === 'PV') leistung = (p.leistungKWp || 0) + ' kWp';
    else if (a.type === 'Lade') leistung = ((p.anzahlPunkte || 4) * (p.leistungProPunktKW || 22)) + ' kW';
    else if (['NSHV', 'UV', 'KVS', 'Schaltanlage'].includes(a.type)) leistung = (p.nennstromA || 400) + ' A';
    const totalKosten = (a.massnahmen || []).reduce((s, m) => s + (parseFloat(m.kosten) || 0), 0);
    const gebName = a.buildingId != null ? (gebMap.get(a.buildingId)?.name || a.buildingId) : '';
    assetsRows.push([a.id, a.name || a.id, ASSET_LABELS[a.type] || a.type, gebName,
      a.baujahr || '', a.abrissjahr || '', _SCHICHT_WERTE[normSchicht(a.schicht)], _statusText(a, yr), leistung,
      (a.massnahmen || []).length, totalKosten || '']);
  }

  // Sheet: Kabel
  const kabelRows = [['Kabel-ID', 'Von-ID', 'Nach-ID', 'Von', 'Nach', 'Typ', 'Querschnitt mm²', 'Auto-Bemessung',
    'Parallelkabel', 'Sicherung A', 'Trennstelle',
    'Querschnitt geschätzt', 'Querschnitt-Quelle', 'MS-Ebene', 'Baujahr (abgeleitet)', 'Abrissjahr (abgeleitet)',
    'Länge m', 'Strom A', 'Auslastung %', 'Spannungsfall %', 'Fluss kW']];
  for (const e of allEdges) {
    kabelRows.push([
      e.id ?? '', e.u, e.v, assetMap.get(e.u)?.name || e.u, assetMap.get(e.v)?.name || e.v,
      e.cableType || 'NAYY', e.crossSection || '', janein(!!e.autoSized),
      e.nParallel || 1, e.fuseA || '', janein(!!e.trennstelle),
      janein(!!e.qsGeschaetzt), e.qsQuelle || '', janein(!!e.msLevel), e.baujahr ?? '', e.abrissjahr ?? '',
      Math.round(e.lengthM || 0),
      e.peakCurrentA != null ? +e.peakCurrentA.toFixed(1) : '',
      e.auslastungPct != null ? +e.auslastungPct.toFixed(1) : '',
      e.deltaUPct != null ? +e.deltaUPct.toFixed(2) : '',
      e.peakFlowKw != null ? +e.peakFlowKw.toFixed(1) : '',
    ]);
  }

  // Sheet: Maßnahmen (Assets, Kabel, Gebäude)
  const alleMassn = _alleMassnahmen(allAssets, allEdges, allGebaeude, assetMap);
  const massnRows = [['Maßnahmen-ID', 'Objekt', 'Objekt-ID', 'Objekt-Name', 'Objekttyp', 'Titel', 'Maßnahmentyp',
    'Jahr', 'Status', 'Kosten €', 'Gilt für', 'Ziel-Parameter']];
  for (const x of alleMassn) {
    const m = x.m;
    massnRows.push([m.id ?? '', _MASSN_OBJEKT_WERTE[x.art], x.objId, x.objName, x.objTyp,
      m.titel || '', _MASSN_TYP_WERTE[x.art]?.[m.typ] ?? m.typ ?? '',
      m.jahr ?? '', m.status || 'geplant', parseFloat(m.kosten) || 0,
      geltungText(m, variantenName), zielParameterText(m.newProps, x.zielDefs)]);
  }

  // Sheet: Beziehungen (Übersicht, nur Referenz)
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

  // Maßnahmen (alle Objekte): je Status Anzahl + Kosten
  const massnStats = { geplant: { n: 0, k: 0 }, umgesetzt: { n: 0, k: 0 }, abgelehnt: { n: 0, k: 0 } };
  for (const { m } of alleMassn) {
    const s = massnStats[m.status] || massnStats.geplant;
    s.n++;
    s.k += parseFloat(m.kosten) || 0;
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
    ['Variante',      aktiverVariantenName()],
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
    ['MASSNAHMEN (Assets, Kabel, Gebäude)', '', ''],
    ['Status', 'Anzahl', 'Kosten (€)'],
    ['Geplant',     massnStats.geplant.n,     fmt0(massnStats.geplant.k)],
    ['Umgesetzt',   massnStats.umgesetzt.n,   fmt0(massnStats.umgesetzt.k)],
    ['Abgelehnt',   massnStats.abgelehnt.n,   fmt0(massnStats.abgelehnt.k)],
    ['Gesamt',      massnGesamt.n,            fmt0(massnGesamt.k)],
  ];

  // ── Hinweise: was der Import liest und welche Werte erlaubt sind ──────────
  const hinwRows = [
    ['Excel-Import – Hinweise'],
    [],
    ['Allgemein', 'Der Import (📥 Excel) übernimmt nur Zellen, die sich gegenüber dem Stand im Tool geändert haben. Ein unverändert wieder eingelesener Export ändert nichts.'],
    ['', 'Zugeordnet wird über die ID-Spalten. Spalten werden über ihre Überschrift erkannt – Reihenfolge egal, Überschriften nicht umbenennen.'],
    ['', 'Leere Zelle = Wert löschen (z. B. Abrissjahr). Ausnahmen: Name, Nutzung, Fläche, Stockwerke, Schicht, Auswahlfelder ohne Leer-Option bleiben bei leerer Zelle unverändert.'],
    ['', 'Gilt nur für die Variante, die beim Export aktiv war (siehe Übersicht).'],
    ['Nur Information', 'Status, Leistung, Investition, Länge, Strom, Auslastung, Spannungsfall, Fluss, MS-Ebene, „Querschnitt geschätzt", Kabel-Baujahr/Abrissjahr (abgeleitet aus den Endpunkten), Werte mit „(berechnet)".'],
    [],
    ['Gebäude', ''],
    ['Schicht', Object.values(_SCHICHT_WERTE).join(', ')],
    ['Zustand', 'A, B, C oder leer'],
    ['Wärmebedarf / Heizlast', 'Zahl = manueller Wert; leer = wieder automatisch berechnen'],
    ['PV-Modus', Object.values(_PV_MODUS_WERTE).join(', ')],
    ['PV-Ausrichtung', Object.values(_PV_AUSRICHTUNG).join(', ')],
    ['Dachform', Object.values(_DACHFORM_WERTE).join(', ')],
    ['Notstromklasse', 'A (kritisch), B (eingeschränkt), C (einspeisefähig) oder leer'],
    ['Ja/Nein-Felder', 'ja / nein'],
    [],
    ['Kabel', ''],
    ['Querschnitt mm²', 'Geänderter Wert schaltet die Auto-Bemessung für dieses Kabel aus'],
    ['Auto-Bemessung', 'ja = Querschnitt automatisch auslegen'],
    [],
    ['Maßnahmen', ''],
    ['Neue Maßnahme', 'Zeile ohne Maßnahmen-ID mit Objekt (Asset/Kabel), Objekt-ID und Titel'],
    ['Maßnahmentyp Asset', Object.values(_MASSN_TYP_WERTE.Asset).join(', ')],
    ['Maßnahmentyp Kabel', Object.values(_MASSN_TYP_WERTE.Kabel).join(', ')],
    ['Status', Object.values(_MASSN_STATUS_WERTE).join(', ')],
    ['Gilt für', `leer (Standardregel), ${GILT_ALLE}, ` + _variantenListe().map(v => v.name).join(', ')],
    ['Ziel-Parameter', 'Name=Wert; Name=Wert … z. B. „Leistung (kVA)=1000; UK (%)=6" (Namen wie im Typ-Reiter)'],
    [],
    ['Typ-Reiter: Auswahlfelder', ''],
    ...Object.entries(_XLSX_AUSWAHL).map(([k, w]) => [k, Object.values(w).join(', ')]),
  ];

  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(ueRows),     'Übersicht');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(gebRows),    'Gebäude');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(assetsRows), 'Assets');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(kabelRows),  'Kabel');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(massnRows),  'Maßnahmen');
  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(bezRows),    'Beziehungen');

  // ── Verbindungen-Sheet (Dropdown-Auswahl für Import) ──────────────────────
  { const { wsVerb, wsAssetList } = _buildVerbindungenSheets(XLSXLib, allAssets, allEdges, assetMap);
    XLSXLib.utils.book_append_sheet(wb, wsVerb, 'Verbindungen');
    XLSXLib.utils.book_append_sheet(wb, wsAssetList, 'AssetListe');
    wb.Workbook = wb.Workbook || { Sheets: [] };
    while (wb.Workbook.Sheets.length < wb.SheetNames.length) wb.Workbook.Sheets.push({});
    wb.Workbook.Sheets[wb.SheetNames.indexOf('AssetListe')].Hidden = 1;
  }

  // ── Typ-spezifische Reiter (nur wenn Assets dieses Typs vorhanden) ──────────
  for (const type of Object.keys(ASSET_PROPS_SCHEMA)) {
    const typeAssets = allAssets.filter(a => a.type === type);
    const defs = _xlsxPropDefs(type);
    if (!typeAssets.length || !defs.length) continue;
    const rows = [['ID', 'Name', 'Gebäude', 'Baujahr', 'Abrissjahr', 'Schicht', 'Status ' + yr, ...defs.map(d => d.label)]];
    for (const a of typeAssets) {
      const p = a.props || {};
      const gebName = a.buildingId != null ? (gebMap.get(a.buildingId)?.name || a.buildingId) : '';
      rows.push([
        a.id, a.name || a.id, gebName,
        a.baujahr || '', a.abrissjahr || '', _SCHICHT_WERTE[normSchicht(a.schicht)], _statusText(a, yr),
        ...defs.map(d => propZuZelle(d, p[d.key])),
      ]);
    }
    XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(rows), _typReiterName(type));
  }

  XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet(hinwRows), 'Hinweise');

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
  event.target.value = '';
  if (!file) return;
  let XLSXLib;
  try { XLSXLib = await _ladeSheetJS(); } catch (e) { alert(e.message); return; }
  try {
    const wb = XLSXLib.read(await file.arrayBuffer(), { type: 'array' });
    const blatt = name => wb.Sheets[name] ? XLSXLib.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) : null;

    // Aus einer anderen Variante exportiert? Dann passen Assets/Kabel ggf. nicht.
    const ueVariante = (blatt('Übersicht') || []).find(r => xStr(r?.[0]) === 'Variante')?.[1];
    if (ueVariante != null && xStr(ueVariante) !== aktiverVariantenName()
      && !confirm(`Die Datei wurde in der Variante „${xStr(ueVariante)}" exportiert, aktiv ist „${aktiverVariantenName()}".\n\nTrotzdem in die aktive Variante importieren?`)) return;

    const ctx = _importKontext();
    const mutate = () => {
      const geb = blatt('Gebäude');        if (geb)   _importGebaeude(geb, ctx);
      const ass = blatt('Assets');         if (ass)   _importAssetsBlatt(ass, ctx);
      for (const type of Object.keys(ASSET_PROPS_SCHEMA)) {
        const rows = blatt(_typReiterName(type));
        if (rows) _importTypReiter(type, rows, ctx);
      }
      const kab = blatt('Kabel');          if (kab)   _importKabel(kab, ctx);
      const mas = blatt('Maßnahmen');      if (mas)   _importMassnahmen(mas, ctx);
    };
    if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction('Excel-Import', mutate);
    else mutate();
    _nachImportAktualisieren(ctx);

    const a = ctx.anz;
    const lines = [];
    if (a.geb) lines.push(`${a.geb} Gebäude`);
    if (ctx.assetsGeaendert.size) lines.push(`${ctx.assetsGeaendert.size} Assets`);
    if (a.kabel) lines.push(`${a.kabel} Kabel`);
    if (a.massn) lines.push(`${a.massn} Maßnahmen`);
    let msg = lines.length
      ? 'Import abgeschlossen: ' + lines.join(', ') + ' aktualisiert.'
      : 'Import abgeschlossen – keine Änderungen erkannt.';
    if (a.massnNeu) msg += `\n${a.massnNeu} Maßnahme(n) neu angelegt.`;
    if (ctx.hinweise.length) {
      msg += `\n\n${ctx.hinweise.length} Zelle(n) nicht übernommen:\n` + ctx.hinweise.slice(0, 12).join('\n')
        + (ctx.hinweise.length > 12 ? `\n(+${ctx.hinweise.length - 12} weitere, siehe Konsole)` : '');
      console.warn('Excel-Import – nicht übernommen:', ctx.hinweise);
    }
    alert(msg);
  } catch (err) {
    alert('Fehler beim Import: ' + err.message);
    console.error(err);
  }
}

/** Stand vor dem Import: Vergleichsbasis für jede Zelle (auch wenn ein Wert auf mehreren Blättern steht). */
function _importKontext() {
  const kopie = o => ({ ...o, props: o.props ? { ...o.props } : o.props, newProps: o.newProps ? { ...o.newProps } : o.newProps });
  const gebaeudeListe = window.gebaeude || [];
  const assets = ASSETS.items || [];
  const edges = window.stromEdges || [];
  const massn = new Map();
  for (const quelle of [...assets, ...edges, ...gebaeudeListe])
    for (const m of (quelle.massnahmen || [])) massn.set(m, kopie(m));
  return {
    origGeb:   new Map(gebaeudeListe.map(g => [g, kopie(g)])),
    origAsset: new Map(assets.map(a => [a, kopie(a)])),
    origEdge:  new Map(edges.map(e => [e, kopie(e)])),
    origMassn: massn,
    anz: { geb: 0, kabel: 0, massn: 0, massnNeu: 0 },
    assetsGeaendert: new Set(),
    kabelGeaendert: false,
    notstromGeaendert: false,
    hinweise: [],
    melde(blattName, r, text) { this.hinweise.push(`${blattName}, Zeile ${r + 1}: ${text}`); },
  };
}

function _nachImportAktualisieren(ctx) {
  if (ctx.anz.geb) {
    renderList();
    updateTotals();
    updateVizDebounced();
    recalcNetz();
  }
  if (ctx.notstromGeaendert && window.blackoutModusAktiv) window.blackoutModusMarkiereKarte?.();
  if (ctx.assetsGeaendert.size || ctx.anz.massn) {
    window.redrawAllAssets?.();
    renderSidebarAssetList?.();
  }
  if (ctx.kabelGeaendert || ctx.assetsGeaendert.size) {
    window.recalcStromNetz?.();
    window.sldRefresh?.();
  }
  window.glBerechnen?.();
}

// ── Gebäude ──────────────────────────────────────────────────────────────────
function _importGebaeude(rows, ctx) {
  const k = kopfIndex(rows[0]);
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const id = xInt(k.zelle(row, 'ID'));
    const g = (window.gebaeude || []).find(x => x.id === id);
    const o = g && ctx.origGeb.get(g);
    if (!g || !o) continue;
    const z = spalte => k.zelle(row, spalte);
    const meld = t => ctx.melde('Gebäude', r, t);
    let n = 0;

    // Zahlenfeld: nur bei Abweichung anwenden; leer → anwenden(null), wenn erlaubt
    const zahl = (spalte, alt, stellen, anwenden, { ganz = false, leerErlaubt = true, min = -Infinity, max = Infinity } = {}) => {
      if (!k.hat(spalte)) return false;
      const zelle = z(spalte);
      if (!zahlGeaendert(alt, zelle, stellen)) return false;
      const v = ganz ? xInt(zelle) : xNum(zelle);
      if (v == null) {
        if (!istLeer(zelle)) { meld(`${spalte}: „${zelle}" ist keine Zahl`); return false; }
        if (!leerErlaubt) return false;
      } else if (v < min || v > max) { meld(`${spalte}: ${v} liegt außerhalb ${min}–${max}`); return false; }
      anwenden(v); n++;
      return true;
    };
    // Auswahlfeld: leer → anwenden(null), wenn erlaubt
    const auswahl = (spalte, alt, werte, anwenden, { leerErlaubt = false } = {}) => {
      if (!k.hat(spalte)) return;
      const s = xAuswahl(z(spalte), werte);
      if (s === undefined) { meld(`${spalte}: „${z(spalte)}" ist nicht erlaubt (${Object.values(werte).join(', ')})`); return; }
      if (s === null && !leerErlaubt) return;
      if ((s ?? '') === (alt ?? '')) return;
      anwenden(s); n++;
    };
    const feld = (f, opts) => v => updateField(id, f, v == null ? '' : v, { defer: true, ...opts });

    if (k.hat('Name')) {
      const v = xStr(z('Name'));
      if (v && v !== xStr(o.name)) {
        if (typeof window.renameGebaeude === 'function') window.renameGebaeude(id, v); else g.name = v;
        n++;
      }
    }
    if (k.hat('Gebäudenummer') && textGeaendert(o.gebaeudenummer, z('Gebäudenummer'))) {
      const nummer = xStr(z('Gebäudenummer'));
      if (typeof window.setGebaeudenummer === 'function') window.setGebaeudenummer(id, nummer); else g.gebaeudenummer = nummer;
      n++;
    }
    if (k.hat('Nutzung')) {
      const v = xStr(z('Nutzung'));
      if (v && v !== xStr(o.nutzung)) { feld('nutzung')(v); n++; }
    }
    // Über updateField wie im Gebäude-Panel: Jahre/Schicht wandern auf die Assets,
    // Fläche/Baujahr/Stockwerke lösen die Auto-Energie aus (sofern nicht manuell).
    zahl('Fläche (m²)', o.flaeche, 0, feld('flaeche'), { leerErlaubt: false, min: 0 });
    zahl('Stockwerke', o.stockwerke ?? 1, 0, feld('stockwerke'), { ganz: true, leerErlaubt: false, min: 1, max: 50 });
    zahl('Baujahr', o.baujahr, 0, feld('baujahr'), { ganz: true, min: 1800, max: 2100 });
    zahl('Abrissjahr', o.abrissjahr, 0, feld('abrissjahr'), { ganz: true, min: 1800, max: 2100 });
    auswahl('Schicht', normSchicht(o.schicht), _SCHICHT_WERTE, feld('schicht'));
    auswahl('Zustand', o.zustand, _ZUSTAND_WERTE, feld('zustand'), { leerErlaubt: true });

    // Spezifische Werte zuerst — ein ebenfalls geänderter Absolutwert gewinnt danach.
    zahl('Spez. Wärme (kWh/m²a)', o.spez, 1, feld('spez'), { leerErlaubt: false, min: 0 });
    zahl('Spez. Heizlast (W/m²)', o.spezHeizlast, 1, feld('spezHeizlast'), { leerErlaubt: false, min: 0 });
    zahl('Spez. Strom (kWh/m²a)', o.spezStrom, 1, feld('spezStrom'), { min: 0 });
    let autoNeu = false;
    zahl('Wärmebedarf (MWh/a)', o.waerme, 2, v => { feld('waerme')(v); if (v == null) autoNeu = true; }, { min: 0 });
    zahl('Heizlast (kW)', o.heizlast, 1, v => { feld('heizlast')(v); if (v == null) autoNeu = true; }, { min: 0 });
    zahl('Strom (MWh/a)', o.strom, 2, feld('strom'), { min: 0 });
    // Geleert = nicht mehr manuell → wieder automatisch berechnen
    if (autoNeu && calcAutoEnergy(g)) recalcNetz();

    if (k.hat('PV aktiv')) {
      const b = xBool(z('PV aktiv'));
      if (b == null && !istLeer(z('PV aktiv'))) meld(`PV aktiv: „${z('PV aktiv')}" ist kein ja/nein`);
      else if (b != null && b !== !!o.pvAktiv) { updateGebPv(id, 'pvAktiv', b); n++; }
    }
    zahl('PV Dachanteil (%)', o.pvDachanteil || 30, 0, v => updateGebPv(id, 'pvDachanteil', v), { leerErlaubt: false, min: 1, max: 100 });
    auswahl('PV-Modus', o.pvModus || 'flaechen', _PV_MODUS_WERTE, s => window.setGebPvModus?.(id, s));
    auswahl('PV-Ausrichtung', o.pvFlAusrichtung || 'sued', _PV_AUSRICHTUNG, s => window.updateGebPvFl?.(id, 'ausrichtung', s));
    zahl('PV-Belegung (%)', o.pvFlBelegung, 1, v => window.updateGebPvFl?.(id, 'belegung', v), { leerErlaubt: false, min: 0, max: 100 });
    zahl('PV-GCR (%)', o.pvFlGcr, 1, v => window.updateGebPvFl?.(id, 'gcr', v), { leerErlaubt: false, min: 0 });
    zahl('PV-Baujahr', o.pvBaujahr, 0, v => window.updateGebPvBaujahr?.(id, v ?? ''), { ganz: true, min: 1800, max: 2100 });
    auswahl('Dachform', o.dachform || 'sattel', _DACHFORM_WERTE, s => window.updateGebDach?.(id, 'dachform', s));
    zahl('Dachneigung (°)', o.dachNeigung, 1, v => window.updateGebDach?.(id, 'dachNeigung', v ?? ''), { min: 0, max: 90 });
    zahl('Dachazimut (°)', o.dachAzimut, 1, v => window.updateGebDach?.(id, 'dachAzimut', v ?? ''), { min: 0, max: 360 });

    // Notstrom (Blackout-Modus): Klasse, Lastanteil B, eigenes Aggregat bei A
    if (k.hat('Notstromklasse')) {
      const alt = normalisiereNotstrom(o.notstrom);
      let klasse = alt?.klasse || null, lastPct = alt?.lastPct ?? null, nea = !!alt?.eigeneNea, geaendert = false;
      const s = xAuswahl(z('Notstromklasse'), _NOTSTROM_WERTE);
      if (s === undefined) meld(`Notstromklasse: „${z('Notstromklasse')}" ist nicht erlaubt (A, B, C oder leer)`);
      else if (s !== klasse) { klasse = s; geaendert = true; }
      if (k.hat('Notstrom Last B (%)') && zahlGeaendert(lastPct, z('Notstrom Last B (%)'), 0)) { lastPct = xNum(z('Notstrom Last B (%)')); geaendert = true; }
      if (k.hat('Notstrom eigenes NEA')) { const b = xBool(z('Notstrom eigenes NEA')); if (b != null && b !== nea) { nea = b; geaendert = true; } }
      if (geaendert) {
        if (!klasse) delete g.notstrom;
        else g.notstrom = normalisiereNotstrom({ klasse, lastPct, eigeneNea: nea });
        ctx.notstromGeaendert = true;
        n++;
      }
    }

    if (n) ctx.anz.geb++;
  }
}

// ── Assets (Blatt „Assets" + Typ-Reiter) ─────────────────────────────────────
function _assetBasisAbgleich(a, o, k, row, meld) {
  let n = 0;
  if (k.hat('Name')) {
    const v = xStr(k.zelle(row, 'Name'));
    if (v && v !== xStr(o.name)) { a.name = v; n++; }
  }
  for (const [spalte, feld] of [['Baujahr', 'baujahr'], ['Abrissjahr', 'abrissjahr']]) {
    if (!k.hat(spalte)) continue;
    const zelle = k.zelle(row, spalte);
    if (!zahlGeaendert(o[feld], zelle, 0)) continue;
    const v = xInt(zelle);
    if (v == null && !istLeer(zelle)) { meld(`${spalte}: „${zelle}" ist keine Jahreszahl`); continue; }
    a[feld] = v;
    // Von Hand gesetzt: das automatische Baujahr der Erzeuger-Kopplung (13p) fasst es nicht mehr an
    if (feld === 'baujahr' && a.linkedErzeuger) a.baujahrAuto = false;
    n++;
  }
  if (k.hat('Schicht')) {
    const s = xAuswahl(k.zelle(row, 'Schicht'), _SCHICHT_WERTE);
    if (s === undefined) meld(`Schicht: „${k.zelle(row, 'Schicht')}" ist nicht erlaubt (${Object.values(_SCHICHT_WERTE).join(', ')})`);
    else if (s && s !== normSchicht(o.schicht)) { a.schicht = s; n++; }
  }
  return n;
}

function _importAssetsBlatt(rows, ctx) {
  const k = kopfIndex(rows[0]);
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = xStr(k.zelle(row, 'ID'));
    if (!id) continue;
    const a = (ASSETS.items || []).find(x => String(x.id) === id);
    const o = a && ctx.origAsset.get(a);
    if (!o) continue;
    if (_assetBasisAbgleich(a, o, k, row, t => ctx.melde('Assets', r, t))) ctx.assetsGeaendert.add(a.id);
  }
}

// Ohne Trennstelle ist auch kein Kabel der Station offen (wie im Inspektor, 13e).
// Station = MS-Betriebsmittel (NAP/Schaltanlage/Trafo) eines Gebäudes.
function _stationsTrennstellenAufheben(asset) {
  const ms = new Set(['NAP', 'Schaltanlage', 'Trafo']);
  const station = a => (a?.buildingId != null ? 'g' + a.buildingId : 'a' + a?.id);
  const meine = station(asset);
  const byId = new Map((ASSETS.items || []).map(a => [String(a.id), a]));
  for (const e of (window.stromEdges || [])) {
    const a = byId.get(String(e.u)), b = byId.get(String(e.v));
    if (!a || !b || !ms.has(a.type) || !ms.has(b.type)) continue;
    const sa = station(a), sb = station(b);
    if (sa !== sb && (sa === meine || sb === meine)) e.trennstelle = false;
  }
}

function _importTypReiter(type, rows, ctx) {
  if (rows.length < 2) return;
  const blattName = _typReiterName(type);
  const k = kopfIndex(rows[0]);
  const defs = _xlsxPropDefs(type).filter(d => d.art !== 'berechnet' && k.hat(d.label));
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = xStr(k.zelle(row, 'ID'));
    if (!id) continue;
    const a = (ASSETS.items || []).find(x => String(x.id) === id && x.type === type);
    const o = a && ctx.origAsset.get(a);
    if (!o) continue;
    const meld = t => ctx.melde(blattName, r, t);
    let n = _assetBasisAbgleich(a, o, k, row, meld);
    if (!a.props) a.props = {};
    for (const d of defs) {
      const res = zelleZuProp(d, k.zelle(row, d.label));
      if (!res.ok) { meld(`${d.label}: ${res.fehler}`); continue; }
      if (!propGeaendert(d, o.props?.[d.key], res.wert)) continue;
      a.props[d.key] = res.wert;
      if (type === 'PV') a._pvProfile = null;   // Profil-Cache (wie im Inspektor)
      if (type === 'Schaltanlage' && d.key === 'trennstelle' && !res.wert) { _stationsTrennstellenAufheben(a); ctx.kabelGeaendert = true; }
      n++;
    }
    if (n) ctx.assetsGeaendert.add(a.id);
  }
}

// ── Kabel ────────────────────────────────────────────────────────────────────
function _importKabel(rows, ctx) {
  const k = kopfIndex(rows[0]);
  const edgeArr = window.stromEdges || [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const z = spalte => k.zelle(row, spalte);
    const meld = t => ctx.melde('Kabel', r, t);
    // Zuordnung über die Kabel-ID; ältere Exporte ohne ID über Von-/Nach-ID
    const kid = xStr(z('Kabel-ID'));
    let edge = kid ? edgeArr.find(e => String(e.id) === kid) : null;
    if (!edge && !kid) {
      const uId = xStr(z('Von-ID')), vId = xStr(z('Nach-ID'));
      if (!uId || !vId) continue;
      edge = edgeArr.find(e => String(e.u) === uId && String(e.v) === vId)
          || edgeArr.find(e => String(e.u) === vId && String(e.v) === uId);
    }
    if (!edge && kid) { meld(`Kabel „${kid}" nicht gefunden`); continue; }
    const o = edge && ctx.origEdge.get(edge);
    if (!o) continue;
    let n = 0, auslegung = false;

    if (k.hat('Typ') && textGeaendert(o.cableType || 'NAYY', z('Typ')) && !istLeer(z('Typ'))) {
      const typ = parseKabelLabel(z('Typ'))?.cableType;
      if (typ && KABEL_TYPEN[typ]) { if (typ !== (o.cableType || 'NAYY')) { edge.cableType = typ; n++; auslegung = true; } }
      else meld(`Typ: „${z('Typ')}" ist kein bekannter Kabeltyp`);
    }
    if (k.hat('Auto-Bemessung')) {
      const b = xBool(z('Auto-Bemessung'));
      if (b != null && b !== !!o.autoSized) {
        edge.autoSized = b;
        if (b) edge.crossSection = 0;
        n++; auslegung = true;
      }
    }
    // Ein geänderter Querschnitt ist eine feste Vorgabe → Auto-Bemessung aus
    if (k.hat('Querschnitt mm²') && !istLeer(z('Querschnitt mm²')) && zahlGeaendert(o.crossSection, z('Querschnitt mm²'), 1)) {
      const qs = xNum(z('Querschnitt mm²'));
      if (qs == null || qs <= 0) meld(`Querschnitt: „${z('Querschnitt mm²')}" ist kein gültiger Querschnitt`);
      else { edge.crossSection = qs; edge.autoSized = false; n++; auslegung = true; }
    }
    if (k.hat('Parallelkabel') && zahlGeaendert(o.nParallel || 1, z('Parallelkabel'), 0) && !istLeer(z('Parallelkabel'))) {
      const np = xInt(z('Parallelkabel'));
      if (np == null) meld(`Parallelkabel: „${z('Parallelkabel')}" ist keine Zahl`);
      else { edge.nParallel = Math.max(1, np); n++; }
    }
    if (k.hat('Sicherung A') && zahlGeaendert(o.fuseA || null, z('Sicherung A'), 0)) {
      const f = xNum(z('Sicherung A'));
      if (f == null && !istLeer(z('Sicherung A'))) meld(`Sicherung: „${z('Sicherung A')}" ist keine Zahl`);
      else { edge.fuseA = f ?? 0; n++; }
    }
    if (k.hat('Trennstelle')) {
      const b = xBool(z('Trennstelle'));
      if (b != null && b !== !!o.trennstelle) { edge.trennstelle = b; n++; }
    }
    // Von Hand ausgelegt ist nicht mehr geschätzt (wie im Kabel-Inspektor, 05b)
    if (auslegung) edge.qsGeschaetzt = false;
    if (n) { ctx.anz.kabel++; ctx.kabelGeaendert = true; }
  }
}

// ── Maßnahmen ────────────────────────────────────────────────────────────────
function _importMassnahmen(rows, ctx) {
  const k = kopfIndex(rows[0]);
  const assets = ASSETS.items || [];
  const edges = window.stromEdges || [];
  const assetMap = new Map(assets.map(a => [a.id, a]));
  const index = new Map(_alleMassnahmen(assets, edges, window.gebaeude || [], assetMap).map(x => [String(x.m.id), x]));
  const varListe = _variantenListe();
  const neuesFormat = k.hat('Maßnahmen-ID');

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const z = spalte => k.zelle(row, spalte);
    const meld = t => ctx.melde('Maßnahmen', r, t);

    // Älterer Export ohne Maßnahmen-ID: Zuordnung über Asset + Titel + Jahr, nur Status/Kosten
    if (!neuesFormat) {
      const assetId = xStr(z('Asset-ID'));
      const a = assets.find(x => String(x.id) === assetId);
      if (!a) continue;
      const titel = xStr(z('Titel')), jahr = xStr(z('Jahr'));
      const m = (a.massnahmen || []).find(x => xStr(x.titel) === titel && xStr(x.jahr) === jahr);
      const o = m && ctx.origMassn.get(m);
      if (!o) continue;
      let n = 0;
      const s = xAuswahl(z('Status'), _MASSN_STATUS_WERTE);
      if (s === undefined) meld(`Status: „${z('Status')}" ist nicht erlaubt`);
      else if (s && s !== (o.status || 'geplant')) { m.status = s; n++; }
      if (!istLeer(z('Kosten €')) && zahlGeaendert(xNum(o.kosten) ?? 0, z('Kosten €'), 2)) { m.kosten = xNum(z('Kosten €')) ?? 0; n++; }
      if (n) { ctx.anz.massn++; ctx.assetsGeaendert.add(a.id); }
      continue;
    }

    const mid = xStr(z('Maßnahmen-ID'));
    if (!mid) { _massnahmeNeu(row, k, r, ctx, assets, edges, varListe); continue; }
    const x = index.get(mid);
    const o = x && ctx.origMassn.get(x.m);
    if (!o) { meld(`Maßnahme „${mid}" nicht gefunden`); continue; }
    const m = x.m;
    let n = 0;

    const titel = xStr(z('Titel'));
    if (titel && titel !== xStr(o.titel)) { m.titel = titel; n++; }
    if (k.hat('Jahr') && zahlGeaendert(o.jahr, z('Jahr'), 0)) {
      const j = xInt(z('Jahr'));
      if (j == null && !istLeer(z('Jahr'))) meld(`Jahr: „${z('Jahr')}" ist keine Jahreszahl`);
      else { m.jahr = j; n++; }
    }
    if (k.hat('Kosten €') && zahlGeaendert(xNum(o.kosten) ?? 0, xNum(z('Kosten €')) ?? 0, 2)) {
      const kosten = xNum(z('Kosten €'));
      if (kosten == null && !istLeer(z('Kosten €'))) meld(`Kosten: „${z('Kosten €')}" ist keine Zahl`);
      else { m.kosten = kosten ?? 0; n++; }
    }
    if (k.hat('Status')) {
      const s = xAuswahl(z('Status'), _MASSN_STATUS_WERTE);
      if (s === undefined) meld(`Status: „${z('Status')}" ist nicht erlaubt (${Object.values(_MASSN_STATUS_WERTE).join(', ')})`);
      else if (s && s !== (o.status || 'geplant')) { m.status = s; n++; }
    }
    if (k.hat('Maßnahmentyp')) {
      const werte = _MASSN_TYP_WERTE[x.art];
      const zelle = z('Maßnahmentyp');
      const s = werte ? xAuswahl(zelle, werte) : undefined;
      if (s === undefined) {
        if (textGeaendert(o.typ, zelle) && textGeaendert(werte?.[o.typ], zelle))
          meld(werte ? `Maßnahmentyp: „${zelle}" ist nicht erlaubt (${Object.values(werte).join(', ')})`
                     : 'Maßnahmentyp von Gebäude-Maßnahmen ist im Excel nicht änderbar');
      } else if (s && s !== o.typ) { m.typ = s; n++; }
    }
    if (k.hat('Gilt für')) {
      const res = geltungLesen(z('Gilt für'), varListe);
      if (res.fehler) meld(`Gilt für: ${res.fehler}`);
      else if (res.aendern && !('variante' in o && o.variante === res.wert)) { m.variante = res.wert; n++; }
    }
    if (k.hat('Ziel-Parameter')) {
      const { props, unbekannt } = zielParameterLesen(z('Ziel-Parameter'), x.zielDefs, Object.keys(o.newProps || {}));
      if (unbekannt.length) meld(`Ziel-Parameter: unbekannt ${unbekannt.map(u => `„${u}"`).join(', ')}`);
      else if (!zielParameterGleich(props, o.newProps)) { m.newProps = props; n++; }
    }
    if (n) {
      ctx.anz.massn++;
      if (x.art === 'Asset') ctx.assetsGeaendert.add(x.obj.id);
      if (x.art === 'Kabel') ctx.kabelGeaendert = true;
    }
  }
}

// Neue Maßnahme aus einer Zeile ohne Maßnahmen-ID — Felder wie in den Inspektor-Formularen
function _massnahmeNeu(row, k, r, ctx, assets, edges, varListe) {
  const z = spalte => k.zelle(row, spalte);
  const meld = t => ctx.melde('Maßnahmen', r, t);
  const art = xAuswahl(z('Objekt'), _MASSN_OBJEKT_WERTE);
  const oid = xStr(z('Objekt-ID')), titel = xStr(z('Titel'));
  if (!art && !oid && !titel) return;   // Leerzeile
  if (!art || !oid || !titel) { meld('neue Maßnahme braucht Objekt (Asset/Kabel), Objekt-ID und Titel'); return; }
  if (art === 'Gebaeude') { meld('Gebäude-Maßnahmen entstehen über Cluster-Pakete und sind im Excel nicht anlegbar'); return; }
  const obj = art === 'Asset' ? assets.find(a => String(a.id) === oid) : edges.find(e => String(e.id) === oid);
  if (!obj) { meld(`${art} „${oid}" nicht gefunden`); return; }

  const werte = _MASSN_TYP_WERTE[art];
  const typ = xAuswahl(z('Maßnahmentyp'), werte);
  if (typ === undefined) { meld(`Maßnahmentyp: „${z('Maßnahmentyp')}" ist nicht erlaubt (${Object.values(werte).join(', ')})`); return; }
  const status = xAuswahl(z('Status'), _MASSN_STATUS_WERTE);
  if (status === undefined) { meld(`Status: „${z('Status')}" ist nicht erlaubt`); return; }
  const zielDefs = art === 'Asset' ? (ASSET_PROPS_SCHEMA[obj.type] || []) : _KABEL_ZIEL_DEFS;
  const { props, unbekannt } = zielParameterLesen(z('Ziel-Parameter'), zielDefs);
  if (unbekannt.length) { meld(`Ziel-Parameter: unbekannt ${unbekannt.map(u => `„${u}"`).join(', ')}`); return; }
  const gilt = geltungLesen(z('Gilt für'), varListe);
  if (gilt.fehler) { meld(`Gilt für: ${gilt.fehler}`); return; }

  const m = {
    id: createId(art === 'Asset' ? 'm' : 'cm'),
    titel, jahr: xInt(z('Jahr')), kosten: xNum(z('Kosten €')) ?? 0,
    typ: typ || Object.keys(werte)[0], status: status || 'geplant',
  };
  if (Object.keys(props).length) m.newProps = props;
  if (art === 'Asset') {
    m.newProps = m.newProps || {};
    m.dependsOn = [];
    m.phaseId = null;
    // Ohne Angabe: dieselbe Vorbelegung wie im Formular (Standardregel nach Schicht/Typ)
    if (gilt.aendern) m.variante = gilt.wert;
    else if (typeof window.massnahmeGeltungWert === 'function') m.variante = window.massnahmeGeltungWert({ typ: m.typ }, obj) || null;
    ctx.assetsGeaendert.add(obj.id);
  } else {
    if (gilt.aendern) m.variante = gilt.wert;
    ctx.kabelGeaendert = true;
  }
  if (!obj.massnahmen) obj.massnahmen = [];
  obj.massnahmen.push(m);
  ctx.anz.massnNeu++;
}

// ── Import: Verbindungen aus Excel (Verbindungen-Sheet) ──────────────────────
export async function importVerbindungenXLSX(event) {
  const file = event.target.files?.[0];
  if (!file) return;

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

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const wb = XLSXLib.read(ev.target.result, { type: 'array' });
      const ws = wb.Sheets['Verbindungen'];
      if (!ws) { alert('Sheet “Verbindungen” nicht gefunden.'); return; }

      const rows = XLSXLib.utils.sheet_to_json(ws, { header: 1 });
      const header = rows[0] || [];
      const iVon  = header.findIndex(h => String(h).toLowerCase().includes('von'));
      const iNach = header.findIndex(h => String(h).toLowerCase().includes('nach'));
      const iTyp  = header.findIndex(h => String(h).toLowerCase().includes('typ'));
      const iQs   = header.findIndex(h => String(h).toLowerCase().includes('querschnitt'));
      if (iVon < 0 || iNach < 0) { alert('Spalten “Von” und “Nach” nicht gefunden.'); return; }

      // Asset-Name → ID Map (Assets + StromNodes)
      const allAssets = window.ASSETS?.items || [];
      const assetByName = new Map(allAssets.map(a => [
        (a.name || String(a.id)).toLowerCase().trim(), a.id
      ]));
      const nodeByName = new Map((window.stromNodes || []).map(n => [
        (n.label || n.name || String(n.id)).toLowerCase().trim(), n.id
      ]));
      const resolveId = name => {
        const key = String(name || '').toLowerCase().trim();
        return assetByName.get(key) ?? nodeByName.get(key) ?? null;
      };

      let added = 0, dupSkipped = 0, notFound = [];

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const vonName  = row[iVon]  != null ? String(row[iVon]).trim()  : '';
        const nachName = row[iNach] != null ? String(row[iNach]).trim() : '';
        if (!vonName || !nachName) continue;

        const uId = resolveId(vonName);
        const vId = resolveId(nachName);
        if (!uId || !vId) {
          notFound.push(`”${vonName}” → “${nachName}”`);
          continue;
        }

        // Bereits vorhandene Verbindung überspringen
        const exists = (window.stromEdges || []).some(
          ex => (ex.u === uId && ex.v === vId) || (ex.u === vId && ex.v === uId)
        );
        if (exists) { dupSkipped++; continue; }

        // addStromEdge: Trassen-Routing + Längenberechnung bereits eingebaut
        const edge = window.addStromEdge?.(uId, vId);
        if (!edge) { notFound.push(`”${vonName}” → “${nachName}” (Fehler)`); continue; }

        // Kabeltyp
        // Über den Plan-Parser, damit auch Schreibvarianten wie „NAYY-J" oder
        // „NA2XS(F)2Y" ankommen.
        const typVal = iTyp >= 0 && row[iTyp] ? parseKabelLabel(row[iTyp])?.cableType : null;
        if (typVal && KABEL_TYPEN[typVal]) edge.cableType = typVal;

        // Querschnitt: angegeben → fix; leer → Auto-Auslegung
        const qsVal = iQs >= 0 ? parseFloat(row[iQs]) : NaN;
        if (!isNaN(qsVal) && qsVal > 0) {
          edge.crossSection = qsVal;
          edge.autoSized = false;
        } else {
          edge.crossSection = 0;
          edge.autoSized = true;
        }
        added++;
      }

      if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();
      if (typeof window.elCalcAssets    === 'function') window.elCalcAssets();

      let msg = `${added} Verbindung(en) erstellt.`;
      if (dupSkipped) msg += ` ${dupSkipped} bereits vorhanden.`;
      if (notFound.length) msg += `\nNicht gefunden:\n${notFound.slice(0, 5).join('\n')}${notFound.length > 5 ? `\n(+${notFound.length - 5} weitere)` : ''}`;
      alert(msg);

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
appLifecycle.interval(() => {
  updateLpNetzSummary();
  updateLpMeritOrder();
  updateLpStromSummary();
}, 2000);

// ── Export: Feldapp JSON ──────────────────────────────────────────────────────
export function exportFeldapp() {
  // JSON-Replacer: überspringt Leaflet-Objekte, DOM-Elemente und zirkuläre Refs
  const SKIP = new Set(['_marker','_line','_circle','_polygon','_polyline',
    'polygonLayer','markerLayer','circleLayer','_leaflet_id','_events',
    '_eventParents','_map','_latlng','_layers','_renderer','pane']);
  const seen = new WeakSet();
  function replacer(key, val) {
    if (SKIP.has(key)) return undefined;
    if (typeof val === 'function') return undefined;
    if (val instanceof Element) return undefined;
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) return undefined;
      seen.add(val);
    }
    return val;
  }

  const erzeugerKeys = ['lwWp','geoThermie','pelletsKessel','heizhackschnitzel','fernwaerme'];
  const erzeuger = {};
  erzeugerKeys.forEach(k => {
    if (window[k]?.lat != null) erzeuger[k] = window[k];
  });

  const payload = {
    _feldappVersion: 1,
    exportedAt: new Date().toISOString(),
    projektName: getProjektName() || 'Energieplanung',
    gebaeude: (gebaeude || []).map(g => ({
      ...g,
      polygon: (g.polygon || []).map(p =>
        Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng }
      ),
    })),
    ...erzeuger,
    trasse: (window.trasse || []).map(p =>
      p?.lat != null ? { lat: p.lat, lng: p.lng } : p
    ),
    trasseSegments: window.trasseSegments || [],
    elektroAssets: {
      items: (ASSETS.items || []),
      edges: (window.getCanonicalAssetEdges?.() || []).map(e => ({
        id:e.id, u:e.u, v:e.v, cableType:e.cableType, crossSection:e.crossSection,
        autoSized:e.autoSized, lengthM:e.lengthM, fuseA:e.fuseA, nParallel:e.nParallel,
        autoGenerated:e.autoGenerated, msLevel:e.msLevel, trennstelle:e.trennstelle
      })),
    },
  };

  try {
    const json = JSON.stringify(payload, replacer, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = projektExportFilename('feldapp', 'json');
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert('Export-Fehler: ' + err.message);
    console.error(err);
  }
}

// ── Import: Felddaten aus Feldapp-ZIP ─────────────────────────────────────────
export function importFelddaten() {
  let inp = document.getElementById('_felddatenInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = '_felddatenInput';
    inp.accept = '.zip,.json';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', _handleFelddatenImport);
  }
  inp.value = '';
  inp.click();
}

async function _handleFelddatenImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  try {
    let projektDaten;
    const photoMap = {}; // assetId → [{name, dataUrl}]

    if (file.name.endsWith('.zip')) {
      // ZIP einlesen mit JSZip
      if (typeof JSZip === 'undefined') {
        alert('JSZip nicht geladen – bitte Seite neu laden.');
        return;
      }
      const zip = await JSZip.loadAsync(await file.arrayBuffer());

      // JSON lesen
      const jsonFile = zip.file('projekt_felddaten.json');
      if (!jsonFile) throw new Error('projekt_felddaten.json nicht im ZIP gefunden.');
      projektDaten = JSON.parse(await jsonFile.async('string'));

      // Fotos lesen — alle Bild-Dateien aus dem ZIP extrahieren
      const photoFiles = Object.keys(zip.files).filter(n =>
        /\.(jpg|jpeg|png)$/i.test(n) && !zip.files[n].dir
      );
      for (const path of photoFiles) {
        const blob = await zip.files[path].async('blob');
        const dataUrl = await new Promise(res => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.readAsDataURL(blob);
        });
        // Pfad normalisieren (Windows-Backslashes → Forward-Slashes)
        const normPath = path.replace(/\\/g, '/');
        const parts    = normPath.split('/').filter(Boolean);
        const fileName = parts[parts.length - 1];
        const folder   = parts.slice(0, -1).join('/');
        photoMap[normPath] = { dataUrl, fileName, folder };
      }
    } else {
      // Direkt JSON
      projektDaten = JSON.parse(await file.text());
    }

    // Felddaten in bestehende Gebäude übernehmen
    let updGeb = 0, updAssets = 0;

    for (const feldGeb of (projektDaten.gebaeude || [])) {
      const g = gebaeude.find(x => x.id === feldGeb.id);
      if (!g) continue;
      if (feldGeb.feldNotizen !== undefined) g.feldNotizen = feldGeb.feldNotizen;
      if (feldGeb.feldStatus  !== undefined) g.feldStatus  = feldGeb.feldStatus;
      if (feldGeb.feldVorgemerkt !== undefined) g.feldVorgemerkt = feldGeb.feldVorgemerkt;

      // Fotos zuordnen — normalisiert und mit Fallback
      if (Object.keys(photoMap).length) {
        const fotoOrdner = (feldGeb.feldFotoOrdner || '').split('\\').join('/').replace(/\/+$/, '');
        const fotos = Object.values(photoMap).filter(p => {
          const pFolder = p.folder.split('\\').join('/').replace(/\/+$/, '');
          // Exakter Match ODER Ordner endet auf den gleichen Namen
          return pFolder === fotoOrdner ||
                 pFolder.endsWith('/' + fotoOrdner.split('/').pop());
        });
        if (fotos.length > 0) {
          g.feldFotos = fotos.map(p => ({ name: p.fileName, dataUrl: p.dataUrl }));
        }
      }
      updGeb++;
    }

    // Felddaten in Elektro-Assets übernehmen
    for (const feldAsset of (projektDaten.elektroAssets?.items || [])) {
      const a = ASSETS.items.find(x => x.id === feldAsset.id);
      if (!a) continue;
      if (feldAsset.feldNotizen    !== undefined) a.feldNotizen    = feldAsset.feldNotizen;
      if (feldAsset.feldStatus     !== undefined) a.feldStatus     = feldAsset.feldStatus;
      if (feldAsset.feldVorgemerkt !== undefined) a.feldVorgemerkt = feldAsset.feldVorgemerkt;
      // Fotos zuordnen
      if (Object.keys(photoMap).length) {
        const fotoOrdner = (feldAsset.feldFotoOrdner || '').split('\\').join('/').split('/').filter(Boolean).join('/');
        const fotos = Object.values(photoMap).filter(p => {
          const pFolder = p.folder.split('\\').join('/').split('/').filter(Boolean).join('/');
          return pFolder === fotoOrdner ||
                 pFolder.endsWith('/' + fotoOrdner.split('/').pop());
        });
        if (fotos.length > 0) {
          a.feldFotos = fotos.map(p => ({ name: p.fileName, dataUrl: p.dataUrl }));
        }
      }
      updAssets++;
    }

    // Erzeuger
    const erzKeys = ['lwWp','geoThermie','pelletsKessel','heizhackschnitzel','fernwaerme'];
    for (const key of erzKeys) {
      if (projektDaten[key] && window[key]) {
        if (projektDaten[key].feldNotizen !== undefined) window[key].feldNotizen = projektDaten[key].feldNotizen;
        if (projektDaten[key].feldStatus  !== undefined) window[key].feldStatus  = projektDaten[key].feldStatus;
        if (projektDaten[key].feldVorgemerkt !== undefined) window[key].feldVorgemerkt = projektDaten[key].feldVorgemerkt;
      }
    }

    // UI aktualisieren
    if (typeof renderList === 'function') renderList();
    if (typeof renderSidebarAssetList === 'function') renderSidebarAssetList();

    const fotoCount = Object.values(photoMap).length;
    const gebMitFotos = (window.gebaeude || []).filter(g => g.feldFotos?.length > 0).length;
    console.log('Foto-Import Debug:', { fotoCount, gebMitFotos, photoMapKeys: Object.keys(photoMap).slice(0,3) });
    alert(`✓ Felddaten importiert:\n${updGeb} Gebäude aktualisiert\n${updAssets} Assets aktualisiert\n${fotoCount} Fotos geladen (${gebMitFotos} Gebäude mit Fotos)`);

  } catch (err) {
    alert('Fehler beim Import: ' + err.message);
    console.error(err);
  }
}

// ── Feldapp-Panel (bündelt Felddaten-Filter, Galerie, Bericht) ───────────────
let _feldappPanelOpen = false;

export function toggleFeldappPanel() {
  _feldappPanelOpen = !_feldappPanelOpen;
  const panel = document.getElementById('feldapp-panel');
  const btn   = document.getElementById('btn-feldapp-toggle');
  if (!panel) return;
  panel.style.display = _feldappPanelOpen ? 'block' : 'none';
  btn?.classList.toggle('active', _feldappPanelOpen);
}

// ── Felddaten-Filter (Karte + Liste) ─────────────────────────────────────────
let _felddatenFilterActive = false;

export function toggleFelddatenFilter() {
  _felddatenFilterActive = !_felddatenFilterActive;
  const btn = document.getElementById('btn-felddaten-filter');
  if (btn) {
    btn.style.background = _felddatenFilterActive ? '#f59e0b' : '';
    btn.style.color      = _felddatenFilterActive ? 'white'   : '#f59e0b';
    btn.title = _felddatenFilterActive
      ? 'Filter aktiv: nur Objekte mit Felddaten — klicken zum Deaktivieren'
      : 'Nur Objekte mit Felddaten anzeigen';
  }

  // Gebäude-Liste filtern
  document.querySelectorAll('.geb-card').forEach(card => {
    const id = card.id?.replace('card-', '');
    const g = (window.gebaeude || []).find(x => String(x.id) === id);
    if (!g) return;
    const hatFeld = g.feldNotizen || g.feldStatus || g.feldFotos?.length;
    card.style.display = _felddatenFilterActive && !hatFeld ? 'none' : '';
  });

  // Asset-Sidebar filtern
  document.querySelectorAll('.sb-asset-row').forEach(row => {
    const id = row.dataset.assetId;
    const a = (window.ASSETS?.items || []).find(x => x.id === id);
    if (!a) return;
    const hatFeld = a.feldNotizen || a.feldStatus;
    row.style.display = _felddatenFilterActive && !hatFeld ? 'none' : '';
  });

  // Zähler im Button aktualisieren
  if (_felddatenFilterActive) {
    const gebCount = (window.gebaeude || []).filter(g => g.feldNotizen || g.feldStatus || g.feldFotos?.length).length;
    const assetCount = (window.ASSETS?.items || []).filter(a => a.feldNotizen || a.feldStatus).length;
    if (btn) btn.textContent = `\u{1F4F1} ${gebCount + assetCount} Felddaten`;
  } else {
    if (btn) btn.innerHTML = '&#128241; Felddaten';
  }
}

// ── Fotogalerie ───────────────────────────────────────────────────────────────
export function openFotoGalerie() {
  const panel = document.getElementById('galerie-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  _renderGalerie();

  document.getElementById('galerie-filter').onchange = _renderGalerie;
  document.getElementById('galerie-search').oninput  = _renderGalerie;
}

export function closeFotoGalerie() {
  const panel = document.getElementById('galerie-panel');
  if (panel) panel.style.display = 'none';
}
window.closeFotoGalerie = closeFotoGalerie;

function _renderGalerie() {
  const filter = document.getElementById('galerie-filter')?.value || 'all';
  const query  = (document.getElementById('galerie-search')?.value || '').toLowerCase();
  const grid   = document.getElementById('galerie-grid');
  const summary = document.getElementById('galerie-summary');
  if (!grid) return;

  // Alle Fotos aus Gebäuden und Assets sammeln
  const items = [];

  if (filter !== 'assets') {
    (window.gebaeude || []).forEach(g => {
      (g.feldFotos || []).forEach(foto => {
        items.push({
          dataUrl: foto.dataUrl,
          name: foto.name,
          objekt: g.name || 'Gebäude ' + g.id,
          typ: 'Gebäude',
          nutzung: g.nutzung || '',
          notiz: g.feldNotizen || '',
          status: g.feldStatus || '',
        });
      });
    });
  }

  if (filter !== 'gebaeude') {
    (window.ASSETS?.items || []).forEach(a => {
      (a.feldFotos || []).forEach(foto => {
        const cfg = window.ASSET_CFG?.[a.type] || {};
        items.push({
          dataUrl: foto.dataUrl,
          name: foto.name,
          objekt: a.name || cfg.label || a.type,
          typ: cfg.label || a.type,
          notiz: a.feldNotizen || '',
          status: a.feldStatus || '',
        });
      });
    });
  }

  // Filter anwenden
  const filtered = query
    ? items.filter(i => i.objekt.toLowerCase().includes(query) || i.notiz.toLowerCase().includes(query) || i.name.toLowerCase().includes(query))
    : items;

  // Summary
  const statusCount = { erledigt: 0, besucht: 0, offen: 0 };
  filtered.forEach(i => { if (statusCount[i.status] !== undefined) statusCount[i.status]++; });
  summary.textContent = `${filtered.length} Fotos · ${statusCount.erledigt} ✅ erledigt · ${statusCount.besucht} 👁 besucht · ${statusCount.offen} 📋 offen`;

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--muted);">
      <div style="font-size:40px;margin-bottom:12px;">📷</div>
      <div style="font-size:14px;">Keine Fotos gefunden.<br>Importiere zuerst einen Feldapp-Export.</div>
    </div>`;
    return;
  }

  const statusIcon  = { erledigt: '✅', besucht: '👁', offen: '📋' };
  const statusColor = { erledigt: '#16a34a', besucht: '#2563eb', offen: '#9ca3af' };

  grid.innerHTML = filtered.map((item, i) => `
    <div onclick="openGalerieLightbox(${i})" style="cursor:pointer;border-radius:10px;overflow:hidden;background:var(--surface);border:1px solid var(--border);transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform=''">
      <div style="position:relative;aspect-ratio:4/3;overflow:hidden;background:#111;">
        <img src="${item.dataUrl}" alt="${escHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;">
        ${item.status ? `<span style="position:absolute;top:6px;right:6px;font-size:16px;">${statusIcon[item.status] || ''}</span>` : ''}
      </div>
      <div style="padding:8px 10px;">
        <div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.objekt)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${escHtml(item.typ)} · ${escHtml(item.name)}</div>
        ${item.notiz ? `<div style="font-size:10px;color:var(--muted);margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escHtml(item.notiz)}</div>` : ''}
      </div>
    </div>
  `).join('');

  // Lightbox-Daten speichern
  window._galerieItems = filtered;
}

export function openGalerieLightbox(idx) {
  const items = window._galerieItems || [];
  const item  = items[idx];
  if (!item) return;
  const lb = document.getElementById('galerie-lightbox');
  const img = document.getElementById('galerie-lightbox-img');
  const meta = document.getElementById('galerie-lightbox-meta');
  if (!lb || !img) return;
  img.src = item.dataUrl;
  const statusLabel = { erledigt: '✅ Erledigt', besucht: '👁 Besucht', offen: '📋 Offen' }[item.status] || '';
  meta.textContent = `${item.objekt} · ${item.typ}\n${item.name}${statusLabel ? ' · ' + statusLabel : ''}${item.notiz ? '\n' + item.notiz.substring(0,120) + (item.notiz.length > 120 ? '…' : '') : ''}`;
  meta.style.whiteSpace = 'pre-line';
  lb.style.display = 'flex';
}
window.openGalerieLightbox = openGalerieLightbox;

export function closeGalerieLightbox() {
  const lb = document.getElementById('galerie-lightbox');
  if (lb) lb.style.display = 'none';
}
window.closeGalerieLightbox = closeGalerieLightbox;

// Vergrößerte Einzelbild-Ansicht (z. B. Felddaten-Fotos im Inspektor) — nutzt
// dieselbe Lightbox wie die Fotogalerie, aber ohne Galerie-Kontext/Navigation.
export function openImageLightbox(src, title) {
  const lb   = document.getElementById('galerie-lightbox');
  const img  = document.getElementById('galerie-lightbox-img');
  const meta = document.getElementById('galerie-lightbox-meta');
  if (!lb || !img) return;
  img.src = src;
  if (meta) meta.textContent = title || '';
  lb.style.display = 'flex';
}
window.openImageLightbox = openImageLightbox;
