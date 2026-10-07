// ── lib/lod2-citygml.js — Amtliche LoD2-Gebäudemodelle (CityGML) lesen ───────
//
// Die Vermessungsverwaltungen der Länder geben LoD2-Gebäudemodelle als freie
// Daten ab (CityGML, Lage in ETRS89/UTM 32 bzw. 33, Höhen in NHN). Darin ist
// jede Dachfläche ein eigenes 3D-Polygon (bldg:RoofSurface) — daraus folgen
// Neigung, Ausrichtung und Fläche je Teildach, auch bei Anbauten und versetzten
// Firsten. Genau das fehlt dem Grundriss-Modell (eine Dachform je Gebäude).
//
// Reiner Teil ohne DOM: Text → Gebäude mit Dach-, Wand- und Bodenflächen →
// Dachdaten in lat/lng mit Höhen über Gelände. Gelesen wird per Textsuche statt
// XML-Parser: Kacheln sind oft 20–60 MB groß, und so läuft es auch in den Tests.
// Die Zuordnung zu den Projektgebäuden und die Übernahme liegen in 37-lod2-import.js.

/* ── UTM (ETRS89/GRS80) ⇄ geografisch ─────────────────────────────────────── */
// Formeln nach Snyder (USGS PP 1395) — für Gebäudegeometrie auf mm/cm genau.

const A_GRS80 = 6378137;
const F_GRS80 = 1 / 298.257222101;
const K0 = 0.9996;
const E2 = F_GRS80 * (2 - F_GRS80);
const EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

/** UTM-Koordinate (Zone 32/33 Nord) → { lat, lng }. */
export function utmNachWgs84(E, N, zone) {
  const x = E - 500000, y = N;
  const M = y / K0;
  const mu = M / (A_GRS80 * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const N1 = A_GRS80 / Math.sqrt(1 - E2 * s * s);
  const T1 = t * t, C1 = EP2 * c * c;
  const R1 = A_GRS80 * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
  const D = x / (N1 * K0);
  const lat = phi1 - (N1 * t / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lng0 = (zone * 6 - 183) * RAD;
  const lng = lng0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return { lat: lat / RAD, lng: lng / RAD };
}

/** { lat, lng } → UTM-Koordinate { E, N } in der angegebenen Zone. */
export function wgs84NachUtm(lat, lng, zone) {
  const phi = lat * RAD, lam = lng * RAD, lam0 = (zone * 6 - 183) * RAD;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A_GRS80 / Math.sqrt(1 - E2 * s * s);
  const T = t * t, C = EP2 * c * c, A = c * (lam - lam0);
  const e4 = E2 * E2, e6 = e4 * E2;
  const M = A_GRS80 * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
  const E = K0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * A ** 5 / 120) + 500000;
  const Nn = K0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * A ** 6 / 720));
  return { E, N: Nn };
}

/** UTM-Zone aus dem srsName (EPSG:25832, urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH, …). */
export function lod2Zone(text) {
  const m = String(text || '').match(/srsName\s*=\s*"([^"]*)"/);
  const srs = m ? m[1] : '';
  if (/25833|UTM_?33|UTM33/i.test(srs)) return 33;
  if (/25832|UTM_?32|UTM32/i.test(srs)) return 32;
  if (/3044|4647/.test(srs)) return 32;        // ETRS89/UTM 32 mit Zonenvorsatz
  if (/5650/.test(srs)) return 33;
  return null;
}

/* ── CityGML lesen ─────────────────────────────────────────────────────────── */

/** Zahlenfolge "x y z x y z …" bzw. "x,y,z x,y,z" → [[x,y,z], …] (ohne Schlusspunkt). */
function _punkte(text, dim = 3) {
  const z = String(text).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out = [];
  for (let i = 0; i + dim - 1 < z.length; i += dim) out.push(dim === 3 ? [z[i], z[i + 1], z[i + 2]] : [z[i], z[i + 1], 0]);
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6) out.pop();
  }
  return out;
}

/** Ring aus einem <exterior>…</exterior>- bzw. LinearRing-Text. */
function _ring(text) {
  const pl = text.match(/<(?:\w+:)?posList([^>]*)>([^<]*)</);
  if (pl) {
    const dim = /srsDimension\s*=\s*"2"/.test(pl[1]) ? 2 : 3;
    return _punkte(pl[2], dim);
  }
  const pos = [...text.matchAll(/<(?:\w+:)?pos(?:\s[^>]*)?>([^<]*)</g)].map(m => _punkte(m[1])[0]).filter(Boolean);
  if (pos.length) {
    const a = pos[0], b = pos[pos.length - 1];
    if (pos.length > 1 && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) pos.pop();
    return pos;
  }
  const co = text.match(/<(?:\w+:)?coordinates[^>]*>([^<]*)</);
  return co ? _punkte(co[1]) : [];
}

