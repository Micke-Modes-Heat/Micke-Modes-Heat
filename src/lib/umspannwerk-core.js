// ── lib/umspannwerk-core.js — Direktanschluss an ein Umspannwerk: Größenordnung ──
// DOM- und importfrei (Vitest). Oberfläche, Overpass-Abruf und Karte: 43-umspannwerke.js.
//
// Frage: Welche Bezugs- und Einspeiseleistung wäre über einen eigenen Anschluss an die
// MS-Sammelschiene eines nahen Umspannwerks (UW) möglich, und was kostet er ungefähr?
//
// Was sich seriös abschätzen lässt — und was nicht:
//   • Das eigene Kabel ist Physik: thermische Grenze (Iz je System) und Spannungsfall bzw.
//     -anhebung über die Trassenlänge. Daraus folgt die Leistung je Kabelsystem.
//   • Das Umspannwerk selbst ist Annahme: OSM kennt Lage und Spannungsebenen, manchmal die
//     Trafoleistung, nie die Bestandslast. Die (n-1)-Trafoleistung ist deshalb eine
//     OBERGRENZE für alle Kunden des UW, nicht die für uns freie Leistung.
//   • Welche Ebene der Netzbetreiber vorgibt (Strang, UW-Sammelschiene, Hochspannung), ist
//     VNB-abhängig — die Stufen unten sind Orientierungswerte.

const RAD = Math.PI / 180;

/* ── Parameter (Richtwerte, netto, Preisstand 2025/26 — im Projekt editierbar) ── */
export const UW_PARAMETER = {
  radiusKm:          { wert: 15,     einheit: 'km',   label: 'Suchradius um den NAP' },
  umwegFaktor:       { wert: 1.3,    einheit: '×',    label: 'Umwegfaktor Trasse (Luftlinie → Kabelweg)' },
  kabelMm2:          { wert: 240,    einheit: 'mm²',  label: 'Leiterquerschnitt NA2XS2Y 3 × 1 × … (Al)' },
  reduktion:         { wert: 0.85,   einheit: '×',    label: 'Reduktionsfaktor Verlegung/Häufung auf Iz' },
  cosPhi:            { wert: 0.95,   einheit: '',     label: 'cos φ (Bezug induktiv, Einspeisung untererregt)' },
  duBezugPct:        { wert: 5,      einheit: '%',    label: 'zulässiger Spannungsfall im eigenen Kabel (Bezug)' },
  duEinspPct:        { wert: 3,      einheit: '%',    label: 'zulässige Spannungsanhebung im eigenen Kabel (Einspeisung)' },
  trafoMvaTypisch:   { wert: 40,     einheit: 'MVA',  label: 'Trafo HS/MS, wenn OSM keine Leistung kennt (je Trafo)' },
  trafoAnzahlTypisch:{ wert: 2,      einheit: 'Stk',  label: 'Anzahl Trafos, wenn OSM keine kennt' },
  grenzeStrangMva:   { wert: 2,      einheit: 'MVA',  label: 'Orientierung: bis hier meist Anschluss am MS-Strang' },
  grenzeUwMva:       { wert: 20,     einheit: 'MVA',  label: 'Orientierung: bis hier Direktanschluss MS-Sammelschiene, darüber HS' },
  kabelEurM:         { wert: 120,    einheit: '€/m',  label: 'MS-Kabelsystem 3 × 1 × 240 (Material + Einzug, Muffen)' },
  tiefbauEurM:       { wert: 180,    einheit: '€/m',  label: 'Tiefbau MS-Trasse (Mischwert inner-/außerorts)' },
  tiefbauJeWeiteresEurM: { wert: 25, einheit: '€/m',  label: 'Tiefbau-Mehrkosten je weiterem System im selben Graben' },
  uwFeldEur:         { wert: 150000, einheit: '€',    label: 'MS-Abgangsfeld im Umspannwerk je System (inkl. Schutz)' },
  uebergabeEur:      { wert: 180000, einheit: '€',    label: 'Übergabestation beim Kunden (MS-Schaltanlage, Messung)' },
  uebergabeFeldEur:  { wert: 40000,  einheit: '€',    label: 'je weiteres Einspeisefeld in der Übergabestation' },
  nebenkostenPct:    { wert: 15,     einheit: '%',    label: 'Planung, Wegerechte, Kreuzungen, Prüfung' },
  bkzEurKw:          { wert: 0,      einheit: '€/kW', label: 'Baukostenzuschuss Bezug (Preisblatt VNB; 0 = nicht angesetzt)' },
};

