// ── 44-quartier-sonde.js — einen Teil der Liegenschaft schnell untersuchen ──
// Bereich auf der Karte aufziehen (oder die in der Gebäudetabelle markierten Gebäude nehmen) und sofort den
// Wärmelastgang dieser Gebäude sehen: Jahresverlauf, Dauerlinie, Monate, Typtage, Nutzungsmix, Kennwerte.
// Rein lesend — das Projekt bleibt unverändert. Lastgang wie in den Wärme-Grundlagen aus den Gebäudeprofilen
// (Nutzwärme ohne Netzverluste).
import { buildBuildingHeatProfiles } from './lib/building-heat-profiles.js';
import { dauerlinie, gleichzeitigkeit, lastgangKennwerte, lastgangMonate, typtag } from './lib/lastgang-kennwerte.js';
import { nutzflaeche } from './lib/gebaeude-analyse.js';

const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const FARBEN = ['#4fc3f7', '#ffb74d', '#81c784', '#ba68c8', '#e57373', '#4db6ac', '#fff176', '#90a4ae', '#f06292', '#aed581'];
const S = { ids: [], ansicht: 'jahr', modus: false, quelle: '' };
let _rahmen = null, _markierung = null, _tempCache = null;

const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const karte = () => window._appLeafletMap;

function _zentrum(g) {
  const c = g.polygon || g.coords || [];
  if (!c.length) return null;
  let la = 0, ln = 0;
  for (const p of c) { la += p.lat ?? p[0]; ln += p.lng ?? p[1]; }
  return [la / c.length, ln / c.length];
}

/** Panel öffnen/schließen. */
export function qsToggle() {
  const p = document.getElementById('quartier-sonde-panel');
  if (!p) return;
  const auf = p.style.display !== 'block';
  p.style.display = auf ? 'block' : 'none';
  if (auf) { if (!S.ids.length) qsBereichStarten(); else qsRender(); }
  else { qsBereichAbbrechen(); _markierungEntfernen(); }
}

/** Rahmen auf der Karte aufziehen: nächster Ziehvorgang wählt die Gebäude im Rechteck. */
export function qsBereichStarten() {
  const m = karte();
  if (!m || S.modus) return;
  S.modus = true;
  const cont = m.getContainer();
  cont.classList.add('qs-ziehen');
  let start = null;
  // Capture-Phase: Gebäude-/Erzeugerlayer dürfen den Ziehvorgang nicht abfangen
  const down = e => {
    if (e.button !== 0) return;
    start = m.mouseEventToLatLng(e);
    m.dragging.disable();
    e.preventDefault(); e.stopPropagation();
  };
  const move = e => {
    if (!start) return;
    const b = L.latLngBounds(start, m.mouseEventToLatLng(e));
    if (!_rahmen) _rahmen = L.rectangle(b, { color: '#4fc3f7', weight: 1.5, dashArray: '5 4', fillOpacity: 0.06, interactive: false }).addTo(m);
    else _rahmen.setBounds(b);
  };
  const up = e => {
    if (!start) return;
    e.stopPropagation();
    const b = _rahmen?.getBounds();
    start = null;
    if (_rahmen) { _rahmen.remove(); _rahmen = null; }
    qsBereichAbbrechen();
    if (b) qsBereichWaehlen(b);
  };
  const klick = e => { e.stopPropagation(); };   // kein Gebäude-Klick am Ende des Ziehens
  S._handler = { down, move, up, klick };
  cont.addEventListener('mousedown', down, true);
  document.addEventListener('mousemove', move, true);
  document.addEventListener('mouseup', up, true);
  cont.addEventListener('click', klick, true);
  const h = document.getElementById('qs-hinweis');
  if (h) h.textContent = 'Rechteck auf der Karte aufziehen …';
}

export function qsBereichAbbrechen() {
  const m = karte();
  if (!m || !S.modus) return;
  S.modus = false;
  const cont = m.getContainer();
  cont.classList.remove('qs-ziehen');
  const h = S._handler;
  if (h) {
    cont.removeEventListener('mousedown', h.down, true);
    document.removeEventListener('mousemove', h.move, true);
    document.removeEventListener('mouseup', h.up, true);
    // den Klick, der auf das Loslassen folgt, noch abfangen
    setTimeout(() => cont.removeEventListener('click', h.klick, true), 0);
  }
  m.dragging.enable();
  const hinweis = document.getElementById('qs-hinweis');
  if (hinweis) hinweis.textContent = '';
}

