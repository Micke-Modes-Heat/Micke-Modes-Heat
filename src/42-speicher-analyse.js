// ── 42-speicher-analyse.js — Wärmespeicher im aktuellen System untersuchen ──
// Reiter „Speicher“ der Einsatzanalyse: Kurzzeit- (Stahltank) und Langzeitspeicher (Erdbecken) mit frei
// wählbarer Größe. Rechnet den Haupt-Dispatch mit und ohne Speicher, zeigt den stündlichen Füllstand,
// die Wirkung auf Kessel-/Spitzenlastwärme und EE-Anteil und die Wirtschaftlichkeit über eine Größenvariation.
// Das Projekt bleibt unverändert, bis „Als Wärmespeicher übernehmen“ geklickt wird.
import { _dispatchCore, _quelleTemp, dispatchEingaben, updateAllDeckungen } from './06c-dispatch-core.js';
import { _collectOptDomParams, _optKennwerte2 } from './10a-optimizer-core.js';
import { redrawThermSpeicherMap, updateThermSpeicherDisplay } from './06b-gl-berechnen.js';
import {
  speicherAmortisation, speicherInvestEur, speicherKapKwh, speicherKennwerte,
  speicherOptimum, speicherVerlustProH, speicherVolumenStufen,
} from './lib/waermespeicher.js';

const KESSEL = ['gaskessel', 'heizoel', 'pellets', 'hhs'];
const FARBE = { soc: '#26a69a', laden: '#4db6ac', entladen: '#ffb74d', kessel: '#90a4ae', gut: '#81c784', schlecht: '#e57373', akzent: '#80cbc4' };
const WOCHEN = { winter: 'Kälteste Woche', uebergang: 'Übergang (April)', sommer: 'Sommer (Juli)' };

// Einstellungen der Analyse (bleiben während der Sitzung erhalten, gehören nicht zum Projekt)
const S = { art: 'kurz', vol: null, dt: 40, verlust: null, leistungKw: null, ladeImmer: null, ansicht: 'jahr' };
let _letzte = null;   // letztes Ergebnis für Klicks in die Grafik

const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = v => (Math.abs(v) >= 1e6 ? nf(v / 1e6, 2) + ' Mio. €' : Math.abs(v) >= 1e4 ? nf(v / 1e3, 0) + ' T€' : nf(v, 0) + ' €');
const el = id => document.getElementById(id);

/** Deutsche und englische Schreibweise: „7.300“ und „1.041“ sind Tausender, „0,05“ und „0.05“ Dezimalzahlen. */
export function _zahl(text) {
  const t = String(text ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ''));
  return parseFloat(t);
}

/** Art wechseln: Kurzzeit ↔ Langzeit (Größe und Verluste neu vorschlagen). */
export function spSetArt(art) {
  S.art = art === 'lang' ? 'lang' : 'kurz';
  S.vol = null; S.verlust = null; S.ladeImmer = null;
  S.dt = S.art === 'lang' ? 30 : 40;
  spRender();
}

/** Eingabe geändert (Volumen, ΔT, Verlust, Leistung, Ladefenster). Leere Felder = automatisch. */
export function spEingabe() {
  const zahl = id => { const v = _zahl(el(id)?.value); return Number.isFinite(v) && v > 0 ? v : null; };
  S.vol = zahl('sp-vol');
  S.dt = zahl('sp-dt') || (S.art === 'lang' ? 30 : 40);
  S.verlust = zahl('sp-verlust');
  S.leistungKw = zahl('sp-leistung');
  S.ladeImmer = !!el('sp-lade-immer')?.checked;
  spRender();
}

/** Volumen über den Schieber (Index in den Größenstufen). */
export function spSchieber(idx) {
  const stufen = _letzte?.stufen;
  if (!stufen?.length) return;
  S.vol = stufen[Math.max(0, Math.min(stufen.length - 1, Math.round(idx)))].vol;
  spRender();
}

export function spSetAnsicht(a) { S.ansicht = a; spRender(); }

