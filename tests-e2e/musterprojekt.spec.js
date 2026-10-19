import { test, expect } from '@playwright/test';

// Musterprojekt (data/demo_projekt.json, eingebettet über src/50-datenqualitaet.js):
// lädt ohne Fehler, liefert plausible Kennzahlen, übersteht Speichern → Laden unverändert,
// und die Datenqualitätsprüfung schlägt bei einem absichtlich falschen Wert an.

const zahl = s => Number(String(s || '').replace(/\./g, '').replace(',', '.'));

async function kennzahlen(page) {
  return page.evaluate(async () => {
    uiSchritt('auswertung');
    await new Promise(r => setTimeout(r, 5000));
    const t = id => document.getElementById(id)?.textContent?.trim();
    return { waerme: t('av-kpi-waerme'), pmax: t('av-kpi-pmax'), wgk: t('av-kpi-wgk'), co2: t('av-kpi-co2'), ee: t('av-kpi-ee') };
  });
}

test('dist: Beispielprojekt öffnen, Kennzahlen plausibel, Roundtrip unverändert', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org|arcgisonline|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.dqBeispielprojektOeffnen === 'function' && typeof window._loadProject === 'function');

  const geladen = await page.evaluate(async () => {
    const ok = await dqBeispielprojektOeffnen({ ohneRueckfrage: true });
    await new Promise(r => setTimeout(r, 1000));
    return {
      ok, gebaeude: window.gebaeude.length, assets: ASSETS.items.length,
      kabel: (window.stromEdges || []).length, netz: (window.netzEdges || []).length,
      lwWp: !!window.lwWp, gas: !!window.gasKessel, name: document.getElementById('pd-kaserne-name')?.value,
    };
  });
  expect(geladen).toMatchObject({ ok: true, gebaeude: 9, lwWp: true, gas: true, name: 'Musterliegenschaft Lindenhof' });
  expect(geladen.assets).toBeGreaterThan(20);
  expect(geladen.kabel).toBeGreaterThan(5);
  expect(geladen.netz).toBeGreaterThan(5);

  const k1 = await kennzahlen(page);
  expect(zahl(k1.waerme)).toBeGreaterThan(1700);          // MWh/a
  expect(zahl(k1.waerme)).toBeLessThan(2100);
  expect(zahl(k1.co2)).toBeGreaterThan(150);              // t/a — bei η als Bruchteil wären es > 1000
  expect(zahl(k1.co2)).toBeLessThan(450);
  expect(zahl(k1.wgk)).toBeGreaterThan(15);               // ct/kWh
  expect(zahl(k1.wgk)).toBeLessThan(45);
  expect(await page.evaluate(() => dqAktualisieren())).toEqual([]);

  // Speichern → Laden: dieselben Daten und dieselben Kennzahlen
  const rt = await page.evaluate(async () => {
    const a = _buildProjectData();
    _loadProject(JSON.parse(JSON.stringify(a)));
    await new Promise(r => setTimeout(r, 1000));
    const b = _buildProjectData();
    const kern = p => ({ geb: p.gebaeude.map(g => [g.id, g.waerme, g.strom, g.flaeche, g.polygon.length]),
      assets: p.elektroAssets.items.map(x => [x.id, x.type, x.props?.leistungKVA ?? x.props?.leistungKWp ?? null]).sort(),
      kabel: p.elektroAssets.edges.length, graph: p.waermeNetzGraph.edges.length,
      gas: p.gasKessel, lw: [p.lwWp.leistungKw, p.lwWp.lat, p.lwWp.lng], zentrale: p.netz.zentrale });
    return { a: kern(a), b: kern(b) };
  });
  expect(rt.b).toEqual(rt.a);
  expect(await kennzahlen(page)).toEqual(k1);
  expect(pageErrors).toEqual([]);
});

test('dist: Datenqualität warnt bei absichtlich falschem Wirkungsgrad und korrigiert alte Dateien', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/tile\.openstreetmap\.org|arcgisonline|overpass/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.dqBeispielprojektOeffnen === 'function');

  const feld = await page.evaluate(async () => {
    await dqBeispielprojektOeffnen({ ohneRueckfrage: true });
    await new Promise(r => setTimeout(r, 800));
    const el = document.getElementById('gk-eta');
    el.value = '0.92';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    uiSchritt('projekt');
    await new Promise(r => setTimeout(r, 200));
    return {
      markiert: el.classList.contains('dq-auffaellig'),
      notiz: el.parentElement.querySelector('.dq-feldhinweis')?.textContent || '',
      karte: document.getElementById('ui-projekt-dq')?.textContent || '',
      zaehler: document.getElementById('ui-projekt-dq-zahl')?.textContent || '',
    };
  });
  expect(feld.markiert).toBe(true);
  expect(feld.notiz).toContain('Bruchteil');
  expect(feld.karte).toContain('Wirkungsgrad Gaskessel');
  expect(feld.zaehler).toBe('1 auffällig');

  // Alte Datei mit η als Bruchteil: wird beim Laden umgerechnet und gemeldet
  const alt = await page.evaluate(async () => {
    const p = JSON.parse(dqMusterprojektText());
    p.gasKessel.eta = '0.92';
    _loadProject(p);
    await new Promise(r => setTimeout(r, 800));
    const h = dqAktualisieren();
    return { eta: document.getElementById('gk-eta').value, stufen: h.map(x => x.stufe) };
  });
  expect(alt).toEqual({ eta: '92', stufen: ['korrigiert'] });
});
