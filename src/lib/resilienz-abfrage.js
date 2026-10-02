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
  // nur in der Beispieldatei — füllt die erhebende Stelle aus, wird nicht eingelesen
  anforderungen: '7 Anforderungen',
  luecken:       '8 Lückenanalyse',
  loesungsweg:   '9 Lösungsweg',
  massnahmen:    '10 Maßnahmen',
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
  _SP('betrieb',   'Betriebszeit',                { breite: 13, liste: 'L_Betrieb' }),
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

// ── Beispielkatalog ─────────────────────────────────────────────────────────
// Musterantworten für typische Funktionen — Startwerte im Erhebungs-Werkzeug,
// keine Vorgabe. Die Herkunft der Angaben bleibt bewusst leer: erst wenn der
// Empfänger sie einträgt, gilt eine aus dem Katalog übernommene Funktion als
// beschrieben. Namen entsprechen RA_FUNKTION_VORLAGEN und _NUTZUNG_FUNKTION,
// damit das Werkzeug zu einer Funktion das passende Beispiel vorschlagen kann.
const _sz = ids => Object.fromEntries(ids.map(id => [id, 1]));
const _K = (name, betrieb, s, h, d, autarkie_text, sz, reduziert, abh, warum) =>
  Object.freeze({ name, betrieb, ausw_s: s, ausw_4h: h, ausw_3d: d, autarkie_text, sz: Object.freeze(_sz(sz)), reduziert, abh, warum });
