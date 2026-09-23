// ── lib/resilienz-abfrage.js — Abfragedatei für Resilienzanforderungen ──────
//
// Ableitungskette: Auftrag → kritische Funktionen → Referenzszenarien →
// messbare Anforderungen → Maßnahmen. Dieses Modul deckt die ersten drei
// Glieder ab: Es erzeugt eine Abfragedatei (.xlsx) für die zuständige Stelle
// bzw. den Bedarfsträger und übersetzt die ausgefüllte Datei in strukturierte
// Anforderungen.
//
// Zuständigkeit: Laut Erlass liegt die Resilienz nicht bei unserer Stelle.
// Die Abfrage erhebt Eingangsgrößen für das Energiekonzept — sie legt nichts
// fest. Jede Angabe trägt darum eine Herkunft (vorgegeben / Einschätzung
// Nutzer / unbekannt), und die Klasse ist ausdrücklich nur ein Vorschlag.
//
// Gefragt wird nach den Auswirkungen eines Ausfalls (Business-Impact-Analyse
// nach BSI-Standard 200-4), nicht nach Resilienzklassen. Die Zuordnung zur
// Klasse macht dieses Modul beim Einlesen.
//
// Hier wird nichts gerechnet und nichts simuliert. Die Ergebnisse liegen im
// Exportschema (raExportJson), damit Autarkie-Nachweis und n-1-Check später
// darauf aufsetzen können.
//
// DOM- und importfrei bis auf lib/xlsx-schreiber.js → unit-testbar.

import { XS, spalteZuBuchstabe } from './xlsx-schreiber.js';

// Version 2: Blatt „3 Kategorien" und Spalte „Kategorie" auf den Funktionen,
// Blatt „Beispiel". Dateien der Version 1 werden weiter gelesen (Spalten werden
// über ihren Titel gefunden, nicht über die Position).
export const RA_VERSION = 2;
export const RA_KENNUNG = `MMH-RESILIENZ-ABFRAGE v${RA_VERSION}`;
/** Versionen, deren Dateien ohne Hinweis gelesen werden. */
export const RA_VERSIONEN_LESBAR = Object.freeze([1, 2]);

export const RA_BLATT = Object.freeze({
  anleitung:   '0 Anleitung',
  beispiel:    'Beispiel (ausgefüllt)',
  allgemeines: '1 Allgemeines',
  szenarien:   '2 Szenarien',
  kategorien:  '3 Kategorien',
  funktionen:  '4 Funktionen',
  bestand:     '5 Bestand und Organisation',
  rueckmeldung:'6 Rückmeldung',
  listen:      'Listen',
});

/** Zelle mit der Versionskennung auf Blatt „0 Anleitung" (Spalte C ist ausgeblendet). */
export const RA_KENNUNG_ZELLE = Object.freeze({ zeile: 0, spalte: 2 });

// ── Referenzszenarien ───────────────────────────────────────────────────────
export const RA_SZENARIEN = Object.freeze([
  Object.freeze({ id: 'S1', name: 'Kurzzeitiger Netzausfall (≤ 4 h)' }),
  Object.freeze({ id: 'S2', name: 'Langanhaltender Netzausfall / Blackout (bis 14 Tage)' }),
  Object.freeze({ id: 'S3', name: 'Gestörte Brennstofflogistik (keine Nachlieferung)' }),
  Object.freeze({ id: 'S4', name: 'Ausfall einer Einzelkomponente im Liegenschaftsnetz (n-1)' }),
  Object.freeze({ id: 'S5', name: 'Physische Einwirkung / Sabotage an Übergabe- oder Trafostation' }),
  Object.freeze({ id: 'S6', name: 'Cyberangriff auf Leit-, Fernwirk- oder EMS-Technik' }),
  Object.freeze({ id: 'S7', name: 'Extremwetter / Hochwasser / Brand' }),
]);
export const RA_SZENARIO_IDS = Object.freeze(RA_SZENARIEN.map(s => s.id));

// ── Auswahllisten (Datenüberprüfung) ────────────────────────────────────────
// „unbekannt" steht überall zur Wahl: eine ehrliche Lücke ist mehr wert als
// eine erfundene Angabe.
export const RA_LISTEN = Object.freeze({
  L_JaNein:     Object.freeze(['ja', 'nein', 'unbekannt']),
  L_Relevant:   Object.freeze(['ja', 'nein', 'unbekannt']),
  L_Betrieb:    Object.freeze(['24/7', 'Dienstzeit', 'zeitweise', 'unbekannt']),
  L_Auswirkung: Object.freeze(['Auftrag gefährdet', 'eingeschränkt', 'keine', 'unbekannt']),
  L_Autarkie:   Object.freeze(['keine', '1 Tag', '3 Tage', '7 Tage', '14 Tage', 'länger', 'unbekannt']),
  L_Kreuz:      Object.freeze(['x', '—']),
  L_Leistung:   Object.freeze(['gemessen', 'geschätzt', 'unbekannt']),
  L_Ersatz:     Object.freeze(['keine', 'USV', 'NEA', 'USV+NEA', 'mobil', 'unbekannt']),
  L_Herkunft:   Object.freeze(['vorgegeben', 'Einschätzung Nutzer', 'unbekannt']),
});

// ── Spalten des Kernblatts „3 Funktionen" ───────────────────────────────────
// feld = Schlüssel im Exportschema; liste = Auswahlliste; art: 'text'|'zahl'
const _SP = (feld, titel, opt = {}) => Object.freeze({ feld, titel, ...opt });
export const RA_FUNKTION_SPALTEN = Object.freeze([
  _SP('id',        'ID',                          { breite: 7,  hinweis: 'Laufende Nummer, bleibt beim Einlesen erhalten' }),
  _SP('name',      'Funktion',                    { breite: 26, hinweis: 'Was leistet die Funktion? Nicht die Anlage, sondern die Aufgabe' }),
  _SP('geb',       'Gebäude / Verbraucher',       { breite: 22 }),
  _SP('kategorie', 'Kategorie',                   { breite: 18, liste: 'L_Kategorie', seit: 2,
    hinweis: 'Kategorie von Blatt „3 Kategorien" wählen — leere Zellen dieser Zeile übernehmen dann deren Angaben' }),
  _SP('betrieb',   'Betriebszeit',                { breite: 12, liste: 'L_Betrieb' }),
  _SP('ausw_s',    'Auswirkung bei Ausfall nach Sekunden', { breite: 17, liste: 'L_Auswirkung' }),
  _SP('ausw_4h',   'Auswirkung bei Ausfall nach 4 Stunden', { breite: 17, liste: 'L_Auswirkung' }),
  _SP('ausw_3d',   'Auswirkung bei Ausfall nach 3 Tagen',   { breite: 17, liste: 'L_Auswirkung' }),
  _SP('autarkie',  'Wie lange muss die Funktion ohne Netz weiterlaufen?', { breite: 15, liste: 'L_Autarkie' }),
  ...RA_SZENARIEN.map(s => _SP('sz_' + s.id, s.id, { breite: 5, liste: 'L_Kreuz', szenario: s.id, hinweis: s.name })),
  _SP('reduziert', 'Reduzierter Betrieb im Krisenfall möglich?', { breite: 13, liste: 'L_JaNein' }),
  _SP('pk',        'Krisenlast [kW], falls bekannt', { breite: 12, art: 'zahl' }),
  _SP('pk_art',    'Leistungsangabe ist',          { breite: 13, liste: 'L_Leistung' }),
  _SP('ersatz',    'Vorhandene Ersatzversorgung',  { breite: 14, liste: 'L_Ersatz' }),
  _SP('ersatz_info', 'Überbrückungszeit USV bzw. Tankreichweite NEA', { breite: 20 }),
  _SP('abh',       'Abhängig von (Wärme / Wasser / IT-Netz / Kommunikation / Personal)', { breite: 24 }),
  _SP('herkunft',  'Herkunft der Angaben',         { breite: 15, liste: 'L_Herkunft' }),
  _SP('bem',       'Bemerkung',                    { breite: 28 }),
]);

// ── Kategorien ──────────────────────────────────────────────────────────────
// Gleichartige Gebäude (z. B. zwanzig Unterkunftsgebäude) werden einmal als
// Kategorie beschrieben. Eine Funktionszeile mit dieser Kategorie übernimmt
// beim Einlesen jede Angabe, die in der Zeile selbst leer ist — was in der
// Zeile steht, geht immer vor. Gebäudebezogenes (Krisenlast, vorhandene
// Ersatzversorgung) gehört nicht in die Kategorie.

/** Felder, die eine Funktionszeile von ihrer Kategorie übernehmen kann. */
export const RA_KATEGORIE_FELDER = Object.freeze([
  'betrieb', 'ausw_s', 'ausw_4h', 'ausw_3d', 'autarkie',
  ...RA_SZENARIEN.map(s => 'sz_' + s.id),
  'reduziert', 'abh', 'herkunft',
]);

export const RA_KATEGORIE_SPALTEN = Object.freeze([
  _SP('kategorie', 'Kategorie', { breite: 26, hinweis: 'Frei wählbare Bezeichnung, z. B. „Unterkunft"' }),
  ...RA_FUNKTION_SPALTEN.filter(s => RA_KATEGORIE_FELDER.includes(s.feld)),
  _SP('bem', 'Bemerkung', { breite: 28 }),
]);

/** Typische Funktionen einer Liegenschaft als Startpunkt der Liste. */
export const RA_FUNKTION_VORLAGEN = Object.freeze([
  Object.freeze({ name: 'Führung / IT / Kommunikation', betrieb: '24/7' }),
  Object.freeze({ name: 'Wache / Zugangskontrolle',     betrieb: '24/7' }),
  Object.freeze({ name: 'Sanitätsbereich',              betrieb: '24/7' }),
  Object.freeze({ name: 'Küche / Verpflegung',          betrieb: 'Dienstzeit' }),
  Object.freeze({ name: 'Unterkunft',                   betrieb: '24/7' }),
  Object.freeze({ name: 'Werkstatt / Instandsetzung',   betrieb: 'Dienstzeit' }),
  Object.freeze({ name: 'Betankung',                    betrieb: 'zeitweise' }),
  Object.freeze({ name: 'Munitionslager',               betrieb: '24/7' }),
  Object.freeze({ name: 'Verwaltung',                   betrieb: 'Dienstzeit' }),
]);

