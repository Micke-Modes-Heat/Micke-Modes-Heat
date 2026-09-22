// ── 28-pv-netzaufnahme.js — PV-Aufnahmefähigkeit des Bestandsnetzes (App-Seite) ──
//
// Ansicht „Netzaufnahme (Bestand)" in der PV-Analyse. Beantwortet:
//   A) Wie viel der PV-Flächen passt ins Netz, ohne ein Kabel oder einen Trafo
//      zu ertüchtigen?  (EZA-Regler u. Ä. sind keine Netzertüchtigung.)
//   B) Welche Ertüchtigungen erschließen den Rest, zu welchen Kosten je kWp?
//
// Diese Schicht baut aus ASSETS / stromEdges / gebaeude das radiale Modell
// (Trafo → Kabel → … → Gebäude/PV-Asset) und hängt Kapazitäten, ΔU-Koeffizienten
// und Ertüchtigungsoptionen an. Gerechnet wird in lib/pv-netzaufnahme-core.js.
//
// Physik bewusst identisch zu elCalcAssets: Einspeisung 0,8 kW/kWp, Trafo
// kVA·0,9, Kabel über nsKabelAuslegen mit denselben Iz-/Temperatur-/cos φ-Werten,
// ΔU-Grenze 3 %. Anders als dort werden Kabel NIE neu ausgelegt — es zählt der
// erfasste Bestandsquerschnitt (sonst wächst das Netz mit und ist nie voll).
// Lastfall: volle Einspeisung ohne gleichzeitige Last (konservativ).

import { ASSETS, TYPE_RANK, getAssetStatus, getAssetPropsForYear } from './13a-assets-core.js';
import { getStromEdgeStatus, getStromEdgePropsForYear, _nsCosPhi, _nsKIz, _nsLeiterTemp, MAX_DELTA_U_PCT } from './05b-stromnetz.js';
import { gebaeude, globalYear } from './01-globals-varianten.js';
import { calcGebKwp, calcGebKwpKorr, escHtml } from './03c-gebaeude-io.js';
import { KABEL_TYPEN } from './config/netz-kosten.js';
import { nsKabelAuslegen } from './lib/ns-auslegung.js';
import { ERT_TRAFO_STUFEN, ertNaechsteTrafoStufe } from './14b-ertuechtigung.js';
import { engpassKabelAlternativen, engpassWaehleAlternative } from './lib/engpass-core.js';
import { normSchicht, SCHICHT } from './lib/schichten.js';
import { pvnaAbregelung, pvnaFuellen, pvnaTreppe, pvnaVollausbau } from './lib/pv-netzaufnahme-core.js';
import { makePvProfile8760, pvOrientationMix } from './09a-pv-profile.js';

const U_NS = 400;
const PF_TRAFO = 0.9;            // wie elCalcAssets / 14b
const EINSP_DEFAULT = 0.8;       // kW je kWp, wie assetErzeugung in elCalcAssets

let _letztes = null;             // { modell, treppe, eingaben, jahr }
// Eingaben der Ansicht — werden über pvCaptureState/pvRestoreState (09d) im
// Projekt unter pvAnalyse.netzaufnahme gespeichert.
// bestandAlsVorlast: PV-Anlagen der Schicht „Bestand" gelten als schon angeschlossen.
// Standard aus — Assets ohne Schicht zählen als Bestand, das würde geplante
// Anlagen still zur Vorbelastung machen.
const _einStandard = () => ({ quelle: 'aktiv', einspFaktor: EINSP_DEFAULT, duGrenzePct: MAX_DELTA_U_PCT, bestandAlsVorlast: false });
const _ein = _einStandard();

const _fmt = (x, d = 0) => (x == null || !Number.isFinite(x)) ? '—'
  : x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

// ══════════════════════════════════════════════════════════════════════════════
// MODELLBILDUNG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Baut das radiale Netzmodell für das Rechenjahr.
 * Rückgabe: { elemente, daecher, pruefpunkte, info } — info enthält Labels,
 * Zuordnungen und Hinweise für die Darstellung.
 */
