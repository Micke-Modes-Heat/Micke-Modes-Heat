import { test, expect } from '@playwright/test';

test('dist: Trasse, Linien-Snap und Abschluss verändern vorhandenes Netz nicht automatisch', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.startNewTrasseBranch === 'function');

  const result = await page.evaluate(async () => {
    setTrassePoints([]); setTrasseSegments([]); setTrasseCurrentSegStart(0);
    window.trasseVisible = true;
    const existingEdge = {u: 777, v: 778};
    setNetzEdges([existingEdge]);

    toggleDrawTrasse();
    map.fire('click', {latlng: L.latLng(52.0815, 8.0030)});
    map.fire('click', {latlng: L.latLng(52.0815, 8.0040)});
    const countBeforeUndo = window.trassePoints.length;
    undoTrassePoint();
    const countAfterUndo = window.trassePoints.length;
    redoTrassePoint();
    const countAfterRedo = window.trassePoints.length;
    startNewTrasseBranch();
    // Klick nahe der Mitte des ersten Segments: muss auf die Linie einrasten.
    map.fire('click', {latlng: L.latLng(52.08152, 8.0035)});
    map.fire('click', {latlng: L.latLng(52.0820, 8.0035)});
    toggleDrawTrasse();

    // Ein Stützpunkt muss während eines echten Drag-Vorgangs durchgehend derselbe
    // Leaflet-Marker bleiben; ein Neuzeichnen während `drag` brach das Ziehen ab.
    toggleDrawTrasse();
    const dragMarker = window.trasseEditMarkers.find(marker => marker.options.draggable);
    const dragTarget = L.latLng(52.0830, 8.0060);
    dragMarker.setLatLng(dragTarget);
    dragMarker.fire('drag',{target:dragMarker});
    const markerSurvivedDrag = map.hasLayer(dragMarker);
    dragMarker.fire('dragend',{target:dragMarker});
    toggleDrawTrasse();

    setNetworkLocked(true);
    const lockedClearResult = confirmClearNetz();
    const lockedDrawResult = toggleDrawEdge();
    const lockedState = {
      clearResult: lockedClearResult,
      drawResult: lockedDrawResult,
      edgeCount: window.netzEdges.length,
      drawingEdge: window.isDrawingEdge,
    };
    toggleDrawEdge();
    setNetworkLocked(false);

    return {
      segments: window.trasseSegments.map(s => ({...s})),
      points: window.trassePoints.map(p => ({lat: p.lat, lng: p.lng})),
      edgePreserved: window.netzEdges.length === 1 && window.netzEdges[0] === existingEdge,
      activeButtons: document.querySelectorAll('.trasse-draw-btn.active').length,
      duplicateIds: document.querySelectorAll('#btn-draw-trasse').length,
      domains: window.trasseSegments.map(s => s.domains),
      undoRedo: [countBeforeUndo, countAfterUndo, countAfterRedo],
      controlsHidden: document.getElementById('trasse-editor-bar')?.style.display === 'none',
      editorControls: ['trasse-finish-btn','trasse-generate-btn','trasse-branch-btn','trasse-cancel-btn']
        .every(id => !!document.getElementById(id)),
      autoNetzVisible: [...document.querySelectorAll('button')].some(button => button.textContent.includes('Wärmenetz erstellen')),
      createMenuOptions: [...document.querySelectorAll('#netz-create-menu .netz-create-option strong')]
        .map(element => element.textContent.trim()),
      trassentreue: document.getElementById('netz-trassentreue')?.value,
      markerSurvivedDrag,
      lockedState,
    };
  });

  expect(result.segments).toHaveLength(2);
  expect(result.points).toHaveLength(4);
  expect(result.points[2].lng).toBeCloseTo(8.0035, 4);
  expect(result.edgePreserved).toBe(true);
  expect(result.activeButtons).toBe(0);
  expect(result.duplicateIds).toBe(0);
  expect(result.domains).toEqual([['waerme'], ['waerme']]);
  expect(result.undoRedo).toEqual([2, 1, 2]);
  expect(result.controlsHidden).toBe(true);
  expect(result.editorControls).toBe(true);
  expect(result.autoNetzVisible).toBe(true);
  expect(result.createMenuOptions).toEqual([
    'Netz an Straßenzügen orientieren',
    'Auto-Netz direkt',
    'Haupttrasse zeichnen',
  ]);
  expect(result.trassentreue).toBe('50');
  expect(result.markerSurvivedDrag).toBe(true);
  expect(result.lockedState).toEqual({
    clearResult: false,
    drawResult: true,
    edgeCount: 1,
    drawingEdge: true,
  });
  expect(pageErrors).toHaveLength(0);
});

