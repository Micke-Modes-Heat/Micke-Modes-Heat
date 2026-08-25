// ── 14h-engpass-sweep.js — Zeitlicher Engpass-Sweep über Kabel & Betriebsmittel ──
//
// Beantwortet: "Wann wird welches Betriebsmittel zum Engpass?"
//
// Grundidee: Die Lasten je Asset sind statisch — über die Jahre ändert sich nur,
//   (a) welche Assets/Kabel überhaupt existieren (baujahr/abrissjahr) und
//   (b) welche Maßnahmen bereits umgesetzt sind (massnahmen[].newProps).
// Zwischen zwei solchen Ereignissen bleibt das Ergebnis konstant. Deshalb wird
// NICHT jedes Jahr gerechnet, sondern nur die "Stützjahre" (Jahre, in denen sich
// etwas ändert) — exakt, aber typisch 5–10 statt 25 Läufe.
//
// Wichtig: Auto-dimensionierte Kabel wachsen sonst einfach mit der Last mit und
// würden nie einen Engpass zeigen. Für den Sweep wird die Dimensionierung daher
// eingefroren (autoSized = false) und danach wiederhergestellt.
//
// Zwei Schichten:
//   PURE (testbar, kein DOM/State):
//     engpassStuetzjahre, engpassBewerte, engpassKlassifiziere
//   APP-SIDE (liest/schreibt window.stromEdges + ASSETS):
//     engpassSweep, engpassLetztesErgebnis

import { ASSETS, getAssetStatus, TYPE_RANK } from './13a-assets-core.js';
import { elCalcAssets, getStromEdgeStatus, setStromColorMode } from './05b-stromnetz.js';
import { globalYear, massnahmeJahr } from './01-globals-varianten.js';
import { showHint } from './03c-gebaeude-io.js';
import {
  ENGPASS_GRENZEN, ENGPASS_VORLAUF_J, engpassStuetzjahre, engpassBewerte,
  engpassKlassifiziere, engpassKabelAlternativen, engpassWaehleAlternative,
  engpassMassnahmeJahr, engpassDownstreamLeaves, engpassAusloeser,
  engpassIstBestandsmangel,
} from './lib/engpass-core.js';
import { KABEL_TYPEN } from './config/netz-kosten.js';
import { ERT_TRAFO_STUFEN, ertNaechsteTrafoStufe } from './14b-ertuechtigung.js';

// Pure Schicht weiterreichen, damit window.* / Aufrufer nur ein Modul kennen müssen
export {
  ENGPASS_GRENZEN, ENGPASS_VORLAUF_J, engpassStuetzjahre, engpassBewerte,
  engpassKlassifiziere, engpassKabelAlternativen, engpassWaehleAlternative,
  engpassMassnahmeJahr,
};

// ── APP-SIDE ─────────────────────────────────────────────────────────────────

let _letztesErgebnis = null;
/** Ergebnis des letzten Sweeps (oder null). Wird von der Kartenfärbung gelesen. */
export function engpassLetztesErgebnis() { return _letztesErgebnis; }

/**
 * Führt den Jahres-Sweep aus und liefert je Betriebsmittel den Engpass-Zeitpunkt.
 *
 * opts: { von?: number, bis?: number }  — Standard: globalYear … globalYear+25
 *
 * Rückgabe: {
 *   von, bis, jahre: number[],
 *   kabel:  [{ id, label, art:'kabel', msLevel, engpassJahr, ursache, maxAuslPct, maxDuPct, klasse, reihe }],
 *   trafos: [{ id, label, art:'trafo', engpassJahr, ursache, maxAuslPct, klasse, reihe }],
 *   proJahr: [{ jahr, nUeberlast, maxAuslPct }],
 *   dauerMs
 * }
 */
