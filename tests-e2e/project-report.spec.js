import {test,expect} from '@playwright/test';

test('dist: Projektbericht prüft Daten und erzeugt eine bearbeitbare Vorschau',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.openProjectReportWizard==='function');
  await page.evaluate(()=>{
    window.gebaeude.splice(0,window.gebaeude.length,
      {id:101,name:'Schule Nord',nutzung:'schule',baujahr:1970,flaeche:1000,waerme:120,heizlast:90},
      {id:102,name:'Büro Süd',nutzung:'buero',baujahr:1990,flaeche:500,waerme:80,heizlast:50},
    );
    window.setNetzEdges?.([
      {u:'zentrale',v:101,length:100,lossKW_annual:0.4,utilizationPct:70,pruned:false},
      {u:101,v:102,length:50,lossKW_annual:0.2,utilizationPct:105,pruned:false},
    ]);
    window._dispatchEnergy={lwwp:{waermeMwh:206,elMwh:60}};
    window.variantResults.base={label:'Basisdaten',erzeugung:206,netzverluste:6,investGes:500000,jkGes:30000,wgkNum:12.5,co2GesH:20,eeAnteil:80};
    window.openProjectReportWizard();
  });

  const wizard=page.locator('#project-report-wizard');
  await expect(wizard).toBeVisible();
  await expect(wizard).toContainText('Automatischen Projektbericht erstellen');
  await expect(wizard).toContainText('Ein Leitungsabschnitt weist eine berechnete Auslastung über 100 % auf');
  await page.locator('#pr-title').fill('Testbericht Quartier');
  await page.locator('#pr-map').uncheck();

  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Vorschau erstellen'}).click();
  const report=await popupPromise;
  await report.waitForLoadState('domcontentloaded');
  await expect(report.locator('h1')).toHaveText('Testbericht Quartier');
  await expect(report.locator('body')).toContainText('Luft-WP');
  await expect(report.locator('body')).toContainText('Variantenvergleich');
  await expect(report.locator('.chart-bar').first()).toBeVisible();
  await expect(report.locator('[contenteditable="true"]').first()).toBeVisible();
  await expect(report.getByRole('button',{name:'Drucken / PDF'})).toBeVisible();
  await report.locator('#report-custom-summary').fill('Eigene Zusammenfassung für den Kunden.');
  await expect.poll(()=>page.evaluate(()=>window._projectReportDraft?.customSummary)).toBe('Eigene Zusammenfassung für den Kunden.');
  const savedDraft=await page.evaluate(()=>window._buildProjectData().projectReportDraft);
  expect(savedDraft).toMatchObject({title:'Testbericht Quartier',includeMap:false,customSummary:'Eigene Zusammenfassung für den Kunden.'});
});
