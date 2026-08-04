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
    window.epConfirm=async()=>false;
    const lockedClearResult = await confirmClearNetz();
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
      visibleTrasseDelete: [...document.querySelectorAll('#netz-create-menu button')]
        .some(button => button.textContent.includes('Gezeichnete Haupttrasse löschen')),
      trassentreue: document.getElementById('netz-trassentreue')?.value,
      markerSurvivedDrag,
      lockedState,
    };
  });

  expect(result.segments).toHaveLength(2);
  expect(result.points).toHaveLength(5);
  expect(result.points[3].lng).toBeCloseTo(8.0035, 4);
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
    'Netz vollständig manuell zeichnen',
  ]);
  expect(result.visibleTrasseDelete).toBe(true);
  expect(result.trassentreue).toBe('80');
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
  expect(result.editHandles).toBe(0);
  expect(result.buildingIds).toEqual([101, 102]);
  expect(pageErrors).toHaveLength(0);
});

test('dist: vollständig manuelles Wärmenetz übernimmt nur die gezeichneten Leitungsabschnitte', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.createManualWaermeNetzFromTrasse === 'function');
  const result = await page.evaluate(async () => {
    clearNetz();
    setGebaeude([]);
    const add = (id,lat,lng,name) => {
      const building = addGebaeude({
        id,name,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
          L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
        ],
      });
      building.heizlast='80';
      building.waerme='160';
      return building;
    };
    add(1201,52.08,8,'Zentrale');
    add(1202,52.08,8.002,'Haus Ost');
    add(1203,52.081,8.001,'Haus Nord');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1201';
    setNetworkLocked(true);
    const branch=L.latLng(52.08,8.001);
    setTrassePoints([
      L.latLng(52.08,8),branch,L.latLng(52.08,8.002),
      branch,L.latLng(52.0805,8.0013),L.latLng(52.081,8.001),
    ]);
    setTrasseSegments([
      {start:0,end:2,domains:['waerme'],manualNetwork:true},
      {start:3,end:5,domains:['waerme'],manualNetwork:true},
    ]);
    const created=createManualWaermeNetzFromTrasse();
    return {
      created,
      edgeCount:window.netzEdges.length,
      buildingIds:[...new Set(window.netzEdges.flatMap(edge=>[edge.u,edge.v]))]
        .filter(id=>id>=1201&&id<=1203).sort(),
      nodeTypes:[...new Set(window.netzEdges.flatMap(edge=>[edge.uNode.type,edge.vNode.type]))].sort(),
      lengths:window.netzEdges.map(edge=>Math.round(edge.length)),
      trasseVisible:window.trasseVisible,
    };
  });
  expect(result.created).toBe(true);
  expect(result.edgeCount).toBe(4);
  expect(result.buildingIds).toEqual([1201,1202,1203]);
  expect(result.nodeTypes).toEqual(['geb','junction']);
  expect(result.lengths.every(length=>length>0)).toBe(true);
  expect(result.trasseVisible).toBe(false);
});

test('dist: manuelles Netz dockt Gebäude per Klick an und blendet alte Straßentrassen aus', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.startManualWaermeNetzCreation === 'function');
  const result = await page.evaluate(() => {
    clearNetz();
    setGebaeude([]);
    const add = (id,lat,lng,name) => {
      const building=addGebaeude({
        id,name,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
          L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
        ],
      });
      building.heizlast='80';
      building.waerme='160';
      return building;
    };
    const central=add(1251,52.08,8,'Zentrale');
    const east=add(1252,52.08,8.002,'Haus Ost');
    const north=add(1253,52.081,8.001,'Haus Nord');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1251';
    setNetworkLocked(true);
    setTrassePoints([L.latLng(52.079,7.999),L.latLng(52.079,8.003)]);
    setTrasseSegments([{start:0,end:1,domains:['waerme'],source:'osm-street'}]);
    startManualWaermeNetzCreation();
    const oldStreetLayersWhileDrawing=window.trassePolyline.length;
    central.polygonLayer.fire('click');
    east.polygonLayer.fire('click');
    const afterFirst={
      detached:window.trasseDetached,
      manualSegments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      eastColor:east.polygonLayer.options.color,
    };
    central.polygonLayer.fire('click');
    const afterSecondStart={
      manualSegments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      activePoints:window.trassePoints.length-window.trasseCurrentSegStart,
      detached:window.trasseDetached,
    };
    north.polygonLayer.fire('click');
    document.getElementById('trasse-undo-btn').click();
    const afterUndo={
      manualSegments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      activePoints:window.trassePoints.length-window.trasseCurrentSegStart,
    };
    document.getElementById('trasse-redo-btn').click();
    const afterRedo={
      manualSegments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      detached:window.trasseDetached,
    };
    const subtitle=document.querySelector('#trasse-editor-bar .trasse-editor-title span')?.textContent;
    toggleDrawTrasse();
    const created=createManualWaermeNetzFromTrasse();
    return {
      oldStreetLayersWhileDrawing,
      afterFirst,
      afterSecondStart,
      afterUndo,
      afterRedo,
      subtitle,
      created,
      connectedBuildings:[...new Set(window.netzEdges.flatMap(edge=>[edge.u,edge.v]))]
        .filter(id=>id>=1251&&id<=1253).sort(),
    };
  });
  expect(result.oldStreetLayersWhileDrawing).toBe(0);
  expect(result.afterFirst.detached).toBe(true);
  expect(result.afterFirst.manualSegments).toBe(1);
  expect(result.afterFirst.eastColor).toBe('#66bb6a');
  expect(result.afterSecondStart).toEqual({manualSegments:1,activePoints:1,detached:false});
  expect(result.afterUndo).toEqual({manualSegments:1,activePoints:1});
  expect(result.afterRedo).toEqual({manualSegments:2,detached:true});
  expect(result.subtitle).toContain('3 Gebäude angeschlossen · 0 ausstehend');
  expect(result.created).toBe(true);
  expect(result.connectedBuildings).toEqual([1251,1252,1253]);
});

