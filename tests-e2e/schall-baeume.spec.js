import { test, expect } from '@playwright/test';

// Schall der LW-WP mit Bäumen: Bewuchsdämpfung nach DIN ISO 9613-2 Anhang A, Auswahl der Baumart, Speichern
test('dist: Bäume dämpfen den Schall der LW-WP (Bewuchs)', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.lwWpBaeumeSetzen === 'function' && typeof window.baumRestore === 'function');
  const r = await page.evaluate(() => {
    clearNetz(); setGebaeude([]);
    const lat0 = 52.08, lng0 = 8.0, mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
    const poly = (x, y, w, h) => [[y - h / 2, x - w / 2], [y - h / 2, x + w / 2], [y + h / 2, x + w / 2], [y + h / 2, x - w / 2]]
      .map(([n, o]) => L.latLng(lat0 + n * mLat, lng0 + o * mLng));
    const neu = (id, name, x, y, w, h, og) => { const g = addGebaeude({ id, name, baujahr: 1975, coords: poly(x, y, w, h), skipAutoCreate: true }); g.stockwerke = String(og); g.waerme = '100'; return g; };
    neu(2, 'Nord', 0, 100, 20, 10, 2);        // hinter dem Waldstreifen
    neu(3, 'Süd', 0, -100, 20, 10, 2);        // freie Sicht
    document.getElementById('lwwp-leistung').value = 2000;
    placeLwWpAt(L.latLng(lat0, lng0));
    lwWpAusbreitungSetzen('3d');   // Bäume wirken nur in der Ausbreitung mit Gebäuden und Bäumen
    const ort = () => Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o]));
    // dichter Streifen aus 5 versetzten Reihen (65 Bäume) nördlich der Geräte, y = 35 … 59 m
    const streifen = art => {
      const liste = [];
      for (let z = 0; z < 5; z++) for (let i = 0; i < 13; i++) {
        liste.push({ id: liste.length + 1, lat: lat0 + (35 + z * 6) * mLat, lng: lng0 + (-60 + i * 5) * mLng,
          // Laubbäume: niedrige, breite Kronen (Hecke/Gebüsch bis 4 m), damit der Strahl in Geräte-/Fensterhöhe sie trifft
          hoehe: art === 'laub' ? 4 : 12, krone: art === 'laub' ? 10 : 8, stamm: 0.3, art, quelle: 'manuell', hoeheQuelle: 'manuell' });
      }
      return liste;
    };
    const ohneBaeume = ort();
    updateLwWpDisplay();
    const leer = { info: document.getElementById('lwwp-baeume-info').textContent, knopf: getComputedStyle(document.getElementById('lwwp-baeume-osm')).display };
    baumRestore({ liste: streifen('nadel') });
    updateLwWpDisplay();   // die Anzeige zieht nach einer Baumänderung verzögert nach
    const standard = { art: lwWpBaeumeArt(), ...ort(), info: document.getElementById('lwwp-baeume-info').textContent };
    const nadel = ort();
    lwWpBaeumeSetzen('aus');
    const aus = ort();
    baumRestore({ liste: streifen('laub') });
    lwWpBaeumeSetzen('nadel');
    updateLwWpDisplay();
    const laubStandard = { ...ort(), info: document.getElementById('lwwp-baeume-info').textContent };
    lwWpBaeumeSetzen('alle');
    const laubAlle = ort();
    updateLwWpDisplay();
    const hinweis = document.getElementById('lwwp-schall-modell').textContent;
    const gespeichert = _buildProjectData();
    const gespArt = gespeichert.lwWp.baeume;
    clearLwWp(); _loadProject(gespeichert);
    const nachLaden = lwWpBaeumeArt();
    const isophone = lwWpIsophonen().get(45);
    return { leer, ohneBaeume, standard, nadel, aus, laubStandard, laubAlle, hinweis, gespArt, nachLaden, iso: !!isophone?.length };
  });
  // Ohne Projektbäume: Hinweis auf die 3D-Vorschau und Schaltfläche zum Übernehmen
  expect(r.leer.info).toContain('nur als Vorschau');
  expect(r.leer.knopf).not.toBe('none');
  // Standard „nur Nadelbäume“: Streifen aus Nadelbäumen dämpft die Gebäude dahinter, die freie Seite nicht
  expect(r.standard.art).toBe('nadel');
  expect(r.nadel.Nord.bewuchs).toBeGreaterThan(0.3);
  expect(r.nadel.Nord.pegel).toBeLessThan(r.ohneBaeume.Nord.pegel - 0.3);
  expect(r.nadel.Nord.frei).toBeCloseTo(r.ohneBaeume.Nord.frei, 1);
  expect(r.nadel['Süd'].pegel).toBeCloseTo(r.ohneBaeume['Süd'].pegel, 1);
  expect(r.standard.info).toContain('65 Bäume im Projekt, 65 davon');
  // Ausgeschaltet: wie ohne Bäume
  expect(r.aus.Nord.pegel).toBeCloseTo(r.ohneBaeume.Nord.pegel, 1);
  expect(r.aus.Nord.bewuchs || 0).toBe(0);
  // Laubbäume zählen erst mit „alle Bäume“
  expect(r.laubStandard.Nord.pegel).toBeCloseTo(r.ohneBaeume.Nord.pegel, 1);
  expect(r.laubStandard.info).toContain('keine Nadelbäume dabei');
  expect(r.laubAlle.Nord.bewuchs).toBeGreaterThan(0.3);
  expect(r.hinweis).toContain('Bewuchs');
  expect(r.gespArt).toBe('alle');
  expect(r.nachLaden).toBe('alle');
  expect(r.iso).toBe(true);
  expect(pageErrors).toEqual([]);
});
