// Browser-Smoke-Test gegen den Singlefile-Build (dist/index.html).
// Fängt die Fehlerklasse "Funktion X is not defined im Build" ab, die Unit-Tests
// nicht sehen: LWWP platzieren → Grundlage berechnen → Dispatch-Ergebnis prüfen.
import { test, expect } from '@playwright/test';

test('dist: LWWP platzieren, Grundlage 500 MWh, Live-Tab sichtbar, keine Konsolenfehler', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Kachel-/Netzwerkfehler (OSM-Tiles offline in CI) sind kein App-Fehler
    if (/tile|net::|ERR_|Failed to load resource/i.test(text)) return;
    consoleErrors.push(text);
  });
  // OSM-Tiles in CI gar nicht erst anfragen
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());

  await page.goto('/');
  await page.waitForFunction(() => typeof window.placeLwWpAt === 'function');

  // LWWP programmatisch platzieren (wie ein Karten-Klick)
  await page.evaluate(() => {
    placeLwWpAt(L.latLng(51.31, 9.49));
  });
  await page.waitForFunction(() => window.lwWp && window.lwWp.leistungKw > 0);

  // Grundlage: 500 MWh Gesamtverbrauch synthetisieren
  await page.evaluate(() => {
    document.getElementById('gl-gesamt').value = 500;
    glBerechnenDebounced(0);
  });
  await page.waitForFunction(() => window.systemState && window.systemState.pMaxKw > 0, null, { timeout: 30_000 });

  const state = await page.evaluate(() => ({
    pMaxKw: window.systemState.pMaxKw,
    gesamtMwh: window.systemState.gesamtMwhMitNV,
    liveTabSichtbar: (() => { const t = document.getElementById('view-tab-live'); return !!t && t.style.display !== 'none'; })(),
    pdfVersion: window.pdfjsLib?.version,
    tablistRole: document.getElementById('view-tabs')?.getAttribute('role'),
    activeTabAria: document.querySelector('.view-tab.active')?.getAttribute('aria-selected'),
  }));

  expect(state.pMaxKw).toBeGreaterThan(0);
  expect(state.gesamtMwh).toBeGreaterThan(490);
  expect(state.liveTabSichtbar).toBe(true);
  expect(state.pdfVersion).toMatch(/^5\./);
  expect(state.tablistRole).toBe('tablist');
  expect(state.activeTabAria).toBe('true');

  expect(pageErrors, 'Unbehandelte Exceptions:\n' + pageErrors.join('\n')).toHaveLength(0);
  expect(consoleErrors, 'Konsolenfehler:\n' + consoleErrors.join('\n')).toHaveLength(0);
});
