// lib/baum-vorlagen.js — Vorlagen für von Hand gesetzte Bäume und Baumbestände
//
// Statt jeden Baum gleich hoch zu setzen, zieht jede Vorlage Art, Höhe und Krone
// aus einer Mischung typischer mitteleuropäischer Bestände:
//   · Artenmischung in Gruppen (Gruppenmischung wie im Wald, nicht Baum-für-Baum)
//   · Höhen streuen zum Teil räumlich (gleichaltrige Partien) und zum Teil je Baum
//   · Waldrand: Bäume etwas niedriger, Kronen breiter (mehr Licht)
//   · Unterwuchs (jüngere, niedrigere Bäume) und Lücken
// Kronen im geschlossenen Bestand wachsen nicht frei: Durchmesser höchstens ~1,4 × Pflanzabstand.
// Reine Funktionen ohne DOM/Leaflet — Koordinaten in Metern (x Ost, y Nord).

/**
 * @typedef {{art:'laub'|'nadel'|'obst', anteil:number, hoehe:number, sd:number, kroneRel?:number, krone?:number}} BaumSchicht
 * @typedef {{name:string, gruppe:'einzel'|'bestand', text:string, abstand:number, schichten:BaumSchicht[],
 *   unterstand?:number, gleichaltrig?:number, gruppen?:number, luecken?:number}} BaumVorlage
 */

/** @type {Record<string, BaumVorlage>} Höhen in m (Mittel ± Standardabweichung), kroneRel = Krone / Höhe. */
export const BAUM_VORLAGEN = {
  laub: {
    name: 'Laubbaum', gruppe: 'einzel', text: 'Ahorn, Linde, Eiche — frei stehend',
    abstand: 10, gleichaltrig: 0.2,
    schichten: [{ art: 'laub', anteil: 1, hoehe: 14, sd: 3.5, kroneRel: 0.6 }],
  },
  strasse: {
    name: 'Straßenbaum / Allee', gruppe: 'einzel', text: 'gleich alt gepflanzt, wenig Streuung',
    abstand: 10, gleichaltrig: 0.8,
    schichten: [{ art: 'laub', anteil: 1, hoehe: 15, sd: 2, kroneRel: 0.55 }],
  },
  nadel: {
    name: 'Nadelbaum', gruppe: 'einzel', text: 'Fichte, Kiefer, Tanne — frei stehend',
    abstand: 7, gleichaltrig: 0.2,
    schichten: [{ art: 'nadel', anteil: 1, hoehe: 18, sd: 4, kroneRel: 0.32 }],
  },
  obst: {
    name: 'Obstbaum', gruppe: 'einzel', text: 'Hochstamm',
    abstand: 10, gleichaltrig: 0.2,
    schichten: [{ art: 'obst', anteil: 1, hoehe: 6.5, sd: 1.2, krone: 6.5 }],
  },
  mischwald: {
    name: 'Mischwald', gruppe: 'bestand', text: 'Buche, Eiche, Fichte, Kiefer in Gruppen',
    abstand: 6, unterstand: 0.15, gleichaltrig: 0.5, gruppen: 25, luecken: 0.05,
    schichten: [
      { art: 'laub', anteil: 0.6, hoehe: 24, sd: 5, kroneRel: 0.45 },
      { art: 'nadel', anteil: 0.4, hoehe: 26, sd: 5, kroneRel: 0.3 },
    ],
  },
  laubwald: {
    name: 'Laubwald', gruppe: 'bestand', text: 'Buchen-Eichen-Wald',
    abstand: 6.5, unterstand: 0.2, gleichaltrig: 0.6, gruppen: 30, luecken: 0.04,
    schichten: [{ art: 'laub', anteil: 1, hoehe: 26, sd: 4.5, kroneRel: 0.45 }],
  },
  fichtenforst: {
    name: 'Fichtenforst', gruppe: 'bestand', text: 'dicht, gleichaltrig, kaum Unterwuchs',
    abstand: 4.5, unterstand: 0.05, gleichaltrig: 0.85, gruppen: 40, luecken: 0.04,
    schichten: [{ art: 'nadel', anteil: 1, hoehe: 27, sd: 3, kroneRel: 0.25 }],
  },
  kiefernwald: {
    name: 'Kiefernwald', gruppe: 'bestand', text: 'lichter, etwas Birke und Eiche',
    abstand: 5.5, unterstand: 0.1, gleichaltrig: 0.7, gruppen: 30, luecken: 0.06,
    schichten: [
      { art: 'nadel', anteil: 0.9, hoehe: 21, sd: 3, kroneRel: 0.3 },
      { art: 'laub', anteil: 0.1, hoehe: 16, sd: 4, kroneRel: 0.45 },
    ],
  },
  jungwald: {
    name: 'Jungwald / Aufforstung', gruppe: 'bestand', text: 'junge Mischkultur, eng gepflanzt',
    abstand: 3, unterstand: 0, gleichaltrig: 0.7, gruppen: 15, luecken: 0.06,
    schichten: [
      { art: 'laub', anteil: 0.6, hoehe: 8, sd: 2.5, kroneRel: 0.5 },
      { art: 'nadel', anteil: 0.4, hoehe: 8, sd: 2.5, kroneRel: 0.35 },
    ],
  },
  feldgehoelz: {
    name: 'Feldgehölz / Waldrand', gruppe: 'bestand', text: 'ungleich alt, viel Unterwuchs',
    abstand: 4.5, unterstand: 0.35, gleichaltrig: 0.3, gruppen: 12, luecken: 0.1,
    schichten: [
      { art: 'laub', anteil: 0.85, hoehe: 11, sd: 4, kroneRel: 0.65 },
      { art: 'nadel', anteil: 0.15, hoehe: 12, sd: 4, kroneRel: 0.35 },
    ],
  },
  park: {
    name: 'Parkbäume', gruppe: 'bestand', text: 'weit gestellt, alte und junge Bäume',
    abstand: 14, unterstand: 0, gleichaltrig: 0.1, gruppen: 30, luecken: 0.15,
    schichten: [
      { art: 'laub', anteil: 0.8, hoehe: 18, sd: 6, kroneRel: 0.6 },
      { art: 'nadel', anteil: 0.2, hoehe: 20, sd: 6, kroneRel: 0.35 },
    ],
  },
  streuobst: {
    name: 'Streuobstwiese', gruppe: 'bestand', text: 'Hochstämme im weiten Raster',
    abstand: 10, unterstand: 0, gleichaltrig: 0.2, gruppen: 30, luecken: 0.08,
    schichten: [{ art: 'obst', anteil: 1, hoehe: 6.5, sd: 1.3, krone: 6.5 }],
  },
};

