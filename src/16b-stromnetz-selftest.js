// ── 16b-stromnetz-selftest.js — Smoke-Tests für die Phase-3-Module ──────────
// Erzeugt ein synthetisches Mini-Strom-Setup (NAP + Trafo + 2 Verbraucher +
// 1 PV + Trasse + Leitungen), läuft alle wichtigen Module dagegen, prüft
// Plausibilität. Ergebnisse als grün/rot-Overlay.
//
// Nutzt KEINE bestehenden ASSETS/STROMNETZ-Daten — arbeitet auf eigenem
// Sandbox-State (per Snapshot vor/nach), damit User-Daten unangetastet bleiben.

import { ASSETS } from './13a-assets-core.js';
import { STROMNETZ } from './14b-stromnetz-state.js';
import { createTrasse, createStromLeitung } from './14b-stromnetz-state.js';
import { recalcStromnetz } from './15c-stromnetz-calc.js';
import { buildSldSvg } from './15d-stromnetz-sld.js';
import { createSzenario, deleteSzenario, activateSzenario,
         getMergedAssets } from './15e-stromnetz-szenarien.js';
import { parseNapCsv, calcNapStats } from './15f-stromnetz-messlastgang.js';
import { addAssetMassnahme, buildMassnahmenplan,
         removeAssetMassnahme } from './15g-stromnetz-massnahmen.js';
import { calcInvestitionsplan, buildInvestSvg, buildInvestOverviewHtml,
         getInvestitionsplanRows, getInvestitionsplanSumme } from './15h-stromnetz-invest.js';
import { getLoadPoints, kMeansCluster, findAutoK, groupByProximity,
         recommendedKvaString } from './15i-stromnetz-clustering.js';
import { buildTrassenGraph, dijkstra } from './14c-stromnetz-graph.js';

// ── Test-Datensatz erzeugen ─────────────────────────────────────────────────
function makeSandbox() {
  // Snapshot der echten Daten (rückwärts kompatibel)
  const snap = {
    items:  [...ASSETS.items],
    edges:  [...ASSETS.edges],
    trassen:[...STROMNETZ.trassen],
    selectedId: ASSETS.selectedId,
  };

  // ASSETS leeren
  ASSETS.items.length = 0;
  ASSETS.edges.length = 0;
  STROMNETZ.trassen.length = 0;

  // Mini-Setup: NAP -- Trafo -- 2 Verbraucher + 1 PV
  // Koordinaten: kleines Quadrat um (52.105, 7.99)
  const lat0 = 52.105, lng0 = 7.99;
  const mk = (id, type, dlat, dlng, props, name) => ({
    id, type, domain: 'strom',
    lat: lat0 + dlat, lng: lng0 + dlng,
    name: name || `${type}-test`,
    buildingId: null, props: props || {},
    baujahr: 2020, abrissjahr: null,
    massnahmen: [], _marker: null,
  });

  ASSETS.items.push(
    mk('test-nap',  'NAP',         0,       0,       { spannungKV: 20 },          'NAP-test'),
    mk('test-tr',   'Trafo',       0.0003,  0.0003,  { leistungKVA: 630, ukProzent: 4 }, 'Trafo-test'),
    mk('test-v1',   'Verbraucher', 0.0006,  0.0006,  { leistungKW: 30 },          'Verbraucher-1'),
    mk('test-v2',   'Verbraucher', 0.0006,  0.0001,  { leistungKW: 25 },          'Verbraucher-2'),
    mk('test-pv',   'PV',          0.0001,  0.0006,  { leistungKWp: 40 },         'PV-test'),
  );

  // Eine Trasse (NAP → Trafo → Verbraucher-Bereich)
  createTrasse([
    [lat0,         lng0],
    [lat0+0.0003,  lng0+0.0003],
    [lat0+0.0006,  lng0+0.0003],
  ], { id: 'test-tr1' });

  // Leitungen mit groben Routen + kleiner _result.laengeM (sonst Kosten=0)
  function addLine(id, aId, bId, route, qs = 50) {
    const lt = createStromLeitung(aId, bId, { id, qs, route });
    if (lt) {
      let len = 0;
      for (let i = 1; i < route.length; i++) {
        len += L.latLng(route[i-1][0], route[i-1][1])
                .distanceTo(L.latLng(route[i][0], route[i][1]));
      }
      lt._result = { laengeM: len };
    }
    return lt;
  }
  addLine('test-l1', 'test-nap', 'test-tr',
          [[lat0, lng0], [lat0+0.0003, lng0+0.0003]], 95);  // MS
  addLine('test-l2', 'test-tr', 'test-v1',
          [[lat0+0.0003, lng0+0.0003], [lat0+0.0006, lng0+0.0006]], 50);
  addLine('test-l3', 'test-tr', 'test-v2',
          [[lat0+0.0003, lng0+0.0003], [lat0+0.0006, lng0+0.0001]], 35);
  addLine('test-l4', 'test-tr', 'test-pv',
          [[lat0+0.0003, lng0+0.0003], [lat0+0.0001, lng0+0.0006]], 35);

  return snap;
}

