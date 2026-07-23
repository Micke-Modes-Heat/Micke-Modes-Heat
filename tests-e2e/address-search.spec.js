import { test, expect } from '@playwright/test';

test('Adresssuche zeigt Treffer und übernimmt den ersten mit Enter', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.route(/nominatim\.openstreetmap\.org\/search/, async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        lat: '52.520008',
        lon: '13.404954',
        display_name: 'Berlin, Deutschland'
      }])
    });
  });

  await page.goto('/');
  const input = page.locator('#addr-input');
  await input.fill('Berlin');

  await expect(page.locator('#addr-results')).toHaveClass(/open/);
  await expect(page.locator('#addr-results')).toContainText('Berlin, Deutschland');

  await input.press('Enter');
  await expect(input).toHaveValue('Berlin');
  await expect(page.locator('#addr-results')).not.toHaveClass(/open/);
});

test('Adresssuche meldet einen nicht erreichbaren Dienst sichtbar', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.route(/nominatim\.openstreetmap\.org\/search/, route =>
    route.fulfill({ status: 503, body: 'unavailable' }));

  await page.goto('/');
  await page.locator('#addr-input').fill('Hamburg');

  await expect(page.locator('#addr-results')).toContainText('momentan nicht erreichbar');
});
