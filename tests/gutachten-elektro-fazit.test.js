import { describe, it, expect } from 'vitest';
import { efKernaussagen, efPvBewertung, efMassnahmen, EF_PV_GEWICHTE } from '../src/lib/gutachten-elektro-fazit.js';

const basis = {
  anschluss: { endKw: 1626, capKva: 1200, zieljahr: 2030, erstesJahr: 2026 },
  einspeisung: { kw: 382, zusageKw: null },
  netz: { zubau: 12, ungeloest: 1, bestand: 57, erstesJahr: 2026, bis: 2051 },
  pv: { label: 'Wirtschaftlich optimiert', kwp: 3458, batKwh: 2000, autarkiePct: 61, ueberKwp: 1271, bnKwp: 2187, netzInvestEur: 271000 },
  notstrom: { berechnet: false, erforderlichKw: null, bestandKw: 0, geplantKw: 0 },
  lade: { parks: 3, zubauKw: 0, zuleitung: 3 },
  kosten: { investEur: 5273000, offen: 5 },
};

describe('efKernaussagen', () => {
  it('ordnet jedes Thema mit Ampel ein', () => {
    const k = Object.fromEntries(efKernaussagen(basis).map(z => [z.thema, z]));
    expect(k['Netzanschluss'].status).toBe('handeln');
    expect(k['Netzanschluss'].ergebnis).toContain('426 kW');
    expect(k['Einspeisung'].status).toBe('offen');
    expect(k['Internes Stromnetz'].status).toBe('handeln');
    expect(k['Photovoltaik'].status).toBe('pruefen');
    expect(k['Notstromversorgung'].status).toBe('offen');
    expect(k['Ladeinfrastruktur'].status).toBe('pruefen');
    expect(k['Investitionen'].ergebnis).toMatch(/^Mindestens 5,3 Mio\. €/);
  });

  it('ohne Anschlussleistung: Angaben fehlen; mit Reserve: in Ordnung bzw. prüfen', () => {
    const ohne = efKernaussagen({ anschluss: { endKw: 800, capKva: null, zieljahr: 2030 } })[0];
    expect(ohne.status).toBe('offen');
    expect(efKernaussagen({ anschluss: { endKw: 800, capKva: 1200 } })[0].status).toBe('ok');
    expect(efKernaussagen({ anschluss: { endKw: 1150, capKva: 1200 } })[0].status).toBe('pruefen');
  });

  it('kein Netzmodell und keine PV-Berechnung werden als offen gemeldet', () => {
    const k = efKernaussagen({ netz: null, pv: null });
    expect(k.map(z => z.status)).toEqual(['offen', 'offen']);
  });
});

describe('efPvBewertung', () => {
  const auslegungen = [
    { id: 'bestandsnetz', label: 'Bestandsnetz', kwp: 2187, batKwh: 0, investEur: 2642711, kapitalwert: 2711335, autarkiePct: 36 },
    { id: 'wirt-opt', label: 'Wirtschaftlich optimiert', kwp: 3458, batKwh: 2000, investEur: 5117600, kapitalwert: 3296878, autarkiePct: 61 },
    { id: 'minimal', label: 'Minimal', kwp: 99, batKwh: 0, investEur: 123300, kapitalwert: 359215, autarkiePct: 4 },
  ];
  it('vergibt Verhältnispunkte und eine gewichtete Gesamtnote mit Rang', () => {
    const m = efPvBewertung({ auslegungen, bnKwp: 2187 });
    expect(m.gewichte).toEqual(EF_PV_GEWICHTE);
    const z = Object.fromEntries(m.zeilen.map(x => [x.a.id, x]));
    expect(z['wirt-opt'].punkte.wirtschaft).toBeCloseTo(100);
    expect(z['bestandsnetz'].punkte.netz).toBe(100);
    expect(z['wirt-opt'].punkte.netz).toBeCloseTo(100 * 2187 / 3458);
    expect(z['minimal'].punkte.invest).toBeCloseTo(100);
    expect(m.zeilen.map(x => x.rang)).toEqual([1, 2, 3]);
    expect(m.zeilen[0].gesamt).toBeGreaterThanOrEqual(m.zeilen[1].gesamt);
  });
  it('ohne Bestandsnetz-Wert zählt das Netzkriterium nicht; unter zwei Auslegungen keine Matrix', () => {
    const m = efPvBewertung({ auslegungen });
    expect(m.zeilen.every(x => Number.isNaN(x.punkte.netz))).toBe(true);
    expect(efPvBewertung({ auslegungen: auslegungen.slice(0, 1) })).toBeNull();
  });
});

describe('efMassnahmen', () => {
  it('stellt Antrag, Netz, PV, Notstrom und Prüfaufträge nach Jahr sortiert zusammen', () => {
    const m = efMassnahmen({
      ...basis, heute: 2026, vorlaufJ: 2,
      positionen: [
        { gruppe: 'netzanschluss', label: 'Erhöhung', umfang: '+426 kW', investEur: 42600, jahr: 2026 },
        { gruppe: 'netz', label: 'Trafo 1: 630 → 1000 kVA', umfang: 'Trafo 630 → 1000 kVA', investEur: 60000, jahr: 2026 },
        { gruppe: 'netz', label: 'Kabel A', umfang: '16 → 185 mm²', investEur: 20000, jahr: 2027 },
        { gruppe: 'netz', label: 'Kabel B', umfang: '16 → 150 mm²', investEur: 15000, jahr: 2027 },
        { gruppe: 'pv', label: 'Wirtschaftlich optimiert', umfang: '3.458 kWp', investEur: 5117600, jahr: 2027 },
      ],
    });
    expect(m[0].bereich).toBe('Netzanschluss');
    expect(m[0].investEur).toBe(42600);
    expect(m.find(x => /2 Maßnahmen/.test(x.massnahme))).toMatchObject({ bis: 2027, investEur: 35000 });
    expect(m.some(x => /Bestandsdaten von 57/.test(x.massnahme))).toBe(true);
    expect(m.some(x => /Netzertüchtigung für 1.271 kWp/.test(x.massnahme))).toBe(true);
    expect(m.some(x => /Notstromkonzept/.test(x.massnahme))).toBe(true);
    const jahre = m.map(x => x.bis ?? 9999);
    expect([...jahre].sort((a, b) => a - b)).toEqual(jahre);
  });
});
