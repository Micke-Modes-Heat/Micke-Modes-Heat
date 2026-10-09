// ── 43-gebaeude-analyse.js — frei wählbare Gebäudeanalyse in der Gebäudeübersicht ──
// Kennwert × Gruppierung × Darstellung (Boxplot, Balken, Streudiagramm). Rechnet mit den Werten im
// Betrachtungsjahr (Sanierungen, Abriss, Neubau). Klick auf einen Punkt markiert das Gebäude in der Tabelle.
import { GA_GRUPPIERUNGEN, GA_KENNWERTE, gaAuswerten, gaBalkenwert, nutzflaeche } from './lib/gebaeude-analyse.js';
import { nwgVergleichswert } from './lib/vergleichswerte-nwg.js';
import { baZustandAusText } from './lib/bestandsanlage.js';

const FARBEN = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#e57373', '#4db6ac', '#fff176', '#90a4ae', '#f06292', '#aed581', '#7986cb', '#ffd54f'];
const SPEICHER_KEY = 'mmh-gebaeude-analyse';
const S = (() => {
  const std = { kennwert: 'spezWaerme', gruppe: 'nutzung', form: 'box', x: 'baujahr', aggregat: 'auto' };
  try { return { ...std, ...JSON.parse(localStorage.getItem(SPEICHER_KEY) || '{}') }; } catch { return std; }
})();
let _treffer = [];   // Hit-Test: {x, y, r, g, text}

const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function _ctx() {
  return {
    nutzungLabel: g => {
      const t = (window.getNutzungstypen?.() || []).find(x => x.id === g.nutzung);
      return t?.label || g.nutzung || 'nicht zugeordnet';
    },
    zustand: g => Number(baZustandAusText(g.zustand)) || 0,
    vergleichswert: g => nwgVergleichswert({ nutzung: g.nutzung, waermeRef: g.waermeRef, bgfM2: nutzflaeche(g) / 0.8 })?.jeBgf ?? NaN,
  };
}

function _items() {
  const jahr = window.globalYear;
  return (window.gebaeude || [])
    .filter(g => !window.isExcluded?.(g.id))
    .map(g => ({ g, st: window.getComputedStats(g, jahr) }))
    .filter(({ st }) => st.status !== 'geplant' && st.status !== 'abgerissen');
}

/** Auswahl ändern (Kennwert, Gruppierung, Darstellung, X-Achse, Aggregat). */
export function gaSetze(feld, wert) {
  S[feld] = wert;
  try { localStorage.setItem(SPEICHER_KEY, JSON.stringify(S)); } catch { /* ohne Speicher */ }
  gaRender();
}

/** Für Tests/Konsole: Auswertung ohne Zeichnen. */
export function gaAuswertung() {
  return gaAuswerten(_items(), S.kennwert, S.gruppe, _ctx());
}