test('dist: Rechtsklick beendet einen manuellen Strang und Doppel-Rechtsklick nimmt den letzten Punkt zurück',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.startManualWaermeNetzCreation==='function');
  const result=await page.evaluate(async()=>{
    clearNetz();
    setGebaeude([]);
    const building=addGebaeude({
      id:1281,name:'Zentrale',baujahr:2000,skipAutoCreate:true,
      coords:[
        L.latLng(52.07997,7.99997),L.latLng(52.07997,8.00003),
        L.latLng(52.08003,8.00003),L.latLng(52.08003,7.99997),
      ],
    });
    building.heizlast='80'; building.waerme='160';
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1281';
    setTrassePoints([]); setTrasseSegments([]);
    startManualWaermeNetzCreation();
    building.polygonLayer.fire('click');
    map.fire('click',{latlng:L.latLng(52.0802,8.0003)});
    map.fire('contextmenu',{latlng:L.latLng(52.0802,8.0003)});
    map.fire('contextmenu',{latlng:L.latLng(52.0802,8.0003)});
    const afterDoubleRight={
      activePoints:window.trassePoints.length-window.trasseCurrentSegStart,
      segments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
    };
    map.fire('click',{latlng:L.latLng(52.0802,8.0003)});
    map.fire('contextmenu',{latlng:L.latLng(52.0802,8.0003)});
    await new Promise(resolve=>setTimeout(resolve,350));
    const afterSingleRight={
      detached:window.trasseDetached,
      segments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      activePoints:window.trassePoints.length-window.trasseCurrentSegStart,
    };
    map.fire('click',{latlng:L.latLng(52.0805,8.0005)});
    const afterNextLeft={
      detached:window.trasseDetached,
      segments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      activePoints:window.trassePoints.length-window.trasseCurrentSegStart,
    };
    return {afterDoubleRight,afterSingleRight,afterNextLeft};
  });
  expect(result.afterDoubleRight).toEqual({activePoints:1,segments:0});
  expect(result.afterSingleRight).toEqual({detached:true,segments:1,activePoints:0});
  expect(result.afterNextLeft).toEqual({detached:false,segments:1,activePoints:1});
});

test('dist: verschobener manueller Anschlusspunkt aktualisiert Gebäude und Linien-Snap fügt einen Abzweig ein',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.startManualWaermeNetzCreation==='function');
  const result=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const add=(id,lat,lng,name)=>{
      const building=addGebaeude({
        id,name,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
          L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
        ],
      });
      building.heizlast='80'; building.waerme='160';
      return building;
    };
    const central=add(1291,52.08,8,'Zentrale');
    const east=add(1292,52.08,8.002,'Haus Ost');
    const north=add(1293,52.081,8.001,'Haus Nord');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1291';
    setTrassePoints([]); setTrasseSegments([]);
    startManualWaermeNetzCreation();
    central.polygonLayer.fire('click');
    east.polygonLayer.fire('click');

    // Zum Bearbeiten aus dem Abzweig-Wartemodus zurückkehren und den
    // Anschluss-Endpunkt vom Ost- auf das Nordgebäude ziehen.
    setTrasseDetached(false);
    redrawTrasse();
    const eastCenter=polygonCenter(east.polygon);
    const northCenter=polygonCenter(north.polygon);
    const selectableEndpoint=window.trasseEditMarkers
      .find(marker=>marker.getLatLng().distanceTo(eastCenter)<1);
    selectableEndpoint.fire('click');
    const endpoint=window.trasseEditMarkers
      .filter(marker=>marker.options.draggable)
      .find(marker=>marker.getLatLng().distanceTo(eastCenter)<1);
    endpoint.fire('dragstart',{target:endpoint});
    endpoint.setLatLng(northCenter);
    endpoint.fire('drag',{target:endpoint});
    endpoint.fire('dragend',{target:endpoint});
    const colorsAfterMove={
      east:east.polygonLayer.options.color,
      north:north.polygonLayer.options.color,
    };

    // Ein neuer Strang startet per Klick mitten auf der vorhandenen Leitung.
    setTrasseDetached(true);
    redrawTrasse();
    const midpoint=L.latLng(
      (polygonCenter(central.polygon).lat+northCenter.lat)/2,
      (polygonCenter(central.polygon).lng+northCenter.lng)/2,
    );
    map.fire('click',{latlng:midpoint});
    const manualSegment=window.trasseSegments.find(segment=>segment.manualNetwork);
    return {
      colorsAfterMove,
      segmentPointCount:manualSegment.end-manualSegment.start+1,
      activePointCount:window.trassePoints.length-window.trasseCurrentSegStart,
      insertedMatchesStart:window.trassePoints[manualSegment.start+1]
        .distanceTo(window.trassePoints[window.trasseCurrentSegStart])<.1,
    };
  });
  expect(result.colorsAfterMove.east).toBe('rgba(255,255,255,.84)');
  expect(result.colorsAfterMove.north).toBe('#66bb6a');
  expect(result.segmentPointCount).toBe(3);
  expect(result.activePointCount).toBe(1);
  expect(result.insertedMatchesStart).toBe(true);
});

