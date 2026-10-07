import { test, expect } from '@playwright/test';

// Quartier herauslösen: Bereich auf der Karte umfahren → neue Projektdatei nur mit den Gebäuden im Bereich
test('dist: Quartier per umfahrenem Bereich als eigenes Projekt herauslösen', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.quartierHerausloesen === 'function' && typeof window.autoGenerateNetz === 'function');

  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;   // Download-Weg, kein Dateidialog
    clearNetz();
    setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00005, lng - .00005), L.latLng(lat - .00005, lng + .00005), L.latLng(lat + .00005, lng + .00005), L.latLng(lat + .00005, lng - .00005)];
    // West-Quartier (3 Gebäude) und Ost-Quartier (2 Gebäude)
    [[52.080, 8.000], [52.0805, 8.0006], [52.0810, 8.0002], [52.080, 8.004], [52.081, 8.0045]].forEach(([la, ln], i) => {
      const g = addGebaeude({ id: 971 + i, name: 'Geb ' + (i + 1), baujahr: 2000, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = '500'; g.heizlast = '200';
    });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '971';
    setNetworkLocked(false);
    autoGenerateNetz({ strategy: 'quick' });
    document.getElementById('lwwp-leistung').value = 300;
    placeLwWpAt(L.latLng(52.0802, 8.0003));
    hidePanels();
    map.fitBounds(L.latLngBounds([52.0795, 7.9995], [52.0815, 8.005]));
  });
  await page.waitForTimeout(400);

  await page.click('#btn-quartier-herausloesen');
  // Bereich um das West-Quartier klicken
  const ecken = await page.evaluate(() => [[52.0797, 7.9996], [52.0797, 8.0011], [52.0813, 8.0011], [52.0813, 7.9996]].map(([a, b]) => {
    const p = map.latLngToContainerPoint(L.latLng(a, b)); const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }));
  for (const e of ecken) { await page.mouse.click(e.x, e.y); await page.waitForTimeout(80); }
  await page.mouse.click(ecken[0].x, ecken[0].y);   // Klick auf den ersten Punkt schließt

  await expect(page.locator('.ep-modal')).toContainText('3 von 5 Gebäuden');
  await page.fill('#ep-m-input', 'West');
  await page.click('#ep-m-ok');
  await page.waitForFunction(() => !!window._qhLetzteDatei);

  const result = await page.evaluate(() => {
    const vorher = window.gebaeude.length;
    const { name, projekt } = window._qhLetzteDatei;
    _loadProject(JSON.parse(JSON.stringify(projekt)));
    return { vorher, name, ids: window.gebaeude.map(g => g.id).sort(), netzKanten: window.netzEdges.length, lwWp: window.lwWp,
      herkunft: projekt.herausgeloestAus.anzahlGebaeude, deckel: document.querySelectorAll('.qh-deckel').length };
  });

  expect(result.vorher).toBe(5);   // Liegenschaft unverändert
  expect(result.name).toMatch(/Quartier_West/);
  expect(result.ids).toEqual([971, 972, 973]);
  expect(result.netzKanten).toBe(0);
  expect(result.lwWp).toBeNull();
  expect(result.herkunft).toBe(3);
  expect(result.deckel).toBe(0);
  expect(pageErrors).toEqual([]);
});
