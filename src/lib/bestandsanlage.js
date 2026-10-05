// ── lib/bestandsanlage.js — Bestandsanlage Wärme (Ist): Erzeugerpark, Hydraulik, Trinkwarmwasser ──
// DOM-frei. Die Bestandsanlage ist getrennt von den Erzeugern der Varianten: Sie beschreibt, was heute steht
// (Gutachten Kapitel „Ist-Zustand Anlagentechnik“), nicht was geplant ist.
//
//   baNormalisiere(roh)                     gespeicherten Stand prüfen und bereinigen
//   baAuswertung(ba, { heizlastIstKw, heizlastSollKw, jahr })   Summen, Anteile, Reserve, (n−1), Alter
//   baTwwAuswertung(gebaeude)               Trinkwarmwasser je Erzeugungsart aus den Gebäudedaten

/**
 * Erzeugerarten. nutzungsdauer: kalkulatorische Nutzungsdauer in Jahren nach VDI 2067 Blatt 1 (Richtwerte).
 * traeger: Energieträger; fossil/ee für die Einordnung des Erzeugerparks.
 */
export const BA_TYPEN = Object.freeze({
  nt_gaskessel:  { name: 'NT-Gaskessel', traeger: 'Erdgas', fossil: true, nutzungsdauer: 20 },
  bw_gaskessel:  { name: 'Brennwertkessel', traeger: 'Erdgas', fossil: true, nutzungsdauer: 20 },
  oelkessel:     { name: 'Heizölkessel', traeger: 'Heizöl', fossil: true, nutzungsdauer: 20 },
  bhkw_gas:      { name: 'BHKW', traeger: 'Erdgas', fossil: true, kwk: true, nutzungsdauer: 15 },
  pelletkessel:  { name: 'Pelletkessel', traeger: 'Holzpellets', ee: true, nutzungsdauer: 15 },
  hhs_kessel:    { name: 'Hackschnitzelkessel', traeger: 'Holzhackschnitzel', ee: true, nutzungsdauer: 15 },
  waermepumpe:   { name: 'Wärmepumpe', traeger: 'Strom', ee: true, nutzungsdauer: 18 },
  elektrokessel: { name: 'Elektrokessel', traeger: 'Strom', nutzungsdauer: 20 },
  fernwaerme:    { name: 'Fernwärmeübergabe', traeger: 'Fernwärme', nutzungsdauer: 30 },
  solarthermie:  { name: 'Solarthermie', traeger: 'Solar', ee: true, nutzungsdauer: 20 },
  sonstiges:     { name: 'Sonstiger Erzeuger', traeger: '', nutzungsdauer: 20 },
});

/** Trinkwarmwasser-Erzeugungsarten (Gebäudefeld twwArt). */
export const BA_TWW_ARTEN = Object.freeze({
  fws: { name: 'Frischwasserstation (FWS)', prinzip: 'durchlauf' },
  pwt: { name: 'Plattenwärmetauscher (PWT)', prinzip: 'durchlauf' },
  dle: { name: 'Durchlauferhitzer, elektrisch (DLE)', prinzip: 'elektrisch' },
  speicher: { name: 'Indirekt beheizter Speicher', prinzip: 'speicher' },
  klein: { name: 'Kleinspeicher (dezentral)', prinzip: 'speicher' },
  keine: { name: 'Ohne TWW-Erzeugung', prinzip: 'keine' },
});

const zahl = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : NaN; };
const pos = v => { const x = zahl(v); return Number.isFinite(x) && x > 0 ? x : NaN; };
const txt = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function baLeer() {
  return { erzeuger: [], pufferM3: '', heizzentrale: '', schemaJahr: '', netzDaten: 'plan' };
}

export function baNormalisiere(roh) {
  const r = roh && typeof roh === 'object' ? roh : {};
  return {
    erzeuger: (Array.isArray(r.erzeuger) ? r.erzeuger : []).filter(e => e && typeof e === 'object').map(e => ({
      typ: BA_TYPEN[e.typ] ? e.typ : 'sonstiges',
      bezeichnung: txt(e.bezeichnung),
      thermKw: txt(e.thermKw), feuerungKw: txt(e.feuerungKw), elKw: txt(e.elKw), baujahr: txt(e.baujahr),
    })),
    pufferM3: txt(r.pufferM3), heizzentrale: txt(r.heizzentrale), schemaJahr: txt(r.schemaJahr),
    netzDaten: ['keine', 'plan', 'vollstaendig'].includes(r.netzDaten) ? r.netzDaten : 'plan',
  };
}

/**
 * Auswertung des Erzeugerparks.
 * o: { heizlastIstKw, heizlastSollKw, jahr (Bezugsjahr für das Alter, Standard aktuelles Jahr) }
 */
