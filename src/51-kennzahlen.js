// ── 51-kennzahlen.js — Auswertung › Übersicht: Kennzahlen Wärme · Strom · übergreifend ──
//
// Sammelt fertige Rechenergebnisse der aktiven Variante ein und zeichnet je Sparte eine
// Kachelreihe in #analyse-kpi-bar. Die Kachellogik (Zustände, Sprungziele) steht in
// lib/kennzahlen-uebersicht.js. Gerechnet wird hier nichts.
//
// Aufruf über window.kzUebersichtRendern aus refreshAnalyseView (04a) — kein Import aus 04a,
// sonst wüchse der große Importzyklus (tests/import-architecture.test.js).
import { aktiverVariantenName, globalYear, pefStrom, stromEdges, stromEmF, gebaeude } from './01-globals-varianten.js';
import { isErzeugerAktiv, meritOrderKeys } from './06c-dispatch-core.js';
import { ASSETS } from './13a-assets-core.js';
import { uiSchrittStatus } from './49-oberflaeche.js';
import { eeAnteilPct, lastMwh } from './lib/dispatch-energie.js';
import { kzWaerme, kzStrom, kzGesamt, kzStandText, kzStromStand, KZ_SPRUNG } from './lib/kennzahlen-uebersicht.js';

const _STATIONEN = ['NAP', 'Trafo', 'NSHV', 'Schaltanlage'];
const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _zahl = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ── Einsammeln ──────────────────────────────────────────────────────────

function _waerme() {
  const ss = window.systemState;
  const den = window._dispatchEnergy || {};
  const hatEinsatz = lastMwh(den) > 0;
  return {
    mwh: _zahl(ss?.gesamtMwhMitNV || ss?.nutzwaermeMwh),
    pMaxKw: _zahl(ss?.pMaxKw),
    wgk: hatEinsatz ? _zahl(window._lastWgk) : null,
    co2T: hatEinsatz && typeof window.co2EinsatzAktuell === 'function' ? _zahl(window.co2EinsatzAktuell()) : null,
    eePct: hatEinsatz ? _zahl(eeAnteilPct(den)) : null,
    hatErzeuger: meritOrderKeys.some(k => isErzeugerAktiv(k)),
  };
}

function _bilanz() {
  const b = window._stromBilanz;
  return b && Number.isFinite(b.netzbezugMwh) ? b : null;
}

/** Netzergebnis aus den Stempeln der letzten sichtbaren Elektroberechnung (wie das Ergebnisblatt). */
function _elektro(stand) {
  const strom = ASSETS.items.filter(a => a.domain === 'strom' || a.domain === 'hybrid');
  const hatNetz = strom.some(a => _STATIONEN.includes(a.type)) || stromEdges.length > 0;
  const trafos = strom.filter(a => a.type === 'Trafo');
  const out = { stand, hatNetz, hatTrafo: trafos.length > 0, jahr: window._elErgebnisStand?.jahr ?? null, trafo: null, kabel: null, nKabel: 0 };
  if (stand === 'offen') return out;
  for (const a of trafos) {
    const pct = _zahl(a._calcPeakLoadPct);
    if (pct != null && (!out.trafo || pct > out.trafo.pct)) out.trafo = { name: a.name, pct };
  }
  const name = id => {
    const a = ASSETS.items.find(x => x.id === id);
    if (a) return a.name;
    const g = gebaeude.find(x => String(x.id) === String(id));
    return g ? (g.name || `Gebäude ${g.id}`) : '';
  };
  for (const e of stromEdges) {
    if (e._calcJahr == null) continue;
    out.nKabel++;
    const pct = _zahl(e.auslastungPct);
    if (pct == null || (out.kabel && pct <= out.kabel.pct)) continue;
    const von = name(e._calcPfad?.von ?? e.u), nach = name(e._calcPfad?.nach ?? e.v);
    out.kabel = { name: von && nach ? `${von} → ${nach}` : (von || nach), pct };
  }
  return out;
}

function _gesamt(b, w) {
  const pef = typeof window._calcPefData === 'function' ? window._calcPefData() : null;
  // Netzstrom der übrigen Verbraucher (Gebäude, Kälte): Bedarf minus PV/BHKW-Eigenstrom an diese Verbraucher
  const rest = b ? b.quartierMwh - (b.pvToQuartier || 0) - (b.bhkwToQuartier || 0) - (b.pvToKaelte || 0) - (b.bhkwToKaelte || 0) : null;
  return {
    peWaermeMwh: pef ? _zahl(pef.totalPE) : null,
    co2WaermeT: w.co2T,
    uebrigerNetzMwh: _zahl(rest),
    fpStrom: pefStrom, efStromGkWh: stromEmF,
    investEur: w.wgk != null ? _zahl(window._lastInvestGes) : null,
    jkEur: w.wgk != null ? _zahl(window._lastJkGes) : null,
    hatErzeuger: w.hatErzeuger,
  };
}

