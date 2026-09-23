import { test, expect } from '@playwright/test';

test('Felddaten-Import übernimmt Stations-Steckbrief in Asset-Eigenschaften', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.importFelddaten === 'function' && typeof window.addGebaeude === 'function');

  const gebId = await page.evaluate(() => {
    clearAssets();
    const g = addGebaeude({ name: 'Trafostation 1', baujahr: 1994 });
    ASSETS.items.push({ id: 't1', type: 'Trafo', domain: 'strom', lat: 52, lng: 8, name: 'Trafo 1a', buildingId: g.id,
      baujahr: 1994, props: { leistungKVA: '630', ukProzent: '4', netzart: 'bezug' }, massnahmen: [] });
    return g.id;
  });

  const feld = {
    gebaeude: [{ id: gebId, feldSteckbrief: { version: 1, werte: { baujahr: '1992', funktion: 'Übergabestation' },
      maengel: [{ id: 'm1', text: 'Ölwanne fehlt', prio: 'sofort', bezug: 't1' }] } }],
    elektroAssets: { items: [{ id: 't1', feldSteckbrief: { version: 1, werte: { leistungKVA: '800', ukProzent: '4,0', baujahr: '2001', ausfuehrung: 'Öl' }, zustand: 'mittel' },
      feldFotoSlots: { typenschild: ['typenschild_01.jpg'] } }] },
  };

  let meldung = '';
  page.on('dialog', async dialog => { meldung = dialog.message(); await dialog.accept(); });
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => importFelddaten());
  await (await chooser).setFiles({ name: 'projekt_felddaten.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(feld)) });
  await expect.poll(() => meldung).toContain('Felddaten importiert');

  const ergebnis = await page.evaluate(id => {
    const a = ASSETS.items.find(x => x.id === 't1');
    const g = gebaeude.find(x => x.id === id);
    return { props: a.props, baujahr: a.baujahr, zustand: a.feldSteckbrief?.zustand, slots: a.feldFotoSlots,
      gebBaujahr: g.baujahr, maengel: g.feldSteckbrief?.maengel?.length };
  }, gebId);
  expect(ergebnis).toEqual({
    props: { leistungKVA: '800', ukProzent: '4', netzart: 'bezug' },     // uk 4,0 = 4 → keine Änderung
    baujahr: 2001, zustand: 'mittel', slots: { typenschild: ['typenschild_01.jpg'] },
    gebBaujahr: 1992, maengel: 1,
  });
  expect(meldung).toContain('Trafo 1a: Bemessungsleistung 630 → 800');
  expect(meldung).toContain('Trafo 1a: Baujahr 1994 → 2001');
  expect(meldung).toContain('Trafostation 1: Baujahr 1994 → 1992');
  expect(errors).toEqual([]);
});
