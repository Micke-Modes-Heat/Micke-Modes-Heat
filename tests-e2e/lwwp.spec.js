import { test, expect } from '@playwright/test';

test('dist: Entfernen der Luft-Wärmepumpe entfernt Gerät und Schallringe',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.placeLwWpAt==='function'&&typeof window.clearLwWp==='function');

  const result=await page.evaluate(()=>{
    placeLwWpAt(L.latLng(52.08,8));
    const before={
      deviceLayers:window.lwWpLayerGroup.getLayers().length,
      soundLayers:window.lwWpSchallLayerGroup.getLayers().length,
      soundOnMap:map.hasLayer(window.lwWpSchallLayerGroup),
    };
    clearLwWp();
    const buttonAfterClear=document.getElementById('btn-place-lwwp');
    togglePlaceLwWp();
    const buttonWhilePlacing=document.getElementById('btn-place-lwwp');
    const newPlacement={
      active:window.isPlacingLwWp,
      buttonText:buttonWhilePlacing.textContent,
    };
    togglePlaceLwWp();
    return {
      before,
      lwWp:window.lwWp,
      deviceLayers:window.lwWpLayerGroup.getLayers().length,
      soundLayers:window.lwWpSchallLayerGroup.getLayers().length,
      deviceOnMap:map.hasLayer(window.lwWpLayerGroup),
      soundOnMap:map.hasLayer(window.lwWpSchallLayerGroup),
      buttonAfterClear:buttonAfterClear.textContent,
      newPlacement,
    };
  });

  expect(result.before.deviceLayers).toBeGreaterThan(0);
  expect(result.before.soundLayers).toBeGreaterThan(0);
  expect(result.before.soundOnMap).toBe(true);
  expect(result).toMatchObject({
    lwWp:null,
    deviceLayers:0,
    soundLayers:0,
    deviceOnMap:false,
    soundOnMap:false,
    buttonAfterClear:'Auf Karte platzieren',
    newPlacement:{
      active:true,
      buttonText:'Klicken auf Karte zum Platzieren',
    },
  });
  expect(pageErrors).toEqual([]);
});
