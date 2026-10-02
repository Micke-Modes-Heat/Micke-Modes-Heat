// Eisspeicher als Quelle der Sole-WP: Stundensimulation, Übernahme durch Luft-WP/Gaskessel, Panel und Gutachtentext.
import { expect, test } from '@playwright/test';

test('dist: Eisspeicher begrenzt die Sole-WP, Luft-WP und Gaskessel übernehmen', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window._dispatchCore === 'function' && typeof window.placeGeoAt === 'function');
  const r = await page.evaluate(() => {
    const n = 8760, tempH = new Float32Array(n), vlH = new Float32Array(n).fill(55), last = new Float32Array(n);
    for (let t = 0; t < n; t++) { const tag = Math.floor(t / 24); tempH[t] = 9 - 9 * Math.cos(2 * Math.PI * (tag - 15) / 365); last[t] = Math.max(0, 15 - tempH[t]) * 8 + 10; }
    const lauf = (eisSpeicher, extra = []) => _dispatchCore({
      lastgangKw: last, tempH, vlH, speicherParams: null, stProfile: null, stExcessH: null, bhkwSigma: .45, skEta: .99, lwwpMinCop: 0,
      erzList: [{ key: 'geo', typ: 'wp', leistKw: 150, guetegrad: .5 }, ...extra],
      quelleTemp: _quelleTemp, recordHourly: true, backupMode: false, eisSpeicher,
    });
    const klein = lauf({ volumenM3: 20, absorberM2: 0, maxVereisungPct: 85 }, [{ key: 'lwwp', typ: 'wp', leistKw: 200, guetegrad: .45 }, { key: 'gaskessel', typ: 'kessel', leistKw: 300, guetegrad: 1 }]);
    const gross = lauf({ volumenM3: 150, absorberM2: 400, maxVereisungPct: 85 });
    const ohne = lauf(null);
    return {
      klein: { geo: klein.thKwh.geo, lwwp: klein.thKwh.lwwp, gk: klein.thKwh.gaskessel, gesperrt: klein.eisStat.gesperrtH, vereisung: klein.eisStat.maxVereisung },
      gross: { geo: gross.thKwh.geo, rest: gross.autoGkKwh, gesperrt: gross.eisStat.gesperrtH },
      ohneEis: ohne.eisStat, gesamt: klein.gesamtKwh,
    };
  });
  expect(r.ohneEis).toBeNull();
  expect(r.klein.gesperrt).toBeGreaterThan(200);
  expect(r.klein.vereisung).toBeCloseTo(0.85, 2);
  expect(r.klein.lwwp + r.klein.gk).toBeGreaterThan(0);
  expect(r.gross.gesperrt).toBeLessThan(r.klein.gesperrt / 5);
  expect(r.gross.geo).toBeGreaterThan(r.klein.geo);

  // Panel: Wärmequelle umschalten, Faustwerte, Ergebnisanzeige, Gutachtentext
  const ui = await page.evaluate(() => {
    placeGeoAt(L.latLng(52.08, 8));
    document.getElementById('geo-heizlast').value = 80;
    document.getElementById('geo-quelle').value = 'eis';
    geoQuelleWechseln();
    return {
      volumen: document.getElementById('eis-volumen').value, absorber: document.getElementById('eis-absorber').value,
      sondenVersteckt: document.getElementById('geo-sonden-block').hidden, titel: document.getElementById('geo-panel-titel').textContent,
      bohrmeter: document.getElementById('geo-r-length').textContent,
    };
  });
  expect(ui).toEqual({ volumen: '80', absorber: '210', sondenVersteckt: true, titel: 'Eisspeicher-Wärmepumpe', bohrmeter: '—' });
  // Kopplung: Speicher und Absorber folgen der Heizleistung, bis sie überschrieben werden
  const kopplung = await page.evaluate(() => {
    const heiz = document.getElementById('geo-heizlast'), vol = document.getElementById('eis-volumen');
    heiz.value = 100; calcGeoThermie();
    const auto = [vol.value, document.getElementById('eis-absorber').value, document.getElementById('eis-volumen-status').textContent];
    vol.value = 60; eisFeldManuell(vol);
    heiz.value = 150; calcGeoThermie();
    const manuell = [vol.value, document.getElementById('eis-absorber').value, document.getElementById('eis-volumen-status').textContent.trim(),
      document.getElementById('eis-r-reicht').textContent];
    eisFeldAutomatisch('eis-volumen');
    return { auto, manuell, zurueck: vol.value };
  });
  expect(kopplung.auto).toEqual(['100', '260', 'auto aus Heizleistung']);
  expect(kopplung.manuell.slice(0, 2)).toEqual(['60', '390']);
  expect(kopplung.manuell[2]).toContain('manuell');
  expect(kopplung.manuell[3]).toContain('≈ 60 kW');
  expect(kopplung.zurueck).toBe('150');
  const zurueck = await page.evaluate(() => { document.getElementById('geo-quelle').value = 'sonden'; geoQuelleWechseln(); return document.getElementById('geo-sonden-block').hidden; });
  expect(zurueck).toBe(false);
});
