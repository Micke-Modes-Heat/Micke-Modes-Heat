// ── lib/pv-bestand-ausbau.js — PV-Ausbau im Bestand: wann reißt welche Grenze? ──
//
// Die Variantenansicht (Abb. 6) beantwortete nur „rot oder grün" für fünf feste
// Auslegungen. Die Frage des Netzplaners ist eine andere: Wie belastet der
// PV-Ausbau den Bestand NACH UND NACH, und an welcher Stelle wird welche
// Ertüchtigung fällig? Dieses Modul liefert dafür die Treppe:
//
//   Rückspeisespitze P_rück(kWp)  ──►  gegen jede Bestandsgrenze
//     • Trafo (Summe der Bestandstrafos × Rückspeisefaktor)
//     • NAP-Einspeisezusage (vorgelagerter Netzbetreiber)
//     • Spannungsband  S_zul = Δu_zul · S_k″  (Screening, cos φ ≈ 1)
//
// und für einen Ausbaustand die Auslastung je Grenze, die fälligen Maßnahmen
// und zwei Lösungswege im Kostenvergleich:
//   bestand — jede gerissene Grenze einzeln ertüchtigen
//   hybrid  — den Bestand bis zur ersten Grenze ausnutzen, den Rest über ein
//             eigenes Erzeugungsnetz abführen (Sprungkostenblock)
//
// Die Kostensätze kommen aus lib/netz-schwellen.js, damit die Schwellentreppe
// (13z) und diese Ansicht dieselben Zahlen verwenden. Importiert nur Libs,
// kein DOM → direkt testbar.

import { SCHWELLEN_KOSTEN, TRAFO_RUECK_FAKTOR } from './netz-schwellen.js';

/** Ab dieser Auslastung gilt eine Grenze als „eng" (Vorwarnung). */
export const AUSLASTUNG_ENG = 0.7;

const _rund = n => Math.round(n);

/**
 * Die Grenzen des Bestands, aufsteigend nach tragbarer Rückspeiseleistung.
 * Unbekannte Grenzen (0/leer) fallen weg — lieber keine Aussage als eine
 * erfundene.
 *
 * @param {{ trafoKva?:number, napKw?:number|null, skKva?:number, uBudgetPct?:number }} e
 * @returns {Array<{ id:'trafo'|'nap'|'du', label:string, kurz:string, kapKw:number, loesung:string }>}
 */
export function bestandsGrenzen({ trafoKva = 0, napKw = null, skKva = 0, uBudgetPct = 3 } = {}) {
  const g = [];
  if (trafoKva > 0) {
    g.push({
      id: 'trafo', label: 'Trafoleistung Bestand', kurz: 'Trafo',
      kapKw: trafoKva * TRAFO_RUECK_FAKTOR, kva: trafoKva,
      loesung: 'Trafo verstärken bzw. zusätzlichen Trafo setzen',
    });
  }
  if (napKw != null && napKw > 0) {
    g.push({
      id: 'nap', label: 'Einspeisezusage NAP', kurz: 'NAP',
      kapKw: napKw,
      loesung: 'Höhere Einspeisezusage beim Netzbetreiber beantragen',
    });
  }
  if (skKva > 0 && uBudgetPct > 0) {
    g.push({
      id: 'du', label: `Spannungsband (Δu ${uBudgetPct} %)`, kurz: 'Δu',
      kapKw: uBudgetPct / 100 * skKva,
      loesung: 'Eigenes Erzeugungsnetz bzw. verstärkte MS-Anbindung',
    });
  }
  return g.sort((a, b) => a.kapKw - b.kapKw);
}

/**
 * Auslastung einer Grenze bei gegebener Rückspeisespitze.
 * @returns {{ quote:number, reserveKw:number, stufe:'frei'|'eng'|'ueber' }}
 */
export function auslastung(rueckKw, grenze) {
  const quote = grenze.kapKw > 0 ? rueckKw / grenze.kapKw : 0;
  const stufe = quote > 1 ? 'ueber' : quote >= AUSLASTUNG_ENG ? 'eng' : 'frei';
  return { quote, reserveKw: grenze.kapKw - rueckKw, stufe };
}

