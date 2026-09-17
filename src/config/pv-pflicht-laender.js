// @ts-check
// ── config/pv-pflicht-laender.js — Landesrechtliche PV-Pflichten ─────────────
//
// Datengrundlage für die Variante „Gesetzliche Pflicht" (09d-pv-analyse.js) und
// für die Pflicht-Prüfung aller anderen Varianten. Reine Daten, keine Logik —
// gerechnet wird in lib/pv-pflicht.js.
//
// ⚠ ORIENTIERUNGSWERTE, KEINE RECHTSBERATUNG. Die Länder ändern ihre Regeln
//   laufend, mehrere verweisen für die Mindestgröße auf eine Rechtsverordnung.
//   Vor der Planung ist das Landesrecht in der geltenden Fassung zu prüfen.
//
// Drei Bezugsflächen, weil die Länder unterschiedlich formulieren — die
// Unterscheidung ist rechnerisch erheblich und darf nicht eingeebnet werden:
//   'brutto'   — Prozent der BRUTTOdachfläche (gesamte Dachfläche, BE/HH)
//   'dach'     — Prozent der Dachfläche, meist mit Mindestgröße (BB/HB/NI)
//   'geeignet' — Prozent der für Solarnutzung GEEIGNETEN Fläche (BY/BW/RP);
//                das ist im Tool die belegbare Fläche (Belegung − Sperrflächen)
//
// Feldbedeutung je Eintrag:
//   pflicht           false = Land ohne PV-Pflicht (alle weiteren Felder entfallen)
//   bezug             siehe oben
//   anteilPct         geforderter Flächenanteil in % (null = nicht bezifferbar)
//   anteilHerkunft    'gesetz' | 'verordnung' | 'unbestimmt'
//                     'verordnung'  = steht nicht im zitierten §, sondern in der
//                                     zugehörigen Rechtsverordnung → nachprüfen
//                     'unbestimmt'  = Gesetz nennt nur „geeignete Dachfläche"
//                                     ohne Prozentsatz → Variante kann für dieses
//                                     Land keine Zahl liefern (kein Default!)
//   minDachM2         Dachfläche, ab der die Pflicht greift (0 = keine Schwelle)
//   minNutzflaecheM2  Nutzfläche, ab der die Pflicht greift (0 = keine Schwelle)
//   gilt              'alle' | 'nichtwohn' | 'landeseigen'
//   neubau            Pflicht bei Neubau
//   sanierung         { gilt, abDachPct } — Dachsanierung als Auslöser; abDachPct
//                     = ab welchem Anteil der Dachfläche sie als „grundlegend" gilt
//   parkplatzAbStellplaetze  Stellplatzpflicht (nur Hinweis — Stellplätze sind im
//                     Datenmodell nicht erfasst und werden NICHT mitgerechnet)
//   hinweise          Freitext für Panel und Gutachten

/**
 * @typedef {object} PflichtRegel
 * @property {string} land                Vollständiger Landesname
 * @property {string} kurz                Kürzel für Beschriftungen (BW, BY, …)
 * @property {boolean} pflicht            false = Land ohne PV-Pflicht
 * @property {string} [gesetz]
 * @property {string} [norm]
 * @property {'brutto'|'dach'|'geeignet'} [bezug]
 * @property {number|null} [anteilPct]
 * @property {'gesetz'|'verordnung'|'unbestimmt'} [anteilHerkunft]
 * @property {number} [minDachM2]
 * @property {number} [minNutzflaecheM2]
 * @property {'alle'|'nichtwohn'|'landeseigen'} [gilt]
 * @property {boolean} [neubau]
 * @property {{ gilt: boolean, abDachPct: number }} [sanierung]
 * @property {number|null} [parkplatzAbStellplaetze]
 * @property {string[]} [hinweise]
 */

export const PV_PFLICHT_META = Object.freeze({
  stand: '2026-03-30',
  quelle: 'Übersicht PV-Pflichten der Länder (Bauordnungen, Klima-, Energie- und Solargesetze)',
  disclaimer: 'Orientierungswert für die Vorplanung, keine Rechtsberatung. '
            + 'Landesrecht in der geltenden Fassung prüfen; mehrere Länder regeln die '
            + 'Mindestgröße in einer Rechtsverordnung.',
});

/** Pauschaler Eignungsanteil der Bruttodachfläche, wenn im Projekt keine
 *  Belegungsfläche gezeichnet ist. Deckt Dachaufbauten, Verschattung, Rand- und
 *  Wartungsabstände ab. Wird bei Verwendung als Annahme protokolliert. */
export const EIGNUNG_PAUSCHAL_PCT = 70;

/** Länderschlüssel identisch zu BUNDESLAND_BBOX in lib/bundeslaender.js.
 *  @type {Readonly<Record<string, PflichtRegel>>} */
