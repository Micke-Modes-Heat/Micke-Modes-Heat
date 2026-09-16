// ── lib/resilienz-core.js — Pure Logik der Resilienz-/Blackout-Betrachtung ──
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.
// Die app-seitige Schicht (Karten-Modus, Panel) liegt in 26-blackout-modus.js.
//
// Schritt 1: Notstromklassen je Gebäude und ihre Lastbilanz.
// Die Klasse liegt am Gebäude (g.notstrom), die Last kommt aus den
// Verbraucher-Assets mit passender buildingId (Summe der Anschlussleistung).

/**
 * Notstromklassen. Reihenfolge = Priorität.
 *  A — kritisch: immer 100 %, optional eigenes Aggregat am Gebäude
 *  B — eingeschränkt: versorgt mit reduzierter Last (lastPct)
 *  C — einspeisefähig: im Blackout nicht versorgt, erhält aber einen
 *      Einspeisepunkt für ein mobiles Aggregat
 */
export const NOTSTROM_KLASSEN = Object.freeze({
  A: Object.freeze({ key: 'A', label: 'Kritisch',       kurz: 'immer 100 %',              farbe: '#e53935' }),
  B: Object.freeze({ key: 'B', label: 'Eingeschränkt',  kurz: 'reduzierte Last',          farbe: '#ffa726' }),
  C: Object.freeze({ key: 'C', label: 'Einspeisefähig', kurz: 'Einspeisepunkt, mobile NEA', farbe: '#42a5f5' }),
});
export const NOTSTROM_KLASSEN_KEYS = Object.freeze(['A', 'B', 'C']);

/** Vorgabe für die reduzierte Last der Klasse B, solange am Gebäude nichts steht. */
export const NOTSTROM_B_VORGABE_PCT = 50;

const _pct = v => {
  if (v == null || v === '') return null;          // Number(null) wäre 0 → „leer" ≠ 0 %
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
};

/**
 * Gebäudefeld normalisieren (Projektdatei, Import, Altstände).
 * @returns {{klasse:'A'|'B'|'C', lastPct:number|null, eigeneNea:boolean}|null}
 */
export function normalisiereNotstrom(n) {
  if (!n || typeof n !== 'object' || !NOTSTROM_KLASSEN[n.klasse]) return null;
  return {
    klasse: n.klasse,
    lastPct: n.klasse === 'B' ? _pct(n.lastPct) : null,
    eigeneNea: n.klasse === 'A' && !!n.eigeneNea,
  };
}

/** Im Blackout zu versorgender Lastanteil (0–100) eines eingestuften Gebäudes. */
export function notstromLastPct(n, bVorgabePct = NOTSTROM_B_VORGABE_PCT) {
  const k = normalisiereNotstrom(n);
  if (!k) return 0;
  if (k.klasse === 'A') return 100;
  if (k.klasse === 'B') return k.lastPct ?? (_pct(bVorgabePct) ?? NOTSTROM_B_VORGABE_PCT);
  return 0;
}

/**
 * Anschlussleistung je Gebäude aus den Verbraucher-Assets.
 * @param {Array<{type:string, buildingId?:number|null, props?:object}>} assets
 *        bereits auf das betrachtete Jahr gefilterte Assets (nur aktive)
 * @returns {Map<number, number>} buildingId → kW
 */
export function anschlussKwJeGebaeude(assets) {
  const m = new Map();
  for (const a of assets || []) {
    if (a?.type !== 'Verbraucher' || a.buildingId == null) continue;
    const raw = a.props?.leistungKW;
    const kw = typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : Number(raw);
    if (!Number.isFinite(kw) || kw <= 0) continue;
    m.set(a.buildingId, (m.get(a.buildingId) || 0) + kw);
  }
  return m;
}

/**
 * Lastbilanz der eingestuften Gebäude.
 * @param {Array<{id:number, name?:string, notstrom?:object}>} gebaeude
 * @param {Map<number, number>} kwJeGebaeude  aus anschlussKwJeGebaeude
 * @param {{bVorgabePct?:number}} [opts]
 */
export function notstromBilanz(gebaeude, kwJeGebaeude, opts = {}) {
  const bVorgabe = opts.bVorgabePct ?? NOTSTROM_B_VORGABE_PCT;
  const leer = () => ({ anzahl: 0, anschlussKw: 0, notstromKw: 0, ohneLast: 0 });
  const klassen = { A: leer(), B: leer(), C: leer() };
  const zeilen = [];
  let neaAmGebaeude = { anzahl: 0, kw: 0 };

  for (const g of gebaeude || []) {
    const n = normalisiereNotstrom(g?.notstrom);
    if (!n) continue;
    const anschlussKw = kwJeGebaeude?.get(g.id) || 0;
    const lastPct = notstromLastPct(n, bVorgabe);
    const notstromKw = anschlussKw * lastPct / 100;
    const k = klassen[n.klasse];
    k.anzahl++;
    k.anschlussKw += anschlussKw;
    k.notstromKw += notstromKw;
    if (anschlussKw <= 0) k.ohneLast++;
    if (n.eigeneNea) { neaAmGebaeude.anzahl++; neaAmGebaeude.kw += notstromKw; }
    zeilen.push({
      id: g.id, name: g.name || `Gebäude ${g.id}`, ...n,
      lastPctWirksam: lastPct, lastPctVorgabe: n.klasse === 'B' && n.lastPct == null,
      anschlussKw, notstromKw,
    });
  }

  const ord = { A: 0, B: 1, C: 2 };
  zeilen.sort((a, b) => ord[a.klasse] - ord[b.klasse] || b.notstromKw - a.notstromKw
    || String(a.name).localeCompare(String(b.name), 'de'));

  const summe = leer();
  for (const key of NOTSTROM_KLASSEN_KEYS) {
    summe.anzahl += klassen[key].anzahl;
    summe.anschlussKw += klassen[key].anschlussKw;
    summe.notstromKw += klassen[key].notstromKw;
    summe.ohneLast += klassen[key].ohneLast;
  }
  return {
    klassen, summe, zeilen,
    neaAmGebaeude,
    // Last, die ein zentrales Aggregat (Knoten/NAP) tragen müsste
    zentralKw: summe.notstromKw - neaAmGebaeude.kw,
    einspeisepunkte: klassen.C.anzahl,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Schritt 2: Platzierung der Aggregate am Bestandsnetz
// ══════════════════════════════════════════════════════════════════════════
//
// Ein Aggregat an einem Netzknoten versorgt alles, was dahinter hängt. Was
// nicht versorgt werden soll, muss dort abgeschaltet werden — pauschal wird
// jeder Abgang als abschaltbar angenommen, das Ergebnis vermerkt nur, WELCHE.
//
// Vorgehen:
//  1. Netzbaum ab NAP (sonst Schaltanlage/Trafo/NSHV) per Breitensuche; jeder
//     Knoten hat genau einen Vorgänger, Ringe gelten an der zuletzt erreichten
//     Stelle als offen.
//  2. Jedes Gebäude sitzt an seinem Knoten mit der geringsten Tiefe (der
//     Gebäudeknoten selbst oder ein Asset mit buildingId).
//  3. Kostenminimierung von unten nach oben: an jedem NS-Knoten (Trafo, NSHV,
//     UV, KVS) steht ein Aggregat für alle A/B-Gebäude dahinter gegen die
//     günstigsten Lösungen der Abgänge (bis hin zu Aggregaten an den Gebäuden).
//     MS-Knoten (NAP, Schaltanlage) sind keine Kandidaten — das ist die
//     Liegenschafts-Insel (Schritt 3).
//
// Bemessung: gleichzeitige Spitze der Gebäudelastgänge × Lastanteil, plus
// Reserve, gerundet — wie die Aggregat-Empfehlung in der PV-Analyse (Abb. 10).

/** Richtwerte für den Kostenvergleich (netto, ohne Tank/Kraftstoff). */
export const NEA_KOSTEN = Object.freeze({
  fixEur: 15000,                // Aufstellung/Container, Abgasführung, Inbetriebnahme je Aggregat
  eurProKw: 450,                // Aggregat inkl. Steuerung, €/kW (wie Abb. 10)
  einspeisungKnotenEur: 10000,  // NEA-Einspeisefeld mit Netz-/NEA-Umschaltung am Knoten
  einspeisungGebaeudeEur: 5000, // Umschalteinrichtung in der Gebäude-Hauptverteilung
  abgangEur: 1500,              // Schaltanweisung/Kennzeichnung je abzuschaltendem Abgang
  reserve: 1.2,                 // Leistungsreserve auf die gleichzeitige Spitze
  rasterKw: 5,
});

export const NEA_KNOTEN_TYPEN = Object.freeze(['Trafo', 'NSHV', 'UV', 'KVS']);
const _INFRA = new Set(['NAP', 'Schaltanlage', 'Trafo', 'NSHV', 'UV', 'KVS']);
const _WURZEL_REIHENFOLGE = ['NAP', 'Schaltanlage', 'Trafo', 'NSHV'];

export const NEA_STRATEGIEN = Object.freeze({
  gebaeude: Object.freeze({ label: 'Je Gebäude',      kurz: 'jedes A/B-Gebäude bekommt ein eigenes Aggregat' }),
  optimal:  Object.freeze({ label: 'Optimiert',       kurz: 'günstigste Mischung aus Knoten- und Gebäudeaggregaten' }),
  trafo:    Object.freeze({ label: 'Je Trafostation', kurz: 'ein Aggregat je Trafostation mit A/B-Gebäuden' }),
});

export function neaEmpfehlungKw(peakKw, k = NEA_KOSTEN) {
  return peakKw > 0.01 ? Math.ceil(peakKw * k.reserve / k.rasterKw) * k.rasterKw : 0;
}

export function neaKosten(kw, ort, k = NEA_KOSTEN) {
  if (!(kw > 0)) return 0;
  return k.fixEur + kw * k.eurProKw + (ort === 'knoten' ? k.einspeisungKnotenEur : k.einspeisungGebaeudeEur);
}

/**
 * Kosten unter Anrechnung vorhandener Aggregate am selben Standort: reicht der
 * Bestand, entsteht nichts; sonst eine Erweiterung um die fehlende Leistung —
 * die Einspeisung ist dann schon vorhanden.
 */
export function neaKostenMitBestand(kw, ort, bestandKw = 0, k = NEA_KOSTEN) {
  if (!(kw > 0) || bestandKw >= kw) return 0;
  if (bestandKw > 0) return k.fixEur + (kw - bestandKw) * k.eurProKw;
  return neaKosten(kw, ort, k);
}

/**
 * Netzbaum ab den versorgungsseitigen Knoten.
 * @param {Array<{id:any,type:string}>} assets  aktive Strom-Assets
 * @param {Array<{id:any,u:any,v:any}>} kanten  aktive Kabel
 * @param {Set<any>} gebaeudeIds                Gebäude, die selbst Netzknoten sein können
 */
export function notstromNetzBaum(assets, kanten, gebaeudeIds) {
  const assetIds = new Set((assets || []).map(a => a.id));
  const bekannt = id => assetIds.has(id) || !!gebaeudeIds?.has(id);
  const adj = new Map();
  for (const e of kanten || []) {
    if (!bekannt(e.u) || !bekannt(e.v) || e.u === e.v) continue;
    if (!adj.has(e.u)) adj.set(e.u, []);
    if (!adj.has(e.v)) adj.set(e.v, []);
    adj.get(e.u).push({ nb: e.v, kante: e.id });
    adj.get(e.v).push({ nb: e.u, kante: e.id });
  }
  let wurzeln = [];
  for (const typ of _WURZEL_REIHENFOLGE) {
    wurzeln = (assets || []).filter(a => a.type === typ).map(a => a.id);
    if (wurzeln.length) break;
  }
  const parent = new Map(), parentKante = new Map(), tiefe = new Map(), kinder = new Map();
  const queue = [];
  for (const w of wurzeln) { parent.set(w, null); tiefe.set(w, 0); kinder.set(w, []); queue.push(w); }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const { nb, kante } of adj.get(cur) || []) {
      if (tiefe.has(nb)) continue;
      parent.set(nb, cur); parentKante.set(nb, kante); tiefe.set(nb, tiefe.get(cur) + 1);
      kinder.set(nb, []); kinder.get(cur).push(nb);
      queue.push(nb);
    }
  }
  return { wurzeln, parent, parentKante, tiefe, kinder };
}