/** Alle Außenringe in einem Text (Polygone einer Fläche). */
function _aussenringe(text) {
  const out = [];
  for (const m of text.matchAll(/<(?:\w+:)?exterior>([\s\S]*?)<\/(?:\w+:)?exterior>/g)) {
    const r = _ring(m[1]);
    if (r.length >= 3) out.push(r);
  }
  return out;
}

/** Inhalt zwischen Start-Tag-Ende und passendem End-Tag (gleicher Präfix). */
function _bloecke(text, namenRegex) {
  const out = [];
  const re = new RegExp(`<((?:\\w+:)?)(${namenRegex})(\\s[^>]*)?>`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const ende = text.indexOf(`</${m[1]}${m[2]}>`, re.lastIndex);
    if (ende < 0) break;
    out.push({ name: m[2], attr: m[3] || '', inhalt: text.slice(re.lastIndex, ende) });
    re.lastIndex = ende;
  }
  return out;
}

const ROOF_TYPE = {
  1000: 'flach', 2100: 'pult', 2200: 'pult', 3100: 'sattel', 3200: 'walm', 3300: 'walm',
  3400: 'walm', 3500: 'walm',
};

/**
 * CityGML-Text lesen.
 * @param {string} text
 * @param {{ imBereich?: (E:number, N:number) => boolean }} [opts]
 *   imBereich: schneller Vorfilter je Gebäude (erster Dachpunkt) — spart bei
 *   großen Kacheln die Arbeit für Gebäude außerhalb des Projekts
 * @returns {{ zone:number|null, gebaeude: Array<{ id:string, roofType:number|null,
 *   dach:number[][][], wand:number[][][], boden:number[][][] }>, gesamt:number }}
 */
export function lod2Parsen(text, opts = {}) {
  const zone = lod2Zone(text);
  const gebaeude = [];
  let gesamt = 0;
  for (const b of _bloecke(text, 'Building')) {
    gesamt++;
    const idM = b.attr.match(/(?:gml:)?id\s*=\s*"([^"]+)"/);
    const rt = b.inhalt.match(/<(?:\w+:)?roofType[^>]*>\s*(\d+)\s*</);
    const flaechen = { dach: [], wand: [], boden: [] };
    // Polygone, auf die per xlink:href verwiesen wird (nur bei Bedarf indiziert)
    let index = null;
    const verweis = id => {
      if (!index) {
        index = new Map();
        for (const p of _bloecke(b.inhalt, 'Polygon')) {
          const pid = p.attr.match(/(?:gml:)?id\s*=\s*"([^"]+)"/);
          if (pid) index.set(pid[1], _aussenringe(p.inhalt));
        }
      }
      return index.get(id) || [];
    };
    for (const s of _bloecke(b.inhalt, 'RoofSurface|WallSurface|GroundSurface')) {
      let ringe = _aussenringe(s.inhalt);
      if (!ringe.length) {
        for (const h of s.inhalt.matchAll(/xlink:href\s*=\s*"#([^"]+)"/g)) ringe = ringe.concat(verweis(h[1]));
      }
      const ziel = s.name === 'RoofSurface' ? flaechen.dach : s.name === 'WallSurface' ? flaechen.wand : flaechen.boden;
      ziel.push(...ringe);
    }
    if (!flaechen.dach.length) continue;
    // Ostwerte mit Zonenvorsatz (32xxxxxxx) auf reine UTM-Ostwerte bringen
    for (const liste of [flaechen.dach, flaechen.wand, flaechen.boden]) {
      for (const r of liste) for (const p of r) if (p[0] > 1e7) p[0] -= Math.floor(p[0] / 1e6) * 1e6;
    }
    const p0 = flaechen.dach[0][0];
    if (opts.imBereich && !opts.imBereich(p0[0], p0[1])) continue;
    gebaeude.push({ id: idM ? idM[1] : 'lod2_' + gesamt, roofType: rt ? +rt[1] : null, ...flaechen });
  }
  return { zone, gebaeude, gesamt };
}

/* ── Kennwerte je Fläche ───────────────────────────────────────────────────── */

/**
 * Neigung, Ausrichtung und Fläche eines 3D-Rings (x Ost, y Nord, z Höhe, Meter).
 * Normale nach Newell, nach oben gedreht; Azimut = Richtung, in die die Fläche
 * abfällt (0 = Nord, 180 = Süd) — wie dachAzimut im Tool.
 */
