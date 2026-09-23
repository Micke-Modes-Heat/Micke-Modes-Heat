// ── lib/bedarfsprognose.js — Bedarfsprognose Strom: Maßnahmen und Leistungsstufen ──
//
// Gemeinsame Rechnung der NAP-Analyse (13o, Lastentwicklung) und der
// Gutachten-Abbildungen für die Kapitel 3.3.1–3.3.3 (17). Beide lesen dieselbe
// Maßnahmenliste und denselben Gleichzeitigkeitsfaktor — Gutachten und Analyse
// können deshalb nicht auseinanderlaufen.
//
// Methode (Stand 09/2026, bewusst die der NAP-Analyse): Ausgangspunkt ist die
// gemessene Höchstlast. Ein Neubau addiert, ein Rückbau subtrahiert die
// Anschlussleistung seiner Assets, jeweils mal Gleichzeitigkeitsfaktor. Ob der
// Rückbau später anteilig an der Messung ausgerichtet wird, ist noch offen —
// eine Änderung gehört dann hierher und gilt für beide Stellen zugleich.
//
// Gleichzeitigkeit (09/2026): Der globale GZF gilt nur für die Gebäudeverbraucher. Wärmeerzeuger
// laufen bei Normaußentemperatur gemeinsam (GZF 1,0), ein Ladepark bringt seinen eigenen GZF schon
// in bpLadeLeistung mit — ein zweiter GZF darauf hätte die Ladeleistung doppelt gemindert. Übrige
// Verbraucher (Batterie im Ladebetrieb) gehen dimensionierungssicher voll ein.
//
// Erzeugung (Entscheidung 09/2026, dimensionierungssicher): PV, KWK, Wind und Batterien im
// Einspeisebetrieb mindern die Bezugsleistung NICHT — zum Zeitpunkt der Höchstlast ist ihre
// Leistung nicht gesichert. Ihre Einspeiseleistung wird getrennt ausgewiesen (Gutachten 3.3.4) —
// mit voller Nennleistung ohne Gleichzeitigkeitsfaktor, weil z. B. PV-Anlagen zeitgleich einspeisen.
// Notstromaggregate laufen nur bei Netzausfall und zählen weder als Last noch als Erzeugung.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.

/** Asset-Typen mit Leistungsbeitrag am Netzanschlusspunkt. */
export const BP_LEISTUNGS_TYPEN = ['Verbraucher', 'Lade', 'TWW', 'WP', 'Geo', 'FG', 'Stromkessel', 'PV', 'KWK', 'Wind', 'Batterie'];

const ERZEUGER_TYPEN    = ['PV', 'Wind', 'KWK'];
const VERBRAUCHER_TYPEN = ['Verbraucher', 'Lade', 'TWW', 'WP', 'Geo', 'FG', 'Stromkessel'];

/**
 * Stufen der Bedarfsprognose in Gutachten-Reihenfolge. Jede Stufe baut auf der
 * vorigen auf. Übrige Verbraucher (z. B. Batterie im Ladebetrieb) laufen unter
 * „sonstige" und gehen erst in die resultierende Anschlussleistung (3.3.4) ein.
 */
export const BP_STUFEN = [
  { key: 'gebaeude', kapitel: '3.3.1', label: 'Gebäude',           typen: ['Verbraucher'] },
  { key: 'waerme',   kapitel: '3.3.2', label: 'Wärmekonzept',      typen: ['WP', 'Geo', 'FG', 'Stromkessel', 'TWW'] },
  { key: 'lade',     kapitel: '3.3.3', label: 'Ladeinfrastruktur', typen: ['Lade'] },
];

export function bpStufeVonTyp(type) {
  return BP_STUFEN.find(s => s.typen.includes(type))?.key || 'sonstige';
}

/** Asset-Typen, auf deren Bezugsleistung der globale Gleichzeitigkeitsfaktor wirkt. */
export const BP_GZF_TYPEN = ['Verbraucher'];

/** Wirksamer Gleichzeitigkeitsfaktor für die Bezugsleistung eines Asset-Typs. */
export function bpGzfFuer(type, gzf) {
  return BP_GZF_TYPEN.includes(type) ? gzf : 1;
}

const zahl = v => parseFloat(v) || 0;

/**
 * Gleichzeitigkeitsfaktor aus Eingabe oder Projektdatei: 0,1 … 1, sonst 1,0.
 * Ein GZF über 1 oder bis 0 hätte keine fachliche Bedeutung.
 */
export function bpNormGzf(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1.0;
  return Math.min(1, Math.max(0.1, n));
}

/**
 * Auslegungsleistung eines Ladeparks: Normalladepunkte × Leistung je Punkt ×
 * Gleichzeitigkeitsfaktor des Ladeparks, dazu die Schnellladepunkte voll.
 * Dieselbe Formel und dieselben Vorgaben wie ladeProfil8760 (13r) und der Inspector.
 */