// ── Zeichnen ────────────────────────────────────────────────────────────

function _kachel(k) {
  const tip = k.tip ? ` <span class="htip" data-tip="${_esc(k.tip)}">?</span>` : '';
  const badge = k.zustand === 'veraltet' ? ' <em class="av-kpi-badge">veraltet</em>' : '';
  const wert = k.zustand === 'ok' || k.zustand === 'veraltet'
    ? `<div class="analyse-kpi-val"><span id="av-kpi-${k.id}">${_esc(k.wert)}</span>${k.einheit ? `<small>${_esc(k.einheit)}</small>` : ''}</div>`
    : `<div class="analyse-kpi-val is-text"><span id="av-kpi-${k.id}">${_esc(k.text)}</span></div>`;
  let balken = '';
  if (k.balken) {
    const ee = k.id === 'ee';
    const cls = ee ? (k.balken.pct >= (k.balken.ziel ?? 0) ? 'ok' : '') : k.balken.warn ? 'warn' : 'neutral';
    const ziel = k.balken.ziel != null ? `<b style="left:${k.balken.ziel}%" title="Ziel ${k.balken.ziel} %"></b>` : '';
    balken = `<div class="analyse-kpi-bar-mini"><i${ee ? ' id="av-kpi-ee-bar"' : ''} class="${cls}" style="width:${k.balken.pct}%"></i>${ziel}</div>`;
  }
  const sprung = k.sprung ? `<button type="button" class="av-kpi-sprung" data-click="${_esc(k.sprung.click)}">${_esc(k.sprung.label)}</button>` : '';
  const sub = k.sub || sprung ? `<div class="analyse-kpi-sub">${k.sub ? `<span>${_esc(k.sub)}</span>` : ''}${sprung}</div>` : '';
  return `<div class="analyse-kpi" data-zustand="${k.zustand}" style="--kpi-c:${k.farbe || 'var(--accent)'};">
    <div class="analyse-kpi-lbl">${_esc(k.titel)}${badge}${tip}</div>${wert}${balken}${sub}</div>`;
}

function _gruppe(id, titel, stand, kacheln, aktion = null) {
  const knopf = aktion ? `<button type="button" class="av-kpi-sprung" data-click="${_esc(aktion.click)}">${_esc(aktion.label)}</button>` : '';
  return `<section class="av-kpi-gruppe" data-gruppe="${id}">
    <div class="av-kpi-gruppe-kopf"><b>${titel}</b><span class="av-kpi-stand" data-stand="${stand}">${kzStandText(stand)}</span>${knopf}</div>
    <div class="analyse-kpi-bar">${kacheln.map(_kachel).join('')}</div></section>`;
}

/**
 * Kennzahlen neu zeichnen. abschnitt = aktiver Auswertungsabschnitt: nur die Übersicht zeigt
 * Strom und übergreifend; Wärme, Wirtschaftlichkeit und Emissionen behalten die Wärmereihe.
 */
export function kzUebersichtRendern(abschnitt = 'uebersicht') {
  const box = document.getElementById('analyse-kpi-bar');
  if (!box) return;
  const st = uiSchrittStatus().auswertung;
  const waermeStand = st.waerme || 'offen', stromStand = st.strom || 'offen';
  const w = _waerme();
  const b = _bilanz();
  const el = _elektro(stromStand);
  const sGruppe = kzStromStand(waermeStand, stromStand, !!b, el.hatNetz);
  const nurWaerme = abschnitt !== 'uebersicht';
  box.classList.toggle('nur-waerme', nurWaerme);
  box.innerHTML =
    `<div class="av-kpi-kopf"><span>Kennzahlen der Variante</span><b>${_esc(aktiverVariantenName())}</b><span>Betrachtungsjahr ${globalYear}</span></div>`
    + _gruppe('waerme', 'Wärme', waermeStand, kzWaerme({ waermeStand, waerme: w }))
    + (nurWaerme ? '' : _gruppe('strom', 'Strom', sGruppe, kzStrom({ waermeStand, bilanz: b, capKva: _zahl(window.elNapMaxBezugKw), el }),
      el.hatNetz && stromStand === 'veraltet' ? { label: 'Netz neu berechnen', click: KZ_SPRUNG.elRechnen.click } : null))
    + (nurWaerme ? '' : _gruppe('gesamt', 'Übergreifend', waermeStand, kzGesamt({ waermeStand, g: _gesamt(b, w) })));
}
