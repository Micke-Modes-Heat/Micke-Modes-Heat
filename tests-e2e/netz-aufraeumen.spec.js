import { test, expect } from '@playwright/test';

const aufbau = async (page, pos, namen) => page.evaluate(([pos, namen]) => {
  clearNetz(); setGebaeude([]);
  const poly = (lat, lng) => [L.latLng(lat - .00006, lng - .0001), L.latLng(lat - .00006, lng + .0001), L.latLng(lat + .00006, lng + .0001), L.latLng(lat + .00006, lng - .0001)];
  pos.forEach(([la, ln], i) => { const g = addGebaeude({ id: 961 + i, name: namen[i], baujahr: 1975, coords: poly(la, ln), skipAutoCreate: true }); g.waerme = '300'; g.heizlast = '150'; g.nutzung = 'mfh'; });
  populateZentraleSelect(); document.getElementById('netz-zentrale').value = '961';
  setNetworkLocked(false);
}, [pos, namen]);

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzAufraeumen === 'function' && typeof window.autoGenerateNetz === 'function');
});

// Läuft ein Anschluss ein Stück auf einer anderen Leitung mit, wird er dort angeschlossen, wo er sie verlässt
test('dist: doppelt verlegtes Stück wird zusammengelegt', async ({ page }) => {
  await aufbau(page, [[52.0800, 8.0000], [52.0800, 8.0020], [52.0800, 8.0040], [52.0806, 8.0030]], ['Z', 'A', 'B', 'C']);
  const r = await page.evaluate(() => {
    autoGenerateNetz({ strategy: 'quick' });
    const A = netzEdges.find(e => e.u === 964 || e.v === 964);
    const other = A.u === 964 ? A.vNode : A.uNode;
    const B = netzEdges.find(e => e !== A && (e.u === other.id || e.v === other.id));
    const lb = B.layer.getLatLngs();
    const fern = B.u === other.id ? lb[lb.length - 1] : lb[0];
    const t = 40 / other.pt.distanceTo(fern);
    const P = L.latLng(other.pt.lat + (fern.lat - other.pt.lat) * t, other.pt.lng + (fern.lng - other.pt.lng) * t);
    const geb = A.u === 964 ? A.uNode : A.vNode;
    const pts = A.u === 964 ? [geb.pt, L.latLng(52.0806, P.lng), P, other.pt] : [other.pt, P, L.latLng(52.0806, P.lng), geb.pt];
    A.waypoints = pts.slice(1, -1); A.layer.setLatLngs(pts); A.hitLayer.setLatLngs(pts);
    recalcNetz();
    const vor = netzWorkspaceStatus().parallel.length;
    const n = doppelVerlegungenAufloesen();
    const v = window._waermeNetzValidation;
    return { vor, n, nach: netzWorkspaceStatus().parallel.length, zyklen: v.cycleEdges, getrennt: v.disconnectedConsumerIds.length };
  });
  expect(r).toEqual({ vor: 1, n: 1, nach: 0, zyklen: 0, getrennt: 0 });
});

// Strang, der über einen Umweg versorgt wird, bekommt einen eigenen Abgang aus der Heizzentrale
test('dist: eigener Abgang aus der Heizzentrale', async ({ page }) => {
  await aufbau(page, [[52.0800, 8.0000], [52.0830, 8.0030], [52.0790, 8.0003]], ['Z', 'N', 'S']);
  const r = await page.evaluate(() => {
    addNetzEdge(961, 962); addNetzEdge(962, 963); recalcNetz();
    const laenge = () => Math.round(netzEdges.reduce((s, e) => s + e.length, 0));
    const vor = laenge();
    const kante = netzEdges.find(e => [e.u, e.v].includes(962) && [e.u, e.v].includes(963));
    const ok = netzAbgangAusZentrale(kante);
    const v = window._waermeNetzValidation;
    return { ok, vor, nach: laenge(), direkt: netzEdges.some(e => [e.u, e.v].includes(961) && [e.u, e.v].includes(963)), zyklen: v.cycleEdges, getrennt: v.disconnectedConsumerIds.length };
  });
  expect(r.ok).toBe(true);
  expect(r.direkt).toBe(true);
  expect(r.nach).toBeLessThan(r.vor);
  expect(r.zyklen).toBe(0);
  expect(r.getrennt).toBe(0);
});

// Leitungen ohne Abnehmer (Stummel, gelöschte Gebäude) werden erkannt und mit „Netz aufräumen“ entfernt
test('dist: tote Leitungen werden angezeigt und entfernt', async ({ page }) => {
  await aufbau(page, [[52.0800, 8.0000], [52.0800, 8.0020], [52.0805, 8.0010]], ['Z', 'A', 'X']);
  const r = await page.evaluate(() => {
    addNetzEdge(961, 962); addNetzEdge(962, 963); recalcNetz();
    // Gebäude X verliert seinen Wärmebedarf in allen Jahren → seine Leitung versorgt niemanden
    const x = gebaeude.find(g => g.id === 963); x.waerme = '0'; x.heizlast = '0'; recalcNetz();
    const tot = toteLeitungen(false).length;
    const warnung = document.getElementById('netz-topology-warning')?.textContent || '';
    const res = netzAufraeumen();
    return { tot, warnung, res, kanten: netzEdges.length };
  });
  expect(r.tot).toBe(1);
  expect(r.warnung).toContain('ohne Abnehmer');
  expect(r.res.tote).toBe(1);
  expect(r.kanten).toBe(1);
});
