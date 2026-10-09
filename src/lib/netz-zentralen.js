// ── lib/netz-zentralen.js — mehrere Heizzentralen an einem Wärmenetz (DOM-frei) ──
// Jede Zentrale versorgt eine Zone (die Gebäude, die ihr am nächsten liegen bzw. fest zugeordnet sind).
// Die Zonen werden über Verbindungsleitungen gekuppelt; dort liegt im Normalbetrieb die Trennstelle.

const abstandM = (a, b) => {
  const kx = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), ky = 110540;
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * ky);
};

/**
 * Zuordnung Gebäude → Zentrale: feste Zuordnung (fest: Map gebId → zentraleId), sonst die nächstgelegene Zentrale.
 * punkte: [{ id, pt: {lat,lng} }]; zentralen: [{ id, pt }]. Zentralen gehören zu sich selbst.
 */
export function zentraleJeGebaeude(punkte, zentralen, fest = new Map()) {
  const out = new Map();
  const ids = new Set(zentralen.map(z => z.id));
  for (const z of zentralen) out.set(z.id, z.id);
  for (const p of punkte) {
    if (ids.has(p.id)) continue;
    const f = fest.get(p.id);
    if (f != null && ids.has(f)) { out.set(p.id, f); continue; }
    let best = null, d = Infinity;
    for (const z of zentralen) { const a = abstandM(p.pt, z.pt); if (a < d) { d = a; best = z.id; } }
    if (best != null) out.set(p.id, best);
  }
  return out;
}

/**
 * Verbindungsleitungen zwischen den Zonen: kürzeste Verbindung je Zonenpaar, davon ein minimaler Spannbaum
 * (bei zwei Zentralen genau eine Leitung). zonen: Map zentraleId → [{ id, pt }] (Knoten des Teilnetzes).
 * Ergebnis: [{ a: {id, pt}, b: {id, pt}, laengeM, zonen: [z1, z2] }].
 */
export function kuppelVerbindungen(zonen) {
  const keys = [...zonen.keys()];
  const paare = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      let best = null;
      for (const a of zonen.get(keys[i]) || []) for (const b of zonen.get(keys[j]) || []) {
        const d = abstandM(a.pt, b.pt);
        if (!best || d < best.laengeM) best = { a, b, laengeM: d, zonen: [keys[i], keys[j]] };
      }
      if (best) paare.push(best);
    }
  }
  paare.sort((x, y) => x.laengeM - y.laengeM);
  const gruppe = new Map(keys.map(k => [k, k]));
  const finde = k => { while (gruppe.get(k) !== k) k = gruppe.get(k); return k; };
  const out = [];
  for (const p of paare) {
    const ra = finde(p.zonen[0]), rb = finde(p.zonen[1]);
    if (ra === rb) continue;
    gruppe.set(ra, rb);
    out.push(p);
  }
  return out;
}

/**
 * Stündliche Übergabe zwischen den Zonen bei gemeinsamem Einsatz der Erzeuger: je Zone Einspeisung (Erzeuger an
 * dieser Zentrale) minus Bedarf (Lastanteil der Zone). Positiv = die Zone gibt Wärme an das übrige Netz ab.
 * einspeisungKw: Map zentraleId → Float32Array; anteil: Map zentraleId → Lastanteil (Summe 1); lastKw: Gesamtlast.
 */
export function zonenUebergabe(einspeisungKw, anteil, lastKw) {
  const n = lastKw.length;
  const out = new Map();
  for (const [z, a] of anteil) {
    const e = einspeisungKw.get(z);
    const u = new Float32Array(n);
    let maxAb = 0, maxAuf = 0, abMwh = 0, aufMwh = 0;
    for (let t = 0; t < n; t++) {
      u[t] = (e ? e[t] : 0) - lastKw[t] * a;
      if (u[t] > maxAb) maxAb = u[t];
      if (-u[t] > maxAuf) maxAuf = -u[t];
      if (u[t] > 0) abMwh += u[t] / 1000; else aufMwh -= u[t] / 1000;
    }
    out.set(z, { uebergabeKw: u, maxAbgabeKw: maxAb, maxAufnahmeKw: maxAuf, abgabeMwh: abMwh, aufnahmeMwh: aufMwh });
  }
  return out;
}
