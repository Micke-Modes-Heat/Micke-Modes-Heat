// Auswertung › Übersicht: Kacheln je Sparte (lib/kennzahlen-uebersicht.js, Oberfläche 51-kennzahlen.js)
import { describe, expect, it } from 'vitest';
import { kzWaerme, kzStrom, kzGesamt, kzStromStand, kzEuro, KZ_SPRUNG } from '../src/lib/kennzahlen-uebersicht.js';

const byId = liste => Object.fromEntries(liste.map(k => [k.id, k]));

const WAERME = { mwh: 1911.4, pMaxKw: 822, wgk: 27.24, co2T: 326.2, eePct: 91.3, hatErzeuger: true };
const BILANZ = { netzbezugMwh: 938.4, netzbezugSpitzeKw: 412.6, gesamtMwh: 1239, pvErtragMwh: 533.1, pvEigenMwh: 300.6, pvKwp: 507.8 };
const EL_OFFEN = { stand: 'offen', hatNetz: true, hatTrafo: true, jahr: null, trafo: null, kabel: null, nKabel: 0 };

describe('Kennzahlen Wärme', () => {
  it('zeigt gerechnete Werte mit den bisherigen IDs', () => {
    const k = byId(kzWaerme({ waermeStand: 'gerechnet', waerme: WAERME }));
    expect(Object.keys(k)).toEqual(['waerme', 'pmax', 'wgk', 'co2', 'ee']);
    expect(k.waerme).toMatchObject({ zustand: 'ok', wert: '1.911', einheit: 'MWh/a' });
    expect(k.wgk.wert).toBe('27,2');
    expect(k.ee.balken).toEqual({ pct: 91.3, ziel: 65 });
  });

  it('markiert veraltete Ergebnisse, behält aber die Werte', () => {
    const k = kzWaerme({ waermeStand: 'veraltet', waerme: WAERME });
    expect(k.every(x => x.zustand === 'veraltet' && x.wert)).toBe(true);
  });

  it('ohne Rechnung: „nicht gerechnet“ mit Sprung statt Strich', () => {
    const k = byId(kzWaerme({ waermeStand: 'offen', waerme: { mwh: null, pMaxKw: null, wgk: null, co2T: null, eePct: null, hatErzeuger: true } }));
    for (const x of Object.values(k)) {
      expect(x.zustand).toBe('fehlt');
      expect(x.text).toBe('nicht gerechnet');
      expect(x.sprung?.click).toBeTruthy();
    }
  });

  it('ohne Erzeuger: Kosten/CO₂/EE als „keine Erzeuger geplant“', () => {
    const k = byId(kzWaerme({ waermeStand: 'gerechnet', waerme: { ...WAERME, wgk: null, co2T: null, eePct: null, hatErzeuger: false } }));
    expect(k.waerme.zustand).toBe('ok');
    expect(k.wgk).toMatchObject({ zustand: 'leer', text: 'keine Erzeuger geplant', sprung: KZ_SPRUNG.waermeErzeuger });
  });
});