const _AG = 'Auftrag gefährdet', _EI = 'eingeschränkt';
export const RA_KATALOG = Object.freeze([
  _K('Führung / IT / Kommunikation', '24/7', _AG, _AG, _AG, '14 Tage', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], 'nein',
    'IT-Netz, Kommunikation, Personal',
    'Lagebild und Verbindung zu übergeordneten Stellen dürfen auch für Sekunden nicht abreißen — typisch USV und NEA. '
    + 'Die Kühlung des Serverraums gehört zur Krisenlast.'),
  _K('Wache / Zugangskontrolle', '24/7', _EI, _AG, _AG, '14 Tage', ['S1', 'S2', 'S3', 'S5'], 'nein',
    'Kommunikation, Personal',
    'Ein kurzer Ausfall ist mit Personal überbrückbar, nach Stunden nicht mehr: Beleuchtung, Schranken, Funk.'),
  _K('Sanitätsbereich', '24/7', _EI, _AG, _AG, '7 Tage', ['S1', 'S2', 'S3'], 'ja',
    'Wärme, Wasser, Personal',
    'Medizinische Geräte puffern meist selbst; ohne Licht, Wärme und Wasser ist Behandlung nach Stunden nicht mehr möglich.'),
  _K('Brandschutz / Feuerwehr', '24/7', _EI, _AG, _AG, '14 Tage', ['S1', 'S2', 'S3', 'S5', 'S7'], 'nein',
    'Kommunikation, Wasser, Personal',
    'Alarmierung und Tore müssen funktionieren; Löschwasser hängt oft an der Druckerhöhung.'),
  _K('Wasserversorgung / Druckerhöhung', '24/7', 'keine', _AG, _AG, '14 Tage', ['S1', 'S2', 'S4', 'S7'], 'nein',
    'Personal',
    'Ein Hochbehälter überbrückt meist nur wenige Stunden — den Puffer in der Bemerkung nennen.'),
  _K('Munitionslager', '24/7', 'keine', _AG, _AG, '14 Tage', ['S1', 'S2', 'S5'], 'nein',
    'Kommunikation, Personal',
    'Überwachung und Einbruchmeldung müssen laufen; deren Akkus reichen typischerweise nur Stunden.'),
  _K('Technische Versorgung', '24/7', 'keine', _EI, _AG, '7 Tage', ['S2', 'S3', 'S4'], 'ja',
    'Wasser',
    'Heizzentrale, Kälte, Druckluft: Andere Funktionen hängen daran. Ohne Strom laufen auch Gas- und Ölkessel nicht.'),
  _K('Küche / Verpflegung', 'Dienstzeit', 'keine', _EI, _AG, '3 Tage', ['S2', 'S3'], 'ja',
    'Wasser, Wärme, Personal',
    'Einige Stunden ohne Küche sind verkraftbar, Tage nicht. Oft genügt ein Einspeisepunkt für ein mobiles Aggregat.'),
  _K('Unterkunft', '24/7', 'keine', _EI, _AG, '3 Tage', ['S2', 'S3'], 'ja',
    'Wärme, Wasser',
    'Im Krisenfall meist nur Beleuchtung, Heizung und Sanitär — reduzierter Betrieb ist möglich.'),
  _K('Betankung', 'zeitweise', 'keine', _EI, _AG, '14 Tage', ['S2', 'S3'], 'ja',
    'Personal',
    'Ohne Strom keine Zapfsäule — dann können auch die Netzersatzanlagen nicht nachgetankt werden.'),
  _K('Werkstatt / Instandsetzung', 'Dienstzeit', 'keine', 'keine', _EI, '14 Tage', ['S2'], 'ja',
    'Personal',
    'Nach einigen Tagen fehlt die Instandsetzung. Licht und Werkzeug lassen sich häufig mobil versorgen.'),
  _K('Labor / Forschung', 'Dienstzeit', _EI, _EI, _EI, '1 Tag', ['S1', 'S2'], 'ja',
    'Kommunikation',
    'Proben und Kühlgeräte: Verlust nach Stunden möglich — prüfen, ob Kühlschränke eigene Pufferung haben.'),
  _K('Lager / Depot', 'zeitweise', 'keine', 'keine', 'keine', 'keine', [], 'ja',
    '',
    'Ausgabe kann im Krisenfall ruhen. Ausnahme: gekühlte oder überwachte Lager — dann wie Munitionslager.'),
  _K('Verwaltung', 'Dienstzeit', 'keine', 'keine', 'keine', 'keine', [], 'ja',
    '',
    'Betrieb ruht im Krisenfall. Auch das ist eine wertvolle Angabe: diese Last darf abgeworfen werden.'),
  _K('Ausbildung', 'Dienstzeit', 'keine', 'keine', 'keine', 'keine', [], 'ja',
    '',
    'Ausbildungsbetrieb wird im Krisenfall eingestellt.'),
  _K('Sport / Ausbildung', 'Dienstzeit', 'keine', 'keine', 'keine', 'keine', [], 'ja',
    '',
    'Kein Auftragsbezug im Krisenfall — sofern die Halle nicht als Notunterkunft vorgesehen ist.'),
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
//
// Bewusst klein gehalten (zehn Funktionen), damit sich auf den Reitern 7 bis 10
// der Beispieldatei jede Funktion von der Anforderung bis zur Maßnahme
// verfolgen lässt.
const _x = ids => Object.fromEntries(ids.map(id => ['sz_' + id, 'x']));

export const RA_BEISPIEL = Object.freeze({
  allgemein: Object.freeze({
    lieg: 'Musterkaserne, Musterstadt (BEISPIEL)',
    auftrag: 'Ausbildung und Unterbringung von bis zu 800 Personen; Stabsgebäude mit Führungs- und IT-Betrieb '
      + 'rund um die Uhr; Sanitätsbereich mit Bettenstation; Betankung für den Standort',
    stelle: 'Standortverwaltung Musterstadt',
    bearb: 'M. Mustermann',
    stand: '2026-09-01',
    zustaendig: 'Kommando Musterbereich, Dezernat Infrastruktur',
    vorgaben: 'ja',
    vorgaben_bez: 'Weisung zur Notstromversorgung, Kommando Musterbereich (eingestuft — Inhalt hier nicht wiedergegeben)',
    liste_kf: 'ja',
    liste_kf_bez: 'Anlage 3 zum Notfallplan der Standortverwaltung (offen), Stand 03/2025 — Grundlage für Blatt 4',
  }),
  szenarien: Object.freeze([
    { id: 'S1', relevant: 'ja',        dauer: '4 h',      herkunft: 'vorgegeben',
      bem: 'In den letzten fünf Jahren zwei Netzausfälle von bis zu 2 h' },
    { id: 'S2', relevant: 'ja',        dauer: '14 Tage',  herkunft: 'vorgegeben',
      bem: 'Bemessungsfall aus der Weisung; wie lange davon jede Funktion laufen muss, steht auf Blatt 4' },
    { id: 'S3', relevant: 'ja',        dauer: '7 Tage',   herkunft: 'Einschätzung Nutzer',
      bem: 'Nachlieferung von Diesel und Heizöl im Krisenfall nicht vertraglich gesichert' },
    { id: 'S4', relevant: 'ja',        dauer: '24 h',     herkunft: 'Einschätzung Nutzer',
      bem: 'Reparatur eines Kabels oder Trafos dauert erfahrungsgemäß bis 24 h' },
    { id: 'S5', relevant: 'unbekannt', dauer: '',         herkunft: 'unbekannt', bem: 'Klärung durch die zuständige Stelle' },
    { id: 'S6', relevant: 'nein',      dauer: '',         herkunft: 'Einschätzung Nutzer',
      bem: 'Keine fernwirktechnische Anbindung; Gebäudeleittechnik nur lokal' },
    { id: 'S7', relevant: 'ja',        dauer: '2 Tage',   herkunft: 'Einschätzung Nutzer',
      bem: 'Pumpenhaus Geb. 50 liegt im Überschwemmungsgebiet HQ100' },
  ].map(Object.freeze)),
  kategorien: Object.freeze([
    { kategorie: 'Unterkunft', betrieb: '24/7', ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet',
      autarkie: '3 Tage', ..._x(['S2', 'S3']), reduziert: 'ja', abh: 'Wärme, Wasser', herkunft: 'Einschätzung Nutzer',
      bem: 'Im Krisenfall nur Beleuchtung, Heizung und Sanitär',
      erl: 'Gilt für alle Zeilen auf „4 Funktionen" mit der Kategorie „Unterkunft".' },
    { kategorie: 'Verwaltung / Ausbildung', betrieb: 'Dienstzeit', ausw_s: 'keine', ausw_4h: 'keine', ausw_3d: 'keine',
      autarkie: 'keine', reduziert: 'ja', herkunft: 'Einschätzung Nutzer', bem: 'Betrieb ruht im Krisenfall',
      erl: 'In allen drei Zeitschnitten „keine": kein Auftragsbezug im Krisenfall. Ohne Szenario-Kreuz, weil keine '
        + 'Anforderung besteht — diese Gebäude dürfen abgeschaltet werden.' },
  ].map(Object.freeze)),
  funktionen: Object.freeze([
    { id: 'F01', name: 'Führung / IT / Serverraum', geb: 'Geb. 1, Stabsgebäude', betrieb: '24/7',
      ausw_s: 'Auftrag gefährdet', ausw_4h: 'Auftrag gefährdet', ausw_3d: 'Auftrag gefährdet', autarkie: '14 Tage',
      ..._x(['S1', 'S2', 'S3', 'S4', 'S5']), reduziert: 'nein', pk: 57, pk_art: 'gemessen', ersatz: 'USV+NEA',
      ersatz_info: 'USV 30 min, NEA 1 (150 kW), Tank ca. 48 h', abh: 'Kühlung, IT-Netz, Personal', herkunft: 'vorgegeben',
      bem: 'Vorgabe aus der Weisung (siehe Blatt 1); Krisenlast einschließlich Klimatisierung des Serverraums',
      erl: 'Ohne Kategorie: alle Angaben stehen in der Zeile selbst. Was die Funktion zum Laufen braucht '
        + '(hier die Kühlung des Serverraums), gehört zur Krisenlast.' },
    { id: 'F02', name: 'Wache / Zugangskontrolle', geb: 'Geb. 2, Wache', betrieb: '24/7',
      ausw_s: 'eingeschränkt', ausw_4h: 'Auftrag gefährdet', ausw_3d: 'Auftrag gefährdet', autarkie: '14 Tage',
      ..._x(['S1', 'S2', 'S3', 'S5']), reduziert: 'nein', pk: 8, pk_art: 'geschätzt', ersatz: 'NEA',
      ersatz_info: 'NEA 2 (100 kW), Tank ca. 24 h', abh: 'Kommunikation, Personal', herkunft: 'vorgegeben',
      erl: 'Ein kurzer Ausfall ist verkraftbar (Sekunden: „eingeschränkt"), nach Stunden nicht mehr.' },
    { id: 'F03', name: 'Unterkunft mit Sanitätsbereich', geb: 'Geb. 12', kategorie: 'Unterkunft',
      ausw_4h: 'Auftrag gefährdet', autarkie: '7 Tage', ..._x(['S1', 'S2', 'S3']), pk: 45, pk_art: 'geschätzt', ersatz: 'keine',
      bem: 'Im Erdgeschoss Sanitätsbereich mit Bettenstation',
      erl: 'Kategorie „Unterkunft", aber mit Abweichungen: Was in der Zeile steht, gilt; der Rest kommt aus der Kategorie. '
        + 'Szenario-Kreuze gelten als Ganzes — steht in der Zeile ein Kreuz, zählen nur die Kreuze der Zeile (hier S1 zusätzlich zu S2, S3).' },
    { id: 'F04', name: 'Unterkunft', geb: 'Geb. 10', kategorie: 'Unterkunft', pk: 20, pk_art: 'geschätzt', ersatz: 'keine',
      erl: 'Nur Gebäude, Kategorie und Krisenlast: alles Übrige kommt aus der Kategorie „Unterkunft". So wird jedes '
        + 'weitere gleichartige Gebäude eingetragen. Krisenlast und Ersatzversorgung gehören immer zum Gebäude, nie zur Kategorie.' },
    { id: 'F05', name: 'Küche / Verpflegung', geb: 'Geb. 40', betrieb: 'Dienstzeit',
      ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet', autarkie: '3 Tage',
      ..._x(['S2', 'S3']), reduziert: 'ja', pk_art: 'unbekannt', ersatz: 'mobil', ersatz_info: 'Einspeisestecker 63 A, kein Aggregat',
      abh: 'Wasser, Wärme, Personal', herkunft: 'Einschätzung Nutzer', bem: 'Krisenlast wird bis 31.10. gemessen',
      erl: 'Krisenlast unbekannt — ehrlich „unbekannt" statt einer geratenen Zahl; sie wird nachgereicht.' },
    { id: 'F06', name: 'Wärmeversorgung (Heizzentrale)', geb: 'Geb. 60', betrieb: '24/7',
      ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet', autarkie: '7 Tage',
      ..._x(['S2', 'S3', 'S4']), reduziert: 'ja', pk: 28, pk_art: 'gemessen', ersatz: 'keine',
      abh: 'Brennstoff, Wasser', herkunft: 'Einschätzung Nutzer',
      bem: 'Versorgt Unterkunft und Sanitätsbereich. Zweistoffbrenner Gas/Heizöl, ohne Strom aber nicht betreibbar; '
        + 'Krisenlast = Pumpen, Brenner, Regelung',
      erl: 'Auch Technik, von der andere Funktionen abhängen, ist eine Funktion: ohne Heizzentrale keine beheizte Unterkunft.' },
    { id: 'F07', name: 'Wasserversorgung / Druckerhöhung', geb: 'Geb. 50, Pumpenhaus', betrieb: '24/7',
      ausw_s: 'keine', ausw_4h: 'Auftrag gefährdet', ausw_3d: 'Auftrag gefährdet', autarkie: '14 Tage',
      ..._x(['S1', 'S2', 'S4', 'S7']), reduziert: 'nein', pk: 15, pk_art: 'gemessen', ersatz: 'keine',
      abh: 'Personal', herkunft: 'Einschätzung Nutzer', bem: 'Hochbehälter reicht ca. 2 h; auch Löschwasser hängt daran',
      erl: 'Einen Puffer (hier der Hochbehälter) in der Bemerkung nennen — er entscheidet, wie lange ein Ausfall folgenlos bleibt.' },
    { id: 'F08', name: 'Betankung', geb: 'Geb. 70, Tankstelle', betrieb: 'zeitweise',
      ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet', autarkie: '14 Tage',
      ..._x(['S2', 'S3']), reduziert: 'ja', pk: 6, pk_art: 'geschätzt', ersatz: 'keine',
      abh: 'Personal', herkunft: 'Einschätzung Nutzer',
      bem: 'Ohne Strom keine Zapfsäule — dann können auch die NEA nicht nachgetankt werden',
      erl: 'Auf Abhängigkeiten achten: hängt an dieser Funktion eine andere (hier das Nachtanken der NEA), gehört das in die Bemerkung.' },
    { id: 'F09', name: 'Verwaltung', geb: 'Geb. 20', kategorie: 'Verwaltung / Ausbildung',
      erl: 'Alles aus der Kategorie — kein Auftragsbezug im Krisenfall. Auch das ist eine wertvolle Angabe: '
        + 'diese Last darf abgeworfen werden.' },
    { id: 'F10', name: 'Betreuungseinrichtung', geb: 'Geb. 41', betrieb: 'Dienstzeit',
      ausw_s: 'unbekannt', ausw_4h: 'unbekannt', ausw_3d: 'unbekannt', autarkie: 'unbekannt',
      reduziert: 'unbekannt', pk_art: 'unbekannt', ersatz: 'unbekannt', herkunft: 'unbekannt',
      bem: 'Betrieb durch externen Pächter — Angaben kommen über die Standortverwaltung',
      erl: '„unbekannt" ist eine zulässige Antwort: die Lücke kommt als Rückfrage zurück, statt geschätzt zu werden.' },
  ].map(Object.freeze)),
  bestand: Object.freeze({
    nea_anzahl: 2, nea_kw: 250, nea_baujahr: '1998 (NEA 1, 150 kW), 2015 (NEA 2, 100 kW)',
    nea_tank: 'NEA 1: 1.000 l, bei Krisenlast ca. 48 h. NEA 2: Tagestank 150 l, ca. 24 h',
    nea_versorgt: 'NEA 1: Geb. 1 mit Serverraum (57 kW). NEA 2: Geb. 2, Wache (8 kW).',
    usv: 'Serverraum Geb. 1, ca. 30 min',
    brennstoff_vorrat: 'Diesel 20.000 l an der Tankstelle Geb. 70 (Füllstand schwankt mit dem Fahrzeugbetrieb); '
      + 'Heizöl EL 50.000 l für die Heizzentrale (derzeit ca. 60 % gefüllt); Erdgas aus dem öffentlichen Netz (kein Vorrat)',
    brennstoff_vertrag: 'nein', plaene: 'ja',
    uebung: 'März 2026, Probelauf beider NEA unter Last (1 h); ein Inselbetrieb der ganzen Liegenschaft wurde noch nie geübt',
    schwach: '1) NEA-Tanks reichen 24–48 h. 2) Tankstelle ohne Notstrom — die NEA können im Ereignis nicht nachgetankt werden. '
      + '3) Heizzentrale und Pumpenhaus ohne Notstrom. 4) Pumpenhaus im Überschwemmungsgebiet. 5) NEA 1 ist über 25 Jahre alt.',
    herkunft: 'Einschätzung Nutzer',
  }),
  rueckmeldung: Object.freeze({
    offen: 'Krisenlast der Küche (Geb. 40) wird bis 31.10.2026 gemessen. Angaben zur Betreuungseinrichtung (Geb. 41) '
      + 'liefert der Pächter nach. Relevanz von S5 klärt die zuständige Stelle.',
    rueckfragen: 'Darf der Dieselbestand der Tankstelle als Notstromreserve eingeplant werden?',
    freigabe_stelle: 'Kommando Musterbereich', freigabe_name: 'M. Muster', freigabe_datum: '2026-09-15',
  }),
  // Was die erhebende Stelle aus den Angaben macht (Reiter 7 bis 10 der
  // Beispieldatei), in fünf Schritten. Anforderung und Klasse (Schritt ①)
  // werden aus den Angaben oben erzeugt; hier stehen nur die Teile, die ein
  // Mensch beiträgt:
  //   ② abhaengigkeiten — versorgende Funktionen übernehmen die strengsten
  //                       Werte der Funktionen, die an ihnen hängen
  //   ③ pruefung        — Soll-Ist je Prüfpunkt (PRUEFPUNKTE), daraus der Lückentyp
  //   ④ buendel         — Lücken mit gleicher Ursache, je Bündel Optionen,
  //                       Bewertung und Entscheidung
  //   ⑤ massnahmen      — die gewählten Optionen; welche Maßnahme welche
  //                       Funktion in welchem Szenario absichert, ergibt sich
  //                       aus `fuer` × `szenarien`
  auswertung: Object.freeze({
    wiederherstellung: Object.freeze({ A: '1 h', B: '8 h', C: '24 h' }),
    abhaengigkeiten: Object.freeze([
      { id: 'F08', fuer: ['F01', 'F02', 'F03', 'F06', 'F07'],
        weg: 'Kraftstoff: alle NEA werden aus der Tankstelle nachgetankt',
        strengste: 'Klasse A (F01), 14 Tage', puffer: 'Tagestanks der NEA, 24–48 h',
        planung: Object.freeze({ klasse: 'A', autarkie: '14 Tage', unterbrechung: 'kleiner 24 h' }),
        folge: 'Hochgestuft: Betankung wird wie Klasse A geplant. Unterbrechen darf sie nur so lange, wie der kleinste '
          + 'NEA-Tank reicht.' },
      { id: 'F06', fuer: ['F03', 'F04'],
        weg: 'Wärme für Unterkunft und Sanitätsbereich',
        strengste: 'Klasse B (F03), 7 Tage', puffer: 'Gebäude kühlen im Winter in ca. 12 h aus',
        planung: Object.freeze({ klasse: 'B', autarkie: '7 Tage', unterbrechung: 'kleiner 12 h' }),
        folge: 'Hochgestuft: Heizzentrale wird wie Klasse B geplant — eine mobile NEA, die erst geholt werden muss, '
          + 'reicht damit nicht mehr.' },
      { id: 'F07', fuer: ['F03', 'F04', 'F05'],
        weg: 'Trink- und Löschwasser',
        strengste: 'Klasse B (F03), 7 Tage', puffer: 'Hochbehälter, ca. 2 h',
        planung: null,
        folge: 'Keine Hochstufung: die eigenen Angaben (Klasse B, 14 Tage) sind schon strenger als die der abhängigen Funktionen.' },
    ].map(a => Object.freeze({ ...a, fuer: Object.freeze(a.fuer) }))),
    // Soll-Ist je Prüfpunkt: „✓ …" erfüllt, „✗ …" Lücke, „? …" offen. Prüfpunkte,
    // deren Szenarien die Funktion nicht angekreuzt hat, bleiben leer („—").
    pruefung: Object.freeze({
      F01: { leistung: '✓ NEA 1, 150 kW', dauer: '✗ Tank ca. 48 h statt 14 Tage', unterbrechung: '✓ USV überbrückt den NEA-Start',
        redundanz: '✗ fällt NEA 1 aus, ist 1 h nicht zu halten', standort: '? Relevanz von S5 offen',
        typ: 'Reichweite zu kurz · keine Redundanz · Relevanz offen', buendel: ['B1', 'B6', 'B7'] },
      F02: { leistung: '✓ NEA 2, 100 kW', dauer: '✗ Tank ca. 24 h statt 14 Tage', unterbrechung: '✓ NEA startet in Sekunden',
        standort: '? Relevanz von S5 offen', typ: 'Reichweite zu kurz · Relevanz offen', buendel: ['B1', 'B7'] },
      F03: { leistung: '✗ keine Ersatzversorgung', dauer: '✗ keine Ersatzversorgung', unterbrechung: '✗ fällt bis zur Netzwiederkehr aus',
        typ: 'keine Ersatzversorgung', buendel: ['B2'] },
      F04: { leistung: '✗ keine Ersatzversorgung', dauer: '✗ keine Ersatzversorgung',
        typ: 'keine Ersatzversorgung', buendel: ['B5'] },
      F05: { leistung: '✗ Krisenlast unbekannt, Stecker ohne Aggregat', dauer: '✗ keine Ersatzversorgung',
        typ: 'keine Ersatzversorgung · Angabe fehlt', buendel: ['B5'] },
      F06: { leistung: '✗ keine Ersatzversorgung', dauer: '✗ keine Ersatzversorgung', redundanz: '✗ keine zweite Einspeisung',
        typ: 'keine Ersatzversorgung', buendel: ['B4'] },
      F07: { leistung: '✗ keine Ersatzversorgung', dauer: '✗ keine Ersatzversorgung', unterbrechung: '✗ Hochbehälter reicht nur ca. 2 h',
        redundanz: '✗ keine zweite Einspeisung', standort: '✗ im Überschwemmungsgebiet HQ100',
        typ: 'keine Ersatzversorgung · Standort gefährdet', buendel: ['B3'] },
      F08: { leistung: '✗ ohne Strom keine Zapfsäule', dauer: '✗ keine Ersatzversorgung',
        typ: 'keine Ersatzversorgung', buendel: ['B1'] },
      F09: { typ: 'keine Anforderung', buendel: ['B8'] },
      F10: { typ: 'Angaben fehlen', buendel: ['B8'] },
    }),
    buendel: Object.freeze([
      { id: 'B1', titel: 'Reichweite: die NEA laufen nur 24–48 h',
        zellen: 'F01, F02, F08 in S2 und S3; Kraftstoff aller neuen Anlagen aus B2 bis B4',
        soll: 'bis 14 Tage (S2), davon 7 Tage ohne Nachlieferung (S3)', ist: 'Tanks 150 l und 1.000 l; 20.000 l Diesel an der Tankstelle, die ohne Strom nicht zapfen kann',
        optionen: [
          { text: 'Tanks jeder NEA auf 14 Tage vergrößern (zusammen rund 18.000 l)', deckt: 'S2, S3', klasse: '✓', bestand: '✗',
            aufwand: 'hoch', bewertung: 'verworfen: viele Einzeltanks, Platz und Genehmigung, der Vorrat an der Tankstelle bleibt ungenutzt' },
          { text: 'Liefervertrag für Diesel im Krisenfall', deckt: 'S2 teilweise', klasse: '✗', bestand: '—',
            aufwand: 'gering', bewertung: 'verworfen: S3 unterstellt gerade, dass nichts nachgeliefert wird' },
          { text: 'Tankstelle notstromversorgen, Mindestbestand Diesel festlegen und die NEA daraus nachtanken', deckt: 'S2, S3',
            klasse: '✓', bestand: '✓', aufwand: 'gering', gewaehlt: true,
            bewertung: 'gewählt: nutzt den vorhandenen Vorrat, eine Lösung für alle NEA' },
        ],
        massnahmen: ['M01'],
        folge: 'Die Tankstelle wird damit selbst kritisch — deshalb ist sie in Schritt ② hochgestuft.' },
      { id: 'B2', titel: 'Unterkunft mit Sanitätsbereich ohne Ersatzversorgung',
        zellen: 'F03 in S1, S2, S3', soll: 'Klasse B · 45 kW · 7 Tage · Unterbrechung kleiner 4 h', ist: 'keine Ersatzversorgung',
        optionen: [
          { text: 'Über einen eigenen Abgang an NEA 1 anbinden (Reserve 150 − 57 = 93 kW)', deckt: 'S1, S2, S3', klasse: '✓',
            bestand: '✓', aufwand: 'gering', gewaehlt: true, bewertung: 'gewählt: Reserve reicht, Kabelweg ca. 150 m' },
          { text: 'Eigene NEA rund 60 kVA', deckt: 'S1, S2, S3', klasse: '✓', bestand: '✗', aufwand: 'mittel',
            bewertung: 'verworfen: nicht nötig, solange NEA 1 Reserve hat' },
          { text: 'Einspeisestecker und mobile NEA', deckt: 'S2, S3', klasse: '✗', bestand: '✗', aufwand: 'gering',
            bewertung: 'verworfen: Klasse B verlangt Versorgung binnen 4 h, ein mobiles Aggregat ist dafür nicht verlässlich' },
        ],
        massnahmen: ['M02'] },
      { id: 'B3', titel: 'Pumpenhaus ohne Ersatzversorgung, im Überschwemmungsgebiet',
        zellen: 'F07 in S1, S2, S4, S7', soll: 'Klasse B · 15 kW · 14 Tage · Unterbrechung kleiner 4 h, auch bei Hochwasser',
        ist: 'keine Ersatzversorgung; Hochbehälter reicht ca. 2 h',
        optionen: [
          { text: 'An NEA 1 anbinden (Reserve nach B2 noch 48 kW)', deckt: 'S1, S2', klasse: '✓', bestand: '✓', aufwand: 'mittel',
            bewertung: 'verworfen: Kabel durch das Überschwemmungsgebiet, S7 nicht gedeckt' },
          { text: 'Einspeisestecker und mobile NEA', deckt: 'S2', klasse: '✗', bestand: '✗', aufwand: 'gering',
            bewertung: 'verworfen: bei Hochwasser keine sichere Zufahrt; Klasse B' },
          { text: 'Eigene NEA rund 30 kVA, oberhalb HQ100 aufgestellt', deckt: 'S1, S2, S4, S7', klasse: '✓', bestand: '✗',
            aufwand: 'mittel', gewaehlt: true, bewertung: 'gewählt: deckt alle vier Szenarien mit einer Anlage' },
        ],
        massnahmen: ['M03'] },
      { id: 'B4', titel: 'Heizzentrale ohne Ersatzversorgung',
        zellen: 'F06 in S2, S3, S4', soll: 'nach Schritt ②: wie Klasse B · 28 kW · 7 Tage · Unterbrechung kleiner 12 h',
        ist: 'keine Ersatzversorgung; Brenner ohne Strom nicht betreibbar',
        optionen: [
          { text: 'An NEA 1 anbinden (Reserve nach B2 noch 48 kW)', deckt: 'S2, S3', klasse: '✓', bestand: '✓', aufwand: 'mittel',
            bewertung: 'verworfen: NEA 1 wäre zu 87 % belastet, A- und B-Funktionen hingen an einer Anlage von 1998' },
          { text: 'Einspeisestecker und mobile NEA', deckt: 'S2, S3', klasse: '✗', bestand: '✗', aufwand: 'gering',
            bewertung: 'verworfen: nach der Hochstufung nicht mehr zulässig (12 h, 7 Tage) — als Klasse C wäre das die Lösung gewesen' },
          { text: 'Eigene NEA rund 40 kVA; Umstellung des Zweistoffbrenners auf Heizöl im Notfallplan regeln', deckt: 'S2, S3, S4',
            klasse: '✓', bestand: '✓', aufwand: 'mittel', gewaehlt: true,
            bewertung: 'gewählt: unabhängig von NEA 1; Heizöl ist vorrätig, Kraftstoff über B1' },
        ],
        massnahmen: ['M04'],
        folge: 'Hier wirkt Schritt ②: ohne Hochstufung wäre die günstigere mobile Lösung gewählt worden.' },
      { id: 'B5', titel: 'Unterkunft und Küche ohne Ersatzversorgung',
        zellen: 'F04 und F05 in S2, S3', soll: 'Klasse C · 20 kW + Küche [offen] · 3 Tage · Unterbrechung kleiner 3 Tage',
        ist: 'keine; an der Küche ein Einspeisestecker ohne Aggregat',
        optionen: [
          { text: 'Eigene NEA je Gebäude', deckt: 'S2, S3', klasse: '✓', bestand: '✗', aufwand: 'hoch',
            bewertung: 'verworfen: für Klasse C unverhältnismäßig' },
          { text: 'Abrufvertrag für eine mobile NEA', deckt: 'S2 teilweise', klasse: '✓', bestand: '✓', aufwand: 'gering',
            bewertung: 'verworfen: im flächigen Blackout ist kein Aggregat verlässlich abrufbar' },
          { text: 'Eine mobile NEA rund 60 kVA mit Kraftstoff für 3 Tage vorhalten; Einspeisestecker an Geb. 10 nachrüsten',
            deckt: 'S2, S3', klasse: '✓', bestand: '✓', aufwand: 'gering', gewaehlt: true,
            bewertung: 'gewählt: Klasse C erlaubt eine mobile Lösung; Stecker an der Küche vorhanden' },
        ],
        massnahmen: ['M05', 'M06'],
        folge: 'Bemessen wird die mobile NEA erst, wenn die Krisenlast der Küche gemessen ist (M06).' },
      { id: 'B6', titel: 'Stabsgebäude: Ausfall der NEA 1 (n-1)',
        zellen: 'F01 in S4', soll: 'nach Ausfall eines Betriebsmittels binnen 1 h wieder versorgt', ist: 'eine NEA, USV 30 min, kein Einspeisepunkt',
        optionen: [
          { text: 'Zweite feste NEA am Stabsgebäude', deckt: 'S4', klasse: '✓', bestand: '✗', aufwand: 'hoch',
            bewertung: 'verworfen: Aufwand, solange eine mobile NEA auf der Liegenschaft steht' },
          { text: 'Zweite Netzeinspeisung (Ringschluss)', deckt: 'S4 teilweise', klasse: '✗', bestand: '✗', aufwand: 'hoch',
            bewertung: 'verworfen: hilft bei Kabelfehler, nicht bei Ausfall der NEA im Blackout' },
          { text: 'Einspeisestecker an Geb. 1; mobile NEA aus B5 mit Vorrang für Geb. 1; USV auf 60 min erweitern',
            deckt: 'S4', klasse: '✓', bestand: '✓', aufwand: 'gering', gewaehlt: true,
            bewertung: 'gewählt: die USV überbrückt das Umsetzen der mobilen NEA' },
        ],
        massnahmen: ['M07', 'M11'],
        folge: 'Doppelbelegung der mobilen NEA im Notfallplan regeln: fällt NEA 1 aus, geht Geb. 1 vor Unterkunft und Küche. '
          + 'Unabhängig davon NEA 1 erneuern (M11).' },
      { id: 'B7', titel: 'Physische Einwirkung (S5): Relevanz offen', zellen: 'F01, F02 in S5',
        soll: 'erst klären, ob S5 für die Liegenschaft gilt', ist: '—', optionen: [], massnahmen: ['M08'],
        folge: 'Keine Optionen, solange die Relevanz offen ist.' },
      { id: 'B8', titel: 'Keine Anforderung bzw. Angaben fehlen', zellen: 'F09, F10',
        soll: 'F09: abschalten dürfen · F10: nicht beurteilbar', ist: '—', optionen: [], massnahmen: ['M09', 'M10'] },
    ].map(b => Object.freeze({ ...b, optionen: Object.freeze(b.optionen.map(Object.freeze)), massnahmen: Object.freeze(b.massnahmen) }))),
    massnahmen: Object.freeze([
      { id: 'M01', text: 'Tankstelle Geb. 70 an NEA 2 anbinden (6 kW); Mindestbestand Diesel für 14 Tage aller NEA festlegen '
          + '(rund 18.000 l); Nachtanken der NEA aus der Tankstelle im Notfallplan regeln',
        fuer: ['F01', 'F02', 'F03', 'F06', 'F07', 'F08'], szenarien: ['S2', 'S3'], aus: 'B1',
        anlass: 'NEA-Tanks reichen 24–48 h, gefordert bis 14 Tage', art: 'technisch, organisatorisch', prio: 1,
        durch: 'Baudienststelle, Standortverwaltung' },
      { id: 'M02', text: 'Unterkunft mit Sanitätsbereich Geb. 12 über einen eigenen Abgang an NEA 1 anbinden (45 kW)',
        fuer: ['F03'], szenarien: ['S1', 'S2', 'S3'], aus: 'B2',
        anlass: 'Bettenstation ohne Ersatzversorgung', art: 'technisch', prio: 1, durch: 'Baudienststelle' },
      { id: 'M03', text: 'NEA für das Pumpenhaus Geb. 50, rund 30 kVA, hochwassersicher oberhalb HQ100 aufgestellt',
        fuer: ['F07'], szenarien: ['S1', 'S2', 'S4', 'S7'], aus: 'B3',
        anlass: 'Trink- und Löschwasser ohne Notstrom; Standort im Überschwemmungsgebiet', art: 'technisch', prio: 1,
        durch: 'Baudienststelle' },
      { id: 'M04', text: 'NEA für die Heizzentrale Geb. 60, rund 40 kVA; Umstellung des Zweistoffbrenners auf Heizöl im '
          + 'Notfallplan regeln',
        fuer: ['F06'], szenarien: ['S2', 'S3', 'S4'], aus: 'B4',
        anlass: 'Heizzentrale ohne Notstrom — ohne sie keine beheizte Unterkunft', art: 'technisch, organisatorisch', prio: 1,
        durch: 'Baudienststelle, Standortverwaltung' },
      { id: 'M05', text: 'Mobile NEA rund 60 kVA mit Kraftstoff für 3 Tage vorhalten; Einspeisestecker an Geb. 10 nachrüsten',
        fuer: ['F04', 'F05'], szenarien: ['S2', 'S3'], aus: 'B5',
        anlass: 'Unterkunft und Küche ohne Ersatzversorgung', art: 'technisch', prio: 2,
        durch: 'Standortverwaltung, Baudienststelle' },
      { id: 'M06', text: 'Krisenlast der Küche Geb. 40 messen — danach mobile NEA bemessen',
        fuer: ['F05'], szenarien: ['S2', 'S3'], aus: 'B5',
        anlass: 'Grundlage für die Bemessung fehlt', art: 'organisatorisch', prio: 1, durch: 'Standortverwaltung (bis 31.10.2026)' },
      { id: 'M07', text: 'Einspeisestecker für eine mobile NEA an Geb. 1 nachrüsten; USV des Serverraums auf 60 min erweitern; '
          + 'Vorrang von Geb. 1 für die mobile NEA im Notfallplan',
        fuer: ['F01'], szenarien: ['S4'], aus: 'B6',
        anlass: 'Fällt NEA 1 aus, ist die Versorgung binnen 1 h wiederherzustellen', art: 'technisch, organisatorisch', prio: 2,
        durch: 'Baudienststelle, Standortverwaltung' },
      { id: 'M08', text: 'Relevanz von Szenario S5 klären; falls relevant: Zugangsschutz und Überwachung der Übergabe- und Trafostationen',
        fuer: ['F01', 'F02'], szenarien: ['S5'], aus: 'B7',
        anlass: 'Zwei Funktionen haben S5 angekreuzt, die Relevanz ist aber offen', art: 'Klärung', prio: 1, durch: 'zuständige Stelle' },
      { id: 'M09', text: 'Abschaltplan (Lastabwurf) für Verwaltung und Ausbildung in den Netzersatzbetriebsplan aufnehmen; '
          + 'Inselbetrieb der Liegenschaft jährlich üben',
        fuer: ['F09'], szenarien: [], aus: 'B8',
        anlass: 'Entlastet die Ersatzversorgung; Inselbetrieb wurde noch nie geübt', art: 'organisatorisch', prio: 2,
        durch: 'Standortverwaltung' },
      { id: 'M10', text: 'Angaben zur Betreuungseinrichtung beim Pächter nachfordern',
        fuer: ['F10'], szenarien: [], aus: 'B8',
        anlass: 'Funktion nicht beurteilbar, kein Szenario angegeben', art: 'Klärung', prio: 1, durch: 'Standortverwaltung' },
      { id: 'M11', text: 'NEA 1 (Baujahr 1998) erneuern',
        fuer: ['F01', 'F03'], szenarien: [], aus: 'B6',
        anlass: 'Nach M02 trägt NEA 1 rund 100 kW für Funktionen der Klassen A und B; Ersatzteilversorgung unsicher',
        art: 'technisch', prio: 3, durch: 'Baudienststelle' },
    ].map(m => Object.freeze({ ...m, fuer: Object.freeze(m.fuer), szenarien: Object.freeze(m.szenarien) }))),
  }),
});

/** 0-basierter Index der Kopfzeile auf den Tabellenblättern 2 bis 4. */
export const RA_KOPFZEILE = 3;
/** 0-basierter Index der ersten Antwortzeile auf den Frage-Antwort-Blättern. */
export const RA_FRAGE_START = 3;

const _titel = t => [{ w: t, s: XS.titel }];
const _hinweis = t => [{ w: t, s: XS.hinweis }];

/** Zeilenhöhe in Punkt für Texte in Spalten der angegebenen Breiten (mindestens eine Zeile). */
const _hoeheFuer = (...paare) => Math.max(1, ...paare.map(([t, b]) => _linien(t, b))) * 15;

/** Hinweiszeile (Zeile 2) über `spalten` Spalten verbinden und ihre Höhe setzen. */
function _hinweisVerbinden(blatt, spalten) {
  const n = Math.min(spalten, blatt.spalten.length);
  const breite = blatt.spalten.slice(0, n).reduce((a, sp) => a + (sp?.breite || 12), 0);
  blatt.verbunden = [...(blatt.verbunden || []), `A2:${spalteZuBuchstabe(n - 1)}2`];
  blatt.zeilenHoehe = { ...(blatt.zeilenHoehe || {}), 1: _hoeheFuer([blatt.zeilen[1]?.[0]?.w, breite]) };
  return blatt;
}

/** Ein Frage-Antwort-Blatt aufbauen. */
function _frageBlatt(name, ueberschrift, hinweis, felder, meta) {
  const B_FRAGE = 58, B_ANTWORT = 80;
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
    const h = Math.max(f.hoehe || 0, _hoeheFuer([f.frage, B_FRAGE], [vorbelegt, B_ANTWORT]));
    if (h > 15) zeilenHoehe[r] = h;
    if (f.liste) pruefungen.push({ bereich: `B${r + 1}`, liste: f.liste, titel: 'Auswahl', hinweis: 'Bitte einen Wert aus der Liste wählen.' });
  });
  return _hinweisVerbinden({
    name, zeilen, zeilenHoehe, pruefungen,
    spalten: [{ breite: B_FRAGE }, { breite: B_ANTWORT }],
    fixZeilen: RA_FRAGE_START,
  }, 2);
}

