import { test, expect } from '@playwright/test';

// Variantenvergleich: grafische Ansichten aus den Kennzahlen je Variante
test('dist: grafischer Variantenvergleich mit wählbaren Ansichten', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.vgRender === 'function' && typeof window.placeLwWpAt === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 961 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'mfh'; g.flaeche = w * 6;
    });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '961';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt(); calcWirtschaftPanel(); cacheVariantResults();
    _neueVariante({ name: 'Luft-WP' });
    document.getElementById('lwwp-leistung').value = 600; placeLwWpAt(L.latLng(52.0801, 8.0001));
    await glBerechnenJetzt(); calcWirtschaftPanel(); cacheVariantResults();
    setViewMode('vergleich');
  });
  await expect(page.locator('#vergleich-grafik-wrap canvas')).toBeVisible();
  const wgk = await page.evaluate(() => vgReihen('wgk').map(r => ({ label: r.label, teile: r.teile.length, summe: r.teile.reduce((s, t) => s + t.wert, 0), wgk: r.r.wgkNum })));
  expect(wgk).toHaveLength(2);
  for (const r of wgk) { expect(r.teile).toBeGreaterThan(1); expect(r.summe).toBeCloseTo(r.wgk, 0); }
  const mix = await page.evaluate(() => vgReihen('mix').map(r => r.teile.map(t => t.key)));
  expect(mix[1]).toContain('lwwp');
  const netz = await page.evaluate(() => vgNetzWerte());
  expect(netz.achsen.length).toBe(6);
  for (const a of ['mix', 'leistung', 'co2', 'kosten', 'netz']) {
    await page.locator('#vergleich-grafik-wrap .viz-btn', { hasText: { mix: 'Erzeugermix', leistung: 'Installierte', co2: 'CO₂', kosten: 'Investition', netz: 'Kennzahlen-Netz' }[a] }).click();
    await expect(page.locator('#vergleich-grafik-wrap canvas')).toBeVisible();
  }
  await page.evaluate(() => vgAnsicht('mix'));
  await page.locator('#vergleich-grafik-wrap .vg-check input').check();
  expect(pageErrors).toEqual([]);
});
