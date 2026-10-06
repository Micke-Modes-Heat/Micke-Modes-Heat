// ── 35-excel.js — Excel-Vollexport und -Import (📊/📥 Excel) ─────────────────
//
// Geschrieben und gelesen wird mit lib/xlsx-schreiber.js / lib/xlsx-leser.js
// (JSZip ist im Build eingebettet) — läuft also offline, ohne SheetJS vom CDN.
//
// Export: gelbe Zellen werden eingelesen, graue sind nur Information. Die Blätter
// sind ohne Passwort geschützt, damit Kopfzeilen und Schlüsselspalten nicht
// versehentlich überschrieben werden; Auswahlfelder haben Dropdowns.
//
// Import: Spalten werden über die Kopfzeile erkannt (ältere Exporte bleiben
// lesbar). Übernommen wird nur, was vom Stand vor dem Import abweicht
// (lib/xlsx-abgleich.js). Alle Änderungen werden erst gesammelt und in einer
// Vorschau angezeigt; angewendet wird erst nach Bestätigung.

import { globalYear, varianten, variantenName, aktiverVariantenName, updateVizDebounced } from './01-globals-varianten.js';
import { updateField, calcAutoEnergy } from './02b-gebaeude.js';
import { recalcNetz } from './03b-netz.js';
import { escHtml, renderList, updateTotals, updateGebPv, showHint } from './03c-gebaeude-io.js';
import { ASSET_LABELS } from './05a-export.js';
import { ASSETS, getAssetStatus, ASSET_PROPS_SCHEMA } from './13a-assets-core.js';
import { renderSidebarAssetList } from './13e-assets-inspector.js';
import { getElSlpProfiles } from './13k-elslp-registry.js';
import { KABEL_TYPEN } from './config/netz-kosten.js';
import { parseKabelLabel } from './lib/kabel-label.js';
import { SCHICHT_META, normSchicht } from './lib/schichten.js';
import { normalisiereNotstrom } from './lib/resilienz-core.js';
import { createId } from './lib/util.js';
import { xlsxDateien, xlsxBlob, XS } from './lib/xlsx-schreiber.js';
import { xlsxAusBlob } from './lib/xlsx-leser.js';
import { istLeer, xNum, xInt, xStr, xBool, janein, kopfIndex, zahlGeaendert, textGeaendert, xAuswahl,
  propZuZelle, zelleZuProp, propGeaendert, zielParameterText, zielParameterLesen, zielParameterGleich,
  GILT_ALLE, geltungText, geltungLesen, listenBlatt, tabellenBlatt, zelleGeaendert } from './lib/xlsx-abgleich.js';

// ── Wertebereiche ────────────────────────────────────────────────────────────

const _SCHICHT_WERTE       = Object.fromEntries(Object.entries(SCHICHT_META).map(([k, m]) => [k, m.label]));
const _ZUSTAND_WERTE       = { A: 'A', B: 'B', C: 'C' };
const _NOTSTROM_WERTE      = { A: 'A', B: 'B', C: 'C' };
const _DACHFORM_WERTE      = { flach: 'Flachdach', sattel: 'Satteldach', walm: 'Walmdach', pult: 'Pultdach' };
const _PV_MODUS_WERTE      = { pauschal: 'Pauschal', flaechen: 'Flächen' };
const _PV_AUSRICHTUNG      = { sued: 'Süd', ostwest: 'Ost-West' };
const _MASSN_STATUS_WERTE  = { geplant: 'geplant', umgesetzt: 'umgesetzt', abgelehnt: 'abgelehnt' };
const _MASSN_OBJEKT_WERTE  = { Asset: 'Asset', Kabel: 'Kabel', Gebaeude: 'Gebäude' };
// Maßnahmentypen wie in den Formularen von Asset- (13e) und Kabel-Inspektor (05b)
const _MASSN_TYP_WERTE = {
  Asset: { Sanierung: 'Sanierung', Abriss: 'Abriss', Bau: 'Neubau/Bau', Ertuechtigung: 'Ertüchtigung' },
  Kabel: { Verlegung: 'Neuverlegung', Ertuecht: 'Ertüchtigung', Austausch: 'Austausch', Rueckbau: 'Rückbau' },
};
// Ziel-Parameter von Kabel-Maßnahmen (Engpass-Ausbauplan, lib/engpass-core.js)
const _KABEL_ZIEL_DEFS = [
  { key: 'cableType',    label: 'Typ' },
  { key: 'crossSection', label: 'Querschnitt mm²' },
  { key: 'nParallel',    label: 'Parallelkabel' },
];

// Typ-Reiter: ASSET_PROPS_SCHEMA (13a) enthält die simulationsrelevanten Props
// und speist auch das „Ziel-Parameter"-Formular der Maßnahmen. Was nur der
// Inspektor (13e) zusätzlich pflegt, steht deshalb hier und nicht dort.
const _XLSX_PROPS_EXTRA = {
  Trafo:       [{ key: 'netzart', label: 'Netzart' }],
  NSHV:        [{ key: 'netzart', label: 'Netzart' }],
  UV:          [{ key: 'netzart', label: 'Netzart' }],
  Verbraucher: [{ key: 'slpTyp',  label: 'Lastprofil (SLP)' }],
  TWW:         [{ key: 'kwhProPersonA', label: 'kWh/(Pers.·a)' },
                { key: 'copBooster',    label: 'COP Booster' },
                { key: 'zielTempC',     label: 'Zieltemperatur (°C)' },
                { key: 'vbhTww',        label: 'Vollbenutzungsstunden (h/a)' }],
  KWK:         [{ key: 'wirkungsgradGes', label: 'Gesamtwirkungsgrad (%)' }],
  Lade:        [{ key: 'rotation', label: 'Drehung (°)' }],
  Wind:        [{ key: 'einschaltwindMs',        label: 'Einschaltwind (m/s)' },
                { key: 'nennwindMs',             label: 'Nennwind (m/s)' },
                { key: 'abschaltwindMs',         label: 'Abschaltwind (m/s)' },
                { key: 'mittlereWindMs',         label: 'Ø Windgeschw. Nabenhöhe (m/s)' },
                { key: 'weibullK',               label: 'Weibull-Formfaktor k' },
                { key: 'abstandMultiplikator',   label: 'Planungsabstand (x Rotordurchmesser)' },
                { key: 'windLwa',                label: 'Schallleistungspegel Lwa (dB(A))' },
                { key: 'abstandVisible',         label: 'Abstandsradius anzeigen' },
                { key: 'laermVisible',           label: 'Lärmringe anzeigen' },
                { key: 'eignungsflaecheVisible', label: 'Eignungsfläche anzeigen' }],
};
const _XLSX_AUSWAHL = {
  netzart:       { verbrauch: 'Verbrauchsnetz', erzeugung: 'Erzeugungsnetz' },
  ausrichtung:   { sued: 'Süd', ostwest: 'Ost-West' },
  eingabeModus:  { personen: 'Personenzahl', energie: 'TWW-Energie' },
  geraet:        { heizstab: 'Heizstab', booster: 'Booster-WP' },
  betriebsmodus: { einspeisung: 'Einspeisung', verbraucher: 'Verbraucher' },
  kraftstoff:    { Diesel: 'Diesel', Gas: 'Gas', HVO: 'HVO' },
  brennstoff:    Object.fromEntries(['Erdgas', 'Biogas', 'Biomethan', 'HVO', 'Pflanzenöl', 'Wasserstoff', 'Heizöl'].map(b => [b, b])),
};
const _XLSX_JANEIN = new Set(['trennstelle', 'abstandVisible', 'laermVisible', 'eignungsflaecheVisible']);
// Vom Tool berechnet — nur zur Information exportiert (TWW: computeTwwKw beim Öffnen des Inspektors)
const _XLSX_BERECHNET = { TWW: new Set(['leistungKW']) };

/** Spalten des Typ-Reiters: {key, label, art, werte?}. */
function _xlsxPropDefs(type) {
  return [...(ASSET_PROPS_SCHEMA[type] || []), ...(_XLSX_PROPS_EXTRA[type] || [])].map(d => {
    if (_XLSX_BERECHNET[type]?.has(d.key)) return { ...d, label: d.label + ' (berechnet)', art: 'berechnet' };
    if (d.key === 'slpTyp') return { ...d, art: 'auswahl', werte: Object.fromEntries(getElSlpProfiles().map(p => [p.id, p.id])) };
    if (_XLSX_AUSWAHL[d.key]) return { ...d, art: 'auswahl', werte: _XLSX_AUSWAHL[d.key] };
    return { ...d, art: _XLSX_JANEIN.has(d.key) ? 'janein' : 'zahl' };
  });
}

function _typReiterName(type) { return (ASSET_LABELS[type] || type).slice(0, 31); }

function _statusText(item, yr) {
  const s = getAssetStatus(item, yr);
  return s === 'active' ? 'Aktiv' : s === 'planned' ? 'Geplant' : 'Abgerissen';
}

function _zahl(v, stellen) {
  const n = parseFloat(v);
  return (v == null || v === '' || !isFinite(n)) ? '' : +n.toFixed(stellen);
}

function _variantenListe() {
  return [{ key: 'base', name: variantenName('base') }, ...(varianten || []).map(v => ({ key: v.id, name: v.name }))];
}

function _kabelLabel(e, assetMap) {
  return `${assetMap.get(e.u)?.name || e.u} → ${assetMap.get(e.v)?.name || e.v}`;
}

