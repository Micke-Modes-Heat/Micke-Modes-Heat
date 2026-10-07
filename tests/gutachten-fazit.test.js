// Vitest-Tests für lib/gutachten-fazit.js — Bewertung, Empfehlung, NT-Ertüchtigung, Fahrplan, Heizöltank.
import { describe, it, expect } from 'vitest';
import { faTextBewertung, faTextEmpfehlung, faJaz, faNtVergleich, faTextNt, faTextFahrplan, faHeizoeltank, faTextHeizoeltank, faNtKosten, FA_NT_KOSTEN, faBewertungsmatrix, faVorzugsvariante, faFahrplanProfil } from '../src/lib/gutachten-fazit.js';
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
  it('Gesamtbewertung nach vier Kriterien, Stromkessel-Referenz, Geothermie', () => {
    const o = { varianten: [V1, V2, V3, V4], preise: { strom: 25, gas: 10 }, pMaxKw: 5000 };
    const m = faBewertungsmatrix(o);
    expect(m.zeilen).toHaveLength(4);
    const v1 = m.zeilen.find(z => z.name === 'V1'), v2 = m.zeilen.find(z => z.name === 'V2');
    expect(v2.punkte.kosten).toBe(100);           // günstigste Variante
    expect(v1.punkte.klima).toBe(100);            // geringste künftige Emissionen
    expect(v1.punkte.preis).toBeGreaterThan(v2.punkte.preis);   // weniger fossil, preisstabiler
    expect(v2.punkte.kosten - v1.punkte.kosten).toBeLessThan(3);   // Verhältnispunkte: 14,0 vs. 14,2 ct/kWh liegen nah beieinander
    expect(m.zeilen[0].name).not.toBe('V2');      // Klima, Preisstabilität und Resilienz überwiegen den kleinen Kostenvorteil von V2
    const t = text(faTextEmpfehlung(o));
    expect(t).toContain('nicht allein auf die Kosten');
    expect(t).toContain('Wirtschaftlichkeit (35 %), Klimawirkung (30 %), Resilienz (20 %) und Preisstabilität (15 %)');
    expect(t).toContain('Klimaneutralität bis 2045');
    expect(t).toContain('V2 liegt in der Gesamtbewertung');
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

describe('NT-Kostenschätzung', () => {
  it('Posten je Gebäude aus Fläche, Zustand und TWW', () => {
    const k = faNtKosten([{ name: 'A', bgfM2: 2000, zustand: 3, twwArt: 'speicher', twwKw: 100 }, { name: 'B', bgfM2: 1000, zustand: 1, twwArt: 'dle' }]);
    const a = k.zeilen[0];
    expect(a.ngf).toBe(1700);
    expect(a.hk).toBe(85);
    expect(a.tauschHk).toBe(34);
    expect(a.posten.tww).toBe(8000 + 100 * 50);
    expect(a.posten.abgleich).toBe(85 * FA_NT_KOSTEN.abgleichEurHk);
    expect(k.zeilen[1].posten.tww).toBe(0);
    expect(k.summe).toBeCloseTo(k.zeilen[0].summe + k.zeilen[1].summe, 6);
  });
  it('Text nennt die Posten', () => {
    const kosten = faNtKosten([{ name: 'A', bgfM2: 2000, zustand: 2, twwArt: 'fws', twwKw: 50 }]);
    const t = text(faTextNt({ waermeMwh: 9000, vlHtC: 75, vlNtC: 45, jazNt: 3.2, strompreisCt: 25, kosten }));
    expect(t).toContain('gebäudescharf überschlägig geschätzt');
    expect(t).toContain('hydraulischer Abgleich');
  });
});

describe('Fahrplan für die Vorzugsvariante', () => {
  it('Vorzugsvariante: Fragebogen vor Bewertungsmatrix', () => {
    expect(faVorzugsvariante({ varianten: [V1, V2, V3] }, 'V3').name).toBe('V3');
    const m = faBewertungsmatrix({ varianten: [V1, V2, V3] });
    expect(faVorzugsvariante({ varianten: [V1, V2, V3] }, 'auto').name).toBe(m.zeilen[0].name);
  });
  it('Wärmepumpenvariante mit Kessel: NT-Ertüchtigung, Schallschutz, Kesselersatz, Ausbaustufen', () => {
    const t = text(faTextFahrplan({ start: 2027, variante: { ...V1, investEur: 3e6 }, ausbau: [{ name: 'Stufe 1', von: 2028, bis: 2029, anzahl: 3, kostenEur: 450000 }] }));
    expect(t).toContain('Vorzugsvariante V1 (Luft-Wasser-Wärmepumpe 4,0 MW und Gaskessel 5,0 MW) mit einer Gesamtinvestition von rund 3,00 Mio. €');
    expect(t).toContain('Niedertemperatur-Ertüchtigung (2029–2031)');
    expect(t).toContain('Schallschutz');
    expect(t).toContain('Stufe 1 (2028–2029, 3 Maßnahmen, rund 450 Tsd. €)');
    expect(t).toContain('Langfristig (ab 2037)');
  });
  it('Variante ohne Wärmepumpe und ohne fossilen Kessel', () => {
    const v = { name: 'Pellets', erzeuger: [{ key: 'pellets', leistungKw: 3000, waermeMwh: 9000 }] };
    const t = text(faTextFahrplan({ start: 2027, variante: v }));
    expect(t).not.toContain('Niedertemperatur-Ertüchtigung (');
    expect(t).not.toContain('Langfristig');
    expect(t).toContain('Brennstofflager');
    expect(faFahrplanProfil(v)).toMatchObject({ wp: false, fossil: false, biomasse: true });
  });
});
