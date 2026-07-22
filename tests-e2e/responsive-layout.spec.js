import { test,expect } from '@playwright/test';

for (const viewport of [{width:1366,height:768},{width:1024,height:768},{width:768,height:1024},{width:600,height:900}]) {
  test(`Hauptlayout bleibt bei ${viewport.width}x${viewport.height} bedienbar`,async({page})=>{
    await page.setViewportSize(viewport);
    await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
    await page.goto('/');
    await page.waitForFunction(()=>document.documentElement.dataset.viewportClass);
    const layout=await page.evaluate(()=>{
      const mapRect=document.getElementById('map').getBoundingClientRect();
      const sidebar=document.getElementById('sidebar');
      const left=document.getElementById('left-panel');
      const offenders=[...document.querySelectorAll('body *')].map(el=>({el,rect:el.getBoundingClientRect()}))
        .filter(x=>x.rect.right>innerWidth+2 || x.rect.left < -2).slice(0,8).map(x=>`${x.el.id||x.el.className||x.el.tagName}:${Math.round(x.rect.left)}..${Math.round(x.rect.right)}`);
      return {mapWidth:mapRect.width,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,offenders,
        sidebarCollapsed:sidebar.classList.contains('collapsed'),leftCollapsed:left.classList.contains('collapsed'),viewportClass:document.documentElement.dataset.viewportClass};
    });
    expect(layout.overflow,layout.offenders.join('\n')).toBeLessThanOrEqual(1);
    expect(layout.mapWidth).toBeGreaterThan(viewport.width <= 760 ? viewport.width * .9 : viewport.width * .5);
    if (viewport.width <= 1100) expect(layout.sidebarCollapsed).toBe(true);
    if (viewport.width <= 760) expect(layout.leftCollapsed).toBe(true);
  });
}
