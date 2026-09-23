// @ts-check
// ── lib/station-steckbrief.js — Liegenschaftssteckbrief Trafostation ─────────
//
// Gemeinsamer Kern für Feldapp und Planungstool: Eine Station ist EIN Gebäude
// (Polygon) mit seinen Elektro-Assets (NAP, Schaltanlage, Trafo, NSHV …), die
// über asset.buildingId verknüpft sind. Die Begehung erfasst die Station als
// Ganzes (Stationsakte), gespeichert wird aber weiterhin pro Asset — damit
// Netzberechnung, Nutzungsdauer und Bestandsprüfung unverändert weiterlaufen.
//
// Bewusst import- und DOM-frei (Blatt im Importgraph): build-feldapp.mjs bündelt
// dieses Modul per Rollup in die Feldapp-Einzeldatei (window.StationSteckbrief).
//
// Datenablage im Projekt-JSON (Rückimport aus der Feldapp):
//   gebaeude[i].feldSteckbrief            = { version, werte, zustand, notiz, maengel[], erfasstAm }
//   elektroAssets.items[j].feldSteckbrief = { version, werte, zustand, notiz, erfasstAm }
//   … .feldFotoSlots                      = { [slotKey]: ['typenschild_01.jpg', …] }

export const STECKBRIEF_VERSION = 1;

/**
 * @typedef {{id:any, type:string, name?:string, buildingId?:any, baujahr?:any, props?:Record<string, any>}} StAsset
 * @typedef {{id:any, name?:string, baujahr?:any, gebaeudenummer?:string, adresse?:string, strasse?:string,
 *            plz?:string, ort?:string, stationPreset?:string, fromKompakt?:boolean}} StGebaeude
 * @typedef {{version?:number, werte?:Record<string, string>, zustand?:string, notiz?:string, erfasstAm?:string|null,
 *            maengel?:any[]}} StEintrag
 * @typedef {{nap:StAsset[], schaltanlagen:StAsset[], trafos:StAsset[], nshv:StAsset[], weitere:StAsset[], alle:StAsset[]}} StAufbau
 * @typedef {{key:string, label:string, typ:string, optionen?:string[], einheit?:string, pflicht?:boolean,
 *            prop?:string, wenn?:{feld:string, wert:string}, gruppe?:string, platzhalter?:string}} StFeld
 * @typedef {{key:string, label:string, pflicht?:boolean}} StFotoSlot
 * @typedef {{titel:string, icon:string, felder:StFeld[], fotos:StFotoSlot[], nutzungsdauer?:boolean}} StAbschnitt
 * @typedef {Record<string, string>} StWerte
 */

/** Asset-Typen, die ein Gebäude zur Station machen. */
export const STATION_KERN_TYPEN = ['NAP', 'Schaltanlage', 'Trafo', 'NSHV'];

/** Reihenfolge der Asset-Gruppen im Stationsschema (versorgungsseitig zuerst). */
/** @type {Record<string, number>} */
const GRUPPEN_REIHENFOLGE = { NAP: 0, Schaltanlage: 1, Trafo: 2, NSHV: 3, UV: 4, KVS: 4 };

/**
 * Rechnerische Nutzungsdauer in Jahren. Trafo = Wert der Elektro-Kostenrechnung
 * (lib/elektro-kosten.js, VDI 2067). Schaltanlage/NSHV: gleicher Ansatz als Annahme.
 */
/** @type {Readonly<Record<string, number>>} */
export const NUTZUNGSDAUER_JAHRE = Object.freeze({ Trafo: 30, Schaltanlage: 30, NSHV: 30 });

export const ZUSTAND_STUFEN = Object.freeze([
  { key: 'gut',      label: 'gut',      farbe: '#16a34a' },
  { key: 'mittel',   label: 'mittel',   farbe: '#f59e0b' },
  { key: 'schlecht', label: 'schlecht', farbe: '#dc2626' },
]);

