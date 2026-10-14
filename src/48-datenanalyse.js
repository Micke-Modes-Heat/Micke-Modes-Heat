// ── 48-datenanalyse.js — Datenanalyse: interaktive Diagramme und Auswertung je Wärmepumpe ──
// Diagramm-Komponente (Canvas) für Stundenreihen: Zeitverlauf mit Zoom (Bereich aufziehen, Doppelklick = alles) und
// Fadenkreuz, Streuung mit Farbskala, Carpet (Tag × Stunde), Monatsbalken, Dauerlinie. Darauf aufbauend die
// COP-Analyse je Wärmepumpe im Reiter „VL / COP“ (Stundenreihen aus der Einsatzplanung, window._wpStunden).

import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
import {
  MONATE, MONATS_START_H, stundeAlsText, klassieren, monatsSummen, dauerlinie, statistik, quotient,
  farbeSkala, achsenTicks,
} from './lib/datenanalyse.js';

const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function themaFarben() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
  return { text: v('--text', '#ece8df'), muted: v('--muted', '#aca496'), border: v('--border', '#333844'), bg: v('--surface2', '#22262e') };
}

// ══ Diagramm-Komponente ══════════════════════════════════════════════════════
/**
 * Diagramm auf einem Canvas. setze(spec) mit spec.art:
 *   'zeit'   { reihen: [{ name, farbe, werte, achse: 'l'|'r', einheit, band }], fenster: [a, b], einheitL, einheitR, beiZoom(a, b) }
 *   'streu'  { x, y, farbe (Werte für die Farbskala, optional), maske, xName, yName, farbName, grau: { x, y } }
 *   'carpet' { werte, maske, name, einheit, lo, hi, kategorien: { wert: [Farbe, Name] } (optional) }
 *   'balken' { werte (12), beschriftung (12, optional), name, einheit, farbe }
 *   'dauer'  { werte (absteigend), name, einheit, farbe, linie: { wert, name } }
 */
export class DaDiagramm {
  constructor(canvas, tipEl) {
    this.c = canvas; this.tip = tipEl; this.spec = null; this.geo = null; this.ziehen = null;
    canvas.addEventListener('mousemove', e => this._bewegen(e));
    canvas.addEventListener('mouseleave', () => { this._tip(null); this.ziehen = null; this.zeichnen(); });
    canvas.addEventListener('mousedown', e => { if (this.spec?.art === 'zeit') { this.ziehen = { x0: this._mx(e), x1: this._mx(e) }; } });
    canvas.addEventListener('mouseup', () => this._loslassen());
    canvas.addEventListener('dblclick', () => { if (this.spec?.art === 'zeit') this.spec.beiZoom?.(0, 8760); });
  }
  _mx(e) { const r = this.c.getBoundingClientRect(); return e.clientX - r.left; }
  _my(e) { const r = this.c.getBoundingClientRect(); return e.clientY - r.top; }
  setze(spec) { this.spec = spec; this.zeichnen(); }

