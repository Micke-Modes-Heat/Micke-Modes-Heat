import { test, expect } from '@playwright/test';

// Beim Öffnen einer Projektdatei erscheint eine Ladeanzeige, die nach dem Laden wieder verschwindet.
test('dist: Projekt öffnen zeigt eine Ladeanzeige', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window._buildProjectData === 'function' && typeof window.addGebaeude === 'function');
  const projekt = await page.evaluate(() => {
    setGebaeude([]);
    const c = [L.latLng(52.08, 8.0), L.latLng(52.08, 8.0003), L.latLng(52.0802, 8.0003), L.latLng(52.0802, 8.0)];
    addGebaeude({ id: 911, name: 'Ladetest', baujahr: 1980, coords: c, skipAutoCreate: true });
    const p = _buildProjectData();
    setGebaeude([]);
    return JSON.stringify(p);
  });
  await page.evaluate(() => {
    window.__anzeigeGesehen = false;
    new MutationObserver(() => { if (document.querySelector('#projekt-lade-anzeige.sichtbar')) window.__anzeigeGesehen = true; })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.setInputFiles('#import-file', { name: 'ladetest.json', mimeType: 'application/json', buffer: Buffer.from(projekt) });
  await page.waitForFunction(() => (window.gebaeude || []).some(g => g.id === 911));
  await page.waitForFunction(() => !document.querySelector('#projekt-lade-anzeige.sichtbar'));
  expect(await page.evaluate(() => window.__anzeigeGesehen)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('#projekt-lade-anzeige .pla-titel')?.textContent)).toContain('ladetest.json');
  expect(pageErrors).toEqual([]);
});
