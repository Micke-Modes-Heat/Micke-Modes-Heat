// ── lib/netz-strang.js — Strang umlegen: Topologie und Suche des neuen Anschlusses ──
// DOM-frei. Ein Wärmenetz ist ein Baum mit der Zentrale als Wurzel. Wird eine Leitung im
// Bearbeitungsmodus auf eine andere Straße gezogen, kann der ganze Strang dahinter (z. B. ein
// Außenquartier) über diesen Punkt neu angebunden werden: Leitung lösen, Teilnetz über den Punkt
// entlang der Straßen zum nächsten Punkt des übrigen Netzes führen, verwaiste Abzweige entfernen.

/**
 * Struktur rund um eine Leitung. kanten: [{ u, v }] (ohne stillgelegte), kante: eine davon.
 * istAbzweig(id): true für reine Abzweigknoten, die wegfallen dürfen, wenn sie niemanden mehr versorgen.
 * Ergebnis: { oben, unten, teilnetz: Set (Knoten hinter der Leitung), totKanten: [kante] } oder null,
 * wenn die Zentrale mit keinem Ende der Leitung verbunden ist.
 */
export function strangAnalyse(kanten, kante, zentraleId, istAbzweig = () => false) {
  const nachbarn = new Map();
  const add = (a, b, k) => { if (!nachbarn.has(a)) nachbarn.set(a, []); nachbarn.get(a).push({ id: b, k }); };
  for (const k of kanten) if (k !== kante) { add(k.u, k.v, k); add(k.v, k.u, k); }
  const erreichbar = start => {
    const gesehen = new Set([start]);
    const schlange = [start];
    while (schlange.length) {
      const n = schlange.shift();
      for (const x of nachbarn.get(n) || []) if (!gesehen.has(x.id)) { gesehen.add(x.id); schlange.push(x.id); }
    }
    return gesehen;
  };
  const vonZentrale = erreichbar(zentraleId);
  let oben, unten;
  if (vonZentrale.has(kante.u) && !vonZentrale.has(kante.v)) { oben = kante.u; unten = kante.v; }
  else if (vonZentrale.has(kante.v) && !vonZentrale.has(kante.u)) { oben = kante.v; unten = kante.u; }
  else return null;   // Ring oder nicht angebunden — dann gibt es kein eindeutiges „dahinter“
  const teilnetz = erreichbar(unten);

  // Verwaiste Kette: vom oberen Ende aufwärts, solange ein Abzweig nur noch eine Leitung hat
  const totKanten = [];
  const entfernt = new Set([kante]);
  let knoten = oben;
  while (knoten !== zentraleId && istAbzweig(knoten)) {
    const rest = (nachbarn.get(knoten) || []).filter(x => !entfernt.has(x.k));
    if (rest.length !== 1) break;
    entfernt.add(rest[0].k);
    totKanten.push(rest[0].k);
    knoten = rest[0].id;
  }
  return { oben, unten, teilnetz, totKanten };
}

/**
 * Kürzester Weg im Straßengraphen vom Start zu einem Ziel (istZiel(key)). adjacency: Map key → [{ to, distance }];
 * gesperrt(key): Knoten, die der Weg nicht betreten darf. zielKosten(key) ≥ 0: Zuschlag je Ziel — dann gewinnt das Ziel
 * mit der kleinsten Summe aus Weg und Zuschlag (z. B. Leitungsweg vom Anschluss bis zur Zentrale), sonst das nächste.
 * Ergebnis: { ziel, weg: [keys], laenge, gesamt } oder null.
 */