test('dist: Rechtsklick auf einen Stützpunkt löscht nur diesen Punkt und bleibt rückgängig machbar',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.deleteTrassePoint==='function');
  const result=await page.evaluate(()=>{
    setTrassePoints([
      L.latLng(52.08,8),
      L.latLng(52.0805,8.0005),
      L.latLng(52.081,8.001),
    ]);
    setTrasseSegments([{start:0,end:2,domains:['waerme'],manualNetwork:true}]);
    window._manualWaermeNetzDrawing=true;
    toggleDrawTrasse('waerme');
    const middle=window.trasseEditMarkers.find(marker=>marker._trassePointIndex===1);
    middle.fire('contextmenu');
    const afterMiddleDelete={
      points:window.trassePoints.length,
      segmentLength:window.trasseSegments[0].end-window.trasseSegments[0].start+1,
    };
    document.getElementById('trasse-undo-btn').click();
    const afterUndo={
      points:window.trassePoints.length,
      segmentLength:window.trasseSegments[0].end-window.trasseSegments[0].start+1,
    };
    const endpoint=window.trasseEditMarkers.find(marker=>marker._trassePointIndex===0);
    endpoint.fire('contextmenu');
    const afterEndpointDelete={
      points:window.trassePoints.length,
      segments:window.trasseSegments.length,
    };
    const lastShortEndpoint=window.trasseEditMarkers.find(marker=>marker._trassePointIndex===0);
    lastShortEndpoint.fire('contextmenu');
    return {
      afterMiddleDelete,
      afterUndo,
      afterEndpointDelete,
      afterShortSegmentDelete:{
        points:window.trassePoints.length,
        segments:window.trasseSegments.length,
      },
    };
  });
  expect(result.afterMiddleDelete).toEqual({points:2,segmentLength:2});
  expect(result.afterUndo).toEqual({points:3,segmentLength:3});
  // Nach dem Undo besitzt der Strang wieder drei Punkte; ein Endpunkt kürzt
  // ihn daher auf zwei Punkte, statt den gesamten Strang zu entfernen.
  expect(result.afterEndpointDelete).toEqual({points:2,segments:1});
  expect(result.afterShortSegmentDelete).toEqual({points:0,segments:0});
});

test('dist: markierter bestehender Punkt startet ohne sichtbaren Doppelpunkt einen neuen Strang',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.startManualWaermeNetzCreation==='function');
  const result=await page.evaluate(()=>{
    setTrassePoints([
      L.latLng(52.08,8),
      L.latLng(52.0805,8.0005),
      L.latLng(52.081,8.001),
    ]);
    setTrasseSegments([{start:0,end:2,domains:['waerme'],manualNetwork:true}]);
    window._manualWaermeNetzDrawing=true;
    toggleDrawTrasse('waerme');
    setTrasseDetached(true);
    redrawTrasse();
    const point=window.trasseEditMarkers.find(marker=>marker._trassePointIndex===1);
    point.fire('click');
    const selected={
      draggable:window.trasseEditMarkers.some(marker=>
        marker._trassePointIndex===1&&marker.options.draggable),
      selectedHandles:document.querySelectorAll('.trasse-edit-handle-selected').length,
    };
    map.fire('click',{latlng:L.latLng(52.081,8.002)});
    return {
      selected,
      segments:window.trasseSegments.length,
      activePoints:window.trassePoints.length-window.trasseCurrentSegStart,
      renderedPointHandles:window.trasseEditMarkers
        .filter(marker=>marker._trassePointIndex!=null).length,
      activeStartsAtSelected:window.trassePoints[window.trasseCurrentSegStart]
        .distanceTo(window.trassePoints[1])<.1,
    };
  });
  expect(result.selected).toEqual({draggable:true,selectedHandles:1});
  expect(result.segments).toBe(1);
  expect(result.activePoints).toBe(2);
  expect(result.renderedPointHandles).toBe(4);
  expect(result.activeStartsAtSelected).toBe(true);
});