test('dist: aus einer Wärme-Haupttrasse wird ein verbundenes Wärmenetz erzeugt', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.autoGenerateNetz === 'function');

  const result = await page.evaluate(async () => {
    clearNetz();
    setGebaeude([]);
    const makeBuilding = (id, lat, lng, name) => {
      const building = addGebaeude({
        id, name, baujahr: 2000, skipAutoCreate: true,
        coords: [
          L.latLng(lat - 0.00005, lng - 0.00005),
          L.latLng(lat - 0.00005, lng + 0.00005),
          L.latLng(lat + 0.00005, lng + 0.00005),
          L.latLng(lat + 0.00005, lng - 0.00005),
        ],
      });
      building.heizlast = '100';
      building.waerme = '200';
      return building;
    };
    // Beide Gebäude liegen jenseits desselben Trassenendes und nah
    // beieinander. Sie sollen lokal gesammelt werden, nicht als Fächer mit
    // zwei langen Einzelanschlüssen am Endpunkt hängen.
    makeBuilding(101, 52.0830, 8.0030, 'Zentrale');
    makeBuilding(102, 52.0831, 8.0032, 'Verbraucher');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value = '101';
    setTrassePoints([
      L.latLng(52.0810, 8.0040),
      L.latLng(52.0815, 8.0040),
      L.latLng(52.0820, 8.0040),
    ]);
    setTrasseSegments([{start: 0, end: 2, domains: ['waerme']}]);
    setNetworkLocked(true);
    const confirmations = [];
    window.confirm = message => { confirmations.push(message); return true; };
    const generated = await confirmAutoGenerateNetz();
    const initial = {
      generated,
      locked: window.networkLocked,
      confirmations,
      edgeCount: window.netzEdges.length,
      buildingToTrasse: window.netzEdges.filter(edge =>
        (edge.uNode.type === 'geb' && edge.vNode.type === 'trasse') ||
        (edge.vNode.type === 'geb' && edge.uNode.type === 'trasse')).length,
      buildingToBuilding: window.netzEdges.filter(edge =>
        edge.uNode.type === 'geb' && edge.vNode.type === 'geb').length,
      buildingIds: [...new Set(window.netzEdges.flatMap(edge => [edge.u, edge.v]))]
        .filter(id => id === 101 || id === 102)
        .sort(),
    };
    setNetworkLocked(false);
    autoGenerateNetz({strategy: 'trasse', trasseTreue: 0});
    const lowLoyaltyDirect = window.netzEdges.filter(edge =>
      (edge.uNode.type === 'geb' && edge.vNode.type === 'trasse') ||
      (edge.vNode.type === 'geb' && edge.uNode.type === 'trasse')).length;
    autoGenerateNetz({strategy: 'trasse', trasseTreue: 100});
    const highLoyaltyDirect = window.netzEdges.filter(edge =>
      (edge.uNode.type === 'geb' && edge.vNode.type === 'trasse') ||
      (edge.vNode.type === 'geb' && edge.uNode.type === 'trasse')).length;
    const quietView = {
      trasseVisible: window.trasseVisible,
      handles: window.netzEdges.flatMap(edge => [edge.midMarker, ...(edge.waypointMarkers || [])])
        .filter(marker => marker && map.hasLayer(marker)).length,
    };
    const infoEdge = window.netzEdges.find(edge => edge.load > 0) || window.netzEdges[0];
    const hasHoverTooltip = Boolean(infoEdge?.layer?.getTooltip?.() || infoEdge?.hitLayer?.getTooltip?.());
    showEdgePopup(infoEdge, {clientX: 500, clientY: 400});
    const clickInfo = {
      visible: document.getElementById('edge-popup')?.style.display === 'block',
      details: document.querySelector('#edge-popup .edge-popup-details')?.textContent || '',
    };
    closeEdgePopup();
    toggleNetzEditMode();
    const editHandles = window.netzEdges.flatMap(edge => [edge.midMarker, ...(edge.waypointMarkers || [])])
      .filter(marker => marker && map.hasLayer(marker)).length;
    toggleNetzEditMode();
    return {...initial, lowLoyaltyDirect, highLoyaltyDirect, quietView, hasHoverTooltip, clickInfo, editHandles};
  });

  expect(result.generated).toBe(true);
  expect(result.locked).toBe(true);
  expect(result.confirmations).toHaveLength(0);
  expect(result.edgeCount).toBeGreaterThan(0);
  expect(result.buildingToTrasse).toBe(1);
  expect(result.buildingToBuilding).toBe(1);
  expect(result.highLoyaltyDirect).toBeGreaterThan(result.lowLoyaltyDirect);
  expect(result.quietView).toEqual({trasseVisible:false,handles:0});
  expect(result.hasHoverTooltip).toBe(false);
  expect(result.clickInfo.visible).toBe(true);
  expect(result.clickInfo.details).toContain('Leitung');
  expect(result.clickInfo.details).toContain('Leitungsauslastung');
  expect(result.clickInfo.details).toContain('maßgebenden Jahr');
  expect(result.editHandles).toBeGreaterThan(0);
  expect(result.buildingIds).toEqual([101, 102]);
  expect(pageErrors).toHaveLength(0);
});

