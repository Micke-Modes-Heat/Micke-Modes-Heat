// Leitung mit freier Ecke abseits der Straße: Ecke greifen und zurück an die Straße ziehen, Doppelklick entfernt sie.
import { expect, test } from '@playwright/test';

test('dist: freie Ecke einer Leitung lässt sich greifen, zurückziehen und per Doppelklick entfernen', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.autoGenerateNetz === 'function');
  const px = await page.evaluate(() => {
    clearNetz(); setGebaeude([]);
    setTrassePoints([L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0060)]);
    setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }]);
    const polygon = (lat, lng) => [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004), L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)];
    [[981, 'Zentrale', 52.0797, 8.0000], [982, 'Haus', 52.0797, 8.0058]].forEach(([id, name, lat, lng]) => {
      const g = addGebaeude({ id, name, baujahr: 2000, coords: polygon(lat, lng), skipAutoCreate: true }); g.heizlast = '100'; g.waerme = '200';
    });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '981';
    autoGenerateNetz({ strategy: 'trasse', anschluesseOptimieren: false });
    openNetzWorkspace('edit');
    setNetzEditMode(false);
    map.fitBounds(L.latLngBounds([52.0790, 7.9995], [52.0815, 8.0065]), { animate: false });
    const r = map.getContainer().getBoundingClientRect();
    const p = ll => { const q = map.latLngToContainerPoint(L.latLng(...ll)); return { x: r.left + q.x, y: r.top + q.y }; };
    return { leitung: p([52.0800, 8.0030]), feld: p([52.0810, 8.0030]), strasse: p([52.0800, 8.0040]) };
  });
  const ziehen = async (von, nach) => {
    await page.mouse.move(von.x, von.y); await page.mouse.down();
    await page.mouse.move((von.x + nach.x) / 2, (von.y + nach.y) / 2, { steps: 4 });
    await page.mouse.move(nach.x, nach.y, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(450);
  };
  const zustand = () => page.evaluate(() => {
    const e = window.netzEdges.find(k => { const l = k.layer.getLatLngs().map(p => p.lng); return !k.pruned && Math.min(...l) < 8.001 && Math.max(...l) > 8.005; });
    const maxAb = e ? Math.max(...e.layer.getLatLngs().map(p => Math.abs(p.lat - 52.08) * 110540)) : null;
    return { ecken: e?.routingViaPoints?.length ?? -1, maxAbstandM: maxAb, hinweis: document.getElementById('hint')?.textContent || '' };
  });
  // 1) Leitung ins Feld ziehen (90 m abseits der Straße) → freie Ecke
  await ziehen(px.leitung, px.feld);
  const frei = await zustand();
  // 2) Die Ecke greifen und zurück an die Straße ziehen → folgt wieder der Straße
  await ziehen(px.feld, px.strasse);
  const zurueck = await zustand();
  // 3) Doppelklick auf die Ecke entfernt sie
  await page.mouse.dblclick(px.strasse.x, px.strasse.y);
  await page.waitForTimeout(300);
  const entfernt = await zustand();
  expect(frei.ecken).toBe(1);
  expect(frei.maxAbstandM).toBeGreaterThan(80);
  expect(frei.hinweis).toContain('abseits der Straßen');
  expect(zurueck.ecken).toBe(1);
  expect(zurueck.maxAbstandM).toBeLessThan(5);
  expect(entfernt.ecken).toBe(0);
});
