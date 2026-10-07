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

/** Nächster Punkt auf einer Polylinie: { punkt: { lat, lng }, abstand (m) }. */
export function naechsterPunktAufLinie(p, linie) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110540;
  let best = { punkt: linie?.[0] || p, abstand: Infinity };
  for (let i = 0; i < (linie || []).length - 1; i++) {
    const a = linie[i], b = linie[i + 1];
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
    const t = n ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.abstand) best = { punkt: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }, abstand: d };
  }
  return best;
}

/**
 * Gebäudeanschlüsse verbessern: Lohnt es sich, die Gebäude eines Asts per kurzem Stich an eine andere Leitung zu hängen,
 * damit der Ast samt verwaister Zuleitung entfällt? Bewertet wird die eingesparte Trassenlänge (Ast, verwaiste
 * Abzweige) gegen die neuen Stiche — so wird ein Gebäude auch von der etwas weiter entfernten Straße angeschlossen,
 * wenn dafür kein Bogen um den Block nötig ist.
 * kanten: [{ u, v, linie }]; o: { zentraleId, istAbzweig(id), gebaeude: Map id → { lat, lng }, kreuzt(von, nach, gebId) → bool,
 *   maxStichM = 60, mehrAlsBisherM = 40, minGewinnM = 10, maxGebaeude = 12 }.
 * Ergebnis: { kante, entfallen: [kanten], stiche: [{ gebId, ziel: kante, punkt, laenge }], gewinn } oder null.
 */
export function besteAstVerlegung(kanten, o) {
  const { zentraleId, istAbzweig, gebaeude, kreuzt = () => false } = o;
  const maxStich = o.maxStichM ?? 60, mehr = o.mehrAlsBisherM ?? 40, minGewinn = o.minGewinnM ?? 10, maxGeb = o.maxGebaeude ?? 12;
  const laenge = k => linienLaenge(k.linie);
  // bisheriger Stich je Gebäude (Länge der Leitung am Gebäude)
  const bisher = new Map();
  for (const k of kanten) for (const id of [k.u, k.v]) if (gebaeude.has(id)) bisher.set(id, Math.min(bisher.get(id) ?? Infinity, laenge(k)));
  let best = null;
  for (const kante of kanten) {
    if (kante.u === zentraleId || kante.v === zentraleId) continue;
    const a = strangAnalyse(kanten, kante, zentraleId, istAbzweig);
    if (!a) continue;
    const geb = [...a.teilnetz].filter(id => gebaeude.has(id));
    if (!geb.length || geb.length > maxGeb) continue;
    const imAst = kanten.filter(e => a.teilnetz.has(e.u) && a.teilnetz.has(e.v));
    // Ziele der Stiche: übriges Netz und die Zuleitung, die sonst verwaist (sie bleibt dann ab dem Anschluss erhalten)
    const tot = new Set(a.totKanten);
    const ziele = kanten.filter(e => e !== kante && !imAst.includes(e) && !a.teilnetz.has(e.u) && !a.teilnetz.has(e.v));
    if (!ziele.length) continue;
    const stiche = [];
    let ok = true;
    for (const id of geb) {
      const p = gebaeude.get(id);
      let s = null;
      for (const e of ziele) {
        const n = naechsterPunktAufLinie(p, e.linie);
        if (!s || n.abstand < s.laenge) s = { gebId: id, ziel: e, punkt: n.punkt, laenge: n.abstand };
      }
      if (!s || s.laenge > maxStich || s.laenge > (bisher.get(id) ?? 0) + mehr || kreuzt(p, s.punkt, id)) { ok = false; break; }
      stiche.push(s);
    }
    if (!ok) continue;
    // Von der Zuleitung bleibt alles ab dem am weitesten außen genutzten Abschnitt (totKanten läuft von außen zur Zentrale)
    const genutzt = stiche.filter(st => tot.has(st.ziel)).map(st => a.totKanten.indexOf(st.ziel));
    const ab = genutzt.length ? Math.min(...genutzt) : a.totKanten.length;
    const entfallen = new Set([kante, ...imAst, ...a.totKanten.slice(0, ab)]);
    const gewinn = [...entfallen].reduce((sum, e) => sum + laenge(e), 0) - stiche.reduce((sum, s) => sum + s.laenge, 0);
    if (gewinn >= minGewinn && (!best || gewinn > best.gewinn)) best = { kante, entfallen: [...entfallen], stiche, gewinn };
  }
  return best;
}

/**
 * Hin-und-zurück-Stücke aus einem Verlauf entfernen: läuft die Linie zu einem Punkt und auf demselben Weg zurück
 * (z. B. weil ein Zwischenziel hinter dem Ende lag), wird der Abstecher abgeschnitten. Anfang und Ende bleiben.
 */
export function stichEntfernen(linie, tolM = 1) {
  const pkte = linie || [];
  if (pkte.length < 3) return [...pkte];
  const out = [];
  const gleich = (a, b) => abstandZuLinie(a, [b]) <= tolM;
  for (const p of pkte) {
    // Läuft die Linie auf dem zuletzt gelaufenen Stück zurück, war dessen Endpunkt die Spitze eines Abstechers
    while (out.length >= 2 && abstandZuLinie(p, [out[out.length - 2], out[out.length - 1]]) <= tolM) out.pop();
    if (out.length && gleich(p, out[out.length - 1])) { out[out.length - 1] = p; continue; }
    out.push(p);
  }
  // Endpunkte exakt erhalten
  out[0] = pkte[0];
  out[out.length - 1] = pkte[pkte.length - 1];
  return out;
}

/**
 * Doppelt verlegte Abschnitte: Stellen, an denen eine Leitung über mindestens minM direkt neben einer anderen liegt
 * (Abstand ≤ tolM). kanten: [{ linie, ... }]. Ergebnis: [{ a, b, laengeM }] je betroffenem Paar.
 */
export function parallelAbschnitte(kanten, tolM = 3, minM = 15, schrittM = 3) {
  const box = l => l.reduce((b, p) => ({ s: Math.min(b.s, p.lat), n: Math.max(b.n, p.lat), w: Math.min(b.w, p.lng), o: Math.max(b.o, p.lng) }),
    { s: Infinity, n: -Infinity, w: Infinity, o: -Infinity });
  const boxen = kanten.map(k => box(k.linie || []));
  const rand = 0.00005;   // ≈ 5 m
  const proben = l => {
    const out = [];
    for (let i = 0; i < l.length - 1; i++) {
      const n = Math.max(1, Math.ceil(linienLaenge([l[i], l[i + 1]]) / schrittM));
      for (let j = 0; j < n; j++) out.push({ lat: l[i].lat + ((l[i + 1].lat - l[i].lat) * j) / n, lng: l[i].lng + ((l[i + 1].lng - l[i].lng) * j) / n });
    }
    return out;
  };
  const treffer = [];
  for (let i = 0; i < kanten.length; i++) {
    const pi = proben(kanten[i].linie || []);
    for (let j = i + 1; j < kanten.length; j++) {
      const a = boxen[i], b = boxen[j];
      if (a.n + rand < b.s || b.n + rand < a.s || a.o + rand < b.w || b.o + rand < a.w) continue;
      let lauf = 0, best = 0;
      for (const p of pi) {
        if (abstandZuLinie(p, kanten[j].linie) <= tolM) { lauf += schrittM; best = Math.max(best, lauf); } else lauf = 0;
      }
      if (best >= minM) treffer.push({ a: kanten[i], b: kanten[j], laengeM: best });
    }
  }
  return treffer;
}
