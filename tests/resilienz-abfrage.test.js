// Vitest-Tests für lib/resilienz-abfrage.js — Abfragedatei, Round-Trip,
// Klassenregel und Vollständigkeitsprüfung.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { xlsxDateien } from '../src/lib/xlsx-schreiber.js';
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
      '0 Anleitung', '1 Allgemeines', '2 Szenarien', '3 Funktionen',
      '4 Bestand und Organisation', '5 Rückmeldung', 'Listen',
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
    for (const p of blatt.pruefungen) expect(RA.RA_LISTEN[p.liste]).toBeDefined();
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
      { id: 'F01', name: 'Unterkunft', geb: 'Geb 12', betrieb: '24/7' },
      { id: 'F02', name: 'Küche / Verpflegung', geb: 'Geb 30', betrieb: 'Dienstzeit' },
      { id: 'F03', name: 'Nutzung noch festzulegen', geb: 'Geb 99', betrieb: '' },
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
    expect(d.fehler.join(' ')).toMatch(/Blatt „3 Funktionen" fehlt/);
    expect(d.funktionen).toEqual([]);
  });

  it('meldet eine umbenannte Spalte, liest den Rest aber weiter', async () => {
    const m = mappe({ leerzeilen: 0 });
    const blatt = blattVon(m, RA.RA_BLATT.funktionen);
    blatt.zeilen[RA.RA_KOPFZEILE][3].w = 'Betriebzeit';   // Tippfehler des Empfängers
    setzeFunktion(m, 0, { ausw_s: 'Auftrag gefährdet' });
    const d = await durchReichen(m);
    expect(d.fehler.join(' ')).toMatch(/Spalte D .* heißt „Betriebzeit"/);
    expect(d.funktionen[0].klasse_vorschlag).toBe('A');
  });

  it('meldet eine ältere Dateiversion, ohne den Import abzubrechen', () => {
    const m = mappe({ leerzeilen: 0 });
    const an = blattVon(m, RA.RA_BLATT.anleitung);
    an.zeilen[0][2].w = 'MMH-RESILIENZ-ABFRAGE v0';
    const blaetter = Object.fromEntries(m.blaetter.map(b =>
      [b.name, b.zeilen.map(z => (z || []).map(c => (c && typeof c === 'object' ? c.w : c)))]));
    const d = RA.raLesen(blaetter);
    expect(d.fehler.join(' ')).toMatch(/Version 0, erwartet wird Version 1/);
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

  it('hält sich an das Schema Version 1', () => {
    expect(json.version).toBe(1);
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