  _vorbereiten() {
    const dpr = window.devicePixelRatio || 1;
    const W = this.c.clientWidth || this.c.parentElement?.clientWidth || 700;
    const H = Number(this.c.getAttribute('height')) || 260;
    if (this.c.width !== Math.round(W * dpr)) { this.c.width = Math.round(W * dpr); }
    this.c.height = Math.round(H * dpr);
    this.c.style.height = H + 'px';
    const ctx = this.c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H, f: themaFarben() };
  }

  zeichnen() {
    if (!this.spec || !this.c.isConnected) return;
    const z = this._vorbereiten();
    const art = this.spec.art;
    if (art === 'zeit') this._zeit(z);
    else if (art === 'streu') this._streu(z);
    else if (art === 'carpet') this._carpet(z);
    else if (art === 'balken') this._balken(z);
    else if (art === 'dauer') this._dauer(z);
  }

  _achseY(ctx, f, lo, hi, x, links, PAD, pH, einheit) {
    const y = v => PAD.t + pH * (1 - (v - lo) / ((hi - lo) || 1));
    ctx.font = '9px system-ui'; ctx.fillStyle = f.muted; ctx.textAlign = links ? 'right' : 'left';
    for (const v of achsenTicks(lo, hi, 4)) ctx.fillText(nf(v, Math.abs(hi - lo) < 5 ? 1 : 0), x, y(v) + 3);
    if (einheit) { ctx.fillText(einheit, x, PAD.t - 2); }
    return y;
  }

  _zeit({ ctx, W, H, f }) {
    const s = this.spec, [a, b] = s.fenster || [0, 8760];
    const hatR = s.reihen.some(r => r.achse === 'r');
    const PAD = { l: 44, r: hatR ? 44 : 12, t: 14, b: 22 };
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b;
    const klassen = Math.max(10, Math.min(Math.round(pW), Math.ceil(b - a)));
    const kl = s.reihen.map(r => klassieren(r.werte, a, b, klassen));
    const bereich = achse => {
      let lo = Infinity, hi = -Infinity;
      s.reihen.forEach((r, i) => { if ((r.achse || 'l') !== achse) return; const k = kl[i]; for (let j = 0; j < klassen; j++) { if (k.anzahl[j]) { lo = Math.min(lo, r.band ? k.min[j] : k.mittel[j]); hi = Math.max(hi, r.band ? k.max[j] : k.mittel[j]); } } });
      if (!Number.isFinite(lo)) return [0, 1];
      const rand = (hi - lo) * 0.06 || 1;
      return [lo - rand, hi + rand];
    };
    const [lL, hL] = bereich('l'), [lR, hR] = bereich('r');
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(PAD.l, PAD.t, pW, pH);
    const x = t => PAD.l + (t - a) / (b - a) * pW;
    // Zeitachse: Monate oder Tage
    ctx.strokeStyle = f.border; ctx.lineWidth = 0.5; ctx.font = '9px system-ui'; ctx.fillStyle = f.muted; ctx.textAlign = 'center';
    if (b - a > 24 * 45) {
      for (let m = 0; m < 12; m++) { const t0 = MONATS_START_H[m]; if (t0 < a || t0 > b) continue; ctx.beginPath(); ctx.moveTo(x(t0), PAD.t); ctx.lineTo(x(t0), PAD.t + pH); ctx.stroke(); }
      for (let m = 0; m < 12; m++) { const tm = (MONATS_START_H[m] + MONATS_START_H[m + 1]) / 2; if (tm > a && tm < b) ctx.fillText(MONATE[m], x(tm), H - 6); }
    } else {
      const schritt = b - a > 24 * 10 ? 24 * 7 : 24;
      for (let t = Math.ceil(a / schritt) * schritt; t < b; t += schritt) {
        ctx.beginPath(); ctx.moveTo(x(t), PAD.t); ctx.lineTo(x(t), PAD.t + pH); ctx.stroke();
        ctx.fillText(stundeAlsText(t).slice(0, 9), x(t) + (schritt === 24 ? x(t + 24) - x(t) : 0) / 2, H - 6);
      }
    }
    const yL = this._achseY(ctx, f, lL, hL, PAD.l - 4, true, PAD, pH, s.einheitL);
    const yR = hatR ? this._achseY(ctx, f, lR, hR, W - PAD.r + 4, false, PAD, pH, s.einheitR) : null;
    s.reihen.forEach((r, i) => {
      const k = kl[i], y = r.achse === 'r' ? yR : yL;
      const xk = j => PAD.l + (j + 0.5) / klassen * pW;
      if (r.band && klassen < b - a) {
        ctx.fillStyle = r.farbe; ctx.globalAlpha = 0.18;
        for (let j = 0; j < klassen; j++) if (k.anzahl[j]) { const y1 = y(k.max[j]), y2 = y(k.min[j]); ctx.fillRect(xk(j) - pW / klassen / 2, y1, Math.max(1, pW / klassen), Math.max(1, y2 - y1)); }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = r.farbe; ctx.lineWidth = 1.3; ctx.beginPath();
      let offen = false;
      for (let j = 0; j < klassen; j++) {
        if (!k.anzahl[j]) { offen = false; continue; }
        const px = xk(j), py = y(k.mittel[j]);
        if (!offen) { ctx.moveTo(px, py); offen = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    });
    if (this.ziehen) {
      ctx.fillStyle = 'rgba(79,195,247,0.15)';
      ctx.fillRect(Math.min(this.ziehen.x0, this.ziehen.x1), PAD.t, Math.abs(this.ziehen.x1 - this.ziehen.x0), pH);
    }
    this.geo = { PAD, pW, pH, a, b, x, tAus: px => a + (px - PAD.l) / pW * (b - a) };
  }

  _streu({ ctx, W, H, f }) {
    const s = this.spec;
    const PAD = { l: 44, r: s.farbe ? 64 : 12, t: 14, b: 30 };
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b;
    const ok = t => Number.isFinite(s.x[t]) && Number.isFinite(s.y[t]) && (!s.maske || s.maske[t]);
    const sx = statistik(s.x, s.maske), sy = statistik(s.y, s.maske);
    const g = s.grau ? [statistik(s.grau.x), statistik(s.grau.y)] : null;
    const xlo = Math.min(sx.min, g ? g[0].min : Infinity), xhi = Math.max(sx.max, g ? g[0].max : -Infinity);
    const ylo = Math.min(sy.min, g ? g[1].min : Infinity), yhi = Math.max(sy.max, g ? g[1].max : -Infinity);
    if (!Number.isFinite(xlo) || !Number.isFinite(ylo)) { ctx.fillStyle = f.muted; ctx.fillText('Keine Werte im gewählten Zeitraum', PAD.l, H / 2); this.geo = null; return; }
    const rx = (xhi - xlo) * 0.05 || 1, ry = (yhi - ylo) * 0.05 || 1;
    const X = [xlo - rx, xhi + rx], Y = [ylo - ry, yhi + ry];
    const x = v => PAD.l + (v - X[0]) / (X[1] - X[0]) * pW, y = v => PAD.t + pH * (1 - (v - Y[0]) / (Y[1] - Y[0]));
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(PAD.l, PAD.t, pW, pH);
    ctx.font = '9px system-ui'; ctx.fillStyle = f.muted; ctx.strokeStyle = f.border; ctx.lineWidth = 0.5;
    ctx.textAlign = 'center';
    for (const v of achsenTicks(X[0], X[1], 6)) { ctx.beginPath(); ctx.moveTo(x(v), PAD.t); ctx.lineTo(x(v), PAD.t + pH); ctx.stroke(); ctx.fillText(nf(v, 0), x(v), PAD.t + pH + 11); }
    ctx.fillText(s.xName || '', PAD.l + pW / 2, H - 4);
    ctx.textAlign = 'right';
    for (const v of achsenTicks(Y[0], Y[1], 5)) { ctx.beginPath(); ctx.moveTo(PAD.l, y(v)); ctx.lineTo(PAD.l + pW, y(v)); ctx.stroke(); ctx.fillText(nf(v, 1), PAD.l - 4, y(v) + 3); }
    ctx.textAlign = 'left'; ctx.fillText(s.yName || '', PAD.l + 4, PAD.t - 3);
    if (s.grau) {
      ctx.fillStyle = 'rgba(160,160,160,0.18)';
      for (let t = 0; t < s.grau.x.length; t++) if (Number.isFinite(s.grau.x[t]) && Number.isFinite(s.grau.y[t])) ctx.fillRect(x(s.grau.x[t]) - 1, y(s.grau.y[t]) - 1, 2, 2);
    }
    const sf = s.farbe ? statistik(s.farbe, s.maske) : null;
    const punkte = [];
    for (let t = 0; t < s.x.length; t++) {
      if (!ok(t)) continue;
      const px = x(s.x[t]), py = y(s.y[t]);
      ctx.fillStyle = sf ? farbeSkala((s.farbe[t] - sf.min) / ((sf.max - sf.min) || 1)) : '#4fc3f7';
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      punkte.push([px, py, t]);
    }
    if (sf) {   // Farblegende
      const lx = W - PAD.r + 14, lh = pH;
      for (let i = 0; i < lh; i++) { ctx.fillStyle = farbeSkala(1 - i / lh); ctx.fillRect(lx, PAD.t + i, 10, 1); }
      ctx.fillStyle = f.muted; ctx.textAlign = 'left';
      ctx.fillText(nf(sf.max, 0), lx + 13, PAD.t + 8); ctx.fillText(nf(sf.min, 0), lx + 13, PAD.t + lh);
      ctx.save(); ctx.translate(lx - 4, PAD.t + lh / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(s.farbName || '', 0, 0); ctx.restore();
    }
    this.geo = { punkte };
  }

  _carpet({ ctx, W, H, f }) {
    const s = this.spec;
    const PAD = { l: 30, r: s.kategorien ? 12 : 56, t: 8, b: 18 };
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b;
    const st = statistik(s.werte, s.maske);
    const lo = s.lo ?? st.min, hi = s.hi ?? st.max;
    const cw = pW / 365, ch = pH / 24;
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(PAD.l, PAD.t, pW, pH);
    for (let t = 0; t < 8760; t++) {
      const v = s.werte[t];
      if (!Number.isFinite(v) || (s.maske && !s.maske[t])) continue;
      ctx.fillStyle = s.kategorien ? (s.kategorien[v]?.[0] || 'transparent') : farbeSkala((v - lo) / ((hi - lo) || 1));
      ctx.fillRect(PAD.l + Math.floor(t / 24) * cw, PAD.t + (t % 24) * ch, Math.ceil(cw), Math.ceil(ch));
    }
    ctx.font = '9px system-ui'; ctx.fillStyle = f.muted; ctx.textAlign = 'right';
    for (const h of [0, 6, 12, 18, 24]) ctx.fillText(h + ' h', PAD.l - 3, PAD.t + h * ch + 3);
    ctx.textAlign = 'center';
    for (let m = 0; m < 12; m++) ctx.fillText(MONATE[m], PAD.l + (MONATS_START_H[m] + MONATS_START_H[m + 1]) / 48 * cw, H - 5);
    if (!s.kategorien) {
      const lx = W - PAD.r + 10;
      for (let i = 0; i < pH; i++) { ctx.fillStyle = farbeSkala(1 - i / pH); ctx.fillRect(lx, PAD.t + i, 10, 1); }
      ctx.fillStyle = f.muted; ctx.textAlign = 'left';
      ctx.fillText(nf(hi, 1), lx + 13, PAD.t + 8); ctx.fillText(nf(lo, 1), lx + 13, PAD.t + pH);
    }
    this.geo = { PAD, cw, ch };
  }

  _balken({ ctx, W, H, f }) {
    const s = this.spec;
    const PAD = { l: 44, r: 12, t: 16, b: 20 };
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b;
    const hi = Math.max(...s.werte.filter(Number.isFinite), 0) * 1.12 || 1;
    const y = v => PAD.t + pH * (1 - v / hi);
    this._achseY(ctx, f, 0, hi, PAD.l - 4, true, PAD, pH, s.einheit);
    const bw = pW / 12;
    s.werte.forEach((v, m) => {
      if (!Number.isFinite(v)) return;
      ctx.fillStyle = s.farbe || '#4fc3f7';
      ctx.fillRect(PAD.l + m * bw + bw * 0.15, y(v), bw * 0.7, PAD.t + pH - y(v));
      ctx.fillStyle = f.text; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(s.beschriftung?.[m] ?? nf(v, 1), PAD.l + (m + 0.5) * bw, y(v) - 3);
    });
    ctx.fillStyle = f.muted;
    MONATE.forEach((n, m) => ctx.fillText(n, PAD.l + (m + 0.5) * bw, H - 6));
    this.geo = { PAD, bw };
  }

  _dauer({ ctx, W, H, f }) {
    const s = this.spec, n = s.werte.length;
    const PAD = { l: 44, r: 12, t: 16, b: 22 };
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b;
    if (!n) { ctx.fillStyle = f.muted; ctx.fillText('Keine Betriebsstunden im gewählten Zeitraum', PAD.l, H / 2); this.geo = null; return; }
    const lo = Math.min(s.werte[n - 1], s.linie?.wert ?? Infinity) * 0.95, hi = s.werte[0] * 1.05;
    const y = this._achseY(ctx, f, lo, hi, PAD.l - 4, true, PAD, pH, s.einheit);
    const x = i => PAD.l + i / Math.max(1, n - 1) * pW;
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(PAD.l, PAD.t, pW, pH);
    ctx.strokeStyle = s.farbe || '#4fc3f7'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / pW))) { if (i === 0) ctx.moveTo(x(i), y(s.werte[i])); else ctx.lineTo(x(i), y(s.werte[i])); }
    ctx.lineTo(x(n - 1), y(s.werte[n - 1])); ctx.stroke();
    if (s.linie && Number.isFinite(s.linie.wert)) {
      ctx.strokeStyle = '#ef5350'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(PAD.l, y(s.linie.wert)); ctx.lineTo(PAD.l + pW, y(s.linie.wert)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ef5350'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText(s.linie.name, PAD.l + pW - 2, y(s.linie.wert) - 3);
    }
    ctx.fillStyle = f.muted; ctx.font = '9px system-ui';
    ctx.textAlign = 'right'; ctx.fillText(nf(n) + ' h', PAD.l + pW, H - 6);
    ctx.textAlign = 'left'; ctx.fillText('0 h', PAD.l, H - 6);
    this.geo = { PAD, pW, n, x };
  }

  _tip(html, mx, my) {
    if (!this.tip) return;
    if (!html) { this.tip.style.display = 'none'; return; }
    this.tip.innerHTML = html; this.tip.style.display = 'block';
    const W = this.c.clientWidth, b = this.tip.offsetWidth || 160;
    this.tip.style.left = Math.min(W - b - 4, mx + 12) + 'px';
    this.tip.style.top = Math.max(0, my - 10) + 'px';
  }

  _bewegen(e) {
    const s = this.spec, g = this.geo;
    if (!s || !g) return;
    const mx = this._mx(e), my = this._my(e);
    if (s.art === 'zeit') {
      if (this.ziehen) { this.ziehen.x1 = mx; this.zeichnen(); return; }
      const t = Math.round(g.tAus(mx));
      if (t < g.a || t >= g.b) { this._tip(null); this.zeichnen(); return; }
      this.zeichnen();
      const ctx = this.c.getContext('2d');
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.x(t), g.PAD.t); ctx.lineTo(g.x(t), g.PAD.t + g.pH); ctx.stroke();
      const zeilen = s.reihen.map(r => `<span style="color:${r.farbe}">■</span> ${esc(r.name)}: <b>${nf(r.werte[t], Math.abs(r.werte[t]) < 20 ? 2 : 0)}</b> ${esc(r.einheit || '')}`);
      this._tip(`<b>${stundeAlsText(t)}</b><br>${zeilen.join('<br>')}`, mx, my);
    } else if (s.art === 'streu') {
      let best = null, bd = 64;
      for (const p of g.punkte) { const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2; if (d < bd) { bd = d; best = p; } }
      if (!best) { this._tip(null); return; }
      const t = best[2];
      this._tip(`<b>${stundeAlsText(t)}</b><br>${esc(s.xName)}: <b>${nf(s.x[t], 1)}</b><br>${esc(s.yName)}: <b>${nf(s.y[t], 2)}</b>${s.farbe ? `<br>${esc(s.farbName)}: <b>${nf(s.farbe[t], 1)}</b>` : ''}`, mx, my);
    } else if (s.art === 'carpet') {
      const tag = Math.floor((mx - g.PAD.l) / g.cw), h = Math.floor((my - g.PAD.t) / g.ch);
      if (tag < 0 || tag >= 365 || h < 0 || h >= 24) { this._tip(null); return; }
      const t = tag * 24 + h, v = s.werte[t];
      const txt = s.kategorien ? (s.kategorien[v]?.[1] ?? '—') : nf(v, 2) + ' ' + (s.einheit || '');
      this._tip(`<b>${stundeAlsText(t)}</b><br>${esc(s.name)}: <b>${esc(txt)}</b>`, mx, my);
    } else if (s.art === 'balken') {
      const m = Math.floor((mx - g.PAD.l) / g.bw);
      if (m < 0 || m > 11) { this._tip(null); return; }
      this._tip(`<b>${MONATE[m]}</b><br>${esc(s.name)}: <b>${nf(s.werte[m], 2)}</b> ${esc(s.einheit || '')}${s.zusatz?.[m] ? '<br>' + s.zusatz[m] : ''}`, mx, my);
    } else if (s.art === 'dauer') {
      const i = Math.round((mx - g.PAD.l) / g.pW * (g.n - 1));
      if (i < 0 || i >= g.n) { this._tip(null); return; }
      this._tip(`${nf(i + 1)} h mit ≥ <b>${nf(s.werte[i], 2)}</b> ${esc(s.einheit || '')}`, mx, my);
    }
  }

  _loslassen() {
    const s = this.spec, g = this.geo, z = this.ziehen;
    this.ziehen = null;
    if (!s || s.art !== 'zeit' || !g || !z) return;
    if (Math.abs(z.x1 - z.x0) < 6) { this.zeichnen(); return; }
    const a = Math.max(0, Math.floor(g.tAus(Math.min(z.x0, z.x1)))), b = Math.min(8760, Math.ceil(g.tAus(Math.max(z.x0, z.x1))));
    if (b - a >= 6) s.beiZoom?.(a, b); else this.zeichnen();
  }
}

