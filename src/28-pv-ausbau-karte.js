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
import { ERT_TRAFO_STUFEN } from './14b-ertuechtigung.js';
import { blattZuTrafo } from './lib/netz-schwellen.js';
import { normSchicht, SCHICHT } from './lib/schichten.js';
import {
  ausbauReihenfolge, ausbauStand, bestandsGrenzen, trafoBelastung, kwpBeiRueck,
  beschlussReife, neubauAuslegung,
} from './lib/pv-bestand-ausbau.js';

const BAR_ID = 'pv-ausbau-karte';
const PANE   = 'pvAusbauPane';
const STUFE_COL = { frei: '#66bb6a', eng: '#ffb74d', ueber: '#ef5350' };
const STUFE_TXT = { frei: 'trägt', eng: 'wird eng', ueber: 'überlastet' };
const KURVE_PUNKTE = 40;
const HEUTE = new Date().getFullYear();
const KLASSE = {
  bestand: { col: '#cfd8dc', txt: 'Bestand' },
  pflicht: { col: '#b39ddb', txt: 'Pflicht' },
  A:       { col: '#66bb6a', txt: 'A · sofort' },
  B:       { col: '#ffb74d', txt: 'B · mit Ertüchtigung' },
  C:       { col: '#78909c', txt: 'C · zurückstellen' },
};
const URTEIL_COL = { 'passt': '#66bb6a', 'jetzt-groesser': '#ffb74d', 'spaeter': '#4fc3f7', 'dimensionieren': '#ffb74d' };
/** @type {null | {
 *   ctx: NonNullable<ReturnType<typeof pvAusbauKontext>>,
 *   anlagen: any[], folge: any[], trafos: any[], nap: any, grenzen: any[],
 *   idx: number, bat: number, modus: string, kurve: Array<{kwp:number, rueckKw:number}>,
 *   layer: any, timer: any, cache: Map<string, number>, band: any,
 *   trafosBel: any[], lasten: any[], beschluss: any, auslegung: any[], klasse: Map<string, any>,
 *   auswertung: boolean, jahrFallback: number,
 * }} */
let _z = null;

