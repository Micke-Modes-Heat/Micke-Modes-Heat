import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

// Speichern zeigt eine Anzeige; die Datei ist kompakt (keine Einrückung) und lässt sich wieder öffnen.
test('dist: Projekt speichern zeigt eine Anzeige und schreibt kompaktes JSON', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.saveProjectAs === 'function' && typeof window.addGebaeude === 'function');
  await page.evaluate(() => {
    setGebaeude([]);
    const c = [L.latLng(52.08, 8.0), L.latLng(52.08, 8.0003), L.latLng(52.0802, 8.0003), L.latLng(52.0802, 8.0)];
    addGebaeude({ id: 941, name: 'Speichertest', baujahr: 1980, coords: c, skipAutoCreate: true });
    window.showSaveFilePicker = undefined;   // Download-Weg (ohne Dateidialog)
    window.__anzeigeGesehen = false;
    new MutationObserver(() => { if (document.querySelector('#projekt-lade-anzeige.sichtbar')) window.__anzeigeGesehen = true; })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => saveProjectAs())]);
  const text = readFileSync(await download.path(), 'utf8');
  expect(text.includes('\n  ')).toBe(false);
  const projekt = JSON.parse(text);
  expect(projekt.gebaeude.some(g => g.name === 'Speichertest')).toBe(true);
  expect(await page.evaluate(() => window.__anzeigeGesehen)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('#projekt-lade-anzeige .pla-titel')?.textContent)).toContain('Projekt wird gespeichert');
  await page.waitForFunction(() => !document.querySelector('#projekt-lade-anzeige.sichtbar'));
  expect(pageErrors).toEqual([]);
});
