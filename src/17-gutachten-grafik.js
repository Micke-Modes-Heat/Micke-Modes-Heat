// ── 17-gutachten-grafik.js — Gutachten-Grafiken: einheitliche SVG-Figuren + Word-Export ──
// Alle Abbildungen fürs Gutachten werden hier aus Daten gezeichnet (natives SVG,
// kein DOM-Screenshot) und lassen sich per Knopfdruck nach Word übernehmen:
//   • PNG @2–4× in die Zwischenablage  → in Word mit Strg+V einfügen
//   • SVG als Datei                    → in Word über Einfügen › Bilder (bleibt Vektor)
// SVG in die Zwischenablage funktioniert bei Word NICHT — deshalb der PNG-Weg.

// Bewusst ohne Imports aus dem App-Kern: das Modul soll ein Blatt im Importgraph
// bleiben (siehe tests/import-architecture.test.js). Assets werden zur Laufzeit
// über window gelesen — main.js legt alle Modul-Exporte dort ab.

/* ══════════════════════════════════════════════════════════════════════════
 * 1) DESIGN-TOKENS — gelten für ALLE Gutachten-Grafiken
 * ═══════════════════════════════════════════════════════════════════════ */
export const GG_THEME = {
  width: 1000,                       // = 16 cm Word-Textbreite
  bg: '#ffffff',
  font: '"Segoe UI", Arial, Helvetica, sans-serif',

  text:      { strong: '#1f2933', muted: '#6b7480' },
  neutral:   { cardBg: '#ffffff', cardLine: '#e6e8eb', band: '#eff1f3',
               ring: '#c6cbd1', icon: '#6b7480', halo: '#f2f4f6' },
  boxLine:   '#e3e6ea',

  accents: {
    blue:  { solid: '#2f6fe4', dark: '#1f5fc4', soft: '#dce8fb',
             cardBg: '#f2f6fe', cardLine: '#d8e4fa', halo: '#e7effd', rule: '#bcd2f7' },
    green: { solid: '#4e9f4a', dark: '#3d8b3a', soft: '#e2f0dc',
             cardBg: '#f3f9f0', cardLine: '#dcebd6', halo: '#e9f4e4', rule: '#c3e0b8' },
  },

  section: { titleSize: 21, titleY: 26, ruleY: 62, ruleWidthPct: 0.58, ruleMax: 380 },
  group:   { top: 100, pad: 14, gap: 18, radius: 12, pillH: 30, pillGap: 12, pillSize: 13 },
  card:    { h: 152, gap: 10, radius: 8, footerH: 34, labelSize: 11.5,
             iconSize: 26, iconCy: 50, halo: true, haloR: 19 },
  pad:     { bottom: 10 },
};

/* ══════════════════════════════════════════════════════════════════════════
 * 2) ICON-BIBLIOTHEK — 24×24, strichbasiert, Farbe wird übergeben
 * ═══════════════════════════════════════════════════════════════════════ */
const DROP = 'M12 3.2C12 3.2 5.2 11 5.2 14.8a6.8 6.8 0 0 0 13.6 0C18.8 11 12 3.2 12 3.2Z';