test('dist: Wärmenetz-Startfenster übergibt Erstellen und Bearbeiten an die Sidebar', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.openNetzWorkspace === 'function');

  const result = await page.evaluate(() => {
    toggleNetzPanel();
    const launcher = {
      visible: document.getElementById('netz-panel').classList.contains('visible'),
      choices: [...document.querySelectorAll('#netz-panel .netz-launch-choice strong')]
        .map(element => element.textContent.trim()),
    };
    openNetzWorkspace('create');
    const create = {
      panelClosed: !document.getElementById('netz-panel').classList.contains('visible'),
      sidebarActive: document.getElementById('lp-netz').classList.contains('active'),
      workspaceVisible: !document.getElementById('netz-workspace').hidden,
      menuInSidebar: document.getElementById('netz-create-menu').parentElement.id === 'netz-workspace-create',
      settingsInSidebar: document.getElementById('netz-settings-content').parentElement.id === 'netz-workspace-settings',
      centralAvailable: Boolean(document.querySelector('#netz-workspace-central #netz-zentrale')),
      creationOrder: [
        document.getElementById('netz-workspace-central'),
        document.getElementById('netz-workspace-create'),
        document.querySelector('#netz-workspace > .netz-workspace-settings'),
      ].map(element => [...element.parentElement.children].indexOf(element)),
      furtherSettingsCollapsed: !document.querySelector('#netz-workspace > .netz-workspace-settings').open,
      overviewHidden: document.getElementById('lp-netz-waerme').hidden,
      typeOptions: [...document.querySelectorAll('.netz-workspace-type button')].map(button=>button.textContent.trim()),
      bestandActive: document.getElementById('btn-netz-type-bestand').classList.contains('active'),
    };
    setWaermeNetzType(false);
    create.neubauSelectable = !window.networkLocked &&
      document.getElementById('btn-netz-type-neubau').classList.contains('active');
    setWaermeNetzType(true);
    closeNetzWorkspace();
    openNetzWorkspace('edit');
    const edit = {
      visible: !document.getElementById('netz-workspace-edit').hidden,
      actions: [...document.querySelectorAll('#netz-workspace-edit .netz-workspace-action strong')]
        .map(element => element.textContent.trim()),
      duplicateEditIds: document.querySelectorAll('#btn-netz-edit-mode').length,
      duplicateRewireIds: document.querySelectorAll('#btn-netz-rewire-mode').length,
      hasPruningAction: document.getElementById('netz-workspace-edit').textContent.includes('Leitungsabschnitte deaktivieren'),
      renovationInEconomics: document.getElementById('netz-sanierung-toggle')?.closest('#wirtschaft-panel') !== null,
      centralAvailable: Boolean(document.querySelector('#netz-workspace-central #netz-zentrale')),
      editingOrder: [
        document.getElementById('netz-workspace-central'),
        document.getElementById('netz-workspace-edit'),
        document.querySelector('#netz-workspace > .netz-workspace-settings'),
      ].map(element => [...element.parentElement.children].indexOf(element)),
    };
    closeNetzWorkspace();
    return {launcher,create,edit};
  });

  expect(result.launcher).toEqual({
    visible:true,
    choices:['Wärmenetz erstellen','Wärmenetz bearbeiten'],
  });
  expect(result.create).toEqual({
    panelClosed:true,sidebarActive:true,workspaceVisible:true,menuInSidebar:true,
    settingsInSidebar:true,centralAvailable:true,creationOrder:[1,2,4],furtherSettingsCollapsed:true,overviewHidden:true,
    typeOptions:['🏛 Bestand 2026','Neubaunetz'],bestandActive:true,neubauSelectable:true,
  });
  expect(result.edit.visible).toBe(true);
  expect(result.edit.actions[0]).toBe('Gebäude anschließen / umhängen');
  expect(result.edit.actions).toContain('Leitungsverläufe bearbeiten');
  expect(result.edit.actions).toContain('Netz verwerfen');
  expect(result.edit.duplicateEditIds).toBe(1);
  expect(result.edit.duplicateRewireIds).toBe(1);
  expect(result.edit.hasPruningAction).toBe(false);
  expect(result.edit.renovationInEconomics).toBe(true);
  expect(result.edit.centralAvailable).toBe(true);
  expect(result.edit.editingOrder).toEqual([1,3,4]);
});