/** Nutzungstyp eines Gebäudes → passende Funktionsbezeichnung und Betriebszeit. */
const _NUTZUNG_FUNKTION = Object.freeze({
  kaserne:       ['Unterkunft', '24/7'],
  unterkunft:    ['Unterkunft', '24/7'],
  wohnheim:      ['Unterkunft', '24/7'],
  kantine:       ['Küche / Verpflegung', 'Dienstzeit'],
  werkstatt:     ['Werkstatt / Instandsetzung', 'Dienstzeit'],
  lager:         ['Lager / Depot', 'zeitweise'],
  technik:       ['Technische Versorgung', '24/7'],
  verwaltung:    ['Verwaltung', 'Dienstzeit'],
  buero:         ['Verwaltung', 'Dienstzeit'],
  polizei:       ['Wache / Zugangskontrolle', '24/7'],
  feuerwehr:     ['Brandschutz / Feuerwehr', '24/7'],
  rettungswache: ['Sanitätsbereich', '24/7'],
  krankenhaus:   ['Sanitätsbereich', '24/7'],
  arztpraxis:    ['Sanitätsbereich', 'Dienstzeit'],
  labor:         ['Labor / Forschung', 'Dienstzeit'],
  schule:        ['Ausbildung', 'Dienstzeit'],
  hochschule:    ['Ausbildung', 'Dienstzeit'],
  sporthalle:    ['Sport / Ausbildung', 'Dienstzeit'],
});

/** Laufende ID im Format F01. */
export const raFunktionsId = (i) => 'F' + String(i + 1).padStart(2, '0');

/**
 * Vorbelegung der Funktionsliste: erst die Gebäude aus dem Projekt, dann die
 * typischen Funktionen, die dabei noch nicht vorkommen. Gebäude mit bekannter
 * Nutzung bekommen die passende Kategorie; die Betriebszeit steht dann in der
 * Kategorie und nicht in der Zeile — sonst würde sie die Kategorie überstimmen.
 * @param {Array<{id?:any,name?:string,nutzung?:string}>} [gebaeude]
 */
export function raVorbelegung(gebaeude) {
  const zeilen = [];
  const benutzt = new Set();
  for (const g of gebaeude || []) {
    const [fname] = _NUTZUNG_FUNKTION[g?.nutzung] || [];
    const name = fname || 'Nutzung noch festzulegen';
    zeilen.push({
      name, geb: String(g?.name ?? (g?.id != null ? `Gebäude ${g.id}` : '')).trim(),
      kategorie: fname || '', betrieb: '',
    });
    if (fname) benutzt.add(fname);
  }
  for (const v of RA_FUNKTION_VORLAGEN) {
    if (benutzt.has(v.name)) continue;
    zeilen.push({ name: v.name, geb: '', kategorie: '', betrieb: v.betrieb });
  }
  return zeilen.map((z, i) => ({ id: raFunktionsId(i), ...z }));
}

/**
 * Vorbelegung des Blatts „3 Kategorien": je Nutzung, die unter den Gebäuden
 * vorkommt, eine Kategorie mit der typischen Betriebszeit.
 * @param {Array<{nutzung?:string}>} [gebaeude]
 */
export function raKategorieVorbelegung(gebaeude) {
  const out = new Map();
  for (const g of gebaeude || []) {
    const [kategorie, betrieb] = _NUTZUNG_FUNKTION[g?.nutzung] || [];
    if (kategorie && !out.has(kategorie)) out.set(kategorie, { kategorie, betrieb });
  }
  return [...out.values()];
}

// ── Frage-Antwort-Blätter ───────────────────────────────────────────────────
// Gelesen wird später über den Fragetext in Spalte A, nicht über die
// Zeilennummer — eingefügte Zeilen brechen den Import dann nicht.
const _FR = (feld, frage, opt = {}) => Object.freeze({ feld, frage, ...opt });

export const RA_ALLGEMEIN_FELDER = Object.freeze([
  _FR('lieg',        'Liegenschaft (Bezeichnung, Ort)'),
  _FR('auftrag',     'Auftrag bzw. wesentliche Aufgaben der Liegenschaft', { hoehe: 70 }),
  _FR('stelle',      'Ausfüllende Stelle'),
  _FR('bearb',       'Name der bearbeitenden Person'),
  _FR('stand',       'Datum'),
  _FR('zustaendig',  'Welche Stelle ist für die Resilienz der Liegenschaft zuständig?'),
  _FR('vorgaben',    'Gibt es Vorgaben zur Energie- bzw. Notstromversorgung (Weisungen, Befehle, Planungen)?', { liste: 'L_JaNein' }),
  _FR('vorgaben_bez','Wenn ja: Bezeichnung und herausgebende Stelle — bei eingestuften Vorgaben nur Existenz und Stelle, keine Inhalte'),
  _FR('liste_kf',    'Gibt es eine abgestimmte Liste kritischer Funktionen?', { liste: 'L_JaNein' }),
  _FR('liste_kf_bez','Wenn ja: Bezeichnung und Stelle'),
]);

export const RA_BESTAND_FELDER = Object.freeze([
  _FR('nea_anzahl',        'Vorhandene Netzersatzanlagen (NEA): Anzahl', { art: 'zahl' }),
  _FR('nea_kw',            'NEA: Summe der Leistung [kW]', { art: 'zahl' }),
  _FR('nea_baujahr',       'NEA: Baujahr(e)'),
  _FR('nea_tank',          'NEA: Tankinhalt [l] und geschätzte Laufzeit'),
  _FR('nea_versorgt',      'NEA: welche Gebäude bzw. Funktionen werden versorgt?', { hoehe: 45 }),
  _FR('usv',               'USV-Anlagen: Anzahl, versorgte Bereiche, Überbrückungszeit', { hoehe: 45 }),
  _FR('brennstoff_vorrat', 'Brennstoffversorgung: Art und vorhandener Vorrat'),
  _FR('brennstoff_vertrag','Lieferverträge für den Krisenfall vorhanden?', { liste: 'L_JaNein' }),
  _FR('plaene',            'Notfall- bzw. Netzersatzbetriebspläne vorhanden?', { liste: 'L_JaNein' }),
  _FR('uebung',            'Letzte Übung bzw. Probelauf: Datum und Umfang'),
  _FR('schwach',           'Bekannte Schwachstellen', { hoehe: 70 }),
  _FR('herkunft',          'Herkunft der Angaben auf diesem Blatt', { liste: 'L_Herkunft' }),
]);

export const RA_RUECKMELDUNG_FELDER = Object.freeze([
  _FR('offen',          'Offene Punkte, die hier nicht beantwortet werden konnten', { hoehe: 70 }),
  _FR('rueckfragen',    'Rückfragen an die erhebende Stelle', { hoehe: 70 }),
  _FR('freigabe_stelle','Freigabevermerk der zuständigen Stelle: Stelle'),
  _FR('freigabe_name',  'Freigabevermerk: Name, Dienstgrad'),
  _FR('freigabe_datum', 'Freigabevermerk: Datum'),
]);

// ── Beispiel ────────────────────────────────────────────────────────────────
// Eine erfundene, vollständig ausgefüllte Abfrage. Aus ihr entstehen das Blatt
// „Beispiel (ausgefüllt)" in jeder Abfragedatei und die Beispieldatei, die sich
// auch einlesen lässt. `erl` erklärt auf dem Beispielblatt, wie eine Zeile
// gelesen wird — es ist kein Feld der Abfrage.
const _x = ids => Object.fromEntries(ids.map(id => ['sz_' + id, 'x']));

