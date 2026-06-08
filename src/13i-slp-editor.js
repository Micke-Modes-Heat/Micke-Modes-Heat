// ── 13i-slp-editor.js — BDEW/VDEW Standard Load Profile Editor  v2 ──────────
// • BDEW-Tabellendaten H0/G0–G6/L0–L2 (Relativfaktoren, Stundenwerte)
// • Interaktives Drag-Editing direkt im SVG-Chart
// • 15-min CSV-Import (35.040 Werte) → Aggregation zu Saison×Tagtyp×Stunde
// • Eigene Vorlagen in localStorage persistieren
// Source: VDEW "Repräsentative Lastprofile" 1999/2000, BDEW 2006

import { _slpCache } from './02b-gebaeude.js';

// ── Profil-Metadaten ─────────────────────────────────────────────────────────
export const SLP_INFO = {
  H0:  'Haushalt allgemein',
  G0:  'Gewerbe allgemein',
  G1:  'Gewerbe — Wochentag 8–18 Uhr',
  G2:  'Gewerbe — Nachtbetrieb',
  G3:  'Gewerbe — durchlaufend',
  G4:  'Laden / Friseur',
  G5:  'Bäckerei mit Backstube',
  G6:  'Wochenendbetrieb',
  L0:  'Landwirtschaft allgemein',
  L1:  'Landwirtschaft — Milchwirtschaft',
  L2:  'Landwirtschaft — ohne Milchwirtschaft',
  BW0: 'Bundeswehr — allgemein',
  BW1: 'Bundeswehr — Unterkunft / Kaserne',
  BW2: 'Bundeswehr — Werkstatt / Instandhaltung',
  BW3: 'Bundeswehr — Kantine / Truppenverpflegung',
};

