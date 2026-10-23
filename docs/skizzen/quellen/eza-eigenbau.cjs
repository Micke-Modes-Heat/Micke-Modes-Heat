// Erzeugt Prinzip-EZA-Regelkreis.svg und Prinzip-EZA-Eigenbau.svg im LKEBw-Stil
// Aufruf: node quellen/eza-eigenbau.cjs <Zielordner>   (über npm run skizzen)
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
if (!OUT) { console.error('Aufruf: node <erzeuger> <Zielordner>'); process.exit(1); }
// Logo wie im Tool (src/config/lkebw-logo.js)
const logo = fs.readFileSync(path.join(__dirname, '../../../src/config/lkebw-logo.js'), 'utf8')
  .match(/export const LKEBW_LOGO = '(data:image\/png;base64,[A-Za-z0-9+/=]+)'/)[1];

const F = 'Tahoma, Verdana, sans-serif';
const M = "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace";
const C = {
  bg: '#FAFAF8', g: '#266426', g2: '#3F9C3F', gl: '#EEF3EC', t: '#1B1F1C', s: '#5A5F5A',
  o: '#C8641E', ol: '#FBF1E8', b: '#2A64B4', bl: '#EEF2F9', l: '#8A8F8A', br: '#E2E4DF',
  r: '#B42318', rl: '#FCEDEC', gr: '#F2F3F0',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function T(x, y, s, o = {}) {
  const sz = o.size || 10.5;
  return `<text x="${x}" y="${y}" font-family="${o.mono ? M : F}" font-size="${sz}"` +
    (o.bold ? ' font-weight="700"' : '') + (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
    (o.ls ? ` letter-spacing="${o.ls}"` : '') + ` fill="${o.fill || C.s}">${esc(s)}</text>`;
}
function TL(x, y, lines, o = {}) {
  const lh = o.lh || (o.size || 10.5) * 1.4;
  return lines.map((l, i) => (typeof l === 'object' ? T(x, y + i * lh, l.t, { ...o, ...l }) : T(x, y + i * lh, l, o))).join('');
}
function R(x, y, w, h, o = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 2}" fill="${o.fill || '#fff'}" stroke="${o.stroke || C.t}" stroke-width="${o.sw || 1.2}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + (o.op ? ` fill-opacity="${o.op}"` : '') + '/>';
}
function P(d, o = {}) {
  return `<path d="${d}" fill="${o.fill || 'none'}" stroke="${o.stroke || C.t}" stroke-width="${o.sw || 1.6}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + (o.end ? ` marker-end="url(#${o.end})"` : '') +
    (o.start ? ` marker-start="url(#${o.start})"` : '') + ' stroke-linejoin="round"/>';
}
function badge(cx, cy, n, fill = C.r) {
  return `<circle cx="${cx}" cy="${cy}" r="7.5" fill="${fill}"/>` + T(cx, cy + 3.5, n, { size: 9.5, bold: true, anchor: 'middle', fill: '#fff' });
}
function wrap(text, max) {
  const out = []; let cur = '';
  for (const w of text.split(' ')) {
    if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}
function marker(id, col) {
  return `<marker id="${id}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="${col}"/></marker>`;
}
function frame(W, H, kicker, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>` +
    marker('aI', C.t) + marker('aB', C.b) + marker('aO', C.o) + marker('aR', C.r) + '</defs>' +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/><rect x="0" y="0" width="${W}" height="5" fill="${C.g}"/>` +
    `<line x1="0" y1="75.5" x2="${W}" y2="75.5" stroke="${C.br}" stroke-width="1"/><line x1="824.5" y1="5" x2="824.5" y2="75" stroke="${C.br}" stroke-width="1"/>` +
    T(28, 29.38, kicker, { mono: true, size: 11, fill: C.g2, ls: 1.76 }) +
    T(28, 56.38, title, { size: 21, bold: true, fill: C.t }) +
    `<image href="${logo}" x="848" y="21" width="128" height="38"/>` + body + '</svg>';
}
function legend(y, items) {
  let x = 28, s = '';
  for (const it of items) {
    s += P(`M${x} ${y} h26`, { stroke: it.c, sw: it.w, dash: it.dash });
    s += T(x + 34, y + 4, it.t, { size: 11, fill: C.t });
    x += 34 + it.t.length * 6.3 + 22;
  }
  return s;
}
// Regelblock: Titel fett, darunter bis zu zwei Zeilen (zweite optional Formel in Mono)
function block(x, y, w, h, title, lines = [], o = {}) {
  const cx = x + w / 2;
  let s = R(x, y, w, h, { stroke: o.stroke || C.o, sw: 1.3, fill: o.fill });
  s += T(cx, y + 19, title, { size: 11, bold: true, anchor: 'middle', fill: C.t });
  lines.forEach((l, i) => {
    const mono = typeof l === 'object';
    s += T(cx, y + 35 + i * 14, mono ? l.t : l, { size: 10, anchor: 'middle', mono, fill: mono ? C.t : C.s });
  });
  return s;
}
// Aufzählung mit hängendem Einzug; gap = Abstand zwischen Punkten
function bullets(x, y, items, max, gap = 5) {
  let s = '', yy = y;
  for (const it of items) {
    wrap(it, max).forEach((l, k) => { s += T(x + (k ? 10 : 0), yy, (k ? '' : '• ') + l, { size: 10.5, fill: C.t }); yy += 14; });
    yy += gap;
  }
  return s;
}
function sumPoint(cx, cy) {
  return `<circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="${C.t}" stroke-width="1.3"/>` +
    P(`M${cx - 6} ${cy} H${cx + 6} M${cx} ${cy - 6} V${cy + 6}`, { sw: 1.1 });
}
const arrow = (d, col = C.t, sw = 1.2) => P(d, { stroke: col, sw, end: col === C.o ? 'aO' : col === C.r ? 'aR' : col === C.b ? 'aB' : 'aI' });

// ───────────────────── 1 · Regelkreis, Zeitkette, Anforderungen ─────────────────────
function svgRegelkreis() {
  const W = 1000, H = 1250;
  let b = R(20, 90, 960, 615, { fill: '#fff', stroke: C.br, sw: 1, rx: 0 });
  b += T(34, 110, 'A · Regelstruktur am Netzanschlusspunkt', { size: 12.5, bold: true, fill: C.t });

  // Sollwertquellen
  b += T(34, 160, 'Sollwertquellen', { size: 10, fill: C.l });
  const src = [
    ['1', C.o, 'Netzbetreiber', 'P-Grenze in % (IEC 104)'],
    ['2', C.s, 'Direktvermarkter', 'P-Sollwert (Steuerbox)'],
    ['3', C.o, 'Anschlussgrenze', 'P_AV,E parametriert'],
    ['4', C.g, 'EMS (optional)', 'Wunsch-Sollwert'],
  ];
  src.forEach(([n, col, h, sub], i) => {
    const y = 172 + i * 52;
    b += R(34, y, 156, 44, { stroke: col, sw: 1.3 }) + badge(47, y + 14, n, col) +
      T(61, y + 18, h, { size: 11, bold: true, fill: C.t }) + T(47, y + 35, sub, { size: 10 });
    b += arrow(`M190 ${y + 22} H219`);
  });
  b += R(34, 406, 156, 44, { stroke: C.o, sw: 1.3 }) + badge(47, 420, '1', C.o) +
    T(61, 424, 'Netzbetreiber', { size: 11, bold: true, fill: C.t }) + T(47, 441, 'Q-Verfahren, Sollwert', { size: 10 });
  b += arrow('M190 428 H219');

  // EZA-Regler-Rahmen
  b += R(205, 118, 590, 442, { fill: C.ol, stroke: C.o, sw: 1.8, rx: 3 });
  b += T(220, 140, 'EZA-Regler (Eigenbau)', { size: 13, bold: true, fill: C.t });
  b += T(220, 156, 'alles in diesem Rahmen gehört zum Komponentenzertifikat', { size: 10 });

  // P-Pfad
  b += R(220, 172, 95, 200, { stroke: C.t, sw: 1.3 });
  b += TL(267.5, 194, [{ t: 'Vorrang-' }, { t: 'auswahl' }], { size: 11.5, bold: true, anchor: 'middle', fill: C.t, lh: 15 });
  b += T(267.5, 236, 'P* = min(1…4)', { size: 9.5, mono: true, anchor: 'middle', fill: C.t });
  b += TL(267.5, 262, ['kleinster', 'Wert gewinnt'], { size: 10, anchor: 'middle', lh: 13 });
  b += TL(267.5, 312, ['1 und 2 als', 'getrennte', 'Schnittstellen'], { size: 10, anchor: 'middle', lh: 13 });
  b += arrow('M315 204 H334');
  b += block(335, 172, 105, 64, 'Rampe', ['dP/dt begrenzt', { t: '0,33…0,66 %/s' }]);
  b += arrow('M440 204 H458');
  b += sumPoint(470, 204) + T(452, 196, '+', { size: 11, fill: C.t }) + T(476, 230, '−', { size: 12, fill: C.t });
  b += arrow('M470 262 V216') + T(470, 276, 'P_NAP', { size: 10, mono: true, anchor: 'middle', fill: C.t });
  b += arrow('M481 204 H499');
  b += block(500, 172, 105, 64, 'PI-Regler P', ['Anti-Windup,', { t: '0 … P_verf' }]);
  b += arrow('M605 204 H624');

  // Q-Pfad
  b += block(220, 396, 100, 64, 'Q-Verfahren', ['Q(U) · Q(P)', 'Q fest · cos φ']);
  b += arrow('M270 482 V461') + T(278, 481, 'U_NAP, P_NAP', { size: 9.5, mono: true, fill: C.t });
  b += arrow('M320 428 H334');
  b += block(335, 396, 105, 64, 'Führungs-PT1', ['Sollwert-Dynamik', { t: '3τ = 6…60 s' }]);
  b += arrow('M440 428 H458');
  b += sumPoint(470, 428) + T(452, 420, '+', { size: 11, fill: C.t }) + T(476, 404, '−', { size: 12, fill: C.t });
  b += arrow('M470 370 V416') + T(470, 362, 'Q_NAP', { size: 10, mono: true, anchor: 'middle', fill: C.t });
  b += arrow('M481 428 H499');
  b += block(500, 396, 105, 64, 'PI-Regler Q', ['Anti-Windup,', 'Freeze bei Fehler']);
  b += arrow('M605 428 H624');

  // Aufteilung
  b += R(625, 172, 155, 288, { stroke: C.o, sw: 1.3 });
  b += TL(702.5, 290, [{ t: 'Aufteilung' }, { t: 'auf die EZE' }], { size: 11.5, bold: true, anchor: 'middle', fill: C.t, lh: 15 });
  b += TL(702.5, 330, ['nach verfügbarer', 'Leistung, Grenzen', 'je Einheit; fällt', 'eine EZE aus, regeln', 'die übrigen nach'], { size: 10, anchor: 'middle', lh: 13 });
  b += T(632, 208, 'P*', { size: 10, mono: true, fill: C.t }) + T(632, 432, 'Q*', { size: 10, mono: true, fill: C.t });

  // Überwachung
  b += R(220, 492, 560, 56, { stroke: C.o, sw: 1.3 });
  b += T(232, 510, 'Überwachung · Rückfall · Protokoll', { size: 11, bold: true, fill: C.t });
  b += T(232, 526, '• Watchdog je Schnittstelle (NB, DV, Messung, EZE) → Rückfallwert nach Abfragebogen des NB', { size: 10 });
  b += T(232, 540, '• Logbuch der Abregelungen ≥ 18 Monate · Zeitstempel über NTP · Quittung und Ist-Werte an NB und DV', { size: 10 });

  // Erzeugungseinheiten rechts
  b += T(815, 165, 'Erzeugungseinheiten', { size: 11, bold: true, fill: C.t });
  b += T(800, 190, 'Modbus TCP / SunSpec', { size: 10, fill: C.o });
  b += R(815, 200, 145, 60, { fill: C.gr }) + T(887.5, 224, 'PV-Wechselrichter', { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(887.5, 241, 'P-Grenze, Q-Sollwert', { size: 10, anchor: 'middle' });
  b += R(815, 288, 145, 60, { fill: C.gr }) + T(887.5, 312, 'Batterie-Umrichter', { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(887.5, 329, 'P ±, Q-Sollwert', { size: 10, anchor: 'middle' });
  b += arrow('M780 230 H813', C.o, 1.8) + arrow('M780 318 H813', C.o, 1.8);
  b += R(815, 370, 145, 110, { fill: C.gr, stroke: C.l, dash: '4 3' });
  b += T(827, 388, 'Bleibt in der EZE', { size: 11, bold: true, fill: C.t });
  b += TL(827, 405, ['P(f) bei Über- und', 'Unterfrequenz', 'FRT, dyn. Stützung', 'innere Stromregelung', '→ vom EZA-Regler', 'nicht übersteuern'], { size: 10, lh: 12.6 });

  // Elektrischer Teil unten
  b += R(34, 638, 110, 44, { stroke: '#0000FF', dash: '4 3' }) + T(89, 656, 'Netz', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(89, 670, 'MS 20 kV', { size: 10, anchor: 'middle' });
  b += P('M144 660 H686', { sw: 1.6 }) + P('M720 660 H970 V231', { sw: 1.6 }) + P('M960 230 H970 M960 318 H970', { sw: 1.6 });
  b += `<circle cx="696" cy="660" r="10" fill="#fff" stroke="${C.t}" stroke-width="1.4"/><circle cx="710" cy="660" r="10" fill="none" stroke="${C.t}" stroke-width="1.4"/>`;
  b += T(703, 688, 'Trafo', { size: 10, anchor: 'middle' });
  b += P('M190 628 V696', { stroke: C.l, sw: 1.2, dash: '5 4' }) + T(196, 694, 'NAP', { size: 10.5, bold: true, fill: C.t });
  b += R(223, 653, 14, 14, { rx: 0, sw: 1.4 }) + P('M223 653 L237 667 M237 653 L223 667', { sw: 1 }) + T(230, 646, 'Übergabe-LS', { size: 10, anchor: 'middle' });
  b += R(262, 670, 84, 24, { fill: C.rl, stroke: C.r, sw: 1.3 }) + T(304, 686, 'NA-Schutz', { size: 10.5, bold: true, anchor: 'middle', fill: C.t });
  b += P('M262 682 H230 V669', { stroke: C.r, sw: 1.3, dash: '4 3', end: 'aR' });
  b += `<circle cx="470" cy="660" r="9" fill="#fff" stroke="${C.t}" stroke-width="1.4"/>` + T(484, 680, 'Wandler', { size: 10 });
  b += arrow('M470 651 V629');
  b += R(375, 580, 190, 48) + T(470, 598, 'Messumformer NAP', { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(470, 614, 'P, Q, U, f · Mittelung 200 ms', { size: 10, anchor: 'middle' });
  b += arrow('M470 580 V562');
  b += T(578, 600, 'Istwerte an Regler', { size: 10 }) + T(578, 613, 'und Fernwirkgerät', { size: 10 });

  // B · Zeitkette
  b += T(28, 740, 'B · Zeitkette eines Regelzyklus', { size: 13.5, bold: true, fill: C.t });
  b += T(28, 756, 'Auslegungsrichtwerte, keine Normwerte. Die ganze Kette muss deutlich schneller sein als die geforderte Einschwingzeit.', { size: 10, fill: C.l });
  const steps = [
    ['Messen', 'Mittelung ≈ 200 ms', '(10/12 Netzperioden)'],
    ['Rechnen', 'Regelzyklus', '100…200 ms'],
    ['Senden', 'Modbus an alle EZE', '0,1…1 s je Anzahl'],
    ['EZE stellt ein', 'Reaktionszeit laut', 'Einheitenzertifikat'],
    ['Wirkung am NAP', 'neuer Messwert', '→ nächster Zyklus'],
  ];
  steps.forEach(([h, a, c], i) => {
    const x = 28 + i * 182, w = i === 4 ? 216 : 170;
    b += R(x, 772, w, 54, { stroke: i === 4 ? C.l : C.o, sw: 1.3, fill: i === 4 ? C.gr : '#fff' });
    b += T(x + 12, 790, h, { size: 11, bold: true, fill: C.t }) + T(x + 12, 806, a, { size: 10 }) + T(x + 12, 819, c, { size: 10 });
    if (i < 4) b += arrow(`M${x + w} 799 H${x + 181}`);
  });
  b += P('M28 836 V842 H744 V836', { sw: 1.1 });
  b += T(28, 858, 'Totzeit der Kette ≈ 0,5…2 s. Faustregeln: Abtastzeit ≤ τ/10; ein PI-Kreis mit Totzeit Tt wird kaum schneller als ≈ 3·Tt.', { size: 10.5, fill: C.t });
  b += T(760, 858, 'gefordert zum Vergleich:', { size: 10 }) + T(760, 872, 'Q: 3τ = 6…60 s · P: 2,5…5 min', { size: 10.5, bold: true, fill: C.t });
  b += T(28, 886, 'Fernwirken (Beispiel TEN): Befehle gelten bis zum nächsten Telegramm, kein Selbst-Rücksetzen; Messwerte spontan ab 1 % Änderung,', { size: 10 });
  b += T(28, 900, 'höchstens 1 Telegramm/s; bei gestörter Messung Qualitätsbits statt Ersatzwerten.', { size: 10 });

  // C · Anforderungen als Verläufe
  // links: Q-Sprung
  b += T(28, 935, 'C · Blindleistung: Sollwertsprung am NAP', { size: 13.5, bold: true, fill: C.t });
  b += T(28, 951, 'PT1-Verhalten, 3τ vom NB vorgegeben (6…60 s), stationär ±2 % P_AV, gedämpft', { size: 10, fill: C.l });
  b += arrow('M70 1120 V972', C.t, 1.2) + arrow('M70 1120 H468', C.t, 1.2);
  b += T(62, 980, 'Q', { size: 11, bold: true, anchor: 'end', fill: C.t }) + T(466, 1136, 't', { size: 11, bold: true, fill: C.t });
  b += R(110, 992, 340, 16, { fill: C.ol, stroke: C.o, sw: 0.8, dash: '3 2' }) + T(446, 988, '±2 % P_AV', { size: 10, anchor: 'end', fill: C.o });
  b += P('M70 1110 H110 V1000 H450', { stroke: C.s, sw: 1.2, dash: '5 4' }) + T(116, 986, 'Sollwert Q*', { size: 10 });
  let pts = [];
  for (let x = 110; x <= 450; x += 4) pts.push(`${x},${(1110 - 110 * (1 - Math.exp(-(x - 110) / 50))).toFixed(1)}`);
  b += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.o}" stroke-width="2.2"/>`;
  b += P('M260 1120 V1005', { stroke: C.l, sw: 1, dash: '3 3' }) + T(260, 1134, '3τ', { size: 10.5, bold: true, anchor: 'middle', fill: C.t }) + T(110, 1134, '0', { size: 10, anchor: 'middle' });
  b += T(268, 1030, '95 % erreicht', { size: 10, fill: C.t }) + T(300, 1080, 'Istwert Q am NAP', { size: 10, fill: C.o });

  // rechts: P-Rampe
  b += T(520, 935, 'Wirkleistung: Begrenzung durch den NB', { size: 13.5, bold: true, fill: C.t });
  b += T(520, 951, 'Rampe 0,33…0,66 % P_b,inst/s, stationär ±5 %; DV-Vorgaben dürfen bis 15 min dauern', { size: 10, fill: C.l });
  b += arrow('M560 1120 V972', C.t, 1.2) + arrow('M560 1120 H962', C.t, 1.2);
  b += T(552, 980, 'P', { size: 11, bold: true, anchor: 'end', fill: C.t }) + T(960, 1136, 't', { size: 11, bold: true, fill: C.t });
  b += `<polygon points="600,990 750,1100 900,1100" fill="${C.ol}" stroke="none"/>`;
  b += P('M600 990 L750 1100', { stroke: C.o, sw: 1.1, dash: '4 3' }) + P('M600 990 L900 1100', { stroke: C.o, sw: 1.1, dash: '4 3' });
  b += R(750, 1094, 200, 12, { fill: C.ol, stroke: C.o, sw: 0.8, dash: '3 2' });
  b += P('M560 990 H600 V1100 H950', { stroke: C.s, sw: 1.2, dash: '5 4' });
  b += P('M600 990 L810 1100 H950', { stroke: C.o, sw: 2.2 });
  b += T(552, 994, '100 %', { size: 10, anchor: 'end' }) + T(552, 1104, '0 %', { size: 10, anchor: 'end' });
  b += T(600, 1134, '0', { size: 10, anchor: 'middle' }) + T(750, 1134, '2,5 min', { size: 10, anchor: 'middle', fill: C.t }) + T(900, 1134, '5 min', { size: 10, anchor: 'middle', fill: C.t });
  b += T(612, 1088, 'zu schnell', { size: 10 }) + T(858, 1040, 'zu langsam', { size: 10 }) + T(828, 1088, 'zulässig', { size: 10, bold: true, anchor: 'middle', fill: C.o });
  b += T(650, 994, 'NB-Befehl 100 % → 0 % bei t = 0', { size: 10 });

  b += legend(1162, [
    { c: C.t, w: 1.6, t: 'MS-Leitung' }, { c: C.t, w: 1.2, t: 'Signal im Regler' },
    { c: C.o, w: 2, t: 'Stellgröße an die EZE' }, { c: C.r, w: 1.4, dash: '4 3', t: 'Schutzauslösung' }, { c: C.l, w: 1.2, dash: '5 4', t: 'Bilanzgrenze' },
  ]);
  b += T(28, 1192, 'Struktur nach dem generischen Parkreglermodell REPC_A (WECC 2014; Pourbeik u. a., IEEE Trans. Energy Conversion 2017). Werte nach VDE-AR-N 4110:2018-11', { size: 10, fill: C.l });
  b += T(28, 1206, 'in der Darstellung von meteocontrol und M.O.E. (2018) sowie Netzrichtlinie TAR MS der Thüringer Energienetze (03/2024). Maßgeblich sind die beim Netzanschluss-', { size: 10, fill: C.l });
  b += T(28, 1220, 'begehren gültige Fassung der VDE-AR-N 4110 (Überarbeitung in Arbeit), TAB und Abfragebogen des Netzbetreibers. Prinzipskizze ohne Auslegung.', { size: 10, fill: C.l });
  return frame(W, H, 'GUTACHTEN · GEBÄUDEAUTOMATION · EZA-REGLER IM EIGENBAU', 'EZA-Regler: Regelkreis, Zeitkette und Anforderungen', b);
}

// ───────────────────── 2 · Arbeitspakete und Nachweisweg ─────────────────────
function svgEigenbau() {
  const W = 1000, H = 1004;
  let b = T(28, 104, 'Sechs Arbeitspakete. Alles, was zum Regler gehört, ist Teil des Komponentenzertifikats – auch Software, die man nur anpasst.', { size: 10.5, fill: C.t });
  const cards = [
    ['Messung & Gerät', 'Hardware in der Übergabestation', [
      'Wandler am NAP, Messkern Kl. 0,5 (≤ 1 MVA) bzw. 0,2 (> 1 MVA), Beispiel TEN',
      'Messumformer dreiphasig: P, Q, U, I, f; Mittelung ≈ 200 ms',
      'Industriesteuerung (SPS oder IPC) mit USV, für die Umgebung der Station',
      'Zeitsynchronisation über NTP, Zeitstempel in Millisekunden',
      'Plausibilisierung: Messausfall erkennen, Qualitätsbits setzen',
    ]],
    ['Regelkern Wirkleistung', 'P am NAP', [
      'Vorrangauswahl: kleinster Sollwert aus NB, DV, Anschlussgrenze, EMS',
      'Rampe 0,33…0,66 % P_b,inst/s für NB-Vorgaben; DV-Vorgaben bis 15 min',
      'PI-Regler mit Anti-Windup, stationär ±5 % P_AV',
      'Aufteilung auf die EZE nach verfügbarer Leistung; Ausfall einzelner EZE ausregeln',
      'Speicher: Laden und Entladen, Bezugsgrenze P_AV,B',
    ]],
    ['Regelkern Blindleistung', 'Q am NAP', [
      'Vier Verfahren: Q(U), Q(P) mit bis zu 10 Stützstellen, Q fest mit Spannungsbegrenzung, cos φ fest',
      'Verfahrenswechsel und Sollwerte per Fernwirkbefehl',
      'PT1-Verhalten, 3τ einstellbar 6…60 s, gedämpft; stationär ±2 % P_AV',
      'Q-Bereich bis cos φ 0,95 (Q = 0,33 P_b,inst ab 20 % Leistung); P darf zugunsten Q sinken',
      'Abstimmung mit Kompensation und anderen Reglern, kein Dauerschwingen',
    ]],
    ['Schnittstellen', 'nach außen und zu den EZE', [
      'IEC 60870-5-104-Unterstation nach Signalliste des NB, zwei Gegenstellen, VPN-Router des NB',
      'Befehle gelten bis zum nächsten Telegramm; Rückmeldung und Quittung je Sollwert',
      'Messwerte spontan ab 1 % Änderung, höchstens 1 Telegramm/s (Beispiel TEN)',
      'Schnittstelle zum DV getrennt von der des NB ausführen',
      'Modbus TCP / SunSpec zu Wechselrichtern verschiedener Hersteller und Firmwarestände',
    ]],
    ['Überwachung & Rückfall', 'Verhalten bei Störung', [
      'Watchdog je Schnittstelle: NB, DV, Messung, Verbindung zu den EZE',
      'Rückfallwerte nach Abfragebogen des NB, Grundeinstellung für den Erstanlauf',
      'Logbuch der Abregelungen mindestens 18 Monate, auf Anforderung an den NB',
      'Ereignisspeicher mit Zeitstempel, gesicherter Fernzugang für den Service',
      'IT-Sicherheit: netzrelevante Funktion als eigene Zone',
    ]],
    ['Nachweis & Betrieb', 'Zertifizierung und Pflege', [
      'Komponentenzertifikat: Produktzertifikat nach ISO/IEC 17067, höchstens 5 Jahre, überwacht',
      'Nachweis: Umsetzung der P/Q-Vorgaben, Verhalten bei Kommunikationsstörung, Reglerbeschreibung',
      'Validiertes RMS-Simulationsmodell (z. B. PowerFactory), Abweichung Messung ↔ Modell ≤ 5 % P_AV',
      'Messungen nach FGW TR 3, Modell nach TR 4, Bewertung nach TR 8',
      'Jede Änderung am Regelkern mit dem Zertifizierer abstimmen',
    ]],
  ];
  cards.forEach(([h, sub, items], i) => {
    const x = 28 + (i % 3) * 320, y = 118 + Math.floor(i / 3) * 262, w = 304;
    b += R(x, y, w, 248, { stroke: C.o, sw: 1.3 });
    b += R(x, y, w, 46, { fill: C.ol, stroke: C.o, sw: 1.3 });
    b += badge(x + 18, y + 17, String(i + 1), C.o) + T(x + 32, y + 21, h, { size: 12, bold: true, fill: C.t }) + T(x + 32, y + 37, sub, { size: 10 });
    b += bullets(x + 14, y + 66, items, 47);
  });

  // ab hier alles um 36 px nach oben, weil die Kacheln kürzer sind
  b += '<g transform="translate(0,-36)">';

  // Nachweisweg
  b += T(28, 706, 'Nachweisweg bis zum Netzanschluss', { size: 13.5, bold: true, fill: C.t });
  b += T(28, 722, 'Beim gekauften Regler liegen die Schritte 1 bis 4 beim Hersteller; beim Eigenbau trägt man sie selbst, für jeden Softwarestand.', { size: 10, fill: C.l });
  const path6 = [
    ['Entwicklung', 'Regelkern, Schnittstellen,', 'Dokumentation'],
    ['Messung', 'FGW TR 3, Sprung-', 'antworten im Prüflabor'],
    ['Simulationsmodell', 'FGW TR 4, RMS,', 'gegen Messung validiert'],
    ['Komponentenzert.', 'FGW TR 8,', 'Zertifizierungsstelle'],
    ['Anlagenzertifikat', 'ab 135 kW; vereinfacht', 'bis 950 kW'],
    ['Inbetriebnahme', 'Fernwirktest mit NB,', 'Konformitätserklärung'],
  ];
  path6.forEach(([h, a, c], i) => {
    const x = 28 + i * 158, own = i < 4;
    b += R(x, 736, 146, 62, { fill: own ? C.ol : C.gr, stroke: own ? C.o : C.l, sw: 1.3 });
    b += badge(x + 14, 751, String(i + 1), own ? C.o : C.s) + T(x + 27, 755, h, { size: 11, bold: true, fill: C.t });
    b += T(x + 10, 774, a, { size: 10 }) + T(x + 10, 788, c, { size: 10 });
    if (i < 5) b += arrow(`M${x + 146} 767 H${x + 157}`);
  });
  b += R(28, 808, 14, 10, { fill: C.ol, stroke: C.o, sw: 1 }) + T(48, 817, 'Eigenbau: selbst zu leisten', { size: 10, fill: C.t });
  b += R(220, 808, 14, 10, { fill: C.gr, stroke: C.l, sw: 1 }) + T(240, 817, 'in jedem Fall nötig', { size: 10, fill: C.t });

  // Abgrenzung und Einordnung
  b += R(28, 838, 456, 128, { fill: C.gr, stroke: C.l, dash: '4 3' });
  b += T(42, 858, 'Nicht Teil des EZA-Reglers', { size: 12, bold: true, fill: C.t });
  b += bullets(42, 878, [
    'NA-Schutz am Übergabe-Leistungsschalter (eigenes Schutzgerät)',
    'P(f), FRT und dynamische Netzstützung in jeder EZE (Einheitenzertifikat); dürfen nicht durch eine kundeneigene Regelung beeinflusst werden',
    'Abrechnungsmessung (RLM-Zähler)',
    'Fernwirkanbindung des NB (VPN-Router), Steuerbox des Direktvermarkters',
  ], 72, 1);
  b += R(516, 838, 456, 128, { fill: C.gl, stroke: C.g, sw: 1.4 });
  b += T(530, 858, 'Zur Einordnung', { size: 12, bold: true, fill: C.g });
  b += bullets(530, 878, [
    'Das Zertifikat hängt am Hard- und Softwarestand: Eigenbau heißt Pflege über die ganze Lebensdauer der Anlage',
    'Der Nachweis gilt nur für die geprüften Wechselrichtertypen',
    'Zertifizierte Parkregler bieten mehrere Hersteller an',
    'Sinnvoller Eigenanteil: EMS in der GLT, das nur Wünsche an den Regler meldet',
  ], 72, 1);

  b += T(28, 992, 'Quellen: VDE-AR-N 4110:2018-11 in der Darstellung von meteocontrol und M.O.E. (2018); Netzrichtlinie TAR MS der Thüringer Energienetze (03/2024, Beispielwerte); FGW TR 3/4/8.', { size: 10, fill: C.l });
  b += T(28, 1006, 'Maßgeblich sind die beim Netzanschlussbegehren gültige Fassung der VDE-AR-N 4110, TAB und Abfragebogen des Netzbetreibers sowie die aktuelle Revision der FGW-Richtlinien.', { size: 10, fill: C.l });
  b += '</g>';
  return frame(W, H, 'GUTACHTEN · GEBÄUDEAUTOMATION · EZA-REGLER IM EIGENBAU', 'Eigener EZA-Regler: was zu bauen und nachzuweisen ist', b);
}

fs.writeFileSync(path.join(OUT, 'Prinzip-EZA-Regelkreis.svg'), svgRegelkreis());
fs.writeFileSync(path.join(OUT, 'Prinzip-EZA-Eigenbau.svg'), svgEigenbau());
