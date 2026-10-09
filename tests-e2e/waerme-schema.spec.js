import { test, expect } from '@playwright/test';

// Wärme-Schemata: Netzschema (Strangplan) und Heizzentralen-Schema, auch mit zwei Zentralen am selben Netz
test('dist: Netzschema und Heizzentralen-Schema werden aus dem Netz erzeugt', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.wsToggle === 'function' && typeof window.hzHinzufuegen === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    const pos = [];
    for (let i = 0; i < 6; i++) pos.push([52.0900 + (i % 3) * 0.0006, 8.0000 + Math.floor(i / 3) * 0.0010]);
    for (let i = 0; i < 6; i++) pos.push([52.0800 + (i % 3) * 0.0006, 8.0000 + Math.floor(i / 3) * 0.0010]);
    pos.forEach(([la, ln], i) => { const g = addGebaeude({ id: 100 + i, name: (i < 6 ? 'N' : 'S') + (i % 6 + 1), baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true }); g.waerme = '400'; g.heizlast = '200'; g.nutzung = 'mfh'; });
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '100';
    // eine Zentrale
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    const n1 = wsNetzDaten();
    const geb1 = n1.knoten.filter(k => k.typ === 'geb').length;
    // zwei Zentralen
    hzHinzufuegen(); hzSetzen(0, 106); hzUmbenennen(0, 'HZ Süd');
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    document.getElementById('lwwp-leistung').value = 900; placeLwWpAt(L.latLng(52.0801, 8.0003));
    await glBerechnenJetzt(); updateAllDeckungen();
    const n2 = wsNetzDaten();
    const nord = wsZentraleDaten(100), sued = wsZentraleDaten(106);
    hidePanels(); wsToggle(); wsAnsicht('netz');
    const svgNetz = !!document.querySelector('#ws-canvas svg');
    wsAnsicht('zentrale'); wsZentrale(106);
    const svgHz = document.querySelector('#ws-canvas svg')?.textContent || '';
    return {
      geb1, zentralen1: n1.knoten.filter(k => k.typ === 'zentrale').length,
      geb2: n2.knoten.filter(k => k.typ === 'geb').length, zentralen2: n2.knoten.filter(k => k.typ === 'zentrale').length,
      kuppel2: n2.kuppel.length, kantenOhneDn: n2.kanten.filter(e => !e.dnMax).length,
      nordAbg: nord.abgaenge.reduce((s, a) => s + a.gebaeude, 0), suedAbg: sued.abgaenge.reduce((s, a) => s + a.gebaeude, 0),
      suedErz: sued.erzeuger.map(e => e.key), nordErz: nord.erzeuger.map(e => e.key),
      kuppelHz: sued.kuppel.length, svgNetz, svgHzLwwp: svgHz.includes('Luft'), svgHzKuppel: svgHz.includes('Verbindungsleitung'),
    };
  });
  expect(r.zentralen1).toBe(1);
  expect(r.geb1).toBe(11);          // alle Gebäude außer der Zentrale
  expect(r.zentralen2).toBe(2);
  expect(r.geb2).toBe(10);
  expect(r.kuppel2).toBe(1);
  expect(r.kantenOhneDn).toBe(0);
  expect(r.nordAbg).toBe(5);
  expect(r.suedAbg).toBe(5);
  expect(r.suedErz).toContain('lwwp');
  expect(r.nordErz).not.toContain('lwwp');
  expect(r.kuppelHz).toBe(1);
  expect(r.svgNetz).toBe(true);
  expect(r.svgHzLwwp).toBe(true);
  expect(r.svgHzKuppel).toBe(true);
  await expect(page.locator('#ws-panel')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