// ── BDEW-Tageslastgangformen (24h, Relativfaktoren bezogen auf Jahresmittel) ─
// BASE[Typ][Tagtyp] = [h0..h23]  ·  Saison-Skalierung über SEASON_SCALE
const BASE = {
  H0: {
    WT: [0.46,0.42,0.38,0.36,0.37,0.46,0.63,0.93,1.15,1.07,0.94,0.89,0.92,0.90,0.88,0.93,1.07,1.35,1.54,1.53,1.43,1.18,0.85,0.60],
    Sa: [0.50,0.45,0.41,0.39,0.39,0.43,0.52,0.72,0.92,1.03,1.06,1.03,0.98,0.96,0.94,0.95,1.02,1.13,1.16,1.13,1.04,0.91,0.77,0.62],
    So: [0.57,0.50,0.46,0.43,0.42,0.43,0.46,0.53,0.70,0.88,0.97,1.04,1.03,1.01,0.97,0.95,0.96,1.05,1.08,1.07,0.99,0.87,0.76,0.66],
  },
  G0: {
    WT: [0.40,0.38,0.36,0.35,0.35,0.40,0.60,1.08,1.38,1.43,1.43,1.38,1.33,1.38,1.43,1.43,1.28,1.03,0.78,0.63,0.53,0.48,0.44,0.41],
    Sa: [0.40,0.38,0.36,0.35,0.35,0.38,0.49,0.79,1.08,1.18,1.23,1.18,1.13,1.13,1.13,1.08,0.93,0.78,0.63,0.53,0.47,0.43,0.41,0.40],
    So: [0.38,0.36,0.34,0.33,0.33,0.36,0.44,0.59,0.73,0.83,0.90,0.93,0.93,0.91,0.88,0.83,0.73,0.63,0.56,0.50,0.46,0.43,0.40,0.38],
  },
  G1: {
    WT: [0.34,0.32,0.31,0.30,0.30,0.34,0.54,0.99,1.58,1.73,1.78,1.73,1.63,1.73,1.78,1.68,1.33,0.88,0.58,0.48,0.43,0.38,0.36,0.34],
    Sa: [0.34,0.32,0.31,0.30,0.30,0.32,0.39,0.54,0.69,0.78,0.83,0.83,0.80,0.78,0.76,0.70,0.58,0.48,0.40,0.37,0.35,0.34,0.33,0.33],
    So: [0.32,0.31,0.30,0.29,0.29,0.31,0.34,0.39,0.47,0.54,0.58,0.60,0.60,0.58,0.56,0.53,0.47,0.39,0.35,0.33,0.32,0.31,0.31,0.31],
  },
  G2: {
    WT: [1.23,1.33,1.38,1.38,1.28,1.08,0.78,0.63,0.58,0.58,0.60,0.61,0.61,0.61,0.61,0.63,0.78,0.98,1.08,1.13,1.18,1.23,1.26,1.26],
    Sa: [1.18,1.28,1.33,1.36,1.28,1.08,0.80,0.66,0.60,0.58,0.58,0.58,0.58,0.58,0.60,0.63,0.76,0.93,1.03,1.08,1.13,1.16,1.18,1.20],
    So: [1.13,1.23,1.28,1.30,1.23,1.03,0.78,0.63,0.58,0.56,0.56,0.56,0.56,0.56,0.58,0.60,0.73,0.88,0.98,1.03,1.08,1.10,1.12,1.14],
  },
  G3: {
    WT: [0.87,0.86,0.85,0.86,0.89,0.93,0.98,1.04,1.08,1.09,1.08,1.07,1.06,1.06,1.07,1.08,1.09,1.08,1.06,1.03,1.00,0.96,0.92,0.88],
    Sa: [0.87,0.86,0.85,0.86,0.89,0.93,0.98,1.04,1.08,1.09,1.08,1.07,1.06,1.06,1.07,1.08,1.09,1.08,1.06,1.03,1.00,0.96,0.92,0.88],
    So: [0.87,0.86,0.85,0.86,0.89,0.93,0.98,1.04,1.08,1.09,1.08,1.07,1.06,1.06,1.07,1.08,1.09,1.08,1.06,1.03,1.00,0.96,0.92,0.88],
  },
  G4: {
    WT: [0.34,0.32,0.31,0.30,0.30,0.31,0.39,0.59,0.93,1.43,1.68,1.73,1.63,1.58,1.63,1.68,1.58,1.18,0.63,0.39,0.35,0.33,0.32,0.32],
    Sa: [0.34,0.32,0.31,0.30,0.30,0.31,0.39,0.64,1.08,1.53,1.73,1.78,1.68,1.66,1.66,1.63,1.43,0.98,0.53,0.37,0.34,0.33,0.32,0.32],
    So: [0.32,0.31,0.30,0.29,0.29,0.30,0.34,0.39,0.49,0.59,0.63,0.65,0.65,0.63,0.61,0.58,0.53,0.46,0.40,0.37,0.34,0.32,0.31,0.31],
  },
  G5: {
    WT: [0.68,0.78,1.18,1.58,1.78,1.78,1.58,1.38,1.28,1.08,0.98,0.88,0.83,0.78,0.76,0.76,0.78,0.80,0.78,0.73,0.68,0.63,0.62,0.63],
    Sa: [0.63,0.73,1.13,1.53,1.73,1.73,1.53,1.36,1.26,1.10,1.03,0.98,0.90,0.83,0.78,0.76,0.76,0.76,0.74,0.70,0.66,0.62,0.61,0.61],
    So: [0.58,0.68,1.08,1.48,1.68,1.66,1.46,1.23,1.08,0.98,0.93,0.90,0.86,0.82,0.78,0.76,0.76,0.76,0.74,0.70,0.66,0.62,0.60,0.58],
  },
  G6: {
    WT: [0.59,0.57,0.55,0.54,0.54,0.56,0.63,0.76,0.83,0.84,0.82,0.78,0.78,0.78,0.78,0.80,0.80,0.78,0.76,0.73,0.70,0.68,0.64,0.60],
    Sa: [0.49,0.47,0.45,0.44,0.44,0.49,0.69,1.08,1.48,1.68,1.73,1.68,1.58,1.58,1.60,1.63,1.58,1.38,1.08,0.83,0.68,0.60,0.54,0.50],
    So: [0.49,0.47,0.45,0.44,0.44,0.49,0.63,0.98,1.43,1.66,1.76,1.76,1.70,1.66,1.63,1.60,1.53,1.33,1.03,0.78,0.66,0.58,0.53,0.49],
  },
  L0: {
    WT: [0.79,0.77,0.76,0.77,0.81,0.94,1.09,1.19,1.19,1.14,1.09,1.07,1.04,1.04,1.07,1.09,1.11,1.09,1.04,0.97,0.92,0.87,0.83,0.81],
    Sa: [0.79,0.77,0.76,0.77,0.81,0.94,1.07,1.17,1.17,1.12,1.07,1.04,1.01,1.01,1.04,1.06,1.07,1.06,1.01,0.95,0.90,0.86,0.82,0.80],
    So: [0.79,0.77,0.76,0.77,0.81,0.94,1.04,1.14,1.14,1.09,1.04,1.02,0.99,0.99,1.01,1.02,1.04,1.02,0.98,0.93,0.89,0.85,0.81,0.80],
  },
  L1: {
    WT: [1.04,0.99,0.95,0.94,0.97,1.19,1.39,1.34,1.19,1.09,1.04,0.99,0.97,0.94,0.94,0.97,1.09,1.29,1.37,1.34,1.21,1.09,1.06,1.05],
    Sa: [1.04,0.99,0.95,0.94,0.97,1.19,1.39,1.34,1.19,1.09,1.04,0.99,0.97,0.94,0.94,0.97,1.09,1.29,1.37,1.34,1.21,1.09,1.06,1.05],
    So: [1.04,0.99,0.95,0.94,0.97,1.19,1.39,1.34,1.19,1.09,1.04,0.99,0.97,0.94,0.94,0.97,1.09,1.29,1.37,1.34,1.21,1.09,1.06,1.05],
  },
  L2: {
    WT: [0.74,0.72,0.71,0.72,0.76,0.89,1.04,1.14,1.17,1.12,1.07,1.04,1.01,1.01,1.04,1.07,1.09,1.07,1.01,0.95,0.89,0.84,0.79,0.76],
    Sa: [0.74,0.72,0.71,0.72,0.76,0.89,1.04,1.14,1.17,1.12,1.07,1.04,1.01,1.01,1.04,1.07,1.09,1.07,1.01,0.95,0.89,0.84,0.79,0.76],
    So: [0.74,0.72,0.71,0.72,0.76,0.89,1.04,1.14,1.17,1.12,1.07,1.04,1.01,1.01,1.04,1.07,1.09,1.07,1.01,0.95,0.89,0.84,0.79,0.76],
  },
  // ── Bundeswehr-spezifische Profile ──────────────────────────────────────────
  BW0: {
    // Allgemeine Verwaltung / Mischnutzung: früher Dienstbeginn (5–6 Uhr), Bürobetrieb 7–16 Uhr
    WT: [0.34,0.32,0.31,0.30,0.38,0.68,1.05,1.35,1.52,1.58,1.58,1.50,1.38,1.50,1.56,1.52,1.28,0.90,0.58,0.45,0.38,0.35,0.34,0.34],
    Sa: [0.34,0.32,0.31,0.30,0.37,0.62,0.92,1.18,1.35,1.42,1.42,1.35,1.25,1.18,1.05,0.88,0.70,0.52,0.42,0.37,0.35,0.34,0.33,0.33],
    So: [0.33,0.31,0.30,0.30,0.32,0.46,0.65,0.83,0.98,1.06,1.09,1.06,1.01,0.99,0.96,0.90,0.78,0.66,0.55,0.46,0.42,0.39,0.37,0.35],
  },
  BW1: {
    // Unterkunft / Kaserne: Wecken 5 Uhr, Mittagstief (Ausbildung), Abendspitze 17–22 Uhr
    WT: [0.50,0.46,0.42,0.42,0.58,1.18,1.62,1.42,0.92,0.70,0.68,0.76,0.90,0.72,0.68,0.82,1.18,1.58,1.68,1.60,1.36,1.02,0.76,0.58],
    Sa: [0.54,0.50,0.46,0.46,0.55,0.95,1.28,1.40,1.42,1.36,1.30,1.28,1.32,1.30,1.26,1.24,1.28,1.40,1.42,1.30,1.08,0.86,0.68,0.58],
    So: [0.58,0.52,0.48,0.47,0.53,0.85,1.15,1.32,1.42,1.45,1.44,1.41,1.38,1.36,1.32,1.32,1.36,1.42,1.40,1.25,1.02,0.83,0.70,0.62],
  },
  BW2: {
    // Werkstatt / Instandhaltung: Frühschicht 6–15 Uhr, Samstag Bereitschaftsbetrieb
    WT: [0.22,0.22,0.22,0.22,0.28,0.72,1.38,1.75,1.78,1.72,1.68,1.55,1.30,1.55,1.70,1.55,1.08,0.52,0.30,0.25,0.22,0.22,0.22,0.22],
    Sa: [0.22,0.22,0.22,0.22,0.24,0.52,1.08,1.50,1.62,1.60,1.54,1.38,1.10,0.82,0.48,0.30,0.24,0.22,0.22,0.22,0.22,0.22,0.22,0.22],
    So: [0.22,0.22,0.22,0.22,0.22,0.24,0.27,0.31,0.36,0.36,0.34,0.31,0.28,0.26,0.24,0.22,0.22,0.22,0.22,0.22,0.22,0.22,0.22,0.22],
  },
  BW3: {
    // Kantine / Truppenverpflegung: Frühstück 5–7 Uhr, Mittag 11–13 Uhr, Abendessen 17–18 Uhr
    WT: [0.22,0.22,0.22,0.26,0.58,1.32,1.70,1.46,0.88,0.86,0.92,1.62,1.75,1.28,0.72,0.72,1.22,1.45,1.05,0.52,0.34,0.27,0.24,0.22],
    Sa: [0.22,0.22,0.22,0.24,0.48,1.08,1.50,1.40,1.00,0.86,0.86,1.50,1.62,1.26,0.72,0.72,1.15,1.35,0.92,0.50,0.32,0.27,0.24,0.22],
    So: [0.22,0.22,0.22,0.23,0.40,0.86,1.28,1.36,1.02,0.83,0.86,1.43,1.57,1.22,0.72,0.71,1.10,1.28,0.86,0.50,0.32,0.27,0.24,0.22],
  },
};

