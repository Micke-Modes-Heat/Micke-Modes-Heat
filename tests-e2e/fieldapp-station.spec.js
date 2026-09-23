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
  page.on('dialog', dialog => dialog.accept());
  await page.setViewportSize({ width: 412, height: 860 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto(pathToFileURL(resolve('dist/feldapp.html')).href);

  await page.locator('#json-input').setInputFiles({ name: 'projekt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PROJEKT)) });
  await expect(page.locator('#screen-map')).toHaveClass(/active/);
  await expect(page.locator('#map-chips')).toContainText('Stationen');

  // Station ist als Ganzes antippbar, nicht die einzelnen Assets
  const label = page.locator('.building-label-inner.station');
  await expect(label).toHaveCount(1);
  await expect(label.locator('.st-badge')).toContainText('%');
  await label.click({ force: true });
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await expect(page.locator('#sheet-head')).toContainText('2 Trafos · 2× 630 kVA');
  await expect(page.locator('#st-flow .st-tile')).toHaveCount(5);   // Gebäude, SA, 2 Trafos, NSHV

  // Trafo 1a: Vorbelegung aus der Planung, Nutzungsdauer, bedingte Felder
  await page.locator('.st-tile', { hasText: 'Trafo 1a' }).click();
  const kva = page.locator('[data-st-feld="leistungKVA"]');
  await expect(kva).toHaveValue('630');
  await expect(kva).toHaveClass(/vorschlag/);
  await expect(page.locator('[data-st-nd]')).toContainText('überschritten');
  await expect(page.locator('[data-st-feld="oelmengeKg"]')).toHaveCount(0);
  await page.locator('[data-st="wahl"][data-wert="Öl"]').click();
  await expect(page.locator('[data-st-feld="oelmengeKg"]')).toHaveCount(1);
  await kva.fill('800');
  await page.locator('[data-st-feld="baujahr"]').fill('2001');
  await expect(page.locator('[data-st-nd]')).toContainText('innerhalb');
  await page.locator('[data-st="zustand"][data-zustand="mittel"]').click();

  // Foto in den Platz „Typenschild“
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-st="foto"][data-kat="typenschild"]').click();
  await (await chooser).setFiles({ name: 'ts.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.slot', { hasText: 'Typenschild' }).locator('.photo-cell')).toHaveCount(1);

  // Zurück zur Übersicht: Kachel zeigt neue Werte, Mangel erfassen
  await page.locator('[data-st="zurueck"]').first().click();
  await expect(page.locator('.st-tile', { hasText: 'Trafo 1a' })).toContainText('800 kVA');
  await page.locator('#st-mangel-text').fill('Ölwanne fehlt');
  await page.locator('#st-mangel-bezug').selectOption('t1');
  await page.locator('[data-st="mangel-prio"][data-wert="sofort"]').click();
  await page.locator('[data-st="mangel-add"]').click();
  await expect(page.locator('.mangel')).toContainText('Ölwanne fehlt');

  // Nach Schließen/Neuöffnen ist alles gespeichert
  await page.locator('#btn-sheet-close').click();
  await expect(page.locator('#backdrop')).not.toHaveClass(/on/);
  await expect(page.locator('#sheet')).not.toBeInViewport();       // Schließ-Animation abwarten
  await label.click({ force: true });
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await expect(page.locator('.mangel')).toHaveCount(1);
  await page.locator('.st-tile', { hasText: 'Trafo 1a' }).click();
  await expect(page.locator('[data-st-feld="leistungKVA"]')).toHaveValue('800');
  await page.locator('#btn-sheet-close').click();
  await expect(page.locator('#backdrop')).not.toHaveClass(/on/);

  // Export: Steckbrief pro Asset, Foto-Kategorie, Bericht mit Stationsakte
  await expect(page.locator('#export-badge')).toHaveText('1');
  await page.locator('#tab-export').click();
  const download = page.waitForEvent('download');
  await page.locator('#btn-export-save').click();
  const zip = await JSZip.loadAsync(readFileSync(await (await download).path()));
  const daten = JSON.parse(await zip.file('projekt_felddaten.json').async('string'));

  const t1 = daten.elektroAssets.items.find(a => a.id === 't1');
  expect(t1.feldSteckbrief.werte).toMatchObject({ leistungKVA: '800', baujahr: '2001', ausfuehrung: 'Öl' });
  expect(t1.feldSteckbrief.zustand).toBe('mittel');
  expect(t1.feldFotoInfos).toEqual([{ datei: 'foto_01_typenschild.jpg', kategorie: 'typenschild' }]);
  expect(zip.file(`${t1.feldFotoOrdner}/foto_01_typenschild.jpg`)).toBeTruthy();
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
  for (let i = 0; i < 25; i++) {
    if ((await page.locator('#tour-title').textContent()).includes('Stationsakte')) break;
    const schritt = await page.locator('#tour-step').textContent();
    await page.locator('#tour-next').click();
    await expect(page.locator('#tour-step')).not.toHaveText(schritt);   // Schritt ist async
  }
  await expect(page.locator('#tour-title')).toContainText('Stationsakte');
  await expect(page.locator('#st-flow .st-tile')).toHaveCount(5);   // Gebäude, SA, 2 Trafos, NSHV
  expect(errors).toEqual([]);
});

test('Feld-App: ohne lokalen Speicher reagiert „Projekt laden“ und erklärt das Problem', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { return { open() { throw new DOMException('denied', 'SecurityError'); } }; } });
  });
  await page.goto(pathToFileURL(resolve('dist/feldapp.html')).href);
  await expect(page.locator('#origin-warning')).toContainText('Speichern ist hier nicht möglich');
  const chooser = page.waitForEvent('filechooser', { timeout: 3000 });
  await page.locator('#btn-load').click();
  await chooser;
});