test('dist: Straßennetz nutzt versorgungsrelevante Wege und verwirft unbenutzte Äste', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.autoGenerateNetz === 'function');

  const result = await page.evaluate(() => {
    clearNetz();
    setGebaeude([]);
    const add = (id, lat, lng) => {
      const building = addGebaeude({id, name:`Haus ${id}`, baujahr:2000, skipAutoCreate:true, coords:[
        L.latLng(lat-.00003,lng-.00003), L.latLng(lat-.00003,lng+.00003),
        L.latLng(lat+.00003,lng+.00003), L.latLng(lat+.00003,lng-.00003),
      ]});
      building.heizlast = '50'; building.waerme = '100';
    };
    add(201,52.0812,8.0038); add(202,52.0818,8.0042);
    populateZentraleSelect(); document.getElementById('netz-zentrale').value = '201';
    setTrassePoints([
      L.latLng(52.0810,8.0040), L.latLng(52.0820,8.0040),
      L.latLng(52.0900,8.0200), L.latLng(52.0910,8.0200),
    ]);
    setTrasseSegments([
      {start:0,end:1,domains:['waerme']},
      {start:2,end:3,domains:['waerme']},
    ]);
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'street',trasseTreue:85});
    return {
      edges: window.netzEdges.length,
      hasUnusedRoad: window.netzEdges.some(edge =>
        [edge.uNode,edge.vNode].some(node => node.type === 'trasse' && node.pt.lat > 52.089)),
    };
  });

  expect(result.edges).toBeGreaterThan(0);
  expect(result.hasUnusedRoad).toBe(false);
  await page.waitForFunction(() => window.netzEdges.some(edge =>
    edge.layer?._path?.style?.strokeDasharray === '12, 12'));
});

test('dist: OSM-Straßen werden parallel geladen und für dasselbe Gebiet wiederverwendet', async ({page}) => {
  let osmRequests = 0;
  await page.route(/overpass|corsproxy/, async route => {
    osmRequests++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({elements:[{
        type:'way', id:123, tags:{highway:'residential',name:'Teststraße'},
        geometry:[{lat:52.081,lon:8.003},{lat:52.082,lon:8.004}],
      }]}),
    });
  });
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadOsmStrassen === 'function');

  const first = await page.evaluate(async () => {
    setAreaLatLngs([
      L.latLng(52.080,8.002), L.latLng(52.080,8.005),
      L.latLng(52.083,8.005), L.latLng(52.083,8.002),
    ]);
    const started = performance.now();
    await loadOsmStrassen();
    return {duration:performance.now()-started, text:document.getElementById('btn-osm-strassen')?.textContent};
  });
  const afterFirst = osmRequests;
  const second = await page.evaluate(async () => {
    const started = performance.now();
    await loadOsmStrassen();
    return {duration:performance.now()-started, text:document.getElementById('btn-osm-strassen')?.textContent};
  });

  expect(afterFirst).toBeGreaterThan(0);
  expect(osmRequests).toBe(afterFirst);
  expect(first.text).toContain('1 geladen');
  expect(second.text).toContain('1 geladen');
  expect(second.duration).toBeLessThan(first.duration + 50);
});

