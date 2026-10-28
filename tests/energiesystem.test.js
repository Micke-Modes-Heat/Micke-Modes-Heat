import { describe, it, expect } from 'vitest';
import { esModell } from '../src/lib/energiesystem.js';

const pv = (kwp, geplant = false) => ({ typ: 'PV', props: { leistungKWp: String(kwp) }, geplant });

describe('esModell – Ist-Zustand', () => {
  const ba = {
    erzeuger: [
      { id: 'a', typ: 'bw_gaskessel', thermKw: '800' },
      { id: 'b', typ: 'bw_gaskessel', thermKw: '600' },
      { id: 'c', typ: 'bhkw_gas', thermKw: '120', elKw: '70' },
      { id: 'd', typ: 'pelletkessel', thermKw: '300' },
    ],
    pufferM3: '20',
  };
  const m = esModell({
    stand: 'ist',
    strom: [pv(250), pv(400, true), { typ: 'Batterie', props: { leistungKW: '100', kapazitaetKWh: '200' } }],
    waermeIst: ba,
    netz: { nb: 'Netze BW', spannung: 'Mittelspannung 20 kV', trafostationen: 6, anschlussKw: 1600 },
    verbrauch: { stromMwh: 2341.4, stromMaxKw: 512, waermeMwh: 5100, heizlastKw: 2100 },
  });

  it('bündelt gleiche Kessel und zeigt die Summe', () => {
    const k = m.waerme.find(e => e.key === 'gaskessel');
    expect(k.titel).toBe('2 Brennwertkessel');
    expect(k.zeile).toBe('1.400 kW th.');
  });

  it('BHKW sitzt in der Kopplung mit el. und th. Leistung', () => {
    expect(m.kopplung).toHaveLength(1);
    expect(m.kopplung[0]).toMatchObject({ key: 'bhkw', richtung: 'kwk', traeger: 'gas', zeile: '70 kW el. · 120 kW th.' });
  });

  it('Planung bleibt im Ist-Zustand weg', () => {
    const p = m.strom.find(e => e.id === 'PV');
    expect(p.zeile).toBe('250 kWp');
    expect(p.zeilePlan).toBe('');
  });

  it('Brennstoffe nur, wenn ein Erzeuger sie braucht; Brennstoff-Kessel zuerst, Speicher zuletzt', () => {
    expect(m.quellen.map(q => q.key)).toEqual(['strom', 'gas', 'biomasse']);
    expect(m.waerme.map(e => e.key)).toEqual(['gaskessel', 'pellets', 'speicher']);
    expect(m.waerme.at(-1).zeile).toBe('20 m³');
  });

  it('Schiene, Netzanschluss und Verbräuche', () => {
    expect(m.stromSchiene).toBe('MS 20 kV · 6 Trafostationen');
    expect(m.nap).toMatchObject({ anschluss: '1.600 kVA', zweirichtung: true });
    expect(m.verbraucher.strom).toBe('2.341 MWh/a');
    expect(m.verbraucher.heizlast).toBe('max. 2.100 kW');
    expect(m.fehlt).toEqual([]);
  });

  it('BHKW nur als Elektro-Asset erfasst → trotzdem gezeigt', () => {
    const m2 = esModell({ stand: 'ist', strom: [{ typ: 'KWK', props: { leistungElKW: '50', leistungThKW: '90' } }], waermeIst: { erzeuger: [] } });
    expect(m2.kopplung[0]).toMatchObject({ key: 'bhkw', zeile: '50 kW el. · 90 kW th.' });
  });
});

describe('esModell – Zielbild', () => {
  const m = esModell({
    stand: 'ziel',
    strom: [pv(250), pv(400, true), { typ: 'Batterie', props: { leistungKW: '300' }, geplant: true },
            { typ: 'Lade', props: { anzahlPunkte: '20', anzahlSchnell: '2' }, geplant: true }],
    waermeZiel: [
      { key: 'lwwp', waermeMwh: 3000 }, { key: 'gaskessel', waermeMwh: 500 },
      { key: 'gaskessel', waermeMwh: 500, spitze: true }, { key: 'speicher', waermeMwh: 200 },
      { key: 'fernwaerme', waermeMwh: 1000 }, { key: 'bhkw', waermeMwh: 0 },
    ],
    verbrauch: { waermeMwh: 5000 },
  });

  it('Bestand und Planung in einem Kasten, nur Geplantes gestrichelt', () => {
    const p = m.strom.find(e => e.id === 'PV');
    expect(p).toMatchObject({ zeile: '250 kWp', zeilePlan: '+ 400 kWp geplant', geplant: false });
    expect(m.strom.find(e => e.id === 'Batterie').geplant).toBe(true);
    expect(m.lade).toMatchObject({ zeile: '22 Ladepunkte', geplant: true });
  });

  it('Wärmeanteile aus der Einsatzplanung, Spitzenkessel zusammengefasst, ohne Speicher in der Summe', () => {
    expect(m.kopplung.map(e => [e.key, e.zeile])).toEqual([['lwwp', '60 % der Wärme']]);
    const k = m.waerme.find(e => e.key === 'gaskessel');
    expect(k).toMatchObject({ titel: 'Gaskessel', zusatz: 'Spitzenlast', zeile: '20 % der Wärme' });
    expect(m.fernwaerme).toBe(true);
    expect(m.quellen.find(q => q.key === 'fernwaerme').zeile).toBe('20 % der Wärme');
  });

  it('fehlende Angaben werden gemeldet', () => {
    expect(m.fehlt).toEqual(['Stromverbrauch (Lastgang)']);
    expect(esModell({ stand: 'ziel' }).fehlt).toContain('Wärmeerzeuger der Variante (Einsatzplanung)');
  });
});
