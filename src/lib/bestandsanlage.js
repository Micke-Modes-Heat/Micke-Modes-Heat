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
  pelletkessel:  { name: 'Pelletkessel', traeger: 'Holzpellets', ee: true, nutzungsdauer: 20 },
  hhs_kessel:    { name: 'Hackschnitzelkessel', traeger: 'Holzhackschnitzel', ee: true, nutzungsdauer: 20 },
  waermepumpe:   { name: 'Wärmepumpe', traeger: 'Strom', ee: true, nutzungsdauer: 20 },
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

/** Kurzbezeichnungen für Tabellen. */
export const BA_TWW_KURZ = Object.freeze({ fws: 'FWS', pwt: 'PWT', dle: 'el. DLE', speicher: 'Speicher', klein: 'Kleinsp.', keine: 'keine' });

/** Zeitliche Auflösung der Verbrauchsdaten je Erzeuger. */
export const BA_AUFLOESUNG = Object.freeze({ viertelstunde: 'Viertelstundenwerte', stunde: 'Stundenwerte', monat: 'Monatswerte', jahr: 'Jahreswerte' });

/** Emissionsfaktoren nach GEG Anlage 9 in g CO₂-Äquivalent je kWh Endenergie. */
export const BA_CO2_GEG = Object.freeze({ Erdgas: 240, Heizöl: 310, Holzpellets: 20, Holzhackschnitzel: 20, Strom: 560, Fernwärme: 180, Solar: 0 });

const zahl = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : NaN; };
const pos = v => { const x = zahl(v); return Number.isFinite(x) && x > 0 ? x : NaN; };
const txt = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function baLeer() {
  return { erzeuger: [], pufferM3: '', heizzentrale: '', schemaJahr: '', netzDaten: 'plan', verbrauch: [] };
}

