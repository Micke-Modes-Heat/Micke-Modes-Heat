// Plausibilitäts-/Invarianten-Tests für die PV-Ausbauanalyse (09d-pv-analyse.js).
// Sichert die wirtschaftliche Kernkette (pvNapSim → pvWirtschaft) gegen Edge-Case-
// Fehler ab, wie sie z.B. im 3D-Optimierungs-Diagramm auftraten (PV=0-Kante zeigte
// fälschlich 0 €/a statt der echten Batterie-Kapitalkosten). Diese Invarianten müssen
// für ein belastbares Gutachten dauerhaft gelten.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

// Synthetischer Lastgang: konstante Grundlast + Tagesbeule, damit Eigenverbrauch,
// Einspeisung und (bei Batterie) Lastverschiebung alle in nennenswertem Umfang
// auftreten.
function makeDemand() {
  const N = 8760;
  const d = new Float32Array(N);
  for (let t = 0; t < N; t++) {
    const hour = t % 24;
    const tag  = hour >= 8 && hour <= 20;     // Bürozeiten
    d[t] = 80 + (tag ? 60 : 0);                // 80 kW Grund, 140 kW tags
  }
  return d;
}

const SPEZ = 1000; // pvGetSpez() fällt ohne DOM auf 1000 kWh/kWp/a zurück

const PARAMS = {
  pStrom: 30, pEinsp: 8,
  pvInvestPerKwp: 1200, batInvestPerKwh: 400,
  zins: 0.035, pvLife: 20, batLife: 15,
};

let demandH, pvProfile;

beforeAll(() => {
  loadScript('config/optimizer-defaults.js');
  loadScript('06a-gbi-lastgang.js');
  loadScript('09a-pv-profile.js');
  loadScript('09d-pv-analyse.js');
  demandH   = makeDemand();
  pvProfile = pvGetPvProfile();           // reale 8760er PV-Form
  // pvWirtschaft liest für die Autarkie den globalen Lastgang:
  globalThis.elQuartierH = demandH;
});

// ── annF: Annuitätenfaktor ────────────────────────────────────────────────
describe('annF — Annuitätenfaktor', () => {
  it('positiver Zins: 0 < ann < 1 für lange Laufzeit', () => {
    const a = annF(0.035, 20);
    expect(a).toBeGreaterThan(0.035);   // mind. Zinsanteil
    expect(a).toBeLessThan(1);
  });
  it('Zins 0 → lineare Abschreibung 1/n', () => {
    expect(annF(0, 20)).toBeCloseTo(1 / 20, 6);
  });
});

// ── pvNapSim: physikalische Konsistenz ────────────────────────────────────
describe('pvNapSim — physikalische Bilanzen', () => {
  it('Deckungsgrad je Zeitschritt liegt in [0,1]', () => {
    const sim = pvNapSim(500, 1000, demandH, pvProfile, { maxEinspeisKw: null, maxBezugKw: null }, 'ev', null);
    for (let i = 0; i < sim.deckungArr.length; i++) {
      expect(sim.deckungArr[i]).toBeGreaterThanOrEqual(0);
      expect(sim.deckungArr[i]).toBeLessThanOrEqual(1);
    }
  });

  it('Nachfragebilanz: Eigenverbrauch + Netzbezug = Gesamtbedarf (ohne Bezugslimit)', () => {
    const sim = pvNapSim(600, 800, demandH, pvProfile, { maxEinspeisKw: null, maxBezugKw: null }, 'ev', null);
    let demMwh = 0; for (let i = 0; i < demandH.length; i++) demMwh += demandH[i];
    demMwh /= 1000;
    expect(sim.eigenMwh + sim.netzbezugMwh).toBeCloseTo(demMwh, 3);
  });

  it('Erzeugungsbilanz: PV-Ertrag = Eigen(PV) + Einspeisung + Abregelung + Verluste + Rest-SOC', () => {
    const bat = 1500;
    const sim = pvNapSim(700, bat, demandH, pvProfile, { maxEinspeisKw: null, maxBezugKw: null }, 'ev', null);
    // PV-Gesamterzeugung in MWh
    let genMwh = 0; for (let t = 0; t < pvProfile.length; t++) genMwh += pvProfile[t] * 700 * SPEZ;
    genMwh /= 1000;
    // Eigenverbrauch enthält direkt + Batterie-Entladung (beide aus PV gespeist).
    // Rest-SOC am Jahresende = im Speicher verbliebene Energie.
    const socEnd = sim.batSocArr[sim.batSocArr.length - 1] / 1000;
    const summe = sim.eigenMwh + sim.einspeiseMwh + sim.curtailMwh + sim.batVerlustMwh + socEnd;
    expect(summe).toBeCloseTo(genMwh, 2);
  });

  it('mehr PV senkt den Netzbezug monoton (bei Batterie = 0)', () => {
    const np = { maxEinspeisKw: null, maxBezugKw: null };
    let prev = Infinity;
    for (const kwp of [0, 100, 300, 600, 1000]) {
      const sim = pvNapSim(kwp, 0, demandH, pvProfile, np, 'none', null);
      expect(sim.netzbezugMwh).toBeLessThanOrEqual(prev + 1e-6);
      prev = sim.netzbezugMwh;
    }
  });

  it('Batterie (EV) senkt den Netzbezug gegenüber „ohne Batterie“', () => {
    const np = { maxEinspeisKw: null, maxBezugKw: null };
    const ohne = pvNapSim(500, 0,    demandH, pvProfile, np, 'none', null);
    const mit  = pvNapSim(500, 1000, demandH, pvProfile, np, 'ev',   null);
    expect(mit.netzbezugMwh).toBeLessThanOrEqual(ohne.netzbezugMwh + 1e-6);
  });

  it('Einspeisebegrenzung wird eingehalten (Rückspeise-Spitze ≤ Limit)', () => {
    const limit = 50;
    const sim = pvNapSim(800, 0, demandH, pvProfile, { maxEinspeisKw: limit, maxBezugKw: null }, 'none', null);
    expect(sim.maxEinspeiseKw).toBeLessThanOrEqual(limit + 1e-6);
    expect(sim.curtailMwh).toBeGreaterThan(0); // bei 800 kWp und 50 kW Limit muss abgeregelt werden
  });
});

