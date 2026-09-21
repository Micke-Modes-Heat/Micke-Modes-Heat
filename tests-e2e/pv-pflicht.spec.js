// Browser-Test gegen den Singlefile-Build: landesrechtliche PV-Pflicht.
// Fängt die Fehlerklasse ab, die Unit-Tests nicht sehen — Verdrahtung von
// Rechenkern, Panel und Variantentabelle im gebauten Bundle.
import { expect, test } from '@playwright/test';

test('dist: PV-Pflicht bestimmt Land, erzeugt die Variante und prüft die übrigen', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());

  await page.goto('/');
  await page.waitForFunction(() => typeof window.pvPflichtAktuell === 'function');

  // Zwei Gebäude in Stuttgart: ein geplanter Neubau, ein Bestandsgebäude.
  const pflicht = await page.evaluate(() => {
    window.gebaeude.push(
      { id: 901, name: 'Neubau Halle', flaeche: 1000, lat: 48.78, lng: 9.18, dachform: 'flach',
        nutzungstyp: 'werkstatt', stockwerke: 1, baujahr: new Date().getFullYear() + 3, sanierungen: [] },
      { id: 902, name: 'Bestand Büro', flaeche: 800, lat: 48.78, lng: 9.19, dachform: 'sattel',
        nutzungstyp: 'buero', stockwerke: 2, baujahr: 1985, sanierungen: [] },
    );
    const auto = window.pvPflichtAktuell();
    window._pvAnalyse.pflichtLand = 'nw';           // Land ohne bezifferten Anteil
    const nw = window.pvPflichtAktuell();
    window._pvAnalyse.pflichtLand = '';
    return {
      land: window.pvPflichtLandId(),
      kwp: auto.kwp,
      faelle: auto.faelle.length,
      nwBezifferbar: nw.bezifferbar,
      nwKwp: nw.kwp,
    };
  });

  expect(pflicht.land).toBe('bw');                  // aus den Koordinaten
  expect(pflicht.faelle).toBe(1);                   // nur der Neubau löst aus
  expect(pflicht.kwp).toBeGreaterThan(50);
  expect(pflicht.nwBezifferbar).toBe(false);        // NRW verweist auf die Rechtsverordnung
  expect(pflicht.nwKwp).toBe(0);                    // und bekommt deshalb keine erfundene Zahl

  // Variantenlauf mit synthetischem Lastgang
  const lauf = await page.evaluate(() => {
    const N = 8760, arr = new Float32Array(N);
    for (let i = 0; i < N; i++) arr[i] = 150 + 80 * Math.sin((i % 24) / 24 * Math.PI * 2 - 1.8);
    window.elQuartierH = arr;
    window._pvAnalyse.pvMaxKwpOverride = 900;
    window.setViewMode?.('analyse');
    window.pvaBuildAnalyseSection?.();
    window.setAnalyseSection?.('pva');
    window.pvBerechneAlle();
    const s = window._pvAnalyse;
    return {
      ids: s.ergebnisse.map(e => e.id),
      minimal: s.ergebnisse.find(e => e.id === 'minimal')?.pflicht,
      maxPv:   s.ergebnisse.find(e => e.id === 'max-pv')?.pflicht,
      tabelle: document.getElementById('pva-result-tabelle')?.innerHTML || '',
      panel:   !!document.getElementById('pva-pflicht-land'),
    };
  });

  expect(lauf.ids).toContain('gesetzlich');
  expect(lauf.panel).toBe(true);
  expect(lauf.minimal.erfuellt).toBe(false);        // 99 kWp liegen unter der Pflicht
  expect(lauf.maxPv.erfuellt).toBe(true);
  expect(lauf.tabelle).toContain('nicht genehmigungsfähig');
  expect(lauf.tabelle).toContain('KlimaSchG BW');

  // Gebäudeübersicht: Soll/Ist je Gebäude, Rechenweg, Handeingabe des Pflichtfalls
  const uebersicht = await page.evaluate(() => {
    window.pvPflichtUebersichtOeffnen();
    const txt = () => document.getElementById('pv-pflicht-body')?.textContent?.replace(/\s+/g, ' ') || '';
    const vorher = window.pvPflichtAktuell();
    // Bestandsgebäude von Hand zum Pflichtfall erklären
    window.pvPflichtFallSetzen(902, 'neubau');
    const nachher = window.pvPflichtAktuell();
    // und wieder herausnehmen
    window.pvPflichtFallSetzen(902, 'keine');
    const raus = window.pvPflichtAktuell();
    window.pvPflichtFallSetzen(902, '');
    return {
      body: txt(),
      hatRechenweg: /m² (geeignete Fläche|Dachfläche|Bruttodachfläche) × \d+ % × \d+ W\/m² = /.test(txt()),
      faelleVorher: vorher.faelle.length,
      faelleNachher: nachher.faelle.length,
      faelleRaus: raus.faelle.length,
      istGesamt: vorher.istKwp,
    };
  });

  expect(uebersicht.faelleVorher).toBe(1);
  expect(uebersicht.faelleNachher).toBe(2);   // Handeingabe zieht das Bestandsgebäude hinein
  expect(uebersicht.faelleRaus).toBe(1);      // „nicht pflichtig" nimmt es wieder heraus
  expect(uebersicht.hatRechenweg).toBe(true);
  expect(uebersicht.body).toContain('Soll');

  // Die Pflichtspalte muss der Modul-NENNLEISTUNG folgen, nicht dem
  // ausrichtungskorrigierten Wert im PV-Asset (Gesetz fordert Modulfläche).
  const nennleistung = await page.evaluate(() => {
    const g = window.gebaeude.find(x => x.id === 901);
    g.pvAktiv = true; g.pvModus = 'pauschal'; g.pvDachanteil = 50;
    const nenn = window.calcGebKwp(g);
    // PV-Asset mit bewusst abweichendem (korrigiertem) Wert anlegen
    window.createAsset('PV', g.lat, g.lng, {
      buildingId: g.id, name: 'PV Test', props: { leistungKWp: nenn * 0.6 },
    });
    const det = window.pvGeplantDetail(g);
    const f = window.pvPflichtAktuell().faelle.find(x => x.id === 901);
    return { nenn, quelle: det.quelle, detKwp: det.kwp, assetKwp: det.assetKwp, istKwp: f?.istKwp };
  });
  expect(nennleistung.quelle).toBe('dach');
  expect(nennleistung.detKwp).toBeCloseTo(nennleistung.nenn, 6);
  expect(nennleistung.istKwp).toBeCloseTo(nennleistung.nenn, 6);
  // der Asset-Wert darf die Pflichtspalte nicht bestimmen
  expect(Math.abs(nennleistung.istKwp - nennleistung.assetKwp)).toBeGreaterThan(1);

  // Auch die Variantenprüfung muss auf Nennleistung rechnen: Varianten stammen aus
  // dem Anlagenpotenzial (dort stecken korrigierte Asset-Werte), die Pflicht ist in
  // Nennleistung formuliert — ohne Umrechnung verglichen man zwei Größen.
  const varianten = await page.evaluate(() => {
    window._pvAnalyse.pvMaxKwpOverride = 0;        // Override würde den Faktor auf 1 zwingen
    const faktor = window.pvNennFaktor(window.pvGetMaxKwpFromAssets());
    window.pvBerechneAlle();
    const erg = window._pvAnalyse.ergebnisse;
    return {
      faktor,
      potenzial: window.pvGetMaxKwpFromAssets(),
      nenn: window.pvPotenzialNennKwp(),
      zeilen: erg.map(e => ({ id: e.id, pvKwp: e.pvKwp, nennKwp: e.nennKwp, erfuellt: e.pflicht?.relevant ? e.pflicht.erfuellt : null })),
      kontextFaktor: window._pvAnalyse.pflicht?.nennFaktor,
    };
  });

  // Das Asset aus dem vorigen Schritt trägt 60 % der Nennleistung → Faktor > 1
  expect(varianten.faktor).toBeGreaterThan(1);
  expect(varianten.nenn).toBeGreaterThan(varianten.potenzial);
  expect(varianten.kontextFaktor).toBeCloseTo(varianten.faktor, 6);
  for (const z of varianten.zeilen) {
    if (z.id === 'gesetzlich') {
      expect(z.nennKwp).toBeCloseTo(z.pvKwp, 6);          // ist bereits Nennleistung
    } else {
      expect(z.nennKwp).toBeCloseTo(z.pvKwp * varianten.faktor, 6);
    }
  }

  // Der Jahres-Regler darf die Pflicht NICHT verändern
  const sliderTest = await page.evaluate(() => {
    const vorher = window.pvPflichtAktuell().kwp;
    const werte = [];
    for (const jahr of [2026, 2035, 2045]) {
      window.setGlobalYear?.(jahr);
      werte.push(window.pvPflichtAktuell().kwp);
    }
    return { vorher, werte };
  });
  expect(new Set(sliderTest.werte).size).toBe(1);
  expect(sliderTest.werte[0]).toBeCloseTo(sliderTest.vorher, 6);

  expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);
});
