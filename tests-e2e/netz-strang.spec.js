// Strang umlegen: Ein auf eine andere Straße gezogener Leitungspunkt bindet das Teilnetz dahinter neu an.
import { expect, test } from '@playwright/test';

test('dist: Strang des Außenquartiers über eine andere Straße umlegen', async ({ page }) => {
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzStrangVorschlag === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    // Straßen: A ostwärts (Quartier 1), B nordwärts zum Außenquartier, C als Umweg im Westen und Norden
    setTrassePoints([
      L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0060),   // A
      L.latLng(52.0800, 8.0060), L.latLng(52.0830, 8.0060),   // B
      L.latLng(52.0800, 8.0000), L.latLng(52.0845, 8.0000), L.latLng(52.0845, 8.0060), L.latLng(52.0830, 8.0060),   // C (Umweg)
    ]);
    setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }, { start: 2, end: 3, domains: ['waerme'] }, { start: 4, end: 7, domains: ['waerme'] }]);
    const polygon = (lat, lng) => [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004),
      L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)];
    [[981, 'Zentrale', 52.0797, 8.0000], [982, 'Quartier 1', 52.0797, 8.0030], [983, 'Außen A', 52.0833, 8.0058], [984, 'Außen B', 52.0833, 8.0063]]
      .forEach(([id, name, lat, lng]) => {
        const g = addGebaeude({ id, name, baujahr: 2000, coords: polygon(lat, lng), skipAutoCreate: true });
        g.heizlast = '100'; g.waerme = '200';
      });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '981';
    await createQuickWaermeNetz();
    const nahe = (e, lat, lng, m = 12) => (e.layer.getLatLngs() || []).some((p, i, a) => i > 0 && L.LineUtil.pointToSegmentDistance(
      map.latLngToLayerPoint(L.latLng(lat, lng)), map.latLngToLayerPoint(a[i - 1]), map.latLngToLayerPoint(p)) < m / (40075016 * Math.cos(52.08 * Math.PI / 180) / Math.pow(2, map.getZoom() + 8)));
    // Der Aufbau folgt allen gezeichneten Straßen: das Außenquartier hängt am Umweg C, auf B liegt nur ein Stich
    const aufCNord = () => window.netzEdges.filter(e => !e.pruned && nahe(e, 52.0845, 8.0030));
    const aufCOst = () => window.netzEdges.filter(e => !e.pruned && nahe(e, 52.0840, 8.0060));
    const aufB = () => window.netzEdges.filter(e => !e.pruned && nahe(e, 52.0825, 8.0060));
    const vorher = { cNord: aufCNord().length, cOst: aufCOst().length };
    // Nur innerhalb derselben Straße verschoben: kein Vorschlag
    const kleinVerschoben = netzStrangVorschlag(aufCNord()[0], L.latLng(52.0845, 8.0034));
    netzStrangVorschlagSchliessen();
    // Leitung auf C (Nord) auf Straße B ziehen
    const angeboten = netzStrangVorschlag(aufCNord()[0], L.latLng(52.0815, 8.0060));
    const text = document.querySelector('.netz-strang-vorschlag')?.textContent || '';
    const umgelegt = angeboten ? netzStrangUmlegen() : false;
    await new Promise(res => setTimeout(res, 300));
    const v = window._waermeNetzValidation || {};
    const nachher = { cNord: aufCNord().length, cOst: aufCOst().length, b: aufB().length > 0, getrennt: (v.disconnectedConsumerIds || []).length, zyklen: v.cycleEdges || 0 };
    netzRueckgaengig();
    const zurueck = { cNord: aufCNord().length };
    // Echte Bedienung: im Bearbeitungsmodus den Ziehpunkt der Leitung auf Straße B ziehen
    setNetzEditMode(true);
    const kante = aufCNord()[0];
    kante.midMarker.setLatLng(L.latLng(52.0815, 8.0060));
    kante.midMarker.fire('dragend');
    const popupNachZiehen = !!document.querySelector('.netz-strang-vorschlag');
    document.querySelector('.netz-strang-vorschlag .nsv-nein')?.click();
    await new Promise(res => setTimeout(res, 400));   // Leaflet blendet das Fenster aus
    const popupNachNein = !!document.querySelector('.netz-strang-vorschlag');
    setNetzEditMode(false);
    return { popupNachZiehen, popupNachNein, kleinVerschoben, vorher, angeboten, text, umgelegt, nachher, zurueck };
  });
  expect(r.vorher.cNord).toBeGreaterThan(0);
  expect(r.kleinVerschoben).toBe(false);
  expect(r.angeboten).toBe(true);
  expect(r.text).toContain('Strang über diesen Punkt anbinden');
  expect(r.text).toContain('Die 2 Gebäude dahinter');
  expect(r.umgelegt).toBe(true);
  // Jetzt über Straße B; der Umweg C samt altem Einspeisepunkt ist entfallen, ohne doppelte Leitung
  expect(r.nachher).toEqual({ cNord: 0, cOst: 0, b: true, getrennt: 0, zyklen: 0 });
  expect(r.zurueck.cNord).toBeGreaterThan(0);     // Strg+Z stellt den alten Strang wieder her
  expect(r.popupNachZiehen).toBe(true);            // Ziehen im Bearbeitungsmodus bietet das Umlegen an
  expect(r.popupNachNein).toBe(false);             // „Nur Verlauf ändern“ schließt den Vorschlag
  expect(fehler).toEqual([]);
});

