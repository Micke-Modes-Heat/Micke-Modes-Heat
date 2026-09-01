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

    // Version 2 („reduziertes Blatt"): Kopf ohne Liegenschaft und Metadaten,
    // die Kennzahlen stehen nicht mehr unter der Kurve, sondern auf einem
    // eigenen Tabellenblatt (ggRenderKennzahlen).
    headHSchmal: 70,
    tabTop: 30, tabHeadH: 32, tabRow: 30, tabPadX: 12,
    tabWertW: 180, tabEinheitW: 86, tabPctW: 92,
    fsTabHead: 10.5, trackTabHead: 1.1, fsTabWert: 13.5, fsTab: 12.5,
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

/**
 * Geometrie des gerahmten Blatts — haengt nur von T und der Blattversion ab,
 * nicht vom Inhalt. Von allen Sheet-Figuren (Ganglinie, Heatmap, …) gemeinsam
 * genutzt, damit Kopfzeile/Kennzahlenblock immer exakt gleich sitzen.
 *
 * cfg.layout === 'reduziert' ist Version 2: schmalerer Kopf (ohne Untertitel
 * und Metadatenspalte) und kein Kennzahlenblock — das Blatt endet unter dem
 * Achsentitel, die Werte stehen auf dem Kennzahlenblatt daneben.
 */
function ggSheetGeometry(T, cfg = {}) {
  const S = T.sheet, W = T.width;
  const reduziert = cfg.layout === 'reduziert';
  const headH = reduziert ? S.headHSchmal : S.headH;
  const plotX = S.padX + S.yTitleW + S.yLabelW;
  const plotW = W - S.padX - plotX;
  const plotY = S.headBand + headH + S.plotTop;
  const plotH = S.plotH;
  const plotB = plotY + plotH;
  const xLabelY = plotB + S.xLabelDy;
  const xTitleY = plotB + S.xTitleDy;
  const kpiTop  = plotB + S.kpiTopDy;
  const height  = reduziert ? xTitleY + S.footSpace + 10
                            : kpiTop + S.kpiPad + 2 * S.kpiRow + S.kpiPad + S.footSpace;
  return { S, W, headH, reduziert, plotX, plotW, plotY, plotH, plotB, xLabelY, xTitleY, kpiTop, height };
}

export function ggTxt(T, S, x, y, s, o = {}) {
  return `<text x="${gR(x)}" y="${gR(y)}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}
       font-family="${o.mono ? T.fontMono : T.font}" font-size="${o.size || S.fsBody}"
       ${o.weight ? `font-weight="${o.weight}" ` : ''}${o.tracking ? `letter-spacing="${o.tracking}" ` : ''}
       ${o.transform ? `transform="${o.transform}" ` : ''}fill="${o.fill || T.text.strong}">${gEsc(s)}</text>`;
}

/** Papierhintergrund, Kopfbalken mit Titel/Metadaten/Wortmarke — für jede Sheet-Figur gleich. */
export function ggSheetHeader(cfg, T, G) {
  const S = G.S, W = G.W, headH = G.headH || S.headH;
  const gruen = T.accents.gruenDunkel;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = `<rect x="0" y="0" width="${W}" height="${gR(G.height)}" fill="${T.bg}"/>`;
  out += `<rect x="0" y="0" width="${W}" height="${S.headBand}" fill="${gruen}"/>`;
  const hTop = S.headBand, hBot = hTop + headH;
  const colMid = W - S.headMetaW - S.headLogoW, colLogo = W - S.headLogoW;
  out += `<line x1="0" y1="${gR(hBot) + 0.5}" x2="${W}" y2="${gR(hBot) + 0.5}" stroke="${T.line}" stroke-width="1"/>
          <line x1="${colLogo}.5" y1="${hTop}" x2="${colLogo}.5" y2="${gR(hBot)}" stroke="${T.line}" stroke-width="1"/>`;
  // Die mittlere Trennlinie gehoert zur Metadatenspalte — in Version 2 waere
  // sie nur noch ein Strich im Leeren.
  if (!G.reduziert) {
    out += `<line x1="${colMid}.5" y1="${hTop}" x2="${colMid}.5" y2="${gR(hBot)}" stroke="${T.line}" stroke-width="1"/>`;
  }

  const blockH = S.fsEyebrow + 6 + S.fsTitle * 1.25 + (G.reduziert ? 0 : 6 + S.fsSub * 1.25);
  let ty = hTop + (headH - blockH) / 2;
  out += txt(S.padX, ty + S.fsEyebrow, (cfg.eyebrow || '').toUpperCase(),
             { mono: true, size: S.fsEyebrow, weight: 500, tracking: S.trackEyebrow, fill: T.accents.gruen });
  ty += S.fsEyebrow + 6;
  out += txt(S.padX, ty + S.fsTitle, cfg.titel || '', { size: S.fsTitle, weight: 700, tracking: -0.21 });
  if (!G.reduziert) {
    ty += S.fsTitle * 1.25 + 6;
    out += txt(S.padX, ty + S.fsSub, cfg.ort || '', { size: S.fsSub, fill: T.text.muted });
  }

  // Metadaten — Beschriftung grau, Wert schwarz, beides dieselbe Mono
  const meta = G.reduziert ? [] : Object.entries(cfg.meta || {});
  let my = hTop + (headH - (meta.length * S.metaRow - (S.metaRow - S.fsMeta))) / 2 + S.fsMeta;
  for (const [k, v] of meta) {
    out += txt(colMid + 20, my, k, { mono: true, size: S.fsMeta, weight: 500, fill: T.text.faint });
    out += txt(colMid + 20 + S.metaKeyW, my, v || '—', { mono: true, size: S.fsMeta, weight: 500 });
    my += S.metaRow;
  }

  // Wortmarke
  const logoH = S.logoW * (LKEBW_LOGO_H / LKEBW_LOGO_W);
  out += `<image href="${LKEBW_LOGO}" x="${gR(colLogo + (S.headLogoW - S.logoW) / 2)}"
            y="${gR(hTop + (headH - logoH) / 2)}" width="${S.logoW}" height="${gR(logoH)}"/>`;
  return out;
}

/** Rotierter Y-Titel + X-Titel unter der Diagrammfläche — für jede Sheet-Figur gleich. */
function ggAxisTitles(cfg, T, G) {
  const S = G.S;
  const ycx = S.padX + S.yTitleW / 2, ycy = G.plotY + G.plotH / 2;
  let out = ggTxt(T, S, ycx, ycy, cfg.achseY || '', { anchor: 'middle', size: S.fsAxisTitle, weight: 600,
             tracking: 0.46, fill: T.text.muted, transform: `rotate(-90 ${gR(ycx)} ${gR(ycy)})` });
  out += ggTxt(T, S, G.plotX + G.plotW / 2, G.xTitleY, cfg.achseX || '',
             { anchor: 'middle', size: S.fsAxisTitle, weight: 600, tracking: 0.46, fill: T.text.muted });
  return out;
}

