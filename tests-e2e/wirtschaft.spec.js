import { test, expect } from '@playwright/test';

// Wirtschaftlichkeit: Betrachtungsumfang „nur Wärmeerzeugung“ und gleiche Investition in Annuitäten- und Barwertrechnung
test('dist: Wirtschaftlichkeit ohne Netzkosten und Barwert mit denselben Bausteinen', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.glBerechnenJetzt === 'function' && typeof window.wirtUmfangSetzen === 'function');

  const result = await page.evaluate(async () => {
    clearNetz();
    setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00005, lng - .00005), L.latLng(lat - .00005, lng + .00005), L.latLng(lat + .00005, lng + .00005), L.latLng(lat + .00005, lng - .00005)];
    [[52.080, 8.000, 900, 420], [52.081, 8.002, 600, 280], [52.082, 8.001, 1200, 520]].forEach(([la, ln, w, h], i) => {
      const g = addGebaeude({ id: 961 + i, name: 'Geb ' + (i + 1), baujahr: 2000, coords: poly(la, ln), skipAutoCreate: true });
      g.waerme = String(w); g.heizlast = String(h);
    });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '961';
    setNetworkLocked(false);
    autoGenerateNetz({ strategy: 'quick' });
    document.getElementById('lwwp-leistung').value = 600;
    placeLwWpAt(L.latLng(52.0802, 8.0008));
    await glBerechnenJetzt();
    const lesen = () => {
      calcWirtschaftPanel();
      const zahl = sel => parseFloat(document.querySelector(sel)?.textContent.replace(/\./g, '').replace(',', '.'));
      return {
        invest: zahl('.wirt-kpi:nth-child(3) b'),
        npvInvest: zahl('.wirt-npv-werte div:first-child b'),
        wgk: window._lastWgk,
        netz: window._wirtErgebnis.bausteine.some(b => b.id === 'waermenetz'),
      };
    };
    const gesamt = lesen();
    wirtUmfangSetzen(true);
    const erzeugung = lesen();
    const knopf = document.querySelector('.wirt-umfang button.active')?.dataset.umfang;
    const gespeichert = _buildProjectData();
    wirtUmfangSetzen(false);
    _loadProject(gespeichert);
    await new Promise(r => setTimeout(r, 0));
    return { gesamt, erzeugung, knopf, gespeichertFlag: gespeichert.economicScenario.values.nurErzeugung, nachLaden: window._wirtOhneNetz,
      knopfNachLaden: document.querySelector('.wirt-umfang button.active')?.dataset.umfang };
  });

  expect(result.gesamt.netz).toBe(true);
  expect(result.erzeugung.netz).toBe(false);
  expect(result.erzeugung.invest).toBeLessThan(result.gesamt.invest);
  expect(result.erzeugung.wgk).toBeLessThan(result.gesamt.wgk);
  // Barwertrechnung übernimmt dieselbe Erstinvestition
  expect(result.gesamt.npvInvest).toBe(result.gesamt.invest);
  expect(result.erzeugung.npvInvest).toBe(result.erzeugung.invest);
  expect(result.knopf).toBe('erzeugung');
  expect(result.gespeichertFlag).toBe(true);
  expect(result.nachLaden).toBe(true);
  expect(result.knopfNachLaden).toBe('erzeugung');
  expect(pageErrors).toEqual([]);
});