export const RA_BEISPIEL = Object.freeze({
  allgemein: Object.freeze({
    lieg: 'Musterkaserne, Musterstadt (BEISPIEL)',
    auftrag: 'Ausbildung und Unterbringung von bis zu 800 Personen; Sanitätsbereich mit Bettenstation',
    stelle: 'Standortverwaltung Musterstadt',
    bearb: 'M. Mustermann',
    stand: '2026-09-01',
    zustaendig: 'Kommando Musterbereich, Dezernat Infrastruktur',
    vorgaben: 'ja',
    vorgaben_bez: 'Weisung zur Notstromversorgung, Kommando Musterbereich (eingestuft — Inhalt hier nicht wiedergegeben)',
    liste_kf: 'nein',
    liste_kf_bez: '',
  }),
  szenarien: Object.freeze([
    { id: 'S1', relevant: 'ja',        dauer: '4 h',     herkunft: 'vorgegeben' },
    { id: 'S2', relevant: 'ja',        dauer: '3 Tage',  herkunft: 'vorgegeben' },
    { id: 'S3', relevant: 'ja',        dauer: '7 Tage',  herkunft: 'Einschätzung Nutzer' },
    { id: 'S4', relevant: 'ja',        dauer: '24 h',    herkunft: 'Einschätzung Nutzer', bem: 'Übergabestation nur einfach angebunden' },
    { id: 'S5', relevant: 'unbekannt', dauer: '',        herkunft: 'unbekannt', bem: 'Klärung durch die zuständige Stelle' },
    { id: 'S6', relevant: 'nein',      dauer: '',        herkunft: 'Einschätzung Nutzer', bem: 'Keine fernwirktechnische Anbindung' },
    { id: 'S7', relevant: 'ja',        dauer: '2 Tage',  herkunft: 'Einschätzung Nutzer', bem: 'Teilfläche im Überschwemmungsgebiet' },
  ].map(Object.freeze)),
  kategorien: Object.freeze([
    { kategorie: 'Unterkunft', betrieb: '24/7', ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet',
      autarkie: '3 Tage', ..._x(['S2', 'S3']), reduziert: 'ja', abh: 'Wärme, Wasser', herkunft: 'Einschätzung Nutzer',
      bem: 'Im Krisenfall nur Beleuchtung, Heizung und Sanitär',
      erl: 'Gilt für alle Zeilen auf „4 Funktionen" mit der Kategorie „Unterkunft".' },
    { kategorie: 'Verwaltung', betrieb: 'Dienstzeit', ausw_s: 'keine', ausw_4h: 'keine', ausw_3d: 'eingeschränkt',
      autarkie: 'keine', ..._x(['S2']), reduziert: 'ja', abh: 'IT-Netz', herkunft: 'Einschätzung Nutzer',
      erl: 'Keine Autarkie gefordert: der Betrieb darf bis zur Rückkehr des Netzes ruhen.' },
    { kategorie: 'Werkstatt / Instandsetzung', betrieb: 'Dienstzeit', ausw_s: 'keine', ausw_4h: 'eingeschränkt',
      ausw_3d: 'Auftrag gefährdet', autarkie: '3 Tage', ..._x(['S2', 'S3']), reduziert: 'ja',
      abh: 'Druckluft, Personal', herkunft: 'Einschätzung Nutzer' },
  ].map(Object.freeze)),
  funktionen: Object.freeze([
    { id: 'F01', name: 'Führung / IT / Kommunikation', geb: 'Geb. 1', betrieb: '24/7',
      ausw_s: 'Auftrag gefährdet', ausw_4h: 'Auftrag gefährdet', ausw_3d: 'Auftrag gefährdet', autarkie: '14 Tage',
      ..._x(['S1', 'S2', 'S4', 'S5']), reduziert: 'nein', pk: 35, pk_art: 'gemessen', ersatz: 'USV+NEA',
      ersatz_info: 'USV 30 min, NEA-Tank ca. 48 h', abh: 'IT-Netz, Kommunikation, Personal', herkunft: 'vorgegeben',
      bem: 'Vorgabe aus der Weisung (siehe Blatt 1)',
      erl: 'Ohne Kategorie: alle Angaben stehen in der Zeile selbst.' },
    { id: 'F02', name: 'Wache / Zugangskontrolle', geb: 'Geb. 2', betrieb: '24/7',
      ausw_s: 'eingeschränkt', ausw_4h: 'Auftrag gefährdet', ausw_3d: 'Auftrag gefährdet', autarkie: '14 Tage',
      ..._x(['S1', 'S2', 'S5']), reduziert: 'nein', pk: 8, pk_art: 'geschätzt', ersatz: 'NEA',
      ersatz_info: 'NEA-Tank ca. 24 h', abh: 'Kommunikation, Personal', herkunft: 'vorgegeben',
      erl: 'Ohne Kategorie, einzeln ausgefüllt.' },
    { id: 'F03', name: 'Unterkunft', geb: 'Geb. 10', kategorie: 'Unterkunft', pk: 18, pk_art: 'geschätzt', ersatz: 'keine',
      erl: 'Nur Gebäude, Kategorie und Krisenlast: alles Übrige kommt aus der Kategorie „Unterkunft". '
        + 'Krisenlast und Ersatzversorgung gehören immer zum Gebäude, nie zur Kategorie.' },
    { id: 'F04', name: 'Unterkunft', geb: 'Geb. 11', kategorie: 'Unterkunft', pk: 20, pk_art: 'geschätzt', ersatz: 'keine',
      erl: 'Genauso — so wird jedes weitere gleichartige Gebäude eingetragen.' },
    { id: 'F05', name: 'Unterkunft mit Sanitätsbereich', geb: 'Geb. 12', kategorie: 'Unterkunft',
      ausw_4h: 'Auftrag gefährdet', autarkie: '7 Tage', ..._x(['S1', 'S2', 'S3']), pk: 45, pk_art: 'geschätzt', ersatz: 'keine',
      bem: 'Im Erdgeschoss Sanitätsbereich mit Bettenstation',
      erl: 'Kategorie „Unterkunft", aber mit Abweichungen: Was in der Zeile steht, gilt; der Rest kommt aus der Kategorie. '
        + 'Szenario-Kreuze gelten als Ganzes — steht in der Zeile ein Kreuz, zählen nur die Kreuze der Zeile (hier S1 zusätzlich zu S2, S3).' },
    { id: 'F06', name: 'Verwaltung', geb: 'Geb. 20', kategorie: 'Verwaltung',
      erl: 'Alles aus der Kategorie „Verwaltung".' },
    { id: 'F07', name: 'Werkstatt / Instandsetzung', geb: 'Geb. 30', kategorie: 'Werkstatt / Instandsetzung',
      pk_art: 'unbekannt', ersatz: 'keine',
      erl: 'Krisenlast unbekannt — ehrlich „unbekannt" statt einer geratenen Zahl.' },
    { id: 'F08', name: 'Küche / Verpflegung', geb: 'Geb. 40', betrieb: 'Dienstzeit',
      ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet', autarkie: '3 Tage',
      ..._x(['S2', 'S3']), reduziert: 'ja', pk_art: 'unbekannt', ersatz: 'mobil', ersatz_info: 'Anschluss für mobile NEA vorhanden',
      abh: 'Wasser, Wärme, Personal', herkunft: 'Einschätzung Nutzer', bem: 'Krisenlast wird bis 31.10. gemessen',
      erl: 'Ohne Kategorie. Die Krisenlast wird nachgereicht.' },
  ].map(Object.freeze)),
  bestand: Object.freeze({
    nea_anzahl: 2, nea_kw: 250, nea_baujahr: '1998, 2015', nea_tank: '2 × 1.000 l, zusammen ca. 48 h',
    nea_versorgt: 'Geb. 1 (Führung / IT), Geb. 2 (Wache)',
    usv: '1 USV im Geb. 1 für den Serverraum, ca. 30 min',
    brennstoff_vorrat: 'Heizöl, Tank 50.000 l, derzeit ca. 60 % gefüllt',
    brennstoff_vertrag: 'nein', plaene: 'ja', uebung: 'März 2026, Probelauf beider NEA unter Last (1 h)',
    schwach: 'Übergabestation nur einfach angebunden; NEA 1 ist über 25 Jahre alt.',
    herkunft: 'Einschätzung Nutzer',
  }),
  rueckmeldung: Object.freeze({
    offen: 'Krisenlast Werkstatt (Geb. 30) und Küche (Geb. 40) noch nicht bekannt.',
    rueckfragen: '',
    freigabe_stelle: 'Kommando Musterbereich', freigabe_name: 'M. Muster', freigabe_datum: '2026-09-15',
  }),
});

/** 0-basierter Index der Kopfzeile auf den Tabellenblättern 2 bis 4. */
export const RA_KOPFZEILE = 3;
/** 0-basierter Index der ersten Antwortzeile auf den Frage-Antwort-Blättern. */
export const RA_FRAGE_START = 3;

const _titel = t => [{ w: t, s: XS.titel }];
const _hinweis = t => [{ w: t, s: XS.hinweis }];

/** Ein Frage-Antwort-Blatt aufbauen. */
function _frageBlatt(name, ueberschrift, hinweis, felder, meta) {
  const zeilen = [_titel(ueberschrift), _hinweis(hinweis), []];
  const zeilenHoehe = {};
  const pruefungen = [];
  felder.forEach((f, i) => {
    const r = RA_FRAGE_START + i;
    const vorbelegt = meta?.[f.feld];
    zeilen[r] = [
      { w: f.frage, s: XS.text },
      { w: vorbelegt ?? null, s: f.art === 'zahl' ? XS.eingabeZahl : XS.eingabe },
    ];
    if (f.hoehe) zeilenHoehe[r] = f.hoehe;
    if (f.liste) pruefungen.push({ bereich: `B${r + 1}`, liste: f.liste, titel: 'Auswahl', hinweis: 'Bitte einen Wert aus der Liste wählen.' });
  });
  return {
    name, zeilen, zeilenHoehe, pruefungen,
    spalten: [{ breite: 62 }, { breite: 46 }],
    fixZeilen: RA_FRAGE_START,
  };
}

