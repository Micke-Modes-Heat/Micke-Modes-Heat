// Vitest-Tests für lib/station-steckbrief.js — Liegenschaftssteckbrief Trafostation.
// Importfrei/DOM-frei → direkt als ESM importierbar.
import { describe, it, expect } from 'vitest';
import {
  istStation, stationAufbau, findeStationen, stationKurzinfo, vorbelegung,
  feldWert, feldAktiv, nutzungsdauerStatus, abschnittFortschritt, stationFortschritt,
  assetAenderungen, assetAenderungenAnwenden, gebaeudeBaujahrAenderung,
  abschnittFuer, STECKBRIEF_ABSCHNITTE, leererEintrag, leererStationsSteckbrief,
} from '../src/lib/station-steckbrief.js';

const GEB = { id: 7, name: 'Trafostation 1', baujahr: 1994, gebaeudenummer: 'G12', fromKompakt: true, stationPreset: 'begehbarDoppel' };
const ASSETS = [
  { id: 'nshv', type: 'NSHV', buildingId: 7, name: 'NSHV 1', baujahr: 1994, props: { nennstromA: '1818', abgaenge: '10' } },
  { id: 't2', type: 'Trafo', buildingId: 7, name: 'Trafo 1b', baujahr: 2005, props: { leistungKVA: '630', ukProzent: '4' } },
  { id: 't1', type: 'Trafo', buildingId: 7, name: 'Trafo 1a', baujahr: 1994, props: { leistungKVA: '630', ukProzent: '4' } },
  { id: 'sa', type: 'Schaltanlage', buildingId: 7, name: 'Schaltanlage 1', props: { felder: '2' } },
  { id: 'uv', type: 'UV', buildingId: 7, name: 'UV 1', props: {} },
  { id: 'fremd', type: 'Trafo', buildingId: 8, name: 'Trafo X', props: {} },
  { id: 'pv', type: 'PV', buildingId: 9, name: 'PV 1', props: {} },
];

describe('Stationserkennung', () => {
  it('erkennt Gebäude mit Kern-Assets als Station, andere nicht', () => {
    expect(istStation(7, ASSETS)).toBe(true);
    expect(istStation('7', ASSETS)).toBe(true);          // IDs aus JSON können Strings sein
    expect(istStation(9, ASSETS)).toBe(false);           // nur PV → keine Station
    expect(istStation(99, ASSETS)).toBe(false);
  });

  it('ordnet den Aufbau versorgungsseitig und die Trafos natürlich sortiert', () => {
    const a = stationAufbau(7, ASSETS);
    expect(a.schaltanlagen.map(x => x.id)).toEqual(['sa']);
    expect(a.trafos.map(x => x.id)).toEqual(['t1', 't2']);
    expect(a.nshv.map(x => x.id)).toEqual(['nshv']);
    expect(a.weitere.map(x => x.id)).toEqual(['uv']);
    expect(a.alle.map(x => x.id)).toEqual(['sa', 't1', 't2', 'nshv', 'uv']);
  });

  it('findet alle Stationen eines Projekts', () => {
    const st = findeStationen([GEB, { id: 8, name: 'Kompaktstation 2' }, { id: 9, name: 'Halle' }], ASSETS);
    expect(st.map(s => s.gebaeude.id)).toEqual([7, 8]);
  });

  it('fasst Trafoanzahl und Leistung zusammen', () => {
    expect(stationKurzinfo(stationAufbau(7, ASSETS))).toBe('2 Trafos · 2× 630 kVA');
    const gemischt = [{ id: 'a', type: 'Trafo', buildingId: 1, props: { leistungKVA: '400' } }, { id: 'b', type: 'Trafo', buildingId: 1, props: { leistungKVA: '630' } }];
    expect(stationKurzinfo(stationAufbau(1, gemischt))).toBe('2 Trafos · 400 / 630 kVA');
    expect(stationKurzinfo(stationAufbau(2, [{ id: 'n', type: 'NAP', buildingId: 2 }]))).toBe('Übergabestation ohne Trafo');
  });
});

describe('Vorbelegung aus der Planung', () => {
  it('übernimmt Gebäude- und Assetdaten, die das Tool schon kennt', () => {
    const vb = vorbelegung(GEB, stationAufbau(7, ASSETS));
    expect(vb.station).toMatchObject({ bezeichnung: 'Trafostation 1', gebaeudeNr: 'G12', baujahr: '1994', bauform: 'begehbar' });
    expect(vb.assets.t1).toEqual({ baujahr: '1994', leistungKVA: '630', ukProzent: '4' });
    expect(vb.assets.sa).toEqual({ felder: '2' });                 // kein Baujahr → nicht vorbelegt
    expect(vb.assets.nshv).toEqual({ baujahr: '1994', nennstromA: '1818', abgaenge: '10' });
  });

  it('leitet Kompaktstation und Übergabestation (NAP, Spannung) ab', () => {
    const vb = vorbelegung({ id: 3, name: 'Kompaktstation 3' },
      stationAufbau(3, [{ id: 'n', type: 'NAP', buildingId: 3, props: { spannungKV: '20' } }]));
    expect(vb.station).toMatchObject({ bauform: 'Kompaktstation', funktion: 'Übergabestation', msEbene: '20 kV' });
  });

  it('erfasster Wert schlägt Vorbelegung, leerer Wert nicht', () => {
    expect(feldWert({ werte: { leistungKVA: '800' } }, { leistungKVA: '630' }, 'leistungKVA')).toBe('800');
    expect(feldWert({ werte: { leistungKVA: '' } }, { leistungKVA: '630' }, 'leistungKVA')).toBe('630');
    expect(feldWert(null, null, 'x')).toBe('');
  });

  it('blendet bedingte Felder nur bei passendem Wert ein', () => {
    const oel = abschnittFuer('Trafo').felder.find(f => f.key === 'oelmengeKg');
    expect(feldAktiv(oel, { werte: { ausfuehrung: 'Öl' } }, {})).toBe(true);
    expect(feldAktiv(oel, { werte: { ausfuehrung: 'Trocken / Gießharz' } }, {})).toBe(false);
  });
});

