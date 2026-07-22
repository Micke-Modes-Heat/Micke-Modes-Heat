import { test,expect } from '@playwright/test';

test('Ausbauplanung committet, rollt Integritätsfehler zurück und unterstützt Undo',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.runPlanningTransaction==='function');
  const result=await page.evaluate(()=>{
    clearAssets();
    setPhasen([{id:'phase_tx',name:'Testphase',jahrVon:'2030',jahrBis:'2031',variantId:null,reihenfolge:0}]);
    ASSETS.items.push({id:'asset_tx',type:'PV',domain:'strom',lat:52,lng:8,name:'Vorher',props:{},massnahmen:[{id:'measure_tx',typ:'Bau',phaseId:'phase_tx',jahr:null,dependsOn:[]}]});
    clearPlanningTransactionHistory();
    runPlanningTransaction('Name ändern',()=>{ASSETS.items[0].name='Nachher';});
    const afterCommit=ASSETS.items[0].name;
    let rollbackMessage='';
    try { runPlanningTransaction('Ungültige Phase',()=>{ASSETS.items[0].massnahmen[0].phaseId='missing_phase';ASSETS.items[0].name='Darf nicht bleiben';}); }
    catch(error){rollbackMessage=error.message;}
    const afterRollback={name:ASSETS.items[0].name,phaseId:ASSETS.items[0].massnahmen[0].phaseId};
    const undone=undoLastPlanningTransaction();
    ASSETS.items.push({id:'asset_tx_2',type:'PV',domain:'strom',lat:52,lng:8,name:'Abhängig',props:{},massnahmen:[{id:'measure_tx_2',typ:'Bau',phaseId:'phase_tx',jahr:null,dependsOn:['measure_tx']}]});
    let deleteRollback='';
    try { deleteAsset('asset_tx'); } catch(error) { deleteRollback=error.message; }
    let variantRollback='';
    try { activateVariant('missing_variant'); } catch(error) { variantRollback=error.message; }
    return {afterCommit,afterRollback,undone,afterUndo:ASSETS.items.find(a=>a.id==='asset_tx')?.name,rollbackMessage,history:getPlanningTransactionHistory(),
      assetIds:ASSETS.items.map(a=>a.id).sort(),deleteRollback,activeVariantId:window.activeVariantId,variantRollback};
  });
  expect(result.afterCommit).toBe('Nachher');
  expect(result.afterRollback).toEqual({name:'Nachher',phaseId:'phase_tx'});
  expect(result.rollbackMessage).toMatch(/zurückgerollt.*unbekannte Phase/i);
  expect(result.undone).toBe(true);
  expect(result.afterUndo).toBe('Vorher');
  expect(result.assetIds).toEqual(['asset_tx','asset_tx_2']);
  expect(result.deleteRollback).toMatch(/zurückgerollt.*unbekannte Abhängigkeit/i);
  expect(result.activeVariantId).toBeNull();
  expect(result.variantRollback).toMatch(/zurückgerollt.*Unbekannte aktive Variante/i);
  expect(result.history).toEqual([]);
});