/** Reiterfarben: gelb = füllt der Empfänger aus, blau = Beispiel bzw. Auswertung der erhebenden Stelle. */
const _TAB = Object.freeze({ anleitung: 'FF266426', eingabe: 'FFFFC000', beispiel: 'FF5B9BD5', auswertung: 'FF2F5597' });

/**
 * Blatt „0 Anleitung": Zweck, Aufbau der Datei, Ausfüllhinweise, Ablauf,
 * Einstufungshinweis, Begriffe. Spalten: A Rand · B Blatt bzw. Begriff ·
 * C ausgeblendet (Versionskennung in C1) · D Inhalt · E füllt aus. Fließtext
 * steht über B bis E verbunden.
 */
function _anleitungBlatt(meta) {
  const breiten = [3, 30, 10, 66, 18];
  const B_TEXT = 30 + 66 + 18;
  const zeilen = [], verbunden = [], zeilenHoehe = {};
  const zeile = (zellen, hoehe) => { if (hoehe > 15) zeilenHoehe[zeilen.length] = hoehe; zeilen.push(zellen); };
  const text = (t, s = XS.fliess) => {
    verbunden.push(`B${zeilen.length + 1}:E${zeilen.length + 1}`);
    zeile([null, { w: t, s }, { w: null, s }, { w: null, s }, { w: null, s }], _hoeheFuer([t, B_TEXT]));
  };
  const abschnitt = t => { zeile([]); text(t, XS.abschnitt); };
  // Tabellenzeile: Spalte B, dann D und E (C ist ausgeblendet)
  const tabelle = (b, d, e, s = XS.text) => {
    const z = [null, { w: b, s }, { w: null, s }, { w: d, s }, { w: e ?? null, s }];
    if (e === undefined) { verbunden.push(`D${zeilen.length + 1}:E${zeilen.length + 1}`); z[4] = { w: null, s }; }
    zeile(z, _hoeheFuer([b, 30], [d, e === undefined ? 84 : 66], [e, 18]));
  };

  // Zeile 1: Titel; C1 trägt die Versionskennung für den Import.
  zeile([null, { w: 'Abfrage: Resilienzanforderungen der Liegenschaft', s: XS.titel }, { w: RA_KENNUNG, s: XS.standard }]);
  text(meta?.lieg ? `Liegenschaft: ${meta.lieg}` : 'Liegenschaft: [bitte auf Blatt „1 Allgemeines" eintragen]', XS.fett);
  text(`Stand der Vorlage: ${meta?.stand || ''}${meta?.empfaenger ? `   ·   Empfänger: ${meta.empfaenger}` : ''}`, XS.hinweis);

  abschnitt('Wozu diese Abfrage?');
  text('Für das Energiekonzept der Liegenschaft wird gebraucht, welche Funktionen bei einem Ausfall der '
    + 'Versorgung weiterlaufen müssen, wie lange und mit welcher Leistung. Diese Angaben sind eine '
    + 'Eingangsgröße der Planung — ohne sie lässt sich weder eine Ersatzversorgung auslegen noch '
    + 'beurteilen, ob die vorhandene ausreicht.');
  text('Die Zuständigkeit für die Resilienz der Liegenschaft liegt nicht bei der erhebenden Stelle. '
    + 'Mit dieser Abfrage wird nichts festgelegt und nichts angeordnet: Wir fragen ab, was die '
    + 'zuständige Stelle vorgegeben hat und was vor Ort eingeschätzt wird. Was davon Vorgabe und was '
    + 'Einschätzung ist, wird in der Spalte „Herkunft der Angaben" festgehalten.');
  text('Gefragt wird nach den Auswirkungen eines Ausfalls, nicht nach einer Resilienz- oder Schutzklasse. '
    + 'Die Einordnung in Klassen nimmt die erhebende Stelle anschließend vor und legt sie zur Abstimmung vor.');

  abschnitt('Aufbau der Datei');
  tabelle('Blatt', 'Inhalt', 'Füllt aus', XS.kopf);
  tabelle(RA_BLATT.anleitung, 'Diese Hinweise', '—');
  tabelle(RA_BLATT.beispiel, 'Eine erfundene, fertig ausgefüllte Abfrage zum Nachschlagen; Spalte A erklärt jede Zeile', '—');
  tabelle(RA_BLATT.allgemeines, 'Grunddaten der Liegenschaft und vorhandene Vorgaben', 'Sie');
  tabelle(RA_BLATT.szenarien, 'Welche Ausfälle für die Liegenschaft zu unterstellen sind und wie lange', 'Sie');
  tabelle(RA_BLATT.kategorien, 'Freiwillig: gleichartige Gebäude einmal beschreiben (siehe unten)', 'Sie');
  tabelle(RA_BLATT.funktionen, 'Das Kernblatt: eine Zeile je Funktion — Auswirkung eines Ausfalls, Dauer, Krisenlast', 'Sie');
  tabelle(RA_BLATT.bestand, 'Was heute vorhanden ist: Netzersatzanlagen, USV, Brennstoff, Pläne', 'Sie');
  tabelle(RA_BLATT.rueckmeldung, 'Offene Punkte, Rückfragen und Freigabe', 'Sie und die zuständige Stelle');
  text('Gelbe Reiter füllen Sie aus, blaue Reiter sind Beispiele. Was aus Ihren Angaben wird — Anforderungen, Lücken, '
    + 'Lösungsweg und Maßnahmen —, zeigt die Beispieldatei auf den Reitern 7 bis 10. Diese Reiter füllen nicht Sie aus.',
  XS.hinweis);

  abschnitt('So füllen Sie die Datei aus');
  text('• Nur die gelb hinterlegten Zellen sind zum Ausfüllen freigegeben; alles andere ist gegen '
    + 'versehentliches Überschreiben gesperrt. Der Schutz hat kein Passwort.');
  text('• Viele Zellen haben eine Auswahlliste (kleiner Pfeil rechts in der Zelle). Bitte daraus wählen.');
  text('• „unbekannt" ist eine zulässige und ausdrücklich erwünschte Antwort. Eine offene Lücke ist für '
    + 'die weitere Planung wertvoller als eine geratene Zahl — offene Punkte kommen als Rückfrageliste zurück.');
  text('• Auf Blatt „4 Funktionen" darf die Liste erweitert werden: Zeilen einfügen oder die vorbereiteten '
    + 'Leerzeilen am Ende nutzen. Auswahllisten und Formatierung gelten dort bereits.');

  abschnitt('Viele gleichartige Gebäude? Kategorien nutzen');
  text('Gibt es mehrere Gebäude mit derselben Nutzung (z. B. zwanzig Unterkunftsgebäude), müssen Sie nicht jede '
    + 'Zeile einzeln ausfüllen:');
  text('1. Auf Blatt „3 Kategorien" die Kategorie einmal beschreiben (Betriebszeit, Auswirkungen, Autarkie, Szenarien …).');
  text('2. Auf Blatt „4 Funktionen" in der Spalte „Kategorie" die Kategorie auswählen. Die übrigen Zellen der Zeile '
    + 'bleiben leer — sie werden beim Auswerten aus der Kategorie übernommen.');
  text('3. Weicht ein einzelnes Gebäude ab, tragen Sie nur die abweichende Angabe in dessen Zeile ein. '
    + 'Was in der Zeile steht, geht immer vor. Szenario-Kreuze gelten als Ganzes: steht in der Zeile ein Kreuz, '
    + 'zählen nur die Kreuze dieser Zeile.');
  text('Die Krisenlast [kW] und die vorhandene Ersatzversorgung gehören zum einzelnen Gebäude und stehen deshalb '
    + 'nur auf Blatt „4 Funktionen".', XS.hinweis);

  abschnitt('Wie geht es weiter? Wer macht was');
  text('1. Sie (Bedarfsträger bzw. Nutzer) füllen die Blätter 1 bis 6 aus; die zuständige Stelle gibt sie frei (Blatt 6).');
  text('2. Die erhebende Stelle leitet daraus je Funktion eine messbare Anforderung ab (Klasse, Krisenlast, Dauer, '
    + 'Unterbrechung) und stimmt sie mit der zuständigen Stelle ab.');
  text('3. Sie prüft, welche Funktionen von anderen abhängen (Wärme, Wasser, Kraftstoff), vergleicht für jedes angekreuzte '
    + 'Szenario Soll und Bestand und wägt für jede Lücke die möglichen Lösungen ab. Die gewählte Lösung wird als '
    + 'Maßnahme vorgeschlagen.');
  text('4. Über die Maßnahmen entscheidet die zuständige Stelle und veranlasst die Umsetzung.');
  text('5. Offene Punkte kommen als Rückfrageliste zu Ihnen zurück.');

  abschnitt('Keine eingestuften Inhalte');
  text('In diese Datei gehören keine Verschlusssachen und keine eingestuften Angaben. Gibt es eingestufte '
    + 'Vorgaben, tragen Sie bitte nur ein, DASS es sie gibt und WELCHE STELLE sie herausgegeben hat — '
    + 'nicht den Inhalt. Auch Funktionen, die nicht offen benannt werden können, bitte nur neutral '
    + 'bezeichnen und in der Bemerkung auf die zuständige Stelle verweisen.');

  abschnitt('Begriffe');
  tabelle('Funktion', 'Die Aufgabe, die weiterlaufen muss (z. B. „Wache / Zugangskontrolle"), nicht die Anlage, die sie '
    + 'versorgt. Anforderungen werden an Funktionen gestellt, weil die Technik dahinter austauschbar ist.');
  tabelle('Krisenlast', 'Die elektrische Leistung in Kilowatt (kW), die die Funktion im Krisenbetrieb tatsächlich braucht. '
    + 'Das ist meist deutlich weniger als die Anschlussleistung, weil im Krisenfall nicht alles läuft.');
  tabelle('Autarkie', 'Wie lange die Funktion ohne Versorgung aus dem öffentlichen Netz weiterlaufen muss (z. B. 3 Tage). '
    + 'Nicht, wie lange sie es heute tatsächlich könnte.');
  tabelle('Unterbrechung', 'Wie lange die Funktion beim Umschalten ausfallen darf. Null Sekunden bedeutet unterbrechungsfrei '
    + '(USV); ein Netzersatzaggregat braucht typischerweise 10 bis 15 Sekunden.');
  tabelle('Wiederherstellung', 'Wie schnell die Versorgung nach dem Ausfall eines einzelnen Betriebsmittels (Kabel, Trafo, '
    + 'Schaltfeld) wieder stehen muss.');

  abschnitt('Rückfragen');
  text(meta?.ansprechpartner || '[Ansprechpartner, Dienststelle, Telefon, E-Mail]', meta?.ansprechpartner ? XS.fliess : XS.hinweis);
  zeile([]);
  text('Bitte die ausgefüllte Datei unverändert als .xlsx zurücksenden — sie wird maschinell ausgewertet. '
    + 'Blätter oder Spalten bitte nicht löschen oder umbenennen.', XS.hinweis);

  return {
    name: RA_BLATT.anleitung,
    zeilen, verbunden, zeilenHoehe,
    spalten: breiten.map((breite, i) => ({ breite, ...(i === RA_KENNUNG_ZELLE.spalte ? { verborgen: true } : {}) })),
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
  return _hinweisVerbinden({
    name: RA_BLATT.szenarien, zeilen,
    spalten: [{ breite: 6 }, { breite: 54 }, { breite: 16 }, { breite: 16 }, { breite: 18 }, { breite: 34 }],
    zeilenHoehe: { [RA_KOPFZEILE]: 32 },
    fixZeilen: RA_KOPFZEILE + 1,
    pruefungen: [
      { bereich: `C${von}:C${bis}`, liste: 'L_Relevant', titel: 'Relevanz', hinweis: 'ja / nein / unbekannt' },
      { bereich: `E${von}:E${bis}`, liste: 'L_Herkunft', titel: 'Herkunft', hinweis: 'Vorgabe der zuständigen Stelle oder Einschätzung vor Ort?' },
    ],
  }, 6);
}

/**
 * Tabellenblatt mit Kopfzeile, Eingabezeilen und Datenüberprüfung — Grundlage
 * für „3 Kategorien" und „4 Funktionen".
 */
function _tabellenBlatt({ name, ueberschrift, hinweis, spalten, daten, leerzeilen, idVon, fixSpalten = 0 }) {
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

  return _hinweisVerbinden({
    name, zeilen, pruefungen,
    spalten: spalten.map(s => ({ breite: s.breite || 14 })),
    zeilenHoehe: { [RA_KOPFZEILE]: 58 },
    fixZeilen: RA_KOPFZEILE + 1,
    fixSpalten,
    datenBis: bis,
  }, 10);
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
    fixSpalten: 1,
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
    fixSpalten: 2,
  });
}

