// ── 17-gutachten-grafik.js — Gutachten-Grafiken: einheitliche SVG-Figuren + Word-Export ──
// Alle Abbildungen fürs Gutachten werden hier aus Daten gezeichnet (natives SVG,
// kein DOM-Screenshot) und lassen sich per Knopfdruck nach Word übernehmen:
//   • PNG @2–4× in die Zwischenablage  → in Word mit Strg+V einfügen
//   • SVG als Datei                    → in Word über Einfügen › Bilder (bleibt Vektor)
// SVG in die Zwischenablage funktioniert bei Word NICHT — deshalb der PNG-Weg.

// Bewusst ohne Imports aus dem App-Kern: das Modul soll ein Blatt im Importgraph
// bleiben (siehe tests/import-architecture.test.js). Assets werden zur Laufzeit
// über window gelesen — main.js legt alle Modul-Exporte dort ab.

import { LKEBW_LOGO, LKEBW_LOGO_H, LKEBW_LOGO_W } from './config/lkebw-logo.js';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) DESIGN-TOKENS — gelten für ALLE Gutachten-Grafiken
 *
 * Übernommen aus dem Claude-Design-Canvas „LKEBw Gutachten Design System"
 * (Artboard „Energietraeger Auswahl.dc.html"). Kantig statt gerundet, zwei
 * Grüntöne statt Blau/Grün, Tahoma, Papierton statt Weiß.
 * ═══════════════════════════════════════════════════════════════════════ */
export const GG_THEME = {
  width: 1000,                       // = 16 cm Word-Textbreite
  bg: '#FAFAF8',                     // Papierton des Artboards
  font: 'Tahoma, Verdana, sans-serif',
  fontMono: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
  pad: { x: 24, top: 28, bottom: 32 },

  // Masse des gerahmten Ganglinien-Blatts (Artboard „Jahresganglinie Strom")
  sheet: {
    padX: 28,
    headBand: 5, headH: 92, headMetaW: 232, headLogoW: 176, logoW: 128,
    metaRow: 20, metaKeyW: 74, fsMeta: 11.5,
    fsEyebrow: 11, trackEyebrow: 1.76, fsTitle: 21, fsSub: 13, fsBody: 12.5,
    plotTop: 26, plotH: 470, yTitleW: 18, yLabelW: 52,
    fsAxis: 11, fsAxisTitle: 11.5, fsLeg: 11,
    xLabelDy: 18, xTitleDy: 46, kpiTopDy: 66,
    kpiPad: 16, kpiRow: 22, kpiPctW: 42, kpiWertW: 128, kpiWertW2: 104,
    fsKpi: 13, fsKpiPct: 12, fsKpiLabel: 12.5, footSpace: 16,
  },

  line: '#E2E4DF',                   // Rahmen von Gruppen, Kacheln, Kopfzeilen
  tint: '#EEF3EC',                   // Füllung aktiver Kacheln und Kopfzeilen
  rule: '#C9CCC5',                   // dünne Linie der Abschnittsmarke

  text:    { strong: '#1B1F1C', muted: '#5A5F5A', faint: '#8A8F8A' },

  // Energietraeger-Farbcodes des Design-Systems — der bestehende Standard fuer
  // Sankey- und Flussbilder, deshalb auch fuer die Ganglinien uebernommen.
  energy:  { strom: '#0000FF', waerme: '#FF0000', gas: '#FA9500',
             heizoel: '#777777', biomasse: '#7AB000', kaelte: '#000000' },
  neutral: { cardBg: '#FFFFFF', band: '#F2F3F0', iconLine: '#C9CCC5', icon: '#8A8F8A' },

  // Akzente: dunkles Grün für Energieträger, mittleres für Energiequellen
  accents: { gruenDunkel: '#266426', gruen: '#3F9C3F' },

  section: { titleSize: 22, titleBaseline: 48, ruleY: 72, ruleWidthPct: 0.72,
             dot: 7, ruleThin: 2, ruleThick: 5, gap: 24 },
  group:   { top: 98, pad: 12, gap: 18, pillH: 32, pillGap: 12, pillSize: 12, tracking: 0.96 },
  card:    { h: 142, gap: 10, iconTop: 16, iconBox: 38, iconSize: 18, iconStroke: 1.6,
             labelTop: 12, labelSize: 12, labelLine: 16, labelPad: 5, footerH: 34 },
};

/* ══════════════════════════════════════════════════════════════════════════
 * 2) ICON-BIBLIOTHEK — 24×24, Farbe und Strichstärke werden übergeben
 * ═══════════════════════════════════════════════════════════════════════ */
const DROP = 'M12 3.2C12 3.2 5.2 11 5.2 14.8a6.8 6.8 0 0 0 13.6 0C18.8 11 12 3.2 12 3.2Z';

export const GG_ICONS = {
  oil: (c, w) => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="${w}"/>
             <path d="M12 10.2c0 0-2.5 2.9-2.5 4.3a2.5 2.5 0 0 0 5 0c0-1.4-2.5-4.3-2.5-4.3Z" fill="${c}"/>`,
  gas: (c, w) => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="${w}"/>
             <path d="M12 8.6c.4 1.6 1.2 2.5 2 3.3.7.7 1.1 1.6 1.1 2.5a3.1 3.1 0 0 1-6.2 0c0-1.2.6-2.1 1.4-2.9.2.5.5.9.9 1.1 0-1.4.3-2.7.8-4Z" fill="${c}"/>`,
  wood: (c, w) => `<g transform="rotate(-22 12 12)" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round">
                <path d="M7.5 8h9.5a4 4 0 0 1 0 8H7.5"/>
                <ellipse cx="7.5" cy="12" rx="2.1" ry="4"/>
                <ellipse cx="7.5" cy="12" rx="0.9" ry="1.8"/>
                <path d="M13 8.6v6.8M16 8.9v6.2"/>
              </g>`,
  bioliquid: (c, w) => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="${w}"/>
             <path d="M12 8.4v9.2M12 12.8c1.7-.5 2.7-1.7 3.1-3.1M12 15.1c-1.5-.4-2.4-1.4-2.8-2.6"
                   fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`,
  biogas: (c, w) => `<path d="M7.6 17.8h9.1a3.5 3.5 0 0 0 .4-7 5.1 5.1 0 0 0-9.8-1.2 4.1 4.1 0 0 0 .3 8.2Z"
                   fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`,
  air: (c, w) => `<g fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round">
               <path d="M3.5 9h8.2a2.2 2.2 0 1 0-2.2-2.2"/>
               <path d="M3.5 13h10.6a2.4 2.4 0 1 1-2.4 2.4"/>
               <path d="M3.5 17h6.4"/>
             </g>`,
  geo: (c, w) => `<g fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round">
               <circle cx="12" cy="15" r="6.2"/>
               <path d="M5.9 14.2h12.2M12 8.8c1.9 2 1.9 10.4 0 12.4M12 8.8c-1.9 2-1.9 10.4 0 12.4"/>
               <path d="M8.6 6.6q1.1-1 0-2t0-2M12 6.6q1.1-1 0-2t0-2M15.4 6.6q1.1-1 0-2t0-2"/>
             </g>`,
  sun: (c, w) => `<g fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round">
               <circle cx="12" cy="12" r="4"/>
               <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6
                        M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"/>
             </g>`,
  wind: (c, w) => `<g fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round">
                <path d="M12 21.2v-8.6M9.6 21.2h4.8"/>
                <path d="M12 11.4V4.2M13.3 13.2l6.2 3.4M10.7 13.2l-6.2 3.4"/>
                <circle cx="12" cy="12.2" r="1.1" fill="${c}" stroke="none"/>
              </g>`,
  water: (c, w) => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="${w}"/>`,
  waste: (c, w) => `<g fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round">
                 <path d="M3.4 20.2v-8.4l4.6 2.9v-2.9l4.6 2.9V9.4h6.9v10.8Z"/>
                 <path d="M16.6 9.4V5.9h2.9v3.5"/>
               </g>`,
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3) RENDERER — „Status-Matrix": Gruppen aus Kacheln mit Haken/Strich
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_NS = 'http://www.w3.org/2000/svg';
const gEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const gR = n => Math.round(n * 100) / 100;


export function ggRenderStatusMatrix(cfg, T = GG_THEME) {
  const groups = cfg.groups;
  const nCards = groups.reduce((s, g) => s + g.items.length, 0);
  const innerW = T.width - 2 * T.pad.x;

  // Kartenbreite so, dass alle Gruppen zusammen exakt die Inhaltsbreite füllen.
  // Zwei Abstandsebenen: zwischen Abschnitten (section.gap), innerhalb eines
  // Abschnitts zwischen den Gruppen (group.gap).
  let chrome = (cfg.sections.length - 1) * T.section.gap;
  for (const sec of cfg.sections) chrome += (sec.groups.length - 1) * T.group.gap;
  for (const g of groups) chrome += 2 * T.group.pad + (g.items.length - 1) * T.card.gap;
  const cw = (innerW - chrome) / nCards;

  const cardsTop = T.group.top + T.group.pad + T.group.pillH + T.group.pillGap;
  const groupH   = T.group.pad + T.group.pillH + T.group.pillGap + T.card.h + T.group.pad;
  const height   = T.group.top + groupH + T.pad.bottom;

  // Geometrie in Lesereihenfolge: Abschnitt für Abschnitt, Gruppe für Gruppe
  const geo = [];
  let x = T.pad.x;
  cfg.sections.forEach((sec, si) => {
    if (si) x += T.section.gap;
    sec.groups.forEach((gi, k) => {
      if (k) x += T.group.gap;
      const g = groups[gi];
      const w = g.items.length * cw + (g.items.length - 1) * T.card.gap + 2 * T.group.pad;
      geo[gi] = { x, w };
      x += w;
    });
  });

  let out = `<rect x="0" y="0" width="${T.width}" height="${gR(height)}" fill="${T.bg}"/>`;

  // ── Abschnitts-Überschriften mit Marke darunter ──
  for (const sec of cfg.sections) {
    const a  = T.accents[sec.accent];
    const g0 = geo[sec.groups[0]];
    const g1 = geo[sec.groups[sec.groups.length - 1]];
    const cx = (g0.x + g1.x + g1.w) / 2;
    const span = (g1.x + g1.w) - g0.x;

    out += `<text x="${gR(cx)}" y="${T.section.titleBaseline}" text-anchor="middle"
              font-family="${T.font}" font-size="${T.section.titleSize}" font-weight="600"
              fill="${a}">${gEsc(sec.title)}</text>`;

    // Marke: Quadrat – dünn – dick – dünn – Quadrat (Verhältnis 1 : 1,4 : 1)
    const S = T.section;
    const rw = span * S.ruleWidthPct;
    const seg = (rw - 2 * S.dot) / 3.4;
    let rx = cx - rw / 2;
    const bar = (w, h, fill) => {
      const r = `<rect x="${gR(rx)}" y="${gR(S.ruleY - h / 2)}" width="${gR(w)}" height="${h}" fill="${fill}"/>`;
      rx += w; return r;
    };
    out += bar(S.dot, S.dot, a) + bar(seg, S.ruleThin, T.rule)
         + bar(seg * 1.4, S.ruleThick, a) + bar(seg, S.ruleThin, T.rule) + bar(S.dot, S.dot, a);
  }

  // ── Gruppen + Kacheln ──
  groups.forEach((g, gi) => {
    const a = T.accents[g.accent];
    const { x: gx, w: gw } = geo[gi];

    out += `<rect x="${gR(gx + 0.5)}" y="${T.group.top + 0.5}" width="${gR(gw - 1)}" height="${gR(groupH - 1)}"
              fill="${T.neutral.cardBg}" stroke="${T.line}" stroke-width="1"/>`;

    // Kopfzeile der Gruppe — gesperrt und in Versalien
    const px = gx + T.group.pad, pw = gw - 2 * T.group.pad, py = T.group.top + T.group.pad;
    out += `<rect x="${gR(px + 0.5)}" y="${py + 0.5}" width="${gR(pw - 1)}" height="${T.group.pillH - 1}"
              fill="${T.tint}" stroke="${T.line}" stroke-width="1"/>
            <text x="${gR(px + pw / 2)}" y="${py + 20}" text-anchor="middle"
              font-family="${T.font}" font-size="${T.group.pillSize}" font-weight="500"
              letter-spacing="${T.group.tracking}" fill="${a}">${gEsc(g.title.toUpperCase())}</text>`;

    g.items.forEach((it, ii) => {
      out += ggCard(it, gx + T.group.pad + ii * (cw + T.card.gap), cardsTop, cw, a, T);
    });
  });

  const svg = document.createElementNS(GG_NS, 'svg');
  svg.setAttribute('xmlns', GG_NS);
  svg.setAttribute('viewBox', `0 0 ${T.width} ${gR(height)}`);
  svg.setAttribute('width', T.width);
  svg.setAttribute('height', gR(height));
  svg.innerHTML = out;
  return svg;
}

/**
 * Beschriftungen einpassen, sobald die Figur im Dokument haengt.
 *
 * Elf gleich breite Kacheln auf 1000 px lassen rund 59 px Text zu; das
 * laengste Wort ("gasfoermige") braucht bei 12 px etwas mehr. Statt einzelne
 * Zeilen zu stauchen, bekommt die ganze Figur EINE kleinere Schriftgroesse --
 * unterschiedlich grosse Beschriftungen wuerden in einem Gutachten wie ein
 * Fehler aussehen.
 *
 * Bewusst ueber font-size und nicht ueber textLength: das kennt jeder
 * Renderer. Word ignoriert textLength beim Einbetten einer SVG-Datei.
 */
export function ggFitLabels(svg, T = GG_THEME) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  const texte = [...svg.querySelectorAll('text[data-fit]')];
  let faktor = 1;
  for (const t of texte) {
    const avail = parseFloat(t.getAttribute('data-fit'));
    let breite;
    try { breite = t.getBBox().width; } catch (e) { void e; return; }
    if (breite > avail) faktor = Math.min(faktor, avail / breite);
  }
  if (faktor >= 1) return;
  const size = Math.floor(T.card.labelSize * faktor * 10) / 10;
  texte.forEach(t => t.setAttribute('font-size', size));
}

