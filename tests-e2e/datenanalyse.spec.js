import { test, expect } from '@playwright/test';

// Datenanalyse Stufe 1: Auswertung je Wärmepumpe im Reiter „VL / COP“
test('dist: COP-Analyse je Wärmepumpe — Kennzahlen, Ansichten, Zoom und Tooltip', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.placeLwWpAt === 'function' && typeof window.wpAnalyseRender === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    for (let i = 0; i < 6; i++) { const g = addGebaeude({ id: 400 + i, name: 'D' + i, baujahr: 1975, coords: poly(52.09 + (i % 3) * 0.0006, 8 + Math.floor(i / 3) * 0.001), skipAutoCreate: true }); g.waerme = '400'; g.heizlast = '200'; g.nutzung = 'mfh'; g.flaeche = 2000; }
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '400';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    document.getElementById('lwwp-leistung').value = 500; placeLwWpAt(L.latLng(52.0899, 8.0003));
    await glBerechnenJetzt(); updateAllDeckungen(); updateTotals();
    const W = window._wpStunden?.lwwp;
    let th = 0, el = 0;
    for (let t = 0; t < 8760; t++) { th += W.th[t]; el += W.el[t]; }
    return { jaz: th / el, keys: Object.keys(window._wpStunden || {}) };
  });
  expect(r.keys).toContain('lwwp');
  expect(r.jaz).toBeGreaterThan(1.5);
  await page.evaluate(() => { toggleAnalysePanel(); saSetTab('tempvl'); });
  const wrap = page.locator('#wp-analyse');
  await expect(wrap.locator('.wpa-kpis')).toBeVisible();
  // JAZ-Kachel = Wärme / Strom der Stundenreihen
  const jazText = await wrap.locator('.wpa-kpis > div').first().locator('b').textContent();
  expect(parseFloat(jazText.replace(',', '.'))).toBeCloseTo(r.jaz, 1);
  // Tooltip im Verlauf
  const canvas = page.locator('#wpa-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await expect(wrap.locator('.wpa-tip')).toBeVisible();
  await expect(wrap.locator('.wpa-tip')).toContainText('COP');
  // Zoom per Aufziehen → Zeitraum ist nicht mehr das ganze Jahr
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(wrap.locator('.wpa-zeit b')).not.toHaveText('ganzes Jahr');
  // Doppelklick → wieder ganzes Jahr
  await page.locator('#wpa-canvas').dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(wrap.locator('.wpa-zeit b')).toHaveText('ganzes Jahr');
  // alle Ansichten rendern ohne Fehler; kälteste Woche wählbar
  for (const a of ['kennlinie', 'carpet', 'monate', 'dauer', 'verlauf']) {
    await wrap.locator('.wpa-ansicht .viz-btn', { hasText: { kennlinie: 'Kennlinie', carpet: 'Tag × Stunde', monate: 'Monats-JAZ', dauer: 'Dauerlinie', verlauf: 'Verlauf' }[a] }).click();
    await expect(wrap.locator('.wpa-ansicht .viz-btn.active')).toHaveCount(1);
  }
  await wrap.locator('.wpa-zeit select').first().selectOption('kalt');
  await expect(wrap.locator('.wpa-zeit b')).not.toHaveText('ganzes Jahr');
  // Einzel-WP-Chip
  await wrap.locator('.wpa-chips .viz-btn', { hasText: 'Luft-WP' }).click();
  await expect(wrap.locator('.wpa-chips .viz-btn.active')).toContainText('Luft-WP');
  expect(pageErrors).toEqual([]);
});
