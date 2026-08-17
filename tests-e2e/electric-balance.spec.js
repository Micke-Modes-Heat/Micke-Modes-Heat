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

test('Optimierer ordnet nachts entladenen Solarstrom weiterhin der PV zu',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window._optPvBatSim8760==='function');
  const result=await page.evaluate(()=>{
    const demand=new Float32Array(8760);
    const profile=new Float32Array(8760);
    for(let t=0;t<8760;t++){
      const hour=t%24;
      demand[t]=hour>=18?1:0;
      profile[t]=hour===12?1:0;
    }
    window._optCachedPvProfile=profile;
    document.getElementById('pv-spez').value='1';
    return _optPvBatSim8760(2,6,demand,new Float32Array(8760),null);
  });
  expect(result.pvEigenMwh).toBeCloseTo(result.eigenMwh,8);
  expect(result.bhkwEigenMwh).toBeCloseTo(0,8);
});

test('Batteriepanel zeigt für vorhandene PV einen interaktiven Schnellcheck',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.updateBatteryRecommendation==='function');
  const result=await page.evaluate(()=>{
    window._dispatchEnergy={};
    window._wpElHourly=new Float32Array(8760);
    window._skElHourly=new Float32Array(8760);
    window._bhkwElHourly=new Float32Array(8760);
    window.elQuartierH=new Float32Array(8760).fill(10);
    window.elPvH=new Float32Array(8760);
    for(let t=0;t<8760;t++) if(t%24>=9&&t%24<=15) window.elPvH[t]=20;
    calcStromPanel();
    toggleBatteriePanel();
    const screening=updateBatteryRecommendation(50);
    const applied=applyBatteryRecommendation();
    return {
      screening:{capacity:screening?.capacity,power:screening?.power},applied,
      capacity:document.getElementById('bat-kapazitaet').value,
      power:document.getElementById('bat-leistung').value,
      kpis:document.getElementById('bat-rec-kpis').textContent,
    };
  });
  expect(result.screening).toEqual({capacity:50,power:25});
  expect(result.applied).toBe(true);
  expect(result.capacity).toBe('50');
  expect(result.power).toBe('25');
  expect(result.kpis).toContain('Vollzyklen');
  expect(result.kpis).toContain('Amortisation');
});