/** Blatt „0 Anleitung": Zweck, Ausfüllhinweise, Einstufungshinweis, Begriffe. */
function _anleitungBlatt(meta) {
  const A = (t, s = XS.fliess) => [null, { w: t, s }];
  const abschnitt = t => [null, { w: t, s: XS.abschnitt }];
  const zeilen = [
    // Spalte C ist ausgeblendet und trägt die Versionskennung für den Import.
    [null, { w: 'Abfrage: Resilienzanforderungen der Liegenschaft', s: XS.titel }, { w: RA_KENNUNG, s: XS.standard }],
    A(meta?.lieg ? `Liegenschaft: ${meta.lieg}` : 'Liegenschaft: [bitte auf Blatt „1 Allgemeines" eintragen]', XS.fett),
    A(`Stand der Vorlage: ${meta?.stand || ''}${meta?.empfaenger ? `   ·   Empfänger: ${meta.empfaenger}` : ''}`, XS.hinweis),
    [],
    abschnitt('Wozu diese Abfrage?'),
    A('Für das Energiekonzept der Liegenschaft wird gebraucht, welche Funktionen bei einem Ausfall der '
      + 'Versorgung weiterlaufen müssen, wie lange und mit welcher Leistung. Diese Angaben sind eine '
      + 'Eingangsgröße der Planung — ohne sie lässt sich weder eine Ersatzversorgung auslegen noch '
      + 'beurteilen, ob die vorhandene ausreicht.'),
    A('Die Zuständigkeit für die Resilienz der Liegenschaft liegt nicht bei der erhebenden Stelle. '
      + 'Mit dieser Abfrage wird nichts festgelegt und nichts angeordnet: Wir fragen ab, was die '
      + 'zuständige Stelle vorgegeben hat und was vor Ort eingeschätzt wird. Was davon Vorgabe und was '
      + 'Einschätzung ist, wird in der Spalte „Herkunft der Angaben" festgehalten.'),
    [],
    abschnitt('So füllen Sie die Datei aus'),
    A('• Nur die gelb hinterlegten Zellen sind zum Ausfüllen freigegeben; alles andere ist gegen '
      + 'versehentliches Überschreiben gesperrt. Der Schutz hat kein Passwort.'),
    A('• Viele Zellen haben eine Auswahlliste (kleiner Pfeil rechts in der Zelle). Bitte daraus wählen.'),
    A('• „unbekannt" ist eine zulässige und ausdrücklich erwünschte Antwort. Eine offene Lücke ist für '
      + 'die weitere Planung wertvoller als eine geratene Zahl — offene Punkte kommen als Rückfrageliste zurück.'),
    A('• Wie eine fertig ausgefüllte Abfrage aussieht, zeigt das Blatt „Beispiel (ausgefüllt)". '
      + 'Es ist erfunden und wird nicht ausgewertet.'),
    A('• Auf Blatt „4 Funktionen" darf die Liste erweitert werden: Zeilen einfügen oder die vorbereiteten '
      + 'Leerzeilen am Ende nutzen. Auswahllisten und Formatierung gelten dort bereits.'),
    [],
    abschnitt('Viele gleichartige Gebäude? Kategorien nutzen'),
    A('Gibt es mehrere Gebäude mit derselben Nutzung (z. B. zwanzig Unterkunftsgebäude), müssen Sie nicht jede '
      + 'Zeile einzeln ausfüllen:'),
    A('1. Auf Blatt „3 Kategorien" die Kategorie einmal beschreiben (Betriebszeit, Auswirkungen, Autarkie, Szenarien …).'),
    A('2. Auf Blatt „4 Funktionen" in der Spalte „Kategorie" die Kategorie auswählen. Die übrigen Zellen der Zeile '
      + 'bleiben leer — sie werden beim Auswerten aus der Kategorie übernommen.'),
    A('3. Weicht ein einzelnes Gebäude ab, tragen Sie nur die abweichende Angabe in dessen Zeile ein. '
      + 'Was in der Zeile steht, geht immer vor. Szenario-Kreuze gelten als Ganzes: steht in der Zeile ein Kreuz, '
      + 'zählen nur die Kreuze dieser Zeile.'),
    A('Die Krisenlast [kW] und die vorhandene Ersatzversorgung gehören zum einzelnen Gebäude und stehen deshalb '
      + 'nur auf Blatt „4 Funktionen".'),
    A('• Gefragt wird nach den Auswirkungen eines Ausfalls, nicht nach einer Resilienz- oder Schutzklasse. '
      + 'Die Einordnung in Klassen nimmt die erhebende Stelle anschließend vor und legt sie zur Abstimmung vor.'),
    [],
    abschnitt('Keine eingestuften Inhalte'),
    A('In diese Datei gehören keine Verschlusssachen und keine eingestuften Angaben. Gibt es eingestufte '
      + 'Vorgaben, tragen Sie bitte nur ein, DASS es sie gibt und WELCHE STELLE sie herausgegeben hat — '
      + 'nicht den Inhalt. Auch Funktionen, die nicht offen benannt werden können, bitte nur neutral '
      + 'bezeichnen und in der Bemerkung auf die zuständige Stelle verweisen.', XS.fliess),
    [],
    abschnitt('Begriffe'),
    A('Funktion — die Aufgabe, die weiterlaufen muss (z. B. „Wache / Zugangskontrolle"), nicht die Anlage, '
      + 'die sie versorgt. Anforderungen werden an Funktionen gestellt, weil die Technik dahinter austauschbar ist.'),
    A('Krisenlast — die elektrische Leistung in Kilowatt (kW), die die Funktion im Krisenbetrieb tatsächlich '
      + 'braucht. Das ist meist deutlich weniger als die Anschlussleistung, weil im Krisenfall nicht alles läuft.'),
    A('Autarkie — wie lange die Funktion ohne Versorgung aus dem öffentlichen Netz weiterlaufen muss '
      + '(z. B. 3 Tage). Nicht, wie lange sie es heute tatsächlich könnte.'),
    A('Unterbrechung — wie lange die Funktion beim Umschalten ausfallen darf. Null Sekunden bedeutet '
      + 'unterbrechungsfrei (USV); ein Netzersatzaggregat braucht typischerweise 10 bis 15 Sekunden.'),
    A('Wiederherstellung — wie schnell die Versorgung nach dem Ausfall eines einzelnen Betriebsmittels '
      + '(Kabel, Trafo, Schaltfeld) wieder stehen muss.'),
    [],
    abschnitt('Rückfragen'),
    A(meta?.ansprechpartner || '[Ansprechpartner, Dienststelle, Telefon, E-Mail]',
      meta?.ansprechpartner ? XS.fliess : XS.hinweis),
    [],
    A('Bitte die ausgefüllte Datei unverändert als .xlsx zurücksenden — sie wird maschinell ausgewertet. '
      + 'Blätter oder Spalten bitte nicht löschen oder umbenennen.', XS.hinweis),
  ];
  return {
    name: RA_BLATT.anleitung,
    zeilen,
    spalten: [{ breite: 3 }, { breite: 112 }, { breite: 10, verborgen: true }],
  };
}

/** Blatt „2 Szenarien": S1–S7, je Zeile Relevanz, Dauer, Herkunft, Bemerkung. */
function _szenarienBlatt(vorbelegung) {
  const vor = new Map((vorbelegung || []).map(s => [s.id, s]));
  const E = v => ({ w: v == null || v === '' ? null : v, s: XS.eingabe });
  const kopf = ['ID', 'Referenzszenario', 'Relevant für die Liegenschaft?',
    'Angenommene Dauer', 'Herkunft der Angabe', 'Bemerkung'];
  const zeilen = [
    _titel('2 Szenarien'),
    _hinweis('Welche Ausfälle sind für diese Liegenschaft zu unterstellen und wie lange dauern sie? '
      + 'Die Dauer bitte als Zeitangabe eintragen (z. B. „4 h", „3 Tage", „14 Tage").'),
    [],
    kopf.map(t => ({ w: t, s: XS.kopf })),
  ];
  RA_SZENARIEN.forEach((s, i) => {
    const v = vor.get(s.id) || {};
    zeilen[RA_KOPFZEILE + 1 + i] = [
      { w: s.id, s: XS.text }, { w: s.name, s: XS.text },
      E(v.relevant), E(v.dauer), E(v.herkunft), E(v.bem),
    ];
  });
  const von = RA_KOPFZEILE + 2, bis = RA_KOPFZEILE + 1 + RA_SZENARIEN.length;
  return {
    name: RA_BLATT.szenarien, zeilen,
    spalten: [{ breite: 6 }, { breite: 54 }, { breite: 16 }, { breite: 16 }, { breite: 18 }, { breite: 34 }],
    zeilenHoehe: { [RA_KOPFZEILE]: 32 },
    fixZeilen: RA_KOPFZEILE + 1,
    pruefungen: [
      { bereich: `C${von}:C${bis}`, liste: 'L_Relevant', titel: 'Relevanz', hinweis: 'ja / nein / unbekannt' },
      { bereich: `E${von}:E${bis}`, liste: 'L_Herkunft', titel: 'Herkunft', hinweis: 'Vorgabe der zuständigen Stelle oder Einschätzung vor Ort?' },
    ],
  };
}

/**
 * Tabellenblatt mit Kopfzeile, Eingabezeilen und Datenüberprüfung — Grundlage
 * für „3 Kategorien" und „4 Funktionen".
 */
function _tabellenBlatt({ name, ueberschrift, hinweis, spalten, daten, leerzeilen, idVon }) {
  const zeilen = [
    _titel(ueberschrift),
    _hinweis(hinweis),
    [],
    spalten.map(s => ({ w: s.titel, s: XS.kopf })),
  ];
  const alle = [...(daten || [])];
  for (let i = 0; i < Math.max(0, leerzeilen ?? 0); i++) alle.push({});
  alle.forEach((f, i) => {
    zeilen[RA_KOPFZEILE + 1 + i] = spalten.map(s => {
      if (s.feld === 'id' && idVon) return { w: f.id || idVon(i), s: XS.text };
      const wert = f[s.feld];
      return { w: wert == null || wert === '' ? null : wert, s: s.art === 'zahl' ? XS.eingabeZahl : XS.eingabe };
    });
  });

  const von = RA_KOPFZEILE + 2, bis = RA_KOPFZEILE + 1 + Math.max(1, alle.length);
  const pruefungen = [];
  spalten.forEach((s, c) => {
    if (!s.liste) return;
    const b = spalteZuBuchstabe(c);
    pruefungen.push({
      bereich: `${b}${von}:${b}${bis}`, liste: s.liste,
      titel: s.szenario ? s.szenario : 'Auswahl',
      hinweis: s.hinweis || 'Bitte einen Wert aus der Liste wählen; „unbekannt" ist zulässig.',
    });
  });

  return {
    name, zeilen, pruefungen,
    spalten: spalten.map(s => ({ breite: s.breite || 14 })),
    zeilenHoehe: { [RA_KOPFZEILE]: 58 },
    fixZeilen: RA_KOPFZEILE + 1,
    datenBis: bis,
  };
}

/** Blatt „3 Kategorien": gleichartige Gebäude einmal beschreiben. */
function _kategorienBlatt(kategorien, leerzeilen) {
  return _tabellenBlatt({
    name: RA_BLATT.kategorien,
    ueberschrift: '3 Kategorien',
    hinweis: 'Freiwillig — spart Arbeit bei vielen gleichartigen Gebäuden. Eine Zeile je Kategorie (z. B. „Unterkunft"). '
      + 'Auf Blatt „4 Funktionen" die Kategorie in der Spalte „Kategorie" wählen: leere Zellen dieser Zeile werden '
      + 'dann aus der Kategorie übernommen, eingetragene Werte gehen vor. Krisenlast und Ersatzversorgung gehören '
      + 'zum einzelnen Gebäude und stehen nur auf Blatt 4.',
    spalten: RA_KATEGORIE_SPALTEN,
    daten: kategorien,
    leerzeilen,
  });
}

/** Blatt „4 Funktionen" — das Kernblatt. */
function _funktionenBlatt(funktionen, leerzeilen) {
  return _tabellenBlatt({
    name: RA_BLATT.funktionen,
    ueberschrift: '4 Funktionen',
    hinweis: 'Eine Zeile je Funktion. Gefragt ist die Auswirkung eines Ausfalls auf den Auftrag — '
      + 'nicht, welche Technik heute vorhanden ist. Die Vorbelegung ist ein Vorschlag: bitte streichen, '
      + 'ändern und ergänzen. Bei den Szenarien ein „x" in jede Spalte setzen, die für die Funktion gilt. '
      + 'Ist eine Kategorie gewählt, genügt es, nur die Abweichungen von der Kategorie einzutragen.',
    spalten: RA_FUNKTION_SPALTEN,
    daten: funktionen,
    leerzeilen,
    idVon: raFunktionsId,
  });
}

