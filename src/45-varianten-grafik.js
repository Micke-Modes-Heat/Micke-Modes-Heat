// ── 45-varianten-grafik.js — grafischer Variantenvergleich (Wärme) ──
// Wählbare Diagramme aus den gespeicherten Kennzahlen je Variante (variantResults):
// Wärmegestehungskosten nach Bestandteilen, Erzeugermix, CO₂ je Erzeuger, Investition/Jahreskosten,
// installierte Leistung und ein Netzdiagramm aller Kennzahlen (relativ zur besten Variante).
import { variantResults, varianten, activeVariantId } from './01-globals-varianten.js';
import { DA_LABELS, _daColor } from './07a-analysis-charts.js';

const ANSICHTEN = {
  wgk: 'Wärmegestehungskosten',
  mix: 'Erzeugermix (Wärme)',
  leistung: 'Installierte Leistung',
  co2: 'CO₂ je Erzeuger',
  kosten: 'Investition & Jahreskosten',
  netz: 'Kennzahlen-Netz',
};
const S = (() => { try { return { ansicht: localStorage.getItem('mmh-vg-ansicht') || 'wgk', anteil: localStorage.getItem('mmh-vg-anteil') === '1' }; } catch { return { ansicht: 'wgk', anteil: false }; } })();
let _treffer = [];
const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const name = k => k === '_autoGk' ? 'Spitzenlast-Kessel' : k === '_thermSpeicher' ? 'Wärmespeicher' : (DA_LABELS[k] || k);
const farbe = k => k === '_autoGk' ? '#90a4ae' : k === '_thermSpeicher' ? '#26a69a' : _daColor(k);

export function vgAnsicht(a) { S.ansicht = a; try { localStorage.setItem('mmh-vg-ansicht', a); } catch { /* ohne Speicher */ } vgRender(); }
export function vgAnteil(an) { S.anteil = !!an; try { localStorage.setItem('mmh-vg-anteil', an ? '1' : '0'); } catch { /* ohne Speicher */ } vgRender(); }

/** Varianten mit Kennzahlen in Spaltenreihenfolge des Vergleichs. */
export function vgDaten() {
  return ['base', ...varianten.map(v => v.id)]
    .filter(id => variantResults[id])
    .map(id => ({ id, r: variantResults[id], aktiv: (id === 'base' && activeVariantId === null) || id === activeVariantId }));
}

/** Balkensegmente je Variante für die gewählte Ansicht: [{ id, label, teile: [{ key, name, farbe, wert }] }]. */
export function vgReihen(ansicht = S.ansicht) {
  return vgDaten().map(({ id, r, aktiv }) => {
    let teile = [];
    const mwh = r.wirtKomp?.gesamtMwh || r.erzeugung || 0;
    if (ansicht === 'wgk') {
      const k = r.wirtKomp;
      if (k && mwh > 0) {
        const ct = eur => eur / mwh / 10;
        teile = [
          { key: 'kapital', name: 'Kapital (Annuität)', farbe: '#ffb74d', wert: ct(k.kapitalEur || 0) },
          { key: 'betrieb', name: 'Instandhaltung, Wartung, Bedienung', farbe: '#ce93d8', wert: ct(k.betriebEur || 0) },
          { key: 'energie', name: 'Energie', farbe: '#4fc3f7', wert: ct(k.energieEur || 0) },
          { key: 'co2', name: 'CO₂-Kosten', farbe: '#f9a825', wert: ct(k.co2Eur || 0) },
        ].filter(t => Math.abs(t.wert) > 0.005);
      } else if (r.wgkNum) teile = [{ key: 'wgk', name: 'WGK', farbe: '#ffb74d', wert: r.wgkNum }];
    } else if (ansicht === 'mix' || ansicht === 'leistung') {
      teile = (r.erzeugerDetail || []).filter(e => e.key !== '_thermSpeicher' || ansicht === 'mix')
        .map(e => ({ key: e.key, name: name(e.key), farbe: farbe(e.key), wert: ansicht === 'mix' ? e.waermeMwh || 0 : e.leistungKw || 0 }))
        .filter(t => t.wert > 0.05 && !(ansicht === 'mix' && t.key === '_thermSpeicher'));
    } else if (ansicht === 'co2') {
      const pro = r.co2ProErzeugerLZ || r.co2ProErzeuger;
      teile = pro ? Object.entries(pro).filter(([, t]) => t > 0.05).map(([k, t]) => ({ key: k, name: name(k), farbe: farbe(k), wert: t }))
        : (r.co2GesLZ || r.co2GesH) ? [{ key: 'co2', name: 'CO₂', farbe: '#e57373', wert: r.co2GesLZ || r.co2GesH }] : [];
    }
    return { id, label: r.label || id, aktiv, teile, r };
  });
}