/** Alle Maßnahmen mit Objektbezug: Assets, Kabel, Gebäude (Cluster-Pakete). */
function _alleMassnahmen(allAssets, allEdges, allGebaeude, assetMap) {
  const liste = [];
  for (const a of allAssets) for (const m of (a.massnahmen || []))
    liste.push({ m, art: 'Asset', obj: a, objId: a.id, objName: a.name || a.id, objTyp: ASSET_LABELS[a.type] || a.type, zielDefs: ASSET_PROPS_SCHEMA[a.type] || [] });
  for (const e of allEdges) for (const m of (e.massnahmen || []))
    liste.push({ m, art: 'Kabel', obj: e, objId: e.id, objName: _kabelLabel(e, assetMap), objTyp: e.cableType || 'NAYY', zielDefs: _KABEL_ZIEL_DEFS });
  for (const g of allGebaeude) for (const m of (g.massnahmen || []))
    liste.push({ m, art: 'Gebaeude', obj: g, objId: g.id, objName: g.name || '', objTyp: g.nutzung || '', zielDefs: [] });
  return liste;
}

// ── Export: Bausteine ────────────────────────────────────────────────────────

function _textBlatt(name, zeilen, breiten) {
  return { name, zeilen, schutz: false, spalten: breiten.map(b => ({ breite: b })) };
}

