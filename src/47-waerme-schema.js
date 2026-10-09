// ── 47-waerme-schema.js — Schemata für Wärmenetz und Heizzentrale ──
// Seitenpanel wie das Einlinienschema der Elektrotechnik, mit zwei Ansichten:
//   Netzschema   — Strangplan aus dem Versorgungsbaum: Zentrale(n) links, Abgänge, Abzweige, Gebäude mit Heizlast,
//                  je Leitungszug DN, Länge und Last; Verbindungsleitungen zwischen Zentralen gestrichelt.
//   Heizzentrale — Hydraulik-Blockschema: Erzeuger, Wärmespeicher, Verteiler (VL) und Sammler (RL), Netzpumpe,
//                  Abgänge ins Netz mit DN, Last und versorgten Gebäuden.
import { netzSchemaLayout, dnText } from './lib/netz-schema.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import { autoGkResult, isErzeugerAktiv } from './06c-dispatch-core.js';
import { thermSpeicherAktiv, solarthermieAktiv } from './01-globals-varianten.js';

const S = { ansicht: 'netz', zoom: 1, zentrale: null };
const STRANG_FARBEN = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#e57373', '#4db6ac', '#fff176', '#f06292', '#aed581', '#7986cb', '#ffd54f', '#90a4ae'];
const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kurz = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function wsToggle() {
  const p = document.getElementById('ws-panel');
  if (!p) return;
  if (p.classList.contains('sld-fullscreen')) wsVollbild();
  const an = p.classList.toggle('visible');
  if (an) wsRender();
}
export function wsVollbild() {
  const p = document.getElementById('ws-panel');
  if (!p) return;
  const fs = p.classList.toggle('sld-fullscreen');
  document.getElementById('ws-btn-fs')?.classList.toggle('active', fs);
  if (!p.classList.contains('visible')) p.classList.add('visible');
  setTimeout(() => wsRender(), 60);
}
export function wsAnsicht(a) { S.ansicht = a; wsRender(); }
export function wsZentrale(id) { S.zentrale = Number(id); wsRender(); }
export function wsZoom(d) {
  S.zoom = d === 0 ? 1 : Math.min(3, Math.max(0.25, S.zoom + d));
  const lbl = document.getElementById('ws-zoom-label');
  if (lbl) lbl.textContent = Math.round(S.zoom * 100) + '%';
  const svg = document.querySelector('#ws-canvas svg');
  if (svg) { const vb = svg.getAttribute('viewBox').split(' '); svg.style.width = vb[2] * S.zoom + 'px'; svg.style.height = vb[3] * S.zoom + 'px'; }
}

function _zentralen() {
  const liste = window.heizzentralenListe?.() || [];
  if (liste.length) return liste;
  const id = parseInt(document.getElementById('netz-zentrale')?.value, 10);
  return Number.isFinite(id) ? [{ id, name: 'Heizzentrale', haupt: true }] : [];
}

const _gebName = id => {
  const g = (window.gebaeude || []).find(x => x.id === id);
  if (!g) return '';
  return (g.gebaeudenummer ? g.gebaeudenummer + ' · ' : '') + (g.name || 'Gebäude ' + id);
};

/** Daten des Netzschemas aus der letzten Netzberechnung (auch für Tests). */
export function wsNetzDaten() {
  const zentralen = _zentralen();
  const ek = window._netzElternKante;
  if (!zentralen.length || !ek?.size) return null;
  const eltern = new Map(), kante = new Map(), knoten = new Map();
  for (const [id, e] of ek) {
    if (!window.netzEdges.includes(e)) continue;
    eltern.set(id, e.u === id ? e.v : e.u);
    kante.set(id, { dn: e.dn, length: e.length, load: e.load, strandId: e.strandId });
    for (const n of [e.uNode, e.vNode]) if (n && !knoten.has(n.id)) knoten.set(n.id, { typ: n.type });
  }
  const jahr = window.globalYear;
  for (const [id, k] of knoten) if (k.typ === 'geb') { k.name = _gebName(id); const g = (window.gebaeude || []).find(x => x.id === id); k.last = g ? window.getComputedStats(g, jahr).heizlast || 0 : 0; }
  zentralen.forEach(z => { knoten.set(z.id, { typ: 'geb', name: z.name, last: 0 }); });
  const kuppel = (window.netzEdges || []).filter(e => e.kuppel && !e.pruned).map(e => ({ u: e.u, v: e.v, dn: e.dn, length: e.length, load: e.load }));
  const layout = netzSchemaLayout({ wurzeln: zentralen.map(z => z.id), eltern, kante, knoten, kuppel }, { spalteBreit: 250, zeileHoch: 40, rand: 40 });
  layout.strang = id => kante.get(id)?.strandId;
  layout.zentralen = zentralen;
  return layout;
}