const SEASON_SCALE = {
  H0:  { W:1.25, U:1.00, S:0.82 },
  G0:  { W:1.10, U:1.00, S:0.93 },
  G1:  { W:1.05, U:1.00, S:0.97 },
  G2:  { W:1.10, U:1.00, S:0.90 },
  G3:  { W:1.08, U:1.00, S:0.93 },
  G4:  { W:1.05, U:1.00, S:0.98 },
  G5:  { W:1.10, U:1.00, S:0.93 },
  G6:  { W:1.05, U:1.00, S:0.97 },
  L0:  { W:1.15, U:1.00, S:0.88 },
  L1:  { W:1.20, U:1.00, S:0.82 },
  L2:  { W:1.10, U:1.00, S:0.87 },
  BW0: { W:1.12, U:1.00, S:0.92 },
  BW1: { W:1.22, U:1.00, S:0.83 },
  BW2: { W:1.06, U:1.00, S:0.96 },
  BW3: { W:1.10, U:1.00, S:0.93 },
};

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function getSeason(doy) {
  if (doy <= 79 || doy >= 304) return 'W';   // 1. Nov – 20. Mär
  if (doy >= 134 && doy <= 256) return 'S';  // 15. Mai – 14. Sep
  return 'U';
}
function getDaytype(dow) {
  if (dow === 5) return 'Sa';
  if (dow === 6) return 'So';
  return 'WT';
}

