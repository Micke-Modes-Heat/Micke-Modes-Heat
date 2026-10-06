// ── lib/stations-steckbrief.js — Stations-Steckbrief: eine Station als Ganzes ──
//
// Eine Station ist alles an Elektrotechnik in EINEM Gebäude: NAP, MS-Schaltanlage(n), Trafo(s),
// NSHV — wie im Übersichtsschaltbild (lib/netz-uebersicht.js). Die Komponenten bleiben einzelne
// Assets; der Steckbrief liest sie nur zusammen und gliedert sie wie die Vorlage
// „Liegenschaft_Steckbrief Trafostation" (1. MS-Station · 2. MS-Schaltanlage · 3. Transformatoren
// · 4. NSHV · weitere Betrachtung).
//
// Woher die Angaben kommen:
//   - Komponentenangaben (Leistung, Felder, Baujahr, Kühlung, Isolation …) stehen am Asset
//     (asset.props bzw. asset.baujahr) — der Steckbrief schreibt dorthin zurück.
//   - Angaben, die nur die Station als Ganzes hat (Stationsart, Bauweise, Bauart, Umbau,
//     Mängel, Begehungsdatum), stehen am Gebäude unter g.stationSteckbrief.
//   - Abgeleitet und nur überschreibbar: Stationsart (NAP → Übergabestation), Anbindung und
//     Einspeisung (Ring/Stich aus den MS-Kabeln), Felder der Schaltanlage (aus den Kabeln),
//     belegte NSHV-Abgänge (aus den NS-Kabeln), Nutzungsdauer der Trafos (aus dem Baujahr).
//
// Rein und DOM-frei — die Oberfläche liegt in 34-stations-steckbrief.js.

import { nuNetzUebersicht, nuIstGeplant, nuIstAbgerissen } from './netz-uebersicht.js';

export const SS_STATIONS_TYPEN = new Set(['NAP', 'Schaltanlage', 'Trafo', 'NSHV']);
const MS_TYPEN = new Set(['NAP', 'Schaltanlage', 'Trafo']);

/** Auswahllisten — `wert` wird gespeichert, `label` steht im Blatt (wie in der Word-Vorlage). */
export const SS_OPTIONEN = {
  stationsart: [{ wert: 'uebergabe', label: 'Übergabestation' }, { wert: 'verteil', label: 'Verteilstation' }],
  bauweise:    [{ wert: 'begehbar', label: 'begehbar' }, { wert: 'kompakt', label: 'Kompaktstation' }],
  lage:        [{ wert: 'eigenstaendig', label: 'eigenständig' }, { wert: 'integriert', label: 'gebäudeintegriert' }],
  einspeisung: [{ wert: 'ring', label: 'Ring' }, { wert: 'stich', label: 'Stich' }, { wert: 'sonstige', label: 'sonstige' }],
  bauart:      [{ wert: 'beton', label: 'Beton' }, { wert: 'mauerwerk', label: 'Mauerwerk' }, { wert: 'sonstige', label: 'sonstige' }],
  zaehlung:    [{ wert: 'ms', label: 'MS-seitig' }, { wert: 'ns', label: 'NS-seitig' }],
  saAusfuehrung: [{ wert: 'offen', label: 'offen' }, { wert: 'gekapselt', label: 'gekapselt' }, { wert: 'gasisoliert', label: 'gasisoliert' }],
  saIsolation: [{ wert: 'luft', label: 'Luft' }, { wert: 'sf6', label: 'SF6' }, { wert: 'vakuum', label: 'Vakuum' }],
  kuehlung:    [{ wert: 'oel', label: 'Öl' }, { wert: 'trocken', label: 'Trocken/Gießharz' }],
  ndStatus:    [{ wert: 'innerhalb', label: 'innerhalb' }, { wert: 'erreicht', label: 'erreicht' }, { wert: 'ueberschritten', label: 'überschritten' }],
  netzform:    [{ wert: 'TN-S', label: 'TN-S' }, { wert: 'TN-C', label: 'TN-C' }, { wert: 'TN-C-S', label: 'TN-C-S' },
                { wert: 'TT', label: 'TT' }, { wert: 'IT', label: 'IT' }],
};
/** MS-Ebenen der Vorlage (kV) */
export const SS_MS_EBENEN = [10, 15, 20, 30, 35];