/** Katalog als { schluessel: zahl } — Standard, überschrieben durch gültige Projektwerte. */
export function uwParameterMischen(gespeichert) {
  const out = {};
  for (const [k, v] of Object.entries(UW_PARAMETER)) {
    const g = gespeichert?.[k];
    out[k] = g !== '' && g !== null && Number.isFinite(+g) && +g >= 0 ? +g : v.wert;
  }
  return out;
}

/* ── NA2XS2Y, Aluminium: Iz in Erde (VDE 0276-620, Dreieck, EVU-Last), X' je km ── */
export const UW_KABEL = {
  150: { iz: 340, xOhmKm: 0.112 },
  185: { iz: 385, xOhmKm: 0.110 },
  240: { iz: 445, xOhmKm: 0.107 },
  300: { iz: 500, xOhmKm: 0.104 },
  400: { iz: 565, xOhmKm: 0.101 },
};
const RHO_AL = 0.0286, ALPHA_AL = 0.00403;

/** Wirk- und Blindbelag (Ω/km) bei 70 °C Leitertemperatur — Mittel zwischen Teil- und Volllast. */
export function uwKabelBelag(mm2) {
  const k = UW_KABEL[mm2] || UW_KABEL[240];
  const q = UW_KABEL[mm2] ? mm2 : 240;
  return { r: RHO_AL / q * 1000 * (1 + ALPHA_AL * 50), x: k.xOhmKm, iz: k.iz, mm2: q };
}

/* ── OSM ──────────────────────────────────────────────────────────────────── */

/**
 * "110000;20000;10000" → [110, 20, 10] (kV, absteigend, ohne Dubletten). OSM schreibt Volt;
 * nur wenn KEIN Wert ≥ 1000 ist, war die Angabe vermutlich in kV ("110;20").
 */
export function uwSpannungen(tag) {
  const roh = String(tag ?? '').split(/[;,/]/).map(t => parseFloat(t.trim())).filter(v => v > 0);
  const inVolt = roh.some(v => v >= 1000);
  const set = new Set(roh.map(v => Math.round((inVolt ? v / 1000 : v) * 10) / 10));
  return [...set].sort((a, b) => b - a);
}

/** Leistungsangabe eines Trafos ("40 MVA", "40000 kVA", "40") → MVA, sonst null. */
export function uwTrafoMva(tag) {
  const s = String(tag ?? '').trim().toLowerCase().replace(',', '.');
  const v = parseFloat(s);
  if (!(v > 0)) return null;
  if (/kva/.test(s)) return v / 1000;
  if (/mva/.test(s)) return v;
  if (/\bva\b/.test(s)) return v / 1e6;
  return v > 1000 ? v / 1000 : v;   // ohne Einheit: große Zahlen sind kVA
}

/** MS-Ebene: größte Spannung zwischen 6 und 36 kV. */
export const uwMsKv = kvs => kvs.find(v => v >= 6 && v <= 36) ?? null;

/**
 * Einordnung eines power=substation:
 *   hsms        HS/MS-Umspannwerk (≥ 60 kV mit MS-Ebene, oder 110 kV ohne weitere Angabe)
 *   hoes        Übertragungsnetz (≥ 220 kV ohne MS-Ebene)
 *   msuw        Umspannwerk nur auf MS-Ebene (z. B. 30/10 kV), groß oder als UW benannt
 *   ms          MS-Schalt- oder Ortsnetzstation — Strang, kein UW
 *   bahn        Bahnstrom; sonstig: Kabelübergang, Erzeugung, Umrichter
 *   unbekannt   keine Spannung in OSM, aber groß (≥ UW_MIN_FLAECHE_M2) oder als Umspannwerk
 *               benannt — als Kandidat zeigen, mit Vorbehalt
 * Ohne Spannung, klein und ohne passenden Namen ist es fast immer eine Ortsnetzstation
 * (Stuttgart, 15 km: 267 von 360 solcher Anlagen < 100 m², nur eine ≥ 1.500 m²) → 'ms'.
 */