// ── Zustandsspeicher ─────────────────────────────────────────────────────────
// Bearbeitungs-Overrides: _edited[Typ][Saison][Tagtyp] = Float64Array[24]
const _edited = {};

// Eigene Vorlagen (localStorage): { name: { base:{W:{WT,Sa,So},...}, desc } }
let _custom = {};
function _loadCustom() {
  try { _custom = JSON.parse(localStorage.getItem('slp_vorlagen') || '{}'); } catch { _custom = {}; }
}
function _saveCustom() { localStorage.setItem('slp_vorlagen', JSON.stringify(_custom)); }
_loadCustom();

// ── 24h-Werte für Typ/Saison/Tagtyp (berücksichtigt Edits + Custom) ──────────
function _getVals(type, s, dt) {
  if (_custom[type]) return _custom[type].base[s]?.[dt] ?? Array(24).fill(1);
  if (_edited[type]?.[s]?.[dt]) return _edited[type][s][dt];
  const bd = BASE[type]; const sc = SEASON_SCALE[type];
  if (!bd || !sc) return Array(24).fill(1);
  return bd[dt].map(v => v * sc[s]);
}

// ── 8760h-Profil aufbauen (normiert, Summe = 1.0) ───────────────────────────
export function buildSlpProfile8760(type) {
  const result = new Float32Array(8760);
  for (let h = 0; h < 8760; h++) {
    const doy = Math.floor(h / 24);
    result[h] = _getVals(type, getSeason(doy), getDaytype((doy + 3) % 7))[h % 24];
  }
  let sum = 0;
  for (let i = 0; i < 8760; i++) sum += result[i];
  if (sum > 0) for (let i = 0; i < 8760; i++) result[i] /= sum;
  return result;
}

// ── Cache initialisieren (ersetzt vereinfachte Approx. in 02b-gebaeude.js) ──
export function initBdewProfiles() {
  for (const t of Object.keys(BASE)) {
    if (!_slpCache[t]) _slpCache[t] = buildSlpProfile8760(t);
  }
  for (const t of Object.keys(_custom)) {
    _slpCache[t] = buildSlpProfile8760(t);
  }
}

// ── Editor öffnen / schließen ────────────────────────────────────────────────
let _el  = null;
let _st  = { type:'H0', season:'W', daytype:'WT', editMode:false };

export function openSlpEditor(type) {
  _st.type = (BASE[type] || _custom[type]) ? type : 'H0';
  if (_el) { _render(); return; }
  _el = document.createElement('div');
  _el.id = 'slp-editor-overlay';
  _el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;';
  _el.addEventListener('click', e => { if (e.target === _el) closeSlpEditor(); });
  document.body.appendChild(_el);
  _render();
}