export function dijkstraBisZiel(adjacency, start, istZiel, gesperrt = () => false, zielKosten = null) {
  const dist = new Map([[start, 0]]);
  const vorher = new Map();
  const offen = [[0, start]];
  const fertig = new Set();
  let best = null;
  while (offen.length) {
    // kleine Graphen (Liegenschaft): lineare Suche statt Heap genügt
    let iMin = 0;
    for (let i = 1; i < offen.length; i++) if (offen[i][0] < offen[iMin][0]) iMin = i;
    const [d, key] = offen.splice(iMin, 1)[0];
    if (best && d >= best.gesamt) break;   // kein Ziel kann mehr günstiger werden
    if (fertig.has(key)) continue;
    fertig.add(key);
    if (istZiel(key)) {
      const gesamt = d + (zielKosten ? Math.max(0, zielKosten(key) || 0) : 0);
      if (!best || gesamt < best.gesamt) best = { ziel: key, laenge: d, gesamt };
      if (!zielKosten) break;
    }
    for (const { to, distance } of adjacency.get(key) || []) {
      if (gesperrt(to)) continue;
      const nd = d + distance;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); vorher.set(to, key); offen.push([nd, to]); }
    }
  }
  if (!best) return null;
  const weg = [best.ziel];
  while (vorher.has(weg[0])) weg.unshift(vorher.get(weg[0]));
  return { ziel: best.ziel, weg, laenge: best.laenge, gesamt: best.gesamt };
}

/** Lage eines Punkts zur Polylinie: { abstand (m), entlang (m ab dem ersten Punkt bis zum Lotfußpunkt), laenge (m) }. */
export function lageAufLinie(p, linie) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110540;
  const xy = q => [(q.lng - p.lng) * kx, (q.lat - p.lat) * ky];
  let best = { abstand: Infinity, entlang: 0 }, lauf = 0;
  for (let i = 0; i < (linie || []).length - 1; i++) {
    const [ax, ay] = xy(linie[i]), [bx, by] = xy(linie[i + 1]);
    const dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy, seg = Math.sqrt(n);
    const t = n ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n)) : 0;
    const a = Math.hypot(ax + t * dx, ay + t * dy);
    if (a < best.abstand) best = { abstand: a, entlang: lauf + t * seg };
    lauf += seg;
  }
  return { ...best, laenge: lauf };
}

/**
 * Leitungsweg von der Zentrale bis zu jedem Knoten (Baum; Kantenlänge aus laenge(kante)).
 * Ergebnis: Map knotenId → m. Nicht erreichbare Knoten fehlen.
 */
export function netzwegAbZentrale(kanten, zentraleId, laenge) {
  const nachbarn = new Map();
  const add = (a, b, l) => { if (!nachbarn.has(a)) nachbarn.set(a, []); nachbarn.get(a).push([b, l]); };
  for (const k of kanten) { const l = laenge(k); add(k.u, k.v, l); add(k.v, k.u, l); }
  const dist = new Map([[zentraleId, 0]]);
  const schlange = [zentraleId];
  while (schlange.length) {
    const n = schlange.shift();
    for (const [m, l] of nachbarn.get(n) || []) if (!dist.has(m)) { dist.set(m, dist.get(n) + l); schlange.push(m); }
  }
  return dist;
}

/** Abstand eines Punkts zu einer Polylinie in Metern (lokale ebene Näherung; Punkte { lat, lng }). */
export function abstandZuLinie(p, linie) {
  if (!linie || !linie.length) return Infinity;
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110540;
  const xy = q => [(q.lng - p.lng) * kx, (q.lat - p.lat) * ky];
  if (linie.length === 1) return Math.hypot(...xy(linie[0]));
  let best = Infinity;
  for (let i = 0; i < linie.length - 1; i++) {
    const [ax, ay] = xy(linie[i]), [bx, by] = xy(linie[i + 1]);
    const dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
    const t = n ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Länge einer Polylinie in Metern (Punkte { lat, lng }). */
export function linienLaenge(linie) {
  let s = 0;
  for (let i = 1; i < (linie || []).length; i++) {
    const a = linie[i - 1], b = linie[i];
    const kx = 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    s += Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * 110540);
  }
  return s;
}

/** Linie vereinfachen: Zwischenpunkte entfernen, die höchstens tolM von der Geraden zwischen ihren Nachbarn abweichen. */
export function linieVereinfachen(linie, tolM = 0.5) {
  if (!linie || linie.length <= 2) return linie ? [...linie] : [];
  const out = [linie[0]];
  for (let i = 1; i < linie.length - 1; i++) {
    if (abstandZuLinie(linie[i], [out[out.length - 1], linie[i + 1]]) > tolM) out.push(linie[i]);
  }
  out.push(linie[linie.length - 1]);
  return out;
}
