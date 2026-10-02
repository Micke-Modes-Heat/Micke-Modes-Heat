// Vitest-Tests für lib/resilienz-abfrage.js — Abfragedatei, Round-Trip,
// Klassenregel und Vollständigkeitsprüfung.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { xlsxDateien, XS } from '../src/lib/xlsx-schreiber.js';
import { xlsxAusBlob } from '../src/lib/xlsx-leser.js';
import * as RA from '../src/lib/resilienz-abfrage.js';

// ── Hilfen zum Befüllen einer erzeugten Mappe „wie ein Empfänger" ───────────

function mappe(opt = {}) {
  return RA.raMappe({
    meta: { lieg: 'Musterhausen', stand: '2026-09-20', ...(opt.meta || {}) },
    funktionen: opt.funktionen ?? RA.raVorbelegung([]),
    leerzeilen: opt.leerzeilen ?? 3,
  });
}

const blattVon = (m, name) => m.blaetter.find(b => b.name === name);
const textVon = b => b.zeilen.flat().map(z => z?.w).filter(v => v != null).join(' | ');

function setzeFunktion(m, r, werte) {
  const blatt = blattVon(m, RA.RA_BLATT.funktionen);
  const zeile = blatt.zeilen[RA.RA_KOPFZEILE + 1 + r];
  for (const [feld, wert] of Object.entries(werte)) {
    const c = RA.RA_FUNKTION_SPALTEN.findIndex(s => s.feld === feld);
    expect(c, `Spalte ${feld} gibt es nicht`).toBeGreaterThan(-1);
    zeile[c].w = wert;
  }
}

function setzeFrage(m, blattname, felder, werte) {
  const blatt = blattVon(m, blattname);
  for (const [feld, wert] of Object.entries(werte)) {
    const i = felder.findIndex(f => f.feld === feld);
    expect(i, `Feld ${feld} gibt es nicht`).toBeGreaterThan(-1);
    blatt.zeilen[RA.RA_FRAGE_START + i][1].w = wert;
  }
}

function setzeSzenario(m, id, { relevant, dauer, herkunft }) {
  const blatt = blattVon(m, RA.RA_BLATT.szenarien);
  const i = RA.RA_SZENARIO_IDS.indexOf(id);
  const zeile = blatt.zeilen[RA.RA_KOPFZEILE + 1 + i];
  if (relevant != null) zeile[2].w = relevant;
  if (dauer != null) zeile[3].w = dauer;
  if (herkunft != null) zeile[4].w = herkunft;
}

async function durchReichen(m) {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(xlsxDateien(m))) zip.file(p, c);
  const { blaetter } = await xlsxAusBlob(await zip.generateAsync({ type: 'nodebuffer' }), JSZip);
  return RA.raLesen(blaetter);
}

// ── Baustein 1 ──────────────────────────────────────────────────────────────