export function engpassSweep(opts = {}) {
  const t0 = performance.now();
  // ACHTUNG: globalYear ist das ANGEZEIGTE Jahr und kann historisch sein —
  // _initYearSliderFromBaujahr() setzt es auf das älteste Gebäude-Baujahr
  // (z. B. 1970). Als Planungsstart taugt es deshalb nicht; geplant wird ab
  // heute bzw. ab dem explizit übergebenen Jahr.
  const heute = new Date().getFullYear();
  const gy    = Number.parseInt(globalYear);
  const start = Number.parseInt(opts.von) || (Number.isFinite(gy) && gy > heute ? gy : heute);
  const bis   = Math.max(start + 1, Number.parseInt(opts.bis) || (start + 25));
  const inklGeplant = !!opts.inklGeplant;

  const edges = window.stromEdges || [];
  if (!edges.length) return null;

  const jahre = engpassStuetzjahre(start, bis, ASSETS.items || [], edges, massnahmeJahr);

  // ── 1. Ist-Dimensionierung als Baseline herstellen und einfrieren ──────────
  // Erst normal rechnen (auto-dimensionierte Kabel bekommen ihren Querschnitt),
  // danach autoSized abschalten, damit die Kabel im Sweep NICHT mitwachsen.
  elCalcAssets({ year: start, silent: true, inklGeplant });

  const snapshot = edges.map(e => ({
    e,
    autoSized:     e.autoSized,
    crossSection:  e.crossSection,
    nParallel:     e.nParallel,
    fuseA:         e.fuseA,
    ratedCurrentA: e.ratedCurrentA,
    auslastungPct: e.auslastungPct,
    deltaUPct:     e.deltaUPct,
    peakFlowKw:    e.peakFlowKw,
    peakCurrentA:  e.peakCurrentA,
    flowDirection: e.flowDirection,
  }));
  edges.forEach(e => { e.autoSized = false; });

  // ── 2. Sweep über die Stützjahre ──────────────────────────────────────────
  const reihenKabel = new Map(); // edgeId → [{jahr, auslastungPct, deltaUKumPct}]
  const reihenTrafo = new Map(); // assetId → [{jahr, auslastungPct}]
  const proJahr     = [];

  try {
    for (const jahr of jahre) {
      elCalcAssets({ year: jahr, silent: true, inklGeplant });

      // Kumulierten Spannungsfall je Knoten abgreifen (schreibt elCalcAssets
      // auf window.stromNodes) — für Kabel zählt das Maximum der Endpunkte.
      const duKum = new Map();
      for (const n of (window.stromNodes || [])) {
        if (n._deltaUKumPct != null) duKum.set(n.id, Math.abs(n._deltaUKumPct));
      }

      let nUeberlast = 0, maxAusl = 0;

      for (const e of edges) {
        if (getStromEdgeStatus(e, jahr) !== 'active') continue;
        const ausl = e.auslastungPct || 0;
        const du   = Math.max(duKum.get(e.u) || 0, duKum.get(e.v) || 0);
        if (!reihenKabel.has(e.id)) reihenKabel.set(e.id, []);
        reihenKabel.get(e.id).push({
          jahr, auslastungPct: ausl, deltaUKumPct: du, peakCurrentA: e.peakCurrentA || 0,
        });
        if (ausl > ENGPASS_GRENZEN.auslastungPct || du > ENGPASS_GRENZEN.deltaUKumPct) nUeberlast++;
        if (ausl > maxAusl) maxAusl = ausl;
      }

      for (const a of (ASSETS.items || [])) {
        if (a.type !== 'Trafo' || getAssetStatus(a, jahr) !== 'active') continue;
        const pct = a._calcPeakLoadPct || 0;
        if (!reihenTrafo.has(a.id)) reihenTrafo.set(a.id, []);
        reihenTrafo.get(a.id).push({ jahr, auslastungPct: pct, deltaUKumPct: 0 });
        if (pct > ENGPASS_GRENZEN.trafoPct) nUeberlast++;
      }

      proJahr.push({ jahr, nUeberlast, maxAuslPct: maxAusl });
    }
  } finally {
    // ── 3. Zustand vollständig wiederherstellen ─────────────────────────────
    for (const s of snapshot) Object.assign(s.e, {
      autoSized:     s.autoSized,
      crossSection:  s.crossSection,
      nParallel:     s.nParallel,
      fuseA:         s.fuseA,
      ratedCurrentA: s.ratedCurrentA,
      auslastungPct: s.auslastungPct,
      deltaUPct:     s.deltaUPct,
      peakFlowKw:    s.peakFlowKw,
      peakCurrentA:  s.peakCurrentA,
      flowDirection: s.flowDirection,
    });
    elCalcAssets(); // Live-Zustand für das tatsächlich eingestellte Jahr
  }

  // ── 4. Auswerten ──────────────────────────────────────────────────────────
  const nameOf = id => (ASSETS.items || []).find(a => a.id === id)?.name || id;

  const kabel = [...reihenKabel.entries()].map(([id, reihe]) => {
    const e = edges.find(x => x.id === id);
    const b = engpassBewerte(reihe);
    return {
      id, art: 'kabel', msLevel: !!e?.msLevel, stationsintern: !!e?.stationsintern,
      label: `${nameOf(e?.u)} → ${nameOf(e?.v)}`,
      ...b, klasse: engpassKlassifiziere(b.engpassJahr, start), reihe,
      // Für den Maßnahmen-Generator: Ist-Zustand + höchster Strom im Horizont
      maxStromA: Math.max(0, ...reihe.map(r => r.peakCurrentA || 0)),
      ist: {
        crossSection: e?.crossSection, nParallel: e?.nParallel || 1,
        cableType: e?.cableType, lengthM: e?.lengthM || 0,
      },
    };
  });

  const trafos = [...reihenTrafo.entries()].map(([id, reihe]) => {
    const a = (ASSETS.items || []).find(x => x.id === id);
    const b = engpassBewerte(reihe);
    return {
      id, art: 'trafo', label: nameOf(id),
      ...b, klasse: engpassKlassifiziere(b.engpassJahr, start), reihe,
      ist: { leistungKVA: parseFloat(a?.props?.leistungKVA) || 630 },
    };
  });

  const sortiert = arr => arr.sort((a, b) =>
    (a.engpassJahr ?? Infinity) - (b.engpassJahr ?? Infinity) || b.maxAuslPct - a.maxAuslPct);

  const ergebnis = {
    von: start, bis, jahre, inklGeplant,
    kabel:  sortiert(kabel),
    trafos: sortiert(trafos),
    proJahr,
    // Schneller Zugriff für die Kartenfärbung (Farbmodus „Engpassjahr")
    index: new Map([...kabel, ...trafos].map(x => [x.id, x])),
    dauerMs: Math.round(performance.now() - t0),
  };
  // Nur den Ist-Lauf als Kartengrundlage merken — der Was-wäre-wenn-Lauf
  // (inklGeplant) darf die Engpassjahr-Färbung nicht überschreiben.
  if (!inklGeplant) _letztesErgebnis = ergebnis;
  return ergebnis;
}