/**
 * Aggregat-Platzierung für eine Strategie.
 * @param {object} p
 * @param {Array<{id:any,type:string,name?:string,lat?:number,lng?:number,buildingId?:any,lastKw?:number,neaKw?:number}>} p.assets
 *        Notstromaggregate (type 'Nsa') mit neaKw werden als Bestand angerechnet: am NS-Knoten, an dem sie
 *        per Kabel hängen, sonst am Gebäude ihrer buildingId.
 * @param {Array<{id:any,u:any,v:any}>} p.kanten
 * @param {Array<{id:any,name?:string,lat?:number,lng?:number,notstrom?:object}>} p.gebaeude
 * @param {Map<any,number>} [p.kwJeGebaeude]         Anschlussleistung (Verbraucher-Assets)
 * @param {(gebId:any)=>ArrayLike<number>|null} [p.profil]  Lastgang bei 100 % (kW)
 * @param {number} [p.bVorgabePct]
 * @param {string} [p.strategie]  'gebaeude' | 'optimal' | 'trafo'
 * @param {typeof NEA_KOSTEN} [p.kosten]
 */
export function notstromPlatzierung(p) {
  const k = p.kosten || NEA_KOSTEN;
  const strategie = NEA_STRATEGIEN[p.strategie] ? p.strategie : 'optimal';
  const bVorgabe = p.bVorgabePct ?? NOTSTROM_B_VORGABE_PCT;
  const kw = p.kwJeGebaeude || new Map();
  const assetMap = new Map((p.assets || []).map(a => [a.id, a]));
  const gebMap = new Map((p.gebaeude || []).map(g => [g.id, g]));
  const baum = notstromNetzBaum(p.assets, p.kanten, new Set(gebMap.keys()));

  // Anker je Gebäude: Mitgliedsknoten mit der geringsten Tiefe
  const anker = new Map();
  for (const id of baum.tiefe.keys()) {
    const a = assetMap.get(id);
    const gId = a ? a.buildingId : (gebMap.has(id) ? id : null);
    if (gId == null || !gebMap.has(gId)) continue;
    const bisher = anker.get(gId);
    if (bisher == null || baum.tiefe.get(id) < baum.tiefe.get(bisher)) anker.set(gId, id);
  }

  // Eigene Einträge je Knoten: zu versorgende Gebäude und abzuschaltende Lasten
  const eigenAB = new Map();
  const eigenLast = new Map();
  const push = (m, key, v) => { if (!m.has(key)) m.set(key, []); m.get(key).push(v); };
  const fest = [], nichtAmNetz = [];
  const pct = new Map();
  for (const g of gebMap.values()) {
    const n = normalisiereNotstrom(g.notstrom);
    const knoten = anker.get(g.id);
    const lastPct = notstromLastPct(n, bVorgabe);
    // Gebäude mit eigenem Aggregat versorgen sich selbst — am Knoten weder
    // mitversorgt noch abzuschalten.
    if (n?.eigeneNea) { fest.push(g.id); pct.set(g.id, lastPct); continue; }
    if (n && lastPct > 0) {
      pct.set(g.id, lastPct);
      if (knoten == null) nichtAmNetz.push(g.id); else push(eigenAB, knoten, g.id);
    } else if (knoten != null) {
      // Jedes angeschlossene, nicht versorgte Gebäude muss abgeschaltet werden —
      // auch ohne Verbraucher-Asset ist es eine Last.
      push(eigenLast, knoten, { name: g.name || `Gebäude ${g.id}`, kw: kw.get(g.id) || 0,
                                einspeisepunkt: n?.klasse === 'C' });
    }
  }
  for (const a of p.assets || []) {
    if (!(a.lastKw > 0) || _INFRA.has(a.type) || !baum.tiefe.has(a.id)) continue;
    if (a.buildingId != null && gebMap.has(a.buildingId)) continue;   // zählt beim Gebäude
    push(eigenLast, a.id, { name: a.name || a.type, kw: a.lastKw, einspeisepunkt: false });
  }

  // Vorhandene Aggregate je Standort
  const bestand = new Map();
  const bestandOhneOrt = [];
  for (const a of p.assets || []) {
    if (a.type !== 'Nsa' || !(a.neaKw > 0)) continue;
    const vater = baum.parent.get(a.id);
    const ort = vater != null && NEA_KNOTEN_TYPEN.includes(assetMap.get(vater)?.type) ? vater
      : a.buildingId != null && gebMap.has(a.buildingId) ? a.buildingId : null;
    if (ort == null) { bestandOhneOrt.push({ id: a.id, name: a.name, kw: a.neaKw }); continue; }
    bestand.set(ort, (bestand.get(ort) || 0) + a.neaKw);
  }

  // Von den Blättern zur Wurzel aufsammeln
  const reihenfolge = [...baum.tiefe.keys()].sort((x, y) => baum.tiefe.get(y) - baum.tiefe.get(x));
  const ab = new Map(), last = new Map();
  for (const id of reihenfolge) {
    const abListe = [...(eigenAB.get(id) || [])];
    const lastListe = [...(eigenLast.get(id) || [])];
    for (const c of baum.kinder.get(id)) {
      if (ab.has(c)) abListe.push(...ab.get(c));
      if (last.has(c)) lastListe.push(...last.get(c));
    }
    if (abListe.length) ab.set(id, abListe);
    if (lastListe.length) last.set(id, lastListe);
  }

  // Lasten eines Gebäudes heißen wie das Gebäude, Netzknoten behalten ihren Namen
  const name = id => {
    const a = assetMap.get(id);
    const g = a ? (!_INFRA.has(a.type) && gebMap.get(a.buildingId)) : gebMap.get(id);
    if (g) return g.name || `Gebäude ${g.id}`;
    return a?.name || a?.type || String(id);
  };
  const pos = id => {
    const o = assetMap.get(id) || gebMap.get(id);
    return o && Number.isFinite(o.lat) && Number.isFinite(o.lng) ? { lat: o.lat, lng: o.lng } : {};
  };

  // Abzuschaltende Abgänge bei einem Aggregat an X: die obersten Teilbäume
  // ohne A/B-Gebäude, die Last tragen. Lasten, die selbst auf dem Weg zu
  // einem A/B-Gebäude liegen, lassen sich nur an Ort und Stelle trennen
  // (vonId === zuId, kanteId null).
  const abgaengeUnter = X => {
    const out = [];
    const stapel = [X];
    while (stapel.length) {
      const cur = stapel.pop();
      const lokal = eigenLast.get(cur);
      if (lokal) {
        out.push({
          kanteId: null, vonId: cur, vonName: name(cur), zuId: cur, zuName: name(cur), lokal: true,
          lastKw: lokal.reduce((s, x) => s + x.kw, 0), anzahl: lokal.length, namen: lokal.map(x => x.name),
          einspeisepunkte: lokal.filter(x => x.einspeisepunkt).length,
        });
      }
      for (const c of baum.kinder.get(cur)) {
        if (ab.has(c)) { stapel.push(c); continue; }
        const l = last.get(c);
        if (!l) continue;
        out.push({
          kanteId: baum.parentKante.get(c), vonId: cur, vonName: name(cur), zuId: c, zuName: name(c),
          lastKw: l.reduce((s, x) => s + x.kw, 0), anzahl: l.length, namen: l.map(x => x.name),
          einspeisepunkte: l.filter(x => x.einspeisepunkt).length,
        });
      }
    }
    return out;
  };

  const profilCache = new Map();
  const profilVon = gId => {
    if (!profilCache.has(gId)) {
      const pr = p.profil ? p.profil(gId) : null;
      profilCache.set(gId, pr && pr.length ? pr : null);
    }
    return profilCache.get(gId);
  };
  // Summenlastgang je Knoten, einmal von unten nach oben aufaddiert. Gebäude
  // ohne Lastgang gehen mit ihrer Anschlussleistung als Konstante ein.
  const addiere = (ziel, quelle, faktor) => {
    const n = Math.min(ziel.profil.length, quelle.length);
    for (let t = 0; t < n; t++) ziel.profil[t] += quelle[t] * faktor;
  };
  const gebSumme = gId => {
    const pr = profilVon(gId), f = pct.get(gId) / 100;
    if (!pr) return { profil: null, flach: (kw.get(gId) || 0) * f };
    const s = { profil: new Float64Array(pr.length), flach: 0 };
    addiere(s, pr, f);
    return s;
  };
  const summenMemo = new Map();
  const knotenSumme = X => {
    if (summenMemo.has(X)) return summenMemo.get(X);
    const s = { profil: null, flach: 0 };
    const dazu = t => {
      s.flach += t.flach;
      if (!t.profil) return;
      if (!s.profil) s.profil = new Float64Array(t.profil.length);
      addiere(s, t.profil, 1);
    };
    for (const g of eigenAB.get(X) || []) dazu(gebSumme(g));
    for (const c of baum.kinder.get(X)) if (ab.has(c)) dazu(knotenSumme(c));
    summenMemo.set(X, s);
    return s;
  };
  const spitzeVon = s => {
    let max = 0;
    if (s.profil) for (let t = 0; t < s.profil.length; t++) if (s.profil[t] > max) max = s.profil[t];
    return max + s.flach;
  };

  const gebAggregat = (gId, extra = {}) => {
    const peakKw = spitzeVon(gebSumme(gId));
    const empfKw = neaEmpfehlungKw(peakKw, k);
    const bestandKw = bestand.get(gId) || 0;
    return {
      ort: 'gebaeude', id: gId, typ: 'Gebäude', name: name(gId), ...pos(gId),
      gebaeude: [gId], peakKw, empfKw, bestandKw, zusatzKw: Math.max(0, empfKw - bestandKw),
      kosten: neaKostenMitBestand(empfKw, 'gebaeude', bestandKw, k), abgaenge: [], ...extra,
    };
  };

  const kandidat = id => {
    const typ = assetMap.get(id)?.type;
    if (strategie === 'gebaeude') return false;
    if (strategie === 'trafo') return typ === 'Trafo';
    return NEA_KNOTEN_TYPEN.includes(typ);
  };

  const summe = teile => ({
    kosten: teile.reduce((s, t) => s + t.kosten, 0),
    aggregate: teile.flatMap(t => t.aggregate),
  });

  const loese = X => {
    if (!ab.has(X)) return { kosten: 0, aggregate: [] };
    const teile = (eigenAB.get(X) || []).map(g => {
      const agg = gebAggregat(g);
      return { kosten: agg.kosten, aggregate: [agg] };
    });
    for (const c of baum.kinder.get(X)) if (ab.has(c)) teile.push(loese(c));
    const unten = summe(teile);
    if (!kandidat(X)) return unten;
    const gIds = ab.get(X);
    const peakKw = spitzeVon(knotenSumme(X));
    const empfKw = neaEmpfehlungKw(peakKw, k);
    const abgaenge = abgaengeUnter(X);
    const bestandKw = bestand.get(X) || 0;
    const agg = {
      ort: 'knoten', id: X, typ: assetMap.get(X).type, name: name(X), ...pos(X),
      gebaeude: gIds, peakKw, empfKw, abgaenge, bestandKw, zusatzKw: Math.max(0, empfKw - bestandKw),
      kosten: neaKostenMitBestand(empfKw, 'knoten', bestandKw, k) + abgaenge.length * k.abgangEur,
    };
    if (strategie === 'trafo' || agg.kosten <= unten.kosten) return { kosten: agg.kosten, aggregate: [agg] };
    return unten;
  };

  const netz = summe(baum.wurzeln.map(loese));
  const aggregate = [
    ...netz.aggregate,
    ...nichtAmNetz.map(g => gebAggregat(g, { nichtAmNetz: true })),
    ...fest.map(g => gebAggregat(g, { fest: true })),
  ];
  const abgaenge = aggregate.flatMap(a => a.abgaenge.map(x => ({ ...x, aggregatId: a.id })));
  return {
    strategie, aggregate, abgaenge, nichtAmNetz, fest, wurzeln: baum.wurzeln,
    bestandOhneOrt,
    bestandGenutztKw: aggregate.reduce((s, a) => s + Math.min(a.bestandKw || 0, a.empfKw), 0),
    summe: {
      zusatzKw: aggregate.reduce((s, a) => s + (a.zusatzKw || 0), 0),
      anzahl: aggregate.filter(a => a.empfKw > 0).length,
      kw: aggregate.reduce((s, a) => s + a.empfKw, 0),
      kosten: aggregate.reduce((s, a) => s + a.kosten, 0),
      abgaenge: abgaenge.length,
      ohneLast: aggregate.filter(a => !(a.empfKw > 0)).length,
    },
  };
}