test('dist: automatisch erzeugtes Netz lässt sich als manuelle Zeichnung weiterbearbeiten',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.startManualWaermeNetzFromExisting==='function');
  const result=await page.evaluate(async()=>{
    clearNetz();
    clearTrasse();
    setGebaeude([]);
    const add=(id,lat,lng)=>{
      const building=addGebaeude({
        id,name:`Gebäude ${id}`,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
          L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
        ],
      });
      building.heizlast='80'; building.waerme='160';
    };
    add(1271,52.08,8);
    add(1272,52.0805,8.001);
    add(1273,52.081,8.002);
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1271';
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'quick'});
    const edgeCount=window.netzEdges.length;
    const edgeSignature=window.netzEdges.map(edge=>`${edge.u}:${edge.v}`).sort();
    const started=await startManualWaermeNetzFromExisting();
    return {
      started,
      drawing:window.isDrawingTrasse&&window._manualWaermeNetzDrawing,
      edgeCount,
      edgePreserved:window.netzEdges.length===edgeCount &&
        JSON.stringify(window.netzEdges.map(edge=>`${edge.u}:${edge.v}`).sort())===JSON.stringify(edgeSignature),
      manualSegments:window.trasseSegments.filter(segment=>segment.manualNetwork).length,
      sourceSet:[...new Set(window.trasseSegments.map(segment=>segment.source))],
    };
  });
  expect(result.started).toBe(true);
  expect(result.drawing).toBe(true);
  expect(result.edgePreserved).toBe(true);
  expect(result.manualSegments).toBe(result.edgeCount);
  expect(result.sourceSet).toEqual(['existing-network']);
});

test('dist: Löschen des Heizzentralengebäudes warnt gestaltet und entfernt nach Bestätigung das Wärmenetz',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.removeGebaeude==='function');
  const initial=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const add=(id,lat,lng,name)=>{
      const building=addGebaeude({
        id,name,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
          L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
        ],
      });
      building.heizlast='80'; building.waerme='160';
    };
    add(1261,52.08,8,'Heizzentrale Nord');
    add(1262,52.0805,8.001,'Verbraucher');
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1261';
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'quick'});
    return {edges:window.netzEdges.length};
  });
  expect(initial.edges).toBeGreaterThan(0);

  await page.evaluate(()=>{ window._centralDeletionPromise=removeGebaeude(1261); });
  const dialog=await page.locator('.ep-modal').evaluate(modal=>({
    title:modal.querySelector('.ep-modal-title')?.textContent,
    body:modal.querySelector('.ep-modal-body')?.textContent,
    danger:modal.querySelector('.ep-modal-btn.danger')?.textContent,
  }));
  expect(dialog.title).toBe('Heizzentralengebäude löschen');
  expect(dialog.body).toContain('gesamte Wärmenetz');
  expect(dialog.danger).toBe('Gebäude und Netz löschen');
  await page.locator('#ep-m-cancel').click();
  await page.evaluate(()=>window._centralDeletionPromise);
  const afterCancel=await page.evaluate(()=>({
    building:window.gebaeude.some(building=>building.id===1261),
    edges:window.netzEdges.length,
    central:document.getElementById('netz-zentrale').value,
  }));
  expect(afterCancel).toEqual({building:true,edges:initial.edges,central:'1261'});

  await page.evaluate(()=>{ window._centralDeletionPromise=removeGebaeude(1261); });
  await page.locator('#ep-m-ok').click();
  await page.evaluate(()=>window._centralDeletionPromise);
  const afterConfirm=await page.evaluate(()=>({
    building:window.gebaeude.some(building=>building.id===1261),
    edges:window.netzEdges.length,
    central:document.getElementById('netz-zentrale').value,
  }));
  expect(afterConfirm).toEqual({building:false,edges:0,central:''});
});

test('dist: mehrfach angesetzte Haupttrasse bildet am Linien-Snap einen echten Abzweig', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.autoGenerateNetz === 'function');
  const result = await page.evaluate(() => {
    clearNetz();
    setGebaeude([]);
    const add = (id,lat,lng) => {
      const building=addGebaeude({
        id,name:`Gebäude ${id}`,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.000025,lng-.000025),L.latLng(lat-.000025,lng+.000025),
          L.latLng(lat+.000025,lng+.000025),L.latLng(lat+.000025,lng-.000025),
        ],
      });
      building.heizlast='80';
      building.waerme='160';
    };
    add(1301,52.0798,8);
    add(1302,52.0798,8.002);
    add(1303,52.081,8.0013);
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1301';
    setNetworkLocked(false);
    const branch=L.latLng(52.08,8.001);
    setTrassePoints([
      L.latLng(52.08,8),L.latLng(52.08,8.002),
      branch,L.latLng(52.081,8.001),
    ]);
    setTrasseSegments([
      {start:0,end:1,domains:['waerme']},
      {start:2,end:3,domains:['waerme']},
    ]);
    const created=autoGenerateNetz({strategy:'trasse',trasseTreue:100});
    const branchNode=[...new Set(window.netzEdges.flatMap(edge=>[edge.uNode,edge.vNode]))]
      .find(node=>node.type==='trasse'&&node.pt.distanceTo(branch)<.5);
    const branchDegree=branchNode
      ? window.netzEdges.filter(edge=>edge.u===branchNode.id||edge.v===branchNode.id).length
      : 0;
    return {created,branchDegree};
  });
  expect(result.created).toBe(true);
  expect(result.branchDegree).toBeGreaterThanOrEqual(3);
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
      streetHelperInCreate: document.getElementById('netz-create-menu').textContent.includes('Fehlenden Weg ergänzen'),
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
    typeOptions:['🏛 Bestand 2026','Neubaunetz'],bestandActive:true,streetHelperInCreate:false,neubauSelectable:true,
  });
  expect(result.edit.visible).toBe(true);
  expect(result.edit.actions[0]).toBe('Gebäude anschließen / umhängen');
  expect(result.edit.actions).toContain('Leitungsverläufe bearbeiten');
  expect(result.edit.actions).toContain('Fehlenden Straßenverlauf ergänzen');
  expect(result.edit.actions).toContain('Netz verwerfen');
  expect(result.edit.duplicateEditIds).toBe(1);
  expect(result.edit.duplicateRewireIds).toBe(1);
  expect(result.edit.hasPruningAction).toBe(false);
  expect(result.edit.renovationInEconomics).toBe(true);
  expect(result.edit.centralAvailable).toBe(true);
  expect(result.edit.editingOrder).toEqual([1,3,4]);
});