export function closeSlpEditor() {
  if (_el) { document.body.removeChild(_el); _el = null; }
}

// ── Panel komplett rendern ────────────────────────────────────────────────────
function _render() {
  const { type, season, daytype, editMode } = _st;
  const isCustom = !!_custom[type];
  const isEdited = !isCustom && !!_edited[type]?.[season]?.[daytype];

  const stdOpts = Object.keys(SLP_INFO).map(t =>
    `<option value="${t}"${t===type?' selected':''}>${t} — ${SLP_INFO[t]}</option>`).join('');
  const custKeys = Object.keys(_custom);
  const custOpts = custKeys.length
    ? '<option disabled>──── Eigene Vorlagen ────</option>'
      + custKeys.map(k => `<option value="${k}"${k===type?' selected':''}>★ ${k}</option>`).join('')
    : '';

  const sb = (s,l) => `<button class="slpe-tab${season===s?' slpe-tab-active':''}" data-slpe-s="${s}">${l}</button>`;
  const db = (d,l) => `<button class="slpe-tab${daytype===d?' slpe-tab-active':''}" data-slpe-d="${d}">${l}</button>`;

  const infoLine = isCustom ? 'Eigene Vorlage'
    : `Saison-Skalierung: W ×${SEASON_SCALE[type]?.W.toFixed(2)} · S ×${SEASON_SCALE[type]?.S.toFixed(2)}`;

  _el.innerHTML = `
  <div style="background:var(--surface,#1e2328);border:1px solid rgba(100,181,246,.4);border-radius:12px;
              padding:18px 20px;width:510px;max-width:96vw;box-shadow:0 12px 40px rgba(0,0,0,.85);
              font-size:11px;color:var(--text,#e0e0e0);">

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;flex:1;">BDEW Standardlastprofil</div>
      <button id="slpe-x" style="background:none;border:none;color:var(--muted,#78909c);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">✕</button>
    </div>

    <!-- Profil-Selector -->
    <div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:10px;">
      <div style="flex:1;">
        <label style="font-size:9px;color:var(--muted,#78909c);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Profil</label>
        <select id="slpe-type" style="width:100%;background:var(--surface2,#252b31);border:1px solid rgba(255,255,255,.12);border-radius:5px;padding:5px 8px;font-size:11px;color:inherit;">
          ${stdOpts}${custOpts}
        </select>
      </div>
      ${isCustom ? `<button id="slpe-del" title="Vorlage löschen" style="background:rgba(244,67,54,.1);border:1px solid rgba(244,67,54,.3);border-radius:5px;padding:5px 8px;color:#ef9a9a;font-size:10px;cursor:pointer;">✕</button>` : ''}
    </div>

    <!-- Saison + Tagtyp-Tabs -->
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
      ${sb('W','Winter')}${sb('U','Übergang')}${sb('S','Sommer')}
      <span style="flex:1;min-width:8px;"></span>
      ${db('WT','Werktag')}${db('Sa','Samstag')}${db('So','Sonntag')}
    </div>

    <!-- Chart -->
    <div id="slpe-chart-wrap" style="background:rgba(0,0,0,.25);border-radius:6px;padding:8px 4px;${editMode?'outline:1px solid rgba(100,181,246,.35);':''}">
      ${_chartHtml(type, season, daytype, editMode)}
    </div>

    <!-- Info-Zeile + Bearbeitung-Controls -->
    <div style="margin-top:7px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span style="flex:1;font-size:9px;color:var(--muted,#78909c);">${infoLine}${isEdited?' · <span style=\'color:#ffb74d;\'>✎ bearbeitet</span>':''}</span>
      ${!isCustom?`<button id="slpe-edit-tog" style="background:${editMode?'rgba(100,181,246,.18)':'rgba(255,255,255,.06)'};border:1px solid ${editMode?'rgba(100,181,246,.4)':'rgba(255,255,255,.15)'};border-radius:4px;padding:3px 10px;cursor:pointer;color:${editMode?'#64b5f6':'inherit'};font-size:10px;">${editMode?'✓ Bearbeitung aktiv':'✎ Bearbeiten'}</button>`:''}
      ${isEdited?`<button id="slpe-reset" style="background:transparent;border:1px solid rgba(255,152,0,.3);border-radius:4px;padding:3px 8px;color:#ffb74d;font-size:10px;cursor:pointer;">↺ Reset</button>`:''}
      ${(editMode||isEdited||isCustom)?`<button id="slpe-save-tpl" style="background:rgba(102,187,106,.12);border:1px solid rgba(102,187,106,.35);border-radius:4px;padding:3px 10px;cursor:pointer;color:#a5d6a7;font-size:10px;">💾 Speichern</button>`:''}
    </div>

    <!-- Vorlage benennen (inline) -->
    <div id="slpe-name-form" style="display:none;margin-top:8px;background:rgba(0,0,0,.2);border-radius:6px;padding:8px 10px;">
      <label style="font-size:9px;color:var(--muted,#78909c);display:block;margin-bottom:3px;">Name der Vorlage</label>
      <div style="display:flex;gap:6px;">
        <input id="slpe-tpl-name" type="text" placeholder="z.B. Schule Musterstadt"
          style="flex:1;background:var(--surface2,#252b31);border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:4px 8px;font-size:11px;color:inherit;" />
        <button id="slpe-tpl-ok" style="background:rgba(102,187,106,.18);border:1px solid rgba(102,187,106,.4);border-radius:4px;padding:4px 10px;cursor:pointer;color:#a5d6a7;font-size:10px;">OK</button>
        <button id="slpe-tpl-no" style="background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:4px 8px;cursor:pointer;color:var(--muted,#78909c);font-size:10px;">✕</button>
      </div>
    </div>

    <!-- Footer: Import / Export / Schließen -->
    <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,.07);padding-top:9px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <label style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:3px 10px;cursor:pointer;color:inherit;font-size:10px;white-space:nowrap;" title="35.040 Werte (365 Tage × 96 QH) — automatische Aggregation zu Saison×Tagtyp×Stunde">
        ⬆ 15-min CSV
        <input type="file" id="slpe-file" accept=".csv,.txt" style="display:none;">
      </label>
      <button id="slpe-export" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:3px 10px;cursor:pointer;color:inherit;font-size:10px;">⬇ CSV</button>
      <span style="flex:1;"></span>
      <button id="slpe-close2" style="background:rgba(100,181,246,.1);border:1px solid rgba(100,181,246,.25);border-radius:4px;padding:3px 12px;cursor:pointer;color:#64b5f6;font-size:10px;">Schließen</button>
    </div>
  </div>
  <style>
    .slpe-tab{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
              border-radius:4px;padding:3px 9px;cursor:pointer;
              color:var(--muted,#78909c);font-size:10px;}
    .slpe-tab-active{background:rgba(100,181,246,.18);
                     border-color:rgba(100,181,246,.5);color:#64b5f6;}
  </style>`;

  _wireEvents();
  if (editMode) _wireChartDrag();
}