const _fmt  = n => Math.round(n).toLocaleString('de-DE');
const _fmtE = n => n >= 1e6 ? (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Mio. €'
                 : n >= 1e4 ? _fmt(n / 1000) + ' T€' : _fmt(n) + ' €';

// ── Daten aus dem Projekt ────────────────────────────────────────────────────

/**
 * Jahr im Ausbaupfad: ein Baujahr in der Zukunft (am Asset oder am Gebäude)
 * gilt; Bestand steht heute; Geplantes ohne Jahr kommt im Zieljahr des
 * Endausbaus. Ein Asset erbt beim Anlegen das Baujahr des Gebäudes — bei PV
 * auf einem Altbau ist das kein Termin für die PV, deshalb nur Zukunft.
 */
function _jahrVon(obj, schicht, endJahr, zaehler) {
  if (schicht === SCHICHT.BESTAND) return HEUTE;
  const geb = obj.buildingId != null ? (window.gebaeude || []).find(g => g.id === obj.buildingId) : null;
  for (const j of [obj.baujahr, geb?.baujahr]) {
    const y = parseInt(j, 10);
    if (Number.isFinite(y) && y > HEUTE) return y;
  }
  zaehler.n++;
  return endJahr;
}

/** PV-Anlagen mit Standort: PV-Assets und Gebäude-PV ohne eigenes Asset. */
function _anlagenSammeln(ctx, zaehler) {
  const items = ASSETS?.items || [];
  const edges = getCanonicalAssetEdges();
  const endJahr = ctx.endausbauJahr || HEUTE + 15;
  const out = [];
  for (const a of items) {
    if (a.type !== 'PV') continue;
    const kwp = parseFloat(a.props?.leistungKWp) || 0;
    if (kwp <= 0 || !Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    const schicht = normSchicht(a.schicht);
    out.push({ id: a.id, name: a.name || 'PV', kwp, lat: a.lat, lng: a.lng, schicht,
               trafoId: blattZuTrafo(a.id, items, edges),
               pflicht: a.buildingId != null && ctx.pflichtGebIds.has(a.buildingId),
               jahr: _jahrVon(a, schicht, endJahr, zaehler) });
  }
  const mitAsset = new Set(items.filter(a => a.type === 'PV' && a.buildingId != null).map(a => a.buildingId));
  for (const g of (window.gebaeude || [])) {
    if (!g.pvAktiv || mitAsset.has(g.id)) continue;
    const kwp = calcGebKwp(g);
    const pos = Array.isArray(g.polygon) && g.polygon.length >= 3 ? polygonCenter(g.polygon)
              : Number.isFinite(g.lat) ? { lat: g.lat, lng: g.lng } : null;
    if (kwp <= 0 || !pos) continue;
    const schicht = normSchicht(g.schicht);
    out.push({ id: 'geb_' + g.id, name: g.name || ('Gebäude ' + g.id), kwp, lat: pos.lat, lng: pos.lng,
               schicht, trafoId: null, pflicht: ctx.pflichtGebIds.has(g.id),
               jahr: _jahrVon({ buildingId: g.id }, schicht, endJahr, zaehler) });
  }
  return out;
}

/** Alle Trafos: Bestand wird ertüchtigt, alles andere wird ausgelegt (kVA 0 = noch offen). */
function _trafosSammeln() {
  return (ASSETS?.items || [])
    .filter(a => a.type === 'Trafo')
    .map(a => ({ id: a.id, name: a.name || 'Trafo', kva: parseFloat(a.props?.leistungKVA) || 0, lat: a.lat, lng: a.lng,
                 neubau: normSchicht(a.schicht) !== SCHICHT.BESTAND }))
    .filter(t => t.neubau || t.kva > 0);
}

/** Verbraucher für die Bezugsrichtung im Neubau: Verbraucher, Ladepunkte, Wärmepumpen. */
function _lastenSammeln(ctx, zaehler) {
  const items = ASSETS?.items || [];
  const edges = getCanonicalAssetEdges();
  const endJahr = ctx.endausbauJahr || HEUTE + 15;
  const out = [];
  for (const a of items) {
    const p = a.props || {};
    const kw = a.type === 'Verbraucher' || a.type === 'WP' ? parseFloat(p.leistungKW) || 0
             : a.type === 'Lade' ? (parseInt(p.anzahlPunkte, 10) || 1) * (parseFloat(p.leistungProPunktKW) || 11) : 0;
    if (kw <= 0) continue;
    out.push({ kw, trafoId: blattZuTrafo(a.id, items, edges), jahr: _jahrVon(a, normSchicht(a.schicht), endJahr, zaehler) });
  }
  return out;
}

// ── Rechnung ─────────────────────────────────────────────────────────────────

function _rueck(kwp) {
  const key = Math.round(kwp) + '|' + Math.round(_z.bat);
  if (!_z.cache.has(key)) _z.cache.set(key, _z.ctx.rueckKw(kwp, _z.bat));
  return _z.cache.get(key);
}

function _kurveRechnen() {
  const max = _z.anlagen.reduce((s, a) => s + a.kwp, 0) || 1;
  _z.kurve = [];
  for (let i = 0; i <= KURVE_PUNKTE; i++) {
    const kwp = max * i / KURVE_PUNKTE;
    _z.kurve.push({ kwp, rueckKw: _rueck(kwp) });
  }
}

/** Beschlussreife und Neubau-Auslegung — hängen an der Batterie, nicht am Schieber. */
function _auswerten() {
  const kwpMax = _z.anlagen.reduce((s, a) => s + a.kwp, 0) || 1;
  // Jahresüberschuss über der Gesamtleistung; die Steigung ist der Nutzen je kWp
  const N = 20, u = [];
  for (let i = 0; i <= N; i++) u.push(_z.ctx.ueberschuss(kwpMax * i / N, _z.bat));
  const schritt = kwpMax / N;
  const nutzenJeKwp = k => {
    const i = Math.max(0, Math.min(N - 1, Math.floor(k / schritt)));
    const j = Math.min(N, i + 2), h = Math.max(0, j - 2);
    return (u[j] - u[h]) / ((j - h) * schritt);
  };
  const preis = kva => (ERT_TRAFO_STUFEN.find(st => st.bisKvA >= kva) || ERT_TRAFO_STUFEN[ERT_TRAFO_STUFEN.length - 1]).investEUR;

  _z.auslegung = neubauAuslegung({
    trafos: _z.trafos, anlagen: _z.anlagen, lasten: _z.lasten, rueckBeiKwp: _rueckInterp,
    heute: HEUTE, zins: _z.ctx.zins, trafoPreis: preis,
  });
  // Neubau-Trafos rechnen mit ihrer Auslegung: geplant, sonst Empfehlung
  const empf = new Map(_z.auslegung.map(x => [x.id, x.empfKva]));
  _z.trafosBel = _z.trafos.map(t => ({ ...t, kva: t.kva > 0 ? t.kva : (empf.get(t.id) || 0) })).filter(t => t.kva > 0);

  _z.beschluss = beschlussReife({
    anlagen: _z.anlagen,
    trafos: _z.trafosBel.map(t => ({ ...t, kva: t.neubau ? Math.max(t.kva, empf.get(t.id) || 0) : t.kva })),
    rueckBeiKwp: _rueckInterp, napKw: _z.ctx.napKw,
    duKw: _z.ctx.skKva > 0 ? _z.ctx.uBudgetPct / 100 * _z.ctx.skKva : null,
    nutzenJeKwp, zins: _z.ctx.zins,
  });
  _z.klasse = new Map(_z.beschluss.liste.map(l => [l.anlage.id, l]));
}

/** Reihenfolge der Anlagen am Schieber. */
function _folge(modus) {
  if (modus === 'beschluss') return _z.beschluss.liste.map(l => l.anlage);
  if (modus === 'jahr') return [..._z.anlagen].sort((a, b) => a.jahr - b.jahr || b.kwp - a.kwp);
  return ausbauReihenfolge(_z.anlagen, modus);
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
  const trafos = trafoBelastung(gebaut, _z.trafosBel, rueck);
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
    const kl = _z.klasse.get(a.id);
    const klCol = KLASSE[kl?.klasse]?.col;
    const nachKlasse = _z.modus === 'beschluss' && klCol;
    L.circleMarker([a.lat, a.lng], {
      pane: PANE, radius: r,
      color: nachKlasse ? klCol : an ? (trafoStufe ? STUFE_COL[trafoStufe] : '#fdd835') : '#90a4ae',
      weight: nachKlasse ? 3 : an ? 2 : 1, dashArray: an ? null : '3,3',
      fillColor: '#fdd835', fillOpacity: an ? 0.85 : 0.06, opacity: an || nachKlasse ? 1 : 0.7,
    }).bindTooltip(`<b>${escHtml(a.name)}</b><br>${_fmt(a.kwp)} kWp · ${an ? 'zugeschaltet' : 'noch nicht gebaut'}`
      + `<br>${a.schicht === SCHICHT.BESTAND ? 'Bestand' : a.schicht === SCHICHT.ENTWICKLUNG ? 'Entwicklung' : 'Planung'} · Jahr ${a.jahr}`
      + (kl ? `<br><b style="color:${klCol}">${KLASSE[kl.klasse].txt}</b> — ${escHtml(kl.grund)}` : '')
      + (kl?.massnahmen?.length ? `<br>löst aus: ${kl.massnahmen.map(m => escHtml(m.titel)).join(', ')}` : '')
      + `${a.trafoId ? '' : '<br><span style="color:#ffb74d">ohne Kabelweg zu einem Trafo</span>'}`)
      .addTo(_z.layer);
  }
  if (neu) {
    L.circleMarker([neu.lat, neu.lng], {
      pane: PANE, radius: Math.max(9, Math.min(26, 8 + Math.sqrt(neu.kwp) * 0.9)),
      color: '#ffffff', weight: 2, fill: false, opacity: 0.9, interactive: false,
    }).addTo(_z.layer);
  }

  // Trafos — Neubau mit Auslegung statt Ertüchtigung
  const auslegung = new Map(_z.auslegung.map(x => [x.id, x]));
  for (const t of _z.trafosBel) {
    const b = st.trafos.get(t.id);
    if (!b || !Number.isFinite(t.lat)) continue;
    const col = STUFE_COL[b.stufe];
    const aus = auslegung.get(t.id);
    const sub = aus ? `🏗 ${aus.geplantKva > 0 ? _fmt(aus.geplantKva) : '—'} → ${_fmt(aus.empfKva)} kVA` : `${_fmt(t.kva)} kVA`;
    L.marker([t.lat, t.lng], { pane: PANE, icon: _badge(`⚡ ${Math.round(b.quote * 100)} %`, aus ? URTEIL_COL[aus.urteil] : col, sub) })
      .bindTooltip(`<b>${escHtml(t.name)}</b> · ${_fmt(t.kva)} kVA${aus ? ' · Neubau' : ''}<br>`
        + (aus ? `<b style="color:${URTEIL_COL[aus.urteil]}">${escHtml(aus.text)}</b><br>` : '')
        + `PV am Trafo: ${_fmt(b.kwp)} kWp<br>Rückspeisung: ${_fmt(b.rueckKw)} von ${_fmt(b.kapKw)} kW`
        + (b.geschaetztKw > 0.5 ? `<br><span style="color:#90a4ae">davon ${_fmt(b.geschaetztKw)} kW geschätzt (PV ohne Kabelweg)</span>` : '')
        + `<br><b style="color:${col}">${STUFE_TXT[b.stufe]}</b>`
        + (b.massnahme && !aus ? `<br>${escHtml(b.massnahme.titel)} · ≈ ${_fmtE(b.massnahme.kostenEUR)}` : ''))
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
      + 'width:min(860px,94vw);max-height:78vh;overflow-y:auto;box-sizing:border-box;';
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
    const neu = [...jetzt].filter(x => !vorher.has(x));
    if (neu.length) out.push({ i, name: neu.join(', ') });
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

  const neubauIds = new Set(_z.auslegung.map(x => x.id));
  const ueberTrafos = [...st.trafos.values()].filter(t => t.stufe === 'ueber' && !neubauIds.has(t.id));
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
      <button data-pak="auswertung" style="margin-left:auto;cursor:pointer;background:${_z.auswertung ? 'rgba(79,195,247,0.18)' : 'transparent'};border:1px solid rgba(79,195,247,0.5);border-radius:5px;color:#4fc3f7;font-size:10px;padding:1px 8px;">📋 Beschlussreife &amp; Neubau</button>
      <span style="cursor:pointer;color:var(--muted);font-size:14px;" title="Schließen" data-pak="zu">✕</span>
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
          <option value="beschluss" ${_z.modus === 'beschluss' ? 'selected' : ''}>Beschlussreife (Pflicht, A, B, C)</option>
          <option value="jahr" ${_z.modus === 'jahr' ? 'selected' : ''}>nach Baujahr</option>
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
      ${_z.modus === 'beschluss' ? Object.values(KLASSE).map(k => `<span style="color:${k.col}">◯</span> ${k.txt}`).join(' · ') + ' · ' : ''}
      Trafo-Rückspeisung anteilig nach PV-Leistung am Trafo (Screening, kein Lastfluss)${_z.trafos.length ? '' : ' · keine Trafos mit kVA erfasst'}${_z.nap ? '' : ' · kein NAP-Asset auf der Karte'}
    </div>
    ${_z.auswertung ? _auswertungHtml() : ''}`;

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
    _z.folge = _folge(_z.modus);
    _barRender();
  });
  bar.querySelector('[data-pak="bat"]').addEventListener('change', e => {
    _z.bat = parseFloat(/** @type {HTMLInputElement} */ (e.target).value) || 0;
    _kurveRechnen();
    _auswerten();
    _z.folge = _folge(_z.modus);
    _barRender();
  });
  bar.querySelector('[data-pak="auswertung"]').addEventListener('click', () => {
    _z.auswertung = !_z.auswertung;
    _barRender();
  });
}

// ── Auswertung: Beschlussreife und Neubau-Auslegung ─────────────────────────

function _auswertungHtml() {
  const b = _z.beschluss;
  const chip = k => `<span style="display:inline-block;min-width:16px;text-align:center;border-radius:8px;padding:0 5px;font-size:9.5px;font-weight:700;
    background:${KLASSE[k].col}26;color:${KLASSE[k].col};border:1px solid ${KLASSE[k].col};">${k === 'bestand' ? '▣' : k === 'pflicht' ? '§' : k}</span>`;
  const zeilen = b.liste.map(l => `
    <div style="display:flex;gap:7px;align-items:flex-start;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      ${chip(l.klasse)}
      <div style="min-width:0;flex:1;">
        <div style="font-size:10.5px;color:var(--text);"><b>${escHtml(l.anlage.name)}</b> · ${_fmt(l.anlage.kwp)} kWp
          <span style="color:var(--muted);">· Jahr ${l.anlage.jahr}${l.kumKwp != null ? ` · Σ ${_fmt(l.kumKwp)} kWp` : ''}</span></div>
        <div style="font-size:9.5px;color:var(--muted);">${escHtml(l.grund)}${l.massnahmen.length
          ? ` · <span style="color:#ffcc80">${l.massnahmen.map(m => `${escHtml(m.titel)} (≈ ${_fmtE(m.investEUR)})`).join(', ')}</span>` : ''}</div>
      </div>
    </div>`).join('');

  const karten = _z.auslegung.length ? _z.auslegung.map(x => {
    const col = URTEIL_COL[x.urteil];
    const richtung = x.richtung === 'rueck' ? `Rückspeisung ${_fmt(x.endeRueckKw)} kW` : `Bezug ${_fmt(x.endeBezugKw)} kW`;
    const vergleich = x.urteil === 'jetzt-groesser' || x.urteil === 'spaeter'
      ? `<div style="display:grid;grid-template-columns:auto auto;gap:1px 10px;font-size:9.5px;margin-top:3px;">
           <span style="color:var(--muted);">Mehrkosten jetzt</span><span style="font-family:'DM Mono',monospace;">${_fmtE(x.mehrJetztEUR)}</span>
           <span style="color:var(--muted);">Tausch ${x.jahrUeber}</span><span style="font-family:'DM Mono',monospace;">${_fmtE(x.spaeterEUR)}</span>
           <span style="color:var(--muted);">… als Barwert heute</span><span style="font-family:'DM Mono',monospace;">${_fmtE(x.barwertEUR)}</span>
           <span style="color:${col};">${x.urteil === 'jetzt-groesser' ? 'Vorteil jetzt größer' : 'Vorteil später'}</span><span style="font-family:'DM Mono',monospace;color:${col};">${_fmtE(x.vorteilEUR)}</span>
         </div>` : '';
    return `<div style="border:1px solid ${col};border-radius:6px;padding:5px 8px;margin-bottom:6px;background:${col}12;">
      <div style="font-size:10.5px;"><b>${escHtml(x.name)}</b> <span style="color:var(--muted);">· maßgeblich ${richtung} im Endausbau</span></div>
      <div style="font-size:10px;color:${col};font-weight:600;">${escHtml(x.text)}</div>${vergleich}
    </div>`;
  }).join('') : '<div style="font-size:10px;color:var(--muted);">Keine Neubau-Trafos — Trafos der Schicht „Entwicklung“ oder „Planung“ werden hier ausgelegt.</div>';

  const s = b.summe;
  return `
  <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px;margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
    <div>
      <div style="font-size:11px;font-weight:600;margin-bottom:4px;">Beschlussreife
        <span style="font-weight:400;color:var(--muted);font-size:9.5px;">· ${s.pflicht} Pflicht · ${s.A} A · ${s.B} B · ${s.C} C · Ertüchtigung ≈ ${_fmtE(s.investEUR)}</span></div>
      <div style="max-height:190px;overflow-y:auto;padding-right:4px;">${zeilen}</div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:600;margin-bottom:4px;">Auslegung Neubau-Trafos
        <span style="font-weight:400;color:var(--muted);font-size:9.5px;">· Endausbau, beide Richtungen</span></div>
      <div style="max-height:190px;overflow-y:auto;padding-right:4px;">${karten}</div>
    </div>
  </div>
  <div style="font-size:9px;color:var(--muted);margin-top:5px;line-height:1.45;">
    A = rechnet sich und passt in die heutige Reserve · B = rechnet sich auch mit der Ertüchtigung, die sie auslöst (Anlagen dahinter teilen sie sich) · C = zurückstellen.
    Nutzen je kWp aus dem Jahresüberschuss der PV-Analyse, Ertüchtigung als Annuität über 30 Jahre. Neubau: Tausch = neuer Trafo + 30 % für Montage/Umschluss, Jahr aus dem Ausbaupfad (Baujahre)${_z.jahrFallback ? `; ${_z.jahrFallback} Objekt${_z.jahrFallback > 1 ? 'e' : ''} ohne Baujahr im Zieljahr ${_z.ctx.endausbauJahr} angesetzt` : ''}.
  </div>`;
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
  const zaehler = { n: 0 };
  const anlagen = _anlagenSammeln(ctx, zaehler);
  if (!anlagen.length) {
    alert('Keine PV-Anlage mit Standort gefunden — PV-Assets oder Gebäude-PV auf der Karte anlegen.');
    return;
  }
  if (_z) pvAusbauKarteSchliessen();
  window.setViewMode?.('karte');

  const trafos = _trafosSammeln();
  const lasten = _lastenSammeln(ctx, zaehler);
  const nap = (ASSETS?.items || []).find(a => a.type === 'NAP' && Number.isFinite(a.lat)) || null;
  // Mit Trafo-Standorten wird je Trafo geprüft; die Summengrenze aus Abb. 6
  // gilt nur, wenn keine Trafos erfasst sind (Handeingabe dort).
  const trafoKva = trafos.length ? 0 : ctx.trafoKvaOverride;
  _pane();
  _z = {
    ctx, anlagen, trafos, nap, lasten,
    grenzen: bestandsGrenzen({ trafoKva, napKw: ctx.napKw, skKva: ctx.skKva, uBudgetPct: ctx.uBudgetPct }),
    modus: 'beschluss', folge: [],
    idx: 0, bat: 0, kurve: [], layer: L.layerGroup().addTo(map), timer: null, cache: new Map(), band: null,
    trafosBel: [], beschluss: null, auslegung: [], klasse: new Map(), auswertung: false, jahrFallback: zaehler.n,
  };
  _kurveRechnen();
  _auswerten();
  _z.folge = _folge(_z.modus);
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
    klassen: Object.fromEntries(_z.beschluss.liste.map(l => [l.anlage.name, l.klasse])),
    gruende: Object.fromEntries(_z.beschluss.liste.map(l => [l.anlage.name, l.grund])),
    auslegung: _z.auslegung.map(x => ({ name: x.name, urteil: x.urteil, empfKva: x.empfKva, jahrUeber: x.jahrUeber })),
    idx: _z.idx, n: _z.folge.length, kwp: st.kwp, rueckKw: st.rueck, stufe: st.stufe,
    trafos: [...st.trafos.values()].map(t => ({ name: t.name, quote: t.quote, stufe: t.stufe })),
    ersteUeberlastBeiKwp: kwpBeiRueck(_z.kurve, _z.grenzen[0]?.kapKw ?? Infinity),
  };
}

window.pvAusbauKarteOeffnen   = pvAusbauKarteOeffnen;
window.pvAusbauKarteSchliessen = pvAusbauKarteSchliessen;