test('dist: OSM-Routinggrundlage erzeugt keine tausenden Bearbeitungsgriffe', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.redrawTrasse === 'function');

  const result = await page.evaluate(() => {
    const osmPoints = Array.from({length: 1500}, (_, index) =>
      L.latLng(52 + index * 0.000001, 9 + index * 0.000001));
    const manualPoints = [L.latLng(52.002,9.002),L.latLng(52.003,9.003)];
    setTrassePoints([...osmPoints,...manualPoints]);
    setTrasseSegments([
      {start:0,end:osmPoints.length - 1,domains:['waerme'],source:'osm-street'},
      {start:osmPoints.length,end:osmPoints.length + 1,domains:['waerme']},
    ]);
    setTrasseCurrentSegStart(osmPoints.length + 2);
    window.trasseVisible = true;
    window._streetHelperDrawing = false;
    const started = performance.now();
    redrawTrasse();
    const calmHandles = window.trasseEditMarkers.length;
    toggleDrawTrasse('waerme');
    const editingHandles = window.trasseEditMarkers.length;
    toggleDrawTrasse();
    return {
      calmHandles,
      editingHandles,
      polylines: window.trassePolyline.length,
      durationMs: performance.now() - started,
    };
  });

  expect(result.calmHandles).toBe(0);
  expect(result.editingHandles).toBe(3);
  expect(result.polylines).toBe(2);
  expect(result.durationMs).toBeLessThan(1000);
});

test('dist: Netzbearbeitung zeigt nur am angeklickten Abschnitt einen neuen Ziehpunkt', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.setNetzEditMode === 'function');

  const result = await page.evaluate(() => {
    clearNetz();
    setGebaeude([]);
    const add = (id,lng) => {
      const building = addGebaeude({id,name:`Haus ${id}`,baujahr:2000,skipAutoCreate:true,coords:[
        L.latLng(52,lng),L.latLng(52,lng+.0001),
        L.latLng(52.0001,lng+.0001),L.latLng(52.0001,lng),
      ]});
      building.heizlast = '100';
      building.waerme = '200';
    };
    add(181,9); add(182,9.001); add(183,9.002);
    addNetzEdge(181,182);
    addNetzEdge(182,183);
    setNetzEditMode(true);
    const before = window.netzEdges.filter(edge => map.hasLayer(edge.midMarker)).length;
    window.netzEdges[1].hitLayer.fire('click',{originalEvent:{clientX:200,clientY:200}});
    const selected = window.netzEdges.filter(edge => map.hasLayer(edge.midMarker));
    return {
      before,
      after:selected.length,
      selectedEdge:selected[0] === window.netzEdges[1],
    };
  });

  expect(result.before).toBe(0);
  expect(result.after).toBe(1);
  expect(result.selectedEdge).toBe(true);
});

test('dist: gezogener Leitungspunkt routet über die gewählte Straßenseite', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.rerouteEdgeViaStreet === 'function');

  const result = await page.evaluate(() => {
    const bottom = L.latLng(52,9);
    const left = L.latLng(52.0005,8.9995);
    const top = L.latLng(52.001,9);
    const rightLower = L.latLng(52.00035,9.0005);
    const rightUpper = L.latLng(52.0007,9.0005);
    setTrassePoints([bottom,left,top,bottom,rightLower,rightUpper,top]);
    setTrasseSegments([
      {start:0,end:2,domains:['waerme'],source:'osm-street'},
      {start:3,end:6,domains:['waerme'],source:'osm-street'},
    ]);
    setTrasseCurrentSegStart(7);
    const layer = L.polyline([bottom,left,top]).addTo(map);
    const hitLayer = L.polyline([bottom,left,top]).addTo(map);
    const edge = {
      u:1,v:2,uNode:{id:1,type:'trasse',pt:bottom},vNode:{id:2,type:'trasse',pt:top},
      layer,hitLayer,waypoints:[left],waypointMarkers:[],
    };
    const routed = rerouteEdgeViaStreet(edge,rightLower);
    return {
      routed,
      waypoints: edge.waypoints.map(point => ({lat:point.lat,lng:point.lng})),
      fixedPoints: edge.routingViaPoints.map(point => ({lat:point.lat,lng:point.lng})),
      visibleHandles: edge.waypointMarkers.length,
    };
  });

  expect(result.routed).toBe(true);
  expect(result.waypoints.some(point => point.lng > 9.0004)).toBe(true);
  expect(result.waypoints.some(point => point.lng < 8.9996)).toBe(false);
  expect(result.fixedPoints).toHaveLength(1);
  expect(result.visibleHandles).toBe(1);
  expect(result.waypoints.length).toBeGreaterThan(result.fixedPoints.length);
});

