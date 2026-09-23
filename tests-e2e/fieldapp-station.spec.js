import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

// 1×1-PNG als Kamerabild
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const PROJEKT = {
  _feldappVersion: 1,
  gebaeude: [
    { id: 1, name: 'Verwaltung', nutzung: 'NWGB', polygon: [{ lat: 48.1374, lng: 11.5752 }, { lat: 48.1377, lng: 11.5752 }, { lat: 48.1377, lng: 11.5759 }, { lat: 48.1374, lng: 11.5759 }] },
    { id: 2, name: 'Trafostation 1', nutzung: '', baujahr: 1990, stationPreset: 'begehbarDoppel', fromKompakt: true,
      polygon: [{ lat: 48.13718, lng: 11.57685 }, { lat: 48.13730, lng: 11.57685 }, { lat: 48.13730, lng: 11.57700 }, { lat: 48.13718, lng: 11.57700 }] },
  ],
  elektroAssets: {
    items: [
      { id: 'sa', type: 'Schaltanlage', buildingId: 2, name: 'Schaltanlage 1', props: { felder: '2' } },
      { id: 't1', type: 'Trafo', buildingId: 2, name: 'Trafo 1a', baujahr: 1990, props: { leistungKVA: '630', ukProzent: '4' } },
      { id: 't2', type: 'Trafo', buildingId: 2, name: 'Trafo 1b', baujahr: 2012, props: { leistungKVA: '630', ukProzent: '4' } },
      { id: 'nshv', type: 'NSHV', buildingId: 2, name: 'NSHV 1', baujahr: 1990, props: { nennstromA: '1818', abgaenge: '10' } },
      { id: 'pv', type: 'PV', buildingId: 1, name: 'PV 1', props: {} },
    ],
    edges: [],
  },
};