export const PV_PFLICHT = Object.freeze({

  bw: {
    land: 'Baden-Württemberg', kurz: 'BW', pflicht: true,
    gesetz: 'Klimaschutz- und Klimawandelanpassungsgesetz BW', norm: '§ 23 KlimaSchG BW',
    bezug: 'geeignet', anteilPct: 60, anteilHerkunft: 'verordnung',
    minDachM2: 0, minNutzflaecheM2: 0, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 0 },
    parkplatzAbStellplaetze: 35,
    hinweise: [
      '§ 23 selbst nennt keinen Prozentsatz — die Mindestgröße steht in der PVPf-VO BW. Wert vor Nutzung prüfen.',
      'Ersatzweise erfüllbar über andere Außenflächen, Solarthermie oder Verpachtung an Dritte (Abs. 4–5).',
      'Befreiung auf Antrag bei unverhältnismäßig hohem wirtschaftlichem Aufwand (Abs. 3).',
      'Zusätzlich Pflicht bei neuen offenen Parkplätzen mit mehr als 35 Stellplätzen.',
    ],
  },

  by: {
    land: 'Bayern', kurz: 'BY', pflicht: true,
    gesetz: 'Bayerische Bauordnung', norm: 'Art. 44a BayBO',
    bezug: 'geeignet', anteilPct: 100 / 3, anteilHerkunft: 'gesetz',
    minDachM2: 50, minNutzflaecheM2: 0, gilt: 'nichtwohn',
    neubau: true, sanierung: { gilt: true, abDachPct: 100 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Angemessene Auslegung = Modulfläche mindestens ein Drittel der geeigneten Dachfläche.',
      'Sanierungsfall nur bei vollständiger Erneuerung der Dachhaut.',
      'Ausgenommen: Dachflächen bis 50 m² sowie Wohngebäuden dienende Gebäude (Garagen, Nebengebäude).',
    ],
  },

  be: {
    land: 'Berlin', kurz: 'BE', pflicht: true,
    gesetz: 'Solargesetz Berlin', norm: '§§ 3, 4 SolG Bln',
    bezug: 'brutto', anteilPct: 30, anteilHerkunft: 'gesetz',
    minDachM2: 0, minNutzflaecheM2: 50, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 30 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Neubau: mindestens 30 % der Bruttodachfläche; wesentlicher Dachumbau: 30 % der Nettodachfläche.',
      'Für Wohngebäude gelten alternativ Mindestleistungen (2/3/6 kW je nach Wohnungszahl).',
      'Pflicht ab einer Nutzungsfläche von mehr als 50 m².',
    ],
  },

  bb: {
    land: 'Brandenburg', kurz: 'BB', pflicht: true,
    gesetz: 'Brandenburgische Bauordnung', norm: '§ 32a BbgBO',
    bezug: 'dach', anteilPct: 50, anteilHerkunft: 'gesetz',
    minDachM2: 50, minNutzflaecheM2: 0, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 50 },
    parkplatzAbStellplaetze: null,
    hinweise: ['Pflicht ab einer Dachfläche von 50 m²; mindestens 50 % der Dachfläche sind auszustatten.'],
  },

  hb: {
    land: 'Bremen', kurz: 'HB', pflicht: true,
    gesetz: 'Bremisches Solargesetz', norm: '§ 2 BremSolarG',
    bezug: 'dach', anteilPct: 50, anteilHerkunft: 'gesetz',
    minDachM2: 50, minNutzflaecheM2: 0, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 80 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Modulfläche mindestens 50 % der Dachfläche nach § 3.',
      'Grundlegende Dachsanierung = Erneuerung bei mindestens 80 % der Dachfläche (die Übersichtstabelle nennt 50 % — maßgeblich ist der Gesetzestext).',
      'Ausgenommen: Dachflächen unter 50 m², Reet-/Stroh-/Holzdächer, Unterglasanlagen, Kulturbauten.',
    ],
  },

  hh: {
    land: 'Hamburg', kurz: 'HH', pflicht: true,
    gesetz: 'Hamburgisches Klimaschutzgesetz', norm: '§ 16 HmbKliSchG',
    bezug: 'brutto', anteilPct: 30, anteilHerkunft: 'gesetz',
    minDachM2: 0, minNutzflaecheM2: 0, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 30 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Mindestens 30 v. H. der Bruttodachfläche für Anlagen, die nach dem 1. Januar 2024 errichtet werden.',
      'Dachbegrünungspflicht bei flach geneigten Dächern beachten — Gründach und PV sind zu kombinieren.',
      'Zusammenfassung mehrerer Gebäude zulässig, wenn die installierte Leistung insgesamt erreicht wird.',
    ],
  },

  he: {
    land: 'Hessen', kurz: 'HE', pflicht: true,
    gesetz: 'Hessisches Energiegesetz', norm: '§§ 3, 5 HEG',
    bezug: 'geeignet', anteilPct: null, anteilHerkunft: 'unbestimmt',
    minDachM2: 0, minNutzflaecheM2: 0, gilt: 'landeseigen',
    neubau: true, sanierung: { gilt: true, abDachPct: 0 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Pflicht nur für landeseigene Gebäude und Parkplätze — für andere Bauherren besteht keine Pflicht.',
      'Das Gesetz nennt keinen Flächenanteil; die Variante liefert für Hessen daher keine Leistung.',
    ],
  },

  mv: { land: 'Mecklenburg-Vorpommern', kurz: 'MV', pflicht: false, hinweise: ['Keine landesrechtliche PV-Pflicht.'] },

  ni: {
    land: 'Niedersachsen', kurz: 'NI', pflicht: true,
    gesetz: 'Niedersächsische Bauordnung', norm: '§ 32a NBauO',
    bezug: 'dach', anteilPct: 50, anteilHerkunft: 'gesetz',
    minDachM2: 50, minNutzflaecheM2: 0, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 50 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Errichtung ab 50 m² Dachfläche: mindestens 50 % der Dachfläche.',
      'Im Änderungsfall (Erneuerung der Dachhaut bis zur wasserführenden Schicht) zählt die neu errichtete oder erneuerte Dachfläche ab 50 m².',
      'Zusätzlich Pflicht bei offenen Parkplätzen und Parkdecks.',
    ],
  },

  nw: {
    land: 'Nordrhein-Westfalen', kurz: 'NW', pflicht: true,
    gesetz: 'Landesbauordnung NRW', norm: '§§ 42a, 48 BauO NRW',
    bezug: 'geeignet', anteilPct: null, anteilHerkunft: 'unbestimmt',
    minDachM2: 0, minNutzflaecheM2: 50, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 0 },
    parkplatzAbStellplaetze: 35,
    hinweise: [
      'Neubaupflicht seit 2024, Sanierungspflicht ab 2026.',
      'Die Mindestgröße regelt die Rechtsverordnung nach § 42a Abs. 8 — solange sie hier nicht hinterlegt ist, liefert die Variante keine Leistung.',
      'Nicht anzuwenden auf Gebäude mit einer Nutzfläche bis 50 m², Behelfsbauten, untergeordnete und fliegende Bauten.',
      'Zusätzlich Pflicht bei Stellplatzflächen mit mehr als 35 notwendigen Stellplätzen für Nichtwohngebäude.',
    ],
  },

  rp: {
    land: 'Rheinland-Pfalz', kurz: 'RP', pflicht: true,
    gesetz: 'Landessolargesetz Rheinland-Pfalz', norm: '§ 4 LSolarG RP',
    bezug: 'geeignet', anteilPct: 60, anteilHerkunft: 'gesetz',
    minDachM2: 100, minNutzflaecheM2: 100, gilt: 'alle',
    neubau: true, sanierung: { gilt: true, abDachPct: 0 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Mindestgröße 60 v. H. der Solarinstallations-Eignungsfläche.',
      'Gewerbliche Neubauten ab 100 m² Dachfläche; öffentliche Gebäude ab 100 m² Nutzfläche bei Neubau und grundlegender Dachsanierung.',
      'Ersatzweise Solarthermie oder Verpachtung an Dritte zulässig (Abs. 6).',
    ],
  },

  sl: {
    land: 'Saarland', kurz: 'SL', pflicht: false,
    hinweise: ['Derzeit keine generelle PV-Pflicht — nur „PV-ready"; eine Regelung ist angekündigt.'],
  },

  sn: { land: 'Sachsen',        kurz: 'SN', pflicht: false, hinweise: ['Keine landesrechtliche PV-Pflicht.'] },
  st: { land: 'Sachsen-Anhalt', kurz: 'ST', pflicht: false, hinweise: ['Keine landesrechtliche PV-Pflicht.'] },

  sh: {
    land: 'Schleswig-Holstein', kurz: 'SH', pflicht: true,
    gesetz: 'Energiewende- und Klimaschutzgesetz SH', norm: '§ 26 EWKG SH',
    bezug: 'geeignet', anteilPct: null, anteilHerkunft: 'unbestimmt',
    minDachM2: 0, minNutzflaecheM2: 0, gilt: 'nichtwohn',
    neubau: true, sanierung: { gilt: true, abDachPct: 10 },
    parkplatzAbStellplaetze: null,
    hinweise: [
      'Pflicht bei Neubau und bei Renovierung von mehr als 10 % der Dachfläche von Nichtwohngebäuden.',
      '§ 26 verlangt die Belegung der „für eine Solarnutzung geeigneten Dachfläche", nennt aber keinen Prozentsatz — die Variante liefert daher keine Leistung.',
    ],
  },

  th: { land: 'Thüringen', kurz: 'TH', pflicht: false, hinweise: ['Keine landesrechtliche PV-Pflicht.'] },
});

/** Auswahlliste für das Panel — alphabetisch nach Landesname. */
export const PV_PFLICHT_LISTE = Object.freeze(
  Object.entries(PV_PFLICHT)
    .map(([id, r]) => ({ id, land: r.land, kurz: r.kurz, pflicht: r.pflicht }))
    .sort((a, b) => a.land.localeCompare(b.land, 'de')),
);