/** Ausgewählten Speicher in das Wärmespeicher-Panel übernehmen (wirkt dann auf die Hauptberechnung). */
export function spUebernehmen() {
  const r = _letzte?.auswahl;
  if (!r) return;
  const typ = S.art === 'lang' ? 'saisonal' : r.vol > 200 ? 'gross' : 'puffer';
  const setze = (id, v) => { const e = el(id); if (e) e.value = v; };
  setze('ts-typ', typ);
  setze('ts-volumen', r.vol);
  setze('ts-dt', r.param.dt);
  setze('ts-verlust', +(r.param.verlustRate * 100).toPrecision(2));
  setze('ts-entlade-kw', Math.round(r.param.entladeKw));
  setze('ts-lade-kw', Math.round(r.param.ladeKw));
  updateThermSpeicherDisplay();
  redrawThermSpeicherMap();
  updateAllDeckungen();
  const h = el('sp-hinweis');
  if (h) h.textContent = `✓ ${nf(r.vol)} m³ als Wärmespeicher übernommen — die Hauptberechnung rechnet jetzt damit.`;
}

function _params(vol, peakKw) {
  const dt = S.dt;
  const kapKwh = speicherKapKwh(vol, dt);
  const verlustPct = S.verlust ?? speicherVerlustProH(vol, S.art);
  // Lade-/Entladeleistung: Kurzzeit bis zur Spitzenlast, Langzeit Inhalt in ≥ 500 h umschlagbar (mind. 30 % Spitze)
  const autoKw = S.art === 'lang' ? Math.max(peakKw * 0.3, kapKwh / 500) : Math.min(peakKw, kapKwh / 1);
  const leist = S.leistungKw ?? Math.max(1, autoKw);
  const immer = S.ladeImmer ?? (S.art === 'lang');
  return { vol, dt, kapKwh, verlustRate: verlustPct / 100, entladeKw: leist, ladeKw: leist, ladeVon: immer ? 0 : 8, ladeBis: immer ? 24 : 18 };
}

function _lauf(E, param, aufzeichnen) {
  const basis = {
    lastgangKw: E.lastgangKw, tempH: E.tempH, vlH: E.vlH, erzList: E.erzList, stProfile: E.stProfile, stExcessH: null,
    bhkwSigma: E.bhkwSigma, skEta: E.skEta, lwwpMinCop: E.lwwpMinCop, quelleTemp: _quelleTemp, backupMode: false, eisSpeicher: E.eisSpeicher,
  };
  if (!param) return _dispatchCore({ ...basis, speicherParams: null, recordHourly: aufzeichnen });
  // Eingeschwungen: das Jahr beginnt mit dem Füllstand vom Jahresende (wichtig für Langzeitspeicher)
  const vor = _dispatchCore({ ...basis, speicherParams: param, recordHourly: false });
  return _dispatchCore({ ...basis, speicherParams: param, recordHourly: aufzeichnen, speicherStartKwh: vor.thermSocEnde || 0 });
}

function _kosten(E, r, vol, kp) {
  const erzeugerList = E.erzList.map(e => ({ key: e.key, typ: e.typ, leistKw: e.leistKw,
    waermeMwh: (r.thKwh[e.key] || 0) / 1000, elMwh: (r.elKwh[e.key] || 0) / 1000 }));
  // Aus dem Speicher entladene Wärme stammt von dem, der ihn geladen hat: Wärmepumpe, sonst Solarthermie, sonst BHKW
  let stMwh = (r.thKwh.solarthermie || 0) / 1000;
  const ausSpeicher = (r.thermEntladenGes || 0) / 1000;
  if (ausSpeicher > 0) {
    const quelle = erzeugerList.find(e => e.typ === 'wp') || (stMwh > 0 ? null : erzeugerList.find(e => e.typ === 'kwk'));
    if (quelle) quelle.waermeMwh += ausSpeicher; else stMwh += ausSpeicher;
  }
  const stM2 = stMwh > 0 ? (parseFloat(el('st-flaeche')?.value) || 0) : 0;
  const k = _optKennwerte2({ erzeugerList, gesamtMwh: r.gesamtKwh / 1000, autoGkMwh: r.autoGkKwh / 1000, autoGkPeakKw: r.autoGkPeakKw },
    0, 0, null, kp, stMwh, stM2, vol || 0, { typ: S.art === 'lang' ? 'saisonal' : 'gross', dt: S.dt });
  return k;
}