/** Gebäude, deren Mittelpunkt im Rechteck liegt (bounds: L.LatLngBounds oder [[s,w],[n,e]]). */
export function qsBereichWaehlen(bounds) {
  const b = bounds?.contains ? bounds : L.latLngBounds(bounds);
  S.ids = (window.gebaeude || []).filter(g => { const z = _zentrum(g); return z && b.contains(z); }).map(g => g.id);
  S.quelle = 'Bereich auf der Karte';
  qsRender();
}

/** In der Gebäudetabelle markierte Gebäude übernehmen. */
export function qsAuswahlUebernehmen() {
  S.ids = (window.gebaeude || []).filter(g => g.selected).map(g => g.id);
  S.quelle = 'Auswahl in der Gebäudetabelle';
  qsRender();
}

export function qsAnsicht(a) { S.ansicht = a; qsRender(); }

function _markierungZeigen(gebs) {
  _markierungEntfernen();
  const m = karte();
  if (!m || !gebs.length) return;
  _markierung = L.layerGroup(gebs.filter(g => g.polygon?.length).map(g => L.polygon(g.polygon, { color: '#4fc3f7', weight: 2.5, fill: false, interactive: false }))).addTo(m);
}
function _markierungEntfernen() { if (_markierung) { _markierung.remove(); _markierung = null; } }

function _tempH() {
  if (window.systemState?.tempH) return window.systemState.tempH;
  if (_tempCache) return _tempCache;
  // Ohne berechnete Grundlagen: Profil wird nachgeladen und das Panel neu gezeichnet
  window.glGetTempH?.(document.getElementById('gl-stadt')?.value, document.getElementById('gl-klimajahr')?.value)
    .then(r => { _tempCache = r?.tempH || null; if (_tempCache) qsRender(); });
  return null;
}

/** Auswertung der aktuellen Auswahl (auch für Tests). */
export function qsAuswerten(ids = S.ids) {
  const set = new Set(ids);
  const jahr = window.globalYear;
  const gebs = (window.gebaeude || []).filter(g => set.has(g.id));
  const tempH = _tempH();
  if (!tempH) return { gebs, wartet: true };
  const twwDez = !!document.getElementById('gl-tww-dezentral')?.checked;
  const r = buildBuildingHeatProfiles(gebs, tempH, jahr, window.getComputedStats, id => !!window.isExcluded?.(id), { ohneSockel: twwDez });
  const kw = r.aggregate;
  const k = lastgangKennwerte(kw);
  let heizlastSumme = 0, flaeche = 0;
  const mix = new Map();
  for (const g of gebs) {
    const st = window.getComputedStats(g, jahr);
    if (!r.profiles.has(g.id)) continue;
    heizlastSumme += Number(st.heizlast) || 0;
    flaeche += nutzflaeche(g);
    const t = (window.getNutzungstypen?.() || []).find(x => x.id === g.nutzung)?.label || g.nutzung || 'nicht zugeordnet';
    mix.set(t, (mix.get(t) || 0) + (Number(st.waerme) || 0));
  }
  return {
    gebs, mitProfil: r.profiles.size, kw, k, heizlastSumme, flaeche,
    spez: flaeche > 0 ? k.mwh * 1000 / flaeche : 0,
    gzf: gleichzeitigkeit(k.spitzeKw, heizlastSumme),
    monate: lastgangMonate(kw), jdl: dauerlinie(kw),
    winterWt: typtag(kw, [0, 1, 11], jahr, false), winterWe: typtag(kw, [0, 1, 11], jahr, true),
    sommerWt: typtag(kw, [5, 6, 7], jahr, false), sommerWe: typtag(kw, [5, 6, 7], jahr, true),
    mix: [...mix.entries()].sort((a, b) => b[1] - a[1]),
    anteilProjekt: window.systemState?.nutzwaermeMwh > 0 ? k.mwh / window.systemState.nutzwaermeMwh * 100 : null,
  };
}

