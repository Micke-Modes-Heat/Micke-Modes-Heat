// ── gebaeude-geometrie.js — Grundrisse vereinigen + Kleinbauten bereinigen ──
// Reine Funktionen ohne Karten-/DOM-Bezug. Koordinaten kommen als {lat,lng} und
// werden intern in ein lokales Meter-System projiziert (Gebäudemaßstab).

const R = 6371000;
const EPS = 0.03; // m — Toleranz für „liegt auf der Kante"

function projizieren(ringe) {
  const ref = ringe[0][0];
  const cosLat = Math.cos(ref.lat * Math.PI / 180);
  const f = p => ({ x: (p.lng - ref.lng) * Math.PI / 180 * R * cosLat, y: (p.lat - ref.lat) * Math.PI / 180 * R });
  const zurueck = p => ({ lat: ref.lat + p.y / R * 180 / Math.PI, lng: ref.lng + p.x / (R * cosLat) * 180 / Math.PI });
  return { ringe: ringe.map(r => r.map(f)), zurueck };
}

function ohneSchluss(pts) {
  const n = pts.length;
  if (n > 1 && Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y) < 1e-9) return pts.slice(0, n - 1);
  return pts;
}

function vorzeichenFlaeche(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2;
}

function ccw(pts) { return vorzeichenFlaeche(pts) < 0 ? pts.slice().reverse() : pts; }

function punktSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}

function segSchnitt(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u, p: { x: a.x + t * r.x, y: a.y + t * r.y } };
}

function imRing(p, ring) {
  let in_ = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) in_ = !in_;
  }
  return in_;
}

function abstandZumRing(p, ring) {
  let best = Infinity, kante = 0;
  for (let i = 0; i < ring.length; i++) {
    const { d } = punktSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (d < best) { best = d; kante = i; }
  }
  return { d: best, kante };
}

// Kleinster Abstand zweier Ringe (0 bei Berührung, Überlappung oder Enthaltensein)
function ringAbstand(A, B) {
  if (imRing(A[0], B) || imRing(B[0], A)) return 0;
  let best = Infinity;
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      if (segSchnitt(a1, a2, b1, b2)) return 0;
      best = Math.min(best, punktSegment(a1, b1, b2).d, punktSegment(a2, b1, b2).d,
        punktSegment(b1, a1, a2).d, punktSegment(b2, a1, a2).d);
    }
  }
  return best;
}

function huelle(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const low = [];
  for (const q of p) { while (low.length >= 2 && cross(low[low.length - 2], low[low.length - 1], q) <= 0) low.pop(); low.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return low.slice(0, -1).concat(up.slice(0, -1));
}

// Kollineare/doppelte Punkte entfernen (0,05 m Toleranz)
function vereinfachen(ring) {
  let pts = ring.slice();
  let geaendert = true;
  while (geaendert && pts.length > 3) {
    geaendert = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i + pts.length - 1) % pts.length], nxt = pts[(i + 1) % pts.length];
      if (punktSegment(pts[i], prev, nxt).d < 0.05) { pts.splice(i, 1); geaendert = true; break; }
    }
  }
  return pts;
}