/** Alle drei Strategien rechnen; die günstigste ist die Empfehlung. */
export function notstromPlatzierungVergleich(p) {
  const varianten = {};
  for (const s of Object.keys(NEA_STRATEGIEN)) varianten[s] = notstromPlatzierung({ ...p, strategie: s });
  const empfohlen = Object.keys(varianten)
    .reduce((best, s) => (varianten[s].summe.kosten < varianten[best].summe.kosten ? s : best), 'optimal');
  return { varianten, empfohlen };
}

// ══════════════════════════════════════════════════════════════════════════
// Schritt 3: Liegenschafts-Insel am NAP
// ══════════════════════════════════════════════════════════════════════════
//
// Ein zentrales Aggregat speist über einen Maschinentrafo in die MS-Anlage am
// NAP; das Liegenschaftsnetz läuft als Insel. Abgesichert wird ein Anteil x %
// der Liegenschafts-Spitzenlast. Daraus folgen:
//   • Bemessung: Aggregate (Standardgrößen, optional N+1), Maschinentrafo, Tank
//   • Lastabwurf: Trafos ohne A/B-Gebäude MS-seitig abschalten; reicht das
//     nicht, zusätzlich NS-Abgänge (aus Schritt 2) in den versorgten Stationen
//   • Zuschaltstufen: Trafos gruppenweise zuschalten (Einschaltstrom, Lastsprung)
//   • MS-Kennwerte: Kurzschlussstrom des Aggregats, kapazitiver Erdschlussstrom
//     und Ladeleistung der MS-Kabel
//   • Checkliste: was neu, was zu prüfen, was zu erneuern ist — mit Richtkosten
// Alle Kennwerte sind Planungs-Abschätzungen, keine Netzberechnung nach VDE 0102.