export const UW_MIN_FLAECHE_M2 = 1000;
const UW_NAME = /umspannwerk|umspannanlage|unterwerk|\bUW\b/i;

export function uwKategorie(tags = {}, flaecheM2 = null) {
  const art = String(tags.substation || '').toLowerCase();
  if (art === 'traction' || tags.railway || /bahn/i.test(tags.operator || '') && art !== 'distribution') return 'bahn';
  if (['transition', 'converter', 'generation', 'compensation'].includes(art)) return 'sonstig';
  const name = `${tags.name || ''} ${tags.ref || ''}`;
  const gross = UW_NAME.test(name) || flaecheM2 >= UW_MIN_FLAECHE_M2;
  const kvs = uwSpannungen(tags.voltage);
  if (!kvs.length) {
    if (art === 'minor_distribution') return 'ms';
    return gross ? 'unbekannt' : 'ms';
  }
  const hoch = kvs[0];
  // 110-kV-Anlagen im Verteilnetz sind praktisch immer HS/MS — oft ist nur „110000" getaggt,
  // auch mit substation=transmission. Erst ab 220 kV ohne MS-Ebene ist es Übertragungsnetz.
  if (hoch >= 60 && (uwMsKv(kvs) || hoch <= 150)) return 'hsms';
  if (hoch >= 60) return 'hoes';
  // nur MS: Schwerpunkt-UW (z. B. 30/10 kV) oder MS-Station
  return gross && art !== 'minor_distribution' ? 'msuw' : 'ms';
}

export const UW_KATEGORIEN = {
  hsms:      { label: 'Umspannwerk HS/MS', farbe: '#ff7043', kandidat: true },
  unbekannt: { label: 'Umspannwerk (Spannung unbekannt)', farbe: '#ffb74d', kandidat: true },
  msuw:      { label: 'Umspannwerk MS/MS (ohne HS)', farbe: '#fff176', kandidat: true },
  hoes:      { label: 'Übertragungsnetz (≥ 220 kV, ohne MS)', farbe: '#9575cd', kandidat: false },
  ms:        { label: 'MS-Station (kein UW)', farbe: '#90a4ae', kandidat: false },
  bahn:      { label: 'Bahnstrom', farbe: '#78909c', kandidat: false },
  sonstig:   { label: 'sonstige Anlage (Kabelübergang, Erzeugung, Umrichter)', farbe: '#78909c', kandidat: false },
  manuell:   { label: 'von Hand gesetzt', farbe: '#4fc3f7', kandidat: true },
};

