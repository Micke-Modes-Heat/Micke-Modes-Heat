// ── lib/optimierer-suche.js — Suchbausteine der Optimierung (DOM-frei) ──
// Jede Funktion ist in sich geschlossen: der Optimierer-Worker (10d) bettet sie
// per .toString() ein. Keine Importe, keine Bezüge auf andere Modulbezeichner.

/**
 * Alle Teilmengen der Kandidaten mit 1..maxN Elementen.
 * @param {string[]} keys
 * @param {number} maxN
 * @returns {string[][]}
 */
export function optKombinationen(keys, maxN) {
  const out = [];
  const n = keys.length;
  const grenze = Math.min(maxN, n);
  function tiefer(start, akt) {
    if (akt.length > 0) out.push(akt.slice());
    if (akt.length === grenze) return;
    for (let i = start; i < n; i++) { akt.push(keys[i]); tiefer(i + 1, akt); akt.pop(); }
  }
  tiefer(0, []);
  return out;
}

/**
 * Anlagenkonzept einer bewerteten Konfiguration: die gewählten Erzeuger plus der
 * Gaskessel, sobald der Spitzenlastkessel tatsächlich gebraucht (und bezahlt) wird.
 * „Luft-WP + Gaskessel“ und „Luft-WP + Spitzenlastkessel (auto)“ sind dasselbe Konzept.
 * Schwellen wie in der Kostenrechnung (_calcKostenShared/_optKennwerte2).
 */
export function optKonzeptSchluessel(keys, autoGkMwh, autoGkPeakKw) {
  const s = {};
  for (const k of keys) s[k] = true;
  if ((autoGkMwh || 0) > 0.05 && (autoGkPeakKw || 0) > 0.1) s.gaskessel = true;
  return Object.keys(s).sort().join('+');
}

/**
 * Einspeisevergütung (ct/kWh) für eine PV-Größe. desc.flat = fester Satz (manuelle Annahme);
 * sonst leistungsgewichtete EEG-Staffel. Jenseits der Grenze des gewählten Modells gilt die
 * Ersatzstaffel (Marktprämienmodell — ab 100 kWp ist Direktvermarktung Pflicht), jenseits
 * auch dieser ihr letzter Satz (Ausschreibungsbereich, Näherung).
 * desc.offsetKwp = bereits geplante PV, die für die Staffel mitzählt.
 */
export function optEinspeiseCt(desc, kwp) {
  if (!desc) return 8;
  if (desc.flat != null) return desc.flat;
  function staffel(cap, tiers) {
    if (!tiers || !tiers.length) return null;
    let vorher = 0, summe = 0;
    for (const t of tiers) {
      summe += Math.max(0, Math.min(cap, t.upToKwp) - vorher) * t.ctPerKwh;
      vorher = t.upToKwp;
      if (cap <= t.upToKwp) return summe / cap;
    }
    return null;
  }
  const gesamt = Math.max(0, kwp || 0) + (desc.offsetKwp || 0);
  if (gesamt <= 0) return desc.tiers[0].ctPerKwh;
  const r = staffel(gesamt, desc.tiers);
  if (r != null) return r;
  const ersatz = desc.ersatz && desc.ersatz.length ? desc.ersatz : desc.tiers;
  const r2 = staffel(gesamt, ersatz);
  return r2 != null ? r2 : ersatz[ersatz.length - 1].ctPerKwh;
}

/**
 * Leistungsstufen der Grobsuche als Anteil der Spitzenlast.
 * @param {string} qualitaet schnell | standard | gruendlich
 */
export function optRasterStufen(qualitaet) {
  if (qualitaet === 'schnell') return [0.15, 0.35, 0.6, 0.9];
  if (qualitaet === 'gruendlich') return [0.1, 0.17, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1.0];
  return [0.1, 0.2, 0.35, 0.5, 0.7, 0.9];
}

/**
 * Mustersuche (Hooke-Jeeves-artig, ganzzahlig) über einen Vektor mit Grenzen.
 * Jede Achse wird in beide Richtungen probiert, eine erfolgreiche Richtung wird
 * fortgesetzt; ohne Verbesserung werden gekoppelte Paare der Gruppe 'erz' getestet
 * (der eine Erzeuger größer, der andere kleiner), danach halbiert sich die Schrittweite.
 * bewerte(x) → Zahl (kleiner = besser, Infinity = unzulässig).
 * @param {number[]} start
 * @param {{lo:number, hi:number, schritt:number, minSchritt:number, gruppe?:string}[]} dims
 * @param {(x:number[]) => number} bewerte
 * @param {number} maxEval
 */