/**
 * Rechnerische Nutzungsdauer des Trafos (Jahre) — Vorgabe des Steckbriefs, im Blatt änderbar.
 * Ansatz für Öl- und Gießharztransformatoren; gegen VDI 2067 Blatt 1 (Anhang) prüfen.
 */
export const SS_ND_TRAFO_VORGABE = 30;

const zahl = v => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const ganz = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const sortName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de', { numeric: true });

/**
 * Stand der rechnerischen Nutzungsdauer.
 * innerhalb: Alter < ND · erreicht: Alter = ND · überschritten: Alter > ND · null ohne Baujahr.
 */
export function ssNdStatus(baujahr, bezugsjahr, nd = SS_ND_TRAFO_VORGABE) {
  const bj = ganz(baujahr), j = ganz(bezugsjahr), n = zahl(nd);
  if (bj == null || j == null || !(n > 0)) return null;
  const alter = j - bj;
  return { alter, rest: n - alter, status: alter < n ? 'innerhalb' : alter === n ? 'erreicht' : 'ueberschritten' };
}

/** Stationsbezeichnung eines Gebäudes für Querverweise: „Trafostation Nord (Geb. 12)". */
export function ssStationsLabel(geb, fallback = 'Station') {
  if (!geb) return fallback;
  const name = String(geb.name || '').trim();
  const nr = String(geb.gebaeudenummer || '').trim();
  if (name && nr) return `${name} (Geb. ${nr})`;
  return name || (nr ? `Gebäude ${nr}` : fallback);
}

/** Gebäude mit mindestens einem Stationsbetriebsmittel (NAP, Schaltanlage, Trafo) */
export function ssIstStationsGebaeude(buildingId, assets) {
  if (buildingId == null) return false;
  return assets.some(a => String(a.buildingId) === String(buildingId) && MS_TYPEN.has(a.type));
}

/** Alle Stationsgebäude in Gebäudereihenfolge */
export function ssStationsGebaeude(assets = [], gebaeude = []) {
  const ids = new Set(assets.filter(a => MS_TYPEN.has(a.type) && a.buildingId != null).map(a => String(a.buildingId)));
  return gebaeude.filter(g => ids.has(String(g.id)));
}

/**
 * Felder einer MS-Schaltanlage aus den Kabeln, die an ihr enden:
 *   Kabel zum NAP der eigenen Station   → Übergabefeld (Einspeisung VNB)
 *   Kabel zu einer anderen Station      → Kabelfeld Richtung …
 *   Kabel zu einem Trafo                → Trafofeld …
 * Bis zur erfassten Feldanzahl wird mit Reservefeldern aufgefüllt. Namen aus props.feldNamen
 * (Index = Feldnummer − 1) überschreiben die abgeleitete Bezeichnung.
 */
