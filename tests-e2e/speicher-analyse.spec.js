import { test, expect } from '@playwright/test';

// Speicheranalyse: Reiter „Speicher“ rechnet Kurz- und Langzeitspeicher gegen den Lauf ohne Speicher,
// zeigt Füllstand und Größenvariation und übernimmt die Auswahl ins Wärmespeicher-Panel.
test('dist: Speicheranalyse für Kurz- und Langzeitspeicher, Übernahme ins Projekt', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.glBerechnenJetzt === 'function' && typeof window.spOeffnen === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 991 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'mfh'; g.flaeche = w * 6;
    });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '991';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    document.getElementById('lwwp-leistung').value = 500; placeLwWpAt(L.latLng(52.0801, 8.0001));
    await glBerechnenJetzt();
  });
  await page.evaluate(() => spOeffnen());
  await expect(page.locator('#sa-tab-speicher')).toBeVisible();
  await expect(page.locator('#sp-inhalt .sp-kpi')).toHaveCount(9);
  const kurz = await page.evaluate(() => { const d = spBerechnen(); return { n: d.stufen.length, kesselVermieden: d.auswahl.kw.kesselVermiedenMwh, soc: d.stunden.soc.length, ee: d.auswahl.ee, eeOhne: d.ohne.ee }; });
  expect(kurz.n).toBeGreaterThan(8);
  expect(kurz.soc).toBe(8760);
  expect(kurz.kesselVermieden).toBeGreaterThan(0);
  expect(kurz.ee).toBeGreaterThan(kurz.eeOhne);

  // Wochenansicht und Langzeitspeicher
  await page.evaluate(() => spSetAnsicht('winter'));
  await page.evaluate(() => spSetArt('lang'));
  const lang = await page.evaluate(() => { const d = spBerechnen(); return { vol: d.auswahl.vol, verlust: d.auswahl.kw.verlustMwh, rundUm: d.auswahl.param.ladeBis - d.auswahl.param.ladeVon }; });
  expect(lang.vol).toBeGreaterThan(500);
  expect(lang.rundUm).toBe(24);
  expect(lang.verlust).toBeGreaterThan(0);

  // Volumen mit Tausenderpunkt eingeben
  await page.locator('#sp-vol').fill('4.000');
  await page.locator('#sp-vol').dispatchEvent('change');
  expect(await page.evaluate(() => spBerechnen().auswahl.vol)).toBe(4000);

  // Übernahme: Wärmespeicher-Panel und Hauptberechnung nutzen den Speicher
  await page.evaluate(() => spUebernehmen());
  const uebernommen = await page.evaluate(() => ({ typ: document.getElementById('ts-typ').value, vol: +document.getElementById('ts-volumen').value, aktiv: window.thermSpeicherAktiv, speicher: !!window._thermSpeicherState }));
  expect(uebernommen).toEqual({ typ: 'saisonal', vol: 4000, aktiv: true, speicher: true });
  await expect(page.locator('#sp-hinweis')).toContainText('übernommen');
  expect(pageErrors).toEqual([]);
});