describe('Nutzungsdauer (VDI 2067)', () => {
  it('bewertet innerhalb / erreicht / überschritten', () => {
    expect(nutzungsdauerStatus('Trafo', 2010, 2026)).toMatchObject({ status: 'innerhalb', rest: 14, alter: 16 });
    expect(nutzungsdauerStatus('Trafo', 1996, 2026)).toMatchObject({ status: 'erreicht', rest: 0 });
    expect(nutzungsdauerStatus('Trafo', 1980, 2026)).toMatchObject({ status: 'ueberschritten', rest: -16 });
    expect(nutzungsdauerStatus('Trafo', 1980, 2026).label).toBe('überschritten (seit 16 J.)');
  });

  it('liefert null ohne Baujahr, bei Zukunftsjahr oder ohne Nutzungsdauer', () => {
    expect(nutzungsdauerStatus('Trafo', '', 2026)).toBeNull();
    expect(nutzungsdauerStatus('Trafo', 2030, 2026)).toBeNull();
    expect(nutzungsdauerStatus('UV', 2000, 2026)).toBeNull();
  });
});

describe('Erfassungsfortschritt', () => {
  it('zählt Pflichtfelder und Pflichtfotos, Vorbelegung zählt als erfasst', () => {
    const f = abschnittFortschritt('Trafo', leererEintrag(), { baujahr: '1994', leistungKVA: '630' }, {});
    // Pflicht: Baujahr, Leistung, Ausführung + 2 Pflichtfotos = 5
    expect(f.gesamt).toBe(5);
    expect(f.erledigt).toBe(2);
    expect(f.fehlend).toEqual(['Ausführung', 'Foto: Trafo gesamt', 'Foto: Typenschild']);
    const fertig = abschnittFortschritt('Trafo', { werte: { ausfuehrung: 'Öl' } }, { baujahr: '1994', leistungKVA: '630' }, { gesamt: 1, typenschild: 2 });
    expect(fertig.erledigt).toBe(fertig.gesamt);
  });

  it('bedingte Pflichtfelder zählen nur, wenn aktiv', () => {
    const pflichtAktiv = STECKBRIEF_ABSCHNITTE.station.felder.filter(f => f.pflicht && !f.wenn).length;
    const pflichtFotos = STECKBRIEF_ABSCHNITTE.station.fotos.filter(s => s.pflicht).length;
    expect(abschnittFortschritt('station', leererStationsSteckbrief(), {}, {}).gesamt).toBe(pflichtAktiv + pflichtFotos);
  });

  it('summiert die ganze Station', () => {
    const aufbau = stationAufbau(7, ASSETS);
    const f = stationFortschritt(GEB, aufbau, leererStationsSteckbrief(), {}, {});
    expect(f.gesamt).toBeGreaterThan(20);
    expect(f.erledigt).toBeGreaterThan(0);                  // Vorbelegung zählt
    expect(f.prozent).toBe(Math.round(f.erledigt / f.gesamt * 100));
  });
});

describe('Rückübernahme ins Planungstool', () => {
  it('meldet nur echte, plausible Abweichungen', () => {
    const t = { id: 't1', type: 'Trafo', baujahr: 1994, props: { leistungKVA: '630', ukProzent: '4' } };
    const c = assetAenderungen(t, { werte: { leistungKVA: '800', ukProzent: '4,0', baujahr: '1996', hersteller: 'X', seriennummer: '' } });
    expect(c).toEqual([
      { prop: 'baujahr', feld: 'Baujahr', alt: 1994, neu: '1996' },
      { prop: 'leistungKVA', feld: 'Bemessungsleistung', alt: '630', neu: '800' },
    ]);
    expect(assetAenderungen(t, { werte: { leistungKVA: 'abc', baujahr: '12' } })).toEqual([]);
  });

  it('wendet Änderungen an, ohne andere Props zu verlieren', () => {
    const t = { id: 't1', type: 'Trafo', baujahr: 1994, props: { leistungKVA: '630', ukProzent: '4', netzart: 'erzeugung' } };
    assetAenderungenAnwenden(t, assetAenderungen(t, { werte: { leistungKVA: '800', baujahr: '1996' } }));
    expect(t).toMatchObject({ baujahr: 1996, props: { leistungKVA: '800', ukProzent: '4', netzart: 'erzeugung' } });
  });

  it('erkennt ein geändertes Gebäudebaujahr', () => {
    expect(gebaeudeBaujahrAenderung(GEB, { werte: { baujahr: '1994' } })).toBeNull();
    expect(gebaeudeBaujahrAenderung(GEB, { werte: { baujahr: '1992' } })).toEqual({ alt: 1994, neu: 1992 });
  });
});
