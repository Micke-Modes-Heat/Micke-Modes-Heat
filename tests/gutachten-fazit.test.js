// Vitest-Tests für lib/gutachten-fazit.js — Bewertung, Empfehlung, NT-Ertüchtigung, Fahrplan, Heizöltank.
import { describe, it, expect } from 'vitest';
import { faTextBewertung, faTextEmpfehlung, faJaz, faNtVergleich, faTextNt, faTextFahrplan, faHeizoeltank, faTextHeizoeltank } from '../src/lib/gutachten-fazit.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
const V1 = { name: 'V1', wgkCt: 14.2, co2T: 1500, co2LzT: 300, jahreskostenEur: 2e6, erzeuger: [{ key: 'lwwp', leistungKw: 4000, waermeMwh: 9500, elMwh: 3200 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 500 }] };
const V2 = { name: 'V2', wgkCt: 14.0, co2T: 2200, co2LzT: 1400, jahreskostenEur: 1.9e6, erzeuger: [{ key: 'lwwp', leistungKw: 2000, waermeMwh: 7000, elMwh: 2100 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 3000 }] };
const V3 = { name: 'V3', wgkCt: 16.5, co2T: 1900, co2LzT: 320, jahreskostenEur: 2.3e6, erzeuger: [{ key: 'lwwp', leistungKw: 4000, waermeMwh: 9500, elMwh: 3200 }, { key: 'stromkessel', leistungKw: 2000, waermeMwh: 500 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 0 }] };
const V4 = { name: 'V4 Geo', wgkCt: 15.4, co2T: 1700, co2LzT: 1200, jahreskostenEur: 2.1e6, erzeuger: [{ key: 'geo', leistungKw: 2000, waermeMwh: 7000, elMwh: 1500 }, { key: 'gaskessel', leistungKw: 5000, waermeMwh: 3000 }] };

describe('Bewertung und Empfehlung', () => {
  it('drei Achsen', () => {
    const t = text(faTextBewertung({ varianten: [V1, V2, V3, V4], preise: { strom: 25, gas: 10 }, gesamtMwh: 10000, efGas: 240, pMaxKw: 5000 }));
    expect(t).toContain('V1 künftig die niedrigsten Emissionen');
    expect(t).toContain('Wirtschaftlich ist V2 mit 14,00 ct/kWh die günstigste Variante');
    expect(t).toContain('In der Resilienz sind alle Varianten');
  });
  it('zwei führende Varianten, Stromkessel-Referenz, Geothermie', () => {
    const t = text(faTextEmpfehlung({ varianten: [V1, V2, V3, V4] }));
    expect(t).toContain('eine der beiden Varianten V2 oder V1');
    expect(t).toContain('V1 erreicht mit 5 % fossilem Anteil die höhere Emissionsfreiheit');
    expect(t).toContain('Klimaneutralität bis 2045');
    expect(t).toContain('vollständig strombasierte Variante V3');
    expect(t).toContain('Erdwärmevariante V4 Geo');
  });
});

describe('NT-Ertüchtigung', () => {
  it('JAZ und Vergleich', () => {
    expect(faJaz(35)).toBeGreaterThan(faJaz(70));
    const r = faNtVergleich({ waermeMwh: 9000, vlHtC: 75, vlNtC: 45, jazNt: 3.2, strompreisCt: 25, gebaeude: 30, eurProGebaeude: 25000, efStrom: 363, efStromLz: 72 });
    expect(r.jazNt).toBe(3.2);
    expect(r.jazHt).toBeLessThan(3.2);
    expect(r.invest).toBe(750000);
    expect(r.amortJahre).toBeGreaterThan(0);
    const t = text(faTextNt({ waermeMwh: 9000, vlHtC: 75, vlNtC: 45, jazNt: 3.2, strompreisCt: 25, gebaeude: 30, efStrom: 363, efStromLz: 72 }));
    expect(t).toContain('Die Jahresarbeitszahl steigt von');
    expect(t).toContain('amortisiert sich damit in etwa');
    expect(t).toContain('DVGW W 551');
    expect(t).toContain('sinkt die Effizienz einer Wärmepumpe mit jedem Kelvin');
  });
});

describe('Fahrplan und Heizöl', () => {
  it('Fahrplan mit Jahren', () => {
    const t = text(faTextFahrplan({ start: 2027, vorzug: ['V1', 'V2'], pv: { kwp: 1500, batKwh: 2000, eigenPct: 80 } }));
    expect(t).toContain('Kurzfristig (2027–2028)');
    expect(t).toContain('(V1 und V2)');
    expect(t).toContain('1.500 kWp');
  });
  it('Heizöltank', () => {
    const r = faHeizoeltank(2000, 800);
    expect(r.m3).toBeCloseTo(14.4, 6);
    expect(r.reichweiteH).toBeCloseTo(180, 6);
    expect(text(faTextHeizoeltank({ maxKw: 2000, mittelKw: 800 }))).toContain('rund 14,4 m³');
  });
});
