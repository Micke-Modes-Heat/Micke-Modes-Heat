import { test, expect } from '@playwright/test';

// Zwei Quartiere an derselben Straße: ohne Vorgabe hängt das hintere Quartier am Strang des vorderen,
// mit Versorgungsquartieren bekommt jedes einen eigenen Hauptstrang ab der Zentrale.
const aufbauen = () => {
  clearNetz();
  setGebaeude([]);
  window.netzQuartiere = [];
  const add = (id, lat, lng) => {
    const g = addGebaeude({ id, name: 'G' + id, baujahr: 2000, skipAutoCreate: true,
      coords: [L.latLng(lat - .00004, lng - .00004), L.latLng(lat - .00004, lng + .00004), L.latLng(lat + .00004, lng + .00004), L.latLng(lat + .00004, lng - .00004)] });
    g.waerme = '400'; g.heizlast = '200';
  };
  add(1, 52.0797, 8.0000);                                  // Zentrale
  [[2, 8.0020], [3, 8.0025], [4, 8.0030]].forEach(([id, lng]) => add(id, 52.0803, lng));   // Quartier A
  [[5, 8.0060], [6, 8.0065], [7, 8.0070]].forEach(([id, lng]) => add(id, 52.0803, lng));   // Quartier B
  populateZentraleSelect();
  document.getElementById('netz-zentrale').value = '1';
  setNetworkLocked(false);
  setTrassePoints([L.latLng(52.0800, 8.0000), L.latLng(52.0800, 8.0090)]);
  setTrasseSegments([{ start: 0, end: 1, domains: ['waerme'] }]);
};

const auswerten = () => {
  const kanten = netzEdges.filter(e => !e.pruned);
  const nb = new Map();
  kanten.forEach(e => { [[e.u, e.v], [e.v, e.u]].forEach(([a, b]) => { if (!nb.has(a)) nb.set(a, []); nb.get(a).push(b); }); });
  const abgang = new Map();
  for (const s of nb.get(1) || []) {
    const q = [s]; abgang.set(s, s);
    while (q.length) { const n = q.shift(); for (const x of nb.get(n) || []) if (x !== 1 && !abgang.has(x)) { abgang.set(x, s); q.push(x); } }
  }
  const a = new Set([2, 3, 4].map(id => abgang.get(id))), b = new Set([5, 6, 7].map(id => abgang.get(id)));
  return { a: [...a], b: [...b], getrennt: [...a].every(x => !b.has(x)), alleAngeschlossen: [2, 3, 4, 5, 6, 7].every(id => abgang.has(id)) };
};

test('dist: Versorgungsquartiere erhalten je einen eigenen Hauptstrang ab der Zentrale', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.autoGenerateNetz === 'function' && typeof window.netzQuartierHinzufuegen === 'function');

  const ohne = await page.evaluate(([aufbau, auswertung]) => {
    eval(`(${aufbau})`)();
    autoGenerateNetz({ strategy: 'trasse' });
    return eval(`(${auswertung})`)();
  }, [aufbauen.toString(), auswerten.toString()]);
  expect(ohne.alleAngeschlossen).toBe(true);
  expect(ohne.getrennt).toBe(false);   // ohne Vorgabe: ein gemeinsamer Strang

  for (const strategie of ['trasse', 'quick']) {
    const mit = await page.evaluate(([aufbau, auswertung, strategy]) => {
      eval(`(${aufbau})`)();
      // Quartiere über die Auswahl festlegen (wie im Netz-Schritt ②)
      const waehle = ids => gebaeude.forEach(g => { g.selected = ids.includes(g.id); });
      waehle([2, 3, 4]); netzQuartierHinzufuegen();
      waehle([5, 6, 7]); netzQuartierHinzufuegen();
      waehle([]);
      autoGenerateNetz({ strategy });
      const status = netzQuartierStatus();
      return { ...eval(`(${auswertung})`)(), status: [...status.values()].map(s => s.eigener), anzahl: netzQuartiere.length,
        doppelt: netzWorkspaceStatus().parallel.length };
    }, [aufbauen.toString(), auswerten.toString(), strategie]);
    expect(mit.anzahl).toBe(2);
    expect(mit.alleAngeschlossen).toBe(true);
    expect(mit.getrennt).toBe(true);
    expect(mit.status).toEqual([true, true]);
    expect(mit.doppelt).toBe(0);   // nebeneinanderliegende Hauptstränge sind gewollt, kein Konflikt
  }

  // Speichern und Laden behält die Quartiere
  const gespeichert = await page.evaluate(() => _buildProjectData().netzQuartiere?.map(q => q.gebIds));
  expect(gespeichert).toEqual([[2, 3, 4], [5, 6, 7]]);
  expect(pageErrors).toEqual([]);
});
