import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  loadScript('config/netz-kosten.js');
  loadScript('config/erzeuger-cfg.js');
  loadScript('config/optimizer-defaults.js');
});

describe('KMR_KOSTEN', () => {
  it('enthält alle Standard-DN', () => {
    const expectedDNs = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800];
    for (const dn of expectedDNs) {
      expect(KMR_KOSTEN[dn], `DN${dn} fehlt`).toBeDefined();
    }
  });

  it('jeder DN hat 3 Kostenwerte [niedrig, mittel, hoch]', () => {
    for (const [dn, kosten] of Object.entries(KMR_KOSTEN)) {
      expect(kosten, `DN${dn}`).toHaveLength(3);
      expect(kosten[0], `DN${dn} niedrig < mittel`).toBeLessThan(kosten[1]);
      expect(kosten[1], `DN${dn} mittel < hoch`).toBeLessThan(kosten[2]);
    }
  });

  it('Kosten steigen mit DN', () => {
    expect(KMR_KOSTEN[50][1]).toBeLessThan(KMR_KOSTEN[200][1]);
    expect(KMR_KOSTEN[200][1]).toBeLessThan(KMR_KOSTEN[500][1]);
  });
});

describe('KABEL_TYPEN', () => {
  it('NYY und NAYY sind vorhanden', () => {
    expect(KABEL_TYPEN.NYY).toBeDefined();
    expect(KABEL_TYPEN.NAYY).toBeDefined();
  });

  it('NYY ist Kupfer, NAYY ist Aluminium', () => {
    expect(KABEL_TYPEN.NYY.material).toBe('Cu');
    expect(KABEL_TYPEN.NAYY.material).toBe('Al');
  });

  it('Querschnitte haben Iz (Strombelastbarkeit) und eurM (Preis)', () => {
    for (const [name, kabel] of Object.entries(KABEL_TYPEN)) {
      expect(kabel.sections.length, `${name} sections`).toBeGreaterThan(3);
      for (const s of kabel.sections) {
        expect(s.mm2, `${name} mm2`).toBeGreaterThan(0);
        expect(s.Iz, `${name} Iz`).toBeGreaterThan(0);
        expect(s.eurM, `${name} eurM`).toBeGreaterThan(0);
      }
    }
  });

  it('Kupfer hat höheren Strom bei gleichem Querschnitt als Aluminium', () => {
    // Vergleich bei 70mm²
    const nyyIz = KABEL_TYPEN.NYY.sections.find(s => s.mm2 === 70).Iz;
    const nayyIz = KABEL_TYPEN.NAYY.sections.find(s => s.mm2 === 70).Iz;
    expect(nyyIz).toBeGreaterThan(nayyIz);
  });
});

describe('ERZEUGER_CFG', () => {
  it('enthält alle 10 Erzeugertypen', () => {
    const expected = ['lwwp', 'fg', 'geo', 'fernwaerme', 'pellets', 'hhs', 'heizoel', 'gaskessel', 'bhkw', 'stromkessel'];
    for (const key of expected) {
      expect(ERZEUGER_CFG[key], `${key} fehlt`).toBeDefined();
    }
  });

  it('jeder Erzeuger hat label, color, typ', () => {
    for (const [key, cfg] of Object.entries(ERZEUGER_CFG)) {
      expect(cfg.label, `${key}.label`).toBeTruthy();
      expect(cfg.color, `${key}.color`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['wp', 'fix', 'kwk'], `${key}.typ`).toContain(cfg.typ);
    }
  });

  it('Wärmepumpen haben Gütegrad', () => {
    expect(ERZEUGER_CFG.lwwp.guetegrad).toBeGreaterThan(0);
    expect(ERZEUGER_CFG.fg.guetegrad).toBeGreaterThan(0);
    expect(ERZEUGER_CFG.geo.guetegrad).toBeGreaterThan(0);
  });
});

describe('NUTZUNG_DEFAULTS', () => {
  it('enthält gängige Gebäudetypen', () => {
    expect(NUTZUNG_DEFAULTS.efh).toBeDefined();
    expect(NUTZUNG_DEFAULTS.mfh).toBeDefined();
    expect(NUTZUNG_DEFAULTS.ghd).toBeDefined();
  });

  it('EFH hat höheren spez. Verbrauch als MFH', () => {
    expect(NUTZUNG_DEFAULTS.efh.spez).toBeGreaterThan(NUTZUNG_DEFAULTS.mfh.spez);
  });

  it('alle Typen haben spez, spezHL und label', () => {
    for (const [key, def] of Object.entries(NUTZUNG_DEFAULTS)) {
      expect(def.spez, `${key}.spez`).toBeGreaterThan(0);
      expect(def.spezHL, `${key}.spezHL`).toBeGreaterThan(0);
      expect(def.label, `${key}.label`).toBeTruthy();
    }
  });
});

describe('OPT_INVEST_DEFAULT / OPT_NUTZUNG / OPT_IH', () => {
  const erzeugerKeys = ['lwwp', 'fg', 'geo', 'gaskessel', 'bhkw', 'stromkessel', 'pellets', 'hhs', 'heizoel', 'fernwaerme', 'pv', 'bat'];

  it('alle Erzeuger haben Invest-Defaults', () => {
    for (const key of erzeugerKeys) {
      expect(OPT_INVEST_DEFAULT[key], `${key} Invest`).toBeGreaterThan(0);
    }
  });

  it('alle Erzeuger haben Nutzungsdauern', () => {
    for (const key of erzeugerKeys) {
      expect(OPT_NUTZUNG[key], `${key} Nutzung`).toBeGreaterThanOrEqual(10);
      expect(OPT_NUTZUNG[key], `${key} Nutzung`).toBeLessThanOrEqual(30);
    }
  });

  it('alle Erzeuger haben Instandhaltungssätze', () => {
    for (const key of erzeugerKeys) {
      expect(OPT_IH[key], `${key} IH`).toBeGreaterThan(0);
      expect(OPT_IH[key], `${key} IH`).toBeLessThanOrEqual(0.05);
    }
  });

  it('OPT_MERIT_ORDER enthält alle thermischen Erzeuger', () => {
    expect(OPT_MERIT_ORDER.length).toBeGreaterThanOrEqual(8);
    expect(OPT_MERIT_ORDER).toContain('lwwp');
    expect(OPT_MERIT_ORDER).toContain('gaskessel');
  });
});