export function ssSchaltfelder(sa, { assets = [], edges = [], gebaeude = [] } = {}) {
  const byId = new Map(assets.map(a => [String(a.id), a]));
  const gebMap = new Map(gebaeude.map(g => [String(g.id), g]));
  const eigen = String(sa.buildingId ?? '');
  const felder = [];
  for (const e of edges) {
    const u = String(e.u), v = String(e.v);
    if (u !== String(sa.id) && v !== String(sa.id)) continue;
    const gegen = byId.get(u === String(sa.id) ? v : u);
    if (!gegen) continue;
    const andereStation = String(gegen.buildingId ?? '') !== eigen || sa.buildingId == null;
    if (gegen.type === 'NAP' && !andereStation) {
      felder.push({ art: 'einspeisung', auto: 'Übergabefeld (Einspeisung VNB)', kabelId: e.id ?? null, rang: 0 });
    } else if (MS_TYPEN.has(gegen.type) && andereStation) {
      const g = gegen.buildingId != null ? gebMap.get(String(gegen.buildingId)) : null;
      const ziel = g ? ssStationsLabel(g) : (gegen.name || gegen.type);
      felder.push({ art: 'kabel', auto: `Kabelfeld → ${ziel}`, kabelId: e.id ?? null, trennstelle: !!e.trennstelle, rang: 1, ziel });
    } else if (gegen.type === 'Trafo') {
      felder.push({ art: 'trafo', auto: `Trafofeld ${gegen.name || 'Trafo'}`, kabelId: e.id ?? null, rang: 2, trafoId: gegen.id });
    }
  }
  felder.sort((a, b) => (a.rang - b.rang) || a.auto.localeCompare(b.auto, 'de', { numeric: true }));
  const anzahl = ganz(sa.props?.felder);
  const n = Math.max(anzahl ?? 0, felder.length);
  while (felder.length < n) felder.push({ art: 'reserve', auto: 'Reserve / frei', kabelId: null, rang: 3 });
  const namen = Array.isArray(sa.props?.feldNamen) ? sa.props.feldNamen : [];
  return {
    felder: felder.map((f, i) => ({ ...f, nr: i + 1, name: String(namen[i] ?? '').trim() || null })),
    anzahlErfasst: anzahl,
    belegt: felder.filter(f => f.art !== 'reserve').length,
    zuWenig: anzahl != null && felder.filter(f => f.art !== 'reserve').length > anzahl,
  };
}

/** Belegte NS-Abgänge einer NSHV = Kabel zu Betriebsmitteln „unterhalb" (kein Trafo, kein MS) */
export function ssNshvBelegt(nshv, { assets = [], edges = [] } = {}) {
  const byId = new Map(assets.map(a => [String(a.id), a]));
  let n = 0;
  for (const e of edges) {
    const u = String(e.u), v = String(e.v);
    if (u !== String(nshv.id) && v !== String(nshv.id)) continue;
    const gegenId = u === String(nshv.id) ? v : u;
    const gegen = byId.get(gegenId);
    if (gegen && (MS_TYPEN.has(gegen.type) || gegen.type === 'NSHV')) continue;
    n++;   // auch Kabel direkt zu einem Gebäudeknoten (ohne Asset)
  }
  return n;
}

/**
 * Einspeisung der Station aus dem Übersichtsschaltbild.
 * → { wert: 'ring'|'stich'|'sonstige'|null, text } — null, wenn das Modell nichts hergibt
 *   (z. B. Übergabestation: wie der VNB anbindet, steht nicht im Modell).
 */
function einspeisungAus(r, key) {
  for (const w of r.wurzeln || []) {
    if (w.key === key) return { wert: null, text: 'Übergabestation — Anbindung an das VNB-Netz nicht im Modell' };
    for (const ab of w.abgaenge || []) {
      const i = ab.folge.indexOf(key);
      if (i < 0) continue;
      if (ab.art === 'ring') {
        const ringLaenge = ab.folge.length - (ab.abzweige || 0);
        return i < ringLaenge
          ? { wert: 'ring', text: `Ring mit ${ringLaenge} Station${ringLaenge === 1 ? '' : 'en'}` }
          : { wert: 'stich', text: 'Stich an einer Ringstation' };
      }
      if (ab.art === 'strahl' || ab.art === 'kette' || ab.art === 'verzweigt') {
        return { wert: 'stich', text: ab.folge.length > 1 ? `Strahl mit ${ab.folge.length} Stationen` : 'Stich von der Übergabestation' };
      }
      return { wert: 'sonstige', text: ab.art === 'leiter' ? 'Leiter (mehrere Linien zwischen zwei Knotenstationen)' : 'vermaschter Abgang' };
    }
  }
  for (const l of r.linien || []) {
    if ((l.folge || []).includes(key)) {
      return l.art === 'linie'
        ? { wert: 'ring', text: 'Linie zwischen zwei Übergabestationen (offener Ring)' }
        : { wert: 'sonstige', text: 'vermaschte Verbindung zwischen zwei Übergabestationen' };
    }
  }
  if ((r.ohneNap || []).some(ab => ab.folge.includes(key))) return { wert: null, text: 'keine MS-Verbindung zur Übergabestation' };
  return { wert: null, text: '' };
}