describe('Kennzahlen Strom', () => {
  it('liest Bezug, Spitze, PV und Eigenverbrauch aus der Strombilanz', () => {
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: 630, el: EL_OFFEN }));
    expect(k.strombezug).toMatchObject({ zustand: 'ok', wert: '938', sub: 'Bedarf 1.239 MWh/a' });
    expect(k.nap).toMatchObject({ wert: '413', sub: '65 % von 630 kVA vereinbart' });
    expect(k.nap.sprung).toBeUndefined();
    expect(k.pv).toMatchObject({ wert: '533', sub: '508 kWp' });
    expect(k['pv-ev'].wert).toBe('56');
  });

  it('fehlende vereinbarte Leistung: Wert bleibt, Sprung zum Eintragen', () => {
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: null, el: EL_OFFEN }));
    expect(k.nap).toMatchObject({ zustand: 'ok', sub: 'vereinbarte Leistung fehlt', sprung: KZ_SPRUNG.napGrenze });
  });

  it('Überschreitung der vereinbarten Leistung färbt den Balken', () => {
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: 250, el: EL_OFFEN }));
    expect(k.nap.balken).toEqual({ pct: 100, warn: true });
  });

  it('ohne PV: „keine PV geplant“ mit Sprung in den PV-Reiter', () => {
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: { ...BILANZ, pvErtragMwh: 0, pvEigenMwh: 0 }, capKva: null, el: EL_OFFEN }));
    expect(k.pv).toMatchObject({ zustand: 'leer', sprung: KZ_SPRUNG.stromPv });
  });

  it('Netz nicht gerechnet: Trafo/Kabel mit „Jetzt berechnen“', () => {
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: null, el: EL_OFFEN }));
    expect(k.trafo).toMatchObject({ zustand: 'fehlt', text: 'nicht gerechnet', sprung: KZ_SPRUNG.elRechnen });
    expect(k.kabel.zustand).toBe('fehlt');
  });

  it('Netz gerechnet: höchste Auslastung mit Name und Rechenjahr, veraltet bleibt sichtbar', () => {
    const el = { stand: 'veraltet', hatNetz: true, hatTrafo: true, jahr: 2026,
      trafo: { name: 'Trafo 1 Heizzentrale', pct: 71.4 }, kabel: { name: 'NSHV 1 → Gebäude 3', pct: 104.2 }, nKabel: 12 };
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: null, el }));
    expect(k.trafo).toMatchObject({ zustand: 'veraltet', wert: '71', sub: 'Trafo 1 Heizzentrale · Rechenjahr 2026' });
    expect(k.kabel.balken).toEqual({ pct: 100, ziel: 100, warn: true });
  });

  it('0 % = keine Last in der Rechnung: kein Zahlenwert, Sprung zur Stromplanung', () => {
    const el = { stand: 'gerechnet', hatNetz: true, hatTrafo: true, jahr: 2026,
      trafo: { name: 'Trafo 1', pct: 0 }, kabel: { name: 'NAP → MS', pct: 0 }, nKabel: 11 };
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: null, el }));
    expect(k.trafo).toMatchObject({ zustand: 'leer', text: 'keine Last angeschlossen', sub: 'Rechenjahr 2026', sprung: KZ_SPRUNG.stromPlanung });
    expect(k.kabel.wert).toBeUndefined();
  });

  it('ohne Stromnetz: „kein Stromnetz geplant“', () => {
    const k = byId(kzStrom({ waermeStand: 'gerechnet', bilanz: BILANZ, capKva: null, el: { ...EL_OFFEN, hatNetz: false } }));
    expect(k.trafo).toMatchObject({ zustand: 'leer', text: 'kein Stromnetz geplant' });
  });

  it('ohne Strombilanz: alles „nicht gerechnet“', () => {
    const k = kzStrom({ waermeStand: 'offen', bilanz: null, capKva: null, el: EL_OFFEN });
    expect(k.every(x => x.zustand === 'fehlt')).toBe(true);
  });

  it('Gruppenstand', () => {
    expect(kzStromStand('gerechnet', 'offen', true, true)).toBe('teilweise');
    expect(kzStromStand('gerechnet', 'offen', true, false)).toBe('gerechnet');
    expect(kzStromStand('gerechnet', 'gerechnet', true, true)).toBe('gerechnet');
    expect(kzStromStand('veraltet', 'gerechnet', true, true)).toBe('veraltet');
    expect(kzStromStand('gerechnet', 'veraltet', true, true)).toBe('veraltet');
    expect(kzStromStand('offen', 'offen', false, true)).toBe('offen');
  });
});

describe('Kennzahlen übergreifend', () => {
  const G = { peWaermeMwh: 1133.5, co2WaermeT: 326.2, uebrigerNetzMwh: 299.5, fpStrom: 1.8, efStromGkWh: 363,
    investEur: 1398460, jkEur: 520595, hatErzeuger: true };

  it('Primärenergie und CO₂ = Wärme + Netzstrom der übrigen Verbraucher × Faktor', () => {
    const k = byId(kzGesamt({ waermeStand: 'gerechnet', g: G }));
    expect(k.pe.wert).toBe('1.673');                          // 1133,5 + 299,5 × 1,8
    expect(k.pe.sub).toBe('Wärme 1.134 · übriger Strom 539 MWh');
    expect(k['co2-ges'].wert).toBe('435');                    // 326,2 + 299,5 × 363 / 1000
  });

  it('ohne Strombilanz nur der Wärmeteil', () => {
    const k = byId(kzGesamt({ waermeStand: 'gerechnet', g: { ...G, uebrigerNetzMwh: null } }));
    expect(k.pe.wert).toBe('1.134');
    expect(k.pe.sub).toContain('übriger Strom —');
  });

  it('Investition und Jahreskosten aus der Wirtschaftlichkeit (VDI 2067)', () => {
    const k = byId(kzGesamt({ waermeStand: 'gerechnet', g: G }));
    expect(k.invest).toMatchObject({ wert: '1,40', einheit: 'Mio. €' });
    expect(k.jk).toMatchObject({ wert: '521', einheit: 'T€/a' });
  });

  it('ohne Wirtschaftlichkeit: Sprung dorthin', () => {
    const k = byId(kzGesamt({ waermeStand: 'gerechnet', g: { ...G, investEur: null, jkEur: null } }));
    expect(k.invest).toMatchObject({ zustand: 'fehlt', sprung: KZ_SPRUNG.wirtschaft });
  });

  it('Euro-Format', () => {
    expect(kzEuro(950)).toEqual({ wert: '950', einheit: '€' });
    expect(kzEuro(45000)).toEqual({ wert: '45', einheit: 'T€' });
  });
});