/**
 * Blatt „Beispiel (ausgefüllt)": wie eine ausgefüllte Abfrage aussieht. Wird nicht eingelesen.
 *
 * Damit das Blatt auch gedruckt lesbar bleibt, stehen Kategorien und
 * Funktionen in zwei Teilen untereinander: Teil 1 Auswirkungen und Szenarien,
 * Teil 2 Leistung, Ersatzversorgung und Abhängigkeiten. Alle Abschnitte teilen
 * ein Spaltenraster (A erklärt die Zeile, B bis R wie Teil 1); in Teil 2 und
 * bei Szenarien und Fragen werden Zellen verbunden. Die Kategorien stehen
 * jeweils genau über den Funktionsspalten, die sie vererben.
 */
function _beispielBlatt() {
  const B = RA_BEISPIEL;
  const sz = RA_SZENARIEN.map(s => ({ feld: 'sz_' + s.id }));
  const TEIL1_F = [{ feld: 'id' }, { feld: 'name' }, { feld: 'geb' }, { feld: 'kategorie' }, { feld: 'betrieb' },
    { feld: 'ausw_s' }, { feld: 'ausw_4h' }, { feld: 'ausw_3d' }, { feld: 'autarkie' }, ...sz, { feld: 'reduziert' }];
  const TEIL2_F = [{ feld: 'id' }, { feld: 'name' }, { feld: 'geb' }, { feld: 'pk' }, { feld: 'pk_art' },
    { feld: 'ersatz' }, { feld: 'ersatz_info' }, { feld: 'abh', n: 2 }, { feld: 'herkunft', n: 4 }, { feld: 'bem', n: 4 }];
  const TEIL1_K = [{ n: 3 }, ...TEIL1_F.slice(3)];
  const TEIL2_K = [{ n: 1 }, { feld: 'kategorie', n: 2 }, { n: 4 }, ...TEIL2_F.slice(-3)];

  const titel = new Map([...RA_FUNKTION_SPALTEN, ...RA_KATEGORIE_SPALTEN].map(s => [s.feld, s.titel]));
  const breite = new Map(RA_FUNKTION_SPALTEN.map(s => [s.feld, s.breite || 14]));
  const breiten = [46, ...TEIL1_F.map(s => Math.min(30, breite.get(s.feld)))];
  const n = breiten.length;
  const bau = _zeilenBauer(breiten);
  const wert = v => (v == null || v === '' ? null : v);
  // Gedruckt beginnt jeder größere Abschnitt auf einer neuen Seite (`neueSeite`)
  const umbrueche = [];
  const abschnitt = (t, neueSeite = false) => {
    bau.leer();
    if (neueSeite) umbrueche.push(bau.zeilen.length);
    bau.zeile([{ w: t, s: XS.abschnitt, n }]);
  };

  bau.zeile([{ w: 'Beispiel (ausgefüllt)', s: XS.titel }]);
  bau.zeile([{ w: 'Erfundene Liegenschaft — so sieht eine fertig ausgefüllte Abfrage aus, Blatt für Blatt. Diese Angaben macht '
    + 'der Empfänger; was daraus wird, zeigen die Reiter 7 bis 10 der Beispieldatei. Das Blatt wird nicht ausgewertet und kann '
    + 'nicht bearbeitet werden. Blau = Beispielwerte; Spalte A erklärt, wie die Zeile gelesen wird.', s: XS.hinweis, n: 10 }]);

  // Frage-Antwort-Abschnitte: Frage in A, Antwort über B bis F verbunden
  const frageAbschnitt = (t, felder, antworten, neueSeite = false) => {
    abschnitt(t, neueSeite);
    bau.zeile([{ w: 'Frage', s: XS.kopf }, { w: 'Antwort', s: XS.kopf, n: 5 }]);
    for (const f of felder) bau.zeile([{ w: f.frage, s: XS.text }, { w: wert(antworten[f.feld]), s: XS.beispiel, n: 5 }]);
  };

  /** Ein Tabellenteil: Kopfzeile aus `spalten` ({feld?, n?}; ohne feld = leere Lücke), dann je Datensatz eine Zeile. */
  const teil = (ueberschrift, spalten, daten, erklaerung, neueSeite = false) => {
    if (neueSeite) umbrueche.push(bau.zeilen.length);
    bau.zeile([{ w: ueberschrift, s: XS.fett, n }]);
    bau.zeile([{ w: erklaerung ? 'So wird die Zeile gelesen' : 'Dieselben Zeilen, Fortsetzung', s: XS.kopf },
      ...spalten.map(s => ({ w: s.feld ? titel.get(s.feld) : null, s: XS.kopf, n: s.n || 1 }))]);
    for (const d of daten) {
      bau.zeile([{ w: erklaerung ? (d.erl || null) : null, s: XS.fliess },
        ...spalten.map(s => (s.feld ? { w: wert(d[s.feld]), s: XS.beispiel, n: s.n || 1 } : { w: null, s: XS.standard, n: s.n || 1 }))]);
    }
  };

  frageAbschnitt('Blatt „1 Allgemeines"', RA_ALLGEMEIN_FELDER, B.allgemein);

  // Szenarien: ID · Referenzszenario (2 Spalten) · Relevant · Dauer · Herkunft · Bemerkung (3 Spalten)
  abschnitt('Blatt „2 Szenarien"');
  const szName = new Map(RA_SZENARIEN.map(s => [s.id, s.name]));
  bau.zeile([{ w: 'So wird die Zeile gelesen', s: XS.kopf }, { w: 'ID', s: XS.kopf }, { w: 'Referenzszenario', s: XS.kopf, n: 2 },
    { w: 'Relevant für die Liegenschaft?', s: XS.kopf }, { w: 'Angenommene Dauer', s: XS.kopf },
    { w: 'Herkunft der Angabe', s: XS.kopf }, { w: 'Bemerkung', s: XS.kopf, n: 3 }]);
  for (const d of B.szenarien) {
    bau.zeile([{ w: d.erl || null, s: XS.fliess }, { w: d.id, s: XS.beispiel }, { w: szName.get(d.id), s: XS.beispiel, n: 2 },
      { w: wert(d.relevant), s: XS.beispiel }, { w: wert(d.dauer), s: XS.beispiel },
      { w: wert(d.herkunft), s: XS.beispiel }, { w: wert(d.bem), s: XS.beispiel, n: 3 }]);
  }

  abschnitt('Blatt „3 Kategorien" — einmal je Gebäudeart', true);
  bau.zeile([{ w: 'Die Spalten stehen genau über denen von Blatt 4: so ist zu sehen, welche Angabe eine Funktionszeile von '
    + 'ihrer Kategorie übernimmt.', s: XS.hinweis, n: 10 }]);
  teil('Teil 1 — Auswirkungen und Szenarien', TEIL1_K, B.kategorien, true);
  bau.leer();
  teil('Teil 2 — Abhängigkeiten und Herkunft', TEIL2_K, B.kategorien, false);

  abschnitt('Blatt „4 Funktionen" — eine Zeile je Funktion bzw. Gebäude', true);
  bau.zeile([{ w: 'Auf Blatt 4 steht jede Funktion in einer einzigen Zeile; hier ist sie zum Lesen in zwei Teile getrennt.',
    s: XS.hinweis, n: 10 }]);
  teil('Teil 1 — Auswirkungen und Szenarien', TEIL1_F, B.funktionen, true);
  bau.leer();
  teil('Teil 2 — Leistung, Ersatzversorgung und Abhängigkeiten', TEIL2_F, B.funktionen, false, true);

  frageAbschnitt('Blatt „5 Bestand und Organisation"', RA_BESTAND_FELDER, B.bestand, true);
  frageAbschnitt('Blatt „6 Rückmeldung"', RA_RUECKMELDUNG_FELDER, B.rueckmeldung);

  return { ..._blattAus(RA_BLATT.beispiel, bau, breiten), fixSpalten: 1, umbrueche };
}