/**
 * Steckbrief einer Station.
 * @param {object} p
 * @param {string|number} p.gebaeudeId
 * @param {object[]} p.assets, p.edges, p.gebaeude  wie im Projekt
 * @param {number}   [p.heute]    Bezugsjahr, wenn kein Begehungsdatum erfasst ist
 * @param {string}   [p.messort]  'ms' | 'ns' aus den Netzanschluss-Stammdaten (gilt für die Übergabestation)
 * @param {boolean}  [p.nurBestand=false] nur bestehende Komponenten (keine Planung, nichts Abgerissenes)
 */
export function ssStationModell({ gebaeudeId, assets = [], edges = [], gebaeude = [], heute, messort = '', nurBestand = false } = {}) {
  const geb = gebaeude.find(g => String(g.id) === String(gebaeudeId)) || null;
  const sb = geb?.stationSteckbrief || {};
  const jetzt = Number.isFinite(heute) ? heute : new Date().getFullYear();
  // nurBestand (Gutachten-Anlage = Begehungsstand): geplante und abgerissene Komponenten bleiben weg
  const imGeb = assets.filter(a => String(a.buildingId) === String(gebaeudeId)
    && (!nurBestand || (!nuIstGeplant(a, geb, jetzt) && !nuIstAbgerissen(a, geb, jetzt))));
  const naps = imGeb.filter(a => a.type === 'NAP').sort(sortName);
  const schaltanlagen = imGeb.filter(a => a.type === 'Schaltanlage').sort(sortName);
  const trafos = imGeb.filter(a => a.type === 'Trafo').sort(sortName);
  const nshvs = imGeb.filter(a => a.type === 'NSHV').sort(sortName);
  const weitere = imGeb.filter(a => !SS_STATIONS_TYPEN.has(a.type));

  const begehungJahr = ganz(String(sb.begehung || '').slice(0, 4));
  const bezugsjahr = begehungJahr ?? (Number.isFinite(heute) ? heute : new Date().getFullYear());

  // Netzlage aus dem Übersichtsschaltbild (Bestand)
  let r = null;
  try { r = nuNetzUebersicht({ assets, edges, gebaeude, heute: bezugsjahr }); } catch { r = null; }
  const key = 'g' + gebaeudeId;
  const gebVonKey = k => (String(k).startsWith('g') ? gebaeude.find(g => 'g' + g.id === k) || null : null);
  const stationName = k => {
    const g = gebVonKey(k);
    if (g) return ssStationsLabel(g);
    const a = assets.find(x => 'a' + x.id === k);
    return a?.name || 'Station';
  };
  const anbindung = [];
  if (naps.length) anbindung.push({ art: 'netz', label: 'Netz (VNB)' });
  for (const v of r?.verbindungen || []) {
    if (v.a !== key && v.b !== key) continue;
    const anderer = v.a === key ? v.b : v.a;
    const g = gebVonKey(anderer);
    anbindung.push({ art: 'station', key: anderer, gebId: g?.id ?? null, label: stationName(anderer),
                     gebNummer: String(g?.gebaeudenummer || '').trim(), systeme: v.anzahl, trennstelle: !!v.trennstelle });
  }
  const einspAuto = r ? einspeisungAus(r, key) : { wert: null, text: '' };

  // MS-Ebene: NAP der Station > NAP im Netz > Eingabe am Steckbrief
  const napKV = zahl(naps[0]?.props?.spannungKV);
  const netzKV = r?.kennzahlen?.napKV ?? null;
  const ms = napKV != null ? { kv: napKV, quelle: 'nap' }
    : zahl(sb.msKV) != null ? { kv: zahl(sb.msKV), quelle: 'eingabe' }
    : netzKV != null ? { kv: netzKV, quelle: 'netz' } : { kv: null, quelle: null };

  const auswahl = (feld, auto) => {
    const v = sb[feld];
    return v ? { wert: v, auto: false } : { wert: auto ?? null, auto: auto != null };
  };
  const ndJahre = zahl(sb.ndTrafo) > 0 ? zahl(sb.ndTrafo) : SS_ND_TRAFO_VORGABE;

  const modell = {
    geb: geb ? { id: geb.id, name: geb.name || '', nummer: String(geb.gebaeudenummer || '').trim(), baujahr: ganz(geb.baujahr) } : null,
    gebFotos: geb?.feldFotos || [],
    steckbrief: sb,
    bezugsjahr,
    bezugAusBegehung: begehungJahr != null,
    station: {
      stationsart: auswahl('stationsart', naps.length ? 'uebergabe' : (schaltanlagen.length || trafos.length) ? 'verteil' : null),
      bauweise: auswahl('bauweise', null),
      lage: auswahl('lage', null),
      bauart: auswahl('bauart', null),
      einspeisung: { ...auswahl('einspeisung', einspAuto.wert), text: einspAuto.text },
      umbauJahr: ganz(sb.umbauJahr),
      msKV: ms.kv, msKVQuelle: ms.quelle,
      // Abrechnungsmessung des VNB gibt es nur an der Übergabestation
      zaehlung: naps.length ? (messort === 'ms' || messort === 'ns' ? messort : null) : null,
      zaehlungMoeglich: naps.length > 0,
      anbindung,
    },
    naps,
    schaltanlagen: schaltanlagen.map(sa => ({ asset: sa, ...ssSchaltfelder(sa, { assets, edges, gebaeude }) })),
    trafos: trafos.map(t => ({ asset: t, kva: zahl(t.props?.leistungKVA), nd: ssNdStatus(t.baujahr, bezugsjahr, ndJahre) })),
    ndTrafo: ndJahre,
    nshvs: nshvs.map(n => {
      const belegt = ssNshvBelegt(n, { assets, edges });
      const abg = ganz(n.props?.abgaenge);
      const freiEingabe = ganz(n.props?.freieAbgaenge);
      return { asset: n, abgaenge: abg, belegt,
               frei: freiEingabe ?? (abg != null ? Math.max(0, abg - belegt) : null), freiAuto: freiEingabe == null,
               zuWenig: abg != null && belegt > abg };
    }),
    weitere,
    maengel: Array.isArray(sb.maengel) ? sb.maengel : [],
    hinweise: [],
  };

  // Lücken, die beim Ausfüllen auffallen sollen
  const h = modell.hinweise;
  if (!schaltanlagen.length && (naps.length || trafos.length > 1)) h.push('Keine MS-Schaltanlage erfasst.');
  modell.schaltanlagen.forEach(s => {
    if (s.zuWenig) h.push(`${s.asset.name || 'Schaltanlage'}: ${s.belegt} belegte Felder aus den Kabeln, aber nur ${s.anzahlErfasst} Felder erfasst.`);
  });
  modell.trafos.forEach(t => {
    if (!(t.kva > 0)) h.push(`${t.asset.name || 'Trafo'}: Nennleistung fehlt.`);
    if (t.asset.baujahr == null) h.push(`${t.asset.name || 'Trafo'}: Baujahr fehlt — Nutzungsdauer nicht bewertbar.`);
  });
  modell.nshvs.forEach(n => {
    if (n.zuWenig) h.push(`${n.asset.name || 'NSHV'}: ${n.belegt} Kabelabgänge im Netz, aber nur ${n.abgaenge} Abgänge erfasst.`);
  });
  return modell;
}

