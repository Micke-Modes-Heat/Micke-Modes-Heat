// Netzaufbau: Gebäude von der Straßenseite anschließen, die keinen Bogen um den Block braucht.
import { expect, test } from '@playwright/test';

test('dist: Gebäude werden von der rechten Straße angeschlossen statt über einen Bogen um den Block', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.createQuickWaermeNetz === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    // Zentrale unten rechts; Straße rechts hoch, oben quer, links wieder runter (Block dazwischen)
    setTrassePoints([
      L.latLng(52.0800, 8.0012), L.latLng(52.0830, 8.0012), L.latLng(52.0830, 8.0000), L.latLng(52.0805, 8.0000),
    ]);
    setTrasseSegments([{ start: 0, end: 3, domains: ['waerme'] }]);
    const polygon = (lat, lng, h = .00004, w = .00004) => [L.latLng(lat - h, lng - w), L.latLng(lat - h, lng + w), L.latLng(lat + h, lng + w), L.latLng(lat + h, lng - w)];
    const neu = (id, name, coords) => { const g = addGebaeude({ id, name, baujahr: 2000, coords, skipAutoCreate: true }); g.heizlast = '100'; g.waerme = '200'; };
    neu(991, 'Zentrale', polygon(52.0797, 8.0012));
    neu(992, 'Groß', polygon(52.0815, 8.0005, .0003, .00012));   // näher an der linken Straße
    neu(993, 'Klein', polygon(52.0824, 8.0005, .0001, .00008));
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '991';
    await createQuickWaermeNetz();
    const nahe = (lat, lng) => window.netzEdges.filter(e => !e.pruned && e.layer.getLatLngs().some((p, i, a) => i > 0 &&
      L.LineUtil.pointToSegmentDistance(map.latLngToLayerPoint(L.latLng(lat, lng)), map.latLngToLayerPoint(a[i - 1]), map.latLngToLayerPoint(p)) < 3)).length;
    const anGeb = id => window.netzEdges.find(e => !e.pruned && (e.u === id || e.v === id));
    const seite = id => { const e = anGeb(id); const n = e.u === id ? e.vNode : e.uNode; return n.pt.lng > 8.0006 ? 'rechts' : 'links'; };
    return {
      oben: nahe(52.0830, 8.0006), links: nahe(52.0815, 8.0000),
      seiten: [seite(992), seite(993)], getrennt: (window._waermeNetzValidation?.disconnectedConsumerIds || []).length,
      hinweis: document.getElementById('hint')?.textContent || '',
    };
  });
  expect(r.seiten).toEqual(['rechts', 'rechts']);   // beide Gebäude hängen an der rechten Straße
  expect([r.oben, r.links]).toEqual([0, 0]);       // kein Bogen über oben und links
  expect(r.getrennt).toBe(0);
  expect(r.hinweis).toContain('von der kürzeren Seite');
});