export function pvnaModell(opts = {}) {
  const yr = opts.jahr ?? globalYear ?? new Date().getFullYear();
  const quelle = opts.quelle || 'aktiv';
  const einspFaktor = opts.einspFaktor > 0 ? opts.einspFaktor : EINSP_DEFAULT;
  const duGrenzePct = opts.duGrenzePct > 0 ? opts.duGrenzePct : MAX_DELTA_U_PCT;
  const istBestandPv = a => !!opts.bestandAlsVorlast && a.type === 'PV' && normSchicht(a.schicht) === SCHICHT.BESTAND;
  const gebArr = (typeof gebaeude !== 'undefined' ? gebaeude : window.gebaeude) || [];
  const gebById = new Map(gebArr.map(g => [g.id, g]));

  const aktiveA = ASSETS.items.filter(a =>
    (a.domain === 'strom' || a.domain === 'hybrid') && getAssetStatus(a, yr) === 'active');
  const assetMap = new Map(aktiveA.map(a => [a.id, a]));
  const kanten = (window.stromEdges || []).filter(e =>
    getStromEdgeStatus(e, yr) === 'active' && (assetMap.has(e.u) || assetMap.has(e.v)));

  const adj = new Map();
  const addAdj = (x, y, e) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push({ nb: y, edge: e }); };
  for (const e of kanten) { addAdj(e.u, e.v, e); addAdj(e.v, e.u, e); }

  const cosPhi = _nsCosPhi(), kIz = _nsKIz(), tLeiter = _nsLeiterTemp();
  const I_je_kW = 1000 / (Math.sqrt(3) * U_NS * cosPhi);
  const name = id => assetMap.get(id)?.name || gebById.get(id)?.name
    || (gebById.has(id) ? 'Gebäude ' + id : String(id));

  const elemente = [];
  const elInfo = new Map();           // elementId → { label, trafoId, kante?, asset? }
  const knotenEl = new Map();         // Knoten-ID → Element, über das er angebunden ist
  const knotenTrafo = new Map();      // Knoten-ID → Trafo-Asset-ID
  const hinweise = [];
  const unbekannteQs = [];

  // Radialer Baum je Trafo — gleiche Traversierungsregel wie elCalcAssets:
  // Gebäude immer durchqueren, Assets nur in Richtung steigenden TYPE_RANK.
  for (const t of aktiveA.filter(a => a.type === 'Trafo')) {
    const p = getAssetPropsForYear(t, yr);
    const kva = parseFloat(p.leistungKVA) || 630;
    const tid = 'T:' + t.id;
    elemente.push({ id: tid, typ: 'trafo', parentId: null, kapKw: kva * PF_TRAFO, duProKwPct: 0, vorlastKw: 0 });
    elInfo.set(tid, { label: `${t.name || 'Trafo'} (${kva} kVA)`, trafoId: t.id, asset: t, kva });
    knotenEl.set(t.id, tid);
    knotenTrafo.set(t.id, t.id);

    const trafoRang = TYPE_RANK.Trafo;
    const queue = [];
    const besucht = new Set([t.id]);
    for (const { nb, edge } of (adj.get(t.id) || [])) {
      const nbA = assetMap.get(nb);
      if (nbA && (TYPE_RANK[nbA.type] ?? 6) <= trafoRang) continue;   // nicht Richtung MS/NAP
      queue.push({ id: nb, von: t.id, edge });
    }
    while (queue.length) {
      const { id, von, edge } = queue.shift();
      if (besucht.has(id) || knotenTrafo.has(id)) continue;   // erster Trafo gewinnt
      besucht.add(id);
      const eid = 'E:' + edge.id;
      if (!elInfo.has(eid)) {
        const kab = _kabelElement(edge, yr, { cosPhi, kIz, tLeiter, I_je_kW });
        elemente.push({ id: eid, typ: 'kabel', parentId: knotenEl.get(von),
          kapKw: kab.kapKw, duProKwPct: kab.duProKwPct, vorlastKw: 0 });
        elInfo.set(eid, { label: `Kabel ${name(von)} → ${name(id)}`, kabelText: kab.text,
          trafoId: t.id, kante: edge, kab });
        if (kab.unbekannt) unbekannteQs.push(eid);
      }
      knotenEl.set(id, eid);
      knotenTrafo.set(id, t.id);
      const a = assetMap.get(id);
      const rang = TYPE_RANK[a?.type] ?? 6;
      for (const { nb, edge: e2 } of (adj.get(id) || [])) {
        if (besucht.has(nb)) continue;
        const nbA = assetMap.get(nb);
        if (!nbA || (TYPE_RANK[nbA.type] ?? 6) >= rang) queue.push({ id: nb, von: id, edge: e2 });
      }
    }
  }
  const elById = new Map(elemente.map(e => [e.id, e]));

  // Vorhandene Einspeisung, die nicht zur Disposition steht (Vorlast):
  // Wind, KWK und PV-Anlagen der Bestandsschicht.
  let bestandPvKwp = 0;
  for (const a of aktiveA) {
    const p = getAssetPropsForYear(a, yr);
    let kw = 0;
    if (a.type === 'Wind') kw = parseFloat(p.leistungKW) || 0;
    else if (a.type === 'KWK') kw = parseFloat(p.leistungElKW) || 0;
    else if (istBestandPv(a)) {
      const kwp = parseFloat(p.leistungKWp) || 0;
      bestandPvKwp += kwp;
      kw = kwp * einspFaktor;
    }
    if (kw <= 0) continue;
    const el = elById.get(knotenEl.get(a.id));
    if (el) el.vorlastKw += kw;
    else hinweise.push(`${escHtml(a.name || a.type)} (${_fmt(kw)} kW) ist an keinen Trafo angebunden und bleibt unberücksichtigt.`);
  }

  // Dächer: geplante PV-Assets + Gebäude-PV (ohne eigenes PV-Asset)
  const daecher = [];
  const dachInfo = new Map();
  const gebMitAsset = new Set();
  for (const a of aktiveA.filter(a => a.type === 'PV')) {
    if (a.buildingId != null) gebMitAsset.add(a.buildingId);
    if (istBestandPv(a)) continue;                                  // schon Vorlast
    const p = getAssetPropsForYear(a, yr);
    const kwp = parseFloat(p.leistungKWp) || 0;
    if (kwp <= 0) continue;
    const ertrag = p.pvSpez ? (parseFloat(p.pvSpez) / 950) : (p.ausrichtung === 'ostwest' ? 0.9 : 1.0);
    const id = 'A:' + a.id;
    daecher.push({ id, elementId: knotenEl.get(a.id) ?? null, kwpMax: kwp, ertragFaktor: ertrag, einspFaktor });
    dachInfo.set(id, { name: a.name || ('PV ' + a.id), gebId: a.buildingId, trafoId: knotenTrafo.get(a.id), art: 'PV-Anlage',
      ostwest: p.ausrichtung === 'ostwest' });
  }
  for (const g of gebArr) {
    if (gebMitAsset.has(g.id)) continue;
    if (quelle === 'aktiv' && !g.pvAktiv) continue;
    const kwp = calcGebKwp(g) || 0;
    if (kwp <= 0) continue;
    const id = 'G:' + g.id;
    daecher.push({ id, elementId: knotenEl.get(g.id) ?? null, kwpMax: kwp,
      ertragFaktor: (calcGebKwpKorr(g) || kwp) / kwp, einspFaktor });
    dachInfo.set(id, { name: g.name || ('Gebäude ' + g.id), gebId: g.id, trafoId: knotenTrafo.get(g.id),
      art: g.pvAktiv ? 'Dachfläche' : 'Dachpotenzial', ostwest: g.pvFlAusrichtung === 'ostwest' });
  }

  // Prüfpunkte für die Spannung: jeder angebundene Knoten
  const pruefpunkte = [...knotenEl.entries()]
    .filter(([id]) => !assetMap.has(id) || assetMap.get(id).type !== 'Trafo')
    .map(([id, elementId]) => ({ id: 'k:' + id, elementId }));

  if (!aktiveA.some(a => a.type === 'Trafo')) hinweise.push('Kein aktiver Trafo im Rechenjahr — ohne Trafo gibt es kein Netz, an das angeschlossen werden kann.');

  const eingabe = { elemente, daecher, pruefpunkte, duGrenzePct };
  _massnahmenAnhaengen(eingabe, elInfo, { kIz, cosPhi, tLeiter, I_je_kW });

  return { eingabe, info: { elInfo, dachInfo, hinweise, unbekannteQs, bestandPvKwp, jahr: yr, cosPhi, kIz } };
}

/** Kapazität, ΔU-Koeffizient und Beschreibung eines Bestandskabels. */
function _kabelElement(edge, yr, k) {
  const ep = getStromEdgePropsForYear(edge, yr);
  const lengthM = edge.lengthM || 0;
  if (edge.stationsintern) {
    return { kapKw: Infinity, duProKwPct: 0, text: 'stationsintern', stationsintern: true,
      ist: { crossSection: ep.crossSection, nParallel: ep.nParallel || 1, cableType: ep.cableType || 'NAYY', lengthM } };
  }
  if (!ep.crossSection) {
    return { kapKw: Infinity, duProKwPct: 0, unbekannt: true,
      text: `Querschnitt nicht erfasst, ${_fmt(lengthM)} m`, ist: { lengthM } };
  }
  const kt = KABEL_TYPEN[ep.cableType] || KABEL_TYPEN.NAYY;
  const r = _kabelKennwerte(kt, ep.crossSection, ep.nParallel || 1, lengthM, k);
  const n = Math.max(1, ep.nParallel || 1);
  return {
    kapKw: r.kapKw, duProKwPct: r.duProKwPct,
    text: `${n > 1 ? n + ' × ' : ''}${ep.crossSection} mm² ${ep.cableType || 'NAYY'}, ${_fmt(lengthM)} m`
      + (edge.autoSized ? ' (Querschnitt geschätzt)' : ''),
    ist: { crossSection: ep.crossSection, nParallel: n, cableType: ep.cableType || 'NAYY', lengthM },
  };
}

