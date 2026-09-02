// ── 19-el-ergebnisblatt.js — Ergebnisblatt der Elektroberechnung ─────────────
//
// Ein Blatt, das die Rechnung vollständig aufschreibt — nicht drei Kennzahlen
// im Panel und der Rest im Tooltip. Zielbild ist die Anlage zum Gutachten:
// jemand, der das Netz nicht kennt, muss aus diesem Blatt ablesen können, was
// gerechnet wurde, mit welchen Annahmen, was herauskam und wo es klemmt.
//
// Sechs Register:
//   Übersicht      — Kennzahlen, Grenzwertnachweis, Befunde
//   Betriebsmittel — Trafos einzeln, Anlagen nach Typ
//   Kabel          — Strecke für Strecke mit Auslegungsnachweis
//   Knoten         — Spannungsfall und Kurzschlussstrom je Knoten
//   Mengen & Kosten— Querschnittsspiegel, Investition, Annuität
//   Annahmen       — jeder Parameter, der in die Rechnung eingeht
//
// Das Blatt RECHNET NICHT. Es liest ausschließlich, was elCalcAssets() an
// Assets, Kanten und Knoten hinterlassen hat (inkl. Ergebnis-Stempel
// window._elErgebnisStand). Damit kann es nie ein anderes Ergebnis zeigen als
// die Karte — und es muss keine Auslegungsregel ein zweites Mal kennen.
//
// Einzige Ausnahme: _calcStromNetzKosten() wird beim Öffnen aufgerufen, weil
// der Asset-Rechenpfad die Kosten (anders als der Lastflusspfad) nicht selbst
// aktualisiert. Die Funktion liest nur Kanten, Knoten und Kostenfelder.

import { ASSETS, ASSET_CFG } from './13a-assets-core.js';
import { openAssetInspector } from './13e-assets-inspector.js';
import { openCableInspector, _calcStromNetzKosten, MAX_DELTA_U_PCT } from './05b-stromnetz.js';
import { elCalcStand } from './13n-elektro-panel.js';
import { map } from './02b-gebaeude.js';
import { showHint, projektExportFilename, getProjektName } from './03c-gebaeude-io.js';
import { KABEL_TYPEN } from './config/netz-kosten.js';
import { varianten, activeVariantId, globalYear } from './01-globals-varianten.js';

const PANEL_ID = 'el-ergebnisblatt';

const TABS = [
  ['uebersicht',    'Übersicht'],
  ['betriebsmittel', 'Betriebsmittel'],
  ['kabel',         'Kabel'],
  ['knoten',        'Knoten'],
  ['mengen',        'Mengen &amp; Kosten'],
  ['annahmen',      'Annahmen'],
];

// Ansichtszustand (nicht Teil des Projekts — nur wie das Blatt gerade sortiert ist)
const EB = {
  tab: 'uebersicht',
  kabelSort: 'auslastung',   // Spaltenschlüssel
  kabelDesc: true,
  nurKritisch: false,        // Kabel-/Knotenliste auf Auffälligkeiten reduzieren
};

let _modell = null;          // letztes gesammeltes Ergebnis (auch für Druck/CSV)

// ── Formatierung ─────────────────────────────────────────────────────────────

const _num = (v, d = 1) =>
  (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d).replace('.', ',');

const _eur = v => !isFinite(v) ? '—'
  : v >= 1e6  ? (v / 1e6).toFixed(2).replace('.', ',') + ' M€'
  : v >= 1000 ? (v / 1000).toFixed(0) + ' T€'
  : Math.round(v) + ' €';

const _laenge = m => m >= 1000 ? _num(m / 1000, 2) + ' km' : _num(m, 0) + ' m';

const _esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Ampel: 0 = ok, 1 = Warnung, 2 = kritisch. Der Grenzwert selbst gilt noch als
// eingehalten (100 % Auslastung ist zulaessig, 100,1 % nicht) — sonst widerspraeche
// die Kachelfarbe dem Grenzwertnachweis, der mit ≤ prueft.
const AMPEL = ['ok', 'warn', 'bad'];
const _stufe = (wert, warnAb, kritAb) => wert > kritAb ? 2 : wert >= warnAb ? 1 : 0;

// Spannungsfall wird mit Vorzeichen gefuehrt: negativ = Spannungsanhebung durch
// Rueckspeisung. Fuer Bewertung und Grenzwert zaehlt der Betrag.
const _duBetrag = v => Math.abs(v ?? 0);

// ── Beschriftung von Knoten (Asset > Strom-Knoten > Gebäude) ─────────────────

function _knotenLabel(id) {
  const a = (ASSETS.items || []).find(x => x.id === id);
  if (a) return a.name || ASSET_CFG[a.type]?.label || a.type;
  const n = (window.stromNodes || []).find(x => x.id === id);
  if (n) return n.label || n.name || n.type;
  const g = (window.gebaeude || []).find(x => x.id === id);
  if (g) return g.name || `Gebäude ${id}`;
  return String(id).slice(-6);
}

// ── Ergebnis einsammeln ──────────────────────────────────────────────────────

/**
 * Baut das Anzeigemodell aus dem, was die letzte Elektroberechnung hinterlassen
 * hat. Reine Leseoperation — keine Auslegung, keine Netzrechnung.
 * @returns {object|null} null, wenn in dieser Sitzung noch nicht gerechnet wurde
 */