// ── pvWirtschaft: wirtschaftliche Plausibilität ───────────────────────────
describe('pvWirtschaft — wirtschaftliche Invarianten', () => {
  const np = { maxEinspeisKw: null, maxBezugKw: null };
  const wirtAt = (kwp, bat, strat = bat > 0 ? 'ev' : 'none') => {
    const sim = pvNapSim(kwp, bat, demandH, pvProfile, np, strat, null);
    return pvWirtschaft(kwp, bat, sim, kwp * SPEZ / 1000, PARAMS, strat);
  };

  it('PV=0, Batterie=0: keine Erlöse, nettoJk = reine (kleinste) Infrastruktur-Annuität', () => {
    const w = wirtAt(0, 0);
    expect(w.gesamtErloes).toBeCloseTo(0, 6);
    expect(w.pvJk).toBeCloseTo(0, 6);
    expect(w.batJk).toBeCloseTo(0, 6);
    // nur Infrastruktur-Jahreskosten → nettoJk > 0 (Kostenüberhang), aber klein
    expect(w.nettoJk).toBeGreaterThan(0);
    expect(w.nettoJk).toBeCloseTo(w.infJk, 6);
  });

  it('REGRESSION (3D-Kante): bei PV=0 steigt nettoJk streng mit der Batteriegröße', () => {
    // Eine Batterie ohne PV ist reiner Kapitalverlust — der Jahresüberschuss (−nettoJk)
    // muss mit jeder größeren Batterie SCHLECHTER werden. Früher war diese Kante in der
    // 3D-Fläche fix auf 0 €/a gesetzt und täuschte einen Gewinn vor.
    let prev = -Infinity;
    for (const bat of [0, 500, 2000, 5000]) {
      const w = wirtAt(0, bat);
      expect(w.nettoJk).toBeGreaterThan(prev);
      prev = w.nettoJk;
    }
  });

  it('eine sinnvolle PV-Größe bringt höheren Jahresüberschuss als PV=0', () => {
    const surplus0   = -wirtAt(0,   0).nettoJk;
    const surplusPv  = -wirtAt(300, 0).nettoJk;
    expect(surplusPv).toBeGreaterThan(surplus0);
  });

  it('Determinismus: identische Eingaben → identisches nettoJk (Konsistenz aller Diagramme)', () => {
    // Varianten-Tabelle, 2D-Heatmap und 3D-Fläche rufen exakt diese Kette auf —
    // gleiche (PV×Bat)-Kombination muss überall denselben Wert liefern.
    const a = wirtAt(450, 600);
    const b = wirtAt(450, 600);
    expect(b.nettoJk).toBe(a.nettoJk);
    expect(b.investGes).toBe(a.investGes);
  });

  it('Autarkiegrad liegt zwischen 0 und 100 %', () => {
    const w = wirtAt(600, 1500);
    expect(w.autarkie).toBeGreaterThanOrEqual(0);
    expect(w.autarkie).toBeLessThanOrEqual(100);
  });
});