test('dist: Straßennetz-Erstellung beendet einen offenen Gebäude-Zeichenmodus', async ({page}) => {
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.createStreetOrientedWaermeNetz === 'function');

  const result = await page.evaluate(async () => {
    startDraw(987654);
    const before = {
      drawingId: window.drawingId,
      tool: document.body.dataset.mapTool,
      label: document.getElementById('map-interaction-status')?.textContent || '',
    };
    window.loadOsmStrassen = async () => {};
    window.adoptAllOsmStrassen = () => 0;
    await createStreetOrientedWaermeNetz();
    return {
      before,
      drawingId: window.drawingId,
      tool: document.body.dataset.mapTool || null,
      statusVisible: Boolean(document.getElementById('map-interaction-status')),
    };
  });

  expect(result.before.drawingId).toBe(987654);
  expect(result.before.tool).toBe('draw-generator-area');
  expect(result.before.label).toContain('Gebäudegrundriss zeichnen');
  expect(result.drawingId).toBeNull();
  expect(result.tool).toBeNull();
  expect(result.statusVisible).toBe(false);
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

test('dist: Straßennetz bündelt Gebäude in einer OSM-Lücke zu einem freien Teilnetz',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.autoGenerateNetz==='function');
  const result=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const add=(id,lat,lng)=>{
      const building=addGebaeude({id,name:`Haus ${id}`,baujahr:2000,skipAutoCreate:true,coords:[
        L.latLng(lat-.00003,lng-.00003),L.latLng(lat-.00003,lng+.00003),
        L.latLng(lat+.00003,lng+.00003),L.latLng(lat+.00003,lng-.00003),
      ]});
      building.heizlast='100';
      building.waerme='200';
    };
    add(251,52.0800,8.0001);
    add(252,52.0800,8.0040);
    add(253,52.0803,8.0041);
    add(254,52.0806,8.0040);
    add(255,52.0809,8.0041);
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='251';
    setTrassePoints([L.latLng(52.0795,8),L.latLng(52.0815,8)]);
    setTrasseSegments([{start:0,end:1,domains:['waerme'],source:'osm-street'}]);
    setNetworkLocked(false);
    autoGenerateNetz({strategy:'street',trasseTreue:70});
    const buildingToRoad=window.netzEdges.filter(edge=>
      (edge.uNode.type==='geb'&&edge.vNode.type==='trasse')||
      (edge.vNode.type==='geb'&&edge.uNode.type==='trasse')).length;
    const freeEdges=window.netzEdges.filter(edge=>
      edge.uNode.type==='geb'&&edge.vNode.type==='geb');
    return {
      diagnostics:window._streetRoutingDiagnostics,
      buildingToRoad,
      freeEdges:freeEdges.length,
      maxFreeLength:Math.max(0,...freeEdges.map(edge=>edge.length)),
      connectedBuildings:new Set(window.netzEdges.flatMap(edge=>[edge.u,edge.v])
        .filter(id=>id>=251&&id<=255)).size,
    };
  });
  expect(result.diagnostics.uncoveredBuildings).toBe(4);
  expect(result.diagnostics.freeClusters).toBe(1);
  expect(result.diagnostics.gatewayBuildings).toBe(1);
  expect(result.buildingToRoad).toBe(2);
  expect(result.freeEdges).toBe(3);
  expect(result.maxFreeLength).toBeLessThan(result.diagnostics.localMaxM);
  expect(result.connectedBuildings).toBe(5);
});

