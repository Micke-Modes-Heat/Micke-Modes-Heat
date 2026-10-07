// ── lib/netz-quartiere.js — Versorgungsquartiere mit eigenem Hauptstrang ab der Heizzentrale ──
// DOM-frei. Ein Versorgungsquartier ist eine Gruppe von Gebäuden, die über einen eigenen Strang direkt an der
// Zentrale hängt — nicht als Abzweig eines anderen Quartiers. Die Netzerstellung baut je Quartier einen eigenen
// Baum ab der Zentrale; die übrigen Gebäude werden wie bisher gemeinsam versorgt.

export const QUARTIER_FARBEN = ['#8e24aa', '#00897b', '#f4511e', '#3949ab', '#7cb342', '#6d4c41', '#d81b60', '#039be5'];

/** Gebäude → Quartier (jedes Gebäude gehört höchstens einem Quartier; frühere Quartiere haben Vorrang). */
export function quartierJeGebaeude(quartiere, zentraleId = null) {
  const zu = new Map();
  for (const q of quartiere || []) for (const id of q.gebIds || []) if (id !== zentraleId && !zu.has(id)) zu.set(id, q.id);
  return zu;
}

/**
 * Gruppen für die Netzerstellung: zuerst die übrigen Gebäude (id null), dann je Quartier eine Gruppe.
 * gebIds: alle anzuschließenden Gebäude (die Zentrale wird ausgelassen). Leere Gruppen entfallen.
 */
export function strangGruppen(gebIds, quartiere, zentraleId) {
  const zu = quartierJeGebaeude(quartiere, zentraleId);
  const ids = gebIds.filter(id => id !== zentraleId);
  const gruppen = [];
  const rest = ids.filter(id => !zu.has(id));
  if (rest.length) gruppen.push({ id: null, gebIds: rest });
  for (const q of quartiere || []) {
    const eigene = ids.filter(id => zu.get(id) === q.id);
    if (eigene.length) gruppen.push({ id: q.id, gebIds: eigene });
  }
  return gruppen;
}

/**
 * Sackgassen entfernen: Leitungen, die an einem freien Abzweig- oder Trassenknoten enden (versorgen niemanden).
 * kanten: [{ u, v }]; istFrei(id): true für Knoten ohne Abnehmer, die wegfallen dürfen.
 */
export function sackgassenEntfernen(kanten, istFrei) {
  let rest = [...kanten];
  for (;;) {
    const grad = new Map();
    for (const k of rest) { grad.set(k.u, (grad.get(k.u) || 0) + 1); grad.set(k.v, (grad.get(k.v) || 0) + 1); }
    const neu = rest.filter(k => !((grad.get(k.u) === 1 && istFrei(k.u)) || (grad.get(k.v) === 1 && istFrei(k.v))));
    if (neu.length === rest.length) return rest;
    rest = neu;
  }
}

/**
 * Hauptstränge eines Netzes (Baum mit der Zentrale als Wurzel): Für jeden Knoten der Abgang an der Zentrale, über den er
 * versorgt wird, und für jeden Abgang die Quartiere der dort versorgten Gebäude.
 * kanten: [{ u, v }]; quartierVon: Map gebId → Quartier-ID (Gebäude ohne Quartier: nicht enthalten).
 * Ergebnis: { abgangVon: Map knoten → abgang, quartierVonAbgang: Map abgang → Quartier-ID | null | 'gemischt',
 *   gemischt: [abgang] (Abgänge, die Gebäude aus verschiedenen Quartieren versorgen) }.
 */
export function hauptstraenge(kanten, zentraleId, quartierVon, istGebaeude = () => true) {
  const nachbarn = new Map();
  const add = (a, b) => { if (!nachbarn.has(a)) nachbarn.set(a, []); nachbarn.get(a).push(b); };
  for (const k of kanten) { add(k.u, k.v); add(k.v, k.u); }
  const abgangVon = new Map();
  for (const start of nachbarn.get(zentraleId) || []) {
    if (abgangVon.has(start)) continue;
    abgangVon.set(start, start);
    const schlange = [start];
    while (schlange.length) {
      const n = schlange.shift();
      for (const x of nachbarn.get(n) || []) {
        if (x === zentraleId || abgangVon.has(x)) continue;
        abgangVon.set(x, start);
        schlange.push(x);
      }
    }
  }
  const quartierVonAbgang = new Map();
  for (const [knoten, abgang] of abgangVon) {
    if (!istGebaeude(knoten)) continue;
    const q = quartierVon.get(knoten) ?? null;
    if (!quartierVonAbgang.has(abgang)) quartierVonAbgang.set(abgang, q);
    else if (quartierVonAbgang.get(abgang) !== q) quartierVonAbgang.set(abgang, 'gemischt');
  }
  const gemischt = [...quartierVonAbgang].filter(([, q]) => q === 'gemischt').map(([a]) => a);
  return { abgangVon, quartierVonAbgang, gemischt };
}