// ── Export ───────────────────────────────────────────────────────────────────
export async function exportVollstaendigXLSX() {
  if (typeof window.JSZip !== 'function') { showHint('⚠ JSZip ist nicht geladen — bitte die Seite neu laden.', 6000); return; }
  const yr = globalYear ?? new Date().getFullYear();
  const allGebaeude = window.gebaeude || [];
  const allAssets = ASSETS.items || [];
  const allEdges = window.stromEdges || [];
  const gebMap = new Map(allGebaeude.map(g => [g.id, g]));
  const assetMap = new Map(allAssets.map(a => [a.id, a]));
  const gebName = a => a.buildingId != null ? (gebMap.get(a.buildingId)?.name || a.buildingId) : '';
  const alleMassn = _alleMassnahmen(allAssets, allEdges, allGebaeude, assetMap);
  const S = (kopf, wert, opt = {}) => ({ kopf, wert, ...opt });
  const E = { edit: true }, EZ = { edit: true, zahl: true };

  // Auswahllisten
  const propListen = {};
  for (const type of Object.keys(ASSET_PROPS_SCHEMA)) for (const d of _xlsxPropDefs(type))
    if (d.art === 'auswahl') propListen['L_P_' + d.key] = Object.values(d.werte);
  const assetNamen = [...new Set(allAssets.map(a => a.name || String(a.id)))].sort((a, b) => a.localeCompare(b, 'de'));
  const { blatt: listenTab, namen } = listenBlatt({
    L_JaNein: ['ja', 'nein'],
    L_Schicht: Object.values(_SCHICHT_WERTE),
    L_Zustand: Object.values(_ZUSTAND_WERTE),
    L_Notstrom: Object.values(_NOTSTROM_WERTE),
    L_PvModus: Object.values(_PV_MODUS_WERTE),
    L_PvAusr: Object.values(_PV_AUSRICHTUNG),
    L_Dachform: Object.values(_DACHFORM_WERTE),
    L_KabelTyp: Object.keys(KABEL_TYPEN),
    L_MStatus: Object.values(_MASSN_STATUS_WERTE),
    L_MTyp: [...new Set([...Object.values(_MASSN_TYP_WERTE.Asset), ...Object.values(_MASSN_TYP_WERTE.Kabel)])],
    L_Objekt: ['Asset', 'Kabel'],
    L_Gilt: [GILT_ALLE, ..._variantenListe().map(v => v.name)],
    L_Assets: assetNamen,
    L_MObjekte: [...assetNamen, ...allEdges.map(e => _kabelLabel(e, assetMap))],
    ...propListen,
  });
  const T = (name, spalten, objekte, opt = {}) => tabellenBlatt(name, spalten, objekte, { namen, ...opt });

  const gebBlatt = T('Gebäude', [
    S('ID', g => g.id, { breite: 6 }),
    S('Name', g => g.name, { ...E, breite: 24 }),
    S('Gebäudenummer', g => g.gebaeudenummer, E),
    S('Nutzung', g => g.nutzung, E),
    S('Fläche (m²)', g => _zahl(g.flaeche, 0), EZ),
    S('Stockwerke', g => g.stockwerke ?? 1, EZ),
    S('Baujahr', g => g.baujahr, EZ),
    S('Abrissjahr', g => g.abrissjahr, EZ),
    S('Schicht', g => _SCHICHT_WERTE[normSchicht(g.schicht)], { ...E, liste: 'L_Schicht', breite: 13 }),
    S('Zustand', g => g.zustand, { ...E, liste: 'L_Zustand' }),
    S('Wärmebedarf (MWh/a)', g => _zahl(g.waerme, 2), EZ),
    S('Heizlast (kW)', g => _zahl(g.heizlast, 1), EZ),
    S('Spez. Wärme (kWh/m²a)', g => _zahl(g.spez, 1), EZ),
    S('Spez. Heizlast (W/m²)', g => _zahl(g.spezHeizlast, 1), EZ),
    S('Strom (MWh/a)', g => _zahl(g.strom, 2), EZ),
    S('Spez. Strom (kWh/m²a)', g => _zahl(g.spezStrom, 1), EZ),
    S('PV aktiv', g => janein(!!g.pvAktiv), { ...E, liste: 'L_JaNein' }),
    S('PV Dachanteil (%)', g => g.pvDachanteil || 30, EZ),
    S('PV-Modus', g => _PV_MODUS_WERTE[g.pvModus || 'flaechen'] || g.pvModus, { ...E, liste: 'L_PvModus' }),
    S('PV-Ausrichtung', g => _PV_AUSRICHTUNG[g.pvFlAusrichtung || 'sued'] || g.pvFlAusrichtung, { ...E, liste: 'L_PvAusr' }),
    S('PV-Belegung (%)', g => g.pvFlBelegung, EZ),
    S('PV-GCR (%)', g => g.pvFlGcr, EZ),
    S('PV-Baujahr', g => g.pvBaujahr, EZ),
    S('Dachform', g => _DACHFORM_WERTE[g.dachform || 'sattel'] || g.dachform, { ...E, liste: 'L_Dachform' }),
    S('Dachneigung (°)', g => _zahl(g.dachNeigung, 1), EZ),
    S('Dachazimut (°)', g => _zahl(g.dachAzimut, 1), EZ),
    S('Notstromklasse', g => normalisiereNotstrom(g.notstrom)?.klasse, { ...E, liste: 'L_Notstrom' }),
    S('Notstrom Last B (%)', g => normalisiereNotstrom(g.notstrom)?.lastPct, EZ),
    S('Notstrom eigenes NEA', g => { const n = normalisiereNotstrom(g.notstrom); return n?.klasse === 'A' ? janein(n.eigeneNea) : ''; }, { ...E, liste: 'L_JaNein' }),
  ], allGebaeude, { fixSpalten: 2 });

  const leistung = a => {
    const p = a.props || {};
    if (a.type === 'Trafo') return (p.leistungKVA || 630) + ' kVA';
    if (['Verbraucher', 'WP', 'Nsa', 'KWK', 'Wind'].includes(a.type)) return (p.leistungKW || p.leistungElKW || 0) + ' kW';
    if (a.type === 'PV') return (p.leistungKWp || 0) + ' kWp';
    if (a.type === 'Lade') return ((p.anzahlPunkte || 4) * (p.leistungProPunktKW || 22)) + ' kW';
    if (['NSHV', 'UV', 'KVS', 'Schaltanlage'].includes(a.type)) return (p.nennstromA || 400) + ' A';
    return '';
  };
  const invest = a => (a.massnahmen || []).reduce((s, m) => s + (parseFloat(m.kosten) || 0), 0);
  const assetBasis = [
    S('ID', a => a.id, { breite: 14 }),
    S('Name', a => a.name || a.id, { ...E, breite: 22 }),
  ];
  const assetJahre = [
    S('Baujahr', a => a.baujahr, EZ),
    S('Abrissjahr', a => a.abrissjahr, EZ),
    S('Schicht', a => _SCHICHT_WERTE[normSchicht(a.schicht)], { ...E, liste: 'L_Schicht', breite: 13 }),
    S('Status ' + yr, a => _statusText(a, yr)),
  ];
  const assetsBlatt = T('Assets', [
    ...assetBasis,
    S('Typ', a => ASSET_LABELS[a.type] || a.type, { breite: 16 }),
    S('Gebäude', gebName, { breite: 18 }),
    ...assetJahre,
    S('Leistung kW/kVA', leistung),
    S('Maßnahmen (Anzahl)', a => (a.massnahmen || []).length),
    S('Investition (€)', a => invest(a) || ''),
  ], allAssets, { fixSpalten: 2 });

  const kabelBlatt = T('Kabel', [
    S('Kabel-ID', e => e.id, { breite: 14 }),
    S('Von-ID', e => e.u, { edit: 'neu', breite: 14 }),
    S('Nach-ID', e => e.v, { edit: 'neu', breite: 14 }),
    S('Von', e => assetMap.get(e.u)?.name || e.u, { edit: 'neu', liste: 'L_Assets', breite: 20 }),
    S('Nach', e => assetMap.get(e.v)?.name || e.v, { edit: 'neu', liste: 'L_Assets', breite: 20 }),
    S('Typ', e => e.cableType || 'NAYY', { ...E, liste: 'L_KabelTyp', breite: 12 }),
    S('Querschnitt mm²', e => e.crossSection || '', EZ),
    S('Auto-Bemessung', e => janein(!!e.autoSized), { ...E, liste: 'L_JaNein' }),
    S('Parallelkabel', e => e.nParallel || 1, EZ),
    S('Sicherung A', e => e.fuseA || '', EZ),
    S('Trennstelle', e => janein(!!e.trennstelle), { ...E, liste: 'L_JaNein' }),
    S('Querschnitt geschätzt', e => janein(!!e.qsGeschaetzt)),
    S('Querschnitt-Quelle', e => e.qsQuelle || '', { breite: 28 }),
    S('MS-Ebene', e => janein(!!e.msLevel)),
    S('Baujahr (abgeleitet)', e => e.baujahr ?? ''),
    S('Abrissjahr (abgeleitet)', e => e.abrissjahr ?? ''),
    S('Länge m', e => Math.round(e.lengthM || 0)),
    S('Strom A', e => e.peakCurrentA != null ? +e.peakCurrentA.toFixed(1) : ''),
    S('Auslastung %', e => e.auslastungPct != null ? +e.auslastungPct.toFixed(1) : ''),
    S('Spannungsfall %', e => e.deltaUPct != null ? +e.deltaUPct.toFixed(2) : ''),
    S('Fluss kW', e => e.peakFlowKw != null ? +e.peakFlowKw.toFixed(1) : ''),
  ], allEdges, { leerzeilen: 30 });

  const massnBlatt = T('Maßnahmen', [
    S('Maßnahmen-ID', x => x.m.id ?? '', { breite: 14 }),
    S('Objekt', x => _MASSN_OBJEKT_WERTE[x.art], { edit: 'neu', liste: 'L_Objekt' }),
    S('Objekt-ID', x => x.objId, { edit: 'neu', breite: 14 }),
    S('Objekt-Name', x => x.objName, { edit: 'neu', liste: 'L_MObjekte', breite: 24 }),
    S('Objekttyp', x => x.objTyp, { breite: 14 }),
    S('Titel', x => x.m.titel || '', { ...E, breite: 26 }),
    S('Maßnahmentyp', x => _MASSN_TYP_WERTE[x.art]?.[x.m.typ] ?? x.m.typ ?? '', { ...E, liste: 'L_MTyp', breite: 14 }),
    S('Jahr', x => x.m.jahr ?? '', EZ),
    S('Status', x => x.m.status || 'geplant', { ...E, liste: 'L_MStatus' }),
    S('Kosten €', x => parseFloat(x.m.kosten) || 0, EZ),
    S('Gilt für', x => geltungText(x.m, variantenName), { ...E, liste: 'L_Gilt', breite: 16 }),
    S('Ziel-Parameter', x => zielParameterText(x.m.newProps, x.zielDefs), { ...E, breite: 36 }),
  ], alleMassn, { leerzeilen: 30 });

  const bezBlatt = T('Beziehungen', [
    S('Asset-ID', a => a.id, { breite: 14 }),
    S('Asset-Name', a => a.name || a.id, { breite: 22 }),
    S('Typ', a => ASSET_LABELS[a.type] || a.type, { breite: 16 }),
    S('Gebäude-ID', a => a.buildingId || ''),
    S('Gebäude-Name', a => a.buildingId != null ? (gebMap.get(a.buildingId)?.name || '') : '', { breite: 18 }),
    S('Verbunden mit (IDs)', a => allEdges.filter(e => e.u === a.id || e.v === a.id).map(e => e.u === a.id ? e.v : e.u).join(', '), { breite: 40 }),
  ], allAssets);

  // Typ-Reiter (nur für vorhandene Typen)
  const typBlaetter = [];
  for (const type of Object.keys(ASSET_PROPS_SCHEMA)) {
    const typeAssets = allAssets.filter(a => a.type === type);
    const defs = _xlsxPropDefs(type);
    if (!typeAssets.length || !defs.length) continue;
    typBlaetter.push(T(_typReiterName(type), [
      ...assetBasis,
      S('Gebäude', gebName, { breite: 18 }),
      ...assetJahre,
      ...defs.map(d => S(d.label, a => propZuZelle(d, (a.props || {})[d.key]), {
        edit: d.art !== 'berechnet',
        zahl: d.art === 'zahl',
        liste: d.art === 'auswahl' ? 'L_P_' + d.key : d.art === 'janein' ? 'L_JaNein' : undefined,
      })),
    ], typeAssets, { fixSpalten: 2 }));
  }

  // Übersicht
  const summe = (liste, f) => liste.reduce((s, x) => s + (parseFloat(f(x)) || 0), 0);
  const typStats = {};
  for (const a of allAssets) {
    if (!typStats[a.type]) typStats[a.type] = { count: 0, invest: 0 };
    typStats[a.type].count++;
    typStats[a.type].invest += invest(a);
  }
  const massnStats = { geplant: { n: 0, k: 0 }, umgesetzt: { n: 0, k: 0 }, abgelehnt: { n: 0, k: 0 } };
  for (const { m } of alleMassn) {
    const s = massnStats[m.status] || massnStats.geplant;
    s.n++; s.k += parseFloat(m.kosten) || 0;
  }
  const r0 = v => Math.round(v), r1 = v => +v.toFixed(1);
  const ab = t => [{ w: t, s: XS.abschnitt }, { w: null, s: XS.abschnitt }, { w: null, s: XS.abschnitt }];
  const kopf = (...t) => t.map(w => ({ w, s: XS.kopf }));
  const ueBlatt = _textBlatt('Übersicht', [
    [{ w: 'Energieplanung – Übersicht', s: XS.titel }],
    [],
    ['Exportiert am', new Date().toLocaleDateString('de-DE')],
    ['Planungsjahr', yr],
    ['Variante', aktiverVariantenName()],
    [],
    ab('GEBÄUDE'), kopf('Kenngröße', 'Wert', 'Einheit'),
    ['Anzahl Gebäude', allGebaeude.length, ''],
    ['Gesamtfläche', r0(summe(allGebaeude, g => g.flaeche)), 'm²'],
    ['Wärmebedarf gesamt', r1(summe(allGebaeude, g => g.waerme)), 'MWh/a'],
    ['Heizlast gesamt', r1(summe(allGebaeude, g => g.heizlast)), 'kW'],
    ['Strombedarf gesamt', r1(summe(allGebaeude, g => g.strom)), 'MWh/a'],
    [],
    ab('ELEKTRISCHE ANLAGEN'), kopf('Typ', 'Anzahl', 'Investition (€)'),
    ...Object.entries(typStats).map(([t, s]) => [ASSET_LABELS[t] || t, s.count, r0(s.invest)]),
    [{ w: 'Gesamt', s: XS.fett }, allAssets.length, r0(Object.values(typStats).reduce((s, x) => s + x.invest, 0))],
    [],
    ab('KABEL / LEITUNGEN'), kopf('Kenngröße', 'Wert', 'Einheit'),
    ['Anzahl Kabel', allEdges.length, ''],
    ['Gesamtlänge', r0(summe(allEdges, e => e.lengthM)), 'm'],
    [],
    ab('MASSNAHMEN (Assets, Kabel, Gebäude)'), kopf('Status', 'Anzahl', 'Kosten (€)'),
    ['Geplant', massnStats.geplant.n, r0(massnStats.geplant.k)],
    ['Umgesetzt', massnStats.umgesetzt.n, r0(massnStats.umgesetzt.k)],
    ['Abgelehnt', massnStats.abgelehnt.n, r0(massnStats.abgelehnt.k)],
    [{ w: 'Gesamt', s: XS.fett }, alleMassn.length, r0(Object.values(massnStats).reduce((s, x) => s + x.k, 0))],
  ], [30, 16, 16]);

  const H = (a, b) => [{ w: a, s: XS.fett }, { w: b, s: XS.fliess }];
  const hinwBlatt = _textBlatt('Hinweise', [
    [{ w: 'Excel-Import – Hinweise', s: XS.titel }],
    [],
    H('Farben', 'Gelbe Zellen werden beim Import (📥 Excel) eingelesen. Graue Zellen sind nur Information. Die Blätter sind ohne Passwort geschützt (Überprüfen › Blattschutz aufheben), damit Kopfzeilen und IDs nicht versehentlich überschrieben werden.'),
    H('Vorschau', 'Der Import zeigt zuerst alle erkannten Änderungen (bisher → neu). Erst nach „Übernehmen" wird etwas geändert.'),
    H('Nur Änderungen', 'Übernommen werden nur Zellen, die in Excel geändert wurden und vom Stand im Tool abweichen. Ein unverändert wieder eingelesener Export ändert nichts.'),
    H('Zuordnung', 'Über die ID-Spalten. Spalten werden an ihrer Überschrift erkannt — Überschriften nicht umbenennen.'),
    H('Leere Zelle', 'Löscht den Wert (z. B. Abrissjahr). Bei Name, Nutzung, Fläche, Stockwerke, Schicht und Auswahlfeldern ohne Leer-Option bleibt der Wert dagegen unverändert.'),
    H('Variante', 'Die Datei gilt für die Variante, die beim Export aktiv war (siehe Übersicht). Beim Import in eine andere Variante warnt die Vorschau.'),
    H('Ältere Datei', 'Der Stand beim Export liegt in versteckten Blättern („_B_…"). Übernommen wird nur, was in Excel geändert wurde — was inzwischen im Tool geändert oder neu berechnet wurde, bleibt erhalten. Die versteckten Blätter deshalb nicht löschen.'),
    [],
    [{ w: 'Gebäude', s: XS.abschnitt }, { w: null, s: XS.abschnitt }],
    H('Wärmebedarf / Heizlast', 'Zahl = manueller Wert; leer = wieder automatisch berechnen.'),
    H('Notstromklasse', 'A (kritisch), B (eingeschränkt), C (einspeisefähig) oder leer.'),
    [],
    [{ w: 'Kabel', s: XS.abschnitt }, { w: null, s: XS.abschnitt }],
    H('Neues Kabel', 'In einer der gelben Leerzeilen unten „Von" und „Nach" aus der Liste wählen (oder Von-ID/Nach-ID eintragen), dazu Typ und ggf. Querschnitt. Ohne Querschnitt wird automatisch ausgelegt. Länge und Trasse berechnet das Tool.'),
    H('Querschnitt mm²', 'Ein geänderter Wert schaltet die Auto-Bemessung für dieses Kabel aus.'),
    H('Auto-Bemessung', 'ja = Querschnitt automatisch auslegen.'),
    [],
    [{ w: 'Maßnahmen', s: XS.abschnitt }, { w: null, s: XS.abschnitt }],
    H('Neue Maßnahme', 'In einer der gelben Leerzeilen unten das Objekt über „Objekt-Name" aus der Liste wählen (Asset oder Kabel), Titel und weitere Angaben eintragen. Gebäude-Maßnahmen entstehen über Cluster-Pakete und sind hier nicht anlegbar.'),
    H('Maßnahmentyp', `Asset: ${Object.values(_MASSN_TYP_WERTE.Asset).join(', ')} · Kabel: ${Object.values(_MASSN_TYP_WERTE.Kabel).join(', ')}`),
    H('Gilt für', `leer = Standardregel, „${GILT_ALLE}" oder der Name einer Variante.`),
    H('Ziel-Parameter', 'Name=Wert; Name=Wert … z. B. „Leistung (kVA)=1000; UK (%)=6" (Namen wie im Typ-Reiter).'),
  ], [26, 110]);

  // Exportstand je importierbarem Blatt (versteckt) — Grundlage des Dreiwege-Abgleichs beim Import
  const basisBlaetter = [gebBlatt, assetsBlatt, kabelBlatt, massnBlatt, ...typBlaetter].map(bl => ({
    name: _basisName(bl.name), versteckt: true,
    zeilen: bl.zeilen.map(z => z.map(c => c?.w ?? null)).filter(z => z.some(w => w != null)),
  }));
  const mappe = {
    titel: 'Energieplanung – Vollexport',
    blaetter: [ueBlatt, gebBlatt, assetsBlatt, kabelBlatt, massnBlatt, bezBlatt, ...typBlaetter, hinwBlatt, listenTab, ...basisBlaetter],
    namen,
  };
  const blob = await xlsxBlob(xlsxDateien(mappe), window.JSZip);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Vollexport_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Import ───────────────────────────────────────────────────────────────────
export function importVollstaendigXLSX() {
  let inp = document.getElementById('_xlsxImportInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = '_xlsxImportInput';
    inp.accept = '.xlsx';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', _handleXlsxImport);
  }
  inp.value = '';
  inp.click();
}

async function _handleXlsxImport(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (typeof window.JSZip !== 'function') { showHint('⚠ JSZip ist nicht geladen — bitte die Seite neu laden.', 6000); return; }
  try {
    const { blaetter } = await xlsxAusBlob(await file.arrayBuffer(), window.JSZip);
    const ctx = _importKontext();
    const ueVariante = (blaetter['Übersicht'] || []).find(r => xStr(r?.[0]) === 'Variante')?.[1];
    if (ueVariante != null && xStr(ueVariante) !== aktiverVariantenName())
      ctx.warnung = `Die Datei wurde in der Variante „${xStr(ueVariante)}" exportiert, aktiv ist „${aktiverVariantenName()}". Die Änderungen gehen in die aktive Variante.`;

    if (blaetter['Gebäude'])  _importGebaeude(blaetter['Gebäude'], ctx, _basis(blaetter, 'Gebäude', 'ID'));
    if (blaetter['Assets'])   _importAssetsBlatt(blaetter['Assets'], ctx, _basis(blaetter, 'Assets', 'ID'));
    for (const type of Object.keys(ASSET_PROPS_SCHEMA)) {
      const rows = blaetter[_typReiterName(type)];
      if (rows) _importTypReiter(type, rows, ctx, _basis(blaetter, _typReiterName(type), 'ID'));
    }
    if (blaetter['Kabel'])     _importKabel(blaetter['Kabel'], ctx, _basis(blaetter, 'Kabel', 'Kabel-ID'));
    if (blaetter['Maßnahmen']) _importMassnahmen(blaetter['Maßnahmen'], ctx, _basis(blaetter, 'Maßnahmen', 'Maßnahmen-ID'));
    _vorschauZeigen(ctx, file.name);
  } catch (err) {
    alert('Fehler beim Import: ' + err.message);
    console.error(err);
  }
}

/** Anzeige eines Werts in der Vorschau. */
function _anz(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return janein(v);
  // Tausenderpunkt erst ab fünf Stellen — sonst stünde da „1.975" statt des Baujahrs
  if (typeof v === 'number') return v.toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: Math.abs(v) >= 10000 });
  return String(v);
}