export function lod2FlaecheKennwerte(ring) {
  let nx = 0, ny = 0, nz = 0, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
    if (a[2] < zMin) zMin = a[2]; if (a[2] > zMax) zMax = a[2];
  }
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0)) return { neigung: 0, azimut: 180, flaecheM2: 0, grundM2: 0, zMin, zMax };
  const neigung = Math.acos(Math.min(1, nz / len)) / RAD;
  const azimut = Math.hypot(nx, ny) < 1e-9 ? 180 : ((Math.atan2(nx, ny) / RAD) % 360 + 360) % 360;
  return { neigung, azimut, flaecheM2: len / 2, grundM2: nz / 2, zMin, zMax };
}

/** Teil eines 3D-Rings oberhalb der Höhe zGrenze (Sutherland–Hodgman auf z). */
export function lod2UeberHoehe(ring, zGrenze) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ia = a[2] >= zGrenze, ib = b[2] >= zGrenze;
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (zGrenze - a[2]) / (b[2] - a[2]);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), zGrenze]);
    }
  }
  return out;
}

/**
 * Dachform aus roofType (AdV-Schlüssel) bzw. aus den Flächen: flach, wenn alle
 * Flächen < 10° — eine geneigte Hauptfläche = Pult, zwei gegenüberliegende =
 * Sattel, sonst Walm (nächster Typ, den das Tool kennt).
 */
export function lod2Dachform(roofType, kennwerte) {
  if (roofType != null && ROOF_TYPE[roofType]) return ROOF_TYPE[roofType];
  const geneigt = kennwerte.filter(k => k.neigung >= 10);
  if (!geneigt.length) return 'flach';
  const summe = geneigt.reduce((s, k) => s + k.grundM2, 0);
  // ab 8 % der Dachfläche zählt eine Fläche — Walmflächen sind oft klein
  const haupt = geneigt.filter(k => k.grundM2 >= 0.08 * summe);
  if (haupt.length === 1) return 'pult';
  if (haupt.length === 2) {
    const d = Math.abs(haupt[0].azimut - haupt[1].azimut) % 360;
    if (Math.abs(Math.min(d, 360 - d) - 180) <= 30) return 'sattel';
  }
  return 'walm';
}

const _abwSued = a => { const d = Math.abs(((a % 360) + 360) % 360 - 180); return Math.min(d, 360 - d); };

/**
 * Dachdaten eines LoD2-Gebäudes für das Tool.
 * Höhen relativ zum Gelände: Boden = tiefster Punkt der Bodenfläche, ersatzweise
 * der Wände; fehlt beides, 3 m unter der Traufe (bodenGeschaetzt).
 * @returns {{ dachFlaechen: Array<{id:number, punkte:number[][], neigung:number, azimut:number,
 *   flaecheM2:number, grundM2:number}>, lod2: {gmlId:string, traufeM:number, firstM:number,
 *   bodenGeschaetzt:boolean, waende:number[][][]}, dachform:string, dachNeigung:number|null,
 *   dachAzimut:number|null, mitte:{lat:number,lng:number} }}
 *   punkte = [lat, lng, h] (h in m über Gelände)
 */