/** Rechnet die Analyse (ohne DOM-Ausgabe) — auch für Tests. */
export function spBerechnen() {
  const ss = window.systemState;
  if (!ss?.lastgangKw) return null;
  const E = dispatchEingaben(ss);
  const peakKw = ss.pMaxKw || Math.max(...ss.lastgangKw);
  const jahresMwh = ss.gesamtMwhMitNV || 0;
  const kp = _collectOptDomParams();
  const ohne = _lauf(E, null, false);
  const kOhne = _kosten(E, ohne, 0, kp);
  const vols = speicherVolumenStufen(S.art, peakKw, jahresMwh, S.dt);
  const stufen = vols.map(vol => {
    const param = _params(vol, peakKw);
    const r = _lauf(E, param, false);
    const k = _kosten(E, r, vol, kp);
    const kw = speicherKennwerte(r, ohne, param.kapKwh, KESSEL);
    return { vol, param, kw, wgk: k.wgk, jahreskosten: k.jahreskosten, ee: k.eeAnteil, co2: k.co2ta,
      invest: speicherInvestEur(vol, S.art === 'lang' ? 'saisonal' : 'gross'), deltaJk: k.jahreskosten - kOhne.jahreskosten };
  });
  const volAuswahl = S.vol ?? stufen[Math.min(stufen.length - 1, Math.round(stufen.length * 0.45))]?.vol;
  const param = _params(volAuswahl, peakKw);
  const r = _lauf(E, param, true);
  const k = _kosten(E, r, volAuswahl, kp);
  const kw = speicherKennwerte(r, ohne, param.kapKwh, KESSEL);
  const invest = speicherInvestEur(volAuswahl, S.art === 'lang' ? 'saisonal' : 'gross');
  // Einsparung ohne Kapitalkosten des Speichers: Energie, CO₂, kleinerer Spitzenkessel
  const kapitalSpeicher = invest * ((kp.zinssatz > 0 ? kp.zinssatz * Math.pow(1 + kp.zinssatz, 20) / (Math.pow(1 + kp.zinssatz, 20) - 1) : 0.05) + 0.015);
  const deltaJk = k.jahreskosten - kOhne.jahreskosten;
  const einsparungBetrieb = kapitalSpeicher - deltaJk;
  const auswahl = { vol: volAuswahl, param, kw, wgk: k.wgk, jahreskosten: k.jahreskosten, ee: k.eeAnteil, co2: k.co2ta, invest, deltaJk,
    amortisation: speicherAmortisation(invest, einsparungBetrieb), einsparungBetrieb };
  const optimum = speicherOptimum(stufen);
  return {
    art: S.art, peakKw, jahresMwh, stufen, auswahl, optimum,
    ohne: { wgk: kOhne.wgk, jahreskosten: kOhne.jahreskosten, ee: kOhne.eeAnteil, co2: kOhne.co2ta },
    stunden: { soc: r.thermSocH, laden: r.thermLadeH, entladen: r.thermEntladeH, rest: r.residualH, lastgang: E.lastgangKw, tempH: E.tempH },
    bestand: window.thermSpeicherAktiv ? { vol: parseFloat(el('ts-volumen')?.value) || 0 } : null,
  };
}