// Vereinigung zweier einfacher Polygone (ohne Löcher). Ergebnis: größter Außenring.
// Liefert null, wenn die Ringe keine gemeinsame zusammenhängende Kontur ergeben.
function vereinigeLokal(A0, B0) {
  const A = ccw(ohneSchluss(A0)), B = ccw(ohneSchluss(B0));
  const kanon = [];
  const kp = p => {
    for (let i = 0; i < kanon.length; i++) if (Math.hypot(kanon[i].x - p.x, kanon[i].y - p.y) < EPS) return i;
    kanon.push({ x: p.x, y: p.y });
    return kanon.length - 1;
  };
  const splitA = A.map(() => []), splitB = B.map(() => []);
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      const x = segSchnitt(a1, a2, b1, b2);
      if (x) {
        const nahAnEcke = [a1, a2].some(p => Math.hypot(p.x - x.p.x, p.y - x.p.y) < EPS)
          || [b1, b2].some(p => Math.hypot(p.x - x.p.x, p.y - x.p.y) < EPS);
        if (!nahAnEcke) { splitA[i].push(x.p); splitB[j].push(x.p); }
      }
      if (punktSegment(b1, a1, a2).d < EPS) splitA[i].push(b1);
      if (punktSegment(a1, b1, b2).d < EPS) splitB[j].push(a1);
    }
  }
  const segmente = (ring, splits, quelle) => {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const zw = splits[i].map(p => ({ p, t: ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 })).sort((m, n) => m.t - n.t);
      const kette = [a, ...zw.map(z => z.p), b].map(kp);
      for (let k = 0; k + 1 < kette.length; k++) if (kette[k] !== kette[k + 1]) out.push({ von: kette[k], nach: kette[k + 1], quelle });
    }
    return out;
  };
  const segA = segmente(A, splitA, 'A'), segB = segmente(B, splitB, 'B');

  const behalten = [];
  const pruefe = (s, anderer) => {
    const p = kanon[s.von], q = kanon[s.nach];
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const { d, kante } = abstandZumRing(m, anderer);
    if (d < EPS * 2) {
      if (s.quelle === 'B') return false;
      const e1 = anderer[kante], e2 = anderer[(kante + 1) % anderer.length];
      return (q.x - p.x) * (e2.x - e1.x) + (q.y - p.y) * (e2.y - e1.y) > 0; // gleiche Richtung → einmal behalten
    }
    return !imRing(m, anderer);
  };
  segA.forEach(s => { if (pruefe(s, B)) behalten.push(s); });
  segB.forEach(s => { if (pruefe(s, A)) behalten.push(s); });
  if (!behalten.length) return null;

  const ab = new Map();
  behalten.forEach(s => { if (!ab.has(s.von)) ab.set(s.von, []); ab.get(s.von).push(s); });
  const benutzt = new Set(), ringe = [];
  for (const start of behalten) {
    if (benutzt.has(start)) continue;
    const ring = [];
    let s = start, ok = false;
    for (let guard = 0; guard <= behalten.length; guard++) {
      benutzt.add(s); ring.push(kanon[s.von]);
      if (s.nach === start.von) { ok = true; break; }
      s = (ab.get(s.nach) || []).find(n => !benutzt.has(n));
      if (!s) break;
    }
    if (ok && ring.length >= 3) ringe.push(ring);
  }
  if (!ringe.length) return null;
  ringe.sort((r1, r2) => Math.abs(vorzeichenFlaeche(r2)) - Math.abs(vorzeichenFlaeche(r1)));
  return { ring: ringe[0], anzahlRinge: ringe.length, flaecheA: Math.abs(vorzeichenFlaeche(A)), flaecheB: Math.abs(vorzeichenFlaeche(B)) };
}

/**
 * Fügt zwei Grundrisse zu einem zusammen.
 * @param {{lat:number,lng:number}[]} coordsA
 * @param {{lat:number,lng:number}[]} coordsB
 * @returns {{coords:{lat:number,lng:number}[], methode:'vereinigung'|'huelle', flaecheM2:number}}
 *   'vereinigung' = exakte Kontur (Berührung/Überlappung); 'huelle' = die Gebäude
 *   hatten keine gemeinsame Kontur, der Umriss ist die konvexe Hülle beider.
 */
export function vereinigePolygone(coordsA, coordsB) {
  const { ringe, zurueck } = projizieren([coordsA, coordsB]);
  const u = vereinigeLokal(ringe[0], ringe[1]);
  let ring, methode = 'vereinigung';
  // Plausibilität: eine echte Vereinigung ist nie kleiner als das größere Teilpolygon
  // und nie größer als die Summe; es darf keine abgetrennte Restkontur geben.
  const plausibel = u && u.anzahlRinge === 1
    && Math.abs(vorzeichenFlaeche(u.ring)) >= Math.max(u.flaecheA, u.flaecheB) * 0.999
    && Math.abs(vorzeichenFlaeche(u.ring)) <= (u.flaecheA + u.flaecheB) * 1.001;
  if (plausibel) ring = vereinfachen(u.ring);
  else { ring = huelle(ringe[0].concat(ringe[1])); methode = 'huelle'; }
  return { coords: ring.map(zurueck), methode, flaecheM2: Math.abs(vorzeichenFlaeche(ring)) };
}

