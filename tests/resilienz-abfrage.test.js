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
    expect(texte(p)).toMatch(/Autarkie von 7 Tage gefordert, Krisenlast aber unbekannt — Messung bzw. Schätzung erforderlich/);
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
      .toMatch(/angegebene Autarkie 3 Tage weicht vom Klassen-Richtwert 14 Tage \(Klasse A\) ab/);
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
    const d = daten([{ name: 'Lager' }], { szenarien: { S4: { relevant: 'nein' } } });
    expect(RA.raAnforderungstext(d.funktionen[0], d.szenarien))
      .toMatch(/Wiederherstellung nach Einzelfehler binnen nicht gefordert \(Szenario S4 nicht relevant\)\.$/);
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
    const f = id => d.funktionen.find(x => x.id === id);
    expect(f('F03')).toMatchObject({ kategorie: 'Unterkunft', autarkie_h: 72, klasse_vorschlag: 'C' });
    expect(f('F05')).toMatchObject({ autarkie_h: 168, klasse_vorschlag: 'B' });
    expect(f('F01').klasse_vorschlag).toBe('A');
    expect(d.szenarien.find(s => s.id === 'S2')).toMatchObject({ relevant: 'ja', dauer: '3 Tage' });
    expect(d.bestand.nea_anzahl).toBe(2);
    // Das Beispiel zeigt bewusst eine offene Krisenlast
    expect(texte(RA.raPruefung(d))).toMatch(/Werkstatt.*Krisenlast aber unbekannt/);
    expect(() => xlsxDateien(RA.raBeispielMappe())).not.toThrow();
  });
});