// ── Events binden ─────────────────────────────────────────────────────────────
function _wireEvents() {
  const q = id => _el.querySelector(id);

  q('#slpe-x').onclick    = closeSlpEditor;
  q('#slpe-close2').onclick = closeSlpEditor;

  q('#slpe-type').onchange = e => { _st.type = e.target.value; _st.editMode = false; _render(); };

  _el.querySelectorAll('[data-slpe-s]').forEach(b =>
    b.onclick = () => { _st.season  = b.dataset.slpeS; _render(); });
  _el.querySelectorAll('[data-slpe-d]').forEach(b =>
    b.onclick = () => { _st.daytype = b.dataset.slpeD; _render(); });

  q('#slpe-edit-tog')?.addEventListener('click', () => { _st.editMode = !_st.editMode; _render(); });

  q('#slpe-reset')?.addEventListener('click', () => {
    const { type, season, daytype } = _st;
    if (_edited[type]?.[season]) delete _edited[type][season][daytype];
    _slpCache[type] = buildSlpProfile8760(type);
    _render();
  });

  q('#slpe-del')?.addEventListener('click', () => {
    delete _custom[_st.type]; _saveCustom();
    _st.type = 'H0'; _render();
  });

  q('#slpe-save-tpl')?.addEventListener('click', () => {
    const form = q('#slpe-name-form');
    q('#slpe-tpl-name').value = _custom[_st.type]?.name ?? _st.type;
    form.style.display = '';
    q('#slpe-tpl-name').focus();
  });
  q('#slpe-tpl-no')?.addEventListener('click', () => { q('#slpe-name-form').style.display = 'none'; });
  q('#slpe-tpl-ok')?.addEventListener('click', _doSaveTpl);
  q('#slpe-tpl-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _doSaveTpl();
    if (e.key === 'Escape') { _el.querySelector('#slpe-name-form').style.display = 'none'; }
  });

  q('#slpe-export').onclick = () => _exportCsv(_st.type);
  q('#slpe-file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => _handleCsvImport(ev.target.result, f.name);
    reader.readAsText(f, 'utf-8');
    e.target.value = '';
  });
}