/** Grundfläche in m² (lokale Projektion, konsistent mit den übrigen Funktionen). */
export function flaecheM2(coords) {
  if (!coords || coords.length < 3) return 0;
  return Math.abs(vorzeichenFlaeche(ohneSchluss(projizieren([coords]).ringe[0])));
}

/**
 * Rechteck aus Grundlinie (p1→p2) und einem dritten Punkt, der die Breite und die
 * Seite bestimmt (senkrechter Abstand von der Grundlinie). Das Rechteck darf beliebig
 * gedreht sein. Liefert null bei (nahezu) entarteter Grundlinie oder Breite.
 * @returns {{coords:{lat:number,lng:number}[], laengeM:number, breiteM:number}|null}
 */
export function rechteckAusDreiPunkten(p1, p2, p3, minM = 0.3) {
  const { ringe, zurueck } = projizieren([[p1, p2, p3]]);
  const [a, b, c] = ringe[0];
  const dx = b.x - a.x, dy = b.y - a.y, laenge = Math.hypot(dx, dy);
  if (laenge < minM) return null;
  const ux = dx / laenge, uy = dy / laenge;
  const nx = -uy, ny = ux;
  const w = (c.x - a.x) * nx + (c.y - a.y) * ny;
  if (Math.abs(w) < minM) return null;
  const ring = [a, b, { x: b.x + nx * w, y: b.y + ny * w }, { x: a.x + nx * w, y: a.y + ny * w }];
  return { coords: ring.map(zurueck), laengeM: laenge, breiteM: Math.abs(w) };
}

/**
 * Drehfunktion um ein Zentrum. grad = Uhrzeigersinn (Kompassrichtung, Karte genordet).
 * Gibt eine Funktion zurück, die {lat,lng} (oder [lat,lng]) auf den gedrehten Punkt abbildet.
 * Die Drehung läuft im lokalen Meter-System, Formen bleiben also maßstabsgetreu.
 */
export function drehFunktion(zentrum, grad) {
  const cLat = zentrum.lat ?? zentrum[0], cLng = zentrum.lng ?? zentrum[1];
  const cosLat = Math.cos(cLat * Math.PI / 180);
  const phi = grad * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi);
  return p => {
    const lat = p.lat ?? p[0], lng = p.lng ?? p[1];
    const x = (lng - cLng) * Math.PI / 180 * R * cosLat, y = (lat - cLat) * Math.PI / 180 * R;
    const xr = x * c + y * s, yr = -x * s + y * c;
    return { lat: cLat + yr / R * 180 / Math.PI, lng: cLng + xr / (R * cosLat) * 180 / Math.PI };
  };
}

/** Kompasspeilung (0 = Nord, im Uhrzeigersinn, 0–360°) von einem Zentrum zu einem Punkt. */
export function peilungGrad(zentrum, p) {
  const cosLat = Math.cos(zentrum.lat * Math.PI / 180);
  const x = (p.lng - zentrum.lng) * cosLat, y = p.lat - zentrum.lat;
  return ((Math.atan2(x, y) * 180 / Math.PI) % 360 + 360) % 360;
}

/**
 * Richtet einen Grundriss rechtwinklig aus: Hauptrichtung bestimmen (nach Kantenlänge
 * gewichtet), jede Kante der nächstliegenden der beiden Achsen zuordnen, aufeinander-
 * folgende gleichgerichtete Kanten zusammenlegen und die Ecken als Schnittpunkte
 * neu bilden. Ergebnis hat ausschließlich 90°-Ecken.
 * @returns {{coords:{lat:number,lng:number}[], winkelGrad:number, flaecheVorherM2:number,
 *   flaecheNachherM2:number, abweichungProzent:number, diagonaleKanten:number}|null}
 *   null, wenn sich keine rechtwinklige Kontur bilden lässt (z. B. Dreieck, Kreisbogen).
 */