/** Zellwerte eines Blatts wie aus lib/xlsx-leser.js (nur die Werte, ohne Stil). */
const _nurWerte = blatt => blatt.zeilen.map(z => (z || []).map(c => (c && typeof c === 'object' ? c.w ?? null : c ?? null)));

/**
 * Die Beispielangaben so, wie das Einlesen sie liefert — mit übernommenen
 * Kategoriewerten und Klassenvorschlag. Grundlage des Auswertungsblatts.
 */
export function raBeispielDaten() {
  const B = RA_BEISPIEL;
  const ohneErl = ({ erl, ...rest }) => rest;
  return raLesen({
    [RA_BLATT.szenarien]: _nurWerte(_szenarienBlatt(B.szenarien)),
    [RA_BLATT.kategorien]: _nurWerte(_kategorienBlatt(B.kategorien.map(ohneErl), 0)),
    [RA_BLATT.funktionen]: _nurWerte(_funktionenBlatt(B.funktionen.map(ohneErl), 0)),
  });
}

// ── Absicherung je Szenario ─────────────────────────────────────────────────
// Glied 4 und 5 der Ableitungskette: Aus jeder Funktion und den Szenarien, die
// für sie angekreuzt sind, folgt je Szenario eine Anforderung. Diese ist heute
// entweder schon erfüllt (vorhandene Ersatzversorgung) oder eine Maßnahme
// schließt die Lücke. Eine Maßnahme sichert die Funktionen in `fuer` in den
// Szenarien `szenarien` ab. Die Abfrage selbst legt keine Maßnahmen fest — die
// Liste stammt von der erhebenden Stelle (im Beispiel: RA_BEISPIEL.auswertung).
// Hinweis: „vorhanden" heißt hier nur, dass eine wirksame Ersatzversorgung da
// ist — ob sie lange genug reicht, prüft erst die Lückenanalyse (Schritt ③).

/** Status einer Funktion in einem Szenario. */
export const RA_ABSICHERUNG = Object.freeze({
  nicht:      Object.freeze({ label: '—',              text: 'Szenario für die Funktion nicht angekreuzt' }),
  irrelevant: Object.freeze({ label: 'nicht relevant', text: 'Szenario für die Liegenschaft nicht relevant' }),
  vorhanden:  Object.freeze({ label: 'vorhanden',      text: 'heute abgesichert, keine Maßnahme nötig' }),
  massnahme:  Object.freeze({ label: 'Maßnahme',       text: 'Lücke — eine Maßnahme sichert ab' }),
  offen:      Object.freeze({ label: 'offen',          text: 'Lücke ohne Maßnahme' }),
});

const _ERSATZ_WIRKT = new Set(['USV', 'NEA', 'USV+NEA']);

/**
 * Was eine Funktion in einem Szenario braucht — kurz, als Zelltext.
 * @param {object} f  Funktion aus raLesen
 * @param {object} s  Szenario aus raLesen ({id, relevant, dauer})
 * @param {object} [opt]
 * @param {Record<string,string>} [opt.wiederherstellung]  abgestimmte Zeit je Klasse
 */
export function raSzenarioAnforderung(f, s, opt = {}) {
  if (f?.autarkie_h === 0) return 'keine Ersatzversorgung — Abgang abschalten';
  const klasse = RA_KLASSEN[f?.klasse] || RA_KLASSEN[f?.klasse_vorschlag] || RA_KLASSEN.D;
  const p = f?.pk != null ? `${f.pk.toLocaleString('de-DE')} kW` : 'Krisenlast [offen]';
  const autarkie = raDauerText(f?.autarkie_h);
  const dauer = raText(s?.dauer) || '[offen]';
  switch (s?.id) {
    case 'S1': return `${p} über ${dauer} überbrücken; Unterbrechung ${klasse.unterbrechung}`;
    case 'S2': return `${p} für ${autarkie} autark; Unterbrechung ${klasse.unterbrechung}`;
    case 'S3': {
      const sH = raAutarkieStunden(s?.dauer);
      const h = f?.autarkie_h != null && sH != null ? Math.min(f.autarkie_h, sH) : null;
      return `Kraftstoff für ${h != null ? raDauerText(h) : '[offen]'} vor Ort, ohne Nachlieferung`;
    }
    case 'S4': return `nach Ausfall eines Betriebsmittels binnen ${raText(opt.wiederherstellung?.[klasse.key]) || '[offen]'} wieder versorgt`;
    case 'S5': return 'Versorgung trotz Einwirkung an Übergabe- oder Trafostation'
      + (s?.relevant === 'unbekannt' ? ' (Relevanz offen)' : '');
    case 'S6': return 'Versorgung trotz Ausfall der Leit- und Fernwirktechnik';
    case 'S7': return `Betrieb über ${dauer} trotz Hochwasser, Brand oder Sturm`;
    default: return '[offen]';
  }
}