// ── Vorlage speichern ─────────────────────────────────────────────────────────
function _doSaveTpl() {
  const name = (_el?.querySelector('#slpe-tpl-name')?.value || '').trim();
  if (!name) return;
  const base = {};
  for (const s of ['W','U','S']) {
    base[s] = {};
    for (const dt of ['WT','Sa','So']) base[s][dt] = _getVals(_st.type, s, dt).slice();
  }
  _custom[name] = { base, desc: `Erstellt aus: ${_st.type}` };
  _saveCustom();
  _slpCache[name] = buildSlpProfile8760(name);   // cache sofort befüllen
  _st.type = name; _st.editMode = false;
  _render();
}

// ── 15-min CSV Import ─────────────────────────────────────────────────────────
function _handleCsvImport(text, filename) {
  // Alle numerischen Werte extrahieren (Trennzeichen: , ; \t \n)
  const values = [];
  for (const tok of text.split(/[,;\t\r\n]+/)) {
    const n = parseFloat(tok.replace(',', '.'));
    if (!isNaN(n)) { values.push(n); if (values.length >= 35040) break; }
  }
  if (values.length < 96) {
    alert(`Zu wenige Werte (${values.length}). Erwartet: 35.040 × 15-min.`); return;
  }

  // Aggregation: Summen + Zähler pro (Saison, Tagtyp, Stunde)
  const sums = {}, cnts = {};
  for (const s of ['W','U','S']) {
    sums[s] = {}; cnts[s] = {};
    for (const dt of ['WT','Sa','So']) {
      sums[s][dt] = new Array(24).fill(0);
      cnts[s][dt] = new Array(24).fill(0);
    }
  }
  const n = Math.min(values.length, 35040);
  for (let q = 0; q < n; q++) {
    const doy = Math.floor(q / 96);
    const hod = Math.floor((q % 96) / 4);
    const s   = getSeason(doy);
    const dt  = getDaytype((doy + 3) % 7);
    sums[s][dt][hod] += values[q];
    cnts[s][dt][hod]++;
  }

  // Mittelwerte + Normierung auf Relativfaktor (Jahresmittel = 1.0)
  let grandSum = 0, grandCount = 0;
  const avgs = {};
  for (const s of ['W','U','S']) {
    avgs[s] = {};
    for (const dt of ['WT','Sa','So']) {
      avgs[s][dt] = sums[s][dt].map((v, h) => cnts[s][dt][h] > 0 ? v / cnts[s][dt][h] : 0);
      grandSum   += avgs[s][dt].reduce((a, b) => a + b, 0);
      grandCount += 24;
    }
  }
  const mean = grandCount > 0 ? grandSum / grandCount : 1;
  if (mean > 0) {
    for (const s of ['W','U','S'])
      for (const dt of ['WT','Sa','So'])
        avgs[s][dt] = avgs[s][dt].map(v => v / mean);
  }

  const name = filename.replace(/\.(csv|txt)$/i, '').slice(0, 40);
  _custom[name] = { base: avgs, desc: `Importiert: ${filename} (${values.length} Werte)` };
  _saveCustom();
  _slpCache[name] = buildSlpProfile8760(name);
  _st.type = name; _st.editMode = false;
  _render();
}

// ── SVG-Chart ─────────────────────────────────────────────────────────────────
const CW = 460, CH = 145, PL = 30, PR = 4, PT = 10, PB = 22;

function _chartHtml(type, season, daytype, editMode) {
  return `<svg id="slpe-chart-svg" width="100%" height="${CH}"
    viewBox="0 0 ${CW} ${CH}" style="display:block;overflow:visible;
    cursor:${editMode ? 'crosshair' : 'default'};"
  >${_chartContent(type, season, daytype, editMode)}</svg>`;
}

