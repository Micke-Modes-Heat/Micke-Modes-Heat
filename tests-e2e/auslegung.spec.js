import { test, expect } from '@playwright/test';

// L1: Auslegungsspitze bei Normaußentemperatur — Kachel, Spitzenkessel-Mindestleistung, Gutachten-Daten
test('dist: Auslegungsspitze aus Normheizlasten bestimmt Kachel, Spitzenkessel und Gutachten', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.placeLwWpAt === 'function' && typeof window.auslegungsSpitzeAktuell === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    for (let i = 0; i < 8; i++) { const g = addGebaeude({ id: 300 + i, name: 'A' + i, baujahr: 1975, coords: poly(52.09 + (i % 4) * 0.0006, 8 + Math.floor(i / 4) * 0.001), skipAutoCreate: true }); g.waerme = '400'; g.heizlast = '200'; g.nutzung = 'mfh'; g.flaeche = 2000; }
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '300';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' });
    await glBerechnenJetzt();
    document.getElementById('lwwp-leistung').value = 900; placeLwWpAt(L.latLng(52.0899, 8.0003));
    await glBerechnenJetzt(); updateAllDeckungen(); updateTotals();
    const a = auslegungsSpitzeAktuell();
    const minCop = parseFloat(document.getElementById('lwwp-min-cop')?.value) || 0;
    const tVLK = a.vorlauf + 273.15, cop = Math.min(tVLK / (tVLK - (a.normAt + 273.15)) * (parseFloat(document.getElementById('lwwp-guetegrad')?.value) || 0.42), 8);
    const gesichert = minCop > 0 && cop < minCop ? 0 : 900 * wpLeistungsFaktor('lwwp', a.normAt, a.vorlauf);
    const d = ggWaermeDaten();
    return {
      a, pMax: window.systemState.pMaxKw, gesichert,
      wert: document.getElementById('tot-hl').textContent, lbl: document.getElementById('tot-hl-lbl').textContent,
      sub: document.getElementById('tot-hl-sub').textContent,
      pKwAuto: window._wirtPKw?._autoGk ?? null, keys: window._dispatchActiveKeys,
      gutachtenKw: d.lastgang.auslegung?.kw,
    };
  });
  expect(r.a.quelle).toBe('heizlast');
  expect(r.a.anzahl).toBe(8);
  expect(r.a.summeHeizlastKw).toBeCloseTo(1600, 3);
  expect(r.a.kw).toBeCloseTo(1600 * r.a.glf + r.a.verlustKw, 3);
  expect(r.a.kw).toBeGreaterThanOrEqual(r.pMax);
  // Kachel: Auslegungsspitze, darunter Lastgang und Σ Gebäude
  expect(r.lbl).toBe('Auslegungsspitze (kW)');
  expect(r.wert).toBe(Math.round(r.a.kw).toLocaleString('de-DE'));
  expect(r.sub).toContain('Lastgang');
  // Spitzenkessel (Wirtschaftlichkeit) mindestens so groß wie die Lücke im Auslegungsfall
  expect(r.a.kw - r.gesichert).toBeGreaterThan(0);
  expect(r.pKwAuto).toBeGreaterThanOrEqual(r.a.kw - r.gesichert - 0.01);
  expect(r.keys).toContain('_autoGk');
  // Gutachten liest dieselbe Auslegungsspitze
  expect(r.gutachtenKw).toBeCloseTo(r.a.kw, 6);
  expect(pageErrors).toEqual([]);
});