/**
 * Importkontext. Der Stand vor dem Import ist die Vergleichsbasis jeder Zelle —
 * auch wenn ein Wert auf mehreren Blättern steht (Assets + Typ-Reiter).
 */
function _importKontext() {
  const kopie = o => ({ ...o, props: o.props ? { ...o.props } : o.props, newProps: o.newProps ? { ...o.newProps } : o.newProps });
  const gebaeudeListe = window.gebaeude || [];
  const assets = ASSETS.items || [];
  const edges = window.stromEdges || [];
  const massn = new Map();
  for (const quelle of [...assets, ...edges, ...gebaeudeListe])
    for (const m of (quelle.massnahmen || [])) massn.set(m, kopie(m));
  const index = new Map();   // objKey|feld → Position in aenderungen
  return {
    origGeb:   new Map(gebaeudeListe.map(g => [g, kopie(g)])),
    origAsset: new Map(assets.map(a => [a, kopie(a)])),
    origEdge:  new Map(edges.map(e => [e, kopie(e)])),
    origMassn: massn,
    assetMap:  new Map(assets.map(a => [a.id, a])),
    aenderungen: [],
    neueMassnahmen: new Set(),
    hinweise: [],
    flags: { geb: false, assets: false, kabel: false, notstrom: false },
    warnung: '',
    melde(blattName, r, text) { this.hinweise.push(`${blattName}, Zeile ${r + 1}: ${text}`); },
    /**
     * Änderung vormerken. Steht dasselbe Feld auf zwei Blättern, gilt das spätere.
     * @param {{kat:string, objKey:string, objekt:string, feld:string, alt?:any, neu?:any, neuAnlage?:boolean, tun:()=>void}} a
     */
    plan(a) {
      const key = a.objKey + '|' + a.feld;
      if (!a.neuAnlage && index.has(key)) this.aenderungen[index.get(key)] = a;
      else { index.set(key, this.aenderungen.length); this.aenderungen.push(a); }
    },
  };
}

// ── Exportstand (Dreiwege-Abgleich) ──────────────────────────────────────────
// Der Export legt je importierbarem Blatt ein verstecktes Zwillingsblatt „_B_…"
// mit den exportierten Werten an. Übernommen wird dann nur, was in Excel
// geändert wurde — eine ältere Datei überschreibt keine Änderungen, die
// inzwischen im Tool gemacht oder neu berechnet wurden.

function _basisName(blatt) { return ('_B_' + blatt).slice(0, 31); }

/** Zeilen des Zwillingsblatts je ID (null, wenn die Datei keinen Exportstand hat). */
function _basis(blaetter, blatt, idSpalte) {
  const rows = blaetter[_basisName(blatt)];
  if (!rows || !rows.length) return null;
  const k = kopfIndex(rows[0]);
  const map = new Map();
  for (let r = 1; r < rows.length; r++) { const id = xStr(k.zelle(rows[r], idSpalte)); if (id) map.set(id, rows[r]); }
  return { k, map };
}

/** Sicht auf eine Zeile: „hat" nur für Spalten, die seit dem Export geändert wurden. */
function _zeilenSicht(k, row, basis, id) {
  const b = basis && id ? basis.map.get(String(id)) : null;
  if (!b) return k;
  return {
    hat: (...namen) => namen.some(n => k.hat(n) && zelleGeaendert(k.zelle(row, n), basis.k.zelle(b, n))),
    zelle: k.zelle,
  };
}

