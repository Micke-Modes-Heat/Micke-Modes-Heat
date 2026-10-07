// ── lib/trafo-parallel.js — Trafos an einem gemeinsamen Niederspannungsnetz ──
// Zwei (oder mehr) Trafos, deren NS-Seiten zusammenhängen — typisch: beide auf
// dieselbe NSHV —, bilden eine Gruppe. Jeder Trafo sieht dieselbe Last dahinter;
// wie viel davon er tatsächlich trägt, hängt von der Betriebsart ab:
//
//  • n1 (redundant): Ausfall des größten anderen Trafos der Gruppe — die übrigen
//    tragen alles. Bei zwei Trafos trägt jeder 100 %. Bewertet die Reserve.
//  • parallel: Normalbetrieb, die Last verteilt sich nach Sr / uk (gleiche
//    Übersetzung und Schaltgruppe vorausgesetzt). Bei zwei gleichen Trafos 50/50.
//
// Beide Werte werden immer berechnet; die Betriebsart legt nur fest, welcher
// davon als Auslastung des Trafos gilt.

export const BETRIEBSART_VORGABE = 'n1';
export const UK_VORGABE_PCT = 4;     // wie Inspector, Schaltbild, Kompaktstation

export const BETRIEBSARTEN = [
  { value: 'n1',       label: 'Redundant (N-1) — ein Trafo trägt alles' },
  { value: 'parallel', label: 'Parallelbetrieb — Last wird aufgeteilt' },
];

export function normBetriebsart(v) {
  return v === 'parallel' ? 'parallel' : v === 'n1' ? 'n1' : null;
}

/** Betriebsart einer Gruppe: erster gesetzter Wert, sonst die Vorgabe. */
export function gruppenBetriebsart(werte) {
  for (const w of werte || []) {
    const n = normBetriebsart(w);
    if (n) return n;
  }
  return BETRIEBSART_VORGABE;
}

/**
 * Trafos gruppieren, deren NS-seitig erreichte Knoten sich überschneiden.
 * @param {Map<any, Set<any>>} reichweite  Trafo-ID → erreichte Knoten (ohne Trafo selbst)
 * @returns {Array<Array<any>>}  Gruppen in Eingabereihenfolge, Einzeltrafos als 1er-Gruppe
 */
export function trafoGruppen(reichweite) {
  const ids = [...reichweite.keys()];
  const eltern = new Map(ids.map(id => [id, id]));
  const wurzel = id => {
    while (eltern.get(id) !== id) { eltern.set(id, eltern.get(eltern.get(id))); id = eltern.get(id); }
    return id;
  };
  const besitzer = new Map();          // Knoten → erster Trafo, der ihn erreicht
  for (const id of ids) {
    for (const k of reichweite.get(id) || []) {
      const b = besitzer.get(k);
      if (b === undefined) { besitzer.set(k, id); continue; }
      const ra = wurzel(b), rb = wurzel(id);
      if (ra !== rb) eltern.set(rb, ra);
    }
  }
  const gruppen = new Map();
  for (const id of ids) {
    const r = wurzel(id);
    if (!gruppen.has(r)) gruppen.set(r, []);
    gruppen.get(r).push(id);
  }
  return [...gruppen.values()];
}

const _zahl = (v, d) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : d;
};

/**
 * Last einer Gruppe auf ihre Trafos verteilen.
 * @param {Array<{id:any, kva:number, ukPct?:number}>} trafos
 * @param {{kwV:number, kwG:number}} last  Bezug / Einspeisung hinter der Gruppe (je einmal gezählt)
 * @param {'n1'|'parallel'} betriebsart
 * @param {number} pf  Wirkleistungsfaktor der Trafobemessung (kW = kVA · pf)
 * @returns {Map<any, {anteil:number, faktor:number, normal:Lastfall, n1:Lastfall, n1Moeglich:boolean,
 *   betriebsart:string, kwV:number, kwG:number, kw:number, pct:number}>}
 *   Lastfall = {kwV, kwG, kw, pct}; kwV…pct oben = der Lastfall der Betriebsart
 */
export function trafoAufteilung(trafos, last, betriebsart = BETRIEBSART_VORGABE, pf = 0.9) {
  const kwV = Math.max(0, last?.kwV || 0), kwG = Math.max(0, last?.kwG || 0);
  const art = normBetriebsart(betriebsart) || BETRIEBSART_VORGABE;
  const t = (trafos || []).map(x => {
    const kva = _zahl(x.kva, 630);
    return { id: x.id, kva, w: kva / _zahl(x.ukPct, UK_VORGABE_PCT) };
  });
  const W = t.reduce((s, x) => s + x.w, 0);
  const fall = (kva, f) => {
    const v = kwV * f, g = kwG * f, kw = Math.max(v, g);
    return { kwV: v, kwG: g, kw, pct: kva > 0 ? kw / (kva * pf) * 100 : 0 };
  };
  const erg = new Map();
  for (const x of t) {
    const anteil = W > 0 ? x.w / W : 1 / t.length;
    // N-1: ungünstigster Ausfall eines ANDEREN Trafos = der mit dem größten Gewicht
    const andere = t.filter(y => y !== x);
    const wAus = andere.reduce((m, y) => Math.max(m, y.w), 0);
    const n1Moeglich = andere.length > 0;
    const anteilN1 = n1Moeglich && W - wAus > 0 ? x.w / (W - wAus) : anteil;
    const normal = fall(x.kva, anteil);
    const n1 = fall(x.kva, anteilN1);
    const m = art === 'parallel' ? normal : n1;
    // faktor: Anteil der Gruppenlast, der in der Betriebsart über DIESEN Trafo
    // fließt — auch für seine Zuleitung (MS-Kabel) und die Verbindung zur NSHV.
    const faktor = art === 'parallel' ? anteil : anteilN1;
    erg.set(x.id, { anteil, faktor, normal, n1, n1Moeglich, betriebsart: art, ...m });
  }
  return erg;
}