function _sammle() {
  const stand = window._elErgebnisStand;
  if (!stand) return null;

  const assets = (ASSETS.items || []).filter(a => a._calcVerbrauchKw !== undefined);
  const edges  = (window.stromEdges || []).filter(e => e._calcJahr != null);
  const nodes  = window.stromNodes || [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // ── Kabel ──
  const kabel = edges.map(e => {
    const kt   = KABEL_TYPEN[e.cableType] || {};
    const nU   = nodeById.get(e.u), nV = nodeById.get(e.v);
    // ΔU kumuliert am Kabelende: netzabwärts liegt der Knoten mit dem größeren
    // Betrag — bei Rückspeisung ist der Wert negativ (Spannungsanhebung).
    const duU = nU?._deltaUKumPct ?? 0, duV = nV?._deltaUKumPct ?? 0;
    const duKum = _duBetrag(duU) >= _duBetrag(duV) ? duU : duV;
    const ausl  = e.auslastungPct || 0;
    const sicherungKritisch = (e.fuseA > 0 && e.peakCurrentA > e.fuseA);
    const stufe = Math.max(
      _stufe(ausl, 80, 100),
      _stufe(_duBetrag(duKum), MAX_DELTA_U_PCT * 2 / 3, MAX_DELTA_U_PCT),
      sicherungKritisch ? 2 : 0,
      e._auslegungGedeckelt ? 1 : 0,
    );
    return {
      id: e.id, edge: e,
      von: _knotenLabel(e.u), nach: _knotenLabel(e.v),
      ebene: e.msLevel ? 'MS' : 'NS',
      typ: e.cableType || '—',
      material: kt.material || '',   // Cu/Al — für Mengengerüst und Nachweis
      querschnitt: e._effCrossSection || e.crossSection || 0,
      nParallel: Math.max(1, e.nParallel || 1),
      laengeM: e.lengthM || 0,
      bezugKw: e.peakFlowKw_V ?? 0,
      einspKw: e.peakFlowKw_G ?? 0,
      stromA: e.peakCurrentA || 0,
      izA: e._izEff ?? e.ratedCurrentA ?? 0,
      auslastung: ausl,
      duSegment: e.deltaUPct || 0,
      duKum,
      sicherungA: e.fuseA || 0,
      sicherungKritisch,
      gedeckelt: !!e._auslegungGedeckelt,
      autoSized: e.autoSized !== false,
      stufe,
    };
  });

  // ── Transformatoren ──
  const trafos = assets.filter(a => a.type === 'Trafo').map(a => {
    const kva  = parseFloat(a.props?.leistungKVA) || 630;
    const pct  = a._calcPeakLoadPct || 0;
    const kw   = a._calcPeakLoadKw || 0;
    return {
      id: a.id, asset: a,
      name: a.name || 'Trafo',
      kva,
      ukPct: parseFloat(a.props?.ukPct) || null,
      bezugKw: a._calcPeakLoadKwV || 0,
      einspKw: a._calcPeakLoadKwG || 0,
      massgebendKw: kw,
      richtung: a._calcFlowDirection === -1 ? 'Rückspeisung' : 'Bezug',
      auslastung: pct,
      // Reserve auf der Wirkleistungsseite (kVA × 0,9 — dieselbe Annahme wie im Rechenkern)
      reserveKw: Math.max(0, kva * 0.9 - kw),
      stufe: _stufe(pct, 80, 100),
    };
  }).sort((x, y) => y.auslastung - x.auslastung);

  // ── Anlagen nach Typ ──
  const nachTyp = new Map();
  for (const a of assets) {
    const k = a.type;
    if (!nachTyp.has(k)) nachTyp.set(k, {
      typ: k, label: ASSET_CFG[k]?.label || k, icon: ASSET_CFG[k]?.icon || '',
      kategorie: ASSET_CFG[k]?.kategorie || 'sonstiges',
      n: 0, verbrauchKw: 0, erzeugungKw: 0,
    });
    const z = nachTyp.get(k);
    z.n++;
    z.verbrauchKw += a._calcVerbrauchKw || 0;
    z.erzeugungKw += a._calcErzeugungKw || 0;
  }
  const anlagen = [...nachTyp.values()].sort((x, y) =>
    (y.verbrauchKw + y.erzeugungKw) - (x.verbrauchKw + x.erzeugungKw) || y.n - x.n);

  // ── Knoten (nur berechnete Assets — Gebäude hängen als Blätter daran) ──
  const knoten = assets.map(a => {
    const n = nodeById.get(a.id);
    const du = n?._deltaUKumPct ?? null;
    return {
      id: a.id, asset: a,
      name: a.name || ASSET_CFG[a.type]?.label || a.type,
      typ: ASSET_CFG[a.type]?.label || a.type,
      verbrauchKw: a._calcVerbrauchKw || 0,
      erzeugungKw: a._calcErzeugungKw || 0,
      duKum: du,
      ikMinKa: n?.ikMinA ? n.ikMinA / 1000 : null,
      ikMaxKa: n?.ikMaxA ? n.ikMaxA / 1000 : null,
      stufe: du == null ? 0 : _stufe(_duBetrag(du), MAX_DELTA_U_PCT * 2 / 3, MAX_DELTA_U_PCT),
    };
  }).sort((x, y) => (y.duKum ?? -1) - (x.duKum ?? -1));

  // ── Querschnittsspiegel (Mengengerüst für die Ausschreibung) ──
  const spiegel = new Map();
  for (const k of kabel) {
    const key = `${k.typ}|${k.querschnitt}|${k.nParallel}`;
    if (!spiegel.has(key)) spiegel.set(key, {
      typ: k.typ, querschnitt: k.querschnitt, nParallel: k.nParallel,
      n: 0, laengeM: 0, eurM: null,
    });
    const z = spiegel.get(key);
    z.n++;
    z.laengeM += k.laengeM;
    if (z.eurM == null) {
      const sec = (KABEL_TYPEN[k.typ]?.sections || []).find(s => s.mm2 === k.querschnitt);
      z.eurM = sec ? sec.eurM : null;
    }
  }
  const mengen = [...spiegel.values()].sort((x, y) => y.laengeM - x.laengeM);

  // ── Kennzahlen ──
  const kpis = window._stromNetzKpis || {};
  const laengeGesamt = kabel.reduce((s, k) => s + k.laengeM, 0);
  const laengeMs     = kabel.filter(k => k.ebene === 'MS').reduce((s, k) => s + k.laengeM, 0);
  const maxTrafo     = trafos.reduce((m, t) => Math.max(m, t.auslastung), 0);
  const maxKabel     = kabel.reduce((m, k) => Math.max(m, k.auslastung), 0);
  const maxDu        = Math.max(kpis.maxDeltaU || 0, ...kabel.map(k => _duBetrag(k.duKum)));

  // ── Befunde ──
  const befunde = [];
  const push = (stufe, titel, detail, treffer) => {
    if (treffer.length) befunde.push({ stufe, titel, detail, treffer });
  };
  push(2, 'Kabel über 100 % Auslastung',
    'Betriebsstrom über der korrigierten Strombelastbarkeit Iz. Querschnitt erhöhen, parallelen Strang legen oder Last aufteilen.',
    kabel.filter(k => k.auslastung > 100).map(k => ({ id: k.id, art: 'kabel', label: `${k.von} → ${k.nach} (${_num(k.auslastung, 0)} %)` })));
  push(2, `Spannungsfall über ${MAX_DELTA_U_PCT} %`,
    'Kumulierter Spannungsfall vom speisenden Knoten bis zum Kabelende über dem Planungslimit.',
    kabel.filter(k => _duBetrag(k.duKum) > MAX_DELTA_U_PCT).map(k => ({ id: k.id, art: 'kabel', label: `${k.von} → ${k.nach} (${_num(k.duKum, 2)} %)` })));
  push(2, 'Sicherung kleiner als Betriebsstrom',
    'Die eingetragene Vorsicherung löst im gerechneten Lastfall aus.',
    kabel.filter(k => k.sicherungKritisch).map(k => ({ id: k.id, art: 'kabel', label: `${k.von} → ${k.nach} (${_num(k.stromA, 0)} A > ${k.sicherungA} A)` })));
  push(2, 'Transformator über 100 % Auslastung',
    'Maßgebend ist der Worst Case aus Bezug und Rückspeisung — beide Richtungen belasten den Trafo gleich.',
    trafos.filter(t => t.auslastung > 100).map(t => ({ id: t.id, art: 'asset', label: `${t.name} (${_num(t.auslastung, 0)} %)` })));
  push(1, 'Auslegung am Katalogende gedeckelt',
    'Der größte verfügbare Querschnitt reicht rechnerisch nicht — hier braucht es mehr Parallelstränge oder eine andere Netzstruktur.',
    kabel.filter(k => k.gedeckelt).map(k => ({ id: k.id, art: 'kabel', label: `${k.von} → ${k.nach}` })));
  push(1, 'Kabel über 80 % Auslastung',
    'Noch zulässig, aber ohne Reserve für weiteres Wachstum.',
    kabel.filter(k => k.auslastung > 80 && k.auslastung <= 100).map(k => ({ id: k.id, art: 'kabel', label: `${k.von} → ${k.nach} (${_num(k.auslastung, 0)} %)` })));
  push(1, 'Transformator über 80 % Auslastung',
    'Reserve für weitere Anschlüsse wird knapp.',
    trafos.filter(t => t.auslastung > 80 && t.auslastung <= 100).map(t => ({ id: t.id, art: 'asset', label: `${t.name} (${_num(t.auslastung, 0)} %)` })));

  // ── Kopfdaten ──
  const variante = activeVariantId
    ? (varianten.find(v => v.id === activeVariantId)?.name || 'Variante')
    : 'Basisdaten';
  const cs = elCalcStand?.();

  return {
    kopf: {
      projekt: getProjektName() || '(ohne Projektnamen)',
      variante,
      jahr: stand.jahr ?? globalYear,
      gerechnetAm: new Date(stand.zeit),
      frisch: cs ? cs.frisch : null,
      warnungen: stand.warnungen || [],
    },
    kpi: {
      verbrauchKw: stand.verbrauchKw || 0,
      erzeugungKw: stand.erzeugungKw || 0,
      massgebendKw: Math.max(stand.verbrauchKw || 0, stand.erzeugungKw || 0),
      nAssets: assets.length,
      nKabel: kabel.length,
      laengeGesamt, laengeMs, laengeNs: laengeGesamt - laengeMs,
      maxTrafo, maxKabel, maxDu,
      minIkKa: kpis.minIkA ? kpis.minIkA / 1000 : null,
      kIz: kpis.kIz ?? null,
    },
    trafos, anlagen, kabel, knoten, mengen, befunde,
    kosten: window._stromNetzKosten || null,
    annahmen: _annahmen(),
  };
}

/** Alle Rechenparameter so, wie sie beim Öffnen des Blatts eingestellt sind. */
function _annahmen() {
  const val = (id, fb) => document.getElementById(id)?.value ?? fb;
  const sel = id => {
    const el = document.getElementById(id);
    return el ? (el.options[el.selectedIndex]?.text || el.value) : '—';
  };
  return [
    ['Netz', 'Nennspannung NS', '400 V (Drehstrom, 3~)'],
    ['Netz', 'Standard-Kabeltyp', sel('strom-kabel-typ')],
    ['Netz', 'cos φ Niederspannung', _num(parseFloat(val('strom-ns-cosphi', 0.95)), 2)],
    ['Netz', 'cos φ Mittelspannung', _num(parseFloat(val('strom-ms-cosphi', 0.95)), 2)],
    ['Auslegung', 'Leitertemperatur', val('strom-leiter-temp', 70) + ' °C (Widerstandskorrektur IEC 60228)'],
    ['Auslegung', 'Grenzwert Spannungsfall', MAX_DELTA_U_PCT + ' % kumuliert (DIN 18015-1 / TAB)'],
    ['Auslegung', 'Bodentemperatur', val('strom-iz-tboden', 20) + ' °C (Referenz 20 °C)'],
    ['Auslegung', 'Häufung', val('strom-iz-nkabel', 1) + ' parallel verlegte Kabel'],
    ['Auslegung', 'Verlegeart', sel('strom-iz-verlegeart')],
    ['Auslegung', 'Iz-Korrekturfaktor kIz', _num(window._stromNetzKpis?.kIz ?? 1, 2) + ' (IEC 60364-5-52)'],
    ['Gleichzeitigkeit', 'Verfahren', sel('strom-gzf-methode')],
    ['Gleichzeitigkeit', 'Manueller GZF', val('strom-gzf-manuell', '0.6').replace('.', ',')],
    ['Trafo', 'Leistungsfaktor kVA → kW', '0,90 (fest, wie im Rechenkern)'],
    ['Kosten', 'Tiefbau', val('strom-k-tiefbau', 100) + ' €/m'],
    ['Kosten', 'NAP-Pauschale', val('strom-k-nap', 3000) + ' €'],
    ['Kosten', 'Transformator', val('strom-k-trafo', 60) + ' €/kVA'],
    ['Kosten', 'Nutzungsdauer', val('strom-k-nd', 40) + ' a'],
    ['Kosten', 'Kalkulationszins', '3,0 % (fest)'],
    ['Kosten', 'Instandhaltung', '1,0 % der Investition p. a. (VDI 2067)'],
  ];
}

// ── Panel-Gerüst ─────────────────────────────────────────────────────────────

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel amber-border';
  panel.style.cssText = 'top:60px;min-width:760px;max-width:1080px;max-height:88vh;padding:0 18px 14px;overflow:auto;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:#f9a825;font-size:12px;font-weight:600;">📄 Ergebnisblatt Elektro</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            data-click="ergebnisblattToggle()">✕</span>
    </div>
    <div id="eb-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

const _body = () => document.getElementById('eb-body');

/** Blatt öffnen/schließen (Kachel im Elektro-Panel). */
export function ergebnisblattToggle() {
  const panel = _ensurePanel();
  const sichtbar = panel.style.display === 'block';
  panel.style.display = sichtbar ? 'none' : 'block';
  if (!sichtbar) ergebnisblattAktualisieren();
}

/** Ergebnis neu einsammeln und zeichnen (rechnet nicht neu). */
export function ergebnisblattAktualisieren() {
  _ensurePanel().style.display = 'block';
  // Kosten kommen aus dem Lastflusspfad; der Asset-Pfad aktualisiert sie nicht.
  try { _calcStromNetzKosten(); } catch { /* ohne Kabel/Knoten schlicht nichts zu rechnen */ }
  _modell = _sammle();
  _render();
}

export function ebSetTab(tab) {
  EB.tab = TABS.some(t => t[0] === tab) ? tab : 'uebersicht';
  _render();
}

export function ebSortKabel(feld) {
  if (EB.kabelSort === feld) EB.kabelDesc = !EB.kabelDesc;
  else { EB.kabelSort = feld; EB.kabelDesc = true; }
  _render();
}

export function ebToggleKritisch() {
  EB.nurKritisch = !EB.nurKritisch;
  _render();
}

/** Aus einer Tabellenzeile zum Objekt auf der Karte springen. */
export function ebSpringeZu(id, art) {
  if (art === 'kabel') {
    const edge = (window.stromEdges || []).find(e => e.id === id);
    if (!edge) { showHint('⚠ Kabel nicht mehr vorhanden.'); return; }
    if (edge.layer) map.flyToBounds(edge.layer.getBounds(), { padding: [60, 60], maxZoom: 19, duration: 1 });
    openCableInspector(edge);
  } else {
    const asset = (ASSETS.items || []).find(a => a.id === id);
    if (!asset) { showHint('⚠ Anlage nicht mehr vorhanden.'); return; }
    if (asset.lat != null && asset.lng != null) {
      map.flyTo([asset.lat, asset.lng], Math.max(map.getZoom(), 18), { duration: 1 });
    }
    openAssetInspector(asset);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function _render() {
  const el = _body();
  if (!el) return;
  if (!_modell) {
    el.innerHTML = `
      <div class="eb-leer">
        <div style="font-size:22px;margin-bottom:6px;">📄</div>
        <div>Für dieses Blatt fehlt noch ein Rechenergebnis.</div>
        <button class="eb-btn eb-btn-primary" style="margin-top:10px;"
                data-click="elCalcAssets(); ergebnisblattAktualisieren()">⚡ Elektroberechnung starten</button>
      </div>`;
    return;
  }
  el.innerHTML = _kopf() + _tabs() + `<div class="eb-tabbody">${_tabInhalt()}</div>`;
}

function _kopf() {
  const k = _modell.kopf;
  const zeit = k.gerechnetAm.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const stand = k.frisch === false
    ? `<span class="eb-badge eb-warn" title="Netz oder Parameter haben sich seit der Rechnung geändert.">veraltet</span>`
    : `<span class="eb-badge eb-ok">aktuell</span>`;
  return `
  <div class="eb-kopf">
    <div class="eb-kopf-meta">
      <b>${_esc(k.projekt)}</b>
      <span>Variante: ${_esc(k.variante)}</span>
      <span>Betrachtungsjahr: ${k.jahr}</span>
      <span>gerechnet ${zeit} ${stand}</span>
    </div>
    <div class="eb-kopf-aktionen">
      <button class="eb-btn" data-click="ergebnisblattAktualisieren()" title="Ergebnis neu einlesen">↻ Aktualisieren</button>
      <button class="eb-btn" data-click="ebDrucken()" title="Vollständiges Blatt in einem Fenster öffnen und drucken">🖨 Drucken / PDF</button>
      <button class="eb-btn" data-click="ebCsvExport()" title="Alle Tabellen als CSV (Semikolon, Excel-tauglich)">⤓ CSV</button>
    </div>
  </div>`;
}

function _tabs() {
  return `<div class="eb-tabs">${TABS.map(([id, label]) =>
    `<button class="eb-tab${EB.tab === id ? ' is-active' : ''}" data-click="ebSetTab('${id}')">${label}</button>`
  ).join('')}</div>`;
}

function _tabInhalt() {
  switch (EB.tab) {
    case 'betriebsmittel': return _viewBetriebsmittel();
    case 'kabel':          return _viewKabel();
    case 'knoten':         return _viewKnoten();
    case 'mengen':         return _viewMengen();
    case 'annahmen':       return _viewAnnahmen();
    default:               return _viewUebersicht();
  }
}

// ── Übersicht ────────────────────────────────────────────────────────────────

const _kachel = (label, wert, einheit, stufe = null, tip = '') => `
  <div class="eb-kachel${stufe != null ? ' is-' + AMPEL[stufe] : ''}"${tip ? ` title="${_esc(tip)}"` : ''}>
    <div class="eb-kachel-label">${label}</div>
    <div class="eb-kachel-wert">${wert}<span class="eb-kachel-einheit">${einheit}</span></div>
  </div>`;

function _viewUebersicht() {
  const k = _modell.kpi;
  const kacheln = [
    _kachel('Anschlussleistung Verbrauch', _num(k.verbrauchKw, 0), ' kW', null,
      'Summe der Anschlussleistungen aller gerechneten Verbraucher — ohne Gleichzeitigkeit.'),
    _kachel('Einspeiseleistung', _num(k.erzeugungKw, 0), ' kW', null,
      'Summe der Erzeugerleistungen (PV mit 0,8 × kWp, Wind und KWK mit Nennleistung).'),
    _kachel('Maßgebende Netzlast', _num(k.massgebendKw, 0), ' kW', null,
      'Worst Case aus Bezug und Rückspeisung — die Richtung, die das Netz stärker belastet.'),
    _kachel('Trafo-Auslastung max', _num(k.maxTrafo, 0), ' %', _stufe(k.maxTrafo, 80, 100)),
    _kachel('Kabel-Auslastung max', _num(k.maxKabel, 0), ' %', _stufe(k.maxKabel, 80, 100)),
    _kachel('Spannungsfall max', _num(k.maxDu, 2), ' %', _stufe(k.maxDu, MAX_DELTA_U_PCT * 2 / 3, MAX_DELTA_U_PCT),
      'Größter Betrag über alle Pfade. Ein negativer Einzelwert in den Tabellen ist eine Spannungsanhebung durch Rückspeisung — sie zählt genauso gegen das Limit.'),
    _kachel('Trassenlänge',
      k.laengeGesamt >= 1000 ? _num(k.laengeGesamt / 1000, 2) : _num(k.laengeGesamt, 0),
      k.laengeGesamt >= 1000 ? ' km' : ' m', null,
      `Davon MS: ${_laenge(k.laengeMs)} · NS: ${_laenge(k.laengeNs)}`),
    _kachel('Betriebsmittel', k.nAssets, ` Stk · ${k.nKabel} Kabel`),
  ].join('');

  return `
  ${_abschnitt('Kennzahlen', `<div class="eb-kacheln">${kacheln}</div>`)}
  ${_abschnitt('Grenzwertnachweis', _nachweis())}
  ${_abschnitt(`Befunde${_modell.befunde.length ? ` · ${_modell.befunde.length}` : ''}`, _befunde())}`;
}

function _nachweis() {
  const k = _modell.kpi;
  const zeilen = [
    ['Spannungsfall (kumuliert)', `≤ ${MAX_DELTA_U_PCT} %`, _num(k.maxDu, 2) + ' %', k.maxDu <= MAX_DELTA_U_PCT],
    ['Strombelastbarkeit Kabel', '≤ 100 % von Iz', _num(k.maxKabel, 0) + ' %', k.maxKabel <= 100],
    ['Transformator-Auslastung', '≤ 100 % von Sr', _modell.trafos.length ? _num(k.maxTrafo, 0) + ' %' : '—', k.maxTrafo <= 100],
  ];
  if (k.minIkKa != null) {
    zeilen.push(['Kurzschlussstrom Ik″ min', 'Abschaltbedingung prüfen', _num(k.minIkKa, 2) + ' kA', k.minIkKa >= 1]);
  }
  const rows = zeilen.map(([was, grenze, ist, ok]) => `
    <tr>
      <td>${was}</td>
      <td class="eb-mut">${grenze}</td>
      <td class="eb-num">${ist}</td>
      <td class="eb-num ${ok ? 'eb-ok' : 'eb-bad'}">${ok ? '✓ eingehalten' : '✕ verletzt'}</td>
    </tr>`).join('');

  const hinweis = k.minIkKa == null
    ? `<div class="eb-hinweis">Kurzschlussströme rechnet nur der Lastflusspfad (Netz-Tab). Nach der Asset-Elektroberechnung steht hier kein Ik″.</div>`
    : '';
  return `<table class="eb-tab">
    <thead><tr><th>Kriterium</th><th>Grenzwert</th><th class="eb-num">Ist</th><th class="eb-num">Nachweis</th></tr></thead>
    <tbody>${rows}</tbody></table>${hinweis}`;
}

function _befunde() {
  const b = _modell.befunde;
  if (!b.length) return `<div class="eb-hinweis eb-ok">✓ Keine Grenzwertverletzung und keine Auffälligkeit im gerechneten Netz.</div>`;
  const MAX = 14;
  return b.map(f => {
    const gezeigt = f.treffer.slice(0, MAX);
    const rest = f.treffer.length - gezeigt.length;
    const chips = gezeigt.map(t =>
      `<span class="eb-chip" data-click="ebSpringeZu('${t.id}','${t.art}')"
             title="Auf der Karte zeigen und Eigenschaften öffnen">${_esc(t.label)}</span>`).join('');
    return `
    <div class="eb-befund is-${AMPEL[f.stufe]}">
      <div class="eb-befund-kopf">${_esc(f.titel)} <span class="eb-mut">${f.treffer.length}×</span></div>
      <div class="eb-mut" style="margin:2px 0 5px;">${_esc(f.detail)}</div>
      ${chips}${rest > 0 ? `<span class="eb-mut"> +${rest} weitere</span>` : ''}
    </div>`;
  }).join('');
}

// ── Betriebsmittel ───────────────────────────────────────────────────────────

function _viewBetriebsmittel() {
  const t = _modell.trafos;
  const trafoTab = !t.length
    ? `<div class="eb-hinweis">Kein Transformator im gerechneten Netz — die Rechnung läuft dann rein auf 400 V.</div>`
    : `<table class="eb-tab">
        <thead><tr>
          <th>Transformator</th><th class="eb-num">Sr (kVA)</th><th class="eb-num">uk (%)</th>
          <th class="eb-num">Bezug (kW)</th><th class="eb-num">Einspeisung (kW)</th>
          <th class="eb-num">maßgebend (kW)</th><th>Richtung</th>
          <th class="eb-num">Auslastung</th><th class="eb-num">Reserve (kW)</th>
        </tr></thead>
        <tbody>${t.map(r => `
          <tr class="eb-klick" data-click="ebSpringeZu('${r.id}','asset')">
            <td>${_esc(r.name)}</td>
            <td class="eb-num">${_num(r.kva, 0)}</td>
            <td class="eb-num">${r.ukPct != null ? _num(r.ukPct, 1) : '—'}</td>
            <td class="eb-num">${_num(r.bezugKw, 0)}</td>
            <td class="eb-num">${_num(r.einspKw, 0)}</td>
            <td class="eb-num">${_num(r.massgebendKw, 0)}</td>
            <td class="eb-mut">${r.richtung}</td>
            <td class="eb-num eb-${AMPEL[r.stufe]}">${_num(r.auslastung, 0)} %</td>
            <td class="eb-num">${_num(r.reserveKw, 0)}</td>
          </tr>`).join('')}</tbody></table>
        <div class="eb-hinweis">Maßgebend ist der größere Wert aus Bezug und Rückspeisung: ein Transformator überträgt in
          beide Richtungen, 800 kW Einspeisung belasten ihn genauso wie 800 kW Bezug. Reserve = Sr × 0,90 − maßgebende Last.</div>`;

  const kat = { infrastruktur: 'Infrastruktur', verbraucher: 'Verbraucher', erzeuger: 'Erzeuger', speicher: 'Speicher' };
  const anlagenRows = _modell.anlagen.map(a => `
    <tr>
      <td>${a.icon} ${_esc(a.label)}</td>
      <td class="eb-mut">${kat[a.kategorie] || a.kategorie}</td>
      <td class="eb-num">${a.n}</td>
      <td class="eb-num">${a.verbrauchKw > 0 ? _num(a.verbrauchKw, 1) : '—'}</td>
      <td class="eb-num">${a.erzeugungKw > 0 ? _num(a.erzeugungKw, 1) : '—'}</td>
    </tr>`).join('');
  const sumV = _modell.anlagen.reduce((s, a) => s + a.verbrauchKw, 0);
  const sumE = _modell.anlagen.reduce((s, a) => s + a.erzeugungKw, 0);
  const anlagenTab = `<table class="eb-tab">
    <thead><tr><th>Anlagentyp</th><th>Kategorie</th><th class="eb-num">Anzahl</th>
      <th class="eb-num">Verbrauch (kW)</th><th class="eb-num">Erzeugung (kW)</th></tr></thead>
    <tbody>${anlagenRows}</tbody>
    <tfoot><tr><td colspan="2">Summe</td><td class="eb-num">${_modell.kpi.nAssets}</td>
      <td class="eb-num">${_num(sumV, 1)}</td><td class="eb-num">${_num(sumE, 1)}</td></tr></tfoot></table>`;

  return `
  ${_abschnitt('Transformatoren', trafoTab)}
  ${_abschnitt('Angeschlossene Anlagen nach Typ', anlagenTab)}`;
}

// ── Kabel ────────────────────────────────────────────────────────────────────

const KABEL_SPALTEN = [
  ['von',         'Strecke',      false],
  ['ebene',       'Ebene',        false],
  ['typ',         'Kabel',        false],
  ['laengeM',     'Länge (m)',    true],
  ['bezugKw',     'Bezug (kW)',   true],
  ['einspKw',     'Einsp. (kW)',  true],
  ['stromA',      'Ib (A)',       true],
  ['izA',         'Iz eff (A)',   true],
  ['auslastung',  'Auslastung',   true],
  ['duSegment',   'ΔU Abschn.',   true],
  ['duKum',       'ΔU kum.',      true],
  ['sicherungA',  'Sicherung',    true],
];

function _viewKabel() {
  let rows = _modell.kabel;
  if (EB.nurKritisch) rows = rows.filter(k => k.stufe > 0);
  const f = EB.kabelSort;
  rows = [...rows].sort((a, b) => {
    const va = a[f], vb = b[f];
    const c = (typeof va === 'string') ? String(va).localeCompare(String(vb), 'de') : (va || 0) - (vb || 0);
    return EB.kabelDesc ? -c : c;
  });

  const kopf = KABEL_SPALTEN.map(([id, label, num]) =>
    `<th class="${num ? 'eb-num ' : ''}eb-sortierbar${EB.kabelSort === id ? ' is-sort' : ''}"
         data-click="ebSortKabel('${id}')">${label}${EB.kabelSort === id ? (EB.kabelDesc ? ' ▾' : ' ▴') : ''}</th>`).join('');

  const body = rows.map(k => `
    <tr class="eb-klick" data-click="ebSpringeZu('${k.id}','kabel')">
      <td>${_esc(k.von)} → ${_esc(k.nach)}</td>
      <td class="eb-mut">${k.ebene}</td>
      <td>${k.nParallel > 1 ? k.nParallel + '× ' : ''}${_esc(k.typ)} ${k.querschnitt || '—'} mm²${k.gedeckelt ? ' <span class="eb-warn" title="Am Katalogende gedeckelt">⚠</span>' : ''}</td>
      <td class="eb-num">${_num(k.laengeM, 0)}</td>
      <td class="eb-num">${_num(k.bezugKw, 1)}</td>
      <td class="eb-num">${k.einspKw > 0 ? _num(k.einspKw, 1) : '—'}</td>
      <td class="eb-num">${_num(k.stromA, 0)}</td>
      <td class="eb-num">${_num(k.izA, 0)}</td>
      <td class="eb-num eb-${AMPEL[_stufe(k.auslastung, 80, 100)]}">${_num(k.auslastung, 0)} %</td>
      <td class="eb-num">${k.ebene === 'MS' ? '—' : _num(k.duSegment, 2) + ' %'}</td>
      <td class="eb-num eb-${AMPEL[_stufe(_duBetrag(k.duKum), MAX_DELTA_U_PCT * 2 / 3, MAX_DELTA_U_PCT)]}">${_num(k.duKum, 2)} %</td>
      <td class="eb-num${k.sicherungKritisch ? ' eb-bad' : ''}">${k.sicherungA ? k.sicherungA + ' A' : '—'}</td>
    </tr>`).join('');

  const sumL = rows.reduce((s, k) => s + k.laengeM, 0);
  const filter = `
    <label class="eb-filter">
      <input type="checkbox" ${EB.nurKritisch ? 'checked' : ''} data-change="ebToggleKritisch()"/>
      nur Auffälligkeiten
    </label>
    <span class="eb-mut">${rows.length} von ${_modell.kabel.length} Strecken · ${_laenge(sumL)}</span>`;

  return _abschnitt('Kabelstrecken', `
    <div class="eb-toolbar">${filter}</div>
    <div class="eb-scroll">
      <table class="eb-tab eb-tab-kompakt">
        <thead><tr>${kopf}</tr></thead>
        <tbody>${body || '<tr><td colspan="12" class="eb-mut">Keine Strecke in dieser Auswahl.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="eb-hinweis">Ib = Betriebsstrom im gerechneten Worst Case, Iz eff = Strombelastbarkeit nach Korrektur
      (kIz ${_num(_modell.kpi.kIz ?? 1, 2)}). ΔU kum. ist der Spannungsfall vom speisenden Knoten bis zum Ende dieser
      Strecke — nur er wird gegen das ${MAX_DELTA_U_PCT}-%-Limit geprüft. Ein negativer Wert ist eine Spannungsanhebung
      durch Rückspeisung und zählt genauso.<span class="eb-nurpanel"> Zeile anklicken springt zum Kabel auf der Karte.</span></div>`);
}

// ── Knoten ───────────────────────────────────────────────────────────────────

function _viewKnoten() {
  let rows = _modell.knoten;
  if (EB.nurKritisch) rows = rows.filter(n => n.stufe > 0);
  const hatIk = _modell.knoten.some(n => n.ikMinKa != null);

  const body = rows.map(n => `
    <tr class="eb-klick" data-click="ebSpringeZu('${n.id}','asset')">
      <td>${_esc(n.name)}</td>
      <td class="eb-mut">${_esc(n.typ)}</td>
      <td class="eb-num">${n.verbrauchKw > 0 ? _num(n.verbrauchKw, 1) : '—'}</td>
      <td class="eb-num">${n.erzeugungKw > 0 ? _num(n.erzeugungKw, 1) : '—'}</td>
      <td class="eb-num eb-${AMPEL[n.stufe]}">${n.duKum == null ? '—' : _num(n.duKum, 2) + ' %'}</td>
      ${hatIk ? `<td class="eb-num">${n.ikMinKa == null ? '—' : _num(n.ikMinKa, 2)}</td>
                 <td class="eb-num">${n.ikMaxKa == null ? '—' : _num(n.ikMaxKa, 2)}</td>` : ''}
    </tr>`).join('');

  return _abschnitt('Knoten', `
    <div class="eb-toolbar">
      <label class="eb-filter">
        <input type="checkbox" ${EB.nurKritisch ? 'checked' : ''} data-change="ebToggleKritisch()"/>
        nur Auffälligkeiten
      </label>
      <span class="eb-mut">${rows.length} von ${_modell.knoten.length} Knoten</span>
    </div>
    <div class="eb-scroll">
      <table class="eb-tab eb-tab-kompakt">
        <thead><tr>
          <th>Knoten</th><th>Typ</th>
          <th class="eb-num">Verbrauch (kW)</th><th class="eb-num">Erzeugung (kW)</th>
          <th class="eb-num">ΔU kumuliert</th>
          ${hatIk ? '<th class="eb-num">Ik″ min (kA)</th><th class="eb-num">Ik″ max (kA)</th>' : ''}
        </tr></thead>
        <tbody>${body || '<tr><td colspan="7" class="eb-mut">Kein Knoten in dieser Auswahl.</td></tr>'}</tbody>
      </table>
    </div>
    ${hatIk ? '' : `<div class="eb-hinweis">Kurzschlussströme stehen erst nach einer Lastflussrechnung im Netz-Tab zur Verfügung —
      der Asset-Rechenpfad ermittelt Spannungsfall und Auslastung, aber kein Ik″.</div>`}`);
}

// ── Mengen & Kosten ──────────────────────────────────────────────────────────

function _viewMengen() {
  const m = _modell.mengen;
  const mengenRows = m.map(z => {
    const kabelM   = z.laengeM * z.nParallel;   // Parallelstränge liegen in derselben Trasse
    const material = z.eurM != null ? kabelM * z.eurM : null;
    return `<tr>
      <td>${z.nParallel > 1 ? z.nParallel + '× ' : ''}${_esc(z.typ)} ${z.querschnitt || '—'} mm²</td>
      <td class="eb-num">${z.n}</td>
      <td class="eb-num">${_num(z.laengeM, 0)}</td>
      <td class="eb-num">${_num(kabelM, 0)}</td>
      <td class="eb-num">${z.eurM != null ? z.eurM + ' €/m' : '—'}</td>
      <td class="eb-num">${material != null ? _eur(material) : '—'}</td>
    </tr>`;
  }).join('');
  const kabelMGesamt = m.reduce((s, z) => s + z.laengeM * z.nParallel, 0);
  const materialGesamt = m.reduce((s, z) => s + (z.eurM != null ? z.laengeM * z.nParallel * z.eurM : 0), 0);
  const mengenTab = `<table class="eb-tab">
    <thead><tr><th>Kabeltyp / Querschnitt</th><th class="eb-num">Strecken</th>
      <th class="eb-num">Trasse (m)</th><th class="eb-num">Kabel (m)</th>
      <th class="eb-num">Material</th><th class="eb-num">Materialkosten</th></tr></thead>
    <tbody>${mengenRows}</tbody>
    <tfoot><tr><td>Summe</td><td class="eb-num">${_modell.kabel.length}</td>
      <td class="eb-num">${_num(_modell.kpi.laengeGesamt, 0)}</td>
      <td class="eb-num">${_num(kabelMGesamt, 0)}</td><td></td>
      <td class="eb-num">${_eur(materialGesamt)}</td></tr></tfoot></table>
    <div class="eb-hinweis">Trasse = Grabenlänge, Kabel = tatsächlich zu verlegende Kabellänge (Parallelstränge zählen
      mehrfach). Materialpreise aus dem Kabelkatalog (config/netz-kosten.js), ohne Tiefbau. <b>Achtung:</b> die
      Investitionsrechnung unten kennt keine Parallelstränge und rechnet je Trassenmeter nur ein Kabel —
      bei mehrsträngigen Abschnitten liegt sie um die Differenz zu niedrig.</div>`;

  const k = _modell.kosten;
  const kostenTab = !k ? `<div class="eb-hinweis">Noch keine Kostenrechnung vorhanden.</div>` : (() => {
    const zeilen = [
      ['Kabel inkl. Tiefbau', k.kabelInvest],
      ['Transformatoren', k.trafoInvest],
      ['Netzanknüpfungspunkte', k.napInvest],
    ];
    const rows = zeilen.map(([l, v]) => `
      <tr><td>${l}</td><td class="eb-num">${_eur(v || 0)}</td>
      <td class="eb-num eb-mut">${k.investGesamt ? _num((v || 0) / k.investGesamt * 100, 0) + ' %' : '—'}</td></tr>`).join('');
    const spezKw = _modell.kpi.massgebendKw > 0 ? k.investGesamt / _modell.kpi.massgebendKw : null;
    const spezM  = k.trasseLaenge > 0 ? k.investGesamt / k.trasseLaenge : null;
    return `
    <table class="eb-tab">
      <thead><tr><th>Position</th><th class="eb-num">Investition</th><th class="eb-num">Anteil</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Investition gesamt</td><td class="eb-num">${_eur(k.investGesamt || 0)}</td><td></td></tr></tfoot>
    </table>
    <div class="eb-kacheln" style="margin-top:8px;">
      ${_kachel('Annuität', _eur(k.annuitaet || 0), '', null, 'Kapitaldienst + 1 % Instandhaltung nach VDI 2067')}
      ${_kachel('Spezifisch je kW', spezKw != null ? _eur(spezKw) : '—', '', null, 'Investition je kW maßgebender Netzlast')}
      ${_kachel('Spezifisch je Trassenmeter', spezM != null ? _eur(spezM) : '—', '')}
    </div>`;
  })();

  return `
  ${_abschnitt('Querschnittsspiegel', mengenTab)}
  ${_abschnitt('Investition und Annuität', kostenTab)}`;
}

// ── Annahmen ─────────────────────────────────────────────────────────────────

function _viewAnnahmen() {
  let letzteGruppe = '';
  const rows = _modell.annahmen.map(([gruppe, was, wert]) => {
    const kopf = gruppe !== letzteGruppe
      ? `<tr class="eb-gruppe"><td colspan="2">${_esc(gruppe)}</td></tr>` : '';
    letzteGruppe = gruppe;
    return kopf + `<tr><td>${_esc(was)}</td><td class="eb-num">${_esc(wert)}</td></tr>`;
  }).join('');

  const warnungen = _modell.kopf.warnungen.length
    ? `<div class="eb-hinweis">${_modell.kopf.warnungen.map(_esc).join('<br/>')}</div>` : '';

  return `
  ${_abschnitt('Rechenparameter', `<table class="eb-tab eb-tab-schmal"><tbody>${rows}</tbody></table>`)}
  ${_abschnitt('Rechenweg', `
    <ul class="eb-liste">
      <li>Lastfluss als Worst Case: Bezug und Einspeisung werden getrennt aufsummiert und nicht gegeneinander bilanziert.
          Maßgebend ist die größere der beiden Richtungen.</li>
      <li>Kabelauslegung nach Strombelastbarkeit (Iz mit Korrekturfaktoren, IEC 60364-5-52) UND Spannungsfall;
          das ΔU-Budget wird längenanteilig über den Pfad verteilt, damit der kumulierte Wert am Stichende das Limit hält.</li>
      <li>Auto-dimensionierte Kabel wachsen mit der Last; von Hand gesetzte oder aus Bestandsplänen übernommene
          Querschnitte bleiben unverändert und werden nur bewertet.</li>
      <li>Gleichzeitigkeit wirkt nur auf Verbraucher, nicht auf Erzeugung — eine PV-Anlage speist ungedämpft ein.</li>
      <li>Trafo-Auslastung bezogen auf Sr × cos φ 0,90.</li>
    </ul>
    ${warnungen}`)}`;
}

// ── Bausteine ────────────────────────────────────────────────────────────────

function _abschnitt(titel, inhalt) {
  return `<div class="eb-sec"><div class="eb-sec-titel">${titel}</div>${inhalt}</div>`;
}

// ── Druckfassung ─────────────────────────────────────────────────────────────

// Bedienelemente aus dem Blatt nehmen: im Druck gibt es nichts zu klicken, zu
// sortieren oder zu filtern — Sortierpfeile und Filterzeilen wären dort Rauschen.
function _fuerDruck(html) {
  return html
    .replace(/\sdata-click="[^"]*"/g, '')
    .replace(/\sdata-change="[^"]*"/g, '')
    // Filterzeile → schlichter Mengenhinweis („6 von 6 Strecken · 614 m")
    .replace(/<div class="eb-toolbar">[\s\S]*?<span class="eb-mut">([^<]*)<\/span>\s*<\/div>/g,
             '<div class="eb-hinweis">$1</div>')
    .replace(/ [▾▴]/g, '');
}

/** Alle Register in einem druckbaren Fenster (A4 quer, helles Layout). */
export function ebDrucken() {
  if (!_modell) { showHint('⚠ Erst rechnen — dann liegt ein Ergebnis zum Drucken vor.'); return; }
  const merk = { tab: EB.tab, krit: EB.nurKritisch };
  EB.nurKritisch = false;   // im Druck steht die vollständige Liste

  const teile = [];
  for (const [id, label] of TABS) {
    EB.tab = id;
    teile.push(`<section><h2>${label.replace('&amp;', '&')}</h2>${_fuerDruck(_tabInhalt())}</section>`);
  }
  EB.tab = merk.tab; EB.nurKritisch = merk.krit;
  _render();

  const k = _modell.kopf;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Ergebnisblatt Elektro — ${_esc(k.projekt)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 9pt; color: #1a1a1a; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; border-bottom: 1px solid #999; padding-bottom: 1mm; page-break-after: avoid; }
  .meta { color: #555; font-size: 8.5pt; margin-bottom: 4mm; }
  .meta span { margin-right: 10px; }
  section { page-break-inside: auto; }
  .eb-sec-titel { font-weight: 600; margin: 4mm 0 1.5mm; font-size: 9.5pt; }
  table.eb-tab { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
  table.eb-tab th, table.eb-tab td { border: 1px solid #bbb; padding: 1mm 1.5mm; text-align: left; font-size: 8pt; }
  table.eb-tab th { background: #eee; font-weight: 600; }
  table.eb-tab tfoot td { font-weight: 600; background: #f6f6f6; }
  tr.eb-gruppe td { background: #f0f0f0; font-weight: 600; }
  .eb-num { text-align: right; white-space: nowrap; }
  .eb-mut { color: #666; }
  .eb-ok { color: #1b7f2c; } .eb-warn { color: #a06a00; } .eb-bad { color: #c62828; font-weight: 600; }
  .eb-kacheln { display: flex; flex-wrap: wrap; gap: 2mm; margin-bottom: 2mm; }
  .eb-kachel { border: 1px solid #bbb; border-radius: 2mm; padding: 1.5mm 3mm; min-width: 34mm; }
  .eb-kachel-label { font-size: 7pt; color: #555; text-transform: uppercase; letter-spacing: .04em; }
  .eb-kachel-wert { font-size: 12pt; font-weight: 600; }
  .eb-kachel-einheit { font-size: 8pt; font-weight: 400; color: #555; }
  .eb-kachel.is-warn { border-color: #a06a00; } .eb-kachel.is-bad { border-color: #c62828; }
  .eb-hinweis { font-size: 7.5pt; color: #555; margin: 1mm 0 3mm; line-height: 1.45; }
  .eb-befund { border-left: 2.5pt solid #999; padding: 1mm 0 1mm 2.5mm; margin-bottom: 2mm; page-break-inside: avoid; }
  .eb-befund.is-bad { border-color: #c62828; } .eb-befund.is-warn { border-color: #a06a00; }
  .eb-befund-kopf { font-weight: 600; }
  .eb-chip { display: inline-block; border: 1px solid #ccc; border-radius: 1mm; padding: 0 1.5mm; margin: .4mm 1mm .4mm 0; font-size: 7.5pt; }
  .eb-liste { margin: 0 0 2mm 4mm; padding: 0; line-height: 1.5; }
  .eb-liste li { margin-bottom: 1mm; }
  .eb-toolbar, .eb-filter, .eb-nurpanel { display: none; }
  .eb-scroll { overflow: visible; }
  .druckleiste { margin-bottom: 4mm; }
  @media print { .druckleiste { display: none; } }
</style></head><body>
<div class="druckleiste"><button onclick="window.print()">🖨 Drucken / Als PDF speichern</button></div>
<h1>Ergebnisblatt Elektroberechnung</h1>
<div class="meta">
  <span><b>${_esc(k.projekt)}</b></span>
  <span>Variante: ${_esc(k.variante)}</span>
  <span>Betrachtungsjahr: ${k.jahr}</span>
  <span>Rechenstand: ${k.gerechnetAm.toLocaleString('de-DE')}</span>
</div>
${teile.join('\n')}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showHint('⚠ Popup blockiert — bitte für diese Seite erlauben.'); return; }
  win.document.write(html);
  win.document.close();
}

// ── CSV-Export ───────────────────────────────────────────────────────────────

const _csvZelle = v => {
  const s = String(v ?? '').replace(/"/g, '""');
  return /[;"\n]/.test(s) ? `"${s}"` : s;
};
const _csvZeile = arr => arr.map(_csvZelle).join(';') + '\n';
const _csvZahl  = (v, d = 2) => (v == null || !isFinite(v)) ? '' : Number(v).toFixed(d).replace('.', ',');

/** Alle Tabellen des Blatts als eine CSV-Datei (Semikolon, BOM für Excel). */
export function ebCsvExport() {
  if (!_modell) { showHint('⚠ Erst rechnen — dann gibt es Zahlen zu exportieren.'); return; }
  const m = _modell;
  let csv = '';

  csv += _csvZeile(['Ergebnisblatt Elektroberechnung']);
  csv += _csvZeile(['Projekt', m.kopf.projekt]);
  csv += _csvZeile(['Variante', m.kopf.variante]);
  csv += _csvZeile(['Betrachtungsjahr', m.kopf.jahr]);
  csv += _csvZeile(['Rechenstand', m.kopf.gerechnetAm.toLocaleString('de-DE')]);
  csv += '\n';

  csv += _csvZeile(['KENNZAHLEN']);
  csv += _csvZeile(['Kennzahl', 'Wert', 'Einheit']);
  csv += _csvZeile(['Anschlussleistung Verbrauch', _csvZahl(m.kpi.verbrauchKw, 1), 'kW']);
  csv += _csvZeile(['Einspeiseleistung', _csvZahl(m.kpi.erzeugungKw, 1), 'kW']);
  csv += _csvZeile(['Maßgebende Netzlast', _csvZahl(m.kpi.massgebendKw, 1), 'kW']);
  csv += _csvZeile(['Trafo-Auslastung max', _csvZahl(m.kpi.maxTrafo, 1), '%']);
  csv += _csvZeile(['Kabel-Auslastung max', _csvZahl(m.kpi.maxKabel, 1), '%']);
  csv += _csvZeile(['Spannungsfall max (kumuliert)', _csvZahl(m.kpi.maxDu, 2), '%']);
  csv += _csvZeile(['Trassenlänge gesamt', _csvZahl(m.kpi.laengeGesamt, 0), 'm']);
  csv += _csvZeile(['davon Mittelspannung', _csvZahl(m.kpi.laengeMs, 0), 'm']);
  csv += _csvZeile(['Betriebsmittel', m.kpi.nAssets, 'Stk']);
  csv += _csvZeile(['Kabelstrecken', m.kpi.nKabel, 'Stk']);
  csv += '\n';

  csv += _csvZeile(['TRANSFORMATOREN']);
  csv += _csvZeile(['Name', 'Sr (kVA)', 'uk (%)', 'Bezug (kW)', 'Einspeisung (kW)', 'maßgebend (kW)', 'Richtung', 'Auslastung (%)', 'Reserve (kW)']);
  for (const t of m.trafos) {
    csv += _csvZeile([t.name, _csvZahl(t.kva, 0), _csvZahl(t.ukPct, 1), _csvZahl(t.bezugKw, 1),
      _csvZahl(t.einspKw, 1), _csvZahl(t.massgebendKw, 1), t.richtung, _csvZahl(t.auslastung, 1), _csvZahl(t.reserveKw, 1)]);
  }
  csv += '\n';

  csv += _csvZeile(['KABELSTRECKEN']);
  csv += _csvZeile(['Von', 'Nach', 'Ebene', 'Kabeltyp', 'Querschnitt (mm²)', 'Parallel', 'Länge (m)',
    'Bezug (kW)', 'Einspeisung (kW)', 'Ib (A)', 'Iz eff (A)', 'Auslastung (%)',
    'ΔU Abschnitt (%)', 'ΔU kumuliert (%)', 'Sicherung (A)', 'Auslegung']);
  for (const k of m.kabel) {
    csv += _csvZeile([k.von, k.nach, k.ebene, k.typ, k.querschnitt, k.nParallel, _csvZahl(k.laengeM, 1),
      _csvZahl(k.bezugKw, 1), _csvZahl(k.einspKw, 1), _csvZahl(k.stromA, 1), _csvZahl(k.izA, 1),
      _csvZahl(k.auslastung, 1), _csvZahl(k.duSegment, 3), _csvZahl(k.duKum, 3),
      k.sicherungA || '', k.autoSized ? 'automatisch' : 'gesetzt']);
  }
  csv += '\n';

  csv += _csvZeile(['KNOTEN']);
  csv += _csvZeile(['Name', 'Typ', 'Verbrauch (kW)', 'Erzeugung (kW)', 'ΔU kumuliert (%)', 'Ik min (kA)', 'Ik max (kA)']);
  for (const n of m.knoten) {
    csv += _csvZeile([n.name, n.typ, _csvZahl(n.verbrauchKw, 1), _csvZahl(n.erzeugungKw, 1),
      _csvZahl(n.duKum, 3), _csvZahl(n.ikMinKa, 3), _csvZahl(n.ikMaxKa, 3)]);
  }
  csv += '\n';

  csv += _csvZeile(['QUERSCHNITTSSPIEGEL']);
  csv += _csvZeile(['Kabeltyp', 'Querschnitt (mm²)', 'Parallel', 'Strecken', 'Trasse (m)', 'Kabel (m)', 'Material (€/m)', 'Materialkosten (€)']);
  for (const z of m.mengen) {
    csv += _csvZeile([z.typ, z.querschnitt, z.nParallel, z.n, _csvZahl(z.laengeM, 1),
      _csvZahl(z.laengeM * z.nParallel, 1), _csvZahl(z.eurM, 2),
      _csvZahl(z.eurM != null ? z.laengeM * z.nParallel * z.eurM : null, 2)]);
  }
  csv += '\n';

  if (m.kosten) {
    csv += _csvZeile(['KOSTEN']);
    csv += _csvZeile(['Position', 'Betrag (€)']);
    csv += _csvZeile(['Kabel inkl. Tiefbau', _csvZahl(m.kosten.kabelInvest, 0)]);
    csv += _csvZeile(['Transformatoren', _csvZahl(m.kosten.trafoInvest, 0)]);
    csv += _csvZeile(['Netzanknüpfungspunkte', _csvZahl(m.kosten.napInvest, 0)]);
    csv += _csvZeile(['Investition gesamt', _csvZahl(m.kosten.investGesamt, 0)]);
    csv += _csvZeile(['Annuität p. a.', _csvZahl(m.kosten.annuitaet, 0)]);
    csv += '\n';
  }

  csv += _csvZeile(['ANNAHMEN']);
  csv += _csvZeile(['Gruppe', 'Parameter', 'Wert']);
  for (const [g, w, v] of m.annahmen) csv += _csvZeile([g, w, v]);

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = projektExportFilename('ergebnisblatt-elektro', 'csv');
  a.click();
  URL.revokeObjectURL(a.href);
}