export function richteRechtwinklig(coords, { diagonalGrad = 20, minKanteM = 0.3 } = {}) {
  if (!coords || coords.length < 3) return null;
  const { ringe, zurueck } = projizieren([coords]);
  let pts = ohneSchluss(ringe[0]).map(p => ({ x: p.x, y: p.y }));
  const flaecheVorher = Math.abs(vorzeichenFlaeche(pts));
  if (pts.length < 3 || flaecheVorher < 0.5) return null;

  // Kürzeste Kanten (Digitalisierungsrauschen) zu einem Punkt verschmelzen
  for (let guard = 0; guard < 200 && pts.length > 4; guard++) {
    let k = -1, kl = minKanteM;
    for (let i = 0; i < pts.length; i++) {
      const b = pts[(i + 1) % pts.length], l = Math.hypot(b.x - pts[i].x, b.y - pts[i].y);
      if (l < kl) { kl = l; k = i; }
    }
    if (k < 0) break;
    const j = (k + 1) % pts.length;
    const m = { x: (pts[k].x + pts[j].x) / 2, y: (pts[k].y + pts[j].y) / 2 };
    pts = pts.map((p, i) => (i === k ? m : p)).filter((_, i) => i !== j);
  }

  const n = pts.length;
  // Hauptrichtung: Kantenwinkel mod 90° → über 4·Winkel mitteln
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    sx += l * Math.cos(4 * ang); sy += l * Math.sin(4 * ang);
  }
  const theta = Math.atan2(sy, sx) / 4;
  const ct = Math.cos(theta), st = Math.sin(theta);
  const q = pts.map(p => ({ x: p.x * ct + p.y * st, y: -p.x * st + p.y * ct }));

  // Kanten klassifizieren: 'h' = waagerecht (y = konst), 'v' = senkrecht (x = konst)
  const kanten = [];
  let diagonal = 0;
  for (let i = 0; i < n; i++) {
    const a = q[i], b = q[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const abw = Math.atan2(horizontal ? Math.abs(dy) : Math.abs(dx), horizontal ? Math.abs(dx) : Math.abs(dy)) * 180 / Math.PI;
    if (abw > diagonalGrad) diagonal++;
    kanten.push({ art: horizontal ? 'h' : 'v', l, wert: horizontal ? (a.y + b.y) / 2 : (a.x + b.x) / 2 });
  }
  const start = kanten.findIndex((k, i) => k.art !== kanten[(i + n - 1) % n].art);
  if (start < 0) return null; // alle Kanten gleichgerichtet → keine Fläche

  // Aufeinanderfolgende gleichartige Kanten zu einer Geraden (längengewichteter Mittelwert)
  const gruppen = [];
  for (let s = 0; s < n; s++) {
    const k = kanten[(start + s) % n], last = gruppen[gruppen.length - 1];
    if (last && last.art === k.art) { last.summe += k.wert * k.l; last.l += k.l; }
    else gruppen.push({ art: k.art, summe: k.wert * k.l, l: k.l });
  }
  if (gruppen.length < 4 || gruppen.length % 2) return null;
  gruppen.forEach(g => { g.wert = g.summe / (g.l || 1); });

  // Ecke zwischen Gruppe i und i+1: senkrechte Gerade liefert x, waagerechte y
  const ecken = gruppen.map((g, i) => {
    const h = gruppen[(i + 1) % gruppen.length];
    return g.art === 'h' ? { x: h.wert, y: g.wert } : { x: g.wert, y: h.wert };
  });
  const ergebnis = vereinfachen(ecken.map(p => ({ x: p.x * ct - p.y * st, y: p.x * st + p.y * ct })));
  const flaecheNachher = Math.abs(vorzeichenFlaeche(ergebnis));
  if (ergebnis.length < 4 || flaecheNachher < 0.5) return null;
  return {
    coords: ergebnis.map(zurueck),
    winkelGrad: ((90 - theta * 180 / Math.PI) % 90 + 90) % 90, // Kompassrichtung einer Gebäudeachse (0–90°)
    flaecheVorherM2: flaecheVorher,
    flaecheNachherM2: flaecheNachher,
    abweichungProzent: Math.abs(flaecheNachher - flaecheVorher) / flaecheVorher * 100,
    diagonaleKanten: diagonal,
  };
}

function schwerpunkt(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += f; cx += (pts[j].x + pts[i].x) * f; cy += (pts[j].y + pts[i].y) * f;
  }
  return a ? { x: cx / (3 * a), y: cy / (3 * a) } : { x: pts[0].x, y: pts[0].y };
}

