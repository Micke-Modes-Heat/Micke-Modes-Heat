// ── lib/anschlussebenen.js — Typische Anschlussebene nach Leistung ──
// DOM- und importfrei (Vitest). Genutzt vom Netzanschluss-Modul (44), Schritt „Ebene".
//
// Quelle der Bänder: VDE FNN Hinweis „Ermittlung Netzanschlusspunkt für Anlagen nach EEG/KWKG"
// (Version 1.0, Juli 2021), Bild 1 — dort für Erzeugungsanlagen; Werte aus der Grafik abgelesen
// und gerundet (kVA). Rauten: Übertragungsfähigkeit typischer Betriebsmittel (ebd., Tabelle 2).
// Zusätzlich die Orientierungswerte einer realen TAB (ENWG Energienetze Weimar, Ergänzende TAB
// Mittelspannung, Tabelle 1), die dort für Bezug UND Einspeisung gelten.
// Verbindlich ist immer die TAB des zuständigen Netzbetreibers.

/** kv/kb = Kernbereich („häufig"), von/bis = Band („kommt vor"). */
export const AE_BAENDER = [
  { g: 'HS', name: '110 kV · Netz', ne: 'NE 3', von: 11000, bis: 110000, kv: 27000, kb: 63000, ref: { v: 130000, t: 'AL/ST 240/40: 130 MVA' } },
  { g: 'MS', name: '30 kV · Sammelschiene UW', ne: 'NE 4', von: 6300, bis: 34000, kv: 11500, kb: 20000 },
  { g: 'MS', name: '20 kV · Sammelschiene UW', ne: 'NE 4', von: 3500, bis: 27000, kv: 6800, kb: 13500, ref: { v: 40000, t: 'UW-Trafo HS/MS: 40 MVA' } },
  { g: 'MS', name: '10 kV · Sammelschiene UW', ne: 'NE 4', von: 2900, bis: 18000, kv: 5500, kb: 10000 },
  { g: 'MS', name: '30 kV · Netz', ne: 'NE 5', von: 200, bis: 18000, kv: 1100, kb: 3700, ref: { v: 22000, t: 'NA2XS2Y 240, 30 kV: 22 MVA' } },
  { g: 'MS', name: '20 kV · Netz', ne: 'NE 5', von: 200, bis: 10000, kv: 700, kb: 2500, ref: { v: 11000, t: 'NA2XS2Y 150, 20 kV: 11 MVA' } },
  { g: 'MS', name: '10 kV · Netz', ne: 'NE 5', von: 200, bis: 5800, kv: 600, kb: 1800, ref: { v: 6200, t: 'NA2XS2Y 185, 10 kV: 6,2 MVA' } },
  { g: 'NS', name: '0,4 kV · Sammelschiene Station', ne: 'NE 6', von: 85, bis: 600, kv: 160, kb: 310, ref: { v: 400, t: 'Ortsnetztrafo: 400 kVA' } },
  { g: 'NS', name: '0,4 kV · Netz', ne: 'NE 7', von: 30, bis: 190, kv: 50, kb: 100, ref: { v: 170, t: 'NAYY 150: 170 kVA' } },
  { g: 'NS', name: '0,4 kV · Hausanschlusskasten', ne: 'NE 7', von: 1, bis: 30, kv: 1, kb: 30 },
];

export const AE_TAB = [
  { bis: 30, t: 'HAK', lang: '1 kV-Hausanschlusskasten: bis 30 kW' },
  { bis: 80, t: 'Netz', lang: '1 kV-Netz: bis 80 kW' },
  { bis: 200, t: 'SS', lang: '1 kV-Sammelschiene in der Trafostation: bis 200 kW' },
  { bis: 2000, t: 'MS-Netz', lang: 'MS-Netz: bis 2.000 kW' },
  { bis: 200000, t: 'Sammelschiene im UW', lang: 'MS-Sammelschiene im Umspannwerk: über 2.000 kW' },
];

export const AE_QUELLE = 'VDE FNN Hinweis „Ermittlung Netzanschlusspunkt für Anlagen nach EEG/KWKG" (2021), Bild 1 und Tabelle 2; TAB ENWG Energienetze Weimar, Tabelle 1';

/** Einordnung einer Leistung (kVA): Kernbereiche, Randbereiche, Eintrag der Beispiel-TAB. */
export function aeEinordnung(kva) {
  if (!(kva > 0)) return { haeufig: [], moeglich: [], tab: null };
  const kern = b => kva >= b.kv && kva <= b.kb;
  return {
    haeufig: AE_BAENDER.filter(kern),
    moeglich: AE_BAENDER.filter(b => kva >= b.von && kva <= b.bis && !kern(b)),
    tab: AE_TAB.find(s => kva <= s.bis) || null,
  };
}

const de = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
export const aeKva = v => v >= 1000 ? `${de(v / 1000, v >= 10000 ? 0 : 1)} MVA` : `${de(v)} kVA`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const AE_GEO = { L0: 260, R0: 900, LOGMAX: Math.log10(200000), ROW: 30, TOP: 34, W: 920 };
export const aeX = v => AE_GEO.L0 + (Math.log10(Math.max(1, v)) / AE_GEO.LOGMAX) * (AE_GEO.R0 - AE_GEO.L0);

