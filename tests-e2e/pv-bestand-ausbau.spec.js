// Browser-Test gegen den Singlefile-Build: Abb. 6 „PV-Ausbau im Bestand".
// Prüft die Verdrahtung Schieber → Rückspeisekurve → Auslastung/Treppe/Lösungswege.
import { expect, test } from '@playwright/test';

test('dist: PV-Ausbau-Schieber zeigt, wann der Bestand ertüchtigt werden muss', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());

  await page.goto('/');
  await page.waitForFunction(() => typeof window.pvBerechneAlle === 'function');

  await page.evaluate(() => {
    const N = 8760, arr = new Float32Array(N);
    for (let i = 0; i < N; i++) arr[i] = 150 + 80 * Math.sin((i % 24) / 24 * Math.PI * 2 - 1.8);
    window.elQuartierH = arr;
    window._pvAnalyse.pvMaxKwpOverride = 1200;
    window._pvAnalyse.bestandTrafoKva = 400;
    window.setViewMode?.('analyse');
    window.pvaBuildAnalyseSection?.();
    window.setAnalyseSection?.('pva');
    document.getElementById('pva-nap-einsp').value = '500';
    document.getElementById('pva-sk').value = '20000';
    window.pvBerechneAlle();
    window.pvaSetView('abb6');
  });

  const box = page.locator('#pva-chart-rueck [data-ausbau="chart"]');
  await expect(box.locator('svg')).toBeVisible();

  const pv = page.locator('#pva-chart-rueck [data-ausbau="pv"]');
  const satz = page.locator('#pva-chart-rueck [data-ausbau="satz"]');

  // Kleiner Ausbau: der Bestand trägt
  await pv.fill('100');
  await expect(satz).toContainText('der Bestand trägt das');
  await expect(page.locator('#pva-chart-rueck [data-ausbau="wege"]')).toContainText('Bestand genügt');

  // Voller Ausbau: Trafo und NAP reißen, beide Lösungswege stehen zur Wahl
  await pv.fill('1200');
  await expect(satz).toContainText('trägt das nicht mehr');
  const treppe = page.locator('#pva-chart-rueck [data-ausbau="treppe"]');
  await expect(treppe).toContainText('Trafoleistung Bestand reißt');
  await expect(treppe).toContainText('Einspeisezusage NAP reißt');
  const wege = page.locator('#pva-chart-rueck [data-ausbau="wege"]');
  await expect(wege).toContainText('Bestand ertüchtigen');
  await expect(wege).toContainText('Erzeugungsnetz');

  await page.locator('#pva-chart-rueck').screenshot({ path: 'test-results/pv-bestand-ausbau.png' });
  expect(pageErrors).toEqual([]);
});
