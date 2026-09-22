// ── 28-pv-ausbau-karte.js — PV-Ausbau im Bestand auf der Karte ──────────────
//
// Kartengegenstück zu Abb. 6 der PV-Analyse. Ein Schieber unten auf der Karte
// schaltet die PV-Anlagen Anlage für Anlage zu — was heute steht zuerst, dann
// in der gewählten Reihenfolge. Mit jeder Anlage wächst die Rückspeisespitze,
// und die Bestands-Trafos und der NAP färben sich nach ihrer Auslastung:
// grün trägt, gelb wird eng, rot braucht eine Ertüchtigung.
//
// Die Rechnung kommt aus der PV-Analyse (pvAusbauKontext: Lastgang, PV-Profil,
// NAP-Grenze, S_k″) — hier steht nur Bedienung und Darstellung. Die Aufteilung
// der Spitze auf die Trafos ist ein Screening nach PV-Anteil, kein Lastfluss
// (lib/pv-bestand-ausbau.js: trafoBelastung).

import { map } from './02b-gebaeude.js';
import { polygonCenter } from './02c-karte-werkzeuge.js';
import { calcGebKwp, escHtml } from './03c-gebaeude-io.js';
import { ASSETS, getCanonicalAssetEdges } from './13a-assets-core.js';
import { pvAusbauKontext } from './09d-pv-analyse.js';
import { blattZuTrafo } from './lib/netz-schwellen.js';
import { normSchicht, SCHICHT } from './lib/schichten.js';
import {
  ausbauReihenfolge, ausbauStand, bestandsGrenzen, trafoBelastung, kwpBeiRueck,
} from './lib/pv-bestand-ausbau.js';

const BAR_ID = 'pv-ausbau-karte';
const PANE   = 'pvAusbauPane';
const STUFE_COL = { frei: '#66bb6a', eng: '#ffb74d', ueber: '#ef5350' };
const STUFE_TXT = { frei: 'trägt', eng: 'wird eng', ueber: 'überlastet' };
const KURVE_PUNKTE = 40;

/** @type {null | {
 *   ctx: NonNullable<ReturnType<typeof pvAusbauKontext>>,
 *   anlagen: any[], folge: any[], trafos: any[], nap: any, grenzen: any[],
 *   idx: number, bat: number, modus: string, kurve: Array<{kwp:number, rueckKw:number}>,
 *   layer: any, timer: any, cache: Map<string, number>, band: any,
 * }} */
let _z = null;

