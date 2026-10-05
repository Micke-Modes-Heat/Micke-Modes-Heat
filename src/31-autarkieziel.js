// ── 31-autarkieziel.js — Autarkieziel mit Batterie und Wasserstoff ──────────
//
// Ansicht „Autarkieziel (Batterie + H₂)" der PV-Analyse. Frage: Welche Anlagen
// braucht es, damit in JEDER Stunde des Jahres mindestens z % der elektrischen
// Last aus eigener erneuerbarer Erzeugung oder aus Speichern kommen — und was
// kostet das am wenigsten? Freiheitsgrade: PV (bis zum Dachpotenzial), Batterie
// und die Wasserstoffkette Elektrolyseur → Drucktank → Brennstoffzelle.
// Rechenkern: lib/autarkie-h2-core.js.
//
// Eingangsdaten kommen aus der PV-Analyse (window.pvAutarkieEingang in 09d):
// Lastgang, PV-Profil, Wind-Sockel, NAP-Einspeisegrenze, Preise, PV-/Batteriekosten.
// Eigene Eingaben (Ziel, Toleranz, H₂-Annahmen) und die letzte Auslegung werden über
// pvCaptureState/pvRestoreState (09d) unter pvAnalyse.autarkieziel gespeichert.
// „Als Anlagen übernehmen" legt Batterie, H₂-Speicher und BHKW als Assets auf die Karte.
//
// Alternative zum Wasserstoff: ein BHKW mit biogenem Brennstoff (Biomethan, HVO,
// Pflanzenöl). Mit beiden Optionen rechnet das Tool drei Varianten (nur H₂, nur BHKW,
// Kombination) und zeigt sie nebeneinander. Eine Tank-Obergrenze (z. B. unter 3 t
// oder 5 t H₂ wegen BImSchG bzw. Störfall-Verordnung) wirkt als harte Grenze.

import {
  AH2_BRENNSTOFFE, AH2_MODI, AH2_STANDARD, H2_DICHTE_KG_M3, H2_KWH_PRO_KG, ah2BhkwGrenzkosten, ah2Mischen, ah2Nachweis,
  ah2Optimieren, ah2OhneH2, ah2Simulieren, ah2Zielkurve, ah2ZielKosten,
} from './lib/autarkie-h2-core.js';
import { escHtml } from './03c-gebaeude-io.js';
import { addStromEdge, recalcStromNetz } from './05b-stromnetz.js';
import { ASSETS, createAsset, getAssetStatus } from './13a-assets-core.js';
import { redrawAllAssets } from './13b-assets-render.js';

const ROOT_ID = 'pva-autarkieziel';
// Farben der Deckungsanteile (auf dem dunklen App-Hintergrund auf Farbfehlsichtigkeit geprüft)
// Stapelreihenfolge Direkt · Batterie · BHKW · Brennstoffzelle · Netz
const FARBE = { direkt: '#c98500', bat: '#199e70', bhkw: '#d95926', h2: '#3987e5', netz: '#e66767' };

const _standard = () => ({
  zielPct: AH2_STANDARD.zielPct, toleranzH: AH2_STANDARD.toleranzH,
  ely: {}, bz: {}, tank: {}, bat: {}, preise: {}, bhkw: {},   // nur Abweichungen vom Standard
  h2Aktiv: true, bhkwAktiv: false, bhkwBrennstoff: AH2_STANDARD.bhkwBrennstoff,
  tankMaxKg: 0,                                      // Obergrenze H₂-Tank in kg, 0 = unbegrenzt
  letzte: null,                                      // letzte Auslegung (Größen), zum Wiederherstellen
  basisLetzte: null,                                 // günstigste Auslegung ohne Ziel (Vergleich „Was kostet das Ziel?")
  variantenLetzte: null,                             // Größen je Variante (h2/bhkw/kombi/pvbat)
  manuell: null,                                     // eigene Einstellung der Schieber (sonst Optimum)
});
let _st = _standard();
let _erg = null;          // { best (angezeigt), opt (Optimum der Variante), varianten, basis, ohne, cfg, dauerMs, info, grund? }
let _man = null;          // eigene Einstellung der Schieber {pvKwp,batKwh,batReserve,elyKw,tankKg,bzKw,bhkwKw} oder null
let _tab = 'auslegung';   // aktiver Reiter
let _schieberTimer = null;
let _kurve = null;        // Zielkurve
let _veraltet = false;
let _meldung = '';
let _annahmenAuf = false;
let _hm = { metrik: 'netz', anteil: false };   // Heatmap-Auswahl

const _fmt = (x, d = 0) => (x == null || !Number.isFinite(x)) ? '—'
  : x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const _tEur = x => _fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1) + ' T€';
const _mwh = kwh => kwh >= 10000 ? _fmt(kwh / 1000, 0) + ' MWh' : _fmt(kwh, 0) + ' kWh';
const b = t => `<b style="color:var(--text);">${t}</b>`;

// ══════════════════════════════════════════════════════════════════════════════
// EINGABEN
// ══════════════════════════════════════════════════════════════════════════════

/** Editierbare Annahmen: [Gruppe, Schlüssel, Bezeichnung, Einheit, Anzeigefaktor, Nachkommastellen] */
const ANNAHMEN = [
  ['ely', 'eta', 'Elektrolyseur: Wirkungsgrad inkl. Verdichtung (Hu)', '%', 100, 0],
  ['ely', 'investKw', 'Elektrolyseur: Invest', '€/kW', 1, 0],
  ['ely', 'life', 'Elektrolyseur: Nutzungsdauer', 'a', 1, 0],
  ['ely', 'ih', 'Elektrolyseur: Instandhaltung', '%/a', 100, 1],
  ['ely', 'abwaerme', 'Elektrolyseur: nutzbare Abwärme', '% der el. Aufnahme', 100, 0],
  ['bz', 'eta', 'Brennstoffzelle: el. Wirkungsgrad (Hu)', '%', 100, 0],
  ['bz', 'investKw', 'Brennstoffzelle: Invest', '€/kW', 1, 0],
  ['bz', 'life', 'Brennstoffzelle: Nutzungsdauer', 'a', 1, 0],
  ['bz', 'ih', 'Brennstoffzelle: Instandhaltung', '%/a', 100, 1],
  ['bz', 'abwaerme', 'Brennstoffzelle: nutzbare Abwärme', '% des H₂-Einsatzes', 100, 0],
  ['tank', 'investKwh', 'H₂-Drucktank: Invest', '€/kWh H₂', 1, 1],
  ['tank', 'life', 'H₂-Drucktank: Nutzungsdauer', 'a', 1, 0],
  ['tank', 'ih', 'H₂-Drucktank: Instandhaltung', '%/a', 100, 1],
  ['bat', 'eta', 'Batterie: Wirkungsgrad je Lade-/Entladevorgang', '%', 100, 0],
  ['bat', 'cRate', 'Batterie: Leistung je kWh Kapazität', 'kW/kWh', 1, 2],
  ['bhkw', 'brennstoffCt', 'BHKW: Brennstoffpreis (Hu)', 'ct/kWh', 1, 1],
  ['bhkw', 'etaEl', 'BHKW: el. Wirkungsgrad', '%', 100, 0],
  ['bhkw', 'etaTh', 'BHKW: th. Wirkungsgrad (nutzbare Wärme)', '%', 100, 0],
  ['bhkw', 'investKw', 'BHKW: Invest', '€/kW el.', 1, 0],
  ['bhkw', 'life', 'BHKW: Nutzungsdauer', 'a', 1, 0],
  ['bhkw', 'wartungCt', 'BHKW: Wartung', 'ct/kWh el.', 1, 1],
  ['preise', 'pWaerme', 'Abwärme: angerechneter Wert (0 = nicht anrechnen)', 'ct/kWh', 1, 1],
];

/** Standardwert einer Annahme — beim BHKW gelten Preis und Wirkungsgrade des gewählten Brennstoffs */
function _standardWert(g, k) {
  if (g === 'bhkw' && ['brennstoffCt', 'etaEl', 'etaTh'].includes(k)) return AH2_BRENNSTOFFE[_st.bhkwBrennstoff]?.[k] ?? AH2_STANDARD.bhkw[k];
  return AH2_STANDARD[g][k];
}

/** Einstellungen für den Rechenkern: Wirtschaft aus der PV-Analyse, H₂-Annahmen aus der Ansicht. */
function _einst(ein) {
  const w = ein.wirtschaft;
  return {
    zielPct: _st.zielPct, toleranzH: _st.toleranzH, zins: w.zins,
    pv: { investKwp: w.pvInvestKwp, life: w.pvLife },
    bat: { investKwh: w.batInvestKwh, life: w.batLife, ..._st.bat },
    ely: { ..._st.ely }, bz: { ..._st.bz }, tank: { ..._st.tank }, bhkw: { ..._st.bhkw },
    preise: { pStrom: w.pStrom, pEinsp: w.pEinsp, ..._st.preise },
    h2Aktiv: _st.h2Aktiv, bhkwAktiv: _st.bhkwAktiv, bhkwBrennstoff: _st.bhkwBrennstoff, tankMaxKg: _st.tankMaxKg,
  };
}

