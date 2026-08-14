// ── lib/engpass-core.js — Pure Logik des zeitlichen Engpass-Sweeps ───────────
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.
// Die app-seitige Schicht (Netzberechnung, Karte) liegt in 14h-engpass-sweep.js.

// Grenzwerte (VDE-Richtwerte, konsistent zu elCalcAssets)
export const ENGPASS_GRENZEN = {
  auslastungPct: 100, // Strombelastbarkeit Iz
  deltaUKumPct:  3,   // kumulierter Spannungsfall Trafo → Stichende (DIN 18015-1)
  trafoPct:      100, // Trafo-Nennleistung
};

/**
 * Ermittelt die Jahre, in denen sich am Netz überhaupt etwas ändert ("Stützjahre").
 * Quellen: baujahr/abrissjahr von Assets und Kabeln, Jahre umgesetzter Maßnahmen.
 * Zwischen zwei solchen Ereignissen ist das Rechenergebnis konstant — es genügt
 * also, nur diese Jahre zu rechnen statt jedes einzelne.
 *
 * von, bis: Horizont (inklusive). Das Startjahr ist immer enthalten (Ist-Zustand).
 * assets, edges: Objekte mit {baujahr, abrissjahr, massnahmen}
 * jahrFn: (massnahme) => number|null — auflösen von Jahr/Phase, injizierbar
 *
 * Gibt aufsteigend sortierte, eindeutige Jahre innerhalb [von,bis] zurück.
 */