/** Streuung als Faktor auf die Standardabweichungen. */
export const BAUM_STREUUNG = {
  gleich: { name: 'gleichmäßig', faktor: 0.25 },
  natuerlich: { name: 'natürlich', faktor: 1 },
  stark: { name: 'stark', faktor: 1.6 },
};

const klemmen = (v, a, b) => Math.max(a, Math.min(b, v));
const KRONE_MAX = { laub: 25, obst: 12, nadel: 12 };

/** Mittlere Höhe der Vorlage (nach Anteilen) — Bezug für „mittlere Höhe" im Panel. */
export function vorlageHoehe(v) {
  const s = v.schichten.reduce((a, k) => a + k.anteil, 0) || 1;
  return v.schichten.reduce((a, k) => a + k.hoehe * k.anteil, 0) / s;
}

/** Kurzbeschreibung: „60 % Laub · 40 % Nadel · 14–34 m · Abstand 6 m · 15 % Unterwuchs". */
export function vorlageText(v, opt = {}) {
  const f = (opt.hoeheMittel > 0 ? opt.hoeheMittel / vorlageHoehe(v) : 1);
  const s = BAUM_STREUUNG[opt.streuung]?.faktor ?? 1;
  const ARTEN = { laub: 'Laub', nadel: 'Nadel', obst: 'Obst' };
  const teile = v.schichten.length > 1 ? [v.schichten.map(k => `${Math.round(k.anteil * 100)} % ${ARTEN[k.art]}`).join(' · ')] : [];
  const lo = Math.min(...v.schichten.map(k => (k.hoehe - 1.5 * k.sd * s) * f));
  const hi = Math.max(...v.schichten.map(k => (k.hoehe + 1.5 * k.sd * s) * f));
  teile.push(`${Math.max(1, Math.round(lo))}–${Math.round(hi)} m`);
  if (v.gruppe === 'bestand') teile.push(`Abstand ${String(opt.abstand ?? v.abstand).replace('.', ',')} m`);
  if (v.unterstand) teile.push(`${Math.round(v.unterstand * 100)} % Unterwuchs`);
  return teile.join(' · ');
}

