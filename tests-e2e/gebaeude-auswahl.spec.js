import { test, expect } from '@playwright/test';

// Ein ausgewähltes Gebäude lässt sich durch erneutes Anklicken wieder abwählen.
test('dist: erneuter Klick auf das ausgewählte Gebäude hebt die Auswahl auf', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.selectFromMap === 'function' && typeof window.addGebaeude === 'function');
  await page.evaluate(() => {
    setGebaeude([]);
    const c = [L.latLng(52.08, 8.0), L.latLng(52.08, 8.0003), L.latLng(52.0802, 8.0003), L.latLng(52.0802, 8.0)];
    const g = addGebaeude({ id: 901, name: 'Testgebäude', baujahr: 1980, coords: c, skipAutoCreate: true });
    g.waerme = '300'; g.heizlast = '150';
    renderList();
  });
  const ausgewaehlt = () => page.evaluate(() => !!document.querySelector('#card-901.selected'));
  await page.evaluate(() => selectFromMap(901));
  expect(await ausgewaehlt()).toBe(true);
  await page.evaluate(() => selectFromMap(901));
  expect(await ausgewaehlt()).toBe(false);
  await page.evaluate(() => selectFromMap(901));
  expect(await ausgewaehlt()).toBe(true);
  expect(pageErrors).toEqual([]);
});
