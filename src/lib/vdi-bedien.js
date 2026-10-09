// ── lib/vdi-bedien.js — Bedienaufwand von Erzeugern nach VDI 2067 ──
// DOM-frei. VDI 2067 nennt Bedienstunden je Anlage (Kessel ~20 h/a, Wärmepumpe ~5 h/a). Große Zentralen bestehen
// aus mehreren Modulen (z. B. Luft-WP-Module bis ca. 800 kW_th); jedes Modul will kontrolliert, entstört und
// begangen werden. Daher: Bedienstunden = Grundaufwand der Anlage + Stunden je Modul × Modulanzahl.
// bedienModulStunden wird zusätzlich in den Optimierer-Worker kopiert (.toString()) — in sich geschlossen halten.

/**
 * Bedienaufwand eines Erzeugers in h/a mit Aufschlüsselung.
 * @param {string} typ Bausteinkennung (lwwp, fg, geo_wp, gk, gk_auto, hko, sk, pk, pk_lager, hhs, hhs_lager, bhkw_agg)
 * @param {number} kw thermische Leistung
 * @returns {{stunden:number, module:number, modulKw:number, jeModul:number, grund:number}}
 */
export function bedienModulStunden(typ, kw) {
  // modulKw: größte übliche Modulleistung; jeModul: h/a je Modul; grund: h/a für die Anlage insgesamt.
  // Biomasse und BHKW: Stunden je Modul nach Modulgröße gestaffelt (Brennstoff, Asche, Störungen).
  var T = {
    lwwp:     { modulKw: 800,  jeModul: 12, grund: 8 },
    fg:       { modulKw: 1500, jeModul: 15, grund: 10 },
    geo_wp:   { modulKw: 600,  jeModul: 10, grund: 6 },
    gk:       { modulKw: 2000, jeModul: 20, grund: 0 },
    gk_auto:  { modulKw: 2000, jeModul: 20, grund: 0 },
    hko:      { modulKw: 2000, jeModul: 20, grund: 0 },
    sk:       { modulKw: 2000, jeModul: 10, grund: 0 },
    pk:       { modulKw: 1000, stufen: [[50, 100], [200, 200], [500, 300], [Infinity, 408]], grund: 0 },
    pk_lager: { modulKw: 1000, stufen: [[50, 50], [200, 100], [500, 150], [Infinity, 204]], grund: 0 },
    hhs:      { modulKw: 1500, stufen: [[50, 150], [200, 250], [500, 350], [Infinity, 408]], grund: 0 },
    hhs_lager:{ modulKw: 1500, stufen: [[50, 100], [200, 200], [500, 400], [Infinity, 612]], grund: 0 },
    bhkw_agg: { modulKw: 2000, stufen: [[20, 100], [100, 200], [500, 300], [Infinity, 408]], grund: 0 },
  };
  var t = T[typ];
  var p = Number(kw) || 0;
  if (!t || p <= 0.1) return { stunden: 0, module: 0, modulKw: t ? t.modulKw : 0, jeModul: 0, grund: 0 };
  var n = Math.max(1, Math.ceil(p / t.modulKw - 1e-9));
  var jeModul = t.jeModul;
  if (t.stufen) {
    var proModul = p / n;
    for (var i = 0; i < t.stufen.length; i++) { if (proModul < t.stufen[i][0]) { jeModul = t.stufen[i][1]; break; } }
  }
  return { stunden: Math.round(t.grund + n * jeModul), module: n, modulKw: t.modulKw, jeModul: jeModul, grund: t.grund };
}

/** Bedienstunden pro Jahr eines Erzeugerbausteins. */
export function bedienStunden(typ, kw) {
  return bedienModulStunden(typ, kw).stunden;
}

/** Erläuterung für Tooltips: „13 Module à ≤ 800 kW: 8 h + 13 × 12 h = 164 h/a“. */
export function bedienErlaeuterung(typ, kw) {
  const b = bedienModulStunden(typ, kw);
  if (!b.module) return 'Bedienung: 0 h/a';
  const teil = (b.grund ? b.grund + ' h Anlage + ' : '') + b.module + ' × ' + b.jeModul + ' h';
  return 'Bedienung nach VDI 2067: ' + b.module + (b.module === 1 ? ' Modul' : ' Module') + ' à ≤ '
    + b.modulKw.toLocaleString('de-DE') + ' kW → ' + teil + ' = ' + b.stunden + ' h/a';
}
