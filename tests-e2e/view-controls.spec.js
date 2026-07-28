import { test,expect } from '@playwright/test';

test('dist: Ansicht steuert Beschriftung und zeitliche Wärmeentwicklung',async({page})=>{
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window._initYearSliderFromBaujahr==='function');
  const initial=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    set_batchImporting(true);
    for(let index=0;index<90;index++){
      const lat=52.08+Math.floor(index/10)*.00018;
      const lng=8+(index%10)*.00025;
      const building=addGebaeude({
        id:2000+index,name:`Gebäude ${index+1}`,baujahr:index===0?1970:2000,
        coords:[
          L.latLng(lat-.000025,lng-.000025),L.latLng(lat-.000025,lng+.000025),
          L.latLng(lat+.000025,lng+.000025),L.latLng(lat+.000025,lng-.000025),
        ],skipAutoCreate:true,
      });
      building.waerme='100';
      building.heizlast='50';
      if(index===0) building.sanierungen=[{jahr:2030,zielSpez:50}];
    }
    set_batchImporting(false);
    _initYearSliderFromBaujahr();
    renderList();
    updateViz();
    map.setView([52.0808,8.001],16);
    return {
      labelsDefault:window.labelsVisible,
      labelCheckbox:document.getElementById('el-labels-visible').checked,
      overlayCheckbox:Boolean(document.getElementById('el-overlay-visible')),
      yearMin:document.getElementById('year-slider').min,
    };
  });
  expect(initial).toEqual({
    labelsDefault:false,labelCheckbox:false,overlayCheckbox:false,yearMin:'1970',
  });

  await page.evaluate(()=>toggleEbenenPanel());
  await page.locator('#el-labels-visible').check();
  await expect.poll(()=>page.locator('.geb-label').count()).toBeGreaterThan(0);

  await page.locator('#el-chart-visible').check();
  await expect(page.locator('#chart-panel')).toHaveClass(/visible/);
  await expect(page.locator('#svg-chart-container svg')).toBeVisible();
  await expect(page.locator('#svg-chart-container')).toContainText('1970');
  await expect(page.locator('#svg-chart-container polyline')).toHaveCount(3);
});
