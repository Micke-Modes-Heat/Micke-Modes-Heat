// ── lib/netz-schema.js — Netzschema des Wärmenetzes als Baum (DOM-frei) ──
// Aus dem Versorgungsbaum der Netzberechnung (je Knoten die Leitung zum Elternknoten) entsteht ein schematischer
// Strangplan: Heizzentrale(n) links, Abgänge nach rechts, Gebäude als Blätter. Durchgangsknoten ohne Abzweig
// (Trassenpunkte) werden zusammengefasst — eine Linie je Leitungszug, mit Gesamtlänge und DN-Spanne.

/**
 * @param {{ wurzeln: number[], eltern: Map<number, number>, kante: Map<number, {dn:number, length:number, load:number}>,
 *   knoten: Map<number, {typ:string, name?:string, last?:number}>, kuppel?: {u:number, v:number, dn:number, length:number, load:number}[] }} d
 *   eltern: Knoten → Elternknoten (Richtung Zentrale); kante: Knoten → Leitung zum Elternknoten.
 * @param {{ spalteBreit?: number, zeileHoch?: number, rand?: number }} o
 */
export function netzSchemaLayout(d, o = {}) {
  const SB = o.spalteBreit ?? 150, ZH = o.zeileHoch ?? 30, R = o.rand ?? 30;
  const kinder = new Map();
  for (const [k, p] of d.eltern) { if (!kinder.has(p)) kinder.set(p, []); kinder.get(p).push(k); }
  const istFest = id => d.wurzeln.includes(id) || d.knoten.get(id)?.typ === 'geb' || (kinder.get(id) || []).length !== 1;
  // Zusammengefasster Baum: für jeden „festen“ Knoten die Kette bis zum nächsten festen Vorgänger
  const sKinder = new Map();
  const zug = new Map();   // Kindknoten → { laenge, dnMin, dnMax, last }
  const besuche = (start, festerVorgaenger, laenge, dnMin, dnMax, last) => {
    for (const k of kinder.get(start) || []) {
      const e = d.kante.get(k) || {};
      const l = laenge + (e.length || 0);
      const mn = Math.min(dnMin, e.dn || Infinity), mx = Math.max(dnMax, e.dn || 0);
      const ls = last ?? e.load ?? 0;
      if (istFest(k)) {
        if (!sKinder.has(festerVorgaenger)) sKinder.set(festerVorgaenger, []);
        sKinder.get(festerVorgaenger).push(k);
        zug.set(k, { laenge: l, dnMin: Number.isFinite(mn) ? mn : 0, dnMax: mx, last: ls });
        besuche(k, k, 0, Infinity, 0, null);
      } else besuche(k, festerVorgaenger, l, mn, mx, ls);
    }
  };
  d.wurzeln.forEach(w => besuche(w, w, 0, Infinity, 0, null));
  // Gebäude zuerst unten sortieren: Abzweige mit vielen Gebäuden oben, damit die Stränge ruhig verlaufen
  const blaetter = id => (sKinder.get(id) || []).length ? (sKinder.get(id) || []).reduce((s, k) => s + blaetter(k), 0) : 1;
  const pos = new Map();
  let zeile = 0, tiefeMax = 0;
  const lege = (id, tiefe) => {
    tiefeMax = Math.max(tiefeMax, tiefe);
    const ks = (sKinder.get(id) || []).slice().sort((a, b) => blaetter(b) - blaetter(a));
    if (!ks.length) { pos.set(id, { x: R + tiefe * SB, y: R + zeile * ZH, tiefe }); zeile++; return; }
    ks.forEach(k => lege(k, tiefe + 1));
    const ys = ks.map(k => pos.get(k).y);
    pos.set(id, { x: R + tiefe * SB, y: (Math.min(...ys) + Math.max(...ys)) / 2, tiefe });
  };
  d.wurzeln.forEach(w => { lege(w, 0); zeile += 1; });
  const knoten = [...pos].map(([id, p]) => ({ id, ...p, typ: d.wurzeln.includes(id) ? 'zentrale' : d.knoten.get(id)?.typ || 'abzweig',
    name: d.knoten.get(id)?.name || '', last: d.knoten.get(id)?.last || 0 }));
  const kanten = [];
  for (const [p, ks] of sKinder) for (const k of ks) kanten.push({ von: p, nach: k, ...zug.get(k) });
  const kuppel = (d.kuppel || []).filter(e => pos.has(e.u) && pos.has(e.v)).map(e => ({ von: e.u, nach: e.v, dnMin: e.dn, dnMax: e.dn, laenge: e.length, last: e.load, kuppel: true }));
  return { knoten, kanten, kuppel, W: R * 2 + tiefeMax * SB + 260, H: R * 2 + Math.max(1, zeile) * ZH };
}

/** „DN 65“ bzw. „DN 50–100“. */
export function dnText(mn, mx) {
  if (!mx) return 'DN ?';
  return mn && mn !== mx ? `DN ${mn}–${mx}` : `DN ${mx}`;
}
