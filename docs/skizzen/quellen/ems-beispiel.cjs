// Erzeugt Prinzip-EMS-Beispiel.svg im LKEBw-Stil (Schnittstelle EMS ↔ EZA-Regler an der Beispiel-Liegenschaft)
// Aufruf: node quellen/ems-beispiel.cjs <Zielordner>   (über npm run skizzen)
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
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '/>';
}
function P(d, o = {}) {
  return `<path d="${d}" fill="none" stroke="${o.stroke || C.t}" stroke-width="${o.sw || 1.6}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + (o.end ? ` marker-end="url(#${o.end})"` : '') +
    (o.start ? ` marker-start="url(#${o.start})"` : '') + ' stroke-linejoin="round"/>';
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
    if (it.sq) s += `<rect x="${x + 7}" y="${y - 6}" width="12" height="12" fill="${it.c}"/>`;
    else s += P(`M${x} ${y} h26`, { stroke: it.c, sw: it.w, dash: it.dash });
    s += T(x + 34, y + 4, it.t, { size: 11, fill: C.t });
    x += 34 + it.t.length * 6.3 + 22;
  }
  return s;
}
const de = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('de-DE');

function svgBeispiel() {
  const W = 1000, H = 1240;
  let b = R(20, 90, 960, 580, { fill: '#fff', stroke: C.br, sw: 1, rx: 0 });

  // ── extern
  b += R(40, 105, 186, 42, { stroke: C.l, dash: '4 3' }) + T(133, 123, 'Wetter-/Preisprognose', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(133, 137, 'Dienst, optional', { size: 10, anchor: 'middle' });
  b += R(690, 105, 130, 42, { stroke: C.l, dash: '4 3' }) + T(755, 123, 'Leitstelle NB', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(755, 137, 'Netzsicherheit', { size: 10, anchor: 'middle' });
  b += R(832, 105, 128, 42, { stroke: C.l, dash: '4 3' }) + T(896, 123, 'Direktvermarkter', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(896, 137, 'Marktsignal', { size: 10, anchor: 'middle' });
  b += P('M30 172 H970', { stroke: C.l, sw: 1.2, dash: '5 4' });
  b += T(400, 166, 'extern', { size: 10, anchor: 'middle', fill: C.l }) + T(400, 188, 'Liegenschaft · NAP 20 kV', { size: 10, anchor: 'middle', fill: C.l });
  b += P('M133 147 V199', { stroke: C.b, sw: 1.6, dash: '4 3', end: 'aB' }) + T(141, 163, 'HTTPS, Firewall', { size: 10, fill: C.b });
  b += P('M755 147 V199', { stroke: C.o, sw: 1.8, end: 'aO' }) + T(747, 163, 'IEC 104 · FWG', { size: 10, anchor: 'end', fill: C.o });
  b += P('M896 147 V199', { stroke: C.o, sw: 1.8, end: 'aO' }) + T(904, 163, 'Steuerbox', { size: 10, fill: C.o });

  // ── GLT mit EMS-Funktion
  b += R(30, 200, 280, 290, { fill: C.gl, stroke: C.g, sw: 1.6, rx: 3 }) + T(43, 219, 'Gebäudeleittechnik (GLT)', { size: 12, bold: true, fill: C.g });
  b += R(43, 230, 254, 160, { stroke: C.g2, sw: 1.4 }) + T(55, 249, 'EMS-Funktion', { size: 11.5, bold: true, fill: C.t });
  b += TL(55, 267, [
    'Zustände: Normal · Überschuss ·',
    'Spitzenlast · Netzengpass · Rückfall',
    { t: 'Spitzenkappung', bold: true, fill: C.t },
    'auf den gleitenden 15-min-Mittelwert,',
    'Ziel 1.500 kW: ein bei −3 %, aus bei −8 %',
    { t: 'Fahrplan', bold: true, fill: C.t },
    'je ¼ h aus PV-, Last- und Wärmeprognose',
  ], { size: 10, lh: 16.5 });
  b += R(43, 400, 254, 78, { stroke: C.g2, sw: 1.4 }) + T(55, 419, 'Bedienen & Beobachten', { size: 11.5, bold: true, fill: C.t });
  b += TL(55, 437, ['Handebene: EMS-Freigabe aus', 'Alarme, Heartbeat-Ausfall', 'Kennwerte für das Energiemanagement'], { size: 10, lh: 14 });

  // ── EZA-Regler
  b += R(690, 200, 280, 290, { fill: C.ol, stroke: C.o, sw: 1.8, rx: 3 }) + T(703, 219, 'EZA-Regler (Parkregler)', { size: 12, bold: true, fill: C.t });
  b += T(703, 234, 'VDE-AR-N 4110 · Teil des Anlagenzertifikats', { size: 10 });
  b += R(703, 244, 254, 112, { stroke: C.o, sw: 1.3 }) + T(715, 263, 'Vorrangauswahl', { size: 11.5, bold: true, fill: C.t });
  b += T(715, 282, 'P = min(NB, DV, NAP, EMS)', { size: 10, mono: true, fill: C.t });
  b += TL(715, 301, ['NAP-Grenze: Bezug 2.000 kW,', 'Einspeisung 800 kW (fest)', 'Q nur nach Verfahren des NB', 'Batterie-Sollwert wird geklemmt'], { size: 10, lh: 14 });
  b += R(703, 366, 254, 112, { stroke: C.r, sw: 1.3 }) + T(715, 385, 'Watchdog EMS-Eingang', { size: 11.5, bold: true, fill: C.t });
  b += TL(715, 404, ['Heartbeat EMS > 10 s unverändert:', 'EMS-Wunsch entfällt,', 'Batterie auf 0 kW,', 'PV frei bis zur NAP-Grenze,', 'Meldung an die GLT'], { size: 10, lh: 14 });

  // ── Signalleiter EMS ↔ EZA
  b += T(500, 212, 'Modbus TCP · eigenes VLAN · Firewall', { size: 10.5, bold: true, anchor: 'middle', fill: C.b });
  b += T(500, 226, 'feste Quelladresse, nur freigegebener Registerbereich', { size: 10, anchor: 'middle', fill: C.b });
  const lesen = [
    ['30001', 'P_NAP (+ Bezug) · Q · U · f'],
    ['30007', 'P_PV Ist / verfügbar'],
    ['30011', 'P_Batt Ist · SoC · Lade-/Entladegrenze'],
    ['30016', 'P_max,EZA aktiv + Quelle (NB/DV/NAP)'],
    ['30019', 'Statusbits · Heartbeat EZA'],
  ];
  const schreiben = [
    ['40002', 'Heartbeat EMS (Wechsel ≤ 10 s)'],
    ['40001', 'EMS-Freigabe'],
    ['40003', 'P_PV,max (Wunsch, kW)'],
    ['40005', 'P_Batt Soll (± kW, Entladen +)'],
  ];
  b += T(318, 250, 'EMS liest', { size: 10, bold: true, fill: C.t });
  lesen.forEach(([reg, txt], i) => {
    const y = 270 + i * 22;
    b += T(330, y - 4, reg, { size: 9.5, mono: true, fill: C.l }) + T(372, y - 4, txt, { size: 10, fill: C.t });
    b += P(`M688 ${y} H312`, { stroke: C.b, sw: 1.4, end: 'aB' });
  });
  b += T(318, 392, 'EMS schreibt', { size: 10, bold: true, fill: C.t });
  schreiben.forEach(([reg, txt], i) => {
    const y = 412 + i * 22;
    b += T(330, y - 4, reg, { size: 9.5, mono: true, fill: C.l }) + T(372, y - 4, txt, { size: 10, fill: C.t });
    b += P(`M312 ${y} H688`, { stroke: C.b, sw: 1.4, end: 'aB' });
  });
  b += P('M330 503 l8 8 M338 503 l-8 8', { stroke: C.r, sw: 1.6 });
  b += T(346, 511, 'gesperrt: Q · cos φ · Kennlinien · P(f) · Schutz', { size: 10, bold: true, fill: C.r });

  // ── Verbraucher unter der GLT
  b += P('M170 490 V522', { stroke: C.b, sw: 1.8 }) + P('M80 522 H410', { stroke: C.b, sw: 1.8 });
  const verb = [[30, 'Wärmepumpen', '2 × 150 kW', 'SG-Ready'], [140, 'Laden', '34 LP · 530 kW', 'OCPP-Budget'], [250, 'Heizstab', '150 kW', '0–10 V'], [360, 'Lastabwurf', 'Klasse C', 'Relais je UV']];
  for (const [x, h, v, i] of verb) {
    b += P(`M${x + 50} 522 V543`, { stroke: C.b, sw: 1.8, end: 'aB' });
    b += R(x, 544, 100, 58, { fill: C.gr }) + T(x + 50, 561, h, { size: 11, bold: true, anchor: 'middle', fill: C.t }) +
      T(x + 50, 576, v, { size: 10, anchor: 'middle' }) + T(x + 50, 591, i, { size: 10, anchor: 'middle', fill: C.b });
    b += P(`M${x + 50} 602 V632`, { sw: 1.6 });
  }

  // ── Erzeugung unter dem EZA-Regler
  b += P('M830 490 V522', { stroke: C.o, sw: 1.8 }) + P('M570 522 H909', { stroke: C.o, sw: 1.8 });
  const erz = [[520, 'PV Dach', '700 kWp', 'SunSpec'], [633, 'PV Carport', '500 kWp', 'SunSpec'], [746, 'Batterie', '600 kW / 1,2 MWh', 'PCS, ext. Modus'], [859, 'BHKW', '250 kW el.', 'Freigabe GLT']];
  for (const [x, h, v, i] of erz) {
    b += P(`M${x + 50} 522 V543`, { stroke: C.o, sw: 1.8, end: 'aO' });
    b += R(x, 544, 100, 58, { fill: C.gr }) + T(x + 50, 561, h, { size: 11, bold: true, anchor: 'middle', fill: C.t }) +
      T(x + 50, 576, v, { size: 10, anchor: 'middle' }) + T(x + 50, 591, i, { size: 10, anchor: 'middle', fill: C.o });
    b += P(`M${x + 50} 602 V632`, { sw: 1.6 });
  }
  b += P('M30 632 H970', { sw: 4 }) + T(30, 652, 'NS-Hauptverteilungen (vereinfacht) · 2 Trafos à 1.000 kVA', { size: 10 });

  // ── Drei Situationen
  b += T(28, 705, 'Drei Situationen im Beispiel', { size: 13.5, bold: true, fill: C.t });
  b += T(28, 721, 'Leistung am NAP in kW: + Bezug, − Einspeisung · Balken maßstäblich', { size: 10, fill: C.l });
  const cases = [
    { zeit: 'Sonntag im Juni, 13:00', zust: 'PV-Überschuss', col: C.g, fill: C.gl, rows: [
      ['PV verfügbar', -1080, C.o], ['Grundlast', 260, C.b], ['WP lädt Puffer', 180, C.g2], ['Laden Dienstwagen', 60, C.g2], ['Batterie lädt', 400, C.g2],
    ], sum: -180, note: ['Ohne EMS −820 kW: EZA regelt 20 kW ab.', 'Mit EMS bleiben 640 kW mehr im Haus.'] },
    { zeit: 'Derselbe Tag, 15:30', zust: 'Netzengpass', col: C.o, fill: C.ol, rows: [
      ['PV verfügbar', -1000, C.o], ['Grundlast', 280, C.b], ['Laden', 40, C.b], ['Batterie 200 → 340', 340, C.g2], ['EZA regelt PV ab', 100, C.o],
    ], sum: -240, note: ['NB senkt die Einspeisung auf 240 kW.', 'EMS sieht „Quelle = NB“ und plant neu.'] },
    { zeit: 'Montag im Januar, 07:45', zust: 'Spitzenlast', col: C.r, fill: C.rl, rows: [
      ['Verbrauch gesamt', 1900, C.b], ['PV', -30, C.o], ['BHKW', -250, C.o], ['Laden 280 → 160', -120, C.g2], ['Batterie entlädt', -100, C.g2],
    ], sum: 1400, note: ['Ohne EMS +1.620 kW, Ziel 1.500 kW.', 'WP-Sperre und Abwurf nicht nötig.'] },
  ];
  const sc = 95 / 1900;
  cases.forEach((c, i) => {
    const x = 28 + i * 318, y = 736, w = 302;
    b += R(x, y, w, 222, { fill: '#fff', stroke: C.br, sw: 1 });
    b += R(x, y, w, 28, { fill: c.fill, stroke: 'none', sw: 0, rx: 0 }) + `<rect x="${x}" y="${y}" width="4" height="28" fill="${c.col}"/>`;
    b += T(x + 14, y + 18, c.zust, { size: 11.5, bold: true, fill: c.col }) + T(x + w - 10, y + 18, c.zeit, { size: 10, anchor: 'end' });
    const bx = x + 150;
    c.rows.forEach(([lab, v, col], k) => {
      const ry = y + 50 + k * 20;
      b += T(x + 12, ry, lab, { size: 10.5, fill: C.t });
      b += `<rect x="${bx}" y="${ry - 9}" width="${Math.max(2, Math.abs(v) * sc).toFixed(1)}" height="10" fill="${col}"/>`;
      b += T(x + w - 10, ry, de(v), { size: 10.5, anchor: 'end', fill: C.t });
    });
    const sy = y + 50 + c.rows.length * 20 + 4;
    b += P(`M${x + 12} ${sy - 12} H${x + w - 10}`, { stroke: C.t, sw: 1 });
    b += T(x + 12, sy + 2, 'Am NAP', { size: 11, bold: true, fill: C.t });
    b += `<rect x="${bx}" y="${sy - 8}" width="${(Math.abs(c.sum) * sc).toFixed(1)}" height="10" fill="${C.t}"/>`;
    b += T(x + w - 10, sy + 2, de(c.sum) + ' kW', { size: 11, bold: true, anchor: 'end', fill: C.t });
    b += TL(x + 12, sy + 26, c.note, { size: 10, lh: 14 });
  });

  // ── Wer darf was
  b += P('M28 984 H972', { stroke: C.br, sw: 1 });
  b += T(28, 1010, 'Wer schreibt welche Größe?', { size: 13.5, bold: true, fill: C.t });
  b += T(28, 1026, 'Jede Größe hat genau einen Schreiber. Alle anderen begrenzen oder lesen nur.', { size: 10, fill: C.l });
  const wer = [
    ['Blindleistung NAP', 'EZA-Regler nach Verfahren des NB', 'EMS hat keinen Zugriff'],
    ['PV-Leistung', 'EZA-Regler', 'begrenzt durch NB, DV, NAP-Grenze, EMS'],
    ['Batterie', 'EZA-Regler mit dem EMS-Sollwert', 'geklemmt durch NB, NAP-Grenze, BMS'],
    ['BHKW', 'GLT (wärmegeführte Freigabe)', 'EZA-Regler reduziert bei Netzeingriff'],
    ['Wärmepumpen', 'GLT über SG-Ready / Sollwert', 'Sperre nur kurz (üblich ≤ 2 h)'],
    ['Ladeleistung', 'Lade-Backend per OCPP', 'Budget vom EMS, je LP mind. 6 A'],
    ['Heizstab, Abwurf C', 'GLT', 'nur Klasse C wird abgeworfen'],
    ['Netzersatz, Schutz', 'eigene Steuerung, fest', 'niemand; GLT liest Meldungen'],
  ];
  wer.forEach(([k, s, z], i) => {
    const x0 = i < 4 ? 28 : 510, y0 = 1040 + (i % 4) * 36;
    b += P(`M${x0} ${y0} H${x0 + 462}`, { stroke: C.br, sw: 1 });
    b += T(x0, y0 + 15, k, { size: 10.5, bold: true, fill: C.t }) + T(x0 + 130, y0 + 15, s, { size: 10.5, fill: C.t }) + T(x0 + 130, y0 + 29, z, { size: 10 });
  });

  b += legend(1200, [
    { c: C.t, w: 4, t: 'NS-Schiene' }, { c: C.b, w: 2, t: 'Daten GA / EMS' }, { c: C.o, w: 2, t: 'netzrelevante Vorgabe' },
    { c: C.l, w: 1.2, dash: '5 4', t: 'Bilanzgrenze' }, { sq: true, c: C.g2, t: 'Eingriff EMS' }, { sq: true, c: C.o, t: 'Erzeugung' }, { sq: true, c: C.b, t: 'Verbrauch' },
  ]);
  b += T(28, 1226, 'Prinzipskizze, Werte der Beispiel-Liegenschaft. Registeradressen beispielhaft; maßgeblich sind Signalliste, TAB und Anlagenzertifikat.', { size: 10.5, fill: C.l });
  return frame(W, H, 'GUTACHTEN · GEBÄUDEAUTOMATION · EMS-BEISPIEL', 'EMS und EZA-Regler im Beispiel: Signale und Leistungsbilanz', b);
}

fs.writeFileSync(path.join(OUT, 'Prinzip-EMS-Beispiel.svg'), svgBeispiel());
