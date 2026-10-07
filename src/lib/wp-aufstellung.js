// ── lib/wp-aufstellung.js — Aufstellfläche der Außengeräte einer Luft-Wasser-Wärmepumpe ──
// DOM-frei. Überschlägige Anordnung aus Gerätegröße, Luft- und Wartungsabständen, damit die
// benötigte Fläche auf der Karte abgeschätzt werden kann. Richtwerte — Herstellerangaben sind maßgeblich.

/** Typische Außengeräte (Monoblock bzw. Verdampfereinheit): Heizleistung (A7/W45), Länge × Tiefe × Höhe in m,
 *  Ventilatoren (Anzahl, Durchmesser in m, oben = nach oben ausblasend, sonst seitlich; ventReihen = nebeneinander quer),
 *  technikL = Länge des Technikteils ohne Ventilatoren an einer Stirnseite, abstaende = Mindestabstände des Geräts
 *  (sonst WP_ABSTAENDE). Bis 300 kW Richtwerte; die Großgeräte nach Herstellerdatenblättern luftgekühlter
 *  R290-Wärmepumpen mit V-Registern (Mindestabstand 1,0 m an den Längsseiten, 1,0 / 1,5 m an den Stirnseiten). */
const GROSS_ABSTAENDE = { luft: 1.0, wartung: 1.25, geraet: 1.5, reihe: 2.0 };
export const WP_MODULE = [
  { kw: 16, l: 1.3, b: 0.6, h: 1.4, ventilatoren: 1, dm: 0.6, oben: false },
  { kw: 40, l: 1.9, b: 1.0, h: 1.7, ventilatoren: 2, dm: 0.7, oben: true },
  { kw: 80, l: 2.8, b: 1.2, h: 2.0, ventilatoren: 3, dm: 0.8, oben: true },
  { kw: 160, l: 4.2, b: 2.2, h: 2.3, ventilatoren: 4, dm: 0.9, oben: true },
  { kw: 300, l: 6.5, b: 2.3, h: 2.5, ventilatoren: 6, dm: 0.9, oben: true },
  { kw: 515, l: 7.9, b: 2.3, h: 2.45, ventilatoren: 8, ventReihen: 2, dm: 0.85, oben: true, technikL: 2.34, abstaende: GROSS_ABSTAENDE },
  { kw: 570, l: 7.9, b: 2.3, h: 2.45, ventilatoren: 8, ventReihen: 2, dm: 0.85, oben: true, technikL: 2.34, abstaende: GROSS_ABSTAENDE },
  { kw: 650, l: 7.9, b: 2.3, h: 2.45, ventilatoren: 8, ventReihen: 2, dm: 0.85, oben: true, technikL: 2.34, abstaende: GROSS_ABSTAENDE },
  { kw: 710, l: 10.5, b: 2.3, h: 2.45, ventilatoren: 12, ventReihen: 2, dm: 0.85, oben: true, technikL: 2.34, abstaende: GROSS_ABSTAENDE },
  { kw: 810, l: 10.5, b: 2.3, h: 2.45, ventilatoren: 12, ventReihen: 2, dm: 0.85, oben: true, technikL: 2.34, abstaende: GROSS_ABSTAENDE },
];

/** Mindestabstände eines Geräts: eigene Herstellerwerte oder die allgemeinen Richtwerte. */
export function wpAbstaende(modul) { return { ...WP_ABSTAENDE, ...(modul?.abstaende || {}) }; }

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
  const a = wpAbstaende(modul);
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
  return { modul, anzahl, reihen, jeReihe, laenge, breite, flaeche: laenge * breite, flaecheGeraete: anzahl * modul.l * modul.b, geraete, abstaende: a };
}

