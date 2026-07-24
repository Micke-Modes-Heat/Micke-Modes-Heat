import { test, expect } from '@playwright/test';

test('dist: erster Wechsel zu Live rendert sofort die gewählte Darstellung',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.setViewMode==='function');

  await page.evaluate(()=>{
    const hours=8760;
    window._dispatchHourly={gaskessel:new Float32Array(hours).fill(80)};
    window._dispatchActiveKeys=['gaskessel'];
    window._dispatchLastgangKw=new Float32Array(hours).fill(80);
    window.systemState={
      lastgangKw:new Float32Array(hours).fill(80),
      tempH:new Float32Array(hours).fill(5),
      vlH:new Float32Array(hours).fill(70),
    };
    localStorage.setItem('live-flow-mode','sankey');
    setViewMode('karte');
    setViewMode('live');
  });

  await expect(page.locator('#center-live-view')).toBeVisible();
  await expect(page.locator('#live-kpi-bar')).toContainText('Bedarf');
  await expect(page.locator('#live-flow-svg canvas')).toBeVisible();
  const timeline=page.locator('#live-tl-slider');
  const box=await timeline.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x+10,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.75,box.y+box.height/2,{steps:5});
  await page.mouse.up();
  expect(Number(await page.locator('#live-slider').inputValue())).toBeGreaterThan(6500);
  await expect(page.locator('#live-title')).toContainText('Oktober');
  expect(pageErrors).toEqual([]);
});