// ── Auslöser & Zusammenhänge ─────────────────────────────────────────────────
//
// Beantwortet: "WARUM wird dieses Betriebsmittel zum Engpass — welcher neue
// Verbraucher/Erzeuger hat das ausgelöst, und welche anderen Engpässe hängen
// an derselben Ursache?" Graph-Logik liegt PURE in lib/engpass-core.js
// (engpassDownstreamLeaves/engpassAusloeser); hier nur das Verdrahten mit
// ASSETS.items / window.stromEdges / window.gebaeude, analog zu engpassSweep.

function _leavesFuer(item) {
  return engpassDownstreamLeaves(item, ASSETS.items || [], window.stromEdges || [], window.gebaeude || [], TYPE_RANK);
}

/** Auslöser eines Engpasses — siehe engpassAusloeser (lib/engpass-core.js) für die Regel. */
export function engpassAusloeserFuer(item) {
  return engpassAusloeser(item, _leavesFuer(item), massnahmeJahr);
}

/** Andere kritische Betriebsmittel, die denselben Auslöser haben (gleicher Verbraucher/Erzeuger stromabwärts). */
export function engpassZusammenhaengende(item, alleKritisch) {
  const eigene = new Set(engpassAusloeserFuer(item).map(t => `${t.kind}_${t.id}`));
  if (!eigene.size) return [];
  return (alleKritisch || []).filter(other => other !== item && other.engpassJahr != null
    && engpassAusloeserFuer(other).some(t => eigene.has(`${t.kind}_${t.id}`)));
}

/**
 * Gruppiert alle kritischen Betriebsmittel nach ihrem Auslöser (Verbraucher/
 * Erzeuger-Zubau) und hängt — falls vorhanden — die daraus abgeleitete
 * Ausbau-Maßnahme (aus engpassGeneriereMassnahmen) je Betriebsmittel an.
 *
 * Rückgabe: {
 *   gruppen: [{ trigger, jahr, betroffene: [{ item, massnahme|null }] }],
 *   ohneAusloeser: [item, ...],   // später kritisch, aber ohne eindeutiges Einzelereignis
 *   bestandsmaengel: [item, ...]  // schon im Startjahr kritisch → Datenkorrektur
 * }
 */