/**
 * Maßnahme und Kosten, um eine gerissene Grenze zu ertüchtigen.
 * null, solange die Grenze trägt.
 */
export function ertuechtigung(rueckKw, grenze, kosten = SCHWELLEN_KOSTEN) {
  const ueberKw = rueckKw - grenze.kapKw;
  if (!(ueberKw > 0)) return null;
  if (grenze.id === 'trafo') {
    const noetigKva = rueckKw / TRAFO_RUECK_FAKTOR;
    const zusatzKva = Math.max(0, noetigKva - grenze.kva);
    return {
      ueberKw, titel: `Trafo ${_rund(grenze.kva)} → ${Math.ceil(noetigKva)} kVA`,
      kostenEUR: _rund(zusatzKva * kosten.trafoEurProKVA),
    };
  }
  if (grenze.id === 'nap') {
    return {
      ueberKw, titel: `Einspeisezusage NAP +${_rund(ueberKw)} kW`,
      kostenEUR: _rund(ueberKw * kosten.napEurProKW),
      hinweis: 'Zusage des vorgelagerten Netzbetreibers nötig — nicht allein planbar.',
    };
  }
  // Spannungsband: mit Trafo und Zusage nicht lösbar — der Überschuss braucht
  // einen eigenen Weg ins MS-Netz.
  return {
    ueberKw, titel: `Erzeugungsnetz / MS-Anbindung für ${_rund(ueberKw)} kW`,
    kostenEUR: _rund(ueberKw * kosten.erzeugungsnetzEurProKW),
  };
}

/**
 * Ausbaustand auswerten: Auslastung je Grenze, fällige Maßnahmen und die
 * beiden Lösungswege.
 *
 * @param {number} rueckKw  Rückspeisespitze am NAP
 * @param {ReturnType<typeof bestandsGrenzen>} grenzen
 */
export function ausbauStand(rueckKw, grenzen, kosten = SCHWELLEN_KOSTEN) {
  const komponenten = grenzen.map(g => ({
    ...g, ...auslastung(rueckKw, g), massnahme: ertuechtigung(rueckKw, g, kosten),
  }));
  const massnahmen = komponenten.filter(k => k.massnahme);
  const bestandEUR = massnahmen.reduce((s, k) => s + k.massnahme.kostenEUR, 0);

  // Hybrid: die kleinste Grenze bestimmt, was der Bestand ohne Eingriff trägt
  const tragKw = grenzen.length ? grenzen[0].kapKw : Infinity;
  const restKw = Math.max(0, rueckKw - tragKw);
  const hybridEUR = _rund(restKw * kosten.erzeugungsnetzEurProKW);

  const stufe = komponenten.some(k => k.stufe === 'ueber') ? 'ueber'
              : komponenten.some(k => k.stufe === 'eng')   ? 'eng' : 'frei';
  const guenstiger = !massnahmen.length ? null
                   : (hybridEUR < bestandEUR ? 'hybrid' : 'bestand');

  return {
    rueckKw, komponenten, stufe,
    bindend: komponenten.find(k => k.stufe === 'ueber') || null,
    naechste: komponenten.find(k => k.stufe !== 'ueber') || null,
    wege: {
      bestand: { kostenEUR: bestandEUR, schritte: massnahmen.map(k => ({ id: k.id, ...k.massnahme })) },
      hybrid:  { kostenEUR: hybridEUR, tragKw: Number.isFinite(tragKw) ? tragKw : null, restKw },
    },
    guenstiger,
  };
}

/**
 * Erste PV-Leistung, bei der die Kurve einen Wert überschreitet (lineare
 * Interpolation zwischen den Stützstellen). null = wird im Bereich nie erreicht.
 *
 * @param {Array<{kwp:number, rueckKw:number}>} punkte  aufsteigend nach kwp
 */
export function kwpBeiRueck(punkte, schwelleKw) {
  if (!punkte?.length) return null;
  if (punkte[0].rueckKw > schwelleKw) return punkte[0].kwp;
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1], b = punkte[i];
    if (b.rueckKw > schwelleKw) {
      const d = b.rueckKw - a.rueckKw;
      const f = d > 0 ? (schwelleKw - a.rueckKw) / d : 1;
      return a.kwp + Math.max(0, Math.min(1, f)) * (b.kwp - a.kwp);
    }
  }
  return null;
}