function _netzSvg(L) {
  const pos = new Map(L.knoten.map(k => [k.id, k]));
  let s = '';
  // Leitungen: vom Knoten kurz nach rechts, senkrecht zur Zeile des Kindes, waagrecht bis zum Kind.
  // Beschriftung (DN · Länge oben, Last unten) rechtsbündig vor dem Kind.
  for (const e of L.kanten) {
    const a = pos.get(e.von), b = pos.get(e.nach);
    if (!a || !b) continue;
    const farbe = STRANG_FARBEN[(L.strang(e.nach) ?? 0) % STRANG_FARBEN.length];
    const x0 = a.x + (a.typ === 'zentrale' ? 46 : 0), mx = a.x + (a.typ === 'zentrale' ? 62 : 14);
    const breite = Math.max(1.4, Math.min(5, 1 + (e.dnMax || 0) / 60));
    s += `<path d="M${x0},${a.y} H${mx} V${b.y} H${b.x - (b.typ === 'geb' ? 5 : 3)}" fill="none" stroke="${farbe}" stroke-width="${breite}" stroke-linejoin="round"/>`;
    s += `<text x="${b.x - 10}" y="${b.y - 4}" class="ws-dn" text-anchor="end">${esc(dnText(e.dnMin, e.dnMax))} · ${nf(e.laenge)} m</text>`;
    s += `<text x="${b.x - 10}" y="${b.y + 11}" class="ws-last" text-anchor="end">${nf(e.last)} kW</text>`;
  }
  // Verbindungsleitungen zwischen Zentralen: rechts am Rand entlang
  const xRand = Math.max(...L.knoten.map(k => k.x)) + 230;
  L.kuppel.forEach((e, i) => {
    const a = pos.get(e.von), b = pos.get(e.nach);
    if (!a || !b) return;
    const xr = xRand + i * 14;
    s += `<path d="M${a.x + 5},${a.y} H${xr} V${b.y} H${b.x + 5}" fill="none" stroke="#26c6da" stroke-width="2" stroke-dasharray="8 5"/>`;
    s += `<text x="${xr + 8}" y="${(a.y + b.y) / 2}" class="ws-kuppel">⇄ Verbindungsleitung ${esc(dnText(e.dnMin, e.dnMax))} · ${nf(e.laenge)} m · ${nf(e.last)} kW (Trennstelle)</text>`;
  });
  // Knoten
  for (const k of L.knoten) {
    if (k.typ === 'zentrale') {
      s += `<rect x="${k.x - 6}" y="${k.y - 14}" width="52" height="28" rx="5" fill="#ff8f00"/><text x="${k.x + 20}" y="${k.y + 4}" class="ws-hz">${esc(kurz(k.name, 8))}</text>`;
    } else if (k.typ === 'geb') {
      s += `<rect x="${k.x - 5}" y="${k.y - 5}" width="10" height="10" rx="2" fill="#cfd8dc"/>`;
      s += `<text x="${k.x + 9}" y="${k.y - 7}" class="ws-geb">${esc(kurz(k.name, 30))}</text><text x="${k.x + 9}" y="${k.y + 15}" class="ws-gebkw">${nf(k.last)} kW</text>`;
    } else {
      s += `<circle cx="${k.x}" cy="${k.y}" r="3.2" fill="#eceff1"/>`;
    }
  }
  return s;
}