test('dist: Gebäudeanschluss lässt sich vom Nachbargebäude an die Haupttrasse umhängen', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.rewireBuildingConnection==='function');

  const result=await page.evaluate(()=>{
    clearNetz(); setGebaeude([]); setNetworkLocked(false);
    const add=(id,lat,lng)=>{
      const building=addGebaeude({id,name:`Haus ${id}`,baujahr:2000,skipAutoCreate:true,coords:[
        L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
        L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
      ]});
      building.heizlast='60';building.waerme='120';
    };
    add(301,52.0830,8.0030);add(302,52.0831,8.0032);
    populateZentraleSelect();document.getElementById('netz-zentrale').value='301';
    setTrassePoints([L.latLng(52.081,8.004),L.latLng(52.082,8.004)]);
    setTrasseSegments([{start:0,end:1,domains:['waerme']}]);
    autoGenerateNetz({strategy:'trasse',trasseTreue:0});
    const beforeNeighbour=window.netzEdges.some(edge =>
      (edge.u===301&&edge.v===302)||(edge.u===302&&edge.v===301));
    const trunk=window.netzEdges.find(edge=>edge.uNode.type!=='geb'&&edge.vNode.type!=='geb');
    const target=L.latLng((trunk.uNode.pt.lat+trunk.vNode.pt.lat)/2,(trunk.uNode.pt.lng+trunk.vNode.pt.lng)/2);
    toggleNetzRewireMode();
    let handle=null;
    map.eachLayer(layer=>{if(layer._netzBuildingId===302)handle=layer;});
    handle.fire('dragstart',{target:handle});
    handle.setLatLng(target);
    handle.fire('drag',{target:handle});
    handle.fire('dragend',{target:handle});
    return {
      beforeNeighbour,handleFound:!!handle,
      afterNeighbour:window.netzEdges.some(edge =>
        (edge.u===301&&edge.v===302)||(edge.u===302&&edge.v===301)),
      direct:window.netzEdges.some(edge =>
        (edge.u===302&&edge.vNode.type!=='geb')||(edge.v===302&&edge.uNode.type!=='geb')),
      validation:window._waermeNetzValidation,
    };
  });

  expect(result.beforeNeighbour).toBe(true);
  expect(result.handleFound).toBe(true);
  expect(result.afterNeighbour).toBe(false);
  expect(result.direct).toBe(true);
  expect(result.validation).toEqual({cycleEdges:0,disconnectedConsumerIds:[]});
});

test('dist: neu gezeichnetes Gebäude erhält einen Anschluss an das gesperrte Bestandsnetz', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.connectGebToNearestPipe === 'function');

  const result = await page.evaluate(() => {
    clearNetz();
    setGebaeude([]);
    const addExisting = (id,lat,lng,name) => {
      const g = addGebaeude({id,name,baujahr:1990,skipAutoCreate:true,coords:[
        L.latLng(lat-.00004,lng-.00004),L.latLng(lat-.00004,lng+.00004),
        L.latLng(lat+.00004,lng+.00004),L.latLng(lat+.00004,lng-.00004),
      ]});
      g.heizlast='80'; g.waerme='160';
      return g;
    };
    addExisting(501,52.0810,8.0040,'Zentrale');
    addExisting(502,52.0820,8.0040,'Bestand');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='501';
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'quick',trasseTreue:50});
    recalcNetz();
    window.netzEdges.forEach(edge => { edge.dn=65; });
    const existingLength = window.netzEdges.reduce((sum,edge) => sum + edge.length,0);
    const loadBefore = Math.max(...window.netzEdges.map(edge => edge.load));
    setNetworkLocked(true);

    const newcomer = addGebaeude({id:503,name:'Neubau 2030',baujahr:2030});
    window.drawPoints=[
      L.latLng(52.08146,8.00446),L.latLng(52.08146,8.00454),
      L.latLng(52.08154,8.00454),L.latLng(52.08154,8.00446),
    ];
    finishDraw();
    const futureConnection = window.netzEdges.find(edge => edge.u===503 || edge.v===503);
    const hiddenBeforeConstruction = Boolean(futureConnection?.temporallyHidden) &&
      !map.hasLayer(futureConnection.layer) && !map.hasLayer(futureConnection.hitLayer);
    newcomer.heizlast='60'; newcomer.waerme='120';
    setGlobalYearValue(2035);
    recalcNetz();

    const connectionEdges = window.netzEdges.filter(edge => edge.u===503 || edge.v===503);
    const existingParts = window.netzEdges.filter(edge => edge.u!==503 && edge.v!==503);
    return {
      locked:window.networkLocked,
      connectionCount:connectionEdges.length,
      connectionDn:connectionEdges[0]?.dn || 0,
      hiddenBeforeConstruction,
      visibleAfterConstruction:map.hasLayer(connectionEdges[0]?.layer),
      existingDns:[...new Set(existingParts.map(edge => edge.dn))],
      existingLengthBefore:existingLength,
      existingLengthAfter:existingParts.reduce((sum,edge) => sum + edge.length,0),
      loadBefore,
      loadAfter:Math.max(...window.netzEdges.map(edge => edge.load)),
    };
  });

  expect(result.locked).toBe(true);
  expect(result.connectionCount).toBe(1);
  expect(result.hiddenBeforeConstruction).toBe(true);
  expect(result.visibleAfterConstruction).toBe(true);
  expect(result.connectionDn).toBeGreaterThan(0);
  expect(result.existingDns).toEqual([65]);
  expect(result.existingLengthAfter).toBeCloseTo(result.existingLengthBefore,1);
  expect(result.loadAfter).toBeGreaterThan(result.loadBefore);
});

