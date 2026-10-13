import { test, expect } from '@playwright/test';

// Netzhydraulik: Innendurchmesser der KMR-Stahlrohre, Auslegung auf die geplante Netzabsenkung (unabhängig vom
// Jahresregler), Netzpumpe mit Gleichzeitigkeit über alle Abnehmer, Auslastung und Gutachten-Hydraulik
test('dist: Netzhydraulik — Absenkung, Pumpe, Auslastung, Gutachten', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzTemperaturen === 'function' && typeof window.recalcNetz === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    // Zentrale in der Mitte, Abnehmer in zwei Richtungen (mehrere Abgänge)
    for (let i = 0; i < 12; i++) {
      const lat = 52.09 + (i % 6) * 0.0006, lng = 8 + (i < 6 ? -1 : 1) * (0.001 + Math.floor(i / 6) * 0.0001);
      const g = addGebaeude({ id: 500 + i, name: 'H' + i, baujahr: 1975, coords: poly(lat, lng), skipAutoCreate: true });
      g.waerme = '300'; g.heizlast = '150'; g.nutzung = 'mfh'; g.flaeche = 1500;
    }
    const z = addGebaeude({ id: 600, name: 'HZ', baujahr: 1990, coords: poly(52.0915, 8), skipAutoCreate: true });
    z.waerme = '0'; z.heizlast = '0';
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '600';
    document.getElementById('netz-vl').value = 90; document.getElementById('netz-rl').value = 60;
    document.getElementById('netz-plan-jahr').value = '';
    setNetworkLocked(false); setGlobalYearValue(2026); autoGenerateNetz({ strategy: 'quick' }); recalcNetz();
    const kanten = () => window.netzEdges.filter(e => !e.pruned && e.load > 0);
    const dnSumme = () => kanten().reduce((s, e) => s + e.dn, 0);
    const ohne = { dn: dnSumme(), pumpe: { ...window._netzPumpe } };

    // Pumpe: Volumenstrom = Σ Normheizlast × GLF(alle Abnehmer) / (cp · ΔT)
    const abgaenge = window.netzEdges.filter(e => !e.pruned && !e.kuppel && (e.u === 600 || e.v === 600) && e.load > 0);
    const raw = abgaenge.reduce((s, e) => s + e.loadRaw, 0), n = abgaenge.reduce((s, e) => s + e._nVerbraucher, 0);
    const summeAbgaenge = abgaenge.reduce((s, e) => s + e.load, 0);

    // Auslastung: Geschwindigkeit / zulässige Geschwindigkeit der Nennweite
    const e0 = kanten().sort((a, b) => b.load - a.load)[0];
    const auslastung = { pct: e0.utilizationPct, v: e0._vActual, vGrenze: e0.velocityLimit };

    // Absenkung auf 60/40 ab 2035: Nennweiten wachsen schon im Jahr 2026, Jahresregler ändert sie nicht
    document.getElementById('netz-plan-jahr').value = '2035';
    document.getElementById('netz-plan-vl').value = 60; document.getElementById('netz-plan-rl').value = 40;
    recalcNetz();
    const mit2026 = { dn: dnSumme(), designYear: e0.designYear, temps: netzTemperaturen(2026), temps2040: netzTemperaturen(2040) };
    setGlobalYearValue(2040); recalcNetz();
    const mit2040 = { dn: dnSumme(), pumpe: { ...window._netzPumpe } };
    setGlobalYearValue(2026); document.getElementById('netz-plan-jahr').value = ''; recalcNetz();

    const d = ggWaermeDaten();
    return { ohne, raw, n, summeAbgaenge, nAbg: abgaenge.length, auslastung, mit2026, mit2040,
      glf: n <= 1 ? 1 : Math.min(1, 0.449677646 + 0.551234688 / (1 + Math.pow(n / 53.84382392, 1.762743268))), netz: d.netz, foerder: window._netzPumpe.foerderhoeheBar,
      anzahlBottleneck: window.netzEdges.filter(e => !e.pruned && e.load > 0 && e.hydraulicBottleneck).length };
  });
  expect(r.nAbg).toBeGreaterThanOrEqual(2);
  // Pumpe mit Gleichzeitigkeit über alle Abnehmer — kleiner als die Summe der Abgänge mit je eigener Gleichzeitigkeit
  expect(r.ohne.pumpe.lastKw).toBeCloseTo(r.raw * r.glf, 3);
  expect(r.ohne.pumpe.lastKw).toBeLessThan(r.summeAbgaenge);
  expect(r.ohne.pumpe.mDotGesamt).toBeCloseTo(r.raw * r.glf / (4.184 * 30), 4);
  expect(r.ohne.pumpe.zonen['600'].pumpenLeistungKW).toBeCloseTo(r.ohne.pumpe.pumpenLeistungKW, 9);
  // Auslastung = v / v_zulässig
  expect(r.auslastung.pct).toBeCloseTo(r.auslastung.v / r.auslastung.vGrenze * 100, 3);
  // Absenkung: größere Nennweiten bereits 2026, maßgebendes Jahr ist das Absenkungsjahr, 2040 gleiche Nennweiten
  expect(r.mit2026.temps).toEqual({ vl: 90, rl: 60, dt: 30 });
  expect(r.mit2026.temps2040).toEqual({ vl: 60, rl: 40, dt: 20 });
  expect(r.mit2026.dn).toBeGreaterThan(r.ohne.dn);
  expect(r.mit2026.designYear).toBeGreaterThanOrEqual(2035);
  expect(r.mit2040.dn).toBe(r.mit2026.dn);
  // 2040 mit Spreizung 20 K: 1,5-facher Volumenstrom
  expect(r.mit2040.pumpe.mDotGesamt / r.ohne.pumpe.mDotGesamt).toBeCloseTo(1.5, 1);
  // Gutachten: Grenzwerte aus den Eingaben, Förderhöhe, Engpässe nach Druck oder Geschwindigkeit
  expect(r.netz.hydraulik.dpNetzPaM).toBe(150);
  expect(r.netz.hydraulik.vKleinMs).toBeCloseTo(0.5, 9);
  expect(r.netz.hydraulik.vGrossMs).toBeCloseTo(1.5, 9);
  expect(r.netz.hydraulik.foerderhoeheBar).toBeCloseTo(r.foerder, 9);
  expect(r.netz.ueberschreitungen).toBe(r.anzahlBottleneck);
  expect(pageErrors).toEqual([]);
});
