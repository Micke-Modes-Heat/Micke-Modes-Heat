import { test, expect } from '@playwright/test';

test('Kältestrom fließt stundenscharf durch PV-, Netz- und Sankey-Bilanz', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.calcStromPanel === 'function');

  const balance = await page.evaluate(() => {
    window._dispatchEnergy = {};
    window._wpElHourly = new Float32Array(8760);
    window._skElHourly = new Float32Array(8760);
    window._bhkwElHourly = new Float32Array(8760);
    window._kaelteElHourly = new Float32Array(8760).fill(1);
    window.elQuartierH = new Float32Array(8760);
    window.elPvH = new Float32Array(8760).fill(0.5);
    document.getElementById('pv-kwp').value = '0';
    calcStromPanel();
    return {sankey: window._sankeyData, detail: window._stromBilanz};
  });

  expect(balance.sankey.kaelteMwh).toBeCloseTo(8.76, 8);
  expect(balance.sankey.pvMwh).toBeCloseTo(4.38, 8);
  expect(balance.sankey.netzbezugMwh).toBeCloseTo(4.38, 8);
  expect(balance.sankey.eigenverbrauchMwh).toBeCloseTo(4.38, 8);
  expect(balance.detail.pvToKaelte).toBeCloseTo(4.38, 8);
  expect(balance.detail.netzToKaelte).toBeCloseTo(4.38, 8);
  expect(pageErrors).toHaveLength(0);
});

test('Oberfläche, Optimierer und Worker teilen denselben PV-/Batteriekern', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window._optPvBatSim8760 === 'function' && typeof window.pvBatteryStep === 'function');
  const result = await page.evaluate(() => {
    const demand = new Float32Array(8760).fill(1);
    const pvProfile = new Float32Array(8760);
    for (let t = 0; t < 8760; t++) pvProfile[t] = t % 24 < 12 ? 2 : 0;
    window._optCachedPvProfile = pvProfile;
    document.getElementById('pv-spez').value = '1';
    const optimized = _optPvBatSim8760(1, 4, demand, new Float32Array(8760), null);
    let soc = 0, eigen = 0, feed = 0, grid = 0;
    for (let t = 0; t < 8760; t++) {
      const s = pvBatteryStep({demand:1,pvGen:pvProfile[t],bhkwGen:0,socKwh:soc,capacityKwh:4,powerKw:2,etaCharge:1,etaDischarge:.9});
      soc = s.socKwh;
      eigen += s.direct + (s.demand - s.direct - s.residualDemand);
      feed += s.residualGeneration;
      grid += s.residualDemand;
    }
    const workerCode = _buildOptWorkerCode();
    return {optimized, reference:{eigenMwh:eigen/1000,einspeiseMwh:feed/1000,netzbezugMwh:grid/1000}, exactCore:workerCode.includes(pvBatteryStep.toString())};
  });
  expect(result.optimized.eigenMwh).toBeCloseTo(result.reference.eigenMwh, 10);
  expect(result.optimized.einspeiseMwh).toBeCloseTo(result.reference.einspeiseMwh, 10);
  expect(result.optimized.netzbezugMwh).toBeCloseTo(result.reference.netzbezugMwh, 10);
  expect(result.exactCore).toBe(true);
});