/**
 * Die Ertüchtigungs-Treppe über den gesamten Ausbaupfad: je Grenze die
 * PV-Leistung, ab der sie eng wird und ab der sie reißt — in der Reihenfolge,
 * in der der Ausbau sie trifft.
 */
export function ausbauTreppe(punkte, grenzen) {
  return grenzen
    .map(g => ({
      ...g,
      engAbKwp: kwpBeiRueck(punkte, g.kapKw * AUSLASTUNG_ENG),
      abKwp:    kwpBeiRueck(punkte, g.kapKw),
    }))
    .sort((a, b) => (a.abKwp ?? Infinity) - (b.abKwp ?? Infinity) || a.kapKw - b.kapKw);
}

// ── Kartenansicht: Ausbau Anlage für Anlage, Belastung je Trafo ─────────────

const _SCHICHT_RANG = { bestand: 0, entwicklung: 1, entscheidung: 2 };

/**
 * Reihenfolge, in der die Anlagen zugeschaltet werden. Was heute steht
 * (Schicht „Bestand"), kommt immer zuerst — es belastet das Netz bereits.
 *
 * modus: 'schicht' — Bestand, Entwicklung, Planung; darin große Anlagen zuerst
 *        'gross'   — nach dem Bestand die größten Anlagen zuerst
 *        'klein'   — nach dem Bestand die kleinsten zuerst
 *
 * @param {Array<{ id:string, kwp:number, schicht?:string }>} anlagen
 */
export function ausbauReihenfolge(anlagen, modus = 'schicht') {
  const rang = a => _SCHICHT_RANG[a.schicht] ?? 0;
  return [...(anlagen || [])].sort((a, b) => {
    const ba = rang(a) === 0 ? 0 : 1, bb = rang(b) === 0 ? 0 : 1;
    if (ba !== bb) return ba - bb;
    if (modus === 'schicht' && rang(a) !== rang(b)) return rang(a) - rang(b);
    return modus === 'klein' ? a.kwp - b.kwp : b.kwp - a.kwp;
  });
}

/**
 * Verteilt die Rückspeisespitze am NAP auf die Bestandstrafos.
 *
 * Screening, kein Lastfluss: jeder Trafo bekommt den Anteil der Spitze, der
 * seinem Anteil an der gebauten PV-Leistung entspricht. PV ohne Kabelweg zu
 * einem Trafo wird nach Trafoleistung aufgeteilt und als geschätzt markiert.
 * Die Summe über alle Trafos ist damit die Spitze aus Abb. 6.
 *
 * @param {Array<{ kwp:number, trafoId:string|null }>} gebaut  zugeschaltete Anlagen
 * @param {Array<{ id:string, name?:string, kva:number }>} trafos
 * @param {number} rueckKw  Rückspeisespitze am NAP
 * @returns {Map<string, { id, name, kva, kwp, rueckKw, geschaetztKw, kapKw, quote, stufe, massnahme }>}
 */
export function trafoBelastung(gebaut, trafos, rueckKw, kosten = SCHWELLEN_KOSTEN) {
  const out = new Map();
  const liste = (trafos || []).filter(t => t.kva > 0);
  const kvaSumme = liste.reduce((s, t) => s + t.kva, 0);
  const kwpGesamt = (gebaut || []).reduce((s, a) => s + (a.kwp || 0), 0);
  const kwpJe = new Map(liste.map(t => [t.id, 0]));
  let ohneKwp = 0;
  for (const a of (gebaut || [])) {
    if (a.trafoId != null && kwpJe.has(a.trafoId)) kwpJe.set(a.trafoId, kwpJe.get(a.trafoId) + (a.kwp || 0));
    else ohneKwp += a.kwp || 0;
  }
  const kwJeKwp = kwpGesamt > 0 ? rueckKw / kwpGesamt : 0;
  for (const t of liste) {
    const eigenKw = kwpJe.get(t.id) * kwJeKwp;
    const geschaetztKw = kvaSumme > 0 ? ohneKwp * kwJeKwp * t.kva / kvaSumme : 0;
    const g = { id: 'trafo', kapKw: t.kva * TRAFO_RUECK_FAKTOR, kva: t.kva };
    const last = eigenKw + geschaetztKw;
    out.set(t.id, {
      id: t.id, name: t.name || t.id, kva: t.kva, kwp: kwpJe.get(t.id),
      rueckKw: last, geschaetztKw, kapKw: g.kapKw,
      ...auslastung(last, g), massnahme: ertuechtigung(last, g, kosten),
    });
  }
  return out;
}

