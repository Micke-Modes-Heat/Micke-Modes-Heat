// ── lib/pv-netzaufnahme-core.js — PV-Aufnahmefähigkeit des Bestandsnetzes ────
//
// Beantwortet zwei Fragen:
//   A) Wie viel der PV-Flächen lässt sich anschließen, OHNE ein Kabel oder einen
//      Trafo zu ertüchtigen?
//   B) Welche Ertüchtigungen erschließen den Rest — in welcher Reihenfolge, zu
//      welchen Kosten je zusätzlich angeschlossenem kWp?
//
// Modell (radiales Netz, Lastfall „volle Einspeisung ohne gleichzeitige Last"):
//   • Elemente = Trafos und Kabel. Jedes Element kennt sein Elternelement in
//     Richtung Trafo. Die Einspeisung eines Dachs fließt über alle Elemente
//     seines Pfades.
//   • Stromgrenze: Fluss_e ≤ kapKw_e (Trafo: kVA·PF, Kabel: Iz_eff·√3·U·cosφ).
//   • Spannungsgrenze: an jedem Prüfpunkt Σ_{e∈Pfad} duProKwPct_e·Fluss_e ≤ duGrenzePct.
//     ΔU ist linear im Fluss — damit sind alle Grenzen lineare Ungleichungen mit
//     nicht-negativen Koeffizienten, und eine gierige Befüllung bleibt stets zulässig.
//   • Befüllung „beste Erträge zuerst": Dächer absteigend nach Ertragsfaktor;
//     jedes Dach bekommt so viel, wie die engste Grenze auf seinem Pfad zulässt
//     (Teilbelegung erlaubt). Die bindende Grenze wird als Begrenzer gemerkt.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar. Die app-seitige
// Modellbildung (Topologie, Kabeldaten, Kosten) liegt in 28-pv-netzaufnahme.js.

const EPS = 1e-9;

/**
 * Prüfpunkte auf die Strangenden reduzieren. Da alle ΔU-Koeffizienten und
 * Einspeiseflüsse ≥ 0 sind, steigt die Spannung vom Trafo zum Strangende
 * monoton an — ein Knoten mitten im Strang kann die Grenze nie vor dem Ende
 * seines Strangs reißen. Je Element bleibt ein Prüfpunkt.
 */
function _endPruefpunkte(pp, elemente) {
  const eltern = new Set();
  for (const e of elemente.values()) if (e.parentId != null) eltern.add(e.parentId);
  const seen = new Set();
  return pp.filter(p => {
    if (!elemente.has(p.elementId) || eltern.has(p.elementId) || seen.has(p.elementId)) return false;
    seen.add(p.elementId);
    return true;
  });
}

/**
 * Pfad (Liste von Element-IDs, vom Anschlusselement bis zum Trafo) je Element.
 * elemente: Map<id, { parentId }>
 */
function _pfadVon(startId, elemente) {
  const pfad = [];
  const gesehen = new Set();
  let cur = startId;
  while (cur != null && elemente.has(cur) && !gesehen.has(cur)) {
    gesehen.add(cur);
    pfad.push(cur);
    cur = elemente.get(cur).parentId;
  }
  return pfad;
}

function _elementMap(elemente) {
  const m = new Map();
  for (const e of elemente || []) m.set(e.id, { ...e });
  return m;
}

/**
 * Gierige Befüllung des Netzes mit PV.
 *
 * eingabe = {
 *   elemente:   [{ id, typ:'trafo'|'kabel', parentId, kapKw, duProKwPct, vorlastKw }]
 *                 kapKw: Infinity/null = keine Stromgrenze (z. B. stationsintern)
 *                 vorlastKw: bereits vorhandene Einspeisung, die über dieses Element
 *                            fließt (Wind, KWK …) — belegt Kapazität vorab
 *   daecher:    [{ id, elementId, kwpMax, ertragFaktor, einspFaktor }]
 *                 elementId: erstes Element des Pfades (Anschlusskabel oder Trafo)
 *                 einspFaktor: kW Einspeisung je kWp (Default 0,8 wie elCalcAssets)
 *   pruefpunkte: [{ id, elementId }] — zusätzliche Knoten mit Spannungsgrenze
 *                 (Dächer sind automatisch Prüfpunkte)
 *   duGrenzePct: zulässige Spannungsanhebung (Default 3 %)
 * }
 *
 * Rückgabe: {
 *   daecher: [{ id, kwp, kwpMax, anteil, begrenzer:{ elementId, art }|null }],
 *   elemente: [{ id, flussKw, kapKw, auslastungPct }],
 *   pruefpunkte: [{ id, duPct }],
 *   summeKwp, potenzialKwp,
 * }
 * art: 'strom' | 'trafo' | 'spannung' | 'vorbelastet'
 */