export function bpLadeLeistung(props) {
  const p = props || {};
  const punkte     = parseInt(p.anzahlPunkte) || 8;
  const kwProPunkt = parseFloat(p.leistungProPunktKW) || 11;
  const gzf        = Math.min(1, Math.max(0, parseFloat(p.gleichzeitigFaktor) || 0.3));
  const schnell    = parseInt(p.anzahlSchnell) || 0;
  const kwSchnell  = parseFloat(p.leistungSchnellKW) || 150;
  return { punkte, kwProPunkt, gzf, schnell, kwSchnell, kw: punkte * kwProPunkt * gzf + schnell * kwSchnell };
}

/**
 * Bezugs- und Einspeiseleistung eines Assets in kW, ohne den globalen
 * Gleichzeitigkeitsfaktor (der eigene eines Ladeparks ist enthalten).
 * Trägt das Asset ein eigenes Profil, ersetzt dessen Spitze die Leistung in der
 * Richtung, in die das Asset wirkt.
 */
export function bpAssetLeistung(a) {
  const ep = a?.props || {};
  let loadKW = 0, genKW = 0;
  switch (a?.type) {
    case 'Verbraucher': loadKW = zahl(ep.leistungKW); break;
    case 'TWW':         loadKW = zahl(ep.leistungKW); break;
    case 'Lade':        loadKW = bpLadeLeistung(ep).kw; break;
    // Wärmepumpen: elektrischer Bedarf (Heizleistung ÷ JAZ aus dem Erzeuger-Tab), wie im Stromnetz (05b)
    case 'WP':
    case 'Geo':
    case 'FG':          loadKW = zahl(ep.leistungElKW) || zahl(ep.leistungKW); break;
    case 'Stromkessel': loadKW = zahl(ep.leistungKW); break;
    case 'PV':          genKW  = zahl(ep.leistungKWp); break;
    case 'KWK':         genKW  = zahl(ep.leistungElKW); break;
    case 'Wind':        genKW  = zahl(ep.leistungKW); break;
    case 'Batterie':
      if ((ep.betriebsmodus || 'einspeisung') === 'verbraucher') loadKW = zahl(ep.leistungKW);
      else genKW = zahl(ep.leistungKW);
      break;
  }
  const werte = a?.profil?.werte;
  if (werte?.length > 0) {
    let peak = -Infinity;
    for (const v of werte) {
      const w = a.profil.invertSign ? -v : v;
      if (w > peak) peak = w;
    }
    if (peak > 0) {
      // Richtung VOR dem Überschreiben bestimmen. Bis 09/2026 waren die beiden
      // Bedingungen über Kreuz verknüpft: ein Verbraucher mit Profil bekam seine
      // Spitze zusätzlich als Einspeisung (netto 0 kW), eine PV zusätzlich als Last.
      const erzeuger    = genKW  > 0 || ERZEUGER_TYPEN.includes(a.type);
      const verbraucher = loadKW > 0 || VERBRAUCHER_TYPEN.includes(a.type);
      if (erzeuger)    genKW  = peak;
      if (verbraucher) loadKW = peak;
    }
  }
  return { loadKW, genKW };
}

/**
 * Maßnahmen gegenüber dem Messjahr: Neubau (Baujahr danach) und Rückbau
 * (Abrissjahr danach, Asset heute vorhanden). Haken aus einer früheren Liste
 * bleiben erhalten; neue Einträge sind angehakt.
 */
export function bpMassnahmen(assets, dataYear, vorher = null) {
  const alt = Array.isArray(vorher) ? vorher : [];
  const haken = id => alt.find(m => m.id === id)?.checked ?? true;
  const list = [];

  for (const a of assets || []) {
    if (!BP_LEISTUNGS_TYPEN.includes(a.type)) continue;
    const bj = parseInt(a.baujahr)    || null;
    const aj = parseInt(a.abrissjahr) || null;
    const { loadKW, genKW } = bpAssetLeistung(a);
    const gemeinsam = {
      name: a.name || a.type, type: a.type, buildingId: a.buildingId ?? null,
      loadKW, genKW, netKW: loadKW - genKW, baujahr: bj, abrissjahr: aj,
    };

    if (bj && bj > dataYear) {
      list.push({ id: a.id, ...gemeinsam, isAbbruch: false, checked: haken(a.id) });
    }
    // Rückbau nur, wenn das Asset heute steht und etwas beiträgt
    if (aj && aj > dataYear && (!bj || bj <= dataYear) && (loadKW > 0 || genKW > 0)) {
      const id = a.id + '__abr';
      list.push({ id, assetId: a.id, ...gemeinsam, isAbbruch: true, checked: haken(id) });
    }
  }

  const jahr = m => (m.isAbbruch ? m.abrissjahr : m.baujahr) || 9999;
  list.sort((a, b) => jahr(a) - jahr(b));
  return list;
}

