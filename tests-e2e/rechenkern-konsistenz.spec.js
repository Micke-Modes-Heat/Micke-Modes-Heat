import { test, expect } from '@playwright/test';

// Fachprüfung Rechenkern: Speicherladung je Erzeuger (JAZ, EE-Anteil, Deckung), Jahresskalierung, Monatswerte
test('dist: Speicherladung, EE-Anteil und Jahresskalierung rechnen überall gleich', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.placeLwWpAt === 'function' && typeof window.lastgangKennwerteFuerJahr === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    for (let i = 0; i < 8; i++) { const g = addGebaeude({ id: 100 + i, name: 'H' + i, baujahr: 1975, coords: poly(52.09 + (i % 4) * 0.0006, 8 + Math.floor(i / 4) * 0.001), skipAutoCreate: true }); g.waerme = '400'; g.heizlast = '200'; g.nutzung = 'mfh'; g.flaeche = 2000; }
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '100';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    document.getElementById('lwwp-leistung').value = 500; placeLwWpAt(L.latLng(52.0899, 8.0003));
    document.getElementById('gk-leistung').value = 1500; activateGasKessel();
    document.getElementById('ts-typ').value = 'gross'; document.getElementById('ts-volumen').value = 200; updateThermSpeicherDisplay();
    await glBerechnenJetzt(); updateAllDeckungen();
    const en = window._dispatchEnergy;
    const last = Object.values(en).reduce((s, e) => s + (e.waermeMwh || 0), 0);
    const jazAnzeige = parseFloat(document.getElementById('lwwp-jaz-hint')?.textContent.replace(',', '.'));
    // EE-Anteil: Fußzeile, KPI-Kachel und Variantenvergleich
    updateFooterStatus();
    cacheVariantResults();
    const varEe = (window.getVariantResults?.() || window.variantResults || {})[window.activeVariantId || 'base']?.eeAnteil ?? null;
    // Jahresskalierung: ausgeschlossenes Gebäude, Jahr ohne Änderungen → Faktor 1
    toggleAusschluss(107);
    window._basisLastgangKw = new Float32Array(8760).fill(100); window._basisYear = 2026;
    window._basisGebWaermeSumme = gebaeude.filter(g => !isExcluded(g.id)).reduce((s, g) => s + (getComputedStats(g, 2026).waerme || 0), 0);
    const jahr = lastgangKennwerteFuerJahr(2030);
    // Monatswerte: eingegebene Monate exakt, Rest bis zur Jahresmenge
    const mw = [100, null, null, null, null, null, 50, null, null, null, null, null];
    const profil = new Float32Array(8760).map((_, t) => 50 + 40 * Math.cos(2 * Math.PI * t / 8760));
    const m = glAnwendeMonatsfloor(profil, mw, 800);
    const mon = h0 => m.slice(h0[0], h0[1]).reduce((s, v) => s + v, 0) / 1000;
    return {
      lade: en.lwwp?.ladeMwh, erzeugt: en.lwwp?.erzeugtMwh, el: en.lwwp?.elMwh, jazAnzeige,
      speicher: en._thermSpeicher?.waermeMwh || 0, last, gesamt: window.systemState.gesamtMwhMitNV,
      eeFuss: window._lastEeAnteil, eeKachel: parseFloat(document.getElementById('av-kpi-ee')?.textContent), varEe,
      faktor: jahr?.faktor, jan: mon([0, 744]), jul: mon([4344, 5088]), summe: m.reduce((s, v) => s + v, 0) / 1000,
    };
  });
  // WP lädt den Speicher; JAZ in der Anzeige = erzeugte Wärme / Strom
  expect(r.lade).toBeGreaterThan(0);
  expect(r.jazAnzeige).toBeCloseTo(r.erzeugt / r.el, 1);
  // Summe der Deckung (direkt + Speicher + Kessel) = gedeckte Last
  expect(r.last).toBeCloseTo(r.gesamt, 0);
  // EE-Anteil überall gleich
  expect(Number.isFinite(r.eeFuss)).toBe(true);
  expect(r.varEe).toBeCloseTo(r.eeFuss, 1);
  expect(r.faktor).toBeCloseTo(1, 6);
  expect(r.jan).toBeCloseTo(100, 3);
  expect(r.jul).toBeCloseTo(50, 3);
  expect(r.summe).toBeCloseTo(800, 2);
  expect(pageErrors).toEqual([]);
});
