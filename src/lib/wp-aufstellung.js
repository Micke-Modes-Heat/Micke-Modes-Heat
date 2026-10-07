// ── lib/wp-aufstellung.js — Aufstellfläche der Außengeräte einer Luft-Wasser-Wärmepumpe ──
// DOM-frei. Überschlägige Anordnung aus Gerätegröße, Luft- und Wartungsabständen, damit die
// benötigte Fläche auf der Karte abgeschätzt werden kann. Richtwerte — Herstellerangaben sind maßgeblich.

/** Typische Außengeräte (Monoblock bzw. Verdampfereinheit): Heizleistung, Länge × Tiefe in m. */
export const WP_MODULE = [
  { kw: 16, l: 1.3, b: 0.6 },
  { kw: 40, l: 1.9, b: 1.0 },
  { kw: 80, l: 2.8, b: 1.2 },
  { kw: 160, l: 4.2, b: 2.2 },
  { kw: 300, l: 6.5, b: 2.3 },
];

/** Abstände in m: Luftseite (Ansaugen/Ausblasen, vorn und hinten), Wartung an den Stirnseiten,
 *  zwischen Geräten einer Reihe und zwischen zwei Reihen (gegen Luftkurzschluss). */
export const WP_ABSTAENDE = { luft: 1.5, wartung: 0.8, geraet: 0.6, reihe: 2.0 };

const MAX_JE_REIHE = 4;

function modulWaehlen(leistungKw, modulKw) {
  const fest = WP_MODULE.find(m => m.kw === Number(modulKw));
  if (fest) return fest;
  // kleinste Gerätegröße, mit der höchstens vier Geräte reichen; sonst die größte
  return WP_MODULE.find(m => Math.ceil(leistungKw / m.kw) <= MAX_JE_REIHE) || WP_MODULE[WP_MODULE.length - 1];
}

/**
 * leistungKw: Heizleistung gesamt. o: { modulKw ('auto' | kW aus WP_MODULE), reihen ('auto' | Anzahl) }.
 * Ergebnis: { modul, anzahl, reihen, jeReihe, laenge, breite, flaeche (m² brutto inkl. Abstände),
 *   flaecheGeraete (m² Stellfläche), geraete: [{ x, y, l, b }] } — x/y = Gerätemitte in m,
 *   Ursprung = Flächenmitte, x entlang der Reihe, y quer dazu (Luftrichtung).
 */
export function wpAufstellung(leistungKw, o = {}) {
  const kw = Math.max(1, Number(leistungKw) || 0);
  const modul = modulWaehlen(kw, o.modulKw);
  const anzahl = Math.max(1, Math.ceil(kw / modul.kw - 1e-9));
  const wunsch = Number(o.reihen);
  const reihen = Number.isFinite(wunsch) && wunsch >= 1
    ? Math.min(anzahl, Math.round(wunsch))
    : Math.ceil(anzahl / MAX_JE_REIHE);
  const jeReihe = Math.ceil(anzahl / reihen);
  const a = WP_ABSTAENDE;
  const laenge = 2 * a.wartung + jeReihe * modul.l + (jeReihe - 1) * a.geraet;
  const breite = 2 * a.luft + reihen * modul.b + (reihen - 1) * a.reihe;
  const geraete = [];
  for (let r = 0; r < reihen; r++) {
    const inReihe = Math.min(jeReihe, anzahl - r * jeReihe);
    const reiheL = inReihe * modul.l + (inReihe - 1) * a.geraet;
    const y = -breite / 2 + a.luft + modul.b / 2 + r * (modul.b + a.reihe);
    for (let i = 0; i < inReihe; i++) {
      geraete.push({ x: -reiheL / 2 + modul.l / 2 + i * (modul.l + a.geraet), y, l: modul.l, b: modul.b });
    }
  }
  return { modul, anzahl, reihen, jeReihe, laenge, breite, flaeche: laenge * breite, flaecheGeraete: anzahl * modul.l * modul.b, geraete };
}

/** Rechteck (Mitte cx/cy in m, Länge l entlang x, Breite b) um winkelGrad im Uhrzeigersinn gedreht
 *  → vier Ecken als { ost, nord } in m relativ zum Ursprung (Nord oben). */
export function rechteckEcken(cx, cy, l, b, winkelGrad = 0) {
  const w = (Number(winkelGrad) || 0) * Math.PI / 180;
  const c = Math.cos(w), s = Math.sin(w);
  return [[-l / 2, -b / 2], [l / 2, -b / 2], [l / 2, b / 2], [-l / 2, b / 2]].map(([dx, dy]) => {
    const x = cx + dx, y = cy + dy;
    // Kartenkoordinaten: x nach Osten, y nach Norden; Drehung im Uhrzeigersinn (wie ein Kompass)
    return { ost: x * c + y * s, nord: -x * s + y * c };
  });
}
