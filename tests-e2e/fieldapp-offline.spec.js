import { test, expect } from '@playwright/test';

// Über einen Server ausgeliefert (wie Netlify / GitHub Pages) ist die Feldapp
// eine installierbare App: Manifest + Service Worker. Nach dem ersten Laden muss
// sie ohne Netz wieder starten – und der Service Worker darf die Hauptapp im
// selben Ordner nicht übernehmen.
const PROJEKT = {
  projektName: 'Offline-Test',
  gebaeude: [{ id: 1, name: 'Rathaus', nutzung: 'OEB', waerme: 142, heizlast: 85,
    polygon: [[48.1374, 11.5752], [48.1377, 11.5752], [48.1377, 11.5759], [48.1374, 11.5759]] }],
};

test('Feld-App: installierbar und startet nach dem ersten Laden offline', async ({ context, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));

  await page.goto('/feldapp.html');
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const manifest = await (await fetch(document.querySelector('link[rel="manifest"]').href)).json();
    return { scope: reg.scope, manifest };
  });
  expect(new URL(sw.scope).pathname).toBe('/feldapp');
  expect(sw.manifest.start_url).toBe('./feldapp.html');
  expect(sw.manifest.display).toBe('standalone');

  // Projekt laden, solange noch Netz da ist
  await page.setInputFiles('#json-input', { name: 'projekt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PROJEKT)) });
  await expect(page.locator('#screen-map')).toHaveClass(/active/);
  await expect(page.locator('#proj-eyebrow')).toHaveText('Offline-Test');

  // Service Worker muss die Seite kontrollieren, bevor das Netz wegfällt
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#screen-import')).toHaveClass(/active/);
  await expect(page.locator('h1')).toContainText('Feldapp');
  await page.locator('#btn-continue').click();
  await expect(page.locator('#screen-map')).toHaveClass(/active/);
  await expect(page.locator('#net-tag-text')).toHaveText('OFFLINE');
  await page.locator('#tab-gebaeude').click();
  await expect(page.locator('#geb-list .list-item')).toHaveCount(1);
  await context.setOffline(false);

  // Die Hauptapp im selben Ordner bleibt vom Service Worker unberührt
  const haupt = await context.newPage();
  await haupt.goto('/');
  expect(await haupt.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await haupt.close();

  expect(errors).toEqual([]);
});
