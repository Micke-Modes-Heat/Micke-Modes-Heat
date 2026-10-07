import { test, expect } from '@playwright/test';

// Gezeichnete Trassenabschnitte einzeln löschen: Löschmodus (Klick) und Rechtsklick-Menü, jeweils rückgängig
test('dist: Trassenabschnitte per Löschmodus und Rechtsklick löschen und wiederherstellen', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.trasseLoeschModusUmschalten === 'function' && typeof window.setTrassePoints === 'function');

  // zwei Abschnitte: West–Ost und Süd–Nord
  await page.evaluate(() => {
    setTrassePoints([L.latLng(52.08, 7.998), L.latLng(52.08, 8.0), L.latLng(52.079, 8.002), L.latLng(52.081, 8.002)]);
    setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }, { start: 2, end: 3, domains: ['waerme'] }]);
    setTrasseCurrentSegStart(4);
    hidePanels();
    map.setView([52.08, 8.0], 17, { animate: false });
  });
  const punkt = ll => page.evaluate(([a, b]) => { const p = map.latLngToContainerPoint(L.latLng(a, b)); const r = map.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, ll);

  await page.evaluate(() => trasseLoeschModusUmschalten(true));
  const mitte1 = await punkt([52.08, 7.999]);
  await page.mouse.click(mitte1.x, mitte1.y);
  await page.waitForTimeout(150);
  let st = await page.evaluate(() => ({ seg: window.trasseSegments.length, pts: window.trassePoints.length, toast: document.querySelector('.var-toast')?.textContent || '' }));
  expect(st.seg).toBe(1);
  expect(st.pts).toBe(2);
  expect(st.toast).toContain('Trassenabschnitt gelöscht');
  await page.click('.var-toast button:has-text("Rückgängig")');
  st = await page.evaluate(() => ({ seg: window.trasseSegments.length, pts: window.trassePoints.length }));
  expect(st).toEqual({ seg: 2, pts: 4 });
  await page.evaluate(() => trasseLoeschModusUmschalten(false));

  // Rechtsklick-Menü auf dem zweiten Abschnitt (Trasse über die Ansicht eingeblendet)
  await page.evaluate(() => setTrasseVisible(true));
  const mitte2 = await punkt([52.08, 8.002]);
  await page.mouse.click(mitte2.x, mitte2.y, { button: 'right' });
  await expect(page.locator('.trasse-menue')).toContainText('Trassenabschnitt');
  await page.click('.trasse-menue button:has-text("Abschnitt löschen")');
  st = await page.evaluate(() => ({ seg: window.trasseSegments.length, rest: window.trasseSegments[0] && window.trassePoints.slice(window.trasseSegments[0].start, window.trasseSegments[0].end + 1).map(p => p.lng) }));
  expect(st.seg).toBe(1);
  expect(st.rest).toEqual([7.998, 8.0]);   // der West–Ost-Abschnitt bleibt
  expect(pageErrors).toEqual([]);
});
