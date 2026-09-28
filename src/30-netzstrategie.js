// ── 30-netzstrategie.js — Netzstrategie-Editor der PV-Analyse ────────────────
//
// Ansicht „Netzstrategie (Editor)": Die Dächer im Zieljahr werden zu Flächen-
// gruppen zusammengefasst (Bestand und Neubau getrennt; räumlich nach Abstand
// oder nach den Liegenschafts-Clustern). Je Gruppe gibt es Anschlusswege —
// nicht belegen, Bestandsnetz, Bestandsnetz mit Abregelung, mit Ertüchtigung,
// neuer NS-Abgang, neue Station am MS-Ring, Erzeugungsnetz mit eigenem MS-Abgang
// (lib/netzstrategie-core.js). Alle Wege liegen hinter demselben NAP.
//
// „Strategien rechnen" bewertet die Kombinationen (Netz → stündliche Energie-
// bilanz → Jahres-Netto-Überschuss), zeigt die Pareto-Front Netz-Invest ↔ nutzbare
// Energie, sechs Standardstrategien und eine über Preis-/Kostenszenarien geprüfte
// Empfehlung. Im Editor lässt sich je Gruppe der Weg von Hand wählen; jede
// Strategie kann als Variante „Netzstrategie: …" in die PV-Analyse übernommen
// werden (09d, window._pvAnalyse.netzStrategien).
//
// Kosten kommen aus einem im Projekt editierbaren Kostenkatalog. Eingaben werden
// über pvCaptureState/pvRestoreState (09d) unter pvAnalyse.netzstrategie gespeichert.

import { pvnaEinstellungen, pvnaJahre, pvnaKabelNeu, pvnaLetztesNeubaujahr, pvnaModell, pvnaProfilForm } from './28-pv-netzaufnahme.js';
import {
  NS_KOSTEN_STANDARD, NS_SZENARIEN, nsBewerten, nsBreakEven, nsKostenMischen, nsOptimieren, nsOptionen,
  nsPareto, nsRobustheit, nsZielwert, nsGruppieren,
} from './lib/netzstrategie-core.js';
import { pvOrientationMix } from './09a-pv-profile.js';
import { clusters, clusterFuerGebaeude } from './14f-cluster-core.js';
import { OPT_INVEST_DEFAULT, OPT_IH } from './config/optimizer-defaults.js';
import { escHtml } from './03c-gebaeude-io.js';

const ROOT_ID = 'pva-netzstrategie';
const OPT_FARBE = { '0': '#8a8f8a', A: '#66bb6a', 'A~': '#9ccc65', B: '#4fc3f7', C: '#ffb300', D: '#ab47bc', E: '#e040fb' };

// Eingaben (Projektdatei) — Jahre unabhängig vom Jahresschieber
const _standard = () => ({
  stichjahr: null, zieljahr: null, quelle: 'aktiv', gruppierung: 'auto', abstandM: 120,
  ziel: { art: 'wirtschaft', budgetEUR: 250000, kwp: 500 },
  kosten: {},                 // nur Abweichungen vom Standardkatalog
  wahl: {},                   // Editor: Gruppenschlüssel → Options-ID
});
let _ns = _standard();
let _erg = null;              // letzter Rechenlauf
let _editor = null;           // Bewertung der Editor-Auswahl
let _editorWahl = null;       // [Optionsindex je Gruppe]
let _veraltet = false;        // Eingaben seit dem Rechenlauf geändert
let _katalogAuf = false;
let _offen = new Set();       // aufgeklappte Gruppen im Editor
let _karte = null;            // Leaflet-LayerGroup der Kartendarstellung
let _meldung = '';

const _fmt = (x, d = 0) => (x == null || !Number.isFinite(x)) ? '—'
  : x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const _tEur = x => _fmt(x / 1000, x >= 100000 ? 0 : 1) + ' T€';

// ══════════════════════════════════════════════════════════════════════════════
// EINGANGSDATEN
// ══════════════════════════════════════════════════════════════════════════════

function _jahre() {
  const stich = pvnaJahre({ stichjahr: _ns.stichjahr }).stich;
  const ziel = Math.max(stich, parseInt(_ns.zieljahr) || pvnaLetztesNeubaujahr(stich) || stich);
  return { stich, ziel };
}

/** Lastgang stündlich (8760) aus dem Lastgang der PV-Analyse; 15-min wird gemittelt. */
function _lastStuendlich() {
  const a = window.pvGetDemandH?.() || window.elQuartierH15 || window.elQuartierH;
  if (!a || a.length < 8760) return null;
  const out = new Float32Array(8760);
  if (a.length >= 35040) {
    for (let h = 0; h < 8760; h++) out[h] = ((a[4 * h] || 0) + (a[4 * h + 1] || 0) + (a[4 * h + 2] || 0) + (a[4 * h + 3] || 0)) / 4;
  } else {
    for (let h = 0; h < 8760; h++) out[h] = a[h] || 0;
  }
  return out;
}

/** NAP-Einspeisegrenze wie in der PV-Analyse (Feld zuerst, 0/leer = keine Grenze). */
function _napGrenze() {
  for (const id of ['pva-nap-einsp', 'strom-nap-einsp-kw']) {
    const el = document.getElementById(id);
    if (el && el.value !== '') { const v = parseFloat(el.value); return v > 0 ? v : null; }
  }
  return window.elNapMaxEinspKw > 0 ? window.elNapMaxEinspKw : null;
}

/** Wirtschaftsparameter aus der PV-Analyse (gleiche Felder und Standardwerte wie 09d). */
function _preise(kosten) {
  const v = (id, d) => { const x = parseFloat(document.getElementById(id)?.value); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    pStrom: v('pva-p-strom', 30), pEinsp: v('pva-p-einsp', 8), pvInvestPerKwp: v('pva-pv-invest', OPT_INVEST_DEFAULT.pv),
    zins: v('pva-zins', 3.5) / 100, pvLife: v('pva-pv-life', 20), ihPv: OPT_IH.pv ?? 0.01, netzLife: kosten.netzLebensdauer,
  };
}

/** Flächengruppen: Bestand und Neubau getrennt, räumlich bzw. nach Clustern. */
function _gruppenBilden(modell) {
  const { eingabe, info } = modell;
  const gebById = new Map((window.gebaeude || []).map(g => [g.id, g]));
  const gruppen = [];
  for (const klasse of ['bestand', 'neu']) {
    const liste = eingabe.daecher.filter(d => !!info.dachInfo.get(d.id)?.neu === (klasse === 'neu'));
    if (!liste.length) continue;
    const punkt = d => ({ id: d.id, pos: info.dachInfo.get(d.id)?.pos || null });
    let buckets = [];
    if (_ns.gruppierung === 'cluster' && clusters.length) {
      const m = new Map(), rest = [];
      for (const d of liste) {
        const g = gebById.get(info.dachInfo.get(d.id)?.gebId);
        const c = g ? clusterFuerGebaeude(g) : null;
        if (!c) { rest.push(d); continue; }
        if (!m.has(c.id)) m.set(c.id, { name: c.name, ids: [] });
        m.get(c.id).ids.push(d.id);
      }
      buckets = [...m.values()];
      for (const ids of nsGruppieren(rest.map(punkt), _ns.abstandM)) buckets.push({ ids });
    } else {
      buckets = nsGruppieren(liste.map(punkt), _ns.abstandM).map(ids => ({ ids }));
    }
    for (const b of buckets) {
      const ids = [...b.ids].sort();
      const namen = ids.map(id => info.dachInfo.get(id)?.name || id);
      const kwpMax = ids.reduce((t, id) => t + (eingabe.daecher.find(d => d.id === id)?.kwpMax || 0), 0);
      gruppen.push({
        id: 'g' + gruppen.length, key: `${klasse}:${ids[0]}:${ids.length}`, klasse, daecher: ids, namen, kwpMax,
        label: b.name || (namen[0] + (namen.length > 1 ? ` + ${namen.length - 1}` : '')),
      });
    }
  }
  return gruppen;
}