export function engpassStuetzjahre(von, bis, assets, edges, jahrFn) {
  const jf = jahrFn || (m => (m?.jahr ? parseInt(m.jahr) : null));
  const set = new Set([von]);
  const add = y => {
    const n = parseInt(y);
    if (Number.isFinite(n) && n > von && n <= bis) set.add(n);
  };
  for (const o of [...(assets || []), ...(edges || [])]) {
    add(o.baujahr);
    add(o.abrissjahr);
    for (const m of (o.massnahmen || [])) {
      if (m.status === 'umgesetzt') add(jf(m));
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Bestimmt aus einer Messreihe das erste Engpassjahr und die Ursache.
 *
 * reihe: [{ jahr, auslastungPct, deltaUKumPct }] — chronologisch
 * grenzen: optional (Default ENGPASS_GRENZEN)
 *
 * Gibt { engpassJahr, ursache, maxAuslPct, maxDuPct } zurück.
 * ursache: 'strom' | 'spannung' | 'strom+spannung' | null
 */
export function engpassBewerte(reihe, grenzen) {
  const g = grenzen || ENGPASS_GRENZEN;
  let engpassJahr = null, ursache = null, maxAuslPct = 0, maxDuPct = 0;
  for (const r of (reihe || [])) {
    const a = r.auslastungPct || 0;
    const d = r.deltaUKumPct  || 0;
    if (a > maxAuslPct) maxAuslPct = a;
    if (d > maxDuPct)   maxDuPct   = d;
    if (engpassJahr !== null) continue;
    const strom    = a > g.auslastungPct;
    const spannung = d > g.deltaUKumPct;
    if (strom || spannung) {
      engpassJahr = r.jahr;
      ursache = strom && spannung ? 'strom+spannung' : strom ? 'strom' : 'spannung';
    }
  }
  return { engpassJahr, ursache, maxAuslPct, maxDuPct };
}

/**
 * Dringlichkeitsklasse aus Engpassjahr relativ zum Bezugsjahr.
 * 'akut' (schon jetzt) | 'kurz' (<5 J) | 'mittel' (<15 J) | 'lang' | 'keiner'
 */
export function engpassKlassifiziere(engpassJahr, bezugsjahr) {
  if (engpassJahr == null) return 'keiner';
  const d = engpassJahr - bezugsjahr;
  if (d <= 0) return 'akut';
  if (d < 5)  return 'kurz';
  if (d < 15) return 'mittel';
  return 'lang';
}

// ── Maßnahmen-Vorschläge für überlastete Kabel ───────────────────────────────

// Planungs-/Beschaffungsvorlauf: so viele Jahre VOR dem Engpass muss gebaut werden
export const ENGPASS_VORLAUF_J = 2;

/**
 * Nötiger Mindest-"Leitwert" (Querschnitt × Parallelstränge) aus dem Spannungsfall.
 * ΔU ist in erster Näherung proportional zu R, also zu 1/(A·n) — um von maxDuPct
 * auf grenzDuPct zu kommen, muss A·n um genau diesen Faktor steigen.
 * Gibt 0 zurück, wenn der Spannungsfall unkritisch ist.
 */
export function engpassNoetigerLeitwert(istQs, istN, maxDuPct, grenzDuPct) {
  const g = grenzDuPct || ENGPASS_GRENZEN.deltaUKumPct;
  if (!(maxDuPct > g) || !istQs) return 0;
  return istQs * Math.max(1, istN || 1) * (maxDuPct / g);
}

/**
 * Kleinste ausreichende Kombination aus Parallelsträngen und Querschnitt.
 *
 * Reihenfolge nach Planungspraxis: ZUERST den Querschnitt eines einzelnen Kabels
 * bis zum größten verfügbaren hochfahren; reicht das nicht, einen weiteren Strang
 * legen und dessen Querschnitt wieder von unten hochfahren, usw. Es wird also die
 * Strangzahl minimiert und erst innerhalb dieser der Querschnitt.
 *
 * sections: [{ mm2, Iz, eurM }]
 * benoetigtA: höchster Strom im Horizont
 * minLeit: nötiges A·n aus dem Spannungsfall (0 = unkritisch)
 *
 * Gibt { n, sec } zurück oder null, wenn selbst maxN Stränge nicht reichen.
 */
export function engpassDimensionierung(sections, benoetigtA, minLeit, maxN) {
  const nMax = maxN || 8;
  const secs = [...(sections || [])].sort((a, b) => a.mm2 - b.mm2);
  for (let n = 1; n <= nMax; n++) {
    const sec = secs.find(s => s.Iz * n >= (benoetigtA || 0)
                            && (!minLeit || s.mm2 * n >= minLeit));
    if (sec) return { n, sec };
  }
  return null;
}

/**
 * Kosten einer Kabelmaßnahme: ALLE Stränge erhalten den neuen Querschnitt;
 * Tiefbau fällt nur für ZUSÄTZLICHE Stränge an (bestehender Graben bleibt).
 */
export function engpassKabelKosten(sec, nNeu, nIst, lengthM, tiefbauEurM) {
  const kabel   = (sec?.eurM || 0) * (lengthM || 0) * nNeu;
  const tiefbau = (tiefbauEurM || 0) * (lengthM || 0) * Math.max(0, nNeu - (nIst || 1));
  return Math.round(kabel + tiefbau);
}

/**
 * Erzeugt Ertüchtigungs-Alternativen für ein überlastetes Kabel.
 *
 * ist:    { crossSection, nParallel, cableType, lengthM }
 * bedarf: { benoetigtA, maxDuPct }   — Maxima über den RESTLICHEN Horizont,
 *                                      damit nicht zweimal gebaut werden muss
 * params: { typen, tiefbauEurM, grenzDuPct, maxN }
 *          typen = { NAYY: { sections }, NYY: { sections } } (injiziert → testbar)
 *
 * Je Kabeltyp entsteht genau EINE sinnvoll dimensionierte Variante (kleinste
 * Strangzahl, darin kleinster Querschnitt) — der eigene Typ zuerst, die übrigen
 * als Materialalternative. Dazu Lastmanagement als Referenz ohne Bauleistung.
 *
 * Rückgabe: [{ id, label, typ, investEUR, newProps, deckungOk, nParallel }]
 */
export function engpassKabelAlternativen(ist, bedarf, params) {
  const { crossSection = 0, nParallel = 1, cableType = 'NAYY', lengthM = 0 } = ist || {};
  const { benoetigtA = 0, maxDuPct = 0 } = bedarf || {};
  const { typen = {}, tiefbauEurM = 100, grenzDuPct, maxN } = params || {};

  const nIst    = Math.max(1, nParallel);
  const minLeit = engpassNoetigerLeitwert(crossSection, nIst, maxDuPct, grenzDuPct);
  const alt     = [];

  // Eigener Kabeltyp zuerst, danach die übrigen als Materialalternative
  const reihenfolge = [cableType, ...Object.keys(typen).filter(t => t !== cableType)];

  for (const typ of reihenfolge) {
    const def = typen[typ];
    if (!def?.sections?.length) continue;
    const dim = engpassDimensionierung(def.sections, benoetigtA, minLeit, maxN);
    if (!dim) continue;
    const gleicherTyp = typ === cableType;
    // Keine Verschlechterung / Nulländerung vorschlagen
    if (gleicherTyp && dim.n === nIst && dim.sec.mm2 <= crossSection) continue;

    const zusatz = dim.n - nIst;
    const label = dim.n > 1
      ? `${dim.n} × ${dim.sec.mm2} mm²${gleicherTyp ? '' : ' ' + typ}`
        + (zusatz > 0 ? ` (+${zusatz} ${zusatz > 1 ? 'Stränge' : 'Strang'})` : ' (gleicher Graben)')
      : `Querschnitt ${crossSection} → ${dim.sec.mm2} mm²${gleicherTyp ? '' : ' ' + typ} (gleicher Graben)`;

    alt.push({
      id: `${typ}_${dim.n}x${dim.sec.mm2}`,
      label,
      typ: zusatz > 0 ? 'Verlegung' : (gleicherTyp ? 'Ertuechtigung' : 'Austausch'),
      investEUR: engpassKabelKosten(dim.sec, dim.n, nIst, lengthM, tiefbauEurM),
      newProps: gleicherTyp
        ? { crossSection: dim.sec.mm2, nParallel: dim.n }
        : { cableType: typ, crossSection: dim.sec.mm2, nParallel: dim.n },
      deckungOk: true,
      nParallel: dim.n,
      gleicherTyp,
    });
  }

  // Lastmanagement/Abregelung — Referenzoption ohne Bauleistung
  alt.push({
    id: 'lastmanagement',
    label: 'Lastmanagement statt Ausbau (kein Bau)',
    typ: 'abregelung', investEUR: 0, newProps: {}, deckungOk: false,
  });

  // Eigener Kabeltyp zuerst, dann weniger Parallelstränge, dann günstiger
  return alt.sort((a, b) =>
    (a.gleicherTyp ? 0 : 1) - (b.gleicherTyp ? 0 : 1)
    || (a.nParallel ?? 99) - (b.nParallel ?? 99)
    || a.investEUR - b.investEUR);
}

/**
 * Wählt die Alternative, die automatisch eingeplant wird.
 *
 * Vorrang hat der BESTEHENDE Kabeltyp — ein Materialwechsel (Alu → Kupfer) wird
 * angeboten, aber nicht stillschweigend eingeplant, auch wenn er rechnerisch
 * günstiger wäre. Innerhalb des Typs: möglichst wenige Parallelstränge, dann Kosten.
 * Gibt null zurück, wenn keine Bau-Alternative ausreicht (dann bleibt nur Lastmanagement).
 */
export function engpassWaehleAlternative(alternativen) {
  const ok = (alternativen || []).filter(a => a.deckungOk);
  if (!ok.length) return null;
  return ok.sort((a, b) =>
    (a.gleicherTyp ? 0 : 1) - (b.gleicherTyp ? 0 : 1)
    || (a.nParallel ?? 99) - (b.nParallel ?? 99)
    || a.investEUR - b.investEUR)[0];
}

/**
 * Umsetzungsjahr einer Maßnahme: so viele Jahre vor dem Engpass, wie Vorlauf nötig ist —
 * aber nie vor dem Bezugsjahr (Vergangenheit lässt sich nicht beplanen).
 */
export function engpassMassnahmeJahr(engpassJahr, bezugsjahr, vorlaufJ) {
  if (engpassJahr == null) return null;
  const v = vorlaufJ != null ? vorlaufJ : ENGPASS_VORLAUF_J;
  return Math.max(bezugsjahr, engpassJahr - v);
}
