import { test,expect } from '@playwright/test';

test('Datenschutz ist sichtbar und löscht ausschließlich bekannte lokale App-Daten',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.clearAllLocalAppData==='function');
  const result=await page.evaluate(async()=>{
    localStorage.setItem('energiekarte_autosave','test');
    localStorage.setItem('slp_vorlagen','{}');
    localStorage.setItem('fremde_anwendung','bleibt');
    const seedDb=name=>new Promise((resolve,reject)=>{const req=indexedDB.open(name,1);req.onupgradeneeded=()=>req.result.createObjectStore('x');req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);});
    await seedDb('micke-heat-autosave');
    await seedDb('feldapp-db');
    await caches.open('feldapp-tiles-v1');
    await caches.open('fremder-cache');
    const deleted=await clearAllLocalAppData();
    const dbNames=typeof indexedDB.databases==='function' ? (await indexedDB.databases()).map(db=>db.name) : [];
    return {deleted,dbNames,autosave:localStorage.getItem('energiekarte_autosave'),custom:localStorage.getItem('slp_vorlagen'),foreign:localStorage.getItem('fremde_anwendung'),cacheNames:await caches.keys(),privacyText:document.getElementById('privacy-panel')?.textContent};
  });
  expect(result.autosave).toBeNull();
  expect(result.custom).toBeNull();
  expect(result.foreign).toBe('bleibt');
  expect(result.dbNames).not.toContain('micke-heat-autosave');
  expect(result.dbNames).not.toContain('feldapp-db');
  expect(result.cacheNames).toContain('fremder-cache');
  expect(result.cacheNames).not.toContain('feldapp-tiles-v1');
  expect(result.privacyText).toContain('Möglicherweise sensible Daten');
});