test('dist: OSM-Straßen werden parallel geladen und für dasselbe Gebiet wiederverwendet', async ({page}) => {
  let osmRequests = 0;
  const osmQueries = [];
  await page.route(/overpass|corsproxy/, async route => {
    osmRequests++;
    osmQueries.push(decodeURIComponent(route.request().postData() || route.request().url()));
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
  expect(osmQueries.some(query=>query.includes('living_street')&&query.includes('track')&&query.includes('path'))).toBe(true);
  expect(first.text).toContain('1 geladen');
  expect(second.text).toContain('1 geladen');
  expect(second.duration).toBeLessThan(first.duration + 50);
});

test('dist: unvollständige große OSM-Teilbereiche werden feiner erneut geladen', async ({page}) => {
  let largeRequests = 0;
  let smallRequests = 0;
  let wayId = 5000;
  await page.route(/overpass|corsproxy/, async route => {
    const raw = decodeURIComponent(route.request().postData() || route.request().url());
    const matches = [...raw.matchAll(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/g)];
    const bbox = matches.at(-1)?.slice(1).map(Number);
    const span = bbox ? Math.max(bbox[2]-bbox[0],bbox[3]-bbox[1]) : 0;
    if (span > 0.006) {
      largeRequests++;
      await route.fulfill({
        status:200,contentType:'application/json',
        body:JSON.stringify({
          remark:'runtime error: Query timed out',
          elements:[{
            type:'way',id:1,tags:{highway:'primary'},
            geometry:[{lat:52,lon:8},{lat:52.001,lon:8.001}],
          }],
        }),
      });
      return;
    }
    smallRequests++;
    const id = wayId++;
    await route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({elements:[{
        type:'way',id,tags:{highway:'service'},
        geometry:[
          {lat:bbox?.[0] || 52,lon:bbox?.[1] || 8},
          {lat:bbox?.[2] || 52.001,lon:bbox?.[3] || 8.001},
        ],
      }]}),
    });
  });
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.loadOsmStrassen==='function');

  const result=await page.evaluate(async()=>{
    setAreaLatLngs([
      L.latLng(52,8),L.latLng(52,8.018),
      L.latLng(52.018,8.018),L.latLng(52.018,8),
    ]);
    const count=await loadOsmStrassen();
    return {
      count,
      progressVisible:!document.getElementById('osm-street-progress')?.hidden,
      progressText:document.getElementById('osm-street-progress-status')?.textContent || '',
    };
  });
  expect(largeRequests).toBeGreaterThan(0);
  expect(smallRequests).toBeGreaterThan(0);
  expect(result.count).toBeGreaterThan(0);
  expect(result.progressVisible).toBe(true);
  expect(result.progressText).toContain('vollständig geladen');
});

test('dist: eine schnelle leere OSM-Antwort verdrängt keine nutzbaren Straßendaten', async ({page}) => {
  await page.route(/overpass|corsproxy/, async route => {
    if (route.request().url().includes('maps.mail.ru')) {
      await route.fulfill({status:200,contentType:'application/json',body:'{"elements":[]}'});
      return;
    }
    await new Promise(resolve => setTimeout(resolve,80));
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({elements:[{
        type:'way',id:456,tags:{highway:'service'},
        geometry:[{lat:52.081,lon:8.003},{lat:52.082,lon:8.004}],
      }]}),
    });
  });
  await page.route(/tile\.openstreetmap\.org/,route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.loadOsmStrassen === 'function');

  const result = await page.evaluate(async () => {
    setAreaLatLngs([
      L.latLng(52.080,8.002),L.latLng(52.080,8.005),
      L.latLng(52.083,8.005),L.latLng(52.083,8.002),
    ]);
    const count = await loadOsmStrassen();
    return {count,text:document.getElementById('btn-osm-strassen')?.textContent};
  });

  expect(result.count).toBe(1);
  expect(result.text).toContain('1 geladen');
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

  const result = await page.evaluate(async () => {
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
    window.epConfirm=async()=>true;
    const deleted=await confirmClearNetz();
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
    const hiddenUntilSelected=Boolean(connection?.midMarker && !map.hasLayer(connection.midMarker));
    connection.hitLayer.fire('click',{originalEvent:{clientX:200,clientY:200}});
    const editableAfterSelection=Boolean(connection?.midMarker && map.hasLayer(connection.midMarker));
    setNetzEditMode(false);
    return {before,connected,hiddenUntilSelected,editableAfterSelection,handles,edgeCount:window.netzEdges.length};
  });

  expect(result).toEqual({
    before:false,
    connected:true,
    hiddenUntilSelected:true,
    editableAfterSelection:true,
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

test('dist: Straßenoptimierung bewertet echte Varianten mit mehreren Zentralzugängen',async({page})=>{
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.autoGenerateNetz==='function');
  const result=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const add=(id,lat,lng,load=900)=>{
      const building=addGebaeude({id,name:`Haus ${id}`,baujahr:2000,skipAutoCreate:true,coords:[
        L.latLng(lat-.000025,lng-.000025),L.latLng(lat-.000025,lng+.000025),
        L.latLng(lat+.000025,lng+.000025),L.latLng(lat+.000025,lng-.000025),
      ]});
      building.heizlast=String(load);
      building.waerme=String(load*2);
    };
    add(1101,52.001,9.001,1);
    add(1102,52.00005,9.0001);
    add(1103,52.00005,9.0019);
    add(1104,52.00195,9.0001);
    add(1105,52.00195,9.0019);
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1101';
    setTrassePoints([
      L.latLng(52,9),L.latLng(52,9.002),
      L.latLng(52.002,9),L.latLng(52.002,9.002),
      L.latLng(52,9),L.latLng(52.002,9),
      L.latLng(52,9.002),L.latLng(52.002,9.002),
      L.latLng(52,9),L.latLng(52.001,9.00025),L.latLng(52.002,9),
    ]);
    setTrasseSegments([
      {start:0,end:1,domains:['waerme'],source:'osm-street'},
      {start:2,end:3,domains:['waerme'],source:'osm-street'},
      {start:4,end:5,domains:['waerme'],source:'osm-street'},
      {start:6,end:7,domains:['waerme'],source:'osm-street'},
      {start:8,end:10,domains:['waerme'],source:'osm-street'},
    ]);
    setNetworkLocked(false);
    const created=autoGenerateNetz({strategy:'street',trasseTreue:80});
    const meta=window._netzTopologyOptimization;
    const connectedNodes=new Set(window.netzEdges.flatMap(edge=>[edge.u,edge.v]));
    return {
      created,meta,
      edgeCount:window.netzEdges.length,
      nodeCount:connectedNodes.size,
      centralRoadConnections:window.netzEdges.filter(edge=>
        (edge.u===1101&&edge.vNode.type==='trasse')||
        (edge.v===1101&&edge.uNode.type==='trasse')).length,
    };
  });
  expect(result.created).toBe(true);
  expect(result.meta.availableCentralOutlets).toBeGreaterThan(1);
  expect(result.meta.evaluatedOutletVariants).toBeGreaterThan(1);
  expect(result.meta.evaluatedRouteVariants).toBe(3);
  expect(result.meta.distinctRouteVariants).toBeGreaterThan(1);
  expect(result.meta.evaluatedGeneralSwaps).toBeGreaterThan(0);
  expect(result.meta.maxStretchAfter).toBeLessThanOrEqual(result.meta.maxStretchBefore);
  expect(result.edgeCount).toBe(result.nodeCount-1);
  expect(result.centralRoadConnections).toBeGreaterThan(1);
});

