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

test('dist: Aufstellfläche der Außengeräte — Geräte, Drehung und Speichern/Laden',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.placeLwWpAt==='function'&&typeof window.lwWpAufstellungSetzen==='function');

  const result=await page.evaluate(()=>{
    document.getElementById('lwwp-leistung').value=640;
    placeLwWpAt(L.latLng(52.08,8));
    lwWpAufstellungSetzen('modulKw','80');
    lwWpAufstellungSetzen('reihen','2');
    lwWpAufstellungSetzen('drehung','200');   // 200° ≙ 20° (Rechteck ist punktsymmetrisch)
    const geraete=document.querySelectorAll('.lwwp-geraet').length;
    const label=document.querySelector('.lwwp-flaeche-label')?.textContent;
    const anzeige=document.getElementById('lwwp-geraete').textContent;
    const gespeichert=_buildProjectData();
    clearLwWp();
    _loadProject(gespeichert);
    return {geraete,label,anzeige,aufstellung:gespeichert.lwWp.aufstellung,nachLaden:window.lwWp.aufstellung,
      geraeteNachLaden:document.querySelectorAll('.lwwp-geraet').length};
  });

  expect(result.geraete).toBe(8);
  expect(result.anzeige).toBe('8 × ~80 kW · 2 Reihen');
  expect(result.label).toMatch(/^8 × ~80 kW · \d+ m²$/);
  expect(result.aufstellung).toEqual({modulKw:80,reihen:2,drehung:20});
  expect(result.nachLaden).toEqual({modulKw:80,reihen:2,drehung:20});
  expect(result.geraeteNachLaden).toBe(8);
  expect(pageErrors).toEqual([]);
});
