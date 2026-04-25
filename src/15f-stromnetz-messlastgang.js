// ── 15f-stromnetz-messlastgang.js — Messlastgang-Profile (NAP, CSV) ─────────
// Portiert aus Standalone-Elektroteil (~14866–15000).
// Reine Datenlogik:
//   - CSV → 15-min-Werte ({ts, kw}[])
//   - Statistik (peak, mean, Tagesgang, Heatmap, hourly aggregation)
//   - Profil-Speicher: napProfiles[napId] = {raw, stats, filename, year}
//
// Vereinfachungen vs Standalone:
//   - Keine UI (Import-Popup, Charts, Heatmap-Render) — kommt mit UI-Phase
//   - Keine PDF-Export (Phase 3.4 oder eigene)
//   - Keine Massnahmen-Integration (Phase 3.4)

import { STROMNETZ } from './14b-stromnetz-state.js';

// ── State-Erweiterung (lazy initialisiert) ──────────────────────────────────
function ensureProfilesContainer() {
  if (!STROMNETZ.napProfiles) STROMNETZ.napProfiles = {};
  if (STROMNETZ.napSelectedId === undefined) STROMNETZ.napSelectedId = null;
}

// ════════════════════════════════════════════════════════════════════════════
// CSV-PARSER
// ════════════════════════════════════════════════════════════════════════════
// Erkennt 'Zeitstempel' / 'Datum'+'Zeit' / 'Timestamp' und numerische Wert-Spalte.
// Akzeptiert deutsche (DD.MM.YYYY) und ISO (YYYY-MM-DD) Datumsformate.
// Komma als Dezimaltrenner wird automatisch in Punkt umgewandelt.
// MW wird zu kW skaliert wenn Spalten-Header MW enthält.
// Rückgabe: { raw: [{ts, kw}], filename, year } oder null bei Parse-Fehler.
export function parseNapCsv(text, filename) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 3) return null;

  const hdr  = lines[0].split(';').map(h => h.trim().replace(/['"]/g, ''));
  const hdrl = hdr.map(h => h.toLowerCase().replace(/\s+/g, ''));

  // Spalten-Erkennung
  let dateCol = -1, timeCol = -1, tsCol = -1, valCol = -1;
  for (let i = 0; i < hdrl.length; i++) {
    const h = hdrl[i];
    if (tsCol  < 0 && (h.includes('timestamp') || h.includes('zeitstempel') || h === 'ts' || h === 'datetime')) tsCol  = i;
    if (dateCol < 0 && (h.includes('datum') || h === 'date' || h === 'dat'))                                    dateCol = i;
    if (timeCol < 0 && (h === 'zeit' || h === 'time' || h === 'uhrzeit') && !h.includes('datum'))               timeCol = i;
    if (valCol  < 0 && (h.includes('kw') || h.includes('leistung') || h.includes('wirkleistung') ||
                        h === 'p' || h === 'wert' || h.includes('power') || h.includes('last') || h.includes('bezug')))
      valCol = i;
  }
  // Fallback: letzte numerisch befüllte Spalte
  if (valCol < 0) {
    const fd = lines[1].split(';');
    for (let i = fd.length - 1; i >= 0; i--) {
      if (!isNaN(parseFloat(fd[i].trim().replace(',', '.')))) { valCol = i; break; }
    }
  }
  if (valCol < 0) return null;

  const multiplier = (hdrl[valCol] || '').includes('mw') && !(hdrl[valCol] || '').includes('kw') ? 1000 : 1;

  function parseTS(row) {
    let s = '';
    if      (tsCol  >= 0)                  s = (row[tsCol] || '').trim();
    else if (dateCol >= 0 && timeCol >= 0) s = ((row[dateCol] || '') + ' ' + (row[timeCol] || '')).trim();
    else if (dateCol >= 0)                 s = (row[dateCol] || '').trim();
    else                                   s = ((row[0] || '') + ' ' + (row[1] || '')).trim();
    s = s.replace(/['"]/g, '');
    // DD.MM.YYYY[ HH:MM[:SS]]
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
    // YYYY-MM-DD[THH:MM[:SS]]
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
    return null;
  }

  const raw = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(';');
    if (row.length <= valCol) continue;
    const ts = parseTS(row);
    if (!ts || isNaN(ts.getTime())) continue;
    const kw = parseFloat((row[valCol] || '').trim().replace(/['"]/g, '').replace(',', '.')) * multiplier;
    if (isNaN(kw)) continue;
    raw.push({ ts, kw });
  }
  if (raw.length < 10) return null;
  raw.sort((a, b) => a.ts - b.ts);
  return { raw, filename, year: raw[0].ts.getFullYear() };
}

// ════════════════════════════════════════════════════════════════════════════
// STATISTIK
// ════════════════════════════════════════════════════════════════════════════
// Liefert peak, mean, Jahresenergie, Tagesgang (96 Slots × 15min, getrennt
// Werktag/Wochenende), Jahres-Heatmap (365×96), stündliche Aggregation (8760h),
// Grundlast (10. Perzentil), Lastfaktor, Volllaststunden, Datenvollständigkeit.
export function calcNapStats(raw) {
  const n = raw.length;
  if (n === 0) return null;

  let peak = -Infinity, minV = Infinity, sum = 0;
  for (const d of raw) { if (d.kw > peak) peak = d.kw; if (d.kw < minV) minV = d.kw; sum += d.kw; }
  const mean = sum / n;
  const jahresenergie   = sum * 0.25;            // 15-min → kWh
  const benutzungsdauer = peak > 0 ? jahresenergie / peak : 0;
  const sorted = [...raw].map(d => d.kw).sort((a, b) => b - a);

  // Tagesgang (96 Slots × 15 min, getrennt Werktag/Wochenende)
  const slotSum   = new Float64Array(96), slotN   = new Int32Array(96);
  const slotSumWd = new Float64Array(96), slotNWd = new Int32Array(96);
  const slotSumWe = new Float64Array(96), slotNWe = new Int32Array(96);
  for (const d of raw) {
    const slot = d.ts.getHours() * 4 + Math.floor(d.ts.getMinutes() / 15);
    if (slot < 0 || slot >= 96) continue;
    slotSum[slot] += d.kw; slotN[slot]++;
    const dow = d.ts.getDay();
    if (dow === 0 || dow === 6) { slotSumWe[slot] += d.kw; slotNWe[slot]++; }
    else                        { slotSumWd[slot] += d.kw; slotNWd[slot]++; }
  }
  const avgAll = Array.from(slotSum).map((s, i)   => slotN[i]   ? s / slotN[i]   : 0);
  const avgWd  = Array.from(slotSumWd).map((s, i) => slotNWd[i] ? s / slotNWd[i] : 0);
  const avgWe  = Array.from(slotSumWe).map((s, i) => slotNWe[i] ? s / slotNWe[i] : 0);

  // Jahres-Heatmap (365 Tage × 96 Viertelstunden)
  const year = raw[0].ts.getFullYear();
  const yearStart = +new Date(year, 0, 1);
  const hGrid  = new Float32Array(365 * 96);
  const hGridN = new Int16Array(365 * 96);
  for (const d of raw) {
    const day  = Math.floor((+d.ts - yearStart) / 86400000);
    const slot = d.ts.getHours() * 4 + Math.floor(d.ts.getMinutes() / 15);
    if (day < 0 || day >= 365 || slot < 0 || slot >= 96) continue;
    hGrid[day*96+slot] += d.kw; hGridN[day*96+slot]++;
  }
  const heatmapGrid = new Float32Array(365 * 96);
  for (let i = 0; i < hGrid.length; i++) if (hGridN[i]) heatmapGrid[i] = hGrid[i] / hGridN[i];

  // Stündlich aggregiert (8760 Stunden)
  const hBuckets = new Array(8760).fill(null).map(() => ({ sum: 0, n: 0 }));
  for (const d of raw) {
    const hi = Math.floor((+d.ts - yearStart) / 3600000);
    if (hi >= 0 && hi < 8760) { hBuckets[hi].sum += d.kw; hBuckets[hi].n++; }
  }
  const hourlyAgg = hBuckets.map((b, i) => ({
    ts: new Date(yearStart + i * 3600000),
    kw: b.n ? b.sum / b.n : 0,
  }));

  // Kennzahlen
  const grundlast       = sorted[Math.floor(sorted.length * 0.9)] || 0;  // 10.-Perzentil-Grundlast
  const lastfaktor      = peak > 0 ? mean / peak : 0;
  const volllaststunden = peak > 0 ? jahresenergie / peak : 0;

  // Überschreitungsstunden
  const ueberschreitungsstunden80 = raw.filter(d => d.kw > peak * 0.8).length * 0.25;
  const ueberschreitungsstunden50 = raw.filter(d => d.kw > peak * 0.5).length * 0.25;

  // Datenvollständigkeit
  const erwartetSlots = 365 * 96;
  const fehlendSlots  = erwartetSlots - n;
  const datenvollstaendigkeit = Math.min(100, (n / erwartetSlots) * 100);

  return {
    n, peak, minV, mean, sum, jahresenergie, benutzungsdauer,
    sorted, avgAll, avgWd, avgWe, heatmapGrid, hourlyAgg, year,
    grundlast, lastfaktor, volllaststunden,
    ueberschreitungsstunden80, ueberschreitungsstunden50,
    datenvollstaendigkeit, fehlendSlots,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// LÜCKENANALYSE
// ════════════════════════════════════════════════════════════════════════════
export function calcNapGaps(raw, year) {
  const yr = year ?? raw[0]?.ts?.getFullYear();
  if (!yr) return { maxGap: 0, gapCount: 0 };
  const yearStart = +new Date(yr, 0, 1);
  const erwartet = 365 * 96;
  const slotSet = new Set();
  for (const d of raw) {
    const diff = +d.ts - yearStart;
    if (diff >= 0) slotSet.add(Math.floor(diff / 900000));  // 900000ms = 15min
  }
  let maxGap = 0, curGap = 0, gapCount = 0;
  for (let i = 0; i < erwartet; i++) {
    if (!slotSet.has(i)) { curGap++; if (curGap === 1) gapCount++; }
    else { if (curGap > maxGap) maxGap = curGap; curGap = 0; }
  }
  if (curGap > maxGap) maxGap = curGap;
  return { maxGap, gapCount };
}

// ════════════════════════════════════════════════════════════════════════════
// NAP-PROFIL-SPEICHER
// ════════════════════════════════════════════════════════════════════════════
// CSV importieren und einem NAP-Asset zuordnen.
export function importNapProfile(napId, csvText, filename) {
  if (!napId) return { ok: false, error: 'Keine NAP-ID angegeben.' };
  ensureProfilesContainer();
  const parsed = parseNapCsv(csvText, filename);
  if (!parsed) return { ok: false, error: 'CSV konnte nicht geparst werden (Format prüfen).' };
  const stats = calcNapStats(parsed.raw);
  const gaps  = calcNapGaps(parsed.raw, parsed.year);
  STROMNETZ.napProfiles[napId] = {
    raw:      parsed.raw,
    filename: parsed.filename,
    year:     parsed.year,
    stats,
    gaps,
  };
  return { ok: true, profile: STROMNETZ.napProfiles[napId] };
}

export function getNapProfile(napId) {
  ensureProfilesContainer();
  return STROMNETZ.napProfiles[napId] || null;
}

export function removeNapProfile(napId) {
  ensureProfilesContainer();
  if (STROMNETZ.napProfiles[napId]) {
    delete STROMNETZ.napProfiles[napId];
    return true;
  }
  return false;
}

export function listNapProfiles() {
  ensureProfilesContainer();
  return Object.entries(STROMNETZ.napProfiles).map(([napId, p]) => ({
    napId,
    filename: p.filename,
    year:     p.year,
    n:        p.stats?.n,
    peak:     p.stats?.peak,
    jahresenergie: p.stats?.jahresenergie,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// NAP-Auswahl (für UI später)
export function selectNap(napId) {
  ensureProfilesContainer();
  STROMNETZ.napSelectedId = napId || null;
  return STROMNETZ.napSelectedId;
}

export function getSelectedNap() {
  ensureProfilesContainer();
  return STROMNETZ.napSelectedId;
}
