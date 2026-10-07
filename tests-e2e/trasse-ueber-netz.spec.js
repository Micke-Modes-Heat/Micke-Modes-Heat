// Haupttrasse bearbeiten, während schon ein Netz darüber liegt: Klicks auf eine Leitung setzen Trassenpunkte.
import { expect, test } from '@playwright/test';

test('dist: Trasse zeichnen trotz vorhandenem Netz — Klick auf eine Leitung öffnet kein Leitungsfenster', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.createQuickWaermeNetz === 'function');
  const punkt = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    setTrassePoints([L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0060)]);
    setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }]);
    const polygon = (lat, lng) => [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004),
      L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)];
    [[991, 'Zentrale', 52.0797, 8.0000], [992, 'Haus', 52.0797, 8.0055]].forEach(([id, name, lat, lng]) => {
      const g = addGebaeude({ id, name, baujahr: 2000, coords: polygon(lat, lng), skipAutoCreate: true });
      g.heizlast = '100'; g.waerme = '200';
    });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '991';
    await createQuickWaermeNetz();   // danach ist der Bearbeitungsmodus der Leitungen aktiv
    map.setView(L.latLng(52.0800, 8.0030), 18, { animate: false });
    setNetzEditMode(true);
    const kante = window.netzEdges.find(e => !e.pruned && e.layer.getLatLngs().some(p => p.lng > 8.004));
    kante.hitLayer.fire('click', { latlng: L.latLng(52.0800, 8.0030), originalEvent: new MouseEvent('click') });   // Leitung ausgewählt → Ziehpunkt sichtbar
    closeEdgePopup();
    const p = map.latLngToContainerPoint(L.latLng(52.0800, 8.0030));
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, kanten: window.netzEdges.length };
  });
  expect(punkt.kanten).toBeGreaterThan(0);
  const handleVorher = await page.evaluate(() => window.netzEdges.some(e => e.midMarker && map.hasLayer(e.midMarker)));
  await page.evaluate(() => toggleDrawTrasse('waerme'));
  const handleNachher = await page.evaluate(() => window.netzEdges.some(e => e.midMarker && map.hasLayer(e.midMarker)) || window.netzEdges.some(e => (e.waypointMarkers || []).some(m => map.hasLayer(m))));
  const vorher = await page.evaluate(() => window.trassePoints.length);
  await page.mouse.click(punkt.x, punkt.y);
  const r = await page.evaluate(() => ({
    punkte: window.trassePoints.length,
    popup: getComputedStyle(document.getElementById('edge-popup') || document.body).display,
    strang: !!document.querySelector('.netz-strang-vorschlag'),
  }));
  await page.evaluate(() => { if (window.isDrawingTrasse) toggleDrawTrasse('waerme'); });
  expect(handleVorher).toBe(true);         // Ziehpunkt der Leitung lag über der Trasse
  expect(handleNachher).toBe(false);       // Trassenzeichnen beendet die Leitungsbearbeitung
  expect(r.strang).toBe(false);
  expect(r.punkte).toBe(vorher + 1);       // Klick auf die Leitung setzt einen Trassenpunkt
  expect(r.popup).toBe('none');            // und öffnet kein Leitungsfenster
});