// ── Gebäude ──────────────────────────────────────────────────────────────────
function _importGebaeude(rows, ctx, basis) {
  const k = kopfIndex(rows[0]);
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const id = xInt(k.zelle(row, 'ID'));
    const g = (window.gebaeude || []).find(x => x.id === id);
    const o = g && ctx.origGeb.get(g);
    if (!g || !o) continue;
    const kr = _zeilenSicht(k, row, basis, id);
    const z = spalte => k.zelle(row, spalte);
    const meld = t => ctx.melde('Gebäude', r, t);
    const plan = (feld, alt, neu, tun) => ctx.plan({
      kat: 'Gebäude', objKey: 'g' + id, objekt: o.name || `Gebäude ${id}`, feld, alt: _anz(alt), neu: _anz(neu),
      tun: () => { tun(); ctx.flags.geb = true; },
    });

    // Zahlenfeld: nur bei Abweichung; leer → anwenden(null), wenn erlaubt
    const zahl = (spalte, alt, stellen, anwenden, { ganz = false, leerErlaubt = true, min = -Infinity, max = Infinity } = {}) => {
      if (!kr.hat(spalte)) return;
      const zelle = z(spalte);
      if (!zahlGeaendert(alt, zelle, stellen)) return;
      const v = ganz ? xInt(zelle) : xNum(zelle);
      if (v == null) {
        if (!istLeer(zelle)) { meld(`${spalte}: „${zelle}" ist keine Zahl`); return; }
        if (!leerErlaubt) return;
      } else if (v < min || v > max) { meld(`${spalte}: ${v} liegt außerhalb ${min}–${max}`); return; }
      plan(spalte, xNum(alt), v, () => anwenden(v));
    };
    // Auswahlfeld: leer → anwenden(null), wenn erlaubt
    const auswahl = (spalte, alt, werte, anwenden, { leerErlaubt = false } = {}) => {
      if (!kr.hat(spalte)) return;
      const s = xAuswahl(z(spalte), werte);
      if (s === undefined) { meld(`${spalte}: „${z(spalte)}" ist nicht erlaubt (${Object.values(werte).join(', ')})`); return; }
      if (s === null && !leerErlaubt) return;
      if ((s ?? '') === (alt ?? '')) return;
      plan(spalte, werte[alt] ?? alt, werte[s] ?? s, () => anwenden(s));
    };
    const feld = f => v => updateField(id, f, v == null ? '' : v, { defer: true });

    if (kr.hat('Name')) {
      const v = xStr(z('Name'));
      if (v && v !== xStr(o.name))
        plan('Name', o.name, v, () => { if (typeof window.renameGebaeude === 'function') window.renameGebaeude(id, v); else g.name = v; });
    }
    if (kr.hat('Gebäudenummer') && textGeaendert(o.gebaeudenummer, z('Gebäudenummer'))) {
      const nummer = xStr(z('Gebäudenummer'));
      plan('Gebäudenummer', o.gebaeudenummer, nummer, () => {
        if (typeof window.setGebaeudenummer === 'function') window.setGebaeudenummer(id, nummer); else g.gebaeudenummer = nummer;
      });
    }
    if (kr.hat('Nutzung')) {
      const v = xStr(z('Nutzung'));
      if (v && v !== xStr(o.nutzung)) plan('Nutzung', o.nutzung, v, () => feld('nutzung')(v));
    }
    // Über updateField wie im Gebäude-Panel: Jahre/Schicht wandern auf die Assets,
    // Fläche/Baujahr/Stockwerke lösen die Auto-Energie aus (sofern nicht manuell).
    zahl('Fläche (m²)', o.flaeche, 0, feld('flaeche'), { leerErlaubt: false, min: 0 });
    zahl('Stockwerke', o.stockwerke ?? 1, 0, feld('stockwerke'), { ganz: true, leerErlaubt: false, min: 1, max: 50 });
    zahl('Baujahr', o.baujahr, 0, feld('baujahr'), { ganz: true, min: 1800, max: 2100 });
    zahl('Abrissjahr', o.abrissjahr, 0, feld('abrissjahr'), { ganz: true, min: 1800, max: 2100 });
    auswahl('Schicht', normSchicht(o.schicht), _SCHICHT_WERTE, feld('schicht'));
    auswahl('Zustand', o.zustand, _ZUSTAND_WERTE, feld('zustand'), { leerErlaubt: true });

    // Spezifische Werte zuerst — ein ebenfalls geänderter Absolutwert gewinnt danach.
    zahl('Spez. Wärme (kWh/m²a)', o.spez, 1, feld('spez'), { leerErlaubt: false, min: 0 });
    zahl('Spez. Heizlast (W/m²)', o.spezHeizlast, 1, feld('spezHeizlast'), { leerErlaubt: false, min: 0 });
    zahl('Spez. Strom (kWh/m²a)', o.spezStrom, 1, feld('spezStrom'), { min: 0 });
    // Geleert = nicht mehr manuell → wieder automatisch berechnen
    const mitAuto = f => v => { feld(f)(v); if (v == null && calcAutoEnergy(g)) recalcNetz(); };
    zahl('Wärmebedarf (MWh/a)', o.waerme, 2, mitAuto('waerme'), { min: 0 });
    zahl('Heizlast (kW)', o.heizlast, 1, mitAuto('heizlast'), { min: 0 });
    zahl('Strom (MWh/a)', o.strom, 2, feld('strom'), { min: 0 });

    if (kr.hat('PV aktiv')) {
      const b = xBool(z('PV aktiv'));
      if (b == null && !istLeer(z('PV aktiv'))) meld(`PV aktiv: „${z('PV aktiv')}" ist kein ja/nein`);
      else if (b != null && b !== !!o.pvAktiv) plan('PV aktiv', !!o.pvAktiv, b, () => updateGebPv(id, 'pvAktiv', b));
    }
    zahl('PV Dachanteil (%)', o.pvDachanteil || 30, 0, v => updateGebPv(id, 'pvDachanteil', v), { leerErlaubt: false, min: 1, max: 100 });
    auswahl('PV-Modus', o.pvModus || 'flaechen', _PV_MODUS_WERTE, s => window.setGebPvModus?.(id, s));
    auswahl('PV-Ausrichtung', o.pvFlAusrichtung || 'sued', _PV_AUSRICHTUNG, s => window.updateGebPvFl?.(id, 'ausrichtung', s));
    zahl('PV-Belegung (%)', o.pvFlBelegung, 1, v => window.updateGebPvFl?.(id, 'belegung', v), { leerErlaubt: false, min: 0, max: 100 });
    zahl('PV-GCR (%)', o.pvFlGcr, 1, v => window.updateGebPvFl?.(id, 'gcr', v), { leerErlaubt: false, min: 0 });
    zahl('PV-Baujahr', o.pvBaujahr, 0, v => window.updateGebPvBaujahr?.(id, v ?? ''), { ganz: true, min: 1800, max: 2100 });
    auswahl('Dachform', o.dachform || 'sattel', _DACHFORM_WERTE, s => window.updateGebDach?.(id, 'dachform', s));
    zahl('Dachneigung (°)', o.dachNeigung, 1, v => window.updateGebDach?.(id, 'dachNeigung', v ?? ''), { min: 0, max: 90 });
    zahl('Dachazimut (°)', o.dachAzimut, 1, v => window.updateGebDach?.(id, 'dachAzimut', v ?? ''), { min: 0, max: 360 });

    // Notstrom (Blackout-Modus): Klasse, Lastanteil B, eigenes Aggregat bei A
    if (kr.hat('Notstromklasse', 'Notstrom Last B (%)', 'Notstrom eigenes NEA')) {
      const alt = normalisiereNotstrom(o.notstrom);
      let klasse = alt?.klasse || null, lastPct = alt?.lastPct ?? null, nea = !!alt?.eigeneNea, geaendert = false;
      if (kr.hat('Notstromklasse')) {
        const s = xAuswahl(z('Notstromklasse'), _NOTSTROM_WERTE);
        if (s === undefined) meld(`Notstromklasse: „${z('Notstromklasse')}" ist nicht erlaubt (A, B, C oder leer)`);
        else if (s !== klasse) { klasse = s; geaendert = true; }
      }
      if (kr.hat('Notstrom Last B (%)') && zahlGeaendert(lastPct, z('Notstrom Last B (%)'), 0)) { lastPct = xNum(z('Notstrom Last B (%)')); geaendert = true; }
      if (kr.hat('Notstrom eigenes NEA')) { const b = xBool(z('Notstrom eigenes NEA')); if (b != null && b !== nea) { nea = b; geaendert = true; } }
      if (geaendert) {
        const neu = klasse ? normalisiereNotstrom({ klasse, lastPct, eigeneNea: nea }) : null;
        const text = n => !n ? '' : n.klasse + (n.klasse === 'B' && n.lastPct != null ? ` (${n.lastPct} %)` : '') + (n.eigeneNea ? ' + eigenes NEA' : '');
        plan('Notstrom', text(alt), text(neu), () => {
          if (!neu) delete g.notstrom; else g.notstrom = neu;
          ctx.flags.notstrom = true;
        });
      }
    }
  }
}

// ── Assets (Blatt „Assets" + Typ-Reiter) ─────────────────────────────────────
function _assetPlan(ctx, a, o) {
  return (feld, alt, neu, tun) => ctx.plan({
    kat: 'Asset', objKey: 'a' + a.id, objekt: `${o.name || a.id} (${ASSET_LABELS[a.type] || a.type})`, feld, alt: _anz(alt), neu: _anz(neu),
    tun: () => { tun(); ctx.flags.assets = true; },
  });
}

function _assetBasisAbgleich(a, o, k, row, meld, plan) {
  if (k.hat('Name')) {
    const v = xStr(k.zelle(row, 'Name'));
    if (v && v !== xStr(o.name)) plan('Name', o.name, v, () => { a.name = v; });
  }
  for (const [spalte, feld] of [['Baujahr', 'baujahr'], ['Abrissjahr', 'abrissjahr']]) {
    if (!k.hat(spalte)) continue;
    const zelle = k.zelle(row, spalte);
    if (!zahlGeaendert(o[feld], zelle, 0)) continue;
    const v = xInt(zelle);
    if (v == null && !istLeer(zelle)) { meld(`${spalte}: „${zelle}" ist keine Jahreszahl`); continue; }
    plan(spalte, xInt(o[feld]), v, () => {
      a[feld] = v;
      // Von Hand gesetzt: das automatische Baujahr der Erzeuger-Kopplung (13p) fasst es nicht mehr an
      if (feld === 'baujahr' && a.linkedErzeuger) a.baujahrAuto = false;
    });
  }
  if (k.hat('Schicht')) {
    const s = xAuswahl(k.zelle(row, 'Schicht'), _SCHICHT_WERTE);
    if (s === undefined) meld(`Schicht: „${k.zelle(row, 'Schicht')}" ist nicht erlaubt (${Object.values(_SCHICHT_WERTE).join(', ')})`);
    else if (s && s !== normSchicht(o.schicht)) plan('Schicht', _SCHICHT_WERTE[normSchicht(o.schicht)], _SCHICHT_WERTE[s], () => { a.schicht = s; });
  }
}

function _importAssetsBlatt(rows, ctx, basis) {
  const k = kopfIndex(rows[0]);
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = xStr(k.zelle(row, 'ID'));
    if (!id) continue;
    const a = (ASSETS.items || []).find(x => String(x.id) === id);
    const o = a && ctx.origAsset.get(a);
    if (!o) continue;
    _assetBasisAbgleich(a, o, _zeilenSicht(k, row, basis, id), row, t => ctx.melde('Assets', r, t), _assetPlan(ctx, a, o));
  }
}