/**
 * Wie wpAufstellung, aber mit vorgegebener Länge der Fläche (z. B. auf der Karte gezogen). Ziel ist die
 * gleiche Fläche wie bei der automatischen Anordnung (Breite = Fläche / Länge); die Geräte werden in so viele
 * Reihen gelegt, wie die Länge erlaubt. Reichen Länge oder Breite dafür nicht, wächst die Fläche so weit,
 * dass alle Luft- und Wartungsabstände eingehalten sind — die Anordnung passt also immer.
 * o: wie wpAufstellung plus laenge (m, optional).
 * Ergebnis zusätzlich: flaecheAuto (m² der automatischen Anordnung), mehrFlaeche (m², um die die Form größer ist).
 */
export function wpAufstellungForm(leistungKw, o = {}) {
  const auto = wpAufstellung(leistungKw, o);
  const L0 = Number(o.laenge);
  if (!Number.isFinite(L0) || L0 <= 0) return { ...auto, passt: true, formFrei: false, flaecheAuto: auto.flaeche, mehrFlaeche: 0 };
  const { modul, anzahl } = auto;
  const a = auto.abstaende;
  const ziel = auto.flaeche;
  const minL = modul.l + 2 * a.wartung;                                   // ein Gerät je Reihe
  const maxL = anzahl * modul.l + (anzahl - 1) * a.geraet + 2 * a.wartung; // alle in einer Reihe
  const wunschL = Math.min(Math.max(L0, minL), maxL);
  const jeReihe = Math.max(1, Math.min(anzahl, Math.floor((wunschL - 2 * a.wartung + a.geraet) / (modul.l + a.geraet) + 1e-9)));
  const reihen = Math.ceil(anzahl / jeReihe);
  const brauchtL = 2 * a.wartung + jeReihe * modul.l + (jeReihe - 1) * a.geraet;
  const brauchtB = 2 * a.luft + reihen * modul.b + (reihen - 1) * a.reihe;
  const laenge = Math.max(wunschL, brauchtL);
  const breite = Math.max(ziel / laenge, brauchtB);                       // im Notfall etwas breiter
  const flaeche = laenge * breite;
  // zusätzliche Breite geht als Luftraum zwischen die Reihen bzw. gleichmäßig an die Ränder
  const reihenAbstand = reihen > 1 ? Math.max(a.reihe, (breite - 2 * a.luft - reihen * modul.b) / (reihen - 1)) : 0;
  const block = reihen * modul.b + (reihen - 1) * reihenAbstand;
  const geraete = [];
  for (let r = 0; r < reihen; r++) {
    const inReihe = Math.min(jeReihe, anzahl - r * jeReihe);
    const reiheL = inReihe * modul.l + (inReihe - 1) * a.geraet;
    const y = -block / 2 + modul.b / 2 + r * (modul.b + reihenAbstand);
    for (let i = 0; i < inReihe; i++) geraete.push({ x: -reiheL / 2 + modul.l / 2 + i * (modul.l + a.geraet), y, l: modul.l, b: modul.b });
  }
  return { ...auto, laenge, breite, flaeche, reihen, jeReihe, geraete, passt: true, formFrei: true,
    flaecheAuto: ziel, mehrFlaeche: Math.max(0, flaeche - ziel), minL, maxL };
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

/**
 * Dreiecke der Außengeräte für die 3D-Ansicht, in Metern relativ zur Flächenmitte (x Ost, y Nord, z oben).
 * auf: Ergebnis von wpAufstellung(Form), drehungGrad: Drehung im Uhrzeigersinn.
 * Ergebnis: [{ teil: 'fundament'|'gehaeuse'|'register'|'luefter'|'nabe', t: [[x,y,z],[x,y,z],[x,y,z]] }]
 * Gehäuse hell, die Längsseiten als dunkle Wärmetauscher-Register, Ventilatoren als dunkle Scheiben
 * (oben ausblasend; kleine Monoblöcke seitlich).
 */
export function wpGeraete3d(auf, drehungGrad = 0) {
  const w = (Number(drehungGrad) || 0) * Math.PI / 180, c = Math.cos(w), s = Math.sin(w);
  const P = (x, y, z) => [x * c + y * s, -x * s + y * c, z];
  const out = [];
  const tri = (teil, a, b, d) => out.push({ teil, t: [a, b, d] });
  const quad = (teil, a, b, d, e) => { tri(teil, a, b, d); tri(teil, a, d, e); };
  const box = (cx, cy, l, b, z0, z1, teile) => {
    const x0 = cx - l / 2, x1 = cx + l / 2, y0 = cy - b / 2, y1 = cy + b / 2;
    quad(teile.oben, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1));
    quad(teile.lang, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));   // Längsseite Süd
    quad(teile.lang, P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1));   // Längsseite Nord
    quad(teile.kurz, P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1));
    quad(teile.kurz, P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1));
  };
  const scheibe = (teil, mitte, r, achse, n = 16) => {
    // achse 'z': waagerecht (oben), 'y': senkrecht in der Längsseite
    const punkt = a => achse === 'z'
      ? P(mitte[0] + r * Math.cos(a), mitte[1] + r * Math.sin(a), mitte[2])
      : P(mitte[0] + r * Math.cos(a), mitte[1], mitte[2] + r * Math.sin(a));
    const m = P(mitte[0], mitte[1], mitte[2]);
    for (let i = 0; i < n; i++) tri(teil, m, punkt(2 * Math.PI * i / n), punkt(2 * Math.PI * (i + 1) / n));
  };
  const FUND = 0.15;
  box(0, 0, auf.laenge, auf.breite, 0, FUND, { oben: 'fundament', lang: 'fundament', kurz: 'fundament' });
  const mod = auf.modul;
  for (const g of auf.geraete) {
    const zOben = FUND + mod.h;
    // Sockel/Rahmen unten hell, darüber Register an den Längsseiten; Großgeräte mit geschlossenem Technikteil an einer Stirnseite
    const tl = Math.min(mod.technikL || 0, g.l * 0.5), rl = g.l - tl;
    const rx = g.x - g.l / 2 + rl / 2;
    box(g.x, g.y, g.l, g.b, FUND, FUND + 0.25, { oben: 'gehaeuse', lang: 'gehaeuse', kurz: 'gehaeuse' });
    box(rx, g.y, rl, g.b, FUND + 0.25, zOben, { oben: 'gehaeuse', lang: 'register', kurz: 'gehaeuse' });
    if (tl > 0) box(g.x + g.l / 2 - tl / 2, g.y, tl, g.b, FUND + 0.25, zOben - 0.1, { oben: 'gehaeuse', lang: 'gehaeuse', kurz: 'gehaeuse' });
    const n = mod.ventilatoren || 1, dm = mod.dm || 0.6;
    if (mod.oben) {
      const quer = Math.max(1, mod.ventReihen || 1), laengs = Math.ceil(n / quer);
      for (let i = 0; i < laengs; i++) {
        for (let j = 0; j < quer; j++) {
          const fx = rx - rl / 2 + rl * (i + 0.5) / laengs;
          const fy = g.y - g.b / 2 + g.b * (j + 0.5) / quer;
          scheibe('luefter', [fx, fy, zOben + 0.02], Math.min(dm / 2, rl / laengs / 2 * 0.9, g.b / quer / 2 * 0.9), 'z');
          scheibe('nabe', [fx, fy, zOben + 0.03], 0.08, 'z', 8);
        }
      }
    } else {
      // kleiner Monoblock: Ventilator in der Längsseite (Ausblas nach vorn)
      scheibe('luefter', [g.x, g.y - g.b / 2 - 0.01, FUND + 0.25 + (mod.h - 0.25) / 2], Math.min(dm / 2, (mod.h - 0.3) / 2), 'y');
      scheibe('nabe', [g.x, g.y - g.b / 2 - 0.02, FUND + 0.25 + (mod.h - 0.25) / 2], 0.07, 'y', 8);
    }
  }
  return out;
}
