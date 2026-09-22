// Browser-Test gegen den Singlefile-Build: PV-Ausbau im Bestand auf der Karte.
// Zwei Bestandstrafos, je zwei PV-Anlagen per Kabel dran, eine NAP. Der
// Kartenschieber schaltet Anlage für Anlage zu; der Trafo mit der großen
// Anlage muss zuerst kippen.
import { expect, test } from '@playwright/test';

test('dist: Kartenschieber schaltet PV zu und färbt die Bestandstrafos', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());

  await page.goto('/');
  await page.waitForFunction(() => typeof window.pvAusbauKarteOeffnen === 'function');

  await page.evaluate(() => {
    const mk = (type, lat, lng, props, schicht, name) =>
      window.createAsset(type, lat, lng, { props, schicht, name });
    const nap = mk('NAP', 52.0000, 8.0000, {}, 'bestand', 'NAP');
    const t1  = mk('Trafo', 52.0010, 8.0010, { leistungKVA: 250 }, 'bestand', 'Trafo Nord');
    const t2  = mk('Trafo', 51.9990, 8.0010, { leistungKVA: 630 }, 'bestand', 'Trafo Süd');
    const pv = [
      mk('PV', 52.0015, 8.0020, { leistungKWp: 40 },  'bestand',      'PV Bestand'),
      mk('PV', 52.0018, 8.0030, { leistungKWp: 500 }, 'entscheidung', 'PV Halle'),
      mk('PV', 51.9985, 8.0020, { leistungKWp: 120 }, 'entscheidung', 'PV Schule'),
      mk('PV', 51.9982, 8.0030, { leistungKWp: 80 },  'entwicklung',  'PV Neubau'),
    ];
    const kanten = [
      [nap, t1], [nap, t2],
      [t1, pv[0]], [t1, pv[1]], [t2, pv[2]], [t2, pv[3]],
    ].map(([u, v], i) => ({ id: 'e' + i, u: u.id, v: v.id, msLevel: u.type === 'NAP' }));
    window.stromEdges.push(...kanten);

    const N = 8760, arr = new Float32Array(N);
    for (let i = 0; i < N; i++) arr[i] = 60 + 30 * Math.sin((i % 24) / 24 * Math.PI * 2 - 1.8);
    window.elQuartierH = arr;
    window.setViewMode?.('analyse');
    window.pvaBuildAnalyseSection?.();
    window.setAnalyseSection?.('pva');
    document.getElementById('pva-nap-einsp').value = '600';
    window.pvBerechneAlle();
    window.pvaSetView('abb6');
  });

  // Einstieg aus Abb. 6
  await page.locator('#pva-chart-rueck [data-ausbau="karte"]').click();
  const bar = page.locator('#pv-ausbau-karte');
  await expect(bar).toBeVisible();

  // Start = heutiger Stand: nur die Bestandsanlage
  const start = await page.evaluate(() => window.pvAusbauKarteStand());
  expect(start.idx).toBe(1);
  expect(start.n).toBe(4);
  expect(start.kwp).toBe(40);

  // Voll ausgebaut: Trafo Nord (250 kVA, 540 kWp) ist überlastet
  await bar.locator('[data-pak="idx"]').fill('4');
  const voll = await page.evaluate(() => window.pvAusbauKarteStand());
  expect(voll.kwp).toBe(740);
  const nord = voll.trafos.find(t => t.name === 'Trafo Nord');
  const sued = voll.trafos.find(t => t.name === 'Trafo Süd');
  expect(nord.stufe).toBe('ueber');
  expect(nord.quote).toBeGreaterThan(sued.quote);
  await expect(bar).toContainText('Fällig');
  await expect(bar).toContainText('Trafo Nord');
  await expect(page.locator('.leaflet-marker-icon span', { hasText: '%' }).first()).toBeVisible();

  await page.screenshot({ path: 'test-results/pv-ausbau-karte.png' });

  await bar.locator('[data-pak="zu"]').click();
  await expect(bar).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