test('dist: Gebäudekreuzung wird nur als Rückfall genutzt und verhindert den Netzaufbau nicht',async({page})=>{
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.createQuickWaermeNetz==='function');
  const result=await page.evaluate(async()=>{
    clearNetz();
    setGebaeude([]);
    const polygon=(lat,lng,dLat=.00004,dLng=.00004)=>[
      L.latLng(lat-dLat,lng-dLng),L.latLng(lat-dLat,lng+dLng),
      L.latLng(lat+dLat,lng+dLng),L.latLng(lat+dLat,lng-dLng),
    ];
    const source=addGebaeude({id:951,name:'Zentrale',baujahr:2000,coords:polygon(52.08,8),skipAutoCreate:true});
    const target=addGebaeude({id:952,name:'Verbraucher',baujahr:2000,coords:polygon(52.08,8.004),skipAutoCreate:true});
    // Fremdes Gebäude ohne Wärmebedarf blockiert die einzige direkte Kante.
    addGebaeude({id:953,name:'Hindernis',baujahr:2000,coords:polygon(52.08,8.002,.0002,.00035),skipAutoCreate:true});
    source.heizlast='100'; source.waerme='200';
    target.heizlast='100'; target.waerme='200';
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='951';
    openNetzWorkspace('create');
    const created=await createQuickWaermeNetz();
    return {
      created,
      edgeCount:window.netzEdges.length,
      workspaceOpen:!document.getElementById('netz-workspace').hidden,
      menuOpen:!document.getElementById('netz-create-menu').hidden,
      hint:document.getElementById('hint').textContent,
    };
  });
  expect(result.created).toBe(true);
  expect(result.edgeCount).toBe(1);
  expect(result.workspaceOpen).toBe(false);
  expect(result.menuOpen).toBe(false);
  expect(result.hint).toContain('Gebäudekonflikt');
});

test('dist: straßenorientierter Aufbau bleibt bei großer Gebäudemenge verbunden',async({page})=>{
  test.setTimeout(45000);
  await page.route(/tile\\.openstreetmap\\.org/,route=>route.abort());
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.autoGenerateNetz==='function');
  const result=await page.evaluate(()=>{
    clearNetz();
    setGebaeude([]);
    const count=120;
    const road=[];
    for(let index=0;index<count;index++){
      const lat=52.08+index*.00011;
      const lng=8+(index%2===0 ? -.00013 : .00013);
      const building=addGebaeude({
        id:1100+index,name:`Gebäude ${index+1}`,baujahr:2000,skipAutoCreate:true,
        coords:[
          L.latLng(lat-.000025,lng-.000025),L.latLng(lat-.000025,lng+.000025),
          L.latLng(lat+.000025,lng+.000025),L.latLng(lat+.000025,lng-.000025),
        ],
      });
      building.heizlast='80';
      building.waerme='160';
      road.push(L.latLng(lat,8));
    }
    setTrassePoints(road);
    setTrasseSegments([{start:0,end:road.length-1,domains:['waerme'],source:'osm-street'}]);
    populateZentraleSelect();
    document.getElementById('netz-zentrale').value='1100';
    setNetworkLocked(false);
    const started=performance.now();
    const created=autoGenerateNetz({strategy:'street',trasseTreue:80});
    const connected=new Set(window.netzEdges.flatMap(edge=>[edge.u,edge.v]));
    return {
      created,
      durationMs:performance.now()-started,
      edgeCount:window.netzEdges.length,
      connectedBuildings:window.gebaeude.filter(building=>connected.has(building.id)).length,
    };
  });
  expect(result.created).toBe(true);
  expect(result.edgeCount).toBeGreaterThan(0);
  expect(result.connectedBuildings).toBe(120);
  expect(result.durationMs).toBeLessThan(15000);
});
