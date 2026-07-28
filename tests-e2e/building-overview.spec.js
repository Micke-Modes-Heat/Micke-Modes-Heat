import {expect,test} from '@playwright/test';

test('dist: Gebäudeübersicht bearbeitet, sortiert und sammelt Gebäudedaten',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.renderGebaeudeOverview==='function');

  const initial=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const add=(id,name,nutzung,year,area,heat,load)=>{
      const building=addGebaeude({
        id,name,nutzung,baujahr:year,skipAutoCreate:true,
        coords:[
          L.latLng(52,8+id*.0001),L.latLng(52,8.00005+id*.0001),
          L.latLng(52.00005,8.00005+id*.0001),L.latLng(52.00005,8+id*.0001),
        ],
      });
      building.nutzung=nutzung;
      building.baujahr=year;
      building.flaeche=area;
      building.stockwerke=2;
      building.waerme=String(heat);
      building.heizlast=String(load);
      building.waermeManual=true;
      building.heizlastManual=true;
    };
    add(1201,'Schule Nord','schule',1970,800,240,180);
    add(1202,'Büro Mitte','buero',1995,500,110,80);
    add(1203,'Wohnhaus Süd','mfh',2010,300,65,45);
    setViewMode('gebaeude');
    return {
      visible:document.getElementById('center-gebaeude-view')?.style.display,
      rows:document.querySelectorAll('#geb-table-body tr').length,
      analyses:document.querySelectorAll('.geb-analysis-card').length,
      kpis:document.querySelectorAll('.geb-overview-kpi').length,
    };
  });

  expect(initial).toEqual({visible:'block',rows:3,analyses:3,kpis:5});

  await page.evaluate(()=>glBerechnenDebounced(0));
  await page.waitForFunction(()=>window._buildingHeatProfileMode &&
    window._buildingHeatProfiles?.size===3);
  await page.locator('.geb-profile-btn').first().click();
  await expect(page.locator('#geb-profile-dialog')).toBeVisible();
  await expect(page.locator('#geb-profile-title')).toContainText('Büro Mitte');
  await expect(page.locator('#geb-profile-kpis')).toContainText('Profilspitze kW');
  await page.evaluate(()=>closeGebaeudeHeatProfile());

  await page.evaluate(()=>{
    sortGebaeudeTable('baujahr');
    setGebaeudeTableFilter('Büro');
  });
  await expect(page.locator('#geb-table-body tr')).toHaveCount(1);
  await expect(page.locator('#geb-table-body .geb-table-name')).toHaveValue('Büro Mitte');

  const changed=await page.evaluate(()=>{
    setGebaeudeTableFilter('');
    updateGebaeudeTableField(1202,'heizlast','95');
    toggleGebaeudeTableSelection(1201,true);
    toggleGebaeudeTableSelection(1203,true);
    document.getElementById('geb-bulk-nutzung').value='oeffentlich';
    document.getElementById('geb-bulk-baujahr').value='1980';
    document.getElementById('geb-bulk-stockwerke').value='3';
    applyGebaeudeTableBulk();
    return gebaeude.map(g=>({
      id:g.id,nutzung:g.nutzung,baujahr:g.baujahr,
      stockwerke:g.stockwerke,heizlast:Number(g.heizlast),
    }));
  });

  expect(changed.find(g=>g.id===1202).heizlast).toBe(95);
  expect(changed.filter(g=>g.id!==1202)).toEqual([
    {id:1201,nutzung:'oeffentlich',baujahr:1980,stockwerke:3,heizlast:180},
    {id:1203,nutzung:'oeffentlich',baujahr:1980,stockwerke:3,heizlast:45},
  ]);
  await expect(page.locator('#geb-table-bulk')).toHaveClass(/visible/);
});
