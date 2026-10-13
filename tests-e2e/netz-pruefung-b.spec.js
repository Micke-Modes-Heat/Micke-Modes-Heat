import { test, expect } from '@playwright/test';

// Fachprüfung Paket B (Netz): Hausübergabestationen und Heizzentrale in den Kosten, Eingaben der CO₂-Faktoren und des
// Kostenszenarios wirken, Rücklauf nicht an die Heizkurve gekoppelt, „Aus Netzberechnung übernehmen“ mit Auslegungsspitze,
// ausgeschlossene Gebäude nicht angeschlossen, manuelle Nennweite bleibt beim Speichern erhalten
test('dist: Netz — Hausstationen, Eingaben, Netzwerte, Ausschluss, manuelle DN', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzHausstationen === 'function' && typeof window.glBerechnenJetzt === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
    for (let i = 0; i < 10; i++) {
      const g = addGebaeude({ id: 700 + i, name: 'N' + i, baujahr: 1975, coords: poly(52.09 + (i % 5) * 0.0006, 8 + Math.floor(i / 5) * 0.001), skipAutoCreate: true });
      g.waerme = '200'; g.heizlast = i < 5 ? '20' : '150'; g.nutzung = 'mfh'; g.flaeche = 1000;
    }
    const z = addGebaeude({ id: 790, name: 'HZ', baujahr: 1990, coords: poly(52.0885, 8.0005), skipAutoCreate: true });
    z.waerme = '0'; z.heizlast = '0';
    // Gebäude 709 ausgeschlossen: darf nicht angeschlossen werden
    toggleAusschluss(709);
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '790';
    setNetworkLocked(false); autoGenerateNetz({ strategy: 'quick' }); recalcNetz();
    await glBerechnenJetzt(); updateAllDeckungen(); calcWirtschaftPanel();
    const verbunden = new Set(window.netzEdges.flatMap(e => [e.u, e.v]));
    const hst = netzHausstationen();
    const bausteine = Object.fromEntries(window._wirtErgebnis.bausteine.map(b => [b.id, b.invest]));

    // CO₂-Faktor Strom über das Eingabefeld (früher vom Handler-Filter blockiert)
    const emf = document.getElementById('strom-emf');
    emf.value = '300'; emf.dispatchEvent(new Event('change', { bubbles: true }));
    const stromEmFNeu = window.stromEmF;
    emf.value = '363'; emf.dispatchEvent(new Event('change', { bubbles: true }));
    // Kostenszenario
    const ks = document.getElementById('kosten-szenario');
    ks.value = 'hoch'; ks.dispatchEvent(new Event('change', { bubbles: true }));
    const szenario = kostenSzenarioAktuell();
    ks.value = 'mittel'; ks.dispatchEvent(new Event('change', { bubbles: true }));

    // Rücklauf des Netzes ändert die Heizkurve nicht mehr
    const vl15Vorher = document.getElementById('gl-vl15').value;
    const rl = document.getElementById('netz-rl');
    rl.value = '45'; rl.dispatchEvent(new Event('change', { bubbles: true }));
    const vl15Nachher = document.getElementById('gl-vl15').value;
    rl.value = '60'; rl.dispatchEvent(new Event('change', { bubbles: true }));

    // Netzwerte übernehmen = Auslegungsspitze
    const vorgabe = netzErzeugerVorgabe();
    const ausl = auslegungsSpitzeAktuell();

    // Manuelle Nennweite übersteht Speichern/Laden des Netzes
    const e0 = window.netzEdges.find(e => e.load > 0);
    const dnAuto = e0.dn;
    e0.dn = 200; e0.dnOverride = true;
    const graph = captureWaermeNetzGraph();
    applyWaermeNetzGraph(graph);
    const e1 = window.netzEdges.find(e => (e.u === e0.u && e.v === e0.v) || (e.u === e0.v && e.v === e0.u));
    return {
      ausgeschlossenVerbunden: verbunden.has(709), hst, bausteine, stromEmFNeu, szenario, vl15Vorher, vl15Nachher,
      vorgabeKw: vorgabe.kw, auslKw: ausl?.kw, dnAuto, dnNachLaden: e1?.dn, overrideNachLaden: e1?.dnOverride,
    };
  });
  // Ausgeschlossenes Gebäude nicht im Netz; 9 Hausstationen (5 × 20 kW, 4 × 150 kW), ohne Zentrale
  expect(r.ausgeschlossenVerbunden).toBe(false);
  expect(r.hst.anzahl).toBe(9);
  expect(r.bausteine.huest).toBe(5 * 5000 + 4 * 12000);
  expect(r.bausteine.heizzentrale).toBeGreaterThan(0);
  expect(r.stromEmFNeu).toBe(300);
  expect(r.szenario).toBe('hoch');
  expect(r.vl15Nachher).toBe(r.vl15Vorher);
  expect(r.vorgabeKw).toBeCloseTo(r.auslKw, 6);
  expect(r.dnNachLaden).toBe(200);
  expect(r.overrideNachLaden).toBe(true);
  expect(r.dnAuto).not.toBe(200);
  expect(pageErrors).toEqual([]);
});