function ggCard(it, x, y, w, a, T) {
  const on = it.state === 'on';
  const C  = T.card;
  const bg      = on ? T.tint : T.neutral.cardBg;
  const iconCol = on ? a : T.neutral.icon;
  const frame   = on ? a : T.neutral.iconLine;
  const txt     = on ? T.text.strong : T.text.faint;
  const h = C.h, fT = h - C.footerH;          // Oberkante des Fußbands

  let s = `<g transform="translate(${gR(x)},${y})">`;
  s += `<rect x="0.5" y="0.5" width="${gR(w - 1)}" height="${h - 1}" fill="${bg}" stroke="${T.line}" stroke-width="1"/>`;

  // Fußband — bei aktiven Kacheln flächig im Akzent, sonst hell mit Trennlinie
  if (on) {
    s += `<rect x="1" y="${fT}" width="${gR(w - 2)}" height="${gR(C.footerH - 1)}" fill="${a}"/>`;
  } else {
    s += `<rect x="1" y="${fT}" width="${gR(w - 2)}" height="${gR(C.footerH - 1)}" fill="${T.neutral.band}"/>
          <line x1="1" y1="${fT + 0.5}" x2="${gR(w - 1)}" y2="${fT + 0.5}" stroke="${T.line}" stroke-width="1"/>`;
  }

  // Icon im quadratischen Rahmen
  const bx = (w - C.iconBox) / 2, k = C.iconSize / 24;
  s += `<rect x="${gR(bx + 0.5)}" y="${C.iconTop + 0.5}" width="${C.iconBox - 1}" height="${C.iconBox - 1}"
          fill="none" stroke="${frame}" stroke-width="1"/>`;
  const io = (C.iconBox - C.iconSize) / 2;
  s += `<g transform="translate(${gR(bx + io)},${gR(C.iconTop + io)}) scale(${gR(k)})">`
     + (GG_ICONS[it.icon] ? GG_ICONS[it.icon](iconCol, gR(C.iconStroke / k)) : '') + `</g>`;

  // Beschriftung (1–2 Zeilen), oben ausgerichtet wie im Design. Elf gleich
  // breite Kacheln auf 1000 px lassen rund 60 px Text zu — laengere Woerter
  // ("gasfoermige") werden ueber textLength gestaucht statt ueberzulaufen.
  const lines = Array.isArray(it.label) ? it.label : [it.label];
  const base = C.iconTop + C.iconBox + C.gap + C.labelTop;
  const avail = w - 2 * C.labelPad;
  lines.forEach((ln, i) => {
    s += `<text x="${gR(w / 2)}" y="${gR(base + i * C.labelLine)}" text-anchor="middle"
            font-family="${T.font}" font-size="${C.labelSize}" font-weight="${on ? 600 : 400}"
            fill="${txt}" data-fit="${gR(avail)}">${gEsc(ln)}</text>`;
  });

  // Marke: Haken bzw. Strich — als Pfad gezeichnet, damit keine Schrift fehlen kann
  const mx = w / 2, my = fT + C.footerH / 2;
  if (on) {
    s += `<path d="M${gR(mx - 5)} ${gR(my + 0.3)} l3.7 3.9 l7.2 -8.6" fill="none" stroke="#FFFFFF"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    s += `<line x1="${gR(mx - 5)}" y1="${gR(my)}" x2="${gR(mx + 5)}" y2="${gR(my)}"
            stroke="${T.neutral.icon}" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  return s + '</g>';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3b) RENDERER — „Ganglinie": gerahmtes Blatt mit Jahresganglinie und Kennzahlen
 *
 * Aufbau aus dem Artboard „Jahresganglinie Strom": grüner Balken, Kopfzeile mit
 * Titel/Metadaten/Wortmarke, Diagramm mit beschrifteten Achsen, darunter zwei
 * Kennzahlenspalten.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Runde Schrittweite für Achsen: 1, 2, 2,5 oder 5 mal Zehnerpotenz. */
function ggNiceStep(roh) {
  if (!(roh > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(roh)));
  const r = roh / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 3 ? 3 : r <= 5 ? 5 : 10) * p;
}