export function baNormalisiere(roh) {
  const r = roh && typeof roh === 'object' ? roh : {};
  return {
    erzeuger: (Array.isArray(r.erzeuger) ? r.erzeuger : []).filter(e => e && typeof e === 'object').map((e, i) => ({
      id: /^[\w-]{1,40}$/.test(String(e.id || '')) ? String(e.id) : `e${i + 1}`,
      typ: BA_TYPEN[e.typ] ? e.typ : 'sonstiges',
      aufloesung: BA_AUFLOESUNG[e.aufloesung] ? e.aufloesung : 'jahr',
      bezeichnung: txt(e.bezeichnung),
      thermKw: txt(e.thermKw), feuerungKw: txt(e.feuerungKw), elKw: txt(e.elKw), baujahr: txt(e.baujahr),
    })),
    pufferM3: txt(r.pufferM3), heizzentrale: txt(r.heizzentrale), schemaJahr: txt(r.schemaJahr),
    netzDaten: ['keine', 'plan', 'vollstaendig'].includes(r.netzDaten) ? r.netzDaten : 'plan',
    // Jahresverbräuche (Endenergie, MWh) je Bestandserzeuger: [{ jahr, werte: { erzeugerId: MWh } }]
    verbrauch: (Array.isArray(r.verbrauch) ? r.verbrauch : []).filter(v => v && Number.isInteger(Number(v.jahr)) && Number(v.jahr) > 1990)
      .map(v => ({ jahr: Number(v.jahr), werte: Object.fromEntries(Object.entries(v.werte && typeof v.werte === 'object' ? v.werte : {}).map(([k, x]) => [k, txt(x)])) }))
      .sort((a, b) => a.jahr - b.jahr),
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

/** TWW-Art aus Freitext (Import, Einfügen aus Excel): Kürzel oder Bezeichnung → Schlüssel; '' bei leer, null bei unbekannt. */
export function baTwwArtAusText(t) {
  const s = String(t ?? '').trim().toLowerCase();
  if (!s) return '';
  if (BA_TWW_ARTEN[s]) return s;
  if (/frischwasser|fws/.test(s)) return 'fws';
  if (/platten|pwt|wärmetauscher|waermetauscher/.test(s)) return 'pwt';
  if (/durchlauf|dle/.test(s)) return 'dle';
  if (/klein/.test(s)) return 'klein';
  if (/speicher|indirekt/.test(s)) return 'speicher';
  if (/^(keine?|ohne|nein|-|—)/.test(s)) return 'keine';
  return null;
}

/** Bauzustand aus Freitext: 1–3 oder A/B/C → '1' | '2' | '3'; '' bei leer, null bei unbekannt. */
export function baZustandAusText(t) {
  const s = String(t ?? '').trim().toUpperCase();
  if (!s) return '';
  const m = { A: '1', B: '2', C: '3', 1: '1', 2: '2', 3: '3' }[s.replace(/[.,]0+$/, '')];
  return m || null;
}

/** Gruppe eines Erzeugers für die Verbrauchsauswertung: KWK getrennt, sonst nach Energieträger. */
function verbrauchsGruppe(e) {
  const t = BA_TYPEN[e.typ];
  if (t.kwk) return { key: 'kwk', name: 'BHKW', label: 'das BHKW', traeger: t.traeger, fossil: !!t.fossil, ee: !!t.ee, kwk: true };
  const lbl = { Erdgas: 'der Erdgasbezug der Kessel', Heizöl: 'der Heizölbezug', Holzpellets: 'der Pelletbezug', Holzhackschnitzel: 'der Hackschnitzelbezug',
    Strom: 'der Strombezug der Wärmeerzeugung', Fernwärme: 'der Fernwärmebezug', Solar: 'der Solarertrag' }[t.traeger] || `der Bezug ${t.name}`;
  const name = { Erdgas: 'Erdgas (Kessel)', Holzpellets: 'Pellets', Holzhackschnitzel: 'Hackschnitzel' }[t.traeger] || t.traeger || t.name;
  return { key: t.traeger || e.typ, name, label: lbl, traeger: t.traeger, fossil: !!t.fossil, ee: !!t.ee, kwk: false };
}

/**
 * Mehrjahresauswertung der Verbrauchsdaten.
 * faktoren: g CO₂e/kWh je Energieträger (Standard GEG Anlage 9).
 */
export function baVerbrauchAuswertung(ba, faktoren = {}) {
  const n = baNormalisiere(ba);
  const f = { ...BA_CO2_GEG, ...faktoren };
  const gruppen = new Map();
  for (const e of n.erzeuger) {
    const g = verbrauchsGruppe(e);
    if (!gruppen.has(g.key)) gruppen.set(g.key, { ...g, ids: [], aufloesung: new Set() });
    gruppen.get(g.key).ids.push(e.id);
    gruppen.get(g.key).aufloesung.add(e.aufloesung);
  }
  const gl = [...gruppen.values()];
  const jahre = n.verbrauch.map(v => {
    const werte = Object.fromEntries(gl.map(g => [g.key, g.ids.reduce((x, id) => x + (pos(v.werte[id]) || 0), 0)]));
    const summe = Object.values(werte).reduce((x, y) => x + y, 0);
    const co2 = Object.fromEntries(gl.map(g => [g.key, (werte[g.key] * (f[g.traeger] ?? 0)) / 1000]));   // MWh × g/kWh / 1000 = t
    return { jahr: v.jahr, werte, summe, co2, co2Summe: Object.values(co2).reduce((x, y) => x + y, 0),
      fossilPct: summe > 0 ? (gl.filter(g => g.fossil).reduce((x, g) => x + werte[g.key], 0) / summe) * 100 : NaN };
  }).filter(j => j.summe > 0);
  const nJ = jahre.length;
  const mittel = k => (nJ ? jahre.reduce((x, j) => x + j.werte[k], 0) / nJ : NaN);
  const gruppenAus = gl.map(g => {
    const m = mittel(g.key);
    const reihe = jahre.map(j => j.werte[g.key]);
    const sd = nJ > 1 ? Math.sqrt(reihe.reduce((x, v) => x + (v - m) ** 2, 0) / (nJ - 1)) : 0;
    return { ...g, aufloesung: [...g.aufloesung], mittelMwh: m, cv: m > 0 ? sd / m : NaN,
      co2MittelT: nJ ? jahre.reduce((x, j) => x + j.co2[g.key], 0) / nJ : NaN, faktor: f[g.traeger] ?? 0 };
  }).filter(g => g.mittelMwh > 0 || !nJ).sort((a, b) => b.mittelMwh - a.mittelMwh);
  const summeMittel = nJ ? jahre.reduce((x, j) => x + j.summe, 0) / nJ : NaN;
  for (const g of gruppenAus) g.anteilPct = summeMittel > 0 ? (g.mittelMwh / summeMittel) * 100 : NaN;
  for (const j of jahre) j.anteile = Object.fromEntries(gruppenAus.map(g => [g.key, j.summe > 0 ? (j.werte[g.key] / j.summe) * 100 : 0]));
  // Referenzjahr: Aufteilung am nächsten am Mehrjahresmittel
  const abw = j => gruppenAus.reduce((x, g) => x + Math.abs(j.anteile[g.key] - g.anteilPct), 0);
  const referenz = nJ ? [...jahre].sort((a, b) => abw(a) - abw(b))[0] : null;
  const dominant = gruppenAus[0] || null;
  const co2Mittel = nJ ? jahre.reduce((x, j) => x + j.co2Summe, 0) / nJ : NaN;
  const minJ = nJ ? jahre.reduce((a, b) => (b.summe < a.summe ? b : a)) : null, maxJ = nJ ? jahre.reduce((a, b) => (b.summe > a.summe ? b : a)) : null;
  return {
    jahre, gruppen: gruppenAus, anzahlJahre: nJ, vonJahr: nJ ? jahre[0].jahr : null, bisJahr: nJ ? jahre[nJ - 1].jahr : null,
    summeMittel, minJahr: minJ, maxJahr: maxJ, dominant,
    dominantJedesJahr: !!dominant && jahre.every(j => gruppenAus.every(g => j.werte[dominant.key] >= j.werte[g.key])),
    fossilPctMittel: summeMittel > 0 ? (gruppenAus.filter(g => g.fossil).reduce((x, g) => x + g.mittelMwh, 0) / summeMittel) * 100 : NaN,
    referenzJahr: referenz?.jahr ?? null, co2MittelT: co2Mittel,
  };
}

/** Größte Verschiebung des fossilen Anteils zwischen zwei Folgejahren und ob sie später zurückging. */
export function baMixVerschiebung(v, schwellePp = 5) {
  const j = v.jahre;
  if (j.length < 3) return null;
  let best = null;
  for (let i = 1; i < j.length; i++) {
    const d = j[i].fossilPct - j[i - 1].fossilPct;
    if (d <= -schwellePp && (!best || d < best.deltaPp)) best = { jahr: j[i].jahr, vorJahr: j[i - 1].jahr, deltaPp: d, idx: i };
  }
  if (!best) return null;
  const danach = j.slice(best.idx + 1);
  const letzte = j[j.length - 1];
  const rueck = danach.length && letzte.fossilPct - j[best.idx].fossilPct >= 3 ? letzte : null;
  return { ...best, jahrDaten: j[best.idx], rueckJahr: rueck };
}