// Ohne Trennstelle ist auch kein Kabel der Station offen (wie im Inspektor, 13e).
// Station = MS-Betriebsmittel (NAP/Schaltanlage/Trafo) eines Gebäudes.
function _stationsTrennstellenAufheben(asset) {
  const ms = new Set(['NAP', 'Schaltanlage', 'Trafo']);
  const station = a => (a?.buildingId != null ? 'g' + a.buildingId : 'a' + a?.id);
  const meine = station(asset);
  const byId = new Map((ASSETS.items || []).map(a => [String(a.id), a]));
  for (const e of (window.stromEdges || [])) {
    const a = byId.get(String(e.u)), b = byId.get(String(e.v));
    if (!a || !b || !ms.has(a.type) || !ms.has(b.type)) continue;
    const sa = station(a), sb = station(b);
    if (sa !== sb && (sa === meine || sb === meine)) e.trennstelle = false;
  }
}

function _importTypReiter(type, rows, ctx, basis) {
  if (rows.length < 2) return;
  const blattName = _typReiterName(type);
  const k = kopfIndex(rows[0]);
  const defs = _xlsxPropDefs(type).filter(d => d.art !== 'berechnet' && k.hat(d.label));
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = xStr(k.zelle(row, 'ID'));
    if (!id) continue;
    const a = (ASSETS.items || []).find(x => String(x.id) === id && x.type === type);
    const o = a && ctx.origAsset.get(a);
    if (!o) continue;
    const meld = t => ctx.melde(blattName, r, t);
    const plan = _assetPlan(ctx, a, o);
    const kr = _zeilenSicht(k, row, basis, id);
    _assetBasisAbgleich(a, o, kr, row, meld, plan);
    for (const d of defs) {
      if (!kr.hat(d.label)) continue;
      const res = zelleZuProp(d, k.zelle(row, d.label));
      if (!res.ok) { meld(`${d.label}: ${res.fehler}`); continue; }
      const alt = o.props?.[d.key];
      if (!propGeaendert(d, alt, res.wert)) continue;
      plan(d.label, propZuZelle(d, alt), propZuZelle(d, res.wert), () => {
        if (!a.props) a.props = {};
        a.props[d.key] = res.wert;
        if (type === 'PV') a._pvProfile = null;   // Profil-Cache (wie im Inspektor)
        if (type === 'Schaltanlage' && d.key === 'trennstelle' && !res.wert) { _stationsTrennstellenAufheben(a); ctx.flags.kabel = true; }
      });
    }
  }
}

// ── Kabel ────────────────────────────────────────────────────────────────────

/** Asset/Netzknoten über ID oder (eindeutigen) Namen finden. */
function _knotenFinden(id, name) {
  const assets = ASSETS.items || [], knoten = window.stromNodes || [];
  if (id) {
    const t = assets.find(a => String(a.id) === id) || knoten.find(n => String(n.id) === id);
    return t ? { id: t.id, name: t.name || t.label || id } : { fehler: `„${id}" nicht gefunden` };
  }
  const lc = name.toLowerCase();
  const treffer = [
    ...assets.filter(a => (a.name || '').trim().toLowerCase() === lc).map(a => ({ id: a.id, name: a.name })),
    ...knoten.filter(n => !assets.some(a => a.id === n.id) && (n.label || n.name || '').trim().toLowerCase() === lc).map(n => ({ id: n.id, name: n.label || n.name })),
  ];
  if (!treffer.length) return { fehler: `„${name}" nicht gefunden` };
  if (treffer.length > 1) return { fehler: `„${name}" ist mehrdeutig (${treffer.length}×) — bitte die ID eintragen` };
  return treffer[0];
}

function _importKabel(rows, ctx, basis) {
  const k = kopfIndex(rows[0]);
  const edgeArr = window.stromEdges || [];
  const mitId = k.hat('Kabel-ID');
  const neuePaare = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const z = spalte => k.zelle(row, spalte);
    const meld = t => ctx.melde('Kabel', r, t);
    const kid = xStr(z('Kabel-ID'));

    // Neue Zeile (aktuelles Format, ohne Kabel-ID) → neues Kabel
    if (mitId && !kid) { _kabelNeu(row, k, r, ctx, neuePaare); continue; }

    // Zuordnung über die Kabel-ID; ältere Exporte ohne ID über Von-/Nach-ID
    let edge = null;
    if (kid) edge = edgeArr.find(e => String(e.id) === kid);
    else {
      const uId = xStr(z('Von-ID')), vId = xStr(z('Nach-ID'));
      if (!uId || !vId) continue;
      edge = edgeArr.find(e => String(e.u) === uId && String(e.v) === vId)
          || edgeArr.find(e => String(e.u) === vId && String(e.v) === uId);
    }
    if (!edge) { if (kid) meld(`Kabel „${kid}" nicht gefunden`); continue; }
    const o = ctx.origEdge.get(edge);
    if (!o) continue;
    const kr = _zeilenSicht(k, row, basis, kid);
    const plan = (feld, alt, neu, tun) => ctx.plan({
      kat: 'Kabel', objKey: 'k' + (edge.id ?? `${edge.u}-${edge.v}`), objekt: _kabelLabel(edge, ctx.assetMap), feld, alt: _anz(alt), neu: _anz(neu),
      tun: () => { tun(); ctx.flags.kabel = true; },
    });

    if (kr.hat('Typ') && !istLeer(z('Typ')) && textGeaendert(o.cableType || 'NAYY', z('Typ'))) {
      const typ = parseKabelLabel(z('Typ'))?.cableType;
      if (!typ || !KABEL_TYPEN[typ]) meld(`Typ: „${z('Typ')}" ist kein bekannter Kabeltyp`);
      else if (typ !== (o.cableType || 'NAYY')) plan('Typ', o.cableType || 'NAYY', typ, () => { edge.cableType = typ; edge.qsGeschaetzt = false; });
    }
    if (kr.hat('Auto-Bemessung')) {
      const b = xBool(z('Auto-Bemessung'));
      if (b != null && b !== !!o.autoSized) plan('Auto-Bemessung', !!o.autoSized, b, () => {
        edge.autoSized = b;
        if (b) edge.crossSection = 0;
        edge.qsGeschaetzt = false;
      });
    }
    // Ein geänderter Querschnitt ist eine feste Vorgabe → Auto-Bemessung aus
    if (kr.hat('Querschnitt mm²') && !istLeer(z('Querschnitt mm²')) && zahlGeaendert(o.crossSection, z('Querschnitt mm²'), 1)) {
      const qs = xNum(z('Querschnitt mm²'));
      if (qs == null || qs <= 0) meld(`Querschnitt: „${z('Querschnitt mm²')}" ist kein gültiger Querschnitt`);
      else plan('Querschnitt mm²', o.crossSection || null, qs, () => {
        edge.crossSection = qs; edge.autoSized = false;
        edge.qsGeschaetzt = false;   // von Hand ausgelegt ist nicht mehr geschätzt (wie im Kabel-Inspektor, 05b)
      });
    }
    if (kr.hat('Parallelkabel') && !istLeer(z('Parallelkabel')) && zahlGeaendert(o.nParallel || 1, z('Parallelkabel'), 0)) {
      const np = xInt(z('Parallelkabel'));
      if (np == null) meld(`Parallelkabel: „${z('Parallelkabel')}" ist keine Zahl`);
      else plan('Parallelkabel', o.nParallel || 1, Math.max(1, np), () => { edge.nParallel = Math.max(1, np); });
    }
    if (kr.hat('Sicherung A') && zahlGeaendert(o.fuseA || null, z('Sicherung A'), 0)) {
      const f = xNum(z('Sicherung A'));
      if (f == null && !istLeer(z('Sicherung A'))) meld(`Sicherung: „${z('Sicherung A')}" ist keine Zahl`);
      else plan('Sicherung A', o.fuseA || null, f, () => { edge.fuseA = f ?? 0; });
    }
    if (kr.hat('Trennstelle')) {
      const b = xBool(z('Trennstelle'));
      if (b != null && b !== !!o.trennstelle) plan('Trennstelle', !!o.trennstelle, b, () => { edge.trennstelle = b; });
    }
  }
}

// Neues Kabel aus einer Zeile ohne Kabel-ID — wie das Ziehen im Tool über addStromEdge
// (Trassen-Routing und Länge), danach Typ/Querschnitt wie im Kabel-Inspektor.
function _kabelNeu(row, k, r, ctx, neuePaare) {
  const z = spalte => k.zelle(row, spalte);
  const meld = t => ctx.melde('Kabel', r, t);
  const uId = xStr(z('Von-ID')), vId = xStr(z('Nach-ID'));
  const uName = xStr(z('Von')), vName = xStr(z('Nach'));
  if (!uId && !vId && !uName && !vName) return;   // Leerzeile
  if ((!uId && !uName) || (!vId && !vName)) { meld('neues Kabel braucht „Von" und „Nach"'); return; }
  const u = _knotenFinden(uId, uName), v = _knotenFinden(vId, vName);
  if (u.fehler || v.fehler) { meld(`neues Kabel: ${[u.fehler, v.fehler].filter(Boolean).join(', ')}`); return; }
  if (u.id === v.id) { meld('neues Kabel: „Von" und „Nach" sind dasselbe Objekt'); return; }
  const paar = [u.id, v.id].map(String).sort().join('|');
  const gibts = (window.stromEdges || []).some(e => [e.u, e.v].map(String).sort().join('|') === paar);
  if (gibts || neuePaare.has(paar)) { meld(`Kabel ${u.name} → ${v.name} gibt es schon`); return; }

  let typ = null;
  if (!istLeer(z('Typ'))) {
    typ = parseKabelLabel(z('Typ'))?.cableType;
    if (!typ || !KABEL_TYPEN[typ]) { meld(`Typ: „${z('Typ')}" ist kein bekannter Kabeltyp`); return; }
  }
  const qs = xNum(z('Querschnitt mm²'));
  if (qs != null && qs <= 0) { meld(`Querschnitt: „${z('Querschnitt mm²')}" ist kein gültiger Querschnitt`); return; }
  const auto = xBool(z('Auto-Bemessung'));
  const np = xInt(z('Parallelkabel'));
  const fuse = xNum(z('Sicherung A'));
  const ts = xBool(z('Trennstelle'));
  neuePaare.add(paar);

  const fest = qs != null && auto !== true;
  ctx.plan({
    kat: 'Kabel', objKey: 'neuK' + r, objekt: `${u.name} → ${v.name}`, feld: 'neu angelegt', alt: '',
    neu: `${typ || 'Standardtyp'} · ${fest ? qs + ' mm²' : 'automatisch ausgelegt'}${np > 1 ? ` · ${np}×` : ''}`,
    neuAnlage: true,
    tun: () => {
      const edge = window.addStromEdge?.(u.id, v.id);
      if (!edge) throw new Error(`Kabel ${u.name} → ${v.name} konnte nicht angelegt werden.`);
      if (typ) edge.cableType = typ;
      edge.autoSized = !fest;
      edge.crossSection = fest ? qs : 0;
      if (np != null) edge.nParallel = Math.max(1, np);
      if (fuse != null) edge.fuseA = fuse;
      if (ts != null) edge.trennstelle = ts;
      ctx.flags.kabel = true;
    },
  });
}