// ══════════════════════════════════════════════════════════════════════════════
// RECHNEN
// ══════════════════════════════════════════════════════════════════════════════

const STANDARD = [
  { key: 'S0', label: 'Bestandsnetz ohne Maßnahmen', kurz: 'Bestand', wege: { bestand: ['A'], neu: ['A'] } },
  { key: 'S1', label: 'Bestandsnetz mit Ertüchtigung', kurz: 'Ertüchtigung', wege: { bestand: ['B', 'A'], neu: ['B', 'A'] } },
  { key: 'S2', label: 'Nur Neubau (Bestandsnetz)', kurz: 'Nur Neubau', wege: { bestand: ['0'], neu: ['A'] }, mitNeu: true },
  { key: 'S3', label: 'Nur Neubau im Erzeugungsnetz', kurz: 'Neubau EN', wege: { bestand: ['0'], neu: ['E', 'D', 'A'] }, mitNeu: true },
  { key: 'S4', label: 'Hybrid: Bestand + Erzeugungsnetz für Neubau', kurz: 'Hybrid', wege: { bestand: ['A'], neu: ['E', 'D', 'A'] }, mitNeu: true },
  { key: 'S5', label: 'Alles voll belegen + Abregelung', kurz: 'Voll + Abregelung', wege: { bestand: ['A~', 'A'], neu: ['A~', 'A'] } },
];

/** Erster machbarer Weg aus der Liste — sonst „nicht belegen" (Option 0). */
function _waehle(optionen, g, ids) {
  for (const id of ids) {
    const i = optionen[g].findIndex(o => o.id === id && o.machbar !== false);
    if (i >= 0) return i;
  }
  return 0;
}

export function nsRechnen() {
  _meldung = '';
  const { stich, ziel } = _jahre();
  const na = pvnaEinstellungen();
  const modell = pvnaModell({ ...na, flaechen: 'alle', quelle: _ns.quelle, stichjahr: stich, zieljahr: ziel });
  const { eingabe, info } = modell;
  if (!eingabe.elemente.some(e => e.typ === 'trafo')) { _erg = { fehler: `Kein aktiver Trafo im Zieljahr ${ziel} — ohne Netz keine Strategie.` }; return _erg; }
  if (!eingabe.daecher.length) { _erg = { fehler: 'Keine PV-Flächen im Zieljahr — Gebäuden PV zuweisen oder „Dachflächen: alle Dächer" wählen.' }; return _erg; }
  const t0 = performance.now();
  const kosten = nsKostenMischen(_ns.kosten);
  const gruppen = _gruppenBilden(modell);
  const k = { cosPhi: info.cosPhi, kIz: info.kIz, tLeiter: info.tLeiter, I_je_kW: info.I_je_kW };
  const octx = {
    eingabe, dachPos: new Map([...info.dachInfo].map(([id, di]) => [id, di.pos || null])),
    elPos: info.elPos, msPunkte: info.msPunkte, kosten, duGrenzePct: eingabe.duGrenzePct,
    kabelNeu: (p, L, du) => pvnaKabelNeu(p, L, du, k),
  };
  const optionen = gruppen.map(g => nsOptionen(g, octx));
  const ectx = {
    formen: { sued: pvnaProfilForm(false), ostwest: pvnaProfilForm(true) },
    spezSued: pvOrientationMix().spezSued || 950,
    ostwest: new Map([...info.dachInfo].map(([id, di]) => [id, !!di.ostwest])),
    lastH: _lastStuendlich(), napKw: _napGrenze(),
  };
  const p = _preise(kosten);
  const zielDef = { ..._ns.ziel };
  const bewerte = w => {
    const r = nsBewerten(eingabe, optionen, w, ectx, p);
    r.zielwert = nsZielwert(r, zielDef);
    r.kwpJeDach = new Map(r.fuell.daecher.map(d => [d.id, d.kwp]));
    r.fuell = null;
    return r;
  };
  const mitNeu = gruppen.some(g => g.klasse === 'neu');
  const standardWahl = STANDARD.filter(s => !s.mitNeu || mitNeu)
    .map(s => ({ ...s, wahl: gruppen.map((g, i) => _waehle(optionen, i, s.wege[g.klasse])) }));
  const opt = nsOptimieren({ nOpt: optionen.map(l => l.length), bewerte, starts: standardWahl.map(s => s.wahl),
    maxKombi: 3000, maxBewertungen: 5000 });
  const cache = new Map(opt.alle.map(r => [r.wahl.join(','), r]));
  const holen = w => cache.get(w.join(',')) || (() => { const r = bewerte(w); cache.set(w.join(','), r); return r; })();
  const standard = standardWahl.map(s => ({ ...s, r: holen(s.wahl) }));
  const alle = [...cache.values()];
  const machbar = alle.filter(r => r.machbar);
  const pareto = nsPareto(machbar, r => [r.investEUR, r.energie.nutzbarMwh]);

  // Empfehlung: beim wirtschaftlichen Ziel über Szenarien geprüft (geringstes
  // maximales Bedauern unter den besten Kandidaten), sonst die beste Strategie.
  let rob = null, empfehlung = opt.beste;
  if (zielDef.art === 'wirtschaft') {
    const kand = [];
    const gesehen = new Set();
    const dazu = r => { const k2 = r.wahl.join(','); if (r.machbar && !gesehen.has(k2)) { gesehen.add(k2); kand.push(r); } };
    [...machbar].sort((a, b) => b.zielwert - a.zielwert).slice(0, 8).forEach(dazu);
    standard.forEach(s => dazu(s.r));
    rob = nsRobustheit(kand, p);
    if (rob.empfehlung) empfehlung = rob.empfehlung.kandidat;
  }
  _erg = { modell, gruppen, optionen, ectx, p, kosten, opt, standard, pareto, rob, empfehlung, alle, holen, ziel: zielDef,
    jahre: { stich, ziel }, dauerMs: performance.now() - t0 };
  _veraltet = false;
  // Editor: gespeicherte Auswahl je Gruppe, sonst die Empfehlung
  _editorWahl = gruppen.map((g, i) => {
    const id = _ns.wahl?.[g.key];
    const j = id != null ? optionen[i].findIndex(o => o.id === id) : -1;
    return j >= 0 ? j : empfehlung.wahl[i];
  });
  _editor = holen(_editorWahl);
  return _erg;
}

function _editorSetzen(wahl, merken = true) {
  _editorWahl = [...wahl];
  _editor = _erg.holen(_editorWahl);
  if (merken) {
    _ns.wahl = {};
    _erg.gruppen.forEach((g, i) => { _ns.wahl[g.key] = _erg.optionen[i][_editorWahl[i]].id; });
  }
  if (_karte) _karteZeichnen();
}