export const GG_ICONS = {
  oil: c => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="1.5"/>
             <path d="M12 10.2c0 0-2.5 2.9-2.5 4.3a2.5 2.5 0 0 0 5 0c0-1.4-2.5-4.3-2.5-4.3Z" fill="${c}"/>`,
  gas: c => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="1.5"/>
             <path d="M12 8.6c.4 1.6 1.2 2.5 2 3.3.7.7 1.1 1.6 1.1 2.5a3.1 3.1 0 0 1-6.2 0c0-1.2.6-2.1 1.4-2.9.2.5.5.9.9 1.1 0-1.4.3-2.7.8-4Z" fill="${c}"/>`,
  wood: c => `<g transform="rotate(-22 12 12)" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round">
                <path d="M7.5 8h9.5a4 4 0 0 1 0 8H7.5"/>
                <ellipse cx="7.5" cy="12" rx="2.1" ry="4"/>
                <ellipse cx="7.5" cy="12" rx="0.9" ry="1.8"/>
                <path d="M13 8.6v6.8M16 8.9v6.2"/>
              </g>`,
  bioliquid: c => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="1.5"/>
             <path d="M12 8.4v9.2M12 12.8c1.7-.5 2.7-1.7 3.1-3.1M12 15.1c-1.5-.4-2.4-1.4-2.8-2.6"
                   fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  biogas: c => `<path d="M7.6 17.8h9.1a3.5 3.5 0 0 0 .4-7 5.1 5.1 0 0 0-9.8-1.2 4.1 4.1 0 0 0 .3 8.2Z"
                   fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`,
  air: c => `<g fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round">
               <path d="M3.5 9h8.2a2.2 2.2 0 1 0-2.2-2.2"/>
               <path d="M3.5 13h10.6a2.4 2.4 0 1 1-2.4 2.4"/>
               <path d="M3.5 17h6.4"/>
             </g>`,
  geo: c => `<g fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round">
               <circle cx="12" cy="15" r="6.2"/>
               <path d="M5.9 14.2h12.2M12 8.8c1.9 2 1.9 10.4 0 12.4M12 8.8c-1.9 2-1.9 10.4 0 12.4"/>
               <path d="M8.6 6.6q1.1-1 0-2t0-2M12 6.6q1.1-1 0-2t0-2M15.4 6.6q1.1-1 0-2t0-2"/>
             </g>`,
  sun: c => `<g fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round">
               <circle cx="12" cy="12" r="4"/>
               <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6
                        M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"/>
             </g>`,
  wind: c => `<g fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round">
                <path d="M12 21.2v-8.6M9.6 21.2h4.8"/>
                <path d="M12 11.4V4.2M13.3 13.2l6.2 3.4M10.7 13.2l-6.2 3.4"/>
                <circle cx="12" cy="12.2" r="1.2" fill="${c}" stroke="none"/>
              </g>`,
  water: c => `<path d="${DROP}" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  waste: c => `<g fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round">
                 <path d="M3.4 20.2v-8.4l4.6 2.9v-2.9l4.6 2.9V9.4h6.9v10.8Z"/>
                 <path d="M16.6 9.4V5.9h2.9v3.5"/>
               </g>`,
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3) RENDERER — „Status-Matrix": Gruppen aus Kacheln mit Haken/Kreis
 * ═══════════════════════════════════════════════════════════════════════ */
const GG_NS = 'http://www.w3.org/2000/svg';
const gEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const gR = n => Math.round(n * 100) / 100;

export function ggRenderStatusMatrix(cfg, T = GG_THEME) {
  const groups = cfg.groups;
  const nCards = groups.reduce((s, g) => s + g.items.length, 0);
  const nGaps  = groups.reduce((s, g) => s + g.items.length - 1, 0);

  // Kartenbreite so, dass alle Gruppen zusammen exakt die Zielbreite füllen
  const chrome = (groups.length - 1) * T.group.gap + groups.length * 2 * T.group.pad + nGaps * T.card.gap;
  const cw = (T.width - chrome) / nCards;

  const cardsTop = T.group.top + T.group.pad + T.group.pillH + T.group.pillGap;
  const groupH   = T.group.pad + T.group.pillH + T.group.pillGap + T.card.h + T.group.pad;
  const height   = T.group.top + groupH + T.pad.bottom;

  let x = 0;
  const geo = groups.map(g => {
    const w = g.items.length * cw + (g.items.length - 1) * T.card.gap + 2 * T.group.pad;
    const box = { x, w };
    x += w + T.group.gap;
    return box;
  });

  let out = `<rect x="0" y="0" width="${T.width}" height="${gR(height)}" fill="${T.bg}"/>`;

  // ── Abschnitts-Überschriften (spannen über eine oder mehrere Gruppen) ──
  for (const sec of cfg.sections) {
    const a  = T.accents[sec.accent];
    const x0 = geo[sec.groups[0]].x;
    const g1 = geo[sec.groups[sec.groups.length - 1]];
    const cx = (x0 + g1.x + g1.w) / 2;
    const span = (g1.x + g1.w) - x0;

    out += `<text x="${gR(cx)}" y="${T.section.titleY}" text-anchor="middle"
              font-family='${T.font}' font-size="${T.section.titleSize}" font-weight="600"
              fill="${a.dark}">${gEsc(sec.title)}</text>`;

    const rw = Math.min(span * T.section.ruleWidthPct, T.section.ruleMax);
    const rx0 = cx - rw / 2, rx1 = cx + rw / 2, ry = T.section.ruleY;
    out += `<line x1="${gR(rx0)}" y1="${ry}" x2="${gR(rx1)}" y2="${ry}" stroke="${a.rule}" stroke-width="1.6"/>
            <line x1="${gR(cx - rw * 0.2)}" y1="${ry}" x2="${gR(cx + rw * 0.2)}" y2="${ry}" stroke="${a.solid}" stroke-width="3" stroke-linecap="round"/>
            <circle cx="${gR(rx0)}" cy="${ry}" r="3.4" fill="${a.solid}"/>
            <circle cx="${gR(rx1)}" cy="${ry}" r="3.4" fill="${a.solid}"/>`;
  }

  // ── Gruppen + Kacheln ──
  groups.forEach((g, gi) => {
    const a = T.accents[g.accent];
    const { x: gx, w: gw } = geo[gi];

    out += `<rect x="${gR(gx)}" y="${T.group.top}" width="${gR(gw)}" height="${gR(groupH)}"
              rx="${T.group.radius}" fill="#fff" stroke="${T.boxLine}" stroke-width="1"/>`;

    const px = gx + T.group.pad, pw = gw - 2 * T.group.pad, py = T.group.top + T.group.pad;
    out += `<rect x="${gR(px)}" y="${py}" width="${gR(pw)}" height="${T.group.pillH}" rx="6" fill="${a.soft}"/>
            <text x="${gR(px + pw / 2)}" y="${py + T.group.pillH / 2 + 4.5}" text-anchor="middle"
              font-family='${T.font}' font-size="${T.group.pillSize}" font-weight="600"
              fill="${a.dark}">${gEsc(g.title)}</text>`;

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

function ggCard(it, x, y, w, a, T) {
  const on = it.state === 'on';
  const C  = T.card;
  const bg   = on ? a.cardBg   : T.neutral.cardBg;
  const line = on ? a.cardLine : T.neutral.cardLine;
  const icon = on ? a.solid    : T.neutral.icon;
  const halo = on ? a.halo     : T.neutral.halo;
  const band = on ? a.solid    : T.neutral.band;
  const txt  = on ? T.text.strong : T.text.muted;

  const h = C.h, R = C.radius, fT = h - C.footerH;   // Oberkante Fußband
  let s = `<g transform="translate(${gR(x)},${y})">`;

  s += `<rect x="0" y="0" width="${gR(w)}" height="${h}" rx="${R}" fill="${bg}" stroke="${line}" stroke-width="1"/>`;
  // Fußband: nur unten abgerundet
  s += `<path d="M0 ${fT} H${gR(w)} V${h - R} a${R} ${R} 0 0 1 -${R} ${R} H${R} a${R} ${R} 0 0 1 -${R} -${R} Z" fill="${band}"/>`;

  const icx = w / 2;
  if (C.halo) s += `<circle cx="${gR(icx)}" cy="${C.iconCy}" r="${C.haloR}" fill="${halo}"/>`;
  const k = C.iconSize / 24;
  s += `<g transform="translate(${gR(icx - C.iconSize / 2)},${gR(C.iconCy - C.iconSize / 2)}) scale(${gR(k)})">`
     + (GG_ICONS[it.icon] ? GG_ICONS[it.icon](icon) : '') + `</g>`;

  const lines = Array.isArray(it.label) ? it.label : [it.label];
  const base = lines.length > 1 ? fT - 26 : fT - 15;
  lines.forEach((ln, i) => {
    s += `<text x="${gR(icx)}" y="${gR(base + i * 14)}" text-anchor="middle"
            font-family='${T.font}' font-size="${C.labelSize}" fill="${txt}">${gEsc(ln)}</text>`;
  });

  const my = fT + C.footerH / 2;
  if (on) {
    s += `<circle cx="${gR(icx)}" cy="${gR(my)}" r="9.5" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.55"/>
          <path d="M${gR(icx - 4.6)} ${gR(my)} l3.2 3.3 6-6.4" fill="none" stroke="#fff"
            stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    s += `<circle cx="${gR(icx)}" cy="${gR(my)}" r="9.5" fill="none" stroke="${T.neutral.ring}" stroke-width="1.5"/>`;
  }
  return s + '</g>';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4) EXPORT — PNG in die Zwischenablage / PNG + SVG als Datei
 * ═══════════════════════════════════════════════════════════════════════ */
