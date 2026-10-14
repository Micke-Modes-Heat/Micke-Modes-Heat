// ── lib/waermespeicher.js — Kennwerte und Kosten thermischer Speicher (DOM-frei) ──
// Kurzzeitspeicher: drucklose Stahltanks (Puffer bis Großspeicher). Langzeitspeicher: Erdbecken (PTES).
// Kosten und Verluste hängen stark vom Volumen ab: große Speicher sind je m³ viel günstiger und verlieren
// relativ weniger Wärme (Oberfläche wächst nur mit V^(2/3)).
// speicherInvestEur wird zusätzlich in den Optimierer-Worker kopiert (.toString()) — in sich geschlossen halten.

/** Wärmekapazität in kWh: V × ρ·c/3600 × ΔT ≈ V × 1,16 × ΔT. */
export function speicherKapKwh(volM3, dtK) {
  return (Number(volM3) || 0) * 1.16 * (Number(dtK) || 0);
}

/**
 * Investition eines Wärmespeichers in € (inkl. Dämmung, Aufstellung/Erdbau, Anbindung).
 * typ: 'puffer' | 'gross' | 'kurz' → Stahltank; 'saisonal' | 'lang' → Erdbecken.
 * Richtwerte (Annahme nach Marktspannen): Tank 1 m³ ≈ 2.000 €/m³, 50 m³ ≈ 620 €/m³, 5.000 m³ ≈ 155 €/m³;
 * Erdbecken 10.000 m³ ≈ 100 €/m³, 100.000 m³ ≈ 56 €/m³.
 */
export function speicherInvestEur(volM3, typ) {
  var v = Number(volM3) || 0;
  if (v <= 0) return 0;
  var erdbecken = typ === 'saisonal' || typ === 'lang';
  var eurM3 = erdbecken ? 1000 * Math.pow(Math.max(v, 1000), -0.25) : 2000 * Math.pow(Math.max(v, 1), -0.3);
  return Math.round(v * eurM3);
}

/** Übliche Verlustrate in % des Ladezustands je Stunde (größere Speicher verlieren relativ weniger). */
export function speicherVerlustProH(volM3, typ) {
  var v = Math.max(1, Number(volM3) || 1);
  var erdbecken = typ === 'saisonal' || typ === 'lang';
  return (erdbecken ? 0.3 : 0.2) * Math.pow(v, -1 / 3);
}

/**
 * Volumenstufen für die Größenvariation (logarithmisch).
 * Kurzzeit: Speicherinhalt von ca. 0,5 bis 24 Volllaststunden der Spitzenlast.
 * Langzeit: Speicherinhalt von ca. 2 % bis 40 % des Jahreswärmebedarfs.
 */
export function speicherVolumenStufen(art, peakKw, jahresMwh, dtK, anzahl = 14) {
  var kwhJeM3 = 1.16 * (dtK || 40);
  var lo, hi;
  if (art === 'lang') {
    lo = Math.max(500, (jahresMwh || 0) * 1000 * 0.02 / kwhJeM3);
    hi = Math.max(lo * 4, (jahresMwh || 0) * 1000 * 0.4 / kwhJeM3);
  } else {
    lo = Math.max(1, (peakKw || 0) * 0.5 / kwhJeM3);
    hi = Math.max(lo * 4, (peakKw || 0) * 24 / kwhJeM3);
  }
  var out = [];
  for (var i = 0; i < anzahl; i++) out.push(rundeVolumen(lo * Math.pow(hi / lo, i / (anzahl - 1))));
  return out.filter(function (v, i) { return i === 0 || v !== out[i - 1]; });
}

/** Volumen auf „sprechende“ Werte runden (2 signifikante Stellen). */
export function rundeVolumen(v) {
  if (!(v > 0)) return 0;
  var e = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.max(1, Math.round(v / e) * e);
}

/**
 * Kennwerte eines Speicher-Dispatchs gegenüber dem Lauf ohne Speicher.
 * @param {{thermEntladenGes:number, thermGeladenGes:number, thermVerlustGes:number, thermSocMax:number,
 *   autoGkKwh:number, autoGkPeakKw:number, thKwh:Object}} mit
 * @param {{autoGkKwh:number, autoGkPeakKw:number, thKwh:Object}} ohne
 * @param {number} kapKwh
 * @param {string[]} kesselKeys Schlüssel fossiler/Spitzenkessel (zählen als „Kesselwärme“)
 */
export function speicherKennwerte(mit, ohne, kapKwh, kesselKeys) {
  var kessel = function (r) {
    var s = r.autoGkKwh || 0;
    for (var i = 0; i < kesselKeys.length; i++) s += (r.thKwh && r.thKwh[kesselKeys[i]]) || 0;
    return s;
  };
  var kesselOhne = kessel(ohne), kesselMit = kessel(mit);
  return {
    entladenMwh: (mit.thermEntladenGes || 0) / 1000,
    geladenMwh: (mit.thermGeladenGes || 0) / 1000,
    verlustMwh: (mit.thermVerlustGes || 0) / 1000,
    verlustPct: mit.thermGeladenGes > 0 ? mit.thermVerlustGes / mit.thermGeladenGes * 100 : 0,
    vollzyklen: kapKwh > 0 ? (mit.thermEntladenGes || 0) / kapKwh : 0,
    maxFuellPct: kapKwh > 0 ? (mit.thermSocMax || 0) / kapKwh * 100 : 0,
    kesselOhneMwh: kesselOhne / 1000,
    kesselMitMwh: kesselMit / 1000,
    kesselVermiedenMwh: (kesselOhne - kesselMit) / 1000,
    spitzeOhneKw: ohne.autoGkPeakKw || 0,
    spitzeMitKw: mit.autoGkPeakKw || 0,
  };
}

/** Wirtschaftlichstes Volumen einer Größenvariation (kleinste Jahreskosten); null ohne Ergebnis. */
export function speicherOptimum(stufen) {
  var best = null;
  for (var i = 0; i < stufen.length; i++) {
    var s = stufen[i];
    if (!Number.isFinite(s.jahreskosten)) continue;
    if (!best || s.jahreskosten < best.jahreskosten) best = s;
  }
  return best;
}

/** Statische Amortisation in Jahren (Investition / jährliche Einsparung ohne Kapitalkosten); null wenn keine Einsparung. */
export function speicherAmortisation(investEur, einsparungEurA) {
  return einsparungEurA > 1 ? investEur / einsparungEurA : null;
}