// ══════════════════════════════════════════════════════════════════════════════
// DARSTELLUNG
// ══════════════════════════════════════════════════════════════════════════════

const _kn = (akt, txt, tip = '', betont = false, extra = '') =>
  `<button class="${betont ? 'btn-confirm' : 'ns-knopf'}" data-ns-aktion="${akt}" title="${escHtml(tip)}" ${extra}>${txt}</button>`;

function _cssEinmal() {
  if (document.getElementById('ns-css')) return;
  const st = document.createElement('style');
  st.id = 'ns-css';
  st.textContent = `
  #${ROOT_ID} .ns-knopf{font-size:10.5px;padding:3px 9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;}
  #${ROOT_ID} .ns-karte{background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:9px 12px;margin-bottom:10px;}
  #${ROOT_ID} table{border-collapse:collapse;width:100%;font-size:10.5px;}
  #${ROOT_ID} th{font-weight:500;color:var(--muted);text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);white-space:nowrap;}
  #${ROOT_ID} th.l,#${ROOT_ID} td.l{text-align:left;}
  #${ROOT_ID} td{padding:3px 6px;text-align:right;border-bottom:1px solid rgba(128,128,128,.12);white-space:nowrap;}
  #${ROOT_ID} td.m{font-family:'DM Mono',monospace;}
  #${ROOT_ID} .ns-in{width:100%;padding:4px 6px;font-size:11px;box-sizing:border-box;}
  #${ROOT_ID} .ns-lbl{display:block;color:var(--muted);font-size:10px;margin-bottom:3px;}`;
  document.head.appendChild(st);
}

export function nsRender() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  _cssEinmal();
  const { stich, ziel } = _jahre();
  const neuJahr = pvnaLetztesNeubaujahr(stich);
  root.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
    <div style="font-size:12px;font-weight:600;">Netzstrategie — Anschlusswege je Flächengruppe</div>
    <div style="font-size:10px;color:var(--muted);">Alle Wege hinter demselben Netzanschlusspunkt · Physik wie Netzaufnahme/Einlinienschema</div>
  </div>
  <div style="font-size:10.5px;color:var(--muted);line-height:1.5;margin-bottom:10px;">
    Die Dächer im Zieljahr werden zu Gruppen zusammengefasst (Bestand und Neubau getrennt). Je Gruppe:
    <b style="color:${OPT_FARBE.A};">Bestandsnetz</b>, <b style="color:${OPT_FARBE['A~']};">voll + Abregelung</b>,
    <b style="color:${OPT_FARBE.B};">mit Ertüchtigung</b>, <b style="color:${OPT_FARBE.C};">neuer NS-Abgang</b>,
    <b style="color:${OPT_FARBE.D};">neue Station am MS-Ring</b>, <b style="color:${OPT_FARBE.E};">Erzeugungsnetz</b> (eigener MS-Abgang an der Schaltanlage)
    oder nicht belegen. Bewertet wird stündlich mit Lastgang, NAP-Einspeisegrenze und den Preisen der PV-Analyse.</div>

  <div class="ns-karte" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">
    <div style="flex:0 1 90px;"><span class="ns-lbl" title="Was bis dahin gebaut ist, gilt als Bestand. Leer = aktuelles Jahr.">Stichjahr</span>
      <input class="ns-in" data-ns-feld="stichjahr" type="number" step="1" value="${_ns.stichjahr ?? ''}" placeholder="${stich}"></div>
    <div style="flex:0 1 90px;"><span class="ns-lbl" title="Rechenjahr: Netz und Gebäude in diesem Jahr. Leer = letztes geplantes Baujahr.">Zieljahr</span>
      <input class="ns-in" data-ns-feld="zieljahr" type="number" step="1" value="${_ns.zieljahr ?? ''}" placeholder="${neuJahr ?? stich}"></div>
    <div style="flex:0 1 190px;"><span class="ns-lbl">PV-Flächen</span>
      <select class="ns-in" data-ns-feld="quelle">
        <option value="aktiv" ${_ns.quelle === 'aktiv' ? 'selected' : ''}>Gebäude mit aktiver PV + PV-Anlagen</option>
        <option value="alle" ${_ns.quelle === 'alle' ? 'selected' : ''}>alle Dächer (Dachpotenzial)</option></select></div>
    <div style="flex:0 1 150px;"><span class="ns-lbl">Gruppen</span>
      <select class="ns-in" data-ns-feld="gruppierung">
        <option value="auto" ${_ns.gruppierung === 'auto' ? 'selected' : ''}>räumlich (Abstand)</option>
        <option value="cluster" ${_ns.gruppierung === 'cluster' ? 'selected' : ''} ${clusters.length ? '' : 'disabled'}>Liegenschafts-Cluster${clusters.length ? '' : ' (keine)'}</option></select></div>
    <div style="flex:0 1 90px;"><span class="ns-lbl" title="Dächer, die über eine Kette von Nachbarn höchstens so weit auseinander liegen, bilden eine Gruppe">Abstand m</span>
      <input class="ns-in" data-ns-feld="abstandM" type="number" min="10" step="10" value="${_ns.abstandM}"></div>
    <div style="flex:0 1 230px;"><span class="ns-lbl">Ziel der Empfehlung</span>
      <select class="ns-in" data-ns-feld="ziel.art">
        <option value="wirtschaft" ${_ns.ziel.art === 'wirtschaft' ? 'selected' : ''}>höchster Jahres-Netto-Überschuss</option>
        <option value="budget" ${_ns.ziel.art === 'budget' ? 'selected' : ''}>meiste Energie im Netz-Budget</option>
        <option value="zielkwp" ${_ns.ziel.art === 'zielkwp' ? 'selected' : ''}>Ziel-kWp wirtschaftlich erreichen</option></select></div>
    ${_ns.ziel.art === 'budget' ? `<div style="flex:0 1 110px;"><span class="ns-lbl">Netz-Budget €</span>
      <input class="ns-in" data-ns-feld="ziel.budgetEUR" type="number" min="0" step="10000" value="${_ns.ziel.budgetEUR}"></div>` : ''}
    ${_ns.ziel.art === 'zielkwp' ? `<div style="flex:0 1 100px;"><span class="ns-lbl">Ziel kWp</span>
      <input class="ns-in" data-ns-feld="ziel.kwp" type="number" min="0" step="10" value="${_ns.ziel.kwp}"></div>` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${_kn('rechnen', _erg && !_erg.fehler ? '↻ Strategien neu rechnen' : '▶ Strategien rechnen', 'Alle Kombinationen bewerten, Pareto-Front und Empfehlung bilden', true, 'style="padding:6px 14px;font-size:11px;"')}
      ${_kn('katalog', _katalogAuf ? '▾ Kostenkatalog' : '▸ Kostenkatalog', 'Kostenansätze für neue Anschlüsse, Stationen und MS-Trassen')}
    </div>
    ${ziel > stich ? '' : `<div style="flex-basis:100%;font-size:10px;color:#ffb74d;">Zieljahr = Stichjahr: es gibt keine Neubau-Gruppen${neuJahr ? ` — Zieljahr ≥ ${neuJahr} setzen` : ''}.</div>`}
  </div>
  ${_katalogAuf ? _katalogHtml() : ''}
  ${_veraltet ? '<div style="margin:-4px 0 10px;font-size:10.5px;color:#ffb74d;">Eingaben geändert — Strategien neu rechnen.</div>' : ''}
  ${_meldung ? `<div style="margin:-4px 0 10px;font-size:10.5px;color:#80cbc4;">${_meldung}</div>` : ''}
  <div data-ns-ergebnis style="${_veraltet ? 'opacity:.55;' : ''}">${_ergebnisHtml()}</div>`;
  if (!root.dataset.nsEreignisse) { root.dataset.nsEreignisse = '1'; _ereignisse(root); }
}

function _katalogHtml() {
  const k = nsKostenMischen(_ns.kosten);
  const zeilen = Object.entries(NS_KOSTEN_STANDARD).map(([key, v]) => {
    const abw = _ns.kosten[key] != null && +_ns.kosten[key] !== v.wert;
    return `<tr><td class="l">${escHtml(v.label)}</td>
      <td><input data-ns-kosten="${key}" type="number" step="any" min="0" value="${k[key]}" style="width:90px;font-size:10.5px;text-align:right;${abw ? 'color:#ffb74d;' : ''}"></td>
      <td class="l" style="color:var(--muted);">${v.einheit}</td>
      <td class="l" style="color:var(--muted);">${abw ? `Standard ${_fmt(v.wert, v.wert % 1 ? 2 : 0)}` : ''}</td></tr>`;
  }).join('');
  return `<div class="ns-karte">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
      <b style="font-size:11px;">Kostenkatalog (im Projekt gespeichert)</b>
      ${_kn('katalog-standard', 'Standardwerte', 'Alle Abweichungen zurücksetzen')}</div>
    <table><thead><tr><th class="l">Position</th><th>Wert</th><th class="l"></th><th class="l"></th></tr></thead><tbody>${zeilen}</tbody></table>
    <div style="font-size:10px;color:var(--muted);margin-top:4px;line-height:1.5;">Neue NS-Kabel werden automatisch ausgelegt (NAYY, bis 4 × 240 mm²), ihr Materialpreis kommt aus der Kabeltabelle.
      Die Nutzungsdauer gilt für alle Netzmaßnahmen der PV-Analyse (Ertüchtigung, Fahrplanstufen, Netzstrategien). Orange = vom Standard abweichend.</div></div>`;
}

function _ergebnisHtml() {
  if (!_erg) return `<div style="color:var(--muted);font-size:11px;text-align:center;padding:30px 0;">„Strategien rechnen" starten.</div>`;
  if (_erg.fehler) return `<div style="color:#ffb74d;font-size:11px;padding:10px 0;">${escHtml(_erg.fehler)}</div>`;
  return `${_empfehlungHtml()}
  <div class="ns-karte"><b style="font-size:11px;">Pareto-Front: Netz-Invest ↔ nutzbare Energie</b>
    <span style="font-size:10px;color:var(--muted);"> · jeder Punkt eine bewertete Strategie, obere Kante = effizient · Marke anklicken lädt die Strategie in den Editor</span>
    ${_paretoSvg()}</div>
  ${_vergleichHtml()}
  ${_editorHtml()}`;
}