function _eingang() {
  const ein = window.pvAutarkieEingang?.();
  if (!ein) return null;
  return {
    ein,
    inp: { last: ein.last, pvKwProKwp: ein.pvKwProKwp, windKw: ein.windKw, pvMaxKwp: ein.pvMaxKwp,
           napEinspKw: ein.napEinspKw, infraJk: ein.infraJk },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// RECHNEN
// ══════════════════════════════════════════════════════════════════════════════

export function ah2Rechnen() {
  const e = _eingang();
  if (!e) { _erg = { grund: 'Kein Stromlastgang — bitte in ⚡ Strom-Grundlagen hochladen.' }; return; }
  const t0 = performance.now();
  const einst = _einst(e.ein);
  const r = ah2Optimieren(e.inp, einst);
  if (!r.machbar) {
    _erg = { grund: r.grund, cfg: r.cfg, info: e.ein };
    _st.letzte = null;
  } else {
    // Vergleich: günstigste Auslegung OHNE Ziel — die Differenz ist der Preis des Ziels
    const r0 = _st.zielPct > 0 ? ah2Optimieren(e.inp, { ...einst, zielPct: 0 }) : r;
    _man = null; _st.manuell = null;
    _erg = { best: r.best, opt: r.best, varianten: r.varianten, basis: r0.machbar ? r0.best : null, ohne: ah2OhneH2(e.inp, r.best.ausl, einst),
             cfg: r.cfg, info: e.ein, inp: e.inp, einst,
             dauerMs: performance.now() - t0, ausgewertet: r.ausgewertet + (r0 !== r ? r0.ausgewertet : 0) };
    _st.letzte = _groessen(r.best.ausl);
    _st.basisLetzte = _erg.basis ? _groessen(_erg.basis.ausl) : null;
    _st.variantenLetzte = Object.fromEntries(Object.entries(r.varianten).map(([m, v]) => [m, _groessen(v.ausl)]));
  }
  _veraltet = false;
}

const _groessen = a => ({ pvKwp: a.pvKwp, batKwh: a.batKwh, batReserve: a.batReserve, elyKw: a.elyKw, bzKw: a.bzKw, tankKwh: a.tankKwh,
  bhkwKw: a.bhkwKw || 0, bhkwZuerst: !!a.bhkwZuerst, modus: a.modus });

/** Eine andere Variante anzeigen (Vergleichstabelle) */
function _varianteZeigen(modus) {
  const v = _erg?.varianten?.[modus];
  if (!v) return;
  _erg.best = v; _erg.opt = v;
  _man = null; _st.manuell = null;
  if (_erg.inp) _erg.ohne = ah2OhneH2(_erg.inp, v.ausl, _erg.einst);
  _st.letzte = _groessen(v.ausl);
}

/** Gespeicherte Auslegung nach dem Laden ohne neue Optimierung nachrechnen (für die Diagramme). */
function _wiederherstellen() {
  if (_erg || !_st.letzte) return;
  const e = _eingang();
  if (!e) return;
  const einst = _einst(e.ein);
  const cfg = ah2Mischen(einst);
  const best = ah2Simulieren(e.inp, _st.letzte, cfg);
  const basis = _st.basisLetzte ? ah2Simulieren(e.inp, _st.basisLetzte, { ...einst, zielPct: 0 }) : null;
  const varianten = {};
  for (const [m, g] of Object.entries(_st.variantenLetzte || {})) {
    varianten[m] = m === best.modus ? best : ah2Simulieren(e.inp, g, cfg);
  }
  if (!varianten[best.modus]) varianten[best.modus] = best;
  _erg = { best, opt: best, varianten, basis, ohne: ah2OhneH2(e.inp, _st.letzte, einst), cfg, info: e.ein, inp: e.inp, einst, gespeichert: true };
  if (_st.manuell) { _man = { ..._st.manuell }; _manuellRechnen(); }
}

function _kurveRechnen() {
  const e = _eingang();
  if (!e) return;
  _kurve = { punkte: ah2Zielkurve(e.inp, _einst(e.ein), [0, 10, 20, 30, 40, 50, 60, 70, 80]), toleranzH: _st.toleranzH };
}

// ══════════════════════════════════════════════════════════════════════════════
// DARSTELLUNG
// ══════════════════════════════════════════════════════════════════════════════

const _kn = (akt, txt, tip = '', betont = false, extra = '') =>
  `<button class="${betont ? 'btn-confirm' : 'ah2-knopf'}" data-ah2-aktion="${akt}" title="${escHtml(tip)}" ${extra}>${txt}</button>`;

function _cssEinmal() {
  if (document.getElementById('ah2-css')) return;
  const st = document.createElement('style');
  st.id = 'ah2-css';
  st.textContent = `
  #${ROOT_ID} .ah2-knopf{font-size:10.5px;padding:3px 9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;}
  #${ROOT_ID} .ah2-karte{background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:9px 12px;margin-bottom:10px;}
  #${ROOT_ID} table{border-collapse:collapse;width:100%;font-size:10.5px;}
  #${ROOT_ID} th{font-weight:500;color:var(--muted);text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);white-space:nowrap;}
  #${ROOT_ID} th.l,#${ROOT_ID} td.l{text-align:left;}
  #${ROOT_ID} td{padding:3px 6px;text-align:right;border-bottom:1px solid rgba(128,128,128,.12);white-space:nowrap;}
  #${ROOT_ID} td.m{font-family:'DM Mono',monospace;}
  #${ROOT_ID} .ah2-in{width:100%;padding:4px 6px;font-size:11px;box-sizing:border-box;}
  #${ROOT_ID} .ah2-lbl{display:block;color:var(--muted);font-size:10px;margin-bottom:3px;}
  #${ROOT_ID} .ah2-kpi{flex:1 1 120px;background:var(--surface2);border-radius:6px;padding:7px 10px;}
  #${ROOT_ID} .ah2-kpi .w{font-family:'DM Mono',monospace;font-size:15px;color:var(--text);}
  #${ROOT_ID} .ah2-kpi .t{font-size:9.5px;color:var(--muted);margin-top:1px;}
  #${ROOT_ID} .ah2-leg{display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:10px;color:var(--muted);}
  #${ROOT_ID} .ah2-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;}
  #ah2-inhalt .ah2-karte{border:none;background:transparent;padding:0;margin:0 0 8px;}
  #ah2-inhalt .ah2-karte > b:first-child, #ah2-inhalt .ah2-karte > b:first-child + span{display:none;}
  #ah2-inhalt table{font-size:11px;}
  #ah2-inhalt .ah2-leg{font-size:11px;}`;
  document.head.appendChild(st);
}

export function ah2Render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  _cssEinmal();
  try { _wiederherstellen(); } catch (err) { console.warn('[Autarkieziel] Wiederherstellen fehlgeschlagen:', err); }
  root.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
    <div style="font-size:12px;font-weight:600;">Autarkieziel — Mindestdeckung in jeder Stunde mit Batterie, Wasserstoff oder BHKW</div>
    <div style="font-size:10px;color:var(--muted);">Stündlich über 8.760 h · Daten wie die PV-Auslegungen</div>
  </div>
  <div style="font-size:10.5px;color:var(--muted);line-height:1.5;margin-bottom:10px;">
    In <b>jeder</b> Stunde des Jahres soll mindestens der Zielanteil der elektrischen Last aus eigener Erzeugung oder aus Speichern kommen.
    Das Tool sucht die Kombination aus PV (bis zum Dachpotenzial), Batterie und Wasserstoffkette
    (<b>Elektrolyseur → Drucktank → Brennstoffzelle</b>) mit den geringsten Jahreskosten.
    Die Batterie übernimmt den Tag-Nacht-Ausgleich, der Wasserstoff trägt Dunkelflauten und den Winter.
    Alternativ oder ergänzend deckt ein <b>BHKW mit biogenem Brennstoff</b> die Winterlücke — mit beiden Optionen vergleicht das Tool alle Varianten.</div>

  <div class="ah2-karte" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">
    <div style="flex:0 1 120px;"><span class="ah2-lbl" title="Mindestanteil der Last, der in jeder Stunde aus eigener Erzeugung oder Speicher kommen muss">Ziel: Mindestdeckung je Stunde</span>
      <div style="display:flex;align-items:center;gap:4px;"><input class="ah2-in" data-ah2-feld="zielPct" type="number" min="0" max="100" step="5" value="${_st.zielPct}"><span style="font-size:11px;">%</span></div></div>
    <div style="flex:0 1 150px;"><span class="ah2-lbl" title="So viele der schlechtesten Stunden im Jahr dürfen unter dem Ziel liegen. 0 = streng jede Stunde. Schon wenige Stunden verkleinern die Brennstoffzelle deutlich.">Zulässige Stunden unter Ziel</span>
      <div style="display:flex;align-items:center;gap:4px;"><input class="ah2-in" data-ah2-feld="toleranzH" type="number" min="0" step="1" value="${_st.toleranzH}"><span style="font-size:11px;">h/a</span></div></div>
    <div style="flex:0 1 auto;display:flex;flex-direction:column;gap:4px;">
      <span class="ah2-lbl">Wintertechnik</span>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;">
        <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" data-ah2-schalter="h2Aktiv" ${_st.h2Aktiv ? 'checked' : ''}>
          <i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${FARBE.h2};"></i>Wasserstoff</label>
        <label style="display:flex;align-items:center;gap:4px;" title="BHKW mit biogenem Brennstoff als Alternative oder Ergänzung zum Wasserstoff">
          <input type="checkbox" data-ah2-schalter="bhkwAktiv" ${_st.bhkwAktiv ? 'checked' : ''}>
          <i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${FARBE.bhkw};"></i>BHKW</label>
        <select data-ah2-brennstoff style="font-size:10.5px;padding:2px 4px;" ${_st.bhkwAktiv ? '' : 'disabled'}>${Object.entries(AH2_BRENNSTOFFE).map(([k, v]) =>
          `<option value="${k}" ${k === _st.bhkwBrennstoff ? 'selected' : ''}>${escHtml(v.label)}</option>`).join('')}</select>
      </div></div>
    <div style="flex:0 1 250px;"><span class="ah2-lbl" title="Harte Obergrenze für den Tankinhalt. Unter 3.000 kg: keine BImSchG-Genehmigung für das Lager; unter 5.000 kg: nicht Störfall-Verordnung (andere Gefahrstoffe am Standort zählen mit). Leer = unbegrenzt.">H₂-Tank höchstens</span>
      <div style="display:flex;align-items:center;gap:4px;">
        <input class="ah2-in" data-ah2-feld="tankMaxKg" type="number" min="0" step="100" value="${_st.tankMaxKg > 0 ? _st.tankMaxKg : ''}" placeholder="unbegrenzt" ${_st.h2Aktiv ? '' : 'disabled'}>
        <span style="font-size:11px;">kg</span>
        <button class="ah2-knopf" style="white-space:nowrap;" data-ah2-grenze="2990" title="knapp unter 3 t: ohne BImSchG-Genehmigung für das Lager">&lt; 3 t</button>
        <button class="ah2-knopf" style="white-space:nowrap;" data-ah2-grenze="4990" title="knapp unter 5 t: unter der Störfall-Schwelle">&lt; 5 t</button>
      </div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${_kn('rechnen', _erg?.best ? '↻ Neu auslegen' : '▶ Auslegen', 'Kostenoptimale Auslegung für das Ziel suchen', true, 'style="padding:6px 14px;font-size:11px;"')}
      ${_kn('annahmen', _annahmenAuf ? '▾ Annahmen' : '▸ Annahmen', 'Wirkungsgrade und Kosten von Speichern und BHKW')}
    </div>
    <div style="flex-basis:100%;font-size:10px;color:var(--muted);line-height:1.5;">${_datenbasisHtml()}</div>
  </div>
  ${_annahmenAuf ? _annahmenHtml() : ''}
  ${_veraltet ? '<div style="margin:-4px 0 10px;font-size:10.5px;color:#ffb74d;">Eingaben geändert — neu auslegen.</div>' : ''}
  ${_meldung ? `<div style="margin:-4px 0 10px;font-size:10.5px;color:#80cbc4;">${escHtml(_meldung)}</div>` : ''}
  <div style="${_veraltet ? 'opacity:.55;' : ''}">${_ergebnisHtml()}</div>`;
  if (!root.dataset.ah2Ereignisse) { root.dataset.ah2Ereignisse = '1'; _ereignisse(root); }
  _heatmapZeichnen();
}

function _datenbasisHtml() {
  const ein = _erg?.info || window.pvAutarkieEingang?.();
  if (!ein) return '<span style="color:#ffb74d;">Kein Stromlastgang vorhanden — bitte in ⚡ Strom-Grundlagen hochladen.</span>';
  let s = 0, max = 0;
  for (let i = 0; i < ein.last.length; i++) { s += ein.last[i]; if (ein.last[i] > max) max = ein.last[i]; }
  const modus = { basis: 'nur Strom', gesamt: 'Strom + WP + Stromkessel', endausbau: 'Endausbau' }[ein.lastModus] || ein.lastModus;
  const w = ein.wirtschaft;
  return `Datenbasis: Lastgang ${b(_fmt(s / 1000) + ' MWh/a')} (${modus}, Spitze ${_fmt(max)} kW) ·
    PV-Potenzial ${b(_fmt(ein.pvMaxKwp) + ' kWp')} (${_fmt(ein.spez)} kWh/kWp, ${escHtml(ein.profilQuelle)})
    ${ein.windKw ? ` · Wind ${_fmt(ein.windKwInstalliert)} kW als fester Sockel` : ''}
    · NAP-Einspeisung ${ein.napEinspKw != null ? _fmt(ein.napEinspKw) + ' kW' : 'unbegrenzt'}
    · Strom ${_fmt(w.pStrom, 1)} ct/kWh, Einspeisung ${_fmt(w.pEinsp, 1)} ct/kWh, Zins ${_fmt(w.zins * 100, 1)} %,
    PV ${_fmt(w.pvInvestKwp)} €/kWp, Batterie ${_fmt(w.batInvestKwh)} €/kWh — aus den Feldern der PV-Analyse.`;
}

function _annahmenHtml() {
  const cfg = ah2Mischen({ ely: _st.ely, bz: _st.bz, tank: _st.tank, bat: _st.bat, preise: _st.preise, bhkw: _st.bhkw,
    bhkwBrennstoff: _st.bhkwBrennstoff });
  const zeilen = ANNAHMEN.map(([g, k, label, einh, f, d]) => {
    const std = _standardWert(g, k);
    const abw = _st[g][k] != null && _st[g][k] !== std;
    return `<tr><td class="l">${label}</td>
      <td><input data-ah2-annahme="${g}.${k}" type="number" step="any" min="0" value="${+(cfg[g][k] * f).toFixed(d + 2)}"
        style="width:80px;font-size:10.5px;text-align:right;${abw ? 'color:#ffb74d;' : ''}"></td>
      <td class="l" style="color:var(--muted);">${einh}</td>
      <td class="l" style="color:var(--muted);">${abw ? `Standard ${_fmt(std * f, d)}` : ''}</td></tr>`;
  }).join('');
  const druck = cfg.tank.druckBar;
  return `<div class="ah2-karte">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
      <b style="font-size:11px;">Annahmen Speicher und BHKW (im Projekt gespeichert)</b>
      ${_kn('annahmen-standard', 'Standardwerte', 'Alle Abweichungen zurücksetzen')}</div>
    <table><thead><tr><th class="l">Größe</th><th>Wert</th><th class="l"></th><th class="l"></th></tr></thead><tbody>${zeilen}
      <tr><td class="l">H₂-Drucktank: Speicherdruck (nur für das Volumen)</td>
        <td><select data-ah2-annahme="tank.druckBar" style="font-size:10.5px;">${Object.keys(H2_DICHTE_KG_M3).map(p =>
          `<option value="${p}" ${+p === druck ? 'selected' : ''}>${p} bar</option>`).join('')}</select></td>
        <td class="l" style="color:var(--muted);">${_fmt(H2_DICHTE_KG_M3[druck], 1)} kg/m³</td><td></td></tr></tbody></table>
    <div style="font-size:10px;color:var(--muted);margin-top:4px;line-height:1.5;">Richtwerte kleiner bis mittlerer Anlagen (PEM), Stand 2025/26.
      Rundlauf Strom → H₂ → Strom = Wirkungsgrad Elektrolyseur × Brennstoffzelle (Standard 60 % × 50 % = 30 %).
      Wasserstoff-Energie bezieht sich auf den Heizwert Hu (33,33 kWh/kg). Orange = vom Standard abweichend.
      BHKW: Brennstoffpreis, Wirkungsgrade folgen dem gewählten Brennstoff (${escHtml(AH2_BRENNSTOFFE[_st.bhkwBrennstoff]?.label || '')}); Wärme zählt nur mit einem Abwärme-Wert.
      PV- und Batteriekosten, Preise und Zins kommen aus den Feldern der PV-Analyse.</div></div>`;
}

/** Ist die angezeigte Variante die günstigste? */
function _istGuenstigste() {
  const V = Object.values(_erg.varianten || {});
  return !V.length || V.every(v => _erg.best.kosten.gesamt <= v.kosten.gesamt + 1e-6);
}

// ── Ergebnis: Kopf · Schieber · Reiter ────────────────────────────────────────

/** Reiter: je eine Grafik mit Lesehilfe */
const TABS = [
  { id: 'auslegung', label: 'Auslegung' },
  { id: 'monate', label: 'Monatsbilanz' },
  { id: 'tank', label: 'H₂-Tank' },
  { id: 'dauer', label: 'Deckung je Stunde' },
  { id: 'raster', label: 'Jahresraster' },
  { id: 'varianten', label: 'Varianten' },
  { id: 'preis', label: 'Was kostet das Ziel?' },
  { id: 'kosten', label: 'Kosten' },
  { id: 'zielkurve', label: 'Zielkurve' },
  { id: 'hinweise', label: 'Hinweise' },
];

/** Nutzbare Breite für Grafiken (sie passen sich der Ansicht an statt fest 760 px) */
function _breite() {
  const el = document.getElementById('ah2-inhalt') || document.getElementById(ROOT_ID);
  const w = (el?.clientWidth || 900) - 30;
  return Math.max(560, Math.min(1500, w));
}

const _TAGE_NAMEN = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** Stunde des Jahres → „Mi. 22.01., 6–7 Uhr" */
function _zeit(t) {
  const d = new Date(2025, 0, 1 + Math.floor(t / 24));
  const h = t % 24;
  return `${_TAGE_NAMEN[d.getDay()]}. ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${h}–${h + 1} Uhr`;
}
const _datum = t => new Date(2025, 0, 1 + Math.floor(t / 24)).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });

const _RESERVE_TXT = { 0: 'deckt die ganze Last', 0.5: 'deckt die ganze Last bis zur halben Ladung, darunter nur noch das Ziel', 1: 'arbeitet nur für das Ziel' };

function _ergebnisHtml() {
  if (!_erg) return `<div style="color:var(--muted);font-size:11px;text-align:center;padding:30px 0;">Ziel eingeben und „Auslegen" starten.</div>`;
  if (!_erg.best) return `<div class="ah2-karte" style="border-left:3px solid #ffb74d;font-size:11px;line-height:1.5;">
    <b>Ziel nicht erreichbar.</b> ${escHtml(_erg.grund || '')}
    <div style="font-size:10px;color:var(--muted);margin-top:4px;">Hebel: Ziel senken, zulässige Stunden erhöhen, BHKW zulassen, Tank-Obergrenze anheben, mehr PV-Fläche (Dachpotenzial / Freifläche) oder Wind einbeziehen.</div></div>`;
  return `<div id="ah2-kopf">${_kopfHtml()}</div>
  ${_schieberHtml()}
  <div id="ah2-tabs" style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--border);margin-bottom:0;">${_tabsLeisteHtml()}</div>
  <div id="ah2-inhalt" class="ah2-karte" style="border-top:none;border-radius:0 0 7px 7px;padding:14px 16px;">${_tabInhaltHtml()}</div>`;
}

function _tabsLeisteHtml() {
  const n = _hinweise().length;
  return TABS.map(t => {
    const an = t.id === _tab;
    const label = t.id === 'hinweise' && n ? `${t.label} (${n})` : t.label;
    return `<button data-ah2-tab="${t.id}" style="font-size:11px;padding:6px 12px;cursor:pointer;border:1px solid ${an ? 'var(--border)' : 'transparent'};
      border-bottom:${an ? '1px solid var(--surface)' : 'none'};margin-bottom:-1px;border-radius:6px 6px 0 0;
      background:${an ? 'var(--surface)' : 'transparent'};color:${an ? 'var(--text)' : 'var(--muted)'};font-weight:${an ? 600 : 400};">${label}</button>`;
  }).join('');
}

/** Lesehilfe über jeder Grafik */
const _lesehilfe = (titel, text) => `<div style="margin-bottom:10px;">
  <div style="font-size:12.5px;font-weight:600;margin-bottom:3px;">${titel}</div>
  <div style="font-size:11px;color:var(--muted);line-height:1.55;max-width:980px;">${text}</div></div>`;

function _tabInhaltHtml() {
  const r = _erg.best, a = r.ausl;
  switch (_tab) {
    case 'monate': return _lesehilfe('Deckung der Last je Monat',
      'Jeder Balken ist der Stromverbrauch eines Monats, aufgeteilt nach Herkunft: direkt aus PV/Wind, aus der Batterie, aus BHKW oder Brennstoffzelle, Rest aus dem Netz. '
      + 'Der weiße Strich ist die Menge, die das Ziel in diesem Monat mindestens verlangt. Im Sommer liegt die Eigendeckung weit darüber — die Wintermonate entscheiden die Auslegung. '
      + 'Maus über einen Balken zeigt die Zahlen.') + _monateSvg();
    case 'tank': return _lesehilfe('Füllstand des Wasserstofftanks über das Jahr',
      'Tagesendwert des Tankinhalts im eingeschwungenen Betrieb (der Jahresanfang ist so gewählt, dass das Jahr zyklisch aufgeht). '
      + 'Im Sommer füllt der Elektrolyseur den Tank mit Überschussstrom, im Winter leert ihn die Brennstoffzelle. '
      + 'Die Kapazität ist genau so groß, dass der Tank an seinem tiefsten Punkt gerade leer wird — jede kWh mehr wäre ungenutzt.')
      + (a.tankKwh > 0 ? _tankSvg() : `<div style="font-size:11px;color:var(--muted);padding:12px 0;">${a.bhkwKw > 0
        ? 'Diese Variante kommt ohne Wasserstoff aus — das BHKW deckt die Winterlücke.' : 'Kein Wasserstoff nötig — PV und Batterie erfüllen das Ziel allein.'}</div>`);
    case 'dauer': return _lesehilfe('Eigene Deckung je Stunde, sortiert',
      'Alle 8.760 Stunden des Jahres nach ihrer eigenen Deckung sortiert — links die schlechteste Stunde, rechts die beste. '
      + 'Die grüne Linie zeigt PV und Batterie allein, die blaue mit Wasserstoff bzw. BHKW. Wo die grüne Linie unter der gestrichelten Ziellinie liegt, '
      + 'springt die Wintertechnik ein und hebt die Deckung genau auf das Ziel. Die Breite dieses Bereichs zeigt, wie viele Stunden im Jahr sie gebraucht wird.') + _dauerlinieSvg();
    case 'raster': return _heatmapHtml();
    case 'varianten': return _lesehilfe('Varianten im Vergleich',
      'Jede zugelassene Wintertechnik wird für sich kostenoptimal ausgelegt — mit eigener PV- und Batteriegröße. ★ markiert die günstigste. '
      + '„anzeigen" übernimmt eine Variante in alle Reiter und setzt die Schieber auf ihre Werte.') + (_variantenHtml() || '<div style="font-size:11px;color:var(--muted);">Nur eine Variante berechnet — für einen Vergleich Wasserstoff und BHKW zulassen.</div>');
    case 'preis': return _lesehilfe('Was kostet das Ziel?',
      'Vergleich der eingestellten Auslegung mit der günstigsten Auslegung ohne Ziel (gleiche Preise, PV und Batterie frei gewählt). Die Differenz der Jahreskosten ist der Preis des Ziels. '
      + 'Die Balken zeigen, aus welchen Posten er sich zusammensetzt; die Kennzahlen setzen ihn ins Verhältnis zur Energie aus der Wintertechnik und zur gesicherten Leistung.')
      + (_zielKostenHtml() || '<div style="font-size:11px;color:var(--muted);">Bei Ziel 0 % gibt es keinen Preis des Ziels.</div>');
    case 'kosten': return _lesehilfe('Kosten der Auslegung',
      'Alle Posten der eingestellten Auslegung: Investition, Jahreskosten (Annuität + Instandhaltung), Brennstoff, Netzbezug und Erlöse. '
      + 'Die Summe ist die Größe, die die Optimierung minimiert.') + _kostenHtml();
    case 'zielkurve': return _lesehilfe('Zielkurve: Kosten je Zielwert',
      'Die Auslegung wird für 0–80 % Mindestdeckung wiederholt (gröberes Raster, einige Sekunden). Die Kurve zeigt, ab welchem Ziel es teurer wird als reiner Netzbezug '
      + 'und wie schnell der Preis des Ziels wächst — oft steigt er ab einem bestimmten Wert sprunghaft, weil dann saisonale Speicherung nötig wird.')
      + `<div style="margin-bottom:10px;">${_kn('kurve', _kurve ? '↻ Zielkurve neu rechnen' : '📈 Zielkurve rechnen', 'Kosten und Anlagen für 0–80 % Mindestdeckung vergleichen')}</div>`
      + (_kurve ? _kurveHtml() : '');
    case 'hinweise': return _hinweiseHtml();
    default: return _auslegungHtml();
  }
}

// ── Kopf: Kernaussage + Kennzahlen ───────────────────────────────────────────

function _kopfHtml() {
  const r = _erg.best, a = r.ausl, bil = r.bilanz, k = r.kosten, opt = _erg.opt;
  const kpi = (w, t, farbe = '') => `<div class="ah2-kpi"><div class="w" ${farbe ? `style="color:${farbe};"` : ''}>${w}</div><div class="t">${t}</div></div>`;
  const anlagen = [
    `PV ${b(_fmt(a.pvKwp) + ' kWp')}`,
    `Batterie ${b(_fmt(a.batKwh) + ' kWh')}`,
    a.bzKw > 0 && `Elektrolyseur ${b(_fmt(a.elyKw) + ' kW')} · Tank ${b(_fmt(a.tankKg) + ' kg H₂')} · Brennstoffzelle ${b(_fmt(a.bzKw) + ' kW')}`,
    a.bhkwKw > 0 && `BHKW ${b(_fmt(a.bhkwKw) + ' kW')}`,
  ].filter(Boolean).join(' · ');
  const erfuellt = bil.stundenUnter <= r.toleranzH;
  let status;
  if (!_man) {
    status = `<span style="color:#66bb6a;">● Optimum</span> <span style="color:var(--muted);">— ${_istGuenstigste() ? 'günstigste Auslegung' : 'gewählte Variante'} „${escHtml(AH2_MODI[r.modus] || r.modus)}"</span>`;
  } else {
    const d = k.gesamt - opt.kosten.gesamt;
    const lage = !erfuellt ? (d < 0 ? ' — günstiger, weil das Ziel nicht mehr erfüllt ist' : ' — und das Ziel ist nicht erfüllt')
      : d > 0.5 ? ' — Ziel erfüllt, aber teurer als nötig' : '';
    status = `<span style="color:#ffb74d;">● Eigene Einstellung</span> <span style="color:var(--muted);">— ${d >= 0 ? '+' : ''}${_fmt(d)} €/a gegenüber dem Optimum${lage}</span>
      <button class="ah2-knopf" data-ah2-aktion="optimum" style="margin-left:6px;">↺ Optimum</button>`;
  }
  const n = _hinweise().length;
  return `<div class="ah2-karte" style="border-left:3px solid ${erfuellt ? 'var(--accent)' : '#e57373'};">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div style="font-size:11.5px;">${status}</div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${n ? `<button class="ah2-knopf" data-ah2-tab="hinweise" title="Genehmigung, Brennstoff, Grenzen">⚠ ${n} Hinweise</button>` : ''}
        ${_kn('uebernehmen', '⚡ Als Anlagen übernehmen', 'Die eingestellten Anlagen als Assets auf die Karte legen bzw. frühere anpassen', false,
          a.batKwh <= 0 && a.bzKw <= 0 && !(a.bhkwKw > 0) ? 'disabled' : '')}</div></div>
    <div style="font-size:12px;line-height:1.6;margin-top:4px;">${anlagen}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
      ${kpi(erfuellt ? '✓ erfüllt' : `✗ ${_fmt(bil.stundenUnter)} h`, erfuellt ? `Ziel ${_fmt(r.zielPct)} % in jeder Stunde${r.toleranzH ? ` (bis auf ${r.toleranzH} h)` : ''}` : `Stunden unter ${_fmt(r.zielPct)} % (${_fmt(bil.ungedecktMwh, 1)} MWh fehlen)`, erfuellt ? '#66bb6a' : '#e57373')}
      ${kpi(_fmt(r.minDeckungPct, 1) + ' %', 'schlechteste Stunde (eigene Deckung)')}
      ${kpi(_fmt(bil.autarkiePct, 1) + ' %', 'Autarkiegrad über das Jahr')}
      ${kpi(_tEur(k.investGes), 'Investition')}
      ${kpi(_fmt(k.gesamt) + ' €/a', `Jahreskosten · nur Netz ${_fmt(k.referenz)} €/a`)}
      ${_erg.basis && r.zielPct > 0 ? kpi(((k.gesamt - _erg.basis.kosten.gesamt) >= 0 ? '+' : '') + _fmt(k.gesamt - _erg.basis.kosten.gesamt) + ' €/a', 'Preis des Ziels (ggü. ohne Ziel)') : ''}
    </div></div>`;
}

// ── Schieber ─────────────────────────────────────────────────────────────────

/** Schieber-Definitionen aus dem Optimum (Bereiche) */
function _schieberDefs() {
  const o = _erg.opt.ausl, info = _erg.info;
  let lastSumme = 0, spitze = 0;
  for (const v of info.last) { lastSumme += v; if (v > spitze) spitze = v; }
  const tagKwh = lastSumme / 365, zielKw = _st.zielPct / 100 * spitze;
  const zeigH2 = _erg.cfg.h2Aktiv || o.bzKw > 0, zeigBh = _erg.cfg.bhkwAktiv || o.bhkwKw > 0;
  const rund = (x, s) => Math.max(s, Math.ceil(x / s) * s);
  return [
    { k: 'pvKwp', label: 'PV', einheit: 'kWp', max: rund(info.pvMaxKwp || o.pvKwp * 1.5, 10), step: 10, farbe: FARBE.direkt },
    { k: 'batKwh', label: 'Batterie', einheit: 'kWh', max: rund(Math.max(o.batKwh * 2, tagKwh * 1.5), 10), step: 10, farbe: FARBE.bat },
    zeigH2 && { k: 'elyKw', label: 'Elektrolyseur', einheit: 'kW', max: rund(Math.max(o.elyKw * 3, zielKw), 5), step: 1, farbe: FARBE.h2 },
    zeigH2 && { k: 'tankKg', label: 'H₂-Tank', einheit: 'kg', max: rund(Math.max(o.tankKg * 2, _erg.cfg.tankMaxKg || 0, 100), 50), step: 10, farbe: FARBE.h2 },
    zeigH2 && { k: 'bzKw', label: 'Brennstoffzelle', einheit: 'kW', max: rund(Math.max(o.bzKw * 2, zielKw * 1.2), 5), step: 1, farbe: FARBE.h2 },
    zeigBh && { k: 'bhkwKw', label: 'BHKW', einheit: 'kW', max: rund(Math.max(o.bhkwKw * 2, zielKw * 1.2), 5), step: 1, farbe: FARBE.bhkw },
  ].filter(Boolean);
}

function _schieberHtml() {
  const o = _erg.opt.ausl, akt = _aktGroessen();
  const zeilen = _schieberDefs().map(d => {
    const v = akt[d.k] || 0, ov = d.k === 'tankKg' ? o.tankKg : o[d.k] || 0;
    const ueberGrenze = d.k === 'tankKg' && _erg.cfg.tankMaxKg > 0 && v > _erg.cfg.tankMaxKg;
    return `<div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:10.5px;color:var(--muted);width:96px;flex-shrink:0;">${d.label}</span>
      <input type="range" data-ah2-schieber="${d.k}" min="0" max="${d.max}" step="${d.step}" value="${Math.round(v)}" style="flex:1;min-width:80px;accent-color:${d.farbe};">
      <span data-ah2-wert="${d.k}" style="font-size:10.5px;font-family:'DM Mono',monospace;width:78px;text-align:right;color:${ueberGrenze ? '#e57373' : 'var(--text)'};">${_fmt(v)} ${d.einheit}</span>
      <span style="font-size:9.5px;color:var(--muted);width:78px;" title="Wert der optimalen Auslegung">Opt. ${_fmt(ov)}</span></div>`;
  }).join('');
  return `<div class="ah2-karte" style="padding:9px 12px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
      <b style="font-size:11px;">Anlagen variieren</b>
      <span style="font-size:10px;color:var(--muted);">Schieber ziehen — das Jahr wird stündlich neu gerechnet; Kennzahlen und Reiter folgen live.
        Batterie-Betriebsweise:
        <select data-ah2-reserve style="font-size:10px;padding:1px 3px;">${[0, 0.5, 1].map(x =>
          `<option value="${x}" ${+akt.batReserve === x ? 'selected' : ''}>${{ 0: 'ganze Last', 0.5: 'Reserve 50 %', 1: 'nur Ziel' }[x]}</option>`).join('')}</select></span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:6px 22px;">${zeilen}</div></div>`;
}

/** Aktuell eingestellte Größen (Schieber) — ohne eigene Einstellung die des Optimums */
function _aktGroessen() {
  const o = _erg.opt.ausl;
  return _man || { pvKwp: o.pvKwp, batKwh: o.batKwh, batReserve: o.batReserve, elyKw: o.elyKw, tankKg: o.tankKg, bzKw: o.bzKw, bhkwKw: o.bhkwKw || 0 };
}

/** Eigene Einstellung stündlich nachrechnen */
function _manuellRechnen() {
  if (!_man || !_erg?.inp) return;
  const a = { pvKwp: _man.pvKwp, batKwh: _man.batKwh, batReserve: _man.batReserve, elyKw: _man.elyKw, bzKw: _man.bzKw,
    tankKwh: _man.tankKg * H2_KWH_PRO_KG, bhkwKw: _man.bhkwKw, bhkwZuerst: !!_erg.opt.ausl.bhkwZuerst };
  _erg.best = ah2Simulieren(_erg.inp, a, _erg.cfg);
  _erg.ohne = ah2OhneH2(_erg.inp, a, _erg.cfg);
  _st.manuell = { ..._man };
}

/** Nur Kopf, Reiterleiste und Reiterinhalt neu zeichnen — die Schieber bleiben beim Ziehen stehen */
function _teilAktualisieren() {
  const k = document.getElementById('ah2-kopf'), t = document.getElementById('ah2-tabs'), i = document.getElementById('ah2-inhalt');
  if (k) k.innerHTML = _kopfHtml();
  if (t) t.innerHTML = _tabsLeisteHtml();
  if (i) i.innerHTML = _tabInhaltHtml();
  _heatmapZeichnen();
}

// ── Reiter „Auslegung": wonach jede Anlage bemessen ist ──────────────────────

function _auslegungHtml() {
  const o = _erg.opt, a = o.ausl, akt = _aktGroessen(), cfg = _erg.cfg;
  if (!_erg.nachweis || _erg.nachweisFuer !== o) {
    _erg.nachweis = ah2Nachweis(_erg.inp, o, cfg);
    _erg.nachweisFuer = o;
  }
  const n = _erg.nachweis;
  let lastSumme = 0;
  for (const v of _erg.info.last) lastSumme += v;
  const tagKwh = lastSumme / 365, pvMax = _erg.info.pvMaxKwp || 0;
  const z = _fmt(cfg.zielPct);
  const tol = cfg.toleranzH ? ` (ohne die ${cfg.toleranzH} schlechtesten Stunden)` : '';
  const zeile = (farbe, name, wert, eingestellt, regel) => `<tr>
    <td class="l" style="vertical-align:top;"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${farbe};margin-right:5px;"></i><b>${name}</b></td>
    <td class="m" style="vertical-align:top;">${wert}</td>
    <td class="m" style="vertical-align:top;color:${eingestellt ? '#ffb74d' : 'var(--muted)'};">${eingestellt || '='}</td>
    <td class="l" style="white-space:normal;line-height:1.55;vertical-align:top;">${regel}</td></tr>`;
  const abw = (k, v, einh) => _man && Math.abs((akt[k] || 0) - v) > 0.5 ? `${_fmt(akt[k])} ${einh}` : '';
  const zeilen = [];
  zeilen.push(zeile(FARBE.direkt, 'PV', `${_fmt(a.pvKwp)} kWp`, abw('pvKwp', a.pvKwp, 'kWp'),
    `<b>Kostenoptimum</b> der Suche über 0–${_fmt(pvMax)} kWp (Raster in 10-%-Schritten, danach verfeinert). `
    + (a.pvKwp >= pvMax - 1 ? 'Liegt am <b>Dachpotenzial</b> — begrenzt durch die Fläche, nicht durch die Kosten; mehr Fläche würde die Speicher verkleinern.'
      : 'Liegt unter dem Dachpotenzial — mehr PV würde mehr kosten, als sie an Netzbezug und Speicher spart.')));
  zeilen.push(zeile(FARBE.bat, 'Batterie', `${_fmt(a.batKwh)} kWh<br>${_fmt(a.batKw)} kW`, abw('batKwh', a.batKwh, 'kWh'),
    `<b>Kostenoptimum</b> der Suche über 0–1,5 Tagesverbräuche (${_fmt(tagKwh)} kWh/Tag), gemeinsam mit der PV. Leistung = ${_fmt(cfg.bat.cRate, 2)} × Kapazität. `
    + (a.batKwh > 0 ? `Betriebsweise (mitoptimiert): die Batterie ${_RESERVE_TXT[a.batReserve] || ''}. Sie übernimmt den Tag-Nacht-Ausgleich; für mehrere Tage oder den Winter ist sie zu teuer.` : 'Keine Batterie: der Tag-Nacht-Ausgleich lohnt sich hier nicht.')));
  if (n.bz) {
    const s = n.bz;
    zeilen.push(zeile(FARBE.h2, 'Brennstoffzelle', `${_fmt(a.bzKw)} kW`, abw('bzKw', a.bzKw, 'kW'),
      `<b>= größte Zielunterdeckung</b> nach Batterie${a.bhkwZuerst ? ' und BHKW-Grundlast' : ''}${tol}. Bestimmende Stunde: <b>${_zeit(s.t)}</b> — Last ${_fmt(s.last)} kW × ${z} % = ${_fmt(s.ziel)} kW Ziel;
      davon direkt ${_fmt(s.direkt)} kW, Batterie ${_fmt(s.bat)} kW${s.bhkw > 0.05 ? `, BHKW ${_fmt(s.bhkw)} kW` : ''} → Rest <b>${_fmt(s.bz)} kW</b>. Im Einsatz in ${_fmt(s.stunden)} Stunden/a.`));
  }
  if (n.tank) {
    const s = n.tank;
    zeilen.push(zeile(FARBE.h2, 'H₂-Tank', `${_fmt(s.kg)} kg<br>${_mwh(s.kwh)}`, abw('tankKg', s.kg, 'kg'),
      `<b>= größte zusammenhängende Entnahme</b> über das Jahr: vom <b>${_datum(s.tVoll)}</b> (Tank voll) bis <b>${_datum(s.tLeer)}</b> (tiefster Stand ${_fmt(s.minPct)} %)
      werden in ${_fmt(s.dauerH / 24)} Tagen ${_mwh(s.entnahmeKwh)} H₂ entnommen — mehr, als der Elektrolyseur in dieser Zeit nachliefern kann.
      ${cfg.tankMaxKg > 0 ? `Obergrenze ${_fmt(cfg.tankMaxKg)} kg${s.kg > cfg.tankMaxKg * 0.98 ? ' — <b>greift</b>' : ' — eingehalten'}.` : 'Keine Obergrenze gesetzt.'}`));
  }
  if (n.ely) {
    const s = n.ely, amMin = s.kw <= s.minKw * 1.05;
    zeilen.push(zeile(FARBE.h2, 'Elektrolyseur', `${_fmt(a.elyKw)} kW`, abw('elyKw', a.elyKw, 'kW'),
      `Mindestens <b>${_fmt(s.minKw)} kW</b>, damit übers Jahr so viel Wasserstoff entsteht wie verbraucht wird (${_fmt(s.h2Mwh)} MWh H₂ aus ${_fmt(s.ueberStunden)} Überschussstunden). `
      + (amMin ? 'Gewählt ist das Minimum — ein größerer Elektrolyseur würde mehr kosten, als er am Tank spart.'
        : `Gewählt <b>${_fmt(s.kw)} kW</b>: größer als nötig, weil er den Tank in kürzeren Überschussphasen füllt — der Tank wird dadurch kleiner, und das spart mehr, als der größere Elektrolyseur kostet.`)
      + ` ${_fmt(s.vbh)} Volllaststunden.`));
  }
  if (n.bhkw) {
    const s = n.bhkw;
    zeilen.push(zeile(FARBE.bhkw, 'BHKW', `${_fmt(a.bhkwKw)} kW`, abw('bhkwKw', a.bhkwKw, 'kW'),
      (s.zuerst
        ? `<b>Grundlast</b>: die Optimierung teilt die Zielspitze zwischen BHKW und Brennstoffzelle; das BHKW trägt ${_fmt(a.bhkwKw)} kW in jeder Unterdeckungsstunde, der Wasserstoff nur die Spitzen darüber — das hält den Tank klein.`
        : `<b>= größte Zielunterdeckung</b>, die nach Batterie${a.bzKw > 0 ? ' und Brennstoffzelle (Tank leer)' : ''} bleibt${tol}. Bestimmende Stunde: <b>${_zeit(s.t)}</b> — Last ${_fmt(s.last)} kW × ${z} % = ${_fmt(s.ziel)} kW Ziel; davon direkt ${_fmt(s.direkt)} kW, Batterie ${_fmt(s.bat)} kW${s.bz > 0.05 ? `, Brennstoffzelle ${_fmt(s.bz)} kW` : ''} → BHKW <b>${_fmt(s.bhkw)} kW</b>.`)
      + (s.voll ? ' Weil sein Strom billiger als Netzstrom ist, läuft es zusätzlich auch außerhalb der Zielstunden.' : '')));
  }
  const bed = [`Ziel ${z} % in jeder Stunde${cfg.toleranzH ? `, ${cfg.toleranzH} Stunden/a dürfen darunter liegen` : ''}`,
    `zugelassen: ${[cfg.h2Aktiv && 'Wasserstoff', cfg.bhkwAktiv && `BHKW (${escHtml(AH2_BRENNSTOFFE[cfg.bhkwBrennstoff]?.label || '')})`].filter(Boolean).join(', ') || 'nur PV + Batterie'}`,
    cfg.tankMaxKg > 0 && `H₂-Tank höchstens ${_fmt(cfg.tankMaxKg)} kg`,
    'Zielfunktion: geringste Jahreskosten (Annuität + Instandhaltung + Brennstoff + Netzbezug − Erlöse)'].filter(Boolean);
  return _lesehilfe('Wonach die Anlagen ausgelegt sind',
    'Jede Anlagengröße folgt aus einer Regel — entweder aus einer bestimmenden Stunde bzw. Zeitspanne oder aus dem Kostenoptimum der Suche. '
    + 'Die Tabelle nennt für die optimale Auslegung jeweils die Regel und die Zahlen, die sie festlegen. Mit den Schiebern oben lässt sich jede Größe verändern; die Spalte „eingestellt" zeigt dann die Abweichung.')
    + `<table><thead><tr><th class="l" style="width:140px;">Anlage</th><th style="width:90px;">Optimum</th><th style="width:90px;">eingestellt</th><th class="l">ausgelegt nach</th></tr></thead>
      <tbody>${zeilen.join('')}</tbody></table>
    <div style="font-size:10.5px;color:var(--muted);margin-top:10px;line-height:1.55;"><b>Randbedingungen:</b> ${bed.join(' · ')}.
      Rechenweg: Batterie lädt vor dem Elektrolyseur und entlädt vor Brennstoffzelle/BHKW; die Größen der Wintertechnik folgen damit geschlossen aus dem stündlichen Verlauf nach der Batterie.
      ${_erg.gespeichert ? 'Gespeicherte Auslegung nachgerechnet.' : `${_fmt(_erg.ausgewertet)} Kombinationen bewertet in ${_fmt((_erg.dauerMs || 0) / 1000, 1)} s.`}</div>`;
}

// ── Reiter „Hinweise" ────────────────────────────────────────────────────────

function _hinweise() {
  if (!_erg?.best) return [];
  const r = _erg.best, a = r.ausl, bil = r.bilanz, ohne = _erg.ohne, cfg = _erg.cfg;
  const h = [];
  if (ohne && ohne.stundenUnter > r.toleranzH) {
    h.push(['info', `Ohne ${a.bhkwKw > 0 && a.bzKw > 0 ? 'Wasserstoff und BHKW' : a.bhkwKw > 0 ? 'BHKW' : 'Wasserstoff'} würde dieselbe PV/Batterie das Ziel in ${_fmt(ohne.stundenUnter)} Stunden verfehlen (${_fmt(ohne.ungedecktMwh, 1)} MWh fehlen).`]);
  }
  if (bil.stundenUnter > r.toleranzH) h.push(['warn', `In ${bil.stundenUnter} Stunden liegt die eigene Deckung unter dem Ziel${_man ? ' — die eingestellten Anlagen reichen nicht' : ' — Tank knapp; Annahmen prüfen'}.`]);
  if (a.pvKwp >= (_erg.info?.pvMaxKwp || 0) - 1 && (a.bzKw > 0 || a.bhkwKw > 0)) h.push(['info', 'PV liegt am Dachpotenzial — zusätzliche Fläche (Freifläche, Wind) würde die Wintertechnik verkleinern.']);
  if (cfg.tankMaxKg > 0 && a.tankKwh > 0) h.push([a.tankKg > cfg.tankMaxKg ? 'warn' : 'info', `Tank-Obergrenze ${_fmt(cfg.tankMaxKg)} kg ${a.tankKg > cfg.tankMaxKg ? 'überschritten' : 'eingehalten'} (${_fmt(a.tankKg)} kg).`]);
  if (a.bhkwKw > 0) {
    const bs = AH2_BRENNSTOFFE[a.bhkwBrennstoff];
    const fwl = a.bhkwKw / cfg.bhkw.etaEl;
    if (bil.bhkwVoll) h.push(['info', `BHKW-Strom kostet ${_fmt(ah2BhkwGrenzkosten(cfg), 1)} ct/kWh und ist damit billiger als Netzstrom (${_fmt(cfg.preise.pStrom, 1)} ct/kWh) — es läuft deshalb nicht nur für das Ziel, sondern ersetzt im Rahmen seiner Leistung Netzbezug. Das Ergebnis hängt stark am Brennstoffpreis.`]);
    if (bs?.hinweis) h.push(['info', `BHKW mit ${bs.label}: ${bs.hinweis}.`]);
    h.push(['recht', `BHKW-Feuerungswärmeleistung ≈ ${_fmt(fwl)} kW${fwl >= 1000 ? ' — ab 1 MW: 44. BImSchV und ggf. BImSchG-Genehmigung (4. BImSchV Nr. 1.2) prüfen' : ' — unter 1 MW, i. d. R. ohne BImSchG-Genehmigung; Baurecht, Schallschutz und Brennstofflager prüfen'}.`]);
    h.push(['info', 'Das BHKW verbrennt zugekauften biogenen Brennstoff — ob das als „eigene erneuerbare Erzeugung" zählt, legt die Zieldefinition fest.']);
  }
  // Schwellen: 4. BImSchV Anh. 1 Nr. 9.3 i. V. m. Anh. 2 Nr. 17 (Lager), Nr. 10.26 (Elektrolyse, seit 11/2024);
  // 12. BImSchV Anh. I Nr. 2.44. Die Störfall-Schwelle gilt für ALLEN Wasserstoff im Betriebsbereich
  // (Tank + Leitungen + Anlagen) und wird mit anderen gefährlichen Stoffen addiert (Heizöl, Diesel …).
  if (a.tankKg >= 30000) h.push(['recht', 'Lagermenge ≥ 30 t H₂: förmliches BImSchG-Verfahren mit Öffentlichkeitsbeteiligung (§ 10 BImSchG, 4. BImSchV Nr. 9.3).']);
  else if (a.tankKg >= 3000) h.push(['recht', 'Lagermenge ≥ 3 t H₂: BImSchG-Genehmigung im vereinfachten Verfahren (§ 19 BImSchG, 4. BImSchV Nr. 9.3).']);
  if (a.tankKg >= 50000) h.push(['recht', '≥ 50 t H₂ im Betriebsbereich: obere Klasse der Störfall-Verordnung — Sicherheitsbericht, Sicherheitsmanagement, Alarm- und Gefahrenabwehrplan.']);
  else if (a.tankKg >= 5000) h.push(['recht', '≥ 5 t H₂ im Betriebsbereich: untere Klasse der Störfall-Verordnung — Konzept zur Verhinderung von Störfällen, angemessener Sicherheitsabstand zu Schutzobjekten.']);
  else if (a.tankKg >= 3500) h.push(['recht', 'Nahe der Störfall-Schwelle von 5 t: andere gefährliche Stoffe am Standort (Heizöl, Diesel der Notstromaggregate, Gas) werden mitgerechnet.']);
  if (a.elyKw > 5000) h.push(['recht', 'Elektrolyseur > 5 MW: BImSchG-Genehmigung im vereinfachten Verfahren (4. BImSchV Nr. 10.26), standortbezogene UVP-Vorprüfung.']);
  if (a.tankKg > 0) h.push(['recht', 'Unabhängig von den Schwellen: Explosionsschutzdokument und Ex-Zonen (GefStoffV/BetrSichV), Druckbehälter mit Prüfpflicht (BetrSichV, ZÜS), Baugenehmigung und Brandschutzkonzept.']);
  return h;
}

function _hinweiseHtml() {
  const h = _hinweise(), r = _erg.best, a = r.ausl, bil = r.bilanz;
  const gruppe = (art, titel, farbe) => {
    const liste = h.filter(x => x[0] === art);
    return liste.length ? `<div style="margin-bottom:12px;"><div style="font-size:11.5px;font-weight:600;margin-bottom:4px;color:${farbe};">${titel}</div>
      <ul style="margin:0;padding-left:18px;font-size:11px;line-height:1.6;">${liste.map(x => `<li>${escHtml(x[1])}</li>`).join('')}</ul></div>` : '';
  };
  const vol = a.tankM3 != null && a.tankKwh > 0 ? `Tankvolumen ≈ ${_fmt(a.tankM3)} m³ bei ${a.druckBar} bar. ` : '';
  const waerme = bil.waermeMwh > 0.5
    ? `Nutzbare Wärme aus ${bil.bhkwMwh > 0 && bil.bzOutMwh > 0 ? 'Elektrolyse, Brennstoffzelle und BHKW' : bil.bhkwMwh > 0 ? 'dem BHKW' : 'Elektrolyse und Brennstoffzelle'}: ${_fmt(bil.waermeMwh)} MWh/a${_erg.cfg.preise.pWaerme > 0 ? ` (angerechnet mit ${_fmt(_erg.cfg.preise.pWaerme, 1)} ct/kWh)` : ' (nicht angerechnet)'}. `
    : '';
  return _lesehilfe('Hinweise, Genehmigung und Modellgrenzen', 'Was bei der eingestellten Auslegung zu beachten ist. Genehmigungsschwellen sind Richtwerte — im Einzelfall mit der zuständigen Behörde klären.')
    + gruppe('warn', 'Achtung', '#e57373') + gruppe('recht', 'Genehmigung und Recht', '#ffb74d') + gruppe('info', 'Zur Einordnung', 'var(--text)')
    + `<div style="font-size:11px;font-weight:600;margin:6px 0 4px;">Jahresbilanz</div>
    <div style="font-size:11px;color:var(--muted);line-height:1.6;">
      ${a.bhkwKw > 0 ? `BHKW ${_fmt(bil.bhkwMwh)} MWh/a (${_fmt(r.bhkwVbh)} Volllaststunden) aus ${_fmt(bil.bhkwBrennstoffMwh)} MWh Brennstoff. ` : ''}
      ${a.bzKw > 0 ? `Brennstoffzelle ${_fmt(bil.bzOutMwh)} MWh/a (${_fmt(r.bzVbh)} Volllaststunden), Elektrolyseur ${_fmt(bil.elyInMwh)} MWh/a Überschuss (${_fmt(r.elyVbh)} Volllaststunden). ${vol}` : ''}
      Netzbezug ${_fmt(bil.netzMwh)} MWh/a, Einspeisung ${_fmt(bil.einspMwh)} MWh/a${bil.abregMwh > 0.5 ? `, abgeregelt ${_fmt(bil.abregMwh)} MWh/a` : ''}. ${waerme}</div>
    <div style="font-size:11px;font-weight:600;margin:10px 0 4px;">Modellgrenzen</div>
    <div style="font-size:11px;color:var(--muted);line-height:1.6;">Stundenwerte (15-min-Lastgänge gemittelt) · ein Wetterjahr · Batterie- und Tankstand zyklisch über das Jahr ·
      konstante Wirkungsgrade, keine Teillast-, Standby- und Selbstentladungsverluste · Kosten ohne Netzentgelt-Effekte, Förderung und Stack-Tausch.</div>`;
}

/** Legende (Text in Textfarbe, Farbe nur am Kästchen) */
const _legende = (eintraege) => `<div style="margin:6px 0 2px;">${eintraege.map(([f, t]) =>
  `<span class="ah2-leg"><i style="background:${f};"></i>${t}</span>`).join('')}</div>`;

function _monateSvg() {
  const M = _erg.best.monate;
  const W = _breite(), H = 340, PL = 54, PR = 12, PT = 12, PB = 26;
  const yMax = Math.max(1, ...M.map(m => m.last)) * 1.08;
  const y = v => PT + (1 - v / yMax) * (H - PT - PB);
  const bw = (W - PL - PR) / 12;
  const namen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const v = yMax * i / 4;
    out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${PL - 6}" y="${y(v) + 3}" font-size="10.5" text-anchor="end" fill="var(--muted)">${_fmt(v)}</text>`);
  }
  out.push(`<text x="12" y="${(PT + H - PB) / 2}" font-size="9.5" text-anchor="middle" fill="var(--muted)" transform="rotate(-90 12 ${(PT + H - PB) / 2})">MWh</text>`);
  M.forEach((m, i) => {
    const x0 = PL + i * bw + bw * 0.18, w = bw * 0.64;
    let basis = 0;
    const teile = [['direkt', 'Direkt aus PV/Wind', m.direkt], ['bat', 'Batterie', m.bat], ['bhkw', 'BHKW', m.bhkw || 0],
      ['h2', 'Brennstoffzelle (H₂)', m.bz], ['netz', 'Netzbezug', m.netz]];
    const tip = `${namen[i]}: Last ${_fmt(m.last, 1)} MWh\n` + teile.map(([, t, v]) => `${t} ${_fmt(v, 1)} MWh (${_fmt(m.last > 0 ? v / m.last * 100 : 0)} %)`).join('\n')
      + `\nZiel ${_fmt(m.ziel, 1)} MWh · Elektrolyse ${_fmt(m.ely, 1)} MWh`;
    out.push(`<g><title>${escHtml(tip)}</title><rect x="${PL + i * bw}" y="${PT}" width="${bw}" height="${H - PT - PB}" fill="transparent"/>`);
    for (const [key, , v] of teile) {
      if (v <= 0) continue;
      const y1 = y(basis + v), h = y(basis) - y1;
      // 2 px Oberflächenabstand zwischen den Segmenten
      out.push(`<rect x="${x0}" y="${y1 + 1}" width="${w}" height="${Math.max(0, h - 2)}" rx="1.5" fill="${FARBE[key]}"/>`);
      basis += v;
    }
    out.push(`<line x1="${x0 - 3}" x2="${x0 + w + 3}" y1="${y(m.ziel)}" y2="${y(m.ziel)}" stroke="var(--text)" stroke-width="2"/></g>
      <text x="${PL + i * bw + bw / 2}" y="${H - PB + 14}" font-size="10.5" text-anchor="middle" fill="var(--muted)">${namen[i]}</text>`);
  });
  const mitBhkw = M.some(m => m.bhkw > 0), mitBz = M.some(m => m.bz > 0);
  return `${_legende([[FARBE.direkt, 'Direkt aus PV/Wind'], [FARBE.bat, 'Batterie'], ...(mitBhkw ? [[FARBE.bhkw, 'BHKW']] : []),
    ...(mitBz ? [[FARBE.h2, 'Brennstoffzelle (H₂)']] : []), [FARBE.netz, 'Netzbezug'], ['var(--text)', 'Ziel']])}
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;">${out.join('')}</svg>`;
}