/** Daten der Heizzentrale: Erzeuger (mit Standort), Speicher, Abgänge, Netzparameter. */
export function wsZentraleDaten(zentraleId) {
  const zentralen = _zentralen();
  const z = zentralen.find(x => x.id === zentraleId) || zentralen[0];
  if (!z) return null;
  const mehrere = zentralen.length > 1;
  const standort = key => (window.erzeugerStandort?.(key) ?? zentralen[0].id);
  const erzeuger = [];
  for (const [key, cfg] of Object.entries(ERZEUGER_CFG)) {
    if (!isErzeugerAktiv(key)) continue;
    if (mehrere && standort(key) !== z.id) continue;
    erzeuger.push({ key, name: cfg.label, farbe: cfg.color, typ: cfg.typ, kw: parseFloat(document.getElementById(cfg.leistungId)?.value) || 0 });
  }
  if (autoGkResult && autoGkResult.leistungKw > 0 && (!mehrere || standort('_autoGk') === z.id)) {
    erzeuger.push({ key: '_autoGk', name: 'Spitzenlast-Kessel', farbe: '#90a4ae', typ: 'fix', kw: autoGkResult.leistungKw });
  }
  if (solarthermieAktiv && (!mehrere || z.haupt)) erzeuger.push({ key: 'solarthermie', name: 'Solarthermie', farbe: '#ffab40', typ: 'st', kw: 0, info: `${nf(parseFloat(document.getElementById('st-flaeche')?.value) || 0)} m²` });
  const speicher = thermSpeicherAktiv && (!mehrere || z.haupt) ? { vol: parseFloat(document.getElementById('ts-volumen')?.value) || 0, typ: document.getElementById('ts-typ')?.value || 'puffer' } : null;
  // Abgänge: Leitungen, deren Elternknoten die Zentrale ist
  const ek = window._netzElternKante || new Map();
  const unterbaum = new Map();
  const eltern = new Map([...ek].map(([id, e]) => [id, e.u === id ? e.v : e.u]));
  for (const g of window.gebaeude || []) {
    if (!eltern.has(g.id)) continue;
    let x = g.id, vorher = g.id;
    while (eltern.has(x) && x !== z.id) { vorher = x; x = eltern.get(x); }
    if (x === z.id) unterbaum.set(vorher, (unterbaum.get(vorher) || 0) + 1);
  }
  const abgaenge = [...ek].filter(([id, e]) => (e.u === id ? e.v : e.u) === z.id && window.netzEdges.includes(e))
    .map(([id, e], i) => ({ id, nr: i + 1, dn: e.dn, last: e.load, laenge: e.length, gebaeude: unterbaum.get(id) || 0, strand: e.strandId }))
    .sort((a, b) => b.last - a.last);
  const kuppel = (window.netzEdges || []).filter(e => e.kuppel && !e.pruned && (window._netzWurzelVon?.get(e.u) === z.id || window._netzWurzelVon?.get(e.v) === z.id));
  const vl = parseFloat(document.getElementById('netz-vl')?.value) || 90, rl = parseFloat(document.getElementById('netz-rl')?.value) || 60;
  return { z, zentralen, erzeuger, speicher, abgaenge, kuppel, vl, rl, pumpe: window._netzPumpe || null };
}

const SYMBOL = { wp: 'WP', fix: 'K', kwk: 'BHKW', st: 'ST' };