/** Reiter zeichnen. */
export function spRender() {
  const wrap = el('sp-inhalt');
  if (!wrap) return;
  let d;
  try { d = spBerechnen(); } catch (e) { console.error('Speicheranalyse:', e); wrap.innerHTML = `<div class="sp-leer">⚠ Speicheranalyse fehlgeschlagen: ${e.message}</div>`; return; }
  if (!d) { wrap.innerHTML = '<div class="sp-leer">Erst den Lastgang berechnen (Wärme-Grundlagen) und Erzeuger anlegen — dann lässt sich hier ein Speicher untersuchen.</div>'; return; }
  _letzte = d;
  const a = d.auswahl, kw = a.kw;
  const idx = Math.max(0, d.stufen.findIndex(s => s.vol >= a.vol));
  const lohnt = a.deltaJk < 0;
  const opt = d.optimum;
  const optText = opt && opt.deltaJk < 0
    ? `Am günstigsten in dieser Variation: <b>${nf(opt.vol)} m³</b> — spart ${eur(-opt.deltaJk)}/a gegenüber ohne Speicher.`
    : 'In dieser Variation senkt keine Speichergröße die Jahreskosten — der Speicher rechnet sich hier nicht.';
  const kpi = (titel, wert, sub = '', farbe = '') => `<div class="sp-kpi"><span>${titel}</span><b${farbe ? ` style="color:${farbe}"` : ''}>${wert}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  wrap.innerHTML = `
    <div class="sp-steuerung">
      <div class="sp-art">
        <button class="viz-btn${S.art === 'kurz' ? ' active' : ''}" data-click="spSetArt('kurz')" title="Drucklose Stahltanks: Stunden- bis Mehrtagesausgleich">Kurzzeitspeicher</button>
        <button class="viz-btn${S.art === 'lang' ? ' active' : ''}" data-click="spSetArt('lang')" title="Erdbecken (saisonal): Sommerwärme in den Winter verschieben">Langzeitspeicher</button>
      </div>
      <label class="sp-feld sp-feld-breit"><span>Volumen</span>
        <input type="range" id="sp-schieber" min="0" max="${d.stufen.length - 1}" step="1" value="${idx}" data-input="spSchieber(+this.value)"/>
        <input class="inp-field" type="text" id="sp-vol" value="${nf(a.vol)}" data-change="spEingabe()" title="m³ — leer = Vorschlag"/><small>m³</small></label>
      <label class="sp-feld"><span>ΔT</span><input class="inp-field" type="text" id="sp-dt" value="${S.dt}" data-change="spEingabe()"/><small>K</small></label>
      <label class="sp-feld"><span>Verlust</span><input class="inp-field" type="text" id="sp-verlust" value="${S.verlust ?? ''}" placeholder="${(a.param.verlustRate * 100).toPrecision(2)}" data-change="spEingabe()" title="% des Ladezustands je Stunde — leer = nach Größe"/><small>%/h</small></label>
      <label class="sp-feld"><span>Leistung</span><input class="inp-field" type="text" id="sp-leistung" value="${S.leistungKw ?? ''}" placeholder="${nf(a.param.ladeKw)}" data-change="spEingabe()" title="Lade-/Entladeleistung kW — leer = automatisch"/><small>kW</small></label>
      <label class="sp-check" title="Ohne Haken laden die Wärmepumpen den Speicher nur tagsüber (8–18 Uhr)"><input type="checkbox" id="sp-lade-immer"${a.param.ladeBis - a.param.ladeVon >= 24 ? ' checked' : ''} data-change="spEingabe()"/> WP lädt rund um die Uhr</label>
    </div>
    <div class="sp-kpis">
      ${kpi('Speicherinhalt', nf(a.param.kapKwh / 1000, 1) + ' MWh', `${nf(a.vol)} m³ · ΔT ${S.dt} K`)}
      ${kpi('Investition', eur(a.invest), `${nf(a.invest / a.vol)} €/m³`)}
      ${kpi('Vollzyklen', nf(kw.vollzyklen, kw.vollzyklen < 10 ? 1 : 0) + ' /a', `max. Füllung ${nf(kw.maxFuellPct)} %`)}
      ${kpi('Speicherverluste', nf(kw.verlustMwh, 1) + ' MWh/a', `${nf(kw.verlustPct)} % der eingespeicherten Wärme`)}
      ${kpi('Kesselwärme vermieden', nf(kw.kesselVermiedenMwh, 1) + ' MWh/a', `${nf(kw.kesselOhneMwh)} → ${nf(kw.kesselMitMwh)} MWh/a`)}
      ${kpi('EE-Anteil', nf(a.ee, 1) + ' %', `ohne Speicher ${nf(d.ohne.ee, 1)} %`)}
      ${kpi('Spitzenkessel', nf(kw.spitzeMitKw) + ' kW', `ohne Speicher ${nf(kw.spitzeOhneKw)} kW`)}
      ${kpi('Jahreskosten', (a.deltaJk > 0 ? '+' : '−') + eur(Math.abs(a.deltaJk)) + '/a', `WGK ${nf(d.ohne.wgk, 2)} → ${nf(a.wgk, 2)} ct/kWh`, lohnt ? FARBE.gut : FARBE.schlecht)}
      ${kpi('Amortisation', a.amortisation ? nf(a.amortisation, 1) + ' Jahre' : '—', a.amortisation ? 'statisch, Investition / Einsparung' : 'keine Betriebseinsparung')}
    </div>
    <div class="sp-fazit ${lohnt ? 'sp-gut' : 'sp-schlecht'}">${lohnt ? '✓ Diese Größe senkt die Jahreskosten.' : '✗ Diese Größe erhöht die Jahreskosten.'} ${optText}</div>
    <div class="sp-titelzeile"><div class="sa-svg-title">Füllstand stundenscharf</div>
      <div class="sp-ansicht">${[['jahr', 'Jahr'], ...Object.entries(WOCHEN)].map(([k, t]) => `<button class="viz-btn${S.ansicht === k ? ' active' : ''}" data-click="spSetAnsicht('${k}')">${t}</button>`).join('')}</div></div>
    <canvas id="sp-canvas-soc" height="200"></canvas>
    <div class="sp-legende"><span style="color:${FARBE.soc}">■</span> Füllstand ${S.ansicht !== 'jahr' ? `<span style="color:${FARBE.laden}">■</span> Laden <span style="color:${FARBE.entladen}">■</span> Entladen <span style="color:${FARBE.kessel}">■</span> Restlast Spitzenkessel` : ''}</div>
    <div class="sa-svg-title" style="margin-top:12px;">Größenvariation — Wirkung und Wirtschaftlichkeit</div>
    <canvas id="sp-canvas-variation" height="210" title="Klick auf einen Balken wählt diese Größe"></canvas>
    <div class="sp-legende"><span style="color:${FARBE.gut}">■</span> spart Jahreskosten <span style="color:${FARBE.schlecht}">■</span> kostet mehr <span style="color:${FARBE.akzent}">━</span> vermiedene Kesselwärme (rechte Achse) <span style="color:#fff">▼</span> Auswahl${d.bestand ? ' <span style="color:#ffd54f">▼</span> geplanter Speicher' : ''}</div>
    <div class="sp-fuss">
      <span>Rechnet die Einsatzplanung des Projekts mit und ohne Speicher (Speicher entlädt nach den Wärmepumpen und vor den Kesseln, laden über WP-Reserve, Solarthermie-Überschuss und BHKW-Mindestlast). Kosten: Annahmen nach Marktspannen, Annuität 20 a, inkl. Instandhaltung — Energie- und CO₂-Kosten wie im Wirtschaftlichkeitspanel (ohne PV-Anrechnung).</span>
      <button class="btn-secondary" data-click="spUebernehmen()" title="Typ, Volumen, ΔT, Verluste und Leistung in das Wärmespeicher-Panel übernehmen">Als Wärmespeicher übernehmen</button>
    </div>
    <div id="sp-hinweis" class="sp-hinweis"></div>`;
  _zeichneSoc(d);
  _zeichneVariation(d);
}

function _flaeche(id) {
  const c = el(id);
  if (!c) return null;
  const W = c.parentElement?.clientWidth || 700;
  const H = Number(c.getAttribute('height')) || 200;
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px "DM Mono", monospace';
  return { c, ctx, W, H };
}

function _wochenStart(d, art) {
  if (art === 'uebergang') return 24 * 98;     // ~8. April
  if (art === 'sommer') return 24 * 188;       // ~8. Juli
  // kälteste Woche: niedrigstes 7-Tage-Mittel der Außentemperatur
  const t = d.stunden.tempH;
  if (!t) return 0;
  let best = 0, bestV = Infinity, sum = 0;
  for (let i = 0; i < t.length; i++) {
    sum += t[i]; if (i >= 168) sum -= t[i - 168];
    if (i >= 167 && sum < bestV) { bestV = sum; best = i - 167; }
  }
  return Math.floor(best / 24) * 24;
}

function _zeichneSoc(d) {
  const f = _flaeche('sp-canvas-soc');
  if (!f) return;
  const { ctx, W, H } = f;
  const L = 44, R = 8, T = 8, B = 18, pw = W - L - R, ph = H - T - B;
  const soc = d.stunden.soc, kap = d.auswahl.param.kapKwh;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const p of [0, 50, 100]) {
    const y = T + ph * (1 - p / 100);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillText(p + ' %', 4, y + 3);
  }
  if (!soc || !(kap > 0)) return;
  if (S.ansicht === 'jahr') {
    const n = soc.length;
    ctx.fillStyle = FARBE.soc;
    for (let x = 0; x < pw; x++) {
      const i0 = Math.floor(x / pw * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / pw * n));
      let mx = 0, mn = Infinity;
      for (let i = i0; i < i1; i++) { if (soc[i] > mx) mx = soc[i]; if (soc[i] < mn) mn = soc[i]; }
      const yMx = T + ph * (1 - mx / kap), yMn = T + ph * (1 - mn / kap);
      ctx.globalAlpha = 0.35; ctx.fillRect(L + x, yMx, 1, T + ph - yMx);
      ctx.globalAlpha = 1; ctx.fillRect(L + x, yMx, 1, Math.max(1, yMn - yMx));
    }
    const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const MS = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016];
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    MS.forEach((h, m) => ctx.fillText(MON[m], L + h / n * pw + 2, H - 5));
    return;
  }
  const s0 = _wochenStart(d, S.ansicht), n = 168;
  const { laden, entladen, rest } = d.stunden;
  let pMax = 1;
  for (let i = 0; i < n; i++) pMax = Math.max(pMax, laden?.[s0 + i] || 0, (entladen?.[s0 + i] || 0) + (rest?.[s0 + i] || 0));
  const bw = pw / n;
  // Leistungen als Balken (untere Hälfte), Füllstand als Fläche
  for (let i = 0; i < n; i++) {
    const x = L + i * bw;
    const hL = (laden?.[s0 + i] || 0) / pMax * ph * 0.45, hE = (entladen?.[s0 + i] || 0) / pMax * ph * 0.45, hR = (rest?.[s0 + i] || 0) / pMax * ph * 0.45;
    ctx.fillStyle = FARBE.laden; ctx.globalAlpha = 0.55; ctx.fillRect(x, T + ph - hL, Math.max(1, bw - 0.5), hL);
    ctx.fillStyle = FARBE.entladen; ctx.globalAlpha = 0.85; ctx.fillRect(x + bw * 0.5, T + ph - hE, Math.max(1, bw * 0.5), hE);
    ctx.fillStyle = FARBE.kessel; ctx.globalAlpha = 0.8; ctx.fillRect(x + bw * 0.5, T + ph - hE - hR, Math.max(1, bw * 0.5), hR);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = FARBE.soc; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = L + (i + 0.5) * bw, y = T + ph * (1 - (soc[s0 + i] || 0) / kap);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  const TAG = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const ersterTag = new Date(Date.UTC(Number(window.globalYear) || 2026, 0, 1)).getUTCDay();
  for (let tg = 0; tg < 7; tg++) {
    const datum = new Date(Date.UTC(Number(window.globalYear) || 2026, 0, 1 + s0 / 24 + tg));
    ctx.fillText(TAG[(ersterTag + s0 / 24 + tg + 6) % 7] + ' ' + datum.getUTCDate() + '.' + (datum.getUTCMonth() + 1) + '.', L + tg * 24 * bw + 2, H - 5);
  }
  ctx.fillText('max. ' + nf(pMax) + ' kW', W - R - 90, T + 10);
}

function _zeichneVariation(d) {
  const f = _flaeche('sp-canvas-variation');
  if (!f) return;
  const { c, ctx, W, H } = f;
  const L = 58, R = 52, T = 14, B = 30, pw = W - L - R, ph = H - T - B;
  const st = d.stufen;
  if (!st.length) return;
  let dMax = 1, dMin = 0, kMax = 1;
  for (const s of st) { dMax = Math.max(dMax, s.deltaJk); dMin = Math.min(dMin, s.deltaJk); kMax = Math.max(kMax, s.kw.kesselVermiedenMwh); }
  if (dMin === 0) dMin = -dMax * 0.04;   // Nulllinie knapp über dem Rand
  const y0 = T + ph * dMax / (dMax - dMin);
  const yD = v => y0 - v / (dMax - dMin) * ph;
  const bw = pw / st.length;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(L, y0); ctx.lineTo(W - R, y0); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('+' + eur(dMax), 2, T + 4); ctx.fillText('0 €/a', 2, y0 + 3);
  if (dMin < 0 && T + ph - y0 > 14) ctx.fillText('−' + eur(-dMin), 2, T + ph);
  ctx.fillText(nf(kMax) + ' MWh', W - R + 4, T + 4); ctx.fillText('0', W - R + 4, T + ph);
  st.forEach((s, i) => {
    const x = L + i * bw + bw * 0.15, w = bw * 0.7, y = yD(s.deltaJk);
    ctx.fillStyle = s.deltaJk < 0 ? FARBE.gut : FARBE.schlecht; ctx.globalAlpha = 0.75;
    ctx.fillRect(x, Math.min(y, y0), w, Math.max(1, Math.abs(y - y0)));
    ctx.globalAlpha = 1;
    if (i % Math.ceil(st.length / 7) === 0 || i === st.length - 1) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(nf(s.vol), x - 2, H - 16); }
  });
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('Volumen m³', L + pw / 2 - 30, H - 3);
  ctx.strokeStyle = FARBE.akzent; ctx.lineWidth = 2; ctx.beginPath();
  st.forEach((s, i) => { const x = L + (i + 0.5) * bw, y = T + ph * (1 - s.kw.kesselVermiedenMwh / kMax); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke(); ctx.lineWidth = 1;
  const marke = (vol, farbe) => {
    let j = 0; for (let i = 0; i < st.length; i++) if (Math.abs(Math.log(st[i].vol / vol)) < Math.abs(Math.log(st[j].vol / vol))) j = i;
    const x = L + (j + 0.5) * bw;
    ctx.fillStyle = farbe; ctx.beginPath(); ctx.moveTo(x - 5, T - 10); ctx.lineTo(x + 5, T - 10); ctx.lineTo(x, T - 3); ctx.fill();
  };
  if (d.bestand?.vol > 0) marke(d.bestand.vol, '#ffd54f');
  marke(d.auswahl.vol, '#ffffff');
  c.onclick = ev => {
    const rect = c.getBoundingClientRect();
    const i = Math.floor((ev.clientX - rect.left - L) / bw);
    if (i >= 0 && i < st.length) { S.vol = st[i].vol; spRender(); }
  };
}

// Für Tests und Konsole: Einstellungen setzen ohne DOM
export function spEinstellungen(neu) { Object.assign(S, neu || {}); return { ...S }; }

/** Aus dem Wärmespeicher-Panel: Einsatzanalyse mit dem Reiter „Speicher“ öffnen. */
export function spOeffnen() {
  const p = el('analyse-panel');
  if (p && !p.classList.contains('visible')) window.toggleAnalysePanel?.();
  window.saSetTab?.('speicher');
}