// ── Beschlussreife: welche PV zuerst? ────────────────────────────────────────
//
// Mit einem gemeinsamen Lastgang und einem PV-Profil ist jede kWp gleich viel
// wert — die Anlagen unterscheiden sich für den Beschluss nur darin, ob sie
// Pflicht sind, ob das Netz sie ohne Eingriff trägt und was sie an
// Ertüchtigung auslösen. Daraus die Klassen:
//
//   bestand — steht schon
//   pflicht — muss nach Landesrecht kommen; löst sie etwas aus, ist die
//             Maßnahme unvermeidbar
//   A       — rechnet sich und passt in die heutige Reserve (ohne Reue)
//   B       — rechnet sich auch mit der Ertüchtigung, die sie auslöst — die
//             Maßnahme wird mitbeschlossen; Anlagen, die danach in die neue
//             Reserve passen, teilen sie sich
//   C       — zurückstellen: unwirtschaftlich oder die Ertüchtigung trägt sich
//             nicht
//
// Geprüft wird je Trafo (trafoBelastung), am NAP und gegen das Spannungsband.

/** Normstufen von Verteiltransformatoren (kVA). */
export const TRAFO_NORMSTUFEN_KVA = [100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500];

/** Kleinste Normstufe ≥ kva; darüber in 500-kVA-Schritten. */
export function naechsteTrafoStufe(kva, stufen = TRAFO_NORMSTUFEN_KVA) {
  if (!(kva > 0)) return 0;
  return stufen.find(s => s >= kva - 1e-9) ?? Math.ceil(kva / 500) * 500;
}

/** Annuitätenfaktor. */
export function annuitaet(zins, jahre) {
  if (!(zins > 0)) return 1 / jahre;
  const q = Math.pow(1 + zins, jahre);
  return zins * q / (q - 1);
}

/**
 * @param {{
 *   anlagen: Array<{ id:string, kwp:number, trafoId:string|null, schicht?:string, pflicht?:boolean }>,
 *   trafos: Array<{ id:string, name?:string, kva:number }>,
 *   rueckBeiKwp: (kwp:number) => number,
 *   napKw?: number|null, duKw?: number|null,
 *   nutzenJeKwp: (kwp:number) => number,   // €/a je zusätzlicher kWp bei Gesamtleistung kwp
 *   zins?: number, lebensdauer?: number, kosten?: typeof SCHWELLEN_KOSTEN,
 * }} e
 */