export const MANGEL_PRIORITAETEN = Object.freeze([
  { key: 'sofort',        label: 'sofort',        farbe: '#dc2626' },
  { key: 'kurzfristig',   label: 'kurzfristig',   farbe: '#f97316' },
  { key: 'mittelfristig', label: 'mittelfristig', farbe: '#f59e0b' },
  { key: 'hinweis',       label: 'Hinweis',       farbe: '#64748b' },
]);

// ── Schema ───────────────────────────────────────────────────────────────────
// Feldtypen: 'wahl' (Chips, eine Auswahl), 'zahl', 'jahr', 'text', 'textlang'.
// pflicht:  zählt in den Erfassungsfortschritt.
// prop:     Asset-Eigenschaft im Tool (asset.props[prop]); 'baujahr' → asset.baujahr.
// wenn:     Feld nur sichtbar/relevant, wenn anderes Feld diesen Wert hat.
// gruppe:   Zwischenüberschrift im Formular.

const JA_NEIN = ['ja', 'nein'];
const IO_MAENGEL = ['i. O.', 'Mängel', 'nicht geprüft'];

/** @type {Record<string, StAbschnitt>} */
export const STECKBRIEF_ABSCHNITTE = {
  station: {
    titel: 'Gebäude & Station', icon: '🏢',
    felder: [
      { key: 'bezeichnung', label: 'Bezeichnung Liegenschaft', typ: 'text', pflicht: true, gruppe: 'Liegenschaft' },
      { key: 'adresse', label: 'Straße, PLZ Ort', typ: 'text', pflicht: true, gruppe: 'Liegenschaft' },
      { key: 'gebaeudeNr', label: 'Gebäude-Nr.', typ: 'text', gruppe: 'Liegenschaft' },
      { key: 'funktion', label: 'Stationsart', typ: 'wahl', optionen: ['Übergabestation', 'Verteilstation', 'Trafostation (Kunde)'], pflicht: true, gruppe: 'Station' },
      { key: 'bauform', label: 'Bauform', typ: 'wahl', optionen: ['begehbar', 'Kompaktstation'], pflicht: true, gruppe: 'Station' },
      { key: 'lage', label: 'Lage', typ: 'wahl', optionen: ['eigenständig', 'gebäudeintegriert'], pflicht: true, gruppe: 'Station' },
      { key: 'bauart', label: 'Bauart', typ: 'wahl', optionen: ['Beton', 'Mauerwerk', 'Metall', 'sonstige'], wenn: { feld: 'bauform', wert: 'begehbar' }, gruppe: 'Station' },
      { key: 'baujahr', label: 'Baujahr', typ: 'jahr', pflicht: true, gruppe: 'Station' },
      { key: 'umbauJahr', label: 'Umbau / Sanierung', typ: 'jahr', gruppe: 'Station' },
      { key: 'msEbene', label: 'MS-Ebene', typ: 'wahl', optionen: ['10 kV', '20 kV', '30 kV', 'sonstige'], pflicht: true, gruppe: 'Netz' },
      { key: 'zaehlung', label: 'Zählung VNB', typ: 'wahl', optionen: ['MS-seitig', 'NS-seitig'], pflicht: true, gruppe: 'Netz' },
      { key: 'einspeisung', label: 'Einspeisung', typ: 'wahl', optionen: ['Ring', 'Stich', 'sonstige'], pflicht: true, gruppe: 'Netz' },
      { key: 'anbindung', label: 'Anbindung an', typ: 'wahl', optionen: ['Netz (VNB)', 'andere Station'], gruppe: 'Netz' },
      { key: 'anbindungStation', label: 'Angebundene Station(en), Geb.-Nr.', typ: 'text', wenn: { feld: 'anbindung', wert: 'andere Station' }, gruppe: 'Netz' },
      { key: 'zugang', label: 'Zugang / Schließung', typ: 'wahl', optionen: ['eigene Schließung', 'VNB-Schließung', 'gemeinsam'], gruppe: 'Betrieb & Sicherheit' },
      { key: 'anlagenverantwortlicher', label: 'Anlagenverantwortlicher', typ: 'text', gruppe: 'Betrieb & Sicherheit' },
      { key: 'pruefungJahr', label: 'Letzte Prüfung (DGUV V3)', typ: 'jahr', pflicht: true, gruppe: 'Betrieb & Sicherheit' },
      { key: 'thermografieJahr', label: 'Letzte Thermografie', typ: 'jahr', gruppe: 'Betrieb & Sicherheit' },
      { key: 'brandschutz', label: 'Brandschutz', typ: 'wahl', optionen: IO_MAENGEL, gruppe: 'Betrieb & Sicherheit' },
      { key: 'erdung', label: 'Erdungsanlage', typ: 'wahl', optionen: IO_MAENGEL, gruppe: 'Betrieb & Sicherheit' },
      { key: 'lueftung', label: 'Lüftung', typ: 'wahl', optionen: ['natürlich', 'mechanisch', 'Klimatisierung'], gruppe: 'Betrieb & Sicherheit' },
      { key: 'hochwasser', label: 'Hochwassergefährdung', typ: 'wahl', optionen: ['nein', 'möglich', 'gefährdet'], gruppe: 'Betrieb & Sicherheit' },
      { key: 'plaeneVorOrt', label: 'Pläne vor Ort', typ: 'wahl', optionen: JA_NEIN, gruppe: 'Betrieb & Sicherheit' },
      { key: 'sicherheitsaushang', label: 'Sicherheitsaushänge / 5 Regeln', typ: 'wahl', optionen: JA_NEIN, gruppe: 'Betrieb & Sicherheit' },
      { key: 'neaEinspeisung', label: 'Einspeisemöglichkeit NEA', typ: 'wahl', optionen: ['vorhanden', 'vorbereitet', 'nicht vorhanden'], gruppe: 'Zukunft & Resilienz' },
      { key: 'reserve', label: 'Reserve für PV / Ladepunkte / WP', typ: 'textlang', gruppe: 'Zukunft & Resilienz' },
    ],
    fotos: [
      { key: 'uebersicht', label: 'Übersicht Station', pflicht: true },
      { key: 'tueren', label: 'Stationstüren / Zugang' },
      { key: 'innen', label: 'Innenraum / Raumaufteilung' },
    ],
  },
  NAP: {
    titel: 'Netzanschluss (NAP)', icon: '⚡',
    felder: [
      { key: 'spannungKV', label: 'Nennspannung', typ: 'zahl', einheit: 'kV', prop: 'spannungKV' },
      { key: 'netzbetreiber', label: 'Netzbetreiber', typ: 'text' },
      { key: 'eigentumsgrenze', label: 'Eigentumsgrenze', typ: 'text' },
    ],
    fotos: [{ key: 'uebergabe', label: 'Übergabe / Eigentumsgrenze' }],
  },
  Schaltanlage: {
    titel: 'MS-Schaltanlage', icon: '⊞', nutzungsdauer: true,
    felder: [
      { key: 'hersteller', label: 'Hersteller', typ: 'text', gruppe: 'Typ' },
      { key: 'typ', label: 'Typ', typ: 'text', gruppe: 'Typ' },
      { key: 'baujahr', label: 'Baujahr', typ: 'jahr', pflicht: true, prop: 'baujahr', gruppe: 'Typ' },
      { key: 'ausfuehrung', label: 'Ausführung', typ: 'wahl', optionen: ['offen', 'gekapselt', 'gasisoliert'], pflicht: true, gruppe: 'Aufbau' },
      { key: 'isolation', label: 'Isolationsmedium', typ: 'wahl', optionen: ['Luft', 'SF6', 'Vakuum', 'Feststoff'], pflicht: true, gruppe: 'Aufbau' },
      { key: 'sf6MengeKg', label: 'SF6-Füllmenge', typ: 'zahl', einheit: 'kg', wenn: { feld: 'isolation', wert: 'SF6' }, gruppe: 'Aufbau' },
      { key: 'felder', label: 'Anzahl Schaltfelder', typ: 'zahl', pflicht: true, prop: 'felder', gruppe: 'Aufbau' },
      { key: 'feldbezeichnungen', label: 'Felder (z. B. Feld 1 – Einspeisung EVU 1)', typ: 'textlang', gruppe: 'Aufbau' },
      { key: 'nennstromA', label: 'Bemessungsstrom', typ: 'zahl', einheit: 'A', prop: 'nennstromA', gruppe: 'Aufbau' },
      { key: 'schutz', label: 'Schutz Trafoabgang', typ: 'wahl', optionen: ['HH-Sicherung', 'Leistungsschalter + Schutzrelais', 'gemischt'], gruppe: 'Schutz & Leittechnik' },
      { key: 'fernwirk', label: 'Fernwirktechnik', typ: 'wahl', optionen: JA_NEIN, gruppe: 'Schutz & Leittechnik' },
      { key: 'kurzschlussanzeiger', label: 'Kurzschlussanzeiger', typ: 'wahl', optionen: JA_NEIN, gruppe: 'Schutz & Leittechnik' },
    ],
    fotos: [
      { key: 'gesamt', label: 'Schaltanlage gesamt', pflicht: true },
      { key: 'typenschild', label: 'Typenschild', pflicht: true },
      { key: 'plan', label: 'Übersichtsplan' },
    ],
  },
  Trafo: {
    titel: 'Transformator', icon: '🔁', nutzungsdauer: true,
    felder: [
      { key: 'hersteller', label: 'Hersteller', typ: 'text', gruppe: 'Typenschild' },
      { key: 'typ', label: 'Typ', typ: 'text', gruppe: 'Typenschild' },
      { key: 'seriennummer', label: 'Seriennummer', typ: 'text', gruppe: 'Typenschild' },
      { key: 'baujahr', label: 'Baujahr', typ: 'jahr', pflicht: true, prop: 'baujahr', gruppe: 'Typenschild' },
      { key: 'leistungKVA', label: 'Bemessungsleistung', typ: 'zahl', einheit: 'kVA', pflicht: true, prop: 'leistungKVA', gruppe: 'Typenschild' },
      { key: 'ukProzent', label: 'Kurzschlussspannung uₖ', typ: 'zahl', einheit: '%', prop: 'ukProzent', gruppe: 'Typenschild' },
      { key: 'schaltgruppe', label: 'Schaltgruppe', typ: 'text', platzhalter: 'z. B. Dyn5', gruppe: 'Typenschild' },
      { key: 'ausfuehrung', label: 'Ausführung', typ: 'wahl', optionen: ['Öl', 'Trocken / Gießharz'], pflicht: true, gruppe: 'Bauart' },
      { key: 'kuehlung', label: 'Kühlart', typ: 'wahl', optionen: ['ONAN', 'ONAF', 'AN', 'AF'], gruppe: 'Bauart' },
      { key: 'oelmengeKg', label: 'Ölmenge', typ: 'zahl', einheit: 'kg', wenn: { feld: 'ausfuehrung', wert: 'Öl' }, gruppe: 'Bauart' },
      { key: 'auffangwanne', label: 'Ölauffangwanne', typ: 'wahl', optionen: ['vorhanden', 'nicht vorhanden'], wenn: { feld: 'ausfuehrung', wert: 'Öl' }, gruppe: 'Bauart' },
      { key: 'temperaturueberwachung', label: 'Temperaturüberwachung', typ: 'wahl', optionen: JA_NEIN, gruppe: 'Bauart' },
      { key: 'verlustklasse', label: 'Verluste', typ: 'wahl', optionen: ['Ökodesign Stufe 2', 'Ökodesign Stufe 1', 'älter / unbekannt'], gruppe: 'Bauart' },
    ],
    fotos: [
      { key: 'gesamt', label: 'Trafo gesamt', pflicht: true },
      { key: 'typenschild', label: 'Typenschild', pflicht: true },
    ],
  },
  NSHV: {
    titel: 'Niederspannungs-Hauptverteilung', icon: '🗄', nutzungsdauer: true,
    felder: [
      { key: 'hersteller', label: 'Hersteller', typ: 'text' },
      { key: 'baujahr', label: 'Baujahr', typ: 'jahr', pflicht: true, prop: 'baujahr' },
      { key: 'netzform', label: 'Netzform', typ: 'wahl', optionen: ['TN-C', 'TN-S', 'TN-C-S', 'TT'], pflicht: true },
      { key: 'nennstromA', label: 'Bemessungsstrom Sammelschiene', typ: 'zahl', einheit: 'A', prop: 'nennstromA' },
      { key: 'abgaenge', label: 'Anzahl Abgänge', typ: 'zahl', pflicht: true, prop: 'abgaenge' },
      { key: 'freieAbgaenge', label: 'davon frei', typ: 'zahl' },
      { key: 'kompensation', label: 'Blindleistungskompensation', typ: 'wahl', optionen: ['vorhanden', 'nicht vorhanden'] },
      { key: 'messung', label: 'Messung', typ: 'wahl', optionen: ['Zähler (RLM)', 'Multimessgerät', 'keine'] },
      { key: 'ueberspannungsschutz', label: 'Überspannungsschutz', typ: 'wahl', optionen: JA_NEIN },
    ],
    fotos: [
      { key: 'gesamt', label: 'NSHV gesamt', pflicht: true },
      { key: 'messgeraete', label: 'Messgeräte' },
      { key: 'abgaenge', label: 'Abgänge' },
    ],
  },
};