function _empfehlungHtml() {
  const e = _erg.empfehlung;
  const { gruppen, optionen, rob, opt } = _erg;
  const wege = new Map();
  e.wahl.forEach((w, i) => {
    const o = optionen[i][w];
    if (!wege.has(o.id)) wege.set(o.id, { label: o.id === '0' ? 'nicht belegen' : o.kurz, gruppen: [] });
    wege.get(o.id).gruppen.push(gruppen[i]);
  });
  const wegText = [...wege.entries()].map(([id, x]) => `<span style="color:${OPT_FARBE[id]};">■</span> <b>${escHtml(x.label)}</b>: `
    + x.gruppen.map(g => `${escHtml(g.label)} <span style="color:var(--muted);">(${g.klasse === 'neu' ? 'Neubau' : 'Bestand'}, ${_fmt(g.kwpMax)} kWp)</span>`).join(', ')).join('<br>');
  const zielTxt = { wirtschaft: 'höchster Jahres-Netto-Überschuss', budget: `meiste nutzbare Energie bei höchstens ${_tEur(_erg.ziel.budgetEUR)} Netz-Invest`,
    zielkwp: `wirtschaftlich beste Strategie mit mindestens ${_fmt(_erg.ziel.kwp)} kWp` }[_erg.ziel.art];
  const robT = rob?.empfehlung ? (() => {
    const t = rob.empfehlung;
    const n = NS_SZENARIEN.length;
    return `Robust geprüft über ${n} Szenarien (Strompreis ±20 %, Vergütung −30 %, Netzkosten ±30 %, PV-Invest +20 %): in <b>${t.vorn} von ${n}</b> vorn, `
      + `größtes Bedauern ${_fmt(t.maxBedauern)} €/a${e !== opt.beste ? ` — die Basis-Bestwerte hätte „${_strategieName(opt.beste)}" (${_fmt(opt.beste.wirt.ueberschuss)} €/a), ist aber weniger robust` : ''}.`;
  })() : '';
  const hinweise = [];
  if (!_erg.ectx.lastH) hinweise.push('Kein Stromlastgang — ohne Eigenverbrauch gerechnet (nur Einspeisevergütung). Lastgang in der PV-Analyse laden.');
  if (e.energie.kwp < 0.5 && _erg.ziel.art === 'wirtschaft') {
    hinweise.push('Unter den aktuellen Preisen trägt sich keine Belegung wirtschaftlich (jeder Ausbau senkt den Überschuss). '
      + 'Für einen Ausbaupfad das Ziel „meiste Energie im Netz-Budget" oder „Ziel-kWp" wählen — oder Preise/Lastgang prüfen.');
  }
  if (_erg.ectx.napKw) hinweise.push(`NAP-Einspeisegrenze ${_fmt(_erg.ectx.napKw)} kW gilt für alle Wege gemeinsam (Erzeugungsnetz liegt hinter demselben NAP).`);
  const unb = e.wahl.map((w, i) => optionen[i][w]).filter(o => o.hinweis).map(o => o.hinweis);
  if (unb.length) hinweise.push(...new Set(unb));
  return `<div class="ns-karte" style="border-left:3px solid var(--accent);">
    <div style="font-size:12px;line-height:1.55;">
      <b>Empfehlung:</b> ${escHtml(_strategieName(e))} — ${b(_fmt(e.energie.kwp) + ' kWp')}, ${b(_fmt(e.energie.nutzbarMwh) + ' MWh/a')} nutzbar,
      Netz-Invest ${b(_tEur(e.investEUR))}, Jahres-Netto-Überschuss ${b(_fmt(e.wirt.ueberschuss) + ' €/a')}.</div>
    <div style="font-size:10.5px;color:var(--muted);margin-top:4px;line-height:1.55;">Kriterium: ${zielTxt}. ${robT}</div>
    <div style="font-size:10.5px;margin-top:6px;line-height:1.6;">${wegText}</div>
    ${hinweise.length ? `<div style="font-size:10px;color:#ffb74d;margin-top:5px;line-height:1.5;">${hinweise.map(h => '⚠ ' + escHtml(h)).join('<br>')}</div>` : ''}
    <div style="font-size:10px;color:var(--muted);margin-top:5px;">${_erg.gruppen.length} Gruppen · ${_fmt(opt.kombinationen)} Kombinationen, ${_fmt(opt.bewertungen)} bewertet (${opt.methode}) · `
      + `${_fmt(_erg.dauerMs / 1000, 1)} s · Rechenjahr ${_erg.jahre.ziel}, Neubau = gebaut nach ${_erg.jahre.stich}</div>
    <div style="margin-top:6px;">${_kn('empf-editor', 'In den Editor laden', 'Die Empfehlung im Editor weiterbearbeiten')}</div></div>`;
}
const b = t => `<b style="color:var(--text);">${t}</b>`;

