import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('Feld-App: Einzeldatei startet unter file://, Demo-Karte und IndexedDB funktionieren', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto(pathToFileURL(resolve('dist/feldapp.html')).href);

  await expect(page.locator('#screen-import')).toHaveClass(/active/);
  await expect(page.locator('h1')).toContainText('Feldapp');
  await page.locator('#btn-demo').click();
  await expect(page.locator('#screen-map')).toHaveClass(/active/);
  await expect(page.locator('.building-label-inner').first()).toBeVisible({timeout:10_000});
  await expect(page.locator('#tour-title')).toContainText('Willkommen');

  const storage = await page.evaluate(async () => {
    const names = typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map(database => database.name)
      : [];
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    return {protocol: location.protocol, dbNames:names, hasLeaflet:typeof L === 'object', hasZip:typeof JSZip === 'function', duplicateIds};
  });
  expect(storage.protocol).toBe('file:');
  expect(storage.hasLeaflet).toBe(true);
  expect(storage.hasZip).toBe(true);
  expect(storage.duplicateIds).toEqual([]);
  if (storage.dbNames.length) expect(storage.dbNames).toContain('feldapp-db');
  expect(errors).toEqual([]);
});
