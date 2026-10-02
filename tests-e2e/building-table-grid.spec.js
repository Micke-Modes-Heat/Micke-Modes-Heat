// Gebäudeübersicht wie eine Tabellenkalkulation: markieren, gemeinsam ändern, Ausfüllkästchen, Strg+D,
// Einfügen aus Excel, Kopieren, Rückgängig, Shift+Klick auf Haken, Enter springt nach unten.
import { expect, test } from '@playwright/test';

const SPALTEN = ['gebaeudenummer', 'name', 'nutzung', 'baujahr', 'stockwerke', 'flaeche', 'waerme', 'spez', 'heizlast'];

test('dist: Gebäudetabelle lässt sich wie eine Tabellenkalkulation bearbeiten', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.renderGebaeudeOverview === 'function');
  await page.evaluate(() => {
    clearNetz(); setGebaeude([]);
    for (let i = 0; i < 6; i++) {
      const b = addGebaeude({ id: 500 + i, name: `Haus ${i + 1}`, nutzung: 'mfh', baujahr: 1960 + i, skipAutoCreate: true,
        coords: [L.latLng(52, 8 + i * .0002), L.latLng(52, 8.0001 + i * .0002), L.latLng(52.0001, 8.0001 + i * .0002), L.latLng(52.0001, 8 + i * .0002)] });
      b.flaeche = 400 + i * 10; b.stockwerke = 2; b.waerme = String(50 + i); b.heizlast = String(20 + i); b.waermeManual = true; b.heizlastManual = true;
    }
    setViewMode('gebaeude');
    window._gebSpalte = k => [...document.querySelectorAll('#geb-table-body tr')].map(tr => gebaeude.find(g => g.id === Number(tr.dataset.gebId))[k]);
  });
  // Aufsteigend nach Name: Zeile 0 = Haus 1
  await expect(page.locator('#geb-table-body tr').first()).toContainText('');
  const namen = await page.evaluate(() => window._gebSpalte('name'));
  expect(namen).toEqual(['Haus 1', 'Haus 2', 'Haus 3', 'Haus 4', 'Haus 5', 'Haus 6']);
  const zelle = (r, key) => page.locator(`#geb-table-body td.geb-zelle[data-gr="${r}"][data-gc="${SPALTEN.indexOf(key)}"]`);
  const spalte = key => page.evaluate(k => window._gebSpalte(k), key);

  // Bereich mit der Maus ziehen und Nutzung einmal für alle wählen
  const a = await zelle(0, 'nutzung').boundingBox(), b = await zelle(4, 'nutzung').boundingBox();
  await page.mouse.move(a.x + 4, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 6, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('#geb-table-body td.geb-zelle.markiert')).toHaveCount(5);
  await expect(page.locator('#geb-table-mark')).toHaveText('5 Zellen markiert');
  const typ = await page.evaluate(() => getNutzungstypen().find(t => t.id !== 'mfh').id);
  await zelle(2, 'nutzung').locator('select').selectOption(typ);
  expect(await spalte('nutzung')).toEqual([typ, typ, typ, typ, typ, 'mfh']);

  // Ausfüllkästchen: Baujahr aus Zeile 0 bis Zeile 3 ziehen
  await page.keyboard.press('Escape');
  await zelle(0, 'baujahr').locator('input').click();
  const griff = await zelle(0, 'baujahr').locator('.geb-fuell').boundingBox();
  const ziel = await zelle(3, 'baujahr').boundingBox();
  await page.mouse.move(griff.x + 3, griff.y + 3); await page.mouse.down();
  await page.mouse.move(griff.x + 3, ziel.y + ziel.height / 2, { steps: 10 }); await page.mouse.up();
  expect(await spalte('baujahr')).toEqual([1960, 1960, 1960, 1960, 1964, 1965]);

  // Strg+D: Heizlast aus Zeile 1 in Zeile 2 und 3
  await zelle(1, 'heizlast').locator('input').click();
  await zelle(3, 'heizlast').locator('input').click({ modifiers: ['Shift'] });
  await zelle(1, 'heizlast').locator('input').focus();
  await page.keyboard.press('Control+d');
  expect(await spalte('heizlast')).toEqual(['20', '21', '21', '21', '24', '25']);

  // Einfügen aus Excel mit deutschen Zahlen, danach Rückgängig
  await page.keyboard.press('Escape');
  await zelle(0, 'waerme').locator('input').click();
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', '100\n1.200,5\n300\n');
    document.querySelector('#geb-table-body td.geb-zelle[data-gr="0"][data-gc="6"] input')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await spalte('waerme')).toEqual(['100', '1200.5', '300', '53', '54', '55']);
  await page.locator('#geb-table-undo').click();
  expect(await spalte('waerme')).toEqual(['50', '51', '52', '53', '54', '55']);

  // Kopieren als Tabulator-Text
  const kopie = await page.evaluate(() => { gebTabelleMarkieren(500, 'name', 501, 'baujahr'); return gebTabelleKopierText(); });
  expect(kopie.split('\n')).toHaveLength(2);
  expect(kopie.split('\n')[0].split('\t')[0]).toBe('Haus 1');

  // Shift+Klick auf Haken wählt den Bereich aus
  await page.locator('#geb-table-body tr').nth(1).locator('input.geb-haken').click();
  await page.locator('#geb-table-body tr').nth(4).locator('input.geb-haken').click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => gebaeude.filter(g => g.selected).map(g => g.name))).toEqual(['Haus 2', 'Haus 3', 'Haus 4', 'Haus 5']);

  // Enter übernimmt und springt in dieselbe Spalte der nächsten Zeile
  await page.evaluate(() => { gebaeude.forEach(g => { g.selected = false; }); gebTabelleMarkierungAufheben(); renderGebaeudeOverview(); });
  await zelle(0, 'flaeche').locator('input').fill('777');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => gebaeude.find(g => g.id === 500).flaeche)).toBe(777);
  await expect.poll(() => page.evaluate(() => { const td = document.activeElement?.closest('td.geb-zelle'); return td ? `${td.dataset.gr}/${td.dataset.gc}` : ''; })).toBe('1/5');
});