export function engpassAufloesung(res, massnahmenItems) {
  if (!res) return { gruppen: [], ohneAusloeser: [], bestandsmaengel: [] };
  const kritisch = [...res.kabel, ...res.trafos].filter(x => x.engpassJahr != null);
  const massnByItemId = new Map((massnahmenItems || []).map(m => [m.id.replace(/^auto_/, ''), m]));

  const gruppen = new Map(); // key → { trigger, betroffene: [{item, massnahme}] }
  const ohneAusloeser = [];
  const bestandsmaengel = [];
  for (const it of kritisch) {
    const ausl = engpassAusloeserFuer(it);
    if (!ausl.length) {
      // Bestandsmängel gehören in ihre eigene Kategorie — sie hier als
      // "Ursache unklar" mitzuzählen würde den echten Rest verwässern.
      (engpassIstBestandsmangel(it, res.von, ausl) ? bestandsmaengel : ohneAusloeser).push(it);
      continue;
    }
    for (const t of ausl) {
      const key = `${t.kind}_${t.id}`;
      if (!gruppen.has(key)) gruppen.set(key, { trigger: t, betroffene: [] });
      const g = gruppen.get(key);
      if (!g.betroffene.some(b => b.item === it)) g.betroffene.push({ item: it, massnahme: massnByItemId.get(it.id) || null });
    }
  }

  const ergebnis = [...gruppen.values()].map(g => ({
    ...g,
    jahr: Math.min(...g.betroffene.map(b => b.item.engpassJahr)),
  })).sort((a, b) => a.jahr - b.jahr);

  return { gruppen: ergebnis, ohneAusloeser };
}

// ── Bedienung: Analyse starten + Karte umschalten ────────────────────────────

const _KLASSE_META = {
  akut:   { col: '#b71c1c', label: 'jetzt' },
  kurz:   { col: '#e53935', label: '< 5 J' },
  mittel: { col: '#fb8c00', label: '5–15 J' },
  lang:   { col: '#fdd835', label: '> 15 J' },
  keiner: { col: '#4caf50', label: 'kein Engpass' },
};

/**
 * Startet den Sweep, schaltet die Karte auf den Farbmodus „Engpassjahr" und
 * schreibt eine Kurzauswertung in die Legende unter der Darstellungs-Sektion.
 */
export function engpassAnalyseStarten() {
  showHint('⏱ Engpass-Analyse läuft — Netz wird über die Stützjahre gerechnet …');
  // setTimeout, damit der Hint vor der blockierenden Rechnung gerendert wird
  setTimeout(() => {
    let res = null;
    try {
      res = engpassSweep();
    } catch (err) {
      console.error('Engpass-Analyse fehlgeschlagen:', err);
      showHint('⚠ Engpass-Analyse fehlgeschlagen — Details in der Konsole.');
      return;
    }
    if (!res) { showHint('⚠ Engpass-Analyse: keine Kabel vorhanden.'); return; }

    setStromColorMode('engpassjahr');
    _renderLegende(res);

    const kritisch = [...res.kabel, ...res.trafos].filter(x => x.engpassJahr != null);
    if (!kritisch.length) {
      showHint(`✓ Engpass-Analyse (${res.von}–${res.bis}): keine Engpässe im Horizont.`);
    } else {
      const erst = Math.min(...kritisch.map(x => x.engpassJahr));
      showHint(`⚠ Engpass-Analyse: ${kritisch.length} Betriebsmittel kritisch — erster Engpass ${erst}.`);
    }
    setTimeout(() => { if (typeof window.hideHint === 'function') window.hideHint(); }, 5000);
  }, 50);
}