// ── Maßnahmen ────────────────────────────────────────────────────────────────
function _importMassnahmen(rows, ctx, basis) {
  const k = kopfIndex(rows[0]);
  const assets = ASSETS.items || [];
  const edges = window.stromEdges || [];
  const index = new Map(_alleMassnahmen(assets, edges, window.gebaeude || [], ctx.assetMap).map(x => [String(x.m.id), x]));
  const varListe = _variantenListe();
  const neuesFormat = k.hat('Maßnahmen-ID');

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const z = spalte => k.zelle(row, spalte);
    const meld = t => ctx.melde('Maßnahmen', r, t);

    // Älterer Export ohne Maßnahmen-ID: Zuordnung über Asset + Titel + Jahr, nur Status/Kosten
    if (!neuesFormat) {
      const assetId = xStr(z('Asset-ID'));
      const a = assets.find(x => String(x.id) === assetId);
      if (!a) continue;
      const titel = xStr(z('Titel')), jahr = xStr(z('Jahr'));
      const m = (a.massnahmen || []).find(x => xStr(x.titel) === titel && xStr(x.jahr) === jahr);
      const o = m && ctx.origMassn.get(m);
      if (!o) continue;
      const plan = _massnPlan(ctx, { m, art: 'Asset', obj: a, objName: a.name || a.id });
      const s = xAuswahl(z('Status'), _MASSN_STATUS_WERTE);
      if (s === undefined) meld(`Status: „${z('Status')}" ist nicht erlaubt`);
      else if (s && s !== (o.status || 'geplant')) plan('Status', o.status || 'geplant', s, () => { m.status = s; });
      if (!istLeer(z('Kosten €')) && zahlGeaendert(xNum(o.kosten) ?? 0, z('Kosten €'), 2)) {
        const kosten = xNum(z('Kosten €')) ?? 0;
        plan('Kosten €', xNum(o.kosten) ?? 0, kosten, () => { m.kosten = kosten; });
      }
      continue;
    }

    const mid = xStr(z('Maßnahmen-ID'));
    if (!mid) { _massnahmeNeu(row, k, r, ctx, varListe); continue; }
    const x = index.get(mid);
    const o = x && ctx.origMassn.get(x.m);
    if (!o) { meld(`Maßnahme „${mid}" nicht gefunden`); continue; }
    const m = x.m;
    const plan = _massnPlan(ctx, x);
    const kr = _zeilenSicht(k, row, basis, mid);

    const titel = xStr(z('Titel'));
    if (kr.hat('Titel') && titel && titel !== xStr(o.titel)) plan('Titel', o.titel, titel, () => { m.titel = titel; });
    if (kr.hat('Jahr') && zahlGeaendert(o.jahr, z('Jahr'), 0)) {
      const j = xInt(z('Jahr'));
      if (j == null && !istLeer(z('Jahr'))) meld(`Jahr: „${z('Jahr')}" ist keine Jahreszahl`);
      else plan('Jahr', xInt(o.jahr), j, () => { m.jahr = j; });
    }
    if (kr.hat('Kosten €') && zahlGeaendert(xNum(o.kosten) ?? 0, xNum(z('Kosten €')) ?? 0, 2)) {
      const kosten = xNum(z('Kosten €'));
      if (kosten == null && !istLeer(z('Kosten €'))) meld(`Kosten: „${z('Kosten €')}" ist keine Zahl`);
      else plan('Kosten €', xNum(o.kosten) ?? 0, kosten ?? 0, () => { m.kosten = kosten ?? 0; });
    }
    if (kr.hat('Status')) {
      const s = xAuswahl(z('Status'), _MASSN_STATUS_WERTE);
      if (s === undefined) meld(`Status: „${z('Status')}" ist nicht erlaubt (${Object.values(_MASSN_STATUS_WERTE).join(', ')})`);
      else if (s && s !== (o.status || 'geplant')) plan('Status', o.status || 'geplant', s, () => { m.status = s; });
    }
    if (kr.hat('Maßnahmentyp')) {
      const werte = _MASSN_TYP_WERTE[x.art];
      const zelle = z('Maßnahmentyp');
      const s = werte ? xAuswahl(zelle, werte) : undefined;
      if (s === undefined) {
        if (textGeaendert(o.typ, zelle) && textGeaendert(werte?.[o.typ], zelle))
          meld(werte ? `Maßnahmentyp: „${zelle}" ist nicht erlaubt (${Object.values(werte).join(', ')})`
                     : 'Maßnahmentyp von Gebäude-Maßnahmen ist im Excel nicht änderbar');
      } else if (s && s !== o.typ) plan('Maßnahmentyp', werte[o.typ] ?? o.typ, werte[s], () => { m.typ = s; });
    }
    if (kr.hat('Gilt für')) {
      const res = geltungLesen(z('Gilt für'), varListe);
      if (res.fehler) meld(`Gilt für: ${res.fehler}`);
      else if (res.aendern && !('variante' in o && o.variante === res.wert))
        plan('Gilt für', geltungText(o, variantenName), res.wert === null ? GILT_ALLE : variantenName(res.wert), () => { m.variante = res.wert; });
    }
    if (kr.hat('Ziel-Parameter')) {
      const { props, unbekannt } = zielParameterLesen(z('Ziel-Parameter'), x.zielDefs, Object.keys(o.newProps || {}));
      if (unbekannt.length) meld(`Ziel-Parameter: unbekannt ${unbekannt.map(u => `„${u}"`).join(', ')}`);
      else if (!zielParameterGleich(props, o.newProps))
        plan('Ziel-Parameter', zielParameterText(o.newProps, x.zielDefs), zielParameterText(props, x.zielDefs), () => { m.newProps = props; });
    }
  }
}

function _massnPlan(ctx, x) {
  return (feld, alt, neu, tun) => ctx.plan({
    kat: 'Maßnahme', objKey: 'm' + x.m.id, objekt: `${x.objName} · ${x.m.titel || '—'}`, feld, alt: _anz(alt), neu: _anz(neu),
    tun: () => { tun(); if (x.art === 'Kabel') ctx.flags.kabel = true; else ctx.flags.assets = true; },
  });
}

