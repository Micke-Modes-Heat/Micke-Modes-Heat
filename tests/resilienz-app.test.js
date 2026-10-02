// Vitest-Tests für lib/resilienz-app.js (Erhebungs-Werkzeug als HTML-Datei)
// und raLesenErhebung() in lib/resilienz-abfrage.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as RA from '../src/lib/resilienz-abfrage.js';
import * as APP from '../src/lib/resilienz-app.js';

const VORLAGE = readFileSync(resolve('src/resilienz-app/vorlage.html'), 'utf8');
const SKRIPT = readFileSync(resolve('src/resilienz-app/app.js'), 'utf8');

const GEB = [
  { id: 7, name: 'Geb. 1 Stab', nutzung: 'verwaltung',
    polygon: [{ lat: 50.1, lng: 8.1 }, { lat: 50.1001, lng: 8.1 }, { lat: 50.1001, lng: 8.1002 }] },
  { id: 'u2', name: 'Unterkunft 2', nutzung: 'unterkunft',
    polygon: [[50.2, 8.2], [50.2001, 8.2], [50.2001, 8.20021234567]] },
  { id: 9, name: 'Ohne Umriss', nutzung: 'unterkunft' },
];

describe('raErhebungStart', () => {
  const st = APP.raErhebungStart({ meta: { lieg: 'Musterkaserne', stelle: 'BwDLZ', ansprechpartner: 'Frau X' }, gebaeude: GEB, uid: 'u1' });

  it('trägt Kennung, Meta und Allgemeines', () => {
    expect(st.kennung).toBe(RA.RA_ERHEBUNG_KENNUNG);
    expect(st.uid).toBe('u1');
    expect(st.meta.ansprechpartner).toBe('Frau X');
    expect(st.allgemein).toEqual({ lieg: 'Musterkaserne', stelle: 'BwDLZ' });
  });

  it('legt je Gebäude eine Funktion mit Gebäudekennung an, danach die typischen ohne Gebäude', () => {
    expect(st.funktionen.slice(0, 3).map(f => f.gebId)).toEqual([7, 'u2', 9]);
    expect(st.funktionen[1]).toMatchObject({ name: 'Unterkunft', geb: 'Unterkunft 2', betrieb: '24/7' });
    expect(st.funktionen.slice(3).every(f => f.gebId === null)).toBe(true);
  });

  it('ohne Gebäudearten: keine Kategorien, keine Kategorie an den Funktionen', () => {
    expect(st.kategorien).toEqual([]);
    expect(st.funktionen.every(f => !('kategorie' in f))).toBe(true);
  });

  it('übernimmt Umrisse in beiden Schreibweisen, gerundet; ohne Umriss → null', () => {
    expect(st.gebaeude[0].umriss[2]).toEqual([50.1001, 8.1002]);
    expect(st.gebaeude[1].umriss[2]).toEqual([50.2001, 8.200212]);
    expect(st.gebaeude[2].umriss).toBeNull();
  });
});

describe('RA_KATALOG', () => {
  const klasse = e => RA.raKlasseVorschlag(e).klasse;

  it('hat ein Beispiel zu jeder typischen Funktion und jeder Nutzung', () => {
    const namen = new Set(RA.RA_KATALOG.map(e => e.name));
    for (const v of RA.RA_FUNKTION_VORLAGEN) expect(namen.has(v.name)).toBe(true);
    for (const f of RA.raVorbelegung([{ nutzung: 'kantine' }, { nutzung: 'labor' }, { nutzung: 'feuerwehr' }, { nutzung: 'technik' }])) {
      expect(namen.has(f.name)).toBe(true);
    }
  });

  it('Antworten stammen aus den Auswahllisten; Herkunft bleibt leer', () => {
    for (const e of RA.RA_KATALOG) {
      for (const [feld, liste] of [['ausw_s', 'L_Auswirkung'], ['ausw_4h', 'L_Auswirkung'], ['ausw_3d', 'L_Auswirkung'],
        ['autarkie_text', 'L_Autarkie'], ['betrieb', 'L_Betrieb'], ['reduziert', 'L_JaNein']]) {
        expect(RA.RA_LISTEN[liste]).toContain(e[feld]);
      }
      expect(e.herkunft).toBeUndefined();
      expect(e.warum.length).toBeGreaterThan(20);
      // eingeordnete Funktionen nennen auch die Lagen, für die sie gelten
      if (klasse(e) !== 'D') expect(Object.keys(e.sz).length).toBeGreaterThan(0);
    }
  });

  it('typische Einordnungen', () => {
    const k = name => klasse(RA.RA_KATALOG.find(e => e.name === name));
    expect(k('Führung / IT / Kommunikation')).toBe('A');
    expect(k('Wache / Zugangskontrolle')).toBe('B');
    expect(k('Unterkunft')).toBe('C');
    expect(k('Verwaltung')).toBe('D');
  });

  it('steht in der Konfiguration des Werkzeugs', () => {
    expect(APP.raErhebungKonfig().katalog).toBe(RA.RA_KATALOG);
  });

});