/** Blatt „Beispiel (ausgefüllt)": wie eine ausgefüllte Abfrage aussieht. Wird nicht eingelesen. */
function _beispielBlatt() {
  const B = RA_BEISPIEL;
  const zeilen = [
    [{ w: 'Beispiel (ausgefüllt)', s: XS.titel }],
    [{ w: 'Erfundene Liegenschaft — so sieht eine fertig ausgefüllte Abfrage aus. Dieses Blatt wird nicht ausgewertet '
      + 'und kann nicht bearbeitet werden. Blau = Beispielwerte; Spalte A erklärt, wie die Zeile gelesen wird.', s: XS.hinweis }],
  ];
  const zeilenHoehe = { 1: 30 };
  const breiten = [46];
  const merkeBreiten = spalten => spalten.forEach((s, c) => {
    breiten[c + 1] = Math.min(30, Math.max(breiten[c + 1] || 0, s.breite || 14));
  });
  const wert = v => (v == null || v === '' ? null : v);
  const abschnitt = (titel, spalten, daten, zelle) => {
    zeilen.push([]);
    zeilen.push([{ w: titel, s: XS.abschnitt }]);
    zeilenHoehe[zeilen.length] = 58;
    zeilen.push([{ w: 'So wird die Zeile gelesen', s: XS.kopf }, ...spalten.map(s => ({ w: s.titel, s: XS.kopf }))]);
    for (const d of daten) {
      zeilen.push([{ w: d.erl || null, s: XS.fliess }, ...spalten.map(s => ({ w: wert(zelle(d, s)), s: XS.beispiel }))]);
    }
    merkeBreiten(spalten);
  };

  const szSpalten = [
    { feld: 'id', titel: 'ID', breite: 6 }, { feld: 'name', titel: 'Referenzszenario', breite: 30 },
    { feld: 'relevant', titel: 'Relevant für die Liegenschaft?', breite: 16 },
    { feld: 'dauer', titel: 'Angenommene Dauer', breite: 16 },
    { feld: 'herkunft', titel: 'Herkunft der Angabe', breite: 18 }, { feld: 'bem', titel: 'Bemerkung', breite: 28 },
  ];
  const szName = new Map(RA_SZENARIEN.map(s => [s.id, s.name]));
  abschnitt('Blatt „2 Szenarien"', szSpalten, B.szenarien,
    (d, s) => (s.feld === 'name' ? szName.get(d.id) : d[s.feld]));
  abschnitt('Blatt „3 Kategorien" — einmal je Gebäudeart', RA_KATEGORIE_SPALTEN, B.kategorien, (d, s) => d[s.feld]);
  abschnitt('Blatt „4 Funktionen" — eine Zeile je Funktion bzw. Gebäude', RA_FUNKTION_SPALTEN, B.funktionen,
    (d, s) => d[s.feld]);

  return {
    name: RA_BLATT.beispiel, zeilen, zeilenHoehe,
    spalten: breiten.map(b => ({ breite: b || 14 })),
  };
}

/** Verstecktes Blatt mit den Auswahllisten; je Liste eine Spalte. */
function _listenBlatt() {
  const listen = Object.entries(RA_LISTEN);
  const hoehe = Math.max(...listen.map(([, w]) => w.length));
  const zeilen = [listen.map(([name]) => ({ w: name, s: XS.fett }))];
  for (let r = 0; r < hoehe; r++) zeilen.push(listen.map(([, werte]) => werte[r] ?? null));
  const namen = {};
  listen.forEach(([name, werte], c) => {
    const b = spalteZuBuchstabe(c);
    namen[name] = `${RA_BLATT.listen}!$${b}$2:$${b}$${werte.length + 1}`;
  });
  return {
    blatt: { name: RA_BLATT.listen, zeilen, versteckt: true, spalten: listen.map(() => ({ breite: 20 })) },
    namen,
  };
}

/**
 * Die komplette Abfragemappe beschreiben — Übergabe an xlsxDateien().
 * @param {object} [opt]
 * @param {object} [opt.meta]         Vorbelegung: lieg, bearb, stand, stelle, empfaenger, ansprechpartner
 *                                    (und weitere Felder von Blatt „1 Allgemeines")
 * @param {Array}  [opt.funktionen]   Vorbelegung des Kernblatts (raVorbelegung)
 * @param {Array}  [opt.kategorien]   Vorbelegung von „3 Kategorien" (raKategorieVorbelegung)
 * @param {Array}  [opt.szenarien]    Vorbelegung von „2 Szenarien": [{id, relevant, dauer, herkunft, bem}]
 * @param {object} [opt.bestand]      Vorbelegung von „5 Bestand und Organisation"
 * @param {object} [opt.rueckmeldung] Vorbelegung von „6 Rückmeldung"
 * @param {number} [opt.leerzeilen]   zusätzliche leere Funktionszeilen (Vorgabe 40)
 * @param {number} [opt.leerKategorien] zusätzliche leere Kategoriezeilen (Vorgabe 15)
 */
export function raMappe(opt = {}) {
  const meta = opt.meta || {};
  const { blatt: listen, namen } = _listenBlatt();
  const kategorien = _kategorienBlatt(opt.kategorien || [], opt.leerKategorien ?? 15);
  // Auswahlliste der Kategorien = Spalte A des Kategorienblatts
  namen.L_Kategorie = `'${RA_BLATT.kategorien}'!$A$${RA_KOPFZEILE + 2}:$A$${kategorien.datenBis}`;
  return {
    titel: `Resilienzabfrage ${meta.lieg || ''}`.trim(),
    autor: meta.stelle || 'Micke-Heat',
    namen,
    blaetter: [
      _anleitungBlatt(meta),
      _beispielBlatt(),
      _frageBlatt(RA_BLATT.allgemeines, '1 Allgemeines',
        'Grunddaten der Liegenschaft und der Stand der Vorgaben.', RA_ALLGEMEIN_FELDER, meta),
      _szenarienBlatt(opt.szenarien),
      kategorien,
      _funktionenBlatt(opt.funktionen || [], opt.leerzeilen ?? 40),
      _frageBlatt(RA_BLATT.bestand, '5 Bestand und Organisation',
        'Was ist heute vorhanden? Diese Angaben werden nicht bewertet, sie ordnen den Ausgangszustand ein.',
        RA_BESTAND_FELDER, opt.bestand || null),
      _frageBlatt(RA_BLATT.rueckmeldung, '6 Rückmeldung',
        'Was offen bleibt, und wer die Angaben freigibt.', RA_RUECKMELDUNG_FELDER, opt.rueckmeldung || null),
      listen,
    ],
  };
}

/**
 * Die Beispieldatei: dieselbe Mappe, vollständig mit RA_BEISPIEL ausgefüllt.
 * Sie lässt sich einlesen und zeigt dann eine komplette Auswertung.
 */
export function raBeispielMappe() {
  const B = RA_BEISPIEL;
  const ohneErl = ({ erl, ...rest }) => rest;
  const m = raMappe({
    meta: { ...B.allgemein, ansprechpartner: 'Beispiel — hier stehen Name, Dienststelle, Telefon und E-Mail' },
    szenarien: B.szenarien,
    kategorien: B.kategorien.map(ohneErl),
    funktionen: B.funktionen.map(ohneErl),
    bestand: B.bestand,
    rueckmeldung: B.rueckmeldung,
    leerzeilen: 5,
    leerKategorien: 3,
  });
  m.titel = 'Resilienzabfrage BEISPIEL';
  return m;
}

/** Dateiname der Beispieldatei. */
export const RA_BEISPIEL_DATEINAME = 'Resilienzabfrage_BEISPIEL_ausgefuellt.xlsx';

/** Dateiname der Abfragedatei. */
export function raDateiname(meta) {
  const teil = String(meta?.lieg || 'Liegenschaft').replace(/[^\wÄÖÜäöüß -]/g, '').trim().replace(/\s+/g, '_') || 'Liegenschaft';
  const datum = (meta?.stand && /^\d{4}-\d{2}-\d{2}$/.test(meta.stand))
    ? meta.stand : new Date().toISOString().slice(0, 10);
  return `Resilienzabfrage_${teil}_${datum}.xlsx`;
}

// ══════════════════════════════════════════════════════════════════════════
// Baustein 2: ausgefüllte Datei einlesen und bewerten
// ══════════════════════════════════════════════════════════════════════════