describe('Abfragedatei', () => {
  const m = mappe();

  it('legt alle geforderten Blätter an', () => {
    expect(m.blaetter.map(b => b.name)).toEqual([
      '0 Anleitung', 'Beispiel (ausgefüllt)', '1 Allgemeines', '2 Szenarien', '3 Kategorien',
      '4 Funktionen', '5 Bestand und Organisation', '6 Rückmeldung', 'Listen',
    ]);
    expect(blattVon(m, RA.RA_BLATT.listen).versteckt).toBe(true);
  });

  it('trägt die Versionskennung in der ausgeblendeten Zelle der Anleitung', () => {
    const an = blattVon(m, RA.RA_BLATT.anleitung);
    expect(an.zeilen[RA.RA_KENNUNG_ZELLE.zeile][RA.RA_KENNUNG_ZELLE.spalte].w).toBe(RA.RA_KENNUNG);
    expect(an.spalten[RA.RA_KENNUNG_ZELLE.spalte].verborgen).toBe(true);
  });

  it('belegt das Kernblatt mit S1–S7 und allen Spalten des Schemas', () => {
    const kopf = blattVon(m, RA.RA_BLATT.funktionen).zeilen[RA.RA_KOPFZEILE].map(z => z.w);
    expect(kopf).toEqual(RA.RA_FUNKTION_SPALTEN.map(s => s.titel));
    expect(kopf.filter(t => /^S\d$/.test(t))).toEqual(RA.RA_SZENARIO_IDS);
  });

  it('gibt jeder Auswahlspalte eine Datenüberprüfung über alle Datenzeilen', () => {
    const blatt = blattVon(m, RA.RA_BLATT.funktionen);
    const mitListe = RA.RA_FUNKTION_SPALTEN.filter(s => s.liste);
    expect(blatt.pruefungen).toHaveLength(mitListe.length);
    // L_Kategorie ist keine feste Liste, sondern ein Name auf Spalte A von „3 Kategorien"
    for (const p of blatt.pruefungen) expect(RA.RA_LISTEN[p.liste] || m.namen[p.liste], p.liste).toBeDefined();
    expect(m.namen.L_Kategorie).toMatch(/^'3 Kategorien'!\$A\$5:\$A\$\d+$/);
    // 9 Vorlagen + 3 Leerzeilen, Kopf in Zeile 4 → Daten ab Zeile 5 bis 16
    expect(blatt.pruefungen[0].bereich).toMatch(/^[A-Z]+5:[A-Z]+16$/);
  });

  it('bietet in jeder Auswahlliste „unbekannt" an, außer bei den Szenariokreuzen', () => {
    for (const [name, werte] of Object.entries(RA.RA_LISTEN)) {
      if (name === 'L_Kreuz') continue;
      expect(werte, name).toContain('unbekannt');
    }
  });

  it('fragt auf keinem Blatt nach eingestuften Inhalten', () => {
    const texte = m.blaetter.flatMap(b => b.zeilen.flat()
      .map(z => (z && typeof z === 'object' ? z.w : z)))
      .filter(t => typeof t === 'string').join(' ').toLowerCase();
    // Der Hinweis, dass keine VS einzutragen sind, muss stehen …
    expect(texte).toContain('keine verschlusssachen');
    // … und keine Frage darf den Inhalt einer eingestuften Vorgabe verlangen.
    const fragen = [...RA.RA_ALLGEMEIN_FELDER, ...RA.RA_BESTAND_FELDER, ...RA.RA_RUECKMELDUNG_FELDER]
      .map(f => f.frage.toLowerCase());
    for (const f of fragen) {
      expect(f, f).not.toMatch(/inhalt der (weisung|vorgabe)|wortlaut|einstufungsgrad/);
    }
    expect(RA.RA_ALLGEMEIN_FELDER.find(f => f.feld === 'vorgaben_bez').frage)
      .toMatch(/nur Existenz und Stelle, keine Inhalte/);
  });

  it('übernimmt Gebäude des Projekts als Vorbelegung und ergänzt typische Funktionen', () => {
    const v = RA.raVorbelegung([
      { id: 1, name: 'Geb 12', nutzung: 'kaserne' },
      { id: 2, name: 'Geb 30', nutzung: 'kantine' },
      { id: 3, name: 'Geb 99', nutzung: 'nicht-im-register' },
    ]);
    expect(v.slice(0, 3)).toEqual([
      { id: 'F01', name: 'Unterkunft', geb: 'Geb 12', kategorie: 'Unterkunft', betrieb: '' },
      { id: 'F02', name: 'Küche / Verpflegung', geb: 'Geb 30', kategorie: 'Küche / Verpflegung', betrieb: '' },
      { id: 'F03', name: 'Nutzung noch festzulegen', geb: 'Geb 99', kategorie: '', betrieb: '' },
    ]);
    // bereits abgedeckte Vorlagen werden nicht doppelt angehängt
    const namen = v.map(x => x.name);
    expect(namen.filter(n => n === 'Unterkunft')).toHaveLength(1);
    expect(namen).toContain('Wache / Zugangskontrolle');
    expect(v.map(x => x.id)).toEqual([...new Set(v.map(x => x.id))]);
  });

  it('baut einen verwendbaren Dateinamen', () => {
    expect(RA.raDateiname({ lieg: 'Standort Müller / Süd', stand: '2026-09-20' }))
      .toBe('Resilienzabfrage_Standort_Müller_Süd_2026-09-20.xlsx');
    expect(RA.raDateiname({})).toMatch(/^Resilienzabfrage_Liegenschaft_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

// ── Baustein 2: Round-Trip ──────────────────────────────────────────────────

describe('Round-Trip erzeugen → ausfüllen → einlesen', () => {
  it('liefert dieselben Werte zurück, die eingetragen wurden', async () => {
    const m = mappe({ funktionen: RA.raVorbelegung([{ id: 1, name: 'Geb 12', nutzung: 'kaserne' }]) });
    setzeFrage(m, RA.RA_BLATT.allgemeines, RA.RA_ALLGEMEIN_FELDER, {
      lieg: 'Musterhausen', auftrag: 'Ausbildung', stelle: 'S4', bearb: 'Muster',
      stand: '2026-09-20', zustaendig: 'Kdo Musterbereich',
      vorgaben: 'ja', vorgaben_bez: 'Weisung Nr. 3, Kdo Musterbereich', liste_kf: 'nein',
    });
    setzeSzenario(m, 'S2', { relevant: 'ja', dauer: '14 Tage', herkunft: 'vorgegeben' });
    setzeSzenario(m, 'S4', { relevant: 'nein', dauer: '', herkunft: 'vorgegeben' });
    setzeFunktion(m, 0, {
      name: 'Führung / IT', geb: 'Geb 12', betrieb: '24/7',
      ausw_s: 'Auftrag gefährdet', ausw_4h: 'Auftrag gefährdet', ausw_3d: 'Auftrag gefährdet',
      autarkie: '7 Tage', sz_S2: 'x', sz_S4: 'x', reduziert: 'ja',
      pk: 42.5, pk_art: 'gemessen', ersatz: 'USV+NEA', ersatz_info: 'USV 15 min, NEA 8 h',
      abh: 'Wärme, IT-Netz', herkunft: 'vorgegeben', bem: 'Server & Leitstelle',
    });
    setzeFrage(m, RA.RA_BLATT.bestand, RA.RA_BESTAND_FELDER, {
      nea_anzahl: 2, nea_kw: 250, brennstoff_vertrag: 'nein', plaene: 'ja', herkunft: 'Einschätzung Nutzer',
    });
    setzeFrage(m, RA.RA_BLATT.rueckmeldung, RA.RA_RUECKMELDUNG_FELDER, {
      offen: 'Krisenlast Küche fehlt', freigabe_stelle: 'Kdo Musterbereich',
    });

    const d = await durchReichen(m);
    expect(d.fehler).toEqual([]);
    expect(d.version).toBe(RA.RA_VERSION);
    expect(d.allgemein).toMatchObject({
      lieg: 'Musterhausen', zustaendig: 'Kdo Musterbereich',
      vorgaben: 'ja', vorgaben_bez: 'Weisung Nr. 3, Kdo Musterbereich', liste_kf: 'nein',
    });
    expect(d.szenarien.find(s => s.id === 'S2'))
      .toMatchObject({ relevant: 'ja', dauer: '14 Tage', herkunft: 'vorgegeben' });
    const f = d.funktionen[0];
    expect(f).toMatchObject({
      id: 'F01', name: 'Führung / IT', geb: 'Geb 12', betrieb: '24/7',
      ausw_s: 'Auftrag gefährdet', autarkie_text: '7 Tage', autarkie_h: 168,
      reduziert: 'ja', pk: 42.5, pk_art: 'gemessen', ersatz: 'USV+NEA',
      ersatz_info: 'USV 15 min, NEA 8 h', abh: 'Wärme, IT-Netz',
      herkunft: 'vorgegeben', bem: 'Server & Leitstelle',
    });
    expect(f.sz).toEqual({ S1: 0, S2: 1, S3: 0, S4: 1, S5: 0, S6: 0, S7: 0 });
    expect(d.bestand).toMatchObject({ nea_anzahl: 2, nea_kw: 250, brennstoff_vertrag: 'nein', plaene: 'ja' });
    expect(d.rueckmeldung.offen).toBe('Krisenlast Küche fehlt');
  });

  it('lässt unausgefüllte Leerzeilen weg, behält aber vorbelegte Zeilen', async () => {
    const d = await durchReichen(mappe({ funktionen: RA.raVorbelegung([]), leerzeilen: 20 }));
    expect(d.funktionen).toHaveLength(RA.RA_FUNKTION_VORLAGEN.length);
  });

  it('erkennt eine fremde Datei an der fehlenden Versionskennung', async () => {
    const d = RA.raLesen({ Tabelle1: [['irgendwas']] });
    expect(d.fehler.join(' ')).toMatch(/Blatt „0 Anleitung" fehlt/);
    expect(d.fehler.join(' ')).toMatch(/Blatt „4 Funktionen" fehlt/);
    expect(d.funktionen).toEqual([]);
  });

  it('meldet eine umbenannte Spalte, liest den Rest aber weiter', async () => {
    const m = mappe({ leerzeilen: 0 });
    const blatt = blattVon(m, RA.RA_BLATT.funktionen);
    const c = RA.RA_FUNKTION_SPALTEN.findIndex(s => s.feld === 'betrieb');
    blatt.zeilen[RA.RA_KOPFZEILE][c].w = 'Betriebzeit';   // Tippfehler des Empfängers
    setzeFunktion(m, 0, { ausw_s: 'Auftrag gefährdet', betrieb: 'Dienstzeit' });
    const d = await durchReichen(m);
    expect(d.fehler.join(' ')).toMatch(/Spalte E .* heißt „Betriebzeit"/);
    expect(d.funktionen[0].betrieb).toBe('Dienstzeit');   // über die Sollposition trotzdem gelesen
    expect(d.funktionen[0].klasse_vorschlag).toBe('A');
  });

  it('meldet eine ältere Dateiversion, ohne den Import abzubrechen', () => {
    const m = mappe({ leerzeilen: 0 });
    const an = blattVon(m, RA.RA_BLATT.anleitung);
    an.zeilen[0][2].w = 'MMH-RESILIENZ-ABFRAGE v0';
    const blaetter = Object.fromEntries(m.blaetter.map(b =>
      [b.name, b.zeilen.map(z => (z || []).map(c => (c && typeof c === 'object' ? c.w : c)))]));
    const d = RA.raLesen(blaetter);
    expect(d.fehler.join(' ')).toMatch(/Version 0, erwartet wird Version 2/);
    expect(d.funktionen.length).toBeGreaterThan(0);
  });
});

// ── Klassenvorschlag ────────────────────────────────────────────────────────

describe('raKlasseVorschlag', () => {
  const v = (s, h, d) => RA.raKlasseVorschlag({ ausw_s: s, ausw_4h: h, ausw_3d: d });

  it('A: Ausfall nach Sekunden gefährdet den Auftrag', () => {
    expect(v('Auftrag gefährdet', 'keine', 'keine').klasse).toBe('A');
    expect(v('Auftrag gefährdet', '', '').klasse).toBe('A');
    expect(v('Auftrag gefährdet', 'Auftrag gefährdet', 'Auftrag gefährdet').klasse).toBe('A');
  });

  it('B: erst nach 4 Stunden gefährdet', () => {
    expect(v('eingeschränkt', 'Auftrag gefährdet', 'Auftrag gefährdet').klasse).toBe('B');
    expect(v('keine', 'Auftrag gefährdet', 'keine').klasse).toBe('B');
    expect(v('unbekannt', 'Auftrag gefährdet', '').klasse).toBe('B');
  });

  it('C: nach 3 Tagen gefährdet oder eingeschränkt', () => {
    expect(v('keine', 'keine', 'Auftrag gefährdet').klasse).toBe('C');
    expect(v('keine', 'eingeschränkt', 'eingeschränkt').klasse).toBe('C');
    expect(v('eingeschränkt', 'eingeschränkt', 'eingeschränkt').klasse).toBe('C');
  });

  it('D: sonst', () => {
    expect(v('keine', 'keine', 'keine').klasse).toBe('D');
    expect(v('keine', 'eingeschränkt', 'keine').klasse).toBe('D');
    expect(v('', '', '').klasse).toBe('D');
    expect(v('unbekannt', 'unbekannt', 'unbekannt').klasse).toBe('D');
  });

  it('markiert D als unsicher, wenn es nur an fehlenden Angaben liegt', () => {
    expect(v('keine', 'keine', 'keine').sicher).toBe(true);
    expect(v('', '', '').sicher).toBe(false);
    expect(v('unbekannt', 'keine', 'keine').sicher).toBe(false);
    expect(v('Auftrag gefährdet', '', '').sicher).toBe(true);
  });

  it('nennt den Grund, damit die Regel nachvollziehbar bleibt', () => {
    expect(v('Auftrag gefährdet', '', '').grund).toMatch(/Sekunden/);
    expect(v('keine', 'Auftrag gefährdet', '').grund).toMatch(/4 Stunden/);
    expect(v('keine', 'keine', 'eingeschränkt').grund).toMatch(/3 Tagen/);
  });

  it('verträgt Kurzformen und abweichende Schreibweisen', () => {
    expect(v('gefährdet', '', '').klasse).toBe('A');
    expect(v('AUFTRAG GEFÄHRDET', '', '').klasse).toBe('A');
    expect(v('keine', 'keine', 'Eingeschränkt').klasse).toBe('C');
  });
});

describe('raAutarkieStunden', () => {
  it('übersetzt die Auswahlliste', () => {
    expect(RA.raAutarkieStunden('keine')).toBe(0);
    expect(RA.raAutarkieStunden('1 Tag')).toBe(24);
    expect(RA.raAutarkieStunden('3 Tage')).toBe(72);
    expect(RA.raAutarkieStunden('7 Tage')).toBe(168);
    expect(RA.raAutarkieStunden('14 Tage')).toBe(336);
    expect(RA.raAutarkieStunden('länger')).toBe(720);
  });

  it('gibt bei „unbekannt" und leer nichts zurück statt zu raten', () => {
    expect(RA.raAutarkieStunden('unbekannt')).toBeNull();
    expect(RA.raAutarkieStunden('')).toBeNull();
    expect(RA.raAutarkieStunden(null)).toBeNull();
    expect(RA.raAutarkieStunden('so lange wie nötig')).toBeNull();
  });

  it('liest frei eingetragene Zeitangaben', () => {
    expect(RA.raAutarkieStunden('48 h')).toBe(48);
    expect(RA.raAutarkieStunden('5 Tage')).toBe(120);
    expect(RA.raAutarkieStunden('2 Wochen')).toBe(336);
  });
});

describe('raZahl', () => {
  it('liest deutsche und englische Schreibweisen', () => {
    expect(RA.raZahl('42,5')).toBe(42.5);
    expect(RA.raZahl('1.250,5')).toBe(1250.5);
    expect(RA.raZahl('1.250')).toBe(1250);
    expect(RA.raZahl(42.5)).toBe(42.5);
  });

  it('gibt bei Freitext nichts zurück', () => {
    expect(RA.raZahl('ca. 40')).toBeNull();
    expect(RA.raZahl('unbekannt')).toBeNull();
    expect(RA.raZahl('')).toBeNull();
  });
});

// ── Vollständigkeitsprüfung, Anforderungstexte, Export ──────────────────────

/** Minimale Arbeitsstruktur ohne den Umweg über die Datei. */
function daten(funktionen, opt = {}) {
  return {
    kennung: RA.RA_KENNUNG, version: 1, fehler: [],
    allgemein: { lieg: 'Musterhausen', stand: '2026-09-20', bearb: 'Muster',
      zustaendig: 'Kdo', vorgaben: 'nein', liste_kf: 'nein', ...(opt.allgemein || {}) },
    szenarien: RA.RA_SZENARIEN.map(s => ({
      id: s.id, name: s.name, relevant: 'nein', dauer: '', herkunft: 'vorgegeben',
      ...(opt.szenarien?.[s.id] || {}),
    })),
    funktionen: funktionen.map((f, i) => {
      const voll = { id: RA.raFunktionsId(i), name: 'F', geb: '', betrieb: '24/7',
        ausw_s: 'keine', ausw_4h: 'keine', ausw_3d: 'keine', autarkie_text: 'keine',
        sz: {}, reduziert: 'ja', pk: null, pk_roh: '', pk_art: 'unbekannt',
        ersatz: 'keine', ersatz_info: '', abh: '', herkunft: 'vorgegeben', bem: '', ...f };
      voll.autarkie_h = RA.raAutarkieStunden(voll.autarkie_text);
      const v = RA.raKlasseVorschlag(voll);
      return { ...voll, klasse_vorschlag: v.klasse, klasse_grund: v.grund, klasse_sicher: v.sicher, klasse: v.klasse };
    }),
    bestand: {}, rueckmeldung: {},
  };
}

const texte = p => p.offene_punkte.map(x => x.text).join(' | ');

describe('raPruefung', () => {
  it('nennt eine Funktion ohne Auswirkungsangabe', () => {
    const p = RA.raPruefung(daten([{ name: 'Wache', ausw_s: '', ausw_4h: '', ausw_3d: '' }]));
    expect(texte(p)).toMatch(/Keine Angabe zur Auswirkung/);
  });

  it('nennt einzelne Lücken beim Namen', () => {
    const p = RA.raPruefung(daten([{ name: 'Wache', ausw_s: 'keine', ausw_4h: 'unbekannt', ausw_3d: '' }]));
    expect(texte(p)).toMatch(/Auswirkung nach 4 Stunden und nach 3 Tagen ist offen/);
  });

  it('nennt eine Funktion ohne Autarkieangabe', () => {
    const p = RA.raPruefung(daten([{ name: 'Wache', autarkie_text: 'unbekannt' }]));
    expect(texte(p)).toMatch(/wie lange die Funktion ohne Netz weiterlaufen muss/);
  });

  it('verlangt Messung oder Schätzung, wenn Autarkie gefordert und Krisenlast unbekannt ist', () => {
    const p = RA.raPruefung(daten([{
      name: 'IT', ausw_s: 'Auftrag gefährdet', autarkie_text: '7 Tage', pk: null,
      sz: { S2: 1 },
    }]));
    expect(texte(p)).toMatch(/Autarkie über 7 Tage gefordert, Krisenlast aber unbekannt — Messung bzw. Schätzung erforderlich/);
  });

  it('schweigt zur Krisenlast, wenn keine Autarkie gefordert ist', () => {
    const p = RA.raPruefung(daten([{ name: 'Lager', autarkie_text: 'keine', pk: null }]));
    expect(texte(p)).not.toMatch(/Messung bzw. Schätzung/);
  });

  it('meldet eine unlesbare Krisenlast statt sie zu verwerfen', () => {
    const p = RA.raPruefung(daten([{ name: 'IT', pk: null, pk_roh: 'ca. 40' }]));
    expect(texte(p)).toMatch(/Krisenlast „ca. 40" ist keine Zahl/);
  });

  it('meldet Szenarien ohne Angabe zur Relevanz', () => {
    const p = RA.raPruefung(daten([], { szenarien: { S1: { relevant: 'unbekannt' }, S3: { relevant: '' } } }));
    expect(p.kennzahlen.szenarienOffen).toBe(2);
    expect(texte(p)).toMatch(/S1|Kurzzeitiger/);
  });

  it('meldet eine fehlende Dauer bei relevantem Szenario', () => {
    const p = RA.raPruefung(daten([], { szenarien: { S2: { relevant: 'ja', dauer: '' } } }));
    expect(texte(p)).toMatch(/angenommene Dauer fehlt/);
  });

  it('meldet, wenn die zuständige Stelle nicht benannt ist', () => {
    const p = RA.raPruefung(daten([], { allgemein: { zustaendig: '' } }));
    expect(texte(p)).toMatch(/zuständige Stelle ist nicht benannt/);
  });

  it('meldet vorhandene Vorgaben ohne Bezeichnung', () => {
    const p = RA.raPruefung(daten([], { allgemein: { vorgaben: 'ja', vorgaben_bez: '' } }));
    expect(texte(p)).toMatch(/Bezeichnung und herausgebende Stelle fehlen/);
  });

  it('zählt Herkunft und Anteil der vorgegebenen Angaben', () => {
    const p = RA.raPruefung(daten([
      { name: 'a', herkunft: 'vorgegeben' },
      { name: 'b', herkunft: 'vorgegeben' },
      { name: 'c', herkunft: 'Einschätzung Nutzer' },
      { name: 'd', herkunft: 'unbekannt' },
      { name: 'e', herkunft: '' },
    ]));
    expect(p.kennzahlen.herkunft).toEqual({
      vorgegeben: 2, 'Einschätzung Nutzer': 1, unbekannt: 1, offen: 1,
    });
    expect(p.kennzahlen.anteilVorgegebenPct).toBe(67);
  });

  it('bilanziert Funktionen und bekannte Krisenlasten je Klasse', () => {
    const p = RA.raPruefung(daten([
      { name: 'a', ausw_s: 'Auftrag gefährdet', autarkie_text: '14 Tage', pk: 30, pk_art: 'gemessen', sz: { S2: 1 } },
      { name: 'b', ausw_4h: 'Auftrag gefährdet', autarkie_text: '7 Tage', pk: 12, pk_art: 'geschätzt', sz: { S2: 1 } },
      { name: 'c', ausw_3d: 'eingeschränkt', autarkie_text: '3 Tage', pk: null, sz: { S2: 1 } },
      { name: 'd' },
    ]));
    expect(p.kennzahlen.funktionen).toBe(4);
    expect(p.kennzahlen.jeKlasse.A).toMatchObject({ anzahl: 1, pkAnzahl: 1, pkKw: 30, pkFehlt: 0 });
    expect(p.kennzahlen.jeKlasse.B).toMatchObject({ anzahl: 1, pkKw: 12 });
    expect(p.kennzahlen.jeKlasse.C).toMatchObject({ anzahl: 1, pkKw: 0, pkFehlt: 1 });
    expect(p.kennzahlen.jeKlasse.D).toMatchObject({ anzahl: 1 });
  });

  it('markiert eine vom Klassen-Richtwert abweichende Autarkie als Hinweis, nicht als Fehler', () => {
    const p = RA.raPruefung(daten([
      { name: 'a', ausw_s: 'Auftrag gefährdet', autarkie_text: '3 Tage', pk: 10, sz: { S2: 1 }, pk_art: 'gemessen' },
      { name: 'b', ausw_s: 'Auftrag gefährdet', autarkie_text: '14 Tage', pk: 10, sz: { S2: 1 }, pk_art: 'gemessen' },
    ]));
    const abweichung = p.hinweise.filter(x => /Klassen-Richtwert/.test(x.text));
    expect(abweichung).toHaveLength(1);
    expect(abweichung[0].ref).toBe('F01');
    expect(abweichung[0].text)
      .toMatch(/angegebene Autarkie \(3 Tage\) weicht vom Klassen-Richtwert \(14 Tage, Klasse A\) ab/);
    expect(abweichung[0].text).toMatch(/Übernommen wird die Angabe aus der Abfrage/);
    // F02 trifft den Richtwert und erzeugt keinen Hinweis; Abweichung ist kein offener Punkt
    expect(texte(p)).not.toMatch(/Richtwert/);
  });

  it('überschreibt die angegebene Autarkiedauer nicht aus der Klasse', () => {
    const d = daten([{ name: 'a', ausw_s: 'Auftrag gefährdet', autarkie_text: '1 Tag' }]);
    RA.raPruefung(d);
    expect(d.funktionen[0].autarkie_h).toBe(24);
    expect(RA.raExportJson(d).funktionen[0].autarkie_h).toBe(24);
  });

  it('kommt mit einer leeren Abfrage ohne Ausnahme durch', () => {
    const p = RA.raPruefung({ });
    expect(p.offene_punkte.length).toBeGreaterThan(0);
    expect(p.kennzahlen.funktionen).toBe(0);
    expect(() => RA.raRueckfragenText({}, p)).not.toThrow();
  });
});

describe('raAnforderungstext', () => {
  it('folgt dem Zielschema', () => {
    const d = daten([{
      name: 'Führung / IT', geb: 'Geb 12', ausw_s: 'Auftrag gefährdet',
      autarkie_text: '14 Tage', pk: 42.5, pk_art: 'gemessen', sz: { S2: 1, S5: 1 },
    }], { szenarien: { S4: { relevant: 'ja' } } });
    expect(RA.raAnforderungstext(d.funktionen[0], d.szenarien)).toBe(
      'Funktion „Führung / IT" (Geb 12) ist in den Szenarien S2, S5 mit der Krisenlast 42,5 kW (gemessen) '
      + 'für die Dauer 14 Tage autark zu versorgen; maximale Unterbrechung 0 s (unterbrechungsfrei); '
      + 'Wiederherstellung nach Einzelfehler binnen [offen].');
  });

  it('setzt „[offen]" ein, statt fehlende Werte zu ergänzen', () => {
    const d = daten([{ name: 'Küche', ausw_4h: 'Auftrag gefährdet', autarkie_text: 'unbekannt', pk: null, sz: {} }]);
    const t = RA.raAnforderungstext(d.funktionen[0], d.szenarien);
    expect(t).toMatch(/Szenarien \[offen\]/);
    expect(t).toMatch(/Krisenlast \[offen\]/);
    expect(t).toMatch(/für die Dauer \[offen\]/);
    expect(t).toMatch(/maximale Unterbrechung kleiner 4 h/);
  });

  it('kennzeichnet die Wiederherstellung als nicht gefordert, wenn S4 ausgeschlossen ist', () => {
    const d = daten([{ name: 'Lager', autarkie_text: '3 Tage' }], { szenarien: { S4: { relevant: 'nein' } } });
    expect(RA.raAnforderungstext(d.funktionen[0], d.szenarien))
      .toMatch(/Wiederherstellung nach Einzelfehler binnen nicht gefordert \(Szenario S4 nicht relevant\)\.$/);
  });

  it('übernimmt eine abgestimmte Wiederherstellungszeit je Klasse', () => {
    const d = daten([{ name: 'Wache', ausw_4h: 'Auftrag gefährdet', autarkie_text: '7 Tage', sz: { S4: 1 } }],
      { szenarien: { S4: { relevant: 'ja' } } });
    expect(RA.raAnforderungstext(d.funktionen[0], d.szenarien, { wiederherstellung: { B: '8 h' } }))
      .toMatch(/Wiederherstellung nach Einzelfehler binnen 8 h\.$/);
  });

  it('sagt bei „keine" Autarkie, dass keine Ersatzversorgung gefordert ist', () => {
    const d = daten([
      { name: 'Verwaltung', ausw_3d: 'eingeschränkt', autarkie_text: 'keine' },
      { name: 'Ladesäulen', ausw_s: 'keine', ausw_4h: 'keine', ausw_3d: 'keine', autarkie_text: 'keine' },
    ]);
    expect(RA.raAnforderungstext(d.funktionen[0], d.szenarien))
      .toBe('Funktion „Verwaltung": keine Ersatzversorgung gefordert — der Betrieb ruht bis zur Wiederkehr der Versorgung.');
    expect(RA.raAnforderungstext(d.funktionen[1], d.szenarien)).toMatch(/Last darf im Krisenfall abgeworfen werden\.$/);
  });

  it('sortiert die Anforderungen nach Klasse', () => {
    const d = daten([
      { name: 'd' },
      { name: 'a', ausw_s: 'Auftrag gefährdet' },
      { name: 'c', ausw_3d: 'eingeschränkt' },
      { name: 'b', ausw_4h: 'Auftrag gefährdet' },
    ]);
    expect(RA.raAnforderungen(d).map(x => x.klasse)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('raExportJson', () => {
  const d = daten([{
    name: 'Führung / IT', geb: 'Geb 12', ausw_s: 'Auftrag gefährdet',
    autarkie_text: '14 Tage', pk: 42.5, pk_art: 'gemessen', sz: { S2: 1, S4: 0 },
    ersatz: 'NEA', herkunft: 'vorgegeben',
  }]);
  const json = RA.raExportJson(d);

  it('hält sich an das Schema Version 2', () => {
    expect(json.version).toBe(2);
    expect(json.kategorien).toEqual([]);
    expect(Object.keys(json.meta).sort()).toEqual(['bearb', 'lieg', 'quelle_abfrage', 'stand', 'zustaendig']);
    expect(json.szenarien).toHaveLength(7);
    expect(Object.keys(json.szenarien[0]).sort()).toEqual(['dauer', 'herkunft', 'id', 'name', 'relevant']);
    expect(json.funktionen[0]).toMatchObject({
      id: 'F01', name: 'Führung / IT', geb: 'Geb 12', betrieb: '24/7',
      ausw_s: 'Auftrag gefährdet', autarkie_h: 336, pk: 42.5, pk_art: 'gemessen',
      ersatz: 'NEA', herkunft: 'vorgegeben', klasse_vorschlag: 'A', klasse: 'A',
    });
    expect(json.funktionen[0].sz).toEqual({ S2: 1 });   // nur gesetzte Kreuze
    expect(Array.isArray(json.offene_punkte)).toBe(true);
    expect(json.offene_punkte.every(p => 'ref' in p && 'text' in p)).toBe(true);
  });

  it('übernimmt eine in der Oberfläche geänderte Klasse, behält aber den Vorschlag', () => {
    const geaendert = { ...d, funktionen: [{ ...d.funktionen[0], klasse: 'B' }] };
    const j = RA.raExportJson(geaendert);
    expect(j.funktionen[0]).toMatchObject({ klasse_vorschlag: 'A', klasse: 'B' });
  });

  it('ist JSON-serialisierbar', () => {
    expect(() => JSON.parse(JSON.stringify(json))).not.toThrow();
  });
});

describe('raRueckfragenText und raRueckfragenMappe', () => {
  const d = daten([{ name: 'IT', ausw_s: 'Auftrag gefährdet', autarkie_text: '7 Tage', pk: null, sz: { S2: 1 } }]);

  it('nummeriert die offenen Punkte mit ihrem Bezug', () => {
    const t = RA.raRueckfragenText(d);
    expect(t).toMatch(/Rückfragen zur Resilienzabfrage — Musterhausen/);
    expect(t).toMatch(/1\. \[/);
    expect(t).toMatch(/Klassen ist ein Vorschlag/);
  });

  it('baut eine Rückfragemappe mit Eingabespalten', () => {
    const m = RA.raRueckfragenMappe(d);
    const blatt = m.blaetter[0];
    expect(blatt.name).toBe('Rückfragen');
    expect(blatt.zeilen[RA.RA_KOPFZEILE].map(z => z.w))
      .toEqual(['Nr.', 'Bezug', 'Offener Punkt', 'Antwort', 'Herkunft der Antwort']);
    expect(() => xlsxDateien(m)).not.toThrow();
  });
});

// ── Kategorien ──────────────────────────────────────────────────────────────

function setzeKategorie(m, r, werte) {
  const blatt = blattVon(m, RA.RA_BLATT.kategorien);
  const zeile = blatt.zeilen[RA.RA_KOPFZEILE + 1 + r];
  for (const [feld, wert] of Object.entries(werte)) {
    const c = RA.RA_KATEGORIE_SPALTEN.findIndex(s => s.feld === feld);
    expect(c, `Spalte ${feld} gibt es auf den Kategorien nicht`).toBeGreaterThan(-1);
    zeile[c].w = wert;
  }
}

describe('Kategorien', () => {
  it('bietet auf dem Kategorienblatt nur übertragbare Angaben an — keine Krisenlast, keine Ersatzversorgung', () => {
    const felder = RA.RA_KATEGORIE_SPALTEN.map(s => s.feld);
    expect(felder[0]).toBe('kategorie');
    expect(felder).toContain('ausw_s');
    expect(felder).toContain('sz_S2');
    for (const f of ['id', 'name', 'geb', 'pk', 'pk_art', 'ersatz', 'ersatz_info']) expect(felder).not.toContain(f);
  });

  it('schlägt je Nutzung eine Kategorie vor und schreibt die Betriebszeit dorthin, nicht in die Zeile', () => {
    const geb = [
      { name: 'Geb 1', nutzung: 'kaserne' }, { name: 'Geb 2', nutzung: 'kaserne' },
      { name: 'Geb 3', nutzung: 'verwaltung' }, { name: 'Geb 4', nutzung: 'unbekannt' },
    ];
    expect(RA.raKategorieVorbelegung(geb)).toEqual([
      { kategorie: 'Unterkunft', betrieb: '24/7' },
      { kategorie: 'Verwaltung', betrieb: 'Dienstzeit' },
    ]);
    const v = RA.raVorbelegung(geb);
    expect(v.filter(z => z.kategorie === 'Unterkunft').every(z => z.betrieb === '')).toBe(true);
  });

  it('übernimmt leere Angaben aus der Kategorie, eingetragene gehen vor', async () => {
    const m = mappe({ funktionen: [], leerzeilen: 4 });
    setzeKategorie(m, 0, {
      kategorie: 'Unterkunft', betrieb: '24/7', ausw_s: 'keine', ausw_4h: 'eingeschränkt',
      ausw_3d: 'Auftrag gefährdet', autarkie: '3 Tage', sz_S2: 'x', sz_S3: 'x',
      reduziert: 'ja', abh: 'Wärme', herkunft: 'Einschätzung Nutzer', bem: 'nur für die Kategorie',
    });
    setzeFunktion(m, 0, { geb: 'Geb 10', kategorie: 'Unterkunft' });
    setzeFunktion(m, 1, { name: 'Unterkunft mit San', geb: 'Geb 12', kategorie: 'unterkunft',
      ausw_4h: 'Auftrag gefährdet', autarkie: '7 Tage', sz_S1: 'x', pk: 45 });

    const d = await durchReichen(m);
    expect(d.fehler).toEqual([]);
    expect(d.kategorien).toHaveLength(1);
    const [a, b] = d.funktionen;

    expect(a).toMatchObject({
      name: 'Unterkunft', geb: 'Geb 10', kategorie: 'Unterkunft', betrieb: '24/7',
      ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet',
      autarkie_text: '3 Tage', autarkie_h: 72, reduziert: 'ja', abh: 'Wärme', herkunft: 'Einschätzung Nutzer',
      bem: '', klasse_vorschlag: 'C',
    });
    expect(a.sz).toMatchObject({ S2: 1, S3: 1, S1: 0 });
    expect(a.geerbt).toEqual(expect.arrayContaining(['ausw_s', 'autarkie_text', 'sz', 'name']));

    // Abweichungen der Zeile gelten; Kategorie-Name wird unabhängig von Groß-/Kleinschreibung gefunden
    expect(b).toMatchObject({ kategorie: 'Unterkunft', ausw_4h: 'Auftrag gefährdet', autarkie_h: 168,
      ausw_s: 'keine', pk: 45, klasse_vorschlag: 'B' });
    // Szenario-Kreuze als Ganzes: die Zeile hat ein Kreuz → die der Kategorie zählen nicht
    expect(b.sz).toMatchObject({ S1: 1, S2: 0, S3: 0 });
    expect(b.geerbt).not.toContain('sz');
    expect(b.geerbt).not.toContain('ausw_4h');
  });

  it('meldet eine Kategorie, die es auf dem Kategorienblatt nicht gibt', async () => {
    const m = mappe({ funktionen: [], leerzeilen: 1 });
    setzeFunktion(m, 0, { name: 'Halle', kategorie: 'Sporthalle' });
    const d = await durchReichen(m);
    expect(d.funktionen[0].kategorie_unbekannt).toBe(true);
    expect(texte(RA.raPruefung(d))).toMatch(/Kategorie „Sporthalle" steht nicht auf Blatt „3 Kategorien"/);
  });

  it('meldet eine Lücke der Kategorie einmal, nicht je Gebäude', async () => {
    const m = mappe({ funktionen: [], leerzeilen: 3 });
    setzeKategorie(m, 0, { kategorie: 'Unterkunft', ausw_s: 'keine', ausw_4h: 'keine',
      ausw_3d: 'Auftrag gefährdet', sz_S2: 'x', herkunft: 'Einschätzung Nutzer' });   // Autarkie fehlt
    for (let i = 0; i < 3; i++) setzeFunktion(m, i, { geb: `Geb ${i}`, kategorie: 'Unterkunft' });
    const p = RA.raPruefung(await durchReichen(m));
    const aut = p.offene_punkte.filter(x => /ohne Netz weiterlaufen/.test(x.text));
    expect(aut).toHaveLength(1);
    expect(aut[0].ref).toBe('Kategorie Unterkunft');
    expect(aut[0].text).toMatch(/betrifft 3 Funktionen: F01, F02, F03/);
  });

  it('exportiert Kategorien und die Herkunft übernommener Werte', async () => {
    const m = mappe({ funktionen: [], leerzeilen: 1 });
    setzeKategorie(m, 0, { kategorie: 'Verwaltung', ausw_3d: 'eingeschränkt', autarkie: 'keine' });
    setzeFunktion(m, 0, { geb: 'Geb 20', kategorie: 'Verwaltung' });
    const j = RA.raExportJson(await durchReichen(m));
    expect(j.kategorien[0]).toMatchObject({ kategorie: 'Verwaltung', ausw_3d: 'eingeschränkt', autarkie_h: 0 });
    expect(j.funktionen[0]).toMatchObject({ kategorie: 'Verwaltung', ausw_3d: 'eingeschränkt' });
    expect(j.funktionen[0].geerbt).toContain('ausw_3d');
  });
});

// ── Dateien der Version 1 ───────────────────────────────────────────────────

describe('Abwärtsverträglichkeit', () => {
  it('liest eine Datei der Version 1 (ohne Kategorien) ohne Strukturhinweise', () => {
    const m = mappe({ leerzeilen: 0 });
    setzeFunktion(m, 0, { ausw_s: 'Auftrag gefährdet', betrieb: '24/7', autarkie: '14 Tage' });
    const c = RA.RA_FUNKTION_SPALTEN.findIndex(s => s.feld === 'kategorie');
    const alt = {
      '0 Anleitung': null, '1 Allgemeines': null, '2 Szenarien': null,
      '3 Funktionen': null, '4 Bestand und Organisation': null, '5 Rückmeldung': null,
    };
    const neuZuAlt = {
      [RA.RA_BLATT.anleitung]: '0 Anleitung', [RA.RA_BLATT.allgemeines]: '1 Allgemeines',
      [RA.RA_BLATT.szenarien]: '2 Szenarien', [RA.RA_BLATT.funktionen]: '3 Funktionen',
      [RA.RA_BLATT.bestand]: '4 Bestand und Organisation', [RA.RA_BLATT.rueckmeldung]: '5 Rückmeldung',
    };
    for (const b of m.blaetter) {
      const name = neuZuAlt[b.name];
      if (!name) continue;
      let zeilen = b.zeilen.map(z => (z || []).map(x => (x && typeof x === 'object' ? x.w : x)));
      if (b.name === RA.RA_BLATT.funktionen) zeilen = zeilen.map(z => z.filter((_, i) => i !== c));
      alt[name] = zeilen;
    }
    alt['0 Anleitung'][0][2] = 'MMH-RESILIENZ-ABFRAGE v1';
    const d = RA.raLesen(alt);
    expect(d.fehler).toEqual([]);
    expect(d.version).toBe(1);
    expect(d.kategorien).toEqual([]);
    expect(d.funktionen[0]).toMatchObject({ betrieb: '24/7', autarkie_h: 336, klasse_vorschlag: 'A', kategorie: '' });
  });
});

// ── Beispiel ────────────────────────────────────────────────────────────────

describe('Beispiel', () => {
  it('liegt jeder Abfragedatei als gesperrtes Blatt ohne Eingabezellen bei', () => {
    const b = blattVon(mappe(), RA.RA_BLATT.beispiel);
    expect(b).toBeDefined();
    expect(b.schutz).not.toBe(false);
    const stile = b.zeilen.flat().filter(z => z && typeof z === 'object').map(z => z.s);
    expect(stile).not.toContain(XS.eingabe);
    expect(stile).not.toContain(XS.eingabeZahl);
    const werte = b.zeilen.flat().map(z => z?.w).filter(Boolean);
    for (const f of RA.RA_BEISPIEL.funktionen) expect(werte).toContain(f.id);
    for (const k of RA.RA_BEISPIEL.kategorien) expect(werte).toContain(k.kategorie);
  });

  it('wird beim Einlesen einer Abfrage nicht mitgelesen', async () => {
    const d = await durchReichen(mappe({ funktionen: [], leerzeilen: 2 }));
    expect(d.funktionen).toEqual([]);
    expect(d.kategorien).toEqual([]);
  });

  it('gibt es als vollständig ausgefüllte Datei, die sich fehlerfrei einlesen lässt', async () => {
    const d = await durchReichen(RA.raBeispielMappe());
    expect(d.fehler).toEqual([]);
    expect(d.allgemein.lieg).toMatch(/BEISPIEL/);
    expect(d.kategorien.map(k => k.kategorie)).toEqual(RA.RA_BEISPIEL.kategorien.map(k => k.kategorie));
    expect(d.funktionen).toHaveLength(RA.RA_BEISPIEL.funktionen.length);
    expect(d.funktionen).toHaveLength(10);
    const f = id => d.funktionen.find(x => x.id === id);
    expect(f('F04')).toMatchObject({ kategorie: 'Unterkunft', autarkie_h: 72, klasse_vorschlag: 'C' });
    // Kategorie mit Abweichungen: Auswirkung nach 4 h und Autarkie stehen in der Zeile
    expect(f('F03')).toMatchObject({ kategorie: 'Unterkunft', autarkie_h: 168, klasse_vorschlag: 'B' });
    expect(f('F01').klasse_vorschlag).toBe('A');
    expect(f('F09')).toMatchObject({ kategorie: 'Verwaltung / Ausbildung', klasse_vorschlag: 'D', klasse_sicher: true, autarkie_h: 0 });
    expect(d.szenarien.find(s => s.id === 'S2')).toMatchObject({ relevant: 'ja', dauer: '14 Tage' });
    expect(d.bestand.nea_anzahl).toBe(2);
    // Alle vier Klassen kommen vor
    expect(new Set(d.funktionen.map(x => x.klasse_vorschlag))).toEqual(new Set(['A', 'B', 'C', 'D']));
    // Das Beispiel zeigt bewusst offene Punkte: eine unbekannte Krisenlast und eine Funktion ganz ohne Angaben
    const p = RA.raPruefung(d);
    expect(texte(p)).toMatch(/Küche.*Krisenlast aber unbekannt/);
    expect(texte(p)).toMatch(/Betreuungseinrichtung: Keine Angabe zur Auswirkung/);
    expect(() => xlsxDateien(RA.raBeispielMappe())).not.toThrow();
  });

  const AUSWERTUNG = () => [RA.RA_BLATT.anforderungen, RA.RA_BLATT.luecken, RA.RA_BLATT.loesungsweg, RA.RA_BLATT.massnahmen];

  it('hat in der Beispieldatei die Reiter 7 bis 10, in der Abfragedatei nicht', () => {
    const namen = RA.raBeispielMappe().blaetter.map(b => b.name);
    expect(namen.slice(-5)).toEqual([...AUSWERTUNG(), RA.RA_BLATT.listen]);
    const abfrage = mappe().blaetter.map(b => b.name);
    for (const n of AUSWERTUNG()) expect(abfrage).not.toContain(n);
    // Die Anleitung erklärt, wer was macht, und verweist auf die Reiter 7 bis 10
    const anleitung = textVon(blattVon(mappe(), RA.RA_BLATT.anleitung));
    expect(anleitung).toMatch(/Wer macht was/);
    expect(anleitung).toMatch(/Reitern 7 bis 10/);
  });

  it('kennzeichnet die Reiter 7 bis 10 als Sache der erhebenden Stelle und zeigt den Schritt im Weg zur Maßnahme', () => {
    const m = RA.raBeispielMappe();
    const schritt = { [RA.RA_BLATT.anforderungen]: '[ ② Abhängigkeiten ]', [RA.RA_BLATT.luecken]: '[ ③ Lücken ]',
      [RA.RA_BLATT.loesungsweg]: '[ ④ Optionen ]', [RA.RA_BLATT.massnahmen]: '[ ⑤ Maßnahmen ]' };
    for (const name of AUSWERTUNG()) {
      const b = blattVon(m, name);
      expect(b.schutz).not.toBe(false);
      const stile = b.zeilen.flat().filter(z => z && typeof z === 'object').map(z => z.s);
      expect(stile).not.toContain(XS.eingabe);
      const alles = textVon(b);
      expect(alles, name).toMatch(/Füllt aus: erhebende Stelle/);
      expect(alles, name).toMatch(/füllt NICHT der Empfänger aus/);
      expect(alles, name).toContain(schritt[name]);
    }
  });

  it('leitet auf Reiter 7 je Funktion eine Anforderung ab und stuft über Abhängigkeiten hoch', () => {
    const b = blattVon(RA.raBeispielMappe(), RA.RA_BLATT.anforderungen);
    const werte = b.zeilen.flat().map(z => z?.w).filter(v => v != null);
    const alles = werte.join(' | ');
    for (const f of RA.RA_BEISPIEL.funktionen) expect(werte).toContain(f.id);
    expect(alles).toMatch(/Funktion „Führung \/ IT \/ Serverraum" \(Geb\. 1, Stabsgebäude\) ist in den Szenarien S1, S2, S3, S4, S5 .* binnen 1 h\./);
    expect(alles).toMatch(/Funktion „Verwaltung".*Last darf im Krisenfall abgeworfen werden/);
    // offen bleibt die Wiederherstellung nur bei F10, zu der alle Angaben fehlen
    expect(alles.match(/binnen \[offen\]/g)).toHaveLength(1);
    expect(alles).toMatch(/Funktion „Betreuungseinrichtung"[^|]*binnen \[offen\]/);
    // Schritt ②: Betankung (C) wird wie A geplant, Heizzentrale (C) wie B, Pumpenhaus bleibt
    expect(alles).toMatch(/②  Abhängigkeiten/);
    expect(alles).toContain('wie Klasse A · 14 Tage · Unterbrechung kleiner 24 h');
    expect(alles).toContain('wie Klasse B · 7 Tage · Unterbrechung kleiner 12 h');
    expect(werte).toContain('unverändert');
  });

  it('formuliert die Anforderung je Szenario aus Funktion und Szenariodauer', () => {
    const d = RA.raBeispielDaten();
    const f = id => d.funktionen.find(x => x.id === id);
    const s = id => d.szenarien.find(x => x.id === id);
    const wh = { wiederherstellung: RA.RA_BEISPIEL.auswertung.wiederherstellung };
    expect(RA.raSzenarioAnforderung(f('F01'), s('S1'), wh)).toBe('57 kW über 4 h überbrücken; Unterbrechung 0 s (unterbrechungsfrei)');
    expect(RA.raSzenarioAnforderung(f('F01'), s('S2'), wh)).toBe('57 kW für 14 Tage autark; Unterbrechung 0 s (unterbrechungsfrei)');
    // S3 dauert 7 Tage: vor Ort muss Kraftstoff für die kürzere der beiden Dauern liegen
    expect(RA.raSzenarioAnforderung(f('F01'), s('S3'), wh)).toBe('Kraftstoff für 7 Tage vor Ort, ohne Nachlieferung');
    expect(RA.raSzenarioAnforderung(f('F04'), s('S3'), wh)).toBe('Kraftstoff für 3 Tage vor Ort, ohne Nachlieferung');
    expect(RA.raSzenarioAnforderung(f('F01'), s('S4'), wh)).toBe('nach Ausfall eines Betriebsmittels binnen 1 h wieder versorgt');
    expect(RA.raSzenarioAnforderung(f('F01'), s('S5'), wh)).toMatch(/\(Relevanz offen\)$/);
    expect(RA.raSzenarioAnforderung(f('F05'), s('S2'), wh)).toMatch(/^Krisenlast \[offen\] für 3 Tage/);
    expect(RA.raSzenarioAnforderung(f('F09'), s('S2'), wh)).toBe('keine Ersatzversorgung — Abgang abschalten');
  });

  it('sichert im Beispiel jede angekreuzte Funktion in jedem Szenario ab — vorhanden oder per Maßnahme', () => {
    const A = RA.RA_BEISPIEL.auswertung;
    const d = RA.raBeispielDaten();
    const abs = RA.raAbsicherung(d, A.massnahmen, { wiederherstellung: A.wiederherstellung });
    const status = abs.zeilen.flatMap(z => Object.values(z.zellen).map(c => c.status));
    expect(status).not.toContain('offen');
    expect(status).toContain('vorhanden');
    expect(status).toContain('massnahme');
    // Stichproben: Pumpenhaus bei Hochwasser über M03, Wache bei S1 durch NEA 2
    const z = id => abs.zeilen.find(x => x.f.id === id);
    expect(z('F07').zellen.S7).toMatchObject({ status: 'massnahme', massnahmen: ['M03'] });
    expect(z('F02').zellen.S1.status).toBe('vorhanden');
    expect(z('F01').zellen.S6.status).toBe('nicht');
    // F09 und F10 haben kein Szenario — ihre Maßnahmen stehen szenarioübergreifend
    expect(z('F09').uebergreifend).toEqual(['M09']);
    expect(z('F10').uebergreifend).toEqual(['M10']);
    // jede Maßnahme mit Funktionen wirkt irgendwo, und jede Maßnahme bezieht sich auf bekannte Funktionen
    const ids = new Set(RA.RA_BEISPIEL.funktionen.map(f => f.id));
    for (const m of A.massnahmen) {
      for (const id of m.fuer) expect(ids.has(id), `${m.id} → ${id}`).toBe(true);
      if (!m.fuer.length) continue;
      const wirkt = abs.zeilen.some(x => x.uebergreifend.includes(m.id)
        || Object.values(x.zellen).some(c => c.massnahmen.includes(m.id)));
      expect(wirkt, m.id).toBe(true);
    }
  });

  it('hält die Kette Prüfung → Bündel → Maßnahme im Beispiel lückenlos', () => {
    const A = RA.RA_BEISPIEL.auswertung;
    const ids = new Set(RA.RA_BEISPIEL.funktionen.map(f => f.id));
    const buendel = new Map(A.buendel.map(b => [b.id, b]));
    const mx = new Map(A.massnahmen.map(m => [m.id, m]));
    // jede Funktion ist geprüft und landet in mindestens einem Bündel
    for (const id of ids) {
      expect(A.pruefung[id], `Prüfung zu ${id}`).toBeTruthy();
      expect(A.pruefung[id].buendel.length, id).toBeGreaterThan(0);
      for (const b of A.pruefung[id].buendel) expect(buendel.has(b), `${id} → ${b}`).toBe(true);
    }
    // jedes Bündel wird gebraucht, hat höchstens eine gewählte Option und führt zu bekannten Maßnahmen
    const benutzt = new Set(Object.values(A.pruefung).flatMap(p => p.buendel));
    for (const b of A.buendel) {
      expect(benutzt.has(b.id), b.id).toBe(true);
      if (b.optionen.length) expect(b.optionen.filter(o => o.gewaehlt), b.id).toHaveLength(1);
      for (const m of b.massnahmen) expect(mx.get(m)?.aus, `${b.id} → ${m}`).toBe(b.id);
    }
    // jede Maßnahme stammt aus genau dem Bündel, das sie nennt
    for (const m of A.massnahmen) expect(buendel.get(m.aus)?.massnahmen, m.id).toContain(m.id);
    // Abhängigkeiten verweisen auf bekannte Funktionen
    for (const a of A.abhaengigkeiten) for (const id of [a.id, ...a.fuer]) expect(ids.has(id), `${a.id} → ${id}`).toBe(true);
  });

  it('vergleicht auf Reiter 8 Soll und Bestand je Prüfpunkt, farbig nach Ergebnis', () => {
    const b = blattVon(RA.raBeispielMappe(), RA.RA_BLATT.luecken);
    const zellen = b.zeilen.flat().filter(z => z && typeof z === 'object');
    const alles = textVon(b);
    for (const p of RA.RA_PRUEFPUNKTE) expect(alles).toContain(p.frage);
    expect(zellen.some(z => z.s === XS.gut && /^✓/.test(z.w))).toBe(true);
    expect(zellen.some(z => z.s === XS.luecke && /^✗/.test(z.w))).toBe(true);
    // Hochgestufte Funktion zeigt die Planungswerte aus Schritt ②
    expect(alles).toContain('wie Klasse A (Schritt ②, aus Klasse C) · 6 kW · 14 Tage');
    // F04 hat S1 nicht angekreuzt → Prüfpunkt „Unterbrechung" entfällt
    const f04 = b.zeilen.find(z => z?.[0]?.w === 'F04');
    const spalte = 4 + RA.RA_PRUEFPUNKTE.findIndex(p => p.feld === 'unterbrechung');
    expect(f04[spalte].w).toBe('—');
    expect(f04.at(-1).w).toBe('B5');
  });

  it('wägt auf Reiter 9 je Bündel die Optionen ab und nennt die gewählte Maßnahme', () => {
    const b = blattVon(RA.raBeispielMappe(), RA.RA_BLATT.loesungsweg);
    const zellen = b.zeilen.flat().filter(z => z && typeof z === 'object');
    const alles = textVon(b);
    for (const t of RA.RA_LUECKENTYPEN) expect(alles).toContain(t.optionen);
    for (const bu of RA.RA_BEISPIEL.auswertung.buendel) expect(alles).toContain(`${bu.id}  ${bu.titel}`);
    expect(zellen.some(z => z.s === XS.gut && z.w === 'c ✓')).toBe(true);
    expect(alles).toMatch(/M03: NEA für das Pumpenhaus/);
    expect(alles).toMatch(/Hier wirkt Schritt ②/);
    for (const v of b.verbunden) expect(v).toMatch(/^[A-G]\d+:[A-G]\d+$/);
  });

  it('listet auf Reiter 10 jede Maßnahme mit Herkunft und weist die Absicherung nach', () => {
    const b = blattVon(RA.raBeispielMappe(), RA.RA_BLATT.massnahmen);
    const zeilen = b.zeilen.filter(z => z?.[0]?.w && /^M\d\d$/.test(z[0].w));
    expect(zeilen.map(z => z[0].w).sort()).toEqual(RA.RA_BEISPIEL.auswertung.massnahmen.map(m => m.id).sort());
    const m03 = zeilen.find(z => z[0].w === 'M03');
    expect(m03[2].w).toBe('B3');
    expect(m03[3].w).toBe('S1, S2, S4, S7');
    const zellen = b.zeilen.flat().filter(z => z && typeof z === 'object');
    expect(zellen.some(z => z.s === XS.gut && z.w === 'vorhanden')).toBe(true);
    expect(zellen.some(z => z.s === XS.luecke && z.w === 'M03')).toBe(true);
    const f06 = b.zeilen.find(z => z?.[0]?.w === 'F06');
    expect(f06[2].w).toBe('C → B');
    for (const v of b.verbunden) expect(v).toMatch(/^[A-M]\d+:[A-M]\d+$/);
  });

  it('zeigt auf dem Beispielblatt auch die Frage-Blätter 1, 5 und 6', () => {
    const b = blattVon(mappe(), RA.RA_BLATT.beispiel);
    const werte = b.zeilen.flat().map(z => z?.w).filter(Boolean);
    for (const t of ['Blatt „1 Allgemeines"', 'Blatt „5 Bestand und Organisation"', 'Blatt „6 Rückmeldung"']) {
      expect(werte).toContain(t);
    }
    expect(werte).toContain(RA.RA_BEISPIEL.allgemein.auftrag);
    expect(werte).toContain(RA.RA_BEISPIEL.bestand.schwach);
    // Antworten stehen je Frage verbunden über B:F
    const zeileVon = t => b.zeilen.findIndex(z => z?.[0]?.w === t) + 1;
    for (const f of [...RA.RA_ALLGEMEIN_FELDER, ...RA.RA_BESTAND_FELDER, ...RA.RA_RUECKMELDUNG_FELDER]) {
      const r = zeileVon(f.frage);
      expect(b.verbunden, f.feld).toContain(`B${r}:F${r}`);
    }
  });

  it('stellt Kategorien auf dem Beispielblatt genau über die Funktionsspalten, die sie vererben', () => {
    const b = blattVon(mappe(), RA.RA_BLATT.beispiel);
    const kat = RA.RA_BEISPIEL.kategorien[0];
    const fun = RA.RA_BEISPIEL.funktionen.find(f => f.kategorie === kat.kategorie && f.autarkie == null);
    const zKat = b.zeilen.find(z => z?.[0]?.w === kat.erl);
    const zFun = b.zeilen.find(z => z?.[0]?.w === fun.erl);
    // Spalte über die Kopfzeile von Teil 1 der Funktionen finden
    const kopf = b.zeilen[b.zeilen.indexOf(zFun) - RA.RA_BEISPIEL.funktionen.indexOf(fun) - 1];
    const c = kopf.findIndex(z => z?.w === RA.RA_FUNKTION_SPALTEN.find(s => s.feld === 'autarkie').titel);
    expect(c).toBeGreaterThan(0);
    expect(zKat[c].w).toBe(kat.autarkie);
    expect(zFun[c].w).toBeNull();            // kommt aus der Kategorie
    const k = kopf.findIndex(z => z?.w === 'Kategorie');
    expect(zKat[k].w).toBe(kat.kategorie);
    expect(zFun[k].w).toBe(kat.kategorie);
  });

  it('teilt Kategorien und Funktionen auf dem Beispielblatt in zwei Teile, damit das Blatt schmal bleibt', () => {
    const b = blattVon(mappe(), RA.RA_BLATT.beispiel);
    expect(b.spalten.length).toBeLessThanOrEqual(18);
    for (const z of b.zeilen) expect((z || []).length, 'Zeile zu breit').toBeLessThanOrEqual(18);
    const alles = textVon(b);
    expect(alles.match(/Teil 1 — Auswirkungen und Szenarien/g)).toHaveLength(2);
    expect(alles).toMatch(/Teil 2 — Leistung, Ersatzversorgung und Abhängigkeiten/);
    // Teil 2 trägt Krisenlast und Ersatzversorgung je Funktion — F01 steht in beiden Teilen
    const f01 = b.zeilen.filter(z => z?.[1]?.w === 'F01');
    expect(f01).toHaveLength(2);
    expect(f01[1].map(z => z?.w)).toContain(57);
    expect(f01[1].map(z => z?.w)).toContain('USV+NEA');
    // Gedruckt: neue Seite vor Blatt 3, Blatt 4, Teil 2 der Funktionen und Blatt 5
    expect(b.umbrueche).toHaveLength(4);
    const vor = b.umbrueche.map(r => b.zeilen[r][0].w);
    expect(vor[0]).toMatch(/^Blatt „3 Kategorien"/);
    expect(vor[1]).toMatch(/^Blatt „4 Funktionen"/);
    expect(vor[2]).toMatch(/^Teil 2 — Leistung/);
    expect(vor[3]).toMatch(/^Blatt „5 Bestand/);
  });
});

describe('Aufbau und Aussehen der Mappe', () => {
  it('färbt die Reiter nach Rolle und druckt quer', () => {
    const m = RA.raBeispielMappe();
    const farbe = n => blattVon(m, n).tabFarbe;
    expect(farbe(RA.RA_BLATT.funktionen)).toBe(farbe(RA.RA_BLATT.allgemeines));
    expect(farbe(RA.RA_BLATT.massnahmen)).toBe(farbe(RA.RA_BLATT.anforderungen));
    expect(farbe(RA.RA_BLATT.funktionen)).not.toBe(farbe(RA.RA_BLATT.massnahmen));
    expect(farbe(RA.RA_BLATT.beispiel)).not.toBe(farbe(RA.RA_BLATT.funktionen));
    expect(blattVon(m, RA.RA_BLATT.listen).tabFarbe).toBeUndefined();
    for (const b of m.blaetter.filter(x => !x.versteckt)) expect(b.quer, b.name).toBe(true);
  });

  it('verbindet die Hinweiszeile der Eingabeblätter über die Tabelle, statt sie in Spalte A umzubrechen', () => {
    const m = mappe();
    for (const n of [RA.RA_BLATT.allgemeines, RA.RA_BLATT.szenarien, RA.RA_BLATT.kategorien,
      RA.RA_BLATT.funktionen, RA.RA_BLATT.bestand, RA.RA_BLATT.rueckmeldung]) {
      const b = blattVon(m, n);
      expect(b.verbunden.some(v => /^A2:[B-Z]2$/.test(v)), n).toBe(true);
    }
    expect(blattVon(m, RA.RA_BLATT.funktionen).fixSpalten).toBe(2);
  });

  it('gliedert die Anleitung mit einer Übersicht über alle Blätter und einer Begriffstabelle', () => {
    const an = blattVon(mappe(), RA.RA_BLATT.anleitung);
    const alles = textVon(an);
    expect(alles).toMatch(/Aufbau der Datei/);
    for (const n of [RA.RA_BLATT.allgemeines, RA.RA_BLATT.szenarien, RA.RA_BLATT.kategorien,
      RA.RA_BLATT.funktionen, RA.RA_BLATT.bestand, RA.RA_BLATT.rueckmeldung]) {
      expect(an.zeilen.some(z => z?.[1]?.w === n), n).toBe(true);
    }
    for (const t of ['Funktion', 'Krisenlast', 'Autarkie', 'Unterbrechung', 'Wiederherstellung']) {
      expect(an.zeilen.some(z => z?.[1]?.w === t), t).toBe(true);
    }
    // Die Kennung bleibt in der ausgeblendeten Zelle C1
    expect(an.zeilen[0][2].w).toBe(RA.RA_KENNUNG);
    expect(an.verbunden.some(v => v.startsWith('B1:'))).toBe(false);
  });
});