/**
 * Schema für einen Asset-Typ; unbekannte Typen (UV, KVS …) erhalten nur Notiz/Fotos.
 * @param {string} typ
 * @returns {StAbschnitt}
 */
export function abschnittFuer(typ) {
  return STECKBRIEF_ABSCHNITTE[typ] || { titel: typ || 'Asset', icon: '●', felder: [], fotos: [{ key: 'gesamt', label: 'Übersicht' }] };
}

// ── Stationserkennung ────────────────────────────────────────────────────────

/**
 * Alle Assets eines Gebäudes.
 * @param {any} gebaeudeId
 * @param {StAsset[]} assets
 * @returns {StAsset[]}
 */
export function assetsDesGebaeudes(gebaeudeId, assets) {
  return (assets || []).filter(a => a && a.buildingId != null && String(a.buildingId) === String(gebaeudeId));
}

/**
 * Ein Gebäude ist eine Station, wenn mindestens ein Kern-Asset daran hängt.
 * @param {any} gebaeudeId
 * @param {StAsset[]} assets
 */
export function istStation(gebaeudeId, assets) {
  return assetsDesGebaeudes(gebaeudeId, assets).some(a => STATION_KERN_TYPEN.includes(a.type));
}

/** @param {StAsset} a @param {StAsset} b */
const _nat = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de', { numeric: true });