function _renderLegende(res) {
  const el = document.getElementById('lp-engpass-legende');
  if (!el) return;
  const zaehl = k => [...res.kabel, ...res.trafos].filter(x => x.klasse === k).length;
  const chips = ['akut', 'kurz', 'mittel', 'lang', 'keiner'].map(k => {
    const m = _KLASSE_META[k];
    return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:7px;white-space:nowrap;">
      <span style="width:8px;height:8px;border-radius:2px;background:${m.col};"></span>${m.label}: <b>${zaehl(k)}</b></span>`;
  }).join('');
  el.innerHTML = `
    <div style="font-size:9px;color:var(--muted);margin-bottom:3px;">
      Engpass-Zeitpunkt ${res.von}–${res.bis} · ${res.jahre.length} Stützjahre · ${res.dauerMs} ms
    </div>
    <div style="font-size:9px;line-height:1.7;">${chips}</div>`;
  el.style.display = '';
}

// ── Maßnahmen automatisch vorschlagen ────────────────────────────────────────

// Kennzeichen für automatisch erzeugte Maßnahmen — erlaubt sauberes Ersetzen
// beim erneuten Lauf (statt Duplikate anzuhäufen).
const AUTO_TAG = '_autoEngpass';

/** Entfernt alle zuvor automatisch erzeugten Engpass-Maßnahmen. */
export function engpassMassnahmenVerwerfen() {
  let n = 0;
  const putze = o => {
    if (!o.massnahmen?.length) return;
    const vorher = o.massnahmen.length;
    o.massnahmen = o.massnahmen.filter(m => !m[AUTO_TAG]);
    n += vorher - o.massnahmen.length;
  };
  (window.stromEdges || []).forEach(putze);
  (ASSETS.items || []).forEach(putze);
  return n;
}

// Dimensionierungs-Parameter für die Kabelwahl. Alle bekannten Kabeltypen
// übergeben — dimensioniert wird primär im Typ des Bestandskabels, die übrigen
// erscheinen als Materialalternative.
function _kabelParams() {
  return {
    typen:      KABEL_TYPEN,
    tiefbauEurM: parseFloat(document.getElementById('strom-k-tiefbau')?.value) || 100,
    grenzDuPct: ENGPASS_GRENZEN.deltaUKumPct,
  };
}

// Nächstgrößere Trafostufe für ein überlastetes Trafo-Item (oder null).
function _trafoStufe(t) {
  const istKva      = t.ist?.leistungKVA || 630;
  const benoetigtKw = istKva * 0.9 * (t.maxAuslPct / 100); // Auslastung war auf kVA·cosφ bezogen
  const stufe       = ertNaechsteTrafoStufe(benoetigtKw, ERT_TRAFO_STUFEN);
  if (!stufe || stufe.bisKvA <= istKva) return null;
  return {
    istKva, stufe,
    label: `Trafo ${istKva} → ${stufe.bisKvA < Infinity ? stufe.bisKvA + ' kVA' : 'Übergabestation'}`,
  };
}

/**
 * Leitet aus dem letzten Sweep konkrete Ertüchtigungs-Maßnahmen ab und schreibt
 * sie als `massnahmen` (status 'geplant') auf Kabel bzw. Trafo-Assets.
 * Dadurch erscheinen sie automatisch im Ausbauplaner-Gantt und im Investitionsplan.
 *
 * Dimensioniert auf das Maximum des GESAMTEN Horizonts (nicht nur auf das erste
 * Engpassjahr), damit nicht zweimal gebaut werden muss.
 *
 * opts.ohneBestandsmaengel: Betriebsmittel, die schon im Startjahr ohne Auslöser
 *   überlastet sind, übergehen — die sind kein Ausbaubedarf, sondern eine zu
 *   korrigierende Bestandsdimensionierung (s. engpassBestandsmaengel).
 */
export function engpassGeneriereMassnahmen(opts = {}) {
  const res = opts.ergebnis || _letztesErgebnis;
  if (!res) return null;

  const vorlaufJ = opts.vorlaufJ ?? ENGPASS_VORLAUF_J;
  const params   = _kabelParams();
  const uebergehen = opts.ohneBestandsmaengel
    ? new Set(engpassBestandsmaengel(res).map(b => b.item.id))
    : null;

  engpassMassnahmenVerwerfen();
  const items = [];
  // Engpässe, die sich mit keiner Standard-Ertüchtigung auflösen lassen.
  // Die dürfen NICHT stillschweigend entfallen — sonst wirkt der Fahrplan
  // vollständig, obwohl der Engpass bestehen bleibt.
  const ungeloest = [];

  // ── Kabel ────────────────────────────────────────────────────────────────
  for (const k of res.kabel) {
    if (k.engpassJahr == null || k.msLevel) continue; // MS-Kabel: eigene Systematik
    if (k.stationsintern) continue; // auf Trafo-Nennleistung ausgelegt, nie Engpass
    if (uebergehen?.has(k.id)) continue;
    const edge = (window.stromEdges || []).find(e => e.id === k.id);
    if (!edge) continue;

    const alternativen = engpassKabelAlternativen(
      k.ist, { benoetigtA: k.maxStromA, maxDuPct: k.maxDuPct }, params);
    const wahl = engpassWaehleAlternative(alternativen);
    if (!wahl) {
      // Kein Standardkabel (auch nicht 8 Parallelstränge) trägt den Strom bzw.
      // hält den Spannungsfall — hier hilft nur eine Strukturänderung.
      ungeloest.push({
        id: k.id, art: 'kabel', label: k.label, engpassJahr: k.engpassJahr,
        maxStromA: k.maxStromA, maxAuslPct: k.maxAuslPct,
        grund: 'Kein Standardquerschnitt reicht — Netzstruktur ändern '
             + '(Trafo/NSHV näher an die Last, Strang aufteilen oder MS-Anbindung).',
      });
      continue;
    }

    const jahr = engpassMassnahmeJahr(k.engpassJahr, res.von, vorlaufJ);
    const m = {
      id: `auto_${k.id}`, [AUTO_TAG]: true,
      titel: wahl.label, typ: wahl.typ, jahr, kosten: wahl.investEUR,
      status: 'geplant', newProps: wahl.newProps, dependsOn: [], phaseId: null,
    };
    if (!edge.massnahmen) edge.massnahmen = [];
    edge.massnahmen.push(m);
    items.push({ ...m, art: 'kabel', label: k.label, engpassJahr: k.engpassJahr, alternativen });
  }

  // ── Trafos (Stufen aus 14b-ertuechtigung) ────────────────────────────────
  for (const t of res.trafos) {
    if (t.engpassJahr == null) continue;
    if (uebergehen?.has(t.id)) continue;
    const asset = (ASSETS.items || []).find(a => a.id === t.id);
    if (!asset) continue;

    const kand = _trafoStufe(t);
    if (!kand) continue;
    const { stufe, label } = kand;

    const jahr = engpassMassnahmeJahr(t.engpassJahr, res.von, vorlaufJ);
    const m = {
      id: `auto_${t.id}`, [AUTO_TAG]: true,
      titel: label, typ: 'Ertuechtigung', jahr, kosten: stufe.investEUR,
      status: 'geplant', newProps: { leistungKVA: stufe.bisKvA },
      dependsOn: [], phaseId: null,
    };
    if (!asset.massnahmen) asset.massnahmen = [];
    asset.massnahmen.push(m);
    items.push({ ...m, art: 'trafo', label: t.label, engpassJahr: t.engpassJahr });
  }

  items.sort((a, b) => (a.jahr ?? 0) - (b.jahr ?? 0));
  ungeloest.sort((a, b) => (a.engpassJahr ?? 0) - (b.engpassJahr ?? 0));
  return { items, ungeloest, investGesamt: items.reduce((s, i) => s + (i.kosten || 0), 0) };
}

// ── Bestandsmängel: von vornherein zu klein dimensioniert ────────────────────
//
// Abgrenzung siehe engpassIstBestandsmangel (lib/engpass-core.js): schon im
// Startjahr überlastet UND kein Zubau in diesem Jahr als Auslöser. Das ist kein
// Ausbaubedarf, sondern eine falsch erfasste Bestandsdimensionierung — deshalb
// wird sie als Korrektur der Basisdaten angeboten, nicht als geplante Maßnahme.

// Sicherungskopie der Originalwerte, damit eine Korrektur rücknehmbar bleibt
// (gleiche Idee wie _fpOrigBaujahr im Ausbaufahrplan).
const KORR_ORIG = '_engpassKorrOrig';

/**
 * Alle Bestandsmängel des letzten Sweeps mit Korrekturvorschlag.
 *
 * Rückgabe: [{ item, vorschlag }] — vorschlag ist null, wenn keine
 * Standard-Ertüchtigung ausreicht (dann hilft nur eine Strukturänderung).
 * vorschlag: { label, newProps, investEUR, art }
 */
export function engpassBestandsmaengel(res) {
  const r = res || _letztesErgebnis;
  if (!r) return [];
  const params = _kabelParams();
  const out = [];

  for (const k of r.kabel) {
    if (k.msLevel) continue; // MS-Kabel: eigene Systematik
    if (k.stationsintern) continue; // auf Trafo-Nennleistung ausgelegt, nie Engpass
    if (!engpassIstBestandsmangel(k, r.von, engpassAusloeserFuer(k))) continue;
    const wahl = engpassWaehleAlternative(engpassKabelAlternativen(
      k.ist, { benoetigtA: k.maxStromA, maxDuPct: k.maxDuPct }, params));
    out.push({
      item: k,
      vorschlag: wahl ? { art: 'kabel', label: wahl.label, newProps: wahl.newProps, investEUR: wahl.investEUR } : null,
    });
  }

  for (const t of r.trafos) {
    if (!engpassIstBestandsmangel(t, r.von, engpassAusloeserFuer(t))) continue;
    const kand = _trafoStufe(t);
    out.push({
      item: t,
      vorschlag: kand
        ? { art: 'trafo', label: kand.label, newProps: { leistungKVA: kand.stufe.bisKvA }, investEUR: kand.stufe.investEUR }
        : null,
    });
  }

  return out.sort((a, b) => b.item.maxAuslPct - a.item.maxAuslPct);
}

/**
 * Übernimmt die Korrekturvorschläge direkt in die Bestandsdaten — also in
 * `crossSection`/`nParallel`/`cableType` der Kante bzw. `props.leistungKVA` des
 * Trafos, NICHT als Maßnahme mit Jahr und Investition.
 *
 * Bei Kabeln wird dabei `autoSized` abgeschaltet: der korrigierte Querschnitt
 * ist eine bewusste Festlegung und soll nicht bei der nächsten Berechnung
 * wieder überschrieben werden.
 *
 * nurIds: optionales Set/Array von Betriebsmittel-IDs (Default: alle).
 * Gibt die Anzahl übernommener Korrekturen zurück.
 */
export function engpassKorrekturenUebernehmen(nurIds) {
  const filter = nurIds ? new Set(nurIds) : null;
  let n = 0;

  for (const { item, vorschlag } of engpassBestandsmaengel()) {
    if (!vorschlag) continue;                       // nicht lösbar → unangetastet lassen
    if (filter && !filter.has(item.id)) continue;

    if (vorschlag.art === 'kabel') {
      const edge = (window.stromEdges || []).find(e => e.id === item.id);
      if (!edge) continue;
      if (!edge[KORR_ORIG]) edge[KORR_ORIG] = {
        crossSection: edge.crossSection, nParallel: edge.nParallel,
        cableType:    edge.cableType,    autoSized: edge.autoSized,
      };
      Object.assign(edge, vorschlag.newProps);
      edge.autoSized = false;
    } else {
      const asset = (ASSETS.items || []).find(a => a.id === item.id);
      if (!asset) continue;
      if (!asset[KORR_ORIG]) asset[KORR_ORIG] = { ...(asset.props || {}) };
      asset.props = { ...(asset.props || {}), ...vorschlag.newProps };
    }
    n++;
  }

  if (n) elCalcAssets();  // Live-Zustand mit den korrigierten Daten neu rechnen
  return n;
}

/** Nimmt alle übernommenen Bestandskorrekturen wieder zurück. */
export function engpassKorrekturenVerwerfen() {
  let n = 0;
  for (const edge of (window.stromEdges || [])) {
    if (!edge[KORR_ORIG]) continue;
    Object.assign(edge, edge[KORR_ORIG]);
    delete edge[KORR_ORIG];
    n++;
  }
  for (const asset of (ASSETS.items || [])) {
    if (!asset[KORR_ORIG]) continue;
    asset.props = asset[KORR_ORIG];
    delete asset[KORR_ORIG];
    n++;
  }
  if (n) elCalcAssets();
  return n;
}

/**
 * Wirksamkeitsnachweis: Sweep einmal ohne und einmal MIT den geplanten Maßnahmen.
 * Gibt beide Verläufe (Überlast-Anzahl je Jahr) für die Reserve-Kurve zurück.
 */
export function engpassVergleich(opts = {}) {
  const ohne = engpassSweep(opts);
  if (!ohne) return null;
  const mit  = engpassSweep({ ...opts, inklGeplant: true });
  // Beide Läufe auf eine gemeinsame Jahresachse bringen
  const jahre = [...new Set([...ohne.jahre, ...mit.jahre])].sort((a, b) => a - b);
  const holen = (r, j) => {
    const treffer = r.proJahr.filter(p => p.jahr <= j).pop();
    return treffer ? treffer.nUeberlast : 0;
  };
  return {
    jahre,
    ohne: jahre.map(j => holen(ohne, j)),
    mit:  jahre.map(j => holen(mit,  j)),
    restEngpaesse: [...mit.kabel, ...mit.trafos].filter(x => x.engpassJahr != null).length,
  };
}