// ══ COP-Analyse je Wärmepumpe (Reiter „VL / COP“) ═════════════════════════════
const WPA = { wp: 'alle', ansicht: 'verlauf', fenster: [0, 8760], xAchse: 'tq', carpet: 'cop', mitTheorie: false };
let _wpaDiagramm = null;
const ANSICHTEN = [['verlauf', 'Verlauf'], ['kennlinie', 'Kennlinie'], ['carpet', 'Tag × Stunde'], ['monate', 'Monats-JAZ'], ['dauer', 'Dauerlinie']];
const RANG = [0, 2, 3, 1];   // „Alle“: Leistungsgrenze vor in Betrieb vor gesperrt vor aus
const STATUS_KAT = { 0: ['rgba(120,120,120,0.35)', 'aus'], 1: ['#66bb6a', 'in Betrieb'], 2: ['#ffb74d', 'an der Leistungsgrenze'], 3: ['#ef5350', 'gesperrt (Mindest-COP, Quelle)'] };

/** Daten der gewählten Wärmepumpe oder aller zusammen. */
function wpDaten() {
  const alle = window._wpStunden || {};
  const keys = Object.keys(alle).filter(k => alle[k]?.th);
  if (!keys.length) return null;
  const ss = window.systemState || {};
  if (WPA.wp !== 'alle' && alle[WPA.wp]) {
    const W = alle[WPA.wp];
    return { keys, key: WPA.wp, name: ERZEUGER_CFG[WPA.wp]?.label || WPA.wp, farbe: ERZEUGER_CFG[WPA.wp]?.color || '#66bb6a',
      th: W.th, el: W.el, cop: quotient(W.th, W.el), copTheorie: W.cop, tq: W.tq, status: W.status, vl: ss.vlH, at: ss.tempH };
  }
  const n = 8760, th = new Float32Array(n), el = new Float32Array(n), status = new Uint8Array(n);
  for (const k of keys) { const W = alle[k]; for (let t = 0; t < n; t++) { th[t] += W.th[t]; el[t] += W.el[t]; if (RANG[W.status[t]] > RANG[status[t]]) status[t] = W.status[t]; } }
  return { keys, key: 'alle', name: 'Alle Wärmepumpen', farbe: '#4fc3f7', th, el, cop: quotient(th, el), copTheorie: null, tq: null, status, vl: ss.vlH, at: ss.tempH };
}

