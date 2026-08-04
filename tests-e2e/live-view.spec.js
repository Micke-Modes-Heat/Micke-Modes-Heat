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

test('dist: Stromkessel erscheint einmal als Umwandlung von Strom zu Wärme',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.setViewMode==='function');
  const result=await page.evaluate(()=>{
    const hours=8760;
    window._dispatchHourly={stromkessel:new Float32Array(hours).fill(100)};
    window._dispatchActiveKeys=['stromkessel'];
    window._dispatchLastgangKw=new Float32Array(hours).fill(100);
    window._skElHourly=new Float32Array(hours).fill(101.01);
    window.systemState={
      lastgangKw:new Float32Array(hours).fill(100),
      tempH:new Float32Array(hours).fill(5),
      vlH:new Float32Array(hours).fill(70),
    };
    localStorage.setItem('live-flow-mode','sankey');
    setViewMode('live');
    const boxes=document.querySelector('#live-flow-svg canvas')?._sankeyBoxes||[];
    const canvas=document.querySelector('#live-flow-svg canvas');
    return {
      boxes:(canvas?._sankeyBoxes||[]).filter(box=>box.name==='Stromkessel'),
      bands:(canvas?._sankeyBands||[]).filter(band=>band.label.includes('Stromkessel')),
    };
  });
  expect(result.boxes).toHaveLength(1);
  expect(result.boxes[0].val).toBeCloseTo(100,1);
  expect(result.bands).toHaveLength(2);
  expect(result.bands.find(band=>band.label.startsWith('Strom →'))?.value).toBeCloseTo(101.01,1);
  expect(result.bands.find(band=>band.label.endsWith('→ Wärme'))?.value).toBeCloseTo(100,1);
});

test('dist: Speicherentladung wird im Hub-Sankey nur einmal eingespeist',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.setViewMode==='function');
  const storageBoxes=await page.evaluate(()=>{
    const hours=8760;
    window._dispatchHourly={_thermSpeicher:new Float32Array(hours).fill(40)};
    window._dispatchActiveKeys=['_thermSpeicher'];
    window._dispatchLastgangKw=new Float32Array(hours).fill(40);
    window._thermSpeicherState={params:{kapKwh:500},socH:new Float32Array(hours).fill(250),ladeH:new Float32Array(hours)};
    window.systemState={lastgangKw:new Float32Array(hours).fill(40),tempH:new Float32Array(hours).fill(5),vlH:new Float32Array(hours).fill(70)};
    localStorage.setItem('live-flow-mode','sankey');
    setViewMode('live');
    return (document.querySelector('#live-flow-svg canvas')?._sankeyBoxes||[])
      .filter(box=>box.name.startsWith('Speicher'))
      .map(box=>({name:box.name,val:box.val}));
  });
  expect(storageBoxes).toEqual([{name:'Speicher ↑',val:40}]);
});

test('dist: mehrere Wärmepumpen werden im Hub-Sankey vollständig zusammengefasst',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.setViewMode==='function');
  const result=await page.evaluate(()=>{
    const hours=8760;
    window._dispatchHourly={lwwp:new Float32Array(hours).fill(30),geo:new Float32Array(hours).fill(40)};
    window._dispatchActiveKeys=['lwwp','geo'];
    window._dispatchLastgangKw=new Float32Array(hours).fill(70);
    window._wpElHourly=new Float32Array(hours).fill(20);
    window.systemState={lastgangKw:new Float32Array(hours).fill(70),tempH:new Float32Array(hours).fill(5),vlH:new Float32Array(hours).fill(70)};
    localStorage.setItem('live-flow-mode','sankey');
    setViewMode('live');
    const canvas=document.querySelector('#live-flow-svg canvas');
    return {
      boxes:(canvas?._sankeyBoxes||[]).filter(box=>box.name==='Wärmepumpen'),
      bands:(canvas?._sankeyBands||[]).filter(band=>band.label.includes('Wärmepumpen')),
    };
  });
  expect(result.boxes).toHaveLength(1);
  expect(result.boxes[0].val).toBeCloseTo(70,1);
  expect(result.bands.find(band=>band.label.startsWith('Strom →'))?.value).toBeCloseTo(20,1);
  expect(result.bands.find(band=>band.label.endsWith('→ Wärme'))?.value).toBeCloseTo(70,1);
});