function _zentraleSvg(d) {
  const zeile = 64, x0 = 30, xV = 330, xR = 360, xEnde = 760;
  const nE = Math.max(1, d.erzeuger.length + (d.speicher ? 1 : 0));
  const nA = Math.max(1, d.abgaenge.length + d.kuppel.length);
  const yTop = d.pumpe ? 92 : 64;
  const H = yTop + 40 + Math.max(nE, nA) * zeile;
  const yBot = H - 30;
  let s = '';
  // Verteiler (VL) und Sammler (RL)
  s += `<rect x="${xV - 4}" y="${yTop}" width="8" height="${yBot - yTop}" fill="#e53935" rx="2"/><text x="${xV}" y="${yTop - 10}" class="ws-kopf" text-anchor="middle">Verteiler VL ${nf(d.vl)} °C</text>`;
  s += `<rect x="${xR - 4}" y="${yTop}" width="8" height="${yBot - yTop}" fill="#1e88e5" rx="2"/><text x="${xR}" y="${yBot + 18}" class="ws-kopf" text-anchor="middle">Sammler RL ${nf(d.rl)} °C</text>`;
  // Erzeuger links
  let i = 0;
  const erzeugerZeile = (titel, sym, farbe, unter) => {
    const y = yTop + 30 + i * zeile;
    s += `<line x1="${x0 + 150}" y1="${y - 8}" x2="${xV}" y2="${y - 8}" stroke="#e53935" stroke-width="2"/>`;
    s += `<line x1="${xR}" y1="${y + 8}" x2="${x0 + 150}" y2="${y + 8}" stroke="#1e88e5" stroke-width="2"/>`;
    s += `<rect x="${x0}" y="${y - 22}" width="150" height="44" rx="6" fill="#1b2230" stroke="${farbe}" stroke-width="2"/>`;
    s += `<text x="${x0 + 8}" y="${y - 4}" class="ws-sym" fill="${farbe}">${esc(sym)}</text>`;
    s += `<text x="${x0 + 50}" y="${y - 4}" class="ws-erz">${esc(kurz(titel, 16))}</text><text x="${x0 + 50}" y="${y + 12}" class="ws-erzkw">${esc(unter)}</text>`;
    i++;
  };
  d.erzeuger.forEach(e => erzeugerZeile(e.name, SYMBOL[e.typ] || 'K', e.farbe, e.info || `${nf(e.kw)} kW`));
  if (d.speicher) erzeugerZeile(d.speicher.typ === 'saisonal' ? 'Saisonalspeicher' : 'Wärmespeicher', 'SP', '#26a69a', `${nf(d.speicher.vol)} m³`);
  if (!d.erzeuger.length) s += `<text x="${x0}" y="${yTop + 30}" class="ws-erzkw">Keine Erzeuger an dieser Zentrale</text>`;
  // Netzpumpe am Verteiler
  if (d.pumpe) {
    const yP = yTop - 34;
    s += `<circle cx="${xV + 80}" cy="${yP}" r="11" fill="#1b2230" stroke="#eceff1" stroke-width="1.5"/><path d="M${xV + 74},${yP - 6} L${xV + 87},${yP} L${xV + 74},${yP + 6} Z" fill="#eceff1"/>`;
    s += `<text x="${xV + 96}" y="${yP + 4}" class="ws-erzkw">Netzpumpe ${nf(d.pumpe.pumpenLeistungKW, 1)} kW · ${nf(d.pumpe.foerderhoeheMWS, 1)} mWS · ${nf(d.pumpe.vDotGesamt, 1)} m³/h</text>`;
  }
  // Abgänge rechts
  let j = 0;
  const abgangZeile = (titel, unter, farbe, gestrichelt) => {
    const y = yTop + 30 + j * zeile;
    s += `<line x1="${xV}" y1="${y - 6}" x2="${xEnde}" y2="${y - 6}" stroke="#e53935" stroke-width="2.5"${gestrichelt ? ' stroke-dasharray="8 5"' : ''}/>`;
    s += `<line x1="${xEnde}" y1="${y + 6}" x2="${xR}" y2="${y + 6}" stroke="#1e88e5" stroke-width="2.5"${gestrichelt ? ' stroke-dasharray="8 5"' : ''}/>`;
    s += `<path d="M${xEnde},${y - 12} l12,6 l-12,6 z" fill="${farbe}"/>`;
    s += `<rect x="${xV + 90}" y="${y - 2}" width="12" height="4" fill="${farbe}"/>`;
    s += `<text x="${xV + 110}" y="${y - 12}" class="ws-erz">${esc(titel)}</text><text x="${xV + 110}" y="${y + 22}" class="ws-erzkw">${esc(unter)}</text>`;
    j++;
  };
  d.abgaenge.forEach(a => abgangZeile(`Abgang ${a.nr} · ${dnText(a.dn, a.dn)}`, `${nf(a.last)} kW · ${a.gebaeude} Gebäude · ${nf(a.laenge)} m bis zum ersten Knoten`, STRANG_FARBEN[(a.strand ?? 0) % STRANG_FARBEN.length], false));
  d.kuppel.forEach(e => abgangZeile(`Verbindungsleitung · ${dnText(e.dn, e.dn)}`, `${nf(e.load)} kW Übergabe · Trennstelle zur anderen Zentrale`, '#26c6da', true));
  if (!d.abgaenge.length && !d.kuppel.length) s += `<text x="${xV + 30}" y="${yTop + 30}" class="ws-erzkw">Noch kein Netz berechnet</text>`;
  const sumKw = d.erzeuger.reduce((a, e) => a + (e.kw || 0), 0);
  s += `<text x="${x0}" y="24" class="ws-titel">${esc(d.z.name)}</text><text x="${x0}" y="40" class="ws-erzkw">Erzeugerleistung ${nf(sumKw)} kW · ${d.abgaenge.length} Abgänge · Netz ${nf(d.vl)}/${nf(d.rl)} °C</text>`;
  return { svg: s, W: xEnde + 40, H };
}