export function lod2Dachdaten(geb, zone) {
  const kw = geb.dach.map(lod2FlaecheKennwerte);
  const zMinDach = Math.min(...kw.map(k => k.zMin));
  const zMaxDach = Math.max(...kw.map(k => k.zMax));
  const tiefster = liste => { let z = Infinity; for (const r of liste) for (const p of r) if (p[2] < z) z = p[2]; return z; };
  let boden = tiefster(geb.boden);
  if (!Number.isFinite(boden)) boden = tiefster(geb.wand);
  const bodenGeschaetzt = !Number.isFinite(boden) || boden >= zMinDach;
  if (bodenGeschaetzt) boden = zMinDach - 3;
  const nachLL = p => { const ll = utmNachWgs84(p[0], p[1], zone); return [ll.lat, ll.lng, Math.round((p[2] - boden) * 100) / 100]; };

  const dachFlaechen = [];
  geb.dach.forEach((r, i) => {
    const k = kw[i];
    if (!(k.grundM2 > 0.05) || k.neigung > 80) return;   // senkrechte/entartete Teile
    dachFlaechen.push({ id: i + 1, punkte: r.map(nachLL), neigung: Math.round(k.neigung * 10) / 10,
      azimut: Math.round(k.azimut), flaecheM2: Math.round(k.flaecheM2 * 10) / 10, grundM2: Math.round(k.grundM2 * 10) / 10 });
  });
  // Wände nur oberhalb der Traufe (Giebel, Versätze) — darunter zeichnet die 3D-Ansicht die Grundrisswand
  const waende = [];
  for (const r of geb.wand) {
    const oben = lod2UeberHoehe(r, zMinDach + 0.05);
    if (oben.length >= 3) waende.push(oben.map(nachLL));
  }

  const dachform = lod2Dachform(geb.roofType, kw);
  const geneigt = dachFlaechen.filter(f => f.neigung >= 10);
  let dachNeigung = null, dachAzimut = null;
  if (geneigt.length) {
    const g = geneigt.reduce((s, f) => s + f.grundM2, 0);
    dachNeigung = Math.round(geneigt.reduce((s, f) => s + f.neigung * f.grundM2, 0) / g);
    // Hauptfläche: die größte; beim Satteldach die Hälfte näher an Süd (wie das Tool sonst)
    const nachGroesse = [...geneigt].sort((a, b) => b.grundM2 - a.grundM2);
    let haupt = nachGroesse[0];
    if (dachform === 'sattel' && nachGroesse[1] && _abwSued(nachGroesse[1].azimut) < _abwSued(haupt.azimut)) haupt = nachGroesse[1];
    dachAzimut = haupt.azimut;
  }
  // Mitte = flächengewichteter Schwerpunkt der Dachflächen (für die Zuordnung)
  let sx = 0, sy = 0, sw = 0;
  geb.dach.forEach((r, i) => {
    const w = Math.max(kw[i].grundM2, 0.01);
    let cx = 0, cy = 0;
    for (const p of r) { cx += p[0]; cy += p[1]; }
    sx += cx / r.length * w; sy += cy / r.length * w; sw += w;
  });
  const mitte = utmNachWgs84(sx / sw, sy / sw, zone);
  return {
    dachFlaechen,
    lod2: { gmlId: geb.id, traufeM: Math.round((zMinDach - boden) * 100) / 100,
      firstM: Math.round((zMaxDach - boden) * 100) / 100, bodenGeschaetzt, waende },
    dachform, dachNeigung, dachAzimut, mitte,
  };
}

/* ── Zuordnung zu Projektgebäuden ──────────────────────────────────────────── */

function _imPolygon(p, poly) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat)
        && p.lng < (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng) innen = !innen;
  }
  return innen;
}

/**
 * LoD2-Gebäude den Projektgebäuden zuordnen: Die Mitte der Dachflächen liegt im
 * Grundriss; sonst entscheidet die Mehrheit der Flächenmitten. LoD2 und ALKIS
 * teilen sich die Grundrisse, daher trifft das fast immer eindeutig.
 * @param {Array<{mitte:{lat,lng}, dachFlaechen:any[]}>} lod2
 * @param {Array<{id:any, polygon:{lat,lng}[]}>} projekt
 * @returns {{ zuordnung: Map<any, number[]>, ohne: number[] }}  Projekt-ID → LoD2-Indizes
 */
export function lod2Zuordnen(lod2, projekt) {
  const kand = projekt.filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3).map(g => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const p of g.polygon) { if (p.lat < a) a = p.lat; if (p.lat > b) b = p.lat; if (p.lng < c) c = p.lng; if (p.lng > d) d = p.lng; }
    return { g, box: [a, b, c, d] };
  });
  const treffer = p => kand.find(k => p.lat >= k.box[0] && p.lat <= k.box[1] && p.lng >= k.box[2] && p.lng <= k.box[3]
    && _imPolygon(p, k.g.polygon))?.g || null;
  const zuordnung = new Map(), ohne = [];
  lod2.forEach((l, i) => {
    let g = treffer(l.mitte);
    if (!g) {
      const stimmen = new Map();
      for (const f of l.dachFlaechen) {
        let la = 0, ln = 0;
        for (const p of f.punkte) { la += p[0]; ln += p[1]; }
        const t = treffer({ lat: la / f.punkte.length, lng: ln / f.punkte.length });
        if (t) stimmen.set(t, (stimmen.get(t) || 0) + f.grundM2);
      }
      let best = 0;
      for (const [k, v] of stimmen) if (v > best) { best = v; g = k; }
    }
    if (!g) { ohne.push(i); return; }
    if (!zuordnung.has(g.id)) zuordnung.set(g.id, []);
    zuordnung.get(g.id).push(i);
  });
  return { zuordnung, ohne };
}