function restoreSandbox(snap) {
  ASSETS.items.length = 0;
  ASSETS.edges.length = 0;
  STROMNETZ.trassen.length = 0;
  ASSETS.items.push(...snap.items);
  ASSETS.edges.push(...snap.edges);
  STROMNETZ.trassen.push(...snap.trassen);
  ASSETS.selectedId = snap.selectedId;
}

// ── Einzelne Tests ──────────────────────────────────────────────────────────
function runTests() {
  const tests = [];
  const ok   = (name, msg = '') => tests.push({ name, ok: true,  msg });
  const fail = (name, msg)      => tests.push({ name, ok: false, msg });

  // T1: Recalc liefert Result mit Summary
  try {
    const r = recalcStromnetz();
    if (!r || !r.summary) throw new Error('Kein Result oder Summary');
    if (parseFloat(r.summary.P_load_kW) < 50) throw new Error(`P_load_kW < 50 (war ${r.summary.P_load_kW})`);
    if (r.summary.assets !== 5)              throw new Error(`assets != 5 (war ${r.summary.assets})`);
    if (r.summary.leitungen !== 4)           throw new Error(`leitungen != 4 (war ${r.summary.leitungen})`);
    ok('Recalc: Summary plausibel',
       `Bezug ${r.summary.P_load_kW} kW, Einsp ${r.summary.P_gen_kW} kW, ${r.summary.bottlenecks} Engpässe`);
  } catch (e) { fail('Recalc', e.message); }

  // T2: Recalc füllt edge-Ergebnisse + Trafo-Ergebnis
  try {
    const r = recalcStromnetz();
    if (!r.edges || Object.keys(r.edges).length !== 4) throw new Error(`edges-Count != 4`);
    if (!r.trafoResults || r.trafoResults.length !== 1) throw new Error('trafoResults != 1');
    const tr = r.trafoResults[0];
    if (!(tr.ausl > 0 && tr.ausl < 100)) throw new Error(`Trafo-Auslastung unplausibel (${tr.ausl}%)`);
    ok('Recalc: Edges + Trafo-Auslastung',
       `Trafo ${tr.ausl.toFixed(1)}% bei ${tr.P_worst.toFixed(0)} kW`);
  } catch (e) { fail('Recalc-Detail', e.message); }

  // T3: SLD-SVG nicht leer + enthält Knoten
  try {
    const svg = buildSldSvg();
    if (!svg || svg.length < 200) throw new Error(`SVG zu kurz (${svg?.length} Zeichen)`);
    if (!svg.includes('NAP-test')) throw new Error('NAP-Name fehlt im SVG');
    if (!svg.includes('Trafo-test')) throw new Error('Trafo-Name fehlt im SVG');
    ok('SLD: SVG enthält Knoten', `${svg.length} Zeichen`);
  } catch (e) { fail('SLD', e.message); }

  // T4: Maßnahmen-CRUD
  try {
    const m = addAssetMassnahme('test-v1', { jahr: 2030, eigenschaft: 'leistungKW', wertNeu: 50, kosten: 8000 });
    if (!m || !m.id) throw new Error('Maßnahme nicht erzeugt');
    const plan = buildMassnahmenplan();
    const found = plan.find(e => e.objektId === 'test-v1' && e.jahr === 2030);
    if (!found) throw new Error('Maßnahme nicht im Plan');
    if (found.kosten !== 8000) throw new Error(`Kosten falsch (${found.kosten})`);
    removeAssetMassnahme('test-v1', m.id);
    ok('Maßnahmen: add/build/remove', `${plan.length} Einträge im Plan`);
  } catch (e) { fail('Maßnahmen', e.message); }

  // T5: Investitionsplan
  try {
    const rows = getInvestitionsplanRows({ currentYear: 2019 });
    const summe = getInvestitionsplanSumme({ currentYear: 2019 });
    if (rows.length === 0) throw new Error('Keine Plan-Zeilen');
    if (summe <= 0) throw new Error(`Summe <= 0 (${summe})`);
    const svg = buildInvestSvg(rows, { currentYear: 2024 });
    if (!svg.startsWith('<svg')) throw new Error('SVG-Header fehlt');
    ok('Invest: Plan + SVG', `${rows.length} Jahre, Summe ${Math.round(summe).toLocaleString('de-DE')} €`);
  } catch (e) { fail('Invest', e.message); }

  // T6: Szenarien-System
  try {
    const sz = createSzenario('Selftest-SZ');
    activateSzenario(sz.id);
    if (STROMNETZ.aktivSzenario !== sz.id) throw new Error('Aktivierung schlug fehl');
    const merged = getMergedAssets();
    if (merged.length !== 5) throw new Error(`Merged-Assets != 5 (war ${merged.length})`);
    activateSzenario(null);
    deleteSzenario(sz.id);
    ok('Szenarien: create/activate/merge/delete');
  } catch (e) { fail('Szenarien', e.message); }

  // T7: Trassen-Graph + Dijkstra
  try {
    const nm = buildTrassenGraph();
    if (nm.size < 2) throw new Error(`Graph hat nur ${nm.size} Knoten`);
    const keys = [...nm.keys()];
    const path = dijkstra(nm, keys[0], keys[keys.length - 1]);
    if (!path || path.length < 2) throw new Error('Dijkstra: kein Pfad');
    ok('Graph + Dijkstra', `${nm.size} Knoten, Pfad mit ${path.length} Stützpunkten`);
  } catch (e) { fail('Graph', e.message); }

  // T8: Lastpunkte + k-Means
  try {
    const pts = getLoadPoints(2024);
    if (pts.length !== 3) throw new Error(`getLoadPoints != 3 (war ${pts.length})`);
    const cl = kMeansCluster(pts, 2, 50, 3, 1.0);
    if (cl.length !== 2) throw new Error(`Cluster-Anzahl != 2`);
    if (!cl.every(c => typeof c.centroid?.lat === 'number')) throw new Error('Centroid kaputt');
    ok('Clustering: Lastpunkte + k-Means', `${pts.length} Punkte → ${cl.length} Cluster`);
  } catch (e) { fail('Clustering', e.message); }

  // T9: Auto-k mit Großverbraucher
  try {
    const pts = getLoadPoints(2024);
    const r = findAutoK(pts, 100, 0.9, 1.0, 0);
    if (!r.clusters || r.clusters.length === 0) throw new Error('Auto-k leer');
    ok('Auto-k', `k=${r.k}, ${r.whaleCount} Großverbraucher, maxKW=${r.maxKW.toFixed(0)}`);
  } catch (e) { fail('Auto-k', e.message); }

  // T10: NAP-CSV-Parser
  try {
    const csv = [
      'Zeitstempel;Wirkleistung kW',
      '01.01.2024 00:00;50,5',
      '01.01.2024 00:15;52,3',
      '01.01.2024 00:30;48,1',
      '01.01.2024 00:45;55,0',
      '01.01.2024 01:00;60,0',
      '01.01.2024 01:15;58,2',
      '01.01.2024 01:30;54,9',
      '01.01.2024 01:45;51,1',
      '01.01.2024 02:00;47,8',
      '01.01.2024 02:15;45,2',
      '01.01.2024 02:30;43,9',
    ].join('\n');
    const parsed = parseNapCsv(csv, 'selftest.csv');
    if (!parsed || parsed.raw.length !== 11) throw new Error(`Raw-Count != 11 (war ${parsed?.raw?.length})`);
    if (parsed.year !== 2024) throw new Error(`Year != 2024 (war ${parsed.year})`);
    const stats = calcNapStats(parsed.raw);
    if (stats.peak < 60) throw new Error(`Peak < 60 (war ${stats.peak})`);
    ok('NAP/CSV: Parse + Stats', `${parsed.raw.length} Werte, Peak ${stats.peak.toFixed(1)} kW`);
  } catch (e) { fail('NAP/CSV', e.message); }

  // T11: Helper-Funktionen
  try {
    const s = recommendedKvaString(420, 0.9);
    if (!s.includes('630')) throw new Error(`recommendedKvaString unerwartet: "${s}"`);
    ok('Helper: recommendedKvaString', s);
  } catch (e) { fail('Helper', e.message); }

  // T12: Build invest overview HTML (Integration)
  try {
    const html = buildInvestOverviewHtml({ currentYear: 2019 });
    if (!html || html.length < 100) throw new Error('Invest-HTML zu kurz');
    ok('Invest-Overview-HTML', `${html.length} Zeichen`);
  } catch (e) { fail('Invest-HTML', e.message); }

  // T13: Cluster-Vorgruppierung
  try {
    const pts = getLoadPoints(2024);
    const grouped = groupByProximity(pts, 200);  // 200 m Radius
    if (grouped.length === 0 || grouped.length > pts.length) throw new Error(`Grouped-Count unplausibel (${grouped.length})`);
    ok('groupByProximity', `${pts.length} → ${grouped.length} Gruppen`);
  } catch (e) { fail('groupByProximity', e.message); }

  return tests;
}