export function beschlussReife(e) {
  const kosten = e.kosten || SCHWELLEN_KOSTEN;
  const annF = annuitaet(e.zins ?? 0.035, e.lebensdauer ?? 30);
  const cap = new Map((e.trafos || []).map(t => [t.id, t.kva]));
  const namen = new Map((e.trafos || []).map(t => [t.id, t.name || t.id]));
  let napCap = e.napKw > 0 ? e.napKw : Infinity;
  let duCap  = e.duKw  > 0 ? e.duKw  : Infinity;

  const gebaut = [];
  const liste = [];
  const massnahmen = [];
  const kwpVon = arr => arr.reduce((s, a) => s + a.kwp, 0);
  const trafoListe = () => [...cap].map(([id, kva]) => ({ id, name: namen.get(id), kva }));

  /** Verletzungen, wenn `menge` zusätzlich gebaut wäre. */
  function verletzungen(menge) {
    const alle = [...gebaut, ...menge];
    const kwp = kwpVon(alle);
    const rueck = kwp > 0 ? e.rueckBeiKwp(kwp) : 0;
    const out = [];
    for (const t of trafoBelastung(alle, trafoListe(), rueck).values()) {
      if (t.quote > 1 + 1e-9) out.push({ art: 'trafo', id: t.id, name: t.name, alt: t.kva, noetigKw: t.rueckKw });
    }
    if (rueck > napCap + 1e-9) out.push({ art: 'nap', alt: napCap, noetigKw: rueck });
    if (rueck > duCap + 1e-9)  out.push({ art: 'du',  alt: duCap,  noetigKw: rueck });
    return out;
  }

  /** Maßnahme zu einer Verletzung: neue Kapazität, Investition, Titel. */
  function massnahmeFuer(v) {
    if (v.art === 'trafo') {
      const neu = naechsteTrafoStufe(v.noetigKw / TRAFO_RUECK_FAKTOR);
      return { ...v, neu, investEUR: _rund((neu - v.alt) * kosten.trafoEurProKVA),
               titel: `${v.name}: ${_rund(v.alt)} → ${neu} kVA` };
    }
    const neu = Math.ceil(v.noetigKw);
    const satz = v.art === 'nap' ? kosten.napEurProKW : kosten.erzeugungsnetzEurProKW;
    return { ...v, neu, investEUR: _rund((neu - v.alt) * satz),
             titel: v.art === 'nap' ? `Einspeisezusage NAP ${_rund(v.alt)} → ${neu} kW`
                                    : `Erzeugungsnetz / MS-Anbindung +${_rund(neu - v.alt)} kW` };
  }

  function umsetzen(ms) {
    for (const m of ms) {
      if (m.art === 'trafo') cap.set(m.id, Math.max(cap.get(m.id), m.neu));
      else if (m.art === 'nap') napCap = Math.max(napCap, m.neu);
      else duCap = Math.max(duCap, m.neu);
      massnahmen.push(m);
    }
  }

  /** Solange bauen, bis nichts mehr verletzt ist (Kaskade: Trafo, dann NAP …). */
  function erzwingen(menge) {
    const ms = [];
    for (let i = 0; i < 6; i++) {
      const v = verletzungen(menge);
      if (!v.length) break;
      const neu = v.map(massnahmeFuer);
      umsetzen(neu);
      ms.push(...neu);
    }
    return ms;
  }

  const eintragen = (a, klasse, grund, ms = []) => {
    gebaut.push(a);
    liste.push({ anlage: a, klasse, grund, massnahmen: ms, kumKwp: kwpVon(gebaut) });
  };

  // 0) Bestand — steht schon. Ist er heute schon überlastet, ist das die erste Maßnahme.
  const rest = [];
  for (const a of e.anlagen || []) (a.schicht === 'bestand' ? gebaut : rest).push(a);
  for (const a of gebaut) liste.push({ anlage: a, klasse: 'bestand', grund: 'Bestandsanlage', massnahmen: [], kumKwp: 0 });
  let kum = 0;
  for (const l of liste) { kum += l.anlage.kwp; l.kumKwp = kum; }
  const bestandMs = erzwingen([]);
  if (bestandMs.length && liste.length) {
    liste[liste.length - 1].massnahmen = bestandMs;
    liste[liste.length - 1].grund = 'Bestand ist heute schon überlastet';
  }

  // 1) Pflicht — kommt ohnehin
  const pflicht = rest.filter(a => a.pflicht).sort((a, b) => b.kwp - a.kwp);
  let offen = rest.filter(a => !a.pflicht);
  for (const a of pflicht) {
    const ms = erzwingen([a]);
    eintragen(a, 'pflicht', ms.length ? 'PV-Pflicht — Maßnahme unvermeidbar' : 'PV-Pflicht, passt ins Netz', ms);
  }

  // 2) A — rechnet sich und passt ohne Eingriff
  offen.sort((a, b) => b.kwp - a.kwp);
  for (;;) {
    const nutzen = e.nutzenJeKwp(kwpVon(gebaut));
    if (!(nutzen > 0)) break;
    const i = offen.findIndex(a => !verletzungen([a]).length);
    if (i < 0) break;
    const [a] = offen.splice(i, 1);
    eintragen(a, 'A', `passt in die Reserve · ${_rund(nutzen)} €/a je kWp`);
  }

  // 3) B / C — Ertüchtigung gegen den Nutzen der Anlagen, die sie ermöglicht
  let geaendert = true;
  while (geaendert && offen.length) {
    geaendert = false;
    for (let i = 0; i < offen.length; i++) {
      const a = offen[i];
      const kwp0 = kwpVon(gebaut);
      const nutzen = e.nutzenJeKwp(kwp0);
      if (!(nutzen > 0)) break;
      if (!verletzungen([a]).length) {           // passt dank einer früheren Maßnahme
        offen.splice(i, 1);
        eintragen(a, 'B', `nutzt die Reserve einer beschlossenen Ertüchtigung`);
        geaendert = true; break;
      }
      // Probeweise ertüchtigen und sehen, wer die Maßnahme mitnutzen kann
      const vorher = { cap: new Map(cap), napCap, duCap, nMs: massnahmen.length };
      const ms = erzwingen([a]);
      const gruppe = [a];
      for (const b of offen) {
        if (b !== a && !verletzungen([...gruppe, b]).length) gruppe.push(b);
      }
      const invest = ms.reduce((s, m) => s + m.investEUR, 0);
      const kwpGruppe = kwpVon(gruppe);
      const nutzenGruppe = e.nutzenJeKwp(kwp0 + kwpGruppe / 2) * kwpGruppe;
      const kostenJahr = invest * annF;
      if (nutzenGruppe >= kostenJahr) {
        offen = offen.filter(x => !gruppe.includes(x));
        eintragen(a, 'B', `Ertüchtigung trägt sich: ${_rund(nutzenGruppe)} €/a Nutzen für ${_rund(kwpGruppe)} kWp`
          + ` ≥ ${_rund(kostenJahr)} €/a Kosten`, ms);
        for (const b of gruppe.slice(1)) eintragen(b, 'B', 'teilt sich die Ertüchtigung davor');
        geaendert = true; break;
      }
      // Rückgängig: die Maßnahme lohnt nicht
      for (const [id, kva] of vorher.cap) cap.set(id, kva);
      napCap = vorher.napCap; duCap = vorher.duCap; massnahmen.length = vorher.nMs;
    }
  }

  // 4) Rest — zurückstellen
  for (const a of offen) {
    const nutzen = e.nutzenJeKwp(kwpVon(gebaut));
    const v = verletzungen([a]);
    liste.push({
      anlage: a, klasse: 'C', massnahmen: [], kumKwp: null,
      grund: !(nutzen > 0) ? 'weitere PV rechnet sich nicht mehr'
           : `die nötige Ertüchtigung (${v.map(x => x.art === 'trafo' ? x.name : x.art.toUpperCase()).join(', ')}) trägt sich nicht`,
    });
  }

  const zaehl = k => liste.filter(l => l.klasse === k).length;
  return {
    liste, massnahmen,
    summe: { A: zaehl('A'), B: zaehl('B'), C: zaehl('C'), pflicht: zaehl('pflicht'),
             investEUR: massnahmen.reduce((s, m) => s + m.investEUR, 0) },
  };
}

