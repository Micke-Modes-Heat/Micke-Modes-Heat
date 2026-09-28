// ── lib/netzstrategie-core.js — PV-Netzstrategien: Anschlusswege je Flächengruppe ──
//
// Eine Netzstrategie legt je Flächengruppe (Dächer, die räumlich zusammengehören)
// einen Anschlussweg fest:
//   0   nicht belegen
//   A   Bestandsnetz — angebundene Dächer wie sie sind, nicht angebundene über einen
//       neuen Hausanschluss zum nächsten Netzknoten; Befüllung bis zur Netzgrenze
//   A~  wie A, aber alle Dächer voll belegt und die Einspeisung je Dach am EZA-Regler
//       auf die Netzgrenze begrenzt (Abregelung statt Weniger-Bauen)
//   B   wie A plus die Ertüchtigungen (Trafo/Kabel) auf den Wegen der Gruppe
//   C   neuer NS-Abgang: Kabel vom nächsten Trafo zu einem neuen Verteiler im
//       Schwerpunkt der Gruppe, Dächer sternförmig daran
//   D   neue Trafostation im Schwerpunkt, in den MS-Ring eingeschleift
//   E   Erzeugungsnetz: neue Station, eigenes MS-Kabel zum zusätzlichen Abgang
//       an der MS-Schaltanlage des Netzanschlusspunkts
// Alle Wege liegen hinter demselben NAP: dessen Einspeisegrenze bleibt gemeinsame
// Nebenbedingung und wird in der Energiebilanz stündlich abgeregelt.
//
// Bewertung: Die Strategie wird in eine Netz-Eingabe übersetzt (Bestand + neue
// Elemente + umgehängte Dächer + Ertüchtigungen) und mit pvnaFuellen befüllt —
// dieselbe Physik wie Netzaufnahme und Einlinienschema. Danach stündliche
// Energiebilanz (Eigenverbrauch, Einspeisung, Abregelung am Dach und am NAP)
// und Jahres-Netto-Überschuss wie in der PV-Analyse (Annuität PV + Netz).
//
// Optimierung: je Gruppe wenige Optionen → vollständige Aufzählung, bei zu vielen
// Kombinationen koordinatenweise lokale Suche von mehreren Startpunkten. Alle
// bewerteten Strategien bilden die Pareto-Front Netz-Invest ↔ nutzbare Energie;
// die Empfehlung wird über Preis-/Kostenszenarien auf Robustheit geprüft.
//
// Importfrei bis auf den Netzkern, DOM-frei → direkt in Unit-Tests nutzbar.

import { pvnaFuellen } from './pv-netzaufnahme-core.js';

const R_ERDE = 6371000;

// ══════════════════════════════════════════════════════════════════════════════
// KOSTENKATALOG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Standard-Kostenkatalog (Richtwerte, netto, Preisstand 2025/26). Im Projekt
 * editierbar; gespeichert werden nur Abweichungen (nsKostenMischen).
 */
export const NS_KOSTEN_STANDARD = {
  umwegFaktor:        { wert: 1.25,  einheit: '×',    label: 'Umwegfaktor Trasse (Luftlinie → Kabelweg)' },
  tiefbauNsEurM:      { wert: 100,   einheit: '€/m',  label: 'Tiefbau NS-Kabel (Graben, Oberfläche)' },
  hausanschlussEur:   { wert: 1500,  einheit: '€',    label: 'Hausanschluss je Dach (Anschlusskasten, Zähler, Montage)' },
  kvsEur:             { wert: 4500,  einheit: '€',    label: 'Neuer Kabelverteiler (KVS)' },
  nsAbgangEur:        { wert: 3000,  einheit: '€',    label: 'Neuer NS-Abgang am Trafo (NH-Leiste, Schutz)' },
  station250Eur:      { wert: 55000, einheit: '€',    label: 'Kompaktstation 250 kVA' },
  station400Eur:      { wert: 62000, einheit: '€',    label: 'Kompaktstation 400 kVA' },
  station630Eur:      { wert: 70000, einheit: '€',    label: 'Kompaktstation 630 kVA' },
  station1000Eur:     { wert: 90000, einheit: '€',    label: 'Kompaktstation 1.000 kVA' },
  station1600Eur:     { wert: 115000, einheit: '€',   label: 'Kompaktstation 1.600 kVA' },
  station2500Eur:     { wert: 150000, einheit: '€',   label: 'Kompaktstation 2.500 kVA' },
  msKabelEurM:        { wert: 90,    einheit: '€/m',  label: 'MS-Kabel 3 × 1 × 150 NA2XS2Y (Material + Einzug)' },
  msTiefbauEurM:      { wert: 150,   einheit: '€/m',  label: 'Tiefbau MS-Trasse' },
  msSchaltfeldEur:    { wert: 40000, einheit: '€',    label: 'MS-Abgangsfeld an der Schaltanlage (Erzeugungsnetz)' },
  ringEinschleifEur:  { wert: 15000, einheit: '€',    label: 'Ring-Einschleifung (Muffen, Ringkabelfelder)' },
  netzLebensdauer:    { wert: 40,    einheit: 'a',    label: 'Nutzungsdauer Netzbetriebsmittel (Annuität)' },
};
export const NS_TRAFO_GROESSEN = [250, 400, 630, 1000, 1600, 2500];