export function pvnaFuellen(eingabe) {
  const { daecher = [], pruefpunkte = [], duGrenzePct = 3 } = eingabe || {};
  const el = _elementMap(eingabe?.elemente);

  // Pfade vorberechnen
  const pfade = new Map();
  const pfad = id => {
    if (!pfade.has(id)) pfade.set(id, _pfadVon(id, el));
    return pfade.get(id);
  };

  // Startflüsse aus der Vorlast (fließt jeweils bis zum Trafo hinauf)
  const fluss = new Map([...el.keys()].map(id => [id, 0]));
  for (const [id, e] of el) {
    const v = +e.vorlastKw || 0;
    if (v <= 0) continue;
    for (const pid of pfad(id)) fluss.set(pid, fluss.get(pid) + v);
  }

  // Prüfpunkte: alle Dächer + explizite
  const pp = _endPruefpunkte([
    ...daecher.map(d => ({ id: 'dach:' + d.id, elementId: d.elementId })),
    ...pruefpunkte,
  ], el);
  const ppPfad = pp.map(p => new Set(pfad(p.elementId)));
  const du = (i) => {
    let s = 0;
    for (const eid of ppPfad[i]) s += (+el.get(eid).duProKwPct || 0) * fluss.get(eid);
    return s;
  };
  const duIst = pp.map((_, i) => du(i));

  const reihenfolge = [...daecher].sort((a, b) =>
    (b.ertragFaktor ?? 1) - (a.ertragFaktor ?? 1) || String(a.id).localeCompare(String(b.id)));

  const ergebnis = new Map();
  for (const d of reihenfolge) {
    const kwpMax = Math.max(0, +d.kwpMax || 0);
    const f = d.einspFaktor > 0 ? d.einspFaktor : 0.8;
    if (!el.has(d.elementId) || kwpMax <= 0) {
      ergebnis.set(d.id, { id: d.id, kwp: 0, kwpMax, anteil: 0,
        begrenzer: el.has(d.elementId) ? null : { elementId: null, art: 'nicht-angebunden' } });
      continue;
    }
    const p = pfad(d.elementId);
    let xMax = kwpMax, begrenzer = null;

    // 1. Stromgrenzen entlang des Pfades
    for (const eid of p) {
      const e = el.get(eid);
      const kap = e.kapKw == null ? Infinity : +e.kapKw;
      if (!Number.isFinite(kap)) continue;
      const rest = kap - fluss.get(eid);
      const x = rest <= EPS ? 0 : rest / f;
      if (x < xMax - EPS) {
        xMax = x;
        begrenzer = { elementId: eid, art: rest <= EPS && (+e.vorlastKw > 0) ? 'vorbelastet'
          : (e.typ === 'trafo' ? 'trafo' : 'strom') };
      }
    }

    // 2. Spannungsgrenzen an allen Prüfpunkten, deren Pfad mit diesem Dach
    //    gemeinsame Elemente hat: ΔU_i steigt um f·x·Σ_{gemeinsam} duProKw.
    const pSet = new Set(p);
    for (let i = 0; i < pp.length; i++) {
      let koeff = 0, knapp = null, knappK = -1;
      for (const eid of ppPfad[i]) {
        if (!pSet.has(eid)) continue;
        const k = +el.get(eid).duProKwPct || 0;
        koeff += k;
        if (k > knappK) { knappK = k; knapp = eid; }
      }
      if (koeff <= EPS) continue;
      const rest = duGrenzePct - duIst[i];
      const x = rest <= EPS ? 0 : rest / (f * koeff);
      if (x < xMax - EPS) {
        xMax = x;
        begrenzer = { elementId: knapp, art: 'spannung', pruefpunkt: pp[i].id };
      }
    }

    xMax = Math.max(0, xMax);
    if (xMax > EPS) {
      for (const eid of p) fluss.set(eid, fluss.get(eid) + f * xMax);
      for (let i = 0; i < pp.length; i++) {
        let koeff = 0;
        for (const eid of ppPfad[i]) if (pSet.has(eid)) koeff += +el.get(eid).duProKwPct || 0;
        duIst[i] += f * xMax * koeff;
      }
    }
    const voll = xMax >= kwpMax - 1e-6;
    ergebnis.set(d.id, {
      id: d.id, kwp: voll ? kwpMax : xMax, kwpMax,
      anteil: kwpMax > 0 ? (voll ? 1 : xMax / kwpMax) : 0,
      begrenzer: voll ? null : begrenzer,
    });
  }

  const daecherOut = daecher.map(d => ergebnis.get(d.id));
  return {
    daecher: daecherOut,
    elemente: [...el.values()].map(e => {
      const kap = e.kapKw == null ? Infinity : +e.kapKw;
      return { id: e.id, flussKw: fluss.get(e.id), kapKw: kap,
        auslastungPct: Number.isFinite(kap) && kap > 0 ? fluss.get(e.id) / kap * 100 : 0 };
    }),
    pruefpunkte: pp.map((p, i) => ({ id: p.id, duPct: duIst[i] })),
    summeKwp: daecherOut.reduce((s, d) => s + d.kwp, 0),
    potenzialKwp: daecherOut.reduce((s, d) => s + d.kwpMax, 0),
  };
}

