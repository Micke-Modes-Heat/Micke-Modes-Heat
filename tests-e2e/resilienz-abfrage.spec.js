// Abnahme des Resilienz-Abfrage-Moduls in der gebauten Einzeldatei:
// Abfragedatei erzeugen → über den Datei-Dialog wieder einlesen → Ergebnis.
// Prüft die Kette, die die Unit-Tests nicht abdecken (JSZip, Download,
// Datei-Dialog, Panel-Render).
import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test('Resilienz-Abfrage: erzeugen, einlesen, auswerten', async ({ page }, testInfo) => {
  const fehler = [];
  page.on('pageerror', e => fehler.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.raPanelToggle === 'function');

  await page.evaluate(() => window.raPanelToggle());
  const panel = page.locator('#resilienz-abfrage-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('MMH-RESILIENZ-ABFRAGE v2');

  await panel.locator('input[type="text"]').first().fill('E2E-Liegenschaft');

  const dl = page.waitForEvent('download');
  await panel.getByRole('button', { name: /Abfragedatei erzeugen/ }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^Resilienzabfrage_E2E-Liegenschaft_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const pfad = join(testInfo.outputDir, 'abfrage.xlsx');
  await download.saveAs(pfad);

  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: /Ausgefüllte Abfragedatei einlesen/ }).click();
  await (await chooser).setFiles(pfad);

  await expect(panel).toContainText('Ergebnis der Auswertung');
  await expect(panel).toContainText('Klasse (Vorschlag)');
  await expect(panel).toContainText('Anforderungstexte');
  await expect(panel).toContainText('Offene Punkte');
  await expect(panel).toContainText('Quelle: abfrage.xlsx');
  // Die unausgefüllte Vorlage trägt die typischen Funktionen und lauter offene Punkte
  await expect(panel).toContainText('Funktionen (9)');
  await expect(panel.locator('input[type="text"]').first()).toHaveValue('E2E-Liegenschaft');

  // Der Klassenvorschlag bleibt in der Oberfläche änderbar
  await panel.locator('select').first().selectOption('B');
  await expect(panel).toContainText('geändert');

  const dlJson = page.waitForEvent('download');
  await panel.getByRole('button', { name: /Anforderungen als JSON/ }).click();
  expect((await dlJson).suggestedFilename()).toMatch(/^Resilienzanforderungen_.*\.json$/);

  expect(fehler).toEqual([]);
});

test('Übernahme in den Blackout-Modus stuft die zugeordneten Gebäude ein', async ({ page }) => {
  const fehler = [];
  page.on('pageerror', e => fehler.push(String(e)));
  page.on('dialog', d => d.accept());   // Sicherheitsabfrage vor dem Überschreiben
  await page.goto('/');
  await page.waitForFunction(() => typeof window.raPanelToggle === 'function');

  // Zwei Gebäude und eine bereits eingelesene Abfrage vorbereiten
  await page.evaluate(() => {
    window.gebaeude.push({ id: 901, name: 'Geb 12', nutzung: 'kaserne', lat: 50, lng: 8, poly: null });
    window.gebaeude.push({ id: 902, name: 'Geb 30', nutzung: 'kantine', lat: 50, lng: 8, poly: null });
    window.raRestoreState({
      meta: { lieg: 'X' }, quelle: 'test.xlsx',
      daten: {
        kennung: 'MMH-RESILIENZ-ABFRAGE v1', version: 1, fehler: [],
        allgemein: { lieg: 'X', zustaendig: 'Kdo' },
        szenarien: [{ id: 'S4', name: 'n-1', relevant: 'nein', dauer: '', herkunft: '' }],
        funktionen: [
          { id: 'F01', name: 'Führung', geb: 'Geb 12', sz: { S2: 1 }, autarkie_h: 336, pk: 10,
            klasse: 'A', klasse_vorschlag: 'A', herkunft: 'vorgegeben' },
          // Schreibweise abweichend — die Zuordnung ignoriert Groß-/Kleinschreibung
          { id: 'F02', name: 'Küche', geb: 'geb 30', sz: { S2: 1 }, autarkie_h: 72, pk: null,
            klasse: 'C', klasse_vorschlag: 'C', herkunft: 'vorgegeben' },
          // Klasse D und ein Gebäude, das es nicht gibt → keine Einstufung
          { id: 'F03', name: 'Lager', geb: 'Geb 99', sz: {}, autarkie_h: 0, pk: null,
            klasse: 'D', klasse_vorschlag: 'D', herkunft: 'vorgegeben' },
        ],
        bestand: {}, rueckmeldung: {},
      },
    });
  });

  await page.evaluate(() => window.raPanelToggle());
  const panel = page.locator('#resilienz-abfrage-panel');
  await expect(panel).toContainText('2 von 3 Funktionen');
  await panel.getByRole('button', { name: /Gebäude im Blackout-Modus einstufen/ }).click();

  expect(await page.evaluate(() => window.gebaeude.filter(g => g.notstrom).map(g => [g.name, g.notstrom.klasse])))
    .toEqual([['Geb 12', 'A'], ['Geb 30', 'C']]);
  expect(fehler).toEqual([]);
});