test('Feld-App: Stationsakte erfassen und mit Steckbrief exportieren', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.setViewportSize({ width: 412, height: 860 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto(pathToFileURL(resolve('dist/feldapp.html')).href);

  await page.locator('#json-input').setInputFiles({ name: 'projekt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PROJEKT)) });
  await expect(page.locator('#screen-map')).toHaveClass(/active/);
  await expect(page.locator('#proj-stats')).toContainText('1 Station');

  // Station ist als Ganzes antippbar, nicht die einzelnen Assets
  const label = page.locator('.building-label-inner.station');
  await expect(label).toHaveCount(1);
  await expect(label.locator('.st-badge')).toContainText('%');
  await label.click({ force: true });
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await expect(page.locator('#sheet-head')).toContainText('2 Trafos · 2× 630 kVA');
  await expect(page.locator('.st-flow .st-tile')).toHaveCount(5);   // Gebäude, SA, 2 Trafos, NSHV

  // Trafo 1a: Vorbelegung aus der Planung, Nutzungsdauer, bedingte Felder
  await page.locator('.st-tile', { hasText: 'Trafo 1a' }).click();
  const kva = page.locator('[data-st-feld="leistungKVA"]');
  await expect(kva).toHaveValue('630');
  await expect(kva).toHaveClass(/vorschlag/);
  await expect(page.locator('[data-st-nd]')).toContainText('überschritten');
  await expect(page.locator('[data-st-feld="oelmengeKg"]')).toHaveCount(0);
  await page.locator('.st-chip', { hasText: 'Öl' }).first().click();
  await expect(page.locator('[data-st-feld="oelmengeKg"]')).toHaveCount(1);
  await kva.fill('800');
  await page.locator('[data-st-feld="baujahr"]').fill('2001');
  await expect(page.locator('[data-st-nd]')).toContainText('innerhalb');
  await page.locator('.st-chip[data-st-action="zustand"][data-wert="mittel"]').click();

  // Foto in den Platz „Typenschild“
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.st-slot', { hasText: 'Typenschild' }).locator('.st-slot-add').click();
  await (await chooser).setFiles({ name: 'ts.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.st-slot', { hasText: 'Typenschild' }).locator('.photo-cell')).toHaveCount(1);

  // Zurück zur Übersicht: Kachel zeigt Fortschritt/Zustand, Mangel erfassen
  await page.locator('[data-st-action="zurueck"]').first().click();
  await expect(page.locator('.st-tile', { hasText: 'Trafo 1a' })).toContainText('800 kVA');
  await page.locator('#st-mangel-text').fill('Ölwanne fehlt');
  await page.locator('#st-mangel-bezug').selectOption('t1');
  await page.locator('.st-chip[data-st-action="mangel-prio"][data-wert="sofort"]').click();
  await page.locator('[data-st-action="mangel-add"]').click();
  await expect(page.locator('.st-maengel-item')).toContainText('Ölwanne fehlt');

  // Nach Schließen/Neuöffnen ist alles gespeichert
  await page.locator('#sheet-head .close-btn').click();
  await expect(page.locator('#backdrop')).not.toHaveClass(/on/);
  await page.evaluate(() => { document.getElementById('sheet-body').innerHTML = ''; });
  await label.click({ force: true });
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await expect(page.locator('.st-maengel-item')).toHaveCount(1);
  await page.locator('.st-tile', { hasText: 'Trafo 1a' }).click();
  await expect(page.locator('[data-st-feld="leistungKVA"]')).toHaveValue('800');

  // Export: Steckbrief pro Asset, Foto-Platz im Dateinamen, Bericht mit Stationsakte
  await page.locator('#sheet-head .close-btn').click();
  await expect(page.locator('#backdrop')).not.toHaveClass(/on/);
  await page.evaluate(() => { navigator.canShare = undefined; });
  const download = page.waitForEvent('download');
  await page.locator('#btn-export').click();
  const zip = await JSZip.loadAsync(readFileSync(await (await download).path()));
  const daten = JSON.parse(await zip.file('projekt_felddaten.json').async('string'));

  const t1 = daten.elektroAssets.items.find(a => a.id === 't1');
  expect(t1.feldSteckbrief.werte).toMatchObject({ leistungKVA: '800', baujahr: '2001', ausfuehrung: 'Öl' });
  expect(t1.feldSteckbrief.zustand).toBe('mittel');
  expect(t1.feldFotoSlots).toEqual({ typenschild: ['typenschild_01.jpg'] });
  expect(zip.file(`${t1.feldFotoOrdner}/typenschild_01.jpg`)).toBeTruthy();
  expect(daten.elektroAssets.items.find(a => a.id === 't2').feldSteckbrief).toBeUndefined();

  const station = daten.gebaeude.find(g => g.id === 2);
  expect(station.feldSteckbrief.maengel).toMatchObject([{ text: 'Ölwanne fehlt', prio: 'sofort', bezug: 't1', bezugName: 'Trafo 1a' }]);

  const bericht = await zip.file('bericht.html').async('string');
  expect(bericht).toContain('Liegenschaftssteckbrief');
  expect(bericht).toContain('Ölwanne fehlt');
  expect(bericht).toContain('(Planung, nicht geprüft)');
  expect(bericht).not.toContain('blob:');
  expect(errors).toEqual([]);
});

test('Feld-App: Rundgang zeigt die Stationsakte', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto(pathToFileURL(resolve('dist/feldapp.html')).href);
  await page.locator('#btn-demo').click();
  await expect(page.locator('#tour-title')).toContainText('Willkommen');
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('#tour-title').textContent()).includes('Stationsakte')) break;
    const schritt = await page.locator('#tour-step').textContent();
    await page.locator('#tour-next').click();
    await expect(page.locator('#tour-step')).not.toHaveText(schritt);   // Schritt ist async
  }
  await expect(page.locator('#tour-title')).toContainText('Stationsakte');
  await expect(page.locator('.st-flow .st-tile')).toHaveCount(5);   // Gebäude, SA, 2 Trafos, NSHV
  expect(errors).toEqual([]);
});