export const INSEL_PARAMETER = Object.freeze({
  cosPhi: 0.8,                  // Bemessungs-Leistungsfaktor Aggregat (ISO 8528)
  reserve: 1.2,                 // Leistungsreserve auf die abzusichernde Spitze
  aggregatStufenKva: Object.freeze([100, 150, 200, 250, 300, 400, 500, 630, 800, 1000, 1250, 1500, 1750, 2000, 2250, 2500]),
  maschinentrafoStufenKva: Object.freeze([250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300]),
  xdSubtransient: 0.15,         // x_d'' Generator (p.u.)
  ikDauerFaktor: 3,             // Dauerkurzschlussstrom bei Erregung mit Hilfswicklung/PMG (× I_n)
  ukMaschinentrafo: 0.06,
  iGrossFaktorTrafo: 8,         // übliche UMZ-Hochstromstufe I>> je Trafo-Abgang (× I_n Trafo)
  kabelCapUfProKm: 0.3,         // Betriebskapazität VPE-Kabel 12/20 kV (µF/km)
  zuschaltAnteilKva: 0.5,       // Trafo-Nennleistung je Zuschaltstufe ≤ Anteil der Aggregatleistung
  lastsprungAnteil: 0.4,        // Lastsprung je Stufe ≤ Anteil der Aggregat-Wirkleistung (ISO 8528-5 G2)
  blindAnteilGrenze: 0.1,       // kapazitive Ladeleistung ≤ 10 % S_NEA ohne Untererregungs-Prüfung
  sfcLproKwh: 0.28,             // Diesel bei Volllast
  teillastZuschlag: 1.1,
  tankZuschlag: 1.15,
  awsvSchwelleL: 1000,
  schutzAlterJ: 20,             // älter: elektromechanisch/ohne Parametersatzumschaltung wahrscheinlich
});

export const INSEL_KOSTEN = Object.freeze({
  aggregatFixEur: 30000,        // je Aggregat: Container, Abgas, Inbetriebnahme
  aggregatEurProKva: 320,
  maschinentrafoFixEur: 15000,
  maschinentrafoEurProKva: 40,
  sternpunktEur: 60000,         // Erdungstrafo/Sternpunktbildner mit Widerstand
  einspeisefeldEur: 60000,      // MS-Einspeisefeld mit Leistungsschalter und Schutz
  netztrennungEur: 80000,       // Kuppelschalter am NAP, Verriegelung, Synchronisierung
  schutzRetrofitJeFeldEur: 15000,
  fernsteuerungJeFeldEur: 8000,
  leittechnikEur: 50000,        // Lastmanagement, Zuschaltlogik, Visualisierung
  nsAbgangEur: 1500,
  tankEurProL: 1.5,
});

export const INSEL_STATUS = Object.freeze({
  neu:      Object.freeze({ label: 'neu',      farbe: '#42a5f5' }),
  erneuern: Object.freeze({ label: 'erneuern', farbe: '#ef5350' }),
  pruefen:  Object.freeze({ label: 'prüfen',   farbe: '#ffa726' }),
  ok:       Object.freeze({ label: 'ok',       farbe: '#66bb6a' }),
});

const _stufe = (liste, wert) => liste.find(s => s >= wert) ?? null;

/** Aggregate in Standardgrößen: größte Stufe reicht nicht → mehrere gleiche Einheiten. */
export function inselAggregate(sBedarfKva, redundanz = false, par = INSEL_PARAMETER) {
  if (!(sBedarfKva > 0)) return { anzahl: 0, kvaJe: 0, kvaGesamt: 0 };
  const max = par.aggregatStufenKva[par.aggregatStufenKva.length - 1];
  let n = Math.ceil(sBedarfKva / max);
  const kvaJe = _stufe(par.aggregatStufenKva, sBedarfKva / n) ?? max;
  if (redundanz) n += 1;
  return { anzahl: n, kvaJe, kvaGesamt: n * kvaJe };
}

/** Größte Energie eines zusammenhängenden Fensters (kWh) — Grundlage der Tankgröße. */
export function maxFensterEnergie(profil, dauerH) {
  const n = profil?.length || 0;
  if (!n || !(dauerH > 0)) return 0;
  const d = Math.min(dauerH, n);
  let s = 0;
  for (let t = 0; t < d; t++) s += profil[t];
  let max = s;
  for (let t = 0; t < n; t++) {                 // Jahresgrenze zyklisch
    s += profil[(t + d) % n] - profil[t];
    if (s > max) max = s;
  }
  return max;
}

/**
 * Trafos in Zuschaltstufen packen (größte zuerst, erste passende Stufe).
 * @returns {{stufen:Array<{trafos:any[], kva:number, lastKw:number}>, zuGross:any[]}}
 */
export function inselZuschaltstufen(trafos, sAggKva, pAggKw, par = INSEL_PARAMETER) {
  const kvaGrenze = sAggKva * par.zuschaltAnteilKva;
  const lastGrenze = pAggKw * par.lastsprungAnteil;
  const stufen = [], zuGross = [];
  const sortiert = [...trafos].sort((a, b) => (b.kva || 0) - (a.kva || 0));
  for (const t of sortiert) {
    const kva = t.kva || 0, last = t.lastKw || 0;
    if (kva > kvaGrenze || last > lastGrenze) {
      zuGross.push(t);
      stufen.push({ trafos: [t], kva, lastKw: last });   // eigene Stufe, mit Hinweis
      continue;
    }
    const s = stufen.find(x => !x.trafos.some(y => zuGross.includes(y))
      && x.kva + kva <= kvaGrenze && x.lastKw + last <= lastGrenze);
    if (s) { s.trafos.push(t); s.kva += kva; s.lastKw += last; }
    else stufen.push({ trafos: [t], kva, lastKw: last });
  }
  return { stufen, zuGross, kvaGrenze, lastGrenze };
}

/** MS-Kennwerte der Insel. */
export function inselMsKennwerte({ sAggKva, sMtKva, uKv, msKabelKm, groessterTrafoKva }, par = INSEL_PARAMETER) {
  const u = (uKv || 20) * 1000;
  const inMs = sAggKva * 1000 / (Math.sqrt(3) * u);
  const xGes = par.xdSubtransient + par.ukMaschinentrafo * (sAggKva / Math.max(sMtKva || sAggKva, 1));
  const ikSubA = xGes > 0 ? inMs / xGes : 0;
  const ikDauerA = inMs * par.ikDauerFaktor;
  const omega = 2 * Math.PI * 50;
  const c = par.kabelCapUfProKm * 1e-6 * (msKabelKm || 0);
  const icA = Math.sqrt(3) * u * omega * c;
  const qcKvar = u * u * omega * c / 1000;
  const iGrossA = groessterTrafoKva > 0
    ? par.iGrossFaktorTrafo * groessterTrafoKva * 1000 / (Math.sqrt(3) * u) : 0;
  return { inMsA: inMs, ikSubA, ikDauerA, icA, qcKvar, iGrossA };
}

/**
 * Liegenschafts-Insel.
 * @param {object} p
 * @param {ArrayLike<number>|null} p.profil      Liegenschafts-Lastgang (kW, stündlich)
 * @param {number} [p.spitzeKw]                  Spitze, falls kein Lastgang
 * @param {number} p.anteilPct                   abzusichernder Anteil der Spitze
 * @param {number} p.dauerH                      Autonomiedauer
 * @param {boolean} [p.redundanz]                N+1
 * @param {number} [p.abSpitzeKw]                gleichzeitige Spitze der A/B-Gebäude (Schritt 2)
 * @param {Array<{id:any,name:string,kva:number,spitzeKw:number,abKw:number,nsAbgaenge?:any[],baujahr?:number}>} p.trafos
 * @param {{spannungKV?:number, msKabelM?:number, schaltanlagen?:Array<{id:any,name:string,type:string,baujahr?:number}>}} p.netz
 * @param {number} p.jahr
 * @param {Record<string,string>} [p.bewertung]  Status-Überschreibungen je Checklisten-Id
 */