/** Großkreis-Distanz in m. */
export function uwDistanzM(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

// „out bb" und „out center" schließen sich in Overpass aus (bb gewinnt) — Mittelpunkt dann aus der Box
const _pos = el => el.center ? { lat: el.center.lat, lng: el.center.lon }
  : el.bounds ? { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lng: (el.bounds.minlon + el.bounds.maxlon) / 2 }
  : Number.isFinite(el.lat) ? { lat: el.lat, lng: el.lon } : null;

/** Fläche der Bounding-Box („out bb") in m², null für Knoten. */
function _bbFlaeche(el) {
  const b = el.bounds;
  if (!b) return null;
  const h = (b.maxlat - b.minlat) * 111320;
  const w = (b.maxlon - b.minlon) * 111320 * Math.cos((b.minlat + b.maxlat) / 2 * RAD);
  return Math.round(h * w);
}

/**
 * Overpass-Elemente (power=substation mit „out bb tags", power=transformer mit „out center tags") →
 * Umspannwerke mit Spannungsebenen, Kategorie und — soweit getaggt — Trafos.
 * Trafos gehören zum nächsten Umspannwerk im Umkreis von 400 m.
 */
export function uwAusOverpass(elements, { ref = null } = {}) {
  const uws = [], trafos = [];
  for (const el of elements || []) {
    const t = el.tags || {};
    const p = _pos(el);
    if (!p) continue;
    if (t.power === 'transformer') { trafos.push({ ...p, mva: uwTrafoMva(t.rating), kvs: uwSpannungen(t.voltage) }); continue; }
    if (t.power !== 'substation') continue;
    const kvs = uwSpannungen(t.voltage);
    const flaecheM2 = _bbFlaeche(el);
    uws.push({
      id: `osm-${el.type}-${el.id}`,
      osm: `${el.type}/${el.id}`,
      name: String(t.name || t['name:de'] || t.ref || '').trim(),
      betreiber: String(t.operator || '').trim(),
      lat: p.lat, lng: p.lng,
      kvs, msKv: uwMsKv(kvs),
      art: String(t.substation || ''),
      flaecheM2,
      kategorie: uwKategorie(t, flaecheM2),
      trafos: [],
    });
  }
  for (const tr of trafos) {
    let best = null, dBest = 400;
    for (const u of uws) {
      const d = uwDistanzM(u, tr);
      if (d < dBest) { dBest = d; best = u; }
    }
    // nur HS/MS-Trafos zählen (Eigenbedarfs- und Ortsnetztrafos im UW-Gelände nicht)
    if (best && (!tr.kvs.length || tr.kvs[0] >= 60)) best.trafos.push({ mva: tr.mva });
  }
  if (ref) for (const u of uws) u.luftlinieM = uwDistanzM(ref, u);
  return uws.sort((a, b) => (a.luftlinieM ?? 0) - (b.luftlinieM ?? 0));
}

/* ── Leistung über das eigene Kabel ─────────────────────────────────────── */

/**
 * Wirkleistung (MW) je Kabelsystem über eine Trasse:
 *   thermisch:  P = √3 · U · Iz · Reduktion · cos φ
 *   Bezug:      Δu = P·(R + X·tan φ)·L / U²   (induktiv: Blindleistung verstärkt den Fall)
 *   Einspeisung Δu = P·(R − X·tan φ)·L / U²   (untererregt: Blindleistungsbezug dämpft die Anhebung)
 * → { thermMw, bezugMw, einspMw, grenzeBezug, grenzeEinsp } (Grenze: 'thermisch' | 'spannung')
 */
export function uwLeistungJeSystem({ laengeKm, uKv, p }) {
  const { r, x, iz } = uwKabelBelag(p.kabelMm2);
  const U = uKv * 1000;
  const tan = Math.tan(Math.acos(Math.min(1, Math.max(0.5, p.cosPhi))));
  const thermMw = Math.sqrt(3) * U * iz * p.reduktion * p.cosPhi / 1e6;
  const L = Math.max(laengeKm, 0.01);
  const spannung = (duPct, faktor) => faktor > 0 ? duPct / 100 * U * U / (faktor * L) / 1e6 : Infinity;
  const uBezug = spannung(p.duBezugPct, r + x * tan);
  const uEinsp = spannung(p.duEinspPct, r - x * tan);
  return {
    thermMw,
    bezugMw: Math.min(thermMw, uBezug),
    einspMw: Math.min(thermMw, uEinsp),
    grenzeBezug: uBezug < thermMw ? 'spannung' : 'thermisch',
    grenzeEinsp: uEinsp < thermMw ? 'spannung' : 'thermisch',
  };
}

/**
 * (n-1)-Trafoleistung des UW in MVA: Summe ohne den größten Trafo.
 *   aus = 'osm'         Anzahl und Leistung aus OSM
 *         'osm-anzahl'  Anzahl aus OSM, Leistung typisch (häufig: Trafo gemappt, rating fehlt)
 *         'typisch'     beides typisch
 */
export function uwTrafoN1(uw, p) {
  const trafos = uw.trafos || [];
  const bekannt = trafos.map(t => t.mva).filter(v => v > 0);
  const n = trafos.length || Math.max(1, Math.round(p.trafoAnzahlTypisch));
  const aus = !trafos.length ? 'typisch' : bekannt.length === trafos.length ? 'osm' : 'osm-anzahl';
  const leistungen = Array.from({ length: n }, (_, i) => trafos[i]?.mva > 0 ? trafos[i].mva : p.trafoMvaTypisch);
  const summe = leistungen.reduce((s, v) => s + v, 0);
  return { mva: n > 1 ? summe - Math.max(...leistungen) : 0, summeMva: summe, anzahl: n, aus };
}

export const UW_TRAFO_QUELLE = { osm: 'Leistung aus OSM', 'osm-anzahl': 'Anzahl aus OSM, Leistung typisch', typisch: 'typischer Wert, nicht aus OSM' };

/** Kosten eines Direktanschlusses mit `systeme` Kabelsystemen (netto, €). */
export function uwKosten({ laengeKm, systeme, p, bezugKw = 0 }) {
  const m = laengeKm * 1000;
  const n = Math.max(1, systeme);
  const posten = [
    { titel: `Kabel ${n} × NA2XS2Y 3 × 1 × ${uwKabelBelag(p.kabelMm2).mm2}`, eur: m * n * p.kabelEurM },
    { titel: 'Tiefbau Trasse', eur: m * (p.tiefbauEurM + (n - 1) * p.tiefbauJeWeiteresEurM) },
    { titel: `MS-Abgangsfeld${n > 1 ? 'er' : ''} im Umspannwerk`, eur: n * p.uwFeldEur },
    { titel: 'Übergabestation', eur: p.uebergabeEur + (n - 1) * p.uebergabeFeldEur },
  ];
  const netto = posten.reduce((s, x) => s + x.eur, 0);
  posten.push({ titel: 'Planung, Wegerechte, Kreuzungen', eur: netto * p.nebenkostenPct / 100 });
  const anschluss = posten.reduce((s, x) => s + x.eur, 0);
  const bkz = bezugKw > 0 && p.bkzEurKw > 0 ? bezugKw * p.bkzEurKw : 0;
  return { posten, anschlussEur: anschluss, bkzEur: bkz, summeEur: anschluss + bkz };
}

/** Anschlussebene, die der Netzbetreiber für eine Leistung (MVA) üblicherweise vorsieht. */
export function uwEbene(mva, p) {
  if (!(mva > 0)) return null;
  if (mva <= p.grenzeStrangMva) return { id: 'strang', label: 'Anschluss am bestehenden MS-Strang (Einschleifen) meist möglich' };
  if (mva <= p.grenzeUwMva) return { id: 'uw', label: 'Direktanschluss an die MS-Sammelschiene eines Umspannwerks' };
  return { id: 'hs', label: 'eigener Trafo im UW bzw. Anschluss an die Hochspannung' };
}

/**
 * Bewertung eines UW als Direktanschluss.
 *   uw: aus uwAusOverpass (oder manuell, mit lat/lng/msKv)
 *   ref: Bezugspunkt (NAP), uKvNap: Spannung des NAP (Ersatz, wenn das UW keine MS-Ebene kennt)
 *   ziel: { bezugMw, einspMw } — optional; dann Anzahl Systeme dafür
 *   redundant: n-1 zwischen den Kabelsystemen — ein System ist Reserve, gesichert tragen nur n − 1.
 *              Die Stufen beginnen dann bei 2 Systemen; „bezugMw/einspMw" ist die gesicherte Leistung.
 */
export function uwBewerten(uw, { ref, uKvNap = 20, p, ziel = {}, redundant = false }) {
  const luftlinieM = uwDistanzM(ref, uw);
  const laengeKm = luftlinieM * p.umwegFaktor / 1000;
  const uKv = uw.msKv || uKvNap || 20;
  const jeSystem = uwLeistungJeSystem({ laengeKm, uKv, p });
  const n1 = uwTrafoN1(uw, p);
  const n1Mw = n1.mva * p.cosPhi;
  const reserve = redundant ? 1 : 0;
  const tragend = n => n - reserve;
  const systemeFuer = mw => mw > 0 ? Math.ceil(mw / Math.max(jeSystem.bezugMw, 1e-6) - 1e-9) : 0;
  const systemeFuerE = mw => mw > 0 ? Math.ceil(mw / Math.max(jeSystem.einspMw, 1e-6) - 1e-9) : 0;
  const zielSysteme = Math.max(1, systemeFuer(ziel.bezugMw), systemeFuerE(ziel.einspMw)) + reserve;
  const stufen = [1, 2, 3].map(i => i + reserve).map(n => ({
    systeme: n,
    bezugMw: tragend(n) * jeSystem.bezugMw,
    einspMw: tragend(n) * jeSystem.einspMw,
    ueberN1: n1Mw > 0 && Math.max(tragend(n) * jeSystem.bezugMw, tragend(n) * jeSystem.einspMw) > n1Mw,
    kosten: uwKosten({ laengeKm, systeme: n, p, bezugKw: tragend(n) * jeSystem.bezugMw * 1000 }),
  }));
  const zielKosten = uwKosten({ laengeKm, systeme: zielSysteme, p, bezugKw: (ziel.bezugMw || 0) * 1000 });
  return {
    luftlinieM, laengeKm, uKv, uAusUw: !!uw.msKv, redundant,
    jeSystem, n1, n1Mw, stufen,
    ziel: (ziel.bezugMw > 0 || ziel.einspMw > 0) ? { systeme: zielSysteme, kosten: zielKosten } : null,
  };
}

/* ── Text ───────────────────────────────────────────────────────────────── */

const _de = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
/** MW auf eine sinnvolle Stelle gerundet. */
export const uwMw = v => !Number.isFinite(v) ? '—' : v >= 10 ? _de(Math.round(v), 0) : _de(v, 1);
/** € als „1,8 Mio. €" bzw. „420 T€". */
export function uwEur(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${_de(v / 1e6, 1)} Mio. €`;
  return `${_de(Math.round(v / 1e4) * 10, 0)} T€`;
}
/** Kostenspanne einer Grobschätzung: −20 % / +40 %. */
export const UW_KOSTEN_SPANNE = [0.8, 1.4];
export const uwEurSpanne = v => `${uwEur(v * UW_KOSTEN_SPANNE[0])} – ${uwEur(v * UW_KOSTEN_SPANNE[1])}`;

/** Ein Satz Größenordnung für Panel und Notizen. */
export function uwSatz(uw, b) {
  const name = uw.name || 'das nächstgelegene Umspannwerk';
  const j = b.jeSystem, s1 = b.stufen[0];
  const n1 = b.n1.mva > 0
    ? `Begrenzend ist eher das Umspannwerk: (n-1) rund ${uwMw(b.n1.mva)} MVA${b.n1.aus !== 'osm' ? ` (${UW_TRAFO_QUELLE[b.n1.aus]})` : ''} für alle Kunden, die Bestandslast ist unbekannt.`
    : 'Die (n-1)-Leistung des Umspannwerks ist nicht bekannt.';
  const zwei = b.redundant
    ? `zwei Systeme mit gegenseitiger Reserve (n-1) sichern dieselbe Leistung ab`
    : `mit zwei Systemen etwa ${uwMw(2 * j.bezugMw)} bzw. ${uwMw(2 * j.einspMw)} MW`;
  return `Ein Direktanschluss an ${name} (Luftlinie ${_de(b.luftlinieM / 1000, 1)} km, Trasse ca. ${_de(b.laengeKm, 1)} km, ${_de(b.uKv, 0)} kV) `
    + `trägt je Kabelsystem etwa ${uwMw(j.bezugMw)} MW Bezug bzw. ${uwMw(j.einspMw)} MW Einspeisung; ${zwei}. `
    + `${n1} Anschlusskosten mit ${s1.systeme === 1 ? 'einem System' : `${s1.systeme} Systemen`} grob ${uwEurSpanne(s1.kosten.anschlussEur)}.`;
}