export function ggSvgSource(svg) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
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
        { title: 'Energieträger',  accent: 'blue',  groups: [0, 1] },
        { title: 'Energiequellen', accent: 'green', groups: [2] },
      ],
      groups: [
        { title: 'fossile', accent: 'blue', items: [
          { key: 'heizoel', label: ['Heizöl EL'], icon: 'oil', state: 'on' },
          { key: 'erdgas',  label: ['Erdgas'],    icon: 'gas', state: 'on' },
        ]},
        { title: 'regenerative', accent: 'green', items: [
          { key: 'biofest',  label: ['Feste', 'Biomasse'],      icon: 'wood',      state: 'on'  },
          { key: 'bioliquid',label: ['Flüssige', 'Biomasse'],   icon: 'bioliquid', state: 'off' },
          { key: 'biogas',   label: ['gasförmige', 'Biomasse'], icon: 'biogas',    state: 'off' },
        ]},
        { title: 'Natürliche regenerative', accent: 'green', items: [
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
];

/* ══════════════════════════════════════════════════════════════════════════
 * 6) PANEL — Analyse-Sektion „Gutachten-Grafiken"
 * ═══════════════════════════════════════════════════════════════════════ */
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

export function ggShowSection(visible) {
  const wrap = document.getElementById('analyse-ggrafik-wrap');
  if (!wrap) return;
  wrap.style.display = visible ? '' : 'none';
  if (visible) ggRenderPanel();
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
    _gg.svg.style.height = 'auto';
    _gg.svg.style.display = 'block';
    paper.replaceChildren(_gg.svg);
  }

  // ── Optionen: Zustände je Kachel ──
  const opt = document.getElementById('gg-optionen');
  if (opt) {
    let html = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">Zustände</div>`;
    if (typeof figur.ausProjekt === 'function') {
      html += `<button data-click="ggSyncFromProject()" style="font-family:inherit;font-size:10px;padding:3px 9px;border-radius:4px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);">⟳ Aus Projekt übernehmen</button>`;
    }
    html += `</div><div style="display:flex;flex-wrap:wrap;gap:5px 16px;">`;
    figur.config.groups.forEach((g, gi) => g.items.forEach((it, ii) => {
      html += `<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;">
          <input type="checkbox"${it.state === 'on' ? ' checked' : ''} data-change="ggToggleItem(${gi},${ii},this.checked)">
          ${gEsc(Array.isArray(it.label) ? it.label.join(' ') : it.label)}</label>`;
    }));
    opt.innerHTML = html + `</div>`;
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
  ggRenderPanel();
  ggSay('');
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
  const zustand = figur.ausProjekt();
  let n = 0;
  for (const g of figur.config.groups) {
    for (const it of g.items) {
      if (it.key in zustand) { it.state = zustand[it.key] ? 'on' : 'off'; n++; }
    }
  }
  ggRenderPanel();
  ggSay(`✓ ${n} Kacheln aus dem Projektstand gesetzt. Nicht modellierte Träger (flüssige/gasförmige Biomasse, Abwärme) bleiben leer.`);
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