/**
 * Aufbau einer Station in Schema-Reihenfolge.
 * @param {any} gebaeudeId
 * @param {StAsset[]} assets
 * @returns {StAufbau}
 */
export function stationAufbau(gebaeudeId, assets) {
  const eigene = assetsDesGebaeudes(gebaeudeId, assets);
  /** @param {string} typ */
  const nach = typ => eigene.filter(a => a.type === typ).sort(_nat);
  const weitere = eigene.filter(a => !STATION_KERN_TYPEN.includes(a.type))
    .sort((a, b) => (GRUPPEN_REIHENFOLGE[a.type] ?? 9) - (GRUPPEN_REIHENFOLGE[b.type] ?? 9) || _nat(a, b));
  const aufbau = { nap: nach('NAP'), schaltanlagen: nach('Schaltanlage'), trafos: nach('Trafo'), nshv: nach('NSHV'), weitere };
  return { ...aufbau, alle: [...aufbau.nap, ...aufbau.schaltanlagen, ...aufbau.trafos, ...aufbau.nshv, ...weitere] };
}

/**
 * Alle Stationen eines Projekts: [{ gebaeude, aufbau }].
 * @param {StGebaeude[]} gebaeudeListe
 * @param {StAsset[]} assets
 * @returns {{gebaeude:StGebaeude, aufbau:StAufbau}[]}
 */
