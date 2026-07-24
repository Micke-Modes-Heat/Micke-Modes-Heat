import { test, expect } from '@playwright/test';

test('dist: Gebäudedaten mehrerer Projekte werden kollisionsfrei und ohne Duplikate ergänzt',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.importBuildingsFromProjects==='function');

  const result=await page.evaluate(async()=>{
    clearNetz();
    setGebaeude([]);
    const polygon=(lat,lng)=>[
      {lat:lat-.00004,lng:lng-.00004},{lat:lat-.00004,lng:lng+.00004},
      {lat:lat+.00004,lng:lng+.00004},{lat:lat+.00004,lng:lng-.00004},
    ];
    const existing=addGebaeude({id:1,name:'Bestand',coords:polygon(52.08,8),skipAutoCreate:true});
    existing.waerme='100';
    const shared=polygon(52.082,8.002);
    const projectA={
      version:2,
      gebaeude:[
        {id:1,name:'A Verwaltung',polygon:shared,waerme:'500',heizlast:'200',nutzung:'buero',baujahr:1970,sanierungen:[{jahr:2030,zielSpez:60}]},
        {id:2,name:'A Lager',polygon:polygon(52.083,8.003),waerme:'300',heizlast:'120',nutzung:'ghd'},
      ],
    };
    const projectB={
      version:2,
      gebaeude:[
        {id:1,name:'B Werkstatt',polygon:polygon(52.084,8.004),waerme:'400',heizlast:'160',nutzung:'industrie'},
        {id:7,name:'Duplikat aus A',polygon:shared,waerme:'999',heizlast:'999',nutzung:'ghd'},
      ],
    };
    const fileA=new File([JSON.stringify(projectA)],'Quartier Nord.json',{type:'application/json'});
    const fileB=new File([JSON.stringify(projectB)],'Quartier Süd.json',{type:'application/json'});
    const first=await importBuildingsFromProjects({target:{files:[fileA,fileB],value:'x'}});
    const mapContainsImportAfterAdd=map.getBounds().contains(L.latLng(52.083,8.003));
    const second=await importBuildingsFromProjects({target:{files:[fileA],value:'x'}});
    const ids=window.gebaeude.map(building=>building.id);
    const imported=window.gebaeude.filter(building=>building.importSourceId);
    const sourceIds=[...new Set(imported.map(building=>building.importSourceId))];
    const select=document.getElementById('geb-source-filter');
    select.value=sourceIds[0];
    filterList('');
    const visibleCards=[...document.querySelectorAll('#geb-list .geb-card')]
      .filter(card=>card.style.display!=='none').length;
    toggleBuildingSourceOutlines(true);
    const outlined=imported.find(building=>building.importSourceId===sourceIds[0]);
    const outlineColor=outlined.polygonLayer.options.color;
    const saved=_buildProjectData();
    _loadProject(saved);
    return {
      first,second,
      names:window.gebaeude.map(building=>building.name).sort(),
      idsUnique:new Set(ids).size===ids.length,
      importedCount:imported.length,
      sources:sourceIds.length,
      sourceOptions:select.options.length,
      visibleCards,
      outlineColor,
      expectedOutlineColor:outlined.importSourceColor,
      roundtripSources:window.gebaeude.filter(building=>building.importSourceId).length,
      roundtripKey:window.gebaeude.find(building=>building.name==='A Verwaltung')?.importBuildingKey || '',
      yearMin:document.getElementById('year-slider').min,
      mapContainsImportAfterAdd,
    };
  });

  expect(result.first).toEqual({imported:3,skipped:1,sources:2});
  expect(result.second).toEqual({imported:0,skipped:2,sources:1});
  expect(result.idsUnique).toBe(true);
  expect(result.importedCount).toBe(3);
  expect(result.sources).toBe(2);
  expect(result.sourceOptions).toBe(3);
  expect(result.visibleCards).toBeGreaterThan(0);
  expect(result.visibleCards).toBeLessThan(4);
  expect(result.outlineColor).toBe(result.expectedOutlineColor);
  expect(result.roundtripSources).toBe(3);
  expect(result.roundtripKey).toContain('project-');
  expect(result.yearMin).toBe('1970');
  expect(result.mapContainsImportAfterAdd).toBe(true);
  expect(result.names).toEqual(['A Lager','A Verwaltung','B Werkstatt','Bestand']);
  expect(pageErrors).toEqual([]);
});