/* ── Zufall und Rauschfelder ─────────────────────────────────────────────── */

/** Standardnormalverteilt (Box-Muller), auf ±2,2 begrenzt — keine Ausreißer-Riesen. */
function normal(zufall) {
  const u = Math.max(1e-9, zufall()), w = zufall();
  return klemmen(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w), -2.2, 2.2);
}

function hash3(seed, i, j) {
  let h = (seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Glattes Rauschfeld (Wertrauschen, zwei Oktaven) mit Werten etwa in [−1, 1].
 * Zellgröße in m bestimmt, wie groß die gleichartigen Partien sind.
 */
export function rauschFeld(seed, zelle) {
  const okt = (x, y, z, s) => {
    const gx = x / z, gy = y / z, i = Math.floor(gx), j = Math.floor(gy);
    const fx = gx - i, fy = gy - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v = (a, b) => hash3(s, a, b) * 2 - 1;
    const o = v(i, j) + (v(i + 1, j) - v(i, j)) * sx;
    const u = v(i, j + 1) + (v(i + 1, j + 1) - v(i, j + 1)) * sx;
    return o + (u - o) * sy;
  };
  return (x, y) => klemmen((0.7 * okt(x, y, zelle, seed) + 0.3 * okt(x, y, zelle / 2, seed + 7919)) * 1.6, -1, 1);
}

/* ── Ein Baum ────────────────────────────────────────────────────────────── */

/**
 * Art, Höhe, Krone, Farbton und Drehung eines Baums aus der Vorlage.
 * @param {BaumVorlage} v
 * @param {() => number} zufall  Werte in [0, 1)
 * @param {{streuung?:string, hoeheMittel?:number, artFeld?:number[], hoeheFeld?:number,
 *   rand?:number, kroneMax?:number, unterstand?:boolean}} [opt]
 *   artFeld: je Schicht ein Feldwert [−1, 1] (Gruppenmischung) · hoeheFeld: räumlicher Höhenanteil [−1, 1]
 *   rand: 0 (innen) … 1 (direkt am Rand) · kroneMax: Obergrenze aus dem Pflanzabstand
 */
export function vorlageBaum(v, zufall, opt = {}) {
  const s = BAUM_STREUUNG[opt.streuung]?.faktor ?? 1;
  const f = opt.hoeheMittel > 0 ? opt.hoeheMittel / vorlageHoehe(v) : 1;

  // Art: Anteil, in Gruppen verschoben (Feld), dann gezogen
  const gew = v.schichten.map((k, i) => k.anteil * Math.exp(1.4 * (opt.artFeld?.[i] ?? 0)));
  let r = zufall() * gew.reduce((a, b) => a + b, 0), k = v.schichten[v.schichten.length - 1];
  for (let i = 0; i < gew.length; i++) { r -= gew[i]; if (r <= 0) { k = v.schichten[i]; break; } }

  // Höhe: räumlicher Anteil (gleichaltrige Partien) + Einzelbaum
  const c = v.gleichaltrig ?? 0.3;
  const z = opt.hoeheFeld != null
    ? Math.sqrt(c) * opt.hoeheFeld * 1.6 + Math.sqrt(1 - c) * normal(zufall)
    : normal(zufall);
  let hoehe = (k.hoehe + k.sd * s * klemmen(z, -2.2, 2.2)) * f;
  const rand = klemmen(opt.rand ?? 0, 0, 1);
  if (opt.unterstand) hoehe *= 0.3 + 0.3 * zufall();      // Unterwuchs: 30–60 % der Bestandshöhe
  else hoehe *= 1 - 0.12 * rand;                           // Waldrand etwas niedriger
  hoehe = klemmen(hoehe, 1.5, 45);

  // Krone: frei aus der Höhe, im Bestand durch den Abstand begrenzt, am Rand breiter
  let krone = k.krone ? k.krone * f * (1 + 0.12 * s * normal(zufall))
    : hoehe * (k.kroneRel ?? 0.5) * (1 + 0.12 * s * normal(zufall));
  if (opt.kroneMax > 0) krone = Math.min(krone, opt.kroneMax * (opt.unterstand ? 0.7 : 1));
  krone *= 1 + 0.25 * rand * (opt.unterstand ? 0 : 1);
  krone = klemmen(krone, 1, KRONE_MAX[k.art] || 25);

  return {
    art: k.art, hoehe: Math.round(hoehe * 10) / 10, krone: Math.round(krone * 10) / 10,
    drehung: zufall() * Math.PI * 2, ton: Math.round((0.86 + 0.28 * zufall()) * 1000) / 1000,
  };
}

/* ── Fläche füllen ───────────────────────────────────────────────────────── */

function imRing(x, y, ring) {
  let in_ = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) in_ = !in_;
  }
  return in_;
}

