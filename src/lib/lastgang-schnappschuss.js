// ── lib/lastgang-schnappschuss.js — Der schmale Schnitt zwischen Erzeugung und Netz ──
//
// Alles, was die Infrastrukturseite über eine Erzeugervariante wissen muss,
// steckt in EINEM signierten Lastgang je Netzknoten: positiv = Bezug,
// negativ = Rückspeisung. Kein Wissen über PV-Ausrichtung, BHKW-Fahrweise oder
// Wärmepumpen-JAZ muss die Grenze überschreiten.
//
// Warum ein Schnappschuss und nicht der Live-Zustand: getNodeProfile8760 (13r)
// rechnet aus dem globalen Zustand — es gibt also immer nur die Profile der
// GERADE aktiven Variante. Für einen Vergleich müssen mehrere Stände zugleich
// vorliegen. Eingefroren lassen sich Varianten nebeneinanderlegen, und die
// Infrastrukturlogik bekommt ihre Eingabe gereicht, statt sie sich aus
// Globals zusammenzusuchen.
//
// Aufbewahrt werden die KENNWERTE je Knoten (klein, vergleichbar, speicherbar).
// Die vollen 8760er-Reihen bleiben optional und nur im Arbeitsspeicher — als
// Float32Array je Knoten wären sie für eine Projektdatei zu groß.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.

/**
 * Kennwerte einer Lastgangreihe.
 *
 * peak  — höchster Bezug (kW)
 * minV  — niedrigster Wert; negativ bedeutet Rückspeisung, der Betrag ist die
 *         maximale Einspeiseleistung. Für die Netzdimensionierung ist das der
 *         zweite maßgebende Wert neben dem Bezugsmaximum.
 */
export function knotenKennwerte(profil) {
  const p = profil || [];
  const n = p.length;
  if (!n) return { peak: 0, minV: 0, summe: 0, annualMwh: 0, vbh: 0, grundlast: 0, lastfaktor: 0 };

  let peak = -Infinity, minV = Infinity, summe = 0;
  for (let t = 0; t < n; t++) {
    const v = p[t];
    summe += v;
    if (v > peak) peak = v;
    if (v < minV) minV = v;
  }
  const annualMwh = summe / 1000;
  // Grundlast: Wert, der in 90 % der Stunden erreicht wird (absteigend sortiert)
  const sortiert = Array.from(p).sort((a, b) => b - a);
  const grundlast = sortiert[Math.floor(n * 0.9)] ?? 0;

  return {
    peak: peak === -Infinity ? 0 : peak,
    minV: minV === Infinity ? 0 : minV,
    summe,
    annualMwh,
    vbh: peak > 0 ? (annualMwh * 1000) / peak : 0,
    grundlast,
    lastfaktor: peak > 0 ? (summe / n) / peak : 0,
  };
}

/**
 * Friert die Knotenprofile eines Standes ein.
 *
 * knoten: [{ id, name, type, kapazitaetKW, profil }]
 * opts.mitProfilen — die vollen Reihen zusätzlich in `profile` (Map) behalten;
 *   nur für Weiterrechnungen im selben Lauf gedacht, nicht zum Speichern.
 *
 * Rückgabe: { jahr, varianteId, varianteName, knoten: [...], profile? }
 */
export function erstelleSchnappschuss({ jahr, varianteId = null, varianteName = '', knoten = [] } = {}, opts = {}) {
  const zeilen = knoten.map(k => {
    const kw = knotenKennwerte(k.profil);
    const kap = Number(k.kapazitaetKW) || 0;
    return {
      id: k.id,
      name: k.name ?? k.id,
      type: k.type ?? null,
      kapazitaetKW: kap,
      ...kw,
      // Auslastung in beide Richtungen — ohne Kapazität bleibt sie unbestimmt
      // (null statt 0, damit "unbekannt" nicht wie "unkritisch" aussieht).
      auslastungPct:    kap > 0 ? (kw.peak / kap) * 100 : null,
      rueckspeisungPct: kap > 0 ? (Math.abs(Math.min(0, kw.minV)) / kap) * 100 : null,
    };
  });

  const schnappschuss = { jahr, varianteId, varianteName, knoten: zeilen };
  if (opts.mitProfilen) {
    schnappschuss.profile = new Map(knoten.map(k => [k.id, k.profil]));
  }
  return schnappschuss;
}

/**
 * Knoten, die eine Grenze überschreiten — in Bezugs- ODER Rückspeiserichtung.
 * Beide Richtungen zu prüfen ist nötig: eine PV-lastige Variante belastet das
 * Netz rückwärts, ohne die Bezugsspitze anzurühren.
 */
export function schnappschussUeberlast(schnappschuss, grenzePct = 100) {
  return (schnappschuss?.knoten || []).filter(k =>
    (k.auslastungPct != null && k.auslastungPct > grenzePct) ||
    (k.rueckspeisungPct != null && k.rueckspeisungPct > grenzePct));
}

/**
 * Stellt zwei Schnappschüsse Knoten für Knoten gegenüber.
 *
 * Rückgabe je Knoten: { id, name, a, b, dPeak, dRueck } — a/b sind die
 * Kennwertzeilen (oder null, wenn der Knoten nur auf einer Seite vorkommt).
 * Nach der größten Veränderung der Bezugsspitze sortiert.
 */
export function vergleicheSchnappschuesse(a, b) {
  const links  = new Map((a?.knoten || []).map(k => [k.id, k]));
  const rechts = new Map((b?.knoten || []).map(k => [k.id, k]));
  const ids = [...new Set([...links.keys(), ...rechts.keys()])];

  return ids.map(id => {
    const l = links.get(id) || null;
    const r = rechts.get(id) || null;
    const rueck = k => Math.abs(Math.min(0, k?.minV ?? 0));
    return {
      id,
      name: l?.name ?? r?.name ?? id,
      a: l, b: r,
      dPeak:  (r?.peak ?? 0) - (l?.peak ?? 0),
      dRueck: rueck(r) - rueck(l),
    };
  }).sort((x, y) => Math.abs(y.dPeak) - Math.abs(x.dPeak));
}
