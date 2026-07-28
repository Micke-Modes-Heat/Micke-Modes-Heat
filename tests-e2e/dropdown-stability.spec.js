import {expect,test} from '@playwright/test';

test('dist: geöffnete Dropdowns werden durch Hintergrundaktualisierungen nicht ersetzt',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.renderList==='function');

  const result=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const building=addGebaeude({
      id:1701,
      name:'Dropdown-Test',
      nutzung:'buero',
      importSourceId:'quelle-1',
      importSourceName:'Teilprojekt 1',
      skipAutoCreate:true,
      coords:[
        L.latLng(52,8),L.latLng(52,8.0001),
        L.latLng(52.0001,8.0001),L.latLng(52.0001,8),
      ],
    });
    building.importSourceId='quelle-1';
    building.importSourceName='Teilprojekt 1';
    renderList();
    toggleGebExpand(building.id);

    const usage=document.querySelector('.geb-card .nutzung-select');
    usage.focus();
    renderList();
    const cardSelectStayed=usage.isConnected && document.activeElement===usage;
    usage.blur();

    populateZentraleSelect();
    const central=document.getElementById('netz-zentrale');
    const originalCentralOption=central.options[0];
    populateZentraleSelect();
    const centralStayed=central.options[0]===originalCentralOption;

    renderList();
    const source=document.getElementById('geb-source-filter');
    const originalSourceOption=source.options[0];
    source.focus();
    renderList();
    const sourceStayed=source.options[0]===originalSourceOption &&
      document.activeElement===source;
    source.blur();

    return {cardSelectStayed,centralStayed,sourceStayed};
  });

  expect(result).toEqual({
    cardSelectStayed:true,
    centralStayed:true,
    sourceStayed:true,
  });
});
