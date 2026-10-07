// ── lib/ms-spannung.js — MS-Nennspannung je Kabel aus dem speisenden NAP ──────
// Jedes MS-Kabel rechnet mit der Spannung SEINES Netzanknüpfungspunkts: vom NAP
// aus wird die Spannung über die MS-Kanten weitergereicht. Kabel ohne Weg zu
// einem NAP bekommen die Spannung des ersten NAP mit Eintrag; erst wenn gar
// kein NAP eine Spannung trägt, gilt die Vorgabe 20 kV.

export const MS_SPANNUNG_VORGABE_KV = 20;

const _kv = v => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {Array<{id:any}>} naps            NAP-Assets (bevorzugte zuerst)
 * @param {Array<{u:any,v:any,msLevel?:boolean}>} kanten  Kabel des Netzes
 * @param {(nap:object)=>any} kvVon         liefert spannungKV eines NAP
 * @returns {{ standardV:number, ausNap:boolean, kanteV:(e:object)=>number }}
 */
export function msSpannungen(naps, kanten, kvVon) {
  const msAdj = new Map();
  for (const e of kanten || []) {
    if (!e?.msLevel) continue;
    if (!msAdj.has(e.u)) msAdj.set(e.u, []);
    if (!msAdj.has(e.v)) msAdj.set(e.v, []);
    msAdj.get(e.u).push(e.v);
    msAdj.get(e.v).push(e.u);
  }
  const jeKnoten = new Map();
  let standardKv = null;
  for (const nap of naps || []) {
    const kv = _kv(kvVon(nap));
    if (kv == null) continue;
    if (standardKv == null) standardKv = kv;
    if (jeKnoten.has(nap.id)) continue;      // schon von einem vorrangigen NAP erreicht
    const queue = [nap.id];
    jeKnoten.set(nap.id, kv);
    while (queue.length) {
      const id = queue.shift();
      for (const n of msAdj.get(id) || []) {
        if (jeKnoten.has(n)) continue;
        jeKnoten.set(n, kv);
        queue.push(n);
      }
    }
  }
  const standardV = (standardKv ?? MS_SPANNUNG_VORGABE_KV) * 1000;
  return {
    standardV,
    ausNap: standardKv != null,
    kanteV: e => ((jeKnoten.get(e.u) ?? jeKnoten.get(e.v)) ?? standardV / 1000) * 1000,
  };
}