// Neue Maßnahme aus einer Zeile ohne Maßnahmen-ID — Felder wie in den Inspektor-Formularen.
// Das Objekt kommt aus Objekt-ID oder Objekt-Name (Asset-Name bzw. „Von → Nach" eines Kabels).
function _massnahmeNeu(row, k, r, ctx, varListe) {
  const z = spalte => k.zelle(row, spalte);
  const meld = t => ctx.melde('Maßnahmen', r, t);
  const artZelle = z('Objekt');
  let art = xAuswahl(artZelle, _MASSN_OBJEKT_WERTE);
  const oid = xStr(z('Objekt-ID')), oname = xStr(z('Objekt-Name')), titel = xStr(z('Titel'));
  if (!oid && !oname && !titel) return;   // Leerzeile
  if (art === undefined) { meld(`Objekt: „${artZelle}" ist nicht erlaubt (Asset, Kabel)`); return; }
  if (art === 'Gebaeude') { meld('Gebäude-Maßnahmen entstehen über Cluster-Pakete und sind im Excel nicht anlegbar'); return; }
  if (!titel) { meld('neue Maßnahme braucht einen Titel'); return; }
  if (!oid && !oname) { meld('neue Maßnahme braucht ein Objekt (Objekt-Name aus der Liste wählen)'); return; }

  const assets = ASSETS.items || [], edges = window.stromEdges || [];
  let obj = null;
  if (oid) {
    if (art !== 'Kabel') { obj = assets.find(a => String(a.id) === oid); if (obj) art = 'Asset'; }
    if (!obj && art !== 'Asset') { obj = edges.find(e => String(e.id) === oid); if (obj) art = 'Kabel'; }
  } else {
    const lc = oname.toLowerCase();
    const treffer = [
      ...(art !== 'Kabel' ? assets.filter(a => (a.name || String(a.id)).trim().toLowerCase() === lc).map(o => ({ o, art: 'Asset' })) : []),
      ...(art !== 'Asset' ? edges.filter(e => _kabelLabel(e, ctx.assetMap).toLowerCase() === lc).map(o => ({ o, art: 'Kabel' })) : []),
    ];
    if (treffer.length > 1) { meld(`Objekt „${oname}" ist mehrdeutig (${treffer.length}×) — bitte die Objekt-ID eintragen`); return; }
    if (treffer.length) ({ o: obj, art } = treffer[0]);
  }
  if (!obj) { meld(`Objekt „${oid || oname}" nicht gefunden`); return; }

  const werte = _MASSN_TYP_WERTE[art];
  const typ = xAuswahl(z('Maßnahmentyp'), werte);
  if (typ === undefined) { meld(`Maßnahmentyp: „${z('Maßnahmentyp')}" ist für ${art === 'Asset' ? 'Assets' : 'Kabel'} nicht erlaubt (${Object.values(werte).join(', ')})`); return; }
  const status = xAuswahl(z('Status'), _MASSN_STATUS_WERTE);
  if (status === undefined) { meld(`Status: „${z('Status')}" ist nicht erlaubt`); return; }
  const zielDefs = art === 'Asset' ? (ASSET_PROPS_SCHEMA[obj.type] || []) : _KABEL_ZIEL_DEFS;
  const { props, unbekannt } = zielParameterLesen(z('Ziel-Parameter'), zielDefs);
  if (unbekannt.length) { meld(`Ziel-Parameter: unbekannt ${unbekannt.map(u => `„${u}"`).join(', ')}`); return; }
  const gilt = geltungLesen(z('Gilt für'), varListe);
  if (gilt.fehler) { meld(`Gilt für: ${gilt.fehler}`); return; }
  const jahr = xInt(z('Jahr')), kosten = xNum(z('Kosten €')) ?? 0;
  const typWert = typ || Object.keys(werte)[0];
  const objName = art === 'Asset' ? (obj.name || obj.id) : _kabelLabel(obj, ctx.assetMap);
  // Dieselbe Datei zweimal eingelesen? Gleiches Objekt + Titel + Jahr gilt als vorhanden.
  const schluessel = `${art}|${obj.id}|${titel.toLowerCase()}|${jahr ?? ''}`;
  const vorhanden = (obj.massnahmen || []).some(m => xStr(m.titel).toLowerCase() === titel.toLowerCase() && (xInt(m.jahr) ?? '') === (jahr ?? ''));
  if (vorhanden || ctx.neueMassnahmen.has(schluessel)) { meld(`Maßnahme „${titel}" an ${objName} gibt es schon`); return; }
  ctx.neueMassnahmen.add(schluessel);

  ctx.plan({
    kat: 'Maßnahme', objKey: 'neuM' + r, objekt: `${objName} · ${titel}`, feld: 'neu angelegt', alt: '',
    neu: [werte[typWert], jahr, kosten ? _anz(kosten) + ' €' : ''].filter(Boolean).join(' · '),
    neuAnlage: true,
    tun: () => {
      const m = {
        id: createId(art === 'Asset' ? 'm' : 'cm'),
        titel, jahr, kosten, typ: typWert, status: status || 'geplant',
      };
      if (Object.keys(props).length) m.newProps = props;
      if (art === 'Asset') {
        m.newProps = m.newProps || {};
        m.dependsOn = [];
        m.phaseId = null;
        // Ohne Angabe: dieselbe Vorbelegung wie im Formular (Standardregel nach Schicht/Typ)
        if (gilt.aendern) m.variante = gilt.wert;
        else if (typeof window.massnahmeGeltungWert === 'function') m.variante = window.massnahmeGeltungWert({ typ: m.typ }, obj) || null;
        ctx.flags.assets = true;
      } else {
        if (gilt.aendern) m.variante = gilt.wert;
        ctx.flags.kabel = true;
      }
      if (!obj.massnahmen) obj.massnahmen = [];
      obj.massnahmen.push(m);
    },
  });
}

// ── Vorschau und Übernahme ───────────────────────────────────────────────────

const _KAT_REIHE = ['Gebäude', 'Asset', 'Kabel', 'Maßnahme'];
const _KAT_MEHRZAHL = { Gebäude: 'Gebäude', Asset: 'Assets', Kabel: 'Kabel', Maßnahme: 'Maßnahmen' };

/** „2 Gebäude, 3 Assets geändert · 1 Kabel neu" */
function _zusammenfassung(aenderungen) {
  const geaendert = {}, neu = {};
  for (const a of aenderungen) {
    const ziel = a.neuAnlage ? neu : geaendert;
    (ziel[a.kat] ||= new Set()).add(a.objKey);
  }
  const teil = (m, suffix) => {
    const s = _KAT_REIHE.filter(kat => m[kat]).map(kat => `${m[kat].size} ${_KAT_MEHRZAHL[kat]}`).join(', ');
    return s ? `${s} ${suffix}` : '';
  };
  return [teil(geaendert, 'geändert'), teil(neu, 'neu')].filter(Boolean).join(' · ');
}

function _vorschauZeigen(ctx, dateiname) {
  document.querySelector('.xl-vorschau-bg')?.remove();
  const n = ctx.aenderungen.length;
  const esc = escHtml;
  const MAX = 400;
  const zeilen = [];
  for (const kat of _KAT_REIHE) {
    const liste = ctx.aenderungen.filter(a => a.kat === kat);
    if (!liste.length) continue;
    zeilen.push(`<tr><th colspan="4" style="text-align:left;padding:8px 4px 3px;color:var(--accent,#4fc3f7);font-size:11px;">${esc(_KAT_MEHRZAHL[kat])}</th></tr>`);
    let letztes = null;
    for (const a of liste) {
      if (zeilen.length > MAX) break;
      const obj = a.objKey === letztes ? '' : esc(a.objekt);
      letztes = a.objKey;
      zeilen.push(`<tr style="border-top:1px solid var(--border);">
        <td style="padding:3px 4px;vertical-align:top;">${obj}</td>
        <td style="padding:3px 4px;vertical-align:top;color:var(--muted);">${esc(a.feld)}</td>
        <td style="padding:3px 4px;vertical-align:top;color:var(--muted);">${a.neuAnlage ? '' : esc(a.alt)}</td>
        <td style="padding:3px 4px;vertical-align:top;font-weight:600;color:${a.neuAnlage ? '#66bb6a' : 'var(--text)'};">${a.neuAnlage ? '＋ ' : ''}${esc(a.neu)}</td>
      </tr>`);
    }
  }
  const abgeschnitten = zeilen.length > MAX ? `<div class="hinweis">… und weitere — die Liste ist auf ${MAX} Zeilen gekürzt.</div>` : '';
  const hinweise = ctx.hinweise.length ? `
    <details${n ? '' : ' open'} style="margin-top:4px;"><summary style="cursor:pointer;color:#f9a825;">⚠ ${ctx.hinweise.length} Zelle(n) werden nicht übernommen</summary>
      <ul style="margin:6px 0 0 16px;padding:0;color:var(--muted);">${ctx.hinweise.slice(0, 200).map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      ${ctx.hinweise.length > 200 ? `<div class="hinweis">(+${ctx.hinweise.length - 200} weitere)</div>` : ''}
    </details>` : '';

  const bg = document.createElement('div');
  bg.className = 'var-dialog-bg xl-vorschau-bg';
  bg.innerHTML = `<div class="var-dialog" role="dialog" aria-modal="true" aria-labelledby="xl-titel" style="width:min(900px,100%);">
    <header><b id="xl-titel">Excel-Import – Vorschau</b>
      <div class="hinweis" style="margin-top:4px;">${esc(dateiname)} · ${n ? `${n} Änderung(en): ${esc(_zusammenfassung(ctx.aenderungen))}` : 'keine Änderungen gegenüber dem Stand im Tool'}</div></header>
    <div class="body">
      ${ctx.warnung ? `<div style="padding:6px 8px;border-left:3px solid #f9a825;background:rgba(249,168,37,.1);">${esc(ctx.warnung)}</div>` : ''}
      ${n ? `<div style="max-height:52vh;overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:3px 4px;">Objekt</th><th style="padding:3px 4px;">Feld</th><th style="padding:3px 4px;">bisher</th><th style="padding:3px 4px;">neu</th></tr></thead>
        <tbody>${zeilen.join('')}</tbody></table>${abgeschnitten}</div>` : ''}
      ${hinweise}
    </div>
    <footer>
      <button class="btn-secondary" id="xl-abbrechen">${n ? 'Abbrechen' : 'Schließen'}</button>
      ${n ? `<button class="btn-confirm" id="xl-ok">${n} Änderung(en) übernehmen</button>` : ''}
    </footer>
  </div>`;
  document.body.appendChild(bg);
  const zu = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg) zu(); });
  bg.querySelector('#xl-abbrechen').addEventListener('click', zu);
  bg.querySelector('#xl-ok')?.addEventListener('click', () => {
    zu();
    try {
      _uebernehmen(ctx);
      showHint(`Excel-Import übernommen: ${_zusammenfassung(ctx.aenderungen)}.`, 5000);
    } catch (err) {
      alert('Fehler beim Übernehmen: ' + err.message);
      console.error(err);
    }
  });
}

function _uebernehmen(ctx) {
  const mutate = () => { for (const a of ctx.aenderungen) a.tun(); };
  // Planungstransaktion: Rückgängig für Assets, Kabel und Maßnahmen; bei einem Fehler rollt sie zurück.
  if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction('Excel-Import', mutate);
  else mutate();

  const f = ctx.flags;
  if (f.geb) {
    renderList();
    updateTotals();
    updateVizDebounced();
    recalcNetz();
  }
  if (f.notstrom && window.blackoutModusAktiv) window.blackoutModusMarkiereKarte?.();
  if (f.assets) {
    window.redrawAllAssets?.();
    renderSidebarAssetList?.();
  }
  if (f.kabel || f.assets) {
    window.recalcStromNetz?.();
    window.sldRefresh?.();
  }
  window.glBerechnen?.();
}