/** Katalog als { schluessel: zahl } — Standard, überschrieben durch gültige Projektwerte. */
export function nsKostenMischen(gespeichert) {
  const out = {};
  for (const [k, v] of Object.entries(NS_KOSTEN_STANDARD)) {
    const g = gespeichert?.[k];
    out[k] = Number.isFinite(+g) && +g >= 0 && g !== '' && g !== null ? +g : v.wert;
  }
  return out;
}

/** Kleinste Standard-Trafogröße (kVA), deren kVA·pf die Leistung trägt — null, wenn keine reicht. */
export function nsTrafoGroesse(pKw, pf = 0.9) {
  return NS_TRAFO_GROESSEN.find(kva => kva * pf >= pKw) ?? null;
}
export const nsStationEur = (kosten, kva) => kosten['station' + kva + 'Eur'] ?? kosten.station2500Eur;

// ══════════════════════════════════════════════════════════════════════════════
// GEOMETRIE
// ══════════════════════════════════════════════════════════════════════════════

/** Luftlinie in m (Haversine). */
export function nsDistanzM(a, b) {
  if (!a || !b) return Infinity;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R_ERDE * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Gewichteter Schwerpunkt [{ pos, w }] → { lat, lng } | null. */
export function nsSchwerpunkt(punkte) {
  let la = 0, ln = 0, w = 0;
  for (const p of punkte) {
    if (!p.pos) continue;
    const g = p.w > 0 ? p.w : 1;
    la += p.pos.lat * g; ln += p.pos.lng * g; w += g;
  }
  return w > 0 ? { lat: la / w, lng: ln / w } : null;
}

/** Nächster Kandidat [{ id, pos }] zu pos → { id, distM, pos } | null. */
export function nsNaechster(pos, kandidaten) {
  let best = null;
  for (const k of kandidaten) {
    const d = nsDistanzM(pos, k.pos);
    if (Number.isFinite(d) && (!best || d < best.distM)) best = { id: k.id, distM: d, pos: k.pos };
  }
  return best;
}

/**
 * Räumliche Gruppierung (Single-Linkage): Punkte, die über eine Kette von
 * Nachbarn mit höchstens abstandM verbunden sind, bilden eine Gruppe.
 * punkte: [{ id, pos }] — ohne pos bildet jeder Punkt eine eigene Gruppe.
 * Rückgabe: [[id, …]], stabil nach erster ID sortiert.
 */
export function nsGruppieren(punkte, abstandM) {
  const n = punkte.length;
  const eltern = punkte.map((_, i) => i);
  const wurzel = i => { while (eltern[i] !== i) { eltern[i] = eltern[eltern[i]]; i = eltern[i]; } return i; };
  for (let i = 0; i < n; i++) {
    if (!punkte[i].pos) continue;
    for (let j = i + 1; j < n; j++) {
      if (!punkte[j].pos) continue;
      if (nsDistanzM(punkte[i].pos, punkte[j].pos) <= abstandM) eltern[wurzel(i)] = wurzel(j);
    }
  }
  const m = new Map();
  punkte.forEach((p, i) => {
    const w = wurzel(i);
    if (!m.has(w)) m.set(w, []);
    m.get(w).push(p.id);
  });
  return [...m.values()].map(l => l.sort()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

// ══════════════════════════════════════════════════════════════════════════════
// OPTIONEN JE GRUPPE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Anschlusswege einer Gruppe mit Netz-Patch und Kosten.
 *
 * gruppe: { id, daecher: [dachId] }
 * ctx: {
 *   eingabe:   Netz-Eingabe des Bestands (elemente, daecher, …) — Dächer ohne
 *              elementId bzw. mit unbekanntem Element gelten als nicht angebunden
 *   dachPos:   Map<dachId, {lat,lng}>
 *   elPos:     Map<elementId, {lat,lng}> (Knoten hinter dem Element; Trafo = Sammelschiene)
 *   msPunkte:  [{ id, typ:'NAP'|'Schaltanlage'|'Trafo', name, pos }]
 *   kabelNeu:  (pKw, lengthM, duZielPct) → { kapKw, duProKwPct, eurM, text } | null
 *   kosten:    nsKostenMischen(…)
 *   duGrenzePct
 * }
 * Rückgabe: [{ id, label, kurz, investEUR, posten:[{label,eur}], patch, abregeln?,
 *   massnahmen?:[elementId], gekoppelt, hinweis?, geo?, machbar }]
 * patch: { entfernen:[dachId], neu:[element], umhaengen:{ dachId: elementId } }
 */
export function nsOptionen(gruppe, ctx) {
  const { eingabe, dachPos, elPos, msPunkte = [], kabelNeu, kosten } = ctx;
  const duG = ctx.duGrenzePct ?? eingabe.duGrenzePct ?? 3;
  const um = kosten.umwegFaktor || 1;
  const elById = new Map(eingabe.elemente.map(e => [e.id, e]));
  const dById = new Map(eingabe.daecher.map(d => [d.id, d]));
  const daecher = gruppe.daecher.map(id => dById.get(id)).filter(Boolean);
  const f = d => (d.einspFaktor > 0 ? d.einspFaktor : 0.8);
  const pGrp = daecher.reduce((t, d) => t + d.kwpMax * f(d), 0);
  const gid = gruppe.id;
  const opt = [];

  opt.push({ id: '0', label: 'nicht belegen', kurz: '—', investEUR: 0, posten: [], gekoppelt: false, machbar: true,
    patch: { entfernen: daecher.map(d => d.id), neu: [], umhaengen: {} } });

  // ── A: Bestandsnetz, fehlende Anschlüsse als Hausanschluss zum nächsten Knoten ──
  const knoten = [...elPos].filter(([, p]) => p).map(([id, pos]) => ({ id, pos }));
  const patchA = { entfernen: [], neu: [], umhaengen: {} };
  const postenA = [];
  const geoA = [];
  let investA = 0, nichtAnbindbar = 0;
  for (const d of daecher) {
    if (d.elementId != null && elById.has(d.elementId)) continue;
    const pos = dachPos.get(d.id);
    const n = pos ? nsNaechster(pos, knoten) : null;
    const L = n ? Math.max(10, n.distM * um) : null;
    const k = L != null ? kabelNeu(d.kwpMax * f(d), L, Math.min(1.5, duG / 2)) : null;
    if (!k) { nichtAnbindbar++; continue; }
    const eid = `N:${gid}:HA:${d.id}`;
    patchA.neu.push({ id: eid, typ: 'kabel', parentId: n.id, kapKw: k.kapKw, duProKwPct: k.duProKwPct, vorlastKw: 0, neu: true, text: k.text });
    patchA.umhaengen[d.id] = eid;
    const eur = kosten.hausanschlussEur + L * (k.eurM + kosten.tiefbauNsEurM);
    investA += eur;
    postenA.push({ label: `Hausanschluss ${d.id} (${k.text})`, eur });
    geoA.push({ von: pos, bis: n.pos, art: 'ns' });
  }
  const hinweisA = nichtAnbindbar ? `${nichtAnbindbar} Dach/Dächer ohne Lage oder zu weit vom Bestandsnetz — nicht anbindbar.` : '';
  // Kann kein einziges Dach der Gruppe ans Bestandsnetz, ist der Weg nicht machbar
  const angebunden = daecher.filter(d => (d.elementId != null && elById.has(d.elementId)) || patchA.umhaengen[d.id]).length;
  const machbarA = angebunden > 0;
  const zusatzA = nichtAnbindbar && machbarA ? ` (${nichtAnbindbar} nicht anbindbar)` : '';
  opt.push({ id: 'A', label: (patchA.neu.length ? `Bestandsnetz + ${patchA.neu.length} Hausanschl.` : 'Bestandsnetz') + zusatzA,
    kurz: 'Bestand', investEUR: machbarA ? investA : Infinity, posten: postenA, patch: patchA, gekoppelt: true, machbar: machbarA,
    hinweis: machbarA ? hinweisA : 'Kein Dach der Gruppe lässt sich mit Standardkabeln ans Bestandsnetz anbinden (zu weit).', geo: geoA });
  opt.push({ id: 'A~', label: 'Bestandsnetz, voll + Abregelung' + zusatzA, kurz: 'Bestand ~', investEUR: machbarA ? investA : Infinity, posten: postenA,
    patch: patchA, abregeln: true, gekoppelt: true, machbar: machbarA, hinweis: hinweisA, geo: geoA });

  // ── B: A + Ertüchtigungen auf den Wegen der Gruppe ──
  const mass = new Set();
  const elA = new Map([...elById, ...patchA.neu.map(e => [e.id, e])]);
  for (const d of daecher) {
    let cur = patchA.umhaengen[d.id] ?? d.elementId;
    const ges = new Set();
    while (cur != null && elA.has(cur) && !ges.has(cur)) {
      ges.add(cur);
      if (elA.get(cur).massnahme) mass.add(cur);
      cur = elA.get(cur).parentId;
    }
  }
  if (mass.size && machbarA) {
    // Die Maßnahmen werden erst auf Strategie-Ebene gezählt (mehrere Gruppen können sie teilen);
    // massnahmenEUR dient nur der Anzeige.
    const massnahmenEUR = [...mass].reduce((t, id) => t + (+elA.get(id).massnahme.investEUR || 0), 0);
    opt.push({ id: 'B', label: `Bestand + ${mass.size} Ertüchtigung${mass.size > 1 ? 'en' : ''}` + zusatzA, kurz: 'Ertüchtigung',
      investEUR: investA, massnahmenEUR, posten: [...postenA, ...[...mass].map(id => ({ label: elA.get(id).massnahme.label, eur: +elA.get(id).massnahme.investEUR || 0 }))],
      patch: patchA, massnahmen: [...mass], gekoppelt: true, machbar: true, hinweis: hinweisA, geo: geoA });
  }

  // Ab hier: neue Anschlüsse im Schwerpunkt der Gruppe
  const zentrum = nsSchwerpunkt(daecher.map(d => ({ pos: dachPos.get(d.id), w: d.kwpMax })));
  if (!zentrum || !daecher.length) return opt;
  const stern = (parentId, duZiel, praefix) => {
    const neu = [], posten = [], umhaengen = {}, geo = [];
    let eur = 0;
    for (const d of daecher) {
      const pos = dachPos.get(d.id) || zentrum;
      const L = Math.max(10, nsDistanzM(pos, zentrum) * um);
      const k = kabelNeu(d.kwpMax * f(d), L, duZiel);
      if (!k) return null;
      const eid = `N:${gid}:${praefix}:${d.id}`;
      neu.push({ id: eid, typ: 'kabel', parentId, kapKw: k.kapKw, duProKwPct: k.duProKwPct, vorlastKw: 0, neu: true, text: k.text });
      umhaengen[d.id] = eid;
      const e = kosten.hausanschlussEur + L * (k.eurM + kosten.tiefbauNsEurM);
      eur += e;
      posten.push({ label: `Anschluss ${d.id} (${k.text})`, eur: e });
      geo.push({ von: pos, bis: zentrum, art: 'ns' });
    }
    return { neu, posten, umhaengen, eur, geo };
  };

  // ── C: neuer NS-Abgang vom nächsten Trafo ──
  const trafos = [...elPos].filter(([id, p]) => p && elById.get(id)?.typ === 'trafo').map(([id, pos]) => ({ id, pos }));
  const tn = nsNaechster(zentrum, trafos);
  if (tn) {
    const Lz = Math.max(10, tn.distM * um);
    const zul = kabelNeu(pGrp, Lz, Math.min(1.5, duG / 2));
    const kvsId = `N:${gid}:KVS`;
    const s = zul ? stern(kvsId, Math.max(0.3, duG - 1.5) / 2, 'C') : null;
    if (zul && s) {
      const eurZ = Lz * (zul.eurM + kosten.tiefbauNsEurM);
      const posten = [{ label: 'NS-Abgang am Trafo', eur: kosten.nsAbgangEur }, { label: 'Kabelverteiler (KVS)', eur: kosten.kvsEur },
        { label: `Zuleitung Trafo → KVS (${zul.text})`, eur: eurZ }, ...s.posten];
      opt.push({ id: 'C', label: 'Neuer NS-Abgang', kurz: 'NS-Abgang', gekoppelt: true, machbar: true,
        investEUR: kosten.nsAbgangEur + kosten.kvsEur + eurZ + s.eur, posten,
        patch: { entfernen: [], umhaengen: s.umhaengen,
          neu: [{ id: kvsId, typ: 'kabel', parentId: tn.id, kapKw: zul.kapKw, duProKwPct: zul.duProKwPct, vorlastKw: 0, neu: true, text: zul.text }, ...s.neu] },
        geo: [...s.geo, { von: zentrum, bis: tn.pos, art: 'ns' }], station: { pos: zentrum, art: 'KVS' } });
    } else {
      opt.push({ id: 'C', label: 'Neuer NS-Abgang', kurz: 'NS-Abgang', machbar: false, investEUR: Infinity, posten: [], gekoppelt: true,
        patch: { entfernen: [], neu: [], umhaengen: {} }, hinweis: 'Kein Standardkabel (bis 4 × 240 mm²) trägt die Gruppe über diese Entfernung.' });
    }
  }

  // ── D / E: eigene Trafostation ──
  const kva = nsTrafoGroesse(pGrp);
  const stationsOption = (id, label, kurz, msZiel, msEur, msPostenLabel, msKabelFaktor) => {
    if (!kva) return { id, label, kurz, machbar: false, investEUR: Infinity, posten: [], gekoppelt: false,
      patch: { entfernen: [], neu: [], umhaengen: {} }, hinweis: 'Gruppe größer als 2.500 kVA — in Teilgruppen aufteilen.' };
    if (!msZiel) return { id, label, kurz, machbar: false, investEUR: Infinity, posten: [], gekoppelt: false,
      patch: { entfernen: [], neu: [], umhaengen: {} }, hinweis: 'Kein MS-Anschlusspunkt mit Lage im Netzmodell.' };
    const tId = `N:${gid}:T${id}`;
    const s = stern(tId, Math.max(0.5, duG * 0.8), id);
    if (!s) return { id, label, kurz, machbar: false, investEUR: Infinity, posten: [], gekoppelt: false,
      patch: { entfernen: [], neu: [], umhaengen: {} }, hinweis: 'Ein Dachanschluss ist mit Standardkabeln nicht auslegbar.' };
    const Lms = Math.max(10, msZiel.distM * um);
    const eurMs = Lms * (kosten.msKabelEurM * msKabelFaktor + kosten.msTiefbauEurM);
    const posten = [{ label: `Kompaktstation ${kva} kVA`, eur: nsStationEur(kosten, kva) },
      { label: msPostenLabel, eur: msEur }, { label: `MS-Trasse ${Math.round(Lms)} m`, eur: eurMs }, ...s.posten];
    return { id, label: `${label} (${kva} kVA)`, kurz, machbar: true, gekoppelt: false,
      investEUR: nsStationEur(kosten, kva) + msEur + eurMs + s.eur, posten,
      patch: { entfernen: [], umhaengen: s.umhaengen,
        neu: [{ id: tId, typ: 'trafo', parentId: null, kapKw: kva * 0.9, duProKwPct: 0, vorlastKw: 0, neu: true, text: `neue Station ${kva} kVA` }, ...s.neu] },
      geo: [...s.geo, { von: zentrum, bis: msZiel.pos, art: 'ms' }], station: { pos: zentrum, art: 'Station', kva }, msZiel };
  };
  const ring = nsNaechster(zentrum, msPunkte.filter(m => m.typ === 'Trafo' || m.typ === 'Schaltanlage'));
  opt.push(stationsOption('D', 'Neue Station am MS-Ring', 'Station Ring', ring && { ...ring, name: msPunkte.find(m => m.id === ring.id)?.name },
    kosten.ringEinschleifEur, 'Ring-Einschleifung', 2));
  const schalt = msPunkte.filter(m => m.typ === 'Schaltanlage');
  const napZiel = nsNaechster(zentrum, schalt.length ? schalt : msPunkte.filter(m => m.typ === 'NAP'));
  opt.push(stationsOption('E', 'Erzeugungsnetz, eigener MS-Abgang', 'Erzeugungsnetz', napZiel && { ...napZiel, name: msPunkte.find(m => m.id === napZiel.id)?.name },
    kosten.msSchaltfeldEur, 'MS-Abgangsfeld an der Schaltanlage', 1));
  return opt;
}

// ══════════════════════════════════════════════════════════════════════════════
// STRATEGIE → NETZ-EINGABE → BEFÜLLUNG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Setzt eine Strategie (wahl[g] = Index in optionen[g]) in eine Netz-Eingabe um.
 * Rückgabe: { eingabe, investEUR, investNeuEUR, investMassEUR, massnahmen:Set,
 *   abregeln:Set<dachId>, optionen:[option] }
 */
export function nsStrategieEingabe(basis, optionen, wahl) {
  const gewaehlt = optionen.map((l, g) => l[wahl[g]] || l[0]);
  const neu = [], entfernen = new Set(), umhaengen = new Map(), massnahmen = new Set(), abregeln = new Set();
  let investNeu = 0;
  gewaehlt.forEach((o, g) => {
    investNeu += Number.isFinite(o.investEUR) ? o.investEUR : 0;
    for (const id of o.patch.entfernen) entfernen.add(id);
    for (const [d, e] of Object.entries(o.patch.umhaengen)) umhaengen.set(d, e);
    neu.push(...o.patch.neu);
    for (const m of o.massnahmen || []) massnahmen.add(m);
    if (o.abregeln) for (const id of optionen[g][0].patch.entfernen) abregeln.add(id);   // alle Dächer der Gruppe
  });
  let investMass = 0;
  const elemente = basis.elemente.map(e => {
    if (!massnahmen.has(e.id) || !e.massnahme) return e;
    investMass += +e.massnahme.investEUR || 0;
    return { ...e, kapKw: e.massnahme.kapKw ?? e.kapKw, duProKwPct: e.massnahme.duProKwPct ?? e.duProKwPct };
  }).concat(neu);
  const daecher = basis.daecher.filter(d => !entfernen.has(d.id))
    .map(d => umhaengen.has(d.id) ? { ...d, elementId: umhaengen.get(d.id) } : d);
  return {
    eingabe: { ...basis, elemente, daecher },
    investEUR: investNeu + investMass, investNeuEUR: investNeu, investMassEUR: investMass,
    massnahmen, abregeln, optionen: gewaehlt,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ENERGIE + WIRTSCHAFT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Stündliche Energiebilanz einer befüllten Strategie.
 * fuell: pvnaFuellen-Ergebnis · eingabe: die Strategie-Eingabe · abregeln: Set<dachId>
 * ctx: { formen:{ sued, ostwest } (je 8760, Summe 1), spezSued (kWh/kWp),
 *        ostwest: Map<dachId,bool>, lastH: 8760 kW | null, napKw: Zahl | null }
 * Abregel-Dächer: gebaut wird die volle Fläche, die Einspeisung ist auf die
 * Netzgrenze kwp_Befüllung × Einspeisefaktor begrenzt.
 */
export function nsEnergie(fuell, eingabe, abregeln, ctx) {
  const N = 8760;
  const byId = new Map(eingabe.daecher.map(d => [d.id, d]));
  const koeff = { sued: 0, ostwest: 0 };
  const kappen = [];
  let kwp = 0, kwpNetz = 0;
  for (const r of fuell.daecher) {
    const d = byId.get(r.id);
    if (!d) continue;
    const spez = ctx.spezSued * (d.ertragFaktor || 1);
    const form = ctx.ostwest?.get(d.id) ? 'ostwest' : 'sued';
    const f = d.einspFaktor > 0 ? d.einspFaktor : 0.8;
    if (abregeln.has(d.id) && r.kwp > 0.05 && d.kwpMax > r.kwp + 0.05) {
      kappen.push({ a: d.kwpMax * spez, form, cap: r.kwp * f });
      kwp += d.kwpMax;
    } else {
      koeff[form] += r.kwp * spez;
      kwp += r.kwp;
    }
    kwpNetz += r.kwp;
  }
  const S = ctx.formen.sued, O = ctx.formen.ostwest;
  const last = ctx.lastH;
  const nap = ctx.napKw > 0 ? ctx.napKw : null;
  let erz = 0, eigen = 0, einsp = 0, abgDach = 0, abgNap = 0, spitze = 0, bedarf = 0;
  for (let h = 0; h < N; h++) {
    let p = koeff.sued * S[h] + koeff.ostwest * O[h];
    for (const k of kappen) {
      const roh = k.a * (k.form === 'ostwest' ? O[h] : S[h]);
      erz += roh;
      const ok = Math.min(roh, k.cap);
      abgDach += roh - ok;
      p += ok;
    }
    erz += koeff.sued * S[h] + koeff.ostwest * O[h];
    const l = last ? (last[h] || 0) : 0;
    bedarf += l;
    const ev = Math.min(l, p);
    const ex = p - ev;
    if (ex > spitze) spitze = ex;
    const exN = nap != null ? Math.min(ex, nap) : ex;
    eigen += ev; einsp += exN; abgNap += ex - exN;
  }
  const mwh = x => x / 1000;
  return {
    kwp, kwpNetz, erzeugungMwh: mwh(erz), eigenMwh: mwh(eigen), einspMwh: mwh(einsp),
    abgeregeltDachMwh: mwh(abgDach), abgeregeltNapMwh: mwh(abgNap), nutzbarMwh: mwh(eigen + einsp),
    rueckspeiseSpitzeKw: spitze, evQuotePct: erz > 0 ? eigen / erz * 100 : 0,
    autarkiePct: bedarf > 0 ? eigen / bedarf * 100 : 0, mitLastgang: !!last,
  };
}

export function nsAnnuitaet(z, n) {
  if (!z || z <= 0) return n > 0 ? 1 / n : 1;
  return z * Math.pow(1 + z, n) / (Math.pow(1 + z, n) - 1);
}

/**
 * Jahres-Netto-Überschuss wie pvWirtschaft (09d), ohne Speicher:
 * Erlöse (Eigenverbrauch × Bezugspreis + Einspeisung × Vergütung) minus
 * Jahreskosten (PV-Invest × (Annuität + Instandhaltung) + Netz-Invest × Annuität).
 * p: { pStrom, pEinsp (ct/kWh), pvInvestPerKwp, zins (0…1), pvLife, ihPv, netzLife }
 * m: Szenario-Faktoren { strom, einsp, netz, pv } (Standard 1).
 */
export function nsWirtschaft(energie, netzInvestEUR, p, m = {}) {
  const pvInvest = energie.kwp * p.pvInvestPerKwp * (m.pv ?? 1);
  const netz = netzInvestEUR * (m.netz ?? 1);
  const jkPv = pvInvest * (nsAnnuitaet(p.zins, p.pvLife) + (p.ihPv ?? 0.01));
  const jkNetz = netz * nsAnnuitaet(p.zins, p.netzLife);
  const erloes = energie.eigenMwh * p.pStrom * 10 * (m.strom ?? 1) + energie.einspMwh * p.pEinsp * 10 * (m.einsp ?? 1);
  const jk = jkPv + jkNetz;
  return { pvInvestEUR: pvInvest, netzInvestEUR: netz, jkPv, jkNetz, jk, erloes, ueberschuss: erloes - jk,
    lcoeCt: energie.nutzbarMwh > 0 ? jk / (energie.nutzbarMwh * 10) : null };
}

// ══════════════════════════════════════════════════════════════════════════════
// BEWERTUNG, ZIELFUNKTION, OPTIMIERUNG
// ══════════════════════════════════════════════════════════════════════════════

/** Eine Strategie vollständig bewerten (Netz → Energie → Wirtschaft). */
export function nsBewerten(basis, optionen, wahl, ectx, p) {
  const st = nsStrategieEingabe(basis, optionen, wahl);
  const fuell = pvnaFuellen(st.eingabe);
  const energie = nsEnergie(fuell, st.eingabe, st.abregeln, ectx);
  const wirt = nsWirtschaft(energie, st.investEUR, p);
  const machbar = st.optionen.every(o => o.machbar !== false);
  return { wahl: [...wahl], investEUR: st.investEUR, investNeuEUR: st.investNeuEUR, investMassEUR: st.investMassEUR,
    massnahmen: [...st.massnahmen], energie, wirt, machbar, fuell };
}

/**
 * Zielwert (größer = besser).
 * ziel: { art:'wirtschaft' } | { art:'budget', budgetEUR } (max. Energie im Budget)
 *       | { art:'zielkwp', kwp } (wirtschaftlich beste unter denen, die das Ziel erreichen)
 */
export function nsZielwert(r, ziel) {
  if (!r.machbar) return -1e15;
  if (ziel?.art === 'budget') {
    const b = +ziel.budgetEUR || 0;
    return r.investEUR <= b + 1e-6 ? r.energie.nutzbarMwh : -1e12 - (r.investEUR - b);
  }
  if (ziel?.art === 'zielkwp') {
    const z = +ziel.kwp || 0;
    // Unter allen Strategien, die das Ziel erreichen, die wirtschaftlich beste
    return r.energie.kwp >= z - 1e-6 ? r.wirt.ueberschuss : -1e12 - (z - r.energie.kwp) * 1e3;
  }
  return r.wirt.ueberschuss;
}

/**
 * Optimierung über alle Gruppen.
 * nOpt: [Anzahl Optionen je Gruppe] · bewerte(wahl) → Ergebnis mit zielwert
 * Vollständige Aufzählung bis maxKombi, sonst lokale Suche (koordinatenweise
 * Verbesserung) von mehreren Startpunkten; starts: [wahl] zusätzliche Startpunkte.
 * Rückgabe: { beste, alle:[Ergebnis], methode, bewertungen }
 */
export function nsOptimieren({ nOpt, bewerte, maxKombi = 2000, maxBewertungen = 4000, starts = [] }) {
  const cache = new Map();
  const eval_ = w => {
    const k = w.join(',');
    if (!cache.has(k)) cache.set(k, bewerte(w));
    return cache.get(k);
  };
  const kombi = nOpt.reduce((t, n) => t * Math.max(1, n), 1);
  let methode;
  if (kombi <= maxKombi) {
    methode = 'vollständig';
    const w = nOpt.map(() => 0);
    for (let i = 0; i < kombi; i++) {
      eval_(w);
      for (let g = 0; g < w.length; g++) { if (++w[g] < nOpt[g]) break; w[g] = 0; }
    }
  } else {
    methode = 'lokale Suche';
    const startListe = [...starts, nOpt.map(() => 0)];
    for (const s0 of startListe) {
      let w = [...s0];
      let best = eval_(w);
      let besser = true;
      while (besser && cache.size < maxBewertungen) {
        besser = false;
        for (let g = 0; g < w.length && cache.size < maxBewertungen; g++) {
          for (let o = 0; o < nOpt[g]; o++) {
            if (o === w[g]) continue;
            const v = [...w]; v[g] = o;
            const r = eval_(v);
            if (r.zielwert > best.zielwert + 1e-9) { best = r; w = v; besser = true; }
          }
        }
      }
    }
  }
  const alle = [...cache.values()];
  const beste = alle.reduce((a, b) => (b.zielwert > a.zielwert ? b : a), alle[0]);
  return { beste, alle, methode, bewertungen: cache.size, kombinationen: kombi };
}

/**
 * Pareto-Front (x klein = gut, y groß = gut): nicht dominierte Punkte,
 * nach x aufsteigend. xy: p → [x, y].
 */
export function nsPareto(punkte, xy) {
  const s = punkte.map(p => ({ p, v: xy(p) })).filter(o => Number.isFinite(o.v[0]) && Number.isFinite(o.v[1]))
    .sort((a, b) => a.v[0] - b.v[0] || b.v[1] - a.v[1]);
  const out = [];
  let yMax = -Infinity;
  for (const o of s) if (o.v[1] > yMax + 1e-9) { out.push(o.p); yMax = o.v[1]; }
  return out;
}

/** Szenarien für die Robustheitsprüfung (Faktoren auf Preise und Kosten). */
export const NS_SZENARIEN = [
  { id: 'basis', label: 'Basis', m: {} },
  { id: 'strom-', label: 'Strompreis −20 %', m: { strom: 0.8 } },
  { id: 'strom+', label: 'Strompreis +20 %', m: { strom: 1.2 } },
  { id: 'einsp-', label: 'Vergütung −30 %', m: { einsp: 0.7 } },
  { id: 'netz+', label: 'Netzkosten +30 %', m: { netz: 1.3 } },
  { id: 'netz-', label: 'Netzkosten −30 %', m: { netz: 0.7 } },
  { id: 'pv+', label: 'PV-Invest +20 %', m: { pv: 1.2 } },
];

/**
 * Robustheit: Überschuss jeder Kandidatin je Szenario, Bedauern = Abstand zur
 * jeweils besten. Empfehlung = geringstes maximales Bedauern (bei Gleichstand
 * höherer Basis-Überschuss). Rückgabe: { empfehlung, tabelle:[{ kandidat, werte, vorn, maxBedauern }] }
 */
export function nsRobustheit(kandidaten, p, szenarien = NS_SZENARIEN) {
  if (!kandidaten.length) return { empfehlung: null, tabelle: [] };
  const werte = kandidaten.map(k => szenarien.map(s => nsWirtschaft(k.energie, k.investEUR, p, s.m).ueberschuss));
  const bestJe = szenarien.map((_, i) => Math.max(...werte.map(w => w[i])));
  const tabelle = kandidaten.map((k, j) => ({
    kandidat: k, werte: werte[j],
    vorn: werte[j].filter((v, i) => v >= bestJe[i] - 1e-6).length,
    maxBedauern: Math.max(...werte[j].map((v, i) => bestJe[i] - v)),
  }));
  const empfehlung = tabelle.reduce((a, b) =>
    (b.maxBedauern < a.maxBedauern - 1e-6 || (Math.abs(b.maxBedauern - a.maxBedauern) <= 1e-6 && b.werte[0] > a.werte[0]) ? b : a));
  return { empfehlung, tabelle };
}

/**
 * Break-even eines Stationswegs (D/E) gegenüber dem Bestandsweg einer Gruppe:
 * ab welcher PV-Leistung kostet das Erzeugungsnetz je kWp weniger als der
 * Bestandsweg? kFix = Fixkosten der Station, kVar = variable Kosten je kWp
 * (Dachanschlüsse), kBestand = Netzkosten je zusätzlichem kWp auf dem Bestandsweg.
 * Rückgabe: kWp oder null (lohnt nie bzw. nicht berechenbar).
 */
export function nsBreakEven(kFix, kVar, kBestand) {
  if (!(kBestand > kVar) || !(kFix > 0)) return null;
  return kFix / (kBestand - kVar);
}