test('dist: Bestands- und Neubaunetz folgen unterschiedlichen Zeit- und Sperrregeln', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.autoGenerateNetz === 'function');

  const result = await page.evaluate(() => {
    clearNetz(); setGebaeude([]); setTrassePoints([]); setTrasseSegments([]);
    const add = (id,lat,lng,baujahr,heizlast) => {
      const g = addGebaeude({id,name:`Gebäude ${id}`,baujahr,skipAutoCreate:true,coords:[
        L.latLng(lat-.000035,lng-.000035),L.latLng(lat-.000035,lng+.000035),
        L.latLng(lat+.000035,lng+.000035),L.latLng(lat+.000035,lng-.000035),
      ]});
      g.heizlast=String(heizlast); g.waerme=String(heizlast*2);
      return g;
    };
    add(601,52.0810,8.0040,2000,120);
    add(602,52.0818,8.0040,2000,120);
    add(603,52.0824,8.0042,2035,600);
    populateZentraleSelect(); document.getElementById('netz-zentrale').value='601';

    // Neubaunetz: schon 2026 für den späteren Spitzenzustand dimensioniert.
    setGlobalYearValue(2026); setNetworkLocked(false);
    autoGenerateNetz({strategy:'quick',trasseTreue:50});
    const newBuildIds = new Set(window.netzEdges.flatMap(edge => [edge.u,edge.v]));
    const dn2026 = window.netzEdges.map(edge => edge.dn);
    const futureEdge2026 = window.netzEdges.find(edge => edge.u===603 || edge.v===603);
    const futureHidden2026 = Boolean(futureEdge2026?.temporallyHidden);
    setGlobalYearValue(2035); recalcNetz();
    const dn2035 = window.netzEdges.map(edge => edge.dn);
    const newNetwork = {
      includesFuture:newBuildIds.has(603),
      stableDn:JSON.stringify(dn2026)===JSON.stringify(dn2035),
      hiddenBeforeBuild:futureHidden2026,
      futureVisible:futureEdge2026 ? map.hasLayer(futureEdge2026.layer) : false,
      bottlenecks:window._netzPumpe?.bottleneckCount || 0,
      limitsOk:window.netzEdges.filter(edge => edge.load>0)
        .every(edge => edge.dpPerM <= edge.dpLimit + 0.001 && edge._vActual <= edge.velocityLimit + 0.001),
    };

    // Bestandsnetz: unabhängig vom gewählten Jahr aus dem Bestand 2026
    // aufgebaut, späteres Gebäude nur über einen zeitlichen Hausanschluss.
    clearNetz(); setGlobalYearValue(2040); setNetworkLocked(true);
    autoGenerateNetz({strategy:'quick',trasseTreue:50});
    const plannedConnection = window.netzEdges.find(edge =>
      (edge.u===603 || edge.v===603) && edge.visibleFromYear===2035);
    const permanentEdges = window.netzEdges.filter(edge => edge.visibleFromYear == null);
    permanentEdges.forEach(edge => { edge.dn=15; });
    recalcNetz();
    const initialBottlenecks=window._netzPumpe?.bottleneckCount || 0;
    const permanentEdge=permanentEdges[0];
    const dnStages=[permanentEdge.dn];
    showEdgePopup(permanentEdge,{clientX:400,clientY:300});
    setEdgeDN(200);
    dnStages.push(permanentEdge.dn);
    closeEdgePopup();
    const editAllowed=setNetzEditMode(true)===true;
    setNetzEditMode(false);
    const pruningAllowed=toggleEdgePruned(permanentEdge)!==false && permanentEdge.pruned===true;
    dnStages.push(permanentEdge.dn);
    toggleEdgePruned(permanentEdge);
    dnStages.push(permanentEdge.dn);
    setNetzRewireMode(true);
    const rewireHandles=document.querySelectorAll('.netz-rewire-handle').length;
    setNetzRewireMode(false);
    const bestands = {
      plannedConnection:Boolean(plannedConnection),
      permanentDns:[...new Set(permanentEdges.map(edge => edge.dn))],
      bottlenecks:window._netzPumpe?.bottleneckCount || 0,
      initialBottlenecks,editAllowed,pruningAllowed,rewireHandles,dnStages,
    };

    // Problemfall aus der Bedienung: Bestand löschen, Trasse löschen,
    // anschließend ohne Altzustand ein Neubaunetz erzeugen.
    window.confirm=()=>true;
    const deleted=confirmClearNetz();
    clearTrasse();
    const stayedBestandAfterDelete=window.networkLocked;
    setNetworkLocked(false);
    setGlobalYearValue(2026);
    autoGenerateNetz({strategy:'quick',trasseTreue:50});
    const manualEdge=window.netzEdges[0];
    showEdgePopup(manualEdge,{clientX:400,clientY:300});
    setEdgeDN(80);
    closeEdgePopup();
    const restart = {
      deleted,stayedBestandAfterDelete,
      edgeCount:window.netzEdges.length,
      includesFuture:new Set(window.netzEdges.flatMap(edge => [edge.u,edge.v])).has(603),
      manualDn:manualEdge.dn,
      stayedNeubau:!window.networkLocked,
    };
    const emptyGraphProject=_buildProjectData();
    emptyGraphProject.waermeNetzGraph={nodes:[],edges:[]};
    emptyGraphProject.customEdges=[];
    _loadProject(emptyGraphProject);
    restart.emptyGraphRecovered=window.netzEdges.length>0;
    return {newNetwork,bestands,restart};
  });

  expect(result.newNetwork).toEqual({
    includesFuture:true,stableDn:true,hiddenBeforeBuild:true,
    futureVisible:true,bottlenecks:0,limitsOk:true,
  });
  expect(result.bestands.plannedConnection).toBe(true);
  expect(result.bestands.dnStages).toEqual([15,200,200,200]);
  expect(result.bestands.permanentDns).toEqual([200]);
  expect(result.bestands.initialBottlenecks).toBeGreaterThan(0);
  expect(result.bestands.bottlenecks).toBe(0);
  expect(result.bestands.editAllowed).toBe(true);
  expect(result.bestands.pruningAllowed).toBe(true);
  expect(result.bestands.rewireHandles).toBeGreaterThan(0);
  expect(result.restart).toEqual({
    deleted:true,stayedBestandAfterDelete:true,edgeCount:2,includesFuture:true,
    manualDn:80,stayedNeubau:true,emptyGraphRecovered:true,
  });
});