function fensterMaske() {
  const [a, b] = WPA.fenster, m = new Uint8Array(8760);
  for (let t = a; t < b; t++) m[t] = 1;
  return m;
}

export function wpaSetze(feld, wert) {
  if (feld === 'fenster') {
    const v = String(wert);
    if (v === 'jahr') WPA.fenster = [0, 8760];
    else if (v.startsWith('m')) { const m = Number(v.slice(1)); WPA.fenster = [MONATS_START_H[m], MONATS_START_H[m + 1]]; }
    else if (v === 'kalt') {
      const at = window.systemState?.tempH;
      let best = 0, bv = Infinity;
      if (at) for (let d = 0; d <= 358; d++) { let s = 0; for (let t = d * 24; t < (d + 7) * 24; t++) s += at[t]; if (s < bv) { bv = s; best = d; } }
      WPA.fenster = [best * 24, best * 24 + 168];
    }
  } else WPA[feld] = wert;
  wpAnalyseRender();
}

/** Auswertung je Wärmepumpe rendern (Container #wp-analyse im Reiter „VL / COP“). */
export function wpAnalyseRender() {
  const wrap = document.getElementById('wp-analyse');
  if (!wrap) return;
  const d = wpDaten();
  if (!d) { wrap.innerHTML = '<div class="wpa-leer">Keine Wärmepumpe in der Einsatzplanung — Luft-, Geo- oder Flusswasser-WP hinzufügen und berechnen.</div>'; return; }
  if (WPA.wp !== 'alle' && !d.keys.includes(WPA.wp)) WPA.wp = 'alle';
  const maske = fensterMaske();
  const betrieb = new Uint8Array(8760);
  for (let t = 0; t < 8760; t++) betrieb[t] = maske[t] && d.el[t] > 0.5 ? 1 : 0;
  // Kennzahlen im Zeitraum
  const thS = statistik(d.th, maske).summe, elS = statistik(d.el, maske).summe;
  const copB = statistik(d.cop, betrieb);
  let hBetrieb = 0, hGrenze = 0, hSperre = 0;
  for (let t = 0; t < 8760; t++) { if (!maske[t]) continue; if (d.status[t] === 1 || d.status[t] === 2) hBetrieb++; if (d.status[t] === 2) hGrenze++; if (d.status[t] === 3) hSperre++; }
  const [a, b] = WPA.fenster;
  const zeitraum = a === 0 && b === 8760 ? 'ganzes Jahr' : `${stundeAlsText(a, false).slice(0, 6)} – ${stundeAlsText(b - 1, false).slice(0, 6)}`;
  const chip = (k, name, farbe) => `<button class="viz-btn${WPA.wp === k ? ' active' : ''}" data-click="wpaSetze('wp','${k}')"><span style="color:${farbe}">●</span> ${esc(name)}</button>`;
  const ansicht = ANSICHTEN.map(([k, n]) => `<button class="viz-btn${WPA.ansicht === k ? ' active' : ''}" data-click="wpaSetze('ansicht','${k}')">${n}</button>`).join('');
  const optionen = WPA.ansicht === 'kennlinie'
    ? `<label>x-Achse <select class="inp-field" data-change="wpaSetze('xAchse', this.value)">${[['tq', 'Quelltemperatur'], ['at', 'Außentemperatur'], ['vl', 'Vorlauftemperatur']].filter(([k]) => k !== 'tq' || d.tq).map(([k, n]) => `<option value="${k}"${WPA.xAchse === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
       ${d.copTheorie ? `<label><input type="checkbox"${WPA.mitTheorie ? ' checked' : ''} data-change="wpaSetze('mitTheorie', this.checked)"> auch Stunden ohne Betrieb (grau)</label>` : ''}`
    : WPA.ansicht === 'carpet'
      ? `<label>Wert <select class="inp-field" data-change="wpaSetze('carpet', this.value)">${[['cop', 'COP'], ['th', 'Wärme kW'], ['el', 'Strom kW'], ['status', 'Betriebszustand']].map(([k, n]) => `<option value="${k}"${WPA.carpet === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
      : '';
  wrap.innerHTML = `
    <div class="wpa-kopf">
      <div class="wpa-chips">${chip('alle', 'Alle', '#4fc3f7')}${d.keys.map(k => chip(k, ERZEUGER_CFG[k]?.label || k, ERZEUGER_CFG[k]?.color || '#aaa')).join('')}</div>
      <div class="wpa-ansicht">${ansicht}</div>
    </div>
    <div class="wpa-kpis">
      <div><b>${nf(elS > 0 ? thS / elS : NaN, 2)}</b><span>JAZ</span></div>
      <div><b>${nf(copB.min, 2)} · ${nf(copB.mittel, 2)} · ${nf(copB.max, 2)}</b><span>COP min · Ø · max</span></div>
      <div><b>${nf(thS / 1000, 0)} / ${nf(elS / 1000, 0)}</b><span>Wärme / Strom MWh</span></div>
      <div><b>${nf(hBetrieb)} h</b><span>in Betrieb</span></div>
      <div><b>${nf(hGrenze)} h</b><span>an der Leistungsgrenze</span></div>
      <div><b>${nf(hSperre)} h</b><span>gesperrt</span></div>
    </div>
    <div class="wpa-zeit">
      <span>Zeitraum: <b>${zeitraum}</b></span>
      <select class="inp-field" data-change="wpaSetze('fenster', this.value)">
        <option value="">— wählen —</option><option value="jahr">ganzes Jahr</option><option value="kalt">kälteste Woche</option>
        ${MONATE.map((n, m) => `<option value="m${m}">${n}</option>`).join('')}
      </select>
      ${WPA.ansicht === 'verlauf' ? '<small>Bereich mit der Maus aufziehen = Zoom · Doppelklick = ganzes Jahr</small>' : '<small>Auswertung im gewählten Zeitraum (im Verlauf per Zoom wählbar)</small>'}
      ${optionen}
    </div>
    <div class="wpa-diagramm"><canvas id="wpa-canvas" height="300"></canvas><div class="wpa-tip"></div></div>
    <div class="wpa-legende" id="wpa-legende"></div>`;
  const canvas = document.getElementById('wpa-canvas');
  _wpaDiagramm = new DaDiagramm(canvas, wrap.querySelector('.wpa-tip'));
  const legende = document.getElementById('wpa-legende');
  const leg = eintraege => { legende.innerHTML = eintraege.map(([f, n]) => `<span><span style="color:${f}">■</span> ${esc(n)}</span>`).join(''); };
  const copNaN = Float32Array.from(d.cop, (v, t) => (betrieb[t] ? v : NaN));

  if (WPA.ansicht === 'verlauf') {
    const reihen = [{ name: 'COP', farbe: d.farbe, werte: Float32Array.from(d.cop), achse: 'l', einheit: '', band: true }];
    if (d.tq) reihen.push({ name: 'Quelltemperatur', farbe: '#29b6f6', werte: d.tq, achse: 'r', einheit: '°C' });
    if (d.vl) reihen.push({ name: 'Vorlauf', farbe: '#ef5350', werte: d.vl, achse: 'r', einheit: '°C' });
    if (d.at) reihen.push({ name: 'Außentemperatur', farbe: '#9e9e9e', werte: d.at, achse: 'r', einheit: '°C' });
    _wpaDiagramm.setze({ art: 'zeit', reihen, fenster: WPA.fenster, einheitL: 'COP', einheitR: '°C', beiZoom: (aa, bb) => { WPA.fenster = [aa, bb]; wpAnalyseRender(); } });
    leg(reihen.map(r => [r.farbe, r.name + (r.band ? ' (Linie Mittel, Band min–max)' : '')]));
  } else if (WPA.ansicht === 'kennlinie') {
    const xw = WPA.xAchse === 'tq' && d.tq ? d.tq : WPA.xAchse === 'vl' ? d.vl : d.at;
    const xName = WPA.xAchse === 'tq' && d.tq ? 'Quelltemperatur °C' : WPA.xAchse === 'vl' ? 'Vorlauftemperatur °C' : 'Außentemperatur °C';
    const farbe = WPA.xAchse === 'vl' ? d.at : d.vl, farbName = WPA.xAchse === 'vl' ? 'Außentemp. °C' : 'Vorlauf °C';
    const grau = WPA.mitTheorie && d.copTheorie ? { x: Float32Array.from(xw, (v, t) => (maske[t] && !betrieb[t] && d.copTheorie[t] > 0 ? v : NaN)), y: d.copTheorie } : null;
    _wpaDiagramm.setze({ art: 'streu', x: xw, y: copNaN, farbe, maske: betrieb, xName, yName: 'COP', farbName, grau });
    leg([['#4fc3f7', 'je Betriebsstunde ein Punkt, Farbe = ' + farbName], ...(grau ? [['#999', 'COP, den die WP in Stunden ohne Betrieb hätte']] : [])]);
  } else if (WPA.ansicht === 'carpet') {
    if (WPA.carpet === 'status') {
      _wpaDiagramm.setze({ art: 'carpet', werte: Float32Array.from(d.status), maske, name: 'Zustand', kategorien: STATUS_KAT });
      leg(Object.values(STATUS_KAT));
    } else {
      const w = WPA.carpet === 'th' ? d.th : WPA.carpet === 'el' ? d.el : copNaN;
      const name = WPA.carpet === 'th' ? 'Wärme' : WPA.carpet === 'el' ? 'Strom' : 'COP', einheit = WPA.carpet === 'cop' ? '' : 'kW';
      _wpaDiagramm.setze({ art: 'carpet', werte: w, maske: WPA.carpet === 'cop' ? betrieb : maske, name, einheit });
      leg([['#888', 'je Tag eine Spalte (x), je Stunde eine Zeile (y); leer = nicht im Zeitraum bzw. kein Betrieb']]);
    }
  } else if (WPA.ansicht === 'monate') {
    const ths = monatsSummen(d.th, maske), els = monatsSummen(d.el, maske);
    const jaz = Array.from(ths, (v, m) => (els[m] > 1 ? v / els[m] : NaN));
    _wpaDiagramm.setze({ art: 'balken', werte: jaz, name: 'JAZ', einheit: '', farbe: d.farbe,
      zusatz: Array.from(ths, (v, m) => `Wärme ${nf(v / 1000, 1)} MWh · Strom ${nf(els[m] / 1000, 1)} MWh`) });
    leg([[d.farbe, 'Monats-JAZ = Wärme / Strom im Monat']]);
  } else {
    const minCop = d.key === 'lwwp' ? parseFloat(document.getElementById('lwwp-min-cop')?.value) || 0 : 0;
    _wpaDiagramm.setze({ art: 'dauer', werte: dauerlinie(d.cop, betrieb), name: 'COP', einheit: '', farbe: d.farbe, linie: minCop > 0 ? { wert: minCop, name: 'Mindest-COP ' + nf(minCop, 1) } : null });
    leg([[d.farbe, 'COP der Betriebsstunden, absteigend sortiert']]);
  }
}