export function vgRender() {
  const wrap = document.getElementById('vergleich-grafik-wrap');
  if (!wrap) return;
  const daten = vgDaten();
  if (!daten.length) { wrap.innerHTML = '<div class="vg-leer">Noch keine Kennzahlen — erst rechnen.</div>'; return; }
  const anteilMoeglich = S.ansicht === 'mix' || S.ansicht === 'leistung' || S.ansicht === 'co2';
  wrap.innerHTML = `
    <div class="vg-kopf">
      <div class="vg-ansicht">${Object.entries(ANSICHTEN).map(([k, t]) => `<button class="viz-btn${S.ansicht === k ? ' active' : ''}" data-click="vgAnsicht('${k}')">${t}</button>`).join('')}</div>
      ${anteilMoeglich ? `<label class="vg-check"><input type="checkbox"${S.anteil ? ' checked' : ''} data-change="vgAnteil(this.checked)"/> in % je Variante</label>` : ''}
    </div>
    <div class="vg-flaeche"><canvas id="vg-canvas" height="${S.ansicht === 'netz' ? 320 : 260}"></canvas><div id="vg-tipp" class="ga-tipp"></div></div>
    <div id="vg-legende" class="ga-info"></div>`;
  const c = document.getElementById('vg-canvas');
  c.onmousemove = ev => {
    const tip = document.getElementById('vg-tipp');
    const r = c.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const t = _treffer.find(h => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
    if (!t) { tip.style.display = 'none'; c.style.cursor = 'default'; return; }
    c.style.cursor = 'pointer';
    tip.innerHTML = t.text; tip.style.display = 'block';
    tip.style.left = Math.min(x + 12, c.clientWidth - 220) + 'px'; tip.style.top = Math.max(0, y - 10) + 'px';
  };
  c.onmouseleave = () => { const tip = document.getElementById('vg-tipp'); if (tip) tip.style.display = 'none'; };
  c.onclick = ev => {
    const r = c.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const t = _treffer.find(h => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
    if (t?.id && !t.aktiv) window.activateVariant?.(t.id === 'base' ? null : t.id);
  };
  requestAnimationFrame(() => (S.ansicht === 'netz' ? _netz() : S.ansicht === 'kosten' ? _kosten() : _balken()));
}

function _flaeche() {
  const c = document.getElementById('vg-canvas');
  if (!c) return null;
  const W = c.parentElement?.clientWidth || 800, H = Number(c.getAttribute('height')) || 260, dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px "DM Mono", monospace';
  return { ctx, W, H };
}

function _skala(max) {
  const roh = max / 4 || 1, p = Math.pow(10, Math.floor(Math.log10(roh)));
  const s = [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= roh) || 10 * p;
  return { schritt: s, max: Math.ceil(max / s) * s || s };
}

const EINHEIT = { wgk: 'ct/kWh', mix: 'MWh/a', leistung: 'kW', co2: 't CO₂/a' };

function _balken() {
  const f = _flaeche();
  if (!f) return;
  const { ctx, W, H } = f;
  _treffer = [];
  const reihen = vgReihen();
  const anteil = S.anteil && S.ansicht !== 'wgk';
  const summe = r => r.teile.reduce((s, t) => s + t.wert, 0);
  const maxRoh = anteil ? 100 : Math.max(...reihen.map(summe), 0.001);
  const sk = _skala(maxRoh * (anteil ? 1 : 1.08));
  const L = 56, R = 14, T = 22, B = 40, pw = W - L - R, ph = H - T - B;
  const y = v => T + ph * (1 - v / sk.max);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let v = 0; v <= sk.max + 1e-9; v += sk.schritt) {
    ctx.beginPath(); ctx.moveTo(L, y(v)); ctx.lineTo(W - R, y(v)); ctx.stroke();
    ctx.fillText(nf(v, sk.schritt < 1 ? 1 : 0), 4, y(v) + 3);
  }
  ctx.fillText(anteil ? '%' : EINHEIT[S.ansicht], L + 4, T - 8);
  const bw = pw / Math.max(1, reihen.length), w = Math.min(70, bw * 0.55);
  const legende = new Map();
  reihen.forEach((r, i) => {
    const cx = L + (i + 0.5) * bw, ges = summe(r);
    let basis = 0;
    r.teile.forEach(t => {
      const wert = anteil ? (ges > 0 ? t.wert / ges * 100 : 0) : t.wert;
      const y0 = y(basis + wert), y1 = y(basis);
      ctx.fillStyle = t.farbe; ctx.globalAlpha = r.aktiv ? 0.95 : 0.75;
      ctx.fillRect(cx - w / 2, y0, w, Math.max(1, y1 - y0)); ctx.globalAlpha = 1;
      _treffer.push({ x0: cx - w / 2, x1: cx + w / 2, y0, y1, id: r.id, aktiv: r.aktiv,
        text: `<b>${esc(r.label)}</b><br>${esc(t.name)}: ${nf(t.wert, t.wert < 100 ? 1 : 0)} ${EINHEIT[S.ansicht]}${ges > 0 ? ` (${nf(t.wert / ges * 100)} %)` : ''}` });
      legende.set(t.key, t);
      basis += wert;
    });
    if (!r.teile.length) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillText('—', cx - 3, y(0) - 4); }
    else if (!anteil) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; const t = nf(ges, ges < 100 ? 1 : 0); ctx.fillText(t, cx - ctx.measureText(t).width / 2, y(ges) - 4); }
    ctx.fillStyle = r.aktiv ? '#fff' : 'rgba(255,255,255,0.6)';
    const lab = r.label.length > 16 ? r.label.slice(0, 15) + '…' : r.label;
    ctx.fillText(lab, cx - ctx.measureText(lab).width / 2, H - 22);
    if (r.aktiv) ctx.fillText('aktiv', cx - 12, H - 9);
  });
  const leg = document.getElementById('vg-legende');
  if (leg) leg.innerHTML = [...legende.values()].map(t => `<span><i style="background:${t.farbe}"></i>${esc(t.name)}</span>`).join('') + '<em>Klick auf einen Balken aktiviert die Variante</em>';
}