/**
 * Absicherungsmatrix: je Funktion und Szenario Anforderung, Status und die
 * Maßnahmen, die dort wirken. Maßnahmen, die für eine Funktion gelten, aber in
 * keinem ihrer angekreuzten Szenarien, stehen unter `uebergreifend`.
 * @param {object} daten  aus raLesen
 * @param {Array<{id:string, fuer:string[], szenarien:string[]}>} massnahmen
 * @param {object} [opt]  wie raSzenarioAnforderung
 */
export function raAbsicherung(daten, massnahmen, opt = {}) {
  const szenarien = daten?.szenarien || [];
  const ord = { A: 0, B: 1, C: 2, D: 3 };
  const funktionen = [...(daten?.funktionen || [])].sort((x, y) =>
    (ord[x.klasse || x.klasse_vorschlag] ?? 9) - (ord[y.klasse || y.klasse_vorschlag] ?? 9)
    || String(x.id).localeCompare(String(y.id), 'de'));
  const zeilen = funktionen.map(f => {
    const eigene = (massnahmen || []).filter(m => m.fuer.includes(f.id));
    const benutzt = new Set();
    const zellen = {};
    for (const s of szenarien) {
      if (!f.sz?.[s.id]) { zellen[s.id] = { status: 'nicht', massnahmen: [] }; continue; }
      if (s.relevant === 'nein') { zellen[s.id] = { status: 'irrelevant', massnahmen: [] }; continue; }
      const ids = eigene.filter(m => m.szenarien.includes(s.id)).map(m => m.id);
      ids.forEach(id => benutzt.add(id));
      const status = ids.length ? 'massnahme' : _ERSATZ_WIRKT.has(f.ersatz) ? 'vorhanden' : 'offen';
      zellen[s.id] = { status, massnahmen: ids, anforderung: raSzenarioAnforderung(f, s, opt) };
    }
    return { f, zellen, uebergreifend: eigene.filter(m => !benutzt.has(m.id)).map(m => m.id) };
  });
  return { szenarien, zeilen };
}

// ── Beispieldatei: Reiter 7 bis 10 (füllt die erhebende Stelle aus) ─────────
// Der Weg von der Funktion zur Maßnahme in fünf Schritten:
//   ① Anforderung je Funktion (Reiter 7)  ② Abhängigkeiten (Reiter 7)
//   ③ Lücken: Soll-Ist je Prüfpunkt (Reiter 8)
//   ④ Optionen je Lückenbündel abwägen (Reiter 9)  ⑤ Maßnahmen (Reiter 10)

export const RA_SCHRITTE = Object.freeze(['① Anforderung', '② Abhängigkeiten', '③ Lücken', '④ Optionen', '⑤ Maßnahmen']);

/**
 * Die fünf Prüfpunkte des Soll-Ist-Vergleichs. Jeder gehört zu bestimmten
 * Szenarien (`null` = jedes angekreuzte); hat die Funktion keines davon
 * angekreuzt, entfällt der Prüfpunkt.
 */
export const RA_PRUEFPUNKTE = Object.freeze([
  Object.freeze({ feld: 'leistung',      titel: 'Leistung',      szenarien: null,
    frage: 'Ist eine Ersatzversorgung mit genug Leistung da?' }),
  Object.freeze({ feld: 'dauer',         titel: 'Dauer',         szenarien: Object.freeze(['S2', 'S3']),
    frage: 'Reicht sie so lange wie gefordert?' }),
  Object.freeze({ feld: 'unterbrechung', titel: 'Unterbrechung', szenarien: Object.freeze(['S1']),
    frage: 'Ist sie schnell genug da?' }),
  Object.freeze({ feld: 'redundanz',     titel: 'Redundanz',     szenarien: Object.freeze(['S4']),
    frage: 'Übersteht sie den Ausfall eines Betriebsmittels?' }),
  Object.freeze({ feld: 'standort',      titel: 'Standort',      szenarien: Object.freeze(['S5', 'S7']),
    frage: 'Ist sie vor Einwirkung, Hochwasser und Brand geschützt?' }),
]);

/** Typische Optionen je Lückentyp — der Katalog, aus dem in Schritt ④ gewählt wird. */
export const RA_LUECKENTYPEN = Object.freeze([
  Object.freeze({ typ: 'keine Ersatzversorgung',
    optionen: 'an eine vorhandene NEA anbinden (Reserve prüfen) · eigene NEA · Einspeisestecker und mobile NEA · '
      + 'NEA an der Trafostation mit Abschaltung der übrigen Abgänge' }),
  Object.freeze({ typ: 'Reichweite zu kurz', optionen: 'Tank vergrößern · Nachtanken vor Ort sichern · Liefervertrag · Last senken' }),
  Object.freeze({ typ: 'Unterbrechung zu lang', optionen: 'USV · automatischer Start der NEA' }),
  Object.freeze({ typ: 'keine Redundanz', optionen: 'Einspeisestecker für eine mobile NEA · zweite NEA · zweite Einspeisung (Ringschluss)' }),
  Object.freeze({ typ: 'Standort gefährdet', optionen: 'geschützt bzw. hochwassersicher aufstellen · Zugangsschutz · Ausweichstandort' }),
  Object.freeze({ typ: 'Relevanz offen / Angabe fehlt', optionen: 'erst klären bzw. messen, dann bemessen' }),
  Object.freeze({ typ: 'keine Anforderung', optionen: 'in den Abschaltplan (Lastabwurf) aufnehmen' }),
]);

/** Was die Klasse für die Wahl der Option bedeutet. */
export const RA_KLASSEN_LEITREGEL = Object.freeze({
  A: 'stationär, unterbrechungsfrei (USV) und redundant',
  B: 'stationär oder eine fest zugeordnete NEA',
  C: 'mobile NEA über einen Einspeisestecker zulässig',
  D: 'abschalten',
});

/** Geschätzte Zeilenzahl eines umbrochenen Texts bei `b` Zeichen je Zeile — wortweise wie Excel. */
function _linien(text, b) {
  return String(text ?? '').split('\n').reduce((n, absatz) => {
    let zeilen = 1, lauf = 0;
    for (const wort of absatz.split(/\s+/).filter(Boolean)) {
      if (lauf && lauf + 1 + wort.length > b) { zeilen++; lauf = wort.length; } else lauf += (lauf ? 1 : 0) + wort.length;
      if (lauf > b) { zeilen += Math.ceil(lauf / b) - 1; lauf %= b; }
    }
    return n + zeilen;
  }, 0);
}

/**
 * Kleiner Zeilenbauer für die Auswertungsreiter: Zellen mit `n` > 1 werden
 * verbunden, und die Zeilenhöhe wird aus der Textlänge geschätzt (Excel passt
 * verbundene Zellen nicht selbst an; eine Breiteneinheit fasst knapp ein Zeichen Fließtext).
 */
function _zeilenBauer(breiten) {
  const zeilen = [], verbunden = [], zeilenHoehe = {};
  return {
    zeilen, verbunden, zeilenHoehe,
    leer() { zeilen.push([]); },
    zeile(zellen, hoehe) {
      const r = zeilen.length;
      const out = [];
      let c = 0, linien = 1;
      for (const z of zellen) {
        const n = z.n || 1;
        out[c] = { w: z.w == null || z.w === '' ? null : z.w, s: z.s ?? XS.standard };
        for (let k = 1; k < n; k++) out[c + k] = { w: null, s: z.s ?? XS.standard };
        if (n > 1) verbunden.push(`${spalteZuBuchstabe(c)}${r + 1}:${spalteZuBuchstabe(c + n - 1)}${r + 1}`);
        const b = breiten.slice(c, c + n).reduce((a, x) => a + x, 0);
        linien = Math.max(linien, _linien(z.w, Math.floor(b)));
        c += n;
      }
      zeilen.push(out);
      if (hoehe) zeilenHoehe[r] = hoehe;
      else if (linien > 1) zeilenHoehe[r] = linien * 15;
    },
  };
}

/** Blattbeschreibung für xlsxDateien() aus einem Zeilenbauer. */
const _blattAus = (name, { zeilen, verbunden, zeilenHoehe }, breiten) =>
  ({ name, zeilen, verbunden, zeilenHoehe, spalten: breiten.map(breite => ({ breite })) });

const _FUELLT_ERHEBENDE = 'Diesen Reiter füllt NICHT der Empfänger aus, sondern die erhebende Stelle — im Rahmen des '
  + 'Energiekonzepts und in Abstimmung mit der zuständigen Stelle. Er zeigt am erfundenen Beispiel, wofür die Angaben '
  + 'der Reiter 1 bis 6 gebraucht werden.';

/** Kopf eines Auswertungsreiters: Titel, wer ihn ausfüllt, wo im Weg er steht, worum es geht. */
function _auswertungsKopf(bau, spalten, titel, schritte, worum) {
  bau.zeile([{ w: titel, s: XS.titel }]);
  bau.zeile([{ w: `Füllt aus: erhebende Stelle  ·  ${worum}`, s: XS.fett, n: spalten }]);
  bau.zeile([{ w: 'Weg zur Maßnahme:  ' + RA_SCHRITTE.map((t, i) => (schritte.includes(i + 1) ? `[ ${t} ]` : t)).join('  →  ')
    + `   ·   dieser Reiter: ${schritte.map(i => RA_SCHRITTE[i - 1].slice(0, 1)).join(' ')}`, s: XS.abschnitt, n: spalten }]);
  bau.zeile([{ w: _FUELLT_ERHEBENDE, s: XS.hinweis, n: spalten }]);
  bau.leer();
}

/** „Heute vorhanden" einer Funktion als kurzer Text. */
const _heute = f => (f.ersatz ? (f.ersatz_info ? `${f.ersatz}: ${f.ersatz_info}` : f.ersatz) : '—');

/** Die Planungswerte einer Funktion nach Schritt ② (Hochstufung über Abhängigkeiten), sonst null. */
const _planung = (A, id) => A.abhaengigkeiten.find(a => a.id === id)?.planung || null;

/** Soll einer Funktion als Zelltext — mit den Planungswerten aus Schritt ②, falls hochgestuft. */
function _sollText(f, A) {
  if (f.autarkie_h === 0) return 'keine Ersatzversorgung gefordert';
  if (f.autarkie_h == null) return '[offen] — Angaben fehlen';
  const k = f.klasse || f.klasse_vorschlag;
  const pl = _planung(A, f.id);
  const p = f.pk != null ? `${f.pk.toLocaleString('de-DE')} kW` : 'Krisenlast [offen]';
  if (pl) return `wie Klasse ${pl.klasse} (Schritt ②, aus Klasse ${k}) · ${p} · ${pl.autarkie} · Unterbrechung ${pl.unterbrechung}`;
  return `Klasse ${k} · ${p} · ${raDauerText(f.autarkie_h)} · Unterbrechung ${(RA_KLASSEN[k] || RA_KLASSEN.D).unterbrechung}`;
}