// ── Auslegung im Neubaugebiet: jetzt größer oder später nachrüsten? ──────────
//
// Für Trafos, die noch gebaut werden (Schicht Entwicklung/Planung), gibt es
// keine Ertüchtigung, sondern eine Auslegung. Maßgeblich ist der Endausbau
// in BEIDEN Richtungen: Rückspeisung (PV, Sommermittag) und Bezug
// (Wärmepumpen, Ladepunkte, Verbraucher; Winterabend). Das Jahr, in dem die
// geplante Größe reißt, kommt aus dem Ausbaupfad: jede Anlage und jeder
// Verbraucher trägt sein Baujahr.
//
// Vergleich: Mehrkosten der größeren Stufe JETZT gegen den Barwert eines
// späteren Tauschs (neuer Trafo plus Tauschaufschlag für Montage, Umschluss
// und den nicht mehr genutzten alten Trafo).

/**
 * @param {{
 *   trafos: Array<{ id:string, name?:string, kva:number, neubau:boolean }>,
 *   anlagen: Array<{ kwp:number, trafoId:string|null, jahr:number }>,
 *   lasten?: Array<{ kw:number, trafoId:string|null, jahr:number }>,
 *   rueckBeiKwp: (kwp:number) => number,
 *   heute: number, zins?: number, gzf?: number, tauschAufschlag?: number,
 *   trafoPreis: (kva:number) => number,
 * }} e
 */