export function baAuswertung(ba, o = {}) {
  const n = baNormalisiere(ba);
  const jahr = Number(o.jahr) || new Date().getFullYear();
  const zeilen = n.erzeuger.map((e, i) => {
    const t = BA_TYPEN[e.typ];
    const bj = parseInt(e.baujahr, 10);
    const baujahr = Number.isFinite(bj) && bj > 1900 ? bj : null;
    return {
      nr: i + 1, typ: e.typ, name: e.bezeichnung || t.name, typName: t.name, traeger: t.traeger, fossil: !!t.fossil, ee: !!t.ee, kwk: !!t.kwk,
      thermKw: pos(e.thermKw), feuerungKw: pos(e.feuerungKw), elKw: pos(e.elKw), baujahr,
      nutzungsdauer: t.nutzungsdauer, abgaengigAb: baujahr ? baujahr + t.nutzungsdauer : null, alter: baujahr ? jahr - baujahr : null,
    };
  });
  const s = f => zeilen.reduce((x, z) => x + (Number.isFinite(z[f]) ? z[f] : 0), 0);
  const thermKw = s('thermKw');
  for (const z of zeilen) z.anteilPct = thermKw > 0 && Number.isFinite(z.thermKw) ? (z.thermKw / thermKw) * 100 : NaN;
  const groesster = [...zeilen].filter(z => Number.isFinite(z.thermKw)).sort((a, b) => b.thermKw - a.thermKw)[0] || null;
  const anteil = fn => (thermKw > 0 ? (zeilen.filter(fn).reduce((x, z) => x + (z.thermKw || 0), 0) / thermKw) * 100 : NaN);
  const traegerAnteile = [...new Set(zeilen.map(z => z.traeger).filter(Boolean))]
    .map(t => ({ traeger: t, pct: anteil(z => z.traeger === t) })).sort((a, b) => b.pct - a.pct);
  const hIst = pos(o.heizlastIstKw), hSoll = pos(o.heizlastSollKw);
  const maxLast = Math.max(Number.isFinite(hIst) ? hIst : 0, Number.isFinite(hSoll) ? hSoll : 0) || NaN;
  const ohneGroessten = groesster ? thermKw - groesster.thermKw : NaN;
  return {
    zeilen, anzahl: zeilen.length, thermKw, feuerungKw: s('feuerungKw'), elKw: s('elKw'),
    fossilPct: anteil(z => z.fossil), eePct: anteil(z => z.ee), traegerAnteile, groesster,
    heizlastIstKw: hIst, heizlastSollKw: hSoll,
    reserveIstKw: Number.isFinite(hIst) ? thermKw - hIst : NaN, reserveSollKw: Number.isFinite(hSoll) ? thermKw - hSoll : NaN,
    ohneGroesstenKw: ohneGroessten,
    n1Erfuellt: Number.isFinite(maxLast) && Number.isFinite(ohneGroessten) ? ohneGroessten >= maxLast : null,
    abgaengig: zeilen.filter(z => z.abgaengigAb !== null && z.abgaengigAb <= jahr),
    jahr, pufferM3: pos(n.pufferM3), heizzentrale: n.heizzentrale, schemaJahr: parseInt(n.schemaJahr, 10) || null, netzDaten: n.netzDaten,
  };
}

/** Trinkwarmwasser je Erzeugungsart aus den Gebäudefeldern twwArt / twwKw. */
export function baTwwAuswertung(gebaeude = []) {
  const mit = gebaeude.filter(g => g && BA_TWW_ARTEN[g.twwArt]);
  const gruppen = Object.keys(BA_TWW_ARTEN).map(k => {
    const l = mit.filter(g => g.twwArt === k);
    return { art: k, name: BA_TWW_ARTEN[k].name, prinzip: BA_TWW_ARTEN[k].prinzip, anzahl: l.length,
      kw: l.reduce((x, g) => x + (pos(g.twwKw) || 0), 0),
      groesste: l.filter(g => pos(g.twwKw) > 0).sort((a, b) => pos(b.twwKw) - pos(a.twwKw)).slice(0, 3).map(g => ({ name: g.name || `Gebäude ${g.id}`, kw: pos(g.twwKw) })) };
  }).filter(x => x.anzahl > 0);
  const kw = gruppen.reduce((x, g) => x + g.kw, 0);
  for (const g of gruppen) g.anteilPct = kw > 0 ? (g.kw / kw) * 100 : NaN;
  const summe = arten => gruppen.filter(g => arten.includes(g.art)).reduce((x, g) => x + g.kw, 0);
  return {
    gruppen, kw, anzahlErfasst: mit.length, anzahlOhne: mit.filter(g => g.twwArt === 'keine').length,
    durchlaufKw: summe(['fws', 'pwt']), elektrischKw: summe(['dle']), speicherKw: summe(['speicher', 'klein']),
    groesste: mit.filter(g => ['fws', 'pwt'].includes(g.twwArt) && pos(g.twwKw) > 0).sort((a, b) => pos(b.twwKw) - pos(a.twwKw)).slice(0, 3)
      .map(g => ({ name: g.name || `Gebäude ${g.id}`, kw: pos(g.twwKw) })),
  };
}
