// ── 19-el-ergebnisblatt.js — Ergebnisblatt der Elektroberechnung ─────────────
//
// Ein Blatt, das die Rechnung vollständig aufschreibt — nicht drei Kennzahlen
// im Panel und der Rest im Tooltip. Zielbild ist die Anlage zum Gutachten:
// jemand, der das Netz nicht kennt, muss aus diesem Blatt ablesen können, was
// gerechnet wurde, mit welchen Annahmen, was herauskam und wo es klemmt.
//
// Ein durchgehendes Dokument, dessen Kapitel der Rechnung folgen:
//   1 Ergebnis        — Urteil, Nachweise mit Grenzmarke, Handlungsbedarf
//   2 Last            — Lastbilanz: woraus sich Bezug und Einspeisung zusammensetzen
//   3 Netz je Station — Station → Abgang → Strecke, je Strecke die Rechnung
//   4 Knoten          — Spannungsfall und Kurzschlussstrom je Anlage
//   5 Mengen & Kosten — Querschnittsspiegel, Investition, Annuität
//   6 Annahmen        — nur Werte, die in diese Rechnung eingehen
// Bildschirm und Druck zeigen dieselben Kapitel.
//
// Das Blatt RECHNET NICHT. Es liest ausschließlich, was elCalcAssets() an
// Assets, Kanten und Knoten hinterlassen hat (inkl. Ergebnis-Stempel
// window._elErgebnisStand, Herkunft der Last _calcHinter und Netzstruktur
// _calcPfad/_calcSpeis). Damit kann es nie ein anderes Ergebnis zeigen als
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

const KAPITEL = [
  ['ergebnis', 'Ergebnis'],
  ['last',     'Last'],
  ['netz',     'Netz je Station'],
  ['knoten',   'Knoten'],
  ['mengen',   'Mengen &amp; Kosten'],
  ['annahmen', 'Annahmen'],
];

// Ansichtszustand (nicht Teil des Projekts — nur wie das Blatt gerade aufgeklappt ist)
const EB = {
  nurKritisch: false,   // Netz/Knoten auf Auffälligkeiten reduzieren
  offen: new Set(),     // von Hand aufgeklappte Stationen/Abgänge (Schlüssel)
  zu: new Set(),        // von Hand zugeklappte — überstimmt die Vorgabe
  rechnung: null,       // Kante, deren Rechnung aufgeklappt ist
};

let _modell = null;     // letztes gesammeltes Ergebnis (auch für Druck/CSV)

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