export function wsRender() {
  const wrap = document.getElementById('ws-canvas');
  if (!wrap) return;
  const zentralen = _zentralen();
  const kopf = document.getElementById('ws-zentrale-wahl');
  if (kopf) {
    kopf.innerHTML = S.ansicht === 'zentrale' && zentralen.length > 1
      ? zentralen.map(z => `<button class="sld-head-btn${(S.zentrale ?? zentralen[0].id) === z.id ? ' active' : ''}" data-click="wsZentrale(${z.id})">${esc(z.name)}</button>`).join('') : '';
  }
  document.querySelectorAll('#ws-panel .ws-tab').forEach(b => b.classList.toggle('active', b.dataset.ansicht === S.ansicht));
  let svg = '', W = 600, H = 300;
  if (S.ansicht === 'netz') {
    const L = wsNetzDaten();
    if (!L) { wrap.innerHTML = '<div class="sld-empty"><span style="font-size:20px">🔥</span><span>Erst eine Heizzentrale wählen und das Wärmenetz berechnen</span></div>'; return; }
    svg = _netzSvg(L); W = L.W + 520; H = L.H + 20;
  } else {
    const d = wsZentraleDaten(S.zentrale ?? zentralen[0]?.id);
    if (!d) { wrap.innerHTML = '<div class="sld-empty"><span style="font-size:20px">🏭</span><span>Erst eine Heizzentrale wählen</span></div>'; return; }
    const r = _zentraleSvg(d); svg = r.svg; W = r.W; H = r.H;
  }
  wrap.className = '';
  wrap.innerHTML = `<svg id="ws-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:${W * S.zoom}px;height:${H * S.zoom}px;display:block;">
    <style>
      .ws-dn{font:9px 'DM Mono',monospace;fill:#b0bec5}.ws-last{font:9px 'DM Mono',monospace;fill:#78909c}
      .ws-geb{font:10px sans-serif;fill:#eceff1}.ws-gebkw{font:9px 'DM Mono',monospace;fill:#ffcc80}
      .ws-hz{font:bold 10px sans-serif;fill:#fff;text-anchor:middle}.ws-kuppel{font:10px sans-serif;fill:#26c6da}
      .ws-kopf{font:10px sans-serif;fill:#cfd8dc}.ws-sym{font:bold 13px 'DM Mono',monospace}
      .ws-erz{font:11px sans-serif;fill:#eceff1}.ws-erzkw{font:9.5px 'DM Mono',monospace;fill:#90a4ae}.ws-titel{font:bold 13px sans-serif;fill:#ffb74d}
    </style>
    <rect width="100%" height="100%" fill="#0b0e18"/>${svg}</svg>`;
}

/** Als SVG-Datei speichern (Druck/PDF über den Browser). */
export function wsExportSvg() {
  const svg = document.getElementById('ws-svg');
  if (!svg) return;
  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = S.ansicht === 'netz' ? 'Waermenetz-Schema.svg' : 'Heizzentrale-Schema.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Druckansicht (A4 quer) zum Speichern als PDF. */
export function wsDrucken() {
  const svg = document.getElementById('ws-svg');
  if (!svg) return;
  const titel = S.ansicht === 'netz' ? 'Wärmenetz – Netzschema' : 'Heizzentrale – Hydraulikschema';
  const win = window.open('', '_blank');
  if (!win) { window.showHint?.('Popup blockiert — bitte erlauben.', 4000); return; }
  win.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${titel}</title>
    <style>@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:Arial,sans-serif}h1{font-size:14pt;margin:0 0 6pt}
    svg{width:100%;height:auto;max-height:180mm}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head>
    <body><h1>${titel}</h1>${svg.outerHTML.replace(/style="width:[^"]*"/, '')}</body></html>`);
  win.document.close();
  win.addEventListener('load', () => setTimeout(() => win.print(), 400));
}
