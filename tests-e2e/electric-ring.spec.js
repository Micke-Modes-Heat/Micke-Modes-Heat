import { test,expect } from '@playwright/test';

test('MS-Ring wird im echten Browser erkannt und als offener Stich berechnet',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.elDetectMSRings==='function');
  const result=await page.evaluate(()=>{
    clearAssets();
    const add=(id,type,props={})=>ASSETS.items.push({id,type,domain:'strom',lat:52+ASSETS.items.length*.001,lng:8,name:id,props,massnahmen:[]});
    add('nap','NAP',{spannungKV:20});add('sa','Schaltanlage',{trennstelle:true});add('trafo','Trafo',{leistungKVA:630});
    window.stromNodes=ASSETS.items.map(a=>({id:a.id,type:a.type,lat:a.lat,lng:a.lng}));
    window.stromEdges=[
      {id:'e1',u:'nap',v:'sa',msLevel:true,crossSection:95,_lengthM:100},
      {id:'e2',u:'sa',v:'trafo',msLevel:true,crossSection:95,_lengthM:120},
      {id:'e3',u:'trafo',v:'nap',msLevel:true,crossSection:95,_lengthM:140},
    ];
    const rings=elDetectMSRings();const calc=elCalcMSRing(rings[0]);const n1=elCalcN1(rings[0]);
    return {count:rings.length,nodes:rings[0]?.nodes.slice().sort(),trennstellen:rings[0]?.trennstellen.map(a=>a.id),sticheMode:calc?.sticheMode,edgeCount:calc?.edges.length,n1Cases:n1?.contingencies?.length ?? 0};
  });
  expect(result).toMatchObject({count:1,nodes:['nap','sa','trafo'],trennstellen:['sa'],sticheMode:true,edgeCount:3,n1Cases:3});
});