/** Name einer Strategie: Standardstrategie, sonst Kurzform der Wege. */
function _strategieName(r) {
  const k = r.wahl.join(',');
  const s = _erg.standard.find(x => x.wahl.join(',') === k);
  if (s) return s.label;
  const z = new Map();
  r.wahl.forEach((w, i) => { const o = _erg.optionen[i][w]; z.set(o.kurz, (z.get(o.kurz) || 0) + 1); });
  return [...z].filter(([kurz]) => kurz !== '—').map(([kurz, n]) => `${kurz}${n > 1 ? ' ×' + n : ''}`).join(' + ') || 'nichts belegen';
}

function _paretoSvg() {
  const { alle, pareto, standard, empfehlung } = _erg;
  const pts = alle.filter(r => r.machbar);
  if (!pts.length) return '';
  const W = 760, H = 290, PL = 58, PR = 16, PT = 14, PB = 38;
  const xMax = Math.max(1, ...pts.map(r => r.investEUR)) * 1.05;
  const yMax = Math.max(1, ...pts.map(r => r.energie.nutzbarMwh)) * 1.08;
  const x = v => PL + v / xMax * (W - PL - PR), y = v => PT + (1 - v / yMax) * (H - PT - PB);
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const vy = yMax * i / 4, vx = xMax * i / 4;
    out.push(`<line x1="${PL}" x2="${W - PR}" y1="${y(vy)}" y2="${y(vy)}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${PL - 6}" y="${y(vy) + 3}" font-size="9" text-anchor="end" fill="var(--muted)">${_fmt(vy)}</text>
      <text x="${x(vx)}" y="${H - PB + 14}" font-size="9" text-anchor="middle" fill="var(--muted)">${_fmt(vx / 1000)}</text>`);
  }
  out.push(`<text x="${(PL + W - PR) / 2}" y="${H - 6}" font-size="9.5" text-anchor="middle" fill="var(--muted)">Netz-Invest in T€</text>
    <text x="12" y="${(PT + H - PB) / 2}" font-size="9.5" text-anchor="middle" fill="var(--muted)" transform="rotate(-90 12 ${(PT + H - PB) / 2})">nutzbar MWh/a</text>`);
  // Alle Strategien (bei vielen nur jede n-te, die Front immer)
  const schritt = Math.max(1, Math.ceil(pts.length / 600));
  pts.forEach((r, i) => { if (i % schritt === 0) out.push(`<circle cx="${x(r.investEUR)}" cy="${y(r.energie.nutzbarMwh)}" r="2" fill="var(--muted)" opacity="0.35"/>`); });
  out.push(`<polyline points="${pareto.map(r => `${x(r.investEUR)},${y(r.energie.nutzbarMwh)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>`);
  for (const r of pareto) {
    out.push(`<g data-ns-lade="${r.wahl.join(',')}" style="cursor:pointer;"><title>${escHtml(`${_strategieName(r)}\n${_fmt(r.energie.kwp)} kWp · ${_fmt(r.energie.nutzbarMwh)} MWh/a\nNetz ${_tEur(r.investEUR)} · Überschuss ${_fmt(r.wirt.ueberschuss)} €/a\nKlicken: in den Editor`)}</title>
      <circle cx="${x(r.investEUR)}" cy="${y(r.energie.nutzbarMwh)}" r="3.5" fill="var(--accent)"/></g>`);
  }
  for (const s of standard) {
    const r = s.r;
    out.push(`<g data-ns-lade="${r.wahl.join(',')}" style="cursor:pointer;"><title>${escHtml(`${s.key} ${s.label}\n${_fmt(r.energie.kwp)} kWp · ${_fmt(r.energie.nutzbarMwh)} MWh/a\nNetz ${_tEur(r.investEUR)} · Überschuss ${_fmt(r.wirt.ueberschuss)} €/a`)}</title>
      <rect x="${x(r.investEUR) - 4}" y="${y(r.energie.nutzbarMwh) - 4}" width="8" height="8" fill="none" stroke="var(--text)" stroke-width="1.2"/>
      <text x="${x(r.investEUR) + 6}" y="${y(r.energie.nutzbarMwh) - 5}" font-size="9" fill="var(--text)">${s.key}</text></g>`);
  }
  const star = (r, farbe, txt) => `<g data-ns-lade="${r.wahl.join(',')}" style="cursor:pointer;"><title>${escHtml(txt)}</title>
    <text x="${x(r.investEUR)}" y="${y(r.energie.nutzbarMwh) + 5}" font-size="15" text-anchor="middle" fill="${farbe}">★</text></g>`;
  out.push(star(empfehlung, '#ffd54f', `Empfehlung: ${_strategieName(empfehlung)}`));
  if (_editor) out.push(`<circle cx="${x(_editor.investEUR)}" cy="${y(_editor.energie.nutzbarMwh)}" r="7" fill="none" stroke="#4fc3f7" stroke-width="1.8"><title>Editor-Auswahl</title></circle>`);
  return `<div style="overflow-x:auto;margin-top:6px;"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:560px;max-width:${W}px;display:block;">${out.join('')}</svg></div>
    <div style="font-size:10px;color:var(--muted);">
      <span style="color:var(--accent);">●</span> Pareto-Front · □ S0–S5 Standardstrategien · <span style="color:#ffd54f;">★</span> Empfehlung ·
      <span style="color:#4fc3f7;">○</span> Editor</div>`;
}

function _vergleichHtml() {
  const liste = [
    { key: 'empf', label: '★ Empfehlung', r: _erg.empfehlung },
    ..._erg.standard.map(s => ({ key: s.key, label: `${s.key} ${s.label}`, r: s.r })),
    { key: 'editor', label: '✎ Editor-Auswahl', r: _editor },
  ].filter(x => x.r);
  const ueb = window._pvAnalyse?.netzStrategien || [];
  const gewaehlt = new Set(ueb.map(v => v.key));
  const zeile = x => {
    const r = x.r, e = r.energie;
    const abg = e.erzeugungMwh > 0 ? (e.abgeregeltDachMwh + e.abgeregeltNapMwh) / e.erzeugungMwh * 100 : 0;
    const best = r === _erg.empfehlung;
    return `<tr style="${best ? 'background:rgba(255,213,79,.08);' : ''}">
      <td style="text-align:center;"><input type="checkbox" data-ns-var="${x.key}" ${gewaehlt.has(x.key) ? 'checked' : ''} title="Als Variante in die PV-Analyse übernehmen"></td>
      <td class="l"><span data-ns-lade="${r.wahl.join(',')}" style="cursor:pointer;" title="In den Editor laden">${escHtml(x.label)}</span>
        ${r.machbar ? '' : '<span style="color:#e57373;"> (nicht machbar)</span>'}</td>
      <td class="m">${_fmt(e.kwp)}</td><td class="m">${_fmt(e.nutzbarMwh)}</td><td class="m">${_fmt(abg, 1)} %</td>
      <td class="m">${e.mitLastgang ? _fmt(e.evQuotePct) + ' %' : '—'}</td>
      <td class="m">${_tEur(r.investEUR)}</td><td class="m">${e.kwp > 0.5 ? _fmt(r.investEUR / e.kwp) : '—'}</td>
      <td class="m">${_fmt(r.wirt.lcoeCt, 1)}</td>
      <td class="m" style="color:${r.wirt.ueberschuss >= 0 ? '#66bb6a' : '#e57373'};">${_fmt(r.wirt.ueberschuss)}</td></tr>`;
  };
  const aktuell = ueb.length && ueb.every(v => (window._pvAnalyse?.ergebnisse || []).some(e => e.strategieKey === v.key));
  return `<div class="ns-karte"><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
    <b style="font-size:11px;">Strategien im Vergleich</b>
    <span>${_kn('var-rechnen', '↻ Gewählte in die PV-Analyse übernehmen', 'Angehakte Strategien als Varianten „Netzstrategie: …" anlegen und alle Varianten neu rechnen', ueb.length > 0 && !aktuell)}
      <span style="font-size:10px;color:var(--muted);margin-left:6px;">${ueb.length ? `${ueb.length} gewählt${aktuell ? ' · stehen im Varianten-Vergleich' : ''}` : 'Häkchen = als Variante übernehmen'}</span></span></div>
    <div style="overflow-x:auto;"><table><thead><tr><th>Var.</th><th class="l">Strategie</th><th>kWp</th><th>MWh/a nutzbar</th><th>abgeregelt</th><th>EV-Quote</th>
      <th>Netz-Invest</th><th>Netz €/kWp</th><th>ct/kWh</th><th>Überschuss €/a</th></tr></thead>
      <tbody>${liste.map(zeile).join('')}</tbody></table></div>
    <div style="font-size:10px;color:var(--muted);margin-top:4px;line-height:1.5;">Überschuss = Erlöse (Eigenverbrauch × Bezugspreis + Einspeisung × Vergütung) − Annuität PV (inkl. Instandhaltung) − Annuität Netz, ohne Speicher.
      ct/kWh = Jahreskosten je nutzbarer kWh. In der PV-Analyse wird jede übernommene Strategie mit dem vollen Modell nachgerechnet (Infrastruktur-Pauschalen, Direktvermarktung).</div></div>`;
}

function _editorHtml() {
  const { gruppen, optionen } = _erg;
  const r = _editor;
  const e = r.energie;
  const zeilen = gruppen.map((g, i) => {
    const o = optionen[i][_editorWahl[i]];
    const kwpBel = g.daecher.reduce((t, id) => t + (r.kwpJeDach.get(id) || 0), 0);
    const abreg = o.abregeln;
    const auf = _offen.has(g.key);
    const sel = `<select data-ns-wahl="${i}" style="font-size:10.5px;max-width:260px;">${optionen[i].map((x, j) =>
      `<option value="${j}" ${j === _editorWahl[i] ? 'selected' : ''} ${x.machbar === false ? 'disabled' : ''}>${escHtml(x.label)}${x.machbar === false ? ' — nicht machbar'
        : (x.investEUR + (x.massnahmenEUR || 0)) > 0 ? ` · ${_tEur(x.investEUR + (x.massnahmenEUR || 0))}` : ''}</option>`).join('')}</select>`;
    return `<tr>
      <td class="l"><span data-ns-gruppe="${escHtml(g.key)}" style="cursor:pointer;">${auf ? '▾' : '▸'} ${escHtml(g.label)}</span>
        <span style="font-size:9.5px;padding:0 5px;border-radius:7px;margin-left:4px;background:${g.klasse === 'neu' ? 'rgba(224,64,251,.18)' : 'rgba(128,128,128,.18)'};">${g.klasse === 'neu' ? 'Neubau' : 'Bestand'}</span></td>
      <td class="m">${g.daecher.length}</td><td class="m">${_fmt(g.kwpMax)}</td>
      <td class="l"><span style="color:${OPT_FARBE[o.id]};">■</span> ${sel}</td>
      <td class="m">${abreg ? _fmt(g.kwpMax) + ' <span style="color:var(--muted);">(Netz ' + _fmt(kwpBel) + ')</span>' : _fmt(kwpBel)}</td>
      <td class="m">${Number.isFinite(o.investEUR) ? _tEur(o.investEUR + (o.massnahmenEUR || 0)) : '—'}</td></tr>
      ${auf ? `<tr><td colspan="6" class="l" style="background:rgba(128,128,128,.05);white-space:normal;">${_gruppeDetailHtml(i)}</td></tr>` : ''}`;
  }).join('');
  const abg = e.erzeugungMwh > 0 ? (e.abgeregeltDachMwh + e.abgeregeltNapMwh) / e.erzeugungMwh * 100 : 0;
  return `<div class="ns-karte"><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
    <b style="font-size:11px;">Editor — Anschlussweg je Gruppe</b>
    <span>${_kn('karte', _karte ? 'Karte aus' : '🗺 Auf der Karte zeigen', 'Gruppen, neue Trassen und Stationen der Editor-Auswahl auf der Karte')}
      ${_kn('editor-empf', 'Empfehlung laden', '')} ${_kn('editor-voll', 'alle aufklappen', '')}</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:11px;margin-bottom:6px;">
      <span>${b(_fmt(e.kwp) + ' kWp')}</span><span>${b(_fmt(e.nutzbarMwh) + ' MWh/a')} nutzbar</span>
      <span>abgeregelt ${_fmt(abg, 1)} %</span><span>Netz ${b(_tEur(r.investEUR))}${r.massnahmen.length ? ` (davon Ertüchtigung ${_tEur(r.investMassEUR)})` : ''}</span>
      <span>Rückspeisespitze ${_fmt(e.rueckspeiseSpitzeKw)} kW</span>
      <span>Überschuss <b style="color:${r.wirt.ueberschuss >= 0 ? '#66bb6a' : '#e57373'};">${_fmt(r.wirt.ueberschuss)} €/a</b></span></div>
    <div style="overflow-x:auto;"><table><thead><tr><th class="l">Gruppe</th><th>Dächer</th><th>Fläche kWp</th><th class="l">Anschlussweg</th><th>belegt kWp</th><th>Invest Weg</th></tr></thead>
      <tbody>${zeilen}</tbody></table></div>
    <div style="font-size:10px;color:var(--muted);margin-top:4px;">Gruppe aufklappen: alle Wege im Vergleich (bei sonst gleicher Auswahl), Break-even des Erzeugungsnetzes, Kostenposten.</div></div>`;
}

/** Alle Wege einer Gruppe bei sonst gleicher Editor-Auswahl + Break-even + Kostenposten. */
function _gruppeDetailHtml(i) {
  const { optionen, gruppen, holen } = _erg;
  const g = gruppen[i];
  const basisR = holen(_editorWahl.map((w, j) => (j === i ? 0 : w)));      // Gruppe nicht belegt
  const zeilen = optionen[i].map((o, j) => {
    if (o.machbar === false) return `<tr><td class="l"><span style="color:${OPT_FARBE[o.id]};">■</span> ${escHtml(o.label)}</td><td colspan="5" class="l" style="color:var(--muted);">${escHtml(o.hinweis || 'nicht machbar')}</td></tr>`;
    const r = holen(_editorWahl.map((w, k) => (k === i ? j : w)));
    const dK = r.energie.kwp - basisR.energie.kwp, dI = r.investEUR - basisR.investEUR;
    return `<tr style="${j === _editorWahl[i] ? 'background:rgba(79,195,247,.10);' : ''}">
      <td class="l"><span style="color:${OPT_FARBE[o.id]};">■</span> <span data-ns-setze="${i}:${j}" style="cursor:pointer;" title="Diesen Weg wählen">${escHtml(o.label)}</span></td>
      <td class="m">+${_fmt(dK)}</td><td class="m">+${_fmt(r.energie.nutzbarMwh - basisR.energie.nutzbarMwh)}</td>
      <td class="m">${_tEur(dI)}</td><td class="m">${dK > 0.5 ? _fmt(dI / dK) : '—'}</td>
      <td class="m" style="color:${r.wirt.ueberschuss - basisR.wirt.ueberschuss >= 0 ? '#66bb6a' : '#e57373'};">${_fmt(r.wirt.ueberschuss - basisR.wirt.ueberschuss)}</td></tr>`;
  }).join('');
  // Break-even Erzeugungsnetz gegen den teuersten sinnvollen Bestandsweg (B, sonst C)
  const oE = optionen[i].find(o => o.id === 'E' && o.machbar !== false);
  let be = '';
  if (oE) {
    const fix = oE.posten.filter(p => !p.label.startsWith('Anschluss')).reduce((t, p) => t + p.eur, 0);
    const varEur = oE.posten.filter(p => p.label.startsWith('Anschluss')).reduce((t, p) => t + p.eur, 0);
    const kVar = g.kwpMax > 0 ? varEur / g.kwpMax : 0;
    const vgl = ['B', 'C'].map(id => optionen[i].findIndex(o => o.id === id && o.machbar !== false)).find(j => j >= 0);
    if (vgl != null && vgl >= 0) {
      const r = holen(_editorWahl.map((w, k) => (k === i ? vgl : w)));
      const dK = r.energie.kwp - basisR.energie.kwp;
      const kB = dK > 0.5 ? (r.investEUR - basisR.investEUR) / dK : null;
      const x = kB != null ? nsBreakEven(fix, kVar, kB) : null;
      be = kB == null ? '' : x == null
        ? `Break-even Erzeugungsnetz: lohnt über die Netzkosten nicht — „${escHtml(optionen[i][vgl].kurz)}" kostet nur ${_fmt(kB)} €/kWp, das Erzeugungsnetz allein für die Dachanschlüsse schon ${_fmt(kVar)} €/kWp.`
        : `Break-even Erzeugungsnetz: Fixkosten ${_tEur(fix)} (Station, MS-Trasse, Schaltfeld) gegen ${_fmt(kB)} €/kWp über „${escHtml(optionen[i][vgl].kurz)}" `
          + `→ lohnt ab <b>${_fmt(x)} kWp</b>; die Gruppe hat ${_fmt(g.kwpMax)} kWp ${g.kwpMax >= x ? '<span style="color:#66bb6a;">(darüber)</span>' : '<span style="color:#ffb74d;">(darunter)</span>'}.`;
    }
  }
  const o = optionen[i][_editorWahl[i]];
  const posten = o.posten?.length ? `<div style="margin-top:4px;color:var(--muted);">Kostenposten „${escHtml(o.label)}": `
    + o.posten.slice(0, 8).map(p => `${escHtml(p.label)} ${_tEur(p.eur)}`).join(' · ') + (o.posten.length > 8 ? ` · … (${o.posten.length} Posten)` : '')
    + (o.msZiel ? ` · MS-Anschluss an ${escHtml(o.msZiel.name || o.msZiel.id)}` : '') + '</div>' : '';
  return `<div style="font-size:10.5px;margin:3px 0 4px;">Dächer: ${g.namen.map(escHtml).join(', ')}</div>
    <table><thead><tr><th class="l">Weg (andere Gruppen wie im Editor)</th><th>+kWp</th><th>+MWh/a</th><th>+Netz</th><th>Netz €/kWp</th><th>+Überschuss €/a</th></tr></thead>
    <tbody>${zeilen}</tbody></table>
    ${be ? `<div style="margin-top:4px;">${be}</div>` : ''}${posten}${o.hinweis ? `<div style="color:#ffb74d;margin-top:3px;">${escHtml(o.hinweis)}</div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// KARTE
