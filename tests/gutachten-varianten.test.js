// Vitest-Tests für lib/gutachten-varianten.js — Rahmen, Resilienz, Gegenüberstellung, Klima, Sensitivität.
import { describe, it, expect } from 'vitest';
import { vaEnergie, vaGegenueberstellung, vaTextResilienz, vaTextKlima, vaSensitivitaet, vaTextSensitivitaet, vaRahmenZeilen, vaTextRahmen } from '../src/lib/gutachten-varianten.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
const V1 = { name: 'V1 LW-WP mono', co2T: 1500, co2LzT: 300, jahreskostenEur: 2_000_000, erzeuger: [{ key: 'lwwp', leistungKw: 4000, waermeMwh: 9500, elMwh: 3200 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 500 }] };
const V2 = { name: 'V2 LW-WP biv', co2T: 2200, co2LzT: 1400, jahreskostenEur: 1_900_000, erzeuger: [{ key: 'lwwp', leistungKw: 2000, waermeMwh: 7000, elMwh: 2100 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 3000 }] };
const V3 = { name: 'V3 LW-WP + SK', co2T: 1900, co2LzT: 320, jahreskostenEur: 2_300_000, erzeuger: [{ key: 'lwwp', leistungKw: 4000, waermeMwh: 9500, elMwh: 3200 }, { key: 'stromkessel', leistungKw: 2000, waermeMwh: 500 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 0 }] };

describe('Energie', () => {
  it('Anteile und Energieträger', () => {
    const e = vaEnergie(V1);
    expect(e.wpPct).toBeCloseTo(95, 6);
    expect(e.fossilPct).toBeCloseTo(5, 6);
    expect(e.gas).toBeCloseTo(500 / 0.92, 6);
    expect(vaEnergie(V3).strombasiertPct).toBeCloseTo(100, 6);
  });
});

describe('Rahmen und Resilienz', () => {
  it('Tabelle und Text', () => {
    const z = vaRahmenZeilen({ preise: { strom: 25, gas: 10 }, ef: { gas: 240, strom: 363, stromLz: 72 } });
    expect(z.map(x => x.werte[0])).toEqual(['Erdgas', 'Strom (Wärmepumpe)']);
    expect(text(vaTextRahmen({ efStromGeg: 560, efStrom: 363, efStromLz: 72, co2PreisEurT: 200 }))).toContain('pauschalen Wert des GEG (560');
  });
  it('Zweistoffbrenner in allen Varianten mit voller Heizlast', () => {
    const t = text(vaTextResilienz({ varianten: [V1, V2, V3], pMaxKw: 5000 }));
    expect(t).toContain('in allen Varianten ein Zweistoffbrenner');
    expect(t).toContain('gesamte Heizlast');
    expect(t).toContain('[Vorgabe zum Zweistoffbrenner');
  });
});

describe('Gegenüberstellung', () => {
  it('Zeilen', () => {
    const g = vaGegenueberstellung([V1, V2, V3], 5000);
    const z = Object.fromEntries(g.zeilen.map(r => [r.werte[0], r.werte.slice(1)]));
    expect(z['Luft-Wasser-Wärmepumpe']).toEqual(['4,0 MW', '2,0 MW', '4,0 MW']);
    expect(z['Stromdirektkessel']).toEqual(['–', '–', '2,0 MW']);
    expect(z['Anteil strombasierte Wärmeerzeugung'][2]).toBe('100 %');
    expect(z['Volle Resilienz durch fossilen Kessel']).toEqual(['✔', '✔', '✔']);
  });
});

describe('Klima', () => {
  it('Reduktion, Bestwert, Referenzen, kumuliert', () => {
    const t = text(vaTextKlima({ varianten: [V1, V2, V3], jahrHeute: 2026, gesamtMwh: 10000, efGas: 240, bestandCo2T: 2600 }));
    expect(t).toContain('stärkste relative Reduktion erzielt V3 LW-WP + SK');
    expect(t).toContain('den ökologischen Bestwert erreicht V1 LW-WP mono');
    expect(t).toContain('Den höchsten künftigen Wert weist V2 LW-WP biv');
    expect(t).toContain('vollständig über Erdgas gedeckte Wärmeversorgung verursacht rund 2.609 t');
    expect(t).toContain('kumuliert: V1 LW-WP mono 6.000 t CO₂e');
  });
});

describe('Sensitivität', () => {
  it('Mehrkosten und Text', () => {
    const r = vaSensitivitaet([V1, V2, V3], { strom: 25, gas: 10 });
    const v2 = r.find(x => x.name.startsWith('V2'));
    expect(v2.sz[2].mehr).toBeCloseTo(2100 * 250 * 0.4 + (3000 / 0.92) * 100 * 1.0, 3);
    const t = text(vaTextSensitivitaet([V1, V2, V3], { strom: 25, gas: 10 }));
    expect(t).toContain('Energiekrise: Strom +40 %, Gas/Öl +100 %');
    expect(t).toMatch(/Rangfolge (verschiebt|bleibt)/);
  });
});