export function optMusterSuche(start, dims, bewerte, maxEval) {
  const cache = new Map();
  let evals = 0;
  function f(x) {
    const k = x.join('|');
    if (cache.has(k)) return cache.get(k);
    evals++;
    const s = bewerte(x);
    const v = Number.isFinite(s) ? s : Infinity;
    cache.set(k, v);
    return v;
  }
  function klemme(v, d) { return Math.round(Math.min(d.hi, Math.max(d.lo, v))); }
  let x = start.map((v, i) => klemme(v, dims[i]));
  let best = f(x);
  const schritte = dims.map(d => Math.max(Math.round(d.schritt), d.minSchritt));
  const aktiv = i => dims[i].hi > dims[i].lo && schritte[i] >= dims[i].minSchritt;
  function versuche(y) {
    const s = f(y);
    if (s < best - 1e-9) { x = y; best = s; return true; }
    return false;
  }
  while (evals < maxEval) {
    let besser = false;
    for (let i = 0; i < dims.length && evals < maxEval; i++) {
      if (!aktiv(i)) continue;
      for (const dir of [1, -1]) {
        const y = x.slice(); y[i] = klemme(x[i] + dir * schritte[i], dims[i]);
        if (y[i] === x[i] || !versuche(y)) continue;
        besser = true;
        // erfolgreiche Richtung weitergehen
        for (;;) {
          if (evals >= maxEval) break;
          const z = x.slice(); z[i] = klemme(x[i] + dir * schritte[i], dims[i]);
          if (z[i] === x[i] || !versuche(z)) break;
        }
        break;
      }
    }
    if (!besser) {
      // gekoppelte Erzeugerpaare: Leistung von einem zum anderen verschieben
      for (let i = 0; i < dims.length && !besser && evals < maxEval; i++) {
        if (!aktiv(i) || dims[i].gruppe !== 'erz') continue;
        for (let j = i + 1; j < dims.length && !besser && evals < maxEval; j++) {
          if (!aktiv(j) || dims[j].gruppe !== 'erz') continue;
          const s = Math.min(schritte[i], schritte[j]);
          for (const dir of [1, -1]) {
            const y = x.slice();
            y[i] = klemme(x[i] + dir * s, dims[i]); y[j] = klemme(x[j] - dir * s, dims[j]);
            if ((y[i] !== x[i] || y[j] !== x[j]) && versuche(y)) { besser = true; break; }
          }
        }
      }
    }
    if (!besser) {
      // ganzzahlig halbieren; die letzte Runde läuft immer mit genau der Mindestschrittweite
      let weiter = false;
      for (let i = 0; i < schritte.length; i++) {
        const minS = dims[i].minSchritt;
        if (schritte[i] < minS) continue;
        schritte[i] = schritte[i] > minS ? Math.max(minS, Math.round(schritte[i] / 2)) : minS / 2;
        if (dims[i].hi > dims[i].lo && schritte[i] >= minS) weiter = true;
      }
      if (!weiter) break;
    }
  }
  return { x, score: best, evals };
}

/**
 * Suchraum der Erzeugerkombinationen.
 * Ist der Gaskessel Kandidat, ist er der Spitzenlastkessel: er wird nicht als eigene
 * Leistungsachse gesucht, sondern deckt (wie der Auto-Gaskessel der Hauptberechnung)
 * genau den Rest — sonst entstünden zwei gleiche Konzepte („X + Gaskessel“ und
 * „X + Spitzenkessel auto“). Ohne Gaskessel-Kandidat deckt der letzte Kessel der
 * Kombination als Backup die Spitze (Leistung ergibt sich aus dem Einsatz).
 * @param {{aktiv:string[], constraints:Object, jahr:number, peak:number,
 *   typen:Object, meritOrder:string[], maxN?:number}} p
 */
export function optSuchraum(p) {
  const gasImplizit = p.aktiv.indexOf('gaskessel') >= 0;
  const rang = k => { const i = p.meritOrder.indexOf(k); return i < 0 ? 99 : i; };
  const nachRang = (a, b) => rang(a) - rang(b);
  const basis = p.aktiv.filter(k => !(gasImplizit && k === 'gaskessel')).sort(nachRang);
  const listen = optKombinationen(basis, p.maxN || 3).map(keys => keys.slice().sort(nachRang));
  if (gasImplizit) listen.unshift([]);
  const kombis = listen.map(keys => {
    const letzter = keys[keys.length - 1];
    const backupIdx = !gasImplizit && keys.length && p.typen[letzter] === 'fix' ? keys.length - 1 : -1;
    const grenzen = keys.map((k, i) => {
      if (i === backupIdx) return { lo: 1, hi: 1 };
      const c = p.constraints[k] || {};
      const minGilt = c.minKw > 0 && (!c.bisJahr || c.bisJahr >= p.jahr);
      const hi = Math.max(1, Math.round(c.maxKw > 0 ? c.maxKw : p.peak * 1.2));
      // Jeder Erzeuger einer Mehrfachkombination trägt mindestens 10 % der Spitzenlast —
      // kleiner wäre er praktisch die kleinere Kombination, die ohnehin geprüft wird
      const boden = Math.round(p.peak * (keys.length > 1 ? 0.1 : 0.05));
      const lo = Math.min(hi, Math.max(1, boden, minGilt ? Math.round(c.minKw) : 0));
      return { lo, hi };
    });
    return { keys, grenzen, backupIdx };
  });
  return { gasImplizit, backupMode: !gasImplizit, kombis };
}

/**
 * Startpunkte der Grobsuche: Leistungsstufen je Erzeuger (Anteile der Spitzenlast),
 * auf die Grenzen gezogen, ohne Dubletten. Kombinationen, deren Summe weit über der
 * Spitzenlast liegt, sind reine Überdimensionierung und entfallen.
 * @param {{lo:number, hi:number}[]} grenzen
 * @param {number[]} stufen
 * @param {number} peak
 */
export function optGrobPunkte(grenzen, stufen, peak) {
  const werte = grenzen.map(g => {
    if (g.hi <= g.lo) return [g.lo];
    const s = new Set();
    for (const f of stufen) s.add(Math.round(Math.min(g.hi, Math.max(g.lo, f * peak))));
    return [...s].sort((a, b) => a - b);
  });
  const variabel = grenzen.filter(g => g.hi > g.lo).length;
  const out = [];
  function tiefer(i, akt, summe) {
    if (i === werte.length) {
      if (variabel < 2 || summe <= peak * 1.6) out.push(akt.slice());
      return;
    }
    for (const v of werte[i]) {
      akt.push(v); tiefer(i + 1, akt, summe + (grenzen[i].hi > grenzen[i].lo ? v : 0)); akt.pop();
    }
  }
  tiefer(0, [], 0);
  return out;
}