const ggNum = (v, dez = 0) =>
  (v == null || !isFinite(v)) ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: dez, maximumFractionDigits: dez });

/** Grobe Textbreite ohne DOM — nur zum Vorbemessen der Legende. */
const ggEstW = (t, size, mono) => t.length * size * (mono ? 0.6 : 0.53);

export function ggRenderGanglinie(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel;

  const plotX = S.padX + S.yTitleW + S.yLabelW;
  const plotW = W - S.padX - plotX;
  const plotY = S.headBand + S.headH + S.plotTop;
  const plotH = S.plotH;
  const plotB = plotY + plotH;

  const xLabelY = plotB + S.xLabelDy;
  const xTitleY = plotB + S.xTitleDy;
  const kpiTop  = plotB + S.kpiTopDy;
  const height  = kpiTop + S.kpiPad + 2 * S.kpiRow + S.kpiPad + S.footSpace;

  const txt = (x, y, s, o = {}) =>
    `<text x="${gR(x)}" y="${gR(y)}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}
       font-family="${o.mono ? T.fontMono : T.font}" font-size="${o.size || S.fsBody}"
       ${o.weight ? `font-weight="${o.weight}" ` : ''}${o.tracking ? `letter-spacing="${o.tracking}" ` : ''}
       ${o.transform ? `transform="${o.transform}" ` : ''}fill="${o.fill || T.text.strong}">${gEsc(s)}</text>`;

  let out = `<rect x="0" y="0" width="${W}" height="${gR(height)}" fill="${T.bg}"/>`;

  // ── Kopfbalken und Kopfzeile ──
  out += `<rect x="0" y="0" width="${W}" height="${S.headBand}" fill="${gruen}"/>`;
  const hTop = S.headBand, hBot = hTop + S.headH;
  const colMid = W - S.headMetaW - S.headLogoW, colLogo = W - S.headLogoW;
  out += `<line x1="0" y1="${gR(hBot) + 0.5}" x2="${W}" y2="${gR(hBot) + 0.5}" stroke="${T.line}" stroke-width="1"/>
          <line x1="${colMid}.5" y1="${hTop}" x2="${colMid}.5" y2="${gR(hBot)}" stroke="${T.line}" stroke-width="1"/>
          <line x1="${colLogo}.5" y1="${hTop}" x2="${colLogo}.5" y2="${gR(hBot)}" stroke="${T.line}" stroke-width="1"/>`;

  const blockH = S.fsEyebrow + 6 + S.fsTitle * 1.25 + 6 + S.fsSub * 1.25;
  let ty = hTop + (S.headH - blockH) / 2;
  out += txt(S.padX, ty + S.fsEyebrow, (cfg.eyebrow || '').toUpperCase(),
             { mono: true, size: S.fsEyebrow, weight: 500, tracking: S.trackEyebrow, fill: T.accents.gruen });
  ty += S.fsEyebrow + 6;
  out += txt(S.padX, ty + S.fsTitle, cfg.titel || '', { size: S.fsTitle, weight: 700, tracking: -0.21 });
  ty += S.fsTitle * 1.25 + 6;
  out += txt(S.padX, ty + S.fsSub, cfg.ort || '', { size: S.fsSub, fill: T.text.muted });

  // Metadaten — Beschriftung grau, Wert schwarz, beides dieselbe Mono
  const meta = Object.entries(cfg.meta || {});
  let my = hTop + (S.headH - (meta.length * S.metaRow - (S.metaRow - S.fsMeta))) / 2 + S.fsMeta;
  for (const [k, v] of meta) {
    out += txt(colMid + 20, my, k, { mono: true, size: S.fsMeta, weight: 500, fill: T.text.faint });
    out += txt(colMid + 20 + S.metaKeyW, my, v || '—', { mono: true, size: S.fsMeta, weight: 500 });
    my += S.metaRow;
  }

  // Wortmarke
  const logoH = S.logoW * (LKEBW_LOGO_H / LKEBW_LOGO_W);
  out += `<image href="${LKEBW_LOGO}" x="${gR(colLogo + (S.headLogoW - S.logoW) / 2)}"
            y="${gR(hTop + (S.headH - logoH) / 2)}" width="${S.logoW}" height="${gR(logoH)}"/>`;

  // ── Achsen bestimmen ──
  const daten = cfg.daten, N = daten ? daten.length : 0;
  let yMax = 1, yStep = 1;
  if (N) {
    let max = 0;
    for (let i = 0; i < N; i++) if (daten[i] > max) max = daten[i];
    yStep = ggNiceStep(max / 8);
    yMax  = Math.max(yStep, Math.ceil(max / yStep) * yStep);
  }

  // ── Diagrammfläche ──
  out += `<rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;

  if (!N) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, cfg.leer || 'Kein Lastgang vorhanden',
               { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    const yOf = v => plotB - (v / yMax) * plotH;
    const xStep = ggNiceStep(N / 12);

    // Gitter
    let gitter = '';
    for (let v = yStep; v < yMax; v += yStep) {
      const y = Math.round(yOf(v)) + 0.5;
      gitter += `M${gR(plotX)} ${y}H${gR(plotX + plotW)}`;
    }
    for (let k = xStep; k < N; k += xStep) {
      const x = Math.round(plotX + (k / N) * plotW) + 0.5;
      gitter += `M${x} ${plotY}V${gR(plotB)}`;
    }
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;

    // Ganglinie als Min/Max-Hüllkurve je Pixelspalte — 35.040 Werte lassen sich
    // nicht sinnvoll als Polygonzug zeichnen, die Spitzen gingen dabei verloren.
    const spalten = Math.max(1, Math.floor(plotW));
    let kurve = '';
    for (let c = 0; c < spalten; c++) {
      const a = Math.floor((c / spalten) * N);
      const b = Math.max(a + 1, Math.floor(((c + 1) / spalten) * N));
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i < b && i < N; i++) { const v = daten[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (!isFinite(lo)) continue;
      const x = gR(plotX + c + 0.5);
      kurve += `M${x} ${gR(yOf(lo))}V${gR(yOf(hi))}`;
    }
    out += `<path d="${kurve}" fill="none" stroke="${cfg.kurveFarbe || T.energy.strom}" stroke-width="1"/>`;

    // Grundlast
    if (cfg.grundlastKw > 0) {
      const yb = gR(yOf(cfg.grundlastKw));
      out += `<line x1="${gR(plotX)}" y1="${yb}" x2="${gR(plotX + plotW)}" y2="${yb}"
                stroke="${T.accents.gruen}" stroke-width="3" stroke-dasharray="13 9"/>`;
    }

    // Y-Beschriftung
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      out += txt(plotX - 8, yOf(v) + S.fsAxis * 0.36, ggNum(v),
                 { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }
    // X-Beschriftung
    for (let k = 0; k < N; k += xStep) {
      out += txt(plotX + (k / N) * plotW, xLabelY, ggNum(k),
                 { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }

    // Legende im Diagramm, oben rechts
    const eintraege = [
      { farbe: cfg.kurveFarbe || T.energy.strom, breit: 1.5, strich: '', text: cfg.reihe || '' },
      ...(cfg.grundlastKw > 0 ? [{ farbe: T.accents.gruen, breit: 3, strich: '6 4', text: cfg.grundlastLabel || '' }] : []),
    ];
    const lw = 12 + 26 + 9 + Math.max(...eintraege.map(e => ggEstW(e.text, S.fsLeg))) + 14;
    const lh = 8 + eintraege.length * 18 + 2;
    const lx = plotX + plotW - 12 - lw, ly = plotY + 10;
    // Deckende Angabe statt rgba(): librsvg und der SVG-Renderer in Word
    // werten Funktionsschreibweisen in fill nicht zuverlaessig aus.
    out += `<rect x="${gR(lx)}" y="${ly}" width="${gR(lw)}" height="${gR(lh)}" fill="${T.bg}" fill-opacity="0.92"
              stroke="${T.line}" stroke-width="1"/>`;
    eintraege.forEach((e, i) => {
      const ey = ly + 8 + i * 18 + 5.5;
      out += `<line x1="${gR(lx + 12)}" y1="${gR(ey)}" x2="${gR(lx + 38)}" y2="${gR(ey)}"
                stroke="${e.farbe}" stroke-width="${e.breit}"${e.strich ? ` stroke-dasharray="${e.strich}"` : ''}/>`;
      out += txt(lx + 47, ey + S.fsLeg * 0.36, e.text, { size: S.fsLeg });
    });
  }

  // Rahmen der Diagrammfläche, Grundlinie kräftiger
  out += `<rect x="${gR(plotX) + 0.5}" y="${plotY}.5" width="${gR(plotW) - 1}" height="${plotH - 1}"
            fill="none" stroke="${T.rule}" stroke-width="1"/>
          <line x1="${gR(plotX)}" y1="${gR(plotB) - 1}" x2="${gR(plotX + plotW)}" y2="${gR(plotB) - 1}"
            stroke="${T.text.strong}" stroke-width="2"/>`;

  // Achsentitel
  const ycx = S.padX + S.yTitleW / 2, ycy = plotY + plotH / 2;
  out += txt(ycx, ycy, cfg.achseY || '', { anchor: 'middle', size: S.fsAxisTitle, weight: 600,
             tracking: 0.46, fill: T.text.muted, transform: `rotate(-90 ${gR(ycx)} ${gR(ycy)})` });
  out += txt(plotX + plotW / 2, xTitleY, cfg.achseX || '',
             { anchor: 'middle', size: S.fsAxisTitle, weight: 600, tracking: 0.46, fill: T.text.muted });

  // ── Kennzahlen ──
  const mitte = W / 2;
  out += `<line x1="${S.padX}" y1="${gR(kpiTop) + 0.5}" x2="${W - S.padX}" y2="${gR(kpiTop) + 0.5}" stroke="${T.line}" stroke-width="1"/>
          <line x1="${mitte}.5" y1="${gR(kpiTop)}" x2="${mitte}.5" y2="${gR(kpiTop + S.kpiPad * 2 + 2 * S.kpiRow)}" stroke="${T.line}" stroke-width="1"/>`;

  const zeile = (r, x0, wertX, labelX, i) => {
    const y = kpiTop + S.kpiPad + i * S.kpiRow + S.fsKpi;
    let z = '';
    if (r.prozent) z += txt(x0 + S.kpiPctW, y, r.prozent, { anchor: 'end', mono: true, size: S.fsKpiPct, weight: 500, fill: T.text.faint });
    if (r.highlight) {
      const bw = ggEstW(r.wert, S.fsKpi, true) + 12;
      z += `<rect x="${gR(wertX - bw + 6)}" y="${gR(y - S.fsKpi - 1)}" width="${gR(bw)}" height="${gR(S.fsKpi + 8)}" fill="${T.tint}"/>`;
    }
    z += txt(wertX, y, r.wert, { anchor: 'end', mono: true, size: S.fsKpi, weight: r.highlight ? 600 : 500,
                                 fill: r.highlight ? gruen : T.text.strong });
    z += txt(labelX, y, r.label, { size: S.fsKpiLabel });
    return z;
  };
  (cfg.kpiLinks  || []).slice(0, 2).forEach((r, i) => { out += zeile(r, S.padX, S.padX + S.kpiPctW + 12 + S.kpiWertW, S.padX + S.kpiPctW + 24 + S.kpiWertW, i); });
  (cfg.kpiRechts || []).slice(0, 2).forEach((r, i) => { out += zeile(r, mitte + 24, mitte + 24 + S.kpiWertW2, mitte + 36 + S.kpiWertW2, i); });

  const svg = document.createElementNS(GG_NS, 'svg');
  svg.setAttribute('xmlns', GG_NS);
  svg.setAttribute('viewBox', `0 0 ${W} ${gR(height)}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', gR(height));
  svg.innerHTML = out;
  return svg;
}