/** Reiter „7 Anforderungen": ① je Funktion eine messbare Anforderung, ② Abhängigkeiten. */
function _anforderungenBlatt(daten, A) {
  // A ID · B Funktion · C Gebäude · D Klasse · E Begründung · F Szenarien · G kW · H Autarkie
  // · I Unterbrechung · J Wiederherstellung · K Anforderung
  const breiten = [7, 28, 20, 11, 26, 14, 10, 11, 17, 17, 70];
  const bau = _zeilenBauer(breiten);
  const nachId = new Map(daten.funktionen.map(f => [f.id, f]));
  _auswertungsKopf(bau, breiten.length, '7 Anforderungen', [1, 2],
    'aus den Angaben auf Reiter 4 wird je Funktion eine messbare Anforderung');

  // ── ① ──
  bau.zeile([{ w: '①  Anforderung je Funktion', s: XS.abschnitt, n: breiten.length }]);
  bau.zeile([{ w: 'Die Klasse folgt aus den drei Auswirkungsangaben (Sekunden → A, 4 Stunden → B, 3 Tage → C, sonst D) und ist '
    + 'ein Vorschlag, der abgestimmt wird. Die Wiederherstellungszeit nach einem Einzelfehler fragt die Abfrage nicht ab; im '
    + 'Beispiel ist sie mit der zuständigen Stelle abgestimmt ('
    + RA_KLASSEN_KEYS.filter(k => A.wiederherstellung[k]).map(k => `Klasse ${k}: ${A.wiederherstellung[k]}`).join(', ')
    + '). „[offen]" markiert fehlende Angaben — sie werden nicht geschätzt, sondern nachgefragt.', s: XS.hinweis, n: breiten.length }]);
  bau.zeile(['ID', 'Funktion', 'Gebäude / Verbraucher', 'Klasse (Vorschlag)', 'Begründung der Klasse',
    'Szenarien', 'Krisenlast [kW]', 'Autarkie', 'max. Unterbrechung', 'Wiederherstellung', 'Anforderung']
    .map(w => ({ w, s: XS.kopf })), 45);
  for (const a of raAnforderungen(daten)) {
    const f = nachId.get(a.id);
    const k = RA_KLASSEN[a.klasse] || RA_KLASSEN.D;
    const keine = f.autarkie_h === 0;
    bau.zeile([
      { w: f.id, s: XS.text }, { w: f.name, s: XS.beispiel }, { w: f.geb, s: XS.beispiel },
      { w: a.klasse, s: XS.beispiel }, { w: f.klasse_grund, s: XS.beispiel },
      { w: RA_SZENARIO_IDS.filter(id => f.sz?.[id]).join(', ') || '—', s: XS.beispiel },
      { w: keine ? '—' : (f.pk ?? '[offen]'), s: XS.beispiel }, { w: raDauerText(f.autarkie_h), s: XS.beispiel },
      { w: keine ? '—' : k.unterbrechung, s: XS.beispiel },
      { w: keine ? '—' : (A.wiederherstellung[a.klasse] || '[offen]'), s: XS.beispiel },
      { w: raAnforderungstext(f, daten.szenarien, { wiederherstellung: A.wiederherstellung }), s: XS.beispiel },
    ]);
  }

  // ── ② ──
  // A ID · B Funktion · C daran hängen · D Klasse · E strengste · F–G Puffer · H–J Planung · K Folge
  bau.leer();
  bau.zeile([{ w: '②  Abhängigkeiten: wer versorgt wen?', s: XS.abschnitt, n: breiten.length }]);
  bau.zeile([{ w: 'Die Klasse aus ① sieht nur die Funktion selbst. Hängen andere Funktionen an ihr (Wärme, Wasser, Kraftstoff), '
    + 'muss sie mindestens so lange laufen wie die längste davon; wie lange sie ausfallen darf, bestimmt der Puffer dazwischen. '
    + 'Ist das strenger als ①, wird mit diesen Werten weitergeplant.', s: XS.hinweis, n: breiten.length }]);
  bau.zeile([{ w: 'ID', s: XS.kopf }, { w: 'Versorgende Funktion', s: XS.kopf }, { w: 'Daran hängen', s: XS.kopf },
    { w: 'Klasse aus ①', s: XS.kopf }, { w: 'Strengste abhängige Funktion', s: XS.kopf }, { w: 'Puffer dazwischen', s: XS.kopf, n: 2 },
    { w: 'Für die Planung', s: XS.kopf, n: 3 }, { w: 'Folge', s: XS.kopf }], 30);
  for (const a of A.abhaengigkeiten) {
    const f = nachId.get(a.id);
    const pl = a.planung;
    bau.zeile([{ w: a.id, s: XS.text }, { w: `${f.name} (${f.geb})`, s: XS.beispiel },
      { w: `${a.fuer.join(', ')}\n${a.weg}`, s: XS.beispiel }, { w: f.klasse || f.klasse_vorschlag, s: XS.beispiel },
      { w: a.strengste, s: XS.beispiel }, { w: a.puffer, s: XS.beispiel, n: 2 },
      { w: pl ? `wie Klasse ${pl.klasse} · ${pl.autarkie} · Unterbrechung ${pl.unterbrechung}` : 'unverändert',
        s: pl ? XS.luecke : XS.beispiel, n: 3 },
      { w: a.folge, s: XS.beispiel }]);
  }
  return _blattAus(RA_BLATT.anforderungen, bau, breiten);
}

/** Reiter „8 Lückenanalyse": ③ Soll-Ist je Funktion und Prüfpunkt, daraus Lückentyp und Bündel. */
function _lueckenBlatt(daten, A) {
  // A ID · B Funktion · C Soll · D heute · E–I Prüfpunkte · J Lückentyp · K Bündel
  const breiten = [7, 26, 32, 24, 22, 22, 22, 22, 22, 24, 10];
  const bau = _zeilenBauer(breiten);
  const relevant = new Map(daten.szenarien.map(s => [s.id, s.relevant !== 'nein']));
  _auswertungsKopf(bau, breiten.length, '8 Lückenanalyse', [3],
    'je Funktion wird das Soll aus Reiter 7 mit dem Bestand verglichen — an fünf Prüfpunkten');
  bau.zeile([{ w: 'Jeder Prüfpunkt gehört zu bestimmten Szenarien und wird nur geprüft, wenn die Funktion eines davon angekreuzt '
    + 'hat; sonst steht „—". Grün = erfüllt · Orange = Lücke oder offen. Lücken mit gleicher Ursache werden zu Bündeln '
    + 'zusammengefasst (rechte Spalte) und auf Reiter 9 gelöst.', s: XS.hinweis, n: breiten.length }]);
  bau.zeile([{ w: '', s: XS.standard, n: 4 },
    ...RA_PRUEFPUNKTE.map(p => ({ w: p.frage, s: XS.hinweis }))], 30);
  bau.zeile([{ w: 'ID', s: XS.kopf }, { w: 'Funktion', s: XS.kopf }, { w: 'Soll (Reiter 7)', s: XS.kopf },
    { w: 'Heute vorhanden', s: XS.kopf },
    ...RA_PRUEFPUNKTE.map(p => ({ w: `${p.titel}\n(${p.szenarien ? p.szenarien.join(', ') : 'jedes Szenario'})`, s: XS.kopf })),
    { w: 'Lückentyp', s: XS.kopf }, { w: '→ Bündel', s: XS.kopf }], 32);
  const stil = t => (/^✓/.test(t) ? XS.gut : /^[✗?]/.test(t) ? XS.luecke : XS.text);
  for (const f of daten.funktionen) {
    const p = A.pruefung[f.id] || {};
    const kreuze = RA_SZENARIO_IDS.filter(id => f.sz?.[id] && relevant.get(id));
    bau.zeile([{ w: f.id, s: XS.text }, { w: `${f.name} (${f.geb})`, s: XS.beispiel },
      { w: _sollText(f, A), s: XS.beispiel }, { w: _heute(f), s: XS.beispiel },
      ...RA_PRUEFPUNKTE.map(pp => {
        const gilt = kreuze.some(id => !pp.szenarien || pp.szenarien.includes(id));
        const t = gilt ? (p[pp.feld] || '[offen]') : '—';
        return { w: t, s: gilt ? stil(t) : XS.text };
      }),
      { w: p.typ || '—', s: XS.beispiel }, { w: (p.buendel || []).join(', ') || '—', s: XS.beispiel }]);
  }
  return _blattAus(RA_BLATT.luecken, bau, breiten);
}

/** Reiter „9 Lösungsweg": ④ je Bündel Optionen, Bewertung und Entscheidung. */
function _loesungswegBlatt(A) {
  // A Option · B Beschreibung · C deckt · D Klasse · E Bestand · F Aufwand · G Bewertung
  const breiten = [12, 52, 16, 11, 11, 10, 64];
  const bau = _zeilenBauer(breiten);
  const mx = new Map(A.massnahmen.map(m => [m.id, m]));
  _auswertungsKopf(bau, breiten.length, '9 Lösungsweg', [4, 5],
    'je Lückenbündel werden die typischen Optionen geprüft; die gewählte wird zur Maßnahme');

  bau.zeile([{ w: 'So wird gewählt', s: XS.abschnitt, n: breiten.length }]);
  bau.zeile([{ w: 'Je Option vier Fragen: Deckt sie alle betroffenen Szenarien? Passt sie zur Klasse? Nutzt sie Vorhandenes? '
    + 'Wie hoch ist der Aufwand? Eine Option, die mehrere Szenarien oder Funktionen auf einmal deckt, geht vor.', s: XS.hinweis, n: breiten.length }]);
  bau.zeile([{ w: 'Klasse', s: XS.kopf }, { w: 'Was die Klasse für die Lösung bedeutet', s: XS.kopf, n: 6 }]);
  for (const k of RA_KLASSEN_KEYS) {
    bau.zeile([{ w: k, s: XS.text }, { w: RA_KLASSEN_LEITREGEL[k], s: XS.beispiel, n: 6 }]);
  }
  bau.zeile([{ w: 'Lückentyp', s: XS.kopf, n: 2 }, { w: 'Typische Optionen', s: XS.kopf, n: 5 }]);
  for (const t of RA_LUECKENTYPEN) bau.zeile([{ w: t.typ, s: XS.text, n: 2 }, { w: t.optionen, s: XS.beispiel, n: 5 }]);

  const feld = (label, wert, s = XS.beispiel) => bau.zeile([{ w: label, s: XS.fett }, { w: wert, s, n: breiten.length - 1 }]);
  for (const b of A.buendel) {
    bau.leer();
    bau.zeile([{ w: `${b.id}  ${b.titel}`, s: XS.abschnitt, n: breiten.length }]);
    feld('Betroffen', b.zellen);
    feld('Soll', b.soll);
    feld('Heute', b.ist);
    if (b.optionen.length) {
      bau.zeile(['Option', 'Beschreibung', 'deckt Szenarien', 'passt zur Klasse', 'nutzt Bestand', 'Aufwand', 'Bewertung']
        .map(w => ({ w, s: XS.kopf })), 30);
      b.optionen.forEach((o, i) => {
        const s = o.gewaehlt ? XS.gut : XS.beispiel;
        bau.zeile([{ w: String.fromCharCode(97 + i) + (o.gewaehlt ? ' ✓' : ''), s: o.gewaehlt ? XS.gut : XS.text },
          { w: o.text, s }, { w: o.deckt, s }, { w: o.klasse, s }, { w: o.bestand, s }, { w: o.aufwand, s }, { w: o.bewertung, s }]);
      });
    }
    feld('→ Maßnahme', b.massnahmen.map(id => `${id}: ${mx.get(id).text}`).join('\n'), XS.gut);
    if (b.folge) feld('Hinweis', b.folge, XS.hinweis);
  }
  return _blattAus(RA_BLATT.loesungsweg, bau, breiten);
}

/** Reiter „10 Maßnahmen": ⑤ die Liste und der Nachweis, dass jede angekreuzte Zelle abgesichert ist. */
function _massnahmenBlatt(daten, A) {
  // Liste:  A Nr · B Maßnahme · C Bündel · D–E Szenarien · F–G Funktionen · H–J Anlass · K Art · L Prio · M Umsetzung
  // Matrix: A ID · B Funktion · C Klasse · D–J S1–S7 · K übergreifend
  const breiten = [7, 50, 9, 12, 12, 12, 12, 12, 12, 12, 18, 8, 28];
  const bau = _zeilenBauer(breiten);
  _auswertungsKopf(bau, breiten.length, '10 Maßnahmen', [5],
    'die gewählten Optionen aus Reiter 9; entschieden wird von der zuständigen Stelle');
  bau.zeile([{ w: 'Priorität: 1 = vordringlich, 2 = kurzfristig, 3 = mittelfristig. Leistungen und Mengen sind Richtwerte '
    + 'aus den Krisenlasten; bemessen wird im Energiekonzept.', s: XS.hinweis, n: breiten.length }]);
  bau.zeile([{ w: 'Nr.', s: XS.kopf }, { w: 'Maßnahme', s: XS.kopf }, { w: 'aus Bündel', s: XS.kopf },
    { w: 'sichert Szenarien', s: XS.kopf, n: 2 }, { w: 'für Funktionen', s: XS.kopf, n: 2 },
    { w: 'Anlass (Lücke)', s: XS.kopf, n: 3 }, { w: 'Art', s: XS.kopf }, { w: 'Prio', s: XS.kopf },
    { w: 'Entscheidung / Umsetzung', s: XS.kopf }], 30);
  for (const m of [...A.massnahmen].sort((x, y) => x.prio - y.prio || x.id.localeCompare(y.id))) {
    bau.zeile([{ w: m.id, s: XS.text }, { w: m.text, s: XS.beispiel }, { w: m.aus, s: XS.beispiel },
      { w: m.szenarien.join(', ') || 'übergreifend', s: XS.beispiel, n: 2 },
      { w: m.fuer.join(', ') || 'alle', s: XS.beispiel, n: 2 }, { w: m.anlass, s: XS.beispiel, n: 3 },
      { w: m.art, s: XS.beispiel }, { w: String(m.prio), s: XS.beispiel }, { w: m.durch, s: XS.beispiel }]);
  }

  bau.leer();
  bau.zeile([{ w: 'Nachweis: jede angekreuzte Funktion ist in jedem Szenario abgesichert', s: XS.abschnitt, n: breiten.length }]);
  bau.zeile([{ w: 'Grün = heute schon abgesichert · Orange = Lücke, die genannte Maßnahme schließt sie · „—" = Szenario für die '
    + 'Funktion nicht angekreuzt · rechts: Maßnahmen, die für die Funktion unabhängig vom Szenario gelten.', s: XS.hinweis, n: breiten.length }]);
  bau.zeile([{ w: 'ID', s: XS.kopf }, { w: 'Funktion', s: XS.kopf }, { w: 'Klasse', s: XS.kopf },
    ...RA_SZENARIEN.map(s => ({ w: s.id, s: XS.kopf })), { w: 'übergreifend', s: XS.kopf }]);
  const abs = raAbsicherung(daten, A.massnahmen, { wiederherstellung: A.wiederherstellung });
  const zellStil = { nicht: XS.text, irrelevant: XS.text, vorhanden: XS.gut, massnahme: XS.luecke, offen: XS.luecke };
  for (const z of abs.zeilen) {
    const k = z.f.klasse || z.f.klasse_vorschlag;
    const pl = _planung(A, z.f.id);
    bau.zeile([{ w: z.f.id, s: XS.text }, { w: `${z.f.name}${z.f.geb ? ` (${z.f.geb})` : ''}`, s: XS.beispiel },
      { w: pl ? `${k} → ${pl.klasse}` : k, s: XS.beispiel },
      ...RA_SZENARIEN.map(s => {
        const c = z.zellen[s.id];
        return { w: c.status === 'massnahme' ? c.massnahmen.join(', ') : RA_ABSICHERUNG[c.status].label, s: zellStil[c.status] };
      }),
      { w: z.uebergreifend.join(', ') || '—', s: XS.beispiel }]);
  }
  bau.zeile([{ w: '„C → B": Klasse aus den Auswirkungen, hochgestuft über die Abhängigkeiten (Reiter 7, Schritt ②).',
    s: XS.hinweis, n: breiten.length }]);
  return _blattAus(RA_BLATT.massnahmen, bau, breiten);
}

