// ── 06c-dispatch-core.js — Merit-Order, ERZEUGER_CFG, _dispatchCore, WP-Panel ──
// ── Merit-Order System ────────────────────────────────────────────────────
// Reihenfolge bestimmt, welcher Erzeuger die Grundlast trägt.
// Neuzugänge kommen an letzter Stelle (Spitzenlast).

import { bhkw, cacheVariantResultsDebounced, fernwaerme, fliessgewaesser, gasKessel, gebaeude, geoThermie, globalYear, heizhackschnitzel, heizoelKessel, isExcluded, lwWp, pelletsKessel, solarthermieAktiv, stromEdges, stromEmF, stromEmFLZ, stromNodes, stromkessel, thermSpeicherAktiv } from './01-globals-varianten.js';
import { getComputedStats } from './02b-gebaeude.js';
import { _epKey, closeErzeugerPopup, redrawErzeugerIcons, showErzeugerPopup } from './03a-erzeuger.js';
import { calcGeoThermie } from './03b-netz.js';
import { updateLpMeritOrder } from './04a-ui-panels.js';
import { recalcStromNetz } from './05b-stromnetz.js';
import { getThermSpeicherParams, glBerechnenDebounced, glKannBerechnen, makeStProfile8760 } from './06b-gl-berechnen.js';
import { _updateLogoBars, daUpdateIfOpen, saCurrentTab, saSetTab } from './07a-analysis-charts.js';
import { calcWirtschaftPanel } from './07b-analysis-economics.js';
import { calcStromPanel } from './09b-pv-calc.js';
import { _checkShowHourlySlider, _hourlyModeActive, _updateHourlyOverlay } from './10b-hourly-live.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { DAYS_PER_YEAR } from './lib/physik-konstanten.js';

export let meritOrderKeys = [];
export let autoGkResult = null; // { leistungKw, deckungPct, waermeMwh } | false | null
export function setMeritOrderKeys(keys) { meritOrderKeys = keys; }
export function setAutoGkResult(val) { autoGkResult = val; }

// ERZEUGER_CFG → src/config/erzeuger-cfg.js

export function isErzeugerAktiv(key) {
  switch (key) {
    case 'lwwp':       return !!lwWp;
    case 'fg':         return !!fliessgewaesser;
    case 'geo':        return !!geoThermie;
    case 'fernwaerme': return !!fernwaerme;
    case 'pellets':    return !!pelletsKessel;
    case 'hhs':        return !!heizhackschnitzel;
    case 'heizoel':    return !!heizoelKessel;
    case 'gaskessel':  return !!gasKessel;
    case 'bhkw':        return !!bhkw;
    case 'stromkessel': return !!stromkessel;
    default:            return false;
  }
}

export function moBeiAktivierung(key) {
  if (!meritOrderKeys.includes(key)) {
    meritOrderKeys.push(key);
  }
  updateAllDeckungen();
  redrawErzeugerIcons();
}

export function moBeiDeaktivierung(key) {
  const idx = meritOrderKeys.indexOf(key);
  if (idx >= 0) meritOrderKeys.splice(idx, 1);
  updateAllDeckungen();
  redrawErzeugerIcons();
}

// ── Hook: wird nach glBerechnen() aufgerufen ─────────────────────────────
export function onSystemStateUpdated() {
  updateAllDeckungen();
  // Systemanalyse-Charts refreshen wenn Panel gerade offen ist
  if (document.getElementById('analyse-panel')?.classList.contains('visible')) {
    saSetTab(saCurrentTab || 'lastgang');
  }
  calcStromPanel();
  // Stromnetz aktualisieren (Lasten aus Dispatch übernehmen)
  if (stromEdges.length > 0 || stromNodes.length > 0) {
    recalcStromNetz();
  }
}

// ── Fallback-JDL aus Gebäudeverbräuchen ──────────────────────────────────
// Wird genutzt, solange keine Grundlagendaten berechnet wurden.
// Spitzenlast = Σ Gebäude-Normlast (identisch mit tot-hl Anzeige).
// Exponent alpha wird so gewählt, dass gleichzeitig die Jahresenergie stimmt:
//   jdl[0] = normLastKw  (Σ Normlast = tot-hl)
//   Σ jdl[i] ≈ gesamtMwh × 1000 kWh
export function _getFallbackJdl() {
  let gesamtMwh = 0, normLastKw = 0;
  gebaeude.forEach(g => {
    if (typeof isExcluded === 'function' && isExcluded(g.id)) return;
    const stats = typeof getComputedStats === 'function'
      ? getComputedStats(g, globalYear) : { waerme: parseFloat(g.waerme)||0, heizlast: parseFloat(g.heizlast)||0 };
    gesamtMwh  += stats.waerme   || 0;
    normLastKw += stats.heizlast || 0;
  });
  if (gesamtMwh <= 0) return null;
  if (normLastKw <= 0) normLastKw = 3 * gesamtMwh * 1000 / 8760; // Notfall-Fallback

  const n = 8760;
  // alpha so dass Σ normLastKw × ((n-i)/n)^alpha ≈ gesamtMwh × 1000
  // Σ ≈ normLastKw × n / (alpha+1)  →  alpha = normLastKw × n / (gesamtMwh × 1000) − 1
  const alpha = Math.max(0.3, normLastKw * n / (gesamtMwh * 1000) - 1);
  const jdl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    jdl[i] = normLastKw * Math.pow((n - i) / n, alpha);
  }
  return jdl;
}

// ── Quelltemperatur je WP-Typ — identisch mit CalcEngine.quellenTemp() ────
export function _quelleTemp(key, tAussen, t) {
  if (key === 'lwwp') {
    // Luft: direkt Außentemperatur
    return tAussen;
  }
  if (key === 'fg') {
    // Fließgewässer: tagesbasiert, Sinusmodell mitteleurop. Flüsse
    // Peak ~Tag 210 (Ende Juli), Minimum ~Tag 30 (Ende Januar)
    const d = Math.floor(t / 24);
    return Math.max(0.5, 10 + 8 * Math.sin(2 * Math.PI * (d - 119) / DAYS_PER_YEAR));
  }
  // Geothermie: Erdreichtemperatur — gedämpfte Sinusschwingung
  // Tiefe Sonden (~100m): nahezu konstant 10°C ±2°C
  // Abzug ΔT für Entzugsauskühlung (aus Fachplanung/EED, Default 0)
  const d = Math.floor(t / 24);
  const dtAbsenkung = parseFloat(document.getElementById('geo-dt-absenkung')?.value) || 0;
  return 10 + 2 * Math.sin(2 * Math.PI * (d - 75) / DAYS_PER_YEAR) - dtAbsenkung;
}