/** Kennzahlenblock unterhalb der Diagrammfläche — für jede Sheet-Figur gleich. */
function ggSheetKpiFooter(cfg, T, G) {
  if (G.reduziert) return '';        // Version 2: die Werte stehen auf dem Kennzahlenblatt
  const S = G.S, W = G.W, kpiTop = G.kpiTop;
  const gruen = T.accents.gruenDunkel;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const mitte = W / 2;

  let out = `<line x1="${S.padX}" y1="${gR(kpiTop) + 0.5}" x2="${W - S.padX}" y2="${gR(kpiTop) + 0.5}" stroke="${T.line}" stroke-width="1"/>
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
  // Die rechte Spalte steht ohne Prozentspalte enger. Traegt eine ihrer Zeilen
  // doch einen Prozentwert, bekommt sie denselben Vorlauf wie die linke — sonst
  // laeuft der Wert in die Prozentangabe hinein.
  const rechtsPct = (cfg.kpiRechts || []).slice(0, 2).some(r => r.prozent) ? S.kpiPctW + 12 : 0;
  (cfg.kpiLinks  || []).slice(0, 2).forEach((r, i) => { out += zeile(r, S.padX, S.padX + S.kpiPctW + 12 + S.kpiWertW, S.padX + S.kpiPctW + 24 + S.kpiWertW, i); });
  (cfg.kpiRechts || []).slice(0, 2).forEach((r, i) => { out += zeile(r, mitte + 24, mitte + 24 + rechtsPct + S.kpiWertW2, mitte + 36 + rechtsPct + S.kpiWertW2, i); });
  return out;
}

/** Zahl und Einheit trennen ("2.341.289 kWh" → zwei Spalten). */
function ggSplitWert(wert) {
  const s = String(wert == null ? '' : wert).trim();
  const m = s.match(/^(.*\S)\s+(\S+)$/);
  // Nur ein Nachsatz ohne Ziffern ist eine Einheit — "2035" oder "wechselnd"
  // bleiben ungeteilt in der Wertspalte stehen.
  return m && !/\d/.test(m[2]) ? { zahl: m[1], einheit: m[2] } : { zahl: s, einheit: '' };
}

/** Kennzahlen eines Blatts in Lesereihenfolge: erst die linke, dann die rechte Spalte. */
function ggKpiZeilen(cfg) {
  return [...(cfg.kpiLinks || []).slice(0, 2), ...(cfg.kpiRechts || []).slice(0, 2)]
    .filter(r => r && r.wert != null && r.wert !== '');
}

/**
 * Kennzahlenblatt — Gegenstueck zum reduzierten Blatt (Version 2): unter der
 * Kurve steht dort nichts mehr, die Werte wandern hierher in eine eigene
 * Tabelle. Gespeist aus denselben kpiLinks/kpiRechts wie der Fussblock, damit
 * beide Versionen nie auseinanderlaufen.
 */
export function ggRenderKennzahlen(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel;
  const zeilen = ggKpiZeilen(cfg);
  const headH = S.headHSchmal;
  const tabTop = S.headBand + headH + S.tabTop;
  const height = tabTop + S.tabHeadH + Math.max(zeilen.length, 1) * S.tabRow + S.footSpace + 10;
  // Kopf wie beim reduzierten Blatt, nur mit eigenem Titel — dieselbe Funktion,
  // damit Eyebrow, Wortmarke und Balken auf beiden Blaettern gleich sitzen.
  const G = { S, W, headH, reduziert: true, height };
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.tabelleTitel || 'Kennzahlen' }, T, G);

  const x0 = S.padX, x1 = W - S.padX, P = S.tabPadX;
  // Spaltenkanten von rechts her: Anteil | Einheit | Wert (rechtsbuendig) | Kennzahl
  const einhX = x1 - S.tabPctW - S.tabEinheitW;

  // Kopfzeile der Tabelle
  out += `<rect x="${x0}" y="${gR(tabTop)}" width="${gR(x1 - x0)}" height="${S.tabHeadH}" fill="${T.tint}"/>`;
  const hy = tabTop + S.tabHeadH / 2 + S.fsTabHead * 0.36;
  const kopf = (x, s, anchor) => txt(x, hy, s.toUpperCase(), { mono: true, size: S.fsTabHead, weight: 600,
                 tracking: S.trackTabHead, fill: gruen, anchor });
  out += kopf(x0 + P, 'Kennzahl') + kopf(einhX - P, 'Wert', 'end')
       + kopf(einhX + P, 'Einheit') + kopf(x1 - P, 'Anteil', 'end');

  // Zeilen — eine je Kennzahl, hervorgehobene wie im Fussblock im Gruenton
  let y = tabTop + S.tabHeadH;
  if (!zeilen.length) {
    out += txt(x0 + P, y + S.tabRow / 2 + S.fsTab * 0.36, cfg.leer || 'Keine Kennzahlen vorhanden.',
               { size: S.fsTab, fill: T.text.faint });
    y += S.tabRow;
  }
  for (const r of zeilen) {
    if (r.highlight) out += `<rect x="${x0}" y="${gR(y)}" width="${gR(x1 - x0)}" height="${S.tabRow}" fill="${T.tint}"/>`;
    const ty = y + S.tabRow / 2 + S.fsTab * 0.36;
    const { zahl, einheit } = ggSplitWert(r.wert);
    out += txt(x0 + P, ty, r.label || '', { size: S.fsTab });
    out += txt(einhX - P, ty, zahl, { anchor: 'end', mono: true, size: S.fsTabWert,
               weight: r.highlight ? 600 : 500, fill: r.highlight ? gruen : T.text.strong });
    if (einheit) out += txt(einhX + P, ty, einheit, { mono: true, size: S.fsTab, weight: 500, fill: T.text.muted });
    if (r.prozent) out += txt(x1 - P, ty, r.prozent, { anchor: 'end', mono: true, size: S.fsTab, weight: 500, fill: T.text.faint });
    y += S.tabRow;
    out += `<line x1="${x0}" y1="${gR(y) + 0.5}" x2="${x1}" y2="${gR(y) + 0.5}" stroke="${T.line}" stroke-width="1"/>`;
  }

  // Rahmen: aussen duenn, unter der Kopfzeile kraeftig im Akzent
  const kopfLinie = gR(tabTop + S.tabHeadH) + 0.5;
  out += `<line x1="${x0}" y1="${kopfLinie}" x2="${x1}" y2="${kopfLinie}" stroke="${gruen}" stroke-width="1.5"/>`;
  out += `<rect x="${x0}.5" y="${gR(tabTop) + 0.5}" width="${gR(x1 - x0) - 1}" height="${gR(y - tabTop) - 1}"
            fill="none" stroke="${T.line}" stroke-width="1"/>`;
  return ggFinishSvg(out, W, height);
}

/**
 * Dieselbe Kennzahlentabelle als HTML-Markup mit Inline-Styles — nicht fuer
 * die Bildschirmvorschau gedacht, sondern als Kopiervorlage: Word erkennt
 * ein <table>-Element in der Zwischenablage und legt eine echte, editierbare
 * Tabelle an (Zellen, Spalten, selektierbarer Text), statt eines Bildes.
 */
export function ggKennzahlenHtmlTable(cfg, T = GG_THEME) {
  const zeilen = ggKpiZeilen(cfg);
  const gruen = T.accents.gruenDunkel;
  const border = `1px solid ${T.line}`;
  const td = (inhalt, o = {}) => `<td style="padding:7px 12px;border-bottom:${border};
      font-family:${o.mono ? T.fontMono : T.font};font-size:${o.size || 12.5}px;font-weight:${o.weight || 400};
      color:${o.color || T.text.strong};text-align:${o.align || 'left'};white-space:nowrap;
      ${o.bg ? `background:${o.bg};` : ''}">${gEsc(inhalt)}</td>`;
  const th = (s, align) => `<th style="padding:8px 12px;border-bottom:2px solid ${gruen};background:${T.tint};
      font-family:${T.fontMono};font-size:10.5px;font-weight:600;letter-spacing:.05em;color:${gruen};
      text-transform:uppercase;text-align:${align || 'left'};">${gEsc(s)}</th>`;

  const rows = zeilen.length ? zeilen.map(r => {
    const { zahl, einheit } = ggSplitWert(r.wert);
    const bg = r.highlight ? T.tint : undefined;
    return `<tr>${td(r.label || '', { bg })}`
      + td(zahl, { mono: true, align: 'right', weight: r.highlight ? 600 : 500, color: r.highlight ? gruen : T.text.strong, bg })
      + td(einheit, { mono: true, color: T.text.muted, bg })
      + td(r.prozent || '', { mono: true, align: 'right', color: T.text.faint, bg }) + `</tr>`;
  }).join('') : `<tr><td colspan="4" style="padding:10px 12px;font-family:${T.font};color:${T.text.faint};">
                   ${gEsc(cfg.leer || 'Keine Kennzahlen vorhanden.')}</td></tr>`;

  return `<table style="border-collapse:collapse;border:${border};min-width:420px;">
    <thead><tr>${th('Kennzahl')}${th('Wert', 'right')}${th('Einheit')}${th('Anteil', 'right')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Kennzahlen als Tab-getrennter Text — Fallback-Inhalt neben dem HTML in der Zwischenablage. */
function ggKennzahlenPlainText(cfg) {
  const zeilen = ggKpiZeilen(cfg);
  const zeile = r => {
    const { zahl, einheit } = ggSplitWert(r.wert);
    return [r.label || '', zahl, einheit, r.prozent || ''].join('\t');
  };
  return ['Kennzahl\tWert\tEinheit\tAnteil', ...zeilen.map(zeile)].join('\n');
}

/**
 * Kopiert die Kennzahlentabelle als echte Word-Tabelle in die Zwischenablage
 * (HTML- statt Bild-Payload) — Gegenstueck zu ggCopyForWord, das die
 * Abbildungen als PNG kopiert.
 */
export async function ggCopyTableForWord(cfg) {
  const tabelle = ggKennzahlenHtmlTable(cfg);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${tabelle}</body></html>`;
  const text = ggKennzahlenPlainText(cfg);
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return 'Zwischenablage';
    } catch (e) { void e; /* Fallback unten */ }
  }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  holder.innerHTML = tabelle;
  document.body.appendChild(holder);
  const rng = document.createRange(); rng.selectNodeContents(holder);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  const ok = document.execCommand('copy');
  sel.removeAllRanges(); holder.remove();
  if (!ok) throw new Error('Zwischenablage nicht verfügbar');
  return 'Zwischenablage (Fallback)';
}

