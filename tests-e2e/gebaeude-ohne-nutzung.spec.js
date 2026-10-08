import { test, expect } from '@playwright/test';

// Gebäude ohne Nutzung: Lastprofil-Spalte zeigt das Ersatzprofil, Hinweis wählt sie für die Sammelzuordnung aus.
test('dist: Gebäudeübersicht kennzeichnet Gebäude ohne Nutzung', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.renderGebaeudeOverview === 'function' && typeof window.addGebaeude === 'function');
  await page.evaluate(() => {
    setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat, lng), L.latLng(lat, lng + .0003), L.latLng(lat + .0002, lng + .0003), L.latLng(lat + .0002, lng)];
    const a = addGebaeude({ id: 921, name: 'Mit Nutzung', baujahr: 1980, coords: poly(52.08, 8.0), skipAutoCreate: true });
    a.nutzung = 'buero'; a.waerme = '200'; a.heizlast = '100';
    const b = addGebaeude({ id: 922, name: 'Ohne Nutzung', baujahr: 1980, coords: poly(52.081, 8.0), skipAutoCreate: true });
    b.nutzung = ''; b.waerme = '200'; b.heizlast = '100';
    setViewMode('gebaeude');
    renderGebaeudeOverview();
  });
  await expect(page.locator('#geb-ohne-nutzung')).toContainText('1 Gebäude ohne Nutzung');
  await expect(page.locator('tr[data-geb-id="922"] .geb-profile-btn.ersatz')).toHaveText('Ersatz: GHD');
  await expect(page.locator('tr[data-geb-id="921"] .geb-profile-btn.ersatz')).toHaveCount(0);
  await page.click('#geb-ohne-nutzung button');
  expect(await page.evaluate(() => window.gebaeude.filter(g => g.selected).map(g => g.id))).toEqual([922]);
  expect(pageErrors).toEqual([]);
});