function _tankSvg() {
  const r = _erg.best, kap = r.ausl.tankKwh, tank = r.bilanz.reihen.tank;
  const tage = Math.floor(tank.length / 24);
  const W = _breite(), H = 300, PL = 54, PR = 12, PT = 12, PB = 26;
  const x = d => PL + d / (tage - 1) * (W - PL - PR), y = v => PT + (1 - v / kap) * (H - PT - PB);
  const pts = [];
  for (let d = 0; d < tage; d++) pts.push([x(d), y(tank[d * 24 + 23])]);
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const v = kap * i / 4;
    out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${PL - 6}" y="${y(v) + 3}" font-size="10.5" text-anchor="end" fill="var(--muted)">${i * 25} %</text>`);
  }
  const mStart = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const namen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  mStart.forEach((d, i) => out.push(`<text x="${x(d + 15)}" y="${H - PB + 14}" font-size="10.5" text-anchor="middle" fill="var(--muted)">${namen[i]}</text>`));
  const linie = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  out.push(`<polygon points="${PL},${y(0)} ${linie} ${x(tage - 1)},${y(0)}" fill="${FARBE.h2}" opacity="0.18"/>
    <polyline points="${linie}" fill="none" stroke="${FARBE.h2}" stroke-width="2"/>`);
  // Hover: ein unsichtbarer Streifen je Woche mit Tooltip
  for (let d = 0; d < tage; d += 7) {
    const v = tank[Math.min(tank.length - 1, d * 24 + 23)];
    const dt = new Date(2025, 0, 1 + d);
    out.push(`<rect x="${x(d)}" y="${PT}" width="${Math.max(1, x(Math.min(tage - 1, d + 7)) - x(d))}" height="${H - PT - PB}" fill="transparent">
      <title>${dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}: ${_mwh(v)} (${_fmt(v / kap * 100)} %) · ${_fmt(v / 33.33)} kg H₂</title></rect>`);
  }
  let minV = Infinity, minD = 0;
  for (let d = 0; d < tage; d++) { const v = tank[d * 24 + 23]; if (v < minV) { minV = v; minD = d; } }
  const dtMin = new Date(2025, 0, 1 + minD).toLocaleDateString('de-DE', { day: '2-digit', month: 'long' });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;margin-top:6px;">${out.join('')}</svg>
    <div style="font-size:10px;color:var(--muted);">Kapazität ${_mwh(kap)} = ${_fmt(r.ausl.tankKg)} kg H₂ · tiefster Stand ${_fmt(minV / kap * 100)} % am ${dtMin}
      · Der Tank ist so klein wie möglich: er leert sich einmal im Jahr fast vollständig.</div>`;
}

function _dauerlinieSvg() {
  const r = _erg.best, info = _erg.info;
  const L = info.last, netz = r.bilanz.reihen.netz;
  // Deckung ohne Wintertechnik = Deckung mit − Beitrag von Brennstoffzelle und BHKW
  const mit = [], ohne = [];
  for (let t = 0; t < netz.length; t++) {
    if (L[t] <= 0) continue;
    mit.push((L[t] - netz[t]) / L[t] * 100);
    ohne.push((L[t] - netz[t] - r.bilanz.reihen.bz[t] - r.bilanz.reihen.bhkw[t]) / L[t] * 100);
  }
  mit.sort((p, q) => p - q); ohne.sort((p, q) => p - q);
  const W = _breite(), H = 300, PL = 54, PR = 12, PT = 12, PB = 28;
  const n = mit.length;
  const x = i => PL + i / (n - 1) * (W - PL - PR), y = v => PT + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - PT - PB);
  const probe = arr => { const pts = []; const schritt = Math.max(1, Math.floor(n / 400));
    for (let i = 0; i < n; i += schritt) pts.push(`${x(i).toFixed(1)},${y(arr[i]).toFixed(1)}`);
    pts.push(`${x(n - 1).toFixed(1)},${y(arr[n - 1]).toFixed(1)}`); return pts.join(' '); };
  const out = [];
  for (let i = 0; i <= 4; i++) {
    out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(i * 25)}" y2="${y(i * 25)}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${PL - 6}" y="${y(i * 25) + 3}" font-size="10.5" text-anchor="end" fill="var(--muted)">${i * 25} %</text>`);
  }
  for (const h of [0, 2190, 4380, 6570, 8760]) {
    const i = Math.min(n - 1, Math.round(h / 8760 * (n - 1)));
    const anker = h === 0 ? 'start' : h === 8760 ? 'end' : 'middle';
    out.push(`<text x="${x(i)}" y="${H - PB + 14}" font-size="10.5" text-anchor="${anker}" fill="var(--muted)">${_fmt(h)} h</text>`);
  }
  const unterOhne = ohne.filter(v => v < r.zielPct - 0.05).length;
  out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(r.zielPct)}" y2="${y(r.zielPct)}" stroke="var(--text)" stroke-width="1" stroke-dasharray="4 3"/>
    <text x="${W - PR - 4}" y="${y(r.zielPct) - 4}" font-size="10.5" text-anchor="end" fill="var(--text)">Ziel ${_fmt(r.zielPct)} %</text>
    <polyline points="${probe(ohne)}" fill="none" stroke="${FARBE.bat}" stroke-width="2"/>
    <polyline points="${probe(mit)}" fill="none" stroke="${FARBE.h2}" stroke-width="2"/>`);
  if (unterOhne > 0 && x(Math.min(n - 1, unterOhne)) - PL > 130) {
    // Beschriftung in die Lücke zwischen beiden Linien (unter dem Ziel, links der Stufe)
    out.push(`<text x="${x(Math.min(n - 1, unterOhne)) - 6}" y="${y(r.zielPct / 2) + 3}" font-size="10.5" text-anchor="end" fill="var(--muted)">${_fmt(unterOhne)} h ohne sie unter Ziel</text>`);
  }
  const mitTxt = r.ausl.bhkwKw > 0 && r.ausl.bzKw > 0 ? 'mit Wasserstoff + BHKW' : r.ausl.bhkwKw > 0 ? 'mit BHKW' : 'mit Wasserstoff';
  return `${_legende([[FARBE.h2, mitTxt], [FARBE.bat, 'nur PV + Batterie'], ['var(--text)', 'Ziel']])}
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;">${out.join('')}</svg>
    <div style="font-size:10px;color:var(--muted);">Links liegen die kritischen Stunden (Winternächte, Dunkelflauten): dort heben Brennstoffzelle bzw. BHKW die Deckung auf das Ziel.</div>`;
}

// ── Was kostet das Ziel? ──────────────────────────────────────────────────────

function _lastSpitze() {
  let m = 0;
  for (const v of _erg.info.last) if (v > m) m = v;
  return m;
}

/** Stunden unter einem Ziel für eine Auslegung (aus den Stundenreihen) */
function _stundenUnter(r, zielPct) {
  const L = _erg.info.last, netz = r.bilanz.reihen.netz;
  let n = 0;
  for (let t = 0; t < netz.length; t++) if (L[t] > 0 && (L[t] - netz[t]) / L[t] * 100 < zielPct - 0.05) n++;
  return n;
}

function _zielKostenHtml() {
  const mit = _erg.best, ohne = _erg.basis;
  if (!ohne || mit.zielPct <= 0) return '';
  const zk = ah2ZielKosten(mit, ohne, _lastSpitze());
  const km = mit.kosten, ko = ohne.kosten, ref = km.referenz, pStrom = _erg.cfg.preise.pStrom;
  const h2Txt = r => r.ausl.bzKw > 0 ? `${_fmt(r.ausl.elyKw)} kW · ${_fmt(r.ausl.tankKg)} kg · ${_fmt(r.ausl.bzKw)} kW` : '—';
  const bhTxt = r => r.ausl.bhkwKw > 0 ? `${_fmt(r.ausl.bhkwKw)} kW` : '—';
  const betr = k => k.brennstoff + k.wartung;
  const d = (x, y, fmt = _fmt) => {
    const v = x - y;
    return `<span style="color:${v > 0.5 ? '#e57373' : v < -0.5 ? '#66bb6a' : 'var(--muted)'};">${v > 0 ? '+' : ''}${fmt(v)}</span>`;
  };
  const zeile = (name, netz, o, m, diff, fett = false) => `<tr${fett ? ' style="font-weight:600;"' : ''}><td class="l">${name}</td>
    <td class="m">${netz}</td><td class="m">${o}</td><td class="m">${m}</td><td class="m">${diff}</td></tr>`;
  const erl = k => -(k.einsp + k.waerme);
  const tabelle = `<table style="margin-top:6px;"><thead><tr><th class="l"></th><th>nur Netzbezug</th>
      <th>ohne Ziel<br><span style="font-weight:400;">wirtschaftlich beste PV/Batterie</span></th>
      <th>mit Ziel ${_fmt(mit.zielPct)} %</th><th>Preis des Ziels<br><span style="font-weight:400;">mit − ohne Ziel</span></th></tr></thead><tbody>
    ${zeile('PV', '—', _fmt(ohne.ausl.pvKwp) + ' kWp', _fmt(mit.ausl.pvKwp) + ' kWp', d(mit.ausl.pvKwp, ohne.ausl.pvKwp) + ' kWp')}
    ${zeile('Batterie', '—', _fmt(ohne.ausl.batKwh) + ' kWh', _fmt(mit.ausl.batKwh) + ' kWh', d(mit.ausl.batKwh, ohne.ausl.batKwh) + ' kWh')}
    ${zeile('H₂: Elektrolyseur · Tank · BZ', '—', h2Txt(ohne), h2Txt(mit), '')}
    ${mit.ausl.bhkwKw > 0 ? zeile('BHKW', '—', bhTxt(ohne), bhTxt(mit), '') : ''}
    ${zeile('Investition', '—', _tEur(ko.investGes), _tEur(km.investGes), d(km.investGes, ko.investGes, _tEur))}
    ${zeile('Kapitalkosten + Instandhaltung €/a', '0', _fmt(ko.kapital), _fmt(km.kapital), d(km.kapital, ko.kapital))}
    ${mit.ausl.bhkwKw > 0 ? zeile('Brennstoff + Wartung BHKW €/a', '0', _fmt(betr(ko)), _fmt(betr(km)), d(betr(km), betr(ko))) : ''}
    ${zeile('Netzbezug €/a', _fmt(ref), _fmt(ko.netz), _fmt(km.netz), d(km.netz, ko.netz))}
    ${zeile('Erlöse (Einspeisung, Abwärme) €/a', '0', _fmt(erl(ko)), _fmt(erl(km)), d(erl(km), erl(ko)))}
    ${zeile('Jahreskosten €/a', _fmt(ref), _fmt(ko.gesamt), _fmt(km.gesamt), d(km.gesamt, ko.gesamt), true)}
    ${zeile('Autarkiegrad (Energie)', '0 %', _fmt(ohne.bilanz.autarkiePct, 1) + ' %', _fmt(mit.bilanz.autarkiePct, 1) + ' %',
      d(mit.bilanz.autarkiePct, ohne.bilanz.autarkiePct, v => _fmt(v, 1)) + ' %-Pkt.')}
    ${zeile('schlechteste Stunde (eigene Deckung)', '0 %', _fmt(ohne.minDeckungPct, 1) + ' %', _fmt(mit.minDeckungPct, 1) + ' %', '')}
    ${zeile(`Stunden unter ${_fmt(mit.zielPct)} %`, '8.760', _fmt(_stundenUnter(ohne, mit.zielPct)), _fmt(_stundenUnter(mit, mit.zielPct)), '')}
    </tbody></table>`;
  const kpi = (w, t) => `<div class="ah2-kpi"><div class="w">${w}</div><div class="t">${t}</div></div>`;
  return `<div class="ah2-karte">
    <b style="font-size:11px;">Was kostet das Ziel?</b>
    <span style="font-size:10px;color:var(--muted);"> · Vergleich mit der günstigsten Auslegung ohne Ziel (gleiche Preise, PV bis zum Dachpotenzial frei wählbar)</span>
    <div style="font-size:12px;line-height:1.6;margin-top:6px;">
      Die Mindestdeckung von ${b(_fmt(mit.zielPct) + ' %')} kostet ${b((zk.dJk >= 0 ? '+' : '') + _fmt(zk.dJk) + ' €/a')}
      gegenüber der wirtschaftlich besten Auslegung ohne Ziel (Investition ${zk.dInvest >= 0 ? '+' : ''}${_tEur(zk.dInvest)}).</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px;">
      ${zk.ctJeSpeicherKwh != null ? kpi(_fmt(zk.ctJeSpeicherKwh) + ' ct/kWh', `je kWh aus ${mit.ausl.bhkwKw > 0 && mit.ausl.bzKw > 0 ? 'Brennstoffzelle und BHKW' : mit.ausl.bhkwKw > 0 ? 'dem BHKW' : 'der Brennstoffzelle'} (Netzstrom: ${_fmt(pStrom, 1)} ct/kWh)`) : ''}
      ${kpi(_fmt(zk.eurJeKwGesichert) + ' €/kW·a', `je kW gesicherter Eigenleistung (${_fmt(mit.zielPct)} % × Lastspitze = ${_fmt(zk.gesichertKw)} kW)`)}
      ${kpi(_fmt(zk.eurJeProzentpunkt) + ' €/a', 'je Prozentpunkt Mindestdeckung (Durchschnitt)')}
      ${zk.ctJeAutarkieKwh != null ? kpi(_fmt(zk.ctJeAutarkieKwh) + ' ct/kWh', `je zusätzlich selbst gedeckter kWh (+${_fmt(zk.dAutarkieKwh / 1000)} MWh/a)`) : ''}
    </div>
    ${_postenSvg(zk.posten)}
    ${tabelle}
    <div style="font-size:10px;color:var(--muted);margin-top:5px;line-height:1.5;">
      Lesart: Das Ziel kauft vor allem <b>Versorgung in den schwachen Stunden</b> (Winternächte, Dunkelflauten). Der Autarkiegrad über das Jahr
      steigt dabei oft nur wenig, weil der größte Teil des Jahres ohnehin aus PV und Batterie kommt. Aussagekräftige Bezugsgrößen sind deshalb
      die Kosten je kWh aus dem Wasserstoff und je gesichertem kW, nicht je Prozentpunkt Autarkiegrad.
      ${zk.ctJeAutarkieKwh == null ? ' Je zusätzlich selbst gedeckter kWh wird nicht ausgewiesen: der Autarkiegrad steigt um weniger als 1 % der Last.' : ''}
      Den Verlauf über verschiedene Ziele zeigt „📈 Zielkurve".</div>
  </div>`;
}

/** Woher kommt der Preis des Ziels? Änderung je Kostenposten (€/a), teurer nach rechts, günstiger nach links */
function _postenSvg(p) {
  const zeilen = [['PV', p.pv], ['PV-Infrastruktur', p.infra], ['Batterie', p.bat], ['Elektrolyseur', p.ely], ['H₂-Tank', p.tank],
    ['Brennstoffzelle', p.bz], ['BHKW (Anlage)', p.bhkw], ['BHKW-Brennstoff + Wartung', p.brennstoff],
    ['Netzbezug', p.netz], ['Erlöse', p.erloese]].filter(([, v]) => Math.abs(v || 0) >= 1);
  if (!zeilen.length) return '';
  const W = _breite(), zh = 22, PL = 190, PR = 80, H = zeilen.length * zh + 8;
  const mx = Math.max(1, ...zeilen.map(([, v]) => Math.abs(v)));
  const x0 = PL + (W - PL - PR) / 2, sk = (W - PL - PR) / 2 / mx;
  const out = [`<line x1="${x0}" x2="${x0}" y1="0" y2="${H}" stroke="var(--muted)" stroke-width="1"/>`];
  zeilen.forEach(([name, v], i) => {
    const y = 4 + i * zh, w = Math.abs(v) * sk, xs = v >= 0 ? x0 : x0 - w;
    out.push(`<g><title>${escHtml(`${name}: ${v >= 0 ? '+' : ''}${_fmt(v)} €/a`)}</title>
      <text x="${PL - 8}" y="${y + 13}" font-size="10" text-anchor="end" fill="var(--text)">${escHtml(name)}</text>
      <rect x="${xs}" y="${y + 3}" width="${Math.max(1, w)}" height="${zh - 7}" rx="2" fill="${v >= 0 ? FARBE.netz : FARBE.bat}"/>
      <text x="${v >= 0 ? xs + w + 5 : xs - 5}" y="${y + 13}" font-size="10" text-anchor="${v >= 0 ? 'start' : 'end'}" fill="var(--muted)">${v >= 0 ? '+' : ''}${_fmt(v)}</text></g>`);
  });
  return `<div style="font-size:10.5px;margin-top:6px;">Woher der Preis kommt (Änderung je Posten in €/a; Erlöse: weniger Einspeisung = teurer):
      <span class="ah2-leg" style="margin-left:8px;"><i style="background:${FARBE.netz};"></i>teurer</span><span class="ah2-leg"><i style="background:${FARBE.bat};"></i>günstiger</span></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;">${out.join('')}</svg>`;
}