function randAbstand(x, y, ring) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? klemmen(((x - ax) * dx + (y - ay) * dy) / l, 0, 1) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
}

/**
 * Fläche mit einem Bestand nach Vorlage füllen.
 * @param {BaumVorlage} v
 * @param {number[][]} ring  Umriss in Metern
 * @param {{abstand?:number, streuung?:string, hoeheMittel?:number, sperren?:number[][][], zufall:() => number,
 *   seed?:number}} opt
 * @returns {{x:number,y:number,art:string,hoehe:number,krone:number,drehung:number,ton:number,unterstand:boolean}[]}
 */
export function vorlageFlaeche(v, ring, opt) {
  const zufall = opt.zufall;
  const abstand = klemmen(+opt.abstand || v.abstand, 1, 50);
  const s = BAUM_STREUUNG[opt.streuung]?.faktor ?? 1;
  const seed = (opt.seed ?? Math.floor(zufall() * 2 ** 31)) >>> 0;
  const gruppe = v.gruppen || 25;
  const artFelder = v.schichten.map((_, i) => rauschFeld(seed + 101 * (i + 1), gruppe));
  const hFeld = rauschFeld(seed + 31337, gruppe * 1.2);
  const sperren = opt.sperren || [];
  const frei = (x, y) => imRing(x, y, ring) && !sperren.some(r => imRing(x, y, r));
  const randBreite = abstand * 1.5;
  const baum = (x, y, unterstand) => {
    const d = randAbstand(x, y, ring);
    return {
      x, y, unterstand,
      ...vorlageBaum(v, zufall, {
        streuung: opt.streuung, hoeheMittel: opt.hoeheMittel,
        artFeld: artFelder.map(F => F(x, y)), hoeheFeld: hFeld(x, y),
        rand: v.gruppe === 'bestand' ? klemmen(1 - d / randBreite, 0, 1) : 0,
        kroneMax: v.gruppe === 'bestand' ? abstand * 1.4 : 0, unterstand,
      }),
    };
  };

  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const zeile = abstand * 0.866;
  const wackeln = abstand * klemmen(0.3 + 0.12 * s, 0.25, 0.5);    // Pflanzraster verwischen
  const out = [];
  for (let y = y0, r = 0; y <= y1; y += zeile, r++) {
    for (let x = x0 + (r % 2 ? abstand / 2 : 0); x <= x1; x += abstand) {
      const px = x + (zufall() - 0.5) * wackeln * 2, py = y + (zufall() - 0.5) * wackeln * 2;
      if (!frei(px, py)) continue;
      if (zufall() < (v.luecken || 0) * Math.min(1.5, s)) continue;    // Lücken
      out.push(baum(px, py, false));
    }
  }
  // Unterwuchs: zusätzliche jüngere Bäume an zufälligen Stellen
  const nU = Math.round(out.length * (v.unterstand || 0));
  for (let n = 0, versuch = 0; n < nU && versuch < nU * 6; versuch++) {
    const px = x0 + zufall() * (x1 - x0), py = y0 + zufall() * (y1 - y0);
    if (!frei(px, py)) continue;
    out.push(baum(px, py, true));
    n++;
  }
  return out;
}