export function findeStationen(gebaeudeListe, assets) {
  return (gebaeudeListe || [])
    .filter(g => g && istStation(g.id, assets))
    .map(g => ({ gebaeude: g, aufbau: stationAufbau(g.id, assets) }));
}

/**
 * Kurzbeschreibung, z. B. „2 Trafos · 2× 630 kVA“.
 * @param {StAufbau} aufbau
 */
export function stationKurzinfo(aufbau) {
  const n = aufbau.trafos.length;
  if (!n) return aufbau.nap.length ? 'Übergabestation ohne Trafo' : 'Station';
  const kva = aufbau.trafos.map(t => parseFloat(t.props?.leistungKVA)).filter(v => v > 0);
  const gleich = kva.length === n && kva.every(v => v === kva[0]);
  const leistung = !kva.length ? '' : gleich ? ` · ${n > 1 ? n + '× ' : ''}${kva[0]} kVA` : ` · ${kva.join(' / ')} kVA`;
  return `${n} Trafo${n > 1 ? 's' : ''}${leistung}`;
}

// ── Leere Datensätze & Vorbefüllung ──────────────────────────────────────────

/** @returns {StEintrag} */
export function leererEintrag() {
  return { version: STECKBRIEF_VERSION, werte: {}, zustand: '', notiz: '', erfasstAm: null };
}