// ── Heatmap: wann wird was genutzt und geladen ────────────────────────────────

const HM_METRIKEN = {
  direkt:  { gruppe: 'Wer deckt die Last?', label: 'Direkt aus PV/Wind', farbe: FARBE.direkt, reihe: r => r.direkt, last: true },
  batEntl: { gruppe: 'Wer deckt die Last?', label: 'Batterie entladen', farbe: FARBE.bat, reihe: r => r.batEntl, last: true },
  bhkw:    { gruppe: 'Wer deckt die Last?', label: 'BHKW', farbe: FARBE.bhkw, reihe: r => r.bilanz.reihen.bhkw, last: true },
  bz:      { gruppe: 'Wer deckt die Last?', label: 'Brennstoffzelle (H₂)', farbe: FARBE.h2, reihe: r => r.bilanz.reihen.bz, last: true },
  netz:    { gruppe: 'Wer deckt die Last?', label: 'Netzbezug', farbe: FARBE.netz, reihe: r => r.bilanz.reihen.netz, last: true },
  batLad:  { gruppe: 'Wohin geht der Überschuss?', label: 'Batterie laden', farbe: FARBE.bat, reihe: r => r.batLad },
  ely:     { gruppe: 'Wohin geht der Überschuss?', label: 'Elektrolyseur (H₂ erzeugen)', farbe: '#9085e9', reihe: r => r.bilanz.reihen.ely },
  einsp:   { gruppe: 'Wohin geht der Überschuss?', label: 'Einspeisung ins Netz', farbe: '#78909c', reihe: r => r.bilanz.reihen.einsp },
  abreg:   { gruppe: 'Wohin geht der Überschuss?', label: 'Abregelung', farbe: '#d55181', reihe: r => r.bilanz.reihen.abreg },
  batSoc:  { gruppe: 'Füllstände', label: 'Batterie-Ladestand', farbe: FARBE.bat, reihe: r => r.batSoc, kap: r => r.ausl.batKwh },
  tank:    { gruppe: 'Füllstände', label: 'H₂-Tank', farbe: FARBE.h2, reihe: r => r.bilanz.reihen.tank, kap: r => r.ausl.tankKwh },
  deckung: { gruppe: 'Füllstände', label: 'Eigene Deckung der Last', farbe: FARBE.h2, deckung: true },
};