// Für Werte in data-click="fn('…')"
const _arg = s => String(s ?? '').replace(/['"\\<>&]/g, '');

// Ampel: 0 = ok, 1 = Warnung, 2 = kritisch. Der Grenzwert selbst gilt noch als
// eingehalten (100 % Auslastung ist zulaessig, 100,1 % nicht) — sonst widerspraeche
// die Balkenfarbe dem Grenzwertnachweis, der mit ≤ prueft.
const AMPEL = ['ok', 'warn', 'bad'];
const _stufe = (wert, warnAb, kritAb) => wert > kritAb ? 2 : wert >= warnAb ? 1 : 0;
const DU_WARN = MAX_DELTA_U_PCT * 2 / 3;

// Spannungsfall wird mit Vorzeichen gefuehrt: negativ = Spannungsanhebung durch
// Rueckspeisung. Fuer Bewertung und Grenzwert zaehlt der Betrag.
const _duBetrag = v => Math.abs(v ?? 0);

// Balken mit Grenzmarke: Skala bis 150 % der Grenze, die Marke sitzt bei 2/3.
function _balken(wert, grenze, stufe, klein = false) {
  const w = grenze > 0 ? Math.max(0, Math.min(100, wert / (grenze * 1.5) * 100)) : 0;
  return `<span class="eb-balken${klein ? ' eb-balken-k' : ''}"><i class="is-${AMPEL[stufe]}" style="width:${w.toFixed(1)}%"></i><u></u></span>`;
}
// Tabellenzelle: kleiner Balken + Wert
const _zelle = (wert, grenze, stufe, text) =>
  `<span class="eb-zb">${_balken(wert, grenze, stufe, true)}<span class="eb-${AMPEL[stufe]}">${text}</span></span>`;

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

// Lage eines Knotens für die Nummerierung der Abgänge
function _lage(id) {
  const a = (ASSETS.items || []).find(x => x.id === id);
  if (a?.lat != null && a?.lng != null) return [a.lat, a.lng];
  const n = (window.stromNodes || []).find(x => x.id === id);
  if (n?.lat != null && n?.lng != null) return [n.lat, n.lng];
  return null;
}

const HIMMEL = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
// Richtung von a nach b in Grad (0 = Nord, im Uhrzeigersinn)
function _richtung(a, b) {
  if (!a || !b) return null;
  const dy = b[0] - a[0];
  const dx = (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180);
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

// Woraus sich eine Anlagenleistung ergibt — Text zu den Regeln in elCalcAssets
// (assetVerbrauch/assetErzeugung). Nur Beschriftung, keine Rechnung.
const HERKUNFT = {
  Verbraucher: 'Anschlussleistung',
  Lade:        'Ladepunkte × kW × eigener Faktor + Schnelllader',
  WP:          'elektrische Leistung',
  Geo:         'elektrische Leistung',
  FG:          'elektrische Leistung',
  Stromkessel: 'Nennleistung',
  PV:          '0,8 × kWp',
  Wind:        'Nennleistung',
  KWK:         'elektrische Nennleistung',
};

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
  const assetById = new Map(assets.map(a => [a.id, a]));
  const edges  = (window.stromEdges || []).filter(e => e._calcJahr != null);
  const nodes  = window.stromNodes || [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  // Kumulierter ΔU je Knoten: Anlagen tragen ihn als Stempel, sonst Strom-Knoten
  const duKnoten = id => assetById.get(id)?._calcDuKumPct ?? nodeById.get(id)?._deltaUKumPct ?? null;

  // ── Kabel ──
  const kabel = edges.map(e => {
    const kt   = KABEL_TYPEN[e.cableType] || {};
    const pf   = e._calcPfad || null;
    const hi   = e._calcHinter || null;
    // Station/Abgang: aus der Pfad-BFS; Gebäudeanschlüsse (nicht Teil der
    // Pfad-BFS) erben die Zuordnung ihrer Anlage.
    let speisId = pf?.speisId ?? null, abgangId = pf?.abgangId ?? null;
    let vonId = pf?.von ?? e.u, nachId = pf?.nach ?? e.v;
    if (!pf) {
      const a = assetById.get(e.u) || assetById.get(e.v);
      if (a) {
        vonId = a.id; nachId = a.id === e.u ? e.v : e.u;
        if (a._calcSpeis) { speisId = a._calcSpeis.speisId; abgangId = a._calcSpeis.abgangId ?? e.id; }
      }
    }
    // ΔU kumuliert am Kabelende: mit Pfad ist das der Zielknoten; sonst der
    // Knoten mit dem größeren Betrag. Bei Rückspeisung negativ (Spannungsanhebung).
    let duKum;
    if (pf) duKum = pf.duNachPct ?? duKnoten(pf.nach) ?? 0;
    else {
      const duU = duKnoten(e.u) ?? 0, duV = duKnoten(e.v) ?? 0;
      duKum = _duBetrag(duU) >= _duBetrag(duV) ? duU : duV;
    }
    const ausl = e.auslastungPct || 0;
    const bezugKw = e.peakFlowKw_V ?? 0, einspKw = e.peakFlowKw_G ?? 0;
    const sicherungKritisch = (e.fuseA > 0 && e.peakCurrentA > e.fuseA);
    const ms = !!e.msLevel;

    // Gründe, die eine Strecke auffällig machen (Stufe, Text). ΔU zwischen 2/3
    // und Grenze färbt nur den Balken: die Auslegung zielt bewusst auf das
    // Budget, jedes Stichende läge sonst im Handlungsbedarf.
    const gruende = [];
    if (ausl > 100)      gruende.push([2, `Auslastung ${_num(ausl, 0)} % > 100 %`]);
    else if (ausl > 80)  gruende.push([1, `Auslastung ${_num(ausl, 0)} %, keine Reserve`]);
    if (!ms && _duBetrag(duKum) > MAX_DELTA_U_PCT) gruende.push([2, `ΔU ${_num(duKum, 2)} % > ${MAX_DELTA_U_PCT} %`]);
    if (sicherungKritisch) gruende.push([2, `Sicherung ${e.fuseA} A < Ib ${_num(e.peakCurrentA, 0)} A`]);
    if (e._auslegungGedeckelt) gruende.push([1, 'größter Querschnitt reicht nicht']);

    return {
      id: e.id, edge: e,
      vonId, nachId,
      von: _knotenLabel(vonId), nach: _knotenLabel(nachId),
      speisId, abgangId, idx: pf?.idx ?? 1e9,
      ausgelegt: !!hi, hinter: hi,
      duVon: pf ? (pf.duVonPct ?? duKnoten(pf.von)) : null,
      ebene: ms ? 'MS' : 'NS',
      typ: e.cableType || '—',
      material: kt.material || '',   // Cu/Al — für Mengengerüst und Nachweis
      querschnitt: e._effCrossSection || e.crossSection || 0,
      nParallel: Math.max(1, e.nParallel || 1),
      laengeM: e.lengthM || 0,
      bezugKw, einspKw,
      massgebendKw: e.peakFlowKw ?? Math.max(bezugKw, einspKw),
      rueckspeisung: einspKw > bezugKw,
      stromA: e.peakCurrentA || 0,
      izKatA: e.ratedCurrentA ?? null,
      izA: e._izEff ?? e.ratedCurrentA ?? 0,
      kIz: e._kIz ?? null,
      duBudget: e._duBudgetPct ?? null,
      auslastung: ausl,
      duSegment: e.deltaUPct || 0,
      duKum,
      sicherungA: e.fuseA || 0,
      sicherungKritisch,
      gedeckelt: !!e._auslegungGedeckelt,
      autoSized: e.autoSized !== false,
      gruende,
      stufe: gruende.reduce((m, g) => Math.max(m, g[0]), 0),
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
      // Anteil im Normalbetrieb — nur der lässt sich über Trafos summieren
      anteilBezugKw: a._calcAnteilKwV ?? a._calcPeakLoadKwV ?? 0,
      anteilEinspKw: a._calcAnteilKwG ?? a._calcPeakLoadKwG ?? 0,
      parallel: a._calcParallel || null,
      gebKw: a._calcGebKw || 0, nGeb: a._calcNGeb || 0,
      massgebendKw: kw,
      richtung: a._calcFlowDirection === -1 ? 'Rückspeisung' : 'Bezug',
      auslastung: pct,
      // Reserve auf der Wirkleistungsseite (kVA × 0,9 — dieselbe Annahme wie im Rechenkern)
      reserveKw: Math.max(0, kva * 0.9 - kw),
      stufe: _stufe(pct, 80, 100),
    };
  }).sort((x, y) => y.auslastung - x.auslastung);
  const trafoById = new Map(trafos.map(t => [t.id, t]));

  // ── Anlagen nach Typ ──
  const nachTyp = new Map();
  for (const a of assets) {
    const k = a.type;
    if (!nachTyp.has(k)) nachTyp.set(k, {
      typ: k, label: ASSET_CFG[k]?.label || k, icon: ASSET_CFG[k]?.icon || '',
      kategorie: ASSET_CFG[k]?.kategorie || 'sonstiges',
      n: 0, nV: 0, nE: 0, verbrauchKw: 0, erzeugungKw: 0,
    });
    const z = nachTyp.get(k);
    z.n++;
    if ((a._calcVerbrauchKw || 0) > 0) z.nV++;
    if ((a._calcErzeugungKw || 0) > 0) z.nE++;
    z.verbrauchKw += a._calcVerbrauchKw || 0;
    z.erzeugungKw += a._calcErzeugungKw || 0;
  }
  const anlagen = [...nachTyp.values()].sort((x, y) =>
    (y.verbrauchKw + y.erzeugungKw) - (x.verbrauchKw + x.erzeugungKw) || y.n - x.n);

  // ── Stationen und Abgänge ──
  const stationen = new Map();
  const _hole = (key, felder) => {
    if (!stationen.has(key)) stationen.set(key, { key, abgaenge: new Map(), ...felder });
    return stationen.get(key);
  };
  for (const k of kabel) {
    let st;
    if (k.ebene === 'MS') {
      st = _hole('ms', { art: 'ms', name: 'Mittelspannung', info: 'Kabel zwischen Netzanknüpfungspunkt und Stationen' });
    } else if (k.speisId) {
      const a = assetById.get(k.speisId);
      st = _hole(k.speisId, {
        art: 'station', id: k.speisId, asset: a,
        name: a?.name || ASSET_CFG[a?.type]?.label || 'Station',
        typ: ASSET_CFG[a?.type]?.label || a?.type || '',
        trafo: trafoById.get(k.speisId) || null,
      });
    } else {
      st = _hole('ohne', { art: 'ohne', name: 'Ohne Zuordnung',
        info: 'Von keiner Station aus erreichbar, z. B. Ringschluss oder Teilnetz ohne Trafo' });
    }
    const aKey = st.art === 'station' ? (k.abgangId || k.id) : st.key;
    if (!st.abgaenge.has(aKey)) st.abgaenge.set(aKey, { key: aKey, kabel: [] });
    st.abgaenge.get(aKey).kabel.push(k);
  }
  for (const st of stationen.values()) {
    const liste = [...st.abgaenge.values()];
    for (const ab of liste) {
      ab.kabel.sort((x, y) => x.idx - y.idx);
      const kopf = ab.kabel.find(k => k.id === ab.key) || ab.kabel[0];
      ab.kopf = kopf;
      ab.laengeM = ab.kabel.reduce((s, k) => s + k.laengeM, 0);
      ab.massgebendKw = kopf?.massgebendKw ?? 0;
      ab.maxAusl = ab.kabel.reduce((m, k) => Math.max(m, k.auslastung), 0);
      ab.maxDu = ab.kabel.reduce((m, k) => _duBetrag(k.duKum) > _duBetrag(m) ? k.duKum : m, 0);
      ab.stufe = ab.kabel.reduce((m, k) => Math.max(m, k.stufe), 0);
      ab.nKrit = ab.kabel.filter(k => k.stufe === 2).length;
      ab.nWarn = ab.kabel.filter(k => k.stufe === 1).length;
      if (st.art === 'station') {
        ab.grad = _richtung(_lage(st.id), _lage(kopf?.nachId));
        ab.ziel = kopf?.nach || '';
      }
    }
    // Abgänge im Uhrzeigersinn ab Norden — bleibt stabil, wenn sich Lasten ändern
    if (st.art === 'station') liste.sort((x, y) => (x.grad ?? 999) - (y.grad ?? 999));
    liste.forEach((ab, i) => {
      ab.nr = i + 1;
      ab.label = st.art === 'station'
        ? `Abgang ${ab.nr}${ab.grad != null ? ' (' + HIMMEL[Math.round(ab.grad / 45) % 8] + ')' : ''}`
        : st.name;
    });
    st.liste = liste;
    st.nKabel = liste.reduce((s, ab) => s + ab.kabel.length, 0);
    st.laengeM = liste.reduce((s, ab) => s + ab.laengeM, 0);
    st.nKrit = liste.reduce((s, ab) => s + ab.nKrit, 0) + (st.trafo?.stufe === 2 ? 1 : 0);
    st.nWarn = liste.reduce((s, ab) => s + ab.nWarn, 0) + (st.trafo?.stufe === 1 ? 1 : 0);
  }
  // Abgang-Beschriftung je Kante (für Handlungsbedarf, Knoten, CSV)
  const ortVon = new Map();
  for (const st of stationen.values()) {
    for (const ab of st.liste) for (const k of ab.kabel) {
      ortVon.set(k.id, st.art === 'station' ? `${st.name} · ${ab.label}` : st.name);
      k.ort = ortVon.get(k.id); k.stationKey = st.key; k.abgangKey = ab.key; k.abgangLabel = ab.label;
    }
  }
  const stationListe = [...stationen.values()].sort((x, y) => {
    const r = s => s.art === 'station' ? 0 : s.art === 'ms' ? 1 : 2;
    return r(x) - r(y) || x.name.localeCompare(y.name, 'de', { numeric: true });
  });

  // ── Knoten (nur berechnete Assets — Gebäude hängen als Blätter daran) ──
  const abgangLabel = (sp) => {
    if (!sp?.speisId) return '';
    const st = stationen.get(sp.speisId);
    if (!st) return _knotenLabel(sp.speisId);
    const ab = sp.abgangId ? st.abgaenge.get(sp.abgangId) : null;
    return ab ? `${st.name} · ${ab.label}` : st.name;
  };
  const knoten = assets.map(a => {
    const n = nodeById.get(a.id);
    const du = duKnoten(a.id);
    return {
      id: a.id, asset: a,
      name: a.name || ASSET_CFG[a.type]?.label || a.type,
      typ: ASSET_CFG[a.type]?.label || a.type,
      ort: abgangLabel(a._calcSpeis),
      verbrauchKw: a._calcVerbrauchKw || 0,
      erzeugungKw: a._calcErzeugungKw || 0,
      duKum: du,
      ikMinKa: n?.ikMinA ? n.ikMinA / 1000 : null,
      ikMaxKa: n?.ikMaxA ? n.ikMaxA / 1000 : null,
      stufe: du == null ? 0 : _stufe(_duBetrag(du), DU_WARN, MAX_DELTA_U_PCT),
    };
  }).sort((x, y) => _duBetrag(y.duKum ?? 0) - _duBetrag(x.duKum ?? 0));

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
  const maxBy = (arr, f) => arr.reduce((b, x) => (b == null || f(x) > f(b)) ? x : b, null);
  const kTrafo = maxBy(trafos, t => t.auslastung);
  const kKabel = maxBy(kabel, k => k.auslastung);
  const kDu    = maxBy(kabel.filter(k => k.ebene === 'NS'), k => _duBetrag(k.duKum));
  const gebKw  = stand.gebKw || 0;

  // ── Nachweise ──
  const nachweise = [
    { id: 'du', label: 'Spannungsfall kumuliert, max.', grenze: MAX_DELTA_U_PCT, einheit: '%', d: 2,
      grenzText: `Grenze ${MAX_DELTA_U_PCT} %`,
      wert: kDu ? _duBetrag(kDu.duKum) : 0, wo: kDu ? `bis ${kDu.nach}` : '', ziel: kDu ? [kDu.id, 'kabel'] : null },
    { id: 'kabel', label: 'Kabelauslastung, max.', grenze: 100, einheit: '% von Iz', d: 0,
      grenzText: 'Grenze 100 %',
      wert: kKabel?.auslastung || 0, wo: kKabel ? `${kKabel.von} → ${kKabel.nach}` : '', ziel: kKabel ? [kKabel.id, 'kabel'] : null },
  ];
  if (trafos.length) nachweise.push({
    id: 'trafo', label: 'Trafoauslastung, max.', grenze: 100, einheit: '% von Sr', d: 0,
    grenzText: 'Grenze 100 %',
    wert: kTrafo.auslastung, wo: `${kTrafo.name}, ${kTrafo.richtung} maßgebend`, ziel: [kTrafo.id, 'asset'] });
  for (const n of nachweise) {
    n.ok = n.wert <= n.grenze;
    n.stufe = n.id === 'du' ? _stufe(n.wert, DU_WARN, n.grenze) : _stufe(n.wert, 80, n.grenze);
  }

  // ── Handlungsbedarf ──
  // Eine Zeile je Objekt. Spannungsfall nur je Abgang: eine Überschreitung zieht
  // sich durch alle nachgelagerten Strecken — dreißig Zeilen für eine Ursache
  // helfen niemandem.
  const massnahmen = [];
  for (const k of kabel) {
    const gr = k.gruende.filter(g => !g[1].startsWith('ΔU'));
    if (!gr.length) continue;
    const stufe = gr.reduce((m, g) => Math.max(m, g[0]), 0);
    let rat;
    if (k.sicherungKritisch && k.auslastung <= 100) rat = 'Die Vorsicherung löst im gerechneten Lastfall aus: Sicherung oder Querschnitt anpassen.';
    else if (stufe === 1 && !k.gedeckelt) rat = 'Zulässig, aber ohne Reserve für weitere Anschlüsse.';
    else if (k.gedeckelt) rat = 'Der größte Querschnitt im Katalog reicht nicht: zweiten Strang legen oder Last auf einen anderen Abgang verteilen.';
    else if (!k.autoSized) rat = 'Der Querschnitt ist von Hand gesetzt (Bestand) und wird nur bewertet: Ertüchtigung als Maßnahme prüfen.';
    else rat = 'Querschnitt, Parallelstrang oder Lastaufteilung prüfen.';
    massnahmen.push({
      stufe, wert: k.auslastung, id: k.id, art: 'kabel',
      titel: `${k.von} → ${k.nach}`, gruende: gr.map(g => g[1]),
      kontext: `${k.ort || k.ebene} · ${_kabelText(k)}${k.autoSized ? '' : ' · gesetzt'}`,
      rat, ort: k.ort,
    });
  }
  for (const st of stationListe) for (const ab of st.liste) {
    const ueber = ab.kabel.filter(k => k.ebene === 'NS' && _duBetrag(k.duKum) > MAX_DELTA_U_PCT);
    if (!ueber.length) continue;
    const schlimm = maxBy(ueber, k => _duBetrag(k.duKum));
    // Vorgelagerte Strecke mit dem größten Anteil am Spannungsfall
    const anteil = maxBy(ab.kabel.filter(k => k.ebene === 'NS'), k => _duBetrag(k.duSegment));
    massnahmen.push({
      stufe: 2, wert: 100 + _duBetrag(schlimm.duKum), id: schlimm.id, art: 'kabel',
      titel: `Spannungsfall bis ${_num(schlimm.duKum, 2)} % in ${st.art === 'station' ? `${st.name} · ${ab.label}` : st.name}`,
      gruende: [`${ueber.length} ${ueber.length === 1 ? 'Strecke' : 'Strecken'} über ${MAX_DELTA_U_PCT} %`, `am Ende: ${schlimm.nach}`],
      kontext: anteil ? `Größter Anteil: ${anteil.von} → ${anteil.nach} mit ${_num(anteil.duSegment, 2)} % auf ${_num(anteil.laengeM, 0)} m` : '',
      rat: 'Querschnitt auf den Strecken mit großem Anteil erhöhen, Strang kürzen oder Last auf einen anderen Abgang legen.',
      ort: st.art === 'station' ? `${st.name} · ${ab.label}` : st.name,
    });
  }
  for (const t of trafos) {
    if (t.auslastung <= 80) continue;
    const stufe = t.auslastung > 100 ? 2 : 1;
    massnahmen.push({
      stufe, wert: t.auslastung, id: t.id, art: 'asset',
      titel: `${t.name}: ${_num(t.auslastung, 0)} % Auslastung`,
      gruende: [`${t.richtung} maßgebend`, `${_num(t.massgebendKw, 0)} kW an ${_num(t.kva, 0)} kVA`,
        ...(t.parallel ? [_betriebsartText(t.parallel)] : [])],
      kontext: t.parallel ? _gegenfallText(t.parallel) : '',
      rat: t.parallel && t.parallel.betriebsart !== 'parallel' && t.parallel.normalPct <= 100
        ? 'Im Normalbetrieb ausreichend, aber ohne volle Reserve für den Ausfall eines Trafos — größere Trafos oder Lastabwurf im Störfall vorsehen.'
        : stufe === 2 ? 'Größeren Trafo oder zweite Station vorsehen; bei Rückspeisung auch Einspeisebegrenzung prüfen.'
                      : 'Reserve für weitere Anschlüsse wird knapp.',
      ort: t.name,
    });
  }
  massnahmen.sort((x, y) => y.stufe - x.stufe || y.wert - x.wert);

  // ── Urteil ──
  const nVerletzt = nachweise.filter(n => !n.ok).length;
  const orte = [...new Set(massnahmen.filter(m => m.stufe === 2).map(m => m.ort).filter(Boolean))];
  const nWarn = massnahmen.filter(m => m.stufe === 1).length;
  let urteil;
  if (!kabel.length && !trafos.length) {
    urteil = { stufe: 1, titel: 'Keine Kabel und kein Trafo im gerechneten Netz', text: 'Es gibt nichts nachzuweisen. Kabel zeichnen oder das Auto-Netz nutzen, dann neu rechnen.' };
  } else if (nVerletzt) {
    urteil = { stufe: 2,
      titel: `${nVerletzt} von ${nachweise.length} Nachweisen nicht erfüllt`,
      text: orte.length ? `Betroffen: ${orte.slice(0, 3).join(', ')}${orte.length > 3 ? ` und ${orte.length - 3} weitere` : ''}.` : '' };
  } else if (nWarn) {
    urteil = { stufe: 1, titel: 'Alle Nachweise erfüllt, mit Hinweisen',
      text: `${nWarn} ${nWarn === 1 ? 'Stelle hat' : 'Stellen haben'} wenig Reserve. Details unter Handlungsbedarf.` };
  } else {
    urteil = { stufe: 0, titel: 'Alle Nachweise erfüllt',
      text: `Größte Kabelauslastung ${_num(kKabel?.auslastung || 0, 0)} %, Spannungsfall höchstens ${_num(kDu ? _duBetrag(kDu.duKum) : 0, 2)} %.` };
  }

  // ── Kopfdaten ──
  const variante = (activeVariantId
    ? (varianten.find(v => v.id === activeVariantId)?.name || 'Variante')
    : 'Hauptplan')
    // ★ = diese Variante geht ins Gutachten
    + (window.gutachtenVariante != null && window.gutachtenVariante === (activeVariantId ?? 'base') ? ' ★' : '');
  const cs = elCalcStand?.();

  return {
    stand,
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
      gebKw, nGeb: stand.nGeb || 0,
      bezugKw: (stand.verbrauchKw || 0) + gebKw,
      nAssets: assets.length,
      nKabel: kabel.length,
      nStationen: stationListe.filter(s => s.art === 'station').length,
      laengeGesamt, laengeMs, laengeNs: laengeGesamt - laengeMs,
      maxTrafo: kTrafo?.auslastung || 0, maxKabel: kKabel?.auslastung || 0,
      maxDu: kDu ? _duBetrag(kDu.duKum) : 0,
      minIkKa: kpis.minIkA ? kpis.minIkA / 1000 : null,
      kIz: stand.kIz ?? kpis.kIz ?? null,
    },
    nachweise, massnahmen, urteil,
    trafos, anlagen, kabel, stationen: stationListe, knoten, mengen,
    kosten: window._stromNetzKosten || null,
    annahmen: _annahmen(stand),
  };
}

function _kabelText(k) {
  return `${k.nParallel > 1 ? k.nParallel + '× ' : ''}${k.typ} ${k.querschnitt || '—'} mm²`;
}

/**
 * Rechenparameter. Was der Lauf selbst gestempelt hat (cos φ, kIz, Leitertemperatur,
 * MS-Spannung), kommt aus dem Stempel — der Rest aus den Feldern, aus denen
 * elCalcAssets ihn liest.
 */
function _annahmen(stand) {
  const val = (id, fb) => document.getElementById(id)?.value ?? fb;
  const sel = id => {
    const el = document.getElementById(id);
    return el ? (el.options[el.selectedIndex]?.text || el.value) : '—';
  };
  const cos = stand.cosPhi ?? parseFloat(val('strom-ns-cosphi', 0.95));
  return [
    ['Netz', 'Nennspannung NS', '400 V (Drehstrom, 3~)'],
    ['Netz', 'Nennspannung MS', stand.uMsV ? _num(stand.uMsV / 1000, 0) + ' kV (am Netzanknüpfungspunkt)' : '20 kV (Vorgabe)'],
    ['Netz', 'cos φ', _num(cos, 2)],
    ['Netz', 'Standard-Kabeltyp für neue Kabel', sel('strom-kabel-typ')],
    ['Last', 'Gleichzeitigkeit', 'nicht angewendet: alle Lasten hinter einem Kabel werden voll addiert'],
    ['Last', 'Ladepunkte', 'eigener Faktor je Ladepark (Eingabe an der Anlage, Vorgabe 0,3)'],
    ['Last', 'Gebäude ohne eigene Anlage', 'Jahresstrom ÷ 1800 Volllaststunden'],
    ['Last', 'Hausanschluss eines einzelnen Verbrauchers', 'mindestens Anschlussleistung + 20 % Reserve'],
    ['Last', 'Photovoltaik', '0,8 × kWp'],
    ['Last', 'Wind, KWK', 'elektrische Nennleistung'],
    ['Auslegung', 'Grenzwert Spannungsfall', MAX_DELTA_U_PCT + ' % kumuliert (DIN 18015-1 / TAB)'],
    ['Auslegung', 'Leitertemperatur', _num(stand.tLeiterC ?? parseFloat(val('strom-leiter-temp', 70)), 0) + ' °C (Widerstandskorrektur IEC 60228)'],
    ['Auslegung', 'Bodentemperatur', val('strom-iz-tboden', 20) + ' °C (Referenz 20 °C)'],
    ['Auslegung', 'Häufung', val('strom-iz-nkabel', 1) + ' parallel verlegte Kabel'],
    ['Auslegung', 'Verlegeart', sel('strom-iz-verlegeart')],
    ['Auslegung', 'Iz-Korrekturfaktor kIz', _num(stand.kIz ?? window._stromNetzKpis?.kIz ?? 1, 2) + ' (IEC 60364-5-52)'],
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
  // Feste Höhe statt max-height: Kapitelleiste und Inhalt scrollen getrennt,
  // und beim Aufziehen des Panels (resize) wächst der Inhalt mit.
  panel.style.cssText = 'top:60px;width:min(1120px,calc(100vw - 40px));height:84vh;max-height:none;padding:0;overflow:hidden;';
  panel.innerHTML = `
    <div class="eb-rahmen">
      <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
        <span style="color:#f9a825;font-size:12px;font-weight:600;">📄 Ergebnisblatt Elektro</span>
        <span class="drag-dots">⠿</span>
        <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
              data-click="ergebnisblattToggle()">✕</span>
      </div>
      <div id="eb-body"></div>
    </div>`;
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

/** Zum Kapitel springen (Kapitelleiste). */
export function ebKapitel(id) {
  document.getElementById('eb-kap-' + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Station oder Abgang auf-/zuklappen. */
export function ebToggle(key) {
  if (_istOffen(key)) { EB.zu.add(key); EB.offen.delete(key); }
  else { EB.offen.add(key); EB.zu.delete(key); }
  _render();
}

/** Rechnung einer Strecke auf-/zuklappen. */
export function ebRechnung(id) {
  EB.rechnung = EB.rechnung === id ? null : id;
  _render();
}

export function ebToggleKritisch() {
  EB.nurKritisch = !EB.nurKritisch;
  _render();
}

/** Aus dem Handlungsbedarf zur Strecke im Kapitel „Netz" springen. */
export function ebZeigeStrecke(id) {
  const k = _modell?.kabel.find(x => x.id === id);
  if (!k) return;
  EB.offen.add('s:' + k.stationKey); EB.zu.delete('s:' + k.stationKey);
  EB.offen.add('a:' + k.abgangKey);  EB.zu.delete('a:' + k.abgangKey);
  EB.rechnung = id;
  _render();
  document.getElementById('eb-str-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

// Vorgabe: Stationen offen, Abgänge nur mit Grenzwertverletzung
function _istOffen(key, vorgabe = null) {
  if (EB.offen.has(key)) return true;
  if (EB.zu.has(key)) return false;
  if (vorgabe != null) return vorgabe;
  if (key.startsWith('s:')) return true;
  const ab = _modell?.stationen.flatMap(s => s.liste).find(a => 'a:' + a.key === key);
  return (ab?.stufe ?? 0) === 2;
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
  const alt = document.getElementById('eb-doc');
  const scroll = alt ? alt.scrollTop : 0;
  el.innerHTML = _kopf() + `<div class="eb-main">${_nav()}<div class="eb-doc" id="eb-doc">${_inhalt(false)}</div></div>`;
  const doc = document.getElementById('eb-doc');
  doc.scrollTop = scroll;
  doc.addEventListener('scroll', _navSync, { passive: true });
  _navSync();
  // Die Rechnung einer Strecke steht in einer breiten Tabelle, die seitlich
  // scrollt — sie soll trotzdem in der sichtbaren Breite bleiben.
  const breite = () => doc.style.setProperty('--eb-docw', Math.max(320, doc.clientWidth - 44) + 'px');
  breite();
  _resizeBeob?.disconnect();
  _resizeBeob = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(breite) : null;
  _resizeBeob?.observe(doc);
}
let _resizeBeob = null;

// Kapitelleiste markiert das Kapitel, das gerade oben steht
function _navSync() {
  const doc = document.getElementById('eb-doc');
  if (!doc) return;
  const oben = doc.getBoundingClientRect().top + 40;
  let aktiv = KAPITEL[0][0];
  for (const [id] of KAPITEL) {
    const k = document.getElementById('eb-kap-' + id);
    if (k && k.getBoundingClientRect().top <= oben) aktiv = id;
  }
  document.querySelectorAll('#el-ergebnisblatt .eb-nav a').forEach(a =>
    a.classList.toggle('is-active', a.dataset.kap === aktiv));
}

function _kopf() {
  const k = _modell.kopf;
  const zeit = k.gerechnetAm.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const stand = k.frisch === false
    ? `<span class="eb-pill is-warn" title="Netz oder Parameter haben sich seit der Rechnung geändert.">veraltet</span>`
    : `<span class="eb-pill is-ok">aktuell</span>`;
  return `
  <div class="eb-kopf">
    <div class="eb-kopf-meta">
      <b>${_esc(k.projekt)}</b>
      <span>${_esc(k.variante)}</span>
      <span>Jahr ${k.jahr}</span>
      <span>gerechnet ${zeit}</span>
      ${stand}
    </div>
    <div class="eb-kopf-aktionen">
      <button class="eb-btn${k.frisch === false ? ' eb-btn-primary' : ''}" data-click="elCalcAssets(); ergebnisblattAktualisieren()" title="Elektroberechnung neu ausführen und Blatt neu einlesen">↻ Neu rechnen</button>
      <button class="eb-btn" data-click="ebDrucken()" title="Vollständiges Blatt in einem Fenster öffnen und drucken">🖨 Drucken / PDF</button>
      <button class="eb-btn" data-click="ebCsvExport()" title="Alle Tabellen als CSV (Semikolon, Excel-tauglich)">⤓ CSV</button>
    </div>
  </div>`;
}

function _nav() {
  const m = _modell;
  const marke = {
    ergebnis: m.nachweise.filter(n => !n.ok).length,
    netz: m.stationen.reduce((s, st) => s + (st.nKrit ? 1 : 0), 0),
    knoten: m.knoten.filter(n => n.stufe === 2).length,
  };
  return `<nav class="eb-nav">${KAPITEL.map(([id, label], i) => `
    <a data-kap="${id}" data-click="ebKapitel('${id}')"><span>${i + 1} ${label}</span>${marke[id] ? `<i>${marke[id]}</i>` : ''}</a>`).join('')}
  </nav>`;
}

function _inhalt(druck) {
  const kap = [_kapErgebnis, _kapLast, _kapNetz, _kapKnoten, _kapMengen, _kapAnnahmen];
  return KAPITEL.map(([id, label], i) => {
    const { sub = '', html } = kap[i](druck);
    return `
    <section class="eb-kap" id="eb-kap-${id}">
      <div class="eb-kap-t"><span class="eb-nr">${i + 1}</span><h3>${label}</h3>${sub ? `<span class="eb-sub">${sub}</span>` : ''}</div>
      ${html}
    </section>`;
  }).join('');
}

// ── 1 Ergebnis ───────────────────────────────────────────────────────────────

function _kapErgebnis(druck) {
  const m = _modell, k = m.kpi;
  const u = m.urteil;
  const sym = ['✓', '!', '✕'][u.stufe];
  const veraltet = m.kopf.frisch === false
    ? `<div class="eb-hinweis eb-warn">Netz oder Parameter wurden seit der Rechnung geändert — vor dem Weitergeben neu rechnen.</div>` : '';

  const karten = m.nachweise.map(n => `
    <div class="eb-nw${n.ziel && !druck ? ' eb-klick' : ''}"${n.ziel ? ` data-click="ebSpringeZu('${_arg(n.ziel[0])}','${n.ziel[1]}')" title="Auf der Karte zeigen"` : ''}>
      <div class="eb-nw-k"><span>${n.label}</span><b class="eb-${AMPEL[n.stufe]}">${_num(n.wert, n.d)}<small> ${n.einheit}</small></b></div>
      ${_balken(n.wert, n.grenze, n.stufe)}
      <div class="eb-nw-f"><span>${n.grenzText}${n.wo ? ' · ' + _esc(n.wo) : ''}</span>
        <span class="eb-${n.ok ? 'ok' : 'bad'}">${n.ok ? '✓ eingehalten' : '✕ verletzt'}</span></div>
    </div>`);
  karten.push(k.minIkKa != null
    ? `<div class="eb-nw">
        <div class="eb-nw-k"><span>Kurzschlussstrom Ik″, min.</span><b>${_num(k.minIkKa, 2)}<small> kA</small></b></div>
        <div class="eb-nw-f"><span>Abschaltbedingung je Sicherung prüfen · aus der Lastflussrechnung im Netz-Tab</span></div>
      </div>`
    : `<div class="eb-nw eb-nw-leer">Kurzschlussstrom Ik″ ist nicht Teil dieser Rechnung. Er entsteht bei der Lastflussrechnung im Netz-Tab.</div>`);

  const MAX = druck ? Infinity : 10;
  const liste = m.massnahmen.slice(0, MAX);
  const rest = m.massnahmen.length - liste.length;
  const massn = !m.massnahmen.length
    ? `<div class="eb-hinweis eb-ok">✓ Keine Grenzwertverletzung und keine Stelle ohne Reserve.</div>`
    : `<div class="eb-massn">${liste.map(x => `
        <div class="eb-mz">
          <span class="eb-punkt is-${AMPEL[x.stufe]}"></span>
          <div class="eb-mz-text">
            <b>${_esc(x.titel)}</b> <span class="eb-mut">${x.gruende.map(_esc).join(' · ')}</span>
            ${x.kontext ? `<div class="eb-mut">${_esc(x.kontext)}</div>` : ''}
            <div>${_esc(x.rat)}</div>
          </div>
          <span class="eb-mz-akt">
            ${x.art === 'kabel' ? `<button class="eb-link" data-click="ebZeigeStrecke('${_arg(x.id)}')">Rechnung ↓</button>` : ''}
            <button class="eb-link" data-click="ebSpringeZu('${_arg(x.id)}','${x.art}')">Karte ↗</button>
          </span>
        </div>`).join('')}
      </div>${rest > 0 ? `<div class="eb-hinweis">+ ${rest} weitere — im Kapitel „Netz je Station“ mit „nur Auffälligkeiten“.</div>` : ''}`;

  const html = `
    <div class="eb-urteil is-${AMPEL[u.stufe]}">
      <div class="eb-urteil-sym">${sym}</div>
      <div><b>${_esc(u.titel)}</b><span>${_esc(u.text)}</span></div>
    </div>
    ${veraltet}
    <div class="eb-nachweise">${karten.join('')}</div>
    <div class="eb-zwt">Handlungsbedarf${m.massnahmen.length ? ` · ${m.massnahmen.length}` : ''}</div>
    ${massn}
    <div class="eb-umfang">
      <span>${k.nAssets} Anlagen</span>
      <span>${k.nStationen} ${k.nStationen === 1 ? 'Station' : 'Stationen'}</span>
      <span>${k.nKabel} Kabelstrecken</span>
      <span>${_laenge(k.laengeGesamt)} Trasse${k.laengeMs > 0 ? ` (MS ${_laenge(k.laengeMs)} · NS ${_laenge(k.laengeNs)})` : ''}</span>
    </div>`;
  return { html };
}

// ── 2 Last ───────────────────────────────────────────────────────────────────

function _kapLast() {
  const m = _modell, k = m.kpi;
  const bezug = m.anlagen.filter(a => a.verbrauchKw > 0).map(a => ({
    label: `${a.icon} ${a.label} (${a.nV})`, kw: a.verbrauchKw, herkunft: HERKUNFT[a.typ] || '' }));
  if (k.gebKw > 0) bezug.push({
    label: `Gebäude ohne Anlage (${k.nGeb})`, kw: k.gebKw, herkunft: 'Jahresstrom ÷ 1800 Volllaststunden', blass: true });
  const einsp = m.anlagen.filter(a => a.erzeugungKw > 0).map(a => ({
    label: `${a.icon} ${a.label} (${a.nE})`, kw: a.erzeugungKw, herkunft: HERKUNFT[a.typ] || '' }));
  const sumB = bezug.reduce((s, z) => s + z.kw, 0);
  const sumE = einsp.reduce((s, z) => s + z.kw, 0);
  const skala = Math.max(sumB, sumE, 1);

  const spalte = (titel, zeilen, summe, sumLabel, art) => {
    let lauf = 0;
    const rows = zeilen.map(z => {
      const links = lauf / skala * 100, breite = z.kw / skala * 100;
      lauf += z.kw;
      return `
        <div class="eb-bil-z"><span class="eb-bil-l">${_esc(z.label)}</span>
          <span class="eb-bil-bar"><i class="is-${art}${z.blass ? ' is-blass' : ''}" style="left:${links.toFixed(1)}%;width:${breite.toFixed(1)}%"></i></span>
          <span class="eb-bil-v">${_num(z.kw, 0)} kW</span></div>
        ${z.herkunft ? `<div class="eb-bil-h">${_esc(z.herkunft)}</div>` : ''}`;
    }).join('');
    return `
      <div class="eb-bil">
        <div class="eb-zwt">${titel}</div>
        ${rows || '<div class="eb-mut">—</div>'}
        <div class="eb-bil-z is-sum"><span class="eb-bil-l">${sumLabel}</span>
          <span class="eb-bil-bar"><i class="is-${art}" style="left:0;width:${(summe / skala * 100).toFixed(1)}%"></i></span>
          <span class="eb-bil-v">${_num(summe, 0)} kW</span></div>
      </div>`;
  };

  // Abgleich mit den Trafos: was dort ankommt, sollte der Bilanz entsprechen
  let abgleich = '';
  if (m.trafos.length) {
    const tB = m.trafos.reduce((s, t) => s + t.anteilBezugKw, 0);
    const tE = m.trafos.reduce((s, t) => s + t.anteilEinspKw, 0);
    const passt = Math.abs(tB - sumB) < 1 && Math.abs(tE - sumE) < 1;
    abgleich = `
      <div class="eb-abgleich">
        <span>An den Trafos zusammen: Bezug <b>${_num(tB, 0)} kW</b> · Einspeisung <b>${_num(tE, 0)} kW</b></span>
        <span class="eb-${passt ? 'ok' : 'warn'}">${passt ? '✓ deckt sich mit der Bilanz'
          : 'weicht ab: Anlagen ohne Verbindung zu einem Trafo, oder an mehreren Stationen gezählt'}</span>
      </div>`;
  }

  const html = `
    <div class="eb-bilanz">
      ${spalte('Bezug', bezug, sumB, 'Bezug gesamt', 'bezug')}
      ${spalte('Einspeisung', einsp, sumE, 'Einspeisung gesamt', 'einsp')}
    </div>
    ${abgleich}
    <div class="eb-hinweis">Ohne Gleichzeitigkeitsfaktor: alle Lasten hinter einem Kabel oder Trafo werden voll addiert,
      das liegt auf der sicheren Seite. Nur Ladeparks bringen ihren eigenen Faktor mit. Bezug und Einspeisung
      werden nicht verrechnet: je Trafo und je Kabel zählt die größere der beiden Richtungen (Kapitel 3).</div>`;
  return { sub: 'Was die Betriebsmittel tragen müssen', html };
}

// Trafogruppe (mehrere Trafos auf einem NS-Netz): welcher Lastfall gilt …
function _betriebsartText(p) {
  return p.betriebsart === 'parallel'
    ? `Parallelbetrieb mit ${p.ids.length} Trafos, Anteil ${_num(p.anteil * 100, 0)} %`
    : `redundant (N-1) mit ${p.ids.length} Trafos, Wert bei Ausfall eines anderen`;
}
// … und was der jeweils andere Lastfall ergäbe
function _gegenfallText(p) {
  return p.betriebsart === 'parallel'
    ? `bei Ausfall eines Trafos ${_num(p.n1Pct, 0)} %`
    : `im Normalbetrieb ${_num(p.normalPct, 0)} %`;
}

// ── 3 Netz je Station ────────────────────────────────────────────────────────

function _kapNetz(druck) {
  const m = _modell;
  if (!m.kabel.length) return { html: `<div class="eb-hinweis">Keine Kabel im gerechneten Netz.</div>` };
  const krit = EB.nurKritisch && !druck;

  const stationen = m.stationen
    .filter(st => !krit || st.nKrit || st.nWarn)
    .map(st => _station(st, druck, krit)).join('');

  const filter = druck ? '' : `
    <div class="eb-toolbar">
      <label class="eb-filter"><input type="checkbox" ${EB.nurKritisch ? 'checked' : ''} data-change="ebToggleKritisch()"/> nur Auffälligkeiten</label>
      <span class="eb-mut">Abgang anklicken klappt auf, Strecke anklicken zeigt ihre Rechnung</span>
    </div>`;

  const html = `${filter}${stationen || '<div class="eb-hinweis eb-ok">✓ Keine Auffälligkeit.</div>'}
    <div class="eb-hinweis">Balken: Skala bis 150 % der Grenze, der senkrechte Strich ist die Grenze (Auslastung 100 %,
      Spannungsfall ${MAX_DELTA_U_PCT} %). Abgänge sind je Station im Uhrzeigersinn ab Norden nummeriert.
      P maßg. ist die größere Richtung aus Bezug und Einspeisung (↑ = Einspeisung maßgebend).</div>`;
  return { sub: 'Station → Abgang → Strecke', html };
}

function _station(st, druck, krit) {
  const sKey = 's:' + st.key;
  const offen = druck || _istOffen(sKey);
  const t = st.trafo;
  const pill = st.nKrit ? `<span class="eb-pill is-bad">${st.nKrit} verletzt</span>`
    : st.nWarn ? `<span class="eb-pill is-warn">${st.nWarn} ohne Reserve</span>`
    : `<span class="eb-pill is-ok">in Ordnung</span>`;
  let info;
  if (st.art === 'station') {
    info = [t ? `${_num(t.kva, 0)} kVA${t.ukPct ? ' · uk ' + _num(t.ukPct, 1) + ' %' : ''}` : st.typ,
      `${st.liste.length} ${st.liste.length === 1 ? 'Abgang' : 'Abgänge'}`,
      `${st.nKabel} Strecken`, _laenge(st.laengeM)].filter(Boolean).join(' · ');
  } else {
    info = `${st.info} · ${st.nKabel} Strecken · ${_laenge(st.laengeM)}`;
  }
  const trafoBar = t ? `
    <div class="eb-st-bar">
      <div class="eb-st-bar-t"><span>Bezug ${_num(t.bezugKw, 0)} kW · Einsp. ${_num(t.einspKw, 0)} kW → ${t.richtung} maßgebend · Reserve ${_num(t.reserveKw, 0)} kW</span>
        <span class="eb-${AMPEL[t.stufe]}">${_num(t.auslastung, 0)} %</span></div>
      ${_balken(t.auslastung, 100, t.stufe)}
      ${t.parallel ? `<div class="eb-mut">${_esc(_betriebsartText(t.parallel))} · ${_esc(_gegenfallText(t.parallel))}</div>` : ''}
    </div>` : '<div></div>';

  const kopf = `
    <div class="eb-st-k${druck ? '' : ' eb-klick'}"${druck ? '' : ` data-click="ebToggle('${_arg(sKey)}')"`}>
      <div><b>${druck ? '' : (offen ? '▾ ' : '▸ ')}${_esc(st.name)}</b><div class="eb-mut">${_esc(info)}</div></div>
      ${trafoBar}
      ${pill}
    </div>`;
  if (!offen) return `<div class="eb-station">${kopf}</div>`;

  const zeilen = st.liste
    .filter(ab => !krit || ab.stufe > 0)
    .map(ab => _abgang(st, ab, druck, krit)).join('');
  return `
    <div class="eb-station">${kopf}
      <div class="eb-scroll-x"><table class="eb-tab eb-tab-netz">
        <thead><tr>
          <th>Abgang / Strecke</th><th>Kabel</th><th class="eb-num">Länge</th><th class="eb-num">P maßg.</th>
          <th class="eb-num">Ib / Iz</th><th class="eb-num">Auslastung</th><th class="eb-num">ΔU kum.</th>${druck ? '' : '<th></th>'}
        </tr></thead>
        <tbody>${zeilen}</tbody>
      </table></div>
    </div>`;
}

function _abgang(st, ab, druck, krit) {
  const aKey = 'a:' + ab.key;
  const einzeln = st.art !== 'station';      // MS/ohne Zuordnung: Strecken direkt zeigen
  const offen = druck || einzeln || _istOffen(aKey);
  const sAus = _stufe(ab.maxAusl, 80, 100);
  const sDu  = _stufe(_duBetrag(ab.maxDu), DU_WARN, MAX_DELTA_U_PCT);
  const ms = st.art === 'ms';
  const kopf = einzeln ? '' : `
    <tr class="eb-abg${druck ? '' : ' eb-klick'}"${druck ? '' : ` data-click="ebToggle('${_arg(aKey)}')"`}>
      <td>${druck ? '' : (offen ? '▾ ' : '▸ ')}${_esc(ab.label)} <span class="eb-mut">→ ${_esc(ab.ziel)}</span></td>
      <td class="eb-mut">${ab.kabel.length} ${ab.kabel.length === 1 ? 'Strecke' : 'Strecken'}</td>
      <td class="eb-num">${_num(ab.laengeM, 0)} m</td>
      <td class="eb-num">${_num(ab.massgebendKw, 0)} kW</td>
      <td></td>
      <td class="eb-num">${_zelle(ab.maxAusl, 100, sAus, _num(ab.maxAusl, 0) + ' %')}</td>
      <td class="eb-num">${_zelle(_duBetrag(ab.maxDu), MAX_DELTA_U_PCT, sDu, _num(ab.maxDu, 2) + ' %')}</td>
      ${druck ? '' : '<td></td>'}
    </tr>`;
  if (!offen) return kopf;
  const kabel = ab.kabel.filter(k => !krit || k.stufe > 0);
  return kopf + kabel.map(k => _strecke(k, druck, einzeln, ms)).join('');
}

function _strecke(k, druck, einzeln, ms) {
  const sAus = _stufe(k.auslastung, 80, 100);
  const sDu  = _stufe(_duBetrag(k.duKum), DU_WARN, MAX_DELTA_U_PCT);
  const offen = !druck && EB.rechnung === k.id;
  const tags = [
    k.autoSized ? '' : '<span class="eb-tag" title="Querschnitt von Hand gesetzt — wird nur bewertet, nicht ausgelegt">gesetzt</span>',
    k.gedeckelt ? '<span class="eb-tag is-warn" title="Größter Querschnitt im Katalog reicht nicht">Katalogende</span>' : '',
    k.ausgelegt ? '' : '<span class="eb-tag" title="Gebäudeanschluss: wird von dieser Rechnung nicht ausgelegt">Gebäude</span>',
  ].join('');
  const zeile = `
    <tr id="eb-str-${_esc(k.id)}" class="eb-str${einzeln ? ' eb-str-flach' : ''}${druck ? '' : ' eb-klick'}${offen ? ' is-offen' : ''}${k.stufe === 2 ? ' is-bad' : ''}"${druck ? '' : ` data-click="ebRechnung('${_arg(k.id)}')"`}>
      <td>${_esc(k.von)} → ${_esc(k.nach)} ${tags}</td>
      <td>${_esc(_kabelText(k))}</td>
      <td class="eb-num">${_num(k.laengeM, 0)} m</td>
      <td class="eb-num">${_num(k.massgebendKw, 1)} kW${k.rueckspeisung ? ' ↑' : ''}</td>
      <td class="eb-num">${_num(k.stromA, 0)} / ${_num(k.izA, 0)} A</td>
      <td class="eb-num">${_zelle(k.auslastung, 100, sAus, _num(k.auslastung, 0) + ' %')}</td>
      <td class="eb-num">${ms ? '<span class="eb-mut">—</span>' : _zelle(_duBetrag(k.duKum), MAX_DELTA_U_PCT, sDu, _num(k.duKum, 2) + ' %')}</td>
      ${druck ? '' : `<td><button class="eb-ico" data-click="ebSpringeZu('${_arg(k.id)}','kabel')" title="Auf der Karte zeigen">⌖</button></td>`}
    </tr>`;
  return zeile + (offen ? `<tr class="eb-rech-z"><td colspan="8">${_rechnung(k)}</td></tr>` : '');
}

// Die Rechnung einer Strecke, Schritt für Schritt — mit den Werten, die der
// Rechenkern an der Kante hinterlassen hat. Hier wird nur aufgeschrieben.
function _rechnung(k) {
  if (!k.ausgelegt) {
    return `<div class="eb-rech is-info">Diese Strecke führt zu einem Gebäude ohne eigene Anlage. Die Elektroberechnung
      legt sie nicht aus; ihre Last zählt aber in allen vorgelagerten Kabeln mit. Die angezeigten Werte stammen aus
      einer früheren Rechnung, z. B. der Lastflussrechnung im Netz-Tab.</div>`;
  }
  const st = _modell.stand;
  const h = k.hinter;
  const ms = k.ebene === 'MS';
  const cos = st.cosPhi ?? 0.95;
  const z = [];
  const zeile = (l, f, e, cls = '') => z.push(`<span class="eb-rech-s">${z.length + 1}</span><span class="eb-rech-l">${l}</span><span class="eb-rech-f">${f}</span><span class="eb-rech-e ${cls}">${e}</span>`);

  const teile = [];
  if (h.nVerbraucher) teile.push(`${h.nVerbraucher} ${h.nVerbraucher === 1 ? 'Anlage' : 'Anlagen'}`);
  if (h.nGeb) teile.push(`${h.nGeb} Gebäude ohne Anlage (${_num(h.gebKw, 1)} kW)`);
  zeile('Bezug hinter dem Kabel', `${teile.join(' + ') || 'keine Last'}, voll addiert`
    + (h.trafoAnteil != null ? `, davon ${_num(h.trafoAnteil * 100, 0)} % über diesen Trafo (Trafogruppe)` : ''), `${_num(h.lastKw, 1)} kW`);
  if (h.anschlussKw != null) {
    zeile('Hausanschluss', `Anschlussleistung + 20 % Reserve liegt über der Last`, `${_num(h.anschlussKw, 1)} kW`);
  }
  if (h.nErzeuger || k.einspKw > 0) {
    zeile('Einspeisung hinter dem Kabel', `${h.nErzeuger} Erzeuger, ohne Gleichzeitigkeit`, `${_num(k.einspKw, 1)} kW`);
  }
  zeile('Maßgebend', `größere Richtung: ${k.rueckspeisung ? 'Einspeisung' : 'Bezug'}`, `${_num(k.massgebendKw, 1)} kW`);
  const uTxt = ms ? `${_num((st.uMsV || 20000) / 1000, 0)} kV` : '400 V';
  zeile('Betriebsstrom Ib', `${_num(k.massgebendKw, 1)} kW ÷ (√3 · ${uTxt} · cos φ ${_num(cos, 2)})`, `${_num(k.stromA, 0)} A`);
  if (ms) {
    zeile('Belastbarkeit Iz', `Tabellenwert MS-Kabel ${k.querschnitt} mm²${k.typ !== '—' ? ' (' + _esc(k.typ) + ')' : ''}`, `${_num(k.izA, 0)} A`);
  } else {
    const kat = k.izKatA != null ? `${_num(k.izKatA, 0)} A (${_esc(_kabelText(k))})` : _esc(_kabelText(k));
    zeile('Belastbarkeit Iz', `${kat} × kIz ${_num(k.kIz ?? st.kIz ?? 1, 2)}`, `${_num(k.izA, 0)} A`);
  }
  const sAus = _stufe(k.auslastung, 80, 100);
  zeile('Auslastung', `${_num(k.stromA, 0)} A ÷ ${_num(k.izA, 0)} A, Grenze 100 %`,
    `${_num(k.auslastung, 0)} % ${k.auslastung <= 100 ? '✓' : '✕'}`, 'eb-' + AMPEL[sAus]);
  if (!ms) {
    const sDu = _stufe(_duBetrag(k.duKum), DU_WARN, MAX_DELTA_U_PCT);
    const f = k.duVon != null
      ? `${_num(k.duVon, 2)} % bis ${_esc(k.von)} + ${_num(k.duSegment, 2)} % auf ${_num(k.laengeM, 0)} m, Grenze ${MAX_DELTA_U_PCT} %`
      : `${_num(k.duSegment, 2)} % auf ${_num(k.laengeM, 0)} m, Grenze ${MAX_DELTA_U_PCT} %`;
    zeile('Spannungsfall', f, `${_num(k.duKum, 2)} % ${_duBetrag(k.duKum) <= MAX_DELTA_U_PCT ? '✓' : '✕'}`, 'eb-' + AMPEL[sDu]);
  }
  if (k.sicherungA) {
    zeile('Vorsicherung', `${k.sicherungA} A gegen Ib ${_num(k.stromA, 0)} A`,
      k.sicherungKritisch ? 'löst aus ✕' : '✓', k.sicherungKritisch ? 'eb-bad' : 'eb-ok');
  }

  let auslegung;
  if (!k.autoSized) auslegung = 'Querschnitt von Hand gesetzt (z. B. Bestand) — wird nur bewertet, nicht verändert.';
  else if (k.gedeckelt) auslegung = 'Automatisch ausgelegt, aber am Ende des Kabelkatalogs gedeckelt: der größte Querschnitt reicht nicht.';
  else if (ms) auslegung = 'Automatisch ausgelegt nach Strombelastbarkeit.';
  else auslegung = `Automatisch ausgelegt nach Strombelastbarkeit und Spannungsfall-Budget${k.duBudget != null ? ` (${_num(k.duBudget, 2)} % für diesen Abschnitt)` : ''}.`;

  return `<div class="eb-rech">
    <div class="eb-zwt">Rechnung dieser Strecke</div>
    <div class="eb-rech-g">${z.join('')}</div>
    <div class="eb-mut" style="margin-top:6px;">${auslegung}</div>
  </div>`;
}

// ── 4 Knoten ─────────────────────────────────────────────────────────────────

function _kapKnoten(druck) {
  const m = _modell;
  const krit = EB.nurKritisch && !druck;
  const rows = krit ? m.knoten.filter(n => n.stufe > 0) : m.knoten;
  const hatIk = m.knoten.some(n => n.ikMinKa != null);

  const body = rows.map(n => `
    <tr class="${druck ? '' : 'eb-klick'}"${druck ? '' : ` data-click="ebSpringeZu('${_arg(n.id)}','asset')"`}>
      <td>${_esc(n.name)}</td>
      <td class="eb-mut">${_esc(n.typ)}</td>
      <td class="eb-mut">${_esc(n.ort)}</td>
      <td class="eb-num">${n.verbrauchKw > 0 ? _num(n.verbrauchKw, 1) : '—'}</td>
      <td class="eb-num">${n.erzeugungKw > 0 ? _num(n.erzeugungKw, 1) : '—'}</td>
      <td class="eb-num">${n.duKum == null ? '—' : _zelle(_duBetrag(n.duKum), MAX_DELTA_U_PCT, n.stufe, _num(n.duKum, 2) + ' %')}</td>
      ${hatIk ? `<td class="eb-num">${n.ikMinKa == null ? '—' : _num(n.ikMinKa, 2)}</td>
                 <td class="eb-num">${n.ikMaxKa == null ? '—' : _num(n.ikMaxKa, 2)}</td>` : ''}
    </tr>`).join('');

  const html = `
    ${druck ? '' : `<div class="eb-toolbar">
      <label class="eb-filter"><input type="checkbox" ${EB.nurKritisch ? 'checked' : ''} data-change="ebToggleKritisch()"/> nur Auffälligkeiten</label>
      <span class="eb-mut">${rows.length} von ${m.knoten.length} Anlagen · Zeile anklicken zeigt die Anlage auf der Karte</span>
    </div>`}
    <div class="eb-scroll-x${druck ? '' : ' eb-scroll'}">
      <table class="eb-tab">
        <thead><tr>
          <th>Anlage</th><th>Typ</th><th>Station · Abgang</th>
          <th class="eb-num">Verbrauch (kW)</th><th class="eb-num">Erzeugung (kW)</th>
          <th class="eb-num">ΔU kumuliert</th>
          ${hatIk ? '<th class="eb-num">Ik″ min (kA)</th><th class="eb-num">Ik″ max (kA)</th>' : ''}
        </tr></thead>
        <tbody>${body || '<tr><td colspan="8" class="eb-mut">Keine Anlage in dieser Auswahl.</td></tr>'}</tbody>
      </table>
    </div>
    ${hatIk ? '' : `<div class="eb-hinweis">Kurzschlussströme stehen erst nach einer Lastflussrechnung im Netz-Tab zur Verfügung.</div>`}`;
  return { sub: 'Spannungsfall je Anlage, sortiert nach Betrag', html };
}

// ── 5 Mengen & Kosten ────────────────────────────────────────────────────────

function _kapMengen() {
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
  const mengenTab = `<div class="eb-scroll-x"><table class="eb-tab">
    <thead><tr><th>Kabeltyp / Querschnitt</th><th class="eb-num">Strecken</th>
      <th class="eb-num">Trasse (m)</th><th class="eb-num">Kabel (m)</th>
      <th class="eb-num">Material</th><th class="eb-num">Materialkosten</th></tr></thead>
    <tbody>${mengenRows}</tbody>
    <tfoot><tr><td>Summe</td><td class="eb-num">${_modell.kabel.length}</td>
      <td class="eb-num">${_num(_modell.kpi.laengeGesamt, 0)}</td>
      <td class="eb-num">${_num(kabelMGesamt, 0)}</td><td></td>
      <td class="eb-num">${_eur(materialGesamt)}</td></tr></tfoot></table></div>
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
    const mass = Math.max(_modell.kpi.bezugKw, _modell.kpi.erzeugungKw);
    const spezKw = mass > 0 ? k.investGesamt / mass : null;
    const spezM  = k.trasseLaenge > 0 ? k.investGesamt / k.trasseLaenge : null;
    return `
    <table class="eb-tab eb-tab-schmal">
      <thead><tr><th>Position</th><th class="eb-num">Investition</th><th class="eb-num">Anteil</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Investition gesamt</td><td class="eb-num">${_eur(k.investGesamt || 0)}</td><td></td></tr></tfoot>
    </table>
    <div class="eb-werte">
      <div><span>Annuität p. a.</span><b>${_eur(k.annuitaet || 0)}</b><small>Kapitaldienst + 1 % Instandhaltung (VDI 2067)</small></div>
      <div><span>je kW Netzlast</span><b>${spezKw != null ? _eur(spezKw) : '—'}</b><small>bezogen auf die größere Richtung aus Kapitel 2</small></div>
      <div><span>je Trassenmeter</span><b>${spezM != null ? _eur(spezM) : '—'}</b><small>Investition ÷ Trassenlänge</small></div>
    </div>`;
  })();

  return { html: `
    <div class="eb-zwt">Querschnittsspiegel</div>${mengenTab}
    <div class="eb-zwt">Investition und Annuität</div>${kostenTab}` };
}

// ── 6 Annahmen ───────────────────────────────────────────────────────────────

function _kapAnnahmen() {
  let letzteGruppe = '';
  const rows = _modell.annahmen.map(([gruppe, was, wert]) => {
    const kopf = gruppe !== letzteGruppe
      ? `<tr class="eb-gruppe"><td colspan="2">${_esc(gruppe)}</td></tr>` : '';
    letzteGruppe = gruppe;
    return kopf + `<tr><td>${_esc(was)}</td><td>${_esc(wert)}</td></tr>`;
  }).join('');

  const warnungen = _modell.kopf.warnungen.length
    ? `<div class="eb-hinweis eb-warn">${_modell.kopf.warnungen.map(_esc).join('<br/>')}</div>` : '';

  return { sub: 'Nur Werte, die in diese Rechnung eingehen', html: `
    <table class="eb-tab eb-tab-schmal"><tbody>${rows}</tbody></table>
    <div class="eb-hinweis">Die Einstellung „Gleichzeitigkeit“ im Netz-Tab (z. B. DIN 18015) gilt nur für die
      Lastflussrechnung dort, nicht für diese Elektroberechnung.</div>
    <div class="eb-zwt">Rechenweg</div>
    <ul class="eb-liste">
      <li>Last je Kabel und Trafo = alles, was netzabwärts angeschlossen ist, voll addiert (ohne Gleichzeitigkeitsfaktor).</li>
      <li>Bezug und Einspeisung werden getrennt aufsummiert und nicht gegeneinander verrechnet.
          Maßgebend ist die größere der beiden Richtungen.</li>
      <li>Kabelauslegung nach Strombelastbarkeit (Iz mit Korrekturfaktoren, IEC 60364-5-52) und Spannungsfall;
          das ΔU-Budget wird längenanteilig über den Pfad verteilt, damit der kumulierte Wert am Stichende das Limit hält.</li>
      <li>Automatisch ausgelegte Kabel wachsen mit der Last; von Hand gesetzte oder aus Bestandsplänen übernommene
          Querschnitte bleiben unverändert und werden nur bewertet.</li>
      <li>Trafo-Auslastung bezogen auf Sr × 0,90.</li>
      <li>Abgänge sind je Station im Uhrzeigersinn ab Norden nummeriert, nach der Lage der ersten Anlage am Abgang.</li>
    </ul>
    ${warnungen}` };
}

// ── Druckfassung ─────────────────────────────────────────────────────────────

// Bedienelemente aus dem Blatt nehmen: im Druck gibt es nichts zu klicken.
function _fuerDruck(html) {
  return html
    .replace(/\sdata-click="[^"]*"/g, '')
    .replace(/\sdata-change="[^"]*"/g, '')
    .replace(/<button class="eb-(?:link|ico)"[^>]*>[\s\S]*?<\/button>/g, '');
}

/** Alle Kapitel in einem druckbaren Fenster (A4 quer, helles Layout). */
export function ebDrucken() {
  if (!_modell) { showHint('⚠ Erst rechnen — dann liegt ein Ergebnis zum Drucken vor.'); return; }
  const k = _modell.kopf;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Ergebnisblatt Elektro — ${_esc(k.projekt)}</title>
<style>
  @page { size: A4 landscape; margin: 13mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 9pt; color: #1a1a1a; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  .meta { color: #555; font-size: 8.5pt; margin-bottom: 4mm; }
  .meta span { margin-right: 10px; }
  .eb-kap { margin-bottom: 6mm; }
  .eb-kap-t { display: flex; align-items: baseline; gap: 3mm; border-bottom: 1px solid #999; padding-bottom: 1mm; margin-bottom: 2.5mm; page-break-after: avoid; }
  .eb-kap-t h3 { font-size: 11.5pt; margin: 0; }
  .eb-nr { color: #a06a00; font-weight: 600; }
  .eb-sub { color: #666; font-size: 8.5pt; }
  #eb-kap-netz, #eb-kap-knoten, #eb-kap-mengen, #eb-kap-annahmen { page-break-before: always; }
  .eb-zwt { font-weight: 600; margin: 3.5mm 0 1.5mm; font-size: 9.5pt; }
  table.eb-tab { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
  table.eb-tab-schmal { width: auto; min-width: 50%; }
  table.eb-tab th, table.eb-tab td { border: 1px solid #c8c8c8; padding: .9mm 1.5mm; text-align: left; font-size: 8pt; }
  table.eb-tab th { background: #eee; font-weight: 600; }
  table.eb-tab tfoot td { font-weight: 600; background: #f6f6f6; }
  tr.eb-gruppe td, tr.eb-abg td { background: #f0f0f0; font-weight: 600; }
  tr.eb-str td:first-child { padding-left: 5mm; }
  tr.eb-str-flach td:first-child { padding-left: 1.5mm; }
  tr { page-break-inside: avoid; }
  .eb-num { text-align: right; white-space: nowrap; }
  .eb-mut { color: #666; }
  .eb-ok { color: #1b7f2c; } .eb-warn { color: #a06a00; } .eb-bad { color: #c62828; font-weight: 600; }
  .eb-balken { position: relative; display: block; height: 2mm; background: #e6e6e6; border-radius: 1mm; }
  .eb-balken i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 1mm; background: #2e7d32; }
  .eb-balken i.is-warn { background: #c88a00; } .eb-balken i.is-bad { background: #c62828; }
  .eb-balken u { position: absolute; left: 66.67%; top: -.7mm; bottom: -.7mm; width: .4mm; background: #222; }
  .eb-zb { display: inline-flex; align-items: center; gap: 1.5mm; }
  .eb-zb .eb-balken { width: 12mm; height: 1.6mm; display: inline-block; }
  .eb-urteil { display: flex; gap: 3mm; align-items: center; border: 1px solid #999; border-left-width: 2.5pt; padding: 2mm 3mm; margin-bottom: 3mm; }
  .eb-urteil.is-bad { border-color: #c62828; } .eb-urteil.is-warn { border-color: #a06a00; } .eb-urteil.is-ok { border-color: #2e7d32; }
  .eb-urteil-sym { font-weight: 700; font-size: 12pt; }
  .eb-urteil b { display: block; font-size: 10.5pt; }
  .eb-nachweise { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; margin-bottom: 2mm; }
  .eb-nw { border: 1px solid #c8c8c8; border-radius: 1.5mm; padding: 2mm; display: flex; flex-direction: column; gap: 1.5mm; }
  .eb-nw-k, .eb-nw-f { display: flex; justify-content: space-between; gap: 2mm; font-size: 7.5pt; color: #555; }
  .eb-nw-k b { font-size: 12pt; color: inherit; } .eb-nw-k b small { font-size: 7.5pt; color: #555; font-weight: 400; }
  .eb-nw-leer { color: #666; font-size: 8pt; border-style: dashed; justify-content: center; }
  .eb-mz { display: grid; grid-template-columns: 3mm 1fr; gap: 2mm; padding: 1.2mm 0; border-bottom: 1px solid #e3e3e3; page-break-inside: avoid; }
  .eb-punkt { width: 2.2mm; height: 2.2mm; border-radius: 50%; margin-top: 1mm; background: #999; }
  .eb-punkt.is-bad { background: #c62828; } .eb-punkt.is-warn { background: #c88a00; }
  .eb-mz-akt { display: none; }
  .eb-umfang { margin-top: 3mm; color: #555; font-size: 8pt; } .eb-umfang span { margin-right: 4mm; }
  .eb-bilanz { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .eb-bil-z { display: grid; grid-template-columns: 45mm 1fr 18mm; gap: 2mm; align-items: center; }
  .eb-bil-z.is-sum { border-top: 1px solid #999; padding-top: 1mm; font-weight: 600; }
  .eb-bil-bar { position: relative; height: 3mm; }
  .eb-bil-bar i { position: absolute; top: 0; bottom: 0; background: #c88a00; }
  .eb-bil-bar i.is-einsp { background: #1e88b5; } .eb-bil-bar i.is-blass { opacity: .55; }
  .eb-bil-v { text-align: right; } .eb-bil-h { color: #666; font-size: 7.5pt; margin: 0 0 1mm 47mm; }
  .eb-abgleich { display: flex; justify-content: space-between; margin-top: 2mm; font-size: 8.5pt; }
  .eb-station { margin-bottom: 4mm; page-break-inside: auto; }
  .eb-st-k { display: grid; grid-template-columns: 1.2fr 2fr auto; gap: 4mm; align-items: center; background: #f4f4f4; border: 1px solid #c8c8c8; padding: 2mm 3mm; page-break-after: avoid; }
  .eb-st-bar-t { display: flex; justify-content: space-between; font-size: 7.5pt; color: #555; margin-bottom: 1mm; }
  .eb-pill { border: 1px solid currentColor; border-radius: 3mm; padding: 0 2mm; font-size: 7.5pt; }
  .eb-pill.is-ok { color: #1b7f2c; } .eb-pill.is-warn { color: #a06a00; } .eb-pill.is-bad { color: #c62828; }
  .eb-tag { border: 1px solid #bbb; border-radius: 1mm; padding: 0 1mm; font-size: 6.5pt; color: #555; margin-left: 1mm; }
  .eb-werte { display: flex; gap: 6mm; margin-top: 2mm; }
  .eb-werte div { display: flex; flex-direction: column; } .eb-werte span, .eb-werte small { color: #555; font-size: 7.5pt; } .eb-werte b { font-size: 11pt; }
  .eb-hinweis { font-size: 7.5pt; color: #555; margin: 1.5mm 0 3mm; line-height: 1.45; }
  .eb-liste { margin: 0 0 2mm 4mm; padding: 0; line-height: 1.5; }
  .eb-toolbar { display: none; }
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
  ${k.frisch === false ? '<span class="eb-warn">Stand veraltet</span>' : ''}
</div>
${_fuerDruck(_inhalt(true))}
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
  csv += _csvZeile(['Ergebnis', m.urteil.titel]);
  csv += '\n';

  csv += _csvZeile(['NACHWEISE']);
  csv += _csvZeile(['Kriterium', 'Ist', 'Grenze', 'Einheit', 'Ergebnis', 'Ort']);
  for (const n of m.nachweise) {
    csv += _csvZeile([n.label, _csvZahl(n.wert, n.d), _csvZahl(n.grenze, 0), n.einheit, n.ok ? 'eingehalten' : 'verletzt', n.wo]);
  }
  csv += '\n';

  csv += _csvZeile(['LASTBILANZ']);
  csv += _csvZeile(['Position', 'Wert', 'Einheit', 'Herkunft']);
  for (const a of m.anlagen.filter(x => x.verbrauchKw > 0)) {
    csv += _csvZeile([`Bezug ${a.label} (${a.nV})`, _csvZahl(a.verbrauchKw, 1), 'kW', HERKUNFT[a.typ] || '']);
  }
  csv += _csvZeile([`Bezug Gebäude ohne Anlage (${m.kpi.nGeb})`, _csvZahl(m.kpi.gebKw, 1), 'kW', 'Jahresstrom ÷ 1800 h']);
  csv += _csvZeile(['Bezug gesamt', _csvZahl(m.kpi.bezugKw, 1), 'kW', 'ohne Gleichzeitigkeitsfaktor']);
  for (const a of m.anlagen.filter(x => x.erzeugungKw > 0)) {
    csv += _csvZeile([`Einspeisung ${a.label} (${a.nE})`, _csvZahl(a.erzeugungKw, 1), 'kW', HERKUNFT[a.typ] || '']);
  }
  csv += _csvZeile(['Einspeisung gesamt', _csvZahl(m.kpi.erzeugungKw, 1), 'kW', '']);
  csv += _csvZeile(['Trassenlänge gesamt', _csvZahl(m.kpi.laengeGesamt, 0), 'm', '']);
  csv += _csvZeile(['davon Mittelspannung', _csvZahl(m.kpi.laengeMs, 0), 'm', '']);
  csv += '\n';

  csv += _csvZeile(['TRANSFORMATOREN']);
  csv += _csvZeile(['Name', 'Sr (kVA)', 'uk (%)', 'Bezug (kW)', 'davon Gebäude ohne Anlage (kW)', 'Einspeisung (kW)', 'maßgebend (kW)', 'Richtung', 'Auslastung (%)', 'Reserve (kW)',
    'Betriebsart', 'Trafos in Gruppe', 'Auslastung Normalbetrieb (%)', 'Auslastung N-1 (%)']);
  for (const t of m.trafos) {
    const p = t.parallel;
    csv += _csvZeile([t.name, _csvZahl(t.kva, 0), _csvZahl(t.ukPct, 1), _csvZahl(t.bezugKw, 1), _csvZahl(t.gebKw, 1),
      _csvZahl(t.einspKw, 1), _csvZahl(t.massgebendKw, 1), t.richtung, _csvZahl(t.auslastung, 1), _csvZahl(t.reserveKw, 1),
      p ? (p.betriebsart === 'parallel' ? 'Parallelbetrieb' : 'redundant (N-1)') : 'Einzeltrafo', p ? p.ids.length : 1,
      _csvZahl(p ? p.normalPct : t.auslastung, 1), p ? _csvZahl(p.n1Pct, 1) : '']);
  }
  csv += '\n';

  csv += _csvZeile(['KABELSTRECKEN']);
  csv += _csvZeile(['Station', 'Abgang', 'Von', 'Nach', 'Ebene', 'Kabeltyp', 'Querschnitt (mm²)', 'Parallel', 'Länge (m)',
    'Bezug (kW)', 'Einspeisung (kW)', 'maßgebend (kW)', 'Ib (A)', 'Iz Katalog (A)', 'kIz', 'Iz eff (A)', 'Auslastung (%)',
    'ΔU Abschnitt (%)', 'ΔU kumuliert (%)', 'Sicherung (A)', 'Auslegung', 'Anlagen dahinter', 'Gebäude ohne Anlage dahinter']);
  for (const st of m.stationen) for (const ab of st.liste) for (const k of ab.kabel) {
    csv += _csvZeile([st.name, st.art === 'station' ? ab.label : '', k.von, k.nach, k.ebene, k.typ, k.querschnitt, k.nParallel,
      _csvZahl(k.laengeM, 1), _csvZahl(k.bezugKw, 1), _csvZahl(k.einspKw, 1), _csvZahl(k.massgebendKw, 1),
      _csvZahl(k.stromA, 1), _csvZahl(k.izKatA, 1), _csvZahl(k.kIz, 3), _csvZahl(k.izA, 1),
      _csvZahl(k.auslastung, 1), _csvZahl(k.duSegment, 3), _csvZahl(k.duKum, 3),
      k.sicherungA || '', !k.ausgelegt ? 'nicht ausgelegt (Gebäude)' : k.autoSized ? 'automatisch' : 'gesetzt',
      k.hinter ? k.hinter.nVerbraucher + k.hinter.nErzeuger : '', k.hinter ? k.hinter.nGeb : '']);
  }
  csv += '\n';

  csv += _csvZeile(['KNOTEN']);
  csv += _csvZeile(['Name', 'Typ', 'Station · Abgang', 'Verbrauch (kW)', 'Erzeugung (kW)', 'ΔU kumuliert (%)', 'Ik min (kA)', 'Ik max (kA)']);
  for (const n of m.knoten) {
    csv += _csvZeile([n.name, n.typ, n.ort, _csvZahl(n.verbrauchKw, 1), _csvZahl(n.erzeugungKw, 1),
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