export function qsRender() {
  const wrap = document.getElementById('qs-inhalt');
  if (!wrap) return;
  if (!S.ids.length) {
    wrap.innerHTML = `<div class="qs-leer">Noch kein Bereich gewählt. <b>Bereich ziehen</b> und auf der Karte ein Rechteck aufziehen — oder Gebäude in der Gebäudetabelle markieren und <b>Tabellenauswahl</b> nehmen.</div>`;
    _markierungEntfernen();
    return;
  }
  const d = qsAuswerten();
  _markierungZeigen(d.gebs);
  if (d.wartet) { wrap.innerHTML = '<div class="qs-leer">Klimadaten werden geladen …</div>'; return; }
  if (!d.mitProfil) { wrap.innerHTML = `<div class="qs-leer">${d.gebs.length} Gebäude gewählt, aber keines hat im Betrachtungsjahr einen Wärmeverbrauch.</div>`; return; }
  const kpi = (t, w, s = '') => `<div class="sp-kpi"><span>${t}</span><b>${w}</b>${s ? `<em>${s}</em>` : ''}</div>`;
  const ANS = { jahr: 'Jahresverlauf', dauer: 'Dauerlinie', monate: 'Monate', typtage: 'Typtage', mix: 'Nutzungsmix' };
  wrap.innerHTML = `
    <div class="qs-quelle">${esc(S.quelle)} · ${d.gebs.length} Gebäude, davon ${d.mitProfil} mit Wärmeverbrauch · Betrachtungsjahr ${window.globalYear}</div>
    <div class="sp-kpis">
      ${kpi('Wärme', nf(d.k.mwh, d.k.mwh < 100 ? 1 : 0) + ' MWh/a', d.anteilProjekt != null ? `${nf(d.anteilProjekt, 1)} % des Projekts` : 'Nutzwärme ohne Netzverluste')}
      ${kpi('Spitzenlast', nf(d.k.spitzeKw) + ' kW', `Σ Heizlasten ${nf(d.heizlastSumme)} kW`)}
      ${kpi('Gleichzeitigkeit', d.gzf != null ? nf(d.gzf, 2) : '—', 'Spitze / Σ Heizlasten')}
      ${kpi('Vollbenutzung', nf(d.k.vbh) + ' h/a', '')}
      ${kpi('Sommer-Grundlast', nf(d.k.sommerKw) + ' kW', 'Mittel Juni–August')}
      ${kpi('Spez. Wärme', d.spez > 0 ? nf(d.spez) + ' kWh/m²a' : '—', `${nf(d.flaeche)} m² Nutzfläche`)}
    </div>
    <div class="qs-ansicht">${Object.entries(ANS).map(([k, t]) => `<button class="viz-btn${S.ansicht === k ? ' active' : ''}" data-click="qsAnsicht('${k}')">${t}</button>`).join('')}</div>
    <canvas id="qs-canvas" height="200"></canvas>
    <div id="qs-legende" class="sp-legende"></div>`;
  requestAnimationFrame(() => _zeichne(d));
}

function _flaeche() {
  const c = document.getElementById('qs-canvas');
  if (!c) return null;
  const W = c.parentElement?.clientWidth || 460, H = 200, dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px "DM Mono", monospace';
  return { ctx, W, H };
}

function _yAchse(ctx, L, T, ph, W, R, max, einheit) {
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i <= 4; i++) {
    const y = T + ph * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillText(nf(max * i / 4, max < 20 ? 1 : 0), 2, y + 3);
  }
  ctx.fillText(einheit, L + 4, T - 6);
}