// Richtung (rad, mathematisch) der längsten Kante eines gegen den Uhrzeigersinn orientierten Rings
function laengsteKante(ring) {
  let best = -1, ang = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > best + 1e-6) { best = l; ang = Math.atan2(b.y - a.y, b.x - a.x); }
  });
  return ang;
}

/**
 * Überträgt die Maße/Form eines Gebäudes (quelle) auf ein anderes (ziel): Der Flächen-
 * schwerpunkt und die Ausrichtung des Ziels bleiben erhalten. Als Ausrichtung dient die
 * Richtung der jeweils längsten Kante, d. h. die lange Seite der Quelle liegt auf der
 * langen Seite des Ziels. Die Form wird nur gedreht und verschoben, nie verzerrt.
 * @returns {{coords:{lat:number,lng:number}[], drehungGrad:number, flaecheM2:number}|null}
 */
export function uebertrageForm(zielCoords, quelleCoords) {
  if (!zielCoords || zielCoords.length < 3 || !quelleCoords || quelleCoords.length < 3) return null;
  const { ringe, zurueck } = projizieren([zielCoords, quelleCoords]);
  const z = ccw(ohneSchluss(ringe[0])), q = ccw(ohneSchluss(ringe[1]));
  if (Math.abs(vorzeichenFlaeche(z)) < 0.5 || Math.abs(vorzeichenFlaeche(q)) < 0.5) return null;
  const delta = laengsteKante(z) - laengsteKante(q);
  const c = Math.cos(delta), s = Math.sin(delta);
  const zc = schwerpunkt(z), qc = schwerpunkt(q);
  const neu = q.map(p => {
    const x = p.x - qc.x, y = p.y - qc.y;
    return { x: zc.x + x * c - y * s, y: zc.y + x * s + y * c };
  });
  return { coords: neu.map(zurueck), drehungGrad: -delta * 180 / Math.PI, flaecheM2: Math.abs(vorzeichenFlaeche(neu)) };
}

/**
 * Bereinigt eine Importliste: Gebäude unter der Mindestgrundfläche (Dachaufbauten,
 * Schuppen, Anbauten) werden nicht als eigenes Gebäude geführt. Berührt/überlappt
 * ein solches Teil ein großes Gebäude (Abstand ≤ kontaktM), wird es in dessen
 * Grundriss eingerechnet (nur bei sauberer Vereinigung, sonst verworfen), alle
 * anderen kleinen Polygone werden verworfen.
 * @param {{coords:{lat:number,lng:number}[]}[]} items
 * @returns {{items:object[], verworfen:number, angefuegt:number}}
 */
export function bereinigeKleinbauten(items, { minFlaecheM2 = 30, kontaktM = 1.0 } = {}) {
  if (!(minFlaecheM2 > 0) || !items?.length) return { items: items || [], verworfen: 0, angefuegt: 0 };
  const grosse = [], kleine = [];
  items.forEach(it => {
    const a = flaecheM2(it.coords);
    (a >= minFlaecheM2 ? grosse : kleine).push({ it, coords: it.coords });
  });
  if (!grosse.length) return { items, verworfen: 0, angefuegt: 0 }; // nur Kleingebäude → nichts verwerfen
  let verworfen = 0, angefuegt = 0;
  kleine.forEach(k => {
    let bestes = null, bestD = Infinity;
    grosse.forEach(g => {
      const { ringe } = projizieren([g.coords, k.coords]);
      const d = ringAbstand(ringe[0], ringe[1]);
      if (d <= kontaktM && d < bestD) { bestD = d; bestes = g; }
    });
    if (!bestes) { verworfen++; return; }
    const v = vereinigePolygone(bestes.coords, k.coords);
    if (v.methode === 'vereinigung') {
      if (Math.abs(v.flaecheM2 - flaecheM2(bestes.coords)) > 0.5) angefuegt++; else verworfen++;
      bestes.coords = v.coords;
    } else verworfen++;
  });
  grosse.forEach(g => { g.it.coords = g.coords; });
  return { items: grosse.map(g => g.it), verworfen, angefuegt };
}