const _fmt  = n => Math.round(n).toLocaleString('de-DE');
const _fmtE = n => n >= 1e6 ? (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Mio. €'
                 : n >= 1e4 ? _fmt(n / 1000) + ' T€' : _fmt(n) + ' €';

// ── Daten aus dem Projekt ────────────────────────────────────────────────────

/** PV-Anlagen mit Standort: PV-Assets und Gebäude-PV ohne eigenes Asset. */
function _anlagenSammeln() {
  const items = ASSETS?.items || [];
  const edges = getCanonicalAssetEdges();
  const out = [];
  for (const a of items) {
    if (a.type !== 'PV') continue;
    const kwp = parseFloat(a.props?.leistungKWp) || 0;
    if (kwp <= 0 || !Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    out.push({ id: a.id, name: a.name || 'PV', kwp, lat: a.lat, lng: a.lng,
               schicht: normSchicht(a.schicht), trafoId: blattZuTrafo(a.id, items, edges) });
  }
  const mitAsset = new Set(items.filter(a => a.type === 'PV' && a.buildingId != null).map(a => a.buildingId));
  for (const g of (window.gebaeude || [])) {
    if (!g.pvAktiv || mitAsset.has(g.id)) continue;
    const kwp = calcGebKwp(g);
    const pos = Array.isArray(g.polygon) && g.polygon.length >= 3 ? polygonCenter(g.polygon)
              : Number.isFinite(g.lat) ? { lat: g.lat, lng: g.lng } : null;
    if (kwp <= 0 || !pos) continue;
    out.push({ id: 'geb_' + g.id, name: g.name || ('Gebäude ' + g.id), kwp, lat: pos.lat, lng: pos.lng,
               schicht: normSchicht(g.schicht), trafoId: null });
  }
  return out;
}

function _bestandTrafos() {
  return (ASSETS?.items || [])
    .filter(a => a.type === 'Trafo' && normSchicht(a.schicht) === SCHICHT.BESTAND)
    .map(a => ({ id: a.id, name: a.name || 'Trafo', kva: parseFloat(a.props?.leistungKVA) || 0, lat: a.lat, lng: a.lng }))
    .filter(t => t.kva > 0);
}

// ── Rechnung ─────────────────────────────────────────────────────────────────

function _rueck(kwp) {
  const key = Math.round(kwp) + '|' + Math.round(_z.bat);
  if (!_z.cache.has(key)) _z.cache.set(key, _z.ctx.rueckKw(kwp, _z.bat));
  return _z.cache.get(key);
}

function _kurveRechnen() {
  const max = _z.folge.reduce((s, a) => s + a.kwp, 0) || 1;
  _z.kurve = [];
  for (let i = 0; i <= KURVE_PUNKTE; i++) {
    const kwp = max * i / KURVE_PUNKTE;
    _z.kurve.push({ kwp, rueckKw: _rueck(kwp) });
  }
}

/** Rückspeisespitze aus der Kurve (für die Statusleiste unter dem Schieber). */
function _rueckInterp(kwp) {
  const k = _z.kurve;
  if (!k.length) return 0;
  for (let i = 1; i < k.length; i++) {
    if (k[i].kwp >= kwp) {
      const f = (kwp - k[i - 1].kwp) / ((k[i].kwp - k[i - 1].kwp) || 1);
      return k[i - 1].rueckKw + f * (k[i].rueckKw - k[i - 1].rueckKw);
    }
  }
  return k[k.length - 1].rueckKw;
}

/** Ausbaustand beim Index i (i Anlagen zugeschaltet). */
function _stand(i, exakt = true) {
  const gebaut = _z.folge.slice(0, i);
  const kwp = gebaut.reduce((s, a) => s + a.kwp, 0);
  const rueck = exakt ? _rueck(kwp) : _rueckInterp(kwp);
  const trafos = trafoBelastung(gebaut, _z.trafos, rueck);
  const stand = ausbauStand(rueck, _z.grenzen);
  let stufe = stand.stufe;
  for (const t of trafos.values()) {
    if (t.stufe === 'ueber') stufe = 'ueber';
    else if (t.stufe === 'eng' && stufe === 'frei') stufe = 'eng';
  }
  return { gebaut, kwp, rueck, trafos, stand, stufe };
}

// ── Karte ────────────────────────────────────────────────────────────────────

function _pane() {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = '640';
}

function _badge(text, col, sub) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);display:inline-flex;flex-direction:column;align-items:center;
      background:rgba(12,18,32,0.92);border:2px solid ${col};border-radius:7px;padding:2px 7px;white-space:nowrap;
      box-shadow:0 2px 10px rgba(0,0,0,.5);font-family:'DM Mono',monospace;">
      <span style="font-size:11px;font-weight:700;color:${col};">${text}</span>
      ${sub ? `<span style="font-size:9px;color:#b0bec5;">${sub}</span>` : ''}</div>`,
    iconSize: [0, 0],
  });
}

function _zeichnen(st) {
  _z.layer.clearLayers();
  const gebautIds = new Set(st.gebaut.map(a => a.id));
  const neu = st.gebaut[st.gebaut.length - 1];
  const trafoPos = new Map(_z.trafos.map(t => [t.id, t]));

  // Verbindungen PV → Trafo
  for (const a of st.gebaut) {
    const t = a.trafoId && trafoPos.get(a.trafoId);
    const b = t && st.trafos.get(t.id);
    if (!t || !b || !Number.isFinite(t.lat)) continue;
    L.polyline([[a.lat, a.lng], [t.lat, t.lng]], {
      pane: PANE, color: STUFE_COL[b.stufe], weight: 1.5, opacity: 0.55, dashArray: '4,4', interactive: false,
    }).addTo(_z.layer);
  }

  // PV-Anlagen
  for (const a of _z.folge) {
    const an = gebautIds.has(a.id);
    const r = Math.max(5, Math.min(20, 4 + Math.sqrt(a.kwp) * 0.9));
    const trafoStufe = a.trafoId && st.trafos.get(a.trafoId)?.stufe;
    L.circleMarker([a.lat, a.lng], {
      pane: PANE, radius: r,
      color: an ? (trafoStufe ? STUFE_COL[trafoStufe] : '#fdd835') : '#90a4ae',
      weight: an ? 2 : 1, dashArray: an ? null : '3,3',
      fillColor: '#fdd835', fillOpacity: an ? 0.85 : 0.06, opacity: an ? 1 : 0.7,
    }).bindTooltip(`<b>${escHtml(a.name)}</b><br>${_fmt(a.kwp)} kWp · ${an ? 'zugeschaltet' : 'noch nicht gebaut'}`
      + `<br>${a.schicht === SCHICHT.BESTAND ? 'Bestand' : a.schicht === SCHICHT.ENTWICKLUNG ? 'Entwicklung' : 'Planung'}`
      + `${a.trafoId ? '' : '<br><span style="color:#ffb74d">ohne Kabelweg zu einem Trafo</span>'}`)
      .addTo(_z.layer);
  }
  if (neu) {
    L.circleMarker([neu.lat, neu.lng], {
      pane: PANE, radius: Math.max(9, Math.min(26, 8 + Math.sqrt(neu.kwp) * 0.9)),
      color: '#ffffff', weight: 2, fill: false, opacity: 0.9, interactive: false,
    }).addTo(_z.layer);
  }

  // Trafos
  for (const t of _z.trafos) {
    const b = st.trafos.get(t.id);
    if (!b || !Number.isFinite(t.lat)) continue;
    const col = STUFE_COL[b.stufe];
    L.marker([t.lat, t.lng], { pane: PANE, icon: _badge(`⚡ ${Math.round(b.quote * 100)} %`, col, `${_fmt(t.kva)} kVA`) })
      .bindTooltip(`<b>${escHtml(t.name)}</b> · ${_fmt(t.kva)} kVA<br>`
        + `PV am Trafo: ${_fmt(b.kwp)} kWp<br>Rückspeisung: ${_fmt(b.rueckKw)} von ${_fmt(b.kapKw)} kW`
        + (b.geschaetztKw > 0.5 ? `<br><span style="color:#90a4ae">davon ${_fmt(b.geschaetztKw)} kW geschätzt (PV ohne Kabelweg)</span>` : '')
        + `<br><b style="color:${col}">${STUFE_TXT[b.stufe]}</b>`
        + (b.massnahme ? `<br>${escHtml(b.massnahme.titel)} · ≈ ${_fmtE(b.massnahme.kostenEUR)}` : ''))
      .addTo(_z.layer);
  }

  // NAP
  const napGrenze = st.stand.komponenten.find(k => k.id === 'nap');
  if (_z.nap && napGrenze) {
    const col = STUFE_COL[napGrenze.stufe];
    L.marker([_z.nap.lat, _z.nap.lng], { pane: PANE, icon: _badge(`NAP ${Math.round(napGrenze.quote * 100)} %`, col, `${_fmt(st.rueck)} / ${_fmt(napGrenze.kapKw)} kW`) })
      .bindTooltip(`<b>Netzanschlusspunkt</b><br>Rückspeisespitze ${_fmt(st.rueck)} kW, Zusage ${_fmt(napGrenze.kapKw)} kW`
        + `<br><b style="color:${col}">${STUFE_TXT[napGrenze.stufe]}</b>`
        + (napGrenze.massnahme ? `<br>${escHtml(napGrenze.massnahme.titel)} · ≈ ${_fmtE(napGrenze.massnahme.kostenEUR)}` : ''))
      .addTo(_z.layer);
  }
}

// ── Schieberleiste ───────────────────────────────────────────────────────────

function _bar() {
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:3200;background:var(--surface);'
      + 'border:1px solid #fdd835;border-radius:10px;padding:10px 16px 12px;box-shadow:0 8px 32px rgba(0,0,0,.6);'
      + 'width:min(760px,94vw);box-sizing:border-box;';
    document.body.appendChild(bar);
  }
  return bar;
}

/** Farbband unter dem Schieber: Zustand des Bestands je Ausbauschritt. */
function _statusBand() {
  const n = _z.folge.length;
  if (!n) return '';
  let segs = '';
  for (let i = 1; i <= n; i++) {
    const s = _stand(i, false).stufe;
    segs += `<div style="flex:1;background:${STUFE_COL[s]};opacity:${s === 'frei' ? 0.45 : 0.85};"></div>`;
  }
  return segs;
}

/** Schritte, an denen eine Grenze erstmals reißt (für die Marken unter dem Schieber). */
function _kippSchritte() {
  const out = [];
  let vorher = new Set();
  for (let i = 1; i <= _z.folge.length; i++) {
    const st = _stand(i, false);
    const jetzt = new Set([
      ...st.stand.komponenten.filter(k => k.stufe === 'ueber').map(k => k.id === 'trafo' ? 'Σ Trafo' : k.kurz),
      ...[...st.trafos.values()].filter(t => t.stufe === 'ueber').map(t => t.name),
    ]);
    for (const x of jetzt) if (!vorher.has(x)) out.push({ i, name: x });
    vorher = jetzt;
  }
  return out;
}

function _barRender() {
  const bar = _bar();
  const n = _z.folge.length;
  const st = _stand(_z.idx);
  const neu = st.gebaut[st.gebaut.length - 1];
  const kwpMax = _z.folge.reduce((s, a) => s + a.kwp, 0);
  const col = STUFE_COL[st.stufe];
  const playing = !!_z.timer;

  const ueberTrafos = [...st.trafos.values()].filter(t => t.stufe === 'ueber');
  const massnahmen = [
    ...ueberTrafos.map(t => `${escHtml(t.name)}: ${escHtml(t.massnahme.titel)} (≈ ${_fmtE(t.massnahme.kostenEUR)})`),
    ...st.stand.komponenten.filter(k => k.massnahme && k.id !== 'trafo').map(k => `${escHtml(k.massnahme.titel)} (≈ ${_fmtE(k.massnahme.kostenEUR)})`),
  ];
  // Summen-Trafo nur, wenn es keine einzelnen Trafo-Standorte gibt (sonst doppelt)
  if (!_z.trafos.length) {
    const t = st.stand.komponenten.find(k => k.id === 'trafo' && k.massnahme);
    if (t) massnahmen.unshift(`${escHtml(t.massnahme.titel)} (≈ ${_fmtE(t.massnahme.kostenEUR)})`);
  }

  let neuTxt = '';
  if (neu) {
    const t = neu.trafoId && st.trafos.get(neu.trafoId);
    neuTxt = `<b style="color:#fdd835;">+ ${escHtml(neu.name)}</b> (${_fmt(neu.kwp)} kWp)`
      + (t ? ` → ${escHtml(t.name)} jetzt <b style="color:${STUFE_COL[t.stufe]}">${Math.round(t.quote * 100)} %</b>` : '');
  } else {
    neuTxt = '<span style="color:var(--muted)">Noch keine Anlage zugeschaltet — Schieber nach rechts ziehen.</span>';
  }

  // Band und Kipp-Marken hängen nur an Reihenfolge und Batterie, nicht am Schieber
  const bandKey = _z.modus + '|' + _z.bat;
  if (_z.band?.key !== bandKey) _z.band = { key: bandKey, html: _statusBand(), kipp: _kippSchritte() };
  const kipp = _z.band.kipp;
  const grenzChips = st.stand.komponenten.map(k =>
    `<span style="border:1px solid ${STUFE_COL[k.stufe]};color:${STUFE_COL[k.stufe]};border-radius:9px;padding:0 6px;font-size:10px;white-space:nowrap;"
      title="${escHtml(k.label)}: ${_fmt(st.rueck)} von ${_fmt(k.kapKw)} kW">${k.id === 'trafo' ? 'Σ Trafo' : k.kurz} ${Math.round(k.quote * 100)} %</span>`).join(' ');

  bar.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
      <span style="font-size:13px;font-weight:700;color:#fdd835;white-space:nowrap;">☀ PV-Ausbau im Bestand</span>
      <span style="font-size:11px;color:var(--text);white-space:nowrap;">${_z.idx}/${n} Anlagen · <b>${_fmt(st.kwp)}</b> von ${_fmt(kwpMax)} kWp · Rückspeisung <b>${_fmt(st.rueck)} kW</b></span>
      <span style="font-size:11px;font-weight:600;color:${col};white-space:nowrap;">● Bestand ${STUFE_TXT[st.stufe]}</span>
      <span style="margin-left:auto;cursor:pointer;color:var(--muted);font-size:14px;" title="Schließen" data-pak="zu">✕</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <button data-pak="play" style="flex:0 0 auto;cursor:pointer;background:rgba(253,216,53,0.1);border:1px solid rgba(253,216,53,0.45);border-radius:5px;color:#fdd835;font-size:12px;padding:2px 10px;" title="${playing ? 'Anhalten' : 'Ausbau abspielen'}">${playing ? '⏸' : '▶'}</button>
      <div style="flex:1;min-width:0;position:relative;">
        <input data-pak="idx" type="range" min="0" max="${n}" step="1" value="${_z.idx}" style="width:100%;accent-color:#fdd835;cursor:pointer;margin:0;">
        <div style="display:flex;height:5px;border-radius:3px;overflow:hidden;margin:2px 8px 0;">${_z.band.html}</div>
        <div style="position:relative;height:${kipp.length ? 14 : 0}px;margin:0 8px;">
          ${kipp.map(k => `<span title="ab Anlage ${k.i}: ${escHtml(k.name)} überlastet" style="position:absolute;left:${((k.i - 0.5) / n * 100).toFixed(1)}%;transform:translateX(-50%);font-size:9px;color:#ef9a9a;white-space:nowrap;">▲ ${escHtml(k.name)}</span>`).join('')}
        </div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:10px;color:var(--muted);">
      <label>Reihenfolge
        <select data-pak="modus" style="font-size:10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;">
          <option value="schicht" ${_z.modus === 'schicht' ? 'selected' : ''}>Bestand → Entwicklung → Planung</option>
          <option value="gross" ${_z.modus === 'gross' ? 'selected' : ''}>große Anlagen zuerst</option>
          <option value="klein" ${_z.modus === 'klein' ? 'selected' : ''}>kleine Anlagen zuerst</option>
        </select></label>
      <label style="display:flex;align-items:center;gap:5px;">Batterie
        <input data-pak="bat" type="range" min="0" max="${Math.max(1500, Math.round(_z.ctx.batVorschlagKwh * 2 / 500) * 500)}" step="100" value="${Math.round(_z.bat)}" style="width:110px;accent-color:#42a5f5;">
        <span style="font-family:'DM Mono',monospace;color:#42a5f5;width:62px;">${_z.bat > 0 ? (_z.bat / 1000).toFixed(1) + ' MWh' : 'ohne'}</span></label>
      <span style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;">${grenzChips}</span>
    </div>
    <div style="font-size:11px;margin-top:7px;line-height:1.5;">${neuTxt}</div>
    ${massnahmen.length ? `<div style="font-size:10.5px;color:#ef9a9a;margin-top:3px;line-height:1.5;">Fällig: ${massnahmen.join(' · ')}</div>` : ''}
    <div style="font-size:9px;color:var(--muted);margin-top:5px;">
      <span style="color:#fdd835">●</span> gebaut · <span style="color:#90a4ae">○</span> geplant ·
      Trafo-Rückspeisung anteilig nach PV-Leistung am Trafo (Screening, kein Lastfluss)${_z.trafos.length ? '' : ' · keine Bestands-Trafos mit kVA erfasst'}${_z.nap ? '' : ' · kein NAP-Asset auf der Karte'}
    </div>`;

  _zeichnen(st);

  bar.querySelector('[data-pak="zu"]').addEventListener('click', pvAusbauKarteSchliessen);
  bar.querySelector('[data-pak="play"]').addEventListener('click', _play);
  bar.querySelector('[data-pak="idx"]').addEventListener('input', e => {
    _stopPlay();
    _z.idx = parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0;
    _barRender();
  });
  bar.querySelector('[data-pak="modus"]').addEventListener('change', e => {
    _z.modus = /** @type {HTMLSelectElement} */ (e.target).value;
    _z.folge = ausbauReihenfolge(_z.anlagen, _z.modus);
    _barRender();
  });
  bar.querySelector('[data-pak="bat"]').addEventListener('change', e => {
    _z.bat = parseFloat(/** @type {HTMLInputElement} */ (e.target).value) || 0;
    _kurveRechnen();
    _barRender();
  });
}

