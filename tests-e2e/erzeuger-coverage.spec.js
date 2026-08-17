import {test,expect} from '@playwright/test';

test('Erzeugerpanel zeigt Restbedarf und Zielgrößen mit anderen Erzeugern',async({page})=>{
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
      {energyTargetKw:700,powerTargetKw:600},
    );
    return wrap.textContent.replace(/\s+/g,' ').trim();
  });
  expect(text).toContain('Gesamtsystem benötigt1.000 MWh/a · 1.000 kW');
  expect(text).toContain('42.5 % Energie · 50.0 % Leistung');
  expect(text).toContain('Für 100 % Jahresenergie700 kW gesamt · noch +200 kW');
  expect(text).toContain('Für 100 % Heizleistung600 kW gesamt · noch +100 kW');
  expect(text).toContain('Derzeit ungedeckt nach allen gewählten575 MWh/a · 500 kW');
  expect(text).toContain('Ungedeckte Restlast');
});
