// Gemeinsame Bausteine der Skizzen-Erzeuger (LKEBw-Stil wie die Gutachten-Grafiken).
// Jeder Erzeuger: node quellen/<name> <Zielordner> — schreibt seine Skizze(n) unter festem Dateinamen dorthin.
/* global process, console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOGO = fs.readFileSync(path.join(ROOT, 'src/config/lkebw-logo.js'), 'utf8')
  .match(/export const LKEBW_LOGO = '(data:image\/png;base64,[A-Za-z0-9+/=]+)'/)[1];

export const C = {
  bg: '#FAFAF8', g: '#266426', g2: '#3F9C3F', gl: '#EEF3EC', t: '#1B1F1C', s: '#5A5F5A',
  o: '#C8641E', ol: '#FBF1E8', b: '#2A64B4', bl: '#EEF2F9', l: '#8A8F8A', br: '#E2E4DF',
  r: '#B42318', rl: '#FCEDEC', gr: '#F2F3F0',
};
const F = 'Tahoma, Verdana, sans-serif';
const M = "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function T(x, y, s, o = {}) {
  const sz = o.size || 10.5;
  return `<text x="${x}" y="${y}" font-family="${o.mono ? M : F}" font-size="${sz}"` +
    (o.bold ? ' font-weight="700"' : '') + (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
    (o.ls ? ` letter-spacing="${o.ls}"` : '') + ` fill="${o.fill || C.s}">${esc(s)}</text>`;
}
export function TL(x, y, lines, o = {}) {
  const lh = o.lh || (o.size || 10.5) * 1.4;
  return lines.map((l, i) => (typeof l === 'object' ? T(x, y + i * lh, l.t, { ...o, ...l }) : T(x, y + i * lh, l, o))).join('');
}
export function R(x, y, w, h, o = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 2}" fill="${o.fill || '#fff'}" stroke="${o.stroke || C.t}" stroke-width="${o.sw || 1.2}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '/>';
}
export function P(d, o = {}) {
  return `<path d="${d}" fill="none" stroke="${o.stroke || C.t}" stroke-width="${o.sw || 1.6}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + (o.end ? ` marker-end="url(#${o.end})"` : '') +
    (o.start ? ` marker-start="url(#${o.start})"` : '') + ' stroke-linejoin="round"/>';
}
export function badge(cx, cy, n, fill = C.r) {
  return `<circle cx="${cx}" cy="${cy}" r="7.5" fill="${fill}"/>` + T(cx, cy + 3.5, n, { size: 9.5, bold: true, anchor: 'middle', fill: '#fff' });
}
export function wrap(text, max) {
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
// Rahmen mit Kopfzeile (Dachzeile, Titel, Logo); Pfeilspitzen aI/aB/aO/aR
export function frame(W, H, kicker, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>` +
    marker('aI', C.t) + marker('aB', C.b) + marker('aO', C.o) + marker('aR', C.r) + '</defs>' +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/><rect x="0" y="0" width="${W}" height="5" fill="${C.g}"/>` +
    `<line x1="0" y1="75.5" x2="${W}" y2="75.5" stroke="${C.br}" stroke-width="1"/><line x1="824.5" y1="5" x2="824.5" y2="75" stroke="${C.br}" stroke-width="1"/>` +
    T(28, 29.38, kicker, { mono: true, size: 11, fill: C.g2, ls: 1.76 }) +
    T(28, 56.38, title, { size: 21, bold: true, fill: C.t }) +
    `<image href="${LOGO}" x="848" y="21" width="128" height="38"/>` + body + '</svg>';
}
export function legend(y, items) {
  let x = 28, s = '';
  for (const it of items) {
    if (it.box) s += `<rect x="${x}" y="${y - 7}" width="26" height="14" fill="#fff" stroke="${C.l}" stroke-width="1" stroke-dasharray="3 2"/>`;
    else s += P(`M${x} ${y} h26`, { stroke: it.c, sw: it.w, dash: it.dash });
    s += T(x + 34, y + 4, it.t, { size: 11, fill: C.t });
    x += 34 + it.t.length * 6.3 + 22;
  }
  return s;
}
// Skizze unter festem Dateinamen in den Zielordner (Argument 1) schreiben
export function schreibe(datei, svg) {
  const ordner = process.argv[2];
  if (!ordner) { console.error('Aufruf: node <erzeuger> <Zielordner>'); process.exit(1); }
  fs.writeFileSync(path.join(ordner, datei), svg);
}