/** Steckbrief-Angaben am Gebäude setzen (leer → Eintrag entfernen, damit die Ableitung wieder greift). */
export function ssSetzeStationsfeld(geb, feld, wert) {
  if (!geb) return;
  const sb = geb.stationSteckbrief || (geb.stationSteckbrief = {});
  if (wert === '' || wert == null) delete sb[feld];
  else sb[feld] = wert;
  if (!Object.keys(sb).length) delete geb.stationSteckbrief;
}

/**
 * Bestehende Stationen für die Gutachten-Anlagen: Gebäude mit mindestens einem Trafo oder NAP im
 * Bestand (keine Planungsschicht, kein Baujahr in der Zukunft, nicht abgerissen) — in Gebäudereihenfolge.
 */
export function ssBestandsStationen(assets = [], gebaeude = [], heute = new Date().getFullYear()) {
  const gebMap = new Map(gebaeude.map(g => [String(g.id), g]));
  const ids = new Set();
  for (const a of assets) {
    if ((a.type !== 'Trafo' && a.type !== 'NAP') || a.buildingId == null) continue;
    const g = gebMap.get(String(a.buildingId));
    if (!g || nuIstGeplant(a, g, heute) || nuIstAbgerissen(a, g, heute)) continue;
    ids.add(String(g.id));
  }
  return gebaeude.filter(g => ids.has(String(g.id)));
}