function ggFinishSvg(out, W, height) {
  const svg = document.createElementNS(GG_NS, 'svg');
  svg.setAttribute('xmlns', GG_NS);
  svg.setAttribute('viewBox', `0 0 ${W} ${gR(height)}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', gR(height));
  svg.innerHTML = out;
  return svg;
}

export function ggRenderGanglinie(cfg, T = GG_THEME) {
  const G = ggSheetGeometry(T, cfg);
  const S = G.S, W = G.W, plotX = G.plotX, plotW = G.plotW, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = ggSheetHeader(cfg, T, G);

  // Mehrere Reihen (z.B. Tagesgang: Gesamt/Werktag/Wochenende) oder die
  // klassische Einzelreihe (Jahresganglinie/-dauerlinie) — gleiche Optik,
  // unterschiedliche Zeichenstrategie (siehe unten).
  const serien = cfg.serien && cfg.serien.length ? cfg.serien : (cfg.daten ? [{
    daten: cfg.daten, farbe: cfg.kurveFarbe || T.energy.strom, breite: 1, label: cfg.reihe || '',
  }] : []);
  const N = serien[0]?.daten?.length || 0;

  // Waagerechte Grenzlinien (Anschluss-/Einspeisezusage, Trafoleistung …)
  const grenzen = (cfg.grenzen || []).filter(g => g && g.wert > 0);

  let yMax = 1, yStep = 1;
  if (N) {
    let max = 0;
    for (const s of serien) for (let i = 0; i < N; i++) if (s.daten[i] > max) max = s.daten[i];
    // Eine Grenze oberhalb der Kurve muss sichtbar bleiben — sonst laege genau
    // die Aussage der Abbildung ("noch Reserve") ausserhalb des Bildes.
    for (const g of grenzen) if (g.wert > max) max = g.wert;
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
    const xTicks = cfg.xTicks || null;
    const xStep = xTicks ? null : ggNiceStep(N / 12);
    // Bei Reihen mit wenigen Stuetzstellen (Jahresachse) sitzt der letzte Punkt
    // auf dem rechten Rand — die Ticks muessen derselben Teilung folgen, sonst
    // steht die Jahreszahl neben ihrem Datenpunkt.
    const xAt = (cfg.xTickAufSerie && N > 1)
      ? (pos => plotX + (pos / (N - 1)) * plotW)
      : (pos => plotX + (pos / N) * plotW);

    // Gitter
    let gitter = '';
    for (let v = yStep; v < yMax; v += yStep) {
      const y = Math.round(yOf(v)) + 0.5;
      gitter += `M${gR(plotX)} ${y}H${gR(plotX + plotW)}`;
    }
    if (xTicks) {
      for (const t of xTicks) {
        const x = Math.round(xAt(t.pos)) + 0.5;
        gitter += `M${x} ${plotY}V${gR(plotB)}`;
      }
    } else {
      for (let k = xStep; k < N; k += xStep) {
        const x = Math.round(plotX + (k / N) * plotW) + 0.5;
        gitter += `M${x} ${plotY}V${gR(plotB)}`;
      }
    }
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;

    if (cfg.serien && cfg.serien.length) {
      // Wenige Stützstellen (Tagesprofil, 24–96 Werte): echter Polygonzug,
      // die Min/Max-Huellkurve unten wuerde bei so wenig Punkten je Pixelspalte
      // nur vereinzelte Punkte statt einer Linie zeichnen.
      for (const s of serien) {
        let d = '';
        for (let i = 0; i < N; i++) {
          const x = gR(plotX + (i / (N - 1)) * plotW), y = gR(yOf(s.daten[i]));
          d += (i === 0 ? `M${x} ${y}` : `L${x} ${y}`);
        }
        if (s.fill) {
          out += `<path d="${d} L${gR(plotX + plotW)} ${gR(plotB)} L${gR(plotX)} ${gR(plotB)} Z"
                    fill="${s.farbe}" fill-opacity="0.12" stroke="none"/>`;
        }
        out += `<path d="${d}" fill="none" stroke="${s.farbe}" stroke-width="${s.breite || 1.5}"
                  ${s.strich ? `stroke-dasharray="${s.strich}"` : ''} stroke-linejoin="round"/>`;
      }
    } else {
      // Ganglinie als Min/Max-Hüllkurve je Pixelspalte — 35.040 Werte lassen sich
      // nicht sinnvoll als Polygonzug zeichnen, die Spitzen gingen dabei verloren.
      // Aufeinanderfolgende Spalten werden verbunden (statt je eine isolierte
      // Vertikale zu ziehen) — sonst reisst die Linie bei ruhigen Reihen (z.B.
      // der sortierten Dauerlinie) in lauter Einzelpunkte auseinander.
      const daten = serien[0].daten;
      const spalten = Math.max(1, Math.floor(plotW));
      let kurve = '';
      for (let c = 0; c < spalten; c++) {
        const a = Math.floor((c / spalten) * N);
        const b = Math.max(a + 1, Math.floor(((c + 1) / spalten) * N));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < b && i < N; i++) { const v = daten[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (!isFinite(lo)) continue;
        const x = gR(plotX + c + 0.5), yTop = gR(yOf(hi)), yBot = gR(yOf(lo));
        kurve += kurve === '' ? `M${x} ${yTop}` : `L${x} ${yTop}`;
        if (yBot !== yTop) kurve += `L${x} ${yBot}`;
      }
      out += `<path d="${kurve}" fill="none" stroke="${serien[0].farbe}" stroke-width="1" stroke-linejoin="round"/>`;
    }

    // Grenzlinien — kraeftiger als das Gitter, damit sie im Druck als Aussage
    // und nicht als Hilfslinie gelesen werden.
    for (const g of grenzen) {
      const y = gR(yOf(g.wert));
      out += `<line x1="${gR(plotX)}" y1="${y}" x2="${gR(plotX + plotW)}" y2="${y}"
                stroke="${g.farbe || T.energy.waerme}" stroke-width="${g.breite || 2}"
                stroke-dasharray="${g.strich || '10 6'}"/>`;
    }

    // Senkrechte Marke: das Jahr, in dem eine Grenze erstmals ueberschritten wird
    if (cfg.marker && cfg.marker.pos != null) {
      const mx = gR(xAt(cfg.marker.pos));
      const mf = cfg.marker.farbe || T.energy.waerme;
      out += `<line x1="${mx}" y1="${plotY}" x2="${mx}" y2="${gR(plotB)}"
                stroke="${mf}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
      if (cfg.marker.label) {
        const mw = ggEstW(cfg.marker.label, S.fsLeg) + 16;
        // Am rechten Rand nach innen kippen, sonst laeuft die Fahne aus dem Blatt.
        const links = mx + mw > plotX + plotW - 4;
        const fx = links ? mx - mw : mx;
        // Unten statt oben: oben rechts sitzt die Legende, dort wuerde die Fahne
        // verdeckt. Am Fuss der Marke steht sie ausserdem neben ihrer Jahreszahl.
        const fy = plotB - 23;
        out += `<rect x="${gR(fx)}" y="${gR(fy)}" width="${gR(mw)}" height="19" fill="${mf}"/>`
             + txt(fx + mw / 2, fy + 13, cfg.marker.label,
                   { anchor: 'middle', size: S.fsLeg, weight: 700, fill: '#FFFFFF' });
      }
    }

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
    if (xTicks) {
      for (const t of xTicks) {
        out += txt(xAt(t.pos), G.xLabelY, t.label,
                   { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
      }
    } else {
      for (let k = 0; k < N; k += xStep) {
        out += txt(plotX + (k / N) * plotW, G.xLabelY, ggNum(k),
                   { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
      }
    }

    // Legende im Diagramm, oben rechts
    const eintraege = [
      ...serien.map(s => ({ farbe: s.farbe, breit: s.breite || 1.5, strich: s.strich || '', text: s.label || '' })),
      ...grenzen.map(g => ({ farbe: g.farbe || T.energy.waerme, breit: g.breite || 2,
                             strich: g.strich || '10 6', text: g.label || '' })),
      ...(cfg.grundlastKw > 0 ? [{ farbe: T.accents.gruen, breit: 3, strich: '6 4', text: cfg.grundlastLabel || '' }] : []),
    ].filter(e => e.text);
    if (eintraege.length) {
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
  }

  // Rahmen der Diagrammfläche, Grundlinie kräftiger
  out += `<rect x="${gR(plotX) + 0.5}" y="${plotY}.5" width="${gR(plotW) - 1}" height="${plotH - 1}"
            fill="none" stroke="${T.rule}" stroke-width="1"/>
          <line x1="${gR(plotX)}" y1="${gR(plotB) - 1}" x2="${gR(plotX + plotW)}" y2="${gR(plotB) - 1}"
            stroke="${T.text.strong}" stroke-width="2"/>`;

  out += ggAxisTitles(cfg, T, G);
  out += ggSheetKpiFooter(cfg, T, G);

  return ggFinishSvg(out, W, G.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3c) RENDERER — „Heatmap": Tag/Stunde-Raster im selben Blatt-Stil
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_HEAT_STOPS = [[0, [26, 35, 78]], [0.3, [0, 150, 136]], [0.6, [255, 235, 59]], [0.8, [255, 152, 0]], [1, [244, 67, 54]]];

function ggHeatColor(t) {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 0; i < GG_HEAT_STOPS.length - 1; i++) {
    const [t0, c0] = GG_HEAT_STOPS[i], [t1, c1] = GG_HEAT_STOPS[i + 1];
    if (v >= t0 && v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0] + f * (c1[0] - c0[0]))},${Math.round(c0[1] + f * (c1[1] - c0[1]))},${Math.round(c0[2] + f * (c1[2] - c0[2]))})`;
    }
  }
  return 'rgb(244,67,54)';
}

const GG_MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function ggRenderHeatmap(cfg, T = GG_THEME) {
  const G = ggSheetGeometry(T, cfg);
  const S = G.S, W = G.W, plotX = G.plotX, plotW = G.plotW, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = ggSheetHeader(cfg, T, G);
  out += `<rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;

  const grid = cfg.grid, jahr = cfg.jahr || new Date().getFullYear();
  if (!grid) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, cfg.leer || 'Keine Daten vorhanden',
               { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    const TAGE = 365, STUNDEN = 24, maxV = cfg.maxV || 1;
    const cellW = plotW / TAGE, cellH = plotH / STUNDEN;

    let zellen = '';
    for (let d = 0; d < TAGE; d++) {
      for (let h = 0; h < STUNDEN; h++) {
        const v = grid[d * STUNDEN + h];
        const x = plotX + d * cellW, y = plotY + h * cellH;
        zellen += `<rect x="${gR(x)}" y="${gR(y)}" width="${gR(cellW) + 0.5}" height="${gR(cellH) + 0.5}" fill="${ggHeatColor(maxV > 0 ? v / maxV : 0)}"/>`;
      }
    }
    out += zellen;

    // Y-Beschriftung: Stunden
    for (let h = 0; h <= 24; h += 6) {
      const y = plotY + (h / 24) * plotH;
      out += txt(plotX - 8, y + (h === 24 ? -2 : S.fsAxis * 0.36), h === 24 ? '24:00' : `${h}:00`,
                 { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }
    // X-Beschriftung: Monate, an ihrem Startzeitpunkt im Jahr positioniert
    const yearStart = +new Date(jahr, 0, 1);
    for (let m = 0; m < 12; m++) {
      const d0 = Math.floor((+new Date(jahr, m, 1) - yearStart) / 86400000);
      const dTage = new Date(jahr, m + 1, 0).getDate();
      out += txt(plotX + (d0 + dTage / 2) * cellW, G.xLabelY, GG_MONATE[m],
                 { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }

    // Farbskala oben rechts: Verlaufsbalken mit Min/Max
    const lw = 150, lh = 34, lx = plotX + plotW - 12 - lw, ly = plotY + 10;
    out += `<rect x="${gR(lx)}" y="${ly}" width="${gR(lw)}" height="${gR(lh)}" fill="${T.bg}" fill-opacity="0.92"
              stroke="${T.line}" stroke-width="1"/>`;
    out += txt(lx + lw / 2, ly + 13, cfg.legendeLabel || '', { anchor: 'middle', size: S.fsLeg - 1, fill: T.text.muted });
    const gradId = 'ggHeatGrad';
    out += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">`
         + GG_HEAT_STOPS.map(([t, c]) => `<stop offset="${t * 100}%" stop-color="rgb(${c[0]},${c[1]},${c[2]})"/>`).join('')
         + `</linearGradient></defs>`;
    const bx = lx + 10, bw = lw - 20, by = ly + 18, bh = 8;
    out += `<rect x="${gR(bx)}" y="${gR(by)}" width="${gR(bw)}" height="${bh}" fill="url(#${gradId})" stroke="${T.line}" stroke-width="1"/>`;
    out += txt(bx, by + bh + 10, '0', { size: S.fsLeg - 2, fill: T.text.faint });
    out += txt(bx + bw, by + bh + 10, ggNum(maxV) + ' kW', { anchor: 'end', size: S.fsLeg - 2, fill: T.text.faint });
  }

  out += `<rect x="${gR(plotX) + 0.5}" y="${plotY}.5" width="${gR(plotW) - 1}" height="${plotH - 1}"
            fill="none" stroke="${T.rule}" stroke-width="1"/>
          <line x1="${gR(plotX)}" y1="${gR(plotB) - 1}" x2="${gR(plotX + plotW)}" y2="${gR(plotB) - 1}"
            stroke="${T.text.strong}" stroke-width="2"/>`;

  out += ggAxisTitles(cfg, T, G);
  out += ggSheetKpiFooter(cfg, T, G);

  return ggFinishSvg(out, W, G.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3d) RENDERER — „Balken": gestapelte Saeulen je Kategorie, selber Blatt-Stil
 *
 * cfg.gruppen = [{ label, segmente: [{ label, farbe, werte: number[] }] }]
 * Je Kategorie (z. B. Monat) steht pro Gruppe eine gestapelte Saeule; mehrere
 * Gruppen werden nebeneinander gesetzt (Verbrauch neben Einspeisung).
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderBalken(cfg, T = GG_THEME) {
  const G = ggSheetGeometry(T, cfg);
  const S = G.S, W = G.W, plotX = G.plotX, plotW = G.plotW, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = ggSheetHeader(cfg, T, G);
  out += `<rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;

  const kat = cfg.kategorien || [];
  const gruppen = (cfg.gruppen || []).filter(g => g && g.segmente && g.segmente.length);
  const summeJe = g => kat.map((_, i) => g.segmente.reduce((a, seg) => a + (seg.werte?.[i] || 0), 0));
  const hatWerte = gruppen.some(g => summeJe(g).some(v => v > 0));

  if (!kat.length || !hatWerte) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, cfg.leer || 'Keine Daten vorhanden',
               { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    let max = 0;
    for (const g of gruppen) for (const v of summeJe(g)) if (v > max) max = v;
    const yStep = ggNiceStep(max / 8);
    const yMax  = Math.max(yStep, Math.ceil(max / yStep) * yStep);
    const yOf = v => plotB - (v / yMax) * plotH;

    // Gitter
    let gitter = '';
    for (let v = yStep; v < yMax; v += yStep) {
      const y = Math.round(yOf(v)) + 0.5;
      gitter += `M${gR(plotX)} ${y}H${gR(plotX + plotW)}`;
    }
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;

    // Saeulen: je Kategorie ein Fach, darin die Gruppen nebeneinander
    const fachW = plotW / kat.length;
    const innen = fachW * 0.76;                 // Rest bleibt Luft zwischen den Monaten
    const balkenW = innen / gruppen.length;
    for (let i = 0; i < kat.length; i++) {
      const fachX = plotX + i * fachW + (fachW - innen) / 2;
      gruppen.forEach((g, gi) => {
        let unten = plotB;
        for (const seg of g.segmente) {
          const v = seg.werte?.[i] || 0;
          if (!(v > 0)) continue;
          const h = (v / yMax) * plotH;
          // Unter ~0,4 px zeichnet Word nichts mehr — dann lieber weglassen als
          // eine Haarlinie, die im Ausdruck wie ein Artefakt aussieht.
          if (h < 0.4) { unten -= h; continue; }
          out += `<rect x="${gR(fachX + gi * balkenW)}" y="${gR(unten - h)}"
                    width="${gR(balkenW - 2)}" height="${gR(h)}" fill="${seg.farbe}"/>`;
          unten -= h;
        }
      });
      out += txt(plotX + i * fachW + fachW / 2, G.xLabelY, kat[i],
                 { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }

    // Y-Beschriftung
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      out += txt(plotX - 8, yOf(v) + S.fsAxis * 0.36, ggNum(v, yStep < 1 ? 1 : 0),
                 { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }

    // Legende oben rechts — Kaestchen statt Linien, passend zu Flaechen
    const eintraege = [];
    for (const g of gruppen) for (const seg of g.segmente) {
      if (seg.label) eintraege.push({ farbe: seg.farbe, text: seg.label });
    }
    if (eintraege.length) {
      const lw = 12 + 16 + 9 + Math.max(...eintraege.map(e => ggEstW(e.text, S.fsLeg))) + 14;
      const lh = 8 + eintraege.length * 18 + 2;
      const lx = plotX + plotW - 12 - lw, ly = plotY + 10;
      out += `<rect x="${gR(lx)}" y="${ly}" width="${gR(lw)}" height="${gR(lh)}" fill="${T.bg}" fill-opacity="0.92"
                stroke="${T.line}" stroke-width="1"/>`;
      eintraege.forEach((e, i) => {
        const ey = ly + 8 + i * 18;
        out += `<rect x="${gR(lx + 12)}" y="${gR(ey)}" width="12" height="11" fill="${e.farbe}"/>`
             + txt(lx + 37, ey + 9, e.text, { size: S.fsLeg });
      });
    }
  }

  out += `<rect x="${gR(plotX) + 0.5}" y="${plotY}.5" width="${gR(plotW) - 1}" height="${plotH - 1}"
            fill="none" stroke="${T.rule}" stroke-width="1"/>
          <line x1="${gR(plotX)}" y1="${gR(plotB) - 1}" x2="${gR(plotX + plotW)}" y2="${gR(plotB) - 1}"
            stroke="${T.text.strong}" stroke-width="2"/>`;

  out += ggAxisTitles(cfg, T, G);
  out += ggSheetKpiFooter(cfg, T, G);

  return ggFinishSvg(out, W, G.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3e) RENDERER — „Tabelle": mehrspaltige Datentabelle, selber Blatt-Stil
 *
 * Verallgemeinerung von ggRenderKennzahlen (dort fest auf Kennzahl/Wert/
 * Einheit/Anteil), fuer Vergleiche mit beliebig vielen Spalten und Zeilen
 * (z. B. die PV-Varianten nebeneinander).
 * cfg.spalten = [{ label, align?: 'left'|'right' (Default: erste Spalte
 *   links, Rest rechts), mono?: bool (Default: true außer 1. Spalte),
 *   weight?: number (Breitenanteil, Default 1) }]
 * cfg.zeilen  = [{ werte: string[] (parallel zu spalten), highlight?: bool,
 *   akzent?: farbe (schmaler Balken am Zeilenanfang, z. B. Variantenfarbe) }]
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderTabelle(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel;
  const spalten = cfg.spalten || [];
  const zeilen  = cfg.zeilen  || [];
  const headH = S.headHSchmal;
  const tabTop = S.headBand + headH + S.tabTop;
  const rowN  = Math.max(zeilen.length, 1);
  const fussH = cfg.fussnote ? 20 : 0;
  const height = tabTop + S.tabHeadH + rowN * S.tabRow + fussH + S.footSpace + 10;
  const G = { S, W, headH, reduziert: true, height };
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.tabelleTitel || cfg.titel }, T, G);

  const x0 = S.padX, x1 = W - S.padX, P = S.tabPadX, totalW = x1 - x0;
  const totalWeight = spalten.reduce((s, c) => s + (c.weight || 1), 0) || 1;
  let cx = x0;
  const cols = spalten.map((c, i) => {
    const w = totalW * (c.weight || 1) / totalWeight;
    const col = { ...c, x: cx, w, align: c.align || (i === 0 ? 'left' : 'right'), mono: c.mono !== false && i > 0 };
    cx += w;
    return col;
  });

  // Kopfzeile
  out += `<rect x="${x0}" y="${gR(tabTop)}" width="${gR(totalW)}" height="${S.tabHeadH}" fill="${T.tint}"/>`;
  const hy = tabTop + S.tabHeadH / 2 + S.fsTabHead * 0.36;
  cols.forEach(c => {
    const tx = c.align === 'right' ? c.x + c.w - P : c.x + P;
    out += txt(tx, hy, (c.label || '').toUpperCase(), { mono: true, size: S.fsTabHead, weight: 600,
               tracking: S.trackTabHead, fill: gruen, anchor: c.align === 'right' ? 'end' : 'start' });
  });

  // Zeilen — eine je Variante/Kandidat, hervorgehobene wie im Kennzahlenblock im Gruenton
  let y = tabTop + S.tabHeadH;
  if (!zeilen.length) {
    out += txt(x0 + P, y + S.tabRow / 2 + S.fsTab * 0.36, cfg.leer || 'Keine Daten vorhanden.',
               { size: S.fsTab, fill: T.text.faint });
    y += S.tabRow;
  }
  for (const r of zeilen) {
    if (r.highlight) out += `<rect x="${x0}" y="${gR(y)}" width="${gR(totalW)}" height="${S.tabRow}" fill="${T.tint}"/>`;
    if (r.akzent) out += `<rect x="${x0}" y="${gR(y)}" width="4" height="${S.tabRow}" fill="${r.akzent}"/>`;
    const ty = y + S.tabRow / 2 + S.fsTab * 0.36;
    cols.forEach((c, i) => {
      const val = r.werte?.[i];
      const s = (val == null || val === '') ? '—' : String(val);
      const tx = c.align === 'right' ? c.x + c.w - P : c.x + P + (r.akzent && i === 0 ? 8 : 0);
      out += txt(tx, ty, s, { mono: c.mono, size: i === 0 ? S.fsTab : S.fsTabWert,
                 weight: r.highlight && i > 0 ? 600 : 500, fill: r.highlight && i > 0 ? gruen : T.text.strong,
                 anchor: c.align === 'right' ? 'end' : 'start' });
    });
    y += S.tabRow;
    out += `<line x1="${x0}" y1="${gR(y) + 0.5}" x2="${x1}" y2="${gR(y) + 0.5}" stroke="${T.line}" stroke-width="1"/>`;
  }

  // Rahmen: aussen duenn, unter der Kopfzeile kraeftig im Akzent
  const kopfLinie = gR(tabTop + S.tabHeadH) + 0.5;
  out += `<line x1="${x0}" y1="${kopfLinie}" x2="${x1}" y2="${kopfLinie}" stroke="${gruen}" stroke-width="1.5"/>`;
  out += `<rect x="${x0}.5" y="${gR(tabTop) + 0.5}" width="${gR(totalW) - 1}" height="${gR(y - tabTop) - 1}"
            fill="none" stroke="${T.line}" stroke-width="1"/>`;

  if (cfg.fussnote) out += txt(x0, y + 15, cfg.fussnote, { size: S.fsTab - 2, fill: T.text.faint });

  return ggFinishSvg(out, W, height);
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

/** Liest den importierten Ist-Stromlastgang aus dem Projekt (Strom-Grundlagen). */
function ggStromDaten() {
  const viertel = window.elQuartierH15;
  const stunden = window.elQuartierH;
  const daten = viertel && viertel.length ? viertel : (stunden && stunden.length ? stunden : null);
  if (!daten) return null;
  const istViertel = daten === viertel;
  return { daten, istViertel, h: istViertel ? 0.25 : 1 };
}

/** Viertelstundenwerte auf Stundenmittel verdichten — für Tagesgang/Heatmap reicht das. */
function ggStundenReihe(daten, istViertel) {
  if (!istViertel) return daten;
  const n = Math.floor(daten.length / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (daten[4 * i] + daten[4 * i + 1] + daten[4 * i + 2] + daten[4 * i + 3]) / 4;
  return out;
}

/** Mittlerer Tagesverlauf (24 Stundenwerte) — gesamt, Werktag, Wochenende. */
function ggTagesgangStats(stundenReihe, startDate) {
  const sumAll = new Float64Array(24), nAll = new Int32Array(24);
  const sumWd = new Float64Array(24), nWd = new Int32Array(24);
  const sumWe = new Float64Array(24), nWe = new Int32Array(24);
  const startMs = startDate.getTime();
  for (let i = 0; i < stundenReihe.length; i++) {
    const ts = new Date(startMs + i * 3600000);
    const hr = ts.getHours(), v = stundenReihe[i];
    sumAll[hr] += v; nAll[hr]++;
    if (ts.getDay() === 0 || ts.getDay() === 6) { sumWe[hr] += v; nWe[hr]++; }
    else { sumWd[hr] += v; nWd[hr]++; }
  }
  const avg = (sum, n) => Array.from(sum).map((s, i) => n[i] ? s / n[i] : 0);
  return { avgAll: avg(sumAll, nAll), avgWd: avg(sumWd, nWd), avgWe: avg(sumWe, nWe) };
}

/** Tag/Stunde-Raster (365×24) aus der Stundenreihe für die Jahres-Heatmap. */
function ggHeatmapGrid(stundenReihe, startDate) {
  const startMs = startDate.getTime(), jahr = startDate.getFullYear();
  const yearStart = +new Date(jahr, 0, 1);
  const grid = new Float32Array(365 * 24), n = new Int16Array(365 * 24);
  for (let i = 0; i < stundenReihe.length; i++) {
    const ts = startMs + i * 3600000;
    const day = Math.floor((ts - yearStart) / 86400000);
    if (day < 0 || day >= 365) continue;
    const idx = day * 24 + new Date(ts).getHours();
    grid[idx] += stundenReihe[i]; n[idx]++;
  }
  for (let i = 0; i < grid.length; i++) if (n[i]) grid[i] /= n[i];
  return { grid, jahr };
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

/** Dateiname mit Projektname-Präfix (WE-Nummer_Kaserne), falls App-Kern verfügbar. */
function ggDateiname(basis, ext) {
  if (typeof window.projektExportFilename === 'function') return window.projektExportFilename(basis, ext);
  return `${basis}.${ext}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5) FIGUREN-REGISTRY — hier kommt jede neue Gutachten-Grafik dazu
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_FIGUREN = [
  {
    id: 'traeger-quellen',
    kapitel: '1.2 Liegenschaftsinformationen',
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
    kapitel: '3.1.5 Stromdaten',
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
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
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
    kapitel: '2.1 Ist-Zustand Wärme',
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
      ggMetaDefaults(cfg, 'pdBearbeiterWaerme');
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

  // ── Jahresdauerlinie Strom ──────────────────────────────────────────────
  {
    id: 'lastgang-strom-dauerlinie',
    autoSync: true,
    kapitel: '3.1.5 Stromdaten',
    titel: 'Jahresdauerlinie Strom',
    datei: 'jahresdauerlinie-strom',
    hinweis: 'Derselbe Stromlastgang wie die Jahresganglinie, absteigend nach Leistung sortiert — '
           + 'zeigt Benutzungsdauer und Ausnutzung der Anschlussleistung.',
    render: cfg => ggRenderGanglinie(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Jahresdauerlinie Strom',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: 'Stunden im Jahr, absteigend sortiert',
      reihe: 'Liegenschaftsstromverbrauch',
      grundlastLabel: 'Stromgrundlast Leistung',
      leer: 'Kein Stromlastgang importiert — unter Strom-Grundlagen eine Lastgangdatei laden.',
      daten: null, grundlastKw: 0, kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.kurveFarbe = GG_THEME.energy.strom;
      const info = ggStromDaten();
      if (!info) { cfg.daten = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Kein Stromlastgang importiert.'; }

      const { daten, istViertel, h } = info;
      const sortiert = Array.prototype.slice.call(daten).sort((a, b) => b - a);
      const k = ggLastgangKennzahlen(daten, h);
      cfg.daten = sortiert;
      cfg.achseX = istViertel ? '1/4 Stunden im Jahr, absteigend sortiert' : 'Stunden im Jahr, absteigend sortiert';
      cfg.grundlastKw = k.grundlastKw;
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
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

  // ── Tagesgang Strom ─────────────────────────────────────────────────────
  {
    id: 'lastgang-strom-tagesgang',
    autoSync: true,
    kapitel: '3.1.5 Stromdaten',
    titel: 'Tagesgang Strom',
    datei: 'tagesgang-strom',
    hinweis: 'Mittlerer Tagesverlauf aus dem Stromlastgang, getrennt nach Werktag und Wochenende '
           + '(stündliche Mittelwerte über das gesamte Jahr).',
    render: cfg => ggRenderGanglinie(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Tagesgang Strom',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: 'Uhrzeit',
      leer: 'Kein Stromlastgang importiert — unter Strom-Grundlagen eine Lastgangdatei laden.',
      serien: null, xTicks: null, grundlastKw: 0, grundlastLabel: '', kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      const info = ggStromDaten();
      if (!info) { cfg.serien = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Kein Stromlastgang importiert.'; }

      const { daten, istViertel, h } = info;
      const stundenReihe = ggStundenReihe(daten, istViertel);
      const start = window.elQuartierStartDate || new Date(new Date().getFullYear(), 0, 1);
      const { avgAll, avgWd, avgWe } = ggTagesgangStats(stundenReihe, start);
      cfg.serien = [
        { daten: avgWe, farbe: '#3F7FBF', breite: 1.5, strich: '5 4', label: 'Wochenende Ø' },
        { daten: avgWd, farbe: GG_THEME.accents.gruen, breite: 1.5, label: 'Werktag Ø' },
        { daten: avgAll, farbe: GG_THEME.accents.gruenDunkel, breite: 2, label: 'Gesamt Ø', fill: true },
      ];
      cfg.xTicks = [0, 6, 12, 18, 24].map(hr => ({ pos: hr, label: `${hr}h` }));

      const k = ggLastgangKennzahlen(daten, h);
      cfg.grundlastKw = k.grundlastKw;
      cfg.grundlastLabel = 'Stromgrundlast Leistung (Jahr)';
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      cfg.kpiLinks = [
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: 'Liegenschaftsbezug vom EVU' },
        { wert: ggNum(Math.max(...avgAll)) + ' kW', label: 'Mittlere Tagesspitze (Gesamt)' },
      ];
      cfg.kpiRechts = [
        { wert: ggNum(k.spitzeKw) + ' kW', label: 'Stromspitzenlast (Jahr)' },
        { wert: ggNum(k.grundlastKw) + ' kW', label: 'Stromgrundlast Leistung', highlight: true },
      ];
      return `✓ Tagesprofil aus ${ggNum(daten.length)} ${istViertel ? 'Viertelstunden' : 'Stunden'} berechnet.`;
    },
  },

  // ── Jahres-Heatmap Strom ────────────────────────────────────────────────
  {
    id: 'lastgang-strom-heatmap',
    autoSync: true,
    kapitel: '3.1.5 Stromdaten',
    titel: 'Jahres-Heatmap Strom',
    datei: 'jahres-heatmap-strom',
    hinweis: 'Stündliche Mittelwerte des Stromlastgangs als Tag/Stunde-Raster — zeigt saisonale und '
           + 'tageszeitliche Muster auf einen Blick.',
    render: cfg => ggRenderHeatmap(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Jahres-Heatmap Strom',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Stunde des Tages',
      achseX: 'Monat',
      legendeLabel: 'Leistung in kW',
      leer: 'Kein Stromlastgang importiert — unter Strom-Grundlagen eine Lastgangdatei laden.',
      grid: null, jahr: null, maxV: 0, kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      const info = ggStromDaten();
      if (!info) { cfg.grid = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Kein Stromlastgang importiert.'; }

      const { daten, istViertel, h } = info;
      const stundenReihe = ggStundenReihe(daten, istViertel);
      const start = window.elQuartierStartDate || new Date(new Date().getFullYear(), 0, 1);
      const { grid, jahr } = ggHeatmapGrid(stundenReihe, start);
      let max = 0;
      for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
      cfg.grid = grid; cfg.jahr = jahr; cfg.maxV = max;

      const k = ggLastgangKennzahlen(daten, h);
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      cfg.kpiLinks = [
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: 'Liegenschaftsbezug vom EVU' },
        { prozent: ggNum(k.arbeitKwh ? k.grundlastKwh / k.arbeitKwh * 100 : 0) + ' %',
          wert: ggNum(k.grundlastKwh) + ' kWh', label: 'Stromgrundlast Arbeit' },
      ];
      cfg.kpiRechts = [
        { wert: ggNum(k.spitzeKw) + ' kW', label: 'Stromspitzenlast' },
        { wert: ggNum(k.grundlastKw) + ' kW', label: 'Stromgrundlast Leistung', highlight: true },
      ];
      return `✓ Heatmap aus ${ggNum(daten.length)} ${istViertel ? 'Viertelstunden' : 'Stunden'} berechnet.`;
    },
  },

  // ── Monatsbilanz Strom ────────────────────────
  {
    id: 'monatsbilanz-strom',
    autoSync: true,
    kapitel: '3.1.5 Stromdaten',
    titel: 'Monatsbilanz Strom',
    datei: 'monatsbilanz-strom',
    hinweis: 'Netzbezug, Eigenverbrauch und Einspeisung je Monat. Sobald die Strom-/PV-Berechnung '
           + 'gelaufen ist, kommen alle drei Anteile aus deren Bilanz; sonst wird ersatzweise der '
           + 'reine Netzbezug aus dem importierten Lastgang gezeigt.',
    render: cfg => ggRenderBalken(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Monatsbilanz Strom',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Energie in MWh',
      achseX: 'Monat',
      leer: 'Keine Strommengen vorhanden — Lastgang importieren oder die Strom-Berechnung ausführen.',
      kategorien: GG_MONATE,
      gruppen: [], kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.kategorien = GG_MONATE;
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');

      const bil = window._stromMonatsBilanz;
      const summe = a => (a || []).reduce((x, y) => x + y, 0);
      let netz, eigen, einsp, quelle;

      if (bil && summe(bil.netzbezug) + summe(bil.eigenverbrauch) > 0) {
        netz  = bil.netzbezug;
        eigen = bil.eigenverbrauch;
        einsp = bil.einspeisung;
        quelle = 'der Strombilanz';
      } else {
        // Ersatzweg: nur der gemessene Bezug. Ohne gelaufene Strom-Berechnung
        // gibt es keine Aufteilung in Eigenverbrauch/Einspeisung — dann lieber
        // eine ehrliche Einzelreihe als eine geschaetzte Aufteilung.
        const info = ggStromDaten();
        if (!info) { cfg.gruppen = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Keine Strommengen vorhanden.'; }
        const reihe = ggStundenReihe(info.daten, info.istViertel);
        const startMs = (window.elQuartierStartDate || new Date(new Date().getFullYear(), 0, 1)).getTime();
        netz = new Array(12).fill(0);
        for (let i = 0; i < reihe.length; i++) netz[new Date(startMs + i * 3600000).getMonth()] += reihe[i] / 1000;
        eigen = new Array(12).fill(0);
        einsp = new Array(12).fill(0);
        quelle = 'dem importierten Lastgang (ohne PV-Aufteilung)';
      }

      const hatEigen = summe(eigen) > 0, hatEinsp = summe(einsp) > 0;
      cfg.gruppen = [
        { label: 'Verbrauch', segmente: [
          { label: 'Netzbezug', farbe: GG_THEME.energy.strom, werte: netz },
          ...(hatEigen ? [{ label: 'Eigenverbrauch', farbe: GG_THEME.accents.gruen, werte: eigen }] : []),
        ]},
        ...(hatEinsp ? [{ label: 'Einspeisung', segmente: [
          { label: 'Netzeinspeisung', farbe: GG_THEME.accents.gruenDunkel, werte: einsp },
        ]}] : []),
      ];

      const gesamt = summe(netz) + summe(eigen);
      const jeMonat = netz.map((v, i) => v + (eigen[i] || 0));
      const iMax = jeMonat.indexOf(Math.max(...jeMonat));
      cfg.kpiLinks = [
        { wert: ggNum(gesamt, 1) + ' MWh', label: 'Stromverbrauch gesamt' },
        { prozent: gesamt > 0 ? ggNum(summe(netz) / gesamt * 100) + ' %' : undefined,
          wert: ggNum(summe(netz), 1) + ' MWh', label: 'Netzbezug' },
      ];
      cfg.kpiRechts = [
        hatEigen
          ? { prozent: gesamt > 0 ? ggNum(summe(eigen) / gesamt * 100) + ' %' : undefined,
              wert: ggNum(summe(eigen), 1) + ' MWh', label: 'Eigenverbrauch' }
          : { wert: ggNum(jeMonat[iMax], 1) + ' MWh', label: 'Höchster Monat (' + GG_MONATE[iMax] + ')' },
        hatEinsp
          ? { wert: ggNum(summe(einsp), 1) + ' MWh', label: 'Netzeinspeisung', highlight: true }
          : { wert: GG_MONATE[iMax], label: 'Verbrauchsstärkster Monat', highlight: true },
      ];
      return `✓ Monatswerte aus ${quelle} übernommen.`;
    },
  },

  // ── Entwicklung der Anschlussleistung ───────────────
  {
    id: 'anschlussleistung-entwicklung',
    kapitel: '3.2.2 Liegenschaftsstromnetzanschluss',
    titel: 'Entwicklung der Anschlussleistung',
    datei: 'anschlussleistung-entwicklung',
    hinweis: 'Höchstlast am Liegenschaftsanschluss über den Planungshorizont, gegen Anschlusswert und '
           + 'Einspeisezusage. „Aus Projekt übernehmen“ startet dafür den Engpass-Sweep — das rechnet '
           + 'das Netz für jedes Stützjahr durch und dauert einen Moment.',
    render: cfg => ggRenderGanglinie(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Entwicklung der Anschlussleistung',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: 'Jahr',
      leer: 'Noch keine Netzberechnung — im Elektro-Tab den Engpass-Sweep starten.',
      serien: null, xTicks: null, xTickAufSerie: true, grenzen: [], marker: null,
      grundlastKw: 0, grundlastLabel: '', kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      cfg.xTickAufSerie = true;

      // Vorhandenen Sweep weiterverwenden, solange er die Leistungswerte kennt —
      // ein Lauf aus einer aelteren Sitzung hat sie noch nicht.
      let res = typeof window.engpassLetztesErgebnis === 'function' ? window.engpassLetztesErgebnis() : null;
      if (!res || !res.proJahr?.length || res.proJahr[0].bezugKw == null) {
        if (typeof window.engpassSweep !== 'function') { cfg.serien = null; return '⚠ Netzmodul nicht geladen.'; }
        res = window.engpassSweep();
      }
      if (!res || !res.proJahr?.length) {
        cfg.serien = null; cfg.grenzen = []; cfg.marker = null; cfg.kpiLinks = []; cfg.kpiRechts = [];
        return '⚠ Kein Stromnetz modelliert — im Elektro-Tab Trafos und Kabel anlegen.';
      }

      // Der Sweep rechnet nur Stützjahre. Dazwischen ändert sich am Netz nichts,
      // also wird der letzte Wert gehalten — so bleibt die Zeitachse maßstäblich,
      // statt ungleiche Abstände gleich breit zu zeichnen.
      const jahre = [];
      for (let j = res.von; j <= res.bis; j++) jahre.push(j);
      const bezug = [], rueck = [];
      let k = 0;
      for (const j of jahre) {
        while (k + 1 < res.proJahr.length && res.proJahr[k + 1].jahr <= j) k++;
        bezug.push(res.proJahr[k].bezugKw || 0);
        rueck.push(res.proJahr[k].rueckKw || 0);
      }

      const hatRueck = rueck.some(v => v > 0);
      cfg.serien = [
        ...(hatRueck ? [{ daten: rueck, farbe: GG_THEME.accents.gruen, breite: 1.8, label: 'Rückspeisung (Höchstwert)' }] : []),
        { daten: bezug, farbe: GG_THEME.energy.strom, breite: 2, label: 'Netzbezug (Höchstlast)' },
      ];
      cfg.xTicks = jahre
        .map((j, i) => ({ pos: i, label: String(j) }))
        .filter((t, i) => i === 0 || i === jahre.length - 1 || jahre[i] % 5 === 0);

      // Trafoleistung nur zeigen, wenn sie über den Horizont konstant bleibt —
      // eine waagerechte Linie wäre sonst schlicht falsch.
      const kvaGleich = res.proJahr.every(r => r.trafoKVA === res.proJahr[0].trafoKVA);
      const napBezug = Number.isFinite(window.elNapMaxBezugKw) ? window.elNapMaxBezugKw : null;
      const napEinsp = Number.isFinite(window.elNapMaxEinspKw) ? window.elNapMaxEinspKw : null;
      cfg.grenzen = [
        napBezug > 0 ? { wert: napBezug, label: 'Anschlussleistung (Bezug)', farbe: GG_THEME.energy.waerme } : null,
        (hatRueck && napEinsp > 0) ? { wert: napEinsp, label: 'Einspeisezusage', farbe: GG_THEME.energy.gas } : null,
        kvaGleich ? { wert: res.proJahr[0].trafoKVA * 0.9, label: 'Installierte Trafoleistung',
                      farbe: GG_THEME.text.muted, strich: '4 5', breite: 1.5 } : null,
      ].filter(Boolean);

      // Erste Grenzüberschreitung markieren
      let idx = -1, grund = '';
      for (let i = 0; i < jahre.length; i++) {
        if (napBezug > 0 && bezug[i] > napBezug) { idx = i; grund = 'Bezug'; break; }
        if (hatRueck && napEinsp > 0 && rueck[i] > napEinsp) { idx = i; grund = 'Einspeisung'; break; }
      }
      cfg.marker = idx >= 0 ? { pos: idx, label: `${jahre[idx]} · ${grund} über Grenzwert` } : null;

      const letzte = bezug[bezug.length - 1];
      const reserve = napBezug > 0 ? napBezug - letzte : null;
      cfg.kpiLinks = [
        { wert: ggNum(bezug[0]) + ' kW', label: `Höchstlast Bezug ${res.von}` },
        { prozent: napBezug > 0 ? ggNum(letzte / napBezug * 100) + ' %' : undefined,
          wert: ggNum(letzte) + ' kW', label: `Höchstlast Bezug ${res.bis}` },
      ];
      cfg.kpiRechts = [
        hatRueck
          ? { wert: ggNum(Math.max(...rueck)) + ' kW', label: 'Höchste Rückspeisung im Horizont' }
          : { wert: kvaGleich ? ggNum(res.proJahr[0].trafoKVA) + ' kVA' : 'wechselnd', label: 'Installierte Trafoleistung' },
        idx >= 0
          ? { wert: String(jahre[idx]), label: 'Grenzwert erstmals überschritten', highlight: true }
          : { wert: reserve != null ? ggNum(reserve) + ' kW' : '—', label: `Reserve ${res.bis}`, highlight: true },
      ];
      return `✓ ${jahre.length} Jahre aus ${res.proJahr.length} Stützjahren (${res.von}–${res.bis}) übernommen.`;
    },
  },

];

// ── PV-Analyse: Varianten, Energiebilanz, Wirtschaftlichkeit, Resilienz ───────
// Quelle: window._pvAnalyse.ergebnisse (gefüllt in src/09d-pv-analyse.js über
// „Varianten berechnen") bzw. window._pvResReco (Kapitel 🛡 Resilienz). Ohne
// gelaufene Berechnung liefert ausProjekt eine Hinweismeldung statt Zahlen.
// Als eigene Funktion statt direkt im Array-Literal: die Helfer/Konstanten
// darunter (GG_PV_KURZ etc.) sind sonst beim Auswerten von GG_FIGUREN noch
// nicht initialisiert (TDZ) — der Push erfolgt erst, nachdem alles definiert ist.

/** Kanonische Varianten (mit Lesehilfe-Info) aus der PV-Analyse, sonst leer. */
function ggPvKanon() {
  return (window._pvAnalyse?.ergebnisse || []).filter(v => v.info && v.info.frage);
}
/** Kurzform der Variantenlabel für Achsen/Kategorien (voller Name steht in Tabellen). */
const GG_PV_KURZ = { 'minimal': 'Minimal', 'ev-opt': 'EV-optimiert', 'wirt-opt': 'Wirt.-optimiert',
                      'autarkie': 'Autarkie', 'max-pv': 'Max. PV-Ausbau' };
const GG_RES_MODE_LBL = { 'gen': 'Nur Notstrom', 'bat-gen': 'Speicher + Notstrom',
                           'pv-bat-gen': 'PV + Speicher + Notstrom', 'pv-bat': 'Nur PV + Speicher' };
const GG_PVAH_MONAT_TAGE = [31,28,31,30,31,30,31,31,30,31,30,31];
const GG_PVAH_MONAT_NAMEN = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
/** Tag-im-Jahr (0-basiert, aus einem Stunden-Index) → "12. Jul" — dieselbe Logik wie
 * _pvahDayToDate in 09d-pv-analyse.js; hier dupliziert, damit dieses Modul frei von
 * App-Kern-Importen bleibt (siehe Kommentar am Dateianfang). */
function ggPvTagLabel(stundenIdx) {
  let m = 0, d = Math.max(0, Math.min(364, Math.floor(stundenIdx / 24)));
  while (m < 11 && d >= GG_PVAH_MONAT_TAGE[m]) { d -= GG_PVAH_MONAT_TAGE[m]; m++; }
  return `${d + 1}. ${GG_PVAH_MONAT_NAMEN[m]}, ${stundenIdx % 24}:00`;
}

function ggPvFiguren() {
  return [
    // ── Variantenvergleich ───────────────────────────────────────────────
    {
      id: 'pv-variantenvergleich',
      autoSync: true,
      kapitel: '3.2.5 PV-Anlage und Batteriespeicher',
      titel: 'PV-Varianten im Vergleich',
      datei: 'pv-variantenvergleich',
      hinweis: 'Die 5 kanonischen PV-Varianten aus der ☀ PV-Analyse nebeneinander — jede beantwortet '
             + 'genau eine Stakeholder-Frage (Minimal, Eigenverbrauch, Wirtschaftlichkeit, Autarkie, '
             + 'maximaler Ausbau). Grundlage: „Varianten berechnen" in der PV-Analyse.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'PV-Varianten im Vergleich',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        spalten: [
          { label: 'Variante', weight: 2.6 },
          { label: 'PV-Leistung', weight: 1.25 },
          { label: 'Batterie', weight: 1.15 },
          { label: 'Eigenverbrauch', weight: 1.3 },
          { label: 'Autarkie', weight: 1.1 },
          { label: 'Amortisation', weight: 1.25 },
        ],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const kanon = ggPvKanon();
        if (!kanon.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Noch keine PV-Varianten berechnet.'; }
        cfg.zeilen = kanon.map(v => ({
          werte: [v.label, ggNum(v.pvKwp) + ' kWp', v.batKwh > 0 ? ggNum(v.batKwh) + ' kWh' : '—',
                  ggNum(v.wirt.pvEigenQuote) + ' %', ggNum(v.wirt.autarkie) + ' %',
                  isFinite(v.wirt.amort) ? ggNum(v.wirt.amort, 1) + ' a' : '> 20 a'],
          highlight: v.id === 'wirt-opt', akzent: v.farbe,
        }));
        cfg.fussnote = 'Hervorgehoben: wirtschaftlich optimierte Variante (höchster Jahres-Netto-Überschuss, statische Amortisation).';
        return `✓ ${kanon.length} PV-Varianten aus der PV-Analyse übernommen.`;
      },
    },

    // ── Energiebilanz je Variante (B/D/P — Bedarf/Deckung/PV-Verbleib) ───
    {
      id: 'pv-energiebilanz',
      autoSync: true,
      kapitel: '3.2.5 PV-Anlage und Batteriespeicher',
      titel: 'Energiebilanz je PV-Variante',
      datei: 'pv-energiebilanz',
      hinweis: 'Drei Balken je Variante: Bedarf (gesamter Strombedarf), Deckung (Eigenverbrauch + '
             + 'Netzbezug, deckt den Bedarf) und PV-Verbleib (Einspeisung + Abregelung des '
             + 'PV-Überschusses). Entspricht der Energiebilanz-Abbildung der PV-Analyse.',
      render: cfg => ggRenderBalken(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Energiebilanz je PV-Variante', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Energie in MWh/a', achseX: 'Variante · B = Bedarf · D = Deckung · P = PV-Verbleib',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        kategorien: [], gruppen: [], kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');

        const kanon = ggPvKanon();
        if (!kanon.length) { cfg.kategorien = []; cfg.gruppen = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Noch keine PV-Varianten berechnet.'; }

        const rows = kanon.map(v => {
          const ev = v.sim.eigenMwh, nb = v.sim.netzbezugMwh, es = v.sim.einspeiseMwh, ct = v.sim.curtailMwh || 0;
          const wEv = Math.min(ev, v.sim.windEigenMwh || 0), wEs = Math.min(es, v.sim.windEinspMwh || 0);
          return { v, ev, nb, es, ct, wEv, wEs, bedarf: ev + nb };
        });
        const windAktiv = rows.some(r => r.wEv + r.wEs > 0.01);
        const kat = kanon.map(v => `${v.icon} ${GG_PV_KURZ[v.id] || v.label}`);

        cfg.kategorien = kat;
        cfg.gruppen = [
          { label: 'Bedarf', segmente: [
            { label: 'Bedarf gesamt', farbe: GG_THEME.text.muted, werte: rows.map(r => r.bedarf) },
          ]},
          { label: 'Deckung', segmente: [
            { label: 'Eigenverbrauch PV', farbe: GG_THEME.accents.gruen, werte: rows.map(r => r.ev - r.wEv) },
            ...(windAktiv ? [{ label: 'Eigenverbrauch Wind', farbe: '#4dd0e1', werte: rows.map(r => r.wEv) }] : []),
            { label: 'Netzbezug', farbe: GG_THEME.energy.strom, werte: rows.map(r => r.nb) },
          ]},
          { label: 'PV-Verbleib', segmente: [
            { label: 'Einspeisung PV', farbe: GG_THEME.accents.gruenDunkel, werte: rows.map(r => r.es - r.wEs) },
            ...(windAktiv ? [{ label: 'Einspeisung Wind', farbe: '#4dd0e1', werte: rows.map(r => r.wEs) }] : []),
            { label: 'Abregelung', farbe: GG_THEME.energy.gas, werte: rows.map(r => r.ct) },
          ]},
        ];
        const vEv = kanon.reduce((a, b) => b.wirt.pvEigenQuote > a.wirt.pvEigenQuote ? b : a);
        const vAut = kanon.reduce((a, b) => b.wirt.autarkie > a.wirt.autarkie ? b : a);
        cfg.kpiLinks = [
          { wert: ggNum(vEv.wirt.pvEigenQuote) + ' %', label: `Höchste Eigenverbrauchsquote (${vEv.label})` },
          { wert: ggNum(vAut.wirt.autarkie) + ' %', label: `Höchste Autarkie (${vAut.label})` },
        ];
        const vEinsp = kanon.reduce((a, b) => b.sim.einspeiseMwh > a.sim.einspeiseMwh ? b : a);
        const vErtrag = kanon.reduce((a, b) => b.ertragMwh > a.ertragMwh ? b : a);
        cfg.kpiRechts = [
          { wert: ggNum(vEinsp.sim.einspeiseMwh, 1) + ' MWh', label: `Höchste Netzeinspeisung (${vEinsp.label})` },
          { wert: ggNum(vErtrag.ertragMwh, 1) + ' MWh', label: `Größter PV-Jahresertrag (${vErtrag.label})`, highlight: true },
        ];
        return `✓ ${kanon.length} PV-Varianten aus der PV-Analyse übernommen.`;
      },
    },

    // ── Wirtschaftlichkeit je Variante ───────────────────────────────────
    {
      id: 'pv-wirtschaftlichkeit',
      autoSync: true,
      kapitel: '3.2.6 Wirtschaftlichkeit und Investitionskosten',
      titel: 'Wirtschaftlichkeit je PV-Variante',
      datei: 'pv-wirtschaftlichkeit',
      hinweis: 'Investition, jährlicher Netto-Überschuss und statische Amortisation je Variante — '
             + 'die für den Gutachten-Adressaten meist entscheidenden Kennzahlen.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Wirtschaftlichkeit je PV-Variante',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        spalten: [
          { label: 'Variante', weight: 2.4 },
          { label: 'Investition', weight: 1.4 },
          { label: 'Jahresüberschuss', weight: 1.6 },
          { label: 'Amortisation', weight: 1.3 },
        ],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const kanon = ggPvKanon();
        if (!kanon.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Noch keine PV-Varianten berechnet.'; }
        cfg.zeilen = kanon.map(v => {
          const ueberschuss = -v.wirt.nettoJk;
          return {
            werte: [v.label, ggNum(v.wirt.investGes) + ' €',
                    (ueberschuss >= 0 ? '+' : '−') + ggNum(Math.abs(ueberschuss)) + ' €/a',
                    isFinite(v.wirt.amort) ? ggNum(v.wirt.amort, 1) + ' a' : '> 20 a'],
            highlight: v.id === 'wirt-opt', akzent: v.farbe,
          };
        });
        cfg.fussnote = 'Investition inkl. Netzanschluss-Infrastruktur. Jahresüberschuss = Erlöse (Eigenverbrauchsersparnis '
                      + '+ Einspeisung) minus Jahreskosten (Kapitaldienst + Betrieb). Amortisation statisch (Investition / Erlöse).';
        return `✓ ${kanon.length} PV-Varianten aus der PV-Analyse übernommen.`;
      },
    },

    // ── Resilienz-Zusammenfassung ─────────────────────────────────────────
    {
      id: 'pv-resilienz',
      autoSync: true,
      kapitel: '5.2 Bewertung Resilienz',
      titel: 'Resilienz — Autarkie bei Netzausfall',
      datei: 'pv-resilienz-zusammenfassung',
      hinweis: 'Zusammenfassung der zuletzt im Kapitel 🛡 Resilienz betrachteten Inselbetrieb-Auslegung: '
             + 'wie lange trägt PV/Batterie/Notstrom einen Blackout zum ungünstigsten Zeitpunkt im Jahr. '
             + 'Erst im Kapitel 🛡 Resilienz öffnen/berechnen, dann hierher „Aus Projekt übernehmen".',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Resilienz — Autarkie bei Netzausfall',
        leer: 'Noch keine Resilienz-Berechnung — Kapitel 🛡 Resilienz öffnen (rechnet automatisch auf den PV-Varianten).',
        spalten: [{ label: 'Kennzahl', weight: 2.2 }, { label: 'Wert', weight: 1.4, mono: true }],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const r = window._pvResReco;
        if (!r) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Noch keine Resilienz-Berechnung vorhanden.'; }
        const fmtK = v => v >= 10000 ? `${ggNum(v / 1000)} k€` : `${ggNum(v)} €`;
        const zeile = (label, wert) => ({ werte: [label, wert] });
        cfg.zeilen = [
          zeile('Betriebsweise', GG_RES_MODE_LBL[r.mode] || r.mode),
          zeile('PV-Leistung / Batterie', `${ggNum(r.pvKwp)} kWp / ${r.batKwh > 0 ? ggNum(r.batKwh) + ' kWh' : '—'}`),
          zeile('Betrachtetes Ausfallfenster', `${r.durH} h`),
          { werte: ['Ausfall-Zeitpunkt', r.nHours ? ggPvTagLabel(r.isWorst ? r.worstStart : r.selStart) : '—'],
            highlight: r.isWorst },
          { werte: ['Überbrückung ohne Notstrom', r.bridgeH >= r.durH ? `> ${r.durH} h` : `${r.bridgeH} h`] },
          zeile('Empfohlene Notstromleistung', r.genKw > 0 ? `${Math.ceil(r.genKw)} kW` : 'keine nötig'),
          zeile('Kraftstoffbedarf im Ereignis', r.genKw > 0 ? `${r.kraftstoff}, ${ggNum(Math.ceil(r.liters))} l` : '–'),
          { werte: ['Versorgungslücke im Fenster', r.eUnmet > 0.5 ? `${ggNum(r.eUnmet / 1000, 2)} MWh` : 'keine'],
            highlight: r.eUnmet > 0.5 },
          zeile('Energiebedarf im Fenster', `${ggNum(r.eLoadMwh, 2)} MWh`),
          zeile('Resilienz-Investition (Aggregat + Tank)', r.genKw > 0 ? fmtK(r.capexCost) : '0 €'),
          zeile('Spritkosten je Ereignis', r.genKw > 0 ? fmtK(r.fuelCost) : '0 €'),
        ];
        cfg.fussnote = 'Inselbetrieb-Simulation zum ungünstigsten Zeitpunkt im Jahr: Batterie startet mit dem realen '
                      + 'Ladestand aus der Jahressimulation, das Notstromaggregat deckt die Restlast. Stand aus dem Kapitel 🛡 Resilienz.';
        return '✓ Resilienz-Kennzahlen aus dem Kapitel 🛡 Resilienz übernommen.';
      },
    },
  ];
}
GG_FIGUREN.push(...ggPvFiguren());

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

/** Bearbeiter/WE-Nr. aus den Projekt-Stammdaten vorbelegen, falls in der Grafik noch leer. */
function ggMetaDefaults(cfg, bearbeiterVar) {
  cfg.meta['Bearbeiter'] = cfg.meta['Bearbeiter'] || (window[bearbeiterVar] || '');
  cfg.meta['WE-Nr.'] = cfg.meta['WE-Nr.'] || (window.pdWeNummer || '');
}

const _gg = { figurId: GG_FIGUREN[0].id, scale: 3, svg: null, svgTabelle: null,
              layout: 'reduziert', ziel: 'figur' };

const ggFigur = () => GG_FIGUREN.find(f => f.id === _gg.figurId) || GG_FIGUREN[0];

/** Natürlicher Vergleich zweier Gliederungsnummern ("3.2" vor "3.10", "Sonstige" immer zuletzt). */
function ggKapitelCmp(a, b) {
  if (a === b) return 0;
  if (a === 'Sonstige') return 1;
  if (b === 'Sonstige') return -1;
  const pa = (a.match(/^\d+(\.\d+)*/) || [''])[0].split('.').map(Number);
  const pb = (b.match(/^\d+(\.\d+)*/) || [''])[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** GG_FIGUREN nach Gutachten-Kapitel (cfg.kapitel) gruppiert, in Gliederungsreihenfolge. */
function ggFigurenNachKapitel() {
  const gruppen = [];
  for (const f of GG_FIGUREN) {
    const kap = f.kapitel || 'Sonstige';
    let g = gruppen.find(g => g.kapitel === kap);
    if (!g) { g = { kapitel: kap, figuren: [] }; gruppen.push(g); }
    g.figuren.push(f);
  }
  gruppen.sort((a, b) => ggKapitelCmp(a.kapitel, b.kapitel));
  return gruppen;
}

/** Blatt-Figuren (Ganglinien, Heatmap, …) tragen eine Kopfzeile mit Metadaten. */
const ggIstBlatt = figur => !!figur.config.meta;
/** In Version 2 steht neben der Abbildung ein zweites Blatt mit den Kennzahlen. */
const ggZeigtTabelle = figur => ggIstBlatt(figur) && _gg.layout === 'reduziert';
/** Was Kopieren/PNG/SVG gerade betrifft — Abbildung oder Kennzahlenblatt. */
const ggAktivesSvg = () => (_gg.ziel === 'tabelle' && _gg.svgTabelle) ? _gg.svgTabelle : _gg.svg;
const ggAktiveDatei = () => ggFigur().datei + (_gg.ziel === 'tabelle' && _gg.svgTabelle ? '-kennzahlen' : '');

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
  // Die Blattversion gilt fuer alle Blatt-Figuren gemeinsam; die Status-Matrix
  // kennt kein Layout und bleibt unberuehrt.
  if (ggIstBlatt(figur)) figur.config.layout = _gg.layout;
  if (!ggZeigtTabelle(figur)) _gg.ziel = 'figur';

  // ── Sidebar: Figurenliste, nach Gutachten-Kapitel gruppiert ──
  const side = document.getElementById('gg-sidebar');
  if (side) {
    const btnHtml = f => {
      const aktiv = f.id === _gg.figurId;
      return `<button data-click="ggSelectFigur('${f.id}')" style="display:block;width:100%;text-align:left;margin-bottom:4px;padding:7px 9px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:11px;line-height:1.35;
        border:1px solid ${aktiv ? 'rgba(38,166,154,.5)' : 'rgba(255,255,255,.08)'};
        background:${aktiv ? 'rgba(38,166,154,.14)' : 'rgba(255,255,255,.03)'};
        color:${aktiv ? '#26a69a' : 'var(--muted)'};">${gEsc(f.titel)}</button>`;
    };
    side.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Abbildungen · nach Gutachten-Kapitel</div>`
      + ggFigurenNachKapitel().map((g, gi) => `
        <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#26a69a;opacity:.8;margin:${gi ? 14 : 0}px 0 5px;">${gEsc(g.kapitel)}</div>`
        + g.figuren.map(btnHtml).join('')).join('')
      + `<div style="margin-top:12px;font-size:10px;color:var(--muted);line-height:1.5;">${gEsc(figur.hinweis || '')}</div>`;
  }

  // ── Export-Leiste ──
  const bar = document.getElementById('gg-bar');
  if (bar) {
    const btn = (label, click, primary) => `<button data-click="${click}" style="font-family:inherit;font-size:11px;padding:6px 12px;border-radius:5px;cursor:pointer;
      border:1px solid ${primary ? 'rgba(38,166,154,.6)' : 'rgba(255,255,255,.12)'};
      background:${primary ? 'rgba(38,166,154,.18)' : 'rgba(255,255,255,.04)'};
      color:${primary ? '#26a69a' : 'var(--muted)'};">${label}</button>`;
    const sel = (click, optionen, wert) => `<select data-change="${click}" style="font-family:inherit;font-size:11px;padding:5px 6px;border-radius:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);">
           ${optionen.map(([v, l]) => `<option value="${v}"${String(wert) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}
         </select>`;
    const zielTabelle = ggZielIstTabelle();
    bar.innerHTML = btn(zielTabelle ? '⊞ Als Tabelle kopieren' : '⧉ Für Word kopieren', 'ggCopy()', true)
      + btn('⤓ PNG', 'ggSavePng()') + btn('⤓ SVG', 'ggSaveSvg()')
      + sel('ggSetScale(this.value)', [[2, '2× · ~300 dpi'], [3, '3× · ~450 dpi'], [4, '4× · ~600 dpi']], _gg.scale)
      + (ggIstBlatt(figur)
          ? sel('ggSetLayout(this.value)', [['voll', 'Blatt: vollständig'],
                                            ['reduziert', 'Blatt: reduziert + Kennzahlentabelle']], _gg.layout)
          : '')
      + (ggZeigtTabelle(figur)
          ? sel('ggSetZiel(this.value)', [['figur', 'Export: Abbildung'], ['tabelle', 'Export: Kennzahlen']], _gg.ziel)
          : '')
      + `<span style="margin-left:auto;font-size:10px;color:var(--muted);">${zielTabelle
          ? '„Als Tabelle kopieren" + Strg+V ergibt eine echte, editierbare Word-Tabelle — PNG/SVG legen die Tabelle stattdessen als Bild ab.'
          : 'In Word mit Strg+V einfügen — SVG bleibt Vektor über Einfügen › Bilder.'}</span>`;
  }

  // ── Figur zeichnen ──
  const paper = document.getElementById('gg-paper');
  if (paper) {
    _gg.svg = figur.render(figur.config);
    _gg.svgTabelle = ggZeigtTabelle(figur) ? ggRenderKennzahlen(figur.config) : null;
    const blatt = (svg, name, aktiv) => {
      svg.style.width = '100%';
      svg.style.maxWidth = GG_THEME.width + 'px';   // nie groesser als 1:1
      svg.style.height = 'auto';
      svg.style.display = 'block';
      // Ohne zweites Blatt gibt es nichts zu unterscheiden — dann bleibt die
      // Vorschau so schlicht wie bisher.
      if (!_gg.svgTabelle) { paper.appendChild(svg); return; }
      const box = document.createElement('div');
      box.style.cssText = `border:2px solid ${aktiv ? '#26a69a' : 'transparent'};padding:4px;margin-bottom:10px;`;
      const cap = document.createElement('div');
      cap.style.cssText = 'font-size:10px;color:#5A5F5A;margin:0 0 4px 2px;';
      cap.textContent = aktiv ? `${name} · wird exportiert` : name;
      box.append(cap, svg);
      paper.appendChild(box);
    };
    paper.replaceChildren();
    blatt(_gg.svg, 'Abbildung', _gg.ziel === 'figur');
    if (_gg.svgTabelle) blatt(_gg.svgTabelle, 'Kennzahlen (eigene Abbildung)', _gg.ziel === 'tabelle');
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
      // Version 2 zeigt Liegenschaft und Metadaten nicht — die Felder dafuer
      // stehen zu lassen waere eine Eingabe ohne Wirkung.
      const reduziert = _gg.layout === 'reduziert';
      html += `<div style="display:flex;flex-wrap:wrap;gap:8px 12px;">`
        + feld('Kopfzeile', figur.config.eyebrow, "ggSetKopf('eyebrow',this.value)")
        + feld('Titel', figur.config.titel, "ggSetKopf('titel',this.value)")
        + (reduziert
            ? feld('Titel Kennzahlenblatt', figur.config.tabelleTitel || 'Kennzahlen', "ggSetKopf('tabelleTitel',this.value)")
            : feld('Liegenschaft', figur.config.ort, "ggSetKopf('ort',this.value)")
              + Object.keys(figur.config.meta).map(k =>
                  feld(k, figur.config.meta[k], `ggSetMeta('${k}',this.value)`)).join(''))
        + `</div>`;
      if (reduziert) {
        html += `<div style="margin-top:6px;font-size:10px;color:var(--muted);">Reduziertes Blatt: Datum, Bearbeiter, WE-Nr. und Liegenschaft entfallen; die Kennzahlen stehen auf dem zweiten Blatt.</div>`;
      }
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

/** Blattversion: 'voll' (mit Kopfdaten und Kennzahlenblock) oder 'reduziert'. */
export function ggSetLayout(v) {
  _gg.layout = v === 'reduziert' ? 'reduziert' : 'voll';
  if (_gg.layout === 'voll') _gg.ziel = 'figur';
  ggRenderPanel();
}

/** Exportziel in Version 2: die Abbildung oder das Kennzahlenblatt. */
export function ggSetZiel(v) {
  _gg.ziel = v === 'tabelle' ? 'tabelle' : 'figur';
  ggRenderPanel();
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

/** Aktuelles Kopierziel ist das Kennzahlenblatt — dann als echte Tabelle statt als Bild. */
const ggZielIstTabelle = () => _gg.ziel === 'tabelle' && ggZeigtTabelle(ggFigur());

export async function ggCopy() {
  if (ggZielIstTabelle()) {
    ggSay('Wird vorbereitet …');
    try {
      const wohin = await ggCopyTableForWord(ggFigur().config);
      ggSay(`✓ Tabelle in die ${wohin} kopiert — in Word mit Strg+V einfügen (editierbare Tabelle).`);
    } catch (e) { ggSay('⚠ ' + e.message, true); }
    return;
  }
  const svg = ggAktivesSvg();
  if (!svg) return;
  ggSay('Wird gerendert …');
  try {
    const wohin = await ggCopyForWord(svg, _gg.scale);
    ggSay(`✓ In die ${wohin} kopiert — jetzt in Word mit Strg+V einfügen.`);
  } catch (e) { ggSay('⚠ ' + e.message, true); }
}

export async function ggSavePng() {
  const svg = ggAktivesSvg();
  if (!svg) return;
  try {
    ggDownload(await ggSvgToPngBlob(svg, _gg.scale), ggDateiname(ggAktiveDatei(), 'png'));
    ggSay('✓ PNG gespeichert.');
  } catch (e) { ggSay('⚠ ' + e.message, true); }
}

export function ggSaveSvg() {
  const svg = ggAktivesSvg();
  if (!svg) return;
  ggDownload(new Blob([ggSvgSource(svg)], { type: 'image/svg+xml' }), ggDateiname(ggAktiveDatei(), 'svg'));
  ggSay('✓ SVG gespeichert — in Word über Einfügen › Bilder einbetten (bleibt Vektor).');
}