test('dist: unverbundenes Gebäude lässt sich an ein bestehendes Bestandsnetz anschließen', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.rewireBuildingConnection === 'function');

  const result=await page.evaluate(() => {
    clearNetz(); setGebaeude([]); setNetworkLocked(true);
    const add=(id,lat,lng,name) => {
      const g=addGebaeude({id,name,baujahr:2000,skipAutoCreate:true,coords:[
        L.latLng(lat-.000035,lng-.000035),L.latLng(lat-.000035,lng+.000035),
        L.latLng(lat+.000035,lng+.000035),L.latLng(lat+.000035,lng-.000035),
      ]});
      g.heizlast='100'; g.waerme='200';
      return g;
    };
    add(701,52.0810,8.0040,'Zentrale');
    add(702,52.0820,8.0040,'Bestand');
    populateZentraleSelect(); document.getElementById('netz-zentrale').value='701';
    addNetzEdge(701,702);
    recalcNetz();

    add(703,52.0820,8.0050,'Wiederanschluss');
    const before=window.netzEdges.some(edge=>edge.u===703||edge.v===703);
    setNetzRewireMode(true);
    const handles=document.querySelectorAll('.netz-rewire-handle').length;
    setNetzRewireMode(false);

    const target=window.netzEdges[0];
    const targetPoint=L.latLng(
      (target.uNode.pt.lat+target.vNode.pt.lat)/2,
      (target.uNode.pt.lng+target.vNode.pt.lng)/2
    );
    const connected=rewireBuildingConnection(703,target,targetPoint);
    const connection=window.netzEdges.find(edge=>edge.u===703||edge.v===703);
    setNetzEditMode(true);
    const editable=Boolean(connection?.midMarker && map.hasLayer(connection.midMarker));
    setNetzEditMode(false);
    return {before,connected,editable,handles,edgeCount:window.netzEdges.length};
  });

  expect(result).toEqual({
    before:false,
    connected:true,
    editable:true,
    handles:2,
    edgeCount:3,
  });
});