describe('raErhebungHtml / raErhebungAusHtml', () => {
  const stand = APP.raErhebungStart({ meta: { lieg: 'Muster </script><b>' }, gebaeude: GEB, uid: 'u1' });
  const html = APP.raErhebungHtml({ vorlage: VORLAGE, app: SKRIPT, stand });

  it('ersetzt alle Platzhalter und escaped den Titel', () => {
    for (const p of Object.values(APP.RA_APP_PLATZHALTER)) expect(html).not.toContain(p);
    expect(html).toContain('<title>Resilienz-Erhebung – Muster &lt;/script&gt;&lt;b&gt;</title>');
  });

  it('der eingebettete Stand kann kein </script> enthalten und kommt unverändert zurück', () => {
    const block = /<script[^>]*id="ra-stand"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
    expect(block).not.toMatch(/<\//);
    expect(APP.raErhebungAusHtml(html)).toEqual(stand);
  });

  it('das eingebettete Skript ist gültiges JavaScript', () => {
    const skripte = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(skripte).toHaveLength(1);
    const dir = mkdtempSync(resolve(tmpdir(), 'ra-app-'));
    const datei = resolve(dir, 'app.js');
    writeFileSync(datei, skripte[0]);
    expect(() => execFileSync(process.execPath, ['--check', datei])).not.toThrow();
  });

  it('ohne Stand im Text → null; fehlender Platzhalter → Fehler', () => {
    expect(APP.raErhebungAusHtml('<html></html>')).toBeNull();
    expect(() => APP.raErhebungHtml({ vorlage: '<html></html>', app: '', stand })).toThrow(/Platzhalter/);
  });

  it('Dateiname', () => {
    expect(APP.raErhebungDateiname({ lieg: 'Kaserne Nord, Ulm', stand: '2026-10-02' })).toBe('Resilienzerhebung_Kaserne_Nord_Ulm_2026-10-02.html');
  });
});

describe('raLesenErhebung', () => {
  const stand = {
    kennung: RA.RA_ERHEBUNG_KENNUNG,
    allgemein: { lieg: 'Musterkaserne', vorgaben: 'Ja', zustaendig: 'Kdo' },
    szenarien: [{ id: 's2', relevant: 'ja', dauer: '14 Tage', herkunft: 'vorgegeben' }],
    kategorien: [
      { kategorie: 'Unterkunft', betrieb: '24/7', ausw_s: 'keine', ausw_4h: 'keine', ausw_3d: 'eingeschränkt',
        autarkie_text: '3 Tage', sz: { S2: 1 }, herkunft: 'Einschätzung Nutzer' },
      { kategorie: 'unterkunft', betrieb: 'Dienstzeit' },
    ],
    funktionen: [
      { id: 'F01', name: 'Unterkunft', geb: 'Unterkunft 2', gebId: 'u2', kategorie: 'Unterkunft', sz: {} },
      { id: 'F02', name: 'Stab', geb: 'Geb. 1', gebId: 7, ausw_s: 'Auftrag gefährdet', ausw_4h: 'Auftrag gefährdet',
        ausw_3d: 'Auftrag gefährdet', autarkie_text: '14 Tage', sz: { S1: 1, S2: 1 }, pk: 35.5, pk_art: 'geschätzt',
        ersatz: 'USV+NEA', abh: 'IT-Netz, Kommunikation', herkunft: 'vorgegeben' },
      { id: 'F03', name: '', geb: '', gebId: null, sz: {} },
      { id: 'F04', name: 'Betankung', gebId: null, pk: '12,5', sz: null },
    ],
    bestand: { nea_anzahl: '2', brennstoff_vertrag: 'nein' },
    rueckmeldung: { offen: 'Lastgang fehlt' },
  };
  const d = RA.raLesenErhebung(stand);

  it('liest ohne Strukturfehler und normalisiert Listenwerte', () => {
    expect(d.fehler).toEqual([]);
    expect(d.version).toBe(1);
    expect(d.allgemein.vorgaben).toBe('ja');
    expect(d.szenarien.find(s => s.id === 'S2')).toMatchObject({ relevant: 'ja', dauer: '14 Tage', herkunft: 'vorgegeben' });
    expect(d.szenarien).toHaveLength(RA.RA_SZENARIEN.length);
    expect(d.bestand.nea_anzahl).toBe(2);
  });

  it('doppelte Gebäudeart: die erste gilt', () => {
    expect(d.kategorien).toHaveLength(1);
    expect(d.kategorien[0].autarkie_h).toBe(72);
  });

  it('Funktion übernimmt leere Angaben aus der Gebäudeart — dieselbe Regel wie beim Einlesen der .xlsx', () => {
    const f = d.funktionen.find(x => x.id === 'F01');
    expect(f).toMatchObject({ gebId: 'u2', betrieb: '24/7', autarkie_h: 72, klasse: 'C', herkunft: 'Einschätzung Nutzer' });
    expect(f.sz).toMatchObject({ S2: 1, S1: 0 });
    expect(f.geerbt).toContain('sz');
  });

  it('eigene Angaben, Zahlen und Kennung bleiben erhalten; leere Zeilen fallen weg', () => {
    const f = d.funktionen.find(x => x.id === 'F02');
    expect(f).toMatchObject({ gebId: 7, klasse: 'A', autarkie_h: 336, pk: 35.5, ersatz: 'USV+NEA' });
    expect(d.funktionen.find(x => x.id === 'F03')).toBeUndefined();
    expect(d.funktionen.find(x => x.id === 'F04').pk).toBe(12.5);
  });

  it('läuft durch Prüfung und Anforderungstexte wie eine eingelesene Datei', () => {
    const p = RA.raPruefung(d);
    expect(p.kennzahlen.funktionen).toBe(3);
    expect(RA.raAnforderungen(d).length).toBeGreaterThan(0);
  });

  it('fremde Datei: Hinweis statt Absturz', () => {
    const x = RA.raLesenErhebung({ funktionen: 'kaputt' });
    expect(x.fehler[0]).toMatch(/Kennung/);
    expect(x.funktionen).toEqual([]);
  });

  it('Round-Trip: Anfangsstand eines Projekts liest sich', () => {
    const st = APP.raErhebungStart({ meta: { lieg: 'X' }, gebaeude: GEB, uid: 'u' });
    const r = RA.raLesenErhebung(APP.raErhebungAusHtml(APP.raErhebungHtml({ vorlage: VORLAGE, app: SKRIPT, stand: st })));
    expect(r.fehler).toEqual([]);
    expect(r.funktionen.map(f => f.gebId).slice(0, 3)).toEqual([7, 'u2', 9]);
  });
});

describe('Übertragene Angaben (quelle)', () => {
  const basis = { name: 'Unterkunft', ausw_s: 'keine', ausw_4h: 'eingeschränkt', ausw_3d: 'Auftrag gefährdet',
    autarkie_text: '3 Tage', sz: { S2: 1 } };
  const stand = {
    kennung: RA.RA_ERHEBUNG_KENNUNG,
    funktionen: [
      { id: 'F01', gebId: 1, ...basis, katalog: 'Unterkunft' },
      { id: 'F02', gebId: 2, ...basis, quelle: 'F01' },
      { id: 'F03', gebId: 3, ...basis, quelle: 'F01' },
      { id: 'F04', gebId: 4, ...basis, quelle: 'F01', herkunft: 'vorgegeben' },
      { id: 'F05', gebId: 5, ...basis, quelle: 'F99' },
    ],
  };
  const d = RA.raLesenErhebung(stand);

  it('Verknüpfung und Katalog-Herkunft bleiben beim Einlesen erhalten', () => {
    expect(d.funktionen[1].quelle).toBe('F01');
    expect(d.funktionen[0].katalog).toBe('Unterkunft');
  });

  it('dieselbe Lücke an Vorlage und Kopien wird einmal gemeldet', () => {
    const p = RA.raPruefung(d);
    const herkunft = p.offene_punkte.filter(o => o.feld === 'herkunft');
    const gruppe = herkunft.find(o => o.ref === 'F01');
    expect(gruppe.ids).toEqual(['F01', 'F02', 'F03']);
    expect(gruppe.text).toMatch(/„Unterkunft" und die davon übertragenen Funktionen/);
    expect(gruppe.text).toMatch(/erneut übertragen/);
    // Kopie mit unbekannter Vorlage: Einzelpunkt
    expect(herkunft.find(o => o.ref === 'F05').text).toMatch(/^Unterkunft: /);
    expect(herkunft).toHaveLength(2);
  });
});