// ── Public: Self-Test starten + Overlay anzeigen ────────────────────────────
export function uiRunStromnetzSelfTest() {
  const snap = makeSandbox();
  let tests = [];
  let fatal = null;
  try {
    tests = runTests();
  } catch (e) {
    fatal = e.message + '\n' + (e.stack || '');
  } finally {
    restoreSandbox(snap);
    // Wichtig: Recalc auf echten Daten neu laufen, falls Calc-Result jetzt von Sandbox kontaminiert
    try { recalcStromnetz(); } catch {}
  }

  const passed = tests.filter(t => t.ok).length;
  const failed = tests.filter(t => !t.ok).length;
  const accent = (failed === 0 && !fatal) ? '#66bb6a' : '#ef5350';
  const headerEmoji = (failed === 0 && !fatal) ? '✅' : '⚠️';

  const rows = tests.map(t => {
    const col = t.ok ? '#66bb6a' : '#ef5350';
    const icon = t.ok ? '✓' : '✕';
    return `<tr style="border-bottom:1px solid #2a3050;">
      <td style="padding:5px 8px;color:${col};font-weight:700;text-align:center;">${icon}</td>
      <td style="padding:5px 8px;color:#cfd;">${t.name}</td>
      <td style="padding:5px 8px;color:#9aa;font-size:10px;font-family:monospace;">${t.msg || ''}</td>
    </tr>`;
  }).join('');

  const html = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;
                padding:8px 12px;background:${accent}22;border-left:4px solid ${accent};border-radius:4px;">
      <div style="font-size:24px;">${headerEmoji}</div>
      <div>
        <div style="font-size:14px;font-weight:700;color:${accent};">
          ${failed === 0 && !fatal ? 'Alle Tests grün' : `${failed} von ${tests.length} Tests fehlgeschlagen`}
        </div>
        <div style="font-size:10px;color:#9aa;">${passed} bestanden, ${failed} fehlgeschlagen
          ${fatal ? ' · 1 Fatal-Error' : ''}</div>
      </div>
    </div>
    ${fatal ? `<div style="background:#3a0e0e;color:#ff8;padding:10px;border-radius:4px;margin-bottom:10px;
      font-family:monospace;font-size:10px;white-space:pre-wrap;">FATAL: ${fatal}</div>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="border-bottom:1px solid #2a3050;color:#7a8099;font-size:9px;text-transform:uppercase;">
        <th style="padding:4px 8px;width:30px;"></th>
        <th style="padding:4px 8px;text-align:left;">Test</th>
        <th style="padding:4px 8px;text-align:left;">Detail</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px;font-size:9px;color:#7a8099;">
      Tests laufen auf synthetischem Mini-Setup (NAP, Trafo, 2 Verbraucher, PV, 4 Leitungen).
      Echte Daten werden nicht verändert (Snapshot+Restore).
    </div>`;

  // Inline overlay (16-stromnetz-ui.js's showOverlay ist privat — eigenes hier)
  const id = 'stromnetz-selftest-panel';
  const old = document.getElementById(id); if (old) old.remove();
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);
    width:680px;max-width:95vw;max-height:85vh;background:#0f1b2d;color:#cfd;
    border:2px solid ${accent};border-radius:8px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:9999;
    display:flex;flex-direction:column;font-family:'DM Sans',sans-serif;`;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:#0b0e18;border-bottom:1px solid ${accent}55;border-radius:6px 6px 0 0;">
      <div style="font-size:13px;font-weight:600;color:${accent};">🧪 Stromnetz-Self-Test</div>
      <button id="${id}-close" style="background:transparent;border:1px solid #555;
              border-radius:4px;color:#aaa;cursor:pointer;font-size:13px;padding:2px 9px;">✕</button>
    </div>
    <div style="flex:1;overflow:auto;padding:12px;">${html}</div>`;
  document.body.appendChild(el);
  document.getElementById(`${id}-close`).addEventListener('click', () => el.remove());

  return { passed, failed, fatal, tests };
}