test('dist: Leitung im Netz-Reiter direkt greifen und auf eine andere Straße ziehen (ohne Bearbeitungsmodus)', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzStrangVorschlag === 'function');
  const pos = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    setTrassePoints([
      L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0060),
      L.latLng(52.0800, 8.0060), L.latLng(52.0830, 8.0060),
      L.latLng(52.0800, 8.0000), L.latLng(52.0845, 8.0000), L.latLng(52.0845, 8.0060), L.latLng(52.0830, 8.0060),
    ]);
    setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }, { start: 2, end: 3, domains: ['waerme'] }, { start: 4, end: 7, domains: ['waerme'] }]);
    const polygon = (lat, lng) => [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004),
      L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)];
    [[981, 'Zentrale', 52.0797, 8.0000], [982, 'Quartier 1', 52.0797, 8.0030], [983, 'Außen A', 52.0833, 8.0058], [984, 'Außen B', 52.0833, 8.0063]]
      .forEach(([id, name, lat, lng]) => {
        const g = addGebaeude({ id, name, baujahr: 2000, coords: polygon(lat, lng), skipAutoCreate: true });
        g.heizlast = '100'; g.waerme = '200';
      });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '981';
    await createQuickWaermeNetz();
    setNetzEditMode(false);   // z. B. nach dem Trassenzeichnen oder Laden eines Projekts
    map.fitBounds(L.latLngBounds([52.0795, 7.9995], [52.0850, 8.0065]), { animate: false });
    const r = map.getContainer().getBoundingClientRect();
    const px = ll => { const p = map.latLngToContainerPoint(L.latLng(...ll)); return { x: r.left + p.x, y: r.top + p.y }; };
    return { von: px([52.0845, 8.0030]), nach: px([52.0815, 8.0060]) };
  });
  await page.mouse.move(pos.von.x, pos.von.y);
  await page.mouse.down();
  await page.mouse.move((pos.von.x + pos.nach.x) / 2, (pos.von.y + pos.nach.y) / 2, { steps: 5 });
  await page.mouse.move(pos.nach.x, pos.nach.y, { steps: 5 });
  await page.mouse.up();
  const r = await page.evaluate(() => ({
    vorschlag: document.querySelector('.netz-strang-vorschlag')?.textContent || '',
    leitungsfenster: getComputedStyle(document.getElementById('edge-popup') || document.body).display,
  }));
  expect(r.vorschlag).toContain('Strang über diesen Punkt anbinden');
  expect(r.leitungsfenster).toBe('none');
  await page.locator('.netz-strang-vorschlag .nsv-ja').click();
  const nachher = await page.evaluate(() => (window._waermeNetzValidation?.disconnectedConsumerIds || []).length);
  expect(nachher).toBe(0);
});

test('dist: Umlegen schließt an den direkten Strang aus der Zentrale an statt über einen Umweg', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.netzStrangVorschlag === 'function');
  const r = await page.evaluate(async () => {
    clearNetz(); setGebaeude([]);
    setTrassePoints([
      L.latLng(52.0800, 8.0000), L.latLng(52.0830, 8.0000), L.latLng(52.0830, 8.0060), L.latLng(52.0800, 8.0060),   // Umweg: Norden, Osten, runter
      L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0060),   // direkt von der Zentrale nach Osten
    ]);
    setTrasseSegments([{ start: 0, end: 3, domains: ['waerme'] }, { start: 4, end: 5, domains: ['waerme'] }]);
    const polygon = (lat, lng) => [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004), L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)];
    [[981, 'Zentrale', 52.0797, 8.0000], [982, 'Quartier oben', 52.0833, 8.0030], [983, 'Unten A', 52.0797, 8.0058], [984, 'Unten B', 52.0797, 8.0063]]
      .forEach(([id, name, lat, lng]) => { const g = addGebaeude({ id, name, baujahr: 2000, coords: polygon(lat, lng), skipAutoCreate: true }); g.heizlast = '100'; g.waerme = '200'; });
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '981';
    await createQuickWaermeNetz();
    const nahe = (lat, lng) => window.netzEdges.filter(e => !e.pruned && e.layer.getLatLngs().some((p, i, a) => i > 0 &&
      L.LineUtil.pointToSegmentDistance(map.latLngToLayerPoint(L.latLng(lat, lng)), map.latLngToLayerPoint(a[i - 1]), map.latLngToLayerPoint(p)) < 3)).length;
    const runter = window.netzEdges.find(e => !e.pruned && nahe(52.0815, 8.0060) && e.layer.getLatLngs().some(p => Math.abs(p.lng - 8.006) < 1e-6 && Math.abs(p.lat - 52.0815) < 0.0016));
    const vorher = { runter: nahe(52.0815, 8.0060), oben: nahe(52.0830, 8.0045) };
    const angeboten = netzStrangVorschlag(runter, L.latLng(52.0800, 8.0059));
    const ok = angeboten && netzStrangUmlegen();
    await new Promise(res => setTimeout(res, 300));
    return { vorher, angeboten, ok, runter: nahe(52.0815, 8.0060), oben: nahe(52.0830, 8.0045), getrennt: (window._waermeNetzValidation?.disconnectedConsumerIds || []).length };
  });
  expect(r.vorher).toEqual({ runter: 1, oben: 1 });   // Gebäude B hängt über den Umweg im Norden
  expect(r.angeboten).toBe(true);
  expect(r.ok).toBe(true);
  expect([r.runter, r.oben, r.getrennt]).toEqual([0, 0, 0]);   // Umweg entfallen, alles über den direkten Strang versorgt
});