export function neubauAuslegung(e) {
  const zins = e.zins ?? 0.035, gzf = e.gzf ?? 0.7, aufschlag = e.tauschAufschlag ?? 0.3;
  const lasten = e.lasten || [];
  const jahre = [...new Set([e.heute, ...e.anlagen.map(a => a.jahr), ...lasten.map(l => l.jahr)])]
    .filter(Number.isFinite).sort((a, b) => a - b);
  const alleTrafos = e.trafos.map(t => ({ id: t.id, name: t.name, kva: t.kva > 0 ? t.kva : 1e9 }));

  // Zeitreihe je Trafo: Rückspeisung und Bezug in jedem Stichjahr
  const verlauf = new Map(e.trafos.map(t => [t.id, []]));
  for (const y of jahre) {
    const gebaut = e.anlagen.filter(a => a.jahr <= y);
    const kwp = gebaut.reduce((s, a) => s + a.kwp, 0);
    const rueck = kwp > 0 ? e.rueckBeiKwp(kwp) : 0;
    const bel = trafoBelastung(gebaut, alleTrafos, rueck);
    for (const t of e.trafos) {
      const bezugKw = gzf * lasten.filter(l => l.jahr <= y && l.trafoId === t.id).reduce((s, l) => s + l.kw, 0);
      verlauf.get(t.id).push({ jahr: y, rueckKw: bel.get(t.id)?.rueckKw || 0, bezugKw });
    }
  }

  return e.trafos.filter(t => t.neubau).map(t => {
    const v = verlauf.get(t.id);
    const bedarfKva = r => Math.max(r.rueckKw, r.bezugKw) / TRAFO_RUECK_FAKTOR;
    const endeKva = Math.max(0, ...v.map(bedarfKva));
    const massgeblich = v.reduce((m, r) => (bedarfKva(r) > bedarfKva(m) ? r : m), v[0] || { rueckKw: 0, bezugKw: 0 });
    const richtung = massgeblich.rueckKw >= massgeblich.bezugKw ? 'rueck' : 'bezug';
    const empfKva = Math.max(naechsteTrafoStufe(endeKva), t.kva > 0 ? t.kva : 0);
    const basis = { id: t.id, name: t.name || t.id, geplantKva: t.kva, endeKva, empfKva, richtung,
                    verlauf: v, endeRueckKw: massgeblich.rueckKw, endeBezugKw: massgeblich.bezugKw };

    if (!(t.kva > 0)) {
      return { ...basis, urteil: 'dimensionieren', jahrUeber: null,
               text: `noch nicht dimensioniert — auf ${empfKva} kVA auslegen` };
    }
    const ueber = v.find(r => bedarfKva(r) > t.kva + 1e-9);
    if (!ueber) {
      return { ...basis, urteil: 'passt', jahrUeber: null,
               text: `${t.kva} kVA tragen den Endausbau (${Math.round(endeKva)} kVA nötig)` };
    }
    const mehrJetzt = Math.max(0, e.trafoPreis(empfKva) - e.trafoPreis(t.kva));
    const spaeter = e.trafoPreis(empfKva) * (1 + aufschlag);
    const nJahre = Math.max(0, ueber.jahr - e.heute);
    const barwert = spaeter / Math.pow(1 + zins, nJahre);
    const jetzt = mehrJetzt <= barwert;
    return {
      ...basis, jahrUeber: ueber.jahr, mehrJetztEUR: Math.round(mehrJetzt),
      spaeterEUR: Math.round(spaeter), barwertEUR: Math.round(barwert),
      vorteilEUR: Math.round(Math.abs(barwert - mehrJetzt)),
      urteil: jetzt ? 'jetzt-groesser' : 'spaeter',
      text: jetzt
        ? `jetzt auf ${empfKva} statt ${t.kva} kVA auslegen — sonst Tausch ${ueber.jahr}`
        : `${t.kva} kVA bauen, Tausch ${ueber.jahr} ist günstiger`,
    };
  });
}