export function liegenschaftsInsel(p) {
  const par = p.parameter || INSEL_PARAMETER;
  const k = p.kosten || INSEL_KOSTEN;
  const anteil = Math.min(100, Math.max(0, p.anteilPct ?? 100)) / 100;
  const spitzeKw = p.profil?.length ? Math.max(...p.profil) : (p.spitzeKw || 0);
  const zielKw = spitzeKw * anteil;
  const trafos = p.trafos || [];
  const netz = p.netz || {};
  const uKv = parseFloat(netz.spannungKV) || 20;

  // ── Lastabwurf ────────────────────────────────────────────────────────
  // Trafos mit A/B-Gebäuden bleiben am Netz; die übrigen kommen nach Größe
  // der Spitzenlast dazu, solange das Ziel es hergibt (kleine zuerst: viele
  // Stationen mit wenig Last sind der wahrscheinlichere Versorgungsauftrag).
  const mitAB = trafos.filter(t => t.abKw > 0);
  const ohneAB = trafos.filter(t => !(t.abKw > 0)).sort((a, b) => a.spitzeKw - b.spitzeKw);
  const lastAB = mitAB.reduce((s, t) => s + t.spitzeKw, 0);
  const nsAbwurf = [];
  let abWirksamKw = lastAB;
  // Last, mit der eine Station im Inselbetrieb zugeschaltet wird
  const lastImInsel = new Map(trafos.map(t => [t.id, t.spitzeKw]));
  if (lastAB > zielKw) {
    // Versorgte Stationen tragen mehr als das Ziel: dort NS-seitig abwerfen.
    // Übrig bleibt mindestens die A/B-Last selbst.
    let abwurfKw = 0;
    for (const t of mitAB) {
      let tAbwurf = 0;
      for (const a of t.nsAbgaenge || []) { nsAbwurf.push({ ...a, trafo: t.name }); tAbwurf += a.lastKw || 0; }
      lastImInsel.set(t.id, Math.max(t.abKw, t.spitzeKw - tAbwurf));
      abwurfKw += tAbwurf;
    }
    abWirksamKw = Math.max(p.abSpitzeKw || 0, lastAB - abwurfKw);
  }
  let budget = zielKw - abWirksamKw;
  const zusaetzlich = [], abschalten = [];
  for (const t of ohneAB) {
    if (t.spitzeKw <= budget) { zusaetzlich.push(t); budget -= t.spitzeKw; } else abschalten.push(t);
  }
  const versorgt = [...mitAB, ...zusaetzlich].map(t => ({ ...t, lastKw: lastImInsel.get(t.id) }));
  const versorgtKw = abWirksamKw + zusaetzlich.reduce((s, t) => s + t.spitzeKw, 0);
  const abReichtNicht = (p.abSpitzeKw || 0) > zielKw + 0.01;
  // Bemessung: das Ziel, mindestens aber die A/B-Last
  const bemessungKw = Math.max(zielKw, p.abSpitzeKw || 0);

  // ── Bemessung ─────────────────────────────────────────────────────────
  const sBedarfKva = bemessungKw * par.reserve / par.cosPhi;
  const agg = inselAggregate(sBedarfKva, !!p.redundanz, par);
  const sWirkKva = agg.anzahl ? (p.redundanz ? (agg.anzahl - 1) : agg.anzahl) * agg.kvaJe : 0;
  const pAggKw = sWirkKva * par.cosPhi;
  const mtKva = _stufe(par.maschinentrafoStufenKva, agg.kvaGesamt) ?? agg.kvaGesamt;
  const energieKwh = p.profil?.length
    ? maxFensterEnergie(p.profil, p.dauerH) * anteil
    : zielKw * (p.dauerH || 0);
  const liter = Math.ceil(energieKwh * par.sfcLproKwh * par.teillastZuschlag * par.tankZuschlag / 100) * 100;

  const ms = inselMsKennwerte({
    sAggKva: sWirkKva, sMtKva: mtKva, uKv, msKabelKm: (netz.msKabelM || 0) / 1000,
    groessterTrafoKva: Math.max(0, ...versorgt.map(t => t.kva || 0)),
  }, par);
  const zs = inselZuschaltstufen(versorgt, sWirkKva, pAggKw, par);

  // ── Checkliste ────────────────────────────────────────────────────────
  const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('de-DE');
  const alt = bj => (bj ? p.jahr - bj : null);
  const punkte = [];
  const punkt = (id, gruppe, titel, status, text, kosten = 0, bezug = null) => {
    const s = p.bewertung?.[id] && INSEL_STATUS[p.bewertung[id]] ? p.bewertung[id] : status;
    // Status „ok" braucht keine Investition
    punkte.push({ id, gruppe, titel, status: s, auto: status, text, kosten: s === 'ok' ? 0 : kosten, bezug });
  };

  punkt('nea', 'Erzeugung', `Netzersatzanlage ${agg.anzahl} × ${fmt(agg.kvaJe)} kVA`, 'neu',
    `Bemessung ${fmt(bemessungKw)} kW × ${par.reserve} Reserve / cos φ ${par.cosPhi} = ${fmt(sBedarfKva)} kVA`
    + (p.redundanz ? ', zusätzlich eine Einheit für N+1' : '')
    + `. Aufstellung nahe der MS-Anlage am NAP, Parallelbetrieb der Einheiten über gemeinsame Sammelschiene.`,
    agg.anzahl * k.aggregatFixEur + agg.kvaGesamt * k.aggregatEurProKva);
  punkt('mt', 'Erzeugung', `Maschinentrafo ${fmt(mtKva)} kVA, 0,4/${fmt(uKv)} kV`, 'neu',
    `Hebt die Generatorspannung auf die MS-Ebene. u_k ≈ ${fmt(par.ukMaschinentrafo * 100)} %. `
    + 'Schaltgruppe mit dem Sternpunktkonzept festlegen (z. B. YNd mit MS-Sternpunkt über Widerstand oder Dyn mit separatem Sternpunktbildner).',
    k.maschinentrafoFixEur + mtKva * k.maschinentrafoEurProKva);
  punkt('tank', 'Erzeugung', `Kraftstofflager ${fmt(liter)} l Diesel`, 'neu',
    `Ungünstigstes ${fmt(p.dauerH)}-h-Fenster: ${fmt(energieKwh / 1000, 1)} MWh × ${par.sfcLproKwh} l/kWh inkl. Teillast- und Tankzuschlag`
    + (liter > par.awsvSchwelleL ? `. Über ${fmt(par.awsvSchwelleL)} l: AwSV-Anzeige und Auflagen beachten.` : '.'),
    liter * k.tankEurProL);
  punkt('stern', 'MS-Netz', 'Sternpunktbehandlung im Inselbetrieb', 'neu',
    `Im Inselbetrieb fehlt die Sternpunkterdung des Netzbetreibers. Kapazitiver Erdschlussstrom der ${fmt((netz.msKabelM || 0) / 1000, 2)} km MS-Kabel ≈ ${fmt(ms.icA, 1)} A. `
    + (ms.icA < 10
      ? 'Klein genug für isolierten Betrieb mit Erdschlussmeldung — Dauer des Erdschlussbetriebs mit dem Schutzkonzept abstimmen; '
      : 'Isolierter Betrieb nur mit schneller Erdschlussortung; ')
    + 'eigene Sternpunktbildung (Erdungstrafo bzw. geerdeter Sternpunkt des Maschinentrafos) vorsehen.',
    k.sternpunktEur);
  punkt('trennung', 'MS-Netz', 'Netztrennung am NAP', 'neu',
    'Kuppel-Leistungsschalter mit gegenseitiger Verriegelung Netz/NEA, Unterspannungs-/Frequenzerfassung für die Umschaltung, '
    + 'Synchronisiereinrichtung für die unterbrechungsfreie Rückschaltung. Betrieb nach VDE-AR-N 4110 mit dem Netzbetreiber abstimmen.',
    k.netztrennungEur);
  const hatSA = (netz.schaltanlagen || []).some(s => s.type === 'Schaltanlage');
  punkt('einspeisefeld', 'MS-Netz', 'MS-Einspeisefeld für die NEA', hatSA ? 'pruefen' : 'neu',
    hatSA ? 'Freies bzw. erweiterbares Feld in der vorhandenen Schaltanlage prüfen; sonst Anbaufeld.'
          : 'Keine MS-Schaltanlage erfasst — Einspeisung über neue Schaltanlage am NAP.',
    k.einspeisefeldEur);

  const kurzschlussKritisch = ms.iGrossA > 0 && ms.ikDauerA < ms.iGrossA;
  for (const s of netz.schaltanlagen || []) {
    const a = alt(s.baujahr);
    const status = a == null ? 'pruefen' : a > par.schutzAlterJ ? 'erneuern' : kurzschlussKritisch ? 'pruefen' : 'ok';
    punkt(`schutz:${s.id}`, 'Schutztechnik', `Schutz ${s.name}`, status,
      (a == null ? 'Baujahr unbekannt. ' : `Baujahr ${s.baujahr} (${a} Jahre). `)
      + (a != null && a > par.schutzAlterJ
        ? 'Vermutlich ohne umschaltbaren Parametersatz — digitaler Schutz mit Parametersatz „Inselbetrieb" empfohlen.'
        : 'Zweiten Parametersatz „Inselbetrieb" einrichten und Umschaltung an die Netztrennung koppeln.'),
      status === 'erneuern' ? k.schutzRetrofitJeFeldEur : 0, s.id);
  }
  punkt('kurzschluss', 'Schutztechnik', 'Kurzschlussstrom im Inselbetrieb', kurzschlussKritisch ? 'pruefen' : 'ok',
    `Aggregat an MS: I_k'' ≈ ${fmt(ms.ikSubA)} A, Dauerkurzschlussstrom ≈ ${fmt(ms.ikDauerA)} A `
    + `(I_n ${fmt(ms.inMsA, 1)} A). Übliche Hochstromstufe am größten Trafoabgang ≈ ${fmt(ms.iGrossA)} A — `
    + (kurzschlussKritisch
      ? 'die Netzbetriebs-Einstellung spricht im Inselbetrieb nicht an. Schutzstaffelung für den Inselbetrieb neu berechnen.'
      : 'Anregung voraussichtlich gegeben; Staffelung trotzdem nachweisen.'));
  punkt('nsschutz', 'Schutztechnik', 'Abschaltbedingung NS-Netz', 'pruefen',
    'Der Kurzschlussstrom in den NS-Netzen sinkt im Inselbetrieb deutlich. Abschaltbedingung (VDE 0100-410) für lange Stichleitungen und große Sicherungen prüfen.');

  const schaltfelder = versorgt.length + abschalten.length;
  punkt('fernsteuerung', 'Lastabwurf', `Fernsteuerbare Trafo-Abgänge (${schaltfelder})`, 'pruefen',
    `${abschalten.length} Station(en) werden im Inselbetrieb MS-seitig abgeschaltet, ${versorgt.length} in ${zs.stufen.length} Stufen zugeschaltet. `
    + 'Dafür Motorantriebe und Fernwirkanbindung je Feld; vorhandene Ausstattung prüfen.',
    schaltfelder * k.fernsteuerungJeFeldEur);
  if (nsAbwurf.length) {
    punkt('nsabwurf', 'Lastabwurf', `NS-seitiger Lastabwurf (${nsAbwurf.length} Abgänge)`, 'neu',
      `Die Stationen mit A/B-Gebäuden tragen ${fmt(lastAB)} kW, das Ziel liegt bei ${fmt(zielKw)} kW. `
      + 'Die Abgänge ohne A/B-Gebäude aus der Platzierung am Netz werden in diesen Stationen getrennt.',
      nsAbwurf.length * k.nsAbgangEur);
  }
  punkt('zuschaltung', 'Lastabwurf', `Zuschaltstufen (${zs.stufen.length})`, zs.zuGross.length ? 'pruefen' : 'ok',
    `Je Stufe höchstens ${fmt(zs.kvaGrenze)} kVA Trafoleistung und ${fmt(zs.lastGrenze)} kW Lastsprung.`
    + (zs.zuGross.length
      ? ` ${zs.zuGross.map(t => t.name).join(', ')} überschreiten die Grenze — Vormagnetisierung, Sanftzuschaltung oder größere NEA.`
      : ''));
  const blindKritisch = sWirkKva > 0 && ms.qcKvar > par.blindAnteilGrenze * sWirkKva;
  punkt('blind', 'MS-Netz', 'Blindleistung der MS-Kabel', blindKritisch ? 'pruefen' : 'ok',
    `Kapazitive Ladeleistung ≈ ${fmt(ms.qcKvar)} kvar (${fmt(sWirkKva > 0 ? ms.qcKvar / sWirkKva * 100 : 0, 1)} % der Aggregatleistung). `
    + (blindKritisch ? 'Untererregte Fahrweise der Generatoren prüfen, ggf. Drosselspule.' : 'Unkritisch.'));
  punkt('leittechnik', 'Betrieb', 'Lastmanagement und Leittechnik', 'neu',
    'Automatische Umschaltung, Zuschaltlogik, Lastabwurf bei Überlast, Kraftstoffüberwachung, Probebetrieb unter Last.',
    k.leittechnikEur);

  const kostenSumme = punkte.reduce((s, x) => s + x.kosten, 0);
  return {
    spitzeKw, zielKw, bemessungKw, anteilPct: anteil * 100, abReichtNicht,
    lastabwurf: { versorgt, zusaetzlich, abschalten, nsAbwurf, versorgtKw, lastAB },
    aggregate: { ...agg, sBedarfKva, sWirkKva, pAggKw },
    maschinentrafoKva: mtKva, energieKwh, liter, ms, zuschaltung: zs,
    checkliste: punkte, kosten: kostenSumme,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Schritt 4: Wärmeversorgung bei Ausfall der äußeren Versorgung
// ══════════════════════════════════════════════════════════════════════════
//
// Bewusst pauschal: Netzlast der Heizzentrale gegen die im Szenario noch
// verfügbare Erzeugerleistung, stündlich über das ungünstigste Fenster.
//   • Ohne Strom laufen weder Pumpen noch Brenner — ohne Notstromaggregat an
//     der Heizzentrale ist die Deckung null (auch der Pufferspeicher ist ohne
//     Umwälzung nicht nutzbar).
//   • Mit Aggregat laufen die Erzeuger, deren Energieträger noch da ist.
//     Wärmepumpen und Stromkessel bleiben aus: das Aggregat ist nur für die
//     Hilfsenergie bemessen.
//   • Fällt Gas aus, übernimmt der Zweistoffbrenner mit Heizöl aus dem Lager.
// Reihenfolge der Deckung: Festbrennstoff → Gas → Fernwärme → Heizöl → Puffer.

export const WAERME_SZENARIEN = Object.freeze({
  strom:       Object.freeze({ label: 'Strom',             kurz: 'nur das Stromnetz fällt aus',       gas: true,  fw: true }),
  'strom-gas': Object.freeze({ label: 'Strom + Gas',       kurz: 'Strom- und Gasversorgung fallen aus', gas: false, fw: true }),
  total:       Object.freeze({ label: 'Totalausfall',      kurz: 'Strom, Gas und Fernwärme fallen aus', gas: false, fw: false }),
});

/** Energieträger je Erzeuger-Schlüssel (config/erzeuger-cfg.js). */
export const WAERME_ENERGIETRAEGER = Object.freeze({
  lwwp: 'strom', fg: 'strom', geo: 'strom', stromkessel: 'strom',
  gaskessel: 'gas', bhkw: 'gas', autogk: 'gas',
  fernwaerme: 'fw', heizoel: 'oel', zweistoff: 'oel',
  pellets: 'fest', hhs: 'fest',
});

export const WAERME_PARAMETER = Object.freeze({
  heizwertKwhProL: 10,          // Heizöl EL
  kesselEta: 0.9,
  tankZuschlag: 1.15,
  hilfsPctVorgabe: 2,           // Pumpen, Brenner, Regelung in % der laufenden Kesselleistung
  horizontH: 720,               // Reichweite des Heizöllagers höchstens 30 Tage suchen
  awsvSchwelleL: 1000,
});

export const WAERME_KOSTEN = Object.freeze({
  zweistoffFixEur: 15000,       // Brennerumbau, Ölversorgung, Regelung je Anlage
  zweistoffEurProKw: 20,
  tankEurProL: 1.5,             // zusätzliches Lagervolumen, doppelwandig
});

/** Startstunde des energiereichsten Fensters (zyklisch). */
export function maxFensterStart(profil, dauerH) {
  const n = profil?.length || 0;
  if (!n || !(dauerH > 0)) return 0;
  const d = Math.min(dauerH, n);
  let s = 0;
  for (let t = 0; t < d; t++) s += profil[t];
  let max = s, start = 0;
  for (let t = 1; t < n; t++) {
    s += profil[(t + d - 1) % n] - profil[t - 1];
    if (s > max) { max = s; start = t; }
  }
  return start;
}

const _REIHENFOLGE = ['fest', 'gas', 'fw', 'oel'];

/**
 * Status der Erzeuger im Szenario.
 * @param {Array<{key:string,label:string,kw:number}>} erzeuger
 */
export function waermeErzeugerStatus(erzeuger, szenario, mitNea) {
  const sz = WAERME_SZENARIEN[szenario] || WAERME_SZENARIEN.total;
  return (erzeuger || []).map(e => {
    const traeger = WAERME_ENERGIETRAEGER[e.key] || 'strom';
    let grund = null;
    if (traeger === 'strom') grund = 'braucht Strom — das Aggregat deckt nur die Hilfsenergie';
    else if (!mitNea) grund = 'ohne Notstrom keine Pumpen und Brenner';
    else if (traeger === 'gas' && !sz.gas) grund = 'Gasversorgung fällt aus';
    else if (traeger === 'fw' && !sz.fw) grund = 'Fernwärme fällt aus';
    return { ...e, traeger, verfuegbar: !grund && e.kw > 0, grund };
  });
}

/**
 * Wärmeversorgung im Ausfall.
 * @param {object} p
 * @param {ArrayLike<number>} p.last               Netzlast der Heizzentrale (kW, stündlich)
 * @param {Array<{key:string,label:string,kw:number}>} p.erzeuger
 * @param {string} p.szenario                      'strom' | 'strom-gas' | 'total'
 * @param {number} p.dauerH
 * @param {boolean} p.mitNea                       Notstromaggregat an der Heizzentrale
 * @param {number} [p.zweistoffKw]                 Heizölleistung der Zweistoffbrenner
 * @param {number} [p.tankL]                       Heizöllager (0 = nicht angegeben)
 * @param {{kapKwh:number, entladeKw:number}|null} [p.puffer]
 * @param {number} [p.hilfsPct]
 * @param {number} [p.hilfsKw]                     fester Wert statt Prozentansatz
 */
export function waermeBlackout(p) {
  const par = p.parameter || WAERME_PARAMETER;
  const k = p.kosten || WAERME_KOSTEN;
  const last = p.last || [];
  const n = last.length;
  const sz = WAERME_SZENARIEN[p.szenario] ? p.szenario : 'total';
  const mitNea = !!p.mitNea;
  const zweistoffKw = Math.max(0, p.zweistoffKw || 0);
  const liste = [...(p.erzeuger || [])];
  // Der Zweistoffbrenner ersetzt den Gasbetrieb — nur zählen, wenn Gas fehlt
  if (zweistoffKw > 0 && !WAERME_SZENARIEN[sz].gas) liste.push({ key: 'zweistoff', label: 'Zweistoffbrenner (Heizöl)', kw: zweistoffKw });
  const status = waermeErzeugerStatus(liste, sz, mitNea);

  const kwJe = Object.fromEntries(_REIHENFOLGE.map(t => [t, 0]));
  for (const e of status) if (e.verfuegbar) kwJe[e.traeger] += e.kw;
  const kapazitaetKw = _REIHENFOLGE.reduce((s, t) => s + kwJe[t], 0);
  const puffer = mitNea && p.puffer?.kapKwh > 0 ? p.puffer : null;
  let spitzeKw = 0;
  for (let t = 0; t < n; t++) if (last[t] > spitzeKw) spitzeKw = last[t];

  const tankKwh = (p.tankL || 0) * par.heizwertKwhProL * par.kesselEta;
  const start = maxFensterStart(last, p.dauerH);

  // Stündliche Deckung ab dem ungünstigsten Start
  const simuliere = (stunden, tankBegrenzt) => {
    let soc = puffer ? puffer.kapKwh : 0;
    let oelRest = tankKwh;
    let bedarf = 0, gedeckt = 0, oelKwh = 0, stundenUngedeckt = 0, leerNachH = null, fensterSpitze = 0;
    for (let h = 0; h < stunden; h++) {
      const need = last[(start + h) % n] || 0;
      if (need > fensterSpitze) fensterSpitze = need;
      let rest = need;
      for (const tr of _REIHENFOLGE) {
        if (rest <= 0) break;
        let lieferbar = kwJe[tr];
        if (tr === 'oel' && tankBegrenzt && tankKwh > 0) lieferbar = Math.min(lieferbar, oelRest);
        const d = Math.min(rest, lieferbar);
        rest -= d;
        if (tr === 'oel') {
          oelKwh += d;
          if (tankBegrenzt && tankKwh > 0) {
            oelRest -= d;
            if (oelRest <= 1e-6 && leerNachH == null && kwJe.oel > 0) leerNachH = h + 1;
          }
        }
      }
      if (rest > 0 && soc > 0) {
        const d = Math.min(rest, soc, puffer.entladeKw);
        soc -= d; rest -= d;
      }
      bedarf += need;
      gedeckt += need - rest;
      if (rest > 1e-6) stundenUngedeckt++;
    }
    return { bedarf, gedeckt, oelKwh, stundenUngedeckt, leerNachH, fensterSpitze };
  };

  const dauer = Math.max(1, Math.min(p.dauerH || 72, n || 1));
  const fenster = n ? simuliere(dauer, true) : { bedarf: 0, gedeckt: 0, oelKwh: 0, stundenUngedeckt: 0, leerNachH: null, fensterSpitze: 0 };
  // Ölbedarf ohne Lagergrenze → Lagerempfehlung für die gewählte Dauer
  const ohneGrenze = n ? simuliere(dauer, false) : fenster;
  const oelLiterFenster = ohneGrenze.oelKwh / par.kesselEta / par.heizwertKwhProL;
  const tankEmpfehlungL = Math.ceil(oelLiterFenster * par.tankZuschlag / 100) * 100;
  let reichweiteH = null;
  if (tankKwh > 0 && kwJe.oel > 0 && n) {
    const lang = simuliere(par.horizontH, true);
    reichweiteH = lang.leerNachH ?? Infinity;
  }

  const laufendKw = kwJe.fest + kwJe.gas + kwJe.fw + kwJe.oel;
  const hilfsKw = p.hilfsKw > 0 ? p.hilfsKw : laufendKw * (p.hilfsPct ?? par.hilfsPctVorgabe) / 100;
  const neaKw = mitNea ? neaEmpfehlungKw(hilfsKw) : 0;

  const tankFehlt = Math.max(0, tankEmpfehlungL - (p.tankL || 0));
  const kosten = {
    nea: neaKosten(neaKw, 'gebaeude'),
    zweistoff: zweistoffKw > 0 ? k.zweistoffFixEur + zweistoffKw * k.zweistoffEurProKw : 0,
    tank: tankFehlt * k.tankEurProL,
  };

  return {
    szenario: sz, mitNea, start, dauerH: dauer,
    erzeuger: status, kwJeTraeger: kwJe, kapazitaetKw, spitzeKw,
    fensterSpitzeKw: fenster.fensterSpitze,
    deckungLeistungPct: spitzeKw > 0 ? Math.min(100, kapazitaetKw / spitzeKw * 100) : 100,
    deckungEnergiePct: fenster.bedarf > 0 ? fenster.gedeckt / fenster.bedarf * 100 : 100,
    bedarfKwh: fenster.bedarf, ungedecktKwh: fenster.bedarf - fenster.gedeckt,
    stundenUngedeckt: fenster.stundenUngedeckt,
    oelLiterFenster, tankEmpfehlungL, tankFehltL: tankFehlt, reichweiteH,
    awsv: Math.max(p.tankL || 0, tankEmpfehlungL) > par.awsvSchwelleL,
    hilfsKw, neaKw, kosten, kostenSumme: kosten.nea + kosten.zweistoff + kosten.tank,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Schritt 5: Schutzziele → Maßnahmen → Kosten
// ══════════════════════════════════════════════════════════════════════════
//
// Ein Schutzziel legt fest, WAS WIE LANGE versorgt werden soll: Strom für die
// Gebäude der Klasse A, der Klassen A + B oder einen Anteil der ganzen
// Liegenschaft (Insel am NAP), dazu optional die Wärme. Jedes Ziel wird mit den
// Rechnungen der Schritte 2–4 bewertet; die Matrix stellt Maßnahmen und
// Richtkosten der Ziele nebeneinander (Gutachten Kapitel 5.2).

export const ZIEL_STROM_STUFEN = Object.freeze({
  keine: 'keine Stromversorgung',
  A: 'Gebäude Klasse A',
  AB: 'Gebäude Klassen A + B',
  insel: 'Liegenschaft (Insel am NAP)',
});

export const ZIEL_VORGABEN = Object.freeze([
  Object.freeze({ id: 'z1', name: 'Kritische Funktionen',    strom: 'A',     anteilPct: 100, dauerH: 72,  waerme: true }),
  Object.freeze({ id: 'z2', name: 'Eingeschränkter Betrieb', strom: 'AB',    anteilPct: 100, dauerH: 72,  waerme: true }),
  Object.freeze({ id: 'z3', name: 'Liegenschaftsbetrieb',    strom: 'insel', anteilPct: 50,  dauerH: 168, waerme: true }),
]);

export const ZIEL_PARAMETER = Object.freeze({
  lastfaktor: 0.6,       // mittlere Auslastung der Gebäudeaggregate über das Ereignis
  sfcLproKwh: 0.28,
  tankZuschlag: 1.15,
  tankEurProL: 1.5,
  waermeErfuelltPct: 99.5,
});

export const ZIEL_STATUS = Object.freeze({
  erfuellt:  Object.freeze({ label: 'erfüllbar',    farbe: '#66bb6a' }),
  teilweise: Object.freeze({ label: 'teilweise',    farbe: '#ffa726' }),
  offen:     Object.freeze({ label: 'Daten fehlen', farbe: '#90a4ae' }),
});

const _zahl = (v, def, min, max) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Ziele aus der Projektdatei; ohne gespeicherte Liste die Vorgaben. */
export function normalisiereZiele(liste) {
  if (!Array.isArray(liste)) return ZIEL_VORGABEN.map(z => ({ ...z }));
  const ids = new Set();
  return liste.filter(z => z && typeof z === 'object').map((z, i) => {
    let id = String(z.id || `z${i + 1}`);
    while (ids.has(id)) id += '_';
    ids.add(id);
    return {
      id,
      name: String(z.name ?? '').trim() || `Schutzziel ${i + 1}`,
      strom: ZIEL_STROM_STUFEN[z.strom] ? z.strom : 'A',
      anteilPct: _zahl(z.anteilPct, 100, 5, 100),
      dauerH: _zahl(z.dauerH, 72, 1, 720),
      waerme: z.waerme !== false,
    };
  });
}

/** Gebäudeliste mit den Klassen, die für die Stromstufe zählen (Stufe A: B-Gebäude fallen heraus). */
export function zielGebaeude(gebaeude, stufe) {
  return (gebaeude || []).map(g => {
    const n = normalisiereNotstrom(g.notstrom);
    if (stufe === 'AB' || !n) return g;
    if (stufe === 'A') return n.klasse === 'B' ? { ...g, notstrom: null } : g;
    return { ...g, notstrom: null };
  });
}

export function zielKraftstoffL(spitzeKw, dauerH, par = ZIEL_PARAMETER) {
  if (!(spitzeKw > 0) || !(dauerH > 0)) return 0;
  return Math.ceil(spitzeKw * dauerH * par.lastfaktor * par.sfcLproKwh * par.tankZuschlag / 100) * 100;
}

/**
 * Ein Schutzziel bewerten.
 * @param {object} p
 * @param {object} p.ziel        normalisiertes Ziel
 * @param {object} [p.platz]     notstromPlatzierungVergleich für die Stufe A/AB
 * @param {object} [p.insel]     liegenschaftsInsel für die Stufe insel
 * @param {object} [p.waerme]    waermeBlackout mit Notstrom an der Heizzentrale
 */
export function bewerteZiel(p) {
  const par = p.parameter || ZIEL_PARAMETER;
  const z = p.ziel;
  const gruende = [];
  let offen = false, teilweise = false;
  let strom = null;

  if (z.strom === 'A' || z.strom === 'AB') {
    const v = p.platz?.varianten?.[p.platz.empfohlen];
    const aggregate = v ? v.aggregate.filter(a => a.gebaeude.length) : [];
    if (!v || !aggregate.length) {
      offen = true;
      gruende.push(`keine Gebäude der Stufe „${ZIEL_STROM_STUFEN[z.strom]}“ eingestuft`);
    } else {
      const spitze = aggregate.reduce((s, a) => s + a.peakKw, 0);
      const liter = zielKraftstoffL(spitze, z.dauerH, par);
      strom = {
        art: 'gebaeude', strategie: v.strategie,
        anzahl: v.summe.anzahl, kw: v.summe.kw, zusatzKw: v.summe.zusatzKw ?? v.summe.kw,
        abgaenge: v.summe.abgaenge, liter,
        kosten: v.summe.kosten + liter * par.tankEurProL,
        gebaeude: aggregate.reduce((s, a) => s + a.gebaeude.length, 0),
      };
      if (v.summe.ohneLast) {
        teilweise = true;
        gruende.push(`${v.summe.ohneLast} Aggregat(e) ohne Last — Verbraucher-Assets fehlen`);
      }
      if (v.nichtAmNetz?.length) gruende.push(`${v.nichtAmNetz.length} Gebäude ohne Netzanschluss im Modell`);
    }
  } else if (z.strom === 'insel') {
    const r = p.insel;
    if (!r || !(r.spitzeKw > 0)) {
      offen = true;
      gruende.push('keine Liegenschaftslast — Lastgang oder Trafos fehlen');
    } else {
      strom = {
        art: 'insel', anzahl: r.aggregate.anzahl, kvaJe: r.aggregate.kvaJe, kw: r.aggregate.pAggKw,
        mtKva: r.maschinentrafoKva, liter: r.liter, kosten: r.kosten,
        stationenAn: r.lastabwurf.versorgt.length, stationenAus: r.lastabwurf.abschalten.length,
        nsAbwurf: r.lastabwurf.nsAbwurf.length,
        pruefen: r.checkliste.filter(c => c.status === 'pruefen' || c.status === 'erneuern').length,
      };
      if (r.abReichtNicht) {
        teilweise = true;
        gruende.push('A/B-Last übersteigt den gewählten Anteil — Bemessung angehoben');
      }
    }
  }

  let waerme = null;
  if (z.waerme) {
    const w = p.waerme;
    if (!w) {
      offen = true;
      gruende.push('kein Wärme-Lastgang');
    } else {
      waerme = {
        deckungPct: w.deckungEnergiePct, leistungPct: w.deckungLeistungPct, neaKw: w.neaKw,
        zweistoffKw: w.kwJeTraeger?.oel || 0, tankL: w.tankEmpfehlungL, tankFehltL: w.tankFehltL,
        kosten: w.kostenSumme,
      };
      if (w.deckungEnergiePct < par.waermeErfuelltPct) {
        teilweise = true;
        gruende.push(`Wärme nur zu ${Math.round(w.deckungEnergiePct)} % gedeckt`);
      }
    }
  }

  const kosten = (strom?.kosten || 0) + (waerme?.kosten || 0);
  const status = offen ? 'offen' : teilweise ? 'teilweise' : 'erfuellt';
  return { ziel: z, strom, waerme, kosten, status, gruende };
}

/** Maßnahmen-Matrix: Zeilen = Maßnahmen, Spalten = Schutzziele. */
export function resilienzZielMatrix(bewertungen) {
  const fmt = v => Math.round(v || 0).toLocaleString('de-DE');
  const eur = v => (v >= 10000 ? `${fmt(v / 1000)} T€` : `${fmt(v)} €`);
  const dauer = h => (h >= 48 && h % 24 === 0 ? `${h / 24} Tage` : `${h} h`);
  const spalte = fn => bewertungen.map(b => fn(b) ?? '—');
  const zeilen = [
    { label: 'Umfang Strom', werte: spalte(b => (b.ziel.strom === 'insel'
      ? `${fmt(b.ziel.anteilPct)} % der Liegenschaft` : ZIEL_STROM_STUFEN[b.ziel.strom])) },
    { label: 'Dauer', werte: spalte(b => dauer(b.ziel.dauerH)) },
    { label: 'Notstromaggregate', werte: spalte(b => {
      const s = b.strom;
      if (!s) return null;
      if (s.art === 'insel') return `${s.anzahl} × ${fmt(s.kvaJe)} kVA am NAP`;
      return `${s.anzahl} Stück, ${fmt(s.kw)} kW` + (s.zusatzKw < s.kw ? ` (neu ${fmt(s.zusatzKw)} kW)` : '');
    }) },
    { label: 'MS-Technik', werte: spalte(b => (b.strom?.art === 'insel'
      ? `Maschinentrafo ${fmt(b.strom.mtKva)} kVA, Sternpunkt, Netztrennung` : null)) },
    { label: 'Lastabwurf', werte: spalte(b => {
      const s = b.strom;
      if (!s) return null;
      if (s.art === 'insel') {
        const teile = [
          s.stationenAus && `${s.stationenAus} ${s.stationenAus === 1 ? 'Station' : 'Stationen'} aus`,
          s.nsAbwurf && `${s.nsAbwurf} ${s.nsAbwurf === 1 ? 'NS-Abgang' : 'NS-Abgänge'} abwerfen`,
        ].filter(Boolean);
        return teile.join(', ') || 'keiner';
      }
      return s.abgaenge ? `${s.abgaenge} ${s.abgaenge === 1 ? 'Abgang' : 'Abgänge'} abschalten` : 'keiner';
    }) },
    { label: 'Kraftstofflager Strom', werte: spalte(b => (b.strom?.liter ? `${fmt(b.strom.liter)} l` : null)) },
    { label: 'Wärmedeckung', werte: spalte(b => (b.waerme ? `${fmt(b.waerme.deckungPct)} %` : null)) },
    { label: 'Notstrom Heizzentrale', werte: spalte(b => (b.waerme?.neaKw ? `${fmt(b.waerme.neaKw)} kW` : null)) },
    { label: 'Zweistoffbrenner / Heizöl', werte: spalte(b => (b.waerme
      ? [b.waerme.zweistoffKw ? `${fmt(b.waerme.zweistoffKw)} kW` : null,
         b.waerme.tankL ? `${fmt(b.waerme.tankL)} l Lager` : null].filter(Boolean).join(', ') || null
      : null)) },
    { label: 'Investition (Richtwert)', werte: spalte(b => eur(b.kosten)), highlight: true },
    { label: 'Bewertung', werte: spalte(b => ZIEL_STATUS[b.status].label + (b.gruende.length ? ` — ${b.gruende.join('; ')}` : '')) },
  ];
  return { spalten: bewertungen.map(b => b.ziel.name), zeilen };
}