// ── Render-Hilfsfunktion für Deckung-Wrap ────────────────────────────────
export function _renderDeckungWrap(key, cfg, deckungPct, wpMwh, jazStr, prio, hinweis, vbh, allDeckungen, heizlastInfo) {
  const w = document.getElementById(cfg.wrapId);
  if (!w) return;
  w.style.display = 'block';

  // Hilfsfunktion: Donut-Kreisdiagramm mit Prozentzahl des aktuellen Erzeugers
  function _stackedBar(items, valueKey, currentPct, label, extraInfo) {
    if (!items || items.length === 0) return '';
    const R = 38, r = 24, cx = R + 1, cy = R + 1, size = (R + 1) * 2;
    let cumPct = 0;
    const arcs = items.map(d => {
      const val = Math.min(d[valueKey] || 0, 100);
      if (val <= 0) return '';
      const isCur = d.key === key;
      const startAngle = cumPct / 100 * 2 * Math.PI - Math.PI / 2;
      cumPct += val;
      const endAngle = cumPct / 100 * 2 * Math.PI - Math.PI / 2;
      const largeArc = val > 50 ? 1 : 0;
      const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
      const x2 = cx + R * Math.cos(endAngle),   y2 = cy + R * Math.sin(endAngle);
      const ix1 = cx + r * Math.cos(startAngle), iy1 = cy + r * Math.sin(startAngle);
      const ix2 = cx + r * Math.cos(endAngle),   iy2 = cy + r * Math.sin(endAngle);
      const opacity = isCur ? '1' : '0.4';
      const stroke = isCur ? ' stroke="rgba(255,255,255,0.6)" stroke-width="1"' : '';
      return `<path d="M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${largeArc},0 ${ix1},${iy1} Z" fill="${d.color}" opacity="${opacity}"${stroke}><title>${d.label}: ${val.toFixed(1)}%</title></path>`;
    }).join('');
    // Wenn Rest <100%: Lücke füllen
    const restPct = 100 - Math.min(cumPct, 100);
    let restArc = '';
    if (restPct > 0.5) {
      const startAngle = cumPct / 100 * 2 * Math.PI - Math.PI / 2;
      const endAngle = 2 * Math.PI - Math.PI / 2;
      const largeArc = restPct > 50 ? 1 : 0;
      const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
      const x2 = cx + R * Math.cos(endAngle),   y2 = cy + R * Math.sin(endAngle);
      const ix1 = cx + r * Math.cos(startAngle), iy1 = cy + r * Math.sin(startAngle);
      const ix2 = cx + r * Math.cos(endAngle),   iy2 = cy + r * Math.sin(endAngle);
      restArc = `<path d="M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${largeArc},0 ${ix1},${iy1} Z" fill="rgba(255,255,255,0.06)"/>`;
    }
    const pctCol = cfg.color;
    return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0;">${arcs}${restArc}
          <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="${pctCol}" font-family="'DM Mono',monospace" font-size="13" font-weight="600">${currentPct.toFixed(1)}%</text>
        </svg>
        <div style="flex:1;min-width:0;">
          <div style="font-size:10px;color:var(--text);margin-bottom:1px;">${label}</div>
          <div style="font-size:9px;color:var(--muted);">${extraInfo || ''}</div>
        </div>
      </div>`;
  }

  // Legende aller Erzeuger (einmal oben)
  let legendHtml = '';
  if (allDeckungen && allDeckungen.length > 0) {
    const legendItems = allDeckungen.map(d => {
      const isCurrent = d.key === key;
      const fw = isCurrent ? '600' : '400';
      const col = isCurrent ? d.color : 'var(--muted)';
      return `<span style="font-weight:${fw};color:${col};white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;border-radius:1px;background:${d.color};margin-right:2px;${isCurrent ? 'box-shadow:0 0 3px '+d.color : ''}"></span>${d.label}</span>`;
    }).join(' ');
    legendHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px 8px;font-size:8px;margin-bottom:6px;">${legendItems}</div>`;
  }

  // 1) Energetische Abdeckung — gestapelter Balken
  const energieExtra = `${Math.round(wpMwh).toLocaleString('de-DE')} MWh/a${jazStr ? ' · JAZ ' + jazStr : ''}`;
  const energieHtml = _stackedBar(allDeckungen, 'pct', deckungPct, 'Energetische Abdeckung', energieExtra);

  // 2) Leistungsabdeckung im Heizlastfall — gestapelter Balken
  let heizlastHtml = '';
  if (heizlastInfo && allDeckungen) {
    const { heizlastKw, nennKw, spitzenlastKw, isWp } = heizlastInfo;
    const myHlPct = spitzenlastKw > 0 ? (heizlastKw / spitzenlastKw * 100) : 0;
    const leistungLabel = isWp
      ? `Nenn ${nennKw.toFixed(0)} kW · Heizlast ${heizlastKw.toFixed(0)} kW`
      : `${nennKw.toFixed(0)} kW`;
    heizlastHtml = _stackedBar(allDeckungen, 'hlPct', myHlPct, 'Leistungsabdeckung im Heizlastfall', leistungLabel);
  }

  w.innerHTML = `${legendHtml}
    <div style="display:grid;grid-template-columns:${heizlastHtml ? '1fr 1fr' : '1fr'};gap:8px;margin-bottom:6px;">
      ${energieHtml}${heizlastHtml}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
      <span>Prio ${prio}${deckungPct > 100 ? ' · ⚠ > Last' : ''} · ${hinweis}</span>
    </div>
    ${vbh != null ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;">${Math.round(vbh).toLocaleString('de-DE')} h/a Vollbenutzung</div>` : ''}`;
}

// ── Deckungsanteil mit Merit-Order ────────────────────────────────────────
// Wenn systemState vorhanden: stundenscharfer Dispatch mit COP(T,VL)
// Sonst: LDC-Näherung aus synthetischem Fallback-Lastgang
export function updateAllDeckungen() {
  const ss = window.systemState;

  if (ss && ss.lastgangKw && ss.tempH && ss.vlH) {
    try {
      _deckungen8760(ss);
    } catch (err) {
      console.error('Dispatch-Fehler:', err);
    }
  } else {
    // Kein systemState → echte Berechnung anstoßen statt JDL-Näherung
    if (glKannBerechnen() && !_glIsRunning) {
      glBerechnenDebounced(200);
    }
    // Erzeuger-Wraps ausblenden bis echte Berechnung fertig
    setAutoGkResult(null);
    Object.values(ERZEUGER_CFG).forEach(c => {
      const w = document.getElementById(c.wrapId);
      if (w) w.style.display = 'none';
    });
    redrawErzeugerIcons();
    return;
  }
  // Variantenvergleich nach jeder Dispatch-Berechnung automatisch aktualisieren
  // Debounced: damit recalcNetz() erst Lasten berechnen kann, bevor gecacht wird
  cacheVariantResultsDebounced();
}

// ═══════════════════════════════════════════════════════════════════════════
// ── _dispatchCore: Gemeinsamer stundenscharfer Dispatch-Kern ────────────
// Wird von _deckungen8760 (Haupt-Dispatch) und _optDispatch8760 (Optimizer)
// genutzt. Der Web Worker bindet dieselbe Funktion per _dispatchCore.toString()
// ein (siehe 10d) — Funktion muss daher self-contained bleiben (keine Closures).
//
// cfg = {
//   lastgangKw, tempH, vlH,      — stündliche Profile (Float32Array / Array)
//   erzList,                      — [{key, typ, leistKw, guetegrad}, ...]
//   speicherParams,               — {kapKwh, verlustRate, entladeKw} oder null
//   stProfile,                    — stündl. ST-Ertrag (Hauptpfad) oder null
//   stExcessH,                    — stündl. ST-Überschuss (Optimizer) oder null
//   bhkwSigma, skEta, lwwpMinCop, — skalare Parameter
//   quelleTemp,                   — function(key, tAussen, t) → Quelltemp °C
//   recordHourly,                 — true: stündl. Profile + Monats-COP aufzeichnen
//   backupMode,                   — true: letzter Erzeuger hat unbegrenzte Kapazität
// }
// ═══════════════════════════════════════════════════════════════════════════
export function _dispatchCore(cfg) {
  const {
    lastgangKw, tempH, vlH,
    erzList, speicherParams,
    stProfile, stExcessH,
    bhkwSigma, skEta, lwwpMinCop,
    quelleTemp, recordHourly, backupMode,
  } = cfg;

  const n = lastgangKw.length;
  const KESSEL_KEYS = new Set(['gaskessel', 'heizoel', 'pellets', 'hhs']);
  const thSp = speicherParams;
  const hatSpeicher = thSp !== null && thSp.kapKwh > 0;
  const hatST = stProfile !== null;

  // COP-Referenz für WPs (A2/W35 Prüfpunkt)
  const copRef = {};
  for (const erz of erzList) {
    if (erz.typ === 'wp') {
      copRef[erz.key] = ((273.15 + 35) / (35 - 2)) * erz.guetegrad;
    }
  }

  // Akkumulatoren (immer)
  const thKwh = {}, elKwh = {};
  for (const erz of erzList) { thKwh[erz.key] = 0; elKwh[erz.key] = 0; }
  const wpElH   = new Float32Array(n);
  const bhkwElH = new Float32Array(n);
  const skElH   = new Float32Array(n);

  // Stündliche Profile (optional — nur Hauptpfad)
  let hourly = null;
  if (recordHourly) {
    hourly = {};
    for (const erz of erzList) { hourly[erz.key] = new Float32Array(n); }
  }

  // Monats-Akkumulatoren für WPs (optional)
  const MONTH_START_H = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
  const thKwhM = {}, elKwhM = {};
  if (recordHourly) {
    for (const erz of erzList) {
      if (erz.typ === 'wp') {
        thKwhM[erz.key] = new Float32Array(12);
        elKwhM[erz.key] = new Float32Array(12);
      }
    }
  }

  // Solarthermie (nur wenn stProfile vorhanden = Hauptpfad)
  if (hatST && recordHourly) {
    hourly['solarthermie'] = new Float32Array(n);
    thKwh['solarthermie'] = 0; elKwh['solarthermie'] = 0;
  }

  // Wärmespeicher
  let thermSOC = 0;
  const thermSocH     = (hatSpeicher && recordHourly) ? new Float32Array(n) : null;
  const thermEntladeH = (hatSpeicher && recordHourly) ? new Float32Array(n) : null;
  const thermLadeH    = (hatSpeicher && recordHourly) ? new Float32Array(n) : null;
  const thermVerlustH = (hatSpeicher && recordHourly) ? new Float32Array(n) : null;
  let thermEntladenGes = 0, thermGeladenGes = 0, thermVerlustGes = 0, thermSocMax = 0;
  if (hatSpeicher && recordHourly) {
    hourly['_thermSpeicher'] = new Float32Array(n);
    thKwh['_thermSpeicher'] = 0; elKwh['_thermSpeicher'] = 0;
  }

  // Kessel-Trennung bei aktivem Speicher
  const nonKesselErz = hatSpeicher ? erzList.filter(e => !KESSEL_KEYS.has(e.key)) : erzList;
  const kesselErz    = hatSpeicher ? erzList.filter(e => KESSEL_KEYS.has(e.key))  : [];

  // Auto-GK (Spitzenlast-Backup)
  let autoGkKwh = 0, autoGkPeakKw = 0;

  // Backup-Erzeuger (Optimizer: letzter Erzeuger hat unbegrenzte Kapazität)
  const backupErz = backupMode && erzList.length > 0 ? erzList[erzList.length - 1] : null;
  let backupPeakKw = 0, backupHourKw = 0;

  // WP-Reserven
  const wpReservesH = recordHourly ? new Array(n) : null;
  const wpResKwH    = !recordHourly ? new Float32Array(n) : null;
  const wpResCopH   = !recordHourly ? new Float32Array(n) : null;

  let gesamtKwh = 0, curMonth = 0;
  const residualH = recordHourly ? new Float32Array(n) : null;

  for (let t = 0; t < n; t++) {
    if (recordHourly && curMonth < 11 && t >= MONTH_START_H[curMonth + 1]) curMonth++;
    let residual = lastgangKw[t];
    gesamtKwh += residual;
    if (backupMode) backupHourKw = 0;

    // ── Speicher-Verluste ──
    if (hatSpeicher && thermSOC > 0) {
      const verlust = thermSOC * thSp.verlustRate;
      thermSOC = Math.max(0, thermSOC - verlust);
      if (recordHourly) thermVerlustH[t] = verlust;
      thermVerlustGes += verlust;
    }

    // ── PHASE 1a: Solarthermie (Hauptpfad — Grenzkosten = 0) ──
    if (hatST && stProfile[t] > 0.001) {
      const stOut = stProfile[t];
      const stDeck = Math.min(stOut, residual);
      if (stDeck > 0.001) {
        if (recordHourly) hourly['solarthermie'][t] = stDeck;
        thKwh['solarthermie'] += stDeck;
        residual -= stDeck;
      }
      // ST-Überschuss → Speicher
      const stExcess = stOut - stDeck;
      if (hatSpeicher && stExcess > 0.001) {
        const laden = Math.min(stExcess, thSp.kapKwh - thermSOC);
        if (laden > 0.001) {
          thermSOC += laden;
          if (recordHourly) thermLadeH[t] += laden;
          thermGeladenGes += laden;
        }
      }
    }

    // ── PHASE 1b: ST-Überschuss → Speicher (Optimizer — Lastgang bereits reduziert) ──
    if (!hatST && stExcessH && hatSpeicher && stExcessH[t] > 0.001) {
      const laden = Math.min(stExcessH[t], thSp.kapKwh - thermSOC);
      if (laden > 0.001) { thermSOC += laden; thermGeladenGes += laden; }
    }

    // ── PHASE 2: Merit-Order — Nicht-Kessel (oder alle wenn kein Speicher) ──
    const wpReservesThisH = [];
    for (const erz of nonKesselErz) {
      // Optimizer: Early-Exit wenn Bedarf gedeckt (Performance)
      if (!recordHourly && residual <= 0.001) break;

      const nennKw = erz.leistKw;
      if (nennKw <= 0) continue;

      let erreichbarKw = nennKw;
      let cop = 0;

      if (erz.typ === 'wp') {
        const tQ = quelleTemp(erz.key, tempH[t], t);
        if (erz.key === 'fg' && tQ < 2) continue;
        const tVLK = vlH[t] + 273.15;
        const tQK  = tQ + 273.15;
        const hub  = Math.max(tVLK - tQK, 0.1);
        cop = Math.min((tVLK / hub) * erz.guetegrad, 8);
        if (erz.key === 'lwwp' && lwwpMinCop > 0 && cop < lwwpMinCop) continue;
        erreichbarKw = nennKw * (cop / copRef[erz.key]);
      }

      const isBackup = backupMode && (erz === backupErz);
      let pTh;

      // BHKW-Mindestteillast 50%
      if (erz.typ === 'kwk' && !isBackup) {
        const minLastKw = nennKw * 0.5;
        if (residual >= minLastKw) {
          pTh = Math.min(erreichbarKw, Math.max(0, residual));
        } else if (hatSpeicher && (thSp.kapKwh - thermSOC) > 0.1) {
          // Wenig Bedarf, Speicher hat Platz → Mindestlast fahren
          pTh = Math.min(erreichbarKw, minLastKw);
          const ueberschuss = Math.max(0, pTh - residual);
          if (ueberschuss > 0.001) {
            const laden = Math.min(ueberschuss, thSp.kapKwh - thermSOC);
            thermSOC += laden;
            if (recordHourly) thermLadeH[t] += laden;
            thermGeladenGes += laden;
          }
        } else {
          pTh = 0;
        }
      } else {
        pTh = isBackup ? Math.max(0, residual) : Math.min(erreichbarKw, Math.max(0, residual));
      }

      if (pTh < 0.001) continue;
      thKwh[erz.key] += pTh;
      if (recordHourly) hourly[erz.key][t] = pTh;
      if (isBackup) backupHourKw += pTh;
      residual -= Math.min(pTh, residual); // nur Bedarfsanteil abziehen (BHKW-Mindestlast)

      if (erz.typ === 'wp' && cop > 0) {
        const elH = pTh / cop;
        elKwh[erz.key] += elH;
        wpElH[t] += elH;
        if (recordHourly && elKwhM[erz.key]) {
          elKwhM[erz.key][curMonth] += elH;
          thKwhM[erz.key][curMonth] += pTh;
        }
        // WP-Reserve für Speicherbeladung
        const reserveKw = Math.max(0, erreichbarKw - pTh);
        if (reserveKw > 0.1) {
          wpReservesThisH.push({ erz, key: erz.key, reserveKw, cop });
        }
      }
      if (erz.typ === 'kwk' && pTh > 0.001) {
        const elH = pTh * bhkwSigma;
        elKwh[erz.key] += elH;
        bhkwElH[t] += elH;
      }
      if (erz.key === 'stromkessel' && pTh > 0.001) {
        const elH = pTh / skEta;
        elKwh[erz.key] += elH;
        skElH[t] += elH;
      }
    }
    // WP-Reserves nach COP absteigend
    wpReservesThisH.sort((a, b) => b.cop - a.cop);
    if (recordHourly) {
      wpReservesH[t] = wpReservesThisH;
    } else {
      // Aggregierte Reserve für PV→WP→Speicher-Sim (Optimizer)
      let _wrTot = 0, _wrCW = 0;
      for (const wp of wpReservesThisH) { _wrTot += wp.reserveKw; _wrCW += wp.reserveKw * wp.cop; }
      wpResKwH[t] = _wrTot;
      wpResCopH[t] = _wrTot > 0 ? _wrCW / _wrTot : 0;
    }

    // ── PHASE 3: Speicher entladen (nach WP/BHKW, vor Kesseln) ──
    if (hatSpeicher && residual > 0.001 && thermSOC > 0.001) {
      const entladen = Math.min(residual, thermSOC, thSp.entladeKw);
      if (entladen > 0.001) {
        residual -= entladen;
        thermSOC -= entladen;
        thermEntladenGes += entladen;
        if (recordHourly) {
          thermEntladeH[t] = entladen;
          hourly['_thermSpeicher'][t] = entladen;
          thKwh['_thermSpeicher'] += entladen;
        }
      }
    }

    // ── PHASE 4: Kessel (nur bei aktivem Speicher, sonst leer) ──
    for (const erz of kesselErz) {
      if (residual <= 0.001) break;
      const nennKw = erz.leistKw;
      if (nennKw <= 0) continue;
      const isBackup = backupMode && (erz === backupErz);
      const pTh = isBackup ? Math.max(0, residual) : Math.min(nennKw, residual);
      if (pTh < 0.001) continue;
      thKwh[erz.key] += pTh;
      if (recordHourly) hourly[erz.key][t] = pTh;
      if (isBackup) backupHourKw += pTh;
      residual -= pTh;
    }

    if (backupMode && backupHourKw > backupPeakKw) backupPeakKw = backupHourKw;

    // ── PHASE 5: Residual → Auto-GK ──
    const resKw = Math.max(0, residual);
    autoGkKwh += resKw;
    if (resKw > autoGkPeakKw) autoGkPeakKw = resKw;
    if (recordHourly) residualH[t] = resKw;

    // ── PHASE 6: Speicher laden — WP tagsüber mit Netzstrom ──
    if (hatSpeicher && thermSOC < thSp.kapKwh && wpReservesThisH.length > 0) {
      const h = t % 24;
      if (h >= 8 && h < 18) {
        let restLade = Math.min(thSp.kapKwh - thermSOC, thSp.entladeKw);
        for (const wp of wpReservesThisH) {
          if (restLade <= 0.1 || wp.reserveKw <= 0.1 || wp.cop <= 0) break;
          const ladeKw = Math.min(wp.reserveKw, restLade);
          thermSOC += ladeKw;
          if (recordHourly) thermLadeH[t] += ladeKw;
          thermGeladenGes += ladeKw;
          restLade -= ladeKw;
          const extraEl = ladeKw / wp.cop;
          wpElH[t] += extraEl;
          elKwh[wp.key] += extraEl;
          if (recordHourly && elKwhM[wp.key]) {
            elKwhM[wp.key][curMonth] += extraEl;
            thKwhM[wp.key][curMonth] += ladeKw;
          }
        }
      }
    }

    if (hatSpeicher) {
      if (thermSOC > thermSocMax) thermSocMax = thermSOC;
      if (recordHourly) thermSocH[t] = thermSOC;
    }
  }

  return {
    thKwh, elKwh, gesamtKwh,
    autoGkKwh, autoGkPeakKw,
    wpElH, bhkwElH, skElH,
    // Stündlich (nur recordHourly)
    hourly, residualH,
    thermSocH, thermEntladeH, thermLadeH, thermVerlustH,
    thKwhM, elKwhM, wpReservesH,
    // Speicher-Gesamtwerte
    thermEntladenGes, thermGeladenGes, thermVerlustGes, thermSocMax,
    // Optimizer-Extras
    wpResKwH, wpResCopH, backupPeakKw,
    // Durchreichung
    hatSpeicher, hatST, speicherParams: hatSpeicher ? thSp : null,
    stProfile,
  };
}

// ── Stundenscharfer Dispatch (Hauptpfad) ─────────────────────────────────
export function _deckungen8760(ss) {
  const { lastgangKw, tempH, vlH } = ss;
  window._dimLastgangKw = lastgangKw;
  window._dimJdlSorted = null;

  const activeKeys = meritOrderKeys.filter(k => isErzeugerAktiv(k));

  // ── DOM-Werte lesen und erzList bauen ──
  function _guetegrad(k) {
    const id = ERZEUGER_CFG[k]?.guetegradId;
    const v  = id ? parseFloat(document.getElementById(id)?.value) : NaN;
    return isNaN(v) || v <= 0 ? ERZEUGER_CFG[k].guetegrad : v;
  }
  const leistungen = {};
  const erzList = activeKeys.map(k => {
    const lk = parseFloat(document.getElementById(ERZEUGER_CFG[k].leistungId)?.value) || 0;
    leistungen[k] = lk;
    return { key: k, typ: ERZEUGER_CFG[k].typ, leistKw: lk, guetegrad: _guetegrad(k) };
  });

  const bhkwSigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
  const skEta      = (parseFloat(document.getElementById('sk-eta')?.value) || 99) / 100;
  const lwwpMinCop = parseFloat(document.getElementById('lwwp-min-cop')?.value) || 0;

  const thSp      = thermSpeicherAktiv ? getThermSpeicherParams() : null;
  const stProfile = solarthermieAktiv ? makeStProfile8760() : null;

  // ── Kern-Dispatch aufrufen ──
  const r = _dispatchCore({
    lastgangKw, tempH, vlH,
    erzList,
    speicherParams: thSp,
    stProfile,
    stExcessH: null,
    bhkwSigma, skEta, lwwpMinCop,
    quelleTemp: _quelleTemp,
    recordHourly: true,
    backupMode: false,
  });

  // Kurzreferenzen
  const { thKwh, elKwh, gesamtKwh, autoGkKwh, autoGkPeakKw,
          wpElH, bhkwElH, skElH,
          hourly, residualH, thKwhM, elKwhM,
          thermSocH, thermEntladeH, thermLadeH, thermVerlustH, wpReservesH,
          thermEntladenGes, thermGeladenGes, thermVerlustGes, thermSocMax,
          hatSpeicher, hatST } = r;

  // ── Speicher-Panel aktualisieren ──
  if (hatSpeicher) {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('ts-verluste-a', (thermVerlustGes / 1000).toFixed(1) + ' MWh (' + (thermGeladenGes > 0.1 ? (thermVerlustGes / thermGeladenGes * 100).toFixed(1) : '0') + ' %)');
    el('ts-zyklen', thSp.kapKwh > 0 ? (thermEntladenGes / thSp.kapKwh).toFixed(0) : '—');
    el('ts-entladen-a', (thermEntladenGes / 1000).toFixed(1) + ' MWh');
    el('ts-geladen-a', (thermGeladenGes / 1000).toFixed(1) + ' MWh');
    el('ts-soc-max', thermSocMax.toFixed(0) + ' kWh (' + (thSp.kapKwh > 0 ? (thermSocMax / thSp.kapKwh * 100).toFixed(0) : 0) + ' %)');
  }
  // ST-Panel Dispatch-Ergebnisse
  if (hatST) {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('st-waerme', (thKwh['solarthermie'] / 1000).toFixed(1) + ' MWh (direkt)');
    const stH = hourly['solarthermie'];
    const stSpeicher = (hatSpeicher && stH) ? thermLadeH.reduce((s, v, i) => s + (r.stProfile[i] > stH[i] + 0.001 ? Math.min(v, r.stProfile[i] - stH[i]) : 0), 0) : 0;
    el('st-speicher', stSpeicher > 0 ? (stSpeicher / 1000).toFixed(1) + ' MWh' : '—');
  }

  // Speicher-Daten für calcStromPanel bereitstellen
  window._thermSpeicherState = hatSpeicher ? {
    socH: thermSocH, entladeH: thermEntladeH, ladeH: thermLadeH,
    verlustH: thermVerlustH, params: thSp, wpReservesH,
    socAfterDispatch: 0, geladenGes: thermGeladenGes
  } : null;

  // ── Heizlastfall-Leistung berechnen ──
  const _normAt = parseFloat(document.getElementById('gl-norm-at')?.value) || -12;
  const _vl5    = parseFloat(document.getElementById('gl-vl5')?.value) || 80;
  const _vl15   = parseFloat(document.getElementById('gl-vl15')?.value) || 55;
  const _vlDesign = Math.max(_vl5, _vl15);
  let _spitzenlastKw = 0;
  for (let i = 0; i < lastgangKw.length; i++) { if (lastgangKw[i] > _spitzenlastKw) _spitzenlastKw = lastgangKw[i]; }
  // copRef nachberechnen (für Heizlastfall-Dimensionierung)
  const copRef = {};
  activeKeys.filter(k => ERZEUGER_CFG[k].typ === 'wp').forEach(k => {
    copRef[k] = ((273.15 + 35) / (35 - 2)) * _guetegrad(k);
  });
  const heizlastInfos = {};
  activeKeys.forEach(key => {
    const nennKw = leistungen[key];
    const isWp = ERZEUGER_CFG[key].typ === 'wp';
    let heizlastKw = nennKw;
    if (isWp && copRef[key] > 0) {
      const tQ = _quelleTemp(key, _normAt, 0);
      const tVLK = _vlDesign + 273.15;
      const tQK  = tQ + 273.15;
      const hub  = Math.max(tVLK - tQK, 0.1);
      const copDesign = (tVLK / hub) * _guetegrad(key);
      heizlastKw = nennKw * (copDesign / copRef[key]);
    }
    heizlastInfos[key] = { nennKw, heizlastKw, spitzenlastKw: _spitzenlastKw, isWp };
  });

  // ── Deckungsanteile rendern ──
  const processed = new Set();
  const allDeckungen = [];
  const KESSEL_KEYS = new Set(['gaskessel', 'heizoel', 'pellets', 'hhs']);
  let prioCnt = 0;
  if (hatST && thKwh['solarthermie'] > 0) {
    prioCnt++;
    allDeckungen.push({ key: 'solarthermie', label: 'Solarthermie', color: '#ffab40', pct: gesamtKwh > 0 ? thKwh['solarthermie'] / gesamtKwh * 100 : 0, mwh: thKwh['solarthermie'] / 1000, hlPct: 0, prio: prioCnt });
  }
  activeKeys.forEach((key, i) => {
    const cfg = ERZEUGER_CFG[key];
    const wpMwh      = thKwh[key] / 1000;
    const deckungPct = gesamtKwh > 0 ? thKwh[key] / gesamtKwh * 100 : 0;
    const hlPct = _spitzenlastKw > 0 ? (heizlastInfos[key].heizlastKw / _spitzenlastKw * 100) : 0;
    prioCnt++;
    allDeckungen.push({ key, label: cfg.label, color: cfg.color, pct: deckungPct, mwh: wpMwh, hlPct, prio: prioCnt });
  });
  if (hatSpeicher && thKwh['_thermSpeicher'] > 0) {
    prioCnt++;
    allDeckungen.push({ key: '_thermSpeicher', label: 'Wärmespeicher', color: '#26a69a', pct: gesamtKwh > 0 ? thKwh['_thermSpeicher'] / gesamtKwh * 100 : 0, mwh: thKwh['_thermSpeicher'] / 1000, hlPct: 0, prio: prioCnt });
  }
  if (autoGkKwh > 0.1) {
    prioCnt++;
    allDeckungen.push({ key: '_autoGk', label: 'Spitzenlast-Kessel (auto)', color: '#78909c', pct: gesamtKwh > 0 ? autoGkKwh / gesamtKwh * 100 : 0, mwh: autoGkKwh / 1000, hlPct: gesamtKwh > 0 ? autoGkPeakKw / _spitzenlastKw * 100 : 0, prio: prioCnt });
  }

  activeKeys.forEach((key, i) => {
    const cfg = ERZEUGER_CFG[key];
    const wpMwh      = thKwh[key] / 1000;
    const deckungPct = gesamtKwh > 0 ? thKwh[key] / gesamtKwh * 100 : 0;
    const vbh        = leistungen[key] > 0 ? thKwh[key] / leistungen[key] : null;
    let jazStr = '';
    if (cfg.typ === 'wp' && elKwh[key] > 0) {
      const jaz = thKwh[key] / elKwh[key];
      jazStr = jaz.toFixed(2);
      const hintId = key === 'lwwp' ? 'lwwp-jaz-hint' : key === 'fg' ? 'fg-jaz-hint' : 'geo-jaz-hint';
      const hint = document.getElementById(hintId);
      if (hint) hint.textContent = jaz.toFixed(2) + ' (stundenscharf)';
      if (key === 'geo') {
        const disp = document.getElementById('geo-jaz-display');
        if (disp) disp.textContent = jaz.toFixed(2) + ' (stundenscharf)';
        const jazHid = document.getElementById('geo-jaz');
        if (jazHid) jazHid.value = jaz.toFixed(2);
      }
      _updateErzeugerWaerme(key, thKwh[key] / 1000);
      _updateWpPanelDispatch(key, thKwh[key], elKwh[key], leistungen[key], thKwhM[key], elKwhM[key]);
    } else {
      _updateErzeugerWaerme(key, thKwh[key] / 1000);
    }
    _renderDeckungWrap(key, cfg, deckungPct, wpMwh, jazStr, i + 1, 'stundenscharf · ' + leistungen[key].toFixed(0) + ' kW', vbh, allDeckungen, heizlastInfos[key]);
    processed.add(key);
  });

  Object.entries(ERZEUGER_CFG).forEach(([key, cfg]) => {
    if (!processed.has(key)) {
      const w = document.getElementById(cfg.wrapId);
      if (w) w.style.display = 'none';
    }
  });

  // ── Auto-GK ──
  if (autoGkKwh > 0.1) {
    setAutoGkResult({ leistungKw: Math.round(autoGkPeakKw), deckungPct: gesamtKwh > 0 ? autoGkKwh / gesamtKwh * 100 : 0, waermeMwh: autoGkKwh / 1000 });
  } else {
    setAutoGkResult(false);
  }

  // ── Stündliche Profile für Charts speichern ──
  window._jdlTotal     = null;
  window._jdlStack     = null;
  window._wpElHourly   = wpElH;
  window._skElHourly   = skElH;
  window._bhkwElHourly = bhkwElH;
  window._dispatchHourly = hourly;
  window._dispatchLastgangKw = lastgangKw;
  const dispKeys = [];
  if (hatST && thKwh['solarthermie'] > 0) dispKeys.push('solarthermie');
  if (hatSpeicher) {
    dispKeys.push(...activeKeys.filter(k => !KESSEL_KEYS.has(k)));
    if (thKwh['_thermSpeicher'] > 0) dispKeys.push('_thermSpeicher');
    dispKeys.push(...activeKeys.filter(k => KESSEL_KEYS.has(k)));
  } else {
    dispKeys.push(...activeKeys);
  }
  if (autoGkKwh > 0.1) {
    hourly['_autoGk'] = residualH;
    dispKeys.push('_autoGk');
  }
  window._dispatchActiveKeys = dispKeys;

  // ── Dispatch-Energiemengen für Wirtschaftlichkeitsrechnung ──
  window._dispatchEnergy = {};
  activeKeys.forEach(key => {
    window._dispatchEnergy[key] = { waermeMwh: thKwh[key] / 1000, elMwh: (elKwh[key] || 0) / 1000 };
  });
  if (hatST) window._dispatchEnergy['solarthermie'] = { waermeMwh: thKwh['solarthermie'] / 1000, elMwh: 0 };
  if (hatSpeicher) window._dispatchEnergy['_thermSpeicher'] = { waermeMwh: thKwh['_thermSpeicher'] / 1000, elMwh: 0 };
  if (autoGkKwh > 0.1) window._dispatchEnergy['_autoGk'] = { waermeMwh: autoGkKwh / 1000, elMwh: 0 };

  calcStromPanel();
  calcWirtschaftPanel();
  if (typeof _updateLogoBars === 'function') _updateLogoBars();
  daUpdateIfOpen();

  redrawErzeugerIcons();
  _checkShowHourlySlider();
  if (_hourlyModeActive) {
    const sl = document.getElementById('live-slider');
    if (sl) _updateHourlyOverlay(parseInt(sl.value) || 0);
  }
}

// ── WP-Panel-Rückkopplung aus stundenscharfem Dispatch ────────────────────
export function _updateWpPanelDispatch(key, thKwhTotal, elKwhTotal, leistungKw, thKwhM, elKwhM) {
  const thMwh = thKwhTotal / 1000;
  const elMwh = elKwhTotal / 1000;
  if (thMwh < 1) return;

  const monthlyCops = Array.from({length:12}, (_,mi) =>
    elKwhM[mi] > 0.01 ? thKwhM[mi] / elKwhM[mi] : 0);

  if (key === 'lwwp') {
    const show = id => { const e = document.getElementById(id); if (e) e.style.display = ''; };
    ['lwwp-strom-lbl','lwwp-strom','lwwp-luft-lbl','lwwp-luft','lwwp-co2-lbl','lwwp-co2'].forEach(show);
    const s  = document.getElementById('lwwp-strom');  if (s)  s.textContent = elMwh.toFixed(0) + ' MWh/a';
    const lu = document.getElementById('lwwp-luft');   if (lu) lu.textContent = (thMwh - elMwh).toFixed(0) + ' MWh/a';
    const co = document.getElementById('lwwp-co2');    if (co) co.textContent = (elMwh * stromEmF / 1000).toFixed(1) + ' t/a · ' + (elMwh * stromEmFLZ / 1000).toFixed(1) + ' t/a (Ø 2030–50)';
    _renderWpCopChart('lwwp-cop-svg', 'lwwp-cop-wrap', monthlyCops, '#00bcd4');
    // Echte JAZ aus Dispatch ins Display und hidden input schreiben
    if (elMwh > 0) {
      const jaz = thMwh / elMwh;
      const disp = document.getElementById('lwwp-jaz-display');
      if (disp) disp.textContent = jaz.toFixed(2) + ' (stundenscharf)';
      const jazHid = document.getElementById('lwwp-jaz');
      if (jazHid) jazHid.value = jaz.toFixed(2);
    }
  }

  if (key === 'fg') {
    const show = id => { const e = document.getElementById(id); if (e) e.style.display = ''; };
    ['fg-strom-lbl','fg-strom','fg-luft-lbl','fg-luft'].forEach(show);
    const s  = document.getElementById('fg-strom');  if (s)  s.textContent = elMwh.toFixed(0) + ' MWh/a';
    const lu = document.getElementById('fg-luft');   if (lu) lu.textContent = (thMwh - elMwh).toFixed(0) + ' MWh/a';
    const co = document.getElementById('fg-co2');    if (co) co.textContent = (elMwh * stromEmF / 1000).toFixed(1) + ' t/a · ' + (elMwh * stromEmFLZ / 1000).toFixed(1) + ' t/a (Ø 2030–50)';
    _renderWpCopChart('fg-cop-svg', 'fg-cop-wrap', monthlyCops, '#26a69a');
    // Echte JAZ aus Dispatch ins Display und hidden input schreiben
    if (elMwh > 0) {
      const jaz = thMwh / elMwh;
      const disp = document.getElementById('fg-jaz-display');
      if (disp) disp.textContent = jaz.toFixed(2) + ' (stundenscharf)';
      const jazHid = document.getElementById('fg-jaz');
      if (jazHid) jazHid.value = jaz.toFixed(2);
    }
  }

  if (key === 'geo') {
    const s  = document.getElementById('geo-r-strom'); if (s)  s.textContent = elMwh.toFixed(0) + ' MWh/a';
    const e  = document.getElementById('geo-r-erde');  if (e)  e.textContent = (thMwh - elMwh).toFixed(0) + ' MWh/a';
    const co = document.getElementById('geo-r-co2');   if (co) co.textContent = (elMwh * stromEmF / 1000).toFixed(1) + ' t/a · ' + (elMwh * stromEmFLZ / 1000).toFixed(1) + ' t/a (Ø 2030–50)';
    // Sondendimensionierung mit echter JAZ neu berechnen (überschreibt Carnot-Schätzung)
    calcGeoThermie();
  }
}

// ── Wärmeabgabe aus Dispatch in Panel-Feld schreiben + Display neu rechnen ─
export const _WAERME_IDS = {
  lwwp: 'lwwp-waerme', fg: 'fg-waerme', geo: 'geo-waerme',
  fernwaerme: 'fw-waerme', pellets: 'pk-waerme', hhs: 'hhs-waerme',
  heizoel: 'hko-waerme', gaskessel: 'gk-waerme', bhkw: 'bhkw-waerme',
};
export const _DISPLAY_FNS = () => ({
  lwwp: updateLwWpData, fg: updateFliessgewaesserData, geo: calcGeoThermie,
  fernwaerme: updateFernwaermeDisplay, pellets: updatePelletsDisplay,
  hhs: updateHhsDisplay, heizoel: updateHeizoelDisplay, gaskessel: updateGasKesselDisplay,
  bhkw: updateBhkwDisplay,
});
export function _updateErzeugerWaerme(key, waermeMwh) {
  if (waermeMwh < 0.1) return;
  const el = document.getElementById(_WAERME_IDS[key]);
  if (el) el.value = Math.round(waermeMwh);
  const fn = _DISPLAY_FNS()[key];
  if (fn) fn();
}

export function _renderWpCopChart(svgId, wrapId, monthlyCops, color) {
  const wrap  = document.getElementById(wrapId);
  const svgEl = document.getElementById(svgId);
  if (!wrap || !svgEl) return;
  const maxCop = Math.max(...monthlyCops);
  if (maxCop < 0.5) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  const W = 300, H = 80, PAD = {l:24, r:4, t:6, b:16};
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
  const yMax = maxCop * 1.15;
  const xStep = iW / 12;
  const MONATE = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  let d = '';
  monthlyCops.forEach((c, mi) => {
    const x = PAD.l + (mi + 0.5) * xStep;
    const y = PAD.t + iH - (c / yMax) * iH;
    d += (mi === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const x0 = PAD.l + 0.5 * xStep, xN = PAD.l + 11.5 * xStep, yBot = PAD.t + iH;

  let axes = `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${yBot}" stroke="#2a3050" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${yBot}" x2="${PAD.l+iW}" y2="${yBot}" stroke="#2a3050" stroke-width="1"/>`;
  [1,2,3].forEach(i => {
    const v = yMax * i / 3;
    const y = PAD.t + iH - (v / yMax) * iH;
    axes += `<line x1="${PAD.l}" y1="${y}" x2="${PAD.l+iW}" y2="${y}" stroke="#2a3050" stroke-width="0.4"/>
      <text x="${PAD.l-2}" y="${y+3}" text-anchor="end" fill="#7a8099" font-size="7">${v.toFixed(1)}</text>`;
  });
  MONATE.forEach((m, mi) => {
    axes += `<text x="${(PAD.l + (mi+0.5)*xStep).toFixed(1)}" y="${yBot+11}" text-anchor="middle" fill="#7a8099" font-size="7">${m}</text>`;
  });
  svgEl.innerHTML = `<path d="${d} L${xN},${yBot} L${x0},${yBot} Z" fill="${color}" opacity="0.12"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>${axes}`;
}

