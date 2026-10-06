// ── lib/gutachten-abbildungen.js — Datenaufbereitung für die Gutachtenabbildungen Wärme ──
// DOM-frei: Lastgang-Auswertungen (Tagesmittel, Korrelation mit der Außentemperatur, Deckungskurve, Wochen-
// und Monatswerte), Luft-WP-Simulation mit Deckungsgrad-Sweep, Kostenstruktur und PV-Vergleich je Variante,
// Wasserfall der baulichen Entwicklung, Schallabstände und Phasen des Maßnahmenfahrplans.
import { LG_INNEN, lgSpitzenlast } from './gutachten-lastgang.js';
import { PT_TA_LAERM, ptSchallRadius } from './gutachten-potenzial.js';

const ok = Number.isFinite;
const MONATSTAGE = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 365 Tagesmittel der Leistung (kW) aus 8760 Stundenwerten. */
export function abTagesmittel(lastgangKw) {
  if (!lastgangKw || lastgangKw.length < 8760) return [];
  const t = new Array(365);
  for (let d = 0; d < 365; d++) { let s = 0; for (let h = 0; h < 24; h++) s += lastgangKw[d * 24 + h] || 0; t[d] = s / 24; }
  return t;
}

/** Monatssummen in MWh (Nicht-Schaltjahr). */
export function abMonatsMwh(lastgangKw) {
  if (!lastgangKw || lastgangKw.length < 8760) return [];
  const out = []; let h = 0;
  for (const tage of MONATSTAGE) { let s = 0; for (let i = 0; i < tage * 24; i++) s += lastgangKw[h++] || 0; out.push(s / 1000); }
  return out;
}

/** Lineare Regression y = a + b·x. */
function regression(p) {
  const n = p.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of p) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const d = n * sxx - sx * sx;
  if (!d) return null;
  const b = (n * sxy - sx * sy) / d;
  return { a: (sy - b * sx) / n, b };
}

/**
 * Korrelation Leistung ↔ Außentemperatur: Tagesmittel der Leistung über dem Tagesmittel der Temperatur,
 * Regressionsgerade der Heiztage (T < Heizgrenze) und die Extrapolationsgerade der Spitzenlast
 * (Innentemperatur → gemessene Spitze → Norm-Außentemperatur, wie lgSpitzenlast).
 */
export function abKorrelation(lastgangKw, tageT, normAtC, heizgrenze = 15) {
  const tm = abTagesmittel(lastgangKw);
  if (!tm.length || !Array.isArray(tageT) || tageT.length !== 365) return null;
  const punkte = tm.map((y, i) => ({ x: tageT[i], y })).filter(p => ok(p.x) && ok(p.y));
  const heiz = punkte.filter(p => p.x < heizgrenze);
  const r = regression(heiz);
  const s = lgSpitzenlast(lastgangKw, tageT, normAtC);
  const xMin = Math.min(...punkte.map(p => p.x), ok(normAtC) ? normAtC : Infinity);
  const regLinie = r && r.b < 0 ? [{ x: xMin, y: r.a + r.b * xMin }, { x: heizgrenze, y: r.a + r.b * heizgrenze }] : null;
  const spitzeLinie = s && ok(s.tSpitze) && s.tSpitze < LG_INNEN
    ? [{ x: LG_INNEN, y: 0 }, { x: s.tSpitze, y: s.pMax }, ...(ok(s.pNorm) && normAtC < s.tSpitze ? [{ x: normAtC, y: s.pNorm }] : [])]
    : null;
  return {
    punkte, regression: r, regLinie, spitzeLinie, spitze: s,
    regNormKw: r && ok(normAtC) ? r.a + r.b * normAtC : NaN,
    bestimmtheit: r ? (() => {
      const my = heiz.reduce((a, p) => a + p.y, 0) / heiz.length;
      const ssT = heiz.reduce((a, p) => a + (p.y - my) ** 2, 0), ssR = heiz.reduce((a, p) => a + (p.y - (r.a + r.b * p.x)) ** 2, 0);
      return ssT > 0 ? 1 - ssR / ssT : NaN;
    })() : NaN,
  };
}

