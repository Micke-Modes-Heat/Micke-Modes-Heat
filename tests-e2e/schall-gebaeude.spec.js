import { test, expect } from '@playwright/test';

// Schall der LW-WP mit Gebäuden: Abschirmung hinter einem hohen Gebäude, Reflexion vor einer Wand, Schalter und Speichern
test('dist: Gebäude schirmen den Schall der LW-WP ab', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.lwWpAusbreitungSetzen === 'function');
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
    // Standard: kreisrunde Freifeldausbreitung, Gebäude ohne Wirkung
    const standard = {
      art: lwWpAusbreitung(), nord: lwWpImmissionsorte(5).find(o => o.name === 'Nord'), ringe: lwWpIsophonen().get(45).length,
      knopf: document.getElementById('lwwp-ausbreitung-kreis').classList.contains('aktiv'),
      baeumeSichtbar: getComputedStyle(document.getElementById('lwwp-baeume-wrap')).display,
      hinweis: document.getElementById('lwwp-schall-modell').textContent,
      gespeichert: _buildProjectData().lwWp.ausbreitung ?? null,
    };
    document.getElementById('lwwp-ausbreitung-3d').click();
    const knopf3d = document.getElementById('lwwp-ausbreitung-3d').classList.contains('aktiv');
    const io = Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o]));
    const iso = lwWpIsophonen().get(45);
    // Isophone = Ringe (gerade/ungerade-Regel): äußerster Abstand in Richtung winkel (0° = Nord), in dem der Pegel noch ≥ 45 dB ist
    const imPoly = (poly, x, y) => { let in_ = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.nord > y) !== (b.nord > y) && x < (b.ost - a.ost) * (y - a.nord) / (b.nord - a.nord) + a.ost) in_ = !in_; } return in_; };
    const innen = (x, y) => iso.reduce((n, r) => n + (imPoly(r, x, y) ? 1 : 0), 0) % 2 === 1;
    const radius = winkel => { const w = winkel * Math.PI / 180; let letzter = 0; for (let r = 2; r < 3000; r += 2) if (innen(Math.sin(w) * r, Math.cos(w) * r)) letzter = r; return letzter; };
    const mit = { standard, knopf3d, gespart3d: _buildProjectData().lwWp.ausbreitung, nord: io.Nord, sued: io['Süd'], rNord: radius(0), rSued: radius(180), hinweis: document.getElementById('lwwp-schall-modell').textContent };
    // tieffrequentes Herstellerspektrum: hinter dem Riegel weniger Abschirmung
    lwWpSpektrumSetzen('90 88 80 72 65 58 50 40');
    const tief = Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o])).Nord;
    const spektrumFeld = document.getElementById('lwwp-spektrum').value;
    mit.tiefDaempf = tief.frei - tief.pegel;
    mit.spektrumFeld = spektrumFeld;
    const gespSpektrum = _buildProjectData().lwWp.spektrum;
    mit.gespSpektrum = gespSpektrum;
    lwWpSpektrumSetzen('');
    lwWpAusbreitungSetzen('kreis');
    const io2 = Object.fromEntries(lwWpImmissionsorte(5).map(o => [o.name, o]));
    const ohne = { nord: io2.Nord.pegel, sued: io2['Süd'].pegel, knopf: document.getElementById('lwwp-ausbreitung-kreis').classList.contains('aktiv') };
    lwWpAusbreitungSetzen('3d');
    const gespeichert = _buildProjectData();
    clearLwWp(); _loadProject(gespeichert);
    const nach3d = lwWpAusbreitung();
    lwWpAusbreitungSetzen('kreis');
    const gespeichertKreis = _buildProjectData();
    clearLwWp(); _loadProject(gespeichertKreis);
    return { mit, ohne, nach3d, nachKreis: lwWpAusbreitung() };
  });
  // Standard: kreisrund im Freifeld — Gebäude ohne Wirkung, ein Ring, Baumoptionen ausgeblendet, nichts gespeichert
  expect(r.mit.standard.art).toBe('kreis');
  expect(r.mit.standard.knopf).toBe(true);
  expect(r.mit.standard.ringe).toBe(1);
  expect(r.mit.standard.nord.pegel).toBeCloseTo(r.mit.standard.nord.frei, 6);
  expect(r.mit.standard.baeumeSichtbar).toBe('none');
  expect(r.mit.standard.hinweis).toContain('kreisrund');
  expect(r.mit.standard.gespeichert).toBeNull();
  expect(r.mit.knopf3d).toBe(true);
  expect(r.mit.gespart3d).toBe('3d');
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
  expect(r.ohne.knopf).toBe(true);
  expect(r.nach3d).toBe('3d');
  expect(r.nachKreis).toBe('kreis');
  expect(pageErrors).toEqual([]);
});
