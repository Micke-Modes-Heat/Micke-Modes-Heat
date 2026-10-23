// Abbildungen für den Artikel „EZA-Regler im Detail“ (eigene Darstellungen, keine Skizzenbibliothek).
// node docs/artikel/figuren.cjs  → schreibt docs/artikel/figuren/*.svg
const fs = require('fs');
const path = require('path');

const C = { g: '#266426', g2: '#3F9C3F', gl: '#EEF3EC', t: '#1B1F1C', s: '#5A5F5A', l: '#8A8F8A', br: '#E2E4DF',
  o: '#C8641E', ol: '#FBF1E8', b: '#2A64B4', bl: '#EEF2F9', r: '#B42318' };
const F = 'Tahoma, Verdana, sans-serif';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="${F}" font-size="${o.size || 11}"` +
  (o.bold ? ' font-weight="700"' : '') + (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
  (o.rot ? ` transform="rotate(${o.rot} ${x} ${y})"` : '') + ` fill="${o.fill || C.s}">${esc(s)}</text>`;
const L = (pts, o = {}) => `<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${o.fill || 'none'}"` +
  ` stroke="${o.stroke || C.t}" stroke-width="${o.sw || 1.6}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''} stroke-linejoin="round"/>`;
const svg = (W, H, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">` +
  `<rect width="${W}" height="${H}" fill="#FFFFFF"/>${body}</svg>`;

// Achsenrahmen: liefert Abbildungsfunktionen x(), y()
function achsen({ x0, y0, w, h, xd, yd, xt, yt, xl, yl, null0 = true }) {
  const x = v => x0 + (v - xd[0]) / (xd[1] - xd[0]) * w;
  const y = v => y0 + h - (v - yd[0]) / (yd[1] - yd[0]) * h;
  let b = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="${C.br}"/>`;
  for (const [v, s] of yt) b += `<line x1="${x0}" x2="${x0 + w}" y1="${y(v)}" y2="${y(v)}" stroke="${C.br}"/>` + T(x0 - 6, y(v) + 4, s, { size: 10, anchor: 'end' });
  for (const [v, s] of xt) b += `<line x1="${x(v)}" x2="${x(v)}" y1="${y0 + h}" y2="${y0 + h + 4}" stroke="${C.l}"/>` + T(x(v), y0 + h + 16, s, { size: 10, anchor: 'middle' });
  if (null0 && yd[0] < 0) b += `<line x1="${x0}" x2="${x0 + w}" y1="${y(0)}" y2="${y(0)}" stroke="${C.l}" stroke-width="1.2"/>`;
  b += T(x0 + w / 2, y0 + h + 34, xl, { size: 10.5, anchor: 'middle', fill: C.t });
  b += T(x0 - 40, y0 + h / 2, yl, { size: 10.5, anchor: 'middle', fill: C.t, rot: -90 });
  return { x, y, b };
}

// ── Abbildung: Q(U), Q(P), P-Q-Bereich ─────────────────────────────────────────
function kennlinien() {
  const W = 1000, H = 400, Q = 0.33;
  let b = '';
  const panel = (x0, titel, unter) => T(x0 - 40, 30, titel, { size: 13, bold: true, fill: C.t }) + T(x0 - 40, 47, unter, { size: 10.5 });
  const yt = [[Q, '+0,33'], [0, '0'], [-Q, '−0,33']];

  // A: Q(U)
  let a = achsen({ x0: 70, y0: 70, w: 240, h: 220, xd: [0.9, 1.1], yd: [-0.45, 0.45], xt: [[0.93, 'U₁'], [0.97, 'U₂'], [1.0, 'Uc'], [1.03, 'U₃'], [1.07, 'U₄']], yt, xl: 'Spannung am NAP', yl: 'Q / P_b,inst' });
  b += panel(70, 'A · Q(U)-Kennlinie', 'Stützstellen und Totband gibt der Netzbetreiber vor');
  b += `<rect x="${a.x(0.97)}" y="70" width="${a.x(1.03) - a.x(0.97)}" height="220" fill="${C.gl}"/>` + a.b;
  b += L([[0.9, Q], [0.93, Q], [0.97, 0], [1.03, 0], [1.07, -Q], [1.1, -Q]].map(([u, q]) => [a.x(u), a.y(q)]), { stroke: C.o, sw: 2.4 });
  b += T(a.x(1.0), 104, 'Totband', { size: 10, anchor: 'middle', fill: C.g });
  b += T(a.x(0.905), a.y(Q) - 8, 'übererregt: hebt U', { size: 10, fill: C.o });
  b += T(a.x(1.095), a.y(-Q) + 18, 'untererregt: senkt U', { size: 10, anchor: 'end', fill: C.o });

  // B: Q(P)
  a = achsen({ x0: 400, y0: 70, w: 240, h: 220, xd: [0, 1], yd: [-0.45, 0.45], xt: [[0, '0'], [0.2, '0,2'], [0.5, '0,5'], [1, '1,0']], yt, xl: 'P / P_b,inst', yl: 'Q / P_b,inst' });
  b += panel(400, 'B · Q(P)-Kennlinie', 'Beispiel; bis zu 10 Stützstellen');
  b += a.b + L([[0, 0], [0.5, 0], [1, -Q]].map(([p, q]) => [a.x(p), a.y(q)]), { stroke: C.o, sw: 2.4 });
  for (const [p, q] of [[0, 0], [0.5, 0], [1, -Q]]) b += `<circle cx="${a.x(p)}" cy="${a.y(q)}" r="3.5" fill="#fff" stroke="${C.o}" stroke-width="1.6"/>`;
  b += T(a.x(0.04), a.y(-0.17), 'mit steigender Einspeisung', { size: 10, fill: C.o });
  b += T(a.x(0.04), a.y(-0.17) + 14, 'zunehmend untererregt', { size: 10, fill: C.o });

  // C: P-Q-Betriebsbereich
  a = achsen({ x0: 730, y0: 70, w: 240, h: 220, xd: [-0.5, 0.5], yd: [0, 1.12], xt: [[-Q, '−0,33'], [0, '0'], [Q, '+0,33']], yt: [[0.2, '0,2'], [0.6, '0,6'], [1, '1,0']], xl: 'Q / P_b,inst  (− untererregt · + übererregt)', yl: 'P / P_b,inst', null0: false });
  b += panel(730, 'C · Blindleistungsbereich', 'gefordert: Q = ±0,33 · P_b,inst (cos φ 0,95)');
  b += `<polygon points="${[[-Q, 0.2], [-Q, 1], [Q, 1], [Q, 0.2]].map(([q, p]) => `${a.x(q)},${a.y(p)}`).join(' ')}" fill="${C.ol}" stroke="${C.o}" stroke-width="1.4"/>`;
  b += `<polygon points="${[[0, 0], [-Q, 0.2], [Q, 0.2]].map(([q, p]) => `${a.x(q)},${a.y(p)}`).join(' ')}" fill="#fff" stroke="${C.o}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  b += a.b;
  const kreis = (s, o) => L(Array.from({ length: 61 }, (_, i) => { const w = Math.PI * i / 60; return [a.x(s * Math.cos(w)), a.y(s * Math.sin(w))]; }).filter(([px, py]) => px >= 730 && px <= 970 && py >= 70), o);
  b += kreis(1.0, { stroke: C.l, sw: 1.4, dash: '5 4' }) + kreis(1.053, { stroke: C.b, sw: 1.8 });
  b += `<circle cx="${a.x(Q)}" cy="${a.y(1)}" r="4" fill="${C.b}"/>`;
  b += T(a.x(0), a.y(0.6), 'geforderter', { size: 10, anchor: 'middle', fill: C.o }) + T(a.x(0), a.y(0.6) + 13, 'Bereich', { size: 10, anchor: 'middle', fill: C.o });
  b += T(a.x(-0.48), a.y(0.14), 'Teillast:', { size: 9.5, fill: C.s }) + T(a.x(-0.48), a.y(0.14) + 12, 'nach NB', { size: 9.5, fill: C.s });
  b += T(a.x(-0.48), a.y(1.09), 'S = 1,05', { size: 10, fill: C.b });
  b += T(a.x(-0.48), a.y(0.8), 'S = 1,00', { size: 10, fill: C.l });

  b += T(30, 372, 'Prinzipdarstellung. Welche Kennlinie gilt, wo die Stützstellen liegen und welcher Blindleistungsbereich gefordert ist, legen VDE-AR-N 4110 und die TAB des Netzbetreibers fest.', { size: 10.5, fill: C.l });
  b += T(30, 388, 'Q > 0: übererregt (Anlage gibt Blindleistung ab, Spannung steigt); Q < 0: untererregt (Anlage nimmt Blindleistung auf, Spannung sinkt). Bezugswerte auf P_b,inst normiert.', { size: 10.5, fill: C.l });
  return svg(W, H, b, 'Q(U)-Kennlinie, Q(P)-Kennlinie und geforderter Blindleistungsbereich');
}

// ── Abbildung: Einspeisebegrenzung am NAP über einen Tag ─────────────────────
function tagesgang() {
  const W = 1000, H = 440;
  const a = achsen({ x0: 80, y0: 30, w: 880, h: 320, xd: [5, 21], yd: [-300, 1200],
    xt: [6, 8, 10, 12, 14, 16, 18, 20].map(h => [h, `${h}:00`]), yt: [[-200, '−200'], [0, '0'], [400, '400'], [800, '800'], [1200, '1.200']],
    xl: 'Uhrzeit (Beispieltag, Sonntag im Juni)', yl: 'Leistung in kW' });
  const ts = Array.from({ length: 321 }, (_, i) => 5 + i * 0.05);
  const pv = t => (t <= 6 || t >= 20) ? 0 : 1080 * Math.pow(Math.sin(Math.PI * (t - 6) / 14), 1.3);
  const last = t => 240 + 40 * Math.sin(Math.PI * Math.min(Math.max((t - 6) / 14, 0), 1));
  const grenze = t => (t >= 12 && t < 14) ? 400 : 800;
  const pvIst = t => Math.min(pv(t), grenze(t) + last(t));
  const nap = t => pvIst(t) - last(t);
  let b = a.b;
  // abgeregelte Fläche
  const oben = ts.map(t => [a.x(t), a.y(pv(t))]), unten = ts.map(t => [a.x(t), a.y(pvIst(t))]).reverse();
  b += `<polygon points="${oben.concat(unten).map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${C.ol}" stroke="none"/>`;
  b += L(ts.map(t => [a.x(t), a.y(pv(t))]), { stroke: C.o, sw: 1.4, dash: '4 3' });
  b += L(ts.map(t => [a.x(t), a.y(pvIst(t))]), { stroke: C.o, sw: 2.4 });
  b += L(ts.map(t => [a.x(t), a.y(last(t))]), { stroke: C.b, sw: 2 });
  b += L(ts.map(t => [a.x(t), a.y(nap(t))]), { stroke: C.t, sw: 2.4 });
  b += L(ts.map(t => [a.x(t), a.y(grenze(t))]), { stroke: C.r, sw: 1.8, dash: '6 4' });
  // Beschriftungen
  b += T(a.x(12.05), a.y(1110), 'PV verfügbar', { size: 10.5, fill: C.o });
  b += T(a.x(13), a.y(880), 'abgeregelt', { size: 10.5, bold: true, fill: C.o, anchor: 'middle' });
  b += T(a.x(5.2), a.y(800) - 8, 'Einspeisegrenze P_AV,E = 800 kW', { size: 10.5, fill: C.r });
  b += T(a.x(12.02), a.y(400) + 16, 'Vorgabe NB 12–14 Uhr: 50 % → 400 kW', { size: 10.5, fill: C.r });
  b += T(a.x(16.4), a.y(300) - 10, 'Verbrauch der Liegenschaft', { size: 10.5, fill: C.b });
  b += T(a.x(17.3), a.y(nap(17.3)) + 22, 'Einspeisung am NAP', { size: 10.5, bold: true, fill: C.t });
  b += T(a.x(5.1), a.y(-150), 'Bezug', { size: 10, fill: C.s });
  // Legende
  const leg = [[C.o, 'PV-Leistung nach EZA-Regler', ''], [C.o, 'PV verfügbar', '4 3'], [C.b, 'Verbrauch', ''], [C.t, 'Leistung am NAP (− Bezug)', ''], [C.r, 'wirksame Grenze', '6 4']];
  let x = 80;
  for (const [c, s, d] of leg) { b += `<line x1="${x}" x2="${x + 24}" y1="418" y2="418" stroke="${c}" stroke-width="2.2"${d ? ` stroke-dasharray="${d}"` : ''}/>` + T(x + 30, 422, s, { size: 10.5, fill: C.t }); x += 50 + s.length * 6.2; }
  return svg(W, H, b, 'Tagesverlauf: PV-Leistung, Verbrauch und Einspeisung am Netzanschlusspunkt mit Einspeisegrenze und Vorgabe des Netzbetreibers');
}

const ziel = path.join(__dirname, 'figuren');
fs.mkdirSync(ziel, { recursive: true });
fs.writeFileSync(path.join(ziel, 'EZA-Detail-Kennlinien.svg'), kennlinien());
fs.writeFileSync(path.join(ziel, 'EZA-Detail-Tagesgang.svg'), tagesgang());
console.log('figuren/ geschrieben');
