// Haupttrasse: zwei Stränge durch Klick von orangem Punkt auf orangen Punkt verbinden.
import { expect, test } from '@playwright/test';

test('dist: Trassenstränge per Klick von Punkt zu Punkt verbinden', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.toggleDrawTrasse === 'function');
  const pos = await page.evaluate(() => {
    clearNetz();
    setTrassePoints([L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0020), L.latLng(52.0810, 8.0000), L.latLng(52.0810, 8.0020)]);
    setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }, { start: 2, end: 3, domains: ['waerme'] }]);
    map.fitBounds(L.latLngBounds([52.0795, 7.9995], [52.0815, 8.0025]), { animate: false });
    toggleDrawTrasse('waerme');
    const r = map.getContainer().getBoundingClientRect();
    const px = ll => { const p = map.latLngToContainerPoint(L.latLng(...ll)); return { x: r.left + p.x, y: r.top + p.y }; };
    return { a: px([52.0800, 8.0020]), b: px([52.0810, 8.0020]), segmente: window.trasseSegments.length };
  });
  await page.mouse.click(pos.a.x, pos.a.y);
  await page.mouse.click(pos.b.x, pos.b.y);
  const r = await page.evaluate(() => {
    const segs = window.trasseSegments, pts = window.trassePoints;
    const neu = segs[segs.length - 1];
    const runde = p => [+p.lat.toFixed(5), +p.lng.toFixed(5)];
    const out = { segmente: segs.length, von: runde(pts[neu.start]), bis: runde(pts[neu.end]) };
    if (window.isDrawingTrasse) toggleDrawTrasse('waerme');
    return out;
  });
  expect(r.segmente).toBe(pos.segmente + 1);     // neuer Verbindungsstrang
  expect(r.von).toEqual([52.08, 8.002]);         // beginnt genau am ersten orangen Punkt
  expect(r.bis).toEqual([52.081, 8.002]);        // endet genau am zweiten
});
