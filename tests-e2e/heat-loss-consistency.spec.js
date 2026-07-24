import { test, expect } from '@playwright/test';

test('dist: aufgebautes Wärmenetz liefert den Verlustwert für den Gesamtlastgang',async({page})=>{
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.autoGenerateNetz==='function'&&typeof window.glBerechnenAuto==='function');

  const network=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const add=(id,lat,lng,name)=>{
      const building=addGebaeude({
        id,name,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00005,lng-.00005),L.latLng(lat-.00005,lng+.00005),
          L.latLng(lat+.00005,lng+.00005),L.latLng(lat+.00005,lng-.00005),
        ],
      });
      building.waerme='1000';
      building.heizlast='500';
    };
    add(951,52.08,8,'Zentrale');
    add(952,52.083,8.004,'Verbraucher');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='951';
    document.getElementById('gl-gesamt').value='';
    document.getElementById('gl-netzverlust').value='30';
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'quick'});
    glBerechnenAuto();
    return {lossMWh:window._netzAnnualLossMWh};
  });

  expect(network.lossMWh).toBeGreaterThan(0);
  await page.waitForFunction(()=>window.systemState?.netzverlustQuelle==='waermenetz');
  const result=await page.evaluate(()=>({
    total:window.systemState.gesamtMwhMitNV,
    useful:window.systemState.nutzwaermeMwh,
    loss:window.systemState.netzverlustMwh,
    pct:window.systemState.netzverlustPct,
    hint:document.getElementById('gl-netzverlust-hint').textContent,
  }));
  expect(result.total-result.useful).toBeCloseTo(network.lossMWh,4);
  expect(result.loss).toBeCloseTo(network.lossMWh,4);
  expect(result.pct).not.toBeCloseTo(30,1);
  expect(result.hint).toContain('aus Wärmenetz');
});