function _zeichne(d) {
  const f = _flaeche();
  if (!f) return;
  const { ctx, W, H } = f;
  const L = 46, R = 8, T = 16, B = 18, pw = W - L - R, ph = H - T - B;
  const leg = document.getElementById('qs-legende');
  const linie = (werte, max, farbe, breite = 1.5, n = werte.length) => {
    ctx.strokeStyle = farbe; ctx.lineWidth = breite; ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = L + i / (n - 1) * pw, y = T + ph * (1 - werte[i] / max); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.lineWidth = 1;
  };
  if (S.ansicht === 'jahr') {
    const kw = d.kw, max = d.k.spitzeKw * 1.05 || 1;
    _yAchse(ctx, L, T, ph, W, R, max, 'kW');
    for (let x = 0; x < pw; x++) {
      const i0 = Math.floor(x / pw * 8760), i1 = Math.max(i0 + 1, Math.floor((x + 1) / pw * 8760));
      let mx = 0, s = 0;
      for (let i = i0; i < i1; i++) { mx = Math.max(mx, kw[i]); s += kw[i]; }
      const yM = T + ph * (1 - mx / max), yS = T + ph * (1 - s / (i1 - i0) / max);
      ctx.fillStyle = 'rgba(79,195,247,0.25)'; ctx.fillRect(L + x, yM, 1, T + ph - yM);
      ctx.fillStyle = '#4fc3f7'; ctx.fillRect(L + x, yS, 1, T + ph - yS);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016].forEach((h, m) => ctx.fillText(MON[m], L + h / 8760 * pw + 2, H - 4));
    if (leg) leg.innerHTML = '<span style="color:#4fc3f7">■</span> Mittel <span style="color:rgba(79,195,247,0.5)">■</span> Spitze je Zeitabschnitt';
  } else if (S.ansicht === 'dauer') {
    const max = d.k.spitzeKw * 1.05 || 1;
    _yAchse(ctx, L, T, ph, W, R, max, 'kW');
    ctx.fillStyle = 'rgba(79,195,247,0.35)';
    for (let x = 0; x < pw; x++) { const v = d.jdl[Math.floor(x / pw * 8760)]; const y = T + ph * (1 - v / max); ctx.fillRect(L + x, y, 1, T + ph - y); }
    linie(Array.from({ length: 200 }, (_, i) => d.jdl[Math.floor(i / 199 * 8759)]), max, '#4fc3f7');
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    [0, 2000, 4000, 6000, 8000].forEach(h => ctx.fillText(nf(h) + ' h', L + h / 8760 * pw + 2, H - 4));
    if (leg) leg.innerHTML = `Stunden des Jahres nach Last sortiert · ${nf(d.k.vbh)} Vollbenutzungsstunden`;
  } else if (S.ansicht === 'monate') {
    const max = Math.max(...d.monate) * 1.1 || 1;
    _yAchse(ctx, L, T, ph, W, R, max, 'MWh');
    const bw = pw / 12;
    d.monate.forEach((v, m) => {
      const y = T + ph * (1 - v / max);
      ctx.fillStyle = '#4fc3f7'; ctx.globalAlpha = 0.8; ctx.fillRect(L + m * bw + bw * 0.15, y, bw * 0.7, T + ph - y); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(MON[m], L + m * bw + bw * 0.2, H - 4);
    });
    if (leg) leg.innerHTML = 'Wärme je Monat';
  } else if (S.ansicht === 'typtage') {
    const max = Math.max(...d.winterWt, ...d.winterWe, ...d.sommerWt, ...d.sommerWe) * 1.1 || 1;
    _yAchse(ctx, L, T, ph, W, R, max, 'kW');
    linie(d.winterWt, max, '#4fc3f7', 2); linie(d.winterWe, max, '#4fc3f7', 1);
    linie(d.sommerWt, max, '#ffb74d', 2); linie(d.sommerWe, max, '#ffb74d', 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    [0, 6, 12, 18, 23].forEach(h => ctx.fillText(h + ' Uhr', L + h / 23 * pw - (h === 23 ? 34 : 0), H - 4));
    if (leg) leg.innerHTML = '<span style="color:#4fc3f7">━</span> Winter (Dez–Feb) <span style="color:#ffb74d">━</span> Sommer (Jun–Aug) · dick: Werktag, dünn: Wochenende';
  } else {
    const ges = d.mix.reduce((s, m) => s + m[1], 0) || 1;
    const zeilen = d.mix.slice(0, 8);
    const zh = Math.min(22, (H - 10) / Math.max(1, zeilen.length));
    zeilen.forEach(([name, mwh], i) => {
      const y = 6 + i * zh, w = mwh / zeilen[0][1] * Math.max(40, W - 160 - 130);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(name.length > 24 ? name.slice(0, 23) + '…' : name, 4, y + zh * 0.65);
      ctx.fillStyle = FARBEN[i % FARBEN.length]; ctx.globalAlpha = 0.8; ctx.fillRect(160, y + 3, Math.max(2, w), zh - 6); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(`${nf(mwh)} MWh · ${nf(mwh / ges * 100)} %`, 166 + Math.max(2, w), y + zh * 0.65);
    });
    if (leg) leg.innerHTML = 'Wärmeverbrauch nach Nutzung';
  }
}