/**
 * SVG der Bänder. farben: { text, muted, linie, band, flaeche, raute } (Theme der App).
 * marker: [{ kva, farbe, label, gestrichelt }] — senkrechte Linien mit Beschriftung oben.
 */
export function aeSvg({ farben, marker = [] }) {
  const { L0, R0, ROW, TOP, W } = AE_GEO;
  const f = { text: '#ddd', muted: '#999', linie: '#444', band: '#4caf50', flaeche: 'transparent', raute: '#222', ...farben };
  const unten = TOP + AE_BAENDER.length * ROW + 44;
  const H = unten + 30;
  const t = (x, y, s, a = '') => `<text x="${x}" y="${y}" style="fill:${f.text};font-size:11px;" ${a}>${esc(s)}</text>`;
  const ax = (x, y, s, a = '') => `<text x="${x}" y="${y}" style="fill:${f.muted};font-size:10px;font-family:monospace;" ${a}>${esc(s)}</text>`;
  let defs = '', s = '';
  [1, 10, 100, 1000, 10000, 100000].forEach(v => {
    const x = aeX(v).toFixed(1);
    s += `<line x1="${x}" x2="${x}" y1="${TOP - 6}" y2="${unten}" style="stroke:${f.linie};stroke-width:1"/>`;
    s += ax(x, unten + 16, aeKva(v), 'text-anchor="middle"');
  });
  let gAlt = null;
  AE_BAENDER.forEach((b, i) => {
    const y = TOP + i * ROW;
    if (b.g !== gAlt) {
      if (gAlt) s += `<line x1="6" x2="${R0}" y1="${y - 3}" y2="${y - 3}" style="stroke:${f.linie};stroke-dasharray:4 4"/>`;
      s += `<text x="6" y="${y + 16}" style="fill:${f.band};font-size:10px;font-weight:700;">${b.g}</text>`;
      gAlt = b.g;
    }
    s += t(34, y + 16, b.name);
    s += ax(L0 - 6, y + 16, b.ne, 'text-anchor="end"');
    const x1 = aeX(b.von), x2 = aeX(b.bis), w = Math.max(2, x2 - x1);
    const kv = (aeX(b.kv) - x1) / w, kb = (aeX(b.kb) - x1) / w;
    const voll = b.von === b.kv && b.bis === b.kb;
    const stops = voll ? [[0, 0.85], [1, 0.85]] : [[0, 0.08], [Math.max(0.02, kv), 0.85], [Math.min(0.98, kb), 0.85], [1, 0.08]];
    defs += `<linearGradient id="aeg${i}" x1="0" x2="1" y1="0" y2="0">${stops.map(([o, a]) => `<stop offset="${o.toFixed(3)}" stop-color="${f.band}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
    s += `<rect x="${x1.toFixed(1)}" y="${y + 6}" width="${w.toFixed(1)}" height="16" fill="url(#aeg${i})"/>`;
    if (b.ref) {
      const xr = aeX(b.ref.v), yr = y + 14;
      s += `<path d="M${xr.toFixed(1)} ${yr - 6} l6 6 l-6 6 l-6 -6 Z" style="fill:${f.raute};stroke:${f.text};stroke-width:1.2"><title>${esc(b.ref.t)}</title></path>`;
    }
  });
  const yT = TOP + AE_BAENDER.length * ROW + 8;
  s += `<text x="6" y="${yT + 14}" style="fill:${f.muted};font-size:10px;">Beispiel-TAB (kW)</text>`;
  let von = 1;
  AE_TAB.forEach((seg, i) => {
    const x1 = aeX(von), x2 = aeX(Math.min(seg.bis, 200000));
    s += `<rect x="${x1.toFixed(1)}" y="${yT + 2}" width="${Math.max(1, x2 - x1 - 2).toFixed(1)}" height="16" style="fill:${f.linie};opacity:${i % 2 ? 0.55 : 0.3}"><title>${esc(seg.lang)}</title></rect>`;
    if (x2 - x1 - 6 > seg.t.length * 5.5) s += `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${yT + 14}" text-anchor="middle" style="fill:${f.text};font-size:9.5px;">${esc(seg.t)}</text>`;
    von = seg.bis;
  });
  // Marker: Beschriftungen oben gestaffelt, damit nahe Werte sich nicht überdecken
  const sortiert = [...marker].filter(m => m.kva > 0).sort((a, b) => a.kva - b.kva);
  let letzteX = -1e9, ebene = 0;
  sortiert.forEach(m => {
    const x = aeX(Math.min(200000, m.kva));
    ebene = x - letzteX < 90 ? (ebene + 1) % 3 : 0;
    letzteX = x;
    const yl = 10 + ebene * 10;
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${yl + 2}" y2="${yT + 20}" style="stroke:${m.farbe};stroke-width:2;${m.gestrichelt ? 'stroke-dasharray:4 3;' : ''}"/>`;
    s += `<text x="${Math.min(R0 - 4, Math.max(L0 + 4, x)).toFixed(1)}" y="${yl}" text-anchor="middle" style="fill:${m.farbe};font-size:10px;font-weight:700;">${esc(m.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:100%;height:auto;background:${f.flaeche};" role="img" aria-label="Typische Anschlussebene nach Leistung"><defs>${defs}</defs>${s}</svg>`;
}
