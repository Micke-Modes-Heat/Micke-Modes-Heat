import {test,expect} from '@playwright/test';

test('Erzeugerpanel zeigt Gesamtbedarf, Einzeldeckung und verbleibenden Rest',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window._renderDeckungWrap==='function');
  const text=await page.evaluate(()=>{
    const wrap=document.createElement('div');
    wrap.id='coverage-test-wrap';
    document.body.appendChild(wrap);
    _renderDeckungWrap(
      'test',{wrapId:'coverage-test-wrap',color:'#66bb6a',label:'Test-Erzeuger'},
      42.5,425,'3.8',1,'stundenscharf · 500 kW',850,
      [{key:'test',label:'Test-Erzeuger',color:'#66bb6a',pct:42.5,hlPct:50}],
      {heizlastKw:500,nennKw:500,spitzenlastKw:1000,isWp:false},
      {totalMwh:1000,restMwh:575,restPeakKw:500},
    );
    return wrap.textContent.replace(/\s+/g,' ').trim();
  });
  expect(text).toContain('Gesamtsystem benötigt1.000 MWh/a · 1.000 kW');
  expect(text).toContain('Dieser Erzeuger allein für 100 % Leistung1.000 kW Nennleistung');
  expect(text).toContain('42.5 % Energie · 50.0 % Leistung');
  expect(text).toContain('Rest nach allen gewählten Erzeugern575 MWh/a · 500 kW');
});