// ══════════════════════════════════════════════════════════════════════════════

function _karteZeichnen() {
  const map = window.map, L = window.L;
  if (!map || !L || !_erg?.optionen) return;
  if (_karte) _karte.clearLayers(); else _karte = L.layerGroup().addTo(map);
  _erg.gruppen.forEach((g, i) => {
    const o = _erg.optionen[i][_editorWahl[i]];
    const farbe = OPT_FARBE[o.id] || '#999';
    for (const id of g.daecher) {
      const pos = _erg.modell.info.dachInfo.get(id)?.pos;
      if (pos) _karte.addLayer(L.circleMarker([pos.lat, pos.lng], { radius: 6, color: farbe, weight: 2, fillOpacity: 0.5 })
        .bindTooltip(`${escHtml(g.label)} — ${escHtml(o.label)}`));
    }
    for (const l of o.geo || []) {
      if (!l.von || !l.bis) continue;
      _karte.addLayer(L.polyline([[l.von.lat, l.von.lng], [l.bis.lat, l.bis.lng]],
        { color: l.art === 'ms' ? '#ab47bc' : farbe, weight: l.art === 'ms' ? 4 : 2, dashArray: '6 5', opacity: 0.9 }));
    }
    if (o.station?.pos) {
      _karte.addLayer(L.marker([o.station.pos.lat, o.station.pos.lng], { icon: L.divIcon({ className: '', iconSize: null,
        html: `<div style="transform:translate(-50%,-50%);background:${farbe};color:#111;font:700 10px/1 sans-serif;padding:3px 5px;border-radius:4px;white-space:nowrap;">`
          + `${o.station.art === 'KVS' ? 'KVS' : '⚡ ' + (o.station.kva || '') + ' kVA'}</div>` }) }).bindTooltip(escHtml(o.label)));
    }
  });
}

