import { test, expect } from '@playwright/test';

// Netzverluste und Gebäudewerte gehen in den Lastgang ein: ändern sie sich, wird der Lastgang
// automatisch neu gerechnet — sonst beruhen Deckungsanteile auf einem veralteten Stand.
test('dist: Lastgang folgt Netz- und Gebäudeänderungen ohne manuelles Neurechnen', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.glBerechnenJetzt === 'function' && typeof window.autoGenerateNetz === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520], [52.0798, 8.0024, 450, 210]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 971 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'mfh'; g.flaeche = w * 6;
    });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '971';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
  });
  const stand = () => page.evaluate(() => ({
    zeit: window.systemState.berechnetAm, gesamt: window.systemState.gesamtMwhMitNV,
    verlust: window._netzAnnualLossMWh, veraltet: lastgangVeraltet(),
  }));
  const frisch = () => page.evaluate(async () => { await glBerechnenJetzt(); return window.systemState.gesamtMwhMitNV; });
  const start = await stand();
  expect(start.veraltet).toBe(false);

  // Netz neu rechnen ohne Änderung: kein unnötiges Neurechnen des Lastgangs
  await page.evaluate(() => recalcNetz());
  await page.waitForTimeout(1500);
  expect((await stand()).zeit).toBe(start.zeit);

  // Dämmung des Netzes schlechter: höhere Verluste landen ohne Zutun im Lastgang
  await page.evaluate(() => { document.getElementById('netz-u-wert').value = 0.4; recalcNetz(); });
  await page.waitForFunction(z => window.systemState.berechnetAm !== z, start.zeit, { timeout: 15000 });
  const nachU = await stand();
  expect(nachU.verlust).toBeGreaterThan(start.verlust);
  expect(nachU.veraltet).toBe(false);
  expect(nachU.gesamt).toBeCloseTo(await frisch(), 6);

  // Gebäude aus der Berechnung genommen (Wärmebedarf 0): Lastgang folgt
  const vorGeb = (await stand()).zeit;
  await page.evaluate(() => { window.gebaeude.find(g => g.id === 974).waerme = '0'; updateTotals(); });
  await page.waitForFunction(z => window.systemState.berechnetAm !== z, vorGeb, { timeout: 15000 });
  const nachGeb = await stand();
  expect(nachGeb.gesamt).toBeLessThan(nachU.gesamt - 300);
  expect(nachGeb.gesamt).toBeCloseTo(await frisch(), 6);
  expect(pageErrors).toEqual([]);
});
