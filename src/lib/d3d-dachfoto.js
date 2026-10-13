// ── lib/d3d-dachfoto.js — Luftbild auf die Dächer der 3D-Ansicht legen ─────────
// Reine Kachelrechnung (Web-Mercator, XYZ-Kacheln), ohne DOM/WebGL. Die 3D-Ansicht
// (32-3d-ansicht.js) lädt die Kacheln rund um ein Gebäude, setzt sie zu einer Textur
// zusammen und projiziert sie senkrecht von oben auf die Dachflächen — so lassen
// sich Gauben, Kamine und Dachfenster als Sperrflächen nachzeichnen.
// Grenze: Luftbilder sind keine „True Orthophotos" — Dächer liegen darin je nach
// Aufnahmewinkel um 1–3 m neben dem Grundriss.

/** Mercator-Koordinate (0…1, wie MapLibre) aus Länge/Breite. */
export function mercatorAus(lng, lat) {
  const s = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/**
 * Kacheln, die einen Ausschnitt abdecken. Wählt die höchste Zoomstufe ≤ zMax, bei
 * der höchstens maxKacheln je Richtung nötig sind.
 * @param {{minLng:number,minLat:number,maxLng:number,maxLat:number}} b
 * @returns {{z:number, x0:number, y0:number, x1:number, y1:number, nx:number, ny:number}}
 */
export function kachelBereich(b, zMax = 19, maxKacheln = 8) {
  const [mx0, my0] = mercatorAus(b.minLng, b.maxLat);   // Nordwest
  const [mx1, my1] = mercatorAus(b.maxLng, b.minLat);   // Südost
  for (let z = zMax; z >= 1; z--) {
    const n = 2 ** z;
    const x0 = Math.floor(mx0 * n), x1 = Math.floor(mx1 * n), y0 = Math.floor(my0 * n), y1 = Math.floor(my1 * n);
    if (x1 - x0 + 1 <= maxKacheln && y1 - y0 + 1 <= maxKacheln) return { z, x0, y0, x1, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
  }
  return { z: 0, x0: 0, y0: 0, x1: 0, y1: 0, nx: 1, ny: 1 };
}

/** Texturkoordinate [u, v] (0…1, v nach unten = Süden) einer Mercator-Koordinate im Bereich. */
export function texturKoordinate(mx, my, k) {
  const n = 2 ** k.z;
  return [(mx * n - k.x0) / k.nx, (my * n - k.y0) / k.ny];
}

/** URL einer Kachel aus einer Vorlage mit {z}/{x}/{y} (und ggf. {s}). */
export function kachelUrl(vorlage, z, x, y, sub = '') {
  return String(vorlage).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', sub);
}