/** Kennzahlen eines Lastgangs: Summe, Spitze, Grundlast (1-%-Quantil). */
export function ggLastgangKennzahlen(daten, stundenProWert) {
  const n = daten.length;
  let summe = 0, spitze = 0;
  for (let i = 0; i < n; i++) { const v = daten[i]; summe += v; if (v > spitze) spitze = v; }
  const sortiert = Array.prototype.slice.call(daten).sort((a, b) => a - b);
  const grundlast = sortiert[Math.floor(n * 0.01)] || 0;
  return {
    arbeitKwh: summe * stundenProWert,
    spitzeKw: spitze,
    grundlastKw: grundlast,
    grundlastKwh: grundlast * n * stundenProWert,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4) EXPORT — PNG in die Zwischenablage / PNG + SVG als Datei
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggSvgSource(svg) {
  // Kopie ohne Vorschau-Ballast: das style="width:100%" der Panel-Darstellung
  // wuerde beim Einbetten in Word die Groesse aus width/height ueberstimmen.
  const rein = svg.cloneNode(true);
  rein.removeAttribute('style');
  rein.querySelectorAll('[data-fit]').forEach(t => t.removeAttribute('data-fit'));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(rein);
}

export function ggSvgToPngBlob(svg, scale) {
  return new Promise((resolve, reject) => {
    const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    const url = URL.createObjectURL(new Blob([ggSvgSource(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('PNG konnte nicht erzeugt werden')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG konnte nicht gerastert werden')); };
    img.src = url;
  });
}

export async function ggCopyForWord(svg, scale) {
  const blob = await ggSvgToPngBlob(svg, scale);
  // Weg 1: Clipboard-API (Chrome, Edge)
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      return 'Zwischenablage';
    } catch (e) { void e; /* Fallback unten */ }
  }
  // Weg 2: HTML-Ausschnitt mit eingebettetem Bild — Word nimmt das als Bild an
  const dataUrl = await new Promise(res => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob);
  });
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  holder.innerHTML = `<img src="${dataUrl}">`;
  document.body.appendChild(holder);
  const rng = document.createRange(); rng.selectNodeContents(holder);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  const ok = document.execCommand('copy');
  sel.removeAllRanges(); holder.remove();
  if (!ok) throw new Error('Zwischenablage nicht verfügbar');
  return 'Zwischenablage (Fallback)';
}

function ggDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5) FIGUREN-REGISTRY — hier kommt jede neue Gutachten-Grafik dazu
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_FIGUREN = [
  {
    id: 'traeger-quellen',
    titel: 'Energieträger / Energiequellen',
    datei: 'energietraeger-quellen',
    hinweis: 'Welche Energieträger und -quellen im Quartier zum Einsatz kommen. „Aus Projekt übernehmen" leitet die Haken aus Erzeugern und Assets ab.',
    render: cfg => ggRenderStatusMatrix(cfg),
    config: {
      sections: [
        { title: 'Energieträger',  accent: 'gruenDunkel', groups: [0, 1] },
        { title: 'Energiequellen', accent: 'gruen',       groups: [2] },
      ],
      groups: [
        { title: 'fossile', accent: 'gruenDunkel', items: [
          { key: 'heizoel', label: ['Heizöl EL'], icon: 'oil', state: 'on' },
          { key: 'erdgas',  label: ['Erdgas'],    icon: 'gas', state: 'on' },
        ]},
        { title: 'regenerative', accent: 'gruenDunkel', items: [
          { key: 'biofest',  label: ['Feste', 'Biomasse'],      icon: 'wood',      state: 'on'  },
          { key: 'bioliquid',label: ['Flüssige', 'Biomasse'],   icon: 'bioliquid', state: 'off' },
          { key: 'biogas',   label: ['gasförmige', 'Biomasse'], icon: 'biogas',    state: 'off' },
        ]},
        { title: 'Natürliche regenerative', accent: 'gruen', items: [
          { key: 'luft',     label: ['Luft'],          icon: 'air',   state: 'on'  },
          { key: 'erdwaerme',label: ['Erdwärme'],      icon: 'geo',   state: 'on'  },
          { key: 'sonne',    label: ['Sonne', '[PV]'], icon: 'sun',   state: 'on'  },
          { key: 'wind',     label: ['Wind'],          icon: 'wind',  state: 'off' },
          { key: 'wasser',   label: ['Wasser'],        icon: 'water', state: 'off' },
          { key: 'abwaerme', label: ['Abwärme'],       icon: 'waste', state: 'off' },
        ]},
      ],
    },
    // Ableitung aus dem Projektstand. Rückgabe: { key: true|false }
    ausProjekt() {
      const en = window._dispatchEnergy || {};
      const hat = k => (en[k]?.waermeMwh || 0) > 0;
      const nAssets = t => { try { return window.listAssets?.({ type: t }).length || 0; } catch (e) { void e; return 0; } };
      return {
        heizoel:   hat('heizoel'),
        erdgas:    hat('gaskessel') || hat('bhkw') || hat('_autoGk'),
        biofest:   hat('pellets') || hat('hhs'),
        bioliquid: false,          // im Tool nicht modelliert
        biogas:    false,          // im Tool nicht modelliert
        luft:      hat('lwwp'),
        erdwaerme: hat('geo'),
        sonne:     nAssets('PV') > 0,
        wind:      nAssets('Wind') > 0,
        wasser:    hat('fg'),
        abwaerme:  false,          // im Tool nicht modelliert
      };
    },
  },
  // ── Ist-Lastgang Strom ──────────────────────────────────────────────────
  {
    id: 'lastgang-strom',
    autoSync: true,   // Daten kommen komplett aus dem Projekt — nichts zum Anhaken
    titel: 'Ist-Lastgang Strom',
    datei: 'ist-lastgang-strom',
    hinweis: 'Gemessener Jahreslastgang aus dem Stromimport (15-Minuten-Werte, sonst Stundenwerte). '
           + 'Kennzahlen und Achsen ergeben sich aus den Daten; die Kopfzeile lässt sich unten eintragen.',
    render: cfg => ggRenderGanglinie(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Jahresganglinie Strom',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: 'Stunden im Jahr',
      reihe: 'Liegenschaftsstromverbrauch',
      grundlastLabel: 'Stromgrundlast Leistung',
      leer: 'Kein Stromlastgang importiert — unter Strom-Grundlagen eine Lastgangdatei laden.',
      daten: null, grundlastKw: 0, kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.kurveFarbe = GG_THEME.energy.strom;
      const viertel = window.elQuartierH15;
      const stunden = window.elQuartierH;
      const daten = viertel && viertel.length ? viertel : (stunden && stunden.length ? stunden : null);
      if (!daten) { cfg.daten = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Kein Stromlastgang importiert.'; }

      const istViertel = daten === viertel;
      const h = istViertel ? 0.25 : 1;
      const k = ggLastgangKennzahlen(daten, h);
      cfg.daten = daten;
      cfg.achseX = istViertel ? '1/4 Stunden im Jahr' : 'Stunden im Jahr';
      cfg.grundlastKw = k.grundlastKw;
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      cfg.kpiLinks = [
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: 'Liegenschaftsbezug vom EVU' },
        { prozent: ggNum(k.arbeitKwh ? k.grundlastKwh / k.arbeitKwh * 100 : 0) + ' %',
          wert: ggNum(k.grundlastKwh) + ' kWh', label: 'Stromgrundlast Arbeit' },
      ];
      cfg.kpiRechts = [
        { wert: ggNum(k.spitzeKw) + ' kW', label: 'Stromspitzenlast' },
        { wert: ggNum(k.grundlastKw) + ' kW', label: 'Stromgrundlast Leistung', highlight: true },
      ];
      return `✓ ${ggNum(daten.length)} ${istViertel ? 'Viertelstunden' : 'Stunden'} aus `
           + `${window.elQuartierFilename || 'dem Stromimport'} übernommen.`;
    },
  },

  // ── Ist-Lastgang Wärme ──────────────────────────────────────────────────
  {
    id: 'lastgang-waerme',
    autoSync: true,   // Daten kommen komplett aus dem Projekt — nichts zum Anhaken
    titel: 'Ist-Lastgang Wärme',
    datei: 'ist-lastgang-waerme',
    hinweis: 'Bevorzugt der importierte Wärmelastgang aus den Wärme-Grundlagen. Ist keiner vorhanden, '
           + 'wird der berechnete Basis-Lastgang gezeigt und in der Legende als solcher benannt.',
    render: cfg => ggRenderGanglinie(cfg),
    config: {
      eyebrow: 'Wärmetechnisches Gutachten',
      titel: 'Jahresganglinie Wärme',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: 'Stunden im Jahr',
      reihe: 'Wärmeleistung Liegenschaft',
      grundlastLabel: 'Wärmegrundlast Leistung',
      leer: 'Kein Wärmelastgang vorhanden — unter Wärme-Grundlagen importieren oder berechnen.',
      daten: null, grundlastKw: 0, kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.kurveFarbe = GG_THEME.energy.waerme;
      let daten = null, quelle = '';
      try {
        const gl = window.captureWaermeGrundlagen?.();
        if (gl && gl.lastgangKw && gl.lastgangKw.length) { daten = gl.lastgangKw; quelle = 'Import'; }
      } catch (e) { void e; }
      if (!daten && window._basisLastgangKw && window._basisLastgangKw.length) {
        daten = window._basisLastgangKw; quelle = 'berechnet';
      }
      if (!daten) { cfg.daten = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Kein Wärmelastgang vorhanden.'; }

      const k = ggLastgangKennzahlen(daten, 1);
      cfg.daten = daten;
      cfg.achseX = 'Stunden im Jahr';
      cfg.grundlastKw = k.grundlastKw;
      cfg.reihe = quelle === 'Import' ? 'Wärmeleistung Liegenschaft (Messung)'
                                      : 'Wärmeleistung Liegenschaft (berechnet)';
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      cfg.kpiLinks = [
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: 'Wärmebedarf Liegenschaft' },
        { prozent: ggNum(k.arbeitKwh ? k.grundlastKwh / k.arbeitKwh * 100 : 0) + ' %',
          wert: ggNum(k.grundlastKwh) + ' kWh', label: 'Wärmegrundlast Arbeit' },
      ];
      cfg.kpiRechts = [
        { wert: ggNum(k.spitzeKw) + ' kW', label: 'Wärmespitzenlast' },
        { wert: ggNum(k.grundlastKw) + ' kW', label: 'Wärmegrundlast Leistung', highlight: true },
      ];
      return `✓ ${ggNum(daten.length)} Stundenwerte übernommen (${quelle}).`;
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 6) PANEL — Analyse-Sektion „Gutachten-Grafiken"
 * ═══════════════════════════════════════════════════════════════════════ */
/** Liegenschaft aus dem Projektkopf bzw. den Waerme-Grundlagen. */
function ggLiegenschaft() {
  const name = document.querySelector('.header-projekt-name')?.textContent?.trim() || '';
  const plz  = document.getElementById('gl-plz')?.value?.trim() || '';
  const ort  = document.getElementById('gl-stadt')?.value?.trim() || '';
  const rechts = [plz, ort].filter(Boolean).join(' ');
  return [name, rechts].filter(Boolean).join(' · ');
}

const ggHeute = () => new Date().toLocaleDateString('de-DE');

const _gg = { figurId: GG_FIGUREN[0].id, scale: 3, svg: null };

const ggFigur = () => GG_FIGUREN.find(f => f.id === _gg.figurId) || GG_FIGUREN[0];

export function ggBuildAnalyseSection() {
  const tabBar = document.getElementById('analyse-view-tabs');
  if (tabBar && !tabBar.querySelector('[data-section="ggrafik"]')) {
    const btn = document.createElement('button');
    btn.className = 'analyse-section-tab';
    btn.dataset.section = 'ggrafik';
    btn.dataset.click = "setAnalyseSection('ggrafik')";
    btn.textContent = '🖼 Gutachten-Grafiken';
    btn.title = 'Abbildungen fürs Gutachten in einheitlichem Design — direkt in die Zwischenablage für Word oder als SVG-Datei.';
    tabBar.appendChild(btn);
  }

  let wrap = document.getElementById('analyse-ggrafik-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'analyse-ggrafik-wrap';
    wrap.style.display = 'none';
    wrap.innerHTML = `
<div style="display:flex;flex-direction:row;gap:0;height:calc(100vh - 160px);min-height:400px;background:#0f0f1a;border-radius:8px;overflow:hidden;">
  <div id="gg-sidebar" style="width:250px;flex-shrink:0;overflow-y:auto;border-right:1px solid rgba(38,166,154,.15);padding:10px;"></div>
  <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow-y:auto;padding:12px 14px;">
    <div id="gg-bar" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;"></div>
    <div id="gg-paper" style="background:#fff;border-radius:6px;padding:10px;overflow-x:auto;"></div>
    <div id="gg-status" style="font-size:11px;color:#26a69a;min-height:16px;margin-top:8px;"></div>
    <div id="gg-optionen" style="margin-top:10px;"></div>
  </div>
</div>`;
    document.getElementById('center-analyse-view')?.appendChild(wrap);
  }
}

/**
 * Figuren, die sich vollstaendig aus dem Projekt speisen (die Ganglinien),
 * holen ihre Daten selbst — sonst stuende dort ein leeres Blatt, obwohl der
 * Lastgang laengst importiert ist. Status-Matrizen bleiben aussen vor, deren
 * Haken setzt man von Hand.
 */
function ggAutoSync() {
  const figur = ggFigur();
  if (!figur.autoSync || typeof figur.ausProjekt !== 'function') return '';
  const ergebnis = figur.ausProjekt(figur.config);
  return typeof ergebnis === 'string' ? ergebnis : '';
}

export function ggShowSection(visible) {
  const wrap = document.getElementById('analyse-ggrafik-wrap');
  if (!wrap) return;
  wrap.style.display = visible ? '' : 'none';
  if (!visible) return;
  const meldung = ggAutoSync();
  ggRenderPanel();
  if (meldung) ggSay(meldung);
}

export function ggRenderPanel() {
  const figur = ggFigur();

  // ── Sidebar: Figurenliste ──
  const side = document.getElementById('gg-sidebar');
  if (side) {
    side.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Abbildungen</div>`
      + GG_FIGUREN.map(f => {
          const aktiv = f.id === _gg.figurId;
          return `<button data-click="ggSelectFigur('${f.id}')" style="display:block;width:100%;text-align:left;margin-bottom:4px;padding:7px 9px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:11px;line-height:1.35;
            border:1px solid ${aktiv ? 'rgba(38,166,154,.5)' : 'rgba(255,255,255,.08)'};
            background:${aktiv ? 'rgba(38,166,154,.14)' : 'rgba(255,255,255,.03)'};
            color:${aktiv ? '#26a69a' : 'var(--muted)'};">${gEsc(f.titel)}</button>`;
        }).join('')
      + `<div style="margin-top:12px;font-size:10px;color:var(--muted);line-height:1.5;">${gEsc(figur.hinweis || '')}</div>`;
  }

  // ── Export-Leiste ──
  const bar = document.getElementById('gg-bar');
  if (bar) {
    const btn = (label, click, primary) => `<button data-click="${click}" style="font-family:inherit;font-size:11px;padding:6px 12px;border-radius:5px;cursor:pointer;
      border:1px solid ${primary ? 'rgba(38,166,154,.6)' : 'rgba(255,255,255,.12)'};
      background:${primary ? 'rgba(38,166,154,.18)' : 'rgba(255,255,255,.04)'};
      color:${primary ? '#26a69a' : 'var(--muted)'};">${label}</button>`;
    bar.innerHTML = btn('⧉ Für Word kopieren', 'ggCopy()', true)
      + btn('⤓ PNG', 'ggSavePng()') + btn('⤓ SVG', 'ggSaveSvg()')
      + `<select data-change="ggSetScale(this.value)" style="font-family:inherit;font-size:11px;padding:5px 6px;border-radius:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);">
           ${[[2, '2× · ~300 dpi'], [3, '3× · ~450 dpi'], [4, '4× · ~600 dpi']]
             .map(([v, l]) => `<option value="${v}"${_gg.scale === v ? ' selected' : ''}>${l}</option>`).join('')}
         </select>`
      + `<span style="margin-left:auto;font-size:10px;color:var(--muted);">In Word mit Strg+V einfügen — SVG bleibt Vektor über Einfügen › Bilder.</span>`;
  }

  // ── Figur zeichnen ──
  const paper = document.getElementById('gg-paper');
  if (paper) {
    _gg.svg = figur.render(figur.config);
    _gg.svg.style.width = '100%';
    _gg.svg.style.maxWidth = GG_THEME.width + 'px';   // nie groesser als 1:1
    _gg.svg.style.height = 'auto';
    _gg.svg.style.display = 'block';
    paper.replaceChildren(_gg.svg);
    ggFitLabels(_gg.svg);   // erst im Dokument laesst sich die Textbreite messen
  }

  // ── Optionen: Zustände je Kachel ──
  const opt = document.getElementById('gg-optionen');
  if (opt) {
    let html = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">${figur.config.groups ? 'Zustände' : 'Kopfzeile'}</div>`;
    if (typeof figur.ausProjekt === 'function') {
      html += `<button data-click="ggSyncFromProject()" style="font-family:inherit;font-size:10px;padding:3px 9px;border-radius:4px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);">⟳ Aus Projekt übernehmen</button>`;
    }
    html += `</div>`;

    if (figur.config.groups) {
      // Status-Matrix: je Kachel ein Haken
      html += `<div style="display:flex;flex-wrap:wrap;gap:5px 16px;">`;
      figur.config.groups.forEach((g, gi) => g.items.forEach((it, ii) => {
        html += `<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;">
            <input type="checkbox"${it.state === 'on' ? ' checked' : ''} data-change="ggToggleItem(${gi},${ii},this.checked)">
            ${gEsc(Array.isArray(it.label) ? it.label.join(' ') : it.label)}</label>`;
      }));
      html += `</div>`;
    }

    if (figur.config.meta) {
      // Ganglinien-Blatt: Kopfzeile von Hand ergaenzen
      const feld = (label, wert, click) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--muted);">
          ${gEsc(label)}
          <input type="text" value="${gEsc(wert || '')}" data-change="${click}" style="font-family:inherit;font-size:11px;padding:4px 6px;border-radius:4px;
            border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--text,#e8eaed);min-width:150px;"></label>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:8px 12px;">`
        + feld('Kopfzeile', figur.config.eyebrow, "ggSetKopf('eyebrow',this.value)")
        + feld('Titel', figur.config.titel, "ggSetKopf('titel',this.value)")
        + feld('Liegenschaft', figur.config.ort, "ggSetKopf('ort',this.value)")
        + Object.keys(figur.config.meta).map(k =>
            feld(k, figur.config.meta[k], `ggSetMeta('${k}',this.value)`)).join('')
        + `</div>`;
    }
    opt.innerHTML = html;
  }
}