/**
 * Flüsse und Spannungen, wenn ALLE Dächer voll belegt sind — ohne Grenzen.
 * Zeigt, welche Elemente beim Vollausbau überlastet wären (Grundlage für Stufe B).
 * Rückgabe: { flussKw: Map<id,kW>, duPct: Map<pruefpunktId,%> , ueberlastet:[id], spannungsverletzt:[pruefpunktId] }
 */
export function pvnaVollausbau(eingabe) {
  const { daecher = [], pruefpunkte = [], duGrenzePct = 3 } = eingabe || {};
  const el = _elementMap(eingabe?.elemente);
  const fluss = new Map([...el.keys()].map(id => [id, 0]));
  const add = (startId, kw) => {
    for (const pid of _pfadVon(startId, el)) fluss.set(pid, fluss.get(pid) + kw);
  };
  for (const [id, e] of el) if (+e.vorlastKw > 0) add(id, +e.vorlastKw);
  for (const d of daecher) {
    if (!el.has(d.elementId)) continue;
    add(d.elementId, (d.einspFaktor > 0 ? d.einspFaktor : 0.8) * Math.max(0, +d.kwpMax || 0));
  }
  const pp = [
    ...daecher.map(d => ({ id: 'dach:' + d.id, elementId: d.elementId })),
    ...pruefpunkte,
  ].filter(p => el.has(p.elementId));
  const duPct = new Map();
  for (const p of pp) {
    let s = 0;
    for (const eid of _pfadVon(p.elementId, el)) s += (+el.get(eid).duProKwPct || 0) * fluss.get(eid);
    duPct.set(p.id, s);
  }
  const ueberlastet = [...el.values()]
    .filter(e => e.kapKw != null && Number.isFinite(+e.kapKw) && fluss.get(e.id) > +e.kapKw + EPS)
    .map(e => e.id);
  const spannungsverletzt = pp.filter(p => duPct.get(p.id) > duGrenzePct + EPS).map(p => p.id);
  return { flussKw: fluss, duPct, ueberlastet, spannungsverletzt };
}

/**
 * Ausbautreppe: Welche Ertüchtigung erschließt am meisten kWp je Euro?
 *
 * eingabe: wie pvnaFuellen, zusätzlich je Element optional
 *   massnahme: { label, investEUR, kapKw, duProKwPct }  — Zustand NACH Ertüchtigung
 *
 * Vorgehen (gierig): In jedem Schritt wird jede noch offene Maßnahme probeweise
 * umgesetzt — zusammen mit allen offenen Maßnahmen, die auf ihrem Weg zum Trafo
 * liegen (ein neues Hausanschlusskabel nützt nichts, solange der Trafo davor voll
 * ist). Gewählt wird das Bündel mit dem größten kWp-Zuwachs je Euro. Das endet,
 * wenn keine Maßnahme mehr Zuwachs bringt.
 *
 * Rückgabe: {
 *   basis: pvnaFuellen-Ergebnis ohne Maßnahmen,
 *   schritte: [{ massnahmen:[{elementId,label,investEUR}], investEUR, zuwachsKwp,
 *                summeKwp, kumInvestEUR, eurProKwp }],
 *   ende: pvnaFuellen-Ergebnis nach allen Schritten,
 *   restKwp: Potenzial, das auch danach nicht angeschlossen werden kann
 * }
 */