/** Text normalisieren; leer → ''. */
export const raText = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Zahl aus deutscher oder englischer Schreibweise; sonst null. */
export function raZahl(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = raText(v).replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(s) && !/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const _schluessel = s => raText(s).toLowerCase().replace(/[.:?！!]+$/, '');

/** Wert gegen eine Auswahlliste normalisieren; Unbekanntes kommt roh zurück. */
export function raAusListe(wert, listenName) {
  const roh = raText(wert);
  if (!roh) return '';
  const liste = RA_LISTEN[listenName] || [];
  const k = _schluessel(roh);
  const treffer = liste.find(w => _schluessel(w) === k);
  if (treffer) return treffer;
  // Nachsicht für naheliegende Kurzformen
  if (listenName === 'L_Auswirkung' && /gefährdet|gefaehrdet/.test(k)) return 'Auftrag gefährdet';
  if (listenName === 'L_Auswirkung' && /eingeschr/.test(k)) return 'eingeschränkt';
  if (listenName === 'L_Kreuz') return /^(x|ja|✓|✗|1)$/.test(k) ? 'x' : '—';
  return roh;
}

/** Autarkieangabe der Auswahlliste in Stunden. „länger" → 720 h, „unbekannt" → null. */
export function raAutarkieStunden(text) {
  const k = _schluessel(text);
  if (!k) return null;
  const fest = { 'keine': 0, '1 tag': 24, '3 tage': 72, '7 tage': 168, '14 tage': 336, 'länger': 720, 'laenger': 720 };
  if (k in fest) return fest[k];
  if (k === 'unbekannt') return null;
  // Freitext wie „5 Tage", „48 h", „2 Wochen"
  const m = /^(\d+(?:[.,]\d+)?)\s*(h|std|stunden?|t|tage?|d|wochen?|w)$/.exec(k);
  if (!m) return null;
  const n = raZahl(m[1]);
  if (n == null) return null;
  if (/^(h|std|stunde)/.test(m[2])) return n;
  if (/^(w|woche)/.test(m[2])) return n * 168;
  return n * 24;
}

/** Stundenzahl lesbar machen. */
export function raDauerText(h) {
  if (h == null) return '[offen]';
  if (h <= 0) return 'keine Autarkie gefordert';
  if (h % 24 === 0) { const t = h / 24; return t === 1 ? '1 Tag' : `${t} Tage`; }
  return `${h} h`;
}

// ── Klassen ─────────────────────────────────────────────────────────────────
// Rein regelbasiert aus den Auswirkungsangaben. Der Vorschlag ist ein Vorschlag:
// er wird als solcher angezeigt und bleibt in der Oberfläche änderbar.
export const RA_KLASSEN = Object.freeze({
  A: Object.freeze({ key: 'A', label: 'Ausfall sofort auftragsgefährdend',     defaultH: 336, unterbrechung: '0 s (unterbrechungsfrei)', farbe: '#e53935' }),
  B: Object.freeze({ key: 'B', label: 'Ausfall binnen Stunden auftragsgefährdend', defaultH: 168, unterbrechung: 'kleiner 4 h',        farbe: '#ffa726' }),
  C: Object.freeze({ key: 'C', label: 'Ausfall binnen Tagen auftragsrelevant', defaultH: 72,  unterbrechung: 'kleiner 3 Tage',         farbe: '#42a5f5' }),
  D: Object.freeze({ key: 'D', label: 'kein Auftragsbezug erkennbar',          defaultH: null, unterbrechung: 'keine Vorgabe',          farbe: '#90a4ae' }),
});
export const RA_KLASSEN_KEYS = Object.freeze(['A', 'B', 'C', 'D']);

/**
 * Klassenvorschlag aus den drei Auswirkungsangaben — mit dem Grund, damit die
 * Regel in der Oberfläche nachvollziehbar bleibt.
 * @returns {{klasse:'A'|'B'|'C'|'D', grund:string, sicher:boolean}}
 */
export function raKlasseVorschlag(f) {
  const s = raAusListe(f?.ausw_s, 'L_Auswirkung');
  const h = raAusListe(f?.ausw_4h, 'L_Auswirkung');
  const d = raAusListe(f?.ausw_3d, 'L_Auswirkung');
  if (s === 'Auftrag gefährdet') return { klasse: 'A', grund: 'Ausfall nach Sekunden gefährdet den Auftrag', sicher: true };
  if (h === 'Auftrag gefährdet') return { klasse: 'B', grund: 'Ausfall nach 4 Stunden gefährdet den Auftrag', sicher: true };
  if (d === 'Auftrag gefährdet' || d === 'eingeschränkt') {
    return { klasse: 'C', grund: `Ausfall nach 3 Tagen: ${d}`, sicher: true };
  }
  const sicher = [s, h, d].every(v => v === 'keine');
  return {
    klasse: 'D',
    grund: sicher ? 'keine Auswirkung in allen drei Zeitschnitten' : 'keine auftragsgefährdende Auswirkung angegeben',
    sicher,
  };
}

// ── Einlesen ────────────────────────────────────────────────────────────────

/** Blatt anhand des Namens finden — tolerant gegenüber Groß-/Kleinschreibung und fehlender Nummer. */
function _findeBlatt(blaetter, soll) {
  if (!blaetter) return null;
  if (blaetter[soll]) return blaetter[soll];
  const k = _schluessel(soll);
  const ohneNr = k.replace(/^\d+\s*/, '');
  for (const [name, zeilen] of Object.entries(blaetter)) {
    const n = _schluessel(name);
    if (n === k || n.replace(/^\d+\s*/, '') === ohneNr) return zeilen;
  }
  return null;
}

/** Frage-Antwort-Blatt: Antwort (Spalte B) zur Frage (Spalte A). */
function _leseFragen(zeilen, felder) {
  const nachText = new Map();
  for (const z of zeilen || []) {
    const frage = _schluessel(z?.[0]);
    if (frage && !nachText.has(frage)) nachText.set(frage, z?.[1]);
  }
  const out = {};
  for (const f of felder) {
    let roh = nachText.get(_schluessel(f.frage));
    if (roh === undefined) {
      // Zweiter Versuch über den Anfang der Frage — falls jemand den Text gekürzt hat
      const anfang = _schluessel(f.frage).slice(0, 30);
      for (const [frage, wert] of nachText) if (frage.startsWith(anfang)) { roh = wert; break; }
    }
    out[f.feld] = f.liste ? raAusListe(roh, f.liste)
      : f.art === 'zahl' ? raZahl(roh)
        : raText(roh);
  }
  return out;
}

function _leseSzenarien(zeilen) {
  const nachId = new Map();
  for (const z of zeilen || []) {
    const id = raText(z?.[0]).toUpperCase();
    if (/^S\d+$/.test(id) && !nachId.has(id)) nachId.set(id, z);
  }
  return RA_SZENARIEN.map(s => {
    const z = nachId.get(s.id) || [];
    return {
      id: s.id,
      name: raText(z[1]) || s.name,
      relevant: raAusListe(z[2], 'L_Relevant'),
      dauer: raText(z[3]),
      herkunft: raAusListe(z[4], 'L_Herkunft'),
      bem: raText(z[5]),
    };
  });
}

/** Eine Funktionszeile gilt als leer, wenn weder Bezeichnung noch eine Auswirkung steht. */
function _zeileLeer(f) {
  return !f.name && !f.geb && !f.kategorie && !f.ausw_s && !f.ausw_4h && !f.ausw_3d
    && !f.autarkie_text && f.pk == null && !f.bem;
}

/** Felder der Arbeitsstruktur, die von der Kategorie übernommen werden (ohne Szenario-Kreuze). */
const _ERBFELDER = Object.freeze(RA_KATEGORIE_FELDER
  .filter(f => !f.startsWith('sz_'))
  .map(f => (f === 'autarkie' ? 'autarkie_text' : f)));

/**
 * Spalten eines Tabellenblatts über den Titel der Kopfzeile finden. Eine nicht
 * gefundene Spalte fällt auf ihre Sollposition zurück, sofern dort keine andere
 * bekannte Spalte steht — so bleibt ein Tippfehler im Titel lesbar, und Dateien
 * der Version 1 (ohne Spalte „Kategorie") passen trotzdem.
 * @returns {{idx:number[], fehlend:Array<{c:number, s:object, ist:string, ersatz:boolean}>}}
 */
function _spaltenZuordnen(kopfZeile, spalten) {
  const kopf = (kopfZeile || []).map(t => _schluessel(t));
  const idx = spalten.map(s => kopf.indexOf(_schluessel(s.titel)));
  const belegt = new Set(idx.filter(i => i >= 0));
  const fehlend = [];
  spalten.forEach((s, c) => {
    if (idx[c] >= 0) return;
    const ersatz = !belegt.has(c);
    if (ersatz) { idx[c] = c; belegt.add(c); }
    fehlend.push({ c, s, ist: raText(kopfZeile?.[c]), ersatz });
  });
  return { idx, fehlend };
}

/** Strukturhinweise zu fehlenden Spalten; Spalten, die jünger als die Datei sind, fehlen zu Recht. */
function _spaltenFehler(fehlend, blattname, version) {
  return fehlend
    .filter(({ s }) => !(s.seit && version && version < s.seit))
    .map(({ c, s, ist, ersatz }) => (ersatz
      ? `Spalte ${spalteZuBuchstabe(c)} auf „${blattname}" heißt „${ist || '(leer)'}", erwartet wird „${s.titel}".`
      : `Spalte „${s.titel}" fehlt auf „${blattname}" — die Angabe wird nicht gelesen.`));
}

/** Eine Zelle in die Arbeitsstruktur übernehmen. */
function _leseZelle(f, s, roh) {
  if (s.szenario) { f.sz[s.szenario] = raAusListe(roh, 'L_Kreuz') === 'x' ? 1 : 0; return; }
  if (s.feld === 'pk') { f.pk = raZahl(roh); f.pk_roh = raText(roh); return; }
  if (s.feld === 'autarkie') { f.autarkie_text = raAusListe(roh, 'L_Autarkie'); return; }
  f[s.feld] = s.liste && RA_LISTEN[s.liste] ? raAusListe(roh, s.liste) : raText(roh);
}

function _leseZeilen(zeilen, spalten, idx) {
  const out = [];
  for (let r = RA_KOPFZEILE + 1; r < (zeilen || []).length; r++) {
    const z = zeilen[r] || [];
    const f = { sz: {} };
    spalten.forEach((s, c) => _leseZelle(f, s, idx[c] >= 0 ? z[idx[c]] : undefined));
    out.push(f);
  }
  return out;
}

function _leseKategorien(zeilen, idx) {
  const out = [];
  const gesehen = new Set();
  for (const k of _leseZeilen(zeilen, RA_KATEGORIE_SPALTEN, idx)) {
    if (!k.kategorie) continue;
    const schl = _schluessel(k.kategorie);
    if (gesehen.has(schl)) continue;            // doppelte Kategorie: die erste gilt
    gesehen.add(schl);
    k.autarkie_h = raAutarkieStunden(k.autarkie_text);
    out.push(k);
  }
  return out;
}

/**
 * Leere Angaben einer Funktionszeile aus ihrer Kategorie übernehmen. Was in
 * der Zeile steht, geht vor. Szenario-Kreuze gelten als Ganzes: ist in der
 * Zeile eines gesetzt, bleiben die Kreuze der Kategorie außen vor.
 */
function _erbeAusKategorie(f, nachName) {
  if (!f.kategorie) return;
  const k = nachName.get(_schluessel(f.kategorie));
  if (!k) { f.kategorie_unbekannt = true; return; }
  f.kategorie = k.kategorie;
  const geerbt = [];
  for (const feld of _ERBFELDER) {
    if (!f[feld] && k[feld]) { f[feld] = k[feld]; geerbt.push(feld); }
  }
  const zeileHatKreuz = RA_SZENARIO_IDS.some(id => f.sz[id]);
  if (!zeileHatKreuz && RA_SZENARIO_IDS.some(id => k.sz?.[id])) {
    f.sz = { ...f.sz, ...k.sz };
    geerbt.push('sz');
  }
  if (!f.name) { f.name = k.kategorie; geerbt.push('name'); }
  f.geerbt = geerbt;
}

function _leseFunktionen(zeilen, idx, kategorien) {
  const nachName = new Map((kategorien || []).map(k => [_schluessel(k.kategorie), k]));
  const out = [];
  for (const f of _leseZeilen(zeilen, RA_FUNKTION_SPALTEN, idx)) {
    if (_zeileLeer(f)) continue;
    f.id = f.id || raFunktionsId(out.length);
    _erbeAusKategorie(f, nachName);
    f.autarkie_h = raAutarkieStunden(f.autarkie_text);
    const v = raKlasseVorschlag(f);
    f.klasse_vorschlag = v.klasse;
    f.klasse_grund = v.grund;
    f.klasse_sicher = v.sicher;
    f.klasse = v.klasse;               // Vorschlag, in der Oberfläche änderbar
    out.push(f);
  }
  return out;
}

/**
 * Ausgefüllte Abfragedatei in die Arbeitsstruktur übersetzen.
 * Fehlende Blätter oder Spalten führen nicht zu einem Abbruch, sondern zu
 * Einträgen in `fehler` — der Rest wird gelesen, so weit es geht.
 * @param {Record<string, Array<Array<any>>>} blaetter  aus lib/xlsx-leser.js
 */
export function raLesen(blaetter) {
  const fehler = [];
  const anleitung = _findeBlatt(blaetter, RA_BLATT.anleitung);
  const kennung = raText(anleitung?.[RA_KENNUNG_ZELLE.zeile]?.[RA_KENNUNG_ZELLE.spalte]);
  const version = /v(\d+)\s*$/.exec(kennung)?.[1];
  const vNr = Number(version) || null;

  if (!anleitung) fehler.push(`Blatt „${RA_BLATT.anleitung}" fehlt.`);
  else if (!kennung.startsWith('MMH-RESILIENZ-ABFRAGE')) {
    fehler.push('Versionskennung nicht gefunden — stammt die Datei aus diesem Werkzeug?');
  } else if (!RA_VERSIONEN_LESBAR.includes(vNr)) {
    fehler.push(`Die Datei ist Version ${version || '?'}, erwartet wird Version ${RA_VERSION}. `
      + 'Sie wird gelesen, einzelne Spalten können abweichen.');
  }

  // Kategorien zuerst — die Funktionen übernehmen daraus.
  const katZeilen = _findeBlatt(blaetter, RA_BLATT.kategorien);
  let kategorien = [];
  if (katZeilen) {
    const { idx, fehlend } = _spaltenZuordnen(katZeilen[RA_KOPFZEILE], RA_KATEGORIE_SPALTEN);
    fehler.push(..._spaltenFehler(fehlend, RA_BLATT.kategorien, vNr));
    kategorien = _leseKategorien(katZeilen, idx);
  } else if (!vNr || vNr >= 2) {
    fehler.push(`Blatt „${RA_BLATT.kategorien}" fehlt — Kategorien werden nicht übernommen.`);
  }

  const fnZeilen = _findeBlatt(blaetter, RA_BLATT.funktionen);
  let funktionen = [];
  if (!fnZeilen) fehler.push(`Blatt „${RA_BLATT.funktionen}" fehlt — ohne dieses Blatt gibt es nichts auszuwerten.`);
  else {
    const { idx, fehlend } = _spaltenZuordnen(fnZeilen[RA_KOPFZEILE], RA_FUNKTION_SPALTEN);
    fehler.push(..._spaltenFehler(fehlend, RA_BLATT.funktionen, vNr));
    funktionen = _leseFunktionen(fnZeilen, idx, kategorien);
  }

  const szZeilen = _findeBlatt(blaetter, RA_BLATT.szenarien);
  if (!szZeilen) fehler.push(`Blatt „${RA_BLATT.szenarien}" fehlt.`);

  return {
    kennung, version: vNr, fehler,
    allgemein:   _leseFragen(_findeBlatt(blaetter, RA_BLATT.allgemeines) || [], RA_ALLGEMEIN_FELDER),
    szenarien:   _leseSzenarien(szZeilen || []),
    kategorien,
    funktionen,
    bestand:     _leseFragen(_findeBlatt(blaetter, RA_BLATT.bestand) || [], RA_BESTAND_FELDER),
    rueckmeldung:_leseFragen(_findeBlatt(blaetter, RA_BLATT.rueckmeldung) || [], RA_RUECKMELDUNG_FELDER),
  };
}

// ── Vollständigkeitsprüfung ─────────────────────────────────────────────────

const _fehlt = v => !v || v === 'unbekannt';

/**
 * Offene Punkte, Hinweise und Kennzahlen einer eingelesenen Abfrage.
 * Bewusst nur Buchführung: es wird nichts ergänzt und nichts geschätzt.
 */
export function raPruefung(daten) {
  const offen = [];
  const hinweise = [];
  const P = (ref, text, feld) => offen.push({ ref, text, feld: feld || '' });

  const a = daten?.allgemein || {};
  if (!raText(a.zustaendig)) P('Allgemeines', 'Die für die Resilienz zuständige Stelle ist nicht benannt.', 'zustaendig');
  if (!raText(a.lieg)) P('Allgemeines', 'Die Liegenschaft ist nicht bezeichnet.', 'lieg');
  if (_fehlt(a.vorgaben)) P('Allgemeines', 'Unklar, ob es Vorgaben zur Energie- bzw. Notstromversorgung gibt.', 'vorgaben');
  else if (a.vorgaben === 'ja' && !raText(a.vorgaben_bez)) {
    P('Allgemeines', 'Vorgaben sind vorhanden, aber Bezeichnung und herausgebende Stelle fehlen.', 'vorgaben_bez');
  }
  if (_fehlt(a.liste_kf)) P('Allgemeines', 'Unklar, ob eine abgestimmte Liste kritischer Funktionen existiert.', 'liste_kf');

  for (const s of daten?.szenarien || []) {
    if (_fehlt(s.relevant)) P(s.id, `Szenario „${s.name}": Relevanz für die Liegenschaft ist offen.`, 'relevant');
    else if (s.relevant === 'ja' && !raText(s.dauer)) P(s.id, `Szenario „${s.name}": angenommene Dauer fehlt.`, 'dauer');
    if (s.relevant === 'ja' && _fehlt(s.herkunft)) {
      P(s.id, `Szenario „${s.name}": unklar, ob die Annahme vorgegeben oder eingeschätzt ist.`, 'herkunft');
    }
  }

  const jeKlasse = {};
  for (const k of RA_KLASSEN_KEYS) jeKlasse[k] = { anzahl: 0, pkAnzahl: 0, pkKw: 0, pkFehlt: 0, autarkieFehlt: 0 };
  const herkunft = { vorgegeben: 0, 'Einschätzung Nutzer': 0, unbekannt: 0, offen: 0 };

  // Lücken in Angaben, die eine Zeile von ihrer Kategorie übernimmt, sind
  // Lücken der Kategorie: einmal je Kategorie melden, nicht je Gebäude.
  const jeKategorie = new Map();
  const PF = (f, ref, bez, feld, rest) => {
    if (!f.kategorie || f.kategorie_unbekannt) { P(ref, `${bez}: ${rest}`, feld); return; }
    const key = `${_schluessel(f.kategorie)}|${rest}`;
    const bisher = jeKategorie.get(key);
    if (bisher) { bisher.ids.push(ref); return; }
    const punkt = { ref: `Kategorie ${f.kategorie}`, text: '', feld, kategorie: f.kategorie, rest, ids: [ref] };
    jeKategorie.set(key, punkt);
    offen.push(punkt);
  };

  for (const f of daten?.funktionen || []) {
    const ref = f.id;
    const bez = f.name || f.geb || ref;
    if (!raText(f.name)) P(ref, `${ref}: Die Funktion ist nicht bezeichnet.`, 'name');
    if (f.kategorie_unbekannt) {
      P(ref, `${bez}: Kategorie „${f.kategorie}" steht nicht auf Blatt „${RA_BLATT.kategorien}" — `
        + 'es wurden keine Angaben daraus übernommen.', 'kategorie');
    }

    const luecken = [
      _fehlt(f.ausw_s) && 'nach Sekunden',
      _fehlt(f.ausw_4h) && 'nach 4 Stunden',
      _fehlt(f.ausw_3d) && 'nach 3 Tagen',
    ].filter(Boolean);
    if (luecken.length === 3) PF(f, ref, bez, 'ausw', 'Keine Angabe zur Auswirkung eines Ausfalls — der Klassenvorschlag trägt nicht.');
    else if (luecken.length) PF(f, ref, bez, 'ausw', `Auswirkung ${luecken.join(' und ')} ist offen.`);

    if (_fehlt(f.autarkie_text)) {
      PF(f, ref, bez, 'autarkie', 'Keine Angabe, wie lange die Funktion ohne Netz weiterlaufen muss.');
    }
    if (f.autarkie_h > 0 && f.pk == null) {
      P(ref, `${bez}: Autarkie von ${raDauerText(f.autarkie_h)} gefordert, Krisenlast aber unbekannt — `
        + 'Messung bzw. Schätzung erforderlich.', 'pk');
    }
    if (f.pk == null && raText(f.pk_roh)) {
      P(ref, `${bez}: Die Krisenlast „${f.pk_roh}" ist keine Zahl und konnte nicht übernommen werden.`, 'pk');
    }
    if (f.pk != null && _fehlt(f.pk_art)) {
      P(ref, `${bez}: Krisenlast angegeben, aber unklar, ob gemessen oder geschätzt.`, 'pk_art');
    }
    const kreuze = RA_SZENARIO_IDS.filter(id => f.sz?.[id]);
    if (!kreuze.length && f.klasse_vorschlag !== 'D') {
      PF(f, ref, bez, 'sz', 'Kein Szenario angekreuzt — unklar, wofür die Anforderung gilt.');
    }
    if (_fehlt(f.herkunft)) PF(f, ref, bez, 'herkunft', 'Herkunft der Angaben ist offen.');

    const k = RA_KLASSEN[f.klasse] ? f.klasse : f.klasse_vorschlag;
    const z = jeKlasse[k] || jeKlasse.D;
    z.anzahl++;
    if (f.pk != null) { z.pkAnzahl++; z.pkKw += f.pk; } else z.pkFehlt++;
    if (f.autarkie_h == null) z.autarkieFehlt++;

    if (f.herkunft === 'vorgegeben' || f.herkunft === 'Einschätzung Nutzer' || f.herkunft === 'unbekannt') {
      herkunft[f.herkunft]++;
    } else herkunft.offen++;

    // Abweichung von der Vorgabe der Klasse ist kein Fehler — die Angabe des
    // Bedarfsträgers gilt. Sie wird nur sichtbar gemacht.
    const vorgabe = RA_KLASSEN[k]?.defaultH;
    if (vorgabe != null && f.autarkie_h != null && f.autarkie_h !== vorgabe) {
      hinweise.push({
        ref, text: `${bez}: angegebene Autarkie ${raDauerText(f.autarkie_h)} weicht vom Klassen-Richtwert `
          + `${raDauerText(vorgabe)} (Klasse ${k}) ab. Übernommen wird die Angabe aus der Abfrage.`,
      });
    }
    if (!f.klasse_sicher && f.klasse_vorschlag === 'D') {
      hinweise.push({ ref, text: `${bez}: Klasse D nur mangels Angaben — bitte gegen die offenen Punkte prüfen.` });
    }
  }

  for (const punkt of jeKategorie.values()) {
    const n = punkt.ids.length;
    punkt.text = `Kategorie „${punkt.kategorie}": ${punkt.rest.replace(/\.$/, '')} `
      + `(betrifft ${n === 1 ? punkt.ids[0] : `${n} Funktionen: ${punkt.ids.join(', ')}`}). `
      + `Einmal auf Blatt „${RA_BLATT.kategorien}" ergänzen.`;
    delete punkt.rest;
  }

  const n = (daten?.funktionen || []).length;
  const bewertet = herkunft.vorgegeben + herkunft['Einschätzung Nutzer'];
  return {
    offene_punkte: offen,
    hinweise,
    kennzahlen: {
      funktionen: n,
      jeKlasse,
      herkunft,
      anteilVorgegebenPct: bewertet ? Math.round(herkunft.vorgegeben / bewertet * 100) : null,
      szenarienOffen: (daten?.szenarien || []).filter(s => _fehlt(s.relevant)).length,
      offeneAnzahl: offen.length,
    },
  };
}

// ── Anforderungstexte ───────────────────────────────────────────────────────

/**
 * Anforderung nach dem Zielschema:
 * „Funktion X ist in den Szenarien Y mit der Krisenlast P für die Dauer Z autark
 *  zu versorgen; maximale Unterbrechung t; Wiederherstellung nach Einzelfehler binnen T."
 * Unbekannte Werte stehen als „[offen]" im Satz — sie werden nicht ergänzt.
 */
export function raAnforderungstext(f, szenarien) {
  const name = raText(f?.name) || f?.id || '[offen]';
  const geb = raText(f?.geb);
  const kreuze = RA_SZENARIO_IDS.filter(id => f?.sz?.[id]);
  const szText = kreuze.length ? kreuze.join(', ') : '[offen]';
  const p = f?.pk != null
    ? `${f.pk.toLocaleString('de-DE')} kW${f.pk_art && f.pk_art !== 'unbekannt' ? ` (${f.pk_art})` : ''}`
    : '[offen]';
  const z = raDauerText(f?.autarkie_h);
  const klasse = RA_KLASSEN[f?.klasse] || RA_KLASSEN[f?.klasse_vorschlag] || RA_KLASSEN.D;
  const t = klasse.unterbrechung;

  // Wiederherstellung nach Einzelfehler fragt die Abfrage nicht ab. Ist n-1 (S4)
  // für die Liegenschaft ausdrücklich nicht relevant, ist die Anforderung nicht
  // gestellt — sonst bleibt sie offen.
  const s4 = (szenarien || []).find(s => s.id === 'S4');
  const T = s4?.relevant === 'nein' ? 'nicht gefordert (Szenario S4 nicht relevant)' : '[offen]';

  return `Funktion „${name}"${geb ? ` (${geb})` : ''} ist in den Szenarien ${szText} `
    + `mit der Krisenlast ${p} für die Dauer ${z} autark zu versorgen; `
    + `maximale Unterbrechung ${t}; Wiederherstellung nach Einzelfehler binnen ${T}.`;
}

/** Alle Anforderungstexte, nach Klasse sortiert. */
export function raAnforderungen(daten) {
  const ord = { A: 0, B: 1, C: 2, D: 3 };
  return (daten?.funktionen || [])
    .map(f => ({ id: f.id, klasse: f.klasse || f.klasse_vorschlag, text: raAnforderungstext(f, daten?.szenarien) }))
    .sort((x, y) => (ord[x.klasse] ?? 9) - (ord[y.klasse] ?? 9) || String(x.id).localeCompare(String(y.id), 'de'));
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Exportschema — anschlussfähig an die Resilienzmatrix (klassen, funktionen,
 * massnahmen). Spätere Module übernehmen die Felder. Version 2 ergänzt
 * `kategorien` sowie je Funktion `kategorie` und `geerbt`; die Funktionen
 * tragen die übernommenen Werte bereits aufgelöst.
 */
export function raExportJson(daten, opt = {}) {
  const pruef = opt.pruefung || raPruefung(daten);
  const a = daten?.allgemein || {};
  return {
    version: RA_VERSION,
    meta: {
      lieg: raText(a.lieg),
      stand: raText(a.stand),
      bearb: raText(a.bearb),
      quelle_abfrage: raText(opt.quelle || daten?.kennung || RA_KENNUNG),
      zustaendig: raText(a.zustaendig),
    },
    szenarien: (daten?.szenarien || []).map(s => ({
      id: s.id, name: s.name, relevant: s.relevant, dauer: s.dauer, herkunft: s.herkunft,
    })),
    kategorien: (daten?.kategorien || []).map(k => ({
      kategorie: raText(k.kategorie),
      betrieb: k.betrieb || '',
      ausw_s: k.ausw_s || '',
      ausw_4h: k.ausw_4h || '',
      ausw_3d: k.ausw_3d || '',
      autarkie_h: k.autarkie_h ?? null,
      autarkie_text: k.autarkie_text || '',
      sz: RA_SZENARIO_IDS.reduce((o, id) => { if (k.sz?.[id]) o[id] = 1; return o; }, {}),
      reduziert: k.reduziert || '',
      abh: raText(k.abh),
      herkunft: k.herkunft || '',
      bem: raText(k.bem),
    })),
    funktionen: (daten?.funktionen || []).map(f => ({
      id: f.id,
      name: raText(f.name),
      geb: raText(f.geb),
      kategorie: raText(f.kategorie),
      geerbt: [...(f.geerbt || [])],     // Felder, die aus der Kategorie stammen
      betrieb: f.betrieb || '',
      ausw_s: f.ausw_s || '',
      ausw_4h: f.ausw_4h || '',
      ausw_3d: f.ausw_3d || '',
      autarkie_h: f.autarkie_h,
      autarkie_text: f.autarkie_text || '',
      sz: RA_SZENARIO_IDS.reduce((o, id) => { if (f.sz?.[id]) o[id] = 1; return o; }, {}),
      reduziert: f.reduziert || '',
      pk: f.pk,
      pk_art: f.pk_art || 'unbekannt',
      ersatz: f.ersatz || '',
      ersatz_info: raText(f.ersatz_info),
      abh: raText(f.abh),
      herkunft: f.herkunft || '',
      klasse_vorschlag: f.klasse_vorschlag,
      klasse: f.klasse || f.klasse_vorschlag,
      bem: raText(f.bem),
    })),
    bestand: { ...(daten?.bestand || {}) },
    rueckmeldung: { ...(daten?.rueckmeldung || {}) },
    offene_punkte: pruef.offene_punkte.map(p => ({ ref: p.ref, text: p.text })),
  };
}

/** Offene Punkte als Text zum Kopieren in eine Rückfrage-E-Mail. */
export function raRueckfragenText(daten, pruefung) {
  const p = pruefung || raPruefung(daten);
  const lieg = raText(daten?.allgemein?.lieg) || '[Liegenschaft]';
  const zeilen = [
    `Rückfragen zur Resilienzabfrage — ${lieg}`,
    `Stand: ${raText(daten?.allgemein?.stand) || new Date().toISOString().slice(0, 10)}`,
    '',
    `Die ausgefüllte Abfrage wurde ausgewertet. ${p.offene_punkte.length} Punkte sind noch offen:`,
    '',
  ];
  let i = 0;
  for (const punkt of p.offene_punkte) zeilen.push(`${++i}. [${punkt.ref}] ${punkt.text}`);
  if (!p.offene_punkte.length) zeilen.push('— keine —');
  if (p.hinweise.length) {
    zeilen.push('', 'Hinweise (keine Rückfrage, nur zur Kenntnis):', '');
    for (const h of p.hinweise) zeilen.push(`• [${h.ref}] ${h.text}`);
  }
  zeilen.push('', 'Die Einordnung in Klassen ist ein Vorschlag der erhebenden Stelle und',
    'wird mit der zuständigen Stelle abgestimmt.');
  return zeilen.join('\n');
}

/** Offene Punkte als eigene Arbeitsmappe (Übergabe an xlsxDateien). */
export function raRueckfragenMappe(daten, pruefung) {
  const p = pruefung || raPruefung(daten);
  const lieg = raText(daten?.allgemein?.lieg);
  const kopf = ['Nr.', 'Bezug', 'Offener Punkt', 'Antwort', 'Herkunft der Antwort'];
  const zeilen = [
    _titel('Rückfragen zur Resilienzabfrage'),
    _hinweis(`${lieg || '[Liegenschaft]'} · Stand ${raText(daten?.allgemein?.stand) || new Date().toISOString().slice(0, 10)}`
      + ' — bitte die gelben Zellen ergänzen und zurücksenden.'),
    [],
    kopf.map(t => ({ w: t, s: XS.kopf })),
  ];
  p.offene_punkte.forEach((punkt, i) => {
    zeilen[RA_KOPFZEILE + 1 + i] = [
      { w: i + 1, s: XS.text }, { w: punkt.ref, s: XS.text }, { w: punkt.text, s: XS.text },
      { w: null, s: XS.eingabe }, { w: null, s: XS.eingabe },
    ];
  });
  const von = RA_KOPFZEILE + 2, bis = RA_KOPFZEILE + 1 + Math.max(1, p.offene_punkte.length);
  const { blatt: listen, namen } = _listenBlatt();
  return {
    titel: `Rückfragen Resilienzabfrage ${lieg}`.trim(), namen,
    blaetter: [{
      name: 'Rückfragen', zeilen,
      spalten: [{ breite: 6 }, { breite: 12 }, { breite: 88 }, { breite: 40 }, { breite: 18 }],
      fixZeilen: RA_KOPFZEILE + 1,
      pruefungen: [{ bereich: `E${von}:E${bis}`, liste: 'L_Herkunft', titel: 'Herkunft' }],
    }, listen],
  };
}
