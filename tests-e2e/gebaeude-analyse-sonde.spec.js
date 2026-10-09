import { test, expect } from '@playwright/test';

// Gebäudeübersicht: Datenanalyse mit wählbarem Kennwert/Gruppierung/Darstellung;
// Quartier sondieren: Rechteck auf der Karte → Lastgang und Kennwerte der Gebäude darin.
test('dist: Gebäudeanalyse und Quartier-Sonde', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.gaRender === 'function' && typeof window.qsToggle === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    const nutz = ['mfh', 'schule', 'verwaltung'];
    for (let i = 0; i < 12; i++) {
      const g = addGebaeude({ id: 3000 + i, name: 'Geb ' + (i + 1), baujahr: 1950 + i * 6, coords: poly(52.08 + (i % 4) * 0.0005, 8 + Math.floor(i / 4) * 0.0006), skipAutoCreate: true });
      g.nutzung = nutz[i % 3]; g.flaeche = 400 + i * 50; g.stockwerke = 2;
      g.waerme = String(80 + i * 10); g.heizlast = String(40 + i * 5);
    }
    await glBerechnenJetzt();
    setViewMode('gebaeude');
  });
  await expect(page.locator('#geb-dyn-analyse canvas')).toBeVisible();
  const box = await page.evaluate(() => { const a = gaAuswertung(); return { n: a.gesamt.n, gruppen: a.gruppen.length }; });
  expect(box).toEqual({ n: 12, gruppen: 3 });
  await page.locator('#geb-dyn-analyse select').nth(1).selectOption('baualter');
  await page.locator('#geb-dyn-analyse select').nth(2).selectOption('streu');
  await expect(page.locator('#geb-dyn-analyse')).toContainText('X-Achse');
  expect(await page.evaluate(() => gaAuswertung().gruppierung.label)).toBe('Baualtersklasse');

  // Quartier sondieren per Ziehen auf der Karte
  await page.evaluate(() => { setViewMode('karte'); window._appLeafletMap.fitBounds(L.latLngBounds([[52.0798, 7.9995], [52.0818, 8.0016]])); });
  await page.waitForTimeout(400);
  await page.evaluate(() => qsToggle());
  // Panel aus dem Weg schieben
  await page.evaluate(() => { const p = document.getElementById('quartier-sonde-panel'); p.style.left = '1000px'; p.style.top = '600px'; });
  const mb = await page.locator('#map').boundingBox();
  await page.mouse.move(mb.x + 5, mb.y + 5);
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width * 0.45, mb.y + mb.height - 5, { steps: 6 });
  await page.mouse.up();
  const d = await page.evaluate(() => { const d = qsAuswerten(); return { n: d.gebs.length, mwh: d.k.mwh, monate: d.monate.length, gzf: d.gzf }; });
  expect(d.n).toBeGreaterThan(0);
  expect(d.n).toBeLessThan(12);
  expect(d.mwh).toBeGreaterThan(0);
  expect(d.monate).toBe(12);
  await expect(page.locator('#qs-inhalt .sp-kpi')).toHaveCount(6);
  for (const a of ['dauer', 'monate', 'typtage', 'mix']) await page.evaluate(x => qsAnsicht(x), a);
  // Tabellenauswahl
  await page.evaluate(() => { window.gebaeude.forEach((g, i) => { g.selected = i < 3; }); qsAuswahlUebernehmen(); });
  expect(await page.evaluate(() => qsAuswerten().gebs.length)).toBe(3);
  expect(pageErrors).toEqual([]);
});
