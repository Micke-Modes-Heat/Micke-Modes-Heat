import { test, expect } from '@playwright/test';

// Optimierung ↔ Wirtschaftlichkeit: Die übernommene Siegervariante muss dieselbe WGK, Investition und CO₂-Bilanz
// ergeben wie die Ergebniskarte der Optimierung (gleicher Strombedarf, gleiche Erzeugerleistung, gleiche Gutschrift).
test('dist: Optimierungsergebnis und übernommene Variante rechnen identisch', async ({ page }) => {
  test.setTimeout(180000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.runOptimierung === 'function' && typeof window.autoGenerateNetz === 'function');

  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520], [52.0798, 8.0024, 450, 210]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 811 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'buero'; g.flaeche = w * 6;
    });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '811';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    document.getElementById('gk-leistung').value = 800; activateGasKessel();
    hidePanels();
    await glBerechnenJetzt();
    setViewMode('optimierung');
    document.getElementById('opt-quality').value = 'schnell';
    document.querySelectorAll('[id^="opt-cand-"]').forEach(c => { c.checked = ['opt-cand-bhkw', 'opt-cand-gaskessel'].includes(c.id); });
    runOptimierung();
  });
  await page.waitForFunction(() => !window._optRunning && Array.isArray(window._optTop3Final) && window._optTop3Final.length > 0, null, { timeout: 150000, polling: 1000 });

  const opt = await page.evaluate(() => { const r = window._optTop3Final[0]; return { wgk: r.kw.wgk, invest: r.kw.investGesamt, co2: r.kw.co2ta }; });
  const hauptplanVorher = await page.evaluate(() => JSON.stringify(window.variantResults?.base?.erzeuger || []));
  await page.click('.opt-karte-erste .opt-karte-fuss button');
  await page.waitForFunction(() => (window.varianten || []).length === 1);
  const panel = await page.evaluate(async () => {
    await glBerechnenJetzt();
    calcWirtschaftPanel();
    return { wgk: window._lastWgk, invest: window._lastInvestGes, co2: window.co2EinsatzAktuell() };
  });

  expect(panel.wgk).toBeCloseTo(opt.wgk, 1);
  expect(Math.abs(panel.invest - opt.invest) / opt.invest).toBeLessThan(0.005);
  expect(Math.abs(panel.co2 - opt.co2) / opt.co2).toBeLessThan(0.005);
  // Die Kennzahlen des Hauptplans bleiben beim Übernehmen unberührt
  const hauptplanNachher = await page.evaluate(() => JSON.stringify(window.variantResults?.base?.erzeuger || []));
  expect(hauptplanNachher).toBe(hauptplanVorher);
  expect(pageErrors).toEqual([]);
});