/** Werte der gewählten Kennzahl je Stunde + Einheit */
function _hmWerte() {
  const r = _erg.best, m = HM_METRIKEN[_hm.metrik] || HM_METRIKEN.netz, L = _erg.info.last;
  const N = Math.min(8760, L.length), w = new Float32Array(N);
  let einheit = 'kW';
  if (m.deckung) {
    const netz = r.bilanz.reihen.netz;
    for (let t = 0; t < N; t++) w[t] = L[t] > 0 ? (L[t] - netz[t]) / L[t] * 100 : 100;
    einheit = '%';
  } else if (m.kap) {
    const kap = m.kap(r), q = m.reihe(r);
    for (let t = 0; t < N; t++) w[t] = kap > 0 ? q[t] / kap * 100 : 0;
    einheit = '%';
  } else {
    const q = m.reihe(r);
    const anteil = _hm.anteil && m.last;
    for (let t = 0; t < N; t++) w[t] = anteil ? (L[t] > 0 ? q[t] / L[t] * 100 : 0) : q[t];
    if (anteil) einheit = '% der Last';
  }
  return { w, einheit, m };
}

const _hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const _mix = (a, c, t) => a.map((v, i) => Math.round(v + (c[i] - v) * t));
/** Sequenzielle Rampe in EINEM Farbton: dunkel (nahe Hintergrund) → Farbton → aufgehellt. 0 = leere Zelle. */
function _rampe(farbe) {
  const bg = _hex('#1c1a15'), f = _hex(farbe), hell = _mix(f, [255, 255, 255], 0.5), start = _mix(bg, f, 0.18);
  return t => {
    if (!(t > 0)) return 'rgb(40,38,31)';
    const c = t < 0.65 ? _mix(start, f, t / 0.65) : _mix(f, hell, Math.min(1, (t - 0.65) / 0.35));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
}

function _heatmapHtml() {
  const a = _erg.best.ausl, gruppen = {};
  for (const [k, m] of Object.entries(HM_METRIKEN)) {
    if (['bz', 'ely', 'tank'].includes(k) && !(a.bzKw > 0)) continue;
    if (['batEntl', 'batLad', 'batSoc'].includes(k) && !(a.batKwh > 0)) continue;
    if (k === 'bhkw' && !(a.bhkwKw > 0)) continue;
    (gruppen[m.gruppe] ||= []).push(`<option value="${k}" ${k === _hm.metrik ? 'selected' : ''}>${m.label}</option>`);
  }
  const m = HM_METRIKEN[_hm.metrik] || HM_METRIKEN.netz;
  return `<div class="ah2-karte">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div style="flex:1 1 420px;">${_lesehilfe('Jahresraster: wann wird was genutzt und geladen?',
        'Jede Spalte ist ein Tag, jede Zeile eine Stunde. Oben die Größe wählen: wer die Last deckt (Netz, Batterie, BHKW, Brennstoffzelle), wohin der Überschuss geht '
        + '(Batterie laden, Elektrolyse, Einspeisung) oder wie voll die Speicher sind. Je heller die Zelle, desto mehr. Maus über das Raster zeigt alle Flüsse dieser Stunde.')}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <select data-ah2-hm="metrik" style="font-size:11px;padding:3px 5px;">${Object.entries(gruppen).map(([g, o]) =>
          `<optgroup label="${escHtml(g)}">${o.join('')}</optgroup>`).join('')}</select>
        <label style="font-size:10.5px;color:${m.last ? 'var(--text)' : 'var(--muted)'};display:flex;align-items:center;gap:4px;" title="Statt kW den Anteil an der Last der Stunde zeigen">
          <input type="checkbox" data-ah2-hm="anteil" ${_hm.anteil ? 'checked' : ''} ${m.last ? '' : 'disabled'}> Anteil an der Last</label>
      </div></div>
    <div style="position:relative;margin-top:6px;">
      <canvas id="ah2-hm-canvas" style="width:100%;display:block;cursor:crosshair;"></canvas>
      <div id="ah2-hm-tip" style="position:absolute;display:none;pointer-events:none;background:var(--surface2);border:1px solid var(--border);
        border-radius:5px;padding:6px 8px;font-size:10px;line-height:1.5;white-space:nowrap;z-index:5;"></div>
    </div>
    <div id="ah2-hm-legende" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:10px;color:var(--muted);"></div>
  </div>`;
}

function _heatmapZeichnen() {
  const cv = document.getElementById('ah2-hm-canvas');
  if (!cv || !_erg?.best) return;
  const r = _erg.best;
  const { w, einheit, m } = _hmWerte();
  const N = w.length, tage = Math.floor(N / 24);
  let max = 0;
  for (let t = 0; t < N; t++) if (w[t] > max) max = w[t];
  if (einheit !== 'kW') max = 100;
  let summe = 0, stunden = 0, spitze = 0;
  const q = m.deckung || m.kap ? null : m.reihe(r);
  if (q) for (let t = 0; t < N; t++) { summe += q[t]; if (q[t] > 0.05) stunden++; if (q[t] > spitze) spitze = q[t]; }

  const W = _breite(), PL = 46, PR = 4, PT = 4, zh = 11, PB = 20, H = PT + 24 * zh + PB;
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.aspectRatio = `${W} / ${H}`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const sw = (W - PL - PR) / tage, farbe = _rampe(m.farbe);
  for (let d = 0; d < tage; d++) {
    for (let h = 0; h < 24; h++) {
      ctx.fillStyle = farbe(max > 0 ? w[d * 24 + h] / max : 0);
      ctx.fillRect(PL + d * sw, PT + h * zh, Math.ceil(sw), zh);
    }
  }
  ctx.fillStyle = '#a09a88'; ctx.font = '10.5px sans-serif'; ctx.textAlign = 'right';
  for (const h of [0, 6, 12, 18]) ctx.fillText(`${h} Uhr`, PL - 4, PT + h * zh + 9);
  ctx.textAlign = 'center';
  const mStart = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const namen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  mStart.forEach((d, i) => ctx.fillText(namen[i], PL + (d + 15) * sw, H - 6));

  // Legende: Farbrampe + Kennzahlen der gewählten Größe
  const leg = document.getElementById('ah2-hm-legende');
  if (leg) {
    const stufen = Array.from({ length: 11 }, (_, i) => farbe(i / 10)).join(',');
    const kenn = q ? `${escHtml(m.label)}: ${b(_fmt(summe / 1000) + ' MWh/a')} in ${b(_fmt(stunden) + ' Stunden')}, Spitze ${_fmt(spitze)} kW` : '';
    leg.innerHTML = `<span>0</span><span style="display:inline-block;width:140px;height:9px;border-radius:2px;background:linear-gradient(90deg,${stufen});"></span>
      <span>${einheit === 'kW' ? _fmt(max) + ' kW' : '100 %'}</span><span style="margin-left:8px;">${kenn}</span>
      ${m.deckung ? `<span>Ziel ${_fmt(r.zielPct)} % · schlechteste Stunde ${_fmt(r.minDeckungPct, 1)} %</span>` : ''}`;
  }

  // Tooltip mit allen Flüssen der Stunde
  const tip = document.getElementById('ah2-hm-tip');
  cv.onmouseleave = () => { if (tip) tip.style.display = 'none'; };
  cv.onmousemove = ev => {
    if (!tip) return;
    const rect = cv.getBoundingClientRect(), sk = W / rect.width;
    const x = (ev.clientX - rect.left) * sk, y = (ev.clientY - rect.top) * sk;
    const d = Math.floor((x - PL) / sw), h = Math.floor((y - PT) / zh);
    if (d < 0 || d >= tage || h < 0 || h > 23) { tip.style.display = 'none'; return; }
    const t = d * 24 + h, R = r.bilanz.reihen, L = _erg.info.last[t];
    const kw = v => _fmt(v) + ' kW';
    const datum = new Date(2025, 0, 1 + d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const z = (f, txt, v) => v > 0.05 ? `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${f};margin-right:5px;"></i>${txt} ${kw(v)}</div>` : '';
    const ueber = r.batLad[t] + R.ely[t] + R.einsp[t] + R.abreg[t];
    tip.innerHTML = `<b style="color:var(--text);">${datum}, ${h}–${h + 1} Uhr</b> · Last ${kw(L)} · eigene Deckung ${_fmt(L > 0 ? (L - R.netz[t]) / L * 100 : 100)} %
      <div style="margin-top:3px;color:var(--muted);">Deckung</div>
      ${z(FARBE.direkt, 'Direkt', r.direkt[t])}${z(FARBE.bat, 'Batterie', r.batEntl[t])}${z(FARBE.bhkw, 'BHKW', R.bhkw[t])}${z(FARBE.h2, 'Brennstoffzelle', R.bz[t])}${z(FARBE.netz, 'Netz', R.netz[t])}
      ${ueber > 0.05 ? '<div style="margin-top:3px;color:var(--muted);">Überschuss</div>' : ''}
      ${z(FARBE.bat, 'Batterie laden', r.batLad[t])}${z('#9085e9', 'Elektrolyse', R.ely[t])}${z('#78909c', 'Einspeisung', R.einsp[t])}${z('#d55181', 'Abregelung', R.abreg[t])}
      <div style="margin-top:3px;color:var(--muted);">${r.ausl.batKwh > 0 ? `Batterie ${_fmt(r.batSoc[t] / r.ausl.batKwh * 100)} %` : ''}${r.ausl.tankKwh > 0 ? ` · H₂-Tank ${_fmt(R.tank[t] / r.ausl.tankKwh * 100)} %` : ''}</div>`;
    tip.style.display = 'block';
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    tip.style.left = Math.max(0, Math.min(px + 14, rect.width - tip.offsetWidth - 4)) + 'px';
    tip.style.top = (py + 14) + 'px';
  };
}

/** Varianten nebeneinander: nur H₂ / nur BHKW / Kombination (nur wenn es mehr als eine gibt) */
function _variantenHtml() {
  const V = _erg.varianten || {};
  const reihenfolge = ['pvbat', 'h2', 'bhkw', 'kombi'].filter(m => V[m]);
  if (reihenfolge.length < 2) {
    // Hinweis, warum eine Option fehlt
    const fehlt = [];
    if (_erg.cfg.h2Aktiv && !V.h2 && !V.pvbat) fehlt.push(_erg.cfg.tankMaxKg > 0
      ? `Nur Wasserstoff ist mit der Tank-Obergrenze von ${_fmt(_erg.cfg.tankMaxKg)} kg nicht machbar.`
      : 'Nur Wasserstoff ist nicht machbar (Überschuss reicht nicht).');
    return fehlt.length ? `<div class="ah2-karte" style="font-size:10.5px;color:#ffb74d;">${fehlt.map(escHtml).join(' ')}</div>` : '';
  }
  const bester = reihenfolge.reduce((m, k) => (!m || V[k].kosten.gesamt < V[m].kosten.gesamt ? k : m), null);
  const basisJk = _erg.basis?.kosten.gesamt;
  const zeilen = reihenfolge.map(m => {
    const v = V[m], a = v.ausl, k = v.kosten, bil = v.bilanz;
    const anlagen = [a.bzKw > 0 && `H₂ ${_fmt(a.elyKw)} / ${_fmt(a.tankKg)} kg / ${_fmt(a.bzKw)} kW`,
      a.bhkwKw > 0 && `BHKW ${_fmt(a.bhkwKw)} kW${a.bzKw > 0 ? (a.bhkwZuerst ? ' (Grundlast)' : ' (wenn Tank leer)') : ''}`].filter(Boolean).join(' + ') || '—';
    const genehm = a.tankKg >= 5000 ? 'Störfall-VO' : a.tankKg >= 3000 ? 'BImSchG (Lager)' : a.tankKg > 0 ? 'unter 3 t' : '—';
    const aktiv = v === _erg.best;
    return `<tr style="${aktiv ? 'background:rgba(212,168,85,.10);' : ''}">
      <td class="l">${m === bester ? '★ ' : ''}${escHtml(AH2_MODI[m])}</td>
      <td class="m">${_fmt(a.pvKwp)}</td><td class="m">${_fmt(a.batKwh)}</td><td class="l">${anlagen}</td>
      <td class="m">${_tEur(k.investGes)}</td><td class="m"><b>${_fmt(k.gesamt)}</b></td>
      <td class="m">${basisJk != null ? (k.gesamt - basisJk >= 0 ? '+' : '') + _fmt(k.gesamt - basisJk) : '—'}</td>
      <td class="m">${bil.bhkwBrennstoffMwh > 0.05 ? _fmt(bil.bhkwBrennstoffMwh) : '—'}</td>
      <td class="m">${_fmt(bil.autarkiePct, 1)} %</td><td class="l">${genehm}</td>
      <td>${aktiv ? '<span style="font-size:10px;color:var(--muted);">angezeigt</span>' : `<button class="ah2-knopf" data-ah2-variante="${m}">anzeigen</button>`}</td></tr>`;
  }).join('');
  return `<div class="ah2-karte"><b style="font-size:11px;">Varianten im Vergleich</b>
    <span style="font-size:10px;color:var(--muted);"> · jede Variante für sich kostenoptimal ausgelegt (PV, Batterie, Speicher), ★ = günstigste</span>
    <div style="overflow-x:auto;margin-top:6px;"><table><thead><tr><th class="l">Variante</th><th>PV kWp</th><th>Batterie kWh</th><th class="l">Wintertechnik</th>
      <th>Invest</th><th>Jahreskosten €/a</th><th>Preis des Ziels €/a</th><th>Brennstoff MWh/a</th><th>Autarkie</th><th class="l">Genehmigung Tank</th><th></th></tr></thead>
    <tbody>${zeilen}</tbody></table></div>
    ${_erg.cfg.h2Aktiv && !V.h2 && !V.pvbat ? `<div style="font-size:10.5px;color:#ffb74d;margin-top:4px;">${_erg.cfg.tankMaxKg > 0
      ? `„Nur Wasserstoff" fehlt: mit der Tank-Obergrenze von ${_fmt(_erg.cfg.tankMaxKg)} kg nicht machbar.`
      : '„Nur Wasserstoff" fehlt: der Überschuss reicht nicht für den nötigen Wasserstoff.'}</div>` : ''}
    <div style="font-size:10px;color:var(--muted);margin-top:4px;line-height:1.5;">Preis des Ziels = Jahreskosten gegenüber der günstigsten Auslegung ohne Ziel.
      Kombination: das Tool prüft einen begrenzten Tank mit BHKW als Reserve und das BHKW als Grundlast mit Wasserstoff für die Spitzen.
      Das BHKW verbrennt zugekauften biogenen Brennstoff — ob das als „eigene erneuerbare Erzeugung" zählt, legt die Zieldefinition fest.</div></div>`;
}

function _kostenHtml() {
  const r = _erg.best, a = r.ausl, k = r.kosten, cfg = _erg.cfg;
  const zeile = (name, groesse, inv, jk, detail = '') => `<tr><td class="l">${name}</td><td class="m">${groesse}</td>
    <td class="m">${inv != null ? _tEur(inv) : ''}</td><td class="m">${_fmt(jk)}</td><td class="l" style="color:var(--muted);">${detail}</td></tr>`;
  return `<div class="ah2-karte"><b style="font-size:11px;">Kosten der Auslegung</b>
    <table style="margin-top:4px;"><thead><tr><th class="l">Position</th><th>Größe</th><th>Invest</th><th>€/a</th><th class="l">Ansatz</th></tr></thead><tbody>
    ${zeile('PV', _fmt(a.pvKwp) + ' kWp', k.invest.pv, k.jk.pv, `${_fmt(cfg.pv.investKwp)} €/kWp · ${cfg.pv.life} a`)}
    ${k.jk.infra ? zeile('PV-Infrastruktur (Anschlussstufe)', '', null, k.jk.infra, 'wie PV-Analyse') : ''}
    ${zeile('Batterie', _fmt(a.batKwh) + ' kWh', k.invest.bat, k.jk.bat, `${_fmt(cfg.bat.investKwh)} €/kWh · ${cfg.bat.life} a`)}
    ${zeile('Elektrolyseur', _fmt(a.elyKw) + ' kW', k.invest.ely, k.jk.ely, `${_fmt(cfg.ely.investKw)} €/kW · ${cfg.ely.life} a`)}
    ${zeile('H₂-Tank', _mwh(a.tankKwh), k.invest.tank, k.jk.tank, `${_fmt(cfg.tank.investKwh, 1)} €/kWh · ${cfg.tank.life} a`)}
    ${zeile('Brennstoffzelle', _fmt(a.bzKw) + ' kW', k.invest.bz, k.jk.bz, `${_fmt(cfg.bz.investKw)} €/kW · ${cfg.bz.life} a`)}
    ${a.bhkwKw > 0 ? zeile('BHKW', _fmt(a.bhkwKw) + ' kW el.', k.invest.bhkw, k.jk.bhkw, `${_fmt(cfg.bhkw.investKw)} €/kW · ${cfg.bhkw.life} a`) : ''}
    ${a.bhkwKw > 0 ? zeile('BHKW-Brennstoff', _fmt(r.bilanz.bhkwBrennstoffMwh) + ' MWh', null, k.brennstoff, `${_fmt(cfg.bhkw.brennstoffCt, 1)} ct/kWh · η el. ${_fmt(cfg.bhkw.etaEl * 100)} %`) : ''}
    ${a.bhkwKw > 0 ? zeile('BHKW-Wartung', _fmt(r.bilanz.bhkwMwh) + ' MWh el.', null, k.wartung, `${_fmt(cfg.bhkw.wartungCt, 1)} ct/kWh`) : ''}
    ${zeile('Netzbezug', _fmt(r.bilanz.netzMwh) + ' MWh', null, k.netz, `${_fmt(cfg.preise.pStrom, 1)} ct/kWh`)}
    ${zeile('Einspeiseerlös', _fmt(r.bilanz.einspMwh) + ' MWh', null, -k.einsp, `${_fmt(cfg.preise.pEinsp, 1)} ct/kWh`)}
    ${k.waerme ? zeile('Abwärme', _fmt(r.bilanz.waermeMwh) + ' MWh', null, -k.waerme, `${_fmt(cfg.preise.pWaerme, 1)} ct/kWh`) : ''}
    <tr><td class="l"><b>Summe</b></td><td></td><td class="m"><b>${_tEur(k.investGes)}</b></td><td class="m"><b>${_fmt(k.gesamt)}</b></td>
      <td class="l" style="color:var(--muted);">Referenz nur Netz ${_fmt(k.referenz)} €/a</td></tr>
    </tbody></table>
    <div style="font-size:10px;color:var(--muted);margin-top:4px;">Jahreskosten = Annuität (Zins ${_fmt(cfg.zins * 100, 1)} %) + Instandhaltung + Brennstoff + Netzbezug − Erlöse. Die Optimierung minimiert diese Summe unter der Bedingung, dass das Ziel in jeder Stunde erfüllt ist.</div></div>`;
}

function _kurveHtml() {
  const P = _kurve.punkte, ok = P.filter(p => p.machbar);
  // Preis des Ziels = Jahreskosten gegenüber dem Punkt „Ziel 0 %" (wirtschaftlich beste Auslegung ohne Ziel)
  const p0 = P.find(p => p.zielPct === 0 && p.machbar);
  for (const p of ok) p.preis = p0 ? p.kostenJk - p0.kostenJk : null;
  const zeilen = P.map(p => p.machbar ? `<tr ${_erg?.best && p.zielPct === _erg.best.zielPct ? 'style="background:rgba(212,168,85,.09);"' : ''}>
      <td class="m">${p.zielPct} %</td><td class="m">${_fmt(p.pvKwp)}</td><td class="m">${_fmt(p.batKwh)}</td><td class="m">${_fmt(p.elyKw)}</td>
      <td class="m">${_mwh(p.tankKwh)}</td><td class="m">${_fmt(p.bzKw)}</td><td class="m">${p.bhkwKw > 0 ? _fmt(p.bhkwKw) : '—'}</td>
      <td class="l">${escHtml(AH2_MODI[p.modus] || '')}</td><td class="m">${_fmt(p.autarkiePct, 1)} %</td>
      <td class="m">${_fmt(p.kostenJk)}</td><td class="m" style="color:${p.mehrkosten > 0 ? '#e57373' : '#66bb6a'};">${p.mehrkosten >= 0 ? '+' : ''}${_fmt(p.mehrkosten)}</td>
      <td class="m">${p.preis != null ? (p.preis >= 0 ? '+' : '') + _fmt(p.preis) : '—'}</td></tr>`
    : `<tr><td class="m">${p.zielPct} %</td><td colspan="11" class="l" style="color:#ffb74d;">nicht erreichbar</td></tr>`).join('');
  let svg = '';
  if (ok.length > 1) {
    const W = _breite(), H = 280, PL = 70, PR = 12, PT = 12, PB = 26;
    const vals = ok.flatMap(p => [p.mehrkosten, p.preis ?? 0]);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    const x = z => PL + z / 80 * (W - PL - PR), y = v => PT + (1 - (v - lo) / span) * (H - PT - PB);
    const out = [];
    for (let i = 0; i <= 4; i++) {
      const v = lo + span * i / 4;
      out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="0.5"/>
        <text x="${PL - 6}" y="${y(v) + 3}" font-size="10.5" text-anchor="end" fill="var(--muted)">${_tEur(v)}</text>`);
    }
    out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1"/>`);
    for (const p of P) out.push(`<text x="${x(p.zielPct)}" y="${H - PB + 14}" font-size="10.5" text-anchor="middle" fill="var(--muted)">${p.zielPct} %</text>`);
    out.push(`<polyline points="${ok.map(p => `${x(p.zielPct)},${y(p.mehrkosten)}`).join(' ')}" fill="none" stroke="${FARBE.h2}" stroke-width="2"/>`);
    if (p0) out.push(`<polyline points="${ok.map(p => `${x(p.zielPct)},${y(p.preis)}`).join(' ')}" fill="none" stroke="${FARBE.direkt}" stroke-width="2"/>`
      + ok.map(p => `<circle cx="${x(p.zielPct)}" cy="${y(p.preis)}" r="3.5" fill="${FARBE.direkt}" stroke="var(--surface)" stroke-width="2"><title>${escHtml(`Ziel ${p.zielPct} %: Preis des Ziels ${p.preis >= 0 ? '+' : ''}${_fmt(p.preis)} €/a`)}</title></circle>`).join(''));
    for (const p of ok) {
      out.push(`<g><title>${escHtml(`Ziel ${p.zielPct} %: ${p.mehrkosten >= 0 ? '+' : ''}${_fmt(p.mehrkosten)} €/a gegenüber Netz\nTank ${_mwh(p.tankKwh)} · BZ ${_fmt(p.bzKw)} kW · PV ${_fmt(p.pvKwp)} kWp`)}</title>
        <circle cx="${x(p.zielPct)}" cy="${y(p.mehrkosten)}" r="9" fill="transparent"/>
        <circle cx="${x(p.zielPct)}" cy="${y(p.mehrkosten)}" r="4" fill="${FARBE.h2}" stroke="var(--surface)" stroke-width="2"/></g>`);
    }
    svg = _legende([[FARBE.h2, 'gegenüber reinem Netzbezug'], [FARBE.direkt, 'gegenüber der Auslegung ohne Ziel (Preis des Ziels)']])
      + `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;margin-top:2px;">${out.join('')}</svg>`;
  }
  return `<div class="ah2-karte"><b style="font-size:11px;">Zielkurve: Jahreskosten je Ziel im Vergleich</b>
    <span style="font-size:10px;color:var(--muted);"> · grobes Raster, ${_kurve.toleranzH} zulässige Stunden · unter der Nulllinie = günstiger als Netzbezug</span>
    ${svg}
    <div style="overflow-x:auto;margin-top:6px;"><table><thead><tr><th>Ziel</th><th>PV kWp</th><th>Batterie kWh</th><th>Elektrolyseur kW</th><th>Tank</th><th>BZ kW</th><th>BHKW kW</th><th class="l">Variante</th><th>Autarkie</th><th>€/a</th><th>ggü. Netz €/a</th><th>ggü. ohne Ziel €/a</th></tr></thead>
    <tbody>${zeilen}</tbody></table></div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// EREIGNISSE
// ══════════════════════════════════════════════════════════════════════════════

function _geaendert() {
  if (_erg?.best) _veraltet = true;
  _kurve = null;
}

function _ereignisse(root) {
  root.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.ah2Feld) {
      const v = parseFloat(t.value);
      if (t.dataset.ah2Feld === 'zielPct') _st.zielPct = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : AH2_STANDARD.zielPct;
      else if (t.dataset.ah2Feld === 'tankMaxKg') _st.tankMaxKg = Number.isFinite(v) && v > 0 ? v : 0;
      else _st.toleranzH = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
      _geaendert(); ah2Render(); return;
    }
    if (t.dataset.ah2Reserve != null && _erg?.opt) {
      if (!_man) _man = { ..._aktGroessen() };
      _man.batReserve = parseFloat(t.value) || 0;
      _manuellRechnen(); _teilAktualisieren(); return;
    }
    if (t.dataset.ah2Schalter) { _st[t.dataset.ah2Schalter] = t.checked; _geaendert(); ah2Render(); return; }
    if (t.dataset.ah2Brennstoff != null) {
      _st.bhkwBrennstoff = t.value;
      // Preis und Wirkungsgrade kommen aus der Vorlage des neuen Brennstoffs
      for (const k of ['brennstoffCt', 'etaEl', 'etaTh']) delete _st.bhkw[k];
      _geaendert(); ah2Render(); return;
    }
    if (t.dataset.ah2Hm) {
      if (t.dataset.ah2Hm === 'metrik') _hm.metrik = t.value; else _hm.anteil = t.checked;
      ah2Render(); return;
    }
    if (t.dataset.ah2Annahme) {
      const [g, k] = t.dataset.ah2Annahme.split('.');
      const def = ANNAHMEN.find(x => x[0] === g && x[1] === k);
      const f = def ? def[4] : 1;
      const v = parseFloat(t.value);
      if (!Number.isFinite(v) || v < 0 || Math.abs(v / f - _standardWert(g, k)) < 1e-9) delete _st[g][k];
      else _st[g][k] = v / f;
      _geaendert(); ah2Render();
    }
  });
  root.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.ah2Schieber == null || !_erg?.opt) return;
    if (!_man) _man = { ..._aktGroessen() };
    _man[t.dataset.ah2Schieber] = parseFloat(t.value) || 0;
    const def = _schieberDefs().find(d => d.k === t.dataset.ah2Schieber);
    const lbl = root.querySelector(`[data-ah2-wert="${t.dataset.ah2Schieber}"]`);
    if (lbl && def) {
      lbl.textContent = `${_fmt(_man[def.k])} ${def.einheit}`;
      lbl.style.color = def.k === 'tankKg' && _erg.cfg.tankMaxKg > 0 && _man.tankKg > _erg.cfg.tankMaxKg ? '#e57373' : 'var(--text)';
    }
    clearTimeout(_schieberTimer);
    _schieberTimer = setTimeout(() => {
      try { _manuellRechnen(); _teilAktualisieren(); }
      catch (err) { console.warn('[Autarkieziel] Nachrechnung fehlgeschlagen:', err); }
    }, 60);
  });
  root.addEventListener('click', ev => {
    const tb = ev.target.closest('[data-ah2-tab]');
    if (tb) { _tab = tb.dataset.ah2Tab; _teilAktualisieren(); return; }
    const g = ev.target.closest('[data-ah2-grenze]');
    if (g) { _st.tankMaxKg = +g.dataset.ah2Grenze; _geaendert(); ah2Render(); return; }
    const vw = ev.target.closest('[data-ah2-variante]');
    if (vw) { _varianteZeigen(vw.dataset.ah2Variante); ah2Render(); return; }
    const t = ev.target.closest('[data-ah2-aktion]');
    if (!t || t.disabled) return;
    const a = t.dataset.ah2Aktion;
    if (a === 'rechnen' || a === 'kurve') {
      _meldung = a === 'rechnen' ? 'Lege aus …' : 'Rechne Zielkurve …';
      ah2Render();
      setTimeout(() => {
        try { if (a === 'rechnen') ah2Rechnen(); else _kurveRechnen(); _meldung = ''; }
        catch (err) { console.warn('[Autarkieziel] Rechnung fehlgeschlagen:', err); _meldung = 'Rechnung fehlgeschlagen — Details in der Konsole.'; }
        ah2Render();
      }, 30);
      return;
    }
    if (a === 'annahmen') { _annahmenAuf = !_annahmenAuf; ah2Render(); return; }
    if (a === 'optimum' && _erg?.opt) {
      _man = null; _st.manuell = null; _erg.best = _erg.opt;
      if (_erg.inp) _erg.ohne = ah2OhneH2(_erg.inp, _erg.opt.ausl, _erg.einst);
      ah2Render(); return;
    }
    if (a === 'annahmen-standard') { _st.ely = {}; _st.bz = {}; _st.tank = {}; _st.bat = {}; _st.preise = {}; _st.bhkw = {}; _geaendert(); ah2Render(); return; }
    if (a === 'uebernehmen') ah2AnlagenUebernehmen();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ÜBERNAHME ALS ASSETS
// ══════════════════════════════════════════════════════════════════════════════

/** Anschlussknoten: erste aktive NSHV, sonst Trafo, sonst NAP. */
function _anschlussKnoten() {
  const aktiv = x => getAssetStatus(x) === 'active';
  for (const typ of ['NSHV', 'Trafo', 'NAP']) {
    const k = ASSETS.items.find(x => x.type === typ && aktiv(x) && Number.isFinite(x.lat));
    if (k) return k;
  }
  return null;
}

export function ah2AnlagenUebernehmen() {
  const r = _erg?.best;
  if (!r) return;
  const a = r.ausl;
  const knoten = _anschlussKnoten();
  const mitte = window.map?.getCenter?.();
  const pos = knoten ? { lat: knoten.lat, lng: knoten.lng } : mitte ? { lat: mitte.lat, lng: mitte.lng } : null;
  if (!pos) { window.showHint?.('Keine Karte / kein Netzknoten gefunden.', 4000); return; }
  const frueher = typ => ASSETS.items.find(x => x.type === typ && x.props?.autarkieZiel);
  const plan = [];
  if (a.batKwh > 0) plan.push({ typ: 'Batterie', name: 'Batterie Autarkieziel', dLat: 0.00008, dLng: -0.00008,
    props: { kapazitaetKWh: String(Math.round(a.batKwh)), leistungKW: String(Math.round(a.batKw)), betriebsmodus: 'einspeisung' } });
  if (a.bzKw > 0) plan.push({ typ: 'H2', name: 'H₂-Speicher Autarkieziel', dLat: 0.00008, dLng: 0.00008,
    props: { elektrolyseKW: String(Math.round(a.elyKw)), brennstoffzelleKW: String(Math.round(a.bzKw)),
             tankKg: String(Math.round(a.tankKg)), druckBar: String(a.druckBar) } });
  if (a.bhkwKw > 0) {
    const c = _erg.cfg.bhkw;
    plan.push({ typ: 'KWK', name: 'BHKW Autarkieziel', dLat: -0.00008, dLng: 0,
      props: { leistungElKW: String(Math.round(a.bhkwKw)), leistungThKW: String(Math.round(a.bhkwKw * c.etaTh / c.etaEl)),
               wirkungsgradEl: String(Math.round(c.etaEl * 100)),
               brennstoff: { biomethan: 'Biomethan', hvo: 'HVO', pflanzenoel: 'Pflanzenöl' }[a.bhkwBrennstoff] || 'Biomethan' } });
  }
  if (!plan.length) return;
  const text = plan.map(p => `${frueher(p.typ) ? 'anpassen' : 'anlegen'}: ${p.name} (${p.typ === 'H2'
    ? `Elektrolyseur ${p.props.elektrolyseKW} kW, Tank ${p.props.tankKg} kg, BZ ${p.props.brennstoffzelleKW} kW`
    : p.typ === 'KWK' ? `${p.props.leistungElKW} kW el. / ${p.props.leistungThKW} kW th., ${p.props.brennstoff}`
      : `${p.props.kapazitaetKWh} kWh / ${p.props.leistungKW} kW`})`).join('\n');
  // Früher übernommene Anlagen, die in dieser Variante nicht mehr vorkommen, bleiben stehen — nur Hinweis
  const uebrig = ['Batterie', 'H2', 'KWK'].filter(typ => frueher(typ) && !plan.some(q => q.typ === typ)).map(typ => frueher(typ).name);
  const rest = uebrig.length ? `\n\nAus einer früheren Übernahme bleiben bestehen (bei Bedarf von Hand löschen): ${uebrig.join(', ')}.` : '';
  if (!confirm(`${text}${rest}\n\n${knoten ? `Neue Anlagen werden per Kabel an „${knoten.name}" angeschlossen.` : 'Kein Netzknoten gefunden — neue Anlagen landen in der Kartenmitte ohne Anschluss.'}`)) return;
  const neu = [];
  for (const p of plan) {
    const x = frueher(p.typ);
    if (x) { Object.assign(x.props, p.props); continue; }
    const asset = createAsset(p.typ, pos.lat + p.dLat, pos.lng + p.dLng, {
      name: p.name, buildingId: knoten?.buildingId ?? null, props: { ...p.props, autarkieZiel: `${_st.zielPct}` },
    });
    if (asset) neu.push(asset);
  }
  redrawAllAssets();
  if (knoten) for (const x of neu) addStromEdge(x.id, knoten.id);
  recalcStromNetz();
  window.showHint?.(`${neu.length} Anlage(n) angelegt, ${plan.length - neu.length} angepasst`, 4000);
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJEKTDATEI
// ══════════════════════════════════════════════════════════════════════════════

export function ah2Einstellungen() {
  return JSON.parse(JSON.stringify(_st));
}

export function ah2EinstellungenSetzen(d) {
  const std = _standard();
  const obj = x => (x && typeof x === 'object' ? { ...x } : {});
  const zahl = (v, def) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : def);
  const l = d?.letzte;
  const groessen = x => x && ['pvKwp', 'batKwh', 'elyKw', 'bzKw', 'tankKwh'].every(k => Number.isFinite(+x[k]))
    ? { pvKwp: +x.pvKwp, batKwh: +x.batKwh, batReserve: zahl(x.batReserve, 0), elyKw: +x.elyKw, bzKw: +x.bzKw, tankKwh: +x.tankKwh,
        bhkwKw: zahl(x.bhkwKw, 0), bhkwZuerst: !!x.bhkwZuerst, modus: typeof x.modus === 'string' ? x.modus : undefined }
    : null;
  const variantenLetzte = {};
  for (const [m, g] of Object.entries(obj(d?.variantenLetzte))) { const x = groessen(g); if (AH2_MODI[m] && x) variantenLetzte[m] = x; }
  _st = {
    ...std,
    zielPct: Math.min(100, Math.max(0, zahl(d?.zielPct, std.zielPct))),
    toleranzH: Math.max(0, Math.round(zahl(d?.toleranzH, std.toleranzH))),
    ely: obj(d?.ely), bz: obj(d?.bz), tank: obj(d?.tank), bat: obj(d?.bat), preise: obj(d?.preise), bhkw: obj(d?.bhkw),
    h2Aktiv: d?.h2Aktiv !== false, bhkwAktiv: d?.bhkwAktiv === true,
    bhkwBrennstoff: AH2_BRENNSTOFFE[d?.bhkwBrennstoff] ? d.bhkwBrennstoff : std.bhkwBrennstoff,
    tankMaxKg: Math.max(0, zahl(d?.tankMaxKg, 0)),
    letzte: groessen(l),
    basisLetzte: groessen(d?.basisLetzte),
    variantenLetzte: Object.keys(variantenLetzte).length ? variantenLetzte : null,
    manuell: d?.manuell && typeof d.manuell === 'object'
      ? Object.fromEntries(['pvKwp', 'batKwh', 'batReserve', 'elyKw', 'tankKg', 'bzKw', 'bhkwKw'].map(k => [k, Math.max(0, zahl(d.manuell[k], 0))]))
      : null,
  };
  _erg = null; _kurve = null; _veraltet = false; _meldung = ''; _man = null;
  if (document.getElementById(ROOT_ID)?.style.display === 'block') ah2Render();
}

window.ah2Render = ah2Render;
window.ah2Einstellungen = ah2Einstellungen;
window.ah2EinstellungenSetzen = ah2EinstellungenSetzen;