/** Die Reiter 7 bis 10 der Beispieldatei. */
function _auswertungsBlaetter() {
  const A = RA_BEISPIEL.auswertung;
  const daten = raBeispielDaten();
  return [_anforderungenBlatt(daten, A), _lueckenBlatt(daten, A), _loesungswegBlatt(A), _massnahmenBlatt(daten, A)];
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
    ].map(_reiterAussehen),
  };
}

/** Reiterfarbe nach Rolle des Blatts; gedruckt wird quer auf eine Seitenbreite. */
function _reiterAussehen(blatt) {
  if (blatt.versteckt) return blatt;
  const tabFarbe = blatt.name === RA_BLATT.anleitung ? _TAB.anleitung
    : blatt.name === RA_BLATT.beispiel ? _TAB.beispiel
      : /^[1-6] /.test(blatt.name) ? _TAB.eingabe : _TAB.auswertung;
  return { ...blatt, tabFarbe, quer: true };
}

/**
 * Die Beispieldatei: dieselbe Mappe, vollständig mit RA_BEISPIEL ausgefüllt.
 * Sie lässt sich einlesen und zeigt dann eine komplette Auswertung. Dazu kommen die
 * Reiter 7 bis 10 — was die erhebende Stelle daraus ableitet (Anforderungen und
 * Abhängigkeiten, Lückenanalyse, Lösungsweg, Maßnahmen).
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
  // Reiter 7–10 (Auswertung der erhebenden Stelle) vor das versteckte Listenblatt
  const listen = m.blaetter.findIndex(b => b.name === RA_BLATT.listen);
  m.blaetter.splice(listen, 0, ..._auswertungsBlaetter().map(_reiterAussehen));
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

/** Kategorie übernehmen, Autarkie in Stunden, Klassenvorschlag — für Datei und Erhebungs-Werkzeug gleich. */
function _funktionAbschliessen(f, nachName, i) {
  f.id = f.id || raFunktionsId(i);
  _erbeAusKategorie(f, nachName);
  f.autarkie_h = raAutarkieStunden(f.autarkie_text);
  const v = raKlasseVorschlag(f);
  f.klasse_vorschlag = v.klasse;
  f.klasse_grund = v.grund;
  f.klasse_sicher = v.sicher;
  f.klasse = v.klasse;               // Vorschlag, in der Oberfläche änderbar
  return f;
}

function _leseFunktionen(zeilen, idx, kategorien) {
  const nachName = new Map((kategorien || []).map(k => [_schluessel(k.kategorie), k]));
  const out = [];
  for (const f of _leseZeilen(zeilen, RA_FUNKTION_SPALTEN, idx)) {
    if (_zeileLeer(f)) continue;
    out.push(_funktionAbschliessen(f, nachName, out.length));
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

// ── Einlesen aus dem Erhebungs-Werkzeug (lib/resilienz-app.js) ──────────────
// Das Werkzeug speichert dieselben Felder wie die Abfragedatei, nur als Objekt
// statt als Zellen. Jeder Wert läuft durch dieselbe Normalisierung wie eine
// Zelle, die Kategorie wird mit derselben Regel übernommen — eine Funktion
// liest sich also gleich, egal auf welchem Weg sie gekommen ist.

export const RA_ERHEBUNG_KENNUNG_PRAEFIX = 'MMH-RESILIENZ-ERHEBUNG';
export const RA_ERHEBUNG_VERSION = 1;
export const RA_ERHEBUNG_KENNUNG = `${RA_ERHEBUNG_KENNUNG_PRAEFIX} v${RA_ERHEBUNG_VERSION}`;

/** Ein Objekt wie eine Tabellenzeile lesen: Szenario-Kreuze aus `sz`, Autarkie aus `autarkie_text`. */
function _leseObjekt(quelle, spalten) {
  const f = { sz: {} };
  for (const s of spalten) {
    const roh = s.szenario ? (quelle?.sz?.[s.szenario] ? 'x' : '')
      : s.feld === 'autarkie' ? quelle?.autarkie_text
        : quelle?.[s.feld];
    _leseZelle(f, s, roh);
  }
  return f;
}

function _normFragen(quelle, felder) {
  const out = {};
  for (const f of felder) {
    const roh = quelle?.[f.feld];
    out[f.feld] = f.liste ? raAusListe(roh, f.liste) : f.art === 'zahl' ? raZahl(roh) : raText(roh);
  }
  return out;
}

/**
 * Gespeicherten Stand des Erhebungs-Werkzeugs in die Arbeitsstruktur von
 * raLesen() übersetzen. Zusätzlich trägt jede Funktion `gebId` — die Kennung
 * des Projektgebäudes, auf das sie auf der Karte gelegt wurde.
 */
export function raLesenErhebung(stand) {
  const fehler = [];
  const kennung = raText(stand?.kennung);
  const vNr = Number(/v(\d+)\s*$/.exec(kennung)?.[1]) || null;
  if (!kennung.startsWith(RA_ERHEBUNG_KENNUNG_PRAEFIX)) {
    fehler.push('Kennung des Erhebungs-Werkzeugs nicht gefunden — stammt die Datei aus diesem Werkzeug?');
  } else if (vNr !== RA_ERHEBUNG_VERSION) {
    fehler.push(`Die Erhebung ist Version ${vNr ?? '?'}, erwartet wird Version ${RA_ERHEBUNG_VERSION}. `
      + 'Sie wird gelesen, einzelne Angaben können abweichen.');
  }

  const kategorien = [];
  const gesehen = new Set();
  for (const roh of Array.isArray(stand?.kategorien) ? stand.kategorien : []) {
    const k = _leseObjekt(roh, RA_KATEGORIE_SPALTEN);
    if (!k.kategorie || gesehen.has(_schluessel(k.kategorie))) continue;
    gesehen.add(_schluessel(k.kategorie));
    k.autarkie_h = raAutarkieStunden(k.autarkie_text);
    kategorien.push(k);
  }
  const nachName = new Map(kategorien.map(k => [_schluessel(k.kategorie), k]));

  const funktionen = [];
  for (const roh of Array.isArray(stand?.funktionen) ? stand.funktionen : []) {
    const f = _leseObjekt(roh, RA_FUNKTION_SPALTEN);
    if (_zeileLeer(f)) continue;
    if (roh?.gebId != null && roh.gebId !== '') f.gebId = roh.gebId;
    // Im Werkzeug von einer anderen Funktion übertragen bzw. aus dem Beispielkatalog begonnen
    if (raText(roh?.quelle)) f.quelle = raText(roh.quelle);
    if (raText(roh?.katalog)) f.katalog = raText(roh.katalog);
    funktionen.push(_funktionAbschliessen(f, nachName, funktionen.length));
  }

  const szNachId = new Map((Array.isArray(stand?.szenarien) ? stand.szenarien : []).map(s => [raText(s?.id).toUpperCase(), s]));
  const szenarien = RA_SZENARIEN.map(s => {
    const z = szNachId.get(s.id) || {};
    return {
      id: s.id, name: s.name,
      relevant: raAusListe(z.relevant, 'L_Relevant'),
      dauer: raText(z.dauer),
      herkunft: raAusListe(z.herkunft, 'L_Herkunft'),
      bem: raText(z.bem),
    };
  });

  return {
    kennung, version: vNr, fehler,
    allgemein:    _normFragen(stand?.allgemein, RA_ALLGEMEIN_FELDER),
    szenarien,
    kategorien,
    funktionen,
    bestand:      _normFragen(stand?.bestand, RA_BESTAND_FELDER),
    rueckmeldung: _normFragen(stand?.rueckmeldung, RA_RUECKMELDUNG_FELDER),
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
  // Ebenso Funktionen, deren Angaben im Erhebungs-Werkzeug von einer anderen
  // übertragen wurden (`quelle`): Vorlage und Kopien bilden eine Gruppe.
  const jeGruppe = new Map();
  const nachId = new Map((daten?.funktionen || []).map(f => [f.id, f]));
  const sindQuelle = new Set((daten?.funktionen || []).map(f => f.quelle).filter(q => q && nachId.has(q)));
  const PF = (f, ref, bez, feld, rest) => {
    let gruppe = null;
    if (f.kategorie && !f.kategorie_unbekannt) {
      gruppe = { key: 'k|' + _schluessel(f.kategorie), ref: `Kategorie ${f.kategorie}`, kategorie: f.kategorie,
        titel: `Kategorie „${f.kategorie}"`, ende: `Einmal auf Blatt „${RA_BLATT.kategorien}" ergänzen.` };
    } else {
      const vorlage = f.quelle && nachId.has(f.quelle) ? nachId.get(f.quelle) : sindQuelle.has(f.id) ? f : null;
      if (vorlage) {
        gruppe = { key: 'q|' + vorlage.id, ref: vorlage.id,
          titel: `„${vorlage.name || vorlage.geb || vorlage.id}" und die davon übertragenen Funktionen`,
          ende: 'Einmal an der Vorlage klären und erneut übertragen.' };
      }
    }
    if (!gruppe) { P(ref, `${bez}: ${rest}`, feld); return; }
    const key = `${gruppe.key}|${rest}`;
    const bisher = jeGruppe.get(key);
    if (bisher) { bisher.ids.push(ref); return; }
    const punkt = { ref: gruppe.ref, text: '', feld, rest, ids: [ref], bez, titel: gruppe.titel, ende: gruppe.ende };
    if (gruppe.kategorie) punkt.kategorie = gruppe.kategorie;
    jeGruppe.set(key, punkt);
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
      P(ref, `${bez}: Autarkie über ${raDauerText(f.autarkie_h)} gefordert, Krisenlast aber unbekannt — `
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
        ref, text: `${bez}: angegebene Autarkie (${raDauerText(f.autarkie_h)}) weicht vom Klassen-Richtwert `
          + `(${raDauerText(vorgabe)}, Klasse ${k}) ab. Übernommen wird die Angabe aus der Abfrage.`,
      });
    }
    if (!f.klasse_sicher && f.klasse_vorschlag === 'D') {
      hinweise.push({ ref, text: `${bez}: Klasse D nur mangels Angaben — bitte gegen die offenen Punkte prüfen.` });
    }
  }

  for (const punkt of jeGruppe.values()) {
    const n = punkt.ids.length;
    if (!punkt.kategorie && n === 1) {
      // Übertragungsgruppe, in der nur eine Funktion die Lücke hat: wie ein Einzelpunkt
      punkt.ref = punkt.ids[0];
      punkt.text = `${punkt.bez}: ${punkt.rest}`;
    } else {
      punkt.text = `${punkt.titel}: ${punkt.rest.replace(/\.$/, '')} `
        + `(betrifft ${n === 1 ? punkt.ids[0] : `${n} Funktionen: ${punkt.ids.join(', ')}`}). ${punkt.ende}`;
    }
    delete punkt.rest; delete punkt.bez; delete punkt.titel; delete punkt.ende;
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
 * Ist ausdrücklich keine Autarkie gefordert, lautet der Satz entsprechend kurz.
 * @param {object} [opt]
 * @param {Record<string,string>} [opt.wiederherstellung]  abgestimmte Wiederherstellungszeit je Klasse
 */
export function raAnforderungstext(f, szenarien, opt = {}) {
  const name = raText(f?.name) || f?.id || '[offen]';
  const geb = raText(f?.geb);
  const wer = `Funktion „${name}"${geb ? ` (${geb})` : ''}`;
  if (f?.autarkie_h === 0) {
    const d = (f.klasse || f.klasse_vorschlag) === 'D';
    return `${wer}: keine Ersatzversorgung gefordert — ${d
      ? 'die Last darf im Krisenfall abgeworfen werden.'
      : 'der Betrieb ruht bis zur Wiederkehr der Versorgung.'}`;
  }
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
  // gestellt; ist sie mit der zuständigen Stelle abgestimmt, steht der Wert in
  // opt.wiederherstellung — sonst bleibt sie offen.
  const s4 = (szenarien || []).find(s => s.id === 'S4');
  const T = s4?.relevant === 'nein' ? 'nicht gefordert (Szenario S4 nicht relevant)'
    : raText(opt.wiederherstellung?.[klasse.key]) || '[offen]';

  return `${wer} ist in den Szenarien ${szText} `
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