// ── Blatt im Layout der Vorlage (gemeinsam für Druck, Gutachten-Vorschau und Word) ──
//
// Raster mit fünf Spalten wie die Vorlage: Bezeichnung | vier Angabespalten.
// Zeile: { art: 'titel', text, rechts? } | { art: 'fotos', text, fotos: [{name, dataUrl}] }
//      | { art: 'zeile', zellen: [{ t: string | string[], lbl?: true, span?: n, mut?: string }] }
// t als Array = eine Zeile je Eintrag (Ankreuzfelder, Feldliste); mut = grauer Zusatz.

export const SS_BLATT_SPALTEN = 5;
const KB_AN = '☒', KB_AUS = '☐';
const optLabel = (liste, wert) => SS_OPTIONEN[liste].find(o => o.wert === wert)?.label ?? '';
const kreuze = (liste, wert) => SS_OPTIONEN[liste].map(o => `${o.wert === wert ? KB_AN : KB_AUS} ${o.label}`);
const txt = v => (v == null ? '' : String(v));

/**
 * @param {object} m      Ergebnis von ssStationModell
 * @param {object} stamm  { liegenschaft, adresse, weNummer }
 * @returns {{ kopf: {liegenschaft, station, gebNummer, stationsart, begehung}, zeilen: object[] }}
 */
