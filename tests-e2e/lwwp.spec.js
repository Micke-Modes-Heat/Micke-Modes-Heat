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
  expect(result.aufstellung).toEqual({modulKw:80,reihen:2,drehung:20,laenge:null});
  expect(result.nachLaden).toEqual({modulKw:80,reihen:2,drehung:20,laenge:null});
  expect(result.geraeteNachLaden).toBe(8);
  expect(pageErrors).toEqual([]);
});

test('dist: Aufstellfläche per Griff formen (Abstände passen immer) und drehen',async({page})=>{
  await page.setViewportSize({width:1700,height:1000});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.placeLwWpAt==='function'&&typeof window.lwWpAufstellungSetzen==='function');
  const vorher=await page.evaluate(()=>{
    document.getElementById('lwwp-leistung').value=100;
    placeLwWpAt(L.latLng(52.08,8));   // öffnet das LW-WP-Panel → Griffe sichtbar
    map.setView([52.08,8],20,{animate:false});
    // Fläche mitten in den freien Kartenbereich zwischen linker Seitenleiste und LW-WP-Panel schieben
    const pr=document.getElementById('lwwp-panel').getBoundingClientRect(), mr=map.getContainer().getBoundingClientRect();
    const y=mr.top+mr.height*0.75;
    let x=pr.left-10; while(x>mr.left&&map.getContainer().contains(document.elementFromPoint(x,y))) x-=5;
    const ziel={x:(x+pr.left)/2-mr.left,y:y-mr.top};
    const ist=map.latLngToContainerPoint(L.latLng(52.08,8));
    map.panBy([ist.x-ziel.x, ist.y-ziel.y],{animate:false});
    redrawLwWp();
    return {flaeche:lwWpPlatzbedarfM2(100),laenge:lwWpAufstellung(100).laenge};
  });
  await page.waitForTimeout(300);
  const box=async sel=>{const b=await page.locator(sel).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  // Längengriff Richtung Mitte ziehen → kürzer
  const g=await box('.lwwp-griff.laenge');
  const mitte=await page.evaluate(()=>{const p=map.latLngToContainerPoint(L.latLng(52.08,8));const r=map.getContainer().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};});
  await page.mouse.move(g.x,g.y); await page.mouse.down();
  await page.mouse.move(g.x-(g.x-mitte.x)*0.35,g.y,{steps:8}); await page.mouse.up();
  await page.waitForTimeout(200);
  const geformt=await page.evaluate(()=>({auf:{...window.lwWp.aufstellung},flaeche:lwWpPlatzbedarfM2(100),a:lwWpAufstellung(100)}));
  expect(geformt.auf.laenge).toBeGreaterThan(0);
  expect(geformt.auf.laenge).toBeLessThan(vorher.laenge);
  // gleiche Fläche, nur wenn die Abstände es verlangen etwas mehr
  expect(geformt.flaeche).toBeGreaterThanOrEqual(vorher.flaeche-1e-6);
  expect(geformt.flaeche-vorher.flaeche).toBeCloseTo(geformt.a.mehrFlaeche,6);
  expect(geformt.a.laenge*geformt.a.breite).toBeCloseTo(geformt.flaeche,4);
  expect(await page.locator('.lwwp-flaeche-label .zu-klein').count()).toBe(0);
  // Drehgriff nach Osten ziehen → ~90°
  const d=await box('.lwwp-griff.drehen');
  await page.mouse.move(d.x,d.y); await page.mouse.down();
  await page.mouse.move(mitte.x+80,mitte.y,{steps:8}); await page.mouse.up();
  await page.waitForTimeout(200);
  const dreh=await page.evaluate(()=>window.lwWp.aufstellung.drehung);
  expect(Math.abs(dreh-90)).toBeLessThan(8);
  // zurücksetzen
  await page.evaluate(()=>lwWpAufstellungSetzen('laenge','auto'));
  expect(await page.evaluate(()=>window.lwWp.aufstellung.laenge)).toBeNull();
  expect(pageErrors).toEqual([]);
});