// Wärmepumpe + Pellets mit Spitzenlastkessel, PV aus der Planung mit „PV-Strom für Wärmepumpen anrechnen“:
// jedes Konzept nur einmal, die übernommene Variante (Spitzenkessel als echter Gaskessel) rechnet wie die
// Ergebniskarte; „Nur Wärmeerzeugung“ bewertet die Ergebnisse ohne Netzkosten neu.
test('dist: Optimierung mit WP, Spitzenlastkessel und angerechnetem PV-Strom — Konzepte eindeutig, Übernahme konsistent', async ({ page }) => {
  test.setTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.runOptimierung === 'function' && typeof window.autoGenerateNetz === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520], [52.0798, 8.0024, 450, 210]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 821 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'buero'; g.flaeche = w * 6;
    });
    document.getElementById('wirt-p-gas').value = 14;
    document.getElementById('wirt-p-strom-wp').value = 22;
    document.getElementById('pv-kwp').value = 300;
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '821';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    document.getElementById('gk-leistung').value = 900; activateGasKessel();
    hidePanels();
    await glBerechnenJetzt();
    calcStromPanel();
    wirtPvWpSetzen(true);
    setViewMode('optimierung');
    document.getElementById('opt-quality').value = 'schnell';
    document.querySelectorAll('[id^="opt-cand-"]').forEach(c => { c.checked = ['opt-cand-lwwp', 'opt-cand-gaskessel', 'opt-cand-pellets'].includes(c.id); });
    runOptimierung();
  });
  await page.waitForFunction(() => !window._optRunning && Array.isArray(window._optTop3Final) && window._optTop3Final.length > 0, null, { timeout: 200000, polling: 1000 });

  const top = await page.evaluate(() => window._optTop3Final.map(r => ({ kanon: r.kanon, wgk: r.kw.wgk, pv: r.pvKwp, pvWp: r.kw.pvZuWpMwh, gasExplizit: r.config.some(c => c.key === 'gaskessel') })));
  expect(new Set(top.map(r => r.kanon)).size).toBe(top.length);
  for (const r of top) expect(r.gasExplizit).toBe(false);
  const idx = top.findIndex(r => r.kanon.includes('lwwp') && r.kanon.includes('gaskessel'));
  expect(idx).toBeGreaterThanOrEqual(0);
  // PV der Planung wird angerechnet, aber nicht verändert
  expect(top[idx].pv).toBe(300);
  expect(top[idx].pvWp).toBeGreaterThan(0);

  await page.evaluate(() => wirtUmfangSetzen(true));
  const wgkOhneNetz = await page.evaluate(k => window._optTop3Final.find(r => r.kanon === k).kw.wgk, top[idx].kanon);
  await page.evaluate(() => wirtUmfangSetzen(false));
  const wgkMitNetz = await page.evaluate(k => window._optTop3Final.find(r => r.kanon === k).kw.wgk, top[idx].kanon);
  expect(wgkOhneNetz).toBeLessThan(wgkMitNetz - 0.1);
  expect(wgkMitNetz).toBeCloseTo(top[idx].wgk, 6);

  const opt = await page.evaluate(k => { const r = window._optTop3Final.find(x => x.kanon === k); return { wgk: r.kw.wgk, invest: r.kw.investGesamt, gasKw: Math.ceil(r.autoGkPeakKw) }; }, top[idx].kanon);
  await page.locator('.opt-karte .opt-karte-fuss button').nth(idx).click();
  await page.waitForFunction(() => (window.varianten || []).length === 1);
  const panel = await page.evaluate(async () => {
    await glBerechnenJetzt();
    calcStromPanel();
    calcWirtschaftPanel();
    return { wgk: window._lastWgk, invest: window._lastInvestGes, gasKw: parseFloat(document.getElementById('gk-leistung').value),
      pv: parseFloat(document.getElementById('pv-kwp').value), autoGk: (window._dispatchActiveKeys || []).includes('_autoGk') };
  });
  expect(panel.gasKw).toBe(opt.gasKw);
  expect(panel.autoGk).toBe(false);
  expect(panel.pv).toBe(300);
  expect(Math.abs(panel.invest - opt.invest) / opt.invest).toBeLessThan(0.005);
  // PV-Strombilanz: Strommodul und Optimierer simulieren getrennt — wenige Hundertstel ct/kWh
  expect(Math.abs(panel.wgk - opt.wgk)).toBeLessThan(0.1);
  expect(pageErrors).toEqual([]);
});

// „Min. Kosten | ≥ 65 % EE“: es erscheinen nur Varianten, die die Bedingung erfüllen.
test('dist: Ziel ≥ 65 % EE zeigt nur zulässige Varianten', async ({ page }) => {
  test.setTimeout(240000);
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.runOptimierung === 'function' && typeof window.autoGenerateNetz === 'function');
  await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    [[52.080, 8.000, 900, 420], [52.0805, 8.0012, 600, 280], [52.0812, 8.0003, 1200, 520]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 851 + i, name: 'Geb ' + (i + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h); g.nutzung = 'buero'; g.flaeche = w * 6;
    });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '851';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    document.getElementById('gk-leistung').value = 900; activateGasKessel();
    hidePanels();
    await glBerechnenJetzt();
    setViewMode('optimierung');
    document.getElementById('opt-quality').value = 'schnell';
    document.querySelector('input[name="opt-ziel"][value="min-kosten-ee"]').checked = true;
    document.querySelectorAll('[id^="opt-cand-"]').forEach(c => { c.checked = ['opt-cand-lwwp', 'opt-cand-gaskessel', 'opt-cand-bhkw'].includes(c.id); });
    runOptimierung();
  });
  await page.waitForFunction(() => !window._optRunning && Array.isArray(window._optTop3Final) && window._optTop3Final.length > 0, null, { timeout: 200000, polling: 1000 });
  const ee = await page.evaluate(() => window._optTop3Final.map(r => r.kw.eeAnteil));
  expect(ee.length).toBeGreaterThan(0);
  for (const v of ee) expect(v).toBeGreaterThanOrEqual(65);
});