export function ssSteckbriefBlatt(m, stamm = {}) {
  const st = m.station, sb = m.steckbrief || {};
  const Z = (...zellen) => ({ art: 'zeile', zellen });
  const L = (t, extra = {}) => ({ t, lbl: true, ...extra });
  const W = (t, extra = {}) => ({ t, ...extra });
  const T = (text, rechts) => ({ art: 'titel', text, ...(rechts ? { rechts } : {}) });
  const F = (text, fotos) => ({ art: 'fotos', text, fotos: (fotos || []).filter(f => f?.dataUrl) });
  const zeilen = [];
  const lieg = txt(stamm.liegenschaft).trim();

  zeilen.push(Z(L('Liegenschaft'), W([lieg, txt(stamm.adresse).trim()].filter(Boolean), { span: 2 }), W(txt(stamm.weNummer).trim(), { span: 2 })));
  zeilen.push(Z(L(`Gebäude Nr. ${m.geb?.nummer || ''}`.trim()), W(optLabel('stationsart', st.stationsart.wert), { span: 4 })));

  zeilen.push(T('1. MS-Station (inkl. Gebäude)'));
  zeilen.push(F('Übersicht Trafostation, Gebäude, Stationstüren', m.gebFotos));
  zeilen.push(Z(L('Baujahr'), W(txt(m.geb?.baujahr)), L('Umbau/Sanierung'), W(txt(st.umbauJahr), { span: 2 })));
  zeilen.push(Z(L('MS-Ebene'), W(st.msKV ? `${String(st.msKV).replace('.', ',')} kV` : ''), L('Zählung VNB'),
    W(st.zaehlungMoeglich ? kreuze('zaehlung', st.zaehlung) : '— (keine Übergabestation)', { span: 2 })));
  zeilen.push(Z(L('Stationsart'), W(kreuze('stationsart', st.stationsart.wert)), W(kreuze('bauweise', st.bauweise.wert)),
    W(kreuze('lage', st.lage.wert), { span: 2 })));
  zeilen.push(Z(L('Anbindung an'), W(st.anbindung.length
    ? st.anbindung.map(x => `${KB_AN} ${x.art === 'netz' ? 'Netz' : 'Stat. ' + x.label}${x.trennstelle ? ' (offene Trennstelle)' : ''}`)
    : [`${KB_AUS} Netz`], { span: 4 })));
  zeilen.push(Z(L('Einspeisung'), W(kreuze('einspeisung', st.einspeisung.wert).join('   '), { span: 4, mut: st.einspeisung.text })));
  zeilen.push(Z(L('Bauart (wenn begehbar)'), W(kreuze('bauart', st.bauart.wert).join('   ') + (sb.bauartText ? ` – ${sb.bauartText}` : ''), { span: 4 })));

  zeilen.push(T('2. MS-Schaltanlage'));
  zeilen.push(F('Schaltanlage, Übersichtsplan', m.schaltanlagen.flatMap(s => s.asset.feldFotos || [])));
  if (!m.schaltanlagen.length) zeilen.push(Z(W('', { span: 5, mut: 'keine MS-Schaltanlage erfasst' })));
  for (const s of m.schaltanlagen) {
    const p = s.asset.props || {};
    const name = m.schaltanlagen.length > 1 ? s.asset.name : '';
    zeilen.push(Z(L('Ausführung', { mut: name }), W(kreuze('saAusfuehrung', p.ausfuehrung)), L('Isolationsmedium Schaltanlage'),
      W(kreuze('saIsolation', p.isolation), { span: 2 })));
    zeilen.push(Z(L('Weitere Angaben'), W([`Baujahr: ${txt(s.asset.baujahr)}`, `Anz. Schaltfelder: ${txt(p.felder ?? s.felder.length)}`]),
      W(s.felder.map(f => `Feld ${f.nr} – ${f.name || f.auto}`), { span: 3 })));
  }

  zeilen.push(T('3. Transformatoren'));
  zeilen.push(F('Trafos, Typenschilder', m.trafos.flatMap(t => t.asset.feldFotos || [])));
  zeilen.push(Z(L('Anzahl Trafos'), W(String(m.trafos.length), { span: 4 })));
  // Bis zu vier Trafos nebeneinander wie in der Vorlage; darüber hinaus ein weiterer Block
  for (let i = 0; i < Math.max(1, m.trafos.length); i += 4) {
    const gruppe = m.trafos.slice(i, i + 4);
    const sp = fn => [...gruppe.map(t => W(fn(t))), ...Array.from({ length: 4 - gruppe.length }, () => W(''))];
    zeilen.push(Z(L('Bezeichnung Trafo'), ...sp(t => t.asset.name || 'Trafo')));
    zeilen.push(Z(L('Leistungen Trafos'), ...sp(t => (t.kva ? `${t.kva} kVA` : ''))));
    zeilen.push(Z(L('Baujahr Trafo'), ...sp(t => txt(t.asset.baujahr))));
    zeilen.push(Z(L('Ausführung'), ...sp(t => kreuze('kuehlung', t.asset.props?.kuehlung))));
    zeilen.push(Z(L(`rechn. wirtschaftliche Nutzungsdauer gem. VDI 2067 (${m.ndTrafo} a)`), ...sp(t => kreuze('ndStatus', t.nd?.status))));
  }

  zeilen.push(T('4. NSHV'));
  zeilen.push(F('NSHV, Messgeräte, Abgänge', m.nshvs.flatMap(n => n.asset.feldFotos || [])));
  if (!m.nshvs.length) zeilen.push(Z(W('', { span: 5, mut: 'keine NSHV erfasst' })));
  for (const nv of m.nshvs) {
    const name = m.nshvs.length > 1 ? nv.asset.name : '';
    zeilen.push(Z(L('Baujahr:', { mut: name }), W(txt(nv.asset.baujahr)), L('Anzahl Abgänge:'), W(txt(nv.abgaenge), { span: 2 })));
    zeilen.push(Z(L('Ausführung NS-Netz:'), W(optLabel('netzform', nv.asset.props?.netzform)), L('Anz. freie Abgänge:'), W(txt(nv.frei), { span: 2 })));
  }

  zeilen.push(T('weitere Betrachtung der Trafostation', 'Mängel, Anmerkungen'));
  const ml = (m.maengel || []).filter(x => x && (x.feld || x.text));
  if (ml.length) ml.forEach(x => zeilen.push(Z(W(txt(x.feld), { span: 2 }), W(txt(x.text).split('\n'), { span: 3 }))));
  else zeilen.push(Z(W('', { span: 2, mut: 'Betrachtungsfeld (z. B. NSHV, Raumaufteilung, baulicher Zustand, Zugangsregelung)' }),
    W('', { span: 3, mut: 'keine Feststellungen erfasst' })));

  let begehung = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(sb.begehung || ''))) {
    const [j, mo, t] = sb.begehung.split('-');
    begehung = `${t}.${mo}.${j}`;
  }
  return {
    kopf: { liegenschaft: lieg, station: m.geb?.name || '', gebNummer: m.geb?.nummer || '',
            stationsart: optLabel('stationsart', st.stationsart.wert), begehung },
    zeilen,
  };
}