/** @returns {StEintrag} */
export function leererStationsSteckbrief() {
  return { ...leererEintrag(), maengel: [] };
}

/** @param {any} v */
function _jahr(v) {
  const n = parseInt(v, 10);
  return n >= 1850 && n <= 2200 ? String(n) : '';
}

/** @param {StGebaeude} g */
function _bauformAusGebaeude(g) {
  const preset = g.stationPreset || '';
  if (preset.startsWith('begehbar') || preset === 'uebergabe') return 'begehbar';
  if (preset) return 'Kompaktstation';
  const name = String(g.name || '');
  if (/kompakt/i.test(name)) return 'Kompaktstation';
  if (/trafostation|übergabestation/i.test(name) && g.fromKompakt) return 'begehbar';
  return '';
}

/**
 * Werte, die das Planungstool schon kennt — vor Ort nur bestätigen/korrigieren.
 * Gibt { station: {...}, assets: { [assetId]: {...} } } zurück (nur nicht-leere Werte).
 * @param {StGebaeude} gebaeude
 * @param {StAufbau} aufbau
 * @returns {{station: StWerte, assets: Record<string, StWerte>}}
 */
export function vorbelegung(gebaeude, aufbau) {
  const g = gebaeude || { id: null };
  /** @type {StWerte} */
  const station = {};
  if (g.name) station.bezeichnung = String(g.name);
  const adresse = g.adresse || [g.strasse, [g.plz, g.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (adresse) station.adresse = adresse;
  if (g.gebaeudenummer) station.gebaeudeNr = String(g.gebaeudenummer);
  if (_jahr(g.baujahr)) station.baujahr = _jahr(g.baujahr);
  const bauform = _bauformAusGebaeude(g);
  if (bauform) station.bauform = bauform;
  if (aufbau.nap.length || g.stationPreset === 'uebergabe') station.funktion = 'Übergabestation';
  const kv = parseFloat(aufbau.nap[0]?.props?.spannungKV);
  if (kv === 10 || kv === 20 || kv === 30) station.msEbene = `${kv} kV`;

  /** @type {Record<string, StWerte>} */
  const assets = {};
  for (const a of aufbau.alle) {
    /** @type {StWerte} */
    const w = {};
    for (const f of abschnittFuer(a.type).felder) {
      if (!f.prop) continue;
      const roh = f.prop === 'baujahr' ? _jahr(a.baujahr) : a.props?.[f.prop];
      if (roh !== undefined && roh !== null && String(roh).trim() !== '') w[f.key] = String(roh);
    }
    assets[a.id] = w;
  }
  return { station, assets };
}

/**
 * Wert eines Feldes: erfasster Wert vor Vorbelegung.
 * @param {StEintrag|null|undefined} eintrag
 * @param {StWerte|null|undefined} vorbelegt
 * @param {string} key
 * @returns {string}
 */
export function feldWert(eintrag, vorbelegt, key) {
  const v = eintrag?.werte?.[key];
  if (v !== undefined && v !== null && String(v) !== '') return String(v);
  const p = vorbelegt?.[key];
  return p !== undefined && p !== null ? String(p) : '';
}

/**
 * Ist das Feld aktuell relevant (Bedingung „wenn“ erfüllt)?
 * @param {StFeld} feld
 * @param {StEintrag|null|undefined} eintrag
 * @param {StWerte|null|undefined} vorbelegt
 */
export function feldAktiv(feld, eintrag, vorbelegt) {
  if (!feld.wenn) return true;
  return feldWert(eintrag, vorbelegt, feld.wenn.feld) === feld.wenn.wert;
}

// ── Nutzungsdauer ────────────────────────────────────────────────────────────

/**
 * Rechnerische wirtschaftliche Nutzungsdauer (VDI 2067) aus dem Baujahr.
 * @param {string} typ
 * @param {any} baujahr
 * @param {number} [stichjahr]
 * @returns {null | {status:'innerhalb'|'erreicht'|'ueberschritten', alter:number, nd:number, rest:number, label:string}}
 */
export function nutzungsdauerStatus(typ, baujahr, stichjahr = new Date().getFullYear()) {
  const nd = NUTZUNGSDAUER_JAHRE[typ];
  const bj = parseInt(baujahr, 10);
  if (!nd || !(bj >= 1850) || bj > stichjahr) return null;
  const alter = stichjahr - bj;
  const rest = nd - alter;
  /** @type {'innerhalb'|'erreicht'|'ueberschritten'} */
  const status = rest > 0 ? 'innerhalb' : rest === 0 ? 'erreicht' : 'ueberschritten';
  const label = status === 'innerhalb' ? `innerhalb (noch ${rest} J.)`
    : status === 'erreicht' ? 'erreicht'
      : `überschritten (seit ${-rest} J.)`;
  return { status, alter, nd, rest, label };
}

// ── Fortschritt ──────────────────────────────────────────────────────────────

/**
 * Erfassungsfortschritt eines Abschnitts: Pflichtfelder + Pflichtfotos.
 * fotoSlots: { [slotKey]: anzahl }
 * @param {string} typ
 * @param {StEintrag|null|undefined} eintrag
 * @param {StWerte|null|undefined} vorbelegt
 * @param {Record<string, number>} [fotoSlots]
 * @returns {{erledigt:number, gesamt:number, fehlend:string[]}}
 */
export function abschnittFortschritt(typ, eintrag, vorbelegt, fotoSlots = {}) {
  const schema = abschnittFuer(typ);
  const fehlend = [];
  let gesamt = 0;
  for (const f of schema.felder) {
    if (!f.pflicht || !feldAktiv(f, eintrag, vorbelegt)) continue;
    gesamt++;
    if (!feldWert(eintrag, vorbelegt, f.key)) fehlend.push(f.label);
  }
  for (const s of schema.fotos) {
    if (!s.pflicht) continue;
    gesamt++;
    if (!(fotoSlots[s.key] > 0)) fehlend.push(`Foto: ${s.label}`);
  }
  return { erledigt: gesamt - fehlend.length, gesamt, fehlend };
}

/**
 * Fortschritt der ganzen Station.
 * stbStation: Stations-Eintrag; stbAssets: { [assetId]: Eintrag };
 * fotos: { station: {slot:n}, [assetId]: {slot:n} }
 * @param {StGebaeude} gebaeude
 * @param {StAufbau} aufbau
 * @param {StEintrag|null|undefined} stbStation
 * @param {Record<string, StEintrag>} [stbAssets]
 * @param {Record<string, Record<string, number>>} [fotos]
 */
export function stationFortschritt(gebaeude, aufbau, stbStation, stbAssets = {}, fotos = {}) {
  const vb = vorbelegung(gebaeude, aufbau);
  const teile = [abschnittFortschritt('station', stbStation, vb.station, fotos.station)];
  for (const a of aufbau.alle) teile.push(abschnittFortschritt(a.type, stbAssets[a.id], vb.assets[a.id], fotos[a.id]));
  const erledigt = teile.reduce((s, t) => s + t.erledigt, 0);
  const gesamt = teile.reduce((s, t) => s + t.gesamt, 0);
  return { erledigt, gesamt, prozent: gesamt ? Math.round(erledigt / gesamt * 100) : 100 };
}

// ── Rückübernahme ins Planungstool ───────────────────────────────────────────

/** @param {any} v */
function _zahl(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Welche Asset-Eigenschaften ändern sich durch den Steckbrief?
 * Nur Felder mit „prop“, nur echte Abweichungen, nur plausible Zahlen.
 * @param {StAsset} asset
 * @param {StEintrag|null|undefined} eintrag
 * @returns {{prop:string, feld:string, alt:any, neu:string}[]}
 */
export function assetAenderungen(asset, eintrag) {
  const aenderungen = [];
  for (const f of abschnittFuer(asset.type).felder) {
    if (!f.prop) continue;
    const roh = eintrag?.werte?.[f.key];
    if (roh === undefined || roh === null || String(roh).trim() === '') continue;
    if (f.prop === 'baujahr') {
      const neu = _jahr(roh);
      if (neu && String(asset.baujahr ?? '') !== neu) aenderungen.push({ prop: 'baujahr', feld: f.label, alt: asset.baujahr ?? null, neu });
      continue;
    }
    const n = _zahl(roh);
    if (n === null || n < 0) continue;
    const alt = asset.props?.[f.prop];
    if (_zahl(alt) === n) continue;
    aenderungen.push({ prop: f.prop, feld: f.label, alt: alt ?? null, neu: String(n) });
  }
  return aenderungen;
}

/**
 * Änderungen auf das Asset anwenden (mutiert).
 * @param {StAsset} asset
 * @param {{prop:string, neu:string}[]} aenderungen
 */
export function assetAenderungenAnwenden(asset, aenderungen) {
  for (const c of aenderungen) {
    if (c.prop === 'baujahr') asset.baujahr = parseInt(c.neu, 10);
    else asset.props = { ...(asset.props || {}), [c.prop]: c.neu };
  }
}

/**
 * Gebäude-Baujahr aus dem Stations-Steckbrief (oder null, wenn unverändert).
 * @param {StGebaeude} gebaeude
 * @param {StEintrag|null|undefined} stbStation
 */
export function gebaeudeBaujahrAenderung(gebaeude, stbStation) {
  const neu = _jahr(stbStation?.werte?.baujahr);
  if (!neu || String(gebaeude?.baujahr ?? '') === neu) return null;
  return { alt: gebaeude?.baujahr ?? null, neu: parseInt(neu, 10) };
}