/** +1 = Neubau wirkt im Jahr, −1 = Rückbau ist vollzogen, 0 = (noch) ohne Wirkung. */
export function bpWirkungImJahr(m, jahr) {
  if (m.isAbbruch) return jahr >= (m.abrissjahr || 9999) ? -1 : 0;
  const bj = m.baujahr || 0, aj = m.abrissjahr || 9999;
  return (jahr < bj || jahr >= aj) ? 0 : 1;
}

/** Zusätzliche Bezugsleistung (mal GZF je Typ, bpGzfFuer) und Einspeiseleistung (volle Nennleistung) aller übergebenen Maßnahmen in einem Jahr. */
export function bpLastJahr(massnahmen, jahr, gzf) {
  let addLoad = 0, addGen = 0;
  for (const m of massnahmen || []) {
    const s = bpWirkungImJahr(m, jahr);
    if (!s) continue;
    addLoad += s * m.loadKW * bpGzfFuer(m.type, gzf);
    addGen  += s * m.genKW;
  }
  return { addLoad, addGen };
}

/** Spätestes Maßnahmenjahr der angehakten Maßnahmen — der Endausbau. */
export function bpZieljahr(massnahmen) {
  let max = null;
  for (const m of massnahmen || []) {
    if (!m.checked) continue;
    const j = m.isAbbruch ? m.abrissjahr : m.baujahr;
    if (j && (max == null || j > max)) max = j;
  }
  return max;
}

const summe = arr => arr.reduce((s, v) => s + v, 0);

/** Bezugsleistung (mal GZF) und Einspeiseleistung (ohne GZF) je Jahr von `von` bis `bis` — nur angehakte Maßnahmen. */
export function bpJahresreihe({ basisKw = 0, gzf = 1, massnahmen = [], von, bis } = {}) {
  const aktiv = (massnahmen || []).filter(m => m.checked);
  const out = [];
  for (let jahr = von; jahr <= bis; jahr++) {
    const { addLoad, addGen } = bpLastJahr(aktiv, jahr, gzf);
    out.push({ jahr, bezugKw: basisKw + addLoad, einspeisungKw: addGen });
  }
  return out;
}

/**
 * Leistungsstufen bis zum Zieljahr: Bestand → Gebäude → Wärmekonzept →
 * Ladeinfrastruktur (→ sonstige). Nur angehakte Maßnahmen zählen.
 * Jeder Eintrag trägt seine vorzeichenbehaftete Bezugswirkung `kw` (mal GZF je Typ); Erzeugung
 * mindert den Bezug nicht und steht getrennt unter `einspeisung`.
 * endKw entspricht exakt Basis + bpLastJahr(...).addLoad im Zieljahr, einspeisung.kw dessen addGen.
 */
export function bpStufen({ basisKw = 0, gzf = 1, massnahmen = [], zieljahr = null } = {}) {
  const alle  = massnahmen || [];
  const aktiv = alle.filter(m => m.checked);
  const zj = Number.isFinite(zieljahr) ? zieljahr : bpZieljahr(aktiv);

  const eintraege = [], einspeiseEintraege = [];
  if (zj != null) {
    for (const m of aktiv) {
      const s = bpWirkungImJahr(m, zj);
      if (!s) continue;
      if (m.loadKW > 0) eintraege.push({ m, kw: s * m.loadKW * bpGzfFuer(m.type, gzf) });
      if (m.genKW > 0)  einspeiseEintraege.push({ m, kw: s * m.genKW });   // Einspeisung ohne GZF
    }
  }

  let stand = basisKw;
  const stufen = BP_STUFEN.map(s => {
    const e = eintraege.filter(x => s.typen.includes(x.m.type));
    const rueckbauKw = summe(e.filter(x => x.m.isAbbruch).map(x => x.kw));
    const zubauKw    = summe(e.filter(x => !x.m.isAbbruch).map(x => x.kw));
    const startKw = stand;
    stand += rueckbauKw + zubauKw;
    return { key: s.key, kapitel: s.kapitel, label: s.label, startKw, rueckbauKw, zubauKw, endKw: stand, eintraege: e };
  });

  const sonst = eintraege.filter(x => bpStufeVonTyp(x.m.type) === 'sonstige');
  const sonstigeKw = summe(sonst.map(x => x.kw));
  return {
    zieljahr: zj, basisKw, gzf, stufen,
    sonstige: { kw: sonstigeKw, eintraege: sonst },
    endKw: stand + sonstigeKw,
    einspeisung: { kw: summe(einspeiseEintraege.map(x => x.kw)), eintraege: einspeiseEintraege },
    abgewaehlt: alle.length - aktiv.length,
  };
}