function _kosten() {
  const f = _flaeche();
  if (!f) return;
  const { ctx, W, H } = f;
  _treffer = [];
  const d = vgDaten();
  const L = 64, R = 64, T = 22, B = 40, pw = W - L - R, ph = H - T - B;
  // Beide Achsen mit genau vier Teilungen, damit die Gitterlinien für beide passen
  const vier = max => { const sk = _skala(max); return { schritt: sk.schritt, max: Math.max(sk.max, sk.schritt * 4) }; };
  const skI0 = vier(Math.max(...d.map(x => x.r.investGes || 0), 1) * 1.08);
  const skJ0 = vier(Math.max(...d.map(x => x.r.jkGes || 0), 1) * 1.08);
  const skI = { max: Math.ceil(skI0.max / 4 / skI0.schritt) * skI0.schritt * 4 }, skJ = { max: Math.ceil(skJ0.max / 4 / skJ0.schritt) * skJ0.schritt * 4 };
  const mio = v => v >= 1e6 ? nf(v / 1e6, 2).replace(/,?0+$/, '') + ' Mio' : nf(v / 1e3) + ' T';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i <= 4; i++) {
    const yy = T + ph * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
    ctx.fillStyle = '#ffb74d'; ctx.fillText(mio(skI.max * i / 4), 4, yy + 3);
    ctx.fillStyle = '#4fc3f7'; ctx.fillText(mio(skJ.max * i / 4), W - R + 4, yy + 3);
  }
  ctx.fillStyle = '#ffb74d'; ctx.fillText('Investition €', 4, T - 8);
  ctx.fillStyle = '#4fc3f7'; ctx.fillText('Jahreskosten €/a', W - R - 60, T - 8);
  const bw = pw / Math.max(1, d.length), w = Math.min(34, bw * 0.28);
  d.forEach(({ id, r, aktiv }, i) => {
    const cx = L + (i + 0.5) * bw;
    const hI = (r.investGes || 0) / skI.max * ph, hJ = (r.jkGes || 0) / skJ.max * ph;
    ctx.globalAlpha = aktiv ? 0.95 : 0.75;
    ctx.fillStyle = '#ffb74d'; ctx.fillRect(cx - w - 2, T + ph - hI, w, hI);
    ctx.fillStyle = '#4fc3f7'; ctx.fillRect(cx + 2, T + ph - hJ, w, hJ);
    ctx.globalAlpha = 1;
    _treffer.push({ x0: cx - w - 2, x1: cx + w + 2, y0: T + ph - Math.max(hI, hJ), y1: T + ph, id, aktiv,
      text: `<b>${esc(r.label)}</b><br>Investition: ${nf(r.investGes)} €<br>Jahreskosten: ${nf(r.jkGes)} €/a${r.wgkNum ? `<br>WGK: ${nf(r.wgkNum, 1)} ct/kWh` : ''}` });
    ctx.fillStyle = aktiv ? '#fff' : 'rgba(255,255,255,0.6)';
    const lab = (r.label || id).length > 16 ? (r.label || id).slice(0, 15) + '…' : (r.label || id);
    ctx.fillText(lab, cx - ctx.measureText(lab).width / 2, H - 22);
  });
  const leg = document.getElementById('vg-legende');
  if (leg) leg.innerHTML = '<span><i style="background:#ffb74d"></i>Investition (linke Achse)</span><span><i style="background:#4fc3f7"></i>Jahreskosten (rechte Achse)</span>';
}

