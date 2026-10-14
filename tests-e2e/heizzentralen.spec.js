import { test, expect } from '@playwright/test';

// Zwei Heizzentralen am selben Netz: Zonen, Verbindungsleitung, Einspeisung und Übergabe; Speichern/Laden
test('dist: zwei Heizzentralen speisen in ein gemeinsames Netz ein', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.hzHinzufuegen === 'function' && typeof window.placeLwWpAt === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    const pos = [];
    for (let i = 0; i < 6; i++) pos.push([52.0900 + (i % 3) * 0.0006, 8.0000 + Math.floor(i / 3) * 0.0010]);
    for (let i = 0; i < 6; i++) pos.push([52.0800 + (i % 3) * 0.0006, 8.0000 + Math.floor(i / 3) * 0.0010]);
    pos.forEach(([la, ln], i) => { const g = addGebaeude({ id: 100 + i, name: (i < 6 ? 'N' : 'S') + (i % 6 + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true }); g.waerme = '400'; g.heizlast = '200'; g.nutzung = 'mfh'; g.flaeche = 2000; });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '100';
    hzHinzufuegen(); hzSetzen(0, 106); hzUmbenennen(0, 'HZ Süd');
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    document.getElementById('lwwp-leistung').value = 900; placeLwWpAt(L.latLng(52.0801, 8.0003));
    await glBerechnenJetzt(); updateAllDeckungen();
    const v = window._waermeNetzValidation;
    const zonen = Object.values(window._netzJeZentrale).map(z => z.gebIds.length);
    const a = heizzentralenAuswertung();
    const lwwpStandort = erzeugerStandort('lwwp');
    // Speichern und Laden
    const projekt = _buildProjectData();
    _loadProject(projekt);
    return { v, zonen, kuppel: netzEdges.filter(e => e.kuppel).length, kuppelDn: netzEdges.find(e => e.kuppel)?.dn,
      lwwpStandort, einspeisung: a && [...a.ueber.values()].map(u => Math.round(u.einspeisungMwh)),
      bilanz: a && Math.round([...a.ueber.values()].reduce((s, u) => s + u.abgabeMwh - u.aufnahmeMwh, 0)),
      geladen: { weitere: window.weitereZentralen.map(z => [z.id, z.name]), zentralen: netzZentralenIds() } };
  });
  expect(r.v.cycleEdges).toBe(0);
  expect(r.v.disconnectedConsumerIds).toEqual([]);
  expect(r.zonen).toEqual([6, 6]);
  expect(r.kuppel).toBe(1);
  expect(r.kuppelDn).toBeGreaterThan(0);
  expect(r.lwwpStandort).toBe(106);
  expect(r.einspeisung.every(x => x > 0)).toBe(true);
  expect(Math.abs(r.bilanz)).toBeLessThan(5);   // was die eine Zone abgibt, nimmt die andere auf
  expect(r.geladen.weitere).toEqual([[106, 'HZ Süd']]);
  expect(r.geladen.zentralen).toEqual([100, 106]);
  // Oberfläche: Liste in Schritt ① und Reiter „Zentralen“
  await page.evaluate(() => { toggleAnalysePanel(); saSetTab('zentralen'); });
  await expect(page.locator('#hz-analyse .hz-tab').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
