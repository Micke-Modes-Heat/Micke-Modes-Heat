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
    const mk = (type, lat, lng, props, schicht, name, baujahr) =>
      window.createAsset(type, lat, lng, { props, schicht, name, baujahr });
    const nap = mk('NAP', 52.0000, 8.0000, {}, 'bestand', 'NAP');
    const t1  = mk('Trafo', 52.0010, 8.0010, { leistungKVA: 250 }, 'bestand', 'Trafo Nord');
    const t2  = mk('Trafo', 51.9990, 8.0010, { leistungKVA: 630 }, 'bestand', 'Trafo Süd');
    const pv = [
      mk('PV', 52.0015, 8.0020, { leistungKWp: 40 },  'bestand',      'PV Bestand'),
      mk('PV', 52.0018, 8.0030, { leistungKWp: 500 }, 'entscheidung', 'PV Halle'),
      mk('PV', 51.9985, 8.0020, { leistungKWp: 120 }, 'entscheidung', 'PV Schule'),
      mk('PV', 51.9982, 8.0030, { leistungKWp: 80 },  'entwicklung',  'PV Neubau'),
    ];
    // Neubaugebiet: eigener Trafo (zu klein geplant), PV ab 2030, Wärmepumpen
    const tn  = mk('Trafo', 51.9975, 8.0000, { leistungKVA: 160 }, 'entwicklung', 'Trafo Neubaugebiet', 2028);
    const pvn = mk('PV', 51.9970, 7.9990, { leistungKWp: 300 }, 'entwicklung', 'PV Neubaugebiet', 2030);
    const wp  = mk('WP', 51.9972, 8.0005, { leistungKW: 90 }, 'entwicklung', 'WP Neubaugebiet', 2029);
    const kanten = [
      [nap, t1], [nap, t2],
      [t1, pv[0]], [t1, pv[1]], [t2, pv[2]], [t2, pv[3]],
      [nap, tn], [tn, pvn], [tn, wp],
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
  expect(start.n).toBe(5);
  expect(start.kwp).toBe(40);
  // Beschlussreife: Bestand, dann A in die Reserve; die große Halle (Trafo Nord zu klein) nicht
  expect(start.klassen['PV Bestand']).toBe('bestand');
  expect(start.klassen['PV Schule']).toBe('A');
  expect(['B', 'C']).toContain(start.klassen['PV Halle']);
  // Neubau: 160 kVA reichen für 300 kWp nicht — Überlastung 2030, Empfehlung größer
  const neu = start.auslegung.find(x => x.name === 'Trafo Neubaugebiet');
  expect(neu.jahrUeber).toBe(2030);
  expect(neu.empfKva).toBeGreaterThan(160);
  expect(['jetzt-groesser', 'spaeter']).toContain(neu.urteil);

  // Voll ausgebaut: Trafo Nord (250 kVA, 540 kWp) ist überlastet
  await bar.locator('[data-pak="modus"]').selectOption('schicht');
  await bar.locator('[data-pak="idx"]').fill('5');
  const voll = await page.evaluate(() => window.pvAusbauKarteStand());
  expect(voll.kwp).toBe(1040);
  const nord = voll.trafos.find(t => t.name === 'Trafo Nord');
  const sued = voll.trafos.find(t => t.name === 'Trafo Süd');
  expect(nord.stufe).toBe('ueber');
  expect(nord.quote).toBeGreaterThan(sued.quote);
  await expect(bar).toContainText('Fällig');
  await expect(bar).toContainText('Trafo Nord');
  await expect(page.locator('.leaflet-marker-icon span', { hasText: '%' }).first()).toBeVisible();

  await page.screenshot({ path: 'test-results/pv-ausbau-karte.png' });

  // Auswertung: Beschlussreife und Neubau-Auslegung
  await bar.locator('[data-pak="modus"]').selectOption('beschluss');
  await bar.locator('[data-pak="auswertung"]').click();
  await expect(bar).toContainText('Beschlussreife');
  await expect(bar).toContainText('Auslegung Neubau-Trafos');
  await expect(bar).toContainText('Trafo Neubaugebiet');
  await expect(bar).toContainText('Barwert');
  await page.screenshot({ path: 'test-results/pv-ausbau-karte-auswertung.png' });

  await bar.locator('[data-pak="zu"]').click();
  await expect(bar).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