/** Titel des Blatts bzw. der Anlage: „Steckbrief Trafostation Geb. 102 – Trafostation Nord" */
export function ssSteckbriefTitel(blatt) {
  const k = blatt.kopf;
  const art = k.stationsart === 'Übergabestation' ? 'Übergabestation' : 'Trafostation';
  const wer = [k.gebNummer ? `Geb. ${k.gebNummer}` : '', k.station].filter(Boolean).join(' – ');
  return `Steckbrief ${art}${wer ? ' ' + wer : ''}`;
}

const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Blatt als HTML-Tabelle mit Inline-Stilen (helles Papier) — für die Druckfassung (34) und die
 * Seitenvorschau des Gutachten-Editors (21). fotos=false zeigt statt der Bilder nur deren Anzahl.
 */
export function ssSteckbriefHtml(blatt, { fotos = true, fussnote = true } = {}) {
  const gruen = '#266426', rand = '1px solid #c5ccc4';
  const zelle = z => {
    const zeilen = (Array.isArray(z.t) ? z.t : [z.t]).map(txt);
    const hatText = zeilen.some(Boolean);
    const zusatz = z.mut ? `<span style="color:#7a807a;">${hatText ? ' (' + escH(z.mut) + ')' : escH(z.mut)}</span>` : '';
    return `<td${z.span > 1 ? ` colspan="${z.span}"` : ''} style="border:${rand};padding:4px 6px;vertical-align:top;line-height:1.45;overflow-wrap:anywhere;hyphens:auto;`
      + `${z.lbl ? 'font-weight:600;color:#333;' : ''}">${zeilen.map(escH).join('<br>') + zusatz || '&nbsp;'}</td>`;
  };
  const rows = blatt.zeilen.map(r => {
    if (r.art === 'titel') {
      const st = `background:${gruen};color:#fff;font-weight:700;padding:5px 7px;border:1px solid ${gruen};`;
      return r.rechts ? `<tr><td colspan="2" style="${st}">${escH(r.text)}</td><td colspan="3" style="${st}">${escH(r.rechts)}</td></tr>`
        : `<tr><td colspan="${SS_BLATT_SPALTEN}" style="${st}">${escH(r.text)}</td></tr>`;
    }
    if (r.art === 'fotos') {
      const bilder = fotos && r.fotos.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:3px;">${r.fotos.slice(0, 6).map(f =>
            `<img src="${f.dataUrl}" style="height:110px;max-width:200px;object-fit:cover;border:1px solid #bbb;">`).join('')}</div>`
        : `<span style="color:#7a807a;">${r.fotos.length ? r.fotos.length + ' Foto(s) aus der Begehung' : '—'}</span>`;
      return `<tr><td colspan="${SS_BLATT_SPALTEN}" style="border:${rand};padding:4px 6px;"><b style="color:#333;">Fotos (${escH(r.text)})</b><br>${bilder}</td></tr>`;
    }
    return `<tr style="page-break-inside:avoid;">${r.zellen.map(zelle).join('')}</tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;">`
    + `<colgroup><col style="width:24%"><col style="width:19%"><col style="width:19%"><col style="width:19%"><col style="width:19%"></colgroup>${rows}</table>`
    + (fussnote ? `<div style="margin-top:8px;font-size:.85em;color:#555;border-top:1px solid #c5ccc4;padding-top:4px;">Datum der Begehung: ${escH(blatt.kopf.begehung || '__.__.____')}</div>` : '');
}