// ── Umsortieren der Merit-Order per Mousedown/Up (kein HTML5 DnD) ─────────
// HTML5 draggable kollidiert mit Leaflet's eigenem Drag-Handler auf dem
// Karten-Container. Deshalb: eigenes Pointer-Tracking auf document-Ebene.
export let _moDragKey = null;

export function moMouseDown(e, key) {
  e.preventDefault();
  e.stopPropagation(); // Leaflet nicht aktivieren
  _moDragKey = key;
  // Icon optisch markieren
  const el = e.currentTarget;
  el.style.outline = '2px solid #fff';
  el.style.opacity = '0.7';
  // Den nachfolgenden click-Event abfangen bevor er zum Leaflet-Map-Handler bubblet
  el.addEventListener('click', ev => ev.stopPropagation(), { once: true });
  document.addEventListener('mouseup', moMouseUp, { once: true });
}

export function moMouseUp(e) {
  if (!_moDragKey) return;
  const fromKey = _moDragKey;
  // Icon unter dem Cursor finden
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-mokey]');
  const targetKey = target?.dataset.mokey;
  // Alle Icons zurücksetzen
  document.querySelectorAll('[data-mokey]').forEach(el => {
    el.style.outline = '';
    el.style.opacity = '';
  });
  if (targetKey && targetKey !== fromKey) {
    // Echter Drag → Reihenfolge ändern
    const fromIdx = meritOrderKeys.indexOf(fromKey);
    const toIdx   = meritOrderKeys.indexOf(targetKey);
    if (fromIdx >= 0 && toIdx >= 0) {
      meritOrderKeys.splice(fromIdx, 1);
      meritOrderKeys.splice(toIdx, 0, fromKey);
      redrawErzeugerIcons();
      updateAllDeckungen();
    }
  } else if (targetKey === fromKey || (!targetKey && e.target?.closest('[data-mokey]')?.dataset.mokey === fromKey)) {
    // Kein Drag (gleiche Kachel) → Popup öffnen/schließen
    if (_epKey === fromKey) closeErzeugerPopup();
    else showErzeugerPopup(fromKey);
  }
  _moDragKey = null;
}

// Swap merit order position by direction (-1 = up, +1 = down)
export function moSwap(key, dir) {
  const idx = meritOrderKeys.indexOf(key);
  const newIdx = idx + dir;
  if (idx < 0 || newIdx < 0 || newIdx >= meritOrderKeys.length) return;
  meritOrderKeys.splice(idx, 1);
  meritOrderKeys.splice(newIdx, 0, key);
  redrawErzeugerIcons();
  updateLpMeritOrder();
  updateAllDeckungen();
}