function _kabelKennwerte(kt, mm2, nPar, lengthM, k) {
  const r = nsKabelAuslegen({
    kt, I_A: k.I_je_kW, I_A_sign: k.I_je_kW, crossSection: mm2, nParallel: nPar,
    autoSized: false, lengthM, kIz: k.kIz, tLeiter: k.tLeiter, cosPhi: k.cosPhi, U_V: U_NS,
  });
  return {
    kapKw: r.izEffA / k.I_je_kW,            // Iz_eff · √3 · U · cos φ
    duProKwPct: r.deltaUPct,                // ΔU in % je kW Fluss
  };
}

/**
 * Hängt jedem Element, das beim Vollausbau überlastet wäre oder auf dem Weg zu
 * einem Knoten mit zu hoher Spannung liegt, die kleinste ausreichende
 * Ertüchtigung an (Trafo-Stufe bzw. Querschnitt/Parallelstrang).
 */
function _massnahmenAnhaengen(eingabe, elInfo, k) {
  const voll = pvnaVollausbau(eingabe);
  const elById = new Map(eingabe.elemente.map(e => [e.id, e]));
  const parentOf = id => elById.get(id)?.parentId;
  const tiefbauEurM = parseFloat(document.getElementById('strom-k-tiefbau')?.value) || 100;

  // Höchste Spannung je Kabel über alle Prüfpunkte dahinter (beim Vollausbau)
  const maxDuHinter = new Map();
  const alle = [
    ...eingabe.daecher.map(d => ({ id: 'dach:' + d.id, elementId: d.elementId })),
    ...eingabe.pruefpunkte,
  ];
  for (const p of alle) {
    const du = voll.duPct.get(p.id);
    if (du == null) continue;
    let cur = p.elementId;
    const ges = new Set();
    while (cur && !ges.has(cur)) {
      ges.add(cur);
      maxDuHinter.set(cur, Math.max(maxDuHinter.get(cur) || 0, du));
      cur = parentOf(cur);
    }
  }

  for (const e of eingabe.elemente) {
    const fluss = voll.flussKw.get(e.id) || 0;
    const info = elInfo.get(e.id);
    if (e.typ === 'trafo') {
      if (!(fluss > e.kapKw)) continue;
      const st = ertNaechsteTrafoStufe(fluss, ERT_TRAFO_STUFEN);
      if (!st || st.bisKvA <= info.kva) continue;
      e.massnahme = {
        label: `${info.asset.name || 'Trafo'} ${info.kva} → ${st.bisKvA < Infinity ? st.bisKvA + ' kVA' : 'Übergabestation'}`,
        investEUR: st.investEUR,
        kapKw: st.bisKvA < Infinity ? st.bisKvA * PF_TRAFO : Infinity,
      };
      continue;
    }
    const kab = info.kab;
    if (kab.unbekannt || kab.stationsintern) continue;
    const ueber = fluss > e.kapKw;
    const duMax = maxDuHinter.get(e.id) || 0;
    const spannung = duMax > eingabe.duGrenzePct && e.duProKwPct > 0;
    if (!ueber && !spannung) continue;
    // engpassKabelAlternativen skaliert den Leitwert rein ohmsch (ΔU ~ 1/A·n). Der
    // Reaktanzanteil sinkt mit dem Querschnitt aber kaum — deshalb nachschärfen,
    // bis die Spannung am Strangende beim Vollausbau wirklich eingehalten ist.
    let zielDu = spannung ? duMax : 0, wahl = null, neu = null;
    for (let i = 0; i < 5; i++) {
      wahl = engpassWaehleAlternative(engpassKabelAlternativen(kab.ist,
        { benoetigtA: fluss * k.I_je_kW / (k.kIz || 1), maxDuPct: zielDu },
        { typen: KABEL_TYPEN, tiefbauEurM, grenzDuPct: eingabe.duGrenzePct }));
      if (!wahl) break;
      const np = wahl.newProps;
      const kt = KABEL_TYPEN[np.cableType || kab.ist.cableType] || KABEL_TYPEN.NAYY;
      neu = _kabelKennwerte(kt, np.crossSection, np.nParallel || 1, kab.ist.lengthM, k);
      if (!spannung) break;
      const duNeu = duMax - (e.duProKwPct - neu.duProKwPct) * fluss;
      if (duNeu <= eingabe.duGrenzePct + 1e-6) break;
      zielDu *= duNeu / eingabe.duGrenzePct * 1.01;
    }
    if (!wahl) { info.ungeloest = true; continue; }
    e.massnahme = {
      label: `${info.label}: ${wahl.label}`,
      investEUR: wahl.investEUR, kapKw: neu.kapKw, duProKwPct: neu.duProKwPct,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RECHNEN + DARSTELLEN
// ══════════════════════════════════════════════════════════════════════════════

/** Eingaben aus der Ansicht übernehmen (falls sie gerade gezeichnet ist). */
function _eingabenLesen() {
  const q = document.getElementById('pvna-quelle')?.value;
  const f = parseFloat(document.getElementById('pvna-einsp')?.value);
  const u = parseFloat(document.getElementById('pvna-du')?.value);
  if (q) _ein.quelle = q;
  if (f > 0) _ein.einspFaktor = f;
  if (u > 0) _ein.duGrenzePct = u;
  const bv = document.getElementById('pvna-bestand');
  if (bv) _ein.bestandAlsVorlast = !!bv.checked;
}

/** Rechnet mit den aktuellen Eingaben und legt das Ergebnis ab. */
function _berechnen() {
  _eingabenLesen();
  const modell = pvnaModell({ ..._ein });
  const treppe = pvnaTreppe(modell.eingabe);
  const optionen = _optionen(modell, treppe);
  _letztes = { modell, treppe, optionen, eingaben: { ..._ein }, jahr: modell.info.jahr };
  window._pvNetzaufnahme = _kompakt(_letztes);
  if (window.pvnaKarteAktiv) { pvnaMarkiereKarte(); _legendeZeigen(); }
  return _letztes;
}

// ── Weniger ausbauen oder abregeln? ────────────────────────────────────────
// Das Netz lässt an jedem Dach eine bestimmte Einspeiseleistung zu (Stufe A:
// angeschlossene kWp × Einspeisefaktor). Daraus folgen zwei Wege:
//   A) weniger ausbauen — nur so viel kWp, wie das Netz aufnimmt;
//   B) voll ausbauen und die Einspeisung am EZA-Regler/Wechselrichter auf die
//      Netzgrenze kappen — mehr Ertrag, aber ein Teil wird abgeregelt.
// Beide Wege stündlich mit dem PV-Profil gerechnet (gleiche Quelle wie die
// PV-Analyse: hochgeladenes Profil vor synthetischem).

/** Profilform (Summe 1,0) je Ausrichtung; ein hochgeladenes Profil gilt für alle Dächer. */
function _profilForm(ostwest) {
  const up = window.elPvH;
  if (up && up.length >= 8760) {
    let summe = 0;
    for (let i = 0; i < 8760; i++) summe += up[i] || 0;
    if (summe > 0) {
      const out = new Float32Array(8760);
      for (let i = 0; i < 8760; i++) out[i] = (up[i] || 0) / summe;
      return out;
    }
  }
  return makePvProfile8760(ostwest ? 'ostwest' : 'sued');
}

/** Map<dachId, { pZulKw, a, b, mehrKwhProKwp }> — a/b wie pvnaAbregelung plus kwp. */
function _optionen(modell, treppe) {
  const out = new Map();
  const eingabe = new Map(modell.eingabe.daecher.map(d => [d.id, d]));
  const spezSued = pvOrientationMix().spezSued || 950;
  const formen = {};
  for (const d of treppe.basis.daecher) {
    const dm = eingabe.get(d.id);
    const ow = !!modell.info.dachInfo.get(d.id)?.ostwest;
    const form = formen[ow] || (formen[ow] = _profilForm(ow));
    const spez = spezSued * (dm?.ertragFaktor || 1);
    const pZulKw = d.kwp * (dm?.einspFaktor > 0 ? dm.einspFaktor : EINSP_DEFAULT);
    const a = { kwp: d.kwp, ...pvnaAbregelung(form, spez, d.kwp, pZulKw) };
    const b = { kwp: d.kwpMax, ...pvnaAbregelung(form, spez, d.kwpMax, pZulKw) };
    const mehrKwp = d.kwpMax - d.kwp;
    out.set(d.id, { pZulKw, spez, a, b,
      mehrKwhProKwp: mehrKwp > 0.5 && pZulKw > 0 ? (b.nutzbarMwh - a.nutzbarMwh) * 1000 / mehrKwp : null });
  }
  return out;
}

/** Summen der beiden Wege über alle Dächer (ohne Ertüchtigung). */
function _optionenSumme(optionen) {
  const s = { aKwp: 0, aMwh: 0, bKwp: 0, bMwh: 0, bErzMwh: 0, bAbgMwh: 0 };
  for (const o of optionen.values()) {
    s.aKwp += o.a.kwp; s.aMwh += o.a.nutzbarMwh;
    if (o.pZulKw <= 0) continue;               // ohne Netzkapazität wird dort nicht gebaut
    s.bKwp += o.b.kwp; s.bMwh += o.b.nutzbarMwh; s.bErzMwh += o.b.erzeugungMwh; s.bAbgMwh += o.b.abgeregeltMwh;
  }
  s.bVerlustPct = s.bErzMwh > 0 ? s.bAbgMwh / s.bErzMwh * 100 : 0;
  return s;
}

/**
 * Serialisierbare Zusammenfassung (Variante, Herleitung, Speicherung):
 * Kennzahlen, Begrenzer-Zählung und die Stufen der Ausbautreppe.
 */
function _kompakt({ modell, treppe, optionen, eingaben, jahr }) {
  const begrenzer = {};
  for (const d of treppe.basis.daecher) {
    if (!d.begrenzer) continue;
    const art = _ART[d.begrenzer.art] || d.begrenzer.art;
    begrenzer[art] = (begrenzer[art] || 0) + 1;
  }
  return {
    jahr, eingaben: { ...eingaben },
    potenzialKwp: treppe.basis.potenzialKwp,
    ohneErtuechtigungKwp: treppe.basis.summeKwp,
    mitErtuechtigungKwp: treppe.ende.summeKwp,
    investEUR: treppe.schritte.at(-1)?.kumInvestEUR || 0,
    restKwp: treppe.restKwp,
    begrenzer,
    trafoAnzahl: modell.eingabe.elemente.filter(e => e.typ === 'trafo').length,
    // Weg B über alle Dächer: voll ausbauen (wo das Netz überhaupt etwas aufnimmt) und abregeln
    abregelung: optionen ? (({ aMwh, bKwp, bMwh, bVerlustPct }) =>
      ({ wenigerMwh: aMwh, vollKwp: bKwp, vollNutzbarMwh: bMwh, vollVerlustPct: bVerlustPct }))(_optionenSumme(optionen)) : null,
    schritte: treppe.schritte.map(s => ({
      label: s.massnahmen.map(m => m.label).join(' + '),
      investEUR: s.investEUR, zuwachsKwp: s.zuwachsKwp, summeKwp: s.summeKwp, kumInvestEUR: s.kumInvestEUR,
    })),
  };
}

export function pvnaRechnen() {
  _berechnen();
  pvnaRender();
}

/**
 * Für die PV-Analyse (Variante „Bestandsnetz"): rechnet neu und liefert die
 * Zusammenfassung — oder null, wenn es kein Netz mit Trafo oder keine Flächen gibt.
 */
export function pvnaFuerVariante() {
  const r = _berechnen();
  if (document.getElementById('pva-netzaufnahme')?.style.display === 'block') pvnaRender();
  const k = window._pvNetzaufnahme;
  if (!k.trafoAnzahl || !r.modell.eingabe.daecher.length) return null;
  return k;
}

export function pvnaLetztesErgebnis() { return _letztes; }

export function pvnaRender() {
  const el = document.getElementById('pva-netzaufnahme');
  if (!el) return;
  el.innerHTML = _steuerHtml() + (_letztes ? _ergebnisHtml(_letztes) : `
    <div style="color:var(--muted);font-size:11px;text-align:center;padding:40px 0;">
      Rechnet aus Trafos, Kabeln und den Dachflächen der Gebäude, wie viel PV das
      bestehende Netz aufnimmt — unabhängig von Lastgang und Variantenrechnung.<br>
      „Aufnahme berechnen" starten.</div>`);
}

function _steuerHtml() {
  const lbl = 'color:var(--muted);font-size:10px;display:block;margin-bottom:3px;';
  const inp = 'width:100%;padding:5px 7px;font-size:11.5px;';
  return `
  <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:14px;">
    <div style="flex:1 1 220px;">
      <span style="${lbl}">PV-Flächen</span>
      <select id="pvna-quelle" style="${inp}">
        <option value="aktiv" ${_ein.quelle === 'aktiv' ? 'selected' : ''}>Gebäude mit aktiver PV + PV-Anlagen</option>
        <option value="alle"  ${_ein.quelle === 'alle' ? 'selected' : ''}>Alle Dächer (Dachpotenzial)</option>
      </select>
    </div>
    <div style="flex:0 1 130px;">
      <span style="${lbl}" title="Maßgebliche Einspeiseleistung je kWp. 0,8 wie in der Netzberechnung (Wechselrichter/Einstrahlung).">Einspeisung kW/kWp</span>
      <input id="pvna-einsp" type="number" min="0.1" max="1.2" step="0.05" value="${_ein.einspFaktor}" style="${inp}">
    </div>
    <div style="flex:0 1 130px;">
      <span style="${lbl}" title="Zulässige Spannungsanhebung ab Trafo-Sammelschiene (VDE-AR-N 4105: 3 %).">ΔU-Grenze %</span>
      <input id="pvna-du" type="number" min="0.5" max="10" step="0.5" value="${_ein.duGrenzePct}" style="${inp}">
    </div>
    <label style="flex:1 1 100%;font-size:10.5px;color:var(--muted);display:flex;gap:6px;align-items:center;order:9;">
      <input id="pvna-bestand" type="checkbox" ${_ein.bestandAlsVorlast ? 'checked' : ''}>
      PV-Anlagen der Schicht „Bestand" als bereits angeschlossen ansetzen (Vorbelastung statt Kandidat)</label>
    <button class="btn-confirm" style="padding:7px 16px;font-size:11.5px;" data-click="pvnaRechnen()">Aufnahme berechnen</button>
  </div>`;
}

function _kachel(wert, einheit, label, farbe) {
  return `<div style="flex:1 1 150px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:10px 12px;">
    <div style="font-size:19px;font-family:'DM Mono',monospace;color:${farbe || 'var(--text)'};">${wert}<span style="font-size:11px;color:var(--muted);margin-left:4px;">${einheit}</span></div>
    <div style="font-size:10px;color:var(--muted);margin-top:2px;">${label}</div></div>`;
}

function _ergebnisHtml({ modell, treppe, jahr }) {
  const { info } = modell;
  const b = treppe.basis, e = treppe.ende;
  const pot = b.potenzialKwp;
  const pct = x => pot > 0 ? ' (' + _fmt(x / pot * 100) + ' %)' : '';
  const invest = treppe.schritte.at(-1)?.kumInvestEUR || 0;

  if (!modell.eingabe.daecher.length) {
    return `<div style="color:var(--muted);font-size:11px;padding:20px 0;">Keine PV-Flächen gefunden.
      Auf „Alle Dächer" umstellen oder Gebäuden PV zuweisen.</div>` + _hinweiseHtml(info);
  }

  const os = _optionenSumme(_letztes.optionen);
  const kacheln = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
    ${_kachel(_fmt(pot), 'kWp', 'Flächenpotenzial')}
    ${_kachel(_fmt(b.summeKwp), 'kWp', 'ohne Ertüchtigung' + pct(b.summeKwp), '#66bb6a')}
    ${_kachel(_fmt(e.summeKwp), 'kWp', 'mit Ertüchtigung' + pct(e.summeKwp), '#4fc3f7')}
    ${_kachel(_fmt(invest / 1000), 'T€', 'Invest Ertüchtigung', '#ffb74d')}
    ${treppe.restKwp > 0.5 ? _kachel(_fmt(treppe.restKwp), 'kWp', 'nicht erschließbar', '#ef5350') : ''}
  </div>
  <div style="font-size:11px;font-weight:600;margin:2px 0 6px;">Ohne Ertüchtigung: weniger ausbauen oder abregeln?</div>
  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
    ${_kachel(_fmt(os.aKwp), 'kWp', `A · weniger ausbauen → ${_fmt(os.aMwh)} MWh/a`, '#66bb6a')}
    ${_kachel(_fmt(os.bKwp), 'kWp', `B · voll ausbauen + abregeln → ${_fmt(os.bMwh)} MWh/a nutzbar`, '#ffb300')}
    ${_kachel(_fmt(os.bVerlustPct, 1), '%', `Abregelungsverlust bei B (${_fmt(os.bAbgMwh)} MWh/a)`, '#ff7043')}
    ${_kachel('+' + _fmt(os.bMwh - os.aMwh), 'MWh/a', `Mehrertrag B gegenüber A für +${_fmt(os.bKwp - os.aKwp)} kWp`, '#4fc3f7')}
  </div>
  <div style="font-size:10.5px;color:var(--muted);margin-bottom:14px;line-height:1.5;">
    Beide Wege halten die Netzgrenze ein: Bei B wird die Einspeisung am EZA-Regler bzw. Wechselrichter
    auf dieselbe Leistung gekappt wie bei A. Stündlich gerechnet mit dem PV-Profil, ohne Eigenverbrauch
    (der die Abregelung zusätzlich senken würde). Dächer ohne jede Netzkapazität sind in B nicht enthalten.</div>
  <div style="font-size:10.5px;color:var(--muted);margin-bottom:14px;">
    Rechenjahr ${jahr} · volle Einspeisung ${_fmt(modell.eingabe.daecher[0]?.einspFaktor, 2)} kW/kWp ohne gleichzeitige Last ·
    ΔU ≤ ${_fmt(modell.eingabe.duGrenzePct, 1)} % · Kabel mit Bestandsquerschnitt · Belegung: ertragsstärkste Dächer zuerst
    ${info.bestandPvKwp > 0 ? ` · ${_fmt(info.bestandPvKwp)} kWp Bestands-PV als Vorbelastung` : ''}</div>`;

  return kacheln + _karteKnopf() + pvnaTreppeSvg(_kompakt(_letztes)) + _massnahmenHtml(treppe) + _trafoHtml(modell, treppe)
    + _gebaeudeHtml(modell, treppe) + _hinweiseHtml(info);
}

/**
 * Stufendiagramm: angeschlossene kWp über kumuliertem Invest.
 * t: kompakte Form ({ potenzialKwp, ohneErtuechtigungKwp, schritte[] }) — auch
 * von der Herleitung der PV-Analyse genutzt (window.pvnaTreppeSvg).
 */
export function pvnaTreppeSvg(t) {
  if (!t) return '';
  const W = 640, H = 220, PL = 62, PR = 16, PT = 14, PB = 36;
  const pot = t.potenzialKwp || 1;
  const basisKwp = t.ohneErtuechtigungKwp || 0;
  const schritte = t.schritte || [];
  const maxX = Math.max(schritte.at(-1)?.kumInvestEUR || 0, 1);
  const x = v => PL + v / maxX * (W - PL - PR);
  const y = v => PT + (1 - v / pot) * (H - PT - PB);
  let d = `M${x(0)},${y(basisKwp)}`;
  for (const s of schritte) d += ` H${x(s.kumInvestEUR)} V${y(s.summeKwp)}`;
  d += ` H${x(maxX)}`;
  const punkte = schritte.map((s, i) =>
    `<circle cx="${x(s.kumInvestEUR)}" cy="${y(s.summeKwp)}" r="3.5" fill="#4fc3f7"><title>Schritt ${i + 1}: +${_fmt(s.zuwachsKwp)} kWp für ${_fmt(s.investEUR)} €</title></circle>
     <text x="${x(s.kumInvestEUR) + 5}" y="${y(s.summeKwp) - 5}" font-size="9" fill="var(--muted)">${i + 1}</text>`).join('');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => `
    <line x1="${PL}" x2="${W - PR}" y1="${y(pot * f)}" y2="${y(pot * f)}" stroke="var(--border)" stroke-width="0.5"/>
    <text x="${PL - 6}" y="${y(pot * f) + 3}" font-size="9" fill="var(--muted)" text-anchor="end">${_fmt(pot * f)}</text>`).join('');
  const xTicks = [0, 0.5, 1].map(f => `
    <text x="${x(maxX * f)}" y="${H - PB + 14}" font-size="9" fill="var(--muted)" text-anchor="middle">${_fmt(maxX * f / 1000)} T€</text>`).join('');
  return `
  <div style="font-size:11px;font-weight:600;margin:4px 0 6px;">Ausbautreppe — angeschlossene PV über Ertüchtigungskosten</div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;margin-bottom:14px;">
    ${yTicks}${xTicks}
    <line x1="${PL}" x2="${W - PR}" y1="${y(pot)}" y2="${y(pot)}" stroke="#ef5350" stroke-dasharray="4,3" stroke-width="1"/>
    <text x="${W - PR}" y="${y(pot) - 4}" font-size="9" fill="#ef5350" text-anchor="end">Flächenpotenzial</text>
    <path d="${d}" fill="none" stroke="#4fc3f7" stroke-width="2"/>
    <circle cx="${x(0)}" cy="${y(basisKwp)}" r="4" fill="#66bb6a"><title>Bestand: ${_fmt(basisKwp)} kWp</title></circle>
    ${punkte}
    <text x="12" y="${(PT + H - PB) / 2}" font-size="9" fill="var(--muted)" text-anchor="middle" transform="rotate(-90 12 ${(PT + H - PB) / 2})">angeschlossen kWp</text>
  </svg>`;
}

const _th = t => `<th style="text-align:left;font-weight:500;color:var(--muted);padding:5px 8px;border-bottom:1px solid var(--border);">${t}</th>`;
const _thR = t => `<th style="text-align:right;font-weight:500;color:var(--muted);padding:5px 8px;border-bottom:1px solid var(--border);">${t}</th>`;
const _td = (t, r) => `<td style="padding:5px 8px;border-bottom:1px solid var(--border);${r ? 'text-align:right;white-space:nowrap;font-family:\'DM Mono\',monospace;' : ''}">${t}</td>`;
const _tabelle = (kopf, zeilen) => `<div style="overflow-x:auto;margin-bottom:16px;">
  <table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr>${kopf}</tr></thead><tbody>${zeilen}</tbody></table></div>`;

function _massnahmenHtml(t) {
  if (!t.schritte.length) {
    return `<div style="font-size:11px;color:var(--muted);margin-bottom:16px;">${t.restKwp > 0.5
      ? 'Keine Standard-Ertüchtigung erschließt weitere Flächen (siehe Hinweise).'
      : 'Alle Flächen lassen sich ohne Ertüchtigung anschließen.'}</div>`;
  }
  const zeilen = [`<tr>${_td('0')}${_td('Bestand — keine Ertüchtigung')}${_td('—', 1)}${_td(_fmt(t.basis.summeKwp), 1)}${_td('—', 1)}${_td(_fmt(t.basis.summeKwp), 1)}</tr>`,
    ...t.schritte.map((s, i) => `<tr>${_td(i + 1)}${_td(s.massnahmen.map(m => escHtml(m.label)).join('<br>'))}
      ${_td(_fmt(s.investEUR), 1)}${_td('+' + _fmt(s.zuwachsKwp), 1)}${_td(_fmt(s.eurProKwp), 1)}${_td(_fmt(s.summeKwp), 1)}</tr>`)].join('');
  return `<div style="font-size:11px;font-weight:600;margin-bottom:6px;">Ertüchtigungen in Reihenfolge der Wirksamkeit (€ je zusätzlichem kWp)</div>`
    + _tabelle(_th('#') + _th('Maßnahme') + _thR('Invest €') + _thR('Zuwachs kWp') + _thR('€/kWp') + _thR('angeschlossen kWp'), zeilen);
}

function _trafoHtml(modell, t) {
  const { info } = modell;
  const proTrafo = new Map();
  const add = (tid, key, v) => {
    if (!proTrafo.has(tid)) proTrafo.set(tid, { pot: 0, a: 0, b: 0 });
    proTrafo.get(tid)[key] += v;
  };
  const endeById = new Map(t.ende.daecher.map(d => [d.id, d]));
  for (const d of t.basis.daecher) {
    const tid = info.dachInfo.get(d.id)?.trafoId ?? null;
    add(tid, 'pot', d.kwpMax); add(tid, 'a', d.kwp); add(tid, 'b', endeById.get(d.id)?.kwp || 0);
  }
  const auslBasis = new Map(t.basis.elemente.map(e => [e.id, e]));
  const zeilen = [...proTrafo.entries()].map(([tid, v]) => {
    const el = tid != null ? auslBasis.get('T:' + tid) : null;
    const name = tid != null ? escHtml(info.elInfo.get('T:' + tid)?.label || tid) : '<i>nicht angebunden</i>';
    return `<tr>${_td(name)}${_td(_fmt(v.pot), 1)}${_td(_fmt(v.a), 1)}${_td(v.pot > 0 ? _fmt(v.a / v.pot * 100) + ' %' : '—', 1)}
      ${_td(el ? _fmt(el.auslastungPct) + ' %' : '—', 1)}${_td(_fmt(v.b), 1)}</tr>`;
  }).join('');
  return `<div style="font-size:11px;font-weight:600;margin-bottom:6px;">Je Trafo</div>`
    + _tabelle(_th('Trafo') + _thR('Potenzial kWp') + _thR('ohne Ertücht. kWp') + _thR('Anteil')
      + _thR('Trafo-Auslastung') + _thR('mit Ertücht. kWp'), zeilen);
}

const _ART = { strom: 'Kabel-Strombelastbarkeit', trafo: 'Trafo-Nennleistung', spannung: 'Spannungsanhebung',
  vorbelastet: 'durch vorhandene Einspeisung ausgelastet', 'nicht-angebunden': 'nicht am Netz angebunden' };

/** Stufen der Anschlussquote — Tabelle und Karte nutzen dieselbe Skala. */
const ANTEIL_STUFEN = [
  { ab: 0.999, farbe: '#43a047', label: '100 %' },
  { ab: 0.75,  farbe: '#9ccc65', label: '75–99 %' },
  { ab: 0.50,  farbe: '#fdd835', label: '50–74 %' },
  { ab: 0.25,  farbe: '#ffa726', label: '25–49 %' },
  { ab: 0.001, farbe: '#ff7043', label: '1–24 %' },
  { ab: -1,    farbe: '#e53935', label: '0 %' },
];
const _anteilFarbe = a => ANTEIL_STUFEN.find(st => a >= st.ab).farbe;

function _gebaeudeHtml(modell, t) {
  const { info } = modell;
  const opt = _letztes.optionen;
  const endeById = new Map(t.ende.daecher.map(d => [d.id, d]));
  const thG = (txt, n, farbe) => `<th colspan="${n}" style="text-align:center;font-weight:600;color:${farbe};padding:4px 8px;border-bottom:1px solid var(--border);">${txt}</th>`;
  const zeilen = [...t.basis.daecher]
    .sort((a, b) => (a.anteil - b.anteil) || (b.kwpMax - a.kwpMax))
    .map(d => {
      const di = info.dachInfo.get(d.id) || {};
      const o = opt.get(d.id);
      const elBeg = d.begrenzer?.elementId ? info.elInfo.get(d.begrenzer.elementId) : null;
      const grund = d.begrenzer
        ? `${_ART[d.begrenzer.art] || d.begrenzer.art}${elBeg ? ' — ' + escHtml(elBeg.label) : ''}`
          + (elBeg?.kabelText ? ` <span style="color:var(--muted);">(${escHtml(elBeg.kabelText)})</span>` : '')
        : '—';
      const ohneNetz = !o || o.pZulKw <= 0;
      const voll = d.anteil >= 0.999;
      return `<tr>${_td(`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${_anteilFarbe(d.anteil)};margin-right:6px;"></span>${escHtml(di.name || d.id)}`
          + `<div style="color:var(--muted);font-size:10px;margin-left:14px;">${escHtml(di.art || '')}</div>`)}
        ${_td(_fmt(d.kwpMax), 1)}${_td(_fmt(o?.pZulKw), 1)}
        ${_td(_fmt(d.kwp), 1)}${_td(_fmt(d.anteil * 100) + ' %', 1)}${_td(_fmt(o?.a.nutzbarMwh, 1), 1)}
        ${_td(ohneNetz ? '—' : voll ? '<span style="color:var(--muted);">= A</span>' : _fmt(o.b.nutzbarMwh, 1), 1)}
        ${_td(ohneNetz || voll ? '—' : _fmt(o.b.verlustPct, 1) + ' %', 1)}
        ${_td(ohneNetz || voll || o.mehrKwhProKwp == null ? '—' : _fmt(o.mehrKwhProKwp), 1)}
        ${_td(_fmt(endeById.get(d.id)?.kwp), 1)}${_td(grund)}</tr>`;
    }).join('');
  const kopf1 = `<tr>${thG('', 3, 'var(--muted)')}${thG('A · weniger ausbauen', 3, '#66bb6a')}`
    + `${thG('B · voll ausbauen + abregeln', 3, '#ffb300')}${thG('', 2, 'var(--muted)')}</tr>`;
  const kopf2 = _th('Gebäude / Anlage') + _thR('Potenzial kWp') + _thR('Netzgrenze kW')
    + _thR('kWp') + _thR('Anteil') + _thR('MWh/a')
    + _thR('MWh/a nutzbar') + _thR('Abregelung') + _thR('kWh je Zusatz-kWp')
    + _thR('mit Ertücht. kWp') + _th('begrenzt durch (ohne Ertüchtigung)');
  return `<div style="font-size:11px;font-weight:600;margin-bottom:4px;">Je Dach / PV-Anlage</div>
    <div style="font-size:10.5px;color:var(--muted);margin-bottom:6px;line-height:1.5;">
      <b>Netzgrenze</b> = Einspeiseleistung, die das Bestandsnetz an diesem Dach aufnimmt.
      <b>kWh je Zusatz-kWp</b> = nutzbarer Mehrertrag jedes über A hinaus gebauten kWp — liegt er nahe am
      normalen spezifischen Ertrag, lohnt sich Abregeln; sinkt er stark, lieber kleiner bauen.</div>`
    + `<div style="overflow-x:auto;margin-bottom:16px;"><table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>${kopf1}<tr>${kopf2}</tr></thead><tbody>${zeilen}</tbody></table></div>`;
}

function _hinweiseHtml(info) {
  const h = [...info.hinweise];
  if (info.unbekannteQs.length) {
    h.push(`${info.unbekannteQs.length} Kabel ohne erfassten Querschnitt — für sie gilt keine Grenze, die Aufnahme ist dort überschätzt: `
      + info.unbekannteQs.slice(0, 8).map(id => escHtml(info.elInfo.get(id)?.label || id)).join(', ')
      + (info.unbekannteQs.length > 8 ? ' …' : ''));
  }
  const ungeloest = [...info.elInfo.values()].filter(i => i.ungeloest).map(i => escHtml(i.label));
  if (ungeloest.length) h.push(`Kein Standardkabel reicht für: ${ungeloest.join(', ')} — hier hilft nur eine Strukturänderung (weiterer Abgang, eigene Anbindung).`);
  h.push('Modellgrenzen: Hausanschlusskabel ohne Querschnitt, Mittelspannung und Netzanschlusspunkt werden hier nicht begrenzt '
    + '(NAP-Einspeisegrenze: Abb. 6). Keine gleichzeitige Last angesetzt — konservativ. Blindleistungsregelung Q(U) und '
    + 'Einspeisebegrenzung am EZA-Regler lassen sich über „Einspeisung kW/kWp" abbilden (z. B. 0,6 bei 60-%-Begrenzung).');
  return `<div style="font-size:10.5px;color:var(--muted);line-height:1.55;border-top:1px solid var(--border);padding-top:10px;">
    ${h.map(x => `<div style="margin-bottom:4px;">• ${x}</div>`).join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// KARTE — Dächer nach Anschlussquote ohne Ertüchtigung (Stufenskala 0–100 %)
// ══════════════════════════════════════════════════════════════════════════════
// updateViz (02c) überschreibt jeden Polygonstil und ruft danach
// window.pvnaMarkiereKarte auf, solange window.pvnaKarteAktiv gesetzt ist.

const LEGENDE_ID = 'pvna-karten-legende';
let _labelGruppe = null;                      // L.layerGroup mit den Prozent-Beschriftungen
let _labelsAn = true;

function _karteKnopf() {
  const an = !!window.pvnaKarteAktiv;
  return `<div style="margin:-4px 0 14px;">
    <button class="btn-confirm" style="padding:6px 14px;font-size:11px;"
      data-click="${an ? 'pvnaKarteAus()' : 'pvnaKarteZeigen()'}">${an ? 'Kartenfärbung aus' : '🗺 Dächer auf der Karte zeigen'}</button>
    <span style="font-size:10px;color:var(--muted);margin-left:8px;">Anteil der Dachfläche, der ohne Ertüchtigung ans Netz kann:
      ${ANTEIL_STUFEN.map(st => `<span style="color:${st.farbe};">■</span> ${st.label}`).join(' · ')}</span></div>`;
}

/** Je Gebäude summiert: kWp ohne/mit Ertüchtigung, Netzgrenze und beide Wege. */
function _jeGebaeude() {
  const m = new Map();
  if (!_letztes) return m;
  const { modell, treppe, optionen } = _letztes;
  const ende = new Map(treppe.ende.daecher.map(d => [d.id, d]));
  for (const d of treppe.basis.daecher) {
    const gId = modell.info.dachInfo.get(d.id)?.gebId;
    if (gId == null) continue;
    const e = m.get(gId) || { kwp: 0, kwpMax: 0, kwpMit: 0, pZulKw: 0, aMwh: 0, bMwh: 0, bErzMwh: 0, begrenzer: null };
    const o = optionen?.get(d.id);
    e.kwp += d.kwp; e.kwpMax += d.kwpMax; e.kwpMit += ende.get(d.id)?.kwp || 0;
    if (o) {
      e.pZulKw += o.pZulKw; e.aMwh += o.a.nutzbarMwh;
      if (o.pZulKw > 0) { e.bMwh += o.b.nutzbarMwh; e.bErzMwh += o.b.erzeugungMwh; }
    }
    if (d.begrenzer && !e.begrenzer) e.begrenzer = d.begrenzer;
    m.set(gId, e);
  }
  return m;
}

/** Mittelpunkt eines Gebäudepolygons (für die Beschriftung). Bewusst neu aus den
 *  Eckpunkten: getBounds() liefert Leaflets zwischengespeichertes Objekt, das ein
 *  fremdes extend() verändert haben kann. */
function _mitte(g) {
  try { return window.L.latLngBounds(g.polygonLayer.getLatLngs().flat(2)).getCenter(); } catch { return null; }
}

function _labelsZeichnen(je) {
  const map = window.map, Lf = window.L;
  if (_labelGruppe) { _labelGruppe.clearLayers(); }
  if (!map || !Lf || !_labelsAn) return;
  if (!_labelGruppe) _labelGruppe = Lf.layerGroup().addTo(map);
  for (const g of (window.gebaeude || [])) {
    const e = je.get(g.id);
    if (!e || e.kwpMax <= 0 || !g.polygonLayer) continue;
    const c = _mitte(g);
    if (!c) continue;
    const a = e.kwp / e.kwpMax;
    _labelGruppe.addLayer(Lf.marker(c, {
      interactive: false, keyboard: false,
      icon: Lf.divIcon({
        className: '', iconSize: null,
        html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font:600 10.5px/1.2 'DM Mono',monospace;
          color:#111;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff;text-align:center;pointer-events:none;">
          ${_fmt(a * 100)} %<br><span style="font-weight:400;font-size:9.5px;">${_fmt(e.kwp)}/${_fmt(e.kwpMax)} kWp</span></div>`,
      }),
    }));
  }
}

function _labelsEntfernen() {
  if (_labelGruppe) { _labelGruppe.remove(); _labelGruppe = null; }
}

export function pvnaLabelsUmschalten() {
  _labelsAn = !_labelsAn;
  if (_labelsAn) _labelsZeichnen(_jeGebaeude()); else _labelsEntfernen();
  _legendeZeigen();
}

export function pvnaMarkiereKarte() {
  if (!window.pvnaKarteAktiv || !_letztes) return;
  const je = _jeGebaeude();
  const info = _letztes.modell.info;
  for (const g of (window.gebaeude || [])) {
    const L = g.polygonLayer;
    if (!L) continue;
    const e = je.get(g.id);
    L.unbindTooltip?.();
    if (!e || e.kwpMax <= 0) {
      L.setStyle({ color: 'rgba(255,255,255,.45)', weight: 1, dashArray: '4 4', fillColor: '#ffffff', fillOpacity: 0.03 });
      continue;
    }
    const anteil = e.kwp / e.kwpMax;
    const farbe = _anteilFarbe(anteil);
    L.setStyle({ color: farbe, weight: 2.2, dashArray: '', fillColor: farbe, fillOpacity: 0.42 });
    const grund = e.begrenzer
      ? `<br>begrenzt durch: ${_ART[e.begrenzer.art] || e.begrenzer.art}`
        + (e.begrenzer.elementId ? ` — ${escHtml(info.elInfo.get(e.begrenzer.elementId)?.label || '')}` : '')
      : '';
    const teil = anteil < 0.999 && e.pZulKw > 0;
    const verlust = e.bErzMwh > 0 ? (e.bErzMwh - e.bMwh) / e.bErzMwh * 100 : 0;
    L.bindTooltip?.(`<b>${escHtml(g.name || 'Gebäude ' + g.id)}</b><br>`
      + `Netzgrenze: ${_fmt(e.pZulKw)} kW Einspeisung<br>`
      + `<span style="color:#66bb6a;">A · weniger ausbauen:</span> ${_fmt(e.kwp)} von ${_fmt(e.kwpMax)} kWp (${_fmt(anteil * 100)} %) → ${_fmt(e.aMwh, 1)} MWh/a`
      + (teil ? `<br><span style="color:#ffb300;">B · voll + abregeln:</span> ${_fmt(e.kwpMax)} kWp → ${_fmt(e.bMwh, 1)} MWh/a nutzbar, ${_fmt(verlust, 1)} % abgeregelt` : '')
      + (e.kwpMit > e.kwp + 0.5 ? `<br>mit Ertüchtigung: ${_fmt(e.kwpMit)} kWp` : '') + grund,
    { sticky: true });
  }
  _labelsZeichnen(je);
}

function _legendeZeigen() {
  let el = document.getElementById(LEGENDE_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LEGENDE_ID;
    el.style.cssText = 'position:fixed;left:50%;bottom:46px;transform:translateX(-50%);z-index:1200;'
      + 'background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;'
      + 'font-size:11px;color:var(--text);box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 32px);';
    document.body.appendChild(el);
  }
  const je = [..._jeGebaeude().values()].filter(e => e.kwpMax > 0);
  const k = window._pvNetzaufnahme || {};
  const stufe = e => ANTEIL_STUFEN.find(st => e.kwp / e.kwpMax >= st.ab);
  el.innerHTML = `<b>PV-Netzaufnahme (Bestand)</b>
    ${ANTEIL_STUFEN.map(st => `<span title="Anteil der Dachfläche ohne Ertüchtigung"><span style="color:${st.farbe};">■</span> ${st.label}: ${je.filter(e => stufe(e) === st).length}</span>`).join('')}
    <span style="color:var(--muted);">${_fmt(k.ohneErtuechtigungKwp)} von ${_fmt(k.potenzialKwp)} kWp</span>
    <label style="display:flex;gap:4px;align-items:center;color:var(--muted);cursor:pointer;">
      <input type="checkbox" ${_labelsAn ? 'checked' : ''} data-change="pvnaLabelsUmschalten()"> Werte</label>
    <button style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;" data-click="pvnaKarteAus()" title="Kartenfärbung beenden">✕</button>`;
}

export function pvnaKarteZeigen() {
  if (!_letztes) _berechnen();
  window.pvnaKarteAktiv = true;
  window.setViewMode?.('karte');
  pvnaMarkiereKarte();
  _legendeZeigen();
  pvnaRender();
}

export function pvnaKarteAus() {
  window.pvnaKarteAktiv = false;
  document.getElementById(LEGENDE_ID)?.remove();
  _labelsEntfernen();
  for (const g of (window.gebaeude || [])) g.polygonLayer?.unbindTooltip?.();
  window.updateViz?.();
  pvnaRender();
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJEKTDATEI
// ══════════════════════════════════════════════════════════════════════════════

/** Aktuelle Eingaben für die Projektdatei — inkl. noch nicht berechneter Feldänderungen. */
export function pvnaEinstellungen() {
  _eingabenLesen();
  return { ..._ein };
}

/**
 * Eingaben aus der Projektdatei übernehmen (null/ältere Projekte = Standard).
 * Das letzte Ergebnis gehört zum vorherigen Projekt und wird verworfen; die
 * Kartenfärbung endet aus demselben Grund.
 */
export function pvnaEinstellungenSetzen(d) {
  const std = _einStandard();
  const q = d?.quelle === 'alle' ? 'alle' : 'aktiv';
  const f = parseFloat(d?.einspFaktor);
  const u = parseFloat(d?.duGrenzePct);
  Object.assign(_ein, std, {
    quelle: q,
    einspFaktor: f > 0 ? f : std.einspFaktor,
    duGrenzePct: u > 0 ? u : std.duGrenzePct,
    bestandAlsVorlast: !!d?.bestandAlsVorlast,
  });
  _letztes = null;
  window._pvNetzaufnahme = null;
  if (window.pvnaKarteAktiv) {
    window.pvnaKarteAktiv = false;
    document.getElementById(LEGENDE_ID)?.remove();
    _labelsEntfernen();
    for (const g of (window.gebaeude || [])) g.polygonLayer?.unbindTooltip?.();
  }
  pvnaRender();
}

window.pvnaRender = pvnaRender;
window.pvnaEinstellungen = pvnaEinstellungen;
window.pvnaEinstellungenSetzen = pvnaEinstellungenSetzen;
window.pvnaRechnen = pvnaRechnen;
window.pvnaFuerVariante = pvnaFuerVariante;
window.pvnaTreppeSvg = pvnaTreppeSvg;
window.pvnaMarkiereKarte = pvnaMarkiereKarte;
window.pvnaLabelsUmschalten = pvnaLabelsUmschalten;
