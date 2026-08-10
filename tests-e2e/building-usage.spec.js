import {test,expect} from '@playwright/test';

test('dist: erweiterte öffentliche Gebäudetypen sind fachlich zugeordnet',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.getNutzungstypen==='function');
  const result=await page.evaluate(()=>{
    const types=window.getNutzungstypen();
    const byId=id=>types.find(type=>type.id===id);
    return {
      count:types.length,
      unterkunft:byId('unterkunft'),
      kaserne:byId('kaserne'),
      krankenhaus:byId('krankenhaus'),
      rettungswache:byId('rettungswache'),
      waermeUnterkunft:window.getSpezNachBaujahr(1970,'unterkunft'),
      waermeMfh:window.getSpezNachBaujahr(1970,'mfh'),
      osmDormitory:window.osmNutzung('dormitory'),
      osmHospital:window.osmNutzung('hospital'),
    };
  });
  expect(result.count).toBeGreaterThanOrEqual(30);
  expect(result.unterkunft).toMatchObject({slp:'H0',waermeRef:'mfh'});
  expect(result.kaserne).toMatchObject({slp:'BW1',waermeRef:'mfh'});
  expect(result.krankenhaus).toMatchObject({slp:'G3',waermeRef:'oeffentlich'});
  expect(result.rettungswache).toMatchObject({slp:'G3'});
  expect(result.waermeUnterkunft).toBe(result.waermeMfh);
  expect(result.osmDormitory).toBe('wohnheim');
  expect(result.osmHospital).toBe('krankenhaus');
});