export function pvnaTreppe(eingabe, opts = {}) {
  const maxSchritte = opts.maxSchritte || 100;
  const basisEl = (eingabe?.elemente || []).map(e => ({ ...e }));
  const elById = new Map(basisEl.map(e => [e.id, e]));
  const basis = pvnaFuellen({ ...eingabe, elemente: basisEl });

  const anwenden = (els, ids) => els.map(e => {
    if (!ids.has(e.id) || !e.massnahme) return e;
    return { ...e,
      kapKw: e.massnahme.kapKw ?? e.kapKw,
      duProKwPct: e.massnahme.duProKwPct ?? e.duProKwPct };
  });

  const umgesetzt = new Set();
  let aktuell = basis;
  const schritte = [];
  let kumInvest = 0;

  for (let n = 0; n < maxSchritte; n++) {
    const offen = basisEl.filter(e => e.massnahme && !umgesetzt.has(e.id));
    if (!offen.length) break;
    let best = null;
    for (const kand of offen) {
      // Bündel: Kandidat + offene Maßnahmen auf dem Weg zum Trafo
      const buendel = new Set();
      for (const pid of _pfadVon(kand.id, elById)) {
        const pe = elById.get(pid);
        if (pe?.massnahme && !umgesetzt.has(pid)) buendel.add(pid);
      }
      const ids = new Set([...umgesetzt, ...buendel]);
      const res = pvnaFuellen({ ...eingabe, elemente: anwenden(basisEl, ids) });
      const zuwachs = res.summeKwp - aktuell.summeKwp;
      if (zuwachs <= 1e-6) continue;
      const invest = [...buendel].reduce((s, id) => s + (+elById.get(id).massnahme.investEUR || 0), 0);
      const guete = invest > 0 ? zuwachs / invest : Infinity;
      if (!best || guete > best.guete + EPS
          || (Math.abs(guete - best.guete) <= EPS && zuwachs > best.zuwachs)) {
        best = { buendel, res, zuwachs, invest, guete };
      }
    }
    if (!best) break;
    for (const id of best.buendel) umgesetzt.add(id);
    kumInvest += best.invest;
    aktuell = best.res;
    schritte.push({
      massnahmen: [...best.buendel].map(id => ({
        elementId: id, label: elById.get(id).massnahme.label,
        investEUR: +elById.get(id).massnahme.investEUR || 0,
      })),
      investEUR: best.invest,
      zuwachsKwp: best.zuwachs,
      summeKwp: aktuell.summeKwp,
      kumInvestEUR: kumInvest,
      eurProKwp: best.zuwachs > 0 ? best.invest / best.zuwachs : null,
    });
  }

  return {
    basis, schritte, ende: aktuell,
    restKwp: Math.max(0, aktuell.potenzialKwp - aktuell.summeKwp),
  };
}

/**
 * Stündliche Abregelung einer PV-Anlage an einer festen Einspeisegrenze.
 *
 * Beantwortet für ein Dach: Was kostet es, mehr zu bauen, als das Netz aufnimmt,
 * und die Einspeisung am Wechselrichter/EZA-Regler auf die Netzgrenze zu kappen?
 *
 * profil: Jahresprofil (8.760 Stunden), Summe 1,0 — nur die Form
 * spezKwhKwp: Jahresertrag je kWp (Form × spez × kWp = Erzeugung in kW je Stunde)
 * kwp: installierte Leistung
 * pZulKw: zulässige Einspeiseleistung (≤ 0 → alles wird abgeregelt)
 *
 * Rückgabe (MWh/a): { erzeugungMwh, abgeregeltMwh, nutzbarMwh, verlustPct,
 *                     stundenAbgeregelt, spitzeKw }
 * Ohne gleichzeitige Last gerechnet — Eigenverbrauch hinter dem Zähler würde die
 * Abregelung senken, die Werte sind also eine obere Abschätzung.
 */
export function pvnaAbregelung(profil, spezKwhKwp, kwp, pZulKw) {
  const n = profil?.length || 0;
  const faktor = Math.max(0, kwp || 0) * Math.max(0, spezKwhKwp || 0);
  const grenze = Math.max(0, pZulKw || 0);
  let erz = 0, abg = 0, stunden = 0, spitze = 0;
  for (let t = 0; t < n; t++) {
    const g = (profil[t] || 0) * faktor;
    if (g <= 0) continue;
    erz += g;
    if (g > spitze) spitze = g;
    if (g > grenze + 1e-9) { abg += g - grenze; stunden++; }
  }
  return {
    erzeugungMwh: erz / 1000,
    abgeregeltMwh: abg / 1000,
    nutzbarMwh: (erz - abg) / 1000,
    verlustPct: erz > 0 ? abg / erz * 100 : 0,
    stundenAbgeregelt: stunden,
    spitzeKw: spitze,
  };
}