/** Netzdiagramm: je Kennzahl 100 % = beste Variante, außen ist besser. */
export function vgNetzWerte() {
  const d = vgDaten();
  const achsen = [
    { name: 'WGK', wert: r => r.wgkNum, besser: 'min' },
    { name: 'CO₂', wert: r => r.co2GesLZ || r.co2GesH, besser: 'min' },
    { name: 'Investition', wert: r => r.investGes, besser: 'min' },
    { name: 'Jahreskosten', wert: r => r.jkGes, besser: 'min' },
    { name: 'EE-Anteil', wert: r => r.eeAnteil, besser: 'max' },
    { name: 'Netzverluste', wert: r => r.netzverlustePct, besser: 'min' },
  ];
  return {
    achsen,
    reihen: d.map(({ id, r, aktiv }) => ({
      id, label: r.label || id, aktiv,
      werte: achsen.map(a => {
        const vs = d.map(x => a.wert(x.r)).filter(v => Number.isFinite(v) && v > 0);
        const v = a.wert(r);
        if (!Number.isFinite(v) || !vs.length) return null;
        if (a.besser === 'max') return Math.max(...vs) > 0 ? v / Math.max(...vs) : null;
        return v > 0 ? Math.min(...vs) / v : null;
      }),
      roh: achsen.map(a => a.wert(r)),
    })),
  };
}

function _netz() {
  const f = _flaeche();
  if (!f) return;
  const { ctx, W, H } = f;
  _treffer = [];
  const { achsen, reihen } = vgNetzWerte();
  const cx = W / 2 - 80, cy = H / 2 + 6, rad = Math.min(H / 2 - 30, W / 2 - 140);
  const winkel = i => -Math.PI / 2 + i * 2 * Math.PI / achsen.length;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  for (const s of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    achsen.forEach((_, i) => { const x = cx + Math.cos(winkel(i)) * rad * s, y = cy + Math.sin(winkel(i)) * rad * s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  achsen.forEach((a, i) => {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(winkel(i)) * rad, cy + Math.sin(winkel(i)) * rad); ctx.stroke();
    const x = cx + Math.cos(winkel(i)) * (rad + 14), y = cy + Math.sin(winkel(i)) * (rad + 14);
    ctx.fillText(a.name, x - ctx.measureText(a.name).width / 2, y + 3);
  });
  const FARBEN = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#e57373', '#4db6ac', '#fff176', '#f06292'];
  reihen.forEach((r, ri) => {
    const fb = FARBEN[ri % FARBEN.length];
    ctx.strokeStyle = fb; ctx.fillStyle = fb; ctx.lineWidth = r.aktiv ? 2.5 : 1.5;
    ctx.beginPath();
    r.werte.forEach((v, i) => { const s = v ?? 0, x = cx + Math.cos(winkel(i)) * rad * s, y = cy + Math.sin(winkel(i)) * rad * s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); ctx.lineWidth = 1;
    // Legende rechts
    const ly = 24 + ri * 18, lx = W - 200;
    ctx.fillRect(lx, ly - 8, 10, 10);
    ctx.fillStyle = r.aktiv ? '#fff' : 'rgba(255,255,255,0.75)';
    ctx.fillText(r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label, lx + 16, ly + 1);
    _treffer.push({ x0: lx, x1: W - 10, y0: ly - 10, y1: ly + 6, id: r.id, aktiv: r.aktiv,
      text: `<b>${esc(r.label)}</b><br>` + achsen.map((a, i) => `${a.name}: ${r.roh[i] != null ? nf(r.roh[i], r.roh[i] < 100 ? 1 : 0) : '—'}`).join('<br>') });
  });
  const leg = document.getElementById('vg-legende');
  if (leg) leg.innerHTML = '<em>Je Achse 100 % (außen) = beste Variante; WGK, CO₂, Kosten und Verluste: weniger ist besser · Klick auf einen Namen aktiviert die Variante</em>';
}