function _play() {
  if (_z.timer) { _stopPlay(); _barRender(); return; }
  const n = _z.folge.length;
  if (_z.idx >= n) _z.idx = _z.folge.filter(a => a.schicht === SCHICHT.BESTAND).length;
  _z.timer = setInterval(() => {
    if (!_z || _z.idx >= _z.folge.length) { _stopPlay(); if (_z) _barRender(); return; }
    _z.idx++;
    _barRender();
  }, Math.max(150, Math.min(900, 9000 / Math.max(1, n))));
  _barRender();
}

function _stopPlay() {
  if (_z?.timer) { clearInterval(_z.timer); _z.timer = null; }
}

// ── Öffnen / Schließen ───────────────────────────────────────────────────────

export function pvAusbauKarteOeffnen() {
  const ctx = pvAusbauKontext();
  if (!ctx) {
    alert('Erst in der ☀ PV-Analyse „Varianten berechnen" — die Karte nutzt deren Lastgang und Netzgrenzen.');
    return;
  }
  const anlagen = _anlagenSammeln();
  if (!anlagen.length) {
    alert('Keine PV-Anlage mit Standort gefunden — PV-Assets oder Gebäude-PV auf der Karte anlegen.');
    return;
  }
  if (_z) pvAusbauKarteSchliessen();
  window.setViewMode?.('karte');

  const trafos = _bestandTrafos();
  const nap = (ASSETS?.items || []).find(a => a.type === 'NAP' && Number.isFinite(a.lat)) || null;
  const trafoKva = ctx.trafoKvaOverride > 0 ? ctx.trafoKvaOverride : trafos.reduce((s, t) => s + t.kva, 0);
  _pane();
  _z = {
    ctx, anlagen, trafos, nap,
    grenzen: bestandsGrenzen({ trafoKva, napKw: ctx.napKw, skKva: ctx.skKva, uBudgetPct: ctx.uBudgetPct }),
    modus: 'schicht', folge: ausbauReihenfolge(anlagen, 'schicht'),
    idx: 0, bat: 0, kurve: [], layer: L.layerGroup().addTo(map), timer: null, cache: new Map(), band: null,
  };
  _kurveRechnen();
  // Start: der heutige Stand — alles, was schon steht
  _z.idx = _z.folge.filter(a => a.schicht === SCHICHT.BESTAND).length;
  _barRender();

  const punkte = [...anlagen.map(a => [a.lat, a.lng]), ...trafos.filter(t => Number.isFinite(t.lat)).map(t => [t.lat, t.lng])];
  if (nap) punkte.push([nap.lat, nap.lng]);
  if (punkte.length) {
    // Die Kartenansicht war evtl. versteckt: erst Größe neu messen, dann einpassen.
    // Unten Platz für die Schieberleiste lassen.
    const einpassen = () => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(punkte), { paddingTopLeft: [60, 60], paddingBottomRight: [60, 220], maxZoom: 18 });
    };
    einpassen();
    setTimeout(einpassen, 150);
  }
}

export function pvAusbauKarteSchliessen() {
  _stopPlay();
  if (_z?.layer) map.removeLayer(_z.layer);
  _z = null;
  const bar = document.getElementById(BAR_ID);
  if (bar) bar.remove();
}

/** Für Tests: aktueller Stand der Kartenansicht. */
export function pvAusbauKarteStand() {
  if (!_z) return null;
  const st = _stand(_z.idx);
  return {
    idx: _z.idx, n: _z.folge.length, kwp: st.kwp, rueckKw: st.rueck, stufe: st.stufe,
    trafos: [...st.trafos.values()].map(t => ({ name: t.name, quote: t.quote, stufe: t.stufe })),
    ersteUeberlastBeiKwp: kwpBeiRueck(_z.kurve, _z.grenzen[0]?.kapKw ?? Infinity),
  };
}

window.pvAusbauKarteOeffnen   = pvAusbauKarteOeffnen;
window.pvAusbauKarteSchliessen = pvAusbauKarteSchliessen;
