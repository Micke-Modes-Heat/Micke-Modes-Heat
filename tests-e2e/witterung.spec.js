// Witterungsbereinigung des hochgeladenen Lastgangs: Gradtagzahlen (Open-Meteo, hier simuliert), Faktor, Wirkung und Gutachtentext.
import { expect, test } from '@playwright/test';

test('dist: Gradtagzahlen bereinigen den gemessenen Lastgang und erscheinen im Gutachtentext', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.route(/archive-api\.open-meteo\.com/, route => {
    const time = [], t = [];
    for (let y = 2003; y <= 2023; y++) for (let d = 0; d < 365; d++) {
      time.push(new Date(Date.UTC(y, 0, 1 + d)).toISOString().slice(0, 10));
      t.push(9 - 9 * Math.cos(2 * Math.PI * (d - 15) / 365) + (y === 2023 ? 1 : 0));
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ daily: { time, temperature_2m_mean: t } }) });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.glFileSelected === 'function' && typeof window.wbLaden === 'function');
  const r = await page.evaluate(async () => {
    const csv = Array.from({ length: 8760 }, (_, h) => String(300 + Math.max(0, 14 - 14 * Math.sin(Math.PI * h / 8760)) * 100)).join('\n');
    await window.glFileSelected(new File([csv], 'lastgang.csv', { type: 'text/csv' }));
    await new Promise(res => setTimeout(res, 1000));
    window.wbFeld('messjahr', 2023);
    await window.wbLaden();
    await new Promise(res => setTimeout(res, 2000));
    const text = window.ggFigurWordDaten('lastgang-witterung-text').absaetze.map(a => a.map(x => x.text).join('')).join('\n');
    const gesichert = window.captureWaermeGrundlagen().witterung;
    return { info: window._wbInfo, text, gesichert };
  });
  expect(r.info.faktor).toBeGreaterThan(1);
  expect(r.info.nachMwh).toBeGreaterThan(r.info.vorMwh);
  expect(r.text).toContain('Gradtagzahlen G20/15 des Messjahres 2023');
  expect(r.gesichert.messjahr).toBe(2023);
  expect(r.gesichert.ergebnis.tageT).toHaveLength(365);
  expect(r.gesichert.ergebnis.gJahre.at(-1)).toMatchObject({ jahr: 2023 });
  expect(r.gesichert.ergebnis.gJahre.length).toBe(21);
});