function ggSay(msg, err) {
  const el = document.getElementById('gg-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? '#ef5350' : '#26a69a';
}

export function ggSelectFigur(id) {
  _gg.figurId = id;
  const meldung = ggAutoSync();
  ggRenderPanel();
  ggSay(meldung);
}

export function ggSetScale(v) {
  _gg.scale = parseInt(v, 10) || 3;
}

export function ggToggleItem(gi, ii, on) {
  const it = ggFigur().config.groups[gi]?.items[ii];
  if (!it) return;
  it.state = on ? 'on' : 'off';
  ggRenderPanel();
}

export function ggSyncFromProject() {
  const figur = ggFigur();
  if (typeof figur.ausProjekt !== 'function') return;
  // Zwei Formen: Status-Matrizen liefern eine Zustandstabelle zurueck, alle
  // anderen Figuren schreiben direkt in ihre Config und melden das Ergebnis.
  const ergebnis = figur.ausProjekt(figur.config);
  let meldung = typeof ergebnis === 'string' ? ergebnis : '';
  if (ergebnis && typeof ergebnis === 'object') {
    let n = 0;
    for (const g of figur.config.groups || []) {
      for (const it of g.items) {
        if (it.key in ergebnis) { it.state = ergebnis[it.key] ? 'on' : 'off'; n++; }
      }
    }
    meldung = `✓ ${n} Kacheln aus dem Projektstand gesetzt. Nicht modellierte Träger `
            + '(flüssige/gasförmige Biomasse, Abwärme) bleiben leer.';
  }
  ggRenderPanel();
  ggSay(meldung || '✓ Aus dem Projektstand übernommen.');
}

export function ggSetKopf(feld, wert) {
  ggFigur().config[feld] = wert;
  ggRenderPanel();
}

export function ggSetMeta(key, wert) {
  const meta = ggFigur().config.meta;
  if (meta) meta[key] = wert;
  ggRenderPanel();
}

export async function ggCopy() {
  if (!_gg.svg) return;
  ggSay('Wird gerendert …');
  try {
    const wohin = await ggCopyForWord(_gg.svg, _gg.scale);
    ggSay(`✓ In die ${wohin} kopiert — jetzt in Word mit Strg+V einfügen.`);
  } catch (e) { ggSay('⚠ ' + e.message, true); }
}

export async function ggSavePng() {
  if (!_gg.svg) return;
  try {
    ggDownload(await ggSvgToPngBlob(_gg.svg, _gg.scale), ggFigur().datei + '.png');
    ggSay('✓ PNG gespeichert.');
  } catch (e) { ggSay('⚠ ' + e.message, true); }
}

export function ggSaveSvg() {
  if (!_gg.svg) return;
  ggDownload(new Blob([ggSvgSource(_gg.svg)], { type: 'image/svg+xml' }), ggFigur().datei + '.svg');
  ggSay('✓ SVG gespeichert — in Word über Einfügen › Bilder einbetten (bleibt Vektor).');
}