function _karteAus() {
  if (_karte) { _karte.remove(); _karte = null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// EREIGNISSE
// ══════════════════════════════════════════════════════════════════════════════

function _setzeFeld(pfad, wert) {
  const zahl = ['stichjahr', 'zieljahr', 'abstandM', 'ziel.budgetEUR', 'ziel.kwp'].includes(pfad);
  const v = zahl ? (wert === '' ? null : +wert) : wert;
  if (pfad.startsWith('ziel.')) _ns.ziel[pfad.slice(5)] = v;
  else _ns[pfad] = pfad === 'abstandM' ? Math.max(10, v || 120) : v;
  if (_erg) _veraltet = true;
}

function _ereignisse(root) {
  root.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.nsFeld) { _setzeFeld(t.dataset.nsFeld, t.value); nsRender(); return; }
    if (t.dataset.nsKosten) {
      const k = t.dataset.nsKosten, v = parseFloat(t.value);
      if (!Number.isFinite(v) || v < 0 || v === NS_KOSTEN_STANDARD[k].wert) delete _ns.kosten[k]; else _ns.kosten[k] = v;
      if (_erg) _veraltet = true;
      nsRender();
      return;
    }
    if (t.dataset.nsWahl != null && _erg?.optionen) {
      const w = [..._editorWahl];
      w[+t.dataset.nsWahl] = +t.value;
      _editorSetzen(w);
      nsRender();
      return;
    }
    if (t.dataset.nsVar != null) { _varianteWahl(t.dataset.nsVar, t.checked); nsRender(); }
  });
  root.addEventListener('click', ev => {
    const t = ev.target.closest('[data-ns-aktion],[data-ns-lade],[data-ns-gruppe],[data-ns-setze]');
    if (!t) return;
    if (t.dataset.nsLade && _erg?.optionen) { _editorSetzen(t.dataset.nsLade.split(',').map(Number)); nsRender(); return; }
    if (t.dataset.nsGruppe) { if (_offen.has(t.dataset.nsGruppe)) _offen.delete(t.dataset.nsGruppe); else _offen.add(t.dataset.nsGruppe); nsRender(); return; }
    if (t.dataset.nsSetze) {
      const [i, j] = t.dataset.nsSetze.split(':').map(Number);
      const w = [..._editorWahl]; w[i] = j;
      _editorSetzen(w); nsRender(); return;
    }
    const a = t.dataset.nsAktion;
    if (a === 'rechnen') {
      _meldung = 'Rechne Strategien …';
      nsRender();
      setTimeout(() => {
        try { nsRechnen(); _meldung = ''; }
        catch (err) { console.warn('[Netzstrategie] Rechnung fehlgeschlagen:', err); _meldung = 'Rechnung fehlgeschlagen — Details in der Konsole.'; }
        nsRender();
      }, 30);
      return;
    }
    if (a === 'katalog') { _katalogAuf = !_katalogAuf; nsRender(); return; }
    if (a === 'katalog-standard') { _ns.kosten = {}; if (_erg) _veraltet = true; nsRender(); return; }
    if (a === 'empf-editor' || a === 'editor-empf') { _editorSetzen(_erg.empfehlung.wahl); nsRender(); return; }
    if (a === 'editor-voll') { _erg.gruppen.forEach(g => _offen.add(g.key)); nsRender(); return; }
    if (a === 'karte') {
      if (_karte) _karteAus(); else { _karteZeichnen(); window.setViewMode?.('karte'); }
      nsRender();
      return;
    }
    if (a === 'var-rechnen') _variantenRechnen();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ÜBERNAHME IN DIE PV-ANALYSE
// ══════════════════════════════════════════════════════════════════════════════

/** Strategie als Variante vormerken bzw. entfernen (Momentaufnahme der Zahlen). */
function _varianteWahl(key, an) {
  const s = window._pvAnalyse;
  if (!s || !_erg?.optionen) return;
  const liste = (s.netzStrategien || []).filter(v => v.key !== key);
  if (an) {
    const r = key === 'empf' ? _erg.empfehlung : key === 'editor' ? _editor : _erg.standard.find(x => x.key === key)?.r;
    if (r) {
      const name = key === 'empf' ? 'Empfehlung' : key === 'editor' ? 'eigene Auswahl' : _erg.standard.find(x => x.key === key).label;
      const wege = r.wahl.map((w, i) => `${_erg.gruppen[i].label}: ${_erg.optionen[i][w].kurz}`);
      liste.push({
        key, label: name, kwp: r.energie.kwp, investEUR: r.investEUR,
        abregelung: r.wahl.some((w, i) => _erg.optionen[i][w].abregeln),
        nutzbarMwh: r.energie.nutzbarMwh, ueberschussEUR: r.wirt.ueberschuss,
        detail: wege.join('; '), stand: new Date().toLocaleDateString('de-DE'),
        jahre: { ..._erg.jahre },
      });
    }
  }
  s.netzStrategien = liste.length ? liste : null;
}

function _variantenRechnen() {
  if (!(window.elQuartierH15 || window.elQuartierH)) {
    _meldung = 'Vorgemerkt — ohne Stromlastgang entstehen die Varianten beim nächsten „Varianten berechnen".';
    nsRender();
    return;
  }
  _meldung = 'Berechne Varianten …';
  nsRender();
  setTimeout(() => {
    try { window.pvBerechneAlle?.(); _meldung = 'Varianten neu berechnet — die Strategien stehen im Varianten-Vergleich als „Netzstrategie: …".'; }
    catch (err) { console.warn('[Netzstrategie] Variantenrechnung fehlgeschlagen:', err); _meldung = 'Variantenrechnung fehlgeschlagen — bitte „Varianten berechnen" von Hand starten.'; }
    nsRender();
  }, 30);
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJEKTDATEI + SCHNITTSTELLEN
// ══════════════════════════════════════════════════════════════════════════════

export function nsEinstellungen() {
  return JSON.parse(JSON.stringify(_ns));
}

export function nsEinstellungenSetzen(d) {
  const std = _standard();
  const z = d?.ziel || {};
  _ns = {
    ...std,
    stichjahr: Number.isFinite(parseInt(d?.stichjahr)) ? parseInt(d.stichjahr) : null,
    zieljahr: Number.isFinite(parseInt(d?.zieljahr)) ? parseInt(d.zieljahr) : null,
    quelle: d?.quelle === 'alle' ? 'alle' : 'aktiv',
    gruppierung: d?.gruppierung === 'cluster' ? 'cluster' : 'auto',
    abstandM: parseFloat(d?.abstandM) > 0 ? parseFloat(d.abstandM) : std.abstandM,
    ziel: { art: ['wirtschaft', 'budget', 'zielkwp'].includes(z.art) ? z.art : 'wirtschaft',
      budgetEUR: parseFloat(z.budgetEUR) >= 0 ? parseFloat(z.budgetEUR) : std.ziel.budgetEUR,
      kwp: parseFloat(z.kwp) >= 0 ? parseFloat(z.kwp) : std.ziel.kwp },
    kosten: d?.kosten && typeof d.kosten === 'object' ? { ...d.kosten } : {},
    wahl: d?.wahl && typeof d.wahl === 'object' ? { ...d.wahl } : {},
  };
  _erg = null; _editor = null; _editorWahl = null; _veraltet = false; _meldung = '';
  _karteAus();
  if (document.getElementById(ROOT_ID)?.style.display === 'block') nsRender();
}

/** Nutzungsdauer der Netzbetriebsmittel aus dem Kostenkatalog (für pvWirtschaft in 09d). */
export function nsNetzLebensdauer() {
  return nsKostenMischen(_ns.kosten).netzLebensdauer;
}

window.nsRender = nsRender;
window.nsRechnen = nsRechnen;
window.nsEinstellungen = nsEinstellungen;
window.nsEinstellungenSetzen = nsEinstellungenSetzen;
window.nsNetzLebensdauer = nsNetzLebensdauer;
