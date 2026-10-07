// ── lib/quartier-herausloesen.js — Teilbereich einer Liegenschaft als eigenes Projekt ──
// DOM-frei. Aus der Projektdatei der ganzen Liegenschaft wird eine Datei nur für ein Quartier:
// Gebäude im Bereich, Trassen im Bereich (an der Bereichsgrenze abgeschnitten), Freiflächen im
// Bereich und alle allgemeinen Annahmen (Klima, Netztemperaturen, Preise, PV-Modul, Nutzungstypen).
// Nicht übernommen wird alles, was zur ganzen Liegenschaft gehört oder neu zu planen ist:
// Wärmenetz, Erzeuger, Varianten, Verbräuche/Lastgang, Bestandsanlage, Stromnetz, Gutachten.

/** Allgemeine Annahmen, die unverändert in das Quartier übergehen. */
const UEBERNEHMEN = [
  'version', 'economicScenario', 'pvModul', 'pvPanel', 'pvProfile', 'customNutzungstypen', 'customElSlpProfiles',
  'heizoelEmF', 'pelletsEmF', 'stromEmF', 'pefStrom', 'pefPellets', 'overlays',
];

/** Punkt-in-Polygon (Strahlverfahren) für { lat, lng }. */
export function punktInPolygon(p, poly) {
  if (!p || !Array.isArray(poly) || poly.length < 3) return false;
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng) innen = !innen;
  }
  return innen;
}

/** Schwerpunkt eines Gebäudes (Mittel der Polygonpunkte, sonst lat/lng). */
export function gebaeudeMitte(g) {
  const pts = Array.isArray(g?.polygon) ? g.polygon.filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) : [];
  if (pts.length) return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
  return Number.isFinite(g?.lat) && Number.isFinite(g?.lng) ? { lat: g.lat, lng: g.lng } : null;
}

/** IDs der Gebäude, deren Mitte im Bereich liegt. */
export function gebaeudeImBereich(gebaeude, bereich) {
  return (gebaeude || []).filter(g => punktInPolygon(gebaeudeMitte(g), bereich)).map(g => g.id);
}

/** Rechteck um die Gebäude, um pufferM erweitert — Bereich, wenn nur Gebäude ausgewählt wurden. */
export function bereichUmGebaeude(gebaeude, pufferM = 40) {
  const pts = (gebaeude || []).flatMap(g => (Array.isArray(g.polygon) && g.polygon.length ? g.polygon : [gebaeudeMitte(g)]).filter(Boolean));
  if (!pts.length) return null;
  const lat = pts.map(p => p.lat), lng = pts.map(p => p.lng);
  const dLat = pufferM / 111320, dLng = pufferM / (111320 * Math.cos(((Math.min(...lat) + Math.max(...lat)) / 2) * Math.PI / 180));
  const s = Math.min(...lat) - dLat, n = Math.max(...lat) + dLat, w = Math.min(...lng) - dLng, o = Math.max(...lng) + dLng;
  return [{ lat: s, lng: w }, { lat: s, lng: o }, { lat: n, lng: o }, { lat: n, lng: w }];
}

/** Trassenabschnitte im Bereich: Punkte außerhalb werden abgeschnitten, ein Abschnitt kann dabei
 *  in mehrere Stücke zerfallen. Ergebnis mit neu nummerierten Punkten. */
export function trassenImBereich(punkte, segmente, bereich) {
  const neuPunkte = [], neuSegmente = [];
  for (const seg of segmente || []) {
    const lauf = [];
    const abschliessen = () => {
      if (lauf.length >= 2) {
        const start = neuPunkte.length;
        neuPunkte.push(...lauf.map(p => ({ lat: p.lat, lng: p.lng })));
        neuSegmente.push({ ...seg, start, end: neuPunkte.length - 1 });
      }
      lauf.length = 0;
    };
    for (let i = seg.start; i <= seg.end; i++) {
      const p = punkte?.[i];
      if (p && punktInPolygon(p, bereich)) lauf.push(p); else abschliessen();
    }
    abschliessen();
  }
  return { punkte: neuPunkte, segmente: neuSegmente };
}

/**
 * projekt: Projektdatei der Liegenschaft (_buildProjectData()). o: { gebIds, bereich (Polygon), name, quelle, datum }.
 * Ergebnis: { projekt, info: { gebaeude, waermeMwh, heizlastKw, trassen, freiflaechen } }.
 */
export function quartierProjekt(projekt, o = {}) {
  const ids = new Set(o.gebIds || []);
  const gebaeude = (projekt.gebaeude || []).filter(g => ids.has(g.id)).map(g => ({ ...g }));
  const bereich = Array.isArray(o.bereich) && o.bereich.length >= 3 ? o.bereich : bereichUmGebaeude(gebaeude);
  const neu = {};
  for (const k of UEBERNEHMEN) if (projekt[k] !== undefined) neu[k] = structuredClone(projekt[k]);
  neu.gebaeude = gebaeude;

  // Klima und Netztemperaturen bleiben; Verbräuche, Lastgang, Witterung und Bestandsanlage gehören zur ganzen Liegenschaft
  const wg = projekt.waermeGrundlagen || {};
  neu.waermeGrundlagen = {
    ...structuredClone(wg),
    gesamtMwh: '', monatswerte: Array.from({ length: 12 }, () => ''), lastgangKw: null, timeSeriesMeta: null,
    bestandsanlage: null, witterung: null,
  };
  // Netzparameter ja, Zentrale und Sperre nein — das Quartier bekommt ein eigenes Netz
  if (projekt.netz) neu.netz = { ...structuredClone(projekt.netz), zentrale: '', isLocked: false, sanierung: false };

  const tr = bereich ? trassenImBereich(projekt.trasse || [], projekt.trasseSegments || [], bereich) : { punkte: [], segmente: [] };
  neu.trasse = tr.punkte;
  neu.trasseSegments = tr.segmente;
  neu.freiflaechen = bereich
    ? (projekt.freiflaechen || []).filter(ff => punktInPolygon(gebaeudeMitte({ polygon: ff.polygon }), bereich)).map(ff => structuredClone(ff))
    : [];

  const sd = projekt.projektStammdaten || {};
  neu.projektStammdaten = {
    ...structuredClone(sd),
    kaserneName: [sd.kaserneName, o.name].filter(Boolean).join(' – '),
  };
  neu.herausgeloestAus = {
    projekt: o.quelle || sd.kaserneName || '', datum: o.datum || '', anzahlGebaeude: gebaeude.length,
    gesamtGebaeude: (projekt.gebaeude || []).length, bereich: bereich || null,
  };

  const zahl = v => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  return {
    projekt: neu,
    info: {
      gebaeude: gebaeude.length,
      waermeMwh: gebaeude.reduce((s, g) => s + zahl(g.waerme), 0),
      heizlastKw: gebaeude.reduce((s, g) => s + zahl(g.heizlast), 0),
      trassen: tr.segmente.length,
      freiflaechen: neu.freiflaechen.length,
    },
  };
}
