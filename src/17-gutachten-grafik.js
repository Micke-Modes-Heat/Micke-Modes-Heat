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
import { naKvaText } from './lib/netzanschluss.js';
import { BP_STUFEN, bpStufen, bpLadeLeistung, bpJahresreihe } from './lib/bedarfsprognose.js';
import { sdJahresuebersicht, sdJahresauswertung, sdTrend, sdZeitraumText, sdDauerlinie } from './lib/stromdaten.js';
import { ENGPASS_GRENZEN, ENGPASS_VORLAUF_J, engpassVersorgung } from './lib/engpass-core.js';
import { EK_GRUPPEN, EK_ARTEN, EK_VORGABEN, ekNormKennwerte, ekAuswertung } from './lib/elektro-kosten.js';

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
 * und Metadatenspalte) — das Blatt endet unter dem Achsentitel.
 *
 * Kopfdaten (cfg.layout) und Kennzahlenblock (cfg.kennzahlen) stehen unabhängig
 * voneinander: der Block erscheint nur im vollständigen Kopf und nur, wenn
 * cfg.kennzahlen nicht ausdrücklich auf false steht — so ergeben sich alle vier
 * Kombinationen (reduziert/voll × ohne/mit Kennzahlen).
 */
function ggSheetGeometry(T, cfg = {}) {
  const S = T.sheet, W = T.width;
  const reduziert = cfg.layout === 'reduziert';
  const kennzahlenInline = !reduziert && cfg.kennzahlen !== false;
  const headH = reduziert ? S.headHSchmal : S.headH;
  const plotX = S.padX + S.yTitleW + S.yLabelW;
  const plotW = W - S.padX - plotX;
  const plotY = S.headBand + headH + S.plotTop;
  const plotH = S.plotH;
  const plotB = plotY + plotH;
  const xLabelY = plotB + S.xLabelDy;
  const xTitleY = plotB + S.xTitleDy;
  const kpiTop  = plotB + S.kpiTopDy;
  const height  = kennzahlenInline ? kpiTop + S.kpiPad + 2 * S.kpiRow + S.kpiPad + S.footSpace
                                    : xTitleY + S.footSpace + 10;
  return { S, W, headH, reduziert, kennzahlenInline, plotX, plotW, plotY, plotH, plotB, xLabelY, xTitleY, kpiTop, height };
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
  if (!G.kennzahlenInline) return '';   // ohne Kennzahlen bzw. Version 2: die Werte stehen auf dem Kennzahlenblatt
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
  const td = (inhalt, o = {}) => ggHtmlZelle(T, inhalt, o);
  const th = (s, align) => ggHtmlKopf(T, s, align);

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

/* ── Word-Kopiervorlage: Zellen-Markup, von beiden Tabellenexporten genutzt ── */
function ggHtmlZelle(T, inhalt, o = {}) {
  return `<td style="padding:7px 12px;border-bottom:1px solid ${T.line};
      font-family:${o.mono ? T.fontMono : T.font};font-size:${o.size || 12.5}px;font-weight:${o.weight || 400};
      color:${o.color || T.text.strong};text-align:${o.align || 'left'};white-space:nowrap;
      ${o.bg ? `background:${o.bg};` : ''}">${gEsc(inhalt)}</td>`;
}

function ggHtmlKopf(T, s, align) {
  const gruen = T.accents.gruenDunkel;
  return `<th style="padding:8px 12px;border-bottom:2px solid ${gruen};background:${T.tint};
      font-family:${T.fontMono};font-size:10.5px;font-weight:600;letter-spacing:.05em;color:${gruen};
      text-transform:uppercase;text-align:${align || 'left'};">${gEsc(s)}</th>`;
}

// ── Word-Kopiervorlage für spalten/zeilen-Tabellen: klassische Berichtstabelle
// (weißer Kopf, fett, mittig; einheitlich hellblau unterlegter Rumpf; durch-
// gehendes Gitternetz) statt des LKEBw-Blattstils — Vorbild ist die Tabelle,
// wie sie schon im bisherigen Word-Gutachten stand (Tabelle 11 „Übersicht
// Trafostationen"). Bewusst eigene Zellen-Helfer statt ggHtmlZelle/ggHtmlKopf:
// die Kennzahlentabelle (ggKennzahlenHtmlTable) bleibt im Blatt-Grünton, weil
// sie neben der Grafik auf demselben Kennzahlenblatt sitzt.
const GG_WORD = { border: '#000000', bandBg: '#DCE6F1', highlightBg: '#BDD7EE', font: 'Calibri, Arial, sans-serif' };

function ggWordKopf(s) {
  return `<th style="padding:6px 10px;border:1px solid ${GG_WORD.border};background:#FFFFFF;
      font-family:${GG_WORD.font};font-size:11px;font-weight:700;color:#000000;text-align:center;">${gEsc(s)}</th>`;
}

function ggWordZelle(inhalt, o = {}) {
  return `<td style="padding:5px 10px;border:1px solid ${GG_WORD.border};background:${o.bg || GG_WORD.bandBg};
      ${o.akzent ? `border-left:4px solid ${o.akzent};` : ''}
      font-family:${GG_WORD.font};font-size:10.5px;font-weight:${o.bold ? 700 : 400};
      color:#000000;text-align:center;">${gEsc(inhalt)}</td>`;
}

/**
 * Beliebige Tabellenfigur (spalten/zeilen wie in ggRenderTabelle) als HTML —
 * dasselbe Kopierziel wie ggKennzahlenHtmlTable, nur ohne das feste
 * Kennzahl/Wert/Einheit/Anteil-Schema. Damit landet jede Tabellen-Abbildung
 * als echte, editierbare Word-Tabelle in der Zwischenablage statt als Bild.
 */
export function ggTabelleHtmlTable(cfg) {
  const cols = cfg.spalten || [];
  const zeilen = cfg.zeilen || [];
  const spann = Math.max(cols.length, 1);
  const kopf = cols.map(c => ggWordKopf(c.label || '')).join('');

  const rows = zeilen.length ? zeilen.map(r => '<tr>' + cols.map((c, i) => {
    const val = r.werte?.[i];
    const s = (val == null || val === '') ? '—' : String(val);
    return ggWordZelle(s, {
      bg: r.highlight ? GG_WORD.highlightBg : undefined,
      bold: !!r.highlight,
      akzent: i === 0 ? r.akzent : undefined,
    });
  }).join('') + '</tr>').join('')
    : `<tr><td colspan="${spann}" style="padding:10px 12px;border:1px solid ${GG_WORD.border};font-family:${GG_WORD.font};text-align:center;">
         ${gEsc(cfg.leer || 'Keine Daten vorhanden.')}</td></tr>`;

  const fuss = cfg.fussnote
    ? `<tr><td colspan="${spann}" style="padding:6px 10px;border:1px solid ${GG_WORD.border};background:#FFFFFF;
         font-family:${GG_WORD.font};font-size:9.5px;font-style:italic;color:#000000;text-align:left;">
         ${gEsc(cfg.fussnote)}</td></tr>`
    : '';

  return `<table style="border-collapse:collapse;border:1px solid ${GG_WORD.border};min-width:420px;">
    <thead><tr>${kopf}</tr></thead>
    <tbody>${rows}${fuss}</tbody>
  </table>`;
}

/** Dieselbe Tabelle als Tab-getrennter Text — Fallback-Inhalt neben dem HTML. */
function ggTabellePlainText(cfg) {
  const cols = cfg.spalten || [];
  const wert = (r, i) => {
    const v = r.werte?.[i];
    return (v == null || v === '') ? '' : String(v);
  };
  return [cols.map(c => c.label || '').join('\t'),
          ...(cfg.zeilen || []).map(r => cols.map((c, i) => wert(r, i)).join('\t'))].join('\n');
}

/**
 * Kopiert die Tabelle der aktuellen Figur als echte Word-Tabelle in die
 * Zwischenablage — das Kennzahlenblatt oder eine spalten/zeilen-Tabelle
 * (HTML- statt Bild-Payload) — Gegenstueck zu ggCopyForWord, das die
 * Abbildungen als PNG kopiert. Ohne Bildunterschrift oder Nummer.
 */
export async function ggCopyTableForWord(cfg) {
  const spaltig = Array.isArray(cfg.spalten);
  const tabelle = spaltig ? ggTabelleHtmlTable(cfg) : ggKennzahlenHtmlTable(cfg);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${tabelle}</body></html>`;
  const text = spaltig ? ggTabellePlainText(cfg) : ggKennzahlenPlainText(cfg);
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return 'Zwischenablage';
    } catch (e) { void e; /* Fallback unten */ }
  }
  return ggHtmlZwischenablageFallback(tabelle);
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
    out += txt(bx + bw, by + bh + 10, ggNum(maxV) + ' ' + (cfg.einheit || 'kW'),
               { anchor: 'end', size: S.fsLeg - 2, fill: T.text.faint });
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
    // Mit Punktreihe bleiben die Säulen in den unteren 58 %, darüber stehen Punkte und Werte
    const punkte = cfg.punkte && Array.isArray(cfg.punkte.werte) && cfg.punkte.werte.some(v => v > 0) ? cfg.punkte : null;
    let max = 0;
    for (const g of gruppen) for (const v of summeJe(g)) if (v > max) max = v;
    if (punkte) max /= 0.58;
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

    // Summe über jeder Säule — nur bei wenigen Säulen lesbar
    if (cfg.summenLabel && kat.length * gruppen.length <= 12) {
      for (let i = 0; i < kat.length; i++) {
        const fachX = plotX + i * fachW + (fachW - innen) / 2;
        gruppen.forEach((g, gi) => {
          const s = summeJe(g)[i];
          if (!(s > 0)) return;
          out += txt(fachX + gi * balkenW + (balkenW - 2) / 2, yOf(s) - 7, ggNum(s, cfg.summenDez || 0) + (cfg.summenEinheit || ''),
                     { anchor: 'middle', mono: true, size: S.fsAxis, weight: 600, fill: T.text.strong });
        });
      }
    }

    // Punktreihe auf eigener Skala (z. B. Spitzenlast in kW zur Jahresarbeit in MWh). Rechts neben der
    // Diagrammfläche ist kein Platz für eine zweite Achse — jeder Punkt trägt deshalb seinen Wert.
    if (punkte) {
      const pMax = Math.max(...punkte.werte.filter(v => v > 0));
      const bandTop = plotY + 58, bandH = plotH * 0.2;
      const farbe = punkte.farbe || T.text.strong;
      const pos = [];
      for (let i = 0; i < kat.length; i++) {
        const v = punkte.werte[i];
        if (v > 0) pos.push({ x: plotX + i * fachW + fachW / 2, y: bandTop + (1 - v / pMax) * bandH, v });
      }
      if (pos.length > 1) {
        out += `<path d="${pos.map((p, i) => `${i ? 'L' : 'M'}${gR(p.x)} ${gR(p.y)}`).join('')}" fill="none"
                  stroke="${farbe}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      }
      for (const p of pos) {
        out += `<circle cx="${gR(p.x)}" cy="${gR(p.y)}" r="5" fill="${T.bg}" stroke="${farbe}" stroke-width="2.5"/>`
             + txt(p.x, p.y - 11, ggNum(p.v, punkte.dez || 0) + (punkte.einheit ? ' ' + punkte.einheit : ''),
                   { anchor: 'middle', mono: true, size: S.fsAxis, weight: 600, fill: farbe });
      }
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
    if (punkte) {
      // Waagerecht oben links: oben rechts läge die Legende auf dem Punkt der letzten Kategorie
      if (punkte.label) eintraege.push({ farbe: punkte.farbe || T.text.strong, text: punkte.label, punkt: true });
      let lx = plotX + 12;
      const ly = plotY + 10;
      for (const e of eintraege) {
        out += e.punkt
          ? `<circle cx="${gR(lx + 6)}" cy="${gR(ly + 5.5)}" r="4.5" fill="${T.bg}" stroke="${e.farbe}" stroke-width="2"/>`
          : `<rect x="${gR(lx)}" y="${gR(ly)}" width="12" height="11" fill="${e.farbe}"/>`;
        out += txt(lx + 19, ly + 9, e.text, { size: S.fsLeg });
        lx += 19 + ggEstW(e.text, S.fsLeg) + 24;
      }
    } else if (eintraege.length) {
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
/**
 * Ausrichtung und Schriftart je Spalte: die erste Spalte ist die Beschriftung
 * (links, Fließtext), alle weiteren tragen Werte (rechts, monospace). Beides
 * laesst sich je Spalte ueberschreiben — der Word-Export nutzt dieselbe Regel.
 */
function ggSpaltenDefaults(c, i) {
  return { align: c.align || (i === 0 ? 'left' : 'right'), mono: c.mono !== false && i > 0 };
}

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
    const col = { ...c, x: cx, w, ...ggSpaltenDefaults(c, i) };
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

/* ══════════════════════════════════════════════════════════════════════════
 * 3c) RENDERER — „Gutachtentext": Standardtext mit Platzhaltern, die aus dem
 * Projekt vorbelegt oder von Hand ergänzt werden. Anders als die Abbildungen
 * oben ist das Ergebnis kein SVG, sondern ein HTML-Textblock — reicht aber
 * denselben Vertrag ({render(cfg) -> Node} mit .style/.querySelectorAll), also
 * braucht ggRenderPanel dafür keine Sonderbehandlung beim Zeichnen selbst,
 * nur bei der Export-/Optionenleiste (siehe figur.istText weiter unten).
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_TEXT_STIL_AUSGEFUELLT = 'background:#eaf6ea;border-bottom:1.5px solid #3F9C3F;padding:0 2px;border-radius:2px;';
const GG_TEXT_STIL_OFFEN = 'background:#fff3cd;border-bottom:1.5px solid #e0a126;padding:0 2px;border-radius:2px;color:#7a5b00;';

/** Ein Platzhalter im Fließtext — ausgefüllt grün, offen gelb mit Feldname in Klammern. */
function ggTextFeld(wert, feldname) {
  const gefuellt = !!String(wert ?? '').trim();
  const inhalt = gefuellt ? String(wert).trim() : `[${feldname}]`;
  // data-gg-feld: der Gutachten-Editor zählt darüber die offenen Platzhalter je Kapitel
  return `<span data-gg-feld="${gefuellt ? 'gefuellt' : 'offen'}" style="${gefuellt ? GG_TEXT_STIL_AUSGEFUELLT : GG_TEXT_STIL_OFFEN}">${gEsc(inhalt)}</span>`;
}

/** Kapitel 3.1.1 Liegenschaftsstromnetzanschluss (Ist-Zustand) — Textbaustein aus den Netzanschluss-Stammdaten. */
function ggRenderNetzanschlussText(cfg, T = GG_THEME) {
  void cfg;
  const einspeisungen = window.naEinspeisungen?.length ? window.naEinspeisungen : [{ station: '', kabeltyp: '' }];
  const einspeiseSatz = einspeisungen.map((e, i) => {
    const zaehler = einspeisungen.length > 1 ? ` ${i + 1}` : '';
    const teil = `${ggTextFeld(e.station, `Station${zaehler}`)} mit einem Kabel des Typs ${ggTextFeld(e.kabeltyp, `Kabeltyp${zaehler}`)}`;
    return i === 0 ? `über die Station ${teil}` : `sowie zusätzlich über die Station ${teil}`;
  }).join(' ');

  return ggTextBlatt([
    `Die elektrische Energieversorgung der Liegenschaft erfolgt aus dem Netz der `
      + `${ggTextFeld(window.naNetzbetreiberName, 'Name Netzbetreiber')}, `
      + `${ggTextFeld(window.naNetzbetreiberAdresse, 'Adresse Netzbetreiber')}.`,
    `Die Versorgung erfolgt auf der Spannungsebene ${ggTextFeld(window.naSpannungsebene, 'Spannungsebene Netzanschluss')} `
      + `${einspeiseSatz}.`,
    `Der Übergabepunkt befindet sich im Gebäude ${ggTextFeld(window.naUebergabepunkt, 'Bezeichnung/Lage Übergabepunkt')}.`,
    `Gemäß dem vorliegenden Netzanschlussvertrag beträgt die vereinbarte Anschlussleistung an diesem Übergabepunkt `
      + `${ggTextFeld(naKvaText(window.elNapMaxBezugKw), 'Vereinbarte max. Scheinleistung')} kVA.`,
    `Die Messung erfolgt als ${ggTextFeld(window.naMessverfahren, 'Messverfahren')}.`,
    `Der Netzbetreiber erteilt grundsätzlich keine Auskunft über die physikalisch maximal mögliche Anschlussleistung `
      + `der Liegenschaft. Eine Bewertung der verfügbaren Netzkapazitäten erfolgt ausschließlich auf Basis eines `
      + `konkreten Netzanschlussantrags. Hierzu ist das vom Netzbetreiber bereitgestellte Antragsformular zur Anmeldung `
      + `des Netzanschlusses (z. B. „Formular E1 – Anmeldung zum Netzanschluss Strom“) mit Angabe der zukünftig `
      + `benötigten Anschlussleistung einzureichen. Erst im Anschluss prüft der Netzbetreiber die technische `
      + `Verfügbarkeit, den erforderlichen Netzausbaubedarf sowie die zeitlichen und wirtschaftlichen Rahmenbedingungen.`,
  ], T);
}

/** Kapitel 3.4.1 Netzanschluss und internes Stromnetz (Variantenbildung) — Empfehlung zum Netzanschlussantrag. */
function ggRenderNetzanschlussEmpfehlungText(cfg, T = GG_THEME) {
  void cfg;
  return ggTextBlatt([
    `Vor dem Hintergrund der erwarteten Laststeigerungen durch Elektromobilität, Wärmepumpen und den Ausbau `
      + `erneuerbarer Erzeugungsanlagen wird empfohlen, den Netzanschlussantrag frühzeitig und auf Basis einer `
      + `realistischen Leistungsannahme einschließlich angemessener Reserve zu stellen, um Planungssicherheit für `
      + `nachgelagerte Maßnahmen zu schaffen.`,
  ], T);
}

/** Kapitel 3.1.2 Stromnetz intern (MS/NS), Ist-Zustand — Einleitung vor der Tabelle „Übersicht Trafostationen". */
function ggRenderTrafostationenText(cfg, T = GG_THEME) {
  void cfg;
  const name = document.querySelector('.header-projekt-name')?.textContent?.trim() || '';
  return ggTextBlatt([
    `Die Tabelle Übersicht der Trafostationen zeigt eine Übersicht aller Trafostationen der Liegenschaft `
      + `${ggTextFeld(name, 'Name Liegenschaft')}. Im weiteren Verlauf werden die im Zuge einer Begehung besichtigten `
      + `Trafostationen näher betrachtet um eventuelle Bedarfe und Empfehlungen zur Anpassung oder Erneuerung von `
      + `Trafo-Stationen ableiten zu können.`,
  ], T);
}

/** Textbaustein-Blatt: Absätze (HTML mit ggTextFeld-Platzhaltern) im Stil der Gutachten-Grafiken. */
function ggTextBlatt(absaetze, T = GG_THEME) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div style="background:${T.bg};max-width:${T.width}px;padding:26px 30px;box-sizing:border-box;
      font-family:${T.font};font-size:13px;line-height:1.65;color:${T.text.strong};border:1px solid ${T.line};">
    ${absaetze.map(a => `<p style="margin:0 0 12px;">${a}</p>`).join('')}
  </div>`;
  return wrap.firstElementChild;
}

/** „Für Word kopieren" bei Textbausteinen — Gegenstueck zu ggCopyForWord/ggCopyTableForWord, nur mit Fließtext statt Bild/Tabelle. */
export async function ggCopyTextForWord(figur) {
  const el = figur.render(figur.config);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${el.outerHTML}</body></html>`;
  const text = el.textContent.trim();
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
  holder.appendChild(el);
  document.body.appendChild(holder);
  const rng = document.createRange(); rng.selectNodeContents(holder);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  const ok = document.execCommand('copy');
  sel.removeAllRanges(); holder.remove();
  if (!ok) throw new Error('Zwischenablage nicht verfügbar');
  return 'Zwischenablage (Fallback)';
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

/** Kennzahl-Beschriftung des Ist-Lastgangs: mit BHKW im Referenzjahr ist es der Verbrauch, nicht nur der Bezug. */
function ggStromBezugLabel() {
  return typeof window.sgMjReferenzHatBhkw === 'function' && window.sgMjReferenzHatBhkw()
    ? 'Stromverbrauch (Bezug + BHKW)' : 'Liegenschaftsbezug vom EVU';
}

/* ── Kapitel 3.2 Stromverbrauchsdaten: Messjahre aus ⚡ Strom-Grundlagen (23-messjahre-panel.js) ──
 * Alle Werte beziehen sich auf Bezug + BHKW je Messjahr (lib/stromdaten.js). Die Einzeljahr-Figuren
 * (Ganglinie, Dauerlinie, Tagesgang, Heatmap, Monatsbilanz) zeigen weiter nur das Referenzjahr. */

/** Messjahre samt Jahresübersicht; ohne Panel leer. */
function ggMessjahre() {
  const d = typeof window.sgMjDaten === 'function' ? window.sgMjDaten() : null;
  return d ? { d, zeilen: sdJahresuebersicht(d) } : { d: null, zeilen: [] };
}

/** Farben der Jahresreihen: jüngstes Jahr im vollen Strom-Blau, ältere heller. */
const GG_MJ_FARBEN = ['#0000FF', '#4A6FD8', '#8EA8E8', '#B9C8F0', '#5A5F5A', '#8A8F8A'];

const ggHoechsteSpitze = zeilen => zeilen.reduce((a, z) => (z.spitzeKw > a.spitzeKw ? z : a), zeilen[0]);

/** Kapitel 3.2 — Datengrundlage, Verbrauchstrend, Spitzen- und Grundlast, Referenzjahr. */
function ggRenderStromdatenText(cfg, T = GG_THEME) {
  void cfg;
  const { zeilen } = ggMessjahre();
  if (!zeilen.length) {
    return ggTextBlatt([
      'Für die Liegenschaft liegen keine Lastgangdaten des Strombezugs vor. Die Auswertung des Stromverbrauchs stützt sich '
        + `daher auf ${ggTextFeld('', 'Datengrundlage, z. B. Jahresverbräuche laut Stromrechnungen')}.`,
      'Ohne Lastgangdaten lässt sich die Spitzenlast nicht belastbar ermitteln. Für die weitere Planung wird empfohlen, '
        + 'beim Netzbetreiber die Lastgänge der letzten drei Jahre anzufordern.',
    ], T);
  }

  const eins = zeilen.length === 1;
  const zeitraum = sdZeitraumText(zeilen.map(z => z.jahr));
  const mitBhkw = zeilen.some(z => z.bhkwKwh != null);
  const nb = String(window.naNetzbetreiberName || '').trim();
  const mwh = kwh => ggNum(kwh / 1000);
  const jahreText = jahre => `${jahre.length === 1 ? 'das Jahr' : 'die Jahre'} ${sdZeitraumText(jahre)}`;
  const absaetze = [];

  absaetze.push(`Mit den ${nb ? `vom Netzbetreiber ${gEsc(nb)} ` : ''}zur Verfügung gestellten Strombezugsdaten`
    + `${mitBhkw ? ' und BHKW-Erzeugungsdaten' : ''} `
    + `${eins ? `wurde ein Jahreslastgang für das Jahr ${zeitraum}` : `wurden Jahreslastgänge der Jahre ${zeitraum}`} `
    + `erzeugt (siehe ${ggTextFeld('', 'Anlage, z. B. Anlage I ff.')}).`);

  let p = `Die Auswertung der Strombezugsdaten ${eins ? `für das Jahr ${zeitraum}` : `für den Zeitraum ${zeitraum}`} zeigt die folgende Tabelle.`;
  const tr = sdTrend(zeilen);
  if (tr?.art === 'bestaendig') {
    p += ` Über den Beobachtungszeitraum ist ein beständiger Verbrauch erkennbar; der jährliche Stromverbrauch liegt zwischen `
      + `${mwh(tr.minKwh)} und ${mwh(tr.maxKwh)} MWh.`;
  } else if (tr) {
    const steigt = tr.art === 'steigend';
    p += ` Über den Beobachtungszeitraum ist ein ${steigt ? 'steigender' : 'rückläufiger'} Verbrauchstrend erkennbar: Der jährliche `
      + `Stromverbrauch ${steigt ? 'stieg' : 'sank'} von ${mwh(tr.von.gesamtKwh)} MWh im Jahr ${tr.von.jahr} auf `
      + `${mwh(tr.bis.gesamtKwh)} MWh im Jahr ${tr.bis.jahr} (${steigt ? '+' : '−'}${ggNum(Math.abs(tr.prozent))} %).`;
  }
  if (mitBhkw) {
    p += ' In den Darstellungen wird die vom Netzbetreiber bereitgestellte elektrische Energie zuzüglich der vom BHKW erzeugten '
      + 'Energie dargestellt.';
    const ohne = zeilen.filter(z => z.bhkwKwh == null).map(z => z.jahr);
    if (ohne.length) p += ` Für ${jahreText(ohne)} liegen keine BHKW-Daten vor; dort ist nur der Netzbezug enthalten.`;
  }
  if (!eins) p += ' Die anschließenden Abbildungen zeigen Jahresverbrauch und Spitzenlast sowie die Jahresdauerlinien im Vergleich.';
  absaetze.push(p);

  const max = ggHoechsteSpitze(zeilen);
  const glMin = ggNum(Math.min(...zeilen.map(z => z.grundlastKw))), glMax = ggNum(Math.max(...zeilen.map(z => z.grundlastKw)));
  p = `Die Spitzenlastabnahme wurde auf Grundlage der vorliegenden Daten mit maximal ${ggNum(max.spitzeKw)} kW`
    + `${eins ? '' : ` im Jahr ${max.jahr}`} ermittelt.`;
  if (mitBhkw) {
    p += ' Berücksichtigt wurden hierfür einerseits die Bezugsdaten vom Netzbetreiber und andererseits die vom BHKW '
      + 'bereitgestellte elektrische Leistung.';
  }
  p += glMin === glMax ? ` Die Grundlast liegt bei ${glMin} kW.` : ` Die Grundlast liegt zwischen ${glMin} und ${glMax} kW.`;
  const stunden = zeilen.filter(z => !z.istViertel).map(z => z.jahr);
  if (stunden.length) {
    // Stundenbasis auch dann, wenn nur der BHKW-Lastgang stündlich vorliegt (Summe wird auf Stunden gemittelt)
    p += ` ${stunden.length === zeilen.length ? 'Die Auswertung erfolgt' : `Für ${jahreText(stunden)} erfolgt die Auswertung`} nur auf `
      + 'Stundenbasis; kurzzeitige Lastspitzen sind darin geglättet, die Spitzenlast fällt dadurch tendenziell niedriger aus.';
  }
  absaetze.push(p);

  const ref = zeilen.find(z => z.referenz);
  absaetze.push(ref
    ? `Für die Bedarfsprognose (Kapitel 3.3) wird das Jahr ${ref.jahr} mit einer Spitzenlast von ${ggNum(ref.spitzeKw)} kW als `
      + 'Referenzjahr zugrunde gelegt'
      + (eins ? '.' : ref === max ? ', da in diesem Jahr die höchste Spitzenlast auftrat.'
        : `, da ${ggTextFeld('', 'Begründung, z. B. jüngstes vollständiges Betriebsjahr')}.`)
    : `Für die Bedarfsprognose (Kapitel 3.3) wird das Jahr ${ggTextFeld('', 'Referenzjahr')} als Referenzjahr zugrunde gelegt.`);

  absaetze.push('Damit bildet die Auswertung eine wesentliche Grundlage für die dimensionierungssichere Planung der zukünftigen '
    + 'elektrischen Versorgung, insbesondere im Hinblick auf die Integration neuer Verbraucher (z. B. Wärmepumpen, '
    + 'Ladeinfrastruktur oder zusätzliche Gebäude).');
  return ggTextBlatt(absaetze, T);
}

/** Einzelansicht des Textbausteins 3.2: welche Messjahre vorliegen und welches Referenz ist. */
function ggStromdatenStandHtml() {
  const { zeilen } = ggMessjahre();
  const zeile = (label, wert) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;font-size:11px;line-height:1.6;">
      <span style="color:var(--muted);">${gEsc(label)}</span><span>${wert}</span></div>`;
  let html = zeilen.length
    ? zeilen.map(z => zeile(`Messjahr ${z.jahr}${z.referenz ? ' · Referenz' : ''}`,
        `${ggNum(z.gesamtKwh / 1000)} MWh · max ${ggNum(z.spitzeKw)} kW · ${z.istViertel ? '15-min' : 'stündlich'}`
        + (z.bhkwKwh != null ? ' · mit BHKW' : ''))).join('')
    : '<div style="font-size:11px;color:#e0a126;">Keine Messjahre — der Text meldet „keine Lastgangdaten“.</div>';
  if (zeilen.length && !zeilen.some(z => z.referenz)) {
    html += '<div style="font-size:10px;color:#e0a126;margin-top:6px;">⚠ Kein Referenzjahr gewählt — der Satz zur Bedarfsprognose bleibt Platzhalter.</div>';
  }
  return html
    + `<button data-click="sgMjOeffnen()" style="margin-top:10px;font-size:11px;padding:5px 10px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,213,79,.45);background:rgba(255,213,79,.08);color:#ffd54f;">⚡ Messjahre in Strom-Grundlagen bearbeiten</button>`
    + '<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Zahlen wie Tabelle und Abbildungen dieses Kapitels. '
    + 'Gelbe Platzhalter (Anlagennummer der Lastgänge, Begründung des Referenzjahrs) erfasst das Tool nicht — in Word ergänzen.</div>';
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

/**
 * @param {{transparent?:boolean}} [opts] — `transparent: true` laesst den weissen Grund weg
 *   (fuer Wasserzeichen/Hintergrundbilder, die in Word HINTER den Text gelegt werden).
 */
export function ggSvgToPngBlob(svg, scale, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    const url = URL.createObjectURL(new Blob([ggSvgSource(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
      const ctx = cv.getContext('2d');
      if (!opts.transparent) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('PNG konnte nicht erzeugt werden')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG konnte nicht gerastert werden')); };
    img.src = url;
  });
}

function ggBlobZuDataUrl(blob) {
  return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
}

/** HTML-Ausschnitt per Markieren + execCommand('copy') in die Zwischenablage — Fallback, wenn die Clipboard-API fehlt. */
function ggHtmlZwischenablageFallback(html) {
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const rng = document.createRange(); rng.selectNodeContents(holder);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  const ok = document.execCommand('copy');
  sel.removeAllRanges(); holder.remove();
  if (!ok) throw new Error('Zwischenablage nicht verfügbar');
  return 'Zwischenablage (Fallback)';
}

/**
 * @param {{transparent?:boolean}} [opts] — `transparent: true` lässt den weißen Grund weg
 *   (Wasserzeichen). Kopiert nur das Bild, ohne Bildunterschrift oder Nummer — die kollidiert
 *   sonst mit der Beschriftung/Nummerierung des Zieldokuments (s. gutCopyTeil in 21).
 */
export async function ggCopyForWord(svg, scale, opts = {}) {
  const blob = await ggSvgToPngBlob(svg, scale, opts);
  // Weg 1: Clipboard-API (Chrome, Edge)
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      return 'Zwischenablage';
    } catch (e) { void e; /* Fallback unten */ }
  }
  // Weg 2: HTML-Ausschnitt mit eingebettetem Bild — Word nimmt das als Bild an
  return ggHtmlZwischenablageFallback(`<img src="${await ggBlobZuDataUrl(blob)}">`);
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
    kapitel: '2.3 Analyse möglicher Energiequellen und Technologien',   // wie „Abbildung 6" der Word-Vorlage
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
    kapitel: '3.2 Stromverbrauchsdaten',
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
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: ggStromBezugLabel() },
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
    kapitel: '3.2 Stromverbrauchsdaten',
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
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: ggStromBezugLabel() },
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
    kapitel: '3.2 Stromverbrauchsdaten',
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
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: ggStromBezugLabel() },
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
    kapitel: '3.2 Stromverbrauchsdaten',
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
        { wert: ggNum(k.arbeitKwh) + ' kWh', label: ggStromBezugLabel() },
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
    kapitel: '3.2 Stromverbrauchsdaten',
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

  // ── Gutachtentext: Stromverbrauchsdaten (Messjahre) ─────────────────────
  {
    id: 'stromdaten-text',
    istText: true,
    stromdatenText: true,
    reihe: 5,
    kapitel: '3.2 Stromverbrauchsdaten',
    titel: 'Gutachtentext: Stromverbrauchsdaten',
    datei: 'stromdaten-text',
    hinweis: 'Standardtext zur Auswertung der Messjahre unter ⚡ Strom-Grundlagen › Messjahre: Datengrundlage, '
           + 'Verbrauchstrend, Spitzen- und Grundlast, BHKW-Anteil und Referenzjahr der Bedarfsprognose.',
    render: cfg => ggRenderStromdatenText(cfg),
    config: {},
  },

  // ── Auswertung der Strombezugsdaten je Messjahr ─────────────────────────
  {
    id: 'stromdaten-jahre',
    autoSync: true,
    reihe: 10,
    kapitel: '3.2 Stromverbrauchsdaten',
    titel: 'Auswertung der Strombezugsdaten',
    datei: 'stromdaten-jahre',
    hinweis: 'Je Messjahr: Bezug vom Netzbetreiber, BHKW-Erzeugung, Gesamtverbrauch, Spitzen- und Grundlast, '
           + 'Benutzungsdauer und Veränderung zum vorherigen Messjahr. Die BHKW-Spalten erscheinen nur, wenn für '
           + 'mindestens ein Jahr ein BHKW-Lastgang geladen ist; das Referenzjahr ist hervorgehoben.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Auswertung der Strombezugsdaten',
      leer: 'Keine Messjahre — unter ⚡ Strom-Grundlagen › Messjahre Lastgänge laden.',
      spalten: [{ label: 'Jahr', weight: 1, align: 'left', mono: false }],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const { zeilen } = ggMessjahre();
      const mitBhkw = zeilen.some(z => z.bhkwKwh != null);
      cfg.spalten = [
        { label: 'Jahr', weight: 0.7, align: 'left', mono: false },
        { label: mitBhkw ? 'Bezug EVU' : 'Strombezug', weight: 1.2 },
        ...(mitBhkw ? [{ label: 'BHKW', weight: 1.1 }, { label: 'Gesamt', weight: 1.2 }] : []),
        { label: 'Spitzenlast', weight: 1.1 },
        { label: 'Grundlast', weight: 1 },
        { label: 'Benutzungsdauer', weight: 1.35 },
        { label: 'Veränderung', weight: 1.1 },
      ];
      if (!zeilen.length) {
        cfg.zeilen = []; cfg.fussnote = '';
        return '⚠ Keine Messjahre geladen (⚡ Strom-Grundlagen › Messjahre).';
      }
      const mwh = kwh => ggNum(kwh / 1000) + ' MWh';
      const aenderung = v => (v == null ? '—' : `${v > 0.05 ? '+' : v < -0.05 ? '−' : '±'}${ggNum(Math.abs(v), 1)} %`);
      cfg.zeilen = zeilen.map(z => ({
        highlight: z.referenz,
        werte: [String(z.jahr), mwh(z.bezugKwh),
                ...(mitBhkw ? [z.bhkwKwh != null ? mwh(z.bhkwKwh) : '—', mwh(z.gesamtKwh)] : []),
                ggNum(z.spitzeKw) + ' kW', ggNum(z.grundlastKw) + ' kW',
                z.benutzungsdauerH != null ? ggNum(z.benutzungsdauerH) + ' h' : '—',
                aenderung(z.aenderungProzent)],
      }));
      const ref = zeilen.find(z => z.referenz);
      cfg.fussnote = [mitBhkw ? 'Leistungswerte aus Bezug + BHKW' : '', 'Grundlast = 1-%-Quantil',
                      'Benutzungsdauer = Arbeit ÷ Spitzenlast', 'Veränderung zum vorherigen Messjahr',
                      ref ? `hervorgehoben: Referenzjahr ${ref.jahr}` : ''].filter(Boolean).join(' · ');
      return `✓ ${zeilen.length} Messjahre übernommen` + (ref ? `, Referenzjahr ${ref.jahr}.` : ' — noch kein Referenzjahr gewählt.');
    },
  },

  // ── Jahresverbrauch und Spitzenlast je Messjahr ─────────────────────────
  {
    id: 'stromdaten-jahressummen',
    autoSync: true,
    reihe: 20,
    kapitel: '3.2 Stromverbrauchsdaten',
    titel: 'Jahresverbrauch und Spitzenlast',
    datei: 'stromdaten-jahressummen',
    hinweis: 'Eine gestapelte Säule je Messjahr (Bezug EVU + BHKW in MWh) mit der Spitzenlast als Punkt — eigene Skala, '
           + 'Werte direkt beschriftet.',
    render: cfg => ggRenderBalken(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Jahresverbrauch und Spitzenlast',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Energie in MWh',
      achseX: 'Messjahr',
      leer: 'Keine Messjahre — unter ⚡ Strom-Grundlagen › Messjahre Lastgänge laden.',
      kategorien: [], gruppen: [], punkte: null, summenLabel: true, summenEinheit: ' MWh',
      kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      const { zeilen } = ggMessjahre();
      if (!zeilen.length) {
        cfg.kategorien = []; cfg.gruppen = []; cfg.punkte = null; cfg.kpiLinks = []; cfg.kpiRechts = [];
        return '⚠ Keine Messjahre geladen (⚡ Strom-Grundlagen › Messjahre).';
      }
      const mitBhkw = zeilen.some(z => z.bhkwKwh != null);
      cfg.kategorien = zeilen.map(z => String(z.jahr));
      cfg.gruppen = [{ label: 'Verbrauch', segmente: [
        { label: 'Bezug EVU', farbe: GG_THEME.energy.strom, werte: zeilen.map(z => z.bezugKwh / 1000) },
        ...(mitBhkw ? [{ label: 'BHKW-Erzeugung', farbe: GG_THEME.accents.gruen, werte: zeilen.map(z => (z.bhkwKwh || 0) / 1000) }] : []),
      ] }];
      cfg.punkte = { label: 'Spitzenlast', einheit: 'kW', farbe: GG_THEME.text.strong, werte: zeilen.map(z => z.spitzeKw) };

      const max = ggHoechsteSpitze(zeilen);
      const tr = sdTrend(zeilen);
      const ref = zeilen.find(z => z.referenz);
      cfg.kpiLinks = [
        { wert: ggNum(zeilen.reduce((s, z) => s + z.gesamtKwh, 0) / zeilen.length / 1000) + ' MWh',
          label: zeilen.length > 1 ? 'Mittlerer Jahresverbrauch' : 'Jahresverbrauch' },
        tr
          ? { prozent: (tr.prozent > 0 ? '+' : '') + ggNum(tr.prozent, 1) + ' %',
              wert: ggNum((tr.bis.gesamtKwh - tr.von.gesamtKwh) / 1000) + ' MWh', label: `Veränderung ${tr.von.jahr}–${tr.bis.jahr}` }
          : { wert: ggNum(zeilen[0].grundlastKw) + ' kW', label: 'Grundlast' },
      ];
      cfg.kpiRechts = [
        { wert: ggNum(max.spitzeKw) + ' kW', label: `Höchste Spitzenlast (${max.jahr})` },
        { wert: ref ? String(ref.jahr) : '—', label: ref ? 'Referenzjahr Bedarfsprognose' : 'Referenzjahr nicht gewählt', highlight: true },
      ];
      return `✓ ${zeilen.length} Messjahre übernommen.`;
    },
  },

  // ── Jahresdauerlinien aller Messjahre ───────────────────────────────────
  {
    id: 'stromdaten-dauerlinien',
    autoSync: true,
    reihe: 30,
    kapitel: '3.2 Stromverbrauchsdaten',
    titel: 'Jahresdauerlinien im Vergleich',
    datei: 'stromdaten-dauerlinien',
    hinweis: 'Die absteigend sortierten Leistungswerte aller Messjahre übereinander (Bezug + BHKW), das Referenzjahr '
           + 'kräftiger. Jahre mit nur Stundenwerten zeigen eine etwas niedrigere Spitze als Viertelstundenwerte.',
    render: cfg => ggRenderGanglinie(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Jahresdauerlinien im Vergleich',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: 'Stunden im Jahr, absteigend sortiert',
      leer: 'Keine Messjahre — unter ⚡ Strom-Grundlagen › Messjahre Lastgänge laden.',
      serien: null, xTicks: null, xTickAufSerie: true, grundlastKw: 0, grundlastLabel: '', kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      const { d, zeilen } = ggMessjahre();
      if (!zeilen.length) {
        cfg.serien = null; cfg.kpiLinks = []; cfg.kpiRechts = [];
        return '⚠ Keine Messjahre geladen (⚡ Strom-Grundlagen › Messjahre).';
      }
      const P = 600;
      const n = zeilen.length;
      cfg.serien = zeilen.map((z, i) => ({
        daten: sdDauerlinie(sdJahresauswertung(d.jahre.find(j => j.id === z.id)).reihe.werte, P),
        farbe: GG_MJ_FARBEN[Math.min(n - 1 - i, GG_MJ_FARBEN.length - 1)],
        breite: z.referenz ? 2.6 : 1.5,
        label: z.referenz ? `${z.jahr} (Referenzjahr)` : String(z.jahr),
        referenz: z.referenz,
      })).sort((a, b) => (a.referenz ? 1 : 0) - (b.referenz ? 1 : 0));   // Referenzjahr zuletzt = obenauf
      cfg.xTicks = [0, 2000, 4000, 6000, 8000].map(h => ({ pos: h / 8760 * (P - 1), label: ggNum(h) }));

      const max = ggHoechsteSpitze(zeilen);
      const glMin = ggNum(Math.min(...zeilen.map(z => z.grundlastKw))), glMax = ggNum(Math.max(...zeilen.map(z => z.grundlastKw)));
      const ref = zeilen.find(z => z.referenz);
      cfg.kpiLinks = [
        { wert: ggNum(max.spitzeKw) + ' kW', label: `Höchste Spitzenlast (${max.jahr})` },
        { wert: glMin === glMax ? `${glMin} kW` : `${glMin}–${glMax} kW`, label: 'Grundlast' },
      ];
      cfg.kpiRechts = [
        { wert: ref?.benutzungsdauerH != null ? ggNum(ref.benutzungsdauerH) + ' h' : '—',
          label: ref ? `Benutzungsdauer ${ref.jahr}` : 'Benutzungsdauer (kein Referenzjahr)' },
        { wert: ref ? ggNum(ref.spitzeKw) + ' kW' : '—', label: ref ? `Spitzenlast Referenzjahr ${ref.jahr}` : 'Referenzjahr nicht gewählt', highlight: true },
      ];
      return `✓ Dauerlinien von ${n} Messjahren übernommen.`;
    },
  },

  // ── Entwicklung der Anschlussleistung ───────────────
  {
    id: 'anschlussleistung-entwicklung',
    reihe: 25,   // nach dem Text zum internen Netz, vor der Engpass-Tabelle
    kapitel: '3.4.1 Netzanschluss und internes Stromnetz',
    titel: 'Entwicklung der Anschlussleistung',
    datei: 'anschlussleistung-entwicklung',
    hinweis: 'Höchstlast am Liegenschaftsanschluss über den Planungshorizont, gegen Anschlusswert und '
           + 'Einspeisezusage. „Aus Projekt übernehmen“ startet dafür den Engpass-Sweep — das rechnet '
           + 'das Netz für jedes Stützjahr durch und dauert einen Moment. Rechnet über das Netzmodell '
           + '(Trafo-Spitzen) und weicht deshalb von der resultierenden Anschlussleistung in 3.3.4 ab.',
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

  // ── Gutachtentext: Netzanschluss ─────────────────────────────────────
  {
    id: 'netzanschluss-text',
    istText: true,
    kapitel: '3.1.1 Liegenschaftsstromnetzanschluss',
    titel: 'Gutachtentext: Netzanschluss',
    datei: 'netzanschluss-text',
    hinweis: 'Standardtext für den Ist-Zustand des Netzanschlusses. Grün hinterlegte Angaben sind eingetragen, gelb '
           + 'hinterlegte Platzhalter fehlen noch. Eingetragen werden sie unter ⚡ Strom-Grundlagen › Netzanschluss; '
           + '„⟳ Aus Projekt übernehmen“ liest Spannungsebene und Übergabepunkt-Gebäude aus dem NAP-Asset des '
           + 'Elektro-Tabs, sofern eines platziert ist. Die Empfehlung zum Netzanschlussantrag steht als eigener '
           + 'Baustein in 3.4.1.',
    render: cfg => ggRenderNetzanschlussText(cfg),
    config: {},
    ausProjekt() {
      return typeof window.sgNaAusNapAsset === 'function'
        ? window.sgNaAusNapAsset()
        : '⚠ Netzanschluss-Modul nicht geladen.';
    },
  },

  // ── Gutachtentext: Empfehlung Netzanschlussantrag ────────────────────
  {
    id: 'netzanschluss-empfehlung-text',
    istText: true,
    reihe: 8,   // nach dem Text zur Variante Netzanschluss
    kapitel: '3.4.1 Netzanschluss und internes Stromnetz',
    titel: 'Gutachtentext: Empfehlung Netzanschlussantrag',
    datei: 'netzanschluss-empfehlung-text',
    hinweis: 'Fester Standardtext für die Variantenbildung: Empfehlung, den Netzanschlussantrag frühzeitig und mit Reserve zu stellen.',
    render: cfg => ggRenderNetzanschlussEmpfehlungText(cfg),
    config: {},
  },

];

// Baut die Tabellenzeilen für die Trafo-Übersicht: Ist-Zustand (3.1.2) zeigt
// nur Bestand, Variantenbildung (3.4.1) zeigt Bestand + geplante Stationen grün
// markiert. Geplant ist ein Trafo, der zu einer Planungsschicht gehört oder
// dessen Baujahr noch in der Zukunft liegt.
function ggTrafoZeilen(trafos, { nurBestand = false } = {}) {
  const gebListe = window.gebaeude || [];
  const geb = id => gebListe.find(g => g.id === id) || null;
  const heute = new Date().getFullYear();

  let zeilen = trafos.map(t => {
    const g = geb(t.buildingId);
    const bj = parseInt(t.baujahr ?? g?.baujahr);
    const geplant = t.schicht === 'entwicklung' || t.schicht === 'entscheidung'
                 || (Number.isFinite(bj) && bj > heute);
    return {
      gebIdx:      g ? gebListe.indexOf(g) : 1e9,
      gebLabel:    String(g?.gebaeudenummer || g?.name || '—').trim(),
      stationKey:  t.buildingId || 'einzeln:' + t.id,
      // Heißt das Standortgebäude schon „Trafostation 3“, gewinnt dieser
      // Name — sonst wird unten in Tabellenreihenfolge durchnummeriert. Steht
      // derselbe Name schon in der Gebäudespalte, wird ebenfalls nummeriert,
      // damit die Zeile ihn nicht doppelt zeigt.
      stationName: /station/i.test(g?.name || '') ? String(g.name).trim() : '',
      trafo:       t.name || 'Trafo',
      kva:         Number(t.props?.leistungKVA) || 0,
      bj:          Number.isFinite(bj) ? bj : null,
      geplant,
    };
  });
  if (nurBestand) zeilen = zeilen.filter(z => !z.geplant);

  // Bestand zuerst, danach die geplanten Stationen; innerhalb der Gruppe in
  // der Reihenfolge der Gebäudeliste, damit die Nummerierung stabil bleibt.
  zeilen.sort((a, b) => ((a.geplant ? 1 : 0) - (b.geplant ? 1 : 0))
                     || (a.gebIdx - b.gebIdx)
                     || a.trafo.localeCompare(b.trafo, 'de', { numeric: true }));

  const nr = new Map();
  for (const z of zeilen) if (!nr.has(z.stationKey)) nr.set(z.stationKey, nr.size + 1);
  return { zeilen, nr };
}

/**
 * Trafostationen des Ist-Bestands, eine je Station (nicht je Trafo) — für den Gutachten-Editor,
 * der daraus je Station einen Freitext-Platzhalter anlegt (s. gutAddTrafoDummies in 21).
 * @returns {{label:string, gebLabel:string}[]}
 */
export function ggTrafostationenIstListe() {
  let trafos = [];
  try { trafos = window.listAssets?.({ type: 'Trafo' }) || []; } catch (e) { void e; }
  const { zeilen, nr } = ggTrafoZeilen(trafos, { nurBestand: true });
  const gesehen = new Set();
  const out = [];
  for (const z of zeilen) {
    if (gesehen.has(z.stationKey)) continue;
    gesehen.add(z.stationKey);
    out.push({
      label: (z.stationName && z.stationName !== z.gebLabel) ? z.stationName : 'Trafostation ' + nr.get(z.stationKey),
      gebLabel: z.gebLabel,
    });
  }
  return out;
}

GG_FIGUREN.push(
  // ── Gutachtentext: Trafostationen (Ist-Zustand) ──────────────────────────
  {
    id: 'trafostationen-ist-text',
    istText: true,
    kapitel: '3.1.2 Stromnetz intern (MS/NS)',
    titel: 'Gutachtentext: Trafostationen',
    datei: 'trafostationen-ist-text',
    hinweis: 'Fester Einleitungstext vor der Tabelle „Übersicht Trafostationen“ — verweist auf die im Zuge einer '
           + 'Begehung noch näher zu betrachtenden Stationen. Name Liegenschaft kommt aus dem Projektkopf.',
    render: cfg => ggRenderTrafostationenText(cfg),
    config: {},
  },

  // ── Übersicht Trafostationen (Bestand, Ist-Zustand) ─────────────────────
  {
    id: 'trafostationen-ist',
    autoSync: true,
    kapitel: '3.1.2 Stromnetz intern (MS/NS)',
    titel: 'Übersicht Trafostationen',
    datei: 'trafostationen-ist',
    hinweis: 'Alle bestehenden Transformatoren des Liegenschaftsnetzes mit Standortgebäude, Station, '
           + 'Nennleistung und Baujahr — gelesen aus den Trafo-Assets des Elektro-Tabs. Trafos einer '
           + 'Planungsschicht oder mit Baujahr in der Zukunft zählen hier nicht zum Bestand; sie stehen '
           + 'bei der Variantenbildung (3.4.1).',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Übersicht Trafostationen',
      leer: 'Keine bestehenden Trafos im Modell — im Elektro-Tab eine Trafostation platzieren.',
      spalten: [
        { label: 'Gebäude',       weight: 1.4, align: 'left', mono: false },
        { label: 'Nr.',           weight: 1.6, align: 'left', mono: false },
        { label: 'Trafo',         weight: 1.2, align: 'left', mono: false },
        { label: 'Trafoleistung', weight: 1.3 },
        { label: 'Baujahr',       weight: 1.1 },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      let trafos = [];
      try { trafos = window.listAssets?.({ type: 'Trafo' }) || []; } catch (e) { void e; }
      const { zeilen, nr } = ggTrafoZeilen(trafos, { nurBestand: true });
      if (!zeilen.length) {
        cfg.zeilen = []; cfg.fussnote = '';
        return '⚠ Keine bestehenden Trafos im Modell — im Elektro-Tab eine Trafostation platzieren.';
      }

      cfg.zeilen = zeilen.map(z => ({
        werte: [z.gebLabel,
                (z.stationName && z.stationName !== z.gebLabel)
                  ? z.stationName : 'Trafostation ' + nr.get(z.stationKey),
                z.trafo,
                z.kva > 0 ? ggNum(z.kva) + ' kVA' : '—',
                z.bj || '—'],
      }));

      const summe = zeilen.reduce((s, z) => s + z.kva, 0);
      cfg.fussnote = `${zeilen.length} Transformatoren in ${nr.size} Stationen · installierte Leistung ${ggNum(summe)} kVA`;
      return `✓ ${zeilen.length} bestehende Trafos aus dem Elektromodell übernommen.`;
    },
  },

  // ── Übersicht Trafostationen (Bestand + geplant, Variantenbildung) ──────
  {
    id: 'trafostationen',
    autoSync: true,
    reihe: 40,   // am Ende von 3.4.1, nach der Engpass-Tabelle
    kapitel: '3.4.1 Netzanschluss und internes Stromnetz',
    titel: 'Übersicht Trafostationen',
    datei: 'trafostationen',
    hinweis: 'Alle Transformatoren des Liegenschaftsnetzes mit Standortgebäude, Station, '
           + 'Nennleistung und Baujahr — gelesen aus den Trafo-Assets des Elektro-Tabs. '
           + 'Trafos einer Planungsschicht oder mit Baujahr in der Zukunft stehen als „geplant“.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Übersicht Trafostationen',
      leer: 'Keine Trafos im Modell — im Elektro-Tab eine Trafostation platzieren.',
      spalten: [
        { label: 'Gebäude',       weight: 1.4, align: 'left', mono: false },
        { label: 'Nr.',           weight: 1.6, align: 'left', mono: false },
        { label: 'Trafo',         weight: 1.2, align: 'left', mono: false },
        { label: 'Trafoleistung', weight: 1.3 },
        { label: 'Baujahr',       weight: 1.1 },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      let trafos = [];
      try { trafos = window.listAssets?.({ type: 'Trafo' }) || []; } catch (e) { void e; }
      if (!trafos.length) {
        cfg.zeilen = []; cfg.fussnote = '';
        return '⚠ Keine Trafos im Modell — im Elektro-Tab eine Trafostation platzieren.';
      }

      const { zeilen, nr } = ggTrafoZeilen(trafos);

      cfg.zeilen = zeilen.map(z => ({
        werte: [z.gebLabel,
                (z.stationName && z.stationName !== z.gebLabel)
                  ? z.stationName : 'Trafostation ' + nr.get(z.stationKey),
                z.trafo,
                z.kva > 0 ? ggNum(z.kva) + ' kVA' : '—',
                z.geplant ? 'geplant' : (z.bj || '—')],
        akzent: z.geplant ? GG_THEME.accents.gruen : undefined,
      }));

      const summe = zeilen.reduce((s, z) => s + z.kva, 0);
      const nGeplant = zeilen.filter(z => z.geplant).length;
      cfg.fussnote = `${zeilen.length} Transformatoren in ${nr.size} Stationen · installierte Leistung `
                   + `${ggNum(summe)} kVA`
                   + (nGeplant ? ` · davon ${nGeplant} geplant (grün markiert)` : '');
      return `✓ ${zeilen.length} Trafos aus dem Elektromodell übernommen`
           + (nGeplant ? `, davon ${nGeplant} geplant.` : '.');
    },
  },

);

/* ── 3.1.3 Erzeugungsanlagen und 3.1.4 Notstromversorgung (Ist-Zustand) ─────────
 * Nur Bestand, wie die Trafo-Übersicht: Anlagen einer Planungsschicht oder mit Baujahr in
 * der Zukunft sind geplant (→ Variantenbildung 3.4), zurückgebaute fallen weg. Leistungen
 * zählen nur, wenn sie im Inspector eingetragen sind — die dort angezeigten Vorgabewerte
 * sind keine Bestandsangaben, deshalb bleibt der Platzhalter dann gelb. */

const GG_ERZEUGER_TYPEN = ['PV', 'Wind', 'KWK', 'Batterie'];
const GG_ANLAGE_LABEL = { PV: 'PV-Anlage', Wind: 'Windkraftanlage', KWK: 'BHKW', Batterie: 'Batteriespeicher', Nsa: 'Netzersatzanlage' };
/** Spezifischer PV-Ertrag ohne Eintrag — wie _PV_SPEZ_DEFAULT (09a); nicht importiert, damit 17 Blatt bleibt. */
const GG_PV_SPEZ_VORGABE = { sued: 1050, ostwest: 950 };

/** Eingetragene positive Zahl aus einem Asset-Feld (meist String, Komma erlaubt), sonst null. */
function ggPropZahl(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Summe über Anlagen — null, sobald bei einer Anlage der Wert fehlt. */
function ggSummeOderNull(liste, wert) {
  let s = 0;
  for (const x of liste) {
    const w = wert(x);
    if (w == null) return null;
    s += w;
  }
  return liste.length ? s : null;
}

const ggGebText = g => {
  const nr = String(g?.gebaeudenummer || '').trim();
  return nr ? `Gebäude ${nr}` : String(g?.name || '').trim();
};

/** Anlagen der Typen, getrennt in Bestand und Planung; Bestand nach Typ, Gebäudeliste und Name sortiert. */
function ggAnlagenIst(typen) {
  let alle = [];
  try { alle = (window.listAssets?.() || []).filter(a => typen.includes(a.type)); } catch (e) { void e; }
  const gebListe = window.gebaeude || [];
  const heute = new Date().getFullYear();
  const bestand = [], geplant = [];
  for (const a of alle) {
    const g = gebListe.find(x => x.id === a.buildingId) || null;
    const bj = parseInt(a.baujahr ?? g?.baujahr);
    const ab = parseInt(a.abrissjahr ?? g?.abrissjahr);
    if (Number.isFinite(ab) && ab < heute) continue;
    const e = { a, g, p: a.props || {}, bj: Number.isFinite(bj) ? bj : null };
    const plan = a.schicht === 'entwicklung' || a.schicht === 'entscheidung' || (e.bj != null && e.bj > heute);
    (plan ? geplant : bestand).push(e);
  }
  const gebIdx = e => (e.g ? gebListe.indexOf(e.g) : 1e9);
  bestand.sort((x, y) => (typen.indexOf(x.a.type) - typen.indexOf(y.a.type)) || (gebIdx(x) - gebIdx(y))
    || String(x.a.name).localeCompare(String(y.a.name), 'de', { numeric: true }));
  return { bestand, geplant };
}

const ggMwh = v => ggNum(v, v < 10 ? 1 : 0);

/** Kenngrößen einer Erzeugungsanlage bzw. eines Speichers: kw = Hauptleistung (PV in kWp), Zellen für die Tabelle. */
function ggErzeugerKenn(e) {
  const p = e.p;
  const kwText = (v, einheit) => (v != null ? `${ggNum(v, v < 10 ? 1 : 0)} ${einheit}` : '—');
  switch (e.a.type) {
    case 'PV': {
      const ow = p.ausrichtung === 'ostwest';
      const kw = ggPropZahl(p.leistungKWp);
      const spez = ggPropZahl(p.pvSpez) ?? GG_PV_SPEZ_VORGABE[ow ? 'ostwest' : 'sued'];
      const mwh = kw != null ? kw * spez / 1000 : null;
      return { kw, spez, mwh, art: `Photovoltaik (${ow ? 'Ost-West' : 'Süd'})`,
               leistung: kwText(kw, 'kWp'), kenn: mwh != null ? `≈ ${ggMwh(mwh)} MWh/a` : '—' };
    }
    case 'Wind': {
      const kw = ggPropZahl(p.leistungKW), nh = ggPropZahl(p.nabenhoheM);
      return { kw, art: 'Windkraftanlage', leistung: kwText(kw, 'kW'), kenn: nh != null ? `Nabenhöhe ${ggNum(nh)} m` : '—' };
    }
    case 'KWK': {
      const kw = ggPropZahl(p.leistungElKW), th = ggPropZahl(p.leistungThKW);
      return { kw, th, art: p.brennstoff ? `BHKW (${p.brennstoff})` : 'BHKW',
               leistung: kwText(kw, 'kW el.'), kenn: kwText(th, 'kW th.') };
    }
    case 'Batterie': {
      const kw = ggPropZahl(p.leistungKW), kwh = ggPropZahl(p.kapazitaetKWh);
      return { kw, kwh, art: 'Batteriespeicher', leistung: kwText(kw, 'kW'), kenn: kwText(kwh, 'kWh') };
    }
    default:
      return { kw: null, art: e.a.type, leistung: '—', kenn: '—' };
  }
}

/** „(Gebäude 12, 14 und Stabsgebäude)“ — Standorte einer Anlagengruppe, leer ohne Gebäudezuordnung. */
function ggAnlagenOrte(liste) {
  const orte = [...new Set(liste.map(e => ggGebText(e.g)).filter(Boolean))];
  return orte.length ? ` (${ggBedarfListe(orte.map(gEsc))})` : '';
}

/** Gemessene (sonst synthetische) Höchstlast der Liegenschaft aus der NAP-Analyse, null ohne Daten. */
function ggHoechstlastIst() {
  if (typeof window.napBedarfsStand !== 'function') return null;
  try {
    const st = window.napBedarfsStand();
    return st?.basisKw > 0 ? st : null;
  } catch (e) { void e; return null; }
}

/** Kapitel 3.1.3 Erzeugungsanlagen (Ist-Zustand) — PV, Wind, BHKW und Batteriespeicher im Bestand. */
function ggRenderErzeugungText(cfg, T = GG_THEME) {
  void cfg;
  const name = ggTextFeld(document.querySelector('.header-projekt-name')?.textContent?.trim() || '', 'Name Liegenschaft');
  const { bestand } = ggAnlagenIst(GG_ERZEUGER_TYPEN);
  const nach = typ => bestand.filter(e => e.a.type === typ);
  const pv = nach('PV'), wind = nach('Wind'), kwk = nach('KWK'), bat = nach('Batterie');
  const zusammen = liste => (liste.length > 1 ? 'zusammen ' : '');

  if (!bestand.length) {
    return ggTextBlatt([
      `In der Liegenschaft ${name} sind derzeit keine Anlagen zur Stromerzeugung und keine Batteriespeicher vorhanden. `
        + `Der Strombedarf wird vollständig aus dem Netz der allgemeinen Versorgung gedeckt.`,
      `Die Notstromversorgung wird in Kapitel 3.1.4 beschrieben. Möglichkeiten zur Eigenerzeugung und Speicherung `
        + `werden in der Variantenbildung (Kapitel 3.4) betrachtet.`,
    ], T);
  }

  const absaetze = [`In der Liegenschaft ${name} sind derzeit folgende Anlagen zur Stromerzeugung und -speicherung `
    + `in das Liegenschaftsnetz eingebunden:`];

  if (pv.length) {
    const kn = pv.map(ggErzeugerKenn);
    const kwp = ggSummeOderNull(kn, k => k.kw), mwh = ggSummeOderNull(kn, k => k.mwh);
    const spez = [...new Set(kn.map(k => k.spez))].sort((a, b) => a - b);
    absaetze.push(`Photovoltaik: ${pv.length === 1 ? 'Eine Anlage' : `${pv.length} Anlagen`} mit einer installierten `
      + `Leistung von ${zusammen(pv)}${ggBedarfFeld(kwp, 'Leistung PV kWp')} kWp${ggAnlagenOrte(pv)}. `
      + (spez.length === 1
        ? `Mit einem spezifischen Ertrag von ${ggNum(spez[0])} kWh/kWp ergibt sich `
        : `Aus den spezifischen Erträgen der Anlagen von ${ggNum(spez[0])} bis ${ggNum(spez[spez.length - 1])} kWh/kWp ergibt sich `)
      + `rechnerisch ein Jahresertrag von rund ${ggTextFeld(mwh != null ? ggMwh(mwh) : '', 'Jahresertrag PV MWh')} MWh. `
      + `Der erzeugte Strom wird ${ggTextFeld('', 'Nutzung, z. B. vorrangig in der Liegenschaft verbraucht und der Überschuss eingespeist')}.`);
  }

  if (wind.length) {
    const kw = ggSummeOderNull(wind.map(ggErzeugerKenn), k => k.kw);
    absaetze.push(`Windenergie: ${wind.length === 1 ? 'Eine Windkraftanlage' : `${wind.length} Windkraftanlagen`} mit einer `
      + `Nennleistung von ${zusammen(wind)}${ggBedarfFeld(kw, 'Nennleistung Wind kW')} kW${ggAnlagenOrte(wind)}.`);
  }

  // EEG-Zahlungsdauer: 20 Jahre zuzüglich des Inbetriebnahmejahres; das Baujahr steht für die Inbetriebnahme
  const eeg = [...pv, ...wind].filter(e => e.bj != null).sort((x, y) => x.bj - y.bj)[0];
  if (eeg) {
    const eine = pv.length + wind.length === 1;
    absaetze.push(`Sofern für ${eine ? 'die Anlage' : 'die Anlagen'} eine Vergütung nach dem Erneuerbare-Energien-Gesetz (EEG) `
      + `in Anspruch genommen wird, endet der Vergütungszeitraum von 20 Jahren zuzüglich des Inbetriebnahmejahres `
      + `${eine ? '' : `für die älteste Anlage (${gEsc(eeg.a.name)}, Baujahr ${eeg.bj}) `}Ende ${eeg.bj + 20}.`);
  }

  if (kwk.length) {
    const kn = kwk.map(ggErzeugerKenn);
    const el = ggSummeOderNull(kn, k => k.kw), th = ggSummeOderNull(kn, k => k.th);
    const brennstoffe = [...new Set(kwk.map(e => e.p.brennstoff).filter(Boolean))];
    const eine = kwk.length === 1;
    absaetze.push(`Kraft-Wärme-Kopplung: ${eine ? 'Ein Blockheizkraftwerk (BHKW)' : `${kwk.length} Blockheizkraftwerke (BHKW)`} `
      + `mit ${zusammen(kwk)}${ggBedarfFeld(el, 'el. Leistung BHKW kW')} kW elektrischer und `
      + `${ggBedarfFeld(th, 'th. Leistung BHKW kW')} kW thermischer Leistung${ggAnlagenOrte(kwk)}`
      + `${brennstoffe.length ? `, betrieben mit ${ggAufzaehlung(brennstoffe.map(gEsc))}` : ''}. `
      + `${eine ? 'Die Anlage ist' : 'Die Anlagen sind'} in die Wärmeversorgung eingebunden (vgl. Kapitel 2.1) und `
      + `${eine ? 'wird' : 'werden'} ${ggTextFeld('', 'Betriebsweise, z. B. wärmegeführt')} betrieben.`);
  }

  if (bat.length) {
    const kn = bat.map(ggErzeugerKenn);
    const kw = ggSummeOderNull(kn, k => k.kw), kwh = ggSummeOderNull(kn, k => k.kwh);
    const eine = bat.length === 1;
    absaetze.push(`Batteriespeicher: ${eine ? 'Ein Speicher' : `${bat.length} Speicher`} mit einer Leistung von `
      + `${zusammen(bat)}${ggBedarfFeld(kw, 'Leistung Speicher kW')} kW und einer Kapazität von `
      + `${ggBedarfFeld(kwh, 'Kapazität Speicher kWh')} kWh${ggAnlagenOrte(bat)}. `
      + `${eine ? 'Der Speicher dient' : 'Die Speicher dienen'} `
      + `${ggTextFeld('', 'Einsatzzweck, z. B. der Erhöhung des Eigenverbrauchs oder der Kappung von Lastspitzen')}.`);
  }

  absaetze.push(`Die folgende Tabelle gibt eine Übersicht über die Erzeugungsanlagen und Speicher im Bestand. `
    + `Soweit die Anlagen hinter dem Übergabepunkt einspeisen, ist der gemessene Strombezug der Liegenschaft `
    + `(vgl. Kapitel 3.2) bereits um den selbst genutzten Anteil der Erzeugung vermindert. Geplante Anlagen werden `
    + `in der Variantenbildung (Kapitel 3.4) betrachtet.`);
  return ggTextBlatt(absaetze, T);
}

/** Kapitel 3.1.4 Notstromversorgung (Ist-Zustand) — Netzersatzanlagen (Assets Nsa) im Bestand. */
function ggRenderNotstromText(cfg, T = GG_THEME) {
  void cfg;
  const name = ggTextFeld(document.querySelector('.header-projekt-name')?.textContent?.trim() || '', 'Name Liegenschaft');
  const { bestand } = ggAnlagenIst(['Nsa']);
  const usv = `Unterbrechungsfreie Stromversorgungen (USV) sind `
    + `${ggTextFeld('', 'USV-Anlagen, z. B. im Serverraum Gebäude xx, oder „nicht“')} vorhanden.`;

  if (!bestand.length) {
    return ggTextBlatt([
      `In der Liegenschaft ${name} ist derzeit keine stationäre Netzersatzanlage (NEA) vorhanden. Bei einem Ausfall `
        + `des Netzes der allgemeinen Versorgung steht damit keine Ersatzstromversorgung zur Verfügung.`,
      `Einspeisepunkte für mobile Netzersatzanlagen sind `
        + `${ggTextFeld('', 'Einspeisepunkte, z. B. an der NSHV Gebäude xx, oder „nicht“')} vorhanden. ${usv}`,
      `Anforderungen an eine künftige Notstromversorgung werden in Kapitel 3.4.3 sowie im Rahmen der Resilienzbewertung `
        + `in Kapitel 5 betrachtet.`,
    ], T);
  }

  const eine = bestand.length === 1;
  const kw = ggSummeOderNull(bestand, e => ggPropZahl(e.p.leistungKW));
  const absaetze = [];

  absaetze.push(`Zur Versorgung bei einem Ausfall des Netzes der allgemeinen Versorgung ${eine ? 'steht' : 'stehen'} in der `
    + `Liegenschaft ${name} ${eine ? 'eine stationäre Netzersatzanlage (NEA)' : `${bestand.length} stationäre Netzersatzanlagen (NEA)`} `
    + `mit einer elektrischen Leistung von ${eine ? '' : 'zusammen '}${ggBedarfFeld(kw, 'Leistung NEA kW')} kW zur Verfügung.`);

  const teile = bestand.map(e => {
    const angaben = [
      gEsc(ggGebText(e.g)),
      `${ggBedarfFeld(ggPropZahl(e.p.leistungKW), 'Leistung kW')} kW`,
      e.p.kraftstoff ? gEsc(e.p.kraftstoff) : ggTextFeld('', 'Kraftstoff'),
      e.bj != null ? `Baujahr ${e.bj}` : ggTextFeld('', 'Baujahr'),
    ].filter(Boolean);
    return `${gEsc(e.a.name)} (${angaben.join(', ')})`;
  });
  absaetze.push(`${eine ? 'Es handelt sich um die Anlage' : 'Im Einzelnen handelt es sich um'} ${ggBedarfListe(teile)}.`);

  const autonomie = bestand.map(e => ggPropZahl(e.p.autonomieH));
  const aMin = Math.min(...autonomie), aMax = Math.max(...autonomie);
  const autonomieText = autonomie.some(v => v == null)
    ? `${ggTextFeld('', 'Autonomiezeit h')} Stunden`
    : aMin === aMax ? `${ggNum(aMin)} Stunden` : `${ggNum(aMin)} bis ${ggNum(aMax)} Stunden`;
  absaetze.push(`Mit dem vorhandenen Kraftstoffvorrat ist ein Betrieb über ${autonomieText} möglich. Eine Nachbetankung bei `
    + `länger andauerndem Netzausfall ist ${ggTextFeld('', 'Regelung Nachbetankung, z. B. über einen Rahmenvertrag gesichert')}.`);

  const st = ggHoechstlastIst();
  if (st && kw != null) {
    const anteil = kw / st.basisKw * 100;
    absaetze.push(`Bezogen auf die ${st.gemessen ? 'gemessene' : 'synthetisch ermittelte'} Höchstlast der Liegenschaft von `
      + `${ggNum(st.basisKw)} kW im Jahr ${st.dataYear} (vgl. Kapitel 3.2) entspricht die Notstromleistung rund `
      + `${ggNum(anteil)} %. `
      + (anteil >= 100
        ? 'Rechnerisch reicht die Leistung damit für eine Ersatzversorgung der gesamten Liegenschaft aus; tatsächlich '
          + 'versorgt werden jedoch nur die an das Notstromnetz angeschlossenen Verbraucher.'
        : `Eine Ersatzversorgung der gesamten Liegenschaft ist damit nicht möglich; ${eine ? 'die Anlage versorgt' : 'die Anlagen versorgen'} `
          + 'ausgewählte, notstromberechtigte Verbraucher.'));
  }

  absaetze.push(`Über die Notstromversorgung versorgt werden ${ggTextFeld('', 'notstromberechtigte Gebäude und Verbraucher')}. `
    + `Die Umschaltung auf Netzersatzbetrieb erfolgt ${ggTextFeld('', 'automatisch oder manuell')}; `
    + `${eine ? 'die Anlage wird' : 'die Anlagen werden'} ${ggTextFeld('', 'Prüfintervall, z. B. monatlich mit Probelauf unter Last')} geprüft.`);
  absaetze.push(usv);
  absaetze.push(`Die folgende Tabelle gibt eine Übersicht über die Netzersatzanlagen im Bestand. Die Weiterentwicklung der `
    + `Notstromversorgung wird in Kapitel 3.4.3, ihre Bedeutung für die Resilienz der Liegenschaft in Kapitel 5 betrachtet.`);
  return ggTextBlatt(absaetze, T);
}

/** Einzelansicht der Textbausteine 3.1.3/3.1.4: was aus dem Elektro-Tab übernommen wird und was fehlt. */
function ggAnlagenStandHtml(key) {
  const notstrom = key === 'notstrom';
  const typen = notstrom ? ['Nsa'] : GG_ERZEUGER_TYPEN;
  const { bestand, geplant } = ggAnlagenIst(typen);
  const zeile = (label, wert) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;font-size:11px;line-height:1.6;">
      <span style="color:var(--muted);">${gEsc(label)}</span><span>${wert}</span></div>`;
  const ohneLeistung = bestand.filter(e => (notstrom ? ggPropZahl(e.p.leistungKW) : ggErzeugerKenn(e).kw) == null).length;

  let html = zeile('Bestand', bestand.length
      ? typen.map(t => [t, bestand.filter(e => e.a.type === t).length]).filter(([, n]) => n)
          .map(([t, n]) => `${n} × ${GG_ANLAGE_LABEL[t]}`).join(' · ')
      : '<span style="color:#e0a126;">keine Anlagen im Elektro-Tab — Text meldet „nicht vorhanden“</span>')
    + zeile('Nicht berücksichtigt', geplant.length
      ? `${geplant.length} geplante (Planungsschicht oder Baujahr in der Zukunft) → Kapitel 3.4` : '—');
  if (notstrom) {
    const st = ggHoechstlastIst();
    html += zeile('Höchstlast Liegenschaft', st
      ? `${ggNum(st.basisKw)} kW · ${st.gemessen ? 'Messung' : 'synthetisch'} ${st.dataYear}`
      : '<span style="color:#e0a126;">keine Strommessung — Satz zur Abdeckung entfällt</span>');
  }
  if (ohneLeistung) {
    html += `<div style="font-size:10px;color:#e0a126;margin-top:6px;line-height:1.5;">⚠ ${ohneLeistung} `
      + `${ohneLeistung === 1 ? 'Anlage' : 'Anlagen'} ohne eingetragene Leistung — im Inspector des Elektro-Tabs eintragen. `
      + `Der dort angezeigte Vorgabewert wird bewusst nicht übernommen.</div>`;
  }
  return html + `<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Anlagen, Leistungen, `
    + `${notstrom ? 'Kraftstoff, Autonomie' : 'Brennstoff, Ausrichtung'} und Baujahr kommen aus den Assets des Elektro-Tabs. `
    + `„Nicht vorhanden“ stimmt nur, wenn alle Bestandsanlagen dort erfasst sind. Gelbe Platzhalter `
    + `(${notstrom ? 'versorgte Verbraucher, Umschaltung, Prüfung, USV, Nachbetankung' : 'Nutzung des PV-Stroms, Betriebsweise BHKW, Einsatzzweck Speicher'}) `
    + `erfasst das Tool nicht — in Word ergänzen.</div>`;
}

GG_FIGUREN.push(
  // ── Gutachtentext: Erzeugungsanlagen (Ist-Zustand) ──────────────────────
  {
    id: 'erzeugung-ist-text',
    istText: true,
    anlagenText: 'erzeugung',
    reihe: 10,
    kapitel: '3.1.3 Erzeugungsanlagen',
    titel: 'Gutachtentext: Erzeugungsanlagen',
    datei: 'erzeugung-ist-text',
    hinweis: 'Standardtext für die Eigenerzeugung im Bestand: PV, Windkraft, BHKW und Batteriespeicher aus dem '
           + 'Elektro-Tab, je Anlagenart ein Absatz mit Leistung, Standorten und rechnerischem PV-Ertrag. Ohne '
           + 'Bestandsanlagen lautet der Text „keine Erzeugungsanlagen vorhanden“.',
    render: cfg => ggRenderErzeugungText(cfg),
    config: {},
  },

  // ── Übersicht Erzeugungsanlagen und Speicher (Bestand) ─────────────────
  {
    id: 'erzeugung-ist',
    autoSync: true,
    reihe: 20,
    kapitel: '3.1.3 Erzeugungsanlagen',
    titel: 'Übersicht Erzeugungsanlagen und Speicher',
    datei: 'erzeugung-ist',
    hinweis: 'PV-, Wind-, BHKW- und Batterie-Assets des Elektro-Tabs im Bestand mit Standortgebäude, Leistung, '
           + 'Kenngröße (PV: rechnerischer Jahresertrag, Wind: Nabenhöhe, BHKW: thermische Leistung, Speicher: '
           + 'Kapazität) und Baujahr. Geplante Anlagen stehen in der Variantenbildung (3.4).',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Übersicht Erzeugungsanlagen und Speicher',
      leer: 'Keine Erzeugungsanlagen oder Speicher im Bestand — PV, Wind, BHKW oder Batterie im Elektro-Tab erfassen.',
      spalten: [
        { label: 'Anlage',    weight: 1.5, align: 'left', mono: false },
        { label: 'Standort',  weight: 1.2, align: 'left', mono: false },
        { label: 'Art',       weight: 1.7, align: 'left', mono: false },
        { label: 'Leistung',  weight: 1.2 },
        { label: 'Kenngröße', weight: 1.3 },
        { label: 'Baujahr',   weight: 0.9 },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const { bestand, geplant } = ggAnlagenIst(GG_ERZEUGER_TYPEN);
      if (!bestand.length) {
        cfg.zeilen = []; cfg.fussnote = '';
        return '⚠ Keine Erzeugungsanlagen oder Speicher im Bestand'
             + (geplant.length ? ` (${geplant.length} geplante nicht berücksichtigt).` : '.');
      }
      const kn = bestand.map(e => ({ e, k: ggErzeugerKenn(e) }));
      cfg.zeilen = kn.map(({ e, k }) => ({
        werte: [e.a.name || GG_ANLAGE_LABEL[e.a.type], ggGebText(e.g) || '—', k.art, k.leistung, k.kenn, e.bj || '—'],
      }));

      const summen = [];
      const summe = (typ, wert, einheit, label) => {
        const liste = kn.filter(x => x.e.a.type === typ);
        if (!liste.length) return;
        const s = ggSummeOderNull(liste, x => wert(x.k));
        summen.push(`${label} ${s != null ? ggNum(s) + ' ' + einheit : 'Leistung unvollständig'}`);
      };
      summe('PV', k => k.kw, 'kWp', 'PV');
      summe('Wind', k => k.kw, 'kW', 'Wind');
      summe('KWK', k => k.kw, 'kW el.', 'BHKW');
      summe('Batterie', k => k.kwh, 'kWh', 'Speicher');
      cfg.fussnote = `${bestand.length} ${bestand.length === 1 ? 'Anlage' : 'Anlagen'} im Bestand · ${summen.join(' · ')}`
                   + (kn.some(x => x.e.a.type === 'PV') ? ' · PV-Ertrag rechnerisch aus kWp × spez. Ertrag' : '');
      return `✓ ${bestand.length} Erzeugungsanlagen/Speicher aus dem Elektromodell übernommen`
           + (geplant.length ? `, ${geplant.length} geplante nicht berücksichtigt.` : '.');
    },
  },

  // ── Gutachtentext: Notstromversorgung (Ist-Zustand) ─────────────────────
  {
    id: 'notstrom-ist-text',
    istText: true,
    anlagenText: 'notstrom',
    reihe: 10,
    kapitel: '3.1.4 Notstromversorgung',
    titel: 'Gutachtentext: Notstromversorgung',
    datei: 'notstrom-ist-text',
    hinweis: 'Standardtext für die Netzersatzanlagen im Bestand (Assets „Notstromaggregat“ im Elektro-Tab): Anzahl, '
           + 'Leistung, Standorte, Kraftstoff, Autonomie und Anteil an der Höchstlast der Liegenschaft. Ohne '
           + 'Bestandsanlagen lautet der Text „keine NEA vorhanden“ und fragt Einspeisepunkte für mobile Aggregate ab.',
    render: cfg => ggRenderNotstromText(cfg),
    config: {},
  },

  // ── Übersicht Netzersatzanlagen (Bestand) ──────────────────────────────
  {
    id: 'notstrom-ist',
    autoSync: true,
    reihe: 20,
    kapitel: '3.1.4 Notstromversorgung',
    titel: 'Übersicht Netzersatzanlagen',
    datei: 'notstrom-ist',
    hinweis: 'Notstromaggregate des Elektro-Tabs im Bestand mit Standortgebäude, Leistung, Kraftstoff, Autonomie und '
           + 'Baujahr. Aggregate aus der Notstrom-Platzierung der Netzanalyse zählen nur dann nicht zum Bestand, wenn '
           + 'sie in einer Planungsschicht liegen oder ein Baujahr in der Zukunft haben.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Übersicht Netzersatzanlagen',
      leer: 'Keine Netzersatzanlagen im Bestand — Notstromaggregat im Elektro-Tab erfassen.',
      spalten: [
        { label: 'Anlage',     weight: 1.5, align: 'left', mono: false },
        { label: 'Standort',   weight: 1.3, align: 'left', mono: false },
        { label: 'Leistung',   weight: 1.1 },
        { label: 'Kraftstoff', weight: 1.1 },
        { label: 'Autonomie',  weight: 1.1 },
        { label: 'Baujahr',    weight: 0.9 },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const { bestand, geplant } = ggAnlagenIst(['Nsa']);
      if (!bestand.length) {
        cfg.zeilen = []; cfg.fussnote = '';
        return '⚠ Keine Netzersatzanlagen im Bestand'
             + (geplant.length ? ` (${geplant.length} geplante nicht berücksichtigt).` : '.');
      }
      cfg.zeilen = bestand.map(e => {
        const kw = ggPropZahl(e.p.leistungKW), h = ggPropZahl(e.p.autonomieH);
        return { werte: [e.a.name || 'NEA', ggGebText(e.g) || '—', kw != null ? ggNum(kw) + ' kW' : '—',
                         e.p.kraftstoff || '—', h != null ? ggNum(h) + ' h' : '—', e.bj || '—'] };
      });
      const kw = ggSummeOderNull(bestand, e => ggPropZahl(e.p.leistungKW));
      const st = ggHoechstlastIst();
      cfg.fussnote = `${bestand.length} ${bestand.length === 1 ? 'Netzersatzanlage' : 'Netzersatzanlagen'} · `
                   + (kw != null ? `Leistung ${bestand.length > 1 ? 'zusammen ' : ''}${ggNum(kw)} kW` : 'Leistung unvollständig')
                   + (kw != null && st ? ` · ${ggNum(kw / st.basisKw * 100)} % der Höchstlast ${st.dataYear}` : '');
      return `✓ ${bestand.length} Netzersatzanlagen aus dem Elektromodell übernommen`
           + (geplant.length ? `, ${geplant.length} geplante nicht berücksichtigt.` : '.');
    },
  },
);

/* ══════════════════════════════════════════════════════════════════════════
 * 3f) RENDERER — „Wasserfall": Leistungsbilanz in Stufen
 *
 * Für die Bedarfsprognose Strom (3.3.1–3.3.3): Ausgangswert, Rückbau, Zubau,
 * Summe — jede Säule setzt dort an, wo die vorige endet.
 * cfg.balken = [{ label, sub?, wert, art }] mit art
 *   'basis'    steht auf der Nulllinie, Höhe = wert
 *   'delta'    verschiebt den laufenden Stand um wert (grün hoch, rot runter)
 *   'summe'    steht auf der Nulllinie, Höhe = laufender Stand (wert wird ignoriert)
 *   'ausblick' wie delta, nur gestrichelt — Zusatzbedarf späterer Kapitel
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderWasserfall(cfg, T = GG_THEME) {
  // Flacher als die Ganglinie: sechs Säulen brauchen keine 470 px Höhe
  const G = ggSheetGeometry({ ...T, sheet: { ...T.sheet, plotH: 360 } }, cfg);
  const S = G.S, W = G.W, plotX = G.plotX, plotW = G.plotW, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = ggSheetHeader(cfg, T, G);
  out += `<rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;

  const balken = (cfg.balken || []).filter(b => b && Number.isFinite(b.wert));
  if (!balken.length) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, cfg.leer || 'Keine Daten vorhanden',
               { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    let stand = 0;
    const saeulen = balken.map(b => {
      const aufNull = b.art === 'basis' || b.art === 'summe';
      const von = aufNull ? 0 : stand;
      const bis = b.art === 'basis' ? b.wert : b.art === 'summe' ? stand : stand + b.wert;
      stand = bis;
      return { ...b, von, bis };
    });

    const grenzen = (cfg.grenzen || []).filter(g => g && g.wert > 0);
    const max = Math.max(0, ...saeulen.map(s => Math.max(s.von, s.bis)), ...grenzen.map(g => g.wert));
    const yStep = ggNiceStep(max / 6);
    // etwas Luft über der höchsten Säule für ihre Wertbeschriftung
    const yMax  = Math.max(yStep, Math.ceil(max * 1.08 / yStep) * yStep);
    const yOf = v => plotB - (Math.max(0, v) / yMax) * plotH;

    let gitter = '';
    for (let v = yStep; v < yMax; v += yStep) {
      const y = Math.round(yOf(v)) + 0.5;
      gitter += `M${gR(plotX)} ${y}H${gR(plotX + plotW)}`;
    }
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;

    const fachW = plotW / saeulen.length;
    const bw = Math.min(fachW * 0.62, 120);
    saeulen.forEach((s, i) => {
      const cx = plotX + i * fachW + fachW / 2, x = cx - bw / 2;
      const oben = yOf(Math.max(s.von, s.bis)), unten = yOf(Math.min(s.von, s.bis));
      const h = Math.max(unten - oben, 0.8);
      const ausblick = s.art === 'ausblick';
      const aufNull  = s.art === 'basis' || s.art === 'summe';
      const runter   = s.bis < s.von;

      if (ausblick) {
        out += `<rect x="${gR(x + 0.75)}" y="${gR(oben + 0.75)}" width="${gR(bw - 1.5)}" height="${gR(Math.max(h - 1.5, 0.8))}"
                  fill="none" stroke="${T.text.faint}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
      } else {
        const farbe = aufNull ? T.accents.gruenDunkel : runter ? T.energy.waerme : T.accents.gruen;
        out += `<rect x="${gR(x)}" y="${gR(oben)}" width="${gR(bw)}" height="${gR(h)}" fill="${farbe}"/>`;
      }

      // Verbinder auf Höhe des Stands bis zur nächsten Säule
      if (i < saeulen.length - 1) {
        const y = Math.round(yOf(s.bis)) + 0.5;
        out += `<line x1="${gR(x + bw)}" y1="${y}" x2="${gR(cx + fachW - bw / 2)}" y2="${y}"
                  stroke="${T.text.faint}" stroke-width="1" stroke-dasharray="3 3"/>`;
      }

      const d = s.bis - s.von;
      const wertTxt = aufNull ? ggNum(s.bis) : (d < 0 ? '−' : '+') + ggNum(Math.abs(d));
      const wertFarbe = ausblick ? T.text.faint : aufNull ? T.text.strong : runter ? T.energy.waerme : T.accents.gruenDunkel;
      // Rote Säulen hängen vom Stand herab — ihr Wert steht darunter, sonst darüber
      out += txt(cx, (runter && !aufNull) ? unten + 17 : oben - 8, wertTxt,
                 { anchor: 'middle', mono: true, size: 13, weight: ausblick ? 500 : 600, fill: wertFarbe });

      out += txt(cx, G.xLabelY, s.label || '', { anchor: 'middle', size: S.fsAxis + 0.5,
                 weight: s.art === 'summe' ? 700 : 600, fill: ausblick ? T.text.faint : T.text.strong });
      if (s.sub) out += txt(cx, G.xLabelY + 15, s.sub, { anchor: 'middle', size: S.fsAxis, fill: T.text.faint });
    });

    // Grenzlinien (z. B. vereinbarte Anschlussleistung); Beschriftung links über der Linie auf Papiergrund
    for (const g of grenzen) {
      const y = gR(yOf(g.wert));
      const farbe = g.farbe || T.energy.waerme;
      out += `<line x1="${gR(plotX)}" y1="${y}" x2="${gR(plotX + plotW)}" y2="${y}"
                stroke="${farbe}" stroke-width="${g.breite || 2}" stroke-dasharray="${g.strich || '10 6'}"/>`;
      if (g.label) {
        const lw = ggEstW(g.label, S.fsLeg) + 12;
        out += `<rect x="${gR(plotX + 6)}" y="${gR(y - 22)}" width="${gR(lw)}" height="17" fill="${T.bg}" fill-opacity="0.92"/>`
             + txt(plotX + 12, y - 9, g.label, { size: S.fsLeg, weight: 600, fill: farbe });
      }
    }

    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      out += txt(plotX - 8, yOf(v) + S.fsAxis * 0.36, ggNum(v, yStep < 1 ? 1 : 0),
                 { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
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

// ── Bedarfsprognose Strom (3.3.1–3.3.3) ──────────────────────────────────────
// Quelle: window.napBedarfsStand() aus der NAP-Analyse (13o) — Messbasis,
// Gleichzeitigkeitsfaktor und Maßnahmen-Haken werden dort eingestellt. Gerechnet
// wird mit lib/bedarfsprognose.js, derselben Rechnung wie die Lastentwicklung im
// NAP-Panel; die drei Kapitel sind Stufen einer Kaskade (Übertrag von Kapitel zu Kapitel).
const GG_BEDARF_TEXTE = {
  gebaeude: {
    kapitel: '3.3.1 Bestandsbedarf und bauliche Entwicklung',
    titel: 'Bestandsbedarf und bauliche Entwicklung', tabTitel: 'Bauliche Veränderungen',
    zubau: 'Neubau', summe: 'Gebäudebedarf', einheit: ['Gebäude', 'Gebäude'],
    herkunft: 'Verbraucher-Assets der Gebäude mit Baujahr bzw. Abrissjahr nach dem Messjahr (gepflegt im Gebäude-Tab). '
            + 'Ausgangspunkt ist die gemessene Höchstlast; Neubau addiert, Rückbau subtrahiert die Anschlussleistung.',
    leer: 'Keine baulichen Veränderungen erfasst — Neubau und Rückbau entstehen über Baujahr bzw. Abrissjahr im Gebäude-Tab.',
  },
  waerme: {
    kapitel: '3.3.2 Zusatzbedarf aus Wärmekonzept',
    titel: 'Zusatzbedarf aus dem Wärmekonzept', tabTitel: 'Elektrische Wärmeerzeuger',
    zubau: 'Zubau', summe: 'inkl. Wärmekonzept', einheit: ['Anlage', 'Anlagen'],
    herkunft: 'Wärmepumpen (Luft, Erdwärme, Fließgewässer), Elektrokessel und elektrische Warmwasserbereitung mit Baujahr '
            + 'nach dem Messjahr; gezählt wird die elektrische Leistungsaufnahme, nicht die Heizleistung.',
    leer: 'Keine elektrischen Wärmeerzeuger geplant — Wärmepumpen im Elektro-Tab mit Baujahr nach dem Messjahr anlegen.',
  },
  lade: {
    kapitel: '3.3.3 Zusatzbedarf Ladeinfrastruktur',
    titel: 'Zusatzbedarf Ladeinfrastruktur', tabTitel: 'Ladeinfrastruktur',
    zubau: 'Zubau', summe: 'inkl. Ladeinfrastruktur', einheit: ['Standort', 'Standorte'],
    herkunft: 'Ladepunkte (Assets Lade) mit Baujahr nach dem Messjahr: Normalladepunkte × Leistung je Punkt × '
            + 'Gleichzeitigkeitsfaktor des Ladeparks, Schnellladepunkte mit voller Leistung.',
    leer: 'Keine Ladeinfrastruktur geplant — Ladepunkte im Elektro-Tab mit Baujahr nach dem Messjahr anlegen.',
  },
};

const GG_BEDARF_TYP = {
  WP: 'Luft-Wärmepumpe', Geo: 'Erdwärmepumpe', FG: 'Fließgewässer-Wärmepumpe', Stromkessel: 'Elektrokessel',
  TWW: 'Warmwasserbereitung', Lade: 'Ladepunkte', Verbraucher: 'Verbraucher',
};

/** Stand aus der NAP-Analyse holen und in Stufen rechnen. */
function ggBedarfRechnung() {
  if (typeof window.napBedarfsStand !== 'function') return { fehler: '⚠ NAP-Analyse nicht geladen.' };
  const st = window.napBedarfsStand();
  return { st, r: bpStufen({ basisKw: st.basisKw, gzf: st.gzf, massnahmen: st.massnahmen }) };
}

const ggKwDelta = kw => (kw < 0 ? '−' : '+') + ggNum(Math.abs(kw)) + ' kW';
const ggMassnahmeJahr = m => (m.isAbbruch ? m.abrissjahr : m.baujahr);

/** Anzahl betroffener Objekte: Gebäude zählen je Gebäude, Anlagen je Asset. */
function ggBedarfZahl(stufeKey, eintraege) {
  return stufeKey === 'gebaeude'
    ? new Set(eintraege.map(e => e.m.buildingId ?? 'asset:' + (e.m.assetId || e.m.id))).size
    : eintraege.length;
}
function ggBedarfAnzahl(stufeKey, eintraege) {
  const [eins, viele] = GG_BEDARF_TEXTE[stufeKey].einheit;
  const n = ggBedarfZahl(stufeKey, eintraege);
  return `${n} ${n === 1 ? eins : viele}`;
}

const ggGebLabel   = g => String(g?.gebaeudenummer || g?.name || '').trim();
const ggGebNutzung = g => (g ? window.getNutzungstypById?.(g.nutzung)?.label || '' : '');
const ggBedarfAsset = m => (window.ASSETS?.items || []).find(a => a.id === (m.assetId || m.id)) || null;
/** Zahl als Platzhalter — bleibt gelb, solange der Wert fehlt. */
const ggBedarfFeld = (wert, name, dez = 0) => ggTextFeld(wert != null && isFinite(wert) ? ggNum(wert, dez) : '', name);

/**
 * Einträge einer Stufe als Zeilen für Tabelle und Text: mehrere Verbraucher eines Gebäudes mit
 * gleicher Maßnahme und gleichem Jahr werden eine Zeile, Anlagen bleiben einzeln.
 * Rückbau vor Zubau, darin nach Jahr und Name.
 */
function ggBedarfGruppen(key, stufe) {
  const gebListe = window.gebaeude || [];
  const gruppen = new Map();
  for (const e of stufe.eintraege) {
    const m = e.m, jahr = ggMassnahmeJahr(m);
    const k = (key === 'gebaeude' && m.buildingId != null) ? `g:${m.buildingId}|${m.isAbbruch}|${jahr}` : `a:${m.id}`;
    const z = gruppen.get(k)
      || { m, jahr, kw: 0, g: m.buildingId == null ? null : gebListe.find(g => g.id === m.buildingId) || null };
    z.kw += e.kw;
    gruppen.set(k, z);
  }
  return [...gruppen.values()].sort((a, b) =>
    ((b.m.isAbbruch ? 1 : 0) - (a.m.isAbbruch ? 1 : 0)) || ((a.jahr || 0) - (b.jahr || 0))
    || String(a.m.name).localeCompare(String(b.m.name), 'de', { numeric: true }));
}

/** Aufzählung im Fließtext — ab sieben Einträgen nur die ersten fünf, der Rest steht in der Tabelle. */
function ggBedarfListe(teile) {
  return ggAufzaehlung(teile.length <= 6 ? teile : [...teile.slice(0, 5), `${teile.length - 5} weitere (vgl. Tabelle)`]);
}

/** „um 145 kW beziehungsweise 14 %“ — Veränderung einer Stufe gegenüber ihrem Ausgangswert. */
function ggBedarfDelta(s) {
  const d = s.endKw - s.startKw;
  return `um ${ggBedarfFeld(Math.abs(d), 'Veränderung kW')} kW`
    + (s.startKw > 0 ? ` beziehungsweise ${ggBedarfFeld(Math.abs(d) / s.startKw * 100, 'Veränderung %')} %` : '');
}

/* ── Gutachtentexte 3.3.1–3.3.3 ─────────────────────────────────────────────
 * Zahlen aus derselben Rechnung wie Wasserfall und Tabelle (ggBedarfRechnung). Gelbe
 * Platzhalter sind Angaben, die das Tool nicht erfasst — sie werden in Word ergänzt.
 * Verweise relativ („folgende Abbildung“), weil Textbausteine keine Abbildungsnummern kennen. */

/** 3.3.1 — Messbasis, Planungsgrundlage, Rückbau und Neubau. */
function ggRenderBedarfGebaeudeText(cfg, T = GG_THEME) {
  void cfg;
  const { st, r } = ggBedarfRechnung();
  const s = r?.stufen[0];
  const zj = r?.zieljahr ?? null;
  const zeilen = s ? ggBedarfGruppen('gebaeude', s) : [];
  const rueck = zeilen.filter(z => z.m.isAbbruch), neu = zeilen.filter(z => !z.m.isAbbruch);
  const basis = st?.basisKw > 0 ? st.basisKw : null;
  const planung = ggTextFeld('', 'Planungsgrundlage bauliche Entwicklung, z. B. Liegenschaftsentwicklungsplan mit Stand');
  const gebTeil = z => {
    const nr = String(z.g?.gebaeudenummer || '').trim();
    const details = [ggGebNutzung(z.g), z.jahr].filter(Boolean).join(', ');
    return gEsc(nr ? `Gebäude ${nr}` : (z.g?.name || z.m.name)) + (details ? ` (${gEsc(details)})` : '');
  };
  const absaetze = [];

  absaetze.push(`Ausgangspunkt der Bedarfsprognose ist der ${st && !st.gemessen && basis ? 'synthetisch ermittelte' : 'gemessene'} `
    + `Leistungsbedarf der Liegenschaft. Die Höchstlast im Jahr ${ggTextFeld(st?.dataYear, 'Messjahr')} beträgt `
    + `${ggBedarfFeld(basis, 'Höchstlast Bestand')} kW (vgl. Kapitel 3.2). Sie enthält den heutigen Gebäudebestand `
    + `mit allen tatsächlich auftretenden Gleichzeitigkeiten.`);

  if (!zeilen.length) {
    absaetze.push(`Nach ${planung} sind keine Neu- oder Rückbauten mit Einfluss auf den Strombedarf vorgesehen. `
      + `Der Leistungsbedarf der Gebäude entspricht damit dem Bestand von ${ggBedarfFeld(basis, 'Höchstlast Bestand')} kW.`);
  } else {
    absaetze.push(`Darauf aufbauend wird die bauliche Entwicklung bis zum Jahr ${ggTextFeld(zj, 'Zieljahr')} berücksichtigt. `
      + `Grundlage ist ${planung}. Neubauten erhöhen und Rückbauten verringern den Leistungsbedarf jeweils um die `
      + `Anschlussleistung der betroffenen Gebäude, bewertet mit einem Gleichzeitigkeitsfaktor von `
      + `${ggBedarfFeld(st?.gzf, 'Gleichzeitigkeitsfaktor', 2)}.`);

    const rueckE = s.eintraege.filter(e => e.m.isAbbruch), neuE = s.eintraege.filter(e => !e.m.isAbbruch);
    absaetze.push(rueck.length
      ? `Zurückgebaut ${ggBedarfZahl('gebaeude', rueckE) === 1 ? 'wird' : 'werden'} ${ggBedarfAnzahl('gebaeude', rueckE)}: `
        + `${ggBedarfListe(rueck.map(gebTeil))}. Dadurch verringert sich der Leistungsbedarf um `
        + `${ggBedarfFeld(-s.rueckbauKw, 'Rückbau kW')} kW.`
      : 'Ein Rückbau von Gebäuden ist nicht vorgesehen.');
    absaetze.push(neu.length
      ? `Neu errichtet ${ggBedarfZahl('gebaeude', neuE) === 1 ? 'wird' : 'werden'} ${ggBedarfAnzahl('gebaeude', neuE)}: `
        + `${ggBedarfListe(neu.map(gebTeil))}. Damit steigt der Leistungsbedarf um ${ggBedarfFeld(s.zubauKw, 'Neubau kW')} kW. `
        + `Die Anschlussleistungen der Neubauten beruhen auf `
        + `${ggTextFeld('', 'Herkunft der Neubau-Leistungen, z. B. ES-Bau oder Kennwertansatz')}.`
      : 'Neubauten sind nicht vorgesehen.');

    const d = s.endKw - s.startKw;
    absaetze.push(`Für das Jahr ${ggTextFeld(zj, 'Zieljahr')} ergibt sich ein Leistungsbedarf der Gebäude von `
      + `${ggBedarfFeld(s.endKw, 'Gebäudebedarf')} kW. `
      + (Math.abs(d) < 0.5
        ? 'Gegenüber dem Bestand bleibt er damit praktisch unverändert. '
        : `Gegenüber dem Bestand ${d > 0 ? 'steigt' : 'sinkt'} er ${ggBedarfDelta(s)}. `)
      + 'Die folgende Abbildung zeigt die Leistungsbilanz, die anschließende Tabelle die einzelnen Maßnahmen.');
  }

  absaetze.push('Der zusätzliche Strombedarf aus dem Wärmekonzept und aus der Ladeinfrastruktur wird in den Kapiteln '
    + '3.3.2 und 3.3.3 gesondert ausgewiesen und in Kapitel 3.3.4 zur resultierenden Anschlussleistung zusammengeführt.');
  return ggTextBlatt(absaetze, T);
}

/** 3.3.2 — elektrische Wärmeerzeuger der aktiven Variante. */
function ggRenderBedarfWaermeText(cfg, T = GG_THEME) {
  void cfg;
  const { st, r } = ggBedarfRechnung();
  const s = r?.stufen[1];
  const zj = r?.zieljahr ?? null;
  const zeilen = s ? ggBedarfGruppen('waerme', s) : [];
  const rueck = zeilen.filter(z => z.m.isAbbruch), neu = zeilen.filter(z => !z.m.isAbbruch);
  const vid = window.activeVariantId;
  const variante = ggTextFeld(vid ? (window.varianten || []).find(v => v.id === vid)?.name || '' : '', 'Variante Wärmekonzept');
  const teil = z => `${gEsc(z.m.name)} (${gEsc(GG_BEDARF_TYP[z.m.type] || z.m.type)}, `
    + `${ggBedarfFeld(z.m.loadKW, 'el. Leistung')} kW elektrisch, ${z.jahr})`;
  const absaetze = [];

  if (!zeilen.length) {
    absaetze.push(`Das Wärmekonzept (vgl. Kapitel 2) sieht in der Variante ${variante} keine zusätzlichen elektrischen `
      + `Wärmeerzeuger vor. Ein Zusatzbedarf entsteht nicht; der Leistungsbedarf bleibt bei `
      + `${ggBedarfFeld(s?.startKw, 'Übertrag aus 3.3.1')} kW.`);
  } else {
    absaetze.push(`Mit der Umstellung der Wärmeversorgung (vgl. Kapitel 2) kommen elektrische Wärmeerzeuger hinzu. `
      + `Zugrunde gelegt ist die Variante ${variante}. Maßgeblich für den Strombedarf ist die elektrische `
      + `Leistungsaufnahme der Anlagen, nicht ihre Heizleistung.`);

    const saetze = [];
    if (neu.length) {
      saetze.push(`Bis zum Jahr ${ggTextFeld(zj, 'Zieljahr')} ${neu.length === 1 ? 'wird' : 'werden'} `
        + `${ggBedarfAnzahl('waerme', s.eintraege.filter(e => !e.m.isAbbruch))} errichtet: ${ggBedarfListe(neu.map(teil))}.`);
    }
    if (rueck.length) {
      saetze.push(`Außer Betrieb ${rueck.length === 1 ? 'geht' : 'gehen'} ${ggBedarfListe(rueck.map(teil))}.`);
    }
    absaetze.push(saetze.join(' '));

    const d = s.endKw - s.startKw;
    absaetze.push('Die Wärmeerzeuger gehen ohne Gleichzeitigkeitsfaktor ein, da sie bei Normaußentemperatur gemeinsam mit '
      + `voller Leistung laufen. Der Leistungsbedarf ${d >= 0 ? 'steigt' : 'sinkt'} dadurch ${ggBedarfDelta(s)}, von `
      + `${ggBedarfFeld(s.startKw, 'Übertrag aus 3.3.1')} kW auf ${ggBedarfFeld(s.endKw, 'Leistung inkl. Wärmekonzept')} kW. `
      + 'Die folgende Abbildung zeigt die Leistungsbilanz, die anschließende Tabelle die einzelnen Anlagen.');
  }
  return ggTextBlatt(absaetze, T);
}

/** 3.3.3 — Ladepunkte, installierte Leistung, Gleichzeitigkeit. */
function ggRenderBedarfLadeText(cfg, T = GG_THEME) {
  void cfg;
  const { st, r } = ggBedarfRechnung();
  const s = r?.stufen[2];
  const zj = r?.zieljahr ?? null;
  const zeilen = s ? ggBedarfGruppen('lade', s) : [];
  const rueck = zeilen.filter(z => z.m.isAbbruch);
  const parks = zeilen.filter(z => !z.m.isAbbruch).map(z => ({ z, l: bpLadeLeistung(ggBedarfAsset(z.m)?.props) }));
  const grundlage = ggTextFeld('', 'Grundlage der Bedarfsermittlung, z. B. Fuhrparkkonzept oder Stellplatzplanung');
  const absaetze = [];

  if (!zeilen.length) {
    absaetze.push(`Nach ${grundlage} ist kein Aufbau von Ladeinfrastruktur vorgesehen. Ein Zusatzbedarf entsteht nicht; `
      + `der Leistungsbedarf bleibt bei ${ggBedarfFeld(s?.startKw, 'Übertrag aus 3.3.2')} kW.`);
  } else {
    absaetze.push(`Für die Elektromobilität auf der Liegenschaft ist der Aufbau von Ladeinfrastruktur vorgesehen. `
      + `Grundlage der Bedarfsermittlung ist ${grundlage}.`);

    const saetze = [];
    if (parks.length) {
      const punkte  = parks.reduce((a, p) => a + p.l.punkte, 0);
      const schnell = parks.reduce((a, p) => a + p.l.schnell, 0);
      const installiert = parks.reduce((a, p) => a + p.l.punkte * p.l.kwProPunkt + p.l.schnell * p.l.kwSchnell, 0);
      const teil = ({ z, l }) => `${gEsc(z.m.name)} (${l.punkte} × ${ggNum(l.kwProPunkt)} kW`
        + (l.schnell ? ` und ${l.schnell} × ${ggNum(l.kwSchnell)} kW` : '') + `, ${z.jahr})`;
      saetze.push(`Bis zum Jahr ${ggTextFeld(zj, 'Zieljahr')} ${parks.length === 1 ? 'ist' : 'sind'} `
        + `${ggBedarfAnzahl('lade', parks.map(p => ({ m: p.z.m })))} mit insgesamt `
        + `${ggBedarfFeld(punkte, 'Normalladepunkte')} ${punkte === 1 ? 'Normalladepunkt' : 'Normalladepunkten'}`
        + (schnell ? ` und ${ggBedarfFeld(schnell, 'Schnellladepunkte')} ${schnell === 1 ? 'Schnellladepunkt' : 'Schnellladepunkten'}` : '')
        + ` geplant: ${ggBedarfListe(parks.map(teil))}. Die installierte Ladeleistung beträgt `
        + `${ggBedarfFeld(installiert, 'installierte Ladeleistung')} kW.`);

      const gzfs = parks.map(p => p.l.gzf);
      const lo = Math.min(...gzfs), hi = Math.max(...gzfs);
      const spanne = lo === hi ? ggNum(lo, 2) : `${ggNum(lo, 2)} bis ${ggNum(hi, 2)}`;
      saetze.push(`Da nicht alle Fahrzeuge gleichzeitig mit voller Leistung laden, wird die Leistung der `
        + `Normalladepunkte je Standort mit einem Gleichzeitigkeitsfaktor von ${ggTextFeld(spanne, 'GZF Ladepark')} bewertet`
        + (schnell ? '; Schnellladepunkte gehen mit voller Leistung ein.' : '.'));
    }
    if (rueck.length) {
      saetze.push(`Zurückgebaut ${rueck.length === 1 ? 'wird' : 'werden'} `
        + `${ggBedarfListe(rueck.map(z => `${gEsc(z.m.name)} (${z.jahr})`))}.`);
    }
    absaetze.push(saetze.join(' '));

    const d = s.endKw - s.startKw;
    absaetze.push('Ein weiterer Gleichzeitigkeitsfaktor wird auf die Ladeinfrastruktur nicht angesetzt, da die Gleichzeitigkeit '
      + `der Ladevorgänge bereits im Faktor des Ladeparks enthalten ist. Der Leistungsbedarf ${d >= 0 ? 'steigt' : 'sinkt'} damit `
      + `${ggBedarfDelta(s)}, von ${ggBedarfFeld(s.startKw, 'Übertrag aus 3.3.2')} kW auf `
      + `${ggBedarfFeld(s.endKw, 'Leistung inkl. Ladeinfrastruktur')} kW. Ein gesteuertes Laden kann die gleichzeitig `
      + 'abgerufene Leistung weiter begrenzen; es wird bei der Variantenbildung betrachtet. Die folgende Abbildung zeigt '
      + 'die Leistungsbilanz, die anschließende Tabelle die einzelnen Standorte.');
  }

  absaetze.push('Die resultierende Anschlussleistung und die Einspeiseleistung geplanter Erzeugungsanlagen werden in Kapitel 3.3.4 zusammengeführt.');
  return ggTextBlatt(absaetze, T);
}

/** Einzelansicht der Textbausteine: woher die Zahlen kommen und was noch fehlt. */
function ggBedarfStandHtml(key) {
  const { fehler, st, r } = ggBedarfRechnung();
  if (fehler) return `<div style="font-size:11px;color:#e0a126;">${gEsc(fehler)}</div>`;
  const gesamt = key === 'resultierend';   // 3.3.4 fasst alle Stufen zusammen
  const stufe = gesamt ? null : r.stufen.find(s => s.key === key);
  const typen = gesamt ? BP_STUFEN.flatMap(s => s.typen) : BP_STUFEN.find(s => s.key === key)?.typen || [];
  // Geplante Anlagen ohne Baujahr nach dem Messjahr zählen weder in der NAP-Analyse noch hier
  const ungezaehlt = (window.ASSETS?.items || []).filter(a => typen.includes(a.type)
    && (a.schicht === 'entwicklung' || a.schicht === 'entscheidung') && !(parseInt(a.baujahr) > st.dataYear)).length;
  const zeile = (label, wert) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;font-size:11px;line-height:1.6;">
      <span style="color:var(--muted);">${gEsc(label)}</span><span>${wert}</span></div>`;

  let html = zeile('Bestand (Höchstlast)', st.basisKw > 0
      ? `${ggNum(st.basisKw)} kW · ${st.gemessen ? 'Messung' : 'synthetisch'} ${st.dataYear}`
      : '<span style="color:#e0a126;">keine Strommessung — ⚡ Strom-Grundlagen</span>')
    + zeile('Gleichzeitigkeitsfaktor', `${ggNum(st.gzf, 2)} · nur Gebäude (Wärme voll, Lade mit eigenem GZF)`)
    + zeile('Zieljahr', r.zieljahr ?? '—')
    + zeile(gesamt ? 'Maßnahmen gesamt' : 'Maßnahmen dieser Stufe',
      `${gesamt ? r.stufen.reduce((n, s) => n + s.eintraege.length, 0) + r.sonstige.eintraege.length : stufe.eintraege.length}`
      + (r.abgewaehlt ? ` · ${r.abgewaehlt} in der NAP-Analyse abgewählt` : ''));
  if (gesamt) {
    const cap = ggPositiv(window.elNapMaxBezugKw), zusage = ggPositiv(window.elNapMaxEinspKw);
    const fehlt = t => `<span style="color:#e0a126;">${gEsc(t)}</span>`;
    const lg = typeof window.napEndausbauKennzahlen === 'function' ? window.napEndausbauKennzahlen() : null;
    html += zeile('Resultierende Anschlussleistung', `${ggNum(r.endKw)} kW`)
      + zeile('Vereinbarte Anschlussleistung', cap ? `${ggNum(cap)} kVA` : fehlt('fehlt — ⚡ Strom-Grundlagen › NAP-Grenzen „Max. Bezug“'))
      + zeile('Einspeiseleistung Zubau', `${ggNum(r.einspeisung.kw)} kW`)
      + zeile('Einspeisezusage', zusage ? `${ggNum(zusage)} kW` : fehlt('fehlt — ⚡ Strom-Grundlagen › NAP-Grenzen „Max. Einspeisung“'))
      + zeile('Endausbau-Lastgang', lg ? `${ggNum(lg.bezugMaxKw)} kW Höchstlast ${lg.zieljahr} (nur Vergleich)` : '—');
  }
  if (ungezaehlt) {
    html += `<div style="font-size:10px;color:#e0a126;margin-top:6px;line-height:1.5;">⚠ ${ungezaehlt} geplante `
      + `${ungezaehlt === 1 ? 'Anlage' : 'Anlagen'} dieser Stufe ohne Baujahr nach dem Messjahr — zählen nicht als Zubau. `
      + `Baujahr im Elektro-Tab bzw. Gebäude-Tab setzen.</div>`;
  }
  return html
    + `<button data-click="ggBedarfNapOeffnen()" style="margin-top:10px;font-size:11px;padding:5px 10px;border-radius:5px;cursor:pointer;border:1px solid rgba(38,166,154,.45);background:rgba(38,166,154,.08);color:#80cbc4;">⚡ NAP-Analyse öffnen</button>`
    + `<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Zahlen wie Abbildung und Tabelle `
    + `dieses Kapitels. Gelbe Platzhalter (Planungsgrundlagen) erfasst das Tool nicht — in Word ergänzen.</div>`;
}

export function ggBedarfNapOeffnen() {
  if (typeof window.setViewMode === 'function') window.setViewMode('analyse');
  setTimeout(() => window.setAnalyseSection?.('nap'), 60);
}

const GG_BEDARF_TEXT_RENDER = {
  gebaeude: ggRenderBedarfGebaeudeText, waerme: ggRenderBedarfWaermeText, lade: ggRenderBedarfLadeText,
};
const GG_BEDARF_TEXT_HINWEIS = {
  gebaeude: 'Einleitung zu 3.3.1: Messbasis, Planungsgrundlage, Rückbau und Neubau mit ihrer Wirkung auf die Leistung. '
          + 'Planungsgrundlage und Herkunft der Neubau-Leistungen erfasst das Tool nicht — sie bleiben als Platzhalter offen.',
  waerme:   'Einleitung zu 3.3.2: elektrische Wärmeerzeuger der aktiven Variante und ihr Zusatzbedarf. Der Variantenname '
          + 'kommt aus der Kopfleiste; in den Basisdaten bleibt er als Platzhalter offen.',
  lade:     'Einleitung zu 3.3.3: Standorte, Ladepunkte, installierte Leistung, Gleichzeitigkeit und Zusatzbedarf. '
          + 'Die Grundlage der Bedarfsermittlung erfasst das Tool nicht — sie bleibt als Platzhalter offen.',
};

function ggBedarfFiguren() {
  return Object.keys(GG_BEDARF_TEXTE).flatMap((key, idx) => {
    const K = GG_BEDARF_TEXTE[key];
    const quelleHinweis = ' Rechnet exakt wie die Lastentwicklung der NAP-Analyse: Auswahl der Maßnahmen und '
                        + 'Gleichzeitigkeitsfaktor werden dort eingestellt, Zieljahr ist das späteste angehakte Maßnahmenjahr.';
    return [
      {
        id: `bedarf-${key}-text`,
        istText: true,
        bedarfText: key,
        reihe: 5,
        kapitel: K.kapitel,
        titel: `Gutachtentext: ${K.titel}`,
        datei: `bedarf-${key}-text`,
        hinweis: GG_BEDARF_TEXT_HINWEIS[key],
        render: cfg => GG_BEDARF_TEXT_RENDER[key](cfg),
        config: {},
      },
      {
        id: `bedarf-${key}-wasserfall`,
        autoSync: true,
        reihe: 10,
        kapitel: K.kapitel,
        titel: `Leistungsbilanz: ${K.titel}`,
        datei: `bedarf-${key}-wasserfall`,
        hinweis: K.herkunft + quelleHinweis
               + (idx < 2 ? ' Grau gestrichelt: Zusatzbedarf der folgenden Kapitel.' : ''),
        render: cfg => ggRenderWasserfall(cfg),
        config: {
          eyebrow: 'Elektrotechnisches Gutachten',
          titel: K.titel,
          ort: '',
          meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
          achseY: 'Leistung in kW',
          achseX: '',
          leer: 'Keine Leistungsdaten — Strommessung unter ⚡ Strom-Grundlagen laden.',
          balken: [], kpiLinks: [], kpiRechts: [],
        },
        ausProjekt(cfg) {
          cfg.ort = cfg.ort || ggLiegenschaft();
          cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
          ggMetaDefaults(cfg, 'pdBearbeiterStrom');

          const { fehler, st, r } = ggBedarfRechnung();
          if (fehler) { cfg.balken = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return fehler; }

          const stufe = r.stufen[idx];
          const vorige = r.stufen[idx - 1];
          const zj = r.zieljahr;
          const rueck = stufe.eintraege.filter(e => e.m.isAbbruch);
          const zu    = stufe.eintraege.filter(e => !e.m.isAbbruch);

          const b = [idx === 0
            ? { label: 'Bestand', sub: `${st.gemessen ? 'Messung' : 'synthetisch'} ${st.dataYear}`, wert: st.basisKw, art: 'basis' }
            : { label: 'Übertrag', sub: `aus ${vorige.kapitel}`, wert: stufe.startKw, art: 'basis' }];
          if (rueck.length) b.push({ label: 'Rückbau', sub: ggBedarfAnzahl(key, rueck), wert: stufe.rueckbauKw, art: 'delta' });
          if (zu.length)    b.push({ label: K.zubau,   sub: ggBedarfAnzahl(key, zu),    wert: stufe.zubauKw,    art: 'delta' });
          b.push({ label: K.summe, sub: zj ? `Stand ${zj}` : 'ohne Maßnahmen', wert: stufe.endKw, art: 'summe' });
          for (const spaeter of r.stufen.slice(idx + 1)) {
            if (!spaeter.eintraege.length) continue;
            b.push({ label: spaeter.label, sub: `→ ${spaeter.kapitel}`, wert: spaeter.rueckbauKw + spaeter.zubauKw, art: 'ausblick' });
          }
          cfg.balken = b;

          const delta = stufe.endKw - stufe.startKw;
          cfg.kpiLinks = [
            { wert: ggNum(stufe.startKw) + ' kW',
              label: idx === 0 ? `Höchstlast Bestand ${st.dataYear}` : `Übertrag aus ${vorige.kapitel}` },
            { prozent: stufe.startKw > 0 ? (delta > 0 ? '+' : '') + ggNum(delta / stufe.startKw * 100) + ' %' : undefined,
              wert: ggKwDelta(delta), label: zj ? `Veränderung bis ${zj}` : 'Veränderung' },
          ];
          cfg.kpiRechts = [
            key === 'gebaeude'
              ? { wert: ggNum(st.gzf, 2), label: 'Gleichzeitigkeitsfaktor' }
              : { wert: key === 'lade' ? 'je Ladepark' : ggNum(1, 2), label: 'Gleichzeitigkeitsfaktor' },
            { wert: ggNum(stufe.endKw) + ' kW', label: `${K.summe}${zj ? ' ' + zj : ''}`, highlight: true },
          ];

          if (idx === 0 && !(st.basisKw > 0)) {
            return '⚠ Keine Strommessung geladen (⚡ Strom-Grundlagen) — der Bestand steht auf 0 kW.';
          }
          return stufe.eintraege.length
            ? `✓ ${stufe.eintraege.length} Maßnahmen bis ${zj} aus der NAP-Analyse übernommen`
              + (key === 'gebaeude' ? ` (GZF ${ggNum(st.gzf, 2)}).` : ' (ohne globalen GZF).')
            : '✓ In dieser Stufe sind keine Maßnahmen erfasst.';
        },
      },
      {
        id: `bedarf-${key}-tabelle`,
        autoSync: true,
        reihe: 20,
        kapitel: K.kapitel,
        titel: K.tabTitel,
        datei: `bedarf-${key}-tabelle`,
        hinweis: 'Einzelaufstellung zur Leistungsbilanz darüber. ' + K.herkunft + quelleHinweis,
        render: cfg => ggRenderTabelle(cfg),
        config: {
          eyebrow: 'Elektrotechnisches Gutachten',
          titel: K.tabTitel,
          leer: K.leer,
          spalten: key === 'gebaeude'
            ? [{ label: 'Gebäude', weight: 1.6, align: 'left', mono: false },
               { label: 'Nutzung', weight: 1.8, align: 'left', mono: false },
               { label: 'Maßnahme', weight: 1.1, align: 'left', mono: false },
               { label: 'Jahr', weight: 0.8 },
               { label: 'Leistung', weight: 1.1 }]
            : [{ label: 'Anlage', weight: 1.6, align: 'left', mono: false },
               { label: 'Art', weight: 1.5, align: 'left', mono: false },
               { label: 'Gebäude', weight: 1.3, align: 'left', mono: false },
               { label: 'Maßnahme', weight: 1.1, align: 'left', mono: false },
               { label: 'Jahr', weight: 0.8 },
               { label: 'Leistung', weight: 1.1 }],
          zeilen: [], fussnote: '',
        },
        ausProjekt(cfg) {
          const { fehler, st, r } = ggBedarfRechnung();
          if (fehler) { cfg.zeilen = []; cfg.fussnote = ''; return fehler; }
          const stufe = r.stufen[idx];
          const nSp = cfg.spalten.length;

          // Gleiche Gruppierung wie im Gutachtentext des Kapitels
          const zeilen = ggBedarfGruppen(key, stufe);
          if (!zeilen.length) { cfg.zeilen = []; cfg.fussnote = ''; return '✓ ' + K.leer; }

          const massnahme = m => (m.isAbbruch ? 'Rückbau' : K.zubau);
          cfg.zeilen = zeilen.map(z => {
            const g = z.g;
            let werte;
            if (key === 'gebaeude') {
              werte = [ggGebLabel(g) || z.m.name, ggGebNutzung(g) || '—', massnahme(z.m), z.jahr || '—', ggKwDelta(z.kw)];
            } else {
              let art = GG_BEDARF_TYP[z.m.type] || z.m.type;
              if (z.m.type === 'Lade') {
                const l = bpLadeLeistung(ggBedarfAsset(z.m)?.props);
                art = `${l.punkte} × ${ggNum(l.kwProPunkt)} kW · GZF ${ggNum(l.gzf, 2)}`
                    + (l.schnell ? ` + ${l.schnell} × ${ggNum(l.kwSchnell)} kW` : '');
              }
              werte = [z.m.name, art, ggGebLabel(g) || '—', massnahme(z.m), z.jahr || '—', ggKwDelta(z.kw)];
            }
            return { werte, akzent: z.kw < 0 ? GG_THEME.energy.waerme : GG_THEME.accents.gruen };
          });

          // Summenzeilen: leere Zwischenspalten als Leerzeichen, sonst zeichnet die Tabelle „—"
          const summenZeile = (label, kw) => ({ werte: [label, ...Array(nSp - 2).fill(' '), ggKwDelta(kw)], highlight: true });
          const hatRueck = stufe.eintraege.some(e => e.m.isAbbruch);
          const hatZu    = stufe.eintraege.some(e => !e.m.isAbbruch);
          if (hatRueck && hatZu) {
            cfg.zeilen.push(summenZeile('Summe Rückbau', stufe.rueckbauKw), summenZeile(`Summe ${K.zubau}`, stufe.zubauKw));
          }
          cfg.zeilen.push(summenZeile(`Veränderung bis ${r.zieljahr}`, stufe.rueckbauKw + stufe.zubauKw));

          // Globaler GZF nur auf Gebäude (bpGzfFuer): Wärmeerzeuger laufen gemeinsam, Ladeparks haben ihren eigenen
          cfg.fussnote = (key === 'lade' ? 'Leistung = Ladeleistung inkl. GZF des Ladeparks'
            : key === 'waerme' ? 'Leistung = elektrische Leistungsaufnahme, ohne Gleichzeitigkeitsfaktor'
              : `Leistung = Anschlussleistung × Gleichzeitigkeitsfaktor ${ggNum(st.gzf, 2)}`)
                       + ' · Maßnahmenauswahl wie in der NAP-Analyse'
                       + (r.abgewaehlt ? ` · dort ${r.abgewaehlt} Maßnahmen abgewählt` : '');
          return `✓ ${zeilen.length} Einträge bis ${r.zieljahr} aus der NAP-Analyse übernommen.`;
        },
      },
    ];
  });
}
GG_FIGUREN.push(...ggBedarfFiguren());

/* ── 3.3.4 Resultierende Anschlussleistung und Lastgang ────────────────────────
 * Zusammenführung der Stufen 3.3.1–3.3.3 (statisch, maßgeblich) und Abgleich mit der vereinbarten
 * Anschlussleistung. Geplante Erzeugung mindert den Bezug nicht und steht als Einspeiseleistung
 * getrennt (lib/bedarfsprognose.js); der zeitgleich überlagerte Endausbau-Lastgang der NAP-Analyse
 * erscheint nur als Vergleichswert im Text. */
const GG_KAP_RESULTIEREND = '3.3.4 Resultierende Anschlussleistung und Lastgang';
const GG_STUFE_WIRKUNG = { gebaeude: 'die bauliche Entwicklung', waerme: 'das Wärmekonzept', lade: 'die Ladeinfrastruktur' };
const ggPositiv = v => (Number(v) > 0 ? Number(v) : null);

/** Erstes Jahr, in dem der Bezug die Anschlussleistung übersteigt — null, wenn nie. */
function ggErsteUeberschreitung(st, r, cap) {
  if (!cap || !st) return null;
  const reihe = bpJahresreihe({ basisKw: st.basisKw, gzf: st.gzf, massnahmen: st.massnahmen,
                                von: st.dataYear, bis: r?.zieljahr ?? st.dataYear });
  return reihe.find(z => z.bezugKw > cap)?.jahr ?? null;
}

function ggRenderBedarfResultierendText(cfg, T = GG_THEME) {
  void cfg;
  const { st, r } = ggBedarfRechnung();
  const zj = r?.zieljahr ?? null;
  const basis = st?.basisKw > 0 ? st.basisKw : null;
  const cap = ggPositiv(window.elNapMaxBezugKw);
  const zusage = ggPositiv(window.elNapMaxEinspKw);
  const stufen = r ? r.stufen.filter(s => s.eintraege.length) : [];
  const sonstige = r?.sonstige.eintraege.length ? r.sonstige : null;
  const absaetze = [];

  absaetze.push('In diesem Kapitel werden die Ergebnisse der Kapitel 3.3.1 bis 3.3.3 zur resultierenden Anschlussleistung der '
    + `Liegenschaft zusammengeführt. Ausgangspunkt ist die ${st && !st.gemessen && basis ? 'synthetisch ermittelte' : 'gemessene'} `
    + `Höchstlast von ${ggBedarfFeld(basis, 'Höchstlast Bestand')} kW im Jahr ${ggTextFeld(st?.dataYear, 'Messjahr')} (vgl. Kapitel 3.2).`);

  if (!stufen.length && !sonstige) {
    absaetze.push('Maßnahmen mit Einfluss auf den Leistungsbedarf sind nicht vorgesehen. Die resultierende Anschlussleistung '
      + `entspricht damit der Höchstlast des Bestands von ${ggBedarfFeld(basis, 'Höchstlast Bestand')} kW.`);
  } else {
    const teile = stufen.map(s => `durch ${GG_STUFE_WIRKUNG[s.key]} um ${ggKwDelta(s.rueckbauKw + s.zubauKw)} (Kapitel ${s.kapitel})`);
    if (sonstige) teile.push(`durch sonstige Verbraucher wie Batteriespeicher im Ladebetrieb um ${ggKwDelta(sonstige.kw)}`);
    const d = r.endKw - (st?.basisKw || 0);
    absaetze.push(`Bis zum Jahr ${ggTextFeld(zj, 'Zieljahr')} ändert sich der Leistungsbedarf ${ggAufzaehlung(teile)}. `
      + `Die bauliche Entwicklung ist mit dem Gleichzeitigkeitsfaktor von ${ggBedarfFeld(st?.gzf, 'Gleichzeitigkeitsfaktor', 2)} bewertet, `
      + 'die Ladeinfrastruktur mit dem Gleichzeitigkeitsfaktor der Ladeparks; Wärmeerzeuger und sonstige Verbraucher gehen mit '
      + 'voller Leistung ein. '
      + `Daraus ergibt sich eine resultierende Anschlussleistung von ${ggBedarfFeld(r.endKw, 'Resultierende Anschlussleistung')} kW`
      + (basis ? ` (${d >= 0 ? '+' : '−'}${ggNum(Math.abs(d) / basis * 100)} % gegenüber dem Bestand)` : '')
      + '. Die folgende Abbildung zeigt ihre Zusammensetzung.');
  }

  const ein = r?.einspeisung;
  if (ein?.kw > 0) {
    absaetze.push('Geplante Erzeugungsanlagen und Batteriespeicher mindern die resultierende Anschlussleistung nicht, da ihre '
      + 'Leistung zum Zeitpunkt der Höchstlast nicht gesichert zur Verfügung steht (z. B. Photovoltaik in den Abendstunden und '
      + `im Winter oder bei Ausfall eines BHKW). Ihre zusätzliche Einspeiseleistung beträgt ${ggBedarfFeld(ein.kw, 'Einspeiseleistung')} kW `
      + '(volle Nennleistung ohne Gleichzeitigkeitsfaktor, da Erzeugungsanlagen wie Photovoltaik zeitgleich einspeisen) und ist '
      + 'gesondert der Einspeisezusage des Netzbetreibers gegenüberzustellen. '
      + (zusage
        ? (ein.kw <= zusage
          ? `Bei einer Einspeisezusage von ${ggNum(zusage)} kW verbleibt eine Reserve von ${ggNum(zusage - ein.kw)} kW.`
          : `Die Einspeisezusage von ${ggNum(zusage)} kW wird um ${ggNum(ein.kw - zusage)} kW überschritten.`)
        : `Die Einspeisezusage beträgt ${ggTextFeld('', 'Einspeisezusage kW')} kW.`));
  }

  if (r && cap) {
    const reserve = cap - r.endKw;
    const erstes = reserve < 0 ? ggErsteUeberschreitung(st, r, cap) : null;
    absaetze.push(`Die vereinbarte Anschlussleistung beträgt ${ggNum(cap)} kVA. Bei einem Leistungsfaktor von näherungsweise 1 `
      + (reserve >= 0
        ? `verbleibt gegenüber der resultierenden Anschlussleistung eine Reserve von ${ggNum(reserve)} kW `
          + `(${ggNum(reserve / cap * 100)} %). `
          // Unter 10 % Reserve ist „nicht erforderlich“ zu optimistisch — jede weitere Maßnahme reicht dann für eine Überschreitung
          + (reserve / cap < 0.1
            ? 'Die Anschlussleistung ist damit weitgehend ausgeschöpft; bei weiteren Maßnahmen ist eine Erhöhung frühzeitig '
              + 'beim Netzbetreiber zu prüfen.'
            : 'Eine Erhöhung der Anschlussleistung ist nach heutigem Planungsstand nicht erforderlich.')
        : `wird sie ${erstes == null ? '' : erstes <= st.dataYear ? 'bereits im Bestand ' : `ab dem Jahr ${erstes} `}überschritten, `
          + `im Jahr ${zj ?? st.dataYear} um ${ggNum(-reserve)} kW. Eine Erhöhung der Anschlussleistung ist beim Netzbetreiber `
          + 'zu beantragen; die Varianten dazu werden in Kapitel 3.4.1 betrachtet.'));
  } else {
    absaetze.push(`Die vereinbarte Anschlussleistung beträgt ${ggTextFeld('', 'Vereinbarte Anschlussleistung kVA')} kVA; gegenüber `
      + `der resultierenden Anschlussleistung ergibt sich ${ggTextFeld('', 'Reserve bzw. Überschreitung kW')} kW.`);
  }

  const lg = stufen.length && typeof window.napEndausbauKennzahlen === 'function' ? window.napEndausbauKennzahlen() : null;
  if (lg && r) {
    const diff = r.endKw - lg.bezugMaxKw;
    absaetze.push(`Ergänzend wurde der gemessene Lastgang des Jahres ${lg.dataYear} zeitgleich mit den Lastprofilen der Maßnahmen `
      + `bis ${lg.zieljahr} überlagert. Die Höchstlast dieses Endausbau-Lastgangs beträgt ${ggNum(lg.bezugMaxKw)} kW`
      + (Math.abs(diff) < 0.5
        ? ' und entspricht damit der statisch ermittelten Anschlussleistung.'
        : diff > 0
          ? ` und liegt ${ggNum(diff)} kW unter der statisch ermittelten Anschlussleistung, weil die Lastspitzen der einzelnen `
            + 'Verbraucher nicht zeitgleich auftreten und die Erzeugung zeitgleich gegengerechnet ist.'
          : ` und liegt ${ggNum(-diff)} kW über der statisch ermittelten Anschlussleistung; die Lastprofile der Maßnahmen sind zu prüfen.`)
      + ' Maßgeblich für die Dimensionierung bleibt der statisch ermittelte Wert.');
  }

  if (!(r && cap && r.endKw > cap)) {
    absaetze.push('Die Auswirkungen auf Netzanschluss und internes Stromnetz werden in Kapitel 3.4.1 betrachtet.');
  }
  return ggTextBlatt(absaetze, T);
}

GG_FIGUREN.push(
  // ── Gutachtentext: Resultierende Anschlussleistung ─────────────────────
  {
    id: 'bedarf-resultierend-text',
    istText: true,
    bedarfText: 'resultierend',
    reihe: 5,
    kapitel: GG_KAP_RESULTIEREND,
    titel: 'Gutachtentext: Resultierende Anschlussleistung',
    datei: 'bedarf-resultierend-text',
    hinweis: 'Zusammenführung von 3.3.1–3.3.3 zur resultierenden Anschlussleistung und Abgleich mit der vereinbarten '
           + 'Anschlussleistung (⚡ Strom-Grundlagen › NAP-Grenzen „Max. Bezug“). Geplante Erzeugung mindert den Bezug nicht; '
           + 'ihre Einspeiseleistung wird der Einspeisezusage („Max. Einspeisung“) gegenübergestellt. Die Höchstlast des '
           + 'überlagerten Endausbau-Lastgangs aus der NAP-Analyse erscheint nur als Vergleichswert.',
    render: cfg => ggRenderBedarfResultierendText(cfg),
    config: {},
  },

  // ── Leistungsbilanz: Resultierende Anschlussleistung ───────────────────
  {
    id: 'bedarf-resultierend-wasserfall',
    autoSync: true,
    reihe: 10,
    kapitel: GG_KAP_RESULTIEREND,
    titel: 'Leistungsbilanz: Resultierende Anschlussleistung',
    datei: 'bedarf-resultierend-wasserfall',
    hinweis: 'Bestand → bauliche Entwicklung → Wärmekonzept → Ladeinfrastruktur → resultierende Anschlussleistung, mit der '
           + 'vereinbarten Anschlussleistung als Grenzlinie. Rechnet exakt wie die Lastentwicklung der NAP-Analyse; '
           + 'Maßnahmenauswahl und Gleichzeitigkeitsfaktor werden dort eingestellt.',
    render: cfg => ggRenderWasserfall(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Resultierende Anschlussleistung',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Leistung in kW',
      achseX: '',
      leer: 'Keine Leistungsdaten — Strommessung unter ⚡ Strom-Grundlagen laden.',
      balken: [], grenzen: [], kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');

      const { fehler, st, r } = ggBedarfRechnung();
      if (fehler) { cfg.balken = []; cfg.grenzen = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return fehler; }

      const zj = r.zieljahr;
      const b = [{ label: 'Bestand', sub: `${st.gemessen ? 'Messung' : 'synthetisch'} ${st.dataYear}`, wert: st.basisKw, art: 'basis' }];
      for (const s of r.stufen) {
        if (s.eintraege.length) b.push({ label: s.label, sub: `Kapitel ${s.kapitel}`, wert: s.rueckbauKw + s.zubauKw, art: 'delta' });
      }
      if (r.sonstige.eintraege.length) b.push({ label: 'Sonstige', sub: 'z. B. Speicher', wert: r.sonstige.kw, art: 'delta' });
      b.push({ label: 'Resultierend', sub: zj ? `Stand ${zj}` : 'ohne Maßnahmen', wert: r.endKw, art: 'summe' });
      cfg.balken = b;

      const cap = ggPositiv(window.elNapMaxBezugKw);
      cfg.grenzen = cap ? [{ wert: cap, label: `Vereinbarte Anschlussleistung ${ggNum(cap)} kVA`, farbe: GG_THEME.energy.waerme }] : [];

      const d = r.endKw - st.basisKw;
      const reserve = cap ? cap - r.endKw : null;
      cfg.kpiLinks = [
        { wert: ggNum(st.basisKw) + ' kW', label: `Höchstlast Bestand ${st.dataYear}` },
        { prozent: st.basisKw > 0 ? (d > 0 ? '+' : '') + ggNum(d / st.basisKw * 100) + ' %' : undefined,
          wert: ggKwDelta(d), label: zj ? `Veränderung bis ${zj}` : 'Veränderung' },
      ];
      cfg.kpiRechts = [
        r.einspeisung.kw > 0
          ? { wert: ggNum(r.einspeisung.kw) + ' kW', label: 'Einspeiseleistung Zubau (getrennt)' }
          : { wert: ggNum(st.gzf, 2), label: 'Gleichzeitigkeitsfaktor' },
        reserve == null
          ? { wert: ggNum(r.endKw) + ' kW', label: 'Resultierende Anschlussleistung', highlight: true }
          : { wert: ggNum(Math.abs(reserve)) + ' kW', label: reserve >= 0 ? 'Reserve zur Anschlussleistung' : 'Überschreitung der Anschlussleistung', highlight: true },
      ];

      if (!(st.basisKw > 0)) return '⚠ Keine Strommessung geladen (⚡ Strom-Grundlagen) — der Bestand steht auf 0 kW.';
      return `✓ Resultierende Anschlussleistung ${ggNum(r.endKw)} kW${zj ? ` (${zj})` : ''}`
           + (cap ? ` gegen ${ggNum(cap)} kVA vereinbarte Anschlussleistung.` : ' — vereinbarte Anschlussleistung fehlt (⚡ Strom-Grundlagen).');
    },
  },
);

/* ── 3.4.1 Netzanschluss und internes Stromnetz (Variantenbildung) ─────────────
 * Netzanschluss: einzige Variante ist die Erhöhung der Anschlussleistung (User-Entscheidung 09/2026),
 * aufbauend auf der resultierenden Anschlussleistung aus 3.3.4. Internes Netz: Ergebnis des
 * Engpass-Sweeps (14h) mit dem Ertüchtigungsvorschlag je Betriebsmittel (window.engpassVorschlag,
 * schreibt nichts). Kosten stehen bewusst erst in 3.5. */
const GG_KAP_NETZ = '3.4.1 Netzanschluss und internes Stromnetz';

function ggRenderNetzanschlussVarianteText(cfg, T = GG_THEME) {
  void cfg;
  const { st, r } = ggBedarfRechnung();
  const cap = ggPositiv(window.elNapMaxBezugKw);
  const zusage = ggPositiv(window.elNapMaxEinspKw);
  const nb = ggTextFeld(String(window.naNetzbetreiberName || '').trim(), 'Name Netzbetreiber');
  const zj = r?.zieljahr ?? null;
  const absaetze = [];

  if (!r || !cap) {
    absaetze.push(`Die resultierende Anschlussleistung von ${ggBedarfFeld(r?.endKw, 'Resultierende Anschlussleistung')} kW `
      + `(vgl. Kapitel 3.3.4) ist der vereinbarten Anschlussleistung von ${ggTextFeld('', 'Vereinbarte Anschlussleistung kVA')} kVA `
      + `gegenüberzustellen. ${ggTextFeld('', 'Ergebnis: Erhöhung erforderlich oder ausreichende Reserve')}.`);
  } else if (r.endKw > cap) {
    const erstes = ggErsteUeberschreitung(st, r, cap);
    const kuenftig = erstes != null && erstes > st.dataYear;
    const endjahr = zj ?? st.dataYear;
    // Fallen erstes Überschreitungsjahr und Zieljahr zusammen, genügt eine Jahresangabe
    const wann = kuenftig
      ? (erstes === endjahr ? `ab dem Jahr ${erstes} ` : `ab dem Jahr ${erstes} und im Jahr ${endjahr} `)
      : erstes != null ? `bereits im Bestand und im Jahr ${endjahr} ` : `im Jahr ${endjahr} `;
    // Variante B nur, wenn die Ladeinfrastruktur überhaupt zur Überschreitung beiträgt
    const rv = ggLadeReserve();
    const mitLade = rv && rv.ladeKw > 0.5;
    absaetze.push(`Die resultierende Anschlussleistung von ${ggNum(r.endKw)} kW übersteigt die vereinbarte Anschlussleistung von `
      + `${ggNum(cap)} kVA ${wann}um ${ggNum(r.endKw - cap)} kW (vgl. Kapitel 3.3.4). `
      + (mitLade
        ? 'Zur Deckung werden zwei Varianten betrachtet: A) die Erhöhung der Anschlussleistung beim Netzbetreiber '
          + `${nb} und B) die Begrenzung der Ladeleistung durch ein Lademanagement.`
        : `Als Variante wird deshalb die Erhöhung der Anschlussleistung beim Netzbetreiber ${nb} betrachtet.`));
    absaetze.push(`${mitLade ? 'Variante A – Erhöhung der Anschlussleistung: ' : ''}`
      + `Bei einem Leistungsfaktor von näherungsweise 1 ist eine Anschlussleistung von mindestens `
      + `${ggNum(Math.ceil(r.endKw))} kVA zu beantragen; unter Berücksichtigung einer Reserve für die weitere Entwicklung der `
      + `Liegenschaft wird eine Anschlussleistung von ${ggTextFeld('', 'beantragte Anschlussleistung inkl. Reserve kVA')} kVA empfohlen. `
      + (kuenftig
        ? `Die erhöhte Leistung muss spätestens im Jahr ${erstes} zur Verfügung stehen; bei einer Bearbeitungs- und Umsetzungszeit `
          + `des Netzbetreibers von ${ggTextFeld('', 'Vorlaufzeit Netzbetreiber, z. B. zwei bis drei Jahre')} ist der Antrag entsprechend frühzeitig zu stellen.`
        : 'Der Antrag ist umgehend zu stellen.'));
    const ebene = String(window.naSpannungsebene || '').trim();
    absaetze.push(/nieder/i.test(ebene)
      ? 'Die Liegenschaft ist heute in der Niederspannung angeschlossen. Ob die erhöhte Leistung dort noch bereitgestellt werden '
        + 'kann oder ein Anschluss an das Mittelspannungsnetz mit eigener Übergabestation erforderlich wird, legt der Netzbetreiber '
        + 'im Rahmen der Antragsprüfung fest.'
      : `Der Anschluss erfolgt auf der Spannungsebene ${ggTextFeld(ebene, 'Spannungsebene Netzanschluss')}. Ob die bestehende `
        + 'Übergabe die erhöhte Leistung aufnehmen kann oder erweitert werden muss, ist mit dem Netzbetreiber abzustimmen.');
    if (mitLade) {
      const pct = v => ggNum(v / rv.ladeKw * 100);
      absaetze.push('Variante B – Lademanagement: Die Ladeinfrastruktur trägt '
        + `${ggNum(rv.ladeKw)} kW zur resultierenden Anschlussleistung bei (vgl. Kapitel 3.3.3). `
        + (rv.verfuegbar >= 0
          ? `Innerhalb der vereinbarten Anschlussleistung stehen für das Laden ${ggNum(rv.verfuegbar)} kW zur Verfügung, das sind `
            + `${pct(rv.verfuegbar)} % der Auslegungsleistung. Begrenzt ein dynamisches Lademanagement die gesamte Ladeleistung auf `
            + 'diesen Wert, ist eine Erhöhung der Anschlussleistung nicht erforderlich.'
            + (rv.verfuegbar / rv.ladeKw < 0.5 ? ' Bei dieser deutlichen Begrenzung ist ein uneingeschränkter Ladebetrieb jedoch nicht gewährleistet.' : '')
          : `Bereits ohne Ladeinfrastruktur übersteigt der Leistungsbedarf von ${ggNum(rv.ohneLade)} kW die vereinbarte `
            + 'Anschlussleistung. Ein Lademanagement kann die Erhöhung deshalb nicht vermeiden, verringert aber die zu beantragende '
            + `Anschlussleistung auf mindestens ${ggNum(Math.ceil(rv.ohneLade))} kVA zuzüglich der für das Laden vorgehaltenen Leistung.`)
        + ' Betriebsweise und Auswirkungen auf den Ladebetrieb beschreibt Kapitel 3.4.4.');
      absaetze.push('Variante A lässt den Ladebetrieb uneingeschränkt, erfordert aber den Antrag beim Netzbetreiber mit '
        + 'Baukostenzuschuss und Vorlaufzeit. Variante B '
        + (rv.verfuegbar >= 0 ? 'kommt ohne Antrag aus' : 'verringert den Antrag')
        + ', begrenzt aber die Ladeleistung und braucht eine Steuerung der Ladepunkte. Die Kosten der Erhöhung stehen in '
        + `Kapitel 3.5; für das Lademanagement sind ${ggTextFeld('', 'Kosten Lademanagement, z. B. laut Herstellerangebot')} anzusetzen. `
        + 'Die Bewertung beider Varianten folgt in Kapitel 3.6.');
    }
  } else {
    const reserve = cap - r.endKw;
    absaetze.push(`Die resultierende Anschlussleistung von ${ggNum(r.endKw)} kW bleibt innerhalb der vereinbarten Anschlussleistung `
      + `von ${ggNum(cap)} kVA (Reserve ${ggNum(reserve)} kW bzw. ${ggNum(reserve / cap * 100)} %, vgl. Kapitel 3.3.4). Eine Erhöhung `
      + 'der Anschlussleistung ist als Variante nicht erforderlich.'
      + (reserve / cap < 0.1 ? ' Wegen der geringen Reserve ist bei weiteren Maßnahmen frühzeitig eine Erhöhung beim Netzbetreiber zu prüfen.' : ''));
  }

  const ein = r?.einspeisung?.kw > 0 ? r.einspeisung.kw : null;
  if (ein) {
    absaetze.push(zusage
      ? (ein > zusage
        ? `Für die geplanten Erzeugungsanlagen ist zusätzlich die Einspeisezusage von ${ggNum(zusage)} kW auf mindestens `
          + `${ggNum(Math.ceil(ein))} kW zu erhöhen; auch dies ist beim Netzbetreiber zu beantragen.`
        : `Die zusätzliche Einspeiseleistung der geplanten Erzeugungsanlagen von ${ggNum(ein)} kW liegt innerhalb der `
          + `Einspeisezusage von ${ggNum(zusage)} kW.`)
      : `Für die geplanten Erzeugungsanlagen mit einer zusätzlichen Einspeiseleistung von ${ggNum(ein)} kW ist die Einspeisezusage `
        + `von ${ggTextFeld('', 'Einspeisezusage kW')} kW zu prüfen.`);
  }
  return ggTextBlatt(absaetze, T);
}

/** Letztes Ergebnis des Engpass-Sweeps; ohne passendes Ergebnis wird er einmal gestartet (wie die Netzmodell-Abbildung). */
function ggEngpassErgebnis() {
  let res = typeof window.engpassLetztesErgebnis === 'function' ? window.engpassLetztesErgebnis() : null;
  if ((!res || !res.proJahr?.length || res.proJahr[0].bezugKw == null) && typeof window.engpassSweep === 'function') {
    try { res = window.engpassSweep(); } catch (e) { void e; res = null; }
  }
  return res?.proJahr?.length ? res : null;
}

/** Engpass-Betriebsmittel mit Einordnung: Bestandsmangel, Vorschlag (ohne Schreiben), MS-Kabel. */
function ggEngpassListe(res) {
  let bestand = new Set();
  try { bestand = new Set((window.engpassBestandsmaengel?.(res) || []).map(b => b.item.id)); } catch (e) { void e; }
  return [...res.trafos, ...res.kabel]
    .filter(x => x.engpassJahr != null)
    .map(item => ({
      item,
      bestand: bestand.has(item.id),
      ms: item.art === 'kabel' && !!item.msLevel,
      v: typeof window.engpassVorschlag === 'function' ? window.engpassVorschlag(item, res) : null,
    }))
    .sort((a, b) => a.item.engpassJahr - b.item.engpassJahr || b.item.maxAuslPct - a.item.maxAuslPct);
}

function ggRenderNetzInternText(cfg, T = GG_THEME) {
  void cfg;
  const res = ggEngpassErgebnis();
  if (!res) {
    return ggTextBlatt([
      'Für das interne Stromnetz liegt kein Netzmodell vor. Die Bewertung der Trafostationen, Niederspannungsverteilungen und '
        + `Kabel stützt sich daher auf ${ggTextFeld('', 'Grundlage, z. B. Ergebnis der Begehung und Bestandsunterlagen')}.`,
      `${ggTextFeld('', 'Ergebnis: erforderliche Ertüchtigungen oder ausreichende Reserven im internen Netz')}.`,
    ], T);
  }

  const g = ENGPASS_GRENZEN;
  const liste = ggEngpassListe(res);
  const entwicklung = liste.filter(e => !e.bestand && !e.ms);
  const bestand = liste.filter(e => e.bestand);
  const ungeloest = liste.filter(e => e.v?.ungeloest && !e.bestand);
  const ms = liste.filter(e => e.ms);
  const nT = res.trafos.length, nK = res.kabel.length;
  const anzahl = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
  const absaetze = [];

  absaetze.push(`Zur Bewertung des internen Stromnetzes wurde das Netzmodell der Liegenschaft mit `
    + `${anzahl(nT, 'Transformator', 'Transformatoren')} und ${anzahl(nK, 'Kabelabschnitt', 'Kabelabschnitten')} für jedes Jahr, in `
    + `dem sich Lasten oder Netz ändern, bis zum Jahr ${res.bis} durchgerechnet. Geplante Verbraucher und Erzeugungsanlagen `
    + `gehen ab ihrem Baujahr ein. Als Engpass gilt eine Auslastung über ${g.trafoPct} % der Trafonennleistung bzw. über `
    + `${g.auslastungPct} % der Strombelastbarkeit eines Kabels oder ein kumulierter Spannungsfall über ${ggNum(g.deltaUKumPct)} %.`);

  if (!liste.length) {
    absaetze.push('Im Betrachtungszeitraum wird keines der Betriebsmittel zum Engpass. Das interne Netz kann die zusätzlichen '
      + 'Lasten ohne Ertüchtigung aufnehmen. Die folgende Abbildung zeigt die Höchstlast des Netzes über den Betrachtungszeitraum.');
    return ggTextBlatt(absaetze, T);
  }

  if (entwicklung.length) {
    const t = entwicklung.filter(e => e.item.art === 'trafo').length, k = entwicklung.length - t;
    const teile = [t ? `${t} von ${nT} Transformatoren` : '', k ? `${k} von ${nK} Kabelabschnitten` : ''].filter(Boolean);
    absaetze.push(`Durch die geplanten Maßnahmen ${entwicklung.length === 1 ? 'wird' : 'werden'} bis zum Jahr ${res.bis} `
      + `${ggAufzaehlung(teile)} zum Engpass, der erste im Jahr ${entwicklung[0].item.engpassJahr}. Die vorgesehene Ertüchtigung `
      + `ist jeweils ${ENGPASS_VORLAUF_J} Jahre vor dem Engpassjahr umzusetzen, damit Planung und Beschaffung rechtzeitig `
      + 'abgeschlossen sind. Ertüchtigt wird auf die höchste Belastung im gesamten Betrachtungszeitraum, damit nicht mehrfach '
      + 'gebaut werden muss.');
  }
  if (bestand.length) {
    absaetze.push(`${anzahl(bestand.length, 'Betriebsmittel ist', 'Betriebsmittel sind')} bereits im heutigen Zustand überlastet, `
      + 'ohne dass ein Zubau die Ursache ist. Hier sind zunächst die Bestandsdaten (Kabelquerschnitte, Trafoleistungen) im Rahmen '
      + 'der Begehung zu überprüfen, bevor eine Ertüchtigung festgelegt wird.');
  }
  if (ungeloest.length) {
    absaetze.push(`${anzahl(ungeloest.length, 'Engpass lässt', 'Engpässe lassen')} sich mit Standardertüchtigungen nicht beheben. `
      + 'Hier ist eine Änderung der Netzstruktur erforderlich, z. B. eine zusätzliche Trafostation oder Unterverteilung näher an '
      + 'der Last, die Aufteilung von Strängen oder die Anbindung an das Mittelspannungsnetz.');
  }
  if (ms.length) {
    absaetze.push(`${anzahl(ms.length, 'Engpass betrifft', 'Engpässe betreffen')} das Mittelspannungsnetz; diese sind im Rahmen `
      + 'der Mittelspannungsplanung bzw. mit dem Netzbetreiber gesondert zu betrachten.');
  }
  absaetze.push('Die folgende Abbildung zeigt die Höchstlast des Netzes über den Betrachtungszeitraum, die anschließende Tabelle '
    + 'die einzelnen Engpässe mit der vorgesehenen Ertüchtigung. Die Kosten der Ertüchtigungen werden in Kapitel 3.5 ausgewiesen.');
  return ggTextBlatt(absaetze, T);
}

/** Einzelansicht des Textbausteins zum internen Netz: Stand des Netzmodells und Einordnung der Engpässe. */
function ggNetzInternStandHtml() {
  const res = ggEngpassErgebnis();
  const zeile = (label, wert) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;font-size:11px;line-height:1.6;">
      <span style="color:var(--muted);">${gEsc(label)}</span><span>${wert}</span></div>`;
  if (!res) {
    return '<div style="font-size:11px;color:#e0a126;">Kein Netzmodell — im Elektro-Tab Trafos und Kabel anlegen. Der Text meldet „kein Netzmodell“.</div>';
  }
  const liste = ggEngpassListe(res);
  const n = f => liste.filter(f).length;
  return zeile('Netzmodell', `${res.trafos.length} Trafos · ${res.kabel.length} Kabel · ${res.von}–${res.bis} (${res.jahre.length} Stützjahre)`)
    + zeile('Engpässe durch Zubau', String(n(e => !e.bestand && !e.ms)))
    + zeile('Bestandsmängel', String(n(e => e.bestand)))
    + zeile('Ohne Standardlösung', String(n(e => e.v?.ungeloest && !e.bestand)))
    + zeile('Mittelspannung', String(n(e => e.ms)))
    + '<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Ertüchtigungen sind Vorschläge des '
    + 'Maßnahmen-Generators, im Projekt wird dafür nichts angelegt. Kosten folgen in Kapitel 3.5. Bestandsmängel bitte im '
    + 'Elektro-Tab prüfen (Querschnitt, Trafoleistung).</div>';
}

GG_FIGUREN.push(
  // ── Gutachtentext: Variante Netzanschluss ─────────────────────────────
  {
    id: 'netzanschluss-variante-text',
    istText: true,
    bedarfText: 'resultierend',   // Einzelansicht zeigt denselben Stand wie 3.3.4
    reihe: 5,
    kapitel: GG_KAP_NETZ,
    titel: 'Gutachtentext: Variante Netzanschluss',
    datei: 'netzanschluss-variante-text',
    hinweis: 'Bei Überschreitung: Variante A Erhöhung der Anschlussleistung (erstes Jahr, Mindestleistung für den Antrag, '
           + 'Spannungsebene) und — wenn Ladeinfrastruktur zur Überschreitung beiträgt — Variante B Lademanagement mit der für das '
           + 'Laden verfügbaren Leistung (wie 3.4.4), dazu Einspeisezusage. Reserve-Zuschlag und '
           + 'Vorlaufzeit des Netzbetreibers bleiben Platzhalter.',
    render: cfg => ggRenderNetzanschlussVarianteText(cfg),
    config: {},
  },

  // ── Gutachtentext: Internes Stromnetz ──────────────────────────────────
  {
    id: 'netz-intern-text',
    istText: true,
    netzInternText: true,
    reihe: 20,
    kapitel: GG_KAP_NETZ,
    titel: 'Gutachtentext: Internes Stromnetz',
    datei: 'netz-intern-text',
    hinweis: 'Ergebnis des Engpass-Sweeps über das Netzmodell: Grenzwerte, Engpässe durch Zubau, Bestandsmängel, nicht mit '
           + 'Standardertüchtigung lösbare Engpässe und Mittelspannung. Ohne Netzmodell Platzhaltertext. Der Sweep läuft beim '
           + 'ersten Öffnen einmal und dauert einen Moment.',
    render: cfg => ggRenderNetzInternText(cfg),
    config: {},
  },

  // ── Engpässe im internen Netz ──────────────────────────────────────────
  {
    id: 'netz-intern-engpaesse',
    autoSync: true,
    reihe: 30,
    kapitel: GG_KAP_NETZ,
    titel: 'Engpässe im internen Stromnetz',
    datei: 'netz-intern-engpaesse',
    hinweis: 'Betriebsmittel, die im Betrachtungszeitraum zum Engpass werden, mit höchster Auslastung, Engpassjahr, '
           + 'vorgeschlagener Ertüchtigung und Umsetzungsjahr — ohne Kosten (Kapitel 3.5). Bestandsmängel und nicht lösbare '
           + 'Engpässe sind farbig markiert.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Engpässe im internen Stromnetz',
      leer: 'Keine Engpässe im Netzmodell.',
      spalten: [
        { label: 'Betriebsmittel', weight: 2.1, align: 'left', mono: false },
        { label: 'Art',            weight: 1.0, align: 'left', mono: false },
        { label: 'Auslastung',     weight: 1.1 },
        { label: 'Engpassjahr',    weight: 1.0 },
        { label: 'Ertüchtigung',   weight: 2.0, align: 'left', mono: false },
        { label: 'Umsetzung',      weight: 1.0 },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const res = ggEngpassErgebnis();
      if (!res) {
        cfg.zeilen = []; cfg.fussnote = ''; cfg.leer = 'Kein Netzmodell — im Elektro-Tab Trafos und Kabel anlegen.';
        return '⚠ Kein Stromnetz modelliert — im Elektro-Tab Trafos und Kabel anlegen.';
      }
      cfg.leer = `Keine Engpässe im Netzmodell bis ${res.bis}.`;
      const g = ENGPASS_GRENZEN;
      const liste = ggEngpassListe(res);
      cfg.zeilen = liste.map(({ item, bestand, ms, v }) => {
        const spannung = String(item.ursache || '').includes('spannung');
        return {
          werte: [
            item.label,
            item.art === 'trafo' ? 'Trafo' : ms ? 'Kabel MS' : 'Kabel NS',
            `${ggNum(item.maxAuslPct)} %` + (spannung ? ` · ΔU ${ggNum(item.maxDuPct, 1)} %` : ''),
            bestand ? 'Bestand' : String(item.engpassJahr),
            bestand ? 'Bestandsdaten prüfen' : ms ? 'MS-Planung' : v?.ungeloest ? 'Netzstruktur ändern' : (v?.label || '—'),
            bestand ? '—' : (v?.jahr ?? '—'),
          ],
          akzent: bestand ? GG_THEME.energy.gas : v?.ungeloest ? GG_THEME.energy.waerme : GG_THEME.accents.gruen,
        };
      });
      cfg.fussnote = `Netzmodell ${res.von}–${res.bis} · Engpass: Trafo > ${g.trafoPct} %, Kabel > ${g.auslastungPct} % Iz `
                   + `oder ΔU > ${ggNum(g.deltaUKumPct)} % · Umsetzung ${ENGPASS_VORLAUF_J} Jahre vor Engpass · Kosten siehe Kapitel 3.5`;
      return liste.length
        ? `✓ ${liste.length} Engpässe aus dem Netzmodell (${res.von}–${res.bis}) übernommen.`
        : `✓ Keine Engpässe im Netzmodell bis ${res.bis}.`;
    },
  },
);

// ── PV-Analyse: Varianten, Energiebilanz, Wirtschaftlichkeit, Resilienz ───────
// Quelle: window._pvAnalyse.ergebnisse (gefüllt in src/09d-pv-analyse.js über
// „Varianten berechnen") bzw. window._pvResReco (PV-Analyse › Abb. 10). Ohne
// gelaufene Berechnung liefert ausProjekt eine Hinweismeldung statt Zahlen.
// Als eigene Funktion statt direkt im Array-Literal: die Helfer/Konstanten
// darunter (GG_PV_KURZ etc.) sind sonst beim Auswerten von GG_FIGUREN noch
// nicht initialisiert (TDZ) — der Push erfolgt erst, nachdem alles definiert ist.

/* ══════════════════════════════════════════════════════════════════════════
 * 3g) RENDERER — „Herleitung": mehrere kleine Kriterien-Diagramme nebeneinander
 *
 * Für Kapitel 3.4.2: belegt, WARUM eine Auslegung die gewählte ist. Je Panel
 * eine Kurve, die Kriteriumslinie und der gewählte Punkt; wo eine Suche
 * abgebrochen hat, zusätzlich der auslösende Punkt.
 * cfg.panels = [{ titel, kriterium, farbe, punkte:[{x,y}], xMax, yMin, yMax,
 *   xEinheit, schwelle?:{y,label}, marker:{x,y,label}, brk?:{x,y,label} }]
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderHerleitung(cfg, T = GG_THEME) {
  const G = ggSheetGeometry(T, cfg);
  const S = G.S, W = G.W;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = ggSheetHeader(cfg, T, G);

  const panels = (cfg.panels || []).filter(p => p && p.punkte && p.punkte.length > 1);
  if (!panels.length) {
    out += `<rect x="${gR(G.plotX)}" y="${G.plotY}" width="${gR(G.plotW)}" height="${G.plotH}" fill="${T.neutral.cardBg}"/>`;
    out += txt(G.plotX + G.plotW / 2, G.plotY + G.plotH / 2, cfg.leer || 'Keine Daten vorhanden',
               { anchor: 'middle', size: 13, fill: T.text.faint });
    out += ggAxisTitles(cfg, T, G);
    out += ggSheetKpiFooter(cfg, T, G);
    return ggFinishSvg(out, W, G.height);
  }

  const luft = 18;
  const pW = (G.plotW - luft * (panels.length - 1)) / panels.length;

  panels.forEach((p, idx) => {
    const pX = G.plotX + idx * (pW + luft);
    out += `<rect x="${gR(pX)}" y="${G.plotY}" width="${gR(pW)}" height="${G.plotH}" fill="${T.neutral.cardBg}"/>`;

    // Überschrift des Panels: Variante + Kriterium
    out += txt(pX + 12, G.plotY + 20, p.titel || '', { size: S.fsBody, weight: 700 });
    out += txt(pX + 12, G.plotY + 36, p.kriterium || '', { size: S.fsLeg, fill: T.text.muted });

    // Zeichenfläche des Panels
    const cX = pX + 42, cY = G.plotY + 48;
    const cW = pW - 42 - 14, cH = G.plotH - 48 - 30;
    const cB = cY + cH;
    const xMax = p.xMax || 1;
    const yMin = p.yMin, yMax = p.yMax > p.yMin ? p.yMax : p.yMin + 1;
    const xOf = v => cX + Math.min(1, Math.max(0, v / xMax)) * cW;
    const yOf = v => cB - Math.min(1, Math.max(0, (v - yMin) / (yMax - yMin))) * cH;

    // Gitter (drei waagerechte Hilfslinien)
    let gitter = '';
    for (let i = 0; i <= 2; i++) {
      const y = Math.round(cB - (i / 2) * cH) + 0.5;
      gitter += `M${gR(cX)} ${y}H${gR(cX + cW)}`;
    }
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;

    // Kriteriumslinie
    if (p.schwelle && p.schwelle.y >= yMin && p.schwelle.y <= yMax) {
      const sy = yOf(p.schwelle.y);
      out += `<line x1="${gR(cX)}" y1="${gR(sy)}" x2="${gR(cX + cW)}" y2="${gR(sy)}"
                stroke="${T.energy.gas}" stroke-width="1.6" stroke-dasharray="5 3"/>`;
      out += txt(cX + 5, sy - 5, p.schwelle.label || '', { size: S.fsLeg, fill: T.energy.gas });
    }

    // Kurve
    const d = p.punkte.map((q, i) => (i ? 'L' : 'M') + gR(xOf(q.x)) + ' ' + gR(yOf(q.y))).join(' ');
    out += `<path d="${d}" fill="none" stroke="${p.farbe || T.accents.gruen}" stroke-width="2.2"/>`;

    // Abbruchpunkt (Kriterium gerissen)
    if (p.brk) {
      out += `<circle cx="${gR(xOf(p.brk.x))}" cy="${gR(yOf(p.brk.y))}" r="4" fill="none"
                stroke="${T.energy.waerme}" stroke-width="2"/>`;
      out += txt(xOf(p.brk.x) - 7, yOf(p.brk.y) + 15, p.brk.label || '',
                 { anchor: 'end', size: S.fsLeg, fill: T.energy.waerme });
    }

    // Gewählter Punkt
    if (p.marker) {
      out += `<circle cx="${gR(xOf(p.marker.x))}" cy="${gR(yOf(p.marker.y))}" r="5"
                fill="${p.farbe || T.accents.gruen}" stroke="${T.neutral.cardBg}" stroke-width="2"/>`;
      out += txt(xOf(p.marker.x) - 8, yOf(p.marker.y) - 10, p.marker.label || '',
                 { anchor: 'end', mono: true, size: S.fsLeg, weight: 500, fill: T.text.strong });
    }

    // Achsenbeschriftung
    for (let i = 0; i <= 2; i++) {
      const wert = yMin + (i / 2) * (yMax - yMin);
      out += txt(cX - 6, cB - (i / 2) * cH + S.fsAxis * 0.36, ggNum(wert, (yMax - yMin) < 12 ? 1 : 0),
                 { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }
    out += txt(cX, cB + 14, '0', { mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    out += txt(cX + cW, cB + 14, ggNum(xMax) + ' ' + (p.xEinheit || ''),
               { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });

    out += `<rect x="${gR(pX) + 0.5}" y="${G.plotY}.5" width="${gR(pW) - 1}" height="${G.plotH - 1}"
              fill="none" stroke="${T.rule}" stroke-width="1"/>`;
  });

  out += ggAxisTitles(cfg, T, G);
  out += ggSheetKpiFooter(cfg, T, G);
  return ggFinishSvg(out, W, G.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3g2) RENDERER — „Einlinienschema Bestandsnetz"
 *
 * Für Kapitel 3.4.2: das Einlinienschema der Netzaufnahme (Trafo → Kabel →
 * Knoten → Dächer) mit Auslastung, Spannungsanhebung und Engpässen. Die
 * Geometrie kommt fertig als Zeichenliste aus src/29-pvna-schema.js
 * (window.pvnaSchemaDruck); hier werden nur die Farbrollen im Gutachten-Stil
 * aufgelöst und das Blatt (Kopf, Legende, Kennzahlen) drumherum gebaut.
 * cfg.schema = { breite, hoehe, zeichnung:[{t:'l'|'c'|'r'|'t', …}] }
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderEinlinienschema(cfg, T = GG_THEME) {
  const sch = cfg.schema;
  const S0 = T.sheet;
  const verfuegbar = T.width - 2 * S0.padX;
  // Maßstab: Schema-Einheiten sind Bildschirm-Pixel (Schrift ~9 px) → für Word etwas größer,
  // bei breiten Netzen so weit verkleinert, dass alles auf die Textbreite passt.
  const s = sch ? Math.min(1.3, verfuegbar / sch.breite) : 1;
  const legendeH = 40;
  const plotH = sch ? Math.max(160, sch.hoehe * s + legendeH + 16) : 200;
  const T2 = { ...T, sheet: { ...S0, plotH } };
  const G = ggSheetGeometry(T2, cfg);
  const S = G.S, W = G.W;
  const txt = (x, y, t, o) => ggTxt(T2, S, x, y, t, o);
  let out = ggSheetHeader(cfg, T2, G);

  if (!sch) {
    out += `<rect x="${S.padX}" y="${G.plotY}" width="${W - 2 * S.padX}" height="${G.plotH}" fill="${T.neutral.cardBg}"/>`;
    out += txt(W / 2, G.plotY + G.plotH / 2, cfg.leer || 'Keine Daten vorhanden', { anchor: 'middle', size: 13, fill: T.text.faint });
    out += ggSheetKpiFooter(cfg, T2, G);
    return ggFinishSvg(out, W, G.height);
  }

  const farbe = {
    ok: T.accents.gruen, warn: T.energy.gas, over: T.energy.waerme, text: T.text.strong,
    muted: T.text.muted, faint: T.text.faint, akzent: T.energy.strom, papier: T.neutral.cardBg, none: 'none',
  };
  const f = k => farbe[k] || k || 'none';
  out += `<rect x="${S.padX}" y="${G.plotY}" width="${W - 2 * S.padX}" height="${G.plotH}" fill="${T.neutral.cardBg}" stroke="${T.line}"/>`;
  const x0 = S.padX + (verfuegbar - sch.breite * s) / 2;
  let g = '';
  for (const e of sch.zeichnung || []) {
    if (e.t === 'l') {
      g += `<line x1="${gR(e.x1)}" y1="${gR(e.y1)}" x2="${gR(e.x2)}" y2="${gR(e.y2)}" stroke="${f(e.f)}" stroke-width="${e.w}"`
        + `${e.dash ? ` stroke-dasharray="${e.dash}"` : ''}${e.o != null ? ` opacity="${e.o}"` : ''}${e.cap ? ` stroke-linecap="${e.cap}"` : ''}/>`;
    } else if (e.t === 'c') {
      g += `<circle cx="${gR(e.cx)}" cy="${gR(e.cy)}" r="${e.r}" fill="${f(e.fill)}"${e.fo != null ? ` fill-opacity="${e.fo}"` : ''}`
        + `${e.stroke ? ` stroke="${f(e.stroke)}" stroke-width="${e.sw || 1}"` : ''}/>`;
    } else if (e.t === 'r') {
      g += `<rect x="${gR(e.x)}" y="${gR(e.y)}" width="${gR(e.w)}" height="${gR(e.h)}"${e.rx ? ` rx="${e.rx}"` : ''} fill="${f(e.fill)}"`
        + `${e.fo != null ? ` fill-opacity="${e.fo}"` : ''}${e.stroke ? ` stroke="${f(e.stroke)}" stroke-width="${e.sw || 1}"` : ''}/>`;
    } else if (e.t === 't') {
      g += ggTxt(T2, S, e.x, e.y, e.s, { size: e.size || 9, anchor: e.anchor, mono: e.mono, weight: e.weight, fill: f(e.f || 'text') });
    }
  }
  out += `<g transform="translate(${gR(x0)} ${gR(G.plotY + 10)}) scale(${gR(s * 1000) / 1000})">${g}</g>`;

  // Legende
  const ly = G.plotY + G.plotH - legendeH + 14;
  let lx = S.padX + 14;
  const eintrag = (sym, label) => {
    out += sym(lx, ly);
    out += txt(lx + 20, ly + 4, label, { size: S.fsLeg, fill: T.text.muted });
    lx += 26 + ggEstW(label, S.fsLeg) + 14;
  };
  out += `<line x1="${S.padX}" y1="${gR(ly - 14)}" x2="${W - S.padX}" y2="${gR(ly - 14)}" stroke="${T.line}"/>`;
  eintrag((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${farbe.ok}" stroke-width="3"/>`, '< 70 %');
  eintrag((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${farbe.warn}" stroke-width="3"/>`, '70–100 %');
  eintrag((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${farbe.over}" stroke-width="3"/>`, '> 100 % Auslastung bzw. ΔU-Grenze');
  eintrag((x, y) => `<circle cx="${x + 7}" cy="${y}" r="6" fill="${farbe.over}" fill-opacity="0.15" stroke="${farbe.over}"/>`, 'Engpass');
  eintrag((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${farbe.faint}" stroke-width="2" stroke-dasharray="4 3"/>`, 'Querschnitt nicht erfasst');
  out += txt(S.padX + 14, ly + 20, cfg.fussnote || '', { size: S.fsLeg - 1, fill: T.text.faint });

  out += ggSheetKpiFooter(cfg, T2, G);
  return ggFinishSvg(out, W, G.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3h) RENDERER — „Rückspeise-Ampel": Säule je Variante gegen Grenzlinien
 *
 * Für Kapitel 3.4.2: die gleichzeitige Rückspeiseleistung am Netzanschluss-
 * punkt gegen Anschlusskapazität und Spannungsband. Die Säulenfarbe ist die
 * Ampelbewertung, die Grenzen sind waagerechte Linien.
 * cfg.kategorien = string[] · cfg.balken = [{ wert, farbe }]
 * cfg.grenzen    = [{ wert, farbe, label }]
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderRueckAmpel(cfg, T = GG_THEME) {
  const G = ggSheetGeometry(T, cfg);
  const S = G.S, W = G.W, plotX = G.plotX, plotW = G.plotW, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  let out = ggSheetHeader(cfg, T, G);
  out += `<rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;

  const kat = cfg.kategorien || [];
  const balken = cfg.balken || [];
  const grenzen = (cfg.grenzen || []).filter(g => g && g.wert > 0);

  if (!kat.length || !balken.some(b => b.wert > 0)) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, cfg.leer || 'Keine Daten vorhanden',
               { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    const roh = Math.max(...balken.map(b => b.wert), ...grenzen.map(g => g.wert));
    const yStep = ggNiceStep(roh / 7);
    const yMax  = Math.max(yStep, Math.ceil(roh * 1.12 / yStep) * yStep);
    const yOf = v => plotB - (v / yMax) * plotH;

    let gitter = '';
    for (let v = yStep; v < yMax; v += yStep) {
      const y = Math.round(yOf(v)) + 0.5;
      gitter += `M${gR(plotX)} ${y}H${gR(plotX + plotW)}`;
    }
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;

    // Säulen
    const fachW = plotW / kat.length, innen = fachW * 0.5;
    balken.forEach((b, i) => {
      const h = Math.max(0, (b.wert / yMax) * plotH);
      const x = plotX + i * fachW + (fachW - innen) / 2;
      out += `<rect x="${gR(x)}" y="${gR(plotB - h)}" width="${gR(innen)}" height="${gR(h)}" fill="${b.farbe}"/>`;
      out += txt(x + innen / 2, plotB - h - 7, ggNum(b.wert),
                 { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.strong });
    });

    // Grenzlinien über den Säulen
    for (const g of grenzen) {
      if (g.wert > yMax) continue;
      const y = yOf(g.wert);
      out += `<line x1="${gR(plotX)}" y1="${gR(y)}" x2="${gR(plotX + plotW)}" y2="${gR(y)}"
                stroke="${g.farbe}" stroke-width="1.8" stroke-dasharray="6 4"/>`;
      out += txt(plotX + plotW - 8, y - 6, g.label || '', { anchor: 'end', size: S.fsLeg, fill: g.farbe });
    }

    // Achsen
    kat.forEach((k, i) => {
      out += txt(plotX + i * fachW + fachW / 2, G.xLabelY, k,
                 { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    });
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      out += txt(plotX - 8, yOf(v) + S.fsAxis * 0.36, ggNum(v),
                 { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    }

    // Ampel-Legende
    const leg = [
      { farbe: T.accents.gruen,  text: 'netzverträglich' },
      { farbe: T.energy.gas,     text: 'Prüfung durch den Netzbetreiber' },
      { farbe: T.energy.waerme,  text: 'Erzeugungsnetz / MS-Anschluss nötig' },
    ];
    const lw = 12 + 16 + 9 + Math.max(...leg.map(e => ggEstW(e.text, S.fsLeg))) + 14;
    const lh = 8 + leg.length * 18 + 2;
    const lx = plotX + 12, ly = plotY + 10;
    out += `<rect x="${gR(lx)}" y="${ly}" width="${gR(lw)}" height="${gR(lh)}" fill="${T.bg}" fill-opacity="0.92"
              stroke="${T.line}" stroke-width="1"/>`;
    leg.forEach((e, i) => {
      const ey = ly + 8 + i * 18;
      out += `<rect x="${gR(lx + 12)}" y="${gR(ey)}" width="12" height="11" fill="${e.farbe}"/>`
           + txt(lx + 37, ey + 9, e.text, { size: S.fsLeg });
    });
  }

  out += `<rect x="${gR(plotX) + 0.5}" y="${plotY}.5" width="${gR(plotW) - 1}" height="${plotH - 1}"
            fill="none" stroke="${T.rule}" stroke-width="1"/>
          <line x1="${gR(plotX)}" y1="${gR(plotB) - 1}" x2="${gR(plotX + plotW)}" y2="${gR(plotB) - 1}"
            stroke="${T.text.strong}" stroke-width="2"/>`;

  out += ggAxisTitles(cfg, T, G);
  out += ggSheetKpiFooter(cfg, T, G);
  return ggFinishSvg(out, W, G.height);
}

/** Kanonische Varianten (mit Lesehilfe-Info) aus der PV-Analyse, sonst leer. */
function ggPvKanon() {
  return (window._pvAnalyse?.ergebnisse || []).filter(v => v.info && v.info.frage);
}
/** Kurzform der Variantenlabel für Achsen/Kategorien (voller Name steht in Tabellen). */
const GG_PV_KURZ = { 'minimal': 'Minimal', 'bestandsnetz': 'Bestandsnetz', 'netz-eigen': 'Bestandsnetz (eigen)', 'ev-opt': 'EV-optimiert', 'wirt-opt': 'Wirt.-optimiert',
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

/* ── Gutachtentexte Kapitel 3.4.2 PV-Anlage und Batteriespeicher ─────────────
 * Fünf Textbausteine, die das Standarddokument über `reihe` zwischen die
 * Abbildungen setzt: Grundlagen → Herleitung → Energiebilanz-Text → Tabelle +
 * Energiebilanz → Speicher → Netzintegration → Rückspeisung → Abgrenzung.
 * Werte stammen aus dem letzten „Varianten berechnen" (ergebnisse + basis in
 * window._pvAnalyse), nie aus den aktuellen Eingabefeldern — sonst zeigten Text
 * und Abbildungen verschiedene Stände. Wie die Abbildungen bewusst ohne Euro-Werte
 * und ohne „beste" Variante: bewertet wird in 3.5. */
const GG_PV_LANG = { 'minimal': 'Minimal', 'bestandsnetz': 'Bestandsnetz', 'netz-eigen': 'Bestandsnetz, eigene Belegung', 'ev-opt': 'Eigenverbrauchs-optimiert', 'wirt-opt': 'Wirtschaftlich optimiert',
                     'autarkie': 'Autarkie-optimiert', 'max-pv': 'Maximaler PV-Ausbau' };
const GG_PV_KAPITEL = '3.4.2 PV-Anlage und Batteriespeicher';
const GG_ZAHLWORT = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht'];

/** Datenbasis des letzten Rechenlaufs (null = noch nicht berechnet). */
function ggPvBasis() {
  const s = window._pvAnalyse;
  return s?.berechnet && s.basis ? s.basis : null;
}
const ggPvVariante = id => (ggPvBasis() && ggPvKanon().find(v => v.id === id)) || null;
/** Zahl als Platzhalter — bleibt gelb, solange der Wert fehlt. */
const ggPvFeld = (wert, name, dez = 0) => ggTextFeld(wert != null && isFinite(wert) ? ggNum(wert, dez) : '', name);
const ggPvName = v => `„${gEsc(v.label)}“`;
/** „A“, „A und B“, „A, B und C“ */
function ggAufzaehlung(teile) {
  return teile.length < 2 ? (teile[0] || '') : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}
/** Varianten mit dem kleinsten und dem größten Wert einer Kennzahl. */
function ggPvSpanne(kanon, wert) {
  if (!kanon.length) return [null, null];
  return kanon.reduce(([lo, hi], v) => [wert(v) < wert(lo) ? v : lo, wert(v) > wert(hi) ? v : hi], [kanon[0], kanon[0]]);
}

/** 3.4.2 Teil 1 — Datenbasis, PV-Potenzial und die fünf Auslegungen. */
function ggRenderPvGrundlagenText(cfg, T = GG_THEME) {
  void cfg;
  const b = ggPvBasis();
  const H = (b && window._pvAnalyse.herleitung) || {};
  const kanon = b ? ggPvKanon() : [];
  const name = document.querySelector('.header-projekt-name')?.textContent?.trim() || '';
  const absaetze = [];

  const lastfall = b?.lastfall === 'gesamt'
    ? ' Der Lastgang enthält zusätzlich den Strombedarf der elektrischen Wärmeerzeugung (Wärmepumpen und Stromkessel, vgl. Kapitel 2).'
    : b?.lastfall === 'endausbau'
      ? ` Der Lastgang bildet den Endausbau bis zum Jahr ${ggTextFeld(b.endausbauJahr, 'Zieljahr')} einschließlich der geplanten Neubau- und Rückbaumaßnahmen ab (vgl. Kapitel 3.3.1).`
      : '';
  absaetze.push(`Für die Liegenschaft ${ggTextFeld(name, 'Name Liegenschaft')} wurde untersucht, in welchem Umfang `
    + `Photovoltaikanlagen zusammen mit Batteriespeichern den Strombezug aus dem öffentlichen Netz verringern können. `
    + `Grundlage ist der Stromlastgang ${ggTextFeld(b?.lastgangDatei, 'Lastgang-Datei')} mit einem Jahresstrombedarf von `
    + `${ggPvFeld(b?.bedarfMwh, 'Jahresstrombedarf')} MWh/a in `
    + `${ggTextFeld(b ? (b.dt === 1 ? 'stündlicher' : 'viertelstündlicher') : '', 'Auflösung')} Auflösung.${lastfall}`);

  const q = b && !b.potenzialOverride ? b.quellen || {} : {};
  const teile = [
    q.assetKwp > 0 && `${ggPvFeld(q.assetKwp, 'kWp Einzelanlagen')} kWp auf ${ggPvFeld(q.assetN, 'Anzahl Anlagen')} einzeln erfasste Anlagen`,
    q.gebKwp > 0 && `${ggPvFeld(q.gebKwp, 'kWp Gebäude-PV')} kWp auf weitere Dachflächen`,
    q.ffKwp > 0 && `${ggPvFeld(q.ffKwp, 'kWp Freifläche')} kWp auf Freiflächen`,
    q.manual > 0 && `${ggPvFeld(q.manual, 'kWp pauschal')} kWp auf pauschal angesetzte Flächen`,
  ].filter(Boolean);
  const profil = {
    pvgis: 'des PVGIS-Stundenprofils für den Standort',
    upload: 'eines hochgeladenen Stundenprofils',
    synthetisch: 'eines synthetischen Erzeugungsprofils aus Sonnenstand und Wetterstreuung',
  }[b?.profil?.id];
  absaetze.push((b?.potenzialOverride
      ? `Für die Untersuchung wurde ein PV-Potenzial von insgesamt ${ggPvFeld(b.potenzialKwp, 'Gesamtpotenzial')} kWp vorgegeben.`
      : `Nach den erfassten Dach- und Freiflächen lassen sich auf der Liegenschaft PV-Anlagen mit insgesamt `
        + `${ggPvFeld(b?.potenzialKwp, 'Gesamtpotenzial')} kWp errichten.`
        + (teile.length > 1 ? ` Davon entfallen ${ggAufzaehlung(teile)}.` : ''))
    + ` Bei einem mittleren spezifischen Ertrag von ${ggPvFeld(b?.spezKwhKwp, 'spez. Ertrag')} kWh/kWp·a ergibt das eine `
    + `mögliche Stromerzeugung von rund ${ggPvFeld(b ? b.potenzialKwp * b.spezKwhKwp / 1000 : null, 'Ertrag Max-PV')} MWh/a. `
    + `Die Erzeugung wurde auf Basis ${profil || ggTextFeld('', 'Erzeugungsprofil')} für jeden Zeitschritt des Jahres `
    + `berechnet und dem Lastgang gegenübergestellt. Die statische Eignung der Dachflächen ist im Zuge der weiteren `
    + `Planung nachzuweisen.`);

  const anzahl = b ? kanon.length : 5;
  absaetze.push(`Auftraggeber, Nutzer und Betreiber verfolgen unterschiedliche Ziele. Deshalb wurden `
    + `${GG_ZAHLWORT[anzahl] || anzahl} Auslegungen gebildet, von denen jede genau eine Frage beantwortet:`);

  const zeige = id => !b || !!ggPvVariante(id);
  const label = id => gEsc(ggPvVariante(id)?.label || GG_PV_LANG[id]);
  const kwp = (id, feld) => ggPvFeld(ggPvVariante(id)?.pvKwp, feld);

  if (zeige('minimal')) {
    absaetze.push(`${label('minimal')}: ${kwp('minimal', 'kWp Minimal')} kWp ohne Speicher. Die Anlage bleibt unter `
      + `100 kWp, ab denen nach EEG die Direktvermarktung und weitergehende technische Anforderungen greifen.`);
  }
  if (zeige('bestandsnetz')) {
    const bn = ggPvVariante('bestandsnetz');
    const na = bn?.netzaufnahme || H.bestandsnetz || null;
    const mehr = na ? na.mitErtuechtigungKwp - na.ohneErtuechtigungKwp : 0;
    absaetze.push(`${label('bestandsnetz')}: ${kwp('bestandsnetz', 'kWp Bestandsnetz')} kWp ohne Speicher. So viel nimmt `
      + `das bestehende Stromnetz der Liegenschaft auf, ohne dass Kabel oder Transformatoren ertüchtigt werden müssen. `
      + `Grundlage sind die Belastbarkeit der erfassten Kabel und Transformatoren bei voller Einspeisung sowie eine `
      + `zulässige Spannungsanhebung von ${ggPvFeld(na?.eingaben?.duGrenzePct, 'ΔU-Grenze', 1)} %; belegt werden die `
      + `ertragsstärksten Dachflächen zuerst. Vorausgesetzt sind lediglich Regelungstechnik (EZA-Regler) und `
      + `Einspeisemanagement.`
      + (na?.eingaben?.ersatzQs > 0
        ? ` Für Kabel ohne erfassten Querschnitt ist vorsichtig ein Querschnitt von ${ggNum(na.eingaben.ersatzQs)} mm² (NAYY) angenommen.`
        : '')
      + (mehr > 0.5
        ? ` Weitere ${ggPvFeld(mehr, 'kWp nach Ertüchtigung')} kWp ließen sich erst nach einer Ertüchtigung des Netzes anschließen.`
        : ''));
  }
  if (b && zeige('netz-eigen')) {             // nur wenn übernommen — nicht in der Vorlage ohne Rechenlauf
    const ne = ggPvVariante('netz-eigen');
    const pr = ne?.eigeneBelegung;
    const mass = ne?.netzausbau?.massnahmen || [];
    absaetze.push(`${label('netz-eigen')}: ${kwp('netz-eigen', 'kWp eigene Belegung')} kWp ohne Speicher, verteilt nach einer `
      + `planerisch festgelegten Belegung der einzelnen Dachflächen statt nach dem Ertrag.`
      + (mass.length ? ` Vorausgesetzt ${mass.length === 1 ? 'ist folgende Ertüchtigung' : 'sind folgende Ertüchtigungen'} des Netzes: `
        + `${gEsc(mass.map(m => m.label).join('; '))}.` : '')
      + (pr ? (pr.zulaessig
        ? (mass.length ? ` Mit diesen Maßnahmen nimmt das Netz die Verteilung auf.` : ` Auch diese Verteilung nimmt das bestehende Netz ohne Ertüchtigung auf.`)
        : ` Diese Verteilung überschreitet im bestehenden Netz die Belastbarkeit einzelner Betriebsmittel oder die zulässige `
          + `Spannungsanhebung; sie setzt eine Ertüchtigung voraus, deren Kosten hier nicht enthalten sind.`) : ''));
  }
  if (zeige('ev-opt')) {
    const ev = ggPvVariante('ev-opt');
    absaetze.push(`${label('ev-opt')}: die größte Anlage, deren Erzeugung zu mindestens ${ggNum(H.evOpt?.schwelle ?? 90)} % `
      + `vor Ort verbraucht wird, hier ${kwp('ev-opt', 'kWp EV-optimiert')} kWp.`
      + (ev?.batKwh > 0
        ? ` Hinzu kommt ein Speicher mit ${ggPvFeld(ev.batKwh, 'kWh EV-optimiert')} kWh, der Überschüsse der Mittagszeit in die Abendstunden verschiebt.`
        : ''));
  }
  if (zeige('wirt-opt')) {
    const w = ggPvVariante('wirt-opt');
    absaetze.push(`${label('wirt-opt')}: PV- und Speichergröße wurden gemeinsam variiert. Gewählt ist die Kombination `
      + `mit dem höchsten jährlichen Netto-Überschuss: ${kwp('wirt-opt', 'kWp wirtschaftlich')} kWp `
      + (w && !(w.batKwh > 0) ? 'ohne Speicher.' : `und ${ggPvFeld(w?.batKwh, 'kWh wirtschaftlich')} kWh.`));
  }
  if (zeige('autarkie')) {
    const a = ggPvVariante('autarkie');
    absaetze.push(`${label('autarkie')}: volles Potenzial von ${kwp('autarkie', 'kWp Autarkie')} kWp. Der Speicher wird `
      + `vergrößert, bis jede weitere MWh die Autarkie um weniger als ${ggNum(H.autarkie?.schwelle ?? 0.3, 1)} `
      + `Prozentpunkte erhöht. `
      + (a && !(a.batKwh > 0)
        ? 'Ein Speicher erhöht die Autarkie hier nicht nennenswert.'
        : `Das ergibt ${ggPvFeld(a ? a.batKwh / 1000 : null, 'MWh Autarkie', 1)} MWh.`));
  }
  if (zeige('max-pv')) {
    absaetze.push(`${label('max-pv')}: volles Potenzial von ${kwp('max-pv', 'kWp Max-PV')} kWp, bewusst ohne Speicher.`);
  }
  if (!b || H.evOpt || H.wirtOpt || H.autarkie) {
    absaetze.push('Die folgende Abbildung zeigt für die optimierten Auslegungen, wie sich die jeweilige Größe aus dem '
      + 'Auswahlkriterium ergibt.');
  }
  return ggTextBlatt(absaetze, T);
}

/** 3.4.2 Teil 2 — Spannweiten der Energiebilanz und Abregelung; steht vor Tabelle und Energiebilanz-Abbildung. */
function ggRenderPvEnergiebilanzText(cfg, T = GG_THEME) {
  void cfg;
  const b = ggPvBasis();
  const kanon = b ? ggPvKanon() : [];
  const [ertLo, ertHi] = ggPvSpanne(kanon, v => v.ertragMwh);
  const [evLo, evHi] = ggPvSpanne(kanon, v => v.wirt.pvEigenQuote);
  const [autLo, autHi] = ggPvSpanne(kanon, v => v.wirt.autarkie);
  const variante = (v, feld) => (v ? ggPvName(v) : ggTextFeld('', feld));
  const absaetze = [];

  absaetze.push(`Die folgende Tabelle und die anschließende Abbildung fassen die Ergebnisse zusammen. Der PV-Jahresertrag `
    + `reicht von ${ggPvFeld(ertLo?.ertragMwh, 'Ertrag min', 1)} MWh/a bis ${ggPvFeld(ertHi?.ertragMwh, 'Ertrag max', 1)} MWh/a. `
    + `Die Eigenverbrauchsquote liegt zwischen ${ggPvFeld(evLo?.wirt.pvEigenQuote, 'EV-Quote min')} % `
    + `(${variante(evLo, 'Variante')}) und ${ggPvFeld(evHi?.wirt.pvEigenQuote, 'EV-Quote max')} % (${variante(evHi, 'Variante')}), `
    + `der Autarkiegrad zwischen ${ggPvFeld(autLo?.wirt.autarkie, 'Autarkie min')} % und `
    + `${ggPvFeld(autHi?.wirt.autarkie, 'Autarkie max')} %.`);

  if (!b) return ggTextBlatt(absaetze, T);

  const autMax = ggPvVariante('autarkie') || autHi;
  const saetze = [];
  if (autMax && autMax.wirt.autarkie < 99.5) {
    saetze.push(`Selbst mit großem Speicher ist keine vollständige Eigenversorgung möglich, weil Erzeugung und Verbrauch `
      + `jahreszeitlich auseinanderfallen. Die technische Obergrenze liegt bei ${ggPvFeld(autMax.wirt.autarkie)} %.`);
  }
  if (b.napEinspKw > 0) {
    const top = kanon.reduce((a, v) => ((v.sim.curtailMwh || 0) > (a ? a.sim.curtailMwh || 0 : 0) ? v : a), null);
    saetze.push(top && top.sim.curtailMwh >= 0.05
      ? `Am Netzanschlusspunkt dürfen höchstens ${ggPvFeld(b.napEinspKw, 'max. Einspeiseleistung')} kW eingespeist werden. `
        + `In der Variante ${ggPvName(top)} werden dadurch rund ${ggPvFeld(top.sim.curtailMwh, 'Abregelung', 1)} MWh/a abgeregelt.`
      : `Bei der am Netzanschlusspunkt zulässigen Einspeiseleistung von ${ggPvFeld(b.napEinspKw, 'max. Einspeiseleistung')} kW `
        + `muss in keiner Variante abgeregelt werden.`);
    const na = ggPvVariante('max-pv')?.nullAbr;
    if (na) {
      saetze.push(na.isZero
        ? `Damit die maximale Ausbauvariante ohne Abregelung betrieben werden könnte, wäre ein Speicher mit rund `
          + `${ggPvFeld(na.batKwh / 1000, 'MWh Null-Abregelung', 1)} MWh nötig. Das ist wirtschaftlich nicht darstellbar.`
        : `Selbst ein Speicher mit ${ggPvFeld(na.batKwh / 1000, 'MWh Speicher')} MWh würde die Abregelung der maximalen `
          + `Ausbauvariante nur auf rund ${ggPvFeld(na.curtailMwh, 'Rest-Abregelung')} MWh/a senken; ein Betrieb ohne `
          + `Abregelung ist damit nicht erreichbar.`);
    }
  } else {
    saetze.push('Eine Begrenzung der Einspeiseleistung wurde nicht angesetzt, deshalb werden keine Abregelungsverluste ausgewiesen.');
  }
  absaetze.push(saetze.join(' '));
  return ggTextBlatt(absaetze, T);
}

/** 3.4.2 Teil 3 — Speichermodell, Betriebsweise, Aufstellort. */
function ggRenderPvSpeicherText(cfg, T = GG_THEME) {
  void cfg;
  const b = ggPvBasis();
  const kanon = b ? ggPvKanon() : [];
  if (b && !kanon.some(v => v.batKwh > 0)) {
    return ggTextBlatt(['In keiner der untersuchten Auslegungen ist ein Batteriespeicher vorgesehen.'], T);
  }
  const eta = b?.batEta, crate = b?.batCRate;
  const absaetze = [];
  absaetze.push(`Für die Batteriespeicher wurde ein ${ggTextFeld('', 'Speichertechnologie')}-System angesetzt. Beim Laden `
    + `und beim Entladen gehen jeweils ${ggPvFeld(eta != null ? (1 - eta) * 100 : null, 'Verlust je Vorgang')} % verloren `
    + `(Gesamtwirkungsgrad rund ${ggPvFeld(eta != null ? eta * eta * 100 : null, 'Gesamtwirkungsgrad')} %). Die maximale `
    + `Lade- und Entladeleistung in kW entspricht ${ggPvFeld(crate != null ? crate * 100 : null, 'Leistung in % der Kapazität')} % `
    + `der Nennkapazität in kWh (${ggPvFeld(crate, 'C-Rate', 1)} C). Die Speicher laufen vorrangig auf Eigenverbrauch: `
    + `PV-Überschüsse werden eingespeichert und bei Bedarf in die Liegenschaft abgegeben.`);

  const spot = b && b.spotDatei !== null ? kanon.filter(v => v.strategie === 'spot-dyn') : [];
  if (spot.length) {
    const jahr = (String(b.spotDatei).match(/(?:19|20)\d{2}/) || [''])[0];
    absaetze.push(`${spot.length === 1 ? 'In der Variante' : 'In den Varianten'} ${ggAufzaehlung(spot.map(ggPvName))} `
      + `wurde der Speicher zusätzlich anhand der Börsenstrompreise des Jahres ${ggTextFeld(jahr, 'Jahr Börsenpreise')} `
      + `gesteuert; bei negativen Preisen wird dabei nicht eingespeist.`);
  }
  absaetze.push(`Als Aufstellort ist ${ggTextFeld('', 'Aufstellort Batteriespeicher')} vorgesehen. Die Brandschutzanforderungen `
    + `sind in der Planung abzustimmen. Wie gut die Speicher Netzausfälle überbrücken, wird in Kapitel 5.2 bewertet. `
    + `Die Notstromversorgung beschreibt Kapitel 3.4.3.`);
  return ggTextBlatt(absaetze, T);
}

/** 3.4.2 Teil 4 — Rückspeisespitze und Netzverträglichkeit; steht vor der Rückspeise-Abbildung. */
function ggRenderPvNetzText(cfg, T = GG_THEME) {
  void cfg;
  const b = ggPvBasis();
  const kanon = b ? ggPvKanon().filter(v => v.rueck) : [];
  const [lo, hi] = ggPvSpanne(kanon, v => v.rueck.maxKw);
  const variante = (v, feld) => (v ? ggPvName(v) : ggTextFeld('', feld));
  const absaetze = [];

  absaetze.push(`Für die Netzintegration zählt neben der Jahresenergie vor allem, wie viel Leistung gleichzeitig ins Netz `
    + `zurückgespeist wird. Diese Rückspeiseleistung wurde je Variante ohne Begrenzung berechnet. Sie liegt zwischen `
    + `${ggPvFeld(lo?.rueck.maxKw, 'Rückspeisung min')} kW (${variante(lo, 'Variante')}) und `
    + `${ggPvFeld(hi?.rueck.maxKw, 'Rückspeisung max')} kW (${variante(hi, 'Variante')}), siehe folgende Abbildung.`);

  const r0 = kanon[0]?.rueck || {};
  const anschluss = r0.anschlussKw > 0 ? r0.anschlussKw : null;
  const sk = r0.skKVA > 0 ? r0.skKVA : null;
  const budget = r0.uBudgetPct || 3;
  const regelwerk = budget <= 2 ? 'VDE-AR-N 4110' : 'VDE-AR-N 4105';
  const spannung = `bei einer Kurzschlussleistung von Sk″ = ${ggPvFeld(sk, 'Sk″')} kVA geprüft, ob die zulässige `
    + `Spannungsanhebung von ${ggPvFeld(b ? budget : null, 'Δu-Grenze', 1)} % nach `
    + `${b ? regelwerk : ggTextFeld('', 'Regelwerk VDE-AR-N 4105/4110')} eingehalten wird`;
  if (!b || (anschluss && sk)) {
    absaetze.push(`Verglichen wurde sie mit der zulässigen Einspeiseleistung von ${ggPvFeld(anschluss, 'max. Einspeiseleistung')} kW. `
      + `Außerdem wurde ${spannung}.`);
  } else if (anschluss) {
    absaetze.push(`Verglichen wurde sie mit der zulässigen Einspeiseleistung von ${ggPvFeld(anschluss, 'max. Einspeiseleistung')} kW. `
      + `Die Kurzschlussleistung am Netzanschlusspunkt liegt nicht vor, deshalb wurde nur die Anschlusskapazität geprüft.`);
  } else if (sk) {
    absaetze.push(`Es wurde ${spannung}. Eine zulässige Einspeiseleistung am Netzanschlusspunkt ist nicht angegeben, `
      + `deshalb wurde nur das Spannungsband geprüft.`);
  } else {
    absaetze.push(`Weder die zulässige Einspeiseleistung (${ggTextFeld('', 'max. Einspeiseleistung')} kW) noch die `
      + `Kurzschlussleistung am Netzanschlusspunkt (Sk″ = ${ggTextFeld('', 'Sk″')} kVA) liegen vor; die Netzverträglichkeit `
      + `konnte daher nicht bewertet werden. Beide Angaben sind beim Netzbetreiber anzufragen.`);
  }

  const gruppe = ampel => kanon.filter(v => v.rueck.ampel === ampel);
  const namen = liste => ggAufzaehlung(liste.map(ggPvName));
  const einzahl = liste => liste.length === 1;
  const gruen = gruppe('gruen'), gelb = gruppe('gelb'), rot = gruppe('rot');
  const ergebnis = [];
  if (gruen.length) {
    ergebnis.push(`${einzahl(gruen) ? 'Die Variante' : 'Die Varianten'} ${namen(gruen)} `
      + `${einzahl(gruen) ? 'lässt' : 'lassen'} sich ohne weitere Maßnahmen am bestehenden Netzanschluss betreiben.`);
  }
  if (gelb.length) {
    const gruende = [
      gelb.some(v => v.rueck.capRatio > 0.7) && 'mehr als 70 % der Anschlusskapazität',
      gelb.some(v => v.rueck.deltaU != null && v.rueck.deltaU > budget * 2 / 3) && 'mehr als zwei Drittel der zulässigen Spannungsanhebung',
    ].filter(Boolean);
    ergebnis.push(`Bei ${einzahl(gelb) ? 'der Variante' : 'den Varianten'} ${namen(gelb)} erreicht die Rückspeisung `
      + `${gruende.join(' bzw. ')}. ${einzahl(gelb) ? 'Sie ist' : 'Sie sind'} im Netzanschlussverfahren gesondert zu prüfen.`);
  }
  if (rot.length) {
    const kap = rot.some(v => v.rueck.capRatio > 1);
    const du = rot.some(v => v.rueck.deltaU != null && v.rueck.deltaU > budget);
    const massnahmen = [
      kap && 'eine Erhöhung der Einspeiseleistung am Netzanschlusspunkt',
      'ein eigenes Erzeugungsnetz',
      du && 'ein Anschluss auf höherer Spannungsebene',
    ].filter(Boolean);
    ergebnis.push(`Bei ${einzahl(rot) ? 'der Variante' : 'den Varianten'} ${namen(rot)} überschreitet die Rückspeisung `
      + `${ggAufzaehlung([kap && 'die Anschlusskapazität', du && 'die zulässige Spannungsanhebung'].filter(Boolean))}. `
      + `${einzahl(rot) ? 'Für diese Auslegung ist' : 'Für diese Auslegungen ist'} `
      + `${massnahmen.slice(0, -1).join(', ')} oder ${massnahmen[massnahmen.length - 1]} erforderlich; dies ist mit dem `
      + `Netzbetreiber abzustimmen (vgl. Kapitel 3.4.1).`);
  }
  ergebnis.push('Diese Abschätzung ersetzt keine Netzverträglichkeitsprüfung durch den Netzbetreiber.');
  absaetze.push(ergebnis.join(' '));
  return ggTextBlatt(absaetze, T);
}

/** 3.4.2 Teil 5 — Abgrenzung zu 3.5 und Modellgrenzen. */
function ggRenderPvAbgrenzungText(cfg, T = GG_THEME) {
  void cfg;
  return ggTextBlatt([
    `Die wirtschaftliche Bewertung folgt in Kapitel 3.5. Die Berechnung beruht auf einem einzigen Wetterjahr und `
      + `berücksichtigt keine Alterung von Modulen und Speichern. Die Leistungsbegrenzung der Wechselrichter ist nicht `
      + `abgebildet, die Rückspeiseleistungen sind deshalb eher zu hoch als zu niedrig angesetzt. Alle `
      + `Berechnungsannahmen stehen in Anlage ${ggTextFeld('', 'Nr. Anlage Berechnungsannahmen')}.`,
  ], T);
}

/** Figur „Einlinienschema Bestandsnetz" — quelle 'variante' oder 'eigene' (übernommene Belegung). */
function ggEinlinienFigur(id, reihe, quelle, titel, hinweis) {
  return {
    id, autoSync: true, reihe, kapitel: GG_PV_KAPITEL, titel, datei: id, hinweis,
    render: cfg => ggRenderEinlinienschema(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten', titel, ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      leer: 'Kein Netzmodell mit Trafo und PV-Flächen — in ☀ PV-Analyse „Netzaufnahme (Bestand)" berechnen.',
      schema: null, fussnote: '', kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      if (quelle === 'eigene' && !window._pvAnalyse?.eigeneBelegung?.belegung) {
        cfg.schema = null; cfg.kpiLinks = []; cfg.kpiRechts = []; cfg.fussnote = '';
        cfg.leer = 'Keine eigene Belegung übernommen — im Einlinienschema „Als Variante übernehmen".';
        return '⚠ Keine eigene Belegung übernommen.';
      }
      const d = window.pvnaSchemaDruck?.({ quelle });
      if (!d) {
        cfg.schema = null; cfg.kpiLinks = []; cfg.kpiRechts = []; cfg.fussnote = '';
        return '⚠ Kein Netzmodell mit Trafo und PV-Flächen.';
      }
      const k = d.kennzahlen;
      cfg.schema = { breite: d.breite, hoehe: d.hoehe, zeichnung: d.zeichnung };
      cfg.kpiLinks = [
        { wert: ggNum(k.summeKwp) + ' kWp', label: quelle === 'eigene' ? 'Belegung (eigene)' : 'Aufnahme ohne Ertüchtigung' },
        { wert: ggNum(k.anteilPct) + ' %', label: `des Flächenpotenzials von ${ggNum(k.potenzialKwp)} kWp` },
      ];
      cfg.kpiRechts = [
        { wert: ggNum(k.maxTrafoPct) + ' %', label: 'höchste Trafo-Auslastung' },
        { wert: ggNum(k.maxDuPct, 2) + ' %', label: `höchste Spannungsanhebung (Grenze ${ggNum(k.duGrenzePct, 1)} %)`,
          highlight: !k.zulaessig },
      ];
      cfg.fussnote = `${d.belegungLabel} · Lastfall: volle Einspeisung ${ggNum(k.einspFaktor, 2)} kW/kWp ohne gleichzeitige Last, `
        + `Rechenjahr ${k.jahr}`
        + (k.unbekannteQs ? ` · ${k.unbekannteQs} Kabel ohne erfassten Querschnitt${k.ersatzQs ? ` (angenommen ${k.ersatzQs} mm² NAYY)` : ' (ohne Grenze gerechnet)'}` : '')
        + (k.massnahmen ? ` · ${k.massnahmen} Ertüchtigung${k.massnahmen > 1 ? 'en' : ''} umgesetzt` : '');
      return `✓ Einlinienschema übernommen: ${ggNum(k.summeKwp)} kWp, ${k.engpaesse} Engpass${k.engpaesse === 1 ? '' : 'stellen'}`
        + (k.zulaessig ? '.' : ' — Netz hält bei dieser Belegung nicht.');
    },
  };
}

function ggPvFiguren() {
  const pvText = (id, reihe, titel, hinweis, render) => ({
    id, istText: true, pvText: true, reihe, kapitel: GG_PV_KAPITEL, titel, datei: id, hinweis, render, config: {},
  });
  return [
    // ── Gutachtentexte 3.4.2 — `reihe` verzahnt sie im Standarddokument mit den Abbildungen ──
    pvText('pv-grundlagen-text', 10, 'Gutachtentext: PV-Datenbasis und Auslegungen',
      'Einleitung zu 3.4.2: Lastgang, Erzeugungsprofil, PV-Potenzial und die fünf Auslegungen mit ihren Größen. '
      + 'Steht vor der Herleitungs-Abbildung. Der Satz zur 100-kWp-Schwelle gibt einen EEG-Stand wieder — vor Abgabe prüfen.',
      cfg => ggRenderPvGrundlagenText(cfg)),
    pvText('pv-energiebilanz-text', 30, 'Gutachtentext: PV-Energiebilanz',
      'Spannweiten von Jahresertrag, Eigenverbrauchsquote und Autarkie sowie die Abregelung am Einspeiselimit. '
      + 'Steht vor Variantentabelle und Energiebilanz-Abbildung.',
      cfg => ggRenderPvEnergiebilanzText(cfg)),
    pvText('pv-speicher-text', 60, 'Gutachtentext: Batteriespeicher',
      'Speichermodell der Simulation (Wirkungsgrad, Leistung), Betriebsweise und Aufstellort. Speichertechnologie und '
      + 'Aufstellort erfasst das Tool nicht — sie bleiben als Platzhalter offen und werden in Word ergänzt.',
      cfg => ggRenderPvSpeicherText(cfg)),
    pvText('pv-netz-text', 70, 'Gutachtentext: Netzintegration PV',
      'Rückspeisespitze je Variante und ihre Bewertung gegen Anschlusskapazität und Spannungsband. Einspeisegrenze und '
      + 'Sk″ werden in der PV-Analyse bei den NAP-Grenzen eingetragen. Steht vor der Abbildung „Rückspeisung und Netzverträglichkeit“.',
      cfg => ggRenderPvNetzText(cfg)),
    pvText('pv-abgrenzung-text', 90, 'Gutachtentext: Abgrenzung und Modellgrenzen PV',
      'Schlussabsatz zu 3.4.2: Verweis auf 3.5 und die Modellgrenzen. Die Anlagennummer der Berechnungsannahmen bleibt '
      + 'offen, bis der Anlagenteil im Editor abgebildet ist.',
      cfg => ggRenderPvAbgrenzungText(cfg)),

    // ── Variantenvergleich ───────────────────────────────────────────────
    {
      id: 'pv-variantenvergleich',
      autoSync: true,
      reihe: 40,
      kapitel: '3.4.2 PV-Anlage und Batteriespeicher',
      titel: 'PV-Varianten im Vergleich',
      datei: 'pv-variantenvergleich',
      hinweis: 'Die 5 kanonischen PV-Varianten aus der ☀ PV-Analyse nebeneinander — jede beantwortet '
             + 'genau eine Stakeholder-Frage (Minimal, Eigenverbrauch, Wirtschaftlichkeit, Autarkie, '
             + 'maximaler Ausbau). Bewusst OHNE Wirtschaftlichkeitskennzahlen: Kapitel 3.4.2 beschreibt '
             + 'die Auslegungen, bewertet wird in 3.5. Grundlage: „Varianten berechnen" in der PV-Analyse.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'PV-Varianten im Vergleich',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        spalten: [
          { label: 'Variante', weight: 2.5 },
          { label: 'PV-Leistung', weight: 1.15 },
          { label: 'Batterie', weight: 1.05 },
          { label: 'Jahresertrag', weight: 1.2 },
          { label: 'Eigenverbrauch', weight: 1.25 },
          { label: 'Autarkie', weight: 1.0 },
          { label: 'Abregelung', weight: 1.1 },
        ],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const kanon = ggPvKanon();
        if (!kanon.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Noch keine PV-Varianten berechnet.'; }
        // Kapitel 3.4.2 beschreibt die Auslegungen — deshalb keine Hervorhebung
        // einer „besten" Variante und keine Euro-Kennzahlen; beides gehört in 3.5.
        const napAktiv = kanon.some(v => (v.sim.curtailMwh || 0) > 0);
        cfg.zeilen = kanon.map(v => ({
          werte: [v.label, ggNum(v.pvKwp) + ' kWp', v.batKwh > 0 ? ggNum(v.batKwh) + ' kWh' : '—',
                  ggNum(v.ertragMwh, 1) + ' MWh', ggNum(v.wirt.pvEigenQuote) + ' %',
                  ggNum(v.wirt.autarkie) + ' %',
                  napAktiv ? ggNum(v.sim.curtailMwh || 0, 1) + ' MWh' : '—'],
          akzent: v.farbe,
        }));
        cfg.fussnote = 'Eigenverbrauch = Anteil der PV-Erzeugung, der vor Ort verbraucht wird. '
                     + 'Autarkie = Anteil des Strombedarfs aus eigener Erzeugung. '
                     + (napAktiv
                        ? 'Abregelung = am Einspeiselimit des Netzanschlusspunktes nicht nutzbare Energie. '
                        : 'Ohne gesetzte Einspeisegrenze wird keine Abregelung ausgewiesen. ')
                     + 'Wirtschaftliche Bewertung siehe Kapitel 3.5.';
        return `✓ ${kanon.length} PV-Varianten aus der PV-Analyse übernommen.`;
      },
    },

    // ── Energiebilanz je Variante (B/D/P — Bedarf/Deckung/PV-Verbleib) ───
    {
      id: 'pv-energiebilanz',
      autoSync: true,
      reihe: 50,
      kapitel: '3.4.2 PV-Anlage und Batteriespeicher',
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
      reihe: 40,   // 3.5: nach Kostentext, Kostentabelle und den beiden Kostendiagrammen
      kapitel: '3.5 Wirtschaftlichkeit und Investitionskosten',
      titel: 'Wirtschaftlichkeit je PV-Variante',
      datei: 'pv-wirtschaftlichkeit',
      hinweis: 'Investition, jährlicher Netto-Überschuss, Amortisation, Kapitalwert und '
             + 'Stromgestehungskosten je Variante — die für den Gutachten-Adressaten entscheidenden '
             + 'Kennzahlen. Der Kapitalwert ist die von § 7 BHO erwartete Größe.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Wirtschaftlichkeit je PV-Variante',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        spalten: [
          { label: 'Variante', weight: 2.3 },
          { label: 'Investition', weight: 1.25 },
          { label: 'Jahresüberschuss', weight: 1.4 },
          { label: 'Amortisation', weight: 1.1 },
          { label: 'Kapitalwert', weight: 1.3 },
          { label: 'Stromgestehung', weight: 1.2 },
        ],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const kanon = ggPvKanon();
        if (!kanon.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Noch keine PV-Varianten berechnet.'; }
        const p = window._pvAnalyse?.lastParams;
        const nutz = p?.pvLife || 20;
        cfg.zeilen = kanon.map(v => {
          const ueberschuss = -v.wirt.nettoJk;
          const kw = v.wirt.kapitalwert;
          return {
            werte: [v.label, ggNum(v.wirt.investGes) + ' €',
                    (ueberschuss >= 0 ? '+' : '−') + ggNum(Math.abs(ueberschuss)) + ' €/a',
                    isFinite(v.wirt.amort) ? ggNum(v.wirt.amort, 1) + ' a' : '> ' + ggNum(nutz) + ' a',
                    kw != null ? (kw >= 0 ? '+' : '−') + ggNum(Math.abs(kw)) + ' €' : '—',
                    v.wirt.lcoeCt != null ? ggNum(v.wirt.lcoeCt, 1) + ' ct/kWh' : '—'],
            highlight: v.id === 'wirt-opt', akzent: v.farbe,
          };
        });
        cfg.fussnote = 'Investition inkl. Netzanschluss-Infrastruktur. Jahresüberschuss = Erlöse (Eigenverbrauchs'
                      + 'ersparnis + Einspeisung) minus alle Jahreskosten (Kapitaldienst, Betrieb, Infrastruktur). '
                      + 'Amortisation statisch: Investition ÷ jährlicher Rückfluss (Erlöse − laufende Betriebskosten). '
                      + 'Kapitalwert: Barwert des Jahresüberschusses über ' + ggNum(nutz) + ' Jahre bei '
                      + ggNum((p?.zins || 0.035) * 100, 1) + ' % Zins. Stromgestehungskosten: Jahreskosten ÷ genutzter '
                      + 'Energie (Eigenverbrauch + Einspeisung). Hervorgehoben: höchster Jahres-Netto-Überschuss.';
        return `✓ ${kanon.length} PV-Varianten aus der PV-Analyse übernommen.`;
      },
    },

    // ── Herleitung der Varianten (Kapitel 3.4.2) ─────────────────────────
    {
      id: 'pv-herleitung',
      autoSync: true,
      reihe: 20,
      kapitel: '3.4.2 PV-Anlage und Batteriespeicher',
      titel: 'Herleitung der Auslegungsvarianten',
      datei: 'pv-herleitung',
      hinweis: 'Belegt, warum die gewählten Auslegungen die jeweiligen Optima sind: gezeichnet wird die '
             + 'tatsächliche Suchspur der Optimierung mit dem Punkt, an dem das Kriterium reißt. '
             + 'Grundlage: „Varianten berechnen" in der ☀ PV-Analyse.',
      render: cfg => ggRenderHerleitung(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Herleitung der Auslegungsvarianten', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: '', achseX: 'Je Variante das Kriterium, aus dem sich die Auslegung ergibt',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        panels: [], kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');

        const H = window._pvAnalyse?.herleitung;
        const kanon = ggPvKanon();
        if (!H || !kanon.length) { cfg.panels = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Noch keine PV-Varianten berechnet.'; }
        const vOf = (id) => kanon.find(v => v.id === id);
        const panels = [];

        // 1 · Eigenverbrauchs-Optimum: Quotenschwelle
        const vEv = vOf('ev-opt');
        if (vEv && H.evOpt?.punkte?.length > 1) {
          const pts = H.evOpt.punkte;
          const gew = pts.find(q => q.kwp === H.evOpt.gewaehlt) || pts[0];
          const brk = pts.find(q => q.quote < H.evOpt.schwelle);
          const yMin = Math.max(0, Math.floor(Math.min(H.evOpt.schwelle, ...pts.map(q => q.quote)) - 3));
          panels.push({
            titel: 'Eigenverbrauchs-optimiert', kriterium: `größte Anlage mit Quote ≥ ${ggNum(H.evOpt.schwelle)} %`,
            farbe: vEv.farbe, xEinheit: 'kWp',
            punkte: pts.map(q => ({ x: q.kwp, y: q.quote })),
            xMax: pts[pts.length - 1].kwp, yMin, yMax: 100,
            schwelle: { y: H.evOpt.schwelle, label: `Kriterium ${ggNum(H.evOpt.schwelle)} %` },
            marker: { x: gew.kwp, y: gew.quote, label: `${ggNum(gew.kwp)} kWp` },
            brk: brk ? { x: brk.kwp, y: brk.quote, label: `${ggNum(brk.quote, 1)} %` } : null,
          });
        }

        // 2 · Wirtschaftliches Optimum: Maximum des Jahresüberschusses
        const vWirt = vOf('wirt-opt');
        if (vWirt && H.wirtOpt?.punkte?.length > 1) {
          const pts = H.wirtOpt.punkte;
          const best = pts.reduce((a, b) => (b.ueber > a.ueber ? b : a), pts[0]);
          const uMin = Math.min(0, ...pts.map(q => q.ueber));
          panels.push({
            titel: 'Wirtschaftlich optimiert', kriterium: 'höchster Jahres-Netto-Überschuss',
            farbe: vWirt.farbe, xEinheit: 'kWp',
            punkte: pts.map(q => ({ x: q.kwp, y: q.ueber / 1000 })),
            xMax: pts[pts.length - 1].kwp,
            yMin: Math.floor(uMin / 1000), yMax: Math.ceil(Math.max(...pts.map(q => q.ueber)) / 1000),
            marker: { x: best.kwp, y: best.ueber / 1000, label: `${ggNum(best.kwp)} kWp` },
          });
        }

        // 3 · Autarkie-Optimum: Sättigung des Speicherzubaus
        const vAut = vOf('autarkie');
        if (vAut && H.autarkie?.punkte?.length > 1) {
          const pts = H.autarkie.punkte;
          const gew = pts.find(q => q.bat === H.autarkie.gewaehlt) || pts[pts.length - 1];
          const stopp = pts.find(q => q.marg != null && q.marg < H.autarkie.schwelle);
          panels.push({
            titel: 'Autarkie-optimiert', kriterium: `Speicher bis zur Sättigung (< ${ggNum(H.autarkie.schwelle, 1)} %-Pkt./MWh)`,
            farbe: vAut.farbe, xEinheit: 'MWh',
            punkte: pts.map(q => ({ x: q.bat / 1000, y: q.aut })),
            xMax: pts[pts.length - 1].bat / 1000,
            yMin: Math.floor(Math.min(...pts.map(q => q.aut))), yMax: Math.ceil(Math.max(...pts.map(q => q.aut))),
            marker: { x: gew.bat / 1000, y: gew.aut, label: `${ggNum(gew.bat / 1000, 1)} MWh` },
            brk: stopp ? { x: stopp.bat / 1000, y: stopp.aut, label: 'Sättigung' } : null,
          });
        }

        cfg.panels = panels;
        cfg.kpiLinks = [
          { wert: vEv ? ggNum(vEv.pvKwp) + ' kWp' : '—', label: 'Eigenverbrauchs-Optimum' },
          { wert: vWirt ? ggNum(vWirt.pvKwp) + ' kWp' : '—', label: 'Wirtschaftliches Optimum (PV)' },
        ];
        cfg.kpiRechts = [
          { wert: vWirt && vWirt.batKwh > 0 ? ggNum(vWirt.batKwh) + ' kWh' : '—', label: 'Speicher im wirtschaftlichen Optimum' },
          { wert: vAut ? ggNum(vAut.wirt.autarkie, 1) + ' %' : '—', label: 'Technisch maximale Autarkie', highlight: true },
        ];
        return `✓ ${panels.length} Herleitungen aus der PV-Analyse übernommen.`;
      },
    },

    // ── Einlinienschema Bestandsnetz (Kapitel 3.4.2) ──────────────────────
    ggEinlinienFigur('pv-einlinienschema', 25, 'variante', 'Einlinienschema Bestandsnetz',
      'Wie viel PV das bestehende Netz ohne Ertüchtigung aufnimmt und wo es begrenzt: Auslastung der Kabel und '
      + 'Transformatoren, Spannungsanhebung an den Knoten, Engpässe markiert. Belegung der Variante „Bestandsnetz". '
      + 'Grundlage: ☀ PV-Analyse › Netzaufnahme (Bestand) / Einlinienschema.'),
    ggEinlinienFigur('pv-einlinienschema-eigen', 26, 'eigene', 'Einlinienschema Bestandsnetz — eigene Belegung',
      'Wie oben, aber mit der im Einlinienschema übernommenen eigenen Belegung (samt gewählter Ertüchtigungen). '
      + 'Nur sinnvoll, wenn dort „Als Variante übernehmen" genutzt wurde.'),

    // ── Rückspeisung & Netzverträglichkeit (Kapitel 3.4.2) ────────────────
    {
      id: 'pv-rueckspeisung',
      autoSync: true,
      reihe: 80,
      kapitel: '3.4.2 PV-Anlage und Batteriespeicher',
      titel: 'Rückspeisung und Netzverträglichkeit',
      datei: 'pv-rueckspeisung',
      hinweis: 'Die gleichzeitige Rückspeiseleistung am Netzanschlusspunkt je Variante, gemessen an der '
             + 'Anschlusskapazität und am zulässigen Spannungsband. Ungekappt gerechnet — zeigt die '
             + 'tatsächlich benötigte Anschlussleistung, nicht die künstlich begrenzte.',
      render: cfg => ggRenderRueckAmpel(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Rückspeisung und Netzverträglichkeit', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Rückspeiseleistung in kW', achseX: 'Ausbauvariante',
        leer: 'Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen" klicken.',
        kategorien: [], balken: [], grenzen: [], kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');

        const kanon = ggPvKanon().filter(v => v.rueck);
        if (!kanon.length) { cfg.kategorien = []; cfg.balken = []; cfg.grenzen = []; return '⚠ Noch keine Rückspeise-Bewertung vorhanden.'; }

        const T = GG_THEME;
        const ampelFarbe = { gruen: T.accents.gruen, gelb: T.energy.gas, rot: T.energy.waerme, na: T.text.faint };
        cfg.kategorien = kanon.map(v => `${v.icon} ${GG_PV_KURZ[v.id] || v.label}`);
        cfg.balken = kanon.map(v => ({ wert: v.rueck.maxKw, farbe: ampelFarbe[v.rueck.ampel] || T.text.faint }));

        const r0 = kanon[0].rueck;
        const grenzen = [];
        if (r0.anschlussKw > 0) {
          grenzen.push({ wert: r0.anschlussKw, farbe: T.energy.waerme,
                         label: `Anschlusskapazität ${ggNum(r0.anschlussKw)} kW` });
        }
        if (r0.skKVA > 0 && r0.uBudgetPct > 0) {
          // Δu = 100 · P / S_k″  ⇒  die Leistung, bei der das Spannungsband ausgeschöpft ist
          grenzen.push({ wert: r0.skKVA * r0.uBudgetPct / 100, farbe: T.energy.gas,
                         label: `Spannungsband ${ggNum(r0.uBudgetPct, 1)} % ≙ ${ggNum(r0.skKVA * r0.uBudgetPct / 100)} kW` });
        }
        cfg.grenzen = grenzen;

        const schaerfste = kanon.reduce((a, b) =>
          (['gruen', 'gelb', 'rot'].indexOf(b.rueck.ampel) > ['gruen', 'gelb', 'rot'].indexOf(a.rueck.ampel) ? b : a));
        const groesste = kanon.reduce((a, b) => (b.rueck.maxKw > a.rueck.maxKw ? b : a));
        const kritisch = kanon.filter(v => v.rueck.ampel === 'rot').length;
        cfg.kpiLinks = [
          { wert: ggNum(groesste.rueck.maxKw) + ' kW', label: `Höchste Rückspeisespitze (${groesste.label})` },
          { wert: groesste.rueck.deltaU != null ? ggNum(groesste.rueck.deltaU, 2) + ' %' : '—', label: 'Zugehörige Spannungsanhebung Δu' },
        ];
        cfg.kpiRechts = [
          { wert: r0.anschlussKw > 0 ? ggNum(r0.anschlussKw) + ' kW' : 'unbegrenzt', label: 'Vorhandene Einspeise-Anschlussleistung' },
          { wert: String(kritisch), label: kritisch === 1 ? 'Variante erfordert Netzausbau' : 'Varianten erfordern Netzausbau',
            highlight: kritisch > 0 },
        ];
        return `✓ ${kanon.length} Varianten bewertet · schärfste Einstufung: ${schaerfste.rueck.ampel}.`;
      },
    },

    // ── Versorgungslücke im Jahresverlauf (Kapitel 5.2) ──────────────────
    {
      id: 'res-jahresraster',
      autoSync: true,
      kapitel: '5.2 Bewertung Resilienz',
      titel: 'Versorgungslücke je Ausfallzeitpunkt',
      datei: 'resilienz-jahresraster',
      hinweis: 'Für JEDE Stunde des Jahres simuliert: wie viele Stunden des betrachteten Ausfallfensters '
             + 'könnten PV und Speicher allein nicht decken. Zeigt, dass es keine einzelne '
             + 'Überbrückungsdauer gibt, sondern eine Verteilung — und wo der ungünstigste Zeitpunkt liegt. '
             + 'Grundlage: Abb. 10 „Resilienz" in der ☀ PV-Analyse.',
      render: cfg => ggRenderHeatmap(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Versorgungslücke je Ausfallzeitpunkt', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Beginn des Ausfalls (Uhrzeit)', achseX: 'Beginn des Ausfalls (Tag im Jahr)',
        leer: 'Noch keine Resilienz-Berechnung — Abb. 10 „Resilienz" in der PV-Analyse öffnen.',
        grid: null, maxV: 1, einheit: 'h', legendeLabel: 'Stunden ohne Deckung aus PV und Speicher',
        kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');

        const r = window._pvResReco;
        if (!r?.luecke?.werte?.length) { cfg.grid = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Noch keine Resilienz-Berechnung vorhanden.'; }

        const werte = r.luecke.werte;
        cfg.grid = werte;
        cfg.maxV = r.luecke.durH;
        cfg.titel = `Versorgungslücke je Ausfallzeitpunkt (${r.luecke.durH}-h-Ausfall)`;

        let ohne = 0, summe = 0, max = 0;
        for (const v of werte) { if (v <= 0.001) ohne++; summe += v; if (v > max) max = v; }
        const anteilVoll = werte.length > 0 ? ohne / werte.length * 100 : 0;
        cfg.kpiLinks = [
          { wert: ggNum(anteilVoll) + ' %', label: 'der Ausfallzeitpunkte vollständig aus PV und Speicher gedeckt' },
          { wert: ggNum(summe / Math.max(1, werte.length), 1) + ' h', label: 'mittlere Lücke über alle Zeitpunkte' },
        ];
        cfg.kpiRechts = [
          { wert: ggNum(max) + ' h', label: 'größte Lücke (ungünstigster Zeitpunkt)' },
          { wert: r.nHours ? ggPvTagLabel(r.worstStart) : '—', label: 'Ungünstigster Ausfallbeginn', highlight: true },
        ];
        return `✓ Jahresraster aus der Resilienz-Simulation übernommen (${r.luecke.durH}-h-Fenster).`;
      },
    },

    // ── Verlauf im Ausfallfenster (Kapitel 5.2) ──────────────────────────
    {
      id: 'res-fensterverlauf',
      autoSync: true,
      reihe: 30,   // 3.4.3: nach Auslegungstext, Soll-Ist-Tabelle und Lastabwurf-Text
      kapitel: '3.4.3 Notstromversorgung und Lastmanagement',   // Auslegung; die Bewertung bleibt in 5.2
      titel: 'Lastdeckung im Ausfallfenster',
      datei: 'resilienz-fensterverlauf',
      hinweis: 'Stunde für Stunde durch das betrachtete Ausfallfenster: wer trägt die Last — PV, Speicher '
             + 'oder Notstromaggregat — und bleibt eine Lücke. Der Beleg für die Auslegung in 3.4.3. '
             + 'Grundlage: Abb. 10 „Resilienz" in der ☀ PV-Analyse.',
      render: cfg => ggRenderBalken(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Lastdeckung im Ausfallfenster', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Leistung in kW', achseX: 'Stunde des Ausfalls',
        leer: 'Noch keine Resilienz-Berechnung — Abb. 10 „Resilienz" in der PV-Analyse öffnen.',
        kategorien: [], gruppen: [], kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');

        const r = window._pvResReco;
        if (!r?.fenster?.length) { cfg.kategorien = []; cfg.gruppen = []; return '⚠ Noch keine Resilienz-Berechnung vorhanden.'; }

        // Lange Fenster (mehrere Tage) auf höchstens 48 Säulen zusammenfassen —
        // sonst wird die Abbildung im Word-Satz zum Strichmuster.
        const roh = r.fenster;
        const bucket = Math.max(1, Math.ceil(roh.length / 48));
        const pv = [], bat = [], gen = [], luecke = [], kat = [];
        for (let i = 0; i < roh.length; i += bucket) {
          const teil = roh.slice(i, i + bucket);
          const mit = (f) => teil.reduce((a, x) => a + f(x), 0) / teil.length;
          pv.push(mit(x => x.pv)); bat.push(mit(x => x.bat));
          gen.push(mit(x => x.gen)); luecke.push(mit(x => x.luecke));
          kat.push(bucket === 1 ? String(i) : `${i}–${Math.min(roh.length, i + bucket) - 1}`);
        }

        cfg.kategorien = kat;
        cfg.gruppen = [{ label: 'Deckung', segmente: [
          { label: 'PV',                farbe: GG_THEME.accents.gruen,      werte: pv },
          { label: 'Speicher',          farbe: GG_THEME.energy.strom,       werte: bat },
          { label: 'Notstromaggregat',  farbe: GG_THEME.energy.gas,         werte: gen },
          { label: 'ungedeckt',         farbe: GG_THEME.energy.waerme,      werte: luecke },
        ]}];
        cfg.achseX = bucket === 1 ? 'Stunde nach Ausfallbeginn'
                                  : `Stunde nach Ausfallbeginn (je Säule ${bucket} h gemittelt)`;
        cfg.titel = `Lastdeckung im ${r.durH}-h-Ausfallfenster`;

        const sum = (a) => a.reduce((x, y) => x + y, 0) * bucket;
        cfg.kpiLinks = [
          { wert: r.nHours ? ggPvTagLabel(r.isWorst ? r.worstStart : r.selStart) : '—',
            label: r.isWorst ? 'Ausfallbeginn (ungünstigster Zeitpunkt)' : 'Ausfallbeginn (gewählt)' },
          { wert: ggNum(r.eLoadMwh, 2) + ' MWh', label: 'Energiebedarf im Fenster' },
        ];
        cfg.kpiRechts = [
          { wert: r.genKw > 0 ? ggNum(r.genKw) + ' kW' : 'keines', label: 'Empfohlene Notstromleistung' },
          { wert: sum(luecke) > 0.5 ? ggNum(sum(luecke) / 1000, 2) + ' MWh' : 'keine',
            label: 'Verbleibende Versorgungslücke', highlight: sum(luecke) > 0.5 },
        ];
        return `✓ Verlauf des ${r.durH}-h-Fensters übernommen.`;
      },
    },

    // ── Resilienz je Ausbauvariante (Kapitel 5.2) ────────────────────────
    {
      id: 'res-varianten',
      autoSync: true,
      kapitel: '5.2 Bewertung Resilienz',
      titel: 'Resilienz je Ausbauvariante',
      datei: 'resilienz-varianten',
      hinweis: 'Was die fünf PV-Auslegungen aus Kapitel 3.4.2 im Blackout leisten: wie viel des '
             + 'Ausfallfensters sie im Mittel über ALLE Ausfallzeitpunkte des Jahres aus PV und Speicher '
             + 'allein tragen und ab wann das Notstromaggregat einspringen muss. Die Aggregatleistung '
             + 'ist dagegen am ungünstigsten Zeitpunkt der jeweiligen Variante bemessen. '
             + 'Grundlage: „Varianten vergleichen" in Abb. 10 „Resilienz".',
      render: cfg => ggRenderBalken(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Resilienz je Ausbauvariante', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Stunden des Ausfallfensters (Mittel)', achseX: 'Ausbauvariante',
        leer: 'Noch kein Variantenvergleich — in Abb. 10 „Resilienz" auf „Varianten vergleichen" klicken.',
        kategorien: [], gruppen: [], kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');

        const v = window._pvResVarianten;
        if (!v?.zeilen?.length) { cfg.kategorien = []; cfg.gruppen = []; return '⚠ Noch kein Variantenvergleich vorhanden.'; }

        const durH = v.durH;
        cfg.kategorien = v.zeilen.map(z => `${z.icon} ${GG_PV_KURZ[z.id] || z.label}`);
        // Bewusst der MITTELWERT über alle Ausfallzeitpunkte, nicht der Worst Case:
        // dort steht die Batterie ohnehin leer, alle Varianten sähen gleich aus.
        const mittel = z => Math.min(durH, z.bridgeMittel ?? z.bridgeH ?? 0);
        cfg.gruppen = [{ label: 'Ausfallfenster', segmente: [
          { label: 'im Mittel aus PV und Speicher getragen', farbe: GG_THEME.accents.gruen,
            werte: v.zeilen.map(mittel) },
          { label: 'im Mittel mit Notstromaggregat zu decken', farbe: GG_THEME.energy.gas,
            werte: v.zeilen.map(z => Math.max(0, durH - mittel(z))) },
        ]}];
        cfg.titel = `Resilienz je Ausbauvariante (${durH}-h-Ausfall)`;
        cfg.achseX = `Ausbauvariante · ${GG_RES_MODE_LBL[v.mode] || v.mode} · ${ggNum(v.frac * 100)} % Notbetriebslast`;

        const beste = v.zeilen.reduce((a, b) => ((b.anteilVoll ?? 0) > (a.anteilVoll ?? 0) ? b : a));
        const groesstesAggregat = v.zeilen.reduce((a, b) => (b.recGenKw > a.recGenKw ? b : a));
        const kleinstesAggregat = v.zeilen.filter(z => z.recGenKw > 0)
          .reduce((a, b) => (b.recGenKw < a.recGenKw ? b : a), { recGenKw: Infinity, label: '—' });
        cfg.kpiLinks = [
          { wert: ggNum(beste.anteilVoll ?? 0) + ' %',
            label: `Ausfallzeitpunkte ohne Notstrom gedeckt — Bestwert (${beste.label})` },
          { wert: ggNum(durH) + ' h', label: 'Betrachtete Ausfalldauer' },
        ];
        cfg.kpiRechts = [
          { wert: isFinite(kleinstesAggregat.recGenKw) ? ggNum(kleinstesAggregat.recGenKw) + ' kW' : '—',
            label: `Kleinstes ausreichendes Aggregat (${kleinstesAggregat.label})` },
          { wert: groesstesAggregat.recGenKw > 0 ? ggNum(groesstesAggregat.recGenKw) + ' kW' : 'keines',
            label: `Größtes benötigtes Aggregat (${groesstesAggregat.label})`, highlight: true },
        ];
        return `✓ ${v.zeilen.length} Varianten aus dem Resilienz-Vergleich übernommen.`;
      },
    },

    // ── Resilienz-Zusammenfassung ─────────────────────────────────────────
    {
      id: 'pv-resilienz',
      autoSync: true,
      kapitel: '5.2 Bewertung Resilienz',
      titel: 'Resilienz — Autarkie bei Netzausfall',
      datei: 'pv-resilienz-zusammenfassung',
      hinweis: 'Zusammenfassung der zuletzt in ☀ PV-Analyse › Abb. 10 „Resilienz“ betrachteten Inselbetrieb-Auslegung: '
             + 'wie lange trägt PV/Batterie/Notstrom einen Blackout zum ungünstigsten Zeitpunkt im Jahr. '
             + 'Erst Abb. 10 in der PV-Analyse öffnen, dann hierher „Aus Projekt übernehmen“. Gebäude, Netz und Schutzziele: 🛡 Blackout-Modus.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Resilienz — Autarkie bei Netzausfall',
        leer: 'Noch keine Resilienz-Berechnung — in der ☀ PV-Analyse Abb. 10 „Resilienz“ öffnen (rechnet automatisch auf den PV-Varianten).',
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
                      + 'Ladestand aus der Jahressimulation, das Notstromaggregat deckt die Restlast. Stand aus der PV-Analyse, Abb. 10.';
        return '✓ Resilienz-Kennzahlen aus der PV-Analyse (Abb. 10) übernommen.';
      },
    },

    // ── Blackout-Modus (26): Werkzeug, Schutzziele, Maßnahmen ───────────
    {
      id: 'res-bewertungstool-text',
      istText: true,
      kapitel: '5.1 Erläuterung Bewertungstool Resilienz',
      titel: 'Gutachtentext: Bewertungswerkzeug Resilienz',
      datei: 'resilienz-bewertungstool-text',
      hinweis: 'Standardtext zur Vorgehensweise des 🛡 Blackout-Modus (Elektro › Auswerten › Resilienz): '
             + 'Notstromklassen, Platzierung am Netz, Liegenschafts-Insel, Wärme und Schutzziele.',
      render: cfg => ggRenderResWerkzeugText(cfg),
      config: {},
    },
    {
      id: 'res-ziele-text',
      istText: true,
      kapitel: '5.2 Bewertung Resilienz',
      titel: 'Gutachtentext: Bewertung der Schutzziele',
      datei: 'resilienz-schutzziele-text',
      hinweis: 'Bewertung der Schutzziele aus dem Reiter „Ziele" des 🛡 Blackout-Modus. Ändern sich Klassen, Netz, '
             + 'Einstellungen oder Ziele, rechnet der Text beim Zeichnen neu.',
      render: cfg => ggRenderResZieleText(cfg),
      config: {},
    },
    {
      id: 'res-ist-text',
      istText: true,
      kapitel: '5.2.1 Ist-Zustand',
      titel: 'Gutachtentext: Resilienz Ist-Zustand',
      datei: 'resilienz-ist-zustand-text',
      hinweis: 'Bestand an Netzersatzanlagen, Notstromklassen der Gebäude und Wärmeversorgung ohne Notstrom — aus dem 🛡 Blackout-Modus.',
      render: cfg => ggRenderResIstText(cfg),
      config: {},
    },
    {
      id: 'res-kurz-text',
      istText: true,
      kapitel: '5.2.2 Kurzfristige Maßnahmen',
      titel: 'Gutachtentext: Kurzfristige Maßnahmen Resilienz',
      datei: 'resilienz-kurzfristig-text',
      hinweis: 'Organisatorische und kleine Maßnahmen: Einspeisepunkte Klasse C, Schaltanweisungen, Notstrom der Heizzentrale, '
             + 'Heizölbevorratung, Probeläufe, Notfallplan — aus dem 🛡 Blackout-Modus.',
      render: cfg => ggRenderResKurzText(cfg),
      config: {},
    },
    {
      id: 'res-lang-text',
      istText: true,
      kapitel: '5.2.3 Langfristige Maßnahmen (Umsetzung der Empfehlung im Gutachten)',
      titel: 'Gutachtentext: Langfristige Maßnahmen Resilienz',
      datei: 'resilienz-langfristig-text',
      hinweis: 'Umsetzung des empfohlenen Schutzziels — im 🛡 Blackout-Modus unter „Ziele" mit ☆ markieren.',
      render: cfg => ggRenderResLangText(cfg),
      config: {},
    },
    {
      id: 'res-ziele-matrix',
      autoSync: true,
      reihe: 1,
      kapitel: '5.2 Bewertung Resilienz',
      titel: 'Maßnahmen je Schutzziel',
      datei: 'resilienz-massnahmen-je-schutzziel',
      hinweis: 'Maßnahmen und Richtkosten je Schutzziel aus dem Reiter „Ziele" des 🛡 Blackout-Modus.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz', titel: 'Maßnahmen je Schutzziel', tabelleTitel: 'Maßnahmen je Schutzziel',
        leer: 'Noch keine Schutzziele — im 🛡 Blackout-Modus den Reiter „Ziele" öffnen.',
        spalten: [{ label: 'Maßnahme', weight: 1.6 }], zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const erg = ggResZiele();
        if (!erg?.bewertungen?.length) {
          cfg.spalten = [{ label: 'Maßnahme', weight: 1.6 }];
          cfg.zeilen = [];
          cfg.fussnote = '';
          return '⚠ Noch keine Schutzziele bewertet.';
        }
        const m = erg.matrix;
        cfg.spalten = [{ label: 'Maßnahme', weight: 1.6 }, ...m.spalten.map(t => ({ label: t, weight: 1.4 }))];
        cfg.zeilen = m.zeilen.map(z => ({ werte: [z.label, ...z.werte], highlight: !!z.highlight }));
        cfg.fussnote = 'Richtwerte netto. Stromstufen A und A + B: günstigste Platzierung am Bestandsnetz, vorhandene '
          + 'Netzersatzanlagen angerechnet; Liegenschaft: Inselbetrieb am Netzanschlusspunkt. Wärme mit Notstrom für die Heizzentrale.';
        return `✓ ${m.spalten.length} Schutzziele aus dem Blackout-Modus übernommen.`;
      },
    },
  ];
}
GG_FIGUREN.push(...ggPvFiguren());

/* ── Kapitel 5: Bewertungswerkzeug und Schutzziele (26-blackout-modus.js) ─────
 * Die Daten kommen über window.blackoutZieleErgebnis() — das Modul bleibt ein Blatt. */
const ggResZiele = () => (typeof window.blackoutZieleErgebnis === 'function' ? window.blackoutZieleErgebnis() : null);
const ggResDauer = h => (h >= 48 && h % 24 === 0 ? `${ggNum(h / 24)} Tage` : `${ggNum(h)} Stunden`);
const ggResEur = v => (v >= 10000 ? `${ggNum(v / 1000)} T€` : `${ggNum(v)} €`);
const GG_RES_STUFE = { A: 'der Notstromklasse A', AB: 'der Notstromklassen A und B' };

function ggRenderResWerkzeugText(cfg, T = GG_THEME) {
  void cfg;
  return ggTextBlatt([
    'Die Resilienz der Liegenschaft wird mit dem Bewertungswerkzeug „Blackout-Modus“ des Planungstools betrachtet. '
      + 'Untersucht wird der Ausfall der äußeren Versorgung – Stromnetz, Gasversorgung und Fernwärme – über eine festgelegte Dauer.',
    'Die Gebäude werden nach ihrer Bedeutung in drei Notstromklassen eingeteilt: Klasse A (kritisch, vollständige Versorgung, '
      + 'bei Bedarf mit eigenem Aggregat), Klasse B (eingeschränkter Betrieb mit reduzierter Last) und Klasse C (keine Versorgung, '
      + 'jedoch ein Einspeisepunkt für ein mobiles Aggregat). Die Last der Gebäude ergibt sich aus den erfassten Verbrauchern und deren Lastgängen.',
    'Für die Gebäude der Klassen A und B wird anhand des Bestandsnetzes ermittelt, ob Netzersatzanlagen wirtschaftlicher an den '
      + 'Gebäuden oder an Kabelverteilern, Niederspannungshauptverteilungen und Transformatorstationen angeordnet werden. Eine Anlage '
      + 'an einem Netzknoten versorgt alle nachgelagerten Abgänge; Abgänge ohne Versorgungsauftrag sind im Ereignisfall abzuschalten '
      + 'und werden ausgewiesen. Vorhandene Netzersatzanlagen werden angerechnet. Bemessen wird auf die gleichzeitige Spitzenlast '
      + 'zuzüglich 20 % Reserve.',
    'Ergänzend wird die Versorgung eines Anteils der gesamten Liegenschaft über eine zentrale Netzersatzanlage am Netzanschlusspunkt '
      + 'betrachtet (Inselbetrieb). Dazu gehören ein Maschinentransformator, die Sternpunktbehandlung des Mittelspannungsnetzes, '
      + 'eine Netztrennung mit Synchronisierung, eine an den Inselbetrieb angepasste Schutztechnik sowie das gestufte Zu- und '
      + 'Abschalten der Transformatorstationen.',
    'Für die Wärmeversorgung wird pauschal geprüft, welcher Anteil der Netzlast bei einem Ausfall gedeckt werden kann, wenn die '
      + 'Heizzentrale eine Netzersatzanlage für Pumpen, Brenner und Regelung erhält und Gaskessel als Zweistoffbrenner mit Heizöl '
      + 'aus dem Lager betrieben werden.',
    'Aus Schutzzielen – was soll wie lange versorgt werden – werden die erforderlichen Maßnahmen und ihre Investitionskosten als '
      + 'Richtwerte abgeleitet. Die Ergebnisse sind Planungsabschätzungen; Kurzschluss-, Schutz- und Erdungsberechnungen sind in '
      + 'der weiteren Planung nachzuweisen.',
  ], T);
}

function ggRenderResZieleText(cfg, T = GG_THEME) {
  void cfg;
  const erg = ggResZiele();
  const liste = erg?.bewertungen || [];
  if (!liste.length) {
    return ggTextBlatt([
      'Für die Liegenschaft wurden folgende Schutzziele betrachtet: '
        + `${ggTextFeld('', 'Schutzziele aus dem Blackout-Modus (Reiter „Ziele“)')}.`,
    ], T);
  }
  const umfang = z => (z.strom === 'insel' ? `${ggNum(z.anteilPct)} % der Liegenschaft`
    : z.strom === 'keine' ? 'ohne Stromversorgung' : `Gebäude ${GG_RES_STUFE[z.strom]}`);
  const absaetze = [
    `Für die Liegenschaft wurden ${liste.length === 1 ? 'ein Schutzziel' : `${ggNum(liste.length)} Schutzziele`} betrachtet: `
      + ggAufzaehlung(liste.map(b => `„${gEsc(b.ziel.name)}“ (${umfang(b.ziel)}, ${ggResDauer(b.ziel.dauerH)}`
        + `${b.ziel.waerme ? ', mit Wärme' : ''})`)) + '.',
  ];
  for (const b of liste) absaetze.push(`Schutzziel „${gEsc(b.ziel.name)}“: ${ggResZielText(b)}`);
  if (liste.length > 1) {
    const sort = [...liste].sort((a, b) => a.kosten - b.kosten);
    absaetze.push(`Die Investitionen reichen von ${ggResEur(sort[0].kosten)} („${gEsc(sort[0].ziel.name)}“) bis `
      + `${ggResEur(sort[sort.length - 1].kosten)} („${gEsc(sort[sort.length - 1].ziel.name)}“). Die Maßnahmen bauen `
      + 'aufeinander auf und lassen sich stufenweise umsetzen. '
      + (erg.empfehlung
        ? `Empfohlen wird das Schutzziel „${gEsc(erg.empfehlung.ziel.name)}“ (vgl. Kapitel 5.2.3).`
        : `Welches Schutzziel umgesetzt wird, ist mit dem Nutzer festzulegen: ${ggTextFeld('', 'Empfohlenes Schutzziel')}.`));
  }
  return ggTextBlatt(absaetze, T);
}

/** Maßnahmen und Bewertung eines Schutzziels als Fließtext (5.2 und 5.2.3). */
function ggResZielText(b) {
  const z = b.ziel, s = b.strom, w = b.waerme;
  const teile = [];
  if (s?.art === 'gebaeude') {
    teile.push(`Für ${s.gebaeude === 1 ? 'das Gebäude' : `die ${ggNum(s.gebaeude)} Gebäude`} ${GG_RES_STUFE[z.strom]} `
      + `${s.anzahl === 1 ? 'ist eine Netzersatzanlage' : `sind ${ggNum(s.anzahl)} Netzersatzanlagen`} mit zusammen ${ggNum(s.kw)} kW erforderlich`
      + (s.zusatzKw < s.kw ? `, davon ${ggNum(s.zusatzKw)} kW neu` : '')
      + (s.abgaenge ? `; im Ereignisfall ${s.abgaenge === 1 ? 'ist ein Abgang' : `sind ${ggNum(s.abgaenge)} Abgänge`} abzuschalten` : '')
      + `. Der Kraftstoffbedarf über ${ggResDauer(z.dauerH)} liegt bei rund ${ggNum(s.liter)} l.`);
  } else if (s?.art === 'insel') {
    teile.push(`Die Versorgung von ${ggNum(z.anteilPct)} % der Liegenschaft erfordert ${ggNum(s.anzahl)} × ${ggNum(s.kvaJe)} kVA `
      + `am Netzanschlusspunkt mit einem Maschinentransformator von ${ggNum(s.mtKva)} kVA`
      + (s.stationenAus ? `; ${ggNum(s.stationenAus)} Transformatorstation${s.stationenAus === 1 ? ' wird' : 'en werden'} im Inselbetrieb abgeschaltet` : '')
      + (s.nsAbwurf ? `${s.stationenAus ? ', in den versorgten Stationen' : '; in den versorgten Stationen'} `
        + `${s.nsAbwurf === 1 ? 'wird ein Niederspannungsabgang' : `werden ${ggNum(s.nsAbwurf)} Niederspannungsabgänge`} abgeworfen` : '')
      + `. Das Kraftstofflager ist mit rund ${ggNum(s.liter)} l zu bemessen`
      + (s.pruefen ? `; ${ggNum(s.pruefen)} Punkte der Infrastruktur sind zu prüfen oder zu erneuern.` : '.'));
  }
  if (w) {
    const massnahmen = [
      w.neaKw && `ein Aggregat für die Hilfsenergie mit ${ggNum(w.neaKw)} kW`,
      w.zweistoffKw && `Zweistoffbrenner mit ${ggNum(w.zweistoffKw)} kW`,
      w.tankL && `ein Heizöllager von ${ggNum(w.tankL)} l`,
    ].filter(Boolean);
    teile.push(`Die Wärmeversorgung ist mit Notstrom für die Heizzentrale zu ${ggNum(w.deckungPct)} % gedeckt`
      + (massnahmen.length
        ? `; dafür ${massnahmen.length === 1 && !w.zweistoffKw ? 'ist' : 'sind'} ${ggAufzaehlung(massnahmen)} vorzusehen.`
        : '.'));
  }
  const bewertung = { erfuellt: 'Das Ziel ist mit diesen Maßnahmen erfüllbar.',
    teilweise: 'Das Ziel ist nur teilweise erfüllbar', offen: 'Für eine Bewertung fehlen Angaben' }[b.status];
  return `${teile.join(' ')} Die Investition beträgt überschlägig ${ggResEur(b.kosten)}. `
    + bewertung + (b.status !== 'erfuellt' && b.gruende.length ? ` (${gEsc(b.gruende.join('; '))}).` : b.status !== 'erfuellt' ? '.' : '');
}

const ggResStand = () => (typeof window.blackoutGutachtenStand === 'function' ? window.blackoutGutachtenStand() : null);
/** Standort eines Aggregats: „KVS 1“ statt „KVS KVS 1“, Gebäude in Anführungszeichen. */
const ggResOrt = a => (a.ort === 'knoten'
  ? (String(a.name).startsWith(a.typ) ? gEsc(a.name) : `${gEsc(a.typ)} ${gEsc(a.name)}`)
  : `Gebäude „${gEsc(a.name)}“`);
const ggResNamen = (liste, max = 6) => (liste.length > max
  ? `${liste.slice(0, max).map(gEsc).join(', ')} und ${liste.length - max} weitere`
  : ggAufzaehlung(liste.map(gEsc)));

/** 5.2.1 Ist-Zustand: Bestand an Netzersatzanlagen, Einstufung der Gebäude, Wärme ohne Maßnahme. */
function ggRenderResIstText(cfg, T = GG_THEME) {
  void cfg;
  const st = ggResStand();
  if (!st) return ggTextBlatt([`${ggTextFeld('', 'Ist-Zustand der Notstromversorgung')}.`], T);
  const { bilanz: bi, bestand, bestandDeckt: bd, heizzentrale: hz, waerme: w } = st;
  const absaetze = [];
  absaetze.push(bestand.anzahl
    ? `In der Liegenschaft ${bestand.anzahl === 1 ? `ist eine Netzersatzanlage mit ${ggNum(bestand.kw)} kW`
      : `sind ${ggNum(bestand.anzahl)} Netzersatzanlagen mit zusammen ${ggNum(bestand.kw)} kW`} vorhanden (vgl. Kapitel 3.1.4).`
    : 'In der Liegenschaft ist derzeit keine Netzersatzanlage vorhanden (vgl. Kapitel 3.1.4). Bei einem Ausfall des öffentlichen '
      + 'Stromnetzes ist die Liegenschaft damit ohne elektrische Versorgung.');
  if (bi.summe.anzahl) {
    const kl = [
      bi.klassen.A.anzahl && `${ggNum(bi.klassen.A.anzahl)} der Klasse A (kritisch: ${ggResNamen(st.namen.A)})`,
      bi.klassen.B.anzahl && `${ggNum(bi.klassen.B.anzahl)} der Klasse B (eingeschränkter Betrieb: ${ggResNamen(st.namen.B)})`,
      bi.klassen.C.anzahl && `${ggNum(bi.klassen.C.anzahl)} der Klasse C (Einspeisepunkt: ${ggResNamen(st.namen.C)})`,
    ].filter(Boolean);
    absaetze.push(`Nach ihrer Bedeutung für den Betrieb wurden die Gebäude den Notstromklassen zugeordnet: ${ggAufzaehlung(kl)}. `
      + `Die im Ereignisfall zu versorgende Last beträgt ${ggNum(bi.summe.notstromKw)} kW (Summe der Anschlussleistungen).`
      + (bi.summe.ohneLast ? ` Für ${ggNum(bi.summe.ohneLast)} eingestufte Gebäude liegen noch keine Verbrauchsdaten vor.` : ''));
    if (bd && bd.gesamt) {
      absaetze.push(bd.gebaeude >= bd.gesamt
        ? 'Die vorhandenen Netzersatzanlagen decken alle Gebäude der Klassen A und B.'
        : bd.gebaeude > 0
          ? `Die vorhandenen Netzersatzanlagen decken ${ggNum(bd.gebaeude)} von ${ggNum(bd.gesamt)} Gebäuden der Klassen A und B vollständig.`
          : bd.genutztKw > 0
            ? `Die vorhandenen Netzersatzanlagen tragen rund ${ggNum(bd.genutztKw)} kW der für die Klassen A und B erforderlichen `
              + `${ggNum(bd.bedarfKw)} kW; vollständig gedeckt ist keines der Gebäude.`
            : 'Keines der Gebäude der Klassen A und B ist durch eine vorhandene Netzersatzanlage gedeckt.');
    }
  } else {
    absaetze.push(`Notstromberechtigte Gebäude sind bislang nicht festgelegt: ${ggTextFeld('', 'notstromberechtigte Gebäude')}.`);
  }
  if (hz) {
    absaetze.push(`Die Wärmeversorgung erfolgt über die Heizzentrale im Gebäude „${gEsc(hz.name)}“. `
      + (hz.nea
        ? `Die Heizzentrale verfügt über eine eigene Netzersatzanlage mit ${ggNum(hz.neaKw)} kW.`
        : 'Eine Netzersatzanlage für die Heizzentrale ist nicht vorhanden: Bei einem Stromausfall fallen Umwälzpumpen, Brenner '
          + 'und Regelung aus, die Wärmeversorgung der angeschlossenen Gebäude ist unterbrochen'
          + (w?.puffer ? ', auch der Pufferspeicher lässt sich ohne Pumpen nicht nutzen.' : '.'))
      + (w?.tankL ? ` Es ist ein Heizöllager von ${ggNum(w.tankL)} l vorhanden.` : ''));
  } else {
    absaetze.push(`Die Wärmeversorgung bei Stromausfall: ${ggTextFeld('', 'Heizzentrale und deren Notstromversorgung')}.`);
  }
  return ggTextBlatt(absaetze, T);
}

/** 5.2.2 Kurzfristige Maßnahmen: organisatorisch oder mit geringem Aufwand umsetzbar. */
function ggRenderResKurzText(cfg, T = GG_THEME) {
  void cfg;
  const st = ggResStand();
  if (!st) return ggTextBlatt([`${ggTextFeld('', 'Kurzfristige Maßnahmen')}.`], T);
  const { bilanz: bi, bestand, heizzentrale: hz, waerme: w } = st;
  const punkte = [];
  if (!bi.summe.anzahl || bi.summe.ohneLast) {
    punkte.push('Festlegung der notstromberechtigten Gebäude und Lasten mit dem Nutzer'
      + (bi.summe.ohneLast ? ` sowie Erfassung der Anschlussleistungen der ${ggNum(bi.summe.ohneLast)} Gebäude ohne Verbrauchsdaten` : ''));
  }
  if (bi.klassen.C.anzahl) {
    punkte.push(`Einspeisepunkte für mobile Netzersatzanlagen an ${bi.klassen.C.anzahl === 1 ? 'dem Gebäude' : `den ${ggNum(bi.klassen.C.anzahl)} Gebäuden`} `
      + `der Klasse C (${ggResNamen(st.namen.C)}) einschließlich einer Rahmenvereinbarung zur Bereitstellung mobiler Aggregate`);
  }
  const ab = st.empfehlung?.variante?.abgaenge || st.bestandDeckt?.abgaenge || [];
  if (ab.length) {
    punkte.push(`Schaltanweisung und Kennzeichnung ${ab.length === 1 ? 'des im Ereignisfall abzuschaltenden Abgangs' : `der ${ggNum(ab.length)} im Ereignisfall abzuschaltenden Abgänge`} `
      + `(${ggResNamen(ab.map(a => (a.lokal ? `an ${a.vonName}` : `${a.vonName} → ${a.zuName}`)), 4)})`);
  }
  if (hz && !hz.nea && w?.neaKw) {
    punkte.push(`Notstromversorgung der Heizzentrale (Gebäude „${gEsc(hz.name)}“) für Pumpen, Brenner und Regelung mit rund ${ggNum(w.neaKw)} kW, `
      + 'zunächst auch als Einspeisepunkt für ein mobiles Aggregat');
  }
  if (w && w.tankFehltL > 0) {
    punkte.push(`Bevorratung von Heizöl: ${w.tankL
      ? `Lager um rund ${ggNum(w.tankFehltL)} l auf ${ggNum(w.tankEmpfehlungL)} l erweitern`
      : `Heizöllager von rund ${ggNum(w.tankEmpfehlungL)} l vorsehen`} `
      + `oder eine gesicherte Nachbelieferung für ${ggResDauer(w.dauerH)} vereinbaren`);
  }
  if (bestand.anzahl) {
    punkte.push('regelmäßige Probeläufe der vorhandenen Netzersatzanlagen unter Last sowie Prüfung der Kraftstoffvorräte');
  }
  punkte.push('Notfallplan mit Zuständigkeiten, Schaltreihenfolge und Kommunikationswegen für einen länger andauernden Ausfall');
  return ggTextBlatt([
    'Kurzfristig lassen sich folgende Maßnahmen mit geringem Aufwand umsetzen:',
    ...punkte.map(t => `– ${t}.`),
  ], T);
}

/** 5.2.3 Langfristige Maßnahmen: Umsetzung des empfohlenen Schutzziels. */
function ggRenderResLangText(cfg, T = GG_THEME) {
  void cfg;
  const st = ggResStand();
  const b = st?.empfehlung;
  if (!b) {
    return ggTextBlatt([
      `Empfohlen wird die Umsetzung des Schutzziels ${ggTextFeld('', 'Empfohlenes Schutzziel (Blackout-Modus › Ziele › ☆)')}. `
        + `${ggTextFeld('', 'Maßnahmen und Investition')}.`,
    ], T);
  }
  const absaetze = [
    `Empfohlen wird die Umsetzung des Schutzziels „${gEsc(b.ziel.name)}“ (vgl. Kapitel 5.2). ${ggResZielText(b)}`,
  ];
  const v = b.variante;
  if (v) {
    const orte = v.aggregate.filter(a => a.zusatzKw > 0)
      .map(a => `${ggResOrt(a)} (${a.bestandKw > 0 ? `+${ggNum(a.zusatzKw)} kW zum Bestand` : `${ggNum(a.zusatzKw)} kW`})`);
    if (orte.length) {
      absaetze.push(`Die Netzersatzanlagen werden an folgenden Standorten neu errichtet oder erweitert: ${ggAufzaehlung(orte)}. `
        + 'Anlaufströme großer Verbraucher und die Abschaltbedingungen bei dem geringeren Kurzschlussstrom der Aggregate '
        + 'sind in der Ausführungsplanung nachzuweisen.');
    }
  }
  const ins = b.insel;
  if (ins) {
    const titel = st => ins.checkliste.filter(c => c.status === st).map(c => c.titel);
    const neu = titel('neu'), ern = titel('erneuern'), pr = titel('pruefen');
    if (neu.length) absaetze.push(`Neu zu errichten sind: ${ggAufzaehlung(neu.map(gEsc))}.`);
    if (ern.length) absaetze.push(`Zu erneuern sind: ${ggAufzaehlung(ern.map(gEsc))}.`);
    if (pr.length) absaetze.push(`In der weiteren Planung zu prüfen sind: ${ggAufzaehlung(pr.map(gEsc))}.`);
  }
  absaetze.push('Die Umsetzung kann stufenweise erfolgen: Zuerst werden die kurzfristigen Maßnahmen (Kapitel 5.2.2) umgesetzt, '
    + 'anschließend die Netzersatzanlagen der kritischen Gebäude und die Notstromversorgung der Heizzentrale, zuletzt '
    + 'die weiteren Ausbaustufen.');
  return ggTextBlatt(absaetze, T);
}

/* ── 3.4.3 Notstromversorgung und Lastmanagement (Variantenbildung) ────────────
 * Auslegung aus der Inselbetrieb-Simulation der PV-Analyse (window._pvResReco, Abb. 10 „Resilienz“),
 * Anzahl und Standorte aus den geplanten Notstromaggregaten des Elektro-Tabs, Bestand wie in 3.1.4.
 * Lastmanagement heißt hier Lastabwurf auf die Notbetriebslast. Die Resilienzbewertung bleibt in 5.2.
 * _pvResReco wird mit der PV-Analyse im Projekt gespeichert (09d pvCaptureState). */
const GG_KAP_NOTSTROM = '3.4.3 Notstromversorgung und Lastmanagement';

/** Resilienz-Empfehlung, Bestand und geplante Notstromaggregate mit Summen (Leistung null = unvollständig). */
function ggNotstromStand() {
  const r = window._pvResReco || null;
  const { bestand, geplant } = ggAnlagenIst(['Nsa']);
  const kw = liste => (liste.length ? ggSummeOderNull(liste, e => ggPropZahl(e.p.leistungKW)) : 0);
  const autonomie = liste => {
    const w = liste.map(e => ggPropZahl(e.p.autonomieH));
    return w.length && w.every(v => v != null) ? Math.min(...w) : null;
  };
  const stoffe = liste => [...new Set(liste.map(e => e.p.kraftstoff).filter(Boolean))];
  return {
    r, erforderlichKw: r?.genKw > 0 ? r.genKw : null,
    bestand, geplant, bestandKw: kw(bestand), geplantKw: kw(geplant),
    bestandH: autonomie(bestand), geplantH: autonomie(geplant),
    bestandStoff: stoffe(bestand), geplantStoff: stoffe(geplant),
  };
}

const ggNotbetriebPct = r => (Number.isFinite(r?.loadFracPct) ? r.loadFracPct : 100);

function ggRenderNotstromAuslegungText(cfg, T = GG_THEME) {
  void cfg;
  const s = ggNotstromStand();
  const r = s.r;
  const erf = s.erforderlichKw;
  const absaetze = [];

  if (!r && ggResAuslegungSatz()) {
    absaetze.push('Die Auslegung der Notstromversorgung erfolgt mit dem Bewertungswerkzeug Resilienz auf Grundlage der '
      + 'Gebäudelastgänge und des Bestandsnetzes (vgl. Kapitel 5.1); bemessen wird auf die gleichzeitige Spitzenlast '
      + 'zuzüglich 20 % Reserve.');
  } else if (!r) {
    absaetze.push('Die Auslegung der Notstromversorgung erfolgt auf Grundlage einer Inselbetrieb-Simulation der Liegenschaft. '
      + `${ggTextFeld('', 'Ergebnis der Auslegung: Leistung, Überbrückungsdauer, Kraftstoff')}.`);
  } else {
    const modus = GG_RES_MODE_LBL[r.mode] || r.mode;
    const tage = r.durH >= 48 && r.durH % 24 === 0 ? ` (${r.durH / 24} Tage)` : '';
    const zeitpunkt = r.nHours ? ggPvTagLabel(r.isWorst ? r.worstStart : r.selStart) : null;
    const komponenten = [
      String(r.mode).includes('pv') && r.pvKwp > 0 ? `einer PV-Leistung von ${ggNum(r.pvKwp)} kWp` : '',
      String(r.mode).includes('bat') && r.batKwh > 0 ? `einem Batteriespeicher mit ${ggNum(r.batKwh)} kWh` : '',
    ].filter(Boolean);
    absaetze.push('Grundlage der Auslegung ist eine Inselbetrieb-Simulation mit dem Lastgang des Referenzjahres (vgl. Kapitel 3.2) '
      + `für einen Netzausfall von ${r.durH} Stunden${tage}`
      + (zeitpunkt ? `, beginnend ${r.isWorst ? 'zum ungünstigsten Zeitpunkt des Jahres' : 'zum gewählten Zeitpunkt'} (${zeitpunkt})` : '')
      + `. Betrachtet wird die Betriebsweise „${modus}“${komponenten.length ? ` mit ${ggAufzaehlung(komponenten)}` : ''}.`);

    if (erf) {
      absaetze.push(`Daraus ergibt sich eine erforderliche Leistung des Notstromaggregats von ${ggNum(erf)} kW einschließlich einer `
        + 'Reserve von 20 %. '
        + (r.mode !== 'gen'
          ? (r.bridgeH >= r.durH
            ? 'PV und Speicher könnten den Ausfall auch allein überbrücken; das Aggregat sichert die Versorgung zusätzlich ab. '
            : `Ohne Aggregat überbrücken PV und Speicher ${ggNum(r.bridgeH)} Stunden. `)
          : '')
        + `Für den gesamten Ausfall werden rund ${ggNum(Math.ceil(r.liters))} l ${gEsc(r.kraftstoff)} benötigt; der Kraftstofftank ist `
        + `mit mindestens ${ggNum(r.tankL)} l zu bemessen. Für die Kraftstofflagerung sind die einschlägigen Anforderungen zu beachten`
        + (r.fuelId === 'diesel' ? ', insbesondere die Verordnung über Anlagen zum Umgang mit wassergefährdenden Stoffen (AwSV)' : '')
        + '.'
        + (r.eUnmet > 0.5 ? ` Trotz Aggregat bleibt eine Versorgungslücke von ${ggNum(r.eUnmet / 1000, 2)} MWh.` : ''));
    } else {
      absaetze.push(`In der Betriebsweise „${modus}“ ist kein Notstromaggregat vorgesehen. `
        + (r.eUnmet > 0.5
          ? `Im betrachteten Ausfall bleibt eine Versorgungslücke von ${ggNum(r.eUnmet / 1000, 2)} MWh; eine durchgehende Versorgung `
            + 'ist damit nicht gewährleistet.'
          : 'PV und Speicher decken den betrachteten Ausfall vollständig.'));
    }
  }

  if (!s.bestand.length) {
    absaetze.push('Im Bestand ist keine Netzersatzanlage vorhanden (vgl. Kapitel 3.1.4)'
      + (erf ? '; die Notstromversorgung ist neu zu errichten.' : '.'));
  } else if (erf) {
    if (s.bestandKw == null) {
      absaetze.push(`Die vorhandenen Netzersatzanlagen sind mit ihrer Leistung von ${ggTextFeld('', 'Leistung Bestand kW')} kW `
        + 'der erforderlichen Leistung gegenüberzustellen (vgl. Kapitel 3.1.4).');
    } else if (s.bestandKw >= erf) {
      absaetze.push(`Die vorhandenen Netzersatzanlagen decken mit zusammen ${ggNum(s.bestandKw)} kW die erforderliche Leistung `
        + '(vgl. Kapitel 3.1.4)'
        + (s.bestandH != null && s.bestandH < r.durH
          ? `; ihr Kraftstoffvorrat reicht jedoch nur für ${ggNum(s.bestandH)} Stunden und ist auf ${r.durH} Stunden zu erweitern `
            + 'oder durch eine gesicherte Nachbetankung zu ergänzen.'
          : '.'));
    } else {
      absaetze.push(`Die vorhandenen Netzersatzanlagen reichen mit zusammen ${ggNum(s.bestandKw)} kW nicht aus (vgl. Kapitel 3.1.4); `
        + `gegenüber der erforderlichen Leistung fehlen ${ggNum(erf - s.bestandKw)} kW.`);
    }
  }

  if (s.geplant.length) {
    const n = s.geplant.length;
    const verfuegbar = s.geplantKw != null && s.bestandKw != null ? s.geplantKw + s.bestandKw : null;
    const bezug = s.bestand.length ? 'Zusammen mit dem Bestand' : 'Damit';
    absaetze.push(`Vorgesehen ${n === 1 ? 'ist ein Notstromaggregat' : `sind ${n} Notstromaggregate`} mit ${n > 1 ? 'zusammen ' : ''}`
      + `${ggBedarfFeld(s.geplantKw, 'Leistung geplant kW')} kW${ggAnlagenOrte(s.geplant)}.`
      + (erf && verfuegbar != null
        ? (verfuegbar >= erf
          ? ` ${bezug} ist die erforderliche Leistung gedeckt.`
          : ` ${bezug} fehlen gegenüber der erforderlichen Leistung noch ${ggNum(erf - verfuegbar)} kW.`)
        : ''));
  } else if (ggResAuslegungSatz()) {
    absaetze.push(ggResAuslegungSatz());
  } else if (erf && !(s.bestandKw >= erf)) {
    absaetze.push('Standort und Aufteilung der Aggregate sind noch festzulegen: '
      + `${ggTextFeld('', 'Standort/Aufteilung, z. B. zentral an der NSHV Gebäude xx')}.`);
  }

  absaetze.push(`Die Einspeisung der Notstromversorgung erfolgt ${ggTextFeld('', 'Einbindung, z. B. über eine Netzumschaltung an der NSHV Gebäude xx')}; `
    + `die Umschaltung auf Netzersatzbetrieb erfolgt ${ggTextFeld('', 'automatisch oder manuell')}. Die folgende Tabelle stellt Bestand, `
    + 'Anforderung und Planung gegenüber.');
  return ggTextBlatt(absaetze, T);
}

/** Standorte aus dem empfohlenen Schutzziel des Blackout-Modus (3.4.3), sonst null. */
function ggResAuslegungSatz() {
  const b = ggResStand()?.empfehlung;
  if (!b?.strom) return null;
  if (b.strom.art === 'insel') {
    return `Nach der Bewertung am Bestandsnetz (Schutzziel „${gEsc(b.ziel.name)}“, vgl. Kapitel 5.2) wird die Notstromversorgung `
      + `zentral am Netzanschlusspunkt mit ${ggNum(b.strom.anzahl)} × ${ggNum(b.strom.kvaJe)} kVA und einem Maschinentransformator `
      + `von ${ggNum(b.strom.mtKva)} kVA vorgesehen.`;
  }
  const orte = (b.variante?.aggregate || []).filter(a => a.empfKw > 0)
    .map(a => `${ggResOrt(a)} (${ggNum(a.empfKw)} kW`
      + `${a.bestandKw > 0 ? (a.zusatzKw > 0 ? `, davon ${ggNum(a.bestandKw)} kW vorhanden` : ', vorhanden') : ''})`);
  if (!orte.length) return null;
  return `Nach der Bewertung am Bestandsnetz (Schutzziel „${gEsc(b.ziel.name)}“, vgl. Kapitel 5.2) werden die Netzersatzanlagen `
    + `dezentral an folgenden Standorten angeordnet: ${ggAufzaehlung(orte)}.`;
}

function ggRenderNotstromLastabwurfText(cfg, T = GG_THEME) {
  void cfg;
  const r = window._pvResReco || null;
  const pct = r ? ggNotbetriebPct(r) : null;
  const absaetze = [];
  const rb = !r ? ggResStand()?.bilanz : null;

  if (pct == null && rb?.summe.anzahl) {
    absaetze.push('Im Notbetrieb werden nur die notstromberechtigten Gebäude versorgt; ihre Last beträgt zusammen '
      + `${ggNum(rb.summe.notstromKw)} kW (Summe der Anschlussleistungen, Klasse B mit reduzierter Last). Alle übrigen `
      + 'Verbraucher werden bei Netzausfall abgeworfen.');
  } else if (pct == null) {
    absaetze.push('Im Notbetrieb wird nur ein Teil der Last der Liegenschaft versorgt. Die Notbetriebslast beträgt '
      + `${ggTextFeld('', 'Notbetriebslast %')} % der Normallast; nicht notstromberechtigte Verbraucher werden bei Netzausfall abgeworfen.`);
  } else if (pct < 100) {
    absaetze.push('Im Notbetrieb wird nicht die gesamte Last der Liegenschaft versorgt. Der Auslegung liegt eine Notbetriebslast von '
      + `${ggNum(pct)} % der Normallast zugrunde; nicht notstromberechtigte Verbraucher werden bei Netzausfall abgeworfen. `
      + 'Dadurch sinken die erforderliche Aggregatleistung und der Kraftstoffbedarf.');
  } else {
    absaetze.push('Der Auslegung liegt die volle Last der Liegenschaft zugrunde; ein Lastabwurf im Notbetrieb ist nicht vorgesehen. '
      + 'Werden nicht notstromberechtigte Verbraucher bei Netzausfall abgeworfen, verringern sich die erforderliche '
      + 'Aggregatleistung und der Kraftstoffbedarf entsprechend.');
  }
  const rs = ggResStand();
  const berechtigt = rs?.bilanz.summe.anzahl
    ? ggAufzaehlung([
      rs.namen.A.length && `die Gebäude der Klasse A (${ggResNamen(rs.namen.A)})`,
      rs.namen.B.length && `mit reduzierter Last die Gebäude der Klasse B (${ggResNamen(rs.namen.B)})`,
    ].filter(Boolean))
    : '';
  const abg = rs?.empfehlung?.variante?.abgaenge || [];
  const ins = rs?.empfehlung?.insel;
  const umsetzung = abg.length
    ? `über das Abschalten von ${abg.length === 1 ? 'einem Abgang' : `${ggNum(abg.length)} Abgängen`} (${ggResNamen(abg.map(a => (a.lokal ? `an ${a.vonName}` : `${a.vonName} → ${a.zuName}`)), 4)})`
    : ins
      ? `über das MS-seitige Abschalten von ${ggNum(ins.lastabwurf.abschalten.length)} Transformatorstationen`
        + (ins.lastabwurf.nsAbwurf.length ? ` und ${ggNum(ins.lastabwurf.nsAbwurf.length)} Niederspannungsabgängen` : '')
        + ` sowie das Zuschalten der versorgten Stationen in ${ggNum(ins.zuschaltung.stufen.length)} Stufen`
      : '';
  absaetze.push(`Notstromberechtigt sind ${berechtigt || ggTextFeld('', 'Verbraucher, z. B. Stabsgebäude, IT, Wärmeerzeugung, Sicherheitsbeleuchtung')}. `
    + `Die Priorisierung und der Lastabwurf erfolgen ${umsetzung || ggTextFeld('', 'Umsetzung, z. B. über abschaltbare Abgänge an der NSHV oder die Gebäudeautomation')}. `
    + 'Der Umfang der notstromberechtigten Verbraucher ist mit dem Nutzer abzustimmen, da jeder weitere Verbraucher '
    + 'Aggregatleistung und Kraftstoffbedarf erhöht.');
  if (r) {
    absaetze.push('Die folgende Abbildung zeigt Stunde für Stunde, wie PV, Speicher und Notstromaggregat die Notbetriebslast '
      + 'während des betrachteten Ausfalls decken.');
  }
  return ggTextBlatt(absaetze, T);
}

/** Einzelansicht der Textbausteine 3.4.3: Resilienz-Rechnung, Bestand und geplante Aggregate im Abgleich. */
function ggNotstromStandHtml() {
  const s = ggNotstromStand();
  const r = s.r;
  const zeile = (label, wert) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;font-size:11px;line-height:1.6;">
      <span style="color:var(--muted);">${gEsc(label)}</span><span>${wert}</span></div>`;
  const gelb = t => `<span style="color:#e0a126;">${gEsc(t)}</span>`;
  const anlagen = (liste, kw) => `${liste.length} × · ${kw != null ? ggNum(kw) + ' kW' : 'Leistung unvollständig'}`;
  let html = zeile('Resilienz-Rechnung', r
      ? gEsc(`${GG_RES_MODE_LBL[r.mode] || r.mode} · ${r.durH} h · Aggregat ${r.genKw > 0 ? ggNum(r.genKw) + ' kW' : 'keines'} · `
        + `Notbetrieb ${ggNum(ggNotbetriebPct(r))} %`)
      : gelb('fehlt — ☀ PV-Analyse › Abb. 10 „Resilienz“ öffnen'))
    + zeile('Bestand (3.1.4)', s.bestand.length ? anlagen(s.bestand, s.bestandKw) : 'keine NEA')
    + zeile('Geplant (Elektro-Tab)', s.geplant.length ? anlagen(s.geplant, s.geplantKw) : 'keine geplanten Notstromaggregate');
  const erf = s.erforderlichKw;
  if (erf && s.geplant.length && s.geplantKw != null && s.bestandKw != null) {
    const verf = s.geplantKw + s.bestandKw;
    if (verf < erf) {
      html += `<div style="font-size:10px;color:#e0a126;margin-top:6px;">⚠ Bestand + geplant ${ggNum(verf)} kW liegt unter der erforderlichen Leistung von ${ggNum(erf)} kW.</div>`;
    } else if (verf > erf * 1.5) {
      html += `<div style="font-size:10px;color:#e0a126;margin-top:6px;">⚠ Bestand + geplant ${ggNum(verf)} kW liegt deutlich über der erforderlichen Leistung von ${ggNum(erf)} kW — ersetzen die geplanten Aggregate den Bestand?</div>`;
    }
  }
  return html + '<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Bestand und geplante Aggregate werden '
    + 'addiert. Aggregate aus der Notstrom-Platzierung zählen nur als geplant, wenn sie in einer Planungsschicht liegen oder ein Baujahr '
    + 'in der Zukunft haben. Gelbe Platzhalter (Einbindung, Umschaltung, notstromberechtigte Verbraucher) erfasst das Tool nicht.</div>';
}

GG_FIGUREN.push(
  // ── Gutachtentext: Auslegung der Notstromversorgung ────────────────────
  {
    id: 'notstrom-auslegung-text',
    istText: true,
    notstromText: true,
    reihe: 5,
    kapitel: GG_KAP_NOTSTROM,
    titel: 'Gutachtentext: Auslegung Notstromversorgung',
    datei: 'notstrom-auslegung-text',
    hinweis: 'Auslegung aus der Inselbetrieb-Simulation (☀ PV-Analyse › Abb. 10 „Resilienz“): Ausfalldauer, Betriebsweise, '
           + 'Aggregatleistung inkl. 20 % Reserve, Kraftstoff und Tank; Abgleich mit dem Bestand (3.1.4) und den geplanten '
           + 'Notstromaggregaten des Elektro-Tabs.',
    render: cfg => ggRenderNotstromAuslegungText(cfg),
    config: {},
  },

  // ── Notstromversorgung: Bestand und Auslegung ──────────────────────────
  {
    id: 'notstrom-soll-ist',
    autoSync: true,
    reihe: 10,
    kapitel: GG_KAP_NOTSTROM,
    titel: 'Notstromversorgung: Bestand und Auslegung',
    datei: 'notstrom-soll-ist',
    hinweis: 'Soll-Ist-Vergleich je Kenngröße: Bestand (Notstromaggregate im Bestand), erforderlich (Resilienz-Rechnung) und '
           + 'geplant (Notstromaggregate einer Planungsschicht), mit Bewertung.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Notstromversorgung: Bestand und Auslegung',
      leer: 'Keine Angaben — Resilienz-Rechnung öffnen oder Notstromaggregate im Elektro-Tab erfassen.',
      spalten: [
        { label: 'Kenngröße',    weight: 1.9, align: 'left', mono: false },
        { label: 'Bestand',      weight: 1.1 },
        { label: 'Erforderlich', weight: 1.2 },
        { label: 'Geplant',      weight: 1.1 },
        { label: 'Bewertung',    weight: 1.7, align: 'left', mono: false },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const s = ggNotstromStand();
      const r = s.r;
      if (!r && !s.bestand.length && !s.geplant.length) {
        cfg.zeilen = []; cfg.fussnote = '';
        return '⚠ Keine Resilienz-Rechnung und keine Notstromaggregate — ☀ PV-Analyse › Abb. 10 „Resilienz“ öffnen.';
      }
      const erf = s.erforderlichKw;
      const kwZelle = (liste, kw) => (!liste.length ? 'keine' : kw != null ? `${ggNum(kw)} kW` : '—');
      const hZelle = (liste, h) => (!liste.length ? '—' : h != null ? `${ggNum(h)} h` : '—');
      const gut = GG_THEME.accents.gruen, schlecht = GG_THEME.energy.waerme;
      const zeilen = [];

      // Leistung
      let bewLeistung = r ? 'kein Aggregat vorgesehen' : 'Auslegung fehlt', akzLeistung;
      if (erf) {
        const verf = s.bestandKw != null && s.geplantKw != null ? s.bestandKw + s.geplantKw : null;
        bewLeistung = verf == null ? 'Leistung unvollständig' : verf >= erf ? 'ausreichend' : `${ggNum(erf - verf)} kW fehlen`;
        akzLeistung = verf != null ? (verf >= erf ? gut : schlecht) : undefined;
      }
      zeilen.push({ werte: ['Leistung Notstromaggregat', kwZelle(s.bestand, s.bestandKw),
                            erf ? `${ggNum(erf)} kW` : r ? 'keine' : '—', kwZelle(s.geplant, s.geplantKw), bewLeistung],
                    akzent: akzLeistung });

      // Autonomie gegen Ausfalldauer
      const autonomien = [s.bestand.length ? s.bestandH : undefined, s.geplant.length ? s.geplantH : undefined].filter(v => v !== undefined);
      let bewDauer = '—', akzDauer;
      if (r && erf && autonomien.length) {
        const bekannt = autonomien.every(v => v != null);
        bewDauer = !bekannt ? 'Kraftstoffvorrat prüfen' : Math.min(...autonomien) >= r.durH ? 'ausreichend' : 'Vorrat/Nachbetankung erweitern';
        akzDauer = bekannt ? (Math.min(...autonomien) >= r.durH ? gut : schlecht) : undefined;
      }
      zeilen.push({ werte: ['Autonomie / Ausfalldauer', hZelle(s.bestand, s.bestandH), r ? `${r.durH} h` : '—',
                            hZelle(s.geplant, s.geplantH), bewDauer], akzent: akzDauer });

      // Kraftstoff
      const alleStoffe = [...s.bestandStoff, ...s.geplantStoff];
      zeilen.push({ werte: ['Kraftstoff', s.bestandStoff.join(', ') || '—', erf ? r.kraftstoff : '—', s.geplantStoff.join(', ') || '—',
                            erf && alleStoffe.length ? (alleStoffe.every(k => k === r.kraftstoff) ? 'einheitlich' : 'abweichend') : '—'] });

      if (erf) {
        zeilen.push({ werte: ['Tankvolumen (Ereignis + Reserve)', '—', `${ggNum(r.tankL)} l`, '—', 'vor Ort prüfen'] });
      }
      if (r) {
        const pct = ggNotbetriebPct(r);
        zeilen.push({ werte: ['Versorgter Lastanteil (Notbetrieb)', '—', `${ggNum(pct)} %`, '—',
                              pct < 100 ? 'Lastabwurf erforderlich' : 'volle Last'] });
      }
      cfg.zeilen = zeilen;
      cfg.fussnote = r
        ? `Erforderlich: Inselbetrieb-Simulation ${r.durH} h ${r.isWorst ? 'zum ungünstigsten Zeitpunkt' : 'zum gewählten Zeitpunkt'}, `
          + `${GG_RES_MODE_LBL[r.mode] || r.mode}, Aggregat inkl. 20 % Reserve · Bestand: Kapitel 3.1.4 · Geplant: Planungsschicht im Elektro-Tab`
        : 'Erforderliche Werte fehlen — ☀ PV-Analyse › Abb. 10 „Resilienz“ öffnen · Bestand: Kapitel 3.1.4';
      return r ? '✓ Bestand, Resilienz-Auslegung und geplante Aggregate übernommen.'
               : '⚠ Resilienz-Rechnung fehlt — nur Bestand und geplante Aggregate übernommen.';
    },
  },

  // ── Gutachtentext: Lastabwurf im Notbetrieb ────────────────────────────
  {
    id: 'notstrom-lastabwurf-text',
    istText: true,
    notstromText: true,
    reihe: 20,
    kapitel: GG_KAP_NOTSTROM,
    titel: 'Gutachtentext: Lastmanagement im Notbetrieb',
    datei: 'notstrom-lastabwurf-text',
    hinweis: 'Lastmanagement im Notstromfall: Notbetriebslast (Anteil der Normallast) aus der Resilienz-Rechnung und '
           + 'Lastabwurf nicht notstromberechtigter Verbraucher. Notstromberechtigte Verbraucher und Umsetzung bleiben Platzhalter.',
    render: cfg => ggRenderNotstromLastabwurfText(cfg),
    config: {},
  },
);

/* ── 3.4.4 Ladeinfrastruktur (Variantenbildung) ──────────────────────────────
 * Ergänzt 3.3.3 (Standorte, Ladepunkte, Zusatzbedarf), statt es zu wiederholen: Ausbaustufen nach Baujahr,
 * ungesteuertes Laden gegenüber Lademanagement (Begrenzung auf die Reserve der Anschlussleistung aus 3.3.4),
 * Netzanbindung aus dem Netzmodell (versorgende Verteilung/Trafo, ausgelöste Engpässe) und rechtliche
 * Rahmenbedingungen mit Platzhaltern. Lademanagement selbst simuliert das Tool nicht. */
const GG_KAP_LADE = '3.4.4 Ladeinfrastruktur';

const ggVersorgungText = v => [v?.verteilung?.name, v?.trafo?.name].filter(Boolean).join(' / ') || 'unbekannte Einspeisung';

/** Ladeparks (Bestand zuerst, dann nach Ausbaujahr) mit Leistung, Netzanbindung und ausgelösten Engpässen. */
function ggLadeparks() {
  const { bestand, geplant } = ggAnlagenIst(['Lade']);
  const edges = window.stromEdges || [];
  const res = edges.length ? ggEngpassErgebnis() : null;
  let assets = [];
  try { assets = window.listAssets?.() || []; } catch (e) { void e; }
  const rang = window.TYPE_RANK || {};

  // Engpässe je auslösendem Ladepark (Baujahr des Ladeparks = Engpassjahr)
  const ausgeloest = new Map();
  if (res && typeof window.engpassAusloeserFuer === 'function') {
    for (const item of [...res.trafos, ...res.kabel]) {
      if (item.engpassJahr == null) continue;
      let treffer = [];
      try { treffer = window.engpassAusloeserFuer(item) || []; } catch (e) { void e; }
      for (const t of treffer) {
        if (t.kind !== 'asset' || t.typ !== 'Lade') continue;
        if (!ausgeloest.has(t.id)) ausgeloest.set(t.id, []);
        ausgeloest.get(t.id).push(item);
      }
    }
  }

  const zeile = (e, istGeplant) => {
    const l = bpLadeLeistung(e.p);
    return {
      e, l, geplant: istGeplant, jahr: e.bj,
      installiertKw: l.punkte * l.kwProPunkt + l.schnell * l.kwSchnell,
      angebunden: edges.some(k => k.u === e.a.id || k.v === e.a.id),
      versorgung: edges.length ? engpassVersorgung(e.a.id, assets, edges, rang) : null,
      engpaesse: ausgeloest.get(e.a.id) || [],
    };
  };
  const alle = [...bestand.map(e => zeile(e, false)), ...geplant.map(e => zeile(e, true))];
  alle.sort((a, b) => (Number(a.geplant) - Number(b.geplant)) || ((a.jahr ?? 9999) - (b.jahr ?? 9999))
    || String(a.e.a.name).localeCompare(String(b.e.a.name), 'de', { numeric: true }));
  return { alle, res };
}

/** Ausbaustufen: Bestand, je Ausbaujahr, geplant ohne Jahr — in der Reihenfolge von ggLadeparks. */
function ggLadeStufen(alle) {
  const map = new Map();
  for (const z of alle) {
    const key = !z.geplant ? 'Bestand' : z.jahr != null ? String(z.jahr) : 'ohne Jahr';
    if (!map.has(key)) map.set(key, { key, parks: [], punkte: 0, schnell: 0, kw: 0 });
    const s = map.get(key);
    s.parks.push(z); s.punkte += z.l.punkte; s.schnell += z.l.schnell; s.kw += z.l.kw;
  }
  return [...map.values()];
}

/** Leistungsrahmen für das Lademanagement aus der Stufenrechnung (3.3.3/3.3.4) und der vereinbarten Anschlussleistung. */
function ggLadeReserve() {
  const { st, r } = ggBedarfRechnung();
  if (!r) return null;
  const stufe = r.stufen.find(s => s.key === 'lade');
  const ladeKw = stufe ? stufe.rueckbauKw + stufe.zubauKw : 0;
  const cap = ggPositiv(window.elNapMaxBezugKw);
  const ohneLade = r.endKw - ladeKw;
  return { st, r, ladeKw, cap, ohneLade, verfuegbar: cap != null ? cap - ohneLade : null };
}

/** „10 Normalladepunkten und 2 Schnellladepunkten“ (Dativ, nach „mit“) bzw. mit dativ=false „… Normalladepunkte …“. */
const ggLadepunkteText = (punkte, schnell, dativ = true) => {
  const n = (anzahl, wort) => `${ggNum(anzahl)} ${wort}${anzahl === 1 ? '' : dativ ? 'en' : 'e'}`;
  return n(punkte, 'Normalladepunkt') + (schnell ? ` und ${n(schnell, 'Schnellladepunkt')}` : '');
};

function ggRenderLadeVariantenText(cfg, T = GG_THEME) {
  void cfg;
  const { alle } = ggLadeparks();
  if (!alle.length) {
    return ggTextBlatt([
      'Ladeinfrastruktur ist weder im Bestand vorhanden noch geplant (vgl. Kapitel 3.3.3); eine Variantenbildung entfällt. '
        + `Für eine spätere Nachrüstung ist ${ggTextFeld('', 'Vorhaltung, z. B. Leerrohre und Reserveabgänge an der NSHV')} vorzusehen.`,
    ], T);
  }
  const absaetze = ['Aufbauend auf dem Zusatzbedarf aus Kapitel 3.3.3 werden für die Ladeinfrastruktur die zeitliche Staffelung '
    + 'des Ausbaus und die Betriebsweise der Ladepunkte betrachtet.'];

  // Ausbaustufen
  const stufen = ggLadeStufen(alle);
  const bestand = stufen.find(s => s.key === 'Bestand');
  const plan = stufen.filter(s => s.key !== 'Bestand');
  const stufeText = s => `${s.key === 'ohne Jahr' ? 'ohne festgelegtes Ausbaujahr' : `im Jahr ${s.key}`} `
    + `${ggBedarfListe(s.parks.map(z => gEsc(z.e.a.name)))} mit ${ggLadepunkteText(s.punkte, s.schnell)} `
    + `(Auslegungsleistung ${ggNum(s.kw)} kW)`;
  let p = bestand
    ? `Im Bestand ${bestand.parks.length === 1 ? 'ist' : 'sind'} ${ggBedarfListe(bestand.parks.map(z => gEsc(z.e.a.name)))} mit `
      + `${ggLadepunkteText(bestand.punkte, bestand.schnell)} vorhanden. `
    : '';
  if (!plan.length) {
    p += 'Ein weiterer Ausbau ist nicht vorgesehen.';
  } else {
    const summe = f => stufen.reduce((a, s) => a + f(s), 0);
    p += plan.length === 1
      ? `Der Ausbau erfolgt in einer Stufe: ${stufeText(plan[0])}.`
      : `Der Ausbau erfolgt in ${plan.length} Stufen: ${ggAufzaehlung(plan.map(stufeText))}.`;
    p += ` Nach Abschluss stehen insgesamt ${ggLadepunkteText(summe(s => s.punkte), summe(s => s.schnell), false)} mit einer `
      + `Auslegungsleistung von ${ggNum(summe(s => s.kw))} kW zur Verfügung.`;
  }
  absaetze.push(p);

  // Ungesteuertes Laden
  const rv = ggLadeReserve();
  if (rv && rv.ladeKw <= 0.5) {
    absaetze.push('Ungesteuertes Laden: Da nach dem Messjahr kein Zubau an Ladeinfrastruktur mit Wirkung auf die Leistung vorgesehen '
      + 'ist, entsteht kein zusätzlicher Leistungsbedarf; die vorhandenen Ladepunkte sind in der gemessenen Last enthalten.');
  } else {
    absaetze.push('Ungesteuertes Laden: Die Ladepunkte laden unabhängig von der übrigen Last mit der ausgelegten Leistung. Die '
      + `Ladeinfrastruktur erhöht den Leistungsbedarf der Liegenschaft damit um ${ggBedarfFeld(rv?.ladeKw, 'Zusatzbedarf Ladeinfrastruktur kW')} kW `
      + '(vgl. Kapitel 3.3.3); diese Leistung muss am Netzanschluss und im internen Netz jederzeit zur Verfügung stehen.');
  }

  // Lademanagement
  p = 'Dynamisches Lademanagement: Eine Steuerung verteilt die verfügbare Leistung auf die ladenden Fahrzeuge und begrenzt die '
    + 'gesamte Ladeleistung auf einen festen oder von der aktuellen Last abhängigen Wert. ';
  if (!rv || rv.cap == null) {
    p += 'Die verfügbare Leistung ergibt sich aus der vereinbarten Anschlussleistung abzüglich des übrigen Leistungsbedarfs und '
      + `beträgt ${ggTextFeld('', 'verfügbare Ladeleistung kW')} kW.`;
  } else if (rv.ladeKw <= 0.5) {
    p += 'Es begrenzt die gleichzeitige Last der vorhandenen Ladepunkte und sichert so die Reserve der Anschlussleistung.';
  } else if (rv.verfuegbar <= 0) {
    p += `Bereits ohne Ladeinfrastruktur übersteigt der Leistungsbedarf von ${ggNum(rv.ohneLade)} kW die vereinbarte `
      + `Anschlussleistung von ${ggNum(rv.cap)} kVA. Ein Lademanagement kann die Erhöhung der Anschlussleistung daher nicht `
      + 'vermeiden, begrenzt aber den zusätzlichen Bedarf der Ladeparks (Variante B in Kapitel 3.4.1).';
  } else if (rv.verfuegbar >= rv.ladeKw) {
    p += `Innerhalb der vereinbarten Anschlussleistung von ${ggNum(rv.cap)} kVA stehen für das Laden ${ggNum(rv.verfuegbar)} kW `
      + 'zur Verfügung und damit mehr als die Auslegungsleistung. Ein Lademanagement ist aus Sicht des Netzanschlusses nicht '
      + 'erforderlich, sichert aber die Reserve für weitere Verbraucher.';
  } else {
    const anteil = rv.verfuegbar / rv.ladeKw;
    p += `Innerhalb der vereinbarten Anschlussleistung von ${ggNum(rv.cap)} kVA stehen für das Laden noch ${ggNum(rv.verfuegbar)} kW `
      + `zur Verfügung, das sind ${ggNum(anteil * 100)} % der Auslegungsleistung. Wird die Ladeleistung per Lademanagement auf `
      + 'diesen Wert begrenzt, bleibt die Liegenschaft innerhalb der vereinbarten Anschlussleistung und kommt ohne Erhöhung '
      + 'aus (Variante B in Kapitel 3.4.1).'
      + (anteil < 0.5 ? ' Bei dieser deutlichen Begrenzung ist ein uneingeschränkter Ladebetrieb jedoch nicht mehr gewährleistet.' : '');
  }
  p += ` Ob die Begrenzung für den Betrieb vertretbar ist, ist zu bewerten: ${ggTextFeld('', 'Bewertung, z. B. anhand von Standzeiten und Fahrleistung der Fahrzeuge')}.`;
  absaetze.push(p);
  return ggTextBlatt(absaetze, T);
}

function ggRenderLadeNetzText(cfg, T = GG_THEME) {
  void cfg;
  const { alle, res } = ggLadeparks();
  if (!alle.length) {
    return ggTextBlatt(['Da keine Ladeinfrastruktur vorgesehen ist, entfällt die Betrachtung der Netzanbindung.'], T);
  }
  if (!res) {
    return ggTextBlatt([
      `Die Ladeparks sind ${ggTextFeld('', 'Anbindung, z. B. über eigene Abgänge der NSHV Gebäude xx')} an das interne Stromnetz `
        + `anzuschließen. Ob Trafostationen und Kabel die zusätzliche Leistung aufnehmen können, ist nachzuweisen: `
        + `${ggTextFeld('', 'Nachweis, z. B. im Rahmen der Ausführungsplanung')}.`,
    ], T);
  }
  const absaetze = [];
  const angebunden = alle.filter(z => z.angebunden);
  const offen = alle.filter(z => !z.angebunden);
  if (angebunden.length) {
    const wer = angebunden.length === alle.length
      ? (alle.length === 1 ? 'ist der Ladepark' : 'sind alle Ladeparks')
      : angebunden.length === 1 ? `ist einer von ${alle.length} Ladeparks` : `sind ${angebunden.length} von ${alle.length} Ladeparks`;
    absaetze.push(`Im Netzmodell ${wer} `
      + `an das interne Netz angebunden: ${ggBedarfListe(angebunden.map(z => `${gEsc(z.e.a.name)} über ${gEsc(ggVersorgungText(z.versorgung))}`))}.`);
  }
  if (offen.length) {
    absaetze.push(`${ggBedarfListe(offen.map(z => gEsc(z.e.a.name)))} ${offen.length === 1 ? 'ist' : 'sind'} im Netzmodell noch nicht `
      + `angebunden. Vorgesehen ist die Anbindung ${ggTextFeld('', 'z. B. über einen Abgang der NSHV Gebäude xx')}.`);
  }
  const mitEngpass = alle.filter(z => z.engpaesse.length);
  if (mitEngpass.length) {
    const engpaesse = [...new Map(mitEngpass.flatMap(z => z.engpaesse).map(i => [i.id, i])).values()]
      .sort((a, b) => a.engpassJahr - b.engpassJahr);
    absaetze.push(`Mit dem Zubau von ${ggBedarfListe(mitEngpass.map(z => gEsc(z.e.a.name)))} entstehen im internen Netz Engpässe: `
      + `${ggBedarfListe(engpaesse.map(i => `${gEsc(i.label)} (${i.engpassJahr})`))}. Die erforderlichen Ertüchtigungen sind in `
      + 'Kapitel 3.4.1 aufgeführt und vor der Inbetriebnahme der Ladepunkte umzusetzen.');
  } else if (angebunden.length) {
    absaetze.push('Keiner der Ladeparks löst im internen Netz einen Engpass aus; Trafostationen und Kabel können die zusätzliche '
      + 'Ladeleistung aufnehmen.');
  }
  absaetze.push('Die folgende Tabelle fasst die Netzanbindung je Ladepark zusammen.');
  return ggTextBlatt(absaetze, T);
}

function ggRenderLadeRechtText(cfg, T = GG_THEME) {
  void cfg;
  return ggTextBlatt([
    'Bei der Planung der Ladeinfrastruktur sind die rechtlichen Rahmenbedingungen zu beachten. Das Gebäude-Elektromobilitäts'
      + 'infrastruktur-Gesetz (GEIG) verpflichtet bei der Errichtung und größeren Renovierung von Nichtwohngebäuden mit '
      + 'Stellplätzen zur Ausstattung mit Leitungsinfrastruktur und Ladepunkten und sieht auch für bestehende Nichtwohngebäude mit '
      + 'einer größeren Anzahl von Stellplätzen die Errichtung von Ladepunkten vor. Ob und in welchem Umfang die Vorgaben für die '
      + `Liegenschaft gelten, ist zu prüfen: ${ggTextFeld('', 'Ergebnis, z. B. Anzahl Stellplätze je Gebäude und geplante Baumaßnahmen')}.`,
    'Ladepunkte, die in der Niederspannung angeschlossen sind, können als steuerbare Verbrauchseinrichtungen der netzorientierten '
      + 'Steuerung nach § 14a EnWG unterliegen; der Netzbetreiber kann ihre Bezugsleistung dann bei drohender Überlastung des '
      + 'Verteilnetzes zeitweise begrenzen. Ob die Ladepunkte der Liegenschaft darunter fallen, ist zu klären: '
      + `${ggTextFeld('', 'Ergebnis, z. B. abhängig von Anschlussebene und Zugänglichkeit der Ladepunkte')}.`,
    `Darüber hinaus sind ${ggTextFeld('', 'weitere Anforderungen, z. B. Brandschutz, Eichrecht bei Abrechnung, Vorgaben des Nutzers')} zu berücksichtigen.`,
  ], T);
}

/** Einzelansicht der Textbausteine 3.4.4: Ladeparks, Stufen, Leistungsrahmen und Netzmodell. */
function ggLadeStandHtml() {
  const { alle, res } = ggLadeparks();
  const rv = ggLadeReserve();
  const zeile = (label, wert) => `<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;font-size:11px;line-height:1.6;">
      <span style="color:var(--muted);">${gEsc(label)}</span><span>${wert}</span></div>`;
  const gelb = t => `<span style="color:#e0a126;">${gEsc(t)}</span>`;
  const stufen = ggLadeStufen(alle);
  let html = zeile('Ladeparks', alle.length
      ? `${alle.filter(z => !z.geplant).length} Bestand · ${alle.filter(z => z.geplant).length} geplant`
      : gelb('keine Ladeinfrastruktur im Elektro-Tab'))
    + zeile('Ausbaustufen', stufen.length ? gEsc(stufen.map(s => s.key).join(' · ')) : '—')
    + zeile('Zusatzbedarf (3.3.3)', rv ? `${ggNum(rv.ladeKw)} kW` : '—')
    + zeile('Für Laden verfügbar', rv?.cap != null ? `${ggNum(Math.max(0, rv.verfuegbar))} kW bei ${ggNum(rv.cap)} kVA` : gelb('Anschlussleistung fehlt'))
    + zeile('Netzmodell', res ? `nicht angebunden: ${alle.filter(z => !z.angebunden).length} · `
        + `mit ausgelöstem Engpass: ${alle.filter(z => z.engpaesse.length).length}` : gelb('kein Netzmodell — Netzanbindung als Platzhalter'));
  return html + '<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Ladepunkte, Leistung und Baujahr aus '
    + 'den Ladeinfrastruktur-Assets des Elektro-Tabs; Auslegungsleistung mit dem Gleichzeitigkeitsfaktor des Ladeparks. '
    + 'Lademanagement wird nicht simuliert — beziffert ist nur die verfügbare Leistung.</div>';
}

GG_FIGUREN.push(
  // ── Gutachtentext: Varianten Ladeinfrastruktur ──────────────────────────
  {
    id: 'lade-varianten-text',
    istText: true,
    ladeText: true,
    reihe: 5,
    kapitel: GG_KAP_LADE,
    titel: 'Gutachtentext: Varianten Ladeinfrastruktur',
    datei: 'lade-varianten-text',
    hinweis: 'Ausbaustufen nach Baujahr der Ladeparks sowie ungesteuertes Laden gegenüber Lademanagement: verfügbare '
           + 'Ladeleistung = vereinbarte Anschlussleistung − übriger Bedarf aus 3.3.4.',
    render: cfg => ggRenderLadeVariantenText(cfg),
    config: {},
  },

  // ── Gutachtentext: Netzanbindung der Ladeparks ─────────────────────────
  {
    id: 'lade-netz-text',
    istText: true,
    ladeText: true,
    reihe: 10,
    kapitel: GG_KAP_LADE,
    titel: 'Gutachtentext: Netzanbindung Ladeinfrastruktur',
    datei: 'lade-netz-text',
    hinweis: 'Aus dem Netzmodell: versorgende Verteilung und Trafo je Ladepark und die Engpässe, die ein Ladepark auslöst '
           + '(Verweis auf die Ertüchtigungen in 3.4.1). Ohne Netzmodell Platzhaltertext.',
    render: cfg => ggRenderLadeNetzText(cfg),
    config: {},
  },

  // ── Netzanbindung je Ladepark ──────────────────────────────────────────
  {
    id: 'lade-netzanbindung',
    autoSync: true,
    reihe: 20,
    kapitel: GG_KAP_LADE,
    titel: 'Netzanbindung der Ladeinfrastruktur',
    datei: 'lade-netzanbindung',
    hinweis: 'Je Ladepark: Standort, Ladepunkte und Auslegungsleistung, versorgende Verteilung/Trafo, ausgelöste Engpässe '
           + 'und Umsetzungsjahr. Ergänzt die Tabelle in 3.3.3.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Netzanbindung der Ladeinfrastruktur',
      leer: 'Keine Ladeinfrastruktur im Elektro-Tab.',
      spalten: [
        { label: 'Ladepark',      weight: 1.4, align: 'left', mono: false },
        { label: 'Standort',      weight: 1.0, align: 'left', mono: false },
        { label: 'Auslegung',     weight: 1.3 },
        { label: 'Versorgt über', weight: 1.6, align: 'left', mono: false },
        { label: 'Engpass',       weight: 1.6, align: 'left', mono: false },
        { label: 'Umsetzung',     weight: 0.9 },
      ],
      zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const { alle, res } = ggLadeparks();
      if (!alle.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Ladeinfrastruktur im Elektro-Tab.'; }
      cfg.zeilen = alle.map(z => ({
        werte: [
          z.e.a.name || 'Ladepark',
          ggGebText(z.e.g) || '—',
          `${z.l.punkte} LP${z.l.schnell ? ` + ${z.l.schnell} SL` : ''} · ${ggNum(z.l.kw)} kW`,
          !res ? '—' : !z.angebunden ? 'nicht angebunden' : ggVersorgungText(z.versorgung),
          // Mehrere Engpässe nur gezählt — die Einzelheiten stehen im Text, sonst läuft die Zelle über
          !res ? '—' : !z.engpaesse.length ? 'keiner'
            : z.engpaesse.length === 1 ? `${z.engpaesse[0].label} (${z.engpaesse[0].engpassJahr})`
            : `${z.engpaesse.length} Engpässe ab ${Math.min(...z.engpaesse.map(i => i.engpassJahr))}`,
          !z.geplant ? 'Bestand' : (z.jahr ?? 'offen'),
        ],
        akzent: z.engpaesse.length ? GG_THEME.energy.waerme : res && !z.angebunden ? GG_THEME.energy.gas
              : z.geplant ? GG_THEME.accents.gruen : undefined,
      }));
      const summeKw = alle.reduce((a, z) => a + z.l.kw, 0);
      cfg.fussnote = `LP = Normalladepunkte, SL = Schnellladepunkte · Auslegung inkl. Gleichzeitigkeitsfaktor des Ladeparks, `
                   + `zusammen ${ggNum(summeKw)} kW` + (res ? ` · Engpässe aus dem Netzmodell ${res.von}–${res.bis}, Ertüchtigung siehe Kapitel 3.4.1` : ' · ohne Netzmodell');
      return `✓ ${alle.length} Ladeparks übernommen` + (res ? '.' : ' — kein Netzmodell, Netzanbindung offen.');
    },
  },

  // ── Gutachtentext: Rechtliche Rahmenbedingungen ────────────────────────
  {
    id: 'lade-recht-text',
    istText: true,
    reihe: 30,
    kapitel: GG_KAP_LADE,
    titel: 'Gutachtentext: Rechtliche Rahmenbedingungen Ladeinfrastruktur',
    datei: 'lade-recht-text',
    hinweis: 'Mustertext zu GEIG und § 14a EnWG mit Platzhaltern für die Anwendbarkeit — die Pflichten sind im Einzelfall zu prüfen.',
    render: cfg => ggRenderLadeRechtText(cfg),
    config: {},
  },
);

/* ── 3.5 Wirtschaftlichkeit und Investitionskosten ──────────────────────────────
 * Kostenpositionen aus 3.4.1–3.4.4: Netzanschluss (Mehrleistung × Baukostenzuschuss), internes Netz
 * (Ertüchtigungsvorschläge des Netzmodells), PV/Speicher (wirtschaftlich optimierte Variante der PV-Analyse,
 * Jahreskosten von dort), Notstrom (Resilienz-Rechnung), Ladeinfrastruktur (Ladepunkte × Kennwert).
 * Jahreskosten nach VDI 2067 über lib/elektro-kosten.js. Die Kennwerte hängen an der Config der Kostentabelle
 * und werden als deren Figur-Einstellung gespeichert. */
const GG_KAP_WIRT = '3.5 Wirtschaftlichkeit und Investitionskosten';
const GG_KOSTEN_FARBEN = {
  netzanschluss: GG_THEME.accents.gruenDunkel, netz: GG_THEME.energy.strom, pv: GG_THEME.accents.gruen,
  notstrom: GG_THEME.energy.gas, lade: '#3F7FBF',
};

const ggKostenFigur = () => GG_FIGUREN.find(f => f.id === 'kosten-gruppen');
const ggKostenKennwerte = () => ekNormKennwerte(ggKostenFigur()?.config.kennwerte);
const ggKostenVonHand = () => !!_ggManuell.get('kosten-gruppen')?.has('kennwerte');
/** Betrag gerundet: ab 10.000 € auf Tausend, sonst auf Hundert. */
const ggEuro = v => `${ggNum(Math.round(v / (v >= 10000 ? 1000 : 100)) * (v >= 10000 ? 1000 : 100))} €`;
const ggJahresSpanne = jahre => (!jahre.length ? 'offen' : jahre[0] === jahre[jahre.length - 1] ? String(jahre[0]) : `${jahre[0]}–${jahre[jahre.length - 1]}`);

/** Kostenpositionen der Kapitel 3.4.1–3.4.4 samt Auswertung; `offen` nennt, was nicht beziffert werden kann. */
function ggKostenPositionen() {
  const k = ggKostenKennwerte();
  const heute = new Date().getFullYear();
  const pos = [], offen = [];

  // Netzanschluss (3.4.1): Mehrleistung gegenüber der vereinbarten Anschlussleistung
  const { st, r } = ggBedarfRechnung();
  const cap = ggPositiv(window.elNapMaxBezugKw);
  if (r && cap && r.endKw > cap) {
    const mehrKw = Math.ceil(r.endKw - cap);
    const erstes = ggErsteUeberschreitung(st, r, cap);
    pos.push({ gruppe: 'netzanschluss', art: 'netzanschluss', label: 'Erhöhung der Anschlussleistung',
               umfang: `+${ggNum(mehrKw)} kW`, investEur: mehrKw * k.bkzEurKw + k.anschlussPauschalEur,
               jahr: erstes != null ? Math.max(erstes, heute) : null });
  } else if (r && !cap) {
    offen.push('Netzanschluss (vereinbarte Anschlussleistung fehlt)');
  }

  // Internes Netz (3.4.1): Ertüchtigungsvorschläge ohne Bestandsmängel und MS
  const res = (window.stromEdges || []).length ? ggEngpassErgebnis() : null;
  if (res) {
    const liste = ggEngpassListe(res);
    for (const e of liste) {
      if (e.bestand || e.ms) continue;
      if (!e.v || e.v.ungeloest) continue;
      pos.push({ gruppe: 'netz', art: e.v.art, label: `${e.item.label}: ${e.v.label}`, umfang: e.v.label,
                 investEur: e.v.investEUR, jahr: e.v.jahr });
    }
    const n = (f, text) => { const c = liste.filter(f).length; if (c) offen.push(`${c} ${text}`); };
    n(e => e.bestand, 'Bestandsmängel im internen Netz');
    n(e => !e.bestand && !e.ms && e.v?.ungeloest, 'Engpässe ohne Standardertüchtigung');
    n(e => e.ms, 'Engpässe im Mittelspannungsnetz');
  }

  // PV und Batteriespeicher (3.4.2): wirtschaftlich optimierte Variante, Jahreskosten aus der PV-Analyse
  const pv = ggPvKanon().find(v => v.id === 'wirt-opt') || null;
  if (pv?.wirt?.investGes > 0) {
    const pvJahre = ggAnlagenIst(['PV', 'Batterie']).geplant.map(e => e.bj).filter(j => j != null);
    const p = window._pvAnalyse?.lastParams;
    pos.push({ gruppe: 'pv', art: 'pv', label: pv.label,
               umfang: `${ggNum(pv.pvKwp)} kWp${pv.batKwh > 0 ? ` · ${ggNum(pv.batKwh)} kWh` : ''}`,
               investEur: pv.wirt.investGes, jahreskostenEur: pv.wirt.gesamtJk, nutzungsdauer: p?.pvLife || 20,
               jahr: pvJahre.length ? Math.min(...pvJahre) : null });
  } else {
    offen.push('PV und Batteriespeicher (PV-Varianten nicht berechnet)');
  }

  // Notstrom (3.4.3): fehlende bzw. geplante Aggregatleistung zum Kennwert der Resilienz-Rechnung, dazu der Tank
  const ns = ggNotstromStand();
  if (ns.erforderlichKw) {
    const eurKw = ns.r.genKw > 0 ? ns.r.gensetCost / ns.r.genKw : 0;
    const neuKw = ns.geplant.length && ns.geplantKw != null ? ns.geplantKw : Math.max(0, ns.erforderlichKw - (ns.bestandKw || 0));
    if (neuKw > 0) {
      const jahre = ns.geplant.map(e => e.bj).filter(j => j != null);
      pos.push({ gruppe: 'notstrom', art: 'notstrom', label: 'Notstromaggregat inkl. Tank',
                 umfang: `${ggNum(neuKw)} kW · Tank ${ggNum(ns.r.tankL)} l`, investEur: neuKw * eurKw + (ns.r.tankCost || 0),
                 jahr: jahre.length ? Math.min(...jahre) : null });
    }
  } else if (!ns.r) {
    offen.push('Notstromversorgung (Resilienz-Rechnung nicht geöffnet)');
  }

  // Ladeinfrastruktur (3.4.4): geplante Ladeparks × Kennwert je Ladepunkt
  for (const z of ggLadeparks().alle.filter(x => x.geplant)) {
    pos.push({ gruppe: 'lade', art: 'lade', label: z.e.a.name || 'Ladepark',
               umfang: `${z.l.punkte} LP${z.l.schnell ? ` + ${z.l.schnell} SL` : ''}`,
               investEur: z.l.punkte * k.ladepunktEur + z.l.schnell * k.schnellladepunktEur, jahr: z.jahr });
  }

  return { a: ekAuswertung(pos, k), offen, pv };
}

function ggRenderKostenText(cfg, T = GG_THEME) {
  void cfg;
  const { a, offen, pv } = ggKostenPositionen();
  const k = a.kennwerte;
  const absaetze = [];

  absaetze.push('Für die Maßnahmen der Kapitel 3.4.1 bis 3.4.4 werden die Investitionskosten und die jährlichen Kosten in '
    + 'Anlehnung an VDI 2067 ermittelt. Die Jahreskosten setzen sich aus dem Kapitaldienst (Annuität bei einem Kalkulationszins '
    + `von ${ggNum(k.zinsPct, 1)} % über die Nutzungsdauer) und der Instandhaltung zusammen. Grundlage sind die Kostenansätze des `
    + 'Netzmodells, die Wirtschaftlichkeitsberechnung der PV-Analyse und die Resilienz-Rechnung. Angesetzt werden für den '
    + `Netzanschluss ein Baukostenzuschuss von ${ggNum(k.bkzEurKw)} €/kW zusätzlicher Anschlussleistung`
    + (k.anschlussPauschalEur > 0 ? ` zuzüglich ${ggEuro(k.anschlussPauschalEur)} Anschlusskosten` : '')
    + ` sowie für die Ladeinfrastruktur ${ggEuro(k.ladepunktEur)} je Normal- und ${ggEuro(k.schnellladepunktEur)} je `
    + 'Schnellladepunkt'
    + (ggKostenVonHand() ? '.' : ' (Vorschlagswerte, durch Angebote des Netzbetreibers bzw. der Hersteller zu ersetzen).')
    + ' Es handelt sich um Kostenschätzungen, die in der weiteren Planung durch Angebote und die Kostenberechnung nach DIN 276 '
    + 'zu präzisieren sind.');

  const mit = a.gruppen.filter(g => g.investEur > 0);
  if (!mit.length) {
    absaetze.push('Für die betrachteten Maßnahmen ergeben sich derzeit keine bezifferbaren Investitionen.');
  } else {
    const groesste = mit.reduce((x, g) => (g.investEur > x.investEur ? g : x), mit[0]);
    absaetze.push(`Die Investitionen belaufen sich auf insgesamt rund ${ggEuro(a.summeInvestEur)} mit jährlichen Kosten von rund `
      + `${ggEuro(a.summeJahreskostenEur)}/a. Im Einzelnen entfallen ${ggAufzaehlung(mit.map(g => `${ggEuro(g.investEur)} auf ${g.label === 'Netzanschluss' ? 'den Netzanschluss' : g.label === 'Internes Stromnetz' ? 'das interne Stromnetz' : g.label === 'Notstromversorgung' ? 'die Notstromversorgung' : g.label === 'Ladeinfrastruktur' ? 'die Ladeinfrastruktur' : 'PV und Batteriespeicher'}`))}. `
      + (mit.length > 1
        ? `Den größten Anteil hat ${groesste.label === 'PV und Batteriespeicher' ? 'die Gruppe PV und Batteriespeicher' : `die Gruppe „${groesste.label}“`} `
          + `mit ${ggNum(groesste.investEur / a.summeInvestEur * 100)} %. `
        : '')
      + 'Die folgende Tabelle fasst die Maßnahmengruppen zusammen.');
  }

  if (pv?.wirt?.investGes > 0) {
    absaetze.push(`Für PV und Batteriespeicher geht die wirtschaftlich optimierte Variante „${gEsc(pv.label)}“ aus Kapitel 3.4.2 ein; `
      + 'ihre Jahreskosten stammen aus der PV-Analyse und enthalten die netzseitige Infrastruktur der Anlage. Da PV und Speicher '
      + 'zusätzlich Erlöse erzielen, ist ihre Wirtschaftlichkeit mit Kapitalwert und Stromgestehungskosten gesondert in der Tabelle '
      + '„Wirtschaftlichkeit je PV-Variante“ dargestellt.');
  }

  if (a.jahresreihe.length) {
    const jahre = a.jahresreihe.map(z => z.jahr);
    const spitze = a.jahresreihe.reduce((x, z) => {
      const s = EK_GRUPPEN.reduce((t, g) => t + z[g.key], 0);
      return s > x.s ? { jahr: z.jahr, s } : x;
    }, { jahr: null, s: 0 });
    absaetze.push(`Die Investitionen verteilen sich auf die Jahre ${ggJahresSpanne(jahre).replace('–', ' bis ')}; die höchste `
      + `Jahressumme fällt mit rund ${ggEuro(spitze.s)} im Jahr ${spitze.jahr} an`
      + (a.ohneJahrEur > 0 ? `. Weitere ${ggEuro(a.ohneJahrEur)} sind noch keinem Umsetzungsjahr zugeordnet.` : '.'));
  }

  if (offen.length) {
    absaetze.push(`Nicht beziffert sind: ${ggAufzaehlung(offen.map(gEsc))}. Diese Kosten sind ${ggTextFeld('', 'Ergänzung, z. B. nach Begehung bzw. Angebot')} zu ergänzen.`);
  }
  absaetze.push('Die Bewertung der Varianten folgt in Kapitel 3.6.');
  return ggTextBlatt(absaetze, T);
}

/** Einzelansicht der Kostenbausteine: Kennwerte zum Anpassen, Summen und offene Punkte. */
function ggKostenStandHtml() {
  const k = ggKostenKennwerte();
  const { a, offen } = ggKostenPositionen();
  const feld = (label, pfad, wert, einheit) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--muted);">
      ${gEsc(label)}
      <span style="display:flex;align-items:center;gap:4px;">
        <input type="number" step="any" min="0" value="${wert}" data-change="ggKostenKennwertSetzen('${pfad}',this.value)"
          style="font-family:inherit;font-size:11px;padding:3px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--text,#e8eaed);width:90px;">
        <span>${gEsc(einheit)}</span></span></label>`;
  const raster = inhalt => `<div style="display:flex;flex-wrap:wrap;gap:8px 14px;margin:6px 0;">${inhalt}</div>`;
  // Eingeklappt, sonst drücken die 15 Felder die Vorschau der Abbildung zusammen
  const kopf = `<button data-click="ggKostenKennwerteUmschalten()" style="font-family:inherit;font-size:11px;padding:3px 9px;border-radius:4px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--text,#e8eaed);">`
    + `${_ggKostenKennwerteOffen ? '▾' : '▸'} Kostenkennwerte ${ggKostenVonHand() ? '(angepasst)' : '<span style="color:#e0a126;">(Vorschlagswerte)</span>'}</button>`
    + '<span style="font-size:10px;color:var(--muted);margin-left:8px;">gelten für alle Kostenbausteine in 3.5</span>';
  if (!_ggKostenKennwerteOffen) {
    return `<div style="margin-bottom:6px;">${kopf}</div>`
      + `<div style="font-size:11px;line-height:1.6;">Investition gesamt ${ggEuro(a.summeInvestEur)} · Jahreskosten ${ggEuro(a.summeJahreskostenEur)}/a · ${a.positionen.length} Positionen</div>`
      + (offen.length ? `<div style="font-size:10px;color:#e0a126;margin-top:4px;line-height:1.5;">Nicht beziffert: ${gEsc(offen.join(' · '))}</div>` : '');
  }
  // Feldbereich mit fester Höhe und eigenem Scrollbalken — auch aufgeklappt bleibt die Vorschau sichtbar
  let html = `<div style="margin-bottom:4px;">${kopf}</div>`
    + '<div style="max-height:150px;overflow-y:auto;padding-right:6px;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);">'
    + raster(feld('Kalkulationszins', 'zinsPct', k.zinsPct, '%')
      + feld('Baukostenzuschuss', 'bkzEurKw', k.bkzEurKw, '€/kW')
      + feld('Anschlusskosten pauschal', 'anschlussPauschalEur', k.anschlussPauschalEur, '€')
      + feld('Normalladepunkt', 'ladepunktEur', k.ladepunktEur, '€/St.')
      + feld('Schnellladepunkt', 'schnellladepunktEur', k.schnellladepunktEur, '€/St.'))
    + raster(EK_ARTEN.map(art => feld(`${art.label}: Nutzungsdauer`, `nutzungsdauer.${art.key}`, k.nutzungsdauer[art.key], 'a')
      + feld(`${art.label}: Instandhaltung`, `instandhaltungPct.${art.key}`, k.instandhaltungPct[art.key], '%/a')).join(''))
    + '</div>'
    + `<button data-click="ggKostenKennwerteZuruecksetzen()" style="margin-top:6px;font-size:10px;padding:3px 9px;border-radius:4px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);">↺ Vorschlagswerte</button>`
    + `<div style="margin-top:8px;font-size:11px;line-height:1.6;">Investition gesamt ${ggEuro(a.summeInvestEur)} · Jahreskosten ${ggEuro(a.summeJahreskostenEur)}/a · ${a.positionen.length} Positionen</div>`;
  if (offen.length) {
    html += `<div style="font-size:10px;color:#e0a126;margin-top:4px;line-height:1.5;">Nicht beziffert: ${gEsc(offen.join(' · '))}</div>`;
  }
  return html + '<div style="margin-top:6px;font-size:10px;color:var(--muted);line-height:1.5;">PV und Speicher: Investition und '
    + 'Jahreskosten der wirtschaftlich optimierten Variante aus der PV-Analyse (dort eigener Zins). Notstrom: Kostensatz der '
    + 'Resilienz-Rechnung. Internes Netz: Ertüchtigungsvorschläge des Netzmodells.</div>';
}

let _ggKostenKennwerteOffen = false;
/** Kennwert-Felder in der Einzelansicht auf- bzw. zuklappen. */
export function ggKostenKennwerteUmschalten() {
  _ggKostenKennwerteOffen = !_ggKostenKennwerteOffen;
  ggRenderPanel();
}

/** Kostenkennwert ändern (Pfad „zinsPct“ oder „nutzungsdauer.kabel“) — wird mit dem Projekt gespeichert. */
export function ggKostenKennwertSetzen(pfad, wert) {
  const fig = ggKostenFigur();
  if (!fig) return;
  const n = Number(String(wert ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return;
  const k = ekNormKennwerte(fig.config.kennwerte);
  const [teil, schluessel] = String(pfad).split('.');
  if (schluessel) {
    if (k[teil] && schluessel in k[teil]) k[teil][schluessel] = n;
  } else if (teil in k) {
    k[teil] = n;
  }
  fig.config.kennwerte = ekNormKennwerte(k);
  ggMerkeManuell('kosten-gruppen', 'kennwerte');
  ggRenderPanel();
}

export function ggKostenKennwerteZuruecksetzen() {
  const fig = ggKostenFigur();
  if (!fig) return;
  fig.config.kennwerte = ekNormKennwerte(null);
  _ggManuell.get('kosten-gruppen')?.delete('kennwerte');
  ggRenderPanel();
}

GG_FIGUREN.push(
  // ── Gutachtentext: Wirtschaftlichkeit und Investitionskosten ────────────
  {
    id: 'kosten-text',
    istText: true,
    kostenFigur: true,
    reihe: 5,
    kapitel: GG_KAP_WIRT,
    titel: 'Gutachtentext: Wirtschaftlichkeit und Investitionskosten',
    datei: 'kosten-text',
    hinweis: 'Methode (VDI 2067), Kostenkennwerte, Gesamtinvestition und Jahreskosten, Anteile der Maßnahmengruppen, zeitliche '
           + 'Verteilung und nicht bezifferte Positionen. Kennwerte sind in der Einzelansicht anpassbar.',
    render: cfg => ggRenderKostenText(cfg),
    config: {},
  },

  // ── Kosten je Maßnahmengruppe ──────────────────────────────────────────
  {
    id: 'kosten-gruppen',
    autoSync: true,
    kostenFigur: true,
    reihe: 10,
    kapitel: GG_KAP_WIRT,
    titel: 'Investitionen und Jahreskosten je Maßnahmengruppe',
    datei: 'kosten-gruppen',
    hinweis: 'Maßnahmengruppe, Umfang, Investition, Nutzungsdauer, Jahreskosten (Annuität + Instandhaltung) und Zeitpunkt, mit '
           + 'Summenzeile. Die Kostenkennwerte dieser Tabelle gelten für alle Kostenbausteine in 3.5.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Investitionen und Jahreskosten je Maßnahmengruppe',
      leer: 'Keine bezifferbaren Maßnahmen.',
      spalten: [
        { label: 'Maßnahmengruppe', weight: 1.6, align: 'left', mono: false },
        { label: 'Umfang',          weight: 1.6, align: 'left', mono: false },
        { label: 'Investition',     weight: 1.2 },
        { label: 'Nutzungsdauer',   weight: 1.1 },
        { label: 'Jahreskosten',    weight: 1.2 },
        { label: 'Zeitpunkt',       weight: 0.9 },
      ],
      zeilen: [], fussnote: '',
      kennwerte: JSON.parse(JSON.stringify(EK_VORGABEN)),
    },
    ausProjekt(cfg) {
      const { a, offen } = ggKostenPositionen();
      const mit = a.gruppen.filter(g => g.investEur > 0);
      if (!mit.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine bezifferbaren Maßnahmen.'; }
      cfg.zeilen = mit.map(g => ({
        werte: [
          g.label,
          g.positionen.length === 1 ? g.positionen[0].umfang : `${g.positionen.length} Positionen`,
          ggEuro(g.investEur),
          g.nutzungsdauern.length === 1 ? `${g.nutzungsdauern[0]} a` : `${g.nutzungsdauern[0]}–${g.nutzungsdauern[g.nutzungsdauern.length - 1]} a`,
          `${ggEuro(g.jahreskostenEur)}/a`,
          ggJahresSpanne(g.jahre),
        ],
        akzent: GG_KOSTEN_FARBEN[g.key],
      }));
      cfg.zeilen.push({ werte: ['Summe', ' ', ggEuro(a.summeInvestEur), ' ', `${ggEuro(a.summeJahreskostenEur)}/a`, ' '], highlight: true });
      const kw = a.kennwerte;
      cfg.fussnote = `Kostenschätzung · Zins ${ggNum(kw.zinsPct, 1)} % · Baukostenzuschuss ${ggNum(kw.bkzEurKw)} €/kW · `
                   + `Ladepunkt ${ggNum(kw.ladepunktEur)} € / Schnellladepunkt ${ggNum(kw.schnellladepunktEur)} € · PV: Werte der PV-Analyse`
                   + (ggKostenVonHand() ? '' : ' · Vorschlagswerte')
                   + (offen.length ? ' · nicht beziffert siehe Text' : '');
      return `✓ ${a.positionen.length} Kostenpositionen übernommen` + (offen.length ? ` — ${offen.length} Punkte nicht beziffert.` : '.');
    },
  },

  // ── Investitionen je Jahr ──────────────────────────────────────────────
  {
    id: 'kosten-jahre',
    autoSync: true,
    kostenFigur: true,
    reihe: 20,
    kapitel: GG_KAP_WIRT,
    titel: 'Investitionen je Jahr',
    datei: 'kosten-jahre',
    hinweis: 'Gestapelte Säulen je Umsetzungsjahr nach Maßnahmengruppe; Positionen ohne Jahr stehen in der Säule „offen“.',
    render: cfg => ggRenderBalken(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Investitionen je Jahr',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Investition in Tsd. €',
      achseX: 'Umsetzungsjahr',
      leer: 'Keine bezifferbaren Maßnahmen.',
      kategorien: [], gruppen: [], summenLabel: true, summenEinheit: ' T€', kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      const { a } = ggKostenPositionen();
      if (!a.positionen.length) { cfg.kategorien = []; cfg.gruppen = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Keine bezifferbaren Maßnahmen.'; }
      const zeilen = [...a.jahresreihe];
      if (a.ohneJahrEur > 0) {
        zeilen.push({ jahr: 'offen', ...Object.fromEntries(EK_GRUPPEN.map(g => [g.key,
          a.positionen.filter(p => p.gruppe === g.key && p.jahr == null).reduce((s, p) => s + p.investEur, 0)])) });
      }
      cfg.kategorien = zeilen.map(z => String(z.jahr));
      cfg.gruppen = [{ label: 'Investition', segmente: a.gruppen.filter(g => g.investEur > 0).map(g => ({
        label: g.label, farbe: GG_KOSTEN_FARBEN[g.key], werte: zeilen.map(z => z[g.key] / 1000),
      })) }];
      const summeJahr = z => EK_GRUPPEN.reduce((s, g) => s + z[g.key], 0);
      const spitze = zeilen.reduce((x, z) => (summeJahr(z) > summeJahr(x) ? z : x), zeilen[0]);
      cfg.kpiLinks = [
        { wert: ggEuro(a.summeInvestEur), label: 'Investition gesamt' },
        { wert: ggEuro(summeJahr(spitze)), label: `Höchste Jahressumme (${spitze.jahr})` },
      ];
      cfg.kpiRechts = [
        { wert: `${ggEuro(a.summeJahreskostenEur)}/a`, label: 'Jahreskosten gesamt' },
        { wert: a.jahresreihe.length ? ggJahresSpanne(a.jahresreihe.map(z => z.jahr)) : 'offen', label: 'Umsetzungszeitraum', highlight: true },
      ];
      return `✓ Investitionen von ${zeilen.length} ${zeilen.length === 1 ? 'Jahr' : 'Jahren'} übernommen.`;
    },
  },

  // ── Kostenaufteilung ───────────────────────────────────────────────────
  {
    id: 'kosten-aufteilung',
    autoSync: true,
    kostenFigur: true,
    reihe: 30,
    kapitel: GG_KAP_WIRT,
    titel: 'Aufteilung der Investitionen',
    datei: 'kosten-aufteilung',
    hinweis: 'Investition je Maßnahmengruppe mit ihrem Anteil an der Gesamtinvestition.',
    render: cfg => ggRenderBalken(cfg),
    config: {
      eyebrow: 'Elektrotechnisches Gutachten',
      titel: 'Aufteilung der Investitionen',
      ort: '',
      meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
      achseY: 'Investition in Tsd. €',
      achseX: 'Maßnahmengruppe (Anteil an der Gesamtinvestition)',
      leer: 'Keine bezifferbaren Maßnahmen.',
      kategorien: [], gruppen: [], summenLabel: true, summenEinheit: ' T€', kpiLinks: [], kpiRechts: [],
    },
    ausProjekt(cfg) {
      cfg.ort = cfg.ort || ggLiegenschaft();
      cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
      ggMetaDefaults(cfg, 'pdBearbeiterStrom');
      const { a } = ggKostenPositionen();
      const mit = a.gruppen.filter(g => g.investEur > 0).sort((x, y) => y.investEur - x.investEur);
      if (!mit.length) { cfg.kategorien = []; cfg.gruppen = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Keine bezifferbaren Maßnahmen.'; }
      cfg.kategorien = mit.map(g => `${g.label} (${ggNum(g.investEur / a.summeInvestEur * 100)} %)`);
      // Eine Säule je Gruppe in ihrer Farbe: jedes Segment trägt nur an seiner eigenen Position einen Wert
      cfg.gruppen = [{ label: 'Investition', segmente: mit.map((g, i) => ({
        label: '', farbe: GG_KOSTEN_FARBEN[g.key], werte: mit.map((_, j) => (i === j ? g.investEur / 1000 : 0)),
      })) }];
      const jkAnteil = g => (a.summeJahreskostenEur > 0 ? ggNum(g.jahreskostenEur / a.summeJahreskostenEur * 100) : '0');
      cfg.kpiLinks = [
        { wert: ggEuro(a.summeInvestEur), label: 'Investition gesamt' },
        { prozent: `${ggNum(mit[0].investEur / a.summeInvestEur * 100)} %`, wert: ggEuro(mit[0].investEur), label: `Größte Gruppe: ${mit[0].label}` },
      ];
      cfg.kpiRechts = [
        { wert: `${ggEuro(a.summeJahreskostenEur)}/a`, label: 'Jahreskosten gesamt' },
        { wert: `${jkAnteil(mit[0])} %`, label: `Anteil ${mit[0].label} an den Jahreskosten`, highlight: true },
      ];
      return `✓ ${mit.length} Maßnahmengruppen übernommen.`;
    },
  },
);

/* ══════════════════════════════════════════════════════════════════════════
 * 5b) SCHNITTSTELLE ZUM GUTACHTEN-EDITOR (21-gutachten-editor.js)
 *
 * Der Editor setzt Figuren als Blöcke ins Dokument und teilt sich die Configs
 * mit der Einzelansicht — was dort eingestellt wird (Haken, Kopfzeile), gilt
 * auch im Dokument. Die von Hand änderbaren Felder landen in der Projektdatei;
 * Datenreihen nicht, die kommen beim Zeichnen frisch aus dem Projekt.
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_EINSTELLUNG_TEXTFELDER = ['eyebrow', 'titel', 'tabelleTitel', 'ort'];

/** Von Hand änderbare Felder einer Figur-Config (ohne Datenreihen). */
function ggEinstellungenVon(cfg) {
  const out = {};
  for (const f of GG_EINSTELLUNG_TEXTFELDER) if (typeof cfg[f] === 'string') out[f] = cfg[f];
  if (cfg.meta) out.meta = { ...cfg.meta };
  if (cfg.groups) out.states = Object.fromEntries(cfg.groups.flatMap(g => g.items.map(it => [it.key, it.state])));
  if (cfg.kennwerte) out.kennwerte = JSON.parse(JSON.stringify(cfg.kennwerte));   // Kostenkennwerte (3.5)
  return out;
}

/** Auslieferungszustand je Figur — zum Zurücksetzen beim Projektwechsel. */
const GG_EINSTELLUNG_DEFAULTS = new Map(GG_FIGUREN.map(f => [f.id, ggEinstellungenVon(f.config)]));

/**
 * Von Hand gesetzte Felder je Figur ('titel', 'meta:Datum', 'states', …). Nur die
 * werden gespeichert — was ausProjekt selbst vorbelegt (Datum, Bearbeiter,
 * Liegenschaft), soll wie bisher bei jedem Öffnen frisch aus dem Projekt kommen.
 */
const _ggManuell = new Map();
function ggMerkeManuell(id, feld) {
  if (!_ggManuell.has(id)) _ggManuell.set(id, new Set());
  _ggManuell.get(id).add(feld);
}

/** Von Hand gesetzte Einstellungen je Figur, für die Projektdatei. */
export function ggFigurEinstellungenCapture() {
  const out = {};
  for (const f of GG_FIGUREN) {
    const felder = _ggManuell.get(f.id);
    if (!felder?.size) continue;
    const ist = ggEinstellungenVon(f.config);
    const eintrag = {};
    for (const feld of felder) {
      if (feld.startsWith('meta:')) {
        const k = feld.slice(5);
        if (!ist.meta || !(k in ist.meta)) continue;
        if (!eintrag.meta) eintrag.meta = {};
        eintrag.meta[k] = ist.meta[k];
      } else if (feld in ist) {
        eintrag[feld] = ist[feld];
      }
    }
    if (Object.keys(eintrag).length) out[f.id] = eintrag;
  }
  return out;
}

/** Gespeicherte Einstellungen anwenden — vorher alles auf Auslieferungszustand, damit nichts vom vorigen Projekt hängen bleibt. */
export function ggFigurEinstellungenRestore(daten) {
  const d = daten && typeof daten === 'object' ? daten : {};
  _ggManuell.clear();
  for (const f of GG_FIGUREN) {
    const cfg = f.config, soll = GG_EINSTELLUNG_DEFAULTS.get(f.id) || {};
    const gespeichert = d[f.id] && typeof d[f.id] === 'object' ? d[f.id] : {};
    for (const k of GG_EINSTELLUNG_TEXTFELDER) {
      const vonHand = typeof gespeichert[k] === 'string';
      const wert = vonHand ? gespeichert[k] : soll[k];
      if (wert === undefined) delete cfg[k]; else cfg[k] = wert;
      if (vonHand) ggMerkeManuell(f.id, k);
    }
    if (cfg.meta) {
      const meta = { ...(soll.meta || {}) };
      for (const [k, v] of Object.entries(gespeichert.meta || {})) {
        if (typeof v === 'string') { meta[k] = v; ggMerkeManuell(f.id, 'meta:' + k); }
      }
      cfg.meta = meta;
    }
    if (cfg.groups) {
      const vonHand = gespeichert.states && typeof gespeichert.states === 'object';
      const states = { ...(soll.states || {}), ...(vonHand ? gespeichert.states : {}) };
      cfg.groups.forEach(g => g.items.forEach(it => {
        if (states[it.key] === 'on' || states[it.key] === 'off') it.state = states[it.key];
      }));
      if (vonHand) ggMerkeManuell(f.id, 'states');
    }
    if (cfg.kennwerte) {
      const vonHand = gespeichert.kennwerte && typeof gespeichert.kennwerte === 'object';
      cfg.kennwerte = JSON.parse(JSON.stringify(vonHand ? gespeichert.kennwerte : (soll.kennwerte || {})));
      if (vonHand) ggMerkeManuell(f.id, 'kennwerte');
    }
  }
}

/** Teile einer Figur im Dokument: Abbildung, Blatt + Kennzahlentabelle, reine Tabelle oder Fließtext (null = keine Beschriftung). */
function ggTeilArten(figur, { layout = 'reduziert', kennzahlen = true } = {}) {
  if (figur.istText) return [null];
  if (ggIstTabellenFigur(figur)) return ['Tabelle'];
  if (ggIstBlatt(figur) && layout === 'reduziert' && kennzahlen) return ['Abbildung', 'Tabelle'];
  return ['Abbildung'];
}

export function ggFigurenKatalog() {
  return GG_FIGUREN.map(f => ({
    id: f.id, titel: f.titel, kapitel: f.kapitel || '', hinweis: f.hinweis || '',
    istText: !!f.istText, istBlatt: ggIstBlatt(f), istTabelle: ggIstTabellenFigur(f),
    reihe: Number.isFinite(f.reihe) ? f.reihe : null,
  }));
}

export function ggFigurTeilArten(id, opts) {
  const figur = GG_FIGUREN.find(f => f.id === id);
  return figur ? ggTeilArten(figur, opts) : [];
}

/**
 * Figur für die Dokumentansicht zeichnen. Figuren, die sich ganz aus dem
 * Projekt speisen, holen ihre Daten vorher selbst (wie in der Einzelansicht).
 * Das Blatt-Layout gilt nur für diesen Block — die Einzelansicht behält ihres.
 */
export function ggRenderFigurFuerDokument(id, opts = {}) {
  const figur = GG_FIGUREN.find(f => f.id === id);
  if (!figur) return null;
  let meldung = '';
  if (figur.autoSync && typeof figur.ausProjekt === 'function') {
    const r = figur.ausProjekt(figur.config);
    if (typeof r === 'string') meldung = r;
  }
  const arten = ggTeilArten(figur, opts);
  const blatt = ggIstBlatt(figur);
  const vorherLayout = figur.config.layout, vorherKennzahlen = figur.config.kennzahlen;
  if (blatt) {
    figur.config.layout = opts.layout === 'voll' ? 'voll' : 'reduziert';
    figur.config.kennzahlen = opts.kennzahlen !== false;
  }
  try {
    const teile = [{ art: arten[0], el: figur.render(figur.config) }];
    if (arten[1]) teile.push({ art: arten[1], el: ggRenderKennzahlen(figur.config) });
    return { teile, meldung, titel: figur.config.titel || figur.titel, tabelleTitel: figur.config.tabelleTitel || 'Kennzahlen' };
  } finally {
    if (blatt) { figur.config.layout = vorherLayout; figur.config.kennzahlen = vorherKennzahlen; }
  }
}

/**
 * „Für Word kopieren“ aus dem Dokument: Fließtext als Text, Tabellen und Kennzahlen als echte
 * Word-Tabelle, sonst das gezeichnete Bild — ohne Bildunterschrift oder Nummer (s. gutCopyTeil
 * in 21), damit nichts mit der Beschriftung/Nummerierung des Zieldokuments kollidiert.
 */
export async function ggCopyDokumentTeil(id, teilIdx, el, scale = 3) {
  const figur = GG_FIGUREN.find(f => f.id === id);
  if (!figur) throw new Error('Abbildung nicht gefunden.');
  if (figur.istText) return ggCopyTextForWord(figur);
  if (ggIstTabellenFigur(figur) || teilIdx > 0) return ggCopyTableForWord(figur.config);
  return ggCopyForWord(el, scale);
}

/** Absätze eines Textbausteins als Segmente [{text, offen}] — aus dem gezeichneten HTML, damit Text und Word nie auseinanderlaufen. */
function ggTextSegmente(el) {
  return [...el.querySelectorAll('p')].map(p => {
    const segs = [...p.childNodes].map(n => ({
      text: (n.textContent || '').replace(/\s+/g, ' '),
      offen: n.nodeType === 1 && n.dataset?.ggFeld === 'offen',
    })).filter(s => s.text);
    if (segs.length) {
      segs[0].text = segs[0].text.replace(/^\s+/, '');
      segs[segs.length - 1].text = segs[segs.length - 1].text.replace(/\s+$/, '');
    }
    return segs.filter(s => s.text);
  }).filter(segs => segs.length);
}

/**
 * Inhalt eines Figurteils für den Word-Export (lib/gutachten-docx.js):
 *   {art: 'text', absaetze}  — Textbaustein
 *   {art: 'tabelle', spalten, zeilen, fussnote, leer} — echte Word-Tabelle (Tabellenfigur oder Kennzahlen)
 *   {art: 'bild'}            — gezeichnete Abbildung, rastert der Editor selbst
 * Setzt voraus, dass die Figur gerade gezeichnet wurde (ggRenderFigurFuerDokument) — die Config ist dann aktuell.
 */
export function ggFigurWordDaten(id, teilIdx = 0) {
  const figur = GG_FIGUREN.find(f => f.id === id);
  if (!figur) return null;
  const cfg = figur.config;
  if (figur.istText) return { art: 'text', absaetze: ggTextSegmente(figur.render(cfg)) };
  if (ggIstTabellenFigur(figur)) {
    return {
      art: 'tabelle',
      spalten: cfg.spalten.map((c, i) => ({ label: c.label || '', gewicht: c.weight || 1, align: ggSpaltenDefaults(c, i).align })),
      zeilen: (cfg.zeilen || []).map(z => ({ werte: z.werte || [], highlight: !!z.highlight })),
      fussnote: cfg.fussnote || '', leer: cfg.leer || '',
    };
  }
  if (teilIdx > 0) {
    return {
      art: 'tabelle',
      spalten: [{ label: 'Kennzahl', gewicht: 2.6 }, { label: 'Wert', gewicht: 1.2, align: 'right' },
                { label: 'Einheit', gewicht: 0.9, align: 'left' }, { label: 'Anteil', gewicht: 0.9, align: 'right' }],
      zeilen: ggKpiZeilen(cfg).map(r => {
        const { zahl, einheit } = ggSplitWert(r.wert);
        return { werte: [r.label || '', zahl, einheit, r.prozent || ''], highlight: !!r.highlight };
      }),
      leer: cfg.leer || '',
    };
  }
  return { art: 'bild' };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6) PANEL — Analyse-Sektion „Gutachten-Grafiken"
 * ═══════════════════════════════════════════════════════════════════════ */
/** Liegenschaft aus dem Projektkopf und der Adresse in den Projektdaten (NICHT dem Klimastandort — der
 * bezeichnet nur die DWD-Referenzstation der Wärmebedarfsrechnung und liegt oft nicht am realen Standort). */
function ggLiegenschaft() {
  const name = document.querySelector('.header-projekt-name')?.textContent?.trim() || '';
  const adresse = String(window.pdLiegenschaftAdresse || '').trim();
  return [name, adresse].filter(Boolean).join(' · ');
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
/** Figuren, die selbst schon eine Tabelle SIND (ggRenderTabelle) — auch sie koennen als Word-Tabelle raus. */
const ggIstTabellenFigur = figur => Array.isArray(figur.config.spalten);
/** Was Kopieren/PNG/SVG gerade betrifft — Abbildung oder Kennzahlenblatt. */
const ggAktivesSvg = () => (_gg.ziel === 'tabelle' && _gg.svgTabelle) ? _gg.svgTabelle : _gg.svg;
const ggAktiveDatei = () => ggFigur().datei + (_gg.ziel === 'tabelle' && _gg.svgTabelle ? '-kennzahlen' : '');

/**
 * Einzelansicht (eine Figur samt Export-Leiste) in einen Container einhängen — idempotent.
 * Seit dem Gutachten-Editor ist das die zweite Ansicht des Reiters „📝 Gutachten“;
 * Reiter und Umschalter baut 21-gutachten-editor.js.
 */
export function ggMountEinzelansicht(host) {
  if (!host || host.querySelector('#gg-sidebar')) return;
  host.innerHTML = `
<div style="display:flex;flex-direction:row;gap:0;height:100%;min-height:400px;">
  <div id="gg-sidebar" style="width:250px;flex-shrink:0;overflow-y:auto;border-right:1px solid rgba(38,166,154,.15);padding:10px;"></div>
  <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow-y:auto;padding:12px 14px;">
    <div id="gg-bar" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;"></div>
    <div id="gg-paper" style="background:#fff;border-radius:6px;padding:10px;overflow-x:auto;"></div>
    <div id="gg-status" style="font-size:11px;color:#26a69a;min-height:16px;margin-top:8px;"></div>
    <div id="gg-optionen" style="margin-top:10px;"></div>
  </div>
</div>`;
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

/** Einzelansicht aufrufen — Sichtbarkeit des Reiters steuert 21-gutachten-editor.js. */
export function ggShowSection(visible) {
  if (!visible || !document.getElementById('gg-paper')) return;
  const meldung = ggAutoSync();
  ggRenderPanel();
  if (meldung) ggSay(meldung);
}

export function ggRenderPanel() {
  const figur = ggFigur();
  // Die Blattversion gilt fuer alle Blatt-Figuren gemeinsam; die Status-Matrix
  // kennt kein Layout und bleibt unberuehrt.
  if (ggIstBlatt(figur)) figur.config.layout = _gg.layout;
  if (!ggZeigtTabelle(figur) && !ggIstTabellenFigur(figur)) _gg.ziel = 'figur';

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
    if (figur.istText) {
      bar.innerHTML = btn('⧉ Für Word kopieren', 'ggCopy()', true)
        + `<span style="margin-left:auto;font-size:10px;color:var(--muted);">In Word mit Strg+V einfügen — offene Platzhalter bleiben gelb hervorgehoben, bis sie ausgefüllt sind.</span>`;
    } else {
      const zielTabelle = ggZielIstTabelle();
      bar.innerHTML = btn(zielTabelle ? '⊞ Als Tabelle kopieren' : '⧉ Für Word kopieren', 'ggCopy()', true)
        + btn('⤓ PNG', 'ggSavePng()') + btn('⤓ SVG', 'ggSaveSvg()')
        + sel('ggSetScale(this.value)', [[2, '2× · ~300 dpi'], [3, '3× · ~450 dpi'], [4, '4× · ~600 dpi']], _gg.scale)
        + (ggIstBlatt(figur)
            ? sel('ggSetLayout(this.value)', [['voll', 'Blatt: vollständig'],
                                              ['reduziert', 'Blatt: reduziert + Kennzahlentabelle']], _gg.layout)
            : '')
        + ((ggZeigtTabelle(figur) || ggIstTabellenFigur(figur))
            ? sel('ggSetZiel(this.value)', [['figur', 'Export: Abbildung'],
                  ['tabelle', ggIstTabellenFigur(figur) ? 'Export: Word-Tabelle' : 'Export: Kennzahlen']], _gg.ziel)
            : '')
        + `<span style="margin-left:auto;font-size:10px;color:var(--muted);">${zielTabelle
            ? '„Als Tabelle kopieren" + Strg+V ergibt eine echte, editierbare Word-Tabelle — PNG/SVG legen die Tabelle stattdessen als Bild ab.'
            : 'In Word mit Strg+V einfügen — SVG bleibt Vektor über Einfügen › Bilder.'}</span>`;
    }
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
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">${figur.istText ? 'Platzhalter' : figur.config.groups ? 'Zustände' : 'Kopfzeile'}</div>`;
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

    if (figur.id === 'netzanschluss-text') {
      // Nur Anzeige: eingetragen wird unter ⚡ Strom-Grundlagen › Netzanschluss (22-netzanschluss-panel.js)
      const zeile = (label, wert, quelle) => {
        const w = String(wert ?? '').trim();
        return `<div style="display:grid;grid-template-columns:210px 1fr;gap:8px;font-size:11px;line-height:1.6;">
            <span style="color:var(--muted);">${gEsc(label)}</span>
            <span style="color:${w ? 'var(--text,#e8eaed)' : '#e0a126'};">${w ? gEsc(w) : 'fehlt'}<span style="color:var(--muted);font-size:10px;"> · ${gEsc(quelle)}</span></span>
          </div>`;
      };
      const einspeisungen = window.naEinspeisungen?.length ? window.naEinspeisungen : [{ station: '', kabeltyp: '' }];
      html += zeile('Name Netzbetreiber', window.naNetzbetreiberName, 'Netzanschlussvertrag')
        + zeile('Adresse Netzbetreiber', window.naNetzbetreiberAdresse, 'Netzanschlussvertrag')
        + zeile('Spannungsebene', window.naSpannungsebene, 'Vertrag / NAP-Asset')
        + zeile('Übergabepunkt', window.naUebergabepunkt, 'Vertrag / NAP-Asset')
        + zeile('Vereinbarte Anschlussleistung (kVA)', window.elNapMaxBezugKw, 'Netzanschlussvertrag')
        + zeile('Messverfahren', window.naMessverfahren, 'Stromrechnung / Zähler')
        + einspeisungen.map((e, i) => {
            const nr = einspeisungen.length > 1 ? ` ${i + 1}` : '';
            return zeile(`Station${nr}`, e.station, 'Netzbetreiber / Begehung') + zeile(`Kabeltyp${nr}`, e.kabeltyp, 'Netzbetreiber / Bestandsplan');
          }).join('')
        + `<button data-click="sgNaOeffnen()" style="margin-top:10px;font-size:11px;padding:5px 10px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,213,79,.45);background:rgba(255,213,79,.08);color:#ffd54f;">⚡ In Strom-Grundlagen bearbeiten</button>`
        + `<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">Eingetragen werden die Netzanschlussdaten unter ⚡ Strom-Grundlagen › Netzanschluss; die vereinbarte Anschlussleistung im Feld „Max. Bezug" unter NAP-Grenzen (kVA) — beides mit der Projektdatei gespeichert.</div>`;
    } else if (figur.bedarfText) {
      // Nur Anzeige: Messbasis, GZF und Maßnahmen-Haken werden in der NAP-Analyse gepflegt
      html += ggBedarfStandHtml(figur.bedarfText);
    } else if (figur.pvText) {
      // Nur Anzeige: die Werte kommen aus dem letzten „Varianten berechnen“ der PV-Analyse
      const s = window._pvAnalyse;
      html += s?.berechnet
        ? `<div style="font-size:11px;color:var(--muted);line-height:1.6;">Werte aus ☀ PV-Analyse · Berechnungsstand ${gEsc(s.standText || '—')}`
          + (s.stale ? ` · <span style="color:#e0a126;">Eingaben seither geändert — dort „Varianten neu berechnen“.</span>` : '')
          + `</div><div style="font-size:10px;color:var(--muted);margin-top:4px;">Gelbe Platzhalter erfasst das Tool nicht (z. B. Speichertechnologie, Aufstellort) — in Word ergänzen.</div>`
        : `<div style="font-size:11px;color:#e0a126;">Noch keine PV-Varianten berechnet — in ☀ PV-Analyse auf „Varianten berechnen“ klicken.</div>`;
    } else if (figur.kostenFigur) {
      // Kostenkennwerte (3.5) — hier eingetragen, gelten für alle Kostenbausteine
      html += ggKostenStandHtml();
    } else if (figur.ladeText) {
      // Nur Anzeige: Ladeparks und Netz werden im Elektro-Tab gepflegt
      html += ggLadeStandHtml();
    } else if (figur.notstromText) {
      // Nur Anzeige: Auslegung kommt aus Abb. 10 „Resilienz“, Aggregate aus dem Elektro-Tab
      html += ggNotstromStandHtml();
    } else if (figur.netzInternText) {
      // Nur Anzeige: Netz und Maßnahmen werden im Elektro-Tab gepflegt
      html += ggNetzInternStandHtml();
    } else if (figur.stromdatenText) {
      // Nur Anzeige: Messjahre und Referenzjahr werden unter ⚡ Strom-Grundlagen gepflegt
      html += ggStromdatenStandHtml();
    } else if (figur.anlagenText) {
      // Nur Anzeige: Anlagen und Leistungen werden im Elektro-Tab gepflegt
      html += ggAnlagenStandHtml(figur.anlagenText);
    } else if (figur.istText) {
      html += `<div style="font-size:11px;color:var(--muted);">Fester Text ohne Platzhalter.</div>`;
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
  ggMerkeManuell(ggFigur().id, 'states');
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
    ggMerkeManuell(figur.id, 'states');   // per Knopf übernommene Haken gelten wie von Hand gesetzt
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
  ggMerkeManuell(ggFigur().id, feld);
  ggRenderPanel();
}

export function ggSetMeta(key, wert) {
  const meta = ggFigur().config.meta;
  if (meta) {
    meta[key] = wert;
    ggMerkeManuell(ggFigur().id, 'meta:' + key);
  }
  ggRenderPanel();
}

/** Aktuelles Kopierziel ist das Kennzahlenblatt — dann als echte Tabelle statt als Bild. */
const ggZielIstTabelle = () => _gg.ziel === 'tabelle' && (ggZeigtTabelle(ggFigur()) || ggIstTabellenFigur(ggFigur()));

export async function ggCopy() {
  if (ggFigur().istText) {
    ggSay('Wird vorbereitet …');
    try {
      const wohin = await ggCopyTextForWord(ggFigur());
      ggSay(`✓ Text in die ${wohin} kopiert — in Word mit Strg+V einfügen.`);
    } catch (e) { ggSay('⚠ ' + e.message, true); }
    return;
  }
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