export function gaRender() {
  const wrap = document.getElementById('geb-dyn-analyse');
  if (!wrap) return;
  const auswahl = (feld, obj, wert) => `<select data-change="gaSetze('${feld}',this.value)">${Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === wert ? ' selected' : ''}>${esc(v.label || v)}</option>`).join('')}</select>`;
  const FORMEN = { box: 'Boxplot (Verteilung)', balken: 'Balken', streu: 'Streudiagramm' };
  const AGG = { auto: 'Mittel bzw. Summe', median: 'Median', summe: 'Summe' };
  const kennwerte = Object.fromEntries(Object.entries(GA_KENNWERTE).map(([k, v]) => [k, { label: v.label + (v.einheit ? ` (${v.einheit})` : '') }]));
  wrap.innerHTML = `
    <div class="ga-kopf">
      <h3>Datenanalyse</h3>
      <label>Kennwert ${auswahl('kennwert', kennwerte, S.kennwert)}</label>
      <label>${S.form === 'streu' ? 'Farbe nach' : 'Gruppiert nach'} ${auswahl('gruppe', GA_GRUPPIERUNGEN, S.gruppe)}</label>
      <label>Darstellung ${auswahl('form', FORMEN, S.form)}</label>
      ${S.form === 'streu' ? `<label>X-Achse ${auswahl('x', kennwerte, S.x)}</label>` : ''}
      ${S.form === 'balken' ? `<label>Balken zeigt ${auswahl('aggregat', AGG, S.aggregat)}</label>` : ''}
    </div>
    <div class="ga-flaeche"><canvas id="ga-canvas" height="300"></canvas><div id="ga-tipp" class="ga-tipp"></div></div>
    <div id="ga-info" class="ga-info"></div>`;
  const c = document.getElementById('ga-canvas');
  c.onmousemove = ev => _tipp(ev, c);
  c.onmouseleave = () => { const t = document.getElementById('ga-tipp'); if (t) t.style.display = 'none'; };
  c.onclick = ev => _klick(ev, c);
  requestAnimationFrame(() => _zeichne());
}

function _flaeche() {
  const c = document.getElementById('ga-canvas');
  if (!c) return null;
  const W = c.parentElement?.clientWidth || 800, H = 300, dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px "DM Mono", monospace';
  return { ctx, W, H };
}

/** „Schöne“ Achsenteilung (1, 2, 5 × 10^n). */
function _skala(lo, hi, ziel = 5) {
  const roh = (hi - lo) / ziel || 1;
  const p = Math.pow(10, Math.floor(Math.log10(roh)));
  const schritt = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= roh) || 10 * p;
  const a = Math.floor(lo / schritt) * schritt, e = Math.ceil(hi / schritt) * schritt;
  const ticks = [];
  for (let v = a; v <= e + schritt * 1e-6; v += schritt) ticks.push(+v.toFixed(10));
  return { lo: a, hi: e, ticks, schritt };
}
const _fmt = (v, jahr, schritt) => jahr ? String(Math.round(v)) : nf(v, schritt < 1 ? 1 : 0);

function _achseY(ctx, L, T, ph, W, R, sk, einheit, jahr) {
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const v of sk.ticks) {
    const y = T + ph * (1 - (v - sk.lo) / (sk.hi - sk.lo));
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillText(_fmt(v, jahr, sk.schritt), 2, y + 3);
  }
  if (einheit) ctx.fillText(einheit, L + 4, T - 8);
}

function _zeichne() {
  const f = _flaeche();
  if (!f) return;
  const { ctx, W, H } = f;
  _treffer = [];
  const ctxD = _ctx();
  const a = gaAuswerten(_items(), S.kennwert, S.gruppe, ctxD);
  const info = document.getElementById('ga-info');
  const kw = a.kennwert;
  if (!a.gesamt.n) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('Keine Gebäude mit Werten für diesen Kennwert.', 12, H / 2);
    if (info) info.textContent = '';
    return;
  }
  const L = 52, R = 12, T = 24, B = S.form === 'streu' ? 30 : 46, pw = W - L - R, ph = H - T - B;
  const farbe = i => FARBEN[i % FARBEN.length];
  if (S.form === 'streu') {
    const kx = GA_KENNWERTE[S.x] || GA_KENNWERTE.baujahr;
    const pts = [];
    a.gruppen.forEach((gr, gi) => gr.punkte.forEach(p => { const xv = kx.wert(p.g, p.st, ctxD); if (Number.isFinite(xv)) pts.push({ ...p, xv, gi }); }));
    if (!pts.length) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('Keine Wertepaare für diese Achsen.', 12, H / 2); return; }
    const xJahr = S.x === 'baujahr', yJahr = S.kennwert === 'baujahr';
    let xmin = Math.min(...pts.map(p => p.xv)), xmax = Math.max(...pts.map(p => p.xv));
    if (xmax - xmin < 1e-9) { xmin -= 1; xmax += 1; }
    const skX = _skala(xJahr ? xmin : Math.min(0, xmin), xmax, 6);
    const skY = _skala(yJahr ? Math.min(...pts.map(p => p.wert)) : 0, Math.max(...pts.map(p => p.wert)), 5);
    const xlo = skX.lo, xhi = skX.hi, ylo = skY.lo, yhi = skY.hi;
    _achseY(ctx, L, T, ph, W, R, skY, kw.einheit, yJahr);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    skX.ticks.forEach((v, i) => {
      const t = _fmt(v, xJahr, skX.schritt), x = L + (v - xlo) / (xhi - xlo) * pw, tw = ctx.measureText(t).width;
      ctx.fillText(t, i === skX.ticks.length - 1 ? x - tw : i === 0 ? x : x - tw / 2, H - 16);
    });
    ctx.fillText(kx.label + (kx.einheit ? ` (${kx.einheit})` : ''), L + pw / 2 - 40, H - 3);
    for (const p of pts) {
      const x = L + (p.xv - xlo) / (xhi - xlo) * pw, y = T + ph * (1 - (p.wert - ylo) / (yhi - ylo));
      const r = Math.max(2.5, Math.min(9, Math.sqrt(nutzflaeche(p.g) || 100) / 8));
      ctx.fillStyle = farbe(p.gi); ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      _treffer.push({ x, y, r: r + 2, g: p.g, text: `${p.g.name || 'Gebäude ' + p.g.id}<br>${kw.label}: ${nf(p.wert, 1)} ${kw.einheit}<br>${kx.label}: ${nf(p.xv, 1)} ${kx.einheit}<br>${esc(a.gruppen[p.gi].name)}` });
    }
    if (info) info.innerHTML = a.gruppen.map((gr, gi) => `<span><i style="background:${farbe(gi)}"></i>${esc(gr.name)} (${gr.stat.n})</span>`).join('') + '<em>Punktgröße ~ Nutzfläche · Klick markiert das Gebäude in der Tabelle</em>';
    return;
  }
  const gr = a.gruppen;
  const n = gr.length, bw = pw / n;
  const yJahr = S.kennwert === 'baujahr';
  const maxW = S.form === 'box' ? Math.max(...gr.map(g => g.stat.max)) : Math.max(...gr.map(g => gaBalkenwert(g.stat, kw, S.aggregat))) * 1.08;
  const minW = yJahr ? Math.min(...gr.map(g => g.stat.min)) : 0;
  const sk = _skala(minW, maxW > minW ? maxW : minW + 1, 5);
  const lo = sk.lo, hi = sk.hi;
  const yv = v => T + ph * (1 - (v - lo) / (hi - lo));
  _achseY(ctx, L, T, ph, W, R, sk, kw.einheit, yJahr);
  // Gesamtmittel als Bezugslinie
  const ref = kw.summierbar ? null : a.gesamt.gewMittel;
  if (ref != null && ref > lo && ref < hi) {
    ctx.strokeStyle = 'rgba(255,213,79,0.7)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, yv(ref)); ctx.lineTo(W - R, yv(ref)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,213,79,0.85)'; ctx.fillText('Ø ' + nf(ref, 1), W - R - 60, yv(ref) - 3);
  }
  gr.forEach((g, i) => {
    const cx = L + (i + 0.5) * bw, w = Math.min(46, bw * 0.6);
    const s = g.stat;
    ctx.fillStyle = farbe(i); ctx.strokeStyle = farbe(i);
    if (S.form === 'box') {
      ctx.globalAlpha = 0.3; ctx.fillRect(cx - w / 2, yv(s.q3), w, Math.max(1, yv(s.q1) - yv(s.q3))); ctx.globalAlpha = 1;
      ctx.strokeRect(cx - w / 2, yv(s.q3), w, Math.max(1, yv(s.q1) - yv(s.q3)));
      ctx.beginPath(); ctx.moveTo(cx, yv(s.q3)); ctx.lineTo(cx, yv(s.max)); ctx.moveTo(cx, yv(s.q1)); ctx.lineTo(cx, yv(s.min));
      ctx.moveTo(cx - w / 4, yv(s.max)); ctx.lineTo(cx + w / 4, yv(s.max)); ctx.moveTo(cx - w / 4, yv(s.min)); ctx.lineTo(cx + w / 4, yv(s.min)); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - w / 2, yv(s.median)); ctx.lineTo(cx + w / 2, yv(s.median)); ctx.stroke(); ctx.lineWidth = 1;
      // Einzelwerte als Punkte (leicht gestreut)
      g.punkte.forEach((p, j) => {
        const x = cx + ((j * 37) % 17 - 8) / 8 * w * 0.35, y = yv(p.wert);
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        _treffer.push({ x, y, r: 4, g: p.g, text: `${esc(p.g.name || 'Gebäude ' + p.g.id)}<br>${kw.label}: ${nf(p.wert, 1)} ${kw.einheit}` });
      });
      _treffer.push({ x: cx, y: yv(s.median), r: w / 2, box: true, text: `<b>${esc(g.name)}</b> (${s.n} Gebäude)<br>Median ${nf(s.median, 1)} · Mittel ${nf(s.gewMittel, 1)} ${kw.einheit}<br>25–75 %: ${nf(s.q1, 1)} – ${nf(s.q3, 1)}<br>Min ${nf(s.min, 1)} · Max ${nf(s.max, 1)}` });
    } else {
      const v = gaBalkenwert(s, kw, S.aggregat);
      ctx.globalAlpha = 0.8; ctx.fillRect(cx - w / 2, yv(v), w, Math.max(1, yv(lo) - yv(v))); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(nf(v, v < 100 ? 1 : 0), cx - w / 2, yv(v) - 3);
      _treffer.push({ x: cx, y: (yv(v) + yv(lo)) / 2, r: Math.max(w / 2, (yv(lo) - yv(v)) / 2), box: true, text: `<b>${esc(g.name)}</b> (${s.n} Gebäude)<br>${S.aggregat === 'median' ? 'Median' : (S.aggregat === 'summe' || (S.aggregat === 'auto' && kw.summierbar)) ? 'Summe' : kw.gewicht ? 'flächengewichtetes Mittel' : 'Mittel'}: ${nf(v, 1)} ${kw.einheit}` });
    }
    // Gruppenname schräg darunter
    ctx.save(); ctx.translate(cx, H - B + 10); ctx.rotate(-0.35); ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const name = g.name.length > 18 ? g.name.slice(0, 17) + '…' : g.name;
    ctx.fillText(name, -ctx.measureText(name).width / 2 - 4, 4); ctx.restore();
  });
  if (info) info.innerHTML = `<em>${a.gesamt.n} Gebäude · ${kw.summierbar ? 'Summe ' + nf(a.gesamt.summe) : 'Ø ' + nf(a.gesamt.gewMittel, 1)} ${kw.einheit}${kw.gewicht ? ' (flächengewichtet)' : ''}${S.form === 'box' ? ' · Box: 25–75 %, Strich: Median, Antennen: Min/Max, Punkte: einzelne Gebäude' : ''}</em>`;
}

function _hit(ev, c) {
  const r = c.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  // Punkte (einzelne Gebäude) haben Vorrang vor der Box bzw. dem Balken der Gruppe
  const punkt = _treffer.find(t => !t.box && Math.hypot(x - t.x, y - t.y) <= t.r);
  const spalte = _treffer.find(t => t.box && Math.abs(x - t.x) <= t.r);
  return { t: punkt || spalte || null, x, y };
}

function _tipp(ev, c) {
  const tip = document.getElementById('ga-tipp');
  if (!tip) return;
  const { t, x, y } = _hit(ev, c);
  if (!t) { tip.style.display = 'none'; c.style.cursor = 'default'; return; }
  c.style.cursor = t.g ? 'pointer' : 'default';
  tip.innerHTML = t.text;
  tip.style.display = 'block';
  const w = c.clientWidth;
  tip.style.left = Math.min(x + 12, w - 220) + 'px';
  tip.style.top = Math.max(0, y - 10) + 'px';
}

function _klick(ev, c) {
  const { t } = _hit(ev, c);
  if (!t?.g) return;
  const zeile = document.querySelector(`#geb-table-body tr[data-geb-id="${t.g.id}"]`);
  if (!zeile) return;
  zeile.scrollIntoView({ block: 'center', behavior: 'smooth' });
  zeile.classList.remove('ga-blink'); void zeile.offsetWidth; zeile.classList.add('ga-blink');
}
