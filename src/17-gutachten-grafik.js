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
import { naKvaText, NA_MESSORTE } from './lib/netzanschluss.js';
import { BP_STUFEN, bpStufen, bpLadeLeistung, bpJahresreihe } from './lib/bedarfsprognose.js';
import { sdJahresuebersicht, sdJahresauswertung, sdTrend, sdZeitraumText, sdDauerlinie } from './lib/stromdaten.js';
import { ENGPASS_GRENZEN, ENGPASS_VORLAUF_J, engpassVersorgung } from './lib/engpass-core.js';
import { EK_GRUPPEN, EK_ARTEN, EK_VORGABEN, ekNormKennwerte, ekAuswertung } from './lib/elektro-kosten.js';
import { resilienzZielMatrix, zielKraftstoffL } from './lib/resilienz-core.js';
import { nuNetzUebersicht } from './lib/netz-uebersicht.js';
import {
  wtIstZustand, wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit, wtDeckungsleistung,
} from './lib/gutachten-waerme-texte.js';
import { gbAuswertung, gbBgf, gbTextBestand, gbTextVeraenderung, gbTextEntwicklung, GB_SPEZ_KLASSEN } from './lib/gutachten-gebaeude.js';
import { nwgVergleichswert } from './lib/vergleichswerte-nwg.js';
import { wtEisspeicher } from './lib/gutachten-eisspeicher-text.js';
import { geTextZiele, geTextLiegenschaft, geTextIstEinstieg } from './lib/gutachten-einleitung.js';
import { baAuswertung, baTwwAuswertung, baVerbrauchAuswertung, baVerbrauchsaufteilung } from './lib/bestandsanlage.js';
import { abMonatsMwh, abWoche, abKorrelation, abDeckungsKurve, abLwwpSimulation, abLwwpSweep, abKostenstruktur, abPvVergleich, abWasserfallBedarf, abSchallAbstaende, abFahrplanPhasen } from './lib/gutachten-abbildungen.js';
import { vbTextDaten, vbTextBezug, vbTextCo2, vbTextReferenzjahr, vbTextAufteilung } from './lib/gutachten-verbrauch.js';
import { LG_INNEN, lgTextWitterung, lgTextGrundlast, lgTextSpitzenlast, lgTextDeckung } from './lib/gutachten-lastgang.js';
import { PT_NICHT, PT_GEO_ASPEKTE, PT_LWWP_VORNACH, PT_TA_LAERM, PT_BIO, PT_BIO_QUALITATIV, ptBioKennwerte, ptTextEinleitung, ptTextNicht, ptTextBeruecksichtigt,
  ptTextGeoGrundlagen, ptTextGeoBerechnung, ptTextTiefengeothermie, ptTextLwwp, ptTextSchall, ptTextBiomasse } from './lib/gutachten-potenzial.js';
import { FA_NT_KOSTEN, FA_KRITERIEN, faBewertungsmatrix, faNtKosten, faNtVergleich, faTextBewertung, faTextEmpfehlung, faTextNt, faTextFahrplan, faTextHeizoeltank, faTextResilienzUebergang } from './lib/gutachten-fazit.js';
import { VA_CO2_QUELLE, VA_STROM_EF, vaRahmenZeilen, vaTextRahmen, vaTextResilienz, vaGegenueberstellung, vaTextKlima, vaTextKostenKomponenten, vaTextPv, vaSensitivitaet, vaTextSensitivitaet, VA_SZENARIEN } from './lib/gutachten-varianten.js';
import { atTextErzeuger, atTextHydraulik, atTextTww, atTextNetz, atLeistung } from './lib/gutachten-anlagentechnik.js';

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
    else {
      // Legende oben rechts: Kopfraum freihalten, damit sie keine Säulen oder Werte verdeckt
      const nLeg = gruppen.reduce((n, g) => n + g.segmente.filter(seg => seg.label).length, 0);
      if (nLeg) max /= Math.max(0.5, 1 - (10 + 8 + nLeg * 18 + 2 + 18) / plotH);
    }
    // Zählwerte (Gebäude): ganzzahlige Schritte statt 2,5 mit gerundeter Beschriftung
    const yStepRoh = ggNiceStep(max / 8);
    const yStep = cfg.yGanzzahl ? ([1, 2, 5, 10, 20, 50, 100, 200, 500].find(x => x >= yStepRoh) || Math.ceil(yStepRoh)) : yStepRoh;
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
 * 3d2) RENDERER — „XY": Punkte und Linien über einer Zahlenachse (auch negative x, z. B. Außentemperatur)
 *
 * cfg.serien = [{ label, farbe, punkte: [{x,y}], art: 'punkte'|'linie', strich?, breite? }]
 * cfg.marken = [{ x, y, label, farbe }] — hervorgehobene Einzelpunkte mit Fahne
 * cfg.xMin/xMax/yMin/yMax optional, sonst aus den Daten; cfg.xDez/yDez Nachkommastellen der Achsen
 * ═══════════════════════════════════════════════════════════════════════ */
let ggXyZaehler = 0;
export function ggRenderXY(cfg, T = GG_THEME) {
  const clipId = `ggxy-clip-${++ggXyZaehler}`;
  const G = ggSheetGeometry(T, cfg);
  const S = G.S, W = G.W, plotX = G.plotX, plotW = G.plotW, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  let out = ggSheetHeader(cfg, T, G);
  out += `<rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;

  const serien = (cfg.serien || []).filter(s => s && s.punkte && s.punkte.some(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const marken = (cfg.marken || []).filter(m => Number.isFinite(m.x) && Number.isFinite(m.y));
  if (!serien.length) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, cfg.leer || 'Keine Daten vorhanden', { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    const alle = [...serien.flatMap(s => s.punkte), ...marken].filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const ext = (k, f) => f(...alle.map(p => p[k]));
    const skala = (lo, hi, n) => {
      const st = ggNiceStep(Math.max(hi - lo, 1e-9) / n);
      return { st, lo: Math.floor(lo / st) * st, hi: Math.max(Math.ceil(hi / st) * st, Math.floor(lo / st) * st + st) };
    };
    const sx = skala(cfg.xMin ?? ext('x', Math.min), cfg.xMax ?? ext('x', Math.max), 10);
    // Kopfraum für die Legende oben rechts
    const nLeg = serien.filter(s => s.label).length + marken.filter(m => m.legende).length;
    const yHiRoh = cfg.yMax ?? ext('y', Math.max) / Math.max(0.5, 1 - (nLeg ? (10 + 8 + nLeg * 18 + 20) / plotH : 0.05));
    const sy = skala(cfg.yMin ?? Math.min(0, ext('y', Math.min)), yHiRoh, 8);
    const xOf = x => plotX + ((x - sx.lo) / (sx.hi - sx.lo)) * plotW;
    const yOf = y => plotB - ((y - sy.lo) / (sy.hi - sy.lo)) * plotH;

    let gitter = '';
    for (let v = sy.lo + sy.st; v < sy.hi - 1e-9; v += sy.st) gitter += `M${gR(plotX)} ${Math.round(yOf(v)) + 0.5}H${gR(plotX + plotW)}`;
    for (let v = sx.lo + sx.st; v < sx.hi - 1e-9; v += sx.st) gitter += `M${Math.round(xOf(v)) + 0.5} ${plotY}V${gR(plotB)}`;
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;
    if (sx.lo < 0 && sx.hi > 0) out += `<line x1="${gR(xOf(0))}" y1="${plotY}" x2="${gR(xOf(0))}" y2="${gR(plotB)}" stroke="${T.rule}" stroke-width="1.2"/>`;

    out += `<clipPath id="${clipId}"><rect x="${gR(plotX)}" y="${plotY}" width="${gR(plotW)}" height="${plotH}"/></clipPath><g clip-path="url(#${clipId})">`;
    for (const s of serien) {
      const p = s.punkte.filter(q => Number.isFinite(q.x) && Number.isFinite(q.y));
      if (s.art === 'punkte') {
        for (const q of p) out += `<circle cx="${gR(xOf(q.x))}" cy="${gR(yOf(q.y))}" r="${s.radius || 2.6}" fill="${s.farbe}" fill-opacity="0.55"/>`;
      } else {
        out += `<path d="${p.map((q, i) => `${i ? 'L' : 'M'}${gR(xOf(q.x))} ${gR(yOf(q.y))}`).join('')}" fill="none" stroke="${s.farbe}"
                  stroke-width="${s.breite || 2}"${s.strich ? ` stroke-dasharray="${s.strich}"` : ''} stroke-linejoin="round"/>`;
      }
    }
    out += '</g>';
    for (const m of marken) {
      const mx = xOf(m.x), my = yOf(m.y), f = m.farbe || T.text.strong;
      out += `<circle cx="${gR(mx)}" cy="${gR(my)}" r="5.5" fill="${T.bg}" stroke="${f}" stroke-width="2.5"/>`;
      if (m.label) {
        const rechts = mx < plotX + plotW * 0.6;
        out += txt(mx + (rechts ? 10 : -10), my - 9, m.label, { anchor: rechts ? 'start' : 'end', size: S.fsLeg, weight: 700, fill: f });
      }
    }
    const dez = st => (st < 1 ? (st < 0.1 ? 2 : 1) : 0);
    for (let v = sy.lo; v <= sy.hi + 1e-9; v += sy.st) out += txt(plotX - 8, yOf(v) + S.fsAxis * 0.36, ggNum(v, cfg.yDez ?? dez(sy.st)), { anchor: 'end', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    for (let v = sx.lo; v <= sx.hi + 1e-9; v += sx.st) out += txt(xOf(v), G.xLabelY, ggNum(v, cfg.xDez ?? dez(sx.st)), { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });

    const eintraege = [...serien.filter(s => s.label).map(s => ({ ...s, text: s.label })), ...marken.filter(m => m.legende).map(m => ({ farbe: m.farbe || T.text.strong, text: m.legende, marke: true }))];
    if (eintraege.length) {
      const lw = 12 + 26 + 9 + Math.max(...eintraege.map(e => ggEstW(e.text, S.fsLeg))) + 14;
      const lh = 8 + eintraege.length * 18 + 2;
      const lx = cfg.legendeLinks ? plotX + 12 : plotX + plotW - 12 - lw, ly = plotY + 10;
      out += `<rect x="${gR(lx)}" y="${ly}" width="${gR(lw)}" height="${gR(lh)}" fill="${T.bg}" fill-opacity="0.92" stroke="${T.line}" stroke-width="1"/>`;
      eintraege.forEach((e, i) => {
        const ey = ly + 8 + i * 18 + 5.5;
        out += e.art === 'punkte' ? `<circle cx="${gR(lx + 25)}" cy="${gR(ey)}" r="3.5" fill="${e.farbe}"/>`
          : e.marke ? `<circle cx="${gR(lx + 25)}" cy="${gR(ey)}" r="4.5" fill="${T.bg}" stroke="${e.farbe}" stroke-width="2"/>`
            : `<line x1="${gR(lx + 12)}" y1="${gR(ey)}" x2="${gR(lx + 38)}" y2="${gR(ey)}" stroke="${e.farbe}" stroke-width="${e.breite || 2}"${e.strich ? ` stroke-dasharray="${e.strich}"` : ''}/>`;
        out += txt(lx + 47, ey + S.fsLeg * 0.36, e.text, { size: S.fsLeg });
      });
    }
  }
  out += `<rect x="${gR(plotX) + 0.5}" y="${plotY}.5" width="${gR(plotW) - 1}" height="${plotH - 1}" fill="none" stroke="${T.rule}" stroke-width="1"/>
          <line x1="${gR(plotX)}" y1="${gR(plotB) - 1}" x2="${gR(plotX + plotW)}" y2="${gR(plotB) - 1}" stroke="${T.text.strong}" stroke-width="2"/>`;
  out += ggAxisTitles(cfg, T, G);
  out += ggSheetKpiFooter(cfg, T, G);
  return ggFinishSvg(out, W, G.height);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3d3) RENDERER — „Gantt": Zeitbalken je Maßnahme über einer Jahresachse
 *
 * cfg.phasen = [{ name, von, bis, farbe }] (ganze Jahre, bis einschließlich)
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggRenderGantt(cfg, T = GG_THEME) {
  const phasen = (cfg.phasen || []).filter(p => Number.isFinite(p.von) && Number.isFinite(p.bis));
  const G = ggSheetGeometry(T, { ...cfg, kennzahlen: false });
  const S = G.S, W = G.W, plotY = G.plotY, plotH = G.plotH, plotB = G.plotB;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  let out = ggSheetHeader(cfg, T, { ...G });
  const labelW = Math.min(360, Math.max(180, ...phasen.map(p => ggEstW(p.name, S.fsAxis + 1) + 24)));
  const x0 = S.padX + labelW, x1 = W - S.padX;
  out += `<rect x="${gR(x0)}" y="${plotY}" width="${gR(x1 - x0)}" height="${plotH}" fill="${T.neutral.cardBg}"/>`;
  if (!phasen.length) {
    out += txt((x0 + x1) / 2, plotY + plotH / 2, cfg.leer || 'Keine Maßnahmen', { anchor: 'middle', size: 13, fill: T.text.faint });
  } else {
    const jMin = Math.min(...phasen.map(p => p.von)), jMax = Math.max(...phasen.map(p => p.bis)) + 1;
    const xOf = j => x0 + ((j - jMin) / (jMax - jMin)) * (x1 - x0);
    const schritt = jMax - jMin > 14 ? 2 : 1;
    let gitter = '';
    for (let j = jMin; j <= jMax; j++) gitter += `M${Math.round(xOf(j)) + 0.5} ${plotY}V${gR(plotB)}`;
    out += `<path d="${gitter}" fill="none" stroke="${T.line}" stroke-width="1"/>`;
    for (let j = jMin; j < jMax; j += schritt) out += txt((xOf(j) + xOf(j + 1)) / 2, G.xLabelY, String(j), { anchor: 'middle', mono: true, size: S.fsAxis, weight: 500, fill: T.text.muted });
    const zeileH = plotH / phasen.length;
    phasen.forEach((p, i) => {
      const yM = plotY + zeileH * (i + 0.5), h = Math.min(30, zeileH * 0.56);
      out += txt(x0 - 12, yM + S.fsAxis * 0.36, p.name, { anchor: 'end', size: S.fsAxis + 1, weight: 600 });
      out += `<rect x="${gR(xOf(p.von) + 2)}" y="${gR(yM - h / 2)}" width="${gR(xOf(p.bis + 1) - xOf(p.von) - 4)}" height="${gR(h)}" fill="${p.farbe || T.energy.waerme}" rx="3"/>`;
      if (i) out += `<line x1="${S.padX}" y1="${gR(plotY + zeileH * i) + 0.5}" x2="${x1}" y2="${gR(plotY + zeileH * i) + 0.5}" stroke="${T.line}" stroke-width="1" stroke-dasharray="2 4"/>`;
    });
  }
  out += `<rect x="${gR(x0) + 0.5}" y="${plotY}.5" width="${gR(x1 - x0) - 1}" height="${plotH - 1}" fill="none" stroke="${T.rule}" stroke-width="1"/>`;
  out += ggAxisTitles({ ...cfg, achseY: '' }, T, G);
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

/** Kapitel 5.1.1 Liegenschaftsstromnetzanschluss (Ist-Zustand) — Textbaustein aus den Netzanschluss-Stammdaten. */
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
    `Die Messung erfolgt als ${ggTextFeld(window.naMessverfahren, 'Messverfahren')}`
      + (ggMesskonzeptWerte().ns ? '' : `, ${ggTextFeld(NA_MESSORTE.find(o => o.wert === window.naMessort)?.text, 'Messort')}`)
      + '. Das Übergabe- und Messkonzept zeigt die folgende Abbildung.',
    `Der Netzbetreiber erteilt grundsätzlich keine Auskunft über die physikalisch maximal mögliche Anschlussleistung `
      + `der Liegenschaft. Eine Bewertung der verfügbaren Netzkapazitäten erfolgt ausschließlich auf Basis eines `
      + `konkreten Netzanschlussantrags. Hierzu ist das vom Netzbetreiber bereitgestellte Antragsformular zur Anmeldung `
      + `des Netzanschlusses (z. B. „Formular E1 – Anmeldung zum Netzanschluss Strom“) mit Angabe der zukünftig `
      + `benötigten Anschlussleistung einzureichen. Erst im Anschluss prüft der Netzbetreiber die technische `
      + `Verfügbarkeit, den erforderlichen Netzausbaubedarf sowie die zeitlichen und wirtschaftlichen Rahmenbedingungen.`,
  ], T);
}

/** Kapitel 5.4.1 Netzanschluss und internes Stromnetz (Variantenbildung) — Empfehlung zum Netzanschlussantrag. */
function ggRenderNetzanschlussEmpfehlungText(cfg, T = GG_THEME) {
  void cfg;
  return ggTextBlatt([
    `Vor dem Hintergrund der erwarteten Laststeigerungen durch Elektromobilität, Wärmepumpen und den Ausbau `
      + `erneuerbarer Erzeugungsanlagen wird empfohlen, den Netzanschlussantrag frühzeitig und auf Basis einer `
      + `realistischen Leistungsannahme einschließlich angemessener Reserve zu stellen, um Planungssicherheit für `
      + `nachgelagerte Maßnahmen zu schaffen.`,
  ], T);
}

/** Kapitel 5.1.2 Stromnetz intern (MS/NS), Ist-Zustand — Einleitung vor der Tabelle „Übersicht Trafostationen". */
function ggRenderTrafostationenText(cfg, T = GG_THEME) {
  void cfg;
  const name = document.querySelector('.header-projekt-name')?.textContent?.trim() || '';
  return ggTextBlatt([
    ...ggNetzStrukturAbsaetze(),
    `Die Tabelle Übersicht der Trafostationen zeigt eine Übersicht aller Trafostationen der Liegenschaft `
      + `${ggTextFeld(name, 'Name Liegenschaft')}. Im weiteren Verlauf werden die im Zuge einer Begehung besichtigten `
      + `Trafostationen näher betrachtet um eventuelle Bedarfe und Empfehlungen zur Anpassung oder Erneuerung von `
      + `Trafo-Stationen ableiten zu können.`,
  ], T);
}

/* ── Wärme-Textbausteine (Kapitel 3.2.5 bis 7.5, 9.1): Logik in lib/gutachten-waerme-texte.js ──
 * Die Lib liefert Absätze aus Text und Platzhaltern; hier kommen nur die Projektdaten hinein und das
 * HTML der Textblätter heraus. */

/** Absätze der Wärme-Lib ({feld, wert}-Platzhalter) als Textblatt. */
function ggWaermeTextBlatt(absaetze, T = GG_THEME) {
  return ggTextBlatt(absaetze.map(a => a.map(s => (typeof s === 'string' ? gEsc(s) : ggTextFeld(s.wert, s.feld))).join('')), T);
}

/** Ein Wert aus window, ohne dass ein Fehler beim Lesen den Baustein stoppt. */
function ggLies(fn, standard) {
  try { const v = fn(); return v === undefined || v === null || Number.isNaN(v) ? standard : v; } catch (e) { void e; return standard; }
}
const ggFeldZahl = id => { const v = parseFloat(document.getElementById(id)?.value); return Number.isFinite(v) ? v : undefined; };

/** Eisspeicher-Daten für den Gutachtentext: Eingaben aus dem Geothermie-Panel und Ergebnis der Einsatzplanung. */
function ggEisDaten() {
  const w = window;
  const aktiv = document.getElementById('geo-quelle')?.value === 'eis' && !!w.geoThermie;
  if (!aktiv) return { aktiv: false };
  const keys = ggLies(() => w.meritOrderKeys, []) || [];
  const istAktiv = k => ggLies(() => w.isErzeugerAktiv(k), false);
  const pos = keys.indexOf('geo');
  const en = ggLies(() => w._dispatchEnergy?.geo, null);
  const gesamt = ggLies(() => Object.values(w._dispatchEnergy || {}).reduce((sum, x) => sum + (x?.waermeMwh || 0), 0), 0);
  return {
    aktiv,
    volumenM3: ggFeldZahl('eis-volumen'),
    absorberM2: ggFeldZahl('eis-absorber'),
    maxVereisungZulPct: ggFeldZahl('eis-vereisung'),
    wpKw: ggFeldZahl('geo-leistung-eff'),
    jaz: en && en.elMwh > 0 ? en.waermeMwh / en.elMwh : undefined,
    waermeMwh: en?.waermeMwh,
    deckungPct: en && gesamt > 0 ? en.waermeMwh / gesamt * 100 : undefined,
    folgeErzeuger: pos >= 0 ? keys.slice(pos + 1).filter(istAktiv) : [],
    stat: w._eisSpeicherErgebnis || null,
  };
}

/** Kurznamen der Variantenübersicht → Erzeugerschlüssel des Dispatch (für ältere Zwischenstände ohne `erzeugerDetail`). */
const GG_TYP_KEY = { LWWP: 'lwwp', Geothermie: 'geo', 'Fließgewässer-WP': 'fg', Gaskessel: 'gaskessel', 'Gaskessel (Auto)': '_autoGk', 'BHKW/KWK': 'bhkw', Stromkessel: 'stromkessel' };

/** Gebäudeauswertung des Projekts: Ist-Bestand (Baujahr vor 2026), Jahresverlauf und Ereignisse (Neubau, Abriss, Sanierung). */
export function ggGebaeudeAuswertung() {
  const w = window;
  if (typeof w.getComputedStats !== 'function') return gbAuswertung([], () => ({}));
  // Vergleichsmaßstab: Vergleichswert Wärme nach der Bekanntmachung vom 15.04.2021 je m² BGF (lib/vergleichswerte-nwg.js);
  // dezentral elektrische oder fehlende Warmwasserbereitung zählt nicht zum Vergleichswert Wärme
  const referenzSpez = g => nwgVergleichswert({
    nutzung: g.nutzung, waermeRef: ggLies(() => w.getNutzungstypById?.(g.nutzung)?.waermeRef, undefined), bgfM2: gbBgf(g),
    twwZentral: !['dle', 'keine'].includes(g.twwArt),
  })?.jeBgf ?? NaN;
  return gbAuswertung(w.gebaeude || [], w.getComputedStats, { ausgeschlossen: id => typeof w.isExcluded === 'function' && w.isExcluded(id), referenzSpez,
    nutzungLabel: n => (typeof w.getNutzungstypById === 'function' && w.getNutzungstypById(n)?.label) || n });
}

/** Bestandsanlage (Ist) mit Heizlast heute und am Ende der baulichen Entwicklung (Summe der Einzelheizlasten). */
function ggBestandsanlage() {
  const w = window;
  const g = ggGebaeudeAuswertung();
  const j = g.jahre;
  return baAuswertung(ggLies(() => w.getBestandsanlage?.(), {}) || {}, {
    heizlastIstKw: j[0]?.heizlastKw, heizlastSollKw: j.length > 1 ? j[j.length - 1].heizlastKw : undefined,
  });
}
/** Mehrjahres-Verbrauchsdaten der Bestandsanlage mit den Emissionsfaktoren des Projekts (Standard GEG Anlage 9). */
function ggVerbrauch() {
  const w = window;
  const f = {};
  const set = (k, v) => { const x = Number(ggLies(v)); if (Number.isFinite(x)) f[k] = x; };
  set('Erdgas', () => w.gasEmF); set('Heizöl', () => w.heizoelEmF); set('Holzpellets', () => w.pelletsEmF); set('Fernwärme', () => w.fernwaermeEmF);
  return baVerbrauchAuswertung(ggLies(() => w.getBestandsanlage?.(), {}) || {}, f);
}
/** Eingaben der Potenzialanalyse aus Geothermie-, Luft-WP- und Wirtschaftlichkeitspanel sowie Lastgang. */
function ggPotenzialDaten() {
  const w = window, ss = w.systemState;
  const en = ggLies(() => w._dispatchEnergy, {}) || {};
  const gesamtDispatch = Object.values(en).reduce((x, e) => x + (e?.waermeMwh || 0), 0);
  const anteil = k => (en[k]?.waermeMwh > 0 && gesamtDispatch > 0 ? (en[k].waermeMwh / gesamtDispatch) * 100 : NaN);
  const jaz = k => (en[k]?.elMwh > 0 ? en[k].waermeMwh / en[k].elMwh : NaN);
  const lwKw = ggLies(() => w.lwWp?.leistungKw, NaN);
  return {
    jdlKw: ss?.jahresdauerlinie, gesamtMwh: ss?.gesamtMwhMitNV, pMaxKw: ss?.pMaxKw,
    geo: {
      lambda: ggFeldZahl('geo-lambda'), qPerM: ggFeldZahl('geo-q-perm'), tiefe: ggFeldZahl('geo-tiefe'), abstand: ggFeldZahl('geo-abstand'),
      jaz: Number.isFinite(jaz('geo')) ? jaz('geo') : ggFeldZahl('geo-jaz'), deckungPct: anteil('geo'),
    },
    lwwp: {
      wpKw: lwKw, jaz: jaz('lwwp'), deckungPct: anteil('lwwp'), waermeMwh: en.lwwp?.waermeMwh, stromMwh: en.lwwp?.elMwh, lwaDb: ggFeldZahl('lwwp-lwa'),
      platzM2: Number.isFinite(lwKw) && typeof w.lwWpPlatzbedarfM2 === 'function' ? w.lwWpPlatzbedarfM2(lwKw) : NaN,
      vl15: ggFeldZahl('gl-vl15'), vlMinus5: ggFeldZahl('gl-vl5'), lastgangJahr: ggLies(() => w.getWitterung?.()?.messjahr, ''),
    },
    preis: { pellets: ggFeldZahl('wirt-p-pk'), hhs: ggFeldZahl('wirt-p-hhs') },
    bestandPelletKw: ggLies(() => ggBestandsanlage().zeilen.filter(z => z.typ === 'pelletkessel').reduce((x, z) => x + (z.thermKw || 0), 0), 0),
  };
}
/** Gemeinsame Eingaben der Variantenbausteine: Varianten, Preise, Emissionsfaktoren. */
function ggVariantenDaten() {
  const w = window;
  const d = ggWaermeDaten();
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : NaN);
  const stromWp = ggFeldZahl('wirt-p-strom-wp');
  // Wirkungsgrade aus den Erzeuger-Panels (in %, BHKW: Gesamtwirkungsgrad → thermisch über die Stromkennzahl)
  const eta = {};
  const pc = (k, id) => { const v = ggFeldZahl(id); if (Number.isFinite(v) && v > 0) eta[k] = v / 100; };
  pc('gaskessel', 'gk-eta'); pc('_autoGk', 'gk-eta'); pc('heizoel', 'hko-eta'); pc('pellets', 'pk-eta'); pc('hhs', 'hhs-eta'); pc('stromkessel', 'sk-eta');
  const bEta = ggFeldZahl('bhkw-eta'), bSkz = ggFeldZahl('bhkw-skz');
  if (Number.isFinite(bEta) && bEta > 0) eta.bhkwTh = bEta / 100 / (1 + (Number.isFinite(bSkz) ? bSkz : 0.45));
  return {
    varianten: d.varianten.map(v => ({ ...v, eta })), eta, pMaxKw: d.lastgang.pMaxKw, gesamtMwh: d.lastgang.gesamtMwh,
    preise: { strom: Number.isFinite(stromWp) ? stromWp : ggFeldZahl('wirt-p-strom'), gas: ggFeldZahl('wirt-p-gas'), oel: ggFeldZahl('wirt-p-hko'), pellets: ggFeldZahl('wirt-p-pk'), hhs: ggFeldZahl('wirt-p-hhs') },
    ef: { gas: num(ggLies(() => w.gasEmF)), oel: num(ggLies(() => w.heizoelEmF)), pellets: num(ggLies(() => w.pelletsEmF)), strom: num(ggLies(() => w.stromEmF)), stromLz: num(ggLies(() => w.stromEmFLZ)) },
    co2PreisEurT: ggFeldZahl('wirt-p-co2'), co2Quelle: VA_CO2_QUELLE,
    bestandCo2T: ggLies(() => ggVerbrauch().co2MittelT, NaN),
  };
}
/** Bestandsgebäude für die Kostenschätzung der NT-Ertüchtigung (BGF, Bauzustand, TWW). */
function ggNtKosten() {
  const w = window;
  const geb = (w.gebaeude || []).filter(g => !(typeof w.isExcluded === 'function' && w.isExcluded(g.id)) && !(parseInt(g.baujahr, 10) >= 2026)
    && !(parseInt(g.abrissjahr, 10) > 0 && parseInt(g.abrissjahr, 10) < 9999));
  return faNtKosten(geb.map(g => ({ name: g.name || `Gebäude ${g.id}`, bgfM2: gbBgf(g), zustand: ({ A: 1, B: 2, C: 3 })[String(g.zustand || '').toUpperCase()] || Number(g.zustand) || '', twwArt: g.twwArt, twwKw: g.twwKw })));
}
function ggTwwBestand() {
  const w = window;
  return baTwwAuswertung((w.gebaeude || []).filter(g => !(typeof w.isExcluded === 'function' && w.isExcluded(g.id)) && !(parseInt(g.baujahr, 10) >= 2026)));
}

/** Wärmelastgang für Abbildungen: Import bevorzugt, sonst berechneter Basis-Lastgang. */
function ggLastgangWaerme() {
  const gl = ggLies(() => window.captureWaermeGrundlagen?.(), null);
  if (gl?.lastgangKw?.length >= 8760) return { daten: gl.lastgangKw, quelle: 'Import' };
  const b = window._basisLastgangKw || window.systemState?.lastgangKw;
  return b?.length >= 8760 ? { daten: b, quelle: 'berechnet' } : { daten: null, quelle: '' };
}
/** Verbrauchsaufteilung auf die Gebäude — nur mit Messung (importierter Lastgang oder Verbrauchsdaten der Bestandsanlage). */
function ggVerbrauchsaufteilung() {
  const w = window;
  const herkunft = ggLies(() => ggWaermeHerkunft().lastgang, '');
  const ba = ggLies(() => w.getBestandsanlage?.(), {}) || {};
  const vb = ggLies(() => ggVerbrauch(), null);
  let messungMwh = NaN, quelle = '', messpunkt = ba.messpunkt || 'einspeisung';
  if (String(herkunft).startsWith('import')) {
    const lg = ggLastgangWaerme();
    messungMwh = lg.daten ? Array.prototype.reduce.call(lg.daten, (a, b) => a + (b || 0), 0) / 1000 : NaN;
    quelle = `Lastgang ${ggLies(() => w.getWitterung?.()?.messjahr, '') || ''}`.trim();
    if (messpunkt === 'brennstoff') messpunkt = 'einspeisung'; // ein Wärmelastgang ist immer Nutzwärme ab Erzeugung
  } else if (vb?.referenzJahr) {
    const j = vb.jahre?.find(x => x.jahr === vb.referenzJahr);
    messungMwh = Number(j?.summe);
    quelle = `Verbrauchsdaten ${vb.referenzJahr}`;
  }
  if (!(messungMwh > 0)) return null;
  const a = ggGebaeudeAuswertung();
  const r = baVerbrauchsaufteilung({
    messungMwh, messpunkt, kesselEtaPct: ba.kesselEtaPct, netzverlustMwh: w.systemState?.netzverlustMwh,
    gebaeude: a.ist.zeilen.map(z => ({ name: z.name, modellMwh: z.bedarfMwh, bgfM2: z.flaecheM2, referenzSpez: z.referenzSpez })),
  });
  return r ? { ...r, quelle } : null;
}
/** Eingaben der Luft-WP-Stundensimulation aus Systemzustand und Panel. */
function ggLwwpEingaben() {
  const ss = window.systemState || {};
  return { lastgangKw: ss.lastgangKw, tempH: ss.tempH, vlH: ss.vlH, guete: ggFeldZahl('lwwp-guetegrad') || 0.42, minCop: ggFeldZahl('lwwp-min-cop') || 0 };
}
let ggSweepCache = null;
function ggLwwpSweep() {
  const e = ggLwwpEingaben();
  if (!e.lastgangKw || !e.tempH) return [];
  const key = [e.lastgangKw, e.tempH, e.vlH, e.guete, e.minCop];
  if (ggSweepCache && ggSweepCache.key.every((x, i) => x === key[i])) return ggSweepCache.r;
  const r = abLwwpSweep(e);
  ggSweepCache = { key, r };
  return r;
}
/** HT/NT-Gegenüberstellung wie im Text fazit-nt-text, oder null. */
function ggNtVergleich() {
  const w = window, d = ggVariantenDaten();
  const en = ggLies(() => w._dispatchEnergy, {}) || {};
  const wp = ['lwwp', 'geo', 'fg'].reduce((a, k) => ({ w: a.w + (en[k]?.waermeMwh || 0), e: a.e + (en[k]?.elMwh || 0) }), { w: 0, e: 0 });
  const vl15 = ggFeldZahl('gl-vl15'), vl5 = ggFeldZahl('gl-vl5'), vlHt = ggFeldZahl('netz-vl');
  const vlNt = Number.isFinite(vl15) && Number.isFinite(vl5) ? (vl15 + vl5) / 2 : NaN;
  if (!(wp.w > 0) || !Number.isFinite(vlHt) || !Number.isFinite(vlNt) || !(d.preise.strom > 0)) return null;
  return faNtVergleich({ waermeMwh: wp.w, jazNt: wp.e > 0 ? wp.w / wp.e : undefined, vlHtC: vlHt, vlNtC: vlNt, strompreisCt: d.preise.strom, kosten: ggNtKosten(), efStrom: d.ef.strom, efStromLz: d.ef.stromLz });
}

/** Bauliche Entwicklung im Format der Wärme-Textbausteine (aus ggGebaeudeAuswertung). */
function ggBauProjekt() {
  const a = ggGebaeudeAuswertung();
  return {
    basisJahr: a.stichjahr, lastgangJahr: window.globalYear, anzahl: a.anzahl,
    bedarfsverlauf: a.jahre.map(j => ({ jahr: j.jahr, bedarfMwh: j.bedarfMwh, heizlastKw: j.heizlastKw })),
    ereignisse: a.ereignisseJahr.map(e => ({ jahr: e.jahr, art: e.art, anzahl: e.anzahl, deltaMwh: e.deltaMwh })),
  };
}

/** Herkunft des Wärmelastgangs und der Gebäudewerte — Messung oder Synthese, Klima, gesetzte oder geschätzte Werte. */
function ggWaermeHerkunft() {
  const w = window;
  const ss = w.systemState;
  const gl = ggLies(() => w.captureWaermeGrundlagen?.(), null);
  const hatLastgang = !!gl?.lastgangKw?.length;
  const hatMonat = (gl?.monatswerte || []).some(v => String(v ?? '').trim() !== '');
  const gesamt = parseFloat(gl?.gesamtMwh);
  const art = !ss ? null
    : hatLastgang ? (hatMonat ? 'importMonate' : 'import')
      : ss.nurGebaeude ? 'gebaeude'
        : hatMonat ? (gesamt > 0 ? 'monateGesamt' : 'monate')
          : gesamt > 0 ? 'gesamt' : 'gebaeude';
  const meta = gl?.timeSeriesMeta;
  const geb = (w.gebaeude || []).filter(g => !(typeof w.isExcluded === 'function' && w.isExcluded(g.id)));
  const gesetzt = geb.filter(g => g.waermeManual || g.heizlastManual).length;
  return {
    lastgang: art,
    zeitreihe: meta ? { intervallMin: meta.intervalMinutes, qualitaet: meta.quality } : undefined,
    stadt: gl?.stadt || undefined, klimajahr: gl?.klimajahr || undefined, plz: gl?.plz || undefined,
    normAtC: parseFloat(gl?.normAussentemp), gesamtMwh: gesamt, profil1: gl?.profil1 || undefined, profil2: gl?.profil2 || undefined,
    gebaeude: { gesamt: geb.length, gesetzt, geschaetzt: geb.length - gesetzt },
    netzverlustQuelle: ss?.netzverlustQuelle, netzverlustPct: parseFloat(gl?.netzverlustPct),
    witterung: w._wbInfo || null,
  };
}

/** Projektstand für die Wärme-Textbausteine: Lastgang, Bestand/Neubau, Herkunft, Netz, Wirtschaftlichkeit und die Varianten samt Erzeugern. */
export function ggWaermeDaten() {
  const w = window;
  const ss = w.systemState;
  const en = w._dispatchEnergy || {};
  const aktivKey = w.activeVariantId || 'base';
  const vr = ggLies(() => (typeof w.getVariantResults === 'function' ? w.getVariantResults() : w.variantResults), {}) || {};

  const lastgang = ss ? {
    pMaxKw: ss.pMaxKw, nutzMwh: ss.nutzwaermeMwh, gesamtMwh: ss.gesamtMwhMitNV,
    netzverlustPct: ss.netzverlustPct, netzverlustMwh: ss.netzverlustMwh, tMinC: ss.tMin, jdlKw: ss.jahresdauerlinie,
  } : {};

  // Erzeuger der aktiven Variante direkt aus dem Dispatch; die übrigen Varianten kommen aus ihrem Zwischenstand
  const autoGk = (vr[aktivKey]?.erzeuger || []).find(e => e.typ === 'Gaskessel (Auto)');
  const leistung = {
    lwwp: ggLies(() => w.lwWp?.leistungKw), geo: ggFeldZahl('geo-heizlast'), fg: ggLies(() => w.fliessgewaesser?.leistungKw),
    gaskessel: ggLies(() => w.gasKessel?.leistungKw), _autoGk: autoGk?.leistungKw, heizoel: ggLies(() => w.heizoelKessel?.leistungKw),
    bhkw: ggLies(() => w.bhkw?.leistungThKw), pellets: ggLies(() => w.pelletsKessel?.leistungKw), hhs: ggLies(() => w.heizhackschnitzel?.leistungKw),
    stromkessel: ggLies(() => w.stromkessel?.leistungKw), fernwaerme: ggLies(() => w.fernwaerme?.leistungKw),
  };
  const erzeugerAktiv = Object.keys(en).map(key => ({
    key, leistungKw: leistung[key] || 0, waermeMwh: en[key]?.waermeMwh || 0, elMwh: en[key]?.elMwh || 0,
    speicherM3: key === '_thermSpeicher' ? ggFeldZahl('ts-volumen') : undefined,
  }));

  // Netz: Länge, angeschlossene Gebäude, Hydraulik
  const kanten = ggLies(() => (w.netzEdges || []).filter(e => !e.pruned), []);
  const verbunden = new Set(kanten.flatMap(e => [e.u, e.v]));
  const angeschlossen = ggLies(() => (w.gebaeude || []).filter(g => verbunden.has(g.id) && !(typeof w.isExcluded === 'function' && w.isExcluded(g.id))), []);
  const mitDruck = kanten.filter(e => Number.isFinite(e.dpPerM) && Number.isFinite(e.dpLimit));
  const netz = {
    laengeM: kanten.length ? kanten.reduce((s, e) => s + (e.length || 0), 0) : undefined,
    anzahlAnschluesse: angeschlossen.length || undefined,
    vlC: ggFeldZahl('netz-vl'), rlC: ggFeldZahl('netz-rl'),
    bestand: kanten.length ? !!w.networkLocked : undefined,
    ueberschreitungen: mitDruck.length ? mitDruck.filter(e => e.dpPerM > e.dpLimit * 1.0001).length : undefined,
  };
  const gebaeude = {
    anzahl: angeschlossen.length || undefined,
    heizlastSummeKw: angeschlossen.reduce((s, g) => s + (parseFloat(g.heizlast) || 0), 0) || undefined,
  };

  const wirtschaft = {
    zinsPct: ggFeldZahl('wirt-zins'), co2PreisEurT: ggFeldZahl('wirt-p-co2'), strompreisCt: ggFeldZahl('wirt-p-strom'),
    gaspreisCt: ggFeldZahl('wirt-p-gas'), fernwaermeCt: ggFeldZahl('wirt-p-fw'),
  };

  const varianten = Object.entries(vr).filter(([, r]) => r && Array.isArray(r.erzeuger) && (r.erzeugerDetail?.length || r.erzeuger.length)).map(([id, r]) => {
    const aktiv = id === aktivKey;
    const detail = aktiv && erzeugerAktiv.length ? erzeugerAktiv
      : r.erzeugerDetail?.length ? r.erzeugerDetail
        : r.erzeuger.map(e => ({ key: GG_TYP_KEY[e.typ], name: GG_TYP_KEY[e.typ] ? undefined : e.typ, leistungKw: e.leistungKw, waermeMwh: e.waermeMwh }));
    return {
      name: id === 'base' ? 'Basisvariante' : (r.label || id), aktiv, erzeuger: detail,
      investEur: r.investGes || undefined, jahreskostenEur: r.jkGes || undefined, wgkCt: r.wgkNum || undefined,
      co2T: r.co2GesH, co2LzT: r.co2GesLZ, eeAnteilPct: r.eeAnteil ?? undefined, netzverlustPct: r.netzverlustePct, wirtKomp: r.wirtKomp || null,
    };
  });

  return { lastgang, projekt: ggBauProjekt(), herkunft: ggWaermeHerkunft(), netz, gebaeude, wirtschaft, varianten };
}

/* ── Hochbau (Kapitel 2): Gebäudebestand, bauliche Veränderungen, Entwicklung von Bedarf und Heizlast ──
 * Zahlen und Texte kommen aus lib/gutachten-gebaeude.js; hier entstehen nur die Blätter und Tabellen. */
const GG_SEG_FARBEN = { unsaniert: '#FF0000', saniert: '#F7A8A8', neubau: '#3F9C3F' };
const GG_ART_FARBEN = { neubau: '#3F9C3F', abriss: '#8A8F8A', sanierung: '#E0A126' };
const GG_ART_NAMEN = { neubau: 'Neubau', abriss: 'Abriss', sanierung: 'Sanierung' };

function ggGebKopf(cfg) {
  cfg.ort = cfg.ort || ggLiegenschaft();
  cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
  ggMetaDefaults(cfg, 'pdBearbeiterWaerme');
}
const ggGebLeer = cfg => { cfg.kategorien = []; cfg.gruppen = []; cfg.punkte = null; cfg.kpiLinks = []; cfg.kpiRechts = []; };

/** Punktreihe ausdünnen: Anfang, Ende, Maximum und etwa gleichmäßig verteilt höchstens `max` Werte, der Rest 0 (wird nicht gezeichnet). */
function ggDuenne(werte, max = 9) {
  const n = werte.length;
  if (n <= max) return werte.slice();
  const schritt = Math.ceil((n - 1) / (max - 1));
  const behalten = new Set([0, n - 1, werte.indexOf(Math.max(...werte))]);
  for (let i = 0; i < n; i += schritt) behalten.add(i);
  return werte.map((v, i) => (behalten.has(i) ? v : 0));
}

const ggGebVorlage = (titel, achseY, achseX, leer, yGanzzahl = false) => ({
  eyebrow: 'Hochbau', titel, ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
  achseY, achseX, leer, yGanzzahl, kategorien: [], gruppen: [], punkte: null, summenLabel: true, kpiLinks: [], kpiRechts: [],
});

/** Gestapelte Säulen je Jahr (Bestand unsaniert, saniert, Neubau) mit einer Punktreihe auf eigener Skala. */
function ggGebJahresSaeulen(cfg, wert, punkt, einheitPunkt, dezPunkt = 0, faktor = 1) {
  const a = ggGebaeudeAuswertung();
  ggGebKopf(cfg);
  if (a.jahre.length < 2) { ggGebLeer(cfg); return '⚠ Keine baulichen Veränderungen hinterlegt — keine Entwicklung darzustellen.'; }
  cfg.kategorien = a.jahre.map(j => String(j.jahr));
  const seg = (key, label) => ({ label, farbe: GG_SEG_FARBEN[key], werte: a.jahre.map(j => wert(j.segmente[key]) / faktor) });
  const segmente = [seg('unsaniert', 'Bestand unsaniert'), seg('saniert', 'Bestand saniert'), seg('neubau', 'Neubau')].filter(x => x.werte.some(v => v > 0));
  cfg.gruppen = [{ label: '', segmente }];
  cfg.punkte = { label: punkt.label, einheit: einheitPunkt, dez: dezPunkt, farbe: GG_THEME.text.strong, werte: ggDuenne(a.jahre.map(j => (Number.isFinite(punkt.wert(j)) ? punkt.wert(j) : 0))) };
  cfg.summenLabel = a.jahre.length <= 12;
  return `✓ ${a.jahre.length} Jahre (${a.jahre[0].jahr} bis ${a.jahre.at(-1).jahr}) aus den Gebäudedaten berechnet.`;
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

/* ── Kapitel 5.2 Stromverbrauchsdaten: Messjahre aus ⚡ Strom-Grundlagen (23-messjahre-panel.js) ──
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

/** Kapitel 5.2 — Datengrundlage, Verbrauchstrend, Spitzen- und Grundlast, Referenzjahr. */
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
    ? `Für die Bedarfsprognose (Kapitel 5.3) wird das Jahr ${ref.jahr} mit einer Spitzenlast von ${ggNum(ref.spitzeKw)} kW als `
      + 'Referenzjahr zugrunde gelegt'
      + (eins ? '.' : ref === max ? ', da in diesem Jahr die höchste Spitzenlast auftrat.'
        : `, da ${ggTextFeld('', 'Begründung, z. B. jüngstes vollständiges Betriebsjahr')}.`)
    : `Für die Bedarfsprognose (Kapitel 5.3) wird das Jahr ${ggTextFeld('', 'Referenzjahr')} als Referenzjahr zugrunde gelegt.`);

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
    kapitel: '4 Potenzialanalyse',   // wie „Abbildung 6" der Word-Vorlage
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '3.1 Ist-Anlagentechnik',
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

  // ── Gutachtentexte Wärme (Logik und Fallunterscheidungen: lib/gutachten-waerme-texte.js) ──
  // ── Einleitung (1.1, 1.2) und Einstieg Ist-Zustand (Logik: lib/gutachten-einleitung.js) ──
  {
    id: 'einleitung-ziele-text', istText: true, reihe: -10, kapitel: '1.1 Ziele und Grundsätze',
    titel: 'Gutachtentext: Ziele und Grundsätze', datei: 'einleitung-ziele-text',
    hinweis: 'Standardtext mit Liegenschaft und Ort aus Deckblatt bzw. Projektdaten. Die Vorgaben des Auftraggebers (Erlasse) kommen aus der lokalen Vorlage im Dokument-Panel; „Andere Formulierung“ wechselt die Wortwahl.',
    render: () => ggWaermeTextBlatt(geTextZiele(ggLies(() => window.gutStandardtextDaten?.(), {}) || {})), config: {},
  },
  {
    id: 'einleitung-liegenschaft-text', istText: true, reihe: -10, kapitel: '1.2 Liegenschaftsinformationen',
    titel: 'Gutachtentext: Liegenschaftsinformationen (Platzhalter)', datei: 'einleitung-liegenschaft-text',
    hinweis: 'Kein Standardtext — die Angaben sind zu liegenschaftsspezifisch. Der gelbe Hinweis erinnert daran, das Kapitel selbst zu schreiben.',
    render: () => ggWaermeTextBlatt(geTextLiegenschaft()), config: {},
  },
  {
    id: 'ist-einstieg-text', istText: true, reihe: -20, kapitel: '2 Ist-Zustand Wärme',
    titel: 'Gutachtentext: Einstieg Ist-Zustand', datei: 'ist-einstieg-text',
    hinweis: 'Kurzer Einstieg: erst baulicher und anlagentechnischer Zustand, dann Energiebedarf aus Lastgang und Verbrauchsdaten.',
    render: () => ggWaermeTextBlatt(geTextIstEinstieg({
      ...(ggLies(() => window.gutStandardtextDaten?.(), {}) || {}),
      lastgang: String(ggLies(() => ggWaermeHerkunft().lastgang, '')).startsWith('import'),
    })), config: {},
  },
  // ── Hochbau (1.3): Gebäudebestand, bauliche Veränderungen, Entwicklung (Logik: lib/gutachten-gebaeude.js) ──
  {
    id: 'gebaeude-bestand-text', istText: true, reihe: -10, kapitel: '2.1 Baulicher Ist-Zustand',
    titel: 'Gutachtentext: Gebäudebestand', datei: 'gebaeude-bestand-text',
    hinweis: 'Überblick über den Ist-Bestand (Baujahr vor 2026): Anzahl, Bruttogeschossfläche, Nutzung, Baualter, spezifischer Bedarf, Vergleich mit dem Neubauniveau, Bauzustand und Sanierungsbedarf, auffällige Nutzungsarten, Großverbraucher, geplanter Abriss, Herkunft der Gebäudewerte und Datenlücken.',
    render: () => ggWaermeTextBlatt(gbTextBestand(ggGebaeudeAuswertung())), config: {},
  },
  {
    id: 'gebaeude-baualter', autoSync: true, reihe: 10, kapitel: '2.1 Baulicher Ist-Zustand',
    titel: 'Gebäude nach Baualtersklasse', datei: 'gebaeude-baualter',
    hinweis: 'Anzahl der Bestandsgebäude je Baualtersklasse (Wärmeschutz-Meilensteine) mit dem Wärmebedarf der Klasse als Punktreihe.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Gebäude nach Baualtersklasse', 'Anzahl Gebäude', 'Baujahr', 'Kein Gebäudebestand vorhanden — Gebäude mit Baujahr vor 2026 anlegen oder importieren.', true),
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      ggGebKopf(cfg);
      const i = a.ist;
      if (!i.anzahl) { ggGebLeer(cfg); return '⚠ Kein Gebäudebestand (Baujahr vor 2026).'; }
      const k = i.baualter.filter(x => x.anzahl > 0 || x.label !== 'ohne Angabe');
      cfg.kategorien = k.map(x => x.label);
      cfg.gruppen = [{ label: '', segmente: [{ label: 'Anzahl Gebäude', farbe: GG_SEG_FARBEN.unsaniert, werte: k.map(x => x.anzahl) }] }];
      cfg.punkte = { label: 'Wärmebedarf', einheit: 'MWh/a', farbe: GG_THEME.text.strong, werte: k.map(x => x.bedarfMwh) };
      cfg.summenLabel = true;
      cfg.kpiLinks = [{ wert: ggNum(i.anzahl) + ' Gebäude', label: 'Gebäudebestand' }, { wert: ggNum(i.bedarfMwh) + ' MWh/a', label: 'Wärmebedarf Bestand' }];
      cfg.kpiRechts = [{ wert: Number.isFinite(i.baujahrMittel) ? ggNum(i.baujahrMittel) : '—', label: 'mittleres Baujahr' },
                       { wert: ggNum(i.anteilVor1979Pct) + ' %', label: 'Gebäude vor 1979', highlight: true }];
      return `✓ ${ggNum(i.anzahl)} Bestandsgebäude in ${k.length} Baualtersklassen.`;
    },
  },
  {
    id: 'gebaeude-nutzung', autoSync: true, reihe: 20, kapitel: '2.1 Baulicher Ist-Zustand',
    titel: 'Wärmebedarf nach Nutzung', datei: 'gebaeude-nutzung',
    hinweis: 'Wärmebedarf des Bestands je Nutzungsart mit dem spezifischen Bedarf (flächengewichtet) als Punktreihe. Mehr als sieben Nutzungen werden zu „weitere“ zusammengefasst.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Wärmebedarf nach Nutzung', 'Wärmebedarf in MWh/a', 'Nutzung', 'Kein Gebäudebestand vorhanden.'),
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      ggGebKopf(cfg);
      const i = a.ist;
      if (!i.anzahl) { ggGebLeer(cfg); return '⚠ Kein Gebäudebestand (Baujahr vor 2026).'; }
      let n = i.nutzung;
      if (n.length > 7) {
        const rest = n.slice(6);
        n = [...n.slice(0, 6), { label: 'weitere', anzahl: rest.reduce((x, y) => x + y.anzahl, 0), flaecheM2: rest.reduce((x, y) => x + y.flaecheM2, 0), bedarfMwh: rest.reduce((x, y) => x + y.bedarfMwh, 0) }];
      }
      cfg.kategorien = n.map(x => x.label);
      cfg.gruppen = [{ label: '', segmente: [{ label: 'Wärmebedarf', farbe: GG_SEG_FARBEN.unsaniert, werte: n.map(x => x.bedarfMwh) }] }];
      cfg.punkte = { label: 'spezifischer Bedarf', einheit: 'kWh/m²', farbe: GG_THEME.text.strong, werte: n.map(x => (x.flaecheM2 > 0 ? (x.bedarfMwh * 1000) / x.flaecheM2 : 0)) };
      cfg.summenLabel = true;
      cfg.kpiLinks = [{ wert: ggNum(i.bedarfMwh) + ' MWh/a', label: 'Wärmebedarf Bestand' }, { wert: ggNum(i.flaecheM2) + ' m²', label: 'Fläche Bestand' }];
      cfg.kpiRechts = [{ wert: Number.isFinite(i.spezKwhM2) ? ggNum(i.spezKwhM2) + ' kWh/m²' : '—', label: 'spez. Wärmebedarf Ø', highlight: true }];
      return `✓ ${n.length} Nutzungsarten ausgewertet.`;
    },
  },
  {
    id: 'gebaeude-spezifisch', autoSync: true, reihe: 30, kapitel: '2.1 Baulicher Ist-Zustand',
    titel: 'Verteilung des spezifischen Wärmebedarfs', datei: 'gebaeude-spezifisch',
    hinweis: 'Anzahl der Bestandsgebäude je Klasse des spezifischen Wärmebedarfs in kWh/(m²·a) mit dem Wärmebedarf der Klasse als Punktreihe. Gebäude ohne Flächenangabe sind nicht enthalten.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Verteilung des spezifischen Wärmebedarfs', 'Anzahl Gebäude', 'spezifischer Wärmebedarf in kWh/(m²·a)', 'Keine Gebäude mit Fläche und Wärmebedarf vorhanden.', true),
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      ggGebKopf(cfg);
      const k = a.ist.spezKlassen;
      if (!k.some(x => x.anzahl > 0)) { ggGebLeer(cfg); return '⚠ Keine Gebäude mit Fläche und Wärmebedarf.'; }
      cfg.kategorien = k.map(x => x.label);
      cfg.gruppen = [{ label: '', segmente: [{ label: 'Anzahl Gebäude', farbe: GG_SEG_FARBEN.unsaniert, werte: k.map(x => x.anzahl) }] }];
      cfg.punkte = { label: 'Wärmebedarf', einheit: 'MWh/a', farbe: GG_THEME.text.strong, werte: k.map(x => x.bedarfMwh) };
      cfg.summenLabel = true;
      const gesamt = k.reduce((x, y) => x + y.anzahl, 0);
      const haupt = [...k].sort((x, y) => y.anzahl - x.anzahl)[0];
      cfg.kpiLinks = [{ wert: ggNum(gesamt) + ' Gebäude', label: 'mit Fläche und Bedarf' }];
      cfg.kpiRechts = [{ wert: haupt.label + ' kWh/m²', label: 'häufigste Klasse', prozent: ggNum((haupt.anzahl / gesamt) * 100) + ' %', highlight: true }];
      return `✓ ${ggNum(gesamt)} Gebäude in ${k.filter(x => x.anzahl).length} Klassen.`;
    },
  },
  {
    id: 'gebaeude-uebersicht', autoSync: true, reihe: 40, kapitel: '2.1 Baulicher Ist-Zustand',
    titel: 'Übersicht Gebäudebestand', datei: 'gebaeude-uebersicht',
    hinweis: 'Die 25 Bestandsgebäude mit dem höchsten Wärmebedarf samt Summe über alle Gebäude. Spezifischer Bedarf = Bedarf ÷ Fläche.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Hochbau', titel: 'Übersicht Gebäudebestand', leer: 'Kein Gebäudebestand vorhanden.',
      spalten: [{ label: 'Gebäude', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      cfg.spalten = [
        { label: 'Gebäude', weight: 2.3, align: 'left', mono: false }, { label: 'Nutzung', weight: 1.2, align: 'left', mono: false },
        { label: 'Baujahr', weight: 0.8 }, { label: 'Zustand', weight: 0.8 }, { label: 'BGF', weight: 1 }, { label: 'Bedarf', weight: 1.1 }, { label: 'spez.', weight: 1.2 }, { label: 'Heizlast', weight: 1 },
      ];
      const i = a.ist;
      if (!i.anzahl) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Kein Gebäudebestand (Baujahr vor 2026).'; }
      const Z = 25;
      const zust = v => (Number.isFinite(v) ? ggNum(v) : '—');
      const z = i.zeilen.slice(0, Z).map(g => ({ werte: [g.abrissjahr ? `${g.name} (Abriss ${g.abrissjahr})` : g.name, g.nutzung, g.baujahr ?? '—', zust(g.zustand), g.flaecheM2 > 0 ? ggNum(g.flaecheM2) + ' m²' : '—', ggNum(g.bedarfMwh) + ' MWh', Number.isFinite(g.spezKwhM2) ? ggNum(g.spezKwhM2) + ' kWh/m²' : '—', ggNum(g.heizlastKw) + ' kW'] }));
      const rest = i.zeilen.slice(Z);
      if (rest.length) z.push({ werte: [`weitere ${ggNum(rest.length)} Gebäude`, '', '', '', ggNum(rest.reduce((x, g) => x + g.flaecheM2, 0)) + ' m²', ggNum(rest.reduce((x, g) => x + g.bedarfMwh, 0)) + ' MWh', '', ggNum(rest.reduce((x, g) => x + g.heizlastKw, 0)) + ' kW'] });
      z.push({ highlight: true, werte: [`Summe ${ggNum(i.anzahl)} Gebäude`, '', '', Number.isFinite(i.zustandMittel) ? `Ø ${ggNum(i.zustandMittel, 1)}` : '', ggNum(i.flaecheM2) + ' m²', ggNum(i.bedarfMwh) + ' MWh', Number.isFinite(i.spezKwhM2) ? ggNum(i.spezKwhM2) + ' kWh/m²' : '—', ggNum(i.heizlastKw) + ' kW'] });
      cfg.zeilen = z;
      cfg.fussnote = `Werte für ${a.istJahr} · sortiert nach Wärmebedarf · BGF = Grundfläche × Geschosse · spez. = Bedarf ÷ BGF · Zustand 1 = gut bis 3 = schlecht (Ø flächengewichtet) · Heizlast: Summe der Einzelheizlasten`;
      return `✓ ${Math.min(Z, i.anzahl)} von ${ggNum(i.anzahl)} Gebäuden aufgeführt.`;
    },
  },
  {
    id: 'gebaeude-veraenderung-text', istText: true, reihe: -10, kapitel: '2.2.1 Bauliche Veränderungen',
    titel: 'Gutachtentext: Bauliche Veränderungen', datei: 'gebaeude-veraenderung-text',
    hinweis: 'Neubau, Abriss und energetische Sanierung ab 2026: Zahl, Zeitraum, Bedarfs- und Heizlastwirkung, Vergleich der Neubauten mit dem Bestand, Sanierungsquote im Vergleich zum üblichen Niveau und Bilanz.',
    render: () => ggWaermeTextBlatt(gbTextVeraenderung(ggGebaeudeAuswertung())), config: {},
  },
  {
    id: 'gebaeude-veraenderungen', autoSync: true, reihe: 10, kapitel: '2.2.1 Bauliche Veränderungen',
    titel: 'Bauliche Veränderungen nach Jahr', datei: 'gebaeude-veraenderungen',
    hinweis: 'Je Jahr und Art (Neubau, Abriss, Sanierung) die betroffenen Gebäude mit Änderung von Wärmebedarf und Heizlast. Bis 40 Zeilen.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Hochbau', titel: 'Bauliche Veränderungen nach Jahr', leer: 'Keine baulichen Veränderungen hinterlegt.',
      spalten: [{ label: 'Jahr', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      cfg.spalten = [
        { label: 'Jahr', weight: 0.7, align: 'left', mono: false }, { label: 'Veränderung', weight: 1.3, align: 'left', mono: false },
        { label: 'Gebäude', weight: 3, align: 'left', mono: false }, { label: 'Wärmebedarf', weight: 1.3 }, { label: 'Heizlast', weight: 1.1 },
      ];
      if (!a.ereignisseJahr.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine baulichen Veränderungen hinterlegt.'; }
      const vz = v => (v > 0.05 ? '+' : v < -0.05 ? '−' : '±');
      const Z = 40;
      cfg.zeilen = a.ereignisseJahr.slice(0, Z).map(e => ({
        akzent: GG_ART_FARBEN[e.art],
        werte: [String(e.jahr), GG_ART_NAMEN[e.art], e.namen.length <= 3 ? e.namen.join(', ') : `${e.namen.slice(0, 2).join(', ')} und ${ggNum(e.namen.length - 2)} weitere`,
                `${vz(e.deltaMwh)}${ggNum(Math.abs(e.deltaMwh))} MWh/a`, `${vz(e.deltaKw)}${ggNum(Math.abs(e.deltaKw))} kW`],
      }));
      cfg.fussnote = `Änderung gegenüber dem Vorjahr · Heizlast: Summe der Einzelheizlasten` + (a.ereignisseJahr.length > Z ? ` · ${ggNum(a.ereignisseJahr.length - Z)} weitere Zeilen nicht dargestellt` : '');
      return `✓ ${a.ereignisseJahr.length} Zeilen (Jahr und Art).`;
    },
  },
  {
    id: 'gebaeude-entwicklung-text', istText: true, reihe: -10, kapitel: '2.2.2 Entwicklung von Wärmebedarf und Heizlast',
    titel: 'Gutachtentext: Entwicklung von Wärmebedarf und Heizlast', datei: 'gebaeude-entwicklung-text',
    hinweis: 'Entwicklung von Wärmebedarf, Heizlast und spezifischem Bedarf vom Ist-Zustand bis zum letzten Ereignis; Verlaufsform (steigend, fallend, erst steigend dann fallend) mit Folgerung für die Auslegung. Nennt die Annahmen der Rechnung.',
    render: () => ggWaermeTextBlatt(gbTextEntwicklung(ggGebaeudeAuswertung(), { lastgangJahr: window.globalYear })), config: {},
  },
  {
    id: 'gebaeude-bedarf-entwicklung', autoSync: true, reihe: 10, kapitel: '2.2.2 Entwicklung von Wärmebedarf und Heizlast',
    titel: 'Entwicklung des Wärmebedarfs', datei: 'gebaeude-bedarf-entwicklung',
    hinweis: 'Wärmebedarf je Jahr, gestapelt nach Bestand unsaniert, Bestand saniert und Neubau, mit der Summe der Heizlasten als Punktreihe.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Entwicklung des Wärmebedarfs', 'Wärmebedarf in MWh/a', 'Jahr', 'Keine baulichen Veränderungen hinterlegt.'),
    ausProjekt(cfg) {
      const r = ggGebJahresSaeulen(cfg, s => s.bedarfMwh, { label: 'Summe Heizlast', wert: j => j.heizlastKw }, 'kW');
      const a = ggGebaeudeAuswertung();
      if (a.jahre.length >= 2) {
        const f = a.jahre[0], l = a.jahre.at(-1);
        cfg.kpiLinks = [{ wert: ggNum(f.bedarfMwh) + ' MWh/a', label: `Wärmebedarf ${f.jahr} (Ist)` }, { wert: ggNum(l.bedarfMwh) + ' MWh/a', label: `Wärmebedarf ${l.jahr}` }];
        cfg.kpiRechts = [{ wert: ggNum(f.heizlastKw) + ' kW', label: `Heizlast ${f.jahr}` }, { wert: ggNum(l.heizlastKw) + ' kW', label: `Heizlast ${l.jahr}`, highlight: true }];
      }
      return r;
    },
  },
  {
    id: 'gebaeude-heizlast-entwicklung', autoSync: true, reihe: 20, kapitel: '2.2.2 Entwicklung von Wärmebedarf und Heizlast',
    titel: 'Entwicklung der Heizlast', datei: 'gebaeude-heizlast-entwicklung',
    hinweis: 'Summe der Gebäudeheizlasten je Jahr, gestapelt nach Bestand unsaniert, Bestand saniert und Neubau, mit der spezifischen Heizlast in W/m² als Punktreihe. Die Summe der Einzelheizlasten ist nicht die Spitzenlast des Netzes (Gleichzeitigkeit).',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Entwicklung der Heizlast', 'Heizlast in kW', 'Jahr', 'Keine baulichen Veränderungen hinterlegt.'),
    ausProjekt(cfg) {
      const r = ggGebJahresSaeulen(cfg, s => s.heizlastKw, { label: 'spezifische Heizlast', wert: j => j.spezWM2 }, 'W/m²');
      const a = ggGebaeudeAuswertung();
      if (a.jahre.length >= 2) {
        const f = a.jahre[0], l = a.jahre.at(-1), m = a.jahre.reduce((x, y) => (y.heizlastKw > x.heizlastKw ? y : x));
        cfg.kpiLinks = [{ wert: ggNum(f.heizlastKw) + ' kW', label: `Heizlast ${f.jahr} (Ist)` }, { wert: ggNum(l.heizlastKw) + ' kW', label: `Heizlast ${l.jahr}` }];
        cfg.kpiRechts = [{ wert: ggNum(m.heizlastKw) + ' kW', label: `Maximum (${m.jahr})`, highlight: true }];
      }
      return r;
    },
  },
  {
    id: 'gebaeude-spez-entwicklung', autoSync: true, reihe: 30, kapitel: '2.2.2 Entwicklung von Wärmebedarf und Heizlast',
    titel: 'Entwicklung von Fläche und spezifischem Wärmebedarf', datei: 'gebaeude-spez-entwicklung',
    hinweis: 'Fläche der versorgten Gebäude je Jahr (gestapelt nach Bestand unsaniert, saniert und Neubau) mit dem flächengewichteten spezifischen Wärmebedarf in kWh/(m²·a) als Punktreihe.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Entwicklung von Fläche und spezifischem Wärmebedarf', 'Fläche in 1.000 m²', 'Jahr', 'Keine baulichen Veränderungen hinterlegt.'),
    ausProjekt(cfg) {
      const r = ggGebJahresSaeulen(cfg, s => s.flaecheM2, { label: 'spezifischer Wärmebedarf', wert: j => j.spezKwhM2 }, 'kWh/m²', 0, 1000);
      const a = ggGebaeudeAuswertung();
      if (a.jahre.length >= 2) {
        const f = a.jahre[0], l = a.jahre.at(-1);
        cfg.kpiLinks = [{ wert: ggNum(f.flaecheM2) + ' m²', label: `Fläche ${f.jahr} (Ist)` }, { wert: ggNum(l.flaecheM2) + ' m²', label: `Fläche ${l.jahr}` }];
        cfg.kpiRechts = [{ wert: Number.isFinite(f.spezKwhM2) ? ggNum(f.spezKwhM2) + ' kWh/m²' : '—', label: `spez. Bedarf ${f.jahr}` }, { wert: Number.isFinite(l.spezKwhM2) ? ggNum(l.spezKwhM2) + ' kWh/m²' : '—', label: `spez. Bedarf ${l.jahr}`, highlight: true }];
      }
      return r;
    },
  },
  {
    id: 'gebaeude-kennwerte', autoSync: true, reihe: 40, kapitel: '2.2.2 Entwicklung von Wärmebedarf und Heizlast',
    titel: 'Kennwerte der Entwicklung', datei: 'gebaeude-kennwerte',
    hinweis: 'Gebäude, Fläche, Wärmebedarf, Heizlast und spezifische Werte für das Ist-Jahr, die Jahre 2030, 2035, 2040, 2045 und 2050 (soweit im Verlauf), das Jahr der höchsten Heizlast und das Endjahr; mit der Veränderung des Bedarfs gegenüber dem Ist.',
    render: cfg => ggRenderTabelle(cfg),
    config: {
      eyebrow: 'Hochbau', titel: 'Kennwerte der Entwicklung', leer: 'Keine baulichen Veränderungen hinterlegt.',
      spalten: [{ label: 'Jahr', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '',
    },
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      cfg.spalten = [
        { label: 'Jahr', weight: 0.8, align: 'left', mono: false }, { label: 'Gebäude', weight: 0.9 }, { label: 'Fläche', weight: 1.1 }, { label: 'Bedarf', weight: 1.2 },
        { label: 'Heizlast', weight: 1 }, { label: 'spez. Bedarf', weight: 1.3 }, { label: 'spez. Heizlast', weight: 1.3 }, { label: 'Δ Bedarf', weight: 1 },
      ];
      if (a.jahre.length < 2) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine baulichen Veränderungen hinterlegt.'; }
      const f = a.jahre[0], l = a.jahre.at(-1), m = a.jahre.reduce((x, y) => (y.heizlastKw > x.heizlastKw ? y : x));
      const jahre = new Set([f.jahr, l.jahr, m.jahr, ...[2030, 2035, 2040, 2045, 2050].filter(y => y > f.jahr && y < l.jahr)]);
      cfg.zeilen = a.jahre.filter(j => jahre.has(j.jahr)).map(j => {
        const d = f.bedarfMwh > 0 ? ((j.bedarfMwh - f.bedarfMwh) / f.bedarfMwh) * 100 : NaN;
        return {
          highlight: j.jahr === f.jahr,
          werte: [j.jahr === f.jahr ? `${j.jahr} (Ist)` : String(j.jahr), ggNum(j.anzahl), ggNum(j.flaecheM2) + ' m²', ggNum(j.bedarfMwh) + ' MWh', ggNum(j.heizlastKw) + ' kW',
                  Number.isFinite(j.spezKwhM2) ? ggNum(j.spezKwhM2) + ' kWh/m²' : '—', Number.isFinite(j.spezWM2) ? ggNum(j.spezWM2) + ' W/m²' : '—',
                  j.jahr === f.jahr || !Number.isFinite(d) ? '—' : `${d > 0.05 ? '+' : d < -0.05 ? '−' : '±'}${ggNum(Math.abs(d), 1)} %`],
        };
      });
      cfg.fussnote = `Heizlast: Summe der Einzelheizlasten · spezifische Werte flächengewichtet · hervorgehoben: Ist-Zustand (${f.jahr}) · Maximum der Heizlast ${m.jahr}`;
      return `✓ ${cfg.zeilen.length} Jahre ausgewählt.`;
    },
  },

  {
    id: 'waerme-ist-text',
    istText: true,
    reihe: -10,
    kapitel: '3.1 Ist-Anlagentechnik',
    titel: 'Gutachtentext: Ist-Zustand Wärme',
    datei: 'waerme-ist-zustand-text',
    hinweis: 'Bestand oder Neubau: Ohne Gebäudebestand entfällt der Ist-Zustand. Sonst Gebäudebestand, Wärmebedarf und Spitzenlast, Netzverlust-Herkunft und die Herkunft des Lastgangs. Die bestehende Wärmeerzeugung bleibt Platzhalter.',
    render: () => {
      const abs = wtIstZustand(ggWaermeDaten());
      // Den Platzhalter „bestehende Wärmeerzeugung“ ersetzt der Baustein Wärmeerzeuger (Bestand), sobald die Bestandsanlage erfasst ist
      const ohne = ggBestandsanlage().anzahl ? abs.filter(a => !a.some(x => x && x.feld && x.feld.startsWith('Bestehende Wärmeerzeuger'))) : abs;
      return ggWaermeTextBlatt(ohne);
    },
    config: {},
  },
  // ── Ist-Zustand Anlagentechnik: Erzeuger, Hydraulik, TWW, Netz (Logik: lib/bestandsanlage.js, lib/gutachten-anlagentechnik.js) ──
  {
    id: 'ist-erzeuger-text', istText: true, reihe: 10, kapitel: '3.1 Ist-Anlagentechnik',
    titel: 'Gutachtentext: Wärmeerzeuger (Bestand)', datei: 'ist-erzeuger-text',
    hinweis: 'Erzeugerpark aus 🔥 Wärme-Grundlagen → Bestandsanlage: Leistung und Feuerungsleistung, Energieträger, Vergleich mit Heizlast heute und künftig, (n−1)-Redundanz, fossile Prägung, Alter nach VDI 2067.',
    render: () => ggWaermeTextBlatt(atTextErzeuger(ggBestandsanlage())), config: {},
  },
  {
    id: 'ist-erzeuger-tabelle', autoSync: true, reihe: 20, kapitel: '3.1 Ist-Anlagentechnik',
    titel: 'Übersicht Wärmeerzeuger (Bestand)', datei: 'ist-erzeuger-tabelle',
    hinweis: 'Bestandserzeuger mit thermischer, Feuerungs- und elektrischer Leistung, Baujahr und Anteil an der thermischen Leistung.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Wärmeversorgung', titel: 'Übersicht Wärmeerzeuger (Bestand)', leer: 'Keine Bestandsanlage erfasst.', spalten: [{ label: 'Erzeuger', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const a = ggBestandsanlage();
      cfg.spalten = [{ label: 'Erzeuger', weight: 2, align: 'left', mono: false }, { label: 'Thermische Leistung', weight: 1.2 }, { label: 'Feuerungsleistung', weight: 1.2 },
        { label: 'El. Leistung', weight: 1 }, { label: 'Baujahr', weight: 0.8 }, { label: 'Anteil (therm.)', weight: 1 }];
      if (!a.anzahl) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Bestandsanlage erfasst (🔥 Wärme-Grundlagen → Bestandsanlage).'; }
      const l = v => (Number.isFinite(v) ? atLeistung(v) : '');
      cfg.zeilen = a.zeilen.map(z => ({ werte: [z.name, l(z.thermKw), l(z.feuerungKw), l(z.elKw), z.baujahr ?? '—', Number.isFinite(z.anteilPct) ? ggNum(z.anteilPct) + ' %' : ''] }));
      cfg.zeilen.push({ highlight: true, werte: ['Summe', l(a.thermKw), a.feuerungKw ? l(a.feuerungKw) : '', a.elKw ? l(a.elKw) : '', '', '100 %'] });
      cfg.fussnote = 'Bestandsanlage laut Unterlagen bzw. Begehung';
      return `✓ ${a.anzahl} Bestandserzeuger.`;
    },
  },
  {
    id: 'ist-erzeuger-leistung', autoSync: true, reihe: 30, kapitel: '3.1 Ist-Anlagentechnik',
    titel: 'Installierte Wärmeerzeugungsleistung (Bestand)', datei: 'ist-erzeuger-leistung',
    hinweis: 'Thermische Leistung je Bestandserzeuger; Kennzahlen: Summe, Heizlast heute und künftig, Leistung ohne den größten Erzeuger.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Installierte Wärmeerzeugungsleistung', 'Thermische Leistung in kW', 'Erzeuger', 'Keine Bestandsanlage erfasst.'),
    ausProjekt(cfg) {
      const a = ggBestandsanlage();
      ggGebKopf(cfg);
      cfg.eyebrow = 'Wärmeversorgung';
      if (!a.anzahl) { ggGebLeer(cfg); return '⚠ Keine Bestandsanlage erfasst.'; }
      cfg.kategorien = a.zeilen.map(z => z.name);
      cfg.gruppen = [{ label: '', segmente: [{ label: 'Thermische Leistung', farbe: GG_SEG_FARBEN.unsaniert, werte: a.zeilen.map(z => z.thermKw || 0) }] }];
      cfg.punkte = null;
      cfg.summenLabel = true;
      cfg.kpiLinks = [{ wert: atLeistung(a.thermKw), label: 'installiert (thermisch)' }, ...(a.feuerungKw ? [{ wert: atLeistung(a.feuerungKw), label: 'Feuerungsleistung' }] : [])];
      cfg.kpiRechts = [
        ...(Number.isFinite(a.heizlastIstKw) ? [{ wert: atLeistung(a.heizlastIstKw), label: 'Heizlast heute' }] : []),
        ...(Number.isFinite(a.heizlastSollKw) ? [{ wert: atLeistung(a.heizlastSollKw), label: 'Heizlast künftig' }] : []),
        ...(a.anzahl > 1 && Number.isFinite(a.ohneGroesstenKw) ? [{ wert: atLeistung(a.ohneGroesstenKw), label: 'ohne größten Erzeuger', highlight: a.n1Erfuellt === false }] : []),
      ];
      return `✓ ${a.anzahl} Erzeuger, ${atLeistung(a.thermKw)}.`;
    },
  },
  {
    id: 'ist-hydraulik-text', istText: true, reihe: 40, kapitel: '3.1 Ist-Anlagentechnik',
    titel: 'Gutachtentext: Wärmeverteilung und Hydraulik (Bestand)', datei: 'ist-hydraulik-text',
    hinweis: 'Multivalente Anlage, Pufferspeicher (Volumen und l/kW), Platzhalter für die hydraulische Einbindung, Hinweis auf den Stand des Hydraulikschemas.',
    render: () => ggWaermeTextBlatt(atTextHydraulik(ggBestandsanlage())), config: {},
  },
  {
    id: 'ist-netz-text', istText: true, reihe: -10, kapitel: '3.1.2 Wärmeversorgungsnetz (WVN)',
    titel: 'Gutachtentext: Wärmenetz (Bestand, Datenlage)', datei: 'ist-netz-text',
    hinweis: 'Datenlage zum Bestandsnetz (Bestandsanlage → Netzdaten) und Lage der Heizzentrale; ist das Bestandsnetz im Tool gezeichnet, dessen Trassenlänge.',
    render: () => {
      const w = window;
      const laengeM = ggLies(() => (w.networkLocked ? (w.netzEdges || []).reduce((x, e) => x + (Number(e.length) || 0), 0) : 0), 0);
      return ggWaermeTextBlatt(atTextNetz(ggBestandsanlage(), { imTool: !!w.networkLocked, laengeM }));
    },
    config: {},
  },
  {
    id: 'ist-tww-text', istText: true, reihe: -10, kapitel: '3.1.3 Wärmetechnische Hausstation (WH)',
    titel: 'Gutachtentext: Trinkwarmwasser (Bestand)', datei: 'ist-tww-text',
    hinweis: 'Aus den Gebäudefeldern „TWW-Art / kW“: summierte Leistung, Anteile je Erzeugungsart, größte Stationen, elektrische und speicherbasierte Lösungen, Warmwassertemperatur als Engpass für Wärmepumpen.',
    render: () => ggWaermeTextBlatt(atTextTww(ggTwwBestand())), config: {},
  },
  {
    id: 'ist-tww-tabelle', autoSync: true, reihe: 10, kapitel: '3.1.3 Wärmetechnische Hausstation (WH)',
    titel: 'TWW-Erzeugungsleistung nach Erzeugungsart (Bestand)', datei: 'ist-tww-tabelle',
    hinweis: 'Aggregierte Trinkwarmwasser-Erzeugungsleistung je Erzeugungsart aus den Gebäudefeldern.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Wärmeversorgung', titel: 'TWW-Erzeugungsleistung nach Erzeugungsart', leer: 'Keine TWW-Angaben an den Gebäuden.', spalten: [{ label: 'Erzeugungsart', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const t = ggTwwBestand();
      cfg.spalten = [{ label: 'Erzeugungsart', weight: 2.4, align: 'left', mono: false }, { label: 'Gebäude', weight: 0.8 }, { label: 'Leistung', weight: 1 }, { label: 'Anteil', weight: 0.8 }];
      if (!t.anzahlErfasst) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine TWW-Angaben (Gebäudefeld „TWW-Art / kW“).'; }
      cfg.zeilen = t.gruppen.map(g => ({ werte: [g.name, ggNum(g.anzahl), ggNum(g.kw) + ' kW', Number.isFinite(g.anteilPct) ? ggNum(g.anteilPct, 1) + ' %' : '—'] }));
      cfg.zeilen.push({ highlight: true, werte: ['Gesamt', ggNum(t.anzahlErfasst), ggNum(t.kw) + ' kW', '100 %'] });
      cfg.fussnote = 'Bestandsgebäude · Angaben laut Unterlagen bzw. Begehung';
      return `✓ ${t.anzahlErfasst} Gebäude mit TWW-Angaben.`;
    },
  },
  // ── Ist-Wärmeverbrauch über mehrere Jahre: Datengrundlage, Energiebezug, CO₂ (Logik: lib/gutachten-verbrauch.js) ──
  {
    id: 'verbrauch-daten-text', istText: true, reihe: -30, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Gutachtentext: Datengrundlage Verbrauch', datei: 'verbrauch-daten-text',
    hinweis: 'Zeitraum und Auflösung der Verbrauchsdaten je Energieträger aus 🔥 Wärme-Grundlagen → Bestandsanlage → Verbrauchsdaten.',
    render: () => ggWaermeTextBlatt(vbTextDaten(ggVerbrauch())), config: {},
  },
  {
    id: 'verbrauch-bezug-text', istText: true, reihe: -20, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Gutachtentext: Energiebezug über die Jahre', datei: 'verbrauch-bezug-text',
    hinweis: 'Mittel und Spanne des Energiebezugs, dominanter Bezug, erneuerbarer Anteil, BHKW, Verschiebung des Mix (z. B. Energiekrise 2022) und fossile Abhängigkeit.',
    render: () => ggWaermeTextBlatt(vbTextBezug(ggVerbrauch())), config: {},
  },
  {
    id: 'verbrauch-bezug-grafik', autoSync: true, reihe: -15, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Energiebezug je Jahr', datei: 'verbrauch-bezug-grafik',
    hinweis: 'Endenergiebezug je Jahr, gestapelt nach Erzeugergruppe (Kessel je Energieträger, BHKW); ohne Witterungsbereinigung.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Energiebezug je Jahr', 'Energiebezug in MWh/a', 'Jahr', 'Keine Verbrauchsdaten erfasst.'),
    ausProjekt(cfg) {
      const v = ggVerbrauch();
      ggGebKopf(cfg);
      cfg.eyebrow = 'Wärmeversorgung';
      if (!v.anzahlJahre) { ggGebLeer(cfg); return '⚠ Keine Verbrauchsdaten (Bestandsanlage → Verbrauchsdaten).'; }
      const farben = ['#7f8c8d', '#3F9C3F', '#e67e22', '#2980b9', '#8e44ad', '#c0392b'];
      cfg.kategorien = v.jahre.map(j => String(j.jahr));
      cfg.gruppen = [{ label: '', segmente: v.gruppen.map((g, i) => ({ label: g.name, farbe: g.ee ? '#3F9C3F' : farben[i % farben.length], werte: v.jahre.map(j => j.werte[g.key]) })) }];
      cfg.punkte = null;
      cfg.summenLabel = true;
      cfg.kpiLinks = [{ wert: ggNum(v.summeMittel) + ' MWh/a', label: `Ø ${v.vonJahr}–${v.bisJahr}` }];
      cfg.kpiRechts = [{ wert: ggNum(v.fossilPctMittel) + ' %', label: 'fossiler Anteil Ø', highlight: v.fossilPctMittel >= 50 }];
      return `✓ ${v.anzahlJahre} Jahre, ${v.gruppen.length} Erzeugergruppen.`;
    },
  },
  {
    id: 'verbrauch-co2-text', istText: true, reihe: -10, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Gutachtentext: CO₂-Emissionen (Bestand)', datei: 'verbrauch-co2-text',
    hinweis: 'CO₂e aus Verbrauchsdaten und den Emissionsfaktoren des Projekts (Standard GEG Anlage 9), Verteilung je Energieträger und Veranschaulichung (Benzin, Pkw-km, Erdumrundungen).',
    render: () => ggWaermeTextBlatt(vbTextCo2(ggVerbrauch())), config: {},
  },
  {
    id: 'verbrauch-referenzjahr-text', istText: true, reihe: -5, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Gutachtentext: Referenzjahr der Lastganganalyse', datei: 'verbrauch-referenzjahr-text',
    hinweis: 'Jahr, dessen Aufteilung der Energieträger dem Mehrjahresmittel am nächsten kommt; Vergleich mit dem Jahr des hochgeladenen Lastgangs.',
    render: () => ggWaermeTextBlatt(vbTextReferenzjahr(ggVerbrauch(), ggLies(() => window.getWitterung?.()?.messjahr, null))), config: {},
  },
  // ── Lastgang: Witterungsbereinigung, Sommergrundlast, Spitzenlast/Auslegung, EE-Leistung (Logik: lib/gutachten-lastgang.js) ──
  {
    id: 'lastgang-witterung-text', istText: true, reihe: 20, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Gutachtentext: Witterungsbereinigung', datei: 'lastgang-witterung-text',
    hinweis: 'Gradtagzahlen des Messjahres gegenüber dem langjährigen Mittel, Faktor, bereinigter Anteil und Jahresverbrauch vorher/nachher (🔥 Wärme-Grundlagen → Lastgang).',
    render: () => ggWaermeTextBlatt(lgTextWitterung(window._wbInfo, {
      gemessen: String(ggLies(() => ggWaermeHerkunft().lastgang, '')).startsWith('import'), messjahr: ggLies(() => window.getWitterung?.()?.messjahr, ''),
    })), config: {},
  },
  {
    id: 'lastgang-gradtage-tabelle', autoSync: true, reihe: 21, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Gradtagzahlen G20/15 und Bereinigungsfaktor', datei: 'lastgang-gradtage-tabelle',
    hinweis: 'Gradtagzahl je Jahr des Vergleichszeitraums, Messjahr, Mittel und Faktor (aus 🔥 Wärme-Grundlagen → Lastgang → Gradtagzahlen laden).',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Wärmebedarf', titel: 'Gradtagzahlen G20/15 und Bereinigungsfaktor', leer: 'Keine Gradtagzahlen geladen.', spalten: [{ label: 'Jahr', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const wb = ggLies(() => window.getWitterung?.(), {}) || {};
      const e = wb.ergebnis;
      cfg.spalten = [{ label: 'Jahr', weight: 2, align: 'left', mono: false }, { label: 'G20/15', weight: 1 }];
      if (!e || e.messjahr !== wb.messjahr || !Array.isArray(e.gJahre)) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Gradtagzahlen geladen.'; }
      cfg.zeilen = e.gJahre.map(x => ({ highlight: x.jahr === e.messjahr, werte: [x.jahr === e.messjahr ? `${x.jahr} (Messjahr)` : String(x.jahr), ggNum(x.g) + ' Kd'] }));
      cfg.zeilen.push({ highlight: true, werte: [`Mittel ${e.vonJahr}–${e.bisJahr}`, ggNum(e.gMittel) + ' Kd'] });
      cfg.zeilen.push({ highlight: true, werte: ['Bereinigungsfaktor (Mittel ÷ Messjahr)', ggNum(e.faktor, 3)] });
      cfg.fussnote = 'Gradtagzahl G20/15 nach VDI 3807 aus Tagesmitteltemperaturen (Open-Meteo-Archiv, ERA5-Reanalyse) am Standort der Liegenschaft';
      return `✓ ${e.gJahre.length} Jahre, Faktor ${ggNum(e.faktor, 3)}.`;
    },
  },
  {
    id: 'lastgang-grundlast-text', istText: true, reihe: 30, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Gutachtentext: Sommergrundlast (TWW und Netzverluste)', datei: 'lastgang-grundlast-text',
    hinweis: 'Mittlere Leistung im Juli/August als Grundlast aus Warmwasser und Netzverlusten, aufs Jahr hochgerechnet und aufgeteilt.',
    render: () => {
      const ss = window.systemState;
      return ggWaermeTextBlatt(lgTextGrundlast({ lastgangKw: ss?.lastgangKw, gesamtMwh: ss?.gesamtMwhMitNV, netzverlustMwh: ss?.netzverlustMwh }));
    },
    config: {},
  },
  {
    id: 'lastgang-spitzenlast-text', istText: true, reihe: 40, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Gutachtentext: Spitzenlast und Auslegungsheizlast', datei: 'lastgang-spitzenlast-text',
    hinweis: 'Nur bei gemessenem Lastgang: Spitzenlast mit Tagesmitteltemperatur des Messjahres, lineare Extrapolation auf die Norm-Außentemperatur, Reservehinweis bei auffälligen Nutzungsarten, Abgleich mit der Bestandsanlage.',
    render: () => {
      const w = window, ss = w.systemState;
      if (!String(ggLies(() => ggWaermeHerkunft().lastgang, '')).startsWith('import')) return ggWaermeTextBlatt([]);
      const wb = ggLies(() => w.getWitterung?.(), {}) || {};
      const auff = ggLies(() => ggGebaeudeAuswertung().ist.nutzungFaktor.find(n => n.anzahl >= 2 && n.faktorMittel >= 2)?.nutzung, null);
      return ggWaermeTextBlatt(lgTextSpitzenlast({
        lastgangKw: ss?.lastgangKw, tageT: wb.ergebnis?.messjahr === wb.messjahr ? wb.ergebnis?.tageT : null,
        normAtC: parseFloat(ggLies(() => w.captureWaermeGrundlagen?.()?.normAussentemp, NaN)), auffaelligeNutzung: auff, bestandThermKw: ggBestandsanlage().thermKw,
      }));
    },
    config: {},
  },
  {
    id: 'lastgang-deckung-text', istText: true, reihe: 50, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Gutachtentext: EE-Leistung für GEG-Quote', datei: 'lastgang-deckung-text',
    hinweis: 'Aus der Jahresdauerlinie: erforderliche EE-Leistung für 65 % (GEG) und 90 % der Jahreswärme, mit Hinweis auf den Leistungsabfall von Wärmepumpen.',
    render: () => ggWaermeTextBlatt(lgTextDeckung({ jdlKw: window.systemState?.jahresdauerlinie })), config: {},
  },
  // ── Potenzialanalyse (Logik: lib/gutachten-potenzial.js) ──
  {
    id: 'potenzial-einleitung-text', istText: true, reihe: -40, kapitel: '4 Potenzialanalyse',
    titel: 'Gutachtentext: Einleitung Potenzialanalyse', datei: 'potenzial-einleitung-text',
    hinweis: 'Standardtext: Ziel und Aufbau der Potenzialanalyse.',
    render: () => ggWaermeTextBlatt(ptTextEinleitung()), config: {},
  },
  {
    id: 'potenzial-nicht-abwaerme', istText: true, reihe: -30, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – Abwärme', datei: 'potenzial-nicht-abwaerme',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('abwaerme')), config: {},
  },
  {
    id: 'potenzial-nicht-solarthermie', istText: true, reihe: -29, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – Solarthermie', datei: 'potenzial-nicht-solarthermie',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('solarthermie')), config: {},
  },
  {
    id: 'potenzial-nicht-wasserstoff', istText: true, reihe: -28, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – Wasserstoff', datei: 'potenzial-nicht-wasserstoff',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('wasserstoff')), config: {},
  },
  {
    id: 'potenzial-nicht-gasGrundlast', istText: true, reihe: -27, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – Gas-Grundlast', datei: 'potenzial-nicht-gasGrundlast',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('gasGrundlast', { vorgabeZsb: ggLies(() => window.gutStandardtextDaten?.()?.vorgabeZsb, '') })), config: {},
  },
  {
    id: 'potenzial-nicht-fernwaerme', istText: true, reihe: -26, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – Fernwärme', datei: 'potenzial-nicht-fernwaerme',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('fernwaerme')), config: {},
  },
  {
    id: 'potenzial-nicht-wind', istText: true, reihe: -25, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – Windkraft', datei: 'potenzial-nicht-wind',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('wind')), config: {},
  },
  {
    id: 'potenzial-nicht-bioFluessigGas', istText: true, reihe: -24, kapitel: '4.1 Nicht berücksichtigte Potenziale',
    titel: 'Gutachtentext: Nicht berücksichtigt – flüssige/gasförmige Biomasse', datei: 'potenzial-nicht-bioFluessigGas',
    hinweis: 'Standardbegründung; Baustein entfernen, wenn das Potenzial in diesem Projekt betrachtet wird.',
    render: () => ggWaermeTextBlatt(ptTextNicht('bioFluessigGas')), config: {},
  },
  {
    id: 'potenzial-beruecksichtigt-text', istText: true, reihe: -50, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Berücksichtigte Potenziale', datei: 'potenzial-beruecksichtigt-text',
    hinweis: 'Einleitung zur Matrix der Energieträger und -quellen.',
    render: () => ggWaermeTextBlatt(ptTextBeruecksichtigt()), config: {},
  },
  {
    id: 'potenzial-geo-text', istText: true, reihe: 20, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Oberflächennahe Geothermie (Grundlagen)', datei: 'potenzial-geo-text',
    hinweis: 'Standardtext zu Funktionsweise und Eignung.',
    render: () => ggWaermeTextBlatt(ptTextGeoGrundlagen()), config: {},
  },
  {
    id: 'potenzial-geo-aspekte', reihe: 21, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Vor- und Nachteile der Geothermienutzung', datei: 'potenzial-geo-aspekte',
    hinweis: 'Statische Bewertungstabelle (im Gutachten anpassbar).',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Vor- und Nachteile der Geothermienutzung', leer: '', spalten: [{ label: 'Aspekt', weight: 1, align: 'left', mono: false }, { label: 'Bewertung', weight: 4, align: 'left', mono: false }], zeilen: PT_GEO_ASPEKTE.map(z => ({ werte: z })), fussnote: '' },
  },
  {
    id: 'potenzial-geo-berechnung-text', istText: true, reihe: 22, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Erdwärmesondenfeld', datei: 'potenzial-geo-berechnung-text',
    hinweis: 'Aus dem Geothermie-Panel: Wärmeleitfähigkeit, Entzug je Sonde, Sondenzahl und Fläche nach Leistung und Wärmemenge für die Deckungsrate (Geothermie-Anteil der Einsatzplanung, sonst 65 %), Vergleich mit 400 m Bohrtiefe.',
    render: () => {
      const d = ggPotenzialDaten();
      return ggWaermeTextBlatt(ptTextGeoBerechnung({ ...d.geo, tiefe2: d.geo.tiefe < 400 ? 400 : undefined, jdlKw: d.jdlKw, gesamtMwh: d.gesamtMwh }));
    },
    config: {},
  },
  {
    id: 'potenzial-tiefengeothermie-text', istText: true, reihe: 30, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Tiefengeothermie', datei: 'potenzial-tiefengeothermie-text',
    hinweis: 'Standardtext mit Platzhalter für die Zielhorizonte und Fördermengen für die Spitzenlast bei 65→35 °C und 110→50 °C.',
    render: () => ggWaermeTextBlatt(ptTextTiefengeothermie({ leistungKw: ggPotenzialDaten().pMaxKw })), config: {},
  },
  {
    id: 'potenzial-tiefengeothermie-horizonte', reihe: 31, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Potenzielle Zielhorizonte Tiefengeothermie', datei: 'potenzial-tiefengeothermie-horizonte',
    hinweis: 'Zeilen in der Einzelansicht ausfüllen (Horizont, Tiefe, Temperatur).',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Potenzielle Zielhorizonte Tiefengeothermie', leer: '', spalten: [{ label: 'Zielhorizont', weight: 2, align: 'left', mono: false }, { label: 'Tiefenlage', weight: 1 }, { label: 'Temperaturniveau', weight: 1 }], zeilen: [{ werte: ['[Horizont]', '[m]', '[°C]'] }], fussnote: '' },
  },
  {
    id: 'potenzial-lwwp-text', istText: true, reihe: 40, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Luft-Wasser-Wärmepumpe', datei: 'potenzial-lwwp-text',
    hinweis: 'Berechnungsgrundlagen, Heizkurve aus den Wärme-Grundlagen, bauliche Hinweise und Ergebnis der Einsatzplanung (Leistung, Deckung, JAZ, Anteile, Platzbedarf).',
    render: () => ggWaermeTextBlatt(ptTextLwwp({ ...ggPotenzialDaten().lwwp, sweep: ggLwwpSweep() })), config: {},
  },
  {
    id: 'potenzial-lwwp-vornach', reihe: 41, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Vor- und Nachteile von Luft-Wasser-Wärmepumpen', datei: 'potenzial-lwwp-vornach',
    hinweis: 'Statische Tabelle.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Vor- und Nachteile von Luft-Wasser-Wärmepumpen', leer: '', spalten: [{ label: '', weight: 1, align: 'left', mono: false }, { label: 'Luft-Wasser-Wärmepumpe', weight: 4, align: 'left', mono: false }], zeilen: [...PT_LWWP_VORNACH.vorteile.map((v, i) => ({ werte: [i ? '' : 'Vorteile', v] })), ...PT_LWWP_VORNACH.nachteile.map((v, i) => ({ werte: [i ? '' : 'Nachteile', v] }))], fussnote: '' },
  },
  {
    id: 'potenzial-schall-text', istText: true, reihe: 50, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Schallemissionen Luft-WP', datei: 'potenzial-schall-text',
    hinweis: 'TA Lärm, konservative Freifeldausbreitung mit dem Schallleistungspegel aus dem Luft-WP-Panel, Abstände für 55/40/35 dB(A), Hinweis auf Schallgutachten.',
    render: () => ggWaermeTextBlatt(ptTextSchall(ggPotenzialDaten().lwwp)), config: {},
  },
  {
    id: 'potenzial-schall-ta-laerm', reihe: 51, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Immissionsrichtwerte nach TA Lärm', datei: 'potenzial-schall-ta-laerm',
    hinweis: 'Richtwerte außen in dB(A); Spalte für die Liegenschaft bei Bedarf ergänzen.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Immissionsrichtwerte nach TA Lärm', leer: '', spalten: [{ label: 'Gebiet', weight: 2.5, align: 'left', mono: false }, { label: 'Tag', weight: 1 }, { label: 'Nacht', weight: 1 }], zeilen: PT_TA_LAERM.map(([g, t, n]) => ({ werte: [g, t + ' dB(A)', n + ' dB(A)'] })), fussnote: '' },
  },
  {
    id: 'potenzial-biomasse-text', istText: true, reihe: 60, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Biomasse (Pellets/Hackschnitzel)', datei: 'potenzial-biomasse-text',
    hinweis: 'Pellets vs. Hackschnitzel, Kennwerte für monovalente Deckung, Nachhaltigkeit (ENplus A1), Beitrag eines vorhandenen Pelletkessels zur GEG-Quote.',
    render: () => {
      const d = ggPotenzialDaten();
      return ggWaermeTextBlatt(ptTextBiomasse({ waermeMwh: d.gesamtMwh, leistungKw: d.pMaxKw, preisCtKwh: d.preis, bestandPelletKw: d.bestandPelletKw, jdlKw: d.jdlKw }));
    },
    config: {},
  },
  {
    id: 'potenzial-biomasse-qualitativ', reihe: 61, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Qualitativer Vergleich Holzpellets und Hackschnitzel', datei: 'potenzial-biomasse-qualitativ',
    hinweis: 'Statische Tabelle.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Qualitativer Vergleich Holzpellets und Hackschnitzel', leer: '', spalten: [{ label: 'Kriterium', weight: 1.6, align: 'left', mono: false }, { label: 'Holzpellets', weight: 1.6, align: 'left', mono: false }, { label: 'Holzhackschnitzel', weight: 1.6, align: 'left', mono: false }], zeilen: PT_BIO_QUALITATIV.map(z => ({ werte: z })), fussnote: '' },
  },
  {
    id: 'potenzial-biomasse-kennwerte', autoSync: true, reihe: 62, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Kennwerte Pellets vs. Hackschnitzel', datei: 'potenzial-biomasse-kennwerte',
    hinweis: 'Für monovalente Deckung des Jahreswärmebedarfs mit Spitzenlast als Kesselleistung; Annahmen in der Fußnote.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Kennwerte Pellets vs. Hackschnitzel', leer: 'Kein Lastgang berechnet.', spalten: [{ label: 'Kennwert', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const d = ggPotenzialDaten();
      cfg.spalten = [{ label: 'Kennwert', weight: 2.4, align: 'left', mono: false }, { label: 'HHS', weight: 1 }, { label: 'Pellets', weight: 1 }];
      if (!(d.gesamtMwh > 0 && d.pMaxKw > 0)) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Kein Lastgang berechnet.'; }
      const k = ptBioKennwerte({ waermeMwh: d.gesamtMwh, leistungKw: d.pMaxKw, preisCtKwh: d.preis });
      const z = (label, f, e = '') => ({ werte: [label, ggNum(f(k.hhs)) + e, ggNum(f(k.pellets)) + e] });
      cfg.zeilen = [z('Brennstoffverbrauch (Volllast)', x => x.kgH, ' kg/h'), z('Jahresverbrauch Masse', x => x.tA, ' t'), z('Jahresverbrauch Volumen', x => x.m3A, ' m³'),
        z(`Lagervolumen (${PT_BIO.lagerTage} Tage Volllast)`, x => x.lagerM3, ' m³'), z(`Lagerbreite (${PT_BIO.lagerTiefeM} m tief, ${PT_BIO.lagerHoeheM} m hoch)`, x => x.lagerBreiteM, ' m'),
        z('Lagerfläche', x => x.lagerFlaecheM2, ' m²'), z('Brennstoffkosten', x => x.kostenEur, ' €/a'), z('Lkw-Anlieferungen pro Jahr', x => x.lkwJahr), z('Lkw pro Tag bei Volllast', x => x.lkwTagVolllast)];
      cfg.fussnote = `Heizwert ${ggNum(PT_BIO.pellets.heizwertKwhKg, 1)} / ${ggNum(PT_BIO.hhs.heizwertKwhKg, 1)} kWh/kg, Schüttdichte ${PT_BIO.pellets.schuettdichte} / ${PT_BIO.hhs.schuettdichte} kg/m³, Kesselwirkungsgrad ${ggNum(PT_BIO.pellets.eta * 100)} / ${ggNum(PT_BIO.hhs.eta * 100)} %, Lkw ${PT_BIO.pellets.lkwT} / ${PT_BIO.hhs.lkwT} t (Pellets / HHS)`;
      return '✓ Kennwerte berechnet.';
    },
  },
  // ── Variantenvergleich: Rahmen, Resilienz, Gegenüberstellung, Klima, Kosten, PV, Sensitivität (Logik: lib/gutachten-varianten.js) ──
  {
    id: 'va-rahmen-text', istText: true, reihe: -30, kapitel: '7 Variantenvergleich Wärme',
    titel: 'Gutachtentext: Rahmenbedingungen Variantenvergleich', datei: 'va-rahmen-text',
    hinweis: 'Aufbau des Vergleichs, Strom-Emissionsfaktor heute statt GEG-Pauschalwert, mittlerer Faktor künftig, CO₂-Kostenansatz.',
    render: () => { const d = ggVariantenDaten(); return ggWaermeTextBlatt(vaTextRahmen({ efStromGeg: 560, efStrom: d.ef.strom, efStromLz: d.ef.stromLz, co2PreisEurT: d.co2PreisEurT, co2Quelle: d.co2Quelle })); }, config: {},
  },
  {
    id: 'va-rahmen-tabelle', autoSync: true, reihe: -25, kapitel: '7 Variantenvergleich Wärme',
    titel: 'Emissionsfaktoren und Energiepreise', datei: 'va-rahmen-tabelle',
    hinweis: 'Preise aus der Wirtschaftlichkeit, PEF nach GEG Anlage 4, CO₂-Faktoren heute und Ø künftig.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Variantenvergleich', titel: 'Emissionsfaktoren und Energiepreise', leer: '', spalten: [{ label: 'Energieträger', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const d = ggVariantenDaten();
      cfg.spalten = [{ label: 'Energieträger', weight: 1.6, align: 'left', mono: false }, { label: 'Preis (brutto)', weight: 1 }, { label: 'PEF', weight: 0.6 },
        { label: 'CO₂e heute', weight: 1 }, { label: 'Quelle', weight: 1.4, align: 'left', mono: false }, { label: 'CO₂e Ø künftig', weight: 1 }, { label: 'Quelle', weight: 1.2, align: 'left', mono: false }];
      cfg.zeilen = vaRahmenZeilen(d);
      if (Number.isFinite(d.co2PreisEurT)) cfg.zeilen.push({ highlight: true, werte: ['CO₂-Kostenansatz', `${ggNum(d.co2PreisEurT)} €/t CO₂e`, '', '', d.co2Quelle || '', '', ''] });
      cfg.fussnote = 'PEF: nicht erneuerbarer Anteil nach GEG Anlage 4';
      return `✓ ${cfg.zeilen.length} Zeilen.`;
    },
  },
  {
    id: 'va-resilienz-text', istText: true, reihe: -20, kapitel: '7 Variantenvergleich Wärme',
    titel: 'Gutachtentext: Zweistoffbrenner als Resilienz- und Spitzenlasteinheit', datei: 'va-resilienz-text',
    hinweis: 'Prüft, ob alle Varianten einen fossilen Kessel auf voller Heizlast enthalten; Vorgabe als Platzhalter.',
    render: () => ggWaermeTextBlatt(vaTextResilienz({ ...ggVariantenDaten(), vorgabeZsb: ggLies(() => window.gutStandardtextDaten?.()?.vorgabeZsb, '') })), config: {},
  },
  {
    id: 'va-gegenueberstellung', autoSync: true, reihe: 20, kapitel: '7 Variantenvergleich Wärme',
    titel: 'Gegenüberstellung der Varianten', datei: 'va-gegenueberstellung',
    hinweis: 'Leistungen je Erzeugertyp, Deckungsanteile, strombasierter Anteil und Resilienz je Variante.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Variantenvergleich', titel: 'Gegenüberstellung der Varianten', leer: 'Keine berechneten Varianten.', spalten: [{ label: 'Kriterium', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const d = ggVariantenDaten();
      if (!d.varianten.length) { cfg.zeilen = []; return '⚠ Keine berechneten Varianten.'; }
      const g = vaGegenueberstellung(d.varianten, d.pMaxKw);
      cfg.spalten = g.kopf.map((k, i) => (i ? { label: k, weight: 1 } : { label: k, weight: 2, align: 'left', mono: false }));
      cfg.zeilen = g.zeilen;
      cfg.fussnote = 'Deckungsanteile aus der stundenscharfen Einsatzplanung der Varianten';
      return `✓ ${d.varianten.length} Varianten.`;
    },
  },
  {
    id: 'va-klima-text', istText: true, reihe: 40, kapitel: '7.1 Klimarelevanz',
    titel: 'Gutachtentext: Klimarelevanz heute, künftig und kumuliert', datei: 'va-klima-text',
    hinweis: 'Emissionen heute und mit mittlerem künftigem Strom-Emissionsfaktor, stärkste Reduktion, Bestwert, Referenz reines Erdgas und Bestand, Summe über 20 Jahre.',
    render: () => { const d = ggVariantenDaten(); return ggWaermeTextBlatt(vaTextKlima({ varianten: d.varianten, gesamtMwh: d.gesamtMwh, efGas: d.ef.gas, bestandCo2T: d.bestandCo2T, eta: d.eta })); }, config: {},
  },
  {
    id: 'va-kosten-text', istText: true, reihe: -20, kapitel: '7.2 Wirtschaftlichkeit und Investitionskosten',
    titel: 'Gutachtentext: Kostenkomponenten', datei: 'va-kosten-text',
    hinweis: 'Standardaufzählung Energie-, Kapital-, Betriebs- und CO₂-Kosten.',
    render: () => ggWaermeTextBlatt(vaTextKostenKomponenten(ggVariantenDaten())), config: {},
  },
  {
    id: 'va-pv-text', istText: true, reihe: 30, kapitel: '7.2.1 Wirtschaftlichkeit mit PV-Eigenstrom',
    titel: 'Gutachtentext: Wirtschaftlichkeit mit PV-Eigenstrom', datei: 'va-pv-text',
    hinweis: 'Wärmegestehungskosten je Variante mit und ohne PV-Eigenstrom, größte und geringste Entlastung, Rangfolge. Ohne PV-Anlage Platzhalter.',
    render: () => ggWaermeTextBlatt(vaTextPv({ vergleich: abPvVergleich(ggVariantenDaten().varianten) })), config: {},
  },
  {
    id: 'va-sensitivitaet-text', istText: true, reihe: 40, kapitel: '7.3 Energiepreissensitivität',
    titel: 'Gutachtentext: Energiepreissensitivität', datei: 'va-sensitivitaet-text',
    hinweis: 'Drei Szenarien (heute, moderat, Krise) auf die Energiekosten je Energieträger der Varianten; prozentuale und absolute Mehrkosten, Rangfolge.',
    render: () => { const d = ggVariantenDaten(); return ggWaermeTextBlatt(vaTextSensitivitaet(d.varianten, d.preise)); }, config: {},
  },
  {
    id: 'va-sensitivitaet-grafik', autoSync: true, reihe: 42, kapitel: '7.3 Energiepreissensitivität',
    titel: 'Energiepreis-Sensitivität – drei Szenarien im Vergleich', datei: 'va-sensitivitaet-grafik',
    hinweis: 'Jährliche Gesamtkosten je Variante in den drei Preisszenarien als gruppierte Säulen.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Energiepreis-Sensitivität – drei Szenarien im Vergleich', 'Jährliche Gesamtkosten in Tsd. €', 'Variante', 'Keine Varianten mit Jahreskosten.'),
    ausProjekt(cfg) {
      const d = ggVariantenDaten();
      const r = vaSensitivitaet(d.varianten, d.preise);
      ggGebKopf(cfg);
      cfg.eyebrow = 'Variantenvergleich';
      if (!r.length) { ggGebLeer(cfg); return '⚠ Keine Varianten mit Jahreskosten.'; }
      const farben = ['#6B8E4E', '#C9A227', '#7A6334'];
      cfg.kategorien = r.map(x => x.name);
      cfg.gruppen = VA_SZENARIEN.map((s, i) => ({ label: s.name, segmente: [{ label: s.name, farbe: farben[i % farben.length], werte: r.map(x => x.sz[i].gesamt / 1000) }] }));
      cfg.punkte = null;
      cfg.summenLabel = true;
      cfg.kpiLinks = [{ wert: `Strom ${ggNum(d.preise.strom, 1)} · Gas ${ggNum(d.preise.gas, 1)} ct/kWh`, label: 'Preise heute' }];
      cfg.kpiRechts = VA_SZENARIEN.slice(1).map(s => ({ wert: `Strom +${s.strom} % · Gas/Öl +${s.fossil} %`, label: s.name }));
      return `✓ ${r.length} Varianten, ${VA_SZENARIEN.length} Szenarien.`;
    },
  },
  {
    id: 'va-sensitivitaet-tabelle', autoSync: true, reihe: 41, kapitel: '7.3 Energiepreissensitivität',
    titel: 'Jährliche Gesamtkosten in drei Energiepreisszenarien', datei: 'va-sensitivitaet-tabelle',
    hinweis: 'Gesamtkosten und Anstieg je Variante und Szenario.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Variantenvergleich', titel: 'Jährliche Gesamtkosten in drei Energiepreisszenarien', leer: 'Keine Varianten mit Jahreskosten.', spalten: [{ label: 'Variante', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const d = ggVariantenDaten();
      const r = vaSensitivitaet(d.varianten, d.preise);
      cfg.spalten = [{ label: 'Variante', weight: 2, align: 'left', mono: false }, ...VA_SZENARIEN.map(s => ({ label: s.name, weight: 1.2 }))];
      cfg.zeilen = r.map(x => ({ werte: [x.name, ...x.sz.map((z, i) => `${ggNum(z.gesamt / 1e6, 2)} Mio. €${i ? ` (+${ggNum(z.pct, 1)} %)` : ''}`)] }));
      cfg.fussnote = VA_SZENARIEN.slice(1).map(s => `${s.name}: Strom +${s.strom} %, Gas/Öl +${s.fossil} %, Biomasse +${s.bio} %`).join(' · ');
      return r.length ? `✓ ${r.length} Varianten.` : '⚠ Keine Varianten mit Jahreskosten.';
    },
  },
  // ── Fazit Wärme, NT-Ertüchtigung, Fahrplan; Resilienz: Heizöl und Übergang (Logik: lib/gutachten-fazit.js) ──
  {
    id: 'va-bewertungsmatrix', autoSync: true, reihe: 10, kapitel: '7.4 Bewertungsmatrix',
    titel: 'Bewertungsmatrix der Varianten', datei: 'va-bewertungsmatrix',
    hinweis: 'Punkte 0–100 je Kriterium (bester Wert 100, übrige im Verhältnis) mit Rohwert, gewichtet zur Gesamtbewertung: Wirtschaftlichkeit 35 %, Klima 30 %, Resilienz 20 %, Preisstabilität 15 %.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Variantenvergleich', titel: 'Bewertungsmatrix der Varianten', leer: 'Mindestens zwei Varianten mit Wirtschaftlichkeit nötig.', spalten: [{ label: 'Kriterium', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const m = faBewertungsmatrix(ggVariantenDaten());
      if (!m) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Mindestens zwei Varianten mit Wirtschaftlichkeit nötig.'; }
      const Z = m.zeilen;
      cfg.spalten = [{ label: 'Kriterium', weight: 1.8, align: 'left', mono: false }, { label: 'Gewicht', weight: 0.7 }, ...Z.map(z => ({ label: z.name, weight: 1.2 }))];
      const roh = { kosten: r => `${ggNum(r.kosten, 2)} ct/kWh`, klima: r => `${ggNum(r.klima)} t/a`, resilienz: r => (Number.isFinite(r.resilienz) ? `${ggNum(r.resilienz * 100)} %` : '—'), preis: r => (Number.isFinite(r.preis) ? `+${ggNum(r.preis, 1)} %` : '—') };
      cfg.zeilen = Object.keys(FA_KRITERIEN).map(k => ({ werte: [FA_KRITERIEN[k], `${ggNum(m.gewichte[k] * 100)} %`, ...Z.map(z => (Number.isFinite(z.punkte[k]) ? `${ggNum(z.punkte[k])} (${roh[k](z.roh)})` : '—'))] }));
      cfg.zeilen.push({ highlight: true, werte: ['Gesamtbewertung', '100 %', ...Z.map(z => ggNum(z.gesamt))] });
      cfg.fussnote = 'Punkte je Kriterium: bester Wert 100, übrige im Verhältnis bester ÷ eigener Wert; Resilienz als Erfüllungsgrad. Rohwerte: Wärmegestehungskosten · Emissionen Ø 2030–2050 · Resilienz (fossiler Kessel ≥ Spitzenlast, Anteil der Spitzenlast aus WP/Stromkessel) · Kostenanstieg im Krisenszenario';
      return `✓ ${Z.length} Varianten bewertet.`;
    },
  },
  {
    id: 'fazit-bewertung-text', istText: true, reihe: 20, kapitel: '9.1 Wärmeversorgung',
    titel: 'Gutachtentext: Bewertung der Varianten (Klima, Wirtschaft, Resilienz)', datei: 'fazit-bewertung-text',
    hinweis: 'Fasst Emissionen (heute, künftig, kumuliert, Faktor zu reinem Erdgas), Kostenrangfolge mit Sensitivität und Resilienz zusammen.',
    render: () => { const d = ggVariantenDaten(); return ggWaermeTextBlatt(faTextBewertung({ ...d, efGas: d.ef.gas })); }, config: {},
  },
  {
    id: 'fazit-empfehlung-text', istText: true, reihe: 30, kapitel: '9.1 Wärmeversorgung',
    titel: 'Gutachtentext: Empfehlung der Vorzugsvariante', datei: 'fazit-empfehlung-text',
    hinweis: 'Eine oder zwei führende Varianten (Kostenabstand unter 3 %), Pfad zur Klimaneutralität, Einordnung von Stromkessel- und Erdwärmevarianten.',
    render: () => ggWaermeTextBlatt(faTextEmpfehlung(ggVariantenDaten())), config: {},
  },
  {
    id: 'fazit-nt-text', istText: true, reihe: 40, kapitel: '9.1 Wärmeversorgung',
    titel: 'Gutachtentext: Niedertemperatur-Ertüchtigung', datei: 'fazit-nt-text',
    hinweis: 'HT (Netz-Vorlauf) gegen NT (Mittel der Heizkurve) bei gleicher WP-Wärme: JAZ, Strom, Kosten, Invest (Bestandsgebäude × 25.000 €), Amortisation, CO₂; Phasen 1–3 und Fazit.',
    render: () => {
      const w = window, d = ggVariantenDaten();
      const en = ggLies(() => w._dispatchEnergy, {}) || {};
      const wp = ['lwwp', 'geo', 'fg'].reduce((a, k) => ({ w: a.w + (en[k]?.waermeMwh || 0), e: a.e + (en[k]?.elMwh || 0) }), { w: 0, e: 0 });
      const vl15 = ggFeldZahl('gl-vl15'), vl5 = ggFeldZahl('gl-vl5');
      return ggWaermeTextBlatt(faTextNt({
        waermeMwh: wp.w, jazNt: wp.e > 0 ? wp.w / wp.e : undefined, vlHtC: ggFeldZahl('netz-vl'), vlNtC: Number.isFinite(vl15) && Number.isFinite(vl5) ? (vl15 + vl5) / 2 : NaN,
        strompreisCt: d.preise.strom, kosten: ggNtKosten(), efStrom: d.ef.strom, efStromLz: d.ef.stromLz,
      }));
    },
    config: {},
  },
  {
    id: 'fazit-nt-kosten', autoSync: true, reihe: 45, kapitel: '9.1 Wärmeversorgung',
    titel: 'Kostenschätzung Niedertemperatur-Ertüchtigung', datei: 'fazit-nt-kosten',
    hinweis: 'Gebäudescharf aus BGF, Bauzustand und TWW-Art; Kostenkennwerte als Annahmen in der Fußnote. Abriss geplanter Gebäude und Neubauten sind nicht enthalten.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Fazit Wärme', titel: 'Kostenschätzung Niedertemperatur-Ertüchtigung', leer: 'Keine Bestandsgebäude mit Fläche.', spalten: [{ label: 'Gebäude', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const k = ggNtKosten();
      const T = v => ggNum(v / 1000, 1) + ' T€';
      cfg.spalten = [{ label: 'Gebäude', weight: 2.2, align: 'left', mono: false }, { label: 'NGF', weight: 0.9 }, { label: 'Heizkörper (Tausch)', weight: 1.1 },
        { label: 'Aufnahme', weight: 0.9 }, { label: 'Abgleich', weight: 0.9 }, { label: 'Heizflächen', weight: 0.9 }, { label: 'TWW', weight: 0.8 }, { label: 'Summe', weight: 0.9 }];
      if (!k.anzahl) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Bestandsgebäude mit Fläche.'; }
      const z = [...k.zeilen].sort((a, b) => b.summe - a.summe);
      cfg.zeilen = z.slice(0, 25).map(g => ({ werte: [g.name, ggNum(g.ngf) + ' m²', `${ggNum(g.hk)} (${ggNum(g.tauschHk)})`, T(g.posten.aufnahme), T(g.posten.abgleich), T(g.posten.heizflaechen), T(g.posten.tww), T(g.summe)] }));
      if (z.length > 25) cfg.zeilen.push({ werte: [`weitere ${z.length - 25} Gebäude`, '', '', '', '', '', '', T(z.slice(25).reduce((a, g) => a + g.summe, 0))] });
      cfg.zeilen.push({ highlight: true, werte: [`Summe ${k.anzahl} Gebäude`, ggNum(k.ngf) + ' m²', ggNum(k.hk), T(k.posten.aufnahme), T(k.posten.abgleich), T(k.posten.heizflaechen), T(k.posten.tww), T(k.summe)] });
      const K = FA_NT_KOSTEN;
      cfg.fussnote = `Annahmen (netto): NGF = 0,85 × BGF · 1 Heizkörper je ${K.m2JeHeizkoerper} m² NGF · Abgleich ${K.abgleichEurHk} €/HK · Tausch ${ggNum(K.tauschEurHk)} €/HK für ${ggNum(K.tauschAnteil[1] * 100)}/${ggNum(K.tauschAnteil[2] * 100)}/${ggNum(K.tauschAnteil[3] * 100)} % der HK bei Zustand 1/2/3 · Aufnahme ${ggNum(K.sockelEur)} € + ${ggNum(K.planungEurM2, 2)} €/m² · TWW-Speicher ${ggNum(K.tww.speicher[0])} € + ${K.tww.speicher[1]} €/kW`;
      return `✓ ${k.anzahl} Gebäude, ${ggNum(k.summe / 1e6, 2)} Mio. €.`;
    },
  },
  {
    id: 'fazit-fahrplan-text', istText: true, reihe: 50, kapitel: '9.1 Wärmeversorgung',
    titel: 'Gutachtentext: Maßnahmenfahrplan', datei: 'fazit-fahrplan-text',
    hinweis: 'Sofort, kurz-, mittel-, langfristig ab dem Folgejahr; Vorzugsvarianten aus der Kostenrangfolge; PV-Batterie aus dem PV-Modul.',
    render: () => {
      const d = ggVariantenDaten();
      const w = d.varianten.filter(v => Number.isFinite(v.wgkCt)).sort((a, b) => a.wgkCt - b.wgkCt);
      const vorzug = w.length >= 2 && (w[1].wgkCt - w[0].wgkCt) / w[0].wgkCt < 0.03 ? [w[0].name, w[1].name] : w.slice(0, 1).map(v => v.name);
      return ggWaermeTextBlatt(faTextFahrplan({ vorzug, pv: { batKwh: ggLies(() => window._stromBatKapKwh, 0) } }));
    },
    config: {},
  },
  {
    id: 'resilienz-heizoel-text', istText: true, reihe: 20, kapitel: '8.2.8 Langfristige Maßnahmen (Umsetzung der Empfehlung im Gutachten)',
    titel: 'Gutachtentext: Heizölbevorratung', datei: 'resilienz-heizoel-text',
    hinweis: 'Tankvolumen für 72 h bei Spitzenlast, Würfelkante, Reichweite bei mittlerer Last, 24-h-Bedarf, Kammern und Zuschläge.',
    render: () => {
      const ss = window.systemState;
      const mittel = ss?.lastgangKw?.length ? ss.lastgangKw.reduce((a, b) => a + b, 0) / ss.lastgangKw.length : NaN;
      return ggWaermeTextBlatt(faTextHeizoeltank({ maxKw: ss?.pMaxKw, mittelKw: mittel }));
    },
    config: {},
  },
  {
    id: 'resilienz-uebergang-text', istText: true, reihe: 20, kapitel: '8.2.7 Kurzfristige Maßnahmen',
    titel: 'Gutachtentext: Organisatorische Übergangsmaßnahmen', datei: 'resilienz-uebergang-text',
    hinweis: 'Standardtext: Notfallorganisation, Personal für manuelle Umschaltung, Kraftstoff, Ersatzteile.',
    render: () => ggWaermeTextBlatt(faTextResilienzUebergang()), config: {},
  },
  {
    id: 'waerme-wea-text',
    istText: true,
    reihe: 10,
    kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Gutachtentext: Bedarf und Auslegungsleistung (Soll)',
    datei: 'waerme-dimensionierung-wea-text',
    hinweis: 'Soll-Zustand ohne Versorgungssystem: Bestand/Neubau, bauliche Veränderungen, Datenherkunft des Lastgangs (Messung oder Synthese, Klima, gesetzte oder geschätzte Gebäudewerte), Bedarf, Spitzenlast, Vollbenutzungsstunden und Deckungsleistungen der Dauerlinie. Erzeuger und Konzepte folgen erst im Variantenvergleich.',
    render: () => ggWaermeTextBlatt(wtDimensionierungWea(ggWaermeDaten())),
    config: {},
  },
  {
    id: 'waerme-wvn-text',
    istText: true,
    reihe: 10,
    kapitel: '3.3.1 WVN',
    titel: 'Gutachtentext: Wärmeversorgungsnetz (Soll)',
    datei: 'waerme-wvn-text',
    hinweis: 'Netz im Soll-Zustand: Trasse, hinzukommende und entfallende Anschlüsse, Wärmebelegung, Netzverluste mit Herkunft, Temperaturniveau und Spreizung, hydraulische Auslegungsregeln; ohne Bezug zu einem Erzeuger.',
    render: () => ggWaermeTextBlatt(wtWvn(ggWaermeDaten())),
    config: {},
  },
  {
    id: 'waerme-wh-text',
    istText: true,
    reihe: 10,
    kapitel: '3.3.2 WH',
    titel: 'Gutachtentext: Wärmetechnische Hausstation (Soll)',
    datei: 'waerme-hausstation-text',
    hinweis: 'Ergebnisgesteuerter Text zu den Hausstationen: Anzahl und Anschlussleistung, Druckreserve, Heizflächen bei niedriger Vorlauftemperatur, Trinkwassererwärmung (Legionellenschutz) und Rücklauftemperatur.',
    render: () => ggWaermeTextBlatt(wtHausstation(ggWaermeDaten())),
    config: {},
  },
  {
    id: 'waerme-eisspeicher-text',
    istText: true,
    reihe: 10,
    kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Gutachtentext: Eisspeicher-Wärmepumpe',
    datei: 'waerme-eisspeicher-text',
    hinweis: 'Funktionsweise von Eisspeicher, Solar-Luftabsorber und Erdreich-Regeneration; ist ein Eisspeicher gewählt (Geothermie-Panel, Wärmequelle = Eisspeicher), zusätzlich Auslegung, Ergebnisse der Stundensimulation (Vereisung, Regeneration, Sperrstunden) und Zusammenspiel mit Luft-WP oder Gaskessel.',
    render: () => ggWaermeTextBlatt(wtEisspeicher(ggEisDaten())),
    config: {},
  },
  {
    id: 'waerme-varianten-text',
    istText: true,
    reihe: 10,
    kapitel: '7 Variantenvergleich Wärme',
    titel: 'Gutachtentext: Variantenvergleich Wärme',
    datei: 'waerme-variantenvergleich-text',
    hinweis: 'Hier stehen die Versorgungssysteme: je Variante Konzept, Leistungsbilanz mit N-1, EE-Anteil (WPG) und Technik, dann Emissionen, Kosten, Rangfolge und Zielkonflikt. Die Varianten kommen aus dem Variantenvergleich der Wärme (dort „Alle aktualisieren“).',
    render: () => ggWaermeTextBlatt(wtVariantenvergleich(ggWaermeDaten())),
    config: {},
  },
  {
    id: 'waerme-wirtschaft-text',
    istText: true,
    reihe: 10,
    kapitel: '7.2 Wirtschaftlichkeit und Investitionskosten',
    titel: 'Gutachtentext: Wirtschaftlichkeit Wärme',
    datei: 'waerme-wirtschaftlichkeit-text',
    hinweis: 'Methodik nach VDI 2067, angesetzte Preise, Investition und Wärmegestehungskosten je Variante, Vergleich mit dem Fernwärmepreis, Kostentreiber je Technik. Betrachtungszeitraum, Preissteigerungen und Förderprogramm bleiben Platzhalter.',
    render: () => ggWaermeTextBlatt(wtWirtschaftlichkeit(ggWaermeDaten())),
    config: {},
  },
  {
    id: 'waerme-empfehlung-text',
    istText: true,
    reihe: 10,
    kapitel: '7.5 Empfehlung',
    titel: 'Gutachtentext: Empfehlung Wärme',
    datei: 'waerme-empfehlung-text',
    hinweis: 'Fasst den Variantenvergleich zusammen und nennt Folgeschritte passend zur Technik. Die empfohlene Variante setzt der Gutachter selbst, sofern nicht eine Variante in Kosten und Emissionen vorn liegt.',
    render: () => ggWaermeTextBlatt(wtEmpfehlung(ggWaermeDaten())),
    config: {},
  },
  {
    id: 'waerme-fazit-text',
    istText: true,
    reihe: 10,
    kapitel: '9.1 Wärmeversorgung',
    titel: 'Gutachtentext: Fazit Wärme',
    datei: 'waerme-fazit-text',
    hinweis: 'Kurzfazit aus Bedarf, Konzept, EE-Anteil, Emissionen, Kosten und offenem Handlungsbedarf.',
    render: () => ggWaermeTextBlatt(wtFazit(ggWaermeDaten())),
    config: {},
  },

  // ── Abbildungen Wärme (Daten: lib/gutachten-abbildungen.js) ──────────────
  {
    id: 'gebaeude-spez-vergleich', autoSync: true, reihe: 35, kapitel: '2.1 Baulicher Ist-Zustand',
    titel: 'Spezifischer Wärmebedarf je Gebäude mit Vergleichswert', datei: 'gebaeude-spez-vergleich',
    hinweis: 'Die 15 Bestandsgebäude mit dem höchsten Wärmebedarf: spezifischer Bedarf je m² BGF neben dem Vergleichswert nach der Bekanntmachung vom 15.04.2021. Liegt eine Verbrauchsaufteilung vor, stehen die aus der Messung verteilten Werte daneben.',
    render: cfg => ggRenderBalken(cfg),
    config: ggGebVorlage('Spezifischer Wärmebedarf je Gebäude', 'kWh/(m²·a) bezogen auf die BGF', 'Gebäude', 'Keine Gebäude mit Fläche und Bedarf.'),
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      ggGebKopf(cfg);
      const z = a.ist.zeilen.filter(g => Number.isFinite(g.spezKwhM2)).slice(0, 15);
      if (!z.length) { ggGebLeer(cfg); return '⚠ Keine Gebäude mit Fläche und Bedarf.'; }
      const auf = ggVerbrauchsaufteilung();
      const aufMap = new Map((auf?.zeilen || []).map(x => [x.name, x.spez]));
      cfg.kategorien = z.map(g => (g.name.length > 14 ? g.name.slice(0, 13) + '…' : g.name));
      cfg.gruppen = [
        { label: '', segmente: [{ label: 'Gebäudewert (Fläche × Typ)', farbe: GG_SEG_FARBEN.unsaniert, werte: z.map(g => g.spezKwhM2) }] },
        ...(auf ? [{ label: '', segmente: [{ label: 'aus Messung verteilt', farbe: '#E0A126', werte: z.map(g => aufMap.get(g.name) || 0) }] }] : []),
        { label: '', segmente: [{ label: 'Vergleichswert (Bekanntmachung 2021)', farbe: '#8A8F8A', werte: z.map(g => (Number.isFinite(g.referenzSpez) ? g.referenzSpez : 0)) }] },
      ];
      cfg.punkte = null; cfg.summenLabel = false;
      const ueber = z.filter(g => Number.isFinite(g.referenzSpez) && g.spezKwhM2 > g.referenzSpez).length;
      cfg.kpiLinks = [{ wert: `${ggNum(a.ist.spezKwhM2)} kWh/m²`, label: 'Mittel Bestand (BGF)' }];
      cfg.kpiRechts = [{ wert: `${ueber} von ${z.length}`, label: 'über dem Vergleichswert', highlight: ueber > 0 }];
      return `✓ ${z.length} Gebäude.`;
    },
  },
  {
    id: 'gebaeude-neubau-tabelle', autoSync: true, reihe: 20, kapitel: '2.2.1 Bauliche Veränderungen',
    titel: 'Geplante Neubauten', datei: 'gebaeude-neubau-tabelle',
    hinweis: 'Je Neubau: Jahr, Nutzung, BGF, Wärmebedarf, Heizlast und spezifische Kennwerte.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Hochbau', titel: 'Geplante Neubauten', leer: 'Keine Neubauten hinterlegt.', spalten: [{ label: 'Gebäude', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const n = ggGebaeudeAuswertung().ereignisse.filter(e => e.art === 'neubau');
      cfg.spalten = [{ label: 'Gebäude', weight: 2.2, align: 'left', mono: false }, { label: 'Jahr', weight: 0.7 }, { label: 'Nutzung', weight: 1.4, align: 'left', mono: false },
        { label: 'BGF', weight: 1 }, { label: 'Wärmebedarf', weight: 1.1 }, { label: 'Heizlast', weight: 1 }, { label: 'spez. Bedarf', weight: 1.1 }, { label: 'spez. Heizlast', weight: 1.1 }];
      if (!n.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Neubauten hinterlegt.'; }
      const sp = (v, fl, e) => (fl > 0 ? `${ggNum((v * 1000) / fl)} ${e}` : '—');
      cfg.zeilen = n.slice(0, 30).map(e => ({ werte: [e.name, String(e.jahr), e.nutzung || '—', e.flaecheM2 > 0 ? ggNum(e.flaecheM2) + ' m²' : '—', ggNum(e.deltaMwh) + ' MWh', ggNum(e.deltaKw) + ' kW', sp(e.deltaMwh, e.flaecheM2, 'kWh/m²'), sp(e.deltaKw, e.flaecheM2, 'W/m²')] }));
      const S = k => n.reduce((x, e) => x + (e[k] || 0), 0);
      cfg.zeilen.push({ highlight: true, werte: [`Summe ${n.length} Neubauten`, '', '', ggNum(S('flaecheM2')) + ' m²', ggNum(S('deltaMwh')) + ' MWh', ggNum(S('deltaKw')) + ' kW', sp(S('deltaMwh'), S('flaecheM2'), 'kWh/m²'), sp(S('deltaKw'), S('flaecheM2'), 'W/m²')] });
      cfg.fussnote = 'Kennwerte aus Gebäudetyp und Fläche · BGF = Grundfläche × Geschosse';
      return `✓ ${n.length} Neubauten.`;
    },
  },
  {
    id: 'gebaeude-bedarf-wasserfall', autoSync: true, reihe: 5, kapitel: '2.2.2 Entwicklung von Wärmebedarf und Heizlast',
    titel: 'Wärmebedarf Ist → Soll', datei: 'gebaeude-bedarf-wasserfall',
    hinweis: 'Wasserfall vom Wärmebedarf des Ist-Jahres über Abriss, Sanierung und Neubau zum Soll-Zustand.',
    render: cfg => ggRenderWasserfall(cfg),
    config: { eyebrow: 'Hochbau', titel: 'Wärmebedarf Ist → Soll', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'Wärmebedarf in MWh/a', achseX: '', leer: 'Keine baulichen Veränderungen hinterlegt.', balken: [], grenzen: [], kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      const a = ggGebaeudeAuswertung();
      ggGebKopf(cfg);
      cfg.balken = abWasserfallBedarf(a);
      if (!cfg.balken.length) { cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Keine baulichen Veränderungen hinterlegt.'; }
      const j0 = a.jahre[0], j1 = a.jahre.at(-1), d = j1.bedarfMwh - j0.bedarfMwh;
      cfg.kpiLinks = [{ wert: `${ggNum(j0.bedarfMwh)} MWh`, label: `Wärmebedarf ${j0.jahr}` }, { wert: `${ggNum(j1.bedarfMwh)} MWh`, label: `Wärmebedarf ${j1.jahr}` }];
      cfg.kpiRechts = [{ wert: `${d >= 0 ? '+' : '−'}${ggNum(Math.abs(d))} MWh`, prozent: j0.bedarfMwh > 0 ? `${d >= 0 ? '+' : '−'}${ggNum(Math.abs(d / j0.bedarfMwh) * 100)} %` : undefined, label: 'Veränderung', highlight: true }];
      return `✓ ${cfg.balken.length} Stufen.`;
    },
  },
  {
    id: 'lastgang-monate', autoSync: true, reihe: 2, kapitel: '3.1 Ist-Anlagentechnik',
    titel: 'Wärmeverbrauch je Monat', datei: 'lastgang-monate',
    hinweis: 'Monatssummen des Wärmelastgangs (Messung bevorzugt), Sommermonate als Grundlast erkennbar.',
    render: cfg => ggRenderBalken(cfg),
    config: { ...ggGebVorlage('Wärmeverbrauch je Monat', 'Wärme in MWh', 'Monat', 'Kein Wärmelastgang vorhanden.'), eyebrow: 'Wärmetechnisches Gutachten' },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const l = ggLastgangWaerme();
      const m = abMonatsMwh(l.daten);
      if (!m.length) { ggGebLeer(cfg); return '⚠ Kein Wärmelastgang vorhanden.'; }
      cfg.kategorien = GG_MONATE.slice();
      cfg.gruppen = [{ label: '', segmente: [{ label: l.quelle === 'Import' ? 'Messung' : 'berechnet', farbe: GG_THEME.energy.waerme, werte: m }] }];
      cfg.punkte = null; cfg.summenLabel = true;
      const sum = m.reduce((a, b) => a + b, 0), sommer = (m[6] + m[7]) / 2;
      cfg.kpiLinks = [{ wert: `${ggNum(sum)} MWh`, label: 'Jahressumme' }];
      cfg.kpiRechts = [{ wert: `${ggNum(sommer)} MWh`, label: 'Ø Juli/August (Grundlast)', prozent: `${ggNum((sommer * 12 / sum) * 100)} %`, highlight: true }];
      return `✓ 12 Monate (${l.quelle}).`;
    },
  },
  {
    id: 'lastgang-sommerwoche', autoSync: true, reihe: 21, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Wärmelastgang einer Sommerwoche', datei: 'lastgang-sommerwoche',
    hinweis: 'Erste volle Woche im August: Tagesgang von Trinkwarmwasser und Netzverlusten ohne Raumwärme.',
    render: cfg => ggRenderGanglinie(cfg),
    config: { eyebrow: 'Wärmetechnisches Gutachten', titel: 'Wärmelastgang einer Sommerwoche', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'Leistung in kW', achseX: 'Stunden der Woche', leer: 'Kein Wärmelastgang vorhanden.', serien: [], grundlastKw: 0, kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const l = ggLastgangWaerme();
      const w = abWoche(l.daten, ggLies(() => window.getWitterung?.()?.messjahr, null) || window.globalYear);
      if (!w) { cfg.serien = []; cfg.daten = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Kein Wärmelastgang vorhanden.'; }
      cfg.serien = [{ daten: w.daten, farbe: GG_THEME.energy.waerme, breite: 2, label: `Wärmeleistung ab ${w.start.split('-').reverse().join('.')}`, fill: true }];
      cfg.xTicks = w.ticks; cfg.grundlastKw = 0;
      cfg.kpiLinks = [{ wert: `${ggNum(w.mittelKw)} kW`, label: 'mittlere Leistung' }];
      cfg.kpiRechts = [{ wert: `${ggNum(w.minKw)} – ${ggNum(w.maxKw)} kW`, label: 'Spanne', highlight: true }];
      return `✓ Woche ab ${w.start}.`;
    },
  },
  {
    id: 'lastgang-waerme-jdl', autoSync: true, reihe: 30, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Jahresdauerlinie Wärme', datei: 'jahresdauerlinie-waerme',
    hinweis: 'Sortierter Wärmelastgang mit Grenzlinien: installierte Bestandsleistung, Leistung für 65 % EE-Deckung.',
    render: cfg => ggRenderGanglinie(cfg),
    config: { eyebrow: 'Wärmetechnisches Gutachten', titel: 'Jahresdauerlinie Wärme', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'Leistung in kW', achseX: 'Stunden im Jahr, absteigend sortiert', reihe: 'Wärmeleistung', grundlastLabel: '', leer: 'Kein Wärmelastgang vorhanden.', daten: null, grundlastKw: 0, kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      cfg.kurveFarbe = GG_THEME.energy.waerme;
      const jdl = window.systemState?.jahresdauerlinie;
      if (!jdl?.length) { cfg.daten = null; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Keine Jahresdauerlinie berechnet.'; }
      cfg.daten = Array.from(jdl);
      const p65 = wtDeckungsleistung(jdl, 0.65), best = ggBestandsanlage().thermKw;
      cfg.grenzen = [
        ...(best > 0 ? [{ wert: best, label: `installierte Leistung Bestand ${ggNum(best)} kW`, farbe: '#8A8F8A' }] : []),
        ...(Number.isFinite(p65) ? [{ wert: p65, label: `65 % der Jahreswärme: ${ggNum(p65)} kW`, farbe: GG_THEME.accents.gruen, strich: '6 4' }] : []),
      ];
      const ges = cfg.daten.reduce((a, b) => a + b, 0) / 1000, pMax = cfg.daten[0];
      cfg.kpiLinks = [{ wert: `${ggNum(ges)} MWh`, label: 'Jahreswärme' }, { wert: `${ggNum(ges * 1000 / pMax)} h`, label: 'Vollbenutzungsstunden' }];
      cfg.kpiRechts = [{ wert: `${ggNum(pMax)} kW`, label: 'Spitzenlast', highlight: true }];
      return `✓ ${cfg.daten.length} Stunden.`;
    },
  },
  {
    id: 'lastgang-korrelation', autoSync: true, reihe: 41, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Wärmeleistung und Außentemperatur', datei: 'lastgang-korrelation',
    hinweis: 'Tagesmittel der Leistung über der Tagesmitteltemperatur des Messjahres (Witterung laden), Regressionsgerade der Heiztage und die Extrapolation der Spitzenlast über 22 °C Innentemperatur auf die Norm-Außentemperatur.',
    render: cfg => ggRenderXY(cfg),
    config: { eyebrow: 'Wärmetechnisches Gutachten', titel: 'Wärmeleistung und Außentemperatur', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'Leistung in kW', achseX: 'Außentemperatur (Tagesmittel) in °C', leer: 'Gemessener Lastgang und Tagestemperaturen nötig (Witterung laden).', serien: [], marken: [], kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const w = window, wb = ggLies(() => w.getWitterung?.(), {}) || {};
      const tageT = wb.ergebnis?.messjahr === wb.messjahr ? wb.ergebnis?.tageT : null;
      const norm = parseFloat(ggLies(() => w.captureWaermeGrundlagen?.()?.normAussentemp, NaN));
      const k = abKorrelation(w.systemState?.lastgangKw, tageT, norm);
      if (!k) { cfg.serien = []; cfg.marken = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Tagestemperaturen des Messjahres fehlen (🔥 Wärme-Grundlagen → Witterung laden).'; }
      cfg.serien = [
        { label: 'Tagesmittel', farbe: GG_THEME.energy.waerme, art: 'punkte', punkte: k.punkte },
        ...(k.regLinie ? [{ label: 'Regression Heiztage', farbe: '#4F7FA8', punkte: k.regLinie, strich: '6 4' }] : []),
        ...(k.spitzeLinie ? [{ label: `Extrapolation Spitzenlast (${LG_INNEN} °C)`, farbe: GG_THEME.text.strong, punkte: k.spitzeLinie, breite: 2.5 }] : []),
      ];
      const s = k.spitze;
      cfg.marken = [
        ...(s && Number.isFinite(s.tSpitze) ? [{ x: s.tSpitze, y: s.pMax, label: `Spitze ${ggNum(s.pMax)} kW`, farbe: GG_THEME.energy.waerme }] : []),
        ...(s && Number.isFinite(s.pNorm) && norm < s.tSpitze ? [{ x: norm, y: s.pNorm, label: `${ggNum(s.pNorm)} kW bei ${ggNum(norm, 1)} °C`, farbe: GG_THEME.text.strong }] : []),
      ];
      cfg.kpiLinks = [{ wert: Number.isFinite(k.bestimmtheit) ? ggNum(k.bestimmtheit, 2) : '—', label: 'Bestimmtheitsmaß R² (Heiztage)' }];
      cfg.kpiRechts = [{ wert: Number.isFinite(s?.pNorm) ? `${ggNum(s.pNorm)} kW` : '—', label: 'Auslegungsheizlast', highlight: true }];
      return `✓ ${k.punkte.length} Tage.`;
    },
  },
  {
    id: 'lastgang-deckungskurve', autoSync: true, reihe: 51, kapitel: '3.2.5 Dimensionierung WEA',
    titel: 'Erzeugerleistung und Deckungsanteil', datei: 'lastgang-deckungskurve',
    hinweis: 'Aus der Jahresdauerlinie: Anteil der Jahreswärme, den eine Grundlastleistung abdeckt; Marken bei 65 % und 90 %.',
    render: cfg => ggRenderXY(cfg),
    config: { eyebrow: 'Wärmetechnisches Gutachten', titel: 'Erzeugerleistung und Deckungsanteil', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'Anteil an der Jahreswärme in %', achseX: 'installierte Grundlastleistung in kW', leer: 'Keine Jahresdauerlinie berechnet.', serien: [], marken: [], yMax: 100, kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const jdl = window.systemState?.jahresdauerlinie;
      const k = abDeckungsKurve(jdl);
      if (!k.length) { cfg.serien = []; cfg.marken = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Keine Jahresdauerlinie berechnet.'; }
      const pMax = k.at(-1).x;
      cfg.serien = [{ label: 'Deckungsanteil', farbe: GG_THEME.energy.waerme, punkte: k, breite: 2.5 }];
      cfg.legendeLinks = false;
      const m = [65, 90].map(q => ({ q, kw: wtDeckungsleistung(jdl, q / 100) })).filter(x => Number.isFinite(x.kw));
      cfg.marken = m.map(x => ({ x: x.kw, y: x.q, label: `${x.q} %: ${ggNum(x.kw)} kW (${ggNum((x.kw / pMax) * 100)} % der Spitze)`, farbe: GG_THEME.text.strong }));
      cfg.legendeLinks = true;
      cfg.kpiLinks = m.map(x => ({ wert: `${ggNum(x.kw)} kW`, label: `für ${x.q} % der Jahreswärme` }));
      cfg.kpiRechts = [{ wert: `${ggNum(pMax)} kW`, label: 'Spitzenlast (100 %)', highlight: true }];
      return '✓ Deckungskurve berechnet.';
    },
  },
  {
    id: 'verbrauch-aufteilung-text', istText: true, reihe: 50, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Gutachtentext: Aufteilung des Verbrauchs auf die Gebäude', datei: 'verbrauch-aufteilung-text',
    hinweis: 'Nur mit Messung: gemessener Gesamtverbrauch abzüglich Kessel- (Brennstoffzähler) und Netzverlusten, verteilt im Verhältnis der Gebäudewerte. Messpunkt unter 🔥 Bestandsanlage.',
    render: () => { const r = ggVerbrauchsaufteilung(); return ggWaermeTextBlatt(vbTextAufteilung(r, { quelle: r?.quelle })); }, config: {},
  },
  {
    id: 'verbrauch-aufteilung-tabelle', autoSync: true, reihe: 51, kapitel: '3.2.4 Jahresvergleich der Daten',
    titel: 'Aufteilung des gemessenen Verbrauchs auf die Gebäude', datei: 'verbrauch-aufteilung-tabelle',
    hinweis: 'Gebäudewert, verteilter Verbrauch, spezifischer Wert und Vergleichswert; Bilanz Messung → Verluste → Nutzwärme in der Fußnote.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Wärmetechnisches Gutachten', titel: 'Aufteilung des gemessenen Verbrauchs auf die Gebäude', leer: 'Keine Messung oder keine Gebäudewerte.', spalten: [{ label: 'Gebäude', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const r = ggVerbrauchsaufteilung();
      cfg.spalten = [{ label: 'Gebäude', weight: 2.4, align: 'left', mono: false }, { label: 'BGF', weight: 1 }, { label: 'Gebäudewert', weight: 1.1 }, { label: 'verteilt', weight: 1.1 }, { label: 'spez. verteilt', weight: 1.2 }, { label: 'Vergleichswert', weight: 1.2 }];
      if (!r) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Messung (Lastgang oder Verbrauchsdaten) oder keine Gebäudewerte.'; }
      const Z = 25, kw = v => (Number.isFinite(v) ? ggNum(v) + ' kWh/m²' : '—');
      cfg.zeilen = r.zeilen.slice(0, Z).map(z => ({ werte: [z.name, z.bgfM2 > 0 ? ggNum(z.bgfM2) + ' m²' : '—', ggNum(z.modellMwh) + ' MWh', ggNum(z.mwh) + ' MWh', kw(z.spez), kw(z.referenzSpez)] }));
      const rest = r.zeilen.slice(Z);
      if (rest.length) cfg.zeilen.push({ werte: [`weitere ${rest.length} Gebäude`, '', ggNum(rest.reduce((a, z) => a + z.modellMwh, 0)) + ' MWh', ggNum(rest.reduce((a, z) => a + z.mwh, 0)) + ' MWh', '', ''] });
      cfg.zeilen.push({ highlight: true, werte: [`Summe ${r.zeilen.length} Gebäude`, '', ggNum(r.modellMwh) + ' MWh', ggNum(r.nutzMwh) + ' MWh', `Faktor ${ggNum(r.faktor, 2)}`, ''] });
      cfg.fussnote = `Messung ${ggNum(r.messungMwh)} MWh (${r.quelle})` + (r.kesselverlustMwh > 0 ? ` − Kesselverluste ${ggNum(r.kesselverlustMwh)} MWh (η ${ggNum(r.eta * 100)} %)` : '')
        + (r.netzverlustMwh > 0 ? ` − Netzverluste ${ggNum(r.netzverlustMwh)} MWh` : '') + ` = Nutzwärme ${ggNum(r.nutzMwh)} MWh · Verteilung im Verhältnis der Gebäudewerte`;
      return `✓ ${r.zeilen.length} Gebäude, Faktor ${ggNum(r.faktor, 2)}.`;
    },
  },
  {
    id: 'potenzial-lwwp-sweep', autoSync: true, reihe: 42, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Luft-Wasser-Wärmepumpe: Vergleich der Deckungsgrade', datei: 'potenzial-lwwp-sweep',
    hinweis: 'Stundensimulation mit Außentemperatur und Heizkurve für 65, 90, 99 und 100 % Deckung: erforderliche Nennleistung, Leistung in der kältesten Stunde, JAZ, Umweltwärme, Strom und verbleibende Spitzenlast.',
    render: cfg => ggRenderTabelle(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Luft-Wasser-Wärmepumpe: Vergleich der Deckungsgrade', leer: 'Lastgang mit Außentemperatur nötig (Grundlage berechnen).', spalten: [{ label: 'Kennwert', weight: 1, align: 'left', mono: false }], zeilen: [], fussnote: '' },
    ausProjekt(cfg) {
      const r = ggLwwpSweep().filter(x => x.erreichbar);
      if (!r.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Lastgang mit Außentemperatur nötig.'; }
      cfg.spalten = [{ label: 'Kennwert', weight: 2.2, align: 'left', mono: false }, ...r.map(x => ({ label: `${x.ziel} % Deckung`, weight: 1.2 }))];
      const z = (l, f) => ({ werte: [l, ...r.map(f)] });
      cfg.zeilen = [
        z('Nennleistung (A2/W35)', x => `${ggNum(x.nennKw)} kW`), z(`Leistung in der kältesten Stunde (${ggNum(r[0].tKaltC, 1)} °C)`, x => `${ggNum(x.leistungKaltKw)} kW`),
        z('Jahresarbeitszahl', x => ggNum(x.jaz, 2)), z('Wärme aus Wärmepumpe', x => `${ggNum(x.waermeMwh)} MWh`), z('davon Umweltwärme', x => `${ggNum(x.umweltMwh)} MWh`),
        z('Strombedarf', x => `${ggNum(x.stromMwh)} MWh`), z('Spitzenlasterzeuger Wärme', x => `${ggNum(x.spitzeMwh)} MWh`), { highlight: true, werte: ['Spitzenlasterzeuger Leistung', ...r.map(x => (x.restMaxKw < 1 ? 'entfällt' : `${ggNum(x.restMaxKw)} kW`))] },
      ];
      const nicht = ggLwwpSweep().filter(x => !x.erreichbar).map(x => `${x.ziel} %`);
      cfg.fussnote = 'COP = Gütegrad × T_VL/(T_VL − T_Luft), höchstens 8; Leistung = Nennleistung × COP/COP(A2/W35); Vorlauf aus der Heizkurve der Wärme-Grundlagen'
        + (nicht.length ? ` · nicht erreichbar (Mindest-COP): ${nicht.join(', ')}` : '');
      return `✓ ${r.length} Deckungsgrade.`;
    },
  },
  {
    id: 'potenzial-lwwp-jdl', autoSync: true, reihe: 43, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Luft-Wasser-Wärmepumpe: Grund- und Spitzenlast', datei: 'potenzial-lwwp-jdl',
    hinweis: 'Jahresdauerlinie des Wärmebedarfs mit dem Anteil der Luft-WP (aktuelle Leistung aus dem Luft-WP-Panel) und ihrer elektrischen Leistung, nach Wärmebedarf sortiert.',
    render: cfg => ggRenderGanglinie(cfg),
    config: { eyebrow: 'Potenzialanalyse', titel: 'Luft-Wasser-Wärmepumpe: Grund- und Spitzenlast', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'Leistung in kW', achseX: 'Stunden im Jahr, nach Wärmebedarf sortiert', leer: 'Luft-WP und Lastgang mit Außentemperatur nötig.', serien: [], grundlastKw: 0, kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const ss = window.systemState, kw = ggLies(() => window.lwWp?.leistungKw, 0);
      const r = kw > 0 ? abLwwpSimulation({ ...ggLwwpEingaben(), nennKw: kw, stunden: true }) : null;
      if (!r) { cfg.serien = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ Luft-WP und Lastgang mit Außentemperatur nötig.'; }
      const idx = Array.from({ length: 8760 }, (_, i) => i).sort((a, b) => ss.lastgangKw[b] - ss.lastgangKw[a]);
      // Mittel über je 12 sortierte Stunden: 730 Stützstellen reichen für die Linie und halten das SVG klein
      const zeige = arr => Array.from({ length: 730 }, (_, k) => { let x = 0; for (let j = k * 12; j < k * 12 + 12; j++) x += arr[idx[j]]; return x / 12; });
      cfg.serien = [
        { daten: zeige(ss.lastgangKw), farbe: GG_THEME.energy.waerme, breite: 1.5, label: 'Wärmebedarf (Spitzenlast = Differenz)' },
        { daten: zeige(r.wpH), farbe: '#4F7FA8', breite: 1.2, label: 'Wärme aus Luft-WP', fill: true },
        { daten: zeige(r.elH), farbe: '#C9A227', breite: 1.2, label: 'elektrische Leistung Luft-WP' },
      ];
      cfg.xTicks = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000].map(p => ({ pos: p / 12, label: ggNum(p) }));
      cfg.kpiLinks = [{ wert: `${ggNum(r.deckungPct)} %`, label: `Deckung Luft-WP (${ggNum(kw)} kW)` }, { wert: ggNum(r.jaz, 2), label: 'Jahresarbeitszahl' }];
      cfg.kpiRechts = [{ wert: `${ggNum(r.restMaxKw)} kW`, label: 'Spitzenlasterzeuger', highlight: true }];
      return `✓ ${ggNum(kw)} kW Luft-WP simuliert.`;
    },
  },
  {
    id: 'potenzial-schall-abstaende', autoSync: true, reihe: 52, kapitel: '4.2 Berücksichtigte Potenziale',
    titel: 'Mindestabstände Luft-WP nach TA Lärm', datei: 'potenzial-schall-abstaende',
    hinweis: 'Freifeldabstand (Halbkugel), in dem der Immissionsrichtwert tags und nachts eingehalten wird; Schallleistungspegel aus dem Luft-WP-Panel.',
    render: cfg => ggRenderBalken(cfg),
    config: { ...ggGebVorlage('Mindestabstände Luft-WP nach TA Lärm', 'Abstand in m', 'Gebietsart', 'Kein Schallleistungspegel eingetragen.'), eyebrow: 'Potenzialanalyse' },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const lwa = ggPotenzialDaten().lwwp.lwaDb;
      const r = abSchallAbstaende(lwa);
      if (!r.length) { ggGebLeer(cfg); return '⚠ Kein Schallleistungspegel (Luft-WP-Panel).'; }
      cfg.kategorien = r.map(x => x.gebiet.replace(' Wohngebiet', ' WG').replace('Kern-, Dorf-, Mischgebiet', 'Misch-/Dorfgebiet'));
      cfg.gruppen = [{ label: '', segmente: [{ label: 'tags', farbe: '#C9A227', werte: r.map(x => x.rTag) }] }, { label: '', segmente: [{ label: 'nachts', farbe: '#2F4858', werte: r.map(x => x.rNacht) }] }];
      cfg.punkte = null; cfg.summenLabel = true;
      cfg.kpiLinks = [{ wert: `${ggNum(lwa)} dB(A)`, label: 'Schallleistungspegel' }];
      cfg.kpiRechts = [{ wert: `${ggNum(r.find(x => x.nacht === 40)?.rNacht)} m`, label: 'allg. Wohngebiet nachts (40 dB(A))', highlight: true }];
      return `✓ ${r.length} Gebietsarten.`;
    },
  },
  {
    id: 'va-emissionen', autoSync: true, reihe: 45, kapitel: '7.1 Klimarelevanz',
    titel: 'CO₂e-Emissionen heute und künftig', datei: 'va-emissionen',
    hinweis: 'Jährliche Emissionen je Variante mit heutigem und mittlerem künftigem Strom-Emissionsfaktor, Bestand als Referenz.',
    render: cfg => ggRenderBalken(cfg),
    config: { ...ggGebVorlage('CO₂e-Emissionen heute und künftig', 't CO₂e pro Jahr', 'Variante', 'Keine Varianten mit Emissionen.'), eyebrow: 'Variantenvergleich' },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const d = ggVariantenDaten();
      const v = d.varianten.filter(x => Number.isFinite(x.co2T));
      if (!v.length) { ggGebLeer(cfg); return '⚠ Keine Varianten mit Emissionen.'; }
      const best = Number.isFinite(d.bestandCo2T) && d.bestandCo2T > 0;
      cfg.kategorien = [...(best ? ['Bestand'] : []), ...v.map(x => x.name)];
      cfg.gruppen = [
        { label: '', segmente: [{ label: 'heute', farbe: '#7A6334', werte: [...(best ? [d.bestandCo2T] : []), ...v.map(x => x.co2T)] }] },
        { label: '', segmente: [{ label: `Ø ${VA_STROM_EF.von}–${VA_STROM_EF.bis}`, farbe: '#6B8E4E', werte: [...(best ? [0] : []), ...v.map(x => (Number.isFinite(x.co2LzT) ? x.co2LzT : 0))] }] },
      ];
      cfg.punkte = null; cfg.summenLabel = true;
      const min = [...v].sort((a, b) => (a.co2LzT ?? a.co2T) - (b.co2LzT ?? b.co2T))[0];
      cfg.kpiLinks = [{ wert: `${ggNum(d.ef.strom)} / ${ggNum(d.ef.stromLz)} g/kWh`, label: 'Strom-EF heute / künftig' }];
      cfg.kpiRechts = [{ wert: `${min.name}: ${ggNum(min.co2LzT ?? min.co2T)} t/a`, label: 'geringste Emissionen künftig', highlight: true }];
      return `✓ ${v.length} Varianten.`;
    },
  },
  {
    id: 'va-emissionen-kumuliert', autoSync: true, reihe: 46, kapitel: '7.1 Klimarelevanz',
    titel: `Kumulierte Emissionen ${VA_STROM_EF.von}–${VA_STROM_EF.bis}`, datei: 'va-emissionen-kumuliert',
    hinweis: 'Summe über 20 Jahre mit dem mittleren künftigen Strom-Emissionsfaktor; Referenz: Wärmebedarf vollständig aus Erdgas.',
    render: cfg => ggRenderBalken(cfg),
    config: { ...ggGebVorlage('Kumulierte Emissionen', 't CO₂e über 20 Jahre', 'Variante', 'Keine Varianten mit Emissionen.'), eyebrow: 'Variantenvergleich' },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      cfg.titel = `Kumulierte Emissionen ${VA_STROM_EF.von}–${VA_STROM_EF.bis}`;
      const d = ggVariantenDaten();
      const v = d.varianten.filter(x => Number.isFinite(x.co2LzT));
      if (!v.length) { ggGebLeer(cfg); return '⚠ Keine Varianten mit künftigen Emissionen.'; }
      const jahre = VA_STROM_EF.bis - VA_STROM_EF.von;
      const gasRef = d.gesamtMwh > 0 && d.ef.gas > 0 ? (d.gesamtMwh / (d.eta.gaskessel || 0.92)) * d.ef.gas / 1000 * jahre : NaN;
      cfg.kategorien = [...v.map(x => x.name), ...(Number.isFinite(gasRef) ? ['nur Erdgas'] : [])];
      cfg.gruppen = [{ label: '', segmente: [
        { label: 'Varianten', farbe: '#6B8E4E', werte: [...v.map(x => x.co2LzT * jahre), ...(Number.isFinite(gasRef) ? [0] : [])] },
        ...(Number.isFinite(gasRef) ? [{ label: 'Referenz Erdgas', farbe: '#8A8F8A', werte: [...v.map(() => 0), gasRef] }] : []),
      ] }];
      cfg.punkte = null; cfg.summenLabel = true;
      const min = [...v].sort((a, b) => a.co2LzT - b.co2LzT)[0];
      cfg.kpiLinks = [{ wert: `${jahre} Jahre`, label: 'Betrachtungszeitraum' }];
      cfg.kpiRechts = [{ wert: `${ggNum(min.co2LzT * jahre)} t`, label: `geringste Summe: ${min.name}`, highlight: true }];
      return `✓ ${v.length} Varianten.`;
    },
  },
  {
    id: 'va-kostenstruktur', autoSync: true, reihe: 20, kapitel: '7.2 Wirtschaftlichkeit und Investitionskosten',
    titel: 'Zusammensetzung der Wärmegestehungskosten', datei: 'va-kostenstruktur',
    hinweis: 'Kapital-, Betriebs-, Energie- und CO₂-Kosten sowie PV/Batterie je Variante in ct/kWh. Nach einer Änderung im Variantenvergleich „Alle aktualisieren“.',
    render: cfg => ggRenderBalken(cfg),
    config: { ...ggGebVorlage('Zusammensetzung der Wärmegestehungskosten', 'ct/kWh', 'Variante', 'Keine Varianten mit Kostenaufteilung – Varianten aktualisieren.'), eyebrow: 'Variantenvergleich' },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const r = abKostenstruktur(ggVariantenDaten().varianten);
      if (!r.length) { ggGebLeer(cfg); return '⚠ Keine Kostenaufteilung – im Variantenvergleich „Alle aktualisieren“.'; }
      cfg.kategorien = r.map(x => x.name);
      const seg = (k, label, farbe) => ({ label, farbe, werte: r.map(x => Math.max(0, x[k])) });
      cfg.gruppen = [{ label: '', segmente: [seg('kapital', 'Kapitalkosten', '#2F4858'), seg('betrieb', 'Betriebskosten', '#6B8E4E'), seg('energie', 'Energiekosten', '#C9A227'), seg('co2', 'CO₂-Kosten', '#7A6334'), seg('pv', 'PV/Batterie', '#E0A126')].filter(x => x.werte.some(v => v > 0.005)) }];
      cfg.punkte = null; cfg.summenLabel = true; cfg.summenDez = 1;
      const b = [...r].sort((a, c) => a.summe - c.summe)[0];
      cfg.kpiLinks = [{ wert: `${r.length} Varianten`, label: 'verglichen' }];
      cfg.kpiRechts = [{ wert: `${b.name}: ${ggNum(b.summe, 1)} ct/kWh`, label: 'geringste Wärmegestehungskosten', highlight: true }];
      return `✓ ${r.length} Varianten.`;
    },
  },
  {
    id: 'va-pv-grafik', autoSync: true, reihe: 31, kapitel: '7.2.1 Wirtschaftlichkeit mit PV-Eigenstrom',
    titel: 'Wärmegestehungskosten mit und ohne PV-Eigenstrom', datei: 'va-pv-grafik',
    hinweis: 'Je Variante ohne PV (voller Netzbezug) und mit PV-Eigenstrom (inkl. PV-Annuität abzüglich Einspeisevergütung).',
    render: cfg => ggRenderBalken(cfg),
    config: { ...ggGebVorlage('Wärmegestehungskosten mit und ohne PV-Eigenstrom', 'ct/kWh', 'Variante', 'Keine Varianten mit Kostenaufteilung – Varianten aktualisieren.'), eyebrow: 'Variantenvergleich' },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const r = abPvVergleich(ggVariantenDaten().varianten);
      if (!r.length) { ggGebLeer(cfg); return '⚠ Keine Kostenaufteilung – im Variantenvergleich „Alle aktualisieren“.'; }
      cfg.kategorien = r.map(x => x.name);
      cfg.gruppen = [{ label: '', segmente: [{ label: 'ohne PV-Eigenstrom', farbe: '#8A8F8A', werte: r.map(x => x.ohneCt) }] }, { label: '', segmente: [{ label: 'mit PV-Eigenstrom', farbe: '#C9A227', werte: r.map(x => x.mitCt) }] }];
      cfg.punkte = null; cfg.summenLabel = true; cfg.summenDez = 1;
      const b = [...r].sort((a, c) => (c.ohneCt - c.mitCt) - (a.ohneCt - a.mitCt))[0];
      cfg.kpiLinks = [{ wert: `${ggNum(ggLies(() => parseFloat(document.getElementById('pv-kwp')?.value), 0))} kWp`, label: 'PV-Leistung' }];
      cfg.kpiRechts = [{ wert: `${b.name}: −${ggNum(b.ohneCt - b.mitCt, 2)} ct/kWh`, label: 'größte Entlastung', highlight: true }];
      return `✓ ${r.length} Varianten.`;
    },
  },
  {
    id: 'fazit-nt-grafik', autoSync: true, reihe: 46, kapitel: '9.1 Wärmeversorgung',
    titel: 'Hoch- und Niedertemperaturbetrieb im Vergleich', datei: 'fazit-nt-grafik',
    hinweis: 'Kumulierte Kosten über 20 Jahre: Stromkosten im HT-Betrieb gegenüber NT-Betrieb plus Ertüchtigungskosten; Schnittpunkt = Amortisation.',
    render: cfg => ggRenderXY(cfg),
    config: { eyebrow: 'Fazit Wärme', titel: 'Hoch- und Niedertemperaturbetrieb im Vergleich', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: 'kumulierte Kosten in Mio. €', achseX: 'Betriebsjahre', leer: 'WP-Wärme, Vorlauftemperaturen und Strompreis nötig.', serien: [], marken: [], legendeLinks: true, kpiLinks: [], kpiRechts: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      const r = ggNtVergleich();
      if (!r) { cfg.serien = []; cfg.marken = []; cfg.kpiLinks = []; cfg.kpiRechts = []; return '⚠ WP-Wärme, Vorlauftemperaturen und Strompreis nötig.'; }
      const J = Array.from({ length: r.jahre + 1 }, (_, j) => j);
      cfg.serien = [
        { label: `Hochtemperatur (JAZ ${ggNum(r.jazHt, 2)})`, farbe: '#C0392B', punkte: J.map(j => ({ x: j, y: (r.kostenHt * j) / 1e6 })), breite: 2.5 },
        { label: `Niedertemperatur (JAZ ${ggNum(r.jazNt, 2)}) inkl. Ertüchtigung`, farbe: '#6B8E4E', punkte: J.map(j => ({ x: j, y: (r.invest + r.kostenNt * j) / 1e6 })), breite: 2.5 },
      ];
      cfg.marken = r.invest > 0 && Number.isFinite(r.amortJahre) && r.amortJahre <= r.jahre ? [{ x: r.amortJahre, y: (r.kostenHt * r.amortJahre) / 1e6, label: `Amortisation nach ${ggNum(r.amortJahre, 1)} Jahren`, farbe: GG_THEME.text.strong }] : [];
      cfg.kpiLinks = [{ wert: `${ggNum(r.ersparnis / 1000)} T€/a`, label: 'Stromkosteneinsparung' }, { wert: `${ggNum(r.invest / 1e6, 2)} Mio. €`, label: 'Ertüchtigung' }];
      cfg.kpiRechts = [{ wert: `${ggNum(r.netto / 1e6, 1)} Mio. €`, label: `Nettovorteil nach ${r.jahre} Jahren`, highlight: true }, ...(Number.isFinite(r.co2Kum) ? [{ wert: `${ggNum(r.co2Kum)} t`, label: 'vermiedene CO₂e (kumuliert)' }] : [])];
      return '✓ HT/NT gegenübergestellt.';
    },
  },
  {
    id: 'fazit-fahrplan-gantt', autoSync: true, reihe: 51, kapitel: '9.1 Wärmeversorgung',
    titel: 'Maßnahmenfahrplan', datei: 'fazit-fahrplan-gantt',
    hinweis: 'Zeitliche Abfolge der Maßnahmen ab dem Folgejahr – gleiche Zeitspannen wie der Fahrplantext.',
    render: cfg => ggRenderGantt(cfg),
    config: { eyebrow: 'Fazit Wärme', titel: 'Maßnahmenfahrplan', ort: '', meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' }, achseY: '', achseX: 'Jahr', leer: 'Keine Maßnahmen.', phasen: [] },
    ausProjekt(cfg) {
      ggGebKopf(cfg);
      cfg.phasen = abFahrplanPhasen();
      return `✓ ${cfg.phasen.length} Maßnahmen.`;
    },
  },

  // ── Jahresdauerlinie Strom ──────────────────────────────────────────────
  {
    id: 'lastgang-strom-dauerlinie',
    autoSync: true,
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.2 Stromverbrauchsdaten',
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
    kapitel: '5.4.1 Netzanschluss und internes Stromnetz',
    titel: 'Entwicklung der Anschlussleistung',
    datei: 'anschlussleistung-entwicklung',
    hinweis: 'Höchstlast am Liegenschaftsanschluss über den Planungshorizont, gegen Anschlusswert und '
           + 'Einspeisezusage. „Aus Projekt übernehmen“ startet dafür den Engpass-Sweep — das rechnet '
           + 'das Netz für jedes Stützjahr durch und dauert einen Moment. Rechnet über das Netzmodell '
           + '(Trafo-Spitzen) und weicht deshalb von der resultierenden Anschlussleistung in 5.3.4 ab.',
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
    kapitel: '5.1.1 Liegenschaftsstromnetzanschluss',
    titel: 'Gutachtentext: Netzanschluss',
    datei: 'netzanschluss-text',
    hinweis: 'Standardtext für den Ist-Zustand des Netzanschlusses. Grün hinterlegte Angaben sind eingetragen, gelb '
           + 'hinterlegte Platzhalter fehlen noch. Eingetragen werden sie unter ⚡ Strom-Grundlagen › Netzanschluss; '
           + '„⟳ Aus Projekt übernehmen“ liest Spannungsebene und Übergabepunkt-Gebäude aus dem NAP-Asset des '
           + 'Elektro-Tabs, sofern eines platziert ist. Die Empfehlung zum Netzanschlussantrag steht als eigener '
           + 'Baustein in 5.4.1.',
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
    kapitel: '5.4.1 Netzanschluss und internes Stromnetz',
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
      // Heißt das Standortgebäude schon „Trafostation 3“ (oder „TST 3“, „Kompaktstation 3“),
      // gewinnt dieser Name — auch wenn er dann in der Gebäudespalte noch einmal steht; sonst
      // wird unten in Tabellenreihenfolge durchnummeriert. Tabelle, Übersichtsschaltbild und
      // Resilienz nennen die Station so gleich.
      stationName: GG_STATION_NAME.test(g?.name || '') ? String(g.name).trim() : '',
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

  // Durchnummeriert werden nur Stationen ohne eigenen Namen, und zwar mit Nummern, die kein
  // benanntes Standortgebäude schon trägt — sonst hieß „Trafostation 1“ zweimal. Benannte
  // Stationen behalten ihren Namen; ihr Eintrag in `nr` zählt nur für die Stationsanzahl.
  const belegt = new Set(zeilen.filter(z => z.stationName).map(z => ggNummerAusName(z.stationName)).filter(n => n != null));
  const nr = new Map();
  let n = 0;
  for (const z of zeilen) {
    if (nr.has(z.stationKey)) continue;
    if (z.stationName) { nr.set(z.stationKey, ggNummerAusName(z.stationName)); continue; }
    do n++; while (belegt.has(n));
    nr.set(z.stationKey, n);
  }
  for (const z of zeilen) z.station = z.stationName || 'Trafostation ' + nr.get(z.stationKey);
  return { zeilen, nr };
}

const GG_STATION_NAME = /station|^\s*(TST|TS|TrSt)\s*[-.]?\s*\d/i;
/** Endnummer einer Stationsbezeichnung: „Trafostation 12“ → 12, „TST 4a“ → 4. */
function ggNummerAusName(s) {
  const m = /(\d+)\s*[a-z]?\s*$/i.exec(String(s || ''));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Trafostationen des Ist-Bestands, eine je Station (nicht je Trafo) — für den Gutachten-Editor,
 * der daraus je Station einen Freitext-Platzhalter anlegt (s. gutAddTrafoDummies in 21).
 * @returns {{label:string, gebLabel:string}[]}
 */
export function ggTrafostationenIstListe() {
  let trafos = [];
  try { trafos = window.listAssets?.({ type: 'Trafo' }) || []; } catch (e) { void e; }
  const { zeilen } = ggTrafoZeilen(trafos, { nurBestand: true });
  const gesehen = new Set();
  const out = [];
  for (const z of zeilen) {
    if (gesehen.has(z.stationKey)) continue;
    gesehen.add(z.stationKey);
    out.push({
      label: z.station,
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
    kapitel: '5.1.2 Stromnetz intern (MS/NS)',
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
    kapitel: '5.1.2 Stromnetz intern (MS/NS)',
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
                z.station,
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
    kapitel: '5.4.1 Netzanschluss und internes Stromnetz',
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
                z.station,
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

/* ── 3.1.1 Prinzipskizze Übergabe und Messkonzept ──────────────────────────────
 * Aus den Netzanschluss-Stammdaten (⚡ Strom-Grundlagen › Netzanschluss), den Messjahren
 * (BHKW-Lastgang) und den Erzeugern im Bestand. Drei Varianten: MS-Anschluss mit Messung am
 * Übergabefeld, MS-Anschluss mit Messung hinter dem Transformator, NS-Anschluss am
 * Hausanschlusskasten. Legende und Nummern wie die EZA-Skizze (3.4.2). */

/** Werte der Skizze aus dem Projekt — alles über window, 17 bleibt Blatt im Importgraph. */
function ggMesskonzeptWerte() {
  let napKV = null;
  try { napKV = Number(window.listAssets?.({ type: 'NAP' })?.[0]?.props?.spannungKV) || null; } catch (e) { void e; }
  const spText = String(window.naSpannungsebene || '').trim();
  const ns = /nieder/i.test(spText) || (!/mittel/i.test(spText) && napKV > 0 && napKV <= 1);
  const kvAusText = ggKvAusText(spText);
  const uKv = ns ? null : (kvAusText || napKV);
  const einsp = (window.naEinspeisungen || []).filter(e => String(e?.station || '').trim() || String(e?.kabeltyp || '').trim())
    .map(e => ({ station: String(e.station || '').trim(), kabeltyp: String(e.kabeltyp || '').trim() }));
  const { bestand } = ggAnlagenIst(['PV', 'KWK', 'Wind', 'Batterie']);
  const summe = (typ, feld) => bestand.filter(e => e.a.type === typ).reduce((s, e) => s + (ggPropZahl(e.p[feld]) || 0), 0);
  const anzahl = typ => bestand.filter(e => e.a.type === typ).length;
  let mjBhkw = false;
  try { mjBhkw = !!window.sgMjDaten?.()?.jahre?.some(j => j.bhkw); } catch (e) { void e; }
  const mv = String(window.naMessverfahren || '');
  const einspKw = Number(window.elNapMaxEinspKw) > 0 ? Number(window.elNapMaxEinspKw) : null;
  const erzeuger = anzahl('PV') + anzahl('KWK') + anzahl('Wind') > 0 || mjBhkw;
  return {
    nb: String(window.naNetzbetreiberName || '').trim(), spText, uKv, ns,
    einsp, uebergabe: String(window.naUebergabepunkt || '').trim(),
    messort: window.naMessort === 'ms' || window.naMessort === 'ns' ? window.naMessort : '',
    verfahren: /\(RLM\)/.test(mv) ? 'RLM' : /\(SLP\)/.test(mv) ? 'SLP' : '',
    zweirichtung: einspKw > 0 || erzeuger,
    anschlussKva: Number(window.elNapMaxBezugKw) > 0 ? Number(window.elNapMaxBezugKw) : null, einspKw,
    bhkw: anzahl('KWK') || mjBhkw ? { kw: summe('KWK', 'leistungElKW'), lastgang: mjBhkw } : null,
    pv: anzahl('PV') ? { kwp: summe('PV', 'leistungKWp'), anzahl: anzahl('PV') } : null,
    wind: anzahl('Wind') ? { kw: summe('Wind', 'leistungKW') } : null,
  };
}

/** „Mittelspannung (20 kV)“ → 20; ohne kV-Angabe null. */
function ggKvAusText(t) {
  const m = /(\d+(?:[.,]\d+)?)\s*kV/i.exec(String(t || ''));
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

/** Nummerierte Erläuterungen der Skizze — dieselbe Reihenfolge wie die Nummern im Bild. */
function ggMesskonzeptPunkte(w) {
  const nbDer = w.nb ? `der ${w.nb}` : 'des Netzbetreibers';
  const stationen = w.einsp.map(e => e.station).filter(Boolean);
  const kabel = [...new Set(w.einsp.map(e => e.kabeltyp).filter(Boolean))];
  // „UW Beelitz“, „Ortsnetzstation Süd“ tragen die Art schon im Namen — sonst „Station …“ davor
  const stName = s => (/station|^uw\b|umspann/i.test(s) ? s : `Station ${s}`);
  const herkunft = stationen.length
    ? ` aus ${stationen.map(stName).join(stationen.length === 2 ? ' und ' : ', ')}` : '';
  const zaehler = `${w.verfahren === 'RLM' ? 'RLM-Zähler' : w.verfahren === 'SLP' ? 'Zähler (Standardlastprofil)' : 'Zähler'} `
    + (w.zweirichtung ? 'für Bezug und Lieferung (Zweirichtung)' : 'für den Bezug');
  const datenweg = w.verfahren === 'RLM'
    ? 'Fernauslesung durch den Messstellenbetreiber: 15-Minuten-Lastgang für Abrechnung und Netznutzung – Grundlage der Auswertung in Kapitel 5.2'
    : w.verfahren === 'SLP' ? 'Ablesung durch den Messstellenbetreiber: Jahresarbeit, Abrechnung nach Standardlastprofil'
      : 'Aus- bzw. Ablesung durch den Messstellenbetreiber (Messverfahren laut Netzanschlussvertrag)';
  const unter = [
    w.bhkw ? `Erzeugungszähler BHKW${w.bhkw.lastgang ? ' – sein Lastgang wird in Kapitel 5.2 zum Bezug addiert' : ''}` : '',
    w.pv ? 'Erzeugungszähler PV' : '', w.wind ? 'Erzeugungszähler Windenergie' : '',
  ].filter(Boolean);
  const p = [];
  if (w.ns) {
    p.push(`Einspeisung aus dem Niederspannungsnetz ${nbDer}${herkunft}${kabel.length ? ` (${kabel.join(', ')})` : ''}`);
    p.push('Hausanschlusskasten mit Anschlusssicherungen: Eigentumsgrenze zum Netzbetreiber');
    p.push(`Abrechnungsmessung: ${zaehler}, bei großen Strömen über Stromwandler`);
  } else {
    p.push(`Einspeisung aus dem ${w.uKv ? ggNum(w.uKv, w.uKv % 1 ? 1 : 0) + '-kV-' : ''}Mittelspannungsnetz ${nbDer}: `
      + `${w.einsp.length > 1 ? `${ggNum(w.einsp.length)} Netzkabel` : 'Netzkabel'}${herkunft}${kabel.length ? ` (${kabel.join(', ')})` : ''}`);
    p.push('Eigentumsgrenze laut Netzanschlussvertrag, in der Regel an den Kabelendverschlüssen der Netzkabel in der Übergabestation');
    p.push('Kabelfelder mit Lasttrennschaltern und MS-Sammelschiene der Übergabestation'
      + (w.einsp.length > 1 ? '; mehrere Einspeisungen erlauben die Umschaltung bei Ausfall eines Netzkabels' : ''));
    p.push('Übergabeschaltfeld: Leistungsschalter mit Netzschutz (UMZ), trennt das Liegenschaftsnetz bei einem Fehler vom Netz');
    if (w.messort === 'ns') {
      p.push(`Transformator der Übergabestation; Abrechnungsmessung niederspannungsseitig mit Stromwandlern und ${zaehler} – `
        + 'die Transformatorverluste werden rechnerisch zugeschlagen');
    } else {
      p.push(`Abrechnungsmessung ${w.messort === 'ms' ? 'mittelspannungsseitig' : '(Messort laut Netzanschlussvertrag)'}: `
        + `Strom- und Spannungswandler, ${zaehler}`);
    }
  }
  p.push(datenweg);
  if (unter.length) p.push(`Unterzählung im Liegenschaftsnetz: ${unter.join('; ')}`);
  return p;
}

export function ggRenderMesskonzept(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, hell = T.accents.gruen, rot = T.energy.waerme, blau = T.energy.strom;
  const strich = T.text.strong, fein = T.text.faint;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const w = cfg.werte || { einsp: [] };
  const x0 = S.padX, x1 = W - S.padX;
  const nsAnschluss = !!w.ns, nsMessung = !nsAnschluss && w.messort === 'ns';
  const einsp = (w.einsp?.length ? w.einsp : [{ station: '', kabeltyp: '' }]).slice(0, nsAnschluss ? 1 : 3);
  const nE = einsp.length;
  const abstand = nE === 3 ? 112 : 160;   // bei drei Kabeln enger, damit der Zähler links der rechten Spalte bleibt
  const exs = einsp.map((_, i) => 118 + i * abstand);
  const hx = nsAnschluss ? exs[0] : exs[nE - 1] + 142;      // Übergabefeld bzw. Messstrang
  const top = S.headBand + S.headHSchmal + 26;
  const rx = 700;                                            // rechte Spalte: Kennwerte, Datenweg

  // ── Geometrie ──
  const nbH = 44, egY = top + 110, stTop = egY + 16;
  const busY = stTop + 70;
  let wY, stBot, trafoY = null, nsY = null;
  if (nsAnschluss) { wY = stTop + 96; stBot = wY + 40; }
  else if (nsMessung) { trafoY = busY + 66; nsY = busY + 118; wY = nsY + 40; stBot = wY + 34; }
  else { wY = busY + 74; stBot = wY + 34; }
  const lgY = stBot + 30, lgH = 42;
  const unter = [
    w.bhkw && { titel: 'Erzeugungszähler BHKW', zeile: w.bhkw.kw > 0 ? `${ggNum(w.bhkw.kw)} kW el.` : (w.bhkw.lastgang ? 'Lastgang → Kapitel 5.2' : '') },
    w.pv && { titel: 'Erzeugungszähler PV', zeile: w.pv.kwp > 0 ? `${ggNum(w.pv.kwp)} kWp` : `${ggNum(w.pv.anzahl)} Anlage${w.pv.anzahl > 1 ? 'n' : ''}` },
    w.wind && { titel: 'Erzeugungszähler Wind', zeile: w.wind.kw > 0 ? `${ggNum(w.wind.kw)} kW` : '' },
  ].filter(Boolean);
  const uY = lgY + lgH + 34, uH = 44;
  // rechte Spalte (Datenweg) reicht bis unter den Lastgang-Kasten samt Verweis auf 3.2
  const datenwegBot = wY - 28 + 50 + 36 + 50 + (w.verfahren === 'RLM' ? 26 : 0);
  const chainBot = Math.max(unter.length ? uY + uH + 20 : lgY + lgH, datenwegBot);

  const punkte = ggMesskonzeptPunkte({ ...w, einsp: w.einsp || [] });
  const colW = (W - 2 * S.padX) / 2;
  const legZeilen = punkte.map(t => ggResUmbruch(t, Math.floor((colW - 40) / (11 * 0.53))).slice(0, 4));
  const reihenH = [];
  for (let i = 0; i < legZeilen.length; i += 2) reihenH.push(Math.max(legZeilen[i].length, legZeilen[i + 1]?.length || 0, 1) * 14 + 12);
  const legTop = chainBot + 30;
  const legH = reihenH.reduce((s, h) => s + h, 0);
  const height = legTop + legH + (cfg.fussnote ? 24 : 0) + S.footSpace + 6;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);
  out = `<defs><marker id="gg-mk-pf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10z" fill="${fein}"/></marker></defs>` + out;

  // ── Zeichenhelfer (wie EZA-Skizze) ──
  const linie = (xa, ya, xb, yb, o = {}) => `<line x1="${gR(xa)}" y1="${gR(ya)}" x2="${gR(xb)}" y2="${gR(yb)}"
      stroke="${o.farbe || strich}" stroke-width="${o.breite || 2}"${o.strich ? ` stroke-dasharray="${o.strich}"` : ''}${o.pfeil ? ' marker-end="url(#gg-mk-pf)"' : ''}/>`;
  const kasten = (x, y, bw, bh, o = {}) => `<rect x="${gR(x) + 0.5}" y="${gR(y) + 0.5}" width="${gR(bw)}" height="${gR(bh)}"
      fill="${o.fill || T.neutral.cardBg}" stroke="${o.rand || T.rule}" stroke-width="${o.breite || 1.4}"${o.strich ? ` stroke-dasharray="${o.strich}"` : ''}/>`;
  const nr = (x, y, k) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="10" fill="${gruen}"/>`
    + txt(x, y + 4, String(k), { anchor: 'middle', size: 11, weight: 700, fill: '#FFFFFF' });
  const schalter = (x, y) => `<path d="M${gR(x - 4)} ${y + 26}l8 8M${gR(x + 4)} ${y + 26}l-8 8" stroke="${strich}" stroke-width="1.6"/>`
    + linie(x, y, x, y + 30) + `<circle cx="${gR(x)}" cy="${y}" r="2.4" fill="${strich}"/>`;
  const trenner = (x, y) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="5" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.5"/>`;
  const wandler = (x, y) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="7" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.6"/>`;
  const trafo = (x, y, r = 10) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="${r}" fill="none" stroke="${strich}" stroke-width="1.5"/>
      <circle cx="${gR(x)}" cy="${gR(y + r * 1.4)}" r="${r}" fill="none" stroke="${strich}" stroke-width="1.5"/>`;
  const zaehlerSym = (x, y) => kasten(x, y, 22, 18, { rand: strich, breite: 1.3 }) + txt(x + 11.5, y + 13.5, 'kWh', { anchor: 'middle', size: 7.5, weight: 700 });
  let n = 0;
  const nrNext = (x, y) => nr(x, y, ++n);

  // ── ① Netz des Netzbetreibers und Netzkabel ──
  const nbW = Math.max(270, exs[nE - 1] + 96 - x0);
  out += kasten(x0, top, nbW, nbH, { rand: blau, strich: '5 3', breite: 1.2 });
  out += txt(x0 + 12, top + 18, 'Netz des Netzbetreibers', { size: 11.5, weight: 600 });
  const nbZeile = [w.nb, nsAnschluss ? 'Niederspannung' : (w.uKv ? `Mittelspannung ${ggNum(w.uKv, w.uKv % 1 ? 1 : 0)} kV` : 'Mittelspannung')]
    .filter(Boolean).join(' · ');
  out += txt(x0 + 12, top + 34, ggResKuerzen(nbZeile, Math.floor((nbW - 20) / (11 * 0.55))), { size: 11, fill: T.text.muted });
  const kevY = egY - 10;
  einsp.forEach((e, i) => {
    const ex = exs[i];
    out += linie(ex, top + nbH, ex, kevY, { breite: 2.2 });
    const platz = Math.floor((abstand - 18) / (10.5 * 0.55));
    out += txt(ex + 10, top + nbH + 20, ggResKuerzen(e.station || (nE > 1 ? `Einspeisung ${i + 1}` : 'Netzkabel'), platz),
               { size: 10.5, weight: 600 });
    if (e.kabeltyp) out += txt(ex + 10, top + nbH + 34, ggResKuerzen(e.kabeltyp, platz), { size: 10, fill: T.text.muted });
    // Kabelendverschluss
    out += `<path d="M${ex - 6} ${kevY - 8}h12l-6 9z" fill="${strich}"/>`;
  });
  out += nrNext(exs[0] - 22, top + nbH + 22);

  // ── ② Eigentumsgrenze ──
  const egX1 = rx - 24;
  out += linie(x0, egY, egX1, egY, { farbe: T.text.muted, breite: 1.3, strich: '10 5' });
  out += txt(egX1, egY - 7, 'EIGENTUMSGRENZE', { anchor: 'end', mono: true, size: 10, weight: 600, tracking: 1, fill: T.text.muted });
  out += txt(egX1, egY + 14, 'Netzbetreiber ↑  ·  Liegenschaft ↓', { anchor: 'end', size: 10, fill: T.text.faint });
  out += nrNext(x0 + 14, egY);

  // ── Übergabestation bzw. Hausanschlussraum ──
  const fx1 = hx + 214;
  out += kasten(x0, stTop, fx1 - x0, stBot - stTop, { fill: T.tint, rand: gruen, breite: 1.4 });
  // rechts oben im Rahmen — links laufen die Netzkabel durch
  out += txt(fx1 - 10, stTop + 18, (nsAnschluss ? 'Hausanschlussraum' : 'Übergabestation') + (w.uebergabe ? ` · ${w.uebergabe}` : ''),
             { anchor: 'end', size: 11, weight: 700, fill: gruen });

  if (nsAnschluss) {
    // Hausanschlusskasten = Eigentumsgrenze, dann Messung
    const ex = exs[0], hakY = stTop + 26;
    out += linie(ex, kevY + 1, ex, hakY);
    out += kasten(ex - 26, hakY, 52, 30, { rand: strich, breite: 1.4 });
    out += txt(ex, hakY + 20, 'HAK', { anchor: 'middle', size: 11, weight: 700 });
    out += linie(ex, hakY + 30, ex, wY - 7);
  } else {
    // ③ Kabelfelder und Sammelschiene
    einsp.forEach((_, i) => {
      const ex = exs[i];
      out += linie(ex, kevY + 1, ex, busY);
      out += trenner(ex, stTop + 40);
    });
    out += linie(exs[0] - 30, busY, hx + 30, busY, { breite: 5, farbe: gruen });
    out += txt(hx + 34, busY + 4, 'MS-Sammelschiene', { size: 10, fill: T.text.muted });
    out += nrNext(exs[0] - 22, stTop + 40);
    // ④ Leistungsschalter und Schutz
    out += schalter(hx, busY + 12);
    out += linie(hx, busY, hx, busY + 12);
    const sx = hx - 128, sy = busY + 18;
    out += kasten(sx, sy, 86, 26, { rand: rot, breite: 1.4 });
    out += txt(sx + 43, sy + 17, 'Schutz (UMZ)', { anchor: 'middle', size: 10, weight: 700, fill: rot });
    out += linie(sx + 86, sy + 13, hx - 8, sy + 13, { farbe: rot, breite: 1.2, strich: '4 3' });
    out += nrNext(sx - 12, sy);
    if (nsMessung) {
      out += linie(hx, busY + 42, hx, trafoY - 10);
      out += trafo(hx, trafoY);
      out += linie(hx, trafoY + 24, hx, nsY);
      out += linie(hx - 56, nsY, hx + 56, nsY, { breite: 4 });
      out += txt(hx + 60, nsY + 4, 'NS-Sammelschiene', { size: 10, fill: T.text.muted });
      out += linie(hx, nsY, hx, wY - 7);
    } else {
      out += linie(hx, busY + 42, hx, wY - 7);
    }
  }

  // ⑤ Abrechnungsmessung: Wandler + Zähler
  out += wandler(hx, wY);
  if (!nsAnschluss && !nsMessung) {   // Spannungswandler am Abzweig
    out += linie(hx, wY + 16, hx - 26, wY + 16, { breite: 1.4 }) + wandler(hx - 26, wY + 16);
  }
  const zx = hx + 46, zy = wY - 22, zw = 150, zh = 44;
  out += linie(hx + 7, wY, zx, wY, { farbe: fein, breite: 1.2, strich: '4 3' });
  out += kasten(zx, zy, zw, zh, { rand: strich, breite: 1.4 });
  out += zaehlerSym(zx + 8, zy + 13);
  out += txt(zx + 38, zy + 18, w.verfahren === 'RLM' ? 'Zähler RLM' : w.verfahren === 'SLP' ? 'Zähler SLP' : 'Zähler', { size: 11.5, weight: 700 });
  out += txt(zx + 38, zy + 33, w.zweirichtung ? 'Bezug ⇄ Lieferung' : 'Bezug', { size: 10.5, fill: T.text.muted });
  out += nrNext(zx + zw, zy);
  out += linie(hx, wY + 7, hx, lgY, { pfeil: true });

  // Liegenschaftsnetz
  const lgW = 250, lgX = Math.max(x0, hx - lgW / 2), lgM = lgX + lgW / 2;
  out += kasten(lgX, lgY, lgW, lgH, { rand: gruen, breite: 1.4 });
  out += txt(lgM, lgY + 18, nsAnschluss || nsMessung ? 'NS-Hauptverteilung der Liegenschaft' : 'MS-Netz der Liegenschaft',
             { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(lgM, lgY + 33, nsAnschluss || nsMessung ? 'Verteilung auf die Gebäude' : 'Trafostationen, siehe Kapitel 5.1.2',
             { anchor: 'middle', size: 10.5, fill: T.text.muted });

  // ⑥ Datenweg: Messstellenbetreiber → Lastgang
  const mw = x1 - rx, my = zy - 6;
  out += kasten(rx, my, mw, 50, { rand: blau, breite: 1.2 });
  out += txt(rx + mw / 2, my + 20, 'Messstellenbetreiber', { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(rx + mw / 2, my + 37, w.verfahren === 'RLM' ? 'Fernauslesung' : w.verfahren === 'SLP' ? 'Ablesung' : 'Aus- bzw. Ablesung',
             { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += linie(zx + zw + 1, wY, rx - 2, wY, { farbe: fein, breite: 1.4, strich: '4 3', pfeil: true });
  const dy = my + 50 + 36;
  out += linie(rx + mw / 2, my + 50, rx + mw / 2, dy - 2, { farbe: fein, breite: 1.4, strich: '4 3', pfeil: true });
  out += kasten(rx, dy, mw, 50, { rand: T.rule, breite: 1.2 });
  out += txt(rx + mw / 2, dy + 20, w.verfahren === 'RLM' ? 'Lastgang 15 min' : w.verfahren === 'SLP' ? 'Jahresarbeit (SLP)' : 'Messwerte',
             { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(rx + mw / 2, dy + 37, 'Abrechnung Netzbetreiber · Lieferant', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  if (w.verfahren === 'RLM') out += txt(rx + mw / 2, dy + 68, '→ Auswertung in Kapitel 5.2', { anchor: 'middle', size: 11, weight: 600, fill: gruen });
  out += nrNext(rx, my);

  // ⑦ Unterzählung
  if (unter.length) {
    const bw = 170, gapU = 16;
    const ux0 = Math.max(x0, hx - (unter.length * bw + (unter.length - 1) * gapU) / 2);
    out += txt(ux0, uY + uH + 16, 'Unterzählung im Liegenschaftsnetz', { size: 10.5, weight: 600, fill: T.text.muted });
    unter.forEach((u, i) => {
      const ux = ux0 + i * (bw + gapU);
      out += linie(ux + bw / 2, lgY + lgH, ux + bw / 2, uY, { farbe: fein, breite: 1.2, strich: '4 3' });
      out += kasten(ux, uY, bw, uH, { rand: T.rule, breite: 1.2 });
      out += zaehlerSym(ux + 8, uY + 13);
      out += txt(ux + 38, uY + 18, u.titel.replace('Erzeugungszähler ', 'Zähler '), { size: 11, weight: 700 });
      if (u.zeile) out += txt(ux + 38, uY + 33, u.zeile, { size: 10.5, fill: hell, weight: 600 });
    });
    out += nrNext(ux0 + unter.length * (bw + gapU) - gapU + 12, uY);
  }

  // ── Kennwerte rechts oben ──
  const kenn = [
    ['Anschlussleistung', w.anschlussKva ? `${ggNum(w.anschlussKva)} kVA` : '—'],
    ['Einspeisezusage', w.einspKw ? `${ggNum(w.einspKw)} kW` : '—'],
    ['Messverfahren', w.verfahren || '—'],
    ...(nsAnschluss ? [] : [['Messort', w.messort === 'ms' ? 'MS-seitig' : w.messort === 'ns' ? 'NS-seitig' : '—']]),
  ];
  out += txt(rx, top + 12, 'NETZANSCHLUSS', { mono: true, size: 10, weight: 600, tracking: 1, fill: T.text.muted });
  kenn.forEach(([k, v], i) => {
    const ky = top + 34 + i * 19;
    out += txt(rx, ky, k, { mono: true, size: 11, weight: 500, fill: T.text.faint });
    out += txt(x1, ky, v, { anchor: 'end', mono: true, size: 11.5, weight: 600 });
  });

  // ── Nummernlegende zweispaltig ──
  out += `<line x1="${x0}" y1="${legTop - 14}.5" x2="${x1}" y2="${legTop - 14}.5" stroke="${T.line}" stroke-width="1"/>`;
  let py = legTop;
  reihenH.forEach((h, r) => {
    for (let c = 0; c < 2; c++) {
      const i = r * 2 + c;
      if (i >= legZeilen.length) break;
      const px = S.padX + c * colW;
      out += nr(px + 10, py + 6, i + 1);
      legZeilen[i].forEach((z, j) => { out += txt(px + 28, py + 10 + j * 14, z, { size: 11 }); });
    }
    py += h;
  });
  if (cfg.fussnote) out += txt(S.padX, legTop + legH + 10, cfg.fussnote, { size: S.fsTab - 2, fill: T.text.faint });
  return ggFinishSvg(out, W, height);
}

GG_FIGUREN.push({
  id: 'netzanschluss-messkonzept',
  autoSync: true,
  reihe: 500,   // nach dem Netzanschlusstext
  kapitel: '5.1.1 Liegenschaftsstromnetzanschluss',
  titel: 'Prinzip Übergabe und Messkonzept',
  datei: 'netzanschluss-messkonzept-prinzip',
  hinweis: 'Prinzipskizze aus den Netzanschluss-Stammdaten (⚡ Strom-Grundlagen › Netzanschluss: Netzbetreiber, '
         + 'Spannungsebene, Einspeisepunkte, Übergabepunkt, Messverfahren, Messort), der Anschlussleistung/Einspeisezusage '
         + '(NAP-Grenzen), den Messjahren (BHKW-Lastgang) und den Erzeugern im Bestand. Zweirichtungszähler, sobald eine '
         + 'Einspeisezusage oder Erzeugung vorhanden ist. Ohne Messort wird die Messung am Übergabefeld gezeichnet und '
         + 'als „laut Netzanschlussvertrag“ bezeichnet.',
  render: cfg => ggRenderMesskonzept(cfg),
  config: {
    eyebrow: 'Stromnetz · Ist-Zustand', titel: 'Übergabe und Messkonzept',
    werte: null, fussnote: '',
  },
  ausProjekt(cfg) {
    const w = ggMesskonzeptWerte();
    cfg.werte = w;
    cfg.fussnote = `Prinzipskizze ohne Auslegung; Eigentums- und Messgrenzen laut Netzanschlussvertrag und `
      + (w.ns ? 'TAR Niederspannung (VDE-AR-N 4100).' : 'TAR Mittelspannung (VDE-AR-N 4110).');
    const fehlt = [
      !w.nb && 'Netzbetreiber', !w.spText && !w.uKv && 'Spannungsebene', !w.einsp.length && 'Einspeisepunkte',
      !w.uebergabe && 'Übergabepunkt', !w.verfahren && 'Messverfahren', !w.ns && !w.messort && 'Messort',
      !w.anschlussKva && 'Anschlussleistung',
    ].filter(Boolean);
    return fehlt.length
      ? `⚠ Noch nicht erfasst (⚡ Strom-Grundlagen › Netzanschluss): ${fehlt.join(', ')}.`
      : '✓ Netzanschluss-Stammdaten vollständig übernommen.';
  },
});

/* ── 3.1.2 Übersichtsschaltbild des Liegenschaftsnetzes ─────────────────────────
 * Stationsebene statt Einzelbetriebsmittel (lib/netz-uebersicht.js): oben das Netz des
 * Netzbetreibers, die Eigentumsgrenze am NAP und die Übergabestation, darunter deren
 * MS-Sammelschiene senkrecht; rechts je Abgang eine Reihe Stationskarten. Ein Ring ist eine
 * geschlossene Schleife zurück zur Sammelschiene, Abzweige laufen in Spuren unter den Reihen.
 * Stationsnamen wie in der Tabelle „Übersicht Trafostationen" (ggTrafoZeilen). */

const GG_NU_ERZ = { PV: ['PV', 'kWp'], KWK: ['BHKW', 'kWel'], Wind: ['Wind', 'kW'], Batterie: ['Batterie', 'kW'], Nsa: ['NEA', 'kW'], H2: ['H₂', 'kW'] };
const GG_NU_ART = { ring: 'Ring', strahl: 'Strahl', verzweigt: 'Strahl, verzweigt', vermascht: 'vermascht', kette: 'Kette' };

/** Trafos einer Station als Kurztext: „2 × 630 kVA", „2 × 630 + 800 kVA". */
function ggNuTrafoText(trafos) {
  if (!trafos.length) return '';
  const kvas = trafos.map(t => (t.kva > 0 ? t.kva : null));
  if (kvas.every(k => k == null)) return `${trafos.length > 1 ? trafos.length + ' Trafos' : 'Trafo'} ohne Leistungsangabe`;
  return ggNuKvaGruppen(kvas) + ' kVA';
}

/** Leistungen gleicher Größe zusammengefasst, größte zuerst: [630, 800, 630] → „2 × 630 + 800". */
function ggNuKvaGruppen(kvas) {
  const n = new Map();
  for (const k of kvas) n.set(k, (n.get(k) || 0) + 1);
  return [...n.entries()].sort((a, b) => (b[1] - a[1]) || ((b[0] ?? -1) - (a[0] ?? -1)))
    .map(([k, c]) => (c > 1 ? `${c} × ` : '') + (k > 0 ? ggNum(k) : '?')).join(' + ');
}

/** Erzeuger auf der NS-Seite einer Station: „PV 344 kWp · NEA 200 kW". */
function ggNuErzeugerText(erz) {
  return Object.entries(GG_NU_ERZ).filter(([t]) => erz?.[t]).map(([t, [lbl, einh]]) => {
    const e = erz[t];
    return e.kw > 0 ? `${lbl} ${ggNum(e.kw)} ${einh}` : lbl;
  }).join(' · ');
}

/**
 * Netzmodell → Stationsansicht für ggRenderNetzUebersicht; Rückgabe enthält auch das Rohergebnis der Lib
 * und `sicht(key)` für Stationsnamen. mitPlanung = Zielnetz (3.4.1): geplante Stationen/Kabel, geplante
 * Maßnahmen (Trafotausch, Kabelertüchtigung) und Rückbau bis zum Zieljahr.
 */
function ggNetzUebersichtDaten({ mitPlanung = false, zieljahr = null } = {}) {
  let assets = [];
  try { assets = window.listAssets?.() || []; } catch (e) { void e; }
  const gebListe = window.gebaeude || [];
  const r = nuNetzUebersicht({ assets, edges: window.stromEdges || [], gebaeude: gebListe,
    typeRank: window.TYPE_RANK || undefined, heute: new Date().getFullYear(), mitPlanung, zieljahr,
    massnahmeJahr: typeof window.massnahmeJahr === 'function' ? m => window.massnahmeJahr(m) : undefined });
  const { nr } = ggTrafoZeilen(assets.filter(a => a.type === 'Trafo'), { nurBestand: !mitPlanung });

  const sicht = key => {
    const st = r.stationen[key];
    const stName = GG_STATION_NAME.test(st.gebName) ? st.gebName.trim() : '';
    // Heißt das Gebäude schon wie die Station, steht darunter nur noch die Gebäudenummer.
    const gebLabel = st.gebNummer ? `Gebäude ${st.gebNummer}` : stName ? '' : st.gebName;
    const tabKey = st.gebId != null ? st.gebId : st.trafos[0] ? 'einzeln:' + st.trafos[0].id : null;
    const station = stName || (st.trafos.length ? `Trafostation ${nr.get(tabKey) ?? '?'}` : '');
    const titel = st.hatNap ? 'Übergabestation' : station || 'Schaltstation';
    const zeile2 = [st.hatNap ? station : '', gebLabel].filter(Boolean).join(' · ');
    const erzTrafo = st.trafos.some(t => t.erzeugung);
    // Zielnetz: was sich an einer bestehenden Station ändert (Trafotausch, zusätzlicher Trafo)
    const tausch = st.trafos.filter(t => t.ertuechtigt), neu = st.trafos.filter(t => t.geplant);
    const zubau = st.geplant ? '' : [
      tausch.length ? `Tausch ${ggNuKvaGruppen(tausch.map(t => t.kvaIst))} → ${ggNuKvaGruppen(tausch.map(t => t.kva))} kVA` : '',
      neu.length ? `+ ${ggNuTrafoText(neu)} neu` : '',
    ].filter(Boolean).join(' · ');
    return {
      titel, zeile2, trafo: ggNuTrafoText(st.trafos), hatTrafo: st.trafos.length > 0, zubau,
      geb: [st.gebaeudeVersorgt ? `${ggNum(st.gebaeudeVersorgt)} Gebäude versorgt` : '', erzTrafo ? 'Erzeugungsnetz' : '']
        .filter(Boolean).join(' · '),
      erz: ggNuErzeugerText(st.erzeuger), ts: st.trennstelle, geplant: st.geplant, uebergabe: st.hatNap,
    };
  };
  const kante = v => ({ ts: v.trennstelle, geplant: v.geplant, ertuechtigt: v.ertuechtigt, anzahl: v.anzahl });
  const abgang = ab => ({
    art: ab.art, abzweige: ab.abzweige || 0, stationen: ab.folge.map(sicht),
    innen: ab.innen.map(x => ({ i: x.i, j: x.j, ...kante(x.kante) })),
    wurzel: ab.wurzel.map(x => ({ i: x.i, ...kante(x.kante) })),
  });
  const netz = {
    napKV: r.kennzahlen.napKV,
    bloecke: r.wurzeln.map(w => ({ station: sicht(w.key), napKV: r.stationen[w.key].napKV, abgaenge: w.abgaenge.map(abgang) })),
    ohneNap: r.ohneNap.map(abgang),
  };
  return { netz, r, sicht };
}

/**
 * Absätze zur Netzstruktur für den Einleitungstext von 3.1.2 — aus demselben Ergebnis wie das
 * Übersichtsschaltbild. Ohne Netzmodell leer (der Text beginnt dann mit dem Tabellenabsatz).
 */
function ggNetzStrukturAbsaetze() {
  let r;
  try { ({ r } = ggNetzUebersichtDaten()); } catch (e) { void e; return []; }
  const k = r.kennzahlen;
  if (!Object.keys(r.stationen).length) return [];
  const eine = (n, einz, mehrz, w = 'eine') => (n === 1 ? `${w} ${einz}` : `${ggNum(n)} ${mehrz}`);
  const s = [];

  const netzTxt = k.napKV ? `an das ${ggNum(k.napKV, k.napKV % 1 ? 1 : 0)}-kV-Mittelspannungsnetz`
    : `an das Mittelspannungsnetz (${ggTextFeld('', 'Nennspannung in kV')})`;
  const nW = r.wurzeln.length;
  if (nW === 1) {
    const st = r.stationen[r.wurzeln[0].key];
    const geb = st.gebNummer ? `Gebäude ${st.gebNummer}` : st.gebName;
    s.push(`Die Liegenschaft ist über eine Übergabestation${geb ? ` (${geb})` : ''} ${netzTxt} des Netzbetreibers angeschlossen.`);
  } else if (nW > 1) {
    s.push(`Die Liegenschaft ist über ${ggNum(nW)} Netzanschlusspunkte mit jeweils eigener Übergabestation ${netzTxt} des Netzbetreibers angeschlossen.`);
  } else {
    s.push(`Die Liegenschaft ist über ${ggTextFeld('', 'Übergabestation / Netzanschlusspunkt')} ${netzTxt} des Netzbetreibers angeschlossen.`);
  }

  const abg = r.wurzeln.flatMap(w => w.abgaenge);
  const von = nW > 1 ? 'Von den Übergabestationen' : 'Von der Übergabestation';
  if (abg.length === 1) {
    const n = abg[0].folge.length;
    const art = abg[0].art === 'ring' ? 'ein Mittelspannungsring' : 'ein Mittelspannungsstrahl';
    s.push(`${von} geht ${art} aus, über den ${eine(n, 'Station', 'Stationen')} versorgt ${n === 1 ? 'wird' : 'werden'}.`);
  } else if (abg.length > 1) {
    s.push(`${von} gehen ${ggNum(abg.length)} Mittelspannungsabgänge aus`
      + (k.ringe ? `, davon ${k.ringe === abg.length ? 'alle' : ggNum(k.ringe)} als Ring ausgeführt` : '') + '.');
  }
  const ringe = abg.filter(a => a.art === 'ring');
  if (ringe.length) {
    const alleMitTs = ringe.every(a => a.trennstelleErfasst);
    s.push(`Im Normalbetrieb ${ringe.length === 1 ? 'wird der Ring' : 'werden die Ringe'} an einer offenen Trennstelle aufgetrennt `
      + `und als zwei Strahlen betrieben` + (alleMitTs ? '; die Trennstellen sind in der folgenden Abbildung markiert.'
        : ` (Lage der Trennstelle: ${ggTextFeld('', 'Station bzw. Kabelabschnitt')}).`));
  }
  s.push(`Insgesamt ${k.stationen === 1 ? 'ist' : 'sind'} ${eine(k.stationen, 'Trafostation', 'Trafostationen')} mit ${eine(k.trafos, 'Transformator', 'Transformatoren', 'einem')} `
    + `und einer installierten Leistung von ${ggNum(k.kva)} kVA vorhanden.`);
  const ohne = r.ohneNap.reduce((n, a) => n + a.folge.length, 0);
  if (ohne && nW) {
    s.push(`${ohne === 1 ? 'Eine Station ist' : `${ggNum(ohne)} Stationen sind`} ohne Mittelspannungsverbindung zur Übergabestation `
      + `erfasst; ihre Anbindung ist ${ggTextFeld('', 'Anbindung klären')}.`);
  }
  s.push('Die folgende Abbildung zeigt die Struktur des Netzes schematisch.');
  return [s.join(' ')];
}

/** Kabeltypen der MS-Verbindungen für die Fußnote: „NA2XS2Y 185 mm² (4) · NA2XS2Y 95 mm² (1)". */
function ggNuKabelText(verbindungen) {
  const zaehl = new Map();
  let ohne = 0;
  for (const v of verbindungen) {
    for (const k of v.kabel) {
      if (!k.qs && !k.typ) { ohne++; continue; }
      const t = [k.typ, k.qs ? `${ggNum(k.qs)} mm²` : ''].filter(Boolean).join(' ') + (k.geschaetzt ? ' (geschätzt)' : '');
      zaehl.set(t, (zaehl.get(t) || 0) + 1);
    }
  }
  const teile = [...zaehl.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`);
  if (ohne) teile.push(`ohne Angabe (${ohne})`);
  return teile.join(' · ');
}

export function ggRenderNetzUebersicht(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, hell = T.accents.gruen, rot = T.energy.waerme, blau = T.energy.strom;
  const strich = T.text.strong;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const x0 = S.padX, x1 = W - S.padX;
  const netz = cfg.netz || {};
  const bloecke = netz.bloecke || [];
  const ohneNap = netz.ohneNap || [];
  const alleSt = [...bloecke.flatMap(b => [b.station, ...b.abgaenge.flatMap(a => a.stationen)]), ...ohneNap.flatMap(a => a.stationen)];
  const alleV = [...bloecke.flatMap(b => b.abgaenge), ...ohneNap].flatMap(a => [...a.innen, ...a.wurzel]);

  // ── Raster ──
  const busX = x0 + 110;            // MS-Sammelschiene der Übergabestation (senkrecht)
  const xa = busX + 58;             // linke Kante der Stationskarten
  const mitZubau = alleSt.some(s => s.zubau);   // Zielnetz: eine Zeile mehr für Trafotausch/-zubau
  const K = 5, gap = 24, ch = mitZubau ? 114 : 100, ANSCHLUSS = 44, labelH = 24;
  const cw = (x1 - xa - (K - 1) * gap) / K;
  const uebW = 220, uebH = ch;
  const cardX = c => xa + c * (cw + gap);
  const spurY = (unten, s) => unten + 14 + s * 10;
  const dxVon = s => ((s % 3) - 1) * 14;

  // ── Planung je Abgang: Reihen, Routen, Spuren unter den Reihen ──
  const plane = ab => {
    const n = ab.stationen.length;
    const R = Math.max(1, Math.ceil(n / K));
    const pos = i => ({ r: Math.floor(i / K), c: i % K });
    const spuren = Array(R).fill(0);
    const neu = r => spuren[r]++;
    let gasse = 0;
    const routen = [];
    (ab.wurzel || []).forEach((w, k) => {
      if (k === 0 && w.i === 0) routen.push({ art: 'bus', w });
      else routen.push({ art: 'busSpur', w, s: neu(pos(w.i).r) });
    });
    (ab.innen || []).forEach(v => {
      const pi = pos(v.i), pj = pos(v.j);
      if (v.j === v.i + 1 && pi.r === pj.r) routen.push({ art: 'direkt', v });
      else if (v.j === v.i + 1) routen.push({ art: 'umbruch', v, s: neu(pi.r) });
      else if (pi.r === pj.r) routen.push({ art: 'spur', v, s: neu(pi.r) });
      else if (pj.r === pi.r + 1) routen.push({ art: 'runter', v, s: neu(pi.r) });
      else routen.push({ art: 'gasse', v, s: neu(pi.r), s2: neu(pj.r - 1), g: gasse++ });
    });
    const spurH = spuren.map(k => (k ? 20 + k * 10 : 22));
    const hoehe = labelH + R * ch + spurH.reduce((a, b) => a + b, 0);
    return { ab, n, R, pos, routen, spurH, hoehe };
  };

  const top = S.headBand + S.headHSchmal + 22;
  let y = top;
  const bPlan = bloecke.map(b => {
    const bp = { b, top: y, egY: y + 58, uebTop: y + 80, abg: b.abgaenge.map(plane) };
    let ay = bp.uebTop + uebH + 22;
    for (const p of bp.abg) { p.top = ay; ay += p.hoehe + 10; }
    bp.bottom = ay;
    y = ay + 14;
    return bp;
  });
  const oPlan = ohneNap.map(plane);
  const ohneTop = y;
  if (oPlan.length) {
    let ay = y + 26;
    for (const p of oPlan) { p.top = ay; ay += p.hoehe + 10; }
    y = ay;
  }
  const leer = !bPlan.length && !oPlan.length;
  if (leer) y = top + 120;
  const mitGeplant = alleSt.some(s => s.geplant) || alleV.some(v => v.geplant);
  const mitErt = alleV.some(v => v.ertuechtigt);
  const mitTs = alleSt.some(s => s.ts) || alleV.some(v => v.ts);
  const legY = y + 22;
  const fuss = cfg.fussnote ? String(cfg.fussnote).split('\n').filter(Boolean) : [];
  const height = legY + 14 + fuss.length * 17 + S.footSpace + 8;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);

  // ── Zeichenhelfer ──
  // Bestand dunkelgrün, Neubau hellgrün gestrichelt, ertüchtigter Bestand hellgrün kräftig
  const pfad = (d, geplant, ertuechtigt = false) => `<path d="${d}" fill="none" stroke="${geplant || ertuechtigt ? hell : gruen}"
      stroke-width="${ertuechtigt && !geplant ? 3.6 : 2.2}" stroke-linejoin="round"${geplant ? ' stroke-dasharray="6 4"' : ''}/>`;
  const tsMarke = (x, yy) => `<rect x="${gR(x - 7)}" y="${gR(yy - 4)}" width="14" height="8" fill="${T.bg}"/>
      <line x1="${gR(x - 7)}" y1="${gR(yy)}" x2="${gR(x + 5)}" y2="${gR(yy - 10)}" stroke="${rot}" stroke-width="2"/>
      <circle cx="${gR(x - 7)}" cy="${gR(yy)}" r="2.4" fill="${rot}"/><circle cx="${gR(x + 7)}" cy="${gR(yy)}" r="2.4" fill="${rot}"/>`;
  // Parallele Systeme kurz über der Leitung — zwischen zwei Karten ist nur eine Kartenlücke Platz
  const systeme = (x, yy, v) => (v.anzahl > 1 ? txt(x, yy - 6, `${v.anzahl}×`, { anchor: 'middle', size: 10, weight: 600, fill: T.text.muted }) : '');
  const trafoSym = (x, yy, r = 7, farbe = strich) => `<circle cx="${gR(x)}" cy="${gR(yy)}" r="${r}" fill="none" stroke="${farbe}" stroke-width="1.4"/>
      <circle cx="${gR(x)}" cy="${gR(yy + r * 1.35)}" r="${r}" fill="none" stroke="${farbe}" stroke-width="1.4"/>`;
  const zeichen = size => size * 0.55;
  // Lange Zeilen erst kleiner setzen (bis 9 pt), erst danach kürzen
  const passend = (x, yy, t, platz, o) => {
    let size = o.size;
    while (size > 9 && t.length * zeichen(size) > platz) size -= 0.5;
    return txt(x, yy, ggResKuerzen(t, Math.floor(platz / zeichen(size))), { ...o, size });
  };
  const karte = (st, kx, ky, breite, o = {}) => {
    const fill = st.uebergabe ? T.tint : T.neutral.cardBg;
    const rand = o.ohneNap ? T.text.faint : st.geplant ? hell : st.uebergabe ? gruen : T.rule;
    let k = `<rect x="${gR(kx) + 0.5}" y="${gR(ky) + 0.5}" width="${gR(breite) - 1}" height="${ch - 1}" fill="${fill}" stroke="${rand}"
        stroke-width="${st.uebergabe ? 1.6 : 1.2}"${st.geplant || o.ohneNap ? ' stroke-dasharray="5 3"' : ''}/>`;
    const maxT = Math.floor((breite - (st.ts ? 36 : 16)) / (12 * 0.52));
    k += txt(kx + 10, ky + 18, ggResKuerzen(st.titel, maxT), { size: 12, weight: 700 });
    if (st.ts) {
      k += `<rect x="${gR(kx + breite - 30)}" y="${gR(ky + 7)}" width="22" height="15" fill="${T.neutral.cardBg}" stroke="${rot}" stroke-width="1.2"/>`;
      k += txt(kx + breite - 19, ky + 18.5, 'TS', { anchor: 'middle', size: 9.5, weight: 700, fill: rot });
    }
    if (st.zeile2) k += txt(kx + 10, ky + 33, ggResKuerzen(st.zeile2, Math.floor((breite - 18) / zeichen(10.5))), { size: 10.5, fill: T.text.muted });
    if (st.hatTrafo) {
      k += trafoSym(kx + 18, ky + 46);
      k += passend(kx + 34, ky + 57, st.trafo, breite - 40, { size: 11, weight: 600 });
    } else if (!st.uebergabe) {
      k += txt(kx + 10, ky + 57, 'ohne Transformator', { size: 10.5, fill: T.text.faint });
    }
    // Folgezeilen: Zubau/Tausch (Zielnetz), versorgte Gebäude, Erzeuger — so viele, wie die Karte fasst
    const zeilen = [
      st.zubau && { t: st.zubau, o: { size: 10.5, weight: 700, fill: hell } },
      st.geb && { t: st.geb, o: { size: 10.5, fill: T.text.muted } },
      st.erz && { t: st.erz, o: { size: 10.5, weight: 600, fill: hell } },
    ].filter(Boolean).slice(0, mitZubau ? 3 : 2);
    zeilen.forEach((z, i) => {
      k += passend(kx + 10, ky + 78 + i * 14, z.t, breite - 18, z.o);
    });
    if (st.geplant) k += txt(kx + breite - 8, ky + ch - 8, 'geplant', { anchor: 'end', size: 9.5, weight: 600, fill: hell });
    return k;
  };

  // ── ein Abgang: Routen zuerst, Karten darüber ──
  const zeichneAbgang = (p, nr, mitBus, busYs) => {
    const ab = p.ab;
    const rowTop = r => p.top + labelH + r * ch + p.spurH.slice(0, r).reduce((a, b) => a + b, 0);
    const geo = i => {
      const { r, c } = p.pos(i);
      const kx = cardX(c), ky = rowTop(r);
      return { r, kx, ky, cx: kx + cw / 2, ya: ky + ANSCHLUSS, unten: ky + ch };
    };
    const art = (GG_NU_ART[ab.art] || ab.art) + (ab.abzweige ? ` mit ${ab.abzweige === 1 ? 'Abzweig' : ggNum(ab.abzweige) + ' Abzweigen'}` : '');
    const kopf = mitBus ? `Abgang ${nr} · ${art} · ${ggNum(p.n)} ${p.n === 1 ? 'Station' : 'Stationen'}`
      : p.n === 1 ? 'Einzelstation' : `${art} · ${ggNum(p.n)} Stationen`;
    let o = txt(xa, p.top + 14, kopf, { size: 11, weight: 600, fill: mitBus ? gruen : T.text.muted });
    for (const rt of p.routen) {
      const v = rt.v || rt.w;
      let d = '', tsX = null, tsY = null;
      if (rt.art === 'bus') {
        const g = geo(rt.w.i);
        d = `M${busX} ${g.ya}H${gR(g.kx)}`;
        tsX = (busX + g.kx) / 2; tsY = g.ya;
        busYs.push(g.ya);
        o += systeme(tsX, tsY, v);
      } else if (rt.art === 'busSpur') {
        const g = geo(rt.w.i), ys = spurY(g.unten, rt.s), ax = g.cx + dxVon(rt.s);
        d = `M${gR(ax)} ${g.unten}V${ys}H${busX}`;
        tsX = (ax + xa) / 2; tsY = ys;
        busYs.push(ys);
      } else {
        const a = geo(v.i), b = geo(v.j);
        if (rt.art === 'direkt') {
          d = `M${gR(a.kx + cw)} ${a.ya}H${gR(b.kx)}`;
          tsX = a.kx + cw + gap / 2; tsY = a.ya;
          o += systeme(tsX, tsY, v);
        } else if (rt.art === 'umbruch') {
          const ys = spurY(a.unten, rt.s), xr = a.kx + cw + 10;
          d = `M${gR(a.kx + cw)} ${a.ya}H${gR(xr)}V${ys}H${gR(b.cx + dxVon(rt.s))}V${b.ky}`;
          tsX = (xr + b.cx) / 2; tsY = ys;
        } else if (rt.art === 'spur' || rt.art === 'runter') {
          const ys = spurY(a.unten, rt.s), dx = dxVon(rt.s);
          d = `M${gR(a.cx + dx)} ${a.unten}V${ys}H${gR(b.cx + dx)}V${rt.art === 'spur' ? b.unten : b.ky}`;
          tsX = (a.cx + b.cx) / 2; tsY = ys;
        } else {   // gasse: über den Gang zwischen Sammelschiene und Karten in eine tiefere Reihe
          const ys1 = spurY(a.unten, rt.s), xg = busX + 18 + (rt.g % 4) * 8;
          const ys2 = spurY(rowTop(b.r - 1) + ch, rt.s2), dx = dxVon(rt.s);
          d = `M${gR(a.cx + dx)} ${a.unten}V${ys1}H${xg}V${ys2}H${gR(b.cx + dx)}V${b.ky}`;
          tsX = (a.cx + xg) / 2; tsY = ys1;
        }
      }
      o += pfad(d, v.geplant, v.ertuechtigt);
      if (v.ts) o += tsMarke(tsX, tsY);
    }
    ab.stationen.forEach((st, i) => { const g = geo(i); o += karte(st, g.kx, g.ky, cw, { ohneNap: !mitBus }); });
    return o;
  };

  if (leer) {
    out += txt(W / 2, top + 60, cfg.leer || 'Kein Netzmodell — im Elektro-Tab NAP, Schaltanlagen und Trafos anlegen.',
               { anchor: 'middle', size: 13, fill: T.text.faint });
  }

  bPlan.forEach((bp, bi) => {
    const b = bp.b;
    const uKv = b.napKV || netz.napKV;
    // Netz des Netzbetreibers und Eigentumsgrenze am NAP
    out += `<rect x="${x0 + 0.5}" y="${bp.top + 0.5}" width="${uebW}" height="38" fill="${T.neutral.cardBg}" stroke="${blau}"
              stroke-width="1.2" stroke-dasharray="5 3"/>`;
    out += txt(x0 + uebW / 2, bp.top + 16, 'Netz des Netzbetreibers', { anchor: 'middle', size: 11.5, weight: 600 });
    out += txt(x0 + uebW / 2, bp.top + 31, uKv ? `Mittelspannung ${ggNum(uKv, uKv % 1 ? 1 : 0)} kV` : 'Mittelspannung',
               { anchor: 'middle', size: 11, fill: T.text.muted });
    out += `<line x1="${busX}" y1="${bp.top + 38}" x2="${busX}" y2="${bp.uebTop}" stroke="${strich}" stroke-width="2"/>`;
    out += `<line x1="${x0}" y1="${bp.egY}" x2="${x1}" y2="${bp.egY}" stroke="${T.text.muted}" stroke-width="1.2" stroke-dasharray="10 5"/>`;
    out += `<circle cx="${busX}" cy="${bp.egY}" r="4.5" fill="${strich}"/>`;
    out += txt(busX + 14, bp.egY - 7, bloecke.length > 1 ? `Netzanschlusspunkt ${bi + 1} (NAP)` : 'Netzanschlusspunkt (NAP)', { size: 11.5, weight: 600 });
    out += txt(x1, bp.egY - 7, 'EIGENTUMSGRENZE', { anchor: 'end', mono: true, size: 10, weight: 600, tracking: 1, fill: T.text.muted });
    out += txt(x1, bp.egY + 15, 'Netzbetreiber ↑  ·  Liegenschaft ↓', { anchor: 'end', size: 10, fill: T.text.faint });

    // Übergabestation und Kennzahlen daneben
    out += karte(b.station, x0, bp.uebTop, uebW);
    if (bi === 0 && (cfg.kenngroessen || []).length) {
      const kx = x0 + uebW + 70;
      out += `<line x1="${kx - 22}.5" y1="${bp.uebTop + 6}" x2="${kx - 22}.5" y2="${bp.uebTop + uebH - 6}" stroke="${T.line}" stroke-width="1"/>`;
      cfg.kenngroessen.slice(0, 5).forEach(([k, v], i) => {
        const ky = bp.uebTop + 18 + i * 19;
        out += txt(kx, ky, k, { mono: true, size: 11, weight: 500, fill: T.text.faint });
        out += txt(kx + 190, ky, v, { mono: true, size: 11.5, weight: 600 });
      });
    }

    // Abgänge; danach die Sammelschiene bis zum tiefsten Anschluss
    const busYs = [];
    bp.abg.forEach((p, i) => { out += zeichneAbgang(p, i + 1, true, busYs); });
    const busTop = bp.uebTop + uebH, busBot = Math.max(busTop + 18, ...busYs);
    out += `<line x1="${busX}" y1="${busTop}" x2="${busX}" y2="${gR(busBot)}" stroke="${gruen}" stroke-width="5"/>`;
    busYs.forEach(yy => { out += `<circle cx="${busX}" cy="${gR(yy)}" r="4" fill="${gruen}"/>`; });
    out += txt(busX - 10, busTop + 16, 'MS-Sammelschiene', { anchor: 'end', size: 10, fill: T.text.muted });
  });

  if (oPlan.length) {
    out += txt(x0, ohneTop + 14, 'Ohne Mittelspannungsverbindung zum Netzanschlusspunkt (im Netzmodell)',
               { size: 11.5, weight: 700, fill: T.text.muted });
    oPlan.forEach(p => { out += zeichneAbgang(p, 0, false, []); });
  }

  // ── Legende ──
  let lx = x0;
  const leg = (sym, text) => { out += sym(lx, legY) + txt(lx + 30, legY + 4, text, { size: 11 }); lx += 30 + ggEstW(text, 11) + 24; };
  if (!leer) {
    leg((x, yy) => pfad(`M${x} ${yy}H${x + 22}`, false), mitGeplant || mitErt ? 'MS-Kabel Bestand' : 'MS-Kabel');
    if (mitGeplant) leg((x, yy) => pfad(`M${x} ${yy}H${x + 22}`, true), 'Neubau (geplant)');
    if (mitErt) leg((x, yy) => pfad(`M${x} ${yy}H${x + 22}`, false, true), 'ertüchtigt');
    leg((x, yy) => trafoSym(x + 11, yy - 5, 5.5), 'Transformator MS/NS');
    if (mitTs) leg((x, yy) => tsMarke(x + 11, yy), 'offene Trennstelle (TS)');
    leg((x, yy) => `<rect x="${x + 0.5}" y="${yy - 7.5}" width="22" height="14" fill="${T.tint}" stroke="${gruen}" stroke-width="1.4"/>`, 'Übergabestation');
  }
  fuss.forEach((z, i) => { out += txt(x0, legY + 30 + i * 17, z, { size: S.fsTab - 2, fill: T.text.faint }); });
  return ggFinishSvg(out, W, height);
}

GG_FIGUREN.push({
  id: 'netz-uebersicht-ist',
  autoSync: true,
  reihe: 500,   // nach dem Einleitungstext, vor der Tabelle „Übersicht Trafostationen“
  kapitel: '5.1.2 Stromnetz intern (MS/NS)',
  titel: 'Übersichtsschaltbild Stromnetz (Bestand)',
  datei: 'netz-uebersichtsschaltbild-ist',
  hinweis: 'Aus dem Netzmodell des Elektro-Tabs verdichtet: je Gebäude eine Station (NAP, Schaltanlagen, Trafos), '
         + 'dazwischen nur die Mittelspannungskabel. Ringe, Strahlen und offene Trennstellen (Schaltanlage „Trennstelle“ '
         + 'oder Kabel-Merkmal) werden erkannt; je Station stehen die Trafoleistung, die versorgten Gebäude und die '
         + 'Erzeuger der NS-Seite. Nur Bestand — Stationsnamen wie in der Tabelle „Übersicht Trafostationen“.',
  render: cfg => ggRenderNetzUebersicht(cfg),
  config: {
    eyebrow: 'Stromnetz · Ist-Zustand', titel: 'Übersichtsschaltbild Mittelspannungsnetz',
    netz: null, kenngroessen: [], fussnote: '',
    leer: 'Kein Netzmodell — im Elektro-Tab NAP, Schaltanlagen und Trafos anlegen.',
  },
  ausProjekt(cfg) {
    const { netz, r } = ggNetzUebersichtDaten();
    cfg.netz = netz;
    const k = r.kennzahlen;
    if (!Object.keys(r.stationen).length) {
      cfg.kenngroessen = []; cfg.fussnote = '';
      return '⚠ Kein Netzmodell — im Elektro-Tab NAP, Schaltanlagen und Trafos anlegen.';
    }
    cfg.kenngroessen = [
      ['Trafostationen', ggNum(k.stationen)],
      ['Transformatoren', ggNum(k.trafos)],
      ['installierte Leistung', `${ggNum(k.kva)} kVA`],
      ['Abgänge / Ringe', `${ggNum(k.abgaenge)} / ${ggNum(k.ringe)}`],
      ...(k.msLaengeM > 0 ? [['MS-Kabel (Trasse)', `≈ ${ggNum(k.msLaengeM / 1000, 1)} km`]] : []),
    ];
    const kabel = ggNuKabelText(r.verbindungen);
    cfg.fussnote = [
      `Bestand ${new Date().getFullYear()} · schematische Darstellung, nicht lagerichtig`
        + (k.schaltstationen ? ` · ${ggNum(k.schaltstationen)} Schaltstation${k.schaltstationen > 1 ? 'en' : ''} ohne Transformator` : ''),
      kabel ? `MS-Kabel je Verbindung: ${kabel}` : '',
    ].filter(Boolean).join('\n');
    const lage = `${ggNum(k.stationen)} Trafostationen, ${ggNum(k.abgaenge)} Abgänge (${ggNum(k.ringe)} Ringe)`;
    return r.hinweise.length ? `⚠ ${lage} — ${r.hinweise.join(' ')}` : `✓ ${lage} aus dem Netzmodell übernommen.`;
  },
});

/* ── 3.4.1 Zielnetz: dasselbe Schaltbild mit allen Planungen des Netzmodells ──
 * Neue Stationen/Kabel gestrichelt hellgrün, ertüchtigte Kabel kräftig hellgrün, Trafotausch und
 * zusätzliche Trafos als grüne Zeile auf der Karte, Rückbau in der Fußnote. Gezeigt wird, was im
 * Modell steht (geplante Assets, Kanten und Maßnahmen) — Engpass-Vorschläge erst, wenn sie als
 * Maßnahme übernommen sind. Stationsnamen wie in der Tabelle „Übersicht Trafostationen“ in 5.4.1. */
GG_FIGUREN.push({
  id: 'netz-uebersicht-ziel',
  autoSync: true,
  reihe: 35,   // nach der Engpass-Tabelle, vor der Übersicht Trafostationen (Bestand + geplant)
  kapitel: '5.4.1 Netzanschluss und internes Stromnetz',
  titel: 'Übersichtsschaltbild Stromnetz (Zielnetz)',
  datei: 'netz-uebersichtsschaltbild-ziel',
  hinweis: 'Wie das Übersichtsschaltbild in 5.1.2, aber mit allen Planungen des Netzmodells: geplante Stationen und '
         + 'Kabel (Planungsschicht oder Baujahr in der Zukunft), geplante Maßnahmen an Trafos und Kabeln (Trafotausch, '
         + 'Querschnitt, Parallelsysteme) und Rückbau (Abrissjahr). Engpass-Vorschläge erscheinen erst, wenn sie als '
         + 'Maßnahme übernommen sind. Kennwerte als Bestand → Ziel.',
  render: cfg => ggRenderNetzUebersicht(cfg),
  config: {
    eyebrow: 'Stromnetz · Zielzustand', titel: 'Übersichtsschaltbild Zielnetz Mittelspannung',
    netz: null, kenngroessen: [], fussnote: '',
    leer: 'Kein Netzmodell — im Elektro-Tab NAP, Schaltanlagen und Trafos anlegen.',
  },
  ausProjekt(cfg) {
    const ist = ggNetzUebersichtDaten();
    const { netz, r } = ggNetzUebersichtDaten({ mitPlanung: true });
    cfg.netz = netz;
    const k = r.kennzahlen, ki = ist.r.kennzahlen;
    if (!Object.keys(r.stationen).length) {
      cfg.kenngroessen = []; cfg.fussnote = '';
      return '⚠ Kein Netzmodell — im Elektro-Tab NAP, Schaltanlagen und Trafos anlegen.';
    }
    if (/^Stromnetz · Zielzustand/.test(cfg.eyebrow || '')) {
      cfg.eyebrow = `Stromnetz · Zielzustand${k.zieljahr ? ' ' + k.zieljahr : ''}`;
    }
    const pfeil = (a, b, einh = '') => (a === b ? ggNum(b) : `${ggNum(a)} → ${ggNum(b)}`) + einh;
    cfg.kenngroessen = [
      ['Trafostationen', pfeil(ki.stationen, k.stationen)],
      ['Transformatoren', pfeil(ki.trafos, k.trafos)],
      ['installierte Leistung', pfeil(ki.kva, k.kva, ' kVA')],
      ['Abgänge / Ringe', `${pfeil(ki.abgaenge, k.abgaenge)} / ${pfeil(ki.ringe, k.ringe)}`],
      ...(k.msLaengeM > 0 ? [['MS-Kabel (Trasse)', `≈ ${ggNum(k.msLaengeM / 1000, 1)} km`]] : []),
    ];

    // Änderungen gegenüber dem Bestand
    const st = Object.values(r.stationen);
    const neuSt = st.filter(s => s.geplant).length;
    const tausch = st.reduce((n, s) => n + s.trafos.filter(t => t.ertuechtigt).length, 0);
    const zubau = st.filter(s => !s.geplant).reduce((n, s) => n + s.trafos.filter(t => t.geplant).length, 0);
    const neuV = r.verbindungen.filter(v => v.geplant).length;
    const ertV = r.verbindungen.filter(v => v.ertuechtigt).length;
    const rueckbau = Object.keys(ist.r.stationen).filter(key => !r.stationen[key]).map(key => {
      const s = ist.sicht(key);
      return s.zeile2 ? `${s.titel} (${s.zeile2})` : s.titel;
    });
    const mz = (n, e, m) => `${ggNum(n)} ${n === 1 ? e : m}`;
    const aend = [
      neuSt ? `Neubau ${mz(neuSt, 'Station', 'Stationen')}` : '',
      zubau ? `${mz(zubau, 'zusätzlicher Trafo', 'zusätzliche Trafos')}` : '',
      tausch ? `Tausch ${mz(tausch, 'Trafo', 'Trafos')}` : '',
      neuV ? `${mz(neuV, 'neue Kabelverbindung', 'neue Kabelverbindungen')}` : '',
      ertV ? `${mz(ertV, 'Kabelverbindung', 'Kabelverbindungen')} ertüchtigt` : '',
      rueckbau.length ? `Rückbau: ${ggResKuerzen(rueckbau.join(', '), 60)}` : '',
    ].filter(Boolean);
    const kabel = ggNuKabelText(r.verbindungen);
    cfg.fussnote = [
      `Zielzustand${k.zieljahr ? ' ' + k.zieljahr : ''}: alle Planungen des Netzmodells · schematische Darstellung, nicht lagerichtig`,
      aend.length ? `Änderungen gegenüber Bestand: ${aend.join(' · ')}` : 'Keine Änderungen gegenüber dem Bestand geplant',
      kabel ? `MS-Kabel je Verbindung (Ziel): ${kabel}` : '',
    ].filter(Boolean).join('\n');
    if (!aend.length) return '⚠ Im Netzmodell sind keine Planungen erfasst — das Zielnetz entspricht dem Bestand (3.1.2).';
    const hinw = r.hinweise;
    return `${hinw.length ? '⚠' : '✓'} Zielnetz: ${aend.join(', ')}.${hinw.length ? ' ' + hinw.join(' ') : ''}`;
  },
});

/* ── 3.1.3 Erzeugungsanlagen und 5.1.4 Notstromversorgung (Ist-Zustand) ─────────
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

/** Kapitel 5.1.3 Erzeugungsanlagen (Ist-Zustand) — PV, Wind, BHKW und Batteriespeicher im Bestand. */
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
      `Die Notstromversorgung wird in Kapitel 5.1.4 beschrieben. Möglichkeiten zur Eigenerzeugung und Speicherung `
        + `werden in der Variantenbildung (Kapitel 5.4) betrachtet.`,
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
      + `${eine ? 'Die Anlage ist' : 'Die Anlagen sind'} in die Wärmeversorgung eingebunden (vgl. Kapitel 3.1) und `
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
    + `(vgl. Kapitel 5.2) bereits um den selbst genutzten Anteil der Erzeugung vermindert. Geplante Anlagen werden `
    + `in der Variantenbildung (Kapitel 5.4) betrachtet.`);
  return ggTextBlatt(absaetze, T);
}

/** Kapitel 5.1.4 Notstromversorgung (Ist-Zustand) — Netzersatzanlagen (Assets Nsa) im Bestand. */
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
      `Anforderungen an eine künftige Notstromversorgung werden in Kapitel 5.4.3 sowie im Rahmen der Resilienzbewertung `
        + `in Kapitel 8 betrachtet.`,
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
      + `${ggNum(st.basisKw)} kW im Jahr ${st.dataYear} (vgl. Kapitel 5.2) entspricht die Notstromleistung rund `
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
    + `Notstromversorgung wird in Kapitel 5.4.3, ihre Bedeutung für die Resilienz der Liegenschaft in Kapitel 8 betrachtet.`);
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
      ? `${geplant.length} geplante (Planungsschicht oder Baujahr in der Zukunft) → Kapitel 5.4` : '—');
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
    kapitel: '5.1.3 Erzeugungsanlagen',
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
    kapitel: '5.1.3 Erzeugungsanlagen',
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
    kapitel: '5.1.4 Notstromversorgung',
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
    kapitel: '5.1.4 Notstromversorgung',
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
 * Für die Bedarfsprognose Strom (3.3.1–5.3.3): Ausgangswert, Rückbau, Zubau,
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

// ── Bedarfsprognose Strom (3.3.1–5.3.3) ──────────────────────────────────────
// Quelle: window.napBedarfsStand() aus der NAP-Analyse (13o) — Messbasis,
// Gleichzeitigkeitsfaktor und Maßnahmen-Haken werden dort eingestellt. Gerechnet
// wird mit lib/bedarfsprognose.js, derselben Rechnung wie die Lastentwicklung im
// NAP-Panel; die drei Kapitel sind Stufen einer Kaskade (Übertrag von Kapitel zu Kapitel).
const GG_BEDARF_TEXTE = {
  gebaeude: {
    kapitel: '5.3.1 Bestandsbedarf und bauliche Entwicklung',
    titel: 'Bestandsbedarf und bauliche Entwicklung', tabTitel: 'Bauliche Veränderungen',
    zubau: 'Neubau', summe: 'Gebäudebedarf', einheit: ['Gebäude', 'Gebäude'],
    herkunft: 'Verbraucher-Assets der Gebäude mit Baujahr bzw. Abrissjahr nach dem Messjahr (gepflegt im Gebäude-Tab). '
            + 'Ausgangspunkt ist die gemessene Höchstlast; Neubau addiert, Rückbau subtrahiert die Anschlussleistung.',
    leer: 'Keine baulichen Veränderungen erfasst — Neubau und Rückbau entstehen über Baujahr bzw. Abrissjahr im Gebäude-Tab.',
  },
  waerme: {
    kapitel: '5.3.2 Zusatzbedarf aus Wärmekonzept',
    titel: 'Zusatzbedarf aus dem Wärmekonzept', tabTitel: 'Elektrische Wärmeerzeuger',
    zubau: 'Zubau', summe: 'inkl. Wärmekonzept', einheit: ['Anlage', 'Anlagen'],
    herkunft: 'Wärmepumpen (Luft, Erdwärme, Fließgewässer), Elektrokessel und elektrische Warmwasserbereitung mit Baujahr '
            + 'nach dem Messjahr; gezählt wird die elektrische Leistungsaufnahme, nicht die Heizleistung.',
    leer: 'Keine elektrischen Wärmeerzeuger geplant — Wärmepumpen im Elektro-Tab mit Baujahr nach dem Messjahr anlegen.',
  },
  lade: {
    kapitel: '5.3.3 Zusatzbedarf Ladeinfrastruktur',
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

/* ── Gutachtentexte 3.3.1–5.3.3 ─────────────────────────────────────────────
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
    + `${ggBedarfFeld(basis, 'Höchstlast Bestand')} kW (vgl. Kapitel 5.2). Sie enthält den heutigen Gebäudebestand `
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
    + '3.3.2 und 5.3.3 gesondert ausgewiesen und in Kapitel 5.3.4 zur resultierenden Anschlussleistung zusammengeführt.');
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
    absaetze.push(`Das Wärmekonzept (vgl. Kapitel 7) sieht in der Variante ${variante} keine zusätzlichen elektrischen `
      + `Wärmeerzeuger vor. Ein Zusatzbedarf entsteht nicht; der Leistungsbedarf bleibt bei `
      + `${ggBedarfFeld(s?.startKw, 'Übertrag aus 5.3.1')} kW.`);
  } else {
    absaetze.push(`Mit der Umstellung der Wärmeversorgung (vgl. Kapitel 7) kommen elektrische Wärmeerzeuger hinzu. `
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
      + `${ggBedarfFeld(s.startKw, 'Übertrag aus 5.3.1')} kW auf ${ggBedarfFeld(s.endKw, 'Leistung inkl. Wärmekonzept')} kW. `
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
      + `der Leistungsbedarf bleibt bei ${ggBedarfFeld(s?.startKw, 'Übertrag aus 5.3.2')} kW.`);
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
      + `${ggBedarfDelta(s)}, von ${ggBedarfFeld(s.startKw, 'Übertrag aus 5.3.2')} kW auf `
      + `${ggBedarfFeld(s.endKw, 'Leistung inkl. Ladeinfrastruktur')} kW. Ein gesteuertes Laden kann die gleichzeitig `
      + 'abgerufene Leistung weiter begrenzen; es wird bei der Variantenbildung betrachtet. Die folgende Abbildung zeigt '
      + 'die Leistungsbilanz, die anschließende Tabelle die einzelnen Standorte.');
  }

  absaetze.push('Die resultierende Anschlussleistung und die Einspeiseleistung geplanter Erzeugungsanlagen werden in Kapitel 5.3.4 zusammengeführt.');
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
 * Zusammenführung der Stufen 3.3.1–5.3.3 (statisch, maßgeblich) und Abgleich mit der vereinbarten
 * Anschlussleistung. Geplante Erzeugung mindert den Bezug nicht und steht als Einspeiseleistung
 * getrennt (lib/bedarfsprognose.js); der zeitgleich überlagerte Endausbau-Lastgang der NAP-Analyse
 * erscheint nur als Vergleichswert im Text. */
const GG_KAP_RESULTIEREND = '5.3.4 Resultierende Anschlussleistung und Lastgang';
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

  absaetze.push('In diesem Kapitel werden die Ergebnisse der Kapitel 5.3.1 bis 5.3.3 zur resultierenden Anschlussleistung der '
    + `Liegenschaft zusammengeführt. Ausgangspunkt ist die ${st && !st.gemessen && basis ? 'synthetisch ermittelte' : 'gemessene'} `
    + `Höchstlast von ${ggBedarfFeld(basis, 'Höchstlast Bestand')} kW im Jahr ${ggTextFeld(st?.dataYear, 'Messjahr')} (vgl. Kapitel 5.2).`);

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
          + 'zu beantragen; die Varianten dazu werden in Kapitel 5.4.1 betrachtet.'));
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
    absaetze.push('Die Auswirkungen auf Netzanschluss und internes Stromnetz werden in Kapitel 5.4.1 betrachtet.');
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
    hinweis: 'Zusammenführung von 3.3.1–5.3.3 zur resultierenden Anschlussleistung und Abgleich mit der vereinbarten '
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
 * aufbauend auf der resultierenden Anschlussleistung aus 5.3.4. Internes Netz: Ergebnis des
 * Engpass-Sweeps (14h) mit dem Ertüchtigungsvorschlag je Betriebsmittel (window.engpassVorschlag,
 * schreibt nichts). Kosten stehen bewusst erst in 5.5. */
const GG_KAP_NETZ = '5.4.1 Netzanschluss und internes Stromnetz';

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
      + `(vgl. Kapitel 5.3.4) ist der vereinbarten Anschlussleistung von ${ggTextFeld('', 'Vereinbarte Anschlussleistung kVA')} kVA `
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
      + `${ggNum(cap)} kVA ${wann}um ${ggNum(r.endKw - cap)} kW (vgl. Kapitel 5.3.4). `
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
        + `${ggNum(rv.ladeKw)} kW zur resultierenden Anschlussleistung bei (vgl. Kapitel 5.3.3). `
        + (rv.verfuegbar >= 0
          ? `Innerhalb der vereinbarten Anschlussleistung stehen für das Laden ${ggNum(rv.verfuegbar)} kW zur Verfügung, das sind `
            + `${pct(rv.verfuegbar)} % der Auslegungsleistung. Begrenzt ein dynamisches Lademanagement die gesamte Ladeleistung auf `
            + 'diesen Wert, ist eine Erhöhung der Anschlussleistung nicht erforderlich.'
            + (rv.verfuegbar / rv.ladeKw < 0.5 ? ' Bei dieser deutlichen Begrenzung ist ein uneingeschränkter Ladebetrieb jedoch nicht gewährleistet.' : '')
          : `Bereits ohne Ladeinfrastruktur übersteigt der Leistungsbedarf von ${ggNum(rv.ohneLade)} kW die vereinbarte `
            + 'Anschlussleistung. Ein Lademanagement kann die Erhöhung deshalb nicht vermeiden, verringert aber die zu beantragende '
            + `Anschlussleistung auf mindestens ${ggNum(Math.ceil(rv.ohneLade))} kVA zuzüglich der für das Laden vorgehaltenen Leistung.`)
        + ' Betriebsweise und Auswirkungen auf den Ladebetrieb beschreibt Kapitel 5.4.4.');
      absaetze.push('Variante A lässt den Ladebetrieb uneingeschränkt, erfordert aber den Antrag beim Netzbetreiber mit '
        + 'Baukostenzuschuss und Vorlaufzeit. Variante B '
        + (rv.verfuegbar >= 0 ? 'kommt ohne Antrag aus' : 'verringert den Antrag')
        + ', begrenzt aber die Ladeleistung und braucht eine Steuerung der Ladepunkte. Die Kosten der Erhöhung stehen in '
        + `Kapitel 5.5; für das Lademanagement sind ${ggTextFeld('', 'Kosten Lademanagement, z. B. laut Herstellerangebot')} anzusetzen. `
        + 'Die Bewertung beider Varianten folgt in Kapitel 5.6.');
    }
  } else {
    const reserve = cap - r.endKw;
    absaetze.push(`Die resultierende Anschlussleistung von ${ggNum(r.endKw)} kW bleibt innerhalb der vereinbarten Anschlussleistung `
      + `von ${ggNum(cap)} kVA (Reserve ${ggNum(reserve)} kW bzw. ${ggNum(reserve / cap * 100)} %, vgl. Kapitel 5.3.4). Eine Erhöhung `
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
    + 'die einzelnen Engpässe mit der vorgesehenen Ertüchtigung. Die Kosten der Ertüchtigungen werden in Kapitel 5.5 ausgewiesen.');
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
    + 'Maßnahmen-Generators, im Projekt wird dafür nichts angelegt. Kosten folgen in Kapitel 5.5. Bestandsmängel bitte im '
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
           + 'vorgeschlagener Ertüchtigung und Umsetzungsjahr — ohne Kosten (Kapitel 5.5). Bestandsmängel und nicht lösbare '
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
                   + `oder ΔU > ${ggNum(g.deltaUKumPct)} % · Umsetzung ${ENGPASS_VORLAUF_J} Jahre vor Engpass · Kosten siehe Kapitel 5.5`;
      return liste.length
        ? `✓ ${liste.length} Engpässe aus dem Netzmodell (${res.von}–${res.bis}) übernommen.`
        : `✓ Keine Engpässe im Netzmodell bis ${res.bis}.`;
    },
  },
);

// ── PV-Analyse: Varianten, Energiebilanz, Wirtschaftlichkeit, Resilienz ───────
// Quelle: window._pvAnalyse.ergebnisse (gefüllt in src/09d-pv-analyse.js über
// „Varianten berechnen") bzw. window._pvResReco (PV-Analyse › Kapitel 6.1). Ohne
// gelaufene Berechnung liefert ausProjekt eine Hinweismeldung statt Zahlen.
// Als eigene Funktion statt direkt im Array-Literal: die Helfer/Konstanten
// darunter (GG_PV_KURZ etc.) sind sonst beim Auswerten von GG_FIGUREN noch
// nicht initialisiert (TDZ) — der Push erfolgt erst, nachdem alles definiert ist.

/* ══════════════════════════════════════════════════════════════════════════
 * 3g) RENDERER — „Herleitung": mehrere kleine Kriterien-Diagramme nebeneinander
 *
 * Für Kapitel 5.4.2: belegt, WARUM eine Auslegung die gewählte ist. Je Panel
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
 * Für Kapitel 5.4.2: das Einlinienschema der Netzaufnahme (Trafo → Kabel →
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
 * Für Kapitel 5.4.2: die gleichzeitige Rückspeiseleistung am Netzanschluss-
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

/* ── Gutachtentexte Kapitel 5.4.2 PV-Anlage und Batteriespeicher ─────────────
 * Fünf Textbausteine, die das Standarddokument über `reihe` zwischen die
 * Abbildungen setzt: Grundlagen → Herleitung → Energiebilanz-Text → Tabelle +
 * Energiebilanz → Speicher → Netzintegration → Rückspeisung → Abgrenzung.
 * Werte stammen aus dem letzten „Varianten berechnen" (ergebnisse + basis in
 * window._pvAnalyse), nie aus den aktuellen Eingabefeldern — sonst zeigten Text
 * und Abbildungen verschiedene Stände. Wie die Abbildungen bewusst ohne Euro-Werte
 * und ohne „beste" Variante: bewertet wird in 5.5. */
const GG_PV_LANG = { 'minimal': 'Minimal', 'bestandsnetz': 'Bestandsnetz', 'netz-eigen': 'Bestandsnetz, eigene Belegung', 'ev-opt': 'Eigenverbrauchs-optimiert', 'wirt-opt': 'Wirtschaftlich optimiert',
                     'autarkie': 'Autarkie-optimiert', 'max-pv': 'Maximaler PV-Ausbau' };
const GG_PV_KAPITEL = '5.4.2 PV-Anlage und Batteriespeicher';
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
    ? ' Der Lastgang enthält zusätzlich den Strombedarf der elektrischen Wärmeerzeugung (Wärmepumpen und Stromkessel, vgl. Kapitel 7).'
    : b?.lastfall === 'endausbau'
      ? ` Der Lastgang bildet den Endausbau bis zum Jahr ${ggTextFeld(b.endausbauJahr, 'Zieljahr')} einschließlich der geplanten Neubau- und Rückbaumaßnahmen ab (vgl. Kapitel 5.3.1).`
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
    + `sind in der Planung abzustimmen. Wie gut die Speicher Netzausfälle überbrücken, wird in Kapitel 8.2 bewertet. `
    + `Die Notstromversorgung beschreibt Kapitel 5.4.3.`);
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
      + `Netzbetreiber abzustimmen (vgl. Kapitel 5.4.1).`);
  }
  ergebnis.push('Diese Abschätzung ersetzt keine Netzverträglichkeitsprüfung durch den Netzbetreiber.');
  absaetze.push(ergebnis.join(' '));
  return ggTextBlatt(absaetze, T);
}

/** 3.4.2 Teil 5 — Abgrenzung zu 3.5 und Modellgrenzen. */
function ggRenderPvAbgrenzungText(cfg, T = GG_THEME) {
  void cfg;
  return ggTextBlatt([
    `Die wirtschaftliche Bewertung folgt in Kapitel 5.5. Die Berechnung beruht auf einem einzigen Wetterjahr und `
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

/**
 * Prinzip der Netzanbindung der Erzeugungsanlagen mit EZA-Regler (3.4.2): Übergabestation am NAP mit Wandlern,
 * Zähler, übergeordnetem Entkupplungsschutz und Leistungsschalter; dahinter das eigene MS-Netz der Liegenschaft
 * mit Trafostationen im Ring (offene Trennstelle). PV, Batterie, BHKW und Verbraucher hängen auf der NS-Seite der
 * Stationen. Der EZA-Regler an der Übergabe führt alle Einheiten über ein eigenes LWL-Steuernetz; zum Leitsystem
 * der Liegenschaft nur über eine IT-sichere Schnittstelle. Gestrichelt die Liegenschaftsgrenze.
 * Rein schematisch — keine Auslegung.
 * cfg.werte = { uKv, stationen, pvKwp, batKw, kwkKw, einspKw } (leer = allgemein)
 */
export function ggRenderEzaPrinzip(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, rot = T.energy.waerme, blau = T.energy.strom;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const strich = T.text.strong, fein = T.text.faint;
  const w = cfg.werte || {};
  const uKv = w.uKv || 20;
  const uTxt = ggNum(uKv, uKv % 1 ? 1 : 0);
  const top = S.headBand + S.headHSchmal + 26;
  const ky = top + 216;             // Leistungsschalter der Übergabestation
  const msY = top + 276;            // MS-Sammelschiene der Übergabestation
  const ringY = msY + 84;           // Ringkabel durch die Stationen
  const nsY = ringY + 92;           // NS-Sammelschienen der Stationen
  const grenzeU = nsY + 164;        // Unterkante Liegenschaftsgrenze
  const legTop = grenzeU + 22;
  // Legende zweispaltig, bis zu drei Zeilen je Punkt — Zeilenhöhe je Reihe nach dem längeren Punkt
  const punkte = cfg.punkte || [];
  const colW = (W - 2 * S.padX) / 2;
  const legZeilen = punkte.map(t => ggResUmbruch(t, Math.floor((colW - 40) / (11 * 0.53))).slice(0, 3));
  const reihenH = [];
  for (let i = 0; i < legZeilen.length; i += 2) {
    reihenH.push(Math.max(legZeilen[i].length, legZeilen[i + 1]?.length || 0, 2) * 14 + 10);
  }
  const legH = reihenH.reduce((s, h) => s + h, 0);
  const height = legTop + legH + (cfg.fussnote ? 22 : 0) + S.footSpace + 6;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);
  const nr = (x, y, k) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="10" fill="${gruen}"/>`
    + txt(x, y + 4, String(k), { anchor: 'middle', size: 11, weight: 700, fill: '#FFFFFF' });
  // Leistungsschalter senkrecht von y bis y + 30 (wie im Inselbetrieb-Prinzip)
  const schalter = (x, y, farbe = strich) => {
    const k = y + 30;
    return `<path d="M${gR(x - 4)} ${k - 4}l8 8M${gR(x + 4)} ${k - 4}l-8 8" stroke="${farbe}" stroke-width="1.6"/>`
      + `<line x1="${gR(x)}" y1="${y}" x2="${gR(x)}" y2="${k}" stroke="${farbe}" stroke-width="2"/>`
      + `<circle cx="${gR(x)}" cy="${y}" r="2.4" fill="${farbe}"/>`;
  };
  const linie = (x1, y1, x2, y2, o = {}) => `<line x1="${gR(x1)}" y1="${gR(y1)}" x2="${gR(x2)}" y2="${gR(y2)}"
      stroke="${o.farbe || strich}" stroke-width="${o.breite || 2}"${o.strich ? ` stroke-dasharray="${o.strich}"` : ''}${o.pfeil ? ` marker-end="url(#${o.pfeil})"` : ''}/>`;
  const pfad = (d, o = {}) => `<path d="${d}" fill="none" stroke="${o.farbe || strich}" stroke-width="${o.breite || 2}"
      ${o.strich ? `stroke-dasharray="${o.strich}"` : ''}${o.pfeil ? ` marker-end="url(#${o.pfeil})"` : ''}/>`;
  const kasten = (x, y, bw, bh, o = {}) => `<rect x="${gR(x) + 0.5}" y="${gR(y) + 0.5}" width="${bw}" height="${bh}"
      fill="${o.fill || T.neutral.cardBg}" stroke="${o.rand || T.rule}" stroke-width="${o.breite || 1.4}"${o.strich ? ` stroke-dasharray="${o.strich}"` : ''}/>`;
  const wandler = (x, y) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="7" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.6"/>`;
  const trafo = (x, y, r = 10) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="${r}" fill="none" stroke="${strich}" stroke-width="1.5"/>
      <circle cx="${gR(x)}" cy="${gR(y + r * 1.4)}" r="${r}" fill="none" stroke="${strich}" stroke-width="1.5"/>`;
  const naSchutz = (x, y) => kasten(x, y, 20, 16, { rand: rot, breite: 1.2 })
    + txt(x + 10, y + 11.5, 'NA', { anchor: 'middle', size: 9, weight: 700, fill: rot });
  out = `<defs>
      <marker id="gg-eza-pf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${fein}"/></marker>
      <marker id="gg-eza-pf-rot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${rot}"/></marker>
    </defs>` + out;

  // ── Liegenschaftsgrenze (zuerst, damit alles darüber liegt) ──
  const gO = top + 54;
  out += `<rect x="18.5" y="${gO + 0.5}" width="${W - 37}" height="${grenzeU - gO}" rx="10" fill="none"
            stroke="${T.text.muted}" stroke-width="1.4" stroke-dasharray="10 5"/>`;
  out += `<rect x="30" y="${gO - 7}" width="${ggEstW('LIEGENSCHAFTSGRENZE', 10) + 24}" height="14" fill="${T.bg}"/>`;
  out += txt(40, gO + 4, 'LIEGENSCHAFTSGRENZE', { mono: true, size: 10, weight: 600, tracking: 1, fill: T.text.muted });

  // ── Netz des Netzbetreibers, Übergabe am NAP ──
  const hx = 300;
  out += kasten(hx - 100, top, 200, 38, { rand: blau, strich: '5 3', breite: 1.2 });
  out += txt(hx, top + 16, 'Netz des Netzbetreibers', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(hx, top + 31, `Mittelspannung ${uTxt} kV`, { anchor: 'middle', size: 11, fill: T.text.muted });
  out += linie(hx, top + 38, hx, ky);
  out += `<circle cx="${hx}" cy="${top + 72}" r="4" fill="${strich}"/>`;
  out += txt(hx + 22, top + 70, 'Netzanschlusspunkt (NAP)', { size: 11.5, weight: 600 });
  out += txt(hx + 22, top + 85, 'Eigentumsgrenze, Übergabestation', { size: 11, fill: T.text.muted });
  out += nr(hx - 24, top + 72, 1);

  // ── Wandler: oben Abrechnung, darunter Schutz und Regelung ──
  const w1 = top + 112, w2 = top + 146;
  out += wandler(hx, w1) + wandler(hx, w2);
  out += nr(hx - 24, w2 - 16, 2);
  out += linie(hx + 7, w1, hx + 40, w1, { farbe: fein, breite: 1.2, strich: '4 3' });
  out += kasten(hx + 40, w1 - 14, 118, 28);
  out += txt(hx + 99, w1 + 4.5, 'Zähler ⇄ (RLM)', { anchor: 'middle', size: 11, weight: 600 });
  out += nr(hx + 172, w1, 3);

  // ── Übergeordneter Entkupplungsschutz → Leistungsschalter der Übergabe ──
  const ex = 40, ew = 196, ey = top + 124, eh = 70;
  out += kasten(ex, ey, ew, eh, { rand: rot, breite: 1.6 });
  out += txt(ex + ew / 2, ey + 19, 'Entkupplungsschutz', { anchor: 'middle', size: 12, weight: 700 });
  out += txt(ex + ew / 2, ey + 35, 'übergeordnet, am NAP', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += txt(ex + ew / 2, ey + 52, 'U<  U>  U>>  ·  Q-U-Schutz', { anchor: 'middle', size: 10.5, mono: true, fill: T.text.muted });
  out += linie(hx - 7, w2, ex + ew + 2, w2, { farbe: fein, breite: 1.2, strich: '4 3', pfeil: 'gg-eza-pf' });
  out += nr(ex + ew, ey, 4);
  out += schalter(hx, ky);
  out += pfad(`M${ex + ew / 2} ${ey + eh}V${ky + 18}H${hx - 10}`, { farbe: rot, breite: 1.4, strich: '5 3', pfeil: 'gg-eza-pf-rot' });
  out += txt(ex + ew / 2 + 8, ky + 12, 'Auslösung', { size: 10.5, fill: rot });
  out += txt(hx + 22, ky + 12, 'Leistungsschalter Übergabe', { size: 11.5, weight: 600 });
  out += txt(hx + 22, ky + 27, 'Kurzschlussschutz, Kuppelschalter', { size: 11, fill: T.text.muted });
  out += nr(hx + 230, ky + 16, 5);
  out += linie(hx, ky + 30, hx, msY);

  // ── MS-Sammelschiene der Übergabestation und Ring der Liegenschaft ──
  const fA = hx - 80, fB = hx + 80, ringL = 110, ringR = 905, fY = msY + 34;
  out += linie(fA - 20, msY, fB + 20, msY, { breite: 5, farbe: gruen });
  out += txt(fB + 30, msY - 8, `MS-Netz der Liegenschaft ${uTxt} kV · Ring`, { size: 11, weight: 600, fill: gruen });
  out += pfad(`M${fA} ${msY}V${fY}H${ringL}V${ringY}H${ringR}V${fY}H${fB}V${msY}`, { farbe: gruen, breite: 2.2 });
  out += nr(ringL, fY, 11);

  // Stationen im Ring
  const stN = Math.max(1, w.stationen || 0);
  const stationen = [
    { x: 235, titel: 'Station 1', abg: ['pv', 'last'] },
    { x: 510, titel: 'Station 2', abg: ['pv', 'bat'] },
    { x: 785, titel: stN > 3 ? `Station ${stN}` : 'Station n', abg: ['pv', 'bhkw'] },
  ];
  const trennX = (stationen[1].x + stationen[2].x) / 2;
  const wrW = 56, wrH = 40, wrY = nsY + 34, busK = nsY + 20;
  const gy = wrY + wrH + 12;
  const wrPunkte = [];
  let bhkwX = null;
  for (const st of stationen) {
    const sx = st.x - 88, sw = 176;
    out += kasten(sx, ringY - 26, sw, 94, { fill: T.tint, rand: T.accents.gruen, breite: 1.2 });
    out += linie(sx + 10, ringY, sx + sw - 10, ringY, { breite: 4.5, farbe: gruen });
    out += txt(sx + 8, ringY - 11, st.titel, { size: 11, weight: 700 });
    // Ringkabelfelder (Lasttrennschalter) links und rechts, Trafofeld in der Mitte
    for (const dx of [-60, 60]) {
      out += `<circle cx="${st.x + dx}" cy="${ringY}" r="4.5" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.4"/>`;
    }
    out += linie(st.x, ringY, st.x, ringY + 12);
    out += trafo(st.x, ringY + 22);
    out += txt(st.x + 16, ringY + 30, `${uTxt}/0,4 kV`, { size: 10, fill: T.text.muted });
    out += linie(st.x, ringY + 46, st.x, nsY);
    out += linie(st.x - 96, nsY, st.x + 96, nsY, { breite: 4 });
    // Abgänge auf der NS-Seite
    st.abg.forEach((art, i) => {
      const ax = st.x + (i ? 50 : -50);
      if (art === 'last') {
        out += linie(ax, nsY, ax, wrY);
        out += kasten(ax - 40, wrY, 80, 34, { rand: T.rule });
        out += txt(ax, wrY + 21, 'Verbraucher', { anchor: 'middle', size: 10.5, weight: 600 });
        return;
      }
      if (art === 'bhkw') {
        // Synchrongenerator direkt am Netz, angetrieben vom Gasmotor; Einheitenschutz am Generator
        bhkwX = ax;
        out += linie(ax, nsY, ax, wrY + 2);
        out += linie(ax + 14, busK, ax + 14, wrY + 8, { farbe: gruen, breite: 1.3, strich: '4 3' });
        wrPunkte.push(ax + 14);
        out += `<circle cx="${ax}" cy="${wrY + 20}" r="18" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>`;
        out += txt(ax, wrY + 19, 'G', { anchor: 'middle', size: 12, weight: 700, fill: gruen });
        out += txt(ax, wrY + 31, '3~', { anchor: 'middle', size: 9, fill: gruen });
        out += naSchutz(ax - 44, wrY + 11);
        out += linie(ax, wrY + 38, ax, gy, { breite: 3 });
        out += kasten(ax - 28, gy, 56, 28, { rand: strich, breite: 1.2 });
        out += txt(ax, gy + 18, 'Motor', { anchor: 'middle', size: 9.5, weight: 600 });
        out += linie(ax + 29, gy + 14, ax + 50, gy + 14, { farbe: rot, breite: 1.6, pfeil: 'gg-eza-pf-rot' });
        out += txt(ax + 54, gy + 18, 'Wärme', { size: 9.5, fill: rot });
        out += txt(ax, gy + 42, 'BHKW (KWK)', { anchor: 'middle', size: 10.5, fill: T.text.muted });
        return;
      }
      out += linie(ax, nsY, ax, wrY);
      out += linie(ax + 14, busK, ax + 14, wrY - 1, { farbe: gruen, breite: 1.3, strich: '4 3' });
      wrPunkte.push(ax + 14);
      const bx = ax - wrW / 2;
      out += kasten(bx, wrY, wrW, wrH, { fill: T.tint, rand: gruen, breite: 1.4 });
      out += linie(bx, wrY + wrH, bx + wrW, wrY, { farbe: gruen, breite: 1 });
      out += txt(bx + 11, wrY + 15, '=', { anchor: 'middle', size: 12, weight: 700 });
      out += txt(bx + wrW - 11, wrY + wrH - 7, '~', { anchor: 'middle', size: 13, weight: 700 });
      out += naSchutz(bx - 24, wrY + 11);
      out += linie(ax, wrY + wrH, ax, gy, { farbe: blau, breite: 1.6 });
      if (art === 'pv') {
        out += kasten(ax - 28, gy, 56, 28, { fill: '#FFF8D6', rand: strich, breite: 1.2 });
        out += `<path d="M${ax - 28} ${gy + 14}h56M${ax - 9} ${gy}v28M${ax + 9} ${gy}v28" stroke="${strich}" stroke-width="0.8"/>`;
        out += txt(ax, gy + 42, 'PV', { anchor: 'middle', size: 10.5, fill: T.text.muted });
      } else {
        out += kasten(ax - 24, gy, 48, 28, { rand: strich, breite: 1.2 });
        out += `<path d="M${ax - 9} ${gy + 6}v16M${ax + 2} ${gy + 10}v8" stroke="${strich}" stroke-width="2.4"/>`
          + txt(ax + 14, gy + 18, '+', { anchor: 'middle', size: 10, weight: 700 });
        out += txt(ax, gy + 42, 'Batterie', { anchor: 'middle', size: 10.5, fill: T.text.muted });
      }
    });
  }
  // offene Trennstelle im Ring zwischen Station 2 und n
  out += `<rect x="${trennX - 14}" y="${ringY - 5}" width="28" height="10" fill="${T.bg}"/>`;
  out += `<circle cx="${trennX - 12}" cy="${ringY}" r="2.4" fill="${gruen}"/>`
    + linie(trennX - 12, ringY, trennX + 10, ringY - 10, { farbe: gruen, breite: 2 });
  out += txt(trennX, ringY + 20, 'offene', { anchor: 'middle', size: 10, fill: T.text.muted })
    + txt(trennX, ringY + 32, 'Trennstelle', { anchor: 'middle', size: 10, fill: T.text.muted });
  out += nr(trennX, ringY - 22, 12);
  out += nr(stationen[0].x - 50 - wrW / 2 - 38, wrY + 4, 9);
  out += nr(stationen[1].x + 50 + wrW / 2 + 14, wrY + 4, 10);
  if (bhkwX != null) out += nr(bhkwX + 32, wrY + 2, 13);

  // ── EZA-Regler mit Fernwirktechnik, Direktvermarkter und Leitsystem ──
  const rx = 540, rw = 230, ry = top + 124, rh = 78;
  out += kasten(rx, ry, rw, rh, { fill: T.tint, rand: gruen, breite: 1.8 });
  out += txt(rx + rw / 2, ry + 21, 'EZA-Regler', { anchor: 'middle', size: 13, weight: 700 });
  out += txt(rx + rw / 2, ry + 39, 'Wirk- und Blindleistung am NAP', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += txt(rx + rw / 2, ry + 54, 'P-Begrenzung · cos φ · Q(U)', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  if (w.einspKw) out += txt(rx + rw / 2, ry + 69, `Einspeisung ≤ ${ggNum(w.einspKw)} kW`, { anchor: 'middle', size: 10.5, weight: 600, fill: gruen });
  out += nr(rx - 12, ry + rh - 8, 6);
  out += linie(hx + 7, w2, rx - 2, w2, { farbe: fein, breite: 1.2, strich: '4 3', pfeil: 'gg-eza-pf' });
  out += txt(hx + 48, w2 - 6, 'Messung U, I', { size: 10, fill: T.text.faint });
  // Leitstelle Netzbetreiber
  const lx = 540, lw = 170;
  out += kasten(lx, top, lw, 42, { rand: blau, breite: 1.2 });
  out += txt(lx + lw / 2, top + 17, 'Leitstelle', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(lx + lw / 2, top + 33, 'Netzbetreiber', { anchor: 'middle', size: 11, fill: T.text.muted });
  out += linie(lx + 60, top + 42, lx + 60, ry - 2, { farbe: fein, breite: 1.4, strich: '4 3', pfeil: 'gg-eza-pf' });
  out += txt(lx + 68, top + 76, 'Fernwirktechnik', { size: 10.5, fill: T.text.muted });
  out += txt(lx + 68, top + 90, 'Sollwerte · Rückmeldung', { size: 10, fill: T.text.faint });
  out += nr(lx + 44, top + 70, 7);
  // Direktvermarkter — von oben in den Regler, rechts bleibt Platz für die Schnittstelle
  const dx = 790, dw = 170;
  out += kasten(dx, top, dw, 42, { rand: T.rule, breite: 1.2 });
  out += txt(dx + dw / 2, top + 17, 'Direktvermarkter', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(dx + dw / 2, top + 33, 'Fernsteuerung', { anchor: 'middle', size: 11, fill: T.text.muted });
  out += pfad(`M${dx + dw / 2} ${top + 42}V${ry - 18}H${rx + rw - 40}V${ry - 2}`, { farbe: fein, breite: 1.4, strich: '4 3', pfeil: 'gg-eza-pf' });
  out += txt(dx + dw / 2 + 8, top + 76, 'Steuerbox', { size: 10.5, fill: T.text.muted });
  out += nr(dx + dw / 2 - 16, top + 70, 8);
  // IT-sichere Schnittstelle und Leitsystem der Liegenschaft
  const ix = 800, iw = 160, iy = ry - 4, ih = 40;
  out += linie(rx + rw + 1, iy + 20, ix, iy + 20, { farbe: gruen, breite: 1.6 });
  out += kasten(ix, iy, iw, ih, { fill: T.neutral.cardBg, rand: rot, breite: 1.6 });
  out += txt(ix + iw / 2, iy + 16, 'IT-sichere Schnittstelle', { anchor: 'middle', size: 10.5, weight: 700 });
  out += txt(ix + iw / 2, iy + 31, 'Datendiode · Firewall', { anchor: 'middle', size: 9.5, fill: T.text.muted });
  out += nr(ix + iw, iy, 15);
  const sy = iy + ih + 18, sh = 34;
  out += linie(ix + iw / 2, iy + ih, ix + iw / 2, sy, { farbe: fein, breite: 1.6 });
  out += kasten(ix, sy, iw, sh, { rand: T.rule });
  out += txt(ix + iw / 2, sy + 14, 'Leitsystem Liegenschaft', { anchor: 'middle', size: 10.5, weight: 700 });
  out += txt(ix + iw / 2, sy + 27, 'GLT / Energiemanagement', { anchor: 'middle', size: 9.5, fill: T.text.muted });
  out += nr(ix + iw, sy + sh, 16);

  // Steuernetz EZA-Regler → Wechselrichter/BHKW: eigene LWL-Fasern, rechts am Ring vorbei
  const kx = 958, kY = ry + 106;
  out += pfad(`M${rx + rw - 20} ${ry + rh}V${kY}H${kx}V${busK}H${Math.min(...wrPunkte)}`, { farbe: gruen, breite: 1.6, strich: '4 3' });
  out += txt(rx + rw + 2, kY + 15, 'Sollwerte P, Q an WR und BHKW', { size: 10, fill: gruen });
  const lwlMitte = (fY + busK) / 2 + 10;
  // gedreht links neben der Leitung, zwischen Ring und Steuernetz
  out += txt(kx - 5, lwlMitte, 'Steuernetz · 2 LWL-Fasern BWI-Netz', {
    anchor: 'middle', size: 10, weight: 600, fill: gruen, transform: `rotate(-90 ${kx - 5} ${gR(lwlMitte)})` });
  out += nr(kx, fY - 18, 14);

  // Kennwerte der Liegenschaft
  const kenn = [
    w.stationen ? `${w.stationen} Trafostation${w.stationen === 1 ? '' : 'en'}` : null,
    w.pvKwp ? `PV gesamt ${ggNum(w.pvKwp)} kWp` : null,
    w.batKw ? `Batterie ${ggNum(w.batKw)} kW` : null,
    w.kwkKw ? `BHKW ${ggNum(w.kwkKw)} kW el.` : null,
  ].filter(Boolean);
  if (kenn.length) out += txt(W / 2, nsY + 150, kenn.join('  ·  '), { anchor: 'middle', size: 11, weight: 600, fill: gruen });

  // ── Nummernlegende zweispaltig ──
  let py = legTop;
  reihenH.forEach((h, r) => {
    for (let c = 0; c < 2; c++) {
      const i = r * 2 + c;
      if (i >= legZeilen.length) break;
      const px = S.padX + c * colW;
      out += nr(px + 10, py + 6, i + 1);
      legZeilen[i].forEach((z, j) => { out += txt(px + 28, py + 10 + j * 14, z, { size: 11 }); });
    }
    py += h;
  });
  if (cfg.fussnote) out += txt(S.padX, legTop + legH + 8, cfg.fussnote, { size: S.fsTab - 2, fill: T.text.faint });
  return ggFinishSvg(out, W, height);
}

const GG_EZA_PUNKTE = Object.freeze([
  'Netzanschlusspunkt: Eigentumsgrenze zum Netzbetreiber, Übergabestation der Liegenschaft',
  'Strom- und Spannungswandler am NAP liefern die Messgrößen für Schutz und Regelung',
  'Zähler für Bezug und Einspeisung (registrierende Leistungsmessung, Zweirichtung)',
  'übergeordneter Entkupplungsschutz am NAP: Spannungsschutz und Q-U-Schutz nach VDE-AR-N 4110',
  'Leistungsschalter der Übergabe mit Kurzschlussschutz, trennt bei Auslösung das Liegenschaftsnetz vom Netz',
  'EZA-Regler: regelt Wirk- und Blindleistung aller Erzeugungseinheiten am NAP, begrenzt die Einspeisung auf die Anschlusszusage',
  'Fernwirktechnik zum Netzbetreiber: Sollwerte und Reduzierstufen, Rückmeldung von Messwerten',
  'Steuerbox des Direktvermarkters: Fernsteuerung der Einspeisung nach Marktsignalen',
  'Wechselrichter mit Einheitenschutz (integrierter NA-Schutz) und Einheitenzertifikat',
  'Batteriespeicher über eigenen Wechselrichter, ebenfalls vom EZA-Regler geführt',
  'eigenes MS-Netz der Liegenschaft: Trafostationen mit Ringkabelfeldern, Erzeugung speist auf der NS-Seite ein',
  'offene Trennstelle: Ring offen betrieben, bei Kabelfehler Umschaltung auf die zweite Einspeiserichtung',
  'KWK-Anlage (BHKW) mit Synchrongenerator und eigenem Einheitenschutz; Teil der Erzeugungsanlage am NAP, '
    + 'ebenfalls vom EZA-Regler geführt (P über die Motorregelung, Q über die Erregung)',
  'Steuernetz EZA-Regler – Wechselrichter/BHKW über zwei eigene Fasern des BWI-LWL-Netzes: physisch getrenntes Netz '
    + 'ohne Verbindung zur übrigen IT der Liegenschaft',
  'IT-sichere Schnittstelle zum Leitsystem, z. B. Datendiode (Messwerte nur lesend ins Leitsystem), Industrie-Firewall '
    + 'mit Positivliste und DMZ, Protokoll-Gateway (z. B. IEC 60870-5-104 → OPC UA); Zonen nach IEC 62443',
  'Leitsystem der Liegenschaft (GLT/Energiemanagement): Anzeige und Auswertung, kein direkter Schreibzugriff auf '
    + 'EZA-Regler, Wechselrichter oder BHKW',
]);
const GG_EZA_FUSSNOTE = 'Prinzipskizze ohne Auslegung. Nachweise nach VDE-AR-N 4110: Einheitenzertifikate, Anlagenzertifikat (alle Einheiten am NAP), Konformitätserklärung.';

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

    // ── Prinzipskizze Netzanbindung mit EZA-Regler ───────────────────────
    {
      id: 'pv-eza-prinzip',
      autoSync: true,
      reihe: 85,   // nach „Rückspeisung und Netzverträglichkeit“, vor dem Abgrenzungstext
      kapitel: GG_PV_KAPITEL,
      titel: 'Prinzip Netzanbindung mit EZA-Regler und Entkupplungsschutz',
      datei: 'pv-eza-regler-prinzip',
      hinweis: 'Prinzipskizze: Übergabestation am NAP mit Wandlern, Zähler, übergeordnetem Entkupplungsschutz und '
             + 'Leistungsschalter; eigenes MS-Netz mit Trafostationen im Ring (offene Trennstelle), PV, Batterie und BHKW auf '
             + 'der NS-Seite; EZA-Regler mit Fernwirktechnik und Direktvermarkter führt alle Einheiten über ein eigenes '
             + 'LWL-Steuernetz (2 Fasern BWI-Netz), zum Leitsystem nur über eine IT-sichere Schnittstelle; gestrichelt die '
             + 'Liegenschaftsgrenze. Nennspannung aus dem NAP, Zahl der Trafostationen, PV-/Batterie-/BHKW-Leistung und '
             + 'Einspeisegrenze aus dem Projekt.',
      render: cfg => ggRenderEzaPrinzip(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten · Netzintegration PV',
        titel: 'Netzanbindung mit EZA-Regler und Entkupplungsschutz',
        werte: {},
        punkte: GG_EZA_PUNKTE,
        fussnote: GG_EZA_FUSSNOTE,
      },
      ausProjekt(cfg) {
        const items = window.ASSETS?.items || [];
        const nap = items.find(a => a.type === 'NAP');
        const uKv = parseFloat(nap?.props?.spannungKV) || 0;
        const summe = (typ, key) => items.filter(a => a.type === typ)
          .reduce((s, a) => s + (parseFloat(a.props?.[key]) || 0), 0);
        const einsp = parseFloat(window.elNapMaxEinspKw) || 0;
        cfg.werte = {
          uKv: uKv > 1 ? uKv : 20,
          stationen: items.filter(a => a.type === 'Trafo').length || null,
          pvKwp: summe('PV', 'leistungKWp') || null,
          batKw: summe('Batterie', 'leistungKW') || null,
          kwkKw: summe('KWK', 'leistungElKW') || null,
          einspKw: einsp > 0 ? einsp : null,
        };
        cfg.punkte = GG_EZA_PUNKTE;
        cfg.fussnote = GG_EZA_FUSSNOTE;
        const teile = [`MS ${ggNum(cfg.werte.uKv, cfg.werte.uKv % 1 ? 1 : 0)} kV`];
        if (cfg.werte.stationen) teile.push(`${cfg.werte.stationen} Trafostationen`);
        if (cfg.werte.pvKwp) teile.push(`${ggNum(cfg.werte.pvKwp)} kWp PV`);
        if (cfg.werte.einspKw) teile.push(`Einspeisegrenze ${ggNum(cfg.werte.einspKw)} kW`);
        return `✓ ${teile.join(', ')}.` + (nap ? '' : ' (kein NAP im Netzmodell — Nennspannung 20 kV angenommen)');
      },
    },

    // ── Variantenvergleich ───────────────────────────────────────────────
    {
      id: 'pv-variantenvergleich',
      autoSync: true,
      reihe: 40,
      kapitel: '5.4.2 PV-Anlage und Batteriespeicher',
      titel: 'PV-Varianten im Vergleich',
      datei: 'pv-variantenvergleich',
      hinweis: 'Die 5 kanonischen PV-Varianten aus der ☀ PV-Analyse nebeneinander — jede beantwortet '
             + 'genau eine Stakeholder-Frage (Minimal, Eigenverbrauch, Wirtschaftlichkeit, Autarkie, '
             + 'maximaler Ausbau). Bewusst OHNE Wirtschaftlichkeitskennzahlen: Kapitel 5.4.2 beschreibt '
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
        // Kapitel 5.4.2 beschreibt die Auslegungen — deshalb keine Hervorhebung
        // einer „besten" Variante und keine Euro-Kennzahlen; beides gehört in 5.5.
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
                     + 'Wirtschaftliche Bewertung siehe Kapitel 5.5.';
        return `✓ ${kanon.length} PV-Varianten aus der PV-Analyse übernommen.`;
      },
    },

    // ── Energiebilanz je Variante (B/D/P — Bedarf/Deckung/PV-Verbleib) ───
    {
      id: 'pv-energiebilanz',
      autoSync: true,
      reihe: 50,
      kapitel: '5.4.2 PV-Anlage und Batteriespeicher',
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
      kapitel: '5.5 Wirtschaftlichkeit und Investitionskosten',
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

    // ── Herleitung der Varianten (Kapitel 5.4.2) ─────────────────────────
    {
      id: 'pv-herleitung',
      autoSync: true,
      reihe: 20,
      kapitel: '5.4.2 PV-Anlage und Batteriespeicher',
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

    // ── Einlinienschema Bestandsnetz (Kapitel 5.4.2) ──────────────────────
    ggEinlinienFigur('pv-einlinienschema', 25, 'variante', 'Einlinienschema Bestandsnetz',
      'Wie viel PV das bestehende Netz ohne Ertüchtigung aufnimmt und wo es begrenzt: Auslastung der Kabel und '
      + 'Transformatoren, Spannungsanhebung an den Knoten, Engpässe markiert. Belegung der Variante „Bestandsnetz". '
      + 'Grundlage: ☀ PV-Analyse › Netzaufnahme (Bestand) / Einlinienschema.'),
    ggEinlinienFigur('pv-einlinienschema-eigen', 26, 'eigene', 'Einlinienschema Bestandsnetz — eigene Belegung',
      'Wie oben, aber mit der im Einlinienschema übernommenen eigenen Belegung (samt gewählter Ertüchtigungen). '
      + 'Nur sinnvoll, wenn dort „Als Variante übernehmen" genutzt wurde.'),

    // ── Rückspeisung & Netzverträglichkeit (Kapitel 5.4.2) ────────────────
    {
      id: 'pv-rueckspeisung',
      autoSync: true,
      reihe: 80,
      kapitel: '5.4.2 PV-Anlage und Batteriespeicher',
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

    // ── Versorgungslücke im Jahresverlauf (Kapitel 8.2) ──────────────────
    {
      id: 'res-jahresraster',
      autoSync: true,
      kapitel: '8.2 Bewertung Resilienz',
      titel: 'Versorgungslücke je Ausfallzeitpunkt',
      datei: 'resilienz-jahresraster',
      hinweis: 'Für JEDE Stunde des Jahres simuliert: wie viele Stunden des betrachteten Ausfallfensters '
             + 'könnten PV und Speicher allein nicht decken. Zeigt, dass es keine einzelne '
             + 'Überbrückungsdauer gibt, sondern eine Verteilung — und wo der ungünstigste Zeitpunkt liegt. '
             + 'Grundlage: Kapitel 6.1 „Resilienz" in der ☀ PV-Analyse.',
      render: cfg => ggRenderHeatmap(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Versorgungslücke je Ausfallzeitpunkt', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Beginn des Ausfalls (Uhrzeit)', achseX: 'Beginn des Ausfalls (Tag im Jahr)',
        leer: 'Noch keine Resilienz-Berechnung — Kapitel 6.1 „Resilienz" in der PV-Analyse öffnen.',
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

    // ── Verlauf im Ausfallfenster (Kapitel 8.2) ──────────────────────────
    {
      id: 'res-fensterverlauf',
      autoSync: true,
      reihe: 30,   // 3.4.3: nach Auslegungstext, Soll-Ist-Tabelle und Lastabwurf-Text
      kapitel: '5.4.3 Notstromversorgung und Lastmanagement',   // Auslegung; die Bewertung bleibt in 8.2
      titel: 'Lastdeckung im Ausfallfenster',
      datei: 'resilienz-fensterverlauf',
      hinweis: 'Stunde für Stunde durch das betrachtete Ausfallfenster: wer trägt die Last — PV, Speicher '
             + 'oder Notstromaggregat — und bleibt eine Lücke. Der Beleg für die Auslegung in 5.4.3. '
             + 'Grundlage: Kapitel 6.1 „Resilienz" in der ☀ PV-Analyse.',
      render: cfg => ggRenderBalken(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Lastdeckung im Ausfallfenster', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Leistung in kW', achseX: 'Stunde des Ausfalls',
        leer: 'Noch keine Resilienz-Berechnung — Kapitel 6.1 „Resilienz" in der PV-Analyse öffnen.',
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

    // ── Resilienz je Ausbauvariante (Kapitel 8.2) ────────────────────────
    {
      id: 'res-varianten',
      autoSync: true,
      kapitel: '8.2 Bewertung Resilienz',
      titel: 'Resilienz je Ausbauvariante',
      datei: 'resilienz-varianten',
      hinweis: 'Was die fünf PV-Auslegungen aus Kapitel 5.4.2 im Blackout leisten: wie viel des '
             + 'Ausfallfensters sie im Mittel über ALLE Ausfallzeitpunkte des Jahres aus PV und Speicher '
             + 'allein tragen und ab wann das Notstromaggregat einspringen muss. Die Aggregatleistung '
             + 'ist dagegen am ungünstigsten Zeitpunkt der jeweiligen Variante bemessen. '
             + 'Grundlage: „Varianten vergleichen" in Kapitel 6.1 „Resilienz".',
      render: cfg => ggRenderBalken(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Resilienz je Ausbauvariante', ort: '',
        meta: { 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' },
        achseY: 'Stunden des Ausfallfensters (Mittel)', achseX: 'Ausbauvariante',
        leer: 'Noch kein Variantenvergleich — in Kapitel 6.1 „Resilienz" auf „Varianten vergleichen" klicken.',
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
      kapitel: '8.2 Bewertung Resilienz',
      titel: 'Resilienz — Autarkie bei Netzausfall',
      datei: 'pv-resilienz-zusammenfassung',
      hinweis: 'Zusammenfassung der zuletzt in ☀ PV-Analyse › Kapitel 6.1 „Resilienz“ betrachteten Inselbetrieb-Auslegung: '
             + 'wie lange trägt PV/Batterie/Notstrom einen Blackout zum ungünstigsten Zeitpunkt im Jahr. '
             + 'Erst Kapitel 6.1 in der PV-Analyse öffnen, dann hierher „Aus Projekt übernehmen“. Gebäude, Netz und Schutzziele: 🛡 Blackout-Modus.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Elektrotechnisches Gutachten', titel: 'Resilienz — Autarkie bei Netzausfall',
        leer: 'Noch keine Resilienz-Berechnung — in der ☀ PV-Analyse Kapitel 6.1 „Resilienz“ öffnen (rechnet automatisch auf den PV-Varianten).',
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
                      + 'Ladestand aus der Jahressimulation, das Notstromaggregat deckt die Restlast. Stand aus der PV-Analyse, Kapitel 6.1.';
        return '✓ Resilienz-Kennzahlen aus der PV-Analyse (Kapitel 6.1) übernommen.';
      },
    },

    // ── Blackout-Modus (26): Werkzeug, Schutzziele, Maßnahmen ───────────
    {
      id: 'res-bewertungstool-text',
      istText: true,
      kapitel: '8.1 Erläuterung Bewertungstool Resilienz',
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
      kapitel: '8.2 Bewertung Resilienz',
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
      kapitel: '8.2.1 Ist-Zustand',
      titel: 'Gutachtentext: Resilienz Ist-Zustand',
      datei: 'resilienz-ist-zustand-text',
      hinweis: 'Bestand an Netzersatzanlagen, Notstromklassen der Gebäude und Wärmeversorgung ohne Notstrom — aus dem 🛡 Blackout-Modus.',
      render: cfg => ggRenderResIstText(cfg),
      config: {},
    },
    {
      id: 'res-kurz-text',
      istText: true,
      kapitel: '8.2.7 Kurzfristige Maßnahmen',
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
      kapitel: '8.2.8 Langfristige Maßnahmen (Umsetzung der Empfehlung im Gutachten)',
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
      kapitel: '8.2 Bewertung Resilienz',
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

/* ── Kapitel 8: Bewertungswerkzeug und Schutzziele (26-blackout-modus.js) ─────
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
        ? `Empfohlen wird das Schutzziel „${gEsc(erg.empfehlung.ziel.name)}“ (vgl. Kapitel 8.2.8).`
        : `Welches Schutzziel umgesetzt wird, ist mit dem Nutzer festzulegen: ${ggTextFeld('', 'Empfohlenes Schutzziel')}.`));
  }
  return ggTextBlatt(absaetze, T);
}

/** Maßnahmen und Bewertung eines Schutzziels als Fließtext (5.2 und 8.2.8). */
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
      : `sind ${ggNum(bestand.anzahl)} Netzersatzanlagen mit zusammen ${ggNum(bestand.kw)} kW`} vorhanden (vgl. Kapitel 5.1.4).`
    : 'In der Liegenschaft ist derzeit keine Netzersatzanlage vorhanden (vgl. Kapitel 5.1.4). Bei einem Ausfall des öffentlichen '
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

/** 5.2.7 Kurzfristige Maßnahmen: organisatorisch oder mit geringem Aufwand umsetzbar. */
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
  const vorrang = (ggResSz()?.stationen || []).filter(x => x.abKw > 0).map(x => x.name);
  if (vorrang.length) {
    punkte.push(`Einspeisepunkte für mobile Netzersatzanlagen vorrangig an ${vorrang.length === 1 ? 'der Transformatorstation' : `den ${ggNum(vorrang.length)} Transformatorstationen`} `
      + `mit Gebäuden der Klassen A und B (${ggResNamen(vorrang, 6)}; vgl. Kapitel 8.2.6)`);
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

/** 5.2.8 Langfristige Maßnahmen: Umsetzung des empfohlenen Schutzziels. */
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
    `Empfohlen wird die Umsetzung des Schutzziels „${gEsc(b.ziel.name)}“ (vgl. Kapitel 8.2). ${ggResZielText(b)}`,
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
  absaetze.push('Die Umsetzung kann stufenweise erfolgen: Zuerst werden die kurzfristigen Maßnahmen (Kapitel 8.2.7) umgesetzt, '
    + 'anschließend die Netzersatzanlagen der kritischen Gebäude und die Notstromversorgung der Heizzentrale, zuletzt '
    + 'die weiteren Ausbaustufen.');
  return ggTextBlatt(absaetze, T);
}

/* ── 5.2.2–8.2.6: drei feste Szenarien und allgemeine Empfehlungen (26-blackout-modus.js) ──
 * Jedes Gutachten stellt drei Szenarien gegenüber — nur die kritischen Gebäude (Klasse A),
 * die Gesamtliegenschaft als Insel am NAP (Reiter „Liegenschaft“) und je Trafostation eine
 * NEA an der NSHV für die Gebäude A/B (stationär oder mobil) — und gibt allgemeine
 * Empfehlungen (Einspeisepunkte an den Trafostationen u. a.). Die Daten kommen über
 * window.blackoutSzenarienStand(); das rechnet nur bei geänderten Eingaben neu. */
const ggResSz = () => {
  if (typeof window.blackoutSzenarienStand !== 'function') return null;
  try { return window.blackoutSzenarienStand(); } catch (err) { console.warn('Resilienz-Szenarien:', err); return null; }
};
const GG_RES_KLASSE_FARBE = { A: '#C62828', B: '#EF8F00', C: '#5A8FC8' };
const GG_RES_CHECK_STATUS = { neu: 'neu', erneuern: 'erneuern', pruefen: 'prüfen', ok: 'ok' };
/** „G1, G2, G3 + 2 weitere“ — für Tabellenzellen, die nicht umbrechen. */
const ggResKurzliste = (namen, max = 3) => (namen.length > max
  ? `${namen.slice(0, max).join(', ')} + ${namen.length - max} weitere` : namen.join(', '));
const ggResKuerzen = (s, n) => (String(s).length > n ? String(s).slice(0, Math.max(1, n - 1)) + '…' : String(s));
const ggResPct = (teil, ganz) => (ganz > 0 ? ggNum(teil / ganz * 100) + ' %' : '—');
const GG_RES_LASTQUELLE = {
  'Messdaten (Referenzjahr)': 'aus den Messdaten des Referenzjahres',
  'Netzmodell am NAP': 'aus dem Netzmodell am Netzanschlusspunkt',
  'Summe der Trafo-Spitzen': 'als Summe der Spitzenlasten der Transformatorstationen',
};
const ggResQuelle = q => GG_RES_LASTQUELLE[q] || `aus ${q}`;
const ggResKva = kva => (kva > 0 ? `${ggNum(kva)} kVA` : '—');
const ggResKw = kw => (kw > 0 ? `${ggNum(kw)} kW` : '—');
/** Zweite Kartenzeile im Schema: Trafoleistung und Spitze, fehlende Werte benannt. */
const ggResStationZeile = s => `${s.kva > 0 ? `${ggNum(s.kva)} kVA` : 'Leistung unbekannt'} · `
  + `${s.spitzeKw > 0 ? `Spitze ${ggNum(s.spitzeKw)} kW` : 'ohne Lastgang'}`;

/** Wärme-Absatz für beide Szenarien. */
function ggResSzWaermeSatz(sz, b, wofuer) {
  if (b.waerme) {
    return `${wofuer} benötigt die Heizzentrale${sz.heizzentrale ? ` im Gebäude „${gEsc(sz.heizzentrale)}“` : ''} eine Notstromversorgung `
      + `für Pumpen, Brenner und Regelung von rund ${ggNum(b.waerme.neaKw)} kW`
      + (b.waerme.zweistoffKw ? ` sowie Zweistoffbrenner mit zusammen ${ggNum(b.waerme.zweistoffKw)} kW` : '')
      + `. Damit ist der Wärmebedarf im Ausfallzeitraum zu ${ggNum(b.waerme.deckungPct)} % gedeckt`
      + ` (Szenario der Wärmeversorgung: ${gEsc(sz.waerme?.szenario || '')}).`;
  }
  if (sz.waerme?.ohneNea) {
    return 'Ohne Notstromversorgung der Heizzentrale fallen Umwälzpumpen, Brenner und Regelung aus; die Wärmeversorgung '
      + `ist dann unterbrochen. ${ggTextFeld('', 'Notstrom der Heizzentrale im Blackout-Modus › Wärme einschalten')}.`;
  }
  return `Wärmeversorgung im Ereignisfall: ${ggTextFeld('', 'Wärme-Lastgang fehlt')}.`;
}

/** 5.2.2 Szenario 1: nur die Gebäude der Notstromklasse A. */
function ggRenderResSz1Text(cfg, T = GG_THEME) {
  void cfg;
  const sz = ggResSz();
  if (!sz) return ggTextBlatt([`${ggTextFeld('', 'Szenario 1: Versorgung der kritischen Gebäude')}.`], T);
  const b = sz.s1.bewertung, v = b.variante, kl = sz.bilanz.klassen;
  const dauer = ggResDauer(sz.dauerH);
  const einleitung = 'Im ersten Szenario werden bei einem Ausfall der äußeren Versorgung ausschließlich die als kritisch '
    + 'eingestuften Gebäude der Notstromklasse A versorgt; die übrige Liegenschaft bleibt ohne Strom. '
    + `Betrachtet wird ein Ausfall über ${dauer}.`;
  if (!kl.A.anzahl) {
    return ggTextBlatt([einleitung,
      `Kritische Gebäude sind bislang nicht festgelegt: ${ggTextFeld('', 'Gebäude der Klasse A (Blackout-Modus › Klassen)')}.`], T);
  }
  const agg = v.aggregate.filter(a => a.empfKw > 0);
  const absaetze = [
    einleitung + ` Als kritisch eingestuft ${kl.A.anzahl === 1 ? 'ist das Gebäude' : `sind die ${ggNum(kl.A.anzahl)} Gebäude`} `
      + `${ggResNamen(sz.namen.A)} mit einer Anschlussleistung von zusammen ${ggNum(kl.A.anschlussKw)} kW`
      + (kl.A.ohneLast ? `; für ${ggNum(kl.A.ohneLast)} davon liegen noch keine Verbrauchsdaten vor` : '') + '.',
  ];
  if (agg.length) {
    const orte = agg.map(a => `${ggResOrt(a)} (${ggNum(a.empfKw)} kW`
      + (a.bestandKw > 0 ? (a.zusatzKw > 0 ? `, davon ${ggNum(a.bestandKw)} kW vorhanden` : ', vorhanden') : '') + ')');
    absaetze.push('Die Netzersatzanlagen werden am Bestandsnetz so angeordnet, dass die Investition am geringsten ist '
      + `(Aufstellungsvariante „${gEsc(sz.s1.strategie)}“). Erforderlich ${agg.length === 1 ? 'ist eine Anlage' : `sind ${ggNum(agg.length)} Anlagen`} `
      + `mit zusammen ${ggNum(v.summe.kw)} kW, bemessen auf die gleichzeitige Spitzenlast von ${ggNum(sz.s1.aKw)} kW zuzüglich 20 % Reserve. `
      + `Standorte: ${ggAufzaehlung(orte)}.`
      + (v.summe.abgaenge ? ` Da eine Anlage an einem Netzknoten alle nachgelagerten Abgänge speist, ${v.summe.abgaenge === 1
        ? 'ist ein Abgang' : `sind ${ggNum(v.summe.abgaenge)} Abgänge`} ohne kritische Gebäude im Ereignisfall abzuschalten und zu kennzeichnen.` : '')
      + (v.nichtAmNetz?.length ? (v.nichtAmNetz.length === 1
        ? ' Ein Gebäude ist im Netzmodell keiner Station zugeordnet und wird mit einem eigenen Aggregat gerechnet.'
        : ` ${ggNum(v.nichtAmNetz.length)} Gebäude sind im Netzmodell keiner Station zugeordnet und werden mit einem eigenen Aggregat gerechnet.`) : '')
      + ' Die folgende Abbildung zeigt die Versorgung je Transformatorstation, die Tabelle die Anlagen im Einzelnen.');
  }
  if (b.strom?.liter) {
    absaetze.push(`Für ${dauer} sind bei mittlerer Auslastung der Aggregate rund ${ggNum(b.strom.liter)} l Dieselkraftstoff `
      + 'vorzuhalten – in den Tanks der Aggregate oder über eine vertraglich gesicherte Nachbelieferung.');
  }
  absaetze.push(ggResSzWaermeSatz(sz, b, 'Damit die kritischen Gebäude auch beheizt bleiben,'));
  if (sz.s1.mitB) {
    absaetze.push(`Die ${kl.B.anzahl === 1 ? 'Gebäude' : `${ggNum(kl.B.anzahl)} Gebäude`} der Klasse B (eingeschränkter Betrieb: `
      + `${ggResNamen(sz.namen.B)}) ${kl.B.anzahl === 1 ? 'ist' : 'sind'} in diesem Szenario nicht versorgt. Ihre Einbindung mit reduzierter Last `
      + `erhöht die erforderliche Notstromleistung von ${ggNum(v.summe.kw)} kW auf ${ggNum(sz.s1.mitB.kw)} kW.`);
  }
  absaetze.push(`Die Investition für dieses Szenario beträgt überschlägig ${ggResEur(b.kosten)} (Aggregate, Einspeisungen, `
    + `Kraftstofflager${b.waerme ? ' und Notstrom der Heizzentrale' : ''}). Das Szenario ist mit vergleichsweise geringem Aufwand, `
    + 'ohne Eingriffe in das Mittelspannungsnetz und schrittweise je Standort umsetzbar. Dem steht gegenüber, dass sich der Betrieb '
    + 'auf die kritischen Funktionen beschränkt und mehrere dezentrale Aggregate Wartung, Probeläufe und Kraftstofflogistik an '
    + 'jedem Standort erfordern.'
    + (b.status !== 'erfuellt' && b.gruende.length ? ` Hinweis zur Bewertung: ${gEsc(b.gruende.join('; '))}.` : ''));
  return ggTextBlatt(absaetze, T);
}

/** 5.2.3 Szenario 2: je Trafostation eine NEA an der NSHV für die Gebäude A/B, stationär oder mobil. */
function ggRenderResStationText(cfg, T = GG_THEME) {
  void cfg;
  const sz = ggResSz();
  if (!sz) return ggTextBlatt([`${ggTextFeld('', 'Szenario 2: Versorgung je Trafostation')}.`], T);
  const b = sz.s2.bewertung, v = b.variante, kl = sz.bilanz.klassen, m = sz.s2.mobil;
  const dauer = ggResDauer(sz.dauerH);
  const einleitung = 'Im zweiten Szenario erhält jede Transformatorstation, an der Gebäude der Klassen A oder B angeschlossen sind, '
    + 'eine Netzersatzanlage auf der Niederspannungsseite. Sie speist über eine Umschalteinrichtung in die '
    + 'Niederspannungshauptverteilung der Station und versorgt die Abgänge zu den Gebäuden der Klasse A mit voller und der '
    + 'Klasse B mit reduzierter Last; die übrigen Abgänge werden im Ereignisfall abgeschaltet. Das Mittelspannungsnetz bleibt '
    + `spannungslos. Betrachtet wird ein Ausfall über ${dauer}.`;
  if (!kl.A.anzahl && !kl.B.anzahl) {
    return ggTextBlatt([einleitung,
      `Gebäude der Klassen A und B sind bislang nicht festgelegt: ${ggTextFeld('', 'Gebäude der Klassen A/B (Blackout-Modus › Klassen)')}.`], T);
  }
  const anStation = sz.stationen.filter(st => st.sz2.length);
  const ohneNea = sz.stationen.length - anStation.length;
  const agg = v.aggregate.filter(a => a.empfKw > 0);
  const orte = anStation.map(st => `${gEsc(st.name)} (${ggNum(st.sz2.reduce((s, a) => s + a.kw, 0))} kW)`);
  const extra = sz.s2.ohneStation;
  const absaetze = [einleitung];
  if (agg.length) {
    absaetze.push(`Versorgt werden ${ggNum(b.strom?.gebaeude || 0)} Gebäude der Klassen A und B. Erforderlich `
      + `${agg.length === 1 ? 'ist eine Anlage' : `sind ${ggNum(agg.length)} Anlagen`} mit zusammen ${ggNum(v.summe.kw)} kW, bemessen je `
      + `Station auf die gleichzeitige Spitzenlast ihrer Gebäude A und B (zusammen ${ggNum(sz.s2.kw)} kW) zuzüglich 20 % Reserve`
      + (orte.length ? `: ${ggAufzaehlung(orte)}` : '') + '.'
      + (extra.length ? ` ${extra.length === 1 ? 'Ein Gebäude ist' : `${ggNum(extra.length)} Gebäude sind`} keiner Station zugeordnet `
        + `oder ${extra.length === 1 ? 'hat' : 'haben'} eine eigene Anlage und ${extra.length === 1 ? 'wird' : 'werden'} am Gebäude versorgt `
        + `(${ggResNamen(extra.map(a => a.name), 4)}).` : '')
      + (v.summe.abgaenge ? ` In den versorgten Stationen ${v.summe.abgaenge === 1 ? 'ist ein Abgang' : `sind ${ggNum(v.summe.abgaenge)} Abgänge`} `
        + 'ohne Gebäude der Klassen A und B im Ereignisfall abzuschalten und zu kennzeichnen.' : '')
      + (ohneNea > 0 ? ` ${ohneNea === 1 ? 'Eine Station ohne Gebäude der Klassen A und B bleibt' : `${ggNum(ohneNea)} Stationen ohne Gebäude der Klassen A und B bleiben`} `
        + 'ohne Versorgung; über ihre Einspeisepunkte (Kapitel 8.2.6) lassen sie sich bei Bedarf mit mobilen Aggregaten übernehmen.' : ''));
  }
  absaetze.push('Jede versorgte Station bildet im Ereignisfall ein eigenes Niederspannungsnetz. Die Umschaltung „Netz – 0 – '
    + 'Netzersatzanlage“ mit gegenseitiger Verriegelung schließt einen Parallelbetrieb mit dem Netz aus, das Aggregat wird an '
    + 'die Erdungsanlage der Station angeschlossen. Anders als bei der Inselversorgung der Liegenschaft (Szenario 3) sind weder Eingriffe in das Mittelspannungsnetz '
    + 'noch ein Maschinentransformator oder eine eigene Sternpunktbehandlung erforderlich. Da das Aggregat einen deutlich '
    + 'geringeren Kurzschlussstrom liefert als der Transformator, sind die Abschaltbedingungen in den versorgten Abgängen für '
    + 'diesen Betrieb nachzuweisen. Das Prinzip zeigt die folgende Abbildung, die Versorgung je Station das anschließende Schema.');
  if (b.strom?.liter) {
    absaetze.push(`Für ${dauer} sind bei mittlerer Auslastung der Aggregate rund ${ggNum(b.strom.liter)} l Dieselkraftstoff `
      + 'vorzuhalten bzw. nachzuliefern.');
  }
  absaetze.push(ggResSzWaermeSatz(sz, b, 'Damit die versorgten Gebäude auch beheizt bleiben,'));
  if (agg.length) {
    absaetze.push('Die Netzersatzanlagen können fest installiert oder im Ereignisfall als mobile Aggregate über die Einspeisepunkte '
      + `angeschlossen werden. Fest installiert beträgt die Investition überschlägig ${ggResEur(b.kosten)} (Aggregate, Einspeisungen, `
      + `Kraftstofflager und Kennzeichnung der Abgänge${b.waerme ? ' sowie Notstrom der Heizzentrale' : ''}). Mit mobilen Aggregaten `
      + `beschränkt sie sich auf ${m.anzahl === 1 ? 'einen Einspeisepunkt' : `${ggNum(m.anzahl)} Einspeisepunkte`} und die Kennzeichnung `
      + `der Abgänge${b.waerme ? ' sowie den Notstrom der Heizzentrale' : ''}, zusammen rund ${ggResEur(m.gesamt)}; hinzu kommen die `
      + 'laufenden Kosten eines Rahmenvertrags für die Bereitstellung der Aggregate und die Nachlieferung des Kraftstoffs. '
      + 'Bei einem großflächigen, länger andauernden Ausfall ist die Verfügbarkeit angemieteter Aggregate jedoch nicht gesichert, '
      + 'und bis zur Versorgung vergehen je nach Anfahrt mehrere Stunden. Für Stationen mit Gebäuden der Klasse A ist deshalb '
      + 'eine fest installierte Anlage vorzuziehen; Stationen, die nur Gebäude der Klasse B versorgen, können mobil übernommen '
      + 'werden. Die Tabelle „Netzersatzanlagen Szenario 2“ stellt beide Ausführungen je Station gegenüber.');
  }
  absaetze.push('Vorteil dieses Szenarios ist, dass es ohne Eingriffe in Mittelspannungsnetz und Schutztechnik sowie ohne '
    + 'Abstimmung eines Inselbetriebs mit dem Netzbetreiber auskommt, sich Station für Station umsetzen lässt und der Ausfall '
    + 'eines Aggregats nur eine Station betrifft. Gegenüber Szenario 1 werden zusätzlich die Gebäude der Klasse B versorgt, und '
    + 'die Anlagen stehen einheitlich an den Stationen, wo auch die Einspeisepunkte der allgemeinen Empfehlung liegen. Nachteilig '
    + 'sind Wartung, Probeläufe und Kraftstofflogistik an mehreren Standorten; die Gebäude der Klasse C bleiben ohne Versorgung, '
    + 'und freie Leistung einer Station kann nicht auf eine andere übertragen werden.'
    + (b.status !== 'erfuellt' && b.gruende.length ? ` Hinweis zur Bewertung: ${gEsc(b.gruende.join('; '))}.` : ''));
  return ggTextBlatt(absaetze, T);
}

/** Absätze zu Erzeugern und Speichern im Inselbetrieb und zum Ablauf Inselbildung/Rückkehr (Begleittext zur Figur res-insel-ee). */
function ggResInselEeSatz() {
  const pvKwp = ggResAssetSumme('PV', 'leistungKWp');
  const windKw = ggResAssetSumme('Wind', 'leistungKW');
  const kwkKw = ggResAssetSumme('KWK', 'leistungElKW');
  const battKwh = ggResAssetSumme('Batterie', 'kapazitaetKWh');
  const erfasst = [
    pvKwp > 0 && `${ggNum(pvKwp)} kWp Photovoltaik`,
    windKw > 0 && `${ggNum(windKw)} kW Windenergie`,
    kwkKw > 0 && `${ggNum(kwkKw)} kW elektrische KWK-Leistung`,
    battKwh > 0 && `ein Batteriespeicher mit ${ggNum(battKwh)} kWh`,
  ].filter(Boolean);
  const folgend = ['Photovoltaik', windKw > 0 && 'Windenergieanlagen', 'BHKW'].filter(Boolean);
  let t = 'Erzeugungsanlagen und Speicher auf der Liegenschaft lassen sich in den Inselbetrieb einbinden (Abbildung '
    + '„Erneuerbare Erzeuger und Speicher im Inselbetrieb“). Führend ist dabei die Netzersatzanlage: Sie gibt Spannung und '
    + 'Frequenz vor und ist für die volle Last der Insel bemessen, sodass der Inselbetrieb auch ohne Erzeuger und Speicher '
    + `möglich ist. ${battKwh > 0 ? 'Der Batteriespeicher und ' : ''}${ggAufzaehlung(folgend)} werden erst zugeschaltet, wenn die `
    + 'Insel stabil läuft, und folgen der Netzersatzanlage netzfolgend. '
    + (erfasst.length ? `Im Netzmodell ${erfasst.length === 1 && battKwh > 0 ? 'ist' : 'sind'} ${ggAufzaehlung(erfasst)} erfasst. `
      : 'Im Netzmodell sind bislang keine Erzeugungsanlagen oder Speicher erfasst. ')
    + 'Bei Überschuss wird die Photovoltaik über die Frequenz abgeregelt (P(f)-Kennlinie), bei Mangel werden zuerst flexible '
    + 'Lasten wie Heizstäbe, Wärmepumpen und Ladepunkte und danach Abgänge abgeworfen. ';
  t += battKwh > 0
    ? 'Der Batteriespeicher nimmt Überschüsse auf und fängt Lastsprünge ab. '
    : 'Ein Batteriespeicher würde zusätzlich Überschüsse aufnehmen und Lastsprünge abfangen. ';
  t += 'Die Einspeisung ist so zu begrenzen, dass die Aggregate ihre Mindestlast (ca. 30–40 %) halten und keine Rückleistung '
    + 'aufnehmen. ';
  if (kwkKw > 0) {
    t += 'Das BHKW ist nur mit Synchrongenerator und inselfähiger Regelung einsetzbar; es wird auf die Netzersatzanlage '
      + 'synchronisiert und im Ereignisfall stromgeführt betrieben, die Wärme geht in den Pufferspeicher, und die '
      + 'Gasversorgung während eines Blackouts ist zu prüfen. ';
  }
  t += 'Die Einbindung spart Kraftstoff und verlängert die Autonomie, ersetzt aber keine gesicherte Leistung, da die '
    + 'Photovoltaik nachts und im Winter kaum beiträgt; die Bemessung der Netzersatzanlage bleibt deshalb unverändert. '
    + 'Die Schutzeinstellungen der Wechselrichter (NA-Schutz, Inselnetzerkennung) sind für den Inselbetrieb anzupassen und '
    + 'mit dem Netzbetreiber abzustimmen.';
  return [t, 'Die Inbetriebnahme der Insel folgt einer festen Reihenfolge: Nach Erkennen des Netzausfalls wird der '
    + 'Netzanschlusspunkt geöffnet, die Netzersatzanlage gestartet und die Transformatorstationen in Stufen zugeschaltet. '
    + 'Erst wenn die Insel stabil läuft, werden der Speicher zugeschaltet und die Erzeuger durch das Energiemanagement '
    + 'freigegeben. Für die Rückkehr ans Netz wird nach stabiler Netzwiederkehr und Freigabe durch den Netzbetreiber die '
    + 'Einspeisung der Erzeuger und des Speichers zurückgefahren, die Netzersatzanlage über eine Synchronisiereinrichtung '
    + '(Synchrocheck) auf Spannung, Frequenz und Phasenlage des Netzes abgeglichen und der Schalter am Netzanschlusspunkt '
    + 'geschlossen. Nach einem kurzen, mit dem Netzbetreiber abgestimmten Parallelbetrieb übernimmt das Netz die Last und '
    + 'die Netzersatzanlage fährt ab; die Wechselrichter arbeiten anschließend wieder im Netzparallelbetrieb. Ist keine '
    + 'Synchronisiereinrichtung vorgesehen, erfolgt die Rückschaltung mit kurzer Unterbrechung: Die Insel wird spannungslos '
    + 'geschaltet, der Netzanschlusspunkt geschlossen, und die Wechselrichter schalten nach Ablauf ihrer Wartezeit selbsttätig '
    + 'wieder zu.'];
}

/** 5.2.4 Szenario 3: Liegenschaft als Insel am NAP (Reiter „Liegenschaft“). */
function ggRenderResLiegenschaftText(cfg, T = GG_THEME) {
  void cfg;
  const sz = ggResSz();
  if (!sz) return ggTextBlatt([`${ggTextFeld('', 'Szenario 3: Versorgung der Gesamtliegenschaft')}.`], T);
  const b = sz.s3.bewertung, r = b.insel;
  const dauer = ggResDauer(sz.dauerH);
  const einleitung = 'Im dritten Szenario wird die Liegenschaft als Ganzes über eine zentrale Netzersatzanlage am '
    + 'Netzanschlusspunkt im Inselbetrieb weiterbetrieben.';
  if (!r || !(r.spitzeKw > 0)) {
    return ggTextBlatt([einleitung,
      `Für die Bemessung fehlen ein Lastgang der Liegenschaft oder die Transformatorstationen im Netzmodell: ${ggTextFeld('', 'Spitzenlast der Liegenschaft')}.`], T);
  }
  const lab = r.lastabwurf, zs = r.zuschaltung;
  const absaetze = [
    einleitung + ` Die Spitzenlast der Liegenschaft beträgt ${ggNum(r.spitzeKw)} kW (ermittelt ${gEsc(ggResQuelle(sz.lastQuelle))}). `
      + (r.anteilPct >= 100
        ? `Abgesichert wird die volle Spitzenlast über ${dauer}.`
        : `Abgesichert werden ${ggNum(r.anteilPct)} % davon, also ${ggNum(r.zielKw)} kW über ${dauer}; die übrige Last wird durch `
          + 'das Abschalten von Transformatorstationen bzw. Abgängen abgeworfen.')
      + (r.abReichtNicht ? ` Die gleichzeitige Last der Gebäude der Klassen A und B liegt darüber; bemessen wird deshalb auf `
        + `${ggNum(r.bemessungKw)} kW.` : ''),
    (r.aggregate.anzahl === 1
      ? `Erforderlich ist ein Aggregat mit ${ggNum(r.aggregate.kvaJe)} kVA, das über einen `
      : `Erforderlich sind ${ggNum(r.aggregate.anzahl)} Aggregate mit je ${ggNum(r.aggregate.kvaJe)} kVA`
        + `${sz.s3.redundanz ? ' (einschließlich einer Reserveeinheit, N+1)' : ''}, die über einen `)
      + `Maschinentransformator von ${ggNum(r.maschinentrafoKva)} kVA in die Mittelspannungsanlage am Netzanschlusspunkt `
      + `${r.aggregate.anzahl === 1 ? 'einspeist' : 'einspeisen'}. `
      + `Das Kraftstofflager ist für das energiereichste ${ggNum(sz.dauerH)}-Stunden-Fenster mit rund ${ggNum(r.liter)} l Diesel zu bemessen.`,
    `Im Inselbetrieb werden ${lab.versorgt.length === 1 ? 'eine Transformatorstation' : `${ggNum(lab.versorgt.length)} Transformatorstationen`} `
      + `in ${zs.stufen.length === 1 ? 'einer Zuschaltstufe' : `${ggNum(zs.stufen.length)} Zuschaltstufen`} nacheinander zugeschaltet, `
      + 'damit Einschaltströme und Lastsprünge die Aggregate nicht überlasten'
      + (lab.abschalten.length ? `; ${lab.abschalten.length === 1 ? 'eine Station bleibt' : `${ggNum(lab.abschalten.length)} Stationen bleiben`} `
        + `abgeschaltet (${ggResNamen(lab.abschalten.map(t => t.name || 'Station'), 5)})` : '')
      + (lab.nsAbwurf.length ? `; in den versorgten Stationen ${lab.nsAbwurf.length === 1 ? 'wird ein Niederspannungsabgang'
        : `werden ${ggNum(lab.nsAbwurf.length)} Niederspannungsabgänge`} abgeworfen` : '')
      + '. Das Prinzip des Inselbetriebs sowie die Stationen mit ihren Zuschaltstufen zeigen die folgenden Abbildungen und die Tabelle.',
  ];
  const titel = st => [...new Set(r.checkliste.filter(c => c.status === st).map(c => gEsc(c.titel)))];
  const neu = titel('neu'), ern = titel('erneuern'), pr = titel('pruefen');
  absaetze.push('Im Inselbetrieb fehlen die Sternpunkterdung und die Kurzschlussleistung des vorgelagerten Netzes. Erforderlich '
    + 'sind deshalb eine Netztrennung am Netzanschlusspunkt mit Synchronisierung für die Rückschaltung, eine eigene '
    + `Sternpunktbehandlung (kapazitiver Erdschlussstrom der Mittelspannungskabel rund ${ggNum(r.ms.icA, 1)} A), ein Einspeisefeld `
    + 'sowie eine an den geringeren Kurzschlussstrom angepasste Schutztechnik. Der Betrieb ist mit dem Netzbetreiber '
    + 'abzustimmen (VDE-AR-N 4110).'
    + (neu.length ? ` Neu zu errichten: ${ggAufzaehlung(neu)}.` : '')
    + (ern.length ? ` Zu erneuern: ${ggAufzaehlung(ern)}.` : '')
    + (pr.length ? ` In der weiteren Planung zu prüfen: ${ggAufzaehlung(pr)}.` : '')
    + ' Die Maßnahmen und Richtkosten im Einzelnen zeigt die Tabelle „Technische Maßnahmen Inselbetrieb“.');
  absaetze.push(ggResSzWaermeSatz(sz, b, 'Für die Wärmeversorgung der Liegenschaft'));
  absaetze.push(...ggResInselEeSatz());
  absaetze.push(`Die Investition beträgt überschlägig ${ggResEur(b.kosten)}. Vorteil dieses Szenarios ist, dass `
    + `${r.anteilPct >= 100 ? 'die gesamte Liegenschaft' : 'ein großer Teil der Liegenschaft'} betriebsfähig bleibt und Erzeugung, `
    + 'Kraftstofflager und Überwachung an einem Standort gebündelt sind. Nachteilig sind die deutlich höhere Investition, die '
    + 'Eingriffe in Mittelspannungsnetz und Schutztechnik, die Abstimmung mit dem Netzbetreiber sowie die Abhängigkeit von einem '
    + `zentralen Standort${sz.s3.redundanz ? '' : ', die eine redundante Auslegung (N+1) nahelegt'}.`
    + (b.status !== 'erfuellt' && b.gruende.length ? ` Hinweis zur Bewertung: ${gEsc(b.gruende.join('; '))}.` : ''));
  return ggTextBlatt(absaetze, T);
}

/** 5.2.5 Gegenüberstellung der drei Szenarien. */
function ggRenderResVergleichText(cfg, T = GG_THEME) {
  void cfg;
  const sz = ggResSz();
  if (!sz) return ggTextBlatt([`${ggTextFeld('', 'Gegenüberstellung der Szenarien')}.`], T);
  const b1 = sz.s1.bewertung, b2 = sz.s2.bewertung, b3 = sz.s3.bewertung;
  const spitze = sz.liegenschaftSpitzeKw;
  const kw1 = sz.s1.aKw, kw2 = sz.s2.kw, kw3 = b3.insel?.bemessungKw || 0;
  const absaetze = ['Die drei Szenarien steigern den Versorgungsumfang schrittweise vom einzelnen Gebäude über die '
    + 'Transformatorstation bis zur gesamten Liegenschaft. Die folgende Abbildung stellt ihn der Spitzenlast der Liegenschaft '
    + 'gegenüber, die anschließende Tabelle die erforderlichen Maßnahmen und Richtkosten.'];
  if (kw1 > 0 && kw2 > 0 && kw3 > 0) {
    absaetze.push(`Szenario 1 sichert die kritischen Gebäude mit ${ggNum(kw1)} kW (${ggResPct(kw1, spitze)} der Liegenschaftsspitze) `
      + `für rund ${ggResEur(b1.kosten)} ab, Szenario 2 die Gebäude der Klassen A und B mit ${ggNum(kw2)} kW (${ggResPct(kw2, spitze)}) `
      + `für rund ${ggResEur(b2.kosten)} mit fest installierten bzw. ${ggResEur(sz.s2.mobil.gesamt)} mit mobilen Aggregaten und `
      + `Szenario 3 die Liegenschaft mit ${ggNum(kw3)} kW (${ggResPct(kw3, spitze)}) für rund ${ggResEur(b3.kosten)}. Bezogen auf die `
      + `abgesicherte Leistung sind das ${ggNum(b1.kosten / kw1)} €/kW, ${ggNum(b2.kosten / kw2)} €/kW (Szenario 2 fest installiert) `
      + `bzw. ${ggNum(b3.kosten / kw3)} €/kW.`);
  } else {
    absaetze.push(`Abgesicherte Leistung und Investition je Szenario: ${ggTextFeld('', 'Kennwerte der Szenarien (Blackout-Modus)')}.`);
  }
  absaetze.push('Die Szenarien schließen sich nicht aus, sondern bauen aufeinander auf: Die Einspeisepunkte an den '
    + 'Transformatorstationen (Kapitel 8.2.6) sind die Grundlage von Szenario 2 und in allen Fällen als Rückfallebene nutzbar; '
    + 'die Aggregate der kritischen Gebäude bleiben auch bei einer späteren zentralen Inselversorgung als zweite, unabhängige '
    + 'Versorgungsebene sinnvoll. Naheliegend ist deshalb ein stufenweises Vorgehen: zunächst die Einspeisepunkte und die '
    + 'Versorgung der kritischen Gebäude, danach die Versorgung je Transformatorstation und – abhängig vom Auftrag der '
    + 'Liegenschaft im Krisenfall – der Ausbau zur Inselversorgung. Welche Stufe umgesetzt wird, ist mit dem Nutzer '
    + 'abzustimmen (vgl. Kapitel 8.2.8).');
  return ggTextBlatt(absaetze, T);
}

/** 5.2.6 Allgemeine Empfehlungen, Teil 1: Einspeisepunkte an den Trafostationen. */
function ggRenderResEinspeisungText(cfg, T = GG_THEME) {
  void cfg;
  const sz = ggResSz();
  const st = sz?.stationen || [];
  const absaetze = ['Unabhängig vom gewählten Szenario werden Maßnahmen empfohlen, die die Handlungsfähigkeit bei einem länger '
    + 'andauernden Ausfall mit geringem Aufwand deutlich verbessern. Wichtigster Baustein sind Einspeisemöglichkeiten für '
    + 'mobile Netzersatzanlagen an den Transformatorstationen. Sie sind zugleich die Grundlage der mobilen Ausführung von '
    + 'Szenario 2 (Kapitel 8.2.3).'];
  absaetze.push(`An ${st.length === 1 ? 'der Transformatorstation' : st.length ? `den ${ggNum(st.length)} Transformatorstationen`
    : `den ${ggTextFeld('', 'Anzahl')} Transformatorstationen`} der Liegenschaft sollte jeweils niederspannungsseitig eine `
    + 'Einspeisemöglichkeit vorgesehen werden. Sie besteht aus einem von außen zugänglichen Einspeisekasten mit genormten '
    + 'Steckverbindern, einer fest verlegten Verbindung zur Niederspannungshauptverteilung und einer Umschalteinrichtung '
    + '„Netz – 0 – Netzersatzanlage“ mit gegenseitiger Verriegelung, die einen Parallelbetrieb mit dem öffentlichen Netz '
    + 'ausschließt. Hinzu kommen eine befestigte Stellfläche mit Zufahrt für Aggregat und Tankfahrzeug sowie ein Anschlusspunkt '
    + 'für Erdung und Potentialausgleich. Die folgende Abbildung zeigt das Prinzip.');
  if (st.length) {
    const vorrang = st.filter(s => s.abKw > 0).map(s => s.name);
    const ohneLast = st.filter(s => s.einspeisung.basis === 'trafo').length;
    const summe = st.reduce((s, x) => s + x.einspeisung.kosten, 0);
    absaetze.push('So kann jede Station im Ereignisfall von einem angemieteten oder vorgehaltenen Aggregat übernommen werden – '
      + 'auch als Rückfallebene bei Ausfall einer fest installierten Anlage und während Wartungs- und Umbauarbeiten. Bemessen '
      + 'wird die Einspeisung auf die Spitzenlast der Station zuzüglich 20 % Reserve, höchstens auf die Trafoleistung'
      + (ohneLast ? `; für ${ohneLast === 1 ? 'eine Station' : `${ggNum(ohneLast)} Stationen`} ohne Lastgang ist die Trafoleistung angesetzt` : '')
      + '. '
      + (vorrang.length === 1 ? `Vorrang hat die Station mit Gebäuden der Klassen A und B (${ggResNamen(vorrang)}). `
        : vorrang.length ? `Vorrang haben die Stationen mit Gebäuden der Klassen A und B (${ggResNamen(vorrang, 8)}). ` : '')
      + `Die Investition für alle Stationen beträgt überschlägig ${ggResEur(summe)}; Bemessung und Anschlussart je Station `
      + 'zeigt die Tabelle „Einspeisepunkte an den Transformatorstationen“.');
  }
  return ggTextBlatt(absaetze, T);
}

/** 5.2.6 Allgemeine Empfehlungen, Teil 2: weitere Planungsgrundsätze. */
function ggRenderResEmpfehlungText(cfg, T = GG_THEME) {
  void cfg;
  const sz = ggResSz();
  const alt = (sz?.stationen || []).filter(s => s.alterJ != null && s.alterJ > 30).map(s => `${s.name} (${s.baujahr})`);
  const punkte = [
    'Bei Neubau und Erneuerung von Transformatorstationen, Niederspannungshauptverteilungen und Heizzentralen die '
      + 'Einspeisemöglichkeit und die Umschalteinrichtung standardmäßig mit vorsehen; im Zuge ohnehin anstehender Arbeiten '
      + 'sind die Mehrkosten gering'
      + (alt.length ? `. Das betrifft insbesondere ${alt.length === 1 ? 'die Station' : 'die Stationen'} ${ggResNamen(alt, 6)}, `
        + `${alt.length === 1 ? 'die älter als 30 Jahre ist' : 'die älter als 30 Jahre sind'} und absehbar zur Erneuerung ${alt.length === 1 ? 'ansteht' : 'anstehen'}` : ''),
    'Informations-, Kommunikations-, Sicherheits- und Leittechnik in den kritischen Gebäuden über eine unterbrechungsfreie '
      + 'Stromversorgung (USV) puffern, damit die Umschaltzeit der Netzersatzanlagen ohne Ausfall überbrückt wird',
    'PV-Anlagen trennen sich bei Netzausfall vom Netz und tragen ohne netzbildende Einrichtung nichts zur Versorgung bei. Bei '
      + 'Neuplanung von PV-Anlagen und Batteriespeichern die Ersatzstrom- bzw. Inselnetzfähigkeit (netzbildender Wechselrichter) '
      + 'vorsehen; im Betrieb mit Netzersatzanlagen die PV-Einspeisung begrenzen, damit keine Rückleistung auf die Aggregate entsteht',
    'Im Betrieb über Netzersatzanlagen ist der Kurzschlussstrom deutlich geringer als am Netz. Abschaltbedingungen und '
      + 'Selektivität für diesen Betrieb nachweisen (DIN VDE 0100-410 und -551)',
    'Abgänge in den Hauptverteilungen nach ihrer Priorität eindeutig kennzeichnen und, wo wirtschaftlich, fernschaltbar ausführen, '
      + 'damit Lastabwurf und Zuschaltung ohne Begehung aller Standorte möglich sind',
    'Rahmenverträge für die Bereitstellung mobiler Aggregate und die priorisierte Nachlieferung von Kraftstoff abschließen, die '
      + 'Kraftstoffqualität der Lager durch Umwälzung, Filterung bzw. regelmäßigen Verbrauch sichern und eine vorhandene '
      + 'Betriebstankstelle in die Notstromversorgung einbeziehen',
    'Trinkwasserversorgung (Druckerhöhung), Abwasserhebeanlagen und Löschwassereinrichtungen in die Notstromplanung einbeziehen',
    'Netzpläne, Schaltpläne und eine Liste der Einspeisepunkte aktuell halten und in Papierform an den Stationen und in der '
      + 'Leitstelle vorhalten',
  ];
  return ggTextBlatt(['Darüber hinaus werden folgende allgemeine Maßnahmen empfohlen:', ...punkte.map(t => `– ${t}.`)], T);
}

/**
 * Übersichtsschema je Szenario: Netzanschlusspunkt, MS-Netz und je Trafostation eine Karte mit
 * Zustand, Gebäuden und — in Szenario 1 und 2 — den Aggregaten, in Szenario 3 der Zuschaltstufe.
 * cfg.stationen = [{ name, zeile2, zustand: 'nea'|'versorgt'|'aus'|'ohne', band, nea, gebaeude:[{name, klasse, nea}] }]
 * cfg.zentral = { zeilen: string[] } (Szenario 3) · cfg.extra = Karten ohne Netzzuordnung (gestrichelt, ohne Stich)
 */
export function ggRenderResSchema(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, hell = T.accents.gruen;
  const rot = T.energy.waerme;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const x0 = S.padX, x1 = W - S.padX;
  const karten = [...(cfg.stationen || []).map(k => ({ ...k, stich: true })), ...(cfg.extra || []).map(k => ({ ...k, stich: false }))];
  const n = karten.length;
  const cols = n <= 4 ? Math.max(n, 1) : n <= 10 ? 5 : 6;
  const reihen = Math.max(1, Math.ceil(n / cols));
  const gap = 14, cw = (x1 - x0 - (cols - 1) * gap) / cols;
  const ch = 178, stichH = 26, reiheAbstand = 18;
  const top = S.headBand + S.headHSchmal + 22;
  const busY = top + 118;
  const kartenTop = r => busY + stichH + r * (ch + stichH + reiheAbstand);
  const legY = kartenTop(reihen - 1) + ch + 30;
  const height = legY + 26 + (cfg.fussnote ? 22 : 0) + S.footSpace;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);

  const insel = cfg.modus === 'insel';
  const busFarbe = insel ? gruen : T.text.faint;

  // ── Netz des Netzbetreibers (ausgefallen) und Übergabe am NAP ──
  const napX = x0 + 90;
  out += `<rect x="${x0 + 0.5}" y="${top + 0.5}" width="180" height="38" fill="${T.neutral.cardBg}" stroke="${rot}"
            stroke-width="1.2" stroke-dasharray="5 3"/>`;
  out += txt(x0 + 90, top + 16, 'Netz des Netzbetreibers', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(x0 + 90, top + 31, 'Ausfall', { anchor: 'middle', size: 11, weight: 600, fill: rot });
  // Trennschalter geöffnet
  const sy = top + 52;
  out += `<line x1="${napX}" y1="${top + 38}" x2="${napX}" y2="${sy}" stroke="${T.text.faint}" stroke-width="1.6" stroke-dasharray="4 3"/>
          <line x1="${napX}" y1="${sy}" x2="${napX + 13}" y2="${sy + 22}" stroke="${T.text.strong}" stroke-width="2"/>
          <circle cx="${napX}" cy="${sy}" r="2.6" fill="${T.text.strong}"/>
          <line x1="${napX}" y1="${sy + 30}" x2="${napX}" y2="${busY}" stroke="${busFarbe}" stroke-width="2"/>`;
  out += txt(napX + 22, sy + 12, 'Netzanschlusspunkt (NAP)', { size: 11.5, weight: 600 });
  out += txt(napX + 22, sy + 27, insel ? 'Netztrennung geöffnet, Inselbetrieb' : 'Übergabe spannungslos',
             { size: 11, fill: T.text.muted });

  // ── zentrale Einspeisung am NAP (Szenario 3) ──
  if (cfg.zentral) {
    const zx = x0 + 400, zw = 250;
    out += `<rect x="${zx + 0.5}" y="${top + 0.5}" width="${zw}" height="64" fill="${T.tint}" stroke="${gruen}" stroke-width="1.4"/>`;
    out += `<circle cx="${zx + 28}" cy="${top + 32}" r="15" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.8"/>`;
    out += txt(zx + 28, top + 37, 'G', { anchor: 'middle', size: 14, weight: 700, fill: gruen });
    (cfg.zentral.zeilen || []).slice(0, 3).forEach((z, i) => {
      out += txt(zx + 54, top + 19 + i * 16, z, { size: i ? 11 : 12, weight: i ? 400 : 700, fill: i ? T.text.muted : T.text.strong });
    });
    // Maschinentrafo zwischen Aggregat und Sammelschiene
    const mx = zx + zw / 2, my = top + 86;
    out += `<line x1="${mx}" y1="${top + 64}" x2="${mx}" y2="${my - 16}" stroke="${gruen}" stroke-width="2"/>
            <circle cx="${mx}" cy="${my - 7}" r="9" fill="none" stroke="${gruen}" stroke-width="1.6"/>
            <circle cx="${mx}" cy="${my + 5}" r="9" fill="none" stroke="${gruen}" stroke-width="1.6"/>
            <line x1="${mx}" y1="${my + 14}" x2="${mx}" y2="${busY}" stroke="${gruen}" stroke-width="2"/>`;
    out += txt(mx + 16, my + 3, cfg.zentral.trafo || 'Maschinentrafo', { size: 11, fill: T.text.muted });
  }

  // ── MS-Sammelschiene bzw. MS-Netz ──
  out += `<line x1="${napX}" y1="${busY}" x2="${x1}" y2="${busY}" stroke="${busFarbe}" stroke-width="${insel ? 4 : 3}"
            ${insel ? '' : 'stroke-dasharray="10 5"'}/>`;
  out += txt(x1, busY - 8, insel ? 'MS-Netz der Liegenschaft (Inselbetrieb)' : 'MS-Netz der Liegenschaft (spannungslos)',
             { anchor: 'end', size: 11, weight: 600, fill: insel ? gruen : T.text.muted });
  // weitere Reihen hängen über eine senkrechte Leitung an der Sammelschiene
  for (let r = 1; r < reihen; r++) {
    const y = kartenTop(r) - stichH;
    out += `<line x1="${napX}" y1="${busY}" x2="${napX}" y2="${y}" stroke="${busFarbe}" stroke-width="2" ${insel ? '' : 'stroke-dasharray="6 4"'}/>
            <line x1="${napX}" y1="${y}" x2="${x1}" y2="${y}" stroke="${busFarbe}" stroke-width="2" ${insel ? '' : 'stroke-dasharray="6 4"'}/>`;
  }

  if (!n) {
    out += txt(W / 2, busY + 70, cfg.leer || 'Keine Transformatorstationen im Netzmodell.', { anchor: 'middle', size: 13, fill: T.text.faint });
  }

  // ── Karten je Station ──
  const zust = {
    nea:      { fill: T.tint,            rand: gruen,          band: gruen,              bandTxt: '#FFFFFF' },
    versorgt: { fill: T.tint,            rand: hell,           band: hell,               bandTxt: '#FFFFFF' },
    aus:      { fill: T.neutral.cardBg,  rand: T.text.faint,   band: T.neutral.band,     bandTxt: T.text.muted, strich: true },
    ohne:     { fill: T.neutral.cardBg,  rand: T.line,         band: T.neutral.band,     bandTxt: T.text.muted },
  };
  const zeichenBreite = size => size * 0.56;
  karten.forEach((k, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const kx = x0 + c * (cw + gap), ky = kartenTop(r);
    const z = zust[k.zustand] || zust.ohne;
    const cx = kx + cw / 2;
    if (k.stich) {
      out += `<line x1="${gR(cx)}" y1="${ky - stichH}" x2="${gR(cx)}" y2="${ky}" stroke="${insel && k.zustand !== 'aus' ? gruen : T.text.faint}"
                stroke-width="1.6" ${insel && k.zustand !== 'aus' ? '' : 'stroke-dasharray="4 3"'}/>`;
      if (k.zustand === 'aus') {   // offener Schalter im Stich
        out += `<path d="M${gR(cx - 5)} ${ky - 18}l10 10M${gR(cx + 5)} ${ky - 18}l-10 10" stroke="${rot}" stroke-width="1.8"/>`;
      }
    }
    out += `<rect x="${gR(kx) + 0.5}" y="${ky + 0.5}" width="${gR(cw) - 1}" height="${ch - 1}" fill="${z.fill}" stroke="${z.rand}"
              stroke-width="1.2" ${z.strich || !k.stich ? 'stroke-dasharray="5 3"' : ''}/>`;
    // Trafosymbol bzw. Gebäudesymbol
    const sy0 = ky + 12;
    if (k.stich) {
      out += `<circle cx="${gR(cx)}" cy="${sy0 + 8}" r="8" fill="none" stroke="${T.text.strong}" stroke-width="1.4"/>
              <circle cx="${gR(cx)}" cy="${sy0 + 19}" r="8" fill="none" stroke="${T.text.strong}" stroke-width="1.4"/>`;
    } else {
      out += `<path d="M${gR(cx - 10)} ${sy0 + 27}v-13l10 -8l10 8v13z" fill="none" stroke="${T.text.strong}" stroke-width="1.4"/>`;
    }
    if (k.nea) {   // Aggregat an der Station
      const gx = cx + 30, gy = sy0 + 14;
      out += `<line x1="${gR(cx + 8)}" y1="${gy}" x2="${gR(gx - 11)}" y2="${gy}" stroke="${gruen}" stroke-width="1.6"/>
              <circle cx="${gR(gx)}" cy="${gy}" r="11" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.8"/>`;
      out += txt(gx, gy + 4.5, 'G', { anchor: 'middle', size: 12, weight: 700, fill: gruen });
    }
    const maxZ = Math.floor((cw - 16) / zeichenBreite(12));
    out += txt(cx, ky + 56, ggResKuerzen(k.name || '', maxZ), { anchor: 'middle', size: 12.5, weight: 700 });
    if (k.zeile2) out += txt(cx, ky + 72, ggResKuerzen(k.zeile2, Math.floor((cw - 12) / zeichenBreite(11))),
                             { anchor: 'middle', size: 11, fill: T.text.muted });
    // Gebäude
    const geb = k.gebaeude || [];
    const maxZeilen = 4;
    const zeigen = geb.length > maxZeilen ? geb.slice(0, maxZeilen - 1) : geb;
    zeigen.forEach((g, j) => {
      const gy = ky + 92 + j * 15;
      out += `<rect x="${gR(kx + 10)}" y="${gy - 8}" width="8" height="8" fill="${GG_RES_KLASSE_FARBE[g.klasse] || T.text.faint}"/>`;
      out += txt(kx + 23, gy, ggResKuerzen(g.name, Math.floor((cw - (g.nea ? 48 : 30)) / zeichenBreite(10.5))),
                 { size: 10.5, fill: T.text.strong });
      if (g.nea) {
        out += `<circle cx="${gR(kx + cw - 16)}" cy="${gy - 4}" r="7" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.4"/>`
             + txt(kx + cw - 16, gy - 0.8, 'G', { anchor: 'middle', size: 9, weight: 700, fill: gruen });
      }
    });
    if (geb.length > maxZeilen) {
      out += txt(kx + 23, ky + 92 + (maxZeilen - 1) * 15, `+ ${geb.length - zeigen.length} weitere`, { size: 10.5, fill: T.text.muted });
    }
    if (!geb.length && k.ohneGebText) {
      out += txt(cx, ky + 100, k.ohneGebText, { anchor: 'middle', size: 10.5, fill: T.text.faint });
    }
    // Zustandsband
    const bh = 26;
    out += `<rect x="${gR(kx) + 1}" y="${ky + ch - bh}" width="${gR(cw) - 2}" height="${bh - 1}" fill="${z.band}"/>`;
    out += txt(cx, ky + ch - 8.5, ggResKuerzen(k.band || '', Math.floor((cw - 10) / zeichenBreite(11))),
               { anchor: 'middle', size: 11, weight: 600, fill: z.bandTxt });
  });

  // ── Legende ──
  let lx = x0;
  for (const e of cfg.legende || []) {
    if (e.art === 'klasse') {
      out += `<rect x="${gR(lx)}" y="${legY - 9}" width="10" height="10" fill="${e.farbe}"/>`;
    } else if (e.art === 'g') {
      out += `<circle cx="${gR(lx + 6)}" cy="${legY - 4}" r="7" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.6"/>`
           + txt(lx + 6, legY - 0.5, 'G', { anchor: 'middle', size: 9, weight: 700, fill: gruen });
    } else {
      out += `<rect x="${gR(lx)}" y="${legY - 11}" width="16" height="14" fill="${e.farbe}" stroke="${e.rand || e.farbe}"
                ${e.strich ? 'stroke-dasharray="3 2"' : ''}/>`;
    }
    out += txt(lx + 20, legY, e.text, { size: 11 });
    lx += 20 + ggEstW(e.text, 11) + 22;
  }
  if (cfg.fussnote) out += txt(x0, legY + 24, cfg.fussnote, { size: S.fsTab - 2, fill: T.text.faint });
  return ggFinishSvg(out, W, height);
}

/** Prinzip des Einspeisepunkts an einer Trafostation (allgemeine Empfehlung 5.2.6 und Szenario 2, 5.2.3). */
export function ggRenderEinspeisePrinzip(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const top = S.headBand + S.headHSchmal + 26;
  const legTop = top + 352;
  const legenden = cfg.punkte || [];
  const height = legTop + Math.ceil(legenden.length / 2) * 38 + S.footSpace + 6;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);
  const strich = T.text.strong;
  const nr = (x, y, k) => `<circle cx="${x}" cy="${y}" r="10" fill="${gruen}"/>`
    + txt(x, y + 4, String(k), { anchor: 'middle', size: 11, weight: 700, fill: '#FFFFFF' });

  // Stationsgebäude
  const sx = 40, sw = 560, sy = top, sh = 200;
  out += `<rect x="${sx}.5" y="${sy}.5" width="${sw}" height="${sh}" fill="${T.neutral.cardBg}" stroke="${T.rule}" stroke-width="1.4"/>`;
  out += txt(sx + 12, sy + 20, 'TRANSFORMATORSTATION', { mono: true, size: 10.5, weight: 600, tracking: 1.2, fill: T.text.muted });
  const werte = cfg.werte || {};
  if (werte.station) out += txt(sx + sw - 12, sy + 20, ggResKuerzen(werte.station, 40), { anchor: 'end', size: 11, fill: T.text.muted });

  // MS-Einspeisung und Trafo
  const tx = sx + 80, ty = sy + 88;
  out += `<line x1="${tx}" y1="${sy - 18}" x2="${tx}" y2="${ty - 22}" stroke="${strich}" stroke-width="2"/>`;
  out += txt(tx + 10, sy - 6, 'MS-Netz', { size: 11, fill: T.text.muted });
  out += `<circle cx="${tx}" cy="${ty - 10}" r="13" fill="none" stroke="${strich}" stroke-width="1.6"/>
          <circle cx="${tx}" cy="${ty + 8}" r="13" fill="none" stroke="${strich}" stroke-width="1.6"/>`;
  out += txt(tx - 22, ty + 2, 'Trafo', { anchor: 'end', size: 11, fill: T.text.muted });
  out += `<line x1="${tx}" y1="${ty + 21}" x2="${tx}" y2="${ty + 60}" stroke="${strich}" stroke-width="2"/>
          <line x1="${tx}" y1="${ty + 60}" x2="${tx + 110}" y2="${ty + 60}" stroke="${strich}" stroke-width="2"/>`;

  // Umschalteinrichtung Netz – 0 – NEA
  const ux = tx + 110, uy = ty + 40, uw = 120, uh = 40;
  out += `<rect x="${ux}.5" y="${uy}.5" width="${uw}" height="${uh}" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>`;
  out += txt(ux + uw / 2, uy + 17, 'Umschaltung', { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(ux + uw / 2, uy + 32, 'Netz – 0 – NEA', { anchor: 'middle', size: 11, fill: T.text.muted });
  out += nr(ux + uw - 2, uy - 2, 1);

  // NSHV-Sammelschiene mit Abgängen
  const nx = ux + uw + 60, ny0 = sy + 40, ny1 = sy + sh - 22;
  out += `<line x1="${ux + uw}" y1="${uy + uh / 2}" x2="${nx}" y2="${uy + uh / 2}" stroke="${strich}" stroke-width="2"/>
          <line x1="${nx}" y1="${ny0}" x2="${nx}" y2="${ny1}" stroke="${strich}" stroke-width="5"/>`;
  out += txt(nx, ny0 - 8, 'NSHV', { anchor: 'middle', size: 11, weight: 600 });
  const abg = [
    { y: ny0 + 18, text: 'Abgang Klasse A', farbe: GG_RES_KLASSE_FARBE.A },
    { y: ny0 + 58, text: 'Abgang Klasse B', farbe: GG_RES_KLASSE_FARBE.B },
    { y: ny0 + 98, text: 'Abgang ohne Versorgung', farbe: T.text.faint, aus: true },
  ];
  for (const a of abg) {
    out += `<line x1="${nx}" y1="${a.y}" x2="${nx + 36}" y2="${a.y}" stroke="${strich}" stroke-width="1.6"/>`;
    if (a.aus) out += `<line x1="${nx + 36}" y1="${a.y}" x2="${nx + 48}" y2="${a.y - 9}" stroke="${strich}" stroke-width="1.6"/>`;
    out += `<line x1="${nx + (a.aus ? 50 : 36)}" y1="${a.y}" x2="${sx + sw + 70}" y2="${a.y}" stroke="${strich}" stroke-width="1.6"
              ${a.aus ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#gg-pfeil)"/>`;
    out += `<rect x="${sx + sw + 78}" y="${a.y - 6}" width="10" height="10" fill="${a.farbe}"/>`;
    out += txt(sx + sw + 94, a.y + 3.5, a.text, { size: 11 });
  }
  out += nr(nx + 22, ny0 + 118, 5);
  out = `<defs><marker id="gg-pfeil" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
           <path d="M0 0L10 5L0 10z" fill="${strich}"/></marker></defs>` + out;

  // Einspeisekasten an der Außenwand
  const ex = ux + 20, ey = sy + sh - 6, ew = 80, eh = 32;
  out += `<line x1="${ux + uw / 2}" y1="${uy + uh}" x2="${ux + uw / 2}" y2="${ey}" stroke="${gruen}" stroke-width="2"/>`;
  out += `<rect x="${ex}.5" y="${ey}.5" width="${ew}" height="${eh}" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.6"/>`;
  out += txt(ex + ew / 2, ey + 14, 'Einspeise-', { anchor: 'middle', size: 10.5, weight: 600 });
  out += txt(ex + ew / 2, ey + 26, 'kasten', { anchor: 'middle', size: 10.5, weight: 600 });
  out += nr(ex + ew + 12, ey + 6, 2);
  out += nr(ux + uw / 2 + 16, uy + uh + 13, 3);

  // mobiles Aggregat auf Stellfläche
  const px = ex - 40, py = ey + eh + 34, pw = 420, ph = 74;
  out += `<rect x="${px}.5" y="${py}.5" width="${pw}" height="${ph}" fill="none" stroke="${T.text.faint}" stroke-width="1.2" stroke-dasharray="6 4"/>`;
  out += txt(px + pw - 10, py + ph - 8, 'befestigte Stellfläche, Zufahrt für Tankfahrzeug', { anchor: 'end', size: 10.5, fill: T.text.muted });
  out += nr(px + pw - 12, py + 12, 4);
  const ax = px + 34, ay = py + 10;
  out += `<rect x="${ax}" y="${ay}" width="120" height="36" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>
          <circle cx="${ax + 24}" cy="${ay + 44}" r="6" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.4"/>
          <circle cx="${ax + 96}" cy="${ay + 44}" r="6" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.4"/>
          <circle cx="${ax + 22}" cy="${ay + 18}" r="11" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.6"/>`;
  out += txt(ax + 22, ay + 22.5, 'G', { anchor: 'middle', size: 12, weight: 700, fill: gruen });
  if (werte.nea) {
    out += txt(ax + 40, ay + 15, werte.neaTitel || 'NEA', { size: 11, weight: 600 });
    out += txt(ax + 40, ay + 29, ggResKuerzen(werte.nea, 12), { size: 10.5, fill: T.text.muted });
  } else {
    out += txt(ax + 40, ay + 22, werte.neaTitel || 'mobile NEA', { size: 11, weight: 600 });
  }
  // Anschlusskabel
  out += `<path d="M${ax + 96} ${ay}C${ax + 96} ${ay - 18} ${ex + ew / 2} ${ey + eh + 18} ${ex + ew / 2} ${ey + eh}"
            fill="none" stroke="${gruen}" stroke-width="2.2"/>`;
  // Erdung
  const erx = ax + 60, ery = ay + 36;
  out += `<line x1="${erx}" y1="${ery}" x2="${erx}" y2="${ery + 14}" stroke="${strich}" stroke-width="1.4"/>
          <path d="M${erx - 9} ${ery + 14}h18M${erx - 6} ${ery + 18}h12M${erx - 3} ${ery + 22}h6" stroke="${strich}" stroke-width="1.4"/>`;
  out += nr(erx - 22, ery + 14, 6);

  // Nummernlegende zweispaltig
  const colW = (W - 2 * S.padX) / 2;
  legenden.forEach((t, i) => {
    const lx = S.padX + (i % 2) * colW, ly = legTop + Math.floor(i / 2) * 38;
    out += nr(lx + 10, ly + 6, i + 1);
    const zeilen = ggResUmbruch(t, Math.floor((colW - 40) / (11 * 0.53)));
    zeilen.slice(0, 2).forEach((z, j) => { out += txt(lx + 28, ly + 10 + j * 14, z, { size: 11 }); });
  });
  return ggFinishSvg(out, W, height);
}

/**
 * Prinzip einer stationären NEA, die ein Gebäude versorgt (Szenario 1, 5.2.2): Netzüberwachung, automatische
 * Umschaltung Netz – NEA, Aufstellraum mit Kraftstoff, Notstromschiene mit USV, Klasse A, Wärme und Lastabwurf.
 * cfg.werte = { gebaeude, nea, tank } (Beschriftungen, leer = allgemein)
 */
export function ggRenderGebaeudeNeaPrinzip(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, rot = T.energy.waerme;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const strich = T.text.strong, blass = T.text.faint;
  const w = cfg.werte || {};
  const top = S.headBand + S.headHSchmal + 26;
  const busY = top + 236, stTop = busY + 64, stH = 66;
  const byTop = top + 64, byBot = stTop + stH + 14;
  const punkte = cfg.punkte || [];
  const legTop = byBot + 30;
  const height = legTop + Math.ceil(punkte.length / 2) * 38 + S.footSpace + 6;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = `<defs><marker id="gg-pfeil-nea" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
               <path d="M0 0L10 5L0 10z" fill="${strich}"/></marker></defs>`;
  out += ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);
  const nr = (x, y, k) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="10" fill="${gruen}"/>`
    + txt(x, y + 4, String(k), { anchor: 'middle', size: 11, weight: 700, fill: '#FFFFFF' });
  const schalter = (x, y, offen, farbe = strich) => {
    const k = y + 30;
    return `<path d="M${gR(x - 4)} ${k - 4}l8 8M${gR(x + 4)} ${k - 4}l-8 8" stroke="${farbe}" stroke-width="1.6"/>`
      + `<line x1="${gR(x)}" y1="${y}" x2="${gR(offen ? x + 13 : x)}" y2="${offen ? k - 5 : k}" stroke="${farbe}" stroke-width="2"/>`
      + `<circle cx="${gR(x)}" cy="${y}" r="2.4" fill="${farbe}"/>`;
  };

  // ── Netz des Netzbetreibers (ausgefallen) ──
  const napX = 135;
  out += `<rect x="40.5" y="${top + 0.5}" width="190" height="38" fill="${T.neutral.cardBg}" stroke="${rot}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
  out += txt(napX, top + 16, 'Netz (Trafostation)', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(napX, top + 31, 'Ausfall', { anchor: 'middle', size: 11, weight: 600, fill: rot });

  // ── Gebäude ──
  out += `<rect x="40.5" y="${byTop + 0.5}" width="600" height="${byBot - byTop}" fill="none" stroke="${T.rule}" stroke-width="1.4"/>`;
  out += txt(240, byTop + 18, 'GEBÄUDE · NOTSTROMKLASSE A', { mono: true, size: 10.5, weight: 600, tracking: 1.2, fill: T.text.muted });
  if (w.gebaeude) out += txt(628, byTop + 18, ggResKuerzen(w.gebaeude, 32), { anchor: 'end', size: 11, fill: T.text.muted });

  // Hausanschluss, Netzüberwachung
  out += `<line x1="${napX}" y1="${top + 38}" x2="${napX}" y2="${top + 76}" stroke="${blass}" stroke-width="2" stroke-dasharray="4 3"/>`;
  out += `<rect x="${napX - 50}.5" y="${top + 76.5}" width="100" height="20" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.2"/>`;
  out += txt(napX, top + 90, 'HAK · Zähler', { anchor: 'middle', size: 10.5, weight: 600 });
  out += `<line x1="${napX}" y1="${top + 97}" x2="${napX}" y2="${top + 148}" stroke="${blass}" stroke-width="2" stroke-dasharray="4 3"/>`;
  out += `<line x1="${napX}" y1="${top + 121}" x2="${napX + 30}" y2="${top + 121}" stroke="${strich}" stroke-width="1.2"/>
          <rect x="${napX + 30}.5" y="${top + 112.5}" width="30" height="18" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.2"/>`;
  out += txt(napX + 45, top + 125, 'U<', { anchor: 'middle', size: 10.5, weight: 700 });
  out += txt(napX + 68, top + 112, 'Netzüberwachung', { size: 10.5, fill: T.text.muted });
  out += nr(napX - 30, top + 121, 1);

  // Umschaltung Netz – NEA
  const ux = 60, uw = 150, uy = top + 148, uh = 46;
  out += `<rect x="${ux}.5" y="${uy}.5" width="${uw}" height="${uh}" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>`;
  out += txt(ux + uw / 2, uy + 19, 'Netzumschaltung', { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(ux + uw / 2, uy + 35, 'Netz – NEA · automatisch', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += nr(ux + uw, uy - 2, 2);
  out += `<line x1="${napX}" y1="${uy + uh}" x2="${napX}" y2="${busY}" stroke="${gruen}" stroke-width="2"/>`;

  // ── Aufstellraum mit NEA und Kraftstoff ──
  const cx0 = 700, cx1 = 960, cy1 = top + 250;
  out += `<rect x="${cx0}.5" y="${byTop + 0.5}" width="${cx1 - cx0}" height="${cy1 - byTop}" fill="none" stroke="${blass}" stroke-width="1.2" stroke-dasharray="6 4"/>`;
  out += txt(cx0 + 12, byTop + 18, 'AUFSTELLRAUM / CONTAINER', { mono: true, size: 10, weight: 600, tracking: 1.1, fill: T.text.muted });
  const nx = 720, ny = top + 96, nw = 220, nh = 52;
  out += `<rect x="${nx}.5" y="${ny}.5" width="${nw}" height="${nh}" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>
          <circle cx="${nx + 24}" cy="${ny + 26}" r="12" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.6"/>`;
  out += txt(nx + 24, ny + 30.5, 'G', { anchor: 'middle', size: 12, weight: 700, fill: gruen });
  out += txt(nx + 46, ny + 22, 'Netzersatzanlage', { size: 12, weight: 700 });
  out += txt(nx + 46, ny + 38, ggResKuerzen(w.nea || 'Diesel, stationär', 24), { size: 11, fill: T.text.muted });
  out += nr(nx + nw, ny, 3);
  // Abgas über Dach, Zu- und Abluft
  out += `<line x1="${nx + 190}" y1="${ny}" x2="${nx + 190}" y2="${top + 24}" stroke="${strich}" stroke-width="1.6" marker-end="url(#gg-pfeil-nea)"/>`;
  out += txt(nx + 182, top + 34, 'Abgas über Dach', { anchor: 'end', size: 10.5, fill: T.text.muted });
  out += `<line x1="${cx1 - 40}" y1="${cy1 + 16}" x2="${cx1 - 40}" y2="${cy1 - 12}" stroke="${strich}" stroke-width="1.4" marker-end="url(#gg-pfeil-nea)"/>
          <line x1="${cx1 - 24}" y1="${cy1 - 12}" x2="${cx1 - 24}" y2="${cy1 + 16}" stroke="${strich}" stroke-width="1.4" marker-end="url(#gg-pfeil-nea)"/>`;
  out += txt(cx1 - 50, cy1 + 16, 'Zu-/Abluft', { anchor: 'end', size: 10.5, fill: T.text.muted });
  // Kraftstoff
  const tx = 720, ty = top + 176, tw = 160, th = 44;
  out += `<line x1="${tx + 40}" y1="${ty}" x2="${tx + 40}" y2="${ny + nh}" stroke="${blass}" stroke-width="1.6" stroke-dasharray="3 3"/>`;
  out += `<rect x="${tx}.5" y="${ty}.5" width="${tw}" height="${th}" fill="${T.neutral.cardBg}" stroke="${T.rule}" stroke-width="1.4"/>`;
  out += txt(tx + tw / 2, ty + 18, 'Kraftstoff', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(tx + tw / 2, ty + 34, ggResKuerzen(w.tank || 'Tages- und Lagertank', 26), { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += nr(tx + tw, ty, 4);

  // Einspeisung der NEA und Steuerleitung
  out += `<path d="M${nx} ${ny + 40}H670V${uy + 23}H${ux + uw}" fill="none" stroke="${gruen}" stroke-width="2.2"/>`;
  out += txt(420, uy + 16, 'Einspeisung der NEA', { anchor: 'middle', size: 10.5, weight: 600, fill: gruen });
  out += `<path d="M${napX + 60} ${top + 121}H680V${ny + 12}H${nx}" fill="none" stroke="${blass}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  out += txt(420, top + 115, 'Start · Umschaltung · Rückschaltung', { anchor: 'middle', size: 10.5, fill: T.text.muted });

  // ── Notstromschiene und Abgänge ──
  out += `<line x1="70" y1="${busY}" x2="610" y2="${busY}" stroke="${gruen}" stroke-width="5"/>`;
  out += txt(napX + 16, busY - 9, 'Hauptverteilung · Notstromschiene', { size: 11, weight: 600, fill: gruen });
  const abg = [
    { titel: 'USV', unter: 'IT · Kommunikation', nr: 5 },
    { titel: 'Klasse A', unter: 'kritische Verbraucher', nr: 6, klasse: GG_RES_KLASSE_FARBE.A },
    { titel: 'Heizung', unter: 'Pumpen · Regelung', nr: 7 },
    { titel: 'übrige Verbraucher', unter: 'Lastabwurf', nr: 8, aus: true },
  ];
  const bw = 132;
  abg.forEach((a, i) => {
    const cx = 120 + i * 140;
    const farbe = a.aus ? blass : gruen;
    out += `<line x1="${cx}" y1="${busY}" x2="${cx}" y2="${busY + 14}" stroke="${farbe}" stroke-width="2"/>`;
    out += schalter(cx, busY + 14, !!a.aus, a.aus ? strich : gruen);
    out += `<line x1="${cx}" y1="${busY + 44}" x2="${cx}" y2="${stTop}" stroke="${farbe}" stroke-width="2" ${a.aus ? 'stroke-dasharray="4 3"' : ''}/>`;
    out += nr(cx - 26, busY + 30, a.nr);
    const bx = cx - bw / 2;
    out += `<rect x="${bx}.5" y="${stTop + 0.5}" width="${bw}" height="${stH}" fill="${a.aus ? T.neutral.cardBg : T.tint}"
              stroke="${a.aus ? blass : T.accents.gruen}" stroke-width="1.2" ${a.aus ? 'stroke-dasharray="5 3"' : ''}/>`;
    // Klassenfarbe als Kästchen vor dem Titel, beides zusammen mittig
    const tw2 = ggEstW(a.titel, 12);
    const tx2 = a.klasse ? cx + 8 : cx;
    if (a.klasse) out += `<rect x="${gR(cx - (16 + tw2) / 2)}" y="${stTop + 20}" width="10" height="10" fill="${a.klasse}"/>`;
    out += txt(tx2, stTop + 30, a.titel, { anchor: 'middle', size: 12, weight: 700, fill: a.aus ? T.text.muted : T.text.strong });
    out += txt(cx, stTop + 48, a.unter, { anchor: 'middle', size: 10.5, fill: T.text.muted });
  });

  // ── Nummernlegende zweispaltig ──
  const colW = (W - 2 * S.padX) / 2;
  punkte.forEach((t, i) => {
    const px = S.padX + (i % 2) * colW, py = legTop + Math.floor(i / 2) * 38;
    out += nr(px + 10, py + 6, i + 1);
    ggResUmbruch(t, Math.floor((colW - 40) / (11 * 0.53))).slice(0, 2)
      .forEach((z, j) => { out += txt(px + 28, py + 10 + j * 14, z, { size: 11 }); });
  });
  return ggFinishSvg(out, W, height);
}

/** Einfacher Zeilenumbruch nach Zeichenzahl (für SVG-Beschriftungen). */
function ggResUmbruch(text, maxZ) {
  const zeilen = [];
  let z = '';
  for (const w of String(text).split(/\s+/)) {
    if (z && (z + ' ' + w).length > maxZ) { zeilen.push(z); z = w; } else z = z ? `${z} ${w}` : w;
  }
  if (z) zeilen.push(z);
  return zeilen;
}

/**
 * Prinzip des Inselbetriebs der Liegenschaft (Szenario 3, 5.2.4): Netztrennung am NAP, zentrale NEA mit
 * Maschinentrafo und Sternpunktbildung auf der MS-Sammelschiene, Stationsabgänge in Zuschaltstufen.
 * cfg.werte = { nea, mt, uKv, tank } (Beschriftungen, leer = allgemein) · cfg.abgaenge = [{ titel, unter, aus }]
 */
export function ggRenderInselPrinzip(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, rot = T.energy.waerme;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const strich = T.text.strong;
  const w = cfg.werte || {};
  const top = S.headBand + S.headHSchmal + 26;
  const busY = top + 158;
  const stTop = busY + 76, stH = 82;
  const punkte = cfg.punkte || [];
  const legTop = stTop + stH + 30;
  const height = legTop + Math.ceil(punkte.length / 2) * 38 + S.footSpace + 6;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);
  const nr = (x, y, k) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="10" fill="${gruen}"/>`
    + txt(x, y + 4, String(k), { anchor: 'middle', size: 11, weight: 700, fill: '#FFFFFF' });
  // Leistungsschalter senkrecht von y bis y + 30: Schaltmesser, am Festkontakt ein Kreuz
  const schalter = (x, y, offen, farbe = strich) => {
    const k = y + 30;
    return `<path d="M${gR(x - 4)} ${k - 4}l8 8M${gR(x + 4)} ${k - 4}l-8 8" stroke="${farbe}" stroke-width="1.6"/>`
      + `<line x1="${gR(x)}" y1="${y}" x2="${gR(offen ? x + 13 : x)}" y2="${offen ? k - 5 : k}" stroke="${farbe}" stroke-width="2"/>`
      + `<circle cx="${gR(x)}" cy="${y}" r="2.4" fill="${farbe}"/>`;
  };
  const erde = (x, y) => `<path d="M${x - 9} ${y}h18M${x - 6} ${y + 4}h12M${x - 3} ${y + 8}h6" stroke="${strich}" stroke-width="1.4"/>`;

  // ── Netz des Netzbetreibers und Netztrennung am NAP ──
  const napX = 135;
  out += `<rect x="40.5" y="${top + 0.5}" width="190" height="38" fill="${T.neutral.cardBg}" stroke="${rot}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
  out += txt(135, top + 16, 'Netz des Netzbetreibers', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(135, top + 31, 'Ausfall', { anchor: 'middle', size: 11, weight: 600, fill: rot });
  out += `<line x1="${napX}" y1="${top + 38}" x2="${napX}" y2="${top + 62}" stroke="${T.text.faint}" stroke-width="2" stroke-dasharray="4 3"/>`;
  out += schalter(napX, top + 62, true);
  out += `<line x1="${napX}" y1="${top + 92}" x2="${napX}" y2="${busY}" stroke="${gruen}" stroke-width="2"/>`;
  out += txt(napX + 24, top + 104, 'Netzanschlusspunkt (NAP)', { size: 11.5, weight: 600 });
  out += txt(napX + 24, top + 119, 'Netztrennung geöffnet', { size: 11, fill: T.text.muted });
  out += nr(napX - 24, top + 78, 1);

  // ── Leittechnik ──
  const lx = 300, lw = 200;
  out += `<rect x="${lx}.5" y="${top + 0.5}" width="${lw}" height="52" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.2"/>`;
  out += txt(lx + lw / 2, top + 20, 'Lastmanagement / Leittechnik', { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(lx + lw / 2, top + 37, 'Umschaltung · Zuschaltung · Lastabwurf', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += nr(lx + lw, top, 8);

  // ── Netzersatzanlage, Kraftstofflager ──
  const nx = 560, nw = 220, nh = 56;
  out += `<rect x="${nx}.5" y="${top + 0.5}" width="${nw}" height="${nh}" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>`;
  const nG = Math.max(1, Math.min(3, w.neaAnzahl || 2));
  for (let i = 0; i < nG; i++) {
    out += `<circle cx="${nx + 24 + i * 26}" cy="${top + 28}" r="11" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.6"/>`
      + txt(nx + 24 + i * 26, top + 32.5, 'G', { anchor: 'middle', size: 11, weight: 700, fill: gruen });
  }
  const tx0 = nx + 24 + nG * 26;
  out += txt(tx0, top + 24, 'Netzersatzanlage', { size: 12, weight: 700 });
  out += txt(tx0, top + 40, w.nea || 'Aggregate im Parallelbetrieb', { size: 11, fill: T.text.muted });
  out += nr(nx + nw, top, 5);
  const kx = 820;
  out += `<rect x="${kx}.5" y="${top + 6.5}" width="130" height="44" fill="${T.neutral.cardBg}" stroke="${T.rule}" stroke-width="1.4"/>`;
  out += txt(kx + 65, top + 24, 'Kraftstofflager', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(kx + 65, top + 40, w.tank || 'für die Autonomiedauer', { anchor: 'middle', size: 11, fill: T.text.muted });
  out += `<line x1="${nx + nw}" y1="${top + 28}" x2="${kx}" y2="${top + 28}" stroke="${T.text.faint}" stroke-width="1.6" stroke-dasharray="3 3"/>`;
  // Steuerleitungen der Leittechnik
  out += `<path d="M${lx} ${top + 46}H${napX + 40}V${top + 77}H${napX + 17}" fill="none" stroke="${T.text.faint}" stroke-width="1.2" stroke-dasharray="4 3"/>
          <line x1="${lx + lw}" y1="${top + 26}" x2="${nx}" y2="${top + 26}" stroke="${T.text.faint}" stroke-width="1.2" stroke-dasharray="4 3"/>`;

  // ── Maschinentrafo, Sternpunkt, Einspeisefeld ──
  const mx = nx + 110;
  out += `<line x1="${mx}" y1="${top + nh}" x2="${mx}" y2="${top + 68}" stroke="${gruen}" stroke-width="2"/>
          <circle cx="${mx}" cy="${top + 77}" r="9" fill="none" stroke="${gruen}" stroke-width="1.6"/>
          <circle cx="${mx}" cy="${top + 89}" r="9" fill="none" stroke="${gruen}" stroke-width="1.6"/>
          <line x1="${mx}" y1="${top + 98}" x2="${mx}" y2="${top + 112}" stroke="${gruen}" stroke-width="2"/>`;
  out += txt(mx + 20, top + 80, 'Maschinentrafo', { size: 11.5, weight: 600 });
  out += txt(mx + 20, top + 95, w.mt || `0,4/${w.uKv || 20} kV`, { size: 11, fill: T.text.muted });
  out += nr(mx + 172, top + 84, 3);
  // Sternpunktbildung über Widerstand
  const sx = mx - 60;
  out += `<path d="M${mx - 9} ${top + 89}H${sx}V${top + 100}" fill="none" stroke="${strich}" stroke-width="1.4"/>
          <rect x="${sx - 4}" y="${top + 100}" width="8" height="18" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.4"/>
          <line x1="${sx}" y1="${top + 118}" x2="${sx}" y2="${top + 124}" stroke="${strich}" stroke-width="1.4"/>`;
  out += erde(sx, top + 124);
  out += txt(sx - 14, top + 106, 'Sternpunkt', { anchor: 'end', size: 11, fill: T.text.muted });
  out += nr(sx - 90, top + 102, 4);
  out += schalter(mx, top + 112, false, gruen);
  out += `<line x1="${mx}" y1="${top + 142}" x2="${mx}" y2="${busY}" stroke="${gruen}" stroke-width="2"/>`;
  out += txt(mx + 20, top + 132, 'Einspeisefeld', { size: 11, fill: T.text.muted });
  out += nr(mx + 106, top + 128, 2);

  // ── MS-Sammelschiene ──
  out += `<line x1="100" y1="${busY}" x2="900" y2="${busY}" stroke="${gruen}" stroke-width="5"/>`;
  out += txt(napX + 24, busY - 9, `MS-Netz der Liegenschaft (${w.uKv || 20} kV) im Inselbetrieb`, { size: 11, weight: 600, fill: gruen });

  // ── Stationsabgänge in Zuschaltstufen ──
  const abg = (cfg.abgaenge || []).slice(0, 4);
  const n = Math.max(abg.length, 1);
  const bw = 150, x0 = 110, x1 = 890;
  const schritt = n > 1 ? (x1 - x0 - bw) / (n - 1) : 0;
  abg.forEach((a, i) => {
    const cx = n > 1 ? x0 + bw / 2 + i * schritt : (x0 + x1) / 2;
    const farbe = a.aus ? T.text.faint : gruen;
    out += `<line x1="${gR(cx)}" y1="${busY}" x2="${gR(cx)}" y2="${busY + 14}" stroke="${farbe}" stroke-width="2"/>`;
    out += schalter(cx, busY + 14, !!a.aus, a.aus ? strich : gruen);
    out += `<line x1="${gR(cx)}" y1="${busY + 44}" x2="${gR(cx)}" y2="${stTop}" stroke="${farbe}" stroke-width="2" ${a.aus ? 'stroke-dasharray="4 3"' : ''}/>`;
    // Motorantrieb (fernsteuerbar) und Schutzgerät
    out += `<rect x="${gR(cx + 16)}" y="${busY + 20}" width="16" height="16" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.2"/>`
      + txt(cx + 24, busY + 32, 'M', { anchor: 'middle', size: 10, weight: 700 });
    out += `<rect x="${gR(cx - 32)}" y="${busY + 20}" width="16" height="16" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.2"/>`
      + txt(cx - 24, busY + 32, 'S', { anchor: 'middle', size: 10, weight: 700 });
    if (i === 0) { out += nr(cx - 48, busY + 28, 7); out += nr(cx + 48, busY + 28, 6); }
    // Station
    const bx = cx - bw / 2;
    out += `<rect x="${gR(bx) + 0.5}" y="${stTop + 0.5}" width="${bw}" height="${stH}" fill="${a.aus ? T.neutral.cardBg : T.tint}"
              stroke="${a.aus ? T.text.faint : T.accents.gruen}" stroke-width="1.2" ${a.aus ? 'stroke-dasharray="5 3"' : ''}/>`;
    out += `<circle cx="${gR(cx)}" cy="${stTop + 15}" r="7" fill="none" stroke="${strich}" stroke-width="1.3"/>
            <circle cx="${gR(cx)}" cy="${stTop + 25}" r="7" fill="none" stroke="${strich}" stroke-width="1.3"/>`;
    out += txt(cx, stTop + 50, a.titel, { anchor: 'middle', size: 12, weight: 700, fill: a.aus ? T.text.muted : T.text.strong });
    if (a.unter) out += txt(cx, stTop + 67, ggResKuerzen(a.unter, 26), { anchor: 'middle', size: 10.5, fill: T.text.muted });
  });

  // ── Nummernlegende zweispaltig ──
  const colW = (W - 2 * S.padX) / 2;
  punkte.forEach((t, i) => {
    const px = S.padX + (i % 2) * colW, py = legTop + Math.floor(i / 2) * 38;
    out += nr(px + 10, py + 6, i + 1);
    ggResUmbruch(t, Math.floor((colW - 40) / (11 * 0.53))).slice(0, 2)
      .forEach((z, j) => { out += txt(px + 28, py + 10 + j * 14, z, { size: 11 }); });
  });
  return ggFinishSvg(out, W, height);
}

/**
 * Einbindung von Erzeugern und Speichern in den Inselbetrieb (Szenario 3, 5.2.4): netzbildende Quellen (NEA,
 * Batteriespeicher) über der Sammelschiene, netzfolgende Erzeuger und Lasten darunter, Frequenz-Kennlinie,
 * Vorteile und nummerierte Betriebshinweise.
 * cfg.werte = { nea, uKv, speicher, speicherOption } · cfg.anlagen = [{ art, titel, unter, wert, option }]
 * cfg.vorteile = [Text] · cfg.vorteilHinweis · cfg.punkte = [Text]
 */
export function ggRenderInselEe(cfg, T = GG_THEME) {
  const S = T.sheet, W = T.width;
  const gruen = T.accents.gruenDunkel, rot = T.energy.waerme;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const strich = T.text.strong, faint = T.text.faint;
  const w = cfg.werte || {};
  const anlagen = (cfg.anlagen || []).slice(0, 5);
  const vorteile = cfg.vorteile || [];
  const punkte = cfg.punkte || [];
  const top = S.headBand + S.headHSchmal + 26;
  const busY = top + 158;
  const stTop = busY + 66, stH = 88;
  const ctrlY = stTop + stH + 14;
  const bandTop = ctrlY + 30;

  // Vorteile-Kasten vorab umbrechen, damit die Blatthöhe feststeht
  const vx = 500, vw = W - 40 - vx;
  const vMax = Math.floor((vw - 44) / (11 * 0.53));
  const vZeilen = vorteile.map(t => ggResUmbruch(t, vMax).slice(0, 2));
  const hinweisZ = cfg.vorteilHinweis ? ggResUmbruch(cfg.vorteilHinweis, Math.floor((vw - 28) / (10.5 * 0.53))).slice(0, 2) : [];
  const vH = 40 + vZeilen.reduce((s, z) => s + z.length * 14 + 8, 0) + (hinweisZ.length ? hinweisZ.length * 13 + 14 : 0);
  const bandH = Math.max(222, vH);
  // Ablauf Inbetriebnahme / Rückkehr ans Netz als Schrittkette
  const ablauf = cfg.ablauf?.zeilen?.length ? cfg.ablauf : null;
  const abTop = bandTop + bandH + 28, abBoxH = 50, abGap = 10;
  const abH = ablauf ? 24 + ablauf.zeilen.length * (abBoxH + abGap) + (ablauf.hinweis ? 18 : 0) : 0;
  const legTop = ablauf ? abTop + abH + 22 : bandTop + bandH + 28;
  const height = legTop + Math.ceil(punkte.length / 2) * 38 + S.footSpace + 6;
  const G = { S, W, headH: S.headHSchmal, reduziert: true, height };
  let out = ggSheetHeader({ eyebrow: cfg.eyebrow, titel: cfg.titel }, T, G);

  const nr = (x, y, k) => `<circle cx="${gR(x)}" cy="${gR(y)}" r="10" fill="${gruen}"/>`
    + txt(x, y + 4, String(k), { anchor: 'middle', size: 11, weight: 700, fill: '#FFFFFF' });
  const schalter = (x, y, offen, farbe = strich) => {
    const k = y + 30;
    return `<path d="M${gR(x - 4)} ${k - 4}l8 8M${gR(x + 4)} ${k - 4}l-8 8" stroke="${farbe}" stroke-width="1.6"/>`
      + `<line x1="${gR(x)}" y1="${y}" x2="${gR(offen ? x + 13 : x)}" y2="${offen ? k - 5 : k}" stroke="${farbe}" stroke-width="2"/>`
      + `<circle cx="${gR(x)}" cy="${y}" r="2.4" fill="${farbe}"/>`;
  };
  const trafo = (x, y, farbe = gruen) => `<circle cx="${gR(x)}" cy="${y}" r="9" fill="none" stroke="${farbe}" stroke-width="1.6"/>`
    + `<circle cx="${gR(x)}" cy="${y + 12}" r="9" fill="none" stroke="${farbe}" stroke-width="1.6"/>`;
  const kasten = (x, y, k) => `<rect x="${gR(x)}" y="${y}" width="16" height="16" fill="${T.neutral.cardBg}" stroke="${strich}" stroke-width="1.2"/>`
    + txt(x + 8, y + 12, k, { anchor: 'middle', size: k.length > 1 ? 8.5 : 10, weight: 700 });
  // Leistungsflussrichtung: Spitze nach oben = Einspeisung, nach unten = Bezug
  const pfeil = (x, y, hoch, farbe) => (hoch
    ? `<path d="M${gR(x)} ${y - 5}l-4.5 8h9Z" fill="${farbe}"/>`
    : `<path d="M${gR(x)} ${y + 5}l-4.5 -8h9Z" fill="${farbe}"/>`);
  const icon = (key, x, y, farbe) => `<g transform="translate(${gR(x - 12)} ${y})">${GG_ICONS[key](farbe, 1.6)}</g>`;
  const rolle = (x, y, titel, unter, farbe = gruen) => txt(x, y, titel, { size: 11, weight: 700, fill: farbe })
    + txt(x, y + 14, unter, { size: 10.5, fill: T.text.muted });

  // ── Energiemanagement (EMS) mit Steuerleitungen ──
  const ex = 40, ew = 200;
  out += `<rect x="${ex}.5" y="${top + 0.5}" width="${ew}" height="52" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.2"/>`;
  out += txt(ex + ew / 2, top + 20, 'Energiemanagement (EMS)', { anchor: 'middle', size: 11.5, weight: 700 });
  out += txt(ex + ew / 2, top + 37, 'Sollwerte · Ladezustand · Abregelung', { anchor: 'middle', size: 10.5, fill: T.text.muted });
  out += nr(ex + ew, top, 7);
  const neaX = 535, spX = 820, yC = top - 12;
  out += `<path d="M${ex + ew / 2} ${top}V${yC}H${spX}V${top}M${neaX} ${yC}V${top}" fill="none" stroke="${faint}" stroke-width="1.2" stroke-dasharray="4 3"/>`;

  // ── Netz des Netzbetreibers, NAP getrennt ──
  const napX = 340;
  out += `<rect x="${napX - 60}.5" y="${top + 0.5}" width="120" height="38" fill="${T.neutral.cardBg}" stroke="${rot}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
  out += txt(napX, top + 16, 'Netz des NB', { anchor: 'middle', size: 11.5, weight: 600 });
  out += txt(napX, top + 31, 'Ausfall', { anchor: 'middle', size: 11, weight: 600, fill: rot });
  out += `<line x1="${napX}" y1="${top + 38}" x2="${napX}" y2="${top + 62}" stroke="${faint}" stroke-width="2" stroke-dasharray="4 3"/>`;
  out += schalter(napX, top + 62, true);
  out += `<line x1="${napX}" y1="${top + 92}" x2="${napX}" y2="${busY}" stroke="${gruen}" stroke-width="2"/>`;
  out += txt(napX + 18, top + 104, 'NAP getrennt', { size: 11, weight: 600 });

  // ── Netzersatzanlage (netzbildend) ──
  const nx = 440, nw = 190;
  out += `<rect x="${nx}.5" y="${top + 0.5}" width="${nw}" height="56" fill="${T.tint}" stroke="${gruen}" stroke-width="1.6"/>`;
  out += `<circle cx="${nx + 24}" cy="${top + 28}" r="11" fill="${T.neutral.cardBg}" stroke="${gruen}" stroke-width="1.6"/>`
    + txt(nx + 24, top + 32.5, 'G', { anchor: 'middle', size: 11, weight: 700, fill: gruen });
  out += txt(nx + 46, top + 24, 'Netzersatzanlage', { size: 12, weight: 700 });
  out += txt(nx + 46, top + 40, ggResKuerzen(w.nea || 'Synchrongenerator', 22), { size: 11, fill: T.text.muted });
  out += `<line x1="${neaX}" y1="${top + 56}" x2="${neaX}" y2="${top + 68}" stroke="${gruen}" stroke-width="2"/>`
    + trafo(neaX, top + 77)
    + `<line x1="${neaX}" y1="${top + 98}" x2="${neaX}" y2="${top + 112}" stroke="${gruen}" stroke-width="2"/>`;
  out += schalter(neaX, top + 112, false, gruen);
  out += `<line x1="${neaX}" y1="${top + 142}" x2="${neaX}" y2="${busY}" stroke="${gruen}" stroke-width="2"/>`;
  out += rolle(neaX + 18, top + 84, 'netzbildend · führend', 'gibt U und f vor, trägt 100 % Last');
  out += kasten(neaX - 32, top + 118, 'S') + nr(neaX - 50, top + 126, 6);
  out += nr(neaX - 28, top + 84, 1);

  // ── Batteriespeicher mit netzbildendem Wechselrichter ──
  const sx = 680, sw = W - 40 - sx, opt = !!w.speicherOption;
  const spRand = opt ? faint : gruen;
  out += `<rect x="${sx}.5" y="${top + 0.5}" width="${sw}" height="56" fill="${opt ? T.neutral.cardBg : T.tint}" stroke="${spRand}"
            stroke-width="1.6" ${opt ? 'stroke-dasharray="5 3"' : ''}/>`;
  // Batterie und Wechselrichter (DC/AC)
  out += `<rect x="${sx + 12}" y="${top + 17}" width="24" height="22" fill="${T.neutral.cardBg}" stroke="${spRand}" stroke-width="1.5"/>
          <rect x="${sx + 20}" y="${top + 13}" width="8" height="4" fill="${spRand}"/>
          <path d="M${sx + 18} ${top + 28}h5M${sx + 25} ${top + 28}h5M${sx + 27.5} ${top + 25.5}v5" stroke="${spRand}" stroke-width="1.3"/>
          <line x1="${sx + 36}" y1="${top + 28}" x2="${sx + 44}" y2="${top + 28}" stroke="${spRand}" stroke-width="1.5"/>
          <rect x="${sx + 44}" y="${top + 16}" width="24" height="24" fill="${T.neutral.cardBg}" stroke="${spRand}" stroke-width="1.5"/>
          <path d="M${sx + 44} ${top + 40}L${sx + 68} ${top + 16}M${sx + 48} ${top + 22}h7M${sx + 57} ${top + 35}q2.5 -3 5 0t5 0"
                fill="none" stroke="${spRand}" stroke-width="1.2"/>`;
  out += txt(sx + 80, top + 24, 'Batteriespeicher', { size: 12, weight: 700, fill: opt ? T.text.muted : T.text.strong });
  out += txt(sx + 80, top + 40, ggResKuerzen(w.speicher || 'zugeschaltet, folgt der NEA', 30), { size: 10.5, fill: T.text.muted });
  out += nr(sx + sw, top, 2);
  out += `<line x1="${spX}" y1="${top + 56}" x2="${spX}" y2="${top + 68}" stroke="${spRand}" stroke-width="2"/>`
    + trafo(spX, top + 77, spRand)
    + `<line x1="${spX}" y1="${top + 98}" x2="${spX}" y2="${top + 112}" stroke="${spRand}" stroke-width="2"/>`;
  out += schalter(spX, top + 112, false, spRand);
  out += `<line x1="${spX}" y1="${top + 142}" x2="${spX}" y2="${busY}" stroke="${spRand}" stroke-width="2" ${opt ? 'stroke-dasharray="4 3"' : ''}/>`;
  out += rolle(spX + 18, top + 84, 'netzstützend', 'folgt U und f der NEA', opt ? T.text.muted : gruen);

  // ── MS-Sammelschiene ──
  out += `<line x1="90" y1="${busY}" x2="${W - 40}" y2="${busY}" stroke="${gruen}" stroke-width="5"/>`;
  out += txt(96, busY - 9, `MS-Netz (${w.uKv || 20} kV) im Inselbetrieb`, { size: 11, weight: 600, fill: gruen });

  // ── netzfolgende Erzeuger und Lasten ──
  const ART = {
    pv:   { icon: 'sun',  quelle: true,  k: 'NA', nr: 3 },
    wind: { icon: 'wind', quelle: true,  k: 'NA' },
    kwk:  { g: true,      quelle: true,  k: 'S',  nr: 4 },
    last: { trafo: true,  quelle: false, k: 'M' },
    flex: { heiz: true,   quelle: false, k: 'M',  nr: 5 },
  };
  const n = Math.max(anlagen.length, 1);
  const bw = n >= 5 ? 142 : 150, x0 = 110, x1 = W - 40;
  const schritt = n > 1 ? (x1 - x0 - bw) / (n - 1) : 0;
  const mitten = [];
  anlagen.forEach((a, i) => {
    const d = ART[a.art] || ART.last;
    const cx = n > 1 ? x0 + bw / 2 + i * schritt : (x0 + x1) / 2;
    mitten.push(cx);
    const farbe = a.option ? faint : gruen;
    const dash = a.option ? 'stroke-dasharray="4 3"' : '';
    out += `<line x1="${gR(cx)}" y1="${busY}" x2="${gR(cx)}" y2="${busY + 14}" stroke="${farbe}" stroke-width="2"/>`;
    out += schalter(cx, busY + 14, false, farbe);
    out += `<line x1="${gR(cx)}" y1="${busY + 44}" x2="${gR(cx)}" y2="${stTop}" stroke="${farbe}" stroke-width="2" ${dash}/>`;
    out += pfeil(cx, busY + 55, d.quelle, farbe);
    out += kasten(cx - 32, busY + 20, d.k);
    if (a.art === 'pv') out += nr(cx - 50, busY + 28, 8);
    const bx = cx - bw / 2;
    out += `<rect x="${gR(bx) + 0.5}" y="${stTop + 0.5}" width="${bw}" height="${stH}" fill="${a.option ? T.neutral.cardBg : T.tint}"
              stroke="${a.option ? faint : T.accents.gruen}" stroke-width="1.2" ${a.option ? 'stroke-dasharray="5 3"' : ''}/>`;
    const ic = a.option ? faint : strich;
    if (d.icon) out += icon(d.icon, cx, stTop + 7, ic);
    else if (d.g) {
      out += `<circle cx="${gR(cx)}" cy="${stTop + 19}" r="11" fill="${T.neutral.cardBg}" stroke="${ic}" stroke-width="1.5"/>`
        + txt(cx, stTop + 23.5, 'G', { anchor: 'middle', size: 11, weight: 700, fill: ic });
    } else if (d.trafo) {
      out += `<circle cx="${gR(cx)}" cy="${stTop + 14}" r="7" fill="none" stroke="${ic}" stroke-width="1.3"/>
              <circle cx="${gR(cx)}" cy="${stTop + 24}" r="7" fill="none" stroke="${ic}" stroke-width="1.3"/>`;
    } else if (d.heiz) {
      out += `<rect x="${gR(cx - 13)}" y="${stTop + 10}" width="26" height="18" fill="${T.neutral.cardBg}" stroke="${ic}" stroke-width="1.4"/>
              <path d="M${gR(cx - 9)} ${stTop + 19}l3 -5 3 10 3 -10 3 10 3 -10 3 5" fill="none" stroke="${rot}" stroke-width="1.3"/>`;
    }
    out += txt(cx, stTop + 49, a.titel, { anchor: 'middle', size: 12, weight: 700, fill: a.option ? T.text.muted : strich });
    if (a.unter) out += txt(cx, stTop + 64, ggResKuerzen(a.unter, 25), { anchor: 'middle', size: 10.5, fill: T.text.muted });
    if (a.wert || a.option) {
      out += txt(cx, stTop + 79, ggResKuerzen(a.option ? 'Option' : a.wert, 25),
        { anchor: 'middle', size: 10.5, weight: 600, fill: a.option ? faint : gruen });
    }
    if (d.nr) out += nr(bx, stTop, d.nr);
  });
  // Sollwerte vom EMS an die Anlagen unter der Schiene
  if (mitten.length) {
    const xe = mitten[mitten.length - 1];
    out += `<path d="M${ex + 16} ${top + 52}V${ctrlY}H${gR(xe)}${mitten.map(m => `M${gR(m)} ${ctrlY}V${stTop + stH}`).join('')}"
              fill="none" stroke="${faint}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    out += txt(ex + 24, ctrlY + 14, 'Sollwerte vom EMS', { size: 10, fill: faint });
  }
  if (opt || anlagen.some(a => a.option)) {
    out += txt(W - 40, ctrlY + 14, 'gestrichelt: im Netzmodell nicht vorhanden (Option)', { anchor: 'end', size: 10, fill: faint });
  }

  // ── Frequenz-Kennlinie: Überschuss → Abregelung, Mangel → Lastabwurf ──
  out += txt(40, bandTop + 12, 'Betriebsführung über die Frequenz', { size: 12, weight: 700 });
  const px0 = 78, px1 = 468, py0 = bandTop + 34, py1 = bandTop + 174;
  const fMin = 47.5, fMax = 52;
  const X = f => px0 + (f - fMin) / (fMax - fMin) * (px1 - px0);
  const Y = p => py1 - p / 100 * (py1 - py0);
  const zone = (f0, f1, fill, label, lf) => `<rect x="${gR(X(f0))}" y="${py0}" width="${gR(X(f1) - X(f0))}" height="${py1 - py0}" fill="${fill}"/>`
    + (label ? txt(X((f0 + f1) / 2), py0 + 15, label, { anchor: 'middle', size: 9.5, weight: 600, fill: lf }) : '');
  out += zone(47.5, 49.0, '#FBEAEA', 'Lastabwurf', rot);
  out += zone(50.2, 51.5, T.tint, 'Abregelung PV', gruen);
  out += zone(51.5, 52.0, T.neutral.band, 'aus', T.text.muted);
  out += `<line x1="${gR(X(50))}" y1="${py0}" x2="${gR(X(50))}" y2="${py1}" stroke="${faint}" stroke-width="1" stroke-dasharray="2 3"/>`;
  [0, 50, 100].forEach(p => {
    out += `<line x1="${px0}" y1="${gR(Y(p))}" x2="${px1}" y2="${gR(Y(p))}" stroke="${p ? T.line : T.rule}" stroke-width="1"/>`
      + txt(px0 - 6, Y(p) + 4, p ? `${p} %` : '0', { anchor: 'end', size: 10, fill: T.text.muted });
  });
  for (let f = 47.5; f <= 52.001; f += 0.5) {
    out += `<line x1="${gR(X(f))}" y1="${py1}" x2="${gR(X(f))}" y2="${py1 + 4}" stroke="${T.rule}" stroke-width="1"/>`
      + txt(X(f), py1 + 16, ggNum(f, f % 1 ? 1 : 0) + (f >= 52 ? ' Hz' : ''), { anchor: f >= 52 ? 'end' : 'middle', size: 10, fill: T.text.muted });
  }
  // zugeschaltete Last: Unterfrequenz-Lastabwurf in Stufen
  const lastStufen = [[49.0, 100], [49.0, 85], [48.7, 85], [48.7, 70], [48.4, 70], [48.4, 55], [48.1, 55], [48.1, 40], [47.5, 40]];
  out += `<path d="M${lastStufen.map(([f, p]) => `${gR(X(f))} ${gR(Y(p))}`).join('L')}" fill="none" stroke="${rot}" stroke-width="2"/>`;
  // PV-Einspeisung nach P(f)-Kennlinie, Abschaltung durch den NA-Schutz
  out += `<path d="M${gR(X(47.5))} ${gR(Y(100))}L${gR(X(50.2))} ${gR(Y(100))}L${gR(X(51.5))} ${gR(Y(48))}" fill="none" stroke="${gruen}" stroke-width="2.4"/>
          <path d="M${gR(X(51.5))} ${gR(Y(48))}V${gR(Y(0))}H${gR(X(52))}" fill="none" stroke="${gruen}" stroke-width="2" stroke-dasharray="4 3"/>`;
  out += txt(X(50.25), Y(27), 'Überschuss:', { size: 10, weight: 600 });
  out += txt(X(50.25), Y(14), 'f steigt →', { size: 10, fill: T.text.muted });
  out += txt(X(49.9), Y(27), 'Mangel:', { anchor: 'end', size: 10, weight: 600 });
  out += txt(X(49.9), Y(14), '← f sinkt', { anchor: 'end', size: 10, fill: T.text.muted });
  const ly = py1 + 36;
  out += `<line x1="${px0}" y1="${ly - 4}" x2="${px0 + 22}" y2="${ly - 4}" stroke="${gruen}" stroke-width="2.4"/>`
    + txt(px0 + 28, ly, 'Einspeisung PV (P(f)-Kennlinie)', { size: 10.5 });
  out += `<line x1="${px0 + 214}" y1="${ly - 4}" x2="${px0 + 236}" y2="${ly - 4}" stroke="${rot}" stroke-width="2"/>`
    + txt(px0 + 242, ly, 'zugeschaltete Last', { size: 10.5 });

  // ── Vorteile ──
  out += `<rect x="${vx}.5" y="${bandTop + 0.5}" width="${vw}" height="${bandH}" fill="${T.neutral.cardBg}" stroke="${T.line}" stroke-width="1.2"/>
          <rect x="${vx}.5" y="${bandTop + 0.5}" width="${vw}" height="28" fill="${T.tint}"/>`;
  out += txt(vx + 14, bandTop + 19, 'Vorteile der Einbindung', { size: 12, weight: 700 });
  let vy = bandTop + 48;
  vZeilen.forEach(z => {
    out += `<path d="M${vx + 14} ${vy - 4}l4 4 8 -9" fill="none" stroke="${T.accents.gruen}" stroke-width="2"/>`;
    z.forEach((s, j) => { out += txt(vx + 34, vy + j * 14, s, { size: 11 }); });
    vy += z.length * 14 + 8;
  });
  if (hinweisZ.length) {
    vy += 4;
    out += `<line x1="${vx + 14}" y1="${vy - 12}" x2="${vx + vw - 14}" y2="${vy - 12}" stroke="${T.line}" stroke-width="1"/>`;
    hinweisZ.forEach((s, j) => { out += txt(vx + 14, vy + 2 + j * 13, s, { size: 10.5, fill: T.text.muted }); });
  }

  // ── Ablauf: Inselbildung und Rückkehr ans Netz ──
  if (ablauf) {
    out += txt(40, abTop + 12, ablauf.titel || 'Inbetriebnahme und Rückkehr ans Netz', { size: 12, weight: 700 });
    const lw = 128, ax0 = 40 + lw, ax1 = W - 40, pfeilW = 14;
    ablauf.zeilen.forEach((z, zi) => {
      const y = abTop + 24 + zi * (abBoxH + abGap);
      const n = z.schritte.length;
      const bw = (ax1 - ax0 - (n - 1) * pfeilW) / n;
      const farbe = z.rueck ? T.text.strong : gruen;
      out += `<rect x="40.5" y="${y + 0.5}" width="${lw - 10}" height="${abBoxH}" fill="${z.rueck ? T.neutral.band : T.tint}"/>`;
      ggResUmbruch(z.label, 18).slice(0, 2).forEach((s, j) => {
        out += txt(50, y + 22 + j * 14, s, { size: 11, weight: 700, fill: farbe });
      });
      z.schritte.forEach((s, i) => {
        const bx = ax0 + i * (bw + pfeilW);
        out += `<rect x="${gR(bx) + 0.5}" y="${y + 0.5}" width="${gR(bw)}" height="${abBoxH}" fill="${T.neutral.cardBg}"
                  stroke="${z.rueck ? T.line : T.accents.gruen}" stroke-width="1.2"/>`;
        out += txt(bx + 8, y + 18, ggResKuerzen(s.t, Math.floor((bw - 16) / (11 * 0.56))), { size: 11, weight: 700, fill: farbe });
        ggResUmbruch(s.u || '', Math.floor((bw - 16) / (10 * 0.53))).slice(0, 2).forEach((l, j) => {
          out += txt(bx + 8, y + 33 + j * 12, l, { size: 10, fill: T.text.muted });
        });
        if (i < n - 1) {
          const px = bx + bw + 3, my = y + abBoxH / 2;
          out += `<path d="M${gR(px)} ${my - 5}l${pfeilW - 6} 5 -${pfeilW - 6} 5Z" fill="${z.rueck ? faint : T.accents.gruen}"/>`;
        }
      });
    });
    if (ablauf.hinweis) {
      out += txt(40, abTop + abH - 3, ggResKuerzen(ablauf.hinweis, Math.floor((W - 80) / (10 * 0.53))),
        { size: 10, fill: T.text.muted });
    }
  }

  // ── Nummernlegende zweispaltig ──
  const colW = (W - 2 * S.padX) / 2;
  punkte.forEach((t, i) => {
    const px = S.padX + (i % 2) * colW, py = legTop + Math.floor(i / 2) * 38;
    out += nr(px + 10, py + 6, i + 1);
    ggResUmbruch(t, Math.floor((colW - 40) / (11 * 0.53))).slice(0, 2)
      .forEach((z, j) => { out += txt(px + 28, py + 10 + j * 14, z, { size: 11 }); });
  });
  return ggFinishSvg(out, W, height);
}

/** Ablauf der Inselbildung (NEA führt) und der Rückkehr ans Netz — Schrittkette in res-insel-ee. */
const GG_RES_EE_ABLAUF = Object.freeze({
  titel: 'Inbetriebnahme der Insel und Rückkehr ans Netz',
  zeilen: [
    { label: 'Inselbildung (Schwarzstart)', schritte: [
      { t: 'Netzausfall', u: 'Ausfall erkannt, Schalter am NAP öffnet' },
      { t: 'NEA starten', u: 'baut U und f auf, führt die Insel' },
      { t: 'Lasten zuschalten', u: 'Stationen in Stufen, NEA trägt 100 % der Last' },
      { t: 'Speicher zu', u: 'synchron auf die NEA, gleicht Lastsprünge aus' },
      { t: 'PV/BHKW frei', u: 'EMS gibt frei, NEA hält ihre Mindestlast' },
    ] },
    { label: 'Rückkehr ans Netz', rueck: true, schritte: [
      { t: 'Netz zurück', u: 'stabil über Wartezeit, Freigabe des NB' },
      { t: 'Einspeisung ab', u: 'PV, BHKW und Speicher zurückfahren, NEA trägt' },
      { t: 'Synchronisieren', u: 'NEA an U, f und Phase des Netzes angleichen' },
      { t: 'NAP schließen', u: 'kurzer Parallelbetrieb, Last geht aufs Netz' },
      { t: 'NEA abfahren', u: 'Nachlauf; PV und Speicher wieder am Netz' },
    ] },
  ],
  hinweis: 'Ohne Synchronisiereinrichtung: Rückschaltung mit kurzer Unterbrechung – Insel spannungslos, NAP schließen, Wechselrichter schalten nach Wartezeit wieder zu.',
});

const GG_RES_EE_ANLAGEN_ALLGEMEIN = Object.freeze([
  { art: 'pv', titel: 'Photovoltaik', unter: 'netzfolgend · P(f)' },
  { art: 'kwk', titel: 'BHKW (KWK)', unter: 'Synchrongenerator' },
  { art: 'last', titel: 'Verbraucher', unter: 'Stationen in Stufen' },
  { art: 'flex', titel: 'flexible Lasten', unter: 'Heizstab · WP · Laden' },
]);
/** Summe einer Kenngröße über alle Assets eines Typs im Netzmodell. */
const ggResAssetSumme = (typ, feld) => (window.ASSETS?.items || [])
  .filter(a => a.type === typ).reduce((s, a) => s + (parseFloat(a.props?.[feld]) || 0), 0);

const GG_RES_INSEL_ABGAENGE_ALLGEMEIN = Object.freeze([
  { titel: 'Stufe 1', unter: 'Stationen mit Gebäuden A/B' },
  { titel: 'Stufe 2', unter: 'weitere Stationen' },
  { titel: 'Stufe n', unter: '…' },
  { titel: 'abgeschaltet', unter: 'nicht versorgt', aus: true },
]);
const GG_RES_LEGENDE_KLASSEN = [
  { art: 'klasse', farbe: GG_RES_KLASSE_FARBE.A, text: 'Klasse A (kritisch)' },
  { art: 'klasse', farbe: GG_RES_KLASSE_FARBE.B, text: 'Klasse B (eingeschränkt)' },
];

const GG_RES_VERGLEICH_SPALTEN = [{ label: 'Merkmal', weight: 1.1 },
  { label: 'Szenario 1: kritische Gebäude', weight: 1.65, mono: false },
  { label: 'Szenario 2: je Trafostation', weight: 1.65, mono: false },
  { label: 'Szenario 3: Liegenschaft', weight: 1.65, mono: false }];

function ggResSzenarienFiguren() {
  const leerMeta = () => ({ 'Datum': '', 'Bearbeiter': '', 'WE-Nr.': '' });
  const kurzKw = kw => `${ggNum(kw)} kW`;
  const aggBand = liste => {
    const kw = liste.reduce((s, a) => s + a.kw, 0);
    const neu = liste.reduce((s, a) => s + a.zusatzKw, 0);
    const abg = liste.reduce((s, a) => s + a.abgaenge, 0);
    const amGebaeude = liste.every(a => a.ort === 'gebaeude') ? ' am Gebäude' : '';
    return `${liste.length === 1 ? 'NEA' : `${liste.length} NEA`}${amGebaeude} ${kurzKw(kw)}`
      + (neu <= 0 ? ' (vorh.)' : neu < kw ? ` (+${ggNum(neu)} neu)` : '')
      + (abg ? ` · ${abg} Abg. aus` : '');
  };
  return [
    // ── 5.2.2 Szenario 1 ──
    {
      id: 'res-sz1-text', istText: true, reihe: 10,
      kapitel: '8.2.2 Szenario 1: Versorgung der kritischen Gebäude',
      titel: 'Gutachtentext: Szenario 1 — kritische Gebäude',
      datei: 'resilienz-szenario1-text',
      hinweis: 'Versorgung nur der Gebäude der Notstromklasse A mit Aggregaten am Bestandsnetz — aus dem 🛡 Blackout-Modus '
             + '(Klassen, Platzierung am Netz, Wärme). Dauer wie im Reiter „Liegenschaft“.',
      render: cfg => ggRenderResSz1Text(cfg),
      config: {},
    },
    {
      id: 'res-gebaeude-nea-prinzip', autoSync: true, reihe: 15,
      kapitel: '8.2.2 Szenario 1: Versorgung der kritischen Gebäude',
      titel: 'Prinzip NEA zur Versorgung eines Gebäudes',
      datei: 'resilienz-gebaeude-nea-prinzip',
      hinweis: 'Prinzipskizze: Netzüberwachung, automatische Umschaltung Netz – NEA, Aufstellraum mit Kraftstoff, Notstromschiene '
             + 'mit USV, Klasse A, Heizung und Lastabwurf. Beispielwerte von der größten NEA am Gebäude aus Szenario 1, sonst allgemein.',
      render: cfg => ggRenderGebaeudeNeaPrinzip(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 1', titel: 'Netzersatzanlage zur Versorgung eines Gebäudes', werte: {},
        punkte: [
          'Netzüberwachung erkennt den Ausfall, startet die NEA und schaltet nach Netzwiederkehr mit Nachlaufzeit zurück',
          'Netzumschaltung Netz – NEA, automatisch, 4-polig, gegenseitig verriegelt: kein Parallelbetrieb mit dem Netz',
          'stationäre NEA im eigenen Aufstellraum oder Container, Zu- und Abluft, Abgasführung über Dach',
          'Kraftstoffvorrat (Tages- und Lagertank) für die Autonomiedauer, Befüllung von außen',
          'USV überbrückt die Anlaufzeit der NEA (ca. 15 s) für IT, Kommunikation und Leittechnik',
          'kritische Verbraucher (Klasse A) mit voller Last an der Notstromschiene',
          'Heizung: Pumpen, Brenner und Regelung am Notstrom, sonst keine Wärmeversorgung',
          'nicht benötigte Abgänge per Lastabwurf abschaltbar, die NEA trägt nur den Notstromumfang',
        ],
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const agg = (sz?.s1.bewertung.variante.aggregate || []).filter(a => a.ort === 'gebaeude' && a.empfKw > 0);
        if (!agg.length) {
          cfg.werte = {};
          return 'ℹ Allgemeine Darstellung — im Blackout-Modus ist keine NEA am Gebäude vorgesehen.';
        }
        const a = agg.reduce((m, x) => (x.empfKw > m.empfKw ? x : m));
        const liter = zielKraftstoffL(a.peakKw, sz.dauerH);
        cfg.werte = {
          gebaeude: `Beispiel: Gebäude ${a.name}`,
          nea: `${ggNum(a.empfKw)} kW · Diesel`,
          tank: liter ? `${ggNum(liter)} l für ${ggResDauer(sz.dauerH)}` : '',
        };
        return `✓ Beispielwerte von Gebäude ${a.name} (${ggNum(a.empfKw)} kW).`;
      },
    },
    {
      id: 'res-sz1-schema', autoSync: true, reihe: 20,
      kapitel: '8.2.2 Szenario 1: Versorgung der kritischen Gebäude',
      titel: 'Schema Szenario 1 — Versorgung der kritischen Gebäude',
      datei: 'resilienz-szenario1-schema',
      hinweis: 'Je Transformatorstation: kritische Gebäude und die Netzersatzanlagen der günstigsten Aufstellungsvariante.',
      render: cfg => ggRenderResSchema(cfg),
      config: { eyebrow: 'Resilienz · Szenario 1', titel: 'Versorgung der kritischen Gebäude', modus: 'kritisch',
                stationen: [], extra: [], legende: [], fussnote: '', leer: 'Keine Transformatorstationen im Netzmodell.' },
      ausProjekt(cfg) {
        const sz = ggResSz();
        if (!sz) { cfg.stationen = []; cfg.extra = []; return '⚠ Blackout-Modus nicht verfügbar.'; }
        const nea = new Set(sz.s1.bewertung.variante.aggregate.filter(a => a.ort === 'gebaeude' && a.empfKw > 0).map(a => a.name));
        cfg.stationen = sz.stationen.map(s => {
          const geb = s.gebaeude.filter(g => g.klasse === 'A').map(g => ({ ...g, nea: nea.has(g.name) }));
          return {
            name: s.name, zeile2: ggResStationZeile(s),
            zustand: s.sz1.length ? 'nea' : 'ohne',
            nea: s.sz1.some(a => a.ort === 'knoten'),
            band: s.sz1.length ? aggBand(s.sz1) : 'keine Versorgung',
            gebaeude: geb, ohneGebText: 'keine kritischen Gebäude',
          };
        });
        cfg.extra = sz.ohneStation.map(a => ({
          name: a.name, zeile2: a.fest ? 'eigene NEA am Gebäude' : 'ohne Netzzuordnung', zustand: 'nea', nea: false,
          band: aggBand([a]), gebaeude: [{ name: a.name, klasse: 'A', nea: true }],
        }));
        cfg.titel = `Versorgung der kritischen Gebäude (${ggResDauer(sz.dauerH)})`;
        cfg.legende = [
          ...GG_RES_LEGENDE_KLASSEN.slice(0, 1),
          { art: 'g', text: 'Netzersatzanlage (NEA)' },
          { farbe: GG_THEME.tint, rand: GG_THEME.accents.gruenDunkel, text: 'Station mit NEA-Versorgung' },
          { farbe: GG_THEME.neutral.cardBg, rand: GG_THEME.line, text: 'ohne Versorgung' },
        ];
        cfg.fussnote = 'Bemessung: gleichzeitige Spitze der Gebäudelastgänge + 20 % Reserve; „Abg. aus“ = im Ereignisfall abzuschaltende Abgänge.';
        return `✓ ${sz.stationen.length} Stationen, ${sz.s1.bewertung.variante.summe.anzahl} Netzersatzanlagen.`;
      },
    },
    {
      id: 'res-sz1-anlagen', autoSync: true, reihe: 30,
      kapitel: '8.2.2 Szenario 1: Versorgung der kritischen Gebäude',
      titel: 'Netzersatzanlagen Szenario 1',
      datei: 'resilienz-szenario1-anlagen',
      hinweis: 'Standorte, versorgte Gebäude und Leistungen der Netzersatzanlagen für die Gebäude der Klasse A.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 1', titel: 'Netzersatzanlagen Szenario 1', tabelleTitel: 'Netzersatzanlagen Szenario 1',
        leer: 'Keine Gebäude der Klasse A — im 🛡 Blackout-Modus Klassen zuweisen.',
        spalten: [{ label: 'Standort', weight: 1.5 }, { label: 'Versorgte Gebäude', weight: 2.2, mono: false, align: 'left' },
                  { label: 'Spitze', weight: 0.8 }, { label: 'NEA', weight: 0.8 }, { label: 'davon vorh.', weight: 0.9 },
                  { label: 'Abg. aus', weight: 0.7 }],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const v = sz?.s1.bewertung.variante;
        const agg = v ? v.aggregate.filter(a => a.empfKw > 0) : [];
        if (!agg.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Netzersatzanlagen für Klasse A.'; }
        const gebName = new Map(sz.bilanz.zeilen.map(z => [z.id, z.name]));
        cfg.zeilen = agg.map(a => ({ werte: [
          a.ort === 'knoten' ? (String(a.name).startsWith(a.typ) ? a.name : `${a.typ} ${a.name}`) : `Gebäude ${a.name}`,
          ggResKurzliste(a.gebaeude.map(id => gebName.get(id) || String(id))),
          kurzKw(a.peakKw), kurzKw(a.empfKw), a.bestandKw > 0 ? kurzKw(Math.min(a.bestandKw, a.empfKw)) : '—',
          a.abgaenge.length ? String(a.abgaenge.length) : '—',
        ] }));
        cfg.zeilen.push({ highlight: true, werte: ['Summe', `${agg.reduce((s, a) => s + a.gebaeude.length, 0)} Gebäude`,
          kurzKw(sz.s1.aKw), kurzKw(v.summe.kw), v.bestandGenutztKw > 0 ? kurzKw(v.bestandGenutztKw) : '—',
          v.summe.abgaenge ? String(v.summe.abgaenge) : '—'] });
        cfg.fussnote = `Aufstellungsvariante „${sz.s1.strategie}“ (günstigste); Bemessung Spitze + 20 % Reserve, Raster 5 kW.`;
        return `✓ ${agg.length} Netzersatzanlagen übernommen.`;
      },
    },

    // ── 5.2.3 Szenario 2 (Figur-IDs res-sz3-*) ──
    {
      id: 'res-sz3-text', istText: true, reihe: 10,
      kapitel: '8.2.3 Szenario 2: Versorgung je Trafostation',
      titel: 'Gutachtentext: Szenario 2 — je Trafostation',
      datei: 'resilienz-szenario3-text',
      hinweis: 'Je Trafostation eine NEA an der NSHV für die Gebäude der Klassen A/B, übrige Abgänge aus; fest installiert und mobil '
             + 'über den Einspeisepunkt im Vergleich — aus dem 🛡 Blackout-Modus. Dauer wie im Reiter „Liegenschaft“.',
      render: cfg => ggRenderResStationText(cfg),
      config: {},
    },
    {
      id: 'res-sz3-prinzip', autoSync: true, reihe: 15,
      kapitel: '8.2.3 Szenario 2: Versorgung je Trafostation',
      titel: 'Prinzip NEA an der Trafostation',
      datei: 'resilienz-szenario3-prinzip',
      hinweis: 'Prinzipskizze wie in den allgemeinen Empfehlungen: Umschaltung Netz – 0 – NEA in der NSHV, Einspeisekasten, '
             + 'Stellfläche, Abgänge A/B versorgt, übrige aus. Beispielwerte von der größten Station aus Szenario 2, sonst allgemein.',
      render: cfg => ggRenderEinspeisePrinzip(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 2', titel: 'Netzersatzanlage an der Trafostation', werte: {},
        punkte: [
          'Umschalteinrichtung Netz – 0 – NEA in der NSHV, gegenseitig verriegelt: kein Parallelbetrieb mit dem Netz',
          'Einspeisekasten für ein mobiles Aggregat bzw. fester Anschluss der stationären NEA',
          'fest verlegte Verbindung vom Einspeisepunkt zur Umschalteinrichtung',
          'Stellfläche bzw. Aufstellraum mit Zufahrt für Aggregat und Tankfahrzeug',
          'Abgänge der Klassen A und B versorgt, übrige Abgänge im Ereignisfall abgeschaltet und gekennzeichnet',
          'Erdung des Aggregats an der Erdungsanlage der Station; Abschaltbedingungen für den NEA-Betrieb nachweisen',
        ],
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const kandidaten = (sz?.stationen || []).filter(s => s.sz2.length);
        if (!kandidaten.length) {
          cfg.werte = {};
          return 'ℹ Allgemeine Darstellung — im Blackout-Modus ist keine Station mit Gebäuden A/B versorgt.';
        }
        const kw = s => s.sz2.reduce((x, a) => x + a.kw, 0);
        const st = kandidaten.reduce((m, s) => (kw(s) > kw(m) ? s : m));
        cfg.werte = { station: `Beispiel: ${st.name}`, neaTitel: 'NEA', nea: `${ggNum(kw(st))} kW` };
        return `✓ Beispielwerte von ${st.name} (${ggNum(kw(st))} kW).`;
      },
    },
    {
      id: 'res-sz3-schema', autoSync: true, reihe: 20,
      kapitel: '8.2.3 Szenario 2: Versorgung je Trafostation',
      titel: 'Schema Szenario 2 — Versorgung je Trafostation',
      datei: 'resilienz-szenario3-schema',
      hinweis: 'Je Transformatorstation: Gebäude der Klassen A/B und die NEA an der NSHV; Stationen ohne A/B ohne Versorgung.',
      render: cfg => ggRenderResSchema(cfg),
      config: { eyebrow: 'Resilienz · Szenario 2', titel: 'Versorgung je Trafostation', modus: 'station',
                stationen: [], extra: [], legende: [], fussnote: '', leer: 'Keine Transformatorstationen im Netzmodell.' },
      ausProjekt(cfg) {
        const sz = ggResSz();
        if (!sz) { cfg.stationen = []; cfg.extra = []; return '⚠ Blackout-Modus nicht verfügbar.'; }
        cfg.stationen = sz.stationen.map(s => ({
          name: s.name, zeile2: ggResStationZeile(s),
          zustand: s.sz2.length ? 'nea' : 'ohne',
          nea: s.sz2.some(a => a.ort === 'knoten'),
          band: s.sz2.length ? aggBand(s.sz2) : 'keine Versorgung',
          gebaeude: s.gebaeude.filter(g => g.klasse === 'A' || g.klasse === 'B'),
          ohneGebText: 'keine Gebäude A/B',
        }));
        const klasseVon = new Map(sz.bilanz.zeilen.map(z => [z.name, z.klasse]));
        cfg.extra = sz.s2.ohneStation.map(a => ({
          name: a.name, zeile2: a.fest ? 'eigene NEA am Gebäude' : 'ohne Netzzuordnung', zustand: 'nea', nea: false,
          band: aggBand([a]), gebaeude: [{ name: a.name, klasse: klasseVon.get(a.name) || null, nea: true }],
        }));
        cfg.titel = `Versorgung je Trafostation (${ggResDauer(sz.dauerH)})`;
        cfg.legende = [
          ...GG_RES_LEGENDE_KLASSEN,
          { art: 'g', text: 'Netzersatzanlage (NEA)' },
          { farbe: GG_THEME.tint, rand: GG_THEME.accents.gruenDunkel, text: 'Station mit NEA' },
          { farbe: GG_THEME.neutral.cardBg, rand: GG_THEME.line, text: 'ohne Versorgung' },
        ];
        cfg.fussnote = 'Bemessung: gleichzeitige Spitze der Gebäude A (voll) und B (reduziert) je Station + 20 % Reserve; „Abg. aus“ = abzuschaltende Abgänge.';
        return `✓ ${sz.stationen.length} Stationen, ${sz.s2.bewertung.variante.summe.anzahl} Netzersatzanlagen.`;
      },
    },
    {
      id: 'res-sz3-anlagen', autoSync: true, reihe: 30,
      kapitel: '8.2.3 Szenario 2: Versorgung je Trafostation',
      titel: 'Netzersatzanlagen Szenario 2',
      datei: 'resilienz-szenario3-anlagen',
      hinweis: 'Je Standort: versorgte Gebäude A/B, Spitze, NEA-Leistung, abzuschaltende Abgänge und Richtkosten fest installiert '
             + 'gegenüber mobil über den Einspeisepunkt.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 2', titel: 'Netzersatzanlagen Szenario 2', tabelleTitel: 'Netzersatzanlagen Szenario 2',
        leer: 'Keine Gebäude der Klassen A/B — im 🛡 Blackout-Modus Klassen zuweisen.',
        spalten: [{ label: 'Standort', weight: 1.2, mono: false }, { label: 'Versorgte Gebäude', weight: 1.8, mono: false, align: 'left' },
                  { label: 'Spitze', weight: 0.7 }, { label: 'NEA', weight: 0.7 }, { label: 'Abg. aus', weight: 0.6 },
                  { label: 'fest inst.', weight: 0.8 }, { label: 'Einspeisepunkt mobil', weight: 1.5, mono: false },
                  { label: 'mobil', weight: 0.7 }],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const b = sz?.s2.bewertung;
        if (!b?.strom) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Netzersatzanlagen für die Klassen A/B.'; }
        const gebListe = namen => (namen.length <= 2 ? namen.join(', ') : `${namen[0]} + ${namen.length - 1} weitere`);
        const zeile = (ort, a) => ({ werte: [
          ort, gebListe(a.gebaeude), kurzKw(a.peakKw), kurzKw(a.kw), a.abgaenge ? String(a.abgaenge) : '—',
          a.kosten > 0 ? ggResEur(a.kosten) : 'vorh.',
          a.mobil?.gedeckt ? 'vorh. NEA' : a.mobil?.kva
            ? `${ggNum(a.mobil.kva)} kVA · ${a.mobil.anschluss.replace(' Einpolstecker', '')}` : '—',
          a.mobil?.kosten > 0 ? ggResEur(a.mobil.kosten) : '—',
        ] });
        cfg.zeilen = [
          ...sz.stationen.flatMap(s => s.sz2.map(a => zeile(s.name, a))),
          ...sz.s2.ohneStation.map(a => zeile('am Gebäude', a)),
        ];
        const v = b.variante, m = sz.s2.mobil;
        if (b.strom.liter) {
          cfg.zeilen.push({ werte: ['Kraftstofflager', '', '', '', '', ggResEur(b.strom.kosten - v.summe.kosten),
            `${ggNum(b.strom.liter)} l nachliefern`, '—'] });
        }
        cfg.zeilen.push({ highlight: true, werte: ['Summe', `${b.strom.gebaeude} Gebäude A/B`, kurzKw(sz.s2.kw), kurzKw(v.summe.kw),
          v.summe.abgaenge ? String(v.summe.abgaenge) : '—', ggResEur(b.strom.kosten),
          `${m.anzahl} Einspeisepunkte`, ggResEur(m.kosten)] });
        cfg.fussnote = 'Richtwerte netto, ohne Wärme; mobil: Einspeisepunkt (Spitze × 1,2 / cos φ 0,8) + Abgänge, ohne Rahmenvertrag.';
        return `✓ ${cfg.zeilen.length - 1 - (b.strom.liter ? 1 : 0)} Standorte übernommen.`;
      },
    },

    // ── 5.2.4 Szenario 3 (Figur-IDs res-sz2-* aus der Zeit, als die Liegenschaft Szenario 2 war) ──
    {
      id: 'res-sz2-text', istText: true, reihe: 10,
      kapitel: '8.2.4 Szenario 3: Versorgung der Gesamtliegenschaft',
      titel: 'Gutachtentext: Szenario 3 — Gesamtliegenschaft',
      datei: 'resilienz-szenario2-text',
      hinweis: 'Inselbetrieb der Liegenschaft am NAP mit Anteil, Dauer und Redundanz aus dem Reiter „Liegenschaft“ des 🛡 Blackout-Modus.',
      render: cfg => ggRenderResLiegenschaftText(cfg),
      config: {},
    },
    {
      id: 'res-insel-prinzip', autoSync: true, reihe: 15,
      kapitel: '8.2.4 Szenario 3: Versorgung der Gesamtliegenschaft',
      titel: 'Prinzip Inselbetrieb der Liegenschaft',
      datei: 'resilienz-inselbetrieb-prinzip',
      hinweis: 'Prinzipskizze: Netztrennung am NAP, zentrale NEA mit Maschinentrafo und Sternpunktbildung, Stationsabgänge in '
             + 'Zuschaltstufen, Schutz und Leittechnik. Werte aus dem Reiter „Liegenschaft“ des 🛡 Blackout-Modus, sonst allgemein.',
      render: cfg => ggRenderInselPrinzip(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 3', titel: 'Inselbetrieb der Liegenschaft', werte: {},
        abgaenge: GG_RES_INSEL_ABGAENGE_ALLGEMEIN,
        punkte: [
          'Netztrennung am NAP: Leistungsschalter mit Verriegelung Netz/NEA, Synchronisierung für die Rückschaltung',
          'MS-Einspeisefeld mit Leistungsschalter und Schutz für die Netzersatzanlage',
          'Maschinentransformator hebt die Generatorspannung auf die Mittelspannung',
          'eigene Sternpunktbildung im Inselbetrieb (Sternpunkt über Widerstand bzw. Erdungstrafo)',
          'Netzersatzanlage(n) im Parallelbetrieb, Kraftstofflager für die Autonomiedauer',
          'fernsteuerbare Stationsabgänge (M), Zuschaltung in Stufen gegen Einschaltstrom und Lastsprung',
          'Schutzgeräte (S) mit eigenem Parametersatz „Inselbetrieb“ für den geringeren Kurzschlussstrom',
          'Leittechnik: Umschaltung, Zuschaltlogik, Lastabwurf bei Überlast, Kraftstoffüberwachung',
        ],
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const r = sz?.s3.bewertung.insel;
        if (!r || !(r.spitzeKw > 0)) {
          cfg.werte = {};
          cfg.abgaenge = GG_RES_INSEL_ABGAENGE_ALLGEMEIN;
          return 'ℹ Allgemeine Darstellung — für Werte im Blackout-Modus Lastgang und Trafostationen erfassen.';
        }
        const uKv = ggNum(sz.uKv, sz.uKv % 1 ? 1 : 0);
        cfg.werte = {
          neaAnzahl: r.aggregate.anzahl, uKv,
          nea: `${r.aggregate.anzahl} × ${ggNum(r.aggregate.kvaJe)} kVA${sz.s3.redundanz ? ' (N+1)' : ''}`,
          mt: `0,4/${uKv} kV · ${ggNum(r.maschinentrafoKva)} kVA`,
          tank: `${ggNum(r.liter)} l Diesel`,
        };
        const stufen = r.zuschaltung.stufen, aus = r.lastabwurf.abschalten;
        const plaetze = aus.length ? 3 : 4;
        const namen = liste => liste.map(t => t.name || 'Station').join(', ');
        const abg = stufen.length <= plaetze
          ? stufen.map((st, i) => ({ titel: `Stufe ${i + 1}`, unter: namen(st.trafos) }))
          : [...stufen.slice(0, plaetze - 1).map((st, i) => ({ titel: `Stufe ${i + 1}`, unter: namen(st.trafos) })),
             { titel: `Stufe ${plaetze}–${stufen.length}`,
               unter: `${stufen.slice(plaetze - 1).reduce((n, st) => n + st.trafos.length, 0)} Stationen` }];
        if (aus.length) abg.push({ titel: 'abgeschaltet', unter: namen(aus), aus: true });
        cfg.abgaenge = abg;
        cfg.titel = `Inselbetrieb der Liegenschaft (${ggNum(r.anteilPct)} % der Spitze, ${ggResDauer(sz.dauerH)})`;
        return `✓ ${stufen.length} Zuschaltstufen, ${aus.length} Stationen abgeschaltet.`;
      },
    },
    {
      id: 'res-insel-ee', autoSync: true, reihe: 17,
      kapitel: '8.2.4 Szenario 3: Versorgung der Gesamtliegenschaft',
      titel: 'Erneuerbare Erzeuger und Speicher im Inselbetrieb',
      datei: 'resilienz-inselbetrieb-erneuerbare',
      hinweis: 'Prinzipskizze: NEA führt die Insel (netzbildend, 100 % der Last), Batteriespeicher und PV/Wind/BHKW werden '
             + 'netzfolgend zugeschaltet; flexible Lasten, Frequenz-Kennlinie, Vorteile, Ablauf Inbetriebnahme/Rückkehr ans Netz '
             + 'und Betriebshinweise. Leistungen der Anlagen aus dem Netzmodell, fehlende als Option.',
      render: cfg => ggRenderInselEe(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 3', titel: 'Erneuerbare Erzeuger und Speicher im Inselbetrieb', werte: {},
        anlagen: GG_RES_EE_ANLAGEN_ALLGEMEIN,
        vorteile: [
          'weniger Kraftstoff: längere Autonomie mit demselben Tanklager',
          'klare Führung: fallen PV oder Speicher aus, trägt die NEA die Insel weiter',
          'Speicher fängt Lastsprünge ab: weniger Zuschaltstufen, stabilere Frequenz',
          'vorhandene PV- und KWK-Anlagen bleiben im Blackout nutzbar',
          'Speicher im Normalbetrieb mehrfach nutzbar: Spitzenlast, Eigenverbrauch',
          'kein netzbildender Wechselrichter nötig: auch Bestandsanlagen einbindbar',
          'weniger Emissionen, Lärm und Kraftstofflogistik',
        ],
        vorteilHinweis: 'Die gesicherte Leistung stellt allein die NEA (100 % der Last) – PV und Speicher sparen Kraftstoff, ersetzen aber keine Leistung.',
        ablauf: GG_RES_EE_ABLAUF,
        punkte: [
          'NEA führt: der Synchrongenerator gibt Spannung und Frequenz vor und ist für 100 % der Last bemessen – die Insel läuft auch ohne PV und Speicher',
          'Batteriespeicher wird zugeschaltet, sobald die Insel steht; er folgt der NEA (netzstützend), fängt Lastsprünge ab und nimmt Überschuss auf',
          'PV speist netzfolgend ein; bei Überschuss Abregelung über die P(f)-Kennlinie (Frequenzanhebung) oder per Sollwert vom EMS',
          'BHKW nur mit Synchrongenerator und inselfähiger Regelung; auf die NEA synchronisiert, stromgeführt, Wärme in den Puffer',
          'flexible Lasten (Heizstab, Wärmepumpen, Ladepunkte) nehmen Überschuss auf und werden bei Mangel zuerst abgeworfen',
          'PV- und Speicherleistung so begrenzen, dass die NEA ihre Mindestlast (ca. 30–40 %) hält; Rückleistungsschutz (S) an der NEA',
          'EMS: Sollwerte, Ladezustand, Abregelung, Lastabwurf; steuert die Zuschaltreihenfolge und die Rückkehr ans Netz (Ablauf oben)',
          'Wechselrichter liefern kaum Kurzschlussstrom; NA-Schutz und Inselnetzerkennung für den Inselbetrieb parametrieren (VDE-AR-N 4105/4110)',
        ],
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const r = sz?.s3.bewertung.insel;
        const pvKwp = ggResAssetSumme('PV', 'leistungKWp');
        const windKw = ggResAssetSumme('Wind', 'leistungKW');
        const kwkKw = ggResAssetSumme('KWK', 'leistungElKW');
        const battKw = ggResAssetSumme('Batterie', 'leistungKW');
        const battKwh = ggResAssetSumme('Batterie', 'kapazitaetKWh');
        const hatInsel = r && r.spitzeKw > 0;
        const uKv = sz ? ggNum(sz.uKv, sz.uKv % 1 ? 1 : 0) : undefined;
        cfg.werte = {
          uKv,
          nea: hatInsel ? `${r.aggregate.anzahl} × ${ggNum(r.aggregate.kvaJe)} kVA${sz.s3.redundanz ? ' (N+1)' : ''}` : '',
          speicher: battKwh > 0 ? `${battKw > 0 ? `${ggNum(battKw)} kW / ` : ''}${ggNum(battKwh)} kWh` : '',
          speicherOption: !(battKwh > 0),
        };
        cfg.anlagen = [
          { art: 'pv', titel: 'Photovoltaik', unter: 'netzfolgend · P(f)', wert: pvKwp > 0 ? `${ggNum(pvKwp)} kWp` : '', option: !(pvKwp > 0) },
          ...(windKw > 0 ? [{ art: 'wind', titel: 'Wind', unter: 'netzfolgend · P(f)', wert: `${ggNum(windKw)} kW` }] : []),
          { art: 'kwk', titel: 'BHKW (KWK)', unter: 'Synchrongenerator', wert: kwkKw > 0 ? `${ggNum(kwkKw)} kWel` : '', option: !(kwkKw > 0) },
          { art: 'last', titel: 'Verbraucher', unter: 'Stationen in Stufen',
            wert: hatInsel ? `${r.zuschaltung.stufen.length} Zuschaltstufen` : '' },
          { art: 'flex', titel: 'flexible Lasten', unter: 'Heizstab · WP · Laden' },
        ];
        const vorh = [pvKwp > 0 && `${ggNum(pvKwp)} kWp PV`, windKw > 0 && `${ggNum(windKw)} kW Wind`,
          kwkKw > 0 && `${ggNum(kwkKw)} kWel KWK`, battKwh > 0 && `${ggNum(battKwh)} kWh Speicher`].filter(Boolean);
        return vorh.length ? `✓ Aus dem Netzmodell: ${vorh.join(', ')}.` : 'ℹ Keine Erzeuger/Speicher im Netzmodell — alle als Option dargestellt.';
      },
    },
    {
      id: 'res-sz2-schema', autoSync: true, reihe: 20,
      kapitel: '8.2.4 Szenario 3: Versorgung der Gesamtliegenschaft',
      titel: 'Schema Szenario 3 — Inselbetrieb der Liegenschaft',
      datei: 'resilienz-szenario2-schema',
      hinweis: 'Zentrale Netzersatzanlage mit Maschinentrafo am NAP; je Transformatorstation Zuschaltstufe oder Abschaltung.',
      render: cfg => ggRenderResSchema(cfg),
      config: { eyebrow: 'Resilienz · Szenario 3', titel: 'Inselbetrieb der Liegenschaft', modus: 'insel',
                stationen: [], zentral: null, legende: [], fussnote: '', leer: 'Keine Transformatorstationen im Netzmodell.' },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const r = sz?.s3.bewertung.insel;
        if (!r || !(r.spitzeKw > 0)) { cfg.stationen = []; cfg.zentral = null; return '⚠ Keine Liegenschaftslast — Lastgang oder Trafos fehlen.'; }
        cfg.zentral = {
          zeilen: ['Netzersatzanlage am NAP',
            `${r.aggregate.anzahl} × ${ggNum(r.aggregate.kvaJe)} kVA${sz.s3.redundanz ? ' (N+1)' : ''}`,
            `Kraftstoff ${ggNum(r.liter)} l · ${ggResDauer(sz.dauerH)}`],
          trafo: `Maschinentrafo ${ggNum(r.maschinentrafoKva)} kVA`,
        };
        cfg.stationen = sz.stationen.map(s => ({
          name: s.name, zeile2: ggResStationZeile(s),
          zustand: s.sz3.versorgt ? 'versorgt' : 'aus',
          band: s.sz3.versorgt ? `Zuschaltstufe ${s.sz3.stufe ?? '—'}` : 'abgeschaltet',
          gebaeude: s.gebaeude.filter(g => g.klasse === 'A' || g.klasse === 'B'),
          ohneGebText: 'keine Gebäude A/B',
        }));
        cfg.titel = `Inselbetrieb der Liegenschaft (${ggNum(r.anteilPct)} % der Spitze, ${ggResDauer(sz.dauerH)})`;
        cfg.legende = [
          ...GG_RES_LEGENDE_KLASSEN,
          { farbe: GG_THEME.tint, rand: GG_THEME.accents.gruen, text: 'im Inselbetrieb versorgt' },
          { farbe: GG_THEME.neutral.cardBg, rand: GG_THEME.text.faint, strich: true, text: 'abgeschaltet' },
        ];
        cfg.fussnote = `Je Zuschaltstufe höchstens ${ggNum(r.zuschaltung.kvaGrenze)} kVA Trafoleistung und ${ggNum(r.zuschaltung.lastGrenze)} kW Lastsprung.`;
        return `✓ ${sz.stationen.length} Stationen, ${r.zuschaltung.stufen.length} Zuschaltstufen.`;
      },
    },
    {
      id: 'res-sz2-stationen', autoSync: true, reihe: 30,
      kapitel: '8.2.4 Szenario 3: Versorgung der Gesamtliegenschaft',
      titel: 'Transformatorstationen im Inselbetrieb',
      datei: 'resilienz-szenario2-stationen',
      hinweis: 'Je Station: Trafoleistung, Spitzenlast, Last der Gebäude A/B und Zuschaltstufe bzw. Abschaltung.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 3', titel: 'Transformatorstationen im Inselbetrieb', tabelleTitel: 'Transformatorstationen im Inselbetrieb',
        leer: 'Keine Transformatorstationen im Netzmodell.',
        spalten: [{ label: 'Station', weight: 1.6 }, { label: 'Trafo', weight: 0.9 }, { label: 'Spitzenlast', weight: 1 },
                  { label: 'Last A/B', weight: 1 }, { label: 'Inselbetrieb', weight: 1.3 }],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        const r = sz?.s3.bewertung.insel;
        if (!r || !sz.stationen.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Stationen oder keine Liegenschaftslast.'; }
        const sortiert = [...sz.stationen].sort((a, b) => (a.sz3.stufe ?? 99) - (b.sz3.stufe ?? 99));
        cfg.zeilen = sortiert.map(s => ({ werte: [s.name, ggResKva(s.kva), ggResKw(s.spitzeKw), ggResKw(s.abKw),
          s.sz3.versorgt ? `Stufe ${s.sz3.stufe ?? '—'}` : 'abgeschaltet'], highlight: false }));
        cfg.zeilen.push({ highlight: true, werte: ['Liegenschaft', '', kurzKw(r.spitzeKw), '', `abgesichert ${kurzKw(r.bemessungKw)}`] });
        cfg.fussnote = `Spitzenlast je Station aus dem Netzmodell; abgesichert ${ggNum(r.anteilPct)} % der Liegenschaftsspitze, diese ${ggResQuelle(sz.lastQuelle)}.`;
        return `✓ ${sz.stationen.length} Stationen übernommen.`;
      },
    },
    {
      id: 'res-sz2-massnahmen', autoSync: true, reihe: 40,
      kapitel: '8.2.4 Szenario 3: Versorgung der Gesamtliegenschaft',
      titel: 'Technische Maßnahmen Inselbetrieb',
      datei: 'resilienz-szenario2-massnahmen',
      hinweis: 'Checkliste des Reiters „Liegenschaft“ mit Status (neu/erneuern/prüfen/ok) und Richtkosten.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz · Szenario 3', titel: 'Technische Maßnahmen Inselbetrieb', tabelleTitel: 'Technische Maßnahmen Inselbetrieb',
        leer: 'Noch keine Inselbetrachtung — Lastgang oder Trafos fehlen.',
        spalten: [{ label: 'Bereich', weight: 1 }, { label: 'Maßnahme', weight: 2.8, mono: false, align: 'left' },
                  { label: 'Status', weight: 0.8, mono: false }, { label: 'Richtkosten', weight: 1 }],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const r = ggResSz()?.s2.bewertung.insel;
        if (!r || !(r.spitzeKw > 0)) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Inselbetrachtung vorhanden.'; }
        cfg.zeilen = r.checkliste.map(c => ({ werte: [c.gruppe, c.titel, GG_RES_CHECK_STATUS[c.status] || c.status,
          c.kosten > 0 ? ggResEur(c.kosten) : '—'] }));
        cfg.zeilen.push({ highlight: true, werte: ['', 'Summe (ohne Wärme)', '', ggResEur(r.kosten)] });
        cfg.fussnote = 'Richtwerte netto; Status „erneuern“ aus dem Baujahr (> 20 Jahre), von Hand im Blackout-Modus änderbar.';
        return `✓ ${r.checkliste.length} Maßnahmen übernommen.`;
      },
    },

    // ── 5.2.5 Gegenüberstellung ──
    {
      id: 'res-sz-vergleich-text', istText: true, reihe: 10,
      kapitel: '8.2.5 Gegenüberstellung der Szenarien',
      titel: 'Gutachtentext: Gegenüberstellung der Szenarien',
      datei: 'resilienz-szenarien-vergleich-text',
      hinweis: 'Abgesicherte Leistung, Investition und €/kW beider Szenarien, stufenweises Vorgehen.',
      render: cfg => ggRenderResVergleichText(cfg),
      config: {},
    },
    {
      id: 'res-sz-umfang', autoSync: true, reihe: 20,
      kapitel: '8.2.5 Gegenüberstellung der Szenarien',
      titel: 'Versorgungsumfang je Szenario',
      datei: 'resilienz-szenarien-umfang',
      hinweis: 'Abgesicherte Leistung der drei Szenarien, aufgeteilt nach Klasse A, Klasse B und übriger Liegenschaft, gegen die Liegenschaftsspitze.',
      render: cfg => ggRenderBalken(cfg),
      config: {
        eyebrow: 'Resilienz', titel: 'Versorgungsumfang je Szenario', ort: '', meta: leerMeta(),
        achseY: 'Leistung in kW', achseX: 'Szenario',
        leer: 'Noch keine Szenarien — im 🛡 Blackout-Modus Klassen zuweisen und Netz erfassen.',
        kategorien: [], gruppen: [], kpiLinks: [], kpiRechts: [],
      },
      ausProjekt(cfg) {
        cfg.ort = cfg.ort || ggLiegenschaft();
        cfg.meta['Datum'] = cfg.meta['Datum'] || ggHeute();
        ggMetaDefaults(cfg, 'pdBearbeiterStrom');
        const sz = ggResSz();
        const r = sz?.s3.bewertung.insel;
        const spitze = sz?.liegenschaftSpitzeKw || 0;
        if (!sz || !(spitze > 0)) { cfg.kategorien = []; cfg.gruppen = []; return '⚠ Keine Liegenschaftslast vorhanden.'; }
        const a = sz.s1.aKw, bNur = Math.max(0, sz.s1.abKw - a);
        // Szenario 2: A/B je Station (gleichzeitige Spitze je Station), A-Anteil wie in Szenario 1
        const kw2 = sz.s2.kw, a2 = Math.min(a, kw2);
        const abgesichert3 = Math.max(r.bemessungKw, a + bNur);
        cfg.kategorien = ['Szenario 1 · kritische Gebäude', 'Szenario 2 · je Trafostation', 'Szenario 3 · Liegenschaft'];
        cfg.gruppen = [{ label: 'Leistung', segmente: [
          { label: 'Klasse A (kritisch)', farbe: GG_RES_KLASSE_FARBE.A, werte: [a, a2, a] },
          { label: 'Klasse B (eingeschränkt)', farbe: GG_RES_KLASSE_FARBE.B, werte: [0, Math.max(0, kw2 - a2), bNur] },
          { label: 'übrige Liegenschaft', farbe: GG_THEME.accents.gruen, werte: [0, 0, Math.max(0, abgesichert3 - a - bNur)] },
          { label: 'nicht abgesichert', farbe: GG_THEME.neutral.iconLine,
            werte: [Math.max(0, spitze - a), Math.max(0, spitze - kw2), Math.max(0, spitze - abgesichert3)] },
        ] }];
        cfg.kpiLinks = [
          { wert: ggResEur(sz.s1.bewertung.kosten), label: 'Investition Szenario 1' },
          { wert: ggResEur(sz.s2.bewertung.kosten), label: 'Investition Szenario 2 fest' },
        ];
        cfg.kpiRechts = [
          { wert: ggResEur(sz.s2.mobil.gesamt), label: 'Investition Szenario 2 mobil' },
          { wert: ggResEur(sz.s3.bewertung.kosten), label: 'Investition Szenario 3', highlight: true },
        ];
        cfg.titel = `Versorgungsumfang je Szenario (Liegenschaftsspitze ${ggNum(spitze)} kW)`;
        return '✓ Drei Szenarien übernommen.';
      },
    },
    {
      id: 'res-sz-vergleich', autoSync: true, reihe: 30,
      kapitel: '8.2.5 Gegenüberstellung der Szenarien',
      titel: 'Gegenüberstellung der Szenarien',
      datei: 'resilienz-szenarien-vergleich',
      hinweis: 'Maßnahmen, Kraftstoff, Wärme und Richtkosten der drei Szenarien nebeneinander.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz', titel: 'Gegenüberstellung der Szenarien', tabelleTitel: 'Gegenüberstellung der Szenarien',
        leer: 'Noch keine Szenarien — 🛡 Blackout-Modus.',
        spalten: GG_RES_VERGLEICH_SPALTEN,
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const sz = ggResSz();
        if (!sz) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Blackout-Modus nicht verfügbar.'; }
        // Gespeicherte Einstellungen können noch zwei Szenarien oder die alte Reihenfolge tragen
        cfg.spalten = GG_RES_VERGLEICH_SPALTEN;
        const b1 = sz.s1.bewertung, b2 = sz.s2.bewertung, b3 = sz.s3.bewertung;
        const m = resilienzZielMatrix([b1, b2, b3]);
        const spitze = sz.liegenschaftSpitzeKw;
        const kw2 = sz.s2.kw, kw3 = b3.insel?.bemessungKw || 0;
        // Bewertung nur mit Status — die Gründe stehen im Text des jeweiligen Szenarios
        const kuerzen = w => ggResKuerzen(String(w).split(' — ')[0], 36);
        const stationenMitNea = sz.stationen.filter(s => s.sz2.length).length;
        cfg.zeilen = [
          { werte: ['Versorgte Gebäude', b1.strom ? `${b1.strom.gebaeude} der Klasse A` : '—',
            b2.strom ? `${b2.strom.gebaeude} der Klassen A/B` : '—',
            b3.strom ? `${b3.strom.stationenAn} von ${b3.strom.stationenAn + b3.strom.stationenAus} Stationen` : '—'] },
          { werte: ['Abgesicherte Leistung', `${ggNum(sz.s1.aKw)} kW (${ggResPct(sz.s1.aKw, spitze)})`,
            kw2 ? `${ggNum(kw2)} kW (${ggResPct(kw2, spitze)})` : '—',
            kw3 ? `${ggNum(kw3)} kW (${ggResPct(kw3, spitze)})` : '—'] },
          ...m.zeilen.filter(z => z.label !== 'Umfang Strom').map(z => {
            const werte = z.werte.map(kuerzen);
            if (z.label === 'Notstromaggregate' && b2.strom) {
              const amGeb = sz.s2.ohneStation.length;
              werte[1] = `${stationenMitNea} an Stationen${amGeb ? ` + ${amGeb} am Gebäude` : ''}, ${ggNum(b2.strom.kw)} kW`;
            }
            return { werte: [z.label, ...werte], highlight: !!z.highlight };
          }),
          { werte: ['Investition mobil', '—', b2.strom ? ggResEur(sz.s2.mobil.gesamt) : '—', '—'] },
        ];
        cfg.fussnote = `Alle Szenarien über ${ggResDauer(sz.dauerH)}, mit Wärme; Richtwerte netto. Szenario 2 mobil ohne Rahmenvertrag für Aggregate und Kraftstoff.`;
        return '✓ Drei Szenarien übernommen.';
      },
    },

    // ── 5.2.6 Allgemeine Empfehlungen ──
    {
      id: 'res-einspeisung-text', istText: true, reihe: 10,
      kapitel: '8.2.6 Allgemeine Empfehlungen',
      titel: 'Gutachtentext: Einspeisepunkte an Trafostationen',
      datei: 'resilienz-einspeisepunkte-text',
      hinweis: 'Empfehlung unabhängig vom Szenario: Einspeisemöglichkeit für mobile Aggregate an jeder Trafostation.',
      render: cfg => ggRenderResEinspeisungText(cfg),
      config: {},
    },
    {
      id: 'res-einspeisung-prinzip', reihe: 20,
      kapitel: '8.2.6 Allgemeine Empfehlungen',
      titel: 'Prinzip Einspeisepunkt an der Trafostation',
      datei: 'resilienz-einspeisepunkt-prinzip',
      hinweis: 'Prinzipskizze: Umschalteinrichtung, Einspeisekasten, Stellfläche, Kennzeichnung der Abgänge, Erdung.',
      render: cfg => ggRenderEinspeisePrinzip(cfg),
      config: {
        eyebrow: 'Resilienz · Allgemeine Empfehlung', titel: 'Einspeisepunkt für mobile Netzersatzanlagen',
        punkte: [
          'Umschalteinrichtung Netz – 0 – NEA mit gegenseitiger Verriegelung, kein Parallelbetrieb mit dem Netz',
          'Einspeisekasten, von außen zugänglich, genormte Steckverbinder',
          'fest verlegte Verbindung vom Einspeisekasten zur Umschalteinrichtung',
          'befestigte Stellfläche mit Zufahrt für Aggregat und Tankfahrzeug',
          'Abgänge nach Priorität gekennzeichnet, nicht versorgte Abgänge abschaltbar',
          'Anschlusspunkt für Erdung und Potentialausgleich des Aggregats',
        ],
      },
    },
    {
      id: 'res-einspeisepunkte', autoSync: true, reihe: 30,
      kapitel: '8.2.6 Allgemeine Empfehlungen',
      titel: 'Einspeisepunkte an den Transformatorstationen',
      datei: 'resilienz-einspeisepunkte',
      hinweis: 'Je Trafostation: Bemessung der Einspeisung (Spitze + 20 %, höchstens Trafoleistung), Anschlussart, Vorrang und Richtkosten.',
      render: cfg => ggRenderTabelle(cfg),
      config: {
        eyebrow: 'Resilienz · Allgemeine Empfehlung', titel: 'Einspeisepunkte an den Transformatorstationen',
        tabelleTitel: 'Einspeisepunkte an den Transformatorstationen',
        leer: 'Keine Transformatorstationen im Netzmodell.',
        spalten: [{ label: 'Station', weight: 1.4 }, { label: 'Trafo', weight: 0.8 }, { label: 'Spitze', weight: 0.8 },
                  { label: 'Einspeisung', weight: 0.9 }, { label: 'Anschluss', weight: 1.5, mono: false },
                  { label: 'Vorrang', weight: 0.7, mono: false }, { label: 'Richtkosten', weight: 0.9 }],
        zeilen: [], fussnote: '',
      },
      ausProjekt(cfg) {
        const st = ggResSz()?.stationen || [];
        if (!st.length) { cfg.zeilen = []; cfg.fussnote = ''; return '⚠ Keine Transformatorstationen im Netzmodell.'; }
        const sortiert = [...st].sort((a, b) => (b.abKw > 0) - (a.abKw > 0));
        cfg.zeilen = sortiert.map(s => ({
          akzent: s.abKw > 0 ? GG_RES_KLASSE_FARBE.A : undefined,
          werte: [s.name, ggResKva(s.kva), ggResKw(s.spitzeKw),
            s.einspeisung.kva ? `${ggNum(s.einspeisung.kva)} kVA` : '—', s.einspeisung.anschluss || '—',
            s.abKw > 0 ? 'A/B' : '—', s.einspeisung.kosten ? ggResEur(s.einspeisung.kosten) : '—'],
        }));
        cfg.zeilen.push({ highlight: true, werte: ['Summe', '', '', '', '', '',
          ggResEur(st.reduce((s, x) => s + x.einspeisung.kosten, 0))] });
        cfg.fussnote = 'Einspeisung = Spitze × 1,2 / cos φ 0,8, gerundet auf übliche Aggregatgrößen, höchstens Trafoleistung; ohne Lastgang Trafoleistung.';
        return `✓ ${st.length} Stationen übernommen.`;
      },
    },
    {
      id: 'res-empfehlungen-text', istText: true, reihe: 40,
      kapitel: '8.2.6 Allgemeine Empfehlungen',
      titel: 'Gutachtentext: weitere allgemeine Empfehlungen',
      datei: 'resilienz-allgemeine-empfehlungen-text',
      hinweis: 'Planungsgrundsätze: Einspeisung bei Erneuerung, USV, PV-Inselfähigkeit, Schutz, Kennzeichnung, Kraftstoff, Wasser, Dokumentation.',
      render: cfg => ggRenderResEmpfehlungText(cfg),
      config: {},
    },
  ];
}
GG_FIGUREN.push(...ggResSzenarienFiguren());

/* ── 3.4.3 Notstromversorgung und Lastmanagement (Variantenbildung) ────────────
 * Auslegung aus der Inselbetrieb-Simulation der PV-Analyse (window._pvResReco, Kapitel 6.1 „Resilienz“),
 * Anzahl und Standorte aus den geplanten Notstromaggregaten des Elektro-Tabs, Bestand wie in 5.1.4.
 * Lastmanagement heißt hier Lastabwurf auf die Notbetriebslast. Die Resilienzbewertung bleibt in 8.2.
 * _pvResReco wird mit der PV-Analyse im Projekt gespeichert (09d pvCaptureState). */
const GG_KAP_NOTSTROM = '5.4.3 Notstromversorgung und Lastmanagement';

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
      + 'Gebäudelastgänge und des Bestandsnetzes (vgl. Kapitel 8.1); bemessen wird auf die gleichzeitige Spitzenlast '
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
    absaetze.push('Grundlage der Auslegung ist eine Inselbetrieb-Simulation mit dem Lastgang des Referenzjahres (vgl. Kapitel 5.2) '
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
    absaetze.push('Im Bestand ist keine Netzersatzanlage vorhanden (vgl. Kapitel 5.1.4)'
      + (erf ? '; die Notstromversorgung ist neu zu errichten.' : '.'));
  } else if (erf) {
    if (s.bestandKw == null) {
      absaetze.push(`Die vorhandenen Netzersatzanlagen sind mit ihrer Leistung von ${ggTextFeld('', 'Leistung Bestand kW')} kW `
        + 'der erforderlichen Leistung gegenüberzustellen (vgl. Kapitel 5.1.4).');
    } else if (s.bestandKw >= erf) {
      absaetze.push(`Die vorhandenen Netzersatzanlagen decken mit zusammen ${ggNum(s.bestandKw)} kW die erforderliche Leistung `
        + '(vgl. Kapitel 5.1.4)'
        + (s.bestandH != null && s.bestandH < r.durH
          ? `; ihr Kraftstoffvorrat reicht jedoch nur für ${ggNum(s.bestandH)} Stunden und ist auf ${r.durH} Stunden zu erweitern `
            + 'oder durch eine gesicherte Nachbetankung zu ergänzen.'
          : '.'));
    } else {
      absaetze.push(`Die vorhandenen Netzersatzanlagen reichen mit zusammen ${ggNum(s.bestandKw)} kW nicht aus (vgl. Kapitel 5.1.4); `
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
    return `Nach der Bewertung am Bestandsnetz (Schutzziel „${gEsc(b.ziel.name)}“, vgl. Kapitel 8.2) wird die Notstromversorgung `
      + `zentral am Netzanschlusspunkt mit ${ggNum(b.strom.anzahl)} × ${ggNum(b.strom.kvaJe)} kVA und einem Maschinentransformator `
      + `von ${ggNum(b.strom.mtKva)} kVA vorgesehen.`;
  }
  const orte = (b.variante?.aggregate || []).filter(a => a.empfKw > 0)
    .map(a => `${ggResOrt(a)} (${ggNum(a.empfKw)} kW`
      + `${a.bestandKw > 0 ? (a.zusatzKw > 0 ? `, davon ${ggNum(a.bestandKw)} kW vorhanden` : ', vorhanden') : ''})`);
  if (!orte.length) return null;
  return `Nach der Bewertung am Bestandsnetz (Schutzziel „${gEsc(b.ziel.name)}“, vgl. Kapitel 8.2) werden die Netzersatzanlagen `
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
      : gelb('fehlt — ☀ PV-Analyse › Kapitel 6.1 „Resilienz“ öffnen'))
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
    hinweis: 'Auslegung aus der Inselbetrieb-Simulation (☀ PV-Analyse › Kapitel 6.1 „Resilienz“): Ausfalldauer, Betriebsweise, '
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
        return '⚠ Keine Resilienz-Rechnung und keine Notstromaggregate — ☀ PV-Analyse › Kapitel 6.1 „Resilienz“ öffnen.';
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
          + `${GG_RES_MODE_LBL[r.mode] || r.mode}, Aggregat inkl. 20 % Reserve · Bestand: Kapitel 5.1.4 · Geplant: Planungsschicht im Elektro-Tab`
        : 'Erforderliche Werte fehlen — ☀ PV-Analyse › Kapitel 6.1 „Resilienz“ öffnen · Bestand: Kapitel 3.1.4';
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
 * ungesteuertes Laden gegenüber Lademanagement (Begrenzung auf die Reserve der Anschlussleistung aus 5.3.4),
 * Netzanbindung aus dem Netzmodell (versorgende Verteilung/Trafo, ausgelöste Engpässe) und rechtliche
 * Rahmenbedingungen mit Platzhaltern. Lademanagement selbst simuliert das Tool nicht. */
const GG_KAP_LADE = '5.4.4 Ladeinfrastruktur';

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
      'Ladeinfrastruktur ist weder im Bestand vorhanden noch geplant (vgl. Kapitel 5.3.3); eine Variantenbildung entfällt. '
        + `Für eine spätere Nachrüstung ist ${ggTextFeld('', 'Vorhaltung, z. B. Leerrohre und Reserveabgänge an der NSHV')} vorzusehen.`,
    ], T);
  }
  const absaetze = ['Aufbauend auf dem Zusatzbedarf aus Kapitel 5.3.3 werden für die Ladeinfrastruktur die zeitliche Staffelung '
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
      + '(vgl. Kapitel 5.3.3); diese Leistung muss am Netzanschluss und im internen Netz jederzeit zur Verfügung stehen.');
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
      + 'vermeiden, begrenzt aber den zusätzlichen Bedarf der Ladeparks (Variante B in Kapitel 5.4.1).';
  } else if (rv.verfuegbar >= rv.ladeKw) {
    p += `Innerhalb der vereinbarten Anschlussleistung von ${ggNum(rv.cap)} kVA stehen für das Laden ${ggNum(rv.verfuegbar)} kW `
      + 'zur Verfügung und damit mehr als die Auslegungsleistung. Ein Lademanagement ist aus Sicht des Netzanschlusses nicht '
      + 'erforderlich, sichert aber die Reserve für weitere Verbraucher.';
  } else {
    const anteil = rv.verfuegbar / rv.ladeKw;
    p += `Innerhalb der vereinbarten Anschlussleistung von ${ggNum(rv.cap)} kVA stehen für das Laden noch ${ggNum(rv.verfuegbar)} kW `
      + `zur Verfügung, das sind ${ggNum(anteil * 100)} % der Auslegungsleistung. Wird die Ladeleistung per Lademanagement auf `
      + 'diesen Wert begrenzt, bleibt die Liegenschaft innerhalb der vereinbarten Anschlussleistung und kommt ohne Erhöhung '
      + 'aus (Variante B in Kapitel 5.4.1).'
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
      + 'Kapitel 5.4.1 aufgeführt und vor der Inbetriebnahme der Ladepunkte umzusetzen.');
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
           + 'Ladeleistung = vereinbarte Anschlussleistung − übriger Bedarf aus 5.3.4.',
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
           + '(Verweis auf die Ertüchtigungen in 5.4.1). Ohne Netzmodell Platzhaltertext.',
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
           + 'und Umsetzungsjahr. Ergänzt die Tabelle in 5.3.3.',
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
                   + `zusammen ${ggNum(summeKw)} kW` + (res ? ` · Engpässe aus dem Netzmodell ${res.von}–${res.bis}, Ertüchtigung siehe Kapitel 5.4.1` : ' · ohne Netzmodell');
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
 * Kostenpositionen aus 5.4.1–5.4.4: Netzanschluss (Mehrleistung × Baukostenzuschuss), internes Netz
 * (Ertüchtigungsvorschläge des Netzmodells), PV/Speicher (wirtschaftlich optimierte Variante der PV-Analyse,
 * Jahreskosten von dort), Notstrom (Resilienz-Rechnung), Ladeinfrastruktur (Ladepunkte × Kennwert).
 * Jahreskosten nach VDI 2067 über lib/elektro-kosten.js. Die Kennwerte hängen an der Config der Kostentabelle
 * und werden als deren Figur-Einstellung gespeichert. */
const GG_KAP_WIRT = '5.5 Wirtschaftlichkeit und Investitionskosten';
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

/** Kostenpositionen der Kapitel 5.4.1–5.4.4 samt Auswertung; `offen` nennt, was nicht beziffert werden kann. */
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

  absaetze.push('Für die Maßnahmen der Kapitel 5.4.1 bis 5.4.4 werden die Investitionskosten und die jährlichen Kosten in '
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
    absaetze.push(`Für PV und Batteriespeicher geht die wirtschaftlich optimierte Variante „${gEsc(pv.label)}“ aus Kapitel 5.4.2 ein; `
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
  absaetze.push('Die Bewertung der Varianten folgt in Kapitel 5.6.');
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
    + '<span style="font-size:10px;color:var(--muted);margin-left:8px;">gelten für alle Kostenbausteine in 5.5</span>';
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
           + 'Summenzeile. Die Kostenkennwerte dieser Tabelle gelten für alle Kostenbausteine in 5.5.',
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
      // Nur Anzeige: Auslegung kommt aus Kapitel 6.1 „Resilienz“, Aggregate aus dem Elektro-Tab
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
