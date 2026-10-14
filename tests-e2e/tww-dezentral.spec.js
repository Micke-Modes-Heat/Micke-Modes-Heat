import { test, expect } from '@playwright/test';

// Trinkwarmwasser dezentral: Netz im Sommer aus — kein TWW-Sockel, keine Sommerlast, weniger Netzverluste;
// die Einstellung wird mit dem Projekt gespeichert.
test('dist: TWW dezentral schaltet das Netz außerhalb der Heizperiode ab', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.glBerechnenJetzt === 'function' && typeof window.autoGenerateNetz === 'function');
  const kenn = () => page.evaluate(() => {
    const ss = window.systemState;
    let sommer = 0; for (let h = 181 * 24; h < 243 * 24; h++) sommer += ss.lastgangKw[h];
    return { gesamt: ss.gesamtMwhMitNV, nutz: ss.nutzwaerme ?? ss.nutzwaermeMwh, verlust: ss.netzverlustMwh, sommer: sommer / 1000, tww: ss.twwDezentral };
  });
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520], [52.0798, 8.0024, 450, 210]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 931 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'mfh'; g.flaeche = w * 6;
    });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '931';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
  });
  const vor = await kenn();
  expect(vor.sommer).toBeGreaterThan(0);
  expect(vor.tww).toBeFalsy();

  await page.evaluate(async () => { document.getElementById('gl-tww-dezentral').checked = true; glTwwDezentralUi(); await glBerechnenJetzt(); });
  const nach = await kenn();
  expect(nach.tww.ausTage).toBeGreaterThan(30);
  expect(nach.sommer).toBeLessThan(vor.sommer * 0.05);
  expect(nach.verlust).toBeLessThan(vor.verlust);
  expect(nach.gesamt).toBeLessThan(vor.gesamt);
  expect(nach.tww.twwMwh).toBeGreaterThan(0);
  await expect(page.locator('#gl-tww-dezentral-info')).toContainText('Tagen aus');

  // Projekt speichern und laden: Einstellung bleibt erhalten
  const an = await page.evaluate(() => { const p = _buildProjectData(); document.getElementById('gl-tww-dezentral').checked = false; _loadProject(p); return document.getElementById('gl-tww-dezentral').checked; });
  expect(an).toBe(true);
  expect(pageErrors).toEqual([]);
});
