// Netz-Arbeitsbereich: Status, Rückgängig/Wiederholen, Modusanleitung mit Esc, Kartenfenster schließen.
import { expect, test } from '@playwright/test';

test('dist: Netz-Arbeitsbereich zeigt Status und macht Netzänderungen rückgängig', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzRueckgaengig === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const polygon = (lat, lng) => [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004),
      L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)];
    [[961, 'Zentrale', 8], [962, 'Haus A', 8.001], [963, 'Haus B', 8.002]].forEach(([id, name, lng]) => {
      const g = addGebaeude({ id, name, baujahr: 2000, coords: polygon(52.08, lng), skipAutoCreate: true });
      g.heizlast = '100'; g.waerme = '200';
    });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '961';
    toggleThermSpeicherPanel?.();
    openNetzWorkspace('create');
    await createQuickWaermeNetz();
  });
  await expect(page.locator('#therm-speicher-panel')).toBeHidden();
  await expect(page.locator('#na-schritt-3')).toHaveClass(/offen/);
  await expect(page.locator('#netz-workspace-status')).toContainText('2 von 2 Gebäuden angeschlossen');
  await expect(page.locator('#btn-netz-undo')).toBeEnabled();
  const n = await page.evaluate(() => window.netzEdges.length);

  // Leitung zu einem Gebäude löschen → Status meldet den fehlenden Anschluss
  await page.evaluate(() => window.netzEdges.find(e => e.u === 963 || e.v === 963).hitLayer.fire('contextmenu'));
  await expect(page.locator('#netz-workspace-status .na-punkt.offen')).toHaveCount(1);
  await expect(page.locator('#na-sum-3')).toHaveText('1 offen');
  await expect(page.locator('#netz-verlauf-text')).toHaveText('Zuletzt: Gebäudeanschluss entfernt');

  // Anschlussmodus: Anleitung in der Sidebar, Esc beendet
  await page.locator('#netz-workspace-status .na-punkt.offen').click();
  await expect(page.locator('#netz-workspace-modus')).toBeVisible();
  await expect(page.locator('.netz-rewire-handle.offen')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#netz-workspace-modus')).toBeHidden();

  // Strg+Z holt die Leitung zurück, Strg+Y löscht sie wieder, nochmals Strg+Z
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.netzEdges.length)).toBe(n);
  await expect(page.locator('#btn-netz-redo')).toBeEnabled();
  await page.keyboard.press('Control+y');
  await expect.poll(() => page.evaluate(() => window.netzEdges.length)).toBe(n - 1);
  await page.locator('#btn-netz-undo').click();
  await expect.poll(() => page.evaluate(() => window.netzEdges.length)).toBe(n);
  await expect(page.locator('#netz-workspace-status')).toContainText('2 von 2 Gebäuden angeschlossen');

  // Neu berechnen zeigt einen Vergleich; „Bisheriges Netz behalten“ stellt das alte Netz wieder her
  await page.evaluate(() => window.netzEdges.find(e => e.u === 963 || e.v === 963).hitLayer.fire('contextmenu'));
  await expect.poll(() => page.evaluate(() => window.netzEdges.length)).toBe(n - 1);
  await page.evaluate(() => { openNetzWorkspace('create'); netzAufbauGewaehlt('quick'); netzStrukturWaehlen(85); });
  await page.locator('#btn-netz-berechnen').click();
  await expect(page.locator('#netz-vorschau')).toBeVisible();
  await expect(page.locator('#netz-vorschau')).toContainText('Trassenlänge');
  await page.locator('#netz-vorschau button', { hasText: 'Bisheriges Netz behalten' }).click();
  await expect(page.locator('#netz-vorschau')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.netzEdges.length)).toBe(n - 1);
});