/** Deckungskurve: Anteil der Jahreswärme (%), den eine Grundlastleistung P (kW) abdeckt, für n Stützstellen 0 … P_max. */
export function abDeckungsKurve(jdlKw, n = 40) {
  const N = jdlKw?.length || 0;
  if (!N) return [];
  let ges = 0, max = 0;
  for (let i = 0; i < N; i++) { const v = jdlKw[i] || 0; ges += v; if (v > max) max = v; }
  if (!(ges > 0)) return [];
  const out = [];
  for (let k = 0; k <= n; k++) {
    const p = (max * k) / n;
    let s = 0;
    for (let i = 0; i < N; i++) s += Math.min(jdlKw[i] || 0, p);
    out.push({ x: p, y: (s / ges) * 100 });
  }
  return out;
}

/** Eine Woche (168 h) ab dem ersten Montag des Monats (0 = Januar) mit Tagesticks. */
export function abWoche(lastgangKw, jahr, monat = 7) {
  if (!lastgangKw || lastgangKw.length < 8760) return null;
  const j = Number(jahr) > 1900 ? Number(jahr) : 2023;
  const erster = new Date(Date.UTC(j, monat, 1));
  const versatz = (8 - erster.getUTCDay()) % 7; // Tage bis Montag
  const start = new Date(Date.UTC(j, monat, 1 + versatz));
  const doy = Math.round((start - Date.UTC(j, 0, 1)) / 864e5);
  if (doy * 24 + 168 > 8760) return null;
  const daten = Array.prototype.slice.call(lastgangKw, doy * 24, doy * 24 + 168);
  const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const ticks = TAGE.map((t, i) => {
    const d = new Date(Date.UTC(j, monat, 1 + versatz + i));
    return { pos: i * 24 + 12, label: `${t} ${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.` };
  });
  return { daten, ticks, start: start.toISOString().slice(0, 10), mittelKw: daten.reduce((a, b) => a + b, 0) / 168, maxKw: Math.max(...daten), minKw: Math.min(...daten) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Luft-Wasser-Wärmepumpe: Stundensimulation und Deckungsgrad-Sweep
 * Gleiche Kennlinie wie die Einsatzplanung (06c-dispatch-core.js): COP = Gütegrad · T_VL / (T_VL − T_Luft),
 * höchstens 8; verfügbare Leistung = Nennleistung (A2/W35) · COP / COP(A2/W35); Rest übernimmt die Spitzenlast.
 * ═══════════════════════════════════════════════════════════════════════ */
export const AB_WP = Object.freeze({ guete: 0.45, copMax: 8, refQuelle: 2, refVl: 35 });

/** o: { lastgangKw, tempH, vlH (oder vlC konstant), nennKw, guete, minCop, stunden (true: Stundenwerte zurückgeben) } */
export function abLwwpSimulation(o) {
  const L = o.lastgangKw, T = o.tempH;
  if (!L || !T || L.length < 8760 || T.length < 8760) return null;
  const g = o.guete > 0 ? o.guete : AB_WP.guete;
  const copRef = ((273.15 + AB_WP.refVl) / (AB_WP.refVl - AB_WP.refQuelle)) * g;
  const nenn = Math.max(0, o.nennKw || 0);
  let wpKwh = 0, elKwh = 0, gesKwh = 0, restMax = 0, leistungKalt = NaN, tKalt = Infinity;
  const wpH = o.stunden ? new Float32Array(8760) : null, elH = o.stunden ? new Float32Array(8760) : null;
  for (let t = 0; t < 8760; t++) {
    const bedarf = L[t] || 0;
    gesKwh += bedarf;
    const vl = o.vlH ? o.vlH[t] : (o.vlC || 55);
    const hub = Math.max(vl + 273.15 - (T[t] + 273.15), 0.1);
    const cop = Math.min(((vl + 273.15) / hub) * g, AB_WP.copMax);
    const sperre = o.minCop > 0 && cop < o.minCop;
    const verf = sperre ? 0 : nenn * (cop / copRef);
    if (T[t] < tKalt) { tKalt = T[t]; leistungKalt = verf; }
    const p = Math.min(verf, bedarf);
    wpKwh += p;
    if (p > 0) elKwh += p / cop;
    if (bedarf - p > restMax) restMax = bedarf - p;
    if (wpH) { wpH[t] = p; elH[t] = p > 0 ? p / cop : 0; }
  }
  return {
    nennKw: nenn, deckungPct: gesKwh > 0 ? (wpKwh / gesKwh) * 100 : 0, waermeMwh: wpKwh / 1000, stromMwh: elKwh / 1000,
    umweltMwh: (wpKwh - elKwh) / 1000, spitzeMwh: (gesKwh - wpKwh) / 1000, gesamtMwh: gesKwh / 1000,
    jaz: elKwh > 0 ? wpKwh / elKwh : NaN, restMaxKw: restMax, leistungKaltKw: leistungKalt, tKaltC: tKalt, wpH, elH,
  };
}

/** Deckungsgrade des Vergleichs in % (Vorgabe Gutachten: GEG-Quote, weitgehend, nahezu und vollständig monovalent). */
export const AB_WP_QUOTEN = Object.freeze([65, 90, 99, 100]);

/**
 * Nennleistung je Ziel-Deckungsgrad. 100 % direkt: die Nennleistung, bei der die WP in jeder Stunde den Bedarf
 * liefert (größtes Bedarf · COP(A2/W35) / COP der Stunde); unerreichbar, wenn Stunden mit Bedarf unter dem
 * Mindest-COP liegen. Übrige Quoten per Bisektion bis zu dieser Leistung (Deckung steigt monoton).
 */
export function abLwwpSweep(o, quoten = AB_WP_QUOTEN) {
  const L = o.lastgangKw, T = o.tempH;
  if (!L || !T || L.length < 8760 || T.length < 8760) return [];
  const g = o.guete > 0 ? o.guete : AB_WP.guete;
  const copRef = ((273.15 + AB_WP.refVl) / (AB_WP.refVl - AB_WP.refQuelle)) * g;
  let nenn100 = 0, gesperrt = false;
  for (let t = 0; t < 8760; t++) {
    if (!(L[t] > 0)) continue;
    const vl = o.vlH ? o.vlH[t] : (o.vlC || 55);
    const cop = Math.min(((vl + 273.15) / Math.max(vl - T[t], 0.1)) * g, AB_WP.copMax);
    if (o.minCop > 0 && cop < o.minCop) { gesperrt = true; continue; }
    nenn100 = Math.max(nenn100, (L[t] * copRef) / cop);
  }
  const maxPct = abLwwpSimulation({ ...o, nennKw: nenn100 * 1.000001 }).deckungPct;
  return quoten.map(q => {
    if (q >= 100) {
      return gesperrt ? { ziel: q, erreichbar: false, maxPct } : { ziel: q, erreichbar: true, ...abLwwpSimulation({ ...o, nennKw: nenn100 * 1.000001 }) };
    }
    if (q > maxPct - 0.005) return { ziel: q, erreichbar: false, maxPct };
    let lo = 0, hi = nenn100 * 1.000001;
    for (let i = 0; i < 36; i++) {
      const m = (lo + hi) / 2;
      if (abLwwpSimulation({ ...o, nennKw: m }).deckungPct < q) lo = m; else hi = m;
    }
    return { ziel: q, erreichbar: true, ...abLwwpSimulation({ ...o, nennKw: hi }) };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Varianten: Kostenstruktur und PV-Eigenstrom
 * v.wirtKomp = { kapitalEur, betriebEur, energieEur, co2Eur, pvJkEur, pvEnergieEur, pvCo2Eur, gesamtMwh }
 * ═══════════════════════════════════════════════════════════════════════ */
export function abKostenstruktur(varianten) {
  return (varianten || []).filter(v => v.wirtKomp && v.wirtKomp.gesamtMwh > 0).map(v => {
    const k = v.wirtKomp, ct = eur => (eur || 0) / k.gesamtMwh / 10;
    const r = { name: v.name, kapital: ct(k.kapitalEur), betrieb: ct(k.betriebEur), energie: ct(k.energieEur), co2: ct(k.co2Eur), pv: ct(k.pvJkEur) };
    r.summe = r.kapital + r.betrieb + r.energie + r.co2 + r.pv;
    return r;
  });
}

/**
 * Wärmegestehungskosten je Variante mit und ohne PV-Eigenstrom. „Mit“ ist der gerechnete Stand (PV-Eigenstrom
 * mindert den Netzbezug von WP und Stromkessel, die PV-Annuität ist enthalten); „ohne“ nimmt die Entlastung und
 * die PV-Kosten heraus.
 */
export function abPvVergleich(varianten) {
  return (varianten || []).filter(v => v.wirtKomp && v.wirtKomp.gesamtMwh > 0).map(v => {
    const k = v.wirtKomp;
    const jkMit = (k.jkAnlagenEur ?? (k.kapitalEur + k.betriebEur)) + k.energieEur + k.co2Eur + (k.pvJkEur || 0);
    const jkOhne = jkMit - (k.pvJkEur || 0) + (k.pvEnergieEur || 0) + (k.pvCo2Eur || 0);
    const ct = eur => eur / k.gesamtMwh / 10;
    return { name: v.name, mitCt: ct(jkMit), ohneCt: ct(jkOhne), entlastungEur: jkOhne - jkMit, pvEnergieEur: k.pvEnergieEur || 0, pvJkEur: k.pvJkEur || 0 };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bauliche Entwicklung, Schall, Fahrplan
 * ═══════════════════════════════════════════════════════════════════════ */
/** Wasserfall Wärmebedarf Ist → Abriss → Sanierung → Neubau → Soll (a = gbAuswertung). */
export function abWasserfallBedarf(a) {
  const j = a?.jahre || [];
  if (j.length < 2) return [];
  const sum = art => (a.ereignisseJahr || []).filter(e => e.art === art).reduce((x, e) => x + e.deltaMwh, 0);
  const anz = art => (a.ereignisseJahr || []).filter(e => e.art === art).reduce((x, e) => x + e.anzahl, 0);
  const balken = [{ label: `Ist ${j[0].jahr}`, wert: j[0].bedarfMwh, art: 'basis' }];
  for (const [art, label] of [['abriss', 'Abriss'], ['sanierung', 'Sanierung'], ['neubau', 'Neubau']]) {
    if (anz(art)) balken.push({ label, sub: `${anz(art)} Geb.`, wert: sum(art), art: 'delta' });
  }
  balken.push({ label: `Soll ${j.at(-1).jahr}`, wert: 0, art: 'summe' });
  return balken;
}

/** Erforderliche Abstände je Gebietsart (Nachtwert TA Lärm) für einen Schallleistungspegel. */
export function abSchallAbstaende(lwaDb) {
  if (!(lwaDb > 0)) return [];
  return PT_TA_LAERM.map(([gebiet, tag, nacht]) => ({ gebiet, tag, nacht, rTag: ptSchallRadius(lwaDb, tag), rNacht: ptSchallRadius(lwaDb, nacht) }));
}

/** Phasen des Maßnahmenfahrplans (gleiche Zeitspannen wie faTextFahrplan), Jahre relativ zum Startjahr. */
export function abFahrplanPhasen(start, zielJahr = 2045, profil = null, ausbau = []) {
  const s = Number(start) || new Date().getFullYear() + 1;
  const p = profil || { wp: true, fossil: true };
  const out = [
    { name: 'Sofortmaßnahmen: PV auf Neubauten', von: s, bis: s, farbe: '#C9A227' },
    { name: p.wp ? 'Bestandsaufnahme Elektro und Heizflächen' : 'Bestandsaufnahme Elektro und Heiztechnik', von: s, bis: s + 1, farbe: '#6B8E4E' },
    { name: p.name ? `Fachplanung ${p.name}` : 'Fachplanung Vorzugsvariante', von: s + 1, bis: s + 2, farbe: '#4F7FA8' },
  ];
  if (p.wp) out.push({ name: 'Niedertemperatur-Ertüchtigung', von: s + 2, bis: s + 4, farbe: '#E0A126' });
  out.push({ name: 'Errichtung und Inbetriebnahme Erzeuger', von: s + (p.wp ? 3 : 2), bis: s + (p.wp ? 5 : 4), farbe: '#C0392B' });
  for (const a of ausbau || []) {
    const von = Number(a.von), bis = Number(a.bis);
    if (a.name && Number.isFinite(von)) out.push({ name: `Ausbaustufe: ${a.name}`, von, bis: Number.isFinite(bis) && bis >= von ? bis : von, farbe: '#7F8C8D' });
  }
  if (p.fossil || p.bhkw) out.push({ name: p.bhkw && !p.fossil ? 'Ersatz BHKW prüfen' : 'Ersatz fossiler Spitzenlastkessel prüfen', von: s + 10, bis: Math.max(s + 10, zielJahr), farbe: '#7A6334' });
  return out;
}
