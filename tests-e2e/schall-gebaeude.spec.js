import { test, expect } from '@playwright/test';

// Schall der LW-WP mit Gebäuden: Abschirmung hinter einem hohen Gebäude, Reflexion vor einer Wand, Schalter und Speichern
test('dist: Gebäude schirmen den Schall der LW-WP ab', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.lwWpMitGebaeudenSetzen === 'function');
  const r = await page.evaluate(() => {
    clearNetz(); setGebaeude([]);
    const lat0 = 52.08, lng0 = 8.0, mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
    const poly = (x, y, w, h) => [[y - h / 2, x - w / 2], [y - h / 2, x + w / 2], [y + h / 2, x + w / 2], [y + h / 2, x - w / 2]]
      .map(([n, o]) => L.latLng(lat0 + n * mLat, lng0 + o * mLng));
    const neu = (id, name, x, y, w, h, og) => { const g = addGebaeude({ id, name, baujahr: 1975, coords: poly(x, y, w, h), skipAutoCreate: true }); g.stockwerke = String(og); g.waerme = '100'; return g; };
    neu(1, 'Riegel', 0, 30, 80, 12, 5);       // 15 m hoher Riegel nördlich der Geräte
    neu(2, 'Nord', 0, 80, 20, 10, 2);         // im Schatten des Riegels
    neu(3, 'Süd', 0, -80, 20, 10, 2);         // freie Sicht
    document.getElementById('lwwp-leistung').value = 2000;
    placeLwWpAt(L.latLng(lat0, lng0));
    const io = Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o]));
    const iso = lwWpIsophonen().get(45);
    const radius = winkel => { const p = iso[Math.round(winkel / 360 * iso.length) % iso.length]; return Math.hypot(p.ost, p.nord); };
    const mit = { nord: io.Nord, sued: io['Süd'], rNord: radius(0), rSued: radius(180), hinweis: document.getElementById('lwwp-schall-modell').textContent };
    // tieffrequentes Herstellerspektrum: hinter dem Riegel weniger Abschirmung
    lwWpSpektrumSetzen('90 88 80 72 65 58 50 40');
    const tief = Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o])).Nord;
    const spektrumFeld = document.getElementById('lwwp-spektrum').value;
    mit.tiefDaempf = tief.frei - tief.pegel;
    mit.spektrumFeld = spektrumFeld;
    const gespSpektrum = _buildProjectData().lwWp.spektrum;
    mit.gespSpektrum = gespSpektrum;
    lwWpSpektrumSetzen('');
    lwWpMitGebaeudenSetzen(false);
    const io2 = Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o]));
    const ohne = { nord: io2.Nord.pegel, sued: io2['Süd'].pegel, cb: document.getElementById('lwwp-schall-gebaeude').checked };
    const gespeichert = _buildProjectData();
    clearLwWp(); _loadProject(gespeichert);
    return { mit, ohne, nachLaden: lwWpMitGebaeuden() };
  });
  // Hinter dem Riegel deutlich leiser, auf der freien Seite unverändert (± Reflexion am Riegel)
  expect(r.mit.nord.frei - r.mit.nord.pegel).toBeGreaterThan(10);
  expect(r.mit.sued.pegel).toBeGreaterThanOrEqual(r.mit.sued.frei - 0.01);
  expect(r.mit.sued.pegel - r.mit.sued.frei).toBeLessThan(3);
  expect(r.mit.rNord).toBeLessThan(r.mit.rSued * 0.7);
  expect(r.mit.hinweis).toContain('Abschirmung');
  expect(r.mit.tiefDaempf).toBeLessThan(r.mit.nord.frei - r.mit.nord.pegel);
  expect(r.mit.tiefDaempf).toBeGreaterThan(5);
  expect(r.mit.spektrumFeld).toBe('90 88 80 72 65 58 50 40');
  expect(r.mit.gespSpektrum).toEqual([90, 88, 80, 72, 65, 58, 50, 40]);
  // Ohne Gebäude: Freifeld wie bisher
  expect(r.ohne.nord).toBeCloseTo(r.mit.nord.frei, 0);
  expect(r.ohne.cb).toBe(false);
  expect(r.nachLaden).toBe(false);
  expect(pageErrors).toEqual([]);
});
