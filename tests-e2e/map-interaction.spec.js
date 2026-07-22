import { test,expect } from '@playwright/test';

test('Plangebiet nimmt mehrere Eckpunkte an und lässt sich abschließen',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>window.map && typeof window.toggleDrawArea==='function');

  const result=await page.evaluate(()=>{
    toggleDrawArea();
    const points=[
      L.latLng(map.getCenter().lat-0.001,map.getCenter().lng-0.001),
      L.latLng(map.getCenter().lat-0.001,map.getCenter().lng+0.001),
      L.latLng(map.getCenter().lat+0.001,map.getCenter().lng+0.001),
    ];
    points.forEach(latlng=>map.fire('click',{latlng}));
    const before={count:window.areaPoints.length,lineCount:window.areaPolyline.getLatLngs().length};
    finishAreaDraw();
    return {
      before,
      drawing:window.areaDrawing,
      polygonCount:window.areaPolygon.getLatLngs()[0].length,
      importAreaCount:window.areaLatLngs.length,
    };
  });

  expect(result).toEqual({before:{count:3,lineCount:3},drawing:false,polygonCount:3,importAreaCount:3});
});

test('Kartenwerkzeuge wechseln zentral und Escape räumt den Modus vollständig auf',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>window.map && typeof window.beginInteraction==='function');
  const switched=await page.evaluate(()=>{
    toggleDrawArea();
    const first={active:getActiveInteraction()?.id,area:window.areaDrawing,banner:document.getElementById('map-interaction-status')?.textContent};
    toggleDrawTrasse('waerme');
    return {first,active:getActiveInteraction()?.id,area:window.areaDrawing,trasse:window.isDrawingTrasse,tool:document.body.dataset.mapTool};
  });
  expect(switched.first.active).toBe('draw-area');
  expect(switched.first.area).toBe(true);
  expect(switched.first.banner).toContain('Plangebiet zeichnen');
  expect(switched).toMatchObject({active:'draw-trasse',area:false,trasse:true,tool:'draw-trasse'});

  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>({active:getActiveInteraction(),trasse:window.isDrawingTrasse,banner:!!document.getElementById('map-interaction-status'),tool:document.body.dataset.mapTool})))
    .toEqual({active:null,trasse:false,banner:false,tool:undefined});
});
