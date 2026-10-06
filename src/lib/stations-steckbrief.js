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

import { nuNetzUebersicht } from './netz-uebersicht.js';

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
 */
export function ssStationModell({ gebaeudeId, assets = [], edges = [], gebaeude = [], heute, messort = '' } = {}) {
  const geb = gebaeude.find(g => String(g.id) === String(gebaeudeId)) || null;
  const sb = geb?.stationSteckbrief || {};
  const imGeb = assets.filter(a => String(a.buildingId) === String(gebaeudeId));
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