function _chartContent(type, season, daytype, editMode) {
  const vals = _getVals(type, season, daytype);
  const cW = CW - PL - PR, cH = CH - PT - PB;
  const MAX_Y = 2.5; // Fester Maßstab: 0–2.5 Relativfaktor
  const toX = h  => PL + h * (cW / 23);
  const toY = v  => PT + cH - Math.max(0, Math.min(1, v / MAX_Y)) * cH;

  // Y-Gridlines
  let grid = '';
  for (const gv of [0.5, 1.0, 1.5, 2.0, 2.5]) {
    const gy = toY(gv);
    const dash = gv === 1.0 ? '' : ' stroke-dasharray="3,3"';
    grid += `<line x1="${PL}" y1="${gy.toFixed(1)}" x2="${CW-PR}" y2="${gy.toFixed(1)}"
      stroke="rgba(255,255,255,.1)"${dash} stroke-width="1"/>
      <text x="${PL-3}" y="${(gy+3.5).toFixed(1)}" text-anchor="end"
        fill="rgba(255,255,255,.35)" font-size="8">${gv.toFixed(1)}</text>`;
  }

  // Fläche + Linie
  const pts = vals.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`);
  const baseY = PT + cH;
  const areaD = `M ${toX(0).toFixed(1)},${baseY} ${pts.map(p => 'L '+p).join(' ')} L ${toX(23).toFixed(1)},${baseY} Z`;
  const poly  = `<polyline points="${pts.join(' ')}" fill="none" stroke="#64b5f6"
    stroke-width="${editMode ? '1.2' : '1.6'}" stroke-linejoin="round" stroke-linecap="round"/>`;

  // X-Labels
  let xlabels = '';
  for (const h of [0,3,6,9,12,15,18,21,23]) {
    xlabels += `<text x="${toX(h).toFixed(1)}" y="${CH-5}" text-anchor="middle"
      fill="rgba(255,255,255,.4)" font-size="8">${h}:00</text>`;
  }

  // Drag-Handles im Bearbeitungsmodus
  const handles = editMode
    ? vals.map((v, i) =>
        `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="5.5"
          fill="#64b5f6" opacity="0.75" stroke="rgba(255,255,255,.5)" stroke-width="1"
          data-slpe-h="${i}" style="cursor:ns-resize;"/>`
      ).join('')
    : '';

  return `${grid}
    <path d="${areaD}" fill="rgba(100,181,246,.10)"/>
    ${poly}
    ${handles}
    ${xlabels}
    <line x1="${PL}" y1="${PT}"     x2="${PL}"     y2="${PT+cH}" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <line x1="${PL}" y1="${PT+cH}" x2="${CW-PR}"  y2="${PT+cH}" stroke="rgba(255,255,255,.2)" stroke-width="1"/>`;
}

// ── Drag-Editing (Pointer-Capture) ────────────────────────────────────────────
function _wireChartDrag() {
  const svg = _el?.querySelector('#slpe-chart-svg');
  if (!svg) return;

  const cW = CW - PL - PR, cH = CH - PT - PB;
  const MAX_Y = 2.5;
  let dragging = null;

  function toSvgCoords(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width  * CW,
      y: (clientY - r.top)  / r.height * CH,
    };
  }
  function svgXtoHour(svgX) {
    return Math.max(0, Math.min(23, Math.round((svgX - PL) / (cW / 23))));
  }
  function svgYtoVal(svgY) {
    return Math.max(0.01, Math.min(MAX_Y, (PT + cH - svgY) / cH * MAX_Y));
  }

  svg.addEventListener('pointerdown', e => {
    const { x, y } = toSvgCoords(e.clientX, e.clientY);
    dragging = svgXtoHour(x);
    _applyEdit(dragging, svgYtoVal(y));
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  svg.addEventListener('pointermove', e => {
    if (dragging === null) return;
    const { x, y } = toSvgCoords(e.clientX, e.clientY);
    dragging = svgXtoHour(x);
    _applyEdit(dragging, svgYtoVal(y));
  });

  svg.addEventListener('pointerup', () => { dragging = null; });
}

// Einzelne Stunde bearbeiten und Chart-Inhalt (nicht ganzes Panel) neu zeichnen
function _applyEdit(hour, value) {
  const { type, season, daytype } = _st;
  if (!_edited[type])         _edited[type]         = {};
  if (!_edited[type][season]) _edited[type][season] = {};
  if (!_edited[type][season][daytype]) {
    _edited[type][season][daytype] = _getVals(type, season, daytype).slice();
  }
  _edited[type][season][daytype][hour] = value;
  _slpCache[type] = buildSlpProfile8760(type);

  // Nur SVG-Inhalt aktualisieren (SVG-Element bleibt, Pointer-Capture bleibt aktiv)
  const svg = _el?.querySelector('#slpe-chart-svg');
  if (svg) svg.innerHTML = _chartContent(type, season, daytype, true);
}

// ── CSV-Export (8760h-Jahresprofil) ──────────────────────────────────────────
function _exportCsv(type) {
  const profile = buildSlpProfile8760(type);
  const months  = [31,28,31,30,31,30,31,31,30,31,30,31];
  const mNames  = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  let csv = `Stunde;Monat;Tag;Stunde_im_Tag;${type}_normiert\n`;
  let m = 0, mDay = 0;
  for (let h = 0; h < 8760; h++) {
    const doy = Math.floor(h / 24);
    const hod = h % 24;
    if (doy >= mDay + months[m]) { mDay += months[m]; m++; }
    csv += `${h};${mNames[m]};${doy-mDay+1};${hod};${profile[h].toFixed(8)}\n`;
  }
  const blob = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `SLP_${type}_8760h.csv`; a.click();
  URL.revokeObjectURL(url);
}