test('dist: Ersetzen eines vorhandenen Netzes nutzt den gestalteten Programmdialog',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.confirmAutoGenerateNetz==='function'&&typeof window.epConfirm==='function');
  await page.evaluate(()=>{
    setNetzEdges(Array.from({length:130},(_,index)=>({u:index,v:index+1})));
    window._netzReplaceResult=confirmAutoGenerateNetz({strategy:'quick'});
    return true;
  });
  const modal=page.locator('.ep-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.ep-modal-title')).toHaveText('Wärmenetz neu erstellen');
  await expect(modal.locator('.ep-modal-body')).toContainText('130 Leitungsabschnitten');
  await expect(modal.locator('#ep-m-ok')).toHaveText('Netz ersetzen');
  await modal.locator('#ep-m-cancel').click();
  await expect(modal).toBeHidden();
  expect(await page.evaluate(()=>window._netzReplaceResult)).toBe(false);
  expect(await page.evaluate(()=>window.netzEdges.length)).toBe(130);
});

test('dist: Lebenszyklus-Optimierung kann mehrere wirtschaftliche Zentralabgänge bilden',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.autoGenerateNetz==='function');
  const result=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const makeBuilding=(id,lat,lng,name,load=1200)=>{
      const building=addGebaeude({
        id,name,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00004,lng-.00004),L.latLng(lat-.00004,lng+.00004),
          L.latLng(lat+.00004,lng+.00004),L.latLng(lat+.00004,lng-.00004),
        ],
      });
      building.heizlast=String(load);
      building.waerme=String(load*2);
    };
    makeBuilding(901,52.08,8,'Zentrale',1);
    [
      [52.082,8],[52.0814,8.0021],[52.0793,8.0028],
      [52.078,8],[52.0793,7.9972],[52.0814,7.9979],
    ].forEach((point,index)=>makeBuilding(902+index,...point,`Haus ${index+1}`));
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='901';
    document.getElementById('wirt-p-strom').value='45';
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'quick',trasseTreue:0});
    const connectedIds=new Set(window.netzEdges.flatMap(edge=>[edge.u,edge.v]));
    return {
      meta:window._netzTopologyOptimization,
      edgeCount:window.netzEdges.length,
      nodeCount:connectedIds.size,
      centralDegree:window.netzEdges.filter(edge=>edge.u===901||edge.v===901).length,
    };
  });
  expect(result.edgeCount).toBe(result.nodeCount-1);
  expect(result.centralDegree).toBeGreaterThan(1);
  expect(result.meta.swaps).toBeGreaterThan(0);
  expect(result.meta.centralBranchesAfter).toBeGreaterThan(result.meta.centralBranchesBefore);
  expect(result.meta.scoreAfterEur).toBeLessThan(result.meta.scoreBeforeEur);
});
