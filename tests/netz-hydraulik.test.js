import { describe, it, expect } from 'vitest';
import {
  rohrInnenM, rohrQuerschnittM2, wasserStoffwerte, rohrHydraulik, massenstromKgS, rohrLeistungKw,
  foerderhoeheM, pumpenWirkungsgrad, netzPumpe, pumpenVolllaststunden, KMR_STAHLROHR,
} from '../src/lib/netz-hydraulik.js';

describe('Netzhydraulik', () => {
  it('Innendurchmesser der KMR-Stahlrohre statt Nennweite', () => {
    expect(rohrInnenM(25) * 1000).toBeCloseTo(27.3, 6);
    expect(rohrInnenM(50) * 1000).toBeCloseTo(53.9, 6);
    expect(rohrInnenM(100) * 1000).toBeCloseTo(107.1, 6);
    expect(rohrInnenM(500) * 1000).toBeCloseTo(495.4, 6);
    expect(rohrInnenM(999)).toBeCloseTo(0.999, 9);   // außerhalb der Tabelle: Nennweite als Näherung
    expect(rohrQuerschnittM2(100)).toBeCloseTo(Math.PI * 0.1071 ** 2 / 4, 9);
    // Innendurchmesser steigt mit der Nennweite
    const dns = Object.keys(KMR_STAHLROHR).map(Number);
    for (let i = 1; i < dns.length; i++) expect(rohrInnenM(dns[i])).toBeGreaterThan(rohrInnenM(dns[i - 1]));
  });

  it('Stoffwerte von Wasser nach Temperatur (Tabellenwerte ±0,5 %)', () => {
    const t70 = wasserStoffwerte(70), t40 = wasserStoffwerte(40), t10 = wasserStoffwerte(10);
    expect(t70.rho).toBeCloseTo(977.8, 0);
    expect(t40.rho).toBeCloseTo(992.2, 0);
    expect(t70.nu / 4.13e-7).toBeGreaterThan(0.985);
    expect(t70.nu / 4.13e-7).toBeLessThan(1.005);
    expect(t40.nu / 6.58e-7).toBeGreaterThan(0.995);
    expect(t40.nu / 6.58e-7).toBeLessThan(1.005);
    expect(t10.nu / 1.306e-6).toBeGreaterThan(0.99);
    expect(t10.nu / 1.306e-6).toBeLessThan(1.01);
  });

  it('Darcy-Weisbach mit Swamee-Jain: DN 50, 220 kW, Spreizung 30 K', () => {
    const st = wasserStoffwerte(75);
    const m = massenstromKgS(220, 30);
    expect(m).toBeCloseTo(220 / (4.184 * 30), 9);
    const h = rohrHydraulik(m, 50, st);
    const d = 0.0539, v = m / st.rho / (Math.PI * d * d / 4), re = v * d / st.nu;
    const lambda = 0.25 / Math.log10(0.00005 / (3.7 * d) + 5.74 / re ** 0.9) ** 2;
    expect(h.velocity).toBeCloseTo(v, 9);
    expect(h.dpPerM).toBeCloseTo(lambda * st.rho * v * v / (2 * d), 6);
    expect(h.velocity).toBeCloseTo(0.79, 2);
    expect(h.dpPerM).toBeGreaterThan(115);
    expect(h.dpPerM).toBeLessThan(130);
    // laminar
    const lam = rohrHydraulik(0.001, 50, st);
    expect(lam.lambda).toBeCloseTo(64 / Math.max(lam.reynolds, 100), 9);
    expect(rohrHydraulik(0, 50, st).dpPerM).toBe(0);
  });

  it('übertragbare Leistung und Förderhöhe', () => {
    const st = wasserStoffwerte(70);
    expect(rohrLeistungKw(100, 1, 30, st)).toBeCloseTo(rohrQuerschnittM2(100) * st.rho * 4.184 * 30, 6);
    expect(foerderhoeheM(100000, st)).toBeCloseTo(100000 / (st.rho * 9.81), 9);
  });

  it('Pumpenwirkungsgrad stetig und steigend, Netzpumpe P = V̇·Δp/η', () => {
    let vorher = pumpenWirkungsgrad(0.01);
    for (let p = 0.01; p < 1000; p *= 1.1) {
      const eta = pumpenWirkungsgrad(p);
      expect(eta).toBeGreaterThanOrEqual(vorher);
      expect(eta - vorher).toBeLessThan(0.03);   // keine Sprünge
      vorher = eta;
    }
    expect(pumpenWirkungsgrad(1)).toBeCloseTo(0.55, 9);
    expect(pumpenWirkungsgrad(1000)).toBeCloseTo(0.82, 9);
    const st = wasserStoffwerte(70);
    const p = netzPumpe(10, 200000, st);
    expect(p.vDotM3s).toBeCloseTo(10 / st.rho, 9);
    expect(p.pKw).toBeCloseTo(p.vDotM3s * 200000 / 1000 / p.eta, 9);
    expect(netzPumpe(0, 200000, st).pKw).toBe(0);
  });

  it('Volllaststunden der Netzpumpe: kubisch, mindestens 10 %, bezogen auf die Auslegungslast', () => {
    const lg = new Float32Array(8760).fill(100);
    lg[0] = 1000;
    // Bezug Lastgangspitze: 1 h voll, sonst max(0,1; 0,1³) = 0,1
    expect(pumpenVolllaststunden(lg)).toBeCloseTo(1 + 8759 * 0.1, 3);
    // Auslegungslast 2.000 kW: Spitzenstunde 0,5³ = 0,125
    expect(pumpenVolllaststunden(lg, 2000)).toBeCloseTo(0.125 + 8759 * 0.1, 3);
    // Bezug nie unter der Lastgangspitze
    expect(pumpenVolllaststunden(lg, 10)).toBeCloseTo(pumpenVolllaststunden(lg), 9);
    expect(pumpenVolllaststunden(null)).toBe(0);
  });
});
